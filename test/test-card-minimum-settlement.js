'use strict';

// Focused proof that Triangle and MBNA/Amazon Mastercard minima settle from
// incumbent provider identity + statement-cycle posting, without hard-coding
// those rows PAID. Synthetic cents (L-006). Fixture account ids only.

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');
const Live = require('../scripts/live-plan.js');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.json');
const IDENTITY_PATH = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const MAP_PATH = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'b81-account-map.json');
const ACCOUNT_FACTS_PATH = path.join(ROOT, 'docs', 'ACCOUNT_FACTS.md');

const CYCLE = 'covers-statement-cycle-or-latest-due';
const DUE_ON_OR_BEFORE = 'covers-due-on-or-before-posting';
const HISTORICAL_OPENING = '2026-08-19';
const LIVE_AS_OF = '2026-09-03';
const FETCHED_AT = '2026-09-03T18:00:00.000Z';
const OBSERVED_AT = '2026-09-03T17:55:00.000Z';
const TRIANGLE_DUE = '2026-09-07';
const MBNA_AUG31 = '2026-08-31';
const TRAVEL_AUG26 = '2026-08-26';
const TRAVEL_SEP26 = '2026-09-26';
const TRIANGLE_MIN = 88.88;
const MBNA_MIN = 77.77;
const TRAVEL_MIN = 15.15;

const CHEQUING_A = 3001;
const CHEQUING_B = 3002;
const SAVINGS = 3003;
const TRAVEL_CARD = 3006;
const TRIANGLE_CARD = 3010;
const MBNA_CARD = 3011;

let failures = 0;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function near(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.005;
}

function ok(condition, label, detail) {
  if (condition) {
    console.log(`\x1b[32m✓\x1b[0m ${label}`);
    return;
  }
  failures += 1;
  console.log(`\x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}

function load(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const canonicalFileBefore = fs.readFileSync(DATA_PATH, 'utf8');
const canonical = JSON.parse(canonicalFileBefore);
const identity = load(IDENTITY_PATH);
const accountFacts = fs.readFileSync(ACCOUNT_FACTS_PATH, 'utf8');

function obligation(plan, id) {
  return ((plan && plan.obligations) || []).find(row => row && row.id === id) || null;
}

function debt(data, id) {
  return ((data.debts || []).find(row => row && row.id === id)) || null;
}

function cashValue(data, id) {
  const rows = ((data.plan && data.plan.startingCash && data.plan.startingCash.breakdown) || []);
  const row = rows.find(r => r && r.id === id);
  return row ? Number(row.value) : null;
}

function planFixture() {
  const data = clone(canonical);
  const triangle = obligation(data.plan, 'triangle');
  const mbna = obligation(data.plan, 'mbna');
  const mbnaOnce = obligation(data.plan, 'mbna-aug31');
  const travel = obligation(data.plan, 'travel');
  if (!triangle || !mbna || !mbnaOnce || !travel) {
    throw new Error('canonical Triangle/MBNA/Travel obligations missing');
  }
  triangle.amount = TRIANGLE_MIN;
  mbna.amount = MBNA_MIN;
  mbnaOnce.amount = MBNA_MIN;
  travel.amount = TRAVEL_MIN;
  return data;
}

function mapWithMbna() {
  const map = load(MAP_PATH);
  map.mappings = map.mappings.concat([{
    providerAccountId: String(MBNA_CARD),
    canonical: { collection: 'debts', id: 'mbna' },
    atlasRole: 'revolving-credit',
  }]);
  return map;
}

function completePendingCoverage() {
  return {
    complete: true,
    basis: 'is_pending-unbounded',
    hasMore: false,
    startDate: null,
    endDate: null,
  };
}

function matchingAccounts(data) {
  const accounts = [
    {
      id: CHEQUING_A, name: 'BILLS ACCOUNT', type: 'cash', subtype: 'checking',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: cashValue(data, 'chequing-a'),
      updated_at: OBSERVED_AT,
    },
    {
      id: CHEQUING_B, name: 'WEEKLY SPENDING', type: 'cash', subtype: 'checking',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: cashValue(data, 'chequing-b'),
      updated_at: OBSERVED_AT,
    },
    {
      id: SAVINGS, name: 'EMERGENCY SAVING', type: 'cash', subtype: 'savings',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: cashValue(data, 'savings'),
      updated_at: OBSERVED_AT,
    },
    {
      id: 3004, name: 'PERSONAL CREDIT CARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: debt(data, 'tdcc').balance,
      credit_limit: debt(data, 'tdcc').limit,
      updated_at: OBSERVED_AT,
    },
    {
      id: 3005, name: 'TD CASH BACK VISA* CARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: debt(data, 'cashback').balance,
      credit_limit: debt(data, 'cashback').limit,
      updated_at: OBSERVED_AT,
    },
    {
      id: TRAVEL_CARD, name: 'TRAVEL VISA', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: debt(data, 'travelvisa').balance,
      credit_limit: debt(data, 'travelvisa').limit,
      updated_at: OBSERVED_AT,
    },
    {
      id: 3007, name: 'LINE OF CREDIT - HOME EQUITY', type: 'loan', subtype: 'line_of_credit',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: debt(data, 'heloc').balance,
      updated_at: OBSERVED_AT,
    },
    {
      id: 3008, name: 'MORTGAGE', type: 'loan', subtype: 'mortgage',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: debt(data, 'mortgage').balance,
      updated_at: OBSERVED_AT,
    },
    {
      id: TRIANGLE_CARD, name: 'TRIANGLE MASTERCARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'Canadian Tire Bank', currency: 'cad',
      balance: debt(data, 'triangle').balance,
      credit_limit: debt(data, 'triangle').limit,
      updated_at: OBSERVED_AT,
    },
    {
      id: MBNA_CARD, name: 'AMAZON MBNA MASTERCARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'MBNA', currency: 'cad',
      balance: debt(data, 'mbna').balance,
      credit_limit: debt(data, 'mbna').limit,
      updated_at: OBSERVED_AT,
    },
  ];
  return accounts;
}

function tx({ id, account, date, amount, payee, original, category }) {
  return {
    id: id || Math.abs(hashId(`${account}|${date}|${amount}|${payee}`)),
    account_id: account,
    date,
    amount,
    payee,
    original_name: original || payee,
    category_name: category || null,
    is_pending: false,
    status: 'reviewed',
  };
}

function hashId(value) {
  let n = 0;
  for (let i = 0; i < value.length; i += 1) n = ((n << 5) - n + value.charCodeAt(i)) | 0;
  return 800000 + Math.abs(n % 199999);
}

function triangleChequing(date, amount) {
  return tx({
    account: CHEQUING_A,
    date,
    amount,
    payee: 'Can Tire Mc',
    original: 'CAN TIRE MC 1234',
    category: 'Credit card payment',
  });
}

function mbnaChequing(date, amount) {
  return tx({
    account: CHEQUING_A,
    date,
    amount,
    payee: 'MBNA M/C 5678',
    original: 'MBNA M/C 5678',
    category: 'Credit card payment',
  });
}

function observe(data, transactions, extra) {
  return O.observe({
    provider: 'lunchmoney',
    payload: {
      provider: 'lunchmoney',
      fetchedAt: FETCHED_AT,
      source: 'Synthetic card-minimum settlement fixture. Fixture IDs 3001–3011 are not live provider IDs.',
      pendingCoverage: completePendingCoverage(),
      accounts: matchingAccounts(data),
      transactions: transactions || [],
      transactionWindow: {
        startDate: '2026-08-01',
        endDate: LIVE_AS_OF,
        complete: true,
        hasMore: false,
        truncated: false,
      },
    },
    accountMap: (extra && extra.accountMap) || mapWithMbna(),
    data,
    identity,
  });
}

function overlay(data, transactions, extra) {
  return Live.fromObservation({
    data,
    payload: {
      provider: 'lunchmoney',
      fetchedAt: FETCHED_AT,
      source: 'Synthetic card-minimum settlement fixture. Fixture IDs 3001–3011 are not live provider IDs.',
      pendingCoverage: completePendingCoverage(),
      accounts: matchingAccounts(data),
      transactions: transactions || [],
      transactionWindow: {
        startDate: '2026-08-01',
        endDate: LIVE_AS_OF,
        complete: true,
        hasMore: false,
        truncated: false,
      },
    },
    accountMap: (extra && extra.accountMap) || mapWithMbna(),
    identity,
  });
}

function candidates(report) {
  return report && report.representedEventCandidates || [];
}

function hasCandidate(report, id, date) {
  return candidates(report).some(row => row && row.id === id && row.date === date);
}

function represented(data, id, date) {
  return ((data.plan && data.plan.opening && data.plan.opening.representedEvents) || [])
    .some(row => row && row.id === id && row.date === date);
}

function recommend(data) {
  const asOf = data.plan.opening.asOf;
  return Forecast.recommend(data.plan, asOf, {
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
    targetBuffer: data.plan.defaults && data.plan.defaults.targetBuffer,
  });
}

function billRow(data, id, date) {
  const rec = recommend(data);
  const bills = (rec.defaultView && rec.defaultView.bills) || [];
  return bills.find(row => row && row.id === id && row.date === date) || null;
}

function rulesFor(eventId) {
  return (identity.rules || []).filter(rule => rule && rule.eventId === eventId);
}

console.log('=== authority homes ===');
{
  ok(debt(canonical, 'triangle') && debt(canonical, 'triangle').statementCloseDay === 17,
    'Triangle close day lives on debts.statementCloseDay');
  ok(debt(canonical, 'mbna') && debt(canonical, 'mbna').statementCloseDay === 6,
    'MBNA close day lives on debts.statementCloseDay');
  ok(/debts\[\]\.statementCloseDay/.test(accountFacts),
    'ACCOUNT_FACTS names debts.statementCloseDay as the runtime close-day home');
  const triangle = rulesFor('triangle');
  const mbna = rulesFor('mbna');
  const mbnaOnce = rulesFor('mbna-aug31');
  ok(triangle.some(rule => rule.atlasAccountId === 'chequing-a'
      && rule.direction === 'debit'
      && rule.postingDateRule === CYCLE
      && (rule.payeePatterns || []).includes('CAN TIRE MC')),
    'Triangle settlement uses observed chequing CAN TIRE MC debit identity');
  ok(mbna.some(rule => rule.atlasAccountId === 'chequing-a'
      && rule.direction === 'debit'
      && rule.postingDateRule === CYCLE
      && (rule.payeePatterns || []).includes('MBNA M/C')),
    'MBNA settlement uses observed chequing MBNA M/C debit identity');
  ok(mbnaOnce.some(rule => rule.atlasAccountId === 'chequing-a'
      && rule.direction === 'debit'
      && rule.postingDateRule === CYCLE),
    'mbna-aug31 uses the same observed chequing identity');
  ok(mbna.some(rule => rule.atlasAccountId === 'mbna'
      && rule.direction === 'credit'
      && (rule.payeePatterns || []).includes('payment')),
    'MBNA card-side identity uses the observed payee payment');
  ok(rulesFor('travel').every(rule => rule.postingDateRule === DUE_ON_OR_BEFORE),
    'Travel Visa keeps covers-due-on-or-before-posting');
  ok(rulesFor('cashback').every(rule => rule.postingDateRule === DUE_ON_OR_BEFORE),
    'Cash Back keeps covers-due-on-or-before-posting');
  ok(rulesFor('tdcc').every(rule => rule.postingDateRule === DUE_ON_OR_BEFORE),
    'TD personal keeps covers-due-on-or-before-posting');
}

console.log('\n=== prepaid helper ===');
{
  const data = planFixture();
  ok(Forecast.prepaidJointCashOutflow(data.plan, 'triangle', TRIANGLE_DUE, HISTORICAL_OPENING),
    'upcoming Triangle minimum is a prepaid joint-cash candidate');
  ok(!Forecast.prepaidJointCashOutflow(data.plan, 'triangle', '2026-09-08', HISTORICAL_OPENING),
    'a date that is not a Triangle due is not a prepaid candidate');
  ok(!Forecast.prepaidJointCashOutflow(data.plan, 'netflix', '2026-09-16', HISTORICAL_OPENING),
    'a future commitment is not a prepaid card-minimum candidate');
}

console.log('\n=== Triangle payment after statement close, before due ===');
{
  const data = planFixture();
  const report = observe(data, [triangleChequing('2026-09-02', TRIANGLE_MIN)]);
  ok(hasCandidate(report, 'triangle', TRIANGLE_DUE),
    'observer matches Triangle after 17 Aug close and before 7 Sep due');
  const hit = candidates(report).find(row => row.id === 'triangle' && row.date === TRIANGLE_DUE);
  ok(hit && hit.postingDate === '2026-09-02' && hit.postingDateRelation === CYCLE,
    'Triangle match uses statement-cycle posting, not due-on-or-before');
  const result = overlay(data, [triangleChequing('2026-09-02', TRIANGLE_MIN)]);
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'live overlay applies on freshness-qualified cash');
  ok(represented(result.data, 'triangle', TRIANGLE_DUE),
    'overlay represents the Sep 7 Triangle minimum');
  const bill = billRow(result.data, 'triangle', TRIANGLE_DUE);
  ok(bill && bill.status === 'PAID' && near(bill.remaining, 0),
    'Plan Bills row is PAID with remaining 0',
    bill && JSON.stringify({ status: bill.status, remaining: bill.remaining, settlement: bill.settlement }));
  const reserved = Forecast.expandEvents(result.data.plan, LIVE_AS_OF, '2026-09-10', {})
    .filter(event => event.id === 'triangle' && event.date === TRIANGLE_DUE);
  ok(reserved.length === 0, 'Forecast does not reserve the represented Triangle minimum again');
  const action = Forecast.currentPeriodAction(result.data.plan, LIVE_AS_OF, {});
  const actionBill = (action.bills || []).find(row => row.id === 'triangle' && row.date === TRIANGLE_DUE);
  ok(actionBill && actionBill.settlement === 'represented' && near(actionBill.remaining, 0),
    'currentPeriodAction remaining is 0 once represented');
}

console.log('\n=== Triangle payment before statement close does not settle Sep 7 ===');
{
  const data = planFixture();
  const report = observe(data, [triangleChequing('2026-08-10', 300)]);
  ok(!hasCandidate(report, 'triangle', TRIANGLE_DUE),
    'payment before 17 Aug close does not match Sep 7 Triangle');
  const result = overlay(data, [triangleChequing('2026-08-10', 300)]);
  ok(!represented(result.data, 'triangle', TRIANGLE_DUE),
    'overlay does not represent Sep 7 from a pre-statement payment');
  const bill = billRow(result.data, 'triangle', TRIANGLE_DUE);
  ok(bill && bill.status !== 'PAID' && near(bill.remaining, TRIANGLE_MIN),
    'Sep 7 Triangle remains still due after a pre-statement payment',
    bill && JSON.stringify({ status: bill.status, remaining: bill.remaining }));
}

console.log('\n=== wrong card / account does not settle Triangle ===');
{
  const data = planFixture();
  const savingsDebit = observe(data, [tx({
    account: SAVINGS,
    date: '2026-09-02',
    amount: TRIANGLE_MIN,
    payee: 'Can Tire Mc',
    original: 'CAN TIRE MC 1234',
    category: 'Credit card payment',
  })]);
  ok(!hasCandidate(savingsDebit, 'triangle', TRIANGLE_DUE),
    'CAN TIRE MC on savings does not settle Triangle');
  const triangleCardCredit = observe(data, [tx({
    account: TRIANGLE_CARD,
    date: '2026-09-02',
    amount: -TRIANGLE_MIN,
    payee: 'payment',
    original: 'payment',
  })]);
  ok(!hasCandidate(triangleCardCredit, 'triangle', TRIANGLE_DUE),
    'a mapped Triangle card credit is not an invented Triangle identity');
  const unrelatedTransfer = observe(data, [tx({
    account: CHEQUING_A,
    date: '2026-09-02',
    amount: TRIANGLE_MIN,
    payee: 'TFR-TO C/C',
    original: 'TFR-TO C/C',
    category: 'Transfer',
  })]);
  ok(!hasCandidate(unrelatedTransfer, 'triangle', TRIANGLE_DUE),
    'an unrelated TFR-TO C/C debit does not settle Triangle');
}

console.log('\n=== MBNA payment in the August statement cycle settles mbna-aug31 ===');
{
  const data = planFixture();
  const report = observe(data, [mbnaChequing('2026-09-02', MBNA_MIN)]);
  ok(hasCandidate(report, 'mbna-aug31', MBNA_AUG31),
    'MBNA payment after 6 Aug close covers the outstanding Aug 31 occurrence');
  ok(!hasCandidate(report, 'mbna', '2026-09-30'),
    'the same payment does not also consume the Sep 30 recurring minimum');
  const result = overlay(data, [mbnaChequing('2026-09-02', MBNA_MIN)]);
  ok(represented(result.data, 'mbna-aug31', MBNA_AUG31),
    'overlay represents mbna-aug31');
  const bill = billRow(result.data, 'mbna-aug31', MBNA_AUG31);
  ok(bill && bill.status === 'PAID' && near(bill.remaining, 0),
    'Aug 31 MBNA Bills row is PAID with remaining 0',
    bill && JSON.stringify({ status: bill.status, remaining: bill.remaining }));
  const reserved = Forecast.expandEvents(result.data.plan, LIVE_AS_OF, LIVE_AS_OF, {})
    .filter(event => event.id === 'mbna-aug31');
  ok(reserved.length === 0, 'Forecast does not reserve mbna-aug31 again');
}

console.log('\n=== MBNA on the wrong card does not settle ===');
{
  const data = planFixture();
  const report = observe(data, [tx({
    account: TRIANGLE_CARD,
    date: '2026-09-02',
    amount: -MBNA_MIN,
    payee: 'payment',
    original: 'payment',
  })]);
  ok(!hasCandidate(report, 'mbna', '2026-09-30')
      && !hasCandidate(report, 'mbna-aug31', MBNA_AUG31),
    'a payment credit on the Triangle card does not settle MBNA');
}

console.log('\n=== amount is coverage after identity ===');
{
  const data = planFixture();
  const report = observe(data, [triangleChequing('2026-09-02', 10)]);
  ok(!hasCandidate(report, 'triangle', TRIANGLE_DUE),
    'a $10 Triangle debit does not cover the $88.88 minimum');
}

console.log('\n=== refund / merchant credit is not a payment ===');
{
  const data = planFixture();
  const chequingCredit = observe(data, [tx({
    account: CHEQUING_A,
    date: '2026-09-02',
    amount: -TRIANGLE_MIN,
    payee: 'Can Tire Mc',
    original: 'CAN TIRE MC 1234',
  })]);
  ok(!hasCandidate(chequingCredit, 'triangle', TRIANGLE_DUE),
    'a chequing credit with CAN TIRE MC is not a Triangle payment');
  const merchantCredit = observe(data, [tx({
    account: MBNA_CARD,
    date: '2026-08-20',
    amount: 40,
    payee: 'Amazon.ca',
    original: 'Amazon.ca',
    category: 'Shopping',
  })]);
  ok(!hasCandidate(merchantCredit, 'mbna', '2026-09-30')
      && !hasCandidate(merchantCredit, 'mbna-aug31', MBNA_AUG31),
    'an MBNA merchant debit/credit is not the card-minimum payment');
  const amazonRefund = observe(data, [tx({
    account: MBNA_CARD,
    date: '2026-08-20',
    amount: -40,
    payee: 'Amazon.ca',
    original: 'Amazon.ca',
    category: 'Shopping',
  })]);
  ok(!hasCandidate(amazonRefund, 'mbna-aug31', MBNA_AUG31),
    'an Amazon refund credit is not payee payment identity');
}

console.log('\n=== observed MBNA card alias payment still settles when present ===');
{
  const data = planFixture();
  const report = observe(data, [tx({
    account: MBNA_CARD,
    date: '2026-08-20',
    amount: -MBNA_MIN,
    payee: 'payment',
    original: 'payment',
  })]);
  ok(hasCandidate(report, 'mbna-aug31', MBNA_AUG31),
    'mapped-MBNA payee "payment" after 6 Aug close covers mbna-aug31');
}

console.log('\n=== Travel Visa / Cash Back / TD posting rule unchanged ===');
{
  const data = planFixture();
  const earlyTravel = observe(data, [tx({
    account: TRAVEL_CARD,
    date: '2026-08-28',
    amount: -TRAVEL_MIN,
    payee: 'PAYMENT-THANKYOU',
    original: 'PAYMENT-THANKYOU',
  })]);
  ok(!hasCandidate(earlyTravel, 'travel', TRAVEL_SEP26),
    'Travel Visa payment on 28 Aug still cannot settle the Sep 26 minimum');
  ok(hasCandidate(earlyTravel, 'travel', TRAVEL_AUG26),
    'Travel Visa payment on 28 Aug still covers the latest due on or before posting');
  const onDueTravel = observe(data, [tx({
    account: TRAVEL_CARD,
    date: TRAVEL_AUG26,
    amount: -TRAVEL_MIN,
    payee: 'PAYMENT-THANKYOU',
    original: 'PAYMENT-THANKYOU',
  })]);
  ok(hasCandidate(onDueTravel, 'travel', TRAVEL_AUG26),
    'Travel Visa payment on the due date still settles that occurrence');
  ok(rulesFor('cashback').some(rule => (rule.payeePatterns || []).includes('PAYMENT-THANKYOU')),
    'Cash Back identity aliases are unchanged');
  ok(rulesFor('tdcc').some(rule => (rule.payeePatterns || []).includes('TFR-TO C/C')),
    'TD personal identity aliases are unchanged');
}

console.log('\n=== represented payment is not Household Budget spending ===');
{
  const classified = Forecast.classifyCurrentPeriodTransaction({
    date: '2026-09-02',
    amount: TRIANGLE_MIN,
    payee: 'Can Tire Mc',
    original_name: 'CAN TIRE MC 1234',
    displayedPayee: 'Can Tire Mc',
    originalMerchant: 'CAN TIRE MC 1234',
    category_name: 'Credit card payment',
    atlasAccountId: 'chequing-a',
  });
  ok(classified.kind === 'card-payment' && classified.householdSpending === false,
    'Triangle chequing payment is card-payment, not household spend',
    JSON.stringify(classified));
  const mbnaClassified = Forecast.classifyCurrentPeriodTransaction({
    date: '2026-09-02',
    amount: MBNA_MIN,
    payee: 'MBNA M/C 5678',
    original_name: 'MBNA M/C 5678',
    displayedPayee: 'MBNA M/C 5678',
    originalMerchant: 'MBNA M/C 5678',
    categoryLabel: 'Credit Card Payment',
    atlasAccountId: 'chequing-a',
    accountRole: 'household-cash',
  });
  ok(mbnaClassified.householdSpending === false
      && mbnaClassified.kind !== 'spend'
      && mbnaClassified.kind !== 'unclassified',
    'MBNA chequing payment is not Household Budget spending',
    JSON.stringify(mbnaClassified));
  const data = planFixture();
  const result = overlay(data, [
    triangleChequing('2026-09-02', TRIANGLE_MIN),
    mbnaChequing('2026-09-02', MBNA_MIN),
  ]);
  const actuals = result.data.liveOverlay && result.data.liveOverlay.currentPeriodActuals;
  const txs = (actuals && actuals.transactions) || [];
  ok(txs.length >= 2, 'overlay actuals include the posted Triangle and MBNA payments');
  ok(txs.every(row => {
    const cls = Forecast.classifyCurrentPeriodTransaction(row, result.data.plan, {
      packet: actuals,
      currentPeriodActuals: actuals,
    });
    return cls.householdSpending === false && cls.kind !== 'spend';
  }), 'classified overlay actuals are not Household Budget spending');
}

console.log('\n=== cash is not reserved twice; canonical is not rewritten ===');
{
  const data = planFixture();
  const without = Forecast.simulate(data.plan, HISTORICAL_OPENING, { viewDays: 30 });
  const withRep = Forecast.simulate(data.plan, HISTORICAL_OPENING, {
    viewDays: 30,
    representedEvents: [{ id: 'triangle', date: TRIANGLE_DUE }],
  });
  ok(near(withRep.ending - without.ending, TRIANGLE_MIN),
    'representing Triangle releases exactly the synthetic minimum from the cash walk',
    `${without.ending} -> ${withRep.ending}`);
  const result = overlay(data, [triangleChequing('2026-09-02', TRIANGLE_MIN)]);
  ok(JSON.stringify(result.data.plan.obligations) === JSON.stringify(data.plan.obligations),
    'overlay does not rewrite the Triangle/MBNA schedule');
  ok(fs.readFileSync(DATA_PATH, 'utf8') === canonicalFileBefore,
    'observer and overlay do not mutate data.json');
  const overlayBlob = JSON.stringify(result.data.liveOverlay || {});
  ok(O.identityProofLooksSanitized(result.data.liveOverlay)
      && !/"providerTransactionId"\s*:/.test(overlayBlob)
      && !/"lunchMoneyId"\s*:/.test(overlayBlob),
    'live overlay metadata does not leak provider transaction ids');
  const receipt = result.report && result.report.obligationReconciliationReceipt;
  ok(receipt && O.reconciliationReceiptLooksSanitized(receipt),
    'obligation reconciliation receipt stays sanitized');
}

if (failures) {
  console.log(`\nFAILED — ${failures} check(s)`);
  process.exit(1);
}
console.log('\ntest-card-minimum-settlement: all checks passed');
