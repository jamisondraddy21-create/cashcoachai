"""CashCoachAI — Flask backend"""

from flask import Flask, render_template, request, jsonify, Response, stream_with_context, redirect, session, make_response
from werkzeug.security import generate_password_hash, check_password_hash
import anthropic
import json
import re
import os
import psycopg2
import psycopg2.extras
import uuid
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import stripe

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'cashcoach_dev_secret_key')
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

ADMIN_PASSWORD          = os.environ.get('ADMIN_PASSWORD', 'cashcoach_admin_2024')  # change this!


# ─── Database ──────────────────────────────────
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://localhost/cashcoach')


class _PgConn:
    """Thin wrapper to give psycopg2 connections a dict-cursor interface."""
    def __init__(self, conn):
        self._conn = conn
        self._cur  = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    def execute(self, sql, params=None):
        self._cur.execute(sql, params or ())
        return self._cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._cur.close()
        self._conn.close()


def get_db():
    return _PgConn(psycopg2.connect(DATABASE_URL))


def init_db():
    conn = get_db()
    for sql in [
        '''CREATE TABLE IF NOT EXISTS subscriptions (
            id                     SERIAL PRIMARY KEY,
            token                  TEXT UNIQUE NOT NULL,
            stripe_customer_id     TEXT,
            stripe_subscription_id TEXT,
            email                  TEXT,
            status                 TEXT DEFAULT 'pending',
            plan                   TEXT DEFAULT 'basic',
            password_hash          TEXT,
            created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''',
        '''CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        )''',
        '''CREATE TABLE IF NOT EXISTS user_data (
            id              SERIAL PRIMARY KEY,
            subscription_id INTEGER NOT NULL UNIQUE,
            income          REAL    DEFAULT 0,
            bills           TEXT    DEFAULT '[]',
            habits          TEXT    DEFAULT '[]',
            budget_plan     TEXT,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )''',
    ]:
        conn.execute(sql)
    conn.commit()
    # Migrations for older DB schemas
    for migration in [
        "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basic'",
        "ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS password_hash TEXT",
        "ALTER TABLE user_data ADD COLUMN IF NOT EXISTS expenses TEXT DEFAULT '[]'",
    ]:
        conn.execute(migration)
        conn.commit()
    conn.close()


def _get_or_create_price(settings_key, env_key, unit_amount, plan_name, plan_description):
    """Generic helper: return a Stripe price ID, creating the product+price if needed."""
    env_id = os.environ.get(env_key, '')
    if env_id:
        return env_id

    conn = get_db()
    row = conn.execute('SELECT value FROM settings WHERE key=%s', (settings_key,)).fetchone()
    conn.close()
    if row:
        return row['value']

    if not stripe.api_key:
        return None

    try:
        product = stripe.Product.create(name=plan_name, description=plan_description)
        price   = stripe.Price.create(
            product=product.id,
            unit_amount=unit_amount,
            currency='usd',
            recurring={'interval': 'month'},
        )
        conn = get_db()
        conn.execute(
            'INSERT INTO settings (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
            (settings_key, price.id)
        )
        conn.commit()
        conn.close()
        return price.id
    except Exception:
        return None


def get_or_create_price_id():
    """Return the Stripe price ID for the $9.99/month Basic plan."""
    return _get_or_create_price(
        settings_key='stripe_price_id',
        env_key='STRIPE_PRICE_ID',
        unit_amount=999,
        plan_name='CashCoachAI Basic',
        plan_description='AI-powered personal finance coaching',
    )


def get_or_create_pro_price_id():
    """Return the Stripe price ID for the $19.99/month Pro plan."""
    return _get_or_create_price(
        settings_key='stripe_pro_price_id',
        env_key='STRIPE_PRO_PRICE_ID',
        unit_amount=1999,
        plan_name='CashCoachAI Pro',
        plan_description='Unlimited AI advisor, priority support, advanced savings goals & monthly report',
    )


def get_or_create_investor_price_id():
    """Return the Stripe price ID for the $39.99/month Investor plan."""
    return _get_or_create_price(
        settings_key='stripe_investor_price_id',
        env_key='STRIPE_INVESTOR_PRICE_ID',
        unit_amount=3999,
        plan_name='CashCoachAI Investor',
        plan_description='Daily market news, portfolio tracker, compound calculator & AI investing coach',
    )


init_db()


# ─── Admin Bypass ──────────────────────────────

@app.route('/admin', methods=['GET', 'POST'])
def admin():
    error      = None
    show_plans = False
    password   = ''

    if request.method == 'POST':
        password = request.form.get('password', '')
        plan     = request.form.get('plan', '').strip()

        if password == ADMIN_PASSWORD:
            session['admin_auth'] = True
            if plan in ('basic', 'pro', 'investor'):
                # Create or update a plan-specific admin token
                email = f'admin-{plan}@cashcoachai.internal'
                conn  = get_db()
                row   = conn.execute(
                    'SELECT token FROM subscriptions WHERE email=%s', (email,)
                ).fetchone()

                if row:
                    token = row['token']
                    conn.execute(
                        "UPDATE subscriptions SET plan=%s, status='active', updated_at=CURRENT_TIMESTAMP WHERE email=%s",
                        (plan, email)
                    )
                else:
                    token = str(uuid.uuid4())
                    conn.execute(
                        "INSERT INTO subscriptions (token, email, status, plan) VALUES (%s, %s, 'active', %s)",
                        (token, email, plan)
                    )
                conn.commit()
                conn.close()
                return redirect(f'/app?token={token}&plan={plan}')
            else:
                # Password correct but no plan chosen yet — show plan selector
                show_plans = True
        else:
            error = 'Incorrect password.'

    return render_template('admin.html', error=error, show_plans=show_plans, admin_password=password)


@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_auth', None)
    return redirect('/admin')


# ─── Admin Dashboard ───────────────────────────

PLAN_PRICES = {'basic': 9.99, 'pro': 19.99, 'investor': 39.99}
BAD_STATUSES = {'canceled', 'cancelled', 'past_due', 'unpaid', 'incomplete_expired'}


@app.route('/admin/subscriptions')
def admin_subscriptions():
    if not session.get('admin_auth'):
        return redirect('/admin')
    conn = get_db()
    rows = conn.execute(
        'SELECT id, email, token, status, plan, created_at FROM subscriptions ORDER BY id'
    ).fetchall()
    conn.close()
    html = '<h2 style="font-family:monospace;padding:20px">Subscriptions</h2>'
    html += '<table border="1" cellpadding="8" style="font-family:monospace;border-collapse:collapse;margin:0 20px">'
    html += '<tr><th>id</th><th>email</th><th>token</th><th>status</th><th>plan</th><th>created_at</th></tr>'
    for r in rows:
        html += f'<tr><td>{r["id"]}</td><td>{r["email"]}</td><td>{r["token"]}</td><td>{r["status"]}</td><td>{r["plan"]}</td><td>{r["created_at"]}</td></tr>'
    html += '</table>'
    return html


@app.route('/admin/cleanup-dupes')
def admin_cleanup_dupes():
    if not session.get('admin_auth'):
        return redirect('/admin')
    conn = get_db()
    conn.execute('DELETE FROM user_data WHERE subscription_id IN (1, 2)')
    conn.execute('DELETE FROM subscriptions WHERE id IN (1, 2)')
    conn.commit()
    rows = conn.execute('SELECT id, email, status, plan, created_at FROM subscriptions ORDER BY id').fetchall()
    conn.close()
    html = '<h2 style="font-family:monospace;padding:20px">Done. Remaining subscriptions:</h2>'
    html += '<table border="1" cellpadding="8" style="font-family:monospace;border-collapse:collapse;margin:0 20px">'
    html += '<tr><th>id</th><th>email</th><th>status</th><th>plan</th><th>created_at</th></tr>'
    for r in rows:
        html += f'<tr><td>{r["id"]}</td><td>{r["email"]}</td><td>{r["status"]}</td><td>{r["plan"]}</td><td>{r["created_at"]}</td></tr>'
    html += '</table>'
    return html


@app.route('/admin/dashboard')
def admin_dashboard():
    if not session.get('admin_auth'):
        return redirect('/admin')

    from datetime import datetime, timedelta, timezone
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM subscriptions ORDER BY created_at DESC'
    ).fetchall()
    conn.close()

    cutoff_new = datetime.now(timezone.utc) - timedelta(days=7)

    customers   = []
    plan_counts = {'basic': 0, 'pro': 0, 'investor': 0}
    total_mrr   = 0.0

    for row in rows:
        email     = row['email'] or '—'
        plan      = (row['plan'] or 'basic').lower()
        status    = row['status'] or 'unknown'
        sub_id    = row['stripe_subscription_id']
        cust_id   = row['stripe_customer_id']

        # Skip internal admin preview accounts from stats
        is_admin_account = email.endswith('@cashcoachai.internal')

        # Parse created_at
        try:
            created = datetime.fromisoformat(str(row['created_at']).replace(' ', 'T'))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            created_str = created.strftime('%b %d, %Y')
        except Exception:
            created     = None
            created_str = '—'

        # Determine if new (within 7 days)
        is_new = (created is not None) and (created >= cutoff_new) and not is_admin_account

        # Try to enrich with Stripe data
        next_billing = '—'
        cust_name    = '—'
        if stripe.api_key and sub_id and not is_admin_account:
            try:
                sub          = stripe.Subscription.retrieve(sub_id)
                status       = sub.status
                period_end   = sub.current_period_end
                next_billing = datetime.fromtimestamp(period_end, tz=timezone.utc).strftime('%b %d, %Y')
            except Exception:
                pass
            try:
                cust      = stripe.Customer.retrieve(cust_id)
                cust_name = cust.get('name') or '—'
            except Exception:
                pass

        is_bad = status in BAD_STATUSES

        if not is_admin_account and status in ('active', 'trialing'):
            plan_counts[plan if plan in plan_counts else 'basic'] += 1
            total_mrr += PLAN_PRICES.get(plan, 9.99)

        customers.append({
            'email':        email,
            'name':         cust_name,
            'plan':         plan.capitalize(),
            'status':       status,
            'created_str':  created_str,
            'next_billing': next_billing,
            'is_new':       is_new,
            'is_bad':       is_bad,
            'is_admin':     is_admin_account,
        })

    total_active = plan_counts['basic'] + plan_counts['pro'] + plan_counts['investor']

    return render_template(
        'admin_dashboard.html',
        customers=customers,
        plan_counts=plan_counts,
        total_active=total_active,
        total_mrr=total_mrr,
    )


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

    data = request.json or {}
    plan = data.get('plan', 'basic')

    if plan == 'pro':
        price_id = get_or_create_pro_price_id()
    elif plan == 'investor':
        price_id = get_or_create_investor_price_id()
    else:
        price_id = get_or_create_price_id()
        plan = 'basic'

    if not price_id:
        return jsonify({'error': 'Could not get Stripe price ID.'}), 500

    try:
        session = stripe.checkout.Session.create(
            mode='subscription',
            payment_method_types=['card'],
            line_items=[{'price': price_id, 'quantity': 1}],
            subscription_data={'trial_period_days': 7},
            metadata={'plan': plan},
            success_url=f'{APP_URL}/subscribe/success?session_id={{CHECKOUT_SESSION_ID}}',
            cancel_url=f'{APP_URL}/subscribe',
        )
        return jsonify({'url': session.url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/subscribe/success')
def subscribe_success():
    session_id = request.args.get('session_id', '')
    print(f'[DEBUG /subscribe/success] session_id={session_id!r}', flush=True)
    if not session_id:
        return redirect('/subscribe')

    token = None
    is_new = False

    try:
        checkout = stripe.checkout.Session.retrieve(session_id)
        print(f'[DEBUG /subscribe/success] checkout retrieved OK, customer={checkout.customer}', flush=True)
        customer_id     = checkout.customer
        subscription_id = checkout.subscription
        email = (checkout.customer_details.email
                 if checkout.customer_details else None)
        print(f'[DEBUG /subscribe/success] email={email!r}', flush=True)

        sub    = stripe.Subscription.retrieve(subscription_id)
        status = sub.status   # 'trialing', 'active', etc.
        plan   = checkout.metadata.get('plan', 'basic') if checkout.metadata else 'basic'
        print(f'[DEBUG /subscribe/success] status={status!r} plan={plan!r}', flush=True)

        conn     = get_db()
        existing = conn.execute(
            'SELECT token FROM subscriptions WHERE stripe_customer_id = %s',
            (customer_id,)
        ).fetchone()

        # Fall back to email match (handles re-subscriptions with a new Stripe customer ID)
        if not existing and email:
            existing = conn.execute(
                'SELECT token FROM subscriptions WHERE lower(email) = lower(%s) ORDER BY created_at DESC LIMIT 1',
                (email,)
            ).fetchone()

        if existing:
            token = existing['token']
            conn.execute(
                '''UPDATE subscriptions
                   SET stripe_customer_id=%s, stripe_subscription_id=%s, email=%s,
                       status=%s, plan=%s, updated_at=CURRENT_TIMESTAMP
                   WHERE token=%s''',
                (customer_id, subscription_id, email, status, plan, token)
            )
        else:
            token  = str(uuid.uuid4())
            is_new = True
            conn.execute(
                '''INSERT INTO subscriptions
                   (token, stripe_customer_id, stripe_subscription_id, email, status, plan)
                   VALUES (%s, %s, %s, %s, %s, %s)''',
                (token, customer_id, subscription_id, email, status, plan)
            )
        conn.commit()
        conn.close()
        print(f'[DEBUG /subscribe/success] is_new={is_new} token={token!r}', flush=True)

        if is_new and email:
            send_welcome_email(email, plan)

        print(f'[DEBUG /subscribe/success] is_new={is_new} token={token!r} — cookie will be set on redirect target', flush=True)

    except Exception as e:
        print(f'[DEBUG /subscribe/success] EXCEPTION: {e}', flush=True)
        # On any failure, still send the user into the app if we have a token
        if token:
            return redirect(f'/app?token={token}')
        return redirect('/?error=1')

    if is_new:
        print(f'[DEBUG /subscribe/success] redirecting new user to /create-password?token={token}', flush=True)
        return redirect(f'/create-password?token={token}')
    print(f'[DEBUG /subscribe/success] redirecting returning user to /app?token={token}', flush=True)
    return redirect(f'/app?token={token}')


@app.route('/debug/session')
def debug_session():
    return jsonify({
        'session': {k: v for k, v in session.items()},
        'cca_token_cookie': request.cookies.get('cca_token', None),
    })


@app.route('/debug/userdata')
def debug_userdata():
    token = request.cookies.get('cca_token', '')
    if not token:
        return jsonify({'error': 'No cca_token cookie found'}), 401

    conn = get_db()
    user = conn.execute(
        'SELECT id, email, plan, status FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    if not user:
        conn.close()
        return jsonify({'error': 'No subscription row found for this token', 'token': token}), 404

    row = conn.execute(
        'SELECT * FROM user_data WHERE subscription_id=%s', (user['id'],)
    ).fetchone()
    conn.close()

    return jsonify({
        'subscription': dict(user),
        'user_data':    dict(row) if row else None,
    })


@app.route('/debug/alldata')
def debug_alldata():
    conn  = get_db()
    rows  = conn.execute('SELECT * FROM user_data ORDER BY id').fetchall()
    subs  = conn.execute('SELECT id, email, plan, status FROM subscriptions ORDER BY id').fetchall()
    conn.close()

    return jsonify({
        'user_data_rows': [dict(r) for r in rows],
        'user_data_count': len(rows),
        'subscriptions': [dict(s) for s in subs],
    })


@app.route('/api/check-subscription')
def check_subscription():
    # Dev mode: if Stripe isn't configured, allow access but still respect plan from DB token
    if not stripe.api_key:
        token = request.args.get('token', '')
        plan  = 'basic'
        if token:
            conn = get_db()
            row  = conn.execute('SELECT plan FROM subscriptions WHERE token=%s', (token,)).fetchone()
            conn.close()
            if row and row['plan']:
                plan = row['plan']
        return jsonify({'active': True, 'dev_mode': True, 'plan': plan})

    url_token = request.args.get('token', '')
    user = get_current_user(url_token=url_token)

    if not user:
        return jsonify({'active': False})

    return jsonify({
        'active': user['status'] in ('active', 'trialing'),
        'status': user['status'],
        'plan':   user['plan'] or 'basic',
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
            '''UPDATE subscriptions SET status=%s, updated_at=CURRENT_TIMESTAMP
               WHERE stripe_subscription_id=%s''',
            (status, subscription_id)
        )
        conn.commit()
        conn.close()

    return '', 200


# ─── Investor Routes ───────────────────────────

@app.route('/api/market-news')
def market_news():
    import urllib.request
    import xml.etree.ElementTree as ET

    feeds = [
        'https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,QQQ,DIA,AAPL,MSFT&region=US&lang=en-US',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html',
        'https://feeds.marketwatch.com/marketwatch/topstories/',
    ]

    for feed_url in feeds:
        try:
            req = urllib.request.Request(
                feed_url,
                headers={'User-Agent': 'Mozilla/5.0 (compatible; CashCoachAI/1.0)'},
            )
            with urllib.request.urlopen(req, timeout=8) as response:
                content = response.read()

            root  = ET.fromstring(content)
            items = []
            for item in root.findall('.//item')[:10]:
                title       = item.findtext('title', '').strip()
                link        = item.findtext('link', '').strip()
                pub_date    = item.findtext('pubDate', '').strip()
                description = item.findtext('description', '').strip()
                # Strip HTML tags from description
                description = re.sub(r'<[^>]+>', '', description)[:200]

                if title and link:
                    items.append({
                        'title':       title,
                        'link':        link,
                        'date':        pub_date,
                        'description': description,
                    })

            if items:
                return jsonify({'items': items})
        except Exception:
            continue

    return jsonify({'items': [], 'error': 'Could not load market news at this time.'})


@app.route('/api/stock-price')
def stock_price():
    import urllib.request

    symbol = request.args.get('symbol', '').upper().strip()
    if not symbol or not re.match(r'^[A-Z0-9.\-]{1,10}$', symbol):
        return jsonify({'error': 'Invalid ticker symbol'}), 400

    url = f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1d&range=1d'
    try:
        req = urllib.request.Request(
            url,
            headers={
                'User-Agent': 'Mozilla/5.0 (compatible; CashCoachAI/1.0)',
                'Accept':     'application/json',
            },
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            data = json.loads(response.read())

        meta       = data['chart']['result'][0]['meta']
        price      = meta.get('regularMarketPrice', 0)
        prev_close = meta.get('previousClose', price)
        change     = price - prev_close
        change_pct = (change / prev_close * 100) if prev_close else 0

        return jsonify({
            'symbol':     symbol,
            'price':      round(price, 2),
            'change':     round(change, 2),
            'change_pct': round(change_pct, 2),
            'name':       meta.get('shortName', meta.get('longName', symbol)),
        })
    except Exception:
        return jsonify({'error': f'Could not fetch price for {symbol}. Check the ticker symbol.'}), 400


@app.route('/api/investing-chat', methods=['POST'])
def investing_chat():
    data     = request.json
    messages = data.get('messages', [])
    ctx      = data.get('context', {})

    income         = ctx.get('income', 0)
    total_bills    = ctx.get('totalBills', 0)
    total_variable = ctx.get('totalVariable', 0)
    savings        = ctx.get('savingsMonthly', 0)
    score          = ctx.get('score', 'N/A')
    investable     = max(0, income - total_bills - total_variable - savings)

    system = f"""You are an AI Investing Coach inside CashCoachAI. You're sharp, friendly, and brutally concise. Max 4-5 sentences per response. One key insight, one actionable recommendation, done.

Their numbers: ${income:,.2f}/month take-home, ${total_bills:,.2f} fixed bills, ${total_variable:,.2f} variable spending, ${savings:,.2f} savings, ~${investable:,.2f} investable surplus, health score {score}/100.

Rules: use their real numbers, always prioritize emergency fund → high-interest debt → Roth IRA/401k → taxable brokerage, never recommend individual stocks, no markdown formatting, no bullet points, no headers. Plain conversational text only. Get to the point immediately."""

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


# ─── Email Helpers ─────────────────────────────

PLAN_DISPLAY = {
    'basic':    'Basic',
    'pro':      'Pro',
    'investor': 'Investor',
}

def send_welcome_email(to_email, plan):
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        return
    plan_name = PLAN_DISPLAY.get(plan, plan.capitalize())
    app_url   = APP_URL

    subject = 'Welcome to CashCoachAI! 🎉'
    body = (
        f"Hi there,\n\n"
        f"Welcome to CashCoachAI! We're thrilled to have you on board.\n\n"
        f"Your Plan: {plan_name}\n\n"
        f"Getting Started:\n"
        f"  1. Head to the app and enter your monthly income and bills\n"
        f"  2. Generate your personalized budget plan with one click\n"
        f"  3. Chat with your AI advisor any time you need guidance\n\n"
        f"Open the app here:\n"
        f"  {app_url}\n\n"
        f"If you have any questions, just reply to this email — we're happy to help.\n\n"
        f"— The CashCoachAI Team\n"
        f"support@cashcoachai.com\n"
    )

    try:
        msg             = MIMEMultipart('alternative')
        msg['Subject']  = subject
        msg['From']     = 'CashCoachAI <support@cashcoachai.com>'
        msg['To']       = to_email
        msg.attach(MIMEText(body, 'plain'))

        with smtplib.SMTP('smtp.gmail.com', 587) as server:
            server.starttls()
            server.login(SMTP_EMAIL, SMTP_PASSWORD)
            server.sendmail(SMTP_EMAIL, to_email, msg.as_string())
    except Exception:
        pass  # Don't block the user flow if email fails


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
        msg['Subject']  = f'New Support Request from {name}'
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


# ─── Auth Routes ───────────────────────────────

@app.route('/login')
def login_page():
    if get_current_user():
        return redirect('/app')
    returning = request.args.get('returning') == '1'
    return render_template('login.html', returning=returning)


@app.route('/api/login', methods=['POST'])
def api_login():
    data     = request.json or {}
    email    = data.get('email', '').strip().lower()
    password = data.get('password', '')

    if not email or not password:
        return jsonify({'error': 'Email and password are required.'}), 400

    conn = get_db()
    row  = conn.execute(
        '''SELECT id, token, plan, status, password_hash
           FROM subscriptions
           WHERE lower(email)=%s AND password_hash IS NOT NULL
           ORDER BY created_at DESC LIMIT 1''',
        (email,)
    ).fetchone()
    conn.close()

    if not row or not check_password_hash(row['password_hash'], password):
        return jsonify({'error': 'Invalid email or password.'}), 401

    if row['status'] not in ('active', 'trialing'):
        return jsonify({'error': 'Your subscription is not active. Please resubscribe to continue.'}), 403

    resp = make_response(jsonify({'success': True, 'plan': row['plan'] or 'basic'}))
    _auth_cookie(resp, row['token'])
    return resp


@app.route('/logout')
def logout():
    resp = make_response(redirect('/'))
    resp.delete_cookie('cca_token')
    return resp


@app.route('/create-password')
def create_password_page():
    token = request.args.get('token', '')
    if not token:
        return redirect('/subscribe')

    conn = get_db()
    row  = conn.execute(
        'SELECT id, email, password_hash, plan, status FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    conn.close()

    if not row:
        return redirect('/subscribe')

    # Already has a password — send to login
    if row['password_hash']:
        return redirect('/login?returning=1')

    return render_template('create_password.html', token=token, email=row['email'] or '')


@app.route('/setup-password')
def setup_password_page():
    token = request.args.get('token', '')
    if not token:
        return redirect('/subscribe')

    conn = get_db()
    row  = conn.execute(
        'SELECT id, email, password_hash, plan, status FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    conn.close()

    if not row:
        return redirect('/subscribe')

    # Already has a password — returning subscriber, send to login
    if row['password_hash']:
        return redirect('/login?returning=1')

    return render_template('setup_password.html', token=token, email=row['email'] or '')


@app.route('/api/set-password', methods=['POST'])
def api_set_password():
    data     = request.json or {}
    token    = data.get('token', '')
    password = data.get('password', '')

    if not token or not password:
        return jsonify({'error': 'Missing token or password.'}), 400

    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters.'}), 400

    conn = get_db()
    row  = conn.execute(
        'SELECT id, email, plan, status FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()

    if not row:
        conn.close()
        return jsonify({'error': 'Invalid token.'}), 404

    conn.execute(
        'UPDATE subscriptions SET password_hash=%s, updated_at=CURRENT_TIMESTAMP WHERE token=%s',
        (generate_password_hash(password), token)
    )
    conn.commit()
    conn.close()

    resp = make_response(jsonify({'success': True, 'plan': row['plan'] or 'basic'}))
    _auth_cookie(resp, token)
    return resp


# ─── User Data Routes ───────────────────────────

@app.route('/api/save-data', methods=['POST'])
def save_data():
    data  = request.json or {}
    token = request.cookies.get('cca_token', '') or request.args.get('token', '')
    if not token:
        return jsonify({'error': 'Not authenticated.'}), 401

    conn = get_db()
    user = conn.execute(
        'SELECT id FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    conn.close()
    if not user:
        return jsonify({'error': 'Not authenticated.'}), 401
    user_id = user['id']

    income      = float(data.get('income', 0))
    bills       = json.dumps(data.get('bills', []))
    habits      = json.dumps(data.get('habits', []))
    budget_plan = json.dumps(data.get('budget_plan')) if data.get('budget_plan') else None
    expenses    = json.dumps(data.get('expenses', []))

    conn = get_db()
    conn.execute(
        '''INSERT INTO user_data (subscription_id, income, bills, habits, budget_plan, expenses)
           VALUES (%s, %s, %s, %s, %s, %s)
           ON CONFLICT(subscription_id) DO UPDATE SET
               income=excluded.income, bills=excluded.bills, habits=excluded.habits,
               budget_plan=excluded.budget_plan, expenses=excluded.expenses,
               updated_at=CURRENT_TIMESTAMP''',
        (user_id, income, bills, habits, budget_plan, expenses)
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/load-data')
def load_data():
    token = request.cookies.get('cca_token', '') or request.args.get('token', '')
    if not token:
        return jsonify({'data': None})

    conn  = get_db()
    user  = conn.execute(
        'SELECT id FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    if not user:
        conn.close()
        return jsonify({'data': None})

    row = conn.execute(
        'SELECT * FROM user_data WHERE subscription_id=%s', (user['id'],)
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'data': None})

    return jsonify({'data': {
        'income':      row['income'] or 0,
        'bills':       json.loads(row['bills']     or '[]'),
        'habits':      json.loads(row['habits']    or '[]'),
        'budget_plan': json.loads(row['budget_plan']) if row['budget_plan'] else None,
        'expenses':    json.loads(row['expenses']  or '[]'),
    }})


@app.route('/api/account')
def account_info():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in.'}), 401
    return jsonify({'email': user['email'], 'plan': user['plan'] or 'basic', 'status': user['status']})


@app.route('/api/change-password', methods=['POST'])
def api_change_password():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in.'}), 401

    data         = request.json or {}
    current_pass = data.get('current_password', '')
    new_pass     = data.get('new_password', '')

    if not current_pass or not new_pass:
        return jsonify({'error': 'Both passwords are required.'}), 400

    if len(new_pass) < 8:
        return jsonify({'error': 'New password must be at least 8 characters.'}), 400

    conn = get_db()
    row  = conn.execute('SELECT password_hash FROM subscriptions WHERE id=%s', (user['id'],)).fetchone()

    if not row or not check_password_hash(row['password_hash'], current_pass):
        conn.close()
        return jsonify({'error': 'Current password is incorrect.'}), 401

    conn.execute(
        'UPDATE subscriptions SET password_hash=%s, updated_at=CURRENT_TIMESTAMP WHERE id=%s',
        (generate_password_hash(new_pass), user['id'])
    )
    conn.commit()
    conn.close()
    return jsonify({'success': True})


@app.route('/api/cancel-subscription', methods=['POST'])
def api_cancel_subscription():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Not logged in.'}), 401

    conn = get_db()
    row  = conn.execute(
        'SELECT stripe_subscription_id FROM subscriptions WHERE id=%s', (user['id'],)
    ).fetchone()
    conn.close()

    if not row or not row['stripe_subscription_id']:
        return jsonify({'error': 'No active subscription found.'}), 404

    try:
        stripe.Subscription.cancel(row['stripe_subscription_id'])
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    conn = get_db()
    conn.execute(
        "UPDATE subscriptions SET status='canceled', updated_at=CURRENT_TIMESTAMP WHERE id=%s",
        (user['id'],)
    )
    conn.commit()
    conn.close()

    resp = make_response(jsonify({'success': True}))
    resp.delete_cookie('cca_token')
    return resp


# ─── Main App ──────────────────────────────────

def get_current_user(url_token=None):
    """Identify the user from url_token param, then cca_token cookie. Returns DB row or None."""
    token = url_token or request.cookies.get('cca_token', '')
    if not token:
        return None
    conn = get_db()
    row  = conn.execute(
        'SELECT id, token, plan, email, status FROM subscriptions WHERE token=%s', (token,)
    ).fetchone()
    conn.close()
    if row and row['status'] in ('active', 'trialing'):
        return row
    return None


def _auth_cookie(resp, token):
    """Attach a 30-day cca_token cookie to a response."""
    resp.set_cookie('cca_token', token, max_age=60*60*24*30, httponly=True, samesite='None', secure=True)
    return resp


@app.route('/setup', methods=['GET', 'POST'])
def setup():
    """Entry point for brand-new subscribers after password creation. Requires valid auth."""
    # Accept token from POST body, GET param, or existing cookie
    url_token = request.form.get('token', '') or request.args.get('token', '')
    user      = get_current_user(url_token=url_token)

    if not user:
        return redirect('/')

    resp = make_response(render_template(
        'index.html',
        plan=user['plan'] or 'basic',
        logged_in=True,
        user_email=(user['email'] or '').lower(),
        token=user['token'],
    ))
    _auth_cookie(resp, user['token'])
    return resp


@app.route('/app')
def app_view():
    """The dashboard — requires a valid cca_token cookie. Demo mode via ?demo=1."""
    if request.args.get('demo') == '1':
        return render_template('index.html', plan='investor', logged_in=False, user_email='', token='')

    url_token = request.args.get('token', '')
    user      = get_current_user(url_token=url_token)

    if not user:
        return redirect('/')

    resp = make_response(render_template(
        'index.html',
        plan=user['plan'] or 'basic',
        logged_in=True,
        user_email=(user['email'] or '').lower(),
        token=user['token'],
    ))
    _auth_cookie(resp, user['token'])
    return resp


@app.route('/')
def index():
    """Landing page with pricing and demo. Redirects logged-in users to /app."""
    user = get_current_user()
    if user:
        return redirect('/app')
    return render_template('subscribe.html', stripe_pub_key=os.environ.get('STRIPE_PUBLISHABLE_KEY', ''))


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

    system = f"""You are CashCoachAI — a sharp, friendly financial coach who gives quick, honest advice like a smart friend. Max 3-4 sentences per response. One clear point, one actionable takeaway, done. No essays, no lists.

Their numbers: ${income:,.2f}/month take-home, ${total_bills:,.2f} fixed bills ({bills_summary}), ${total_variable:,.2f} variable spending ({habits_summary}), ${income - total_bills - total_variable:,.2f} left over, health score {score}/100.

Rules: use their real numbers, be specific not vague, no bullet points, no headers, no markdown formatting. Plain conversational text only. Get to the point immediately."""

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
