'use strict';
const assert = require('node:assert/strict'), test = require('node:test');
const F = require('../public/forecast'), O = require('../scripts/provider-observe'), L = require('../scripts/live-plan');
const observed = require('./fixtures/savings-observer-contract-data');
for (const mode of ['valid', 'valid-transfer', 'undated', 'null-amount', 'malformed-amount', 'undated-pending',
  'foreign-currency', 'missing-currency', 'malformed-date', 'pending', 'incomplete', 'pending-incomplete'])
  test('actual observer -> overlay -> Forecast: ' + mode, () => {
    const { report, advice } = observed(mode), packet = advice.savingsFunding;
    assert.equal(Object.hasOwn(report.currentPeriodActuals, 'currency'), false, 'the actual contract has no packet currency');
    assert.equal(advice.savingsInventory.reportedStock.amount, mode === 'valid-transfer' ? 129 : 119);
    assert.deepEqual(packet.rows.map(row => row.needed), [230, 24]);
    if (mode === 'valid' || mode === 'valid-transfer') {
      assert.equal(report.currentPeriodActuals.transactions.length, mode === 'valid-transfer' ? 2 : 1);
      assert.equal(report.currentPeriodActuals.transactions[0].currency, 'cad');
      if (mode === 'valid-transfer') assert.equal(F.householdInternalMovements(null, { currentPeriodActuals: report.currentPeriodActuals }).length, 1);
      assert.equal(packet.goalAllocation.status, 'ready', 'genuine CAD evidence must remain usable');
      assert.deepEqual(packet.backing.items.map(row => row.saved), mode === 'valid-transfer' ? [60, 24, 45] : [60, 24, 35]);
    } else {
      assert.equal(packet.goalAllocation.status, 'unavailable', 'excluded/invalid relevant evidence is uncertainty, not no activity');
      assert.ok(packet.rows.every(row => row.saved === null));
      assert.equal(packet.period.proposal, null);
    }
  });

function held(advice) {
  assert.equal(advice.savingsInventory.reportedStock.amount, 119, 'original Savings stock survives');
  assert.equal(advice.savingsFunding.goalAllocation.status, 'unavailable');
  assert.ok(advice.savingsFunding.rows.every(row => row.saved === null));
  assert.equal(advice.savingsFunding.period.proposal, null);
  assert.ok(advice.sim.events.every(row => !row.reserveFunding));
}
for (const mode of ['sanitization-fallback', 'collapsed-foreign', 'collapsed-missing-currency'])
  test('discarded movement evidence remains account-scoped: ' + mode, () => {
    const { report, advice } = observed(mode);
    held(advice);
    assert.ok(report.currentPeriodActuals.savingsMovementUnconfirmed.some(row => row.accountId === 'savings'));
    for (const row of report.currentPeriodActuals.savingsMovementUnconfirmed) {
      assert.deepEqual(Object.keys(row).sort(), ['accountId', 'reason']);
      assert.ok(['savings', 'savings-dont-touch'].includes(row.accountId));
      assert.ok(['transaction-amount-or-date-unconfirmed', 'native-plan-currency-unconfirmed',
        'transaction-evidence-sanitization-failed'].includes(row.reason));
    }
    assert.equal(O.currentPeriodActualsLooksSanitized(report.currentPeriodActuals), true);
    if (mode === 'sanitization-fallback') assert.deepEqual(report.currentPeriodActuals.transactions, []);
  });
test('confirmed pending/posted collapse does not manufacture uncertainty', () => {
  const { report, advice } = observed('collapsed-valid');
  assert.equal(report.currentPeriodActuals.transactions.length, 1);
  assert.deepEqual(report.currentPeriodActuals.savingsMovementUnconfirmed, []);
  assert.equal(advice.savingsFunding.goalAllocation.status, 'ready');
  assert.deepEqual(advice.savingsFunding.backing.items.map(row => row.saved), [60, 24, 35]);
});
test('undated unrelated account evidence does not poison Savings provenance', () => {
  const { report, advice } = observed('unrelated-undated');
  assert.deepEqual(report.currentPeriodActuals.savingsMovementUnconfirmed, []);
  assert.equal(advice.savingsFunding.goalAllocation.status, 'ready');
});
for (const [mode, mutate] of Object.entries({
  legacy: p => { delete p.savingsMovementUnconfirmed; },
  null: p => { p.savingsMovementUnconfirmed = null; },
  object: p => { p.savingsMovementUnconfirmed = {}; },
  missingAccount: p => { p.savingsMovementUnconfirmed = [{ reason: 'native-plan-currency-unconfirmed' }]; },
  providerIdentity: p => { p.savingsMovementUnconfirmed = [{ accountId: '9003', reason: 'native-plan-currency-unconfirmed' }]; },
  missingReason: p => { p.savingsMovementUnconfirmed = [{ accountId: 'savings' }]; },
  rawDescriptor: p => { p.savingsMovementUnconfirmed = [{ accountId: 'savings', reason: 'private text' }]; },
  extraField: p => { p.savingsMovementUnconfirmed = [{ accountId: 'savings', reason: 'native-plan-currency-unconfirmed', amount: 1 }]; },
  malformedTransactions: p => { p.transactions = null; },
  incompatiblePacketCurrency: p => { p.currency = 'USD'; },
  malformedPacketCurrency: p => { p.currency = null; },
})) test('cloned packet ' + mode + ' cannot silently become clear', () => {
  const { data, report } = observed('valid');
  const before = JSON.stringify(report);
  const packet = JSON.parse(JSON.stringify(report.currentPeriodActuals)); mutate(packet);
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, ...data.liveOverlay, currentPeriodActuals: packet });
  held(advice);
  if (mode === 'legacy') assert.match(advice.savingsFunding.goalAllocation.reason, /legacy or missing/);
  assert.equal(JSON.stringify(report), before, 'negative test never patches the real packet');
});
test('valid uncertainty on an unrelated canonical account is scoped out', () => {
  const { data, report } = observed('valid');
  const packet = JSON.parse(JSON.stringify(report.currentPeriodActuals));
  packet.savingsMovementUnconfirmed = [{ accountId: 'chequing-b', reason: 'transaction-amount-or-date-unconfirmed' }];
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, ...data.liveOverlay, currentPeriodActuals: packet });
  assert.equal(advice.savingsFunding.goalAllocation.status, 'ready');
});
test('failed overlay keeps original Savings reports but missing movement evidence fails closed', () => {
  const { input, report } = observed('undated');
  const before = JSON.stringify(report);
  const data = L.failedOverlay(input.data, 'Synthetic overlay failure', { report });
  assert.deepEqual(data.plan.savingsPoolObservation, report.savingsPools);
  assert.equal(data.liveOverlay.applied, false);
  assert.equal(data.liveOverlay.currentPeriodActuals, null);
  held(F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, ...data.liveOverlay }));
  assert.equal(JSON.stringify(report), before);
});
