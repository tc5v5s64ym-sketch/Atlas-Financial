'use strict';
// Invented independently balanced ledger, not copied household cents.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const F = require('../public/forecast');
const Live = require('../scripts/live-plan');
const source = require('./fixtures/card-backfill-data');
const canonical = fs.readFileSync(require.resolve('../data.json'), 'utf8');
let checks = 0;
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function fixture() {
  const x = source('triangle', 'triangle');
  x.asOf = '2026-10-05';
  x.data.meta.asOf = '2026-10-02';
  x.data.plan.opening.asOf = '2026-10-02';
  x.data.plan.windowDays = 28;
  x.data.plan.income[0].anchor = '2026-10-02';
  x.data.plan.startingCash.breakdown[1].value = 100;
  x.data.plan.obligations[0] = { id: 'triangle', debtId: 'triangle', effect: 'payment',
    label: 'Invented card minimum', frequency: 'monthly', day: 7, firstDue: '2026-10-07',
    amount: 88.88, confidence: 'estimated', payingAccount: 'chequing-a',
    statementOccurrences: [{ scheduledDate: '2026-10-07', dueDate: '2026-10-08',
      minimum: 91.23, currency: 'cad', confidence: 'confirmed' }] };
  x.payload.fetchedAt = x.asOf + 'T18:00:00Z';
  x.payload.transactionWindow = { startDate: '2026-10-02', endDate: x.asOf,
    complete: true, hasMore: false, truncated: false };
  x.payload.transactions = [
    { id: 94001, account_id: 3001, date: x.asOf, amount: 100, currency: 'cad',
      payee: 'Invented retailer', category_name: 'Credit card payment', is_pending: false },
    { id: 94002, account_id: 3002, date: x.asOf, amount: 35.70, currency: 'cad',
      payee: 'Invented retailer', category_name: 'Superstores', is_pending: false }
  ];
  x.payload.accounts.forEach(a => { a.updated_at = x.asOf + 'T17:00:00Z'; });
  x.payload.accounts[0].balance = 400;
  x.payload.accounts[1].balance = 64.30;
  x.payload.accounts[3].balance = 400;
  return x;
}
function sent(x, changes = {}) {
  x.data.plan.obligations[0].sentPayments = [{ scheduledDate: '2026-10-07',
    confirmed: true, intent: 'minimum', debitId: 'invented-bank-debit',
    postedOn: '2026-10-05', amount: 100, currency: 'cad',
    fundingAccountId: 'chequing-a', pending: false, ...changes }];
  return x;
}
function run(x) {
  const original = JSON.stringify(x);
  const result = Live.fromObservation(x);
  eq(result.data.liveOverlay.applied, true);
  eq(JSON.stringify(x), original, 'input remains immutable');
  const opts = { debts: result.data.debts, currentPeriodActuals: result.data.liveOverlay.currentPeriodActuals };
  const advice = F.recommend(result.data.plan, x.asOf, opts);
  const bill = advice.defaultView.bills.find(row => row.id === 'triangle');
  const period = advice.payPeriodViews.find(row => row.start === '2026-10-02');
  return { ...result, opts, advice, bill, period };
}
const x = fixture(), p = x.data.plan;
eq(F.expandEvents(p, '2026-10-01', '2026-12-31').filter(e => e.id === 'triangle')
  .map(e => [e.date, -e.amount, e.confidence]), [
    ['2026-10-08', 91.23, 'confirmed'], ['2026-11-07', 88.88, 'estimated'], ['2026-12-07', 88.88, 'estimated']]);
eq(F.expandEvents(p, '2026-10-07', '2026-10-07').filter(e => e.id === 'triangle').length, 0);
const moved = F.expandEvents(p, '2026-10-08', '2026-10-08').find(e => e.id === 'triangle');
eq([moved.date, moved.scheduledDate, moved.occurrenceKey],
  ['2026-10-08', '2026-10-07', 'triangle@2026-10-07'], 'replacement before window filtering, stable identity');
for (const dueDate of ['2026-09-30', '2026-11-01']) {
  const q = structuredClone(p); q.obligations[0].statementOccurrences[0].dueDate = dueDate;
  eq(F.expandEvents(q, dueDate, dueDate).filter(e => e.id === 'triangle').length, 1);
  eq(F.expandEvents(q, '2026-10-07', '2026-10-07').filter(e => e.id === 'triangle').length, 0);
}
for (const changes of [{ dueDate: '2026-02-30' }, { minimum: -1 }, { minimum: 1.001 },
  { currency: 'usd' }, { confidence: 'estimated' }, { scheduledDate: '2026-10-06' }, { dueDate: '2026-11-07' }]) {
  const q = structuredClone(p); Object.assign(q.obligations[0].statementOccurrences[0], changes);
  assert.throws(() => F.expandEvents(q, '2026-10-01', '2026-11-30')); checks++;
}
const duplicate = structuredClone(p);
duplicate.obligations[0].statementOccurrences.push({ ...duplicate.obligations[0].statementOccurrences[0] });
assert.throws(() => F.expandEvents(duplicate, '2026-10-01', '2026-11-30')); checks++;
const zero = structuredClone(p); zero.obligations[0].statementOccurrences[0].minimum = 0;
eq(F.expandEvents(zero, '2026-10-01', '2026-10-31').filter(e => e.id === 'triangle').length, 0);

const base = run(fixture());
eq([base.data.plan.startingCash.breakdown[0].value, base.data.plan.startingCash.breakdown[1].value], [400, 64.30]);
eq(base.period.householdBudget.reduce((sum, row) => sum + (row.spent || 0), 0), 35.70, 'purchase once, transfer no expense');
eq([base.bill.date, base.bill.planned, base.bill.confidence], ['2026-10-08', 91.23, 'confirmed']);
eq(base.bill.status === 'PAID', false, 'bank movement alone has no minimum intent');
eq(base.data.debts[0].balance, 400, 'sender-only bank debit does not change card stock');

for (const included of [undefined, '2026-10-05', '2026-10-06']) {
  const input = sent(fixture(), included ? { cashIncludedAsOf: included } : {});
  const r = run(input);
  eq([r.bill.cashPaymentStatus, r.bill.cashPaid, r.bill.issuerMinimumStatus, r.bill.remaining,
    r.bill.additionalCashRequired, r.bill.status], ['sent', 100, 'unconfirmed', null, null, 'unconfirmed']);
  eq(r.bill.cashInclusionStatus, included === '2026-10-05' ? 'included' : 'unconfirmed');
  eq(r.advice.weekly, null, 'unknown issuer cash is not spend permission');
  eq([r.advice.sim.ending, r.advice.sim.min.balance, r.advice.knowledge.ending, r.advice.gap],
    [null, null, null, null], 'conditional unknown-cash walk is not a public figure');
  const sim = F.simulate(r.data.plan, input.asOf, { horizonDays: 10 });
  eq([sim.status, sim.ending, sim.additionalCashRequired], ['unavailable', null, null]);
  eq(sim.daily.every(row => row.balance === null), true);
  eq(F.recommendWeekly(r.data.plan, input.asOf), null);
  eq(r.period.fromTodayFunding.status, 'unavailable');
  eq(F.baselineTrajectory(r.data.plan, r.data.debts, input.asOf, r.opts).status, 'unavailable');
  const current = F.expandEvents(r.data.plan, input.asOf, '2026-10-31');
  eq(current.filter(e => e.id === 'triangle').reduce((sum, e) => sum - e.amount, 0), 0,
    'known sent allocation is not a second full scheduled debit');
  const walk = F.projectDebts(r.data.plan, r.data.debts, input.asOf, { debtHorizonDays: 10 });
  eq(walk.byId.triangle.paid, 0, 'no invented receiving-side principal reduction');
  eq(r.data.plan.opening.representedEvents.filter(e => e.id === 'triangle').length, 0);
  eq(run(input).advice, r.advice, 'repeat observation is stable');
  eq(JSON.stringify(r.advice.cardMinimumPayments).includes('invented-bank-debit'), false,
    'private debit identity does not enter publication');
}
// Passing the due date does not resurrect a second minimum after a cutover.
const afterDue = sent(fixture());
afterDue.data.plan.opening = { asOf: '2026-10-10', priorAsOf: '2026-10-02' };
eq(F.expandEvents(afterDue.data.plan, '2026-10-10', '2026-10-31').filter(e => e.id === 'triangle')
  .map(e => [e.date, e.amount, e.minimumPayment.cashPaymentStatus]), [['2026-10-08', 0, 'sent']]);
// A partial confirmed send still leaves issuer-dependent extra cash unknown.
const partial = run(sent(fixture(), { amount: 10, cashIncludedAsOf: '2026-10-05' }));
eq([partial.bill.cashPaid, partial.bill.planned, partial.bill.additionalCashRequired], [10, 91.23, null]);
const two = sent(fixture());
two.data.plan.obligations[0].sentPayments.push({ ...two.data.plan.obligations[0].sentPayments[0],
  debitId: 'invented-second-debit', amount: 5 });
eq(run(two).bill.cashPaid, 105, 'two distinct posted debits sum once');
two.data.plan.obligations[0].sentPayments[1].debitId = 'invented-bank-debit';
const duplicated = run(two);
eq(duplicated.bill.cashPaid, 100, 'same debit cannot be allocated twice');
eq(duplicated.advice.cardMinimumPayments.issues.includes('sent-payment-allocated-more-than-once'), true);
for (const changes of [{ intent: 'purchase-backfill' }, { intent: 'unconfirmed' },
  { confirmed: false }, { pending: true }, { amount: -100 }, { amount: 0 },
  { currency: 'usd' }, { fundingAccountId: 'chequing-b' }, { debitId: '' },
  { cashIncludedAsOf: '2026-10-04' }, { postedOn: '2026-10-06' }]) {
  const input = sent(fixture(), changes), r = run(input);
  eq(r.bill.status === 'PAID', false);
  eq(r.bill.cashPaymentStatus, undefined, 'pending, refund, unknown or backfill is not sent minimum evidence');
  eq(r.bill.remaining, 91.23, 'existing contractual minimum remains one requirement');
  eq(r.data.debts[0].balance, 400);
}
// Explicit receipt evidence does not infer a new payment or change card stock.
const paidInput = sent(fixture(), { cashIncludedAsOf: '2026-10-05' });
paidInput.data.plan.opening.representedEvents = [{ id: 'triangle', date: '2026-10-07', effectiveAsOf: '2026-10-05' }];
const paid = run(paidInput);
eq([paid.bill.status, paid.bill.issuerMinimumStatus, paid.bill.remaining], ['PAID', 'satisfied', 0]);
eq(paid.data.debts[0].balance, 400);
const oldOpening = structuredClone(paidInput.data.plan);
eq(F.expandEvents(oldOpening, '2026-10-02', '2026-10-10').filter(e => e.id === 'triangle').map(e => -e.amount), [91.23],
  'current qualification cannot suppress a historical opening');

const context = { console, Date, Map, Set }; vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../public/forecast'), 'utf8'), context);
eq(JSON.parse(JSON.stringify(context.Forecast.expandEvents(p, '2026-10-08', '2026-10-08'))),
  F.expandEvents(p, '2026-10-08', '2026-10-08'), 'browser runs the same contract');
eq(fs.readFileSync(require.resolve('../data.json'), 'utf8'), canonical, 'no canonical writes');
console.log(`PASS card minimum cycle/sender contract: ${checks} independent checks`);
