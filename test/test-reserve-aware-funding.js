'use strict';
// Synthetic cents only. The independent ledger is not a Forecast helper.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const { backedFixture } = require('./fixtures/reserve-aware-funding');
const clone = x => JSON.parse(JSON.stringify(x));
const cents = x => BigInt(Math.round(x * 100));
const data = backedFixture(), before = JSON.stringify(data);
assert.equal(F.savingsInventory(data.plan, data.meta.asOf).pools[0].status, 'backed');
const advice = F.recommend(data.plan, data.meta.asOf, {});
const first = advice.payPeriodViews.find(p => p.start === '2026-08-14').plannedCostFunding;
const second = advice.payPeriodViews.find(p => p.start === '2026-08-28').plannedCostFunding;
assert.equal(first.status, 'ready', 'backed assignments and their payment cashflows must enable the existing allocator');
// 60,000 required cents = 16,937 actually backed + 8,063 proposed now + 35,000 later.
assert.equal(cents(first.contribution), 8063n);
assert.equal(cents(second.contribution), 35000n);
assert.equal(cents(first.items[0].actualSaved), 16937n);
assert.equal(cents(first.items[0].remainingGap), 35000n);
assert.equal(cents(second.items[0].remainingGap), 0n);
assert.equal(60000n, cents(first.items[0].actualSaved) + cents(first.contribution) + cents(second.contribution));
const payment = second.projectedPayments.find(p => p.id === 'named-cost');
assert.equal(cents(payment.amount), 60000n);
assert.equal(cents(payment.reserveFunded), 16937n);
assert.equal(cents(payment.protectedConsumed), 43063n);
assert.equal(60000n, cents(payment.reserveFunded) + cents(payment.protectedConsumed));
assert.equal(JSON.stringify(data), before, 'projections never write assignments or observations');
console.log('PASS reserve-aware funding: independently backed seed and paired payment conserve synthetic cents');

const run = d => F.recommend(d.plan, d.meta.asOf, {});
const period = (a, start) => a.payPeriodViews.find(p => p.start === start).plannedCostFunding;
const walk = d => F.simulate(d.plan, d.meta.asOf, { horizonDays: 28, viewDays: 28, weeklyVariable: 0 });
const cash = walk(data);
assert.equal(cents(cash.ending), 200000n - 55000n - (60000n - 16937n));
assert.equal(cents(cash.totals.reserveFunding), 16937n);
assert.equal(cents(cash.totals.income), 200000n, 'reserves are never salary');
assert.equal(cents(cash.totals.injections), 0n, 'no borrowing or generic gap injection');
const closingPools = 30117n + 9999n - 16937n;
assert.equal(cents(cash.ending) + closingPools, 30117n + 9999n + 200000n - 55000n - 60000n);
assert.equal(cents(F.startingCashAmount(data.plan)), 0n, 'both reserve stocks stay outside operating cash');
const trajectory = F.baselineTrajectory(data.plan, [], data.meta.asOf, { weeklyVariable: 0 });
assert.equal(trajectory.status, 'ready');
const september = trajectory.months.find(m => m.month === '2026-09');
assert.equal(cents(september.stage2.commitments.amount), 43063n);
assert.equal(cents(september.stage2.commitments.lines[0].fullRequirement), 60000n);
assert.equal(cents(september.stage2.commitments.lines[0].reserveFunded), 16937n);
assert.equal(cents(september.stage2.result.amount), cents(september.stage1.result.amount) - 43063n);
assert.deepEqual(F.projectDebts(data.plan, [], data.meta.asOf, {}).byId, {}, 'reserve payment components invent no debt');

for (const assigned of [600, 800]) {
  const d = backedFixture(); d.plan.savingsPoolObservation.accounts[0].value = 1000;
  d.plan.savingsEarmarks.history[0].pools[0].allocations[0].amount = assigned;
  const a = run(d), first = period(a, '2026-08-14'), second = period(a, '2026-08-28');
  assert.equal(first.contribution, 0); assert.equal(second.contribution, 0);
  assert.equal(first.items[0].actualSaved, 600, 'usable seed is capped at this cost');
  assert.equal(F.savingsInventory(d.plan, d.meta.asOf).pools[0].intent, assigned, 'excess intent is retained');
  assert.equal(walk(d).events.find(e => e.id === 'named-cost').reserveFunding.amount, 600);
  assert.equal(a.planSpendPaydayFunding.costs[0].projectedFullyFunded, d.meta.asOf);
}
const split = backedFixture();
split.plan.savingsEarmarks.history[0].pools[0].allocations[0].amount = 100.01;
split.plan.savingsEarmarks.history[0].pools[1].allocations = [{ goalRef: { kind: 'commitment', id: 'named-cost' }, amount: 69.36 }];
assert.equal(period(run(split), '2026-08-14').contribution, 80.63);
assert.deepEqual(walk(split).events.find(e => e.id === 'named-cost').reserveFunding.parts.map(p => p.amount), [100.01, 69.36]);

const group = backedFixture();
group.plan.commitments = [
  { id: 'first', group: 'club', date: '2026-08-28', amount: 200, confidence: 'confirmed' },
  { id: 'second', group: 'club', date: '2026-09-10', amount: 400, confidence: 'confirmed' },
];
group.plan.groups = [{ id: 'club', label: 'Synthetic grouped club', planSpendSummary: true }];
group.plan.savingsEarmarks.history[0].pools[0].allocations[0].goalRef = { kind: 'group', id: 'club' };
const grouped = run(group);
assert.deepEqual(grouped.planSpendPaydayFunding.costs.map(c => c.actualSaved), [169.37, 0]);
assert.equal(grouped.planSpendPaydayFunding.groups[0].protectedNow, 169.37);
assert.equal(cents(walk(group).totals.reserveFunding), 16937n);

for (const kind of ['yearly-bill', 'budget-reserve']) {
  const d = backedFixture(); d.plan.commitments = [];
  d.plan.savingsEarmarks.history[0].pools[0].allocations[0].goalRef = { kind, id: 'annual' };
  if (kind === 'yearly-bill') d.plan.bills.push({ id: 'annual', label: 'Synthetic annual bill', amount: 600,
    frequency: 'yearly', month: 9, day: 10, firstDue: '2026-09-10', jointCash: false, confidence: 'confirmed' });
  else d.plan.budget.categories.push({ id: 'annual', label: 'Synthetic tax reserve', class: 'reserve',
    plannedAmount: 600, planningDate: '2026-09-10', confidence: 'estimated' });
  const a = run(d), first = period(a, '2026-08-14'), second = period(a, '2026-08-28');
  assert.equal(cents(first.contribution), 8063n); assert.equal(cents(second.contribution), 35000n);
  const payment = second.projectedPayments.find(p => p.id === 'annual');
  assert.equal(cents(payment.reserveFunded) + cents(payment.protectedConsumed), 60000n);
  assert.equal(cents(walk(d).ending), 200000n - 55000n - 43063n);
  if (kind === 'yearly-bill') {
    assert.equal(second.afterProposedFunding, 0, 'gross annual bill is credited once for both sources');
    const annualEvents = F.simulate(d.plan, d.meta.asOf, { horizonDays: 400, viewDays: 400 }).events.filter(e => e.id === 'annual');
    assert.equal(annualEvents.length, 2);
    assert.equal(annualEvents[0].reserveFunding.amount, 169.37);
    assert.equal(annualEvents[1].reserveFunding, undefined, 'assignment cannot finance two yearly occurrences');
    const slice = F.simulate(d.plan, d.meta.asOf, { horizonDays: 28, viewDays: 2, viewStart: '2026-09-09', weeklyVariable: 70 });
    assert.equal(cents(slice.totals.variable), 2000n, 'reserve credits do not eat sliced spending');
    assert.equal(cents(slice.totals.reserveFunding), 16937n);
  } else assert.equal(first.trust, 'estimated', 'a backed assignment cannot verify an estimated tax requirement');
}

for (const edit of [
  p => { p.savingsEarmarks.history = []; },
  p => { p.savingsEarmarks.history[0].pools.pop(); },
  p => { p.savingsPoolObservation.accounts[0].value = 100; },
  p => { p.savingsPoolObservation.accounts[0].pendingState = 'pending'; },
  p => { p.savingsPoolObservation.accounts[0].evidenceDate = '2026-08-13'; },
  p => { p.savingsPoolObservation.accounts[0].currency = 'USD'; },
  p => { p.savingsEarmarks.history[0].confirmedAt = '2026-08-15'; },
  p => { p.commitments[0].date = null; },
  p => { p.commitments[0].amount = null; p.commitments[0].amountMin = 600; p.commitments[0].amountMax = 800; },
  p => { p.savingsEarmarks.history[0].pools[1].allocations = [{ goalRef: { kind: 'commitment', id: 'missing' }, amount: 1 }]; },
]) {
  const d = backedFixture(); edit(d.plan); const original = JSON.stringify(d);
  assert.equal(period(run(d), '2026-08-14').status, 'unavailable');
  assert.equal(walk(d).totals.reserveFunding, 0, 'uncertain backing emits no payment credit');
  assert.equal(JSON.stringify(d), original);
}
const empty = backedFixture(); empty.plan.savingsEarmarks.history[0].pools[0].allocations = [];
assert.equal(period(run(empty), '2026-08-14').contribution, 250, 'confirmed empty and unknown are distinct');
assert.equal(period(run(empty), '2026-08-14').items[0].actualSaved, 0);
const paid = backedFixture(); paid.plan.commitments[0].settledOn = paid.meta.asOf;
assert.equal(walk(paid).totals.reserveFunding, 0);
assert.equal(F.savingsInventory(paid.plan, paid.meta.asOf).pools[0].intent, 169.37, 'payment never releases intent');
const reduced = backedFixture(); reduced.plan.commitments[0].amount = 100;
assert.equal(walk(reduced).totals.reserveFunding, 100);
assert.equal(F.savingsInventory(reduced.plan, reduced.meta.asOf).pools[0].intent, 169.37);
const forged = walk(data); delete forged.events.find(e => e.id === 'named-cost').reserveFunding;
assert.equal(F.planSpendPaydayFunding(data.plan, data.meta.asOf, forged, F.fundingSequence(data.plan, data.meta.asOf, {}), [], null).status, 'unavailable', 'seeding without a matched payment component fails closed');
// PR #482 P1 regression: one backed assignment credits exactly one cash event.
// A same-key income or a differently priced bill alias must never acquire the
// reserve component, and total consumption must never exceed the backing.
for (const alias of [
  { planKey: 'income', entry: { id: 'named-cost', label: 'Synthetic other income', frequency: 'once', date: '2026-09-10', amount: 50, confidence: 'confirmed' }, income: 205000n, bills: 55000n, close: 106937n },
  { planKey: 'bills', entry: { id: 'named-cost', label: 'Synthetic alias bill', frequency: 'once', date: '2026-09-10', amount: 123.47, confidence: 'confirmed' }, income: 200000n, bills: 67347n, close: 89590n },
]) {
  const d = backedFixture();
  d.plan[alias.planKey].push(alias.entry);
  const s = walk(d);
  assert.equal(cents(s.totals.reserveFunding), 16937n, 'alias must not duplicate reserve credit');
  assert.equal(cents(s.totals.income), alias.income, 'reserves are never income');
  assert.equal(cents(s.totals.bills), alias.bills);
  assert.equal(cents(s.ending), alias.close, 'independent cents ledger closes exactly once');
  const aliased = s.events.filter(e => e.id === 'named-cost' && e.date === '2026-09-10');
  assert.equal(aliased.filter(e => e.reserveFunding).length, 1, 'exactly one event carries the component');
  for (const e of aliased) {
    if (e.kind === 'commitment' && cents(-e.amount) === 60000n) {
      assert.equal(cents(e.reserveFunding.amount), 16937n, 'the true expense keeps its component');
    } else {
      assert.equal(e.reserveFunding, undefined, 'alias event must not acquire reserveFunding');
    }
  }
}
assert.deepEqual(run(data), advice, 'repeat refresh is deterministic');
console.log('PASS reserve-aware funding controls: stocks/flows, groups, both pools, annual/tax, evidence gates, exact cents, repeat and no mutation');
