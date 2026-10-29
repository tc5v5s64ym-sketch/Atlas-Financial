'use strict';
// Process-control doubles only. Node child programs are NOT age crypto proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../scripts/settlement-evidence-age-process');
const E = require('../scripts/settlement-evidence-age-encrypt');
const run = (code, more = {}) => A.runBounded({ binaryPath: process.execPath,
  args: ['-e', code], input: Buffer.from('SYNTHETIC_PLAINTEXT_SENTINEL'), maxOutput: 1024, timeoutMs: 2000, ...more });

test('process primitive accepts complete output only on exit zero; stderr is never surfaced', async () => {
  assert.equal((await run('process.stdin.resume();process.stdin.on("end",()=>{process.stderr.write("SYNTHETIC_DIAGNOSTIC");process.stdout.write("complete")})')).toString(), 'complete');
  await assert.rejects(run('process.stdout.write("SYNTHETIC_PARTIAL");process.stderr.write("SYNTHETIC_SECRET");process.exitCode=7'), { message: 'age operation unavailable' });
  await assert.rejects(run('process.exit(0)'), { message: 'age operation unavailable' });
});

test('output/stderr bounds, timeout, spawn failure and sink failure fail closed', async () => {
  await assert.rejects(run('process.stdout.write(Buffer.alloc(2048))'));
  await assert.rejects(run('process.stderr.write(Buffer.alloc(9000));process.stdout.write("x")'));
  await assert.rejects(run('setInterval(()=>{},1000)', { timeoutMs: 50 }));
  await assert.rejects(run('', { binaryPath: process.execPath + '.missing' }));
  await assert.rejects(run('process.stdout.write("x")', { onChunk() { throw Error('SYNTHETIC_PRIVATE_SINK'); } }), { message: 'age operation unavailable' });
});

test('spawn supplies only OS loader environment; child receives no caller secret or injection', async t => {
  const name = 'ATLAS_P6_SYNTHETIC_ENV'; process.env[name] = 'SYNTHETIC_ENV_SENTINEL';
  const cp = require('node:child_process'), original = cp.spawn;
  t.mock.method(cp, 'spawn', (exe, args, options) => {
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.deepEqual(Object.keys(options.env), process.platform === 'win32' ? ['SystemRoot', 'WINDIR'] : []);
    return original(exe, args, options);
  });
  // Windows may add OS profile/default variables at process creation. They
  // are not inherited application configuration; native-only age uses no PATH.
  try { assert.equal((await run('process.stdout.write(JSON.stringify(Object.keys(process.env).filter(k=>/ATLAS_P6|NODE_OPTIONS|NODE_PATH|SSH_AUTH_SOCK|AGE_/i.test(k))))')).toString(), '[]'); }
  finally { delete process.env[name]; t.mock.restoreAll(); }
});

test('recipient-only configuration and official digest fail closed before tool use', () => {
  for (const recipient of [undefined, '', 'ssh-ed25519 invalid', 'age1invalid', 'AGE' + '-SECRET-KEY-PQ-1INVALID', '--plugin-name=bad'])
    assert.throws(() => E.createAgeEncryptor({ binaryPath: process.execPath, recipient }));
  assert.throws(() => E.createAgeEncryptor({ binaryPath: process.execPath, recipient: 'age1pq1' + 'q'.repeat(1950), identity: 'SYNTHETIC' }));
  assert.throws(() => A.verifyAgeBinary('age'));
  assert.throws(() => A.verifyAgeBinary(process.execPath));
  assert.throws(() => E.copyBytes(Buffer.alloc(0), 10));
  assert.throws(() => E.copyBytes(Buffer.alloc(11), 10));
  assert.throws(() => E.copyBytes(new Uint8Array(new SharedArrayBuffer(2)), 10));
  let calls = 0; const bytes = Buffer.from('abc'); Object.defineProperty(bytes, 'byteLength', { get() { calls++; throw Error(); } });
  assert.equal(E.copyBytes(bytes, 10).toString(), 'abc'); assert.equal(calls, 0);
});
