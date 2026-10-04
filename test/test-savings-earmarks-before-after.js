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
// This immutable no-card-evidence probe isolates savings configuration.
delete data.plan.cardPurchaseCoverage;
const opts = { debts: data.debts, extraFacilities: data.revolvingExtra };
const old = before.recommend(data.plan, AS_OF, opts), current = F.recommend(data.plan, AS_OF, opts);
assert.equal(typeof before.savingsInventory, 'undefined'); assert.equal(old.savingsInventory, undefined);
assert.notEqual(old.planSpendPaydayFunding.status, 'unavailable', 'old zero-baseline instruction remains active on configured intent');
assert.equal(current.planSpendPaydayFunding.status, 'unavailable');
assert.deepEqual(current.savingsInventory.pools.map(p => [p.intent, p.unallocated]), [[247.80, 53.37], [99.99, 44.09]]);
const empty = clone(data.plan); delete empty.savingsEarmarks; delete empty.savingsPoolObservation;
const legacyBefore = before.recommend(empty, AS_OF, opts), legacyAfter = F.recommend(empty, AS_OF, opts);
const inventory = legacyAfter.savingsInventory; delete legacyAfter.savingsInventory;
assert.equal(inventory.status, 'setup-unknown');
assert.deepEqual(legacyAfter, legacyBefore, 'entire incumbent recommend publication is unchanged with absent configuration');
empty.savingsEarmarks = { version: 1, currency: 'CAD', pools: [], history: [] };
const explicitEmpty = F.recommend(empty, AS_OF, opts); delete explicitEmpty.savingsInventory;
assert.deepEqual(explicitEmpty, before.recommend(empty, AS_OF, opts), 'explicitly empty configuration also preserves the incumbent publication');
console.log('PASS immutable before/after against ' + BASE + ': missing inventory and unsafe incremental instruction reproduced; configured reconciliation/withholding proved; complete incumbent recommend preserved when absent or empty');
