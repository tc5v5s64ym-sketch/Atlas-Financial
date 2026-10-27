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
  const o = record(options, ['Client','config','schema','scope','timeouts'], ['Client','config','schema','scope']);
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
  return { ...o, times, config:{ host:c.host, port:c.port, database:c.database, user:c.user,
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
    return Object.freeze({authorizationStore,retire,status});
  } catch(error) {
    if(!connectStarted)connectSettled();
    const safe=sanitize(error,'client-setup');lose(safe);
    safe.retirement=await retire();throw safe;
  }
}
module.exports = { createSettlementEvidenceAuthorizationConnection };
