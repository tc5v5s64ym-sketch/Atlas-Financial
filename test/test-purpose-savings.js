'use strict';
// Synthetic balances/requirements only. Real account IDs never enter this proof.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const F = require('../public/forecast');
const O = require('../scripts/provider-observe');
const UI = require('../public/savings-inventory');
const { propertyTaxFixture, AS_OF, clone } = require('./fixtures/savings-earmarks');
const { withServer } = require('./test-savings-evidence-integration');
const { renderSurfaces } = require('./test-savings-earmarks-integration');
const BASE = 'ffe46ebe8201a130ed80843d489a91dc9f033d01';
function purposeFixture() {
  const x = propertyTaxFixture(), pools = x.data.plan.savingsEarmarks.pools;
  Object.assign(pools[0], { role: 'purpose-reserve', purpose: 'Synthetic sports',
    goalRefs: [{ kind: 'commitment', id: 'trip-a' }] });
  Object.assign(pools[1], { accountId: 'savings-dont-touch', role: 'purpose-reserve',
    purpose: 'Synthetic property tax and insurance', reconciledOn: AS_OF,
    goalRefs: [{ kind: 'budget-reserve', id: 'synthetic-property-tax' }, { kind: 'yearly-bill', id: 'annual-a' }] });
  x.data.plan.startingCash.heldElsewhere = [{ id: 'savings-dont-touch', value: 17.23, class: 'purpose-reserve' }];
  x.map.mappings.find(m => m.canonical.id === 'savings').atlasRole = 'household-reserve';
  x.map.mappings.find(m => m.canonical.id === 'synthetic-reserve-b').canonical.id = 'savings-dont-touch';
  x.data.plan.savingsEarmarks.history = [];
  return x;
}
async function main() {
  const x = purposeFixture(), p = x.data.plan;
  assert.equal(F.savingsEarmarksState(p, AS_OF).status, 'ready');
  const ctx = { module: { exports: {} }, exports: {}, console };
  vm.runInNewContext(execFileSync('git', ['show', BASE + ':public/forecast.js'], { encoding: 'utf8' }), ctx);
  assert.equal(ctx.module.exports.savingsInventory(p, AS_OF).status, 'invalid', 'immutable main rejects the unimplemented cutover');
  const eventsBefore = JSON.stringify(ctx.module.exports.expandEvents(p, AS_OF, '2026-11-18'));
  assert.equal(JSON.stringify(F.expandEvents(p, AS_OF, '2026-11-18')), eventsBefore, 'purpose references create no new cash events');
  const liveMap = clone(x.map); liveMap.scope = 'live';
  O.assertLiveMap(liveMap, { data: x.data });
  const isolated = clone(p);
  isolated.income = []; isolated.bills = []; isolated.obligations = []; isolated.budget.categories = [];
  isolated.commitments = [{ id: 'shortfall-proof', label: 'Synthetic cost', date: '2026-08-21', amount: 1200, confidence: 'confirmed' }];
  isolated.savingsEarmarks.pools.forEach(pool => { pool.goalRefs = []; });
  isolated.savingsPoolObservation = { asOf: AS_OF, accounts: [{ accountId: 'savings', value: 9999,
    currency: 'CAD', evidenceDate: AS_OF, pendingState: 'clear', source: 'provider-observe:lunchmoney' }] };
  const need = F.baselineTrajectory(isolated, [], AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
  assert.equal(need.amount, 1200 - 1000, 'independent cost less operating cash is the whole cash need');
  assert.equal(need.fundedByDesignatedSavings.amount, null, 'even abundant sports cash does not implicitly back the 200 shortfall');
  assert.equal(need.remainingAdditionalCashRequired.amount, null, 'no assumed funding decomposition');
  for (const id of ['savings', 'savings-dont-touch']) {
    const bad = clone(liveMap); bad.mappings.find(m => m.canonical.id === id).atlasRole = 'household-cash';
    assert.throws(() => O.assertLiveMap(bad, { data: x.data }), /unsupported-atlas-role/, 'both purpose identities require reserve routing');
  }
  for (const edit of [
    q => { q.savingsEarmarks.pools[1] = null; },
    q => { delete q.savingsEarmarks.pools[1].reconciledOn; },
    q => { q.startingCash.heldElsewhere[0].class = 'staging'; },
    q => { q.startingCash.heldElsewhere.push(clone(q.startingCash.heldElsewhere[0])); },
    q => { q.startingCash.breakdown.push(clone(q.startingCash.heldElsewhere[0])); },
    q => { q.savingsEarmarks.pools[1].accountId = 'amanda-debt-payments'; },
    q => { q.savingsEarmarks.pools[1].accountId = 'chequing-a'; },
    q => { q.savingsEarmarks.pools[1].accountId = 'alias-for-staging'; },
    q => { q.savingsEarmarks.pools[1].goalRefs[0].amount = 0; },
    q => { q.savingsEarmarks.pools[0].goalRefs.push(clone(q.savingsEarmarks.pools[0].goalRefs[0])); },
  ]) {
    const bad = clone(p); edit(bad);
    assert.equal(F.savingsInventory(bad, AS_OF).status, 'invalid');
    assert.equal(F.savingsInventory(bad, AS_OF).incrementalInstructions, 'withheld');
  }
  const malformed = clone(p); malformed.startingCash.breakdown = [{ id: 'synthetic-cash', value: 73 }];
  malformed.savingsEarmarks.pools = {};
  assert.equal(F.startingCashAmount(malformed), 73, 'malformed configuration cannot throw in legacy cash fallback');
  assert.equal(F.savingsInventory(malformed, AS_OF).status, 'invalid');
  // Independent cash conservation: 1000 operating + 301.17 + 144.08 reserve.
  // Neither observed reserve replaces history nor enters the operating walk.
  await withServer(x, async server => {
    const served = await server.get(), rendered = renderSurfaces(served), inv = rendered.advice.savingsInventory;
    assert.equal(served.liveOverlay.applied, true);
    assert.equal(F.startingCashAmount(served.plan), 1000);
    assert.equal(Math.round(inv.pools.reduce((sum, row) => sum + row.observedCash, 0) * 100), 30117 + 14408);
    assert.deepEqual(served.plan.savingsEarmarks.history, []);
    assert.deepEqual(served.plan.startingCash.heldElsewhere, p.startingCash.heldElsewhere, 'dated staging stock stays historical');
    for (const row of inv.pools) {
      assert.equal(row.status, 'intent-unknown'); assert.equal(row.intentKnown, false);
      for (const key of ['intent', 'unallocated', 'deficit', 'confirmedAt', 'revision']) assert.equal(row[key], null);
      for (const goal of row.plannedGoals) { assert.equal(goal.intent, null); assert.equal(goal.backed, null); }
    }
    assert.match(rendered.html, /Synthetic property tax/);
    assert.match(rendered.html, /assignment and backing await confirmation/);
    assert.equal(inv.pools[1].plannedGoals[0].target, 487.63);
    assert.equal(inv.pools[1].plannedGoals[0].targetTrust, 'estimated');
    assert.equal(rendered.advice.planSpendPaydayFunding.status, 'unavailable');
    const acr = F.baselineTrajectory(served.plan, served.debts, AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
    assert.equal(acr.fundedByDesignatedSavings.amount, null);
    assert.equal(acr.remainingAdditionalCashRequired.amount, null);
    assert.match(acr.fundedByDesignatedSavings.reason, /Purpose savings/);
    // Removing observed savings does not move the chequing walk or its total need.
    const without = clone(served.plan); delete without.savingsPoolObservation;
    assert.deepEqual(F.simulate(served.plan, AS_OF, { horizonDays: 90, weeklyVariable: 0 }), F.simulate(without, AS_OF, { horizonDays: 90, weeklyVariable: 0 }));
    const moved = purposeFixture();
    moved.payload.accounts.find(a => a.id === 1003).balance -= 20;
    moved.payload.accounts.find(a => a.id === 1004).balance += 20;
    moved.payload.transactions.push(
      { id: 96001, account_id: 1003, date: AS_OF, amount: 20, payee: 'CD321 TFR-TO', is_pending: false },
      { id: 96002, account_id: 1004, date: AS_OF, amount: -20, payee: 'CD321 TFR-FR', is_pending: false });
    server.write(moved); const refreshed = await server.get();
    assert.equal(F.startingCashAmount(refreshed.plan), 1000);
    assert.deepEqual(refreshed.plan.savingsEarmarks.history, []);
    const actuals = refreshed.liveOverlay.currentPeriodActuals;
    for (const tx of actuals.transactions.filter(t => t.tfrReference === 'CD321')) {
      assert.equal(F.classifyCurrentPeriodTransaction(tx, refreshed.plan, { currentPeriodActuals: actuals }).kind, 'internal-movement');
    }
    const missing = purposeFixture(); missing.payload.accounts = missing.payload.accounts.filter(a => a.id !== 1004);
    server.write(missing); const missingOut = renderSurfaces(await server.get()).advice.savingsInventory;
    assert.equal(missingOut.pools[1].status, 'cash-unknown'); assert.equal(missingOut.pools[1].intent, null);
  });
  // Production input diff oracle: no opening, balance, requirement or event edit.
  const before = JSON.parse(execFileSync('git', ['show', BASE + ':data.json'], { encoding: 'utf8' }));
  const after = require('../data.json');
  const normalize = d => {
    const copy = clone(d); delete copy.plan.savingsEarmarks;
    for (const row of [...copy.plan.startingCash.breakdown, ...copy.plan.startingCash.heldElsewhere]) {
      if (['savings', 'savings-dont-touch'].includes(row.id)) { delete row.label; delete row.class; delete row.note; }
    }
    for (const row of copy.assets) if (['savings', 'savings-dont-touch'].includes(row.cash)) { delete row.label; delete row.class; }
    return copy;
  };
  assert.deepEqual(normalize(after), normalize(before));
  assert.equal(F.savingsEarmarksState(after.plan, '2026-10-03').status, 'ready');
  assert.deepEqual(after.plan.savingsEarmarks.history, []);
  assert.ok(UI.html(F.savingsInventory(after.plan, '2026-10-03')).includes('Starting goal assignments have not been supplied'));
  console.log('PASS purpose savings: explicit canonical cutover, strict reserve routing, immutable-main events, unknown baseline, independent cash conservation, real authenticated overlay and both surfaces, transfers, missing evidence and unchanged production financial inputs');
}
module.exports = { purposeFixture, main };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
