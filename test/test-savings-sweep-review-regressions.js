'use strict';
// Systems Review BLOCK on PR #616 head 21636a13 (Atlas, Slack ts
// 1792022153.928649) — three reproduced findings, each pinned here with
// independently hand-derived ledgers:
// (1) the sweep must require actual positive AVAILABLE prior-period Bills
//     cash, not merely a positive period net: a period whose net is positive
//     but whose closing Bills position is still negative (or smaller than
//     the net, after carrying an earlier deficit) sweeps only the cash that
//     actually exists at its close — no future-needs retention is added.
// (2) only the UNSPENT part of an arrived sweep can be attributed to
//     remaining goals: when a due goal consumed part of the arrived sweep,
//     the remainder goals' forecastContribution is the unspent remainder,
//     never the full arrival.
// (3) is pinned at the surface in browser-savings-future-closing.js (the
//     ready close already owns operatingCash + gap; the surfaces must print
//     them). The packet half of that contract is asserted in case (2)'s
//     fixture below: a ready close carries its signed Bills position and its
//     dated uncovered gap.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');
const deficitModel = require('./fixtures/savings-deficit-coverage-data');
function advice(x) {
  const before = JSON.stringify(x), result = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input, settlement or source mutation');
  return result;
}
function closing(a, start) {
  const view = a.savingsFunding.periodViews.find(p => p.start === start);
  assert.ok(view, 'selected native period exists');
  const p = F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id });
  assert.ok(p.forecastClosing, 'Forecast owns the selected-period closing projection');
  return p.forecastClosing;
}

test('finding 1: a positive period net sweeps only the Bills cash actually available at its close', () => {
  // Ledger: Bills opens 80, Savings 119. Period 1 (10-16): +1000 receipt,
  // -1150 bill on 10-20 -> period net -150 (no sweep) and Bills closes at
  // -70. Period 2 (10-30): +1000 receipt -> period net +1000, but the cash
  // actually available at its close is 80 + 1000 - 1150 + 1000 = 930, so
  // only 930 lands on the 2026-11-13 payday. Head 21636a13 swept the full
  // 1000 net (third close 1119); the available-cash bound gives 1049.
  const x = input();
  x.plan.bills = [{ id: 'early', label: 'Invented first-period bill', frequency: 'once',
    date: '2026-10-20', amount: 1150, confidence: 'confirmed' }];
  const a = advice(x);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(first.status, 'ready', first.reason);
  assert.equal(first.stock, 119); assert.equal(first.contribution, 0);
  assert.equal(first.operatingCash, -70, 'Bills carried the first-period deficit openly');
  assert.equal(first.gap.date, '2026-10-20'); assert.equal(first.gap.signedOperatingCash, -70);
  assert.equal(first.gap.shortBy, 90); assert.equal(first.gap.cashFloor, 20);
  assert.equal(second.status, 'ready', second.reason);
  assert.equal(second.stock, 119); assert.equal(second.contribution, 0);
  assert.equal(second.projectedContributions, 0, 'the first period swept nothing');
  assert.equal(second.operatingCash, 930, 'the second close holds the cash that actually exists');
  assert.equal(second.gap, undefined, 'the landed receipt restored Bills above its floor');
  assert.equal(third.status, 'ready', third.reason);
  assert.equal(third.contribution, 930, 'the sweep is the available cash, not the +1000 period net');
  assert.equal(third.projectedContributions, 930);
  assert.equal(third.stock, 1049); assert.equal(third.operatingCash, 0);
  assert.deepEqual(third.items.map(i => [i.id, i.forecastSaved]), [['a', 1049], ['b', 0]]);
  assert.deepEqual(third.rows.map(r => r.forecastContribution), [930, 0]);
  assert.equal(8000 + 100000 - 115000 + 100000, 93000, 'Bills cash that exists at the second close');
  assert.equal(11900 + 93000, 104900, 'opening Savings plus the one available-cash sweep');
});

test('finding 1 (zero case): a positive period net sweeps nothing while closing Bills cash is still negative', () => {
  // Same ledger with a 2150 first-period bill: Bills closes period 1 at
  // -1070; period 2 nets +1000 yet still closes at -70, so no cash exists
  // to sweep on 2026-11-13. Head 21636a13 swept the full 1000 net anyway.
  const x = input();
  x.plan.bills = [{ id: 'early', label: 'Invented first-period bill', frequency: 'once',
    date: '2026-10-20', amount: 2150, confidence: 'confirmed' }];
  const a = advice(x);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(first.operatingCash, -1070);
  assert.equal(first.gap.date, '2026-10-20'); assert.equal(first.gap.signedOperatingCash, -1070);
  assert.equal(first.gap.shortBy, 1090);
  assert.equal(second.operatingCash, -70, 'the +1000 net only partly repaired the carried deficit');
  assert.equal(second.gap.date, '2026-10-30'); assert.equal(second.gap.signedOperatingCash, -70);
  assert.equal(second.gap.shortBy, 90);
  assert.equal(third.contribution, 0, 'no positive available cash, no sweep');
  assert.equal(third.projectedContributions, 0);
  assert.equal(third.stock, 119); assert.equal(third.operatingCash, -70);
  assert.deepEqual(third.rows.map(r => r.forecastContribution), [0, 0]);
  assert.equal(8000 + 100000 - 215000 + 100000, -7000, 'Bills is still negative at the second close');
});

test('finding 2: only the unspent sweep is attributed to remaining goals after a due goal consumed it', () => {
  // Ledger (deficitModel, stock 50): period 1 surplus 100 sweeps in on
  // 2026-10-30. Goal a (120, due 2026-11-04) is paid from the pot during
  // period 2: prior funds 50 cover 50 of it, the arrived sweep covers 70,
  // so only 30 of the sweep remains for the remaining goal b. The pot
  // closes at 50 + 100 - 120 = 30. Head 21636a13 attributed the full
  // arrived 100 to b (forecastContribution 100 against a 30 pot).
  const x = deficitModel(100, 200, 50);
  x.plan.commitments[0].date = '2026-11-04'; x.plan.commitments[0].amount = 120;
  const a = advice(x);
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.stock, 50); assert.equal(first.contribution, 0);
  const p = second;
  assert.equal(p.status, 'ready', p.reason);
  assert.equal(p.contribution, 100, 'the full prior surplus still lands on the payday');
  assert.equal(p.projectedDraws, 120, 'the due goal cost is debited once');
  assert.equal(p.stock, 30); assert.equal(p.unallocated, 0);
  assert.deepEqual(p.items.map(i => [i.id, i.forecastSaved]), [['b', 30]]);
  assert.deepEqual(p.rows.map(r => r.forecastContribution), [30],
    'only the unspent 30 of the arrived sweep contributes to the remaining goal');
  assert.equal(5000 + 10000 - 12000, 3000, 'opening pot plus sweep minus the due goal paid once');
  // Finding 3 packet contract on this same ready close: the signed Bills
  // position and the dated uncovered gap ride the close for the surfaces.
  assert.equal(p.operatingCash, -180, 'signed Bills position at the close');
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.signedOperatingCash, -180);
  assert.equal(p.gap.shortBy, 200); assert.equal(p.gap.cashFloor, 20);
  assert.equal(p.projectedDeficitCoverage, 0);
});
