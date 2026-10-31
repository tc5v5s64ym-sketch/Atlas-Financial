'use strict';
// PA-4a-2a (Astra #787 6534140193 §3 "One evidence view per run"; Muse
// sequencing on #787): every dependent card/Savings verdict reads coverage
// evidence through one strict completeness rule, so equivalent evidence gets
// an equal verdict on every path. The explicit 'complete' stamp and a
// supported {complete:true} object agree; truncation, continuation, a
// non-complete status, a contradictory window and absence stay hard.
// Synthetic fixtures; the live observer already emits the string stamps.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast'));
const closingInput = require('./fixtures/savings-future-closing-data');

const ASOF = '2026-10-07';
function plan() {
  return {
    windowDays: 120, defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: ASOF, paydaySnapshot: { periodStart: '2026-10-02', asOf: '2026-10-02', opening: 500 },
      representedEvents: [{ id: 'payroll', date: '2026-10-02' }] },
    startingCash: { breakdown: [{ id: 'chequing-a', value: 500 }] },
    income: [{ id: 'payroll', frequency: 'biweekly', anchor: '2026-10-02', amount: 1000, confidence: 'confirmed' }],
    bills: [], obligations: [], commitments: [], budget: { categories: [] },
  };
}
const card = date => ({ id: 'CARD-1', date, amount: 42.5, pending: false, currency: 'CAD',
  savingsPostingEvidence: 'posted', atlasAccountId: 'tdcc', accountRole: 'revolving-credit',
  categoryLabel: 'Groceries', coverageRef: 'cov-1' });
function packet(transactionCoverage, pendingCoverage) {
  return { schema: 'atlas-current-period-actuals/v1', observationAsOf: ASOF, coverageStart: '2026-09-01',
    coverageThrough: ASOF, pendingCoverage, transactionCoverage, representedActuals: [], transactions: [card('2026-10-05')] };
}
const coverageOf = (tx, pend) => F.recommend(plan(), ASOF,
  { weeklyVariable: 0, debts: [], currentPeriodActuals: packet(tx, pend) }).cardPurchaseCoverage;
const codes = cov => cov.issues.map(issue => issue.code).sort();
const HISTORY = 'coverage-history-incomplete';

test('card coverage: the complete string stamp and a supported complete object get the same verdict', () => {
  const stamp = coverageOf('complete', 'complete');
  assert.deepEqual(codes(stamp), ['coverage-opening-unconfirmed'], 'fixture: matching-only under the stamp');
  for (const [tx, pend] of [[{ complete: true }, 'complete'], ['complete', { complete: true }],
    [{ complete: true }, { complete: true }],
    [{ complete: true, status: 'complete', truncated: false, hasMore: false }, { complete: true, has_more: false }],
    [{ complete: true, startDate: '2026-09-01', endDate: ASOF }, 'complete']]) {
    const cov = coverageOf(tx, pend);
    assert.deepEqual(codes(cov), codes(stamp), JSON.stringify([tx, pend]));
    assert.equal(cov.status, stamp.status);
    assert.equal(cov.reason, stamp.reason);
  }
});

test('card coverage: incomplete, contradictory or absent evidence stays a hard history hold', () => {
  for (const [tx, pend] of [
    [{ complete: true, truncated: true }, 'complete'],
    [{ complete: true, hasMore: true }, 'complete'],
    [{ complete: true, has_more: true }, 'complete'],
    [{ complete: true, hasMore: 'true' }, 'complete'],
    [{ complete: 1 }, 'complete'],
    [{ complete: 'true' }, 'complete'],
    [{ complete: true, status: 'partial' }, 'complete'],
    [{ complete: false }, 'complete'],
    [{}, 'complete'],
    [[], 'complete'],
    ['truncated', 'complete'],
    [undefined, 'complete'],
    [{ complete: true, startDate: '2026-09-15', endDate: ASOF }, 'complete'],
    [{ complete: true, endDate: '2026-10-06' }, 'complete'],
    ['complete', { complete: true, status: 'bounded-window' }],
    ['complete', { complete: true, status: 'insufficient' }],
    ['complete', { complete: true, truncated: true }],
    ['complete', 'partial'],
    ['complete', undefined],
  ]) {
    const cov = coverageOf(tx, pend);
    assert.ok(codes(cov).includes(HISTORY), JSON.stringify([tx, pend]));
    assert.equal(cov.status, 'unavailable');
  }
});

// End to end: the same complete evidence must not flip the card hold between
// matching-only (planned close estimated) and hard (planned close unknown).
// On main the object form made the card path hard while the PA-1/S1 path
// accepted it; the whole recommend() publication now matches the stamp.
function closing(tx, pend) {
  const x = closingInput(), p = x.opts.currentPeriodActuals;
  p.transactionCoverage = tx; p.pendingCoverage = pend;
  p.transactions = (p.transactions || []).concat([card(x.asOf)]);
  return F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
}
const withoutCoverageEcho = a => JSON.stringify(a, (key, value) =>
  key === 'transactionCoverage' || key === 'pendingCoverage' ? undefined : value);

test('recommend: string and object evidence produce the same publication end to end', () => {
  const stamp = closing('complete', 'complete'), object = closing({ complete: true }, { complete: true });
  assert.deepEqual(codes(object.cardPurchaseCoverage), codes(stamp.cardPurchaseCoverage));
  assert.ok(!codes(object.cardPurchaseCoverage).includes(HISTORY));
  const trusts = a => a.payPeriodViews.filter(v => v.role !== 'lookback').slice(0, 3).map(v => v.plannedPeriodCloseTrust);
  assert.deepEqual(trusts(object), trusts(stamp));
  assert.deepEqual(trusts(stamp), ['estimated', 'estimated', 'estimated'], 'fixture: matching-only estimate');
  assert.equal(withoutCoverageEcho(object), withoutCoverageEcho(stamp), 'every published field agrees');
});

test('recommend: verdicts are stable across a cloned input and reversed call order', () => {
  const forms = [['complete', 'complete'], [{ complete: true }, { complete: true }]];
  const forward = forms.map(([tx, pend]) => withoutCoverageEcho(closing(tx, pend)));
  const reversed = forms.slice().reverse().map(([tx, pend]) => withoutCoverageEcho(closing(tx, pend))).reverse();
  assert.deepEqual(reversed, forward);
  const x = closingInput(), p = x.opts.currentPeriodActuals;
  p.transactionCoverage = { complete: true }; p.pendingCoverage = { complete: true };
  p.transactions = (p.transactions || []).concat([card(x.asOf)]);
  const before = JSON.stringify(x);
  const a1 = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const a2 = F.recommend(JSON.parse(before).plan, x.asOf, { ...JSON.parse(before).opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input mutation; the raw evidence is not rewritten');
  assert.equal(withoutCoverageEcho(a2), withoutCoverageEcho(a1));
});

// The PA-1 Savings evidence check (savingsDailyFunding). Status alone does not
// discriminate: an older provenance hold also withholds some of these, so the
// tests pin the period figure the strict check withholds and its reason.
const STRICT_REASON = 'Explicit complete current-cycle cash and transaction evidence is required.';
function savingsFor(mutate) {
  const x = closingInput(); mutate(x.opts.currentPeriodActuals);
  return F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] }).savingsFunding;
}

test('PA-1 Savings path: contradictory or incomplete evidence withholds the period figure with the strict reason', () => {
  const control = savingsFor(() => {});
  assert.equal(control.status, 'ready');
  assert.equal(control.rows[0].thisPeriod, 0, 'fixture: the control publishes a period figure');
  for (const [label, mutate] of [
    ['contradictory transaction window', p => { p.transactionCoverage = { complete: true, startDate: '2026-10-06', endDate: p.coverageThrough }; }],
    ['transaction hasMore', p => { p.transactionCoverage = { complete: true, hasMore: true }; }],
    ['transaction partial status', p => { p.transactionCoverage = { complete: true, status: 'partial' }; }],
    ['pending hasMore', p => { p.pendingCoverage = { complete: true, hasMore: true }; }],
    ['pending truncated', p => { p.pendingCoverage = { complete: true, truncated: true }; }],
    ['pending bounded window', p => { p.pendingCoverage = { complete: true, status: 'bounded-window' }; }],
  ]) {
    const s = savingsFor(mutate);
    assert.equal(s.status, 'unavailable', label);
    assert.equal(s.rows[0].thisPeriod, null, `${label}: period figure withheld, never 0`);
    assert.equal(s.reason, STRICT_REASON, label);
  }
});

test('PA-1 Savings path: string and object complete evidence publish the same Savings packet', () => {
  const stamp = savingsFor(p => { p.transactionCoverage = 'complete'; p.pendingCoverage = 'complete'; });
  const object = savingsFor(p => { p.transactionCoverage = { complete: true }; p.pendingCoverage = { complete: true }; });
  assert.equal(stamp.status, 'ready');
  assert.equal(withoutCoverageEcho(object), withoutCoverageEcho(stamp));
});

// The card-period publication reports the reconciler's allocations, so it
// reads coverage with the same strict rule.
test('card-period publication: string and object evidence report the same coverage; incomplete stays incomplete', () => {
  const window = { start: '2026-10-02', end: '2026-10-15' };
  const tdcc = (tx, pend) => F.cardPeriodMovements(plan(), [], ASOF, window,
    { currentPeriodActuals: packet(tx, pend) }).cards.find(card => card.id === 'tdcc');
  const stamp = tdcc('complete', 'complete');
  assert.deepEqual([stamp.postedCoverage, stamp.pendingCoverage], ['complete-provider-response', 'complete-provider-response']);
  const object = tdcc({ complete: true }, { complete: true });
  assert.equal(withoutCoverageEcho(object), withoutCoverageEcho(stamp));
  assert.equal(tdcc({ complete: true, hasMore: true }, 'complete').postedCoverage, 'incomplete');
  assert.equal(tdcc('complete', { complete: true, truncated: true }).pendingCoverage, 'unavailable');
});
