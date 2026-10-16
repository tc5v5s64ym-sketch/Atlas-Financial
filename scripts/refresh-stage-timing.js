'use strict';
// Execution-local diagnostics only. No inputs, outputs or error values enter
// the timing state. Nested stage durations are inclusive, not additive.
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance } = require('node:perf_hooks');
const context = new AsyncLocalStorage();
const MESSAGE = 'live-refresh-stage-progress';
const FIELDS = Object.freeze(['providerAcquireMs', 'normalizeMs', 'overlayMs', 'forecastMs', 'sourceReplayMs']);
const KEYS = ['workerComplete', ...FIELDS];
const OUTCOMES = ['completed', 'live-refresh-cancelled', 'live-refresh-timeout', 'live-refresh-unavailable', 'live-refresh-invalidated'];
const duration = value => Number.isFinite(value) && value >= 0;
function empty() { return Object.fromEntries([['workerComplete', false], ...FIELDS.map(key => [key, null])]); }
function accept(value) {
  if (!value || Object.keys(value).length !== KEYS.length || !KEYS.every(key => Object.hasOwn(value, key))
    || typeof value.workerComplete !== 'boolean'
    || !FIELDS.every(key => value[key] === null || duration(value[key]))) return null;
  return Object.fromEntries(KEYS.map(key => [key, value[key]]));
}
function add(state, key, start) {
  const elapsed = performance.now() - start;
  const next = (state.values[key] || 0) + Math.max(0, elapsed);
  if (duration(next)) state.values[key] = next;
  // A closed transport failure cannot affect a financial result or exception.
  try { state.onUpdate?.({ ...state.values }); } catch (_) { /* Diagnostics only. */ }
}
async function run(invoke, onUpdate) {
  const state = { values: empty(), onUpdate };
  return context.run(state, async () => {
    try { return await invoke(); }
    finally {
      state.values.workerComplete = true;
      try { onUpdate?.({ ...state.values }); } catch (_) { /* Diagnostics only. */ }
    }
  });
}
function sync(key, invoke) {
  const state = context.getStore();
  if (!state || !FIELDS.includes(key)) return invoke();
  const start = performance.now();
  try { return invoke(); } finally { add(state, key, start); }
}
async function asyncStage(key, invoke) {
  const state = context.getStore();
  if (!state || !FIELDS.includes(key)) return invoke();
  const start = performance.now();
  try { return await invoke(); } finally { add(state, key, start); }
}
function record(value, source, outcome, qualified, publicationMs) {
  return { type: 'live-refresh-stages', source: source === 'memory' ? 'memory' : 'provider',
    outcome: OUTCOMES.includes(outcome) ? outcome : 'live-refresh-unavailable',
    qualified: typeof qualified === 'boolean' ? qualified : null,
    ...(accept(value) || empty()), publicationMs: duration(publicationMs) ? publicationMs : null };
}
module.exports = { MESSAGE, FIELDS, run, sync, async: asyncStage, accept, record };
