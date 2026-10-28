'use strict';
// INT-3 C1 maintenance-profile requirements validator (ATLAS-080, #751 C1).
// SYNTHETIC fixtures only: every manifest below is invented test data. No
// target, credential, DDL, grant, setup execution or provider is touched.
// INDEPENDENT ORACLE: the drift guard re-derives the required profile from the
// SOURCE TEXT of scripts/restore-settlement-evidence.js (the restore command
// contract) rather than from the validator's own tables.
// NON-CLAIM: 'compatible' is never qualification; qualified is always false.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const MODULE = path.join(__dirname, '..', 'scripts', 'settlement-evidence-int3-maintenance-profile.js');
const COMMAND = path.join(__dirname, '..', 'scripts', 'restore-settlement-evidence.js');
const P = require(MODULE);
const NATIVE = ['doc_head', 'doc_staged', 'journal', 'quarantine', 'terminal_history'];
const COLS = { doc_head: ['scope', 'bytes'], doc_staged: ['scope', 'bytes'], journal: ['scope', 'bytes'], quarantine: ['scope', 'name', 'label', 'bytes'], terminal_history: ['scope', 'history_bytes', 'checkpoint_bytes'] };
const GRANTS = { doc_head: [1, 1, 0], doc_staged: [0, 0, 1], journal: [0, 0, 1], quarantine: [1, 0, 0], terminal_history: [1, 1, 0] };
const SENTINEL = 'synthetic_secret_sentinel_x9';

function relation(name) {
  return {
    name, kind: 'r', persistence: 'p', rowSecurity: false, forceRowSecurity: false, unsafe: false,
    columns: COLS[name].map(c => ({ name: c, type: /bytes$/.test(c) ? 'bytea' : 'text', notNull: c !== 'label', generated: '' })),
    primaryKey: name === 'quarantine' ? ['scope', 'name'] : ['scope'],
  };
}
function grant([i, u, d]) { return { select: true, insert: !!i, update: !!u, delete: !!d, truncate: false, trigger: false, references: false, anyInsert: !!i, anyUpdate: !!u, anyReferences: false }; }
function good() {
  return {
    schema: 'settlement-int3-maintenance-profile-manifest-1',
    namespace: { schema: 'synthetic_settle', scope: 'synthetic-household', otherRelations: [] },
    relations: NATIVE.map(relation),
    ownership: { schemaOwners: ['synthetic_owner'], relationOwners: Object.fromEntries(NATIVE.map(n => [n, ['synthetic_owner']])) },
    maintenanceIdentity: { user: 'synthetic_maint', database: 'synthetic_db', canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false, replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0 },
    privileges: {
      database: { connect: true, create: false }, schema: { usage: true, create: false }, functions: { advisoryLock: true, backendPid: true },
      relations: Object.fromEntries(NATIVE.map(n => [n, grant(GRANTS[n])])),
    },
    runtime: { node: 'v24.22.1', pg: '8.16.3', serverVersionNum: 180004 },
    limits: { dispatch: 120000, queries: 128 },
    qualification: { inheritsFrom: null, claims: [] },
  };
}
// Synthetic stand-in for the attempt-006 SHAPE (four financial + three
// authorization relations, no native-history relations). Names are invented.
function shape006() {
  const m = good();
  const names = ['fin_a', 'fin_b', 'fin_c', 'fin_d', 'auth_a', 'auth_b', 'auth_c'];
  m.relations = names.map(n => ({ ...relation('doc_head'), name: n }));
  m.ownership.relationOwners = Object.fromEntries(names.map(n => [n, ['synthetic_owner']]));
  m.privileges.relations = Object.fromEntries(names.map(n => [n, grant([1, 1, 1])]));
  return m;
}
const v = m => P.validateMaintenanceProfile(m);

test('C1: synthetic native-history manifest is compatible but never qualified', () => {
  const r = v(good());
  assert.deepEqual({ ...r, missing: [...r.missing], excess: [...r.excess], refused: [...r.refused] },
    { schema: 'settlement-int3-maintenance-profile-verdict-1', status: 'compatible', qualified: false, missing: [], excess: [], refused: [] });
  assert.ok(Object.isFrozen(r));
});

test('C1: 006-shaped profile is rejected with every missing native-history requirement named exactly', () => {
  const r = v(shape006());
  assert.equal(r.status, 'incompatible');
  assert.equal(r.qualified, false);
  assert.deepEqual([...r.missing], ['privilege:doc_head:declared', 'privilege:doc_staged:declared', 'privilege:journal:declared', 'privilege:quarantine:declared', 'privilege:terminal_history:declared',
    'relation:doc_head', 'relation:doc_staged', 'relation:journal', 'relation:quarantine', 'relation:terminal_history']);
  for (const n of ['fin_a', 'auth_c']) { assert.ok(r.excess.includes(`namespace:extra-relation:${n}`)); assert.ok(r.excess.includes(`privilege:${n}:undeclared-relation`)); assert.ok(r.refused.includes(`ownership:relation:${n}:undeclared`)); }
});

test('C1: each missing native-history requirement is named exactly', () => {
  const cases = [
    [m => { m.relations = m.relations.filter(r => r.name !== 'terminal_history'); delete m.ownership.relationOwners.terminal_history; delete m.privileges.relations.terminal_history; }, ['privilege:terminal_history:declared', 'relation:terminal_history']],
    [m => { m.relations[4].columns.pop(); }, ['relation:terminal_history:column:checkpoint_bytes']],
    [m => { m.relations[3].primaryKey = ['scope']; }, ['relation:quarantine:primary-key:scope+name']],
    [m => { m.relations[0].columns[1].type = 'text'; }, ['relation:doc_head:column:bytes:type-bytea']],
    [m => { m.relations[3].columns[2].notNull = true; }, ['relation:quarantine:column:label:nullable']],
    [m => { m.relations[1].kind = 'v'; m.relations[2].persistence = 'u'; }, ['relation:doc_staged:kind-ordinary-table', 'relation:journal:persistence-permanent']],
    [m => { m.relations[0].columns.reverse(); }, ['relation:doc_head:column:bytes:position', 'relation:doc_head:column:scope:position']],
    [m => { m.privileges.relations.journal.delete = false; m.privileges.relations.doc_head.insert = false; }, ['privilege:doc_head:insert', 'privilege:journal:delete']],
    [m => { m.privileges.schema.usage = false; m.privileges.functions.advisoryLock = false; }, ['privilege:function:pg_try_advisory_lock', 'privilege:schema:usage']],
    [m => { m.maintenanceIdentity.canLogin = false; m.maintenanceIdentity.connectionLimit = -1; }, ['identity:can-login', 'identity:connection-limit-1']],
    [m => { m.runtime = { node: 'v20.19.2', pg: '8.11.0', serverVersionNum: 170005 }; }, ['runtime:node-v24.22.1', 'runtime:pg-8.16.3', 'version:postgresql-18']],
  ];
  for (const [mutate, missing] of cases) {
    const m = good(); mutate(m); const r = v(m);
    assert.equal(r.status, 'incompatible');
    assert.deepEqual([...r.missing], missing);
    assert.deepEqual([...r.excess], []);
  }
});

test('C1: excess privilege and excess authority are rejected, each named', () => {
  const cases = [
    [m => { m.privileges.relations.doc_head.delete = true; }, ['privilege:doc_head:delete']],
    [m => { m.privileges.relations.quarantine.update = true; m.privileges.relations.journal.truncate = true; }, ['privilege:journal:truncate', 'privilege:quarantine:update']],
    [m => { m.privileges.relations.doc_staged.trigger = true; m.privileges.relations.doc_staged.references = true; }, ['privilege:doc_staged:references', 'privilege:doc_staged:trigger']],
    [m => { m.privileges.database.create = true; m.privileges.schema.create = true; }, ['privilege:database:create', 'privilege:schema:create']],
    [m => { m.maintenanceIdentity.superuser = true; m.maintenanceIdentity.bypassRls = true; }, ['identity:bypassRls', 'identity:superuser']],
    [m => { m.maintenanceIdentity.inherit = true; m.maintenanceIdentity.memberships = 1; }, ['identity:inherit', 'identity:memberships']],
    [m => { m.maintenanceIdentity.ownedObjects = 2; }, ['identity:owned-objects']],
    [m => { m.relations[0].rowSecurity = true; m.relations[1].unsafe = true; }, ['relation:doc_head:row-security', 'relation:doc_staged:rules-triggers-or-nonprimary-constraints']],
    [m => { m.namespace.otherRelations = ['stray_table']; }, ['namespace:extra-relation:stray_table']],
    [m => { m.relations[0].columns.push({ name: 'extra', type: 'text', notNull: false, generated: '' }); }, ['relation:doc_head:extra-column:extra']],
    [m => { m.limits = { dispatch: 120001, retries: 1 }; }, ['limits:dispatch:exceeds-command-cap', 'limits:retries:unknown']],
  ];
  for (const [mutate, excess] of cases) {
    const m = good(); mutate(m); const r = v(m);
    assert.equal(r.status, 'incompatible');
    assert.deepEqual([...r.excess], excess);
    assert.deepEqual([...r.missing], []);
  }
});

test('C1: ambiguous, missing, maintenance-held or PUBLIC ownership is rejected', () => {
  const cases = [
    [m => { m.ownership.schemaOwners = []; }, ['ownership:schema:missing']],
    [m => { m.ownership.relationOwners.journal = ['synthetic_owner', 'other_owner']; }, ['ownership:relation:journal:ambiguous']],
    [m => { m.ownership.relationOwners.quarantine = ['other_owner']; }, ['ownership:multiple-owners']],
    [m => { delete m.ownership.relationOwners.doc_head; }, ['ownership:relation:doc_head:missing']],
    [m => { m.ownership.schemaOwners = ['synthetic_maint']; m.ownership.relationOwners = Object.fromEntries(NATIVE.map(n => [n, ['synthetic_maint']])); }, ['ownership:relation:doc_head:maintenance-identity-owns', 'ownership:relation:doc_staged:maintenance-identity-owns', 'ownership:relation:journal:maintenance-identity-owns', 'ownership:relation:quarantine:maintenance-identity-owns', 'ownership:relation:terminal_history:maintenance-identity-owns', 'ownership:schema:maintenance-identity-owns']],
    [m => { m.ownership.schemaOwners = ['public']; m.ownership.relationOwners = Object.fromEntries(NATIVE.map(n => [n, ['public']])); }, ['ownership:relation:doc_head:public', 'ownership:relation:doc_staged:public', 'ownership:relation:journal:public', 'ownership:relation:quarantine:public', 'ownership:relation:terminal_history:public', 'ownership:schema:public']],
  ];
  for (const [mutate, refused] of cases) {
    const m = good(); mutate(m); const r = v(m);
    assert.equal(r.status, 'incompatible');
    assert.deepEqual([...r.refused], refused);
  }
});

test('C1: false inheritance of 006 qualification is rejected even on an otherwise compatible profile', () => {
  const cases = [
    [{ inheritsFrom: 'attempt006', claims: [] }, ['qualification:false-inheritance-006']],
    [{ inheritsFrom: null, claims: ['RQ-1 passed on 006'] }, ['qualification:false-inheritance-006']],
    [{ inheritsFrom: 'prior-run', claims: [] }, ['qualification:inheritance']],
    [{ inheritsFrom: null, claims: ['native-history supported'] }, ['qualification:asserted-claim']],
  ];
  for (const [q, refused] of cases) {
    const m = good(); m.qualification = q; const r = v(m);
    assert.equal(r.status, 'incompatible'); assert.equal(r.qualified, false);
    assert.deepEqual([...r.refused], refused);
    assert.deepEqual([...r.missing], []);
  }
  // A 006-shaped profile asserting native-history support by inheritance is
  // refused on both grounds: the claim, and the missing relations.
  const m = shape006(); m.qualification = { inheritsFrom: 'attempt006', claims: ['native-history supported'] };
  const r = v(m);
  assert.ok(r.refused.includes('qualification:false-inheritance-006'));
  for (const n of NATIVE) assert.ok(r.missing.includes(`relation:${n}`));
});

test('C1: malformed manifests are invalid, never throw, and never echo input', () => {
  const accessor = good(); Object.defineProperty(accessor, 'limits', { get() { throw new Error(SENTINEL); }, enumerable: true });
  const proto = good(); Object.setPrototypeOf(proto.namespace, { polluted: true });
  const sparse = good(); sparse.relations = new Array(5); sparse.relations[0] = relation('doc_head');
  const dup = good(); dup.relations.push(relation('journal'));
  const sys = good(); sys.namespace.schema = 'pg_catalog';
  const cases = [null, 42, 'x', [], {}, { ...good(), extra: SENTINEL }, { ...good(), schema: 'other' }, accessor, proto, sparse, dup, sys,
    (() => { const m = good(); m.namespace.scope = SENTINEL.toUpperCase(); return m; })(),
    (() => { const m = good(); m.maintenanceIdentity.user = 'Bad-User'; return m; })(),
    (() => { const m = good(); m.privileges.relations.doc_head.select = 'yes'; return m; })()];
  for (const m of cases) {
    let r; assert.doesNotThrow(() => { r = v(m); });
    assert.equal(r.status, 'invalid'); assert.equal(r.qualified, false);
    assert.deepEqual([...r.refused], ['manifest:shape']);
    assert.ok(!JSON.stringify(r).toLowerCase().includes(SENTINEL));
  }
});

test('C1: drift guard binds the required profile to the restore command source (independent of validator tables)', () => {
  const src = fs.readFileSync(COMMAND, 'utf8');
  const prof = /const PROFILE=Object\.freeze\(\{([^}]*)\}\)/.exec(src);
  assert.ok(prof, 'PROFILE literal present in restore command');
  const parsed = {};
  for (const m of prof[1].matchAll(/(\w+):\[(true|false),(true|false),(true|false)\]/g)) parsed[m[1]] = [m[2], m[3], m[4]].map(x => x === 'true');
  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(P.REQUIRED_RELATIONS).sort());
  for (const [n, t] of Object.entries(parsed)) assert.deepEqual(P.REQUIRED_RELATIONS[n].privileges, t, n);
  assert.match(src, /t\.name==='quarantine'\?\['scope','name','label','bytes'\]:t\.name==='terminal_history'\?\['scope','history_bytes','checkpoint_bytes'\]:\['scope','bytes'\]/);
  assert.match(src, /const pk=t\.name==='quarantine'\?\['scope','name'\]:\['scope'\]/);
  assert.match(src, /c\.notNull===\(c\.name!=='label'\)/);
  const max = /const MAX=Object\.freeze\(\{([^}]*)\}\)/.exec(src)[1];
  for (const [k, val] of Object.entries(P.COMMAND_LIMITS)) assert.equal(Function(`'use strict';return ({${max}})`)()[k], val, k);
  assert.match(src, /process\.version==='v24\.22\.1'/); assert.equal(P.REQUIRED_RUNTIME.node, 'v24.22.1');
  assert.match(src, /version==='8\.16\.3'/); assert.equal(P.REQUIRED_RUNTIME.pg, '8.16.3');
  assert.match(src, /id\.version>=180000&&id\.version<190000/);
  assert.match(src, /\['superuser','createDb','createRole','inherit','replication','bypassRls'\]\.every\(k=>role\[k\]===false\)&&role\.connectionLimit===1&&role\.memberships===0&&role\.ownedObjects===0/);
});

test('C1: validator is offline and inert (no I/O, network, driver, process or restore-command import)', () => {
  const src = fs.readFileSync(MODULE, 'utf8');
  const requires = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
  assert.deepEqual(requires, []);
  assert.doesNotMatch(src, /process\.|child_process|globalThis|\bfetch\(|eval\(|Function\(/);
});

// Repair round 1 (Atlas review 5677824520 on f2bf46dd): P1 column-level
// privileges, P2 mutable exported contract, P2 duplicate columns.
test('C1 repair P1: effective column-level privileges are validated exactly (restore anyInsert/anyUpdate/anyReferences)', () => {
  const cases = [
    [m => { m.privileges.relations.journal.anyUpdate = true; }, [], ['privilege:journal:column-update']],
    [m => { m.privileges.relations.doc_staged.anyReferences = true; }, [], ['privilege:doc_staged:column-references']],
    [m => { m.privileges.relations.quarantine.anyUpdate = true; m.privileges.relations.journal.anyInsert = true; }, [], ['privilege:journal:column-insert', 'privilege:quarantine:column-update']],
    [m => { m.privileges.relations.doc_head.anyInsert = false; m.privileges.relations.terminal_history.anyUpdate = false; }, ['privilege:doc_head:column-insert', 'privilege:terminal_history:column-update'], []],
  ];
  for (const [mutate, missing, excess] of cases) {
    const m = good(); mutate(m); const r = v(m);
    assert.equal(r.status, 'incompatible'); assert.equal(r.qualified, false);
    assert.deepEqual([...r.missing], missing);
    assert.deepEqual([...r.excess], excess);
  }
  // Missing column-privilege evidence is malformed, never compatible.
  for (const k of ['anyInsert', 'anyUpdate', 'anyReferences']) {
    const m = good(); delete m.privileges.relations.journal[k]; const r = v(m);
    assert.equal(r.status, 'invalid'); assert.deepEqual([...r.refused], ['manifest:shape']);
  }
  // Contract guard: the restore command still demands exactly these predicates.
  const src = fs.readFileSync(COMMAND, 'utf8');
  for (const k of ['INSERT', 'UPDATE', 'REFERENCES']) assert.match(src, new RegExp(`has_any_column_privilege\\(format\\('%I\\.%I',\\$1,t\\.name\\),'${k}'\\) AS "any${k[0] + k.slice(1).toLowerCase()}"`));
  assert.match(src, /r\.anyReferences===false&&r\.anyInsert===p\[0\]&&r\.anyUpdate===p\[1\]/);
});

test('C1 repair P2: exported requirements are deeply immutable and consumer mutation cannot change a verdict', () => {
  const R = P.REQUIRED_RELATIONS;
  const frozen = o => Object.isFrozen(o) && Object.values(o).every(x => x === null || typeof x !== 'object' || frozen(x));
  assert.ok(frozen(R)); assert.ok(frozen(P.REQUIRED_RUNTIME)); assert.ok(frozen(P.COMMAND_LIMITS));
  const excessUpdate = good(); excessUpdate.privileges.relations.journal.update = true; excessUpdate.privileges.relations.journal.anyUpdate = true;
  const before = [...v(excessUpdate).excess];
  assert.deepEqual(before, ['privilege:journal:column-update', 'privilege:journal:update']);
  assert.throws(() => { R.journal.privileges[1] = true; }, TypeError);
  assert.throws(() => { R.doc_head.columns.push('extra'); }, TypeError);
  assert.throws(() => { R.quarantine.primaryKey[1] = 'label'; }, TypeError);
  assert.equal(R.journal.privileges[1], false);
  assert.deepEqual([...v(excessUpdate).excess], before);
  assert.equal(v(good()).status, 'compatible');
});

test('C1 repair P2: duplicate column names are rejected, identical or conflicting (exact cardinality)', () => {
  const identical = good(); identical.relations[0].columns.push({ name: 'bytes', type: 'bytea', notNull: true, generated: '' });
  let r = v(identical);
  assert.equal(r.status, 'incompatible');
  assert.deepEqual([...r.excess], ['relation:doc_head:duplicate-column:bytes']);
  // A conflicting duplicate must not mask the malformed first descriptor.
  const conflicting = good(); conflicting.relations[0].columns[0].type = 'bytea'; conflicting.relations[0].columns.push({ name: 'scope', type: 'text', notNull: true, generated: '' });
  r = v(conflicting);
  assert.equal(r.status, 'incompatible');
  assert.ok(r.excess.includes('relation:doc_head:duplicate-column:scope'));
  assert.ok(r.missing.includes('relation:doc_head:column:scope:type-text'));
  const dupFirst = good(); dupFirst.relations[3].columns.unshift({ name: 'scope', type: 'text', notNull: true, generated: '' });
  r = v(dupFirst);
  assert.equal(r.status, 'incompatible');
  assert.ok(r.excess.includes('relation:quarantine:duplicate-column:scope'));
});
