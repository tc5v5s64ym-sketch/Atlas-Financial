'use strict';
// Explicit exact-base/head synthetic comparison, separate from the normal suite.
// No household data, provider GET, persistent observations or cached allocations.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const Module = require('node:module'), path = require('node:path'), crypto = require('node:crypto');
const F = require('../public/forecast'), O = require('../scripts/provider-observe');
const fx = require('./fixtures/savings-daily-consumer-data');
const provider = require('./fixtures/savings-v2-observation-data');
const transferCutoffs = require('./fixtures/savings-transfer-cutoffs');
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const base = process.argv[2];
assert.match(base || '', /^[0-9a-f]{40}$/, 'supply an explicit full baseline SHA');
const root = path.resolve(__dirname, '..'), modules = new Map();
function baseline(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const m = new Module(path.join(root, file), module); modules.set(file, m);
  m.filename = path.join(root, file); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  const native = m.require.bind(m);
  m.require = id => id.startsWith('.') ? baseline(path.posix.normalize(path.posix.join(path.posix.dirname(file), id))
    + (path.posix.extname(id) ? '' : '.js')) : native(id);
  m._compile(cp.execFileSync('git', ['show', base + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 10000000 }), m.filename);
  return m.exports;
}
const Before = baseline('public/forecast.js');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let compared = 0;
function diff(a, b, at = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) { compared++; return []; }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => diff(a[key], b[key], at ? at + '.' + key : key));
  }
  return [{ path: at, before: a ?? null, after: b ?? null }];
}
const allowed = row => /^savingsFunding\.(goalAllocation|allocationDescription)$/.test(row.path)
  || /^savingsFunding\.rows\.\d+\.(saved|savedTrust)$/.test(row.path)
  || /^savingsFunding\.backing\.items\.\d+\.saved$/.test(row.path)
  || /^savingsFunding\.lenses\.\d+\.items\.\d+\.(saved|savedTrust)$/.test(row.path)
  || /^savingsFunding\.periodViews\.\d+\.packet\.stock\.reportedStock\.checkedAsOf$/.test(row.path)
  || /^savingsFunding\.manualInventory\.reportedStock\.checkedAsOf$/.test(row.path)
  || /^(savingsInventory\.reportedStock|savingsFunding\.stock\.reportedStock)\.checkedAsOf$/.test(row.path);
const cases = [];
function compare(name, data, coherence = false) {
  const inputHash = digest(data), opts = { weeklyVariable: 40, debts: [], ...data.liveOverlay };
  const a = JSON.parse(JSON.stringify(Before.recommend(data.plan, data.meta.asOf, opts)));
  const b = JSON.parse(JSON.stringify(F.recommend(data.plan, data.meta.asOf, opts)));
  assert.equal(digest(data), inputHash, 'both revisions leave the same invented input immutable');
  const changes = diff(a, b), unexpected = changes.filter(row => !allowed(row)
    && !(coherence && /^savingsFunding\.goalAllocation\.(status|reason)$/.test(row.path)));
  assert.deepEqual(unexpected, [], name + ': no cash, funding, card, budget, debt or proposal output outside Saved changes');
  cases.push({ name, inputSha256: inputHash, changedPaths: changes.map(row => row.path), unexpectedChanges: 0,
    ...(coherence ? { beforeSaved: a.savingsFunding.rows.map(row => row.saved),
      afterSaved: b.savingsFunding.rows.map(row => row.saved),
      reportedStock: b.savingsInventory.reportedStock.amount,
      goalAllocationStatus: b.savingsFunding.goalAllocation.status } : {}) });
}
for (const mode of ['ready', 'partial', 'full', 'returned', 'pending', 'unmatched', 'missing-stock', 'missing-cash', 'before-policy', 'saved-income', 'ranged-need']) compare('incumbent:' + mode, fx(mode));
for (const mode of ['valid-v2', 'stale-date', 'stale-both', 'prior-year', 'prior-household-day', 'blocked-prior-day',
  'withdrawal-stale', 'negative-stale', 'zero-stale', 'pending-movement', 'future-date', 'malformed-date',
  'foreign-currency', 'missing-account', 'duplicate-account']) compare('provider:' + mode, provider.served(mode, O).data);
for (const [a, b] of [[40000000000000.01, 40000000000000], [100000000, 0.29]]) {
  const data = fx('ready'); data.plan.commitments[0].amount = 60.01;
  data.plan.savingsPoolObservation.accounts[0].value = a;
  data.plan.savingsPoolObservation.accounts[1].value = b;
  compare('exact-cent-boundary:' + a + '+' + b, data);
}
if (process.env.ATLAS_SAVINGS_COHERENCE_PROOF === '1') {
  for (const mode of ['double-count', 'inverse', 'opposite-direction', 'same-day', 'same-day-one',
    'both-before', 'both-after', 'coherent-split-dates', 'exact-cents', 'unrelated-mixed', 'zero', 'zero-movement',
    'unknown-stock', 'pending', 'missing-pending', 'currency', 'missing-currency', 'fractional', 'string-amount',
    'null-amount', 'date', 'impossible-date', 'future-date', 'alias', 'alias-outside', 'missing-id', 'malformed-id',
    'role', 'duplicate', 'ambiguous-reference', 'duplicate-id-elsewhere', 'unmatched', 'unknown-coverage',
    'missing-coverage', 'coverage-gap', 'unknown-observation', 'packet-currency', 'split-posting-dates']) {
    const input = transferCutoffs(mode);
    compare('cutoff:' + mode, { plan: input.plan, meta: { asOf: input.asOf }, liveOverlay: input.opts }, true);
  }
}
const sourceFiles = ['public/forecast.js', 'public/savings-inventory.js', 'public/plan.js', 'public/budget-blend.js'];
const fs = require('node:fs');
const binding = process.env.ATLAS_SAVINGS_COHERENCE_PROOF === '1' ? captureSourceBinding(root,
  [...sourceFiles, 'scripts/provider-observe.js', 'test/proof-savings-latest-known-allocation.js',
    'test/proof-source-binding.js', 'test/fixtures/savings-daily-consumer-data.js',
    'test/fixtures/savings-daily-allocation-contract.js', 'test/fixtures/savings-v2-observation-data.js',
    'test/fixtures/savings-transfer-cutoffs.js', 'test/fixtures/budget-funding-data.js'], base) : null;
const sourceBinding = Object.fromEntries(sourceFiles.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
if (binding) verifySourceBinding(root, binding);
console.log(JSON.stringify({ outcome: 'PASS', base, head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceBinding, ...(binding ? { executionBinding: binding } : {}), cases, equalSubtrees: compared, unexpectedChanges: 0 }, null, 2));
