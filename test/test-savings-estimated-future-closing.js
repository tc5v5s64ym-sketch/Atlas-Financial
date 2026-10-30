'use strict';
// PA-1 (Decision 1, owner 2026-10-29): when a Savings movement cannot be
// uniquely qualified, future periods publish Savings at period close and
// per-goal Saved tagged ESTIMATED with the reason named, instead of
// withholding. Verified backing and current-period figures are unchanged.
// All ledgers and literal expected cents are independently invented.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const F = require(path.join(process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..'), 'public/forecast'));
const input = require('./fixtures/savings-future-closing-data');

const MOVEMENT_REASON = 'A savings movement lacks unique, qualified posted evidence.';
const FUTURE = ['2026-10-16', '2026-10-30', '2026-11-13', '2026-11-27', '2026-12-11'];

function scenario(unqualified) {
  const x = input();
  x.plan.income.push({ id: 'p0', label: 'Invented current receipt', frequency: 'once',
    date: '2026-10-09', amount: 400, confidence: 'confirmed' });
  if (unqualified) x.opts.currentPeriodActuals.savingsMovementUnconfirmed =
    [{ accountId: 'savings', reason: 'transaction-posting-status-unconfirmed' }];
  return x;
}
function advice(x) {
  const before = JSON.stringify(x);
  const result = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before, 'no input, settlement or source mutation');
  return result;
}
function closing(a, start) {
  const view = a.savingsFunding.periodViews.find(p => p.start === start);
  assert.ok(view, `selected native period ${start} exists`);
  const p = F.savingsFundingPublication(a.savingsFunding, { asOf: a.savingsFunding.asOf, advice: a, periodId: view.id });
  assert.ok(p, `publication for ${start} is not nulled by the closing shape`);
  assert.ok(p.forecastClosing, 'Forecast owns the selected-period closing projection');
  return p.forecastClosing;
}
const stocks = a => FUTURE.map(start => closing(a, start).stock);

test('clean case is unchanged: verified closings, openings and sweeps', () => {
  const a = advice(scenario(false));
  assert.equal(a.savingsFunding.backing.status, 'ready');
  assert.deepEqual(stocks(a), [519, 1599, 2599, 2599, 1099]);
  for (const start of FUTURE) {
    const c = closing(a, start);
    assert.equal(c.status, 'ready', c.reason);
    // A future close is always a projection (trust estimated); the qualified
    // walk keeps its own nature and is never relabelled as the fallback.
    assert.equal(c.nature, 'if-eligible-surplus-saved');
    assert.equal(c.verifiedReason ?? null, null);
  }
  const views = a.payPeriodViews.filter(p => FUTURE.includes(p.start));
  assert.deepEqual(views.map(v => v.paydaySweep), [1080, 1000, 0, 0, 0]);
});

test('one unqualified movement: future closings publish tagged estimated with the reason', () => {
  const a = advice(scenario(true));
  // Verified backing stays withheld with the same reason; nothing is promoted.
  assert.equal(a.savingsFunding.backing.status, 'unavailable');
  assert.ok(a.savingsFunding.backing.reason.startsWith(MOVEMENT_REASON), a.savingsFunding.backing.reason);
  for (const start of FUTURE) {
    const c = closing(a, start);
    assert.equal(c.status, 'ready', `${start}: ${c.reason}`);
    assert.equal(c.trust, 'estimated', `${start} is tagged estimated`);
    assert.equal(c.nature, 'reported-balance-estimate');
    assert.ok(Number.isFinite(c.stock), `${start} publishes a Savings at period close`);
    assert.ok(String(c.verifiedReason || '').startsWith(MOVEMENT_REASON), 'the withholding reason is named');
    assert.ok(Array.isArray(c.assumptions) && c.assumptions.length > 0, 'assumptions are stated');
    assert.match(String(c.balanceAsOf || ''), /^\d{4}-\d{2}-\d{2}$/, 'the reported balance date is named');
    assert.equal(c.actualSaved ?? null, null, 'an estimate is never actual saved money');
    assert.equal(c.moneyMovementPermission, 'not-granted');
    assert.ok(Array.isArray(c.items) && c.items.length > 0, 'per-goal Saved is published');
    for (const item of c.items) assert.ok(Number.isFinite(item.forecastSaved), `${item.key || item.id} Saved is numeric`);
    const allocated = c.items.reduce((sum, i) => sum + i.forecastSaved, 0) + (c.unallocated || 0);
    assert.equal(Math.round(allocated * 100), Math.round(c.stock * 100), `${start}: goal allocations conserve the pot`);
  }
});

test('estimated pool rolls forward: sweeps land and goals pay on their dates', () => {
  const clean = stocks(advice(scenario(false)));
  const est = stocks(advice(scenario(true)));
  // The first future close starts from the reported balance plus a
  // non-negative estimated boundary credit.
  assert.ok(est[0] >= 119, 'estimate never drops below the reported balance');
  // Planned Savings moves across future periods.
  assert.ok(new Set(est).size > 1, 'Savings at period close is not frozen at one value');
  // Conservation: once the next payday sweep lands, money only moves between
  // Bills and Savings, so later closes match the verified walk whatever the
  // boundary assumption was.
  assert.deepEqual(est.slice(1), clean.slice(1));
  // The invented 1500 goal pays on its December date exactly once.
  assert.equal(est[3] - est[4], 1500);
});

test('current-period figures are untouched by the estimate', () => {
  const pick = a => {
    const v = a.payPeriodViews.find(p => p.start === '2026-10-02');
    return { income: v.incomeTotal, bad: v.balanceAfterDeductions, opening: v.opening };
  };
  assert.deepEqual(pick(advice(scenario(true))), pick(advice(scenario(false))));
});
