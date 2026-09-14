'use strict';
/* Talk to Atlas — session context packet seam.
 *
 * Proves GET /talk/context is the household-session consumer of the
 * incumbent scripts/assistant-packet.js packet, that Talk UI shows
 * metadata only, and that browser session, static assistant Bearer, and
 * MCP OAuth still do not unlock one another.
 * `node test/test-talk-context.js`
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const vm = require('vm');
const { spawn } = require('child_process');
const Assistant = require('../scripts/assistant-packet.js');
const AssistantMcp = require('../scripts/assistant-mcp.js');
const LivePlan = require('../scripts/live-plan.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const QUESTIONS = path.join(ROOT, 'docs', '01_OPEN_QUESTIONS.md');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const ASSISTANT_TOKEN = 'synthetic-assistant-token-32chars!!';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = value => JSON.parse(JSON.stringify(value));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

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
    || /synthetic-assistant-token/.test(text);
}

function packetCore(packet) {
  const copy = clone(packet);
  if (copy && copy.metadata) delete copy.metadata.generatedAt;
  return copy;
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
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
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
    return await fn({ base: `http://127.0.0.1:${port}`, atlas });
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
    return new jose.SignJWT({
      scope: overrides.scope === undefined ? AssistantMcp.REQUIRED_SCOPE : overrides.scope,
      client_id: 'chatgpt-test-client',
      sub: 'atlas-owner-test',
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'atlas-test-key' })
      .setIssuer(overrides.issuer || issuer)
      .setAudience(overrides.audience || resource)
      .setIssuedAt(now)
      .setNotBefore(now - 1)
      .setExpirationTime(now + 300)
      .sign(pair.privateKey);
  }
  return {
    issuer,
    jwksUri: `${issuer}jwks`,
    sign,
    close: () => new Promise(done => server.close(() => done())),
  };
}

function loadTalkContextStatus() {
  const src = read('public/talk.js');
  const sandbox = {
    App: { boot() {} },
    fetch() { return Promise.resolve({ ok: false, json: async () => ({}) }); },
    $(id) {
      return id === 'talk-context'
        ? { textContent: '', dataset: {}, hidden: false }
        : null;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nthis.__talkContextStatus = talkContextStatus;', sandbox);
  return sandbox.__talkContextStatus;
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

console.log('=== 1. Talk UI consumes metadata only; no Forecast, no model ===');
{
  const src = stripComments(read('public/talk.js'));
  const html = read('public/talk.html');
  const css = read('public/talk.css');
  const serverSrc = read('server.js');
  ok(/id="talk-context"/.test(html) && /talk-context/.test(css),
    'Talk page has a context-status mount');
  ok(/fetch\(TALK_CONTEXT_PATH/.test(src) && /credentials:\s*'same-origin'/.test(src),
    'talk.js fetches /talk/context with the browser session only');
  ok(!/assistant\/current|assistant\/mcp/.test(src + html),
    'Talk browser code does not call /assistant/current or /assistant/mcp');
  ok(!/Authorization|Bearer|ATLAS_ASSISTANT|oauth/i.test(src),
    'talk.js does not send assistant Bearer or OAuth');
  ok(!/Forecast|recommend\(|money2\(|startingCashAmount|paydayAllocation/.test(src),
    'talk.js does not duplicate Forecast calculation');
  ok(!/packet\.current|packet\.forecast|packet\.actuals|spendableHouseholdCash|weeklyCap/.test(src),
    'talk.js does not project financial packet fields into the UI');
  ok(/metadata\.effectiveAsOf|metadata\.canonicalAsOf/.test(src)
      && /freshness/.test(src) && /confidence/.test(src),
    'talk.js reads as-of and freshness/trust already on the packet');
  ok(/send\.disabled = true/.test(src) && /INTELLIGENCE SEAM/.test(read('public/talk.js')),
    'Send stays disabled and the intelligence seam remains named');
  ok(!/openai|anthropic|chatgpt|llm|\/talk\/complete|\/talk\/ask|chat\/completions/i.test(src + html + serverSrc),
    'no model or chat-completion endpoint is wired');
  ok(/app\.get\('\/talk\/context'/.test(serverSrc)
      && /buildCurrentAssistantPacket/.test(serverSrc)
      && /Assistant\.buildPacket/.test(serverSrc),
    'server Talk seam calls the incumbent packet builder');
  ok(!/app\.(post|put|patch|delete)\('\/talk\/context'/.test(serverSrc),
    'Talk context seam is GET-only in source');

  const status = loadTalkContextStatus();
  const connected = status({
    schema: Assistant.SCHEMA,
    metadata: {
      effectiveAsOf: '2026-08-19',
      canonicalAsOf: '2026-08-16',
      freshness: { confidence: 'live' },
    },
  });
  ok(connected.state === 'available'
      && connected.text === 'Atlas context connected · as of 2026-08-19 · live',
    'available packet metadata becomes the context-connected line');
  const fallback = status({
    schema: Assistant.SCHEMA,
    metadata: {},
  });
  ok(fallback.state === 'available' && fallback.text === 'Atlas context connected',
    'packet without as-of/trust still says Atlas context connected');
  const missing = status({ schema: 'not-the-packet' });
  ok(missing.state === 'unavailable' && missing.text === 'Atlas context unavailable',
    'a non-packet body is unavailable');
}

(async () => {
  console.log('\n=== 2. Session Talk seam serves the incumbent packet ===');
  await withAtlas({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN }, async ({ base }) => {
    const anon = await fetch(`${base}/talk/context`, { redirect: 'manual' });
    ok(anon.status === 401, 'anonymous GET /talk/context is 401 JSON',
      `status ${anon.status}`);
    const anonBody = await anon.json();
    ok(anonBody.error === 'not authenticated' && !anonBody.schema && !anonBody.current,
      'anonymous Talk context returns no packet');

    const authed = await login(base);
    ok(authed.status === 302 && /^hfd_session=/.test(authed.cookie),
      'synthetic login issues a session');
    const talkRes = await fetch(`${base}/talk/context`, {
      headers: { cookie: authed.cookie },
    });
    ok(talkRes.status === 200, 'browser session unlocks GET /talk/context',
      `status ${talkRes.status}`);
    const talkPacket = await talkRes.json();
    ok(talkPacket.schema === Assistant.SCHEMA,
      'Talk context is the incumbent assistant-packet schema');
    ok(Assistant.looksSanitized(talkPacket) && !forbiddenBlob(talkPacket),
      'Talk context packet contains no secrets/provider ids/raw transactions');
    ok(talkPacket.writesCanonicalState === false
        && talkPacket.productionWrite === false
        && talkPacket.authority && talkPacket.authority.planner === 'Forecast',
      'Talk packet preserves Forecast authority and declares no writes');

    const assistantRes = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
    });
    ok(assistantRes.status === 200, 'incumbent /assistant/current still works');
    const assistantPacket = await assistantRes.json();
    ok(JSON.stringify(packetCore(talkPacket)) === JSON.stringify(packetCore(assistantPacket)),
      'Talk/browser packet agrees with /assistant/current except generatedAt');

    const served = await LivePlan.applyForServer(
      clone(JSON.parse(fs.readFileSync(DATA, 'utf8'))),
      isolatedEnv({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN })
    );
    const expected = Assistant.buildPacket({
      data: served,
      periods: Assistant.loadPeriods(),
      questionsMarkdown: fs.readFileSync(QUESTIONS, 'utf8'),
      now: talkPacket.metadata.generatedAt,
      env: isolatedEnv({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN }),
    });
    ok(JSON.stringify(talkPacket) === JSON.stringify(expected),
      'Talk packet equals the incumbent builder on the same served state');

    const sessionOnCurrent = await fetch(`${base}/assistant/current`, {
      headers: { cookie: authed.cookie },
      redirect: 'manual',
    });
    ok(sessionOnCurrent.status === 401,
      'browser session still cannot access /assistant/current',
      `status ${sessionOnCurrent.status}`);
    const sessionOnMcp = await fetch(`${base}/assistant/mcp`, {
      method: 'POST',
      headers: {
        cookie: authed.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      redirect: 'manual',
    });
    ok(sessionOnMcp.status === 401 || sessionOnMcp.status === 503,
      'browser session still cannot access /assistant/mcp',
      `status ${sessionOnMcp.status}`);

    const bearerOnTalk = await fetch(`${base}/talk/context`, {
      headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
      redirect: 'manual',
    });
    ok(bearerOnTalk.status === 401,
      'assistant Bearer alone cannot unlock /talk/context',
      `status ${bearerOnTalk.status}`);
    const bearerBody = await bearerOnTalk.json();
    ok(!bearerBody.schema && bearerBody.error === 'not authenticated',
      'Bearer-only Talk response contains no packet');

    const posted = await fetch(`${base}/talk/context`, {
      method: 'POST',
      headers: { cookie: authed.cookie },
      redirect: 'manual',
    });
    ok(posted.status === 405, 'POST cannot write through the Talk context seam',
      `status ${posted.status}`);
    const put = await fetch(`${base}/talk/context`, {
      method: 'PUT',
      headers: { cookie: authed.cookie },
      redirect: 'manual',
    });
    ok(put.status === 405, 'PUT is refused on /talk/context', `status ${put.status}`);
  });
  filesUnchanged('session Talk context');

  console.log('\n=== 3. MCP OAuth alone cannot unlock the Talk seam ===');
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
    const accessToken = await oauth.sign(resource);
    const mcpInit = await fetch(resource, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'atlas-talk-oauth-test', version: '1' },
        },
      }),
      redirect: 'manual',
    });
    ok(mcpInit.status === 200, 'valid MCP OAuth token still unlocks /assistant/mcp',
      `status ${mcpInit.status}`);

    const oauthOnTalk = await fetch(`${base}/talk/context`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
    });
    ok(oauthOnTalk.status === 401,
      'MCP OAuth alone cannot unlock /talk/context',
      `status ${oauthOnTalk.status}`);
    const oauthTalkBody = await oauthOnTalk.json();
    ok(!oauthTalkBody.schema && oauthTalkBody.error === 'not authenticated',
      'OAuth-only Talk response contains no packet');

    const oauthOnCurrent = await fetch(`${base}/assistant/current`, {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'manual',
    });
    ok(oauthOnCurrent.status === 401,
      'MCP OAuth still does not unlock /assistant/current');

    const authed = await login(base);
    const sessionOnMcp = await fetch(resource, {
      method: 'POST',
      headers: {
        cookie: authed.cookie,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      redirect: 'manual',
    });
    ok(sessionOnMcp.status === 401,
      'browser session still does not unlock /assistant/mcp');
    const talkRes = await fetch(`${base}/talk/context`, {
      headers: { cookie: authed.cookie },
    });
    ok(talkRes.status === 200 && (await talkRes.json()).schema === Assistant.SCHEMA,
      'the same session still unlocks only the Talk context seam');
  } finally {
    await atlas.stop();
    await oauth.close();
  }
  filesUnchanged('OAuth Talk isolation');

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
