'use strict';

// Budget prerequisite: a carried opening is not the current spending window.
// Synthetic amounts, independently summed over the fixed 14-day calendar.
const assert = require('node:assert/strict');
const F = require('../public/forecast');

const asOf = '2026-09-30';
const plan = {
  windowDays: 91,
  defaults: { targetBuffer: 0 },
  startingCash: { amount: 10000 },
  opening: { asOf, priorAsOf: '2026-08-19', representedEvents: [] },
  income: [{ id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
    anchor: '2026-08-14', amount: 2000, confidence: 'confirmed' }],
  bills: [{ id: 'older-bill', label: 'Older required bill', frequency: 'once',
    date: '2026-09-10', amount: 75, confidence: 'confirmed' }],
  obligations: [], commitments: [],
  budget: { categories: [{ id: 'groceries', label: 'Groceries', class: 'essential',
    from: ['Groceries'], plannedPayday: 500 },
  { id: 'fuel', label: 'Fuel', class: 'essential', plannedMonthly: 304.375 }] },
};
const transactions = [
  { date: '2026-08-20', amount: 410, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  { date: '2026-09-24', amount: 140, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  { date: '2026-09-25', amount: 30, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  { date: '2026-09-30', amount: 45, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  { date: '2026-10-01', amount: 90, categoryLabel: 'Groceries', accountRole: 'household-cash' },
].map(tx => Object.assign({ pending: false, displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' }, tx));
function options(extra) {
  return Object.assign({ debts: [], targetBuffer: 0, weeklyVariable: 0,
    currentPeriodActuals: {
      schema: 'atlas-current-period-actuals/v1', observationAsOf: asOf,
      coverageStart: '2026-08-19', coverageThrough: asOf,
      pendingCoverage: 'complete', transactions,
    } }, extra);
}
function checkAction(action) {
  assert.equal(action.periodStart, '2026-09-25', 'current action starts on Seaspan payday, not the 51-day opening');
  assert.equal(action.periodEnd, '2026-10-08', 'cross-month cycle stays whole');
  const groceries = action.categories.find(c => c.id === 'groceries');
  assert.equal(groceries.planned, 500);
  assert.equal(groceries.posted, 30 + 45, 'only current-cycle transactions through as-of count');
  assert.equal(groceries.remaining, 500 - (30 + 45), 'planned and actual compare the same cycle');
  assert.equal(action.categories.find(c => c.id === 'fuel').planned, 14 * 10,
    'monthly targets are scaled to 14 days, never the 51-day opening lookback');
  assert.equal(action.currentShortfall, false, 'older spending cannot fabricate current-cycle overspend');
  assert.equal(action.remainingClaim, 'precise');
  // Correcting the comparison must not release an unresolved earlier bill.
  assert.equal(action.bills.find(b => b.id === 'older-bill').remaining, 75);
}

checkAction(F.currentPeriodAction(plan, asOf, options()));
const currentOnly = options();
currentOnly.currentPeriodActuals.coverageStart = '2026-09-25';
checkAction(F.currentPeriodAction(plan, asOf, currentOnly));

const incomplete = options();
incomplete.currentPeriodActuals.coverageStart = '2026-09-26';
const partialAction = F.currentPeriodAction(plan, asOf, incomplete);
assert.equal(partialAction.remainingClaim, 'unavailable');
assert.equal(partialAction.categories.find(c => c.id === 'groceries').posted, null, 'missing cycle coverage stays unknown');

const absent = options({ currentPeriodActuals: null });
assert.equal(F.currentPeriodAction(plan, asOf, absent).categories.find(c => c.id === 'groceries').remaining, null);

const advice = F.recommend(plan, asOf, options());
checkAction(advice.currentPeriodAction);

// Cycle transitions stay aligned across both month and year boundaries.
for (const [day, start, end] of [
  ['2026-10-09', '2026-10-09', '2026-10-22'],
  ['2026-10-14', '2026-10-09', '2026-10-22'],
  ['2027-01-03', '2027-01-01', '2027-01-14'],
]) {
  const p = JSON.parse(JSON.stringify(plan));
  p.opening.asOf = day;
  const opts = options();
  opts.currentPeriodActuals.observationAsOf = day;
  opts.currentPeriodActuals.coverageThrough = day;
  const action = F.currentPeriodAction(p, day, opts);
  assert.equal(action.periodStart, start);
  assert.equal(action.periodEnd, end);
  assert.equal(action.categories.find(c => c.id === 'fuel').planned, 140);
  const expectedSpend = transactions.filter(tx => tx.date >= start && tx.date <= day)
    .reduce((sum, tx) => sum + tx.amount, 0);
  assert.equal(action.categories.find(c => c.id === 'groceries').posted, expectedSpend);
}

const over = options();
over.currentPeriodActuals.transactions = [Object.assign({}, transactions[2], { amount: 600 })];
const overAction = F.currentPeriodAction(plan, asOf, over);
assert.equal(overAction.categories.find(c => c.id === 'groceries').remaining, 500 - 600);
assert.equal(overAction.currentShortfall, true, 'real current-cycle overspending remains a shortfall');

console.log('PASS current-cycle actuals use the same 14-day window as payday targets');
