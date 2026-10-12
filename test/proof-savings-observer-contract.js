'use strict';
// Exact pre-repair RED and repaired observer -> overlay -> Forecast controls.
// Every input and numeric oracle is invented, never loaded from household data.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const Module = require('node:module'), path = require('node:path'), crypto = require('node:crypto');
const observed = require('./fixtures/savings-observer-contract-data');
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const root = path.resolve(__dirname, '..'), base = process.argv[2], cache = new Map();
assert.match(base || '', /^[0-9a-f]{40}$/, 'explicit full pre-repair SHA is required');
function baseline(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const m = new Module(path.join(root, file), module); cache.set(file, m);
  m.filename = path.join(root, file); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  const native = m.require.bind(m);
  m.require = id => id.startsWith('.') ? baseline(path.posix.normalize(path.posix.join(path.posix.dirname(file), id))
    + (path.posix.extname(id) ? '' : '.js')) : native(id);
  m._compile(cp.execFileSync('git', ['show', base + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 10000000 }), m.filename);
  return m.exports;
}
const files = Object.keys(require.cache).filter(file => file.startsWith(root + path.sep))
  .map(file => path.relative(root, file).replace(/\\/g, '/'));
const binding = captureSourceBinding(root, files, base);
const O = baseline('scripts/provider-observe.js'), L = baseline('scripts/live-plan.js'), F = baseline('public/forecast.js');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const modes = ['valid', 'valid-transfer', 'undated', 'null-amount', 'malformed-amount', 'undated-pending',
  'foreign-currency', 'missing-currency', 'malformed-date', 'pending', 'incomplete', 'pending-incomplete'];
const cases = modes.map(mode => {
  const after = observed(mode), input = after.input, beforeInput = hash(input);
  const report = O.observe({ provider: 'lunchmoney', ...input });
  const packet = hash(report.currentPeriodActuals), pools = hash(report.savingsPools);
  const { data } = L.overlayLiveState({ data: input.data, report });
  assert.deepEqual(data.liveOverlay.currentPeriodActuals, report.currentPeriodActuals);
  assert.deepEqual(data.plan.savingsPoolObservation, report.savingsPools);
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, debts: data.debts, ...data.liveOverlay });
  assert.equal(hash(input), beforeInput);
  assert.equal(hash(report.currentPeriodActuals), packet);
  assert.equal(hash(report.savingsPools), pools);
  const expected = mode === 'valid' ? [60, 24, 35] : mode === 'valid-transfer' ? [60, 24, 45] : [null, null, null];
  const oldSaved = advice.savingsFunding.backing.items.map(row => row.saved);
  const newSaved = after.advice.savingsFunding.backing.items.map(row => row.saved);
  assert.deepEqual(newSaved, expected, 'independent 11900 or 12900 cents distributed as 6000 + 2400 + residual');
  const oldPass = JSON.stringify(oldSaved) === JSON.stringify(expected);
  return { mode, inputSha256: beforeInput, originalActualsSha256: packet, originalPoolsSha256: pools,
    expected, beforeSaved: oldSaved, afterSaved: newSaved, beforePass: oldPass, afterPass: true,
    packetCurrencyPresent: Object.hasOwn(report.currentPeriodActuals, 'currency'),
    packetsUnchangedThroughOverlayAndForecast: true };
});
assert.deepEqual(cases.filter(row => !row.beforePass).map(row => row.mode),
  ['valid', 'valid-transfer', 'undated', 'null-amount', 'malformed-amount', 'undated-pending']);
verifySourceBinding(root, binding);
console.log(JSON.stringify({ outcome: 'PASS', base, executionBinding: binding,
  before: { controls: 12, pass: 6, fail: 6, aggregate: 'FAIL' },
  after: { controls: 12, pass: 12, fail: 0, aggregate: 'PASS' }, cases }, null, 2));
