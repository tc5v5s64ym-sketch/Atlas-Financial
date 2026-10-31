'use strict';
// P6 offline foundation. No installation, key generation, provider or startup.
// Pins come from the official v1.3.2 archives after Sigsum verification; see
// the exact-head PR provenance receipt. No PATH lookup or plugin execution.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const AGE_VERSION = 'v1.3.2';
const PINS = Object.freeze({
  'win32-x64': Object.freeze({ archive: 'age-v1.3.2-windows-amd64.zip',
    archiveSha256: 'f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7',
    binarySha256: '2821a4ed191da07372acd302e5f6feae7a7985e285e1417765ebe74025af45f0',
    keygenSha256: '1549c7049be32695594bedd09bbd352a94b6013a9d5c43364f3c6cd7a09ab61c' }),
  'linux-x64': Object.freeze({ archive: 'age-v1.3.2-linux-amd64.tar.gz',
    archiveSha256: 'cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10',
    binarySha256: 'eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c',
    keygenSha256: '0a0009db842259d6717f7eeb30acb6b90d2a2eb924c6acd0a0db0ca1f1537899' }),
});
const error = () => new Error('age operation unavailable');
function need(ok) { if (!ok) throw error(); }
function noLinks(p) {
  let current = path.parse(p).root;
  for (const part of p.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    need(!fs.lstatSync(current).isSymbolicLink());
  }
}
function verifyAgeBinary(binaryPath) {
  try {
    need(typeof binaryPath === 'string' && path.isAbsolute(binaryPath) && !binaryPath.includes('\0'));
    const pin = PINS[process.platform + '-' + process.arch]; need(pin);
    noLinks(binaryPath);
    const before = fs.lstatSync(binaryPath);
    need(before.isFile() && before.nlink === 1 && before.size > 0 && before.size <= 64 * 1024 * 1024);
    const fd = fs.openSync(binaryPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const st = fs.fstatSync(fd);
      need(st.dev === before.dev && st.ino === before.ino && st.size === before.size);
      need(crypto.createHash('sha256').update(fs.readFileSync(fd)).digest('hex') === pin.binarySha256);
    } finally { fs.closeSync(fd); }
    return pin;
  } catch { throw error(); }
}

// Process primitive also exercised with explicitly labelled child doubles.
// onChunk is private staging's bounded synchronous file sink, never a logger.
function runBounded({ binaryPath, args, input, maxOutput, timeoutMs = 10000, onChunk }) {
  need(path.isAbsolute(binaryPath) && Array.isArray(args) && args.every(a => typeof a === 'string'));
  need(Buffer.isBuffer(input) && input.length <= 5 * 1024 * 1024);
  need(Number.isSafeInteger(maxOutput) && maxOutput > 0 && maxOutput <= 5 * 1024 * 1024);
  need(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
  return new Promise((resolve, reject) => {
    let child, timer, done = false, count = 0, diagnosticBytes = 0;
    const chunks = [];
    const finish = (ok) => {
      if (done) return; done = true; clearTimeout(timer);
      if (!ok) {
        try { child?.kill('SIGKILL'); } catch { /* no output accepted */ }
        child?.stdin?.destroy(); child?.stdout?.destroy(); child?.stderr?.destroy();
        for (const b of chunks) b.fill(0);
        reject(error());
      } else resolve(onChunk ? count : Buffer.concat(chunks, count));
    };
    try {
      // The only inherited OS value supports Windows process loading. No PATH,
      // HOME, agent/socket, identity, proxy, credential or Node injection env.
      const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, WINDIR: process.env.SystemRoot } : {};
      child = cp.spawn(binaryPath, args, { shell: false, windowsHide: true,
        cwd: path.dirname(binaryPath), env, stdio: ['pipe', 'pipe', 'pipe'] });
      timer = setTimeout(() => finish(false), timeoutMs);
      child.on('error', () => finish(false));
      child.stdin.on('error', () => finish(false));
      child.stdout.on('error', () => finish(false));
      child.stderr.on('error', () => finish(false));
      child.stdout.on('data', chunk => {
        if (done) return;
        count += chunk.length;
        if (count > maxOutput) return finish(false);
        try { if (onChunk) onChunk(chunk); else chunks.push(Buffer.from(chunk)); }
        catch { finish(false); }
      });
      // Discard diagnostics, including possible plaintext/private paths.
      child.stderr.on('data', chunk => { diagnosticBytes += chunk.length; if (diagnosticBytes > 8192) finish(false); });
      child.on('close', (code, signal) => finish(code === 0 && signal === null && count > 0));
      child.stdin.end(input);
    } catch { finish(false); }
  });
}
function runAge(options) { verifyAgeBinary(options.binaryPath); return runBounded(options); }

module.exports = Object.freeze({ AGE_VERSION, PINS, verifyAgeBinary, runBounded, runAge, noLinks });
