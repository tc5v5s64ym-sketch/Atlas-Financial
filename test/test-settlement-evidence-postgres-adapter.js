'use strict';
// Settlement evidence PostgreSQL local-state adapter (ATLAS-080) —
// INJECTED-CLIENT tests only.
//
// The adapter runs real parameterized SQL through an injected dedicated
// session client. Here that client is an in-process, SQL-interpreting
// FAKE over in-memory tables with scripted faults (rejection, session
// end, lost COMMIT acknowledgement landed/absent, backend pid swap,
// scripted result envelopes; results carry node-postgres-style command
// tags). It
// is NOT PostgreSQL: nothing here qualifies real SQL semantics, real
// durability, TLS, real advisory locking, pooling, or any provider.
// Pin and backup stay separately injected: the UNCHANGED object adapter
// over a separate in-memory transport. The UNCHANGED store composes all
// of it. Acceptance: the existing store contract plus the corrected
// A1–A15 list, plus focused SQL/transaction/session-ownership checks.
//
// Tests first: against unmodified main this suite fails to load (the
// adapter module does not exist).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const S = require(path.join(ROOT, 'scripts/settlement-evidence-store'));
const O = require(path.join(ROOT, 'scripts/settlement-evidence-object-adapter'));
const P = require(path.join(ROOT, 'scripts/settlement-evidence-postgres-adapter'));

const householdId = 'household-' + 'a'.repeat(32);
const otherHousehold = 'household-' + 'b'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const SCHEMA = 'atlas_settle_synthetic';
const SCOPE = 'synthetic-qual';
const NS = 'synthetic-qual';
const KEY = crypto.randomBytes(32); // synthetic only
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
let T = Date.parse('2026-10-04T12:00:00Z');
const now = () => (T += 1);
const thrown = [];
const outputs = [];
const eq = (a, b) => assert.deepStrictEqual(a, b);

// --- Fake PostgreSQL (SQL-interpreting, in-process; NOT PostgreSQL) ------
function createFakePg() {
  const schemas = new Map();
  const tables = s => {
    if (!schemas.has(s)) schemas.set(s, { doc_head: new Map(), doc_staged: new Map(), journal: new Map(), quarantine: [] });
    return schemas.get(s);
  };
  const advisory = new Map(); // "k1,k2" -> pid
  const clients = [];
  const faults = [];
  const hooks = [];
  const log = [];
  let pidSeq = 1000;

  function connect() {
    const listeners = { error: [], end: [] };
    const c = {
      pid: ++pidSeq, alive: true, inTxn: false, pending: [], txnOp: null, pidOverride: null, queries: 0,
      retired: 0,
      on(ev, fn) { (listeners[ev] ||= []).push(fn); },
      retire() { c.retired++; kill(c); },
      emit(ev) { for (const fn of listeners[ev] || []) fn(new Error('fake session ' + ev)); },
      async query(text, values) {
        assert.equal(typeof text, 'string');
        assert.ok(Array.isArray(values), 'values must always be an array (parameterized)');
        c.queries++;
        log.push({ pid: c.pid, text, values });
        if (!c.alive) throw new Error('fake: connection terminated');
        const hi = hooks.findIndex(h => h.match(text, c));
        if (hi >= 0) { const h = hooks.splice(hi, 1)[0]; await h.fn(c); }
        await Promise.resolve();
        if (!c.alive) throw new Error('fake: connection terminated');
        const fi = faults.findIndex(f => f.match(text, c));
        const mode = fi < 0 ? null : faults.splice(fi, 1)[0].mode;
        if (mode === 'reject') throw new Error('fake: statement failed');
        if (mode === 'drop') { kill(c); throw new Error('fake: connection terminated'); }
        if (mode === 'lost-ack-absent') { c.pending = []; kill(c); throw new Error('fake: connection lost before ack'); }
        const res = dispatch(c, text, values);
        if (mode === 'lost-ack-landed') { kill(c); throw new Error('fake: connection lost after COMMIT sent'); }
        return res;
      },
    };
    clients.push(c);
    return c;
  }
  function kill(c) {
    if (!c.alive) return;
    c.alive = false; c.pending = []; c.inTxn = false;
    for (const [k, pid] of advisory) if (pid === c.pid) advisory.delete(k); // backend exit
    c.emit('end');
  }
  function apply(c, fn) { if (c.inTxn) c.pending.push(fn); else fn(); }
  function schemaOf(text) {
    const m = /"([a-z_][a-z0-9_]*)"\.(doc_head|doc_staged|journal|quarantine)/.exec(text);
    assert.ok(m, 'unexpected SQL: ' + text);
    return tables(m[1]);
  }
  const rowsOf = row => (row === undefined ? [] : row.__dupe ? [row, row] : [row]);
  function dispatch(c, text, v) {
    // Command tags model node-postgres result.command (completion tag verb).
    const tag = /^WITH\b/.test(text) ? 'INSERT' : text.split(' ')[0];
    const ok = (rows = [], rowCount = rows.length) => ({ command: tag, rows, rowCount });
    if (text === 'BEGIN') { assert.ok(!c.inTxn); c.inTxn = true; c.pending = []; c.txnOp = null; return ok(); }
    if (text === 'COMMIT') { assert.ok(c.inTxn); for (const fn of c.pending) fn(); c.pending = []; c.inTxn = false; return ok(); }
    if (text === 'ROLLBACK') { c.pending = []; c.inTxn = false; return ok(); }
    if (text === 'SELECT pg_backend_pid() AS pid') return ok([{ pid: c.pidOverride || c.pid }]);
    if (text === 'SELECT pg_try_advisory_lock($1, $2) AS locked') {
      const k = v.join(','); const h = advisory.get(k);
      if (h !== undefined && h !== c.pid) return ok([{ locked: false }]);
      advisory.set(k, c.pid); return ok([{ locked: true }]);
    }
    if (text === 'SELECT pg_advisory_unlock($1, $2) AS unlocked') {
      const k = v.join(',');
      if (advisory.get(k) !== c.pid) return ok([{ unlocked: false }]);
      advisory.delete(k); return ok([{ unlocked: true }]);
    }
    const t = schemaOf(text);
    const scope = v[0];
    if (/UNION ALL/.test(text)) {
      for (const name of ['doc_staged', 'doc_head', 'journal']) if (t[name].has(scope)) return ok(rowsOf(t[name].get(scope)));
      const qrows = t.quarantine.filter(r => r.scope === scope).sort((a, b) => (a.name < b.name ? -1 : 1));
      return ok(qrows.slice(0, 1));
    }
    let m;
    if ((m = /^SELECT bytes FROM "[a-z0-9_]+"\.(doc_head|journal) WHERE scope = \$1$/.exec(text))) {
      return ok(rowsOf(t[m[1]].get(scope)));
    }
    if (/^INSERT INTO "[a-z0-9_]+"\.doc_staged \(scope, bytes\) VALUES \(\$1, \$2\) ON CONFLICT/.test(text)) {
      c.txnOp = 'doc.writeTemp'; const b = Buffer.from(v[1]); apply(c, () => t.doc_staged.set(scope, { bytes: b })); return ok([], 1);
    }
    if (/^WITH s AS \(DELETE FROM "[a-z0-9_]+"\.doc_staged WHERE scope = \$1 RETURNING scope, bytes\) INSERT INTO "[a-z0-9_]+"\.doc_head/.test(text)) {
      c.txnOp = 'doc.commitTemp';
      const st = t.doc_staged.get(scope);
      if (!st) return ok([], 0);
      const b = Buffer.from(st.bytes);
      apply(c, () => { t.doc_head.set(scope, { bytes: b }); t.doc_staged.delete(scope); });
      return ok([{ scope }], 1);
    }
    if (/^DELETE FROM "[a-z0-9_]+"\.doc_staged WHERE scope = \$1$/.test(text)) {
      c.txnOp = 'doc.discardTemp'; const n = t.doc_staged.has(scope) ? 1 : 0; apply(c, () => t.doc_staged.delete(scope)); return ok([], n);
    }
    if (/^INSERT INTO "[a-z0-9_]+"\.journal \(scope, bytes\) VALUES \(\$1, \$2\) ON CONFLICT/.test(text)) {
      c.txnOp = 'journal.write'; const b = Buffer.from(v[1]); apply(c, () => t.journal.set(scope, { bytes: b })); return ok([], 1);
    }
    if (/^DELETE FROM "[a-z0-9_]+"\.journal WHERE scope = \$1$/.test(text)) {
      c.txnOp = 'journal.clear'; const n = t.journal.has(scope) ? 1 : 0; apply(c, () => t.journal.delete(scope)); return ok([], n);
    }
    if (/^INSERT INTO "[a-z0-9_]+"\.quarantine \(scope, name, label, bytes\) VALUES \(\$1, \$2, \$3, \$4\)$/.test(text)) {
      c.txnOp = 'quarantine.put'; const row = { scope, name: v[1], label: v[2], bytes: Buffer.from(v[3]) };
      apply(c, () => t.quarantine.push(row)); return ok([], 1);
    }
    throw new Error('fake: unsupported SQL ' + text);
  }
  const commitOf = opName => (text, c) => text === 'COMMIT' && c.txnOp === opName;
  return { schemas, tables, t: () => tables(SCHEMA), advisory, clients, faults, hooks, log, connect, kill, commitOf };
}

// --- Separate in-memory object transport for the UNCHANGED object adapter
function createObjectTransport() {
  const objects = new Map(); const faults = []; const listMutators = [];
  const take = (opName, key) => { const i = faults.findIndex(f => f.op === opName && (!f.when || f.when(key))); return i < 0 ? null : faults.splice(i, 1)[0].mode; };
  const run = async (opName, key, fn) => {
    await Promise.resolve();
    const mode = take(opName, key);
    if (mode === 'refuse' || mode === 'lost-ack-absent') throw new Error('transport: ' + opName + ' failed');
    const r = fn();
    if (mode === 'lost-ack-landed') throw new Error('transport: ' + opName + ' lost ack');
    return r;
  };
  const transport = {
    read: key => run('read', key, () => {
      const row = objects.get(key); if (!row) return null;
      if (!Buffer.isBuffer(row.bytes)) throw new Error('transport: row bytes wrong type');
      return { bytes: Buffer.from(row.bytes), version: row.version, metadata: structuredClone(row.metadata) };
    }),
    create: (key, bytes, metadata) => run('create', key, () => {
      if (objects.has(key)) { const e = new Error('transport: exists'); e.code = 'conflict'; throw e; }
      const version = crypto.randomUUID(); objects.set(key, { bytes: Buffer.from(bytes), version, metadata: structuredClone(metadata) });
      return { version, integrity: sha256(bytes) };
    }),
    replace: (key, bytes, version, metadata) => run('replace', key, () => {
      const row = objects.get(key);
      if (!row || row.version !== version) { const e = new Error('transport: version'); e.code = 'conflict'; throw e; }
      const next = crypto.randomUUID(); objects.set(key, { bytes: Buffer.from(bytes), version: next, metadata: structuredClone(metadata) });
      return { version: next, integrity: sha256(bytes) };
    }),
    list: (prefix, cursor) => run('list', prefix, () => {
      const after = cursor === null ? null : Buffer.from(cursor, 'base64url').toString('utf8');
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort().filter(k => after === null || k > after);
      const pageKeys = keys.slice(0, 1);
      let page = { entries: pageKeys.map(k => ({ key: k, metadata: structuredClone(objects.get(k).metadata) })),
        nextCursor: keys.length > 1 ? Buffer.from(pageKeys[0]).toString('base64url') : null };
      const m = listMutators.shift(); if (m) page = m(page, cursor);
      return page;
    }),
  };
  return { objects, faults, listMutators, transport };
}

async function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  return Buffer.concat([iv, c.update(plain), c.final(), c.getAuthTag()]);
}
function wrap(obj, label) {
  const out = {};
  for (const [k, fn] of Object.entries(obj)) {
    if (typeof fn !== 'function') continue;
    out[k] = async (...a) => { try { return await fn(...a); } catch (e) { thrown.push(label + ':' + e.message); throw e; } };
  }
  return out;
}
// One "process": a new client (new session) over the shared fake + objects.
function build(world = {}, opts = {}) {
  const pg = world.pg || createFakePg();
  const ot = world.ot || createObjectTransport();
  const client = pg.connect();
  const adapter = P.createSettlementEvidencePostgresAdapter({ client, schema: SCHEMA, scope: SCOPE });
  const hh = opts.householdId || householdId;
  const obj = O.createSettlementEvidenceObjectAdapter({ householdId: hh, namespace: NS, transport: ot.transport, encrypt });
  const store = S.createSettlementEvidenceStore({
    householdId: hh,
    documentStore: wrap(adapter.documentStore, 'doc'), journalStore: wrap(adapter.journalStore, 'journal'),
    pinStore: wrap(obj.pinStore, 'pin'), backupStore: wrap(obj.backupStore, 'backup'),
    quarantine: wrap(adapter.quarantine, 'quarantine'), lock: adapter.lock, now,
  });
  return { pg, ot, client, adapter, obj, store };
}
const fresh = b => build({ pg: b.pg, ot: b.ot });
const linkCmd = n => {
  const e = { accountId: 'acct-main', currency: 'cad', direction: 'debit', date: '2026-10-03', cents: 6000, posted: true };
  return { version: 1, kind: 'link', goalId: 'commitment:near', txRef: tx(n), evidence: e,
    evidenceDigest: C.digest(e), assignedCents: 2500, asOf: '2026-10-04' };
};
async function prep(store, n) {
  const p = await store.prepare({ actorId, operationId: op(n), command: linkCmd(n) });
  outputs.push(p);
  return { actorId, preview: p.preview, confirmationDigest: p.confirmationDigest };
}
async function commitN(store, n) { const r = await store.commit(await prep(store, n)); outputs.push(r); return r; }
async function rec(store) { const r = await store.reconcile(); outputs.push(r); return r; }
async function booted(world) { const b = build(world); const r = await b.store.bootstrap(); outputs.push(r); eq(r.status, 'bootstrapped'); return b; }
async function throws(fn) { try { await fn(); return false; } catch (e) { thrown.push('direct:' + e.message); return true; } }
const pinRow = b => { const r = b.ot.objects.get(NS + '/pin.json'); return r ? JSON.parse(r.bytes.toString()) : null; };
const MUT = /^(INSERT|DELETE|WITH|UPDATE)/;
const mutSql = pg => pg.log.filter(l => MUT.test(l.text)).length;
const snap = b => { const t = b.pg.t(); return JSON.stringify({
  o: [...b.ot.objects].map(([k, v]) => [k, v.version, sha256(v.bytes)]),
  h: t.doc_head.get(SCOPE) && sha256(t.doc_head.get(SCOPE).bytes), s: t.doc_staged.get(SCOPE) && sha256(t.doc_staged.get(SCOPE).bytes),
  j: t.journal.get(SCOPE) && sha256(t.journal.get(SCOPE).bytes), q: t.quarantine.length }); };

// ------------------------------------------------------------------------
test('module: no driver, env, network or DDL; construction validates identifiers', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/settlement-evidence-postgres-adapter.js'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  for (const bad of [/require\(['"](pg|postgres|net|tls|dns|http|https|node:net|node:tls|node:http|node:https|child_process|node:child_process|fs|node:fs)['"]\)/, /process\.env/, /\b(CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE)\s/]) {
    assert.ok(!bad.test(code), 'forbidden construct ' + bad);
  }
  const pg = createFakePg(); const client = pg.connect();
  const mk = o => () => P.createSettlementEvidencePostgresAdapter(o);
  for (const schema of ['', 'Public', 'x"; select 1; --', 'pg_catalog', 'information_schema', '1abc', 'a'.repeat(64)]) {
    assert.throws(mk({ client, schema, scope: SCOPE }), /schema identifier is invalid/);
  }
  for (const scope of ['', 'Synthetic', "x'--", 'a/b', 'a'.repeat(129)]) assert.throws(mk({ client, schema: SCHEMA, scope }), /scope is invalid/);
  assert.throws(mk({ client: { query() {} }, schema: SCHEMA, scope: SCOPE }), /dedicated session client/);
  assert.throws(mk({ client: { query() {}, on() {} }, schema: SCHEMA, scope: SCOPE }), /retire/);
  assert.throws(mk(null), /options are required/);
  P.createSettlementEvidencePostgresAdapter({ client, schema: SCHEMA, scope: SCOPE });
  assert.throws(mk({ client, schema: SCHEMA, scope: SCOPE }), /already owned/); // exclusive lifetime ownership
  eq(pg.log.length, 0); // construction issues no SQL
  assert.ok(Object.isFrozen(P.RELATION_CONTRACT) && P.RELATION_CONTRACT.relations.quarantine.grants === 'SELECT, INSERT');
});

test('A1 store constructs over the PG adapter + separately injected pin/backup', () => {
  const b = build();
  for (const k of ['read', 'readStaged', 'writeTemp', 'commitTemp', 'discardTemp']) assert.equal(typeof b.adapter.documentStore[k], 'function');
  assert.equal(b.adapter.pinStore, undefined); assert.equal(b.adapter.backupStore, undefined);
});

test('A2 bootstrap then already-bootstrapped; SQL is parameterized and scoped', async () => {
  const b = build(); const r1 = await rec2(b.store.bootstrap()); const r2 = await rec2(b.store.bootstrap());
  assert.equal(r1.status, 'bootstrapped'); assert.equal(r1.revision, 0); assert.equal(pinRow(b).revision, 0);
  eq(r2, { status: 'rejected', reason: 'already-bootstrapped' });
  for (const l of b.pg.log) {
    assert.ok(!l.text.includes(SCOPE) && !l.text.includes(householdId), 'no values interpolated into SQL text');
    if (/WHERE scope|VALUES/.test(l.text)) eq(l.values[0], SCOPE);
  }
});
async function rec2(p) { const r = await p; outputs.push(r); return r; }

test('A3 every scoped trace class blocks genesis with zero writes; unrelated rows do not; inspection failure is unavailable', async () => {
  const seeds = {
    staged: b => b.pg.t().doc_staged.set(SCOPE, { bytes: Buffer.from('x') }),
    head: b => b.pg.t().doc_head.set(SCOPE, { bytes: Buffer.from('x') }),
    journal: b => b.pg.t().journal.set(SCOPE, { bytes: Buffer.from('x') }),
    quarantine: b => b.pg.t().quarantine.push({ scope: SCOPE, name: 'q-1', label: 'q', bytes: Buffer.from('x') }),
    pin: b => b.ot.objects.set(NS + '/pin.json', { bytes: Buffer.from('{}'), version: 'v', metadata: {} }),
    backup: b => b.ot.objects.set(NS + '/revisions/rev-0-' + 'e'.repeat(64) + '.enc', { bytes: Buffer.from('c'), version: 'v', metadata: { revision: 0, digest: 'e'.repeat(64), integrity: sha256(Buffer.from('c')) } }),
  };
  for (const [cls, seed] of Object.entries(seeds)) {
    const b = build(); seed(b); const before = snap(b);
    const r = await rec2(b.store.bootstrap());
    assert.ok(r.status === 'rejected' || r.status === 'unavailable', cls + ' ' + JSON.stringify(r));
    eq(mutSql(b.pg), 0); eq(snap(b), before);
  }
  { const b = build(); const t = b.pg.t();
    t.doc_head.set('other-scope', { bytes: Buffer.from('x') }); t.journal.set('other-scope', { bytes: Buffer.from('x') });
    t.quarantine.push({ scope: 'other-scope', name: 'x-1', label: 'x', bytes: Buffer.from('x') });
    b.pg.tables('other_schema').doc_head.set(SCOPE, { bytes: Buffer.from('x') });
    b.ot.objects.set('other-ns/pin.json', { bytes: Buffer.from('{}'), version: 'v', metadata: {} });
    let staged; await b.adapter.lock.withLock(async () => { staged = await b.adapter.documentStore.readStaged(); });
    eq(staged, null);
    assert.equal((await rec2(b.store.bootstrap())).status, 'bootstrapped'); }
  { const b = build(); b.pg.faults.push({ match: t => /UNION ALL/.test(t), mode: 'reject' });
    eq(await rec2(b.store.bootstrap()), { status: 'unavailable', reason: 'document-unavailable' });
    eq(mutSql(b.pg), 0);
    assert.ok(await throws(() => b.adapter.documentStore.readStaged()), 'after failure the adapter never reads absence'); }
  { const b = build(); b.pg.t().doc_staged.set(SCOPE, { bytes: 'not-bytes' });
    eq(await rec2(b.store.bootstrap()), { status: 'unavailable', reason: 'document-unavailable' }); eq(mutSql(b.pg), 0); }
});

test('A4 prepare + commit happy path; staged consumed atomically with head promotion', async () => {
  const b = await booted(); const r = await commitN(b.store, 1);
  assert.equal(r.status, 'committed'); assert.equal(r.revision, 1); assert.equal(pinRow(b).revision, 1);
  const o = await rec2(b.store.outcome({ actorId, operationId: op(1) }));
  assert.equal(o.status, 'committed');
  assert.ok(!b.pg.t().journal.has(SCOPE) && !b.pg.t().doc_staged.has(SCOPE));
  const promote = b.pg.log.filter(l => /^WITH s AS/.test(l.text));
  assert.ok(promote.length >= 2, 'genesis + commit promotions each one statement');
  // Each promotion sits in its own BEGIN .. pid fence .. statement .. COMMIT
  for (const pr of promote) {
    const i = b.pg.log.indexOf(pr);
    eq(b.pg.log.slice(i - 2, i + 2).map(l => l.text.split(' ')[0]), ['BEGIN', 'SELECT', 'WITH', 'COMMIT']);
  }
  // Byte-compatibility with the file adapter journal encoding: bytea of JSON.stringify(record)
  const jw = b.pg.log.find(l => /INTO "[a-z_]+"\.journal/.test(l.text));
  assert.ok(Buffer.isBuffer(jw.values[1]) && JSON.parse(jw.values[1].toString('utf8')).operationId === op(1));
});

test('A5 pin version tokens via the separate transport (unchanged object adapter): stale, ABA and racing', async () => {
  const b = await booted(); const key = NS + '/pin.json'; const tr = b.ot.transport;
  const r0 = await tr.read(key); const a1 = await tr.replace(key, Buffer.from('b1'), r0.version, { revision: 9 });
  const a2 = await tr.replace(key, r0.bytes, a1.version, r0.metadata);
  assert.ok(await throws(() => tr.replace(key, Buffer.from('b3'), r0.version, {})));
  eq(new Set([r0.version, a1.version, a2.version]).size, 3);
  const c = await booted(); const p0 = pinRow(c);
  const [x, y] = await Promise.all([1, 2].map(n => c.obj.pinStore.advance({ revision: 0, digest: p0.digest }, { revision: 1, digest: String(n).repeat(64), timestamp: now() })));
  eq([x, y].sort(), [false, true]);
});

test('A6 pin lost ack on create/replace -> pin-advance-failed; reconcile resolves from observation', async () => {
  for (const mode of ['lost-ack-landed', 'lost-ack-absent']) {
    const b = build(); b.ot.faults.push({ op: 'create', mode, when: k => k.endsWith('/pin.json') });
    eq(await rec2(b.store.bootstrap()), { status: 'unavailable', reason: 'pin-advance-failed' });
    eq(pinRow(b) !== null, mode === 'lost-ack-landed');
  }
  for (const mode of ['lost-ack-landed', 'lost-ack-absent']) {
    const b = await booted(); const p = await prep(b.store, 1); b.ot.faults.push({ op: 'replace', mode });
    eq(await rec2(b.store.commit(p)), { status: 'unknown', reason: 'pin-advance-failed' });
    assert.ok(b.pg.t().journal.has(SCOPE));
    const rr = await rec(b.store);
    if (mode === 'lost-ack-landed') { eq(rr.row, 'R3'); eq(rr.disposition, 'committed-recovered'); } else { eq(rr.row, 'R5'); eq(rr.disposition, 'promoted'); eq(pinRow(b).revision, 1); }
  }
});

test('A7 backup lost ack -> retry returns existing binding; tampered artifact throws', async () => {
  const b = await booted(); const p = await prep(b.store, 1);
  b.ot.faults.push({ op: 'create', mode: 'lost-ack-landed', when: k => k.includes('/revisions/rev-1-') });
  eq(await rec2(b.store.commit(p)), { status: 'unknown', reason: 'backup-ambiguous' });
  const headBytes = b.pg.t().doc_head.get(SCOPE).bytes; const st = JSON.parse(headBytes);
  const key = NS + '/revisions/rev-1-' + st.digest + '.enc'; const before = b.ot.objects.get(key);
  const ack = await b.obj.backupStore.put(1, st.digest, headBytes);
  eq([ack.revision, ack.digest, ack.artifactId], [1, st.digest, key]);
  eq(b.ot.objects.get(key).version, before.version);
  const after = b.ot.objects.get(key); after.bytes = Buffer.from(after.bytes); after.bytes[0] ^= 0xff;
  assert.ok(await throws(() => b.obj.backupStore.put(1, st.digest, headBytes)));
  assert.ok(await throws(() => b.obj.backupStore.list()));
});

test('A8 manifest failures throw and map to unavailable, never absence', async () => {
  const cases = {
    'unknown key': b => b.ot.objects.set(NS + '/stray.bin', { bytes: Buffer.from('z'), version: 'v', metadata: {} }),
    'repeated cursor': b => { let first; b.ot.listMutators.push(p => { first = p.nextCursor; return p; }, p => ({ ...p, nextCursor: first })); },
    'malformed page': b => b.ot.listMutators.push(() => ({ entries: 'nope', nextCursor: null })),
    'partial page': b => b.ot.listMutators.push(p => ({ ...p, nextCursor: '' })),
    'repeated entry': b => b.ot.listMutators.push(p => ({ ...p, entries: [p.entries[0], p.entries[0]] })),
  };
  for (const [, inject] of Object.entries(cases)) {
    const b = await booted(); inject(b); assert.ok(await throws(() => b.obj.backupStore.list()));
    inject(b); eq(await rec2(b.store.bootstrap()), { status: 'unavailable', reason: 'backup-unavailable' });
  }
});

test('A9 journal.write lost COMMIT ack (landed/absent) -> unknown, no compensating cleanup; fresh session reconciles', async () => {
  for (const mode of ['lost-ack-landed', 'lost-ack-absent']) {
    const b = await booted(); const p = await prep(b.store, 1);
    b.pg.faults.push({ match: b.pg.commitOf('journal.write'), mode }); const m0 = mutSql(b.pg);
    eq(await rec2(b.store.commit(p)), { status: 'unknown', reason: 'journal-write-ambiguous' });
    eq(mutSql(b.pg) - m0, 1); // only the journal write itself: no clear/discard/quarantine
    eq(b.pg.t().journal.has(SCOPE), mode === 'lost-ack-landed');
    // The old adapter is permanently invalid: it never reads absence.
    assert.ok(await throws(() => b.adapter.journalStore.read()));
    // The old store over the LOST adapter fails closed (its lock refuses) rather than reconciling to absence.
    assert.ok(await throws(() => b.store.reconcile()));
    const rr = await rec(fresh(b).store);
    if (mode === 'lost-ack-landed') { eq(rr.row, 'R4'); eq(rr.disposition, 'not-committed'); } else eq(rr.row, 'R2');
  }
});

test('A10 commitTemp lost COMMIT: absent -> R4, landed -> R5 (R1 while head unreadable), divergent -> R6', async () => {
  { const b = await booted(); const p = await prep(b.store, 1); b.pg.faults.push({ match: b.pg.commitOf('doc.commitTemp'), mode: 'lost-ack-absent' });
    eq(await rec2(b.store.commit(p)), { status: 'unknown', reason: 'rename-ambiguous' });
    assert.ok(b.pg.t().doc_staged.has(SCOPE), 'not landed: staged still present, head unchanged');
    const rr = await rec(fresh(b).store); eq([rr.row, rr.disposition], ['R4', 'not-committed']); }
  { const b = await booted(); const p = await prep(b.store, 1); b.pg.faults.push({ match: b.pg.commitOf('doc.commitTemp'), mode: 'lost-ack-landed' });
    eq(await rec2(b.store.commit(p)), { status: 'unknown', reason: 'rename-ambiguous' });
    assert.ok(!b.pg.t().doc_staged.has(SCOPE), 'landed: promotion and consumption together');
    const f1 = fresh(b); b.pg.faults.push({ match: t => /^SELECT bytes FROM "[a-z_]+"\.doc_head/.test(t), mode: 'reject' });
    const ru = await rec(f1.store); eq([ru.row, ru.reason], ['R1', 'document-unreadable']);
    // f1 is LOST: it retired its own exact session (server-side release), no substitute.
    eq(f1.client.retired, 1);
    const rr = await rec(fresh(b).store); eq([rr.row, rr.disposition], ['R5', 'promoted']); }
  { const b = await booted(); const p = await prep(b.store, 1); b.pg.faults.push({ match: b.pg.commitOf('doc.commitTemp'), mode: 'lost-ack-landed' });
    await b.store.commit(p);
    const t = b.pg.t(); const j = JSON.parse(t.journal.get(SCOPE).bytes); j.preview.issuedAt += 1; j.preview.expiresAt += 1;
    t.journal.set(SCOPE, { bytes: Buffer.from(JSON.stringify(j)) });
    eq((await rec(fresh(b).store)).row, 'R6'); }
  { const b = await booted(); let r;
    await b.adapter.lock.withLock(async () => { r = await throws(() => b.adapter.documentStore.commitTemp()); });
    assert.ok(r, 'commitTemp with no staged row throws'); assert.ok(b.pg.log.some(l => l.text === 'ROLLBACK')); }
});

test('A11 maximum journal envelope round-trips byte-exact; 2,097,153-byte document refused', async () => {
  const b = await booted(); const base = crypto.randomBytes(2097152); const p = await prep(b.store, 1);
  const record = { version: 1, householdId, operationId: op(1), actorId, baseRevision: 0, baseDigest: 'f'.repeat(64),
    baseBytes: base.toString('base64'), preview: p.preview, requestDigest: p.confirmationDigest,
    resultingRevision: 1, resultingDigest: 'e'.repeat(64), recordedAt: now() };
  let back; await b.adapter.lock.withLock(async () => { await b.adapter.journalStore.write(record); back = await b.adapter.journalStore.read(); });
  const expect = Buffer.from(JSON.stringify(record));
  eq(record.baseBytes.length, 2796204); assert.ok(expect.length > 2 * 1024 * 1024);
  assert.ok(Buffer.isBuffer(back) && back.equals(expect));
  assert.ok(Buffer.from(JSON.parse(back).baseBytes, 'base64').equals(base));
  assert.ok(await throws(async () => C.pin(Buffer.alloc(2097153, 0x20), householdId)));
  let big; await b.adapter.lock.withLock(async () => { big = await throws(() => b.adapter.documentStore.writeTemp(Buffer.alloc(2097153))); });
  assert.ok(big);
});

test('A12 session loss invalidates the holder and every captured capability; no reconnect; refuse not queue', async () => {
  // Store level: session lost mid-commit, a new process acquires, old resumes.
  { const b = await booted(); const p = await prep(b.store, 1); let newHolder; let nb;
    b.pg.hooks.push({ match: (t, c) => /INTO "[a-z_]+"\.journal/.test(t) && c === b.client, fn: async c => {
      b.pg.kill(c); nb = fresh(b); newHolder = await rec(nb.store); } });
    const r = await rec2(b.store.commit(p));
    eq(newHolder.row, 'R2');
    eq(r, { status: 'unknown', reason: 'journal-write-ambiguous' }); assert.ok(!b.pg.t().journal.has(SCOPE));
    const q0 = b.client.queries; const before = snap(b);
    for (const f of [() => b.adapter.documentStore.writeTemp(Buffer.from('x')), () => b.adapter.documentStore.commitTemp(),
      () => b.adapter.documentStore.discardTemp(), () => b.adapter.journalStore.write({ a: 1 }), () => b.adapter.journalStore.clear(),
      () => b.adapter.quarantine.put('x', Buffer.from('x')), () => b.adapter.documentStore.read(), () => b.adapter.lock.withLock(async () => 1)]) {
      assert.ok(await throws(f));
    }
    eq(b.client.queries, q0, 'old adapter issues nothing after loss (no reconnect)'); eq(snap(b), before);
    eq(b.pg.clients.length, 2, 'no client created by the adapter');
    eq((await rec(nb.store)).row, 'R2'); }
  // Captured continuation resumes after a normal release while a LATER holder is live on the same adapter.
  { const b = await booted(); let gate; const g = new Promise(r => { gate = r; }); let detached;
    await b.adapter.lock.withLock(async () => { detached = (async () => { await g; return throws(() => b.adapter.journalStore.clear()); })(); });
    let refusedWhileLive; const m0 = mutSql(b.pg);
    await b.adapter.lock.withLock(async () => { gate(); refusedWhileLive = await detached; });
    assert.ok(refusedWhileLive); eq(mutSql(b.pg), m0, 'stale callback never borrowed the later holder'); }
  // Captured continuation after session loss, while a NEW client's adapter holds the lock.
  { const b = await booted(); let gate; const g = new Promise(r => { gate = r; }); let detached;
    await b.adapter.lock.withLock(async () => {
      detached = (async () => { await g; return throws(() => b.adapter.journalStore.write({ stale: true })); })();
      b.pg.kill(b.client);
    }).catch(() => {});
    const nb = fresh(b); let res;
    await nb.adapter.lock.withLock(async () => { gate(); res = await detached; });
    assert.ok(res); assert.ok(!b.pg.t().journal.has(SCOPE));
    assert.ok(!b.pg.log.some(l => l.pid === nb.client.pid && /stale/.test(String(l.values[1])))); }
  // Backend swap (pid changed under the client) is refused inside the txn and rolled back.
  { const b = await booted(); let r;
    await b.adapter.lock.withLock(async () => { b.client.pidOverride = 999999; r = await throws(() => b.adapter.journalStore.clear()); b.client.pidOverride = null; });
    assert.ok(r); eq(b.client.retired, 1, 'swapped backend: session retired, never reused'); }
  // Refuse, not queue: same adapter and a second session.
  { const b = await booted(); const other = fresh(b); let release; const gate = new Promise(r => { release = r; });
    const held = b.adapter.lock.withLock(() => gate);
    assert.ok(await throws(() => b.adapter.lock.withLock(async () => 1)));
    await Promise.resolve(); await new Promise(r => setImmediate(r));
    assert.ok(await throws(() => other.adapter.lock.withLock(async () => 1)));
    release(); await held;
    eq(await other.adapter.lock.withLock(async () => 7), 7); }
  // Mutation outside any lock is refused with no SQL.
  { const b = build(); const n = b.pg.log.length; assert.ok(await throws(() => b.adapter.journalStore.clear())); eq(b.pg.log.length, n); }
  // 'error' event alone (no rejected query) also invalidates permanently.
  { const b = await booted(); b.client.emit('error'); assert.ok(await throws(() => b.adapter.documentStore.read())); }
});

test('ack only after COMMIT; unlocked reads never interleave an open transaction', async () => {
  const b = await booted(); let release; const gate = new Promise(r => { release = r; }); let readP;
  b.pg.hooks.push({ match: b.pg.commitOf('journal.write'), fn: async () => { readP = b.adapter.journalStore.read(); await gate; } });
  let acked = false; let w;
  const run = b.adapter.lock.withLock(async () => { w = b.adapter.journalStore.write({ v: 1 }).then(() => { acked = true; }); await w; });
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.equal(acked, false, 'not acknowledged while COMMIT is outstanding');
  release(); await run; assert.ok(acked);
  const texts = b.pg.log.map(l => l.text);
  const commitIdx = texts.lastIndexOf('COMMIT'); const readIdx = texts.lastIndexOf('SELECT bytes FROM "' + SCHEMA + '".journal WHERE scope = $1');
  assert.ok(readIdx > commitIdx, 'queued read ran after the transaction');
  eq(JSON.parse(await readP), { v: 1 });
});

test('A13 rows projected; malformed present rows throw, never null; foreign data not healthy', async () => {
  { const b = await booted(); b.pg.t().doc_head.get(SCOPE).xmin = 123;
    eq((await commitN(b.store, 1)).status, 'committed');
    b.pg.t().doc_head.get(SCOPE).ctid = '(0,1)';
    eq((await rec2(b.store.outcome({ actorId, operationId: op(1) }))).status, 'committed'); }
  for (const bad of [null, 'text', 42, undefined]) {
    const b = await booted(); const row = b.pg.t().doc_head.get(SCOPE); row.bytes = bad;
    assert.ok(await throws(() => b.adapter.documentStore.read()));
  }
  { const b = await booted(); b.pg.t().doc_head.get(SCOPE).__dupe = true; assert.ok(await throws(() => b.adapter.documentStore.read())); }
  { const b = await booted(); b.pg.t().journal.set(SCOPE, { bytes: Buffer.alloc(P.RECORD_MAX_BYTES + 1) }); assert.ok(await throws(() => b.adapter.journalStore.read())); }
  { const b = await booted(); b.pg.t().doc_head.get(SCOPE).bytes = null;
    eq(await rec2(fresh(b).store.bootstrap()), { status: 'unavailable', reason: 'document-unavailable' }); }
  { const b = await booted(); const fb = build({ pg: b.pg, ot: b.ot }, { householdId: otherHousehold });
    eq(await rec2(fb.store.bootstrap()), { status: 'unavailable', reason: 'pin-unavailable' });
    b.pg.t().journal.set(SCOPE, { bytes: Buffer.from('{"x":1}'), extra: true });
    const rj = await rec(fresh(b).store);
    eq([rj.row, rj.disposition], ['R4', 'journal-quarantined']); eq(b.pg.t().quarantine.length, 1);
    assert.match(b.pg.t().quarantine[0].name, /^[a-z0-9-]+-[0-9a-f]{32}$/);
    b.pg.t().doc_head.set(SCOPE, { bytes: C.adopt({ householdId: otherHousehold }) });
    const rh = await rec(fresh(b).store); eq([rh.row, rh.disposition], ['R7', 'recovery-blocked']); }
});

test('A14 backup.get throws; R6/R7/R8 recovery-blocked with evidence preserved', async () => {
  { const b = await booted(); assert.ok(await throws(() => b.obj.backupStore.get(0, 'a'.repeat(64)))); }
  for (const row of ['R6', 'R7', 'R8']) {
    const b = await booted(); const t = b.pg.t();
    if (row === 'R6') { const p = await prep(b.store, 1); b.pg.faults.push({ match: b.pg.commitOf('doc.commitTemp'), mode: 'lost-ack-landed' }); await b.store.commit(p);
      const j = JSON.parse(t.journal.get(SCOPE).bytes); j.preview.issuedAt += 1; j.preview.expiresAt += 1; t.journal.set(SCOPE, { bytes: Buffer.from(JSON.stringify(j)) }); }
    if (row === 'R7') { await commitN(b.store, 1); t.doc_head.set(SCOPE, { bytes: C.adopt({ householdId }) }); }
    if (row === 'R8') t.doc_head.delete(SCOPE);
    const before = snap(b); const r = await rec(fresh(b).store);
    eq([r.row, r.disposition, r.reason], [row, 'recovery-blocked', 'backup-missing']); eq(snap(b), before);
  }
});

test('A15 no household/actor id, key material or row bytes in adapter errors, non-receipt results or adapter-owned names', () => {
  const nonReceipt = outputs.filter(o => o && !('preview' in o) && !('receipt' in o) && o.status !== 'committed');
  const blob = JSON.stringify(thrown) + JSON.stringify(nonReceipt);
  for (const s of [householdId, otherHousehold, actorId, KEY.toString('hex'), KEY.toString('base64')]) assert.ok(!blob.includes(s));
  const pgErrors = thrown.filter(m => /settlement-postgres-adapter/.test(m));
  assert.ok(pgErrors.length > 10, 'adapter errors were collected: ' + pgErrors.length);
  assert.ok(!/"schema"|operations|baseBytes|\{"/.test(thrown.join('\n')));
});

test('review conditions: deliberate suspension during transaction and unlock awaits', async () => {
  // (2)(4) Holder settles while its started transaction is paused mid-statement:
  // invalidated before unlock, the txn aborts at its next check, unlock queues after it.
  { const b = await booted(); let release; const gate = new Promise(r => { release = r; }); let detached;
    b.pg.hooks.push({ match: t => t === 'BEGIN', fn: () => gate });
    const run = b.adapter.lock.withLock(async () => { detached = b.adapter.journalStore.write({ v: 1 }); detached.catch(() => {}); });
    await new Promise(r => setImmediate(r));
    release(); await run;
    assert.ok(await throws(() => detached));
    const texts = b.pg.log.map(l => l.text.split(' ')[0] + (l.text.includes('unlock') ? ':unlock' : ''));
    const i = texts.lastIndexOf('INSERT');
    const k = texts.lastIndexOf('BEGIN');
    eq(texts.slice(k), ['BEGIN', 'ROLLBACK', 'SELECT:unlock']); // paused at BEGIN, holder settled, aborted, then unlock
    assert.ok(i < k, 'the write statement was never dispatched');
    assert.ok(!b.pg.t().journal.has(SCOPE)); eq(b.client.retired, 0); }
  // (2)(3) Stale queued work (enqueued behind a paused unlocked read) refuses at dequeue after its holder settles.
  { const b = await booted(); let release; const gate = new Promise(r => { release = r; });
    b.pg.hooks.push({ match: t => /^SELECT bytes FROM "[a-z_]+"\.doc_head/.test(t), fn: () => gate });
    const rd = b.adapter.documentStore.read(); let queued;
    const run = b.adapter.lock.withLock(async () => { queued = b.adapter.journalStore.clear(); queued.catch(() => {}); });
    await new Promise(r => setImmediate(r)); release(); await rd;
    await run.catch(() => {});
    assert.ok(await throws(() => queued));
    eq(b.pg.log.filter(l => /DELETE FROM "[a-z_]+"\.journal/.test(l.text)).length, 0); }
  // (4)(5) Paused unlock: stale mutation and overlapping withLock both refused; no re-acquire.
  { const b = await booted(); let release; const gate = new Promise(r => { release = r; }); let detached;
    b.pg.hooks.push({ match: t => /pg_advisory_unlock/.test(t), fn: () => gate });
    const run = b.adapter.lock.withLock(async () => { detached = (async () => { await Promise.resolve(); await new Promise(r => setImmediate(r)); return throws(() => b.adapter.journalStore.clear()); })(); });
    await new Promise(r => setImmediate(r));
    assert.ok(await throws(() => b.adapter.lock.withLock(async () => 1)), 'overlap during unlock refused');
    const tries = b.pg.log.filter(l => /pg_try_advisory_lock/.test(l.text)).length;
    release(); await run; assert.ok(await detached);
    eq(b.pg.log.filter(l => /pg_try_advisory_lock/.test(l.text)).length, tries); }
  // (5) Nested withLock inside the holder is refused (advisory locks are reentrant).
  { const b = await booted(); let nested;
    await b.adapter.lock.withLock(async () => { nested = await throws(() => b.adapter.lock.withLock(async () => 1)); });
    assert.ok(nested); }
  // (6) false / malformed / lost unlock acknowledgement retires that exact session; no substitute.
  for (const mode of ['false', 'malformed', 'lost']) {
    const b = await booted(); const n = b.pg.clients.length;
    b.pg.hooks.push({ match: t => /pg_advisory_unlock/.test(t), fn: async c => {
      if (mode === 'false') b.pg.advisory.clear();
      if (mode === 'malformed') b.pg.faults.unshift({ match: () => false, mode: null });
    } });
    if (mode === 'malformed') {
      const orig = b.client.query; b.client.query = async (t, v) => (/pg_advisory_unlock/.test(t) ? (await orig(t, v), { rows: [{ unlocked: 'yes' }] }) : orig(t, v));
    }
    if (mode === 'lost') b.pg.faults.push({ match: t => /pg_advisory_unlock/.test(t), mode: 'reject' });
    await b.adapter.lock.withLock(async () => 1);
    eq(b.client.retired, 1, mode); eq(b.pg.clients.length, n, 'no cleanup connection');
    assert.ok(await throws(() => b.adapter.documentStore.read()));
  }
  // (1) pid swap mid-transaction retires the session (pid is only a swap check).
  { const b = await booted(); let r;
    await b.adapter.lock.withLock(async () => { b.client.pidOverride = 999999; r = await throws(() => b.adapter.journalStore.clear()); });
    assert.ok(r); eq(b.client.retired, 1); }
  // Expected conditional conflict is a successful SQL outcome: try-lock false refuses without retiring.
  { const b = await booted(); const o = fresh(b); let inner;
    await b.adapter.lock.withLock(async () => { inner = await throws(() => o.adapter.lock.withLock(async () => 1)); });
    assert.ok(inner); eq(o.client.retired, 0); eq(await o.adapter.lock.withLock(async () => 3), 3); }
});

// --- Systems BLOCK repairs (813dbfc4) -------------------------------------
// Replace the resolved envelope of the first matching statement (the fake
// still executes it, so effects may land) with a scripted envelope.
function envelope(b, match, env) {
  const orig = b.client.query; let used = false;
  b.client.query = async (t, v) => {
    const r = await orig(t, v);
    if (!used && match(t)) { used = true; return typeof env === 'function' ? env(r) : env; }
    return r;
  };
}
const MALFORMED = [undefined, null, {}, { rows: 'x' }, 42];

test('P1 malformed resolved envelopes at BEGIN, mutation, COMMIT, ROLLBACK and unlock retire that exact session', async () => {
  const stages = {
    BEGIN: t => t === 'BEGIN',
    mutation: t => /INTO "[a-z_]+"\.journal/.test(t),
    COMMIT: t => t === 'COMMIT',
  };
  for (const [stage, match] of Object.entries(stages)) {
    for (const env of MALFORMED) {
      const b = await booted(); const n = b.pg.clients.length; envelope(b, match, env); let r;
      await b.adapter.lock.withLock(async () => { r = await throws(() => b.adapter.journalStore.write({ v: 1 })); }).catch(() => {});
      assert.ok(r, stage + ' throws'); eq(b.client.retired, 1, stage + ' retired ' + JSON.stringify(env));
      eq(b.pg.clients.length, n, 'no substitute session');
      const q0 = b.client.queries; assert.ok(await throws(() => b.adapter.documentStore.read())); eq(b.client.queries, q0);
      if (stage !== 'COMMIT') assert.ok(!b.pg.t().journal.has(SCOPE), stage + ': nothing durable');
    }
  }
  // ROLLBACK: a definite refusal (nothing staged) whose ROLLBACK envelope is malformed.
  for (const env of MALFORMED) {
    const b = await booted(); envelope(b, t => t === 'ROLLBACK', env); let r;
    await b.adapter.lock.withLock(async () => { r = await throws(() => b.adapter.documentStore.commitTemp()); }).catch(() => {});
    assert.ok(r); eq(b.client.retired, 1, 'ROLLBACK retired ' + JSON.stringify(env));
    assert.ok(await throws(() => b.adapter.documentStore.read()));
  }
  // unlock: malformed envelopes (not merely a false/malformed row) retire.
  for (const env of MALFORMED) {
    const b = await booted(); envelope(b, t => /pg_advisory_unlock/.test(t), env);
    await b.adapter.lock.withLock(async () => 1).catch(() => {});
    eq(b.client.retired, 1, 'unlock retired ' + JSON.stringify(env));
    assert.ok(await throws(() => b.adapter.lock.withLock(async () => 1)));
  }
  // Mid-transaction failure: no COMMIT is dispatched and the open transaction is never reused.
  { const b = await booted(); envelope(b, t => /INTO "[a-z_]+"\.journal/.test(t), {});
    const c0 = b.pg.log.filter(l => l.text === 'COMMIT').length;
    await b.adapter.lock.withLock(async () => { await throws(() => b.adapter.journalStore.write({ v: 1 })); }).catch(() => {});
    eq(b.pg.log.filter(l => l.text === 'COMMIT').length, c0); eq(b.client.inTxn, false); eq(b.client.alive, false); }
});

test('P1 COMMIT is durable only on an affirmative COMMIT completion tag', async () => {
  const bad = { ROLLBACK: r => ({ ...r, command: 'ROLLBACK' }), missing: r => ({ rows: r.rows, rowCount: r.rowCount }),
    lower: r => ({ ...r, command: 'commit' }), number: r => ({ ...r, command: 1 }), other: r => ({ ...r, command: 'SELECT' }) };
  for (const [name, env] of Object.entries(bad)) {
    const b = await booted(); envelope(b, t => t === 'COMMIT', env); let acked = false;
    await b.adapter.lock.withLock(async () => { await b.adapter.journalStore.write({ v: 1 }).then(() => { acked = true; }, () => {}); }).catch(() => {});
    eq(acked, false, name + ' never acknowledged'); eq(b.client.retired, 1, name + ' retired');
  }
  // Store level: a ROLLBACK completion of the journal COMMIT is outcome-unknown, never saved.
  { const b = await booted(); const p = await prep(b.store, 1);
    envelope(b, t => t === 'COMMIT', r => ({ ...r, command: 'ROLLBACK' }));
    const r = await rec2(b.store.commit(p)); assert.notEqual(r.status, 'committed'); eq(r.status, 'unknown'); }
  // Affirmative tag still acknowledges.
  { const b = await booted(); let ok; await b.adapter.lock.withLock(async () => { await b.adapter.journalStore.write({ v: 2 }); ok = JSON.parse(await b.adapter.journalStore.read()); });
    eq(ok, { v: 2 }); eq(b.client.retired, 0); }
});

test('P2 validated inputs are snapshotted before the queue: immediate and queue-suspended caller mutation', async () => {
  for (const when of ['immediate', 'suspended']) {
    const b = await booted(); let release = () => {}; const gate = new Promise(r => { release = r; });
    if (when === 'suspended') b.pg.hooks.push({ match: t => /^SELECT bytes FROM "[a-z_]+"\.doc_head/.test(t), fn: () => gate });
    const doc = Buffer.from('doc-original'); const rec0 = { v: 'original', nested: { a: 1 } }; const qb = Buffer.from('q-original');
    let head, journal;
    await b.adapter.lock.withLock(async () => {
      const rd = when === 'suspended' ? b.adapter.documentStore.read() : null;
      const ws = [b.adapter.documentStore.writeTemp(doc), b.adapter.journalStore.write(rec0), b.adapter.quarantine.put('snap', qb)];
      doc.fill(0x7a); rec0.v = 'mutated'; rec0.nested.a = 2; rec0.extra = true; qb.fill(0x7a);
      if (when === 'suspended') { await new Promise(r => setImmediate(r)); doc.write('late'); rec0.late = 1; qb.write('late'); release(); await rd; }
      await Promise.all(ws);
      journal = JSON.parse(await b.adapter.journalStore.read());
    });
    head = b.pg.t().doc_staged.get(SCOPE).bytes.toString();
    eq(head, 'doc-original', when); eq(journal, { v: 'original', nested: { a: 1 } }, when);
    eq(b.pg.t().quarantine.at(-1).bytes.toString(), 'q-original', when);
  }
  // Holder checks still apply at execution: a snapshotted write queued by a settled holder is refused.
  { const b = await booted(); let release; const gate = new Promise(r => { release = r; }); let queued;
    b.pg.hooks.push({ match: t => /^SELECT bytes FROM "[a-z_]+"\.doc_head/.test(t), fn: () => gate });
    const rd = b.adapter.documentStore.read();
    const run = b.adapter.lock.withLock(async () => { queued = b.adapter.journalStore.write({ v: 3 }); queued.catch(() => {}); });
    await new Promise(r => setImmediate(r)); release(); await rd; await run.catch(() => {});
    assert.ok(await throws(() => queued)); assert.ok(!b.pg.t().journal.has(SCOPE)); }
});
