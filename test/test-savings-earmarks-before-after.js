'use strict';
// Immutable prior engine on identical synthetic inputs. This is acceptance
// evidence against fresh main, not a replacement for the full financial suite.
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const F = require('../public/forecast');
const { AS_OF, fixture, observedPlan, clone } = require('./fixtures/savings-earmarks');
const BASE = '210fb231bff9422fa9eca568b4e0acb68cece854';
const ROOT = path.join(__dirname, '..');
const source = execFileSync('git', ['show', BASE + ':public/forecast.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
const prior = new Module(path.join(ROOT, 'public', 'forecast-before-savings.cjs'));
prior.filename = path.join(ROOT, 'public', 'forecast-before-savings.cjs');
prior.paths = Module._nodeModulePaths(path.dirname(prior.filename)); prior._compile(source, prior.filename);
const before = prior.exports, { data } = fixture(); data.plan = observedPlan();
const opts = { debts: data.debts, extraFacilities: data.revolvingExtra };
const old = before.recommend(data.plan, AS_OF, opts), current = F.recommend(data.plan, AS_OF, opts);
assert.equal(typeof before.savingsInventory, 'undefined'); assert.equal(old.savingsInventory, undefined);
assert.notEqual(old.planSpendPaydayFunding.status, 'unavailable', 'old zero-baseline instruction remains active on configured intent');
assert.equal(current.planSpendPaydayFunding.status, 'unavailable');
assert.deepEqual(current.savingsInventory.pools.map(p => [p.intent, p.unallocated]), [[247.80, 53.37], [99.99, 44.09]]);
const empty = clone(data.plan); delete empty.savingsEarmarks; delete empty.savingsPoolObservation;
const legacyBefore = before.recommend(empty, AS_OF, opts), legacyAfter = F.recommend(empty, AS_OF, opts);
// Budget progress deliberately adds a read-only namespace to period records.
// Validate that namespace on each concrete publication path, then compare
// every incumbent field to the immutable engine. No money/trust field is
// omitted, no baseline moves, and unexpected additions still fail equality.
function incumbentPublication(value) {
  const copy = clone(value);
  const periodSets = [copy.defaultView.calendarPeriods, copy.pastPeriodViews, copy.payPeriodViews];
  let count = 0;
  for (const periods of periodSets) for (const period of periods) {
    const progress = period.budgetProgress;
    assert.equal(period.budgetProgressAsOf, AS_OF);
    assert.equal(progress.source, 'Forecast.budgetPeriodProgress');
    assert.equal(progress.asOf, AS_OF);
    assert.equal(progress.start, period.start); assert.equal(progress.end, period.end);
    assert.equal(progress.currency, 'CAD');
    assert.ok(Array.isArray(progress.savings.goals));
    for (const goal of progress.savings.goals) {
      assert.equal(goal.status, 'not-confirmed');
      assert.equal(goal.fulfilled.amount, null); assert.equal(goal.remaining.amount, null);
    }
    if (progress.role === 'future') for (const name of ['income', 'bills', 'household', 'savings']) {
      assert.equal(progress[name].actual.amount, null, 'future projections never become fulfilled actuals');
    }
    delete period.budgetProgress; delete period.budgetProgressAsOf; count++;
  }
  assert.ok(count > 0, 'new namespaces are positively validated before comparison');
  return copy;
}
const inventory = legacyAfter.savingsInventory; delete legacyAfter.savingsInventory;
assert.equal(inventory.status, 'setup-unknown');
assert.deepEqual(incumbentPublication(legacyAfter), legacyBefore, 'every incumbent recommend field is unchanged with absent configuration');
const changedBalance = clone(legacyAfter); changedBalance.binding.balance += 1;
assert.throws(() => assert.deepEqual(incumbentPublication(changedBalance), legacyBefore),
  assert.AssertionError, 'a changed incumbent balance is still detected');
const changedTrust = clone(legacyAfter); changedTrust.defaultView.calendarPeriods[0].afterBillsTrust = 'unavailable';
assert.throws(() => assert.deepEqual(incumbentPublication(changedTrust), legacyBefore),
  assert.AssertionError, 'a changed incumbent trust field is still detected');
const changedPublisher = clone(legacyAfter); changedPublisher.payPeriodViews[0].budgetProgress.source = 'page';
assert.throws(() => incumbentPublication(changedPublisher), assert.AssertionError,
  'an unauthorized new publisher is rejected rather than excluded silently');
empty.savingsEarmarks = { version: 1, currency: 'CAD', pools: [], history: [] };
const explicitEmpty = F.recommend(empty, AS_OF, opts); delete explicitEmpty.savingsInventory;
assert.deepEqual(incumbentPublication(explicitEmpty), before.recommend(empty, AS_OF, opts), 'explicitly empty configuration also preserves every incumbent field');
console.log('PASS immutable before/after against ' + BASE + ': missing inventory and unsafe incremental instruction reproduced; configured reconciliation/withholding proved; complete incumbent recommend preserved when absent or empty');
