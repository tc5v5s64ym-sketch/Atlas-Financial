'use strict';
/* Owner evidence checks are separate from the invented behavior ledger.
 * Held-elsewhere bills publish obligations without inventing a joint-cash
 * debit, revolving purchase, paid occurrence or future funding transfer.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const cents = value => Math.round(value * 100);
const clone = value => JSON.parse(JSON.stringify(value));
const specifications = [
  ['paramount-plus', 'Paramount+', 1343, 12, '2026-10-12'],
  ['stacktv', 'STACKTV', 1679, 22, '2026-10-22'],
  ['prime-video-ad-free', 'Prime Video ad-free', 335, 25, '2026-10-25'],
  ['crave-standard-ads', 'Crave Standard with ads', 1343, 9, '2026-11-09'],
];
const ids = new Set(specifications.map(row => row[0]));
const rows = data.plan.bills.filter(row => ids.has(row.id));
assert.equal(rows.length, 4, 'four separate owner-approved bill identities');
assert(data.plan.startingCash.heldElsewhere.some(row => row.id === 'wise'),
  'Wise is an incumbent held-elsewhere identity');
for (const [id, label, amount, day, firstDue] of specifications) {
  const matches = rows.filter(row => row.id === id);
  assert.equal(matches.length, 1, `${id}: no duplicate`);
  const row = matches[0];
  assert.deepEqual([row.label, cents(row.amount), row.frequency, row.day, row.firstDue],
    [label, amount, 'monthly', day, firstDue], `${id}: delegated receipt and forward activation`);
  assert.equal(row.confidence, 'estimated');
  assert.equal(row.dateConfidence, 'estimated');
  assert.equal(row.budgetCategory, 'subscriptions');
  assert.equal(row.subscription, true);
  assert.equal(row.householdObligation, true);
  assert.equal(row.payingAccount, 'wise');
  assert.equal(row.jointCash, false);
  assert.equal(F.isCardPaidBill(row, data.plan), false, `${id}: not revolving card debt`);
  assert.equal(F.billAffectsJointCash(row, data.plan), false, `${id}: outside joint chequing`);
  for (const field of ['settledOn', 'paid', 'paidOn', 'representedEvents', 'merchantKeys', 'noPaymentRequiredOn']) {
    assert.equal(Object.hasOwn(row, field), false, `${id}: no fabricated posting/settlement identity`);
  }
}
assert.equal(rows.reduce((sum, row) => sum + cents(row.amount), 0), 4700,
  'independent receipt cents: 1343 + 1679 + 335 + 1343 = 4700');
const prime = data.plan.bills.filter(row => row.id === 'amazon-prime');
assert.equal(prime.length, 1);
assert.deepEqual([cents(prime[0].amount), prime[0].frequency, prime[0].day, prime[0].firstDue,
  prime[0].payingAccount, prime[0].jointCash, prime[0].confidence],
  [1119, 'monthly', 19, '2026-09-19', 'travelvisa', false, 'confirmed'],
  'Amazon Prime membership remains separate and unchanged');
assert(!F.expandEvents(data.plan, '2026-08-19', '2026-10-10').some(event => ids.has(event.id)),
  'receipt history is not backfilled as scheduled charges or arrears');
assert(!(data.plan.opening.representedEvents || []).some(event => ids.has(event.id)),
  'receipt and funding evidence do not create paid markers');
const inventory = F.householdSubscriptions(data.plan, '2026-10-10');
const addedInventory = inventory.subscriptions.filter(row => ids.has(row.id));
assert.equal(addedInventory.length, 4);
assert.equal(addedInventory.reduce((sum, row) => sum + cents(row.monthlyEquivalent), 0), 4700);
assert.deepEqual(addedInventory.map(row => [row.id, row.nextDate, row.confidence]),
  specifications.map(([id, , , , date]) => [id, date, 'estimated']),
  'the incumbent live subscription consumer carries estimated next dates');
const identity = JSON.parse(fs.readFileSync(path.join(root, 'docs/connectivity/transaction-identity.json'), 'utf8'));
for (const id of ids) assert(!JSON.stringify(identity).includes('"' + id + '"'),
  `${id}: no invented provider settlement mapping`);
console.log('PASS owner receipt/input contract, independent total, separate Prime and no history/paid rewrite');

// Invented values, dates and labels: behavior is not specified by live cents.
const syntheticRows = [
  ['stream-a', 7.11, 5, '2031-04-05'],
  ['stream-b', 9.22, 14, '2031-04-14'],
  ['stream-c', 1.33, 21, '2031-04-21'],
  ['stream-d', 7.11, 3, '2031-05-03'],
].map(([id, amount, day, firstDue]) => ({id, label: id, amount, day, firstDue,
  frequency: 'monthly', confidence: 'estimated', dateConfidence: 'estimated',
  householdObligation: true, payingAccount: 'wise', jointCash: false,
  budgetCategory: 'subscriptions', subscription: true}));
const plan = {
  defaults: { targetBuffer: 0 },
  startingCash: { breakdown: [{id: 'chequing-a', value: 1000}],
    heldElsewhere: [{id: 'wise', value: 2}] },
  opening: { asOf: '2031-04-04', representedEvents: [] },
  income: [], obligations: [], commitments: [], bills: syntheticRows,
};
const original = clone(plan);
const expected = [
  ['stream-a', '2031-04-05', -711], ['stream-b', '2031-04-14', -922],
  ['stream-c', '2031-04-21', -133], ['stream-d', '2031-05-03', -711],
  ['stream-a', '2031-05-05', -711], ['stream-b', '2031-05-14', -922],
  ['stream-c', '2031-05-21', -133],
];
const events = F.expandEvents(plan, '2031-04-04', '2031-05-31');
assert.deepEqual(events.map(event => [event.id, event.date, cents(event.amount)]), expected,
  'hand-listed monthly calendar activates each occurrence once');
assert.equal(events.reduce((sum, event) => sum - cents(event.amount), 0), 4243,
  'independent two-month ledger: 1766 + 2477 = 4243 cents');
assert(events.every(event => event.kind === 'bill' && event.householdObligation === true
  && event.jointCash === false && event.cardPaid === false && event.confidence === 'estimated'));
assert.equal(F.expandEvents(plan, '2031-03-01', '2031-04-04').length, 0,
  'no retroactive receipt occurrence');
const opts = { viewDays: 58, horizonDays: 58, weeklyVariable: 0, targetBuffer: 0 };
const sim = F.simulate(plan, '2031-04-04', opts);
assert.equal(cents(sim.ending), 100000, 'held Wise balance does not fund or withdraw joint cash');
assert.equal(cents(sim.totals.bills), 0);
assert.equal(cents(sim.totals.reserved), 0, 'Wise is not card-paid backfill gravity');
assert.equal(cents(sim.totals.income), 0);
assert.equal(sim.events.length, 7, 'the schedule retains every household obligation');
const subs = F.householdSubscriptions(plan, '2031-04-04');
assert.equal(cents(subs.monthlyEquivalentTotal), 2477);
assert.equal(subs.subscriptions.length, 4);
assert(subs.subscriptions.every(row => row.confidence === 'estimated'));

// Same-day funding is source-only; a small or stale held balance is not proof
// of settlement. Advancing the start does not pretend the new cycle is paid.
const after = clone(plan);
after.opening.asOf = '2031-05-04';
const later = F.expandEvents(after, '2031-05-04', '2031-06-03');
assert.deepEqual(later.map(event => [event.id, event.date, cents(event.amount)]), [
  ['stream-a', '2031-05-05', -711], ['stream-b', '2031-05-14', -922],
  ['stream-c', '2031-05-21', -133], ['stream-d', '2031-06-03', -711],
]);
assert.deepEqual(plan, original, 'consumers do not mutate source or history');

// A separately card-paid membership still reserves its own cost exactly once.
const withMembership = clone(plan);
withMembership.bills.push({id:'membership', label:'Synthetic membership', amount:4.56,
  frequency:'monthly', day:18, firstDue:'2031-04-18', confidence:'confirmed',
  budgetCategory:'subscriptions', payingAccount:'card-one', jointCash:false});
const membershipSim = F.simulate(withMembership, '2031-04-04', opts);
assert.equal(cents(membershipSim.totals.reserved), 912, 'two distinct membership reserves, 456 + 456');
assert.equal(cents(membershipSim.totals.bills), 0, 'no duplicated cash purchase');
assert.equal(cents(F.householdSubscriptions(withMembership, '2031-04-04').monthlyEquivalentTotal), 2933,
  '2477 streaming + 456 membership = 2933 cents');

// Removing held-elsewhere attribution makes explicit jointCash:false a card
// reserve. This control detects incorrectly inventing a revolving payer.
const wrongPayer = clone(plan);
wrongPayer.bills.forEach(row => { row.payingAccount = 'unknown-instrument'; });
assert(wrongPayer.bills.every(row => F.isCardPaidBill(row, wrongPayer)));
assert.equal(cents(F.simulate(wrongPayer, '2031-04-04', opts).totals.reserved), 4243,
  'negative control: unsupported instrument cannot masquerade as held Wise cash');
console.log('PASS independent held-elsewhere calendar/cash/inventory ledger and negative controls');
