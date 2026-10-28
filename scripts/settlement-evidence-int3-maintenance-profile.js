'use strict';
// INT-3 C1: maintenance-profile requirements validator (ATLAS-080, #751 C1).
// VALIDATOR ONLY. Pure, offline and inert: no target access, no credentials,
// no DDL, no grants, no setup execution, no filesystem or network. Input is an
// explicit, declared profile manifest; output is a sanitized compatibility
// verdict plus the exact missing/excess requirements, bound to the existing
// owner restore command contract in scripts/restore-settlement-evidence.js
// (a dependency read for its contract, never modified or invoked here).
// A 'compatible' verdict says only that the DECLARED profile matches what the
// restore command would demand. It is not qualification, it proves nothing
// about any real target, and no prior attempt's evidence is inherited by it.

const SCHEMA_ID = 'settlement-int3-maintenance-profile-manifest-1';
const VERDICT_ID = 'settlement-int3-maintenance-profile-verdict-1';

// Native-history relations and privilege profile demanded by the restore
// command (PROFILE/schemaCheck/privileges in restore-settlement-evidence.js).
// Privilege tuple order: [insert, update, delete]; select is always required.
// The whole contract is deep-frozen: the exported REQUIRED_RELATIONS is the
// same object evaluation trusts, so no consumer mutation can alter a verdict.
function deepFreeze(o) { for (const v of Object.values(o)) if (v !== null && typeof v === 'object') deepFreeze(v); return Object.freeze(o); }
const RELATIONS = deepFreeze({
  doc_head: { columns: ['scope', 'bytes'], primaryKey: ['scope'], privileges: [true, true, false] },
  doc_staged: { columns: ['scope', 'bytes'], primaryKey: ['scope'], privileges: [false, false, true] },
  journal: { columns: ['scope', 'bytes'], primaryKey: ['scope'], privileges: [false, false, true] },
  quarantine: { columns: ['scope', 'name', 'label', 'bytes'], primaryKey: ['scope', 'name'], privileges: [true, false, false] },
  terminal_history: { columns: ['scope', 'history_bytes', 'checkpoint_bytes'], primaryKey: ['scope'], privileges: [true, true, false] },
});
const BYTEA = new Set(['bytes', 'history_bytes', 'checkpoint_bytes']);
const NULLABLE = new Set(['label']);
const RUNTIME = Object.freeze({ node: 'v24.22.1', pg: '8.16.3', serverMin: 180000, serverMaxExclusive: 190000 });
const LIMITS = Object.freeze({ connect: 10000, preflight: 10000, query: 7000, close: 2000, dispatch: 120000, outer: 150000, queries: 128, parameters: 64 * 1024 * 1024 });
const ROLE_FALSE = Object.freeze(['superuser', 'createDb', 'createRole', 'inherit', 'replication', 'bypassRls']);
const TABLE_FALSE = Object.freeze(['truncate', 'trigger', 'references']);
// Effective column-level predicates (restore PRIVILEGES: has_any_column_privilege
// INSERT/UPDATE/REFERENCES must equal [insert, update, false]).
const COLUMN_PRIVS = Object.freeze(['anyInsert', 'anyUpdate', 'anyReferences']);
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_RELATIONS = 64, MAX_COLUMNS = 64;

class Invalid extends Error {}
function check(ok) { if (!ok) throw new Invalid('invalid'); }
function plain(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
// Exact own data properties only: no accessors, no extra or missing keys.
function exact(v, keys) {
  check(plain(v));
  const d = Object.getOwnPropertyDescriptors(v), own = Reflect.ownKeys(d);
  check(own.length === keys.length && keys.every(k => Object.hasOwn(d, k) && Object.hasOwn(d[k], 'value')));
  const out = {};
  for (const k of keys) out[k] = d[k].value;
  return out;
}
function list(v, max) {
  check(Array.isArray(v) && v.length <= max && Reflect.ownKeys(v).length === v.length + 1);
  const out = [];
  for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); check(d && Object.hasOwn(d, 'value')); out.push(d.value); }
  return out;
}
const bool = v => { check(typeof v === 'boolean'); return v; };
const ident = v => { check(typeof v === 'string' && IDENT.test(v)); return v; };
const int = v => { check(Number.isSafeInteger(v) && v >= 0); return v; };

function capture(m) {
  const top = exact(m, ['schema', 'namespace', 'relations', 'ownership', 'maintenanceIdentity', 'privileges', 'runtime', 'limits', 'qualification']);
  check(top.schema === SCHEMA_ID);
  const ns = exact(top.namespace, ['schema', 'scope', 'otherRelations']);
  const namespace = { schema: ident(ns.schema), scope: ns.scope, otherRelations: list(ns.otherRelations, MAX_RELATIONS).map(ident) };
  check(typeof namespace.scope === 'string' && SCOPE.test(namespace.scope));
  const relations = list(top.relations, MAX_RELATIONS).map(r => {
    const x = exact(r, ['name', 'kind', 'persistence', 'rowSecurity', 'forceRowSecurity', 'unsafe', 'columns', 'primaryKey']);
    return {
      name: ident(x.name), kind: (check(typeof x.kind === 'string' && x.kind.length === 1), x.kind),
      persistence: (check(typeof x.persistence === 'string' && x.persistence.length === 1), x.persistence),
      rowSecurity: bool(x.rowSecurity), forceRowSecurity: bool(x.forceRowSecurity), unsafe: bool(x.unsafe),
      columns: list(x.columns, MAX_COLUMNS).map(c => {
        const y = exact(c, ['name', 'type', 'notNull', 'generated']);
        check(typeof y.type === 'string' && y.type.length <= 64 && typeof y.generated === 'string' && y.generated.length <= 1);
        return { name: ident(y.name), type: y.type, notNull: bool(y.notNull), generated: y.generated };
      }),
      primaryKey: list(x.primaryKey, MAX_COLUMNS).map(ident),
    };
  });
  const own = exact(top.ownership, ['schemaOwners', 'relationOwners']);
  const ownership = { schemaOwners: list(own.schemaOwners, 8).map(ident), relationOwners: {} };
  check(plain(own.relationOwners));
  const ro = exact(own.relationOwners, Reflect.ownKeys(own.relationOwners).map(k => (check(typeof k === 'string' && IDENT.test(k)), k)));
  for (const k of Object.keys(ro)) ownership.relationOwners[k] = list(ro[k], 8).map(ident);
  const mi = exact(top.maintenanceIdentity, ['user', 'database', 'canLogin', ...ROLE_FALSE, 'connectionLimit', 'memberships', 'ownedObjects']);
  const identity = { user: ident(mi.user), database: ident(mi.database), canLogin: bool(mi.canLogin), connectionLimit: (check(Number.isSafeInteger(mi.connectionLimit) && mi.connectionLimit >= -1), mi.connectionLimit), memberships: int(mi.memberships), ownedObjects: int(mi.ownedObjects) };
  for (const k of ROLE_FALSE) identity[k] = bool(mi[k]);
  const pv = exact(top.privileges, ['database', 'schema', 'functions', 'relations']);
  const db = exact(pv.database, ['connect', 'create']), sc = exact(pv.schema, ['usage', 'create']), fn = exact(pv.functions, ['advisoryLock', 'backendPid']);
  check(plain(pv.relations));
  const rp = exact(pv.relations, Reflect.ownKeys(pv.relations).map(k => (check(typeof k === 'string' && IDENT.test(k)), k)));
  const privileges = { database: { connect: bool(db.connect), create: bool(db.create) }, schema: { usage: bool(sc.usage), create: bool(sc.create) }, functions: { advisoryLock: bool(fn.advisoryLock), backendPid: bool(fn.backendPid) }, relations: {} };
  for (const k of Object.keys(rp)) {
    const t = exact(rp[k], ['select', 'insert', 'update', 'delete', ...TABLE_FALSE, ...COLUMN_PRIVS]);
    privileges.relations[k] = {};
    for (const p of Object.keys(t)) privileges.relations[k][p] = bool(t[p]);
  }
  const rt = exact(top.runtime, ['node', 'pg', 'serverVersionNum']);
  check(typeof rt.node === 'string' && rt.node.length <= 32 && typeof rt.pg === 'string' && rt.pg.length <= 32);
  const runtime = { node: rt.node, pg: rt.pg, serverVersionNum: int(rt.serverVersionNum) };
  check(plain(top.limits));
  const lk = Reflect.ownKeys(top.limits);
  check(lk.length <= 16 && lk.every(k => typeof k === 'string' && k.length <= 32));
  const lim = exact(top.limits, lk), limits = {};
  for (const k of lk) limits[k] = int(lim[k]);
  const q = exact(top.qualification, ['inheritsFrom', 'claims']);
  check(q.inheritsFrom === null || (typeof q.inheritsFrom === 'string' && q.inheritsFrom.length <= 128));
  const qualification = { inheritsFrom: q.inheritsFrom, claims: list(q.claims, 32).map(c => { check(typeof c === 'string' && c.length <= 128); return c; }) };
  return { namespace, relations, ownership, identity, privileges, runtime, limits, qualification };
}

function evaluate(p) {
  const missing = [], excess = [], refused = [];
  // Namespace: the restore command's SCHEMA preflight requires EXACTLY the
  // five native relations (non-index) in the target schema.
  check(!p.namespace.schema.startsWith('pg_') && p.namespace.schema !== 'information_schema');
  const declared = new Map();
  for (const r of p.relations) { check(!declared.has(r.name)); declared.set(r.name, r); }
  for (const name of Object.keys(RELATIONS)) if (!declared.has(name)) missing.push(`relation:${name}`);
  for (const name of declared.keys()) if (!Object.hasOwn(RELATIONS, name)) excess.push(`namespace:extra-relation:${name}`);
  for (const name of new Set(p.namespace.otherRelations)) if (!declared.has(name)) excess.push(`namespace:extra-relation:${name}`);
  for (const [name, want] of Object.entries(RELATIONS)) {
    const r = declared.get(name);
    if (!r) continue;
    if (r.kind !== 'r') missing.push(`relation:${name}:kind-ordinary-table`);
    if (r.persistence !== 'p') missing.push(`relation:${name}:persistence-permanent`);
    if (r.rowSecurity) excess.push(`relation:${name}:row-security`);
    if (r.forceRowSecurity) excess.push(`relation:${name}:force-row-security`);
    if (r.unsafe) excess.push(`relation:${name}:rules-triggers-or-nonprimary-constraints`);
    // Exact cardinality and uniqueness, as the restore command's dense
    // length + positional check: duplicates are never collapsed or masked.
    const seen = new Set();
    for (const c of r.columns) { if (seen.has(c.name)) excess.push(`relation:${name}:duplicate-column:${c.name}`); seen.add(c.name); }
    want.columns.forEach((col, i) => {
      const at = r.columns.findIndex(c => c.name === col);
      if (at < 0) { missing.push(`relation:${name}:column:${col}`); return; }
      const c = r.columns[at];
      if (at !== i) missing.push(`relation:${name}:column:${col}:position`);
      if (c.type !== (BYTEA.has(col) ? 'bytea' : 'text')) missing.push(`relation:${name}:column:${col}:type-${BYTEA.has(col) ? 'bytea' : 'text'}`);
      if (c.notNull !== !NULLABLE.has(col)) missing.push(`relation:${name}:column:${col}:${NULLABLE.has(col) ? 'nullable' : 'not-null'}`);
      if (c.generated !== '') excess.push(`relation:${name}:column:${col}:generated`);
    });
    for (const c of r.columns) if (!want.columns.includes(c.name)) excess.push(`relation:${name}:extra-column:${c.name}`);
    // Final guard: compatible only if columns match the contract exactly.
    if (r.columns.length !== want.columns.length || r.columns.some((c, i) => c.name !== want.columns[i])) {
      const before = missing.length + excess.length;
      check(before > 0);
    }
    if (r.primaryKey.length !== want.primaryKey.length || r.primaryKey.some((k, i) => k !== want.primaryKey[i])) missing.push(`relation:${name}:primary-key:${want.primaryKey.join('+')}`);
  }
  // Ownership: exactly one owner for the schema and every native relation,
  // one owner throughout, never the maintenance identity, never PUBLIC.
  const owners = new Set();
  const ownerOf = (label, arr) => {
    if (arr === undefined || arr.length === 0) { refused.push(`ownership:${label}:missing`); return; }
    if (new Set(arr).size !== 1) { refused.push(`ownership:${label}:ambiguous`); return; }
    owners.add(arr[0]);
    if (arr[0] === p.identity.user) refused.push(`ownership:${label}:maintenance-identity-owns`);
    if (arr[0] === 'public') refused.push(`ownership:${label}:public`);
  };
  ownerOf('schema', p.ownership.schemaOwners);
  for (const name of Object.keys(RELATIONS)) if (declared.has(name)) ownerOf(`relation:${name}`, p.ownership.relationOwners[name]);
  for (const name of Object.keys(p.ownership.relationOwners)) if (!Object.hasOwn(RELATIONS, name)) refused.push(`ownership:relation:${name}:undeclared`);
  if (owners.size > 1) refused.push('ownership:multiple-owners');
  // Maintenance identity (ROLE preflight).
  if (!p.identity.canLogin) missing.push('identity:can-login');
  for (const k of ROLE_FALSE) if (p.identity[k]) excess.push(`identity:${k}`);
  if (p.identity.connectionLimit !== 1) missing.push('identity:connection-limit-1');
  if (p.identity.memberships !== 0) excess.push('identity:memberships');
  if (p.identity.ownedObjects !== 0) excess.push('identity:owned-objects');
  // Privileges (PRIVILEGES preflight): exact, neither more nor less.
  const pv = p.privileges;
  if (!pv.database.connect) missing.push('privilege:database:connect');
  if (pv.database.create) excess.push('privilege:database:create');
  if (!pv.schema.usage) missing.push('privilege:schema:usage');
  if (pv.schema.create) excess.push('privilege:schema:create');
  if (!pv.functions.advisoryLock) missing.push('privilege:function:pg_try_advisory_lock');
  if (!pv.functions.backendPid) missing.push('privilege:function:pg_backend_pid');
  for (const [name, want] of Object.entries(RELATIONS)) {
    const g = pv.relations[name];
    if (!g) { missing.push(`privilege:${name}:declared`); continue; }
    const need = { select: true, insert: want.privileges[0], update: want.privileges[1], delete: want.privileges[2] };
    for (const [k, v] of Object.entries(need)) {
      if (v && !g[k]) missing.push(`privilege:${name}:${k}`);
      if (!v && g[k]) excess.push(`privilege:${name}:${k}`);
    }
    for (const k of TABLE_FALSE) if (g[k]) excess.push(`privilege:${name}:${k}`);
    const col = { anyInsert: [want.privileges[0], 'column-insert'], anyUpdate: [want.privileges[1], 'column-update'], anyReferences: [false, 'column-references'] };
    for (const [k, [v, label]] of Object.entries(col)) {
      if (v && !g[k]) missing.push(`privilege:${name}:${label}`);
      if (!v && g[k]) excess.push(`privilege:${name}:${label}`);
    }
  }
  for (const name of Object.keys(pv.relations)) if (!Object.hasOwn(RELATIONS, name)) excess.push(`privilege:${name}:undeclared-relation`);
  // Runtime compatibility and version.
  if (p.runtime.node !== RUNTIME.node) missing.push(`runtime:node-${RUNTIME.node}`);
  if (p.runtime.pg !== RUNTIME.pg) missing.push(`runtime:pg-${RUNTIME.pg}`);
  if (!(p.runtime.serverVersionNum >= RUNTIME.serverMin && p.runtime.serverVersionNum < RUNTIME.serverMaxExclusive)) missing.push('version:postgresql-18');
  // Limits: only known keys, positive, never above the command's caps.
  for (const [k, v] of Object.entries(p.limits)) {
    if (!Object.hasOwn(LIMITS, k)) excess.push(`limits:${k}:unknown`);
    else if (v <= 0 || v > LIMITS[k]) excess.push(`limits:${k}:exceeds-command-cap`);
  }
  // Qualification is never inherited or asserted through a profile manifest.
  if (p.qualification.inheritsFrom !== null) refused.push(/006/.test(p.qualification.inheritsFrom) ? 'qualification:false-inheritance-006' : 'qualification:inheritance');
  if (p.qualification.claims.length) refused.push(p.qualification.claims.some(c => /006/.test(c)) ? 'qualification:false-inheritance-006' : 'qualification:asserted-claim');
  return { missing: [...new Set(missing)].sort(), excess: [...new Set(excess)].sort(), refused: [...new Set(refused)].sort() };
}

// Never throws on manifest content; never echoes manifest values beyond the
// requirement identifiers it names.
function validateMaintenanceProfile(manifest) {
  let p;
  try { p = capture(manifest); } catch { return Object.freeze({ schema: VERDICT_ID, status: 'invalid', qualified: false, missing: [], excess: [], refused: ['manifest:shape'] }); }
  let r;
  try { r = evaluate(p); } catch { return Object.freeze({ schema: VERDICT_ID, status: 'invalid', qualified: false, missing: [], excess: [], refused: ['manifest:shape'] }); }
  const ok = !r.missing.length && !r.excess.length && !r.refused.length;
  return Object.freeze({ schema: VERDICT_ID, status: ok ? 'compatible' : 'incompatible', qualified: false, missing: Object.freeze(r.missing), excess: Object.freeze(r.excess), refused: Object.freeze(r.refused) });
}

module.exports = Object.freeze({
  validateMaintenanceProfile,
  MANIFEST_SCHEMA: SCHEMA_ID,
  VERDICT_SCHEMA: VERDICT_ID,
  REQUIRED_RELATIONS: RELATIONS,
  REQUIRED_RUNTIME: RUNTIME,
  COMMAND_LIMITS: LIMITS,
});
