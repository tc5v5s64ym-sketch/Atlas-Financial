'use strict';
// C2 OFFLINE ONLY. Invented identities/bytes; custody is an explicitly trusted
// test double, not proof of real media, latestness, installation or qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../scripts/settlement-evidence-int3-restore-request');
const C = require('../scripts/planned-obligation-settlement-contract');
const V = require('../scripts/settlement-evidence-restore-input');
const X = require('./test-settlement-evidence-terminal-certificate');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));
const SECRET = 'synthetic_secret_sentinel_x9';
const names = ['doc_head', 'doc_staged', 'journal', 'quarantine', 'terminal_history'];
function profile() {
  const cols = { doc_head: ['scope', 'bytes'], doc_staged: ['scope', 'bytes'], journal: ['scope', 'bytes'], quarantine: ['scope', 'name', 'label', 'bytes'], terminal_history: ['scope', 'history_bytes', 'checkpoint_bytes'] };
  const grants = { doc_head: [true,true,false], doc_staged: [false,false,true], journal: [false,false,true], quarantine: [true,false,false], terminal_history: [true,true,false] };
  return {
    schema: 'settlement-int3-maintenance-profile-manifest-1',
    namespace: { schema: 'synthetic_settle', scope: 'synthetic-household', otherRelations: [] },
    relations: names.map(name => ({ name, kind: 'r', persistence: 'p', rowSecurity: false, forceRowSecurity: false, unsafe: false,
      columns: cols[name].map(n => ({ name: n, type: /bytes$/.test(n) ? 'bytea' : 'text', notNull: n !== 'label', generated: '' })), primaryKey: name === 'quarantine' ? ['scope','name'] : ['scope'] })),
    ownership: { schemaOwners: ['synthetic_owner'], relationOwners: Object.fromEntries(names.map(n => [n,['synthetic_owner']])) },
    maintenanceIdentity: { user: 'synthetic_maint', database: 'synthetic_db', canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false, replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0 },
    privileges: { database: { connect: true, create: false }, schema: { usage: true, create: false }, functions: { advisoryLock: true, backendPid: true },
      relations: Object.fromEntries(names.map(n => [n,{ select: true, insert: grants[n][0], update: grants[n][1], delete: grants[n][2], truncate: false, trigger: false, references: false, anyInsert: grants[n][0], anyUpdate: grants[n][1], anyReferences: false }])) },
    runtime: { node: 'v24.22.1', pg: '8.16.3', serverVersionNum: 180004 }, limits: {}, qualification: { inheritsFrom: null, claims: [] },
  };
}
async function fixture() {
  const w = X.makeExclusionWorld(), s = w.newStore();
  const domain = { householdId: X.householdId, ledgerNamespace: w.domain.ledgerNamespace };
  const target = { host: 'db.synthetic.test', port: 5432, database: 'synthetic_db', user: 'synthetic_maint', schema: 'synthetic_settle', scope: 'synthetic-household' };
  const pair = () => ({ ledgerBytes: Buffer.from(w.doc), historyBytes: Buffer.from(w.historyBytes) });
  const stale = pair();
  const p = await w.prepare(s, 1); assert.equal((await s.commit(w.input(p))).status, 'committed');
  const p2 = await w.prepare(s, 2); assert.equal((await w.seal(s, p2, 2)).status, 'certified');
  const latest = pair();
  const record = (id, bytes) => {
    const l = JSON.parse(bytes.ledgerBytes), h = JSON.parse(bytes.historyBytes);
    return { id, provenanceId: 'synthetic-provenance-' + id, target: clone(target), domain: clone(domain),
      anchors: { ledger: { revision: l.revision, documentDigest: l.digest }, history: { schema: 'terminal-history-checkpoint-1', ...domain, revision: h.revision, digest: h.digest } },
      pin: C.pin(bytes.ledgerBytes, domain.householdId), candidateHashes: { ledgerSha256: sha(bytes.ledgerBytes), historySha256: sha(bytes.historyBytes) } };
  };
  const records = [record('stale', stale), record('latest', latest)];
  const trusted = { profile: profile(), target, domain, custody: { sourceId: 'synthetic-custodian', provenanceId: 'synthetic-capture', independentOfCandidate: true, independentOfTarget: true,
    latest: { recordId: 'latest', recordDigest: C.digest(records[1]) }, records } };
  const input = (id = 'latest', purpose = 'latest-control') => ({ purpose, custodyRecordId: id, candidate: id === 'stale' ? { ...stale } : { ...latest },
    files: { ledgerFile: 'ledger.json', historyFile: 'history.json' }, preconditions: { quiescent: true, restartInhibited: true, ownerDecrypted: true } });
  return { trusted, input, latest, stale, records };
}
function notReady(r, reason) {
  assert.equal(r.status, 'NOT_READY'); assert.equal(r.reason, reason); assert.equal(r.request, null);
  assert.equal(r.qualified, false); assert.equal(r.reopen, false);
  assert.ok(Object.isFrozen(r));
}

test('C2: latest binding matches the shipped owner request contract and exact byte identities', async () => {
  const f = await fixture(), r = R.createRestoreRequestBinder(f.trusted).bind(f.input());
  assert.equal(r.status, 'REQUEST_BOUND');
  assert.deepEqual(r.request, { schema: 'settlement-owner-restore-request-1', target: f.trusted.target, domain: f.trusted.domain,
    anchors: f.records[1].anchors, candidate: { ledgerFile: 'ledger.json', historyFile: 'history.json' }, pin: f.records[1].pin,
    preconditions: { quiescent: true, restartInhibited: true, anchorsCurrent: true, ownerDecrypted: true } });
  assert.deepEqual(r.binding.candidateHashes, { ledgerSha256: sha(f.latest.ledgerBytes), historySha256: sha(f.latest.historyBytes) });
  assert.equal(r.binding.recordDigest, C.digest(f.records[1]));
  assert.equal(r.binding.profileDigest, C.digest(f.trusted.profile));
  assert.equal(r.binding.requestDigest, C.digest(r.request));
  assert.equal(r.binding.sourceId, 'synthetic-custodian');
  assert.equal(r.binding.provenanceId, 'synthetic-provenance-latest');
  assert.equal(r.binding.latestness, 'caller-attested-not-proved');
  assert.equal(V.validateRestoreInput({ domain: r.request.domain, anchors: r.request.anchors, candidate: f.latest }).status, 'valid');
  assert.equal(r.qualified, false); assert.equal(r.reopen, false);
  const source = fs.readFileSync(path.join(__dirname, '../scripts/restore-settlement-evidence.js'), 'utf8');
  const example = JSON.parse(source.match(/\{"schema":"settlement-owner-restore-request-1"[^\n]+/)[0]);
  assert.deepEqual(Object.keys(r.request).sort(), Object.keys(example).sort());
  for (const key of ['target','candidate','preconditions']) assert.deepEqual(Object.keys(r.request[key]).sort(), Object.keys(example[key]).sort());
});

test('C2: genuine stale pair passes shape/hash validation but cannot substitute for latest', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted);
  assert.equal(V.validateRestoreInput({ domain: f.trusted.domain, anchors: f.records[0].anchors, candidate: f.stale }).status, 'valid');
  notReady(b.bind(f.input('stale')), 'stale-as-latest');
  const r = b.bind(f.input('stale','stale-attack'));
  assert.equal(r.status, 'ATTACK_INPUT_BOUND'); assert.equal(r.request, null);
  assert.equal(r.binding.latestness, 'known-stale'); assert.deepEqual(r.binding.anchors, f.records[0].anchors);
  assert.equal(r.qualified, false); assert.equal(r.reopen, false);
  notReady(b.bind(f.input('latest','stale-attack')), 'attack-not-stale');
});

test('C2: pinned latest digest refuses stale record relabelled as latest', async () => {
  const f = await fixture(); f.trusted.custody.records[1] = { ...clone(f.records[0]), id: 'latest' };
  notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()), 'custody-invalid');
});

test('C2: missing custody/provenance/independence never becomes inferred genesis', async () => {
  for (const change of [t => { t.custody = null; }, t => { delete t.custody.provenanceId; }, t => { t.custody.sourceId = ''; },
    t => { t.custody.independentOfCandidate = false; }, t => { t.custody.independentOfTarget = false; },
    t => { delete t.custody.latest; }, t => { t.custody.records[0].provenanceId = ''; }, t => { t.custody.records = []; }]) {
    const f = await fixture(); change(f.trusted); notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()), 'custody-invalid');
  }
});

test('C2: cross-domain and wrong-target custody is refused even with matching hashes', async () => {
  for (const change of [t => { t.custody.records[0].domain.householdId = 'household-' + 'e'.repeat(32); },
    t => { t.custody.records[0].domain.ledgerNamespace = 'ledger-' + 'e'.repeat(32); },
    t => { t.custody.records[0].target.scope = 'other'; }, t => { t.custody.records[0].target.host = 'other.synthetic.test'; },
    t => { t.custody.records[0].anchors.history.householdId = 'household-' + 'e'.repeat(32); }]) {
    const f = await fixture(); change(f.trusted); notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()), 'custody-invalid');
  }
});

test('C2: actual C1 manifest is revalidated and bound to maintenance identity/namespace', async () => {
  for (const change of [t => { t.profile.relations.pop(); }, t => { t.profile = { status: 'compatible', qualified: false }; },
    t => { t.profile.maintenanceIdentity.user = 'other_maint'; }, t => { t.target.scope = 'other'; }, t => { t.target.database = 'other_db'; },
    t => { t.target.schema = 'other_schema'; }]) {
    const f = await fixture(); change(f.trusted); notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()), 'profile-invalid');
  }
});

test('C2: candidate mismatches refuse independently for ledger/history bytes, anchors and pin', async () => {
  for (const part of ['ledgerBytes','historyBytes']) {
    const f = await fixture(), i = f.input(); i.candidate[part] = f.stale[part];
    notReady(R.createRestoreRequestBinder(f.trusted).bind(i), 'candidate-mismatch');
  }
  for (const change of [r => { r.anchors.ledger.documentDigest = '0'.repeat(64); }, r => { r.anchors.history.digest = '0'.repeat(64); }, r => { r.pin = '0'.repeat(64); }]) {
    const f = await fixture(); change(f.records[1]); f.trusted.custody.latest.recordDigest = C.digest(f.records[1]);
    notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()), 'candidate-mismatch');
  }
});

test('C2: unknown/duplicate custody identities and malformed anchors refuse', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted), i = f.input(); i.custodyRecordId = 'unproven';
  notReady(b.bind(i), 'custody-record-missing');
  for (const change of [t => { t.custody.records.push(clone(t.custody.records[0])); }, t => { t.custody.records[0].anchors.ledger.revision = -1; },
    t => { t.custody.records[0].anchors.history.schema = 'other'; }, t => { t.custody.latest.recordId = 'absent'; }]) {
    const g = await fixture(); change(g.trusted); notReady(R.createRestoreRequestBinder(g.trusted).bind(g.input()), 'custody-invalid');
  }
});

test('C2: explicit preconditions and bounded distinct private filenames required', async () => {
  for (const change of [i => { i.preconditions.quiescent = false; }, i => { i.preconditions.restartInhibited = false; }, i => { i.preconditions.ownerDecrypted = false; },
    i => { delete i.preconditions; }, i => { i.files.ledgerFile = '../ledger.json'; }, i => { i.files.historyFile = i.files.ledgerFile; },
    i => { i.files.ledgerFile = '/tmp/ledger.json'; }, i => { i.files.ledgerFile = 'C:\\private\\ledger.json'; }, i => { i.purpose = 'qualified'; }]) {
    const f = await fixture(), i = f.input(); change(i); notReady(R.createRestoreRequestBinder(f.trusted).bind(i), 'input-invalid');
  }
});

test('C2: no credential/raw-error or candidate payload in serialized request/refusals', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted);
  const json = JSON.stringify(b.bind(f.input()));
  assert.ok(!json.includes('ledgerBytes') && !json.includes('historyBytes') && !json.includes('password'));
  for (const change of [i => { i.password = SECRET; }, i => { i.candidate = { ledgerBytes: Buffer.from(SECRET), historyBytes: Buffer.from(SECRET) }; },
    i => { Object.defineProperty(i, 'purpose', { get() { throw Error(SECRET); } }); }]) {
    const i = f.input(); change(i); const r = b.bind(i); assert.equal(r.status, 'NOT_READY'); assert.ok(!JSON.stringify(r).includes(SECRET));
  }
  const hostile = new Proxy({}, { ownKeys() { throw Error(SECRET); }, getPrototypeOf() { throw Error(SECRET); } });
  assert.ok(!JSON.stringify(b.bind(hostile)).includes(SECRET));
  assert.ok(!JSON.stringify(R.createRestoreRequestBinder(hostile).bind(f.input())).includes(SECRET));
});

test('C2: bounded bytes and hostile byte overrides do not run caller getters or methods', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(2*1024*1024+1), new DataView(new ArrayBuffer(4)), new Proxy(Buffer.from('x'), {})]) {
    const i = f.input(); i.candidate.ledgerBytes = bytes; assert.equal(b.bind(i).status, 'NOT_READY');
  }
  let calls = 0;
  const i = f.input(); i.candidate.ledgerBytes = Buffer.from(f.latest.ledgerBytes);
  for (const k of ['buffer','byteOffset','byteLength','length']) Object.defineProperty(i.candidate.ledgerBytes,k,{ get() { calls++; throw Error(SECRET); } });
  i.candidate.ledgerBytes.toString = () => { calls++; throw Error(SECRET); };
  assert.equal(b.bind(i).status,'REQUEST_BOUND'); assert.equal(calls,0);
});

test('C2: trusted snapshot and results are immutable; caller mutation cannot change latest selection', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted), i = f.input(), before = clone(f.trusted);
  const r = b.bind(i); assert.deepEqual(f.trusted,before);
  f.trusted.custody.latest.recordId = 'stale'; f.trusted.custody.records[1].pin = '0'.repeat(64);
  f.trusted.target.host = 'other.synthetic.test'; f.trusted.profile.relations.length = 0;
  assert.deepEqual(b.bind(i),r);
  for (const obj of [r,r.request,r.request.anchors,r.request.anchors.history,r.binding,r.binding.candidateHashes]) assert.ok(Object.isFrozen(obj));
  assert.throws(() => { r.request.pin = '0'.repeat(64); },TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(r.request)),r.request);
});

test('C2: module stays disconnected and never installs, fetches, decrypts or qualifies', () => {
  const source = fs.readFileSync(path.join(__dirname,'../scripts/settlement-evidence-int3-restore-request.js'),'utf8');
  assert.ok(!/require\(['"](?:node:)?(?:fs|http|https|net|tls|child_process|pg)['"]\)/.test(source));
  assert.ok(!/process\.(?:env|argv)|\.main\(|installRestoreCandidate\(/.test(source));
});

test('C2: thrown proxies, revoked proxies, cycles, sparse arrays and accessors fail closed without raw diagnostics', async () => {
  const f = await fixture(), b = R.createRestoreRequestBinder(f.trusted);
  const revoked = Proxy.revocable({},{}); revoked.revoke();
  const thrown = new Proxy({}, { getPrototypeOf() { throw Error(SECRET); }, get() { throw Error(SECRET); } });
  const hostile = new Proxy({}, { getPrototypeOf() { throw thrown; } });
  for (const value of [hostile,revoked.proxy,null,undefined]) {
    notReady(b.bind(value),'input-invalid');
    notReady(R.createRestoreRequestBinder(value).bind(f.input()),'custody-invalid');
  }
  for (const mutate of [t => { t.custody.records.length = 5; }, t => { t.custody.records[0] = t; },
    t => { Object.defineProperty(t.custody,'sourceId',{ get() { throw Error(SECRET); } }); }]) {
    const g = await fixture(); mutate(g.trusted);
    notReady(R.createRestoreRequestBinder(g.trusted).bind(g.input()),'custody-invalid');
  }
});

test('C2: stale means preceding latest, never equal-revision conflict or future state', async () => {
  for (const mutate of [r => { r.anchors.ledger.revision = 2; }, r => { r.anchors.history.revision = 2; },
    r => { r.anchors.ledger.revision = 1; r.anchors.ledger.documentDigest = '0'.repeat(64); },
    (r,t) => { r.anchors = clone(t.custody.records[1].anchors); }]) {
    const f = await fixture(); mutate(f.records[0],f.trusted);
    notReady(R.createRestoreRequestBinder(f.trusted).bind(f.input()),'custody-invalid');
  }
});
