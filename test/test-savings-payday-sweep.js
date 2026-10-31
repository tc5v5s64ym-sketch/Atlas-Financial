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

test('control 1 recomputed: full prior remainder (surplus400 + inherited 20) sweeps once at the next payday, not at its own close', () => {
  // PR #610 carry-first published Savings 700 / Bills 20 for this control.
  // Owner direction 2026-10-14: the 400 is still in Bills at the first close
  // and lands in Savings on the 2026-10-30 payday; the 200 bill then leaves a
  // visible Bills deficit that Savings does not cover.
  // S1 supersession (2026-10-14, via Atlas): the sweep is the period's FULL
  // available remainder, not its net surplus only — the inherited 20 of
  // opening Bills cash sweeps with the 400 surplus (sweep 420, was 400), so
  // Savings lands at 920 (was 900) and the published Bills deficit deepens
  // by the same 20 to -200 (was -180). Hand-derived: remainder of period
  // 2026-10-16 = 20 opening + 400 receipt = 420; Bills then runs
  // 420 - 420 swept - 200 bill = -200.
  const a = advice(deficitModel(400)), first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30');
  assert.equal(first.status, 'ready', first.reason);
  assert.equal(first.stock, 500); assert.equal(first.contribution, 0); assert.equal(first.projectedContributions, 0);
  assert.equal(first.operatingCash, 420);
  assert.equal(second.status, 'ready', second.reason);
  assert.equal(second.stock, 920); assert.equal(second.contribution, 420); assert.equal(second.projectedContributions, 420);
  assert.equal(second.operatingCash, -200); assert.equal(second.projectedDeficitCoverage, 0);
  assert.equal(50000 + 42000, 92000, 'opening Savings plus the one swept remainder');
  assert.equal(2000 + 40000 - 20000 - 42000, -20000, 'Bills opening + receipt - bill - swept remainder');
});

test('the new paycheck stays in Bills and is never part of its own payday sweep', () => {
  const a = advice(input());
  const first = closing(a, '2026-10-16'), second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(first.contribution, 0); assert.equal(first.projectedContributions, 0);
  assert.equal(first.operatingCash, 1080, 'the 1000 receipt that landed 2026-10-16 is Bills cash at that close');
  assert.equal(first.stock, 119);
  // S1 supersession: the first period's sweep is its full remainder —
  // 80 inherited opening cash + the 1000 receipt = 1080 (was the 1000 net
  // surplus only) — so the second close lands at 1199 (was 1119) and the
  // third at 2199 (was 2119). The paycheck that lands ON a payday is never
  // part of that payday's own sweep: the second period opens at 0 after
  // the first sweep, so its own sweep is exactly its 1000 receipt.
  assert.equal(second.projectedContributions, 1080, 'only the first period remainder (80 inherited + 1000 receipt) has swept by the second close');
  assert.equal(second.stock, 1199);
  assert.equal(third.projectedContributions, 2080, 'the second period remainder sweeps at the third payday');
  assert.equal(third.stock, 2199);
  assert.equal(11900 + 108000 + 100000, 219900);
});

test('no retention cap: a known later deficit does not reduce the payday sweep', () => {
  // Carry-first retained 40 here (Savings 1079 / Bills 20) so the later 100
  // bill could not breach the floor. The full 1000 now sweeps and the deficit
  // is published instead of silently prevented.
  // S1 supersession: the sweep is the full remainder 1080 (80 inherited +
  // 1000 receipt, was 1000), so Savings lands at 1199 (was 1119) and the
  // published Bills deficit at close is -100 (was -20):
  // 80 + 1000 - 100 bill - 1080 swept = -100.
  const x = input(); x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'deficit', label: 'Invented deficit bill', frequency: 'once', date: '2026-11-03', amount: 100, confidence: 'confirmed' }];
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.status, 'ready', p.reason); assert.equal(p.stock, 1199);
  assert.equal(p.operatingCash, -100); assert.equal(p.projectedDeficitCoverage, 0);
  // The dated gap is the FIRST floor breach: after the full sweep lands on
  // 2026-10-30, Bills sits at 0 — already 20 under the 20 floor — so the
  // breach dates to the payday itself (was the 2026-11-03 bill date, when
  // the smaller net-surplus sweep left Bills exactly at the floor).
  assert.equal(p.gap.date, '2026-10-30'); assert.equal(p.gap.signedOperatingCash, 0); assert.equal(p.gap.shortBy, 20);
  assert.equal(8000 + 100000 - 10000 - 108000, -10000, 'Bills opening + receipt - bill - full sweep');
});

test('control 2 recomputed: routine deficit stays visible and Savings is not drawn to cover it', () => {
  // PR #610 carry-first published Savings 400 / Bills 20 with projected
  // deficit coverage 100 for this control. Owner direction 2026-10-14:
  // Savings keeps the full swept surplus and the 200 routine bill leaves
  // Bills in deficit, shown explicitly; Dale decides how to fund it.
  // S1 supersession: the sweep is the full remainder 120 (20 inherited +
  // 100 surplus, was the 100 surplus only), so Savings lands at 620 (was
  // 600) and the published Bills deficit at close is -200 (was -180):
  // 20 + 100 - 200 bill - 120 swept = -200. The dated gap is the FIRST
  // floor breach, which now falls on the payday itself: the full sweep
  // leaves Bills at 0, already 20 under the 20 floor (gap was the
  // 2026-11-03 bill at -180 / shortBy 200, when the smaller sweep left
  // Bills exactly at the floor until the bill landed).
  const a = advice(deficitModel()), second = closing(a, '2026-10-30');
  assert.equal(second.status, 'ready', second.reason);
  assert.equal(second.stock, 620); assert.equal(second.operatingCash, -200);
  assert.equal(second.projectedDeficitCoverage, 0); assert.equal(second.projectedDraws, 0);
  assert.equal(second.gap.date, '2026-10-30'); assert.equal(second.gap.signedOperatingCash, 0);
  assert.equal(second.gap.shortBy, 20); assert.equal(second.gap.cashFloor, 20);
  assert.equal(second.items.reduce((sum, i) => sum + i.forecastSaved, 0) + second.unallocated, 620);
  assert.equal(second.actualSaved, null); assert.equal(second.moneyMovementPermission, 'not-granted');
  assert.equal(50000 + 12000, 62000, 'Savings opening plus swept remainder, untouched by the Bills deficit');
});

test('planned goal costs are deducted once and remaining funds spill to the earliest unfinished item', () => {
  // S1 supersession: the landed sweep is the first period's full remainder
  // 1080 (was 1000), so the pot after the one 80 goal cost is 1119 (was
  // 1039) with 119 unallocated (was 39). At the third close the pot is 2199
  // (was 2119): item a completes at 1500 and b spills to 699 (was 619);
  // the arrived 1000 tranche tops a up by 301 (1500 - 1199 already there,
  // was 381 = 1500 - 1119) and spills 699 to b.
  const x = input(); x.plan.commitments[0].date = '2026-11-03'; x.plan.commitments[0].amount = 80;
  const p = closing(advice(x), '2026-10-30');
  assert.equal(p.projectedDraws, 80); assert.equal(p.stock, 1119);
  assert.deepEqual(p.items.map(i => [i.id, i.forecastSaved]), [['b', 1000]]);
  assert.equal(p.unallocated, 119);
  assert.equal(11900 + 108000 - 8000, 111900, 'opening + one landed sweep - the goal cost exactly once');
  const third = closing(advice(input()), '2026-11-13');
  assert.deepEqual(third.items.map(i => [i.id, i.forecastSaved]), [['a', 1500], ['b', 699]]);
  assert.deepEqual(third.rows.map(r => r.forecastContribution), [301, 699],
    'the payday tranche fills the earliest unfinished requirement first, then spills');
});

test('no duplicate carry or surplus across periods or navigation replay', () => {
  const a = advice(input()), before = copy(a.savingsFunding);
  const starts = ['2026-10-16', '2026-10-30', '2026-11-13'];
  const contributions = starts.map(s => closing(a, s).contribution);
  // S1 supersession: the contributions are the two periods' full
  // remainders — 1080 (80 inherited + 1000) then 1000 — each swept exactly
  // once (was [0, 1000, 1000] / 2000 on the net-surplus measure).
  assert.deepEqual(contributions, [0, 1080, 1000]);
  assert.equal(contributions.reduce((sum, n) => sum + n, 0), 2080,
    'the two period remainders, each swept exactly once');
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
  // S1 supersession: the pot carries the first period's full swept
  // remainder 120 (was the 100 net surplus), so the third close is 620
  // (was 600); the second period closed with a negative remainder
  // (0 opening after the sweep, less the 200 bill), so no sweep lands on
  // 2026-11-13 and that deficit is never swept or covered.
  assert.equal(third.stock, 620); assert.equal(third.contribution, 0); assert.equal(third.projectedContributions, 120,
    'the second period closed with a negative remainder, so no sweep lands on 2026-11-13');
});
