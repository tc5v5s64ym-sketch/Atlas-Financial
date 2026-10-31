'use strict';
// Manual, bounded synthetic evidence; timing measurements are not a CI speed gate.
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), cp = require('node:child_process');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const filename = path.join(__dirname, 'test-production-live-overlay.js');
const safe = {};
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) if (process.env[key]) safe[key] = process.env[key];
safe.LOCALAPPDATA = path.join(process.env.TEMP || process.env.TMP || __dirname, 'atlas-date-cache-synthetic');
fs.mkdirSync(safe.LOCALAPPDATA, { recursive: true });
const normalize = value => Array.isArray(value) ? value.map(normalize) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter(key => key !== 'generatedAt').map(key => [key, normalize(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
async function run(baseline, delayMs) {
  let source = fs.readFileSync(filename, 'utf8').replaceAll('2026-08-21', '2026-10-07').replaceAll('2026-08-20', '2026-10-06');
  if (delayMs) source = source.replace('res.end(JSON.stringify(body));', 'setTimeout(()=>res.end(JSON.stringify(body)),' + delayMs + ');');
  const fixture = new Module(filename); fixture.filename = filename; fixture.paths = Module._nodeModulePaths(__dirname);
  fixture._compile(source.slice(0, source.indexOf('function independentGroceryRemaining')) + '\nmodule.exports={startMockProvider,freePort,syntheticLiveMap,login,PASS,SECRET};', filename);
  const { startMockProvider, freePort, syntheticLiveMap, login, PASS, SECRET } = fixture.exports;
  const mock = await startMockProvider('ok'), port = await freePort(), base = 'http://127.0.0.1:' + port;
  const child = cp.spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/card-date-profile-preload.js'), path.join(root, 'server.js')], {
    cwd: root, env: { ...safe, ATLAS_SYNTHETIC_DATE_BASELINE: baseline ? '1' : '0', PORT: String(port), SITE_PASSWORD: PASS, SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: 'synthetic-assistant-token-long-enough', ATLAS_LIVE_OVERLAY: 'live', LUNCHMONEY_ACCESS_TOKEN: 'synthetic-readonly-token-not-real',
      ATLAS_LUNCHMONEY_API_BASE: mock.base, ATLAS_LIVE_OVERLAY_NOW: '2026-10-07T18:00:00.000Z', ATLAS_PROVIDER_ACCOUNT_MAP_JSON: JSON.stringify(syntheticLiveMap()) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let trace = ''; child.stderr.on('data', chunk => trace += chunk);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Synthetic server startup timeout')), 8000);
      child.stdout.on('data', chunk => { if (/listening/.test(String(chunk))) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic server exited before ready')); });
    });
    const { cookie } = await login(base), results = [];
    const endpoints = delayMs ? [['/data.json', { cookie }]] : [['/data.json', { cookie }], ['/assistant/current', { authorization: 'Bearer synthetic-assistant-token-long-enough' }]];
    for (const [endpoint, headers] of endpoints) {
      const start = performance.now(), response = await fetch(base + endpoint, { headers, signal: AbortSignal.timeout(22000) }), body = await response.json();
      results.push({ endpoint, status: response.status, elapsedMs: Math.round(performance.now() - start), normalizedBodySha256: hash(body), overlayApplied: body.liveOverlay?.applied ?? null });
    }
    const phases = trace.split('\n').filter(line => line.startsWith('SYNTHETIC_PHASE ')).map(line => JSON.parse(line.slice(16)));
    return { baseline, providerDelayMs: delayMs, providerCalls: mock.calls.length, results, phases };
  } finally {
    await new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
    mock.server.closeAllConnections(); await mock.close();
  }
}
(async () => {
  const canonicalBefore = fs.readFileSync(path.join(root, 'data.json'));
  const original = await run(true, 0), candidate = await run(false, 0);
  for (let i = 0; i < 2; i++) {
    assert.equal(original.results[i].status, 200); assert.equal(candidate.results[i].status, 200);
    assert.equal(original.results[i].normalizedBodySha256, candidate.results[i].normalizedBodySha256, 'Complete payload conservation except generatedAt');
  }
  assert.equal(original.results[0].overlayApplied, true); assert.equal(candidate.results[0].overlayApplied, true);
  const delayedOriginal = await run(true, 1800), delayedCandidate = await run(false, 1800);
  if (delayedCandidate.results[0].status === 200) assert.equal(candidate.results[0].normalizedBodySha256, delayedCandidate.results[0].normalizedBodySha256);
  assert.equal(Buffer.compare(canonicalBefore, fs.readFileSync(path.join(root, 'data.json'))), 0);
  const result = { transport: 'synthetic loopback only', deadlineMs: 15000, normalizedWholePayloadsEqual: true, excludedOutputFields: ['generatedAt'], original, candidate, delayedOriginal, delayedCandidate, childrenStopped: true, canonicalBytesUnchanged: true };
  if (process.argv[2]) fs.writeFileSync(path.resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n');
  console.log('MEASURED ' + JSON.stringify({ original: original.results, candidate: candidate.results, delayedOriginal: delayedOriginal.results, delayedCandidate: delayedCandidate.results }));
  console.log('PASS whole payload conservation and bounded synthetic cleanup; finite-fetch timings are diagnostic, not a production guarantee');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
