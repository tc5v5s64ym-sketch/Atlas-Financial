'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const fixture = require('./fixtures/budget-funding-data');
const cents = n => Math.round(n * 100);
const run = (data, asOf = data.meta.asOf) => F.recommend(data.plan, asOf, {});
const selected = (advice, date) => advice.payPeriodViews.find(p => p.start === date);
const data = fixture();
const original = JSON.stringify(data);
const advice = run(data);
const first = selected(advice, '2026-08-14');
const next = selected(advice, '2026-08-28');
// Second method: income minus the independently supplied bill/target amounts,
// then latest-feasible funding: $600 due less next period's $350 = $250 now.
assert.equal(cents(first.balanceAfterDeductions), (1000 - 200 - 300) * 100);
assert.equal(cents(next.balanceAfterDeductions), (1000 - 200 - 150 - 300) * 100);
assert.equal(first.plannedCostFunding.status, 'ready');
assert.equal(first.plannedCostFunding.capacity, 500);
assert.equal(next.plannedCostFunding.capacity, 350);
assert.equal(first.plannedCostFunding.contribution, 600 - 350);
assert.equal(next.plannedCostFunding.contribution, 350);
assert.equal(first.plannedCostFunding.items[0].cumulativeProposed, 250);
assert.equal(first.plannedCostFunding.items[0].remainingGap, 350);
assert.equal(next.plannedCostFunding.items[0].cumulativeProposed, 600);
assert.equal(next.plannedCostFunding.items[0].remainingGap, 0);
assert.equal(first.plannedCostFunding.afterProposedFunding, 500 - 250);
assert.equal(next.plannedCostFunding.afterProposedFunding, 350 - 350);
assert.equal(next.plannedCostFunding.projectedPayments[0].amount, 600);
assert.equal(next.plannedCostFunding.projectedPayments[0].protectedConsumed, 600);
assert.equal(first.plannedCostFunding.actualSaved, null);
assert.equal(first.plannedCostFunding.items[0].actualSaved, null);
assert.equal(first.plannedCostFunding.originalPaydayPlan, null);
assert.notEqual(advice.planSpendPaydayFunding.paydays[0].capacity,
  first.plannedCostFunding.capacity, 'incumbent cap schedule is different and cannot substitute');
assert.equal(JSON.stringify(data), original, 'publication never mutates the input/targets');

// Opening cash can protect the cash path; it is not period income or a new
// contribution source. The exact same period-income capacities remain.
const rich = fixture(); rich.plan.startingCash.breakdown[0].value = 100000;
const richFirst = selected(run(rich), '2026-08-14');
assert.equal(richFirst.incomeTotal, 1000);
assert.equal(richFirst.plannedCostFunding.capacity, 500);
assert.equal(richFirst.plannedCostFunding.contribution, 250);

// An annual protected bill is already in the bill deduction. Earmarking and
// paying it must not charge the same dollar twice. Gross funding capacity is
// $350; consumption of the $600 proposed reserve offsets that bill once.
const annual = fixture(); annual.plan.commitments = [];
annual.plan.bills.push({ id: 'annual-cost', label: 'Annual protected cost', amount: 600,
  frequency: 'yearly', month: 9, day: 10, firstDue: '2026-09-10', jointCash: false, confidence: 'confirmed' });
const annualAdvice = run(annual);
const annualFirst = selected(annualAdvice, '2026-08-14').plannedCostFunding;
const annualNextPeriod = selected(annualAdvice, '2026-08-28');
const annualNext = annualNextPeriod.plannedCostFunding;
assert.equal(annualFirst.contribution, 250);
assert.equal(annualNextPeriod.periodBillLoad, 200 + 150 + 600);
assert.equal(annualNext.capacity, 1000 - 200 - 150 - 300);
assert.equal(annualNext.billPaymentsAlreadyDeducted, 600);
assert.equal(annualNext.proposedFundingForBillPayments, 600);
assert.equal(annualNext.afterProposedFunding, 1000 - 200 - 150 - 600 - 300 - 350 + 600);
assert.equal(annualNext.afterProposedFunding, 0);

// Between paydays, no original allocation or missing actual spending is
// invented. Names/cost evidence remain accessible while money claims close.
const between = run(fixture(), '2026-08-20');
for (const p of between.payPeriodViews.filter(p => p.end >= '2026-08-20')) {
  assert.equal(p.plannedCostFunding.status, 'unavailable');
  assert.equal(p.plannedCostFunding.contribution, null);
  assert.equal(p.plannedCostFunding.items[0].label, 'Named cost');
  assert.equal(p.plannedCostFunding.items[0].cumulativeProposed, null);
}

// A complete posted current tail permits next-period proposals, without
// subtracting its $250 remaining groceries from the next period's $350 basis.
const posted = fixture(); posted.meta.asOf = posted.plan.opening.asOf = '2026-08-20';
posted.plan.startingCash.breakdown[0].value = 800;
const packet = { schema: 'atlas-current-period-actuals/v1', observationAsOf: '2026-08-20',
  coverageStart: '2026-08-14', coverageThrough: '2026-08-20', pendingCoverage: 'complete',
  transactions: [{ id: 'synthetic-groceries', date: '2026-08-19', amount: 50,
    account: 'chequing-a', categoryLabel: 'Groceries', displayedPayee: 'Groceries', pending: false }] };
const postedAdvice = F.recommend(posted.plan, posted.meta.asOf, { currentPeriodActuals: packet });
assert.equal(selected(postedAdvice, '2026-08-14').plannedCostFunding.contribution, null);
const postedNext = selected(postedAdvice, '2026-08-28').plannedCostFunding;
assert.equal(postedNext.capacity, 1000 - 200 - 150 - 300);
assert.equal(postedNext.contribution, 350);
assert.equal(postedNext.gap.shortBy, 600 - 350);
for (const change of ['pending', 'unknown-coverage', 'earlier-cash-gap']) {
  const altered = structuredClone(packet), alteredPlan = structuredClone(posted.plan);
  if (change === 'pending') altered.transactions[0].pending = true;
  if (change === 'unknown-coverage') altered.pendingCoverage = 'unknown';
  if (change === 'earlier-cash-gap') alteredPlan.startingCash.breakdown[0].value = 100;
  assert.equal(selected(F.recommend(alteredPlan, posted.meta.asOf, { currentPeriodActuals: altered }),
    '2026-08-28').plannedCostFunding.contribution, null, `${change} must not be released into a future proposal`);
}

// Cost trust is not funding trust: estimated costs weaken all downstream
// proposals; unknown cost trust cannot print a precise funding amount.
const estimated = fixture(); estimated.plan.commitments[0].confidence = 'estimated';
assert.equal(selected(run(estimated), '2026-08-14').plannedCostFunding.trust, 'estimated');
const unknown = fixture(); unknown.plan.commitments[0].confidence = 'unknown';
assert.equal(selected(run(unknown), '2026-08-14').plannedCostFunding.contribution, null);

const zero = fixture(); zero.plan.commitments = [];
assert.equal(selected(run(zero), '2026-08-14').plannedCostFunding.contribution, 0);
const held = fixture(); held.plan.commitments.push({ id: 'held', label: 'Undated estimate',
  when: 'Unknown', amount: 50, confidence: 'estimated' });
const heldRows = selected(run(held), '2026-08-14').plannedCostFunding.unscheduled;
assert.equal(heldRows.find(r => r.id === 'held').contribution, null);
assert.equal(heldRows.find(r => r.id === 'held').date, null);

// An old unresolved obligation still consumes the opening. It cannot be
// silently released by the income-only Budget view's narrower window.
const prior = fixture(); prior.plan.bills.push({ id: 'prior', label: 'Earlier obligation',
  frequency: 'once', date: '2026-08-10', amount: 75, confidence: 'confirmed' });
const priorFirst = selected(run(prior), '2026-08-14');
assert.equal(priorFirst.periodBillLoad, 200 + 75);
assert.equal(priorFirst.plannedCostFunding.capacity, 1000 - 200 - 75 - 300);
assert.equal(priorFirst.plannedCostFunding.afterProposedFunding, 1000 - 200 - 75 - 300 - 250);

for (const amount of [null, false, '', '600', -1, NaN, Infinity]) {
  const invalid = fixture(); invalid.plan.commitments[0].amount = amount;
  const funding = selected(run(invalid), '2026-08-14').plannedCostFunding;
  assert.equal(funding.status, 'unavailable', `invalid cost ${String(amount)} cannot be zero/precise`);
  assert.equal(funding.contribution, null);
  assert.equal(funding.items[0].label, 'Named cost');
  assert.equal(funding.items[0].cost, null);
}
for (const source of ['income', 'bills']) {
  const invalid = fixture(); invalid.plan[source][0].confidence = 'unknown';
  assert.equal(selected(run(invalid), '2026-08-14').plannedCostFunding.contribution, null);
}
const missingConfidence = fixture(); delete missingConfidence.plan.commitments[0].confidence;
assert.equal(selected(run(missingConfidence), '2026-08-14').plannedCostFunding.trust, 'estimated');

const gapData = fixture(); gapData.plan.commitments[0].amount = 1000;
const gapAdvice = run(gapData);
const gap = selected(gapAdvice, '2026-08-14').plannedCostFunding;
assert.equal(gap.status, 'funding-gap');
assert.equal(gap.gap.shortBy, 1000 - 500 - 350);
assert.equal(gap.items[0].remainingGap, 1000 - 500);
assert.equal(gap.items[0].projectedFullyFunded, null);
assert.equal(selected(gapAdvice, '2026-08-28').plannedCostFunding.contribution, null,
  'the allocator stops at the first gap; a later missing row is not zero');

const range = fixture(); delete range.plan.commitments[0].amount;
Object.assign(range.plan.commitments[0], { amountMin: 600, amountMax: 650, confidence: 'estimated' });
const rangeNext = selected(run(range), '2026-08-28').plannedCostFunding;
assert.equal(rangeNext.items[0].cost, 600);
assert.equal(rangeNext.items[0].ceiling, 650);
assert.equal(rangeNext.items[0].cumulativeProposed, 600, 'range does not invent a midpoint');
assert.deepEqual(rangeNext.projectedPayments, [], 'range reserve has no fabricated payment');

const cadence = fixture(); cadence.plan.budget.categories.push({ id: 'pets', label: 'Dog food',
  plannedPayday: 50, paydayCadence: 'every-other-seaspan', paydayCadenceAnchor: '2026-08-14' });
const cadenceAdvice = run(cadence);
assert.equal(selected(cadenceAdvice, '2026-08-14').plannedCostFunding.capacity, 1000 - 200 - 300 - 50);
assert.equal(selected(cadenceAdvice, '2026-08-28').plannedCostFunding.capacity, 1000 - 200 - 150 - 300);
assert.equal(selected(cadenceAdvice, '2026-08-14').plannedCostFunding.contribution, 600 - 350);

const year = fixture(); year.meta.asOf = year.plan.opening.asOf = '2026-12-18';
year.plan.bills.pop(); year.plan.commitments[0].date = '2027-01-14';
year.plan.payrollPlanningAssumptions = { salaryRaiseFactor: 1.04, bonusRate: 0, authorizedThroughYear: 2027 };
const yearAdvice = run(year);
const january = selected(yearAdvice, '2027-01-01');
assert.equal(january.end, '2027-01-14');
assert.equal(january.plannedCostFunding.trust, 'estimated');
assert.equal(january.plannedCostFunding.capacity, 3849.40 - 200 - 300,
  'cash walk uses Budget\'s incumbent 2027 estimated income, not the old $1000 salary');
assert.equal(january.plannedCostFunding.afterProposedFunding, 3849.40 - 200 - 300 - 600);
assert.equal(selected(yearAdvice, '2026-12-18').plannedCostFunding.contribution, 0);
assert.equal(selected(yearAdvice, '2026-12-18').plannedCostFunding.end, '2026-12-31');
// Unsettled overdue required principal — point and dated-range forms — and
// unresolved all-dates pending household-cash debits still encumber the same
// dollars the incumbent protects. Proposals are withheld, never released as
// ready; the rows keep their names and amounts (no zeroing, no hiding).
const overdue = fixture(); overdue.plan.commitments.push({ id: 'overdue-cost', label: 'Overdue cost',
  date: '2026-08-10', amount: 1000, confidence: 'confirmed' });
const overdueFunding = selected(run(overdue), '2026-08-14').plannedCostFunding;
assert.equal(overdueFunding.status, 'unavailable');
assert.equal(overdueFunding.contribution, null);
assert.equal(overdueFunding.items.find(r => r.id === 'overdue-cost').cost, 1000);
assert.match(overdueFunding.reason, /overdue/i);

const overdueRange = fixture(); overdueRange.plan.commitments.push({ id: 'overdue-range',
  label: 'Overdue range', date: '2026-08-10', amountMin: 1000, amountMax: 1100,
  confidence: 'confirmed' });
const overdueRangeFunding = selected(run(overdueRange), '2026-08-14').plannedCostFunding;
assert.equal(overdueRangeFunding.status, 'unavailable');
assert.equal(overdueRangeFunding.contribution, null);
assert.match(overdueRangeFunding.reason, /overdue/i);

const priorPending = fixture();
const priorPacket = { schema: 'atlas-current-period-actuals/v1', observationAsOf: '2026-08-14',
  coverageStart: '2026-08-01', coverageThrough: '2026-08-14', pendingCoverage: 'complete',
  transactions: [{ id: 'synthetic-pending', date: '2026-08-13', amount: 1000,
    account: 'chequing-a', accountRole: 'household-cash', categoryLabel: 'Groceries',
    displayedPayee: 'Groceries', pending: true }] };
const priorPendingFunding = selected(
  F.recommend(priorPending.plan, '2026-08-14', { currentPeriodActuals: priorPacket }),
  '2026-08-14').plannedCostFunding;
assert.equal(priorPendingFunding.status, 'unavailable');
assert.equal(priorPendingFunding.contribution, null);
assert.match(priorPendingFunding.reason, /pending/i);

console.log('PASS Budget funding: independent capacity/contribution/gap arithmetic, payment conservation, original/actual unavailable, trust and old-obligation protection');
