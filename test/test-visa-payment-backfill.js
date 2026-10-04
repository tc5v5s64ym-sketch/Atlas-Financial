'use strict';
// Visa payment backfill. Synthetic cents (L-006). The expected split is the
// documented identity backfill = min(payment, max(0, purchases − refunds)),
// not a second call into the same allocator.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../public/forecast');
const O = require('../scripts/provider-observe');
const Detail = require('../public/bill-detail');

function tx(fields) {
  return Object.assign({
    pending: false,
    pendingPostedAmbiguous: false,
  }, fields);
}

function pay(id, date, amount, card) {
  return tx({
    id, date, amount: -amount, atlasAccountId: card, account: card,
    payee: 'PAYMENT - THANK YOU', categoryLabel: 'Credit Card Payment',
  });
}

function purchase(id, date, amount, card, category) {
  return tx({
    id, date, amount, atlasAccountId: card, account: card,
    payee: 'MARKET', categoryLabel: category,
  });
}

function identity(paymentCents, purchaseCents, refundCents) {
  const net = Math.max(0, purchaseCents - refundCents);
  const backfill = Math.min(paymentCents, net);
  return {
    backfill: backfill / 100,
    cardPayment: (paymentCents - backfill) / 100,
  };
}

function one(rows, card) {
  const found = rows.filter(row => !card || row.card === card);
  assert.equal(found.length, 1);
  return found[0];
}

function assertSplit(row, paymentCents, purchaseCents, refundCents) {
  const expected = identity(paymentCents, purchaseCents, refundCents);
  assert.equal(row.status, 'reconciled');
  assert.equal(row.backfill, expected.backfill);
  assert.equal(row.cardPayment, expected.cardPayment);
  assert.equal(Math.round((row.backfill + row.cardPayment) * 100), paymentCents);
  assert.equal(row.extraPaydown, 0);
  assert.equal(row.satisfiesMinimum, false);
  const covered = Math.round((row.purchases || []).reduce((sum, item) => sum + item.amount, 0) * 100);
  assert.equal(covered, Math.round(row.backfill * 100));
}

console.log('exact backfill');
{
  const rows = F.visaPaymentReconciliation([
    purchase('p1', '2026-09-20', 35, 'travelvisa', 'Groceries'),
    pay('pay', '2026-09-29', 35, 'travelvisa'),
  ]).payments;
  const row = one(rows, 'travelvisa');
  assertSplit(row, 3500, 3500, 0);
  assert.equal(row.reason, 'exact-backfill');
  assert.equal(row.purchases[0].categoryLabel, 'Groceries');
  assert.equal(row.purchases[0].date, '2026-09-20');
  assert.equal(row.accountLabel, 'Travel Visa');
  assert.equal(row.window.rule, 'posted-purchases-on-or-before-payment-date');
}

console.log('partial: remainder is the card payment');
{
  const row = one(F.visaPaymentReconciliation([
    purchase('p1', '2026-09-10', 10, 'cashback', 'Fuel'),
    pay('pay', '2026-09-12', 26, 'cashback'),
  ]).payments, 'cashback');
  assertSplit(row, 2600, 1000, 0);
  assert.equal(row.reason, 'partial-backfill');
  assert.equal(row.accountLabel, 'TD Cash Back Visa');
}

console.log('payment smaller than purchases is entirely backfill');
{
  const row = one(F.visaPaymentReconciliation([
    purchase('p1', '2026-09-02', 40, 'tdcc', 'Household'),
    pay('pay', '2026-09-18', 10, 'tdcc'),
  ]).payments, 'tdcc');
  assertSplit(row, 1000, 4000, 0);
  assert.equal(row.reason, 'payment-within-purchases');
  assert.equal(row.cardPayment, 0);
  assert.equal(row.accountLabel, 'TD credit card');
}

console.log('no posted purchases: the whole payment stays a card payment');
{
  const row = one(F.visaPaymentReconciliation([
    pay('pay', '2026-09-18', 19, 'travelvisa'),
  ]).payments);
  assertSplit(row, 1900, 0, 0);
  assert.equal(row.reason, 'no-posted-purchases');
  assert.deepEqual(row.purchases, []);
}

console.log('two payments: uncovered purchases do not carry');
{
  const rows = F.visaPaymentReconciliation([
    purchase('a', '2026-09-05', 30, 'travelvisa', 'Groceries'),
    pay('first', '2026-09-10', 10, 'travelvisa'),
    purchase('b', '2026-09-12', 20, 'travelvisa', 'Fuel'),
    pay('second', '2026-09-20', 25, 'travelvisa'),
  ]).payments;
  assert.equal(rows.length, 2);
  const first = rows.find(row => row.id === 'first');
  const second = rows.find(row => row.id === 'second');
  assertSplit(first, 1000, 3000, 0);
  assert.equal(first.window.through, '2026-09-10');
  assertSplit(second, 2500, 2000, 0);
  assert.equal(second.window.previousPaymentDate, '2026-09-10');
  assert.equal(second.window.rule, 'posted-purchases-after-previous-payment-through-payment-date');
  assert.equal(second.purchases.length, 1);
  assert.equal(second.purchases[0].date, '2026-09-12');
}

console.log('refunds reduce the purchase total and floor at zero');
{
  const reduced = one(F.visaPaymentReconciliation([
    purchase('p', '2026-09-03', 30, 'travelvisa', 'Groceries'),
    tx({ id: 'r', date: '2026-09-04', amount: -10, atlasAccountId: 'travelvisa',
      account: 'travelvisa', payee: 'MARKET REFUND', categoryLabel: 'Refund' }),
    pay('pay', '2026-09-06', 25, 'travelvisa'),
  ]).payments);
  assertSplit(reduced, 2500, 3000, 1000);
  const floored = one(F.visaPaymentReconciliation([
    purchase('p', '2026-09-03', 10, 'travelvisa', 'Groceries'),
    tx({ id: 'r', date: '2026-09-04', amount: -40, atlasAccountId: 'travelvisa',
      account: 'travelvisa', payee: 'MARKET', categoryLabel: 'Refund' }),
    pay('pay', '2026-09-06', 15, 'travelvisa'),
  ]).payments);
  assertSplit(floored, 1500, 1000, 4000);
  assert.equal(floored.backfill, 0);
}

console.log('pending purchases are not matched; a twin counts the posted side once');
{
  const pendingOnly = one(F.visaPaymentReconciliation([
    purchase('pend', '2026-09-08', 20, 'travelvisa', 'Groceries'),
    pay('pay', '2026-09-09', 20, 'travelvisa'),
  ].map((row, index) => index === 0 ? Object.assign({}, row, { pending: true }) : row)).payments);
  assertSplit(pendingOnly, 2000, 0, 0);

  const pending = purchase('pend', '2026-09-08', 20, 'travelvisa', 'Groceries');
  pending.pending = true;
  pending.displayedPayee = 'MARKET';
  const posted = purchase('post', '2026-09-08', 20, 'travelvisa', 'Groceries');
  posted.displayedPayee = 'MARKET';
  const twinned = one(F.visaPaymentReconciliation([
    pending, posted, pay('pay', '2026-09-09', 40, 'travelvisa'),
  ]).payments);
  assertSplit(twinned, 4000, 2000, 0);
  assert.equal(twinned.purchases.length, 1);
  assert.equal(twinned.purchases[0].amount, 20);
  assert.equal(twinned.duplicateIdsNoted, true);
}

console.log('ambiguous and missing evidence fail closed');
{
  const ambiguous = one(F.visaPaymentReconciliation([
    tx({ id: 'c', date: '2026-09-04', amount: -8, atlasAccountId: 'travelvisa', account: 'travelvisa' }),
    pay('pay', '2026-09-05', 12, 'travelvisa'),
  ]).payments);
  assert.equal(ambiguous.status, 'unreconciled');
  assert.equal(ambiguous.reason, 'ambiguous-credit');
  assert.equal(ambiguous.backfill, null);
  assert.equal(ambiguous.cardPayment, null);
  assert.equal(ambiguous.extraPaydown, 0);

  const missing = one(F.visaPaymentReconciliation([
    tx({ id: 'pay', date: '2026-09-05', atlasAccountId: 'travelvisa', account: 'travelvisa',
      payee: 'PAYMENT - THANK YOU' }),
  ]).payments);
  assert.equal(missing.status, 'unreconciled');
  assert.equal(missing.reason, 'missing-amount');

  const incomplete = one(F.visaPaymentReconciliation([
    purchase('p', '2026-09-02', 10, 'travelvisa', 'Groceries'),
    pay('pay', '2026-09-03', 10, 'travelvisa'),
  ], { evidence: { complete: false } }).payments);
  assert.equal(incomplete.status, 'unreconciled');
  assert.equal(incomplete.reason, 'incomplete-evidence');
  assert.equal(incomplete.backfill, null);

  const ambiguousTwin = purchase('post', '2026-09-08', 20, 'travelvisa', 'Groceries');
  ambiguousTwin.pendingPostedAmbiguous = true;
  const blocked = one(F.visaPaymentReconciliation([
    ambiguousTwin, pay('pay', '2026-09-09', 20, 'travelvisa'),
  ]).payments);
  assert.equal(blocked.status, 'unreconciled');
  assert.equal(blocked.reason, 'pending-possible-replacement');
}

console.log('non-Visa cards, HELOC, and the mortgage are unchanged');
{
  const before = [
    pay('tri', '2026-09-07', 50, 'triangle'),
    pay('mbna', '2026-09-08', 40, 'mbna'),
    tx({ id: 'heloc', date: '2026-09-21', amount: 814.18, atlasAccountId: 'heloc',
      account: 'heloc', payee: 'HELOC PAYMENT' }),
    tx({ id: 'mort', date: '2026-09-14', amount: 2000, atlasAccountId: 'mortgage',
      account: 'mortgage', payee: 'TD MORTGAGE' }),
    purchase('keep', '2026-09-11', 5, 'travelvisa', 'Groceries'),
    pay('visa', '2026-09-12', 5, 'travelvisa'),
  ];
  const snapshot = JSON.stringify(before);
  const result = F.visaPaymentReconciliation(before);
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].card, 'travelvisa');
  assert.equal(result.carryForward, 'uncovered-purchases-do-not-carry');
  assert.equal(result.payments.some(row => row.card === 'triangle'
    || row.card === 'mbna' || row.card === 'heloc' || row.card === 'mortgage'), false);
}

console.log('the split is published and does not reopen automatic minimum settlement');
{
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const identityRules = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'connectivity', 'transaction-identity.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'connectivity', 'fixtures', 'b81-account-map.json'), 'utf8'));
  const travel = data.plan.obligations.find(row => row && row.id === 'travel');
  travel.amount = 15;
  const due = '2026-08-26';
  function credit(id, amount) {
    return {
      id, account_id: 3006, date: due, amount: -amount,
      payee: 'PAYMENT - THANK YOU', original_name: 'PAYMENT - THANK YOU',
      is_pending: false, status: 'reviewed',
    };
  }
  function bought(id, amount) {
    return {
      id, account_id: 3006, date: '2026-08-20', amount,
      payee: 'MARKET', original_name: 'MARKET', category_name: 'Groceries',
      is_pending: false, status: 'reviewed',
    };
  }
  function observe(transactions) {
    return O.observe({
      provider: 'lunchmoney',
      payload: {
        provider: 'lunchmoney',
        fetchedAt: due + 'T18:00:00.000Z',
        pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false },
        accounts: [{
          id: 3006, name: 'TD TRAVEL VISA', type: 'credit', subtype: 'credit_card',
          institution_name: 'TD Canada Trust', currency: 'cad', balance: 100,
          credit_limit: 1100, updated_at: due + 'T17:55:00.000Z',
        }],
        transactions,
        transactionWindow: {
          startDate: '2026-07-01', endDate: due, complete: true, hasMore: false, truncated: false,
        },
      },
      accountMap: map,
      data,
      identity: identityRules,
    });
  }
  const hits = report => (report.representedEventCandidates || [])
    .filter(row => row && row.id === 'travel' && row.date === due);
  const backfill = observe([bought(1, 40), credit(2, 40)]);
  assert.equal(hits(backfill).length, 0);
  const partial = observe([bought(3, 10), credit(4, 40)]);
  assert.equal(hits(partial).length, 0);
  const genuine = observe([credit(5, 40)]);
  assert.equal(hits(genuine).length, 0);
  const published = backfill.currentPeriodActuals.visaPaymentBackfill;
  assert.equal(published.length, 1);
  assert.equal(published[0].status, 'reconciled');
  assert.equal(published[0].backfill, 40);
  assert.equal(published[0].cardPayment, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(published[0], 'card'), false);
  const partialPublished = partial.currentPeriodActuals.visaPaymentBackfill;
  assert.equal(partialPublished.length, 1);
  assert.equal(partialPublished[0].backfill, 10);
  assert.equal(partialPublished[0].cardPayment, 30);
  const genuinePublished = genuine.currentPeriodActuals.visaPaymentBackfill;
  assert.equal(genuinePublished[0].backfill, 0);
  assert.equal(genuinePublished[0].cardPayment, 40);
}

console.log('Budget prints the engine split and does no money math');
{
  const engine = F.visaPaymentReconciliation([
    purchase('p1', '2026-09-20', 10, 'travelvisa', 'Groceries'),
    pay('pay-35', '2026-09-29', 15, 'travelvisa'),
  ]);
  const published = engine.payments.map(F.visaPaymentPublication);
  assert.equal(published[0].backfill, 10);
  assert.equal(published[0].cardPayment, 5);
  assert.equal(Object.prototype.hasOwnProperty.call(published[0], 'card'), false);
  const html = Detail.visaPaymentsHtml(published);
  assert.match(html, /backfill \$10\.00 \/ card payment \$5\.00/);
  assert.match(html, /2026-09-20 · \$10\.00 · Groceries/);
  assert.match(html, /Travel Visa · 2026-09-29/);
  assert.doesNotMatch(html, /travelvisa|cashback|tdcc|chequing-a|5425|account_id/);
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'bill-detail.js'), 'utf8');
  const fn = source.slice(source.indexOf('function visaPaymentsHtml'), source.indexOf('return { html, evidence, visaPaymentsHtml }'));
  assert.equal(/\b(backfill|cardPayment|amount)\b\s*[+\-*/]/.test(fn), false);
  const planSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'plan.js'), 'utf8');
  assert.match(planSource, /BillDetail\.visaPaymentsHtml\(period && period\.visaPaymentBackfill\)/);
  assert.doesNotMatch(planSource, /visaPaymentBackfill[^;\n]*[+\-*/]/);

  const context = vm.createContext({
    Forecast: F, BillDetail: Detail, console,
    document: { addEventListener() {}, querySelectorAll() { return []; },
      getElementById() { return null; }, documentElement: { dataset: {}, style: {} } },
    window: { addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; } },
    localStorage: { getItem() { return null; }, setItem() {} }, location: { pathname: '/' },
    addEventListener() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), context);
  vm.runInContext('App.boot = () => {}; App.once = () => {}; App.register = () => {};', context);
  vm.runInContext(fs.readFileSync(require.resolve('../public/plan.js'), 'utf8'), context);
  context.period = {
    bills: [],
    visaPaymentBackfill: published,
    totalBillsThisPeriod: 80,
    paidBills: 0,
    remainingBills: 80,
  };
  const rendered = vm.runInContext('calendarPeriodBillsHtml(period)', context);
  assert.match(rendered, /No bills in this period/);
  assert.match(rendered, /backfill \$10\.00 \/ card payment \$5\.00/);
  assert.doesNotMatch(rendered, /\$15\.00|\$80\.00/);
  assert.doesNotMatch(rendered, /travelvisa|5425/);
  const unreconciled = Detail.visaPaymentsHtml([Object.assign({}, published[0], {
    status: 'unreconciled', reason: 'incomplete-evidence', backfill: null, cardPayment: null,
    purchases: [],
  })]);
  assert.match(unreconciled, /data-visa-payment="unreconciled"/);
  assert.match(unreconciled, /not split/);
  assert.doesNotMatch(unreconciled, /backfill \$/);
}

console.log('visa payment backfill ok');
