'use strict';
// Independent bank-recipient contract, invented inputs through the real producer.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { source, root } = require('./fixtures/savings-card-recipient-data');
const F = require(path.join(root, 'public/forecast'));
const O = require(path.join(root, 'scripts/provider-observe'));
const Inventory = require(path.join(root, 'public/savings-inventory'));
const future = require('./fixtures/savings-future-closing-data');
const clone = x => JSON.parse(JSON.stringify(x));
const unknown = /^A savings movement lacks unique, qualified posted evidence\./;
function reported(x) {
  assert.equal(x.advice.savingsInventory.reportedStock.amount, 119, '95 + 24 independent reports');
  assert.equal(x.advice.savingsFunding.moneyMovementPermission, 'not-granted');
  assert.equal(x.advice.savingsFunding.actionPermission, 'not-granted');
  assert.deepEqual(x.advice.savingsFunding.backing.items.map(r => r.saved), [60, 24, 35]);
  assert.equal(O.currentPeriodActualsLooksSanitized(x.report.currentPeriodActuals), true);
}
for (const account of ['9003', '9004']) for (const mode of ['recognized', 'plain-debit', 'cash-pair',
  'unrelated-card-credit', 'reference-card-credit']) test('real source qualified ' + account + ':' + mode, () => {
  const x = source(mode, account); reported(x);
  assert.equal(x.advice.savingsFunding.backing.status, 'ready', x.advice.savingsFunding.backing.reason);
  if (['plain-debit', 'cash-pair'].includes(mode))
    assert.ok(x.report.currentPeriodActuals.transactions.every(r => !Object.hasOwn(r, 'tdCardPaymentIdentity')),
      'untyped incumbent packets acquire no false recipient marker');
  if (!['plain-debit', 'cash-pair'].includes(mode)) {
    const row = x.report.currentPeriodActuals.transactions[0];
    assert.equal(row.tdCardPaymentIdentity, true, 'recorded recipient class survives observer and overlay');
    assert.equal(row.cardPaymentIdentity, true);
    assert.equal(F.classifyCurrentPeriodTransaction(row, x.data.plan, x.data.liveOverlay).kind, 'card-payment');
    assert.equal(F.householdInternalMovements(null, x.data.liveOverlay).length, 0, 'no card-credit pairing is invented');
    assert.equal(x.advice.savingsFunding.backing.actualTransferred, null);
  }
  const pub = F.savingsFundingPublication(x.advice.savingsFunding, { asOf: x.data.meta.asOf, advice: x.advice });
  assert.match(Inventory.html(pub, { asOf: x.data.meta.asOf, advice: x.advice }), /Saved allocation/);
  assert.equal(JSON.stringify(F.recommend(x.data.plan, x.data.meta.asOf,
    { ...x.data.liveOverlay, debts: x.data.debts, weeklyVariable: 40 })), JSON.stringify(x.advice), 'replay is stable');
});
for (const mode of ['ordinary-transfer', 'unknown-destination', 'payee-lookalike', 'note-lookalike',
  'suffix-unknown', 'prefix-unknown', 'hint-only',
  'wrong-direction', 'wrong-sign', 'reference-replay', 'cash-contradiction']) test('ambiguous source holds ' + mode, () => {
  const x = source(mode); reported(x);
  if (!['reference-replay', 'cash-contradiction'].includes(mode))
    assert.ok(x.report.currentPeriodActuals.transactions.every(r => !Object.hasOwn(r, 'tdCardPaymentIdentity')));
  assert.equal(x.advice.savingsFunding.backing.status, 'unavailable');
  assert.match(x.advice.savingsFunding.backing.reason, unknown);
  assert.equal(x.advice.savingsFunding.period.proposal, null);
});
for (const mode of ['pending', 'pending-twin', 'posting-unknown', 'foreign', 'missing-currency',
  'same-day-cutoff', 'before-cutoff', 'window-incomplete', 'pending-incomplete']) test('source/cutoff gate holds ' + mode, () => {
  const x = source(mode); reported(x);
  assert.equal(x.advice.savingsFunding.backing.status, 'unavailable');
  assert.equal(x.advice.savingsFunding.period.proposal, null);
  if (mode === 'same-day-cutoff')
    assert.match(x.advice.savingsFunding.backing.reason, /^Reported balance cutoffs cannot establish inclusion/);
  if (mode === 'before-cutoff')
    assert.equal(x.advice.savingsFunding.backing.reason, 'Both savings accounts require current, clear CAD cents evidence.');
});
for (const [name, mutate] of Object.entries({
  duplicateId: p => p.transactions.push({ ...p.transactions[0] }),
  wrongRole: p => { p.transactions[0].accountRole = 'household-cash'; },
  alias: p => { p.transactions[0].accountId = 'savings-dont-touch'; },
  pending: p => { p.transactions[0].pending = true; p.transactions[0].savingsPostingEvidence = 'pending'; },
  posting: p => { p.transactions[0].savingsPostingEvidence = 'unknown'; },
  cents: p => { p.transactions[0].amount = 7.251; },
  missingMarker: p => { delete p.transactions[0].tdCardPaymentIdentity; },
  malformedMarker: p => { p.transactions[0].tdCardPaymentIdentity = 'true'; },
  wrongDirection: p => { p.transactions[0].tfrDirection = 'FR'; },
  rawConflict: p => { p.transactions[0].originalName = 'ZX777 TFR-TO Invented reserve'; },
  incomplete: p => { p.savingsFetchCoverage.complete = false; },
  unknownPending: p => { p.pendingCoverage = 'unknown'; },
})) test('typed normalized evidence remains fail closed: ' + name, () => {
  const x = source(), packet = clone(x.report.currentPeriodActuals);
  // Remove household-facing original text: the boolean is the private-source-derived evidence.
  for (const r of packet.transactions) delete r.originalMerchant;
  mutate(packet);
  const a = F.recommend(x.data.plan, x.data.meta.asOf, { ...x.data.liveOverlay,
    currentPeriodActuals: packet, debts: x.data.debts, weeklyVariable: 40 });
  assert.equal(a.savingsFunding.backing.status, 'unavailable');
  assert.equal(a.savingsFunding.period.proposal, null);
  assert.equal(a.savingsFunding.moneyMovementPermission, 'not-granted');
});
test('qualified historical card debit is already inside reports, never deducted or allocated twice', () => {
  const x = future(), before = JSON.stringify(x);
  const baseline = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const row = clone(source().report.currentPeriodActuals.transactions[0]);
  x.opts.currentPeriodActuals.transactions.push(row);
  const ready = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(ready.savingsFunding.backing.status, 'ready');
  const views = a => a.savingsFunding.periodViews.map(v => F.savingsFundingPublication(a.savingsFunding,
    { asOf: x.asOf, advice: a, periodId: v.id }).forecastClosing);
  assert.deepEqual(views(ready), views(baseline), 'one dated bank stock, no invented card settlement or goal attribution');
  const first = ready.savingsFunding.periodViews.find(v => v.start === '2026-10-16');
  const close = F.savingsFundingPublication(ready.savingsFunding,
    { asOf: x.asOf, advice: ready, periodId: first.id }).forecastClosing;
  assert.equal(close.stock, 119, 'reported stock at the first close; the future receipt surplus sweeps on the next payday (owner direction 2026-10-14)');
  const second = ready.savingsFunding.periodViews.find(v => v.start === '2026-10-30');
  const close2 = F.savingsFundingPublication(ready.savingsFunding,
    { asOf: x.asOf, advice: ready, periodId: second.id }).forecastClosing;
  assert.equal(close2.stock, 119 + 1000, 'reported stock plus one future receipt, counted once; historic debit already included');
  assert.equal(close.projectedDraws, 0); assert.equal(close.actualSaved, null);
  assert.equal(close.trust, 'estimated'); assert.equal(close.moneyMovementPermission, 'not-granted');
  assert.equal(x.opts.currentPeriodActuals.transactions.length, 1);
  assert.equal(JSON.stringify({ ...x, opts: { ...x.opts, currentPeriodActuals: { ...x.opts.currentPeriodActuals,
    transactions: [] } } }), before);
});
test('recognized recipient does not establish independently required card coverage', () => {
  const x = future();
  x.opts.currentPeriodActuals.transactions.push(clone(source().report.currentPeriodActuals.transactions[0]));
  x.opts.currentPeriodActuals.cardCoverageRequired = true;
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(a.savingsFunding.backing.status, 'ready');
  const v = a.savingsFunding.periodViews.find(v => v.start === '2026-10-16');
  const close = F.savingsFundingPublication(a.savingsFunding, { asOf: x.asOf, advice: a, periodId: v.id }).forecastClosing;
  assert.equal(close.status, 'unavailable'); assert.equal(close.stock, null);
  assert.doesNotMatch(close.reason, unknown); assert.match(close.reason, /card|coverage|opening/i);
  assert.equal(close.moneyMovementPermission, 'not-granted');
});
for (const mode of ['typed-card-debit', 'untyped-transfer-debit', 'genuine-benefit-credit'])
  test('incumbent income exclusions remain intact: ' + mode, () => {
    const plan = { defaults: { targetBuffer: 0 }, startingCash: { amount: 100,
      breakdown: [{ id: 'chequing-a', value: 0 }, { id: 'chequing-b', value: 100 }] },
      opening: { asOf: '2026-09-18', priorAsOf: '2026-09-11', representedEvents: [] },
      income: [{ id: 'payroll', label: 'Invented payroll', frequency: 'biweekly', anchor: '2026-08-14', amount: 0, confidence: 'confirmed' },
        { id: 'childBenefit', label: 'Invented benefit', frequency: 'monthly', day: 20, amount: 7.25, confidence: 'confirmed' }],
      bills: [], obligations: [], commitments: [], budget: { categories: [] } };
    const tx = { id: 'invented-income-label-control', date: '2026-09-18', amount: 7.25, currency: 'CAD', pending: false,
      atlasAccountId: 'chequing-b', accountRole: 'household-cash', isIncome: true,
      tdCardPaymentIdentity: true, cardPaymentIdentity: true, tfrReference: 'ZX777', tfrDirection: 'TO' };
    if (mode === 'untyped-transfer-debit') { delete tx.tdCardPaymentIdentity; delete tx.cardPaymentIdentity; }
    if (mode === 'genuine-benefit-credit') {
      tx.amount = -7.25; delete tx.tdCardPaymentIdentity; delete tx.cardPaymentIdentity;
      delete tx.tfrReference; delete tx.tfrDirection;
    }
    const packet = { schema: 'atlas-current-period-actuals/v1', observationAsOf: '2026-09-18', coverageStart: '2026-09-11',
      coverageThrough: '2026-09-18', pendingCoverage: 'complete', transactions: [tx], representedActuals: [] };
    const before = JSON.stringify({ plan, packet });
    const a = F.recommend(plan, '2026-09-18', { targetBuffer: 0, debts: [], currentPeriodActuals: packet });
    const active = a.defaultView.calendarPeriods.find(p => p.id === 'this-pay-period');
    const child = active.income.find(r => r.id === 'childBenefit');
    if (mode === 'genuine-benefit-credit') {
      assert.equal(child.settlement, 'represented'); assert.equal(child.status, 'received');
    } else {
      assert.notEqual(child.settlement, 'represented', 'a bank debit with an incorrect Income label cannot supply a receipt');
      assert.notEqual(child.alreadyInCash, true);
      assert.ok(!active.otherIncome.items.some(r => r.id === 'other-income:' + tx.id));
    }
    assert.equal(JSON.stringify({ plan, packet }), before);
  });
