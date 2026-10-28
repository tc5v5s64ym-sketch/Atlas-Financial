'use strict';
// Settlement evidence authorization connection/preflight (B4) —
// INJECTED-CLIENT tests only.
//
// The module runs a bounded connect, a TLS check and four parameterized
// catalog statements through an injected pg.Client constructor, then
// constructs the REAL authorization store internally over its bounded
// session wrapper. Here the Client is an in-process double: a scripted
// catalog world (identity/role rows, a grant matrix the PRIVILEGES row
// is computed from, schema rows) plus a SQL-interpreting fake data plane
// over in-memory tables for the store's own statements. It is NOT
// PostgreSQL and NOT a real pg driver: nothing here qualifies real SQL
// semantics, real TLS, real permissions, real durability, real
// concurrency, two-connection ordering, or any provider. Doubles qualify
// the protocol only — the same stance as the shipped financial
// connection suite and the authorization-store suite.
//
// Tests first: against unmodified main this suite fails to load — the
// authorization-connection module does not exist. Stated precisely, the
// failing-before is a whole-suite LOAD failure (module missing), not 28
// individually executed assertion failures. Discrimination is post-build:
// each case's scripted single-field mutation flips its outcome, and the
// fake catalog computes its answers from the module's actual statement
// text, so weakening a matcher limb (dropping the LIMIT 4 probe, the
// column-UPDATE rejection, a NOT NULL column limb) breaks the positive
// control instead of passing silently.
//
// COVERAGE LIMIT (explicit, not faked): Atlas's GO asks for a test of
// INTERNAL STORE-CONSTRUCTION failure — the real store throwing inside
// the factory after a complete preflight, expecting a sanitized factory
// rejection, exactly one raw end(), and no owner published. No honest
// discriminating route to that throw exists with the real store and
// doubles only: the factory validates schema/scope with the store's own
// byte-identical rules before constructing anything, and the session
// wrapper the store claims is a fresh module-built object with exactly
// the three function properties the store captures, so every refusal in
// the real store's construction is unreachable without a stub store or
// an injected seam — both out of boundary. The factory's construction
// therefore sits inside the same try/catch as preflight: any throw is
// sanitized, retires the client exactly once, and rejects with the
// retirement attached. That failure PATH is exercised end-to-end by
// every preflight-failure case below (AC-6..AC-17 assert exactly one
// end() and an attached retirement report); the store-throw trigger
// itself is the unexercised delta, recorded here rather than simulated.
//
// REPAIR (Systems Review BLOCKING on PR #710 head a0ec2d58, review
// 5661207579): AC-29..AC-37 are this repair's failing-before
// discriminators, run against that head's unmodified production blob
// before the fix: 30 pass / 9 fail — exactly AC-29..AC-37 fail, no
// other case moves. (1) rows() reread result.rows, so an accessor
// yielding a genuine Array first and a non-array array-like second
// published a ready owner through single() — AC-29..AC-31 (identity,
// role, privileges) fail as 'factory must reject' (an owner WAS
// published); AC-32 (schema) fails on the diagnostic stage, the old
// code rejecting only via an incidental TypeError surfaced as
// client-setup/other rather than schema/protocol. (2) schemaMatches()
// accepted incomplete profiles: relation names that merely COERCE to a
// contract key — a boxed String (AC-33), an Array (AC-34), and three
// eligibility-shaped rows under distinct coercing names with both
// revocation relations absent (AC-37) — all published a ready owner;
// and sparse column / primary-key arrays passed because every() skips
// holes (AC-35, AC-36). After the consolidated repair (own-data
// capture in rows(); primitive exact names and dense complete column /
// PK arrays in schemaMatches()) all 39 cases pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'scripts/settlement-evidence-authorization-connection'));
const A = require(path.join(ROOT, 'scripts/settlement-evidence-anchor-store'));
const Cross = require(path.join(ROOT, 'scripts/settlement-evidence-cross-witness'));
const open = M.createSettlementEvidenceAuthorizationConnection;

const host = 'db.example.test';
const CANARY = 'PUBLIC-DUMMY-NOT-A-CREDENTIAL-CANARY';
const SCHEMA = 'atlas_auth_synthetic';
const SCOPE = 'b4-auth-scope';
const config = () => ({ host, port: 5432, database: 'synthetic', user: 'synthetic_auth',
  password: CANARY, ssl: { rejectUnauthorized: true, servername: host } });
const D = s => crypto.createHash('sha256').update('synthetic:' + s).digest('hex');
const householdId = 'household-' + 'a'.repeat(32);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const gen = n => 'generation-' + n.toString(16).padStart(32, '0');
let T = 1_760_000_000_000;
const tick = () => (T += 7);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = () => new Promise(r => setImmediate(r));
const delay = ms => new Promise(r => setTimeout(r, ms));
const driverError = code => Object.assign(
  new Error(CANARY + ' postgres://hidden:password@host'), { code, detail: CANARY, cause: CANARY });
const eligibility = (over = {}) => ({
  householdId, operationId: op(1), generation: gen(1),
  confirmationDigest: D('confirmation-1'), secretDigest: D('secret-1'), issuedAt: tick(), ...over,
});
async function waitFor(cond, what) {
  for (let i = 0; i < 1000; i++) { if (cond()) return; await settle(); }
  assert.fail('timed out waiting for ' + what);
}
const rejection = async promise => {
  const e = await promise.then(() => null, err => err);
  assert.ok(e, 'factory must reject');
  assert.equal(e.code, 'SETTLEMENT_AUTHORIZATION_CONNECTION');
  assert.ok(!JSON.stringify(e).includes(CANARY), 'no canary in the rejection');
  assert.ok(!String(e.stack).includes(CANARY), 'no canary in the stack');
  return e;
};

// --- Catalog world -------------------------------------------------------
const col = (name, type) => ({ name, type, notNull: true, generated: '' });
function defaultRelations() {
  return [
    { name: 'auth_eligibility', kind: 'r', persistence: 'p', rls: false, forceRls: false,
      unsafe: false, primaryKeyCount: 1,
      columns: [col('scope', 'text'), col('household_id', 'text'), col('operation_id', 'text'),
        col('generation', 'text'), col('confirmation_digest', 'text'), col('secret_digest', 'text'),
        col('issued_at', 'bigint')],
      primaryKey: ['scope', 'operation_id', 'generation'] },
    { name: 'auth_revocation', kind: 'r', persistence: 'p', rls: false, forceRls: false,
      unsafe: false, primaryKeyCount: 1,
      columns: [col('scope', 'text'), col('operation_id', 'text'), col('generation', 'text'),
        col('revoked_at', 'bigint')],
      primaryKey: ['scope', 'operation_id', 'generation'] },
    { name: 'auth_session_revocation', kind: 'r', persistence: 'p', rls: false, forceRls: false,
      unsafe: false, primaryKeyCount: 1,
      columns: [col('scope', 'text'), col('sid_digest', 'text'), col('revoked_at', 'bigint')],
      primaryKey: ['scope', 'sid_digest'] },
  ];
}
const grant = () => ({ table: new Set(['SELECT', 'INSERT']), columns: {} });
function defaultGrants() {
  return { connect: true, schemaUsage: true, databaseCreate: false, schemaCreate: false,
    tables: { auth_eligibility: grant(), auth_revocation: grant(), auth_session_revocation: grant() } };
}
// Compute the PRIVILEGES row from the grant matrix by interpreting ONLY
// the inquiry forms the module must emit. An absent form fails loudly —
// a module that stops asking about a privilege must not pass silently.
function projectPrivileges(text, grants) {
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER'])
    assert.ok(text.includes("has_table_privilege(format('%I.%I',$1,t.name),'" + p + "')"),
      'PRIVILEGES must inquire about table ' + p);
  for (const p of ['UPDATE', 'REFERENCES'])
    assert.ok(text.includes("has_any_column_privilege(format('%I.%I',$1,t.name),'" + p + "')"),
      'PRIVILEGES must inquire about effective column ' + p);
  const any = (g, p) => g.table.has(p) || Object.values(g.columns).some(s => s.has(p));
  const tables = Object.values(grants.tables).every(g =>
    g.table.has('SELECT') && g.table.has('INSERT')
    && !g.table.has('UPDATE') && !any(g, 'UPDATE')
    && !g.table.has('DELETE') && !g.table.has('TRUNCATE')
    && !any(g, 'REFERENCES') && !g.table.has('TRIGGER'));
  return { connect: grants.connect, schemaUsage: grants.schemaUsage,
    databaseCreate: grants.databaseCreate, schemaCreate: grants.schemaCreate, tables };
}

// --- Fake data plane (the authorization store's statements) --------------
function createFakeDatabase() {
  return { tables: { auth_eligibility: new Map(), auth_revocation: new Map(), auth_session_revocation: new Map() } };
}

function world(options = {}) {
  const w = { constructed: 0, connects: 0, ends: 0, queries: [], clients: [],
    identity: { database: 'synthetic', user: 'synthetic_auth', pid: 314, searchPath: 'pg_catalog' },
    role: { canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false,
      replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0 },
    grants: defaultGrants(), relations: defaultRelations(), db: createFakeDatabase(),
    hooks: [], faults: [], substitutes: [] };
  w.hookOnce = (match, fn) => w.hooks.push({ match, fn });
  w.faultOnce = (match, code) => w.faults.push({ match, code });
  w.substituteOnce = (match, make) => w.substitutes.push({ match, make });
  const key3 = (s, a, b) => s + '\0' + a + '\0' + b;
  const key2 = (s, a) => s + '\0' + a;

  class Client extends EventEmitter {
    constructor(c) {
      super(); w.constructed++; w.config = c; w.clients.push(this);
      this.connection = { stream: { encrypted: true, authorized: true, servername: host,
        getPeerCertificate: () => ({ subjectaltname: 'DNS:' + host }) } };
      if (options.tls) Object.assign(this.connection.stream, options.tls);
      this.inTxn = false; this.staged = null;
    }
    async connect() { w.connects++; if (options.connect) await options.connect(this); }
    async end() { w.ends++; if (options.end) await options.end(this); this.emit('end'); }
    view(name) {
      const merged = new Map(w.db.tables[name]);
      if (this.staged) for (const [k, v] of this.staged[name]) merged.set(k, v);
      return merged;
    }
    dataQuery(text, values) {
      const ok = (rows = [], rowCount = rows.length) => ({ command: text.split(' ')[0], rows, rowCount });
      if (text === 'BEGIN') {
        assert.ok(!this.inTxn, 'BEGIN inside an open transaction (interleaved units)');
        this.inTxn = true;
        this.staged = { auth_eligibility: new Map(), auth_revocation: new Map(), auth_session_revocation: new Map() };
        return ok();
      }
      if (text === 'COMMIT') {
        assert.ok(this.inTxn, 'COMMIT outside a transaction');
        for (const name of Object.keys(w.db.tables)) for (const [k, v] of this.staged[name]) w.db.tables[name].set(k, v);
        this.staged = null; this.inTxn = false; return ok();
      }
      if (text === 'ROLLBACK') {
        assert.ok(this.inTxn, 'ROLLBACK outside a transaction');
        this.staged = null; this.inTxn = false; return ok();
      }
      if (text.includes('frontier_operation_revocations')) {
        const scope = values[0];
        const ops = [];
        const sessions = [];
        for (const row of this.view('auth_revocation').values()) {
          if (row.scope === scope) ops.push([row.operation_id, row.generation, String(row.revoked_at)]);
        }
        for (const row of this.view('auth_session_revocation').values()) {
          if (row.scope === scope) sessions.push([row.sid_digest, String(row.revoked_at)]);
        }
        const facts = {};
        if (text.includes('LEFT JOIN')) {
          const [, o, g, sid] = values;
          const e = this.view('auth_eligibility').get(key3(scope, o, g));
          const r = this.view('auth_revocation').get(key3(scope, o, g));
          const s = this.view('auth_session_revocation').get(key2(scope, sid));
          Object.assign(facts, {
            household_id: e ? e.household_id : null, operation_id: e ? e.operation_id : null,
            generation: e ? e.generation : null, confirmation_digest: e ? e.confirmation_digest : null,
            secret_digest: e ? e.secret_digest : null, issued_at: e ? e.issued_at : null,
            operation_revoked: !!r, session_revoked: !!s,
          });
        }
        return ok([{
          ...facts,
          frontier_operation_revocations: ops,
          frontier_session_revocations: sessions,
        }], 1);
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
        if (this.view(name).has(k)) throw driverError('23505');
        (this.inTxn ? this.staged[name] : w.db.tables[name]).set(k, row);
        return ok([], 1);
      }
      if (text.includes('LEFT JOIN')) {
        const [scope, o, g, sid] = values;
        const e = this.view('auth_eligibility').get(key3(scope, o, g));
        const r = this.view('auth_revocation').get(key3(scope, o, g));
        const s = this.view('auth_session_revocation').get(key2(scope, sid));
        return ok([{
          household_id: e ? e.household_id : null, operation_id: e ? e.operation_id : null,
          generation: e ? e.generation : null, confirmation_digest: e ? e.confirmation_digest : null,
          secret_digest: e ? e.secret_digest : null, issued_at: e ? e.issued_at : null,
          operation_revoked: !!r, session_revoked: !!s,
        }], 1);
      }
      if (text.startsWith('SELECT')) {
        const rel = /auth_(eligibility|revocation|session_revocation)/.exec(text)[1];
        const name = 'auth_' + rel;
        const row = rel === 'session_revocation'
          ? this.view(name).get(key2(values[0], values[1]))
          : this.view(name).get(key3(values[0], values[1], values[2]));
        return ok(row ? [{ ...row }] : []);
      }
      throw driverError('0A000');
    }
    async query(text, values) {
      w.queries.push({ text, values });
      if (w.tap) w.tap(text);
      const hi = w.hooks.findIndex(h => h.match(text, values));
      if (hi >= 0) { const h = w.hooks.splice(hi, 1)[0]; await h.fn({ text, values }); }
      const fi = w.faults.findIndex(f => f.match(text, values));
      if (fi >= 0) { const f = w.faults.splice(fi, 1)[0]; throw driverError(f.code); }
      const si = w.substitutes.findIndex(s => s.match(text, values));
      if (si >= 0) { const s = w.substitutes.splice(si, 1)[0]; return s.make(text, values); }
      // Route by content; PRIVILEGES first because its text also contains
      // current_database() (inside has_database_privilege).
      if (text.includes('has_table_privilege')) return { command: 'SELECT', rows: [projectPrivileges(text, w.grants)] };
      if (text.includes('current_database() AS database')) return { command: 'SELECT', rows: [{ ...w.identity }] };
      if (text.includes('pg_roles')) return { command: 'SELECT', rows: [{ ...w.role }] };
      if (text.includes('pg_class')) {
        assert.ok(/LIMIT 4\b/.test(text), 'SCHEMA must probe with LIMIT 4');
        return { command: 'SELECT', rows: w.relations.map(r => ({ ...r, columns: r.columns.map(c => ({ ...c })), primaryKey: r.primaryKey.slice() })) };
      }
      // Data plane: statements must stay parameterized.
      assert.ok(Array.isArray(values), 'values must always be an array');
      for (const v of values) {
        if (typeof v === 'string' && v.length >= 8) assert.ok(!text.includes(v), 'a value was interpolated into SQL text');
      }
      return this.dataQuery(text, values);
    }
  }
  w.Client = Client;
  w.open = extra => open({ Client, config: config(), schema: SCHEMA, scope: SCOPE, ...extra });
  w.catalogCount = () => w.queries.filter(q => /current_database\(\)|pg_roles|has_table_privilege|pg_class/.test(q.text)).length;
  w.dataCount = () => w.queries.length - w.catalogCount();
  return w;
}

// --- Config and environment ----------------------------------------------
test('AC-1 valid options open exactly one session, run four catalog statements in order, and construct the real store inside', async () => {
  const w = world();
  const owner = await w.open();
  assert.equal(w.constructed, 1);
  assert.equal(w.connects, 1);
  assert.equal(w.queries.length, 4);
  const stages = w.queries.map(q => q.text.includes('has_table_privilege') ? 'privileges'
    : q.text.includes('current_database()') ? 'identity'
    : q.text.includes('pg_roles') ? 'role' : 'schema');
  assert.deepEqual(stages, ['identity', 'role', 'privileges', 'schema']);
  assert.deepEqual(w.queries[2].values, [SCHEMA]);
  assert.deepEqual(w.queries[3].values, [SCHEMA]);
  assert.equal(w.config.connectionString, undefined);
  assert.deepEqual(w.config.ssl, { rejectUnauthorized: true, servername: host });
  assert.equal(w.config.application_name, 'atlas-settlement-authorization');
  assert.equal(w.config.statement_timeout, 5000);
  assert.equal(w.config.lock_timeout, 1000);
  assert.equal(w.config.idle_in_transaction_session_timeout, 10000);
  assert.equal(w.config.keepAlive, true);
  assert.equal(w.config.query_timeout, 7000);
  assert.equal(w.config.connectionTimeoutMillis, 10000);
  assert.deepEqual(owner.status(), { state: 'ready', primary: null, retirement: null });
  // The internally constructed store is live over the data plane.
  assert.deepEqual(await owner.authorizationStore.issueEligibility(eligibility()), { outcome: 'issued' });
  const report = await owner.retire();
  assert.deepEqual(report, { state: 'retired', close: 'confirmed', primary: null, closeDiagnostic: null });
  assert.equal(w.ends, 1);
});

test('AC-2 every config mutation rejects at stage config before any construction', async () => {
  const configChanges = [
    { connectionString: 'postgres://' + CANARY }, { port: 0 }, { port: 65536 },
    { password: '' }, { database: 'bad name' }, { user: 'Bad User' },
    { host: '127.0.0.1' }, { host: 'localhost' }, { host: 'db-pooler.example.test' },
    { ssl: { rejectUnauthorized: false, servername: host } },
    { ssl: { rejectUnauthorized: true, servername: 'other.test' } },
    { ssl: { rejectUnauthorized: true, servername: host, ca: CANARY } },
  ];
  for (const change of configChanges) {
    const w = world();
    const e = await rejection(w.open({ config: { ...config(), ...change } }));
    assert.equal(e.diagnostic.stage, 'config'); assert.equal(e.diagnostic.category, 'invalid-config');
    assert.equal(w.constructed, 0);
  }
  const topChanges = [
    { schema: 'pg_x' }, { schema: 'HasCaps' }, { schema: 'information_schema' },
    { scope: 'bad_scope' }, { scope: '-leading' }, { Client: 'not-a-function' },
    { timeouts: { connect: 10001 } }, { timeouts: { query: 0 } }, { timeouts: { bogus: 5 } },
    { unexpected: true },
  ];
  for (const change of topChanges) {
    const w = world();
    const e = await rejection(w.open(change));
    assert.equal(e.diagnostic.stage, 'config'); assert.equal(e.diagnostic.category, 'invalid-config');
    assert.equal(w.constructed, 0);
  }
});

test('AC-3 hostile inputs are refused without invoking getters; a throwing Client constructor is sanitized', async () => {
  const w = world();
  const proxied = new Proxy(config(), { getPrototypeOf() { throw driverError(CANARY); } });
  const e1 = await rejection(w.open({ config: proxied }));
  assert.equal(e1.diagnostic.stage, 'config');
  assert.equal(w.constructed, 0);
  let getters = 0;
  const c = config();
  Object.defineProperty(c, 'password', { get() { getters++; return CANARY; } });
  const e2 = await rejection(w.open({ config: c }));
  assert.equal(e2.diagnostic.stage, 'config');
  assert.equal(getters, 0, 'accessor properties are never read');
  assert.equal(w.constructed, 0);
  const e3 = await rejection(w.open({ Client: class { constructor() { throw driverError('28P01'); } } }));
  assert.equal(e3.diagnostic.stage, 'client-setup');
  assert.equal(e3.diagnostic.code, '28P01');
  assert.equal(w.constructed, 0);
});

test('AC-4 trust-affecting environment variables refuse before construction', async () => {
  for (const key of ['PGHOST', 'PGOPTIONS', 'NODE_OPTIONS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'SSL_CERT_FILE', 'OPENSSL_CONF']) {
    const old = process.env[key];
    process.env[key] = 'public-dummy';
    try {
      const w = world();
      const e = await rejection(w.open());
      assert.equal(e.diagnostic.stage, 'environment');
      assert.equal(w.constructed, 0);
    } finally {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  }
});

test('AC-5 missing options reject at stage config; the module exports exactly the factory', async () => {
  assert.deepEqual(Object.keys(M), ['createSettlementEvidenceAuthorizationConnection']);
  for (const bad of [undefined, null]) {
    const e = await rejection(open(bad));
    assert.equal(e.diagnostic.stage, 'config');
  }
  const e = await rejection(open());
  assert.equal(e.diagnostic.stage, 'config');
});

// --- Connect, TLS, identity, role -----------------------------------------
test('AC-6 connect failure keeps the safe primary and a failed-close diagnostic; end attempted exactly once', async () => {
  const w = world({ connect: () => { throw driverError('28P01'); }, end: () => { throw driverError('ECONNRESET'); } });
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'connect');
  assert.equal(e.diagnostic.category, 'authentication');
  assert.equal(e.diagnostic.code, '28P01');
  assert.ok(e.retirement);
  assert.equal(e.retirement.close, 'failed');
  assert.equal(e.retirement.closeDiagnostic.code, 'ECONNRESET');
  assert.equal(w.ends, 1);
  assert.equal(w.queries.length, 0);
});

test('AC-7a a connect completing after its deadline publishes nothing', async () => {
  for (const completes of [true, false]) {
    const gate = deferred();
    const w = world({ connect: () => gate.promise, end: () => { if (completes) gate.resolve(); } });
    const e = await rejection(w.open({ timeouts: { connect: 8, close: completes ? 2000 : 8 } }));
    assert.equal(e.diagnostic.category, 'timeout');
    assert.equal(e.retirement.close, completes ? 'confirmed' : 'unconfirmed');
    assert.equal(w.ends, 1);
    assert.equal(w.queries.length, 0);
    gate.resolve();
    await settle();
    assert.equal(w.ends, 1);
    assert.equal(w.queries.length, 0);
  }
});

test('AC-7b a preflight statement completing after the preflight deadline publishes no owner and no store', async () => {
  const gate = deferred();
  const w = world();
  w.hookOnce(t => t.includes('pg_class'), () => gate.promise);
  const e = await rejection(w.open({ timeouts: { connect: 1000, preflight: 40, query: 1000, close: 1000 } }));
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(e.diagnostic.category, 'timeout');
  assert.equal(e.retirement.close, 'confirmed');
  assert.equal(w.ends, 1);
  gate.resolve();
  await settle();
  assert.equal(w.catalogCount(), 4, 'the late statement settled but nothing further was issued');
  assert.equal(w.dataCount(), 0, 'no store was constructed over the late session');
  assert.equal(w.ends, 1);
});

test('AC-8 TLS defects reject at stage tls before any catalog statement', async () => {
  for (const tls of [{ encrypted: false }, { authorized: false }, { servername: 'other.test' },
    { authorizationError: CANARY }, { getPeerCertificate: () => ({ subjectaltname: 'DNS:other.test' }) },
    { getPeerCertificate: () => ({}) }]) {
    const w = world({ tls });
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'tls');
    assert.equal(w.queries.length, 0);
    assert.equal(w.ends, 1);
  }
});

test('AC-9 identity mutations reject at stage identity after exactly one statement', async () => {
  for (const mutate of [r => { r.database = 'other'; }, r => { r.user = 'owner'; },
    r => { r.pid = 0; }, r => { r.searchPath = 'public'; }]) {
    const w = world();
    mutate(w.identity);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'identity');
    assert.equal(w.queries.length, 1);
    assert.equal(w.ends, 1);
  }
  const w = world();
  w.faultOnce(t => t.includes('current_database()'), '42501');
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'identity');
  assert.equal(e.diagnostic.code, '42501');
  assert.equal(w.ends, 1);
});

test('AC-10 role mutations reject at stage role after exactly two statements', async () => {
  for (const mutate of [r => { r.superuser = true; }, r => { r.connectionLimit = -1; },
    r => { r.connectionLimit = 2; }, r => { r.memberships = 1; }, r => { r.ownedObjects = 1; },
    r => { r.canLogin = false; }]) {
    const w = world();
    mutate(w.role);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'role');
    assert.equal(e.diagnostic.category, 'privileges');
    assert.equal(w.queries.length, 2);
    assert.equal(w.ends, 1);
  }
});

// --- Privileges -------------------------------------------------------------
test('AC-11 every grant flip rejects at stage privileges, including a column-only UPDATE', async () => {
  const flips = [
    g => { g.tables.auth_revocation.table.delete('INSERT'); },
    g => { g.tables.auth_eligibility.table.delete('SELECT'); },
    g => { g.tables.auth_eligibility.table.add('UPDATE'); },
    g => { g.tables.auth_session_revocation.table.add('DELETE'); },
    g => { g.tables.auth_revocation.table.add('TRUNCATE'); },
    g => { g.tables.auth_eligibility.table.add('TRIGGER'); },
    g => { g.tables.auth_revocation.columns.revoked_at = new Set(['REFERENCES']); },
    // The Atlas GO discriminator: an effective UPDATE held ONLY as a
    // column grant — no table UPDATE anywhere — must still refuse.
    g => { g.tables.auth_eligibility.columns.secret_digest = new Set(['UPDATE']); },
    g => { g.tables.auth_session_revocation.columns.sid_digest = new Set(['UPDATE']); },
    g => { g.databaseCreate = true; },
    g => { g.schemaCreate = true; },
    g => { g.schemaUsage = false; },
    g => { g.connect = false; },
  ];
  for (const flip of flips) {
    const w = world();
    flip(w.grants);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'privileges');
    assert.equal(w.queries.length, 3);
    assert.equal(w.ends, 1);
  }
});

// --- Schema -------------------------------------------------------------------
test('AC-12 a missing relation rejects at stage schema', async () => {
  for (const name of ['auth_eligibility', 'auth_revocation', 'auth_session_revocation']) {
    const w = world();
    w.relations = w.relations.filter(r => r.name !== name);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'schema');
    assert.equal(w.queries.length, 4);
    assert.equal(w.ends, 1);
  }
});

test('AC-13 an extra relation (table or view) rejects at stage schema', async () => {
  for (const extra of [
    { name: 'auth_extra', kind: 'r', persistence: 'p', rls: false, forceRls: false, unsafe: false,
      primaryKeyCount: 1, columns: [col('scope', 'text')], primaryKey: ['scope'] },
    { name: 'auth_view', kind: 'v', persistence: 'p', rls: false, forceRls: false, unsafe: false,
      primaryKeyCount: 0, columns: [col('scope', 'text')], primaryKey: [] },
  ]) {
    const w = world();
    w.relations.push(extra);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'schema');
    assert.equal(w.ends, 1);
  }
});

test('AC-14 column drift rejects at stage schema', async () => {
  const drifts = [
    r => { r[0].columns[6].type = 'text'; },                    // issued_at typed text
    r => { r[0].columns.splice(1, 1); },                        // missing column
    r => { r[1].columns.push(col('extra', 'text')); },          // extra column
    r => { const c = r[0].columns; [c[1], c[2]] = [c[2], c[1]]; }, // swapped order
    r => { r[2].columns[1].generated = 's'; },                  // generated column
    r => { r[0].columns[0].notNull = false; },                  // nullable column
  ];
  for (const drift of drifts) {
    const w = world();
    drift(w.relations);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'schema');
    assert.equal(w.ends, 1);
  }
});

test('AC-15 primary-key drift rejects at stage schema', async () => {
  const drifts = [
    r => { r[0].primaryKeyCount = 0; r[0].primaryKey = []; },
    r => { r[0].primaryKey = ['scope']; },
    r => { r[2].primaryKey = ['sid_digest', 'scope']; },
  ];
  for (const drift of drifts) {
    const w = world();
    drift(w.relations);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'schema');
    assert.equal(w.ends, 1);
  }
});

test('AC-16 relation-feature drift rejects at stage schema', async () => {
  const drifts = [
    r => { r[1].kind = 'v'; },
    r => { r[1].persistence = 't'; },
    r => { r[0].rls = true; },
    r => { r[2].unsafe = true; },
  ];
  for (const drift of drifts) {
    const w = world();
    drift(w.relations);
    const e = await rejection(w.open());
    assert.equal(e.diagnostic.stage, 'schema');
    assert.equal(w.ends, 1);
  }
});

test('AC-17 the financial schema shape is refused by the authorization preflight', async () => {
  const w = world();
  w.relations = ['doc_head', 'doc_staged', 'journal', 'quarantine'].map(name => ({
    name, kind: 'r', persistence: 'p', rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
    columns: (name === 'quarantine' ? ['scope', 'name', 'label', 'bytes'] : ['scope', 'bytes'])
      .map(n => ({ name: n, type: n === 'bytes' ? 'bytea' : 'text', notNull: n !== 'label', generated: '' })),
    primaryKey: name === 'quarantine' ? ['scope', 'name'] : ['scope'],
  }));
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

// --- Owner surface and the store inside ---------------------------------------
test('AC-18 the owner exposes exactly {authorizationStore, retire, status} — never the session or the raw client', async () => {
  const w = world();
  const owner = await w.open();
  assert.deepEqual(Object.keys(owner).sort(), ['authorizationStore', 'retire', 'status']);
  assert.ok(Object.isFrozen(owner));
  assert.equal(owner.session, undefined);
  assert.equal(owner.client, undefined);
  assert.equal(owner.query, undefined);
  assert.deepEqual(Object.keys(owner.authorizationStore).sort(),
    ['appendRevocation', 'appendSessionRevocation', 'issueEligibility', 'readAuthorizationState', 'retire', 'status']);
  assert.ok(Object.isFrozen(owner.authorizationStore));
  const st = owner.status();
  assert.ok(Object.isFrozen(st));
  assert.deepEqual(st, { state: 'ready', primary: null, retirement: null });
  assert.throws(() => { owner.session = {}; }, TypeError);
  await owner.retire();
});

test('AC-19 the constructed consumer is the real store: its own strict validation applies unchanged', async () => {
  const w = world();
  const owner = await w.open();
  const store = owner.authorizationStore;
  assert.deepEqual(store.status(), { retired: false, accepting: true });
  // A boxed String passes a bare pattern test by coercion; the REAL
  // store refuses it synchronously — proof the consumer is not a stub.
  const boxed = new String(op(7));
  assert.throws(() => store.issueEligibility({ ...eligibility(), operationId: boxed }), TypeError);
  assert.throws(() => store.readAuthorizationState({ operationId: op(1), generation: gen(1) }), TypeError);
  assert.equal(w.dataCount(), 0, 'refused inputs produce no session traffic');
  await owner.retire();
  assert.deepEqual(store.status(), { retired: true, accepting: false });
});

test('AC-20 end-to-end over doubles: issue, read, revoke, read through the internal store', async () => {
  const w = world();
  const owner = await w.open();
  const store = owner.authorizationStore;
  const record = eligibility();
  assert.deepEqual(await store.issueEligibility(record), { outcome: 'issued' });
  const key = { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') };
  const read1 = await store.readAuthorizationState(key);
  assert.deepEqual(read1, { state: 'ok',
    eligibility: { householdId, operationId: op(1), generation: gen(1),
      confirmationDigest: D('confirmation-1'), secretDigest: D('secret-1'), issuedAt: record.issuedAt },
    operationRevoked: false, sessionRevoked: false });
  assert.deepEqual(await store.appendRevocation({ operationId: op(1), generation: gen(1), revokedAt: tick() }),
    { outcome: 'appended' });
  assert.deepEqual(await store.appendSessionRevocation({ sidDigest: D('sid-1'), revokedAt: tick() }),
    { outcome: 'appended' });
  const read2 = await store.readAuthorizationState(key);
  assert.equal(read2.operationRevoked, true);
  assert.equal(read2.sessionRevoked, true);
  // Statement discipline on the wire: writes are whole BEGIN..COMMIT
  // units; the state read is ONE standalone SELECT serialized OUTSIDE
  // any write transaction (never between a BEGIN and its COMMIT).
  const data = w.queries.slice(4).map(q => q.text.includes('LEFT JOIN') ? 'READ' : q.text.split(' ')[0]);
  assert.deepEqual(data, [
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'READ',
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'BEGIN', 'SELECT', 'INSERT', 'COMMIT',
    'READ',
  ]);
  await owner.retire();
});

test('AC-21 a Pool-shaped constructor is refused before connect; a raw client cannot serve two owners', async () => {
  let poolConnects = 0;
  class PoolShape extends EventEmitter {
    constructor() { super(); this.connection = { stream: {} }; }
    connect() { poolConnects++; } query() {} end() {} release() {}
  }
  const w0 = world();
  const e0 = await rejection(w0.open({ Client: PoolShape }));
  assert.equal(e0.diagnostic.stage, 'client-setup');
  assert.equal(poolConnects, 0);
  const w = world();
  const shared = new w.Client(config());
  const SameInstance = function () { return shared; };
  const owner = await w.open({ Client: SameInstance });
  const e = await rejection(w.open({ Client: SameInstance }));
  assert.equal(e.diagnostic.stage, 'client-setup');
  assert.equal(owner.status().state, 'ready', 'the first owner is unaffected');
  assert.equal(w.ends, 0, 'the refused second claim does not retire the live session');
  await owner.retire();
  assert.equal(w.ends, 1);
});

// --- Lifecycle: loss, retire, timeouts -----------------------------------------
test('AC-22 a raw error event loses the session for both layers and converges on one end()', async () => {
  const w = world();
  const owner = await w.open();
  const store = owner.authorizationStore;
  w.clients[0].emit('error', driverError('ECONNRESET'));
  assert.deepEqual(store.status(), { retired: true, accepting: false }, 'the store loss listener fired');
  assert.notEqual(owner.status().state, 'ready');
  const before = w.queries.length;
  assert.deepEqual(await store.readAuthorizationState(
    { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') }), { state: 'unknown' });
  assert.equal(w.queries.length, before, 'post-loss work performs no session traffic');
  await owner.retire();
  await store.retire();
  assert.equal(w.ends, 1, 'exactly one raw end across loss, owner retire and store retire');
  assert.equal(owner.status().primary.code, 'ECONNRESET');
});

test('AC-23 mixed retirement orders converge on one identical report; normal store retirement is not a protocol fault', async () => {
  // (a) owner first, then store
  {
    const w = world();
    const owner = await w.open();
    const a = owner.retire(); const b = owner.retire();
    assert.equal(a, b, 'owner retire() returns the same promise');
    const report = await a;
    await owner.authorizationStore.retire();
    assert.equal(w.ends, 1);
    assert.deepEqual(report, { state: 'retired', close: 'confirmed', primary: null, closeDiagnostic: null });
    assert.equal(owner.status().primary, null);
  }
  // (b) store first, then owner — the store's session retire reaches the
  // same single termination, and records NO diagnostic against the pair.
  {
    const w = world();
    const owner = await w.open();
    await owner.authorizationStore.retire();
    const report = await owner.retire();
    assert.equal(w.ends, 1);
    assert.deepEqual(report, { state: 'retired', close: 'confirmed', primary: null, closeDiagnostic: null });
    assert.equal(owner.status().state, 'retired');
  }
});

test('AC-24 a hanging close is bounded and reported unconfirmed — never a termination claim', async () => {
  const w = world({ end: () => new Promise(() => {}) });
  const owner = await w.open({ timeouts: { close: 25 } });
  const report = await owner.retire();
  assert.equal(report.close, 'unconfirmed');
  assert.equal(report.state, 'lost');
  assert.equal(report.closeDiagnostic.category, 'timeout');
  assert.equal(w.ends, 1);
});

test('AC-25a loss during an in-flight write resolves it unknown, fences queued work, and ends the session once', async () => {
  const gate = deferred();
  const w = world();
  const owner = await w.open();
  const store = owner.authorizationStore;
  w.hookOnce(t => t.startsWith('INSERT INTO'), () => gate.promise);
  const p1 = store.issueEligibility(eligibility());
  const p2 = store.issueEligibility(eligibility({ operationId: op(2) }));
  await waitFor(() => w.queries.some(q => q.text.startsWith('INSERT INTO')), 'INSERT dispatched');
  w.clients[0].emit('error', driverError('ECONNRESET'));
  gate.resolve();
  assert.deepEqual(await p1, { outcome: 'unknown' }, 'the in-flight write cannot publish after loss');
  assert.deepEqual(await p2, { outcome: 'unknown' }, 'the queued write resolves unknown');
  assert.equal(w.queries.filter(q => q.text === 'BEGIN').length, 1, 'the queued unit never began');
  assert.equal(w.db.tables.auth_eligibility.size, 0, 'nothing from the unknown write is durable');
  assert.equal(w.ends, 1);
});

test('AC-25b a wrapper query timeout loses the session; later reads resolve unknown with no further traffic', async () => {
  const gate = deferred();
  const w = world();
  const owner = await w.open({ timeouts: { connect: 1000, preflight: 1000, query: 25, close: 1000 } });
  const store = owner.authorizationStore;
  assert.deepEqual(await store.issueEligibility(eligibility()), { outcome: 'issued' });
  w.hookOnce(t => t.includes('LEFT JOIN'), () => gate.promise);
  const key = { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') };
  assert.deepEqual(await store.readAuthorizationState(key), { state: 'unknown' });
  assert.deepEqual(store.status(), { retired: true, accepting: false });
  gate.resolve();
  await settle();
  const before = w.queries.length;
  assert.deepEqual(await store.readAuthorizationState(key), { state: 'unknown' });
  assert.equal(w.queries.length, before, 'the fenced session is never touched again');
  assert.equal(owner.status().primary.category, 'timeout');
  assert.equal(w.ends, 1);
});

test('AC-26 canary sweep: driver text never surfaces at preflight, data plane, or close', async () => {
  // Preflight query failure with a canary-bearing driver error.
  {
    const w = world();
    w.faultOnce(t => t.includes('pg_roles'), '42501');
    const e = await rejection(w.open());
    assert.deepEqual(e.diagnostic, { stage: 'role', category: 'sql', code: '42501' });
    assert.equal(w.ends, 1);
  }
  // Data-plane failure: the store resolves unknown; the owner's primary
  // diagnostic carries only the allowlisted code.
  {
    const w = world();
    const owner = await w.open();
    w.faultOnce(t => t.startsWith('INSERT INTO'), '57P01');
    assert.deepEqual(await owner.authorizationStore.issueEligibility(eligibility()), { outcome: 'unknown' });
    assert.deepEqual(owner.status().primary, { stage: 'query', category: 'sql', code: '57P01' });
    assert.ok(!JSON.stringify(owner.status()).includes(CANARY));
    assert.equal(w.ends, 1);
  }
  // Close failure with an unlisted driver code: reported as null, never echoed.
  {
    const w = world({ end: () => { throw driverError(CANARY); } });
    const owner = await w.open();
    const report = await owner.retire();
    assert.equal(report.close, 'failed');
    assert.equal(report.closeDiagnostic.code, null);
    assert.ok(!JSON.stringify(report).includes(CANARY));
    assert.equal(w.ends, 1);
  }
});

test('AC-27 reads are never cached: durable changes behind the store are visible on the very next read', async () => {
  const w = world();
  const owner = await w.open();
  const store = owner.authorizationStore;
  const key = { operationId: op(1), generation: gen(1), sidDigest: D('sid-1') };
  assert.deepEqual(await store.issueEligibility(eligibility()), { outcome: 'issued' });
  assert.equal((await store.readAuthorizationState(key)).eligibility.operationId, op(1));
  w.db.tables.auth_eligibility.clear();
  assert.equal((await store.readAuthorizationState(key)).eligibility, null);
  assert.equal(w.queries.filter(q => q.text.includes('LEFT JOIN')).length, 2, 'each read is its own statement');
  await owner.retire();
});

test('AC-28 retirement closes admission synchronously, from either side', async () => {
  // Owner side: the state flips in the same tick retire() is called.
  {
    const w = world();
    const owner = await w.open();
    const pending = owner.retire();
    assert.equal(owner.status().state, 'retiring', 'admission closed synchronously');
    assert.deepEqual(await owner.authorizationStore.issueEligibility(eligibility()), { outcome: 'unknown' });
    assert.equal(w.dataCount(), 0, 'no data statement was dispatched after retirement began');
    await pending;
    assert.equal(w.ends, 1);
  }
  // Store side: store.retire() synchronously reaches the shared
  // termination through its session retire().
  {
    const w = world();
    const owner = await w.open();
    const storeRetire = owner.authorizationStore.retire();
    assert.equal(owner.status().state, 'retiring', 'store retirement closes owner admission in the same tick');
    await storeRetire;
    const report = await owner.retire();
    assert.equal(report.primary, null);
    assert.equal(w.ends, 1);
  }
});

// --- Repair discriminators: captured envelopes, exact schema profile ---------
// A hostile result whose rows accessor yields a genuine Array on the
// first read and a non-array array-like ({0: row, length}) on the
// second. The module must capture the envelope/rows as own data — the
// accessor is never invoked, and only the capture is ever consumed.
function accessorResult(validRows) {
  let reads = 0;
  const result = { command: 'SELECT' };
  Object.defineProperty(result, 'rows', { enumerable: true,
    get() { reads++; return reads === 1 ? validRows : { 0: validRows[0], length: validRows.length }; } });
  return { result, reads: () => reads };
}
const schemaRowsOf = w => w.relations.map(r => ({ ...r,
  columns: r.columns.map(c => ({ ...c })), primaryKey: r.primaryKey.slice() }));

test('AC-29 an accessor-substituted identity result rejects at stage identity and the accessor is never invoked', async () => {
  const w = world();
  const hostile = accessorResult([{ ...w.identity }]);
  w.substituteOnce(t => t.includes('current_database() AS database'), () => hostile.result);
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'identity');
  assert.equal(e.diagnostic.category, 'protocol');
  assert.equal(hostile.reads(), 0, 'the rows accessor is never invoked');
  assert.equal(w.ends, 1);
});

test('AC-30 an accessor-substituted role result rejects at stage role and the accessor is never invoked', async () => {
  const w = world();
  const hostile = accessorResult([{ ...w.role }]);
  w.substituteOnce(t => t.includes('pg_roles'), () => hostile.result);
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'role');
  assert.equal(e.diagnostic.category, 'protocol');
  assert.equal(hostile.reads(), 0, 'the rows accessor is never invoked');
  assert.equal(w.queries.length, 2);
  assert.equal(w.ends, 1);
});

test('AC-31 an accessor-substituted privileges result rejects at stage privileges and the accessor is never invoked', async () => {
  const w = world();
  let hostile;
  w.substituteOnce(t => t.includes('has_table_privilege'),
    text => { hostile = accessorResult([projectPrivileges(text, w.grants)]); return hostile.result; });
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'privileges');
  assert.equal(e.diagnostic.category, 'protocol');
  assert.equal(hostile.reads(), 0, 'the rows accessor is never invoked');
  assert.equal(w.queries.length, 3);
  assert.equal(w.ends, 1);
});

test('AC-32 an accessor-substituted schema result rejects at stage schema and the accessor is never invoked', async () => {
  const w = world();
  const hostile = accessorResult(schemaRowsOf(w));
  w.substituteOnce(t => t.includes('pg_class'), () => hostile.result);
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(e.diagnostic.category, 'protocol');
  assert.equal(hostile.reads(), 0, 'the rows accessor is never invoked');
  assert.equal(w.ends, 1);
});

test('AC-33 a boxed-String relation name rejects at stage schema', async () => {
  const w = world();
  w.relations[1].name = new String('auth_revocation');
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

test('AC-34 an Array relation name rejects at stage schema', async () => {
  const w = world();
  w.relations[2].name = ['auth_session_revocation'];
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

test('AC-35 a sparse columns array rejects at stage schema', async () => {
  const w = world();
  delete w.relations[0].columns[6];
  assert.equal(w.relations[0].columns.length, 7, 'the array keeps its length; only the element is a hole');
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

test('AC-36 a sparse primary-key array rejects at stage schema', async () => {
  const w = world();
  delete w.relations[0].primaryKey[1];
  assert.equal(w.relations[0].primaryKey.length, 3, 'the array keeps its length; only the element is a hole');
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

test('AC-37 three eligibility-shaped rows under distinct coercing names do not stand in for the absent revocation relations', async () => {
  const w = world();
  const shape = w.relations[0];
  w.relations = [
    { ...shape, name: new String('auth_eligibility') },
    { ...shape, name: ['auth_eligibility'] },
    { ...shape, name: new String('auth_eligibility') },
  ];
  const e = await rejection(w.open());
  assert.equal(e.diagnostic.stage, 'schema');
  assert.equal(w.ends, 1);
});

// --- S3 composer (anchor/epoch §2.3.2–§2.3.3), injected doubles only -----
const H64 = n => crypto.createHash('sha256').update(String(n)).digest('hex');
function makeTransport() {
  const objects = new Map();
  let seq = 0;
  const calls = [];
  const faults = [];
  const conflict = () => Object.assign(new Error('conflict'), { code: 'conflict' });
  return {
    objects, calls,
    failWhen(pred, mode) { faults.push({ pred, mode }); },
    async read(key) {
      calls.push({ method: 'read', key });
      const o = objects.get(key);
      if (!o) return null;
      return { bytes: Buffer.from(o.bytes), version: o.version, metadata: { ...o.metadata } };
    },
    async create(key, bytes, metadata) {
      calls.push({ method: 'create', key });
      const idx = faults.findIndex(f => f.pred(key));
      const fault = idx >= 0 ? faults.splice(idx, 1)[0] : null;
      const perform = () => {
        if (objects.has(key)) throw conflict();
        const version = 'v' + (++seq);
        objects.set(key, { bytes: Buffer.from(bytes), version, metadata: { ...(metadata || {}) } });
        return { version, integrity: crypto.createHash('sha256').update(bytes).digest('hex') };
      };
      if (fault && fault.mode === 'throw') throw new Error('create lost');
      if (fault && fault.mode === 'throw-landed') { perform(); throw new Error('create lost landed'); }
      if (fault && fault.mode === 'conflict') throw conflict();
      return perform();
    },
    async replace() { throw new Error('replace is unused by the authorization anchor'); },
    async list(prefix, cursor) {
      calls.push({ method: 'list', key: prefix });
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor == null ? 0 : keys.findIndex(k => k > cursor);
      const from = start < 0 ? keys.length : start;
      const page = keys.slice(from, from + 50);
      return {
        entries: page.map(k => ({ key: k, metadata: { ...objects.get(k).metadata } })),
        nextCursor: from + page.length < keys.length ? page[page.length - 1] : null,
      };
    },
  };
}
function witnessSession(order) {
  const rows = [];
  const calls = [];
  const listeners = { error: new Set(), end: new Set() };
  let failInsert = false;
  return {
    rows, calls,
    failInsert() { failInsert = true; },
    async query(text, values) {
      calls.push(text);
      if (text.startsWith('INSERT INTO') && order) order.push('witness');
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { command: text, rows: [], rowCount: 0 };
      if (text.startsWith('INSERT INTO')) {
        if (failInsert) { failInsert = false; throw Object.assign(new Error('lost'), { code: '57P01' }); }
        const [sc, incarnation, epoch, frontierDigest, recordHash, eventId, observedAt] = values;
        rows.push({
          scope: sc, incarnation, epoch, frontier_digest: frontierDigest,
          record_hash: recordHash, event_id: eventId, observed_at: observedAt,
        });
        return { command: 'INSERT', rows: [], rowCount: 1 };
      }
      if (text.includes('incarnation = $2')) {
        const [sc, incarnation, epoch] = values;
        const found = rows.filter(r => r.scope === sc && r.incarnation === incarnation && r.epoch === epoch);
        return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
      }
      const found = rows.filter(r => r.scope === values[0]);
      return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
    },
    on(event, fn) { listeners[event].add(fn); },
    retire() { return Promise.resolve(); },
    emit(event) { for (const fn of listeners[event]) fn(); },
  };
}
function keyCount(transport, suffix) {
  return [...transport.objects.keys()].filter(k => k.endsWith(suffix)).length;
}
function genCount(transport) {
  return [...transport.objects.keys()].filter(k => k.includes('/gen-')).length;
}
async function composerFixture() {
  const w = world();
  const order = [];
  const transport = makeTransport();
  const anchor = A.createSettlementEvidenceAnchorStore({ transport, prefix: 'anchor-test', schema: SCHEMA });
  const ws = witnessSession(order);
  const witnessStore = Cross.createSettlementEvidenceCrossWitness({ session: ws, schema: 'atlas_witness_synthetic' });
  const witness = { witnessStore, retire: () => witnessStore.retire(), status: () => witnessStore.status() };
  async function seedGenesis() {
    assert.equal(await anchor.genesisAuthorization(SCOPE, { nonce: 's3-nonce', updatedAt: tick() }), true);
    const record = await anchor.readAuthorization(SCOPE);
    const gens = await anchor.listAuthorizationGenerations(SCOPE);
    await witnessStore.appendObservation({
      scope: SCOPE, incarnation: record.incarnation, epoch: 0,
      frontierDigest: record.frontierDigest, recordHash: gens[0].recordHash,
      eventId: record.lastEventId, observedAt: tick(),
    });
    return record;
  }
  async function observed() {
    return (await witnessStore.listObservations({ scope: SCOPE })).observations;
  }
  function seedOp(operationId, generation, revokedAt) {
    w.db.tables.auth_revocation.set(SCOPE + '\0' + operationId + '\0' + generation, {
      scope: SCOPE, operation_id: operationId, generation, revoked_at: revokedAt,
    });
  }
  async function plant(entry, opts = {}) {
    const row = opts.row === undefined ? !!opts.advance : opts.row;
    const { advance = false, ack = false, witnessEpoch = false } = opts;
    const admission = await anchor.openAuthorizationIntent(
      { scope: SCOPE, ...entry }, { witnessObservations: await observed() });
    assert.equal(admission.status, 'admitted');
    if (row && entry.kind === 'oprev') seedOp(entry.operationId, entry.generation, entry.revokedAt);
    if (!advance) return admission;
    const current = await anchor.readAuthorization(SCOPE);
    const replay = await anchor.replayAuthorization(SCOPE);
    const prior = replay.anchoredEntries.map(h => Buffer.from(h, 'hex'));
    const entries = prior.concat([Buffer.from(admission.entry.entry, 'hex')]);
    const next = {
      scope: SCOPE, incarnation: current.incarnation, epoch: current.epoch + 1,
      revocationCount: entries.length,
      frontierDigest: A.computeFrontierDigest({
        schema: SCHEMA, scope: SCOPE, incarnation: current.incarnation, entries,
      }),
      priorDigest: current.frontierDigest, lastEventId: admission.eventId, updatedAt: tick(),
    };
    assert.equal(await anchor.advanceAuthorization(SCOPE, current, next), true);
    const gens = await anchor.listAuthorizationGenerations(SCOPE);
    const landed = gens[gens.length - 1];
    if (ack) await anchor.writeAckAuthorization(SCOPE, admission.eventId, landed.generation, landed.recordHash);
    if (witnessEpoch) {
      await witnessStore.appendObservation({
        scope: SCOPE, incarnation: landed.record.incarnation, epoch: landed.record.epoch,
        frontierDigest: landed.record.frontierDigest, recordHash: landed.recordHash,
        eventId: admission.eventId, observedAt: tick(),
      });
    }
    return admission;
  }
  async function openOwner() {
    return w.open({ anchorStore: anchor, witness });
  }
  return { w, transport, anchor, witnessStore, ws, order, seedGenesis, observed, seedOp, plant, openOwner };
}
const opEntry = (n, revokedAt) => ({ kind: 'oprev', operationId: op(n), generation: gen(n), revokedAt });

test('S3-1 a composer append reports success only after ack and witness, in protocol order', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  assert.deepEqual(Object.keys(owner).sort(), ['authorizationStore', 'retire', 'status']);
  assert.equal(owner.anchoredAppend.status().serving, true);
  const order = fx.order;
  const orig = fx.transport.create;
  fx.transport.create = async (key, bytes, metadata) => {
    order.push(key.endsWith('.intent.json') ? 'intent' : key.includes('/gen-') ? 'cas' : key.endsWith('.ack.json') ? 'ack' : 'create');
    return orig(key, bytes, metadata);
  };
  fx.w.tap = text => {
    if (text.startsWith('INSERT INTO') && text.includes('auth_revocation') && !text.includes('session')) order.push('append');
    if (text.includes('frontier_operation_revocations')) order.push('frontier');
  };
  order.length = 0;
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'appended');
  assert.equal(result.state, 'W5');
  assert.deepEqual(order, ['intent', 'append', 'frontier', 'cas', 'ack', 'witness']);
  const head = await fx.witnessStore.readHead({ scope: SCOPE });
  assert.equal(head.head.epoch, 1);
  assert.equal(head.head.eventId, result.eventId);
});

test('S3-1b an identical retry reports the already-durable success and does not advance again', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const input = opEntry(1, tick());
  const first = await owner.anchoredAppend.appendRevocation(input);
  assert.equal(first.outcome, 'appended');
  const epoch = (await fx.anchor.readAuthorization(SCOPE)).epoch;
  const second = await owner.anchoredAppend.appendRevocation(input);
  assert.equal(second.outcome, 'appended');
  assert.equal(second.state, 'W5');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, epoch);
  assert.equal(genCount(fx.transport), 2);
});

test('S3-2 a session revocation uses the same protocol', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const result = await owner.anchoredAppend.appendSessionRevocation({ sidDigest: D('sid-1'), revokedAt: tick() });
  assert.equal(result.outcome, 'appended');
  assert.equal(result.state, 'W5');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 1);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 1);
});

test('S3-3 C0 store-append uncertainty leaves the intent open and does not report success', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.w.faultOnce(text => text.startsWith('INSERT INTO') && text.includes('auth_revocation'), '57P01');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.notEqual(result.state, 'W5');
  assert.equal(genCount(fx.transport), 1);
  assert.equal(keyCount(fx.transport, '.intent.json'), 1);
  assert.equal(keyCount(fx.transport, '.ack.json'), 0);
  assert.equal(fx.w.db.tables.auth_revocation.size, 0);
});

test('S3-4 C1 after a committed append a frontier failure is committed-unanchored and does not CAS', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.w.faultOnce(text => text.includes('frontier_operation_revocations'), '57P01');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.state, 'W2');
  assert.equal(result.committedUnanchored, true);
  assert.equal(genCount(fx.transport), 1);
  assert.equal(fx.w.db.tables.auth_revocation.size, 1);
  assert.equal(keyCount(fx.transport, '.ack.json'), 0);
});

test('S3-5 C2 a CAS that throws without landing stays unanchored after the one retry', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const pred = key => key.includes('/gen-');
  fx.transport.failWhen(pred, 'throw');
  fx.transport.failWhen(pred, 'throw');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.state, 'W2');
  assert.equal(result.committedUnanchored, true);
  assert.equal(genCount(fx.transport), 1);
});

test('S3-6 C2 a CAS that lands and loses its ack is finished as W5 without a second advance', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.transport.failWhen(key => key.includes('/gen-'), 'throw-landed');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'appended');
  assert.equal(result.state, 'W5');
  assert.equal(genCount(fx.transport), 2);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 1);
});

test('S3-7 C3 a landed advance whose ack write fails is not reported as success', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.transport.failWhen(key => key.endsWith('.ack.json'), 'throw');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.state, 'W3');
  assert.equal(genCount(fx.transport), 2);
  assert.equal(keyCount(fx.transport, '.ack.json'), 0);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 0);
});

test('S3-8 C4 an acked advance whose witness write fails is not reported as success', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.ws.failInsert();
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.state, 'W4');
  assert.equal(keyCount(fx.transport, '.ack.json'), 1);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 1);
  // A lost witness insert is session loss: the store retires and a later
  // head read is unknown. The observation itself is proven absent on the
  // double — genesis only, no epoch-1 row.
  assert.deepEqual(await fx.witnessStore.readHead({ scope: SCOPE }), { state: 'unknown' });
  assert.equal(fx.witnessStore.status().accepting, false);
  assert.equal(fx.ws.rows.length, 1);
  assert.equal(fx.ws.rows[0].epoch, 0);
});

test('S3-9 a second append is not admitted while an intent is open', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const blockerAt = tick();
  await fx.anchor.openAuthorizationIntent(
    { scope: SCOPE, ...opEntry(9, blockerAt) },
    { witnessObservations: await fx.observed() });
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.reason, 'anchor-intent-open');
  assert.equal(fx.w.db.tables.auth_revocation.size, 0);
  assert.equal(keyCount(fx.transport, '.intent.json'), 1);
  assert.equal(genCount(fx.transport), 1);
});

test('S3-10 successor-proof failure attempts no CAS and surfaces anchor-mismatch-unproven', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  assert.equal((await owner.anchoredAppend.appendRevocation(opEntry(1, tick()))).outcome, 'appended');
  const epoch = (await fx.anchor.readAuthorization(SCOPE)).epoch;
  const gens = genCount(fx.transport);
  fx.w.db.tables.auth_revocation.clear();
  const result = await owner.anchoredAppend.appendRevocation(opEntry(2, tick()));
  assert.equal(result.outcome, 'unknown');
  assert.equal(result.reason, 'anchor-mismatch-unproven');
  assert.equal(genCount(fx.transport), gens);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, epoch);
  assert.equal(owner.anchoredAppend.status().serving, false);
});

test('S3-11 a duplicate append with a different revokedAt closes duplicate-satisfied and never advances', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const firstAt = tick();
  assert.equal((await owner.anchoredAppend.appendRevocation(opEntry(1, firstAt))).outcome, 'appended');
  const epoch = (await fx.anchor.readAuthorization(SCOPE)).epoch;
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'duplicate-satisfied');
  assert.equal(result.state, 'T-DUP');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, epoch);
  assert.equal(keyCount(fx.transport, '.dup.json'), 1);
  assert.equal(keyCount(fx.transport, '.ack.json'), 1);
});

test('S3-12 open reconciliation closes W3 and W4 with no anchor movement', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const revokedAt = tick();
  await fx.plant(opEntry(1, revokedAt), { advance: true });
  const epoch = (await fx.anchor.readAuthorization(SCOPE)).epoch;
  const gens = genCount(fx.transport);
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, epoch);
  assert.equal(genCount(fx.transport), gens);
  assert.equal(keyCount(fx.transport, '.ack.json'), 1);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 1);
});

test('S3-13 open reconciliation closes acked-unwitnessed W4 with no anchor movement', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  await fx.plant(opEntry(1, tick()), { advance: true, ack: true });
  const gens = genCount(fx.transport);
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal(genCount(fx.transport), gens);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 1);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 1);
});

test('S3-14 open reconciliation voids an intent whose append never committed', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  await fx.plant(opEntry(1, tick()), { advance: false });
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal(keyCount(fx.transport, '.void.json'), 1);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 0);
  assert.equal(genCount(fx.transport), 1);
});

test('S3-15 open reconciliation advances a genuinely-new W2 exactly once', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  await fx.plant(opEntry(1, tick()), { row: true, advance: false });
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 1);
  assert.equal(genCount(fx.transport), 2);
  assert.equal(keyCount(fx.transport, '.ack.json'), 1);
  assert.equal((await fx.witnessStore.readHead({ scope: SCOPE })).head.epoch, 1);
});

test('S3-16 a foreign generation is UNPROVEN and the anchor is not moved', async () => {
  const fx = await composerFixture();
  const current = await fx.seedGenesis();
  assert.equal(await fx.anchor.advanceAuthorization(SCOPE, current, {
    scope: SCOPE, incarnation: current.incarnation, epoch: 1, revocationCount: 0,
    frontierDigest: current.frontierDigest, priorDigest: current.frontierDigest,
    lastEventId: H64('foreign-generation'), updatedAt: tick(),
  }), true);
  const before = fx.transport.objects.size;
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'unproven');
  assert.equal(owner.anchoredAppend.status().serving, false);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 1);
  assert.equal(fx.transport.objects.size, before);
  const refused = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(refused.outcome, 'unknown');
  assert.equal(genCount(fx.transport), 2);
});

test('S3-17 a duplicate intent is closed at open once its owner is anchored', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const revokedAt = tick();
  await fx.plant(opEntry(1, revokedAt), { advance: true, ack: true, witnessEpoch: true });
  await fx.anchor.openAuthorizationIntent(
    { scope: SCOPE, ...opEntry(1, tick()) }, { witnessObservations: await fx.observed() });
  const gens = genCount(fx.transport);
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal(genCount(fx.transport), gens);
  assert.equal(keyCount(fx.transport, '.dup.json'), 1);
});

test('S3-18 reconciliation refuses a rolled-back anchored revocation without moving the anchor', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  assert.equal((await owner.anchoredAppend.appendRevocation(opEntry(1, tick()))).outcome, 'appended');
  const epoch = (await fx.anchor.readAuthorization(SCOPE)).epoch;
  const before = fx.transport.objects.size;
  fx.w.db.tables.auth_revocation.clear();
  const report = await owner.anchoredAppend.reconcile();
  assert.equal(report.status, 'unproven');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, epoch);
  assert.equal(fx.transport.objects.size, before);
  assert.equal(owner.anchoredAppend.status().serving, false);
});

test('S3-19 an unexplained store entry is UNPROVEN and is not adopted', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  const before = fx.transport.objects.size;
  fx.seedOp(op(4), gen(4), tick());
  const report = await owner.anchoredAppend.reconcile();
  assert.equal(report.status, 'unproven');
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 0);
  assert.equal(fx.transport.objects.size, before);
});

test('S3-20 an ack for a transition that never landed is UNPROVEN', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const genesisKey = [...fx.transport.objects.keys()].find(k => k.endsWith('.genesis.json'));
  const eventId = H64('false-ack');
  const key = genesisKey.slice(0, genesisKey.lastIndexOf('/') + 1) + eventId + '.ack.json';
  fx.transport.objects.set(key, {
    bytes: Buffer.from(JSON.stringify({
      v: 1, kind: 'ack', eventId, generation: 1, recordHash: H64('no-such-record'), status: 'ack',
    })),
    version: 'planted', metadata: {},
  });
  const before = fx.transport.objects.size;
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'unproven');
  assert.equal(fx.transport.objects.size, before);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 0);
});

test('S3-21 a witness head ahead of the anchor is unverifiable and writes nothing', async () => {
  const fx = await composerFixture();
  const current = await fx.seedGenesis();
  const before = fx.transport.objects.size;
  await fx.witnessStore.appendObservation({
    scope: SCOPE, incarnation: current.incarnation, epoch: 4,
    frontierDigest: H64('ahead'), recordHash: H64('ahead-record'),
    eventId: H64('ahead-event'), observedAt: tick(),
  });
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'unverifiable');
  assert.equal(owner.anchoredAppend.status().serving, false);
  assert.equal(fx.transport.objects.size, before);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 0);
});

test('S3-22 a clean scope reconciles with no writes', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const objects = fx.transport.objects.size;
  const rows = fx.ws.rows.length;
  const owner = await fx.openOwner();
  assert.equal(owner.anchoredAppend.status().status, 'clean');
  assert.equal(owner.anchoredAppend.status().serving, true);
  assert.equal(fx.transport.objects.size, objects);
  assert.equal(fx.ws.rows.length, rows);
  assert.equal((await fx.anchor.readAuthorization(SCOPE)).epoch, 0);
});

test('S3-23 a generation-race conflict retries the CAS once and does not adopt a second value', async () => {
  const fx = await composerFixture();
  await fx.seedGenesis();
  const owner = await fx.openOwner();
  fx.transport.failWhen(key => key.includes('/gen-'), 'conflict');
  const result = await owner.anchoredAppend.appendRevocation(opEntry(1, tick()));
  assert.equal(result.outcome, 'appended');
  assert.equal(result.state, 'W5');
  assert.equal(genCount(fx.transport), 2);
});
