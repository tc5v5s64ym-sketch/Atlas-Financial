'use strict';

// Focused production-trust proof for automatic-payment settlement. The
// fixture contains synthetic provider ids and sanitized payee shapes only.

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');
const Live = require('../scripts/live-plan.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE_PATH = path.join(ROOT, 'docs', 'connectivity', 'fixtures',
  'automatic-payment-settlement.json');
const MAP_PATH = path.join(ROOT, 'docs', 'connectivity', 'fixtures',
  'provider-account-map.json');
const IDENTITY_PATH = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const DATA_PATH = path.join(ROOT, 'data.json');
const IDS = [
  'bcaa-aug15-outstanding',
  'icbc-aug15-outstanding',
  'resp-aug15-outstanding',
];
const EXPECTED = 282.87;
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
const canonicalBefore = JSON.stringify(canonical);
const fixture = load(FIXTURE_PATH);
const accountMap = load(MAP_PATH);
const identity = load(IDENTITY_PATH);

function observe(payload) {
  return O.observe({
    provider: 'lunchmoney',
    payload,
    accountMap,
    data: canonical,
    identity,
  });
}

function relevantReserve(plan) {
  const asOf = plan.opening.asOf;
  return Forecast.expandEvents(plan, asOf, asOf, {})
    .filter(event => IDS.includes(event.id))
    .reduce((sum, event) => sum - Number(event.amount), 0);
}

function candidatesFor(transactions) {
  const payload = clone(fixture);
  payload.transactions = transactions;
  return observe(payload).representedEventCandidates || [];
}

console.log('=== automatic-payment settlement success ===');
const report = observe(fixture);
const candidates = report.representedEventCandidates || [];
const beforeReserve = relevantReserve(canonical.plan);
const result = Live.overlayLiveState({ data: canonical, report });
const afterReserve = relevantReserve(result.data.plan);

ok(near(beforeReserve, EXPECTED),
  'the three unresolved occurrences reserve $282.87 before trusted posting evidence',
  String(beforeReserve));
ok(candidates.length === 3 && IDS.every(id => candidates.some(candidate => candidate.id === id)),
  'all three sanitized posted transactions identify their exact reserved occurrence',
  candidates.map(candidate => candidate.id).join(', '));
ok(candidates.every(candidate => candidate.date === '2026-08-16'
    && candidate.postingDate === '2026-08-17'
    && candidate.postingDateRelation === 'weekend-next-business-day'
    && candidate.direction === 'debit'
    && candidate.amountNotUsed === true),
  'each identity uses debit direction and the bounded weekend-to-next-business-day relation');
ok(near(afterReserve, 0) && near(beforeReserve - afterReserve, EXPECTED),
  'the live Forecast releases exactly $282.87 and does not reserve the three obligations again',
  `${beforeReserve} -> ${afterReserve}`);
ok(IDS.every(id => (result.data.plan.opening.representedEvents || [])
    .some(item => item.id === id && item.date === '2026-08-16')),
  'the in-memory opening names each settled id+scheduled-date occurrence');
ok(JSON.stringify(result.data.plan.bills) === JSON.stringify(canonical.plan.bills),
  'settlement leaves the incumbent bill schedule unchanged');
ok(JSON.stringify(canonical) === canonicalBefore
    && fs.readFileSync(DATA_PATH, 'utf8') === canonicalFileBefore,
  'the observer and live overlay do not mutate canonical input');

const expectedById = new Map([
  ['bcaa-aug15-outstanding', 82.96],
  ['icbc-aug15-outstanding', 99.91],
  ['resp-aug15-outstanding', 100],
]);
for (const eventId of IDS) {
  const canonicalBill = canonical.plan.bills.find(bill => bill.id === eventId);
  ok(canonicalBill && near(canonicalBill.amount, expectedById.get(eventId))
      && !Forecast.expandEvents(result.data.plan, '2026-08-19', '2026-08-19', {})
        .some(event => event.id === eventId),
    `${eventId} settles its exact reserved amount`);
}

console.log('\n=== automatic-payment settlement fails closed ===');
const bcaa = fixture.transactions.find(tx => tx.id === 8101);
function rejectsBcaa(transactions, label) {
  const hits = candidatesFor(transactions);
  ok(!hits.some(candidate => candidate.id === 'bcaa-aug15-outstanding'), label,
    hits.map(candidate => `${candidate.id}@${candidate.date}`).join(', '));
}

rejectsBcaa([Object.assign({}, bcaa, { is_pending: true })],
  'pending evidence does not settle');
rejectsBcaa([Object.assign({}, bcaa, { contradictoryEvidence: true })],
  'contradictory/untrusted evidence does not settle');
const incompleteWindow = clone(fixture);
incompleteWindow.transactionWindow.complete = false;
incompleteWindow.transactionWindow.truncated = true;
ok(!(observe(incompleteWindow).representedEventCandidates || []).length,
  'an incomplete/truncated posted-transaction window does not settle');
rejectsBcaa([Object.assign({}, bcaa, { account_id: 1002 })],
  'the right alias on the wrong mapped account does not settle');
rejectsBcaa([Object.assign({}, bcaa, { payee: 'Fixture unknown debit' })],
  'the right amount on an unknown payee does not settle');
rejectsBcaa([Object.assign({}, bcaa, { date: '2026-08-18' })],
  'a posting outside same-day or weekend-next-business-day does not settle');
rejectsBcaa([Object.assign({}, bcaa, { amount: -82.96 })],
  'the wrong transaction direction does not settle');
rejectsBcaa([
  Object.assign({}, bcaa, { id: 8201 }),
  Object.assign({}, bcaa, { id: 8202 }),
], 'duplicate candidates for one occurrence do not settle');

const amountOnly = candidatesFor([{
  id: 8203,
  account_id: 1001,
  date: '2026-08-17',
  amount: 82.96,
  is_pending: false,
  payee: 'Fixture amount-only debit',
}]);
ok(amountOnly.length === 0, 'amount and date alone never establish identity');

const changedAmount = candidatesFor([Object.assign({}, bcaa, { id: 8204, amount: 103 })]);
ok(changedAmount.some(candidate => candidate.id === 'bcaa-aug15-outstanding'
    && near(candidate.observedAmount, 103) && candidate.amountNotUsed === true),
  'a different observed amount still matches only after non-amount identity is complete');

const genericHistorical = Live.overlayLiveState({
  data: canonical,
  report: {
    writesCanonicalState: false,
    fetchedAt: fixture.fetchedAt,
    representedEventCandidates: [{ id: 'bcaa', date: '2026-08-15' }],
    reconciliation: { rows: [] },
  },
});
ok(!(genericHistorical.data.plan.opening.representedEvents || [])
    .some(item => item.id === 'bcaa' && item.date === '2026-08-15')
    && genericHistorical.refused.some(item => item.reason === 'historical-opening-backfill'),
  'generic historical recurring backfill remains refused');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAutomatic-payment settlement proofs passed.');
