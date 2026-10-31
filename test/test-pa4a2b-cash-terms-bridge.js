'use strict';
// PA-4a-2b (Astra #787 6534140193 §1-2, §4; Atlas dispositions 6531287856 and
// 6538656590): under an eligible card-MATCHING-only hold, a current-cycle card
// purchase inside the household hold H is not Bills cash already spent. One
// qualified remaining requirement D feeds the S1 seed, the Budget closing walk
// and the Savings close. Expected cents are hand-computed from the invented
// fixtures below (Astra's matrix rows scaled to them), never read back from
// the engine. Synthetic data only.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast'));
const { ledger } = require('./fixtures/chronological-savings-data');
const closingInput = require('./fixtures/savings-future-closing-data');

const CARD_REASON = 'Confirm the card-coverage opening, transaction units and explicit purchase/payment links before using available cash.';
const cents = v => v == null ? v : Math.round(v * 100);
// Ruling 7: the published opening stays unknown; the typed estimate rides beside it.
const estimated = view => {
  assert.equal(view.opening, null, 'the card-matching opening is never published as the opening');
  assert.equal(view.paydaySweep, null);
  return view.cardMatchingEstimate && view.cardMatchingEstimate.trust === 'estimated'
    ? cents(view.cardMatchingEstimate.opening) : null;
};
const posted = o => ({ pending: false, currency: 'CAD', savingsPostingEvidence: 'posted', ...o });
const purchase = amount => posted({ id: 'CARD-1', date: '2026-10-05', amount, atlasAccountId: 'tdcc',
  accountRole: 'revolving-credit', categoryLabel: 'Groceries', coverageRef: 'cov-1' });
const DEBTS = [{ id: 'tdcc', label: 'Emerald', balance: 500, pending: 0, rate: 0.2, limit: 2000, structure: 'Revolving' },
  { id: 'travelvisa', label: 'Travel', balance: 300, pending: 0, rate: 0.2, limit: 2000, structure: 'Revolving' }];

// Active-seed fixture: Bills stock 8000, no current income, no other bills,
// category target 0, so H is the card charge itself and R is the next
// Bills opening (current net is not positive, so the boundary credit Q = 0).
function seedCase({ charge = 4250, pay = 0, payCard = 'tdcc', alloc = null, other = 0, record = true,
  creditOnly = false, reversal = false, obligation = null, card = 'tdcc', extra = [] } = {}) {
  const x = ledger();
  x.plan.income = x.plan.income.filter(r => r.id === 'payroll');
  x.plan.budget = { categories: [{ id: 'groceries', label: 'Groceries', monthly: 0, essential: true }] };
  const t = (charge ? [{ ...purchase(charge / 100), atlasAccountId: card }] : []).concat(extra);
  if (pay) {
    if (!creditOnly) t.push(posted({ id: 'PAY-D', date: '2026-10-06', amount: pay / 100, atlasAccountId: 'chequing-a',
      accountRole: 'household-cash', categoryLabel: 'Credit Card Payment', coverageRef: 'pay-d' }));
    t.push(posted({ id: 'PAY-C', date: '2026-10-06', amount: -pay / 100, atlasAccountId: payCard,
      accountRole: 'revolving-credit', categoryLabel: 'Credit Card Payment', coverageRef: 'pay-c' }));
    if (!creditOnly) x.plan.startingCash.breakdown[0].value = (8000 - pay) / 100;
    if (record) x.plan.cardPurchaseCoverage = { payments: [{ id: 'p1', confirmed: true, creditRef: 'pay-c',
      debitRef: 'pay-d', allocations: alloc ? [{ purchaseRef: 'cov-1', amount: alloc / 100 }] : [],
      otherAmount: other / 100, ...(other ? { otherPurpose: 'prior-debt' } : {}) }],
    refunds: [], reversals: reversal ? [{ confirmed: true, paymentId: 'p1', cardDebitRef: 'rev-d',
      cashCreditRef: 'rev-c', allocations: [{ purchaseRef: 'cov-1', amount: 1 }], otherAmount: 0 }] : [] };
  }
  if (obligation) x.plan.obligations = [obligation];
  x.opts.currentPeriodActuals.transactions = (x.opts.currentPeriodActuals.transactions || []).concat(t);
  const before = JSON.stringify(x);
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: DEBTS });
  assert.equal(JSON.stringify(x), before, 'no input mutation');
  const views = a.payPeriodViews.filter(p => p.role !== 'lookback');
  return { a, active: views[0], next: views[1] };
}
const cardMinimum = debtId => ({ id: 'card-min', ...(debtId ? { debtId } : {}), effect: 'payment',
  label: 'Card minimum', frequency: 'monthly', day: 12, firstDue: '2026-10-12', amount: 10,
  confidence: 'confirmed', payingAccount: 'chequing-a' });

test('active seed, card charge 4250: R = 8000 - 4250 = 3750, estimated with the card-matching basis', () => {
  const { a, active, next } = seedCase();
  assert.deepEqual(a.cardPurchaseCoverage.issues.map(i => i.code), ['coverage-opening-unconfirmed']);
  assert.equal(estimated(next), 3750);
  assert.equal(cents(next.cardMatchingEstimate.paydaySweep), 3750);
  assert.equal(next.cardMatchingEstimate.basis, 'card-matching-unresolved');
  assert.match(next.cardMatchingEstimate.reason, /card purchase matching/);
  assert.equal(next.openingTrust, undefined, 'no published estimated opening for a nature the page does not read');
  // The seed and the active planned close agree on the same requirement.
  assert.equal(cents(active.plannedPeriodClose), 3750);
});

test('a card identified only by accountRole is a card, not cash: the same 3750', () => {
  assert.equal(estimated(seedCase({ card: 'amexgold' }).next), 3750);
});

test('pending Bills cash is never relieved as spent: the seed holds (incumbent pending guard)', () => {
  const pendingCash = posted({ id: 'CASH-P', date: '2026-10-06', amount: 10, pending: true,
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', categoryLabel: 'Groceries' });
  const { next } = seedCase({ extra: [pendingCash] });
  assert.equal(estimated(next), null);
});

test('active seed, card charge 500000: R = 8000 - 500000 = -492000 and the next sweep is 0', () => {
  const { a, next } = seedCase({ charge: 500000 });
  assert.ok(a.cardPurchaseCoverage.issues.some(i => i.code === 'coverage-bills-backing-unconfirmed'));
  assert.equal(estimated(next), -492000);
  assert.equal(cents(next.cardMatchingEstimate.paydaySweep), 0);
});

test('ready control: no card purchase keeps the calculated seed (8000) with no estimate marker', () => {
  const { a, next } = seedCase({ charge: 0 });
  assert.equal(a.cardPurchaseCoverage, undefined);
  assert.equal(cents(next.opening), 8000);
  assert.notEqual(next.openingTrust, 'estimated');
  assert.equal(next.openingBasis, undefined);
  assert.equal(next.cardMatchingEstimate, undefined);
});

test('qualified H settlement already in the observed opening: stock 6000, H_remaining 4250 - 2000; close stays 3750', () => {
  const { a, next } = seedCase({ pay: 2000, alloc: 2000 });
  assert.deepEqual(a.cardPurchaseCoverage.payments.map(p => p.status), ['reconciled']);
  assert.equal(estimated(next), 6000 - (4250 - 2000));
  assert.equal(estimated(next), 3750);
});

test('posted mixed payment 3000 = 2000 to H + 1000 prior debt: 5000 - 2250 = 2750; the debt share is not a second debit', () => {
  const { next } = seedCase({ pay: 3000, alloc: 2000, other: 1000 });
  assert.equal(estimated(next), 5000 - 2250);
});

test('posted payment with genuinely unresolved purpose on the held card: unknown (null), never a numeric guess', () => {
  const { a, next } = seedCase({ pay: 2000, record: false });
  assert.ok(a.cardPurchaseCoverage.issues.some(i => i.code === 'coverage-payment-or-credit-purpose-unconfirmed'));
  assert.equal(estimated(next), null);
});

test('ruling 6: an unresolved credit on a card holding no purchase inside H is excluded from F; R = 8000 - 4250', () => {
  const { a, next } = seedCase({ pay: 2000, payCard: 'travelvisa', record: false, creditOnly: true });
  assert.ok(a.cardPurchaseCoverage.issues.some(i => i.code === 'coverage-payment-or-credit-purpose-unconfirmed'));
  assert.equal(estimated(next), 3750);
  // The same credit on the card that holds the H purchase cannot be proved non-contributing.
  assert.equal(estimated(seedCase({ pay: 2000, payCard: 'tdcc', record: false, creditOnly: true }).next), null);
  // An unpaired cash leg names no card, so its contribution is ambiguous.
  assert.equal(estimated(seedCase({ pay: 2000, payCard: 'travelvisa', record: false }).next), null);
});

test('ruling 1: a remaining scheduled card payment that could overlap H holds; a proven different card stays numeric', () => {
  assert.equal(estimated(seedCase({ obligation: cardMinimum('tdcc') }).next), null);
  assert.equal(estimated(seedCase({ obligation: cardMinimum(null) }).next), null);
  // Disjoint: 8000 - 4250 - the 1000 minimum on another card = 2750.
  assert.equal(estimated(seedCase({ obligation: cardMinimum('travelvisa') }).next), 2750);
});

test('ruling 5: a settlement that could also be a scheduled card bill the seed still deducts withholds the seed', () => {
  // Remaining same-card bill on 10-10: the 2000 settlement could be inside it.
  const remaining = { ...cardMinimum('tdcc'), firstDue: '2026-10-10', day: 10, amount: 20 };
  assert.equal(estimated(seedCase({ pay: 2000, alloc: 2000, obligation: remaining }).next), null);
  // A same-card bill dated before the as-of is already inside the observed
  // stock and is not deducted again: 6000 - (4250 - 2000) = 3750.
  const paid = { ...cardMinimum('tdcc'), firstDue: '2026-10-06', day: 6, amount: 20 };
  assert.equal(estimated(seedCase({ pay: 2000, alloc: 2000, obligation: paid }).next), 3750);
});

test('Atlas #812 B2: the active planned close never deducts a settlement twice (bill in B and unreduced H)', () => {
  // Snapshot 8000 on 10-02; card purchase 4250 on 10-05; a confirmed 2000
  // Bills payment on 10-06 allocated to it; observed Bills 6000. The same-card
  // 2000 minimum on 10-06 is represented by that payment, so the close (from
  // the 10-02 snapshot) still deducts it: 8000 - 2000 - 4250 = 1750 double-counts
  // the 2000. The qualified answer is 6000 - (4250 - 2000) = 3750.
  const ob = { ...cardMinimum('tdcc'), firstDue: '2026-10-06', day: 6, amount: 20 };
  const represented = [{ id: 'card-min', date: '2026-10-06', actual: 20, transactionId: 'PAY-D' }];
  const run = rows => {
    const x = ledger();
    x.plan.income = x.plan.income.filter(r => r.id === 'payroll');
    x.plan.budget = { categories: [{ id: 'groceries', label: 'Groceries', monthly: 0, essential: true }] };
    x.plan.obligations = [ob];
    x.plan.startingCash.breakdown[0].value = 60;
    x.plan.cardPurchaseCoverage = { payments: [{ id: 'p1', confirmed: true, creditRef: 'pay-c', debitRef: 'pay-d',
      allocations: [{ purchaseRef: 'cov-1', amount: 20 }], otherAmount: 0 }], refunds: [], reversals: [] };
    x.opts.currentPeriodActuals.transactions = [purchase(42.5),
      posted({ id: 'PAY-D', date: '2026-10-06', amount: 20, atlasAccountId: 'chequing-a',
        accountRole: 'household-cash', categoryLabel: 'Credit Card Payment', coverageRef: 'pay-d' }),
      posted({ id: 'PAY-C', date: '2026-10-06', amount: -20, atlasAccountId: 'tdcc',
        accountRole: 'revolving-credit', categoryLabel: 'Credit Card Payment', coverageRef: 'pay-c' })];
    x.opts.currentPeriodActuals.representedActuals = rows;
    const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: DEBTS });
    return a.payPeriodViews.filter(v => v.role !== 'lookback');
  };
  const [active, next] = run(represented);
  assert.notEqual(cents(active.plannedPeriodClose), 1750, 'never the double-deducted close');
  assert.equal(active.plannedPeriodClose, null);
  assert.equal(active.plannedPeriodCloseTrust, 'unknown');
  assert.match(active.plannedPeriodCloseReason, /could deduct it twice/);
  // The seed reads the observed stock, where the bill is already paid: 3750.
  assert.equal(estimated(next), 3750);
  // Control: unrepresented, the bill sits inside the opening and is not
  // deducted, so the estimated close is the qualified 3750.
  const [control] = run([]);
  assert.equal(control.plannedPeriodCloseTrust, 'estimated');
  assert.equal(cents(control.plannedPeriodClose), 3750);
});

test('a confirmed reversal is not yet qualified by this slice: unknown, never the unreversed figure', () => {
  const { next } = seedCase({ pay: 2000, alloc: 2000, reversal: true });
  assert.equal(estimated(next), null);
});

test('hard holds stay hard: incomplete history gives no seed', () => {
  const x = ledger();
  x.plan.income = x.plan.income.filter(r => r.id === 'payroll');
  x.plan.budget = { categories: [{ id: 'groceries', label: 'Groceries', monthly: 0, essential: true }] };
  x.opts.currentPeriodActuals.transactions = [purchase(42.5)];
  x.opts.currentPeriodActuals.transactionCoverage = 'truncated';
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: DEBTS });
  assert.ok(a.cardPurchaseCoverage.issues.some(i => i.code === 'coverage-history-incomplete'));
  assert.equal(a.payPeriodViews.filter(p => p.role !== 'lookback')[1].opening, null);
});

// Savings chain: the incumbent future-closing fixture (verified closes 519 /
// 1599 / 2599 with the clean nature) plus one 42.50 card purchase whose
// matching is unresolved. The card spend is still owed from Bills, so the
// current period's sweep and every later close fall by exactly 4250.
const FUTURE = ['2026-10-16', '2026-10-30', '2026-11-13'];
function savingsCase({ charge = 0, movement = false } = {}) {
  const x = closingInput();
  x.plan.income.push({ id: 'p0', label: 'Invented current receipt', frequency: 'once',
    date: '2026-10-09', amount: 400, confidence: 'confirmed' });
  if (movement) x.opts.currentPeriodActuals.savingsMovementUnconfirmed =
    [{ accountId: 'savings', reason: 'transaction-posting-status-unconfirmed' }];
  if (charge) x.opts.currentPeriodActuals.transactions = (x.opts.currentPeriodActuals.transactions || [])
    .concat([purchase(charge / 100)]);
  const before = JSON.stringify(x);
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input mutation');
  const closing = start => a.savingsFunding.periodViews.find(p => p.start === start).packet.forecastClosing;
  const published = start => {
    const view = a.savingsFunding.periodViews.find(p => p.start === start);
    return F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id });
  };
  return { a, closing, published };
}

test('Savings ready control: the clean closes are unchanged (51900 / 159900 / 259900)', () => {
  const { a, closing } = savingsCase();
  assert.equal(a.savingsFunding.status, 'ready');
  assert.deepEqual(FUTURE.map(s => cents(closing(s).stock)), [51900, 159900, 259900]);
  for (const s of FUTURE) {
    assert.equal(closing(s).nature, 'if-eligible-surplus-saved');
    assert.equal(closing(s).cardMatchingEstimate, undefined);
  }
});

test('card-only estimate: typed closes 51900 - 4250 = 47650 / 155650 / 255650 ride beside an unknown published close', () => {
  const { a, closing, published } = savingsCase({ charge: 4250 });
  // The card spend is still owed from Bills and the current sweep is 4250
  // smaller, so Bills at each close equals the clean control's.
  const control = savingsCase();
  assert.deepEqual(FUTURE.map(s => cents(closing(s).cardMatchingEstimate.operatingCash)),
    FUTURE.map(s => cents(control.closing(s).operatingCash)));
  const next = a.payPeriodViews.find(p => p.start === FUTURE[0]);
  assert.equal(next.opening, null);
  assert.equal(next.cardMatchingEstimate.trust, 'estimated');
  // The public packet keeps the incumbent card reason; nothing is promoted.
  assert.equal(a.savingsFunding.status, 'unavailable');
  assert.equal(a.savingsFunding.reason, CARD_REASON);
  assert.equal(a.savingsFunding.backing.status, 'ready');
  assert.deepEqual(FUTURE.map(s => cents(closing(s).cardMatchingEstimate.stock)), [47650, 155650, 255650]);
  for (const s of FUTURE) {
    const c = closing(s);
    assert.equal(c.status, 'unavailable');
    assert.equal(c.stock, null, 'never zero, a stale close or an unmarked total');
    assert.equal(c.trust, 'unknown');
    assert.equal(c.estimateBasis, 'card-matching-unresolved');
    assert.deepEqual(c.estimateReasons, [CARD_REASON]);
    assert.equal(c.cardMatchingEstimate.nature, 'card-matching-estimate');
    assert.equal(c.cardMatchingEstimate.trust, 'estimated');
    assert.ok(c.cardMatchingEstimate.assumptions.some(t => /not counted as Bills cash already spent/.test(t)));
    // Ruling 7: the selector keeps the rest of the qualified packet and shows the close as unknown.
    const p = published(s);
    assert.ok(p, 'the projected packet is not nulled');
    assert.equal(p.forecastClosing.status, 'unavailable');
    assert.equal(p.forecastClosing.stock, null);
  }
});

test('a role-only card gives the same typed closes as a known card id', () => {
  const x = closingInput();
  x.plan.income.push({ id: 'p0', label: 'Invented current receipt', frequency: 'once',
    date: '2026-10-09', amount: 400, confidence: 'confirmed' });
  x.opts.currentPeriodActuals.transactions = (x.opts.currentPeriodActuals.transactions || [])
    .concat([{ ...purchase(42.5), atlasAccountId: 'amexgold' }]);
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const stock = s => cents(a.savingsFunding.periodViews.find(p => p.start === s).packet.forecastClosing.cardMatchingEstimate.stock);
  assert.deepEqual(FUTURE.map(stock), [47650, 155650, 255650]);
});

test('combined movement + card estimate: both reasons, never the movement-only nature', () => {
  const { a, closing } = savingsCase({ charge: 4250, movement: true });
  assert.equal(a.savingsFunding.backing.status, 'unavailable');
  assert.deepEqual(FUTURE.map(s => cents(closing(s).cardMatchingEstimate.stock)), [47650, 155650, 255650]);
  for (const s of FUTURE) {
    const c = closing(s);
    assert.equal(c.status, 'unavailable');
    assert.equal(c.estimateBasis, 'reported-balance-movement-and-card-matching');
    assert.equal(c.estimateReasons.length, 2);
    assert.equal(c.estimateReasons[1], CARD_REASON);
    assert.equal(c.cardMatchingEstimate.nature, 'reported-balance-and-card-matching-estimate');
    assert.notEqual(c.nature, 'reported-balance-estimate');
  }
});

test('movement-only control: the incumbent reported-balance estimate is unchanged (51900 / 159900 / 259900)', () => {
  const { closing, published } = savingsCase({ movement: true });
  assert.deepEqual(FUTURE.map(s => cents(closing(s).stock)), [51900, 159900, 259900]);
  for (const s of FUTURE) {
    assert.equal(closing(s).nature, 'reported-balance-estimate');
    assert.equal(published(s).forecastClosing.nature, 'reported-balance-estimate');
  }
});

test('ruling 8: the below-reserve branch is soft only on qualified operating cash', () => {
  const run = qualified => {
    const p = { windowDays: 120, defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
      opening: { asOf: '2026-10-07', paydaySnapshot: { periodStart: '2026-10-02', asOf: '2026-10-02', opening: 500 },
        representedEvents: [{ id: 'payroll', date: '2026-10-02' }] },
      startingCash: { breakdown: [{ id: 'chequing-a', value: 500 }, ...(qualified ? [{ id: 'chequing-b', value: 0 }] : [])] },
      income: [{ id: 'payroll', frequency: 'biweekly', anchor: '2026-10-02', amount: 1000, confidence: 'confirmed' }],
      bills: [], obligations: [], commitments: [], budget: { categories: [] } };
    const pkt = { schema: 'atlas-current-period-actuals/v1', observationAsOf: '2026-10-07', coverageStart: '2026-09-01',
      coverageThrough: '2026-10-07', pendingCoverage: 'complete', transactionCoverage: 'complete', representedActuals: [],
      transactions: [purchase(5000)] };
    const a = F.recommend(p, '2026-10-07', { weeklyVariable: 0, debts: [], currentPeriodActuals: pkt });
    assert.ok(a.cardPurchaseCoverage.issues.some(i => i.code === 'coverage-bills-backing-unconfirmed'));
    return a.payPeriodViews.filter(v => v.role !== 'lookback')[0];
  };
  assert.equal(run(true).plannedPeriodCloseTrust, 'estimated');
  // One chequing row is absent: the stock is not qualified, so the hold stays hard.
  const hard = run(false);
  assert.equal(hard.plannedPeriodClose, null);
  assert.notEqual(hard.plannedPeriodCloseTrust, 'estimated');
});

// Codex P1 on #812: when a later period's sweep is unknown, the closes already
// computed must still carry their estimate labels. Main publishes the
// movement-only estimate there with the clean nature; the card estimate leaked
// as a ready unlabelled close at the pre-repair head.
function missingLaterSweep({ charge = 0, movement = false }) {
  const x = closingInput();
  x.plan.income.push({ id: 'p0', label: 'Invented current receipt', frequency: 'once',
    date: '2026-10-09', amount: 400, confidence: 'confirmed' });
  x.plan.income.push({ id: 'late', label: 'Invented unknown receipt', frequency: 'once',
    date: '2026-10-30', amount: null, confidence: 'unknown' });
  x.opts.disabled = ['late'];
  if (movement) x.opts.currentPeriodActuals.savingsMovementUnconfirmed =
    [{ accountId: 'savings', reason: 'transaction-posting-status-unconfirmed' }];
  if (charge) x.opts.currentPeriodActuals.transactions = (x.opts.currentPeriodActuals.transactions || [])
    .concat([purchase(charge / 100)]);
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  return start => a.savingsFunding.periodViews.find(p => p.start === start).packet.forecastClosing;
}

test('a missing later sweep never lets an earlier card-matching close publish unlabelled', () => {
  const closing = missingLaterSweep({ charge: 4250 });
  const first = closing(FUTURE[0]);
  assert.equal(first.status, 'unavailable');
  assert.equal(first.stock, null);
  assert.equal(cents(first.cardMatchingEstimate.stock), 47650);
  assert.equal(first.cardMatchingEstimate.nature, 'card-matching-estimate');
  assert.equal(closing(FUTURE[1]).status, 'unavailable');
});

test('a missing later sweep keeps the movement-only estimate label on earlier closes', () => {
  const closing = missingLaterSweep({ movement: true });
  const first = closing(FUTURE[0]);
  assert.equal(first.status, 'ready');
  assert.equal(cents(first.stock), 51900);
  assert.equal(first.nature, 'reported-balance-estimate');
  assert.ok(first.verifiedReason, 'the withheld verified reason is named');
});
