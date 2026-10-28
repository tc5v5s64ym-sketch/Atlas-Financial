'use strict';

// Settlement production host (Plan #5 assembly slice; packet
// files/host-root-assembly-packet-2026-10-28.md, dispatch issue #765
// comment 6480076295 accepting Atlas's GAP-2 response 6479329564;
// custody contracts from PR #772 review 6480121552 and disposition
// 6480396497 — this slice is based on main plus PR #772's durable
// custody module at its reviewed head, and merges after it).
//
// The production composition root: it wires the merged P1 owners
// (PR #771) into the exact closed record startServer consumes —
// { connection, authorization, custody, application } — from VALUES
// only. No dynamic loading, no plugin resolution, no config-supplied
// code, no new authority owners. The single code seam is the custody
// encryption function (below), an activation-time input the entry
// binds from the owner's key ceremony; this slice's entry binds none.
//
// ACTIVATION STAYS OFF BY DEFAULT. With no settlement config present
// the host is inactive and the entry calls startServer() exactly as
// before. With ANY settlement value present, the full configuration is
// validated; a partial or malformed configuration is a named boot
// failure, never a degraded composition. Composing is wiring only: it
// qualifies nothing (A2 stays gated), activates nothing, and the
// household binding / key ceremony / go-live decisions remain the
// owner's alone.
//
// GAP-2 (6479329564, accepted 6480076295): P1's preliminary recovery
// policy reads authorization state through a stable READ-ONLY facade
// created by server.js's bounded startup seam
// (createSettlementAuthorizationReadFacade), keyed by the exact
// authorization profile object below. There is NO separate host-owned
// authorization connection and no second authorization lifetime:
// server.js binds the facade to the composition's own guarded
// authorization read when the composition becomes ready and unbinds it
// when retirement begins. The facade delegates only; it caches nothing.
//
// Custody — two bindings behind the same interfaces:
//   - Default (preparatory): P1's custody as merged — in-memory
//     pin/backup/history over the default anchor transport — with the
//     native terminal-history selection unused. Nothing durable is
//     claimed for this binding.
//   - Durable (a SETTLEMENT_CUSTODY_DB_* profile is configured):
//     pin/backup are GAP-1's Postgres-backed durable stores
//     (scripts/settlement-custody-durable-stores.js) over their own
//     dedicated direct session, schema and scope, and terminal
//     history is the native { mode: 'postgres' } selection the
//     runtime and startServer already implement over the FINANCIAL
//     profile (no second history surface is created). The durable
//     binding additionally requires the injected encryption function;
//     without it the configuration refuses by name rather than
//     composing backups that are not encrypted.
//
// Assembly-owned custody prerequisites (PR #772 contracts, discharged
// here — the GAP-1 module itself is trusted-schema adapter
// preparation only and performs neither):
//   1. SESSION/CATALOG PREFLIGHT. Before any production custody
//      operation, the host preflights the custody session/schema with
//      the shipped connection discipline
//      (scripts/settlement-evidence-postgres-connection.js): TLS and
//      restricted-login identity checks, then catalog checks that the
//      custody relations are permanent (an unlogged relation can
//      acknowledge a write a crash then loses) and free of row-level
//      security (RLS-hidden rows can fake absence), with the exact
//      custody relation contract (custody_pin, custody_backup). The
//      preflight validates the CUSTODY schema separately: the shipped
//      factory's own catalog preflight covers the ADAPTER (financial)
//      schema's four relations — or five with native terminal history
//      — and the custody relations are never added to it. GAP-1's
//      session is constructed through a gated Client wrapper: until
//      prepare() has run the preflight successfully, no custody
//      client can be constructed at all, so no custody operation can
//      precede the preflight. A failed or unperformable preflight is
//      a named boot failure; the composition never starts.
//   2. CONFIRMED CONNECTION CLOSURE. GAP-1's retire() is local
//      fencing only (its end() outcome is suppressed by design). The
//      composition root owns confirmed closure of the custody
//      connection: GAP-1's session is built through an observing
//      Client wrapper that records the underlying end() settlement,
//      and retireCustody() fences the stores, then reports the
//      closure as confirmed only when that end() actually resolved —
//      failed or unconfirmed otherwise, surfaced by the entry, never
//      silently assumed.
//
// Context updates (the named adapter): the trusted canonical mutation
// owner is the canonical data file itself — data.json at the repo
// root, the same file server.js's loadCanonicalData serves on the
// preactivation path — whose only writers are the deployment/data
// pipeline that replaces the file. The observable revision mechanism
// is the filesystem revision fingerprint (dev, ino, size, mtimeNs,
// ctimeNs — the tuple scripts/server-live-refresh.js's fileRevision
// already uses for runtime files): any rewrite, including an ABA
// return to earlier bytes, moves the fingerprint, while an unchanged
// fingerprint means the file was not rewritten. The host observes the
// file with fs.watch; every fingerprint change triggers a
// fingerprint-verified re-read whose snapshot is handed to P1's
// advanceContext, the trusted owner's only update path, so the
// context revision advances on every contents change and an unchanged
// revision always means unchanged contents. Value polling is never
// used as no-change evidence. The env component never mutates inside
// a process (environment changes arrive by restart), so the adapter
// advances canonical only, re-presenting the boot env snapshot
// unchanged. If the watch cannot be established the adapter stays
// unwired: the composition keeps its boot snapshot, and server.js's
// own context guard still retires the composition if contents ever
// change at an unchanged revision — fail-closed, never silently fresh.

const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const tls = require('node:tls');
const { Client } = require('pg');
const {
  createSettlementProductionOwners,
  createSettlementProductionCustody,
} = require('./settlement-production-owners');
const { createSettlementCustodyDurableStores } =
  require('./settlement-custody-durable-stores');
const { createSettlementAuthorizationReadFacade } = require('../server');

const PREFIX = 'settlement-production-host: ';
const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const LEDGER_RE = /^ledger-[a-f0-9]{32}$/;
const AUTHORITY_RE = /^authority-[a-f0-9]{32}$/;
const IDENT_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function invalid(field) {
  throw new Error(PREFIX + 'invalid configuration — ' + field);
}
function preflightFailure(stage) {
  return new Error(PREFIX + 'custody preflight failed — ' + stage);
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// Every configuration value this host consumes. Presence of ANY one of
// them triggers full validation: a half-supplied activation never
// serves degraded or ambiguous (packet §1). The custody profile is a
// group: none of it, or all of it.
const PROFILE_STEMS = ['SETTLEMENT_FINANCIAL_DB', 'SETTLEMENT_AUTH_DB',
  'SETTLEMENT_CUSTODY_DB'];
const PROFILE_SUFFIXES = ['HOST', 'PORT', 'NAME', 'USER', 'PASSWORD',
  'SSL_SERVERNAME', 'SCHEMA', 'SCOPE'];
const KNOWN_KEYS = [
  ...PROFILE_STEMS.flatMap(stem => PROFILE_SUFFIXES.map(s => stem + '_' + s)),
  'SETTLEMENT_HOUSEHOLD_ID', 'SETTLEMENT_ORIGIN', 'SETTLEMENT_CONTEXT_DOMAIN',
  'SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE',
  'SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY',
  'SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY',
  'SETTLEMENT_ANCHOR_PREFIX', 'SETTLEMENT_ANCHOR_SCHEMA',
];
const REQUIRED_KEYS = KNOWN_KEYS.filter(k =>
  k !== 'SETTLEMENT_ANCHOR_PREFIX' && k !== 'SETTLEMENT_ANCHOR_SCHEMA'
  && !k.endsWith('_SSL_SERVERNAME') && !k.startsWith('SETTLEMENT_CUSTODY_DB'));
const CUSTODY_REQUIRED_KEYS = PROFILE_SUFFIXES
  .filter(s => s !== 'SSL_SERVERNAME')
  .map(s => 'SETTLEMENT_CUSTODY_DB_' + s);

function validHostname(host, field) {
  if (typeof host !== 'string' || host.length === 0 || host.length > 253
    || !host.includes('.') || net.isIP(host)
    || host.includes('-pooler')
    || !host.split('.').every(x => HOST_LABEL_RE.test(x))) invalid(field);
  return host;
}

function validPort(value, field) {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) invalid(field);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) invalid(field);
  return port;
}

function validIdent(value, field) {
  if (typeof value !== 'string' || !IDENT_RE.test(value)) invalid(field);
  return value;
}

function validSchema(value, field) {
  validIdent(value, field);
  if (value.startsWith('pg_') || value === 'information_schema') invalid(field);
  return value;
}

function validPassword(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024
    || value.includes('\0')) invalid(field);
  return value;
}

function validScope(value, field) {
  if (typeof value !== 'string' || !SCOPE_RE.test(value)) invalid(field);
  return value;
}

// One direct-session Postgres profile in the exact shape
// startServer's compositionConnection (and GAP-1's profile validation)
// consumes. ssl.rejectUnauthorized is pinned true in code and the
// servername is the host itself; a supplied SETTLEMENT_*_SSL_SERVERNAME
// that disagrees can never compose and is refused here by name.
// Direct sessions only — a transaction pooler endpoint is refused by
// the '-pooler' host rule.
function profile(values, stem) {
  const host = validHostname(values[stem + '_HOST'], stem + '_HOST');
  const servername = values[stem + '_SSL_SERVERNAME'];
  if (servername !== undefined && servername !== host) {
    invalid(stem + '_SSL_SERVERNAME');
  }
  return {
    Client,
    config: {
      host,
      port: validPort(values[stem + '_PORT'], stem + '_PORT'),
      database: validIdent(values[stem + '_NAME'], stem + '_NAME'),
      user: validIdent(values[stem + '_USER'], stem + '_USER'),
      password: validPassword(values[stem + '_PASSWORD'], stem + '_PASSWORD'),
      ssl: { rejectUnauthorized: true, servername: host },
    },
    schema: validSchema(values[stem + '_SCHEMA'], stem + '_SCHEMA'),
    scope: validScope(values[stem + '_SCOPE'], stem + '_SCOPE'),
  };
}

function fingerprintOf(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs]
    .map(String).join(':');
}

// --- Custody session/catalog preflight --------------------------------
// The shipped connection discipline (settlement-evidence-postgres-
// connection.js), discharged by the host for the custody profile:
// four bounded, parameterized catalog queries — no DDL, no row reads,
// no writes. Bounds mirror the shipped factory's maxima.
const PREFLIGHT_MAX = { connect: 10000, preflight: 10000, query: 7000, close: 2000 };
const CUSTODY_IDENTITY = 'SELECT current_database() AS database, current_user AS "user",'
  + ' pg_backend_pid() AS pid, current_setting(\'search_path\') AS "searchPath"';
const CUSTODY_ROLE = `SELECT r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
  r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole", r.rolinherit AS inherit,
  r.rolreplication AS replication, r.rolbypassrls AS "bypassRls", r.rolconnlimit AS "connectionLimit",
  (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS memberships,
  (SELECT count(*)::int FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass
    AND d.refobjid=r.oid AND d.deptype='o') AS "ownedObjects"
  FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
// Grants per GAP-1's relation contract: custody_pin SELECT/INSERT/
// UPDATE, custody_backup SELECT/INSERT; no DELETE, TRUNCATE, REFERENCES
// or TRIGGER on either, and no database/schema CREATE anywhere.
const CUSTODY_PRIVILEGES = `SELECT has_database_privilege(current_database(),'CONNECT') AS connect,
  has_schema_privilege($1,'USAGE') AS "schemaUsage",
  has_database_privilege(current_database(),'CREATE') AS "databaseCreate",
  has_schema_privilege($1,'CREATE') AS "schemaCreate",
  (SELECT bool_and(has_table_privilege(format('%I.%I',$1,t.name),'SELECT')
    AND has_table_privilege(format('%I.%I',$1,t.name),'INSERT')
    AND has_table_privilege(format('%I.%I',$1,t.name),'UPDATE')=(t.name='custody_pin')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'DELETE')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'TRUNCATE')
    AND NOT has_any_column_privilege(format('%I.%I',$1,t.name),'REFERENCES')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'TRIGGER'))
    FROM (VALUES ('custody_pin'),('custody_backup')) t(name)) AS tables`;
const CUSTODY_SCHEMA = `SELECT c.relname AS name,c.relkind AS kind,c.relpersistence AS persistence,
  c.relrowsecurity AS rls,c.relforcerowsecurity AS "forceRls",
  (c.relhasrules OR c.relispartition OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
    WHERE k.conrelid=c.oid AND (k.contype NOT IN ('p','n') OR k.condeferrable
      OR NOT k.convalidated OR NOT k.conenforced))) AS unsafe,
  (SELECT count(*)::int FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p') AS "primaryKeyCount",
  (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'notNull',a.attnotnull,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
    WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
  ARRAY(SELECT a.attname::text FROM pg_catalog.pg_constraint k CROSS JOIN LATERAL unnest(k.conkey)
    WITH ORDINALITY p(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=p.num
    WHERE k.conrelid=c.oid AND k.contype='p' ORDER BY p.ord) AS "primaryKey"
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname=$1 AND c.relkind<>'i' ORDER BY c.relname LIMIT 3`;

const CUSTODY_RELATIONS = {
  custody_pin: {
    columns: [['scope', 'text'], ['household', 'text'], ['bytes', 'bytea']],
    primaryKey: ['scope'],
  },
  custody_backup: {
    columns: [['scope', 'text'], ['household', 'text'], ['revision', 'text'],
      ['digest', 'text'], ['bytes', 'bytea'], ['integrity', 'text']],
    primaryKey: ['scope', 'revision', 'digest'],
  },
};

function boundedCall(invoke, millis) {
  return Promise.race([
    Promise.resolve().then(invoke),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('bounded call timed out')), millis)),
  ]);
}

async function closeBounded(raw, millis) {
  try {
    return await Promise.race([
      Promise.resolve().then(() => raw.end()).then(() => true, () => false),
      new Promise(resolve => setTimeout(() => resolve(false), millis)),
    ]);
  } catch { return false; }
}

// Runs the preflight over its own dedicated session and closes that
// session with confirmed closure before returning: an unconfirmed end
// means the preflight cannot be considered performed. Throws a named
// host error on any failure; GAP-1's acknowledgements are durable
// only relative to a schema this preflight has validated.
async function preflightSettlementCustodySession(custodyProfile) {
  let raw;
  try { raw = new custodyProfile.Client(custodyProfile.config); } catch {
    throw preflightFailure('client');
  }
  let failure = null;
  try {
    await boundedCall(() => raw.connect(), PREFLIGHT_MAX.connect);
    const socket = raw.connection && raw.connection.stream;
    if (!socket || socket.encrypted !== true || socket.authorized !== true
      || socket.servername !== custodyProfile.config.host
      || socket.authorizationError
      || typeof socket.getPeerCertificate !== 'function'
      || tls.checkServerIdentity(custodyProfile.config.host,
        socket.getPeerCertificate(true))) {
      throw preflightFailure('tls');
    }
    const deadline = Date.now() + PREFLIGHT_MAX.preflight;
    const query = async (text, values) => {
      const left = deadline - Date.now();
      if (left <= 0) throw preflightFailure('timeout');
      let result;
      try {
        result = await boundedCall(() => raw.query(text, values),
          Math.min(PREFLIGHT_MAX.query, left));
      } catch { throw preflightFailure('query'); }
      if (!result || Array.isArray(result) || result.command !== 'SELECT'
        || !Array.isArray(result.rows)) throw preflightFailure('protocol');
      return result.rows;
    };
    const single = rows => {
      if (rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
        throw preflightFailure('protocol');
      }
      return rows[0];
    };
    const id = single(await query(CUSTODY_IDENTITY, []));
    if (id.database !== custodyProfile.config.database
      || id.user !== custodyProfile.config.user
      || !Number.isSafeInteger(id.pid) || id.pid <= 0
      || id.searchPath !== 'pg_catalog') throw preflightFailure('identity');
    const role = single(await query(CUSTODY_ROLE, []));
    if (role.canLogin !== true
      || ['superuser', 'createDb', 'createRole', 'inherit', 'replication',
        'bypassRls'].some(k => role[k] !== false)
      || role.connectionLimit !== 1 || role.memberships !== 0
      || role.ownedObjects !== 0) throw preflightFailure('role');
    const grants = single(await query(CUSTODY_PRIVILEGES, [custodyProfile.schema]));
    if (grants.connect !== true || grants.schemaUsage !== true
      || grants.tables !== true || grants.databaseCreate !== false
      || grants.schemaCreate !== false) throw preflightFailure('privileges');
    const tables = await query(CUSTODY_SCHEMA, [custodyProfile.schema]);
    // At most two relations plus one probe row: a third proves
    // unexpected extra state in the custody schema.
    if (tables.length !== 2) throw preflightFailure('schema');
    const names = new Set();
    for (const t of tables) {
      const contract = CUSTODY_RELATIONS[t.name];
      if (!contract || names.has(t.name)) throw preflightFailure('schema');
      names.add(t.name);
      // persistence 'p' is permanent: 'u' (unlogged) or 't' (temporary)
      // relations are refused — their writes are not crash-durable.
      if (t.kind !== 'r' || t.persistence !== 'p' || t.rls !== false
        || t.forceRls !== false || t.unsafe !== false
        || t.primaryKeyCount !== 1) throw preflightFailure('schema');
      if (!Array.isArray(t.columns) || t.columns.length !== contract.columns.length
        || !t.columns.every((c, i) => c.name === contract.columns[i][0]
          && c.type === contract.columns[i][1] && c.notNull === true
          && c.generated === '')) throw preflightFailure('schema');
      if (!Array.isArray(t.primaryKey)
        || t.primaryKey.length !== contract.primaryKey.length
        || !t.primaryKey.every((c, i) => c === contract.primaryKey[i])) {
        throw preflightFailure('schema');
      }
    }
    if (Date.now() > deadline) throw preflightFailure('timeout');
  } catch (error) {
    failure = error && typeof error.message === 'string'
      && error.message.startsWith(PREFIX) ? error : preflightFailure('session');
  }
  const closed = await closeBounded(raw, PREFLIGHT_MAX.close);
  if (failure) throw failure;
  if (!closed) throw preflightFailure('close');
}

// GAP-1's session is built through this wrapper: construction is
// refused until the host's preflight gate has opened, and every
// underlying end() settlement is recorded for the composition root's
// confirmed-closure report. The wrapper returns the raw client
// untouched apart from the end() observation; it adds no behaviour
// of its own to the session.
function observeCustodyClient(ClientClass, gate, record) {
  return class ObservedCustodyClient {
    constructor(config) {
      if (!gate.open) {
        throw new Error(PREFIX
          + 'custody session refused — the custody preflight has not passed');
      }
      const raw = new ClientClass(config);
      const entry = { endCalled: false, endOutcome: 'pending' };
      record.sessions.push(entry);
      const end = raw.end.bind(raw);
      raw.end = (...args) => {
        entry.endCalled = true;
        const pending = Promise.resolve().then(() => end(...args));
        pending.then(
          () => { entry.endOutcome = 'resolved'; },
          () => { entry.endOutcome = 'rejected'; });
        return pending;
      };
      return raw;
    }
  };
}

function createSettlementProductionHost(config, seams = {}) {
  if (config === null || typeof config !== 'object') invalid('config');
  const values = {};
  for (const key of KNOWN_KEYS) {
    if (Object.hasOwn(config, key) && config[key] !== undefined) {
      values[key] = config[key];
    }
  }
  const inactiveHandle = () => Object.freeze({
    active: false,
    settlement: null,
    async prepare() { return null; },
    async retireCustody() {
      return Object.freeze({ state: 'retired', close: 'not-started' });
    },
    startContextAdapter() {},
    close() {},
  });
  if (Object.keys(values).length === 0) {
    // Inactive: no settlement value supplied. The entry calls
    // startServer() exactly as today; no client, custody or context
    // work happens at boot and the capability readout stays inactive.
    return inactiveHandle();
  }
  for (const key of REQUIRED_KEYS) {
    if (values[key] === undefined) invalid(key);
  }
  const custodySupplied = CUSTODY_REQUIRED_KEYS
    .some(k => values[k] !== undefined);
  if (custodySupplied) {
    for (const key of CUSTODY_REQUIRED_KEYS) {
      if (values[key] === undefined) invalid(key);
    }
  }

  const householdId = values.SETTLEMENT_HOUSEHOLD_ID;
  if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
    invalid('SETTLEMENT_HOUSEHOLD_ID');
  }
  const origin = values.SETTLEMENT_ORIGIN;
  let originOk = false;
  if (typeof origin === 'string') {
    try {
      const url = new URL(origin);
      originOk = (url.protocol === 'https:' || url.protocol === 'http:')
        && !url.username && !url.password && url.pathname === '/'
        && !url.search && !url.hash && url.origin === origin;
    } catch { originOk = false; }
  }
  if (!originOk) invalid('SETTLEMENT_ORIGIN');
  const domain = values.SETTLEMENT_CONTEXT_DOMAIN;
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 128) {
    invalid('SETTLEMENT_CONTEXT_DOMAIN');
  }
  const exclusionDomain = {
    ledgerNamespace: values.SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE,
    serializationAuthority: values.SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY,
    historyAuthority: values.SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY,
  };
  if (!LEDGER_RE.test(exclusionDomain.ledgerNamespace)) {
    invalid('SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE');
  }
  if (!AUTHORITY_RE.test(exclusionDomain.serializationAuthority)) {
    invalid('SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY');
  }
  if (!AUTHORITY_RE.test(exclusionDomain.historyAuthority)) {
    invalid('SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY');
  }

  const connection = profile(values, 'SETTLEMENT_FINANCIAL_DB');
  const authorization = profile(values, 'SETTLEMENT_AUTH_DB');
  // startServer refuses two profiles that share host+database and
  // (user or schema); name the refusal here, before any client exists.
  if (connection.config.host === authorization.config.host
    && connection.config.database === authorization.config.database
    && (connection.config.user === authorization.config.user
      || connection.schema === authorization.schema)) {
    invalid('SETTLEMENT_AUTH_DB_USER');
  }

  // The canonical snapshot the preactivation entry serves: data.json at
  // the repo root (server.js's loadCanonicalData file). A test or an
  // operator may name another file through the canonicalFile value;
  // it is a path value, never code.
  const canonicalFile = typeof config.canonicalFile === 'string'
    ? config.canonicalFile
    : path.join(__dirname, '..', 'data.json');
  let canonical;
  let lastFingerprint;
  try {
    const stat = fs.statSync(canonicalFile, { bigint: true });
    canonical = JSON.parse(fs.readFileSync(canonicalFile, 'utf8'));
    lastFingerprint = fingerprintOf(stat);
  } catch { invalid('canonical'); }
  if (!isPlainRecord(canonical)) invalid('canonical');

  // The context env is the same record the entry hands to startServer,
  // copied once at boot. server.js validates on every context read
  // that SITE_PASSWORD and SESSION_SECRET agree with the server env.
  const contextEnv = {};
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string') contextEnv[k] = v;
  }

  // GAP-2 seam: the read-only facade over the composition's own guarded
  // authorization read, keyed by the authorization profile object
  // itself. P1 captures the facade's readAuthorizationState once; the
  // composition binds and unbinds the delegation inside startServer.
  const facade = createSettlementAuthorizationReadFacade(authorization);
  const now = () => Date.now();
  const owners = createSettlementProductionOwners({
    householdId,
    authorizationStore: facade,
    context: { canonical, env: contextEnv, domain },
  });

  // --- Custody binding -------------------------------------------------
  let custody;
  let durableStores = null;
  let custodyGate = null;
  let custodyRecord = null;
  let custodyProfile = null;
  if (!custodySupplied) {
    const custodyWhole = createSettlementProductionCustody({
      householdId,
      exclusionDomain,
      now,
      ...(values.SETTLEMENT_ANCHOR_PREFIX !== undefined
        ? { prefix: values.SETTLEMENT_ANCHOR_PREFIX } : {}),
      ...(values.SETTLEMENT_ANCHOR_SCHEMA !== undefined
        ? { schema: values.SETTLEMENT_ANCHOR_SCHEMA } : {}),
    });
    // startServer's custody record allows exactly four keys; the host
    // picks them from P1's six-key custody return and never passes the
    // raw record.
    custody = Object.freeze({
      pinStore: custodyWhole.pinStore,
      backupStore: custodyWhole.backupStore,
      terminalHistory: custodyWhole.terminalHistory,
      exclusionDomain: custodyWhole.exclusionDomain,
    });
  } else {
    custodyProfile = profile(values, 'SETTLEMENT_CUSTODY_DB');
    // The custody relations live under their OWN schema and scope,
    // never the adapter (financial) schema or scope.
    if (custodyProfile.schema === connection.schema
      || custodyProfile.schema === authorization.schema) {
      invalid('SETTLEMENT_CUSTODY_DB_SCHEMA');
    }
    if (custodyProfile.scope === connection.scope) {
      invalid('SETTLEMENT_CUSTODY_DB_SCOPE');
    }
    if (!seams || typeof seams.encrypt !== 'function') {
      throw new Error(PREFIX + 'durable custody requires the injected '
        + 'encryption function (activation-time input) — not bound');
    }
    custodyGate = { open: false };
    custodyRecord = { sessions: [] };
    durableStores = createSettlementCustodyDurableStores({
      connection: {
        Client: observeCustodyClient(Client, custodyGate, custodyRecord),
        config: custodyProfile.config,
        schema: custodyProfile.schema,
        scope: custodyProfile.scope,
      },
      householdId,
      encrypt: seams.encrypt,
    });
    custody = Object.freeze({
      pinStore: durableStores.pinStore,
      backupStore: durableStores.backupStore,
      // The native selection the runtime already implements over the
      // financial profile (its catalog preflight then covers five
      // relations including terminal_history). No second history
      // surface is created here.
      terminalHistory: Object.freeze({ mode: 'postgres' }),
      exclusionDomain: Object.freeze({ ...exclusionDomain }),
    });
  }

  const settlement = Object.freeze({
    connection,
    authorization,
    custody,
    application: Object.freeze({
      householdId,
      origin,
      authorize: owners.authorize,
      authorizeRecovery: owners.authorizeRecovery,
      contextReader: owners.contextReader,
      now,
    }),
  });

  // --- Assembly-owned custody lifecycle --------------------------------
  let prepared = false;
  async function prepare() {
    if (!durableStores || prepared) return settlement;
    await preflightSettlementCustodySession(custodyProfile);
    custodyGate.open = true;
    prepared = true;
    return settlement;
  }

  let custodyRetirePromise = null;
  function retireCustody() {
    if (!durableStores) {
      return Promise.resolve(Object.freeze(
        { state: 'retired', close: 'not-started' }));
    }
    if (custodyRetirePromise) return custodyRetirePromise;
    custodyRetirePromise = (async () => {
      let fenced = true;
      try {
        await Promise.race([
          durableStores.retire(),
          new Promise(resolve => setTimeout(() => { fenced = false; resolve(); }, 3000)),
        ]);
      } catch { fenced = false; }
      const sessions = custodyRecord.sessions;
      let close;
      if (sessions.length === 0) {
        close = 'not-started';
      } else {
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline
          && sessions.some(s => s.endCalled && s.endOutcome === 'pending')) {
          await new Promise(r => setTimeout(r, 10));
        }
        if (sessions.every(s => s.endOutcome === 'resolved')) close = 'confirmed';
        else if (sessions.some(s => s.endOutcome === 'rejected')) close = 'failed';
        else close = 'unconfirmed';
      }
      if (!fenced) close = 'unconfirmed';
      return Object.freeze({
        state: close === 'confirmed' || close === 'not-started' ? 'retired' : 'lost',
        close,
      });
    })();
    return custodyRetirePromise;
  }

  // --- Canonical context adapter (see the header naming) -------------
  // advanceContext stays host-private: it is retained in this closure
  // and in the owners factory only, never placed on the settlement
  // record or the returned handle.
  const advanceContext = owners.advanceContext;
  let watcher = null;
  let closed = false;
  function syncCanonical() {
    if (closed) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      let before;
      try { before = fs.statSync(canonicalFile, { bigint: true }); } catch {
        return; // Absent mid-replace: keep the snapshot; a later event re-syncs.
      }
      const fp = fingerprintOf(before);
      if (fp === lastFingerprint) return;
      let parsed;
      let after;
      try {
        parsed = JSON.parse(fs.readFileSync(canonicalFile, 'utf8'));
        after = fs.statSync(canonicalFile, { bigint: true });
      } catch { return; } // Torn or malformed read: keep the last good snapshot.
      if (fingerprintOf(after) !== fp) continue; // Changed during the read: re-observe.
      lastFingerprint = fp;
      if (!isPlainRecord(parsed)) return; // Never advance on a non-record canonical.
      try {
        advanceContext({ canonical: parsed, env: { ...contextEnv } });
      } catch { /* The trusted owner refused the advance; snapshot retained. */ }
      return;
    }
  }
  function startContextAdapter() {
    if (watcher || closed) return;
    try {
      watcher = fs.watch(path.dirname(canonicalFile), (_event, name) => {
        if (!name || name === path.basename(canonicalFile)) syncCanonical();
      });
      watcher.on('error', () => {
        // Unwired: the composition keeps its boot snapshot (header).
        try { watcher.close(); } catch { /* already closed */ }
        watcher = null;
      });
    } catch { watcher = null; }
  }
  function close() {
    closed = true;
    if (watcher) {
      try { watcher.close(); } catch { /* already closed */ }
      watcher = null;
    }
  }

  return Object.freeze({
    active: true,
    settlement,
    prepare,
    retireCustody,
    startContextAdapter,
    close,
  });
}

module.exports = { createSettlementProductionHost };
