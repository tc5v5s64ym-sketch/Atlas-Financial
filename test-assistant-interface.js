'use strict';
/* Read-only assistant interface.
 *
 * Proves GET /assistant/current is fail-closed, uses a dedicated Bearer
 * secret, projects incumbent Forecast / live-overlay / periods results,
 * never writes, and does not weaken browser session auth.
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
    ok(/assistantAuthed/.test(serverSrc) && /hfd_session/.test(serverSrc),
      'assistant Bearer and browser session remain separate gates');
  }

  console.log('\n=== Render blueprint declares the assistant secret without a value ===');
  {
    const render = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    ok(/key:\s*ATLAS_ASSISTANT_TOKEN[\s\S]*?sync:\s*false/.test(render),
      'Render declares ATLAS_ASSISTANT_TOKEN as owner-supplied');
    ok(!/key:\s*ATLAS_ASSISTANT_TOKEN[\s\S]*?value:/.test(render),
      'Render does not assign an assistant token value');
  }

  filesUnchanged('end of suite');
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
