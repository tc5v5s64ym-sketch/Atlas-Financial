'use strict';
// Settlement evidence authorization-state store (ATLAS-080, B4) —
// INJECTED-SESSION tests only.
//
// The store runs parameterized SQL through an injected dedicated
// session. Here that session is an in-process, SQL-interpreting FAKE
// over in-memory tables with scripted faults (rejection, malformed
// envelopes, duplicate/garbage rows, wrong COMMIT tag, lost COMMIT
// acknowledgement landed/absent, session end/error, gated statements).
// It is NOT PostgreSQL: nothing here qualifies real SQL semantics, real
// durability, real concurrency, two-connection ordering, TLS, pooling,
// or any provider. Doubles qualify the protocol only.
//
// Tests first: against unmodified main this suite fails to load (the
// authorization-store module does not exist).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const A = require(path.join(ROOT, 'scripts/settlement-evidence-authorization-store'));

// Diagnostic canary capture for the whole suite: the module must never
// log, and no console output may carry driver text or fixture digests.
const consoleOutputs = [];
const realConsole = {};
for (const m of ['log', 'error', 'warn', 'info']) {
  realConsole[m] = console[m];
  console[m] = (...args) => { consoleOutputs.push(args.map(String).join(' ')); };
}

const SCHEMA = 'atlas_auth_synthetic';
const SCOPE_A = 'b4-auth-a';
const SCOPE_B = 'b4-auth-b';
const D = s => crypto.createHash('sha256').update('synthetic:' + s).digest('hex');
const householdId = 'household-' + 'a'.repeat(32);
const household2 = 'household-' + 'b'.repeat(32);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const gen = n => 'generation-' + n.toString(16).padStart(32, '0');
let T = 1_760_000_000_000;
const tick = () => (T += 7);
const eq = (a, b) => assert.deepStrictEqual(a, b);

function eligibility(over = {}) {
  return {
    householdId, operationId: op(1), generation: gen(1),
    confirmationDigest: D('confirmation-1'), secretDigest: D('secret-1'),
    issuedAt: tick(), ...over,
  };
}

// --- Fake sessions (SQL-interpreting, in-process; NOT PostgreSQL) -----
// One fake DATABASE (the durable tables) behind any number of fake
// SESSIONS (dedicated connections): two sessions over one database
// model two exclusively owned connections to the same PostgreSQL
// database, which is what makes the scope-isolation test prove scope
// KEYING rather than session separation.
function createFakeDatabase() {
  return {
    tables: {
      auth_eligibility: new Map(),
      auth_revocation: new Map(),
      auth_session_revocation: new Map(),
    },
  };
}
function createFakeSession(db = createFakeDatabase()) {
  const tables = db.tables;
  const listeners = { error: [], end: [] };
  const log = [];
  const faults = [];
  const hooks = [];
  let alive = true;
  let inTxn = false;
  let staged = null;
  let retiredCount = 0;
  const key3 = (s, a, b) => s + '\0' + a + '\0' + b;
  const key2 = (s, a) => s + '\0' + a;
  const view = name => {
    const merged = new Map(tables[name]);
    if (staged) for (const [k, v] of staged[name]) merged.set(k, v);
    return merged;
  };
  const DRIVER = 'FAKE-DRIVER-TEXT: ';

  function dispatch(text, values) {
    const tag = text.split(' ')[0];
    const ok = (rows = [], rowCount = rows.length) => ({ command: tag, rows, rowCount });
    if (text === 'BEGIN') {
      assert.ok(!inTxn, 'BEGIN inside an open transaction (interleaved units)');
      inTxn = true;
      staged = { auth_eligibility: new Map(), auth_revocation: new Map(), auth_session_revocation: new Map() };
      return ok();
    }
    if (text === 'COMMIT') {
      assert.ok(inTxn, 'COMMIT outside a transaction');
      for (const name of Object.keys(tables)) for (const [k, v] of staged[name]) tables[name].set(k, v);
      staged = null; inTxn = false;
      return ok();
    }
    if (text === 'ROLLBACK') {
      assert.ok(inTxn, 'ROLLBACK outside a transaction');
      staged = null; inTxn = false;
      return ok();
    }
    if (text.startsWith('INSERT INTO')) {
      const rel = /auth_(eligibility|revocation|session_revocation)/.exec(text)[1];
      const name = 'auth_' + rel;
      let k, row;
      if (rel === 'eligibility') {
        const [scope, hh, o, g, cd, sd, at] = values;
        k = key3(scope, o, g);
        row = { scope, household_id: hh, operation_id: o, generation: g, confirmation_digest: cd, secret_digest: sd, issued_at: at };
      } else if (rel === 'revocation') {
        const [scope, o, g, at] = values;
        k = key3(scope, o, g);
        row = { scope, operation_id: o, generation: g, revoked_at: at };
      } else {
        const [scope, sd, at] = values;
        k = key2(scope, sd);
        row = { scope, sid_digest: sd, revoked_at: at };
      }
      if (view(name).has(k)) throw new Error(DRIVER + 'duplicate key value violates unique constraint');
      (inTxn ? staged[name] : tables[name]).set(k, row);
      return ok([], 1);
    }
    if (text.includes('LEFT JOIN')) {
      const [scope, o, g, sid] = values;
      const e = view('auth_eligibility').get(key3(scope, o, g));
      const r = view('auth_revocation').get(key3(scope, o, g));
      const s = view('auth_session_revocation').get(key2(scope, sid));
      return ok([{
        household_id: e ? e.household_id : null,
        operation_id: e ? e.operation_id : null,
        generation: e ? e.generation : null,
        confirmation_digest: e ? e.confirmation_digest : null,
        secret_digest: e ? e.secret_digest : null,
        issued_at: e ? (fake.int8AsString ? String(e.issued_at) : e.issued_at) : null,
        operation_revoked: !!r,
        session_revoked: !!s,
      }], 1);
    }
    if (text.startsWith('SELECT')) {
      const rel = /auth_(eligibility|revocation|session_revocation)/.exec(text)[1];
      const name = 'auth_' + rel;
      const row = rel === 'session_revocation'
        ? view(name).get(key2(values[0], values[1]))
        : view(name).get(key3(values[0], values[1], values[2]));
      return ok(row ? [{ ...row }] : []);
    }
    assert.fail('unexpected SQL: ' + text);
  }

  const fake = {
    tables, log, int8AsString: false,
    get retiredCount() { return retiredCount; },
    get alive() { return alive; },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev) { for (const fn of listeners[ev] || []) fn(new Error(DRIVER + 'session ' + ev)); },
    // retire() ends admission for NEW queries; a query already admitted
    // (e.g. gated mid-flight) still completes through dispatch, which is
    // what lets AS-10 prove the store's publication fence.
    retire() { retiredCount++; alive = false; },
    kill() { alive = false; inTxn = false; staged = null; fake.emit('end'); },
    faultOnce(match, mode) { faults.push({ match, mode }); },
    hookOnce(match, fn) { hooks.push({ match, fn }); },
    async query(text, values) {
      assert.equal(typeof text, 'string');
      assert.ok(Array.isArray(values), 'values must always be an array (parameterized)');
      for (const v of values) {
        if (typeof v === 'string' && v.length >= 8) {
          assert.ok(!text.includes(v), 'a value was interpolated into SQL text');
        }
      }
      log.push({ text, values: values.slice() });
      const admitted = alive;
      const hi = hooks.findIndex(h => h.match(text, values));
      if (hi >= 0) { const h = hooks.splice(hi, 1)[0]; await h.fn(); }
      if (!admitted) throw new Error(DRIVER + 'connection terminated');
      const fi = faults.findIndex(f => f.match(text, values));
      const mode = fi < 0 ? null : faults.splice(fi, 1)[0].mode;
      if (mode === 'reject') throw new Error(DRIVER + 'statement failed');
      if (mode === 'drop') { fake.kill(); throw new Error(DRIVER + 'connection terminated'); }
      if (mode === 'malformed-envelope') return { rows: 'not-an-array' };
      if (mode === 'lost-ack-landed' || mode === 'lost-ack-absent') {
        assert.equal(text, 'COMMIT', 'lost-ack faults target COMMIT');
        if (mode === 'lost-ack-landed') {
          for (const name of Object.keys(tables)) for (const [k, v] of staged[name]) tables[name].set(k, v);
        }
        staged = null; inTxn = false;
        fake.kill();
        throw new Error(DRIVER + 'connection lost at COMMIT acknowledgement');
      }
      if (mode === 'wrong-tag-commit') {
        // PostgreSQL completing an unsuccessful COMMIT as ROLLBACK:
        // staged work is discarded and the tag says so.
        assert.equal(text, 'COMMIT', 'wrong-tag-commit targets COMMIT');
        staged = null; inTxn = false;
        return { command: 'ROLLBACK', rows: [], rowCount: 0 };
      }
      const res = dispatch(text, values);
      if (mode === 'dupe-rows' && res.rows.length === 1) res.rows = [res.rows[0], res.rows[0]];
      if (mode === 'bad-row' && res.rows.length === 1) {
        res.rows = [{ ...res.rows[0], confirmation_digest: 'zz-not-a-digest', secret_digest: 'zz-not-a-digest' }];
      }
      return res;
    },
  };
  return fake;
}

function makeStore(fake, scope = SCOPE_A) {
  return A.createAuthorizationStore({ session: fake, schema: SCHEMA, scope });
}
const verbs = fake => fake.log.map(e => (e.text.includes('LEFT JOIN') ? 'READ' : e.text.split(' ')[0]));
async function waitFor(cond, what) {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise(r => setImmediate(r));
  }
  assert.fail('timed out waiting for ' + what);
}

// --- (1) construction: no I/O, frozen bounded surface -------------------
test('AS-1 construction performs no I/O and exposes exactly the frozen bounded surface', () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  eq(fake.log.length, 0);
  eq(fake.retiredCount, 0);
  eq(Object.keys(store).sort(),
    ['appendRevocation', 'appendSessionRevocation', 'issueEligibility', 'readAuthorizationState', 'retire', 'status']);
  assert.ok(Object.isFrozen(store));
  eq(Object.keys(A).sort(), ['RELATION_CONTRACT', 'createAuthorizationStore']);
  assert.ok(Object.isFrozen(A.RELATION_CONTRACT));
  eq(Object.keys(A.RELATION_CONTRACT.relations).sort(),
    ['auth_eligibility', 'auth_revocation', 'auth_session_revocation']);
  eq(store.status(), { retired: false, accepting: true });
  assert.ok(Object.isFrozen(store.status()));
  // createAuthorizationStore({ session }) alone establishes nothing:
  // schema and scope are required, validated config.
  const bad = [
    () => A.createAuthorizationStore(),
    () => A.createAuthorizationStore(null),
    () => A.createAuthorizationStore({}),
    () => A.createAuthorizationStore({ session: fake }),
    () => A.createAuthorizationStore({ session: fake, schema: SCHEMA }),
    () => A.createAuthorizationStore({ session: { query() {}, on() {} }, schema: SCHEMA, scope: SCOPE_A }),
    () => A.createAuthorizationStore({ session: fake, schema: 'pg_auth', scope: SCOPE_A }),
    () => A.createAuthorizationStore({ session: fake, schema: 'information_schema', scope: SCOPE_A }),
    () => A.createAuthorizationStore({ session: fake, schema: 'Bad Schema', scope: SCOPE_A }),
    () => A.createAuthorizationStore({ session: fake, schema: '', scope: SCOPE_A }),
    () => A.createAuthorizationStore({ session: fake, schema: SCHEMA, scope: '' }),
    () => A.createAuthorizationStore({ session: fake, schema: SCHEMA, scope: '-leading-dash' }),
    () => A.createAuthorizationStore({ session: fake, schema: SCHEMA, scope: 'Has Caps' }),
    () => A.createAuthorizationStore({ session: fake, schema: SCHEMA, scope: 'under_score' }),
  ];
  for (const fn of bad) assert.throws(fn, TypeError);
  eq(fake.log.length, 0);
  // Exclusive session ownership: a second store over the SAME session
  // is refused — there is no shared-session mechanism. (Isolation
  // between scopes is proven in AS-5 over separate sessions.)
  const owned = createFakeSession();
  makeStore(owned);
  assert.throws(() => makeStore(owned, SCOPE_B), TypeError);
  assert.throws(() => A.createAuthorizationStore(
    { session: owned, schema: SCHEMA, scope: SCOPE_A }), TypeError);
});

// --- (2) strict inputs refuse before any session call -------------------
test('AS-2 malformed inputs refuse synchronously with zero session calls', () => {
  const good = eligibility();
  const cases = [
    s => s.issueEligibility(null),
    s => s.issueEligibility([]),
    s => s.issueEligibility({ ...good, extra: 1 }),
    s => s.issueEligibility((() => { const r = { ...good }; delete r.secretDigest; return r; })()),
    s => s.issueEligibility({ ...good, householdId: 'household-xyz' }),
    s => s.issueEligibility({ ...good, operationId: 'op-1' }),
    s => s.issueEligibility({ ...good, generation: 'gen-1' }),
    s => s.issueEligibility({ ...good, confirmationDigest: 'A'.repeat(64) }),
    s => s.issueEligibility({ ...good, confirmationDigest: 'c'.repeat(63) }),
    s => s.issueEligibility({ ...good, secretDigest: 42 }),
    s => s.issueEligibility({ ...good, issuedAt: 0 }),
    s => s.issueEligibility({ ...good, issuedAt: -5 }),
    s => s.issueEligibility({ ...good, issuedAt: 1.5 }),
    s => s.issueEligibility({ ...good, issuedAt: '1760000000000' }),
    s => s.issueEligibility({ ...good, issuedAt: NaN }),
    s => s.appendRevocation({ operationId: op(1), generation: gen(1) }),
    s => s.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: 0 }),
    s => s.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick(), extra: true }),
    s => s.appendSessionRevocation({ sidDigest: 'not-a-digest', revokedAt: tick() }),
    s => s.appendSessionRevocation({ sidDigest: D('sid'), revokedAt: -1 }),
    s => s.readAuthorizationState({ operationId: op(1), generation: gen(1) }),
    s => s.readAuthorizationState({ operationId: op(1), generation: gen(1), sidDigest: 'x'.repeat(64) }),
    s => s.readAuthorizationState({ operationId: op(1), generation: gen(1), sidDigest: D('sid'), extra: 1 }),
  ];
  for (const call of cases) {
    const fake = createFakeSession();
    const store = makeStore(fake);
    assert.throws(() => call(store), TypeError);
    eq(fake.log.length, 0);
    eq(fake.tables.auth_eligibility.size, 0);
  }
});

// --- (2b) call-time snapshot isolation ----------------------------------
test('AS-3 validated inputs are snapshotted at call time, before the queue', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  const record = eligibility();
  const pending = store.issueEligibility(record);
  // Mutate the caller's object synchronously after the call; the queued
  // unit must still persist and compare the ORIGINAL snapshot.
  record.householdId = household2;
  record.confirmationDigest = D('mutated-confirmation');
  record.secretDigest = D('mutated-secret');
  record.issuedAt = tick();
  eq(await pending, { outcome: 'issued' });
  const insert = fake.log.find(e => e.text.startsWith('INSERT'));
  eq(insert.values[1], householdId);
  eq(insert.values[4], D('confirmation-1'));
  eq(insert.values[5], D('secret-1'));
  const read = await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  eq(read.eligibility.householdId, householdId);
  eq(read.eligibility.confirmationDigest, D('confirmation-1'));
});

// --- (3) reissue and conflicts ------------------------------------------
test('AS-4 identical reissue is established by stored-record comparison; any immutable difference refuses as conflict', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  const record = eligibility();
  eq(await store.issueEligibility(record), { outcome: 'issued' });
  // The write path SELECTs the stored record before any INSERT, and no
  // statement anywhere infers identity from conflict suppression.
  const firstInsert = fake.log.findIndex(e => e.text.startsWith('INSERT'));
  const firstSelect = fake.log.findIndex(e => e.text.startsWith('SELECT'));
  assert.ok(firstSelect >= 0 && firstSelect < firstInsert, 'existence SELECT precedes INSERT');
  eq(await store.issueEligibility({ ...record }), { outcome: 'reissued-identical' });
  eq(fake.log.filter(e => e.text.startsWith('INSERT')).length, 1, 'reissue performs no second INSERT');
  for (const vary of [
    { householdId: household2 },
    { confirmationDigest: D('other-confirmation') },
    { secretDigest: D('other-secret') },
    { issuedAt: record.issuedAt + 1 },
  ]) {
    eq(await store.issueEligibility({ ...record, ...vary }),
      { outcome: 'refused', reason: 'conflict' });
  }
  assert.ok(fake.log.every(e => !e.text.includes('ON CONFLICT')), 'no ON CONFLICT inference anywhere');
  const read = await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  eq(read, {
    state: 'ok',
    eligibility: {
      householdId, operationId: op(1), generation: gen(1),
      confirmationDigest: D('confirmation-1'), secretDigest: D('secret-1'), issuedAt: record.issuedAt,
    },
    operationRevoked: false, sessionRevoked: false,
  });
});

// --- (4) scope / generation separation ----------------------------------
test('AS-5 scope and generation separation: two scopes on separate dedicated sessions over one database are fully isolated', async () => {
  const db = createFakeDatabase();
  const a = makeStore(createFakeSession(db), SCOPE_A);
  const b = makeStore(createFakeSession(db), SCOPE_B);
  const readKey = { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') };
  eq(await a.issueEligibility(eligibility()), { outcome: 'issued' });
  eq((await b.readAuthorizationState(readKey)).eligibility, null);
  // The same (operationId, generation) under another scope is an
  // independent record, not a conflict with A's.
  eq(await b.issueEligibility(eligibility({
    householdId: household2, confirmationDigest: D('b-confirmation'), secretDigest: D('b-secret'),
  })), { outcome: 'issued' });
  eq((await a.readAuthorizationState(readKey)).eligibility.confirmationDigest, D('confirmation-1'));
  eq((await b.readAuthorizationState(readKey)).eligibility.confirmationDigest, D('b-confirmation'));
  eq(await a.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick() }),
    { outcome: 'appended' });
  eq((await a.readAuthorizationState(readKey)).operationRevoked, true);
  eq((await b.readAuthorizationState(readKey)).operationRevoked, false);
  eq(await a.appendSessionRevocation({ sidDigest: D('sid-1'), revokedAt: tick() }), { outcome: 'appended' });
  eq((await a.readAuthorizationState(readKey)).sessionRevoked, true);
  eq((await b.readAuthorizationState(readKey)).sessionRevoked, false);
  // Generation separation within one scope.
  eq(await a.issueEligibility(eligibility({ generation: gen(2), confirmationDigest: D('gen2-confirmation') })),
    { outcome: 'issued' });
  const gen2 = await a.readAuthorizationState({ operationId: op(1), generation: gen(2), sidDigest: D('sid-1') });
  eq(gen2.operationRevoked, false);
  eq(gen2.eligibility.confirmationDigest, D('gen2-confirmation'));
  eq(await a.issueEligibility(eligibility({ operationId: op(2) })), { outcome: 'issued' });
  eq((await a.readAuthorizationState({ operationId: op(2), generation: gen(1), sidDigest: D('sid-1') }))
    .operationRevoked, false);
});

// --- (5) revocation appends preserve eligibility -------------------------
test('AS-6 both revocation types append once, report already-present after, and never alter eligibility', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  const record = eligibility();
  eq(await store.issueEligibility(record), { outcome: 'issued' });
  const firstRevokedAt = tick();
  eq(await store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: firstRevokedAt }),
    { outcome: 'appended' });
  eq(await store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: firstRevokedAt }),
    { outcome: 'already-present' });
  eq(await store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick() }),
    { outcome: 'already-present' });
  const storedRevocation = [...fake.tables.auth_revocation.values()][0];
  eq(storedRevocation.revoked_at, firstRevokedAt, 'the first durable revocation record is never overwritten');
  eq(await store.appendSessionRevocation({ sidDigest: D('sid-1'), revokedAt: tick() }), { outcome: 'appended' });
  eq(await store.appendSessionRevocation({ sidDigest: D('sid-1'), revokedAt: tick() }), { outcome: 'already-present' });
  const read = await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  eq(read.eligibility, {
    householdId, operationId: op(1), generation: gen(1),
    confirmationDigest: D('confirmation-1'), secretDigest: D('secret-1'), issuedAt: record.issuedAt,
  });
  eq(read.operationRevoked, true);
  eq(read.sessionRevoked, true);
  // A revocation fact exists independently of any eligibility record.
  eq(await store.appendRevocation({ operationId: op(9), generation: gen(9), revokedAt: tick() }),
    { outcome: 'appended' });
  const orphan = await store.readAuthorizationState(
    { operationId: op(9), generation: gen(9), sidDigest: D('sid-9') });
  eq(orphan.eligibility, null);
  eq(orphan.operationRevoked, true);
});

// --- (6) read: one statement, zero writes, missing distinct from unknown -
test('AS-7 readAuthorizationState is exactly one read-only statement; missing eligibility is a definite ok/null', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  const before = fake.log.length;
  const read = await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  eq(read, { state: 'ok', eligibility: null, operationRevoked: false, sessionRevoked: false });
  eq(fake.log.length - before, 1, 'the read is exactly one statement');
  const text = fake.log[before].text;
  assert.ok(!/INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK/.test(text), 'the read statement performs no write');
  // int8 arrives from node-postgres as a decimal string; the projected
  // record still carries the numeric tick.
  const record = eligibility();
  eq(await store.issueEligibility(record), { outcome: 'issued' });
  fake.int8AsString = true;
  const read2 = await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  eq(read2.eligibility.issuedAt, record.issuedAt);
  // A failed read is unknown, never a definite absence, and retires the
  // session (shipped adapter discipline).
  const fake2 = createFakeSession();
  const store2 = makeStore(fake2);
  fake2.faultOnce(t => t.includes('LEFT JOIN'), 'reject');
  eq(await store2.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') }), { state: 'unknown' });
  eq(store2.status(), { retired: true, accepting: false });
  eq(fake2.retiredCount, 1);
});

// --- (7) whole-transaction queueing --------------------------------------
test('AS-8 every operation serializes as one whole unit on the dedicated session', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  let release;
  const gate = new Promise(r => { release = r; });
  fake.hookOnce(t => t === 'BEGIN', () => gate);
  const p1 = store.issueEligibility(eligibility());
  const p2 = store.issueEligibility(eligibility({ operationId: op(2) }));
  const p3 = store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick() });
  const p4 = store.readAuthorizationState({ operationId: op(1), generation: gen(1), sidDigest: D('sid-1') });
  await waitFor(() => fake.log.length >= 1, 'first BEGIN dispatched');
  eq(fake.log.length, 1, 'no second unit starts while the first transaction is gated');
  release();
  eq(await p1, { outcome: 'issued' });
  eq(await p2, { outcome: 'issued' });
  eq(await p3, { outcome: 'appended' });
  eq((await p4).operationRevoked, true);
  eq(verbs(fake), [
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'READ',
  ]);
});

// --- (8) uncertainty is unknown, never absence or success -----------------
test('AS-9 lost ack, rejected query and malformed results resolve unknown and retire the session', async () => {
  // (a) rejected INSERT
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t.startsWith('INSERT'), 'reject');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(store.status(), { retired: true, accepting: false });
    eq(fake.retiredCount, 1);
    eq(fake.tables.auth_eligibility.size, 0);
  }
  // (b) lost ack, landed: the write DID commit server-side, but the
  // outcome is still unknown — never reported as issued.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t === 'COMMIT', 'lost-ack-landed');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.tables.auth_eligibility.size, 1, 'the write landed; only its acknowledgement was lost');
    eq(fake.retiredCount, 1);
  }
  // (c) lost ack, absent: outcome unknown all the same — uncertainty is
  // not absence, and a later read on this store cannot certify absence.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t === 'COMMIT', 'lost-ack-absent');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.tables.auth_eligibility.size, 0);
    eq(await store.readAuthorizationState(
      { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') }), { state: 'unknown' });
  }
  // (d) COMMIT completing as ROLLBACK (wrong tag): not an acknowledgement.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t === 'COMMIT', 'wrong-tag-commit');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.tables.auth_eligibility.size, 0);
    eq(fake.retiredCount, 1);
  }
  // (e) malformed resolved envelope on the existence SELECT
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t.startsWith('SELECT'), 'malformed-envelope');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.retiredCount, 1);
  }
  // (f) duplicate rows for one exact key: protocol failure, not a record.
  {
    const fake2 = createFakeSession();
    const store2 = makeStore(fake2);
    fake2.tables.auth_eligibility.set(SCOPE_A + '\0' + op(1) + '\0' + gen(1), {
      scope: SCOPE_A, household_id: householdId, operation_id: op(1), generation: gen(1),
      confirmation_digest: D('confirmation-1'), secret_digest: D('secret-1'), issued_at: 42,
    });
    fake2.faultOnce(t => t.startsWith('SELECT'), 'dupe-rows');
    eq(await store2.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake2.retiredCount, 1);
  }
  // (g) a stored row with malformed digests is a protocol failure.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.tables.auth_eligibility.set(SCOPE_A + '\0' + op(1) + '\0' + gen(1), {
      scope: SCOPE_A, household_id: householdId, operation_id: op(1), generation: gen(1),
      confirmation_digest: 'zz', secret_digest: 'zz', issued_at: 42,
    });
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.retiredCount, 1);
  }
  // (h) session drop mid-transaction
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.faultOnce(t => t.startsWith('INSERT'), 'drop');
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(store.status().accepting, false);
  }
});

// --- (9) retirement --------------------------------------------------------
test('AS-10 retire closes admission once, rejects queued work, and a late completion cannot publish', async () => {
  // Idempotent retire; post-retire operations resolve unknown with no
  // session traffic at all.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    eq(await store.retire(), { retired: true, accepting: false });
    eq(await store.retire(), { retired: true, accepting: false });
    eq(fake.retiredCount, 1, 'the exact session is retired at most once');
    eq(store.status(), { retired: true, accepting: false });
    const logged = fake.log.length;
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(await store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick() }),
      { outcome: 'unknown' });
    eq(await store.readAuthorizationState(
      { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') }), { state: 'unknown' });
    eq(fake.log.length, logged, 'post-retire work performs no session traffic');
  }
  // Queued work behind an in-flight unit is rejected, never executed.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    let release;
    const gate = new Promise(r => { release = r; });
    fake.hookOnce(t => t === 'BEGIN', () => gate);
    const p1 = store.issueEligibility(eligibility());
    const p2 = store.issueEligibility(eligibility({ operationId: op(2) }));
    await waitFor(() => fake.log.length >= 1, 'first BEGIN dispatched');
    await store.retire();
    release();
    eq(await p1, { outcome: 'unknown' });
    eq(await p2, { outcome: 'unknown' });
    eq(fake.log.filter(e => e.text === 'BEGIN').length, 1, 'the queued unit never began');
    eq(fake.tables.auth_eligibility.size, 0);
    eq(fake.retiredCount, 1);
  }
  // A COMMIT that completes affirmatively only after retirement still
  // cannot publish success.
  {
    const fake = createFakeSession();
    const store = makeStore(fake);
    let release;
    const gate = new Promise(r => { release = r; });
    fake.hookOnce(t => t === 'COMMIT', () => gate);
    const p1 = store.issueEligibility(eligibility());
    await waitFor(() => fake.log.some(e => e.text === 'COMMIT'), 'COMMIT dispatched');
    await store.retire();
    release();
    eq(await p1, { outcome: 'unknown' });
    eq(fake.tables.auth_eligibility.size, 1, 'the commit landed server-side; only publication was fenced');
    eq(store.status(), { retired: true, accepting: false });
  }
  // A session 'error'/'end' event is loss: store closes, session retired
  // exactly once, later work resolves unknown without traffic.
  for (const ev of ['error', 'end']) {
    const fake = createFakeSession();
    const store = makeStore(fake);
    fake.emit(ev);
    eq(store.status(), { retired: true, accepting: false });
    eq(fake.retiredCount, 1);
    const logged = fake.log.length;
    eq(await store.issueEligibility(eligibility()), { outcome: 'unknown' });
    eq(fake.log.length, logged);
  }
});

// --- reads are fresh: no cache --------------------------------------------
test('AS-11 reads re-read the statement snapshot every time (no cache, no grant)', async () => {
  const fake = createFakeSession();
  const store = makeStore(fake);
  const key = { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') };
  eq(await store.issueEligibility(eligibility()), { outcome: 'issued' });
  eq((await store.readAuthorizationState(key)).eligibility.operationId, op(1));
  // Mutate the durable state behind the store's back: the very next
  // read must reflect it — nothing is cached across requests.
  fake.tables.auth_eligibility.clear();
  eq((await store.readAuthorizationState(key)).eligibility, null);
  const reads = fake.log.filter(e => e.text.includes('LEFT JOIN'));
  eq(reads.length, 2, 'each read is its own statement');
});

// --- (10) diagnostic canaries ----------------------------------------------
test('AS-12 errors and outcomes expose no driver text, no input values, and the module never logs', async () => {
  const surfaced = [];
  const fake = createFakeSession();
  const store = makeStore(fake);
  fake.faultOnce(t => t.startsWith('INSERT'), 'reject');
  surfaced.push(JSON.stringify(await store.issueEligibility(eligibility({
    confirmationDigest: D('canary-confirmation'), secretDigest: D('canary-secret'),
  }))));
  try {
    makeStore(createFakeSession()).issueEligibility(
      { ...eligibility(), confirmationDigest: 'CANARY-INPUT-VALUE' });
    assert.fail('malformed digest must refuse');
  } catch (e) { surfaced.push(e.message); }
  const fake2 = createFakeSession();
  const store2 = makeStore(fake2);
  fake2.faultOnce(t => t.includes('LEFT JOIN'), 'reject');
  surfaced.push(JSON.stringify(await store2.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('canary-sid') })));
  const blob = surfaced.join('\n');
  assert.ok(!blob.includes('FAKE-DRIVER-TEXT'), 'driver text never surfaces');
  assert.ok(!blob.includes('CANARY-INPUT-VALUE'), 'a refused input value is never echoed');
  assert.ok(!blob.includes(D('canary-secret')), 'write outcomes carry no digest material');
  assert.ok(!blob.includes(D('canary-sid')), 'an unknown read carries no key material');
  for (const m of ['log', 'error', 'warn', 'info']) console[m] = realConsole[m];
  const consoleBlob = consoleOutputs.join('\n');
  assert.ok(!consoleBlob.includes('FAKE-DRIVER-TEXT'), 'nothing logged carries driver text');
  assert.ok(!consoleBlob.includes(D('secret-1')), 'nothing logged carries fixture digests');
});
