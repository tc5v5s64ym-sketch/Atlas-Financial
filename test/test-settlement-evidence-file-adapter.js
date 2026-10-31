'use strict';
// Settlement evidence file adapter (ATLAS-080) — synthetic tests only.
//
// The adapter is the private POSIX filesystem persistence boundary for
// the merged settlement store: it supplies the store's document,
// journal, quarantine and shared-lock surfaces over one explicitly
// supplied, already-existing, owner-private directory, following the
// incumbent private-file conventions of
// scripts/card-payment-decision-store.js (privateRoot validation,
// exclusive-create lock that is never stolen, file fsync before atomic
// rename, directory fsync after). Pin and off-volume backup stay
// injected doubles here — the adapter never replaces their independent
// authority with local files.
//
// Crash simulation is real at the process boundary: child Node
// processes are hard-killed (or exit abruptly) between pipeline steps
// over the same directory, and a fresh store instance plus the REAL
// merged loader classify the durable result. All directories are
// created under the OS temp area (fs.mkdtemp) — never in the repo tree.
//
// Synthetic restart proof is NOT Render redeploy durability and NOT
// live Savings acceptance: no provisioning, configuration, credentials,
// endpoints, live callers or activation anywhere in this suite.
//
// Tests first: against unmodified main this suite fails to load (the
// adapter module does not exist).
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const L = require(path.join(ROOT, 'scripts/settlement-evidence-loader'));
const S = require(path.join(ROOT, 'scripts/settlement-evidence-store'));
const A = require(path.join(ROOT, 'scripts/settlement-evidence-file-adapter'));

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');

// --- Contract command builders (real Phase 1 flow, synthetic facts) -----
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
const pinOf = bytes => {
  const s = JSON.parse(bytes.toString('utf8'));
  return { revision: s.revision, digest: s.digest };
};
const stateOf = bytes => JSON.parse(bytes.toString('utf8'));

// --- Injected authorities that stay OFF the local filesystem ------------
// Pin and backup are the caller's independent authorities (in-memory
// doubles here, exactly as in the store suite). They survive "restarts"
// because they are not the thing being restarted.
function makeAuthorities() {
  const durable = { pin: null, backups: new Map(), artifactSeq: 0 };
  const faults = { pinAdvance: null };
  const pinStore = {
    async read() {
      return durable.pin ? { ...durable.pin } : null;
    },
    async advance(expected, next) {
      if (faults.pinAdvance === 'throw') {
        faults.pinAdvance = null;
        throw new Error('injected pin.advance');
      }
      const cur = durable.pin;
      const match = expected === null
        ? cur === null
        : !!cur && cur.revision === expected.revision && cur.digest === expected.digest;
      if (!match) return false;
      durable.pin = { ...next };
      return true;
    },
  };
  const backupStore = {
    async put(revision, digest, bytes) {
      const key = revision + ':' + digest;
      if (!durable.backups.has(key)) {
        durable.backups.set(key, {
          revision, digest, artifactId: 'artifact-' + (++durable.artifactSeq),
          bytes: Buffer.from(bytes),
        });
      }
      const e = durable.backups.get(key);
      return { revision: e.revision, digest: e.digest, artifactId: e.artifactId };
    },
    async get(revision, digest) {
      const e = durable.backups.get(revision + ':' + digest);
      return e ? Buffer.from(e.bytes) : null;
    },
    async list() {
      return [...durable.backups.values()].map(e => ({
        revision: e.revision, digest: e.digest, artifactId: e.artifactId,
      }));
    },
  };
  let tick = T0;
  const clock = { now: () => tick, advance: ms => { tick += ms; } };
  return { durable, faults, pinStore, backupStore, clock };
}

// --- Composition -----------------------------------------------------------
function newStore(dir, auth) {
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  const store = S.createSettlementEvidenceStore({
    householdId,
    documentStore: adapter.documentStore,
    journalStore: adapter.journalStore,
    pinStore: auth.pinStore,
    backupStore: auth.backupStore,
    quarantine: adapter.quarantine,
    lock: adapter.lock,
    now: auth.clock.now,
  });
  return { adapter, store };
}
async function bootDir(dir, auth) {
  const { adapter, store } = newStore(dir, auth);
  const boot = await store.bootstrap();
  assert.equal(boot.status, 'bootstrapped');
  assert.equal(boot.revision, 0);
  return { adapter, store };
}
async function commitLink(store, auth, n, over = {}) {
  const prepared = await store.prepare({
    actorId, operationId: op(n), command: linkCmd(over),
  });
  assert.ok(prepared.preview, 'prepare returns a contract preview');
  const receipt = await store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed', 'synthetic link commits');
  return receipt;
}
// The REAL merged loader over the persisted files + the injected pin.
// The document reader here is a plain synchronous file read — the
// control composition, which the loader accepts unchanged alongside
// Promise-returning readers; the production-shaped composition (the
// adapter's own async documentStore.read) is pinned in the server-seam
// suite. The adapter's reads are exercised through the store on every
// operation.
async function loadFromDir(dir, auth) {
  return await L.loadSettlementEvidence({
    config: { householdId },
    readDocument: () => {
      try { return fs.readFileSync(path.join(dir, 'document.json')); }
      catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    },
    readPin: () => {
      if (!auth.durable.pin) throw new Error('pin unavailable');
      return { revision: auth.durable.pin.revision, digest: auth.durable.pin.digest };
    },
  });
}

// --- Temp directory + on-disk helpers --------------------------------------
const tempRoots = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settlement-adapter-'));
  tempRoots.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  try { fs.rmSync(harnessDir, { recursive: true, force: true }); } catch { /* best effort */ }
});
function listing(dir) {
  return fs.readdirSync(dir).sort();
}
function plant(dir, name, bytes) {
  const target = path.join(dir, name);
  try { fs.unlinkSync(target); } catch { /* absent is fine */ }
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  // The planted mode is part of the fixture's meaning (the adapter
  // validates planted traces as owner-private files); pin it explicitly
  // so a restrictive process umask (hosted CI runs umask 077) cannot
  // silently narrow it.
  fs.chmodSync(target, 0o600);
}
function readIfExists(dir, name) {
  try { return fs.readFileSync(path.join(dir, name)); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// --- Child process (generated scaffolding under the OS temp area) ---------
// One self-contained script with modes:
//   load       — run the merged loader over the directory, print JSON
//   hold-lock  — take the adapter lock and never release it
//   crash      — run a real store commit that process.exit(3)s at the
//                named pipeline step (writeTemp | commitTemp | pinAdvance)
//   roundtrip  — bootstrap + commit + loader over the directory with
//                in-child pin/backup doubles, print JSON (cwd proof)
const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settlement-harness-'));
const childPath = path.join(harnessDir, 'child.js');
const CHILD_SOURCE = `
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT;
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const L = require(path.join(ROOT, 'scripts/settlement-evidence-loader'));
const S = require(path.join(ROOT, 'scripts/settlement-evidence-store'));
const A = require(path.join(ROOT, 'scripts/settlement-evidence-file-adapter'));
const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');
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
const mode = process.argv[2];
const dir = process.argv[3];
if (mode === 'load') {
  const pin = JSON.parse(process.argv[4]);
  (async () => {
    const out = await L.loadSettlementEvidence({
      config: { householdId },
      readDocument: () => {
        try { return fs.readFileSync(path.join(dir, 'document.json')); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      },
      readPin: () => ({ revision: pin.revision, digest: pin.digest }),
    });
    process.stdout.write(JSON.stringify(out));
  })().catch(e => { fs.writeSync(2, String(e && e.stack || e)); process.exit(8); });
} else if (mode === 'hold-lock') {
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  adapter.lock.withLock(async () => {
    fs.writeSync(1, 'locked\\n');
    setInterval(() => {}, 60000); // a live holder keeps the event loop
    await new Promise(() => {});
  }).catch(e => { fs.writeSync(2, String(e && e.stack || e)); process.exit(8); });
} else if (mode === 'crash') {
  const crashAt = process.argv[4];
  const pin = JSON.parse(process.argv[5]);
  const opN = Number(process.argv[6]);
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  const documentStore = Object.assign({}, adapter.documentStore);
  if (crashAt === 'writeTemp') documentStore.writeTemp = () => process.exit(3);
  if (crashAt === 'commitTemp') documentStore.commitTemp = () => process.exit(3);
  let pinState = pin;
  const pinStore = {
    read: async () => (pinState ? Object.assign({}, pinState) : null),
    advance: async (expected, next) => {
      if (crashAt === 'pinAdvance') process.exit(3);
      const cur = pinState;
      const match = expected === null
        ? cur === null
        : !!cur && cur.revision === expected.revision && cur.digest === expected.digest;
      if (!match) return false;
      pinState = Object.assign({}, next);
      return true;
    },
  };
  const backupStore = {
    put: async (revision, digest) => ({ revision, digest, artifactId: 'artifact-child' }),
    get: async () => null,
    list: async () => [{ revision: pin.revision, digest: pin.digest, artifactId: 'artifact-genesis' }],
  };
  const store = S.createSettlementEvidenceStore({
    householdId, documentStore, journalStore: adapter.journalStore,
    pinStore, backupStore, quarantine: adapter.quarantine,
    lock: adapter.lock, now: () => T0 + 5000,
  });
  (async () => {
    const prepared = await store.prepare({
      actorId, operationId: op(opN), command: linkCmd({ txRef: tx(opN) }),
    });
    if (!prepared.preview) {
      fs.writeSync(2, 'prepare failed: ' + JSON.stringify(prepared));
      process.exit(9);
    }
    const res = await store.commit({
      actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
    });
    fs.writeSync(2, 'commit returned without crashing: ' + JSON.stringify(res));
    process.exit(9);
  })().catch(e => { fs.writeSync(2, String(e && e.stack || e)); process.exit(8); });
} else if (mode === 'roundtrip') {
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  let pinState = null;
  const pinStore = {
    read: async () => (pinState ? Object.assign({}, pinState) : null),
    advance: async (expected, next) => {
      const cur = pinState;
      const match = expected === null
        ? cur === null
        : !!cur && cur.revision === expected.revision && cur.digest === expected.digest;
      if (!match) return false;
      pinState = Object.assign({}, next);
      return true;
    },
  };
  const backups = new Map();
  const backupStore = {
    put: async (revision, digest, bytes) => {
      const key = revision + ':' + digest;
      if (!backups.has(key)) {
        backups.set(key, { revision, digest, artifactId: 'artifact-' + revision, bytes: Buffer.from(bytes) });
      }
      const e = backups.get(key);
      return { revision: e.revision, digest: e.digest, artifactId: e.artifactId };
    },
    get: async (revision, digest) => {
      const e = backups.get(revision + ':' + digest);
      return e ? Buffer.from(e.bytes) : null;
    },
    list: async () => [...backups.values()].map(e => ({
      revision: e.revision, digest: e.digest, artifactId: e.artifactId,
    })),
  };
  const store = S.createSettlementEvidenceStore({
    householdId, documentStore: adapter.documentStore, journalStore: adapter.journalStore,
    pinStore, backupStore, quarantine: adapter.quarantine,
    lock: adapter.lock, now: () => T0 + 5000,
  });
  (async () => {
    const boot = await store.bootstrap();
    if (boot.status !== 'bootstrapped') {
      fs.writeSync(2, 'bootstrap failed: ' + JSON.stringify(boot));
      process.exit(9);
    }
    const prepared = await store.prepare({
      actorId, operationId: op(1), command: linkCmd({}),
    });
    if (!prepared.preview) {
      fs.writeSync(2, 'prepare failed: ' + JSON.stringify(prepared));
      process.exit(9);
    }
    const receipt = await store.commit({
      actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
    });
    const view = await L.loadSettlementEvidence({
      config: { householdId },
      readDocument: () => {
        try { return fs.readFileSync(path.join(dir, 'document.json')); }
        catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      },
      readPin: () => ({ revision: pinState.revision, digest: pinState.digest }),
    });
    process.stdout.write(JSON.stringify({ boot, receipt, view }));
  })().catch(e => { fs.writeSync(2, String(e && e.stack || e)); process.exit(8); });
} else {
  process.exit(7);
}
`;
fs.writeFileSync(childPath, CHILD_SOURCE, { mode: 0o600 });
function runChild(args) {
  return spawnSync(process.execPath, [childPath, ...args], {
    env: { ...process.env, ATLAS_TEST_APP_ROOT: ROOT },
    encoding: 'utf8', timeout: 60000,
  });
}

// === 1. Round trip: store over the real filesystem, restart, child loader ===

test('round trip: bootstrap + commits persist to disk; new instance, restart and a separate child process loader read qualified with exact evidence', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const { store } = await bootDir(dir, auth);
  const genesisBytes = readIfExists(dir, 'document.json');
  assert.ok(genesisBytes.equals(C.adopt({ householdId })), 'genesis installed as real file bytes');
  assert.equal(readIfExists(dir, 'journal.json'), null, 'no journal after bootstrap');
  auth.clock.advance(10);
  const r1 = await commitLink(store, auth, 1);
  auth.clock.advance(10);
  const r2 = await commitLink(store, auth, 2, { txRef: tx(2) });
  assert.equal(r1.revision, 1);
  assert.equal(r2.revision, 2);

  // On-disk layout: the committed document plus residue-free local state.
  const names = listing(dir);
  assert.ok(names.includes('document.json'), 'document.json present');
  assert.ok(!names.includes('journal.json'), 'journal.json absent after clean commits');
  assert.ok(!names.includes('store.lock'), 'lock released after operations');
  assert.ok(!names.some(n => n.startsWith('.document-')), 'no staged-temp residue');
  const docBytes = readIfExists(dir, 'document.json');
  const docState = stateOf(docBytes);
  assert.equal(docState.revision, 2);
  assert.equal(docState.digest, auth.durable.pin.digest, 'pin covers the on-disk document');

  // Restart: a brand-new store AND adapter over the same directory.
  const { store: restarted } = newStore(dir, auth);
  const report = await restarted.reconcile();
  assert.equal(report.row, 'R2');
  assert.equal(report.disposition, 'healthy');
  const view = await loadFromDir(dir, auth);
  assert.equal(view.status, 'qualified');
  const expectedEvidence = C.effectiveEvidence({
    householdId: docState.householdId, revision: docState.revision,
    operations: docState.operations,
  });
  assert.deepEqual(view.evidence, expectedEvidence);
  assert.equal(view.evidence.commitments.length, 1,
    'both links group under the one commitment');
  assert.equal(view.evidence.commitments[0].links.length, 2);
  assert.equal(view.evidence.commitments[0].links[0].assignedCents, 2500);

  // A separate spawned child process over the same directory reads the
  // identical qualified outcome through the loader.
  const pinJson = JSON.stringify(auth.durable.pin);
  const child = runChild(['load', dir, pinJson]);
  assert.equal(child.status, 0, 'child stderr: ' + child.stderr);
  const childView = JSON.parse(child.stdout);
  assert.equal(childView.status, 'qualified');
  assert.deepEqual(childView.evidence, expectedEvidence);
});

// === 8. Receipt invariants across the restart ===

test('receipt invariants: outcome and identical retry reproduce the ORIGINAL revision/digest across a restart', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const { store } = await bootDir(dir, auth);
  auth.clock.advance(10);
  const prep1 = await store.prepare({ actorId, operationId: op(1), command: linkCmd({}) });
  const r1 = await store.commit({
    actorId, preview: prep1.preview, confirmationDigest: prep1.confirmationDigest,
  });
  assert.equal(r1.status, 'committed');
  assert.equal(r1.revision, 1);
  auth.clock.advance(10);
  await commitLink(store, auth, 2, { txRef: tx(2) });
  const beforeBytes = readIfExists(dir, 'document.json');
  const beforePin = { ...auth.durable.pin };

  // Restart.
  const { store: restarted } = newStore(dir, auth);
  const out1 = await restarted.outcome({ actorId, operationId: op(1) });
  assert.equal(out1.status, 'committed');
  assert.equal(out1.revision, 1, 'original revision, not the head');
  assert.equal(out1.digest, r1.digest, 'original digest, not the head digest');
  assert.notEqual(out1.digest, beforePin.digest);
  const out2 = await restarted.outcome({ actorId, operationId: op(2) });
  assert.equal(out2.revision, 2);
  assert.equal(out2.digest, beforePin.digest);

  // An identical retry through the restarted instance reproduces the
  // original receipt and writes nothing.
  const names = listing(dir);
  const retry = await restarted.commit({
    actorId, preview: prep1.preview, confirmationDigest: prep1.confirmationDigest,
  });
  assert.equal(retry.status, 'committed');
  assert.equal(retry.revision, 1);
  assert.equal(retry.digest, r1.digest);
  assert.ok(readIfExists(dir, 'document.json').equals(beforeBytes),
    'document bytes unchanged by the retry');
  assert.deepEqual(listing(dir), names, 'directory unchanged by the retry');
});

// === Adapter-level copy discipline and strict result semantics ===

test('adapter: module surface, null absence semantics, copy discipline, strict validation', async () => {
  assert.deepEqual(Object.keys(A), ['createSettlementEvidenceFileAdapter'],
    'the adapter module exports only the factory');
  const dir = makeDir();
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  assert.deepEqual(Object.keys(adapter).sort(),
    ['documentStore', 'journalStore', 'lock', 'paths', 'quarantine'].sort());

  // Absence is the literal null, never undefined/false/empty.
  assert.strictEqual(await adapter.documentStore.read(), null);
  assert.strictEqual(await adapter.documentStore.readStaged(), null);
  assert.strictEqual(await adapter.journalStore.read(), null);

  // writeTemp copies the caller's bytes; reads return fresh copies.
  const staged = Buffer.from('candidate-bytes');
  await adapter.documentStore.writeTemp(staged);
  staged.fill(0);
  const back1 = await adapter.documentStore.readStaged();
  assert.ok(back1.equals(Buffer.from('candidate-bytes')), 'write copies caller bytes');
  back1.fill(0);
  const back2 = await adapter.documentStore.readStaged();
  assert.ok(back2.equals(Buffer.from('candidate-bytes')), 'reads return fresh copies');
  const u8 = new Uint8Array(Buffer.from('uint8-staged'));
  await adapter.documentStore.writeTemp(u8);
  assert.ok((await adapter.documentStore.readStaged()).equals(Buffer.from('uint8-staged')));
  await adapter.documentStore.discardTemp();
  assert.strictEqual(await adapter.documentStore.readStaged(), null);
  await adapter.documentStore.discardTemp(); // absent is idempotent

  // Journal write serializes the record once; the record is not retained.
  const record = { version: 1, note: 'pending', nested: { b: 2 } };
  await adapter.journalStore.write(record);
  record.note = 'mutated';
  const jbytes = await adapter.journalStore.read();
  assert.deepEqual(JSON.parse(jbytes.toString('utf8')), { version: 1, note: 'pending', nested: { b: 2 } });
  jbytes.fill(0);
  assert.ok((await adapter.journalStore.read()).length > 0, 'journal reads return fresh copies');
  await adapter.journalStore.clear();
  assert.strictEqual(await adapter.journalStore.read(), null);
  await adapter.journalStore.clear(); // absent is idempotent

  // Non-byte inputs are rejected, never coerced.
  await assert.rejects(adapter.documentStore.writeTemp('a-string'), TypeError);
  await assert.rejects(adapter.documentStore.writeTemp(null), TypeError);
  await assert.rejects(adapter.journalStore.write([1, 2]), Error);
  await assert.rejects(adapter.quarantine.put('bad label!', Buffer.from('x')), Error);
});

// === 2. Locking: in-process and cross-process ===

test('held lock in-process: second instances fail closed, release restores work', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  const { adapter, store } = newStore(dir, auth);
  const beforeBytes = readIfExists(dir, 'document.json');

  await adapter.lock.withLock(async () => {
    assert.ok(fs.existsSync(path.join(dir, 'store.lock')), 'lock file exists while held');
    // Same instance, reentrant: fails closed rather than deadlocking.
    await assert.rejects(store.reconcile(), /settlement-file-adapter/);
    // A second adapter instance over the same directory fails closed too.
    const other = newStore(dir, auth);
    await assert.rejects(other.store.reconcile(), /settlement-file-adapter/);
    await assert.rejects(other.adapter.lock.withLock(async () => {}), /settlement-file-adapter/);
    assert.ok(readIfExists(dir, 'document.json').equals(beforeBytes), 'no writes while locked');
  });
  assert.ok(!fs.existsSync(path.join(dir, 'store.lock')), 'lock removed on release');
  // After release, work proceeds.
  const again = await store.reconcile();
  assert.equal(again.disposition, 'healthy');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
});

test('cross-process lock: child-held lock blocks; SIGKILL leaves residue that still blocks; only out-of-band removal restores work', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  const { store } = newStore(dir, auth);
  const beforeBytes = readIfExists(dir, 'document.json');
  const lockPath = path.join(dir, 'store.lock');

  const child = spawn(process.execPath, [childPath, 'hold-lock', dir], {
    env: { ...process.env, ATLAS_TEST_APP_ROOT: ROOT },
  });
  const exitP = new Promise(resolve => child.on('exit', resolve));
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(lockPath) && Date.now() < deadline) {
    if (child.exitCode !== null) break;
    await new Promise(r => setTimeout(r, 25));
  }
  assert.ok(fs.existsSync(lockPath), 'child acquired the cross-process lock');
  assert.equal(child.exitCode, null, 'holder still alive');

  // A second process-equivalent instance fails closed while the lock is held.
  const other = newStore(dir, auth);
  await assert.rejects(other.store.reconcile(), /settlement-file-adapter/);
  await assert.rejects(other.store.commit({
    actorId, preview: { operationId: op(1) }, confirmationDigest: 'a'.repeat(64),
  }), /settlement-file-adapter/);
  assert.ok(readIfExists(dir, 'document.json').equals(beforeBytes), 'no interleaved writes');

  // SIGKILL the holder: the leftover lock file blocks everything — no
  // orphan removal, no stealing.
  child.kill('SIGKILL');
  const code = await exitP;
  assert.ok(code === 'SIGKILL' || code === null, 'holder was killed');
  await new Promise(r => setTimeout(r, 50));
  assert.ok(fs.existsSync(lockPath), 'leftover lock file remains');
  assert.equal(fs.readFileSync(lockPath).length, 0, 'lock file byte-identical to the held state');
  await assert.rejects(other.store.reconcile(), /settlement-file-adapter/);
  await assert.rejects(other.adapter.lock.withLock(async () => {}), /settlement-file-adapter/);

  // Recovery is an explicit out-of-band act, not the adapter's: after the
  // operator removes the residue, work proceeds.
  fs.unlinkSync(lockPath);
  const report = await other.store.reconcile();
  assert.equal(report.disposition, 'healthy');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
});

test('a pre-existing lock file blocks bootstrap and operations with zero writes', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  const namesBefore = listing(dir);
  fs.writeFileSync(path.join(dir, 'store.lock'), '', { mode: 0o600 });
  fs.chmodSync(path.join(dir, 'store.lock'), 0o600);
  const { store } = newStore(dir, auth);
  await assert.rejects(store.reconcile(), /settlement-file-adapter/);
  await assert.rejects(store.bootstrap(), /settlement-file-adapter/);
  assert.deepEqual(listing(dir), [...namesBefore, 'store.lock'].sort(),
    'no writes happened behind the leftover lock');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified',
    'readers (loader) are unaffected by the lock');
});

// === 3 + 4. Interrupted boundaries, real child-process crashes ===

async function crashChild(crashAt, dir, auth) {
  const pinJson = JSON.stringify(auth.durable.pin);
  const res = runChild(['crash', dir, crashAt, pinJson, '1']);
  assert.equal(res.status, 3, 'child crashed hard at ' + crashAt + '; stderr: ' + res.stderr);
  // A hard-killed holder leaves its lock behind: the restarted store is
  // blocked by the residue (never stolen, never auto-removed) until the
  // operator removes it out-of-band — the reviewed recovery act.
  const lockPath = path.join(dir, 'store.lock');
  assert.ok(fs.existsSync(lockPath), 'crashed holder left its lock file behind');
  const { store: blocked } = newStore(dir, auth);
  await assert.rejects(blocked.reconcile(), /settlement-file-adapter/);
  fs.unlinkSync(lockPath);
}

test('crash between journal write and temp write (child exit): journal survives restart byte-identical; reconcile dispositions it as not-committed, restart alone does not', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  const genesisBytes = readIfExists(dir, 'document.json');
  await crashChild('writeTemp', dir, auth);

  // Durable residue: the journal landed, no staged temp, base document.
  const journalBytes = readIfExists(dir, 'journal.json');
  assert.ok(journalBytes, 'journal file survived the crash');
  const journal = JSON.parse(journalBytes.toString('utf8'));
  assert.equal(journal.operationId, op(1));
  assert.equal(journal.baseRevision, 0);
  assert.ok(!listing(dir).some(n => n.startsWith('.document-')), 'no staged temp');
  assert.ok(readIfExists(dir, 'document.json').equals(genesisBytes));

  // A restart by itself dispositions NOTHING: read-only surfaces leave
  // the pending journal byte-identical; the loader serves the pinned base.
  const { store: restarted } = newStore(dir, auth);
  const out = await restarted.outcome({ actorId, operationId: op(1) });
  assert.equal(out.status, 'unknown', 'journal-resident operation stays unknown');
  assert.equal(out.revision, undefined);
  assert.ok(readIfExists(dir, 'journal.json').equals(journalBytes),
    'journal byte-identical after restart reads');
  const preView = await loadFromDir(dir, auth);
  assert.equal(preView.status, 'qualified');
  assert.deepEqual(preView.evidence, { commitments: [] });

  // Reconcile dispositions the retained journal (R4): not committed,
  // journal removed, pin and document untouched.
  const report = await restarted.reconcile();
  assert.equal(report.row, 'R4');
  assert.equal(report.disposition, 'not-committed');
  assert.equal(report.operationId, op(1));
  assert.equal(readIfExists(dir, 'journal.json'), null);
  assert.equal(auth.durable.pin.revision, 0);
  assert.ok(readIfExists(dir, 'document.json').equals(genesisBytes));
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
});

test('crash between journal write and rename (child exit): staged temp + journal on disk; reconcile R4 discards both', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  const genesisBytes = readIfExists(dir, 'document.json');
  await crashChild('commitTemp', dir, auth);

  assert.ok(readIfExists(dir, 'journal.json'), 'journal resident');
  const staged = listing(dir).filter(n => n.startsWith('.document-'));
  assert.equal(staged.length, 1, 'the staged candidate is real on-disk residue');
  const stagedState = stateOf(fs.readFileSync(path.join(dir, staged[0])));
  assert.equal(stagedState.revision, 1, 'staged bytes are the unlanded candidate');
  assert.ok(readIfExists(dir, 'document.json').equals(genesisBytes),
    'the rename never happened: document is still the pinned genesis');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified',
    'loader serves the pinned base; staged residue is never served');

  const { store: restarted } = newStore(dir, auth);
  const report = await restarted.reconcile();
  assert.equal(report.row, 'R4');
  assert.equal(report.disposition, 'not-committed');
  assert.equal(readIfExists(dir, 'journal.json'), null);
  assert.ok(!listing(dir).some(n => n.startsWith('.document-')), 'staged temp discarded');
  assert.equal(auth.durable.pin.revision, 0);
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
});

test('crash after rename before pin advance (child exit): loader withholds document-ahead-of-pin; reconcile R5 promotes exactly once', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  await crashChild('pinAdvance', dir, auth);

  // The child process is gone; its in-memory pin never advanced here.
  assert.equal(stateOf(readIfExists(dir, 'document.json')).revision, 1,
    'candidate landed on disk');
  assert.ok(readIfExists(dir, 'journal.json'), 'journal resident');
  assert.equal(auth.durable.pin.revision, 0, 'pin still at the base');
  const preView = await loadFromDir(dir, auth);
  assert.equal(preView.status, 'unavailable');
  assert.equal(preView.reason, 'document-ahead-of-pin');

  const { store: restarted } = newStore(dir, auth);
  const report = await restarted.reconcile();
  assert.equal(report.row, 'R5');
  assert.equal(report.disposition, 'promoted');
  assert.equal(report.operationId, op(1));
  assert.equal(auth.durable.pin.revision, 1);
  assert.equal(readIfExists(dir, 'journal.json'), null);
  const view = await loadFromDir(dir, auth);
  assert.equal(view.status, 'qualified');
  assert.equal(view.evidence.commitments.length, 1);
  assert.equal(view.evidence.commitments[0].links[0].assignedCents, 2500);
  const again = await restarted.reconcile();
  assert.equal(again.disposition, 'healthy', 'promotion happened exactly once');
});

// === 5. Fail-closed postures ===

test('corrupt document bytes: loader unavailable with precise reasons; reconcile restores the pinned revision and quarantines the divergent bytes', async () => {
  // (a) Tampered bytes (parseable, stale digest).
  {
    const dir = makeDir();
    const auth = makeAuthorities();
    const { store } = await bootDir(dir, auth);
    auth.clock.advance(10);
    await commitLink(store, auth, 1, { assignedCents: 2500 });
    const committed = readIfExists(dir, 'document.json');
    const tampered = Buffer.from(
      committed.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'),
    );
    assert.ok(!tampered.equals(committed));
    plant(dir, 'document.json', tampered);
    const view = await loadFromDir(dir, auth);
    assert.equal(view.status, 'unavailable');
    assert.equal(view.reason, 'document-invalid');
    const { store: restarted } = newStore(dir, auth);
    const report = await restarted.reconcile();
    assert.equal(report.row, 'R7');
    assert.equal(report.disposition, 'restored-pinned');
    assert.ok(readIfExists(dir, 'document.json').equals(committed),
      'pinned revision restored byte-identical');
    const q = listing(path.join(dir, 'quarantine'));
    assert.equal(q.length, 1);
    assert.ok(q[0].startsWith('divergent-head-r1-'));
    assert.ok(fs.readFileSync(path.join(dir, 'quarantine', q[0])).equals(tampered),
      'divergent bytes preserved in quarantine');
    assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
  }
  // (b) Non-document garbage bytes.
  {
    const dir = makeDir();
    const auth = makeAuthorities();
    await bootDir(dir, auth);
    const genesis = readIfExists(dir, 'document.json');
    plant(dir, 'document.json', Buffer.from('garbage-not-a-document{{{'));
    const view = await loadFromDir(dir, auth);
    assert.equal(view.status, 'unavailable');
    assert.equal(view.reason, 'document-malformed');
    const { store: restarted } = newStore(dir, auth);
    const report = await restarted.reconcile();
    assert.equal(report.row, 'R7');
    assert.equal(report.disposition, 'restored-pinned');
    assert.ok(readIfExists(dir, 'document.json').equals(genesis));
    assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
  }
});

test('torn journal: reconcile quarantines the exact torn bytes as invalid and removes the journal; loader qualified throughout', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const { store } = await bootDir(dir, auth);
  auth.clock.advance(10);
  await commitLink(store, auth, 1);
  const torn = Buffer.from('this is not a journal record{{{');
  plant(dir, 'journal.json', torn);
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified', 'the loader never reads the journal');
  const { store: restarted } = newStore(dir, auth);
  const report = await restarted.reconcile();
  assert.equal(report.row, 'R4');
  assert.equal(report.disposition, 'journal-quarantined');
  assert.equal(readIfExists(dir, 'journal.json'), null);
  const q = listing(path.join(dir, 'quarantine'));
  assert.equal(q.length, 1);
  assert.ok(q[0].startsWith('invalid-journal-'));
  assert.ok(fs.readFileSync(path.join(dir, 'quarantine', q[0])).equals(torn),
    'torn bytes preserved byte-identical');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
});

test('unknown extra files and directories in the store directory are ignored and never touched', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const { store } = await bootDir(dir, auth);
  auth.clock.advance(10);
  await commitLink(store, auth, 1);
  plant(dir, 'operator-notes.txt', Buffer.from('leave me alone'));
  fs.mkdirSync(path.join(dir, 'scratch'));
  plant(path.join(dir, 'scratch'), 'inner.txt', Buffer.from('inner'));
  const report = await store.reconcile();
  assert.equal(report.row, 'R2');
  assert.equal(report.disposition, 'healthy');
  assert.equal((await loadFromDir(dir, auth)).status, 'qualified');
  auth.clock.advance(10);
  await commitLink(store, auth, 2, { txRef: tx(2) });
  assert.equal(fs.readFileSync(path.join(dir, 'operator-notes.txt'), 'utf8'), 'leave me alone');
  assert.equal(fs.readFileSync(path.join(dir, 'scratch', 'inner.txt'), 'utf8'), 'inner');
});

test('corrupt document with the pinned backup missing: recovery-blocked, divergent bytes left in place, nothing fabricated', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const { store } = await bootDir(dir, auth);
  auth.clock.advance(10);
  await commitLink(store, auth, 1, { assignedCents: 2500 });
  const committed = readIfExists(dir, 'document.json');
  const tampered = Buffer.from(
    committed.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'),
  );
  plant(dir, 'document.json', tampered);
  auth.durable.backups.clear(); // the off-volume authority lost the pinned backup
  const { store: restarted } = newStore(dir, auth);
  const report = await restarted.reconcile();
  assert.equal(report.disposition, 'recovery-blocked');
  assert.ok(readIfExists(dir, 'document.json').equals(tampered),
    'divergent head left in place, withheld');
  assert.ok(!fs.existsSync(path.join(dir, 'quarantine')),
    'nothing quarantined without a verified restore');
  const view = await loadFromDir(dir, auth);
  assert.equal(view.status, 'unavailable');
  assert.equal(view.reason, 'document-invalid');
});

test('a document file with group/other permissions is refused by adapter reads (private-file discipline)', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  await bootDir(dir, auth);
  fs.chmodSync(path.join(dir, 'document.json'), 0o644);
  const { store } = newStore(dir, auth);
  const report = await store.reconcile();
  assert.equal(report.row, 'R1');
  assert.equal(report.disposition, 'recovery-blocked');
  const out = await store.outcome({ actorId, operationId: op(1) });
  assert.equal(out.status, 'unknown');
  fs.chmodSync(path.join(dir, 'document.json'), 0o600);
  const healed = await store.reconcile();
  assert.equal(healed.disposition, 'healthy');
});

// === 6. No bootstrap over traces ===

test('bootstrap is refused over every pre-existing trace and writes nothing', async () => {
  for (const trace of ['document', 'journal', 'staged temp', 'lock', 'transient temp', 'quarantine evidence']) {
    const dir = makeDir();
    const auth = makeAuthorities();
    if (trace === 'document') plant(dir, 'document.json', C.adopt({ householdId }));
    if (trace === 'journal') plant(dir, 'journal.json', Buffer.from('{}'));
    if (trace === 'staged temp') plant(dir, '.document-' + 'ab'.repeat(16), Buffer.from('staged'));
    if (trace === 'lock') {
      fs.writeFileSync(path.join(dir, 'store.lock'), '', { mode: 0o600 });
      fs.chmodSync(path.join(dir, 'store.lock'), 0o600);
    }
    // B1 (round 3): adapter-owned traces beyond the staged slot — a
    // transient journal-write artifact and retained quarantine
    // evidence are durable traces too; genesis over either would bury
    // the only copy of an interrupted commit's evidence.
    if (trace === 'transient temp') plant(dir, '.tmp-' + 'cd'.repeat(16), Buffer.from('journal-write-residue'));
    let quarantineEvidence = null;
    if (trace === 'quarantine evidence') {
      fs.mkdirSync(path.join(dir, 'quarantine'), { mode: 0o700 });
      fs.chmodSync(path.join(dir, 'quarantine'), 0o700);
      quarantineEvidence = 'divergent-head-r1-' + 'ef'.repeat(16);
      plant(path.join(dir, 'quarantine'), quarantineEvidence, Buffer.from('divergent-head-bytes'));
    }
    const namesBefore = listing(dir);
    const { store } = newStore(dir, auth);
    if (trace === 'lock') {
      await assert.rejects(store.bootstrap(), /settlement-file-adapter/);
    } else {
      const boot = await store.bootstrap();
      assert.equal(boot.status, 'rejected', trace);
      assert.equal(boot.reason, 'already-bootstrapped', trace);
    }
    assert.deepEqual(listing(dir), namesBefore, trace + ': refused attempt wrote nothing');
    assert.equal(auth.durable.pin, null, trace + ': pin double untouched');
    assert.equal(auth.durable.backups.size, 0, trace + ': backup double untouched');
    if (trace === 'transient temp') {
      assert.ok(readIfExists(dir, '.tmp-' + 'cd'.repeat(16)).equals(Buffer.from('journal-write-residue')),
        'transient artifact bytes preserved byte-identical');
    }
    if (trace === 'quarantine evidence') {
      assert.ok(readIfExists(path.join(dir, 'quarantine'), quarantineEvidence)
        .equals(Buffer.from('divergent-head-bytes')),
      'quarantine evidence preserved byte-identical');
    }
  }
});

test('bootstrap absence inspection failure stays unknown: genesis refused, never absence, zero writes', async () => {
  // The quarantine path is adapter-owned namespace. If it exists in a
  // shape the adapter cannot inspect as its own directory (a regular
  // file, a symlink), the absence determination FAILS: the result must
  // be unknown (unavailable), never a collapse to "no trace" that lets
  // genesis proceed over uninspectable state.
  for (const shape of ['regular file', 'symlink']) {
    const dir = makeDir();
    const auth = makeAuthorities();
    const qpath = path.join(dir, 'quarantine');
    if (shape === 'regular file') {
      fs.writeFileSync(qpath, Buffer.from('not a directory'), { mode: 0o600 });
    } else {
      fs.symlinkSync(makeDir(), qpath, 'dir');
    }
    const namesBefore = listing(dir);
    const { store } = newStore(dir, auth);
    const boot = await store.bootstrap();
    assert.equal(boot.status, 'unavailable', shape + ': inspection failure is unknown, not genesis');
    assert.deepEqual(listing(dir), namesBefore, shape + ': refused attempt wrote nothing');
    assert.equal(auth.durable.pin, null, shape + ': pin double untouched');
    assert.equal(auth.durable.backups.size, 0, shape + ': backup double untouched');
    if (shape === 'regular file') {
      assert.equal(fs.readFileSync(qpath, 'utf8'), 'not a directory',
        'planted bytes preserved');
    }
  }
});

// === 7. Path safety ===

test('path safety: symlinked, repo-contained, missing, non-directory, non-private and static-component paths all refuse with zero writes', async () => {
  const base = makeDir();
  // Symlinked directory: a fully private real target behind a link.
  const realDir = path.join(base, 'real-store');
  fs.mkdirSync(realDir, { mode: 0o700 });
  fs.chmodSync(realDir, 0o700);
  const linkPath = path.join(base, 'linked-store');
  fs.symlinkSync(realDir, linkPath, 'dir');
  assert.throws(() => A.createSettlementEvidenceFileAdapter(linkPath), /settlement-file-adapter/);
  assert.deepEqual(fs.readdirSync(realDir), [], 'refusal wrote nothing through the symlink');
  // Symlinked ancestor component.
  const realParent = path.join(base, 'real-parent');
  fs.mkdirSync(path.join(realParent, 'store'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(realParent, 'store'), 0o700);
  const linkParent = path.join(base, 'linked-parent');
  fs.symlinkSync(realParent, linkParent, 'dir');
  assert.throws(
    () => A.createSettlementEvidenceFileAdapter(path.join(linkParent, 'store')),
    /settlement-file-adapter/,
  );
  // A path inside the repository/worktree.
  assert.throws(() => A.createSettlementEvidenceFileAdapter(ROOT), /settlement-file-adapter/);
  assert.throws(
    () => A.createSettlementEvidenceFileAdapter(path.join(ROOT, 'scripts')),
    /settlement-file-adapter/,
  );
  // Missing directory: refused and NOT created.
  const missing = path.join(base, 'does-not-exist');
  assert.throws(() => A.createSettlementEvidenceFileAdapter(missing), /settlement-file-adapter/);
  assert.ok(!fs.existsSync(missing), 'factory never creates the directory');
  // Non-directory path.
  const aFile = path.join(base, 'a-file');
  fs.writeFileSync(aFile, 'x', { mode: 0o600 });
  assert.throws(() => A.createSettlementEvidenceFileAdapter(aFile), /settlement-file-adapter/);
  // Directory that is not owner-private.
  const loose = path.join(base, 'loose');
  fs.mkdirSync(loose, { mode: 0o755 });
  // Pin the planted mode explicitly: mkdir's mode is narrowed by the
  // process umask, and under umask 077 (hosted CI) 0o755 would land as
  // 0o700 — owner-private — and the expected refusal would never fire.
  fs.chmodSync(loose, 0o755);
  assert.throws(() => A.createSettlementEvidenceFileAdapter(loose), /settlement-file-adapter/);
  assert.deepEqual(fs.readdirSync(loose), []);
  // A static-serving component name anywhere in the path.
  const staticStore = path.join(base, 'public', 'store');
  fs.mkdirSync(staticStore, { recursive: true });
  fs.chmodSync(staticStore, 0o700);
  assert.throws(() => A.createSettlementEvidenceFileAdapter(staticStore), /settlement-file-adapter/);
  assert.deepEqual(fs.readdirSync(staticStore), []);
  // Non-string / relative paths.
  assert.throws(() => A.createSettlementEvidenceFileAdapter(undefined), /settlement-file-adapter/);
  assert.throws(() => A.createSettlementEvidenceFileAdapter('relative/store'), /settlement-file-adapter/);
});

test('factory validation over an empty private directory succeeds and writes nothing', async () => {
  const dir = makeDir();
  const adapter = A.createSettlementEvidenceFileAdapter(dir);
  assert.deepEqual(listing(dir), [], 'construction creates nothing');
  assert.strictEqual(await adapter.documentStore.read(), null);
  assert.strictEqual(await adapter.journalStore.read(), null);
  assert.strictEqual(await adapter.documentStore.readStaged(), null);
  assert.deepEqual(listing(dir), [], 'reads create nothing');
});

// === 9. cwd independence: repository membership is determined for the
// supplied directory (and the module tree), never from the caller's
// working directory. A plain non-git tree must behave exactly like a
// checkout: before the fix, adapter construction in such a tree died on
// an escaped `git worktree list` exit-128 for EVERY directory. ===

test('cwd independence: a child process running from a plain non-git directory completes bootstrap + commit + loader round trip over a private directory', async () => {
  const storeDir = makeDir();
  const cwdDir = makeDir(); // plain, non-git: no repository above it
  const res = spawnSync(process.execPath, [childPath, 'roundtrip', storeDir], {
    cwd: cwdDir,
    env: { ...process.env, ATLAS_TEST_APP_ROOT: ROOT },
    encoding: 'utf8', timeout: 60000,
  });
  assert.equal(res.status, 0, 'child stderr: ' + res.stderr);
  const out = JSON.parse(res.stdout);
  assert.equal(out.boot.status, 'bootstrapped');
  assert.equal(out.receipt.status, 'committed');
  assert.equal(out.receipt.revision, 1);
  assert.equal(out.view.status, 'qualified');
  assert.equal(out.view.evidence.commitments.length, 1);
  assert.equal(out.view.evidence.commitments[0].links[0].assignedCents, 2500);
  const docState = stateOf(readIfExists(storeDir, 'document.json'));
  assert.equal(docState.revision, 1);
  assert.equal(docState.digest, out.receipt.digest);
  assert.deepEqual(fs.readdirSync(cwdDir), [], 'the child wrote nothing into its plain cwd');
});
