'use strict';

// Owner correction 2026-08-23: Affirm has one final $32.53 payment on
// 2026-09-21. Prove the canonical cash event, provider settlement identity,
// and debt-service classification independently of the live household cents.

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');
const Observe = require('../scripts/provider-observe.js');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.json');
const MAP_PATH = path.join(ROOT, 'docs', 'connectivity', 'fixtures',
  'provider-account-map.json');
const IDENTITY_PATH = path.join(ROOT, 'docs', 'connectivity',
  'transaction-identity.json');
const POSITIONS_PATH = path.join(ROOT, 'docs', 'positions.csv');
const FACTS_PATH = path.join(ROOT, 'docs', 'ACCOUNT_FACTS.md');

let failures = 0;
function ok(condition, label, detail) {
  if (condition) {
    console.log(`\x1b[32m✓\x1b[0m ${label}`);
    return;
  }
  failures += 1;
  console.log(`\x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
}
function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function near(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.005;
}

const data = load(DATA_PATH);
const bill = data.plan.bills.find(row => row.id === 'affirm-final');
ok(bill && bill.frequency === 'once' && bill.date === '2026-09-21'
    && near(bill.amount, 32.53) && bill.confidence === 'confirmed',
  'canonical plan carries one confirmed final $32.53 payment on September 21');

const events = Forecast.expandEvents(data.plan, '2026-08-23', '2027-09-30', {})
  .filter(event => event.id === 'affirm-final');
ok(events.length === 1 && events[0].date === '2026-09-21'
    && near(events[0].amount, -32.53),
  'the master cash walk emits exactly one final Affirm outflow',
  JSON.stringify(events));
ok(near(events.reduce((sum, event) => sum + event.amount, 0), -32.53),
  'independent event total reconciles to the owner-stated final payment');

const cls = Forecast.classifyCurrentPeriodTransaction({
  date: '2026-09-21',
  amount: 32.53,
  pending: false,
  categoryLabel: 'Personal loan payment',
  accountRole: 'household-cash',
}, data.plan);
ok(cls.kind === 'card-payment' && cls.householdSpending === false,
  'Lunch Money Personal loan payment is debt service, not variable spending',
  JSON.stringify(cls));

const payload = {
  provider: 'lunchmoney',
  fetchedAt: '2026-09-21T18:00:00.000Z',
  transactionWindow: {
    startDate: '2026-09-01', endDate: '2026-09-21',
    complete: true, hasMore: false, truncated: false,
  },
  pendingCoverage: {
    complete: true, basis: 'is_pending-unbounded',
    hasMore: false, truncated: false,
  },
  accounts: [
    { id: 1001, name: 'Fixture Chequing A', type: 'cash', balance: 1000,
      updated_at: '2026-09-21T17:55:00.000Z' },
    { id: 1002, name: 'Fixture Chequing B', type: 'cash', balance: 500,
      updated_at: '2026-09-21T17:55:00.000Z' },
  ],
  transactions: [{
    id: 9211,
    account_id: 1002,
    date: '2026-09-21',
    amount: 32.53,
    is_pending: false,
    payee: 'AFFIRM CANADA _V',
    category_name: 'Personal loan payment',
  }],
};
const report = Observe.observe({
  provider: 'lunchmoney',
  payload,
  accountMap: load(MAP_PATH),
  data,
  identity: load(IDENTITY_PATH),
});
const candidate = (report.representedEventCandidates || [])
  .find(row => row.id === 'affirm-final');
ok(candidate && candidate.date === '2026-09-21'
    && candidate.postingDate === '2026-09-21'
    && candidate.direction === 'debit'
    && candidate.amountNotUsed === true,
  'exact payee, account, direction and date can settle the final occurrence',
  JSON.stringify(report.representedEventCandidates || []));

const positions = fs.readFileSync(POSITIONS_PATH, 'utf8');
const facts = fs.readFileSync(FACTS_PATH, 'utf8');
ok(/Affirm\/Flexiti,BNPL[\s\S]*Final instalment,2026-09-21/.test(positions)
    && /FINAL PAYMENT PENDING/.test(facts)
    && !/Flexiti — PAID OFF AND CLOSED/.test(facts),
  'durable account records no longer claim premature closure');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nFinal Affirm payment proofs passed.');
