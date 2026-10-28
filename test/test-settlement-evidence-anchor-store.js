'use strict';
// Settlement evidence anchor store (INT-5 P-5, slice S1) — synthetic
// tests only.
//
// The anchor store is the production implementation surface for the
// anchor unit of the accepted anchor/epoch design (issue #756,
// fb2ca363): three monotone CAS records (financial pin in its
// incarnation-bearing wrapper, authorization anchor, history anchor),
// retained generations readable in generation order, and the
// crash-safe intent/CAS/ack provenance contract of design sections
// 2.3.2/2.3.3 exercised through doubles. It runs over ONE explicitly
// injected object transport meeting the object adapter's documented
// transport contract (authoritative read, atomic absent-only create,
// atomic version-conditional replace, complete cursor-paginated
// listing; compare-and-swap is never emulated with an unconditional
// write). Generations are create-only objects: the highest retained
// generation is the record, and creating generation n+1 is the
// generation-preconditioned conditional write.
//
//   read...(key)        -> null ONLY for proven absence; malformed,
//                          unreadable or foreign state THROWS.
//   advance...(expected, next)
//                       -> literal true ONLY for a definite,
//                          acknowledgement-verified conditional write;
//                          literal false ONLY for a definite conflict;
//                          anything else THROWS. Genesis only from
//                          proven absence; sequential transitions
//                          only — no rollback, no fork, no skip.
//   open...Intent(...)  -> deterministic event identity; whole-
//                          workflow admission serialization (INV-ADM):
//                          a second intent while one is non-terminal
//                          (W1-W4, witness completion included) is a
//                          not-admitted { status: 'unknown' } outcome
//                          that writes nothing.
//   replay/classify/audit
//                       -> generation-chain replay establishes the
//                          anchored set before ack completeness is
//                          examined; W4 (acked-unwitnessed) and W5
//                          (complete) are distinguished by witness
//                          completion, never by provenance alone.
//
// The authorization store append, the frontier statement reads and
// the cross-witness module are S2/S3 composition: here the store set
// and the witness log are test doubles, exactly as the corrected S1
// assignment requires. Synthetic transport only: this suite does NOT
// qualify a real object provider. No provisioning, configuration,
// credentials, endpoints, live callers or activation anywhere.
//
// Tests first: against unmodified main this suite fails to load (the
// anchor store module does not exist).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'scripts/settlement-evidence-anchor-store'));

const householdId = 'household-' + 'a'.repeat(32);
const ledgerNamespace = 'ledger-' + 'b'.repeat(32);
const scope = 'scope-alpha';
const schema = 'settlement_evidence';
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const gen = n => 'generation-' + n.toString(16).padStart(32, '0');
const hashOf = s => crypto.createHash('sha256').update('anchor-test:' + s).digest('hex');
const sidOf = n => hashOf('sid:' + n);
const T0 = Date.parse('2026-10-04T12:00:00Z');
const tick = n => T0 + n * 1000;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// --- Synthetic in-memory object transport ---------------------------------
// Implements the object adapter's documented transport contract with
// per-method one-shot fault injection:
//   'throw'        -> throw, no durable effect
//   'throw-landed' -> apply the durable effect, then throw (lost ack)
//   'bad-ack'      -> apply the durable effect, return a malformed ack
function makeTransport(over = {}) {
  const objects = new Map();
  let seq = 0;
  const calls = [];
  const faults = new Map();
  const state = { pageSize: over.pageSize || 2 };
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
    objects, calls, failNext, state,
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
      const perform = () => {
        if (objects.has(key)) throw conflictError();
        const version = 'v' + (++seq);
        objects.set(key, { bytes: Buffer.from(bytes), version, metadata: { ...metadata } });
        return { version, integrity: sha256(bytes) };
      };
      const f = takeFault('create');
      if (f === 'throw') throw new Error('synthetic transport: create ack lost (not landed)');
      if (f === 'throw-landed') { perform(); throw new Error('synthetic transport: create ack lost (landed)'); }
      const ack = perform();
      if (f === 'bad-ack') return { version: ack.version, integrity: 'f'.repeat(64) };
      return ack;
    },
    async replace(key, bytes, version, metadata) {
      calls.push({ method: 'replace', key });
      const perform = () => {
        const o = objects.get(key);
        if (!o || o.version !== version) throw conflictError();
        const v = 'v' + (++seq);
        objects.set(key, { bytes: Buffer.from(bytes), version: v, metadata: { ...metadata } });
        return { version: v, integrity: sha256(bytes) };
      };
      const f = takeFault('replace');
      if (f === 'throw') throw new Error('synthetic transport: replace ack lost (not landed)');
      if (f === 'throw-landed') { perform(); throw new Error('synthetic transport: replace ack lost (landed)'); }
      const ack = perform();
      if (f === 'bad-ack') return { version: ack.version, integrity: 'f'.repeat(64) };
      return ack;
    },
    async list(prefix, cursor) {
      calls.push({ method: 'list', key: prefix });
      const f = takeFault('list');
      if (f === 'throw') throw new Error('synthetic transport: list failed');
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor === null ? 0 : keys.findIndex(k => k > cursor);
      const from = start < 0 ? keys.length : start;
      const page = keys.slice(from, from + state.pageSize);
      const entries = page.map(k => ({ key: k, metadata: { ...objects.get(k).metadata } }));
      const nextCursor = from + page.length < keys.length ? page[page.length - 1] : null;
      return { entries, nextCursor };
    },
  };
}

function makeStore(transport) {
  return A.createSettlementEvidenceAnchorStore({ transport, prefix: 'anchor-test', schema });
}

// A witness-log double: S3 owns the real module; S1 consumes
// observations as data and appends through an injected sink.
function makeWitness() {
  const observations = [];
  return {
    observations,
    async appendObservation(obs) {
      observations.push({ ...obs, observedAt: tick(900 + observations.length) });
      return true;
    },
  };
}

const NONCE = 'provisioning-nonce-1';
function genesisAuth(store, over = {}) {
  return store.genesisAuthorization(scope, { nonce: NONCE, updatedAt: tick(1), ...over });
}
async function genesisAll(store) {
  const incarnation = A.computeGenesisIncarnation({ scope, schema, nonce: NONCE });
  assert.equal(await genesisAuth(store), true);
  assert.equal(await store.genesisPin(householdId,
    { incarnation, digest: hashOf('pin-genesis'), timestamp: tick(1) }), true);
  assert.equal(await store.genesisHistory(householdId, ledgerNamespace,
    { incarnation, digest: hashOf('history-genesis'), updatedAt: tick(1) }), true);
  return incarnation;
}
const opRev = (n, revokedAt) => ({
  scope, kind: 'oprev', operationId: op(n), generation: gen(n), revokedAt,
});
function nextAuthRecord(current, { eventId, entries, updatedAt }) {
  return {
    scope, incarnation: current.incarnation, epoch: current.epoch + 1,
    revocationCount: entries.length,
    frontierDigest: A.computeFrontierDigest({ schema, scope, incarnation: current.incarnation, entries }),
    priorDigest: current.frontierDigest, lastEventId: eventId, updatedAt,
  };
}
// Runs one full revocation flow through the anchor-side primitives
// (the store append itself is the S3 double: a test-owned set).
async function runRevocation(store, storeSet, witness, n, revokedAt) {
  const intent = opRev(n, revokedAt);
  const opened = await store.openAuthorizationIntent(intent, { witnessObservations: witness.observations });
  assert.equal(opened.status, 'admitted');
  const entryHex = A.encodeRevocationEntry(intent).toString('hex');
  storeSet.add(entryHex);
  const current = await store.readAuthorization(scope);
  const next = nextAuthRecord(current, {
    eventId: opened.eventId, entries: [...storeSet], updatedAt: tick(10 + n),
  });
  assert.equal(await store.advanceAuthorization(scope, current, next), true);
  const gens = await store.listAuthorizationGenerations(scope);
  const landed = gens[gens.length - 1];
  await store.writeAckAuthorization(scope, opened.eventId, landed.generation, landed.recordHash);
  await witness.appendObservation({
    scope, incarnation: current.incarnation, epoch: next.epoch,
    frontierDigest: next.frontierDigest, recordHash: landed.recordHash, eventId: opened.eventId,
  });
  return { eventId: opened.eventId, entryHex, next };
}

test('construction refuses a transport without the documented conditional capabilities', async () => {
  assert.throws(() => A.createSettlementEvidenceAnchorStore({ transport: {}, prefix: 'x', schema }),
    TypeError);
  const t = makeTransport();
  delete t.list;
  assert.throws(() => A.createSettlementEvidenceAnchorStore({ transport: t, prefix: 'x', schema }),
    TypeError);
  await assert.rejects(makeStore(makeTransport()).readAuthorization('Bad Scope'), /scope is invalid/);
});

test('pin 1: genesis creates each of the three record shapes from proven absence', async () => {
  const store = makeStore(makeTransport());
  assert.equal(await store.readPin(householdId), null);
  assert.equal(await store.readAuthorization(scope), null);
  assert.equal(await store.readHistory(householdId, ledgerNamespace), null);
  const incarnation = await genesisAll(store);
  assert.deepEqual(await store.readPin(householdId), {
    incarnation, pin: { revision: 0, digest: hashOf('pin-genesis'), timestamp: tick(1) },
  });
  const auth = await store.readAuthorization(scope);
  assert.deepEqual(auth, {
    scope, incarnation, epoch: 0, revocationCount: 0,
    frontierDigest: A.computeFrontierDigest({ schema, scope, incarnation, entries: [] }),
    priorDigest: null, lastEventId: auth.lastEventId, updatedAt: tick(1),
  });
  assert.match(auth.lastEventId, /^[a-f0-9]{64}$/);
  assert.deepEqual(await store.readHistory(householdId, ledgerNamespace), {
    incarnation, revision: 0, digest: hashOf('history-genesis'),
    lastEventId: (await store.readHistory(householdId, ledgerNamespace)).lastEventId,
    updatedAt: tick(1),
  });
  // Genesis against existing state is a definite conflict, never a rewrite.
  assert.equal(await genesisAuth(store), false);
  assert.equal(await store.genesisPin(householdId,
    { incarnation, digest: hashOf('pin-genesis'), timestamp: tick(1) }), false);
});

test('pin 2: sequential advance resolves the literal true', async () => {
  const store = makeStore(makeTransport());
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const r1 = await runRevocation(store, storeSet, witness, 1, tick(50));
  assert.equal(typeof r1.eventId, 'string');
  const head = await store.readAuthorization(scope);
  assert.equal(head.epoch, 1);
  assert.equal(head.revocationCount, 1);
  assert.equal(head.lastEventId, r1.eventId);
  assert.equal(head.priorDigest,
    A.computeFrontierDigest({ schema, scope, incarnation: head.incarnation, entries: [] }));
  // Pin + history sequential advances also resolve literal true.
  const pin = await store.readPin(householdId);
  assert.equal(await store.advancePin(householdId, pin,
    { incarnation: pin.incarnation, pin: { revision: 1, digest: hashOf('pin-1'), timestamp: tick(2) } }), true);
  const hist = await store.readHistory(householdId, ledgerNamespace);
  assert.equal(await store.advanceHistory(householdId, ledgerNamespace, hist,
    { incarnation: hist.incarnation, revision: 1, digest: hashOf('history-1'), lastEventId: hashOf('hist-event-1'), updatedAt: tick(2) }), true);
});

test('pin 3: rollback is refused and durable state stays byte-identical', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  await runRevocation(store, storeSet, witness, 1, tick(50));
  const snapshot = new Map([...transport.objects].map(([k, v]) => [k, Buffer.from(v.bytes)]));
  const head = await store.readAuthorization(scope);
  const genesisRecord = (await store.listAuthorizationGenerations(scope))[0].record;
  // Moving the head back to the genesis shape is not a sequential transition.
  await assert.rejects(store.advanceAuthorization(scope, head, genesisRecord), /sequential/);
  // Replaying an already-landed transition from a stale base is a definite conflict.
  const replayNext = nextAuthRecord(genesisRecord, {
    eventId: head.lastEventId, entries: [...storeSet], updatedAt: tick(99),
  });
  assert.equal(await store.advanceAuthorization(scope, genesisRecord, replayNext), false);
  assert.deepEqual(new Map([...transport.objects].map(([k, v]) => [k, Buffer.from(v.bytes)])), snapshot);
});

test('pin 4: a same-revision different-digest fork is refused', async () => {
  const store = makeStore(makeTransport());
  await genesisAll(store);
  const pin = await store.readPin(householdId);
  const forkA = { incarnation: pin.incarnation, pin: { revision: 1, digest: hashOf('fork-a'), timestamp: tick(2) } };
  const forkB = { incarnation: pin.incarnation, pin: { revision: 1, digest: hashOf('fork-b'), timestamp: tick(2) } };
  assert.equal(await store.advancePin(householdId, pin, forkA), true);
  assert.equal(await store.advancePin(householdId, pin, forkB), false);
  assert.equal((await store.readPin(householdId)).pin.digest, hashOf('fork-a'));
});

test('pin 5: a skipped revision is refused on every record', async () => {
  const store = makeStore(makeTransport());
  await genesisAll(store);
  const pin = await store.readPin(householdId);
  await assert.rejects(store.advancePin(householdId, pin,
    { incarnation: pin.incarnation, pin: { revision: 2, digest: hashOf('skip'), timestamp: tick(2) } }),
    /sequential/);
  const auth = await store.readAuthorization(scope);
  await assert.rejects(store.advanceAuthorization(scope, auth, {
    ...auth, epoch: 2, lastEventId: hashOf('skip-event'), updatedAt: tick(2),
  }), /sequential/);
  const hist = await store.readHistory(householdId, ledgerNamespace);
  await assert.rejects(store.advanceHistory(householdId, ledgerNamespace, hist,
    { incarnation: hist.incarnation, revision: 2, digest: hashOf('skip'), lastEventId: hashOf('skip-event'), updatedAt: tick(2) }),
    /sequential/);
  assert.equal((await store.readPin(householdId)).pin.revision, 0);
  assert.equal((await store.readAuthorization(scope)).epoch, 0);
  assert.equal((await store.readHistory(householdId, ledgerNamespace)).revision, 0);
});

test('pin 6: a stale expected pair is a definite conflict — literal false', async () => {
  const transport = makeTransport();
  const storeA = makeStore(transport);
  const storeB = makeStore(transport);
  await genesisAll(storeA);
  const genesisRecord = await storeB.readAuthorization(scope);
  const witness = makeWitness();
  const storeSet = new Set();
  await runRevocation(storeA, storeSet, witness, 1, tick(50));
  // storeB still holds the genesis pair as its expected base.
  const entryHex = A.encodeRevocationEntry(opRev(2, tick(51))).toString('hex');
  const staleNext = nextAuthRecord(genesisRecord, {
    eventId: hashOf('other-event'), entries: [entryHex], updatedAt: tick(60),
  });
  assert.equal(await storeB.advanceAuthorization(scope, genesisRecord, staleNext), false);
  // A generation race at the transport: two writers, one create wins.
  const cur = await storeA.readAuthorization(scope);
  const raceNext = nextAuthRecord(cur, {
    eventId: hashOf('race-event'), entries: [...storeSet, entryHex], updatedAt: tick(61),
  });
  const [r1, r2] = await Promise.all([
    storeA.advanceAuthorization(scope, cur, raceNext),
    storeB.advanceAuthorization(scope, cur, raceNext),
  ]);
  assert.deepEqual([r1, r2].sort(), [false, true]);
});

test('pin 7: an uncertain transport outcome throws — it never resolves true', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  await genesisAll(store);
  const pin = await store.readPin(householdId);
  const next = { incarnation: pin.incarnation, pin: { revision: 1, digest: hashOf('pin-1'), timestamp: tick(2) } };
  transport.failNext('create', 'throw');
  await assert.rejects(store.advancePin(householdId, pin, next), /ack lost \(not landed\)/);
  assert.equal((await store.readPin(householdId)).pin.revision, 0);
  transport.failNext('create', 'bad-ack');
  await assert.rejects(store.advancePin(householdId, pin, next), /acknowledgement does not bind/);
  // The bad-ack write in fact landed; uncertainty is reconciled from
  // observation (a fresh instance reads the landed revision), never
  // by reporting the advance as success.
  const fresh = makeStore(transport);
  assert.equal((await fresh.readPin(householdId)).pin.revision, 1);
});

test('pin 8: a malformed record on read throws — it is never absence or zero', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  await genesisAll(store);
  const keys = [...transport.objects.keys()];
  const pinGenKey = keys.find(k => k.includes('/records/') && k.endsWith('gen-0000000000.json')
    && transport.objects.get(k).metadata.kind === 'pin');
  const original = transport.objects.get(pinGenKey);
  transport.objects.set(pinGenKey, { ...original, bytes: Buffer.from('{"not":"a pin"}') });
  await assert.rejects(store.readPin(householdId), /failed validation/);
  transport.objects.set(pinGenKey, { ...original, bytes: Buffer.from('not json at all') });
  await assert.rejects(store.readPin(householdId), /not a .* record/);
  // Corruption of a middle generation is equally fatal to the chain read.
  const witness = makeWitness();
  const storeSet = new Set();
  transport.objects.set(pinGenKey, original);
  await runRevocation(store, storeSet, witness, 1, tick(50));
  await runRevocation(store, storeSet, witness, 2, tick(51));
  const gens = await store.listAuthorizationGenerations(scope);
  assert.equal(gens.length, 3);
  const midKey = [...transport.objects.keys()].find(k =>
    transport.objects.get(k).metadata.kind === 'authorization' && k.endsWith('gen-0000000001.json'));
  const mid = transport.objects.get(midKey);
  transport.objects.set(midKey, { ...mid, bytes: Buffer.from('{"v":1,"kind":"authorization"}') });
  await assert.rejects(store.listAuthorizationGenerations(scope), /failed validation/);
});

test('pin 9: provenance is distinct intent + terminal entries; one acked intent per landed transition', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const r1 = await runRevocation(store, storeSet, witness, 1, tick(50));
  const prov = await store.listProvenanceAuthorization(scope);
  const intent = prov.find(e => e.eventId === r1.eventId && e.kind === 'intent');
  const ack = prov.find(e => e.eventId === r1.eventId && e.kind === 'ack');
  assert.ok(intent, 'intent entry exists');
  assert.ok(ack, 'ack entry exists as a distinct entry');
  assert.equal(intent.status, 'intent');
  assert.equal(intent.entry, r1.entryHex);
  assert.deepEqual(intent.priorAnchor, {
    incarnation: (await store.readAuthorization(scope)).incarnation,
    epoch: 0, count: 0,
    frontierDigest: A.computeFrontierDigest({
      schema, scope, incarnation: (await store.readAuthorization(scope)).incarnation, entries: [],
    }),
  });
  // The ack binds the exact landed generation and its record hash.
  const gens = await store.listAuthorizationGenerations(scope);
  const landed = gens[gens.length - 1];
  assert.equal(ack.generation, landed.generation);
  assert.equal(ack.recordHash, landed.recordHash);
  const storedBytes = transport.objects.get(
    [...transport.objects.keys()].find(k => k.endsWith(`gen-${String(landed.generation).padStart(10, '0')}.json`)
      && transport.objects.get(k).metadata.kind === 'authorization')).bytes;
  assert.equal(ack.recordHash, sha256(storedBytes));
  // A second terminal entry for the same event is refused.
  await assert.rejects(store.writeAckAuthorization(scope, r1.eventId, landed.generation, landed.recordHash),
    /terminal entry already exists/);
  await assert.rejects(store.writeVoidAuthorization(scope, r1.eventId), /terminal entry already exists/);
  // An ack cannot be fabricated for a generation that does not name the event.
  const opened = await store.openAuthorizationIntent(opRev(2, tick(51)),
    { witnessObservations: witness.observations });
  assert.equal(opened.status, 'admitted');
  await assert.rejects(store.writeAckAuthorization(scope, opened.eventId, landed.generation, landed.recordHash),
    /does not name/);
});

test('retained generations are readable in generation order with hash binding', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  await runRevocation(store, storeSet, witness, 1, tick(50));
  await runRevocation(store, storeSet, witness, 2, tick(51));
  await runRevocation(store, storeSet, witness, 3, tick(52));
  const gens = await store.listAuthorizationGenerations(scope);
  assert.deepEqual(gens.map(g => g.generation), [0, 1, 2, 3]);
  assert.deepEqual(gens.map(g => g.record.epoch), [0, 1, 2, 3]);
  for (const g of gens) {
    const key = [...transport.objects.keys()].find(k =>
      k.endsWith(`gen-${String(g.generation).padStart(10, '0')}.json`)
      && transport.objects.get(k).metadata.kind === 'authorization');
    assert.equal(g.recordHash, sha256(transport.objects.get(key).bytes));
    if (g.generation > 0) assert.equal(g.record.priorDigest, gens[g.generation - 1].record.frontierDigest);
  }
});

test('deterministic event identity binds scope, kind, key and revocation tick', () => {
  const a1 = A.computeAuthorizationEventId(opRev(1, tick(50)));
  assert.equal(a1, A.computeAuthorizationEventId(opRev(1, tick(50))));
  assert.notEqual(a1, A.computeAuthorizationEventId(opRev(1, tick(51))));
  assert.notEqual(a1, A.computeAuthorizationEventId(opRev(2, tick(50))));
  assert.notEqual(a1, A.computeAuthorizationEventId({ ...opRev(1, tick(50)), scope: 'scope-beta' }));
  const ses = { scope, kind: 'sesrev', sidDigest: sidOf(1), revokedAt: tick(50) };
  assert.equal(A.computeAuthorizationEventId(ses), A.computeAuthorizationEventId({ ...ses }));
  assert.notEqual(A.computeAuthorizationEventId(ses), a1);
  // Independent oracle: rebuild the section 2.3.2 preimage by hand.
  const frame = x => {
    const b = Buffer.isBuffer(x) ? x : Buffer.from(x, 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32BE(b.length);
    return Buffer.concat([len, b]);
  };
  const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
  const expected = sha256(Buffer.concat([
    frame('atlas-anchor-event'), frame(scope), frame('oprev'),
    frame(op(1)), frame(gen(1)), u64(tick(50)),
  ]));
  assert.equal(a1, expected);
  // History event identity (section 2.4.2) is likewise deterministic
  // and sensitive to the prior pair and the certificate.
  const cert = { schema: 'terminal-certificate-2', note: 'synthetic' };
  const h1 = A.computeHistoryEventId({
    householdId, ledgerNamespace, priorPair: { revision: 0, digest: hashOf('h0') }, certificate: cert,
  });
  assert.equal(h1, A.computeHistoryEventId({
    householdId, ledgerNamespace, priorPair: { revision: 0, digest: hashOf('h0') }, certificate: cert,
  }));
  assert.notEqual(h1, A.computeHistoryEventId({
    householdId, ledgerNamespace, priorPair: { revision: 1, digest: hashOf('h0') }, certificate: cert,
  }));
  assert.notEqual(h1, A.computeHistoryEventId({
    householdId, ledgerNamespace, priorPair: { revision: 0, digest: hashOf('h0') },
    certificate: { ...cert, note: 'other' },
  }));
});

test('frontier digest is order-independent and domain-bound', () => {
  const e1 = A.encodeRevocationEntry(opRev(1, tick(50)));
  const e2 = A.encodeRevocationEntry(opRev(2, tick(51)));
  const incarnation = hashOf('inc');
  const d1 = A.computeFrontierDigest({ schema, scope, incarnation, entries: [e1, e2] });
  assert.equal(d1, A.computeFrontierDigest({ schema, scope, incarnation, entries: [e2, e1] }));
  assert.notEqual(d1, A.computeFrontierDigest({ schema, scope: 'scope-beta', incarnation, entries: [e1, e2] }));
  assert.notEqual(d1, A.computeFrontierDigest({ schema: 'other_schema', scope, incarnation, entries: [e1, e2] }));
  assert.notEqual(d1, A.computeFrontierDigest({ schema, scope, incarnation: hashOf('inc2'), entries: [e1, e2] }));
  assert.notEqual(d1, A.computeFrontierDigest({ schema, scope, incarnation, entries: [e1] }));
});

test('restart after a lost ack: W3 is classified, then completed from the landed generation (C3)', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const opened = await store.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: witness.observations });
  assert.equal(opened.status, 'admitted');
  storeSet.add(A.encodeRevocationEntry(opRev(1, tick(50))).toString('hex'));
  const current = await store.readAuthorization(scope);
  const next = nextAuthRecord(current, {
    eventId: opened.eventId, entries: [...storeSet], updatedAt: tick(11),
  });
  assert.equal(await store.advanceAuthorization(scope, current, next), true);
  // Crash here: no ack, no observation. Restart = a fresh instance.
  const fresh = makeStore(transport);
  const classified = await fresh.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(classified.status, 'open');
  assert.equal(classified.intent.eventId, opened.eventId);
  assert.equal(classified.intent.state, 'W3');
  const completed = await fresh.completeAuthorizationProvenance(scope,
    { witnessObservations: witness.observations, appendObservation: witness.appendObservation });
  assert.deepEqual(completed.acksWritten, [opened.eventId]);
  assert.deepEqual(completed.observationsWritten, [opened.eventId]);
  const after = await fresh.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(after.status, 'complete');
  // The written ack binds the landed generation exactly.
  const prov = await fresh.listProvenanceAuthorization(scope);
  const ack = prov.find(e => e.eventId === opened.eventId && e.kind === 'ack');
  const gens = await fresh.listAuthorizationGenerations(scope);
  assert.equal(ack.generation, gens[1].generation);
  assert.equal(ack.recordHash, gens[1].recordHash);
});

test('W4 vs W5: an acked intent is not complete until the witness observation exists (C4)', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const opened = await store.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: witness.observations });
  storeSet.add(A.encodeRevocationEntry(opRev(1, tick(50))).toString('hex'));
  const current = await store.readAuthorization(scope);
  const next = nextAuthRecord(current, {
    eventId: opened.eventId, entries: [...storeSet], updatedAt: tick(11),
  });
  assert.equal(await store.advanceAuthorization(scope, current, next), true);
  const gens = await store.listAuthorizationGenerations(scope);
  await store.writeAckAuthorization(scope, opened.eventId, gens[1].generation, gens[1].recordHash);
  // Ack durable, observation missing: W4 — NOT complete, and a new
  // intent is still refused admission (witness completion is part of
  // terminal state, per INV-ADM as refined by the precision obligation).
  const classified = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(classified.intent.state, 'W4');
  const blocked = await store.openAuthorizationIntent(opRev(2, tick(51)),
    { witnessObservations: witness.observations });
  assert.deepEqual({ status: blocked.status, reason: blocked.reason },
    { status: 'unknown', reason: 'anchor-intent-open' });
  // Phase O completes the observation over the landed transition even
  // though the intent is terminal in the provenance log.
  const completed = await store.completeAuthorizationProvenance(scope,
    { witnessObservations: witness.observations, appendObservation: witness.appendObservation });
  assert.deepEqual(completed.acksWritten, []);
  assert.deepEqual(completed.observationsWritten, [opened.eventId]);
  const after = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(after.status, 'complete');
  const admitted = await store.openAuthorizationIntent(opRev(2, tick(51)),
    { witnessObservations: witness.observations });
  assert.equal(admitted.status, 'admitted');
});

test('INV-ADM: a second intent is not admitted while one is open, and admission writes nothing', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const first = await store.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: witness.observations });
  assert.equal(first.status, 'admitted');
  const before = transport.objects.size;
  const second = await store.openAuthorizationIntent(opRev(2, tick(51)),
    { witnessObservations: witness.observations });
  assert.equal(second.status, 'unknown');
  assert.equal(second.reason, 'anchor-intent-open');
  assert.equal(second.blockingEventId, first.eventId);
  assert.equal(transport.objects.size, before);
  // Re-opening the SAME event resumes the existing intent; no duplicate.
  const resumed = await store.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: witness.observations });
  assert.equal(resumed.status, 'admitted');
  assert.equal(resumed.resumed, true);
  const intents = (await store.listProvenanceAuthorization(scope)).filter(e => e.kind === 'intent');
  assert.equal(intents.length, 1);
});

test('C0/C1: intent-only classifies W1; appended-unanchored classifies W2; void closes W1', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const opened = await store.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: witness.observations });
  let classified = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(classified.intent.state, 'W1');
  // The append commits (double) but no advance runs: committed-unanchored.
  storeSet.add(A.encodeRevocationEntry(opRev(1, tick(50))).toString('hex'));
  classified = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(classified.intent.state, 'W2');
  // A separate scope whose append never committed voids cleanly.
  const store2 = makeStore(makeTransport());
  await genesisAll(store2);
  const opened2 = await store2.openAuthorizationIntent(opRev(1, tick(50)),
    { witnessObservations: [] });
  await store2.writeVoidAuthorization(scope, opened2.eventId);
  const closed = await store2.classifyAuthorization(scope,
    { storeEntries: [], witnessObservations: [] });
  assert.equal(closed.status, 'complete');
  const prov = await store2.listProvenanceAuthorization(scope);
  assert.equal(prov.find(e => e.eventId === opened2.eventId && e.kind === 'void').status, 'void');
});

test('a duplicate append closes duplicate-satisfied against the owning event, never acked', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  const owner = await runRevocation(store, storeSet, witness, 1, tick(50));
  // Same key, different revokedAt: a different event owns the row.
  const dup = await store.openAuthorizationIntent(opRev(1, tick(77)),
    { witnessObservations: witness.observations });
  assert.equal(dup.status, 'admitted');
  const classified = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(classified.intent.eventId, dup.eventId);
  assert.equal(classified.intent.state, 'duplicate-satisfiable');
  await store.writeDuplicateSatisfiedAuthorization(scope, dup.eventId, owner.eventId);
  const closed = await store.classifyAuthorization(scope,
    { storeEntries: [...storeSet], witnessObservations: witness.observations });
  assert.equal(closed.status, 'complete');
  const prov = await store.listProvenanceAuthorization(scope);
  const dupEntry = prov.find(e => e.eventId === dup.eventId && e.kind === 'duplicate-satisfied');
  assert.equal(dupEntry.owningEventId, owner.eventId);
  assert.equal(prov.some(e => e.eventId === dup.eventId && e.kind === 'ack'), false);
});

test('generation-chain replay detects tampering and unowned generations as unproven', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  await runRevocation(store, storeSet, witness, 1, tick(50));
  const ok = await store.replayAuthorization(scope);
  assert.equal(ok.status, 'verified');
  assert.deepEqual(ok.anchoredEntries, [...storeSet]);
  // Tamper with the landed generation's frontier digest.
  const genKey = [...transport.objects.keys()].find(k =>
    transport.objects.get(k).metadata.kind === 'authorization' && k.endsWith('gen-0000000001.json'));
  const landed = transport.objects.get(genKey);
  const forged = JSON.parse(landed.bytes.toString('utf8'));
  forged.frontierDigest = hashOf('forged');
  transport.objects.set(genKey, { ...landed, bytes: Buffer.from(JSON.stringify(forged)) });
  const bad = await store.replayAuthorization(scope);
  assert.equal(bad.status, 'unproven');
  transport.objects.set(genKey, landed);
  // A generation naming an event with no provenance intent is unproven.
  const current = await store.readAuthorization(scope);
  const foreignNext = nextAuthRecord(current, {
    eventId: hashOf('no-intent-event'), entries: [...storeSet], updatedAt: tick(70),
  });
  assert.equal(await store.advanceAuthorization(scope, current, foreignNext), true);
  const foreign = await store.replayAuthorization(scope);
  assert.equal(foreign.status, 'unproven');
});

test('an anchored entry missing from the store set is unproven, never re-baselined', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  await runRevocation(store, storeSet, witness, 1, tick(50));
  const classified = await store.classifyAuthorization(scope,
    { storeEntries: [], witnessObservations: witness.observations });
  assert.equal(classified.status, 'unproven');
  assert.match(classified.reason, /missing from the store/);
  const head = await store.readAuthorization(scope);
  assert.equal(head.epoch, 1); // the anchor did not move
});

test('audit completeness: clean flow is complete; gaps are named, not laundered', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const witness = makeWitness();
  await genesisAll(store);
  const storeSet = new Set();
  await runRevocation(store, storeSet, witness, 1, tick(50));
  const clean = await store.auditAuthorization(scope, { witnessObservations: witness.observations });
  assert.equal(clean.status, 'complete');
  assert.deepEqual(clean.violations, []);
  // Open a second intent and leave it: audit reports it as incomplete.
  const opened = await store.openAuthorizationIntent(opRev(2, tick(51)),
    { witnessObservations: witness.observations });
  assert.equal(opened.status, 'admitted');
  const gapped = await store.auditAuthorization(scope, { witnessObservations: witness.observations });
  assert.equal(gapped.status, 'incomplete');
  assert.ok(gapped.violations.some(v => v.includes(opened.eventId)));
});

test('history pending events: deterministic identity, advance, ack binding, classification', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  const incarnation = await genesisAll(store);
  const certificate = { schema: 'terminal-certificate-2', note: 'synthetic-cert-1' };
  const priorPair = { revision: 0, digest: hashOf('history-genesis') };
  const opened = await store.openHistoryIntent({
    householdId, ledgerNamespace, priorPair, certificate,
  });
  assert.equal(opened.status, 'admitted');
  assert.equal(opened.eventId, A.computeHistoryEventId({
    householdId, ledgerNamespace, priorPair, certificate,
  }));
  // A second pending event for the domain is not admitted meanwhile.
  const blocked = await store.openHistoryIntent({
    householdId, ledgerNamespace,
    priorPair: { revision: 0, digest: hashOf('history-genesis') },
    certificate: { ...certificate, note: 'other' },
  });
  assert.equal(blocked.status, 'unknown');
  const derivedPair = { revision: 1, digest: hashOf('history-1') };
  // Before the append lands: staged state equals the prior pair -> void class.
  let classified = await store.classifyHistoryEvent(householdId, ledgerNamespace, opened.eventId, {
    derivedPair, stagedPair: priorPair, stagedPrefixThroughDerived: false,
    stagedCertificateMatches: false,
  });
  assert.equal(classified.status, 'void');
  // The append lands in the store (double) but the anchor has not moved.
  classified = await store.classifyHistoryEvent(householdId, ledgerNamespace, opened.eventId, {
    derivedPair, stagedPair: derivedPair, stagedPrefixThroughDerived: false,
    stagedCertificateMatches: false,
  });
  assert.equal(classified.status, 'genuinely-new');
  const current = await store.readHistory(householdId, ledgerNamespace);
  assert.equal(await store.advanceHistory(householdId, ledgerNamespace, current, {
    incarnation, revision: 1, digest: derivedPair.digest,
    lastEventId: opened.eventId, updatedAt: tick(3),
  }), true);
  // Ack lost: the anchor already names the event -> already-landed.
  classified = await store.classifyHistoryEvent(householdId, ledgerNamespace, opened.eventId, {
    derivedPair, stagedPair: derivedPair, stagedPrefixThroughDerived: false,
    stagedCertificateMatches: false,
  });
  assert.equal(classified.status, 'already-landed');
  const gens = await store.listHistoryGenerations(householdId, ledgerNamespace);
  await store.writeAckHistory(householdId, ledgerNamespace, opened.eventId,
    gens[1].generation, gens[1].recordHash);
  const prov = await store.listProvenanceHistory(householdId, ledgerNamespace);
  assert.equal(prov.find(e => e.eventId === opened.eventId && e.kind === 'ack').recordHash,
    gens[1].recordHash);
  // A divergent staged state is unproven, never adopted.
  const opened2 = await store.openHistoryIntent({
    householdId, ledgerNamespace, priorPair: derivedPair,
    certificate: { ...certificate, note: 'synthetic-cert-2' },
  });
  assert.equal(opened2.status, 'admitted');
  const unproven = await store.classifyHistoryEvent(householdId, ledgerNamespace, opened2.eventId, {
    derivedPair: { revision: 2, digest: hashOf('history-2') },
    stagedPair: { revision: 2, digest: hashOf('divergent') },
    stagedPrefixThroughDerived: false, stagedCertificateMatches: false,
  });
  assert.equal(unproven.status, 'unproven');
});

test('advance only ever creates the next generation — CAS is never emulated', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  await genesisAll(store);
  transport.calls.length = 0;
  const pin = await store.readPin(householdId);
  assert.equal(await store.advancePin(householdId, pin,
    { incarnation: pin.incarnation, pin: { revision: 1, digest: hashOf('pin-1'), timestamp: tick(2) } }), true);
  const writes = transport.calls.filter(c => c.method === 'create' || c.method === 'replace');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'create');
  assert.ok(writes[0].key.endsWith('gen-0000000001.json'));
});

test('malformed advance inputs throw before any write', async () => {
  const transport = makeTransport();
  const store = makeStore(transport);
  await genesisAll(store);
  const before = transport.objects.size;
  const pin = await store.readPin(householdId);
  await assert.rejects(store.advancePin(householdId, pin,
    { incarnation: pin.incarnation, pin: { revision: 1, digest: 'not-a-hash', timestamp: tick(2) } }),
    /malformed/);
  await assert.rejects(store.advancePin(householdId, pin,
    { incarnation: hashOf('other-incarnation'), pin: { revision: 1, digest: hashOf('x'), timestamp: tick(2) } }),
    /incarnation/);
  assert.equal(transport.objects.size, before);
});
