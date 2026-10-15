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
  // Unreconciled shape: the second chequing row (chequing-b) is raised
  // to 777 WITHOUT reconciling the recorded payday opening (80). The
  // starting-cash evidence then contradicts itself about the opening's
  // account split, so the Bills-only basis cannot be established: the
  // Budget chain goes unknown and the closes withhold, rather than
  // sweeping pooled cash or inventing a split. The other account
  // itself is never mutated. (The reconciled shape is pinned by the
  // next test.)
  const base = advice(input());
  const x = input(); x.plan.startingCash.breakdown[1].value = 777;
  const other = advice(x);
  assert.equal(viewAt(base, '2026-10-16').paydaySweep, 1080, 'the control sweep is the Bills remainder only');
  assert.equal(viewAt(other, '2026-10-16').opening, null,
    'the Bills share of the pooled opening cannot be established from contradictory evidence');
  assert.equal(viewAt(other, '2026-10-16').paydaySweep, null, 'no sweep is published on an unestablished basis');
  assert.equal(closing(other, '2026-10-30').status, 'unavailable', 'the closes withhold on the same evidence');
  assert.equal(x.plan.startingCash.breakdown[1].value, 777, 'the other account is not mutated');
});

test('reconciled other-chequing cash never enters the sweep (Bills-only basis)', () => {
  // Systems Review 2026-10-15, PR #620 blocker 2: chequing-b holds 777
  // and the household payday snapshot opening is raised by the same 777
  // (80 → 857), keeping the historical opening and current cash
  // reconciled. The starting-cash breakdown establishes the split, so
  // the sweep basis is Bills-only: every published figure equals the
  // control (chequing-b 0) exactly — none of the excluded account's
  // cash is credited to Savings. (Pre-repair this shape swept 1857 and
  // credited 1857, stock 1976: the pooled opening fed the sweep.)
  const control = advice(input());
  const x = input();
  x.plan.startingCash.breakdown[1].value = 777;
  x.plan.opening.paydaySnapshot.opening += 777;
  const a = advice(x);
  for (const start of ['2026-10-16', '2026-10-30', '2026-11-13']) {
    assert.equal(viewAt(a, start).opening, viewAt(control, start).opening, 'Budget opening unchanged at ' + start);
    assert.equal(viewAt(a, start).paydaySweep, viewAt(control, start).paydaySweep, 'sweep unchanged at ' + start);
  }
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 1080, 'the sweep is the Bills remainder only');
  assert.equal(closing(a, '2026-10-30').contribution, 1080, 'Savings credits the Bills remainder only');
  assert.equal(closing(a, '2026-10-30').stock, 1199, 'identical to the control — none of the 777 is credited');
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
  // Systems Review 2026-10-15, PR #620 blocker 3: a bill whose amount is
  // unavailable lands inside the 2026-10-16 period. Its load is unknown
  // — not zero — so that period's published sweep goes unknown and the
  // next Budget opening goes unknown with it, while Savings withholds
  // as before. (Pre-repair the period published periodBillLoad 0 and
  // paydaySweep 1080 and the next opening was a known 0.)
  const unknownBill = input();
  unknownBill.plan.bills = [{ id: 'unknown', frequency: 'once', date: '2026-10-20', amount: null }];
  const ua = advice(unknownBill);
  const p = closing(ua, '2026-10-30');
  assert.equal(p.status, 'unavailable'); assert.equal(p.stock, null);
  assert.equal(viewAt(ua, '2026-10-16').periodBillLoad, null, 'the bill load is unknown, not a fabricated zero');
  assert.equal(viewAt(ua, '2026-10-16').paydaySweep, null, 'the sweep goes unknown when the bill load is unknown');
  assert.equal(viewAt(ua, '2026-10-30').opening, null, 'the next opening goes unknown with it — never a known zero');
  // Genuine-zero control: with no bills at all the same period's load
  // is a known zero and its sweep stays known.
  const known = advice(input());
  assert.equal(viewAt(known, '2026-10-16').periodBillLoad, 0, 'a genuinely empty load is a known zero');
  assert.equal(viewAt(known, '2026-10-16').paydaySweep, 1080, 'the genuine-zero sweep stays known');
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
  // Annual-goal shape: the goal bill sits inside the first period's
  // Budget bill load, and the Savings ledger debits it as a goal cost.
  // S1 repair (Systems Review 2026-10-15, PR #620 blocker 1): Budget
  // restores the deducted goal bill inside its own published remainder,
  // so the published sweeps are 480 and 400 and Savings credits exactly
  // those figures — the cost is paid once across both ledgers, the
  // paired Bills operating position closes at 0, and no residual
  // persists. Independent dated ledger: Bills 80 + Savings 300 +
  // receipts 400 + 400 − goal costs 500 + 400 = 280, ending Bills 0 /
  // Savings 280. (Pre-repair pins — contributions 860, stock 260,
  // operating 20 — encoded the defect: Budget clamped its remainder to
  // 380 on the broken chain and the 20 residual was unexplained.)
  const y = ownerModel(); y.plan.commitments.shift();
  y.plan.bills = [{ id: 'a', label: 'Invented annual goal', frequency: 'yearly', month: 10, day: 21,
    firstDue: '2026-10-21', amount: 500, confidence: 'confirmed', jointCash: false }];
  const ya = advice(y);
  const third = closing(ya, '2026-11-13');
  assert.equal(third.projectedDraws, 900, 'the annual goal (500) and commitment b (400) are each debited once');
  assert.equal(third.projectedContributions, 880, 'the two credited sweeps (480 + 400), each once');
  assert.equal(third.stock, 280);
  assert.equal(third.operatingCash, 0, 'the paired Bills operating position is fully explained — no residual');
  assert.equal(30000 + 48000 + 40000 - 50000 - 40000, 28000);
  assert.equal(viewAt(ya, '2026-10-16').paydaySweep, 480, 'Budget publishes the overlap-restored sweep');
  assert.equal(viewAt(ya, '2026-10-30').paydaySweep, 400);
  assert.equal(viewAt(ya, '2026-10-30').opening, 0, 'the next Budget opening consumes the same 480 sweep');
});

test('the current-period credit and the first future sweep are the same money, counted once', () => {
  // Systems Review 2026-10-15, PR #620 blocker 1b — the current-tail
  // shape from the future-closing suite: a reconciled 200 receipt
  // landed in the Bills account during the current period. The closing
  // projection credits that 200 at the first payday (the current
  // period's boundary credit); the first future period therefore opens
  // on the remainder net of the credit (280 − 200 = 80) and publishes
  // the sweep Savings will credit at the next payday (80 + 1000 =
  // 1080) — the published sweep and the accepted credit are the same
  // number, and the 200 is counted once across the two boundaries.
  // (Pre-repair the period opened on the full 280, published a 1280
  // sweep, and Savings accepted only 1080 of it.)
  const x = input();
  x.plan.income.push({ id: 'current-gift', label: 'Invented operating receipt', frequency: 'once',
    date: '2026-10-04', amount: 200, confidence: 'confirmed' });
  x.plan.startingCash.breakdown[0].value += 200;
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'current-gift', date: '2026-10-04', actual: 200, transactionId: 'gift-receipt' });
  x.opts.currentPeriodActuals.transactions.push({ id: 'gift-receipt', date: '2026-10-04', amount: -200,
    currency: 'CAD', pending: false, isIncome: true, incomeId: 'current-gift', savingsPostingEvidence: 'posted',
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', displayedPayee: 'Invented operating receipt' });
  const a = advice(x);
  assert.equal(closing(a, '2026-10-16').contribution, 200, 'the current-period credit lands at the first payday');
  assert.equal(viewAt(a, '2026-10-16').opening, 80, 'the first future opening is the current remainder net of that credit');
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 1080, 'the published sweep is the remainder that will actually move');
  assert.equal(closing(a, '2026-10-30').contribution, 1080, 'Savings credits exactly the published sweep');
  assert.equal(closing(a, '2026-10-30').stock, 1399);
  assert.equal(11900 + 20000 + 108000, 139900, 'opening stock + the credit + the sweep, each counted once');
  assert.equal(closing(a, '2026-11-13').stock, 2399, 'the whole household position lands in Savings by the last close');
  assert.equal(closing(a, '2026-11-13').operatingCash, 0, 'no unexplained residual remains in Bills');
});

test('a negative native surplus still establishes the boundary deduction (ledger-paid current annual goal)', () => {
  // Systems Review 5532745420 (PR #620, round 2): the owner-closing
  // fixture with its commitments removed, Savings at 1000, and a single
  // yearly bill of 500 due 2026-10-10 inside the CURRENT period. The
  // bill carries no explicit goalRef: the Savings ledger identifies and
  // pays the 500 goal itself, and Budget deducts it inside the current
  // period's bill load, so the period's native surplus is -500 — a
  // valid signed figure, not unavailable evidence. The closing
  // projection converts that surplus signed and publishes READY; the
  // boundary computation must do the same, so the deduction is
  // established (credit 0: -500 surplus + 500 restored overlap) and the
  // first future period seeds from the goal-restored remainder (80).
  // Hand-derived ledger: Bills opens 80; the goal is paid once by the
  // ledger; the two 400 receipts are the future periods' remainders
  // (80 + 400 = 480, then 400), each sweeping in full; Savings ends
  // 1000 - 500 + 480 + 400 = 1380 with Bills at 0.
  // Pre-repair (head 29a07b72): the boundary computation converted the
  // surplus unsigned, read -500 as unavailable and dropped the
  // deduction, so Budget seeded -420 (80 - 500 unrestored), published
  // sweeps of 0 and 380, and the Nov 13 close signed stock 880 /
  // operatingCash 500 while Savings stayed READY — the two
  // publications disagreed and the merge card's claim that a failed
  // deduction gate only occurs while Savings withholds was false.
  const x = ownerModel();
  x.plan.commitments = [];
  x.plan.savingsPoolObservation.accounts[0].value = 1000;
  x.plan.startingCash.breakdown[2].value = 1000;
  x.plan.bills = [{ id: 'a', label: 'Invented current annual goal', frequency: 'yearly', month: 10, day: 10,
    firstDue: '2026-10-10', amount: 500, confidence: 'confirmed', jointCash: false }];
  const a = advice(x);
  assert.equal(a.savingsFunding.period.nativePeriodSurplus, -500,
    'the current period native surplus is the signed -500, published not dropped');
  assert.equal(viewAt(a, '2026-10-02').periodBillLoad, 500,
    'Budget deducts the goal bill inside the current period load');
  assert.equal(viewAt(a, '2026-10-16').opening, 80,
    'the first future opening seeds from the goal-restored remainder, not the unrestored -420');
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 480, 'the first future sweep is the full remainder (80 + 400)');
  assert.equal(viewAt(a, '2026-10-30').paydaySweep, 400);
  const second = closing(a, '2026-10-30');
  assert.equal(second.contribution, 480, 'Savings credits exactly the published 480 sweep');
  assert.equal(second.stock, 980, '1000 opening stock - the 500 goal paid once + the 480 sweep');
  const third = closing(a, '2026-11-13');
  assert.equal(third.status, 'ready');
  assert.equal(third.projectedContributions, 880, 'the two credited sweeps (480 + 400), each once');
  assert.equal(third.projectedDraws, 500, 'the goal cost is debited exactly once');
  assert.equal(third.stock, 1380);
  assert.equal(third.operatingCash, 0, 'the paired Bills operating position is fully explained — no residual');
  assert.equal(100000 - 50000 + 48000 + 40000, 138000);
});

test('control: the same annual goal with an explicit yearly-bill goalRef agrees unchanged', () => {
  // Passing control for the round-2 counterexample above (Systems
  // Review 5532745420): identical fixture, except the Savings pool
  // carries the explicit yearly-bill goalRef for the bill. The goal is
  // then carried as a Savings-funded provision rather than a Budget
  // bill load (current periodBillLoad 0), and the publications have
  // always agreed: opening 80, sweeps 480 and 400, Nov 13 close stock
  // 1380 / Bills 0. This shape passed before the round-2 repair and
  // must keep passing.
  const x = ownerModel();
  x.plan.commitments = [];
  x.plan.savingsPoolObservation.accounts[0].value = 1000;
  x.plan.startingCash.breakdown[2].value = 1000;
  x.plan.bills = [{ id: 'a', label: 'Invented current annual goal', frequency: 'yearly', month: 10, day: 10,
    firstDue: '2026-10-10', amount: 500, confidence: 'confirmed', jointCash: false }];
  x.plan.savingsEarmarks.pools[1].goalRefs = [{ kind: 'yearly-bill', id: 'a' }];
  const a = advice(x);
  assert.equal(viewAt(a, '2026-10-02').periodBillLoad, 0,
    'with the explicit goalRef the goal is a Savings-funded provision, not a Budget load');
  assert.equal(viewAt(a, '2026-10-16').opening, 80);
  assert.equal(viewAt(a, '2026-10-16').paydaySweep, 480);
  assert.equal(viewAt(a, '2026-10-30').paydaySweep, 400);
  const third = closing(a, '2026-11-13');
  assert.equal(third.status, 'ready');
  assert.equal(third.stock, 1380);
  assert.equal(third.projectedDraws, 500, 'the goal cost is debited exactly once');
  assert.equal(third.operatingCash, 0, 'the paired Bills operating position is fully explained');
  assert.equal(100000 - 50000 + 48000 + 40000, 138000);
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
