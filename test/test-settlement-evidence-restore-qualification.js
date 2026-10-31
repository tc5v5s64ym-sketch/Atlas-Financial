'use strict';
// Settlement evidence restore qualification (ATLAS-080) — synthetic tests
// only.
//
// This suite is QUALIFICATION COVERAGE over shipped behaviour, not a bug
// fix. It composes the REAL file adapter + REAL object adapter + REAL
// store + REAL loader over OS temp dirs and a synthetic in-memory object
// transport, with an invertible synthetic encryption double in the
// pattern of the object adapter suite's makeEncrypt/decryptSynthetic,
// and pins the restore acceptance cases RQ-1..RQ-8:
//
//   RQ-1  the offline owner-assisted drill end-to-end: bootstrap + two
//         commits over the production-shaped composition, total local
//         loss, server refusal, owner fetch + offline decrypt + contract
//         restore() verification against the independently surviving
//         pin, owner install, healthy reconcile, loader re-qualification.
//   RQ-2  receipt continuity across that restore: every pre-loss
//         operation's outcome() returns its ORIGINAL committed revision
//         and digest.
//   RQ-3  restore-then-continue on the offline route: a new commit lands
//         on the restored head, its encrypted backup artifact is
//         written, the pin advances, the loader stays qualified.
//   RQ-4  restore-then-continue through the store reconciler with an
//         injected synthetic PLAINTEXT-backup reader — and, separately,
//         that the REAL object adapter still refuses server restore
//         without mutating anything (the designed key-split refusal).
//   RQ-5  blast radius of one rotten NON-pinned backup artifact: the
//         manifest gate refuses the pinned restore and preserves head,
//         journal, staged/quarantine state, pin and remote artifacts;
//         healing the artifact exposes the designed get() refusal —
//         not server decryption.
//   RQ-6  bad owner bytes are never installed: tampered plaintext, a
//         stale valid revision, and same-revision wrong-digest bytes
//         all fail contract restore() against the surviving pin;
//         semantic validation precedes any staged install and a refusal
//         leaves no residue.
//   RQ-7  a foreign-household artifact never verifies against this
//         household's surviving pin; and namespace isolation is
//         proven through the adapter on both guard paths —
//         prefix-respecting listing (recorded calls, exact owned
//         manifest, zero foreign reads) and hostile over-return
//         (the classification guard rejects the valid foreign
//         plant as an unknown artifact before any foreign read).
//   RQ-8  pin-loss posture stays refused (preservation pin): an absent
//         pin WITH surviving traces is distinct from a genuinely empty
//         unbootstrapped state; a corrupted pin reads as unreadable;
//         no pin reconstruction is attempted in either case.
//
// Provenance and honest failing-before: on the base tree this suite
// does not exist and test/test.js carries no registration for it, so
// these cases are UNEXECUTED in-repo. The identical scenarios were
// executed 29/29 by the external restore-readiness assessment harness
// on f4567beb (study evidence, RESTORE-READINESS.md); this suite ports
// that harness into the repo so the qualification evidence is one
// addressable artifact. It changes no runtime behaviour.
//
// Boundaries held throughout: synthetic transport/encryption only, in
// OS temp dirs; no credentials, no network, no real keys. No online
// private key exists anywhere in this suite: server-side restore
// through the object adapter is refused BY DESIGN (the key split), and
// the only restore route exercised end-to-end is the owner-assisted
// offline route. That offline install is a QUIESCENT procedure after
// total local loss — the owner acts while no other writer runs; it is
// not a concurrent recovery operator and this suite does not present
// it as one. The raw file adapter is never treated as a semantic
// validator: candidate bytes are judged by contract restore() against
// the trusted pin BEFORE any staged write is attempted.
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const L = require(path.join(ROOT, 'scripts/settlement-evidence-loader'));
const S = require(path.join(ROOT, 'scripts/settlement-evidence-store'));
const FA = require(path.join(ROOT, 'scripts/settlement-evidence-file-adapter'));
const OA = require(path.join(ROOT, 'scripts/settlement-evidence-object-adapter'));

const householdId = 'household-' + 'a'.repeat(32);
const householdB = 'household-' + 'b'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const NS = 'settlement-evidence';
const PIN_KEY = NS + '/pin.json';
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const stateOf = bytes => JSON.parse(bytes.toString('utf8'));
const artifactKey = (revision, digest) => `${NS}/revisions/rev-${revision}-${digest}.enc`;

// --- Contract command builders (real Phase 1 flow, synthetic facts) -----
const ev = (over = {}) => ({
  accountId: 'acct-main', currency: 'cad', direction: 'debit',
  date: '2026-10-03', cents: 6000, posted: true, ...over,
});
function linkCmd(over = {}) {
  const e = ev(over.evidence || {});
  return {
    version: 1, kind: 'link', goalId: over.goalId || 'commitment:near',
    txRef: over.txRef || tx(1), evidence: e, evidenceDigest: C.digest(e),
    assignedCents: over.assignedCents !== undefined ? over.assignedCents : 2500,
    asOf: over.asOf || '2026-10-04',
  };
}
async function commitLink(store, n, over = {}) {
  const prepared = await store.prepare({
    actorId, operationId: op(n), command: linkCmd({ txRef: tx(n), ...over }),
  });
  assert.ok(prepared.preview, 'prepare ' + n + ' returns a contract preview');
  const receipt = await store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed', 'commit ' + n);
  return receipt;
}

// --- Temp dirs -------------------------------------------------------------
const tempRoots = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settlement-restore-'));
  fs.chmodSync(dir, 0o700);
  tempRoots.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
const tickClock = start => { let t = start; return () => { t += 1000; return t; }; };

// --- Synthetic object transport + synthetic encryption ---------------------
function makeTransport() {
  const objects = new Map();
  let seq = 0;
  const conflict = () => { const e = new Error('synthetic conflict'); e.code = 'conflict'; return e; };
  return {
    objects,
    async read(key) {
      const o = objects.get(key);
      return o ? { bytes: Buffer.from(o.bytes), version: o.version, metadata: { ...o.metadata } } : null;
    },
    async create(key, bytes, metadata) {
      if (objects.has(key)) throw conflict();
      const version = 'v' + (++seq);
      objects.set(key, { bytes: Buffer.from(bytes), version, metadata: { ...metadata } });
      return { version, integrity: sha256(bytes) };
    },
    async replace(key, bytes, version, metadata) {
      const o = objects.get(key);
      if (!o || o.version !== version) throw conflict();
      const next = 'v' + (++seq);
      objects.set(key, { bytes: Buffer.from(bytes), version: next, metadata: { ...metadata } });
      return { version: next, integrity: sha256(bytes) };
    },
    async list(prefix, cursor) {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const offset = cursor === null ? 0 : Number.parseInt(cursor.slice(1), 10);
      const page = keys.slice(offset, offset + 2);
      const next = offset + 2;
      return {
        entries: page.map(k => ({ key: k, metadata: { ...objects.get(k).metadata } })),
        nextCursor: next < keys.length ? 'c' + next : null,
      };
    },
  };
}
function makeEncrypt() {
  let calls = 0;
  return async bytes => {
    calls++;
    const header = Buffer.from('synthetic-age-v1:' + calls + ':', 'utf8');
    const body = Buffer.from(bytes);
    for (let i = 0; i < body.length; i++) body[i] ^= 0x5a;
    return Buffer.concat([header, body]);
  };
}
function decryptSynthetic(ciphertext) {
  const m = /^synthetic-age-v1:\d+:/.exec(ciphertext.toString('latin1'));
  assert.ok(m, 'synthetic ciphertext header');
  const body = Buffer.from(ciphertext.subarray(m[0].length));
  for (let i = 0; i < body.length; i++) body[i] ^= 0x5a;
  return body;
}

// --- Production-shaped composition: file adapter (local) + object
// --- adapter (pin + encrypted backups), real store, real loader. ---------
function makeObjectWorld(over = {}) {
  const dir = makeDir();
  const transport = makeTransport();
  const encrypt = makeEncrypt();
  const now = tickClock(T0);
  const hh = over.householdId || householdId;
  const build = () => {
    const fileAdapter = FA.createSettlementEvidenceFileAdapter(dir);
    const objectAdapter = OA.createSettlementEvidenceObjectAdapter({
      householdId: hh, namespace: NS, transport, encrypt,
    });
    const store = S.createSettlementEvidenceStore({
      householdId: hh,
      documentStore: fileAdapter.documentStore,
      journalStore: fileAdapter.journalStore,
      pinStore: objectAdapter.pinStore,
      backupStore: objectAdapter.backupStore,
      quarantine: fileAdapter.quarantine,
      lock: fileAdapter.lock,
      now,
    });
    return { fileAdapter, objectAdapter, store };
  };
  const load = async built => L.loadSettlementEvidence({
    config: { householdId: hh },
    readDocument: () => built.fileAdapter.documentStore.read(),
    readPin: async () => {
      const pin = await built.objectAdapter.pinStore.read();
      if (!pin) throw new Error('pin unavailable');
      return { revision: pin.revision, digest: pin.digest };
    },
  });
  return { dir, transport, build, load, householdId: hh };
}

// --- Plaintext in-memory authorities (file-suite shaped): the injected
// --- synthetic plaintext-backup reader for the RQ-4 reconciler path. -----
function makeAuthorities() {
  const durable = { pin: null, backups: new Map(), seq: 0 };
  const pinStore = {
    async read() { return durable.pin ? { ...durable.pin } : null; },
    async advance(expected, next) {
      const cur = durable.pin;
      const match = expected === null ? cur === null
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
          revision, digest, artifactId: 'artifact-' + (++durable.seq), bytes: Buffer.from(bytes),
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
  return { durable, pinStore, backupStore };
}

// --- Snapshot helpers: preservation assertions compare whole state, so
// --- "nothing mutated" is proved rather than sampled. --------------------
function dirSnapshot(dir) {
  const snap = new Map();
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) {
      snap.set(rel, 'dir');
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(rel, name));
    } else {
      snap.set(rel, fs.readFileSync(abs));
    }
  };
  for (const name of fs.readdirSync(dir).sort()) walk(name);
  return snap;
}
function transportSnapshot(transport) {
  const snap = new Map();
  for (const [key, o] of [...transport.objects.entries()].sort()) {
    snap.set(key, { bytes: Buffer.from(o.bytes), version: o.version, metadata: { ...o.metadata } });
  }
  return snap;
}

// The trusted pin for a world: read from the INDEPENDENTLY SURVIVING pin
// store, never derived from candidate bytes. expectedPin is the contract
// pin value the store itself derives from that record.
async function survivingPin(built) {
  const pin = await built.objectAdapter.pinStore.read();
  assert.ok(pin, 'a pin record survives');
  return {
    pin,
    expectedPin: C.digest({
      householdId, revision: pin.revision, documentDigest: pin.digest,
    }),
  };
}

// The owner-assisted offline procedure shared by RQ-1..RQ-3 and the
// refusal cases: two commits, capture the original receipts BEFORE any
// loss, then total local loss (document + journal deleted; the remote
// pin and encrypted backups survive). Returns everything the drill
// needs, including the pre-loss rev-2 document bytes.
async function worldAfterTotalLoss() {
  const world = makeObjectWorld();
  const first = world.build();
  await first.store.bootstrap();
  const r1 = await commitLink(first.store, 1, { assignedCents: 2500 });
  const r2 = await commitLink(first.store, 2, { assignedCents: 1500 });
  const docBytes2 = await first.fileAdapter.documentStore.read();
  assert.equal(stateOf(docBytes2).digest, r2.digest, 'rev-2 document matches its receipt');
  const pinBefore = await first.objectAdapter.pinStore.read();
  assert.deepEqual(
    { revision: pinBefore.revision, digest: pinBefore.digest },
    { revision: 2, digest: r2.digest }, 'pin at rev 2 before the loss');
  fs.unlinkSync(path.join(world.dir, 'document.json'));
  if (fs.existsSync(path.join(world.dir, 'journal.json'))) {
    fs.unlinkSync(path.join(world.dir, 'journal.json'));
  }
  return { world, r1, r2, docBytes2, pinBefore };
}

// Fetch the pinned artifact from the transport, verify its binding and
// ciphertext integrity, and decrypt it OFFLINE (owner-held synthetic
// key). This is the only place ciphertext becomes plaintext, and it
// happens outside every server-side surface.
function ownerFetchAndDecrypt(world, pin) {
  const key = artifactKey(pin.revision, pin.digest);
  const artifact = world.transport.objects.get(key);
  assert.ok(artifact, 'pinned artifact exists under ' + key);
  assert.equal(artifact.metadata.revision, pin.revision, 'artifact binds the pinned revision');
  assert.equal(artifact.metadata.digest, pin.digest, 'artifact binds the pinned digest');
  assert.equal(artifact.metadata.integrity, sha256(artifact.bytes),
    'artifact ciphertext integrity verifies');
  return { key, plain: decryptSynthetic(artifact.bytes) };
}

// The quiescent owner install: verified bytes become the primary
// document through the file adapter's existing staged write — the same
// mechanism restorePinned uses internally. Callers must have verified
// the bytes with contract restore() BEFORE calling this; the adapter
// performs no semantic validation and none is asserted of it.
async function ownerInstall(world, bytes) {
  const installer = FA.createSettlementEvidenceFileAdapter(world.dir);
  await installer.documentStore.writeTemp(Buffer.from(bytes));
  await installer.documentStore.commitTemp();
}

// =====================================================================
// RQ-1 — offline owner-assisted drill, happy path.
// =====================================================================
test('RQ-1: offline drill — total local loss, server refusal, offline verify against the surviving pin, install, healthy, loader qualified', async () => {
  const { world, r1, r2, docBytes2, pinBefore } = await worldAfterTotalLoss();

  // The server path refuses: with the shipped object adapter composed,
  // backupStore.get() deliberately cannot supply bytes (key split).
  const second = world.build();
  const refused = await second.store.reconcile();
  assert.equal(refused.disposition, 'recovery-blocked');
  assert.equal(refused.reason, 'backup-missing');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false,
    'the server path fabricates no document');

  // Offline owner step, judged against the independently surviving pin.
  const { pin, expectedPin } = await survivingPin(second);
  assert.deepEqual(
    { revision: pin.revision, digest: pin.digest },
    { revision: pinBefore.revision, digest: pinBefore.digest },
    'the trusted pin survived the loss untouched');
  const { plain } = ownerFetchAndDecrypt(world, pin);
  assert.ok(plain.equals(docBytes2),
    'offline decryption reproduces the exact pinned rev-2 bytes');
  const restored = C.restore(plain, expectedPin);
  assert.ok(Buffer.from(restored).equals(plain),
    'contract restore(bytes, survivingPin) verifies the offline bytes');

  // Full replay of the restored document: pin() runs decode + replay
  // internally, and effectiveEvidence replays for the projection.
  assert.equal(C.pin(plain, householdId), expectedPin, 'replay confirms the pin');
  const parsed = JSON.parse(plain.toString('utf8'));
  const projection = C.effectiveEvidence({
    householdId: parsed.householdId, revision: parsed.revision, operations: parsed.operations,
  });
  assert.equal(parsed.operations.length, 2, 'both operations replay');
  assert.equal(projection.commitments.length, 1);
  assert.equal(projection.commitments[0].links.length, 2, 'projection carries both links');

  // Quiescent install, then the system re-qualifies on its own rails.
  await ownerInstall(world, plain);
  const third = world.build();
  const report = await third.store.reconcile();
  assert.equal(report.row, 'R2');
  assert.equal(report.disposition, 'healthy');
  const pinAfter = await third.objectAdapter.pinStore.read();
  assert.deepEqual(pinAfter, pinBefore, 'the restore preserved the trusted pin');
  const loaded = await world.load(third);
  assert.equal(loaded.status, 'qualified', 'loader re-qualifies the restored document');
  assert.equal(loaded.evidence.commitments.length, 1);
  assert.equal(loaded.evidence.commitments[0].links.length, 2);
  assert.ok(r1.revision === 1 && r2.revision === 2, 'pre-loss receipts were captured');
});

// =====================================================================
// RQ-2 — receipt continuity across the offline restore.
// =====================================================================
test('RQ-2: receipt continuity — outcomes after the offline restore return the ORIGINAL revisions and digests', async () => {
  const { world, r1, r2 } = await worldAfterTotalLoss();
  const second = world.build();
  const { pin, expectedPin } = await survivingPin(second);
  const { plain } = ownerFetchAndDecrypt(world, pin);
  C.restore(plain, expectedPin);
  await ownerInstall(world, plain);

  const third = world.build();
  const report = await third.store.reconcile();
  assert.equal(report.disposition, 'healthy');
  const o1 = await third.store.outcome({ actorId, operationId: op(1) });
  const o2 = await third.store.outcome({ actorId, operationId: op(2) });
  assert.equal(o1.status, 'committed');
  assert.equal(o1.revision, r1.revision, 'op1 outcome revision == original receipt');
  assert.equal(o1.digest, r1.digest, 'op1 outcome digest == original receipt');
  assert.equal(o2.status, 'committed');
  assert.equal(o2.revision, r2.revision, 'op2 outcome revision == original receipt');
  assert.equal(o2.digest, r2.digest, 'op2 outcome digest == original receipt');
});

// =====================================================================
// RQ-3 — restore-then-continue on the offline route.
// =====================================================================
test('RQ-3: restore-then-continue (offline route) — rev-3 commit lands, its backup artifact is written, pin advances, loader stays qualified', async () => {
  const { world } = await worldAfterTotalLoss();
  const second = world.build();
  const { pin, expectedPin } = await survivingPin(second);
  const { plain } = ownerFetchAndDecrypt(world, pin);
  C.restore(plain, expectedPin);
  await ownerInstall(world, plain);

  const third = world.build();
  const report = await third.store.reconcile();
  assert.equal(report.disposition, 'healthy');
  const r3 = await commitLink(third.store, 3, { assignedCents: 1000 });
  assert.equal(r3.revision, 3, 'a new commit lands on the restored head');
  assert.ok(world.transport.objects.has(artifactKey(3, r3.digest)),
    'the rev-3 backup artifact was written by the continuation commit');
  const pinAfter = await third.objectAdapter.pinStore.read();
  assert.deepEqual(
    { revision: pinAfter.revision, digest: pinAfter.digest },
    { revision: 3, digest: r3.digest }, 'the pin advanced to the new revision');
  const loaded = await world.load(third);
  assert.equal(loaded.status, 'qualified', 'loader stays qualified after continuation');
  assert.equal(loaded.evidence.commitments[0].links.length, 3);
});

// =====================================================================
// RQ-4 — restore-then-continue through the named store reconciler with
// an injected synthetic plaintext-backup reader.
// =====================================================================
test('RQ-4: store reconciler restore-then-continue with an injected synthetic plaintext-backup reader', async () => {
  const dir = makeDir();
  const auth = makeAuthorities();
  const now = tickClock(T0);
  const build = () => {
    const fileAdapter = FA.createSettlementEvidenceFileAdapter(dir);
    const store = S.createSettlementEvidenceStore({
      householdId,
      documentStore: fileAdapter.documentStore,
      journalStore: fileAdapter.journalStore,
      pinStore: auth.pinStore,
      backupStore: auth.backupStore,
      quarantine: fileAdapter.quarantine,
      lock: fileAdapter.lock,
      now,
    });
    return { fileAdapter, store };
  };
  const load = async built => L.loadSettlementEvidence({
    config: { householdId },
    readDocument: () => built.fileAdapter.documentStore.read(),
    readPin: async () => {
      if (!auth.durable.pin) throw new Error('pin unavailable');
      return { revision: auth.durable.pin.revision, digest: auth.durable.pin.digest };
    },
  });
  const first = build();
  await first.store.bootstrap();
  const r1 = await commitLink(first.store, 1, { assignedCents: 2500 });
  const r2 = await commitLink(first.store, 2, { assignedCents: 1500 });
  const committed = await first.fileAdapter.documentStore.read();
  // Corrupt the primary document in place: the reconciler must restore
  // the pinned revision through the plaintext reader.
  const tampered = Buffer.from(
    committed.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'));
  assert.ok(!tampered.equals(committed));
  fs.writeFileSync(path.join(dir, 'document.json'), tampered, { mode: 0o600 });

  const second = build();
  const report = await second.store.reconcile();
  assert.equal(report.row, 'R7');
  assert.equal(report.disposition, 'restored-pinned');
  assert.ok((await second.fileAdapter.documentStore.read()).equals(committed),
    'the restored document is byte-identical to the pinned original');
  const r3 = await commitLink(second.store, 3, { assignedCents: 1000 });
  assert.equal(r3.revision, 3, 'a new commit lands on the restored head');
  assert.ok(auth.durable.backups.has('3:' + r3.digest),
    'the rev-3 backup was written by the continuation commit');
  const o1 = await second.store.outcome({ actorId, operationId: op(1) });
  const o2 = await second.store.outcome({ actorId, operationId: op(2) });
  assert.equal(o1.status, 'committed');
  assert.equal(o1.revision, r1.revision, 'pre-corruption receipt 1 intact (revision)');
  assert.equal(o1.digest, r1.digest, 'pre-corruption receipt 1 intact (digest)');
  assert.equal(o2.status, 'committed');
  assert.equal(o2.revision, r2.revision, 'pre-corruption receipt 2 intact (revision)');
  assert.equal(o2.digest, r2.digest, 'pre-corruption receipt 2 intact (digest)');
  const loaded = await load(second);
  assert.equal(loaded.status, 'qualified');
  assert.equal(loaded.evidence.commitments[0].links.length, 3);
});

// =====================================================================
// RQ-4 (separate) — the REAL object adapter still refuses server
// restore, and the refusal mutates nothing.
// =====================================================================
test('RQ-4: the real object adapter refuses server restore without mutation', async () => {
  const world = makeObjectWorld();
  const first = world.build();
  await first.store.bootstrap();
  await commitLink(first.store, 1, { assignedCents: 2500 });
  const r2 = await commitLink(first.store, 2, { assignedCents: 1500 });
  // Corrupt the primary document: a restore row is now required, and
  // the shipped backupStore.get() deliberately throws (key split).
  fs.writeFileSync(path.join(world.dir, 'document.json'),
    Buffer.from('garbage-not-a-document'), { mode: 0o600 });
  const dirBefore = dirSnapshot(world.dir);
  const remoteBefore = transportSnapshot(world.transport);

  const second = world.build();
  const report = await second.store.reconcile();
  assert.equal(report.row, 'R7');
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(report.reason, 'backup-missing',
    'the refusal is the designed get() wall, not a restore attempt');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore,
    'head, journal, staged and quarantine state are all preserved');
  assert.deepEqual(transportSnapshot(world.transport), remoteBefore,
    'pin and remote artifacts are preserved byte-for-byte');
  const pin = await second.objectAdapter.pinStore.read();
  assert.deepEqual(
    { revision: pin.revision, digest: pin.digest },
    { revision: 2, digest: r2.digest }, 'the trusted pin is untouched');
  const loaded = await world.load(second);
  assert.equal(loaded.status, 'unavailable',
    'the loader does not qualify the divergent bytes');
});

// =====================================================================
// RQ-5 — rotten NON-pinned artifact: the manifest gate refuses the
// pinned restore and preserves everything; healing the artifact
// exposes exactly the designed object-adapter refusal.
// =====================================================================
test('RQ-5: rotten non-pinned artifact blocks restore at the manifest gate and preserves all state; healing exposes the designed get refusal', async () => {
  const world = makeObjectWorld();
  const first = world.build();
  await first.store.bootstrap();
  await commitLink(first.store, 1, { assignedCents: 2500 });
  const r2 = await commitLink(first.store, 2, { assignedCents: 1500 });
  const key1 = [...world.transport.objects.keys()]
    .find(k => k.includes('/revisions/rev-1-'));
  assert.ok(key1, 'the non-pinned rev-1 artifact exists');
  const original1 = Buffer.from(world.transport.objects.get(key1).bytes);
  // Rot the rev-1 (NON-pinned) artifact: stored bytes no longer match
  // the integrity metadata. The pinned rev-2 artifact stays intact.
  world.transport.objects.get(key1).bytes = Buffer.from('rotted ciphertext bytes');
  // Diverge the primary document so a restore row is selected.
  fs.writeFileSync(path.join(world.dir, 'document.json'),
    Buffer.from('garbage-not-a-document'), { mode: 0o600 });
  const dirBefore = dirSnapshot(world.dir);
  const remoteBefore = transportSnapshot(world.transport);

  const second = world.build();
  const report = await second.store.reconcile();
  assert.equal(report.row, 'R1');
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(report.reason, 'manifest-unavailable',
    'one rotten historical artifact blocks every restore row at the manifest gate');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore,
    'head, journal, staged and quarantine state preserved (zero quarantine writes)');
  assert.deepEqual(transportSnapshot(world.transport), remoteBefore,
    'remote artifacts preserved — the refusal does not repair or rewrite the rotten artifact');
  const pin = await second.objectAdapter.pinStore.read();
  assert.deepEqual(
    { revision: pin.revision, digest: pin.digest },
    { revision: 2, digest: r2.digest }, 'pin untouched at rev 2');

  // Heal the artifact: the remaining blocker must be exactly the
  // designed backup-missing wall (server restore refusal) — proving
  // the two blockers are distinct.
  world.transport.objects.get(key1).bytes = original1;
  const remoteHealed = transportSnapshot(world.transport);
  const third = world.build();
  const report2 = await third.store.reconcile();
  assert.equal(report2.disposition, 'recovery-blocked');
  assert.equal(report2.reason, 'backup-missing',
    'after healing, the blocker is the designed object-adapter refusal');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore,
    'divergent document still preserved in place');
  assert.deepEqual(transportSnapshot(world.transport), remoteHealed,
    'the healed refusal also mutates nothing remotely');
});

// =====================================================================
// RQ-6 — bad owner bytes are never installed. Semantic validation
// (contract restore() against the independently surviving pin) always
// precedes the staged install; a refusal leaves no residue, and with
// no document present reconcile still reports recovery-blocked.
// =====================================================================
test('RQ-6: tampered owner bytes fail contract restore against the surviving pin — nothing installed, no residue', async () => {
  const { world } = await worldAfterTotalLoss();
  const second = world.build();
  const { pin, expectedPin } = await survivingPin(second);
  const { plain } = ownerFetchAndDecrypt(world, pin);
  const dirBefore = dirSnapshot(world.dir);
  const remoteBefore = transportSnapshot(world.transport);

  const tampered = Buffer.from(
    plain.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'));
  assert.ok(!tampered.equals(plain));
  assert.throws(() => C.restore(tampered, expectedPin),
    'tampered plaintext fails restore() against the surviving pin');
  assert.throws(() => C.restore(Buffer.from('not a document at all'), expectedPin),
    'garbage candidate bytes fail restore() against the surviving pin');

  // The procedure stops at validation: no staged write was attempted.
  assert.deepEqual(dirSnapshot(world.dir), dirBefore,
    'no document, staged temp, journal or quarantine residue');
  assert.deepEqual(transportSnapshot(world.transport), remoteBefore,
    'remote state untouched by the refused candidates');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false,
    'no bytes appear where the document was lost');
  const report = await second.store.reconcile();
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(report.reason, 'backup-missing',
    'reconcile still reports recovery-blocked after the refused candidates');
});

test('RQ-6: a stale valid revision (rev-1 bytes against the rev-2 pin) is refused — nothing installed', async () => {
  const { world } = await worldAfterTotalLoss();
  const second = world.build();
  const { pin, expectedPin } = await survivingPin(second);
  assert.equal(pin.revision, 2, 'the surviving pin is at rev 2');
  // The rev-1 artifact is genuine, well-formed and decrypts cleanly —
  // it is simply not the pinned revision.
  const key1 = [...world.transport.objects.keys()]
    .find(k => k.includes('/revisions/rev-1-'));
  const stalePlain = decryptSynthetic(world.transport.objects.get(key1).bytes);
  assert.equal(stateOf(stalePlain).revision, 1, 'the candidate is the authentic rev-1 document');
  const dirBefore = dirSnapshot(world.dir);
  assert.throws(() => C.restore(stalePlain, expectedPin),
    'stale valid bytes fail restore() against the rev-2 pin');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore, 'nothing installed, no residue');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false);
});

test('RQ-6: same-revision wrong-digest bytes are refused — nothing installed', async () => {
  const { world } = await worldAfterTotalLoss();
  const second = world.build();
  const { expectedPin } = await survivingPin(second);
  // A parallel world for the SAME household reaches rev 2 with
  // different operations: genuine, well-formed rev-2 bytes whose
  // document digest is not the pinned one.
  const parallel = makeObjectWorld();
  const pFirst = parallel.build();
  await pFirst.store.bootstrap();
  await commitLink(pFirst.store, 1, { assignedCents: 2500 });
  await commitLink(pFirst.store, 2, { assignedCents: 999 });
  const foreignRev2 = await pFirst.fileAdapter.documentStore.read();
  assert.equal(stateOf(foreignRev2).revision, 2, 'candidate is a genuine rev-2 document');
  const { expectedPin: parallelPin } = await survivingPin(pFirst);
  assert.ok(Buffer.from(C.restore(foreignRev2, parallelPin)).equals(foreignRev2),
    'the candidate DOES verify against its own pin — the refusal is the pin binding, not malformed bytes');
  const dirBefore = dirSnapshot(world.dir);
  assert.throws(() => C.restore(foreignRev2, expectedPin),
    'same revision, wrong digest: restore() refuses against the surviving pin');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore, 'nothing installed, no residue');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false);
});

// =====================================================================
// RQ-7 — foreign evidence confers nothing. A foreign-household
// document never verifies against this household's surviving pin:
// bytes install only if contract restore() verifies them against
// the trusted pin, which is never derived from the candidate. And
// namespace isolation is proven through the object adapter's own
// surface on BOTH guard paths: (1) prefix-respecting listing — the
// adapter requests exactly its namespace + '/' prefix and a
// conforming transport never returns the foreign plant, proven
// with recorded list/read calls and the exact owned manifest;
// (2) hostile over-return — a transport that returns the valid
// foreign plant anyway is stopped by the adapter's namespace
// classification guard, which rejects it as an unknown artifact
// before any foreign read. The planted bytes are this household's
// own valid pinned bytes (proven by a direct restore() control),
// so the namespace is the only factor keeping them out.
// =====================================================================
test('RQ-7: foreign-household bytes never verify against the surviving pin, and foreign-namespace objects never surface through the adapter', async () => {
  const { world, r1, r2, docBytes2 } = await worldAfterTotalLoss();
  const second = world.build();
  const { pin, expectedPin } = await survivingPin(second);

  // A foreign household's world: its own pin, its own artifacts.
  const foreign = makeObjectWorld({ householdId: householdB });
  const fFirst = foreign.build();
  await fFirst.store.bootstrap();
  await commitLink(fFirst.store, 1, { assignedCents: 2500 });
  const fPin = await fFirst.objectAdapter.pinStore.read();
  const fKey = artifactKey(fPin.revision, fPin.digest);
  const fCipher = Buffer.from(foreign.transport.objects.get(fKey).bytes);
  const foreignPlain = decryptSynthetic(fCipher);
  assert.equal(stateOf(foreignPlain).householdId, householdB,
    'the candidate carries another household\u2019s document');
  const dirBefore = dirSnapshot(world.dir);
  assert.throws(() => C.restore(foreignPlain, expectedPin),
    'a foreign-household document never verifies against this pin');

  // Namespace isolation, driven THROUGH the object adapter with the
  // namespace as the ONLY changed factor: this household's OWN pinned
  // rev-2 ciphertext — bytes that DO verify against the surviving pin
  // (RQ-1 restores the in-namespace original end-to-end) — planted
  // under a foreign-namespace key in the same transport, with fully
  // valid binding metadata. If the adapter's backup listing ever
  // crossed the namespace boundary, these are exactly the bytes that
  // would surface: revision, digest and integrity all check out, so
  // only the namespace keeps them out.
  const ownKey = artifactKey(pin.revision, pin.digest);
  const ownArtifact = world.transport.objects.get(ownKey);
  assert.ok(ownArtifact, 'the pinned artifact exists under its own-namespace key');
  const foreignNsKey = 'other-namespace/revisions/rev-' + pin.revision + '-' + pin.digest + '.enc';
  world.transport.objects.set(foreignNsKey, {
    bytes: Buffer.from(ownArtifact.bytes), version: 'planted-1',
    metadata: { revision: pin.revision, digest: pin.digest, integrity: sha256(ownArtifact.bytes) },
  });
  // Direct valid-byte control: the planted bytes THEMSELVES pass
  // contract restore() against the surviving pin in this fixture.
  // Byte validity is therefore not what excludes them — namespace
  // scoping is the only guard, and the probes below pin it directly.
  const plantedPlain = decryptSynthetic(world.transport.objects.get(foreignNsKey).bytes);
  assert.ok(plantedPlain.equals(docBytes2),
    'control: the planted bytes are this household\u2019s exact pinned rev-2 document');
  assert.ok(Buffer.from(C.restore(plantedPlain, expectedPin)).equals(plantedPlain),
    'control: the planted own-household bytes pass restore() against the surviving pin');

  // Guard path 1 — prefix-respecting listing. The transport's real
  // list/read calls are recorded around the adapter's manifest call:
  // the adapter must request exactly the namespace + '/' prefix,
  // read only its own in-namespace artifacts, and never read the
  // foreign plant.
  const listPrefixes = [];
  const readKeys = [];
  const rawList = world.transport.list;
  const rawRead = world.transport.read;
  world.transport.list = async (prefix, cursor) => { listPrefixes.push(prefix); return rawList(prefix, cursor); };
  world.transport.read = async key => { readKeys.push(key); return rawRead(key); };
  const manifest = await second.objectAdapter.backupStore.list();
  world.transport.list = rawList;
  world.transport.read = rawRead;
  assert.ok(listPrefixes.length >= 1, 'the adapter listed through the transport');
  assert.ok(listPrefixes.every(p => p === NS + '/'),
    'every transport list call requested exactly the namespace + \'/\' prefix');
  assert.ok(!readKeys.includes(foreignNsKey),
    'zero foreign reads under normal listing');
  assert.ok(readKeys.every(k => k.startsWith(NS + '/revisions/')),
    'the adapter read only its own in-namespace artifacts while listing');
  assert.ok(manifest.every(e => e.artifactId.startsWith(NS + '/revisions/')),
    'every adapter manifest entry is keyed inside this household\u2019s namespace');
  assert.ok(!manifest.some(e => e.artifactId === foreignNsKey),
    'the foreign-namespace plant never surfaces through the adapter');
  assert.deepEqual(
    manifest.map(e => ({ revision: e.revision, digest: e.digest })),
    [...world.transport.objects.keys()]
      .filter(k => k.startsWith(NS + '/revisions/'))
      .map(k => {
        const m = /\/rev-(\d+)-([0-9a-f]{64})\.enc$/.exec(k);
        return { revision: Number(m[1]), digest: m[2] };
      })
      .sort((a, b) => a.revision - b.revision),
    'the adapter manifest is exactly this household\u2019s own in-namespace artifacts (rev 0 genesis, rev 1, rev 2)');
  assert.equal(manifest.find(e => e.revision === 1).digest, r1.digest,
    'the rev-1 manifest entry binds the first commit\u2019s receipt digest');
  assert.equal(manifest.find(e => e.revision === 2).artifactId, ownKey,
    'the pinned rev-2 artifact is present under its own-namespace key');
  // Guard path 2 — hostile over-return. A transport that IGNORES
  // the requested prefix and returns every object in the store —
  // the otherwise-valid foreign plant included — must not move the
  // adapter: its namespace classification guard rejects the foreign
  // entry as an unknown artifact BEFORE any foreign read or
  // exposure, the listing produces no (partial) manifest at all,
  // and local + remote state are byte-identical afterwards.
  const hostileReadKeys = [];
  const hostileTransport = {
    read: async key => { hostileReadKeys.push(key); return rawRead(key); },
    create: world.transport.create,
    replace: world.transport.replace,
    async list() {
      const keys = [...world.transport.objects.keys()].sort();
      return {
        entries: keys.map(k => ({ key: k, metadata: { ...world.transport.objects.get(k).metadata } })),
        nextCursor: null,
      };
    },
  };
  const hostileAdapter = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport: hostileTransport, encrypt: makeEncrypt(),
  });
  const dirBeforeHostile = dirSnapshot(world.dir);
  const transportBeforeHostile = transportSnapshot(world.transport);
  await assert.rejects(() => hostileAdapter.backupStore.list(),
    /unknown artifact inside the owned namespace/,
    'the adapter rejects an over-returned foreign entry as an unknown artifact — no partial manifest');
  assert.ok(!hostileReadKeys.includes(foreignNsKey),
    'the rejection happened before any foreign read');
  assert.ok(hostileReadKeys.every(k => k.startsWith(NS + '/')),
    'no read escaped this household\u2019s namespace during the hostile listing');
  assert.deepEqual(dirSnapshot(world.dir), dirBeforeHostile,
    'local state unchanged by the hostile probe');
  assert.deepEqual(transportSnapshot(world.transport), transportBeforeHostile,
    'remote state unchanged by the hostile probe');
  const stillRefused = await second.store.reconcile();
  assert.equal(stillRefused.disposition, 'recovery-blocked');
  assert.equal(stillRefused.reason, 'backup-missing',
    'planted foreign-namespace bytes never become a restore source');
  assert.deepEqual(dirSnapshot(world.dir), dirBefore, 'nothing installed, no residue');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false);
  assert.equal(pin.revision, 2, 'the surviving pin was the only authority consulted');
});

// =====================================================================
// RQ-8 — pin-loss posture stays refused (preservation pins). An absent
// pin WITH surviving traces is distinct from a genuinely empty state,
// and NO pin reconstruction is attempted in any loss case: the slice
// must not "fix" pin loss by inventing a rebuild.
// =====================================================================
test('RQ-8: absent pin with surviving traces — pin-absent-with-traces, bootstrap refused, no pin reconstruction', async () => {
  const world = makeObjectWorld();
  const first = world.build();
  await first.store.bootstrap();
  await commitLink(first.store, 1, { assignedCents: 2500 });
  const docBefore = await first.fileAdapter.documentStore.read();
  // The pin object is lost; the document and the backups survive.
  world.transport.objects.delete(PIN_KEY);
  assert.equal(await first.objectAdapter.pinStore.read(), null, 'pin reads as absent');

  const second = world.build();
  const report = await second.store.reconcile();
  assert.equal(report.row, 'R1');
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(report.reason, 'pin-absent-with-traces',
    'absent pin WITH traces is refused distinctly from an empty state');
  const boot = await second.store.bootstrap();
  assert.equal(boot.status, 'rejected');
  assert.equal(boot.reason, 'already-bootstrapped', 'no genesis over surviving traces');
  assert.equal(world.transport.objects.has(PIN_KEY), false,
    'no pin reconstruction: the pin object is still absent after both refusals');
  assert.equal(await second.objectAdapter.pinStore.read(), null);
  assert.ok((await second.fileAdapter.documentStore.read()).equals(docBefore),
    'the surviving document is preserved byte-for-byte');
  assert.ok([...world.transport.objects.keys()].some(k => k.includes('/revisions/')),
    'the surviving backups are preserved');
});

test('RQ-8: corrupted pin — pin read throws, reconcile pin-unreadable, bootstrap refused, no reconstruction', async () => {
  const world = makeObjectWorld();
  const first = world.build();
  await first.store.bootstrap();
  await commitLink(first.store, 1, { assignedCents: 2500 });
  const planted = Buffer.from('not json at all');
  world.transport.objects.set(PIN_KEY, {
    bytes: Buffer.from(planted), version: 'planted-1', metadata: {},
  });
  await assert.rejects(() => first.objectAdapter.pinStore.read(),
    'a malformed pin THROWS — it never reads as absence');

  const second = world.build();
  const report = await second.store.reconcile();
  assert.equal(report.row, 'R1');
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(report.reason, 'pin-unreadable');
  const boot = await second.store.bootstrap();
  assert.equal(boot.status, 'unavailable');
  assert.equal(boot.reason, 'pin-unavailable', 'bootstrap is refused over an unreadable pin');
  assert.ok(world.transport.objects.get(PIN_KEY).bytes.equals(planted),
    'no pin reconstruction: the corrupted pin object is left exactly as found');
});

test('RQ-8: a genuinely empty state is distinct — R0 unbootstrapped and genesis admitted', async () => {
  const world = makeObjectWorld();
  const { store, objectAdapter } = world.build();
  const report = await store.reconcile();
  assert.equal(report.row, 'R0');
  assert.equal(report.disposition, 'unbootstrapped',
    'no pin, no document, no journal, no backups: genuinely empty');
  const boot = await store.bootstrap();
  assert.equal(boot.status, 'bootstrapped', 'genesis is admitted ONLY over proven absence of all traces');
  assert.equal(boot.revision, 0);
  const pin = await objectAdapter.pinStore.read();
  assert.deepEqual(
    { revision: pin.revision, digest: pin.digest },
    { revision: 0, digest: boot.digest }, 'genesis pins revision 0');
});
