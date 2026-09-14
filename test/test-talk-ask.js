'use strict';
/* Talk to Atlas — session Gemini explainer turn.
 *
 * Proves POST /talk/ask is the household-session consumer of the incumbent
 * packet plus a mocked Gemini call, that the instruction contract is in the
 * outbound request with tools/grounding disabled, and that browser session,
 * static assistant Bearer, and MCP OAuth still do not unlock one another.
 * No live Gemini calls.
 * `node test/test-talk-ask.js`
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
const TalkGemini = require('../scripts/talk-gemini.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const ASSISTANT_TOKEN = 'synthetic-assistant-token-32chars!!';
const GEMINI_KEY = 'synthetic-talk-gemini-key-32chars!!';
const LONG_PASS = 'synthetic-site-password-32chars!!';
const LONG_SECRET = 'synthetic-session-secret-32chars!!';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
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
    || /Bearer\s+\S+/.test(text)
    || /LUNCHMONEY_ACCESS_TOKEN/.test(text)
    || /SITE_PASSWORD/.test(text)
    || /SESSION_SECRET/.test(text)
    || /ATLAS_ASSISTANT_TOKEN/.test(text)
    || /ATLAS_TALK_GEMINI_API_KEY/.test(text)
    || /synthetic-site-password/.test(text)
    || /synthetic-session-secret/.test(text)
    || /synthetic-assistant-token/.test(text)
    || /synthetic-talk-gemini-key/.test(text);
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

function expectAtlasFatal(envExtra, pattern, label) {
  return new Promise((resolve) => {
    let stderr = '';
    const env = isolatedEnv(Object.assign({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      PORT: '0',
    }, envExtra || {}));
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      ok(false, label, 'timed out');
      resolve();
    }, 5000);
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      clearTimeout(timer);
      ok(code !== 0 && pattern.test(stderr), label, `code ${code}`);
      resolve();
    });
  });
}

async function login(base, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(password || PASS)}`,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, cookie: setCookie.split(';')[0], setCookie };
}

function geminiOkBody(text) {
  return JSON.stringify({
    candidates: [{
      content: { parts: [{ text }], role: 'model' },
      finishReason: 'STOP',
    }],
  });
}

function startMockGemini() {
  const captured = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        raw,
        body: (() => { try { return JSON.parse(raw); } catch { return null; } })(),
      });
      res.setHeader('content-type', 'application/json');
      res.end(geminiOkBody('The packet shows this payday is already represented.'));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        captured,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
    server.on('error', reject);
  });
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

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function loadTalkApi() {
  const src = read('public/talk.js');
  const send = { disabled: true, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const input = { value: '', setAttribute() {} };
  const seam = { textContent: '' };
  const sub = { textContent: '' };
  const emptyCopy = { textContent: '' };
  const context = { textContent: '', dataset: {} };
  const created = [];
  const sandbox = {
    App: { boot() {} },
    document: {
      querySelector(sel) {
        if (sel === '#talk .sub') return sub;
        if (sel === '.talk-empty-copy') return emptyCopy;
        if (sel === '[data-talk-role="atlas-loading"]') return null;
        return null;
      },
      createElement(tag) {
        const el = {
          tagName: tag,
          className: '',
          children: [],
          textContent: '',
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          getAttribute(k) { return this.attrs[k]; },
          appendChild(child) {
            this.children.push(child);
            return child;
          },
        };
        created.push(el);
        return el;
      },
    },
    fetch() { return Promise.resolve({ ok: false, json: async () => ({}) }); },
    $(id) {
      if (id === 'talk-send') return send;
      if (id === 'talk-input') return input;
      if (id === 'talk-seam') return seam;
      if (id === 'talk-context') return context;
      if (id === 'talk-thread') return { insertAdjacentHTML() {}, appendChild() {} };
      if (id === 'talk-empty') return { hidden: false };
      if (id === 'talk-composer' || id === 'talk-prompts') return { addEventListener() {} };
      return null;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    src + '\nthis.__api = { talkEscape, renderTalkModelAvailability, talkAnswerNode, talkErrorNode };',
    sandbox
  );
  return { api: sandbox.__api, send, seam, created };
}

function requestHasDisabledTools(body) {
  if (!body || typeof body !== 'object') return false;
  const blob = JSON.stringify(body);
  if (/\bgoogleSearch\b|\bgoogleSearchRetrieval\b|\burlContext\b|\bfileSearch\b|\bcodeExecution\b|\bgoogleMaps\b|\bretrieval\b/i.test(blob)) {
    return false;
  }
  if (Array.isArray(body.tools) && body.tools.length > 0) return false;
  if (body.toolConfig) return false;
  return true;
}

function instructionText(body) {
  const parts = body
    && body.systemInstruction
    && body.systemInstruction.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => (part && part.text) || '').join('\n');
}

function userText(body) {
  const parts = body
    && body.contents
    && body.contents[0]
    && body.contents[0].parts;
  if (!Array.isArray(parts)) return '';
  return parts.map(part => (part && part.text) || '').join('\n');
}

function requestHasInstruction(body) {
  const text = instructionText(body);
  return text === TalkGemini.INSTRUCTION
    && /NOT a planner/.test(text)
    && /Forecast is the sole planner/.test(text)
    && /only household-financial evidence/.test(text)
    && /MUST NOT/.test(text)
    && /new financial calculations/.test(text)
    && /safe-to-spend/.test(text)
    && /debt payoff math/.test(text)
    && /cannot answer that yet/.test(text);
}

console.log('=== 1. Talk Gemini module contract and UI fail-closed enablement ===');
{
  const moduleSrc = read('scripts/talk-gemini.js');
  const serverSrc = read('server.js');
  const talkSrc = stripComments(read('public/talk.js'));
  const html = read('public/talk.html');
  ok(TalkGemini.MODEL === 'gemini-2.5-flash-lite'
      && TalkGemini.SECRET_NAME === 'ATLAS_TALK_GEMINI_API_KEY'
      && TalkGemini.PROVIDER === 'google-gemini',
    'module pins Gemini Flash-Lite and the dedicated Talk secret name');
  ok(/@google\/genai/.test(moduleSrc) && /GoogleGenAI/.test(moduleSrc),
    'Talk uses the official @google/genai SDK');
  ok(/"@google\/genai":\s*"\^?2\./.test(read('package.json')),
    'package.json pins @google/genai 2.x');
  ok(requestHasInstruction({ systemInstruction: { parts: [{ text: TalkGemini.INSTRUCTION }] } }),
    'instruction contract forbids planning, new math, and invented numbers');
  ok(!/fs\.(write|append)File/.test(moduleSrc)
      && !/localStorage|indexedDB/.test(talkSrc + html)
      && !/fs\.(write|append)File/.test(serverSrc.split('talk ask failed')[0].slice(-800) + 'talk ask failed'),
    'Talk ask path does not persist prompts or answers');
  ok(/app\.post\('\/talk\/ask'/.test(serverSrc)
      && /buildCurrentAssistantPacket/.test(serverSrc)
      && /TalkGemini\.ask/.test(serverSrc),
    'POST /talk/ask uses the incumbent packet builder then TalkGemini');
  ok(TalkGemini.capability({}).available === false
      && TalkGemini.capability({ ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY }).available === true,
    'capability is fail-closed unless the dedicated key is configured');
  ok(TalkGemini.resolveBaseUrl({}) === TalkGemini.OFFICIAL_BASE_URL
      && TalkGemini.resolveBaseUrl({ ATLAS_TALK_GEMINI_BASE_URL: 'https://evil.example' }) === null
      && TalkGemini.resolveBaseUrl({ ATLAS_TALK_GEMINI_BASE_URL: 'http://127.0.0.1:9' }) === 'http://127.0.0.1:9',
    'Gemini base URL override is loopback-only');
  ok(TalkGemini.normalizeQuestion('').error === 'malformed request'
      && TalkGemini.normalizeQuestion(1).error === 'malformed request'
      && TalkGemini.normalizeQuestion('x'.repeat(TalkGemini.QUESTION_MAX_LENGTH + 1)).error === 'question too long'
      && TalkGemini.normalizeQuestion('  Hello  ').question === 'Hello',
    'questions are bounded and fail closed when malformed');

  const ui = loadTalkApi();
  ok(ui.send.disabled === true, 'Send starts disabled before capability resolves');
  ui.api.renderTalkModelAvailability(true);
  ok(ui.send.disabled === false && ui.seam.textContent.indexOf('not a second planner') !== -1,
    'capability available enables Send and replaces the stub seam');
  ui.api.renderTalkModelAvailability(false);
  ok(ui.send.disabled === true && /does not answer yet/.test(ui.seam.textContent),
    'capability unavailable keeps Send disabled and the stub seam');
  ok(ui.api.talkEscape('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;',
    'talkEscape encodes executable HTML');
  const answer = ui.api.talkAnswerNode('<img src=x onerror=alert(1)>');
  ok(answer.children[0] && answer.children[0].textContent === '<img src=x onerror=alert(1)>'
      && answer.getAttribute('data-talk-role') === 'atlas-answer',
    'model answer text is assigned via textContent, not HTML');
  ok(!/innerHTML\s*=/.test(talkSrc),
    'talk.js does not assign innerHTML');
}

(async () => {
  console.log('\n=== 2. Mocked Gemini request carries the contract and no tools ===');
  const mock = await startMockGemini();
  try {
    const answer = await TalkGemini.ask({
      question: 'What should I know today?',
      packet: { schema: Assistant.SCHEMA, authority: { planner: 'Forecast' } },
      env: {
        ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
        ATLAS_TALK_GEMINI_BASE_URL: mock.url,
      },
    });
    ok(answer === 'The packet shows this payday is already represented.',
      'mocked Gemini text becomes the Talk answer');
    ok(mock.captured.length === 1, 'exactly one Gemini HTTP call');
    const req = mock.captured[0];
    ok(req.method === 'POST'
        && req.url === '/v1beta/models/gemini-2.5-flash-lite:generateContent',
      'SDK posts to gemini-2.5-flash-lite generateContent');
    ok(requestHasInstruction(req.body),
      'outbound request includes the Atlas instruction contract');
    ok(requestHasDisabledTools(req.body),
      'outbound request has tools, grounding, Maps, URL context, File Search, and code execution disabled');
    ok(/Household question:\nWhat should I know today\?/.test(userText(req.body))
        && userText(req.body).includes(Assistant.SCHEMA)
        && /"planner":"Forecast"/.test(userText(req.body)),
      'outbound user text includes the question and this request\'s packet');
    ok(req.headers['x-goog-api-key'] === GEMINI_KEY,
      'Gemini secret stays on the server-side request');
  } finally {
    await mock.close();
  }

  console.log('\n=== 3. Session Talk ask; Bearer/MCP cannot; assistant stays isolated ===');
  const liveMock = await startMockGemini();
  await (async () => {
    const port = await freePort();
    const env = isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
      ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
      ATLAS_TALK_GEMINI_BASE_URL: liveMock.url,
      PORT: String(port),
    });
    const atlas = await startAtlas(env);
    const base = `http://127.0.0.1:${port}`;
    try {
      const anonAsk = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: 'What should I know today?' }),
      });
      ok(anonAsk.status === 401, 'anonymous POST /talk/ask is 401 JSON',
        `status ${anonAsk.status}`);
      const anonAskBody = await anonAsk.json();
      ok(anonAskBody.error === 'not authenticated' && !anonAskBody.answer,
        'anonymous Talk ask returns no answer');
      const anonCap = await fetch(`${base}/talk/capability`, { redirect: 'manual' });
      ok(anonCap.status === 401, 'anonymous GET /talk/capability is 401',
        `status ${anonCap.status}`);

      const authed = await login(base);
      ok(authed.status === 302 && /^hfd_session=/.test(authed.cookie),
        'synthetic login issues a session');
      const cap = await fetch(`${base}/talk/capability`, {
        headers: { cookie: authed.cookie },
      });
      ok(cap.status === 200, 'session unlocks GET /talk/capability');
      const capBody = await cap.json();
      ok(capBody.available === true
          && capBody.model === TalkGemini.MODEL
          && !forbiddenBlob(capBody),
        'capability reports Gemini available without secrets');

      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'What commitments are coming up?' }),
      });
      ok(asked.status === 200, 'session POST /talk/ask returns 200',
        `status ${asked.status}`);
      const askedBody = await asked.json();
      ok(askedBody.answer === 'The packet shows this payday is already represented.'
          && !forbiddenBlob(askedBody)
          && Object.keys(askedBody).join() === 'answer',
        'Talk ask returns only a plain-language answer');
      ok(liveMock.captured.length >= 1
          && requestHasInstruction(liveMock.captured[liveMock.captured.length - 1].body)
          && /What commitments are coming up\?/.test(userText(liveMock.captured[liveMock.captured.length - 1].body)),
        'server-side Gemini call used this question plus the instruction contract');

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

      const bearerAsk = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${ASSISTANT_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'What should I know today?' }),
        redirect: 'manual',
      });
      ok(bearerAsk.status === 401,
        'assistant Bearer alone cannot unlock /talk/ask',
        `status ${bearerAsk.status}`);
      const bearerAskBody = await bearerAsk.json();
      ok(!bearerAskBody.answer && bearerAskBody.error === 'not authenticated',
        'Bearer-only Talk ask returns no answer');
      const bearerCap = await fetch(`${base}/talk/capability`, {
        headers: { authorization: `Bearer ${ASSISTANT_TOKEN}` },
        redirect: 'manual',
      });
      ok(bearerCap.status === 401,
        'assistant Bearer alone cannot unlock /talk/capability');

      const malformed = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: '{',
      });
      ok(malformed.status === 400 && (await malformed.json()).error === 'malformed request',
        'malformed JSON fails closed');
      const missing = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      ok(missing.status === 400, 'missing question fails closed',
        `status ${missing.status}`);
      const extra = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'Hi', extra: true }),
      });
      ok(extra.status === 400, 'unexpected fields fail closed',
        `status ${extra.status}`);
      const tooLong = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'x'.repeat(TalkGemini.QUESTION_MAX_LENGTH + 1) }),
      });
      ok(tooLong.status === 400 && (await tooLong.json()).error === 'question too long',
        'oversize question fails closed');
      const huge = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'x'.repeat(5000) }),
      });
      ok(huge.status === 400, 'oversize JSON body fails closed',
        `status ${huge.status}`);
      const getAsk = await fetch(`${base}/talk/ask`, {
        headers: { cookie: authed.cookie },
        redirect: 'manual',
      });
      ok(getAsk.status === 405, 'GET is refused on /talk/ask',
        `status ${getAsk.status}`);
    } finally {
      await atlas.stop();
    }
  })();
  await liveMock.close();
  filesUnchanged('session Talk ask');

  console.log('\n=== 4. Unconfigured key keeps Talk unavailable; MCP OAuth cannot ask ===');
  await (async () => {
    const port = await freePort();
    const env = isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
      PORT: String(port),
    });
    const atlas = await startAtlas(env);
    const base = `http://127.0.0.1:${port}`;
    try {
      const authed = await login(base);
      const cap = await fetch(`${base}/talk/capability`, {
        headers: { cookie: authed.cookie },
      });
      const capBody = await cap.json();
      ok(cap.status === 200 && capBody.available === false && !capBody.model,
        'unset key → capability unavailable');
      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'What should I know today?' }),
      });
      ok(asked.status === 503 && (await asked.json()).error === 'talk unavailable',
        'unset key → POST /talk/ask is 503');
    } finally {
      await atlas.stop();
    }
  })();

  const oauth = await startOAuthIssuer();
  const oauthMock = await startMockGemini();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const resource = `${base}/assistant/mcp`;
  const atlas = await startAtlas(isolatedEnv({
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
    ATLAS_TALK_GEMINI_BASE_URL: oauthMock.url,
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
          clientInfo: { name: 'atlas-talk-ask-oauth-test', version: '1' },
        },
      }),
      redirect: 'manual',
    });
    ok(mcpInit.status === 200, 'valid MCP OAuth token still unlocks /assistant/mcp',
      `status ${mcpInit.status}`);

    const oauthAsk = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'What should I know today?' }),
      redirect: 'manual',
    });
    ok(oauthAsk.status === 401,
      'MCP OAuth alone cannot unlock /talk/ask',
      `status ${oauthAsk.status}`);
    const oauthAskBody = await oauthAsk.json();
    ok(!oauthAskBody.answer && oauthAskBody.error === 'not authenticated',
      'OAuth-only Talk ask returns no answer');

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
    const asked = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: {
        cookie: authed.cookie,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'What should I know today?' }),
    });
    ok(asked.status === 200 && (await asked.json()).answer,
      'the same session still unlocks only the Talk ask seam');
  } finally {
    await atlas.stop();
    await oauth.close();
    await oauthMock.close();
  }
  filesUnchanged('OAuth Talk ask isolation');

  console.log('\n=== 5. Dedicated Talk secret cannot reuse existing secrets ===');
  await expectAtlasFatal(
    { ATLAS_TALK_GEMINI_API_KEY: 'tooshort' },
    /ATLAS_TALK_GEMINI_API_KEY is set but shorter/,
    'short Talk Gemini key refuses to start'
  );
  await expectAtlasFatal(
    { SITE_PASSWORD: LONG_PASS, ATLAS_TALK_GEMINI_API_KEY: LONG_PASS },
    /must not reuse SITE_PASSWORD/,
    'Talk Gemini key cannot reuse SITE_PASSWORD'
  );
  await expectAtlasFatal(
    { SESSION_SECRET: LONG_SECRET, ATLAS_TALK_GEMINI_API_KEY: LONG_SECRET },
    /must not reuse SESSION_SECRET/,
    'Talk Gemini key cannot reuse SESSION_SECRET'
  );
  await expectAtlasFatal(
    { ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN, ATLAS_TALK_GEMINI_API_KEY: ASSISTANT_TOKEN },
    /must not reuse ATLAS_ASSISTANT_TOKEN/,
    'Talk Gemini key cannot reuse ATLAS_ASSISTANT_TOKEN'
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
