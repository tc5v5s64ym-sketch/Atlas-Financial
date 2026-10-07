'use strict';
// Manual synthetic proof only. No financial cache or production export.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { threadId } = require('node:worker_threads');
const root = process.cwd(), forecastPath = path.join(root, 'public/forecast.js');
if (process.env.ATLAS_SYNTHETIC_DATE_BASELINE === '1') {
  const source = fs.readFileSync(forecastPath, 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('  const validateDate ='), predicateEnd = source.indexOf('\n  // Only memoize', start), end = source.indexOf('\n  const cents =', start);
  if (start < 0 || predicateEnd < start || end < predicateEnd) throw new Error('Synthetic baseline source guard failed');
  const predicate = source.slice(start, predicateEnd).replace('const validateDate =', 'const date =');
  const baseline = new Module(forecastPath);
  baseline.filename = forecastPath; baseline.paths = Module._nodeModulePaths(path.dirname(forecastPath));
  require.cache[forecastPath] = baseline;
  baseline._compile(source.slice(0, start) + predicate + source.slice(end), forecastPath);
}
function emit(row) { fs.writeSync(2, 'SYNTHETIC_PHASE ' + JSON.stringify({ threadId, ...row }) + '\n'); }
function wrap(file, key, asynchronous) {
  const owner = require(path.join(root, file)), original = owner[key];
  const phase = path.basename(file) + ':' + key;
  const finish = start => emit({ event: 'end', phase, elapsedMs: Math.round(performance.now() - start) });
  owner[key] = asynchronous ? async function(...args) { const start = performance.now(); emit({ event: 'start', phase }); try { return await original.apply(this, args); } finally { finish(start); } }
    : function(...args) { const start = performance.now(); emit({ event: 'start', phase }); try { return original.apply(this, args); } finally { finish(start); } };
  for (const property of Reflect.ownKeys(original)) if (!['length', 'name', 'prototype', 'arguments', 'caller'].includes(property)) Object.defineProperty(owner[key], property, Object.getOwnPropertyDescriptor(original, property));
}
wrap('public/forecast.js', 'recommend', false);
wrap('scripts/provider-observe.js', 'fetchLunchMoneyLive', true);
wrap('scripts/provider-observe.js', 'observe', false);
wrap('scripts/live-plan.js', 'applyForServer', true);
wrap('scripts/assistant-packet.js', 'buildPacket', false);
