'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const Detail = require('../public/bill-detail');
const Live = require('../scripts/live-plan');
const fixture = require('./fixtures/card-purchase-coverage-data');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Independent publication regression: an observed purchase is not evidence
// that its household coverage is known. No real owner rows or cents are used.
const unknown = fixture();
delete unknown.data.plan.cardPurchaseCoverage;
const observed = Live.fromObservation(unknown);
const packet = observed.data.liveOverlay.currentPeriodActuals;
const ledger = F.visaPaymentReconciliation(packet.transactions, {
  plan: unknown.data.plan, asOf: unknown.asOf, packet, debts: unknown.data.debts
});
assert.equal(ledger.status, 'unavailable');
assert.equal(ledger.reservedCash, null);
assert.equal(ledger.purchases[0].amount, 80);
assert(!Detail.visaPaymentsHtml([], ledger).includes('$80.00 to cover'),
  'unknown coverage must not present the observed purchase as a confirmed amount to cover');

function run(x) {
  const before = JSON.stringify(x), live = Live.fromObservation(x);
  const advice = F.recommend(live.data.plan, x.asOf, {
    debts: live.data.debts, currentPeriodActuals: live.data.liveOverlay.currentPeriodActuals
  });
  assert.equal(JSON.stringify(x), before, 'synthetic inputs remain immutable');
  const period = advice.payPeriodViews.find(p => p.start === '2026-09-18');
  const category = period.householdBudget.find(row => row.id === 'groceries');
  return { live, advice, period, category, tx: category.recon[0] };
}
function transfer(amount, confirm = true) {
  const x = fixture('backfill');
  x.payload.transactions[0].amount = 41.35;
  x.payload.transactions[1].amount = amount;
  x.payload.transactions[2].amount = -amount;
  x.payload.accounts[0].balance = 500 - amount;
  x.payload.accounts[3].balance = 441.35 - amount;
  if (confirm) fixture.confirm(x, 'invented-explicit-allocation', 80002, 80003, [[80001, amount]]);
  return x;
}
const source = fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8');
const metric = source.match(/^function householdBudgetMetric\([\s\S]*?\n\}/m)[0];
const render = vm.runInNewContext(metric + '\n householdBudgetMetric', {
  money2: amount => '$' + amount.toFixed(2), fmtDate: date => date
});
const html = r => render('Spent', r.category.spent, { recon: r.category.recon, id: 'groceries' });
const unconfirmed = run(unknown);
assert.equal(unconfirmed.tx.cardPurchaseCoverage.status, 'unconfirmed');
assert.equal(unconfirmed.tx.cardPurchaseCoverage.remaining, null);
assert.match(html(unconfirmed), /Coverage unconfirmed/);
assert.doesNotMatch(html(unconfirmed), /still to cover/);

const purchase = run(fixture());
assert.equal(purchase.tx.cardPurchaseCoverage.status, 'awaiting-coverage');
assert.equal(purchase.tx.cardPurchaseCoverage.remaining, 80);
assert.equal(purchase.category.remaining, 150 - 80);
assert.equal(purchase.period.liveCurrentBalance, 500);
assert.match(html(purchase), /is-card-coverage-open/);
assert.match(html(purchase), /Card purchase/);
assert.match(html(purchase), /\$80.00 still to cover/);

const partial = run(transfer(12.10)), full = run(transfer(41.35));
assert.equal(partial.tx.cardPurchaseCoverage.remaining, 29.25, '4135 - 1210 = 2925 cents');
assert.equal(partial.advice.cardPurchaseCoverage.reservedCash, 29.25);
assert.match(html(partial), /\$29.25 still to cover/);
assert.equal(full.tx.cardPurchaseCoverage.status, 'resolved');
assert.equal(full.tx.cardPurchaseCoverage.remaining, 0);
assert.doesNotMatch(html(full), /is-card-coverage-open/);
assert.match(html(full), /Invented grocer/);
assert.match(html(full), /\$41.35/);
for (const r of [partial, full]) {
  assert.equal(r.category.spent, 41.35, 'original purchase stays one category expense');
  assert.equal(r.category.remaining, 108.65);
  assert.equal(r.category.recon.length, 1, 'paired transfer is not another expense');
  assert.equal(r.period.fromTodayFunding.operatingBills, 25, 'backfill leaves scheduled minimum intact');
}
assert.equal(partial.period.liveCurrentBalance, 487.90);
assert.equal(full.period.liveCurrentBalance, 458.65);
assert.equal(full.live.data.debts[0].balance, 400);

// An equal-amount pair without explicit allocation does not clear the marker.
const ambiguous = run(transfer(41.35, false));
assert.equal(ambiguous.tx.cardPurchaseCoverage.status, 'unconfirmed');
assert.equal(ambiguous.tx.cardPurchaseCoverage.remaining, null);
assert.match(html(ambiguous), /Coverage unconfirmed/);
assert.doesNotMatch(html(ambiguous), /Coverage resolved|still to cover/);

const pending = fixture(); pending.payload.transactions[0].is_pending = true;
const pendingResult = run(pending);
assert.equal(pendingResult.category.spent, 80);
assert.equal(pendingResult.tx.pending, true);
assert.equal(pendingResult.tx.cardPurchaseCoverage.remaining, 80);
assert.match(html(pendingResult), /Pending/);
const pendingPair = transfer(41.35); pendingPair.payload.transactions[2].is_pending = true;
assert.equal(run(pendingPair).tx.cardPurchaseCoverage.status, 'unconfirmed');
const declared = transfer(41.35);
declared.data.plan.cardPurchaseCoverage.payments[0].confirmed = false;
assert.equal(run(declared).tx.cardPurchaseCoverage.status, 'unconfirmed', 'declared intent alone is not verified coverage');
const notObserved = transfer(41.35);
notObserved.payload.transactions = notObserved.payload.transactions.slice(0, 1);
assert.equal(run(notObserved).tx.cardPurchaseCoverage.status, 'unconfirmed', 'even declared confirmed intent needs both observed posted legs');

const refund = fixture();
refund.payload.transactions.push({ ...refund.payload.transactions[0], id: 80006, amount: -31.25,
  payee: 'Invented refund', category_name: 'Refund' });
refund.payload.accounts[3].balance = 448.75;
refund.data.plan.cardPurchaseCoverage.refunds = [{ confirmed: true,
  purchaseRef: fixture.ref(refund, 80001), refundRef: fixture.ref(refund, 80006) }];
const refunded = run(refund);
assert.equal(refunded.tx.cardPurchaseCoverage.remaining, 48.75, '8000 - 3125 = 4875 cents');
assert.equal(refunded.category.spent, 80);
assert.equal(refunded.category.recon.length, 1);
assert.equal(refunded.period.liveCurrentBalance, 500);
const fullRefund = structuredClone(refund);
fullRefund.payload.transactions[1].amount = -80;
fullRefund.data.plan.cardPurchaseCoverage.refunds[0].refundRef = fixture.ref(fullRefund, 80006);
assert.equal(run(fullRefund).tx.cardPurchaseCoverage.status, 'resolved');

// Current rows never hide older protected cash or relax whole-ledger trust.
const older = fixture();
older.data.plan.cardPurchaseCoverage.opening.purchases = [{ ref: 'invented-old-opening-row',
  accountId: 'travelvisa', date: '2026-09-10', amount: 22.45, covered: 0, categoryLabel: 'Groceries' }];
const carried = run(older);
assert.equal(carried.advice.cardPurchaseCoverage.reservedCash, 102.45);
assert.equal(carried.category.spent, 80, 'earlier purchase is not current category spending');
assert.equal(carried.category.recon.length, 1);
const olderUnknown = transfer(41.35);
olderUnknown.payload.transactions.push({ ...olderUnknown.payload.transactions[0], id: 80007,
  date: '2026-09-19', amount: -7.15, category_name: 'Refund' });
const blocked = run(olderUnknown);
assert.equal(blocked.advice.cardPurchaseCoverage.status, 'unavailable');
assert.equal(blocked.tx.cardPurchaseCoverage.status, 'unconfirmed', 'unknown ledger prevents claiming a resolved purchase');
assert.equal(blocked.period.fromTodayFunding.availableNow, null);

const rolled = transfer(12.10);
rolled.asOf = '2026-10-03';
rolled.payload.fetchedAt = rolled.asOf + 'T18:00:00Z';
rolled.payload.transactionWindow.endDate = rolled.asOf;
rolled.payload.accounts.forEach(a => { a.updated_at = rolled.asOf + 'T17:00:00Z'; });
rolled.payload.transactions.slice(1).forEach(tx => { tx.date = rolled.asOf; });
rolled.payload.transactions.push({ ...rolled.payload.transactions[0], id: 80008,
  date: rolled.asOf, amount: 9.80, payee: 'Invented next-period grocer' });
rolled.payload.accounts[3].balance = 439.05;
const acrossPeriods = run(rolled);
const newPeriod = acrossPeriods.advice.payPeriodViews.find(p => p.start === '2026-10-02');
const newCategory = newPeriod.householdBudget.find(r => r.id === 'groceries');
assert.equal(acrossPeriods.category.spent, 41.35);
assert.equal(acrossPeriods.tx.cardPurchaseCoverage.remaining, 29.25);
assert.equal(newCategory.spent, 9.80, 'new period shows only its own purchase expense');
assert.equal(newCategory.recon.length, 1);
assert.equal(newCategory.recon[0].cardPurchaseCoverage.remaining, 9.80);
assert.equal(acrossPeriods.advice.cardPurchaseCoverage.reservedCash, 39.05,
  '2925 carried cents plus 980 current cents; a new period never resets coverage');

// Cash transactions have no card marker; labels stay escaped, refs private.
const cash = fixture(); cash.payload.transactions[0].account_id = 3002;
assert.equal(run(cash).tx.cardPurchaseCoverage, undefined);
const malicious = fixture(); malicious.payload.transactions[0].payee = 'Invented <img onerror=alert(1)>';
assert.doesNotMatch(html(run(malicious)), /<img/);
for (const r of [purchase, partial, full, unconfirmed]) {
  assert.doesNotMatch(JSON.stringify(r.tx.cardPurchaseCoverage), /coverageRef|purchaseRef|transaction|80001/);
}
console.log('PASS card category markers: purchase/partial/full/refund/pending/ambiguity, cash/minimum/expense conservation, older reserve, safe rendering');
