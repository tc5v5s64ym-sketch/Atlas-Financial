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
const CARD_DEBTS = [{ id: 'card', label: 'Synthetic card', balance: 821.43, pending: 0, rate: 0, limit: 2000 }];
function cardMinimumObligation() {
  return { id: 'card', debtId: 'card', effect: 'payment', label: 'Synthetic card minimum', frequency: 'monthly',
    day: 7, firstDue: '2026-10-07', amount: 47.39, confidence: 'estimated', payingAccount: 'chequing-a',
    statementOccurrences: [{ scheduledDate: '2026-10-07', dueDate: '2026-10-08', minimum: 47.39, currency: 'cad',
      confidence: 'confirmed' }],
    sentPayments: [{ scheduledDate: '2026-10-07', confirmed: true, intent: 'minimum', debitId: 'synthetic-debit',
      postedOn: '2026-10-05', amount: 47.39, currency: 'cad', fundingAccountId: 'chequing-a', pending: false }] };
}
function hardHold(mutate) {
  const p = plan(), pkt = actuals(true); mutate(p, pkt);
  const a = F.recommend(p, ASOF, { weeklyVariable: 0, debts: CARD_DEBTS, currentPeriodActuals: pkt });
  assert.equal(a.cardPurchaseCoverage.status, 'unavailable', 'fixture: card hold is on');
  return periods(a);
}
for (const [label, mutate] of [
  ['incomplete transaction history', (p, pkt) => { pkt.transactionCoverage = 'partial'; }],
  ['unknown Bills balance', (p) => { p.startingCash.breakdown[0].unknown = true; }],
  ['unconfirmed card currency', (p, pkt) => { pkt.transactions[0].currency = 'USD'; }],
  // The coverage issues stay matching-only here; only the card minimum is
  // unavailable (a sent payment with unconfirmed cash inclusion).
  ['unavailable card minimum', (p) => { p.obligations = [cardMinimumObligation()]; }],
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

test('card reserve shortfall: disclosed on the active period, estimated, never deducted from the plan', () => {
  const p = plan(), pkt = actuals(true);
  pkt.transactions[0].amount = 5000; // a purchase larger than the known Bills balance
  const a = F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: pkt });
  assert.deepEqual(a.cardPurchaseCoverage.issues.map(i => i.code).sort(),
    ['coverage-bills-backing-unconfirmed', 'coverage-opening-unconfirmed'], 'fixture: matching-only, below-reserve branch');
  const active = periods(a)[0];
  const d = active.cardReserveShortfall;
  // 5000 matching-derived reserve - 500 known Bills balance = 4500.00.
  assert.equal(Math.round(d.amount * 100), 450000);
  assert.ok(d.trust === 'estimated' && d.deducted === false);
  for (const later of periods(a).slice(1)) {
    assert.equal(later.cardReserveShortfall, undefined, `${later.start}: disclosed on the active period only`);
  }
  assert.match(d.reason, /not the plan deficit/);
  // Not deducted: the planned close is still opening + income - the card spend counted once.
  assert.equal(active.plannedPeriodCloseTrust, 'estimated');
  assert.equal(Math.round(active.plannedPeriodClose * 100), 50000 + 100000 - 500000);
  // No disclosure without the below-reserve branch.
  assert.equal(periods(run(true))[0].cardReserveShortfall, undefined);
});

test('card matching plus another estimated input: both reasons are published', () => {
  const p = plan(); p.bills[0].confidence = 'estimated';
  const per = periods(F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: actuals(true) }));
  const both = per.filter(x => x.periodBillLoadTrust === 'estimated' && x.plannedPeriodClose !== null);
  assert.ok(both.length, 'fixture: a period with an estimated bill and a card-matching estimate');
  for (const x of both) {
    assert.equal(x.plannedPeriodCloseTrust, 'estimated');
    assert.match(x.plannedPeriodCloseReason, /card purchase and payment matching is unresolved/, `${x.start}: card reason`);
    assert.match(x.plannedPeriodCloseReason, /an input to this close .* is estimated/, `${x.start}: input reason kept`);
  }
});

// PA-1: an unqualified Savings movement makes projected openings estimated;
// the planned close built on them is estimated too, never calculated.
test('PA-1 movement hold: every projected planned close is estimated, with a reason', () => {
  const input = require('./fixtures/savings-future-closing-data');
  const run1 = unq => {
    const x = input();
    x.plan.income.push({ id: 'p0', label: 'Invented', frequency: 'once', date: '2026-10-09', amount: 400, confidence: 'confirmed' });
    if (unq) x.opts.currentPeriodActuals.savingsMovementUnconfirmed = [{ accountId: 'savings', reason: 'transaction-posting-status-unconfirmed' }];
    return F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] }).payPeriodViews.filter(v => v.role === 'future');
  };
  const held = run1(true), clear = run1(false);
  assert.ok(held.length >= 3 && held.every(v => v.openingTrust === 'estimated'), 'fixture: PA-1 hold is on');
  assert.ok(clear.every(v => v.plannedPeriodCloseTrust === 'calculated'), 'control: calculated without the hold');
  for (const v of held) {
    assert.equal(typeof v.plannedPeriodClose, 'number', `${v.start}: published`);
    assert.equal(v.plannedPeriodCloseTrust, 'estimated', `${v.start}: estimated, not calculated`);
    assert.match(v.plannedPeriodCloseReason, /is estimated/);
  }
});

// Atlas #809 B1: a Savings-funded yearly bill is excluded from paycheck Bills
// and enters the close as annualSavingsNeed; its own confidence must feed the
// close's trust. Invented fixture: 200 premium due 2026-10-25 against a
// purpose-reserve goal; every other input confirmed.
function annualFixture(confidence) {
  const { ledger } = require('./fixtures/chronological-savings-data');
  const { advance } = require('./fixtures/savings-daily-allocation-contract');
  const i = advance(ledger(), '2026-10-10');
  i.plan.income[0].anchor = '2026-08-14';
  i.plan.income = i.plan.income.map(row => ({ ...row, confidence: 'confirmed' }));
  i.plan.opening.paydaySnapshot = { periodStart: '2026-10-09', asOf: '2026-10-09', opening: 80 };
  i.plan.opening.representedEvents = [];
  i.opts.currentPeriodActuals.coverageStart = '2026-10-09';
  i.opts.currentPeriodActuals.savingsFetchCoverage.startDate = '2026-10-09';
  i.plan.bills = [{ id: 'annual', label: 'Invented annual premium', amount: 200, frequency: 'yearly',
    month: 10, day: 25, firstDue: '2026-10-25', jointCash: false, confidence }];
  i.plan.savingsEarmarks.pools[1].goalRefs = [{ kind: 'yearly-bill', id: 'annual' }];
  const a = F.recommend(i.plan, i.asOf, { ...i.opts, debts: [], weeklyVariable: 0 });
  const views = a.payPeriodViews.filter(p => p.role === 'future');
  return { due: views.find(p => p.start === '2026-10-23'), later: views.filter(p => p.start > '2026-10-23') };
}

test('annual provision confirmed (control): the close is calculated with the provision deducted', () => {
  const { due, later } = annualFixture('confirmed');
  assert.ok(due.plannedPeriodCloseTerms.annualSavingsNeed > 0, 'fixture: an unfunded provision lands in this period');
  assert.equal(due.plannedPeriodCloseTrust, 'calculated');
  assert.equal(due.plannedPeriodCloseReason, null);
  for (const p of later) assert.equal(p.plannedPeriodCloseTrust, 'calculated', `${p.start}: control stays calculated`);
});

test('annual provision estimated: the close is estimated with a reason, and later closes stay estimated', () => {
  const { due, later } = annualFixture('estimated');
  assert.ok(due.plannedPeriodCloseTerms.annualSavingsNeed > 0);
  assert.equal(due.plannedPeriodCloseTrust, 'estimated', 'never promoted to calculated');
  assert.match(due.plannedPeriodCloseReason, /an input to this close .* is estimated/);
  assert.ok(later.length);
  for (const p of later) {
    if (p.plannedPeriodClose === null) continue;
    assert.equal(p.plannedPeriodCloseTrust, 'estimated', `${p.start}: dependent close carries the estimate`);
  }
});

test('annual provision with unknown confidence: no number; later closes are unknown, never calculated', () => {
  const { due, later } = annualFixture('unknown');
  assert.equal(due.plannedPeriodClose, null, 'a numeric amount does not make unknown confidence calculated');
  assert.equal(due.plannedPeriodCloseTrust, 'unknown');
  assert.match(due.plannedPeriodCloseReason, /unavailable trust/);
  assert.ok(later.length);
  for (const p of later) {
    assert.equal(p.plannedPeriodClose, null, `${p.start}: depends on an unknown close`);
    assert.equal(p.plannedPeriodCloseTrust, 'unknown');
  }
});

// Atlas #809 B1 (re-review at f0f0e1b5): the annual provision in the ACTIVE
// period. Without an allocation policy the next opening is this close's own
// cash, so an unknown close must keep the dependent later closes unknown.
// Atlas's synthetic discriminator: the PA-4 plan plus a 200 Savings-funded
// yearly bill due 2026-10-10; carry 500 + 1000 - 200 = 1300 into Oct 16.
function activeAnnual(confidence) {
  const p = plan();
  p.bills.push({ id: 'annual', label: 'Synthetic annual', frequency: 'yearly', month: 10, day: 10,
    firstDue: '2026-10-10', amount: 200, jointCash: false, confidence });
  p.savingsEarmarks = { version: 1, currency: 'CAD', history: [], pools: [{ id: 'pool', accountId: 'savings',
    label: 'Synthetic pool', role: 'purpose-reserve', purpose: 'Synthetic', goalRefs: [{ kind: 'yearly-bill', id: 'annual' }] }] };
  return periods(F.recommend(p, ASOF, { weeklyVariable: 0, debts: [], currentPeriodActuals: actuals(false) }));
}

test('active annual provision, confirmed control: 1300 carries and the next close is calculated', () => {
  const [active, next] = activeAnnual('confirmed');
  assert.equal(c(active.plannedPeriodClose), 130000);
  assert.equal(active.plannedPeriodCloseTrust, 'calculated');
  assert.equal(c(next.opening), 130000, 'fixture: the next opening is the active close cash');
  assert.equal(c(next.plannedPeriodClose), 218000); // 1300 + 1000 - 120
  assert.equal(next.plannedPeriodCloseTrust, 'calculated');
});

test('active annual provision, estimated: the active and dependent later closes are estimated', () => {
  const [active, ...later] = activeAnnual('estimated');
  assert.equal(active.plannedPeriodCloseTrust, 'estimated');
  for (const p of later) if (p.plannedPeriodClose !== null) assert.equal(p.plannedPeriodCloseTrust, 'estimated', p.start);
});

test('active annual provision, unknown confidence: the dependent later closes are unknown, never calculated', () => {
  const [active, ...later] = activeAnnual('unknown');
  assert.equal(active.plannedPeriodClose, null);
  assert.equal(active.plannedPeriodCloseTrust, 'unknown');
  assert.equal(c(later[0].opening), 130000, 'fixture: a finite carry still seeds the next opening');
  for (const p of later) {
    assert.equal(p.plannedPeriodClose, null, `${p.start}: depends on the unknown active close`);
    assert.equal(p.plannedPeriodCloseTrust, 'unknown');
  }
});

// The S1 observed-Bills seed (allocation policy installed) is independently
// qualified: it does not include the Savings-funded provision, so the next
// opening is identical whether the provision is confirmed or unknown, and a
// later close built on it is not poisoned by the active display.
test('independent S1 seam: an unknown active provision does not blank the independently seeded next close', () => {
  const run1 = confidence => {
    const { ledger } = require('./fixtures/chronological-savings-data');
    const { advance } = require('./fixtures/savings-daily-allocation-contract');
    const i = advance(ledger(), '2026-10-10');
    i.plan.income[0].anchor = '2026-08-14';
    i.plan.income = i.plan.income.map(row => ({ ...row, confidence: 'confirmed' }));
    i.plan.opening.paydaySnapshot = { periodStart: '2026-10-09', asOf: '2026-10-09', opening: 80 };
    i.plan.opening.representedEvents = [];
    i.opts.currentPeriodActuals.coverageStart = '2026-10-09';
    i.opts.currentPeriodActuals.savingsFetchCoverage.startDate = '2026-10-09';
    i.plan.bills = [{ id: 'annual', label: 'Invented annual premium', amount: 200, frequency: 'yearly',
      month: 10, day: 15, firstDue: '2026-10-15', jointCash: false, confidence }];
    i.plan.savingsEarmarks.pools[1].goalRefs = [{ kind: 'yearly-bill', id: 'annual' }];
    assert.ok(i.plan.savingsEarmarks.allocationPolicy, 'fixture: S1 seam installed');
    return F.recommend(i.plan, i.asOf, { ...i.opts, debts: [], weeklyVariable: 0 }).payPeriodViews.filter(v => v.role !== 'lookback');
  };
  const known = run1('confirmed'), unknown = run1('unknown');
  assert.equal(unknown[0].plannedPeriodCloseTrust, 'unknown', 'the active display is still unknown');
  assert.equal(c(unknown[1].opening), c(known[1].opening), 'fixture: the seeded opening does not depend on the provision');
  assert.equal(c(unknown[1].plannedPeriodClose), c(known[1].plannedPeriodClose));
  assert.equal(unknown[1].plannedPeriodCloseTrust, 'calculated', 'independent seam is not poisoned');
});
