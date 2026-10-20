'use strict';
// Settlement evidence object adapter (ATLAS-080) — synthetic tests only.
//
// The object adapter is the conditional-object persistence boundary for
// the merged settlement evidence store: it supplies the store's pin and
// encrypted-backup surfaces over ONE explicitly injected object
// transport, inside ONE explicitly supplied namespace, for ONE expected
// household. It implements the merged store's injected contracts:
//
//   pinStore.read()                 -> null (proven absence) or a
//                                      validated {revision, digest,
//                                      timestamp} record; malformed,
//                                      unreadable or foreign-household
//                                      pin state THROWS, never reads as
//                                      absence.
//   pinStore.advance(expected,next) -> literal true only for a definite,
//                                      ack-verified conditional write;
//                                      literal false only for a definite
//                                      conflict (observed pair differs
//                                      from the expected pair, or the
//                                      conditional write reports a
//                                      definite version conflict); a
//                                      lost or malformed ack THROWS so
//                                      the store preserves uncertainty.
//   backupStore.put(rev,digest,bytes) -> the document is contract-
//                                      validated under the expected
//                                      household BEFORE encryption; only
//                                      the injected encryption function's
//                                      output reaches the transport;
//                                      the durable ack binds revision +
//                                      document digest + artifactId.
//   backupStore.list()              -> the complete, pagination-
//                                      exhausted manifest; every owned
//                                      artifact's binding AND stored-
//                                      bytes integrity are verified;
//                                      malformed entries, unknown owned
//                                      artifacts, partial pages and
//                                      repeated cursors THROW.
//   backupStore.get()               -> deliberately THROWS recovery-
//                                      unavailable in this slice: no
//                                      owner-held private key exists on
//                                      the server, so ciphertext is
//                                      never returned as if plaintext.
//
// The transport contract (defined by the adapter, supplied here by a
// synthetic in-memory double) requires: authoritative read with an
// opaque version token, atomic absent-only create, atomic replacement
// conditional on the exact version token, write acknowledgements bound
// to the stored bytes' integrity, and complete cursor-paginated
// listing. A transport without the conditional capabilities is refused
// at construction — CAS is never emulated with an unconditional PUT.
//
// Synthetic transport + synthetic encryption only: this suite does NOT
// qualify a real object provider or real age cryptography. No
// provisioning, configuration, credentials, endpoints, live callers or
// activation anywhere.
//
// Tests first: against unmodified main this suite fails to load (the
// adapter module does not exist).
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
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');
const NS = 'settlement-evidence';
const PIN_KEY = NS + '/pin.json';
const artifactKey = (revision, digest) => `${NS}/revisions/rev-${revision}-${digest}.enc`;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

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
const stateOf = bytes => JSON.parse(bytes.toString('utf8'));
const genesisBytes = C.adopt({ householdId });
const genesisDigest = stateOf(genesisBytes).digest;
function docAtRev1() {
  const prep = C.prepare(genesisBytes, {
    householdId, actorId, operationId: op(1), command: linkCmd(), now: T0 + 1000,
  });
  const res = C.confirmCandidate(genesisBytes, {
    householdId, actorId, preview: prep.preview,
    confirmationDigest: prep.confirmationDigest, now: T0 + 2000,
  });
  assert.equal(res.status, 'candidate');
  return Buffer.from(res.document);
}
const rev1Bytes = docAtRev1();
const rev1Digest = stateOf(rev1Bytes).digest;

// --- Synthetic encryption double -------------------------------------------
// Deliberately randomized: every call returns DIFFERENT bytes for the
// same plaintext (a per-call counter feeds the output), mirroring real
// age encryption. Invertible here only so tests can prove what was
// stored; the adapter never decrypts.
function makeEncrypt() {
  let calls = 0;
  const encrypt = async bytes => {
    calls++;
    const header = Buffer.from('synthetic-age-v1:' + calls + ':', 'utf8');
    const body = Buffer.from(bytes);
    for (let i = 0; i < body.length; i++) body[i] ^= 0x5a;
    return Buffer.concat([header, body]);
  };
  encrypt.calls = () => calls;
  return encrypt;
}
function decryptSynthetic(ciphertext) {
  const text = ciphertext.toString('latin1');
  const match = /^synthetic-age-v1:\d+:/.exec(text);
  assert.ok(match, 'synthetic ciphertext header present');
  const body = Buffer.from(ciphertext.subarray(match[0].length));
  for (let i = 0; i < body.length; i++) body[i] ^= 0x5a;
  return body;
}

// --- Synthetic in-memory object transport ----------------------------------
// Implements the adapter's transport contract with per-method one-shot
// fault injection:
//   'throw'        -> throw, no durable effect
//   'throw-landed' -> apply the durable effect, then throw (lost ack)
//   'bad-ack'      -> apply the durable effect, return a malformed ack
// Listing faults via state.listMode: 'repeat-cursor' | 'throw-page-2'.
function makeTransport(over = {}) {
  const objects = new Map();
  let seq = 0;
  const calls = [];
  const payloads = [];
  const faults = new Map();
  const state = { pageSize: over.pageSize || 2, listMode: null };
  const failNext = (method, mode) => {
    if (!faults.has(method)) faults.set(method, []);
    faults.get(method).push(mode);
  };
  const takeFault = method => {
    const q = faults.get(method);
    return q && q.length ? q.shift() : null;
  };
  const conflictError = () => {
    const e = new Error('synthetic transport: conditional write conflict');
    e.code = 'conflict';
    return e;
  };
  return {
    objects, calls, payloads, failNext, state,
    async read(key) {
      calls.push({ method: 'read', key });
      const f = takeFault('read');
      if (f === 'throw') throw new Error('synthetic transport: read failed');
      const o = objects.get(key);
      if (!o) return null;
      return { bytes: Buffer.from(o.bytes), version: o.version, metadata: { ...o.metadata } };
    },
    async create(key, bytes, metadata) {
      calls.push({ method: 'create', key });
      payloads.push({ method: 'create', key, bytes: Buffer.from(bytes) });
      const perform = () => {
        if (objects.has(key)) throw conflictError();
        const version = 'v' + (++seq);
        objects.set(key, { bytes: Buffer.from(bytes), version, metadata: { ...metadata } });
        return { version, integrity: sha256(bytes) };
      };
      const f = takeFault('create');
      if (f === 'throw') throw new Error('synthetic transport: create ack lost (not landed)');
      if (f === 'throw-landed') { perform(); throw new Error('synthetic transport: create ack lost (landed)'); }
      if (f === 'bad-ack') { perform(); return { version: 42, integrity: 'not-a-hash' }; }
      return perform();
    },
    async replace(key, bytes, version, metadata) {
      calls.push({ method: 'replace', key });
      payloads.push({ method: 'replace', key, bytes: Buffer.from(bytes) });
      const perform = () => {
        const o = objects.get(key);
        if (!o || o.version !== version) throw conflictError();
        const next = 'v' + (++seq);
        objects.set(key, { bytes: Buffer.from(bytes), version: next, metadata: { ...metadata } });
        return { version: next, integrity: sha256(bytes) };
      };
      const f = takeFault('replace');
      if (f === 'throw') throw new Error('synthetic transport: replace ack lost (not landed)');
      if (f === 'throw-landed') { perform(); throw new Error('synthetic transport: replace ack lost (landed)'); }
      if (f === 'bad-ack') { perform(); return { version: 42, integrity: 'not-a-hash' }; }
      return perform();
    },
    async list(prefix, cursor) {
      calls.push({ method: 'list', key: prefix });
      if (state.listMode === 'repeat-cursor') {
        const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
        return {
          entries: keys.slice(0, 1).map(k => ({ key: k, metadata: { ...objects.get(k).metadata } })),
          nextCursor: 'again',
        };
      }
      if (state.listMode === 'throw-page-2' && cursor !== null) {
        throw new Error('synthetic transport: page 2 unreadable');
      }
      const f = takeFault('list');
      if (f === 'throw') throw new Error('synthetic transport: list failed');
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const offset = cursor === null ? 0 : Number.parseInt(cursor.slice(1), 10);
      assert.ok(Number.isSafeInteger(offset) && offset >= 0, 'synthetic cursor shape');
      const pageKeys = keys.slice(offset, offset + state.pageSize);
      const nextOffset = offset + state.pageSize;
      return {
        entries: pageKeys.map(k => ({ key: k, metadata: { ...objects.get(k).metadata } })),
        nextCursor: nextOffset < keys.length ? 'c' + nextOffset : null,
      };
    },
    // An unconditional write path the adapter must NEVER use: CAS is
    // never emulated. Present on the double so tests can prove the
    // adapter ignores it even when it is the only write offered.
    async put(key, bytes) {
      calls.push({ method: 'put', key });
      payloads.push({ method: 'put', key, bytes: Buffer.from(bytes) });
      objects.set(key, { bytes: Buffer.from(bytes), version: 'unconditional', metadata: {} });
      return { ok: true };
    },
  };
}
function plantRaw(transport, key, bytes, metadata = {}) {
  transport.objects.set(key, { bytes: Buffer.from(bytes), version: 'planted-1', metadata });
}
function makeAdapter(transport, encrypt, over = {}) {
  return OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport, encrypt, ...over,
  });
}
function makeObjectStores(over = {}) {
  const transport = makeTransport(over.transport || {});
  const encrypt = makeEncrypt();
  const adapter = makeAdapter(transport, encrypt, over.factory || {});
  return { transport, encrypt, adapter, pinStore: adapter.pinStore, backupStore: adapter.backupStore };
}
const tickClock = () => {
  let tick = T0;
  return () => { tick += 1000; return tick; };
};

// --- Factory validation ------------------------------------------------------

test('factory validates raw inputs before any absence branch', () => {
  const transport = makeTransport();
  const encrypt = makeEncrypt();
  const good = { householdId, namespace: NS, transport, encrypt };
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter(null), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, householdId: 'nope' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, householdId: undefined }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: '' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: 'a/b' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: '../escape' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: 'a..b' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: 'UPPER' }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: 'x'.repeat(129) }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, namespace: 42 }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, encrypt: null }), /settlement-object-adapter/);
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, encrypt: 'age' }), /settlement-object-adapter/);
  // Missing any single conditional capability refuses construction.
  for (const missing of ['read', 'create', 'replace', 'list']) {
    const partial = { ...transport };
    delete partial[missing];
    assert.throws(
      () => OA.createSettlementEvidenceObjectAdapter({ ...good, transport: partial }),
      /settlement-object-adapter/, 'missing ' + missing + ' refuses construction');
  }
  assert.throws(() => OA.createSettlementEvidenceObjectAdapter({ ...good, transport: null }), /settlement-object-adapter/);
  // Construction performs no transport I/O at all.
  assert.equal(transport.calls.length, 0);
});

test('a transport offering only an unconditional PUT is refused, and put is never called', async () => {
  const legacy = makeTransport();
  const putOnly = {
    read: legacy.read, list: legacy.list, put: legacy.put,
  };
  assert.throws(
    () => OA.createSettlementEvidenceObjectAdapter({
      householdId, namespace: NS, transport: putOnly, encrypt: makeEncrypt(),
    }),
    /settlement-object-adapter/);
  // Across a full composed lifecycle the double's unconditional put is
  // never invoked by the adapter (asserted again in the composition
  // tests via this shared call log shape).
  const { transport, pinStore, backupStore } = makeObjectStores();
  await pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  await backupStore.put(0, genesisDigest, genesisBytes);
  await backupStore.list();
  assert.equal(transport.calls.filter(c => c.method === 'put').length, 0);
});

test('adapter source performs no filesystem, network, process or environment access', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'scripts/settlement-evidence-object-adapter.js'), 'utf8');
  assert.ok(!/require\('node:(fs|http|https|net|tls|child_process|os)'\)/.test(source),
    'no fs/network/process imports');
  assert.ok(!/process\.env/.test(source), 'no environment reads');
  assert.ok(!/\bfetch\s*\(/.test(source), 'no fetch');
  const requires = [...source.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]).sort();
  assert.deepEqual(requires,
    ['./planned-obligation-settlement-contract', 'node:crypto'],
    'the transport is the only I/O; the contract is the only authority');
});

// --- Pin ---------------------------------------------------------------------

test('pin: absent reads null; genesis create and sequential advance land; restart persists', async () => {
  const { transport, pinStore } = makeObjectStores();
  assert.equal(await pinStore.read(), null);
  assert.equal(await pinStore.advance(null,
    { revision: 0, digest: genesisDigest, timestamp: T0 }), true);
  const p0 = await pinStore.read();
  assert.deepEqual(Object.keys(p0).sort(), ['digest', 'revision', 'timestamp']);
  assert.deepEqual(p0, { revision: 0, digest: genesisDigest, timestamp: T0 });
  assert.equal(await pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 }), true);
  assert.deepEqual(await pinStore.read(),
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 });
  // Restart: a fresh adapter instance over the same transport reads the
  // same pin — the pin is durable state, not instance state.
  const again = makeAdapter(transport, makeEncrypt());
  assert.deepEqual(await again.pinStore.read(),
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 });
});

test('pin CAS: full-pair comparison — revision-only and digest-only matches both conflict', async () => {
  const { pinStore } = makeObjectStores();
  await pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  // Revision matches, digest does not.
  assert.equal(await pinStore.advance(
    { revision: 0, digest: rev1Digest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1 }), false);
  // Digest matches, revision does not.
  assert.equal(await pinStore.advance(
    { revision: 7, digest: genesisDigest },
    { revision: 8, digest: rev1Digest, timestamp: T0 + 1 }), false);
  // Expecting absence when a pin exists.
  assert.equal(await pinStore.advance(null,
    { revision: 0, digest: genesisDigest, timestamp: T0 + 1 }), false);
  // None of the conflicts moved the pin or wrote anything new.
  assert.deepEqual(await pinStore.read(), { revision: 0, digest: genesisDigest, timestamp: T0 });
});

test('pin CAS: absent-only create race between two writers admits exactly one', async () => {
  const transport = makeTransport();
  const a = makeAdapter(transport, makeEncrypt());
  const b = makeAdapter(transport, makeEncrypt());
  assert.equal(await a.pinStore.read(), null);
  assert.equal(await b.pinStore.read(), null);
  assert.equal(await a.pinStore.advance(null,
    { revision: 0, digest: genesisDigest, timestamp: T0 }), true);
  // The second writer's view is stale: its create expectation (absent)
  // is now definitely false.
  assert.equal(await b.pinStore.advance(null,
    { revision: 0, digest: genesisDigest, timestamp: T0 }), false);
  // And a stale sequential expectation from the loser also conflicts.
  assert.equal(await b.pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1 }), true,
    'the pair now matches, so the sequential advance itself is valid');
  assert.equal(await a.pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 2 }), false,
    'the first writer now holds the stale pair');
});

test('pin advance validates the transition: no rollback, no fork, no skip, genesis is revision 0', async () => {
  const { pinStore } = makeObjectStores();
  await assert.rejects(pinStore.advance(null,
    { revision: 1, digest: rev1Digest, timestamp: T0 }), /settlement-object-adapter/);
  await pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  await assert.rejects(pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 0, digest: rev1Digest, timestamp: T0 + 1 }), /settlement-object-adapter/,
    'same-revision different-digest fork is not a transition');
  await assert.rejects(pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 2, digest: rev1Digest, timestamp: T0 + 1 }), /settlement-object-adapter/,
    'skipping a revision is not a transition');
  await assert.rejects(pinStore.advance(
    { revision: '0', digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1 }), /settlement-object-adapter/,
    'malformed expected shape throws');
  await assert.rejects(pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest }), /settlement-object-adapter/,
    'next without a timestamp throws');
  assert.deepEqual(await pinStore.read(), { revision: 0, digest: genesisDigest, timestamp: T0 });
});

test('pin: landed write with a lost ack throws — uncertainty is preserved, never success or conflict', async () => {
  const { transport, pinStore } = makeObjectStores();
  await pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  transport.failNext('replace', 'throw-landed');
  await assert.rejects(pinStore.advance(
    { revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 }),
    /synthetic transport: replace ack lost/);
  // The write DID land; only a fresh read may say so.
  assert.deepEqual(await pinStore.read(),
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 });
  // A malformed ack is likewise uncertainty, even though the write landed.
  transport.failNext('replace', 'bad-ack');
  const rev2Digest = C.digest({ probe: 'rev2' });
  await assert.rejects(pinStore.advance(
    { revision: 1, digest: rev1Digest },
    { revision: 2, digest: rev2Digest, timestamp: T0 + 2000 }),
    /settlement-object-adapter/);
  assert.deepEqual(await pinStore.read(),
    { revision: 2, digest: rev2Digest, timestamp: T0 + 2000 });
  // An ack lost BEFORE landing also throws (no definite outcome either way).
  transport.failNext('replace', 'throw');
  await assert.rejects(pinStore.advance(
    { revision: 2, digest: rev2Digest },
    { revision: 3, digest: C.digest({ probe: 'rev3' }), timestamp: T0 + 3000 }),
    /synthetic transport/);
  assert.equal((await pinStore.read()).revision, 2);
});

test('pin read: malformed bytes, foreign household, and malformed transport results all throw', async () => {
  const { transport, pinStore } = makeObjectStores();
  plantRaw(transport, PIN_KEY, Buffer.from('not json at all'));
  await assert.rejects(pinStore.read(), /settlement-object-adapter/);
  plantRaw(transport, PIN_KEY, Buffer.from(JSON.stringify(
    { v: 1, household: 'f'.repeat(64), revision: 0, digest: genesisDigest, timestamp: T0 })));
  await assert.rejects(pinStore.read(), /settlement-object-adapter/,
    'a pin bound to another household is not this household\u2019s pin');
  plantRaw(transport, PIN_KEY, Buffer.from(JSON.stringify(
    { v: 1, household: C.digest({ householdId }), revision: 0, digest: genesisDigest })));
  await assert.rejects(pinStore.read(), /settlement-object-adapter/,
    'a pin record missing its timestamp is malformed');
  plantRaw(transport, PIN_KEY, Buffer.from(JSON.stringify(
    { v: 1, household: C.digest({ householdId }), revision: 0, digest: 'xyz', timestamp: T0 })));
  await assert.rejects(pinStore.read(), /settlement-object-adapter/);
  // A pin written for household B in the same namespace is foreign here.
  const transport2 = makeTransport();
  const adapterB = OA.createSettlementEvidenceObjectAdapter({
    householdId: householdB, namespace: NS, transport: transport2, encrypt: makeEncrypt(),
  });
  const genesisB = stateOf(C.adopt({ householdId: householdB })).digest;
  await adapterB.pinStore.advance(null, { revision: 0, digest: genesisB, timestamp: T0 });
  const adapterA2 = makeAdapter(transport2, makeEncrypt());
  await assert.rejects(adapterA2.pinStore.read(), /settlement-object-adapter/);
  // A transport read returning a malformed shape is not absence.
  const weird = {
    ...makeTransport(),
    read: async () => ({ bytes: 'a string, not bytes', version: 'v1', metadata: {} }),
    create: async () => { throw new Error('unused'); },
    replace: async () => { throw new Error('unused'); },
    list: async () => ({ entries: [], nextCursor: null }),
  };
  const adapterW = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport: weird, encrypt: makeEncrypt(),
  });
  await assert.rejects(adapterW.pinStore.read(), /settlement-object-adapter/);
  // A failing pin read throws out of read() — the store maps that to
  // pin-unreadable, never to absence.
  const failing = makeObjectStores();
  failing.transport.failNext('read', 'throw');
  await assert.rejects(failing.pinStore.read(), /synthetic transport: read failed/);
});

test('pin advance snapshots its inputs: caller mutation across awaits has no effect', async () => {
  const transport = makeTransport();
  const adapter = makeAdapter(transport, makeEncrypt());
  await adapter.pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  const expected = { revision: 0, digest: genesisDigest };
  const next = { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 };
  const evil = {
    ...transport,
    read: async key => {
      const result = await transport.read(key);
      // The caller mutates its own objects while the adapter awaits.
      next.digest = 'e'.repeat(64);
      expected.revision = 99;
      return result;
    },
  };
  const adapterEvil = makeAdapter(evil, makeEncrypt());
  assert.equal(await adapterEvil.pinStore.advance(expected, next), true);
  assert.deepEqual(await adapter.pinStore.read(),
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 },
    'the stored pin carries the snapshot pair, not the mutated one');
});

// --- Backup ------------------------------------------------------------------

test('backup put: ack binds revision + document digest + deterministic artifactId; only ciphertext is stored', async () => {
  const { transport, backupStore } = makeObjectStores();
  const ack = await backupStore.put(0, genesisDigest, genesisBytes);
  assert.deepEqual(ack, {
    revision: 0, digest: genesisDigest, artifactId: artifactKey(0, genesisDigest),
  });
  const stored = transport.objects.get(artifactKey(0, genesisDigest));
  assert.ok(stored, 'artifact stored under its deterministic key');
  assert.deepEqual(decryptSynthetic(stored.bytes), genesisBytes,
    'the stored bytes are the encryption of the exact document');
  assert.equal(stored.metadata.revision, 0);
  assert.equal(stored.metadata.digest, genesisDigest);
  assert.equal(stored.metadata.integrity, sha256(stored.bytes),
    'integrity metadata binds the stored ciphertext');
  const ack1 = await backupStore.put(1, rev1Digest, rev1Bytes);
  assert.equal(ack1.artifactId, artifactKey(1, rev1Digest));
  assert.notEqual(ack1.artifactId, ack.artifactId);
});

test('backup put validates household/revision/digest through the contract BEFORE encryption or upload', async () => {
  const { transport, encrypt, backupStore } = makeObjectStores();
  const foreign = C.adopt({ householdId: householdB });
  await assert.rejects(backupStore.put(0, stateOf(foreign).digest, foreign),
    /settlement-object-adapter/, 'a foreign household document is refused');
  await assert.rejects(backupStore.put(1, genesisDigest, genesisBytes),
    /settlement-object-adapter/, 'revision argument must match the document');
  await assert.rejects(backupStore.put(0, rev1Digest, genesisBytes),
    /settlement-object-adapter/, 'digest argument must match the document');
  await assert.rejects(backupStore.put(0, genesisDigest, Buffer.from('garbage bytes')),
    /settlement-object-adapter/, 'non-document bytes are refused');
  await assert.rejects(backupStore.put(-1, genesisDigest, genesisBytes),
    /settlement-object-adapter/);
  await assert.rejects(backupStore.put(0, 'not-a-hash', genesisBytes),
    /settlement-object-adapter/);
  await assert.rejects(backupStore.put(0, genesisDigest, 'a string'),
    /settlement-object-adapter/);
  assert.equal(encrypt.calls(), 0, 'validation precedes encryption');
  assert.equal(transport.calls.filter(c => c.method === 'create').length, 0,
    'validation precedes any upload');
});

test('backup put: encryption failure or plaintext-shaped output refuses with no upload and no fallback', async () => {
  const transport = makeTransport();
  const plaintextEcho = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport,
    encrypt: async bytes => Buffer.from(bytes),
  });
  await assert.rejects(plaintextEcho.backupStore.put(0, genesisDigest, genesisBytes),
    /settlement-object-adapter/, 'encryption output equal to the plaintext is refused');
  const emptyOut = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport, encrypt: async () => Buffer.alloc(0),
  });
  await assert.rejects(emptyOut.backupStore.put(0, genesisDigest, genesisBytes),
    /settlement-object-adapter/, 'empty encryption output is refused');
  const stringOut = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport, encrypt: async () => 'ciphertext?',
  });
  await assert.rejects(stringOut.backupStore.put(0, genesisDigest, genesisBytes),
    /settlement-object-adapter/, 'non-byte encryption output is refused');
  const throwing = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport,
    encrypt: async () => { throw new Error('synthetic encryptor down'); },
  });
  await assert.rejects(throwing.backupStore.put(0, genesisDigest, genesisBytes),
    /synthetic encryptor down/);
  assert.equal(transport.calls.filter(c => c.method === 'create').length, 0,
    'no plaintext fallback upload ever happens');
  assert.equal(transport.objects.size, 0);
});

test('backup put copies the document before awaiting: caller mutation after entry cannot reach storage', async () => {
  const transport = makeTransport();
  const good = makeEncrypt();
  const callerBytes = Buffer.from(rev1Bytes);
  const evilEncrypt = async bytes => {
    callerBytes.fill(0); // the caller trashes its own buffer mid-flight
    return good(bytes);
  };
  const adapter = OA.createSettlementEvidenceObjectAdapter({
    householdId, namespace: NS, transport, encrypt: evilEncrypt,
  });
  const ack = await adapter.backupStore.put(1, rev1Digest, callerBytes);
  assert.equal(ack.artifactId, artifactKey(1, rev1Digest));
  const stored = transport.objects.get(ack.artifactId);
  assert.deepEqual(decryptSynthetic(stored.bytes), rev1Bytes,
    'the stored ciphertext decrypts to the entry snapshot, not the mutated buffer');
});

test('backup put over an existing artifact: randomized-encryption retry reuses it, never overwrites, never duplicates', async () => {
  const { transport, encrypt, backupStore } = makeObjectStores();
  const ack1 = await backupStore.put(1, rev1Digest, rev1Bytes);
  const key = artifactKey(1, rev1Digest);
  const firstCiphertext = Buffer.from(transport.objects.get(key).bytes);
  const ack2 = await backupStore.put(1, rev1Digest, rev1Bytes);
  assert.equal(encrypt.calls(), 2, 'the retry really did re-encrypt (randomized output)');
  assert.deepEqual(ack2, ack1, 'the retry ack binds the same revision/digest/artifactId');
  assert.equal([...transport.objects.keys()].filter(k => k === key).length, 1,
    'exactly one artifact exists for the revision');
  assert.deepEqual(transport.objects.get(key).bytes, firstCiphertext,
    'the first stored ciphertext is retained — a retry never overwrites stored bytes');
  const entries = await backupStore.list();
  assert.deepEqual(entries, [{ revision: 1, digest: rev1Digest, artifactId: key }]);
});

test('backup put over a divergent existing artifact throws — no success for bytes never stored', async () => {
  const { transport, backupStore } = makeObjectStores();
  const key = artifactKey(1, rev1Digest);
  // Existing object whose metadata binds a DIFFERENT document digest.
  plantRaw(transport, key, Buffer.from('someone elses ciphertext'), {
    revision: 1, digest: genesisDigest, integrity: sha256(Buffer.from('someone elses ciphertext')),
  });
  await assert.rejects(backupStore.put(1, rev1Digest, rev1Bytes), /settlement-object-adapter/);
  // Existing object bound to the right revision+digest whose stored
  // bytes do not match their own integrity metadata (corrupt store).
  const corrupt = Buffer.from('corrupted ciphertext');
  plantRaw(transport, key, corrupt, {
    revision: 1, digest: rev1Digest, integrity: sha256(Buffer.from('different bytes')),
  });
  await assert.rejects(backupStore.put(1, rev1Digest, rev1Bytes), /settlement-object-adapter/);
  // Existing object with malformed metadata.
  plantRaw(transport, key, corrupt, { revision: 'one', digest: rev1Digest, integrity: 'zz' });
  await assert.rejects(backupStore.put(1, rev1Digest, rev1Bytes), /settlement-object-adapter/);
  assert.deepEqual(transport.objects.get(key).bytes, corrupt,
    'the divergent artifact is preserved, never overwritten');
});

test('backup list: exhausts pagination and validates every entry binding and stored integrity', async () => {
  const { transport, backupStore } = makeObjectStores({ transport: { pageSize: 1 } });
  await backupStore.put(0, genesisDigest, genesisBytes);
  await backupStore.put(1, rev1Digest, rev1Bytes);
  const entries = await backupStore.list();
  assert.deepEqual(entries, [
    { revision: 0, digest: genesisDigest, artifactId: artifactKey(0, genesisDigest) },
    { revision: 1, digest: rev1Digest, artifactId: artifactKey(1, rev1Digest) },
  ]);
  assert.ok(transport.calls.filter(c => c.method === 'list').length >= 2,
    'pagination was actually walked (page size 1, pin + 2 artifacts)');
  // A stored artifact whose bytes no longer match its integrity
  // metadata makes the whole manifest unreadable — never partial.
  const key = artifactKey(1, rev1Digest);
  transport.objects.get(key).bytes = Buffer.from('tampered after the fact');
  await assert.rejects(backupStore.list(), /settlement-object-adapter/);
});

test('backup list: malformed entries, unknown owned artifacts, partial pages and repeated cursors all throw', async () => {
  // Malformed manifest entry (digest not a hash).
  {
    const { transport, backupStore } = makeObjectStores();
    plantRaw(transport, artifactKey(3, rev1Digest), Buffer.from('ct'), {
      revision: 3, digest: 'not-a-hash', integrity: sha256(Buffer.from('ct')),
    });
    await assert.rejects(backupStore.list(), /settlement-object-adapter/);
  }
  // Entry whose metadata disagrees with its own deterministic name.
  {
    const { transport, backupStore } = makeObjectStores();
    plantRaw(transport, artifactKey(3, rev1Digest), Buffer.from('ct'), {
      revision: 4, digest: rev1Digest, integrity: sha256(Buffer.from('ct')),
    });
    await assert.rejects(backupStore.list(), /settlement-object-adapter/);
  }
  // Unknown artifact inside the owned namespace is surfaced, never dropped.
  {
    const { transport, backupStore } = makeObjectStores();
    await backupStore.put(0, genesisDigest, genesisBytes);
    plantRaw(transport, NS + '/mystery-object', Buffer.from('?'), {});
    await assert.rejects(backupStore.list(), /settlement-object-adapter/);
  }
  // A second page that fails makes the listing throw — the first page
  // is never returned as a successful partial manifest.
  {
    const { transport, backupStore } = makeObjectStores({ transport: { pageSize: 1 } });
    await backupStore.put(0, genesisDigest, genesisBytes);
    await backupStore.put(1, rev1Digest, rev1Bytes);
    transport.state.listMode = 'throw-page-2';
    await assert.rejects(backupStore.list(), /synthetic transport: page 2 unreadable/);
  }
  // A cursor that repeats forever is a malformed listing, not a result.
  {
    const { transport, backupStore } = makeObjectStores();
    await backupStore.put(0, genesisDigest, genesisBytes);
    transport.state.listMode = 'repeat-cursor';
    await assert.rejects(backupStore.list(), /settlement-object-adapter/);
  }
  // Objects in OTHER namespaces are not this adapter's manifest.
  {
    const { transport, backupStore } = makeObjectStores();
    plantRaw(transport, 'other-namespace/revisions/rev-0-' + genesisDigest + '.enc',
      Buffer.from('ct'), { revision: 0, digest: genesisDigest, integrity: sha256(Buffer.from('ct')) });
    assert.deepEqual(await backupStore.list(), []);
  }
});

test('backup get deliberately throws recovery-unavailable in this slice', async () => {
  const { backupStore } = makeObjectStores();
  await backupStore.put(0, genesisDigest, genesisBytes);
  await assert.rejects(backupStore.get(0, genesisDigest),
    /settlement-object-adapter: backup recovery unavailable/);
  await assert.rejects(backupStore.get(99, rev1Digest),
    /settlement-object-adapter: backup recovery unavailable/);
});

test('no document plaintext ever reaches the transport', async () => {
  const { transport, pinStore, backupStore } = makeObjectStores();
  await pinStore.advance(null, { revision: 0, digest: genesisDigest, timestamp: T0 });
  await backupStore.put(0, genesisDigest, genesisBytes);
  await backupStore.put(1, rev1Digest, rev1Bytes);
  await pinStore.advance({ revision: 0, digest: genesisDigest },
    { revision: 1, digest: rev1Digest, timestamp: T0 + 1000 });
  await backupStore.list();
  const backupPayloads = transport.payloads.filter(p => p.key.startsWith(NS + '/revisions/'));
  assert.equal(backupPayloads.length, 2);
  for (const payload of backupPayloads) {
    assert.ok(!payload.bytes.equals(genesisBytes) && !payload.bytes.equals(rev1Bytes),
      'payload is not the plaintext document');
    assert.ok(!payload.bytes.includes(genesisBytes) && !payload.bytes.includes(rev1Bytes),
      'payload does not contain the plaintext document');
    assert.ok(!payload.bytes.includes(Buffer.from(householdId)),
      'payload carries no household identifier in the clear');
    assert.ok(!payload.bytes.includes(Buffer.from('commitment:near')),
      'payload carries no commitment data in the clear');
  }
  // Error messages are content-free too.
  const { backupStore: bs2 } = makeObjectStores();
  const err = await bs2.put(0, genesisDigest, Buffer.from('junk')).then(
    () => null, e => e);
  assert.ok(err && !String(err.message).includes(householdId)
    && !String(err.message).includes('junk'), 'errors name no content');
});

// --- Composition: file adapter (local) + object adapter (pin/backup) ---------
// The loader is synchronous: coherent bytes are acquired FIRST (await
// the pin read and the document read), then the loader is called with
// synchronous readers over that one snapshot.

const tempRoots = [];
function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-settlement-object-'));
  tempRoots.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempRoots) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});
function plantFile(dir, name, bytes) {
  const target = path.join(dir, name);
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}
function makeWorld() {
  const dir = makeDir();
  const transport = makeTransport();
  const encrypt = makeEncrypt();
  const now = tickClock();
  const build = () => {
    const fileAdapter = FA.createSettlementEvidenceFileAdapter(dir);
    const objectAdapter = makeAdapter(transport, encrypt);
    const store = S.createSettlementEvidenceStore({
      householdId,
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
  return { dir, transport, encrypt, now, build };
}
async function loadComposed(world, built) {
  const pin = await built.objectAdapter.pinStore.read();
  const docBytes = await built.fileAdapter.documentStore.read();
  return L.loadSettlementEvidence({
    config: { householdId },
    readDocument: () => docBytes,
    readPin: () => {
      if (!pin) throw new Error('pin unavailable');
      return { revision: pin.revision, digest: pin.digest };
    },
  });
}
async function commitLink(store, n, over = {}) {
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

test('composed: pristine bootstrap, commit, restart — loader qualified with the contract projection', async () => {
  const world = makeWorld();
  const first = world.build();
  const boot = await first.store.bootstrap();
  assert.equal(boot.status, 'bootstrapped');
  assert.equal(boot.revision, 0);
  // Genesis really went through the object boundary: a pin object and
  // an encrypted rev-0 artifact exist in the transport, nothing else.
  assert.deepEqual([...world.transport.objects.keys()].sort(),
    [artifactKey(0, genesisDigest), PIN_KEY].sort());
  const receipt = await commitLink(first.store, 1);
  assert.equal(receipt.revision, 1);
  // The committed digest is read back from the actual document: the
  // recordedAt the store's clock supplied is part of the digest, so it
  // is derived from the durable bytes, never precomputed.
  const committedBytes = await first.fileAdapter.documentStore.read();
  const committedDigest = stateOf(committedBytes).digest;
  assert.equal(receipt.digest, committedDigest);

  // Restart: brand-new file adapter, object adapter and store instances
  // over the same directory and transport.
  const second = world.build();
  const outcome = await second.store.outcome({ actorId, operationId: op(1) });
  assert.deepEqual(outcome, {
    status: 'committed', operationId: op(1), revision: 1, digest: committedDigest,
  });
  const loaded = await loadComposed(world, second);
  assert.equal(loaded.status, 'qualified');
  assert.deepEqual(loaded.evidence,
    C.effectiveEvidence({ householdId, revision: 1, operations: stateOf(committedBytes).operations }));
  assert.equal(loaded.evidence.commitments.length, 1);
  assert.equal(loaded.evidence.commitments[0].links[0].assignedCents, 2500);
  // The object transport was the only remote I/O and saw no plaintext.
  assert.equal(world.transport.calls.filter(c => c.method === 'put').length, 0);
});

test('composed: receipt identity survives a later commit and a restart (original revision/digest)', async () => {
  const world = makeWorld();
  const first = world.build();
  await first.store.bootstrap();
  const r1 = await commitLink(first.store, 1);
  const r2 = await commitLink(first.store, 2, { txRef: tx(2) });
  assert.equal(r2.revision, 2);
  const second = world.build();
  const outcome = await second.store.outcome({ actorId, operationId: op(1) });
  assert.deepEqual(outcome, {
    status: 'committed', operationId: op(1), revision: r1.revision, digest: r1.digest,
  }, 'the receipt names the operation\u2019s ORIGINAL committed revision/digest');
  const loaded = await loadComposed(world, second);
  assert.equal(loaded.status, 'qualified');
  assert.equal(loaded.evidence.commitments[0].links.length, 2);
});

test('composed: backup failure before pin advance — the commit does not advance and later completes exactly once', async () => {
  const world = makeWorld();
  const { store } = world.build();
  await store.bootstrap();
  const prepared = await store.prepare({ actorId, operationId: op(1), command: linkCmd() });
  world.transport.failNext('create', 'throw'); // the rev-1 backup upload fails
  const failed = await store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(failed.status, 'unknown');
  assert.equal(failed.reason, 'backup-ambiguous');
  const built = world.build();
  assert.deepEqual(await built.objectAdapter.pinStore.read(),
    { revision: 0, digest: genesisDigest, timestamp: T0 + 1000 },
    'the pin never advanced past genesis');
  // The candidate WAS renamed locally before the backup step, so the
  // loader sees an unpinned head and withholds — never qualified, never
  // fallen back to the genesis evidence.
  const loaded = await loadComposed(world, built);
  assert.equal(loaded.status, 'unavailable');
  assert.equal(loaded.reason, 'document-ahead-of-pin');
  // Retrying the identical commit resolves the resident journal through
  // reconciliation and lands the operation exactly once.
  const receipt = await built.store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.revision, 1);
  const doc = stateOf(await built.fileAdapter.documentStore.read());
  assert.equal(doc.operations.filter(o => o.operationId === op(1)).length, 1);
});

test('composed: landed pin write with a lost ack — commit reports unknown, reconcile recovers the receipt, no duplicate', async () => {
  const world = makeWorld();
  const { store } = world.build();
  await store.bootstrap();
  const prepared = await store.prepare({ actorId, operationId: op(1), command: linkCmd() });
  world.transport.failNext('replace', 'throw-landed'); // pin lands, ack is lost
  const result = await store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'pin-advance-failed');
  const built = world.build();
  const report = await built.store.reconcile();
  assert.equal(report.disposition, 'committed-recovered');
  assert.equal(report.receipt.revision, 1);
  const committedDigest = stateOf(await built.fileAdapter.documentStore.read()).digest;
  assert.equal(report.receipt.digest, committedDigest);
  assert.deepEqual(await built.store.outcome({ actorId, operationId: op(1) }), {
    status: 'committed', operationId: op(1), revision: 1, digest: committedDigest,
  });
  // An identical retry takes the committed fast path — same receipt, and
  // the operation still appears exactly once in the ledger.
  const retry = await built.store.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(retry.status, 'committed');
  assert.equal(retry.revision, 1);
  assert.equal(retry.digest, committedDigest);
  const doc = stateOf(await built.fileAdapter.documentStore.read());
  assert.equal(doc.operations.filter(o => o.operationId === op(1)).length, 1);
});

test('composed: restore needed but backup get throws — recovery-blocked, evidence preserved, no genesis', async () => {
  const world = makeWorld();
  const first = world.build();
  await first.store.bootstrap();
  await commitLink(first.store, 1);
  const pinBefore = await first.objectAdapter.pinStore.read();
  const built = world.build();
  // Corrupt the local document: restoration is now required, and this
  // slice's backup get() deliberately cannot supply bytes.
  plantFile(world.dir, 'document.json', Buffer.from('garbage-not-a-document'));
  const report = await built.store.reconcile();
  assert.equal(report.disposition, 'recovery-blocked');
  assert.equal(fs.readFileSync(path.join(world.dir, 'document.json'), 'utf8'),
    'garbage-not-a-document', 'the divergent bytes are preserved in place');
  const pinAfter = await built.objectAdapter.pinStore.read();
  assert.deepEqual(pinAfter, pinBefore, 'the pin is untouched');
  const loaded = await loadComposed(world, built);
  assert.equal(loaded.status, 'unavailable');
  // Absent local document: same outcome, and nothing is recreated.
  fs.unlinkSync(path.join(world.dir, 'document.json'));
  const report2 = await built.store.reconcile();
  assert.equal(report2.disposition, 'recovery-blocked');
  assert.equal(fs.existsSync(path.join(world.dir, 'document.json')), false,
    'no genesis and no fabricated document appears');
});

test('composed: no genesis over remote traces — backups without a pin refuse bootstrap', async () => {
  const world = makeWorld();
  const { objectAdapter } = world.build();
  // A remote backup exists (e.g. an interrupted earlier bootstrap), but
  // there is no pin and no local state at all.
  await objectAdapter.backupStore.put(0, genesisDigest, genesisBytes);
  const { store } = world.build();
  const boot = await store.bootstrap();
  assert.equal(boot.status, 'rejected');
  assert.equal(boot.reason, 'already-bootstrapped');
  assert.equal(await objectAdapter.pinStore.read(), null, 'no pin was created');
  assert.deepEqual(fs.readdirSync(world.dir), [], 'no local state was created');
});

test('composed: no genesis over local traces — a lone local document refuses bootstrap', async () => {
  const world = makeWorld();
  plantFile(world.dir, 'document.json', genesisBytes);
  const { store, objectAdapter } = world.build();
  const boot = await store.bootstrap();
  assert.equal(boot.status, 'rejected');
  assert.equal(boot.reason, 'already-bootstrapped');
  assert.equal(await objectAdapter.pinStore.read(), null);
  assert.equal(world.transport.objects.size, 0, 'no remote write happened either');
});
