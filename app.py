"""CashCoachAI — Flask backend"""

from flask import Flask, render_template, request, jsonify, Response, stream_with_context, redirect
import anthropic
import json
import re
import os
import sqlite3
import uuid
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import stripe

app = Flask(__name__)
_anthropic_client = None


def get_client():
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic()
    return _anthropic_client

# ─── Config ────────────────────────────────────
stripe.api_key          = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET   = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
APP_URL                 = os.environ.get('APP_URL', 'http://localhost:5001')

CONTACT_EMAIL_TO        = os.environ.get('CONTACT_EMAIL_TO', '')   # where you receive messages
SMTP_EMAIL              = os.environ.get('SMTP_EMAIL', '')          # Gmail address to send from
SMTP_PASSWORD           = os.environ.get('SMTP_PASSWORD', '')       # Gmail app password


# ─── Database ──────────────────────────────────
DB_PATH = '/tmp/cashcoach.db'


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS subscriptions (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            token                 TEXT UNIQUE NOT NULL,
            stripe_customer_id    TEXT,
            stripe_subscription_id TEXT,
            email                 TEXT,
            status                TEXT DEFAULT 'pending',
            created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );
    ''')
    conn.commit()
    conn.close()


def get_or_create_price_id():
    """Return the Stripe price ID for $9.99/month, creating it if needed."""
    env_id = os.environ.get('STRIPE_PRICE_ID', '')
    if env_id:
        return env_id

    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key='stripe_price_id'").fetchone()
    conn.close()
    if row:
        return row['value']

    if not stripe.api_key:
        return None

    try:
        product = stripe.Product.create(
            name='CashCoachAI Subscription',
            description='AI-powered personal finance coaching',
        )
        price = stripe.Price.create(
            product=product.id,
            unit_amount=999,        # $9.99 in cents
            currency='usd',
            recurring={'interval': 'month'},
        )
        conn = get_db()
        conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('stripe_price_id', ?)",
                     (price.id,))
        conn.commit()
        conn.close()
        return price.id
    except Exception:
        return None


init_db()


# ─── Subscription Routes ───────────────────────

@app.route('/subscribe')
def subscribe():
    return render_template(
        'subscribe.html',
        stripe_pub_key=os.environ.get('STRIPE_PUBLISHABLE_KEY', ''),
    )


@app.route('/api/create-checkout-session', methods=['POST'])
def create_checkout_session():
    if not stripe.api_key:
        return jsonify({'error': 'Stripe not configured. Set STRIPE_SECRET_KEY.'}), 500

    price_id = get_or_create_price_id()
    if not price_id:
        return jsonify({'error': 'Could not get Stripe price ID.'}), 500

    try:
        session = stripe.checkout.Session.create(
            mode='subscription',
            payment_method_types=['card'],
            line_items=[{'price': price_id, 'quantity': 1}],
            subscription_data={'trial_period_days': 7},
            success_url=f'{APP_URL}/subscribe/success?session_id={{CHECKOUT_SESSION_ID}}',
            cancel_url=f'{APP_URL}/subscribe',
        )
        return jsonify({'url': session.url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/subscribe/success')
def subscribe_success():
    session_id = request.args.get('session_id', '')
    if not session_id:
        return redirect('/subscribe')

    try:
        session = stripe.checkout.Session.retrieve(session_id)
        customer_id     = session.customer
        subscription_id = session.subscription
        email = (session.customer_details.email
                 if session.customer_details else None)

        sub    = stripe.Subscription.retrieve(subscription_id)
        status = sub.status   # 'trialing', 'active', etc.

        conn = get_db()
        existing = conn.execute(
            'SELECT token FROM subscriptions WHERE stripe_customer_id = ?',
            (customer_id,)
        ).fetchone()

        if existing:
            token = existing['token']
            conn.execute(
                '''UPDATE subscriptions
                   SET stripe_subscription_id=?, email=?, status=?, updated_at=CURRENT_TIMESTAMP
                   WHERE stripe_customer_id=?''',
                (subscription_id, email, status, customer_id)
            )
        else:
            token = str(uuid.uuid4())
            conn.execute(
                '''INSERT INTO subscriptions
                   (token, stripe_customer_id, stripe_subscription_id, email, status)
                   VALUES (?, ?, ?, ?, ?)''',
                (token, customer_id, subscription_id, email, status)
            )
        conn.commit()
        conn.close()

        return redirect(f'/?token={token}')
    except Exception:
        return redirect('/subscribe?error=1')


@app.route('/api/check-subscription')
def check_subscription():
    # Dev mode: if Stripe isn't configured, allow all access
    if not stripe.api_key:
        return jsonify({'active': True, 'dev_mode': True})

    token = request.args.get('token', '')
    if not token:
        return jsonify({'active': False})

    conn = get_db()
    row = conn.execute(
        'SELECT status FROM subscriptions WHERE token = ?', (token,)
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'active': False})

    return jsonify({
        'active': row['status'] in ('active', 'trialing'),
        'status': row['status'],
    })


@app.route('/api/stripe/webhook', methods=['POST'])
def stripe_webhook():
    payload    = request.get_data()
    sig_header = request.headers.get('Stripe-Signature', '')

    if STRIPE_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(payload, sig_header, STRIPE_WEBHOOK_SECRET)
        except Exception:
            return '', 400
    else:
        try:
            event = json.loads(payload)
        except Exception:
            return '', 400

    event_type = event.get('type', '')

    if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
        sub_obj         = event['data']['object']
        subscription_id = sub_obj['id']
        status          = sub_obj['status']

        conn = get_db()
        conn.execute(
            '''UPDATE subscriptions SET status=?, updated_at=CURRENT_TIMESTAMP
               WHERE stripe_subscription_id=?''',
            (status, subscription_id)
        )
        conn.commit()
        conn.close()

    return '', 200


# ─── Contact Route ─────────────────────────────

@app.route('/api/contact', methods=['POST'])
def contact():
    data    = request.json
    name    = data.get('name', '').strip()
    email   = data.get('email', '').strip()
    message = data.get('message', '').strip()

    if not name or not email or not message:
        return jsonify({'error': 'All fields are required.'}), 400

    if not CONTACT_EMAIL_TO or not SMTP_EMAIL or not SMTP_PASSWORD:
        return jsonify({'error': 'Email not configured on server. Set CONTACT_EMAIL_TO, SMTP_EMAIL, SMTP_PASSWORD.'}), 500

    try:
        msg             = MIMEMultipart('alternative')
        msg['Subject']  = f'CashCoachAI Contact: {name}'
        msg['From']     = SMTP_EMAIL
        msg['To']       = CONTACT_EMAIL_TO
        msg['Reply-To'] = email

        body = (
            f"New message from CashCoachAI contact form\n"
            f"{'─' * 40}\n\n"
            f"Name:  {name}\n"
            f"Email: {email}\n\n"
            f"Message:\n{message}\n"
        )
        msg.attach(MIMEText(body, 'plain'))

        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.sendmail(SMTP_EMAIL, CONTACT_EMAIL_TO, msg.as_string())

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': 'Failed to send message. Please try again.'}), 500


# ─── Main App ──────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/generate-plan', methods=['POST'])
def generate_plan():
    data    = request.json
    income  = float(data.get('income', 0))
    bills   = data.get('bills', [])
    habits  = data.get('habits', [])

    bills_text = (
        '\n'.join(
            f"  - {b['name']}: ${float(b['amount']):,.2f}/mo ({b['category']})"
            for b in bills
        ) or '  None'
    )
    habits_text = (
        '\n'.join(
            f"  - {h['category']}: ~${float(h['estimated']):,.2f}/mo" for h in habits
        ) or '  None'
    )
    total_fixed    = sum(float(b['amount']) for b in bills)
    total_variable = sum(float(h['estimated']) for h in habits)
    remaining      = income - total_fixed - total_variable

    prompt = f"""You are CashCoachAI, an expert personal finance advisor. Analyze this financial profile and create a personalized, actionable budget plan.

FINANCIAL PROFILE:
  Monthly Take-Home Income: ${income:,.2f}
  Total Fixed Bills:        ${total_fixed:,.2f}
  Total Variable Spending:  ${total_variable:,.2f}
  Net Remaining:            ${remaining:,.2f}

FIXED MONTHLY BILLS:
{bills_text}

SPENDING HABITS (estimated):
{habits_text}

Respond with ONLY valid JSON matching this exact structure — no extra text, no markdown code blocks:
{{
  "summary": "2-3 sentence personalized overview of their financial situation and biggest opportunities",
  "financial_score": <integer 1-100 representing overall financial health>,
  "score_label": "<Excellent|Good|Fair|Needs Work>",
  "score_explanation": "One sentence explaining the score",
  "allocations": [
    {{
      "category": "string",
      "recommended_budget": <monthly dollar number>,
      "current_spending": <current monthly dollar number>,
      "percentage_of_income": <number rounded to 1 decimal>,
      "status": "<on_track|warning|over_budget>",
      "tip": "Specific actionable advice for this category in one sentence"
    }}
  ],
  "savings_plan": {{
    "monthly_amount": <dollar number>,
    "percentage_of_income": <number rounded to 1 decimal>,
    "annual_projection": <monthly * 12>,
    "3_year_projection": <monthly * 36>,
    "recommendation": "Specific savings strategy in one sentence"
  }},
  "top_tips": [
    "Specific tip 1 with dollar amounts",
    "Specific tip 2 with dollar amounts",
    "Specific tip 3 with dollar amounts"
  ],
  "red_flags": ["Urgent financial concern if any — empty array if finances look healthy"]
}}

Rules:
- Include EVERY bill category and spending habit category in allocations
- Add a "Savings" category in allocations
- Numbers must be realistic and reflect actual spending patterns
- Be encouraging but honest"""

    try:
        response = get_client().messages.create(
            model='claude-opus-4-6',
            max_tokens=2048,
            messages=[{'role': 'user', 'content': prompt}],
        )
        text = response.content[0].text.strip()
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
        match = re.search(r'\{[\s\S]*\}', text)
        if match:
            plan = json.loads(match.group())
            return jsonify(plan)
        return jsonify({'error': 'Could not parse AI response'}), 500
    except json.JSONDecodeError as e:
        return jsonify({'error': f'Invalid JSON from AI: {e}'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def chat():
    data     = request.json
    messages = data.get('messages', [])
    ctx      = data.get('context', {})

    income         = ctx.get('income', 0)
    total_bills    = ctx.get('totalBills', 0)
    total_variable = ctx.get('totalVariable', 0)
    score          = ctx.get('score', 'N/A')
    bills_summary  = ctx.get('billsSummary', 'none provided')
    habits_summary = ctx.get('habitsSummary', 'none provided')

    system = f"""You are CashCoachAI, a friendly and knowledgeable personal finance advisor.

USER'S FINANCIAL PROFILE:
- Monthly Take-Home Income: ${income:,.2f}
- Fixed Monthly Bills: ${total_bills:,.2f}
- Variable Monthly Spending: ${total_variable:,.2f}
- Available After Bills & Spending: ${income - total_bills - total_variable:,.2f}
- Financial Health Score: {score}/100
- Bills: {bills_summary}
- Spending: {habits_summary}

Guidelines:
- Give specific, actionable advice using THEIR actual dollar amounts
- Be encouraging but honest about areas needing improvement
- Keep responses concise and practical (2-4 paragraphs or use bullet points)
- Reference their specific numbers whenever relevant
- Suggest concrete dollar amounts and percentages tied to their income"""

    def generate():
        try:
            with get_client().messages.stream(
                model='claude-opus-4-6',
                max_tokens=1024,
                system=system,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield 'data: [DONE]\n\n'
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield 'data: [DONE]\n\n'

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )


if __name__ == '__main__':
    app.run(debug=True, port=5001)
