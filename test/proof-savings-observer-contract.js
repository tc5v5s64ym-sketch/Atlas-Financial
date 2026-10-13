'use strict';
// Exact pre-repair RED and repaired observer -> overlay -> Forecast controls.
// Every input and numeric oracle is invented, never loaded from household data.
const assert = require('node:assert/strict'), cp = require('node:child_process');
const Module = require('node:module'), path = require('node:path'), crypto = require('node:crypto');
const observed = require('./fixtures/savings-observer-contract-data');
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const root = path.resolve(__dirname, '..'), base = process.argv[2], windowBase = process.argv[3], fetchBase = process.argv[4], postingBase = process.argv[5], cache = new Map();
assert.match(base || '', /^[0-9a-f]{40}$/, 'explicit full pre-repair SHA is required');
assert.match(windowBase || '', /^[0-9a-f]{40}$/, 'explicit full window pre-repair SHA is required');
assert.match(fetchBase || '', /^[0-9a-f]{40}$/, 'explicit full fetch pre-repair SHA is required');
assert.match(postingBase || '', /^[0-9a-f]{40}$/, 'explicit full posting pre-repair SHA is required');
function baseline(file, sha = base) {
  const key = sha + ':' + file;
  if (cache.has(key)) return cache.get(key).exports;
  const m = new Module(path.join(root, file), module); cache.set(key, m);
  m.filename = path.join(root, file); m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  const native = m.require.bind(m);
  m.require = id => id.startsWith('.') ? baseline(path.posix.normalize(path.posix.join(path.posix.dirname(file), id))
    + (path.posix.extname(id) ? '' : '.js'), sha) : native(id);
  m._compile(cp.execFileSync('git', ['show', sha + ':' + file], { cwd: root, encoding: 'utf8', maxBuffer: 10000000 }), m.filename);
  return m.exports;
}
const files = Object.keys(require.cache).filter(file => file.startsWith(root + path.sep))
  .map(file => path.relative(root, file).replace(/\\/g, '/'));
files.push('test/fixtures/budget-funding-data.js'); // Lazy consumer fixture is part of the executed input.
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
const WindowBefore = baseline('public/forecast.js', windowBase), Current = require('../public/forecast');
const windowCases = [];
function windowControl(mode, list = 'empty', bank = 'prior-year') {
  const x = observed.windowObservation(mode, list, bank), inputHash = hash(x.data), packetHash = hash(x.packet);
  const opts = { weeklyVariable: 40, debts: x.data.debts, ...x.data.liveOverlay, currentPeriodActuals: x.packet };
  const before = WindowBefore.recommend(x.data.plan, x.data.meta.asOf, opts);
  const after = Current.recommend(x.data.plan, x.data.meta.asOf, opts);
  const ready = ['complete', 'unrelatedFlag', 'unrelated-card', 'unrelated-unmapped', 'card-with-savings-fee'].includes(mode);
  const expected = ready ? [95, 24] : [null, null];
  const beforeSaved = before.savingsFunding.rows.map(row => row.saved), afterSaved = after.savingsFunding.rows.map(row => row.saved);
  assert.deepEqual(afterSaved, expected); assert.deepEqual(after.savingsFunding.rows.map(row => row.needed), [230, 24]);
  assert.equal(after.savingsInventory.reportedStock.amount, 119); assert.equal(after.savingsFunding.period.proposal, null);
  if (!ready) assert.ok(after.sim.events.every(row => !row.reserveFunding));
  assert.equal(after.savingsFunding.moneyMovementPermission, 'not-granted');
  assert.equal(hash(x.data), inputHash); assert.equal(hash(x.packet), packetHash);
  assert.equal(JSON.stringify(x.report), x.originalReport);
  let midnight = null;
  if (['complete', 'unrelatedFlag'].includes(mode)) {
    x.data.meta.asOf = x.data.plan.opening.asOf = '2026-10-06';
    const next = Current.recommend(x.data.plan, x.data.meta.asOf, opts).savingsFunding;
    assert.deepEqual(next.rows.map(row => row.saved), expected); assert.equal(next.goalAllocation.status, 'ready');
    assert.equal(next.goalAllocation.checkedAsOf, after.savingsFunding.goalAllocation.checkedAsOf);
    assert.deepEqual(next.goalAllocation.balanceDates, after.savingsFunding.goalAllocation.balanceDates);
    midnight = { ready: true, saved: expected, checkedAsOf: next.goalAllocation.checkedAsOf, datesUnchanged: true };
  }
  windowCases.push({ mode, list, bank, inputSha256: inputHash, actualsSha256: packetHash, expected,
    beforeSaved, afterSaved, beforePass: JSON.stringify(beforeSaved) === JSON.stringify(expected), afterPass: true,
    reportedStock: 119, knownNeeded: [230, 24], check: after.savingsFunding.goalAllocation.checkedAsOf,
    bankDates: after.savingsFunding.goalAllocation.balanceDates, returnedPacketsUnchanged: true,
    ...(midnight ? { midnight } : {}) });
}
for (const list of ['empty', 'unrelated', 'zero']) for (const mode of observed.windowModes) windowControl(mode, list);
for (const mode of observed.rawWindowModes) for (const bank of ['prior-year', 'valid-v2']) windowControl(mode, 'empty', bank);
for (const mode of ['unrelated-card', 'unrelated-unmapped', 'card-with-savings-fee'])
  windowControl(mode, 'empty', mode === 'card-with-savings-fee' ? 'valid-v2' : 'prior-year');
const windowFailures = windowCases.filter(row => !row.beforePass).length;
assert.equal(windowCases.length, 82); assert.equal(windowFailures, 74);
const FetchBefore = baseline('public/forecast.js', fetchBase), ObserverBefore = baseline('scripts/provider-observe.js', fetchBase);
const OverlayBefore = baseline('scripts/live-plan.js', fetchBase), fetchCases = [];
for (const mode of observed.sourceWindowModes) for (const list of ['empty', 'unrelated', 'zero'])
  for (const bank of ['prior-year', 'valid-v2']) {
    const x = observed.windowObservation(mode, list, bank), inputHash = hash(x.input);
    const original = ObserverBefore.observe({ provider: 'lunchmoney', ...x.input }), originalHash = hash(original);
    const data = OverlayBefore.overlayLiveState({ data: x.input.data, report: original }).data;
    assert.deepEqual(data.liveOverlay.currentPeriodActuals, original.currentPeriodActuals);
    const before = FetchBefore.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, debts: data.debts, ...data.liveOverlay });
    const after = Current.recommend(x.data.plan, x.data.meta.asOf,
      { weeklyVariable: 40, debts: x.data.debts, ...x.data.liveOverlay });
    assert.deepEqual(after.savingsFunding.rows.map(row => row.saved), [null, null]);
    assert.deepEqual(after.savingsFunding.rows.map(row => row.needed), [230, 24]);
    assert.equal(after.savingsInventory.reportedStock.amount, 119); assert.equal(after.savingsFunding.period.proposal, null);
    assert.ok(after.sim.events.every(row => !row.reserveFunding));
    assert.equal(hash(x.input), inputHash); assert.equal(hash(original), originalHash); assert.equal(JSON.stringify(x.report), x.originalReport);
    fetchCases.push({ mode, list, bank, inputSha256: inputHash, returnedPacketsUnchanged: true,
      beforeCoverage: original.currentPeriodActuals.transactionCoverage, afterCoverage: x.packet.transactionCoverage,
      sourceCoverage: x.packet.savingsFetchCoverage, beforeStatus: before.savingsFunding.goalAllocation.status,
      afterStatus: after.savingsFunding.goalAllocation.status, beforePass: before.savingsFunding.goalAllocation.status === 'unavailable',
      afterPass: true, knownNeeded: [230, 24], reportedStock: 119 });
  }
assert.equal(fetchCases.length, 60); assert.equal(fetchCases.filter(row => !row.beforePass).length, 38);
const PostingBefore = baseline('public/forecast.js', postingBase), PostingObserver = baseline('scripts/provider-observe.js', postingBase);
const PostingOverlay = baseline('scripts/live-plan.js', postingBase), postingCases = [];
for (const shape of ['direct', 'counterparty', 'savings-leg', 'unrelated', 'dropped', 'collapsed']) for (const mode of observed.postingModes) {
  const x = observed.postingObservation(shape, mode), inputHash = hash(x.input);
  const original = PostingObserver.observe({ provider: 'lunchmoney', ...x.input }), originalHash = hash(original);
  const data = PostingOverlay.overlayLiveState({ data: x.input.data, report: original }).data;
  assert.deepEqual(data.liveOverlay.currentPeriodActuals, original.currentPeriodActuals);
  const before = PostingBefore.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, debts: data.debts, ...data.liveOverlay });
  const after = Current.recommend(x.data.plan, x.data.meta.asOf, { weeklyVariable: 40, debts: x.data.debts, ...x.data.liveOverlay });
  const ready = shape === 'unrelated' || shape === 'collapsed' && mode === 'pending' || mode === 'posted' && shape !== 'dropped';
  const expected = ready ? [95, 24] : [null, null];
  const beforeSaved = before.savingsFunding.rows.map(row => row.saved), afterSaved = after.savingsFunding.rows.map(row => row.saved);
  assert.deepEqual(afterSaved, expected); assert.deepEqual(after.savingsFunding.rows.map(row => row.needed), [230, 24]);
  assert.equal(after.savingsInventory.reportedStock.amount, 119);
  if (!ready) { assert.equal(after.savingsFunding.period.proposal, null); assert.ok(after.sim.events.every(row => !row.reserveFunding)); }
  assert.equal(hash(x.input), inputHash); assert.equal(hash(original), originalHash); assert.equal(JSON.stringify(x.report), x.originalReport);
  const oldRow = original.transactions.find(row => row.providerTransactionId === x.rawId);
  const newRow = x.report.transactions.find(row => row.providerTransactionId === x.rawId);
  assert.equal(newRow.pending, oldRow.pending, 'global pending classification is unchanged');
  postingCases.push({ shape, mode, inputSha256: inputHash, expected, beforeSaved, afterSaved,
    beforePass: JSON.stringify(beforeSaved) === JSON.stringify(expected), afterPass: true,
    incumbentPendingUnchanged: true, sourcePostingEvidence: newRow.savingsPostingEvidence,
    returnedPacketsUnchanged: true, knownNeeded: [230, 24], reportedStock: 119 });
}
assert.equal(postingCases.length, 54); assert.equal(postingCases.filter(row => !row.beforePass).length, 28);
verifySourceBinding(root, binding);
console.log(JSON.stringify({ outcome: 'PASS', base, executionBinding: binding,
  before: { controls: 12, pass: 6, fail: 6, aggregate: 'FAIL' },
  after: { controls: 12, pass: 12, fail: 0, aggregate: 'PASS' }, cases,
  windowRepair: { base: windowBase, before: { controls: 82, pass: 8, fail: windowFailures, aggregate: 'FAIL' },
    after: { controls: 82, pass: 82, fail: 0, aggregate: 'PASS' }, cases: windowCases },
  fetchRepair: { base: fetchBase, before: { controls: 60, pass: 22, fail: 38, aggregate: 'FAIL' },
    after: { controls: 60, pass: 60, fail: 0, aggregate: 'PASS' }, cases: fetchCases },
  postingRepair: { base: postingBase, before: { controls: 54, pass: 26, fail: 28, aggregate: 'FAIL' },
    after: { controls: 54, pass: 54, fail: 0, aggregate: 'PASS' }, cases: postingCases } }, null, 2));
