'use strict';
// Actual shared boot and owner save handler, invented JSON only. No household
// files, provider calls, browser session, or public copy of a private payload.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const SOURCE = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  return {
    data: { meta: { asOf: '2038-06-06' }, plan: { startingCash: { amount: 123.456 }, nested: [null, 0, false, '', '雪'] },
      refreshTrust: { exactFiguresAvailable: false, displayState: 'attention-needed' } },
    periods: { asOf: '2038-06-01', periods: {}, monthly: [], nativeUnknown: null },
    history: { schema: 'atlas-balance-history/v1', snapshots: [], nativeUnknown: null },
  };
}
async function boot(options = {}) {
  const elements = [], input = fixture(), requests = [], operations = [], writes = [], storage = [];
  const hooks = { renders: 0, forecast: 0 }, picker = options.picker || {};
  class Element {
    constructor() { this.children = []; this.attributes = {}; this.listeners = {}; this.classList = { add() {}, contains: () => false }; elements.push(this); }
    set textContent(value) { this.text = value; this.children = []; }
    get textContent() { return this.text || ''; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    querySelectorAll() { return []; }
    prepend(child) { this.children.unshift(child); child.parent = this; }
    append(...children) { for (const child of children) { this.children.push(child); child.parent = this; } }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
  }
  const wrap = new Element(), mount = new Element(), build = new Element();
  build.textContent = options.label ?? 'Running commit abcdef0';
  const document = { body: new Element(), documentElement: new Element(), visibilityState: 'visible',
    getElementById: () => null, querySelectorAll: () => [], createElement: () => new Element(), addEventListener() {},
    querySelector: selector => selector === '.wrap' ? wrap : selector === '[data-review-source-check]' ? (options.mount === false ? null : mount)
      : selector === '.running-build' ? build : null };
  Object.defineProperty(document, 'cookie', { get() { throw Error('cookie access forbidden'); } });
  const stream = {
    async write(body) { operations.push('write'); writes.push(body); if (picker.writeError) throw picker.writeError; if (picker.writeWait) await picker.writeWait.promise; },
    async close() { operations.push('close'); if (picker.closeError) throw picker.closeError; if (picker.closeWait) await picker.closeWait.promise; },
    async abort() { operations.push('abort'); if (picker.abortError) throw picker.abortError; },
  };
  const handle = { async createWritable() { operations.push('createWritable'); if (picker.createError) throw picker.createError; return stream; } };
  let pickerOptions;
  const context = { document, AbortController, Intl, Date, console, setTimeout, clearTimeout,
    addEventListener() {}, matchMedia: () => ({ addEventListener() {} }),
    isSecureContext: options.secure !== false,
    location: { href: '', reload() { operations.push('reload'); } },
    localStorage: { getItem(key) { storage.push(key); assert.equal(key, 'hfd-theme'); return null; }, setItem() { throw Error('storage write forbidden'); } },
    Forecast: new Proxy({}, { get() { hooks.forecast++; throw Error('Forecast access forbidden'); } }),
    fetch: async (url, init) => {
      requests.push({ url, credentials: init.credentials });
      const key = url.startsWith('/data.json') ? 'data' : url === '/periods.json' ? 'periods' : url === '/balance-history.json' ? 'history' : null;
      assert.ok(key, 'only existing boot requests');
      const mode = options.responses?.[key];
      if (mode === 'reject') throw Error('synthetic read failure');
      if (key === 'data' && options.pending) await options.pending.promise;
      const status = mode === '401' ? 401 : mode === '503' ? 503 : mode === '206' ? 206 : 200;
      return { status, ok: status < 300, headers: { get(name) {
        const headers = options.headers || { 'X-Atlas-Observation-Source': 'memory', 'X-Atlas-Observation-Qualified': 'true', 'X-Atlas-Observation-Checked-At': '2038-06-06T18:00:00.000Z', Authorization: 'synthetic-do-not-export', 'Set-Cookie': 'synthetic-do-not-export' };
        return headers[name] ?? null;
      } }, async json() { if (mode === 'malformed') throw Error('synthetic parse failure'); return mode === 'null' ? null : input[key]; } };
    },
  };
  if (options.supported !== false) context.showSaveFilePicker = async opts => {
    pickerOptions = opts; operations.push('picker');
    if (picker.error) throw picker.error;
    if (picker.wait) await picker.wait.promise;
    return handle;
  };
  vm.createContext(context); vm.runInContext(SOURCE + '\nglobalThis.app = App;', context);
  context.app.register(() => hooks.renders++);
  if (options.mutate) context.app.once((d, p, h) => { d.plan.startingCash.amount = 999; p.nativeUnknown = 'changed'; h.snapshots.push({ mutated: true }); });
  context.app.boot(options.bootOptions || { periods: true, history: true });
  await flush(); await flush();
  const find = attr => elements.find(e => Object.hasOwn(e.attributes, attr));
  return { context, input, requests, operations, writes, hooks, storage, build, pickerOptions: () => pickerOptions,
    button: find('data-private-comparison-save'), status: find('data-private-comparison-status'), refresh: find('data-manual-refresh'),
    cancel: () => wrap.children[0]?.children.find(e => e.textContent === 'Cancel')?.listeners.click(),
  };
}
let checks = 0;
function eq(got, expected, name) { assert.deepEqual(got, expected, name); checks++; }
function ok(value, name) { assert.ok(value, name); checks++; }
async function main() {
  const before = fixture(), good = await boot({ mutate: true });
  ok(good.button, 'visible action is created in the existing Data status mount');
  eq(good.button.disabled, false, 'three complete responses enable saving');
  eq(good.operations, [], 'boot does not open a picker or write a file');
  const requestCount = good.requests.length, storageCount = good.storage.length, renders = good.hooks.renders;
  const saving = good.button.listeners.click();
  eq(good.operations, ['picker'], 'picker opens directly in the action before any await');
  await saving;
  eq(good.operations, ['picker', 'createWritable', 'write', 'close'], 'success requires complete writable closure');
  const packet = JSON.parse(good.writes[0]);
  eq(packet.inputs, before, 'every JSON value equals the successful response before renderer mutation');
  eq(packet.schema, 'atlas-private-comparison-inputs/v1', 'versioned private input contract');
  eq(packet.provenance.pageBuildLabel, 'Running commit abcdef0', 'only loaded HTML build identity is recorded');
  eq(packet.provenance.dataServingRevision, null, 'no fabricated data-serving revision');
  eq(packet.provenance.observation, { source: 'memory', qualified: true, checkedAt: '2038-06-06T18:00:00.000Z' }, 'original check is not re-dated at export');
  eq(packet.provenance.responses, { data: { path: '/data.json', status: 200 }, periods: { path: '/periods.json', status: 200 }, history: { path: '/balance-history.json', status: 200 } }, 'only fixed source paths and statuses');
  ok(Date.parse(packet.exportedAt) >= Date.parse(packet.loadedAt) && packet.exportedAt !== packet.provenance.observation.checkedAt, 'export, load and evidence clocks stay distinct');
  eq(good.requests.length, requestCount, 'saving makes zero new network requests');
  eq(good.hooks.forecast, 0, 'saving invokes no Forecast calculations');
  eq(good.hooks.renders, renders, 'saving does not rerender or change selected period/month');
  eq(good.storage.length, storageCount, 'saving does not read storage');
  eq(Object.keys(good.context.app).sort(), ['boot', 'data', 'history', 'once', 'periods', 'register', 'rerender'], 'no new public payload getter');
  ok(!good.writes[0].includes('synthetic-do-not-export'), 'headers and authentication canaries are absent');
  ok(good.status.textContent.includes('inputs saved'), 'successful closure reports saved');
  eq(good.pickerOptions().types[0].accept['application/json'][0], '.json', 'explicit JSON file picker');

  for (const option of [{ supported: false }, { secure: false }]) {
    const b = await boot(option); eq(b.button.disabled, true, 'unsupported browser is disabled');
    await b.button.listeners.click(); eq(b.operations, [], 'unsupported browser has no fallback write');
    ok(b.status.textContent.includes('unavailable in this browser'), 'unsupported outcome is clear');
  }
  for (const key of ['data', 'periods', 'history']) for (const mode of ['null', 'malformed', '503', '401', 'reject', '206']) {
    const b = await boot({ responses: { [key]: mode } });
    eq(b.button.disabled, true, `${key}/${mode} blocks incomplete export`);
    await b.button.listeners.click(); eq(b.operations, [], `${key}/${mode} cannot start saving`);
    if (key === 'data' && mode === '401') eq(b.context.location.href, '/login', 'incumbent session redirect retained');
  }
  for (const bootOptions of [{}, { periods: true }, { history: true }]) {
    const b = await boot({ bootOptions }); eq(b.button.disabled, true, 'unrequested required input blocks export');
  }
  const noMount = await boot({ mount: false }); eq(noMount.button, undefined, 'no new control on other page mounts');
  const unknown = await boot({ headers: { 'X-Atlas-Observation-Qualified': 'garbage' }, label: 'unverified build text' });
  await unknown.button.listeners.click();
  const unknownPacket = JSON.parse(unknown.writes[0]);
  eq(unknownPacket.provenance.observation, { source: null, qualified: null, checkedAt: null }, 'missing and malformed provenance stays unknown');
  eq(unknownPacket.provenance.pageBuildLabel, null, 'unverified build text is not promoted');
  eq(unknownPacket.inputs.data.refreshTrust.exactFiguresAvailable, false, 'saving never promotes financial qualification');
  const unqualified = await boot({ headers: { 'X-Atlas-Observation-Source': 'provider', 'X-Atlas-Observation-Qualified': 'false' } });
  await unqualified.button.listeners.click(); eq(JSON.parse(unqualified.writes[0]).provenance.observation.qualified, false, 'explicit unqualified stays false');

  const cancelError = Object.assign(new Error('synthetic cancellation'), { name: 'AbortError' });
  const cancelled = await boot({ picker: { error: cancelError } }); await cancelled.button.listeners.click();
  eq(cancelled.operations, ['picker'], 'picker cancellation writes nothing');
  ok(cancelled.status.textContent.includes('cancelled'), 'cancellation has its own outcome');
  for (const failure of ['error', 'createError', 'writeError', 'closeError']) {
    const b = await boot({ picker: { [failure]: new Error('synthetic failure') } }); await b.button.listeners.click();
    ok(b.status.textContent.includes('No completed save was confirmed'), `${failure} never claims success`);
    eq(b.button.disabled, false, `${failure} permits another explicit owner attempt`);
    if (failure === 'writeError' || failure === 'closeError') ok(b.operations.includes('abort'), `${failure} attempts to abort the incomplete stream`);
  }
  const pickerWait = deferred(), stale = await boot({ picker: { wait: pickerWait } });
  const staleSave = stale.button.listeners.click(); stale.refresh.listeners.click(); await flush(); await flush(); pickerWait.resolve(); await staleSave;
  eq(stale.writes, [], 'refresh while picker is pending invalidates the old generation');
  ok(stale.status.textContent.includes('Inputs changed'), 'stale generation has a clear outcome');
  eq(stale.button.disabled, true, 'forced refresh requires the incumbent page reload before export');

  const writeWait = deferred(), writing = await boot({ picker: { writeWait } });
  const writeSave = writing.button.listeners.click(); await flush();
  const writingRequests = writing.requests.length;
  eq(writing.refresh.disabled, true, 'refresh is visibly disabled during the write/close transaction');
  writing.refresh.listeners.click(); eq(writing.requests.length, writingRequests, 'new generation cannot begin during write');
  ok(!writing.status.textContent.includes('inputs saved'), 'write completion alone is not success');
  writeWait.resolve(); await writeSave;
  eq(writing.refresh.disabled, false, 'refresh restored after completed save');
  const closeWait = deferred(), closing = await boot({ picker: { closeWait } });
  const closeSave = closing.button.listeners.click(); await flush();
  ok(!closing.status.textContent.includes('inputs saved'), 'pending close is not success');
  closing.refresh.listeners.click(); eq(closing.requests.length, 3, 'new generation cannot begin during close');
  closeWait.resolve(); await closeSave; ok(closing.status.textContent.includes('inputs saved'), 'successful close confirms save');

  const pending = deferred(), late = await boot({ pending });
  eq(late.button.disabled, true, 'initial pending input is unavailable'); late.cancel(); pending.resolve(); await flush(); await flush();
  eq(late.button.disabled, true, 'late success after cancellation cannot enable export');
  eq(late.operations, [], 'cancelled load never creates a local file');
  console.log(`PASS private comparison download: ${checks} shared-boot checks; exact detached inputs, local explicit save, truthful provenance, no network/Forecast, complete closure and generation fences`);
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture };
