/* ═══════════════════════════════════════
   CashCoachAI — App Logic
   ═══════════════════════════════════════ */

// ─── State ────────────────────────────
let state = {
  income:      0,
  bills:       [],
  habits:      [],
  expenses:    [],
  budgetPlan:  null,
  chatHistory: [],
  portfolio:   [],   // [{symbol, shares, buyPrice, currentPrice, name}]
};

const DEFAULTS = [
  { category: 'Groceries',    emoji: '🛒', amount: 400 },
  { category: 'Dining Out',   emoji: '🍕', amount: 250 },
  { category: 'Coffee',       emoji: '☕', amount: 60  },
  { category: 'Entertainment',emoji: '🎬', amount: 100 },
  { category: 'Clothing',     emoji: '👕', amount: 100 },
  { category: 'Personal Care',emoji: '💄', amount: 60  },
  { category: 'Gas / Fuel',   emoji: '⛽', amount: 150 },
  { category: 'Health/Gym',   emoji: '💪', amount: 80  },
  { category: 'Shopping',     emoji: '🛍️', amount: 150 },
  { category: 'Travel',       emoji: '✈️', amount: 100 },
];

const EMOJIS = {
  Housing:'🏠', Transportation:'🚗', Utilities:'💡', Insurance:'🛡️',
  Subscriptions:'📱', Debt:'💳', Groceries:'🛒', 'Dining Out':'🍕',
  Coffee:'☕', Entertainment:'🎬', Clothing:'👕', 'Personal Care':'💄',
  'Gas / Fuel':'⛽', 'Health/Gym':'💪', Shopping:'🛍️', Travel:'✈️',
  Savings:'💰', Other:'📦',
};
const emoji = cat => EMOJIS[cat] || '📦';

let budgetChart       = null;
let spendingChart     = null;
let compoundChart     = null;
let investChatHistory = [];

// ─── Init ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Save token from URL if present (Stripe/admin redirect) — server already read it for rendering
  const params   = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('cca_sub_token', urlToken);
    window.history.replaceState({}, document.title, '/');
  }

  // Verify subscription (confirms plan matches server-rendered nav)
  const allowed = await checkSubscription();
  if (!allowed) return;   // redirected to /subscribe

  // Belt-and-suspenders: remove investor elements if window.CCA_PLAN isn't investor
  applyPlanGating();

  loadState();

  // Set default date
  document.getElementById('expenseDate').value = new Date().toISOString().split('T')[0];

  renderHabitChips();

  if (state.budgetPlan) {
    showNavTabs();
    navigate('dashboard');
  } else {
    document.getElementById('navTabs').style.visibility = 'hidden';
    showView('setup');
    goToStep(1);
  }
});

// ─── Subscription Check ────────────────
async function checkSubscription() {
  // Demo mode: banner + profiles are JS-driven; plan is already set server-side via ?demo=1
  if (localStorage.getItem('cca_demo') === '1') {
    window.CCA_PLAN = 'investor';
    document.getElementById('demoBanner').style.display = 'flex';
    loadDemoProfile('getting-by');
    return true;
  }

  try {
    const token = localStorage.getItem('cca_sub_token') || '';
    const res   = await fetch(`/api/check-subscription?token=${encodeURIComponent(token)}`);
    const data  = await res.json();

    if (!data.dev_mode && !data.active) {
      window.location.href = '/subscribe';
      return false;
    }

    const confirmedPlan = data.plan || 'basic';
    const serverPlan    = window.CCA_PLAN;   // set by server in <script> tag

    window.CCA_PLAN = confirmedPlan;

    // If server rendered stale nav (e.g. session expired), reload so server re-renders correctly
    if (confirmedPlan !== serverPlan) {
      window.location.href = token ? `/?token=${encodeURIComponent(token)}` : '/';
      return false;
    }

    return true;
  } catch (_) {
    // On network error, trust the server-rendered plan and never escalate to investor
    window.CCA_PLAN = window.CCA_PLAN === 'investor' ? 'basic' : (window.CCA_PLAN || 'basic');
    return true;
  }
}

// ─── Plan Gating ───────────────────────
function applyPlanGating() {
  // Primary control is server-side (Jinja). This is a belt-and-suspenders JS guard.
  if (window.CCA_PLAN !== 'investor') {
    const investorTab  = document.getElementById('investorNavTab');
    const investorView = document.getElementById('view-investor');
    if (investorTab)  investorTab.remove();
    if (investorView) investorView.remove();
  }
}

// ─── Demo Profiles ─────────────────────
const DEMO_PROFILES = {

  // ── Struggling ─ Score 18 ──────────────
  struggling: {
    income: 2800,
    bills: [
      { name: 'Rent',                  category: 'Housing',        amount: 950  },
      { name: 'Car Loan',              category: 'Transportation', amount: 380  },
      { name: 'Electric & Gas',        category: 'Utilities',      amount: 110  },
      { name: 'Phone',                 category: 'Subscriptions',  amount: 85   },
      { name: 'Credit Card Minimum',   category: 'Debt',           amount: 120  },
    ],
    habits: [
      { category: 'Groceries',     estimated: 180,  emoji: '🛒' },
      { category: 'Dining Out',    estimated: 520,  emoji: '🍕' },
      { category: 'Coffee',        estimated: 140,  emoji: '☕' },
      { category: 'Entertainment', estimated: 250,  emoji: '🎬' },
      { category: 'Shopping',      estimated: 280,  emoji: '🛍️' },
      { category: 'Gas / Fuel',    estimated: 120,  emoji: '⛽' },
    ],
    expenses: [
      { id: 1,  date: '2026-03-01', description: 'DoorDash — Burger King',   category: 'Dining Out',    amount: 18.99 },
      { id: 2,  date: '2026-03-02', description: 'Starbucks',                category: 'Coffee',        amount: 8.50  },
      { id: 3,  date: '2026-03-03', description: 'DoorDash — Pizza Hut',     category: 'Dining Out',    amount: 32.40 },
      { id: 4,  date: '2026-03-04', description: 'Starbucks',                category: 'Coffee',        amount: 7.25  },
      { id: 5,  date: '2026-03-05', description: 'Amazon impulse buy',       category: 'Shopping',      amount: 54.99 },
      { id: 6,  date: '2026-03-06', description: 'Uber Eats — Chinese',      category: 'Dining Out',    amount: 28.75 },
      { id: 7,  date: '2026-03-07', description: 'Shell Gas Station',        category: 'Gas / Fuel',    amount: 55.00 },
      { id: 8,  date: '2026-03-08', description: 'Bar tab',                  category: 'Entertainment', amount: 67.00 },
      { id: 9,  date: '2026-03-09', description: 'Starbucks',                category: 'Coffee',        amount: 9.10  },
      { id: 10, date: '2026-03-10', description: 'Walmart groceries',        category: 'Groceries',     amount: 62.40 },
      { id: 11, date: '2026-03-11', description: 'DoorDash — McDonald\'s',   category: 'Dining Out',    amount: 14.30 },
      { id: 12, date: '2026-03-12', description: 'TikTok Shop haul',         category: 'Shopping',      amount: 89.00 },
      { id: 13, date: '2026-03-13', description: 'Starbucks',                category: 'Coffee',        amount: 8.75  },
      { id: 14, date: '2026-03-14', description: 'Concert tickets',          category: 'Entertainment', amount: 95.00 },
      { id: 15, date: '2026-03-15', description: 'Uber Eats — Sushi',        category: 'Dining Out',    amount: 44.50 },
      { id: 16, date: '2026-03-16', description: 'Target run',               category: 'Shopping',      amount: 73.20 },
    ],
    chatHistory: [],
    budgetPlan: {
      summary: 'Your spending is currently $335 over your monthly income — you are accumulating debt every month with no path to savings. Dining out alone consumes 18.6% of your income, and entertainment and shopping are dangerously high. Immediate cuts are needed to stop the financial bleeding before debt becomes unmanageable.',
      financial_score: 18,
      score_label: 'Needs Work',
      score_explanation: 'Monthly spending exceeds income by $335, meaning new debt is accumulating every single month.',
      allocations: [
        { category: 'Housing',        recommended_budget: 950,  current_spending: 950,  percentage_of_income: 33.9, status: 'warning',    tip: 'Housing is above the 30% threshold at 33.9% of income — explore roommates or a cheaper unit.' },
        { category: 'Transportation', recommended_budget: 380,  current_spending: 380,  percentage_of_income: 13.6, status: 'over_budget',tip: 'Car loan at 13.6% of income is crushing your budget — consider refinancing for a lower payment.' },
        { category: 'Utilities',      recommended_budget: 110,  current_spending: 110,  percentage_of_income: 3.9,  status: 'on_track',   tip: 'Turn off lights and unplug devices to trim $15–20/month off your electric bill.' },
        { category: 'Subscriptions',  recommended_budget: 85,   current_spending: 85,   percentage_of_income: 3.0,  status: 'warning',    tip: 'Review all subscriptions — cancel anything you haven\'t used in 30 days.' },
        { category: 'Debt',           recommended_budget: 120,  current_spending: 120,  percentage_of_income: 4.3,  status: 'warning',    tip: 'Only paying the minimum means this debt could take 10+ years to pay off — call your issuer about hardship programs.' },
        { category: 'Groceries',      recommended_budget: 200,  current_spending: 180,  percentage_of_income: 6.4,  status: 'on_track',   tip: 'Groceries are actually reasonable — shift more of dining spending here by cooking at home.' },
        { category: 'Dining Out',     recommended_budget: 100,  current_spending: 520,  percentage_of_income: 18.6, status: 'over_budget',tip: 'Cutting DoorDash from $520 to $100/month is the single biggest change you can make — saves $5,040/year.' },
        { category: 'Coffee',         recommended_budget: 30,   current_spending: 140,  percentage_of_income: 5.0,  status: 'over_budget',tip: 'A $15 bag of coffee beans makes 30 cups at home vs. $8.50 per Starbucks visit — switch today.' },
        { category: 'Entertainment',  recommended_budget: 60,   current_spending: 250,  percentage_of_income: 8.9,  status: 'over_budget',tip: 'Entertainment at $250 is 4x the recommended amount — free events, parks, and streaming can replace expensive outings.' },
        { category: 'Shopping',       recommended_budget: 50,   current_spending: 280,  percentage_of_income: 10.0, status: 'over_budget',tip: 'Shopping impulse buys at $280/month are unaffordable at your income level — delete shopping apps from your phone.' },
        { category: 'Gas / Fuel',     recommended_budget: 120,  current_spending: 120,  percentage_of_income: 4.3,  status: 'on_track',   tip: 'Gas is controlled — use GasBuddy to find the cheapest stations in your area.' },
        { category: 'Savings',        recommended_budget: 0,    current_spending: 0,    percentage_of_income: 0.0,  status: 'over_budget',tip: 'No savings is possible until spending is brought below income — follow the emergency cuts above first.' },
      ],
      savings_plan: {
        monthly_amount: 0,
        percentage_of_income: 0,
        annual_projection: 0,
        '3_year_projection': 0,
        recommendation: 'Get spending below income before targeting savings — cutting dining/coffee/shopping by 60% frees up $735/month.',
      },
      top_tips: [
        'Eliminating DoorDash and cutting dining to $100/month saves $420/month — that alone erases your monthly deficit.',
        'Your credit card minimum of $120/month is barely covering interest — call your issuer about a 0% balance transfer card.',
        'Deleting TikTok Shop and Amazon apps reduces impulse purchases by an average of 40% with zero willpower required.',
      ],
      red_flags: [
        'CRITICAL: You are spending $335 more than you earn every month — debt is growing and compounding.',
        'Dining out at $520/month is 18.6% of income — the maximum healthy threshold is 5–8%.',
        'Shopping at $280/month on a $2,800 income is 10% — this is a major contributor to your deficit.',
      ],
    },
  },

  // ── Getting By ─ Score 55 ──────────────
  'getting-by': {
    income: 5000,
    bills: [
      { name: 'Rent',        category: 'Housing',        amount: 1250 },
      { name: 'Car Payment', category: 'Transportation', amount: 290  },
      { name: 'Internet',    category: 'Utilities',      amount: 65   },
      { name: 'Phone',       category: 'Subscriptions',  amount: 65   },
      { name: 'Streaming',   category: 'Subscriptions',  amount: 30   },
      { name: 'Gym',         category: 'Health/Gym',     amount: 45   },
    ],
    habits: [
      { category: 'Groceries',      estimated: 360,  emoji: '🛒' },
      { category: 'Dining Out',     estimated: 210,  emoji: '🍕' },
      { category: 'Coffee',         estimated: 60,   emoji: '☕' },
      { category: 'Entertainment',  estimated: 95,   emoji: '🎬' },
      { category: 'Gas / Fuel',     estimated: 135,  emoji: '⛽' },
      { category: 'Shopping',       estimated: 105,  emoji: '🛍️' },
      { category: 'Personal Care',  estimated: 55,   emoji: '💄' },
    ],
    expenses: [
      { id: 1,  date: '2026-03-01', description: 'Kroger',             category: 'Groceries',     amount: 94.20 },
      { id: 2,  date: '2026-03-03', description: 'Starbucks',          category: 'Coffee',        amount: 6.50  },
      { id: 3,  date: '2026-03-05', description: 'Chili\'s dinner',    category: 'Dining Out',    amount: 38.40 },
      { id: 4,  date: '2026-03-06', description: 'Shell Gas',          category: 'Gas / Fuel',    amount: 52.10 },
      { id: 5,  date: '2026-03-08', description: 'Costco groceries',   category: 'Groceries',     amount: 71.60 },
      { id: 6,  date: '2026-03-10', description: 'Amazon — shoes',     category: 'Shopping',      amount: 59.99 },
      { id: 7,  date: '2026-03-12', description: 'Movie & popcorn',    category: 'Entertainment', amount: 32.00 },
      { id: 8,  date: '2026-03-13', description: 'Starbucks',          category: 'Coffee',        amount: 7.25  },
      { id: 9,  date: '2026-03-14', description: 'Chipotle lunch',     category: 'Dining Out',    amount: 13.80 },
      { id: 10, date: '2026-03-15', description: 'CVS — toiletries',   category: 'Personal Care', amount: 28.40 },
      { id: 11, date: '2026-03-16', description: 'Trader Joe\'s',      category: 'Groceries',     amount: 55.30 },
    ],
    chatHistory: [],
    budgetPlan: {
      summary: 'You\'re covering your bills and have a small savings buffer, but your savings rate of 5% is well below the recommended 15–20%. Dining and coffee are slightly over target, and there\'s real opportunity to accelerate savings by trimming a few categories without a major lifestyle change.',
      financial_score: 55,
      score_label: 'Fair',
      score_explanation: 'Income covers all expenses with a modest surplus, but savings rate at 5% is too low for long-term financial health.',
      allocations: [
        { category: 'Housing',        recommended_budget: 1250, current_spending: 1250, percentage_of_income: 25.0, status: 'on_track',   tip: 'Housing at 25% is within the healthy range — you\'re doing well here.' },
        { category: 'Transportation', recommended_budget: 290,  current_spending: 290,  percentage_of_income: 5.8,  status: 'on_track',   tip: 'Car payment is manageable — shop insurance annually to save $20–30/month.' },
        { category: 'Utilities',      recommended_budget: 65,   current_spending: 65,   percentage_of_income: 1.3,  status: 'on_track',   tip: 'Internet is reasonable — check if a lower-tier plan still meets your needs.' },
        { category: 'Subscriptions',  recommended_budget: 95,   current_spending: 95,   percentage_of_income: 1.9,  status: 'on_track',   tip: 'Do a quarterly subscription audit — the average person pays for 2–3 they barely use.' },
        { category: 'Health/Gym',     recommended_budget: 45,   current_spending: 45,   percentage_of_income: 0.9,  status: 'on_track',   tip: 'Gym membership is a healthy investment — make sure you\'re using it at least 3x/week.' },
        { category: 'Groceries',      recommended_budget: 340,  current_spending: 360,  percentage_of_income: 7.2,  status: 'warning',    tip: 'Meal planning before each shopping trip can trim $30–40/month here.' },
        { category: 'Dining Out',     recommended_budget: 180,  current_spending: 210,  percentage_of_income: 4.2,  status: 'warning',    tip: 'You\'re $30 over on dining — replacing one restaurant meal per week with cooking saves $360/year.' },
        { category: 'Coffee',         recommended_budget: 40,   current_spending: 60,   percentage_of_income: 1.2,  status: 'warning',    tip: 'Brewing at home 4 days a week cuts this to $25 and saves $420 annually.' },
        { category: 'Entertainment',  recommended_budget: 95,   current_spending: 95,   percentage_of_income: 1.9,  status: 'on_track',   tip: 'Entertainment is on track — look for matinee deals and free community events.' },
        { category: 'Gas / Fuel',     recommended_budget: 135,  current_spending: 135,  percentage_of_income: 2.7,  status: 'on_track',   tip: 'Gas is controlled — use GasBuddy to find the cheapest stations near you.' },
        { category: 'Shopping',       recommended_budget: 90,   current_spending: 105,  percentage_of_income: 2.1,  status: 'warning',    tip: 'Apply a 48-hour rule before non-essential purchases to reduce impulse buys.' },
        { category: 'Personal Care',  recommended_budget: 55,   current_spending: 55,   percentage_of_income: 1.1,  status: 'on_track',   tip: 'Personal care is on budget — buying store-brand products can save $10–15/month.' },
        { category: 'Savings',        recommended_budget: 250,  current_spending: 250,  percentage_of_income: 5.0,  status: 'warning',    tip: 'Increase savings to $500 by trimming dining ($30), coffee ($20), and shopping ($15) — just $65 of cuts doubles your savings.' },
      ],
      savings_plan: {
        monthly_amount: 250,
        percentage_of_income: 5.0,
        annual_projection: 3000,
        '3_year_projection': 9000,
        recommendation: 'Boost savings to $500/month by finding $250 in small cuts — you\'re closer than you think.',
      },
      top_tips: [
        'Three small cuts (dining −$30, coffee −$20, shopping −$15) double your savings from $250 to $515/month.',
        'Opening a high-yield savings account (4.5% APY) earns $135/year on your current $3,000 savings — switch today.',
        'In 3 years at $500/month you\'ll have $18,000 — enough for a full emergency fund and a down payment starter.',
      ],
      red_flags: [],
    },
  },

  // ── Thriving ─ Score 92 ──────────────
  thriving: {
    income: 9500,
    bills: [
      { name: 'Mortgage',         category: 'Housing',        amount: 2200 },
      { name: 'Utilities',        category: 'Utilities',      amount: 130  },
      { name: 'Phone',            category: 'Subscriptions',  amount: 50   },
      { name: 'Car Insurance',    category: 'Insurance',      amount: 95   },
      { name: 'Roth IRA',         category: 'Subscriptions',  amount: 583  },
    ],
    habits: [
      { category: 'Groceries',      estimated: 580,  emoji: '🛒' },
      { category: 'Dining Out',     estimated: 185,  emoji: '🍕' },
      { category: 'Coffee',         estimated: 25,   emoji: '☕' },
      { category: 'Entertainment',  estimated: 90,   emoji: '🎬' },
      { category: 'Gas / Fuel',     estimated: 80,   emoji: '⛽' },
      { category: 'Travel',         estimated: 300,  emoji: '✈️' },
      { category: 'Health/Gym',     estimated: 120,  emoji: '💪' },
    ],
    expenses: [
      { id: 1,  date: '2026-03-01', description: 'Whole Foods — weekly shop',  category: 'Groceries',     amount: 138.60 },
      { id: 2,  date: '2026-03-03', description: 'Coffee beans (home brew)',   category: 'Coffee',        amount: 18.00  },
      { id: 3,  date: '2026-03-05', description: 'Personal trainer session',   category: 'Health/Gym',    amount: 60.00  },
      { id: 4,  date: '2026-03-06', description: 'Costco bulk groceries',      category: 'Groceries',     amount: 142.30 },
      { id: 5,  date: '2026-03-08', description: 'Anniversary dinner',         category: 'Dining Out',    amount: 92.00  },
      { id: 6,  date: '2026-03-09', description: 'Gas — hybrid top-up',        category: 'Gas / Fuel',    amount: 28.40  },
      { id: 7,  date: '2026-03-10', description: 'Flight — summer trip',       category: 'Travel',        amount: 186.00 },
      { id: 8,  date: '2026-03-12', description: 'Whole Foods — weekly shop',  category: 'Groceries',     amount: 127.90 },
      { id: 9,  date: '2026-03-14', description: 'Art museum + dinner',        category: 'Entertainment', amount: 45.00  },
      { id: 10, date: '2026-03-15', description: 'Personal trainer session',   category: 'Health/Gym',    amount: 60.00  },
      { id: 11, date: '2026-03-16', description: 'Farmers market',             category: 'Groceries',     amount: 54.20  },
    ],
    chatHistory: [],
    budgetPlan: {
      summary: 'You\'re in exceptional financial shape — maxing your Roth IRA, building home equity, and still saving $2,200/month on top of investments. Your spending is disciplined, your housing is under 25% of income, and you have zero high-interest debt. Focus now on optimizing your investment allocation and building your taxable brokerage account.',
      financial_score: 92,
      score_label: 'Excellent',
      score_explanation: 'You\'re saving 23% of income, investing consistently, and all spending categories are at or below healthy thresholds.',
      allocations: [
        { category: 'Housing',        recommended_budget: 2200, current_spending: 2200, percentage_of_income: 23.2, status: 'on_track',   tip: 'Mortgage at 23% is excellent — you\'re building equity while staying well under the 28% guideline.' },
        { category: 'Utilities',      recommended_budget: 130,  current_spending: 130,  percentage_of_income: 1.4,  status: 'on_track',   tip: 'Consider a smart thermostat — saves $100–150/year automatically with zero lifestyle impact.' },
        { category: 'Subscriptions',  recommended_budget: 50,   current_spending: 50,   percentage_of_income: 0.5,  status: 'on_track',   tip: 'Phone plan is lean and well-managed — you\'re not wasting money on unused services.' },
        { category: 'Insurance',      recommended_budget: 95,   current_spending: 95,   percentage_of_income: 1.0,  status: 'on_track',   tip: 'Shop car insurance annually — even with excellent credit you may find $20–30/month in savings.' },
        { category: 'Roth IRA',       recommended_budget: 583,  current_spending: 583,  percentage_of_income: 6.1,  status: 'on_track',   tip: 'Maxing your Roth IRA ($7,000/year) is outstanding — this grows tax-free for retirement.' },
        { category: 'Groceries',      recommended_budget: 580,  current_spending: 580,  percentage_of_income: 6.1,  status: 'on_track',   tip: 'Healthy food budget — buying in bulk at Costco and farmers markets is smart and nutritious.' },
        { category: 'Dining Out',     recommended_budget: 190,  current_spending: 185,  percentage_of_income: 1.9,  status: 'on_track',   tip: 'Dining out is intentional and controlled — you\'re treating it as an experience, not a habit.' },
        { category: 'Coffee',         recommended_budget: 30,   current_spending: 25,   percentage_of_income: 0.3,  status: 'on_track',   tip: 'Brewing at home is one of the best small habits — you\'re saving $1,500/year vs. daily café visits.' },
        { category: 'Entertainment',  recommended_budget: 90,   current_spending: 90,   percentage_of_income: 0.9,  status: 'on_track',   tip: 'Entertainment is perfectly balanced — you\'re enjoying life without overspending.' },
        { category: 'Gas / Fuel',     recommended_budget: 80,   current_spending: 80,   percentage_of_income: 0.8,  status: 'on_track',   tip: 'Your hybrid is saving you $60–80/month vs. a standard vehicle — excellent long-term decision.' },
        { category: 'Travel',         recommended_budget: 300,  current_spending: 300,  percentage_of_income: 3.2,  status: 'on_track',   tip: 'Using a travel credit card for all purchases earns free flights — could offset this entire category.' },
        { category: 'Health/Gym',     recommended_budget: 120,  current_spending: 120,  percentage_of_income: 1.3,  status: 'on_track',   tip: 'Investing in your health now pays dividends in lower medical costs and productivity for decades.' },
        { category: 'Savings',        recommended_budget: 2200, current_spending: 2200, percentage_of_income: 23.2, status: 'on_track',   tip: 'At $2,200/month you\'ll build $26,400/year — consider a taxable brokerage for investments beyond your Roth.' },
      ],
      savings_plan: {
        monthly_amount: 2200,
        percentage_of_income: 23.2,
        annual_projection: 26400,
        '3_year_projection': 79200,
        recommendation: 'Open a taxable brokerage and invest in low-cost index funds (VTSAX/VTI) to put this savings to maximum work.',
      },
      top_tips: [
        'Opening a taxable brokerage and investing $2,200/month in index funds at 8% average returns reaches $1M in 17 years.',
        'Your Roth IRA compounding tax-free: at 8% annual growth, your $7,000/year becomes $1.2M by retirement age.',
        'A travel rewards credit card (e.g. Chase Sapphire) used for all purchases earns $400–600/year in free travel at your spend level.',
      ],
      red_flags: [],
    },
  },
};

function loadDemoProfile(name) {
  const profile = DEMO_PROFILES[name];
  if (!profile) return;

  // Deep-clone so mutations don't affect the master profile object
  state = JSON.parse(JSON.stringify(profile));
  if (!state.portfolio) state.portfolio = [];

  // Highlight the active tab
  document.querySelectorAll('.demo-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.profile === name);
  });

  // Destroy existing charts so they redraw cleanly
  if (budgetChart)   { budgetChart.destroy();   budgetChart   = null; }
  if (spendingChart) { spendingChart.destroy();  spendingChart = null; }

  showNavTabs();
  navigate('dashboard');
  renderDashboard();
  populateCatSelect(state.budgetPlan);
}

function closeDemoBanner() {
  document.getElementById('demoBanner').style.display = 'none';
}

// ─── Persistence ──────────────────────
function saveState() {
  try { localStorage.setItem('cca_v1', JSON.stringify(state)); } catch (_) {}
}
function loadState() {
  try {
    const s = localStorage.getItem('cca_v1');
    if (s) state = { ...state, ...JSON.parse(s) };
  } catch (_) {}
}

function resetApp() {
  if (!confirm('Reset all data and start over?')) return;
  localStorage.removeItem('cca_v1');
  localStorage.removeItem('cca_demo');
  localStorage.removeItem('cca_plan');
  window.CCA_PLAN = 'basic';
  document.getElementById('demoBanner').style.display = 'none';
  investChatHistory = [];
  if (compoundChart) { compoundChart.destroy(); compoundChart = null; }
  state = { income:0, bills:[], habits:[], expenses:[], budgetPlan:null, chatHistory:[] };
  if (budgetChart)   { budgetChart.destroy();   budgetChart   = null; }
  if (spendingChart) { spendingChart.destroy();  spendingChart = null; }
  document.getElementById('navTabs').style.visibility = 'hidden';
  document.getElementById('incomeInput').value = '';
  document.getElementById('billsList').innerHTML = '';
  document.getElementById('habitsList').innerHTML = '';
  renderHabitChips();
  // Reset chat
  document.getElementById('chatMessages').innerHTML = `
    <div class="chat-msg ai">
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble"><p>Hi! I'm CashCoachAI, your personal finance advisor. I've reviewed your complete financial profile and I'm ready to help you reach your money goals. What would you like to know?</p></div>
    </div>`;
  showView('setup');
  goToStep(1);
  showToast('App reset');
}

// ─── Navigation ────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
}
function navigate(name) {
  const noAuthRequired = ['setup', 'contact'];
  if (!state.budgetPlan && !noAuthRequired.includes(name)) { showToast('Please complete setup first', 'error'); return; }
  if (name === 'investor' && !document.getElementById('view-investor')) {
    showToast('The Investor Hub requires the Investor plan ($39.99/mo)', 'error');
    return;
  }
  showView(name);
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'tracker')  renderTracker();
  if (name === 'investor') renderInvestorHub();
}
function showNavTabs() {
  const el = document.getElementById('navTabs');
  el.style.visibility = 'visible';
  el.style.display = 'flex';

  // Investor tab is server-rendered only for investor plan — enforce that here too
  const investorTab = document.getElementById('investorNavTab');
  if (investorTab) investorTab.style.display = window.CCA_PLAN === 'investor' ? '' : 'none';

  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'dashboard'));
}

// ─── Steps ─────────────────────────────
function goToStep(n) {
  document.querySelectorAll('.setup-step').forEach(s => s.classList.remove('active'));
  document.getElementById('step-' + n).classList.add('active');
  for (let i = 1; i <= 3; i++) {
    const p = document.getElementById('prog-' + i);
    p.classList.toggle('active', i === n);
    p.classList.toggle('done',   i < n);
  }
  for (let i = 1; i <= 2; i++) {
    document.getElementById('line-' + i).classList.toggle('done', i < n);
  }
}
function nextStep(cur) {
  if (cur === 1) {
    const v = parseFloat(document.getElementById('incomeInput').value);
    if (!v || v <= 0) { showToast('Please enter a valid income', 'error'); return; }
    state.income = v;
    saveState();
    goToStep(2);
  } else if (cur === 2) {
    if (state.bills.length === 0 && !confirm('No bills added. Continue without bills?')) return;
    goToStep(3);
  }
}
function prevStep(cur) { goToStep(cur - 1); }

// ─── Bills ─────────────────────────────
function addBill() {
  const name   = document.getElementById('billName').value.trim();
  const cat    = document.getElementById('billCategory').value;
  const amount = parseFloat(document.getElementById('billAmount').value);
  if (!name || !amount || amount <= 0) { showToast('Fill in all bill fields', 'error'); return; }
  state.bills.push({ name, category: cat, amount });
  saveState();
  renderBillsList();
  document.getElementById('billName').value   = '';
  document.getElementById('billAmount').value = '';
}
function removeBill(i) { state.bills.splice(i, 1); saveState(); renderBillsList(); }
function renderBillsList() {
  const el = document.getElementById('billsList');
  if (!state.bills.length) { el.innerHTML = '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:10px">No bills added yet</p>'; return; }
  el.innerHTML = state.bills.map((b,i) => `
    <div class="item-row">
      <span class="item-name">${emoji(b.category)} ${b.name}</span>
      <span class="item-badge">${b.category}</span>
      <span class="item-amount">$${(+b.amount).toFixed(2)}</span>
      <button class="item-remove" onclick="removeBill(${i})">✕</button>
    </div>`).join('');
}

// ─── Habits ────────────────────────────
function renderHabitChips() {
  document.getElementById('habitsGrid').innerHTML = DEFAULTS.map(h => {
    const sel = state.habits.some(s => s.category === h.category);
    return `<button class="habit-chip${sel?' selected':''}" onclick="toggleHabit('${h.category}',${h.amount},'${h.emoji}',this)">
      ${h.emoji} ${h.category} <span class="chip-amount">~$${h.amount}</span>
    </button>`;
  }).join('');
  renderHabitsList();
}
function toggleHabit(cat, def, em, el) {
  const idx = state.habits.findIndex(h => h.category === cat);
  if (idx >= 0) {
    state.habits.splice(idx, 1);
    el.classList.remove('selected');
  } else {
    const raw = prompt(`Monthly estimate for "${cat}":`, def);
    if (raw === null) return;
    const amt = parseFloat(raw);
    if (isNaN(amt) || amt < 0) return;
    state.habits.push({ category: cat, estimated: amt, emoji: em });
    el.classList.add('selected');
  }
  saveState(); renderHabitsList();
}
function addCustomHabit() {
  const cat = document.getElementById('habitCategory').value.trim();
  const amt = parseFloat(document.getElementById('habitAmount').value);
  if (!cat || !amt || amt <= 0) { showToast('Enter category and amount', 'error'); return; }
  if (state.habits.some(h => h.category === cat)) { showToast('Category already added', 'error'); return; }
  state.habits.push({ category: cat, estimated: amt, emoji: '📦' });
  saveState();
  renderHabitsList();
  document.getElementById('habitCategory').value = '';
  document.getElementById('habitAmount').value   = '';
}
function removeHabit(i) { state.habits.splice(i, 1); saveState(); renderHabitChips(); }
function renderHabitsList() {
  const el = document.getElementById('habitsList');
  if (!state.habits.length) { el.innerHTML = '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:10px">Select habits above or add custom ones</p>'; return; }
  el.innerHTML = state.habits.map((h,i) => `
    <div class="item-row">
      <span class="item-name">${h.emoji||'📦'} ${h.category}</span>
      <span class="item-amount">$${(+h.estimated).toFixed(2)}/mo</span>
      <button class="item-remove" onclick="removeHabit(${i})">✕</button>
    </div>`).join('');
}

// ─── Generate Plan ──────────────────────
async function generatePlan() {
  if (!state.habits.length && !confirm('No spending habits added. Continue anyway?')) return;
  const btn = document.getElementById('generateBtn');
  btn.disabled = true; btn.textContent = '⏳ Generating…';
  showView('loading');
  try {
    const res  = await fetch('/api/generate-plan', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ income: state.income, bills: state.bills, habits: state.habits })
    });
    const plan = await res.json();
    if (plan.error) throw new Error(plan.error);
    state.budgetPlan = plan;
    saveState();
    showNavTabs();
    navigate('dashboard');
    renderDashboard();
  } catch (err) {
    showView('setup'); goToStep(3);
    showToast('Error: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '✨ Generate My Plan';
  }
}

// ─── Dashboard ─────────────────────────
function renderDashboard() {
  const p = state.budgetPlan;
  if (!p) return;

  // Score
  document.getElementById('scoreNumber').textContent = p.financial_score;
  document.getElementById('scoreLabel').textContent  = p.score_label;
  document.getElementById('dashTitle').textContent   = p.score_label + ' Financial Plan';
  document.getElementById('planSummary').textContent = p.summary;

  // Score circle color
  const sc = document.getElementById('scoreCircle');
  const s  = p.financial_score;
  sc.style.borderColor = s >= 75 ? 'rgba(255,255,255,.55)' : s >= 50 ? 'rgba(253,224,71,.6)' : 'rgba(248,113,113,.6)';

  // Red flags
  const rf = document.getElementById('redFlags');
  rf.innerHTML = (p.red_flags||[]).filter(Boolean).map(f => `<div class="red-flag">⚠️ ${f}</div>`).join('');

  // Stats
  const totalBills    = state.bills.reduce((s,b)=>s+(+b.amount),0);
  const totalVariable = state.habits.reduce((s,h)=>s+(+h.estimated),0);
  document.getElementById('statIncome').textContent   = '$' + state.income.toLocaleString();
  document.getElementById('statBills').textContent    = '$' + totalBills.toLocaleString();
  document.getElementById('statVariable').textContent = '$' + totalVariable.toLocaleString();
  document.getElementById('statSavings').textContent  = p.savings_plan ? '$' + p.savings_plan.monthly_amount.toLocaleString() : '—';

  renderBudgetChart(p);
  renderSavingsPlan(p);
  renderBudgetTable(p);
  renderTips(p);
  populateCatSelect(p);
}

function renderBudgetChart(p) {
  if (budgetChart) { budgetChart.destroy(); budgetChart = null; }
  const ctx    = document.getElementById('budgetChart').getContext('2d');
  const allocs = p.allocations || [];
  const COLS   = ['#059669','#0d9488','#0284c7','#7c3aed','#db2777','#d97706','#65a30d','#0891b2','#4f46e5','#be185d','#c2410c'];
  budgetChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: allocs.map(a => a.category),
      datasets: [{ data: allocs.map(a => a.recommended_budget), backgroundColor: COLS, borderWidth: 3, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: true, cutout: '62%',
      plugins: {
        legend: { position: 'right', labels: { font:{family:'Inter',size:12}, padding:10, boxWidth:12,
          generateLabels: chart => chart.data.labels.map((lbl,i) => ({
            text: `${lbl}  $${chart.data.datasets[0].data[i].toLocaleString()}`,
            fillStyle: chart.data.datasets[0].backgroundColor[i], index: i,
          }))
        }},
        tooltip: { callbacks: { label: ctx => {
          const total = ctx.dataset.data.reduce((a,b)=>a+b,0);
          return ` $${ctx.parsed.toLocaleString()} (${((ctx.parsed/total)*100).toFixed(1)}%)`;
        }}}
      }
    }
  });
}

function renderSavingsPlan(p) {
  const sp = p.savings_plan;
  if (!sp) { document.getElementById('savingsPlan').innerHTML = '<p style="color:var(--text-3);padding:24px">No savings data.</p>'; return; }
  document.getElementById('savingsPlan').innerHTML = `
    <div class="savings-big">$${sp.monthly_amount.toLocaleString()}</div>
    <div class="savings-sub">per month · ${sp.percentage_of_income}% of income</div>
    <div class="proj-row"><span class="proj-label">📅 Annual savings</span><span class="proj-value">$${sp.annual_projection.toLocaleString()}</span></div>
    <div class="proj-row"><span class="proj-label">📈 3-year projection</span><span class="proj-value">$${(sp['3_year_projection']||sp.annual_projection*3).toLocaleString()}</span></div>
    <div class="savings-tip">${sp.recommendation}</div>`;
}

function renderBudgetTable(p) {
  document.getElementById('budgetTableBody').innerHTML = (p.allocations||[]).map(a => {
    const cls   = a.status==='on_track'?'badge-good': a.status==='warning'?'badge-warn':'badge-over';
    const label = a.status==='on_track'?'✓ On Track': a.status==='warning'?'⚠ Watch':'✗ Over';
    return `<tr>
      <td><strong>${emoji(a.category)} ${a.category}</strong></td>
      <td><strong>$${(+a.recommended_budget).toLocaleString()}</strong></td>
      <td>$${(+a.current_spending).toLocaleString()}</td>
      <td>${a.percentage_of_income}%</td>
      <td><span class="badge ${cls}">${label}</span></td>
      <td class="tip-cell">${a.tip}</td>
    </tr>`;
  }).join('');
}

function renderTips(p) {
  document.getElementById('tipsGrid').innerHTML = (p.top_tips||[]).map((t,i) => `
    <div class="tip-card">
      <div class="tip-num">Tip ${i+1}</div>
      <div class="tip-text">${t}</div>
    </div>`).join('');
}

function populateCatSelect(p) {
  const sel = document.getElementById('expenseCat');
  sel.innerHTML = '<option value="">Category…</option>' +
    (p.allocations||[]).map(a => `<option value="${a.category}">${emoji(a.category)} ${a.category}</option>`).join('');
}

// ─── Tracker ───────────────────────────
function addExpense() {
  const date   = document.getElementById('expenseDate').value;
  const desc   = document.getElementById('expenseDesc').value.trim();
  const cat    = document.getElementById('expenseCat').value;
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  if (!date || !desc || !cat || !amount || amount <= 0) { showToast('Fill in all fields', 'error'); return; }
  state.expenses.push({ id: Date.now(), date, description: desc, category: cat, amount });
  saveState();
  document.getElementById('expenseDesc').value   = '';
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseCat').value    = '';
  renderTracker();
  showToast('Expense added!', 'success');
}
function deleteExpense(id) { state.expenses = state.expenses.filter(e => e.id !== id); saveState(); renderTracker(); }
function clearExpenses()   { if (!confirm('Delete all expenses?')) return; state.expenses = []; saveState(); renderTracker(); }

function renderTracker() {
  const now   = new Date();
  const month = now.getMonth();
  const year  = now.getFullYear();
  document.getElementById('monthLabel').textContent = now.toLocaleString('default',{month:'long',year:'numeric'});

  const thisMonth = state.expenses.filter(e => { const d=new Date(e.date+'T12:00:00'); return d.getMonth()===month && d.getFullYear()===year; });
  const byCat     = {};
  thisMonth.forEach(e => byCat[e.category] = (byCat[e.category]||0) + e.amount);

  renderProgressBars(byCat);
  renderSpendingChart(byCat);
  renderTransactions();
}

function renderProgressBars(byCat) {
  const el = document.getElementById('progressBars');
  const p  = state.budgetPlan;
  if (!p) { el.innerHTML = '<p class="empty-state">Complete setup first.</p>'; return; }
  const rows = (p.allocations||[]).map(a => {
    const spent  = byCat[a.category] || 0;
    const budget = +a.recommended_budget;
    const pct    = budget > 0 ? Math.min((spent/budget)*100, 100) : (spent>0?100:0);
    const cls    = pct >= 100 ? 'prog-over' : pct >= 80 ? 'prog-warn' : 'prog-good';
    return `<div class="prog-item">
      <div class="prog-head">
        <span class="prog-cat">${emoji(a.category)} ${a.category}</span>
        <span class="prog-amt"><span class="prog-spent">$${spent.toFixed(2)}</span> / $${budget.toFixed(2)}</span>
      </div>
      <div class="prog-bg"><div class="prog-fill ${cls}" style="width:${pct}%"></div></div>
    </div>`;
  });
  el.innerHTML = rows.join('') || '<p class="empty-state">No categories yet.</p>';
}

function renderSpendingChart(byCat) {
  if (spendingChart) { spendingChart.destroy(); spendingChart = null; }
  const cats = Object.keys(byCat);
  if (!cats.length) { return; }
  const COLS = ['#059669','#0d9488','#0284c7','#7c3aed','#db2777','#d97706','#65a30d','#0891b2'];
  spendingChart = new Chart(document.getElementById('spendingChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: cats,
      datasets: [{
        label:'Spent ($)', data: cats.map(c=>byCat[c]),
        backgroundColor: COLS, borderRadius: 6,
      }]
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins: { legend:{display:false}, tooltip:{callbacks:{label:c=>` $${c.parsed.y.toFixed(2)}`}} },
      scales: {
        y:{ beginAtZero:true, ticks:{callback:v=>'$'+v}, grid:{color:'#e2e8f0'} },
        x:{ grid:{display:false} }
      }
    }
  });
}

function renderTransactions() {
  const el  = document.getElementById('transactionsList');
  if (!state.expenses.length) { el.innerHTML = '<div class="empty-state">No expenses yet. Start tracking above!</div>'; return; }
  const sorted = [...state.expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
  el.innerHTML = sorted.slice(0,60).map(e => `
    <div class="txn-item">
      <div class="txn-icon">${emoji(e.category)}</div>
      <div class="txn-info">
        <div class="txn-desc">${e.description}</div>
        <div class="txn-meta">${e.category} · ${fmtDate(e.date)}</div>
      </div>
      <div class="txn-amount">-$${(+e.amount).toFixed(2)}</div>
      <button class="txn-del" onclick="deleteExpense(${e.id})">✕</button>
    </div>`).join('');
}

// ─── Advisor ───────────────────────────
function getCtx() {
  return {
    income:        state.income,
    totalBills:    state.bills.reduce((s,b)=>s+(+b.amount),0),
    totalVariable: state.habits.reduce((s,h)=>s+(+h.estimated),0),
    score:         state.budgetPlan?.financial_score,
    billsSummary:  state.bills.map(b=>`${b.name}($${b.amount})`).join(', ') || 'none',
    habitsSummary: state.habits.map(h=>`${h.category}($${h.estimated})`).join(', ') || 'none',
  };
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  input.value = '';
  input.style.height = 'auto';

  appendMsg('user', msg);
  state.chatHistory.push({ role: 'user', content: msg });

  const typingId = addTyping();

  try {
    const res = await fetch('/api/chat', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ messages: state.chatHistory, context: getCtx() })
    });
    document.getElementById(typingId)?.remove();

    const msgEl      = appendMsg('ai', '');
    const bubbleText = msgEl.querySelector('.msg-bubble p');

    let full = '';
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try {
          const d = JSON.parse(raw);
          if (d.text) { full += d.text; bubbleText.textContent = full; scrollChat(); }
        } catch (_) {}
      }
    }
    state.chatHistory.push({ role:'assistant', content: full });
    saveState();
  } catch (err) {
    document.getElementById(typingId)?.remove();
    appendMsg('ai', 'Sorry, something went wrong. Please try again.');
    showToast('Connection error', 'error');
  }
  btn.disabled = false;
}

function sendSuggested(el) {
  document.getElementById('chatInput').value = el.textContent.trim();
  sendMessage();
}
function handleChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  setTimeout(() => {
    const t = document.getElementById('chatInput');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }, 0);
}
function appendMsg(role, text) {
  const c = document.getElementById('chatMessages');
  const d = document.createElement('div');
  d.className = 'chat-msg ' + role;
  d.innerHTML = `
    <div class="msg-avatar">${role==='ai'?'🤖':'👤'}</div>
    <div class="msg-bubble"><p>${text}</p></div>`;
  c.appendChild(d);
  scrollChat();
  return d;
}
function addTyping() {
  const c  = document.getElementById('chatMessages');
  const id = 'typ-' + Date.now();
  const d  = document.createElement('div');
  d.className = 'chat-msg ai'; d.id = id;
  d.innerHTML = `<div class="msg-avatar">🤖</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  c.appendChild(d); scrollChat(); return id;
}
function scrollChat() {
  const c = document.getElementById('chatMessages');
  c.scrollTop = c.scrollHeight;
}

// ─── Investor Hub ──────────────────────

const EDU_CARDS = [
  { icon: '🏦', title: 'Emergency Fund First',        body: 'Before investing, build 3–6 months of expenses in a high-yield savings account. This prevents you from selling investments at a loss in a crisis.' },
  { icon: '📈', title: 'The Power of Compound Interest', body: '$200/month at 8% annual return becomes $298,000 in 30 years — but only $72,000 of that is money you put in. The rest is compounding.' },
  { icon: '🎯', title: 'Index Funds Explained',       body: 'Index funds like VTI or VTSAX track the entire market. They beat 90% of actively managed funds over 20 years, with near-zero fees.' },
  { icon: '💡', title: 'Dollar-Cost Averaging',       body: 'Invest the same amount every month regardless of price. You buy more shares when prices are low and fewer when high — reducing average cost over time.' },
  { icon: '🏛️', title: 'Tax-Advantaged Accounts',    body: 'Max your Roth IRA ($7,000/yr) and 401k ($23,000/yr) before a taxable brokerage. Tax-free or tax-deferred growth is the single biggest legal advantage in investing.' },
  { icon: '📊', title: 'Asset Allocation Basics',     body: 'A simple 3-fund portfolio: US stocks (60%), international stocks (30%), bonds (10%). Adjust bond % to your age for appropriate risk.' },
];

function renderInvestorHub() {
  renderEducation();
  fetchMarketNews();
  renderPortfolio();
  updateCalc();
}

// ── Education ─────────────────────────
function renderEducation() {
  document.getElementById('eduGrid').innerHTML = EDU_CARDS.map(c => `
    <div class="edu-card">
      <div class="edu-icon">${c.icon}</div>
      <div class="edu-content">
        <div class="edu-title">${c.title}</div>
        <div class="edu-body">${c.body}</div>
      </div>
    </div>`).join('');
}

// ── Market News ───────────────────────
async function fetchMarketNews() {
  const el = document.getElementById('marketNewsList');
  el.innerHTML = '<div class="news-loading">Loading latest news…</div>';
  try {
    const res  = await fetch('/api/market-news');
    const data = await res.json();
    if (!data.items.length) {
      el.innerHTML = '<div class="news-empty">Could not load news at this time.</div>';
      return;
    }
    el.innerHTML = data.items.map(item => `
      <a class="news-item" href="${item.link}" target="_blank" rel="noopener">
        <div class="news-title">${item.title}</div>
        ${item.description ? `<div class="news-desc">${item.description}</div>` : ''}
        <div class="news-date">${item.date ? fmtNewsDate(item.date) : ''}</div>
      </a>`).join('');
  } catch (_) {
    el.innerHTML = '<div class="news-empty">Could not load news. Check your connection.</div>';
  }
}

function fmtNewsDate(str) {
  try { return new Date(str).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
  catch (_) { return str; }
}

// ── Portfolio Tracker ─────────────────
async function addStock() {
  const symbolEl    = document.getElementById('stockSymbol');
  const sharesEl    = document.getElementById('stockShares');
  const buyPriceEl  = document.getElementById('stockBuyPrice');
  const symbol      = symbolEl.value.trim().toUpperCase();
  const shares      = parseFloat(sharesEl.value);
  const buyPrice    = parseFloat(buyPriceEl.value);

  if (!symbol || !shares || shares <= 0 || !buyPrice || buyPrice <= 0) {
    showToast('Fill in all stock fields', 'error'); return;
  }
  if (state.portfolio.some(s => s.symbol === symbol)) {
    showToast(`${symbol} already in portfolio`, 'error'); return;
  }

  // Fetch current price
  showToast(`Fetching ${symbol}…`);
  try {
    const res  = await fetch(`/api/stock-price?symbol=${encodeURIComponent(symbol)}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    state.portfolio.push({
      symbol,
      shares,
      buyPrice,
      currentPrice: data.price,
      change:       data.change,
      changePct:    data.change_pct,
      name:         data.name,
    });
    saveState();
    symbolEl.value = ''; sharesEl.value = ''; buyPriceEl.value = '';
    renderPortfolio();
    showToast(`${symbol} added!`, 'success');
  } catch (err) {
    showToast(err.message || `Could not find ${symbol}`, 'error');
  }
}

function removeStock(symbol) {
  state.portfolio = state.portfolio.filter(s => s.symbol !== symbol);
  saveState();
  renderPortfolio();
}

async function refreshPortfolioPrices() {
  if (!state.portfolio.length) return;
  showToast('Refreshing prices…');
  for (const holding of state.portfolio) {
    try {
      const res  = await fetch(`/api/stock-price?symbol=${encodeURIComponent(holding.symbol)}`);
      const data = await res.json();
      if (!data.error) {
        holding.currentPrice = data.price;
        holding.change       = data.change;
        holding.changePct    = data.change_pct;
        holding.name         = data.name;
      }
    } catch (_) {}
  }
  saveState();
  renderPortfolio();
  showToast('Prices updated!', 'success');
}

function renderPortfolio() {
  const el = document.getElementById('portfolioTable');
  if (!state.portfolio.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px">No holdings yet. Add a ticker above.</div>';
    document.getElementById('portfolioTotalLabel').textContent = '';
    return;
  }

  let totalValue = 0, totalCost = 0;
  state.portfolio.forEach(h => {
    totalValue += (h.currentPrice || h.buyPrice) * h.shares;
    totalCost  += h.buyPrice * h.shares;
  });
  const totalGain    = totalValue - totalCost;
  const totalGainPct = totalCost > 0 ? (totalGain / totalCost * 100) : 0;
  const gainCls      = totalGain >= 0 ? 'port-gain' : 'port-loss';

  document.getElementById('portfolioTotalLabel').innerHTML =
    `Total: <strong>$${totalValue.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong>
     <span class="${gainCls}">(${totalGain >= 0 ? '+' : ''}$${Math.abs(totalGain).toFixed(2)} / ${totalGainPct >= 0?'+':''}${totalGainPct.toFixed(1)}%)</span>`;

  el.innerHTML = `
    <div class="table-scroll">
      <table class="budget-table">
        <thead>
          <tr>
            <th>Ticker</th><th>Shares</th><th>Buy Price</th>
            <th>Current</th><th>Day Change</th><th>Value</th><th>Gain / Loss</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${state.portfolio.map(h => {
            const curr    = h.currentPrice || h.buyPrice;
            const value   = curr * h.shares;
            const gain    = (curr - h.buyPrice) * h.shares;
            const gainPct = h.buyPrice > 0 ? ((curr - h.buyPrice) / h.buyPrice * 100) : 0;
            const dayCls  = h.change >= 0 ? 'port-gain' : 'port-loss';
            const gainCls = gain >= 0 ? 'port-gain' : 'port-loss';
            return `<tr>
              <td><strong>${h.symbol}</strong><br><span style="font-size:11px;color:var(--text-3)">${h.name||''}</span></td>
              <td>${h.shares}</td>
              <td>$${h.buyPrice.toFixed(2)}</td>
              <td>$${curr.toFixed(2)}</td>
              <td class="${dayCls}">${h.change >= 0?'+':''}$${(h.change||0).toFixed(2)} (${h.changePct>=0?'+':''}${(h.changePct||0).toFixed(2)}%)</td>
              <td><strong>$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></td>
              <td class="${gainCls}">${gain >= 0?'+':''}$${Math.abs(gain).toFixed(2)} (${gainPct>=0?'+':''}${gainPct.toFixed(1)}%)</td>
              <td><button class="txn-del" onclick="removeStock('${h.symbol}')">✕</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Compound Calculator ───────────────
function updateCalc() {
  const initial  = parseFloat(document.getElementById('calcInitial').value)  || 0;
  const monthly  = parseFloat(document.getElementById('calcMonthly').value)  || 0;
  const rate     = parseFloat(document.getElementById('calcRate').value)      || 0;
  const years    = parseInt(document.getElementById('calcYears').value)       || 1;

  const r       = rate / 100 / 12;   // monthly rate
  const n       = years * 12;        // total months
  const labels  = [];
  const values  = [];
  const invested= [];

  for (let yr = 0; yr <= years; yr++) {
    const m   = yr * 12;
    const fv  = r > 0
      ? initial * Math.pow(1 + r, m) + monthly * ((Math.pow(1 + r, m) - 1) / r)
      : initial + monthly * m;
    labels.push(yr === 0 ? 'Now' : `Yr ${yr}`);
    values.push(parseFloat(fv.toFixed(2)));
    invested.push(parseFloat((initial + monthly * m).toFixed(2)));
  }

  const totalValue    = values[values.length - 1];
  const totalInvested = invested[invested.length - 1];
  const totalGains    = totalValue - totalInvested;

  const fmt = n => '$' + Math.round(n).toLocaleString();
  document.getElementById('calcTotal').textContent    = fmt(totalValue);
  document.getElementById('calcInvested').textContent = fmt(totalInvested);
  document.getElementById('calcGains').textContent    = fmt(totalGains);

  renderCompoundChart(labels, values, invested);
}

function renderCompoundChart(labels, values, invested) {
  if (compoundChart) { compoundChart.destroy(); compoundChart = null; }
  const ctx = document.getElementById('compoundChart').getContext('2d');
  compoundChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Value',
          data: values,
          borderColor: '#059669',
          backgroundColor: 'rgba(5,150,105,.12)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: 'Amount Invested',
          data: invested,
          borderColor: '#94a3b8',
          backgroundColor: 'transparent',
          borderDash: [5, 4],
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 1.5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { family: 'Inter', size: 12 }, boxWidth: 14 } },
        tooltip: {
          callbacks: {
            label: ctx => ` $${Math.round(ctx.parsed.y).toLocaleString()}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(0)+'k' : v) },
          grid: { color: '#e2e8f0' },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

// ── Investing Chat ────────────────────
function getInvestCtx() {
  const sp = state.budgetPlan?.savings_plan;
  return {
    income:         state.income,
    totalBills:     state.bills.reduce((s, b) => s + (+b.amount), 0),
    totalVariable:  state.habits.reduce((s, h) => s + (+h.estimated), 0),
    savingsMonthly: sp?.monthly_amount || 0,
    score:          state.budgetPlan?.financial_score,
  };
}

async function sendInvestMessage() {
  const input = document.getElementById('investChatInput');
  const msg   = input.value.trim();
  if (!msg) return;
  const btn = document.getElementById('investSendBtn');
  btn.disabled = true;
  input.value  = '';
  input.style.height = 'auto';

  appendInvestMsg('user', msg);
  investChatHistory.push({ role: 'user', content: msg });

  const typingId = addInvestTyping();

  try {
    const res = await fetch('/api/investing-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: investChatHistory, context: getInvestCtx() }),
    });
    document.getElementById(typingId)?.remove();

    const msgEl  = appendInvestMsg('ai', '');
    const bubble = msgEl.querySelector('.msg-bubble p');
    let full = '';
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') break;
        try {
          const d = JSON.parse(raw);
          if (d.text) { full += d.text; bubble.textContent = full; scrollInvestChat(); }
        } catch (_) {}
      }
    }
    investChatHistory.push({ role: 'assistant', content: full });
  } catch (_) {
    document.getElementById(typingId)?.remove();
    appendInvestMsg('ai', 'Sorry, something went wrong. Please try again.');
  }
  btn.disabled = false;
}

function sendInvestSuggested(el) {
  document.getElementById('investChatInput').value = el.textContent.trim();
  sendInvestMessage();
}
function handleInvestChatKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendInvestMessage(); }
  setTimeout(() => {
    const t = document.getElementById('investChatInput');
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }, 0);
}
function appendInvestMsg(role, text) {
  const c = document.getElementById('investChatMessages');
  const d = document.createElement('div');
  d.className = 'chat-msg ' + role;
  d.innerHTML = `<div class="msg-avatar">${role === 'ai' ? '📈' : '👤'}</div><div class="msg-bubble"><p>${text}</p></div>`;
  c.appendChild(d);
  scrollInvestChat();
  return d;
}
function addInvestTyping() {
  const c  = document.getElementById('investChatMessages');
  const id = 'ityp-' + Date.now();
  const d  = document.createElement('div');
  d.className = 'chat-msg ai'; d.id = id;
  d.innerHTML = `<div class="msg-avatar">📈</div><div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  c.appendChild(d); scrollInvestChat(); return id;
}
function scrollInvestChat() {
  const c = document.getElementById('investChatMessages');
  c.scrollTop = c.scrollHeight;
}

// ─── Contact ───────────────────────────
async function submitContact() {
  const name    = document.getElementById('contactName').value.trim();
  const email   = document.getElementById('contactEmail').value.trim();
  const message = document.getElementById('contactMessage').value.trim();
  const btn     = document.getElementById('contactSubmitBtn');
  const status  = document.getElementById('contactStatus');

  if (!name || !email || !message) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Sending…';
  status.textContent = '';
  status.className   = 'contact-status';

  try {
    const res  = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message }),
    });
    const data = await res.json();

    if (data.error) throw new Error(data.error);

    status.textContent = '✓ Message sent! We\'ll get back to you soon.';
    status.classList.add('contact-success');
    document.getElementById('contactName').value    = '';
    document.getElementById('contactEmail').value   = '';
    document.getElementById('contactMessage').value = '';
  } catch (err) {
    status.textContent = err.message || 'Failed to send. Please try again.';
    status.classList.add('contact-error');
  }

  btn.disabled    = false;
  btn.textContent = 'Send Message';
}

// ─── Utilities ─────────────────────────
function fmtDate(s) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}
function showToast(msg, type='') {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
