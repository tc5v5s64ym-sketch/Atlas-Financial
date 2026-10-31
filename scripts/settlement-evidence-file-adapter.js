'use strict';

// Settlement evidence file adapter (ATLAS-080) — the private POSIX
// filesystem persistence boundary for the merged settlement evidence
// store (scripts/settlement-evidence-store.js).
//
// FOUNDATION ONLY. This module ships with no production importer, no
// route, no default path, and no environment, network, or provisioning
// access. A caller supplies ONE explicitly named directory; the adapter
// supplies the store's local injected surfaces over it — documentStore,
// journalStore, quarantine, and the shared lock — so the store can
// persist document/journal/quarantine state through a real POSIX
// filesystem and a process restart. Pin and off-volume backup adapters
// are NOT implemented here: their independent authority must never be
// replaced by local files, and they stay injected by the caller.
//
// The directory must ALREADY EXIST and be owner-private. The adapter
// never creates or provisions it, never repairs its permissions, and
// never removes orphan locks. Path and file handling follow the
// incumbent private POSIX conventions of
// scripts/card-payment-decision-store.js:
//   - the root is validated before every use: POSIX only, absolute,
//     no symlinked component, no static-serving component name, no
//     repository/worktree containment in either direction, owner uid,
//     owner-private mode, and a stable dev/ino identity;
//   - target files are re-validated at read: regular file, not a
//     symlink, single link, owner uid, owner-private mode, size cap;
//   - writes are staged to an opaque temp file in the same directory,
//     fsynced, atomically renamed over the target, and the directory
//     is fsynced after rename/clear operations;
//   - the shared lock is an exclusive-create ('wx') lock file: a held
//     or leftover lock BLOCKS. It is never stolen, never aged out, and
//     never removed by anyone but its holder on release. Recovery from
//     an orphan lock is an out-of-band operator act, not this module's.
//
// Absence is the literal null (the store's adapter convention). The
// staged read doubles as the store's bootstrap absence evidence, so
// it reports a trace for every adapter-owned durable trace class —
// staged candidates, transient write artifacts, the document/journal
// files, a leftover lock, and retained quarantine evidence — and any
// inspection failure throws rather than reading as absence. Reads
// return fresh loader-owned byte copies; writes copy caller bytes.
// Malformed inputs are refused, never coerced. Windows filesystem
// security/durability is unqualified (the incumbent convention refuses
// it), and synthetic restart proof through this adapter is not Render
// redeploy durability.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const MAX_BYTES = 2 * 1024 * 1024;
const DOCUMENT_NAME = 'document.json';
const JOURNAL_NAME = 'journal.json';
const LOCK_NAME = 'store.lock';
const QUARANTINE_NAME = 'quarantine';
const TEMP_PREFIX = '.tmp-';
const STAGED_PREFIX = '.document-';

function fail(detail) {
  throw new Error('settlement-file-adapter: ' + detail);
}
function check(value, detail) { if (!value) fail(detail); }
const opaque = prefix => prefix + crypto.randomBytes(16).toString('hex');
function copyBytesArg(value, what) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError('settlement-file-adapter: ' + what + ' must be bytes');
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// --- Incumbent private-root validation (card-payment-decision-store) ----
function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
function moduleWorktreeRoots() {
  // Linked worktrees of the module's own repository, enumerated by
  // asking git about the module tree itself — never the caller's
  // working directory and never the supplied directory. A module tree
  // that is not itself a repository has no worktrees to enumerate, so
  // a clean "not a git repository" answer means the empty list. Any
  // other git failure (missing binary, unexpected error) leaves
  // membership unprovable and fails closed.
  let out;
  try {
    out = execFileSync('git', ['-C', ROOT, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e && e.status === 128 && /not a git repository/.test(String(e.stderr || ''))) return [];
    fail('repository or worktree state cannot be determined');
  }
  return out.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9));
}
function privateRoot(root) {
  // The incumbent POSIX private-store convention; Windows ACL/directory
  // durability is unqualified.
  check(process.platform !== 'win32' && typeof root === 'string' && path.isAbsolute(root),
    'directory must be an absolute POSIX path');
  root = path.resolve(root);
  let cursor = path.parse(root).root;
  for (const part of root.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    let partStat;
    try { partStat = fs.lstatSync(cursor); } catch {
      fail('directory does not exist or cannot be inspected');
    }
    check(!['public', 'static', 'www', 'wwwroot', 'htdocs'].includes(part.toLowerCase())
      && !partStat.isSymbolicLink(),
    'directory path crosses a static-serving or symlinked component');
  }
  for (let dir = root; ; dir = path.dirname(dir)) {
    check(!fs.existsSync(path.join(dir, '.git'))
      && !(fs.existsSync(path.join(dir, 'HEAD')) && fs.existsSync(path.join(dir, 'objects'))),
    'directory is inside a repository');
    if (dir === path.dirname(dir)) break;
  }
  check(![ROOT, ...moduleWorktreeRoots()].some(repo => within(repo, root) || within(root, repo)),
    'directory overlaps a repository or worktree');
  let stat;
  try { stat = fs.lstatSync(root); } catch {
    fail('directory does not exist or cannot be inspected');
  }
  check(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(),
    'directory must exist, be a directory, and be owner-private');
  return { root, dev: stat.dev, ino: stat.ino };
}

function createSettlementEvidenceFileAdapter(destination) {
  const checked = privateRoot(destination);
  const root = checked.root;
  const paths = Object.freeze({
    root,
    documentFile: path.join(root, DOCUMENT_NAME),
    journalFile: path.join(root, JOURNAL_NAME),
    lockFile: path.join(root, LOCK_NAME),
    quarantineDir: path.join(root, QUARANTINE_NAME),
  });

  // Re-validate the root's identity and durability on every operation,
  // exactly the incumbent directory() discipline.
  function directory() {
    const current = privateRoot(root);
    check(current.dev === checked.dev && current.ino === checked.ino,
      'directory identity changed');
    const fd = fs.openSync(root, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      check(stat.dev === checked.dev && stat.ino === checked.ino,
        'directory identity changed');
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }
  directory(); // Unsupported fsync fails before anything can be written.

  function checkTargetFile(stat, what) {
    check(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1
      && stat.uid === process.getuid() && (stat.mode & 0o077) === 0,
    what + ' is not an owner-private regular file');
    check(stat.size <= MAX_BYTES, what + ' exceeds the size bound');
  }
  // Bytes-or-null read with the incumbent target discipline. Absence is
  // the literal null; anything present but unusable fails closed.
  function readFileOrNull(file, what) {
    directory();
    let stat;
    try { stat = fs.lstatSync(file); } catch (e) {
      if (e && e.code === 'ENOENT') return null;
      fail(what + ' cannot be inspected');
    }
    checkTargetFile(stat, what);
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(fd);
      check(opened.dev === stat.dev && opened.ino === stat.ino && opened.nlink === 1,
        what + ' changed while being opened');
      return fs.readFileSync(fd); // a fresh Buffer: a loader-owned copy
    } finally { fs.closeSync(fd); }
  }
  // Stage bytes to an opaque temp file in the root, fsync, atomically
  // rename over the target, fsync the directory.
  function writeFileAtomic(file, bytes) {
    directory();
    const temp = path.join(root, opaque(TEMP_PREFIX));
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try {
      directory();
      fs.renameSync(temp, file);
      directory();
    } catch (e) {
      try { fs.unlinkSync(temp); } catch { /* residue is inert, never a target */ }
      throw e;
    }
  }
  function removeFile(file) {
    directory();
    try { fs.unlinkSync(file); } catch (e) {
      if (!e || e.code !== 'ENOENT') throw e;
    }
    directory();
  }
  function stagedNames() {
    return fs.readdirSync(root).filter(n => n.startsWith(STAGED_PREFIX)).sort();
  }

  const documentStore = {
    async read() {
      return readFileOrNull(paths.documentFile, 'document');
    },
    async readStaged() {
      directory();
      const entries = fs.readdirSync(root);
      const staged = entries.filter(n => n.startsWith(STAGED_PREFIX)).sort();
      if (staged.length) return readFileOrNull(path.join(root, staged[0]), 'staged document');
      // B1 (round 3): the store's bootstrap absence determination
      // consumes this read, so absence evidence must account for EVERY
      // adapter-owned durable trace class — not only staged candidates.
      // A transient journal-write artifact, the document/journal files,
      // a leftover lock this instance does not hold, and any retained
      // quarantine evidence each prove the directory is not pristine.
      // Unrelated operator files are not adapter-owned traces and are
      // ignored. Any inspection failure throws: the determination
      // stays unknown, never absence.
      const transient = entries.filter(n => n.startsWith(TEMP_PREFIX)).sort();
      if (transient.length) return readFileOrNull(path.join(root, transient[0]), 'transient artifact');
      if (entries.includes(DOCUMENT_NAME)) return readFileOrNull(paths.documentFile, 'document');
      if (entries.includes(JOURNAL_NAME)) return readFileOrNull(paths.journalFile, 'journal');
      if (entries.includes(LOCK_NAME) && !held) {
        return readFileOrNull(paths.lockFile, 'lock');
      }
      if (entries.includes(QUARANTINE_NAME)) {
        let qstat;
        try { qstat = fs.lstatSync(paths.quarantineDir); } catch {
          fail('quarantine directory cannot be inspected');
        }
        check(qstat.isDirectory() && !qstat.isSymbolicLink(),
          'quarantine path is not an inspectable directory');
        let qentries;
        try { qentries = fs.readdirSync(paths.quarantineDir); } catch {
          fail('quarantine directory cannot be inspected');
        }
        if (qentries.length) {
          qentries.sort();
          return readFileOrNull(path.join(paths.quarantineDir, qentries[0]), 'quarantine evidence');
        }
      }
      return null;
    },
    async writeTemp(bytes) {
      const copy = copyBytesArg(bytes, 'document temp');
      directory();
      // The staging slot is singular (the store's temp contract): a
      // prior staged candidate under the caller's lock is replaced.
      // Bootstrap refuses genesis over staged residue before any write
      // (the store reads readStaged first), so this never eats the
      // evidence that blocks genesis.
      for (const name of stagedNames()) {
        try { fs.unlinkSync(path.join(root, name)); } catch (e) {
          if (!e || e.code !== 'ENOENT') throw e;
        }
      }
      const temp = path.join(root, opaque(STAGED_PREFIX));
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, copy); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      directory();
    },
    async commitTemp() {
      directory();
      const names = stagedNames();
      check(names.length > 0, 'no staged document to commit');
      const temp = path.join(root, names[0]);
      checkTargetFile(fs.lstatSync(temp), 'staged document');
      fs.renameSync(temp, paths.documentFile);
      directory();
    },
    async discardTemp() {
      directory();
      for (const name of stagedNames()) {
        try { fs.unlinkSync(path.join(root, name)); } catch (e) {
          if (!e || e.code !== 'ENOENT') throw e;
        }
      }
      directory();
    },
  };

  const journalStore = {
    async read() {
      return readFileOrNull(paths.journalFile, 'journal');
    },
    async write(record) {
      // The store hands over the journal record; the durable journal is
      // its JSON serialization, byte-identical to the store suite's
      // doubles: Buffer.from(JSON.stringify(record)).
      if (!isRecord(record)) fail('journal write requires a record');
      writeFileAtomic(paths.journalFile, Buffer.from(JSON.stringify(record), 'utf8'));
    },
    async clear() {
      removeFile(paths.journalFile);
    },
  };

  const quarantine = {
    async put(label, bytes) {
      check(typeof label === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(label),
        'quarantine label is malformed');
      const copy = copyBytesArg(bytes, 'quarantine bytes');
      directory();
      // The quarantine subdirectory is the adapter's own layout inside
      // the already-validated root: created lazily on first use (never
      // at factory time), owner-private, and re-validated like the root.
      let qstat = null;
      try { qstat = fs.lstatSync(paths.quarantineDir); } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e;
      }
      if (qstat === null) {
        fs.mkdirSync(paths.quarantineDir, 0o700);
        directory(); // persist the new dirent
        qstat = fs.lstatSync(paths.quarantineDir);
      }
      check(qstat.isDirectory() && !qstat.isSymbolicLink()
        && qstat.uid === process.getuid() && (qstat.mode & 0o077) === 0,
      'quarantine directory is not owner-private');
      const name = label + '-' + crypto.randomBytes(16).toString('hex');
      const file = path.join(paths.quarantineDir, name);
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, copy); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const qfd = fs.openSync(paths.quarantineDir,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { fs.fsyncSync(qfd); } finally { fs.closeSync(qfd); }
      return name;
    },
  };

  // The shared lock: exclusive-create ('wx'), held for the whole
  // critical section, removed only by its holder on release. A held or
  // leftover lock blocks — it is never stolen or removed here.
  let held = false;
  const lock = {
    async withLock(fn) {
      check(typeof fn === 'function', 'withLock requires a function');
      check(!held, 'settlement store lock is already held by this adapter');
      held = true;
      try {
        directory();
        let gate;
        try {
          gate = fs.openSync(paths.lockFile, 'wx', 0o600);
        } catch (e) {
          if (e && e.code === 'EEXIST') fail('settlement store lock is held or leftover');
          throw e;
        }
        try {
          directory(); // persist the lock's dirent before proceeding
          return await fn();
        } finally {
          try { fs.closeSync(gate); } catch { /* already closed */ }
          try { fs.unlinkSync(paths.lockFile); } catch { /* holder release only */ }
        }
      } finally {
        held = false;
      }
    },
  };

  return { documentStore, journalStore, quarantine, lock, paths };
}

module.exports = { createSettlementEvidenceFileAdapter };
