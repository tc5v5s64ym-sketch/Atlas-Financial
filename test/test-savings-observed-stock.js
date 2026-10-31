'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const fixture = require('./fixtures/planned-savings-clarity-data');
const base = () => fixture('backed-ready').plan;
const AS_OF = fixture('backed-ready').meta.asOf;
const inventory = plan => F.savingsInventory(plan, AS_OF);
const assertUnknown = plan => {
  const before = JSON.stringify(plan), packet = inventory(plan), stock = packet.observedStock;
  assert.equal(stock.status, 'unavailable'); assert.equal(stock.amount, null);
  assert.equal(stock.trust, 'unknown'); assert.equal(stock.evidenceTrust, 'unknown');
  assert.deepEqual(stock.accountIds, []); assert.equal(stock.nonAdditive, true);
  assert.equal(JSON.stringify(plan), before, 'invalid input is not repaired or mutated');
};
let plan = base(), before = JSON.stringify(plan), packet = inventory(plan);
const noObservation = base(); delete noObservation.savingsPoolObservation;
assert.equal(Object.hasOwn(inventory(noObservation), 'reportedStock'), false,
  'absent observation preserves the incumbent publication shape');
const malformedObservation = base(); malformedObservation.savingsPoolObservation = null;
assert.equal(inventory(malformedObservation).reportedStock.amount, null,
  'a supplied malformed observation publishes unavailable, never zero');
assert.deepEqual(packet.observedStock, { status: 'ready', asOf: AS_OF, currency: 'CAD',
  basis: 'observed-savings-stock', nonAdditive: true, amount: 500.03,
  trust: 'calculated', evidenceTrust: 'verified', accountIds: ['savings', 'savings-dont-touch'],
  pendingState: 'clear', reason: null });
assert.equal(packet.goals[0].backed, 215.04, '16937 + 4567 confirmed cents remain separate');
assert.equal(JSON.stringify(plan), before);
plan.savingsPoolObservation.accounts.reverse();
plan.savingsPoolObservation.accounts.push({ accountId: 'unrelated-cash', value: 987.65 });
assert.equal(inventory(plan).observedStock.amount, 500.03, 'join by configured account identity, never row order or unrelated cash');
for (const values of [[0, 0, 0], [-12.34, 20.01, 7.67], [1.01, 2.02, 3.03]]) {
  plan = base(); plan.savingsPoolObservation.accounts.forEach((row, i) => { row.value = values[i]; });
  assert.equal(inventory(plan).observedStock.amount, values[2], 'independent signed exact-cent addition; zero stays known');
}
for (const mutate of [
  p => { delete p.savingsPoolObservation; },
  p => { p.savingsPoolObservation = []; },
  p => { p.savingsPoolObservation.asOf = '2026-08-13'; },
  p => { p.savingsPoolObservation.asOf = '2026-08-15'; },
  p => { p.savingsPoolObservation.accounts = {}; },
  p => { p.savingsPoolObservation.accounts = null; },
  p => { p.savingsPoolObservation.accounts.pop(); },
  p => { p.savingsPoolObservation.accounts.push({ ...p.savingsPoolObservation.accounts[0] }); },
  p => { p.savingsPoolObservation.accounts.push({ ...p.savingsPoolObservation.accounts[1], value: 0 }); },
  p => { p.savingsPoolObservation.accounts[1].accountId = 'savings'; },
  p => { p.savingsPoolObservation.accounts[0].accountId = 'unrelated-cash'; },
  p => { p.savingsPoolObservation.accounts[1].currency = 'USD'; },
  p => { p.savingsPoolObservation.accounts[1].source = 'opening'; },
  p => { p.savingsPoolObservation.accounts[1].evidenceDate = '2026-08-13'; },
  p => { p.savingsPoolObservation.accounts[1].evidenceDate = '2026-08-15'; },
  p => { p.savingsPoolObservation.accounts[1].evidenceDate = '2026-02-30'; },
  p => { p.savingsEarmarks.pools[1].accountId = 'savings'; },
  p => { p.savingsEarmarks.pools[1].id = p.savingsEarmarks.pools[0].id; },
  p => { p.savingsEarmarks.pools.pop(); },
  p => { p.savingsEarmarks.currency = 'USD'; },
  p => { p.savingsEarmarks.history[0].confirmedAt = '2026-08-15'; },
  p => { p.savingsPoolObservation.accounts.forEach(row => { row.value = 50000000000000; }); },
]) { plan = base(); mutate(plan); assertUnknown(plan); }
for (const value of [undefined, null, '', '200.02', false, {}, [], NaN, Infinity, -Infinity, 1.001, Number.MAX_VALUE]) {
  plan = base(); plan.savingsPoolObservation.accounts[1].value = value; assertUnknown(plan);
}
for (const asOf of ['2026-02-30', null, '', '2026-08-14T00:00:00Z']) {
  assert.equal(F.savingsInventory(base(), asOf).observedStock.amount, null, 'invalid request date fails closed');
}
plan = base(); plan.savingsEarmarks.history = [];
packet = inventory(plan);
assert.equal(packet.observedStock.amount, 500.03);
assert.equal(packet.goals.length, 0); assert.equal(packet.pools[0].intent, null);
assert.equal(packet.incrementalInstructions, 'withheld', 'stock does not create allocation or transfer permission');
plan = base(); plan.savingsPoolObservation.accounts[0].pendingState = 'unknown';
packet = inventory(plan);
assert.equal(packet.observedStock.amount, 500.03, 'known posted stock is distinct from pending movement coverage');
assert.equal(packet.observedStock.pendingState, 'unresolved');
assert.equal(packet.goals[0].backed, null, 'unresolved movement evidence still withholds goal backing');
plan = base(); before = JSON.stringify(plan);
const advice = F.recommend(plan, AS_OF, {});
const period = advice.payPeriodViews.find(row => row.timelineRole === 'current');
assert.equal(period.plannedCostFunding.contribution, 177.96);
assert.equal(period.plannedCostFunding.afterProposedFunding, 322.04,
  'independent fixture ledger: 1000 income - 200 bills - 300 household - 17796 cents proposed = 32204 cents');
assert.equal(advice.savingsInventory.observedStock.amount, 500.03);
assert.equal(JSON.stringify(plan), before);
console.log('PASS observed savings stock: distinct account joins, no partial sums, signed cents/zero, strict invalid evidence, unconfirmed/pending backing and unchanged period deductions');
