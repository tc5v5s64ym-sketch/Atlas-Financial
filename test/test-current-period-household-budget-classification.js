'use strict';
/* Current-period Household Budget classification: represented bills are
 * bills only, and owner-confirmed Walmart / Meridian Farm purchases are
 * Groceries. Synthetic fixtures and independent arithmetic (L-002 / L-006).
 *
 * `node test/test-current-period-household-budget-classification.js`
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const AS_OF = '2026-09-01';
const GOOGLE_AMT = 3.13;
const WALMART_AMT = 41.17;
const MERIDIAN_AMT = 19.44;
const OTHER_AMT = 7.50;
const NATURAL_GAS_AMT = 21;
const BANK_FEE_AMT = 8.5;
const AMAZON_AMT = 14;
const BUSINESS_WALMART_AMT = 22.11;
const BUSINESS_MERIDIAN_AMT = 14.07;
const GROCERY_INDEPENDENT = roundCent(WALMART_AMT + MERIDIAN_AMT);
const EXCLUDED_BUSINESS_INDEPENDENT = roundCent(BUSINESS_WALMART_AMT + BUSINESS_MERIDIAN_AMT);
const SPENT_WITH_BILL = roundCent(GROCERY_INDEPENDENT + OTHER_AMT + GOOGLE_AMT);
const SPENT_WITHOUT_BILL = roundCent(GROCERY_INDEPENDENT + OTHER_AMT);

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: AS_OF, priorAsOf: '2026-08-28', representedEvents: [] },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: '2026-08-14', amount: 4264, confidence: 'confirmed',
    }],
    bills: [{
      id: 'google-storage-100gb',
      label: 'Google storage — 100 GB',
      frequency: 'monthly',
      day: 31,
      amount: GOOGLE_AMT,
      confidence: 'confirmed',
      budgetCategory: 'subscriptions',
      payingAccount: 'chequing-a',
    }],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedWeekly: 450, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedPayday: 325, ownerLine: 'Fuel' },
        { id: 'household', label: 'Household', class: 'essential', plannedPayday: 37.5, ownerLine: 'Household' },
        { id: 'pets', label: 'Pets', class: 'essential', plannedPayday: 100, ownerLine: 'Dog food' },
        { id: 'restaurants', label: 'Dining', class: 'discretionary', from: ['Restaurants', 'Dining', 'Fast Food', 'Food Delivery'], plannedPayday: 200, ownerLine: 'Eating out' },
        { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary', plannedPayday: 150, ownerLine: 'Dale guilt-free spending' },
        { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary', plannedPayday: 150, ownerLine: 'Amanda guilt-free spending' },
        { id: 'shopping', label: 'Shopping', class: 'discretionary', from: ['Shopping', 'Personal'] },
        { id: 'subscriptions', label: 'Subscriptions', class: 'essential', from: ['Subscriptions'] },
      ],
      excluded: [{
        from: 'Business',
        why: 'Amanda coaching, not household',
      }],
    },
  };
}

const debts = [
  { id: 'tdcc', label: 'TD personal Visa', secured: false, structure: 'Revolving', balance: 90, rate: 24.99, payment: 94.03, pending: 0 },
  { id: 'heloc', label: 'HELOC', secured: true, structure: 'Interest-only revolving', balance: 1000, rate: 4.9, payment: 0, pending: 0, cashPayment: 0, interestTreatment: 'capitalised' },
  { id: 'mortgage', label: 'Mortgage', secured: true, structure: 'Amortising', balance: 5000, rate: 3.64, payment: 1600, pending: 0 },
];

function actualsPacket(txs, extra) {
  return Object.assign({
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: AS_OF,
    coverageStart: '2026-07-01',
    coverageThrough: AS_OF,
    pendingCoverage: 'complete',
    transactionCoverage: 'complete',
    representedActuals: [],
    transactions: txs,
  }, extra || {});
}

function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p.id === id);
}
function budgetRow(p, id) {
  return ((p && p.householdBudget) || []).find(r => r.id === id) || null;
}
function otherRow(p) {
  return ((p && p.householdBudget) || []).find(r => r && r.otherSpending) || null;
}
function reconIds(p) {
  const ids = [];
  for (const row of (p && p.householdBudget) || []) {
    for (const tx of row.recon || []) {
      if (tx && tx.id) ids.push(tx.id);
    }
  }
  return ids;
}
function reconSum(row) {
  return roundCent(((row && row.recon) || []).reduce((s, tx) => s + (Number(tx.amount) || 0), 0));
}
function householdSpent(p) {
  return roundCent(((p && p.householdBudget) || []).reduce((s, row) => {
    return s + (Number(row && row.spent) || 0);
  }, 0));
}

function googleTx(extra) {
  return Object.assign({
    id: 'tx-google',
    date: '2026-08-31',
    amount: GOOGLE_AMT,
    pending: false,
    categoryLabel: 'Shopping',
    accountRole: 'household-cash',
    displayedPayee: 'Google',
    originalMerchant: 'Google',
    representedBill: false,
  }, extra || {});
}
function walmartTx(extra) {
  return Object.assign({
    id: 'tx-walmart',
    date: '2026-08-31',
    amount: WALMART_AMT,
    pending: false,
    categoryLabel: 'Shopping',
    accountRole: 'household-cash',
    displayedPayee: 'Walmart',
    originalMerchant: 'Walmart',
  }, extra || {});
}
function meridianTx(extra) {
  return Object.assign({
    id: 'tx-meridian',
    date: '2026-08-31',
    amount: MERIDIAN_AMT,
    pending: false,
    categoryLabel: 'Groceries',
    accountRole: 'household-cash',
    displayedPayee: 'Meridian Farm',
    originalMerchant: 'Meridian Farm',
  }, extra || {});
}
function otherTx() {
  return {
    id: 'tx-other',
    date: '2026-08-31',
    amount: OTHER_AMT,
    pending: false,
    categoryLabel: 'Gifts',
    accountRole: 'household-cash',
    displayedPayee: 'Gift Shop',
    originalMerchant: 'Gift Shop',
  };
}
function naturalGasTx(extra) {
  return Object.assign({
    id: 'tx-natural-gas',
    date: '2026-09-01',
    amount: NATURAL_GAS_AMT,
    pending: false,
    categoryLabel: 'Natural Gas',
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    displayedPayee: 'FortisBC Energy BPY',
    originalMerchant: 'FortisBC Energy BPY',
  }, extra || {});
}
function bankFeeTx(extra) {
  return Object.assign({
    id: 'tx-bank-fee',
    date: '2026-08-31',
    amount: BANK_FEE_AMT,
    pending: false,
    categoryLabel: 'Other bank fees',
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    displayedPayee: 'MONTHLY ACCOUNT FEE',
    originalMerchant: 'MONTHLY ACCOUNT FEE',
  }, extra || {});
}
function amazonTx(extra) {
  return Object.assign({
    id: 'tx-amazon',
    date: '2026-08-31',
    amount: AMAZON_AMT,
    pending: false,
    categoryLabel: 'Shopping',
    accountRole: 'revolving-credit',
    displayedPayee: 'Amazon',
    originalMerchant: 'Amazon',
  }, extra || {});
}
function amazonPrimeTx(extra) {
  return Object.assign({
    id: 'tx-amazon-prime',
    date: '2026-08-31',
    amount: 9.99,
    pending: false,
    categoryLabel: 'Shopping',
    accountRole: 'revolving-credit',
    displayedPayee: 'Amazon Prime',
    originalMerchant: 'Amazon Prime',
  }, extra || {});
}

function recommend(packet, extraPlan, extraOpts) {
  const plan = Object.assign(syntheticPlan(), extraPlan || {});
  const represented = (plan.opening && plan.opening.representedEvents) || [];
  return F.recommend(plan, AS_OF, Object.assign({
    targetBuffer: 500,
    debts,
    currentPeriodActuals: packet,
    representedEvents: represented,
  }, extraOpts || {}));
}

console.log('\n=== 1. unique represented Google bill is a bill, never Household Budget ===');
{
  ok(near(GOOGLE_AMT, 3.13) && near(WALMART_AMT + MERIDIAN_AMT, GROCERY_INDEPENDENT),
    'independent fixture arithmetic: Google $3.13; Groceries $41.17+$19.44=$60.61');
  const plan = syntheticPlan();
  plan.opening.representedEvents = [{ id: 'google-storage-100gb', date: '2026-08-31' }];
  const packet = actualsPacket([
    googleTx({ representedBill: true }),
    walmartTx(),
    meridianTx(),
    otherTx(),
  ], {
    representedActuals: [{
      id: 'google-storage-100gb',
      date: '2026-08-31',
      actual: GOOGLE_AMT,
      postedOn: '2026-08-31',
      transactionId: 'tx-google',
    }],
  });
  const googleCls = F.classifyCurrentPeriodTransaction(packet.transactions[0], plan, {
    currentPeriodActuals: packet,
  });
  ok(googleCls.kind === 'bill' && googleCls.householdSpending === false
      && googleCls.reason === 'represented-bill',
    'linked Google storage classifies as bill, householdSpending false',
    JSON.stringify(googleCls));
  const advice = recommend(packet, { opening: plan.opening });
  const active = period(advice.defaultView, 'this-pay-period');
  const groceries = budgetRow(active, 'groceries');
  const pets = budgetRow(active, 'pets');
  const other = otherRow(active);
  const ids = reconIds(active);
  ok(groceries && near(groceries.spent, GROCERY_INDEPENDENT)
      && near(reconSum(groceries), GROCERY_INDEPENDENT),
    'Groceries spent independently equals Walmart+Meridian Farm');
  ok(other && near(other.spent, OTHER_AMT) && near(reconSum(other), OTHER_AMT),
    'Other spending is the constructed $7.50 residual only');
  ok(!ids.includes('tx-google'),
    'Google transaction id is absent from every Household Budget recon row');
  ok(!(groceries.recon || []).some(tx => tx && tx.id === 'tx-google')
      && !(other.recon || []).some(tx => tx && tx.id === 'tx-google'),
    'Google is in neither Groceries nor Other spending');
  ok(pets && near(pets.spent, 0)
      && !(pets.recon || []).some(tx => tx && tx.id === 'tx-meridian'),
    'Meridian Farm does not enter Dog food');
  const googlePaid = (active.bills || []).find(row => row && row.id === 'google-storage-100gb');
  ok(googlePaid && googlePaid.status === 'PAID'
      && (googlePaid.settlement === 'represented' || googlePaid.remaining === 0),
    'modeled Google storage occurrence is settled/represented',
    JSON.stringify(googlePaid || null));
}

console.log('\n=== 2. date + amount without unique linkage is not the Google bill ===');
{
  const plan = syntheticPlan();
  plan.opening.representedEvents = [{ id: 'google-storage-100gb', date: '2026-08-31' }];
  const decoy = googleTx({
    id: 'tx-decoy',
    representedBill: false,
    displayedPayee: 'UNRELATED DEBIT',
    originalMerchant: 'UNRELATED DEBIT',
    categoryLabel: 'Gifts',
  });
  const packet = actualsPacket([decoy], {
    representedActuals: [{
      id: 'google-storage-100gb',
      date: '2026-08-31',
      actual: GOOGLE_AMT,
      postedOn: '2026-08-31',
    }],
  });
  const cls = F.classifyCurrentPeriodTransaction(decoy, plan, {
    currentPeriodActuals: packet,
  });
  ok(cls.kind !== 'bill' && cls.reason !== 'represented-bill',
    'same date and amount without transactionId linkage is not treated as the Google bill',
    JSON.stringify(cls));
  ok(cls.householdSpending === true,
    'unlinked same-cents debit remains household spending, fail closed');
  const advice = recommend(packet, { opening: plan.opening });
  const active = period(advice.defaultView, 'this-pay-period');
  const other = otherRow(active);
  ok(other && (other.recon || []).some(tx => tx && tx.id === 'tx-decoy'),
    'unlinked same-cents debit still appears in Other spending');
}

console.log('\n=== 3. Walmart is Groceries, never Other spending ===');
{
  const plan = syntheticPlan();
  const tx = walmartTx();
  const cls = F.classifyCurrentPeriodTransaction(tx, plan);
  ok(cls.kind === 'spend' && cls.categoryId === 'groceries'
      && cls.needsConfirmation !== true && cls.householdSpending === true,
    'Walmart with Shopping label classifies as Groceries',
    JSON.stringify(cls));
  const walmartCa = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: WALMART_AMT, categoryLabel: 'Shopping',
    displayedPayee: 'WALMARTCA', originalMerchant: 'WALMARTCA',
    accountRole: 'household-cash',
  }, plan);
  ok(walmartCa.kind === 'spend' && walmartCa.categoryId === 'groceries'
      && walmartCa.needsConfirmation !== true,
    'WALMARTCA with Shopping label classifies as Groceries');
  const packet = actualsPacket([tx, otherTx()]);
  const advice = recommend(packet);
  const active = period(advice.defaultView, 'this-pay-period');
  const groceries = budgetRow(active, 'groceries');
  const other = otherRow(active);
  ok(groceries && (groceries.recon || []).some(row => row.id === 'tx-walmart')
      && near(groceries.spent, WALMART_AMT),
    'Walmart enters Groceries recon');
  ok(other && !(other.recon || []).some(row => row.id === 'tx-walmart')
      && near(other.spent, OTHER_AMT),
    'Walmart does not enter Other spending');
}

console.log('\n=== 4. Meridian Farm is Groceries, not Dog food, not confirmation ===');
{
  const plan = syntheticPlan();
  const tx = meridianTx();
  const cls = F.classifyCurrentPeriodTransaction(tx, plan);
  ok(cls.kind === 'spend' && cls.categoryId === 'groceries'
      && cls.needsConfirmation !== true,
    'Meridian Farm classifies as Groceries without needsConfirmation',
    JSON.stringify(cls));
  ok(cls.categoryId !== 'pets' && cls.atlasRow === 'groceries',
    'Meridian Farm is not Dog food');
  const petsLabel = F.classifyCurrentPeriodTransaction(Object.assign({}, tx, {
    categoryLabel: 'Pets',
  }), plan);
  ok(petsLabel.categoryId === 'groceries' && petsLabel.needsConfirmation !== true,
    'Meridian Farm labelled Pets is still Groceries, not confirmation');
  const truncated = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: MERIDIAN_AMT, categoryLabel: 'Shopping',
    displayedPayee: 'MERIDIANFARM', originalMerchant: 'MERIDIANFARM',
    accountRole: 'household-cash',
  }, plan);
  ok(truncated.kind === 'spend' && truncated.categoryId === 'groceries'
      && truncated.needsConfirmation !== true && truncated.atlasRow === 'groceries',
    'truncated MERIDIANFARM is Groceries, not confirmation');
  const packet = actualsPacket([tx, otherTx()]);
  const advice = recommend(packet);
  const active = period(advice.defaultView, 'this-pay-period');
  const groceries = budgetRow(active, 'groceries');
  const pets = budgetRow(active, 'pets');
  const other = otherRow(active);
  ok(groceries && (groceries.recon || []).some(row => row.id === 'tx-meridian')
      && near(groceries.spent, MERIDIAN_AMT),
    'Meridian Farm enters Groceries recon');
  ok(other && !(other.recon || []).some(row => row.id === 'tx-meridian'),
    'Meridian Farm does not enter Other spending');
  ok(pets && !(pets.recon || []).some(row => row.id === 'tx-meridian')
      && near(pets.spent, 0),
    'Meridian Farm does not enter Dog food');
}

console.log('\n=== 5. recon rows sum to Household Budget Spent; ids appear once ===');
{
  const plan = syntheticPlan();
  plan.opening.representedEvents = [{ id: 'google-storage-100gb', date: '2026-08-31' }];
  const packet = actualsPacket([
    googleTx({ representedBill: true }),
    walmartTx(),
    meridianTx(),
    otherTx(),
  ], {
    representedActuals: [{
      id: 'google-storage-100gb',
      date: '2026-08-31',
      actual: GOOGLE_AMT,
      transactionId: 'tx-google',
    }],
  });
  const advice = recommend(packet, { opening: plan.opening });
  const active = period(advice.defaultView, 'this-pay-period');
  const independentReconTotal = roundCent(((active && active.householdBudget) || [])
    .reduce((s, row) => s + reconSum(row), 0));
  ok(near(independentReconTotal, SPENT_WITHOUT_BILL)
      && near(householdSpent(active), SPENT_WITHOUT_BILL)
      && near(independentReconTotal, householdSpent(active)),
    'independent recon-row sum equals Household Budget Spent ($60.61+$7.50=$68.11)');
  const ids = reconIds(active);
  ok(ids.length === new Set(ids).size,
    'no supporting transaction id appears on two Household Budget rows');
  ok(ids.includes('tx-walmart') && ids.includes('tx-meridian') && ids.includes('tx-other')
      && !ids.includes('tx-google'),
    'grocery and residual ids appear once; Google is absent');
}

console.log('\n=== 6. removing a represented bill from Household Budget avoids a second cash effect ===');
{
  const plan = syntheticPlan();
  plan.opening.representedEvents = [{ id: 'google-storage-100gb', date: '2026-08-31' }];
  const unlinked = actualsPacket([
    googleTx({ representedBill: false }),
    walmartTx(),
    meridianTx(),
    otherTx(),
  ], {
    representedActuals: [{
      id: 'google-storage-100gb',
      date: '2026-08-31',
      actual: GOOGLE_AMT,
    }],
  });
  const linked = actualsPacket([
    googleTx({ representedBill: true }),
    walmartTx(),
    meridianTx(),
    otherTx(),
  ], {
    representedActuals: [{
      id: 'google-storage-100gb',
      date: '2026-08-31',
      actual: GOOGLE_AMT,
      transactionId: 'tx-google',
    }],
  });
  const before = recommend(unlinked, { opening: plan.opening });
  const after = recommend(linked, { opening: plan.opening });
  const beforeActive = period(before.defaultView, 'this-pay-period');
  const afterActive = period(after.defaultView, 'this-pay-period');
  const beforeSpent = householdSpent(beforeActive);
  const afterSpent = householdSpent(afterActive);
  const beforeOther = otherRow(beforeActive);
  const afterOther = otherRow(afterActive);
  ok(near(SPENT_WITH_BILL - SPENT_WITHOUT_BILL, GOOGLE_AMT),
    'independent arithmetic: $71.24 − $68.11 = $3.13');
  ok(near(beforeSpent, SPENT_WITH_BILL) && near(afterSpent, SPENT_WITHOUT_BILL)
      && near(beforeSpent - afterSpent, GOOGLE_AMT),
    'Household Budget Spent falls by the represented $3.13 once the tx is linked');
  ok(beforeOther && near(beforeOther.spent, roundCent(OTHER_AMT + GOOGLE_AMT)),
    'unlinked Google sits in Other spending');
  ok(afterOther && near(afterOther.spent, OTHER_AMT)
      && !(afterOther.recon || []).some(tx => tx.id === 'tx-google'),
    'linked Google leaves Other spending');
  const billRemainingUnlinked = 0;
  const secondHit = GOOGLE_AMT;
  const duplicateClaim = roundCent(billRemainingUnlinked + secondHit);
  const trueClaim = GOOGLE_AMT;
  ok(near(duplicateClaim, 6.26) === false && near(duplicateClaim, trueClaim)
      && near(beforeSpent - afterSpent, secondHit),
    'bill remaining is already $0 when represented; counting the same $3.13 in Household Budget is a second cash effect');
  const groceryBefore = budgetRow(beforeActive, 'groceries');
  const groceryAfter = budgetRow(afterActive, 'groceries');
  ok(groceryBefore && groceryAfter
      && near(groceryBefore.spent, GROCERY_INDEPENDENT)
      && near(groceryAfter.spent, GROCERY_INDEPENDENT)
      && near(groceryBefore.remaining, groceryAfter.remaining),
    'Groceries Spent/Remaining are unchanged by the Google bill linkage');
}

console.log('\n=== 7. provider identity uniquely links Google storage; amount is not identity ===');
{
  const identity = load('docs/connectivity/transaction-identity.json');
  const map = load('docs/connectivity/fixtures/provider-account-map.json');
  const data = load('data.json');
  const rule = (identity.rules || []).find(r => r && r.eventId === 'google-storage-100gb');
  ok(rule && rule.atlasAccountId === 'chequing-a' && rule.direction === 'debit'
      && (rule.payeePatterns || []).includes('Google')
      && !rule.settlesWhen,
    'Google storage identity is payee + BILLS + debit + date; amount is not identity');
  const payload = {
    provider: 'lunchmoney',
    fetchedAt: '2026-09-01T18:00:00.000Z',
    transactionWindow: {
      startDate: '2026-08-18', endDate: '2026-09-01',
      complete: true, hasMore: false, truncated: false,
    },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    accounts: [{
      id: 1001, name: 'Fixture Chequing A', type: 'cash', balance: 1000,
      updated_at: '2026-09-01T17:55:00.000Z',
    }],
    categories: [
      { id: 11, name: 'Shopping', is_income: false, exclude_from_totals: false },
      { id: 22, name: 'Groceries', is_income: false, exclude_from_totals: false },
    ],
    transactions: [
      {
        id: 3101, account_id: 1001, date: '2026-08-31', amount: GOOGLE_AMT,
        is_pending: false, payee: 'Google', category_id: 11,
      },
      {
        id: 3102, account_id: 1001, date: '2026-08-31', amount: GOOGLE_AMT,
        is_pending: false, payee: 'UNRELATED DEBIT', category_id: 11,
      },
    ],
  };
  const report = O.observe({
    provider: 'lunchmoney', payload, accountMap: map, data, identity,
  });
  const candidates = report.representedEventCandidates || [];
  const googleHit = candidates.find(c => c.id === 'google-storage-100gb' && c.date === '2026-08-31');
  ok(googleHit && googleHit.amountNotUsed === true && googleHit.direction === 'debit'
      && googleHit.providerTransactionId != null,
    'unique Google payee on Chequing A settles the Aug 31 occurrence',
    JSON.stringify(candidates));
  const packet = report.currentPeriodActuals;
  ok(packet && O.currentPeriodActualsLooksSanitized(packet),
    'current-period packet remains sanitized');
  const billRow = (packet.representedActuals || []).find(r => r.id === 'google-storage-100gb');
  ok(billRow && billRow.transactionId,
    'representedActuals carries the unique local transactionId');
  const billTx = (packet.transactions || []).find(tx => tx && tx.id === billRow.transactionId);
  const decoyTx = (packet.transactions || []).find(tx => tx && tx.id !== (billRow && billRow.transactionId)
    && Number(tx.amount) === GOOGLE_AMT);
  ok(billTx && billTx.representedBill === true,
    'only the unique identity hit is flagged representedBill');
  ok(decoyTx && decoyTx.representedBill !== true,
    'same-date same-amount decoy is not flagged representedBill');
  const billCls = F.classifyCurrentPeriodTransaction(billTx, data.plan, {
    currentPeriodActuals: packet,
  });
  const decoyCls = F.classifyCurrentPeriodTransaction(decoyTx, data.plan, {
    currentPeriodActuals: packet,
  });
  ok(billCls.kind === 'bill' && billCls.householdSpending === false,
    'observe-linked Google tx classifies as bill');
  ok(decoyCls.kind !== 'bill' || decoyCls.reason !== 'represented-bill',
    'decoy does not inherit bill classification from date+amount');

  const amountOnly = JSON.parse(JSON.stringify(payload));
  amountOnly.transactions = [{
    id: 3103, account_id: 1001, date: '2026-08-31', amount: GOOGLE_AMT,
    is_pending: false, payee: 'UNKNOWN DEBIT',
  }];
  const rejected = O.observe({
    provider: 'lunchmoney', payload: amountOnly, accountMap: map, data, identity,
  });
  ok(!(rejected.representedEventCandidates || []).some(c => c.id === 'google-storage-100gb'),
    'date + $3.13 without the Google payee does not settle the bill');
}

console.log('\n=== 8. Iron Butcher and Surrey Meat policy is unchanged ===');
{
  const plan = syntheticPlan();
  const iron = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: 10, categoryLabel: 'Groceries',
    originalMerchant: 'Iron Butcher', displayedPayee: 'Iron Butcher',
  }, plan);
  ok(iron.needsConfirmation === true && iron.categoryId !== 'groceries'
      && iron.categoryId !== 'pets',
    'Iron Butcher remains unconfirmed, not Groceries, not Dog food');
  const surrey = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: 12, categoryLabel: 'Groceries',
    originalMerchant: 'SURREY MEAT PKR _F', displayedPayee: 'SURREY MEAT PKR _F',
  }, plan);
  ok(surrey.kind === 'spend' && surrey.categoryId === 'pets',
    'Surrey Meat remains Dog food, never Groceries');
}

console.log('\n=== 9. excluded Business Walmart / Meridian Farm stay out of Household Budget ===');
{
  ok(near(BUSINESS_WALMART_AMT + BUSINESS_MERIDIAN_AMT, EXCLUDED_BUSINESS_INDEPENDENT)
      && near(EXCLUDED_BUSINESS_INDEPENDENT, 36.18)
      && near(SPENT_WITHOUT_BILL + EXCLUDED_BUSINESS_INDEPENDENT, 104.29),
    'independent fixture arithmetic: excluded Business $22.11+$14.07=$36.18; leak would make Spent $104.29');
  const plan = syntheticPlan();
  ok((plan.budget.excluded || []).some(row => row && row.from === 'Business'),
    'synthetic plan carries the incumbent excluded Business category');
  const businessWalmart = walmartTx({
    id: 'tx-walmart-business',
    amount: BUSINESS_WALMART_AMT,
    categoryLabel: 'Business',
  });
  const businessMeridian = meridianTx({
    id: 'tx-meridian-business',
    amount: BUSINESS_MERIDIAN_AMT,
    categoryLabel: 'Business',
  });
  const householdWalmart = walmartTx();
  const householdMeridian = meridianTx();
  const walmartCls = F.classifyCurrentPeriodTransaction(businessWalmart, plan);
  const meridianCls = F.classifyCurrentPeriodTransaction(businessMeridian, plan);
  ok(walmartCls.kind === 'business' && walmartCls.householdSpending === false
      && walmartCls.reason === 'excluded' && walmartCls.categoryId !== 'groceries',
    'Business-category Walmart remains kind business, householdSpending false',
    JSON.stringify(walmartCls));
  ok(meridianCls.kind === 'business' && meridianCls.householdSpending === false
      && meridianCls.reason === 'excluded' && meridianCls.categoryId !== 'groceries',
    'Business-category Meridian Farm remains kind business, householdSpending false',
    JSON.stringify(meridianCls));
  const walmartCaBiz = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: BUSINESS_WALMART_AMT, categoryLabel: 'Business',
    displayedPayee: 'WALMARTCA', originalMerchant: 'WALMARTCA',
    accountRole: 'household-cash',
  }, plan);
  ok(walmartCaBiz.kind === 'business' && walmartCaBiz.householdSpending === false,
    'Business-category WALMARTCA remains excluded non-household');
  const eligibleWalmart = F.classifyCurrentPeriodTransaction(householdWalmart, plan);
  const eligibleMeridian = F.classifyCurrentPeriodTransaction(householdMeridian, plan);
  ok(eligibleWalmart.kind === 'spend' && eligibleWalmart.categoryId === 'groceries'
      && eligibleWalmart.householdSpending === true && eligibleWalmart.needsConfirmation !== true,
    'eligible household Walmart still classifies as Groceries',
    JSON.stringify(eligibleWalmart));
  ok(eligibleMeridian.kind === 'spend' && eligibleMeridian.categoryId === 'groceries'
      && eligibleMeridian.householdSpending === true && eligibleMeridian.needsConfirmation !== true,
    'eligible household Meridian Farm still classifies as Groceries',
    JSON.stringify(eligibleMeridian));
  const packet = actualsPacket([
    businessWalmart,
    businessMeridian,
    householdWalmart,
    householdMeridian,
    otherTx(),
  ]);
  const advice = recommend(packet);
  const active = period(advice.defaultView, 'this-pay-period');
  const groceries = budgetRow(active, 'groceries');
  const other = otherRow(active);
  const ids = reconIds(active);
  ok(groceries && near(groceries.spent, GROCERY_INDEPENDENT)
      && near(reconSum(groceries), GROCERY_INDEPENDENT)
      && (groceries.recon || []).some(row => row && row.id === 'tx-walmart')
      && (groceries.recon || []).some(row => row && row.id === 'tx-meridian'),
    'eligible household Walmart and Meridian Farm still enter Groceries recon');
  ok(!ids.includes('tx-walmart-business') && !ids.includes('tx-meridian-business'),
    'Business Walmart and Business Meridian Farm appear in no Household Budget recon row');
  ok(!(groceries.recon || []).some(row => row && (row.id === 'tx-walmart-business' || row.id === 'tx-meridian-business'))
      && !(other && (other.recon || []).some(row => row && (row.id === 'tx-walmart-business' || row.id === 'tx-meridian-business'))),
    'Business grocery merchants are in neither Groceries nor Other spending');
  ok(near(householdSpent(active), SPENT_WITHOUT_BILL)
      && !near(householdSpent(active), roundCent(SPENT_WITHOUT_BILL + EXCLUDED_BUSINESS_INDEPENDENT)),
    'Household Budget Spent stays $68.11; excluded $36.18 does not leak into spent');
}

console.log('\n=== 10. Natural Gas / Other bank fees are bills; Amazon/Prime fail closed ===');
{
  const forecastSrc = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public/forecast.js'), 'utf8'));
  const billSetStart = forecastSrc.indexOf('const BILL_CATEGORY_LABELS = new Set([');
  const billSetEnd = forecastSrc.indexOf(']);', billSetStart);
  const billSet = forecastSrc.slice(billSetStart, billSetEnd + 3);
  ok(/'natural gas'/.test(billSet) && /'other bank fees'/.test(billSet),
    'BILL_CATEGORY_LABELS source includes Natural Gas and Other bank fees');
  ok(!/'interest charge'/.test(billSet) && !/'overdraft fees'/.test(billSet)
      && !/'google pets'/.test(billSet),
    'BILL_CATEGORY_LABELS source does not add Interest charge / Overdraft fees / Google Pets');
  ok(!/isAmazonPrimeMerchant|isAmazonMerchant|amazon-prime-bill|amazon-owner-card/.test(forecastSrc),
    'Forecast source does not infer Amanda or bill status from Amazon merchant + card');
  ok(!/skipPendingPostedDuplicate|spendIdentityKey/.test(forecastSrc),
    'Forecast source does not collapse pending+posted by date/account/amount/merchant');

  const PRIME_AMT = 9.99;
  const SHOPIFY_AMT = 54.88;
  const AMAZON_WITHOUT_OWNER = roundCent(AMAZON_AMT + AMAZON_AMT + PRIME_AMT);
  const DISTINCT_SAME_DAY = roundCent(SHOPIFY_AMT + SHOPIFY_AMT);
  ok(near(NATURAL_GAS_AMT + BANK_FEE_AMT, 29.5)
      && near(AMAZON_WITHOUT_OWNER + OTHER_AMT, 45.49)
      && near(DISTINCT_SAME_DAY + OTHER_AMT, 117.26),
    'independent fixture arithmetic: bills $29.50; Amazon/Prime+Other $45.49; two Shopify $54.88+$54.88+$7.50=$117.26');

  const plan = syntheticPlan();
  const gas = naturalGasTx();
  const fee = bankFeeTx();
  const gasCls = F.classifyCurrentPeriodTransaction(gas, plan);
  const feeCls = F.classifyCurrentPeriodTransaction(fee, plan);
  ok(gasCls.kind === 'bill' && gasCls.householdSpending === false
      && gasCls.reason === 'bill-label' && gasCls.needsConfirmation !== true,
    'Natural Gas classifies as bill, not household spending',
    JSON.stringify(gasCls));
  ok(feeCls.kind === 'bill' && feeCls.householdSpending === false
      && feeCls.reason === 'bill-label' && feeCls.needsConfirmation !== true,
    'Other bank fees classifies as bill, not Other spending',
    JSON.stringify(feeCls));

  function failClosedAmazon(cls, flags, label) {
    ok(cls.kind !== 'bill' && cls.reason === 'personal-unassigned'
        && cls.needsConfirmation === true && cls.householdSpending === true
        && cls.categoryId !== 'amanda-guilt-free' && cls.categoryId !== 'dale-guilt-free'
        && flags.personalOwner == null,
      label,
      JSON.stringify({ cls, personalOwner: flags.personalOwner }));
  }

  const amazonTravel = amazonTx({ atlasAccountId: 'travelvisa', account: 'TRAVEL VISA' });
  const amazonMbna = amazonTx({
    id: 'tx-amazon-mbna',
    atlasAccountId: 'mbna', account: 'mana',
  });
  const amazonTriangle = amazonTx({
    id: 'tx-amazon-triangle',
    displayedPayee: 'AMZN Mktp CA', originalMerchant: 'AMZN Mktp CA',
    atlasAccountId: 'triangle', account: 'TRIANGLE MASTERCARD',
  });
  const primeTravel = amazonPrimeTx({ atlasAccountId: 'travelvisa', account: 'TRAVEL VISA' });
  const primeMbna = amazonPrimeTx({
    id: 'tx-prime-video',
    displayedPayee: 'Amazon Prime Video', originalMerchant: 'Amazon Prime Video',
    atlasAccountId: 'mbna', account: 'mana',
  });
  const amazonWithAmanda = amazonTx({
    id: 'tx-amazon-amanda-note',
    atlasAccountId: 'travelvisa', account: 'TRAVEL VISA',
    note: 'Amanda',
  });
  const mbnaPayment = {
    id: 'tx-mbna-payment', date: '2026-08-31', amount: 300,
    pending: false, categoryLabel: 'Credit Card Payment',
    accountRole: 'household-cash', atlasAccountId: 'chequing-a',
    displayedPayee: 'MBNA', originalMerchant: 'MBNA', payee: 'MBNA',
    excludeFromTotals: true, kindHint: 'card-payment',
  };

  const travelCls = F.classifyCurrentPeriodTransaction(amazonTravel, plan);
  const mbnaCls = F.classifyCurrentPeriodTransaction(amazonMbna, plan);
  const triangleCls = F.classifyCurrentPeriodTransaction(amazonTriangle, plan);
  const primeTravelCls = F.classifyCurrentPeriodTransaction(primeTravel, plan);
  const primeMbnaCls = F.classifyCurrentPeriodTransaction(primeMbna, plan);
  const amandaNoteCls = F.classifyCurrentPeriodTransaction(amazonWithAmanda, plan);
  const mbnaPayCls = F.classifyCurrentPeriodTransaction(mbnaPayment, plan);
  const travelFlags = F.classifyCurrentPeriodTransaction.derivedFlags(amazonTravel);
  const mbnaFlags = F.classifyCurrentPeriodTransaction.derivedFlags(amazonMbna);
  const triangleFlags = F.classifyCurrentPeriodTransaction.derivedFlags(amazonTriangle);
  const primeTravelFlags = F.classifyCurrentPeriodTransaction.derivedFlags(primeTravel);
  const primeMbnaFlags = F.classifyCurrentPeriodTransaction.derivedFlags(primeMbna);
  const amandaNoteFlags = F.classifyCurrentPeriodTransaction.derivedFlags(amazonWithAmanda);

  failClosedAmazon(travelCls, travelFlags,
    'Amazon shopping on Travel Visa without owner evidence stays personal-unassigned');
  failClosedAmazon(mbnaCls, mbnaFlags,
    'Amazon shopping on MBNA without owner evidence stays personal-unassigned');
  failClosedAmazon(triangleCls, triangleFlags,
    'AMZN shopping on Triangle without owner evidence stays personal-unassigned');
  failClosedAmazon(primeTravelCls, primeTravelFlags,
    'Amazon Prime merchant string is not a bill and stays personal-unassigned');
  failClosedAmazon(primeMbnaCls, primeMbnaFlags,
    'Amazon Prime Video merchant string is not a bill and stays personal-unassigned');
  ok(amandaNoteCls.kind === 'spend' && amandaNoteCls.categoryId === 'amanda-guilt-free'
      && amandaNoteCls.includeReason === 'owner-evidence-amanda'
      && amandaNoteFlags.personalOwner === 'amanda',
    'explicit Amanda note still maps via incumbent owner evidence',
    JSON.stringify(amandaNoteCls));
  ok(mbnaPayCls.kind === 'card-payment',
    'MBNA payment is card-payment, not Amazon spend',
    JSON.stringify(mbnaPayCls));

  const interestCls = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: 5, categoryLabel: 'Interest charge',
    displayedPayee: 'INTEREST CHARGE', originalMerchant: 'INTEREST CHARGE',
    atlasAccountId: 'chequing-b', accountRole: 'household-cash',
  }, plan);
  const overdraftCls = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: 5, categoryLabel: 'Overdraft fees',
    displayedPayee: 'OVERDRAFT FEE', originalMerchant: 'OVERDRAFT FEE',
    atlasAccountId: 'chequing-b', accountRole: 'household-cash',
  }, plan);
  const googlePetsCls = F.classifyCurrentPeriodTransaction({
    date: '2026-08-31', amount: 3.13, categoryLabel: 'Pets',
    displayedPayee: 'Google', originalMerchant: 'Google',
    atlasAccountId: 'chequing-a', accountRole: 'household-cash',
  }, plan);
  ok(interestCls.kind !== 'bill' && interestCls.reason === 'unmapped-label'
      && interestCls.householdSpending === true,
    'Interest charge remains unmapped-label, not a bill');
  ok(overdraftCls.kind !== 'bill' && overdraftCls.reason === 'unmapped-label'
      && overdraftCls.householdSpending === true,
    'Overdraft fees remains unmapped-label, not a bill');
  ok(googlePetsCls.kind !== 'bill' && googlePetsCls.reason === 'pets-not-dog-food'
      && googlePetsCls.householdSpending === true,
    'Google Pets remains pets-not-dog-food, not a bill');

  const billPacket = actualsPacket([gas, fee, otherTx()]);
  const billAdvice = recommend(billPacket);
  const billPeriod = period(billAdvice.defaultView, 'this-pay-period');
  const billOther = otherRow(billPeriod);
  const billIds = reconIds(billPeriod);
  const household = budgetRow(billPeriod, 'household');
  ok(billOther && near(billOther.spent, OTHER_AMT) && near(reconSum(billOther), OTHER_AMT)
      && !(billOther.recon || []).some(row => row && (row.id === 'tx-natural-gas' || row.id === 'tx-bank-fee')),
    'Natural Gas and Other bank fees do not enter Other spending');
  ok(!billIds.includes('tx-natural-gas') && !billIds.includes('tx-bank-fee'),
    'bill-label txs appear in no Household Budget recon row');
  ok(!(household && (household.recon || []).some(row => row && row.id === 'tx-natural-gas')),
    'Natural Gas does not enter Household spend');
  ok(near(householdSpent(billPeriod), OTHER_AMT)
      && !near(householdSpent(billPeriod), roundCent(OTHER_AMT + NATURAL_GAS_AMT + BANK_FEE_AMT)),
    'Household Budget Spent stays the $7.50 residual; $29.50 of bills does not leak');

  const amazonPacket = actualsPacket([
    amazonTravel, amazonMbna, primeTravel, otherTx(),
  ]);
  const amazonAdvice = recommend(amazonPacket);
  const amazonPeriod = period(amazonAdvice.defaultView, 'this-pay-period');
  const amanda = budgetRow(amazonPeriod, 'amanda-guilt-free');
  const amazonOther = otherRow(amazonPeriod);
  const amazonIds = reconIds(amazonPeriod);
  const otherAmazonIds = ((amazonOther && amazonOther.recon) || [])
    .filter(row => row && row.id)
    .map(row => row.id);
  ok(!(amanda && (amanda.recon || []).some(row => row && (
    row.id === 'tx-amazon' || row.id === 'tx-amazon-mbna' || row.id === 'tx-amazon-prime'
  ))),
    'Amazon/Prime without owner evidence do not enter Amanda guilt-free recon');
  ok(amazonOther && otherAmazonIds.includes('tx-amazon')
      && otherAmazonIds.includes('tx-amazon-mbna')
      && otherAmazonIds.includes('tx-amazon-prime')
      && otherAmazonIds.includes('tx-other')
      && near(amazonOther.spent, roundCent(AMAZON_WITHOUT_OWNER + OTHER_AMT))
      && near(reconSum(amazonOther), roundCent(AMAZON_WITHOUT_OWNER + OTHER_AMT)),
    'Amazon/Prime without owner evidence remain in Other spending with the $7.50 residual');
  ok(amazonIds.includes('tx-amazon') && amazonIds.includes('tx-amazon-prime'),
    'fail-closed Amazon/Prime still appear in Household Budget Other recon');

  const shopifyPending = {
    id: 'tx-shopify-pending', date: '2026-08-31', amount: SHOPIFY_AMT,
    pending: true, pendingTreatment: 'unresolved', categoryLabel: null,
    accountRole: 'revolving-credit', atlasAccountId: 'travelvisa', account: 'travelvisa',
    displayedPayee: 'SHOPIFY INC/578523914', originalMerchant: 'SHOPIFY INC/578523914',
  };
  const shopifyPosted = {
    id: 'tx-shopify-posted', date: '2026-08-31', amount: SHOPIFY_AMT,
    pending: false, pendingTreatment: 'confirmed-settled', categoryLabel: null,
    accountRole: 'revolving-credit', atlasAccountId: 'travelvisa', account: 'travelvisa',
    displayedPayee: 'SHOPIFY INC/578523914', originalMerchant: 'SHOPIFY INC/578523914',
  };
  const distinctPacket = actualsPacket([shopifyPending, shopifyPosted, otherTx()]);
  const distinctAdvice = recommend(distinctPacket);
  const distinctPeriod = period(distinctAdvice.defaultView, 'this-pay-period');
  const distinctOther = otherRow(distinctPeriod);
  const distinctIds = ((distinctOther && distinctOther.recon) || [])
    .filter(row => row && row.id).map(row => row.id);
  ok(distinctOther && distinctIds.includes('tx-shopify-pending')
      && distinctIds.includes('tx-shopify-posted') && distinctIds.includes('tx-other')
      && near(distinctOther.spent, roundCent(DISTINCT_SAME_DAY + OTHER_AMT))
      && near(reconSum(distinctOther), roundCent(DISTINCT_SAME_DAY + OTHER_AMT)),
    'two distinct same-day same-account same-merchant same-amount purchases, one pending and one posted, both remain counted');

  const map = {
    schema: 'atlas-provider-account-map/v1',
    mappings: [
      {
        providerAccountId: '3006',
        canonical: { collection: 'debts', id: 'travelvisa' },
        atlasRole: 'revolving-credit',
      },
      {
        providerAccountId: '3007',
        canonical: { collection: 'debts', id: 'mbna' },
        atlasRole: 'revolving-credit',
      },
      {
        providerAccountId: '1001',
        canonical: { collection: 'cash', id: 'chequing-a' },
        atlasRole: 'household-cash',
      },
    ],
  };
  const published = O.sanitizedCurrentPeriodActuals({
    fetchedAt: '2026-09-02T18:13:00.000Z',
    transactionWindow: { startDate: '2026-08-28', endDate: '2026-09-02', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    tags: [{ id: 77, name: 'Amanda' }],
    collapsedTransactions: [
      {
        date: '2026-09-01', amount: 19.14, pending: true, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon',
        providerAccountId: '3006', providerTransactionId: '126',
      },
      {
        date: '2026-08-31', amount: 33.59, pending: true, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon', notes: null,
        tags: [{ name: 'Amanda' }],
        providerAccountId: '3006', providerTransactionId: '125',
      },
      {
        date: '2026-08-31', amount: 29.10, pending: true, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon',
        tag_ids: [77],
        providerAccountId: '3006', providerTransactionId: 'tag-ids-amzn',
      },
      {
        date: '2026-08-31', amount: PRIME_AMT, pending: false, categoryLabel: 'Shopping',
        payee: 'Amazon Prime', originalName: 'Amazon Prime',
        providerAccountId: '3006', providerTransactionId: 'prime-1',
      },
      {
        date: '2026-08-31', amount: AMAZON_AMT, pending: false, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon',
        providerAccountId: '3007', providerTransactionId: 'mbna-amzn',
      },
      {
        date: '2026-08-31', amount: 300, pending: false, categoryLabel: 'Credit Card Payment',
        payee: 'MBNA', originalName: 'MBNA', excludeFromTotals: true,
        providerAccountId: '1001', providerTransactionId: 'mbna-pmt',
      },
    ],
    representedEventCandidates: [],
  }, { asOf: AS_OF, plan, accountMap: map });
  const pubBlob = JSON.stringify(published);
  ok(O.currentPeriodActualsLooksSanitized(published)
      && !/"payee"\s*:/.test(pubBlob) && !/"notes"\s*:/.test(pubBlob)
      && !/"tags"\s*:/.test(pubBlob) && !/"tag_ids"\s*:/.test(pubBlob)
      && !/"providerTransactionId"\s*:/.test(pubBlob)
      && !/"externalId"\s*:/.test(pubBlob),
    'overlay packet keeps no raw payee, notes, tags, or provider ids');
  const byAmt = amt => (published.transactions || []).find(tx => tx && near(tx.amount, amt));
  const strippedTravel = byAmt(19.14);
  const taggedTravel = byAmt(33.59);
  const taggedViaIds = byAmt(29.10);
  const publishedPrime = byAmt(PRIME_AMT);
  const publishedMbna = byAmt(AMAZON_AMT);
  const publishedMbnaPay = byAmt(300);
  ok(strippedTravel && strippedTravel.personalOwner == null
      && strippedTravel.atlasAccountId === 'travelvisa'
      && !Object.prototype.hasOwnProperty.call(strippedTravel, 'tags')
      && !Object.prototype.hasOwnProperty.call(strippedTravel, 'notes')
      && !Object.prototype.hasOwnProperty.call(strippedTravel, 'payee'),
    'Travel Visa Amazon without LM owner evidence does not stamp personalOwner');
  ok(taggedTravel && taggedTravel.personalOwner === 'amanda'
      && !Object.prototype.hasOwnProperty.call(taggedTravel, 'tags'),
    'LM Amanda tag is stamped onto personalOwner before tags are stripped');
  ok(taggedViaIds && taggedViaIds.personalOwner === 'amanda'
      && !Object.prototype.hasOwnProperty.call(taggedViaIds, 'tags')
      && !Object.prototype.hasOwnProperty.call(taggedViaIds, 'tag_ids'),
    'v2 tag_ids resolve to Amanda and stamp personalOwner before strip');
  const taggedCls = F.classifyCurrentPeriodTransaction({
    id: taggedTravel.id, date: taggedTravel.date, amount: taggedTravel.amount,
    pending: true, categoryLabel: 'Shopping', accountRole: 'revolving-credit',
    atlasAccountId: 'travelvisa', personalOwner: taggedTravel.personalOwner,
  }, plan);
  ok(taggedCls.kind === 'spend' && taggedCls.categoryId === 'amanda-guilt-free'
      && taggedCls.includeReason === 'owner-evidence-amanda',
    'explicit Amanda tag that survived strip still classifies amanda-guilt-free',
    JSON.stringify(taggedCls));
  const strippedCls = F.classifyCurrentPeriodTransaction({
    id: strippedTravel.id, date: strippedTravel.date, amount: strippedTravel.amount,
    pending: true, categoryLabel: 'Shopping', accountRole: 'revolving-credit',
    atlasAccountId: 'travelvisa', personalOwner: strippedTravel.personalOwner,
  }, plan);
  ok(strippedCls.reason === 'personal-unassigned' && strippedCls.categoryId !== 'amanda-guilt-free',
    'Travel Visa Amazon with no surviving owner evidence stays personal-unassigned',
    JSON.stringify(strippedCls));
  ok(publishedPrime && publishedPrime.personalOwner == null
      && publishedPrime.subscriptionBill !== true && publishedPrime.kind !== 'bill',
    'Prime does not publish a derived bill flag from the merchant string');
  const primeStrippedCls = F.classifyCurrentPeriodTransaction({
    id: publishedPrime.id, date: publishedPrime.date, amount: publishedPrime.amount,
    pending: false, categoryLabel: 'Shopping', accountRole: 'revolving-credit',
    atlasAccountId: 'travelvisa', personalOwner: publishedPrime.personalOwner,
  }, plan);
  ok(primeStrippedCls.kind !== 'bill' && primeStrippedCls.reason === 'personal-unassigned'
      && primeStrippedCls.categoryId !== 'amanda-guilt-free',
    'Prime stays personal-unassigned after merchant/tags are stripped',
    JSON.stringify(primeStrippedCls));
  ok(publishedMbna && publishedMbna.personalOwner == null
      && F.classifyCurrentPeriodTransaction(publishedMbna, plan).reason === 'personal-unassigned',
    'MBNA Amazon without owner evidence does not stamp Amanda after overlay sanitizer');
  ok(publishedMbnaPay && publishedMbnaPay.kindHint === 'card-payment'
      && publishedMbnaPay.personalOwner == null
      && F.classifyCurrentPeriodTransaction(publishedMbnaPay, plan).kind === 'card-payment',
    'MBNA payment is card-payment after overlay strip',
    JSON.stringify(publishedMbnaPay));

  const shopifyOverlay = O.sanitizedCurrentPeriodActuals({
    fetchedAt: '2026-09-02T18:13:00.000Z',
    transactionWindow: { startDate: '2026-08-28', endDate: '2026-09-02', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    collapsedTransactions: [
      {
        date: '2026-08-31', amount: SHOPIFY_AMT, pending: true, categoryLabel: 'Shopping',
        payee: 'SHOPIFY INC/578523914', originalName: 'SHOPIFY INC/578523914',
        providerAccountId: '3006', providerTransactionId: 'shop-pend',
      },
      {
        date: '2026-08-31', amount: SHOPIFY_AMT, pending: false, categoryLabel: 'Shopping',
        payee: 'SHOPIFY INC/578523914', originalName: 'SHOPIFY INC/578523914',
        providerAccountId: '3006', providerTransactionId: 'shop-post',
        pendingTransactionId: 'shop-pend',
      },
      {
        date: '2026-08-31', amount: OTHER_AMT, pending: false, categoryLabel: 'Gifts',
        payee: 'Gift Shop', originalName: 'Gift Shop',
        providerAccountId: '1001', providerTransactionId: 'gift-1',
      },
    ],
    representedEventCandidates: [],
  }, { asOf: AS_OF, plan, accountMap: map });
  const shopifyTxs = shopifyOverlay.transactions || [];
  const shopifyIds = shopifyTxs.filter(tx => near(tx.amount, SHOPIFY_AMT)).map(tx => tx.id);
  const shopifyPacket = actualsPacket(shopifyTxs);
  const shopifyAdvice = recommend(shopifyPacket);
  const shopifyPeriod = period(shopifyAdvice.defaultView, 'this-pay-period');
  const shopifyOther = otherRow(shopifyPeriod);
  ok(shopifyIds.length === 1
      && shopifyTxs.some(tx => near(tx.amount, SHOPIFY_AMT) && tx.pending === false)
      && !shopifyTxs.some(tx => near(tx.amount, SHOPIFY_AMT) && tx.pending === true)
      && shopifyOther && near(shopifyOther.spent, roundCent(SHOPIFY_AMT + OTHER_AMT))
      && near(reconSum(shopifyOther), roundCent(SHOPIFY_AMT + OTHER_AMT)),
    'pending→posted Shopify with explicit pendingTransactionId linkage counts once',
    JSON.stringify({ shopifyIds, spent: shopifyOther && shopifyOther.spent }));

  const shopifyByRef = O.sanitizedCurrentPeriodActuals({
    fetchedAt: '2026-09-02T18:13:00.000Z',
    transactionWindow: { startDate: '2026-08-28', endDate: '2026-09-02', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    collapsedTransactions: [
      {
        date: '2026-08-31', amount: SHOPIFY_AMT, pending: true, categoryLabel: 'Shopping',
        payee: 'SHOPIFY INC/578523914', originalName: 'SHOPIFY INC/578523914',
        providerAccountId: '3006', providerTransactionId: 'shop-pend-ref',
      },
      {
        date: '2026-08-31', amount: SHOPIFY_AMT, pending: false, categoryLabel: 'Shopping',
        payee: 'SHOPIFY INC/578523914', originalName: 'SHOPIFY INC/578523914',
        providerAccountId: '3006', providerTransactionId: 'shop-post-ref',
      },
    ],
    representedEventCandidates: [],
  }, { asOf: AS_OF, plan, accountMap: map });
  const refTwins = (shopifyByRef.transactions || [])
    .filter(tx => near(tx.amount, SHOPIFY_AMT));
  ok(refTwins.length === 2
      && refTwins.some(tx => tx.pending === true)
      && refTwins.some(tx => tx.pending === false),
    'Shopify original_name digits alone do not collapse pending+posted');

  const digitTwin = O.sanitizedCurrentPeriodActuals({
    fetchedAt: '2026-09-02T18:13:00.000Z',
    transactionWindow: { startDate: '2026-08-28', endDate: '2026-09-02', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    collapsedTransactions: [
      {
        date: '2026-08-31', amount: 19.14, pending: true, categoryLabel: 'Shopping',
        payee: 'STORE 57852', originalName: 'STORE 57852 DOWNTOWN',
        providerAccountId: '3006', providerTransactionId: 'digit-pend-a',
      },
      {
        date: '2026-08-31', amount: 19.14, pending: false, categoryLabel: 'Shopping',
        payee: 'STORE 57852', originalName: 'STORE 57852 DOWNTOWN',
        providerAccountId: '3006', providerTransactionId: 'digit-post-b',
      },
    ],
    representedEventCandidates: [],
  }, { asOf: AS_OF, plan, accountMap: map });
  const digitTwins = (digitTwin.transactions || []).filter(tx => near(tx.amount, 19.14));
  ok(digitTwins.length === 2
      && digitTwins.some(tx => tx.pending === true)
      && digitTwins.some(tx => tx.pending === false),
    'two same-account same-amount purchases with the same digit-bearing original_name both survive without a directed settlement link');

  const genericTwin = O.sanitizedCurrentPeriodActuals({
    fetchedAt: '2026-09-02T18:13:00.000Z',
    transactionWindow: { startDate: '2026-08-28', endDate: '2026-09-02', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    collapsedTransactions: [
      {
        date: '2026-08-31', amount: 19.14, pending: true, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon',
        providerAccountId: '3006', providerTransactionId: 'amz-pend',
      },
      {
        date: '2026-08-31', amount: 19.14, pending: false, categoryLabel: 'Shopping',
        payee: 'Amazon', originalName: 'Amazon',
        providerAccountId: '3006', providerTransactionId: 'amz-post',
      },
    ],
    representedEventCandidates: [],
  }, { asOf: AS_OF, plan, accountMap: map });
  const genericTwins = (genericTwin.transactions || [])
    .filter(tx => near(tx.amount, 19.14));
  ok(genericTwins.length === 2,
    'date+account+amount+generic merchant alone does not collapse pending+posted');
}

if (failures) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nOK');
