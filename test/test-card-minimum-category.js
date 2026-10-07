'use strict';
// Independent invented ledger: $1,000 cash and $800 debt, one $49.37
// payment against a $43.19 minimum. Close at $950.63/$750.63, once.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../public/forecast');
const O = require('../scripts/provider-observe');
const Live = require('../scripts/live-plan');
const Category = require('../scripts/card-minimum-category');
const source = require('./fixtures/card-backfill-data');
const clone = x => JSON.parse(JSON.stringify(x));
const NOW = '2035-10-06', ORIGINAL = '2035-10-07', DUE = '2035-10-08';
const cases = [], root = path.join(__dirname, '..');
const disk = fs.readFileSync(path.join(root, 'data.json'), 'utf8');
function check(name, fn) { try { fn(); cases.push({ name, pass: true }); }
  catch (e) { cases.push({ name, pass: false, error: e.stack }); } }

function fixture(card = 'triangle', id = card === 'travelvisa' ? 'travel' : card) {
  const x = source(card, id), name = Object.keys(Category.CATEGORIES).find(k => Category.CATEGORIES[k] === card);
  x.data.meta.asOf = x.data.plan.opening.asOf = '2035-10-01';
  x.data.plan.opening.representedEvents = [];
  x.data.plan.income[0].anchor = '2035-10-01'; x.data.plan.income[0].amount = 0;
  x.data.plan.budget = { categories: [] };
  x.data.plan.obligations = [{ id, debtId: card, effect: 'payment', frequency: 'monthly', day: 7,
    firstDue: ORIGINAL, payingAccount: 'chequing-a', amount: 41.13, confidence: 'estimated',
    statementOccurrences: [{ scheduledDate: ORIGINAL, dueDate: DUE, minimum: 43.19,
      currency: 'cad', confidence: 'confirmed' }] }];
  x.data.plan.startingCash.breakdown[0].value = 1000;
  x.data.debts[0].balance = 800;
  x.payload.accounts[0].balance = 950.63; x.payload.accounts[3].balance = 750.63;
  x.payload.accounts.forEach(a => { a.updated_at = NOW + 'T17:00:00Z'; });
  x.payload.fetchedAt = NOW + 'T18:00:00Z';
  x.payload.transactionWindow = { startDate: '2035-10-01', endDate: NOW, complete: true, hasMore: false, truncated: false };
  x.payload.categories = [{ id: 9001, name, is_income: false, is_group: false,
    exclude_from_totals: true, exclude_from_budget: true }];
  const payee = card === 'triangle' ? 'CAN TIRE MC' : card === 'mbna' ? 'MBNA M/C' : 'TFR-TO C/C';
  x.payload.transactions = [{ id: 98001, account_id: 3001, date: '2035-10-05', amount: 49.37,
    currency: 'cad', payee, category_id: 9001, is_pending: false, status: 'reviewed' }];
  x.asOf = NOW;
  return x;
}
function payment(live) { return F.cardMinimumState(live.data.plan, NOW); }
function packet(x) { return O.observe({ ...x, provider: 'lunchmoney' }).cardMinimumCategoryEvidence; }
function zero(x) { assert.equal(packet(x).payments.length, 0); }

for (const card of Object.values(Category.CATEGORIES)) check(`${card}: actual consumer, amount and conservation`, () => {
  const x = fixture(card), before = JSON.stringify(x), live = Live.fromObservation(x);
  assert.equal(JSON.stringify(x), before);
  const s = payment(live); assert.equal(s.status, 'ready'); assert.equal(s.payments.length, 1);
  assert.equal(s.payments[0].cashPaid, 49.37); assert.equal(s.payments[0].additionalCashRequired, 0);
  assert.equal(s.payments[0].minimumConfirmationSource, 'household-category');
  assert.equal(s.payments[0].scheduledDate, ORIGINAL); assert.equal(s.payments[0].date, DUE);
  assert.equal(F.startingCashAmount(live.data.plan), 950.63);
  assert.equal(live.data.debts[0].balance, 750.63);
  assert.deepEqual(live.data.plan.obligations, x.data.plan.obligations);
  const simulated = F.simulate(live.data.plan, NOW, { horizonDays: 5, weeklyVariable: 0 });
  assert.equal(simulated.ending, 950.63);
  const debt = F.projectDebts(live.data.plan, live.data.debts, NOW, { debtHorizonDays: 5 });
  assert.equal(debt.marks.at(-1).debts.find(d => d.id === card).balance, 750.63);
  const advice = F.recommend(live.data.plan, NOW, { debts: live.data.debts,
    currentPeriodActuals: live.report.currentPeriodActuals });
  assert.equal(advice.cardMinimumPayments.status, 'ready');
  assert.equal(advice.defaultView.balanceAfterDeductions, -43.19);
  const row = advice.defaultView.bills.find(b => b.id === x.eventId && b.date === DUE);
  assert.ok(row); assert.equal(row.householdPaymentStatus, 'paid'); assert.equal(row.cashPaid, 49.37);
  assert.equal(F.cardMinimumState(live.data.plan, '2035-10-04').payments.length, 0);
  const classification = F.classifyCurrentPeriodTransaction(live.report.currentPeriodActuals.transactions[0], live.data.plan);
  assert.equal(classification.kind, 'card-payment'); assert.equal(classification.householdSpending, false);
});

const negatives = {
  'generic transfer': x => { x.payload.categories[0].name = 'Payment, Transfer'; },
  'generic card payment': x => { x.payload.categories[0].name = 'Credit card payment'; },
  'wrong target card': x => { x.payload.categories[0].name = 'Minimum payment - TD Travel Visa'; },
  'unresolved category ID': x => { x.payload.categories = []; },
  'raw label alone': x => { x.payload.transactions[0].category_name = x.payload.categories[0].name; delete x.payload.transactions[0].category_id; },
  'contradictory category name': x => { x.payload.transactions[0].category_name = 'Payment, Transfer'; },
  'budget inclusion': x => { x.payload.categories[0].exclude_from_budget = false; },
  'totals inclusion': x => { x.payload.categories[0].exclude_from_totals = false; },
  'income category': x => { x.payload.categories[0].is_income = true; },
  'group category': x => { x.payload.categories[0].is_group = true; },
  'archived category': x => { x.payload.categories[0].archived = true; },
  'wrong funding account': x => { x.payload.transactions[0].account_id = 3002; },
  'external funding': x => { x.accountMap.mappings[0].atlasRole = 'household-external'; },
  'receiving card alone': x => { x.payload.transactions[0].account_id = 3004; x.payload.transactions[0].amount = -49.37; },
  'unknown account': x => { x.payload.transactions[0].account_id = 9999; },
  'pending': x => { x.payload.transactions[0].is_pending = true; },
  'unknown posting status': x => { delete x.payload.transactions[0].is_pending; },
  'foreign units': x => { x.payload.transactions[0].currency = 'usd'; },
  'missing units': x => { delete x.payload.transactions[0].currency; },
  'fractional cents': x => { x.payload.transactions[0].amount = 49.371; },
  'refund direction': x => { x.payload.transactions[0].amount = -49.37; },
  'refund payee': x => { x.payload.transactions[0].payee = 'CAN TIRE MC REFUND'; },
  'unrelated merchant': x => { x.payload.transactions[0].payee = 'Invented shopping'; },
  'split child': x => { x.payload.transactions[0].parent_id = 999; },
  'group transaction': x => { x.payload.transactions[0].is_group = true; },
  'conflicting evidence': x => { x.payload.transactions[0].contradictoryEvidence = true; },
  'future posting': x => { x.payload.transactions[0].date = '2035-10-09'; },
  'before statement creation': x => { x.payload.transactions[0].date = '2035-09-10'; x.payload.transactionWindow.startDate = '2035-09-01'; },
  'incomplete posted window': x => { x.payload.transactionWindow.complete = false; },
  'incomplete pending universe': x => { x.payload.pendingCoverage.complete = false; },
  'reused stable debit': x => { x.payload.transactions.push(clone(x.payload.transactions[0])); },
  'two payments one cycle': x => { x.payload.transactions.push({ ...x.payload.transactions[0], id: 98002 }); },
  'two obligations one card': x => { x.data.plan.obligations.push({ ...clone(x.data.plan.obligations[0]), id: 'triangle-twin' }); x.identity = clone(x.identity); x.identity.rules.push(...x.identity.rules.filter(r => r.eventId === 'triangle').map(r => ({ ...r, eventId: 'triangle-twin' }))); },
  'posted reversal': x => { x.payload.transactions.push({ ...x.payload.transactions[0], id: 98003, amount: -49.37, date: NOW }); },
  'card payment reversal': x => { x.payload.transactions.push({ id: 98003, account_id: 3004, date: NOW, amount: 49.37, currency: 'cad', payee: 'PAYMENT REVERSAL', is_pending: false }); },
  'owner-allocated purchase backfill': x => { const tx = O.normalizeLunchMoneyTransaction(x.payload.transactions[0]);
    x.data.plan.cardPurchaseCoverage = { payments: [{ confirmed: true, debitRef: O.cardCoverageReference(tx) }] }; },
};
for (const [name, mutate] of Object.entries(negatives)) check(name, () => { const x = fixture(); mutate(x); zero(x); });

check('partial payment and estimated minimum withhold satisfaction', () => {
  for (const estimated of [false, true]) {
    const x = fixture();
    if (estimated) delete x.data.plan.obligations[0].statementOccurrences;
    else x.payload.transactions[0].amount = 18.12;
    const live = Live.fromObservation(x), s = payment(live);
    assert.equal(s.status, 'unavailable'); assert.equal(s.payments.length, 1);
    assert.equal(s.payments[0].additionalCashRequired, null);
    assert.equal(s.payments[0].issuerMinimumStatus, 'unconfirmed');
  }
});
check('refresh is idempotent and changed category revokes only derived confirmation', () => {
  const x = fixture(), one = Live.fromObservation(x);
  const two = Live.fromObservation({ ...x, data: one.data });
  assert.deepEqual(payment(one), payment(two));
  assert.equal(F.startingCashAmount(two.data.plan), 950.63); assert.equal(two.data.debts[0].balance, 750.63);
  x.payload.categories[0].name = 'Payment, Transfer';
  const revoked = Live.fromObservation({ ...x, data: two.data });
  assert.equal(payment(revoked).payments.length, 0);
  assert.equal(revoked.data.plan.cardMinimumCategoryEvidence.payments.length, 0);
  assert.equal(F.startingCashAmount(revoked.data.plan), 950.63); assert.equal(revoked.data.debts[0].balance, 750.63);
  assert.deepEqual(revoked.data.plan.opening.representedEvents, []);
});
check('owner confirmation has precedence through category removal', () => {
  const x = fixture(), row = x.data.plan.obligations[0];
  row.sentPayments = [{ scheduledDate: ORIGINAL, confirmed: true, intent: 'minimum', debitId: 'invented-owner',
    postedOn: '2035-10-05', amount: 49.37, currency: 'cad', fundingAccountId: 'chequing-a', pending: false, cashIncludedAsOf: NOW }];
  x.data.plan.opening.representedEvents = [{ id: 'triangle', date: ORIGINAL, effectiveAsOf: NOW }];
  for (const changed of [false, true]) {
    if (changed) x.payload.categories[0].name = 'Payment, Transfer';
    const live = Live.fromObservation(x);
    assert.equal(payment(live).status, 'ready'); assert.equal(payment(live).payments.length, 1);
    assert.equal(packet(x).payments.length, 0);
  }
});
check('pending replacement requires current posted categorization', () => {
  const x = fixture(), pending = { ...x.payload.transactions[0], is_pending: true };
  x.payload.transactions.push(pending); assert.equal(packet(x).payments.length, 1);
  x.payload.transactions[0].category_id = null; assert.equal(packet(x).payments.length, 0);
});
check('advancing refreshes retain current evidence without claiming future or duplicate expense', () => {
  const x = fixture(); let data = Live.fromObservation(x).data;
  for (const day of ['2035-10-07', '2035-10-08', '2035-10-09']) {
    x.payload.fetchedAt = day + 'T18:00:00Z'; x.payload.transactionWindow.endDate = day;
    x.payload.accounts.forEach(a => { a.updated_at = day + 'T17:00:00Z'; });
    const live = Live.fromObservation({ ...x, data }); data = live.data;
    const s = F.cardMinimumState(data.plan, day); assert.equal(s.status, 'ready'); assert.equal(s.payments.length, 1);
    assert.equal(s.payments[0].cashPaid, 49.37); assert.equal(F.startingCashAmount(data.plan), 950.63);
    const advice = F.recommend(data.plan, day, { debts: data.debts, currentPeriodActuals: live.report.currentPeriodActuals });
    assert.equal(advice.defaultView.balanceAfterDeductions, -43.19);
    const row = advice.defaultView.bills.find(b => b.id === 'triangle' && b.date === DUE);
    assert.ok(row); assert.equal(row.status, 'PAID'); assert.equal(row.remaining, 0);
    assert.deepEqual(data.plan.opening.representedEvents, []);
  }
});
check('query and observer preserve canonical file', () => {
  assert.equal(fs.readFileSync(path.join(root, 'data.json'), 'utf8'), disk);
});
check('next pay-period remains Planned with separate early payment evidence', () => {
  const x = fixture(), r = x.data.plan.obligations[0];
  r.day = 17; r.firstDue = '2035-10-17';
  r.statementOccurrences[0].scheduledDate = r.statementOccurrences[0].dueDate = '2035-10-17';
  x.data.debts[0].statementCloseDay = 2;
  const live = Live.fromObservation(x);
  const advice = F.recommend(live.data.plan, NOW, { debts: live.data.debts,
    currentPeriodActuals: live.report.currentPeriodActuals });
  const future = advice.payPeriodViews.find(p => p.bills.some(b => b.id === 'triangle' && b.date === '2035-10-17'));
  assert.ok(future); const row = future.bills.find(b => b.id === 'triangle');
  assert.deepEqual([future.timelineRole, row.status, row.settlement, future.paidBills, row.remaining],
    ['next', 'planned', 'upcoming', 0, 43.19]);
  assert.equal(row.cashPaid, 49.37); assert.equal(row.householdPaymentStatus, 'paid');
});
check('Forecast refuses malformed derived evidence at its publication boundary', () => {
  const x = fixture(), live = Live.fromObservation(x);
  for (const mutate of [p => { p.currency = 'usd'; }, p => { p.pending = true; },
    p => { p.confirmed = false; }, p => { p.fundingAccountId = 'savings'; },
    p => { p.amount = 49.371; }, p => { p.postedOn = '2035-10-09'; }]) {
    const plan = clone(live.data.plan); mutate(plan.cardMinimumCategoryEvidence.payments[0]);
    assert.equal(F.cardMinimumState(plan, NOW).payments.length, 0);
    assert.ok(F.expandEvents(plan, NOW, '2035-10-10').some(e => e.id === 'triangle'));
  }
});
for (const c of cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.error ? '\n' + c.error : ''}`);
console.log(`${cases.filter(c => c.pass).length}/${cases.length} category protocol cases passed`);
process.exitCode = cases.every(c => c.pass) ? 0 : 1;
