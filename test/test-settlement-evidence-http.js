'use strict';

// Actual application/login/routes. Explicitly synthetic authority, acquisition,
// monotonic context and durable-memory adapters. No storage trial files, real
// credentials, external provider, database, deployment or production activation.
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createApplication } = require('../server');
const { createSettlementEvidenceStore } = require('../scripts/settlement-evidence-store');
const Forecast = require('../public/forecast');
const R = require('../scripts/settlement-evidence-resolver');
const householdId = 'household-' + 'a'.repeat(32);
const env = { SITE_PASSWORD: 'synthetic-only-http-password', SESSION_SECRET: 'synthetic-only-http-signature-secret' };
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const clone = value => structuredClone(value);
function acquisitionFor(base) {
  const packet = clone(base.liveOverlay.currentPeriodActuals);
  packet.transactions = [{ id: 'synthetic-row', date: '2026-10-03', amount: 60,
    currency: 'cad', pending: false, categoryLabel: 'Groceries', merchantKnown: true,
    atlasAccountId: 'chequing-a', accountRole: 'household-cash',
    displayedPayee: 'Synthetic recorded club payment' }];
  packet.transactionWindow = { startDate: '2026-10-02', endDate: '2026-10-05', complete: true, hasMore: false, truncated: false };
  return { packet, plan: clone(base.plan),
    join: [{ localId: 'synthetic-row', providerAccountId: 'SYNTHETIC-ACCOUNT', transactionId: 'SYNTHETIC-TRANSACTION' }],
    map: { mappings: [{ providerAccountId: 'SYNTHETIC-ACCOUNT', canonical: { id: 'chequing-a', collection: 'cash' } }] } };
}
async function startWorld(active = true, options = {}) {
  // Test-only clock injection exercises the unchanged controller/store TTL.
  // The application's signed-cookie expiry continues to use its real clock.
  const now = options.now || Date.now;
  const base = require('./fixtures/savings-daily-consumer-data')();
  base.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  const w = { base, cell: { revision: 1, domain: 'synthetic-domain' }, authorized: true,
    readFailure: false, calls: { storage: 0, journal: 0, commit: 0, acquire: 0, base: 0 },
    hooks: {}, durable: { doc: null, staged: null, journal: null, pin: null, backups: new Map() } };
  w.acquisition = acquisitionFor(base);
  let tail = Promise.resolve();
  const lock = { withLock(fn) { const value = tail.then(fn, fn); tail = value.catch(() => {}); return value; } };
  const d = w.durable;
  const read = (name, fn) => async (...args) => { w.calls.storage++; return fn(...args); };
  const documentStore = {
    read: read('doc', () => d.doc && Buffer.from(d.doc)),
    readStaged: read('staged', () => d.staged && Buffer.from(d.staged)),
    async writeTemp(bytes) { d.staged = Buffer.from(bytes); },
    async commitTemp() { d.doc = d.staged; d.staged = null; },
    async discardTemp() { d.staged = null; },
  };
  const journalStore = { read: read('journal', () => d.journal && Buffer.from(d.journal)),
    async write(value) { w.calls.journal++; d.journal = Buffer.from(JSON.stringify(value)); },
    async clear() { d.journal = null; } };
  const pinStore = { read: read('pin', () => d.pin && clone(d.pin)),
    async advance(expected, next) {
      if (expected === null ? d.pin !== null : !d.pin || expected.revision !== d.pin.revision || expected.digest !== d.pin.digest) return false;
      d.pin = clone(next); return true;
    } };
  const backupStore = { async put(revision, digest, bytes) {
    const entry = { revision, digest, artifactId: 'synthetic-' + revision };
    d.backups.set(digest, { ...entry, bytes: Buffer.from(bytes) }); return entry;
  }, async get(revision, digest) { const entry = d.backups.get(digest); return entry?.revision === revision ? Buffer.from(entry.bytes) : null; },
  async list() { return [...d.backups.values()].map(({ bytes, ...entry }) => entry); } };
  w.store = createSettlementEvidenceStore({ householdId, documentStore, journalStore, pinStore, backupStore,
    quarantine: { async put() { throw new Error('synthetic quarantine forbidden'); } }, lock, now });
  if (active) assert.equal((await w.store.bootstrap()).status, 'bootstrapped');
  const server = w.server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  w.origin = 'http://127.0.0.1:' + server.address().port;
  w.contextReader = () => ({ contextRevision: w.cell.revision, domain: w.cell.domain });
  w.syntheticAcquire = async reader => {
    w.calls.acquire++;
    const captured = clone(reader());
    const acquisition = clone(w.acquisition);
    return { ...acquisition, witness() {
      const current = reader();
      return current.contextRevision === captured.contextRevision && current.domain === captured.domain;
    } };
  };
  w.dependency = { householdId, origin: w.origin, now, contextReader: w.contextReader,
    async authorize(context) {
      if (w.hooks.authorize) await w.hooks.authorize(context);
      if (!w.authorized) throw new Error('synthetic revoked');
      return { householdId, actorId: context.actorId };
    },
    acquire: reader => w.syntheticAcquire(reader),
    store: w.store,
    async commitAdmitted(input, witness) {
      w.calls.commit++;
      if (w.hooks.admission) await w.hooks.admission();
      return w.store.commitAdmitted(input, witness);
    },
    async readBase() { w.calls.base++; if (w.hooks.base) await w.hooks.base(); return w.base; },
    async readDocument() {
      if (w.readFailure) throw new Error('SYNTHETIC-PRIVATE-READ-ERROR');
      if (w.hooks.document) await w.hooks.document();
      return documentStore.read();
    },
    async readPin() {
      if (w.readFailure) throw new Error('SYNTHETIC-PRIVATE-PIN-ERROR');
      if (w.hooks.pin) await w.hooks.pin();
      return pinStore.read();
    } };
  // Explicit synthetic COMPLETE base source. It uses the incumbent ordinary
  // read seam over these same durable-memory readers. The application does not
  // opt ordinary /data.json, Talk or assistant into settlement as a side effect
  // of mounting assignment routes; real production base composition stays gated.
  const syntheticBaseServing = require('../scripts/settlement-evidence-serving')
    .createSettlementEvidenceServing({ householdId,
      readDocument: w.dependency.readDocument, readPin: w.dependency.readPin });
  w.recreate = () => {
    const app = createApplication({ env, baseSource: async () => active ? syntheticBaseServing.attach(w.base) : w.base,
      ...(active ? { settlement: w.dependency } : {}) });
    server.removeAllListeners('request'); server.on('request', app); w.app = app;
  };
  w.recreate();
  w.login = async () => {
    const response = await fetch(w.origin + '/login', { method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password: env.SITE_PASSWORD }) });
    assert.equal(response.status, 302);
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    return response.headers.get('set-cookie').split(';')[0];
  };
  w.cookie = await w.login();
  w.raw = (route, body, overrides = {}) => fetch(w.origin + '/settlement/' + route, {
    method: 'POST', headers: { Cookie: w.cookie, Origin: w.origin, 'Content-Type': 'application/json',
      'X-Atlas-Settlement': 'same-origin', ...overrides.headers }, body: JSON.stringify(body), ...overrides,
  });
  w.post = async (route, body) => {
    const response = await w.raw(route, body); assert.equal(response.status, 200, route); return response.json();
  };
  w.selection = async () => {
    const c = await w.post('selections', {}); assert.equal(c.status, 'available');
    return { transaction: c.transactions[0].handle, commitment: c.commitments[0].handle };
  };
  w.prepare = async (n = 1) => w.post('prepare', { operationId: op(n), selection: await w.selection(), assignedCents: 2500 });
  w.confirm = p => w.post('confirm', { operationId: p.operationId, previewToken: p.previewToken, confirmed: true });
  w.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  w.calls.storage = 0;
  return w;
}
module.exports = { startWorld, op, env, householdId };

if (require.main === module) {
  const test = require('node:test');
  test('default actual application is inactive and touches zero settlement storage', async t => {
    const w = await startWorld(false); t.after(w.close);
    const response = await fetch(w.origin + '/settlement/capability', { headers: { Cookie: w.cookie } });
    assert.deepEqual(await response.json(), { status: 'inactive' });
    assert.equal((await w.raw('selections', {})).status, 503);
    const data = await fetch(w.origin + '/data.json', { headers: { Cookie: w.cookie } });
    assert.deepEqual(await data.json(), w.base);
    assert.deepEqual(w.calls, { storage: 0, journal: 0, commit: 0, acquire: 0, base: 0 });
  });
  test('signed login, authorization, strict origin and exact bounded JSON guards', async t => {
    const w = await startWorld(); t.after(w.close);
    const signed = payload => {
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      return 'hfd_session=' + body + '.' + crypto.createHmac('sha256', env.SESSION_SECRET).update(body).digest('base64url');
    };
    for (const cookie of ['', w.cookie + 'tampered', signed({ exp: Date.now() - 1, sid: 'a'.repeat(64) }), signed({ exp: Date.now() + 10000 })]) {
      const r = await w.raw('selections', {}, { headers: { Cookie: cookie, Authorization: 'Bearer synthetic-only' } });
      assert.equal(r.status, 401);
    }
    for (const extra of [{ Origin: 'http://evil.test' }, { Origin: '', Host: new URL(w.origin).host }, { 'X-Atlas-Settlement': '' }]) {
      const r = await w.raw('selections', {}, { headers: { Cookie: w.cookie, Origin: w.origin,
        'Content-Type': 'application/json', 'X-Atlas-Settlement': 'same-origin', ...extra } });
      assert.equal(r.status, 403); assert.equal(r.headers.get('access-control-allow-origin'), null);
    }
    for (const body of [{ actorId: 'x' }, { householdId }, { namespace: 'x' }, { receipt: {} }, { witness: {} }, { rawCommand: {} }]) {
      assert.equal((await w.raw('selections', body)).status, 400);
    }
    assert.equal((await w.raw('selections?operationId=' + op(1), {})).status, 400);
    assert.equal((await w.raw('selections', { padding: 'x'.repeat(5000) })).status, 400);
    assert.equal(w.calls.storage, 0); assert.equal(w.calls.acquire, 0);
    w.authorized = false;
    assert.equal((await w.raw('selections', {})).status, 503);
    assert.equal(w.calls.storage, 0);
  });
  test('actual HTTP catalogue, read-only preview, retained controller, duplicate confirm and restart receipt', async t => {
    const w = await startWorld(); t.after(w.close);
    const p = await w.prepare(); assert.equal(p.status, 'prepared'); assert.equal(p.assignedCents, 2500);
    assert.equal(w.calls.journal, 0); assert.equal(w.calls.commit, 0);
    assert.equal(p.labels.payment, 'Synthetic recorded club payment');
    const [a, b] = await Promise.all([w.confirm(p), w.confirm(p)]);
    assert.ok([a.status, b.status].includes('committed')); assert.equal(w.calls.commit, 1);
    const original = await w.post('outcome', { operationId: op(1) }); assert.equal(original.status, 'committed');
    w.recreate(); assert.deepEqual(await w.post('outcome', { operationId: op(1) }), original);
    const view = await w.post('publication', { operationId: op(1) });
    assert.equal(view.publication, 'included');
    const evidence = view.data.settlementEvidence.commitments[0];
    assert.equal(evidence.links[0].assignedCents, 2500);
    const options = { asOf: w.base.meta.asOf, currentPeriodActuals: w.base.liveOverlay.currentPeriodActuals,
      settlementEvidenceStatus: view.data.settlementEvidenceStatus, settlementEvidence: view.data.settlementEvidence };
    const result = Forecast.savingsInventory(view.data.plan, w.base.meta.asOf, options);
    const goal = result.pools.flatMap(x => x.plannedGoals).find(x => x.key === 'commitment:near');
    assert.equal(goal.target, 60);
    assert.equal(goal.linkedPaid, 25);
    assert.equal(goal.remaining, 35);
    w.cookie = await w.login();
    assert.equal((await w.post('outcome', { operationId: op(1) })).status, 'unknown');
    assert.equal((await w.post('publication', { operationId: op(1) })).status, 'unknown');
    assert.equal(w.calls.commit, 1);
  });
  test('stale and ambiguous catalogue selections refuse without writes', async t => {
    const w = await startWorld(); t.after(w.close);
    const selection = await w.selection();
    w.acquisition.packet.transactions[0].amount = 61;
    const refused = await w.post('prepare', { operationId: op(1), selection, assignedCents: 2500 });
    assert.equal(refused.status, 'unavailable');
    w.acquisition.join.push({ localId: 'synthetic-row', providerAccountId: 'SYNTHETIC-OTHER', transactionId: 'SYNTHETIC-OTHER' });
    assert.deepEqual((await w.post('selections', {})).transactions, []);
    assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
  });
  test('mutable monotonic context revision/domain fences real store pre-write admission', async t => {
    const w = await startWorld(); t.after(w.close);
    for (const [n, mutate] of [[1, () => w.cell.revision++], [2, () => { w.cell.domain = 'different-domain'; }]]) {
      const p = await w.prepare(n); assert.equal(p.status, 'prepared');
      w.hooks.admission = mutate;
      assert.deepEqual(await w.confirm(p), { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.calls.journal, 0);
    }
  });
  test('publication deep snapshot, single acquisition, unavailable recovery and post-await revocation', async t => {
    const w = await startWorld(); t.after(w.close);
    const p = await w.prepare(); assert.equal((await w.confirm(p)).status, 'committed');
    let reads = 0;
    w.hooks.document = async () => {
      reads++;
      if (reads === 1) w.base.plan.commitments[0].label = 'Mutated after snapshot';
    };
    w.base.settlementEvidence = { hostile: true }; w.base.settlementEvidenceStatus = { status: 'qualified' };
    const view = await w.post('publication', { operationId: op(1) });
    assert.equal(reads, 2, 'one loader acquisition, including its own stability re-read');
    assert.equal(view.data.plan.commitments[0].label, 'Invented first club cost');
    assert.equal(view.publication, 'included'); assert.equal(view.data.settlementEvidence.hostile, undefined);
    w.readFailure = true;
    const unavailable = await w.post('publication', { operationId: op(1) });
    assert.equal(unavailable.status, 'committed'); assert.equal(unavailable.publication, 'unavailable');
    assert.equal(unavailable.data.settlementEvidenceStatus.reason, 'pin-unavailable');
    assert.equal(unavailable.data.settlementEvidence, undefined);
    w.readFailure = false;
    assert.equal((await w.post('publication', { operationId: op(1) })).publication, 'included');
    w.hooks.pin = async () => { w.authorized = false; };
    const revoked = await w.raw('publication', { operationId: op(1) });
    assert.equal(revoked.status, 503); assert.deepEqual(await revoked.json(), { status: 'unavailable' });
    assert.equal(w.calls.commit, 1);
  });
  test('actual refresh witness rejects HTTP confirmation after revision drift or joined reader-domain change', async t => {
    // The only provider-shaped endpoint is a local synthetic HTTP double. Real
    // refresh workers mint the actual witness; no external provider is called.
    const helper = require('./test-server-observation-memory');
    const Fixture = require('./fixtures/budget-surface-data');
    const Refresh = require('../scripts/server-live-refresh');
    const mock = await helper.provider(); t.after(() => mock.close());
    const originalNow = Date.now; Date.now = () => Date.parse(helper.CLOCK);
    t.after(() => { Date.now = originalNow; });
    const w = await startWorld(); t.after(w.close);
    const canonical = Fixture.canonical(), refreshEnv = helper.environment(mock.base);
    const cell = { canonical, env: refreshEnv, contextRevision: 1 };
    const reader = () => ({ ...cell });
    w.base = await Refresh.serve(canonical, refreshEnv);
    assert.equal(w.base.liveOverlay.applied, true);
    const seedCalls = mock.calls.length;
    let domainMismatch = false;
    w.dependency.contextReader = reader;
    w.syntheticAcquire = async configuredReader => {
      let paired;
      if (domainMismatch) {
        const foreignReader = () => ({ ...cell });
        const first = Refresh.acquireSettlementWithWitness(canonical, refreshEnv, { contextReader: foreignReader });
        const second = Refresh.acquireSettlementWithWitness(canonical, refreshEnv, { contextReader: configuredReader });
        paired = (await Promise.all([first, second]))[1];
      } else paired = await Refresh.acquireSettlementWithWitness(canonical, refreshEnv, { contextReader: configuredReader });
      return { ...paired.acquisition, witness: paired.witness };
    };
    w.recreate();
    const selection = async () => {
      const c = await w.post('selections', {});
      const a = await w.syntheticAcquire(reader);
      const transaction = R.deriveSelectionHandle(R.computeInstanceDigest(a.packet),
        { householdId, providerAccountId: '1002', transactionId: '92003' });
      const commitment = R.deriveChoiceHandle(R.computePlanDigest(a.plan), 'commitment:school-trip');
      assert.ok(c.transactions.some(x => x.handle === transaction));
      return { transaction, commitment };
    };
    const selections = await selection();
    for (const n of [1, 2]) {
      const p = await w.post('prepare', { operationId: op(n), selection: selections, assignedCents: 1000 });
      assert.equal(p.status, 'prepared');
      if (n === 1) w.hooks.admission = () => { cell.contextRevision++; };
      else { w.hooks.admission = null; domainMismatch = true; }
      assert.deepEqual(await w.confirm(p), { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.calls.journal, 0);
    }
    assert.equal(mock.calls.length, seedCalls, 'all acquisition replays made zero additional local mock GETs');
  });
  test('purchase assignment preserves unresolved card opening and coverage holds in the complete view', async t => {
    const w = await startWorld(); t.after(w.close);
    w.base.liveOverlay.currentPeriodActuals.cardCoverageRequired = true;
    w.acquisition.packet.cardCoverageRequired = true;
    const coverage = data => Forecast.recommend(data.plan, data.meta.asOf,
      { ...data.liveOverlay, debts: data.debts, weeklyVariable: 0,
        ...(data.settlementEvidence ? { settlementEvidence: data.settlementEvidence } : {}) }).cardPurchaseCoverage;
    const before = coverage(w.base);
    assert.equal(before.status, 'unavailable'); assert.equal(before.reservedCash, null);
    const p = await w.prepare(); assert.equal(p.status, 'prepared');
    assert.equal((await w.confirm(p)).status, 'committed');
    const view = await w.post('publication', { operationId: op(1) });
    assert.equal(view.publication, 'included');
    assert.deepEqual(coverage(view.data), before);
    assert.deepEqual(view.data.liveOverlay, w.base.liveOverlay);
    assert.equal(view.data.plan.cardPurchaseCoverage, undefined, 'no opening or payment allocation invented');
    const goal = Forecast.savingsInventory(view.data.plan, view.data.meta.asOf,
      { settlementEvidence: view.data.settlementEvidence }).pools[0].plannedGoals[0];
    assert.deepEqual([goal.target, goal.linkedPaid, goal.remaining], [60, 25, 35]);
  });
  test('publication retains its included snapshot when a second commit interleaves before response', async t => {
    const w = await startWorld(); t.after(w.close);
    assert.equal((await w.confirm(await w.prepare())).status, 'committed');
    w.acquisition.packet.transactions.push({ ...w.acquisition.packet.transactions[0], id: 'synthetic-second-row' });
    w.acquisition.join.push({ localId: 'synthetic-second-row', providerAccountId: 'SYNTHETIC-ACCOUNT', transactionId: 'SYNTHETIC-SECOND-TRANSACTION' });
    const catalogue = await w.post('selections', {});
    const second = await w.post('prepare', { operationId: op(2), assignedCents: 1000,
      selection: { transaction: catalogue.transactions[1].handle, commitment: catalogue.commitments[1].handle } });
    assert.equal(second.status, 'prepared');
    let authorizations = 0, reads = 0;
    w.hooks.document = async () => { reads++; };
    w.hooks.authorize = async () => {
      authorizations++;
      if (authorizations === 4) assert.equal((await w.confirm(second)).status, 'committed');
    };
    const firstView = await w.post('publication', { operationId: op(1) });
    assert.equal(w.calls.commit, 2); assert.equal(reads, 2);
    assert.equal(firstView.publication, 'included');
    assert.equal(firstView.data.settlementEvidence.commitments.length, 1, 'no ordinary attach after receipt inclusion');
    w.hooks.authorize = null;
    const later = await w.post('publication', { operationId: op(1) });
    assert.equal(later.publication, 'included'); assert.equal(later.data.settlementEvidence.commitments.length, 2);
  });
  test('incumbent node test/test-local.js against actual default executable startup', async t => {
    const { spawn } = require('node:child_process');
    const net = require('node:net');
    const probe = net.createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    const clean = {};
    for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT'])
      if (process.env[key]) clean[key] = process.env[key];
    const child = spawn(process.execPath, ['server.js'], { cwd: require('node:path').resolve(__dirname, '..'),
      env: { ...clean, ...env, PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    t.after(() => child.kill());
    const base = 'http://127.0.0.1:' + port;
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try { if ((await fetch(base + '/healthz')).ok) { ready = true; break; } } catch { /* local startup */ }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.ok(ready, 'default executable is listening');
    const smoke = spawn(process.execPath, ['test/test-local.js'], { cwd: require('node:path').resolve(__dirname, '..'),
      env: { ...clean, TEST_BASE: base, TEST_PASSWORD: env.SITE_PASSWORD }, windowsHide: true });
    let output = ''; smoke.stdout.on('data', value => { output += value; }); smoke.stderr.on('data', value => { output += value; });
    const code = await new Promise(resolve => smoke.on('exit', resolve));
    assert.equal(code, 0, output); assert.match(output, /ALL CHECKS PASSED/);
  });
  test('deterministic preview expiry refuses mounted confirm with zero write attempts', async t => {
    let clock = Date.now();
    const w = await startWorld(true, { now: () => clock }); t.after(w.close);
    const p = await w.prepare(); assert.equal(p.status, 'prepared');
    assert.ok(p.expiresAt > clock);
    clock = p.expiresAt;
    assert.deepEqual(await w.confirm(p), { status: 'rejected', reason: 'preview-expired' });
    assert.equal(w.calls.commit, 0); assert.equal(w.calls.journal, 0);
    assert.equal((await w.post('outcome', { operationId: p.operationId })).status, 'unknown');
  });
  for (const kind of ['cookie', 'authorization']) {
    test(kind + ' expiry during awaited publication returns no unauthorized view', async t => {
      const w = await startWorld(); t.after(w.close);
      const p = await w.prepare(); assert.equal((await w.confirm(p)).status, 'committed');
      let reached, release;
      const entered = new Promise(resolve => { reached = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      let policyClock = 1;
      const policyExpiry = 2;
      if (kind === 'authorization') w.hooks.authorize = async () => {
        if (policyClock >= policyExpiry) throw new Error('synthetic authorization expired');
      };
      w.hooks.pin = async () => { reached(); await gate; };
      const originalNow = Date.now;
      try {
        const pending = w.raw('publication', { operationId: p.operationId });
        await entered;
        if (kind === 'cookie') {
          const payload = JSON.parse(Buffer.from(w.cookie.slice('hfd_session='.length).split('.')[0], 'base64url'));
          Date.now = () => payload.exp + 1;
        } else policyClock = policyExpiry;
        release();
        const response = await pending;
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), { status: 'unavailable' }, 'no data, receipt or successful acknowledgement leaves the expired authority');
        assert.equal(w.calls.commit, 1); assert.equal(w.calls.journal, 1);
      } finally { Date.now = originalNow; release(); }
    });
  }
}
