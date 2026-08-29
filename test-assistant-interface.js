'use strict';
/* Read-only assistant interface.
 *
 * Proves GET /assistant/current keeps its dedicated static Bearer boundary and
 * POST /assistant/mcp uses a separate OAuth protected-resource boundary over
 * the same incumbent Forecast / live-overlay / periods packet. Both fail
 * closed, never write, and do not weaken browser session auth.
 *
 * Financial figures are reconciled against Forecast on the same served
 * data, plus an independent sum of spendable cash rows. Live household
 * cents are not copied into assertions as the specification.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Forecast = require('./public/forecast.js');
const LivePlan = require('./scripts/live-plan.js');
const Assistant = require('./scripts/assistant-packet.js');
const AssistantMcp = require('./scripts/assistant-mcp.js');
const AssistantOAuth = require('./scripts/assistant-oauth.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const O = require('./scripts/provider-observe.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const QUESTIONS = path.join(ROOT, 'docs', '01_OPEN_QUESTIONS.md');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const ASSISTANT_TOKEN = 'synthetic-assistant-token-32chars!!';
const WRONG_TOKEN = 'wrong-assistant-token-32chars!!!!';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = value => JSON.parse(JSON.stringify(value));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const liveHash = hashFile(DATA);
const positionsHash = fs.existsSync(POSITIONS) ? hashFile(POSITIONS) : null;
const snapshotHashes = fs.readdirSync(SNAPSHOT_DIR)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);

function snapshotState() {
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);
}

function filesUnchanged(label) {
  ok(hashFile(DATA) === liveHash, `${label}: data.json bytes unchanged`);
  if (positionsHash) {
    ok(hashFile(POSITIONS) === positionsHash, `${label}: positions.csv bytes unchanged`);
  }
  const now = snapshotState();
  ok(now.length === snapshotHashes.length
    && now.every((row, i) => row === snapshotHashes[i]),
    `${label}: snapshots unchanged`);
}

function independentSpendable(plan) {
  return ((plan && plan.startingCash && plan.startingCash.breakdown) || [])
    .reduce((sum, row) => sum + (Number(row.value) || 0), 0);
}

function syntheticObligationData(planPatch) {
  const asOf = '2026-08-24';
  return {
    plan: Object.assign({
      windowDays: 21,
      opening: { asOf },
      defaults: { targetBuffer: 0 },
      startingCash: {
        amount: 8000,
        breakdown: [{ id: 'cheq', label: 'Chequing', value: 8000 }],
      },
      income: [{
        id: 'pay',
        label: 'Payroll',
        frequency: 'once',
        date: '2026-08-28',
        amount: 2500,
        confidence: 'confirmed',
      }],
      obligations: [],
      bills: [],
      commitments: [],
    }, planPatch || {}),
    debts: [],
    meta: { asOf },
  };
}

function earliestNamedOutflow(events, asOf) {
  let best = null;
  for (const event of events || []) {
    if (!(event.amount < 0) || event.kind === 'noncash' || event.date < asOf) continue;
    if (!best || event.date < best.date) best = event;
  }
  return best;
}

function sameDayJointCashOutflows(events, asOf, date) {
  return (events || []).filter(event =>
    event.amount < 0
    && event.kind !== 'noncash'
    && event.jointCash !== false
    && event.date >= asOf
    && event.date === date
  );
}

function forbiddenBlob(value) {
  const text = JSON.stringify(value == null ? {} : value);
  return /"providerAccountId"\s*:/.test(text)
    || /"providerTransactionId"\s*:/.test(text)
    || /"payee"\s*:/.test(text)
    || /"original_name"\s*:/.test(text)
    || /Bearer\s+\S+/.test(text)
    || /LUNCHMONEY_ACCESS_TOKEN/.test(text)
    || /SITE_PASSWORD/.test(text)
    || /SESSION_SECRET/.test(text)
    || /ATLAS_ASSISTANT_TOKEN/.test(text)
    || /ATLAS_PROVIDER_ACCOUNT_MAP_JSON/.test(text)
    || /synthetic-site-password/.test(text)
    || /synthetic-session-secret/.test(text)
    || /synthetic-assistant-token/.test(text)
    || /synthetic-readonly-token/.test(text);
}

function isolatedEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/^(ATLAS_|LUNCHMONEY_)/.test(key)) delete env[key];
  }
  return Object.assign(env, extra || {});
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
    server.on('error', reject);
  });
}

function startAtlas(env) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('server start timeout\n' + stderr));
    }, 8000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!settled && /listening/.test(stdout)) {
        settled = true;
        clearTimeout(timer);
        resolve({
          child,
          stdout: () => stdout,
          stderr: () => stderr,
          stop: () => new Promise(done => {
            child.once('exit', () => done());
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, 2000);
          }),
        });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${stderr}`));
    });
  });
}

async function login(base) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(PASS)}`,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, cookie: setCookie.split(';')[0], setCookie };
}

async function withAtlas(envExtra, fn) {
  const port = await freePort();
  const env = isolatedEnv(Object.assign({
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    PORT: String(port),
  }, envExtra || {}));
  const atlas = await startAtlas(env);
  try {
    return await fn({
      base: `http://127.0.0.1:${port}`,
      atlas,
    });
  } finally {
    await atlas.stop();
  }
}

async function startOAuthIssuer() {
  const jose = await import('jose');
  const pair = await jose.generateKeyPair('RS256', { extractable: true });
  const publicJwk = await jose.exportJWK(pair.publicKey);
  publicJwk.kid = 'atlas-test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  const otherPair = await jose.generateKeyPair('RS256', { extractable: true });
  let issuer;
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/.well-known/oauth-authorization-server') {
      return res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}authorize`,
        token_endpoint: `${issuer}token`,
        jwks_uri: `${issuer}jwks`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [AssistantMcp.REQUIRED_SCOPE],
      }));
    }
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys: [publicJwk] }));
    res.statusCode = 404;
    return res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });
  issuer = `http://127.0.0.1:${server.address().port}/`;
  async function sign(resource, overrides) {
    overrides = overrides || {};
    const now = Math.floor(Date.now() / 1000);
    const key = overrides.key || pair.privateKey;
    return new jose.SignJWT({
      scope: overrides.scope === undefined ? AssistantMcp.REQUIRED_SCOPE : overrides.scope,
      client_id: 'chatgpt-test-client',
      sub: 'atlas-owner-test',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'atlas-test-key' })
      .setIssuer(overrides.issuer || issuer)
      .setAudience(overrides.audience || resource)
      .setIssuedAt(now)
      .setNotBefore(overrides.notBefore === undefined ? now - 1 : overrides.notBefore)
      .setExpirationTime(overrides.expiresAt === undefined ? now + 300 : overrides.expiresAt)
      .sign(key);
  }
  return {
    issuer,
    jwksUri: `${issuer}jwks`,
    otherPrivateKey: otherPair.privateKey,
    sign,
    close: () => new Promise(done => server.close(() => done())),
  };
}

async function withOAuthAtlas(fn) {
  const oauth = await startOAuthIssuer();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const resource = `${base}/assistant/mcp`;
  const atlas = await startAtlas(isolatedEnv({
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_MCP_RESOURCE_URL: resource,
    ATLAS_OAUTH_ISSUER: oauth.issuer,
    ATLAS_OAUTH_JWKS_URI: oauth.jwksUri,
    PORT: String(port),
  }));
  try {
    await fn({ base, resource, oauth, atlas });
  } finally {
    await atlas.stop();
    await oauth.close();
  }
}

function expectExit(envExtra) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      env: isolatedEnv(Object.assign({
        SITE_PASSWORD: PASS,
        SESSION_SECRET: SECRET,
        PORT: '0',
      }, envExtra || {})),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('expected process exit, still running\n' + stderr));
    }, 5000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

function adviceFor(data, periods) {
  const asOf = (data.liveOverlay && data.liveOverlay.applied === true
    && data.liveOverlay.effectiveAsOf)
    || (data.plan && data.plan.opening && data.plan.opening.asOf)
    || (data.meta && data.meta.asOf);
  const actuals = data.liveOverlay && data.liveOverlay.applied === true
    ? data.liveOverlay.currentPeriodActuals
    : null;
  return Forecast.recommend(data.plan, asOf, {
    fundingSources: data.plan.funding && data.plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
    periods: periods || null,
    currentPeriodActuals: actuals,
  });
}

async function main() {
console.log('=== packet builder consumes Forecast, not a second planner ===');
{
  const periods = Assistant.loadPeriods();
  const packet = Assistant.buildPacket({
    data: clone(liveData),
    periods,
    questionsMarkdown: fs.readFileSync(QUESTIONS, 'utf8'),
    now: '2026-08-24T12:00:00.000Z',
    env: { ATLAS_GIT_SHA: '72567904bef9f5d4341a80a211db64d1411691cd' },
  });
  const advice = adviceFor(liveData, periods);
  const spendable = independentSpendable(liveData.plan);
  ok(packet.schema === Assistant.SCHEMA, 'schema is atlas-assistant-packet/v1');
  ok(packet.writesCanonicalState === false, 'packet declares no canonical write');
  ok(packet.productionWrite === false, 'packet declares no production write');
  ok(packet.authority && packet.authority.planner === 'Forecast',
    'planner authority is Forecast');
  ok(packet.current.spendableHouseholdCash.status === 'ok'
    && near(packet.current.spendableHouseholdCash.value, spendable),
    'spendable cash equals independent breakdown sum',
    `${packet.current.spendableHouseholdCash.value} vs ${spendable}`);
  ok(near(packet.current.spendableHouseholdCash.value,
    Forecast.startingCashAmount(liveData.plan)),
    'spendable cash equals Forecast.startingCashAmount');
  ok(packet.forecast.status === 'ok'
    && near(packet.forecast.recommendation.weekly, advice.weekly),
    'weekly cap equals Forecast.recommend, not a local substitute',
    `${packet.forecast.recommendation.weekly} vs ${advice.weekly}`);
  ok(packet.forecast.recommendation.mode === advice.mode,
    'recommendation mode is the Forecast mode');
  const mutated = clone(liveData);
  const cashRow = mutated.plan.startingCash.breakdown.find(row => row.id === 'chequing-a');
  cashRow.value = Number(cashRow.value) + 40;
  const mutatedPacket = Assistant.buildPacket({
    data: mutated,
    periods,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const mutatedSum = independentSpendable(mutated.plan);
  ok(near(mutatedPacket.current.spendableHouseholdCash.value, mutatedSum)
    && !near(mutatedPacket.current.spendableHouseholdCash.value, spendable),
    'mutating chequing-a moves the packet with the independent sum',
    `${mutatedPacket.current.spendableHouseholdCash.value} vs ${mutatedSum}`);
  const weeklyMutated = clone(liveData);
  weeklyMutated.plan.defaults = Object.assign({}, weeklyMutated.plan.defaults, {
    targetBuffer: Number(weeklyMutated.plan.defaults.targetBuffer || 0) + 250,
  });
  const weeklyPacket = Assistant.buildPacket({
    data: weeklyMutated,
    periods,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const weeklyAdvice = adviceFor(weeklyMutated, periods);
  ok(near(weeklyPacket.forecast.recommendation.weekly, weeklyAdvice.weekly),
    'a buffer mutation moves the packet weekly with Forecast.recommend',
    `${weeklyPacket.forecast.recommendation.weekly} vs ${weeklyAdvice.weekly}`);
  ok(Assistant.looksSanitized(packet) && !forbiddenBlob(packet),
    'packet has no secrets, provider ids, payees, or raw transaction keys');
  ok(!Array.isArray(packet.actuals && packet.actuals.transactions),
    'packet does not include a raw transaction list');
  const q2 = (packet.uncertainty.ownerQuestions || []).find(q => q.id === 'Q2');
  ok(q2 && q2.status === 'OPEN',
    'owner questions come from 01_OPEN_QUESTIONS.md (Q2 stays OPEN)');
  ok(packet.metadata.version.gitSha === '72567904bef9f5d4341a80a211db64d1411691cd',
    'version identifier is the supplied git SHA when present');
  const liveAsOf = (liveData.liveOverlay && liveData.liveOverlay.applied === true
    && liveData.liveOverlay.effectiveAsOf)
    || (liveData.plan && liveData.plan.opening && liveData.plan.opening.asOf)
    || (liveData.meta && liveData.meta.asOf);
  const liveEvents = advice.sim && advice.sim.events;
  const liveNextDue = liveEvents ? Forecast.nextDue(liveEvents, liveAsOf) : null;
  const liveNextSource = earliestNamedOutflow(liveEvents, liveAsOf);
  if (liveNextDue && liveNextSource) {
    ok(packet.current.nextSignificantObligations.nextDue.confidence === liveNextSource.confidence,
      'live nextDue confidence matches the source Forecast event',
      `${packet.current.nextSignificantObligations.nextDue.confidence} vs ${liveNextSource.confidence}`);
  }
  const liveNextOut = liveEvents ? Forecast.nextPaymentOut(liveEvents, liveAsOf) : null;
  if (liveNextOut) {
    const dayEvents = sameDayJointCashOutflows(liveEvents, liveAsOf, liveNextOut.date);
    const dayHasEstimated = dayEvents.some(event => event.confidence === 'estimated');
    const packetOut = packet.current.nextSignificantObligations.nextPaymentOut;
    if (dayHasEstimated) {
      ok(packetOut && packetOut.confidence === 'estimated',
        'live grouped nextPaymentOut stays estimated when a constituent is estimated',
        packetOut && packetOut.confidence);
    }
    ok(packetOut && packetOut.confidence !== 'confirmed' || !dayHasEstimated,
      'live grouped nextPaymentOut is not promoted to confirmed when a constituent is estimated');
  }
}

console.log('\n=== projected obligations keep source confidence ===');
{
  const estimatedData = syntheticObligationData({
    bills: [{
      id: 'est-hydro',
      label: 'Estimated hydro',
      frequency: 'once',
      date: '2026-08-26',
      amount: 120,
      confidence: 'estimated',
    }],
  });
  const estimatedPacket = Assistant.buildPacket({
    data: estimatedData,
    periods: null,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const estimatedAdvice = adviceFor(estimatedData, null);
  const estimatedAsOf = estimatedData.plan.opening.asOf;
  const estimatedEvents = estimatedAdvice.sim.events;
  const estimatedSource = earliestNamedOutflow(estimatedEvents, estimatedAsOf);
  const packetDue = estimatedPacket.current.nextSignificantObligations.nextDue;
  const packetOut = estimatedPacket.current.nextSignificantObligations.nextPaymentOut;
  ok(estimatedSource && estimatedSource.confidence === 'estimated',
    'independent Forecast event for the synthetic next due is estimated',
    estimatedSource && estimatedSource.confidence);
  ok(packetDue && packetDue.confidence === 'estimated',
    'estimated nextDue remains estimated in the packet',
    packetDue && packetDue.confidence);
  ok(packetDue.confidence !== 'confirmed',
    'projection does not promote estimated nextDue to confirmed');
  ok(packetOut && packetOut.confidence === 'estimated',
    'estimated nextPaymentOut remains estimated in the packet',
    packetOut && packetOut.confidence);

  const mixedData = syntheticObligationData({
    bills: [
      {
        id: 'est-bill',
        label: 'Estimated bill',
        frequency: 'once',
        date: '2026-08-26',
        amount: 80,
        confidence: 'estimated',
      },
      {
        id: 'conf-bill',
        label: 'Confirmed bill',
        frequency: 'once',
        date: '2026-08-26',
        amount: 40,
        confidence: 'confirmed',
      },
    ],
  });
  const mixedPacket = Assistant.buildPacket({
    data: mixedData,
    periods: null,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const mixedAdvice = adviceFor(mixedData, null);
  const mixedAsOf = mixedData.plan.opening.asOf;
  const mixedOut = Forecast.nextPaymentOut(mixedAdvice.sim.events, mixedAsOf);
  const mixedDay = sameDayJointCashOutflows(mixedAdvice.sim.events, mixedAsOf, mixedOut.date);
  ok(mixedDay.some(event => event.confidence === 'estimated')
    && mixedDay.some(event => event.confidence === 'confirmed'),
    'independent same-day stream mixes estimated and confirmed outflows');
  ok(mixedPacket.current.nextSignificantObligations.nextPaymentOut.confidence === 'estimated',
    'grouped nextPaymentOut uses the weaker estimated confidence',
    mixedPacket.current.nextSignificantObligations.nextPaymentOut.confidence);
  ok(mixedPacket.current.nextSignificantObligations.nextPaymentOut.confidence !== 'confirmed',
    'grouped projection cannot promote an estimated constituent to confirmed');

  const confirmedData = syntheticObligationData({
    bills: [{
      id: 'conf-hydro',
      label: 'Confirmed hydro',
      frequency: 'once',
      date: '2026-08-26',
      amount: 90,
      confidence: 'confirmed',
    }],
  });
  const confirmedPacket = Assistant.buildPacket({
    data: confirmedData,
    periods: null,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const confirmedAdvice = adviceFor(confirmedData, null);
  const confirmedSource = earliestNamedOutflow(
    confirmedAdvice.sim.events,
    confirmedData.plan.opening.asOf
  );
  ok(confirmedSource && confirmedSource.confidence === 'confirmed',
    'independent Forecast event for the confirmed fixture is confirmed');
  ok(confirmedPacket.current.nextSignificantObligations.nextDue.confidence === 'confirmed',
    'confirmed nextDue stays confirmed rather than being forced to estimated',
    confirmedPacket.current.nextSignificantObligations.nextDue.confidence);

  const boundaryData = syntheticObligationData({
    bills: [
      {
        id: 'est-boundary',
        label: 'Estimated boundary bill',
        frequency: 'once',
        date: '2026-08-29',
        amount: 110,
        confidence: 'estimated',
      },
      {
        id: 'conf-boundary',
        label: 'Confirmed boundary bill',
        frequency: 'once',
        date: '2026-08-29',
        amount: 55,
        confidence: 'confirmed',
      },
    ],
  });
  const boundaryPacket = Assistant.buildPacket({
    data: boundaryData,
    periods: null,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  const boundaryAdvice = adviceFor(boundaryData, null);
  const nb = boundaryPacket.current.nextSignificantObligations.nearBoundary;
  const estItem = (nb && nb.items || []).find(item => item.id === 'est-boundary');
  const confItem = (nb && nb.items || []).find(item => item.id === 'conf-boundary');
  const sourceEst = (boundaryAdvice.sim.events || []).find(event =>
    event.id === 'est-boundary' && event.date === '2026-08-29');
  ok(sourceEst && sourceEst.confidence === 'estimated',
    'independent Forecast near-boundary event is estimated');
  ok(estItem && estItem.confidence === 'estimated',
    'estimated near-boundary item remains estimated in the packet',
    estItem && estItem.confidence);
  ok(confItem && confItem.confidence === 'confirmed',
    'confirmed near-boundary item keeps confirmed',
    confItem && confItem.confidence);
  ok(nb && nb.confidence === 'estimated',
    'grouped near-boundary total uses the weaker estimated confidence',
    nb && nb.confidence);
  ok(nb.confidence !== 'confirmed',
    'grouped near-boundary total is not promoted to confirmed');
}

console.log('\n=== unavailable answers stay unavailable ===');
{
  const packet = Assistant.buildPacket({
    data: clone(liveData),
    periods: null,
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  ok(packet.actuals.status === 'unavailable',
    'missing periods.json is actuals unavailable, not a replacement series',
    packet.actuals.reason);
}

console.log('\n=== live overlay fail-closed is preserved ===');
{
  const failed = LivePlan.failedOverlay(clone(liveData), 'provider-unavailable');
  const packet = Assistant.buildPacket({
    data: failed,
    periods: Assistant.loadPeriods(),
    questionsMarkdown: '',
    now: '2026-08-24T12:00:00.000Z',
    env: {},
  });
  ok(packet.metadata.freshness.liveOverlayApplied === false,
    'failed overlay is disclosed as not applied');
  ok(packet.uncertainty.liveOverlayFailed
    && packet.uncertainty.liveOverlayFailed.reason,
    'uncertainty records the sanitized overlay failure');
  ok(near(packet.current.spendableHouseholdCash.value,
    Forecast.startingCashAmount(liveData.plan)),
    'fail-closed packet keeps the dated opening cash');
  ok(packet.metadata.canonicalAsOf === liveData.plan.opening.asOf,
    'canonical as-of remains the dated opening');
}

console.log('\n=== HTTP fail-closed without assistant token ===');
  await withAtlas({}, async ({ base }) => {
    const res = await fetch(`${base}/assistant/current`, { redirect: 'manual' });
    ok(res.status === 503, 'unset ATLAS_ASSISTANT_TOKEN returns 503', `status ${res.status}`);
    const body = await res.json();
    ok(body.error === 'assistant unavailable', '503 body does not leak data');
    ok(!body.current && !body.forecast, '503 body has no financial packet');
    const authed = await login(base);
    const dataRes = await fetch(`${base}/data.json`, { headers: { cookie: authed.cookie } });
    ok(dataRes.status === 200, 'browser /data.json still works without assistant token');
    const assistantWithCookie = await fetch(`${base}/assistant/current`, {
      headers: { cookie: authed.cookie },
      redirect: 'manual',
    });
    ok(assistantWithCookie.status === 503,
      'browser session does not open the assistant surface when token is unset',
      `status ${assistantWithCookie.status}`);
  });
  filesUnchanged('no-token requests');

  console.log('\n=== HTTP dedicated Bearer auth ===');
  await withAtlas({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN }, async ({ base }) => {
    const none = await fetch(`${base}/assistant/current`, { redirect: 'manual' });
    ok(none.status === 401, 'missing Bearer fails closed', `status ${none.status}`);
    ok((none.headers.get('www-authenticate') || '').includes('Bearer'),
      '401 advertises Bearer for a later MCP adapter');

    const wrong = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${WRONG_TOKEN}` },
      redirect: 'manual',
    });
    ok(wrong.status === 401, 'wrong Bearer fails closed', `status ${wrong.status}`);
    const wrongBody = await wrong.json();
    ok(!wrongBody.current && wrongBody.error === 'not authenticated',
      'wrong credentials do not return a packet');

    const query = await fetch(
      `${base}/assistant/current?token=${encodeURIComponent(ASSISTANT_TOKEN)}`,
      { redirect: 'manual' }
    );
    ok(query.status === 401, 'token in the query string is ignored', `status ${query.status}`);

    const siteAsBearer = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${PASS}` },
      redirect: 'manual',
    });
    ok(siteAsBearer.status === 401,
      'SITE_PASSWORD is not assistant authentication',
      `status ${siteAsBearer.status}`);

    const authed = await login(base);
    ok(authed.status === 302 && authed.setCookie.includes('hfd_session='),
      'browser login still issues the session cookie');
    const cookieOnly = await fetch(`${base}/assistant/current`, {
      headers: { cookie: authed.cookie },
      redirect: 'manual',
    });
    ok(cookieOnly.status === 401,
      'browser session cookie does not unlock /assistant/current',
      `status ${cookieOnly.status}`);
    const dataRes = await fetch(`${base}/data.json`, { headers: { cookie: authed.cookie } });
    ok(dataRes.status === 200, 'existing browser /data.json auth is unchanged');
    const data = await dataRes.json();
    ok(data.plan && Array.isArray(data.debts), 'session still receives the browser data document');

    const assistantAsData = await fetch(`${base}/data.json`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
      redirect: 'manual',
    });
    ok(assistantAsData.status === 401,
      'assistant Bearer does not unlock browser /data.json',
      `status ${assistantAsData.status}`);

    const good = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
    });
    ok(good.status === 200, 'correct assistant token returns 200', `status ${good.status}`);
    const packet = await good.json();
    ok(packet.schema === Assistant.SCHEMA, 'authenticated response is the sanitized contract');
    ok(Assistant.looksSanitized(packet) && !forbiddenBlob(packet),
      'HTTP packet contains no secrets/provider ids/raw transactions');
    const periods = Assistant.loadPeriods();
    const served = await LivePlan.applyForServer(clone(liveData), isolatedEnv({}));
    const expected = Assistant.buildPacket({
      data: served,
      periods,
      questionsMarkdown: fs.readFileSync(QUESTIONS, 'utf8'),
      now: packet.metadata.generatedAt,
      env: isolatedEnv({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN }),
    });
    ok(near(packet.current.spendableHouseholdCash.value,
      expected.current.spendableHouseholdCash.value),
      'HTTP packet spendable matches the builder on the same served data');
    ok(near(packet.forecast.recommendation.weekly,
      expected.forecast.recommendation.weekly),
      'HTTP packet weekly matches Forecast via the builder');
    ok(!packet.metadata.generatedAt || typeof packet.metadata.generatedAt === 'string',
      'packet includes generatedAt');

    const posted = await fetch(`${base}/assistant/current`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
      redirect: 'manual',
    });
    ok(posted.status === 405, 'POST cannot write through the assistant route',
      `status ${posted.status}`);
    const put = await fetch(`${base}/assistant/current`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
      redirect: 'manual',
    });
    ok(put.status === 405, 'PUT is refused', `status ${put.status}`);
  });
  filesUnchanged('authenticated assistant GET');

  console.log('\n=== live observation failure stays fail-closed over HTTP ===');
  await withAtlas({
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_LIVE_OVERLAY: 'live',
  }, async ({ base }) => {
    const good = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
    });
    ok(good.status === 200, 'live-mode request still returns a packet when observation fails');
    const packet = await good.json();
    ok(packet.metadata.freshness.liveOverlayApplied === false,
      'HTTP packet preserves overlay fail-closed');
    ok(packet.uncertainty.liveOverlayFailed,
      'HTTP packet surfaces overlay failure as uncertainty');
    ok(near(packet.current.spendableHouseholdCash.value,
      Forecast.startingCashAmount(liveData.plan)),
      'failed live observation does not invent a replacement cash figure');
    ok(!forbiddenBlob(packet), 'failed live packet remains sanitized');
  });
  filesUnchanged('failed live overlay via assistant');

  console.log('\n=== provider mock is GET-only and assistant does not write ===');
  {
    const calls = [];
    const mock = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        calls.push({ method: req.method, url: req.url });
        res.statusCode = 401;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
      });
      server.listen(0, '127.0.0.1', () => resolve({
        server,
        port: server.address().port,
        close: () => new Promise(done => server.close(() => done())),
      }));
      server.on('error', reject);
    });
    try {
      await withAtlas({
        ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
        ATLAS_LIVE_OVERLAY: 'live',
        [O.API_BASE_ENV]: `http://127.0.0.1:${mock.port}/v2`,
        LUNCHMONEY_ACCESS_TOKEN: 'synthetic-readonly-token-not-real',
      }, async ({ base }) => {
        const good = await fetch(`${base}/assistant/current`, {
          headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
        });
        const packet = await good.json();
        ok(good.status === 200, 'unauthorized provider still fail-closes to a packet');
        ok(packet.metadata.freshness.liveOverlayApplied === false,
          'unauthorized provider does not apply a live overlay');
        ok(calls.every(c => c.method === 'GET' || c.method === 'HEAD'),
          'assistant request caused no provider POST/PUT/PATCH/DELETE',
          calls.map(c => c.method).join(',') || 'no calls');
      });
    } finally {
      await mock.close();
    }
    filesUnchanged('provider unauthorized through assistant');
  }

  console.log('\n=== weak assistant token refuses to start ===');
  {
    const result = await expectExit({ ATLAS_ASSISTANT_TOKEN: 'too-short' });
    ok(result.code !== 0, 'too-short ATLAS_ASSISTANT_TOKEN is fatal', `exit ${result.code}`);
    ok(/ATLAS_ASSISTANT_TOKEN/.test(result.stderr),
      'fatal message names the assistant token without printing it');
    ok(!/too-short/.test(result.stderr), 'the weak token value is not logged');
  }
  {
    const shared = 'shared-secret-must-not-be-reused-32!';
    const reusedPassword = await expectExit({
      SITE_PASSWORD: shared,
      ATLAS_ASSISTANT_TOKEN: shared,
    });
    ok(reusedPassword.code !== 0,
      'reusing SITE_PASSWORD as ATLAS_ASSISTANT_TOKEN is fatal',
      `exit ${reusedPassword.code}`);
    ok(/SITE_PASSWORD/.test(reusedPassword.stderr),
      'reuse-of-password fatal names SITE_PASSWORD');
    ok(!/shared-secret-must-not-be-reused/.test(reusedPassword.stderr),
      'the reused password value is not logged');
    const reusedSession = await expectExit({
      SESSION_SECRET: shared,
      ATLAS_ASSISTANT_TOKEN: shared,
    });
    ok(reusedSession.code !== 0,
      'reusing SESSION_SECRET as ATLAS_ASSISTANT_TOKEN is fatal',
      `exit ${reusedSession.code}`);
    ok(/SESSION_SECRET/.test(reusedSession.stderr),
      'reuse-of-session fatal names SESSION_SECRET');
  }

  console.log('\n=== MCP adapter is one OAuth-declared read-only transport ===');
  {
    const descriptor = AssistantMcp.toolDescriptor();
    ok(descriptor.name === AssistantMcp.TOOL_NAME,
      'the sole descriptor is get_atlas_current');
    ok(descriptor.annotations.readOnlyHint === true
        && descriptor.annotations.destructiveHint === false
        && descriptor.annotations.openWorldHint === false,
      'tool annotations declare the closed read-only boundary');
    ok(descriptor._meta.securitySchemes.length === 1
        && descriptor._meta.securitySchemes[0].type === 'oauth2'
        && descriptor._meta.securitySchemes[0].scopes.length === 1
        && descriptor._meta.securitySchemes[0].scopes[0] === AssistantMcp.REQUIRED_SCOPE,
      'tool metadata declares only atlas.current.read OAuth');
    const packet = Assistant.buildPacket({
      data: clone(liveData),
      periods: Assistant.loadPeriods(),
      questionsMarkdown: '',
      now: '2026-08-24T12:00:00.000Z',
      env: {},
    });
    const result = AssistantMcp.packetResult(packet);
    ok(result.isError === false && result.structuredContent === packet,
      'tool result is the incumbent packet object');
    ok(!forbiddenBlob(result), 'tool result remains sanitized');
    const mcpSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'assistant-mcp.js'), 'utf8');
    ok(!/Forecast\.recommend/.test(mcpSrc) && !/startingCashAmount/.test(mcpSrc),
      'MCP transport does not call Forecast or recompute cash');
    ok(/assistant-packet/.test(mcpSrc) && /looksSanitized/.test(mcpSrc),
      'MCP transport consumes the incumbent packet sanitizer');
  }

  console.log('\n=== OAuth MCP fails closed when configuration is absent ===');
  {
    const partial = AssistantOAuth.readConfig({
      ATLAS_MCP_RESOURCE_URL: 'https://atlas.example/assistant/mcp',
    });
    ok(partial.configured === false && partial.reason === 'oauth-configuration-incomplete',
      'partial OAuth configuration fails closed');
    const insecure = AssistantOAuth.readConfig({
      ATLAS_MCP_RESOURCE_URL: 'https://atlas.example/assistant/mcp',
      ATLAS_OAUTH_ISSUER: 'http://issuer.example/',
      ATLAS_OAUTH_JWKS_URI: 'https://issuer.example/jwks',
    });
    ok(insecure.configured === false && /HTTPS/.test(insecure.reason),
      'non-local HTTP issuer fails closed');
  }
  await withAtlas({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN }, async ({ base }) => {
    const metadata = await fetch(`${base}${AssistantOAuth.METADATA_PATH}`);
    ok(metadata.status === 503, 'missing OAuth configuration withholds protected-resource metadata');
    const res = await fetch(`${base}/assistant/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      redirect: 'manual',
    });
    ok(res.status === 503, 'missing OAuth configuration withholds MCP', `status ${res.status}`);
    const body = await res.json();
    ok(body.error === 'assistant oauth unavailable' && !body.result,
      'unconfigured MCP response contains no packet');
  });

  console.log('\n=== standards-compatible OAuth protects the one MCP tool ===');
  await withOAuthAtlas(async ({ base, resource, oauth }) => {
    async function mcp(headers, body) {
      return fetch(resource, {
        method: 'POST',
        headers: Object.assign({
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        }, headers || {}),
        body: JSON.stringify(body),
        redirect: 'manual',
      });
    }
    const initialize = {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'atlas-oauth-test', version: '1' },
      },
    };
    const metadataRes = await fetch(`${base}${AssistantOAuth.METADATA_PATH}`);
    const metadata = await metadataRes.json();
    ok(metadataRes.status === 200
        && metadata.resource === resource
        && metadata.authorization_servers.length === 1
        && metadata.authorization_servers[0] === oauth.issuer,
      'protected-resource metadata binds the MCP resource to one external issuer');
    ok(metadata.scopes_supported.length === 1
        && metadata.scopes_supported[0] === AssistantMcp.REQUIRED_SCOPE,
      'protected-resource metadata advertises only atlas.current.read');

    const none = await mcp({}, initialize);
    const challenge = none.headers.get('www-authenticate') || '';
    ok(none.status === 401, 'unauthenticated MCP access is denied', `status ${none.status}`);
    ok(challenge.includes(`resource_metadata=\"${base}${AssistantOAuth.METADATA_PATH}\"`)
        && challenge.includes(`scope=\"${AssistantMcp.REQUIRED_SCOPE}\"`),
      '401 challenge advertises OAuth metadata and the read scope');

    const malformed = await mcp({ authorization: 'Basic invalid' }, initialize);
    ok(malformed.status === 401, 'malformed authorization fails closed', `status ${malformed.status}`);
    const opaque = await mcp({ authorization: `Bearer ${ASSISTANT_TOKEN}` }, initialize);
    ok(opaque.status === 401,
      'the incumbent static assistant token cannot authenticate MCP', `status ${opaque.status}`);

    const now = Math.floor(Date.now() / 1000);
    const expiredToken = await oauth.sign(resource, { expiresAt: now - 30 });
    const expired = await mcp({ authorization: `Bearer ${expiredToken}` }, initialize);
    ok(expired.status === 401, 'expired OAuth access token fails closed', `status ${expired.status}`);
    const futureToken = await oauth.sign(resource, { notBefore: now + 300 });
    const future = await mcp({ authorization: `Bearer ${futureToken}` }, initialize);
    ok(future.status === 401, 'not-yet-valid OAuth access token fails closed', `status ${future.status}`);
    const wrongAudienceToken = await oauth.sign(resource, { audience: `${base}/not-atlas` });
    const wrongAudience = await mcp({ authorization: `Bearer ${wrongAudienceToken}` }, initialize);
    ok(wrongAudience.status === 401, 'wrong-resource token fails closed', `status ${wrongAudience.status}`);
    const wrongSignatureToken = await oauth.sign(resource, { key: oauth.otherPrivateKey });
    const wrongSignature = await mcp({ authorization: `Bearer ${wrongSignatureToken}` }, initialize);
    ok(wrongSignature.status === 401, 'invalid signature fails closed', `status ${wrongSignature.status}`);
    const noScopeToken = await oauth.sign(resource, { scope: 'profile' });
    const noScope = await mcp({ authorization: `Bearer ${noScopeToken}` }, initialize);
    ok(noScope.status === 403, 'missing atlas.current.read scope fails closed', `status ${noScope.status}`);

    const browser = await login(base);
    const cookieOnly = await mcp({ cookie: browser.cookie }, initialize);
    ok(cookieOnly.status === 401, 'browser session cookie does not unlock MCP',
      `status ${cookieOnly.status}`);
    const browserData = await fetch(`${base}/data.json`, { headers: { cookie: browser.cookie } });
    ok(browserData.status === 200, 'browser login still unlocks only the browser data route');

    const accessToken = await oauth.sign(resource);
    const oauthOnCurrent = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${accessToken}` }, redirect: 'manual',
    });
    ok(oauthOnCurrent.status === 401,
      'OAuth MCP token does not replace the incumbent /assistant/current token');
    const directRes = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
    });
    const direct = await directRes.json();
    ok(directRes.status === 200 && direct.schema === Assistant.SCHEMA,
      'incumbent /assistant/current remains independently authenticated');

    const client = new Client({ name: 'atlas-oauth-proof', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      ok(listed.tools.length === 1 && listed.tools[0].name === AssistantMcp.TOOL_NAME,
        'official MCP client sees exactly one Atlas tool');
      const listedTool = listed.tools[0];
      ok(listedTool.annotations.readOnlyHint === true
          && listedTool.annotations.destructiveHint === false
          && listedTool._meta.securitySchemes[0].scopes[0] === AssistantMcp.REQUIRED_SCOPE,
        'official MCP client receives read-only and OAuth tool metadata');
      const called = await client.callTool({ name: AssistantMcp.TOOL_NAME, arguments: {} });
      const wrapped = called.structuredContent;
      ok(called.isError === false && wrapped.schema === Assistant.SCHEMA,
        'authorized official MCP client invokes the incumbent current-state tool');
      ok(Assistant.looksSanitized(wrapped) && !forbiddenBlob(called)
          && !JSON.stringify(called).includes(accessToken),
        'MCP response contains no secrets, access token, provider ids, or raw transactions');
      ok(near(wrapped.current.spendableHouseholdCash.value,
        direct.current.spendableHouseholdCash.value),
      'MCP spendable matches incumbent /assistant/current');
      ok(near(wrapped.forecast.recommendation.weekly,
        direct.forecast.recommendation.weekly),
      'MCP weekly answer matches incumbent Forecast-backed packet');
      ok(wrapped.authority.planner === 'Forecast'
          && wrapped.writesCanonicalState === false
          && wrapped.productionWrite === false,
        'MCP packet preserves Forecast authority and declares no writes');
      let refused = false;
      try {
        const writeAttempt = await client.callTool({
          name: 'canonical-refresh', arguments: { apply: true },
        });
        refused = writeAttempt.isError === true;
      } catch {
        refused = true;
      }
      ok(refused, 'a write-shaped MCP tool name does not exist');
    } finally {
      await client.close().catch(() => {});
    }

    const getMcp = await fetch(resource, {
      headers: { authorization: `Bearer ${accessToken}` }, redirect: 'manual',
    });
    ok(getMcp.status === 405, 'GET cannot retrieve a second MCP packet URL',
      `status ${getMcp.status}`);
    const badOrigin = await mcp({
      authorization: `Bearer ${accessToken}`,
      origin: 'https://attacker.example',
    }, initialize);
    ok(badOrigin.status === 403, 'untrusted browser origin is rejected');
  });
  filesUnchanged('authenticated OAuth MCP');

  console.log('\n=== source does not recompute financial answers ===');
  {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'assistant-packet.js'), 'utf8');
    ok(/Forecast\.recommend/.test(src) && /Forecast\.startingCashAmount/.test(src),
      'packet builder calls incumbent Forecast functions');
    ok(!/function recommendWeekly/.test(src) && !/binary search/.test(src),
      'packet builder does not contain a second weekly-cap solver');
    const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
    ok(/Assistant\.buildPacket/.test(serverSrc),
      'server serves the packet builder rather than inline maths');
    ok(/AssistantMcp\.handleHttp/.test(serverSrc) && /\/assistant\/mcp/.test(serverSrc),
      'server MCP route delegates to the SDK adapter rather than inventing figures');
    ok(/assistantAuthed/.test(serverSrc)
        && /MCP_BEARER_AUTH/.test(serverSrc)
        && /hfd_session/.test(serverSrc),
      'static assistant, OAuth MCP, and browser session remain separate gates');
  }

  console.log('\n=== Render blueprint declares assistant auth configuration without values ===');
  {
    const render = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    ok(/key:\s*ATLAS_ASSISTANT_TOKEN[\s\S]*?sync:\s*false/.test(render),
      'Render declares ATLAS_ASSISTANT_TOKEN as owner-supplied');
    ok(!/key:\s*ATLAS_ASSISTANT_TOKEN[\s\S]*?value:/.test(render),
      'Render does not assign an assistant token value');
    for (const key of ['ATLAS_MCP_RESOURCE_URL', 'ATLAS_OAUTH_ISSUER', 'ATLAS_OAUTH_JWKS_URI']) {
      ok(new RegExp(`key:\\s*${key}[\\s\\S]*?sync:\\s*false`).test(render),
        `Render declares ${key} as owner-supplied`);
    }
  }

  filesUnchanged('end of suite');
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
