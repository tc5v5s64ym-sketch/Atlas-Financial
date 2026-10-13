'use strict';
// Owner's current reported-earmark contract; every amount is invented.
const assert = require('node:assert/strict'), test = require('node:test');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.join(__dirname, '..'), 'public/forecast'));
const fx = require('./fixtures/savings-daily-allocation-contract');
const clone = x => JSON.parse(JSON.stringify(x));
function input() {
  const x = fx.advance(fx.fixture(), '2026-10-08');
  x.plan.savingsEarmarks.allocationPolicy = { order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-05', source: 'Invented owner latest-report policy' };
  x.plan.savingsPoolObservation.accounts.forEach(row => { row.evidenceDate = '2026-10-06'; });
  // An old savings-to-card debit is movement evidence, not a new stock input.
  x.opts.currentPeriodActuals.transactions.push({ id: 'invented-old-withdrawal', date: '2026-10-03',
    amount: 17.43, currency: 'CAD', pending: false, savingsPostingEvidence: 'posted',
    atlasAccountId: 'savings', accountRole: 'household-reserve',
    internalTransferIdentity: true, tfrReference: 'AA101', tfrDirection: 'TO' });
  return x;
}
function publish(x) {
  const before = JSON.stringify(x), advice = F.recommend(x.plan, x.asOf, { ...x.opts, debts: x.debts || [] });
  assert.equal(JSON.stringify(x), before, 'no balances, policy, observations, history or transactions change');
  return advice;
}
function reported(advice, expected = [60, 24, 35]) {
  const s = advice.savingsFunding;
  assert.equal(s.goalAllocation.status, 'ready');
  assert.equal(s.goalAllocation.evidenceTrust, 'provider-reported');
  assert.deepEqual(s.backing.items.map(row => row.saved), expected);
  assert.deepEqual(s.rows.map(row => row.needed), [230, 24]);
  assert.equal(s.actionPermission, 'not-granted'); assert.equal(s.moneyMovementPermission, 'not-granted');
  assert.equal(s.backing.actualTransferred, null);
  return s;
}
function futureHeld(advice) {
  assert.equal(advice.savingsFunding.backing.status, 'unavailable');
  assert.equal(advice.savingsFunding.period.proposal, null);
  assert.equal(advice.savingsFunding.period.transferred, null);
  assert.equal(advice.savingsFunding.schedule.status, 'unavailable');
  for (const sim of [advice.sim, advice.zero, advice.sim?.knowledge].filter(Boolean))
    assert.ok(sim.events.every(row => !row.reserveFunding), 'reported earmarks cannot seed a payment');
}
test('latest reported 95 + 24 funds dated costs 60, 24, 170 as 60 + 24 + 35 despite an old unpaired debit', () => {
  const advice = publish(input()), s = reported(advice);
  assert.equal(6000 + 2400 + 3500, 9500 + 2400, 'independent cents conservation; old debit is not subtracted again');
  assert.deepEqual(s.rows.map(row => row.saved), [95, 24]); futureHeld(advice);
  assert.ok(s.goalAllocation.balanceDates.every(row => row.date === '2026-10-06'));
});
for (const mode of ['absent-history', 'truncated-history', 'missing-provenance', 'unconfirmed-card-opening',
  'unknown-operating-cash', 'pending-reserve']) test(mode + ' cannot erase valid reported earmarks or grant future funding', () => {
  const x = input();
  if (mode === 'absent-history') delete x.opts.currentPeriodActuals;
  if (mode === 'truncated-history') x.opts.currentPeriodActuals.transactionCoverage = 'truncated';
  if (mode === 'missing-provenance') delete x.opts.currentPeriodActuals.savingsFetchCoverage;
  if (mode === 'unconfirmed-card-opening') x.opts.currentPeriodActuals.cardCoverageRequired = true;
  if (mode === 'unknown-operating-cash') { delete x.plan.startingCash.breakdown[0].value; x.opts.operatingPlan = 'unavailable'; }
  if (mode === 'pending-reserve') x.plan.savingsPoolObservation.accounts[0].pendingState = 'pending';
  const advice = publish(x); reported(advice); futureHeld(advice);
});
test('source replacement grows the next requirement, shrinks, reaches genuine zero, and caps full goals without accrual', () => {
  const x = input();
  for (const [a, b, expected] of [[95,24,[60,24,35]], [105,24,[60,24,45]],
    [15.02,24,[39.02,0,0]], [0,0,[0,0,0]], [230,24,[60,24,170]], [240,24,[60,24,170]]]) {
    x.plan.savingsPoolObservation.accounts[0].value = a;
    x.plan.savingsPoolObservation.accounts[1].value = b;
    const advice = publish(x), s = reported(advice, expected); futureHeld(advice);
    assert.deepEqual(publish(x).savingsFunding, s, 'same checked input replaces itself, never accrues another earmark');
    assert.ok(s.backing.items.reduce((sum,row) => sum + Math.round(row.saved*100),0) <= Math.round((a+b)*100));
  }
});
test('midnight preserves the last checked reports and earmarks without relabeling balance freshness', () => {
  const x = input(), before = reported(publish(x));
  x.asOf = x.plan.opening.asOf = '2026-10-09';
  const after = reported(publish(x));
  assert.deepEqual(after.goalAllocation.balanceDates, before.goalAllocation.balanceDates);
  assert.equal(after.goalAllocation.checkedAsOf, before.goalAllocation.checkedAsOf);
  assert.equal(after.stock.amount, null, 'dated report never becomes today current backing');
});
test('a proven inter-reserve transfer counted in both snapshots is a genuine account-cohort hold', () => {
  const x = require('./fixtures/savings-transfer-cutoffs')();
  const before = publish(x).savingsFunding;
  assert.equal(10000 - 10000 + 10000, 10000, 'the invented paired transfer conserves one 100, not two');
  assert.equal(before.goalAllocation.status, 'unavailable');
  assert.match(before.goalAllocation.reason, /same proven reserve transfer/);
  x.plan.savingsPoolObservation.accounts[0].value = 0;
  x.plan.savingsPoolObservation.accounts[0].evidenceDate = '2026-10-08';
  reported(publish(x), [60, 24, 16]);
});
for (const [name, mutate] of Object.entries({
  missing: p => p.savingsPoolObservation.accounts.pop(),
  duplicate: p => p.savingsPoolObservation.accounts.push(clone(p.savingsPoolObservation.accounts[0])),
  wrongIdentity: p => { p.savingsPoolObservation.accounts[0].accountId = 'chequing-a'; },
  wrongCurrency: p => { p.savingsPoolObservation.accounts[0].currency = 'USD'; },
  wrongSource: p => { p.savingsPoolObservation.accounts[0].source = 'opening'; },
  missingDate: p => { delete p.savingsPoolObservation.accounts[0].evidenceDate; },
  impossibleDate: p => { p.savingsPoolObservation.accounts[0].evidenceDate = '2026-02-30'; },
  futureDate: p => { p.savingsPoolObservation.accounts[0].evidenceDate = '2026-10-09'; },
  null: p => { p.savingsPoolObservation.accounts[0].value = null; },
  string: p => { p.savingsPoolObservation.accounts[0].value = '95'; },
  subCent: p => { p.savingsPoolObservation.accounts[0].value = 95.001; },
  negative: p => { p.savingsPoolObservation.accounts[0].value = -1; },
  unknownRequirementDate: p => { delete p.commitments[0].date; },
  unknownRequirementAmount: p => { delete p.commitments[0].amount; },
})) test(name + ' remains unknown, never a partial sum or invented zero', () => {
  const x = input(); mutate(x.plan); const s = publish(x).savingsFunding;
  assert.equal(s.goalAllocation.status, 'unavailable');
  assert.ok(s.rows.every(row => row.saved === null)); assert.equal(s.period.proposal, null);
});
