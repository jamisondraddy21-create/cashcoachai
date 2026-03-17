"""CashCoachAI — Flask backend"""

from flask import Flask, render_template, request, jsonify, Response, stream_with_context
import anthropic
import json
import re
import os

app = Flask(__name__)
client = anthropic.Anthropic()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/generate-plan", methods=["POST"])
def generate_plan():
    data = request.json
    income = float(data.get("income", 0))
    bills = data.get("bills", [])
    habits = data.get("habits", [])

    bills_text = (
        "\n".join(
            f"  - {b['name']}: ${float(b['amount']):,.2f}/mo ({b['category']})"
            for b in bills
        )
        or "  None"
    )
    habits_text = (
        "\n".join(
            f"  - {h['category']}: ~${float(h['estimated']):,.2f}/mo" for h in habits
        )
        or "  None"
    )
    total_fixed = sum(float(b["amount"]) for b in bills)
    total_variable = sum(float(h["estimated"]) for h in habits)
    remaining = income - total_fixed - total_variable

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
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown code blocks if present
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            plan = json.loads(match.group())
            return jsonify(plan)
        return jsonify({"error": "Could not parse AI response"}), 500
    except json.JSONDecodeError as e:
        return jsonify({"error": f"Invalid JSON from AI: {e}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/chat", methods=["POST"])
def chat():
    data = request.json
    messages = data.get("messages", [])
    ctx = data.get("context", {})

    income = ctx.get("income", 0)
    total_bills = ctx.get("totalBills", 0)
    total_variable = ctx.get("totalVariable", 0)
    score = ctx.get("score", "N/A")
    bills_summary = ctx.get("billsSummary", "none provided")
    habits_summary = ctx.get("habitsSummary", "none provided")

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
            with client.messages.stream(
                model="claude-opus-4-6",
                max_tokens=1024,
                system=system,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    app.run(debug=True, port=5001)
