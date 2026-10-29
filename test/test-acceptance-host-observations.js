'use strict';
// Plan #5 final Savings acceptance — host observations (TEST ONLY).
// Matrix rows A2, A9, A10 (#765 comments 6480259704; Atlas ruling
// 6486957378) observed through the ACTUAL host-created settlement record
// (scripts/settlement-production-host.js createSettlementProductionHost)
// composed by the real startServer and driven over real HTTP.
//
// The synthetic pg world below is copied from the production-host suite
// (test/test-settlement-production-host.js, PR #774) so this file edits
// none of #774's files. SQL/TLS, provider acquisition and refresh are
// OFFLINE SYNTHETIC DOUBLES; the encrypt seam is the host factory's
// existing labelled synthetic cipher. Nothing here is live, Postgres,
// or target qualification. The world helpers are exported (tests run
// only when this file is the entry) so the A6 cold-process file can
// reuse the identical world in fresh OS processes.
// Labelled doubles, not live qualification.
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
const setActive = w => { active = w; };
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
    this.config = config; this.ends = 0; this.count = 0; this.endEmitted = false;
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
    if (active.hooks.end) await active.hooks.end(this.kind);
    // Idempotent end (repair for Atlas review 2026-10-29T04:18:44Z): a
    // pg session emits 'end' at most once. The previous double emitted
    // on EVERY end(); the custody stores' loss listener ends the session
    // again on 'end', so re-emitting produced an unbounded end->emit->end
    // chain (a TEST-DOUBLE artifact, not a production deadlock claim).
    if (!this.endEmitted) { this.endEmitted = true; this.emit('end'); }
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
const op = n => 'operation-' + n.toString(16).padStart(32, '0');

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
  const restore = () => { Refresh.serve = serve; Refresh.acquireSettlementWithWitness = acquire; };
  if (t) t.after(restore);
  return restore;
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

// --- Host composition helpers shared with the A6 cold-process file ---
// Durable-custody host: the full production config shape (financial,
// authorization AND custody profiles), host.prepare() custody preflight,
// native terminal history — the same assembly server.js's require.main
// path composes, with only the labelled synthetic encrypt seam injected
// through the factory's existing `seams` parameter.
function durableConfig(w) { return { ...hostConfig(w), ...custodyConfig() }; }
async function composeHost(w, { bootstrap }) {
  const config = durableConfig(w);
  const host = createSettlementProductionHost(config, { encrypt: syntheticEncrypt });
  await host.prepare();
  if (bootstrap) {
    await bootstrapCustody({ ...host.settlement.connection,
      terminalHistory: { householdId, ledgerNamespace: exclusionDomain.ledgerNamespace } },
      host.settlement.custody, () => Date.now());
  }
  return { config, host };
}
async function listen(w, config, host) {
  const owner = await startServer({ env: config, host: '127.0.0.1', port: 0, settlement: host.settlement });
  w.owner = owner; w.url = 'http://127.0.0.1:' + owner.server.address().port; w.cookie = await login(w);
  return owner;
}
async function shutdown(owner, host) {
  if (owner) await owner.close().catch(() => {});
  if (host) { await host.retireCustody().catch(() => {}); host.close(); }
}
// Application writes observed at the synthetic backing: staged document
// promotions (the `WITH s AS` swap that publishes a new revision).
const docCommits = w => w.sql.filter(e => e.kind === 'financial' && e.text.startsWith('WITH s AS')).length;
const appWrites = (w, from = 0) => w.sql.slice(from).filter(e => e.kind !== 'custody'
  ? /^(INSERT|UPDATE|DELETE|WITH s AS)/.test(e.text) && !e.text.includes('auth_')
  : /^(INSERT|UPDATE)/.test(e.text));

module.exports = { SyntheticClient, custodyQuery, setActive, makeWorld, installDoubles, request, login, prepared, confirm, credential,
  composeHost, listen, shutdown, docCommits, appWrites, householdId, exclusionDomain, op,
  syntheticEncrypt, createSettlementProductionHost, startServer };

if (require.main === module) {
  const test = require('node:test');

  // Shared start: one durable-custody host, bootstrapped by the
  // maintenance pattern, composed by the real startServer, logged in.
  async function started(t, { settlementFor } = {}) {
    const w = makeWorld(); active = w; w.nativeHistory = true; installDoubles(t, w);
    const { config, host } = await composeHost(w, { bootstrap: true });
    const settlement = settlementFor ? settlementFor(host.settlement) : host.settlement;
    const owner = await listen(w, config, { settlement });
    t.after(() => shutdown(owner, host));
    w.host = host; w.config = config;
    return w;
  }

  // ---------------------------------------------------------------- A2
  test('A2 duplicate confirmation through the host-created record returns the original outcome with one application', async t => {
    const w = await started(t);
    const p = await prepared(w);
    const commitsBefore = docCommits(w);
    const pinWritesBefore = w.sql.filter(e => e.kind === 'custody' && /^(INSERT|UPDATE)/.test(e.text) && e.text.includes('custody_pin')).length;
    // Double-click: two concurrent confirms of the same prepared operation.
    const [a, b] = await Promise.all([confirm(w, p), confirm(w, p)]);
    assert.equal(a.value.status, 'committed');
    assert.deepEqual(b.value, a.value, 'concurrent duplicate returns the identical original outcome');
    // A later, sequential duplicate also returns the original outcome.
    const c = await confirm(w, p);
    assert.deepEqual(c.value, a.value, 'sequential duplicate returns the identical original outcome');
    // Exactly one application at the backing: one document promotion,
    // published revision 1, and one custody pin advance.
    assert.equal(docCommits(w) - commitsBefore, 1, 'exactly one document promotion');
    assert.equal(JSON.parse(w.doc).revision, 1, 'revision unchanged by the duplicates');
    assert.equal(a.value.revision, 1);
    const pinWrites = w.sql.filter(e => e.kind === 'custody' && /^(INSERT|UPDATE)/.test(e.text) && e.text.includes('custody_pin')).length;
    assert.equal(pinWrites - pinWritesBefore, 1, 'exactly one custody pin write');
    // One assignment visible, carrying the single 2500-cent application.
    const listed = (await request(w, '/settlement/assignments', {})).value;
    assert.equal(listed.status, 'available');
    assert.equal(listed.assignments.length, 1);
    assert.equal(listed.assignments[0].assignedCents, 2500);
    const links = (await request(w, '/data.json')).value.settlementEvidence.commitments
      .flatMap(g => g.links).filter(l => l.operationId === p.operationId);
    assert.equal(links.length, 1, 'one published link for the operation');
  });

  // ---------------------------------------------------------------- A9
  test('A9 tainted custody pin: the host composition fails closed — no qualified status, no admission, no publication, evidence preserved', async t => {
    const w = await started(t);
    const p = await prepared(w);
    assert.equal((await confirm(w, p)).value.status, 'committed');
    const doc = Buffer.from(w.doc);
    // Labelled synthetic taint of the durable custody evidence.
    const tainted = Buffer.from('{"synthetic":"tainted-pin"}');
    w.pinRow = { ...w.pinRow, bytes: tainted };
    const mark = w.sql.length;
    const data = await request(w, '/data.json');
    assert.equal(data.status, 503, 'no published data served from tainted evidence');
    assert.notEqual(data.value && data.value.settlementEvidenceStatus && data.value.settlementEvidenceStatus.status, 'qualified');
    assert.equal(typeof data.value === 'object' && data.value !== null ? data.value.settlementEvidence : undefined, undefined,
      'no settlement evidence (so no zero or green figure) published');
    assert.equal((await request(w, '/settlement/selections', {})).value.status, 'unavailable', 'new admission refused');
    assert.equal((await request(w, '/settlement/assignments', {})).value.status, 'unavailable');
    const pub = await request(w, '/settlement/publication', { operationId: p.operationId });
    assert.equal(pub.value.status, 'unavailable');
    assert.equal(pub.value.publication, undefined, 'no inclusion claimed');
    assert.deepEqual((await request(w, '/settlement/outcome', credential(p))).value, { status: 'unavailable' });
    assert.notEqual(w.owner.status().state, 'ready', 'composition no longer ready');
    // Evidence preserved, no maintenance invented: zero writes after taint.
    assert.deepEqual(appWrites(w, mark), [], 'no application or custody writes after the taint');
    assert.deepEqual(w.pinRow.bytes, tainted, 'tainted pin bytes preserved, not repaired');
    assert.deepEqual(Buffer.from(w.doc), doc, 'committed document preserved');
  });

  // A9 tainted terminal checkpoint — PARTIAL (Atlas review 2026-10-29T04:18:44Z).
  // Qualified generic serving and an Unknown operation are NOT a
  // contradiction: generic serving verifies the document against the
  // pin only, while outcome/publication additionally require the
  // terminal-history/coexistence qualification the taint removes. The
  // test therefore asserts BOTH: the independently pinned facts stay
  // served unchanged, and the operation reads Unknown. Consumer-level
  // evidence: a withdrawal of the operation's assignment is refused
  // under the taint (the untainted control below shows it otherwise
  // prepares). No production defect is inferred from the differing
  // predicates.
  // BOUNDED DISPOSITION (open, not claimed): goal-lifecycle retirement
  // and UI green/status rendering reading the Unknown operation are not
  // exercised through the host here; row A9 remains PARTIAL.
  async function a9CheckpointWorld(t) {
    const w = await started(t);
    const p = await prepared(w);
    assert.equal((await confirm(w, p)).value.status, 'committed');
    const before = (await request(w, '/data.json')).value;
    const assignmentsBefore = (await request(w, '/settlement/assignments', {})).value;
    return { w, p, before, assignmentsBefore };
  }
  const withoutHandles = a => ({ ...a, assignments: a.assignments.map(({ handle, ...rest }) => rest) });

  test('A9 tainted terminal checkpoint: operation reads Unknown, independently pinned facts stay served, withdrawal refused (PARTIAL)', async t => {
    const { w, p, before, assignmentsBefore } = await a9CheckpointWorld(t);
    w.terminalRow = { ...w.terminalRow, checkpointBytes: Buffer.from('{"synthetic":"tainted-checkpoint"}') };
    const mark = w.sql.length;
    // Operation-level reads need terminal-history qualification: Unknown.
    const pub = (await request(w, '/settlement/publication', { operationId: p.operationId })).value;
    assert.equal(pub.status, 'unknown');
    assert.equal(pub.publication, undefined, 'no inclusion claimed under uncertainty');
    assert.deepEqual((await request(w, '/settlement/outcome', credential(p))).value,
      { status: 'unknown', operationId: p.operationId });
    // Generic serving verifies document/pin only: the independently
    // pinned facts are preserved exactly (not a contradiction).
    const data = await request(w, '/data.json');
    assert.equal(data.status, 200);
    assert.deepEqual(data.value.settlementEvidenceStatus, { status: 'qualified' },
      'document/pin-qualified serving unchanged by the checkpoint taint');
    assert.deepEqual(data.value.settlementEvidence, before.settlementEvidence,
      'pinned evidence served byte-for-byte as before the taint');
    const listed = (await request(w, '/settlement/assignments', {})).value;
    assert.deepEqual(withoutHandles(listed), withoutHandles(assignmentsBefore), 'pinned assignment listing preserved');
    // Consumer-level: withdrawing the Unknown operation's assignment is refused.
    const wd = (await request(w, '/settlement/prepare-withdrawal',
      { operationId: op(9), assignmentHandle: listed.assignments[0].handle })).value;
    assert.deepEqual(wd, { status: 'unavailable', reason: 'prepare-unavailable' },
      'no withdrawal of the assignment while its operation is Unknown');
    assert.deepEqual(appWrites(w, mark), [], 'no writes or repair after the taint');
  });

  test('A9 control (untainted): the same withdrawal prepares, so the refusal above is caused by the checkpoint taint', async t => {
    const { w } = await a9CheckpointWorld(t);
    const listed = (await request(w, '/settlement/assignments', {})).value;
    const wd = (await request(w, '/settlement/prepare-withdrawal',
      { operationId: op(9), assignmentHandle: listed.assignments[0].handle })).value;
    assert.equal(wd.status, 'prepared');
  });

  // ------------------------------------------------ test-double guard
  test('test double: SyntheticClient emits end once, so a loss listener that ends again terminates', () => {
    const w = makeWorld(); active = w;
    const c = new SyntheticClient({ user: CUSTODY_USER });
    let emitted = 0;
    // Mirrors the custody stores' loss listener (markLost ends the session again).
    c.on('end', () => { emitted++; Promise.resolve(c.end()).catch(() => {}); });
    return Promise.resolve(c.end()).then(() => {
      assert.equal(emitted, 1, "'end' emitted exactly once");
      assert.equal(c.ends, 2, 'one re-entrant end() from the listener, then the chain stops');
    });
  });

  // --------------------------------------------------------------- A10
  test('A10 lost pin acknowledgement after the backing mutation: unknown, no second write or replay, across a fresh host reconstruction', async t => {
    // Labelled lost-ack DOUBLE (PC9 pattern) around the host-created
    // custody pinStore: the real advance mutates the backing, then the
    // acknowledgement is dropped. The host record is frozen, so the
    // double is applied on a shallow copy of host.settlement passed to
    // startServer; every other owner is the host's own.
    let advances = 0;
    const w = await started(t, { settlementFor: s => ({ ...s, custody: { ...s.custody,
      pinStore: { ...s.custody.pinStore, async advance(...args) {
        advances++; await s.custody.pinStore.advance(...args); return undefined; } } } }) });
    const p = await prepared(w);
    const commitsBefore = docCommits(w);
    const r = await confirm(w, p);
    assert.deepEqual(r.value, { status: 'unknown', operationId: p.operationId }, 'lost ack surfaces as unknown');
    assert.equal(advances, 1);
    assert.equal(JSON.parse(w.doc).revision, 1, 'backing mutation landed');
    assert.ok(w.journal, 'uncertainty journal retained');
    const retainedJournal = Buffer.from(w.journal);
    // A duplicate confirm may only READ the now-proven original result.
    const again = await confirm(w, p);
    assert.equal(again.value.status, 'committed');
    assert.equal(again.value.revision, 1);
    assert.equal(advances, 1, 'no second pin advance');
    assert.equal(docCommits(w) - commitsBefore, 1, 'no second document promotion');
    // Reconstruct: close this host, compose a FRESH host over the same
    // retained synthetic backing (same process; see the A6 file for the
    // cross-process case). No bootstrap, no replay.
    await w.owner.close();
    assert.deepEqual(await w.host.retireCustody(), { state: 'retired', close: 'confirmed' });
    w.host.close();
    assert.deepEqual(Buffer.from(w.journal), retainedJournal, 'retained uncertainty evidence not repaired by shutdown');
    const h2 = await composeHost(w, { bootstrap: false });
    const o2 = await listen(w, h2.config, h2.host);
    t.after(() => shutdown(o2, h2.host));
    assert.equal(o2.status().state, 'ready');
    assert.deepEqual((await request(w, '/settlement/outcome', credential(p))).value,
      { status: 'committed', operationId: p.operationId }, 'original result recovered with the recovery credential');
    // Re-sending the old confirm to the fresh host never re-executes it.
    const stale = await confirm(w, p);
    assert.notEqual(stale.value.status, 'committed', 'fresh host does not honour the old preview as a new write');
    assert.equal(docCommits(w) - commitsBefore, 1, 'still exactly one document promotion');
    assert.equal(JSON.parse(w.doc).revision, 1);
  });
}
