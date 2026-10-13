'use strict';
// Run the real shared browser script; VM transport/events only. Browser proof
// separately uses real Budget DOM, parsing, navigation and invented figures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/app.js'), 'utf8');
function harness(label = 'Running commit 1111111') {
  const windowEvents = {}, documentEvents = {}, requests = [], notices = [], timers = [];
  let now = 100000, reloads = 0, confirmed = false;
  let response = { ok: true, headers: { get: () => 'text/html' }, text: async () => label };
  const node = tag => ({ tag, children: [], attributes: {}, textContent: '',
    setAttribute(k, v) { this.attributes[k] = v; },
    addEventListener(k, fn) { this[k] = fn; },
    append(...children) { this.children.push(...children); },
    remove() { const i = notices.indexOf(this); if (i >= 0) notices.splice(i, 1); },
  });
  const doc = { visibilityState: 'visible', getElementById: () => null,
    querySelector: () => ({ textContent: label }), createElement: node,
    body: { append: n => notices.push(n) }, addEventListener: (k, fn) => { documentEvents[k] = fn; } };
  const clock = class extends Date { static now() { return now; } };
  const context = vm.createContext({ document: doc, Intl, Date: clock, AbortController,
    addEventListener: (k, fn) => { windowEvents[k] = fn; },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    fetch: async (url, options) => { requests.push({ url, options }); return typeof response === 'function' ? response() : response; },
    DOMParser: class { parseFromString(text) { return { querySelector: () => ({ textContent: text }) }; } },
    confirm: () => confirmed, location: { reload: () => { reloads++; } },
  });
  vm.runInContext(source, context);
  vm.runInContext('watchBudgetRelease()', context);
  return { requests, notices, timers, doc, windowEvents,
    resume: () => windowEvents.pageshow?.({ persisted: true }),
    visible: state => { doc.visibilityState = state; documentEvents.visibilitychange?.(); },
    advance: () => { now += 30000; },
    setLabel: value => { response = { ok: true, headers: { get: () => 'text/html' }, text: async () => value }; },
    setResponse: value => { response = value; }, confirm: () => { confirmed = true; },
    get reloads() { return reloads; },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  const h = harness();
  h.windowEvents.pageshow({ persisted: false }); await flush();
  assert.equal(h.requests.length, 0, 'cold navigation already has current response identity');
  h.visible('hidden'); h.visible('visible'); await flush();
  assert.equal(h.requests.length, 1, 'visibility return checks the shell');
  assert.equal(h.notices.length, 0, 'unchanged release is quiet');
  assert.equal(h.requests[0].url, '/index.html');
  assert.equal(h.requests[0].options.cache, 'no-store');
  assert.equal(h.requests[0].options.redirect, 'error');
  assert.equal(h.requests[0].options.credentials, 'same-origin');
  h.setLabel('Running PR #604 \u00b7 2222222'); h.advance();
  h.resume(); h.resume(); await flush();
  assert.equal(h.requests.length, 2, 'overlapping checks coalesce');
  assert.equal(h.notices.length, 1);
  h.notices[0].children[1].click();
  assert.equal(h.reloads, 0, 'cancelling protects unsaved work');
  h.confirm(); h.notices[0].children[1].click(); assert.equal(h.reloads, 1, 'only confirmed action reloads');
  h.advance(); h.resume(); await flush(); assert.equal(h.notices.length, 1, 'repeat events never duplicate notice');
  h.setLabel('Running commit 1111111'); h.advance(); h.resume(); await flush();
  assert.equal(h.notices.length, 0, 'rollback to loaded release removes obsolete notice');
  for (const value of ['Running build unavailable', 'Running commit invalid', 'Login']) {
    h.setLabel(value); h.advance(); h.resume(); await flush(); assert.equal(h.notices.length, 0);
  }
  for (const response of [{ ok: false }, () => { throw Error('offline'); },
    { ok: true, headers: { get: () => 'application/json' } }]) {
    h.setResponse(response); h.advance(); h.resume(); await flush(); assert.equal(h.notices.length, 0);
  }
  h.visible('hidden'); h.advance(); h.resume(); await flush();
  const count = h.requests.length;
  h.resume(); await flush(); assert.equal(h.requests.length, count, 'hidden documents do not probe');
  const unknown = harness('Running build unavailable'); unknown.resume(); await flush();
  assert.equal(unknown.requests.length, 0, 'no response-bound identity means no comparison');
  assert.equal(h.requests.some(r => r.url.includes('data.json')), false, 'no financial/provider path');
  console.log('PASS release resume: cold, visibility, restore, quiet same/unknown, coalescing, confirmed reload, rollback, offline/error, no provider path');
})().catch(e => { console.error(e); process.exitCode = 1; });
