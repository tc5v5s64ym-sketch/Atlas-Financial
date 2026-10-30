'use strict';
// Plan #6 A12 combined-path proof, File 1 of 3 — TEST ONLY.
// Acceptance matrix row A12 (#765 comment 6480259704): "Actual host
// entry no-config/partial-config/suspending double: inactive default,
// invalid partial boot refusal, safe fresh connection only before
// operation begins, unknown-write/controller state preserved. No
// automatic replay." Scope packet #787 comment 6508539468 as corrected
// by Atlas's ruling 6508634090; dispatch 6508755098.
//
// Launches the REAL production entry (`node server.js`, the
// require.main === module branch) in isolated child processes. No
// injection seam is added or used: the child receives only an
// environment. This file formalizes PR #778's entry observations
// (test/test-acceptance-host-entry.js at 22cd8deb, never merged) as a
// main-tree suite, curing the copied-overlay provenance limit, and adds
// the custody-profile case the packet commissions:
//  - Inactive: every SETTLEMENT_* value cleared → the entry listens and
//    the settlement capability reads `inactive`.
//  - Representative partial setups → the entry refuses at boot
//    (non-zero exit, host's named field error, never the listening
//    line) and the chosen port accepts no connection.
//  - Complete configuration INCLUDING the durable-custody profile →
//    the entry refuses at host construction, naming the unbound
//    encryption seam. Per ruling 6508634090 this refusal is pinned as
//    EXPECTED current behaviour, not completed custody integration:
//    server.js passes environment values only (no seams argument) and
//    the host requires the injected encryption function
//    (settlement-production-host.js, "durable custody requires the
//    injected encryption function (activation-time input) — not
//    bound"). Production custody binding remains separately owed
//    (activation packet item 4). Host construction sits OUTSIDE the
//    entry's async startup catch, so the oracle is the named
//    missing-encryption error + non-zero exit + no listener — NOT a
//    FATAL startup prefix. "No listener" is external observation (the
//    configured port refuses connections); it is not a claim about
//    constructor calls inside the child, which this file cannot see.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ENTRY = path.join(__dirname, '..', 'server.js');
const SYNTH_PASS = 'synthetic-entry-password';
const SYNTH_SECRET = 'synthetic-entry-session-secret';
const base = { SITE_PASSWORD: SYNTH_PASS, SESSION_SECRET: SYNTH_SECRET };
function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('SETTLEMENT_')) env[k] = v;
  return { ...env, ...base, ...extra };
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const refused = port => new Promise(resolve => {
  const sock = net.connect({ port, host: '127.0.0.1' });
  sock.once('connect', () => { sock.destroy(); resolve(false); });
  sock.once('error', e => resolve(e.code === 'ECONNREFUSED'));
});
function launch(env) {
  const child = spawn(process.execPath, [ENTRY], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '', code: undefined };
  child.stdout.on('data', d => { out.stdout += d; });
  child.stderr.on('data', d => { out.stderr += d; });
  out.exited = new Promise(resolve => child.on('exit', code => { out.code = code; resolve(code); }));
  out.child = child;
  return out;
}
function req(port, p, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', agent: false,
      headers: { ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } : {}) } }, res => {
      let raw = ''; res.setEncoding('utf8'); res.on('data', x => { raw += x; });
      res.on('end', () => { let value; try { value = JSON.parse(raw); } catch { value = raw; }
        resolve({ status: res.statusCode, headers: res.headers, value }); });
    });
    r.setTimeout(5000, () => r.destroy(Error('entry request deadline'))); r.on('error', reject); r.end(body);
  });
}

test('A12 actual entry, settlement config cleared: listens and reports settlement inactive', async t => {
  const port = await freePort();
  const p = launch(cleanEnv({ PORT: String(port) }));
  t.after(() => { if (p.code === undefined) p.child.kill('SIGKILL'); });
  const deadline = Date.now() + 30000;
  while (!/listening on (\d+)/.test(p.stdout)) {
    assert.equal(p.code, undefined, 'entry exited before listening: ' + p.stderr.slice(0, 300));
    assert.ok(Date.now() < deadline, 'entry did not report listening');
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(Number(p.stdout.match(/listening on (\d+)/)[1]), port, 'listening on the configured port');
  const login = await req(port, '/login', { body: 'password=' + base.SITE_PASSWORD });
  assert.equal(login.status, 302);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const capability = await req(port, '/settlement/capability', { cookie });
  assert.equal(capability.value.status, 'inactive');
  p.child.kill('SIGTERM');
  await p.exited;
  assert.equal(p.stderr.includes('FATAL'), false, 'inactive shutdown reports no custody closure failure');
});

const HOUSEHOLD = 'household-' + 'a'.repeat(32);
const partials = [
  ['a lone household id', { SETTLEMENT_HOUSEHOLD_ID: HOUSEHOLD }],
  ['a financial profile without its password', {
    SETTLEMENT_FINANCIAL_DB_HOST: 'db.example.test', SETTLEMENT_FINANCIAL_DB_PORT: '5432',
    SETTLEMENT_FINANCIAL_DB_NAME: 'atlas', SETTLEMENT_FINANCIAL_DB_USER: 'settlement_financial',
    SETTLEMENT_FINANCIAL_DB_SCHEMA: 'settlement_financial', SETTLEMENT_FINANCIAL_DB_SCOPE: 'synthetic-scope' }],
  ['a lone custody host', { SETTLEMENT_CUSTODY_DB_HOST: 'db.example.test' }],
];
for (const [label, extra] of partials) {
  test('A12 actual entry, partial settlement setup (' + label + '): boot refused, nothing listens', async t => {
    const port = await freePort();
    const p = launch(cleanEnv({ PORT: String(port), ...extra }));
    t.after(() => { if (p.code === undefined) p.child.kill('SIGKILL'); });
    const code = await Promise.race([p.exited, new Promise(r => setTimeout(() => r('timeout'), 30000))]);
    assert.notEqual(code, 'timeout', 'entry must refuse and exit, not keep running');
    assert.notEqual(code, 0, 'non-zero exit');
    assert.doesNotMatch(p.stdout, /listening on/, 'never reported listening');
    assert.match(p.stderr, /SETTLEMENT_[A-Z_]+/, 'host names the offending field');
    assert.equal(await refused(port), true, 'configured port refuses connections');
  });
}

// A complete configuration — every required key for the financial and
// authorization profiles plus the full custody group (own schema and
// scope, per the host's group rules) — in exactly the shapes the host
// factory accepts in-process (see test-a9-unknown-operation-host.js).
// Through the real entry this can never boot today: the entry binds no
// encryption seam. The refusal is pinned as expected current behaviour.
const completeWithCustody = {
  SETTLEMENT_FINANCIAL_DB_HOST: 'db.example.test', SETTLEMENT_FINANCIAL_DB_PORT: '5432',
  SETTLEMENT_FINANCIAL_DB_NAME: 'atlas', SETTLEMENT_FINANCIAL_DB_USER: 'settlement_financial',
  SETTLEMENT_FINANCIAL_DB_PASSWORD: 'synthetic-entry-password',
  SETTLEMENT_FINANCIAL_DB_SCHEMA: 'settlement_financial', SETTLEMENT_FINANCIAL_DB_SCOPE: 'synthetic-scope',
  SETTLEMENT_AUTH_DB_HOST: 'db.example.test', SETTLEMENT_AUTH_DB_PORT: '5432',
  SETTLEMENT_AUTH_DB_NAME: 'atlas', SETTLEMENT_AUTH_DB_USER: 'settlement_auth',
  SETTLEMENT_AUTH_DB_PASSWORD: 'synthetic-entry-password',
  SETTLEMENT_AUTH_DB_SCHEMA: 'settlement_auth', SETTLEMENT_AUTH_DB_SCOPE: 'synthetic-scope',
  SETTLEMENT_CUSTODY_DB_HOST: 'db.example.test', SETTLEMENT_CUSTODY_DB_PORT: '5432',
  SETTLEMENT_CUSTODY_DB_NAME: 'atlas', SETTLEMENT_CUSTODY_DB_USER: 'settlement_custody',
  SETTLEMENT_CUSTODY_DB_PASSWORD: 'synthetic-entry-password',
  SETTLEMENT_CUSTODY_DB_SCHEMA: 'settlement_custody', SETTLEMENT_CUSTODY_DB_SCOPE: 'custody-scope',
  SETTLEMENT_HOUSEHOLD_ID: HOUSEHOLD,
  SETTLEMENT_ORIGIN: 'https://atlas.example.test',
  SETTLEMENT_CONTEXT_DOMAIN: 'synthetic-household-authority',
  SETTLEMENT_EXCLUSION_LEDGER_NAMESPACE: 'ledger-' + '1'.repeat(32),
  SETTLEMENT_EXCLUSION_SERIALIZATION_AUTHORITY: 'authority-' + '2'.repeat(32),
  SETTLEMENT_EXCLUSION_HISTORY_AUTHORITY: 'authority-' + '3'.repeat(32),
};
test('A12 actual entry, complete custody-profile config: refuses at host construction naming the unbound encryption seam (expected current behaviour)', async t => {
  const port = await freePort();
  const p = launch(cleanEnv({ PORT: String(port), ...completeWithCustody }));
  t.after(() => { if (p.code === undefined) p.child.kill('SIGKILL'); });
  const code = await Promise.race([p.exited, new Promise(r => setTimeout(() => r('timeout'), 30000))]);
  assert.notEqual(code, 'timeout', 'entry must refuse and exit, not keep running');
  assert.notEqual(code, 0, 'non-zero exit');
  // Host construction is outside the entry's async startup catch: the
  // named missing-encryption error is the oracle. No FATAL startup
  // prefix is required (ruling 6508634090 point 2).
  assert.match(p.stderr, /durable custody requires the injected encryption function/,
    'refusal names the missing injected encryption function: ' + p.stderr.slice(0, 300));
  assert.doesNotMatch(p.stdout, /listening on/, 'never reported listening');
  assert.equal(await refused(port), true,
    'no observed connections on the configured port (external observation only)');
});
