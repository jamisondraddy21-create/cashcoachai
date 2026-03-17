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

let budgetChart   = null;
let spendingChart = null;

// ─── Init ──────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Handle subscription token from Stripe redirect (?token=...)
  const params   = new URLSearchParams(window.location.search);
  const urlToken = params.get('token');
  if (urlToken) {
    localStorage.setItem('cca_sub_token', urlToken);
    window.history.replaceState({}, document.title, '/');
  }

  // Verify subscription before showing the app
  const allowed = await checkSubscription();
  if (!allowed) return;   // redirected to /subscribe

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
  // Demo mode: bypass subscription check, load sample data
  if (localStorage.getItem('cca_demo') === '1') {
    loadDemoState();
    return true;
  }

  try {
    const token = localStorage.getItem('cca_sub_token') || '';
    const res   = await fetch(`/api/check-subscription?token=${encodeURIComponent(token)}`);
    const data  = await res.json();

    if (data.dev_mode) return true;   // Stripe not configured — dev mode

    if (!data.active) {
      window.location.href = '/subscribe';
      return false;
    }
    return true;
  } catch (_) {
    // Network error — allow through rather than block the user
    return true;
  }
}

// ─── Demo Mode ─────────────────────────
function loadDemoState() {
  document.getElementById('demoBanner').style.display = 'flex';

  state = {
    income: 5200,
    bills: [
      { name: 'Rent',          category: 'Housing',        amount: 1400 },
      { name: 'Car Payment',   category: 'Transportation', amount: 350  },
      { name: 'Internet',      category: 'Utilities',      amount: 60   },
      { name: 'Phone Plan',    category: 'Subscriptions',  amount: 80   },
      { name: 'Car Insurance', category: 'Insurance',      amount: 120  },
    ],
    habits: [
      { category: 'Groceries',     estimated: 380, emoji: '🛒' },
      { category: 'Dining Out',    estimated: 280, emoji: '🍕' },
      { category: 'Coffee',        estimated: 55,  emoji: '☕' },
      { category: 'Entertainment', estimated: 90,  emoji: '🎬' },
      { category: 'Gas / Fuel',    estimated: 160, emoji: '⛽' },
      { category: 'Shopping',      estimated: 120, emoji: '🛍️' },
    ],
    expenses: [
      { id: 1,  date: '2026-03-01', description: 'Whole Foods',      category: 'Groceries',     amount: 87.43 },
      { id: 2,  date: '2026-03-03', description: 'Chipotle',         category: 'Dining Out',    amount: 14.50 },
      { id: 3,  date: '2026-03-05', description: 'Starbucks',        category: 'Coffee',        amount: 6.75  },
      { id: 4,  date: '2026-03-07', description: 'Shell Gas',        category: 'Gas / Fuel',    amount: 48.20 },
      { id: 5,  date: '2026-03-10', description: "Trader Joe's",     category: 'Groceries',     amount: 64.30 },
      { id: 6,  date: '2026-03-12', description: 'Amazon',           category: 'Shopping',      amount: 34.99 },
      { id: 7,  date: '2026-03-14', description: 'Olive Garden',     category: 'Dining Out',    amount: 42.80 },
      { id: 8,  date: '2026-03-16', description: 'Movie Tickets',    category: 'Entertainment', amount: 28.00 },
    ],
    chatHistory: [],
    budgetPlan: {
      summary: 'You have a solid foundation with your $5,200 monthly income, but dining out and shopping are running over budget. Trimming those two categories alone could free up $80–100/month for savings.',
      financial_score: 68,
      score_label: 'Good',
      score_explanation: 'Your income covers all expenses with a small surplus, but savings rate could be stronger.',
      allocations: [
        { category: 'Housing',        recommended_budget: 1400, current_spending: 1400, percentage_of_income: 26.9, status: 'on_track',   tip: 'Housing is within the recommended 30% threshold — great job keeping rent manageable.' },
        { category: 'Transportation', recommended_budget: 350,  current_spending: 350,  percentage_of_income: 6.7,  status: 'on_track',   tip: 'Consider carpooling once a week to shave $20–30 off monthly gas spend.' },
        { category: 'Utilities',      recommended_budget: 60,   current_spending: 60,   percentage_of_income: 1.2,  status: 'on_track',   tip: 'Utilities are well-controlled — look for bundle deals to save further.' },
        { category: 'Subscriptions',  recommended_budget: 80,   current_spending: 80,   percentage_of_income: 1.5,  status: 'on_track',   tip: 'Audit subscriptions quarterly — the average household pays for 3 they rarely use.' },
        { category: 'Insurance',      recommended_budget: 120,  current_spending: 120,  percentage_of_income: 2.3,  status: 'on_track',   tip: 'Shop competing car insurance quotes annually — you could save $20–40/month.' },
        { category: 'Groceries',      recommended_budget: 350,  current_spending: 380,  percentage_of_income: 7.3,  status: 'warning',    tip: 'Meal planning and a grocery list could cut this by $30–50 per month.' },
        { category: 'Dining Out',     recommended_budget: 200,  current_spending: 280,  percentage_of_income: 5.4,  status: 'over_budget',tip: 'Cook two extra meals at home per week — this gets you to $200 and saves $960/year.' },
        { category: 'Coffee',         recommended_budget: 40,   current_spending: 55,   percentage_of_income: 1.1,  status: 'warning',    tip: 'Brewing at home 3 days a week saves ~$180 annually.' },
        { category: 'Entertainment',  recommended_budget: 90,   current_spending: 90,   percentage_of_income: 1.7,  status: 'on_track',   tip: 'Look for free local events to stretch your entertainment dollar.' },
        { category: 'Gas / Fuel',     recommended_budget: 160,  current_spending: 160,  percentage_of_income: 3.1,  status: 'on_track',   tip: 'Use GasBuddy to find the cheapest gas nearby and save $10–15/month.' },
        { category: 'Shopping',       recommended_budget: 100,  current_spending: 120,  percentage_of_income: 2.3,  status: 'warning',    tip: 'Apply a 24-hour rule before purchases — reduces impulse buys by ~30%.' },
        { category: 'Savings',        recommended_budget: 500,  current_spending: 0,    percentage_of_income: 9.6,  status: 'warning',    tip: 'Automate $500 to savings the day your paycheck arrives — out of sight, out of mind.' },
      ],
      savings_plan: {
        monthly_amount: 500,
        percentage_of_income: 9.6,
        annual_projection: 6000,
        '3_year_projection': 18000,
        recommendation: 'Set up an automatic transfer of $500 to a high-yield savings account on payday.',
      },
      top_tips: [
        'Cutting dining out from $280 to $200/month saves $960/year — enough for a vacation.',
        'Shopping car insurance annually could save $240–480/year on your $120/month plan.',
        'Automating $500/month to savings grows to $18,000 in 3 years — a full emergency fund.',
      ],
      red_flags: [],
    },
  };
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
  document.getElementById('demoBanner').style.display = 'none';
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
  showView(name);
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
  if (name === 'tracker') renderTracker();
}
function showNavTabs() {
  const el = document.getElementById('navTabs');
  el.style.visibility = 'visible';
  el.style.display = 'flex';
  // activate dashboard tab
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
