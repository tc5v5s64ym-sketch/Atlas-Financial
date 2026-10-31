'use strict';
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const { fixture } = require('./fixtures/bills-header-payments-data');
const publish = x => F.budgetPeriodProgress(x.plan, x.asOf, x.period, { currentPeriodActuals: x.packet });
let checks = 0;
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const x = fixture(), before = JSON.stringify(x);
const progress = F.budgetPeriodProgress(x.plan, x.asOf, x.period, { currentPeriodActuals: x.packet });
assert.equal(progress.bills.actual.amount, 317.62,
  'recorded bill 139.73 plus posted minimum sends 67.43 + 81.29 + 29.17; null legacy actual must not hide cash sent');
assert.equal(progress.bills.planned.amount, 269.94, 'original requirements 139.73 + 40.05 + 70.07 + 20.09');
assert.equal(JSON.stringify(x), before, 'publication does not mutate evidence');
eq(progress.bills.actual.completeness, 'complete', 'all four independently established amounts');
eq(progress.bills.actual.evidence.filter(r => r.kind === 'minimum-cash-sent').map(r => r.actual),
  [67.43, 81.29, 29.17], 'native payment cents, not requirement cents');
for (const [name, mutate, expected, completeness] of [
  ['partial send', y => { y.plan.obligations[0].sentPayments[0].amount = 11.19; }, 261.38, 'complete'],
  ['overpayment', y => { y.plan.obligations[0].sentPayments[0].amount = 140; }, 390.19, 'complete'],
  ['unknown requirement', y => { y.period.bills[1].planned = null; }, 317.62, 'complete'],
  ['unknown issuer receipt', y => { y.plan.opening.representedEvents = y.plan.opening.representedEvents.filter(r => r.id !== 'invented-minimum-0');
    Object.assign(y.period.bills[1], { status: 'unconfirmed', settlement: 'unverified' }); }, 317.62, 'partial'],
  ['unknown cash inclusion', y => { delete y.plan.obligations[0].sentPayments[0].cashIncludedAsOf; }, 317.62, 'partial'],
  ['pending', y => { y.plan.obligations[0].sentPayments[0].pending = true; }, 250.19, 'partial'],
  ['withdrawn confirmation', y => { y.plan.obligations[0].sentPayments[0].confirmed = false; }, 250.19, 'partial'],
  ['returned amount', y => { y.plan.obligations[0].sentPayments[0].amount = -67.43; }, 250.19, 'partial'],
  ['unknown intent', y => { y.plan.obligations[0].sentPayments[0].intent = 'unconfirmed'; }, 250.19, 'partial'],
  ['purchase backfill', y => { y.plan.obligations[0].sentPayments[0].intent = 'purchase-backfill'; }, 250.19, 'partial'],
  ['wrong funding account', y => { y.plan.obligations[0].sentPayments[0].fundingAccountId = 'chequing-b'; }, 250.19, 'partial'],
  ['non CAD', y => { y.plan.obligations[0].sentPayments[0].currency = 'usd'; }, 250.19, 'partial'],
  ['fractional cents', y => { y.plan.obligations[0].sentPayments[0].amount = 67.431; }, 250.19, 'partial'],
  ['future send', y => { y.plan.obligations[0].sentPayments[0].postedOn = '2026-08-21';
    y.plan.obligations[0].sentPayments[0].cashIncludedAsOf = '2026-08-21'; }, 250.19, 'partial'],
  ['future receipt', y => { y.plan.opening.representedEvents.find(r => r.id === 'invented-minimum-0').effectiveAsOf = '2026-08-21'; }, 317.62, 'partial'],
  ['reused debit', y => { y.plan.obligations[0].sentPayments.push({ ...y.plan.obligations[0].sentPayments[0], amount: 1 }); }, 250.19, 'partial'],
  ['reused competing purpose', y => { y.plan.obligations[0].sentPayments.push({ ...y.plan.obligations[0].sentPayments[0], intent: 'purchase-backfill' }); }, 250.19, 'partial'],
  ['legacy actual also present', y => { y.period.bills[1].actual = 999.99; }, 317.62, 'complete'],
  ['forged display cash', y => { y.period.bills[1].cashPaid = 999.99; }, 317.62, 'complete'],
  ['duplicate occurrence row', y => { y.period.bills.push({ ...y.period.bills[1] }); }, 317.62, 'partial'],
  ['additional posted allocation', y => { y.plan.obligations[0].sentPayments.push({ ...y.plan.obligations[0].sentPayments[0], debitId: 'invented-split', amount: 9.31 }); }, 326.93, 'complete'],
  ['additional pending allocation', y => { y.plan.obligations[0].sentPayments.push({ ...y.plan.obligations[0].sentPayments[0], debitId: 'invented-pending', amount: 9.31, pending: true }); }, 317.62, 'partial'],
  ['wrong cycle', y => { y.plan.obligations[0].sentPayments[0].scheduledDate = '2026-07-24'; }, 250.19, 'partial'],
  ['wrong due identity', y => { y.period.bills[1].date = '2026-08-23'; }, 250.19, 'partial'],
  ['not relied upon', y => { y.period.bills[1].notReliedUpon = true; }, 250.19, 'partial'],
]) {
  const y = fixture(); mutate(y); const input = JSON.stringify(y), p = publish(y);
  eq(p.bills.actual.amount, expected, name + ': independently reconciled subtotal');
  eq(p.bills.actual.completeness, completeness, name + ': evidence state');
  if (!['unknown requirement', 'duplicate occurrence row'].includes(name)) eq(p.bills.planned.amount, 269.94, name + ': original requirements unchanged');
  eq(JSON.stringify(y), input, name + ': read only');
}
for (const mutate of [y => { y.packet = null; }, y => { y.packet.transactionCoverage = 'truncated'; },
  y => { y.packet.coverageStart = '2026-08-15'; }, y => { y.period.operatingPlanUnavailable = true; },
  y => { y.period.projected = true; }, y => { y.packet.transactions = [{ date: y.asOf, amount: null }]; }]) {
  const y = fixture(); mutate(y); eq(publish(y).bills.actual.amount, null, 'coverage/future/operating guard remains authoritative');
}
const moved = fixture();
moved.plan.obligations[0].statementOccurrences = [{ scheduledDate: '2026-08-24', dueDate: '2026-08-27',
  minimum: 40.05, currency: 'cad', confidence: 'confirmed' }];
moved.period.bills[1].date = '2026-08-27';
eq(publish(moved).bills.actual.amount, 317.62, 'statement due replacement counts original identity once');
const history = fixture(); history.asOf = '2026-08-30'; history.packet.observationAsOf = history.asOf;
history.packet.coverageThrough = history.asOf;
history.plan.obligations[0].sentPayments[0].postedOn = '2026-08-28';
history.plan.obligations[0].sentPayments[0].cashIncludedAsOf = '2026-08-28';
eq(publish(history).bills.actual.amount, 250.19, 'later payment cannot rewrite a completed period at its boundary');
const outOfPeriod = fixture(); outOfPeriod.period.bills = outOfPeriod.period.bills.filter(r => r.id !== 'invented-minimum-2');
eq(publish(outOfPeriod).bills.actual.amount, 288.45, 'payment for another selected occurrence is excluded');
eq(publish(outOfPeriod).bills.planned.amount, 249.85, 'same selected original requirements');
console.log('PASS Bills header native payments, independent cents, original requirements, boundaries, purpose/identity and uncertainty (' + (checks + 3) + ' assertions)');
