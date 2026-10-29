'use strict';
// Plan #5 final Savings acceptance — A6 cold process (TEST ONLY).
// FAKE-BACKED COLD-PROCESS PROOF. Not Postgres, not a live target, not
// provider or crash-consistency qualification (#765 6480259704 row 6;
// Atlas ruling 6486957378).
//
// Process A (a fresh OS child) composes the ACTUAL host
// (createSettlementProductionHost + host.prepare + real startServer),
// bootstraps by the maintenance pattern, runs one prepare/confirm over
// real HTTP, then exits abruptly with process.exit (no graceful close).
// Process B (a second fresh OS child, new V8 heap: no retained JS maps,
// module caches or custody objects) composes a new host against the
// retained backing and must recover the saved result WITHOUT bootstrap
// or any reseeding/application write.
//
// Backup continuity (repair for Atlas review 2026-10-29T04:18:44Z): A
// records the retained-backup manifest through the HOST custody
// backupStore.list() before exiting; B lists the manifest through its
// OWN host-created backupStore over the retained serialized backing and
// must see the identical entries (revision, digest, artifactId). list()
// verifies every row's household binding, revision/digest binding and
// stored-ciphertext integrity; no server decryption is involved
// (backupStore.get() is deliberately recovery-unavailable).
//
// Retained backing = a JSON file holding the synthetic pg world's
// tables (doc/journal/staged, custody pin + backups, native terminal
// history row, authorization eligibility/revocations). It is rewritten
// after every synthetic SQL statement completes, so it reflects the
// backing as of A's last statement. The synthetic pg driver, provider
// acquisition and encrypt seam are the labelled doubles from
// test/acceptance-host-observations.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const TABLES = ['doc', 'journal', 'temp', 'terminalRow', 'pinRow', 'backups', 'eligibility', 'revoked', 'sessions'];
const enc = v => v === null || v === undefined ? null
  : Buffer.isBuffer(v) ? { $b: v.toString('base64') }
  : v instanceof Map ? { $m: [...v].map(([k, x]) => [k, enc(x)]) }
  : v instanceof Set ? { $s: [...v] }
  : typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) : v;
const dec = v => v === null ? null
  : typeof v !== 'object' ? v
  : v.$b !== undefined ? Buffer.from(v.$b, 'base64')
  : v.$m ? new Map(v.$m.map(([k, x]) => [k, dec(x)]))
  : v.$s ? new Set(v.$s)
  : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)]));

async function child(role, backingFile) {
  const H = require('./acceptance-host-observations');
  const w = H.makeWorld(); H.setActive(w); w.nativeHistory = true; H.installDoubles(null, w);
  if (role === 'B') {
    const saved = dec(JSON.parse(fs.readFileSync(backingFile, 'utf8')));
    for (const k of TABLES) w[k] = saved[k];
  }
  const query = H.SyntheticClient.prototype.query;
  H.SyntheticClient.prototype.query = async function (...args) {
    const r = await query.apply(this, args);
    fs.writeFileSync(backingFile, JSON.stringify(enc(Object.fromEntries(TABLES.map(k => [k, w[k]])))));
    return r;
  };
  const { config, host } = await H.composeHost(w, { bootstrap: role === 'A' });
  const mark = w.sql.length;
  const owner = await H.listen(w, config, host);
  const out = { role, pid: process.pid, ready: owner.status().state };
  if (role === 'A') {
    const p = await H.prepared(w);
    const r = await H.confirm(w, p);
    Object.assign(out, { confirm: r.value, credential: H.credential(p), revision: JSON.parse(w.doc).revision,
      docCommitsAfterStart: H.docCommits({ sql: w.sql.slice(mark) }),
      backups: (await host.settlement.custody.backupStore.list()).map(e => ({ ...e })),
      backupRows: w.backups.size });
  } else {
    const cred = JSON.parse(process.env.ACCEPTANCE_A6_CREDENTIAL);
    out.outcome = (await H.request(w, '/settlement/outcome', cred)).value;
    const data = (await H.request(w, '/data.json')).value;
    out.status = data.settlementEvidenceStatus;
    out.links = data.settlementEvidence.commitments.flatMap(g => g.links)
      .filter(l => l.operationId === cred.operationId).map(l => ({ operationId: l.operationId, assignedCents: l.assignedCents }));
    out.assignments = (await H.request(w, '/settlement/assignments', {})).value;
    out.revision = JSON.parse(w.doc).revision;
    out.backupRowsLoaded = w.backups.size;
    out.backups = (await host.settlement.custody.backupStore.list()).map(e => ({ ...e }));
    out.writesInB = H.appWrites(w, mark).map(e => e.kind + ':' + e.text.slice(0, 40));
    out.bootstrapCalls = w.sql.filter(e => e.text.startsWith('INSERT') && e.text.includes('.doc_staged')).length;
  }
  process.stdout.write('A6-RESULT ' + JSON.stringify(out) + '\n');
  process.exit(0); // abrupt: no owner.close(), no custody retirement
}

if (process.argv[2] === '--child') {
  child(process.argv[3], process.argv[4]).catch(e => { console.error(e); process.exit(2); });
} else {
  const test = require('node:test');
  const run = (role, file, env = {}) => {
    const stdout = execFileSync(process.execPath, [__filename, '--child', role, file],
      { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000 });
    const line = stdout.split('\n').find(l => l.startsWith('A6-RESULT '));
    assert.ok(line, 'child ' + role + ' reported');
    return JSON.parse(line.slice('A6-RESULT '.length));
  };
  test('A6 fake-backed cold process: process A writes via the actual host and exits; fresh process B recovers without reseeding and lists the retained backups', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-a6-'));
    const file = path.join(dir, 'retained-backing.json');
    const a = run('A', file);
    assert.equal(a.ready, 'ready');
    assert.equal(a.confirm.status, 'committed');
    assert.equal(a.revision, 1);
    assert.equal(a.docCommitsAfterStart, 1, 'A applied exactly once');
    assert.ok(fs.existsSync(file), 'retained backing file exists after A exited');
    assert.equal(a.backups.length, a.backupRows, 'A host manifest covers every retained backup row');
    assert.deepEqual(a.backups.map(e => e.revision), [0, 1], 'A retained the genesis and revision-1 backups');
    const b = run('B', file, { ACCEPTANCE_A6_CREDENTIAL: JSON.stringify(a.credential) });
    assert.notEqual(b.pid, a.pid, 'B is a different OS process');
    assert.equal(b.ready, 'ready');
    assert.deepEqual(b.outcome, { status: 'committed', operationId: a.credential.operationId },
      'B recovers the saved original result');
    assert.deepEqual(b.status, { status: 'qualified' });
    assert.deepEqual(b.links, [{ operationId: a.credential.operationId, assignedCents: 2500 }],
      'retained evidence published once, not duplicated');
    assert.equal(b.assignments.status, 'available');
    assert.equal(b.assignments.assignments.length, 1);
    assert.equal(b.revision, 1, 'revision unchanged in B');
    assert.deepEqual(b.backups, a.backups,
      'B lists, through its own host backup store, exactly the backups A retained (revision, digest, artifactId)');
    assert.equal(b.backupRowsLoaded, a.backupRows, 'B loaded every serialized backup row');
    assert.deepEqual(b.writesInB, [], 'B performed no application, custody or bootstrap writes');
    assert.equal(b.bootstrapCalls, 0);
  });
}
