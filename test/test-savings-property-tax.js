'use strict';
// Synthetic requirements and cents; no production balance is a specification.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const F = require('../public/forecast');
const { AS_OF, observedPlan, propertyTaxFixture, clone } = require('./fixtures/savings-earmarks');
const input = propertyTaxFixture(), plan = input.data.plan;
plan.savingsPoolObservation = observedPlan().savingsPoolObservation;
const configBefore = clone(plan.savingsEarmarks), categoriesBefore = clone(plan.budget.categories);
const out = F.savingsInventory(plan, AS_OF), pool = out.pools[1];
const tax = out.goals.find(g => g.key === 'budget-reserve:synthetic-property-tax');
assert.equal(out.status, 'ready');
assert.equal(tax.label, 'Synthetic property tax');
assert.equal(tax.target, 487.63);
assert.equal(tax.targetTrust, 'estimated', 'confirmed purpose does not promote an estimated requirement');
assert.equal(tax.intent, 103.27); assert.equal(tax.backed, 103.27);
assert.equal(pool.intent, 114.40); assert.equal(pool.unallocated, 29.68);
assert.equal(BigInt(Math.round(pool.observedCash * 100)), 10327n + 1113n + 2968n,
  'independent cash partition: property-tax intent + insurance intent + residual');
assert.deepEqual(plan.savingsEarmarks, configBefore); assert.deepEqual(plan.budget.categories, categoriesBefore);

// The immutable pre-change engine rejects this reference, demonstrating the
// missing capability rather than building the expected result with F itself.
const BASE = '0c15c462bfbc2c6559eb4a580660ab682bec4699';
const context = { module: { exports: {} }, exports: {}, console };
vm.runInNewContext(execFileSync('git', ['show', BASE + ':public/forecast.js'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }), context);
assert.equal(context.module.exports.savingsInventory(plan, AS_OF).status, 'invalid');

// Unknown setup is not zero funding, even when the requirement is known.
const unknown = clone(plan); unknown.savingsEarmarks.history = [];
const unknownOut = F.savingsInventory(unknown, AS_OF);
assert.equal(unknownOut.pools[1].status, 'intent-unknown');
assert.equal(unknownOut.pools[1].intent, null); assert.equal(unknownOut.pools[1].unallocated, null);
assert.deepEqual(unknownOut.goals, []);
assert.equal(unknownOut.incrementalInstructions, 'withheld');

// A reference cannot create a second obligation, cash event, or cash pool.
const isolated = clone(plan);
isolated.income = []; isolated.bills = []; isolated.obligations = []; isolated.commitments = []; isolated.groups = [];
isolated.budget.categories = [clone(categoriesBefore.find(c => c.id === 'synthetic-property-tax'))];
isolated.savingsEarmarks.history[0].pools = [{ poolId: 'reserve-b', allocations: [
  { goalRef: { kind: 'budget-reserve', id: 'synthetic-property-tax' }, amount: 103.27 },
] }];
const without = clone(isolated); delete without.savingsEarmarks;
const end = '2026-11-18';
assert.deepEqual(F.expandEvents(isolated, AS_OF, end), F.expandEvents(without, AS_OF, end));
const events = F.expandEvents(isolated, AS_OF, end).filter(e => e.id === 'synthetic-property-tax');
assert.equal(events.length, 1); assert.equal(events[0].kind, 'reserve');
assert.equal(events[0].planningLump, true); assert.equal(events[0].date, '2026-10-21');
assert.equal(events[0].amount, -487.63);
const simOpts = { horizonDays: 90, weeklyVariable: 0 };
const sim = F.simulate(isolated, AS_OF, simOpts);
assert.deepEqual(sim, F.simulate(without, AS_OF, simOpts));
assert.equal(F.startingCashAmount(isolated), 1000, 'both reserves remain outside chequing cash');
assert.equal(sim.ending, 512.37, 'independent sole cash event: 1000 - 487.63');

// Requirement edits do not release confirmed intent; a planning date alone
// is never proof of settlement. Missing/ambiguous identities withhold backing.
for (const edit of [
  p => { p.budget.categories = p.budget.categories.filter(c => c.id !== 'synthetic-property-tax'); },
  p => { p.budget.categories.find(c => c.id === 'synthetic-property-tax').class = 'essential'; },
  p => { p.budget.categories.push(clone(p.budget.categories.find(c => c.id === 'synthetic-property-tax'))); },
  p => { p.commitments.push({ id: 'synthetic-property-tax', amount: 487.63 }); },
  p => { p.bills.push({ id: 'synthetic-property-tax', amount: 487.63, frequency: 'yearly' }); },
]) {
  const changed = clone(plan); edit(changed);
  const inventory = F.savingsInventory(changed, AS_OF);
  assert.equal(inventory.pools[1].status, 'goal-unresolved');
  assert.equal(inventory.pools[1].intent, 114.40);
  assert.equal(inventory.pools[1].allocations[0].backed, null);
}
for (const amount of [null, undefined, 487.631, -1, '487.63']) {
  const changed = clone(plan); changed.budget.categories.find(c => c.id === 'synthetic-property-tax').plannedAmount = amount;
  const goal = F.savingsInventory(changed, AS_OF).goals.find(g => g.goalRef.kind === 'budget-reserve');
  assert.equal(goal.target, null); assert.equal(goal.targetTrust, 'unknown'); assert.equal(goal.intent, 103.27);
}
const reduced = clone(plan); reduced.budget.categories.find(c => c.id === 'synthetic-property-tax').plannedAmount = 10;
assert.equal(F.savingsInventory(reduced, AS_OF).goals.find(g => g.goalRef.kind === 'budget-reserve').intent, 103.27);
const past = clone(plan); past.budget.categories.find(c => c.id === 'synthetic-property-tax').planningDate = '2026-08-19';
assert.equal(F.savingsInventory(past, AS_OF).goals.find(g => g.goalRef.kind === 'budget-reserve').settled, false);
assert.equal(F.savingsInventory(past, AS_OF).goals.find(g => g.goalRef.kind === 'budget-reserve').target, 487.63);
const duplicate = clone(plan);
duplicate.savingsEarmarks.history[0].pools[1].allocations.push(clone(duplicate.savingsEarmarks.history[0].pools[1].allocations[0]));
assert.equal(F.savingsInventory(duplicate, AS_OF).status, 'invalid');
const alias = clone(plan);
alias.commitments.push({ id: 'synthetic-property-tax', group: 'club-a', amount: 487.63 });
alias.savingsEarmarks.history[0].pools[0].allocations.push({ goalRef: { kind: 'group', id: 'club-a' }, amount: 1 });
assert.equal(F.savingsInventory(alias, AS_OF).status, 'invalid', 'cross-source group alias cannot pledge a reserve twice');
console.log('PASS Budget-reserve savings references: independent cents, immutable before/after, one unchanged obligation/event, unknown setup, estimated requirements, unresolved aliases and no inferred settlement');
