'use strict';
/* Local Lunch Money credential resolver. No real provider token is used. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./scripts/local-credentials.js');
const O = require('./scripts/provider-observe.js');

const ROOT = __dirname;
const DUMMY = 'atlas-dummy-not-a-real-token';
const OTHER = 'atlas-dummy-replacement-token';
const CLI = path.join(ROOT, 'scripts', 'local-credentials.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cred-'));
}

function capture(fn) {
  let threw = false;
  let message = '';
  let result = null;
  return Promise.resolve()
    .then(fn)
    .then((value) => { result = value; })
    .catch((err) => {
      threw = true;
      message = String(err && err.message || err);
    })
    .then(() => ({ threw, message, result }));
}

function fakeExecFile(store) {
  return function execFileFake(file, args, opts, cb) {
    store.calls.push({ file, args: args.slice() });
    const child = {
      stdin: {
        chunks: [],
        on() { return this; },
        end(buf) {
          this.chunks.push(buf);
          const modeIdx = args.indexOf('-Mode');
          const pathIdx = args.indexOf('-Path');
          const mode = modeIdx >= 0 ? args[modeIdx + 1] : null;
          const target = pathIdx >= 0 ? args[pathIdx + 1] : null;
          process.nextTick(() => {
            if (store.fail) {
              const err = new Error(store.failMessage || 'dpapi-fail');
              cb(err, Buffer.from(store.failStdout || ''), Buffer.from(store.failStderr || 'dpapi-error'));
              return;
            }
            if (mode === 'protect') {
              const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf || ''), 'utf8');
              store.plain = bytes.toString('utf8');
              if (target) fs.writeFileSync(target, Buffer.from('dpapi-blob'));
              cb(null, Buffer.from(''), Buffer.from(''));
              return;
            }
            if (mode === 'unprotect') {
              if (store.corrupt) {
                cb(new Error('unprotect-fail'), Buffer.from(''), Buffer.from('cannot decrypt'));
                return;
              }
              cb(null, Buffer.from(store.plain || DUMMY), Buffer.from(''));
              return;
            }
            cb(new Error('unknown-mode'), Buffer.from(''), Buffer.from(''));
          });
        },
      },
    };
    store.children.push(child);
    return child;
  };
}

function isolatedEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.LUNCHMONEY_ACCESS_TOKEN;
  return Object.assign(env, extra || {});
}

(async () => {
  console.log('=== 1. env token takes precedence ===');
  {
    let storedCalled = false;
    const resolved = await C.resolveLunchMoneyAccessToken({
      env: { LUNCHMONEY_ACCESS_TOKEN: DUMMY },
      platform: 'win32',
      readStored: async () => { storedCalled = true; return OTHER; },
    });
    ok(resolved.source === 'env', 'source is env');
    ok(resolved.token === DUMMY, 'env token is returned');
    ok(!storedCalled, 'Windows store is not read when env is set');
  }

  console.log('=== 2. Windows stored credential is used when env token is absent ===');
  {
    const resolved = await C.resolveLunchMoneyAccessToken({
      env: isolatedEnv(),
      platform: 'win32',
      readStored: async () => DUMMY,
    });
    ok(resolved.source === 'windows-dpapi', 'source is windows-dpapi');
    ok(resolved.token === DUMMY, 'stored token is returned');
  }

  console.log('=== 3. missing local credential fails closed ===');
  {
    const missing = await capture(() => C.resolveLunchMoneyAccessToken({
      env: isolatedEnv({ ATLAS_LUNCHMONEY_CREDENTIAL_FILE: path.join(os.tmpdir(), 'atlas-absent-lunchmoney.dat') }),
      platform: 'win32',
    }));
    ok(missing.threw, 'missing store throws');
    ok(/local credential bootstrap has not been completed/.test(missing.message),
      'missing store names bootstrap');
    ok(!missing.message.includes(DUMMY), 'missing-store error does not contain a dummy token');
  }

  console.log('=== 4. corrupt/unreadable credential fails closed ===');
  {
    const dir = tempDir();
    const file = path.join(dir, 'lunchmoney.dat');
    fs.writeFileSync(file, Buffer.from('not-a-dpapi-blob'));
    const store = { calls: [], children: [], corrupt: true };
    const bad = await capture(() => C.resolveLunchMoneyAccessToken({
      env: isolatedEnv({ ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      execFile: fakeExecFile(store),
    }));
    ok(bad.threw, 'corrupt store throws');
    ok(/could not be read/.test(bad.message), 'corrupt store fails closed');
    ok(!/not-a-dpapi-blob/.test(bad.message), 'corrupt error does not echo the blob');
    ok(!bad.message.includes(DUMMY), 'corrupt error does not contain a token');
  }

  console.log('=== 5. non-Windows does not attempt local Windows fallback ===');
  {
    let storedCalled = false;
    const linux = await capture(() => C.resolveLunchMoneyAccessToken({
      env: isolatedEnv(),
      platform: 'linux',
      readStored: async () => { storedCalled = true; return DUMMY; },
    }));
    ok(linux.threw, 'non-Windows without env throws');
    ok(/Windows local credential fallback is not available/.test(linux.message),
      'non-Windows names the missing fallback');
    ok(!storedCalled, 'non-Windows does not read a Windows store');
  }

  console.log('=== 6-8. token never appears in output, errors, or PowerShell argv ===');
  {
    const dir = tempDir();
    const file = path.join(dir, 'lunchmoney.dat');
    const store = { calls: [], children: [], plain: DUMMY };
    fs.writeFileSync(file, Buffer.from('dpapi-blob'));
    const resolved = await C.resolveLunchMoneyAccessToken({
      env: isolatedEnv({ ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      execFile: fakeExecFile(store),
    });
    ok(resolved.source === 'windows-dpapi', 'resolver used the injected Windows store');
    const argvBlob = JSON.stringify(store.calls.map(c => c.args));
    ok(!argvBlob.includes(DUMMY), 'PowerShell argv does not contain the token');
    ok(store.calls.every(c => c.args.includes('-NoProfile') && c.args.includes('-NonInteractive')),
      'PowerShell is non-interactive and without a profile');
    ok(store.calls.every(c => c.args.includes('-File') && c.args.includes(C.DPAPI_SCRIPT)),
      'PowerShell is invoked with -File, not a shell-expanded command string');
    ok(!store.calls.some(c => c.args.includes(DUMMY)), 'no argv element is the token');

    const setupStore = { calls: [], children: [] };
    const setup = await C.setupLunchMoney({
      env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: DUMMY, ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      replace: true,
      execFile: fakeExecFile(setupStore),
      root: ROOT,
    });
    ok(setup.ok, 'setup from env succeeds');
    const setupArgv = JSON.stringify(setupStore.calls.map(c => c.args));
    ok(!setupArgv.includes(DUMMY), 'setup PowerShell argv does not contain the token');
    const protect = setupStore.calls.find(c => c.args.includes('protect'));
    ok(protect && protect.args.includes('-Path') && protect.args.includes(file),
      'protect child receives only the destination path');
    const stdinSent = setupStore.children.some(ch => ch.stdin.chunks.some(buf => String(buf) === DUMMY));
    ok(stdinSent, 'protect child receives the token on stdin, not argv');

    let printed = '';
    await C.run(['setup-lunchmoney', '--replace'], {
      env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: DUMMY, ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      execFile: fakeExecFile({ calls: [], children: [] }),
      root: ROOT,
      prompt: async () => { throw new Error('prompt-should-not-run'); },
      stdout: { write(s) { printed += s; } },
    });
    ok(/Lunch Money local credential stored/.test(printed), 'setup reports success');
    ok(!printed.includes(DUMMY), 'setup stdout does not contain the token');
    ok(!/token length|prefix|suffix|sha|hash|fingerprint/i.test(printed),
      'setup stdout does not report token-derived fingerprints');
  }

  console.log('=== 9. bootstrap refuses silent overwrite ===');
  {
    const dir = tempDir();
    const file = path.join(dir, 'lunchmoney.dat');
    fs.writeFileSync(file, Buffer.from('existing'));
    const blocked = await capture(() => C.setupLunchMoney({
      env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: DUMMY, ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      replace: false,
      execFile: fakeExecFile({ calls: [], children: [] }),
      root: ROOT,
    }));
    ok(blocked.threw, 'setup without --replace throws');
    ok(/already exists/.test(blocked.message) && /--replace/.test(blocked.message),
      'refusal names the explicit replace option');
    ok(fs.readFileSync(file).equals(Buffer.from('existing')), 'existing blob is not replaced');
  }

  console.log('=== 10. bootstrap can explicitly replace ===');
  {
    const dir = tempDir();
    const file = path.join(dir, 'lunchmoney.dat');
    fs.writeFileSync(file, Buffer.from('existing'));
    const replaced = await C.setupLunchMoney({
      env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: OTHER, ATLAS_LUNCHMONEY_CREDENTIAL_FILE: file }),
      platform: 'win32',
      replace: true,
      execFile: fakeExecFile({ calls: [], children: [] }),
      root: ROOT,
    });
    ok(replaced.ok, 'setup --replace succeeds');
    ok(fs.existsSync(file), 'replaced blob exists');
  }

  console.log('=== 11. resulting secret path is outside the repo ===');
  {
    const def = C.defaultCredentialPath({ LOCALAPPDATA: 'C:\\Users\\dnaud\\AppData\\Local' });
    ok(!!def, 'default path is constructed from LOCALAPPDATA');
    ok(C.pathIsOutsideRepo(def, ROOT), 'default DPAPI path is outside the repository');
    ok(/Atlas-Financial[\\/]secrets[\\/]lunchmoney\\.dat$/i.test(def),
      'default file is Atlas-Financial/secrets/lunchmoney.dat');
    const live = C.defaultCredentialPath(process.env);
    if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
      ok(C.pathIsOutsideRepo(live, ROOT), 'HOME-PC default path is outside the repo');
    } else {
      ok(true, 'non-Windows CI has no LOCALAPPDATA default to prove');
    }
    const inside = await capture(() => C.setupLunchMoney({
      env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: DUMMY, ATLAS_LUNCHMONEY_CREDENTIAL_FILE: path.join(ROOT, 'lunchmoney.dat') }),
      platform: 'win32',
      replace: true,
      execFile: fakeExecFile({ calls: [], children: [] }),
      root: ROOT,
    }));
    ok(inside.threw, 'setup refuses a path inside the repository');
    ok(/outside the repository/.test(inside.message), 'in-repo path is named as the defect');
  }

  console.log('=== observer and CLI inherit the resolver ===');
  {
    const resolved = await O.resolveLiveCredential({
      env: { LUNCHMONEY_ACCESS_TOKEN: DUMMY },
      platform: 'linux',
      readStored: async () => OTHER,
    });
    ok(resolved.source === 'env', 'provider-observe env resolution matches the credential module');
    const token = await O.resolveLiveToken({
      env: isolatedEnv(),
      platform: 'win32',
      readStored: async () => DUMMY,
    });
    ok(token === DUMMY, 'provider-observe Windows fallback returns the stored token');
  }

  console.log('=== CLI error output never includes the token ===');
  {
    if (process.platform === 'win32') {
      ok(true, 'Windows CLI setup is exercised in the DPAPI section, not this Linux fail-closed check');
    } else {
      let stderr = '';
      try {
        execFileSync(process.execPath, [CLI, 'setup-lunchmoney'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: isolatedEnv({ LUNCHMONEY_ACCESS_TOKEN: DUMMY }),
        });
      } catch (e) {
        stderr = String(e.stderr || e.stdout || e.message || '');
      }
      ok(/only available on Windows/.test(stderr), 'non-Windows setup CLI fails closed');
      ok(!stderr.includes(DUMMY), 'CLI error output does not contain the env token');
    }
  }

  if (process.platform === 'win32') {
    console.log('=== Windows DPAPI dummy integration (real CurrentUser protect/unprotect) ===');
    const dir = tempDir();
    const file = path.join(dir, 'dpapi-selftest.dat');
    let printed = '';
    try {
      const result = await C.selftestDpapi({
        dummy: DUMMY,
        credentialPath: file,
        stdout: { write(s) { printed += s; } },
      });
      ok(result.ok, 'dummy DPAPI round-trip succeeded');
      ok(!fs.existsSync(file), 'dummy blob was removed');
      ok(!printed.includes(DUMMY), 'self-test produced no dummy token output');
    } catch (err) {
      ok(false, 'dummy DPAPI round-trip succeeded', err && err.message ? 'error omitted' : '');
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch (_) {}
    }
  } else {
    console.log('=== Windows DPAPI dummy integration skipped (not Windows) ===');
    ok(true, 'Linux CI does not pretend to exercise Windows DPAPI');
  }

  if (failures) {
    console.log(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nAll local credential checks passed.');
})().catch((err) => {
  console.log('  FAIL  local credential suite crashed without printing secrets');
  process.exit(1);
});
