'use strict';
// Plan #5 slice P1: production authorization & context owners (preparatory).
// Pins the corrected contracts of issue #765 (dispatch 6476800429 as
// re-pinned by 6476923443, accepting Atlas's scope objection 6476845815):
//   - authorize is SYNCHRONOUS, receives only {actorId}, never consults the
//     asynchronous authorization-state API, caches nothing;
//   - authorizeRecovery is the PRELIMINARY controller policy only — the
//     final fresh recovery decision stays in server.js's
//     createRecoveryFinalAuthority and is NOT re-implemented here;
//   - contextReader returns exactly {canonical, env, domain,
//     contextRevision}; its trusted owner advances the revision on every
//     contents change, including ABA returns;
//   - custody composes the existing evidence/anchor stores behind their
//     existing adapter/transport interfaces over the synthetic transport.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const util = require('node:util');
const Owners = require('../scripts/settlement-production-owners');
const { createAuthorizationStore } = require('../scripts/settlement-evidence-authorization-store');
const { createSettlementEvidenceStore } = require('../scripts/settlement-evidence-store');
const C = require('../scripts/planned-obligation-settlement-contract');
const TC = require('../scripts/settlement-evidence-terminal-certificate');

const householdId = 'household-' + 'a'.repeat(32);
const otherHousehold = 'household-' + 'f'.repeat(32);
const sid = 'b'.repeat(64);
const actorId = 'session-' + sid;
const sidDigest = crypto.createHash('sha256').update(sid).digest('hex');
const operationId = 'operation-' + '1'.repeat(32);
const generation = 'generation-' + '2'.repeat(32);
const confirmationDigest = 'c'.repeat(64);
const secretDigest = 'd'.repeat(64);
const domain = {
  ledgerNamespace: 'ledger-' + 'e'.repeat(32),
  serializationAuthority: 'authority-' + '1'.repeat(32),
  historyAuthority: 'authority-' + '2'.repeat(32),
};
const clone = x => structuredClone(x);
const syntheticPassword = 'synthetic-owners-password';
const syntheticSecret = 'synthetic-owners-session-secret';

// A synthetic dedicated session implementing exactly the authorization
// store's SQL surface in memory (the composition suite's model).
function fakeSession() {
  const eligibility = new Map(), revoked = new Set(), sessions = new Set();
  const key = (op, gen) => op + '|' + gen;
  const s = {
    stateReads: 0, queries: [],
    async query(text, values = []) {
      s.queries.push(text);
      const result = (rows = [], rowCount = rows.length) =>
        ({ command: text.split(' ')[0], rows, rowCount });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return result();
      if (text.startsWith('SELECT e.household_id')) {
        s.stateReads++;
        const e = eligibility.get(key(values[1], values[2]));
        return result([e
          ? { household_id: e.householdId, operation_id: e.operationId, generation: e.generation,
              confirmation_digest: e.confirmationDigest, secret_digest: e.secretDigest,
              issued_at: String(e.issuedAt),
              operation_revoked: revoked.has(key(values[1], values[2])),
              session_revoked: sessions.has(values[3]) }
          : { household_id: null, operation_id: null, generation: null, confirmation_digest: null,
              secret_digest: null, issued_at: null,
              operation_revoked: revoked.has(key(values[1], values[2])),
              session_revoked: sessions.has(values[3]) }]);
      }
      if (text.startsWith('SELECT scope, household_id')) {
        const e = eligibility.get(key(values[1], values[2]));
        return result(e ? [{ scope: values[0], household_id: e.householdId, operation_id: e.operationId,
          generation: e.generation, confirmation_digest: e.confirmationDigest,
          secret_digest: e.secretDigest, issued_at: String(e.issuedAt) }] : []);
      }
      if (text.startsWith('SELECT revoked_at')) {
        const has = text.includes('auth_session_revocation')
          ? sessions.has(values[1]) : revoked.has(key(values[1], values[2]));
        return result(has ? [{ revoked_at: '1' }] : []);
      }
      if (text.startsWith('INSERT INTO')) {
        if (text.includes('auth_eligibility')) eligibility.set(key(values[2], values[3]), {
          householdId: values[1], operationId: values[2], generation: values[3],
          confirmationDigest: values[4], secretDigest: values[5], issuedAt: values[6] });
        else if (text.includes('auth_session_revocation')) sessions.add(values[1]);
        else revoked.add(key(values[1], values[2]));
        return result([], 1);
      }
      throw new Error('unmodelled synthetic SQL');
    },
    on() {},
    async retire() {},
  };
  return s;
}

function realStore() {
  const session = fakeSession();
  const store = createAuthorizationStore({ session, schema: 'synthetic_authorization', scope: 'synthetic-scope' });
  return { session, store };
}

const baseContext = () => ({
  domain: 'synthetic-household-authority',
  canonical: { plan: { period: '2026-10' }, marker: 'A' },
  env: { SITE_PASSWORD: syntheticPassword, SESSION_SECRET: syntheticSecret },
});

function owners(store) {
  return Owners.createSettlementProductionOwners({
    householdId, authorizationStore: store, context: baseContext(),
  });
}

async function issued(store) {
  const outcome = await store.issueEligibility({
    householdId, operationId, generation, confirmationDigest, secretDigest, issuedAt: 1000,
  });
  assert.equal(outcome.outcome, 'issued');
}

// ---------------------------------------------------------------- authorize

test('P1 authorize is synchronous and admits a session-layer actor for the configured household', () => {
  const { store } = realStore();
  const o = owners(store);
  assert.equal(util.types.isAsyncFunction(o.authorize), false);
  const out = o.authorize({ actorId });
  assert.equal(util.types.isPromise(out), false);
  assert.deepEqual(out, { householdId, actorId });
  assert.ok(Object.isFrozen(out));
  // The composition passes a frozen input; that must work too.
  assert.deepEqual(o.authorize(Object.freeze({ actorId })), { householdId, actorId });
});

test('P1 authorize refuses malformed or broadened input and never consults the store', () => {
  let reads = 0, getterCalls = 0;
  const countingStore = { readAuthorizationState() { reads++; throw new Error('must not be called'); } };
  const o = Owners.createSettlementProductionOwners({
    householdId, authorizationStore: countingStore, context: baseContext(),
  });
  const bad = [
    {}, { actorId: '' }, { actorId: 'session-' + 'B'.repeat(64) },
    { actorId: 'session-' + 'b'.repeat(63) }, { actorId: 'session-' + 'b'.repeat(65) },
    { actorId: 'user-' + 'b'.repeat(64) }, { actorId, extra: true },
    { actorId: 42 }, { actorId: null }, null, undefined, actorId, [actorId],
  ];
  for (const input of bad) assert.throws(() => o.authorize(input), /refused|invalid|malformed/i, JSON.stringify(input));
  const evil = {};
  Object.defineProperty(evil, 'actorId', { enumerable: true, get() { getterCalls++; return actorId; } });
  assert.throws(() => o.authorize(evil));
  assert.equal(getterCalls, 0, 'input getters are never invoked');
  assert.equal(reads, 0, 'authorize performs no authorization-state read');
});

test('P1 authorize is reproducible and cache-free; revocation judgement is not this seam', async () => {
  const { store } = realStore();
  const o = owners(store);
  const before = o.authorize({ actorId });
  await issued(store);
  await store.appendRevocation({ operationId, generation, revokedAt: 2000 });
  // The synchronous {actorId}-only policy cannot see store state and must
  // not pretend to: its answer is a pure function of its input. Eligibility
  // and revocation are judged by the store-backed seams (issuance, the
  // preliminary recovery policy below, and the final authority in
  // server.js) — never by a cached or smuggled grant here.
  assert.deepEqual(o.authorize({ actorId }), before);
});

// --------------------------------------------------------- authorizeRecovery

test('P1 authorizeRecovery admits a named operation with live eligibility and no revocation', async () => {
  const { session, store } = realStore();
  const o = owners(store);
  await issued(store);
  const grant = await o.authorizeRecovery({ householdId, actorId, operationId, generation });
  // Exactly the controller's accepted grant shape: no generation, no
  // digests, no expiry — the preliminary policy asserts none of those.
  assert.deepEqual(grant, { householdId, actorId, operationId });
  assert.ok(Object.isFrozen(grant));
  assert.equal(session.stateReads, 1, 'one fresh state read per decision');
});

test('P1 authorizeRecovery refuses a decision sought after a completed operation revocation', async () => {
  const { store } = realStore();
  const o = owners(store);
  await issued(store);
  await store.appendRevocation({ operationId, generation, revokedAt: 2000 });
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation }), /refused/i);
});

test('P1 authorizeRecovery refuses after a completed session revocation', async () => {
  const { store } = realStore();
  const o = owners(store);
  await issued(store);
  await store.appendSessionRevocation({ sidDigest, revokedAt: 2000 });
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation }), /refused/i);
});

test('P1 authorizeRecovery re-reads every time: admitted, then revoked, then refused — nothing cached or replayed', async () => {
  const { session, store } = realStore();
  const o = owners(store);
  await issued(store);
  await o.authorizeRecovery({ householdId, actorId, operationId, generation });
  await store.appendRevocation({ operationId, generation, revokedAt: 2000 });
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation }), /refused/i);
  assert.equal(session.stateReads, 2, 'each decision is a fresh read');
});

test('P1 authorizeRecovery refuses missing eligibility, household mismatch, malformed ids and unknown state', async () => {
  const { store } = realStore();
  const o = owners(store);
  // No eligibility issued at all.
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation }), /refused/i);
  await issued(store);
  await assert.rejects(o.authorizeRecovery({ householdId: otherHousehold, actorId, operationId, generation }), /refused/i);
  await assert.rejects(o.authorizeRecovery({ householdId, actorId: 'session-' + 'z'.repeat(64), operationId, generation }), /refused/i);
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId: 'op-1', generation }), /refused/i);
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation: 'gen-1' }), /refused/i);
  await assert.rejects(o.authorizeRecovery({ householdId, actorId, operationId, generation, extra: 1 }), /refused/i);
  // Unknown store state (store retired) refuses, never admits on doubt.
  const dead = realStore();
  const o2 = owners(dead.store);
  await issued(dead.store);
  await dead.store.retire();
  await assert.rejects(o2.authorizeRecovery({ householdId, actorId, operationId, generation }), /refused/i);
});

test('P1 authorizeRecovery generation-less admission is preliminary and shape-only (no state read is keyable)', async () => {
  const { session, store } = realStore();
  const o = owners(store);
  const grant = await o.authorizeRecovery({ householdId, actorId, operationId });
  assert.deepEqual(grant, { householdId, actorId, operationId });
  assert.equal(session.stateReads, 0);
  await assert.rejects(o.authorizeRecovery({ householdId: otherHousehold, actorId, operationId }), /refused/i);
});

test('P1 authorizeRecovery performs no final-authority judgement (digests and expiry stay with server.js)', async () => {
  const { store } = realStore();
  const o = owners(store);
  await issued(store);
  // The preliminary policy takes no confirmation/secret digest and no
  // expiry; matching those against the acquired view is exclusively
  // createRecoveryFinalAuthority's job. Admission here must therefore not
  // depend on any digest value.
  const grant = await o.authorizeRecovery({ householdId, actorId, operationId, generation });
  assert.deepEqual(Object.keys(grant).sort(), ['actorId', 'householdId', 'operationId']);
});

// -------------------------------------------------------------- contextReader

test('P1 contextReader returns the exact composition shape with defensive copies', () => {
  const { store } = realStore();
  const context = baseContext();
  const o = Owners.createSettlementProductionOwners({ householdId, authorizationStore: store, context });
  const first = o.contextReader();
  assert.deepEqual(Object.keys(first).sort(), ['canonical', 'contextRevision', 'domain', 'env']);
  assert.equal(first.domain, 'synthetic-household-authority');
  assert.equal(first.contextRevision, 1);
  assert.deepEqual(first.canonical, context.canonical);
  assert.deepEqual(first.env, context.env);
  // Mutating a returned snapshot cannot reach the owner's state (the
  // snapshot's env is frozen, so assignment may throw — either way the
  // owner's next read must be untouched).
  try { first.canonical.marker = 'HACKED'; } catch { /* frozen */ }
  const hacked = 'HACKED';
  try { first.env.SITE_PASSWORD = hacked; } catch { /* frozen */ }
  const second = o.contextReader();
  assert.equal(second.canonical.marker, 'A');
  assert.equal(second.env.SITE_PASSWORD, syntheticPassword);
  // Mutating the construction input after the fact cannot either.
  context.canonical.marker = 'HACKED';
  assert.equal(o.contextReader().canonical.marker, 'A');
  assert.equal(o.contextReader.length, 0, 'reader takes no arguments');
});

test('P1 context owner advances the revision on every contents change, including ABA returns', () => {
  const { store } = realStore();
  const o = owners(store);
  const a = baseContext(), b = { canonical: { plan: { period: '2026-11' }, marker: 'B' }, env: { ...a.env } };
  assert.equal(o.contextReader().contextRevision, 1);
  assert.equal(o.advanceContext(b), 2);
  assert.equal(o.contextReader().canonical.marker, 'B');
  // ABA: returning to the original contents is still a change the
  // composition must see — the revision advances, never reuses 1.
  assert.equal(o.advanceContext({ canonical: clone(a.canonical), env: { ...a.env } }), 3);
  assert.equal(o.contextReader().contextRevision, 3);
  // An advance with identical contents changes nothing.
  assert.equal(o.advanceContext({ canonical: clone(a.canonical), env: { ...a.env } }), 3);
  assert.equal(o.contextReader().contextRevision, 3);
});

test('P1 context validation refuses bad shapes at construction and at advance', () => {
  const { store } = realStore();
  const badContexts = [
    { domain: '', canonical: {}, env: {} },
    { domain: 'x'.repeat(129), canonical: {}, env: {} },
    { domain: 'ok', canonical: [], env: {} },
    { domain: 'ok', canonical: null, env: {} },
    { domain: 'ok', canonical: {}, env: { SITE_PASSWORD: 42 } },
    { domain: 'ok', canonical: {}, env: null },
  ];
  for (const context of badContexts) {
    assert.throws(() => Owners.createSettlementProductionOwners({ householdId, authorizationStore: store, context }),
      /invalid|malformed/i);
  }
  const o = owners(store);
  assert.throws(() => o.advanceContext({ canonical: {}, env: { A: 1 } }), /invalid|malformed/i);
  assert.throws(() => o.advanceContext({ canonical: {} }), /invalid|malformed/i);
  assert.equal(o.contextReader().contextRevision, 1, 'a refused advance leaves the context untouched');
});

// ------------------------------------------------------------------- custody

test('P1 custody composes the anchor store over the synthetic transport with conditional-write discipline', async () => {
  const custody = Owners.createSettlementProductionCustody({
    householdId, exclusionDomain: domain, now: () => 5000,
    prefix: 'anchor-test', schema: 'settlement_evidence',
  });
  assert.deepEqual(Object.keys(custody).sort(),
    ['anchorStore', 'backupStore', 'exclusionDomain', 'pinStore', 'terminalHistory', 'transport']);
  // The anchor store is really composed: genesis + readback round-trip.
  const incarnation = '9'.repeat(64);
  await custody.anchorStore.genesisPin(householdId, { incarnation, digest: confirmationDigest, timestamp: 1000 });
  const pin = await custody.anchorStore.readPin(householdId);
  assert.equal(pin.incarnation, incarnation);
  assert.deepEqual(pin.pin, { revision: 0, digest: confirmationDigest, timestamp: 1000 });
  // The transport enforces absent-only create with a definite conflict.
  await custody.transport.create('probe/key', Buffer.from('x'), {});
  await assert.rejects(custody.transport.create('probe/key', Buffer.from('y'), {}),
    e => e && e.code === 'conflict');
  // A supplied production-shaped transport binds through the same surface:
  // the factory takes the transport as an input, never reaches for one.
  const again = Owners.createSettlementProductionCustody({
    householdId, exclusionDomain: domain, now: () => 5000,
    prefix: 'anchor-test', schema: 'settlement_evidence', transport: custody.transport,
  });
  assert.equal((await again.anchorStore.readPin(householdId)).incarnation, incarnation);
});

test('P1 custody adapters satisfy the real evidence store end to end (prepare/commit/outcome)', async () => {
  const custody = Owners.createSettlementProductionCustody({
    householdId, exclusionDomain: domain, now: () => 5000,
    prefix: 'anchor-test', schema: 'settlement_evidence',
  });
  // Financial-side doubles (the Postgres adapter's job at host time):
  // only custody's own adapters are under test here.
  const genesis = C.adopt({ householdId });
  const genesisState = JSON.parse(genesis);
  let doc = Buffer.from(genesis), temp = null, journal = null;
  const documentStore = {
    async read() { return doc && Buffer.from(doc); },
    async readStaged() { return temp && Buffer.from(temp); },
    async writeTemp(b) { temp = Buffer.from(b); },
    async commitTemp() { doc = temp; temp = null; },
    async discardTemp() { temp = null; },
  };
  const journalStore = {
    async read() { return journal && Buffer.from(journal); },
    async write(v) { journal = Buffer.from(JSON.stringify(v)); },
    async clear() { journal = null; },
  };
  let tail = Promise.resolve();
  const lock = { withLock(fn) { const r = tail.then(fn, fn); tail = r.catch(() => {}); return r; } };
  // Seed the pin through the custody adapter's own CAS-from-absent path.
  assert.equal(await custody.pinStore.advance(null,
    { revision: 0, digest: genesisState.digest, timestamp: 1 }), true);
  assert.equal(await custody.pinStore.advance(null,
    { revision: 0, digest: genesisState.digest, timestamp: 1 }), false, 'CAS refuses a second genesis');
  const store = createSettlementEvidenceStore({
    householdId, documentStore, journalStore,
    pinStore: custody.pinStore, backupStore: custody.backupStore,
    quarantine: { async put() {} }, lock, now: () => Date.parse('2026-10-20T12:00:00Z'),
    exclusionDomain: custody.exclusionDomain, terminalHistory: custody.terminalHistory,
  });
  // The terminal-history snapshot qualifies against the registered domain.
  const registered = TC.registerDomain(householdId, custody.exclusionDomain, true, []);
  const snapshot = await custody.terminalHistory.readSnapshot();
  const qualified = TC.qualifySnapshot(snapshot, registered);
  assert.equal(qualified.history.records.length, 0);
  // A full prepare/commit cycle lands through the custody adapters.
  const command = {
    version: 1, kind: 'link', goalId: 'commitment:synthetic-trip',
    txRef: 'tx-' + '1'.repeat(32),
    evidence: { accountId: 'synthetic-cash', currency: 'cad', direction: 'debit',
      date: '2026-10-19', cents: 6000, posted: true },
    assignedCents: 2500, asOf: '2026-10-20',
  };
  command.evidenceDigest = C.digest(command.evidence);
  const prepared = await store.prepare({ actorId, operationId, command });
  assert.ok(prepared.preview && prepared.confirmationDigest, 'prepare returns a preview + confirmation digest');
  const committed = await store.commitWithoutRecovery({
    actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
  });
  assert.equal(committed.status, 'committed');
  assert.equal(JSON.parse(doc.toString('utf8')).revision, 1);
  assert.equal((await store.outcome({ actorId, operationId })).status, 'committed');
  // Backup custody really holds the genesis + revision-1 artifacts.
  const listed = await custody.backupStore.list();
  assert.ok(listed.some(e => e.revision === 1));
});

// ------------------------------------------------------------- factory shape

test('P1 factories refuse incomplete composition inputs', () => {
  const { store } = realStore();
  assert.throws(() => Owners.createSettlementProductionOwners({ authorizationStore: store, context: baseContext() }), /invalid|malformed/i);
  assert.throws(() => Owners.createSettlementProductionOwners({ householdId: 'nope', authorizationStore: store, context: baseContext() }), /invalid|malformed/i);
  assert.throws(() => Owners.createSettlementProductionOwners({ householdId, authorizationStore: {}, context: baseContext() }), /invalid|malformed/i);
  assert.throws(() => Owners.createSettlementProductionOwners({ householdId, authorizationStore: store }), /invalid|malformed/i);
  assert.throws(() => Owners.createSettlementProductionCustody({ householdId, now: () => 1 }), /invalid|malformed/i);
  assert.throws(() => Owners.createSettlementProductionCustody({
    householdId, exclusionDomain: { ledgerNamespace: 'bad' }, now: () => 1,
  }), /invalid|malformed/i);
});
