'use strict';
/* Dale-gated 2026-09-18 posting settles: noble-garbage@2026-09-18,
 * heloc@2026-09-21 (cash minimum), tdcc@2026-09-17.
 *
 * RepresentedEvents on the dated opening plus Fit4Less-class identity
 * for live rediscovery of Noble Dispo (WEEKLY) and IP470 HELOC cash
 * (BILLS). tdcc stays Dale-gated only: chequing TFR-TO C/C is already
 * travel/cashback/tdcc card-side identity and must not invent Emerald.
 * Not card-paid standing. Synthetic observe fixtures (L-006); live
 * id+date membership is the owner-gated fact being encoded.
 *
 * `node test/test-dale-gated-represented-settles.js`
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');
const Live = require('../scripts/live-plan.js');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.json');
const IDENTITY_PATH = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const MAP_PATH = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');

const OPENING = '2026-08-19';
const LIVE_AS_OF = '2026-09-18';
const FETCHED_AT = '2026-09-18T18:00:00.000Z';
const OBSERVED_AT = '2026-09-18T17:55:00.000Z';
const NOBLE_ID = 'noble-garbage';
const NOBLE_DUE = '2026-09-18';
const NOBLE_PLANNED = 95.85;
const NOBLE_OBS = 90.11;
const HELOC_ID = 'heloc';
const HELOC_DUE = '2026-09-21';
const HELOC_PLANNED = 814.18;
const HELOC_OBS = 900;
const TDCC_ID = 'tdcc';
const TDCC_DUE = '2026-09-17';
const TDCC_PLANNED = 94.03;
const EARLY_RULE = 'covers-early-or-due-on-or-before-posting';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = value => JSON.parse(JSON.stringify(value));
const load = file => JSON.parse(fs.readFileSync(file, 'utf8'));

const canonicalFileBefore = fs.readFileSync(DATA_PATH, 'utf8');
const canonical = JSON.parse(canonicalFileBefore);
const identity = load(IDENTITY_PATH);
const fixtureMap = load(MAP_PATH);

function named(list, id, date) {
  return (list || []).some(row => row && row.id === id && row.date === date);
}

function liveNamed() {
  return (canonical.plan.opening && canonical.plan.opening.representedEvents) || [];
}

function identityWithout(eventIds) {
  const next = clone(identity);
  const skip = new Set(eventIds);
  next.rules = (next.rules || []).filter(r => r && !skip.has(r.eventId));
  return next;
}

function rulesFor(eventId) {
  return (identity.rules || []).filter(r => r && r.eventId === eventId);
}

function cashValue(data, id) {
  const rows = ((data.plan && data.plan.startingCash && data.plan.startingCash.breakdown) || []);
  const row = rows.find(r => r && r.id === id);
  return row ? Number(row.value) : null;
}

function readyMap() {
  const map = clone(fixtureMap);
  map.mappings = (map.mappings || []).concat([{
    providerAccountId: '1003',
    canonical: { collection: 'cash', id: 'savings' },
    atlasRole: 'household-cash',
  }]);
  return map;
}

function matchingAccounts(data) {
  return [
    {
      id: 1001, name: 'Fixture Chequing A', type: 'cash', balance: cashValue(data, 'chequing-a'),
      updated_at: OBSERVED_AT,
    },
    {
      id: 1002, name: 'Fixture Chequing B', type: 'cash', balance: cashValue(data, 'chequing-b'),
      updated_at: OBSERVED_AT,
    },
    {
      id: 1003, name: 'Fixture Savings', type: 'cash', balance: cashValue(data, 'savings'),
      updated_at: OBSERVED_AT,
    },
  ];
}

function payload(txs) {
  return {
    provider: 'lunchmoney',
    fetchedAt: FETCHED_AT,
    transactionWindow: {
      startDate: OPENING,
      endDate: LIVE_AS_OF,
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
    accounts: matchingAccounts(canonical),
    categories: [
      { id: 11, name: 'Sewage and waste management', is_income: false, exclude_from_totals: false },
      { id: 12, name: 'Payment Transfer', is_income: false, exclude_from_totals: true },
    ],
    transactions: txs || [],
  };
}

function observeWith(idDoc, txs) {
  return O.observe({
    provider: 'lunchmoney',
    payload: payload(txs),
    accountMap: readyMap(),
    data: canonical,
    identity: idDoc,
  });
}

function nobleTx(extra) {
  return Object.assign({
    id: 42101, account_id: 1002, date: NOBLE_DUE, amount: NOBLE_OBS,
    is_pending: false, payee: 'Noble Dispo', original_name: 'Noble Dispo',
    category_id: 11,
  }, extra || {});
}

function helocTx(extra) {
  return Object.assign({
    id: 42102, account_id: 1001, date: LIVE_AS_OF, amount: HELOC_OBS,
    is_pending: false, payee: 'IP470 TFR-TO HELOC', original_name: 'IP470 TFR-TO HELOC',
    category_id: 12, exclude_from_totals: true,
  }, extra || {});
}

function tdccChequingTx(extra) {
  return Object.assign({
    id: 42103, account_id: 1001, date: LIVE_AS_OF, amount: 100,
    is_pending: false, payee: 'TFR-TO C/C', original_name: 'TFR-TO C/C',
    category_id: 12, exclude_from_totals: true,
  }, extra || {});
}

function actionBill(plan, asOf, id, date, opts) {
  const action = F.currentPeriodAction(plan, asOf, opts || {});
  return ((action && action.bills) || [])
    .find(b => b && b.id === id && (!date || b.date === date)) || null;
}

function overlay(idDoc, txs) {
  return Live.fromObservation({
    data: canonical,
    payload: payload(txs),
    accountMap: readyMap(),
    identity: idDoc,
  });
}

console.log('=== 1. Dale-gated representedEvents membership on current main encoding ===');
{
  const rows = liveNamed();
  ok(named(rows, NOBLE_ID, NOBLE_DUE)
      && named(rows, HELOC_ID, HELOC_DUE)
      && named(rows, TDCC_ID, TDCC_DUE)
      && rows.length === 3,
    'opening.representedEvents is exactly the three Dale-gated id+date settles');
  const noble = (canonical.plan.bills || []).find(b => b && b.id === NOBLE_ID);
  const heloc = (canonical.plan.obligations || []).find(o => o && o.id === HELOC_ID);
  const tdcc = (canonical.plan.obligations || []).find(o => o && o.id === TDCC_ID);
  ok(noble && noble.payingAccount === 'chequing-a' && noble.cardPaid !== true
      && noble.jointCash !== false,
    'noble-garbage payingAccount stays chequing-a; cardPaid is not invented');
  ok(heloc && heloc.payingAccount === 'chequing-a' && heloc.nonCash === true
      && heloc.cardPaid !== true
      && near(heloc.cashPayment, HELOC_PLANNED)
      && heloc.cashFirstDue === HELOC_DUE,
    'heloc stays capitalising on chequing-a; cashFirstDue 2026-09-21 is unchanged');
  ok(tdcc && tdcc.payingAccount === 'chequing-a' && tdcc.cardPaid !== true
      && near(tdcc.amount, TDCC_PLANNED) && tdcc.firstDue === TDCC_DUE,
    'tdcc payingAccount stays chequing-a; firstDue 2026-09-17 is unchanged');
}

console.log('\n=== 2. prepaid helper: capitalising cash min, bill, card min ===');
{
  ok(F.prepaidJointCashOutflow(canonical.plan, NOBLE_ID, NOBLE_DUE, OPENING),
    'noble-garbage@2026-09-18 is a prepaid joint-cash bill relative to 2026-08-19');
  ok(F.prepaidJointCashOutflow(canonical.plan, HELOC_ID, HELOC_DUE, OPENING),
    'heloc@2026-09-21 cash minimum is prepaid relative to 2026-08-19');
  ok(F.prepaidJointCashOutflow(canonical.plan, TDCC_ID, TDCC_DUE, OPENING),
    'tdcc@2026-09-17 is prepaid relative to 2026-08-19');
  ok(!F.prepaidJointCashOutflow(canonical.plan, HELOC_ID, '2026-09-30', OPENING),
    'the non-cash 30 Sep capitalise date is not a prepaid cash settle');
  ok(!named(liveNamed(), NOBLE_ID, '2026-12-18'),
    'this PR does not settle the later December Noble occurrence');
  const synth = {
    obligations: [{
      id: 'heloc', nonCash: true, frequency: 'monthly', day: 31, amount: 80,
      cashPayment: 80, cashDay: 21, cashFirstDue: '2026-09-21',
      payingAccount: 'chequing-a',
    }],
    bills: [],
  };
  ok(F.prepaidJointCashOutflow(synth, 'heloc', '2026-09-21', '2026-08-19'),
    'synthetic 80-dollar HELOC cash min is prepaid (L-006)');
  ok(!F.prepaidJointCashOutflow(synth, 'heloc', '2026-09-30', '2026-08-19'),
    'synthetic capitalise date is not prepaid');
}

console.log('\n=== 3. expandEvents omits the three settles from the dated opening ===');
{
  const end = '2026-09-22';
  const omitted = F.expandEvents(canonical.plan, OPENING, end, {});
  const kept = F.expandEvents(canonical.plan, OPENING, end, { keepRepresented: true });
  ok(!omitted.some(e => e.id === NOBLE_ID && e.date === NOBLE_DUE),
    'expandEvents omits noble-garbage@2026-09-18 when the settle is present');
  ok(!omitted.some(e => e.id === HELOC_ID && e.date === HELOC_DUE && e.kind === 'obligation'),
    'expandEvents omits heloc cash@2026-09-21');
  ok(!omitted.some(e => e.id === TDCC_ID && e.date === TDCC_DUE),
    'expandEvents omits tdcc@2026-09-17');
  ok(kept.some(e => e.id === NOBLE_ID && e.date === NOBLE_DUE && near(-e.amount, NOBLE_PLANNED)),
    'keepRepresented still emits the scheduled Noble $95.85 occurrence');
  ok(kept.some(e => e.id === HELOC_ID && e.date === HELOC_DUE && e.kind === 'obligation'
      && near(-e.amount, HELOC_PLANNED)),
    'keepRepresented still emits the encoded HELOC cash minimum');
  ok(kept.some(e => e.id === TDCC_ID && e.date === TDCC_DUE && near(-e.amount, TDCC_PLANNED)),
    'keepRepresented still emits the scheduled tdcc minimum');
  ok(omitted.some(e => e.id === HELOC_ID && e.date === '2026-08-31' && e.kind === 'noncash'),
    'August HELOC capitalise is not settled by the cash-minimum row');
  const independentlyOmitted = near(NOBLE_PLANNED + HELOC_PLANNED + TDCC_PLANNED, 1004.06);
  ok(independentlyOmitted,
    'independent 95.85 + 814.18 + 94.03 = 1004.06');
}

console.log('\n=== 4. currentPeriodAction marks the three represented / remaining 0 ===');
{
  const plan = clone(canonical.plan);
  plan.opening = Object.assign({}, plan.opening, {
    asOf: LIVE_AS_OF,
    priorAsOf: OPENING,
  });
  const noble = actionBill(plan, LIVE_AS_OF, NOBLE_ID, NOBLE_DUE);
  const heloc = actionBill(plan, LIVE_AS_OF, HELOC_ID, HELOC_DUE);
  const tdcc = actionBill(plan, LIVE_AS_OF, TDCC_ID, TDCC_DUE);
  ok(noble && noble.settlement === 'represented' && near(noble.remaining, 0)
      && near(noble.planned, NOBLE_PLANNED),
    'currentPeriodAction marks noble-garbage@2026-09-18 represented');
  ok(heloc && heloc.settlement === 'represented' && near(heloc.remaining, 0)
      && near(heloc.planned, HELOC_PLANNED),
    'currentPeriodAction marks heloc@2026-09-21 represented');
  ok(tdcc && tdcc.settlement === 'represented' && near(tdcc.remaining, 0)
      && near(tdcc.planned, TDCC_PLANNED),
    'currentPeriodAction marks tdcc@2026-09-17 represented');
  ok(!(noble && noble.cardPaid) && !(heloc && heloc.cardPaid) && !(tdcc && tdcc.cardPaid),
    'currentPeriodAction does not invent cardPaid on these rows');
}

console.log('\n=== 5. identities: Noble Dispo WEEKLY + IP470 BILLS; no tdcc chequing TFR-TO C/C ===');
{
  const noble = rulesFor(NOBLE_ID);
  ok(noble.length === 1 && noble[0].atlasAccountId === 'chequing-b'
      && noble[0].direction === 'debit'
      && (noble[0].payeePatterns || []).includes('Noble Dispo')
      && !noble[0].settlesWhen
      && !noble[0].postingDateRule,
    'noble-garbage identity is payee + WEEKLY + debit + same-day; amount is not identity');
  const heloc = rulesFor(HELOC_ID);
  ok(heloc.length === 1 && heloc[0].atlasAccountId === 'chequing-a'
      && heloc[0].direction === 'debit'
      && (heloc[0].payeePatterns || []).includes('IP470')
      && heloc[0].postingDateRule === EARLY_RULE
      && !heloc[0].settlesWhen,
    'heloc identity is IP470 + BILLS + debit + early-or-covers-due; amount is not identity');
  const guardSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'privacy-guard.js'), 'utf8');
  const guardLit = /CONTENT_PATTERNS = "([^"]+)"/.exec(guardSrc);
  const blocked = guardLit ? new RegExp(guardLit[1], 'i') : null;
  ok(blocked && !blocked.test(JSON.stringify(heloc[0]))
      && !blocked.test(identity.owns || '')
      && !blocked.test(canonical.plan.opening.note || ''),
    'HELOC identity and the opening note do not copy a privacy-guard blocked identifier');
  const tdccChequing = rulesFor(TDCC_ID)
    .filter(r => r.atlasAccountId === 'chequing-a' && r.direction === 'debit');
  ok(tdccChequing.length === 0,
    'this PR does not add a chequing TFR-TO C/C tdcc identity');
  ok(rulesFor(TDCC_ID).every(r => r.atlasAccountId === 'tdcc' && r.direction === 'credit'),
    'existing tdcc identity stays card-side credit');
}

console.log('\n=== 6. Noble Dispo actual leaves Other residual via represented-bill identity ===');
{
  const missing = observeWith(identityWithout([NOBLE_ID]), [nobleTx()]);
  ok(!(missing.representedEventCandidates || []).some(c => c && c.id === NOBLE_ID),
    'without the noble-garbage rule, Noble Dispo stays unmatched');
  const unmatchedTx = ((missing.currentPeriodActuals || {}).transactions || [])
    .find(tx => tx && String(tx.id) === '42101');
  const unmatchedCls = F.classifyCurrentPeriodTransaction(unmatchedTx, canonical.plan, {
    currentPeriodActuals: missing.currentPeriodActuals,
  });
  ok(unmatchedCls && unmatchedCls.kind !== 'bill' && unmatchedCls.householdSpending === true,
    'unmatched Noble Dispo remains household spend (Other residual path)',
    unmatchedCls && `${unmatchedCls.kind}:${unmatchedCls.categoryId}`);
  const report = observeWith(identity, [nobleTx()]);
  const hit = (report.representedEventCandidates || [])
    .find(c => c && c.id === NOBLE_ID && c.date === NOBLE_DUE);
  ok(hit && hit.postingDate === NOBLE_DUE
      && hit.postingDateRelation === 'same-day'
      && hit.amountNotUsed === true
      && hit.atlasAccountId === 'chequing-b'
      && near(hit.observedAmount, NOBLE_OBS),
    'Sep 18 Noble Dispo on chequing-b settles noble-garbage as same-day');
  const row = ((report.currentPeriodActuals || {}).representedActuals || [])
    .find(r => r && r.id === NOBLE_ID && r.date === NOBLE_DUE);
  ok(row && row.transactionId && near(row.actual, NOBLE_OBS),
    'representedActuals carries the observed Noble debit against noble-garbage');
  const matchedTx = ((report.currentPeriodActuals || {}).transactions || [])
    .find(tx => tx && String(tx.id) === String(row.transactionId));
  ok(matchedTx && matchedTx.representedBill === true, 'the Noble tx is flagged representedBill');
  const cls = F.classifyCurrentPeriodTransaction(matchedTx, canonical.plan, {
    currentPeriodActuals: report.currentPeriodActuals,
  });
  ok(cls && cls.kind === 'bill' && cls.householdSpending === false
      && cls.reason === 'represented-bill',
    'matching Noble Dispo is a represented bill, not Other residual');
  const wrongAccount = observeWith(identity, [nobleTx({ id: 42111, account_id: 1001 })]);
  ok(!(wrongAccount.representedEventCandidates || []).some(c => c && c.id === NOBLE_ID),
    'Noble Dispo on Chequing A does not settle the WEEKLY identity');
  const wrongPayee = observeWith(identity, [nobleTx({
    id: 42112, payee: 'UNKNOWN DEBIT', original_name: 'UNKNOWN DEBIT',
  })]);
  ok(!(wrongPayee.representedEventCandidates || []).some(c => c && c.id === NOBLE_ID),
    'date + amount without Noble Dispo does not settle noble-garbage');
}

console.log('\n=== 7. IP470 BILLS debit rediscovers heloc cash min as early pay ===');
{
  const missing = observeWith(identityWithout([HELOC_ID]), [helocTx()]);
  ok(!(missing.representedEventCandidates || []).some(c => c && c.id === HELOC_ID),
    'without the heloc rule, IP470 stays unmatched');
  const report = observeWith(identity, [helocTx()]);
  const hit = (report.representedEventCandidates || [])
    .find(c => c && c.id === HELOC_ID && c.date === HELOC_DUE);
  ok(hit && hit.postingDate === LIVE_AS_OF
      && hit.postingDateRelation === 'early-pay-before-due'
      && hit.amountNotUsed === true
      && hit.atlasAccountId === 'chequing-a'
      && near(hit.observedAmount, HELOC_OBS),
    'Sep 18 IP470 debit settles heloc@2026-09-21 as early pay; $900 is not identity');
  ok(!(report.representedEventCandidates || [])
      .some(c => c && c.id === HELOC_ID && c.date === '2026-09-30'),
    'IP470 does not settle the non-cash capitalise date');
  const ccPayee = observeWith(identity, [helocTx({
    id: 42121, payee: 'TFR-TO C/C', original_name: 'TFR-TO C/C',
  })]);
  ok(!(ccPayee.representedEventCandidates || []).some(c => c && c.id === HELOC_ID),
    'TFR-TO C/C is not HELOC identity');
}

console.log('\n=== 8. chequing TFR-TO C/C does not uniquely settle tdcc ===');
{
  const report = observeWith(identity, [tdccChequingTx()]);
  ok(!(report.representedEventCandidates || []).some(c => c && c.id === TDCC_ID),
    'chequing TFR-TO C/C does not represent tdcc (card-side credit remains the identity)');
  ok(!(report.representedEventCandidates || []).some(c => c && (c.id === 'travel' || c.id === 'cashback')),
    'this fixture debit is not a card-side credit and does not settle travel/cashback either');
}

console.log('\n=== 9. live as-of advance drops Dale-gated names unless identity rediscovers ===');
{
  const stripped = overlay(identityWithout([NOBLE_ID, HELOC_ID]), []);
  const dropped = (stripped.data.plan.opening && stripped.data.plan.opening.representedEvents) || [];
  ok(stripped.data.plan.opening.asOf === LIVE_AS_OF
      && stripped.data.plan.opening.priorAsOf === OPENING,
    'fresh overlay advances as-of to 2026-09-18');
  ok(!named(dropped, NOBLE_ID, NOBLE_DUE)
      && !named(dropped, HELOC_ID, HELOC_DUE)
      && !named(dropped, TDCC_ID, TDCC_DUE),
    'without identity hits, live advance does not keep the Dale-gated prepaid names');
  const rediscovered = overlay(identity, [nobleTx(), helocTx()]);
  const next = (rediscovered.data.plan.opening
    && rediscovered.data.plan.opening.representedEvents) || [];
  ok(named(next, NOBLE_ID, NOBLE_DUE) && named(next, HELOC_ID, HELOC_DUE),
    'identity rediscovers noble-garbage@2026-09-18 and heloc@2026-09-21 on the live opening');
  ok(!named(next, TDCC_ID, TDCC_DUE),
    'tdcc is not rediscovered from chequing evidence; Dale-gated list alone does not survive advance');
  const liveNoble = (canonical.plan.bills || []).find(b => b.id === NOBLE_ID);
  const liveHeloc = (canonical.plan.obligations || []).find(o => o.id === HELOC_ID);
  ok(JSON.stringify(rediscovered.data.plan.bills.find(b => b.id === NOBLE_ID))
      === JSON.stringify(liveNoble),
    'live rediscovery does not rewrite the noble-garbage bill row');
  ok(JSON.stringify(rediscovered.data.plan.obligations.find(o => o.id === HELOC_ID))
      === JSON.stringify(liveHeloc),
    'live rediscovery does not rewrite the heloc obligation row');
}

console.log('\n=== 10. pages do not special-case these merchants; canonical bytes stay put ===');
{
  const planSrc = sourceText(fs.readFileSync(path.join(ROOT, 'public', 'plan.js'), 'utf8'));
  ok(!/Noble Dispo|IP470/.test(planSrc),
    'plan.js only prints; it does not special-case Noble Dispo or IP470');
  ok(fs.readFileSync(DATA_PATH, 'utf8') === canonicalFileBefore,
    'this suite does not mutate data.json');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll Dale-gated represented-settle checks passed.');
