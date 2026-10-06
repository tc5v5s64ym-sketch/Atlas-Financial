'use strict';
// Exercise the real server and existing auth gates with invented data only.
// The preload replaces two reads in this owned child; no canonical file edits,
// provider calls, real environment values, new endpoint or alternate matcher.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const net = require('node:net'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const O = require('../scripts/provider-observe'), D = require('../scripts/salary-match-diagnostic');
const fx = require('./fixtures/salary-diagnostic-data');
const ROOT = path.resolve(__dirname, '..');
const PASSWORD = 'synthetic-diagnostic-password', TOKEN = 'synthetic-diagnostic-bearer-at-least-32';
const SECRET = 'synthetic-diagnostic-session-secret';
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function unusedPort() {
  const lease = net.createServer(); lease.listen(0, '127.0.0.1'); await once(lease, 'listening');
  const port = lease.address().port; await new Promise(resolve => lease.close(resolve)); return port;
}
async function main() {
  const before = hash(path.join(ROOT, 'data.json'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-salary-diagnostic-'));
  let child;
  try {
    const x = fx.input('missing-identity');
    const expected = O.observe(x).observationReceipt.salaryMatcherDiagnostic;
    const fixture = path.join(temp, 'fixture.json'), map = path.join(temp, 'map.json');
    fs.writeFileSync(fixture, JSON.stringify(x.payload)); fs.writeFileSync(map, JSON.stringify(x.accountMap));
    const shim = path.join(temp, 'preload.cjs');
    fs.writeFileSync(shim, `'use strict';
const fs = require('node:fs'), path = require('node:path');
const original = fs.readFileSync;
const replacements = ${JSON.stringify({
      [path.join(ROOT, 'data.json')]: JSON.stringify(x.data),
      [path.join(ROOT, 'docs/connectivity/transaction-identity.json')]: JSON.stringify({ rules: x.identityRules, billPaymentPayees: [] }),
    })};
fs.readFileSync = function(file, options) {
  const text = typeof file === 'string' && replacements[path.resolve(file)];
  if (text === undefined) return original.apply(this, arguments);
  const encoding = typeof options === 'string' ? options : options && options.encoding;
  return encoding ? text : Buffer.from(text);
};
`);
    // Allowlist environment needed to launch Node; never inherit app secrets.
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']
      .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
    const port = await unusedPort(), base = 'http://127.0.0.1:' + port;
    Object.assign(env, { PORT: String(port), SITE_PASSWORD: PASSWORD, SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: TOKEN, ATLAS_LIVE_OVERLAY: 'fixture',
      ATLAS_LIVE_OVERLAY_FIXTURE: fixture, ATLAS_LIVE_OVERLAY_MAP: map });
    child = spawn(process.execPath, ['-r', shim, 'server.js'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let failed = false; child.on('error', () => { failed = true; });
    child.stdout.resume(); child.stderr.resume();
    const request = (route, options = {}) => fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(4000), ...options });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failed || child.exitCode !== null) throw new Error('Synthetic server failed to start');
      try { ready = (await request('/healthz')).status === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'Synthetic server ready'); checks++;
    const bearer = { Authorization: 'Bearer ' + TOKEN };
    for (const [route, headers] of [['/data.json', {}], ['/data.json', bearer],
      ['/assistant/current', {}], ['/assistant/current', { Authorization: 'Bearer synthetic-wrong-token-at-least-32' }]]) {
      const response = await request(route, { headers }); eq(response.status, 401, 'existing auth boundary');
      const body = await response.text(); eq(body.includes('salaryMatcherDiagnostic'), false, 'no unauthenticated diagnostic');
    }
    const login = await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: PASSWORD }).toString() });
    eq(login.status, 302); const cookie = login.headers.get('set-cookie').split(';')[0];
    eq((await request('/assistant/current', { headers: { Cookie: cookie } })).status, 401,
      'browser session does not grant assistant bearer access');
    for (let repeat = 0; repeat < 3; repeat++) {
      const browser = await request('/data.json', { headers: { Cookie: cookie } }); eq(browser.status, 200);
      const browserPacket = (await browser.json()).liveOverlay.observationReceipt.salaryMatcherDiagnostic;
      eq(browserPacket, expected, 'existing session readback copies matcher diagnostic');
      eq(D.project(browserPacket), expected, 'session output satisfies closed schema');
      const assistant = await request('/assistant/current', { headers: bearer }); eq(assistant.status, 200);
      eq((await assistant.json()).metadata.observationReceipt.salaryMatcherDiagnostic, expected,
        'existing assistant readback copies same diagnostic without accumulating state');
    }
    eq((await request('/assistant/current', { method: 'POST', headers: bearer })).status, 405);
    const unknown = await request('/salary-matcher-diagnostic', { headers: { Cookie: cookie } });
    eq(unknown.status, 404, 'no new diagnostic route');
    eq(hash(path.join(ROOT, 'data.json')), before, 'canonical bytes unchanged');
    console.log('PASS salary diagnostic auth: ' + checks + ' assertions; real session/static bearer gates, repeat readback, no public route, synthetic inputs only');
  } finally {
    // Only stop the process this test owns. Never inspect other processes.
    if (child && child.exitCode === null && child.pid) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
    const resolved = path.resolve(temp), root = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(root)) throw new Error('Unexpected synthetic fixture directory');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
