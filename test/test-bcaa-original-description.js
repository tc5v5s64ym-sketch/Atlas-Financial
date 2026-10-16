'use strict';
// Invented rows, identifiers, values and dates only. The merchant aliases
// come from the existing public BCAA rule; no captured transaction is used.
const assert = require('node:assert/strict');
const Provider = require('../scripts/provider-observe');
const Live = require('../scripts/live-plan');
const Forecast = require('../public/forecast');
const identity = require('../docs/connectivity/transaction-identity.json');
const rule = identity.rules.find(row => row.eventId === 'bcaa');
const DAY = '2026-11-18', AS_OF = '2026-11-19', OPENING = '2026-11-06';
const PLANNED = 143.27, POSTED = 143.22;
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0, failed = 0;
function test(label, run) {
  try { run(); passed++; console.log('PASS ' + label); }
  catch (error) { failed++; console.error('FAIL ' + label + ': ' + error.message); }
}
function fixture() {
  const ids = ['chequing-a', 'chequing-b', 'savings'];
  return {
    asOf: AS_OF,
    data: { meta: { asOf: OPENING }, accounts: [], debts: [], revolvingExtra: [], plan: {
      windowDays: 28, opening: { asOf: OPENING },
      startingCash: { breakdown: ids.map((id, i) => ({ id, label: 'Invented ' + id, value: i ? 0 : 500 })) },
      defaults: { targetBuffer: 0, extraDebtMonthly: 0 },
      income: [{ id: 'payroll', label: 'Invented payroll', frequency: 'biweekly', anchor: OPENING, amount: 1000, confidence: 'confirmed' }],
      bills: [{ id: 'bcaa', label: 'Invented insurance obligation', frequency: 'once', date: DAY,
        amount: PLANNED, payingAccount: 'chequing-a', confidence: 'confirmed' }],
      obligations: [], commitments: [], budget: { categories: [{ id: 'groceries', label: 'Groceries', class: 'essential',
        plannedPayday: 0, plannedWeekly: 0, confidence: 'confirmed' }] },
    } },
    accountMap: { schema: 'atlas-provider-account-map/v1', provider: 'lunchmoney', scope: 'fixture',
      mappings: ids.map((id, i) => ({ providerAccountId: String(7101 + i), atlasRole: 'household-cash', canonical: { collection: 'cash', id } })) },
    identity: { rules: [clone(rule)], billPaymentPayees: [] },
    payload: { provider: 'lunchmoney', fetchedAt: AS_OF + 'T20:00:00Z',
      source: 'Invented BCAA matcher regression',
      accounts: ids.map((id, i) => ({ id: 7101 + i, name: 'Invented ' + id, type: 'cash', subtype: 'checking',
        institution_name: 'Invented institution', currency: 'cad', balance: i ? 0 : 356.78, updated_at: AS_OF + 'T19:00:00Z' })),
      pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false, startDate: null, endDate: null },
      transactionWindow: { startDate: OPENING, endDate: AS_OF, complete: true, hasMore: false, truncated: false },
      transactions: [{ id: 72001, account_id: 7101, date: DAY, amount: POSTED, currency: 'cad', is_pending: false,
        payee: 'Bca', original_name: 'BCAA-AdvAutoIns INS', category_name: 'Insurance' }],
    },
  };
}
function run(x) {
  const before = JSON.stringify(x);
  const result = Live.fromObservation(x);
  assert.equal(JSON.stringify(x), before, 'observation never mutates the input');
  const packet = result.report.currentPeriodActuals;
  const advice = Forecast.recommend(result.data.plan, x.asOf, { debts: [], weeklyVariable: 0, currentPeriodActuals: packet });
  const bill = advice.defaultView.bills.find(row => row.id === 'bcaa');
  const receipt = result.report.obligationReconciliationReceipt;
  return { ...result, packet, bill, advice, receiptRow: receipt.occurrences.find(row => row.id === 'bcaa') };
}
function paid(r, expected = POSTED) {
  assert.equal(r.report.representedEventCandidates.filter(row => row.id === 'bcaa').length, 1);
  assert.equal(r.receiptRow.settlement, 'represented', 'full reconciliation receipt identifies the occurrence');
  assert.equal(r.receiptRow.plannedAmount, PLANNED);
  assert.equal(r.receiptRow.observedAmount, expected);
  assert.equal(r.packet.representedActuals.filter(row => row.id === 'bcaa').length, 1);
  assert.equal(r.bill.status, 'PAID'); assert.equal(r.bill.remaining, 0);
  assert.equal(r.bill.planned, PLANNED, 'authored planned amount is unchanged');
  assert.equal(r.bill.actual, expected, 'actual amount is preserved without tolerance adjustment');
  assert.equal(r.bill.movement, -expected, 'published movement uses observed expense once');
}
function notPaid(r) {
  assert.equal(r.report.representedEventCandidates.some(row => row.id === 'bcaa'), false);
  assert.equal(r.packet.representedActuals.some(row => row.id === 'bcaa'), false);
  assert.notEqual(r.receiptRow?.settlement, 'represented');
  assert.notEqual(r.bill.status, 'PAID'); assert.equal(r.bill.remaining, PLANNED);
}

test('short display + configured original alias reaches complete paid reconciliation', () => {
  const x = fixture(), r = run(x); paid(r);
  assert.equal(r.advice.defaultView.bills.find(row => row.id === 'bcaa').status, 'PAID', 'household default bill list consumes the same settlement');
  assert.deepEqual(run(x).packet, r.packet, 'replay does not duplicate or alter actuals');
});
for (const original of ['BCAA-AdvAutoIns', 'Bcaa-adv', 'bcaa-adVautoins INS']) test('configured original alias preserved: ' + original, () => {
  const x = fixture(); x.payload.transactions[0].original_name = original; paid(run(x));
});
test('camel-case originalName survives normalization and settles the same occurrence', () => {
  const x = fixture(); x.payload.transactions[0].originalName = x.payload.transactions[0].original_name;
  delete x.payload.transactions[0].original_name; paid(run(x));
});
for (const payee of ['BCAA-AdvAutoIns INS', 'Bcaa-adv']) test('existing matched display payee remains paid with a five-cent difference: ' + payee, () => {
  const x = fixture(); x.payload.transactions[0].payee = payee; paid(run(x));
});
for (const original of [undefined, '', 'Invented unrelated insurer', 'BCAA general insurance']) test('unrelated shortened display remains unconfirmed: ' + String(original), () => {
  const x = fixture(); x.payload.transactions[0].original_name = original; notPaid(run(x));
});
test('a different display name does not acquire the shortened-payee permission', () => {
  const x = fixture(); x.payload.transactions[0].payee = 'Bca unrelated'; notPaid(run(x));
});
test('notes and Insurance category do not substitute for original merchant identity', () => {
  const x = fixture(); x.payload.transactions[0].original_name = 'Invented merchant';
  x.payload.transactions[0].notes = 'BCAA-AdvAutoIns INS'; notPaid(run(x));
});
test('another canonical cash account cannot settle Bills insurance', () => {
  const x = fixture(); x.payload.transactions[0].account_id = 7102; notPaid(run(x));
});
test('a nonpermitted posting day cannot settle the scheduled occurrence', () => {
  const x = fixture(); x.payload.transactions[0].date = '2026-11-17'; notPaid(run(x));
});
for (const amount of [0, -POSTED, 'not-money']) test('nondebit or invalid amount remains rejected: ' + String(amount), () => {
  const x = fixture(); x.payload.transactions[0].amount = amount; notPaid(run(x));
});
test('duplicate compatible payments remain ambiguous instead of paid', () => {
  const x = fixture(); x.payload.transactions.push({ ...x.payload.transactions[0], id: 72002 });
  const r = run(x); notPaid(r); assert.equal(r.receiptRow.settlement, 'ambiguous');
});
test('pending shortened-payee evidence does not settle the occurrence', () => {
  const x = fixture(); x.payload.transactions[0].is_pending = true; notPaid(run(x));
});
test('unknown posting evidence cannot use the original-description permission', () => {
  const x = fixture(); delete x.payload.transactions[0].is_pending; notPaid(run(x));
});
test('incomplete observation coverage does not settle the occurrence', () => {
  const x = fixture(); x.payload.transactionWindow.complete = false; x.payload.transactionWindow.truncated = true; notPaid(run(x));
});
test('other rules retain payee-only matching without the explicit fallback permission', () => {
  const tx = Provider.normalizeLunchMoneyTransaction(fixture().payload.transactions[0], new Map(), new Map());
  const plain = { ...rule }; delete plain.originalNameFallbackForPayees;
  assert.equal(Provider.ruleMatchesTransactionIdentity(tx, plain), false);
});
test('opt-in currency gate remains effective with the fallback identity', () => {
  const x = fixture(); x.identity.rules[0].requiredCurrency = 'cad'; x.payload.transactions[0].currency = 'usd'; notPaid(run(x));
});
test('opt-in exact-amount settlement gate remains effective with fallback identity', () => {
  const x = fixture(); x.identity.rules[0].settlesWhen = 'exact-scheduled-amount';
  notPaid(run(x)); // existing half-cent epsilon does not accept this invented five-cent difference
});
test('existing original-name conjunct remains mandatory', () => {
  const x = fixture(); x.identity.rules[0].originalNamePatterns = ['Invented separate qualifier']; notPaid(run(x));
});
test('existing exclusion patterns still veto fallback original evidence', () => {
  const x = fixture(); x.identity.rules[0].payeeExcludePatterns = ['BCAA-AdvAutoIns']; notPaid(run(x));
});
test('existing amount-independent BCAA contract is preserved', () => {
  assert.equal(rule.settlesWhen, undefined, 'no new amount-equality policy');
  const x = fixture(); x.payload.transactions[0].amount = 141; paid(run(x), 141);
});
console.log(`BCAA original-description tests: ${passed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
