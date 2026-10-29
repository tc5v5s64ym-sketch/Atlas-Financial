'use strict';
// P6 REAL official age interoperability, synthetic fixtures/identities ONLY.
// Run explicitly, not registered in test/test.js by this bounded dispatch:
// ATLAS_P6_AGE_BINARY=/absolute/verified/age node --test this-file
// Missing real binary => explicitly skipped real-tool proof, never a double.
// All generated identities/plaintext/binaries stay outside tracked source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const A = require('../scripts/settlement-evidence-age-process');
const E = require('../scripts/settlement-evidence-age-encrypt');
const O = require('../scripts/settlement-evidence-age-prepare');
const C = require('../scripts/planned-obligation-settlement-contract');
const V = require('../scripts/settlement-evidence-restore-input');
const OA = require('../scripts/settlement-evidence-object-adapter');
const X = require('./test-settlement-evidence-terminal-certificate');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const binaryPath = process.env.ATLAS_P6_AGE_BINARY;

function secureDir(parent) {
  const d = fs.mkdtempSync(path.join(parent, 'SYNTHETIC-p6-')); fs.chmodSync(d, 0o700);
  if (process.platform === 'win32') {
    const script = "$ErrorActionPreference='Stop';$p=$env:ATLAS_P6_TEST_DIR;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User;$acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);$r=New-Object Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($r);Set-Acl -LiteralPath $p -AclObject $acl";
    cp.execFileSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000,
        env: { SystemRoot: process.env.SystemRoot, ATLAS_P6_TEST_DIR: d }, stdio: 'pipe' });
  }
  return d;
}
const writeNew = (p, b) => fs.writeFileSync(p, b, { flag: 'wx', mode: 0o600 });
const noCandidates = d => { for (const n of ['ledger.json', 'history.json', 'ledger.json.partial', 'history.json.partial', '.age-prepare.lock']) assert.equal(fs.existsSync(path.join(d, n)), false, n + ' absent'); };

test('P6 official age v1.3.2 synthetic acceptance (no target/installer)', { skip: !binaryPath && 'UNRUN: set an absolute provenance-verified official binary' }, async t => {
  assert.equal(process.version, 'v24.22.1', 'run acceptance with pinned Node');
  const setupStart = performance.now(), pin = A.verifyAgeBinary(binaryPath), parent = secureDir(os.tmpdir()), times = [];
  const keygen = path.join(path.dirname(binaryPath), process.platform === 'win32' ? 'age-keygen.exe' : 'age-keygen');
  assert.equal(sha(fs.readFileSync(keygen)), pin.keygenSha256, 'keygen pinned before execution');
  const timing = (step, start, result) => { const end = performance.now(); times.push({ step, startMonotonicMs: +start.toFixed(3), endMonotonicMs: +end.toFixed(3), milliseconds: +(end - start).toFixed(3), result }); };
  const measure = async (step, fn) => { const start = performance.now(); try { const value = await fn(); timing(step, start, 'pass'); return value; }
    catch (e) { timing(step, start, 'fail'); throw e; } };
  function cli(exe, args, input) {
    const r = cp.spawnSync(exe, args, { input, timeout: 10000, maxBuffer: 5 * 1024 * 1024, windowsHide: true,
      env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {} });
    assert.equal(r.error, undefined, 'bounded child started'); assert.equal(r.status, 0, 'official child exit zero'); return r.stdout;
  }
  function identity(d) {
    const secret = cli(keygen, ['-pq'], Buffer.alloc(0));
    const p = path.join(d, 'identity.txt'); writeNew(p, secret); secret.fill(0);
    const recipient = cli(keygen, ['-y', p], Buffer.alloc(0)).toString().trim();
    assert.match(recipient, /^age1pq1/); return { p, recipient };
  }
  async function fixture() {
    const w = X.makeExclusionWorld({ namespace: X.namespace }), store = w.newStore();
    const oldLedger = Buffer.from(w.doc), oldHistory = Buffer.from(w.historyBytes);
    const prep = await w.prepare(store, 1); assert.equal((await store.commit(w.input(prep))).status, 'committed');
    const negative = await w.prepare(store, 2); assert.equal((await w.seal(store, negative, 2)).status, 'certified');
    const ledgerBytes = Buffer.concat([Buffer.from(w.doc), Buffer.alloc(192 * 1024, 32)]), historyBytes = Buffer.from(w.historyBytes);
    const l = JSON.parse(ledgerBytes), h = JSON.parse(historyBytes);
    const trusted = { domain: { householdId: X.householdId, ledgerNamespace: X.namespace },
      anchors: { ledger: { revision: l.revision, documentDigest: l.digest }, history: { schema: 'terminal-history-checkpoint-1', householdId: h.householdId, ledgerNamespace: h.ledgerNamespace, revision: h.revision, digest: h.digest } } };
    assert.equal(V.validateRestoreInput({ ...trusted, candidate: { ledgerBytes, historyBytes } }).status, 'valid');
    return { ledgerBytes, historyBytes, oldLedger, oldHistory, trusted };
  }
  try {
    const primaryDir = secureDir(parent), backupDir = secureDir(parent), custodyDir = secureDir(parent);
    timing('pin verification + initial four owner-private synthetic directories', setupStart, 'pass');
    const primary = await measure('synthetic hybrid generation + public export', () => identity(primaryDir));
    const custody = await measure('synthetic backup-custody hybrid generation + export', () => identity(custodyDir));
    const f = await fixture(), encrypt = E.createAgeEncryptor({ binaryPath, recipient: primary.recipient });
    const archives = await measure('encrypt coherent fixture ledger + history', async () => ({ ledgerBytes: await encrypt(f.ledgerBytes), historyBytes: await encrypt(f.historyBytes) }));
    const backupEncrypt = E.createAgeEncryptor({ binaryPath, recipient: custody.recipient });
    await measure('encrypted synthetic identity backup + primary removal + backup unlock', async () => {
      const original = fs.readFileSync(primary.p);
      try { const backup = await backupEncrypt(original); writeNew(path.join(backupDir, 'identity.age'), backup); }
      finally { original.fill(0); }
      fs.unlinkSync(primary.p); assert.equal(fs.existsSync(primary.p), false);
      const unlocked = cli(binaryPath, ['--decrypt', '--identity', custody.p], fs.readFileSync(path.join(backupDir, 'identity.age')));
      try { writeNew(path.join(backupDir, 'identity.txt'), unlocked); } finally { unlocked.fill(0); }
    });
    function request(d, overrides = {}) { return { binaryPath, privateRoot: d, identityFile: 'identity.txt', archives, ...f.trusted, ...overrides }; }
    function ownerDir() { const d = secureDir(parent); writeNew(path.join(d, 'identity.txt'), fs.readFileSync(path.join(backupDir, 'identity.txt'))); return d; }
    const negative = async (label, overrides, setup) => {
      const d = ownerDir(); if (setup) setup(d);
      await assert.rejects(O.prepareOwnerCandidates(request(d, overrides)), { message: 'owner age preparation unavailable' });
      noCandidates(d); return d;
    };
    await t.test('wrapper → independent official CLI exact bytes; randomized ciphertext', async () => {
      assert.deepEqual(cli(binaryPath, ['--decrypt', '--identity', path.join(backupDir, 'identity.txt')], archives.ledgerBytes), f.ledgerBytes);
      assert.deepEqual(cli(binaryPath, ['--decrypt', '--identity', path.join(backupDir, 'identity.txt')], archives.historyBytes), f.historyBytes);
      assert.notDeepEqual(await encrypt(f.historyBytes), archives.historyBytes);
      const malformed = E.createAgeEncryptor({ binaryPath, recipient: 'age1pq1' + 'q'.repeat(1950) });
      await assert.rejects(malformed(f.historyBytes), { message: 'age operation unavailable' });
      for (const p of Object.values(archives)) assert.equal(p.includes(Buffer.from(X.householdId)), false);
    });
    await t.test('backup-only decrypt/full validation/promotion; no installer', async () => {
      const d = ownerDir();
      const result = await measure('backup-only pair decrypt + full validation + exclusive promotion', () => O.prepareOwnerCandidates(request(d)));
      assert.deepEqual(result, { status: 'prepared', candidate: { ledgerFile: 'ledger.json', historyFile: 'history.json' }, qualified: false, reopen: false, latestness: 'caller-supplied-not-proved' });
      assert.deepEqual(fs.readFileSync(path.join(d, 'ledger.json')), f.ledgerBytes); assert.deepEqual(fs.readFileSync(path.join(d, 'history.json')), f.historyBytes);
      assert.equal(fs.lstatSync(path.join(d, 'ledger.json')).nlink, 1);
    });
    await t.test('wrong identity, tamper and late truncation promote nothing', async () => {
      await measure('wrong-identity refusal', () => negative('wrong', {}, d => { fs.unlinkSync(path.join(d, 'identity.txt')); writeNew(path.join(d, 'identity.txt'), fs.readFileSync(custody.p)); }));
      const bad = Buffer.from(archives.historyBytes); bad[bad.length - 1] ^= 1;
      await measure('tampered-history refusal after successful ledger decrypt', () => negative('tamper', { archives: { ...archives, historyBytes: bad } }));
      const truncated = archives.ledgerBytes.subarray(0, -17);
      // Reproduce the real trap independently: official age emits plaintext
      // before detecting this missing final chunk. Never accept those bytes.
      const raw = cp.spawnSync(binaryPath, ['--decrypt', '--identity', path.join(backupDir, 'identity.txt')], { input: truncated, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true,
        env: process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {} });
      assert.notEqual(raw.status, 0); assert.ok(raw.stdout.length > 0, 'actual partial plaintext observed');
      t.diagnostic(JSON.stringify({ realAgeTruncationExit: raw.status, partialPlaintextBytes: raw.stdout.length })); raw.stdout.fill(0);
      await measure('real partial-plaintext-then-child-failure refusal', () => negative('truncated', { archives: { ...archives, ledgerBytes: truncated } }));
    });
    await t.test('decrypt exit zero still refuses wrong household, stale ledger/history and mismatched pair', async () => {
      await negative('household', { domain: { ...f.trusted.domain, householdId: 'household-' + 'e'.repeat(32) } });
      await negative('stale-ledger', { archives: { ...archives, ledgerBytes: await encrypt(f.oldLedger) } });
      await negative('stale-history', { archives: { ...archives, historyBytes: await encrypt(f.oldHistory) } });
      const foreign = X.encoded([], X.householdId, 'ledger-' + 'f'.repeat(32));
      await negative('mismatched-history', { archives: { ...archives, historyBytes: await encrypt(foreign.historyBytes) } });
    });
    await t.test('existing/newer state and exclusive partial/lock traps preserve exact bytes', async () => {
      // Independently demonstrate age's normal -o overwrite behaviour on a
      // disposable synthetic file; the owner helper never delegates -o.
      const raw = path.join(backupDir, 'SYNTHETIC-raw-output.json');
      writeNew(raw, Buffer.from('SYNTHETIC_OLD_OUTPUT'));
      cli(binaryPath, ['--decrypt', '--identity', path.join(backupDir, 'identity.txt'), '--output', raw], archives.historyBytes);
      assert.deepEqual(fs.readFileSync(raw), f.historyBytes, 'official -o replaces existing bytes');
      for (const name of ['ledger.json', 'history.json', 'ledger.json.partial', 'history.json.partial', '.age-prepare.lock']) {
        const d = ownerDir(), p = path.join(d, name), sentinel = Buffer.from('SYNTHETIC_NEWER_STATE'); writeNew(p, sentinel);
        await assert.rejects(O.prepareOwnerCandidates(request(d))); assert.deepEqual(fs.readFileSync(p), sentinel);
        for (const other of ['ledger.json', 'history.json', 'ledger.json.partial', 'history.json.partial', '.age-prepare.lock'])
          if (other !== name) assert.equal(fs.existsSync(path.join(d, other)), false);
      }
    });
    await t.test('destination created during promotion cannot be overwritten; first publication rolls back', async () => {
      const d = ownerDir(), original = fs.linkSync, sentinel = Buffer.from('SYNTHETIC_CONCURRENT_NEWER_STATE');
      t.mock.method(fs, 'linkSync', (src, dest) => { if (dest === path.join(d, 'history.json')) writeNew(dest, sentinel); return original(src, dest); });
      try { await assert.rejects(O.prepareOwnerCandidates(request(d))); }
      finally { t.mock.restoreAll(); }
      assert.equal(fs.existsSync(path.join(d, 'ledger.json')), false); assert.deepEqual(fs.readFileSync(path.join(d, 'history.json')), sentinel);
      assert.equal(fs.existsSync(path.join(d, 'ledger.json.partial')), false); assert.equal(fs.existsSync(path.join(d, '.age-prepare.lock')), false);
    });
    await t.test('hardlinked identity refuses', async () => {
      const d = ownerDir(); fs.linkSync(path.join(d, 'identity.txt'), path.join(d, 'hardlinked.txt'));
      await assert.rejects(O.prepareOwnerCandidates(request(d))); noCandidates(d);
    });
    await t.test('symlink partial refuses without touching its target', async t2 => {
      const linked = ownerDir(), target = path.join(parent, 'SYNTHETIC-target.txt'); writeNew(target, Buffer.from('SYNTHETIC_EXISTING'));
      try { fs.symlinkSync(target, path.join(linked, 'ledger.json.partial')); }
      catch (e) { if (e.code === 'EPERM') { t2.skip('UNRUN: OS denied synthetic symlink creation'); return; } throw e; }
      await assert.rejects(O.prepareOwnerCandidates(request(linked))); assert.equal(fs.readFileSync(target).toString(), 'SYNTHETIC_EXISTING');
    });
    await t.test('non-owner-only root refuses before decryption', { skip: process.platform === 'win32' && 'UNRUN: Windows denied negative ACL fixture setup (SeSecurityPrivilege); no retry/bypass' }, async () => {
      const d = ownerDir();
      fs.chmodSync(d, 0o755);
      await assert.rejects(O.prepareOwnerCandidates(request(d))); noCandidates(d);
    });
    await t.test('real encrypt seam preserves archive identity/retry and uncertain upload semantics', async () => {
      let record, creates = 0, uncertain = false;
      // Labelled conditional in-memory transport; crypto is official age.
      const transport = { async read() { return record; }, async replace() { throw Error('unused'); }, async list() { return { entries: [], nextCursor: null }; },
        async create(key, bytes, metadata) { creates++; if (record) throw Object.assign(Error('conflict'), { code: 'conflict' });
          record = { bytes: Buffer.from(bytes), metadata: { ...metadata }, version: 'synthetic-1' }; if (uncertain) throw Error('synthetic-lost-ack'); return { version: 'synthetic-1', integrity: sha(bytes) }; } };
      const adapter = OA.createSettlementEvidenceObjectAdapter({ householdId: X.householdId, namespace: 'synthetic-p6', transport, encrypt });
      const doc = JSON.parse(f.ledgerBytes), ack = await adapter.backupStore.put(doc.revision, doc.digest, f.ledgerBytes), saved = Buffer.from(record.bytes);
      assert.deepEqual(await adapter.backupStore.put(doc.revision, doc.digest, f.ledgerBytes), ack); assert.deepEqual(record.bytes, saved); assert.equal(creates, 2);
      record = null; uncertain = true; await assert.rejects(adapter.backupStore.put(doc.revision, doc.digest, f.ledgerBytes), /synthetic-lost-ack/);
      assert.equal(creates, 3, 'no automatic retry after uncertain upload'); assert.notDeepEqual(record.bytes, f.ledgerBytes);
    });
    t.diagnostic(JSON.stringify({ syntheticOnly: true, profile: 'native ML-KEM-768 + X25519', fixtureSha256: { ledger: sha(f.ledgerBytes), history: sha(f.historyBytes) }, times,
      unmeasured: ['human readback/decision', 'passphrase custody ceremony', 'secure transfer/media', 'provider/session/restore/reopen'] }));
  } finally {
    // Only this newly created, resolved synthetic directory may be removed.
    const resolved = path.resolve(parent), temp = path.resolve(os.tmpdir());
    assert.ok(resolved.startsWith(temp + path.sep) && path.basename(resolved).startsWith('SYNTHETIC-p6-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
