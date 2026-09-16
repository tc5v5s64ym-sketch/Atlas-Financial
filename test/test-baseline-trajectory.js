'use strict';
/* Financial Trajectory Slice 1+2 — Forecast-owned baselineTrajectory.
 *
 * Monthly cash+debt picture over the incumbent knowledgeHorizon.
 * weeklyVariable from planned Household Budget / budgetBreakdown, not
 * historical actuals and not Forecast.recommend. Named dated income-regime
 * split: modelled Dale net through 2026-12-31; Dale payroll/bonus from
 * 2027-01-01 unavailable (deposit-year CPP/EI reset), not $0 and not the
 * expandEvents-carried 2026 post-CPP/EI-max net. Trajectory-local cutoff
 * only. Controlled fixtures; independent month list, planned-weekly
 * identity, cash walk, debt walk, and expandEvents Dale sum — not a
 * second call of the producing helper as the only proof.
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
    src.indexOf('function hypotheticalExtraPayment('));
  ok(/knowledgeHorizon\(/.test(body) && /budgetBreakdown\(/.test(body),
    'the boundary composes knowledgeHorizon and budgetBreakdown');
  ok(/simulate\(/.test(body) && /projectDebts\(/.test(body),
    'the boundary composes simulate and projectDebts');
  ok(!/recommend\(/.test(body) && !/recommendWeekly\(/.test(body),
    'the boundary does not search Forecast.recommend for a weekly cap');
  ok(/historical-actual/.test(body) && /source === 'historical-actual'/.test(body),
    'planned weeklyVariable skips historical-actual categories');
  ok(/isDalePayrollStream\(/.test(body),
    'trajectory uses isDalePayrollStream rather than a year blanket');
  ok(/2027-01-01/.test(body) && /deposit-year CPP\/EI reset/.test(body),
    'trajectory names the 2027-01-01 deposit-year CPP/EI reset cutoff');
  ok(!/span\.year\s*>=\s*2027/.test(body) && !/year\s*>=\s*2027/.test(src),
    'year≥2027 blanket is gone');
  ok(/incomeRegimesImplemented:\s*false/.test(body),
    'incomeRegimesImplemented stays false until a 2027 Dale net model exists');
  ok(!/ownerPlanningNotes/.test(body) && !/appliedDollars/.test(body),
    'runtime trajectory does not hard-code owner planning notes');
  ok(!/4% raise/.test(body) && !/Amanda salary unchanged/.test(body)
    && !/calendar 2027 Seaspan/.test(body),
    'owner 4% / Amanda-flat / effective-date facts are omitted from runtime output');
  const expandBody = src.slice(src.indexOf('function expandEvents('),
    src.indexOf('\n  function simulate('));
  ok(!/2027-01-01/.test(expandBody) && !/year\s*>=\s*2027/.test(expandBody),
    'expandEvents is not year-stopped');
  const recommendBody = src.slice(src.indexOf('function recommend('),
    src.indexOf('\n  function incomeDeadline('));
  ok(!/2027-01-01/.test(recommendBody) && !/year\s*>=\s*2027/.test(recommendBody),
    'Forecast.recommend is not year-stopped');
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

console.log('\n=== 4. Named dated split — 2026 modelled, 2027 Dale unavailable ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  const jan = traj.months.find(m => m.month === '2027-01');
  const jun = traj.months.find(m => m.month === '2026-06');
  const dec = traj.months.find(m => m.month === '2026-12');
  ok(!!jan && !!jun && !!dec, 'series includes 2026 modelled months and a 2027 month');
  ok(jun.income.status === 'estimated' && typeof jun.income.amount === 'number',
    '2026 income is published from the modelled streams',
    `${jun.income.status} ${jun.income.amount}`);
  ok(jun.income.amount !== 0, 'modelled 2026 income is not silently zero');
  ok(jun.income.dalePayroll && jun.income.dalePayroll.status === 'modelled'
    && jun.income.dalePayroll.through === '2026-12-31',
    'June 2026 Dale payroll marker is modelled through 2026-12-31');
  ok(dec.income.status === 'estimated' && typeof dec.income.amount === 'number',
    'December 2026 income stays modelled on the dated split',
    `${dec.income.status} ${dec.income.amount}`);
  ok(dec.income.dalePayroll && dec.income.dalePayroll.status === 'modelled',
    'December 2026 Dale net is modelled, not year-stopped');
  ok(jan.income.status === 'unavailable',
    'January 2027 Dale-containing income is unavailable');
  ok(jan.income.dalePayroll && jan.income.dalePayroll.status === 'unavailable'
    && jan.income.dalePayroll.from === '2027-01-01'
    && jan.income.dalePayroll.boundary === 'deposit-year-cpp-ei-reset',
    'January 2027 names the deposit-year CPP/EI reset, not a year blanket');
  ok(!Object.prototype.hasOwnProperty.call(jan.income, 'amount')
    || jan.income.amount == null,
    'unavailable 2027 income omits an amount rather than publishing $0');
  ok(jan.income.amount !== 0, 'unavailable 2027 income is not the number 0');

  const janDaleEvents = F.expandEvents(plan, '2027-01-01', '2027-01-31')
    .filter(e => e.kind === 'income' && e.id === 'payroll');
  const continuingDale = janDaleEvents.reduce((s, e) => s + e.amount, 0);
  ok(janDaleEvents.length > 0 && continuingDale > 0,
    'expandEvents would still emit 2027 Dale payroll if asked',
    `${janDaleEvents.length} events summing ${continuingDale}`);
  ok(jan.income.amount !== continuingDale,
    'published trajectory does not use the expandEvents 2027 Dale sum');

  const decDale = F.expandEvents(plan, '2026-12-01', '2026-12-31')
    .filter(e => e.kind === 'income' && e.id === 'payroll')
    .reduce((s, e) => s + e.amount, 0);
  ok(decDale > 0 && near(dec.income.amount, decDale),
    'December 2026 published income matches independent expandEvents Dale sum',
    `${dec.income.amount} vs ${decDale}`);

  ok(jan.cash.status === 'unavailable',
    '2027 cash is unavailable until a modelled 2027 Dale net exists');
  ok(!Object.prototype.hasOwnProperty.call(jan.cash, 'amount')
    || jan.cash.amount == null,
    'unavailable 2027 cash omits an amount rather than publishing $0');

  const modelled = traj.incomeRegimes.find(r => r.id === 'current-modelled-dale-net');
  const payrollRegime = traj.incomeRegimes.find(r => r.id === '2027-payroll-bonus');
  const datedRegime = traj.incomeRegimes.find(r => r.id === '2027-dated-income-regimes');
  ok(modelled && modelled.status === 'modelled' && modelled.through === '2026-12-31',
    'current modelled Dale net is named through 2026-12-31');
  ok(payrollRegime && payrollRegime.status === 'unavailable'
    && payrollRegime.from === '2027-01-01'
    && payrollRegime.boundary === 'deposit-year-cpp-ei-reset',
    '2027 payroll/bonus regime is named unavailable from 2027-01-01');
  ok(datedRegime && datedRegime.status === 'unavailable',
    'dated 2027 income regimes stay unavailable rather than dollar-implemented');
  ok(!datedRegime.ownerPlanningNotes,
    'dated-regime marker omits owner planning notes until canonical plan data contains them');
  ok(traj.incomeRegimes.every(r => !r.ownerPlanningNotes),
    'no incomeRegime row publishes hard-coded owner planning notes');
  ok(!/4%/.test(JSON.stringify(traj.incomeRegimes))
    && !/Amanda salary unchanged/.test(JSON.stringify(traj))
    && !/calendar 2027 Seaspan/.test(JSON.stringify(traj)),
    'published trajectory does not carry 4% / Amanda-flat / calendar-2027 effective-date facts');
  ok(traj.provenance.incomeRegimesImplemented === false,
    'incomeRegimesImplemented remains false — named/fail-closed, not dollar-implemented');
  ok(traj.provenance.incomeRegimesNamedFailClosed === true
    && traj.provenance.incomeRegimesDollarModel === false,
    'provenance says regimes are named/fail-closed but not dollar-implemented');
  ok(traj.provenance.expandEvents2027DaleIncome === 'not-published',
    'provenance says expandEvents 2027 Dale income is not published');

  const trajBody = read('public/forecast.js').slice(
    read('public/forecast.js').indexOf('function baselineTrajectory('),
    read('public/forecast.js').indexOf('function hypotheticalExtraPayment('));
  ok(!/\*\s*1\.04|\*\s*0\.04/.test(trajBody) && !/ownerPlanningNotes/.test(trajBody),
    'trajectory does not multiply a raise into a net or store owner planning notes');
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
  const talkSrc = [
    read('public/talk.js'),
    read('scripts/talk-hypothetical.js'),
  ].join('\n');
  ok(!/baselineTrajectory/.test(talkSrc),
    'Talk does not consume baselineTrajectory');
  const packetSrc = read('scripts/assistant-packet.js');
  ok(/Forecast\.baselineTrajectory\(/.test(packetSrc),
    'assistant packet calls Forecast.baselineTrajectory');
  const trajPacketCode = (packetSrc.split('function projectBaselineTrajectory(')[1] || '')
    .split('function forecastAdvice(')[0];
  ok(!/Forecast\.simulate\(|Forecast\.projectDebts\(|Forecast\.expandEvents\(/.test(trajPacketCode),
    'assistant packet trajectory block does not re-walk cash or debt');
  const planningSrc = read('public/planning.js');
  ok(/Forecast\.baselineTrajectory\(/.test(planningSrc),
    'Planning page calls Forecast.baselineTrajectory and does not re-walk cash or debt');
  ok(!/Forecast\.simulate\(|Forecast\.projectDebts\(|Forecast\.expandEvents\(/.test(planningSrc),
    'Planning page does not call simulate, projectDebts, or expandEvents for trajectory');
  ok(trajHasNoRank(ask(plan, debts)),
    'ranking / recommendation / affordability stay null');
}

function trajHasNoRank(traj) {
  return traj.recommendation == null && traj.ranking == null && traj.affordability == null
    && traj.provenance.ranking == null && traj.provenance.recommendation == null
    && traj.provenance.affordability == null;
}

console.log('\n=== 8. Dated split is Dale-specific, not a year blanket ===');
{
  const amandaOnly = fixture({
    income: [
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        frequency: 'monthly', day: 15, amount: 2000, confidence: 'confirmed',
      },
    ],
  });
  const amandaTraj = ask(amandaOnly.plan, amandaOnly.debts);
  const amandaJan = amandaTraj.months.find(m => m.month === '2027-01');
  ok(!!amandaJan, 'Amanda-only series still includes January 2027');
  ok(amandaJan.income.status === 'calculated' && amandaJan.income.amount === 2000,
    '2027 Amanda income is still published — the cutoff is Dale payroll, not year≥2027',
    `${amandaJan.income.status} ${amandaJan.income.amount}`);
  ok(amandaJan.income.dalePayroll && amandaJan.income.dalePayroll.status === 'not-applicable',
    'Amanda-only 2027 month does not pretend Dale payroll was modelled');
  ok(amandaJan.cash.status === 'calculated' && typeof amandaJan.cash.amount === 'number',
    'Amanda-only 2027 cash stays calculated because no unmodelled Dale net entered the walk');

  const otherBonusPlan = fixture({
    income: [
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        frequency: 'monthly', day: 15, amount: 2000, confidence: 'confirmed',
      },
      {
        id: 'bonus', label: 'Annual bonus',
        frequency: 'once', date: '2027-02-25', amount: 9999, confidence: 'estimated',
      },
    ],
  });
  const otherBonusEvents = F.expandEvents(otherBonusPlan.plan, '2027-02-01', '2027-02-28')
    .filter(e => e.kind === 'income');
  const otherBonusSum = otherBonusEvents.reduce((s, e) => s + e.amount, 0);
  ok(otherBonusEvents.some(e => e.id === 'bonus') && otherBonusSum === 11999,
    'expandEvents would still emit a 2027 other bonus if asked', String(otherBonusSum));
  const otherBonusTraj = ask(otherBonusPlan.plan, otherBonusPlan.debts);
  const otherFeb = otherBonusTraj.months.find(m => m.month === '2027-02');
  ok(otherFeb && otherFeb.income.status !== 'unavailable'
    && near(otherFeb.income.amount, otherBonusSum),
    'Amanda/other 2027 bonus stays modelled — bonus is not Dale-owned without Seaspan signals',
    `${otherFeb && otherFeb.income.status} ${otherFeb && otherFeb.income.amount}`);
  ok(otherFeb.cash.status === 'calculated' && typeof otherFeb.cash.amount === 'number',
    'cash stays calculated when no Dale income is withheld');

  const amandaBonusPlan = fixture({
    income: [
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        frequency: 'monthly', day: 15, amount: 2000, confidence: 'confirmed',
      },
      {
        id: 'amandaBonus', label: 'Amanda bonus — Tennis BC',
        frequency: 'once', date: '2027-02-25', amount: 500, confidence: 'confirmed',
      },
    ],
  });
  const amandaBonusTraj = ask(amandaBonusPlan.plan, amandaBonusPlan.debts);
  const amandaFeb = amandaBonusTraj.months.find(m => m.month === '2027-02');
  const amandaBonusSum = F.expandEvents(amandaBonusPlan.plan, '2027-02-01', '2027-02-28')
    .filter(e => e.kind === 'income')
    .reduce((s, e) => s + e.amount, 0);
  ok(amandaFeb && amandaFeb.income.status === 'calculated'
    && near(amandaFeb.income.amount, amandaBonusSum) && amandaBonusSum === 2500,
    'Amanda-labelled 2027 bonus stays modelled',
    `${amandaFeb && amandaFeb.income.status} ${amandaFeb && amandaFeb.income.amount}`);
  ok(amandaFeb.cash.status === 'calculated',
    'Amanda bonus does not make 2027 cash unavailable');

  const daleBonusPlan = fixture({
    income: [
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        frequency: 'monthly', day: 15, amount: 2000, confidence: 'confirmed',
      },
      {
        id: 'bonus', label: 'Seaspan bonus',
        frequency: 'once', date: '2027-02-25', amount: 9999, confidence: 'estimated',
      },
    ],
  });
  const daleBonusEvents = F.expandEvents(daleBonusPlan.plan, '2027-02-01', '2027-02-28')
    .filter(e => e.kind === 'income' && e.id === 'bonus');
  const daleBonusSum = daleBonusEvents.reduce((s, e) => s + e.amount, 0);
  ok(daleBonusEvents.length === 1 && daleBonusSum === 9999,
    'expandEvents would still emit a 2027 Dale/Seaspan bonus if asked', String(daleBonusSum));
  const daleBonusTraj = ask(daleBonusPlan.plan, daleBonusPlan.debts);
  const daleJan = daleBonusTraj.months.find(m => m.month === '2027-01');
  const daleFeb = daleBonusTraj.months.find(m => m.month === '2027-02');
  ok(daleJan && daleJan.income.status === 'calculated' && daleJan.income.amount === 2000
    && daleJan.cash.status === 'calculated',
    'January 2027 stays modelled before the Dale bonus date — cash unavailable only when Dale income is withheld');
  ok(daleFeb && daleFeb.income.status === 'unavailable',
    'Dale/Seaspan 2027 bonus month is unavailable rather than publishing the expandEvents bonus');
  ok(daleFeb.income.amount !== 9999 && daleFeb.income.amount !== daleBonusSum
    && daleFeb.income.amount !== 11999,
    'published February 2027 income is not the expandEvents Dale bonus sum');
  ok(daleFeb.cash.status === 'unavailable',
    'cash after withheld Dale/Seaspan bonus is unavailable, not a carried 2026 net');
}

console.log('\n=== 9. Live household document is unread for cents and unwritten ===');
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
    m.income.status === 'unavailable' && m.cash.status === 'unavailable'
    && m.income.dalePayroll && m.income.dalePayroll.status === 'unavailable'
    && m.income.dalePayroll.from === '2027-01-01'),
    'live 2027 months stay unavailable for Dale income and cash');
  const liveDec = traj.months.find(m => m.month === '2026-12');
  ok(liveDec && liveDec.income.status !== 'unavailable'
    && liveDec.income.dalePayroll && liveDec.income.dalePayroll.status === 'modelled',
    'live December 2026 Dale net stays modelled');
  ok(traj.provenance.incomeRegimesImplemented === false,
    'live provenance keeps incomeRegimesImplemented false');
  ok(traj.weeklyVariable.historicalActuals === 'excluded',
    'live weeklyVariable still excludes historical actuals');
  ok(hashFile(DATA) === liveHash, 'data.json was not written');
}

console.log('\n=== 10. Assistant packet reprints the Planning trajectory surface ===');
{
  const Assistant = require('../scripts/assistant-packet.js');
  const { buildFiguresSnapshot } = require('../scripts/figures-snapshot.js');
  const live = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));
  const asOf = live.meta.asOf;
  const traj = F.baselineTrajectory(live.plan, live.debts, asOf, {
    periods,
    extraFacilities: live.revolvingExtra,
  });
  const packet = Assistant.buildPacket({
    data: live,
    periods,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const projected = packet.planning && packet.planning.trajectory;
  ok(projected && projected.status === 'ready'
    && projected.source === 'Forecast.baselineTrajectory',
    'packet planning.trajectory is ready from Forecast.baselineTrajectory');
  ok(projected.asOf === traj.asOf, 'packet trajectory asOf matches Forecast');
  ok(projected.horizonEnd === traj.horizon.end, 'packet horizonEnd matches Forecast');
  ok(near(projected.weeklyVariable, roundCent(traj.weeklyVariable.amount)),
    'packet weeklyVariable matches Forecast planned weekly');
  ok(Array.isArray(projected.months) && projected.months.length === traj.months.length,
    'packet publishes every horizon month');
  const snap = buildFiguresSnapshot(live, periods);
  ok(snap['planning.trajectory.status'] === 'ready',
    'figures snapshot planning.trajectory.status is ready');
  for (const month of traj.months) {
    const packetMonth = projected.months.find(row => row.month === month.month);
    ok(packetMonth, `packet includes month ${month.month}`);
    const p = `planning.trajectory.${month.month}`;
    ok(packetMonth.income.status === month.income.status,
      `${month.month} packet income.status matches Forecast`);
    ok(snap[`${p}.income.status`] === month.income.status,
      `${month.month} snapshot income.status matches Forecast`);
    ok(packetMonth.cash.status === month.cash.status,
      `${month.month} packet cash.status matches Forecast`);
    if (month.income.amount != null) {
      ok(near(packetMonth.income.amount, roundCent(month.income.amount)),
        `${month.month} packet income.amount matches Forecast`);
      ok(snap[`${p}.income.amount`] === undefined
        || near(snap[`${p}.income.amount`], roundCent(month.income.amount)),
        `${month.month} snapshot income.amount matches Forecast when present`);
    } else {
      ok(packetMonth.income.amount == null,
        `${month.month} unavailable income omits amount in packet`);
      ok(snap[`${p}.income.amount`] === undefined,
        `${month.month} unavailable income omits amount in snapshot`);
    }
    if (month.debt && month.debt.status === 'calculated') {
      ok(near(packetMonth.debt.secured, roundCent(month.debt.secured)),
        `${month.month} packet debt.secured matches Forecast`);
      ok(near(packetMonth.debt.heloc, roundCent(month.debt.heloc)),
        `${month.month} packet debt.heloc matches Forecast`);
      ok(snap[`${p}.debt.secured`] === undefined
        || near(snap[`${p}.debt.secured`], roundCent(month.debt.secured)),
        `${month.month} snapshot secured debt matches when published`);
    }
    if (month.start) {
      ok(packetMonth.periodStart === month.start,
        `${month.month} periodStart matches Forecast`);
      ok(snap[`${p}.periodStart`] === month.start,
        `${month.month} snapshot periodStart matches Forecast`);
    }
  }
  ok(Assistant.looksSanitized(packet),
    'trajectory projection stays within assistant sanitization rules');
  ok(hashFile(DATA) === liveHash, 'packet trajectory test did not write data.json');
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} baseline-trajectory check(s)`);
  process.exit(1);
}
console.log('ALL BASELINE TRAJECTORY CHECKS PASSED');
