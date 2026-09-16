'use strict';
/* Financial Trajectory Slice 1 — Forecast-owned baselineTrajectory.
 *
 * Monthly cash+debt picture over the incumbent knowledgeHorizon.
 * weeklyVariable from planned Household Budget / budgetBreakdown, not
 * historical actuals and not Forecast.recommend. 2027 income regimes
 * are unavailable, not $0. Controlled fixtures; independent month list,
 * planned-weekly identity, cash walk, and debt walk — not a second call
 * of the producing helper as the only proof.
 * `node test/test-baseline-trajectory.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const liveHash = hashFile(DATA);
const START = '2026-06-15';
const CALENDAR_MONTH_DAYS = 365.25 / 12;
const WEEKS_PER_MONTH = CALENDAR_MONTH_DAYS / 7;

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function roundCent(n) {
  return Math.round(n * 100) / 100;
}

// Independent of Forecast: calendar months that intersect [start, end].
function monthsIntersecting(start, end) {
  const months = [];
  let [y, m] = start.split('-').map(Number);
  const [endY, endM] = end.split('-').map(Number);
  while (y < endY || (y === endY && m <= endM)) {
    const last = daysInMonth(y, m);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    months.push({
      month: `${y}-${String(m).padStart(2, '0')}`,
      year: y,
      start: start > monthStart ? start : monthStart,
      end: end < monthEnd ? end : monthEnd,
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return months;
}

function periodsFixture(extraSpending) {
  return {
    periods: {
      ytd: {
        label: 'YTD fixture',
        months: 1,
        spending: [
          { label: 'Groceries', total: 50000 },
          { label: 'Travel', total: 18000 },
          { label: 'Fuel & transport', total: 9000 },
        ].concat(extraSpending || []),
      },
    },
  };
}

function fixture(extraPlan, extraDebts) {
  const plan = Object.assign({
    windowDays: 91,
    startingCash: { amount: 2500 },
    defaults: { targetBuffer: 200, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: START },
    budget: {
      basis: 'ytd',
      categories: [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedWeekly: 140,
        },
        {
          id: 'travel', label: 'Travel', class: 'discretionary',
          from: ['Travel'],
        },
      ],
    },
    income: [
      {
        id: 'payroll', label: 'Synthetic payroll',
        frequency: 'biweekly', anchor: '2026-06-12',
        amount: 2000, confidence: 'estimated',
      },
    ],
    obligations: [
      {
        id: 'card-min', debtId: 'card', effect: 'payment',
        label: 'Card minimum', frequency: 'monthly', day: 20,
        amount: 80, confidence: 'confirmed',
      },
    ],
    bills: [],
    commitments: [],
  }, extraPlan || {});
  const debts = extraDebts || [
    {
      id: 'card', label: 'Synthetic card',
      balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
      structure: 'Revolving — synthetic', secured: false, limit: 1500,
    },
  ];
  return { plan, debts };
}

function ask(plan, debts, extraOpts) {
  return F.baselineTrajectory(plan, debts, START, Object.assign({
    periods: periodsFixture(),
  }, extraOpts || {}));
}

console.log('=== 1. Forecast is the sole calculator ===');
{
  const src = read('public/forecast.js');
  ok(/function baselineTrajectory\(/.test(src),
    'Forecast.baselineTrajectory is defined in public/forecast.js');
  const body = src.slice(src.indexOf('function plannedWeeklyVariable('),
    src.indexOf('const Forecast = {'));
  ok(/knowledgeHorizon\(/.test(body) && /budgetBreakdown\(/.test(body),
    'the boundary composes knowledgeHorizon and budgetBreakdown');
  ok(/simulate\(/.test(body) && /projectDebts\(/.test(body),
    'the boundary composes simulate and projectDebts');
  ok(!/recommend\(/.test(body) && !/recommendWeekly\(/.test(body),
    'the boundary does not search Forecast.recommend for a weekly cap');
  ok(/historical-actual/.test(body) && /source === 'historical-actual'/.test(body),
    'planned weeklyVariable skips historical-actual categories');
  ok(/2027 payroll\/bonus is unmodelled/.test(body),
    '2027 payroll/bonus is named unmodelled rather than zeroed');
  ok(!/KNOWLEDGE_MIN_DAYS\s*=\s*548/.test(src) && /KNOWLEDGE_MIN_DAYS\s*=\s*365/.test(src),
    'knowledgeHorizon minimum remains the incumbent ~12-month 365 days');
}

console.log('\n=== 2. Monthly series length matches knowledgeHorizon ===');
{
  const { plan, debts } = fixture();
  const horizon = F.knowledgeHorizon(plan, START);
  const expected = monthsIntersecting(horizon.start, horizon.end);
  const traj = ask(plan, debts);
  ok(traj.status === 'ready', 'trajectory is ready on a planned-budget fixture');
  ok(traj.horizon.days === horizon.days && traj.horizon.end === horizon.end,
    'published horizon equals the incumbent knowledgeHorizon',
    `${traj.horizon.days} days through ${traj.horizon.end}`);
  ok(Array.isArray(traj.months) && traj.months.length === expected.length,
    'month count equals calendar months intersecting the horizon',
    `${(traj.months || []).length} vs ${expected.length}`);
  const keys = (traj.months || []).map(m => m.month).join(',');
  const expectKeys = expected.map(m => m.month).join(',');
  ok(keys === expectKeys, 'month keys match the independent horizon list', keys);
  ok(horizon.days === 365, 'fixture with no later commitments stays at 365 days');
  ok(expected[0].month === '2026-06' && expected[expected.length - 1].month === '2027-06',
    'series spans the incumbent ~12-month window, not an 18-month rewrite');
}

console.log('\n=== 3. weeklyVariable is planned, not historical ===');
{
  const { plan, debts } = fixture();
  const bd = F.budgetBreakdown(plan, periodsFixture());
  const groceries = bd.categories.find(c => c.id === 'groceries');
  const travel = bd.categories.find(c => c.id === 'travel');
  ok(groceries && groceries.source === 'owner-target' && groceries.planned > 0,
    'groceries planned is the owner weekly target after budgetBreakdown');
  ok(travel && travel.source === 'historical-actual' && travel.historical > 1000,
    'travel historical is large so a historical leak would be visible',
    `historical ${travel.historical}`);
  const plannedMonthly = bd.categories
    .filter(c => c.class !== 'reserve' && c.source !== 'historical-actual')
    .reduce((s, c) => s + (c.planned || 0), 0);
  const expectedWeekly = roundCent(plannedMonthly / WEEKS_PER_MONTH);
  const traj = ask(plan, debts);
  ok(near(traj.weeklyVariable.amount, expectedWeekly),
    'weeklyVariable equals independently summed planned remainder / calendar weeks',
    `${traj.weeklyVariable.amount} vs ${expectedWeekly}`);
  ok(near(traj.weeklyVariable.amount, 140),
    'owner $140/week planned survives the month↔week identity',
    String(traj.weeklyVariable.amount));
  ok(traj.weeklyVariable.historicalActuals === 'excluded',
    'published weeklyVariable declares historical actuals excluded');
  ok(!near(traj.weeklyVariable.amount, travel.historical / WEEKS_PER_MONTH, 1),
    'weeklyVariable is not the historical travel average');
  ok(!near(traj.weeklyVariable.amount, groceries.historical / WEEKS_PER_MONTH, 1),
    'weeklyVariable is not the historical grocery average');
  const advice = F.recommend(plan, START, {
    debts,
    extraDebtMonthly: 0,
    targetBuffer: 200,
  });
  ok(advice && typeof advice.weekly === 'number',
    'recommend still answers a feasible weekly cap beside the trajectory');
  ok(traj.provenance.recommendWeeklyCap === 'not-used',
    'trajectory provenance says the recommend weekly cap was not used');
  ok(traj.months.every(m => m.spend && m.spend.source === 'budgetBreakdown.planned'),
    'every month reprints the planned weeklyVariable source');
}

console.log('\n=== 4. Unmodelled 2027 regimes are unavailable, not $0 ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  const jan = traj.months.find(m => m.month === '2027-01');
  const jun = traj.months.find(m => m.month === '2026-06');
  ok(!!jan && !!jun, 'series includes a 2026 modelled month and a 2027 month');
  ok(jun.income.status === 'estimated' && typeof jun.income.amount === 'number',
    '2026 income is published from the modelled streams',
    `${jun.income.status} ${jun.income.amount}`);
  ok(jun.income.amount !== 0, 'modelled 2026 income is not silently zero');
  ok(jan.income.status === 'unavailable',
    '2027 income is unavailable');
  ok(!Object.prototype.hasOwnProperty.call(jan.income, 'amount')
    || jan.income.amount == null,
    'unavailable 2027 income omits an amount rather than publishing $0');
  ok(jan.income.amount !== 0, 'unavailable 2027 income is not the number 0');
  const continuing = F.expandEvents(plan, '2027-01-01', '2027-01-31')
    .filter(e => e.kind === 'income')
    .reduce((s, e) => s + e.amount, 0);
  ok(continuing > 0, 'expandEvents would still emit 2027 payroll if asked',
    String(continuing));
  ok(jan.income.amount !== continuing,
    '2027 income is not the continuing 2026 net carried forward');
  ok(jan.cash.status === 'unavailable',
    '2027 cash is unavailable because it would depend on unmodelled income');
  ok(!Object.prototype.hasOwnProperty.call(jan.cash, 'amount')
    || jan.cash.amount == null,
    'unavailable 2027 cash omits an amount rather than publishing $0');
  const payrollRegime = traj.incomeRegimes.find(r => r.id === '2027-payroll-bonus');
  const datedRegime = traj.incomeRegimes.find(r => r.id === '2027-dated-income-regimes');
  ok(payrollRegime && payrollRegime.status === 'unavailable',
    '2027 payroll/bonus regime is named unavailable');
  ok(datedRegime && datedRegime.status === 'unavailable',
    'dated 2027 income regimes are named unavailable rather than implemented');
  ok(!/4%/.test(read('public/forecast.js').slice(
    read('public/forecast.js').indexOf('function baselineTrajectory('),
    read('public/forecast.js').indexOf('const Forecast = {')))
    || /later outcome/.test(datedRegime.reason),
    'the function names the later dated-regime outcome instead of implementing it');
}

console.log('\n=== 5. Coupled debts — independent month-end walk ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  const jun = traj.months.find(m => m.month === '2026-06');
  ok(jun.debt.status === 'calculated' && Array.isArray(jun.debt.debts),
    '2026 month publishes a calculated coupled debt picture');
  const published = jun.debt.debts.find(d => d.id === 'card');
  ok(!!published, 'named card is on the month-end debt picture');

  const opening = 600;
  const rate = 19.99;
  let balance = opening;
  let interest = 0;
  let paid = 0;
  const days = Math.round((Date.parse(jun.end + 'T00:00:00Z')
    - Date.parse(START + 'T00:00:00Z')) / 86400000) + 1;
  for (let i = 0; i < days; i++) {
    const date = addDays(START, i);
    const daily = balance * (rate / 100) / 365;
    balance += daily;
    interest += daily;
    if (date.slice(8) === '20') {
      const take = Math.min(80, balance);
      balance -= take;
      paid += take;
    }
  }
  ok(near(published.balance, balance),
    'month-end card balance matches an independent daily interest+minimum walk',
    `${published.balance} vs ${roundCent(balance)}`);
  ok(near(published.interest, interest),
    'month-end card interest matches the independent walk',
    `${published.interest} vs ${roundCent(interest)}`);
  ok(near(published.paid, paid),
    'month-end card paid matches the independent walk',
    `${published.paid} vs ${roundCent(paid)}`);
}

console.log('\n=== 6. Modelled cash — independent daily walk ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  const jun = traj.months.find(m => m.month === '2026-06');
  ok(jun.cash.status === 'calculated' && typeof jun.cash.amount === 'number',
    '2026 cash is calculated');
  const weekly = traj.weeklyVariable.amount;
  const dailyVariable = weekly / 7;
  const events = F.expandEvents(plan, START, jun.end);
  const byDate = new Map();
  for (const e of events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  let cash = 2500;
  const days = Math.round((Date.parse(jun.end + 'T00:00:00Z')
    - Date.parse(START + 'T00:00:00Z')) / 86400000) + 1;
  for (let i = 0; i < days; i++) {
    const date = addDays(START, i);
    const todays = (byDate.get(date) || []).slice().sort((a, b) =>
      (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
    for (const e of todays) {
      if (e.kind === 'noncash') continue;
      cash += e.amount;
    }
    cash -= dailyVariable;
  }
  ok(near(jun.cash.amount, cash),
    'month-end cash matches an independent income − obligation − planned-weekly walk',
    `${jun.cash.amount} vs ${roundCent(cash)}`);
}

console.log('\n=== 7. Fail-closed and non-goals ===');
{
  ok(F.baselineTrajectory(null, [], START, { periods: periodsFixture() }).status
    === 'unavailable', 'missing plan is unavailable');
  const { plan, debts } = fixture();
  ok(F.baselineTrajectory(plan, debts, START, {}).status === 'unavailable',
    'missing periods/breakdown is unavailable, not a $0 weekly walk');
  const src = [
    read('public/plan.js'),
    read('public/talk.js'),
    read('scripts/assistant-packet.js'),
    read('scripts/talk-hypothetical.js'),
  ].join('\n');
  ok(!/baselineTrajectory/.test(src),
    'no page, Talk, or assistant packet consumes baselineTrajectory');
  ok(trajHasNoRank(ask(plan, debts)),
    'ranking / recommendation / affordability stay null');
}

function trajHasNoRank(traj) {
  return traj.recommendation == null && traj.ranking == null && traj.affordability == null
    && traj.provenance.ranking == null && traj.provenance.recommendation == null
    && traj.provenance.affordability == null;
}

console.log('\n=== 8. Live household document is unread for cents and unwritten ===');
{
  const live = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));
  const asOf = live.plan.opening.asOf;
  const horizon = F.knowledgeHorizon(live.plan, asOf);
  const expected = monthsIntersecting(horizon.start, horizon.end);
  const traj = F.baselineTrajectory(live.plan, live.debts, asOf, { periods });
  ok(traj.status === 'ready', 'live plan produces a ready trajectory without a page');
  ok(traj.months.length === expected.length,
    'live month count still matches knowledgeHorizon',
    `${traj.months.length} vs ${expected.length}`);
  const unmodelled = traj.months.filter(m => m.month >= '2027-01');
  ok(unmodelled.length > 0 && unmodelled.every(m =>
    m.income.status === 'unavailable' && m.cash.status === 'unavailable'),
    'live 2027 months stay unavailable for income and cash');
  ok(traj.weeklyVariable.historicalActuals === 'excluded',
    'live weeklyVariable still excludes historical actuals');
  ok(hashFile(DATA) === liveHash, 'data.json was not written');
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} baseline-trajectory check(s)`);
  process.exit(1);
}
console.log('ALL BASELINE TRAJECTORY CHECKS PASSED');
