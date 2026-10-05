'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const fixture = require('./fixtures/paid-actual-display-trust');
const clone = x => JSON.parse(JSON.stringify(x));
const cents = n => Math.round(n * 100);
function publication(data) {
  return F.recommend(data.plan, data.meta.asOf, { debts: data.debts,
    currentPeriodActuals: data.liveOverlay.currentPeriodActuals,
    operatingPlan: data.liveOverlay.operatingPlan, observedCash: data.liveOverlay.observedCash });
}
function row(data, id = 'invented-past-utility', date = '2026-08-07') {
  return publication(data).payPeriodViews.flatMap(p => p.bills).find(b => b.id === id && b.date === date);
}
function freeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; }
const data = fixture.served(), before = JSON.stringify(data);
for (const [id, date, actual] of [['invented-past-utility', '2026-08-07', 5983],
  ['invented-current-utility', '2026-08-19', 6127]]) {
  const b = row(data, id, date);
  assert.equal(b.status, 'PAID'); assert.equal(b.settlement, 'represented');
  assert.equal(cents(b.planned), 18361); assert.equal(cents(b.actual), actual);
  assert.equal(cents(b.movement), -actual); assert.equal(b.remaining, 0);
  assert.equal(b.confidence, 'estimated', 'future schedule confidence is not rewritten');
  assert.equal(b.displayAmountTrust, 'calculated', 'posted actual earns its own display trust');
  assert.equal(b.displayAmountBasis, 'posted-actual');
}
assert.equal(cents(data.plan.startingCash.breakdown.find(a => a.id === 'chequing-a').value), 115373);
assert.equal(15 * 100 + 260000 - 140000 - 6127, 115373, 'independent cash conservation');
assert.equal(cents(row(data).actual) + cents(row(data, 'invented-current-utility', '2026-08-19').actual), 12110,
  'independent two-receipt total retains both exact occurrence identities');
const future = row(data, 'invented-past-utility', '2026-09-07');
assert.equal(future.displayAmountTrust, 'estimated'); assert.equal(future.displayAmountBasis, 'schedule');
assert.equal(cents(future.movement), -18361); assert.equal(future.settlement, 'upcoming');
function withheld(label, change) {
  const d = clone(data); change(d.liveOverlay.currentPeriodActuals, d);
  const b = row(d); assert.ok(b, label + ': occurrence retained');
  assert.notEqual(b.displayAmountTrust, 'calculated', label + ': no unsupported exact actual');
  assert.equal(b.confidence, 'estimated');
}
for (const [label, change] of [
  ['pending', p => { p.transactions.find(t => t.date === '2026-08-07').pending = true; }],
  ['unknown transaction state', p => { delete p.transactions.find(t => t.date === '2026-08-07').pending; }],
  ['missing link', p => { delete p.representedActuals.find(r => r.id === 'invented-past-utility').transactionId; }],
  ['stale observation', p => { p.observationAsOf = '2026-08-19'; }],
  ['incomplete posted', p => { p.transactionCoverage = 'truncated'; }],
  ['unknown posted coverage', p => { p.transactionCoverage = 'unknown'; }],
  ['malformed posted coverage', p => { p.transactionCoverage = {}; }],
  ['contradictory posted coverage', p => { p.transactionCoverage = { complete: true, status: 'unknown' }; }],
  ['unknown pending', p => { p.pendingCoverage = 'unknown'; }],
  ['contradictory pending coverage', p => { p.pendingCoverage = { complete: true, status: 'unknown' }; }],
  ['outside coverage', p => { p.coverageStart = '2026-08-08'; }],
  ['missing coverage', p => { delete p.transactionCoverage; }],
  ['missing posted date', p => { delete p.representedActuals.find(r => r.id === 'invented-past-utility').postedOn; }],
  ['unmapped account', p => { p.transactions.find(t => t.date === '2026-08-07').accountRole = 'unmapped'; }],
  ['foreign units', p => { p.transactions.find(t => t.date === '2026-08-07').currency = 'usd'; }],
  ['missing units', p => { delete p.transactions.find(t => t.date === '2026-08-07').currency; }],
  ['contradictory transaction', p => { p.transactions.find(t => t.date === '2026-08-07').contradictoryEvidence = true; }],
  ['ambiguous replacement', p => { p.transactions.find(t => t.date === '2026-08-07').pendingPostedAmbiguous = true; }],
  ['conflicting transaction', p => { p.transactions.push({ ...p.transactions.find(t => t.date === '2026-08-07'), amount: 99 }); }],
  ['conflicting occurrence', p => { p.representedActuals.push({ ...p.representedActuals.find(r => r.id === 'invented-past-utility'), actual: 99 }); }],
  ['reused link', p => { p.representedActuals.push({ ...p.representedActuals.find(r => r.id === 'invented-past-utility'), id: 'other-occurrence' }); }],
  ['inconsistent plural link', p => { p.representedActuals.find(r => r.id === 'invented-past-utility').transactionIds = ['missing-transaction']; }],
  ['receipt sum differs', p => { p.transactions.find(t => t.date === '2026-08-07').amount = 59.84; }],
  ['opening only', p => { p.representedActuals = p.representedActuals.filter(r => r.id !== 'invented-past-utility'); }],
]) withheld(label, change);
const duplicates = clone(data), dp = duplicates.liveOverlay.currentPeriodActuals;
dp.transactions.push({ ...dp.transactions.find(t => t.date === '2026-08-07') });
dp.representedActuals.push({ ...dp.representedActuals.find(r => r.id === 'invented-past-utility') });
assert.equal(row(duplicates).displayAmountTrust, 'calculated', 'identical repeated records are counted once');
const explicit = clone(data);
explicit.liveOverlay.currentPeriodActuals.transactionCoverage = { complete: true, status: 'complete', truncated: false };
explicit.liveOverlay.currentPeriodActuals.pendingCoverage = { complete: true, status: 'complete' };
assert.equal(row(explicit).displayAmountTrust, 'calculated', 'explicit object completeness remains supported');
const split = fixture.served(x => {
  x.payload.transactions.find(t => t.id === 93001).amount = 25.19;
  x.payload.transactions.push({ ...x.payload.transactions.find(t => t.id === 93001), id: 93003, amount: 34.64 });
  Object.assign(x.identity.rules.find(r => r.eventId === 'invented-past-utility'),
    { settlesWhen: 'two-leg-sum', sameAccountSplitLegs: true });
});
assert.equal(cents(row(split).actual), 2519 + 3464, 'independent split receipt sum');
assert.equal(row(split).displayAmountTrust, 'calculated', 'native linked split earns exact display');
// Native observer rejection: neither units nor pending are supplied by a test adapter.
for (const [label, units] of [['foreign', 'usd'], ['missing', undefined]]) {
  const d = fixture.served(x => { const t = x.payload.transactions.find(t => t.id === 93001);
    if (units === undefined) delete t.currency; else t.currency = units; });
  assert.notEqual(row(d).displayAmountTrust, 'calculated', label + ' native observation');
}
freeze(data); publication(data); assert.equal(JSON.stringify(data), before, 'inputs stay immutable');
console.log('PASS independent posted actual display trust: history/current/future, exact cash/receipt identities, pending/unknown/conflicting/opening-only controls');
module.exports = { publication, row };
