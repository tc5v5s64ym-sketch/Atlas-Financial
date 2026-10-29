'use strict';
// Settlement production host (Plan #5 assembly): the composition root
// that wires P1's owners into startServer, the GAP-2 read-only
// authorization facade lifecycle, the canonical-file context adapter,
// the activation-off default, and the assembly-owned custody
// prerequisites from PR #772 (custody session/catalog preflight and
// confirmed custody connection closure).
//
// SQL/TLS, household policy and refresh/provider acquisition below are
// explicitly OFFLINE SYNTHETIC DOUBLES in the exact shape of the
// production-composition suite's world (test-settlement-production-
// composition.js): the pg driver is stubbed in this process only, so
// the host binds the synthetic Client exactly where production binds
// require('pg').Client. The custody world models GAP-1's two custody
// relations and the catalog state the host preflight validates.
// Labelled doubles, not live qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { EventEmitter } = require('node:events');

const householdId = 'household-' + 'a'.repeat(32);
const FIN_USER = 'settlement_financial';
const AUTH_USER = 'settlement_auth';
const CUSTODY_USER = 'settlement_custody';
const exclusionDomain = {
  ledgerNamespace: 'ledger-' + '1'.repeat(32),
  serializationAuthority: 'authority-' + '2'.repeat(32),
  historyAuthority: 'authority-' + '3'.repeat(32),
};
const syntheticPassword = 'synthetic-host-password';
const syntheticSessionSecret = 'synthetic-host-session-secret';
const appEnv = { SITE_PASSWORD: syntheticPassword,
  SESSION_SECRET: syntheticSessionSecret, ATLAS_LIVE_OVERLAY: 'live' };
const canary = 'SYNTHETIC-CONFIG-SECRET-CANARY';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const clone = x => structuredClone(x);
const C = require('../scripts/planned-obligation-settlement-contract');
// GAP-1 suite's own synthetic encryption pattern: a labelled test
// double, never a production cipher.
const syntheticEncrypt = async bytes =>
  Buffer.concat([Buffer.from('SYNTHETIC-CIPHER:'), Buffer.from(bytes)]);

// --- Synthetic pg world (adapted from the composition suite) --------
let active = null;
function metadata(kind) {
  const tables = kind === 'financial' ? ['doc_head', 'doc_staged', 'journal', 'quarantine'].map(name => ({ name, kind: 'r', persistence: 'p',
      rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
      columns: (name === 'quarantine' ? ['scope', 'name', 'label', 'bytes'] : ['scope', 'bytes']).map(name =>
        ({ name, type: name === 'bytes' ? 'bytea' : 'text', notNull: name !== 'label', generated: '' })),
      primaryKey: name === 'quarantine' ? ['scope', 'name'] : ['scope'] }))
    : Object.entries({ auth_eligibility: [['scope', 'text'], ['household_id', 'text'], ['operation_id', 'text'],
        ['generation', 'text'], ['confirmation_digest', 'text'], ['secret_digest', 'text'], ['issued_at', 'bigint']],
      auth_revocation: [['scope', 'text'], ['operation_id', 'text'], ['generation', 'text'], ['revoked_at', 'bigint']],
      auth_session_revocation: [['scope', 'text'], ['sid_digest', 'text'], ['revoked_at', 'bigint']] })
      .map(([name, columns]) => ({ name, kind: 'r', persistence: 'p', rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
        columns: columns.map(([name, type]) => ({ name, type, notNull: true, generated: '' })),
        primaryKey: name === 'auth_session_revocation' ? ['scope', 'sid_digest'] : ['scope', 'operation_id', 'generation'] }));
  if (kind === 'financial' && active && active.nativeHistory) {
    tables.push({ name: 'terminal_history', kind: 'r', persistence: 'p',
      rls: false, forceRls: false, unsafe: false, primaryKeyCount: 1,
      columns: [['scope', 'text'], ['history_bytes', 'bytea'], ['checkpoint_bytes', 'bytea']]
        .map(([name, type]) => ({ name, type, notNull: true, generated: '' })),
      primaryKey: ['scope'] });
  }
  return [
    [{ database: 'synthetic', user: kind + '_app', pid: kind === 'financial' ? 301 : 302, searchPath: 'pg_catalog' }],
    [{ canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false,
      replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0 }],
    [{ connect: true, schemaUsage: true, databaseCreate: false, schemaCreate: false, tables: true, functions: true }],
    tables,
  ];
}
function custodySchemaRows(w) {
  const col = (name, type) => ({ name, type, notNull: true, generated: '' });
  const pin = { name: 'custody_pin', kind: 'r', persistence: 'p', rls: false, forceRls: false,
    unsafe: false, primaryKeyCount: 1,
    columns: [col('scope', 'text'), col('household', 'text'), col('bytes', 'bytea')],
    primaryKey: ['scope'] };
  const backup = { name: 'custody_backup', kind: 'r', persistence: 'p', rls: false, forceRls: false,
    unsafe: false, primaryKeyCount: 1,
    columns: [col('scope', 'text'), col('household', 'text'), col('revision', 'text'),
      col('digest', 'text'), col('bytes', 'bytea'), col('integrity', 'text')],
    primaryKey: ['scope', 'revision', 'digest'] };
  switch (w.custodySchemaMode) {
    case 'unlogged': return [{ ...backup }, { ...pin, persistence: 'u' }];
    case 'rls': return [{ ...backup }, { ...pin, rls: true }];
    case 'missing': return [{ ...pin }];
    case 'extra': return [{ ...backup }, { ...pin }, { ...pin, name: 'surprise' }];
    default: return [{ ...backup }, { ...pin }];
  }
}
function custodyQuery(w, text, values) {
  const result = (rows = [], rowCount = 0) => ({ command: text.split(' ')[0], rows, rowCount });
  if (text.startsWith('SELECT current_database()')) {
    return result([{ database: 'atlas', user: CUSTODY_USER, pid: 303, searchPath: 'pg_catalog' }]);
  }
  if (text.includes('pg_roles')) {
    return result([{ canLogin: true, superuser: false, createDb: false, createRole: false,
      inherit: false, replication: false, bypassRls: false, connectionLimit: 1,
      memberships: 0, ownedObjects: 0 }]);
  }
  if (text.includes('has_database_privilege')) {
    return result([{ connect: true, schemaUsage: true, databaseCreate: false,
      schemaCreate: false, tables: w.custodyGrantsOk !== false }]);
  }
  if (text.includes('pg_class')) return result(custodySchemaRows(w));
  if (text.includes('custody_pin')) {
    if (text.startsWith('SELECT')) {
      return result(w.pinRow ? [{ household: w.pinRow.household, bytes: w.pinRow.bytes }] : []);
    }
    if (text.startsWith('INSERT')) {
      if (w.pinRow) { const e = new Error('duplicate key'); e.code = '23505'; throw e; }
      w.pinRow = { household: values[1], bytes: Buffer.from(values[2]) };
      return result([], 1);
    }
    if (text.startsWith('UPDATE')) {
      if (w.pinRow && w.pinRow.household === values[2] && w.pinRow.bytes.equals(values[3])) {
        w.pinRow = { household: values[2], bytes: Buffer.from(values[1]) };
        return result([], 1);
      }
      return result([], 0);
    }
  }
  if (text.includes('custody_backup')) {
    if (text.startsWith('INSERT')) {
      const key = values[2] + '|' + values[3];
      if (w.backups.has(key)) return result([], 0);
      w.backups.set(key, { household: values[1], revision: values[2], digest: values[3],
        bytes: Buffer.from(values[4]), integrity: values[5] });
      return result([], 1);
    }
    if (text.startsWith('SELECT') && text.includes('revision = $2')) {
      const e = w.backups.get(values[1] + '|' + values[2]);
      return result(e ? [{ ...e }] : []);
    }
    if (text.startsWith('SELECT')) return result([...w.backups.values()].map(e => ({ ...e })));
  }
  throw Error('unmodelled synthetic custody SQL');
}
class SyntheticClient extends EventEmitter {
  constructor(config) {
    super();
    this.kind = config.user === AUTH_USER ? 'authorization'
      : config.user === CUSTODY_USER ? 'custody' : 'financial';
    this.config = config; this.ends = 0; this.count = 0;
    this.connection = { stream: { encrypted: true, authorized: true, servername: 'db.example.test',
      getPeerCertificate: () => ({ subjectaltname: 'DNS:db.example.test' }) } };
    active.clients.push(this); active.events.push('construct:' + this.kind);
  }
  async connect() { active.events.push('connect:' + this.kind); if (active.hooks.connect) await active.hooks.connect(this.kind); }
  async end() {
    this.ends++; active.events.push('end:' + this.kind);
    if (this.kind === 'custody' && active.custodyEndScript
      && active.custodyEndScript.length > 0) {
      const step = active.custodyEndScript.shift();
      if (step === 'rejects') throw Error(canary);
      if (step === 'hangs') return new Promise(() => {});
    }
    if (this.kind === 'custody' && active.endModeArmed) {
      if (active.custodyEndMode === 'rejects') throw Error(canary);
      if (active.custodyEndMode === 'hangs') return new Promise(() => {});
    }
    if (active.hooks.end) await active.hooks.end(this.kind); this.emit('end');
  }
  async query(text, values = []) {
    const w = active; w.sql.push({ kind: this.kind, text, values });
    if (w.hooks.query) { const v = await w.hooks.query(this.kind, text, values); if (v !== undefined) return v; }
    if (this.kind === 'custody') return custodyQuery(w, text, values);
    if (this.count++ < 4) {
      // The identity row reports THIS session's own configured
      // database/user — the factories check it against the profile.
      return { command: 'SELECT', rows: this.count === 1
        ? [{ database: this.config.database, user: this.config.user,
            pid: this.kind === 'financial' ? 301 : 302, searchPath: 'pg_catalog' }]
        : metadata(this.kind)[this.count - 1] };
    }
    const result = (rows = [], rowCount = 0) => ({ command: text.split(' ')[0], rows, rowCount });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(text)) return result();
    if (this.kind === 'authorization') {
      const key = values[1] + '|' + values[2];
      if (text.startsWith('SELECT e.household_id')) {
        const e = w.eligibility.get(key);
        const rows = [e ? { household_id: e.householdId, operation_id: e.operationId, generation: e.generation,
          confirmation_digest: e.confirmationDigest, secret_digest: e.secretDigest, issued_at: String(e.issuedAt),
          operation_revoked: w.revoked.has(key), session_revoked: w.sessions.has(values[3]) }
          : { household_id: null, operation_id: null, generation: null, confirmation_digest: null, secret_digest: null, issued_at: null,
            operation_revoked: w.revoked.has(key), session_revoked: w.sessions.has(values[3]) }];
        if (w.hooks.snapshot) await w.hooks.snapshot(rows[0], values);
        return result(rows);
      }
      if (text.startsWith('SELECT scope, household_id')) {
        const e = w.eligibility.get(key); return result(e ? [{ scope: values[0], household_id: e.householdId,
          operation_id: e.operationId, generation: e.generation, confirmation_digest: e.confirmationDigest,
          secret_digest: e.secretDigest, issued_at: String(e.issuedAt) }] : []);
      }
      if (text.startsWith('SELECT revoked_at')) return result((text.includes('auth_session_revocation')
        ? w.sessions.has(values[1]) : w.revoked.has(key)) ? [{ revoked_at: '1' }] : []);
      if (text.startsWith('INSERT INTO')) {
        if (text.includes('auth_eligibility')) w.eligibility.set(values[2] + '|' + values[3], {
          householdId: values[1], operationId: values[2], generation: values[3], confirmationDigest: values[4],
          secretDigest: values[5], issuedAt: values[6] });
        else if (text.includes('auth_session_revocation')) w.sessions.add(values[1]);
        else w.revoked.add(key);
        return result([], 1);
      }
    } else {
      if (text.includes('pg_try_advisory_lock')) return result([{ locked: true }]);
      if (text.includes('pg_advisory_unlock')) return result([{ unlocked: true }]);
      if (text.includes('pg_backend_pid')) return result([{ pid: 301 }]);
      if (text.includes('.terminal_history')) {
        if (text.startsWith('SELECT history_bytes')) {
          return result(w.terminalRow ? [{ history_bytes: w.terminalRow.historyBytes,
            checkpoint_bytes: w.terminalRow.checkpointBytes }] : []);
        }
        if (text.startsWith('UPDATE')) {
          if (w.terminalRow && w.terminalRow.historyBytes.equals(values[3])
            && w.terminalRow.checkpointBytes.equals(values[4])) {
            w.terminalRow = { historyBytes: Buffer.from(values[1]),
              checkpointBytes: Buffer.from(values[2]) };
            return result([], 1);
          }
          return result([], 0);
        }
      }
      if (text.startsWith('SELECT bytes FROM')) {
        const field = text.includes('.doc_head') ? 'doc' : text.includes('.journal') ? 'journal' : 'temp';
        return result(w[field] ? [{ bytes: Buffer.from(w[field]) }] : []);
      }
      if (text.startsWith('WITH s AS')) { w.doc = w.temp; w.temp = null; return result([], 1); }
      if (text.startsWith('INSERT INTO')) {
        if (text.includes('.quarantine')) throw Error('synthetic maintenance forbidden');
        w[text.includes('.doc_staged') ? 'temp' : 'journal'] = Buffer.from(values[1]); return result([], 1);
      }
      if (text.startsWith('DELETE FROM')) { w[text.includes('.journal') ? 'journal' : 'temp'] = null; return result([], 1); }
    }
    throw Error('unmodelled synthetic SQL');
  }
}
// The host binds require('pg').Client; stub the driver in THIS process
// before the host (or anything binding it) is loaded.
const pgPath = require.resolve('pg', { paths: [path.join(__dirname, '..')] });
require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true,
  exports: { Client: SyntheticClient } };

const Refresh = require('../scripts/server-live-refresh');
const Server = require('../server');
const { startServer } = Server;
const { createSettlementProductionHost } = require('../scripts/settlement-production-host');
const Owners = require('../scripts/settlement-production-owners');
const { op } = require('./test-settlement-evidence-terminal-certificate');

function makeWorld() {
  const w = { time: Date.now(), clients: [], sql: [], events: [], hooks: {},
    eligibility: new Map(), revoked: new Set(), sessions: new Set(),
    doc: null, journal: null, temp: null,
    pinRow: null, backups: new Map(), custodySchemaMode: 'ok',
    custodyGrantsOk: true, custodyEndMode: 'ok', endModeArmed: false,
    custodyEndScript: null,
    nativeHistory: false,
    servedTitles: [], acquireCalls: 0, witnessCalls: 0, allowed: true };
  // The provisioned genesis terminal-history row native mode requires
  // (explicit provisioning is maintenance-owned outside startup; the
  // world models it as already provisioned).
  const genesisBody = { schema: 'terminal-history-1', householdId,
    ledgerNamespace: exclusionDomain.ledgerNamespace, revision: 0, records: [] };
  const genesisDigest = C.digest(genesisBody);
  w.terminalRow = {
    historyBytes: Buffer.from(JSON.stringify({ ...genesisBody, digest: genesisDigest })),
    checkpointBytes: Buffer.from(JSON.stringify({
      schema: 'terminal-history-checkpoint-1', householdId,
      ledgerNamespace: exclusionDomain.ledgerNamespace,
      revision: 0, digest: genesisDigest })),
  };
  const fixture = require('./fixtures/savings-daily-consumer-data')();
  fixture.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  w.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-host-suite-'));
  w.canonicalFile = path.join(w.dir, 'data.json');
  fs.writeFileSync(w.canonicalFile, JSON.stringify(fixture));
  w.base = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  const packet = clone(w.base.liveOverlay.currentPeriodActuals);
  packet.transactions = [{ id: 'synthetic-row', date: '2026-10-03', amount: 60, currency: 'cad', pending: false,
    categoryLabel: 'Groceries', merchantKnown: true, atlasAccountId: 'chequing-a', accountRole: 'household-cash',
    displayedPayee: 'Synthetic recorded payment' }];
  packet.transactionWindow = { startDate: '2026-10-02', endDate: '2026-10-05', complete: true, hasMore: false, truncated: false };
  w.acquisition = { packet, plan: clone(w.base.plan), join: [{ localId: 'synthetic-row',
    providerAccountId: 'SYNTHETIC-ACCOUNT', transactionId: 'SYNTHETIC-TRANSACTION' }],
    map: { mappings: [{ providerAccountId: 'SYNTHETIC-ACCOUNT', canonical: { id: 'chequing-a', collection: 'cash' } }] } };
  return w;
}

// Labelled provider/refresh DOUBLES, the composition suite's pattern:
// serve replays the context canonical; acquisition pairs the fixture
// packet with a witness bound to the issuing context revision.
function installDoubles(t, w) {
  const serve = Refresh.serve, acquire = Refresh.acquireSettlementWithWitness;
  Refresh.serve = async c => { w.servedTitles.push(c && c.meta ? c.meta.title : null); return clone(c); };
  Refresh.acquireSettlementWithWitness = async (c, e, o) => {
    w.acquireCalls++; assert.equal(typeof o.contextReader, 'function');
    const captured = clone(o.contextReader());
    assert.deepEqual(c, captured.canonical); assert.deepEqual(e, captured.env);
    return { acquisition: clone(w.acquisition), witness: () => { w.witnessCalls++;
      const cur = o.contextReader();
      return cur.contextRevision === captured.contextRevision && cur.domain === captured.domain; } };
  };
  t.after(() => { Refresh.serve = serve; Refresh.acquireSettlementWithWitness = acquire; });
}

function request(w, urlPath, body, cookie = w.cookie) {
  return new Promise((resolve, reject) => {
    const bytes = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request(w.url + urlPath, { method: bytes ? 'POST' : 'GET', agent: false, headers: {
      ...(cookie ? { Cookie: cookie } : {}), ...(bytes ? { 'Content-Type': typeof body === 'string' ? 'application/x-www-form-urlencoded' : 'application/json',
        'Content-Length': bytes.length, Origin: 'https://atlas.example.test', 'X-Atlas-Settlement': 'same-origin', 'Sec-Fetch-Site': 'same-origin' } : {}) } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', x => { raw += x; }); res.on('end', () => {
        let value; try { value = JSON.parse(raw); } catch { value = raw; } resolve({ status: res.statusCode, headers: res.headers, value }); });
    });
    req.setTimeout(5000, () => req.destroy(Error('synthetic request deadline'))); req.on('error', reject); req.end(bytes);
  });
}
async function login(w) {
  const r = await request(w, '/login', 'password=' + appEnv.SITE_PASSWORD, null);
  assert.equal(r.status, 302); return r.headers['set-cookie'][0].split(';')[0];
}
const sidOf = cookie => JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url')).sid;
async function prepared(w, n = 1) {
  const catalogue = (await request(w, '/settlement/selections', {})).value;
  assert.equal(catalogue.status, 'available');
  const r = (await request(w, '/settlement/prepare', { operationId: op(n), selection: {
    transaction: catalogue.transactions[0].handle,
    commitment: catalogue.commitments.find(x => x.label.includes('first')).handle }, assignedCents: 2500 })).value;
  assert.equal(r.status, 'prepared'); assert.match(r.recoverySecret, /^[a-f0-9]{64}$/); return r;
}
const confirm = (w, p) => request(w, '/settlement/confirm',
  { operationId: p.operationId, previewToken: p.previewToken, generation: p.generation, confirmed: true });
const credential = p => ({ operationId: p.operationId, generation: p.generation, recoverySecret: p.recoverySecret });

// Maintenance bootstrap, the production pattern: genesis is written
// OUTSIDE startup by composing the shipped connection factory and the
// evidence store directly over the same custody — the server runtime
// deliberately exposes no bootstrap. Labelled synthetic world, same
// factories a maintenance tool composes.
async function bootstrapCustody(profile, custody, now) {
  const { createSettlementEvidencePostgresConnection } =
    require('../scripts/settlement-evidence-postgres-connection');
  const { createSettlementEvidenceStore } = require('../scripts/settlement-evidence-store');
  const owner = await createSettlementEvidencePostgresConnection(profile);
  try {
    const store = createSettlementEvidenceStore({ householdId,
      documentStore: owner.documentStore, journalStore: owner.journalStore,
      quarantine: owner.quarantine, lock: owner.lock,
      pinStore: custody.pinStore, backupStore: custody.backupStore,
      terminalHistory: custody.terminalHistory.mode === 'postgres'
        ? owner.terminalHistory : custody.terminalHistory,
      exclusionDomain: custody.exclusionDomain, now });
    assert.equal((await store.bootstrap()).status, 'bootstrapped');
  } finally { await owner.retire(); }
}

function hostConfig(w, overrides = {}) {
  return { ...appEnv,
    SETTLEMENT_FINANCIAL_DB_HOST: 'db.example.test', SETTLEMENT_FINANCIAL_DB_PORT: '5432',
    SETTLEMENT_FINANCIAL_DB_NAME: 'atlas', SETTLEMENT_FINANCIAL_DB_USER: FIN_USER,
    SETTLEMENT_FINANCIAL_DB_PASSWORD: canary, SETTLEMENT_FINANCIAL_DB_SCHEMA: 'settlement_financial',
    SETTLEMENT_FINANCIAL_DB_SCOPE: 'synthetic-scope',
    SETTLEMENT_AUTH_DB_HOST: 'db.example.test', SETTLEMENT_AUTH_DB_PORT: '5432',
    SETTLEMENT_AUTH_DB_NAME: 'atlas', SETTLEMENT_AUTH_DB_USER: AUTH_USER,
    SETTLEMENT_AUTH_DB_PASSWORD: canary, SETTLEMENT_AUTH_DB_SCHEMA: 'settlement_auth',
    SETTLEMENT_AUTH_DB_SCOPE: 'synthetic-scope',
    SETTLEMENT_HOUSEHOLD_ID: householdId, SETTLEMENT_ORIGIN: 'https://atlas.example.test',
    SETTLEMENT_CONTEXT_DOMAIN: 'synthetic-household-authority',
    SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: exclusionDomain.ledgerNamespace,
    SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: exclusionDomain.serializationAuthority,
    SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: exclusionDomain.historyAuthority,
    canonicalFile: w.canonicalFile, ...overrides };
}
function custodyConfig(overrides = {}) {
  return {
    SETTLEMENT_CUSTODY_DB_HOST: 'db.example.test', SETTLEMENT_CUSTODY_DB_PORT: '5432',
    SETTLEMENT_CUSTODY_DB_NAME: 'atlas', SETTLEMENT_CUSTODY_DB_USER: CUSTODY_USER,
    SETTLEMENT_CUSTODY_DB_PASSWORD: canary, SETTLEMENT_CUSTODY_DB_SCHEMA: 'settlement_custody',
    SETTLEMENT_CUSTODY_DB_SCOPE: 'custody-scope', ...overrides };
}
const profileFor = user => ({ Client: SyntheticClient,
  config: { host: 'db.example.test', port: 5432, database: 'atlas', user, password: canary,
    ssl: { rejectUnauthorized: true, servername: 'db.example.test' } },
  schema: user === AUTH_USER ? 'settlement_auth' : 'settlement_financial', scope: 'synthetic-scope' });

test('host is inactive with no settlement values; the entry path stays preactivation', async t => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost({ ...appEnv });
  assert.equal(host.active, false); assert.equal(host.settlement, null);
  const owner = await startServer({ env: { ...appEnv }, host: '127.0.0.1', port: 0,
    baseSource: async () => clone(w.base) });
  t.after(() => owner.close());
  const url = 'http://127.0.0.1:' + owner.server.address().port;
  const cookie = await login({ url });
  const capability = await request({ url, cookie }, '/settlement/capability');
  assert.equal(capability.value.status, 'inactive');
  assert.equal(w.clients.length, 0);
});

test('host refuses partial or malformed configuration by field name, before any client exists', () => {
  const w = makeWorld(); active = w;
  const cases = [];
  const without = key => { const c = hostConfig(w); delete c[key];
    cases.push([c, key]); };
  without('SETTLEMENT_HOUSEHOLD_ID');
  without('SETTLEMENT_AUTH_DB_PASSWORD');
  without('SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY');
  without('SETTLEMENT_FINANCIAL_DB_SCOPE');
  cases.push([hostConfig(w, { SETTLEMENT_HOUSEHOLD_ID: 'household-xyz' }), 'SETTLEMENT_HOUSEHOLD_ID']);
  cases.push([hostConfig(w, { SETTLEMENT_FINANCIAL_DB_HOST: 'db-pooler.example.test' }), 'SETTLEMENT_FINANCIAL_DB_HOST']);
  cases.push([hostConfig(w, { SETTLEMENT_FINANCIAL_DB_HOST: 'localhost' }), 'SETTLEMENT_FINANCIAL_DB_HOST']);
  cases.push([hostConfig(w, { SETTLEMENT_AUTH_DB_USER: FIN_USER,
    SETTLEMENT_AUTH_DB_SCHEMA: 'settlement_financial' }), 'SETTLEMENT_AUTH_DB_USER']);
  cases.push([hostConfig(w, { SETTLEMENT_ORIGIN: 'https://atlas.example.test/path' }), 'SETTLEMENT_ORIGIN']);
  cases.push([hostConfig(w, { SETTLEMENT_FINANCIAL_DB_SSL_SERVERNAME: 'other.example.test' }),
    'SETTLEMENT_FINANCIAL_DB_SSL_SERVERNAME']);
  cases.push([hostConfig(w, { SETTLEMENT_FINANCIAL_DB_PORT: '70000' }), 'SETTLEMENT_FINANCIAL_DB_PORT']);
  // The custody profile is a group: any part of it requires all of it,
  // under its own schema and scope.
  const partialCustody = { ...hostConfig(w), ...custodyConfig() };
  delete partialCustody.SETTLEMENT_CUSTODY_DB_SCOPE;
  cases.push([partialCustody, 'SETTLEMENT_CUSTODY_DB_SCOPE']);
  cases.push([{ ...hostConfig(w), ...custodyConfig({ SETTLEMENT_CUSTODY_DB_SCHEMA: 'settlement_financial' }) },
    'SETTLEMENT_CUSTODY_DB_SCHEMA']);
  cases.push([{ ...hostConfig(w), ...custodyConfig({ SETTLEMENT_CUSTODY_DB_SCOPE: 'synthetic-scope' }) },
    'SETTLEMENT_CUSTODY_DB_SCOPE']);
  // An OPTIONAL custody key alone is still custody group presence:
  // the group is detected from every known custody key, so a lone
  // SETTLEMENT_CUSTODY_DB_SSL_SERVERNAME refuses by the first missing
  // required key instead of silently selecting memory custody.
  cases.push([{ ...hostConfig(w), SETTLEMENT_CUSTODY_DB_SSL_SERVERNAME: 'db.example.test' },
    'SETTLEMENT_CUSTODY_DB_HOST']);
  for (const [config, field] of cases) {
    assert.throws(() => createSettlementProductionHost(config, { encrypt: syntheticEncrypt }),
      new RegExp('settlement-production-host: invalid configuration — ' + field), field);
  }
  // Durable custody without the injected encryption function refuses
  // by name rather than composing unencrypted backups.
  assert.throws(() => createSettlementProductionHost({ ...hostConfig(w), ...custodyConfig() }),
    /settlement-production-host: durable custody requires the injected encryption function/);
  assert.equal(w.clients.length, 0);
});

test('host builds the exact closed settlement record from P1 owners and constructs nothing', () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  assert.equal(host.active, true);
  assert.deepEqual(Object.keys(host).sort(),
    ['active', 'close', 'prepare', 'retireCustody', 'settlement', 'startContextAdapter']);
  const s = host.settlement;
  assert.deepEqual(Object.keys(s).sort(), ['application', 'authorization', 'connection', 'custody']);
  for (const profile of [s.connection, s.authorization]) {
    assert.deepEqual(Object.keys(profile).sort(), ['Client', 'config', 'schema', 'scope']);
    assert.equal(profile.Client, SyntheticClient);
    assert.deepEqual(Object.keys(profile.config).sort(),
      ['database', 'host', 'password', 'port', 'ssl', 'user']);
    assert.equal(profile.config.port, 5432);
    assert.deepEqual(profile.config.ssl, { rejectUnauthorized: true, servername: 'db.example.test' });
  }
  assert.equal(s.connection.config.user, FIN_USER);
  assert.equal(s.authorization.config.user, AUTH_USER);
  assert.deepEqual(Object.keys(s.custody).sort(),
    ['backupStore', 'exclusionDomain', 'pinStore', 'terminalHistory']);
  assert.deepEqual(s.custody.exclusionDomain, exclusionDomain);
  assert.deepEqual(Object.keys(s.application).sort(),
    ['authorize', 'authorizeRecovery', 'contextReader', 'householdId', 'now', 'origin']);
  assert.equal(s.application.householdId, householdId);
  assert.equal(s.application.origin, 'https://atlas.example.test');
  assert.equal(util.types.isAsyncFunction(s.application.authorize), false);
  // advanceContext is host-private: it appears on neither the record
  // handed to startServer nor the host handle.
  assert.equal('advanceContext' in s.application, false);
  assert.equal('advanceContext' in host, false);
  // Composing is wiring, not activation: no client was constructed and
  // nothing is listening until the entry calls startServer.
  assert.equal(w.clients.length, 0);
  host.close();
});

test('GAP-2 facade: refuses before binding and after retirement, delegates to the composition\u2019s own guarded read while ready', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const authorization = profileFor(AUTH_USER);
  const facade = Server.createSettlementAuthorizationReadFacade(authorization);
  assert.equal(typeof facade.readAuthorizationState, 'function');
  assert.throws(() => Server.createSettlementAuthorizationReadFacade(authorization), /composition/);
  const owners = Owners.createSettlementProductionOwners({ householdId,
    authorizationStore: facade,
    context: { canonical: clone(w.base), env: { ...appEnv }, domain: 'synthetic-household-authority' } });
  const custody = Owners.createSettlementProductionCustody(
    { householdId, exclusionDomain, now: () => w.time });
  const settlement = { connection: profileFor(FIN_USER), authorization,
    custody: { pinStore: custody.pinStore, backupStore: custody.backupStore,
      terminalHistory: custody.terminalHistory, exclusionDomain: custody.exclusionDomain },
    application: { householdId, origin: 'https://atlas.example.test',
      authorize: owners.authorize, authorizeRecovery: owners.authorizeRecovery,
      contextReader: owners.contextReader, now: () => w.time } };
  const probe = { operationId: op(9), generation: 'generation-' + '9'.repeat(32), sidDigest: 'e'.repeat(64) };
  // Before binding: both the facade and P1's preliminary policy refuse,
  // and the refusal does not touch or retire any composition.
  await assert.rejects(facade.readAuthorizationState(probe), /composition/);
  await assert.rejects(owners.authorizeRecovery({ householdId,
    actorId: 'session-' + 'b'.repeat(64), operationId: op(9), generation: probe.generation }), /refused/);
  await bootstrapCustody(profileFor(FIN_USER), custody, () => w.time);
  const start = () => startServer({ env: { ...appEnv }, host: '127.0.0.1', port: 0, settlement });
  t.after(async () => { if (w.owner) await w.owner.close().catch(() => {}); });
  let owner = await start();
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  const actorId = 'session-' + sidOf(w.cookie);
  const p = await prepared(w);
  // While ready, the facade delegates to the composition's own guarded
  // store read: live eligibility for the issued operation is visible,
  // and P1's preliminary admission resolves from that same read.
  const state = await facade.readAuthorizationState(
    { operationId: p.operationId, generation: p.generation, sidDigest: hash(sidOf(w.cookie)) });
  assert.equal(state.state, 'ok');
  assert.equal(state.eligibility.householdId, householdId);
  const grant = await owners.authorizeRecovery({ householdId, actorId,
    operationId: p.operationId, generation: p.generation });
  assert.deepEqual(grant, { householdId, actorId, operationId: p.operationId });
  await owner.close();
  // After retirement the facade refuses at once — no stale generation
  // is retained and nothing is replayed from a cache.
  await assert.rejects(facade.readAuthorizationState(
    { operationId: p.operationId, generation: p.generation, sidDigest: hash(sidOf(w.cookie)) }), /composition/);
  await assert.rejects(owners.authorizeRecovery({ householdId, actorId,
    operationId: p.operationId, generation: p.generation }), /refused/);
  // A fresh composition over the same profile rebinds the same facade
  // to the NEW composition's guarded read.
  owner = await start();
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  const grant2 = await owners.authorizeRecovery({ householdId,
    actorId: 'session-' + sidOf(w.cookie), operationId: p.operationId, generation: p.generation });
  assert.equal(grant2.operationId, p.operationId);
  await owner.close();
});

test('host composition serves the settlement journey end to end', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const config = hostConfig(w);
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const mark = w.events.length;
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  assert.equal(owner.status().state, 'ready');
  assert.deepEqual(w.events.slice(mark, mark + 4),
    ['construct:financial', 'connect:financial', 'construct:authorization', 'connect:authorization']);
  const p = await prepared(w);
  const r = await confirm(w, p);
  assert.equal(r.value.status, 'committed');
  assert.equal(JSON.parse(w.doc).revision, 1);
  const later = await login(w);
  const recovered = await request(w, '/settlement/outcome', credential(p), later);
  assert.deepEqual(recovered.value, { status: 'committed', operationId: p.operationId });
  assert.equal((await request(w, '/data.json')).value.settlementEvidenceStatus.status, 'qualified');
});

test('canonical adapter advances the trusted context on file change, including an ABA return', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const config = hostConfig(w);
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  host.startContextAdapter();
  const v1 = fs.readFileSync(w.canonicalFile, 'utf8');
  const title1 = JSON.parse(v1).meta.title;
  const v2 = JSON.stringify({ ...JSON.parse(v1), meta: { ...JSON.parse(v1).meta,
    title: title1 + ' (revised)' } });
  const title2 = JSON.parse(v2).meta.title;
  const served = async () => { await request(w, '/data.json'); return w.servedTitles.at(-1); };
  const until = async want => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await served() === want) return;
      await new Promise(r => setTimeout(r, 50));
    }
    throw Error('canonical change was not adopted: ' + want);
  };
  assert.equal(await served(), title1);
  fs.writeFileSync(w.canonicalFile, v2);
  await until(title2);
  assert.equal(owner.status().state, 'ready');
  // ABA: the file returns to the exact earlier bytes; the fingerprint
  // still moves (ctime/mtime), the revision advances again, and the
  // composition adopts the returned contents without retiring.
  fs.writeFileSync(w.canonicalFile, v1);
  await until(title1);
  assert.equal(owner.status().state, 'ready');
});

test('an unwired context reader fails closed on the first canonical change', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const custody = Owners.createSettlementProductionCustody(
    { householdId, exclusionDomain, now: () => w.time });
  // The pre-P1 pattern the adapter replaces: a reader backed directly
  // by the mutable file at a fixed revision. server.js's context guard
  // must retire the composition when the contents move underneath it.
  const settlement = { connection: profileFor(FIN_USER), authorization: profileFor(AUTH_USER),
    custody: { pinStore: custody.pinStore, backupStore: custody.backupStore,
      terminalHistory: custody.terminalHistory, exclusionDomain: custody.exclusionDomain },
    application: { householdId, origin: 'https://atlas.example.test',
      authorize: c => ({ householdId, actorId: c.actorId }),
      authorizeRecovery: async c => ({ householdId, actorId: c.actorId, operationId: c.operationId }),
      contextReader: () => ({ canonical: JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8')),
        env: { ...appEnv }, domain: 'synthetic-household-authority', contextRevision: 1 }),
      now: () => w.time } };
  const owner = await startServer({ env: { ...appEnv }, host: '127.0.0.1', port: 0, settlement });
  t.after(() => owner.close());
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  assert.equal((await request(w, '/data.json')).status, 200);
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  fs.writeFileSync(w.canonicalFile,
    JSON.stringify({ ...v1, meta: { ...v1.meta, title: v1.meta.title + ' (revised)' } }));
  assert.equal((await request(w, '/data.json')).status, 503);
  assert.notEqual(owner.status().state, 'ready');
});

test('durable custody: preflight gates the binding, the journey runs over GAP-1 stores and native history, closure is confirmed', async t => {
  const w = makeWorld(); active = w; w.nativeHistory = true; installDoubles(t, w);
  const config = { ...hostConfig(w), ...custodyConfig() };
  // Before prepare() runs the preflight, no custody client can be
  // constructed at all: a custody operation on a fresh durable host
  // refuses (probed on a throwaway host — GAP-1 fences a lost session
  // permanently, exactly as designed).
  const probe = createSettlementProductionHost(config, { encrypt: syntheticEncrypt });
  await assert.rejects(probe.settlement.custody.pinStore.read(), /custody|unavailable/);
  const host = createSettlementProductionHost(config, { encrypt: syntheticEncrypt });
  assert.deepEqual(host.settlement.custody.terminalHistory, { mode: 'postgres' });
  await host.prepare();
  await bootstrapCustody({ ...host.settlement.connection,
    terminalHistory: { householdId, ledgerNamespace: exclusionDomain.ledgerNamespace } },
    host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { await owner.close(); await host.retireCustody(); host.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  assert.equal(owner.status().state, 'ready');
  const p = await prepared(w);
  const r = await confirm(w, p);
  assert.equal(r.value.status, 'committed');
  assert.equal(JSON.parse(w.doc).revision, 1);
  const later = await login(w);
  const recovered = await request(w, '/settlement/outcome', credential(p), later);
  assert.deepEqual(recovered.value, { status: 'committed', operationId: p.operationId });
  assert.equal((await request(w, '/data.json')).value.settlementEvidenceStatus.status, 'qualified');
  // The durable surfaces really were used: the pin advanced over the
  // custody session, backups landed in custody_backup, and the native
  // terminal-history gate was read and qualified through the financial
  // session on the journey's own operations (a missing or malformed
  // provisioned row fails those operations as unavailable). Positive
  // commits do not append certificates — only negative seals do, a
  // path the terminal-certificate suites own — so the provisioned
  // genesis row correctly remains at revision 0.
  assert.ok(w.pinRow, 'pin row exists in the custody schema');
  assert.ok(w.backups.size > 0, 'document backups landed in custody_backup');
  assert.ok(w.sql.some(e => e.kind === 'financial' && e.text.includes('.terminal_history')
    && e.text.startsWith('SELECT history_bytes')), 'native terminal history read on the journey');
  assert.equal(JSON.parse(w.terminalRow.historyBytes.toString('utf8')).revision, 0);
  await owner.close();
  // The composition root's closure receipt: confirmed, because the
  // custody session's underlying end() actually resolved.
  assert.deepEqual(await host.retireCustody(), { state: 'retired', close: 'confirmed' });
});

test('custody qualification runs on the actual operational session: a bad catalog, short grants, or a failed connect refuse the first custody operation with zero application queries', async () => {
  // Qualification is a property of the RETAINED operational session,
  // discharged inside its own connect — there is no probe session
  // whose success could license an unvalidated one. prepare() opens
  // the construction gate only; the first custody operation either
  // qualifies its own session or fails closed, and no application
  // statement ever reaches an unqualified session.
  const applicationSql = w => w.sql.filter(e => e.kind === 'custody'
    && e.text.includes('"settlement_custody".custody_'));
  const qualificationSql = w => w.sql.filter(e => e.kind === 'custody'
    && (e.text.startsWith('SELECT current_database()') || e.text.includes('pg_class')));
  for (const mode of ['unlogged', 'rls', 'missing', 'extra']) {
    const w = makeWorld(); active = w; w.custodySchemaMode = mode;
    const host = createSettlementProductionHost(
      { ...hostConfig(w), ...custodyConfig() }, { encrypt: syntheticEncrypt });
    await host.prepare();
    await assert.rejects(host.settlement.custody.pinStore.read(),
      /unavailable/, mode);
    // The qualification catalog queries ran on the operational
    // session itself — and not one application statement did.
    assert.ok(qualificationSql(w).length > 0, mode + ': qualification attempted');
    assert.equal(applicationSql(w).length, 0, mode + ': zero application queries');
  }
  // Grants short of the relation contract refuse the operation too.
  const wg = makeWorld(); active = wg; wg.custodyGrantsOk = false;
  const grantHost = createSettlementProductionHost(
    { ...hostConfig(wg), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await grantHost.prepare();
  await assert.rejects(grantHost.settlement.custody.pinStore.read(), /unavailable/);
  assert.equal(applicationSql(wg).length, 0);
  // Cannot be performed: the custody session cannot even connect.
  const w = makeWorld(); active = w;
  w.hooks.connect = kind => { if (kind === 'custody') throw Error(canary); };
  const host = createSettlementProductionHost(
    { ...hostConfig(w), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host.prepare();
  await assert.rejects(host.settlement.custody.pinStore.read(), /unavailable/);
  assert.equal(applicationSql(w).length, 0);
});

test('composition root surfaces custody closure it cannot confirm', async () => {
  // Not started: prepared but no custody operation ever ran — no
  // session exists, and the receipt says so honestly.
  const w0 = makeWorld(); active = w0;
  const host0 = createSettlementProductionHost(
    { ...hostConfig(w0), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host0.prepare();
  assert.deepEqual(await host0.retireCustody(), { state: 'retired', close: 'not-started' });
  // Failed: the session's end() rejects. GAP-1's retire() suppresses
  // that by design (local fencing only); the composition root's
  // observing wrapper records it and the receipt surfaces the failure.
  const w1 = makeWorld(); active = w1;
  const host1 = createSettlementProductionHost(
    { ...hostConfig(w1), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host1.prepare();
  w1.endModeArmed = true; w1.custodyEndMode = 'rejects';
  assert.equal(await host1.settlement.custody.pinStore.read(), null);
  assert.deepEqual(await host1.retireCustody(), { state: 'lost', close: 'failed' });
  // Unconfirmed: the session's end() never settles within the bound.
  const w2 = makeWorld(); active = w2;
  const host2 = createSettlementProductionHost(
    { ...hostConfig(w2), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host2.prepare();
  w2.endModeArmed = true; w2.custodyEndMode = 'hangs';
  assert.equal(await host2.settlement.custody.pinStore.read(), null);
  assert.deepEqual(await host2.retireCustody(), { state: 'lost', close: 'unconfirmed' });
});

// --- Repair tests: Atlas BLOCKING review on PR #774 head 5d175dc3 ---
const withDeadline = (promise, ms, label) => Promise.race([promise,
  new Promise((_, reject) => setTimeout(() => reject(Error('deadline: ' + label)), ms))]);
const pollUntil = async (check, ms, label) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() >= deadline) throw Error('deadline: ' + label);
    await new Promise(r => setTimeout(r, 25));
  }
};

test('the operational custody session itself is qualified: session-level TLS divergence refuses custody with zero application queries', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(
    { ...hostConfig(w), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host.prepare();
  // The configuration is identical and valid; THIS session's TLS
  // state is what diverges (the double degrades the stream of the
  // session constructed after prepare). There is no probe whose
  // success could license it: qualification judges the operational
  // session inside its own connect, so the operation refuses.
  w.hooks.connect = kind => {
    if (kind !== 'custody') return;
    const client = w.clients.filter(c => c.kind === 'custody').at(-1);
    if (client) client.connection.stream.authorized = false;
  };
  await assert.rejects(host.settlement.custody.pinStore.read(), /unavailable/);
  assert.equal(w.sql.filter(e => e.kind === 'custody'
    && e.text.includes('"settlement_custody".custody_')).length, 0);
});

test('the operational custody session itself is qualified: session-level identity divergence refuses custody with zero application queries', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(
    { ...hostConfig(w), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host.prepare();
  // The operational session presents a different login identity than
  // the profile names. Identical config objects are not session
  // identity: the connect-time identity check on THIS session fails.
  w.hooks.query = (kind, text) => {
    if (kind === 'custody' && text.startsWith('SELECT current_database()')) {
      return { command: 'SELECT', rows: [{ database: 'atlas', user: FIN_USER,
        pid: 303, searchPath: 'pg_catalog' }] };
    }
    return undefined;
  };
  await assert.rejects(host.settlement.custody.pinStore.read(), /unavailable/);
  assert.equal(w.sql.filter(e => e.kind === 'custody'
    && e.text.includes('"settlement_custody".custody_')).length, 0);
});

test('close evidence is monotonic: a failed or unconfirmed end attempt is never erased by a later resolution', async () => {
  // reject -> resolve: the session-loss path ends the session
  // (attempt 1 rejects); retirement ends it again (attempt 2
  // resolves). The composition root's receipt keeps the failure.
  const w1 = makeWorld(); active = w1;
  const host1 = createSettlementProductionHost(
    { ...hostConfig(w1), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host1.prepare();
  assert.equal(await host1.settlement.custody.pinStore.read(), null);
  const client1 = w1.clients.filter(c => c.kind === 'custody').at(-1);
  w1.custodyEndScript = ['rejects'];
  client1.emit('error', Error('synthetic session error'));
  await pollUntil(() => client1.ends >= 1, 5000, 'first end attempt (rejects)');
  assert.deepEqual(await host1.retireCustody(), { state: 'lost', close: 'failed' });
  // never-settles -> resolve: attempt 1 hangs forever; retirement's
  // attempt 2 resolves. The receipt stays unconfirmed — a hung close
  // attempt is never erased by a later resolution.
  const w2 = makeWorld(); active = w2;
  const host2 = createSettlementProductionHost(
    { ...hostConfig(w2), ...custodyConfig() }, { encrypt: syntheticEncrypt });
  await host2.prepare();
  assert.equal(await host2.settlement.custody.pinStore.read(), null);
  const client2 = w2.clients.filter(c => c.kind === 'custody').at(-1);
  w2.custodyEndScript = ['hangs'];
  client2.emit('error', Error('synthetic session error'));
  await pollUntil(() => client2.ends >= 1, 5000, 'first end attempt (hangs)');
  assert.deepEqual(await host2.retireCustody(), { state: 'lost', close: 'unconfirmed' });
});

test('a full custody profile with a matching optional SSL_SERVERNAME composes the durable binding', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(
    { ...hostConfig(w), ...custodyConfig(
      { SETTLEMENT_CUSTODY_DB_SSL_SERVERNAME: 'db.example.test' }) },
    { encrypt: syntheticEncrypt });
  // The durable binding (native terminal history), not memory custody.
  assert.deepEqual(host.settlement.custody.terminalHistory, { mode: 'postgres' });
  await host.prepare();
  assert.equal(await host.settlement.custody.pinStore.read(), null);
  host.close();
});

test('canonical adapter: a coalesced A→B→A rewrite advances the reported revision (actual host reader)', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const v1 = fs.readFileSync(w.canonicalFile, 'utf8');
  const title = JSON.parse(v1).meta.title;
  const vB = JSON.stringify({ ...JSON.parse(v1),
    meta: { ...JSON.parse(v1).meta, title: title + ' (intervening)' } });
  // Both writes land in one synchronous turn: no watcher callback can
  // observe B, so a sync sees only the returned-to A bytes under a
  // moved fingerprint — the coalesced ABA the previous adapter lost
  // (it handed A to advanceContext, whose identical fast path kept
  // the old revision, so a stale action could not be refused).
  fs.writeFileSync(w.canonicalFile, vB);
  fs.writeFileSync(w.canonicalFile, v1);
  const after = await pollUntil(() => {
    const c = reader();
    return c.contextRevision > before.contextRevision ? c : null;
  }, 8000, 'revision advances on coalesced ABA');
  assert.equal(after.canonical.meta.title, title);
  host.close();
});

test('a commit whose own acquisition is overtaken by a coalesced ABA rewrite is refused (zero commits)', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  // This test's refused commit seals a negative terminal certificate
  // under its domain. The certificate registry's anti-rollback floor
  // is process-global per (household, ledger namespace) BY DESIGN —
  // a later fresh genesis under the same namespace must refuse — so
  // the sealing test runs under its own exclusion domain, exactly as
  // a distinct production deployment would.
  const config = hostConfig(w, {
    SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: 'ledger-' + '4'.repeat(32),
    SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: 'authority-' + '5'.repeat(32),
    SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: 'authority-' + '6'.repeat(32),
  });
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  host.startContextAdapter();
  const p = await prepared(w);
  // Confirm carries the freshness witness paired with its OWN fresh
  // acquisition into write admission (settlement-evidence-
  // confirmation.js). Land a coalesced A→B→A rewrite after that
  // acquisition is captured and have the host OBSERVE it (the hook
  // pauses the confirm's first post-acquisition read while the
  // watcher syncs) — before the store's admission point. The
  // witness must refuse and the write must not happen.
  const v1 = fs.readFileSync(w.canonicalFile, 'utf8');
  const vB = JSON.stringify({ ...JSON.parse(v1),
    meta: { ...JSON.parse(v1).meta, title: JSON.parse(v1).meta.title + ' (intervening)' } });
  // Fire only on a head read that follows the confirm's OWN
  // acquisition (the doubles count acquisitions at capture time), so
  // the rewrite is guaranteed to postdate the witness's capture.
  const callsBeforeConfirm = w.acquireCalls;
  let abaLanded = false;
  w.hooks.query = async (kind, text) => {
    if (!abaLanded && kind === 'financial' && w.acquireCalls > callsBeforeConfirm
      && text.startsWith('SELECT bytes FROM') && text.includes('.doc_head')) {
      abaLanded = true;
      fs.writeFileSync(w.canonicalFile, vB);
      fs.writeFileSync(w.canonicalFile, v1);
      await new Promise(r => setTimeout(r, 250));
    }
    return undefined;
  };
  const docBefore = w.doc; // the bootstrapped genesis document
  const r = await confirm(w, p);
  assert.ok(abaLanded, 'the coalesced rewrite landed inside the confirm');
  assert.notEqual(r.value && r.value.status, 'committed');
  // Zero commits: admission refused before any write — the stored
  // document is byte-identical to what it was before the confirm.
  assert.ok(w.doc.equals(docBefore), 'stored document unchanged after refusal');
});

test('canonical adapter: failed watcher establishment fails the context reader closed', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  const reader = host.settlement.application.contextReader;
  // The boot snapshot serves before the adapter starts.
  assert.equal(reader().contextRevision, 1);
  fs.rmSync(w.dir, { recursive: true, force: true });
  host.startContextAdapter();
  await pollUntil(() => {
    try { reader(); return null; } catch { return true; }
  }, 5000, 'reader refuses once observation is unavailable');
  assert.throws(() => reader(), /context observation unavailable/);
  host.close();
});

test('canonical adapter: losing the canonical source at runtime fails closed and never silently recovers', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  const title2 = v1.meta.title + ' (revised)';
  fs.writeFileSync(w.canonicalFile,
    JSON.stringify({ ...v1, meta: { ...v1.meta, title: title2 } }));
  // Sanity: the adapter is live and adopts an ordinary change first.
  await pollUntil(() => reader().canonical.meta.title === title2, 8000,
    'adapter adopts an ordinary change');
  fs.rmSync(w.canonicalFile);
  await pollUntil(() => {
    try { reader(); return null; } catch { return true; }
  }, 8000, 'reader refuses after the canonical source vanishes');
  // Recreating the file does not silently restore authority: the
  // loss is terminal for this composition and commits nothing more.
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title: v1.meta.title + ' (recreated)' } }));
  await new Promise(r => setTimeout(r, 400));
  assert.throws(() => reader(), /context observation unavailable/);
  host.close();
});

test('canonical adapter: an observed malformed rewrite invalidates the retained snapshot authority', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  // The watcher observes a rewrite it cannot adopt: malformed JSON.
  // Retaining the last-good contents as data must not retain their
  // authority — at the old revision a witness pinned before the
  // rewrite would still compare as current.
  fs.writeFileSync(w.canonicalFile, '{ not json');
  const after = await pollUntil(() => {
    try {
      const c = reader();
      return c.contextRevision > before.contextRevision ? c : null;
    } catch { return { refused: true }; }
  }, 8000, 'observed malformed rewrite invalidates the retained revision');
  if (!after.refused) assert.deepEqual(after.canonical, before.canonical);
  // Safe adoption resumes: a later valid record is adopted normally.
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...before.canonical,
    meta: { ...before.canonical.meta,
      title: before.canonical.meta.title + ' (recovered)' } }));
  const adopted = await pollUntil(() => {
    try {
      const c = reader();
      return c.canonical.meta.title.endsWith('(recovered)') ? c : null;
    } catch { return null; }
  }, 8000, 'valid record adopted after the malformed rewrite');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('canonical adapter: an observed non-record rewrite invalidates the retained snapshot authority', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  // Valid JSON, but not a record: the adapter must never advance on
  // it — and must not leave the previous snapshot's revision in
  // force either, because the rewrite was observed.
  fs.writeFileSync(w.canonicalFile, '[]');
  const after = await pollUntil(() => {
    try {
      const c = reader();
      return c.contextRevision > before.contextRevision ? c : null;
    } catch { return { refused: true }; }
  }, 8000, 'observed non-record rewrite invalidates the retained revision');
  if (!after.refused) assert.deepEqual(after.canonical, before.canonical);
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...before.canonical,
    meta: { ...before.canonical.meta,
      title: before.canonical.meta.title + ' (recovered)' } }));
  const adopted = await pollUntil(() => {
    try {
      const c = reader();
      return c.canonical.meta.title.endsWith('(recovered)') ? c : null;
    } catch { return null; }
  }, 8000, 'valid record adopted after the non-record rewrite');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('canonical adapter: an owner-refused advance invalidates the retained snapshot authority', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  // A valid plain record the trusted owner cannot advance: nested
  // deeply enough that the owner's deep comparison/clone refuses it
  // after a successful parse and a stable fingerprint (verified
  // against the shipped owner: parse succeeds, advance throws). The
  // swallowed refusal must not leave the old revision in force.
  let deepText = '{"v":1}';
  for (let i = 0; i < 3000; i++) deepText = '{"n":' + deepText + '}';
  fs.writeFileSync(w.canonicalFile, deepText);
  const after = await pollUntil(() => {
    try {
      const c = reader();
      return c.contextRevision > before.contextRevision ? c : null;
    } catch { return { refused: true }; }
  }, 8000, 'owner-refused advance invalidates the retained revision');
  if (!after.refused) assert.deepEqual(after.canonical, before.canonical);
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...before.canonical,
    meta: { ...before.canonical.meta,
      title: before.canonical.meta.title + ' (recovered)' } }));
  const adopted = await pollUntil(() => {
    try {
      const c = reader();
      return c.canonical.meta.title.endsWith('(recovered)') ? c : null;
    } catch { return null; }
  }, 8000, 'valid record adopted after the refused advance');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('a commit whose own acquisition is overtaken by an observed malformed rewrite is refused (zero commits)', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  // Own exclusion domain, as in the coalesced-ABA refusal test: a
  // refused commit seals a negative certificate under its domain and
  // the registry floor is process-global per namespace.
  const config = hostConfig(w, {
    SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: 'ledger-' + '7'.repeat(32),
    SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: 'authority-' + '8'.repeat(32),
    SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: 'authority-' + '9'.repeat(32),
  });
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  host.startContextAdapter();
  const p = await prepared(w);
  // Source-derived scenario (Atlas re-review 6486479656): witness
  // A/revision r is captured by the confirm's own acquisition; the
  // canonical file is then replaced with malformed JSON and the host
  // OBSERVES the rewrite before admission. The stale A/r witness
  // must not be accepted by same-context comparison.
  const callsBeforeConfirm = w.acquireCalls;
  let rewriteLanded = false;
  w.hooks.query = async (kind, text) => {
    if (!rewriteLanded && kind === 'financial' && w.acquireCalls > callsBeforeConfirm
      && text.startsWith('SELECT bytes FROM') && text.includes('.doc_head')) {
      rewriteLanded = true;
      fs.writeFileSync(w.canonicalFile, '{ not json');
      await new Promise(r => setTimeout(r, 250));
    }
    return undefined;
  };
  const docBefore = w.doc;
  const r = await confirm(w, p);
  assert.ok(rewriteLanded, 'the malformed rewrite landed inside the confirm');
  assert.notEqual(r.value && r.value.status, 'committed');
  assert.ok(w.doc.equals(docBefore), 'stored document unchanged after refusal');
});

test('a commit whose own acquisition is overtaken by an observed non-record rewrite is refused (zero commits)', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const config = hostConfig(w, {
    SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: 'ledger-' + 'b'.repeat(32),
    SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: 'authority-' + 'c'.repeat(32),
    SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: 'authority-' + 'd'.repeat(32),
  });
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  host.startContextAdapter();
  const p = await prepared(w);
  // Same scenario with a non-record canonical ([]): the fingerprint
  // is consumed by the observation, so without invalidation nothing
  // ever moves the retained revision again for this rewrite.
  const callsBeforeConfirm = w.acquireCalls;
  let rewriteLanded = false;
  w.hooks.query = async (kind, text) => {
    if (!rewriteLanded && kind === 'financial' && w.acquireCalls > callsBeforeConfirm
      && text.startsWith('SELECT bytes FROM') && text.includes('.doc_head')) {
      rewriteLanded = true;
      fs.writeFileSync(w.canonicalFile, '[]');
      await new Promise(r => setTimeout(r, 250));
    }
    return undefined;
  };
  const docBefore = w.doc;
  const r = await confirm(w, p);
  assert.ok(rewriteLanded, 'the non-record rewrite landed inside the confirm');
  assert.notEqual(r.value && r.value.status, 'committed');
  assert.ok(w.doc.equals(docBefore), 'stored document unchanged after refusal');
});

test('a failed duplicate startServer cannot unbind the live composition\u2019s authorization facade', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  const authorization = profileFor(AUTH_USER);
  const facade = Server.createSettlementAuthorizationReadFacade(authorization);
  const owners = Owners.createSettlementProductionOwners({ householdId,
    authorizationStore: facade,
    context: { canonical: clone(w.base), env: { ...appEnv }, domain: 'synthetic-household-authority' } });
  const custody = Owners.createSettlementProductionCustody(
    { householdId, exclusionDomain, now: () => w.time });
  const settlement = { connection: profileFor(FIN_USER), authorization,
    custody: { pinStore: custody.pinStore, backupStore: custody.backupStore,
      terminalHistory: custody.terminalHistory, exclusionDomain: custody.exclusionDomain },
    application: { householdId, origin: 'https://atlas.example.test',
      authorize: owners.authorize, authorizeRecovery: owners.authorizeRecovery,
      contextReader: owners.contextReader, now: () => w.time } };
  await bootstrapCustody(profileFor(FIN_USER), custody, () => w.time);
  const start = () => startServer({ env: { ...appEnv }, host: '127.0.0.1', port: 0, settlement });
  const owner = await start();
  t.after(async () => { await owner.close().catch(() => {}); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  const p = await prepared(w);
  const probe = { operationId: p.operationId, generation: p.generation, sidDigest: hash(sidOf(w.cookie)) };
  assert.equal((await facade.readAuthorizationState(probe)).state, 'ok');
  // The duplicate fails (the facade is already bound to the live
  // composition). Its cleanup runs its own retire — which must be
  // owner-conditional and leave the live binding exactly as it was.
  await assert.rejects(start(), /settlement composition unavailable/);
  assert.equal(owner.status().state, 'ready');
  assert.equal((await facade.readAuthorizationState(probe)).state, 'ok');
  const grant = await owners.authorizeRecovery({ householdId,
    actorId: 'session-' + sidOf(w.cookie), operationId: p.operationId, generation: p.generation });
  assert.equal(grant.operationId, p.operationId);
  await owner.close();
  await assert.rejects(facade.readAuthorizationState(probe), /composition/);
});

test('entry shutdown ordering: bounded custody retirement does not wait for a request stalled inside a custody operation', async t => {
  const w = makeWorld(); active = w; w.nativeHistory = true; installDoubles(t, w);
  const config = { ...hostConfig(w), ...custodyConfig() };
  const host = createSettlementProductionHost(config, { encrypt: syntheticEncrypt });
  await host.prepare();
  await bootstrapCustody({ ...host.settlement.connection,
    terminalHistory: { householdId, ledgerNamespace: exclusionDomain.ledgerNamespace } },
    host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close().catch(() => {}); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  const p = await prepared(w);
  // Stall the confirm inside a custody write whose driver query never
  // settles. Under the previous entry ordering, owner.close()'s HTTP
  // drain waited for this request, so retireCustody() — and any
  // terminal custody receipt — was never reached.
  w.hooks.query = (kind, text) => {
    if (kind === 'custody' && w.hangCustodyWrite && /^(INSERT INTO|UPDATE)/.test(text)
      && text.includes('"settlement_custody".')) {
      w.hangCustodyWrite = false; w.custodyWriteHung = true;
      return new Promise(() => {});
    }
    return undefined;
  };
  w.hangCustodyWrite = true;
  const confirmPromise = request(w, '/settlement/confirm',
    { operationId: p.operationId, previewToken: p.previewToken,
      generation: p.generation, confirmed: true });
  confirmPromise.catch(() => {}); // settlement is asserted below
  await pollUntil(() => w.custodyWriteHung, 10000, 'confirm stalls inside a custody write');
  // The actual entry shutdown sequence (the helper the signal handler
  // runs): both refusal fences fire synchronously, and the bounded
  // custody receipt is produced without depending on the stalled
  // request finishing first.
  const shutdown = Server.initiateCompositionShutdown(owner, host);
  assert.notEqual(owner.status().state, 'ready');
  const report = await withDeadline(shutdown.custodyReport, 10000, 'custody report');
  assert.deepEqual(report, { state: 'lost', close: 'unconfirmed' });
  // The stalled request is bounded at the custody session wrapper: it
  // settles as an unknown outcome (never replayed, never committed),
  // and the drain then completes — shutdown terminates.
  const settled = await withDeadline(confirmPromise.then(
    v => ({ responded: true, value: v.value }), () => ({ responded: false })),
    30000, 'stalled confirm settles');
  if (settled.responded) assert.notEqual(settled.value && settled.value.status, 'committed');
  await withDeadline(shutdown.drained, 30000, 'shutdown drain');
});

// --- Single-exit-gate restructure: Atlas DESIGN DISPOSITION 6487233693 --
// Every observed-change attempt in syncCanonical defaults to
// INVALIDATED and may end only ADOPTED (a fully verified stable
// adoption through the one commit gate) or INVALIDATED (the reader
// refuses; retained content is data only). The cases below pin each
// enumerated exit at the actual host seam. Test-side interposition on
// the shared node:fs module object — the host resolves fs.readFileSync
// / fs.statSync at call time — drives the read/stat paths
// deterministically; it is scoped to the world's canonical file, every
// other path delegates untouched, and no production code knows it
// exists (no new production fault/config hook).
function interposeCanonical(t, w, hooks = {}) {
  const realRead = fs.readFileSync;
  const realStat = fs.statSync;
  if (hooks.read) {
    fs.readFileSync = function (p, ...rest) {
      if (p === w.canonicalFile) hooks.read();
      return realRead.call(fs, p, ...rest);
    };
  }
  if (hooks.stat) {
    fs.statSync = function (p, ...rest) {
      const result = realStat.call(fs, p, ...rest);
      if (p !== w.canonicalFile) return result;
      const delta = hooks.stat();
      if (!delta) return result;
      return Object.assign(Object.create(Object.getPrototypeOf(result)), result,
        { mtimeNs: result.mtimeNs + delta });
    };
  }
  t.after(() => { fs.readFileSync = realRead; fs.statSync = realStat; });
}
// A hook pair that falsifies the verification stat — the stat that
// immediately follows a canonical read — of the first `max` sync
// attempts. Each falsified verification stat carries a distinct
// fingerprint delta, so every falsified attempt observes a genuine
// mismatch between its before/after fingerprints, with no file churn
// at all. Keying on the read that precedes the stat (rather than on
// global call parity) keeps the drive exact no matter how watcher
// deliveries interleave.
const falsifyVerification = max => {
  let verified = 0;
  let justRead = false;
  return {
    read: () => { justRead = true; },
    stat: () => {
      if (!justRead) return null;
      justRead = false;
      verified++;
      return verified <= max ? BigInt(verified) : null;
    },
  };
};
const readerRefuses = reader => {
  try { reader(); return false; } catch { return true; }
};
const waitRefusal = (reader, label) =>
  pollUntil(() => (readerRefuses(reader) ? true : null), 8000, label);
const waitAdopted = (reader, pred, label) => pollUntil(() => {
  try { const c = reader(); return pred(c) ? c : null; } catch { return null; }
}, 8000, label);

test('canonical adapter: an unchanged fingerprint is a healthy no-op while valid', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  const reader = host.settlement.application.contextReader;
  const before = reader();
  host.startContextAdapter(); // its boot sync observes no change
  await new Promise(r => setTimeout(r, 600));
  const after = reader();
  assert.equal(after.contextRevision, before.contextRevision);
  assert.deepEqual(after.canonical, before.canonical);
  host.close();
});

test('canonical adapter: a same-content rewrite is adopted at a strictly newer revision', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  // The exact boot bytes land again: contents identical, fingerprint
  // moved — the adoption is real and the reported revision advances.
  fs.writeFileSync(w.canonicalFile, fs.readFileSync(w.canonicalFile, 'utf8'));
  const after = await waitAdopted(reader,
    c => c.contextRevision > before.contextRevision, 'same-content adoption advances');
  assert.deepEqual(after.canonical, before.canonical);
  host.close();
});

test('canonical adapter (single gate): an observed malformed rewrite refuses reads until a complete adoption clears it', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const originalBytes = fs.readFileSync(w.canonicalFile, 'utf8');
  fs.writeFileSync(w.canonicalFile, '{ not json');
  await waitRefusal(reader, 'reader refuses while the malformed rewrite is unadopted');
  // A dwell changes nothing: no queued event and no unchanged
  // fingerprint clears the invalidation or revives cached authority.
  await new Promise(r => setTimeout(r, 300));
  assert.throws(() => reader(), /context invalidated/);
  // Restoring the EXACT previous bytes is a complete stable adoption,
  // so it clears the refusal — at a strictly newer revision, so the
  // pre-rewrite witness stays invalid (disposition condition 3).
  fs.writeFileSync(w.canonicalFile, originalBytes);
  const restored = await waitAdopted(reader,
    c => c.contextRevision > before.contextRevision, 'identical-byte restoration adopted strictly newer');
  assert.deepEqual(restored.canonical, before.canonical);
  host.close();
});

test('canonical adapter (single gate): an observed non-record rewrite refuses reads until a complete adoption clears it', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  fs.writeFileSync(w.canonicalFile, '[]');
  await waitRefusal(reader, 'reader refuses while the non-record rewrite is unadopted');
  await new Promise(r => setTimeout(r, 300));
  assert.throws(() => reader(), /context invalidated/);
  const base = before.canonical;
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...base,
    meta: { ...base.meta, title: base.meta.title + ' (recovered)' } }));
  const adopted = await waitAdopted(reader,
    c => c.canonical.meta.title.endsWith('(recovered)'), 'valid record adopted after the non-record rewrite');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('canonical adapter (single gate): a read failure after an observed change refuses reads until a later stable adoption', async t => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  let armed = true;
  interposeCanonical(t, w, {
    read: () => { if (armed) throw Error('synthetic read failure'); },
  });
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title: v1.meta.title + ' (unreadable)' } }));
  await waitRefusal(reader, 'reader refuses after the observed read failure');
  assert.throws(() => reader(), /context invalidated/);
  armed = false;
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title: v1.meta.title + ' (recovered)' } }));
  const adopted = await waitAdopted(reader,
    c => c.canonical.meta.title.endsWith('(recovered)'), 'stable adoption after the read failure');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('canonical adapter (single gate): a stat failure during verification refuses reads until a later stable adoption', async t => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  let armed = true;
  let justRead = false;
  interposeCanonical(t, w, {
    read: () => { justRead = true; },
    stat: () => {
      // The stat that immediately follows a canonical read is the
      // attempt's verification stat; only it fails.
      if (!justRead) return null;
      justRead = false;
      if (armed) throw Error('synthetic stat failure');
      return null;
    },
  });
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title: v1.meta.title + ' (unverifiable)' } }));
  await waitRefusal(reader, 'reader refuses after the verification stat failure');
  assert.throws(() => reader(), /context invalidated/);
  armed = false;
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title: v1.meta.title + ' (recovered)' } }));
  const adopted = await waitAdopted(reader,
    c => c.canonical.meta.title.endsWith('(recovered)'), 'stable adoption after the stat failure');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

async function mismatchAdoption(t, mismatches) {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  interposeCanonical(t, w, falsifyVerification(mismatches));
  const title = v1.meta.title + ' (settled)';
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title } }));
  const adopted = await waitAdopted(reader,
    c => c.canonical.meta.title === title, 'stable adoption after ' + mismatches + ' mismatch(es)');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
}

test('canonical adapter (single gate): one fingerprint mismatch during the read still adopts the stable record', async t => {
  await mismatchAdoption(t, 1);
});

test('canonical adapter (single gate): two fingerprint mismatches during the read still adopt the stable record', async t => {
  await mismatchAdoption(t, 2);
});

test('canonical adapter (single gate): three fingerprint mismatches exhaust the retries and refuse (6486974495)', async t => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  // Every verification stat is falsified: all three bounded attempts
  // observe a rewrite mid-read and the loop exhausts. The fall-through
  // must end INVALIDATED, never with prior authority intact.
  interposeCanonical(t, w, falsifyVerification(Infinity));
  const title = v1.meta.title + ' (churned)';
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
    meta: { ...v1.meta, title } }));
  await waitRefusal(reader, 'reader refuses after exhausted retries');
  await new Promise(r => setTimeout(r, 300));
  assert.throws(() => reader(), /context invalidated/);
  host.close();
});

test('canonical adapter (single gate): an owner-refused advance refuses reads until a complete adoption clears it', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  // A valid plain record the trusted owner cannot advance: nested
  // deeply enough that the owner's comparison/clone refuses it after
  // a successful parse and a stable fingerprint (the round-2 drive).
  let deepText = '{"v":1}';
  for (let i = 0; i < 3000; i++) deepText = '{"n":' + deepText + '}';
  fs.writeFileSync(w.canonicalFile, deepText);
  await waitRefusal(reader, 'reader refuses after the owner-refused advance');
  assert.throws(() => reader(), /context invalidated/);
  fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...before.canonical,
    meta: { ...before.canonical.meta,
      title: before.canonical.meta.title + ' (recovered)' } }));
  const adopted = await waitAdopted(reader,
    c => c.canonical.meta.title.endsWith('(recovered)'), 'valid record adopted after the refused advance');
  assert.ok(adopted.contextRevision > before.contextRevision);
  host.close();
});

test('canonical adapter (single gate): a failed advance publishes nothing partially, and identical-byte restoration clears it at a newer revision', async () => {
  const w = makeWorld(); active = w;
  const host = createSettlementProductionHost(hostConfig(w));
  host.startContextAdapter();
  const reader = host.settlement.application.contextReader;
  const before = reader();
  const originalBytes = fs.readFileSync(w.canonicalFile, 'utf8');
  let deepText = '{"v":1}';
  for (let i = 0; i < 3000; i++) deepText = '{"n":' + deepText + '}';
  fs.writeFileSync(w.canonicalFile, deepText);
  await waitRefusal(reader, 'reader refuses after the failed advance');
  // Publication atomicity (disposition condition 2): across a dwell,
  // no read ever serves new content at the old revision or old content
  // at a silently advanced revision — every read refuses.
  for (let i = 0; i < 5; i++) {
    assert.throws(() => reader(), /context invalidated/);
    await new Promise(r => setTimeout(r, 60));
  }
  // Complete stable adoption of the exact previous bytes clears the
  // refusal, at a revision strictly newer than the pre-failure one.
  fs.writeFileSync(w.canonicalFile, originalBytes);
  const restored = await waitAdopted(reader,
    c => c.contextRevision > before.contextRevision, 'restoration adopted strictly newer');
  assert.deepEqual(restored.canonical, before.canonical);
  host.close();
});

test('a commit whose own acquisition is overtaken by exhausted sync retries is refused (zero commits)', async t => {
  const w = makeWorld(); active = w; installDoubles(t, w);
  // Own exclusion domain, as in the other stale-action refusal tests:
  // a refused commit seals a negative certificate under its domain and
  // the registry floor is process-global per namespace.
  const config = hostConfig(w, {
    SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: 'ledger-' + 'e'.repeat(32),
    SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: 'authority-' + 'f'.repeat(32),
    SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: 'authority-' + '0'.repeat(32),
  });
  const host = createSettlementProductionHost(config);
  await bootstrapCustody(host.settlement.connection, host.settlement.custody, () => Date.now());
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  t.after(async () => { host.close(); await owner.close(); });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  host.startContextAdapter();
  const p = await prepared(w);
  // The finding's exact shape (6486974495): after the confirm's own
  // acquisition captured witness A/revision r, a rewrite lands and the
  // host OBSERVES it, but every bounded retry sees the file change
  // mid-read — here via falsified verification stats, so the contents
  // stay one stable valid record and nothing about the drive is
  // timing-shaped. Exhaustion must invalidate: the stale A/r witness
  // must not compare as same-context at admission.
  interposeCanonical(t, w, falsifyVerification(Infinity));
  const v1 = JSON.parse(fs.readFileSync(w.canonicalFile, 'utf8'));
  const callsBeforeConfirm = w.acquireCalls;
  let rewriteLanded = false;
  w.hooks.query = async (kind, text) => {
    if (!rewriteLanded && kind === 'financial' && w.acquireCalls > callsBeforeConfirm
      && text.startsWith('SELECT bytes FROM') && text.includes('.doc_head')) {
      rewriteLanded = true;
      fs.writeFileSync(w.canonicalFile, JSON.stringify({ ...v1,
        meta: { ...v1.meta, title: v1.meta.title + ' (rewritten)' } }));
      await new Promise(r => setTimeout(r, 250));
    }
    return undefined;
  };
  const docBefore = w.doc;
  const r = await confirm(w, p);
  assert.ok(rewriteLanded, 'the rewrite landed inside the confirm');
  assert.notEqual(r.value && r.value.status, 'committed');
  assert.ok(w.doc.equals(docBefore), 'stored document unchanged after refusal');
});
