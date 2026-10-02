'use strict';
// Synthetic current-tail evidence. Expected capacity and card exposure use
// supplied ledger amounts, never another call to the producing calculation.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const fixture = require('./fixtures/budget-funding-data');
const AS_OF = '2026-08-20';

function state(pending = true, account = 'travelvisa', role = 'revolving-credit', amount = 50) {
  const data = fixture();
  data.plan.opening.asOf = AS_OF;
  data.plan.startingCash.breakdown[0].value = 800;
  data.plan.obligations.push({ id: 'card-minimum', label: 'Synthetic card minimum',
    debtId: account, effect: 'payment', frequency: 'biweekly', anchor: '2026-08-28',
    amount: 25, confidence: 'confirmed' });
  const debts = [{ id: account, label: 'Synthetic card', structure: 'Revolving',
    balance: pending ? 400 : 400 + amount, pending: pending ? amount : 0, rate: 20, limit: 1000 }];
  const packet = { schema: 'atlas-current-period-actuals/v1', observationAsOf: AS_OF,
    coverageStart: '2026-08-14', coverageThrough: AS_OF,
    transactionCoverage: 'complete', pendingCoverage: 'complete',
    transactions: [{ id: 'synthetic-charge', date: '2026-08-19', amount, account,
      categoryLabel: 'Groceries', displayedPayee: 'Synthetic grocer', pending }] };
  if (role != null) packet.transactions[0].accountRole = role;
  return { data, debts, packet };
}
function run(s) {
  return F.recommend(s.data.plan, AS_OF, { debts: s.debts, currentPeriodActuals: s.packet });
}
const period = (advice, start) => advice.payPeriodViews.find(p => p.start === start);
const nextFunding = advice => period(advice, '2026-08-28').plannedCostFunding;

const pending = state();
const pendingBefore = JSON.stringify(pending);
const pendingAdvice = run(pending);
const funding = nextFunding(pendingAdvice);
// Next full period: 1000 payroll - 200 bill - 150 later bill - 25 card
// minimum - 300 groceries = 325. A 600 deadline leaves a 275 funding gap.
assert.equal(funding.contribution, 325, 'known pending card spend permits the same future proposal as posted');
assert.equal(funding.capacity, 325);
assert.equal(funding.gap.shortBy, 600 - 325);
assert.equal(funding.actualSaved, null);
assert.equal(funding.originalPaydayPlan, null);
assert.equal(period(pendingAdvice, '2026-08-14').plannedCostFunding.contribution, null,
  'no original current-period contribution without its starting snapshot');
assert.equal(period(pendingAdvice, '2026-08-14').householdBudget[0].spent, 50);
assert.equal(period(pendingAdvice, '2026-08-14').householdBudget[0].hold, 300,
  'pending consumption fulfills the allowance once, not planned plus actual');
assert.equal(period(pendingAdvice, '2026-08-14').householdBudget[0].pendingRecon[0].pending, true);
assert.equal(JSON.stringify(pending), pendingBefore, 'pending state and financial inputs are not mutated');

for (const amount of [50, 350]) {
  const a = state(true, 'travelvisa', 'revolving-credit', amount);
  const b = state(false, 'travelvisa', 'revolving-credit', amount);
  const pa = run(a), pb = run(b);
  assert.deepEqual(nextFunding(pa), nextFunding(pb), 'posting cannot create more funding capacity');
  for (const advice of [pa, pb]) {
    const current = period(advice, '2026-08-14');
    assert.equal(current.householdBudget[0].spent, amount);
    assert.equal(current.householdBudget[0].hold, Math.max(300, amount));
    assert.equal(current.periodBillLoad, 0, 'elapsed bills are not replayed against the current tail');
    assert.equal(period(advice, '2026-08-28').periodBillLoad, 200 + 150 + 25);
    assert.equal(advice.paydayAllocation.available, 800, 'credit capacity is not available cash');
  }
  const u = F.utilisation(a.debts).rows[0];
  assert.equal(u.posted, 400);
  assert.equal(u.pending, amount);
  assert.equal(u.used, 400 + amount, 'outstanding exposure counts the charge exactly once');
  assert.equal(u.available, 1000 - 400 - amount);
  assert.equal(u.pct, (400 + amount) / 1000 * 100);
  const opts = { debtHorizonDays: 1 };
  const debtPending = F.projectDebts(a.data.plan, a.debts, AS_OF, opts);
  const debtPosted = F.projectDebts(b.data.plan, b.debts, AS_OF, opts);
  assert.equal(debtPending.byId.travelvisa.opening, 400 + amount);
  assert.ok(Math.abs(debtPending.byId.travelvisa.interest - (400 + amount) * .20 / 365) < 1e-10);
  assert.equal(debtPending.byId.travelvisa.interest, debtPosted.byId.travelvisa.interest);
  assert.equal(debtPending.byId.travelvisa.balance, debtPosted.byId.travelvisa.balance);
  const minimumWalk = F.projectDebts(a.data.plan, a.debts, AS_OF, { debtHorizonDays: 10 });
  // Nine daily accruals precede the Aug 28 minimum; the tenth follows it.
  const closing = ((400 + amount) * (1 + .20 / 365) ** 9 - 25) * (1 + .20 / 365);
  assert.equal(minimumWalk.byId.travelvisa.paid, 25);
  assert.ok(Math.abs(minimumWalk.byId.travelvisa.balance - closing) < 1e-9);
}

// A sanitized recon row has no accountRole. The original packet's mapped
// revolving role must still admit a card outside the canonical id list.
assert.equal(nextFunding(run(state(true, 'synthetic-mapped-card'))).contribution, 325);
assert.equal(nextFunding(run(state(true, 'travelvisa', null))).contribution, 325,
  'incumbent canonical card identity also supplies provenance');
const consistent = state();
Object.assign(consistent.packet.transactions[0], { atlasAccountId: 'travelvisa', accountId: 'travelvisa' });
assert.equal(nextFunding(run(consistent)).contribution, 325, 'consistent canonical aliases preserve admission');

// Packet provenance cannot establish the facility's pending exposure. These
// deliberately inconsistent synthetic inputs are not a live producer incident.
const facilityNegatives = [
  ['unknown pending', s => { s.debts[0].pendingUnknown = true; }],
  ['legacy unknown pending', s => { s.debts[0].unknownPending = true; }],
  ['missing facility', s => { s.debts = []; }],
  ['unmatched facility', s => { s.debts[0].id = 'another-card'; }],
  ['undersized pending', s => { s.debts[0].pending = 49; }],
  ['missing pending amount', s => { delete s.debts[0].pending; }],
  ['null pending amount', s => { s.debts[0].pending = null; }],
  ['nonfinite pending amount', s => { s.debts[0].pending = NaN; }],
  ['ambiguous identical facility', s => { s.debts.push({ ...s.debts[0] }); }],
  ['ambiguous conflicting facility', s => { s.debts.push({ ...s.debts[0], pending: 0 }); }],
];
const facilityResults = facilityNegatives.map(([name, change]) => {
  const s = state(); change(s);
  const result = nextFunding(run(s));
  return [name, result.status, result.contribution];
});
assert.deepEqual(facilityResults, facilityNegatives.map(([name]) => [name, 'unavailable', null]),
  'unknown, missing, insufficient or ambiguous facility evidence cannot release savings');

// Two independent purchases need 50 + 25 = 75 pending on this facility.
// Checking each individually against 50 would admit unsupported exposure.
function multiple(pendingExposure = 75, posted = false) {
  const s = state(!posted);
  s.packet.transactions.push({ ...s.packet.transactions[0], id: 'synthetic-charge-two',
    date: '2026-08-18', displayedPayee: 'Synthetic second grocer', amount: 25 });
  s.debts[0].pending = posted ? 0 : pendingExposure;
  s.debts[0].balance = posted ? 400 + 50 + 25 : 400;
  return s;
}
for (const exposure of [50, 74, 74.99]) {
  assert.equal(nextFunding(run(multiple(exposure))).contribution, null,
    'aggregate pending 75 exceeds facility evidence ' + exposure);
}
const aggregate = multiple();
const aggregateBefore = JSON.stringify(aggregate);
const aggregateAdvice = run(aggregate);
assert.equal(nextFunding(aggregateAdvice).contribution, 325, 'exact aggregate exposure permits funding');
assert.equal(period(aggregateAdvice, '2026-08-14').householdBudget[0].spent, 75);
assert.equal(period(aggregateAdvice, '2026-08-14').householdBudget[0].hold, 300,
  'two pending charges fulfill the allowance once');
assert.equal(F.utilisation(aggregate.debts).rows[0].used, 400 + 50 + 25,
  'admission cannot add transaction exposure to the debt a second time');
assert.deepEqual(nextFunding(aggregateAdvice), nextFunding(run(multiple(0, true))),
  'posting the aggregate conserves the funding proposal');
const mixed = multiple(50);
mixed.packet.transactions[1].pending = false;
mixed.debts[0].balance = 400 + 25;
assert.deepEqual(nextFunding(run(mixed)), nextFunding(aggregateAdvice),
  'a partial posting counts only the remaining pending charge against pending exposure');
const aggregateWalk = F.projectDebts(aggregate.data.plan, aggregate.debts, AS_OF, { debtHorizonDays: 10 });
const aggregatePosted = multiple(0, true);
const postedWalk = F.projectDebts(aggregatePosted.data.plan, aggregatePosted.debts, AS_OF, { debtHorizonDays: 10 });
assert.equal(aggregateWalk.byId.travelvisa.opening, 400 + 50 + 25);
assert.equal(aggregateWalk.byId.travelvisa.paid, 25);
assert.ok(Math.abs(aggregateWalk.byId.travelvisa.balance
  - ((400 + 50 + 25) * (1 + .20 / 365) ** 9 - 25) * (1 + .20 / 365)) < 1e-9,
  'independent compound-interest ledger includes aggregate exposure once and the minimum once');
assert.equal(aggregateWalk.byId.travelvisa.interest, postedWalk.byId.travelvisa.interest);
assert.equal(aggregateWalk.byId.travelvisa.balance, postedWalk.byId.travelvisa.balance);
assert.deepEqual(run(aggregate).payPeriodViews, aggregateAdvice.payPeriodViews,
  'repeat admission cannot accumulate charges');
assert.equal(JSON.stringify(aggregate), aggregateBefore, 'aggregate admission does not mutate evidence');
assert.equal(nextFunding(run(multiple(100))).contribution, 325,
  'facility pending can also cover charges outside this Budget category');

const separate = state();
separate.debts.push({ ...separate.debts[0], id: 'synthetic-second-card', pending: 25 });
separate.packet.transactions.push({ ...separate.packet.transactions[0], id: 'synthetic-other-card-charge',
  account: 'synthetic-second-card', amount: 25 });
assert.equal(nextFunding(run(separate)).contribution, 325, 'each facility covers its own pending charges');
separate.debts[0].pending = 75; separate.debts[1].pending = 0;
assert.equal(nextFunding(run(separate)).contribution, null,
  'surplus pending on one card cannot cover another card');
const refund = state();
refund.packet.transactions.push({ ...refund.packet.transactions[0], id: 'synthetic-pending-refund',
  date: '2026-08-18', amount: -25 });
refund.debts[0].pending = 25;
assert.equal(nextFunding(run(refund)).contribution, null,
  'a pending refund cannot supply missing exposure for a positive pending charge');

const negatives = [
  ['cash pending', s => Object.assign(s.packet.transactions[0], { account: 'chequing-a', accountRole: 'household-cash' })],
  ['cash pending without role', s => { s.packet.transactions[0].account = 'chequing-a'; delete s.packet.transactions[0].accountRole; }],
  ['unknown account', s => { s.packet.transactions[0].account = 'unknown-account'; delete s.packet.transactions[0].accountRole; }],
  ['unmapped account', s => { s.packet.transactions[0].accountRole = 'unmapped'; }],
  ['conflicting account role', s => { s.packet.transactions[0].accountRole = 'household-cash'; }],
  ['missing account', s => { delete s.packet.transactions[0].account; }],
  ['missing identity', s => { delete s.packet.transactions[0].id; }],
  ['accountId-only pending provenance', s => {
    const tx = s.packet.transactions[0]; tx.accountId = tx.account;
    delete tx.account; delete tx.accountRole;
  }],
  ['mapped-role accountId-only pending provenance', s => {
    const tx = s.packet.transactions[0]; tx.accountId = tx.account; delete tx.account;
  }],
  ['accountId-only possible replacement', s => {
    const tx = s.packet.transactions[0]; tx.accountId = tx.account;
    delete tx.account; delete tx.accountRole;
    s.packet.transactions.push({ ...tx, id: 'synthetic-posted', pending: false });
  }],
  ['mapped-role accountId-only possible replacement', s => {
    const tx = s.packet.transactions[0]; tx.accountId = tx.account; delete tx.account;
    s.packet.transactions.push({ ...tx, id: 'synthetic-posted', pending: false });
  }],
  ['contradictory canonical cash/card aliases', s => {
    const tx = s.packet.transactions[0]; tx.atlasAccountId = 'chequing-a'; delete tx.accountRole;
  }],
  ['mapped-role contradictory canonical aliases', s => {
    s.packet.transactions[0].atlasAccountId = 'chequing-a';
  }],
  ['contradictory accountId alias', s => { s.packet.transactions[0].accountId = 'chequing-a'; }],
  ['reused identity', s => { s.packet.transactions.push({ ...s.packet.transactions[0], account: 'chequing-a' }); }],
  ['partial pending coverage', s => { s.packet.pendingCoverage = 'partial'; }],
  ['unknown pending coverage', s => { delete s.packet.pendingCoverage; }],
  ['truncated posted coverage', s => { s.packet.transactionCoverage = 'truncated'; }],
  ['late coverage start', s => { s.packet.coverageStart = '2026-08-19'; }],
  ['missing coverage start', s => { delete s.packet.coverageStart; }],
  ['stale coverage', s => { s.packet.coverageThrough = '2026-08-19'; }],
  ['stale observation', s => { s.packet.observationAsOf = '2026-08-19'; }],
  ['missing transaction evidence', s => { delete s.packet.transactions; }],
  ['possible replacement', s => { s.packet.transactions.push({ ...s.packet.transactions[0], id: 'synthetic-posted', pending: false }); }],
  ['provider duplicate flag', s => { s.packet.transactions[0].pendingPostedDuplicate = true; }],
  ['ambiguous directed replacement', s => { s.packet.transactions[0].pendingPostedAmbiguous = true; }],
  ['missing protected cost amount', s => { delete s.data.plan.commitments[0].amount; }],
  ['unknown income trust', s => { s.data.plan.income[0].confidence = 'unknown'; }],
  ['overdue protected cost', s => { s.data.plan.commitments[0].date = '2026-08-10'; }],
];
for (const [name, change] of negatives) {
  const s = state(); change(s);
  const result = nextFunding(run(s));
  assert.equal(result.status, 'unavailable', name);
  assert.equal(result.contribution, null, name + ' cannot release savings');
}
console.log('PASS pending-card Budget funding: known unambiguous facility exposure, per-card aggregate admission, pending/posted conservation, no double count, minimum, interest, utilization, provenance and fail-closed negatives');
