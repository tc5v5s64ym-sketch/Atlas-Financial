'use strict';
// Explicit owner-side OFFLINE helper. No CLI installer invocation, target,
// connection, pin adoption/advance or reopen. Anchors must be independently
// trusted/current; a validated pair proves neither freshness nor custody.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const A = require('./settlement-evidence-age-process');
const { copyBytes } = require('./settlement-evidence-age-encrypt');
const V = require('./settlement-evidence-restore-input');
const TC = require('./settlement-evidence-terminal-certificate');
const fail = () => new Error('owner age preparation unavailable');
function need(ok) { if (!ok) throw fail(); }
function privateOnOS(p) {
  const st = fs.lstatSync(p);
  if (process.platform !== 'win32') return st.uid === process.getuid() && (st.mode & 0o077) === 0;
  // Metadata check only. Same policy as the existing owner restore command:
  // owner SID only, allow rules only; never changes an existing permission.
  const root = process.env.SystemRoot; need(typeof root === 'string' && path.isAbsolute(root));
  const script = "$ErrorActionPreference='Stop';$p=$env:ATLAS_AGE_ACL_PATH;$s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=Get-Acl -LiteralPath $p;$r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));$ok=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $s -and $r.Count -gt 0;foreach($x in $r){if($x.IdentityReference.Value -ne $s -or $x.AccessControlType -ne 'Allow'){$ok=$false}};if($ok){'true'}else{'false'}";
  return cp.execFileSync(path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { env: { SystemRoot: root, WINDIR: root, ATLAS_AGE_ACL_PATH: p },
      windowsHide: true, timeout: 5000, maxBuffer: 512, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() === 'true';
}
const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r); };
function privateRoot(p) {
  need(typeof p === 'string' && path.isAbsolute(p)); p = path.resolve(p);
  const repo = path.resolve(__dirname, '..');
  need(p !== repo && !inside(repo, p) && !inside(p, repo));
  A.noLinks(p); need(fs.lstatSync(p).isDirectory() && privateOnOS(p));
  // Refuse any enclosing checkout (including another linked worktree).
  for (let d = p; ; d = path.dirname(d)) { need(!fs.existsSync(path.join(d, '.git'))); if (d === path.dirname(d)) break; }
  return p;
}
function readPrivate(p, max) {
  A.noLinks(p); const before = fs.lstatSync(p);
  need(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= max && privateOnOS(p));
  const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const st = fs.fstatSync(fd); need(st.dev === before.dev && st.ino === before.ino && st.nlink === 1 && st.size <= max);
    const b = fs.readFileSync(fd); need(b.length === st.size); return b;
  } finally { fs.closeSync(fd); }
}
function absent(p) { try { fs.lstatSync(p); throw fail(); } catch (e) { if (e.code !== 'ENOENT') throw fail(); } }

async function prepareOwnerCandidates({ binaryPath, privateRoot: rootInput, identityFile, archives, domain, anchors, timeoutMs = 10000 }) {
  let root, lock, lockFd, lockStat, identity, ledgerBytes, historyBytes;
  const partials = [], promoted = [];
  try {
    A.verifyAgeBinary(binaryPath);
    root = privateRoot(rootInput);
    need(typeof identityFile === 'string' && /^[a-z][a-z0-9-]{0,63}\.txt$/.test(identityFile));
    const identityPath = path.join(root, identityFile);
    // Only the private file's path reaches args, never identity contents or
    // environment. Only native unencrypted hybrid identities here;
    // encrypted backup unlock is a separate owner custody operation.
    identity = readPrivate(identityPath, 16384);
    const keys = identity.toString('utf8').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    need(keys.length === 1 && /^AGE-SECRET-KEY-PQ-1[0-9A-Z]+$/.test(keys[0]));
    const trusted = TC.own({ domain, anchors });
    const encrypted = { ledger: copyBytes(archives.ledgerBytes, 5 * 1024 * 1024), history: copyBytes(archives.historyBytes, 5 * 1024 * 1024) };
    // A stale/existing pair is never replaced, even if this input validates.
    for (const name of ['ledger.json', 'history.json', 'ledger.json.partial', 'history.json.partial']) absent(path.join(root, name));
    lock = path.join(root, '.age-prepare.lock');
    lockFd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    lockStat = fs.fstatSync(lockFd);
    need(privateOnOS(lock));
    for (const [kind, cap] of [['ledger', 2 * 1024 * 1024], ['history', 4 * 1024 * 1024]]) {
      need(privateRoot(root) === root);
      const p = path.join(root, kind + '.json.partial');
      const fd = fs.openSync(p, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
      const record = { p, fd, st: fs.fstatSync(fd) }; partials.push(record);
      need(record.st.nlink === 1 && privateOnOS(p));
      // --identity file path is nonsecret; age reads it itself. Recheck exact
      // private file before each child. No shell, -o or output-path overwrite.
      const currentIdentity = readPrivate(identityPath, 16384);
      try { need(currentIdentity.equals(identity)); } finally { currentIdentity.fill(0); }
      await A.runAge({ binaryPath, args: ['--decrypt', '--identity', identityPath], input: encrypted[kind], maxOutput: cap, timeoutMs,
        onChunk(chunk) { fs.writeFileSync(fd, chunk); } });
      fs.fsyncSync(fd);
      const st = fs.lstatSync(p); need(st.dev === record.st.dev && st.ino === record.st.ino && st.nlink === 1 && st.size <= cap);
      const bytes = Buffer.alloc(st.size); need(fs.readSync(fd, bytes, 0, bytes.length, 0) === bytes.length);
      if (kind === 'ledger') ledgerBytes = bytes; else historyBytes = bytes;
    }
    const validation = V.validateRestoreInput({ ...trusted, candidate: { ledgerBytes, historyBytes } });
    need(validation.status === 'valid');
    need(privateRoot(root) === root);
    for (const record of partials) {
      const dest = record.p.slice(0, -'.partial'.length);
      // Atomic no-replace link; rename() can replace an existing destination.
      // Rollback removes only our own inode if the second publication fails.
      const s = fs.lstatSync(record.p);
      need(!s.isSymbolicLink() && s.dev === record.st.dev && s.ino === record.st.ino && s.nlink === 1 && privateOnOS(record.p));
      fs.linkSync(record.p, dest); promoted.push({ p: dest, st: record.st });
      const published = fs.lstatSync(dest); need(published.dev === s.dev && published.ino === s.ino);
    }
    for (const record of partials) { fs.closeSync(record.fd); record.fd = null; fs.unlinkSync(record.p); }
    for (const { p } of promoted) need(fs.lstatSync(p).nlink === 1 && privateOnOS(p));
    return Object.freeze({ status: 'prepared', candidate: Object.freeze({ ledgerFile: 'ledger.json', historyFile: 'history.json' }),
      qualified: false, reopen: false, latestness: 'caller-supplied-not-proved' });
  } catch {
    for (const { p, st } of promoted) { try { const s = fs.lstatSync(p); if (s.dev === st.dev && s.ino === st.ino) fs.unlinkSync(p); } catch { /* preserve foreign state */ } }
    throw fail();
  } finally {
    identity?.fill(0); ledgerBytes?.fill(0); historyBytes?.fill(0);
    for (const r of partials) { try { if (r.fd !== null) fs.closeSync(r.fd); } catch {} try { const s = fs.lstatSync(r.p); if (s.dev === r.st.dev && s.ino === r.st.ino) fs.unlinkSync(r.p); } catch {} }
    if (lockFd !== undefined) { try { fs.closeSync(lockFd); } catch {} try {
      const s = fs.lstatSync(lock); if (lockStat && s.dev === lockStat.dev && s.ino === lockStat.ino) fs.unlinkSync(lock);
    } catch {} }
  }
}
module.exports = Object.freeze({ prepareOwnerCandidates });
