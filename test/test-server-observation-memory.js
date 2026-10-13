'use strict';
// Synthetic source inputs, actual worker/observer/LivePlan and authenticated
// server routes. No household file edit, configured secret or provider write.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const Fixture = require('./fixtures/budget-surface-data');
const ROOT = path.resolve(__dirname, '..');
const CLOCK = Fixture.payload().fetchedAt;
const PASS = 'synthetic-observation-site-password';
const SECRET = 'synthetic-observation-session-secret';
const OTHER_PASS = 'synthetic-new-household-context';
const TOKEN = 'synthetic-observation-assistant-token-32chars';

// A child-only preload substitutes the dated baseline in memory. It never
// changes data.json, credentials, identity files, environment or access grants.
if (process.env.ATLAS_SYNTHETIC_OBSERVATION_PRELOAD === '1') {
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) {
    if (typeof file === 'string' && path.resolve(file) === path.join(ROOT, 'data.json')) {
      const bytes = JSON.stringify(Fixture.canonical());
      return args[0] ? bytes : Buffer.from(bytes);
    }
    return read.call(this, file, ...args);
  };
  Date.now = () => Date.parse(process.env.ATLAS_LIVE_OVERLAY_NOW);
}
if (!require('node:worker_threads').isMainThread
  && (process.env.ATLAS_SYNTHETIC_REPLAY_DELAY_MS || process.env.ATLAS_SYNTHETIC_LIVE_RESULT_DELAY_MS)) {
  const Live = require('../scripts/live-plan'), apply = Live.applyForServer;
  Live.applyForServer = async (...args) => {
    if (args[2]?.evidence) await new Promise(resolve => setTimeout(resolve, Number(process.env.ATLAS_SYNTHETIC_REPLAY_DELAY_MS)));
    const data = await apply(...args);
    if (!args[2]?.evidence && process.env.ATLAS_SYNTHETIC_LIVE_RESULT_DELAY_MS) {
      require('node:worker_threads').parentPort.postMessage({ syntheticAcquired: true });
      await new Promise(resolve => setTimeout(resolve, Number(process.env.ATLAS_SYNTHETIC_LIVE_RESULT_DELAY_MS)));
    }
    return data;
  };
}
function environment(base) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return { ...env, ATLAS_LIVE_OVERLAY: 'live', LUNCHMONEY_ACCESS_TOKEN: 'SYNTHETIC-CREDENTIAL-CANARY',
    ATLAS_LUNCHMONEY_API_BASE: base, ATLAS_LIVE_OVERLAY_NOW: CLOCK,
    ATLAS_PROVIDER_ACCOUNT_MAP_JSON: JSON.stringify({ ...Fixture.map, scope: 'live' }) };
}
async function provider() {
  let payload = { ...Fixture.payload(), tags: [] }, mode = 'ok', held = false;
  const calls = [], pending = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); calls.push(url.pathname);
    if (req.method !== 'GET') throw new Error('Synthetic provider received a write');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    const answer = () => {
      if (mode === 'failure') return send(503, { error: 'SYNTHETIC-PRIVATE-ERROR', token: 'SYNTHETIC-CREDENTIAL-CANARY' });
      if (mode === 'optionalFailure' && url.pathname === '/v2/tags') return send(503, { error: 'SYNTHETIC-OPTIONAL-ERROR' });
      if (url.pathname === '/v2/me') return send(200, { id: 1 });
      if (url.pathname === '/v2/plaid_accounts') return send(200, { plaid_accounts: payload.accounts });
      if (url.pathname === '/v2/manual_accounts') return send(200, { manual_accounts: [] });
      if (url.pathname === '/v2/categories') return send(200, { categories: mode === 'malformed' ? {} : payload.categories });
      if (url.pathname === '/v2/tags') return send(200, { tags: payload.tags });
      if (url.pathname === '/v2/transactions') {
        const isPending = url.searchParams.get('is_pending') === 'true';
        const rows = payload.transactions.filter(tx => !isPending || tx.is_pending);
        return send(200, { transactions: rows, ...(mode === 'incomplete' && isPending ? {} : { has_more: false }) });
      }
      send(404, {});
    };
    if (held && url.pathname === '/v2/me') {
      pending.add(answer); res.once('close', () => pending.delete(answer));
    } else answer();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: 'http://127.0.0.1:' + server.address().port + '/v2', calls,
    mode(value) { mode = value; }, payload(value) { payload = structuredClone(value); },
    hold() { held = true; }, release() { held = false; for (const answer of pending) answer(); pending.clear(); },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); },
  };
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = performance.now() + 15000;
  while (!(await predicate())) { if (performance.now() >= deadline) throw new Error('Synthetic deadline: ' + label); await pause(10); }
}
async function freePort() {
  const server = http.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function oauthIssuer() {
  const jose = await import('jose');
  const pair = await jose.generateKeyPair('RS256', { extractable: true });
  const jwk = { ...await jose.exportJWK(pair.publicKey), kid: 'synthetic-observation-key', alg: 'RS256', use: 'sig' };
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const issuer = 'http://127.0.0.1:' + server.address().port + '/';
  return { issuer, jwks: issuer + 'jwks',
    token: resource => new jose.SignJWT({ scope: 'atlas.current.read' }).setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
      .setIssuer(issuer).setAudience(resource).setSubject('synthetic-owner').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey),
    close: () => new Promise(resolve => server.close(resolve)) };
}
async function atlas(mock, { mcp = false } = {}) {
  const port = await freePort();
  const base = 'http://127.0.0.1:' + port, auth = mcp ? await oauthIssuer() : null;
  const child = spawn(process.execPath, ['--require', __filename, path.join(ROOT, 'server.js')], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...environment(mock.base),
      PORT: String(port), SITE_PASSWORD: PASS, SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: TOKEN, ATLAS_SYNTHETIC_OBSERVATION_PRELOAD: '1',
      ...(auth ? { ATLAS_MCP_RESOURCE_URL: base + '/assistant/mcp', ATLAS_OAUTH_ISSUER: auth.issuer, ATLAS_OAUTH_JWKS_URI: auth.jwks } : {}) } });
  // Capture privately; publish only the test's own closed counts/timings.
  let exited = false; child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.once('exit', () => { exited = true; });
  const close = async () => {
    if (!exited && child.exitCode === null) {
      const exit = new Promise(resolve => child.once('exit', resolve)); child.kill(); await exit;
    }
    await auth?.close();
  };
  try {
    await until(async () => {
      if (exited) throw new Error('Synthetic server startup failed');
      try { return (await fetch(base + '/login')).status === 200; } catch (_) { return false; }
    }, 'server startup');
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(PASS) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Synthetic login failed');
    return { base, cookie, close, mcpToken: auth ? await auth.token(base + '/assistant/mcp') : null };
  } catch (error) { await close(); throw error; }
}
module.exports = { provider, atlas, environment, CLOCK, PASS, TOKEN, until, pause };

if (require.main === module) (async () => {
  const assert = require('node:assert/strict');
  const threads = require('node:worker_threads');
  const workerExits = [], workers = [];
  const RealWorker = threads.Worker;
  threads.Worker = class extends RealWorker {
    constructor(...args) { super(...args); workers.push(this); workerExits.push(new Promise(resolve => this.once('exit', resolve))); }
    emit(event, value, ...args) {
      if (event === 'message' && value?.syntheticAcquired) { this.syntheticAcquired = true; return true; }
      return super.emit(event, value, ...args);
    }
  };
  const Refresh = require('../scripts/server-live-refresh');
  const Live = require('../scripts/live-plan');
  const Memory = require('../scripts/server-observation-memory');
  const Observer = require('../scripts/provider-observe');
  const canonical = Fixture.canonical();
  const originalNow = Date.now, originalLog = console.log;
  let now = CLOCK, checks = 0;
  Date.now = () => Date.parse(now);
  const check = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const reject = async (promise, code) => { await assert.rejects(promise, error => error.code === code); checks++; };
  const drain = () => Promise.all(workerExits);
  const timings = [];
  console.log = (...args) => { if (typeof args[0] === 'string' && args[0].startsWith('{"type":"live-refresh-lifecycle"')) timings.push(JSON.parse(args[0])); else originalLog(...args); };
  const mock = await provider(), env = environment(mock.base);
  try {
    // The source projection excludes credentials, arbitrary nested metadata,
    // publications and owner allocations, and refuses incomplete/malformed rows.
    const raw = { ...Fixture.payload(), tags: [], token: 'SYNTHETIC-CREDENTIAL-CANARY',
      startingCash: { amount: 99999 }, savedAllocations: [99999] };
    raw.accounts[0].password = 'SYNTHETIC-CREDENTIAL-CANARY';
    raw.transactions[0].plaid_metadata = { transaction_id: 'synthetic-id', secret: 'SYNTHETIC-CREDENTIAL-CANARY' };
    const projected = Memory.sourceInputs(raw);
    check(JSON.stringify(projected).includes('SYNTHETIC-CREDENTIAL-CANARY'), false, 'no credential fields retained');
    check(Object.keys(projected), ['provider','fetchedAt','accounts','categories','tags','transactions','transactionWindow','pendingCoverage'], 'source-only shape');
    const memory = Memory.create(), envelope = { schema: Memory.SCHEMA, payload: projected };
    memory.publish('synthetic-private-context', envelope); projected.accounts[0].balance = 99999;
    check(memory.read('synthetic-private-context').payload.accounts[0].balance, 1215, 'publish clones source');
    const read = memory.read('synthetic-private-context'); read.payload.accounts[0].balance = 99999;
    check(memory.read('synthetic-private-context').payload.accounts[0].balance, 1215, 'read clones source');
    check(memory.read('different-context'), null, 'incompatible slot erased');
    check(Memory.create().read('synthetic-private-context'), null, 'new process/store has no restored evidence');
    for (const mutate of [p => { p.pendingCoverage.complete = false; }, p => { p.transactionWindow.truncated = true; },
      p => { p.transactions[0].amount = null; }, p => { p.transactions[0].amount = '   '; },
      p => { p.accounts[0].balance = '0x10'; }, p => { p.transactions[0].date = '2026-02-30'; }]) {
      const bad = structuredClone(raw); mutate(bad); assert.throws(() => Memory.sourceInputs(bad)); checks++;
    }

    let observation;
    const direct = await Live.applyForServer(canonical, env, { onObservation(value) { observation = value; } });
    check(observation.qualified, true, 'independent live acquisition qualifies');
    assert.ok(observation.evidence); checks++;
    const report = Observer.observe({ provider: 'lunchmoney', data: canonical, payload: observation.evidence.payload,
      accountMap: { ...Fixture.map, scope: 'live' }, identity: JSON.parse(fs.readFileSync(Observer.DEFAULT_IDENTITY, 'utf8')) });
    const independentlyEvaluated = Live.overlayLiveState({ data: canonical, report }).data;
    check(independentlyEvaluated, direct, 'independent observer/cutover evaluation conserves whole publication');
    check(independentlyEvaluated.plan.startingCash.breakdown.find(row => row.id === 'chequing-a').value
      + independentlyEvaluated.plan.startingCash.breakdown.find(row => row.id === 'chequing-b').value, 1375, 'independent 1215 + 160 chequing proof');
    const firstCount = mock.calls.length; let firstCheck;
    check(await Refresh.serve(canonical, env, { preferObservation: true, onCheck(value) { firstCheck = value; } }), direct, 'first browser miss equals independent evaluation');
    await drain(); check(mock.calls.length - firstCount, 7, 'first browser read performs seven GETs');
    check(firstCheck, { source: 'provider', qualified: true, checkedAt: CLOCK }, 'live check timestamp');
    const cachedCount = mock.calls.length, workerCount = workers.length, started = performance.now(); let reusedCheck;
    const reused = await Refresh.serve(canonical, env, { preferObservation: true, onCheck(value) { reusedCheck = value; } });
    const providerFreeResponseMs = performance.now() - started;
    check(reused, independentlyEvaluated, 'sequential browser replay equals independent same-evidence evaluation');
    check(mock.calls.length, cachedCount, 'sequential browser replay makes zero provider requests');
    check(workers.length - workerCount, 1, 'replay uses actual bounded worker');
    check(reusedCheck, { source: 'memory', qualified: true, checkedAt: CLOCK }, 'render does not relabel original check');
    reused.plan.startingCash.breakdown[0].value = 99999;
    check(await Refresh.serve(canonical, env, { preferObservation: true }), direct, 'callers do not share result or evidence objects'); await drain();
    const replayCancel = new AbortController(), replayBefore = workers.length;
    const cancelledReplay = reject(Refresh.serve(canonical, env, { preferObservation: true, signal: replayCancel.signal }), 'live-refresh-cancelled');
    const survivor = Refresh.serve(canonical, env, { preferObservation: true });
    replayCancel.abort(); await cancelledReplay;
    check(await survivor, direct, 'one cancelled replay waiter cannot cancel its survivor'); await drain();
    check(workers.length - replayBefore, 1, 'equivalent replay callers share an actual worker');
    check(mock.calls.length, cachedCount, 'cancelled replay never starts provider work');

    for (const options of [{}, { preferObservation: true, forceRefresh: true }]) {
      const count = mock.calls.length;
      check(await Refresh.serve(canonical, env, options), direct, 'live and force consumers retain publication'); await drain();
      check(mock.calls.length - count, 7, 'live/force consumers bypass completed evidence');
    }
    // A forced live acquisition supersedes any pending older cached replay.
    const delayedEnv = { ...env, ATLAS_SYNTHETIC_REPLAY_DELAY_MS: '800',
      NODE_OPTIONS: '--require "' + __filename.replace(/\\/g, '/') + '"' };
    await Refresh.serve(canonical, delayedEnv); await drain();
    const obsoleteReplay = reject(Refresh.serve(canonical, delayedEnv, { preferObservation: true }), 'live-refresh-invalidated');
    const changed = { ...Fixture.payload(), tags: [] }; changed.transactions[2].category_id = 14; mock.payload(changed);
    const latest = await Refresh.serve(canonical, delayedEnv, { forceRefresh: true });
    await obsoleteReplay; await drain(); const latestCount = mock.calls.length;
    check(await Refresh.serve(canonical, delayedEnv, { preferObservation: true }), latest, 'latest live check owns subsequent replay'); await drain();
    check(mock.calls.length, latestCount, 'obsolete replay cannot restore an older slot');
    mock.payload({ ...Fixture.payload(), tags: [] }); await Refresh.serve(canonical, env); await drain();
    // A successfully evaluated result arriving after cancellation is abandoned,
    // not a completed check that may silently fill the private evidence slot.
    const lateEnv = { ...env, ATLAS_SYNTHETIC_LIVE_RESULT_DELAY_MS: '35',
      NODE_OPTIONS: '--require "' + __filename.replace(/\\/g, '/') + '"' };
    const lateCancel = new AbortController();
    const abandoned = reject(Refresh.serve(canonical, lateEnv, { forceRefresh: true, signal: lateCancel.signal }), 'live-refresh-cancelled');
    await until(() => workers.at(-1).syntheticAcquired, 'qualified but not delivered worker result');
    lateCancel.abort(); await abandoned; await drain();
    const abandonedCount = mock.calls.length;
    await Refresh.serve(canonical, lateEnv, { preferObservation: true }); await drain();
    check(mock.calls.length - abandonedCount, 7, 'abandoned late worker cannot populate completed evidence');
    for (const mode of ['failure', 'malformed', 'incomplete', 'optionalFailure']) {
      mock.mode(mode);
      await reject(Refresh.serve(canonical, env, { preferObservation: true, forceRefresh: true }), 'live-refresh-unavailable'); await drain();
      const count = mock.calls.length;
      const failed = await Refresh.serve(canonical, env, { preferObservation: true }); await drain();
      check(mock.calls.length > count, true, mode + ': no successful cached fallback');
      if (mode !== 'optionalFailure') check(failed.liveOverlay.applied, false, mode + ': incomplete/invalid data does not advance cash');
      mock.mode('ok'); await Refresh.serve(canonical, env); await drain();
    }
    for (const change of [
      { LUNCHMONEY_ACCESS_TOKEN: 'SYNTHETIC-DIFFERENT-TOKEN' }, { SITE_PASSWORD: OTHER_PASS },
      { RENDER_GIT_COMMIT: 'synthetic-new-runtime' }, { ATLAS_PROVIDER_ACCOUNT_MAP_JSON: JSON.stringify({ ...Fixture.map, scope: 'live', revision: 'new' }) },
    ]) {
      const count = mock.calls.length;
      await Refresh.serve(canonical, { ...env, ...change }, { preferObservation: true }); await drain();
      check(mock.calls.length - count, 7, 'changed credential/household/runtime/map context misses');
    }
    const changedCanonical = structuredClone(canonical); changedCanonical.meta.syntheticRevision = 'new';
    const count = mock.calls.length; await Refresh.serve(changedCanonical, env, { preferObservation: true }); await drain();
    check(mock.calls.length - count, 7, 'canonical revision misses');
    const stat = fs.statSync;
    try {
      fs.statSync = (file, ...args) => {
        if (file === Observer.LOCAL_MAP) { const error = new Error('synthetic metadata refusal'); error.code = 'EACCES'; throw error; }
        return stat(file, ...args);
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const opaqueCount = mock.calls.length;
        check(await Refresh.serve(canonical, env, { preferObservation: true }), direct, 'unreadable compatibility metadata retains incumbent live result'); await drain();
        check(mock.calls.length - opaqueCount, 7, 'unreadable metadata never authorizes completed reuse');
      }
    } finally { fs.statSync = stat; }

    await Refresh.serve(canonical, env); await drain();
    const cancel = new AbortController(); cancel.abort(); const cancelledCount = mock.calls.length;
    await reject(Refresh.serve(canonical, env, { preferObservation: true, signal: cancel.signal }), 'live-refresh-cancelled');
    check(mock.calls.length, cancelledCount, 'pre-cancelled replay does not fetch');
    await Refresh.withProviderWrite(async () => ({ status: 'write-unverified' }));
    const afterWriteCount = mock.calls.length;
    await Refresh.serve(canonical, env, { preferObservation: true }); await drain();
    check(mock.calls.length - afterWriteCount, 7, 'uncertain write invalidates completed evidence');
    mock.hold(); const old = reject(Refresh.serve(canonical, env, { forceRefresh: true }), 'live-refresh-invalidated');
    await until(() => mock.calls.length > afterWriteCount + 7, 'old provider job');
    let finishWrite; const write = Refresh.withProviderWrite(() => new Promise(resolve => { finishWrite = resolve; }));
    await old;
    await reject(Refresh.serve(canonical, env, { preferObservation: true }), 'live-refresh-invalidated');
    finishWrite({ status: 'applied' }); await write; mock.release(); await drain();

    // Midnight/payday rollover ignores old evidence even without a new import.
    now = '2026-08-28T06:59:59.000Z'; const dayEnv = { ...env, ATLAS_LIVE_OVERLAY_NOW: now };
    const dayPayload = { ...Fixture.payload(), tags: [] }; dayPayload.accounts.forEach(row => { row.updated_at = now; }); mock.payload(dayPayload);
    await Refresh.serve(canonical, dayEnv); await drain();
    now = '2026-08-28T07:00:00.000Z'; const midnightCount = mock.calls.length;
    const rolled = await Refresh.serve(canonical, { ...dayEnv, ATLAS_LIVE_OVERLAY_NOW: now }, { preferObservation: true }); await drain();
    check(mock.calls.length - midnightCount, 7, 'Pacific midnight/payday starts live acquisition');
    check(rolled.liveOverlay.applied, false, 'prior-day cash cannot become a new-day financial verdict');
    check(rolled.liveOverlay.operatingPlan, Live.OPERATING_PLAN_UNAVAILABLE, 'new-day current instructions withheld');
    for (const [before, after] of [['2026-11-01T08:59:59.000Z','2026-11-01T09:00:00.000Z'],
      ['2027-03-14T09:59:59.000Z','2027-03-14T10:00:00.000Z']]) {
      now = before; const dstPayload = { ...Fixture.payload(), tags: [] }; dstPayload.accounts.forEach(row => { row.updated_at = before; }); mock.payload(dstPayload);
      const dstEnv = { ...env, ATLAS_LIVE_OVERLAY_NOW: before }; await Refresh.serve(canonical, dstEnv); await drain();
      const dstCount = mock.calls.length; now = after;
      const dst = await Refresh.serve(canonical, dstEnv, { preferObservation: true }); await drain();
      check(mock.calls.length, dstCount, 'same household date across DST reuses evidence');
      check(dst.liveOverlay.fetchedAt, before, 'DST replay retains exact original check timestamp');
    }
    now = CLOCK; mock.payload({ ...Fixture.payload(), tags: [] });

    // Full session-authenticated route and static-Bearer live consumer.
    for (let restart = 0; restart < 2; restart++) {
      const app = await atlas(mock, { mcp: true });
      try {
        check((await fetch(app.base + '/data.json?refresh=force')).status, 401, 'force is session-authenticated');
        for (const query of ['refresh=wat','refresh=force&refresh=force','refresh[x]=force']) {
          check((await fetch(app.base + '/data.json?' + query, { headers: { cookie: app.cookie } })).status, 400, 'malformed force option rejected');
        }
        const routeCount = mock.calls.length;
        const live = await fetch(app.base + '/data.json', { headers: { cookie: app.cookie } });
        check(live.status, 200, 'authenticated first read succeeds'); check(await live.json(), direct, 'actual route publication conservation');
        check(mock.calls.length - routeCount, 7, 'new server process has no restored evidence');
        const routeCachedCount = mock.calls.length;
        const cached = await fetch(app.base + '/data.json', { headers: { cookie: app.cookie } });
        check(await cached.json(), direct, 'actual browser route re-evaluates evidence');
        check(cached.headers.get('X-Atlas-Observation-Source'), 'memory', 'actual route reports reuse truthfully');
        check(cached.headers.get('X-Atlas-Observation-Checked-At'), CLOCK, 'actual route keeps original provider check');
        check(mock.calls.length, routeCachedCount, 'actual sequential browser route performs zero provider GETs');
        const assistantCount = mock.calls.length;
        check((await fetch(app.base + '/assistant/current', { headers: { authorization: 'Bearer ' + TOKEN } })).status, 200, 'assistant/current succeeds under dedicated Bearer');
        check(mock.calls.length - assistantCount, 7, 'assistant/current remains live');
        check((await fetch(app.base + '/assistant/current', { headers: { cookie: app.cookie } })).status, 401, 'session cannot unlock assistant/current');
        const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
        const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
        const client = new Client({ name: 'synthetic-observation-proof', version: '1' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(app.base + '/assistant/mcp'), {
            requestInit: { headers: { authorization: 'Bearer ' + app.mcpToken } }, }));
          const mcpCount = mock.calls.length;
          const result = await client.callTool({ name: 'get_atlas_current', arguments: {} });
          check(result.isError === true, false, 'OAuth MCP current read succeeds');
          check(mock.calls.length - mcpCount, 7, 'MCP current read remains live');
        } finally { await client.close(); }
        mock.mode('failure');
        check((await fetch(app.base + '/data.json?refresh=force', { headers: { cookie: app.cookie } })).status, 503, 'actual force failure is explicit');
        const retryCount = mock.calls.length;
        await fetch(app.base + '/data.json', { headers: { cookie: app.cookie } });
        check(mock.calls.length > retryCount, true, 'opening after failed force cannot hide failure behind old success');
        mock.mode('ok');
      } finally { await app.close(); }
    }
    originalLog('MEASURED ' + JSON.stringify({ providerFreeResponseMs: Math.round(providerFreeResponseMs * 100) / 100,
      sequentialProviderRequests: 0, proof: 'synthetic worker/HTTP; render measured separately' }));
    originalLog('PASS observation memory: ' + checks + ' checks; actual workers/routes, source-only cloning, qualification, force/failure, context, write races, calendar/DST and restart');
  } finally {
    Date.now = originalNow; console.log = originalLog; mock.release(); await drain(); await mock.close(); threads.Worker = RealWorker;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
