'use strict';
/* Local Lunch Money credential resolver and one-time Windows bootstrap.
 *
 *   node scripts/local-credentials.js setup-lunchmoney
 *   node scripts/local-credentials.js setup-lunchmoney --replace
 *   node scripts/local-credentials.js remove-lunchmoney
 *
 * Resolution order: process.env.LUNCHMONEY_ACCESS_TOKEN, then (Windows only)
 * CurrentUser DPAPI at %LOCALAPPDATA%\Atlas-Financial\secrets\lunchmoney.dat.
 * The decrypted value stays in process memory for the GET-only Lunch Money
 * client. It is never printed, never placed in argv, and never written back
 * to the repository.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const readline = require('readline');

const TOKEN_ENV = 'LUNCHMONEY_ACCESS_TOKEN';
const PATH_ENV = 'ATLAS_LUNCHMONEY_CREDENTIAL_FILE';
const ROOT = path.join(__dirname, '..');
const DPAPI_SCRIPT = path.join(__dirname, 'windows-dpapi.ps1');
const DEFAULT_DIR_SEGMENTS = ['Atlas-Financial', 'secrets'];
const DEFAULT_FILE = 'lunchmoney.dat';

function fail(message) {
  const err = new Error(message);
  err.code = 'credential-failed';
  throw err;
}

function envToken(env) {
  const raw = env && env[TOKEN_ENV];
  if (raw == null) return null;
  const token = String(raw);
  return token === '' ? null : token;
}

function defaultCredentialPath(env) {
  const source = env || process.env;
  if (source[PATH_ENV]) return path.resolve(String(source[PATH_ENV]));
  const localAppData = source.LOCALAPPDATA;
  if (!localAppData) return null;
  return path.join(localAppData, ...DEFAULT_DIR_SEGMENTS, DEFAULT_FILE);
}

function credentialPath(options) {
  if (options && options.credentialPath) return path.resolve(options.credentialPath);
  return defaultCredentialPath(options && options.env ? options.env : process.env);
}

function pathIsOutsideRepo(file, root) {
  if (!file) return false;
  const resolved = path.resolve(file);
  const repo = path.resolve(root || ROOT) + path.sep;
  return !resolved.toLowerCase().startsWith(repo.toLowerCase());
}

function powershellPath(options) {
  if (options && options.powershellPath) return options.powershellPath;
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function tokensEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function scrubSecret(text, secret) {
  if (text == null) return '';
  let out = String(text);
  if (secret) {
    const value = String(secret);
    if (value) out = out.split(value).join('[redacted]');
  }
  return out;
}

function closedError() {
  const err = new Error('Windows local credential operation failed.');
  err.code = 'credential-failed';
  return err;
}

function runDpapi(mode, filePath, stdin, options) {
  const execFileFn = (options && options.execFile) || execFile;
  const script = (options && options.dpapiScript) || DPAPI_SCRIPT;
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass',
    '-File', script,
    '-Mode', mode,
    '-Path', filePath,
  ];
  if (stdin != null && args.includes(String(stdin))) {
    fail('Windows local credential operation failed.');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err, stdout) => {
      if (settled) return;
      settled = true;
      if (err) reject(closedError());
      else resolve(stdout);
    };
    let child;
    try {
      child = execFileFn(
        powershellPath(options),
        args,
        {
          windowsHide: true,
          encoding: 'buffer',
          maxBuffer: 1024 * 1024,
          timeout: 15000,
        },
        (err, stdout) => finish(err, stdout)
      );
    } catch (err) {
      finish(err);
      return;
    }
    if (!child || !child.stdin) {
      finish(new Error('no-stdin'));
      return;
    }
    child.stdin.on('error', () => {});
    if (stdin != null) child.stdin.end(Buffer.isBuffer(stdin) ? stdin : Buffer.from(String(stdin), 'utf8'));
    else child.stdin.end();
  });
}

async function readWindowsStoredCredential(options) {
  const file = credentialPath(options);
  if (!file) fail('LUNCHMONEY_ACCESS_TOKEN is not set and local credential bootstrap has not been completed. Run: node scripts/local-credentials.js setup-lunchmoney');
  if (!fs.existsSync(file)) return null;
  let stdout;
  try {
    stdout = await runDpapi('unprotect', file, null, options);
  } catch (err) {
    fail('Local Lunch Money credential could not be read.');
  }
  const token = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
  if (!token) fail('Local Lunch Money credential could not be read.');
  return token;
}

async function writeWindowsStoredCredential(token, options) {
  const file = credentialPath(options);
  if (!file) fail('Windows local credential path is not available.');
  if (!pathIsOutsideRepo(file, options && options.root)) {
    fail('Local Lunch Money credential path must be outside the repository.');
  }
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  await runDpapi('protect', file, token, options);
}

async function resolveLunchMoneyAccessToken(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const fromEnv = envToken(env);
  if (fromEnv) return { token: fromEnv, source: 'env' };

  if (platform !== 'win32') {
    fail('LUNCHMONEY_ACCESS_TOKEN is not set. Windows local credential fallback is not available on this system.');
  }

  const readStored = opts.readStored || readWindowsStoredCredential;
  let stored;
  try {
    stored = await readStored(opts);
  } catch (err) {
    if (err && err.code === 'credential-failed') throw err;
    fail('Local Lunch Money credential could not be read.');
  }
  if (!stored) {
    fail('LUNCHMONEY_ACCESS_TOKEN is not set and local credential bootstrap has not been completed. Run: node scripts/local-credentials.js setup-lunchmoney');
  }
  return { token: stored, source: 'windows-dpapi' };
}

function parseArgs(argv) {
  const out = { command: null, replace: false, help: false };
  for (const a of argv || []) {
    if (a === '--replace') out.replace = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) fail(`Unknown option: ${a}`);
    else if (!out.command) out.command = a;
    else fail('Unexpected argument.');
  }
  return out;
}

function usage() {
  return [
    'Usage: node scripts/local-credentials.js setup-lunchmoney [--replace]',
    '       node scripts/local-credentials.js remove-lunchmoney',
    '',
    'Stores the Lunch Money GET-only token as a Windows CurrentUser DPAPI blob',
    'at %LOCALAPPDATA%\\Atlas-Financial\\secrets\\lunchmoney.dat.',
    'LUNCHMONEY_ACCESS_TOKEN in the environment still takes precedence.',
  ].join('\n') + '\n';
}

function promptHidden(question, io) {
  const stdin = (io && io.stdin) || process.stdin;
  const stdout = (io && io.stdout) || process.stdout;
  if (typeof stdin.isTTY === 'boolean' && !stdin.isTTY) {
    fail('LUNCHMONEY_ACCESS_TOKEN is not set and stdin is not a terminal. Set the environment variable once and re-run setup from this machine.');
  }
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    stdin.setRawMode && stdin.setRawMode(true);
    stdout.write(question);
    let buf = '';
    const onData = (ch) => {
      const s = String(ch);
      if (s === '\u0003') {
        cleanup();
        reject(new Error('setup cancelled'));
        return;
      }
      if (s === '\r' || s === '\n' || s === '\u0004') {
        cleanup();
        stdout.write('\n');
        resolve(buf);
        return;
      }
      if (s === '\u007f' || s === '\b') {
        buf = buf.slice(0, -1);
        return;
      }
      if (s === '\u0015') {
        buf = '';
        return;
      }
      if (s.charCodeAt(0) < 32) return;
      buf += s;
    };
    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode && stdin.setRawMode(false);
      rl.close();
    }
    stdin.on('data', onData);
  });
}

async function setupLunchMoney(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    fail('Windows local credential storage is only available on Windows.');
  }
  const file = credentialPath(opts);
  if (!file) fail('Windows local credential path is not available. LOCALAPPDATA is required.');
  if (!pathIsOutsideRepo(file, opts.root)) {
    fail('Local Lunch Money credential path must be outside the repository.');
  }
  if (fs.existsSync(file) && !opts.replace) {
    fail('A local Lunch Money credential already exists. Re-run with --replace to overwrite it.');
  }
  let token = envToken(env);
  if (!token) {
    const prompt = opts.prompt || promptHidden;
    token = await prompt('Lunch Money access token (input hidden): ', opts.io);
  }
  if (!token) fail('No Lunch Money credential was supplied.');
  const writeStored = opts.writeStored || writeWindowsStoredCredential;
  const readStored = opts.readStored || readWindowsStoredCredential;
  try {
    await writeStored(token, opts);
    const recovered = await readStored(opts);
    if (!recovered || !tokensEqual(recovered, token)) {
      fail('Local credential verification failed.');
    }
  } catch (err) {
    if (err && err.code === 'credential-failed') throw err;
    fail('Local credential verification failed.');
  }
  return { ok: true, path: file };
}

function removeLunchMoney(options) {
  const opts = options || {};
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    fail('Windows local credential storage is only available on Windows.');
  }
  const file = credentialPath(opts);
  if (!file || !fs.existsSync(file)) return { ok: true, removed: false, path: file };
  fs.unlinkSync(file);
  return { ok: true, removed: true, path: file };
}

async function selftestDpapi(options) {
  const opts = Object.assign({}, options);
  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    fail('Windows DPAPI self-test is only available on Windows.');
  }
  const dummy = opts.dummy || crypto.randomBytes(24).toString('hex');
  const dir = opts.dir || path.join(
    (opts.env && opts.env.LOCALAPPDATA) || process.env.LOCALAPPDATA || os.tmpdir(),
    ...DEFAULT_DIR_SEGMENTS
  );
  const file = opts.credentialPath || path.join(dir, 'dpapi-selftest.dat');
  opts.credentialPath = file;
  try {
    await writeWindowsStoredCredential(dummy, opts);
    const recovered = await readWindowsStoredCredential(opts);
    if (!recovered || !tokensEqual(recovered, dummy)) fail('Local credential verification failed.');
    return { ok: true, path: file };
  } finally {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
  }
}

async function run(argv, options) {
  const args = parseArgs(argv);
  const out = (options && options.stdout) || process.stdout;
  if (args.help || !args.command) {
    out.write(usage());
    return args.command ? 1 : 0;
  }
  if (args.command === 'setup-lunchmoney') {
    const result = await setupLunchMoney(Object.assign({}, options, { replace: args.replace }));
    out.write('Lunch Money local credential stored.\n');
    out.write(`Encrypted file: ${result.path}\n`);
    return 0;
  }
  if (args.command === 'remove-lunchmoney') {
    const result = removeLunchMoney(options);
    out.write(result.removed
      ? 'Local Lunch Money credential removed.\n'
      : 'No local Lunch Money credential was present.\n');
    return 0;
  }
  if (args.command === 'selftest-dpapi') {
    await selftestDpapi(options);
    out.write('Windows DPAPI dummy self-test passed.\n');
    return 0;
  }
  fail(`Unknown command: ${args.command}`);
}

const api = {
  TOKEN_ENV,
  PATH_ENV,
  DPAPI_SCRIPT,
  ROOT,
  defaultCredentialPath,
  credentialPath,
  pathIsOutsideRepo,
  envToken,
  tokensEqual,
  scrubSecret,
  resolveLunchMoneyAccessToken,
  readWindowsStoredCredential,
  writeWindowsStoredCredential,
  setupLunchMoney,
  removeLunchMoney,
  selftestDpapi,
  parseArgs,
  run,
};

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`${err && err.message ? err.message : 'credential command failed'}\n`);
    process.exit(1);
  });
} else {
  module.exports = api;
}
