'use strict';
// PA-4a (owner direction 2026-10-30; adopted packet #787 6526949494):
// every pay period publishes an opening-inclusive planned close under its
// own name. Unresolved card purchase/payment matching labels it estimated
// with a reason instead of blanking it; a deficit is published and carried;
// the balance-after-deductions identity (no opening) and available-now
// qualification are unchanged. Synthetic plan; expected cents are literal.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));

const ASOF = '2026-10-07';
// Payday snapshot opening 500 on 2026-10-02; biweekly pay 1000; one monthly
// bill on the 20th; no household budget categories.
function plan(bill = 120) {
  return {
    windowDays: 120, defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: ASOF, paydaySnapshot: { periodStart: '2026-10-02', asOf: '2026-10-02', opening: 500 },
      representedEvents: [{ id: 'payroll', date: '2026-10-02' }] },
    startingCash: { breakdown: [{ id: 'chequing-a', value: 500 }] },
    income: [{ id: 'payroll', frequency: 'biweekly', anchor: '2026-10-02', amount: 1000, confidence: 'confirmed' }],
    bills: [{ id: 'b1', label: 'Synthetic bill', frequency: 'monthly', day: 20, amount: bill, confidence: 'confirmed' }],
    obligations: [], commitments: [], budget: { categories: [] },
  };
}
// One posted card purchase of 42.50 with no confirmed coverage opening:
// card matching is unresolved (coverage-opening-unconfirmed).
function actuals(card) {
  return { schema: 'atlas-current-period-actuals/v1', observationAsOf: ASOF, coverageStart: '2026-09-01',
    coverageThrough: ASOF, pendingCoverage: 'complete', transactionCoverage: 'complete', representedActuals: [],
    transactions: card ? [{ id: 'CARD-1', date: '2026-10-05', amount: 42.5, pending: false, currency: 'CAD',
      savingsPostingEvidence: 'posted', atlasAccountId: 'tdcc', accountRole: 'revolving-credit',
      categoryLabel: 'Groceries', coverageRef: 'cov-1' }] : [] };
}
function run(card, bill) {
  const p = plan(bill), before = JSON.stringify(p);
  const a = F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: actuals(card) });
  assert.equal(JSON.stringify(p), before, 'no input mutation');
  return a;
}
const periods = a => a.payPeriodViews.filter(p => p.role !== 'lookback').slice(0, 4);
const c = n => Math.round(n * 100);

test('card matching unresolved: the planned close is published, ESTIMATED, with the reason on the figure', () => {
  const a = run(true);
  assert.equal(a.cardPurchaseCoverage.status, 'unavailable', 'fixture: card hold is on');
  for (const p of periods(a)) {
    assert.equal(typeof p.plannedPeriodClose, 'number', `${p.start}: not blanked`);
    assert.equal(p.plannedPeriodCloseTrust, 'estimated', `${p.start}: estimated`);
    assert.match(p.plannedPeriodCloseReason, /card purchase and payment matching is unresolved/);
    assert.match(p.plannedPeriodCloseReason, /not verified safe-to-spend cash/);
  }
  // Hand-derived: 500 opening + 1000 pay - 42.50 card spend = 1457.50; next
  // period opens there, + 1000 pay - 120 bill = 2337.50.
  const [active, next] = periods(a);
  assert.equal(c(active.plannedPeriodClose), 145750);
  assert.equal(c(next.plannedPeriodClose), 233750);
});

test('coverage not in play: the same identity publishes calculated, with no card reason', () => {
  const a = run(false);
  const [active, next] = periods(a);
  assert.equal(c(active.plannedPeriodClose), 150000); // 500 + 1000
  assert.equal(c(next.plannedPeriodClose), 238000);   // 1500 + 1000 - 120
  for (const p of periods(a)) {
    assert.equal(p.plannedPeriodCloseTrust, 'calculated');
    assert.equal(p.plannedPeriodCloseReason, null);
  }
});

test('the card purchase is deducted exactly once', () => {
  const held = periods(run(true)), clear = periods(run(false));
  assert.equal(c(clear[0].plannedPeriodClose) - c(held[0].plannedPeriodClose), 4250, 'one 42.50 deduction, not two');
});

test('a deficit is published negative, carried into the next opening, with zero sweep', () => {
  const [, deficit, after] = periods(run(true, 2600));
  // 1457.50 opening + 1000 pay - 2600 bill = -142.50.
  assert.equal(c(deficit.plannedPeriodClose), -14250, 'not clamped to zero');
  assert.equal(deficit.plannedPeriodCloseTerms.deficit, true);
  assert.equal(deficit.paydaySweep, 0, 'no sweep from a deficit');
  assert.equal(c(after.opening), -14250, 'the negative carries in full');
  assert.equal(c(after.plannedPeriodClose), -14250 + 100000);
});

test('balance after deductions keeps its identity (no opening) and terms reconcile', () => {
  for (const p of periods(run(true))) {
    assert.equal(p.predictedEndingBalance, p.balanceAfterDeductions, `${p.start}: BAD identity unchanged`);
    const t = p.plannedPeriodCloseTerms;
    assert.equal(c(p.plannedPeriodClose),
      c(t.opening) + c(t.incomeAdded) - c(t.periodBillLoad) - c(t.budgetHold) - c(t.annualSavingsNeed),
      `${p.start}: published terms close`);
  }
});

test('available-now qualification is unchanged under the card hold', () => {
  assert.equal(run(true).currentPeriodAction.unavailable, true, 'still held while matching is unresolved');
  assert.notEqual(run(false).currentPeriodAction.unavailable, true);
});

test('an unknown opening publishes no planned close, with the reason', () => {
  const p = plan(); delete p.opening.paydaySnapshot; p.startingCash.breakdown[0].value = null;
  const a = F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: actuals(false) });
  const active = periods(a)[0];
  assert.equal(active.plannedPeriodClose, null, 'unknown opening is never zero');
  assert.equal(active.plannedPeriodCloseTrust, 'unknown');
  assert.match(active.plannedPeriodCloseReason, /opening or a deduction is not known/);
});

// Pre-review finding: only a card-MATCHING hold may estimate; every other
// card hold leaves the plan's cash basis unknown (never a number, never 0).
function hardHold(mutate) {
  const p = plan(), pkt = actuals(true); mutate(p, pkt);
  return periods(F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: pkt }));
}
for (const [label, mutate] of [
  ['incomplete transaction history', (p, pkt) => { pkt.transactionCoverage = 'partial'; }],
  ['unknown Bills balance', (p) => { p.startingCash.breakdown[0].unknown = true; }],
  ['unconfirmed card currency', (p, pkt) => { pkt.transactions[0].currency = 'USD'; }],
]) {
  test(`hard card hold (${label}): planned close is null with the card reason`, () => {
    for (const per of hardHold(mutate)) {
      assert.equal(per.plannedPeriodClose, null, `${per.start}: no number`);
      assert.equal(per.plannedPeriodCloseTrust, 'unknown');
      assert.match(per.plannedPeriodCloseReason, /card coverage is unavailable for a reason other than matching/);
    }
  });
}

test('estimated trust carries forward into periods that open from an estimated close', () => {
  const p = plan(); p.bills[0].confidence = 'estimated'; // an estimated deduction in each period
  const pkt = actuals(false);
  pkt.transactions = [];
  const per = periods(F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: pkt }));
  const firstEstimated = per.findIndex(x => x.plannedPeriodCloseTrust === 'estimated');
  assert.ok(firstEstimated >= 0, 'fixture: an estimated close exists');
  for (const later of per.slice(firstEstimated + 1)) {
    if (later.plannedPeriodClose === null) continue;
    assert.equal(later.plannedPeriodCloseTrust, 'estimated', `${later.start}: carried estimated, never calculated`);
    assert.match(later.plannedPeriodCloseReason, /estimated/);
  }
});
