'use strict';
// S1 acceptance (owner direction 2026-10-14 via Atlas, superseding PR #616
// where they conflict): on each Dale payday the sweep is the prior period's
// FULL positive available Bills remainder — inherited positive cash
// included, the new paycheck and other chequing accounts excluded — and
// the Future Budget opening consumes exactly the same published sweep the
// Savings closing projection credits. One Forecast-owned figure,
// `paydaySweep`, is published on each waterfall period and consumed by
// both sides. Negative Bills cash remains visible; nothing is held back
// and Savings is never drawn to cover a Bills deficit. All ledgers and
// literal expected values are independently invented and hand-derived
// from the fixtures; several cases below fail on the pre-S1 base (the
// net-surplus sweep credited less than the Budget remainder carried).
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');
const deficitModel = require('./fixtures/savings-deficit-coverage-data');
const ownerModel = require('./fixtures/savings-owner-closing-data');
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
function viewAt(a, start) {
  const v = (a.payPeriodViews || []).find(p => p.start === start);
  assert.ok(v, 'Budget timeline period exists for ' + start);
  return v;
}

test('surplus-only: with no inherited cash the sweep is exactly the period net', () => {
  // Opening 0, receipt 100, later bill 200. Remainder = 0 + 100 = 100.
  const a = advice(deficitModel(100, 200, 500, 0));
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 100);
  assert.equal(viewAt(a, '2026-10-30').opening, 0, 'the sweep leaves Bills; nothing was inherited to leave behind');
  const second = closing(a, '2026-10-30');
  assert.equal(second.contribution, 100); assert.equal(second.stock, 600);
});

test('inherited positive cash sweeps in full with a positive period net', () => {
  // Opening 20, receipt 400: remainder 420 (the pre-S1 net-surplus sweep
  // credited only 400 and left the 20 counted in both publications).
  const a = advice(deficitModel(400));
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 420);
  assert.equal(viewAt(a, '2026-10-30').opening, 0);
  const second = closing(a, '2026-10-30');
  assert.equal(second.contribution, 420); assert.equal(second.stock, 920);
});

test('inherited positive cash sweeps in full with a zero period net', () => {
  // Opening 150, no receipts and no bills: the period net is 0, yet the
  // full 150 of inherited cash is the available remainder and sweeps.
  const a = advice(deficitModel(0, 0, 500, 150));
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 150);
  assert.equal(viewAt(a, '2026-10-30').opening, 0);
  const second = closing(a, '2026-10-30');
  assert.equal(second.contribution, 150); assert.equal(second.stock, 650);
  assert.equal(closing(a, '2026-11-13').stock, 650, 'nothing further sweeps from an empty remainder');
});

test('inherited positive cash sweeps with a negative period net', () => {
  // Opening 150, receipt 100, bill 200 inside the same period: the period
  // net is -100, but the available remainder is +50 and sweeps in full.
  // (The net-surplus measure swept 0 here.)
  const x = deficitModel(100, 200, 500, 150); x.plan.bills[0].date = '2026-10-20';
  const a = advice(x);
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 50);
  assert.equal(viewAt(a, '2026-10-30').opening, 0);
  const second = closing(a, '2026-10-30');
  assert.equal(second.contribution, 50); assert.equal(second.stock, 550);
});

test('negative prior remainder sweeps nothing, stays visible, and Savings is not drawn', () => {
  // Period 2 runs 0 opening (after the sweep) - 200 bill = -200 remainder.
  const a = advice(deficitModel());
  assert.equal(viewAt(a, '2026-10-30').paydaySweep, 0, 'a negative remainder publishes a zero sweep, not a draw');
  assert.equal(viewAt(a, '2026-11-13').opening, -200, 'the negative remainder carries into the next Budget opening in full');
  const second = closing(a, '2026-10-30'), third = closing(a, '2026-11-13');
  assert.equal(second.operatingCash, -200, 'the signed Bills position is published on the close');
  assert.equal(second.projectedDeficitCoverage, 0); assert.equal(third.projectedDeficitCoverage, 0);
  assert.equal(third.contribution, 0, 'no sweep lands on 2026-11-13');
  assert.equal(third.stock, 620, 'Savings is unchanged by the Bills deficit — no automatic draw');
});

test('other chequing accounts are excluded from the sweep and unchanged by it', () => {
  // The anchor plan carries a second chequing row (chequing-b). The
  // published sweep and the Budget openings are computed from the Bills
  // account chain only: they are identical whether chequing-b holds 0
  // or 777, and no figure credits the other account to Savings. (An
  // unevidenced 777 also fails the current-cash reconciliation and the
  // closes withhold — the money is never treated as sweepable Bills
  // cash, which is the same exclusion seen from the evidence side.)
  const base = advice(input());
  const x = input(); x.plan.startingCash.breakdown[1].value = 777;
  const other = advice(x);
  for (const start of ['2026-10-16', '2026-10-30', '2026-11-13']) {
    assert.equal(viewAt(other, start).paydaySweep, viewAt(base, start).paydaySweep, 'sweep unchanged at ' + start);
    assert.equal(viewAt(other, start).opening, viewAt(base, start).opening, 'Budget opening unchanged at ' + start);
  }
  assert.equal(viewAt(base, '2026-10-16').paydaySweep, 1080, 'the sweep is the Bills remainder only');
  assert.equal(x.plan.startingCash.breakdown[1].value, 777, 'the other account is not mutated');
});

test('the new paycheck is excluded from its own payday sweep', () => {
  const a = advice(input());
  // The sweep published on the 2026-10-30 period is that period's own
  // remainder (its 1000 receipt alone): not the 1080 arriving that day
  // from the prior period, and not any later receipt.
  assert.equal(viewAt(a, '2026-10-30').paydaySweep, 1000);
  assert.equal(viewAt(a, '2026-10-30').opening, 0,
    'the prior sweep has already left Bills before this period\u2019s paycheck lands');
  // What lands ON 2026-10-30 in Savings is the prior period's remainder.
  assert.equal(closing(a, '2026-10-30').contribution, 1080);
});

test('missing evidence stays unknown: no close publishes an invented sweep', () => {
  const unknownBill = input();
  unknownBill.plan.bills = [{ id: 'unknown', frequency: 'once', date: '2026-10-20', amount: null }];
  const p = closing(advice(unknownBill), '2026-10-30');
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
  const noReceipts = input(); delete noReceipts.opts.currentPeriodActuals;
  const q = closing(advice(noReceipts), '2026-10-30');
  assert.equal(q.status, 'unavailable'); assert.equal(q.stock, null);
});

test('repeated evaluation and navigation replay are immutable', () => {
  const x = input(), before = JSON.stringify(x);
  const a = advice(x);
  const starts = ['2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27'];
  const firstPass = starts.map(s => copy(closing(a, s)));
  const shuffled = ['2026-11-13', '2026-10-16', '2026-11-27', '2026-10-30'].map(s => copy(closing(a, s)));
  assert.deepEqual(shuffled, [firstPass[2], firstPass[0], firstPass[3], firstPass[1]],
    'close values do not depend on navigation order or repetition');
  const a2 = advice(copy(x));
  assert.deepEqual(starts.map(s => copy(closing(a2, s))), firstPass, 'a fresh evaluation reproduces every close');
  assert.deepEqual(starts.map(s => viewAt(a2, s).paydaySweep), starts.map(s => viewAt(a, s).paydaySweep),
    'the published sweeps are identical across evaluations');
  assert.equal(JSON.stringify(x), before, 'evaluation never mutates the plan or its history');
});

test('goals and the sweep are each counted once', () => {
  // Anchor goals: the 1500 goal due 2026-12-18 is debited exactly once,
  // at its own close; cumulative contributions are the two landed
  // remainders (1080 + 1000), each credited once.
  const a = advice(input());
  const last = closing(a, '2026-12-11');
  assert.equal(last.projectedContributions, 2080);
  assert.equal(last.projectedDraws, 1500);
  assert.equal(last.stock, 699);
  assert.equal(11900 + 208000 - 150000, 69900, 'opening stock + two sweeps - the one goal cost');
  // Annual-goal shape: Budget already deducted the 500 goal bill inside
  // the first period's remainder, and the Savings ledger debits it as a
  // goal cost — the overlap restoration returns the deduction to the
  // sweep (bounded by the cash that exists, 480), so the cost is paid
  // once across both ledgers and the pot conserves to the cent.
  const y = ownerModel(); y.plan.commitments.shift();
  y.plan.bills = [{ id: 'a', label: 'Invented annual goal', frequency: 'yearly', month: 10, day: 21,
    firstDue: '2026-10-21', amount: 500, confidence: 'confirmed', jointCash: false }];
  const third = closing(advice(y), '2026-11-13');
  assert.equal(third.projectedDraws, 900, 'the annual goal (500) and commitment b (400) are each debited once');
  assert.equal(third.projectedContributions, 860, 'the two credited sweeps (480 + 380), each once');
  assert.equal(third.stock, 260);
  assert.equal(30000 + 48000 + 38000 - 50000 - 40000, 26000);
});

test('Budget and Savings agree across multiple future periods', () => {
  // For every future seam in these fixtures (no goal bills inside the
  // Budget bill load, no household hold): the Savings contribution that
  // lands on a payday equals the sweep the Budget waterfall published on
  // the prior period, and the next Budget opening equals that period's
  // remainder minus the same sweep (a negative remainder carries whole).
  let seams = 0;
  for (const x of [input(), deficitModel(), deficitModel(400)]) {
    const a = advice(x);
    const views = (a.payPeriodViews || [])
      .filter(v => ['next', 'future'].includes(v.timelineRole) && v.start <= '2026-11-27');
    for (let i = 0; i + 1 < views.length; i++) {
      const period = views[i], next = views[i + 1];
      assert.notEqual(period.paydaySweep, null, 'sweep published for ' + period.start);
      const remainder = period.opening + period.incomeAdded - period.periodBillLoad - (period.budgetHold || 0);
      assert.equal(period.paydaySweep, Math.max(0, remainder), 'published sweep is the full positive remainder at ' + period.start);
      assert.equal(next.opening, remainder - period.paydaySweep, 'Budget opening consumes the same sweep at ' + period.start);
      const close = closing(a, next.start);
      if (close.status === 'ready') {
        assert.equal(close.contribution, period.paydaySweep,
          'Savings credits exactly the published sweep at ' + next.start);
        seams++;
      }
    }
  }
  assert.ok(seams >= 8, 'agreement checked across at least eight payday seams, got ' + seams);
});
