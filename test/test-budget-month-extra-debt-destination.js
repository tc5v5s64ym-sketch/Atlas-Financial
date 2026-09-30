// AMANDA SLICE 15 — MONTHLY EXTRA-DEBT DESTINATION BREAKDOWN (PAGE).
//
// Deterministic proof that the Month lens answers "where does this month's
// planned EXTRA debt money actually go?" as a pure reprint layer over the
// existing Forecast publications:
//
// - The monthly total stays the incumbent Forecast-published
//   month.stage3.extras.amount — the page never sums pay periods or
//   allocation lines into it.
// - Destination detail selects exactly Forecast's published closing
//   pay-period set (month.closingPayPeriods joined back to traj.payPeriods
//   by payday identity). The page never recreates the month-close rule.
// - Each matched pay period reprints its own stage3.extras.allocations[]
//   in Forecast order, with Forecast labels, amounts, and trust, through
//   the Slice 13 validation/rendering layer. No cascade replay, no debt
//   lookup, no ranking, no reconstruction, no monthly aggregation.
// - Known $0 is a real $0. A positive monthly extra with missing or
//   malformed attribution fails the destination detail closed as a whole
//   — never a partial list that looks complete.
//
// Part A runs the real Forecast trajectory and proves the full chain:
// trajectory -> selected month -> exact closing periods -> attribution.
// Part B poisons the presentation inputs to prove the page never
// manufactures totals, trust, or partial attribution. Part C proves the
// authority boundary and guards the Slice 13 / Slice 14 surfaces.
//
// Run: node test/test-budget-month-extra-debt-destination.js

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '..');
const planPath = path.join(repoRoot, 'public', 'plan.js');
const forecastPath = path.join(repoRoot, 'public', 'forecast.js');
const planSource = fs.readFileSync(planPath, 'utf8');

let failures = 0;
const check = (label, fn) => {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${label}\n    ${e.message.split('\n')[0]}`);
  }
};

const Forecast = require(forecastPath);

function makeContext() {
  const context = vm.createContext({
    Forecast,
    money2: n => '$' + Number(n).toFixed(2),
    fmtDateLong: iso => iso,
  });
  vm.runInContext(planSource, context);
  const P = {};
  for (const name of [
    'budgetMonthExtraDebtDestinationsHtml',
    'budgetMonthExtraDebtPeriodGroupHtml',
    'budgetMonthViewHtml',
    'budgetPayPeriodMoneyMapHtml',
    'money2',
  ]) {
    P[name] = vm.runInContext(name, context);
  }
  P.evalInPage = js => vm.runInContext(js, context);
  P.ctx = context;
  return P;
}

const P = makeContext();
const money = n => '$' + Number(n).toFixed(2);

// ---------------------------------------------------------------- e2e ----
// Real Forecast trajectory fixture (shared with the Slice 13 page test):
// 2026-01 has three closing pay periods; the 2026-01-02 period's extra
// payment spans two debts in the policy cascade.
function e2ePlan() {
  return {
    windowDays: 91,
    startingCash: { amount: 20000 },
    defaults: { targetBuffer: 0, extraDebtMonthly: 1000 },
    income: [{ id: 'payroll', label: 'Seaspan', frequency: 'biweekly', anchor: '2026-01-02',
      amount: 2600, confidence: 'confirmed' }],
    obligations: [], bills: [], commitments: [],
    budget: { basis: 'ytd', categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedWeekly: 140 },
    ] },
    opening: { asOf: '2026-01-01' },
    nextDollar: { policy: 'true-surplus-highest-interest',
      eligibleDebts: 'revolving-cards-and-heloc', provenance: 'owner-stated' },
  };
}
function e2eDebts() {
  return [
    { id: 'tri', label: 'Triangle Mastercard', structure: 'Revolving card',
      balance: 200, pending: 0, rate: 19.99, minimumPayment: 25, paymentDay: 15,
      confidence: 'verified' },
    { id: 'mbna', label: 'MBNA Mastercard', structure: 'Revolving card',
      balance: 5000, pending: 0, rate: 12.99, minimumPayment: 100, paymentDay: 15,
      confidence: 'verified' },
  ];
}
function e2eTrajectory(debts) {
  return Forecast.baselineTrajectory(e2ePlan(), debts || e2eDebts(), '2026-01-01', { weeklyVariable: 400 });
}
const traj = e2eTrajectory();
assert.ok(traj.status === 'ready', 'e2e fixture: trajectory ready');
const jan = traj.months.find(m => m.month === '2026-01');
assert.ok(jan, 'e2e fixture: january published');

console.log('Part A — real Forecast trajectory to month to attribution');
check('A1: monthly total stays the incumbent published value; groups are exactly the closing set', () => {
  assert.equal(jan.stage3.extras.amount, 1000, 'fixture: monthly extra is 1000');
  assert.equal(jan.stage3.extras.status, 'calculated', 'fixture: monthly trust calculated');
  const html = P.budgetMonthExtraDebtDestinationsHtml(jan, traj);
  // The detail owns no total: the monthly total lives only in the
  // separate component row. The detail must not reprint the row label
  // and must not manufacture a summed figure anywhere.
  assert.ok(!html.includes('Planned extra debt payment'), 'the detail never renders the total row label');
  assert.ok(html.includes('data-budget-month-extra-debt-destination="detail"'), 'the detail block renders');
  const paydays = jan.closingPayPeriods.map(c => c.payday);
  assert.deepEqual(paydays, ['2025-12-19', '2026-01-02', '2026-01-16'], 'fixture: three closing periods');
  for (const payday of paydays) {
    assert.ok(html.includes(`data-budget-month-extra-debt-period="${payday}"`),
      `closing period ${payday} has its own group`);
  }
  assert.ok(!html.includes('data-budget-month-extra-debt-period="2026-01-30"'),
    'the 2026-01-30 period closes in February and is not in January');
});

check('A2: multi-debt cascade reprints in Forecast order with Forecast labels, amounts, trust', () => {
  const html = P.budgetMonthExtraDebtDestinationsHtml(jan, traj);
  const jan2 = html.split('data-budget-month-extra-debt-period="2026-01-02"')[1]
    .split('data-budget-month-extra-debt-period="2026-01-16"')[0];
  assert.ok(jan2.includes('Triangle Mastercard'), 'first target label reprinted');
  assert.ok(jan2.includes('MBNA Mastercard'), 'second target label reprinted');
  assert.ok(jan2.indexOf('Triangle Mastercard') < jan2.indexOf('MBNA Mastercard'),
    'Forecast publication order preserved');
  assert.ok(jan2.includes(money(201.65)) && jan2.includes(money(798.35)),
    'allocation amounts reprinted exactly');
  assert.ok(jan2.includes('trust-tag'), 'trust tags stay visible');
  assert.ok(jan2.includes('calculated'), 'verified cascade keeps calculated trust');
  // No cross-period aggregation: the MBNA line appears once for this group.
  const mbnaCount = jan2.split('MBNA Mastercard').length - 1;
  assert.equal(mbnaCount, 1, 'no aggregation inside the group');
});

check('A3: payday date does not control month placement — the Dec 19 residual closes into January', () => {
  const html = P.budgetMonthExtraDebtDestinationsHtml(jan, traj);
  assert.ok(html.includes('data-budget-month-extra-debt-period="2025-12-19"'),
    'period with December payday but January close is in January');
  assert.ok(html.includes('No extra debt payment from this payday.'),
    'its $0 extras state renders without inventing a destination');
});

check('A4: mid-payment split reprints — June final payment is the partial amount', () => {
  const june = traj.months.find(m => m.month === '2026-06');
  assert.ok(june, 'fixture: june published');
  assert.equal(june.stage3.extras.amount, 351.88, 'fixture: june extra is the partial 351.88');
  const html = P.budgetMonthExtraDebtDestinationsHtml(june, traj);
  assert.ok(html.includes('data-budget-month-extra-debt-period="2026-06-05"'),
    'the paying period is grouped separately');
  assert.ok(html.includes('MBNA Mastercard'), 'destination reprinted');
  assert.ok(html.includes(money(351.88)), 'partial final amount reprinted exactly');
});

check('A5: known $0 renders $0, not unavailable', () => {
  const july = traj.months.find(m => m.month === '2026-07');
  assert.ok(july, 'fixture: july published');
  assert.equal(july.stage3.extras.amount, 0, 'fixture: july extra is a trusted $0');
  const html = P.budgetMonthExtraDebtDestinationsHtml(july, traj);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="none"'), 'zero state marker');
  assert.ok(html.includes('No planned extra debt payment this month.'), 'zero copy');
  assert.ok(!html.includes('unavailable'), 'no unavailable wording for a known zero');
});

check('A6: skipped-estimated upstream keeps the downstream allocation estimated', () => {
  const est = e2eTrajectory([
    { id: 'tri', label: 'Triangle Mastercard', structure: 'Revolving card',
      balance: 100, pending: 0, rate: 19.99, minimumPayment: 25, paymentDay: 15,
      confidence: 'estimated' },
    { id: 'mbna', label: 'MBNA Mastercard', structure: 'Revolving card',
      balance: 5000, pending: 0, rate: 12.99, minimumPayment: 100, paymentDay: 15,
      confidence: 'verified' },
  ]);
  const feb = est.months.find(m => m.month === '2026-02');
  assert.ok(feb, 'fixture: february published');
  const feb13 = est.payPeriods.find(p => p.payday === '2026-02-13');
  const alloc = feb13.stage3.extras.allocations;
  assert.equal(alloc.length, 1, 'fixture: second payment lands on one debt');
  assert.equal(alloc[0].debtId, 'mbna', 'fixture: the cleared estimated head is skipped');
  assert.equal(alloc[0].status, 'estimated', 'fixture: downstream stays estimated');
  const html = P.budgetMonthExtraDebtDestinationsHtml(feb, est);
  assert.ok(html.includes('MBNA Mastercard'), 'destination reprinted');
  assert.ok(html.includes('trust-estimated'), 'line keeps its estimated trust — not promoted');
});

check('A7: poisoned monthly total — the page still shows the published total, never a sum', () => {
  const poisoned = JSON.parse(JSON.stringify(jan));
  poisoned.stage3.extras.amount = 1250; // deliberately non-reconciling: lines sum to 1000
  const html = P.budgetMonthExtraDebtDestinationsHtml(poisoned, traj);
  // The detail block carries no total of its own; assert the reprint path
  // does not manufacture one by checking the full month view integration.
  assert.ok(html.includes(money(201.65)) && html.includes(money(798.35)),
    'allocation lines reprinted unchanged');
  assert.ok(!html.includes(money(1250)) && !html.includes(money(1000)),
    'the detail never derives or restates a monthly total');
});

check('A8: month view integration — detail sits under the authoritative total row', () => {
  P.evalInPage(`budgetGranularity = 'month';`);
  P.evalInPage(`budgetSelectedMonth = '2026-01';`);
  P.evalInPage('budgetTrajectoryCache = null; budgetTrajectoryCacheKey = null;');
  const src = {
    plan: e2ePlan(), debts: e2eDebts(), asOf: '2026-01-01',
    meta: { asOf: '2026-01-01' }, weekly: 400,
    liveOverlay: null, revolvingExtra: null, periods: null,
  };
  const html = P.budgetMonthViewHtml(src);
  const totalIdx = html.indexOf('Planned extra debt payment');
  assert.ok(totalIdx >= 0, 'authoritative total row renders');
  assert.ok(html.includes(money(1000)), 'monthly total $1,000.00 renders');
  const detailIdx = html.indexOf('data-budget-month-extra-debt-destination="detail"');
  assert.ok(detailIdx > totalIdx, 'destination detail sits directly under the total row');
  assert.ok(html.indexOf('Where the planned extra debt payment goes') > totalIdx,
    'destination heading follows the total');
  // Month Stage 1/2/3 rows are unchanged by the slice.
  for (const label of ['Total income', 'Regular household spending', 'Bills',
    'Required debt payments', 'Planned spending']) {
    assert.ok(html.includes(label), `month row unchanged: ${label}`);
  }
  assert.ok(html.includes('Required debt payments'), 'minimums stay a separate row');
});

check('A9: required minimums are never extra-debt destinations', () => {
  const html = P.budgetMonthExtraDebtDestinationsHtml(jan, traj);
  const detail = html.split('data-budget-month-extra-debt-destination="detail"')[1] || '';
  assert.ok(!/obligation/i.test(detail), 'no obligation wording inside the destination detail');
});

// --------------------------------------------------- Part B: poison ----
console.log('Part B — poisoned presentation inputs fail closed');

function monthWith(extras, closingPayPeriods, payPeriods) {
  return {
    month: '2026-01',
    stage1: { id: 'normal-life', label: 'Normal life', status: 'calculated' },
    stage2: { id: 'after-planned-spending', label: 'After planned spending', status: 'calculated' },
    stage3: { id: 'after-debt-strategy', label: 'After debt strategy', status: 'calculated', extras },
    closingPayPeriods,
  };
}
function validAllocations() {
  return [
    { debtId: 'tri', label: 'Triangle Mastercard', amount: 750, status: 'calculated' },
    { debtId: 'mbna', label: 'MBNA Mastercard', amount: 250, status: 'calculated' },
  ];
}
function periodFixture(payday, extras) {
  return {
    id: payday, payday,
    start: '2026-01-02', end: '2026-01-15',
    cycleStart: '2026-01-02', cycleEnd: '2026-01-15',
    windowKind: 'full-cycle', rangeLabel: 'Jan 2 – Jan 15',
    stage3: { id: 'after-debt-strategy', label: 'After debt strategy', status: 'calculated', extras },
  };
}
function positiveMonth(allocations) {
  const extras = {
    amount: 1000, status: 'calculated', source: 'plan.defaults.extraDebtMonthly',
    allocations: allocations === undefined ? validAllocations() : allocations,
  };
  const month = monthWith(extras, [{ payday: '2026-01-02', close: '2026-01-15', displayRange: 'Jan 2 – Jan 15' }]);
  const t2 = { payPeriods: [periodFixture('2026-01-02', JSON.parse(JSON.stringify(extras)))] };
  return { month, t2, extras };
}

check('B1: positive monthly extra with missing allocations fails the detail closed; total intact', () => {
  const { month, t2 } = positiveMonth(undefined);
  delete t2.payPeriods[0].stage3.extras.allocations;
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'), 'fail-closed block');
  assert.ok(html.includes('Not $0.'), 'unavailable is never $0');
  assert.ok(!html.includes('Triangle Mastercard'), 'no partial list looks complete');
});

check('B2: malformed allocation amount (numeric string) fails closed', () => {
  const bad = validAllocations();
  bad[0].amount = '750';
  const { month, t2 } = positiveMonth(bad);
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'), 'fail closed');
  assert.ok(!html.includes('Triangle Mastercard'), 'no partial list');
});

for (const [name, badAmount] of [
  ['false', false], ['empty string', ''], ['NaN', NaN], ['Infinity', Infinity],
  ['negative Infinity', -Infinity],
]) {
  check(`B3: malformed allocation amount (${name}) fails closed`, () => {
    const bad = validAllocations();
    bad[0].amount = badAmount;
    const { month, t2 } = positiveMonth(bad);
    const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
    assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'), 'fail closed');
  });
}

check('B4: malformed allocation label and missing trust fail closed', () => {
  for (const mutate of [
    a => { a[0].label = ''; },
    a => { delete a[0].label; },
    a => { delete a[0].status; },
    a => { a[0].status = 'verified'; },
    a => { delete a[0].debtId; },
  ]) {
    const bad = validAllocations();
    mutate(bad);
    const { month, t2 } = positiveMonth(bad);
    const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
    assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'),
      'fail closed on malformed line');
  }
});

check('B4b: empty or non-array allocations fail closed', () => {
  for (const allocations of [[], null, 'x', {}]) {
    const { month, t2 } = positiveMonth(allocations);
    const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
    assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'),
      `fail closed on allocations=${JSON.stringify(allocations)}`);
  }
});

check('B5: malformed monthly amounts fail the detail closed', () => {
  for (const badAmount of [false, '', NaN, Infinity, '1000', null, undefined]) {
    const { t2 } = positiveMonth();
    const month = monthWith(
      { amount: badAmount, status: 'calculated', source: 'plan.defaults.extraDebtMonthly' },
      [{ payday: '2026-01-02', close: '2026-01-15' }]);
    const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
    assert.ok(!html.includes('data-budget-month-extra-debt-destination="detail"'),
      `no detail on monthly amount ${String(badAmount)}`);
    assert.ok(!html.includes('data-budget-month-extra-debt-destination="unavailable"'),
      'a malformed total is not presented as a breakdown failure either — no detail at all');
  }
});

check('B6: missing monthly trust fails the detail closed', () => {
  const { t2 } = positiveMonth();
  const month = monthWith(
    { amount: 1000, source: 'plan.defaults.extraDebtMonthly' },
    [{ payday: '2026-01-02', close: '2026-01-15' }]);
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(!html.includes('data-budget-month-extra-debt-destination="detail"'), 'no detail without trust');
});

check('B7: partial attribution can never look complete — one bad group fails everything', () => {
  const good = { amount: 750, status: 'calculated', allocations: [
    { debtId: 'tri', label: 'Triangle Mastercard', amount: 750, status: 'calculated' } ] };
  const bad = { amount: 250, status: 'calculated', allocations: [
    { debtId: 'mbna', label: 'MBNA Mastercard', amount: '250', status: 'calculated' } ] };
  const month = monthWith(
    { amount: 1000, status: 'calculated', source: 'plan.defaults.extraDebtMonthly' },
    [{ payday: '2026-01-02', close: '2026-01-15' }, { payday: '2026-01-16', close: '2026-01-29' }]);
  const t2 = { payPeriods: [
    periodFixture('2026-01-02', JSON.parse(JSON.stringify(good))),
    periodFixture('2026-01-16', JSON.parse(JSON.stringify(bad))),
  ] };
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'), 'fail closed as a whole');
  assert.ok(!html.includes('Triangle Mastercard'), 'the valid group is not shown alone');
});

check('B8: anchor identity failures fail closed (missing/unknown/ambiguous payday)', () => {
  const { t2 } = positiveMonth();
  for (const membership of [
    null,
    [],
    [{ close: '2026-01-15' }],
    [{ payday: '2026-02-13', close: '2026-02-26' }],
  ]) {
    const month = monthWith(
      { amount: 1000, status: 'calculated', source: 'plan.defaults.extraDebtMonthly' },
      membership);
    const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
    assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'),
      `fail closed for membership ${JSON.stringify(membership)}`);
  }
  // Ambiguous: two published rows share the anchor payday.
  const { month } = positiveMonth();
  const dup = { payPeriods: [t2.payPeriods[0], JSON.parse(JSON.stringify(t2.payPeriods[0]))] };
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, dup);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="unavailable"'),
    'ambiguous duplicate payday fails closed');
});

check('B9: unavailable monthly extras render no detail (the total row says unavailable)', () => {
  const { t2 } = positiveMonth();
  const month = monthWith(
    { status: 'unavailable', reason: 'Forecast could not read extra-debt input.' }, []);
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.equal(html, '', 'no destination detail on unavailable');
});

check('B10: two positive periods to the same debt stay grouped — never aggregated', () => {
  const a1 = [{ debtId: 'tri', label: 'Triangle Mastercard', amount: 750, status: 'calculated' }];
  const a2 = [{ debtId: 'tri', label: 'Triangle Mastercard', amount: 300, status: 'calculated' }];
  const month = monthWith(
    { amount: 1050, status: 'calculated', source: 'plan.defaults.extraDebtMonthly' },
    [{ payday: '2026-01-02', close: '2026-01-15' }, { payday: '2026-01-16', close: '2026-01-29' }]);
  const t2 = { payPeriods: [
    periodFixture('2026-01-02', { amount: 750, status: 'calculated', allocations: a1 }),
    periodFixture('2026-01-16', { amount: 300, status: 'calculated', allocations: a2 }),
  ] };
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('data-budget-month-extra-debt-period="2026-01-02"'), 'first group');
  assert.ok(html.includes('data-budget-month-extra-debt-period="2026-01-16"'), 'second group');
  assert.ok(html.includes(money(750)) && html.includes(money(300)), 'both lines reprinted');
  assert.ok(!html.includes(money(1050)), 'no aggregated $1,050.00 line manufactured');
});

check('B11: line trust is never promoted by the monthly total', () => {
  const { month, t2 } = positiveMonth([
    { debtId: 'tri', label: 'Triangle Mastercard', amount: 1000, status: 'estimated' },
  ]);
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('trust-estimated'), 'line keeps its estimated trust');
});

check('B12: nextTarget reprints exactly as Slice 13 does, per group', () => {
  const { month, t2 } = positiveMonth(validAllocations());
  t2.payPeriods[0].stage3.extras.nextTarget =
    { debtId: 'visa', label: 'Travel Visa', status: 'calculated' };
  const html = P.budgetMonthExtraDebtDestinationsHtml(month, t2);
  assert.ok(html.includes('After MBNA Mastercard clears'), 'continuity follows the last allocation');
  assert.ok(html.includes('Travel Visa'), 'Forecast next target reprinted');
});

// ------------------------------------------------- Part C: boundary ----
console.log('Part C — authority boundary and regression guards');

check('C1: the new page code calls no debt engine, cascade, ranking, or balance lookup', () => {
  const src = planSource;
  const start = src.indexOf('AMANDA SLICE 15');
  const end = src.indexOf('AMANDA SLICE 9', start);
  assert.ok(start >= 0 && end > start, 'slice 15 block located');
  const block = src.slice(start, end);
  for (const forbidden of ['debtPriority', 'payDown', 'projectDebts', '.sort(', 'toSorted',
    'APR', 'apr', 'interestRate', '.balance']) {
    assert.ok(!block.includes(forbidden),
      `new code contains no "${forbidden}"`);
  }
});

check('C2: the new code never sums into a total (no invented monthly figure)', () => {
  const src = planSource;
  const start = src.indexOf('AMANDA SLICE 15');
  const end = src.indexOf('AMANDA SLICE 9', start);
  const block = src.slice(start, end);
  assert.ok(!/reduce\s*\(\s*\(sum/.test(block), 'no sum-reduce in the new code');
  assert.ok(!block.includes('trajectorySumCents'), 'no trajectory sum in the new code');
});

check('C3: Slice 13 selected pay-period surface is unchanged', () => {
  const html = P.budgetPayPeriodMoneyMapHtml({
    payday: '2026-01-02',
    stage3: { id: 'after-debt-strategy', label: 'After debt strategy', status: 'calculated',
      extras: { amount: 1000, status: 'calculated', source: 'plan.defaults.extraDebtMonthly',
        allocations: validAllocations() },
      result: { amount: 0, status: 'calculated' } },
  });
  assert.ok(html.includes('Going to'), 'slice 13 attribution heading intact');
  assert.ok(html.includes('Triangle Mastercard') && html.includes(money(750)),
    'slice 13 lines intact');
});

check('C4: Slice 14 and other page functions still load', () => {
  const names = ['budgetPayPeriodFundingPlanHtml', 'budgetDrilldownExtraDebtHtml',
    'budgetMonthViewHtml', 'budgetMonthLadderHtml'];
  for (const name of names) {
    assert.equal(typeof P.evalInPage(`typeof ${name}`), 'string', `${name} defined`);
    assert.equal(P.evalInPage(`typeof ${name}`), 'function', `${name} is a function`);
  }
});

check('C5: the payday label degrades to the raw ISO identity when fmtDateLong is absent', () => {
  // Minimal sandbox without the app-shell fmtDateLong global (mirrors the
  // Slice 3 harness): the month view must render, not crash.
  const context = vm.createContext({ Forecast, money2: n => '$' + Number(n).toFixed(2) });
  vm.runInContext(planSource, context);
  const render = vm.runInContext('budgetMonthExtraDebtDestinationsHtml', context);
  const { month, t2 } = positiveMonth();
  const html = render(month, t2);
  assert.ok(html.includes('data-budget-month-extra-debt-destination="detail"'), 'detail renders without fmtDateLong');
  assert.ok(html.includes('2026-01-02 payday'), 'raw ISO payday identity is the label fallback');
});

if (failures) {
  console.log(`\n${failures} FAILURE(S)`);
  process.exit(1);
}
console.log('\nSlice 15 monthly destination breakdown checks passed.');
