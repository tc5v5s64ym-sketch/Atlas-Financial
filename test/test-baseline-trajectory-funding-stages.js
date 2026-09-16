'use strict';
/* Financial Trajectory — three-stage selected-period funding on
 * Forecast.baselineTrajectory calendar months.
 *
 * Independent of the publishing helper: expandEvents sums by kind plus
 * Household Budget = walk-applied weeklyVariable / 7 for each simulate
 * day in the published month. Stage 3 extras are
 * plan.defaults.extraDebtMonthly / absorbed kind:'extra' only.
 * `node test/test-baseline-trajectory-funding-stages.js`
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
const JUL = '2026-07';

function roundCent(n) {
  return Math.round(n * 100) / 100;
}

function periodsFixture() {
  return {
    periods: {
      ytd: {
        label: 'YTD fixture',
        months: 1,
        spending: [
          { label: 'Groceries', total: 50000 },
          { label: 'Travel', total: 18000 },
          { label: 'Phone', total: 9000 },
        ],
      },
    },
  };
}

function fixture(extraPlan, extraDebts) {
  const plan = Object.assign({
    windowDays: 91,
    startingCash: { amount: 2500 },
    defaults: { targetBuffer: 200, extraDebtMonthly: 75, scenario: 'expected' },
    opening: { asOf: START },
    nextDollar: {
      policy: 'true-surplus-highest-interest',
      provenance: 'owner-stated',
    },
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
        {
          id: 'telecom-undated', label: 'Undated telecom', class: 'essential',
          from: ['Phone'], currentMonthly: 400,
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
    bills: [
      {
        id: 'hydro', label: 'Hydro', frequency: 'monthly', day: 5,
        amount: 120, confidence: 'confirmed',
      },
      {
        id: 'card-stream', label: 'Card-paid stream', frequency: 'monthly', day: 8,
        amount: 50, jointCash: false, confidence: 'confirmed',
      },
    ],
    commitments: [
      {
        id: 'camp', label: 'Required camp', date: '2026-07-10',
        amount: 400, flexibility: 'required', confidence: 'confirmed',
      },
      {
        id: 'optional-trip', label: 'Optional trip', date: '2026-07-12',
        amount: 999, flexibility: 'optional', confidence: 'confirmed',
      },
    ],
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

function ask(plan, debts) {
  return F.baselineTrajectory(plan, debts, START, { periods: periodsFixture() });
}

function independentWeekly(plan) {
  const bd = F.budgetBreakdown(plan, periodsFixture(), { asOf: START });
  const plannedMonthly = (bd.categories || [])
    .filter(c => c && c.class !== 'reserve' && c.source !== 'historical-actual')
    .reduce((s, c) => s + (Number(c.planned) || 0), 0);
  return roundCent(plannedMonthly / WEEKS_PER_MONTH);
}

function independentWalkEvents(plan, debts) {
  const weekly = independentWeekly(plan);
  const horizon = F.knowledgeHorizon(plan, START);
  const extraDebtMonthly = (plan.defaults && plan.defaults.extraDebtMonthly) || 0;
  const debtWalk = F.projectDebts(plan, debts, START, {
    weeklyVariable: weekly,
    extraDebtMonthly,
    debtHorizonDays: horizon.days,
    periods: periodsFixture(),
  });
  const events = F.expandEvents(plan, horizon.start, horizon.end, {
    weeklyVariable: weekly,
    extraDebtMonthly,
    extraAbsorbed: debtWalk && debtWalk.extraAbsorbed,
    obligationAbsorbed: debtWalk && debtWalk.obligationAbsorbed,
    periods: periodsFixture(),
  });
  return { weekly, horizon, events, extraAbsorbed: debtWalk && debtWalk.extraAbsorbed };
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Reconstruct incumbent simulate's day loop: weeklyVariable / 7 on every
// knowledge-horizon day, independently of the publishing helper.
function independentWalkDays(walkStart, walkEnd, spanStart, spanEnd) {
  let n = 0;
  let date = walkStart;
  while (date <= walkEnd) {
    if (date >= spanStart && date <= spanEnd) n += 1;
    date = addDays(date, 1);
  }
  return n;
}

function independentMonth(plan, debts, span) {
  const walk = independentWalkEvents(plan, debts);
  const events = (walk.events || []).filter(e =>
    e && e.date >= span.start && e.date <= span.end);
  const walkDays = independentWalkDays(
    walk.horizon.start, walk.horizon.end, span.start, span.end);
  const sumKind = (pred, sign) => roundCent(events.filter(pred)
    .reduce((s, e) => s + sign * (Number(e.amount) || 0), 0));
  const income = sumKind(e => e.kind === 'income', 1);
  const bills = sumKind(e => e.kind === 'bill' && e.jointCash !== false && !e.cardPaid, -1);
  const obligations = sumKind(e => e.kind === 'obligation', -1);
  const commitments = sumKind(e => e.kind === 'commitment', -1);
  const extras = sumKind(e => e.kind === 'extra' && e.id !== 'hypothetical-extra', -1);
  const householdBudget = roundCent(walk.weekly * walkDays / 7);
  const stage1 = roundCent(income - bills - obligations - householdBudget);
  const stage2 = roundCent(stage1 - commitments);
  const stage3 = roundCent(stage2 - extras);
  return {
    weekly: walk.weekly,
    walkDays,
    income,
    bills,
    obligations,
    householdBudget,
    commitments,
    extras,
    stage1,
    stage2,
    stage3,
    events,
    extraAbsorbed: walk.extraAbsorbed,
    horizon: walk.horizon,
  };
}

function stageReady(stage) {
  return stage && (stage.status === 'calculated' || stage.status === 'estimated')
    && stage.result && isFinite(stage.result.amount);
}

console.log('=== 1. Forecast is the sole calculator; helper is not exported ===');
{
  const src = read('public/forecast.js');
  const helper = src.slice(
    src.indexOf('function baselineTrajectoryMonthFunding('),
    src.indexOf('function baselineTrajectory('));
  ok(/function baselineTrajectoryMonthFunding\(/.test(src),
    'funding stages live inside public/forecast.js');
  ok(typeof F.baselineTrajectoryMonthFunding !== 'function'
    && typeof F.baselineTrajectoryWalkVariableDays !== 'function',
    'the funding helper is not a second exported engine');
  ok(/kind === 'extra'/.test(helper) && /hypothetical-extra/.test(helper),
    'Stage 3 reads walk kind:extra and excludes hypothetical extras');
  ok(/walkDaily/.test(helper) && /walkDays/.test(helper)
    && /simulate weeklyVariable applied days in month/.test(helper),
    'Household Budget counts incumbent simulate walk days in the month');
  ok(!/weekly \* periodDays \/ 7/.test(helper)
    && !/weeklyVariable \* periodDays \/ 7/.test(helper),
    'Household Budget is not a separate calendar-month smear');
  ok(!/recommend\(/.test(helper) && !/recommendWeekly\(/.test(helper),
    'funding helper does not search Forecast.recommend');
  ok(!/nextDollar/.test(helper) && !/paydayAllocation\(/.test(helper),
    'funding helper does not read plan.nextDollar or paydayAllocation');
  ok(!/baselineTrajectoryScenario\(/.test(helper) && !/hypotheticalExtraPayment\(/.test(helper),
    'funding helper does not take Stage 3 from the scenario or hypotheticalExtraPayment');
  ok(!/currentRegimeMonthly\(/.test(helper),
    'funding helper does not fold reserved current-regime smear into Stage 1');
  ok(!/safeToSpend|breathingRoom|minCash|\bryg\b/.test(helper),
    'funding helper invents no min-cash / breathing-room / safe-to-spend / RYG');
  const planning = read('public/planning.js');
  const packet = read('scripts/assistant-packet.js');
  const talk = read('public/talk.js');
  ok(/month\.stage1/.test(planning) && /month\.stage2/.test(planning) && /month\.stage3/.test(planning),
    'Planning reprints trajectory month stage1 / stage2 / stage3 from Forecast only');
  ok(!/baselineTrajectoryMonthFunding/.test(planning),
    'Planning does not call the internal funding helper');
  ok(!/stage1Amount|stage2Amount|stage3Amount|stage1\s*-\s*stage2/.test(planning),
    'Planning does not recompute stage amounts');
  ok(!/stage1|stage2|stage3|baselineTrajectoryMonthFunding/.test(packet),
    'assistant packet does not project funding stages in this PR');
  ok(!/stage1|stage2|stage3|baselineTrajectoryMonthFunding/.test(talk),
    'Talk does not consume funding stages');
}

console.log('\n=== 2. Independent July 2026 reconciliation ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  ok(traj.status === 'ready', 'trajectory is ready on the funding fixture');
  ok(traj.ranking === null && traj.recommendation === null && traj.affordability === null,
    'ranking / recommendation / affordability stay null');
  ok(traj.provenance.fundingStages === 'walk-derived'
    && traj.provenance.fundingStage3 === 'plan.defaults.extraDebtMonthly'
    && traj.provenance.fundingStage3Scenario === 'not-used'
    && traj.provenance.fundingStage3NextDollar === 'not-used',
    'provenance names walk-derived extras from extraDebtMonthly, not scenario or nextDollar');
  const july = traj.months.find(m => m.month === JUL);
  ok(july && july.income.status !== 'unavailable' && july.cash.status !== 'unavailable',
    'July 2026 income and cash are published');
  const expected = independentMonth(plan, debts, july);
  ok(near(traj.weeklyVariable.amount, expected.weekly),
    'published weeklyVariable matches independent budgetBreakdown planned remainder',
    `${traj.weeklyVariable.amount} vs ${expected.weekly}`);
  ok(stageReady(july.stage1) && stageReady(july.stage2) && stageReady(july.stage3),
    'July publishes ready stage1 / stage2 / stage3 results');
  ok(near(july.stage1.income.amount, expected.income)
    && near(july.income.amount, expected.income),
    'Stage 1 income matches independent expandEvents income and the published month income',
    `${july.stage1.income.amount} vs ${expected.income}`);
  ok(near(july.stage1.bills.amount, expected.bills) && near(expected.bills, 120),
    'Stage 1 bills are joint-cash recurring only ($120 Hydro, not the $50 card-paid stream)',
    String(july.stage1.bills.amount));
  ok(near(july.stage1.obligations.amount, expected.obligations) && near(expected.obligations, 80),
    'Stage 1 obligations match independent expandEvents required debt payments',
    String(july.stage1.obligations.amount));
  ok(july.stage1.householdBudget.walkDays === expected.walkDays
    && expected.walkDays === 31,
    'July Household Budget uses the 31 walk days simulate already drained');
  ok(july.stage1.householdBudget.identity === 'simulate weeklyVariable applied days in month',
    'July Household Budget names the walk-applied identity, not a calendar smear');
  ok(near(july.stage1.householdBudget.amount, expected.householdBudget)
    && near(expected.householdBudget, expected.weekly * expected.walkDays / 7),
    'Household Budget equals walk-applied weeklyVariable / 7 × 31 July walk days',
    `${july.stage1.householdBudget.amount} vs ${expected.householdBudget}`);
  const reservedSmear = 400 * 12 / 365.25 * 31;
  ok(!near(july.stage1.householdBudget.amount, expected.householdBudget + reservedSmear, 1),
    'undated currentMonthly smear is not a Stage 1 balancing bucket');
  ok(near(july.stage1.result.amount, expected.stage1)
    && near(july.stage1.result.amount,
      july.stage1.income.amount
      - july.stage1.bills.amount
      - july.stage1.obligations.amount
      - july.stage1.householdBudget.amount),
    'Stage 1 result is income − bills − obligations − Household Budget');
  ok(near(july.stage2.commitments.amount, expected.commitments)
    && near(expected.commitments, 400),
    'Stage 2 commitments are the required camp only, not the $999 optional trip',
    String(july.stage2.commitments.amount));
  ok(near(july.stage2.result.amount, expected.stage2)
    && near(july.stage2.result.amount,
      july.stage1.result.amount - july.stage2.commitments.amount),
    'Stage 2 result is Stage 1 − commitments');
  ok(near(july.stage3.extras.amount, expected.extras)
    && near(expected.extras, 75)
    && july.stage3.extras.source === 'plan.defaults.extraDebtMonthly',
    'Stage 3 extras match independent absorbed kind:extra from extraDebtMonthly ($75)',
    `${july.stage3.extras.amount} vs ${expected.extras}`);
  ok(near(july.stage3.result.amount, expected.stage3)
    && near(july.stage3.result.amount,
      july.stage2.result.amount - july.stage3.extras.amount),
    'Stage 3 result is Stage 2 − extras');
  ok(july.stage1.status === 'estimated' && july.stage2.status === 'estimated'
    && july.stage3.status === 'estimated',
    'estimated payroll keeps every stage estimated — estimates are not promoted');
  ok(!july.stage1.ranking && !july.stage1.recommendation && !july.stage1.affordability
    && july.stage1.minCash == null && july.stage1.breathingRoom == null
    && july.stage1.safeToSpend == null && july.stage1.ryg == null,
    'stages invent no ranking / recommendation / affordability / min-cash policy');
}

console.log('\n=== 3. Honest $0 extras and confirmed-income calculated stages ===');
{
  const zeroExtra = fixture({ defaults: { targetBuffer: 200, extraDebtMonthly: 0, scenario: 'expected' } });
  const trajZero = ask(zeroExtra.plan, zeroExtra.debts);
  const julyZero = trajZero.months.find(m => m.month === JUL);
  const expectedZero = independentMonth(zeroExtra.plan, zeroExtra.debts, julyZero);
  ok(julyZero.stage3.status === 'estimated' && near(julyZero.stage3.extras.amount, 0)
    && near(expectedZero.extras, 0),
    'extraDebtMonthly $0 publishes honest Stage 3 extras of $0, not unavailable');
  ok(near(julyZero.stage3.result.amount, julyZero.stage2.result.amount),
    'Stage 3 equals Stage 2 when planned extras are $0');

  const confirmed = fixture({
    income: [{
      id: 'side-income', label: 'Confirmed side income',
      frequency: 'monthly', day: 3, amount: 1800, confidence: 'confirmed',
    }],
  });
  const trajCalc = ask(confirmed.plan, confirmed.debts);
  const julyCalc = trajCalc.months.find(m => m.month === JUL);
  ok(julyCalc.income.status === 'calculated',
    'confirmed non-Dale income publishes calculated month income');
  ok(julyCalc.stage1.status === 'calculated' && julyCalc.stage2.status === 'calculated'
    && julyCalc.stage3.status === 'calculated',
    'confirmed components keep stages calculated rather than estimated');
  const expectedCalc = independentMonth(confirmed.plan, confirmed.debts, julyCalc);
  ok(near(julyCalc.stage1.result.amount, expectedCalc.stage1)
    && near(julyCalc.stage3.extras.amount, expectedCalc.extras),
    'calculated July still reconciles to independent expandEvents + walk-applied HB');
}

console.log('\n=== 4. Fail closed when income/cash is unavailable — not $0 ===');
{
  const { plan, debts } = fixture();
  const traj = ask(plan, debts);
  const jan = traj.months.find(m => m.month === '2027-01');
  ok(jan && jan.income.status === 'unavailable' && jan.cash.status === 'unavailable',
    'January 2027 income and cash stay unavailable on the synthetic Dale fixture');
  ok(jan.stage1 && jan.stage1.status === 'unavailable'
    && jan.stage2.status === 'unavailable'
    && jan.stage3.status === 'unavailable',
    'unavailable income/cash withholds all three stages');
  ok(!jan.stage1.result && !jan.stage2.result && !jan.stage3.result,
    'unavailable stages omit a result rather than publishing $0');
  ok(jan.stage1.income == null && jan.stage1.bills == null
    && jan.stage1.householdBudget == null,
    'unavailable Stage 1 omits component amounts rather than inventing $0');
  const continuingDale = F.expandEvents(plan, '2027-01-01', '2027-01-31')
    .filter(e => e.kind === 'income' && e.id === 'payroll')
    .reduce((s, e) => s + e.amount, 0);
  ok(continuingDale > 0,
    'expandEvents would still emit 2027 Dale payroll if asked');
  ok(jan.stage1.result == null || jan.stage1.result.amount !== continuingDale,
    'unavailable Stage 1 is not the expandEvents 2027 Dale sum');
  ok(jan.stage1.reason === jan.income.reason && /Not \$0/.test(jan.stage1.reason),
    'unavailable stages copy the income fail-closed reason and do not invent $0');
}

console.log('\n=== 5. Absorbed extras, not the raw extraDebtMonthly, and not a scenario amount ===');
{
  const { plan, debts } = fixture({
    defaults: { targetBuffer: 200, extraDebtMonthly: 5000, scenario: 'expected' },
  });
  const traj = ask(plan, debts);
  const june = traj.months.find(m => m.month === '2026-06');
  const expected = independentMonth(plan, debts, june);
  ok(expected.extras > 0 && expected.extras < 5000,
    'independent extraAbsorbed caps June extras below the raw $5,000 extraDebtMonthly',
    String(expected.extras));
  ok(near(june.stage3.extras.amount, expected.extras),
    'Stage 3 extras are absorbed kind:extra, not the raw extraDebtMonthly figure');
  ok(!near(june.stage3.extras.amount, 5000, 1),
    'Stage 3 does not publish the uncapped extraDebtMonthly as extras');

  const { plan: basePlan, debts: baseDebts } = fixture();
  const before = ask(basePlan, baseDebts);
  const scenario = F.baselineTrajectoryScenario(basePlan, baseDebts, START, {
    nature: 'additional-debt-payment',
    amount: 200,
    debtId: 'card',
    periods: periodsFixture(),
  });
  ok(scenario.status === 'ready', 'additional-debt-payment scenario is ready on this fixture');
  const after = ask(basePlan, baseDebts);
  const julyBefore = before.months.find(m => m.month === JUL);
  const julyAfter = after.months.find(m => m.month === JUL);
  ok(near(julyAfter.stage3.extras.amount, julyBefore.stage3.extras.amount)
    && near(julyAfter.stage3.result.amount, julyBefore.stage3.result.amount),
    'calling baselineTrajectoryScenario with $200 does not change baseline Stage 3');
  ok(!near(julyAfter.stage3.extras.amount, julyBefore.stage3.extras.amount + 200, 1),
    'Stage 3 extras are not the planned extra plus the scenario amount');
}

console.log('\n=== 6. Month-boundary walk days, not a 30-day June smear ===');
{
  const budgetOnly = fixture({
    startingCash: { amount: 10000 },
    defaults: { targetBuffer: 200, extraDebtMonthly: 0, scenario: 'expected' },
    budget: {
      basis: 'ytd',
      categories: [{
        id: 'groceries', label: 'Groceries', class: 'essential',
        from: ['Groceries'], plannedWeekly: 70,
      }],
    },
    income: [],
    obligations: [],
    bills: [],
    commitments: [],
  }, []);
  const traj = ask(budgetOnly.plan, budgetOnly.debts);
  const june = traj.months.find(m => m.month === '2026-06');
  const july = traj.months.find(m => m.month === JUL);
  ok(traj.status === 'ready' && june && july
    && june.cash.status !== 'unavailable' && july.cash.status !== 'unavailable',
    'budget-only trajectory publishes June and July cash');
  const expectedJune = independentMonth(budgetOnly.plan, budgetOnly.debts, june);
  const expectedJuly = independentMonth(budgetOnly.plan, budgetOnly.debts, july);
  ok(near(traj.weeklyVariable.amount, 70) && near(expectedJune.weekly, 70),
    'budget-only planned weeklyVariable is independently $70/week');
  ok(expectedJune.walkDays === 16 && june.start === START && june.end === '2026-06-30',
    'independent June walk days are 16 (as-of through month-end), not the calendar month');
  ok(expectedJuly.walkDays === 31 && july.start === '2026-07-01' && july.end === '2026-07-31',
    'independent July walk days are the 31 simulate days after the June boundary');
  const juneCalendarDays = daysInMonth(2026, 6);
  const calendarJuneSmear = roundCent(expectedJune.weekly * juneCalendarDays / 7);
  ok(juneCalendarDays === 30 && !near(expectedJune.householdBudget, calendarJuneSmear, 1),
    'walk-applied June Household Budget is not the 30-day calendar smear',
    `${expectedJune.householdBudget} vs calendar ${calendarJuneSmear}`);
  ok(near(june.stage1.householdBudget.amount, expectedJune.householdBudget)
    && near(expectedJune.householdBudget, expectedJune.weekly * 16 / 7)
    && june.stage1.householdBudget.walkDays === 16,
    'June Household Budget is 16 walk-applied days of $70/week',
    String(june.stage1.householdBudget.amount));
  ok(near(july.stage1.householdBudget.amount, expectedJuly.householdBudget)
    && near(expectedJuly.householdBudget, expectedJuly.weekly * 31 / 7)
    && july.stage1.householdBudget.walkDays === 31,
    'July Household Budget is 31 walk-applied days of $70/week',
    String(july.stage1.householdBudget.amount));
  const straddlingWeekStart = '2026-06-29';
  const straddlingWeekEnd = '2026-07-05';
  const juneWeekDays = independentWalkDays(
    expectedJune.horizon.start, expectedJune.horizon.end,
    straddlingWeekStart, '2026-06-30');
  const julyWeekDays = independentWalkDays(
    expectedJuly.horizon.start, expectedJuly.horizon.end,
    '2026-07-01', straddlingWeekEnd);
  ok(juneWeekDays === 2 && julyWeekDays === 5,
    'the as-of-aligned week that crosses June/July splits 2 walk days / 5 walk days');

  const juneOpen = 10000;
  const dailyVariable = expectedJune.weekly / 7;
  let balance = juneOpen;
  let date = START;
  const closes = {};
  while (date <= '2026-07-31') {
    balance -= dailyVariable;
    closes[date] = balance;
    date = addDays(date, 1);
  }
  const juneClose = roundCent(closes['2026-06-30']);
  const julyClose = roundCent(closes['2026-07-31']);
  const juneCashDelta = roundCent(juneClose - juneOpen);
  const julyCashDelta = roundCent(julyClose - juneClose);
  ok(near(june.cash.amount, juneClose) && near(july.cash.amount, julyClose),
    'independent daily walk closes match published June and July cash',
    `${june.cash.amount} / ${july.cash.amount} vs ${juneClose} / ${julyClose}`);
  ok(near(june.stage3.result.amount, juneCashDelta)
    && near(june.stage3.result.amount, -expectedJune.householdBudget),
    'June Stage 3 equals the independent June cash change from walk-applied Household Budget',
    `${june.stage3.result.amount} vs cash ${juneCashDelta}`);
  ok(near(july.stage3.result.amount, julyCashDelta)
    && near(july.stage3.result.amount, -expectedJuly.householdBudget),
    'July Stage 3 equals the independent June→July cash change from walk-applied Household Budget',
    `${july.stage3.result.amount} vs cash ${julyCashDelta}`);
  ok(!near(june.stage3.result.amount, -calendarJuneSmear, 1)
    && !near(juneCashDelta, -calendarJuneSmear, 1),
    'June Stage 3 and cash change are not the 30-day calendar smear');
}

console.log('\n=== 7. Live extraDebtMonthly $0 is honest zero on published months ===');
{
  const live = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));
  ok((live.plan.defaults && live.plan.defaults.extraDebtMonthly) === 0,
    'canonical extraDebtMonthly is $0');
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods,
    extraFacilities: live.revolvingExtra,
  });
  ok(traj.status === 'ready', 'live baselineTrajectory is ready');
  const published = traj.months.filter(m =>
    m.income && m.income.status !== 'unavailable'
    && m.cash && m.cash.status !== 'unavailable');
  ok(published.length > 0, 'live trajectory has published-income months');
  ok(published.every(m => stageReady(m.stage1) && stageReady(m.stage3)
    && near(m.stage3.extras.amount, 0)
    && near(m.stage3.result.amount, m.stage2.result.amount)),
    'every published live month has honest $0 Stage 3 extras');
  const withheld = traj.months.filter(m =>
    m.income && m.income.status === 'unavailable');
  ok(withheld.every(m => m.stage1 && m.stage1.status === 'unavailable'
    && !m.stage1.result),
    'live unavailable-income months fail stages closed rather than $0');
  ok(hashFile(DATA) === liveHash, 'funding-stage tests did not write data.json');
}

if (failures) {
  console.log(`\n${failures} failure${failures === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log('\nAll tests passed');
