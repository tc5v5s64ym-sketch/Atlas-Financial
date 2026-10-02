'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const UI = require('../public/savings-inventory');
const { AS_OF, observedPlan, fixture, clone } = require('./fixtures/savings-earmarks');
const cents = number => BigInt(Math.round(number * 100));
function inventory(plan) { return F.savingsInventory(plan, AS_OF); }
const starting = observedPlan(), initial = inventory(starting);
assert.equal(initial.status, 'ready');
assert.deepEqual(initial.pools.map(p => [p.intent, p.unallocated, p.deficit]), [[247.80, 53.37, 0], [99.99, 44.09, 0]]);
assert.deepEqual(initial.goals.map(g => [g.intent, g.backed, g.target]), [[169.37, 169.37, 403.21], [78.43, 78.43, 181.23], [99.99, 99.99, 178.20]]);
// Independent conservation oracle: BigInt equality over the original fixture
// inputs and published partition, rather than calling the producing helpers.
for (const [value, residual, deficit] of [[301.17, 53.37, 0], [326.21, 78.41, 0], [259.06, 11.26, 0], [200, null, 47.80], [-4.21, null, 252.01]]) {
  const plan = clone(starting); plan.savingsPoolObservation.accounts[0].value = value;
  const out = inventory(plan), pool = out.pools[0];
  assert.equal(pool.intent, 247.80); assert.equal(pool.unallocated, residual); assert.equal(pool.deficit, deficit);
  assert.equal(cents(value) + cents(deficit), cents(169.37) + cents(78.43) + cents(residual || 0));
  for (const row of pool.allocations) assert.equal(row.backed, deficit ? null : row.intent);
  assert.equal(out.pools[1].allocations[0].backed, 99.99, 'another pool is independently backed');
  assert.deepEqual(plan.savingsEarmarks, starting.savingsEarmarks, 'inflow/outflow/refund never reassigns purpose');
}
assert.deepEqual(inventory(starting), initial, 'repeat refresh is deterministic');
for (const [edit, status] of [
  [p => { p.savingsPoolObservation.accounts[0].evidenceDate = '2026-08-19'; }, 'stale'],
  [p => { p.savingsPoolObservation.accounts[0].pendingState = 'pending'; }, 'pending-evidence'],
  [p => { p.savingsPoolObservation.accounts[0].pendingState = 'unknown'; }, 'pending-evidence'],
  [p => { p.savingsPoolObservation.accounts[0].currency = 'USD'; }, 'cash-unknown'],
  [p => { p.savingsPoolObservation.accounts[0].value = 301.171; }, 'cash-unknown'],
  [p => { p.savingsPoolObservation.accounts.push(clone(p.savingsPoolObservation.accounts[0])); }, 'cash-unknown'],
  [p => { p.savingsPoolObservation.accounts[0].value = '301.17'; }, 'cash-unknown'],
  [p => { p.savingsPoolObservation.accounts[0].source = 'unproven'; }, 'cash-unknown'],
  [p => { delete p.savingsPoolObservation; }, 'cash-unknown'],
]) {
  const plan = clone(starting); edit(plan); const pool = inventory(plan).pools[0];
  assert.equal(pool.status, status); assert.equal(pool.intent, 247.80); assert.equal(pool.unallocated, null);
  assert.ok(pool.allocations.every(a => a.backed === null));
}
const unknown = clone(starting); unknown.savingsEarmarks.history = [];
assert.equal(inventory(unknown).pools[0].intent, null); assert.equal(inventory(unknown).pools[0].unallocated, null);
const partial = clone(starting); partial.savingsEarmarks.history[0].pools.pop();
assert.equal(inventory(partial).pools[1].intent, null); assert.equal(inventory(partial).pools[0].status, 'backed');
const zero = clone(starting); zero.savingsEarmarks.history[0].pools[0].allocations = [];
assert.equal(inventory(zero).pools[0].intent, 0); assert.equal(inventory(zero).pools[0].unallocated, 301.17);
for (const edit of [
  p => { p.savingsEarmarks.pools[1].accountId = 'savings'; },
  p => { p.savingsEarmarks.pools[1].accountId = 'chequing-a'; },
  p => { p.savingsEarmarks.pools[1].accountId = 'savings-dont-touch'; },
  p => { p.savingsEarmarks.currency = 'USD'; },
  p => { p.savingsEarmarks.history[0].pools[0].allocations[0].amount = 0.001; },
  p => { p.savingsEarmarks.history[0].pools[0].allocations[0].amount = -1; },
  p => { p.savingsEarmarks.history[0].revision = 2; },
  p => { p.savingsEarmarks.history[0].confirmedAt = '2026-02-30'; },
  p => { p.savingsEarmarks.pools[0].balance = 1; },
  p => { p.savingsEarmarks.history[0].pools[0].allocations[0].target = 1; },
  p => { p.savingsEarmarks.history[0].pools[1].allocations.push({ goalRef: { kind: 'commitment', id: 'club-first' }, amount: 1 }); },
  p => { p.savingsEarmarks.history[0].pools[0].allocations.push(clone(p.savingsEarmarks.history[0].pools[0].allocations[0])); },
  p => { p.commitments.push({ id: 'annual-a', label: 'Synthetic competing goal', amount: 181.23 }); p.savingsEarmarks.history[0].pools[1].allocations.push({ goalRef: { kind: 'commitment', id: 'annual-a' }, amount: 1 }); },
]) {
  const plan = clone(starting); edit(plan);
  assert.equal(inventory(plan).status, 'invalid'); assert.equal(inventory(plan).incrementalInstructions, 'withheld');
}
const paid = clone(starting); paid.commitments[0].settledOn = '2026-08-19';
assert.equal(inventory(paid).goals[0].intent, 169.37);
assert.equal(inventory(paid).goals[0].target, 0); assert.equal(inventory(paid).goals[0].settled, true);
const reduced = clone(starting); reduced.commitments[0].amount = 1;
assert.equal(inventory(reduced).goals[0].target, 1); assert.equal(inventory(reduced).goals[0].backed, 169.37);
const missing = clone(starting); missing.commitments.shift();
assert.equal(inventory(missing).pools[0].status, 'goal-unresolved'); assert.equal(inventory(missing).pools[0].intent, 247.80);
const revise = clone(starting); const version = clone(revise.savingsEarmarks.history[0]);
version.revision = 2; version.confirmedAt = AS_OF; version.pools[0].allocations[0].amount = 149.37;
revise.savingsEarmarks.history.push(version);
assert.equal(inventory(revise).pools[0].unallocated, 73.37); assert.equal(revise.savingsEarmarks.history[0].pools[0].allocations[0].amount, 169.37);
const laterIntent = clone(starting); laterIntent.savingsEarmarks.history[0].confirmedAt = '2026-08-21';
assert.equal(inventory(laterIntent).pools[0].intent, 247.80, 'a dated cash opening cannot erase newer confirmed purpose');
assert.equal(inventory(laterIntent).pools[0].status, 'stale'); assert.equal(inventory(laterIntent).pools[0].allocations[0].backed, null);
const transfer = clone(starting); transfer.savingsPoolObservation.accounts[0].value -= 20;
transfer.savingsPoolObservation.accounts[1].value += 20;
assert.equal(cents(inventory(transfer).pools[0].observedCash) + cents(inventory(transfer).pools[1].observedCash), 44525n);
assert.deepEqual(transfer.savingsEarmarks, starting.savingsEarmarks);
const split = clone(starting); split.savingsEarmarks.history[0].pools[1].allocations.push({ goalRef: { kind: 'commitment', id: 'trip-a' }, amount: 5.01 });
assert.equal(inventory(split).goals.filter(g => g.goalRef.id === 'trip-a').length, 1);
assert.equal(inventory(split).goals[0].backed, 174.38, 'same goal across pools counts each confirmed portion once');
assert.equal(F.startingCashAmount(starting), 1000, 'reserve stays outside ordinary cash');
const { data } = fixture(); data.plan = clone(starting);
const advice = F.recommend(data.plan, AS_OF, { debts: data.debts, extraFacilities: data.revolvingExtra });
assert.deepEqual(advice.savingsInventory, initial);
const snapshot = require('../scripts/figures-snapshot').buildFiguresSnapshot(data, null);
assert.equal(snapshot['savings.pool.reserve-a.intent'], 247.80);
assert.equal(snapshot['savings.pool.reserve-a.unallocated'], 53.37);
assert.equal(snapshot['savings.goal.commitment:trip-a.backed'], 169.37);
assert.equal(snapshot['savings.incrementalInstructions'], 'withheld');
assert.equal(advice.planSpendPaydayFunding.status, 'unavailable');
for (const period of advice.payPeriodViews) {
  assert.equal(period.plannedCostFunding.contribution, null);
  if (period.fromTodayFunding) assert.equal(period.fromTodayFunding.contribution, null);
}
const acr = F.baselineTrajectory(data.plan, data.debts, AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
assert.equal(acr.fundedByDesignatedSavings.amount, Math.min(acr.amount, 301.17), 'ACR uses reserve cash once, never goal amounts or pool B');
const silver = clone(starting); silver.silver = { value: 10000 }; silver.assets = [{ id: 'silver', value: 10000 }];
assert.deepEqual(inventory(silver), initial, 'silver in balance is not added or assigned twice');
const hostile = clone(initial); hostile.pools[0].label = '<img src=x onerror=alert(1)>';
const html = UI.html(hostile); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
assert.ok(UI.html(initial).includes('$53.37'));
const empty = clone(starting); delete empty.savingsEarmarks; delete empty.savingsPoolObservation;
assert.equal(inventory(empty).status, 'setup-unknown'); assert.equal(inventory(empty).incrementalInstructions, 'incumbent');
empty.savingsEarmarks = { version: 1, currency: 'CAD', pools: [], history: [] };
assert.equal(inventory(empty).status, 'setup-unknown'); assert.equal(inventory(empty).incrementalInstructions, 'incumbent');
console.log('PASS confirmed savings: independent exact-cent conservation, refresh/deposit/withdrawal/deficit, unknown/stale/pending/currency/aliases, paid/reduced goals, group/silver deduplication, revisions, ACR and proposal withholding');
