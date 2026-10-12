'use strict';
// Isolated exact-identity counterexamples from the #591 review. These pass
// through the provider pipeline; no amount/date matching or policy is added.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const fixture = require('./fixtures/card-purchase-coverage-data');
function sharedDebit() {
  const x = fixture('backfill');
  x.payload.transactions[0].amount = 30; x.payload.transactions[1].amount = 30; x.payload.transactions[2].amount = -30;
  x.payload.accounts[0].balance = 470;
  x.payload.transactions.slice(1).forEach(tx => { tx.category_name = 'Credit Card Payment'; tx.notes = null; });
  x.payload.transactions.push({ ...x.payload.transactions[0], id: 'invented-second-purchase' },
    { ...x.payload.transactions[2], id: 'invented-second-credit' });
  fixture.confirm(x, 'invented-first-payment', 80002, 80003, [[80001, 30]]);
  fixture.confirm(x, 'invented-second-payment', 80002, 'invented-second-credit', [['invented-second-purchase', 30]]);
  return x;
}
function parentReversal() {
  const x = fixture('backfill');
  x.payload.transactions[0].amount = 30; x.payload.transactions[1].amount = 30; x.payload.transactions[2].amount = -30;
  fixture.confirm(x, 'invented-parent-payment', 80002, 80003, [[80001, 30]]);
  x.data.plan.cardPurchaseCoverage.payments.push(structuredClone(x.data.plan.cardPurchaseCoverage.payments[0]));
  x.payload.transactions.push(
    { id: 'invented-dependent-card-reversal', account_id: 3004, date: x.asOf, amount: 10, currency: 'cad', category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false },
    { id: 'invented-dependent-cash-reversal', account_id: 3001, date: x.asOf, amount: -10, currency: 'cad', category_name: 'Credit Card Payment', payee: 'Invented reversal', is_pending: false });
  x.payload.accounts[0].balance = 480; x.payload.accounts[3].balance = 410;
  x.data.plan.cardPurchaseCoverage.reversals.push({ confirmed: true, paymentId: 'invented-parent-payment',
    cardDebitRef: fixture.ref(x, 'invented-dependent-card-reversal'), cashCreditRef: fixture.ref(x, 'invented-dependent-cash-reversal'),
    allocations: [{ purchaseRef: fixture.ref(x, 80001), amount: 10 }], otherAmount: 0 });
  return x;
}
function project(x) {
  const before = JSON.stringify(x), data = Live.fromObservation(x).data;
  const opts = { debts: data.debts, currentPeriodActuals: data.liveOverlay.currentPeriodActuals };
  const financial = JSON.stringify(F.recommend(data.plan, x.asOf, opts));
  const pub = F.cardPeriodMovements(data.plan, data.debts, x.asOf, F.spendingCycle(data.plan, x.asOf), opts);
  assert.equal(JSON.stringify(F.recommend(data.plan, x.asOf, opts)), financial);
  assert.equal(JSON.stringify(x), before);
  return pub.cards.find(row => row.id === 'travelvisa').posted;
}
let failures = 0, checks = 0;
function test(label, run) {
  try { run(); checks++; console.log('PASS ' + label); }
  catch (error) { failures++; console.error('FAIL ' + label + ': ' + error.message); }
}
for (const reverse of [false, true]) {
  test('shared debit invalidates both diagnostics, ' + (reverse ? 'reversed' : 'original') + ' owner-record order', () => {
    const x = sharedDebit(); if (reverse) x.data.plan.cardPurchaseCoverage.payments.reverse();
    const rows = project(x).filter(row => row.amount < 0);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(row => row.paymentAllocation.status), ['unreconciled', 'unreconciled']);
    assert.deepEqual(rows.map(row => row.paymentAllocation.backfill), [null, null]);
  });
  test('ambiguous parent withholds its dependent reversal, ' + (reverse ? 'reversed' : 'original') + ' owner-record order', () => {
    const x = parentReversal(); if (reverse) x.data.plan.cardPurchaseCoverage.payments.reverse();
    const rows = project(x);
    assert.equal(rows.find(row => row.amount === -30).paymentAllocation.status, 'unreconciled');
    assert.equal(rows.find(row => row.amount === 10).paymentAllocation.status, 'unreconciled');
    assert.equal(rows.find(row => row.amount === 10).paymentAllocation.backfill, null);
  });
}
test('ambiguous publication is independent of owner-record order', () => {
  const x = sharedDebit(), reversed = structuredClone(x); reversed.data.plan.cardPurchaseCoverage.payments.reverse();
  const facts = rows => rows.filter(row => row.amount < 0).map(row => row.paymentAllocation);
  assert.deepEqual(facts(project(x)), facts(project(reversed)));
});
test('genuine unique parent and reversal remain confirmed', () => {
  const x = parentReversal(); x.data.plan.cardPurchaseCoverage.payments.pop();
  const rows = project(x);
  assert.equal(rows.find(row => row.amount === -30).paymentAllocation.status, 'reconciled');
  assert.equal(rows.find(row => row.amount === 10).paymentAllocation.status, 'reconciled');
  assert.equal(rows.find(row => row.amount === 10).paymentAllocation.backfill, 10);
});
test('two unique payment pairs can partially cover one purchase', () => {
  const x = fixture('backfill');
  x.payload.transactions[0].amount = 30; x.payload.transactions[1].amount = 15; x.payload.transactions[2].amount = -15;
  x.payload.accounts[0].balance = 470;
  x.payload.transactions.push({ ...x.payload.transactions[1], id: 'invented-distinct-cash' },
    { ...x.payload.transactions[2], id: 'invented-distinct-credit' });
  fixture.confirm(x, 'invented-partial-one', 80002, 80003, [[80001, 15]]);
  fixture.confirm(x, 'invented-partial-two', 'invented-distinct-cash', 'invented-distinct-credit', [[80001, 15]]);
  const payments = project(x).filter(row => row.amount < 0);
  assert.deepEqual(payments.map(row => row.paymentAllocation.status), ['reconciled', 'reconciled']);
  assert.deepEqual(payments.map(row => row.paymentAllocation.backfill), [15, 15]);
});
if (failures) { console.error(failures + ' dependency regressions failed'); process.exitCode = 1; }
else console.log('PASS ' + checks + ' isolated diagnostic dependency regressions');
module.exports = { sharedDebit, parentReversal };
