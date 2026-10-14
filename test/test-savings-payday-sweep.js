'use strict';
// Owner direction 2026-10-14 (Atlas assignment, Dale-confirmed): on each Dale
// payday the previous period's positive Bills surplus moves fully into
// projected Savings; the new paycheck stays in Bills; no part of the surplus
// is retained for future operating need; routine Bills deficits stay visible
// and are never covered automatically from Savings. This supersedes the
// PR #610 carry-first semantics (retention search + projected-Savings deficit
// coverage) wherever they conflict. All ledgers and literal expected cents
// are independently invented and hand-derived from the fixtures.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');
const deficitModel = require('./fixtures/savings-deficit-coverage-data');
const copy = x => JSON.parse(JSON.stringify(x));
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

test('control 1 recomputed: full prior surplus400 sweeps once at the next payday, not at its own close', () => {
  // PR #610 carry-first published Savings 700 / Bills 20 for this control.
  // Owner direction 2026-10-14: the 400 is still in Bills at the first close
  // and lands in Savings on the 2026-10-30 payday; the 200 bill then leaves a
  // visible Bills deficit that Savings does not cover.
  const a = advice(deficitModel(400)), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.status, 'ready', first.reason);
  assert.equal(first.stock, 500); assert.equal(first.contribution, 0); assert.equal(first.projectedContributions, 0);
  assert.equal(first.operatingCash, 420);
  assert.equal(second.status, 'ready', second.reason);
  assert.equal(second.stock, 900); assert.equal(second.contribution, 400); assert.equal(second.projectedContributions, 400);
  assert.equal(second.operatingCash, -180); assert.equal(second.projectedDeficitCoverage, 0);
  assert.equal(50000 + 40000, 90000, 'opening Savings plus the one swept surplus');
  assert.equal(2000 + 40000 - 20000 - 40000, -18000, 'Bills opening + receipt - bill - swept surplus');
});

test('the new paycheck stays in Bills and is never part of its own payday sweep', () => {
  const a = advice(input());
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(first.contribution, 0); assert.equal(first.projectedContributions, 0);
  assert.equal(first.operatingCash, 1080, 'the 1000 receipt that landed 2026-10-16 is Bills cash at that close');
  assert.equal(first.stock, 119);
  assert.equal(second.projectedContributions, 1000, 'only the first period surplus has swept by the second close');
  assert.equal(second.stock, 1119);
  assert.equal(third.projectedContributions, 2000, 'the second paycheck surplus sweeps at the third payday');
  assert.equal(third.stock, 2119);
  assert.equal(11900 + 100000 + 100000, 211900);
});

test('no retention cap: a known later deficit does not reduce the payday sweep', () => {
  // Carry-first retained 40 here (Savings 1079 / Bills 20) so the later 100
  // bill could not breach the floor. The full 1000 now sweeps and the deficit
  // is published instead of silently prevented.
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 100, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 1119);
  assert.equal(p.operatingCash, -20); assert.equal(p.projectedDeficitCoverage, 0);
  assert.equal(p.gap.date, '2026-11-03'); assert.equal(p.gap.signedOperatingCash, -20); assert.equal(p.gap.shortBy, 40);
  assert.equal(8000 + 100000 - 10000 - 100000, -2000, 'Bills opening + receipt - bill - full sweep');
});

test('control 2 recomputed: routine deficit stays visible and Savings is not drawn to cover it', () => {
  // PR #610 carry-first published Savings 400 / Bills 20 with projected
  // deficit coverage 100 for this control. Owner direction 2026-10-14:
  // Savings keeps the full swept surplus (500 + 100) and the 200 routine bill
  // leaves Bills at -180, shown explicitly; Dale decides how to fund it.
  const a = advice(deficitModel()), second = closing(a, '2026-10-30');
  assert.equal(second.status, 'ready', second.reason);
  assert.equal(second.stock, 600); assert.equal(second.operatingCash, -180);
  assert.equal(second.projectedDeficitCoverage, 0); assert.equal(second.projectedDraws, 0);
  assert.equal(second.gap.date, '2026-11-03'); assert.equal(second.gap.signedOperatingCash, -180);
  assert.equal(second.gap.shortBy, 200); assert.equal(second.gap.cashFloor, 20);
  assert.equal(second.items.reduce((sum, i) => sum + i.forecastSaved, 0) + second.unallocated, 600);
  assert.equal(second.actualSaved, null); assert.equal(second.moneyMovementPermission, 'not-granted');
  assert.equal(50000 + 10000, 60000, 'Savings opening plus swept surplus, untouched by the Bills deficit');
});

test('planned goal costs are deducted once and remaining funds spill to the earliest unfinished item', () => {
  const x = input(); x.plan.commitments[0].date = '2026-11-03'; x.plan.commitments[0].amount = 80;
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.projectedDraws, 80); assert.equal(p.stock, 1039);
  assert.deepEqual(p.items.map(i => [i.id, i.forecastSaved]), [['b', 1000]]);
  assert.equal(p.unallocated, 39);
  assert.equal(11900 + 100000 - 8000, 103900, 'opening + one landed sweep - the goal cost exactly once');
  const third = closing(advice(input()), '2026-11-13');
  assert.deepEqual(third.items.map(i => [i.id, i.forecastSaved]), [['a', 1500], ['b', 619]]);
  assert.deepEqual(third.rows.map(r => r.forecastContribution), [381, 619],
    'the payday tranche fills the earliest unfinished requirement first, then spills');
});

test('no duplicate carry or surplus across periods or navigation replay', () => {
  const a = advice(input()), before = copy(a.savingsFunding);
  const starts = ['2026-10-16', '2026-10-30', '2026-11-13'];
  const contributions = starts.map(s => closing(a, s).contribution);
  assert.deepEqual(contributions, [0, 1000, 1000]);
  assert.equal(contributions.reduce((sum, n) => sum + n, 0), 2000,
    'two period surpluses of 1000, each swept exactly once');
  for (const s of ['2026-11-13', '2026-10-16', '2026-11-13'])
    assert.deepEqual(copy(closing(a, s)), copy(closing(a, s)));
  assert.deepEqual(copy(a.savingsFunding), before, 'navigation never mutates the publication or balances');
});

test('current actuals and the current-period packet are unchanged by the sweep policy', () => {
  const a = advice(input());
  assert.equal(a.savingsFunding.stock.amount, 119);
  assert.deepEqual(a.savingsFunding.backing.items.map(i => i.saved), [119, 0]);
  assert.equal(a.savingsFunding.period.nativePeriodSurplus, 0);
  assert.equal(a.savingsFunding.period.projectedRemainingCapacity, 0);
  assert.equal(a.savingsFunding.period.alreadySavedIncome, 0);
  assert.equal(a.savingsFunding.period.transferred, 0);
  const currentView = a.savingsFunding.periodViews.find(v => v.role === 'current');
  const current = F.savingsFundingPublication(a.savingsFunding,
    { asOf: a.savingsFunding.asOf, advice: a, periodId: currentView.id });
  assert.equal(current.forecastClosing, undefined, 'the current period publishes evidence-based actuals only');
});

test('missing evidence stays unknown and a negative period balance is never swept', () => {
  const noReceipts = input(); delete noReceipts.opts.currentPeriodActuals;
  const unknown = closing(advice(noReceipts), '2026-10-30');
  assert.equal(unknown.status, 'unavailable'); assert.equal(unknown.stock, null);
  const undated = input(); delete undated.plan.commitments[1].date;
  assert.equal(closing(advice(undated), '2026-10-30').status, 'unavailable');
  const third = closing(advice(deficitModel()), '2026-11-13');
  assert.equal(third.status, 'ready', third.reason);
  assert.equal(third.stock, 600); assert.equal(third.contribution, 0); assert.equal(third.projectedContributions, 100,
    'the second period ran -100 net, so no sweep lands on 2026-11-13');
});
