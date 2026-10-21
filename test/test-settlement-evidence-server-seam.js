'use strict';
// ATLAS-080 — default-inactive server read seam.
//
// The merged publication-gating surfaces (assistant packet, Plan,
// Planning) consume a tri-state settlement outcome carried alongside
// the evidence on the served object (settlementEvidenceStatus /
// settlementEvidence). Until this slice nothing on the server produced
// those fields: the loader's outcome died before the composition
// point. This suite pins the seam that produces them — a small
// dependency-injected bridge (scripts/settlement-evidence-serving.js)
// wired into server.js's one shared servedAtlasData return point —
// under Atlas's seven acceptance points:
//
//   1. No dependency (the production default): served output is
//      byte-identical, no settlement fields are added, no storage is
//      read. Proven at the unit level (identity), at the source level
//      (server.js constructs the serving with no argument) and over
//      HTTP against a real booted server.js.
//   2. Fixtures exist only through the real store's public flow
//      (bootstrap / prepare / commit over the merged file + object
//      adapters in a temp directory) — never hand-written documents.
//      A fresh node process reading the same durable state through
//      the unchanged loader yields only the effective evidence plus
//      the normalized status.
//   3. The bridge output reaches both consumers of the shared served
//      object: the assistant packet (built here with the very object
//      the bridge returned, exactly as buildCurrentAssistantPacket
//      does) and the browser data path (the same object through the
//      JSON round-trip /data.json performs). Forecast's handling of
//      the evidence — partial and full relief, retry identity — is
//      the merged behaviour pinned by the publication-gating suite;
//      here it is driven end-to-end by bridge output and compared
//      against the direct Forecast oracle.
//   4. pin-unavailable / document-missing / digest-mismatch stay
//      distinct, remove prior evidence, invoke the merged withholding
//      and recover on later qualified reads. Partial or malformed
//      dependency configuration fails closed as
//      unavailable('invalid-configuration').
//   5. The loader's stability protocol survives acquisition: the
//      bridge passes the injected readDocument straight through, so
//      the loader's verification read and stability re-read are two
//      real reads (counted here), and bytes that move between them
//      are document-changed — one cached snapshot cannot masquerade
//      as independently observed stability.
//   6. The served input is never mutated (even when frozen), no
//      outcome is cached across requests or failures, and concurrent
//      attaches stay independent.
//   7. Served output carries no raw document or history, no household
//      identity, credentials, reader configuration or raw errors; the
//      serving path performs no store writes; and hostile fields
//      pre-seeded on the served object cannot smuggle evidence in or
//      influence which readers run — the dependency is fixed at
//      construction.
//
// Against the pre-change tree the bridge module does not exist, so
// the bridge-dependent tests fail per-test (the require is lazy for
// exactly this reason) and the server-wiring pins fail as assertions,
// while the unconfigured controls (inactive identity is meaningless
// without the module, but the booted-server no-fields control) pass —
// the same failing-before shape the loader suite used.
//
// Follow-on (async acquisition): `attach` and the loader are async —
// readers may return Promises — so the suites' call sites await, the
// production wiring returns await on the attach inside its
// try/finally, and section 8 pins the composition the seam exists
// for: the merged adapters' real async read methods.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast.js'));
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract.js'));
const L = require(path.join(ROOT, 'scripts/settlement-evidence-loader.js'));
const S = require(path.join(ROOT, 'scripts/settlement-evidence-store.js'));
const FA = require(path.join(ROOT, 'scripts/settlement-evidence-file-adapter.js'));
const OA = require(path.join(ROOT, 'scripts/settlement-evidence-object-adapter.js'));
const Assistant = require(path.join(ROOT, 'scripts/assistant-packet.js'));
const fx = require('./fixtures/savings-daily-allocation-contract');

const servingModule = () => require(path.join(ROOT, 'scripts/settlement-evidence-serving.js'));

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');
const NS = 'seam-fixture';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/* ------------------------------------------------------------ fixtures */
// Contract command builders (real Phase 1 flow, synthetic facts) — the
// same shapes the contract / loader / store suites use.
const ev = (over = {}) => ({
  accountId: 'acct-main', currency: 'cad', direction: 'debit',
  date: '2026-10-03', cents: 6000, posted: true, ...over,
});
const linkCmd = (over = {}) => {
  const e = ev(over.evidence || {});
  return {
    version: 1, kind: 'link', goalId: over.goalId || 'commitment:near',
    txRef: over.txRef || tx(1), evidence: e, evidenceDigest: C.digest(e),
    assignedCents: over.assignedCents !== undefined ? over.assignedCents : 2500,
    asOf: over.asOf || '2026-10-04',
  };
};

// Minimal file-backed object transport implementing the object
// adapter's contract (conditional create/replace with version +
// integrity acks, paged list). One durable layout serves both the
// in-process store and the fresh-process probe: objects are JSON
// records under <root>/objects/<base64url(key)>.json.
function makeFileTransport(root) {
  const dir = path.join(root, 'objects');
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = key => path.join(dir, Buffer.from(key, 'utf8').toString('base64url') + '.json');
  const readRec = key => {
    try { return JSON.parse(fs.readFileSync(fileFor(key), 'utf8')); } catch { return null; }
  };
  const conflict = () => { const e = new Error('synthetic transport: conditional write conflict'); e.code = 'conflict'; return e; };
  return {
    dir,
    fileFor,
    readRaw(key) {
      const rec = readRec(key);
      return rec ? Buffer.from(rec.bytesB64, 'base64') : null;
    },
    async read(key) {
      const rec = readRec(key);
      return rec ? { bytes: Buffer.from(rec.bytesB64, 'base64'), version: rec.version, metadata: { ...rec.metadata } } : null;
    },
    async create(key, bytes, metadata) {
      if (readRec(key)) throw conflict();
      fs.writeFileSync(fileFor(key), JSON.stringify({
        bytesB64: Buffer.from(bytes).toString('base64'), version: 'v1', metadata,
      }));
      return { version: 'v1', integrity: sha256(bytes) };
    },
    async replace(key, bytes, version, metadata) {
      const rec = readRec(key);
      if (!rec || rec.version !== version) throw conflict();
      const next = 'v' + (Number.parseInt(version.slice(1), 10) + 1);
      fs.writeFileSync(fileFor(key), JSON.stringify({
        bytesB64: Buffer.from(bytes).toString('base64'), version: next, metadata,
      }));
      return { version: next, integrity: sha256(bytes) };
    },
    async list(prefix, cursor) {
      const keys = fs.readdirSync(dir).filter(f => f.endsWith('.json'))
        .map(f => Buffer.from(f.slice(0, -'.json'.length), 'base64url').toString('utf8'))
        .filter(k => k.startsWith(prefix)).sort();
      const offset = cursor === null ? 0 : Number.parseInt(cursor, 10);
      const page = keys.slice(offset, offset + 2);
      return {
        entries: page.map(k => ({ key: k, metadata: { ...readRec(k).metadata } })),
        nextCursor: offset + 2 < keys.length ? String(offset + 2) : null,
      };
    },
  };
}

// Synthetic encryption double (the adapter never decrypts; backups are
// owner-recovery-only by design). Output always differs from plaintext.
const syntheticEncrypt = async bytes => Buffer.concat([
  Buffer.from('synthetic-enc:'), Buffer.from(bytes).reverse(),
]);

// A durable settlement store built ONLY through the merged adapters
// and the store's public flow: bootstrap (genesis) then prepare /
// commit for each link command. Returns the fixture plumbing the read
// side needs: the file adapter's paths and the transport.
async function makeStoreFixture(commands) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-seam-store-'));
  const fileAdapter = FA.createSettlementEvidenceFileAdapter(dir);
  const transport = makeFileTransport(path.join(dir, 'vault'));
  const objectAdapter = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport, encrypt: syntheticEncrypt,
  });
  let t = T0;
  const store = S.createSettlementEvidenceStore({
    householdId,
    documentStore: fileAdapter.documentStore,
    journalStore: fileAdapter.journalStore,
    pinStore: objectAdapter.pinStore,
    backupStore: objectAdapter.backupStore,
    quarantine: fileAdapter.quarantine,
    lock: fileAdapter.lock,
    now: () => (t += 3),
  });
  const boot = await store.bootstrap();
  assert.equal(boot.status, 'bootstrapped', 'fixture store bootstraps genesis');
  let n = 0;
  for (const command of commands) {
    n += 1;
    const prepared = await store.prepare({ actorId, operationId: op(n), command });
    assert.ok(prepared.preview, 'prepare returns a contract preview');
    const receipt = await store.commit({
      actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
    });
    assert.equal(receipt.status, 'committed', 'synthetic link commits through the store');
  }
  return {
    dir, store, transport, documentFile: fileAdapter.paths.documentFile,
    fileAdapter, objectAdapter,
  };
}

// The read-side dependency the bridge consumes, over a fixture's
// durable state. Both readers are synchronous and perform a REAL read
// on every invocation (the loader's stability protocol depends on
// it). The pin reader follows the store suite's interop convention:
// an absent or unreadable pin is a throw, which the loader classifies
// as pin-unavailable.
function fixtureDependency(fxStore, over = {}) {
  const readDocument = over.readDocument || (() => {
    try { return fs.readFileSync(fxStore.documentFile); }
    catch (err) { if (err && err.code === 'ENOENT') return null; throw err; }
  });
  const readPin = over.readPin || (() => {
    const raw = fxStore.transport.readRaw(NS + '/pin.json');
    if (!raw) throw new Error('pin unavailable');
    const pin = JSON.parse(raw.toString('utf8'));
    return { revision: pin.revision, digest: pin.digest };
  });
  return { householdId, readDocument, readPin };
}

// The base served object the packet consumes (the shape the shared
// servedAtlasData return carries), built over a daily-allocation
// fixture plan; tests point its 'near' goalRef at the linked
// commitment, as the #661 fixture does.
function servedOf(x) {
  return {
    plan: x.plan,
    debts: [],
    revolvingExtra: undefined,
    meta: { asOf: x.asOf },
    liveOverlay: null,
    coverage: [],
  };
}
function packetFor(served) {
  return Assistant.buildPacket({
    data: served,
    periods: Assistant.loadPeriods(),
    questionsMarkdown: '',
    now: '2026-10-05T12:00:00.000Z',
    env: {},
  });
}
// The direct Forecast oracle over the same fixture plan (the packet's
// own with-evidence call shape from the publication-gating suite).
function directRecommend(x, eff) {
  const plan = x.plan;
  return F.recommend(plan, x.asOf, {
    fundingSources: plan.funding && plan.funding.options,
    debts: [],
    revolvingExtra: undefined,
    periods: Assistant.loadPeriods(),
    currentPeriodActuals: null,
    operatingPlan: null,
    operatingPlanNote: null,
    ...(eff ? { settlementEvidence: eff } : {}),
  });
}
const treeHash = root => {
  const out = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push(path.relative(root, p) + ':' + sha256(fs.readFileSync(p)));
    }
  };
  walk(root);
  return out.join('\n');
};

/* ------------------------------------------- 1. default-inactive */

test('inactive: no dependency returns the served object itself, untouched', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  for (const dep of [undefined, null]) {
    const serving = createSettlementEvidenceServing(dep);
    assert.equal(serving.active, false);
    const served = Object.freeze({ plan: { a: 1 }, meta: {} });
    assert.equal(await serving.attach(served), served, 'attach is the identity');
    assert.deepEqual(Object.keys(served), ['plan', 'meta'], 'no fields added');
  }
  const serving = createSettlementEvidenceServing();
  assert.equal(serving.active, false, 'no-argument construction is the inactive default');
});

test('server wiring: the shared return point passes through the bridge, constructed with no dependency', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(source, /require\('\.\/scripts\/settlement-evidence-serving\.js'\)/,
    'server.js requires the bridge module');
  assert.match(source, /createSettlementEvidenceServing\(\s*\)/,
    'the production serving is constructed with NO dependency (default-inactive)');
  const attachSites = source.match(/\.attach\(/g) || [];
  assert.equal(attachSites.length, 1, 'exactly one attach call site');
  const fnStart = source.indexOf('async function servedAtlasData');
  const fnEnd = source.indexOf('\n}', fnStart);
  const body = source.slice(fnStart, fnEnd);
  const serveAt = body.indexOf('ServerLiveRefresh.serve');
  const attachAt = body.indexOf('.attach(');
  assert.ok(serveAt >= 0 && attachAt > serveAt,
    'the attach happens inside servedAtlasData, after ServerLiveRefresh.serve');
  // Listener lifetime under the async attach: the return must AWAIT
  // the attach inside the try, so the finally's listener removal runs
  // only after the attach has settled — exactly the ordering the
  // synchronous attach had. A bare `return attach(...)` would strip
  // the abort listeners while an acquisition was still in flight.
  assert.match(body, /return await [^;]*\.attach\(/,
    'servedAtlasData returns await on the attach, inside the try');
  assert.ok(body.includes("req?.removeListener('aborted', cancel)"),
    'the finally removes the request abort listener');
  assert.ok(body.includes("res?.removeListener('close', cancel)"),
    'the finally removes the response close listener');
  // Every consumer of the shared helper awaits it (the packet builder,
  // the /data.json route, the Talk path): no call site consumes the
  // served object synchronously.
  const callLines = source.split('\n')
    .filter(line => line.includes('servedAtlasData(') && !line.includes('function servedAtlasData'));
  assert.equal(callLines.length, 3, 'three servedAtlasData consumers');
  for (const line of callLines) {
    assert.ok(line.includes('await servedAtlasData('),
      'consumer awaits servedAtlasData: ' + line.trim());
  }
});

/* ------------------------------------------------- 2. qualified */

test('qualified: store-committed evidence reaches the served object through the loader', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const dep = fixtureDependency(fixture);
  const serving = createSettlementEvidenceServing(dep);
  const served = { plan: { marker: true } };
  const out = await serving.attach(served);
  assert.notEqual(out, served, 'an active serving returns a new object');
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'qualified' });
  // The evidence is exactly the unchanged loader's projection over the
  // same readers — the bridge adds and removes nothing.
  const direct = await L.loadSettlementEvidence({
    config: { householdId }, readDocument: dep.readDocument, readPin: dep.readPin,
  });
  assert.equal(direct.status, 'qualified');
  assert.deepEqual(out.settlementEvidence, direct.evidence);
  assert.deepEqual(Object.keys(out.settlementEvidence), ['commitments'],
    'the served evidence is the effective projection only — no document, operations or history');
  assert.equal(out.settlementEvidence.commitments.length, 1);
  assert.equal(out.settlementEvidence.commitments[0].goalId, 'commitment:near');
  assert.deepEqual(served, { plan: { marker: true } }, 'the served input is not mutated');
});

test('fresh process: a separate node process reads the durable fixture as qualified', async () => {
  const fixture = await makeStoreFixture([linkCmd({})]);
  const probe = path.join(fixture.dir, 'read-probe.js');
  fs.writeFileSync(probe, `
    const fs = require('node:fs'), path = require('node:path');
    const ROOT = process.env.ATLAS_TEST_APP_ROOT;
    const S = require(path.join(ROOT, 'scripts/settlement-evidence-serving.js'));
    const [documentFile, pinFile, householdId] = process.argv.slice(2);
    const serving = S.createSettlementEvidenceServing({
      householdId,
      readDocument: () => { try { return fs.readFileSync(documentFile); }
        catch (err) { if (err && err.code === 'ENOENT') return null; throw err; } },
      readPin: () => {
        const rec = JSON.parse(fs.readFileSync(pinFile, 'utf8'));
        const pin = JSON.parse(Buffer.from(rec.bytesB64, 'base64').toString('utf8'));
        return { revision: pin.revision, digest: pin.digest };
      },
    });
    (async () => {
      const out = await serving.attach({ probe: true });
      process.stdout.write(JSON.stringify(out));
    })();
  `);
  const pinFile = fixture.transport.fileFor(NS + '/pin.json');
  const stdout = execFileSync(process.execPath, [probe, fixture.documentFile, pinFile, householdId], {
    env: { ...process.env, ATLAS_TEST_APP_ROOT: ROOT }, encoding: 'utf8',
  });
  const out = JSON.parse(stdout);
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'qualified' });
  assert.equal(out.settlementEvidence.commitments.length, 1,
    'the fresh process sees the committed link through the loader');
  assert.equal(out.probe, true);
});

/* --------------------------------------- 3. consumers + Forecast */

test('packet: bridge-qualified output drives Forecast relief exactly like the loader outcome', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]); // 2500 of 6000: partial relief
  const dep = fixtureDependency(fixture);
  const serving = createSettlementEvidenceServing(dep);
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  const bridged = await serving.attach(servedOf(x));
  const packet = packetFor(bridged);
  const direct = await L.loadSettlementEvidence({
    config: { householdId }, readDocument: dep.readDocument, readPin: dep.readPin,
  });
  const expected = directRecommend(x, direct.evidence);
  const baseline = directRecommend(x, null);
  assert.notEqual(expected.weekly, baseline.weekly, 'fixture sanity: evidence moves the recommendation');
  assert.equal(packet.forecast.recommendation.weekly, expected.weekly,
    'packet weekly is the with-evidence Forecast recommendation');
  assert.deepEqual(packet.metadata.settlementEvidence, { status: 'qualified', reason: null });
  const major = (packet.forecast.majorPlanFunding.items || [])
    .find(item => item.id === 'near' || /first club/.test(item.label || ''));
  assert.ok(major, 'major plan funding includes the linked commitment');
  assert.equal(major.need, 35, 'funding need is the relieved remaining, not the original cost');
  // The browser data path is the same object through JSON (what
  // /data.json serializes and the pages parse): the fields survive
  // the round-trip and drive the identical packet.
  const roundTripped = JSON.parse(JSON.stringify(bridged));
  assert.deepEqual(packetFor(roundTripped), packet, 'JSON round-trip preserves the served contract');
});

test('packet: full relief through the bridge matches the direct oracle', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({ assignedCents: 6000 })]); // full 6000 of 6000
  const dep = fixtureDependency(fixture);
  const serving = createSettlementEvidenceServing(dep);
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  const packet = packetFor(await serving.attach(servedOf(x)));
  const direct = await L.loadSettlementEvidence({
    config: { householdId }, readDocument: dep.readDocument, readPin: dep.readPin,
  });
  assert.equal(direct.status, 'qualified');
  const expected = directRecommend(x, direct.evidence);
  assert.equal(packet.forecast.recommendation.weekly, expected.weekly);
  const major = (packet.forecast.majorPlanFunding.items || [])
    .find(item => item.id === 'near' || /first club/.test(item.label || ''));
  assert.ok(major);
  assert.equal(major.need, 0, 'a fully relieved commitment needs nothing further');
});

test('retries: repeated attaches keep receipt identity with no duplicate deduction', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  const first = packetFor(await serving.attach(servedOf(x)));
  const second = packetFor(await serving.attach(servedOf(x)));
  assert.deepEqual(second, first, 'a retried read publishes the identical packet');
  const majorOf = p => (p.forecast.majorPlanFunding.items || [])
    .find(item => item.id === 'near' || /first club/.test(item.label || ''));
  assert.equal(majorOf(second).need, 35, 'relief is applied once, never twice');
});

/* ------------------------------ 4. unavailable distinct + recovery */

test('pin-unavailable: a throwing pin reader withholds with the loader reason, distinctly', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const dep = fixtureDependency(fixture, { readPin: () => { throw new Error('pin store down'); } });
  const serving = createSettlementEvidenceServing(dep);
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  const out = await serving.attach(servedOf(x));
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'unavailable', reason: 'pin-unavailable' });
  assert.ok(!('settlementEvidence' in out), 'an unavailable outcome carries no evidence');
  const packet = packetFor(out);
  assert.deepEqual(packet.metadata.settlementEvidence, { status: 'unavailable', reason: 'pin-unavailable' });
  assert.equal(packet.forecast.status, 'unavailable');
  assert.equal(packet.forecast.reason, 'pin-unavailable');
});

test('document-missing: removing the committed document withholds distinctly and later reads recover', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const before = await serving.attach({ plan: {} });
  assert.equal(before.settlementEvidenceStatus.status, 'qualified');
  const bytes = fs.readFileSync(fixture.documentFile);
  fs.rmSync(fixture.documentFile);
  const missing = await serving.attach({ plan: {} });
  assert.deepEqual(missing.settlementEvidenceStatus, { status: 'unavailable', reason: 'document-missing' });
  assert.ok(!('settlementEvidence' in missing), 'prior evidence is removed, never carried stale');
  fs.writeFileSync(fixture.documentFile, bytes);
  const recovered = await serving.attach({ plan: {} });
  assert.equal(recovered.settlementEvidenceStatus.status, 'qualified', 'a later qualified read recovers');
  assert.deepEqual(recovered.settlementEvidence, before.settlementEvidence);
});

test('digest-mismatch: a fork document at the pinned revision withholds distinctly and recovers', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({ assignedCents: 2500 })]);
  const fork = await makeStoreFixture([linkCmd({ assignedCents: 2000 })]); // same household + revision, different digest
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const genuine = fs.readFileSync(fixture.documentFile);
  fs.writeFileSync(fixture.documentFile, fs.readFileSync(fork.documentFile));
  const out = await serving.attach({ plan: {} });
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'unavailable', reason: 'digest-mismatch' });
  assert.ok(!('settlementEvidence' in out));
  fs.writeFileSync(fixture.documentFile, genuine);
  assert.equal((await serving.attach({ plan: {} })).settlementEvidenceStatus.status, 'qualified');
});

test('partial or malformed dependency configuration fails closed, never unconfigured', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const good = fixtureDependency(fixture);
  const cases = [
    ['non-record dependency', 'a-string'],
    ['array dependency', []],
    ['empty record', {}],
    ['household only, no readers', { householdId }],
    ['malformed household', { householdId: 'nope', readDocument: good.readDocument, readPin: good.readPin }],
    ['non-function document reader', { householdId, readDocument: 'bytes', readPin: good.readPin }],
    ['no pin source at all', { householdId, readDocument: good.readDocument }],
  ];
  for (const [label, dep] of cases) {
    const serving = createSettlementEvidenceServing(dep);
    const out = await serving.attach({ plan: {} });
    assert.deepEqual(out.settlementEvidenceStatus,
      { status: 'unavailable', reason: 'invalid-configuration' }, label);
    assert.ok(!('settlementEvidence' in out), label + ': no evidence');
  }
});

/* ------------------------------------------- 5. stability + races */

test('stability: the loader’s double read performs two real reads per acquisition', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  let reads = 0;
  const dep = fixtureDependency(fixture, {
    readDocument: () => { reads += 1; return fs.readFileSync(fixture.documentFile); },
  });
  const serving = createSettlementEvidenceServing(dep);
  assert.equal((await serving.attach({ plan: {} })).settlementEvidenceStatus.status, 'qualified');
  assert.equal(reads, 2, 'verification read + stability re-read, both real');
  assert.equal((await serving.attach({ plan: {} })).settlementEvidenceStatus.status, 'qualified');
  assert.equal(reads, 4, 'no acquisition is cached across requests');
});

test('stability: bytes that move between the two reads are document-changed', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({ assignedCents: 2500 })]);
  const fork = await makeStoreFixture([linkCmd({ assignedCents: 2000 })]);
  let calls = 0;
  const dep = fixtureDependency(fixture, {
    readDocument: () => {
      calls += 1;
      // A concurrent writer lands between the loader's two reads.
      if (calls === 2) return fs.readFileSync(fork.documentFile);
      return fs.readFileSync(fixture.documentFile);
    },
  });
  const serving = createSettlementEvidenceServing(dep);
  const out = await serving.attach({ plan: {} });
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'unavailable', reason: 'document-changed' });
  assert.ok(!('settlementEvidence' in out));
});

test('concurrency: parallel attaches are independent, and a later commit is seen without caching', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const inputs = Array.from({ length: 8 }, (_, i) => ({ plan: { i } }));
  const snapshots = inputs.map(o => JSON.stringify(o));
  const outs = await Promise.all(inputs.map(o => serving.attach(o)));
  for (const out of outs) {
    assert.equal(out.settlementEvidenceStatus.status, 'qualified');
    assert.deepEqual(out.settlementEvidence, outs[0].settlementEvidence);
  }
  assert.deepEqual(inputs.map(o => JSON.stringify(o)), snapshots, 'no input was mutated');
  // A new commit advances the evidence; the next attach sees it —
  // nothing qualified is cached across requests.
  const prepared = await fixture.store.prepare({
    actorId, operationId: op(2),
    command: linkCmd({ goalId: 'commitment:far', txRef: tx(2), assignedCents: 1000 }),
  });
  const receipt = await fixture.store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed');
  const next = await serving.attach({ plan: {} });
  assert.equal(next.settlementEvidence.commitments.length, 2, 'the new revision is acquired fresh');
});

test('concurrency: two attaches over ONE shared served object stay isolated in everything the seam owns', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const qualified = createSettlementEvidenceServing(fixtureDependency(fixture));
  const failing = createSettlementEvidenceServing(
    fixtureDependency(fixture, { readPin: () => { throw new Error('pin store down'); } }));
  // ServerLiveRefresh.serve can resolve coalesced waiters with the
  // SAME object; both in-flight requests attach over this one input.
  const shared = { plan: { nested: { marker: 'original' } }, debts: [], meta: { asOf: '2026-10-04' } };
  const snapshot = JSON.stringify(shared);
  const [outQ, outU] = await Promise.all([qualified.attach(shared), failing.attach(shared)]);
  assert.notEqual(outQ, outU, 'each request receives its own top-level object');
  assert.equal(outQ.settlementEvidenceStatus.status, 'qualified');
  assert.deepEqual(outU.settlementEvidenceStatus, { status: 'unavailable', reason: 'pin-unavailable' });
  assert.ok(!('settlementEvidence' in outU), 'the failing request observes none of the other request’s evidence');
  // Mutating everything the seam OWNS on one output — the status
  // object and the whole evidence graph — reaches neither the other
  // in-flight output, nor the shared input, nor a later attach.
  outQ.settlementEvidenceStatus.status = 'tampered';
  outQ.settlementEvidence.commitments.push({ goalId: 'commitment:fake', links: [] });
  outQ.settlementEvidence.commitments[0].links[0].assignedCents = 1;
  assert.deepEqual(outU.settlementEvidenceStatus, { status: 'unavailable', reason: 'pin-unavailable' });
  const later = await qualified.attach(shared);
  assert.equal(later.settlementEvidenceStatus.status, 'qualified');
  assert.equal(later.settlementEvidence.commitments.length, 1);
  assert.equal(later.settlementEvidence.commitments[0].links[0].assignedCents, 2500);
  assert.notEqual(later.settlementEvidence, outQ.settlementEvidence,
    'each attach owns a fresh, loader-built evidence graph');
  assert.equal(JSON.stringify(shared), snapshot,
    'the shared input is byte-stable through concurrent attaches and through output mutation');
  // The guarantee boundary, pinned rather than hidden: the seam owns
  // only the two settlement fields. Nested canonical structures are
  // shared by reference with the input — exactly as serve already
  // shares them across its consumers today — and the seam never
  // writes into them (the byte-stability assertion above).
  assert.equal(outQ.plan, shared.plan);
  assert.equal(outU.plan, shared.plan);
});

test('stability: the bridge supplies no snapshot of its own — the injected reader is called straight through', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  // A reader returning a FRESH buffer object per call (identical
  // bytes) qualifies — the loader compares bytes across two real
  // acquisitions, and nothing pins the first buffer.
  let freshCalls = 0;
  const fresh = fixtureDependency(fixture, {
    readDocument: () => { freshCalls += 1; return Buffer.from(fs.readFileSync(fixture.documentFile)); },
  });
  const s1 = createSettlementEvidenceServing(fresh);
  assert.equal(freshCalls, 0, 'construction performs no acquisition');
  assert.equal((await s1.attach({ plan: {} })).settlementEvidenceStatus.status, 'qualified');
  assert.equal(freshCalls, 2, 'exactly two reader invocations per attach — verification + stability');
  // A reader that hands back ONE cached buffer and mutates it in
  // place between the loader's reads: the loader's first-read
  // snapshot is its own copy, so the in-place change is observed by
  // the second read and classified document-changed. If the bridge
  // interposed a snapshot of its own (or the first buffer were
  // trusted as the record), the mutation would be invisible and this
  // would wrongly qualify.
  const fork = await makeStoreFixture([linkCmd({ assignedCents: 2000 })]);
  const forkBytes = fs.readFileSync(fork.documentFile);
  const cached = Buffer.from(fs.readFileSync(fixture.documentFile));
  let cachedCalls = 0;
  const caching = fixtureDependency(fixture, {
    readDocument: () => {
      cachedCalls += 1;
      if (cachedCalls === 2) forkBytes.copy(cached);
      return cached;
    },
  });
  const out = await createSettlementEvidenceServing(caching).attach({ plan: {} });
  assert.equal(cachedCalls, 2);
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'unavailable', reason: 'document-changed' });
  assert.ok(!('settlementEvidence' in out));
});

/* ------------------------------------------------- 6/7. hygiene */

test('hostile served fields cannot smuggle evidence or select readers', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const smuggled = {
    commitments: [{
      goalId: 'commitment:near',
      links: [{
        operationId: op(99), txRef: tx(99), assignedCents: 6000,
        effectiveDate: '2026-10-03', asOf: '2026-10-04',
        evidenceDigest: 'f'.repeat(64), reversals: [],
      }],
    }],
  };
  const hostile = {
    plan: {},
    settlementEvidenceStatus: { status: 'qualified' },
    settlementEvidence: smuggled,
    readDocument: 'junk', householdId: 'household-' + 'b'.repeat(32),
  };
  // Under an unavailable dependency the smuggled fields vanish.
  const down = createSettlementEvidenceServing(
    fixtureDependency(fixture, { readPin: () => { throw new Error('down'); } }));
  const outDown = await down.attach(hostile);
  assert.deepEqual(outDown.settlementEvidenceStatus, { status: 'unavailable', reason: 'pin-unavailable' });
  assert.ok(!('settlementEvidence' in outDown), 'smuggled evidence does not survive projection');
  // Under a qualified dependency the evidence is the loader's, not the input's.
  const up = createSettlementEvidenceServing(fixtureDependency(fixture));
  const outUp = await up.attach(hostile);
  assert.equal(outUp.settlementEvidenceStatus.status, 'qualified');
  assert.notDeepEqual(outUp.settlementEvidence, smuggled);
  assert.equal(outUp.settlementEvidence.commitments[0].links[0].operationId, op(1),
    'the evidence is the committed operation, not the planted one');
});

test('served output carries no raw document, history, identity or configuration', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const out = await serving.attach({ plan: {} });
  const text = JSON.stringify(out);
  assert.ok(!text.includes(householdId), 'no household identity in served output');
  assert.ok(!text.includes('"operations"'), 'no raw document operation history');
  assert.ok(!text.includes(fixture.dir), 'no reader configuration (paths) in served output');
  assert.ok(!text.includes(NS), 'no reader configuration (namespace) in served output');
  assert.deepEqual(Object.keys(out.settlementEvidenceStatus), ['status'],
    'a qualified status carries the status and nothing else');
});

test('serving performs no store writes of any kind', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const beforeHash = treeHash(fixture.dir);
  await serving.attach({ plan: {} });
  await serving.attach({ plan: {} });
  const down = createSettlementEvidenceServing(
    fixtureDependency(fixture, { readPin: () => { throw new Error('down'); } }));
  await down.attach({ plan: {} });
  assert.equal(treeHash(fixture.dir), beforeHash,
    'acquisition (qualified or failed) leaves every durable byte untouched');
});

test('attach never mutates the served input, even when frozen', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing(fixtureDependency(fixture));
  const served = Object.freeze({ plan: Object.freeze({ a: 1 }), meta: Object.freeze({}) });
  const out = await serving.attach(served);
  assert.equal(out.settlementEvidenceStatus.status, 'qualified');
  assert.deepEqual(Object.keys(served), ['plan', 'meta'], 'the frozen input gained no fields');
});

/* --------------------- 8. async acquisition through the real adapters */
// The pins above drive the bridge with hand-rolled synchronous
// readers (the sync composition). The production readers this seam
// exists for are the merged adapters' ASYNC read methods — the study
// (atlas-080/async-study) reproduced the unchanged synchronous loader
// misclassifying a healthy store through them (GAP-1..7). These pins
// close that gap at the composition level: the loader's timing changed
// (readers may return Promises), nothing else did.

test('adapter composition: the real async adapter reads qualify through the bridge', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  let docReads = 0; let pinReads = 0;
  const serving = createSettlementEvidenceServing({
    householdId,
    readDocument: () => { docReads += 1; return fixture.fileAdapter.documentStore.read(); },
    readPin: () => { pinReads += 1; return fixture.objectAdapter.pinStore.read(); },
  });
  const out = await serving.attach({ plan: {} });
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'qualified' });
  assert.equal(pinReads, 1, 'one pin acquisition through pinStore.read');
  assert.equal(docReads, 2, 'two genuine document acquisitions through documentStore.read');
  assert.equal(out.settlementEvidence.commitments.length, 1);
  assert.equal(out.settlementEvidence.commitments[0].goalId, 'commitment:near');
  // The projection is identical to the synchronous control composition
  // over the same durable state — timing changed, evidence did not.
  const control = createSettlementEvidenceServing(fixtureDependency(fixture));
  const controlOut = await control.attach({ plan: {} });
  assert.deepEqual(out.settlementEvidence, controlOut.settlementEvidence,
    'adapter-backed evidence deep-equals the sync control projection');
});

test('adapter composition: a fresh process reads the durable fixture through the adapters as qualified', async () => {
  const fixture = await makeStoreFixture([linkCmd({})]);
  const probe = path.join(fixture.dir, 'adapter-probe.js');
  fs.writeFileSync(probe, `
    const fs = require('node:fs'), path = require('node:path');
    const ROOT = process.env.ATLAS_TEST_APP_ROOT;
    const FA = require(path.join(ROOT, 'scripts/settlement-evidence-file-adapter.js'));
    const OA = require(path.join(ROOT, 'scripts/settlement-evidence-object-adapter.js'));
    const S = require(path.join(ROOT, 'scripts/settlement-evidence-serving.js'));
    const [storeDir, vaultDir, householdId, namespace] = process.argv.slice(2);
    // Read-only mirror of the suite transport's durable layout
    // (objects as JSON records under <vault>/objects/<base64url>.json);
    // pinStore.read performs transport.read and nothing else.
    const transport = {
      async read(key) {
        const file = path.join(vaultDir, 'objects',
          Buffer.from(key, 'utf8').toString('base64url') + '.json');
        try {
          const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
          return { bytes: Buffer.from(rec.bytesB64, 'base64'), version: rec.version, metadata: { ...rec.metadata } };
        } catch { return null; }
      },
      async create() { throw new Error('read-only probe transport'); },
      async replace() { throw new Error('read-only probe transport'); },
      async list() { throw new Error('read-only probe transport'); },
    };
    const fileAdapter = FA.createSettlementEvidenceFileAdapter(storeDir);
    const objectAdapter = OA.createSettlementEvidenceObjectAdapter({
      householdId, namespace, transport,
      encrypt: async bytes => Buffer.concat([Buffer.from('synthetic-enc:'), Buffer.from(bytes).reverse()]),
    });
    const serving = S.createSettlementEvidenceServing({
      householdId,
      readDocument: () => fileAdapter.documentStore.read(),
      readPin: () => objectAdapter.pinStore.read(),
    });
    (async () => {
      const out = await serving.attach({ probe: true });
      process.stdout.write(JSON.stringify(out));
    })();
  `);
  const stdout = execFileSync(process.execPath,
    [probe, fixture.dir, path.join(fixture.dir, 'vault'), householdId, NS], {
      env: { ...process.env, ATLAS_TEST_APP_ROOT: ROOT }, encoding: 'utf8',
    });
  const out = JSON.parse(stdout);
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'qualified' });
  assert.equal(out.settlementEvidence.commitments.length, 1);
  assert.equal(out.probe, true);
});

test('adapter composition: pin advancement is followed; a superseded static pin withholds', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const serving = createSettlementEvidenceServing({
    householdId,
    readDocument: () => fixture.fileAdapter.documentStore.read(),
    readPin: () => fixture.objectAdapter.pinStore.read(),
  });
  const first = await serving.attach({ plan: {} });
  assert.equal(first.settlementEvidence.commitments.length, 1);
  const pinV1 = await fixture.objectAdapter.pinStore.read();
  const prepared = await fixture.store.prepare({
    actorId, operationId: op(2),
    command: linkCmd({ goalId: 'commitment:far', txRef: tx(2), assignedCents: 1000 }),
  });
  const receipt = await fixture.store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed');
  const advanced = await serving.attach({ plan: {} });
  assert.equal(advanced.settlementEvidenceStatus.status, 'qualified');
  assert.equal(advanced.settlementEvidence.commitments.length, 2,
    'the adapter-backed attach follows the pin to the new revision');
  // A dependency still carrying the superseded pin pair against the
  // advanced document withholds in the mismatch family — never a
  // mixed-state qualification.
  const stale = createSettlementEvidenceServing({
    householdId,
    pin: { revision: pinV1.revision, digest: pinV1.digest },
    readDocument: () => fixture.fileAdapter.documentStore.read(),
  });
  const staleOut = await stale.attach({ plan: {} });
  assert.deepEqual(staleOut.settlementEvidenceStatus,
    { status: 'unavailable', reason: 'document-ahead-of-pin' });
  assert.ok(!('settlementEvidence' in staleOut));
});

test('adapter rejection: rejected adapter reads project as withheld statuses, no evidence, no escapes', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const escaped = [];
  const guard = reason => { escaped.push(String(reason && reason.message || reason)); };
  process.on('unhandledRejection', guard);
  try {
    const pinDown = createSettlementEvidenceServing({
      householdId,
      readDocument: () => fixture.fileAdapter.documentStore.read(),
      readPin: () => Promise.reject(new Error('pin transport unreachable')),
    });
    const outPin = await pinDown.attach({ plan: {} });
    assert.deepEqual(outPin.settlementEvidenceStatus,
      { status: 'unavailable', reason: 'pin-unavailable' });
    assert.ok(!('settlementEvidence' in outPin));
    const docDown = createSettlementEvidenceServing({
      householdId,
      readDocument: () => Promise.reject(new Error('backing store unreachable')),
      readPin: () => fixture.objectAdapter.pinStore.read(),
    });
    const outDoc = await docDown.attach({ plan: {} });
    assert.deepEqual(outDoc.settlementEvidenceStatus,
      { status: 'unavailable', reason: 'document-unavailable' });
    assert.ok(!('settlementEvidence' in outDoc));
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(escaped, [], 'no adapter rejection escapes the seam unhandled');
  } finally {
    process.removeListener('unhandledRejection', guard);
  }
});

test('abandonment: an attach the caller stops awaiting leaves no residue for the next attach', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  // A slow reader keeps the first attach in flight while an
  // independent attach completes against the same durable state.
  // Cancellation here is abandonment only: nothing aborts the
  // in-flight acquisition, and its completion changes nothing —
  // the seam caches no outcome across requests.
  const slow = fixtureDependency(fixture, {
    readDocument: async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return fs.readFileSync(fixture.documentFile);
    },
  });
  const slowServing = createSettlementEvidenceServing(slow);
  const abandoned = slowServing.attach({ plan: {} });
  const fast = await createSettlementEvidenceServing(fixtureDependency(fixture))
    .attach({ plan: {} });
  assert.equal(fast.settlementEvidenceStatus.status, 'qualified');
  const settled = await abandoned;
  assert.equal(settled.settlementEvidenceStatus.status, 'qualified',
    'the abandoned attach settles on its own terms');
  assert.deepEqual(settled.settlementEvidence, fast.settlementEvidence);
  const next = await slowServing.attach({ plan: {} });
  assert.equal(next.settlementEvidenceStatus.status, 'qualified');
  assert.deepEqual(next.settlementEvidence, fast.settlementEvidence,
    'no state from the abandoned flight is carried into the next attach');
});

test('concurrency: parallel attaches over ONE shared adapter pair stay coherent under an interleaved commit', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const adapterDependency = {
    householdId,
    readDocument: () => fixture.fileAdapter.documentStore.read(),
    readPin: () => fixture.objectAdapter.pinStore.read(),
  };
  const plain = createSettlementEvidenceServing(adapterDependency);
  // Independent oracles: the direct loader over synchronous readers of
  // the same durable state, taken at each revision. The flights below
  // must match these EXACTLY — full outcome and evidence, never a
  // commitment count.
  const oracle = async () => {
    const dep = fixtureDependency(fixture);
    const direct = await L.loadSettlementEvidence({
      config: { householdId }, readDocument: dep.readDocument, readPin: dep.readPin,
    });
    assert.equal(direct.status, 'qualified');
    return direct.evidence;
  };
  const expectedPre = await oracle();
  const docBytesPre = fs.readFileSync(fixture.documentFile);
  assert.equal(JSON.parse(docBytesPre.toString('utf8')).revision, 1);
  // Pre-commit flight: completes entirely at revision 1, exactly.
  const pre = await plain.attach({ plan: {} });
  assert.deepEqual(pre.settlementEvidenceStatus, { status: 'qualified' });
  assert.deepEqual(pre.settlementEvidence, expectedPre);

  // Deterministic acquisition barriers: each gated flight parks at an
  // exact point inside its acquisition, announces the park to the
  // test, and proceeds only when the test opens its gate. No clock,
  // no timing window: the interleaving is chosen, not hoped for.
  const gate = () => {
    let open;
    const promise = new Promise(resolve => { open = resolve; });
    return { promise, open };
  };
  // Flight B parks BEFORE its first document read. Its pin has
  // already been acquired (the loader resolves the pin first) and
  // names revision 1.
  const gateB = gate();
  let announceB; const parkedB = new Promise(resolve => { announceB = resolve; });
  let bDocCalls = 0;
  const flightB = createSettlementEvidenceServing({
    householdId,
    readPin: adapterDependency.readPin,
    readDocument: async () => {
      bDocCalls += 1;
      if (bDocCalls === 1) { announceB(); await gateB.promise; }
      return fixture.fileAdapter.documentStore.read();
    },
  }).attach({ plan: {} });
  // Flight C parks BEFORE its second document read. Its first read
  // has already returned the revision-1 bytes and been verified
  // against the revision-1 pin.
  const gateC = gate();
  let announceC; const parkedC = new Promise(resolve => { announceC = resolve; });
  let cDocCalls = 0;
  const flightC = createSettlementEvidenceServing({
    householdId,
    readPin: adapterDependency.readPin,
    readDocument: async () => {
      cDocCalls += 1;
      if (cDocCalls === 2) { announceC(); await gateC.promise; }
      return fixture.fileAdapter.documentStore.read();
    },
  }).attach({ plan: {} });
  await Promise.all([parkedB, parkedC]);

  // The commit lands while both flights are parked mid-acquisition.
  const prepared = await fixture.store.prepare({
    actorId, operationId: op(2),
    command: linkCmd({ goalId: 'commitment:far', txRef: tx(2), assignedCents: 1000 }),
  });
  const receipt = await fixture.store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed');
  const expectedPost = await oracle();
  const docBytesPost = fs.readFileSync(fixture.documentFile);
  assert.equal(JSON.parse(docBytesPost.toString('utf8')).revision, 2);
  assert.ok(!docBytesPost.equals(docBytesPre), 'the commit moved the durable document');
  assert.notDeepEqual(expectedPost, expectedPre, 'the two revisions project different evidence');

  gateB.open();
  gateC.open();
  const [outB, outC] = await Promise.all([flightB, flightC]);
  // B holds the revision-1 pin and now reads the revision-2 document:
  // a pair observed across the commit fails closed, exactly.
  assert.deepEqual(outB.settlementEvidenceStatus,
    { status: 'unavailable', reason: 'document-ahead-of-pin' });
  assert.ok(!('settlementEvidence' in outB));
  assert.equal(bDocCalls, 1, 'B read the document once and was refused at staging');
  // C verified the revision-1 bytes; its re-read returns revision-2
  // bytes and the stability comparison refuses, exactly.
  assert.deepEqual(outC.settlementEvidenceStatus,
    { status: 'unavailable', reason: 'document-changed' });
  assert.ok(!('settlementEvidence' in outC));
  assert.equal(cDocCalls, 2, 'C performed both reads of the stability protocol');
  // A post-commit flight over the same shared adapter pair qualifies
  // with EXACTLY the post-commit evidence.
  const post = await plain.attach({ plan: {} });
  assert.deepEqual(post.settlementEvidenceStatus, { status: 'qualified' });
  assert.deepEqual(post.settlementEvidence, expectedPost);
});

test('attach snapshot: the projection is computed from the served object as it stood at attach time', async () => {
  const { createSettlementEvidenceServing } = servingModule();
  const fixture = await makeStoreFixture([linkCmd({})]);
  const served = { plan: { marker: 'at-attach' }, meta: {} };
  // During the acquisition window the caller replaces a top-level
  // field and plants settlement fields on the input. The attach
  // snapshotted the top level (and stripped the seam-owned fields)
  // before acquiring, so neither edit reaches the projection.
  const dep = fixtureDependency(fixture, {
    readDocument: async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      served.plan = { marker: 'moved' };
      served.settlementEvidenceStatus = { status: 'qualified' };
      served.settlementEvidence = { commitments: [] };
      return fs.readFileSync(fixture.documentFile);
    },
  });
  const out = await createSettlementEvidenceServing(dep).attach(served);
  assert.equal(out.plan.marker, 'at-attach',
    'top-level fields are the attach-time snapshot, not the post-acquisition edit');
  assert.equal(out.settlementEvidenceStatus.status, 'qualified');
  assert.equal(out.settlementEvidence.commitments.length, 1,
    'the evidence is the loader’s, not the planted field');
});

/* --------------------------- 1 (HTTP). booted server, default-off */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}
function startAtlas(env) {
  return new Promise((resolve, reject) => {
    let stdout = ''; let stderr = ''; let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return; settled = true; child.kill('SIGTERM');
      reject(new Error('server start timeout\n' + stderr));
    }, 15000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!settled && /listening/.test(stdout)) {
        settled = true; clearTimeout(timer);
        resolve({
          stop: () => new Promise(done => {
            child.once('exit', () => done());
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already gone */ } }, 2000);
          }),
        });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      if (settled) return; settled = true; clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${stderr}`));
    });
  });
}

test('booted server: production default serves /data.json with no settlement fields, byte-identical', async () => {
  const port = await freePort();
  const PASS = ['synthetic', 'site', 'password'].join('-');
  const SECRET = ['synthetic', 'session', 'secret'].join('-');
  const env = { ...process.env, SITE_PASSWORD: PASS, SESSION_SECRET: SECRET, PORT: String(port) };
  for (const key of Object.keys(env)) if (/^(ATLAS_|LUNCHMONEY_)/.test(key)) delete env[key];
  const atlas = await startAtlas(env);
  try {
    const base = `http://127.0.0.1:${port}`;
    const login = await fetch(`${base}/login`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=' + encodeURIComponent(PASS),
    });
    assert.equal(login.status, 302, 'login issues a session');
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie, 'session cookie issued');
    const res = await fetch(`${base}/data.json`, { headers: { cookie } });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('settlementEvidence'), 'no settlement fields anywhere in the served bytes');
    const canonical = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
    const LivePlan = require(path.join(ROOT, 'scripts/live-plan.js'));
    const expected = await LivePlan.applyForServer(canonical, env);
    assert.equal(text, JSON.stringify(expected),
      'served bytes are exactly the pre-seam serve output (refresh-trust attachment included)');
  } finally {
    await atlas.stop();
  }
});
