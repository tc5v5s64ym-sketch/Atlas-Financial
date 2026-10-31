'use strict';
// Synthetic conservation proof for the owner-approved simplified #620 contract.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const fixture = require('./fixtures/savings-future-closing-data');
const fx = require('./fixtures/savings-daily-allocation-contract');
function advice(x) {
  const before = JSON.stringify(x);
  const a = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before);
  return a;
}
const period = (a, start) => a.payPeriodViews.find(p => p.start === start);
function close(a, start) {
  const p = a.savingsFunding.periodViews.find(p => p.start === start);
  return F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: p.id }).forecastClosing;
}
function ordinary(x, amount, extra = {}) {
  x.opts.currentPeriodActuals.transactions.push({ id: 'ordinary', date: '2026-10-04', amount,
    pending: false, currency: 'CAD', savingsPostingEvidence: 'posted',
    atlasAccountId: 'chequing-a', accountRole: 'household-cash', ...extra });
}
function pair() { const x = fixture(); fx.transfer(x, 50, 'AA101', 'savings', '2026-10-05'); return x; }
function livePair(amount = 37) {
  const x = fixture(); fx.transfer(x, amount, 'AA401', 'savings', '2026-10-05');
  x.opts.operatingPlan = 'live';
  x.opts.observedCash = { complete: true, asOf: x.asOf,
    accounts: x.plan.startingCash.breakdown.filter(row => ['chequing-a', 'chequing-b'].includes(row.id))
      .map(row => ({ id: row.id, value: row.value, evidenceDate: x.asOf, status: 'verified', confidence: 'verified' })) };
  return x;
}
function held(a) {
  for (const date of ['2026-10-16', '2026-10-30', '2026-11-13']) {
    assert.equal(period(a, date).opening, null, date + ': dependent opening unknown');
    assert.equal(period(a, date).paydaySweep, null, date + ': dependent sweep unknown');
    assert.equal(close(a, date).status, 'unavailable', date + ': no fallback credit');
    assert.equal(close(a, date).stock, null);
  }
}
for (const [field, value] of [['status', 'unavailable'], ['confidence', 'unknown'], ['unknown', true]]) {
  test('explicit live observed Bills ' + field + '=' + value + ' withholds the dependent chain', () => {
    const x = livePair(); x.opts.observedCash.accounts[0][field] = value;
    const a = advice(x);
    assert.equal(a.savingsFunding.period.status, 'unavailable');
    held(a);
    assert.deepEqual(advice(x), a, 'replay cannot restore an unqualified observation');
  });
}
for (const transfer of [37, 80]) test('qualified live Bills ' + (80 - transfer) + ' remains known, including zero', () => {
  const x = livePair(transfer), a = advice(x);
  assert.equal(period(a, '2026-10-16').opening, 80 - transfer);
  assert.equal(period(a, '2026-10-16').paydaySweep, 1080 - transfer);
  assert.equal(close(a, '2026-11-13').stock, 2199);
  assert.equal(close(a, '2026-11-13').operatingCash, 0);
  assert.deepEqual(advice(x), a);
});
for (const inflow of [30, 37]) test('all observed Bills inflow ' + inflow + ' reaches the shared sweep', () => {
  const x = fixture(); ordinary(x, -inflow); x.plan.startingCash.breakdown[0].value += inflow;
  const a = advice(x);
  assert.equal(period(a, '2026-10-16').opening, 80 + inflow);
  assert.equal(period(a, '2026-10-16').paydaySweep, 1080 + inflow);
  assert.equal(close(a, '2026-10-30').contribution, 1080 + inflow);
  assert.equal(close(a, '2026-11-13').stock, 119 + 80 + inflow + 1000 + 1000);
  assert.equal(close(a, '2026-11-13').operatingCash, 0);
});
for (const other of [0, 20, 777]) test('observed transfer is already in Bills30; exclude other account ' + other, () => {
  const x = pair(); x.plan.startingCash.breakdown[1].value = other; x.plan.opening.paydaySnapshot.opening += other;
  const a = advice(x);
  assert.equal(period(a, '2026-10-16').opening, 30);
  assert.equal(period(a, '2026-10-16').paydaySweep, 1030);
  assert.equal(close(a, '2026-10-30').contribution, 1030);
  assert.equal(close(a, '2026-11-13').stock, 169 + 30 + 1000 + 1000);
  assert.equal(close(a, '2026-11-13').operatingCash, other);
});
const invalid = {
  'null amount': x => ordinary(x, null),
  'empty amount': x => ordinary(x, ''),
  'boolean amount': x => ordinary(x, false),
  'numeric string amount': x => ordinary(x, '0'),
  'nonfinite amount': x => ordinary(x, Infinity),
  'missing transaction currency': x => ordinary(x, 0, { currency: null }),
  'conflicting packet currency': x => { x.opts.currentPeriodActuals.currency = 'USD'; },
  'missing identity': x => ordinary(x, 10, { id: null }),
  'missing location': x => ordinary(x, 10, { atlasAccountId: null }),
  'unconfigured cash location': x => ordinary(x, 10, { atlasAccountId: 'unknown-household' }),
  'conflicting aliases': x => ordinary(x, 0, { accountId: 'savings' }),
  'stale observation': x => { x.opts.currentPeriodActuals.observationAsOf = '2026-10-06'; },
  'incomplete fetch': x => { x.opts.currentPeriodActuals.savingsFetchCoverage.complete = false; },
  'conflicting window': x => { x.opts.currentPeriodActuals.transactionWindow = { complete: false, startDate: '2026-10-02', endDate: x.asOf }; },
  'conflicting complete coverage dates': x => { x.opts.currentPeriodActuals.transactionCoverage = { complete: true, startDate: '2026-10-06', endDate: x.asOf }; },
  'missing fetch': x => { delete x.opts.currentPeriodActuals.savingsFetchCoverage; },
  'incomplete interval': x => { x.opts.currentPeriodActuals.transactionCoverage.complete = false; },
  'dropped Bills row despite READY funding': x => { x.opts.currentPeriodActuals.savingsMovementUnconfirmed.push({ accountId: 'chequing-a', reason: 'transaction-amount-or-date-unconfirmed' }); },
  'pending Bills movement': x => ordinary(x, 0, { pending: true }),
  'stale Bills row': x => { x.plan.startingCash.breakdown[0].evidenceDate = '2026-10-06'; },
  'invalid Bills stock': x => { x.plan.startingCash.breakdown[0].value = ''; },
  'coerced snapshot': x => { x.plan.opening.paydaySnapshot.opening = '80'; },
};
for (const [label, mutate] of Object.entries(invalid)) test(label + ' cannot gain trust from a paired transfer', () => {
  const x = pair(); mutate(x); const a = advice(x); held(a);
  if (label.startsWith('dropped Bills')) {
    assert.equal(a.savingsFunding.period.status, 'ready', 'independent current funding is retained');
    assert.equal(a.savingsFunding.period.transferred, 50);
  }
});
test('a known zero and a negative stock are not unknown', () => {
  for (const bills of [0, -20]) {
    const x = fixture(); x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = bills;
    const a = advice(x);
    assert.equal(period(a, '2026-10-16').opening, bills);
    assert.equal(period(a, '2026-10-16').paydaySweep, 1000 + bills);
  }
});
test('midperiod stock without a boundary or reconciliation does not establish a sweep', () => {
  const x = pair(); delete x.plan.opening.paydaySnapshot; held(advice(x));
});
test('a direct payday observation establishes the Bills basis without a historical snapshot', () => {
  const x = fixture(); fx.advance(x, '2026-10-02');
  x.plan.savingsEarmarks.allocationPolicy.effectiveFrom = x.asOf;
  delete x.plan.opening.paydaySnapshot;
  const a = advice(x);
  assert.equal(period(a, '2026-10-02').openingSource, 'payday-morning');
  assert.equal(period(a, '2026-10-16').opening, 80);
  assert.equal(period(a, '2026-10-16').paydaySweep, 1080);
});
test('current pooled funding READY cannot borrow another account for the Bills sweep seam', () => {
  const x = fixture();
  x.plan.income.push({ id: 'other-credit', frequency: 'once', date: '2026-10-04', amount: 200, confidence: 'confirmed' });
  x.plan.startingCash.breakdown[1].value = 200;
  x.opts.currentPeriodActuals.representedActuals.push({ id: 'other-credit', date: '2026-10-04', actual: 200, transactionId: 'other-credit' });
  ordinary(x, -200, { id: 'other-credit', atlasAccountId: 'chequing-b', isIncome: true, incomeId: 'other-credit' });
  const a = advice(x);
  assert.equal(a.savingsFunding.period.status, 'ready', 'existing current funding remains independent');
  assert.equal(a.savingsFunding.period.projectedRemainingCapacity, 200);
  held(a); // Bills80 cannot supply a200 credit; other200 is excluded.
});
for (const amount of [null, '', false, Infinity]) test('invalid planned future receipt ' + String(amount) + ' cannot produce a known sweep', () => {
  const x = fixture(); x.plan.income[1].amount = amount;
  const a = advice(x);
  assert.equal(period(a, '2026-10-16').paydaySweep, null);
  assert.equal(period(a, '2026-10-30').opening, null);
  assert.equal(close(a, '2026-10-30').status, 'unavailable');
});
