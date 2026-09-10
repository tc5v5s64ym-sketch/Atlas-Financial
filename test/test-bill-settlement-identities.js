'use strict';
/* Standing bill-settlement identities: Fortis and TD fees are
 * identity-plus-evidence each cycle; YouTube Premium is schedule-trust
 * on the due date. Matching confirmed-settled txs create
 * representedActuals and mark PAID. Without matching evidence Fortis
 * and TD stay still-due / unverified. YouTube does not require an
 * isolated bank tx or Apple scrape. Synthetic observe fixtures and
 * independent arithmetic (L-002 / L-006).
 *
 * `node test/test-bill-settlement-identities.js`
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

const FORTIS_ID = 'fortis';
const FORTIS_DUE = '2026-09-03';
const FORTIS_EARLY = '2026-09-01';
const FORTIS_PLANNED = 124;
const FORTIS_OBSERVED = 123.5;
const FEE_ID = 'tdfees';
const FEE_DUE = '2026-08-30';
const FEE_LEG = 17.95;
const FEE_TOTAL = 35.9;
const YOUTUBE_ID = 'youtube-premium';
const YOUTUBE_DUE = '2026-09-02';
const YOUTUBE_BEFORE = '2026-09-01';
const YOUTUBE_PLANNED = 17;
const EARLY_RULE = 'covers-early-or-due-on-or-before-posting';
const TWO_LEG = 'two-leg-sum';
const SCHEDULE_TRUST = 'schedule-trust-on-due';

function liveData() {
  return load('data.json');
}

function identityDoc() {
  return load('docs/connectivity/transaction-identity.json');
}

function fixtureMap() {
  return load('docs/connectivity/fixtures/provider-account-map.json');
}

function identityWithout(identity, eventIds) {
  const next = JSON.parse(JSON.stringify(identity));
  const skip = new Set(eventIds);
  next.rules = (next.rules || []).filter(r => r && !skip.has(r.eventId));
  return next;
}

function payload(asOf, extraTxs) {
  return {
    provider: 'lunchmoney',
    fetchedAt: asOf + 'T18:00:00.000Z',
    transactionWindow: {
      startDate: '2026-08-19',
      endDate: asOf,
      complete: true,
      hasMore: false,
      truncated: false,
    },
    pendingCoverage: {
      complete: true,
      basis: O.PENDING_COVERAGE_BASIS,
      hasMore: false,
      truncated: false,
    },
    accounts: [
      {
        id: 1001, name: 'Fixture Chequing A', type: 'cash', balance: 1000,
        updated_at: asOf + 'T17:55:00.000Z',
      },
      {
        id: 1002, name: 'Fixture Chequing B', type: 'cash', balance: 400,
        updated_at: asOf + 'T17:55:00.000Z',
      },
    ],
    categories: [
      { id: 11, name: 'Shopping', is_income: false, exclude_from_totals: false },
    ],
    transactions: extraTxs || [],
  };
}

function observeWith(identity, asOf, txs) {
  return O.observe({
    provider: 'lunchmoney',
    payload: payload(asOf, txs),
    accountMap: fixtureMap(),
    data: liveData(),
    identity,
  });
}

function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p.id === id);
}

function recommendFromReport(report, asOf) {
  const data = liveData();
  const represented = ((report && report.representedEventCandidates) || [])
    .filter(c => c && c.id && c.date)
    .map(c => ({ id: c.id, date: c.date }));
  const plan = JSON.parse(JSON.stringify(data.plan));
  plan.opening = Object.assign({}, plan.opening, {
    asOf,
    priorAsOf: (data.plan.opening && data.plan.opening.asOf) || '2026-08-19',
    representedEvents: represented,
  });
  return F.recommend(plan, asOf, {
    debts: data.debts,
    currentPeriodActuals: report.currentPeriodActuals,
    representedEvents: represented,
    preservePaydayPeriodOrigin: true,
  });
}

function actionBill(advice, id, date) {
  return (((advice && advice.currentPeriodAction) || {}).bills || [])
    .find(b => b && b.id === id && (!date || b.date === date)) || null;
}

function calendarBill(advice, id, date) {
  const active = period(advice && advice.defaultView, 'this-pay-period');
  return ((active && active.bills) || []).find(b =>
    b && b.id === id && (!date || b.date === date)) || null;
}

function billPaid(advice, id, date) {
  const row = actionBill(advice, id, date) || calendarBill(advice, id, date);
  return !!(row && (row.settlement === 'represented' || row.status === 'PAID')
    && (row.remaining == null || near(row.remaining, 0)));
}

function billUnpaid(advice, id, date) {
  const row = actionBill(advice, id, date) || calendarBill(advice, id, date);
  if (!row) return false;
  if (row.settlement === 'represented' || row.status === 'PAID') return false;
  return row.remaining == null || Number(row.remaining) > 0;
}

function fortisTx(extra) {
  return Object.assign({
    id: 9601, account_id: 1001, date: FORTIS_EARLY, amount: FORTIS_OBSERVED,
    is_pending: false, payee: 'Fortisbc Energy Bpy', original_name: 'FortisBC Energy BPY',
  }, extra || {});
}

function feeTxA(extra) {
  return Object.assign({
    id: 9602, account_id: 1001, date: FEE_DUE, amount: FEE_LEG,
    is_pending: false, payee: 'MONTHLY ACCOUNT FEE', original_name: 'MONTHLY ACCOUNT FEE',
  }, extra || {});
}

function feeTxB(extra) {
  return Object.assign({
    id: 9603, account_id: 1002, date: FEE_DUE, amount: FEE_LEG,
    is_pending: false, payee: 'MONTHLY ACCOUNT FEE', original_name: 'MONTHLY ACCOUNT FEE',
  }, extra || {});
}

console.log('\n=== 1. standing identities are encoded ===');
{
  const identity = identityDoc();
  const fortis = (identity.rules || []).find(r => r && r.eventId === FORTIS_ID);
  ok(fortis && fortis.atlasAccountId === 'chequing-a' && fortis.direction === 'debit'
      && fortis.postingDateRule === EARLY_RULE
      && (fortis.payeePatterns || []).includes('Fortisbc Energy Bpy')
      && !fortis.settlesWhen,
    'fortis identity is payee + Chequing A + debit + early-or-covers-due; amount is not identity');
  const feeRules = (identity.rules || []).filter(r => r && r.eventId === FEE_ID);
  ok(feeRules.length === 2
      && feeRules.every(r => r.settlesWhen === TWO_LEG
        && r.direction === 'debit'
        && r.postingDateRule === 'covers-due-on-or-before-posting'
        && (r.payeePatterns || []).includes('MONTHLY ACCOUNT FEE'))
      && feeRules.some(r => r.atlasAccountId === 'chequing-a')
      && feeRules.some(r => r.atlasAccountId === 'chequing-b'),
    'tdfees identity is two MONTHLY ACCOUNT FEE debit legs on chequing-a and chequing-b');
  const youtube = (identity.rules || []).find(r => r && r.eventId === YOUTUBE_ID);
  ok(youtube && youtube.settlesWhen === SCHEDULE_TRUST
      && !youtube.payeePattern
      && !(youtube.payeePatterns || []).length
      && !youtube.atlasAccountId
      && !youtube.originalNamePattern,
    'youtube-premium is schedule-trust-on-due with no bank-payee identity');
  ok(!(identity.rules || []).some(r => r && r.eventId === YOUTUBE_ID
      && ((r.payeePatterns || []).length || r.payeePattern || r.originalNamePattern)),
    'YouTube has no invented Apple, PayPal, or Gmail payee rule');
}

console.log('\n=== 2. WITHOUT EVIDENCE Fortis and TD stay still-due; YouTube waits for due date ===');
{
  const identity = identityDoc();
  const empty = observeWith(identity, FORTIS_EARLY, []);
  ok(!(empty.representedEventCandidates || []).some(c => c && c.id === FORTIS_ID),
    'no Fortis debit does not represent fortis');
  ok(!(empty.representedEventCandidates || []).some(c => c && c.id === FEE_ID),
    'no MONTHLY ACCOUNT FEE legs do not represent tdfees');
  ok(!(empty.representedEventCandidates || []).some(c => c && c.id === YOUTUBE_ID),
    'YouTube is not schedule-trusted before the 2nd');
  const beforeAdvice = recommendFromReport(empty, FORTIS_EARLY);
  ok(billUnpaid(beforeAdvice, FORTIS_ID, FORTIS_DUE),
    'Fortis stays still-due / unverified without matching evidence');
  ok(billUnpaid(beforeAdvice, FEE_ID, FEE_DUE),
    'TD fees stay still-due / unverified without matching evidence');
  ok(billUnpaid(beforeAdvice, YOUTUBE_ID, YOUTUBE_DUE),
    'YouTube stays still-due before its due date');
}

console.log('\n=== 3. Fortis early pay before due creates representedActuals and PAID ===');
{
  const identity = identityDoc();
  const missing = observeWith(identityWithout(identity, [FORTIS_ID]), FORTIS_EARLY, [fortisTx()]);
  ok(!(missing.representedEventCandidates || []).some(c => c && c.id === FORTIS_ID),
    'without the fortis rule, Fortisbc Energy Bpy stays unmatched');
  const report = observeWith(identity, FORTIS_EARLY, [fortisTx()]);
  const hit = (report.representedEventCandidates || [])
    .find(c => c && c.id === FORTIS_ID && c.date === FORTIS_DUE);
  ok(hit && hit.postingDate === FORTIS_EARLY
      && hit.postingDateRelation === 'early-pay-before-due'
      && hit.amountNotUsed === true
      && near(hit.observedAmount, FORTIS_OBSERVED),
    'Sep 1 Fortisbc Energy Bpy debit settles the Sep 3 fortis occurrence as early pay');
  const row = ((report.currentPeriodActuals || {}).representedActuals || [])
    .find(r => r && r.id === FORTIS_ID && r.date === FORTIS_DUE);
  ok(row && row.transactionId && near(row.actual, FORTIS_OBSERVED)
      && row.postedOn === FORTIS_EARLY,
    'representedActuals carries the observed Fortis debit against fortis@Sep 3');
  const advice = recommendFromReport(report, FORTIS_EARLY);
  const bill = actionBill(advice, FORTIS_ID, FORTIS_DUE)
    || calendarBill(advice, FORTIS_ID, FORTIS_DUE);
  ok(billPaid(advice, FORTIS_ID, FORTIS_DUE)
      && bill && near(bill.planned != null ? bill.planned : bill.amount, FORTIS_PLANNED)
      && near(bill.actual != null ? bill.actual : 0, FORTIS_OBSERVED),
    'matching Fortis evidence marks PAID at the observed amount; planned $124 stays');
  const late = observeWith(identity, '2026-09-05', [fortisTx({
    id: 9611, date: '2026-09-05', amount: FORTIS_PLANNED,
  })]);
  const lateHit = (late.representedEventCandidates || [])
    .find(c => c && c.id === FORTIS_ID && c.date === FORTIS_DUE);
  ok(lateHit && lateHit.postingDate === '2026-09-05',
    'a later Fortis debit still covers the Sep 3 due');
  const wrongPayee = observeWith(identity, FORTIS_EARLY, [fortisTx({
    id: 9612, payee: 'UNKNOWN DEBIT', original_name: 'UNKNOWN DEBIT',
  })]);
  ok(!(wrongPayee.representedEventCandidates || []).some(c => c && c.id === FORTIS_ID),
    'date + amount without the Fortis alias does not settle fortis');
  const wrongAccount = observeWith(identity, FORTIS_EARLY, [fortisTx({
    id: 9613, account_id: 1002,
  })]);
  ok(!(wrongAccount.representedEventCandidates || []).some(c => c && c.id === FORTIS_ID),
    'the Fortis alias on Chequing B does not settle the BILLS ACCOUNT bill');
}

console.log('\n=== 4. TD two-leg MONTHLY ACCOUNT FEE evidence settles $35.90; one leg does not ===');
{
  ok(near(FEE_LEG + FEE_LEG, FEE_TOTAL),
    'independent arithmetic: $17.95 + $17.95 = $35.90');
  const identity = identityDoc();
  const oneLeg = observeWith(identity, FEE_DUE, [feeTxA()]);
  ok(!(oneLeg.representedEventCandidates || []).some(c => c && c.id === FEE_ID),
    'one MONTHLY ACCOUNT FEE leg does not represent tdfees');
  ok(billUnpaid(recommendFromReport(oneLeg, FEE_DUE), FEE_ID, FEE_DUE),
    'one fee leg leaves tdfees still-due / unverified');
  const sameAccount = observeWith(identity, FEE_DUE, [
    feeTxA(),
    feeTxB({ id: 9620, account_id: 1001 }),
  ]);
  ok(!(sameAccount.representedEventCandidates || []).some(c => c && c.id === FEE_ID),
    'two MONTHLY ACCOUNT FEE debits on the same account are not the two-leg shape');
  const report = observeWith(identity, FEE_DUE, [feeTxA(), feeTxB()]);
  const hit = (report.representedEventCandidates || [])
    .find(c => c && c.id === FEE_ID && c.date === FEE_DUE);
  ok(hit && hit.identity === 'two-leg-payee+account+date'
      && hit.settlesWhen === TWO_LEG
      && near(hit.observedAmount, FEE_TOTAL)
      && Array.isArray(hit.providerTransactionIds)
      && hit.providerTransactionIds.length === 2,
    'both named legs uniquely represent tdfees at the summed observed amount');
  const row = ((report.currentPeriodActuals || {}).representedActuals || [])
    .find(r => r && r.id === FEE_ID && r.date === FEE_DUE);
  ok(row && near(row.actual, FEE_TOTAL) && row.transactionId
      && Array.isArray(row.transactionIds) && row.transactionIds.length === 2,
    'representedActuals carries both fee legs against the one $35.90 bill');
  const packet = report.currentPeriodActuals || {};
  const linked = (packet.transactions || []).filter(tx =>
    tx && row && row.transactionIds && row.transactionIds.includes(tx.id));
  ok(linked.length === 2 && linked.every(tx => tx.representedBill === true),
    'both posted household-cash fee rows are flagged representedBill');
  const advice = recommendFromReport(report, FEE_DUE);
  const bill = actionBill(advice, FEE_ID, FEE_DUE) || calendarBill(advice, FEE_ID, FEE_DUE);
  ok(billPaid(advice, FEE_ID, FEE_DUE)
      && bill && near(bill.planned != null ? bill.planned : bill.amount, FEE_TOTAL)
      && near(bill.actual != null ? bill.actual : 0, FEE_TOTAL),
    'matching two-leg evidence marks tdfees PAID at $35.90');
}

console.log('\n=== 5. YouTube schedule-trust is paid on the due date without a bank tx ===');
{
  const identity = identityDoc();
  const observeSrc = sourceText(fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'provider-observe.js'), 'utf8'));
  ok(!/apple\.com|itunes|gmail|imap|scrape/i.test(observeSrc),
    'provider-observe does not invent Apple scrape or Gmail fetch');
  const before = observeWith(identity, YOUTUBE_BEFORE, []);
  ok(!(before.representedEventCandidates || []).some(c => c && c.id === YOUTUBE_ID),
    'YouTube is not represented the day before it is due');
  const report = observeWith(identity, YOUTUBE_DUE, []);
  const hit = (report.representedEventCandidates || [])
    .find(c => c && c.id === YOUTUBE_ID && c.date === YOUTUBE_DUE);
  ok(hit && hit.identity === SCHEDULE_TRUST
      && hit.settlesWhen === SCHEDULE_TRUST
      && hit.providerTransactionId == null
      && near(hit.observedAmount, YOUTUBE_PLANNED),
    'on the due date YouTube is represented from the schedule, not a bank tx');
  const row = ((report.currentPeriodActuals || {}).representedActuals || [])
    .find(r => r && r.id === YOUTUBE_ID && r.date === YOUTUBE_DUE);
  ok(row && near(row.actual, YOUTUBE_PLANNED) && !row.transactionId,
    'representedActuals names youtube-premium@Sep 2 without a transactionId');
  const appleNoise = observeWith(identity, YOUTUBE_DUE, [{
    id: 9701, account_id: 1001, date: YOUTUBE_DUE, amount: YOUTUBE_PLANNED,
    is_pending: false, payee: 'APPLE.COM/BILL', original_name: 'PAYPAL',
  }]);
  const appleHit = (appleNoise.representedEventCandidates || [])
    .find(c => c && c.id === YOUTUBE_ID && c.date === YOUTUBE_DUE);
  ok(appleHit && appleHit.identity === SCHEDULE_TRUST
      && appleHit.providerTransactionId == null,
    'an Apple/PayPal row is not used as YouTube identity');
  const advice = recommendFromReport(report, YOUTUBE_DUE);
  ok(billPaid(advice, YOUTUBE_ID, YOUTUBE_DUE),
    'schedule-trust on the due date marks YouTube PAID');
  const beforeAdvice = recommendFromReport(before, YOUTUBE_BEFORE);
  ok(billUnpaid(beforeAdvice, YOUTUBE_ID, YOUTUBE_DUE),
    'the day before the due date YouTube remains still-due');
}

console.log('\n=== 6. independent remaining-bill deltas ===');
{
  const identity = identityDoc();
  const stripped = identityWithout(identity, [FORTIS_ID, FEE_ID, YOUTUBE_ID]);
  const asOf = '2026-09-03';
  const txs = [fortisTx({ date: asOf, amount: FORTIS_PLANNED }), feeTxA(), feeTxB()];
  const before = recommendFromReport(observeWith(stripped, asOf, txs), asOf);
  const after = recommendFromReport(observeWith(identity, asOf, txs), asOf);
  const remaining = advice => {
    const bills = (((advice && advice.currentPeriodAction) || {}).bills) || [];
    return bills
      .filter(row => row && row.settlement !== 'represented')
      .reduce((sum, row) => sum + Math.abs(Number(row.remaining != null
        ? row.remaining : row.planned) || 0), 0);
  };
  const beforeRemain = remaining(before);
  const afterRemain = remaining(after);
  const independent = roundCent(FORTIS_PLANNED + FEE_TOTAL + YOUTUBE_PLANNED);
  ok(near(roundCent(beforeRemain - afterRemain), independent),
    'matching the three identities releases independently $124 + $35.90 + $17',
    `${beforeRemain} → ${afterRemain} vs ${independent}`);
  ok(billPaid(after, FORTIS_ID, FORTIS_DUE)
      && billPaid(after, FEE_ID, FEE_DUE)
      && billPaid(after, YOUTUBE_ID, YOUTUBE_DUE),
    'on Sep 3, Fortis evidence + TD two-leg evidence + YouTube due-date trust are all PAID');
}

console.log('\n=== 7. pages do not special-case these merchants ===');
{
  const planSrc = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public', 'plan.js'), 'utf8'));
  ok(!/Fortisbc Energy|MONTHLY ACCOUNT FEE|YouTube Premium/.test(planSrc),
    'plan.js only prints; it does not special-case these identities');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll standing bill-settlement identity checks passed.');
