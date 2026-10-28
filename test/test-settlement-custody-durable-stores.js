'use strict';

// Settlement custody durable stores (Plan #5, GAP-1): prove the
// Postgres-backed custody pin/backup surfaces bind exactly the store's
// injected interfaces over ONE dedicated direct session — write/read
// round-trips, RESTART PERSISTENCE (a second factory instance over a
// new session sees the first instance's pin and backups: the
// acceptance this slice exists for), fail-closed corruption and
// foreign state, household scoping, permanent session loss, and the
// real evidence store bootstrapping and committing over the durable
// stores and still seeing their custody after a restart. The database
// is an in-memory fake behind a pg-shaped Client class; no real
// database, network or credential is involved. Synthetic documents are
// built through the Phase 1 contract itself (adopt / prepare /
// confirmCandidate), exactly as the shipped adapter suites build them.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../scripts/planned-obligation-settlement-contract');
const {
  createSettlementCustodyDurableStores,
} = require('../scripts/settlement-custody-durable-stores');
const {
  createSettlementEvidenceStore,
} = require('../scripts/settlement-evidence-store');

const HOUSEHOLD = 'household-' + 'a'.repeat(32);
const HOUSEHOLD_B = 'household-' + 'b'.repeat(32);
const SCOPE = 'custody-test';
const HOST = 'db.example.invalid';
const T0 = Date.parse('2026-10-04T12:00:00Z');
const DIGEST_0 = 'c'.repeat(64);
const DIGEST_1 = 'd'.repeat(64);
const DIGEST_2 = 'e'.repeat(64);

// ------------------------------------------------------- synthetic docs ----
// Real contract documents: genesis via adopt, revision 1 via the
// prepare/confirmCandidate flow (the shipped adapter suites' pattern).
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const stateOf = bytes => JSON.parse(bytes.toString('utf8'));
const genesisBytes = C.adopt({ householdId: HOUSEHOLD });
const genesisDigest = stateOf(genesisBytes).digest;
const genesisBytesB = C.adopt({ householdId: HOUSEHOLD_B });
function rev1Document() {
  const evidence = {
    accountId: 'acct-main', currency: 'cad', direction: 'debit',
    date: '2026-10-03', cents: 6000, posted: true,
  };
  const command = {
    version: 1, kind: 'link', goalId: 'commitment:near', txRef: tx(1),
    evidence, evidenceDigest: C.digest(evidence), assignedCents: 2500,
    asOf: '2026-10-04',
  };
  const prep = C.prepare(genesisBytes, {
    householdId: HOUSEHOLD, actorId, operationId: op(1), command, now: T0 + 1000,
  });
  const res = C.confirmCandidate(genesisBytes, {
    householdId: HOUSEHOLD, actorId, preview: prep.preview,
    confirmationDigest: prep.confirmationDigest, now: T0 + 2000,
  });
  assert.equal(res.status, 'candidate');
  return Buffer.from(res.document);
}
const rev1Bytes = rev1Document();
const rev1Digest = stateOf(rev1Bytes).digest;

// ---------------------------------------------------------------- fake pg ---
// One fake database shared by every client the suite's factory
// instances construct: tables keyed exactly like the relations (pin by
// scope, backup by scope|revision|digest), SQL dispatched on the
// statement's stable prefix after the schema qualifier is normalised.
function createFakeDatabase() {
  return {
    pins: new Map(),
    backups: new Map(),
    failNext: null, // Error the next query (any client) rejects with
  };
}

function fakeClientClass(db, onConstruct) {
  return class FakeClient {
    constructor(config) {
      if (onConstruct) onConstruct(config);
      this.config = config;
      this.listeners = { error: [], end: [] };
      this.connected = false;
      this.ended = false;
    }
    on(event, fn) { this.listeners[event].push(fn); }
    emit(event) { for (const fn of this.listeners[event]) fn(new Error('fake session event')); }
    async connect() { if (this.ended) throw new Error('client ended'); this.connected = true; }
    async end() { this.ended = true; this.connected = false; }
    async query(text, values = []) {
      if (!this.connected || this.ended) throw new Error('client is not connected');
      if (db.failNext) { const e = db.failNext; db.failNext = null; throw e; }
      const sql = text.replace(/"[a-z_][a-z0-9_]*"\./, '<schema>.');
      const result = (command, rows = [], rowCount = rows.length) => ({ command, rows, rowCount });
      if (sql.startsWith('SELECT household, bytes FROM <schema>.custody_pin')) {
        const row = db.pins.get(values[0]);
        return result('SELECT', row ? [{ household: row.household, bytes: Buffer.from(row.bytes) }] : []);
      }
      if (sql.startsWith('INSERT INTO <schema>.custody_pin')) {
        if (db.pins.has(values[0])) {
          const e = new Error('duplicate key value violates unique constraint');
          e.code = '23505';
          throw e;
        }
        db.pins.set(values[0], { household: values[1], bytes: Buffer.from(values[2]) });
        return result('INSERT', [], 1);
      }
      if (sql.startsWith('UPDATE <schema>.custody_pin')) {
        const row = db.pins.get(values[0]);
        const match = !!row && row.household === values[2] && row.bytes.equals(values[3]);
        if (match) db.pins.set(values[0], { household: row.household, bytes: Buffer.from(values[1]) });
        return result('UPDATE', [], match ? 1 : 0);
      }
      if (sql.startsWith('INSERT INTO <schema>.custody_backup')) {
        const key = values[0] + '|' + values[2] + '|' + values[3];
        if (db.backups.has(key)) return result('INSERT', [], 0);
        db.backups.set(key, {
          scope: values[0], household: values[1], revision: values[2], digest: values[3],
          bytes: Buffer.from(values[4]), integrity: values[5],
        });
        return result('INSERT', [], 1);
      }
      if (sql.startsWith('SELECT household, revision, digest, bytes, integrity FROM <schema>.custody_backup WHERE scope = $1 AND')) {
        const row = db.backups.get(values[0] + '|' + values[1] + '|' + values[2]);
        return result('SELECT', row ? [{ ...row, bytes: Buffer.from(row.bytes) }] : []);
      }
      if (sql.startsWith('SELECT household, revision, digest, bytes, integrity FROM <schema>.custody_backup')) {
        const rows = [...db.backups.values()]
          .filter(r => r.scope === values[0])
          .map(r => ({ ...r, bytes: Buffer.from(r.bytes) }));
        return result('SELECT', rows);
      }
      throw new Error('fake client received unmodelled SQL: ' + text);
    }
  };
}

function makeStores(db, opts = {}) {
  return createSettlementCustodyDurableStores({
    connection: {
      Client: opts.Client || fakeClientClass(db),
      config: {
        host: HOST, port: 5432, database: 'atlas_test', user: 'custody_test',
        password: 'synthetic-test-password',
        ssl: { rejectUnauthorized: true, servername: HOST },
      },
      schema: 'settlement_evidence',
      scope: opts.scope || SCOPE,
    },
    householdId: opts.householdId || HOUSEHOLD,
    encrypt: opts.encrypt || (async bytes => Buffer.concat([
      Buffer.from('synthetic-cipher-v1:'),
      Buffer.from(bytes).map(b => b ^ 0xa5),
    ])),
  });
}

test('factory refuses malformed composition inputs and constructs no client', async () => {
  let constructed = 0;
  const Counting = fakeClientClass(createFakeDatabase(), () => { constructed += 1; });
  const good = () => ({
    connection: {
      Client: Counting,
      config: {
        host: HOST, port: 5432, database: 'atlas_test', user: 'custody_test',
        password: 'synthetic-test-password',
        ssl: { rejectUnauthorized: true, servername: HOST },
      },
      schema: 'settlement_evidence', scope: SCOPE,
    },
    householdId: HOUSEHOLD,
    encrypt: async b => Buffer.from(b),
  });
  const bad = [
    o => { o.connection.config.host = 'db-pooler.example.invalid'; }, // pooler endpoint
    o => { o.connection.config.ssl.rejectUnauthorized = false; },
    o => { o.connection.config.ssl.servername = 'other.example.invalid'; },
    o => { o.connection.config.host = '127.0.0.1'; }, // IP literal, not a bound FQDN
    o => { o.connection.schema = 'pg_catalog'; },
    o => { o.connection.schema = 'Bad Schema'; },
    o => { o.connection.scope = 'Bad Scope'; },
    o => { o.connection.Client = null; },
    o => { o.connection.extra = 1; },
    o => { o.connection.config.password = ''; },
    o => { o.householdId = 'household-xyz'; },
    o => { delete o.encrypt; },
    o => { o.extra = 1; },
  ];
  for (const mutate of bad) {
    const o = good();
    mutate(o);
    assert.throws(() => createSettlementCustodyDurableStores(o), TypeError);
  }
  const ok = makeStores(createFakeDatabase(), { Client: Counting });
  assert.equal(constructed, 0); // construction and retire perform no I/O
  await ok.retire();
});

test('pin round-trips and survives a restart: a second instance sees the first pin', async () => {
  const db = createFakeDatabase();
  const first = makeStores(db);
  assert.equal(await first.pinStore.read(), null); // proven absence
  assert.equal(await first.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 }), true);
  assert.equal(await first.pinStore.advance(
    { revision: 0, digest: DIGEST_0 }, { revision: 1, digest: DIGEST_1, timestamp: 11 }), true);
  assert.deepEqual(await first.pinStore.read(), { revision: 1, digest: DIGEST_1, timestamp: 11 });
  await first.retire();

  // Restart: a new factory instance over a NEW session, same database.
  const second = makeStores(db);
  assert.deepEqual(await second.pinStore.read(), { revision: 1, digest: DIGEST_1, timestamp: 11 });
  // And the chain continues from the durable state.
  assert.equal(await second.pinStore.advance(
    { revision: 1, digest: DIGEST_1 }, { revision: 2, digest: DIGEST_2, timestamp: 12 }), true);
  assert.deepEqual(await second.pinStore.read(), { revision: 2, digest: DIGEST_2, timestamp: 12 });
  await second.retire();
});

test('pin advance enforces genesis/sequential transitions and definite conflicts', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  // Expected pair against an absent pin: definite false.
  assert.equal(await s.pinStore.advance(
    { revision: 0, digest: DIGEST_0 }, { revision: 1, digest: DIGEST_1, timestamp: 10 }), false);
  // Non-sequential transitions throw (skip, re-genesis at revision > 0).
  await assert.rejects(() => s.pinStore.advance(
    null, { revision: 1, digest: DIGEST_1, timestamp: 10 }), /sequential/);
  await assert.rejects(() => s.pinStore.advance(
    { revision: 0, digest: DIGEST_0 }, { revision: 2, digest: DIGEST_2, timestamp: 10 }), /sequential/);
  // Malformed pairs throw.
  await assert.rejects(() => s.pinStore.advance(
    null, { revision: 0, digest: 'nope', timestamp: 10 }), /malformed/);
  await assert.rejects(() => s.pinStore.advance(
    null, { revision: 0, digest: DIGEST_0, timestamp: 0 }), /malformed/);
  await assert.rejects(() => s.pinStore.advance(
    { revision: -1, digest: DIGEST_0 }, { revision: 0, digest: DIGEST_0, timestamp: 10 }), /malformed/);
  // Genesis, then genesis again against the existing pin: definite false.
  assert.equal(await s.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 }), true);
  assert.equal(await s.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 }), false);
  // Full-pair mismatch (stale writer): definite false; the pin is unmoved.
  assert.equal(await s.pinStore.advance(
    { revision: 0, digest: DIGEST_1 }, { revision: 1, digest: DIGEST_1, timestamp: 11 }), false);
  assert.deepEqual(await s.pinStore.read(), { revision: 0, digest: DIGEST_0, timestamp: 10 });
  await s.retire();
});

test('pin read fails closed on corrupt or foreign stored state, never as absence', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  assert.equal(await s.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 }), true);
  const row = db.pins.get(SCOPE);
  const goodBytes = Buffer.from(row.bytes);
  const goodHousehold = row.household;

  row.bytes = Buffer.from('not json at all');
  await assert.rejects(() => s.pinStore.read(), /not a pin record/);

  // A well-formed pin record binding a DIFFERENT household.
  row.bytes = Buffer.from(JSON.stringify({
    v: 1, household: C.digest({ householdId: HOUSEHOLD_B }),
    revision: 0, digest: DIGEST_0, timestamp: 10,
  }));
  await assert.rejects(() => s.pinStore.read(), /failed validation/);

  // Row household column disagreeing with this factory's binding.
  row.bytes = goodBytes;
  row.household = 'unbound';
  await assert.rejects(() => s.pinStore.read(), /failed validation/);

  row.household = goodHousehold;
  assert.deepEqual(await s.pinStore.read(), { revision: 0, digest: DIGEST_0, timestamp: 10 });
  await s.retire();
});

test('backup put validates, encrypts and stores create-only; list verifies; a restart sees the manifest', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  assert.deepEqual(await s.backupStore.list(), []);

  const ack0 = await s.backupStore.put(0, genesisDigest, genesisBytes);
  assert.deepEqual(ack0, { revision: 0, digest: genesisDigest, artifactId: 'pg-rev-0-' + genesisDigest });
  const ack1 = await s.backupStore.put(1, rev1Digest, rev1Bytes);
  assert.deepEqual(ack1, { revision: 1, digest: rev1Digest, artifactId: 'pg-rev-1-' + rev1Digest });

  // Only ciphertext ever reached the database.
  for (const row of db.backups.values()) {
    assert.ok(row.bytes.toString('utf8').startsWith('synthetic-cipher-v1:'));
    assert.ok(!row.bytes.toString('utf8').includes(HOUSEHOLD));
  }

  // Idempotent re-put over the same artifact: acknowledged to the
  // existing artifact, stored bytes never overwritten.
  const key1 = SCOPE + '|1|' + rev1Digest;
  const storedBefore = Buffer.from(db.backups.get(key1).bytes);
  assert.deepEqual(await s.backupStore.put(1, rev1Digest, rev1Bytes), ack1);
  assert.ok(db.backups.get(key1).bytes.equals(storedBefore));

  assert.deepEqual(await s.backupStore.list(), [ack0, ack1]);
  await s.retire();

  // Restart: a second instance over a new session sees the manifest.
  const second = makeStores(db);
  assert.deepEqual(await second.backupStore.list(), [ack0, ack1]);
  await second.retire();
});

test('backup put refuses foreign documents, mismatched coordinates and identity encryption', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  // The document binds a different household.
  await assert.rejects(() => s.backupStore.put(0, stateOf(genesisBytesB).digest, genesisBytesB), /contract validation/);
  // The supplied digest does not match the document.
  await assert.rejects(() => s.backupStore.put(0, DIGEST_1, genesisBytes), /do not match/);
  // The supplied revision does not match the document.
  await assert.rejects(() => s.backupStore.put(1, genesisDigest, genesisBytes), /do not match/);
  // Non-document bytes.
  await assert.rejects(() => s.backupStore.put(0, genesisDigest, Buffer.from('hello')), /contract validation/);
  assert.equal(db.backups.size, 0); // nothing was stored

  // An identity "encryption" function is refused before storage.
  const identity = makeStores(db, { encrypt: async b => Buffer.from(b) });
  await assert.rejects(() => identity.backupStore.put(0, genesisDigest, genesisBytes), /equals the plaintext/);
  assert.equal(db.backups.size, 0);
  await identity.retire();
  await s.retire();
});

test('backup list fails closed on corrupted ciphertext or a foreign row in scope', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  await s.backupStore.put(0, genesisDigest, genesisBytes);
  const row = db.backups.get(SCOPE + '|0|' + genesisDigest);
  const goodBytes = Buffer.from(row.bytes);
  const goodIntegrity = row.integrity;

  row.bytes = Buffer.from('tampered ciphertext');
  await assert.rejects(() => s.backupStore.list(), /integrity/);
  row.bytes = Buffer.from('x');
  row.integrity = 'f'.repeat(64);
  await assert.rejects(() => s.backupStore.list(), /integrity/);

  // Restore the good row, then add a row in this scope binding a
  // foreign household: the whole manifest refuses — an unverifiable
  // manifest licenses nothing.
  row.bytes = goodBytes;
  row.integrity = goodIntegrity;
  db.backups.set(SCOPE + '|7|' + DIGEST_1, {
    scope: SCOPE, household: C.digest({ householdId: HOUSEHOLD_B }),
    revision: '7', digest: DIGEST_1, bytes: Buffer.from('zz'),
    integrity: 'f'.repeat(64),
  });
  await assert.rejects(() => s.backupStore.list(), /household/);
  await s.retire();
});

test('backup get deliberately refuses: no owner-held decryption key exists on the server', async () => {
  const db = createFakeDatabase();
  const s = makeStores(db);
  await s.backupStore.put(0, genesisDigest, genesisBytes);
  await assert.rejects(() => s.backupStore.get(0, genesisDigest), /recovery unavailable/);
  await s.retire();
});

test('session loss is permanent and retire fences every later operation', async () => {
  const db = createFakeDatabase();
  const clients = [];
  const Base = fakeClientClass(db);
  const Tracking = class extends Base {
    constructor(config) { super(config); clients.push(this); }
  };
  const s = makeStores(db, { Client: Tracking });
  assert.equal(await s.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 }), true);

  // A rejected query loses the session permanently.
  db.failNext = new Error('synthetic transport failure');
  await assert.rejects(() => s.pinStore.read(), /permanently invalid/);
  await assert.rejects(() => s.pinStore.read(), /permanently invalid/);
  await assert.rejects(() => s.backupStore.list(), /permanently invalid/);
  await s.retire();

  // A session 'error' event loses the stores the same way.
  const s2 = makeStores(db, { Client: Tracking });
  assert.deepEqual(await s2.pinStore.read(), { revision: 0, digest: DIGEST_0, timestamp: 10 });
  clients[clients.length - 1].emit('error');
  await assert.rejects(() => s2.pinStore.read(), /permanently invalid/);
  await s2.retire();

  // retire() is an idempotent hard fence over an otherwise healthy instance.
  const s3 = makeStores(db);
  assert.deepEqual(await s3.pinStore.read(), { revision: 0, digest: DIGEST_0, timestamp: 10 });
  assert.deepEqual(await s3.retire(), { state: 'retired' });
  assert.deepEqual(await s3.retire(), { state: 'retired' });
  await assert.rejects(() => s3.pinStore.read(), /retired/);
  await assert.rejects(() => s3.backupStore.put(0, genesisDigest, genesisBytes), /retired/);
});

test('household scoping: another household or scope never reads this custody', async () => {
  const db = createFakeDatabase();
  const mine = makeStores(db);
  await mine.pinStore.advance(null, { revision: 0, digest: DIGEST_0, timestamp: 10 });
  await mine.backupStore.put(0, genesisDigest, genesisBytes);
  await mine.retire();

  // Different scope: complete invisibility (proven absence).
  const otherScope = makeStores(db, { scope: 'other-scope' });
  assert.equal(await otherScope.pinStore.read(), null);
  assert.deepEqual(await otherScope.backupStore.list(), []);
  await otherScope.retire();

  // Same scope, different household: the stored state is foreign, so
  // reads fail closed rather than leaking or reporting absence.
  const foreign = makeStores(db, { householdId: HOUSEHOLD_B });
  await assert.rejects(() => foreign.pinStore.read(), /failed validation/);
  await assert.rejects(() => foreign.backupStore.list(), /household/);
  await foreign.retire();
});

// ------------------------------------------------------- store journey -----
// The store's document tier is a staged-write surface and its journal
// tier a plain record surface (the shipped store suite's double shapes).
function documentTier() {
  const durable = { doc: null, temp: null };
  return {
    async read() { return durable.doc ? Buffer.from(durable.doc) : null; },
    async readStaged() { return durable.temp ? Buffer.from(durable.temp) : null; },
    async writeTemp(bytes) { durable.temp = Buffer.from(bytes); },
    async commitTemp() { durable.doc = durable.temp; durable.temp = null; },
    async discardTemp() { durable.temp = null; },
  };
}
function journalTier() {
  let buffer = null;
  return {
    async read() { return buffer === null ? null : Buffer.from(buffer); },
    // The journal surface writes a RECORD; the tier owns serialization.
    async write(record) { buffer = Buffer.from(JSON.stringify(record)); },
    async clear() { buffer = null; },
  };
}
function ticker(start) {
  let n = start;
  return () => { n += 1; return n; };
}
function buildStore(stores, now) {
  let tail = Promise.resolve();
  return createSettlementEvidenceStore({
    householdId: HOUSEHOLD,
    documentStore: documentTier(),
    journalStore: journalTier(),
    pinStore: stores.pinStore,
    backupStore: stores.backupStore,
    quarantine: { put: async () => {} },
    lock: {
      withLock(fn) {
        const run = tail.then(fn, fn);
        tail = run.then(() => {}, () => {});
        return run;
      },
    },
    now,
  });
}

test('the real evidence store bootstraps and commits over the durable stores; a restarted store still sees the custody', async () => {
  const db = createFakeDatabase();
  const first = makeStores(db);
  const store1 = buildStore(first, ticker(5000));
  assert.deepEqual(await store1.bootstrap(), { status: 'bootstrapped', revision: 0, digest: genesisDigest });

  const evidence = {
    accountId: 'acct-main', currency: 'cad', direction: 'debit',
    date: '2026-10-03', cents: 6000, posted: true,
  };
  const command = {
    version: 1, kind: 'link', goalId: 'commitment:near', txRef: tx(1),
    evidence, evidenceDigest: C.digest(evidence), assignedCents: 2500,
    asOf: '2026-10-04',
  };
  const prepared = await store1.prepare({ actorId, operationId: op(1), command });
  assert.ok(prepared.preview, 'prepare returns a contract preview');
  const receipt = await store1.commit({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(receipt.status, 'committed');
  assert.equal(receipt.revision, 1);
  const committedDigest = receipt.digest;
  await first.retire();

  // Restart: the custody survived in the database, so a fresh store
  // over fresh sessions — and even over fresh (empty) document and
  // journal tiers — observes the durable pin and backup custody, and
  // can never re-bootstrap over it.
  const second = makeStores(db);
  const pin = await second.pinStore.read();
  assert.equal(pin.revision, 1);
  assert.equal(pin.digest, committedDigest);
  assert.ok(Number.isSafeInteger(pin.timestamp) && pin.timestamp > 5000);
  assert.deepEqual((await second.backupStore.list()).map(e => e.revision), [0, 1]);
  const store2 = buildStore(second, ticker(9000));
  assert.deepEqual(await store2.bootstrap(), { status: 'rejected', reason: 'already-bootstrapped' });
  // The pin proves custody survived; the (empty) document tier stays
  // honestly unavailable rather than unbootstrapped or invented.
  assert.deepEqual(await store2.prepare({ actorId, operationId: op(2), command }),
    { status: 'unavailable', reason: 'document-unavailable' });
  await second.retire();
});
