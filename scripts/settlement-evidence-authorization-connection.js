'use strict';
// Disconnected connection ownership for the settlement-evidence
// authorization-state store (PR #706). No production importer, no driver
// import, no environment-secret resolution, no provisioning, no DDL, no
// composition wiring and no activation. Client is a trusted injected
// direct/non-reconnecting pg.Client constructor. After a bounded connect,
// a TLS check and its own four-statement catalog preflight over exactly
// the authorization store's three relations in a composition-supplied
// schema, the factory constructs the existing authorization store ONCE,
// internally, over a bounded { query, on, retire } session wrapper and
// exposes only the frozen { authorizationStore, retire, status } owner.
// The session and the raw client never cross this boundary. The financial
// connection, its preflight and its schema are untouched and unreferenced.
// Catalog preflight targets PostgreSQL 18. Metadata checks are
// point-in-time, not protection against an admin changing the server
// afterwards, and they qualify only the named authorization profile: least
// privilege inside the authorization schema. They cannot prove the
// authorization role holds no grants elsewhere; that negative belongs to
// provisioning review. Production driver/Linux qualification, credential
// provisioning and production composition are separate later gates.
// Rollback protection is NOT provided (inherited from the store's own
// non-claims): restoring a pre-revocation checkpoint resurrects revoked
// state; that remains an activation prerequisite owned elsewhere.
const tls = require('node:tls');
const net = require('node:net');
const { performance } = require('node:perf_hooks');
const { createAuthorizationStore } = require('./settlement-evidence-authorization-store');
const { decodeRevocationEntry } = require('./settlement-evidence-anchor-store');

const MAX = Object.freeze({ connect:10000, preflight:10000, query:7000, close:2000 });
const CLAIMED = new WeakSet();
const FAILURES = new WeakSet();
const TRUST = /^(?:PG.*|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_SYSTEM_CA|SSL_CERT_FILE|SSL_CERT_DIR|OPENSSL_.*)$/i;
const SQLSTATES = new Set(['28000','28P01','42501','42P01','42703','42704','3D000',
  '53300','53400','57P01','57P02','57P03','57014','55P03','25P03','25P04',
  '08000','08003','08006','08001','08004','08007','08P01','40001','40P01','23505','23502','22001']);
const DNS = new Set(['ENOTFOUND','EAI_AGAIN']);
const TCP = new Set(['ECONNRESET','ECONNREFUSED','EPIPE','ETIMEDOUT','ENETUNREACH','EHOSTUNREACH']);
const TLS = new Set(['ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY']);

function failure(stage, category, code = null) {
  const e = new Error('settlement-authorization-connection: ' + stage + ' failed');
  e.code = 'SETTLEMENT_AUTHORIZATION_CONNECTION';
  e.diagnostic = Object.freeze({ stage, category, code });
  FAILURES.add(e);
  return e;
}
function sanitize(error, stage) {
  if (error && FAILURES.has(error)) return error;
  // Never read message/detail/cause/stack or stringify a driver object.
  let code;
  try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch { /* no raw access */ }
  const category = DNS.has(code) ? 'dns' : TCP.has(code) ? 'tcp' : TLS.has(code) ? 'tls'
    : code === '28P01' || code === '28000' ? 'authentication' : SQLSTATES.has(code) ? 'sql' : 'other';
  return failure(stage, category, category === 'other' ? null : code);
}
function check(ok, stage, category) { if (!ok) throw failure(stage, category); }
function record(value, allowed, required = allowed) {
  check(value && Object.getPrototypeOf(value) === Object.prototype, 'config', 'invalid-config');
  const fields = Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(fields).every(k => typeof k === 'string' && allowed.includes(k)
    && Object.hasOwn(fields[k], 'value')) && required.every(k => Object.hasOwn(fields,k)), 'config','invalid-config');
  return Object.fromEntries(Object.entries(fields).map(([k,d]) => [k,d.value]));
}
function validate(options) {
  const o = record(options, ['Client','config','schema','scope','timeouts','anchorStore','witness'], ['Client','config','schema','scope']);
  const c = record(o.config, ['host','port','database','user','password','ssl']);
  const ssl = record(c.ssl, ['rejectUnauthorized','servername']);
  check(typeof o.Client === 'function', 'config','invalid-config');
  check(typeof c.host === 'string' && c.host.length <= 253 && c.host.includes('.') && !net.isIP(c.host)
    && c.host.split('.').every(x => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))
    && !c.host.includes('-pooler'), 'config','invalid-config');
  check(Number.isInteger(c.port) && c.port > 0 && c.port <= 65535, 'config','invalid-config');
  for (const key of ['database','user']) check(typeof c[key] === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(c[key]), 'config','invalid-config');
  check(typeof c.password === 'string' && c.password.length > 0 && c.password.length <= 1024 && !c.password.includes('\0'), 'config','invalid-config');
  check(ssl.rejectUnauthorized === true && ssl.servername === c.host, 'config','invalid-config');
  // Schema and scope rules are byte-identical to the authorization store's
  // own construction validation: a value the store would refuse is refused
  // here first, and the identical captured literals are what the store is
  // constructed with after preflight.
  check(typeof o.schema === 'string' && /^[a-z_][a-z0-9_]{0,62}$/.test(o.schema)
    && !o.schema.startsWith('pg_') && o.schema !== 'information_schema', 'config','invalid-config');
  check(typeof o.scope === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(o.scope), 'config','invalid-config');
  const times = { ...MAX, ...(o.timeouts === undefined ? {} : record(o.timeouts,Object.keys(MAX),[])) };
  for (const k of Object.keys(MAX)) check(Number.isInteger(times[k]) && times[k] > 0 && times[k] <= MAX[k], 'config','invalid-config');
  check(!Object.keys(process.env).some(k => TRUST.test(k)), 'environment','environment');
  const hasAnchor = Object.hasOwn(o, 'anchorStore');
  const hasWitness = Object.hasOwn(o, 'witness');
  if (hasAnchor !== hasWitness) throw failure('config', 'invalid-config');
  let composer = null;
  if (hasAnchor) {
    const anchorStore = o.anchorStore;
    const witness = o.witness;
    check(anchorStore && Object.getPrototypeOf(anchorStore) === Object.prototype, 'config', 'invalid-config');
    check(witness && Object.getPrototypeOf(witness) === Object.prototype, 'config', 'invalid-config');
    const witnessStore = witness.witnessStore;
    check(witnessStore && typeof witnessStore === 'object', 'config', 'invalid-config');
    for (const name of ['readAuthorization', 'advanceAuthorization', 'listAuthorizationGenerations',
      'openAuthorizationIntent', 'writeAckAuthorization', 'writeVoidAuthorization',
      'writeDuplicateSatisfiedAuthorization', 'replayAuthorization', 'classifyAuthorization',
      'completeAuthorizationProvenance', 'listProvenanceAuthorization']) {
      check(typeof anchorStore[name] === 'function', 'config', 'invalid-config');
    }
    for (const name of ['appendObservation', 'readHead', 'listObservations']) {
      check(typeof witnessStore[name] === 'function', 'config', 'invalid-config');
    }
    composer = { anchorStore, witnessStore };
  }
  return { ...o, times, composer, config:{ host:c.host, port:c.port, database:c.database, user:c.user,
    password:c.password, ssl:{rejectUnauthorized:true,servername:c.host},
    application_name:'atlas-settlement-authorization', connectionTimeoutMillis:times.connect,
    query_timeout:times.query, statement_timeout:5000, lock_timeout:1000,
    idle_in_transaction_session_timeout:10000, keepAlive:true } };
}

// Four bounded, parameterized catalog queries. No DDL, SET ROLE, application
// row reads, or writes. Effective PUBLIC defaults (including TEMP) are not
// removed. The authorization store calls no database functions, so — unlike
// the financial preflight — there is deliberately no functions limb.
const IDENTITY = 'SELECT current_database() AS database, current_user AS "user", pg_backend_pid() AS pid,'
  + ' current_setting(\'search_path\') AS "searchPath"';
const ROLE = `SELECT r.rolcanlogin AS "canLogin", r.rolsuper AS superuser,
  r.rolcreatedb AS "createDb", r.rolcreaterole AS "createRole", r.rolinherit AS inherit,
  r.rolreplication AS replication, r.rolbypassrls AS "bypassRls", r.rolconnlimit AS "connectionLimit",
  (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS memberships,
  (SELECT count(*)::int FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass
    AND d.refobjid=r.oid AND d.deptype='o') AS "ownedObjects"
  FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
// Append-only profile: SELECT and INSERT are required on all three
// relations; UPDATE, DELETE, TRUNCATE and TRIGGER are forbidden at table
// level, and UPDATE and REFERENCES are forbidden as effective column-level
// grants as well (a column-only UPDATE is an effective UPDATE).
const PRIVILEGES = `SELECT has_database_privilege(current_database(),'CONNECT') AS connect,
  has_schema_privilege($1,'USAGE') AS "schemaUsage",
  has_database_privilege(current_database(),'CREATE') AS "databaseCreate",
  has_schema_privilege($1,'CREATE') AS "schemaCreate",
  (SELECT bool_and(has_table_privilege(format('%I.%I',$1,t.name),'SELECT')
    AND has_table_privilege(format('%I.%I',$1,t.name),'INSERT')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'UPDATE')
    AND NOT has_any_column_privilege(format('%I.%I',$1,t.name),'UPDATE')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'DELETE')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'TRUNCATE')
    AND NOT has_any_column_privilege(format('%I.%I',$1,t.name),'REFERENCES')
    AND NOT has_table_privilege(format('%I.%I',$1,t.name),'TRIGGER'))
    FROM (VALUES ('auth_eligibility'),('auth_revocation'),
                 ('auth_session_revocation')) t(name)) AS tables`;
const SCHEMA = `SELECT c.relname AS name,c.relkind AS kind,c.relpersistence AS persistence,
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
  WHERE n.nspname=$1 AND c.relkind<>'i' ORDER BY c.relname LIMIT 4`;
// The one fixed profile: exactly the authorization store's relation
// contract — column names, format_type types and order, primary keys in
// key order. Every column is NOT NULL and none is generated, because the
// store inserts every column and its proven-absence read depends on SQL
// nulls arising only from a missing joined row, never from a present row.
const RELATIONS = Object.freeze({
  auth_eligibility: Object.freeze({
    columns: [['scope','text'],['household_id','text'],['operation_id','text'],['generation','text'],
      ['confirmation_digest','text'],['secret_digest','text'],['issued_at','bigint']],
    primaryKey: ['scope','operation_id','generation'] }),
  auth_revocation: Object.freeze({
    columns: [['scope','text'],['operation_id','text'],['generation','text'],['revoked_at','bigint']],
    primaryKey: ['scope','operation_id','generation'] }),
  auth_session_revocation: Object.freeze({
    columns: [['scope','text'],['sid_digest','text'],['revoked_at','bigint']],
    primaryKey: ['scope','sid_digest'] }),
});

// A genuine dense Array: an own data value at every index. Iteration
// helpers such as every() skip holes, so density is proven by explicit
// per-index own-property presence, never by iteration semantics.
function dense(value) {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (!d || !Object.hasOwn(d, 'value')) return false;
  }
  return true;
}
function rows(result, stage) {
  check(result && !Array.isArray(result), stage, 'protocol');
  // Capture the envelope and the rows exactly once, as own data. An
  // accessor is never invoked, so a substituted second read can reach
  // neither validation nor any consumer; only the capture is consumed.
  const command = Object.getOwnPropertyDescriptor(result, 'command');
  const captured = Object.getOwnPropertyDescriptor(result, 'rows');
  check(command && Object.hasOwn(command, 'value') && command.value === 'SELECT', stage, 'protocol');
  check(captured && Object.hasOwn(captured, 'value') && dense(captured.value), stage, 'protocol');
  const list = captured.value;
  for (let i = 0; i < list.length; i++) check(list[i] && typeof list[i] === 'object', stage, 'protocol');
  return list;
}
function single(result, stage) { const r=rows(result,stage);check(r.length===1 && r[0] && typeof r[0]==='object',stage,'protocol');return r[0]; }
function schemaMatches(result) {
  const tables=rows(result,'schema');
  // At most four non-index relations: the fourth proves unexpected extra state.
  check(tables.length===3,'schema','schema');
  const names=new Set();
  for (let i = 0; i < tables.length; i++) {
    const t=tables[i];
    // Relation names are primitive strings, unique and exact. A boxed
    // String or an Array merely coerces to a contract key; it is not
    // one, and never stands in for a present relation. Three unique
    // contract keys over exactly three rows mean each expected
    // relation is present exactly once.
    const name=t.name;
    check(typeof name === 'string', 'schema','schema');
    const contract=RELATIONS[name];
    check(contract !== undefined && !names.has(name), 'schema','schema'); names.add(name);
    check(t.kind==='r' && t.persistence==='p' && t.rls===false && t.forceRls===false
      && t.unsafe===false && t.primaryKeyCount===1, 'schema','schema');
    const columns=t.columns, primaryKey=t.primaryKey;
    check(dense(columns) && columns.length===contract.columns.length,'schema','schema');
    for (let j = 0; j < contract.columns.length; j++) {
      const c=columns[j];
      check(c && typeof c === 'object' && c.name===contract.columns[j][0] && c.type===contract.columns[j][1]
        && c.notNull===true && c.generated==='', 'schema','schema');
    }
    check(dense(primaryKey) && primaryKey.length===contract.primaryKey.length,'schema','schema');
    for (let j = 0; j < contract.primaryKey.length; j++)
      check(primaryKey[j]===contract.primaryKey[j],'schema','schema');
  }
}

function revocationKey(decoded) {
  return decoded.kind === 'oprev'
    ? 'oprev:' + decoded.operationId + '/' + decoded.generation
    : 'sesrev:' + decoded.sidDigest;
}
function unknownOutcome(reason, state, extra) {
  return Object.freeze({ outcome: 'unknown', reason, state, ...(extra || {}) });
}

// §2.3.2 composer. Appends are admitted only while reconciliation has
// left the scope clean. Durable success is reported only after the ack
// and the witness observation are both durable. The authorization
// connection's enumerable owner stays { authorizationStore, retire, status }.
function createAnchoredAppend(deps) {
  const { authorizationStore, anchorStore, witnessStore, schema, scope } = deps;
  let serving = false;
  let last = Object.freeze({ status: 'unreconciled', reason: null, serving: false });
  let tail = Promise.resolve();
  let clock = 1700000000000;
  function nowTick() {
    clock = Math.max(clock + 1, Date.now());
    return clock;
  }
  function serial(fn) {
    const run = tail.then(fn, fn);
    tail = run.then(() => {}, () => {});
    return run;
  }
  function mark(status, reason) {
    serving = false;
    last = Object.freeze({ status, reason, serving: false });
    return last;
  }
  function markClean() {
    serving = true;
    last = Object.freeze({ status: 'clean', reason: null, serving: true });
    return last;
  }
  function hexesOf(frontier) {
    return frontier.entries.map(entry => Buffer.from(entry).toString('hex'));
  }
  async function observations() {
    const listed = await witnessStore.listObservations({ scope });
    if (!listed || listed.state !== 'ok' || !Array.isArray(listed.observations)) return null;
    return listed.observations;
  }
  async function readFrontier(incarnation) {
    const read = await authorizationStore.readCanonicalRevocationSet({ incarnation });
    if (!read || read.state !== 'ok' || !read.frontier) return null;
    if (read.frontier.schema !== schema || read.frontier.scope !== scope) return null;
    if (read.frontier.incarnation !== incarnation) return null;
    return read.frontier;
  }
  function sameAnchor(a, b) {
    if (!a || !b) return false;
    return a.scope === b.scope && a.incarnation === b.incarnation && a.epoch === b.epoch
      && a.revocationCount === b.revocationCount && a.frontierDigest === b.frontierDigest
      && a.priorDigest === b.priorDigest && a.lastEventId === b.lastEventId
      && a.updatedAt === b.updatedAt;
  }
  function intendedLanded(landed, next, eventId) {
    return !!landed && landed.scope === scope && landed.incarnation === next.incarnation
      && landed.epoch === next.epoch && landed.revocationCount === next.revocationCount
      && landed.frontierDigest === next.frontierDigest && landed.priorDigest === next.priorDigest
      && landed.lastEventId === eventId;
  }
  async function sinkObservation(obs) {
    const result = await witnessStore.appendObservation({ ...obs, observedAt: nowTick() });
    if (!result || (result.outcome !== 'appended' && result.outcome !== 'already-present')) {
      throw new Error('witness observation was not durable');
    }
  }
  async function finishLanded(eventId) {
    let gens;
    try { gens = await anchorStore.listAuthorizationGenerations(scope); } catch {
      return unknownOutcome('ack-unknown', 'W3');
    }
    const landed = [...gens].reverse().find(g => g.record && g.record.lastEventId === eventId);
    if (!landed) return unknownOutcome('ack-unknown', 'W3');
    let prov;
    try { prov = await anchorStore.listProvenanceAuthorization(scope); } catch {
      return unknownOutcome('ack-unknown', 'W3');
    }
    const acked = prov.some(e => e.kind === 'ack' && e.eventId === eventId);
    if (!acked) {
      try {
        await anchorStore.writeAckAuthorization(scope, eventId, landed.generation, landed.recordHash);
      } catch {
        return unknownOutcome('ack-unknown', 'W3');
      }
    }
    const listed = await observations();
    const witnessed = listed && listed.some(o => o.scope === scope
      && o.incarnation === landed.record.incarnation && o.epoch === landed.record.epoch
      && o.eventId === eventId);
    if (!witnessed) {
      let result;
      try {
        result = await witnessStore.appendObservation({
          scope, incarnation: landed.record.incarnation, epoch: landed.record.epoch,
          frontierDigest: landed.record.frontierDigest, recordHash: landed.recordHash,
          eventId, observedAt: nowTick(),
        });
      } catch { result = null; }
      if (!result || (result.outcome !== 'appended' && result.outcome !== 'already-present')) {
        return unknownOutcome('witness-unknown', 'W4');
      }
    }
    return Object.freeze({
      outcome: 'appended', state: 'W5', eventId,
      generation: landed.generation, recordHash: landed.recordHash,
    });
  }
  async function successorProof(intentHex) {
    let replay; let current;
    try {
      replay = await anchorStore.replayAuthorization(scope);
      current = await anchorStore.readAuthorization(scope);
    } catch {
      return { ok: false, reason: 'anchor-mismatch-unproven' };
    }
    if (!replay || replay.status !== 'verified' || !current) {
      return { ok: false, reason: 'anchor-mismatch-unproven' };
    }
    if (current.incarnation !== replay.head.incarnation || current.epoch !== replay.head.epoch
      || current.frontierDigest !== replay.head.frontierDigest
      || current.lastEventId !== replay.head.lastEventId
      || current.revocationCount !== replay.head.revocationCount) {
      return { ok: false, reason: 'anchor-mismatch-unproven' };
    }
    const frontier = await readFrontier(current.incarnation);
    if (!frontier) return { ok: false, reason: 'frontier-unknown' };
    const anchored = new Set(replay.anchoredEntries);
    const candidate = hexesOf(frontier);
    if (candidate.length !== frontier.count) return { ok: false, reason: 'anchor-mismatch-unproven' };
    for (const hex of anchored) {
      if (!candidate.includes(hex)) return { ok: false, reason: 'anchor-mismatch-unproven' };
    }
    const delta = candidate.filter(hex => !anchored.has(hex));
    if (delta.length !== 1 || delta[0] !== intentHex) {
      return { ok: false, reason: 'anchor-mismatch-unproven' };
    }
    return {
      ok: true, intentHex, current, next: {
        scope, incarnation: current.incarnation, epoch: current.epoch + 1,
        revocationCount: frontier.count, frontierDigest: frontier.frontierDigest,
        priorDigest: current.frontierDigest, updatedAt: nowTick(),
      },
    };
  }
  async function afterUncertain(expected, next, eventId, intentHex, retriesLeft) {
    let landed;
    try { landed = await anchorStore.readAuthorization(scope); } catch {
      return unknownOutcome('anchor-reread-unknown', 'W2', { committedUnanchored: true });
    }
    if (intendedLanded(landed, next, eventId)) return finishLanded(eventId);
    if (sameAnchor(landed, expected)) {
      if (retriesLeft <= 0) {
        return unknownOutcome('anchor-cas-uncertain', 'W2', { committedUnanchored: true });
      }
      const proof = await successorProof(intentHex);
      if (!proof.ok) {
        return unknownOutcome(proof.reason, proof.reason === 'frontier-unknown' ? 'W2' : 'W2',
          { committedUnanchored: true });
      }
      return attemptCas(proof, eventId, retriesLeft - 1);
    }
    return unknownOutcome('anchor-conflict-unproven', 'UNPROVEN');
  }
  async function attemptCas(proof, eventId, retriesLeft) {
    const next = { ...proof.next, lastEventId: eventId };
    let advanced;
    try {
      advanced = await anchorStore.advanceAuthorization(scope, proof.current, next);
    } catch {
      return afterUncertain(proof.current, next, eventId, proof.intentHex, retriesLeft);
    }
    if (advanced === true) return finishLanded(eventId);
    if (advanced === false) return afterUncertain(proof.current, next, eventId, proof.intentHex, retriesLeft);
    return unknownOutcome('anchor-cas-uncertain', 'W2', { committedUnanchored: true });
  }
  async function findOwning(intentHex, candidateHexes) {
    let decoded;
    try { decoded = decodeRevocationEntry(Buffer.from(intentHex, 'hex')); } catch { return null; }
    const key = revocationKey(decoded);
    const ownerHex = candidateHexes.find(hex => {
      if (hex === intentHex) return false;
      try { return revocationKey(decodeRevocationEntry(Buffer.from(hex, 'hex'))) === key; } catch { return false; }
    });
    if (!ownerHex) return null;
    const prov = await anchorStore.listProvenanceAuthorization(scope);
    const owner = prov.find(e => e.kind === 'intent' && e.entry === ownerHex);
    return owner ? { eventId: owner.eventId, hex: ownerHex } : null;
  }
  async function closeDuplicate(eventId, intentHex) {
    const current = await anchorStore.readAuthorization(scope);
    if (!current) return unknownOutcome('anchor-mismatch-unproven', 'UNPROVEN');
    const frontier = await readFrontier(current.incarnation);
    if (!frontier) return unknownOutcome('frontier-unknown', 'W1');
    const hexes = hexesOf(frontier);
    if (hexes.includes(intentHex)) {
      return unknownOutcome('anchor-mismatch-unproven', 'W2', { committedUnanchored: true });
    }
    const owner = await findOwning(intentHex, hexes);
    if (!owner) return unknownOutcome('anchor-mismatch-unproven', 'UNPROVEN');
    const replay = await anchorStore.replayAuthorization(scope);
    if (!replay || replay.status !== 'verified' || !replay.anchoredEntries.includes(owner.hex)) {
      return unknownOutcome('duplicate-owner-unanchored', 'W1');
    }
    try {
      await anchorStore.writeDuplicateSatisfiedAuthorization(scope, eventId, owner.eventId);
    } catch {
      return unknownOutcome('duplicate-unknown', 'W1');
    }
    return Object.freeze({
      outcome: 'duplicate-satisfied', state: 'T-DUP', eventId, owningEventId: owner.eventId,
    });
  }
  async function resume(admission) {
    const eventId = admission.eventId;
    const prov = await anchorStore.listProvenanceAuthorization(scope);
    const terminal = prov.find(e => e.eventId === eventId
      && (e.kind === 'ack' || e.kind === 'void' || e.kind === 'duplicate-satisfied'));
    if (terminal && terminal.kind === 'void') return unknownOutcome('void', 'T-VOID');
    if (terminal && terminal.kind === 'duplicate-satisfied') {
      return Object.freeze({
        outcome: 'duplicate-satisfied', state: 'T-DUP', eventId, owningEventId: terminal.owningEventId,
      });
    }
    const gens = await anchorStore.listAuthorizationGenerations(scope);
    const landed = [...gens].reverse().find(g => g.record && g.record.lastEventId === eventId);
    if ((terminal && terminal.kind === 'ack') || landed) return finishLanded(eventId);
    return null;
  }
  async function advanceIntent(eventId, intentHex) {
    const proof = await successorProof(intentHex);
    if (!proof.ok) {
      return unknownOutcome(proof.reason, 'W2', { committedUnanchored: true });
    }
    return attemptCas(proof, eventId, 1);
  }
  async function confirmClean() {
    let replay;
    try { replay = await anchorStore.replayAuthorization(scope); } catch {
      return mark('unknown', 'replay-unknown');
    }
    if (!replay || replay.status !== 'verified') {
      return mark('unproven', (replay && replay.reason) || 'replay-unproven');
    }
    const frontier = await readFrontier(replay.head.incarnation);
    if (!frontier) return mark('unknown', 'frontier-unknown');
    const storeSet = new Set(hexesOf(frontier));
    const anchored = new Set(replay.anchoredEntries);
    if (storeSet.size !== anchored.size) return mark('unproven', 'store-anchor-disagreement');
    for (const hex of anchored) if (!storeSet.has(hex)) return mark('unproven', 'store-anchor-disagreement');
    let head;
    try { head = await witnessStore.readHead({ scope }); } catch { head = null; }
    if (!head || head.state !== 'ok' || !head.head) return mark('unproven', 'witness-head-absent');
    let gens;
    try { gens = await anchorStore.listAuthorizationGenerations(scope); } catch {
      return mark('unknown', 'generations-unknown');
    }
    const top = gens[gens.length - 1];
    const witnessed = head.head;
    if (witnessed.incarnation !== replay.head.incarnation) {
      return mark('unverifiable', 'witness head names a foreign incarnation');
    }
    if (witnessed.epoch !== replay.head.epoch || witnessed.frontierDigest !== replay.head.frontierDigest
      || witnessed.recordHash !== top.recordHash || witnessed.eventId !== replay.head.lastEventId) {
      return mark('unproven', 'witness head does not equal the anchor head');
    }
    const observed = await observations();
    if (!observed) return mark('unknown', 'witness-unknown');
    let classified;
    try {
      classified = await anchorStore.classifyAuthorization(scope, {
        storeEntries: [...storeSet], witnessObservations: observed,
      });
    } catch {
      return mark('unknown', 'classify-unknown');
    }
    if (!classified || classified.status !== 'complete') {
      return mark(classified && classified.status === 'unverifiable' ? 'unverifiable' : 'unproven',
        (classified && classified.reason) || 'not-complete');
    }
    return markClean();
  }
  // Actual head is the cross-witness high-watermark: greatest
  // (incarnation, epoch). S1's witnessGate selects greatest epoch, so a
  // foreign head at a lower epoch passes Phase O and Phase A and is
  // noticed only by confirmClean, after the writes. Lineage disagreement
  // and anchor regression against this head refuse first (design §2.3.3
  // trace 14, §2.3.5). A same-incarnation head at or behind the anchor
  // stays on the existing completion path.
  async function gateActualWitnessHead(replay) {
    let read;
    try { read = await witnessStore.readHead({ scope }); } catch {
      return mark('unknown', 'actual-head-unreadable');
    }
    if (!read || read.state !== 'ok') return mark('unknown', 'actual-head-unknown');
    if (!read.head) return mark('unproven', 'witness-head-absent');
    const witnessed = read.head;
    if (witnessed.incarnation !== replay.head.incarnation) {
      return mark('unverifiable', 'witness head names a foreign incarnation');
    }
    if (witnessed.epoch > replay.head.epoch) {
      return mark('unverifiable', 'anchor is behind the witness head');
    }
    if (witnessed.epoch === replay.head.epoch
      && (witnessed.frontierDigest !== replay.head.frontierDigest
        || witnessed.recordHash !== replay.headRecordHash)) {
      return mark('unverifiable', 'witness head disagrees with the anchor head');
    }
    return null;
  }
  async function reconcileBody() {
    let observed;
    try { observed = await observations(); } catch { observed = null; }
    if (!observed) return mark('unknown', 'witness-unknown');
    let replay;
    try { replay = await anchorStore.replayAuthorization(scope); } catch {
      return mark('unknown', 'replay-unknown');
    }
    if (!replay || replay.status !== 'verified') {
      return mark('unproven', (replay && replay.reason) || 'replay-unproven');
    }
    const refused = await gateActualWitnessHead(replay);
    if (refused) return refused;
    let completed;
    try {
      completed = await anchorStore.completeAuthorizationProvenance(scope, {
        witnessObservations: observed,
        appendObservation: obs => sinkObservation(obs),
      });
    } catch {
      return mark('unknown', 'phase-o-unknown');
    }
    if (!completed || completed.status === 'unverifiable') {
      return mark('unverifiable', (completed && completed.reason) || 'unverifiable');
    }
    if (completed.status !== 'completed') return mark('unproven', completed.reason || 'phase-o-unproven');
    let observedAfter;
    try { observedAfter = await observations(); } catch { observedAfter = null; }
    if (!observedAfter) return mark('unknown', 'witness-unknown');
    const frontier = await readFrontier(replay.head.incarnation);
    if (!frontier) return mark('unknown', 'frontier-unknown');
    let classified;
    try {
      classified = await anchorStore.classifyAuthorization(scope, {
        storeEntries: hexesOf(frontier), witnessObservations: observedAfter,
      });
    } catch {
      return mark('unknown', 'classify-unknown');
    }
    if (!classified || classified.status === 'unverifiable') {
      return mark('unverifiable', (classified && classified.reason) || 'unverifiable');
    }
    if (classified.status === 'unproven') return mark('unproven', classified.reason || 'unproven');
    if (classified.status === 'open') {
      const intent = classified.intent;
      if (!intent) return mark('unproven', 'open-intent-missing');
      if (intent.state === 'W1') {
        try { await anchorStore.writeVoidAuthorization(scope, intent.eventId); } catch {
          return mark('unknown', 'void-unknown');
        }
      } else if (intent.state === 'duplicate-satisfiable') {
        let prov;
        try { prov = await anchorStore.listProvenanceAuthorization(scope); } catch {
          return mark('unknown', 'provenance-unknown');
        }
        const row = prov.find(e => e.kind === 'intent' && e.eventId === intent.eventId);
        if (!row) return mark('unproven', 'duplicate-intent-missing');
        const closed = await closeDuplicate(intent.eventId, row.entry);
        if (!closed || closed.outcome !== 'duplicate-satisfied') {
          return mark('unproven', (closed && closed.reason) || 'duplicate-unproven');
        }
      } else if (intent.state === 'W2') {
        let prov;
        try { prov = await anchorStore.listProvenanceAuthorization(scope); } catch {
          return mark('unknown', 'provenance-unknown');
        }
        const row = prov.find(e => e.kind === 'intent' && e.eventId === intent.eventId);
        if (!row || typeof row.entry !== 'string') return mark('unproven', 'new-intent-missing');
        const advanced = await advanceIntent(row.eventId, row.entry);
        if (!advanced || advanced.outcome !== 'appended') {
          const reason = (advanced && advanced.reason) || 'phase-a-unknown';
          const status = reason === 'anchor-conflict-unproven' || reason === 'anchor-mismatch-unproven'
            ? 'unproven' : 'unknown';
          return mark(status, reason);
        }
      } else {
        return mark('unproven', 'landed-transition-still-open');
      }
    } else if (classified.status !== 'complete') {
      return mark('unproven', classified.reason || 'unclassified');
    }
    return confirmClean();
  }
  async function appendKind(kind, input) {
    if (!serving) return unknownOutcome(last.reason || 'reconciliation-refused', last.status || 'UNPROVEN');
    const intentInput = kind === 'oprev'
      ? { scope, kind, operationId: input.operationId, generation: input.generation, revokedAt: input.revokedAt }
      : { scope, kind, sidDigest: input.sidDigest, revokedAt: input.revokedAt };
    let observed;
    try { observed = await observations(); } catch { observed = null; }
    if (!observed) return unknownOutcome('witness-unknown', 'W0');
    let admission;
    try {
      admission = await anchorStore.openAuthorizationIntent(intentInput, { witnessObservations: observed });
    } catch {
      return unknownOutcome('intent-unknown', 'W0');
    }
    if (!admission || admission.status !== 'admitted') {
      return unknownOutcome((admission && admission.reason) || 'anchor-intent-open', 'W0');
    }
    const eventId = admission.eventId;
    const intentHex = admission.entry && admission.entry.entry;
    if (typeof intentHex !== 'string') return unknownOutcome('intent-malformed', 'W1');
    if (admission.resumed) {
      try {
        const resumed = await resume(admission);
        if (resumed) return resumed;
      } catch {
        return unknownOutcome('resume-unknown', 'W1');
      }
    }
    const appended = kind === 'oprev'
      ? await authorizationStore.appendRevocation({
        operationId: input.operationId, generation: input.generation, revokedAt: input.revokedAt,
      })
      : await authorizationStore.appendSessionRevocation({
        sidDigest: input.sidDigest, revokedAt: input.revokedAt,
      });
    if (!appended || appended.outcome === 'unknown') return unknownOutcome('store-unknown', 'W1');
    if (appended.outcome === 'already-present') {
      const current = await anchorStore.readAuthorization(scope);
      const frontier = current && await readFrontier(current.incarnation);
      if (!frontier) return unknownOutcome('frontier-unknown', 'W1');
      if (!hexesOf(frontier).includes(intentHex)) return closeDuplicate(eventId, intentHex);
    } else if (appended.outcome !== 'appended') {
      return unknownOutcome('store-unknown', 'W1');
    }
    const advanced = await advanceIntent(eventId, intentHex);
    if (advanced && advanced.outcome === 'unknown' && advanced.reason === 'anchor-mismatch-unproven') {
      try { await reconcileBody(); } catch { mark('unknown', 'reconciliation-threw'); }
    }
    return advanced;
  }
  function guardedAppend(kind) {
    return input => serial(async () => {
      try { return await appendKind(kind, input); } catch {
        return unknownOutcome('append-threw', serving ? 'W1' : (last.status || 'UNPROVEN'));
      }
    });
  }
  async function runReconcile() {
    try { return await reconcileBody(); } catch { return mark('unknown', 'reconciliation-threw'); }
  }
  const api = Object.freeze({
    appendRevocation: guardedAppend('oprev'),
    appendSessionRevocation: guardedAppend('sesrev'),
    reconcile: () => serial(runReconcile),
    status: () => last,
  });
  return { api, reconcile: () => serial(runReconcile) };
}

async function createSettlementEvidenceAuthorizationConnection(options) {
  let o;
  try {o=validate(options);} catch(error){throw sanitize(error,'config');}
  // No driver or constructor before all input checks.
  let raw;
  try { raw=new o.Client(o.config); } catch(error) { throw sanitize(error,'client-setup'); }
  try {
    check(raw && !CLAIMED.has(raw), 'client-setup','setup');
    check(['connect','query','on','end'].every(k=>typeof raw[k]==='function') && typeof raw.release!=='function'
      && raw.connection && typeof raw.connection.stream==='object','client-setup','setup');
  } catch(error){throw sanitize(error,'client-setup');}
  CLAIMED.add(raw);
  let state='connecting', primary=null, retirement=null, report=null, connectSettled;
  const connectedDone=new Promise(resolve=>{connectSettled=resolve;});
  let lossError=null;
  const lossWatchers=new Set();
  function signalLoss(error) {
    lossError ||= error;
    for(const resolve of lossWatchers)resolve(lossError);
    lossWatchers.clear();
  }
  function raceLoss(pending) {
    let listener;
    const lost=new Promise(resolve=>{listener=resolve;if(lossError)resolve(lossError);else lossWatchers.add(resolve);});
    return Promise.race([pending,lost.then(error=>{throw error;})]).finally(()=>lossWatchers.delete(listener));
  }
  const subscribers={ error:new Set(), end:new Set() };
  function notify(event) { for(const fn of subscribers[event]) { try { fn(); } catch { /* no callback diagnostics */ } } }
  function status() { return Object.freeze({state,primary,retirement:report}); }
  function retire() {
    if(retirement)return retirement;
    // Admission closes synchronously: the state flips and loss is signalled
    // before end() is even invoked, whoever initiated retirement — the
    // owner, the store through its session retire(), or a loss path.
    state='retiring'; signalLoss(failure('retire','retired'));
    // Invoke end once, including during a pending connect. Confirmation also
    // requires that connect settle; a timeout never asserts server release.
    retirement=(async()=>{
      let timer;const deadline=performance.now()+o.times.close;
      const ending=Promise.resolve().then(()=>raw.end()).then(()=>({ok:true}),error=>({ok:false,error}));
      const completion=ending.then(outcome=>outcome.ok?connectedDone.then(()=>outcome):outcome);
      let outcome=await Promise.race([completion,new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),o.times.close);})]);
      clearTimeout(timer);
      if(performance.now()>=deadline && outcome.ok)outcome={timeout:true};
      const close=outcome.timeout?'unconfirmed':outcome.ok?'confirmed':'failed';
      const closeDiagnostic=outcome.timeout?failure('end','timeout').diagnostic
        :outcome.ok?null:sanitize(outcome.error,'end').diagnostic;
      state=close==='confirmed'?'retired':'lost';
      report=Object.freeze({state,close,primary,closeDiagnostic});return report;
    })();
    notify('end');
    return retirement;
  }
  function lose(error) {
    if(state==='retiring'||state==='retired'||state==='lost')return;
    primary ||= error.diagnostic; signalLoss(error); void retire();
  }
  async function bounded(invoke,stage,millis) {
    check(state!=='retiring'&&state!=='retired'&&state!=='lost',stage,'retired');
    let timer;const deadline=performance.now()+millis;
    try {
      const value=await raceLoss(Promise.race([Promise.resolve().then(()=>{
        check(state!=='retiring'&&state!=='retired'&&state!=='lost',stage,'retired');
        check(performance.now()<deadline,stage,'timeout');return invoke();
      }),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(stage,'timeout')),Math.max(1,millis));})]));
      check(state!=='retiring'&&state!=='retired'&&state!=='lost',stage,'retired');
      check(performance.now()<deadline,stage,'timeout');return value;
    } catch(error) {const safe=sanitize(error,stage);lose(safe);throw safe;}
    finally {clearTimeout(timer);}
  }
  let connectStarted=false;
  try {
    raw.on('error',error=>{lose(sanitize(error,'session-error'));notify('error');});
    raw.on('end',()=>{lose(failure('session-end','session'));notify('end');});
    await bounded(()=>{connectStarted=true;return Promise.resolve().then(()=>raw.connect()).finally(connectSettled);},'connect',o.times.connect);
    state='preflight';
    const socket=raw.connection?.stream;
    check(socket?.encrypted===true && socket.authorized===true && socket.servername===o.config.host
      && !socket.authorizationError && typeof socket.getPeerCertificate==='function', 'tls','tls');
    check(!tls.checkServerIdentity(o.config.host,socket.getPeerCertificate(true)), 'tls','tls');
    const deadline=performance.now()+o.times.preflight;
    async function query(text,values,stage) {
      const left=deadline-performance.now();check(left>0,stage,'timeout');
      return bounded(()=>raw.query(text,values),stage,Math.min(o.times.query,left));
    }
    const id=single(await query(IDENTITY,[],'identity'),'identity');
    check(id.database===o.config.database && id.user===o.config.user && Number.isSafeInteger(id.pid) && id.pid>0
      && id.searchPath==='pg_catalog','identity','identity');
    const role=single(await query(ROLE,[],'role'),'role');
    check(role.canLogin===true && ['superuser','createDb','createRole','inherit','replication','bypassRls'].every(k=>role[k]===false)
      && role.connectionLimit===1 && role.memberships===0 && role.ownedObjects===0,'role','privileges');
    const grants=single(await query(PRIVILEGES,[o.schema],'privileges'),'privileges');
    check(['connect','schemaUsage','tables'].every(k=>grants[k]===true)
      && grants.databaseCreate===false && grants.schemaCreate===false,'privileges','privileges');
    schemaMatches(await query(SCHEMA,[o.schema],'schema'));
    check(performance.now()<deadline,'schema','timeout');
    // Preflight is complete. The bounded wrapper is built here and handed
    // ONLY to the real authorization store, constructed once with the
    // identical captured schema/scope. The wrapper's retire() is the shared
    // termination path: store-initiated retirement is a designed, normal
    // path for this pair, so it records NO failure diagnostic (the
    // financial pair's adapter-protocol diagnostic does not apply).
    const client={
      query:(text,values)=>bounded(()=>raw.query(text,values),'query',o.times.query),
      on:(event,fn)=>{check(Object.hasOwn(subscribers,event)&&typeof fn==='function','client-setup','setup');subscribers[event].add(fn);},
      retire:()=>retire()
    };
    const authorizationStore=createAuthorizationStore({session:client,schema:o.schema,scope:o.scope});
    state='ready';
    const published={authorizationStore,retire,status};
    if(o.composer){
      const composer=createAnchoredAppend({
        authorizationStore, anchorStore:o.composer.anchorStore,
        witnessStore:o.composer.witnessStore, schema:o.schema, scope:o.scope,
      });
      await composer.reconcile();
      Object.defineProperty(published,'anchoredAppend',{
        value:composer.api, enumerable:false, writable:false, configurable:false,
      });
    }
    return Object.freeze(published);
  } catch(error) {
    if(!connectStarted)connectSettled();
    const safe=sanitize(error,'client-setup');lose(safe);
    safe.retirement=await retire();throw safe;
  }
}
module.exports = { createSettlementEvidenceAuthorizationConnection };
