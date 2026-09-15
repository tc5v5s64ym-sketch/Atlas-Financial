'use strict';
/* Talk to Atlas — session Gemini explainer turn.
 *
 * Proves POST /talk/ask is the household-session consumer of the incumbent
 * packet plus a mocked Gemini call, that the instruction contract is in the
 * outbound request with tools/grounding disabled, that the server publishes
 * only wording assembled from packet-verified extractive claims (free-form
 * planner-act prose is never published), that those verified claims are
 * then mapped through Atlas presentation templates, that an explicit
 * hypothetical extra is Forecast-computed rather than model-authored, and
 * that browser session, static assistant Bearer, and MCP OAuth still do
 * not unlock one another.
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
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkHypothetical = require('../scripts/talk-hypothetical.js');
const Forecast = require('../public/forecast.js');
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

const DEFAULT_EXTRACTED = JSON.stringify({
  status: 'explained',
  claims: [{ path: 'authority.planner', equals: 'Forecast' }],
});
const DEFAULT_ANSWER = 'This request\'s packet shows authority.planner is Forecast.';

function startMockGemini(replies) {
  const captured = [];
  const queue = Array.isArray(replies) ? replies.slice() : [];
  const defaultText = DEFAULT_EXTRACTED;
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
      const next = queue.length > 0 ? queue.shift() : defaultText;
      res.setHeader('content-type', 'application/json');
      res.end(geminiOkBody(typeof next === 'string' ? next : defaultText));
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
    src + '\nthis.__api = { talkEscape, renderTalkModelAvailability, talkAnswerNode, talkErrorNode, talkAllowedAction, talkAnswerMetaText };',
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
    && /policy\.decisionPosture/.test(text)
    && /use policy alone/.test(text)
    && /debt payoff math/.test(text)
    && /cannot answer that yet/.test(text)
    && /ONLY one JSON object/.test(text)
    && /Free-form prose is rejected/.test(text);
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
  ok(/process\.env\.ATLAS_TALK_GEMINI_API_KEY/.test(serverSrc),
    'server reads ATLAS_TALK_GEMINI_API_KEY from process.env only');
  ok(!/console\.\w+\([^)]*TALK_GEMINI_KEY/.test(serverSrc)
      && !/console\.\w+\([^)]*readKey\(/.test(moduleSrc),
    'server and Talk Gemini module do not log the key value');
  ok(!/ATLAS_TALK_GEMINI_API_KEY|process\.env/.test(read('public/talk.js') + html),
    'Talk browser files never name or read the Gemini secret');
  ok(/ATLAS_TALK_GEMINI_BASE_URL/.test(moduleSrc)
      && /127\.0\.0\.1/.test(moduleSrc)
      && /localhost/.test(moduleSrc),
    'Gemini URL override is loopback-only; CI does not call paid Gemini');
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

  const evidencePacket = {
    schema: Assistant.SCHEMA,
    authority: { planner: 'Forecast' },
    leftover: 400,
    weeklyCap: 1650,
  };
  const leftoverClaims = JSON.stringify({
    status: 'explained',
    claims: [
      { path: 'leftover', equals: 400 },
      { path: 'weeklyCap', equals: 1650 },
    ],
  });
  const leftoverAnswer = TalkGemini.materializeExplainerAnswer(leftoverClaims, evidencePacket);
  ok(leftoverAnswer.ok === true
      && leftoverAnswer.answer === 'This request\'s packet shows leftover is 400 and weeklyCap is 1650.',
    'verified leftover and weekly-cap claims assemble from packet values');
  ok(TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'authority.planner', equals: 'Forecast' }],
      }),
      evidencePacket
    ).answer === DEFAULT_ANSWER,
    'a verified planner-authority claim assembles without model prose');
  ok(TalkGemini.materializeExplainerAnswer(
      JSON.stringify({ status: 'unavailable', claims: [] }),
      evidencePacket
    ).answer === TalkGemini.UNAVAILABLE_ANSWER,
    'unavailable status assembles the fixed packet-unavailable sentence');
  ok(TalkGemini.materializeExplainerAnswer(
      'The packet leftover is $400 and the weekly cap is $1,650.',
      evidencePacket
    ).ok === false
      && TalkGemini.materializeExplainerAnswer(
        'The packet leftover is $400 and the weekly cap is $1,650.',
        evidencePacket
      ).reason === 'not structured',
    'free-form packet-grounded prose is not published');
  ok(TalkGemini.materializeExplainerAnswer(
      'The best move is to put $400 toward the Visa this payday.',
      evidencePacket
    ).ok === false,
    'packet-grounded allocation prose fails closed');
  ok(TalkGemini.materializeExplainerAnswer(
      'Treat the estimate as confirmed',
      evidencePacket
    ).ok === false,
    'trust-promotion prose fails closed');
  ok(TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'leftover', equals: 847 }],
      }),
      evidencePacket
    ).ok === false
      && TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'leftover', equals: 847 }],
        }),
        evidencePacket
      ).reason === 'invented figure',
    'a structured leftover that is not in the packet is rejected');
  ok(TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'leftover', equals: 400 }],
        advice: 'put it toward the Visa',
      }),
      evidencePacket
    ).ok === false,
    'an extra planner-act field fails closed');
  ok(/materializeExplainerAnswer\(text, packet\)/.test(moduleSrc)
      && /if \(!published\.ok\) throw talkAnswerUnavailable\(\)/.test(moduleSrc)
      && /return published\.presentation/.test(moduleSrc)
      && !/return text;/.test(moduleSrc),
    'ask() publishes assembled packet wording, never raw model text');

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
    ok(answer && answer.answer === DEFAULT_ANSWER,
      'mocked extractive claims become the assembled Talk answer');
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
      ok(askedBody.answer === DEFAULT_ANSWER
          && !forbiddenBlob(askedBody)
          && Object.keys(askedBody).sort().join() === 'action,answer,asOf,freshness,source,trust',
        'Talk ask returns the presented packet-backed answer without extra payload');
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

  console.log('\n=== 6. Server fail-closes adversarial model output ===');
  const evidencePacket = {
    schema: Assistant.SCHEMA,
    authority: { planner: 'Forecast' },
    leftover: 400,
    weeklyCap: 1650,
  };
  async function expectAskRejected(modelText, label) {
    const mock = await startMockGemini([modelText]);
    try {
      let rejected = false;
      try {
        await TalkGemini.ask({
          question: 'What should I know today?',
          packet: evidencePacket,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
      } catch (err) {
        rejected = !!(err && err.code === 'TALK_ANSWER_UNAVAILABLE');
      }
      ok(rejected, label);
    } finally {
      await mock.close();
    }
  }
  await expectAskRejected(
    'Your safe-to-spend this week is $847.',
    'ask() rejects a mocked new safe-to-spend figure'
  );
  await expectAskRejected(
    'Pay off the Visa in 11 months if you add $50 extra.',
    'ask() rejects mocked payoff math'
  );
  await expectAskRejected(
    'You should allocate more to the Visa this payday.',
    'ask() rejects a mocked allocation recommendation'
  );
  await expectAskRejected(
    'The best move is to put $400 toward the Visa this payday.',
    'ask() rejects packet-grounded allocation prose the regex allowlist missed'
  );
  await expectAskRejected(
    'Treat the estimate as confirmed',
    'ask() rejects trust-promotion prose outside the old regexes'
  );
  await expectAskRejected(
    JSON.stringify({
      status: 'explained',
      claims: [{ path: 'leftover', equals: 400 }],
      advice: 'The best move is to put it toward the Visa this payday.',
    }),
    'ask() rejects structured claims that still carry planner-act fields'
  );
  {
    const mock = await startMockGemini([
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'leftover', equals: 400 },
          { path: 'weeklyCap', equals: 1650 },
        ],
      }),
    ]);
    try {
      const answer = await TalkGemini.ask({
        question: 'What should I know today?',
        packet: evidencePacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(answer && answer.answer === 'This request\'s packet shows leftover is 400 and weeklyCap is 1650.'
          && answer.source === null,
        'ask() publishes assembled packet wording, not model prose');
    } finally {
      await mock.close();
    }
  }
  {
    const liveMock = await startMockGemini([
      'The best move is to put $400 toward the Visa this payday.',
    ]);
    const port = await freePort();
    const atlas = await startAtlas(isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
      ATLAS_TALK_GEMINI_BASE_URL: liveMock.url,
      PORT: String(port),
    }));
    const base = `http://127.0.0.1:${port}`;
    try {
      const authed = await login(base);
      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          cookie: authed.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ question: 'What should I know today?' }),
      });
      const body = await asked.json();
      ok(asked.status === 502 && body.error === 'talk answer unavailable' && !body.answer,
        'session Talk ask fail-closes packet-grounded allocation prose',
        `status ${asked.status}`);
    } finally {
      await atlas.stop();
      await liveMock.close();
    }
    filesUnchanged('adversarial Talk ask');
  }

  console.log('\n=== 7. Slice 4 presentation maps verified claims only ===');
  {
    const presentationSrc = read('scripts/talk-presentation.js');
    const moduleSrc = read('scripts/talk-gemini.js');
    const talkSrc = stripComments(read('public/talk.js'));
    ok(!/require\(['"][^'"]*forecast/i.test(presentationSrc)
        && !/Forecast\./.test(presentationSrc)
        && !/startingCashAmount|currentPeriodAction\(|recommend\(/.test(presentationSrc),
      'presentation does not import Forecast or call planner functions');
    ok(/TalkPresentation\.presentVerifiedClaims/.test(moduleSrc)
        && /require\('\.\/talk-presentation'\)/.test(moduleSrc),
      'Talk Gemini maps verified claims through the presentation module');
    ok(!/money2\(|\bmoney\(/.test(talkSrc) && !/Forecast\./.test(talkSrc),
      'talk.js still does not format money or call Forecast');

    const remainingPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      leftover: 400,
      weeklyCap: 1650,
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          status: 'ok',
          source: 'Forecast.currentPeriodAction',
          essentialRemaining: 1415.95,
          remainingClaim: 'posted-only',
          weeklyCap: 225,
        },
      },
      current: {
        spendableHouseholdCash: { status: 'ok', value: 939.62, trust: 'calculated' },
      },
    };
    const remainingClaims = JSON.stringify({
      status: 'explained',
      claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 }],
    });
    const remaining = TalkGemini.materializeExplainerAnswer(remainingClaims, remainingPacket);
    ok(remaining.ok === true
        && remaining.answer === 'You have $1,415.95 remaining in the current pay period.',
      'known remaining path uses the Atlas remaining sentence and currency format');
    ok(remaining.presentation.source === 'Forecast'
        && remaining.presentation.trust === 'posted-only'
        && remaining.presentation.asOf === '2026-09-14'
        && remaining.presentation.freshness === 'live'
        && remaining.presentation.action
        && remaining.presentation.action.href === '/'
        && remaining.presentation.action.label === 'View Budget',
      'remaining presentation carries Forecast provenance, packet trust, as-of, freshness, and Budget link');

    const spendableOk = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.spendableHouseholdCash.value', value: 939.62 }],
    }, remainingPacket);
    ok(spendableOk.answer === 'Spendable household cash is $939.62.'
        && spendableOk.trust === 'calculated'
        && spendableOk.source === 'Forecast',
      'status ok spendable cash keeps the current spendable-cash sentence');

    const datedOpeningPacket = {
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'canonical-opening' },
      },
      current: {
        spendableHouseholdCash: {
          status: 'dated-opening',
          current: false,
          value: 939.62,
          trust: 'calculated',
          note: 'Current plan unavailable. The dated opening is stale.',
        },
      },
    };
    const datedOpening = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.spendableHouseholdCash.value', value: 939.62 }],
    }, datedOpeningPacket);
    ok(!/Spendable household cash is \$939\.62/.test(datedOpening.answer)
        && !/Spendable household cash is \$/.test(datedOpening.answer)
        && /dated opening cash is \$939\.62/i.test(datedOpening.answer)
        && /not current spendable household cash/i.test(datedOpening.answer)
        && datedOpening.trust === 'dated-opening'
        && datedOpening.trust !== 'calculated',
      'dated-opening spendable cash is not presented as current spendable cash');

    const datedThroughAsk = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'current.spendableHouseholdCash.value', equals: 939.62 }],
      }),
      datedOpeningPacket
    );
    ok(datedThroughAsk.ok === true
        && !/Spendable household cash is \$/.test(datedThroughAsk.answer)
        && /not current spendable household cash/i.test(datedThroughAsk.answer)
        && datedThroughAsk.presentation.trust === 'dated-opening',
      'verified dated-opening spendable claims stay non-current through ask materialization');

    const invented = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 9999.99 }],
      }),
      remainingPacket
    );
    ok(invented.ok === false && invented.reason === 'invented figure',
      'only the verified packet remaining value can become answer content');

    const prose = TalkGemini.materializeExplainerAnswer(
      'You have $1,415.95 remaining in the current pay period.',
      remainingPacket
    );
    ok(prose.ok === false && prose.reason === 'not structured',
      'raw model prose never becomes the Talk answer, even when it matches a template');

    const unknown = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'leftover', value: 400 }],
    }, remainingPacket);
    ok(unknown.answer === 'This request\'s packet shows leftover is 400.'
        && unknown.source === null
        && unknown.action === null
        && !/\$400/.test(unknown.answer)
        && !/remaining in the current pay period/.test(unknown.answer),
      'unknown leftover path stays generic and does not invent remaining-cash meaning');

    const mixed = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [
        { path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 },
        { path: 'leftover', value: 400 },
      ],
    }, remainingPacket);
    ok(mixed.source === null && mixed.action === null
        && /You have \$1,415\.95 remaining/.test(mixed.answer)
        && /leftover is 400/.test(mixed.answer),
      'an unmapped path strips Forecast provenance so the answer cannot falsely claim Forecast');

    const precise = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
    }, {
      metadata: { effectiveAsOf: '2026-09-14', freshness: { confidence: 'live' } },
      forecast: { currentPeriodAction: { essentialRemaining: 1415.95, remainingClaim: 'precise' } },
    });
    ok(precise.trust === 'precise' && precise.trust !== 'estimated',
      'precise remaining is not weakened or relabelled estimated');

    const estimated = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
    }, {
      metadata: { effectiveAsOf: '2026-09-14', freshness: { confidence: 'canonical-opening' } },
      forecast: { currentPeriodAction: { essentialRemaining: 1415.95, remainingClaim: 'posted-only' } },
    });
    ok(estimated.trust === 'posted-only'
        && estimated.freshness === 'canonical-opening'
        && estimated.trust !== 'precise'
        && estimated.trust !== 'confirmed'
        && estimated.freshness !== 'live',
      'posted-only remaining stays estimated-strength and does not become confirmed or live');

    const unavailableMoney = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: null }],
    }, {
      metadata: { effectiveAsOf: '2026-09-14' },
      forecast: { currentPeriodAction: { essentialRemaining: null, remainingClaim: 'unavailable' } },
    });
    ok(unavailableMoney.answer === 'Current pay-period remaining is unavailable.'
        && unavailableMoney.trust === 'unavailable'
        && !/\$0/.test(unavailableMoney.answer)
        && !/0\.00/.test(unavailableMoney.answer),
      'unavailable remaining is not published as zero');

    const bills = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.nextSignificantObligations.nextDue.amount', value: 17 }],
    }, {
      metadata: { effectiveAsOf: '2026-09-14' },
      current: {
        nextSignificantObligations: {
          nextDue: { amount: 17, confidence: 'estimated' },
        },
      },
    });
    ok(bills.answer === 'The next due amount is $17.00.'
        && bills.source === 'Bills'
        && bills.trust === 'estimated'
        && bills.action && bills.action.href === '/bills.html'
        && bills.action.label === 'View Bills',
      'known bills path gets a Bills label, estimated trust, and View Bills');

    const credit = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.debts.totalAvailableCredit', value: 1200.5 }],
    }, { current: { debts: { totalAvailableCredit: 1200.5 } } });
    ok(credit.answer === 'Total available credit is $1,200.50.'
        && credit.source === 'Credit'
        && credit.action && credit.action.href === '/credit.html',
      'known credit path formats currency and links to Credit');

    const unpublishedFacility = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.debts.facilities[0].available', value: 800 }],
    }, {
      current: {
        debts: {
          facilities: [{
            label: 'Cash Back',
            available: 800,
            pendingUnknown: true,
            trust: 'unknown',
          }],
        },
      },
    });
    ok(unpublishedFacility.answer === 'A credit facility available amount is unavailable.'
        && unpublishedFacility.trust === 'unknown'
        && unpublishedFacility.source === 'Credit'
        && !/A credit facility has \$800\.00 available/.test(unpublishedFacility.answer)
        && !/\$800/.test(unpublishedFacility.answer),
      'pendingUnknown / trust unknown withholds per-facility available credit');

    const trustedFacility = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'current.debts.facilities[0].available', value: 2167.84 }],
    }, {
      current: {
        debts: {
          facilities: [{
            label: 'HELOC',
            available: 2167.84,
            pendingUnknown: false,
            trust: 'calculated',
          }],
        },
      },
    });
    ok(trustedFacility.answer === 'A credit facility has $2,167.84 available.'
        && trustedFacility.source === 'Credit'
        && trustedFacility.action && trustedFacility.action.href === '/credit.html',
      'a trusted facility may still publish packet-backed available credit');

    const planning = TalkPresentation.presentVerifiedClaims({
      status: 'explained',
      claims: [{ path: 'forecast.upcomingModeledCommitments.items[0].remaining', value: 250 }],
    }, { forecast: { upcomingModeledCommitments: { items: [{ remaining: 250 }] } } });
    ok(planning.answer === 'A modeled commitment remaining is $250.00.'
        && planning.source === 'Planning'
        && planning.action && planning.action.href === '/planning.html',
      'known planning path links to Planning and does not claim it is leftover cash');

    for (const href of TalkPresentation.ALLOWED_ACTION_HREFS) {
      ok(['/', '/bills.html', '/credit.html', '/planning.html'].includes(href),
        `presentation allowlist keeps existing route ${href}`);
    }
    ok(!TalkPresentation.isAllowedActionHref('/talk.html')
        && !TalkPresentation.isAllowedActionHref('/subscriptions.html')
        && !TalkPresentation.isAllowedActionHref('javascript:alert(1)'),
      'presentation rejects Talk, Subscriptions, and non-Atlas hrefs');

    const ui = loadTalkApi();
    const rendered = ui.api.talkAnswerNode({
      answer: 'You have $1,415.95 remaining in the current pay period.',
      source: 'Forecast',
      trust: 'posted-only',
      asOf: '2026-09-14',
      freshness: 'live',
      action: { href: '/', label: 'View Budget' },
    });
    ok(rendered.children[0] && rendered.children[0].textContent
        === 'You have $1,415.95 remaining in the current pay period.',
      'browser renders the presented answer via textContent');
    ok(rendered.children[1]
        && rendered.children[1].className === 'talk-answer-meta'
        && rendered.children[1].textContent === 'Forecast · as of 2026-09-14 · posted-only · live',
      'browser renders a subtle Forecast/trust/as-of/freshness line');
    ok(rendered.children[2]
        && rendered.children[2].className === 'talk-answer-action'
        && rendered.children[2].children[0]
        && rendered.children[2].children[0].getAttribute('href') === '/'
        && rendered.children[2].children[0].textContent === 'View Budget',
      'browser renders one View Budget link on the existing Budget route');
    ok(ui.api.talkAllowedAction({ href: '/talk.html', label: 'View Talk' }) === null
        && ui.api.talkAllowedAction({ href: 'https://evil.example', label: 'View Budget' }) === null
        && ui.api.talkAllowedAction({ href: '/', label: 'View Budget' }).href === '/',
      'browser drops non-Atlas action hrefs');
    ok(!/innerHTML\s*=/.test(talkSrc),
      'presentation render still does not assign innerHTML');
  }

  {
    const remainingPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      leftover: 400,
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          essentialRemaining: 1415.95,
          remainingClaim: 'posted-only',
        },
      },
    };
    const mock = await startMockGemini([
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 }],
      }),
    ]);
    try {
      const presented = await TalkGemini.ask({
        question: 'How much is left this period?',
        packet: remainingPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(presented.answer === 'You have $1,415.95 remaining in the current pay period.'
          && presented.source === 'Forecast'
          && presented.action.href === '/',
        'ask() presents the verified remaining fixture, not model prose');
    } finally {
      await mock.close();
    }
  }

  {
    const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    const packet = Assistant.buildPacket({ data, now: '2026-09-14T12:00:00.000Z' });
    const weeklyCap = packet.forecast
      && packet.forecast.currentPeriodAction
      && packet.forecast.currentPeriodAction.weeklyCap;
    const remaining = packet.forecast
      && packet.forecast.currentPeriodAction
      && packet.forecast.currentPeriodAction.essentialRemaining;
    if (Number.isFinite(weeklyCap)) {
      const presented = TalkPresentation.presentVerifiedClaims({
        status: 'explained',
        claims: [{ path: 'forecast.currentPeriodAction.weeklyCap', value: weeklyCap }],
      }, packet);
      ok(presented.answer === `The current weekly spending cap is ${TalkPresentation.formatCurrency(weeklyCap)}.`
          && presented.source === 'Forecast'
          && presented.action && presented.action.href === '/',
        'incumbent packet weekly cap presents with Atlas currency wording and Budget link');
    } else {
      ok(true, 'incumbent packet weekly cap unavailable — fixture remaining covers currency');
    }
    if (remaining == null) {
      const presented = TalkPresentation.presentVerifiedClaims({
        status: 'explained',
        claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: null }],
      }, packet);
      ok(presented.answer === 'Current pay-period remaining is unavailable.'
          && !/\$0/.test(presented.answer),
        'incumbent packet remaining stays unavailable and is not published as zero');
    }
    filesUnchanged('presentation Talk ask');
  }

  console.log('\n=== 8. Period / bills / credit claim sets assemble; planner-act stays closed ===');
  {
    const domainPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          status: 'ok',
          source: 'Forecast.currentPeriodAction',
          mode: 'between-paydays',
          periodStart: '2026-09-11',
          periodEnd: '2026-09-24',
          nextPayday: '2026-09-25',
          remainingClaim: 'posted-only',
          essentialRemaining: 1415.95,
          weeklyCap: 225,
        },
      },
      current: {
        spendableHouseholdCash: { status: 'ok', value: 939.62, trust: 'calculated', current: true },
        pending: { totalKnownPending: 40 },
        debts: {
          totalAvailableCredit: 1200.5,
          overLimitCount: 1,
          securedDebt: 745674.46,
          monthlyInterest: 3045.51,
          facilities: [{ label: 'HELOC', available: 2167.84 }],
        },
        nextSignificantObligations: {
          nextDue: {
            date: '2026-09-16',
            label: 'Travel Visa minimum',
            amount: 17,
            daysUntil: 2,
            confidence: 'estimated',
          },
          nextPaymentOut: {
            date: '2026-09-16',
            label: 'Travel Visa minimum',
            amount: 17,
            confidence: 'estimated',
          },
        },
      },
    };

    const periodMixed = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'forecast.currentPeriodAction.periodStart', equals: '2026-09-11' },
          { path: 'forecast.currentPeriodAction.periodEnd', equals: '2026-09-24' },
          { path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 },
          { path: 'forecast.currentPeriodAction.weeklyCap', equals: 225 },
          { path: 'forecast.currentPeriodAction.remaining', equals: 1415.95 },
        ],
      }),
      domainPacket
    );
    ok(periodMixed.ok === true
        && /The current pay period starts on 2026-09-11/.test(periodMixed.answer)
        && /The current pay period ends on 2026-09-24/.test(periodMixed.answer)
        && /You have \$1,415\.95 remaining in the current pay period/.test(periodMixed.answer)
        && /The current weekly spending cap is \$225\.00/.test(periodMixed.answer)
        && periodMixed.presentation.source === 'Forecast'
        && periodMixed.presentation.action && periodMixed.presentation.action.href === '/'
        && periodMixed.presentation.trust === 'posted-only'
        && periodMixed.presentation.asOf === '2026-09-14',
      'period-style mixed claims drop the missing path and assemble Atlas period templates');

    const periodObject = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{
          path: 'forecast.currentPeriodAction',
          equals: domainPacket.forecast.currentPeriodAction,
        }],
      }),
      domainPacket
    );
    ok(periodObject.ok === true
        && /You have \$1,415\.95 remaining in the current pay period/.test(periodObject.answer)
        && /The current weekly spending cap is \$225\.00/.test(periodObject.answer)
        && /The next payday is 2026-09-25/.test(periodObject.answer)
        && periodObject.presentation.source === 'Forecast',
      'a matching currentPeriodAction object expands into packet-backed period templates');

    const billsObject = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{
          path: 'current.nextSignificantObligations.nextDue',
          equals: domainPacket.current.nextSignificantObligations.nextDue,
        }],
      }),
      domainPacket
    );
    ok(billsObject.ok === true
        && billsObject.answer === [
          'The next due date is 2026-09-16.',
          'The next due item is Travel Visa minimum.',
          'The next due amount is $17.00.',
          'The next due item is in 2 days.',
        ].join(' ')
        && billsObject.presentation.source === 'Bills'
        && billsObject.presentation.trust === 'estimated'
        && billsObject.presentation.action
        && billsObject.presentation.action.href === '/bills.html',
      'a matching nextDue object assembles the Bills templates and View Bills action');

    const billsMixed = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'current.nextSignificantObligations.nextDue.label', equals: 'Travel Visa minimum' },
          { path: 'current.nextSignificantObligations.nextDue.date', equals: '2026-09-16' },
          { path: 'current.nextSignificantObligations.nextDue.amount', equals: '17' },
          { path: 'current.nextSignificantObligations.nextDue.what', equals: 'Travel Visa minimum' },
        ],
      }),
      domainPacket
    );
    ok(billsMixed.ok === true
        && /The next due item is Travel Visa minimum/.test(billsMixed.answer)
        && /The next due amount is \$17\.00/.test(billsMixed.answer)
        && billsMixed.presentation.source === 'Bills'
        && !/what is/.test(billsMixed.answer),
      'bills-style claims keep stringified packet amounts and drop the invented what path');

    const creditObject = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{
          path: 'current.debts',
          equals: domainPacket.current.debts,
        }],
      }),
      domainPacket
    );
    ok(creditObject.ok === true
        && /Total available credit is \$1,200\.50/.test(creditObject.answer)
        && /1 credit facility is over the limit/.test(creditObject.answer)
        && /Secured debt totals \$745,674\.46/.test(creditObject.answer)
        && /Monthly interest is \$3,045\.51/.test(creditObject.answer)
        && creditObject.presentation.source === 'Credit'
        && creditObject.presentation.action
        && creditObject.presentation.action.href === '/credit.html',
      'a matching debts object expands into Credit templates and View Credit');

    const creditMany = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'current.debts.totalAvailableCredit', equals: 1200.5 },
          { path: 'current.pending.totalKnownPending', equals: 40 },
          { path: 'current.debts.overLimitCount', equals: 1 },
          { path: 'current.debts.securedDebt', equals: 745674.46 },
          { path: 'current.debts.monthlyInterest', equals: 3045.51 },
          { path: 'current.debts.facilities[0].label', equals: 'HELOC' },
          { path: 'current.debts.facilities[0].available', equals: 2167.84 },
          { path: 'forecast.currentPeriodAction.status', equals: 'ok' },
          { path: 'forecast.currentPeriodAction.source', equals: 'Forecast.currentPeriodAction' },
          { path: 'authority.planner', equals: 'Forecast' },
        ],
      }),
      domainPacket
    );
    ok(creditMany.ok === true
        && creditMany.claims.length <= TalkGemini.CLAIM_MAX
        && creditMany.claims.length >= 5
        && creditMany.claims.every(claim => TalkPresentation.ruleFor(claim.path))
        && /Total available credit is \$1,200\.50/.test(creditMany.answer)
        && /Known pending charges total \$40\.00/.test(creditMany.answer)
        && creditMany.presentation.source === 'Credit'
        && !/put \$/.test(creditMany.answer)
        && !/authority\.planner/.test(creditMany.answer),
      'over-cap credit-style claim sets keep mapped packet-backed Credit wording');

    const creditTrustPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      current: {
        debts: {
          facilities: [
            {
              label: 'Cash Back',
              available: 800,
              pendingUnknown: true,
              trust: 'unknown',
            },
            {
              label: 'HELOC',
              available: 2167.84,
              pendingUnknown: false,
              trust: 'calculated',
            },
          ],
        },
      },
    };
    const creditTrust = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'current.debts.facilities[0].available', equals: 800 },
          { path: 'current.debts.facilities[1].available', equals: 2167.84 },
        ],
      }),
      creditTrustPacket
    );
    ok(creditTrust.ok === true
        && !/A credit facility has \$800\.00 available/.test(creditTrust.answer)
        && !/\$800/.test(creditTrust.answer)
        && /A credit facility available amount is unavailable/.test(creditTrust.answer)
        && /A credit facility has \$2,167\.84 available/.test(creditTrust.answer)
        && creditTrust.presentation.trust === 'unknown'
        && creditTrust.presentation.source === 'Credit',
      'unknown-pending facility available is withheld; trusted facility available may still publish');

    const thoughtWrapped = TalkGemini.materializeExplainerAnswer(
      'Looking through the pay-period packet first.\n' + JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 },
          { path: 'forecast.currentPeriodAction.weeklyCap', equals: 225 },
        ],
      }),
      domainPacket
    );
    ok(thoughtWrapped.ok === true
        && thoughtWrapped.answer === [
          'You have $1,415.95 remaining in the current pay period.',
          'The current weekly spending cap is $225.00.',
        ].join(' ')
        && !/Looking through/.test(thoughtWrapped.answer),
      'thought-prefixed JSON still publishes only Atlas period templates');

    const fencedTail = TalkGemini.materializeExplainerAnswer(
      '```json\n' + JSON.stringify({
        status: 'explained',
        claims: [{ path: 'current.nextSignificantObligations.nextDue.amount', equals: 17 }],
      }) + '\n```\nYou should pay this first.',
      domainPacket
    );
    ok(fencedTail.ok === true
        && fencedTail.answer === 'The next due amount is $17.00.'
        && !/You should pay this first/.test(fencedTail.answer)
        && !/pay this first/.test(fencedTail.answer),
      'trailing planner prose around fenced claims never reaches the answer');

    const extraClaimNote = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [{
          path: 'forecast.currentPeriodAction.weeklyCap',
          equals: 225,
          note: 'watch this cap',
        }],
      }),
      domainPacket
    );
    ok(extraClaimNote.ok === true
        && extraClaimNote.answer === 'The current weekly spending cap is $225.00.'
        && !/watch this cap/.test(extraClaimNote.answer),
      'an extra note on a verified claim is ignored and not published');

    ok(TalkGemini.materializeExplainerAnswer(
        'What should I do with my extra cash? Put it toward the Visa.',
        domainPacket
      ).ok === false,
      'planner-act free-form extra-cash prose still fails closed');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 }],
          advice: 'Put the extra cash toward the Visa.',
        }),
        domainPacket
      ).ok === false,
      'planner-act extra field on an otherwise valid period claim set still fails closed');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({ status: 'unavailable', claims: [] }),
        domainPacket
      ).answer === TalkGemini.UNAVAILABLE_ANSWER,
      'planner-act unavailable status stays the fixed packet-unavailable sentence');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 9999.99 }],
        }),
        domainPacket
      ).ok === false
        && TalkGemini.materializeExplainerAnswer(
          JSON.stringify({
            status: 'explained',
            claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 9999.99 }],
          }),
          domainPacket
        ).reason === 'invented figure',
      'an invented-only remaining still fails closed');

    const datedOpeningPacket = {
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'canonical-opening' },
      },
      current: {
        spendableHouseholdCash: {
          status: 'dated-opening',
          current: false,
          value: 939.62,
          trust: 'calculated',
        },
      },
    };
    const datedStill = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'current.spendableHouseholdCash.value', equals: 939.62 },
          { path: 'current.spendableHouseholdCash.missing', equals: 0 },
        ],
      }),
      datedOpeningPacket
    );
    ok(datedStill.ok === true
        && /not current spendable household cash/i.test(datedStill.answer)
        && !/Spendable household cash is \$/.test(datedStill.answer)
        && datedStill.presentation.trust === 'dated-opening',
      'dated-opening spendable-cash non-current wording stays intact on mixed claims');
  }

  {
    const domainPacket = {
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          periodStart: '2026-09-11',
          periodEnd: '2026-09-24',
          essentialRemaining: 1415.95,
          weeklyCap: 225,
          remainingClaim: 'posted-only',
        },
      },
      current: {
        nextSignificantObligations: {
          nextDue: {
            date: '2026-09-16',
            label: 'Travel Visa minimum',
            amount: 17,
            confidence: 'estimated',
          },
        },
        debts: { totalAvailableCredit: 1200.5 },
      },
    };
    const mock = await startMockGemini([
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 },
          { path: 'forecast.currentPeriodAction.weeklyCap', equals: 225 },
          { path: 'forecast.payPeriod.summary', equals: 'on track' },
        ],
      }),
      JSON.stringify({
        status: 'explained',
        claims: [{
          path: 'current.nextSignificantObligations.nextDue',
          equals: domainPacket.current.nextSignificantObligations.nextDue,
        }],
      }),
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'current.debts.totalAvailableCredit', equals: 1200.5 },
          { path: 'current.debts', equals: { invented: true } },
        ],
      }),
      'What should I do with my extra cash? Move it to the Visa.',
    ]);
    try {
      const period = await TalkGemini.ask({
        question: 'What should I know about this pay period?',
        packet: domainPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(period.answer === [
        'You have $1,415.95 remaining in the current pay period.',
        'The current weekly spending cap is $225.00.',
      ].join(' ')
          && period.source === 'Forecast'
          && period.action && period.action.href === '/',
        'ask() assembles a period-style mocked claim set into Atlas templates');

      const bills = await TalkGemini.ask({
        question: 'What commitment is coming up next?',
        packet: domainPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(bills.answer === [
        'The next due date is 2026-09-16.',
        'The next due item is Travel Visa minimum.',
        'The next due amount is $17.00.',
      ].join(' ')
          && bills.source === 'Bills'
          && bills.action && bills.action.href === '/bills.html',
        'ask() assembles a bills-style mocked nextDue object into Atlas templates');

      const credit = await TalkGemini.ask({
        question: 'What is the factual credit picture?',
        packet: domainPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(credit.answer === 'Total available credit is $1,200.50.'
          && credit.source === 'Credit'
          && credit.action && credit.action.href === '/credit.html',
        'ask() assembles a credit-style mocked claim set into Atlas templates');

      let plannerRejected = false;
      try {
        await TalkGemini.ask({
          question: 'What should I do with my extra cash?',
          packet: domainPacket,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
      } catch (err) {
        plannerRejected = !!(err && err.code === 'TALK_ANSWER_UNAVAILABLE');
      }
      ok(plannerRejected, 'ask() still fail-closes planner-act extra-cash prose');
    } finally {
      await mock.close();
    }
    filesUnchanged('period bills credit Talk repair');
  }

  console.log('\n=== 9. Talk Slice 5 — owner decision posture is explainable, not a planner ===');
  {
    const policyPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      leftover: 400,
      weeklyCap: 1650,
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      policy: {
        decisionPosture: {
          status: 'ok',
          source: 'data.json plan.decisionPosture',
          posture: 'aggressive-not-brittle',
          velocity: 'fastest-to-goal',
          resilience: 'enough-cash-flexibility-for-real-life-and-known-commitments',
          breathingRoom: 'sustainable-slack-not-waste-permission',
          knownCommitments: 'exert-gravity',
          cheapestWhenBrittle: 'not-best-household-decision',
          numericThreshold: 'none',
          forecastApplication: 'not-applied-this-slice',
          provenance: 'owner-stated',
          provenanceDate: '2026-09-14',
        },
      },
    };
    const policyClaims = [
      { path: 'policy.decisionPosture.posture', equals: 'aggressive-not-brittle' },
      { path: 'policy.decisionPosture.velocity', equals: 'fastest-to-goal' },
      { path: 'policy.decisionPosture.resilience', equals: 'enough-cash-flexibility-for-real-life-and-known-commitments' },
      { path: 'policy.decisionPosture.breathingRoom', equals: 'sustainable-slack-not-waste-permission' },
      { path: 'policy.decisionPosture.knownCommitments', equals: 'exert-gravity' },
      { path: 'policy.decisionPosture.cheapestWhenBrittle', equals: 'not-best-household-decision' },
      { path: 'policy.decisionPosture.numericThreshold', equals: 'none' },
      { path: 'policy.decisionPosture.forecastApplication', equals: 'not-applied-this-slice' },
    ];
    const policyAll = TalkGemini.materializeExplainerAnswer(
      JSON.stringify({ status: 'explained', claims: policyClaims }),
      policyPacket
    );
    ok(policyAll.ok === true
        && /aggressive, but not brittle/.test(policyAll.answer)
        && /Velocity means getting to the financial goal/.test(policyAll.answer)
        && /Resilience means enough cash and flexibility/.test(policyAll.answer)
        && /Breathing room is enough slack/.test(policyAll.answer)
        && /Known authorized future commitments exert gravity/.test(policyAll.answer)
        && /Mathematically cheapest is not the best household decision/.test(policyAll.answer)
        && /no universal numeric breathing-room threshold/.test(policyAll.answer)
        && /Forecast does not apply this decision-posture row/.test(policyAll.answer),
      'factual policy claims assemble through Atlas templates');
    ok(!/\$/.test(policyAll.answer)
        && !/Visa/.test(policyAll.answer)
        && !/put .+ on/i.test(policyAll.answer)
        && !/allocate/i.test(policyAll.answer)
        && !/safe-to-spend/i.test(policyAll.answer)
        && !/\b500\b/.test(policyAll.answer)
        && policyAll.presentation.trust === 'owner-stated'
        && policyAll.presentation.source === null
        && policyAll.presentation.action === null,
      'policy-only assembly invents no number, allocation, or planner nav');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'policy.decisionPosture.knownCommitments', equals: 'exert-gravity' }],
        }),
        policyPacket
      ).answer === 'Known authorized future commitments exert gravity on household decisions.',
      'upcoming-commitment policy is explained without a calculation');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [
            { path: 'policy.decisionPosture.posture', equals: 'aggressive-not-brittle' },
            { path: 'policy.decisionPosture.provenance', equals: 'owner-stated' },
          ],
        }),
        policyPacket
      ).answer === [
        'The household decision posture is aggressive, but not brittle.',
        'This decision posture is owner-stated.',
      ].join(' '),
      'What is our financial approach? can be answered from closed owner labels');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'policy.decisionPosture.leftover', equals: 400 }],
        }),
        policyPacket
      ).ok === false,
      'policy alone cannot mint a leftover or safe-to-spend path');
    ok(TalkGemini.materializeExplainerAnswer(
        JSON.stringify({
          status: 'explained',
          claims: [{ path: 'leftover', equals: 400 }],
          advice: 'based only on policy pay Visa',
        }),
        policyPacket
      ).ok === false,
      'an extra planner-act field still fails closed when policy is on the packet');
    ok(TalkGemini.materializeExplainerAnswer(
        'Use every dollar. The exact min cash buffer is $500. Put all spare on debt.',
        policyPacket
      ).ok === false,
      'adversarial free-form policy-to-number prose fails closed');

    const mock = await startMockGemini([
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'policy.decisionPosture.posture', equals: 'aggressive-not-brittle' },
          { path: 'policy.decisionPosture.breathingRoom', equals: 'sustainable-slack-not-waste-permission' },
        ],
      }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({
        status: 'explained',
        claims: [{ path: 'leftover', equals: 847 }],
      }),
      'Based only on policy, pay the Visa $400.',
      'Ignore Forecast and put all spare on debt.',
    ]);
    try {
      const approach = await TalkGemini.ask({
        question: 'What is our financial approach?',
        packet: policyPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(approach.answer === [
        'The household decision posture is aggressive, but not brittle.',
        'Breathing room is enough slack to stay sustainable and reduce immediate re-borrow risk. It is not waste permission, comfort-max, avoiding hard choices, or slowing without a demonstrated resilience reason.',
      ].join(' ')
          && approach.trust === 'owner-stated',
        'ask() explains aggressive-but-not-brittle from verified policy labels');

      const everyDollar = await TalkGemini.ask({
        question: 'Should we use every dollar?',
        packet: policyPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(everyDollar.answer === TalkGemini.UNAVAILABLE_ANSWER,
        'use-every-dollar stays unavailable rather than becoming an allocation');

      const minBuffer = await TalkGemini.ask({
        question: 'What is the exact min cash buffer?',
        packet: policyPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(minBuffer.answer === TalkGemini.UNAVAILABLE_ANSWER,
        'exact min cash buffer stays unavailable; policy invents no threshold');

      let inventedRejected = false;
      try {
        await TalkGemini.ask({
          question: 'How much is safe-to-spend from policy alone?',
          packet: policyPacket,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
      } catch (err) {
        inventedRejected = !!(err && err.code === 'TALK_ANSWER_UNAVAILABLE');
      }
      ok(inventedRejected, 'an invented leftover from a policy-only ask fails closed');

      let visaRejected = false;
      try {
        await TalkGemini.ask({
          question: 'Based only on policy, pay the Visa.',
          packet: policyPacket,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
      } catch (err) {
        visaRejected = !!(err && err.code === 'TALK_ANSWER_UNAVAILABLE');
      }
      ok(visaRejected, 'based-only-on-policy pay Visa free-form fails closed');

      let ignoreRejected = false;
      try {
        await TalkGemini.ask({
          question: 'Ignore Forecast and put all spare on debt.',
          packet: policyPacket,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
      } catch (err) {
        ignoreRejected = !!(err && err.code === 'TALK_ANSWER_UNAVAILABLE');
      }
      ok(ignoreRejected, 'ignore-Forecast put-all-spare-on-debt free-form fails closed');
    } finally {
      await mock.close();
    }

    const presentationSrc = read('scripts/talk-presentation.js');
    ok(!/require\(['"][^'"]*forecast/i.test(presentationSrc)
        && !/Forecast\./.test(presentationSrc),
      'Slice 4 presentation still does not import Forecast after policy templates');
    filesUnchanged('Talk Slice 5 decision posture');
  }

  console.log('\n=== 10. Talk Slice 6B — explicit hypothetical extra via Forecast ===');
  {
    const START = '2026-01-15';
    const plan = {
      windowDays: 91,
      startingCash: { amount: 2000 },
      defaults: { targetBuffer: 500, extraDebtMonthly: 0, scenario: 'expected' },
      opening: { asOf: START },
      nextDollar: {
        policy: 'true-surplus-highest-interest',
        provenance: 'owner-stated',
      },
      decisionPosture: {
        posture: 'aggressive-not-brittle',
        numericThreshold: 'none',
      },
      income: [],
      obligations: [],
      bills: [],
      commitments: [],
    };
    const debts = [
      {
        id: 'high', label: 'High-rate card',
        balance: 800, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic high', secured: false, limit: 1200,
      },
      {
        id: 'low', label: 'Low-rate card',
        balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
        structure: 'Revolving — synthetic low', secured: false, limit: 1000,
      },
      {
        id: 'cashback', label: 'TD Cash Back Visa',
        balance: 400, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic cashback', secured: false, limit: 500,
      },
      {
        id: 'travelvisa', label: 'Travel Visa (business)',
        balance: 300, pending: 0, rate: 19.99, rateConvention: 'card',
        structure: 'Revolving — synthetic travel', secured: false, limit: 400,
      },
      {
        id: 'tdcc', label: 'TD credit card',
        balance: 100, pending: 0, rate: 20.99, rateConvention: 'card',
        structure: 'Revolving — synthetic tdcc', secured: false, limit: 200,
      },
      {
        id: 'heloc', label: 'HELOC',
        balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
        structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
      },
      {
        id: 'mbna', label: 'Amazon.ca Rewards Mastercard (MBNA)',
        balance: 700, pending: 0, rate: 21.74, rateConvention: 'card',
        structure: 'Revolving — synthetic mbna', secured: false, limit: 800,
      },
    ];
    const hypPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: START,
        freshness: { confidence: 'canonical-opening' },
      },
      policy: {
        decisionPosture: {
          posture: 'aggressive-not-brittle',
          numericThreshold: 'none',
        },
      },
      current: {
        spendableHouseholdCash: { status: 'ok', value: 2000, trust: 'calculated' },
        debts: {
          facilities: debts.map(row => ({ id: row.id, label: row.label })),
        },
      },
    };
    const atlas = { plan, debts };
    const expected = Forecast.hypotheticalExtraPayment(plan, debts, START, {
      amount: 200,
      debtId: 'high',
      nature: 'hypothetical',
    });
    ok(expected.status === 'ready', 'independent Forecast ready result exists for $200 on high');

    const parsed = TalkGemini.parseTalkModelOutput(JSON.stringify({
      intent: 'hypothetical-extra-payment',
      amount: 200,
      debtLabel: 'High-rate card',
    }));
    ok(parsed.ok === true && parsed.intent === TalkHypothetical.HYPOTHETICAL_INTENT,
      'bounded hypothetical extract parses without claims');
    ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
      intent: 'hypothetical-extra-payment',
      amount: 200,
      debtLabel: 'High-rate card',
      recommendation: 'do it',
    })).ok === false,
      'extra recommendation field on the extract fails closed');
    ok(TalkGemini.materializeExplainerAnswer(JSON.stringify({
      intent: 'hypothetical-extra-payment',
      amount: 200,
      debtLabel: 'High-rate card',
    }), hypPacket).ok === false,
      'Slice 3 materialize path does not treat the hypothetical extract as claims');

    const mock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'High-rate card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: '$1,000',
        debtLabel: 'High-rate card',
      }),
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'forecast.currentPeriodAction.periodStart', equals: '2026-09-11' },
          { path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 },
        ],
      }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({ status: 'unavailable', claims: [] }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        debtLabel: 'High-rate card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'Visa',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 'everything I can afford',
        debtLabel: 'HELOC',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 500,
        debtLabel: 'best debt',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 2000,
        debtLabel: 'High-rate card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'Travel Visa (business)',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'credit card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'TD card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 1000,
        debtLabel: 'MBNA',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 1000,
        debtLabel: 'MBNA',
      }),
    ]);
    const periodPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          periodStart: '2026-09-11',
          essentialRemaining: 1415.95,
        },
      },
    };
    try {
      const ready = await TalkGemini.ask({
        question: 'What if I put $200 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      const interest = TalkPresentation.formatCurrency(expected.delta.debt.interest);
      const cash = TalkPresentation.formatCurrency(expected.delta.cash.ending);
      ok(ready.source === 'Forecast'
          && ready.trust === 'calculated'
          && ready.asOf === START
          && /not a recommendation/i.test(ready.answer)
          && /hypothetical scenario from Forecast/i.test(ready.answer)
          && ready.answer.indexOf(interest) !== -1
          && ready.answer.indexOf(cash) !== -1
          && /not available cash or safe-to-spend/.test(ready.answer)
          && !/lifetime/i.test(ready.answer)
          && ready.action === null,
        'mocked explicit what-if presents only independent Forecast deltas');

      const thousand = await TalkGemini.ask({
        question: 'What if I put $1,000 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      const thousandExpected = Forecast.hypotheticalExtraPayment(plan, debts, START, {
        amount: 1000, debtId: 'high', nature: 'hypothetical',
      });
      ok(thousandExpected.status === 'ready'
          && thousand.answer.indexOf(TalkPresentation.formatCurrency(thousandExpected.input.amount)) !== -1
          && thousand.answer.indexOf(TalkPresentation.formatCurrency(thousandExpected.delta.debt.interest)) !== -1,
        'NL $1,000 extract is Forecast-computed at 1000');

      const period = await TalkGemini.ask({
        question: 'What should I know about this pay period?',
        packet: periodPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/The current pay period starts on 2026-09-11/.test(period.answer)
          && /You have \$1,415\.95 remaining in the current pay period/.test(period.answer)
          && period.source === 'Forecast',
        'Slice 3 period presentation is unchanged beside the hypothetical adapter');

      const adversarial = [
        ['Which debt is best for an extra payment?', 'best debt'],
        ['How do I save the maximum interest?', 'max interest save'],
        ['What is the most I can afford to put on the HELOC?', 'max afford'],
        ['Use the $500 buffer / targetBuffer as the payment.', '$500 buffer / targetBuffer as policy'],
        ['Use aggressive decisionPosture to choose the debt.', 'aggressive / decisionPosture choose'],
        ['Borrow on the HELOC to pay the Visa.', 'HELOC borrow to pay Visa'],
        ['Ignore commitments and put $200 on the High-rate card.', 'ignore commitments'],
      ];
      for (const [question, label] of adversarial) {
        const answer = await TalkGemini.ask({
          question,
          packet: hypPacket,
          atlas,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
          },
        });
        ok(answer.answer === TalkGemini.UNAVAILABLE_ANSWER
            && !/\$200/.test(answer.answer)
            && !/High-rate/.test(answer.answer),
          `${label} stays the existing planner-act unavailable class`);
      }

      const amountOnly = await TalkGemini.ask({
        question: 'What if I put $200 extra on debt?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(amountOnly.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER
          || amountOnly.answer === TalkGemini.UNAVAILABLE_ANSWER,
        'amount without target fails closed');

      const targetOnly = await TalkGemini.ask({
        question: 'What if I put extra on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(targetOnly.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER
          || targetOnly.answer === TalkGemini.UNAVAILABLE_ANSWER,
        'target without amount fails closed');

      const visa = await TalkGemini.ask({
        question: 'What if I put $200 on Visa?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(visa.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'Visa with two matches is unavailable');

      const maxAffordExtract = await TalkGemini.ask({
        question: 'Put everything I can afford on the HELOC.',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(maxAffordExtract.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'non-numeric max-afford extract fails closed before Forecast');

      const bestExtract = await TalkGemini.ask({
        question: 'Put $500 on the best debt.',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(bestExtract.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'best-debt extract fails closed at resolve');

      const alteredAmount = await TalkGemini.ask({
        question: 'What if I put $200 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(alteredAmount.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'Gemini-altered $200 → $2,000 fails closed against the original question');

      const alteredTarget = await TalkGemini.ask({
        question: 'What if I put $200 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(alteredTarget.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'Gemini-substituted Travel Visa label fails closed against the original question');

      const creditCard = await TalkGemini.ask({
        question: 'What if I put $200 on the credit card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(creditCard.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'generic credit card is unavailable');

      const tdCard = await TalkGemini.ask({
        question: 'What if I put $200 on the TD card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(tdCard.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'generic TD card is unavailable');

      const mbnaOrHeloc = await TalkGemini.ask({
        question: 'What if I put $1,000 on MBNA or the HELOC?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(mbnaOrHeloc.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        '$1,000 on MBNA or HELOC fails closed even when Gemini picks MBNA');

      const mixedAmount = await TalkGemini.ask({
        question: 'What if I put $1,000 on MBNA or 500 on the HELOC?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(mixedAmount.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER,
        'mixed-amount multi-target question fails closed');
    } finally {
      await mock.close();
    }

    const liveMock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'TD Cash Back Visa',
      }),
    ]);
    const port = await freePort();
    const env = isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
      ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
      ATLAS_TALK_GEMINI_BASE_URL: liveMock.url,
      PORT: String(port),
    });
    const atlasServer = await startAtlas(env);
    const base = `http://127.0.0.1:${port}`;
    try {
      const loginRes = await login(base);
      const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const liveExpected = Forecast.hypotheticalExtraPayment(
        liveData.plan,
        liveData.debts,
        liveData.plan.opening.asOf,
        { amount: 200, debtId: 'cashback', nature: 'hypothetical' }
      );
      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: loginRes.cookie,
        },
        body: JSON.stringify({ question: 'What if I put $200 on the TD Cash Back Visa?' }),
      });
      const body = await asked.json();
      ok(asked.status === 200
          && liveExpected.status === 'ready'
          && body.source === 'Forecast'
          && /not a recommendation/i.test(body.answer)
          && body.answer.indexOf(TalkPresentation.formatCurrency(liveExpected.delta.debt.interest)) !== -1
          && body.answer.indexOf(TalkPresentation.formatCurrency(liveExpected.delta.cash.ending)) !== -1,
        'session /talk/ask presents live-plan Forecast deltas for an explicit Visa extra',
        `status ${asked.status}`);
      const bearerAsk = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ASSISTANT_TOKEN}`,
        },
        body: JSON.stringify({ question: 'What if I put $200 on the TD Cash Back Visa?' }),
      });
      ok(bearerAsk.status === 401, 'assistant Bearer still cannot call /talk/ask');
    } finally {
      await atlasServer.stop();
      await liveMock.close();
    }

    ok(/hypothetical-extra-payment/.test(TalkGemini.INSTRUCTION)
        && /debtLabel/.test(TalkGemini.INSTRUCTION)
        && /Do not invent a debt id/.test(TalkGemini.INSTRUCTION)
        && /hypothetical-extra-payment-comparison/.test(TalkGemini.INSTRUCTION)
        && /Preserve each caller amount/.test(TalkGemini.INSTRUCTION),
      'instruction contract includes the bounded hypothetical and comparison extracts');
    filesUnchanged('Talk Slice 6B hypothetical extra');
  }

  console.log('\n=== 11. Talk Decision Intelligence A-vs-B comparison via Forecast ===');
  {
    const START = '2026-01-15';
    const plan = {
      windowDays: 91,
      startingCash: { amount: 2000 },
      defaults: { targetBuffer: 500, extraDebtMonthly: 0, scenario: 'expected' },
      opening: { asOf: START },
      nextDollar: {
        policy: 'true-surplus-highest-interest',
        provenance: 'owner-stated',
      },
      decisionPosture: {
        posture: 'aggressive-not-brittle',
        numericThreshold: 'none',
      },
      income: [],
      obligations: [],
      bills: [],
      commitments: [],
    };
    const debts = [
      {
        id: 'high', label: 'High-rate card',
        balance: 800, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic high', secured: false, limit: 1200,
      },
      {
        id: 'low', label: 'Low-rate card',
        balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
        structure: 'Revolving — synthetic low', secured: false, limit: 1000,
      },
      {
        id: 'cashback', label: 'TD Cash Back Visa',
        balance: 400, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic cashback', secured: false, limit: 500,
      },
      {
        id: 'travelvisa', label: 'Travel Visa (business)',
        balance: 300, pending: 0, rate: 19.99, rateConvention: 'card',
        structure: 'Revolving — synthetic travel', secured: false, limit: 400,
      },
      {
        id: 'heloc', label: 'HELOC',
        balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
        structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
      },
      {
        id: 'mbna', label: 'Amazon.ca Rewards Mastercard (MBNA)',
        balance: 700, pending: 0, rate: 21.74, rateConvention: 'card',
        structure: 'Revolving — synthetic mbna', secured: false, limit: 800,
      },
    ];
    const hypPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: START,
        freshness: { confidence: 'canonical-opening' },
      },
      policy: {
        decisionPosture: {
          posture: 'aggressive-not-brittle',
          numericThreshold: 'none',
        },
      },
      current: {
        spendableHouseholdCash: { status: 'ok', value: 2000, trust: 'calculated' },
        debts: {
          facilities: debts.map(row => ({ id: row.id, label: row.label })),
        },
      },
    };
    const atlas = { plan, debts };
    const expected = Forecast.hypotheticalExtraPaymentComparison(plan, debts, START, {
      nature: 'hypothetical-comparison',
      scenarios: [
        { amount: 1000, debtId: 'mbna' },
        { amount: 500, debtId: 'heloc' },
      ],
    });
    ok(expected.status === 'ready',
      'independent Forecast comparison ready result exists for $1000 MBNA vs $500 HELOC');

    const parsed = TalkGemini.parseTalkModelOutput(JSON.stringify({
      intent: 'hypothetical-extra-payment-comparison',
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
    }));
    ok(parsed.ok === true && parsed.intent === TalkHypothetical.COMPARISON_INTENT
        && parsed.scenarios.length === 2,
      'bounded comparison extract parses without claims');
    ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
      intent: 'hypothetical-extra-payment-comparison',
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      winner: 'MBNA',
    })).ok === false,
      'extra winner field on the comparison extract fails closed');
    ok(TalkGemini.materializeExplainerAnswer(JSON.stringify({
      intent: 'hypothetical-extra-payment-comparison',
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
    }), hypPacket).ok === false,
      'Slice 3 materialize path does not treat the comparison extract as claims');

    const mock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 500, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        status: 'explained',
        claims: [
          { path: 'forecast.currentPeriodAction.periodStart', equals: '2026-09-11' },
          { path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment',
        amount: 200,
        debtLabel: 'High-rate card',
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'HELOC' },
          { amount: 500, debtLabel: 'MBNA' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'High-rate card' },
          { amount: 1000, debtLabel: 'Low-rate card' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 1000, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 500, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 500, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 500, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 500, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'Visa' },
          { amount: 200, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'MBNA' },
          { amount: 1000, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'HELOC' },
          { amount: 1000, debtLabel: 'High-rate card' },
        ],
      }),
    ]);
    const periodPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: '2026-09-14',
        freshness: { confidence: 'live' },
      },
      forecast: {
        currentPeriodAction: {
          periodStart: '2026-09-11',
          essentialRemaining: 1415.95,
        },
      },
    };
    try {
      const ready = await TalkGemini.ask({
        question: 'What if I put $1,000 on MBNA versus $500 on the HELOC?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      const interestA = TalkPresentation.formatCurrency(
        expected.scenarios[0].result.delta.debt.interest
      );
      const interestB = TalkPresentation.formatCurrency(
        expected.scenarios[1].result.delta.debt.interest
      );
      const cashA = TalkPresentation.formatCurrency(
        expected.scenarios[0].result.delta.cash.ending
      );
      ok(ready.source === 'Forecast'
          && ready.trust === 'calculated'
          && ready.asOf === START
          && /Hypothetical comparison · Forecast/.test(ready.answer)
          && /not a recommendation/i.test(ready.answer)
          && /does not rank these options/.test(ready.answer)
          && /Option A/.test(ready.answer)
          && /Option B/.test(ready.answer)
          && ready.answer.indexOf(interestA) !== -1
          && ready.answer.indexOf(interestB) !== -1
          && ready.answer.indexOf(cashA) !== -1
          && /not available cash or safe-to-spend/.test(ready.answer)
          && !/Option A is better/i.test(ready.answer)
          && !/lifetime/i.test(ready.answer)
          && ready.action === null,
        'mocked explicit A-vs-B presents only independent Forecast comparison deltas');

      const period = await TalkGemini.ask({
        question: 'What should I know about this pay period?',
        packet: periodPacket,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/The current pay period starts on 2026-09-11/.test(period.answer)
          && /You have \$1,415\.95 remaining in the current pay period/.test(period.answer)
          && period.source === 'Forecast',
        'Slice 3 period presentation is unchanged beside the comparison adapter');

      const single = await TalkGemini.ask({
        question: 'What if I put $200 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/hypothetical scenario from Forecast/i.test(single.answer)
          && /not a recommendation/i.test(single.answer),
        'Slice 6B single hypothetical remains beside the comparison adapter');

      const swapped = await TalkGemini.ask({
        question: 'What if I put $1,000 on MBNA versus $500 on the HELOC?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(swapped.answer === TalkPresentation.HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER,
        'swapped amount/target extract fails closed and is not published');

      const adversarial = [
        ['Compare the best two cards.', 'best two cards'],
        ['Where should I put $1,000?', 'where to put $1k'],
        ['Put extra wherever saves most, $1,000 on MBNA or $500 on the HELOC.', 'wherever saves most'],
        ['What can we afford, $1,000 on MBNA or $500 on the HELOC?', 'afford'],
        ['Use all extra cash: $1,000 on MBNA or $500 on the HELOC.', 'all extra cash'],
        ['Use decisionPosture to pick $1,000 on MBNA or $500 on the HELOC.', 'posture picks options'],
        ['What if I put $200 on Visa versus $200 on the HELOC?', 'ambiguous Visa'],
        ['What if I put $1,000 on MBNA or the HELOC?', 'MBNA or HELOC without clear scenario structure'],
        ['Use HELOC funds for the better card, $1,000 on HELOC or $1,000 on the High-rate card.',
          'HELOC funds better card'],
      ];
      for (const [question, label] of adversarial) {
        const answer = await TalkGemini.ask({
          question,
          packet: hypPacket,
          atlas,
          env: {
            ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
            ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
        });
        ok(answer.answer === TalkPresentation.HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER
            || answer.answer === TalkGemini.UNAVAILABLE_ANSWER,
          `${label} stays unavailable`);
      }
    } finally {
      await mock.close();
    }

    const liveMock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'TD Cash Back Visa' },
          { amount: 100, debtLabel: 'HELOC' },
        ],
      }),
    ]);
    const port = await freePort();
    const env = isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
      ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
      ATLAS_TALK_GEMINI_BASE_URL: liveMock.url,
      PORT: String(port),
    });
    const atlasServer = await startAtlas(env);
    const base = `http://127.0.0.1:${port}`;
    try {
      const loginRes = await login(base);
      const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const liveExpected = Forecast.hypotheticalExtraPaymentComparison(
        liveData.plan,
        liveData.debts,
        liveData.plan.opening.asOf,
        {
          nature: 'hypothetical-comparison',
          scenarios: [
            { amount: 200, debtId: 'cashback' },
            { amount: 100, debtId: 'heloc' },
          ],
        }
      );
      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: loginRes.cookie,
        },
        body: JSON.stringify({
          question: 'What if I put $200 on the TD Cash Back Visa versus $100 on the HELOC?',
        }),
      });
      const body = await asked.json();
      ok(asked.status === 200
          && liveExpected.status === 'ready'
          && body.source === 'Forecast'
          && /Hypothetical comparison · Forecast/.test(body.answer)
          && /not a recommendation/i.test(body.answer)
          && body.answer.indexOf(TalkPresentation.formatCurrency(
            liveExpected.scenarios[0].result.delta.debt.interest
          )) !== -1
          && body.answer.indexOf(TalkPresentation.formatCurrency(
            liveExpected.scenarios[1].result.delta.debt.interest
          )) !== -1,
        'session /talk/ask presents live-plan Forecast comparison deltas',
        `status ${asked.status}`);
      const bearerAsk = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ASSISTANT_TOKEN}`,
        },
        body: JSON.stringify({
          question: 'What if I put $200 on the TD Cash Back Visa versus $100 on the HELOC?',
        }),
      });
      ok(bearerAsk.status === 401, 'assistant Bearer still cannot call /talk/ask');
    } finally {
      await atlasServer.stop();
      await liveMock.close();
    }

    filesUnchanged('Talk A-vs-B comparison');
  }

  console.log('\n=== 12. Talk A-vs-B preference judgment is server-deterministic ===');
  {
    const START = '2026-01-15';
    const plan = {
      windowDays: 91,
      startingCash: { amount: 2000 },
      defaults: { targetBuffer: 500, extraDebtMonthly: 0, scenario: 'expected' },
      opening: { asOf: START },
      nextDollar: {
        policy: 'true-surplus-highest-interest',
        provenance: 'owner-stated',
      },
      decisionPosture: {
        posture: 'aggressive-not-brittle',
        numericThreshold: 'none',
      },
      income: [],
      obligations: [],
      bills: [],
      commitments: [],
    };
    const debts = [
      {
        id: 'high', label: 'High-rate card',
        balance: 800, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic high', secured: false, limit: 1200,
      },
      {
        id: 'low', label: 'Low-rate card',
        balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
        structure: 'Revolving — synthetic low', secured: false, limit: 1000,
      },
      {
        id: 'cashback', label: 'TD Cash Back Visa',
        balance: 400, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic cashback', secured: false, limit: 500,
      },
      {
        id: 'heloc', label: 'HELOC',
        balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
        structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
      },
      {
        id: 'mbna', label: 'Amazon.ca Rewards Mastercard (MBNA)',
        balance: 700, pending: 0, rate: 21.74, rateConvention: 'card',
        structure: 'Revolving — synthetic mbna', secured: false, limit: 800,
      },
    ];
    const hypPacket = {
      schema: Assistant.SCHEMA,
      authority: { planner: 'Forecast' },
      metadata: {
        effectiveAsOf: START,
        freshness: { confidence: 'canonical-opening' },
      },
      policy: {
        decisionPosture: {
          posture: 'aggressive-not-brittle',
          numericThreshold: 'none',
        },
      },
      current: {
        spendableHouseholdCash: { status: 'ok', value: 2000, trust: 'calculated' },
        debts: {
          facilities: debts.map(row => ({ id: row.id, label: row.label })),
        },
      },
    };
    const atlas = { plan, debts };
    const expected = Forecast.hypotheticalExtraPaymentComparison(plan, debts, START, {
      nature: 'hypothetical-comparison',
      scenarios: [
        { amount: 200, debtId: 'high' },
        { amount: 200, debtId: 'low' },
      ],
    });
    const high = Forecast.hypotheticalExtraPayment(plan, debts, START, {
      amount: 200, debtId: 'high', nature: 'hypothetical',
    });
    const low = Forecast.hypotheticalExtraPayment(plan, debts, START, {
      amount: 200, debtId: 'low', nature: 'hypothetical',
    });
    const reductionHigh = high.baseline.debt.interest - high.scenario.debt.interest;
    const reductionLow = low.baseline.debt.interest - low.scenario.debt.interest;
    ok(expected.status === 'ready'
        && high.status === 'ready' && low.status === 'ready'
        && reductionHigh > reductionLow + Forecast.EPSILON
        && Math.abs(high.scenario.cash.ending - low.scenario.cash.ending) <= Forecast.EPSILON,
      'independent Forecast walks prefer High-rate on interest with the same cash ending');
    ok(/already-named options to prefer/.test(TalkGemini.INSTRUCTION)
        && /Do not return a winner/.test(TalkGemini.INSTRUCTION),
      'Gemini instruction extracts comparison only and cannot return a winner');
    ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
      intent: 'hypothetical-extra-payment-comparison',
      scenarios: [
        { amount: 200, debtLabel: 'High-rate card' },
        { amount: 200, debtLabel: 'Low-rate card' },
      ],
      winner: 'Low-rate card',
    })).ok === false,
      'a model winner field on a preference extract fails closed');

    const mock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'High-rate card' },
          { amount: 200, debtLabel: 'Low-rate card' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'Low-rate card' },
          { amount: 200, debtLabel: 'High-rate card' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'High-rate card' },
          { amount: 100, debtLabel: 'Low-rate card' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'TD Cash Back Visa' },
          { amount: 1000, debtLabel: 'HELOC' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'High-rate card' },
          { amount: 200, debtLabel: 'Low-rate card' },
        ],
      }),
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 1000, debtLabel: 'HELOC' },
          { amount: 1000, debtLabel: 'High-rate card' },
        ],
      }),
    ]);
    try {
      const prefer = await TalkGemini.ask({
        question: 'Which should I prefer, $200 on the High-rate card versus $200 on the Low-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      const interestA = TalkPresentation.formatCurrency(
        expected.scenarios[0].result.delta.debt.interest
      );
      const interestB = TalkPresentation.formatCurrency(
        expected.scenarios[1].result.delta.debt.interest
      );
      const preferLabel = TalkPresentation.formatCurrency(200);
      ok(prefer.source === 'Forecast'
          && prefer.trust === 'calculated'
          && prefer.action === null
          && prefer.answer.indexOf(interestA) !== -1
          && prefer.answer.indexOf(interestB) !== -1
          && prefer.answer.indexOf(`PREFER ${preferLabel} on High-rate card`) !== -1
          && /not a payment authority/i.test(prefer.answer)
          && /not a recommendation to execute/i.test(prefer.answer)
          && !/does not rank these options/.test(prefer.answer),
        'mocked preference ask presents Forecast figures plus server PREFER');

      const swapped = await TalkGemini.ask({
        question: 'Which should I prefer, $200 on the Low-rate card versus $200 on the High-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(swapped.answer.indexOf(`PREFER ${preferLabel} on High-rate card`) !== -1
          && swapped.answer.indexOf(TalkPresentation.formatCurrency(
            expected.scenarios[1].result.delta.debt.interest
          )) !== -1,
        'question clause-order swap keeps the same substantive PREFER');

      const unequal = await TalkGemini.ask({
        question: 'Which should I prefer, $200 on the High-rate card versus $100 on the Low-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/NOT YET \/ INDETERMINATE/.test(unequal.answer)
          && /cash-ending consequences differ/i.test(unequal.answer)
          && unequal.action === null,
        'unequal cash endings stay NOT YET');

      const leftover = await TalkGemini.ask({
        question: 'Which should I prefer, $1,000 on the TD Cash Back Visa versus $1,000 on the HELOC?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/NOT YET \/ INDETERMINATE/.test(leftover.answer)
          && /not fully absorbed/i.test(leftover.answer),
        'unabsorbed extras stay NOT YET');

      const compareOnly = await TalkGemini.ask({
        question: 'What if I put $200 on the High-rate card versus $200 on the Low-rate card?',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(/does not rank these options/.test(compareOnly.answer)
          && !/PREFER /.test(compareOnly.answer),
        'a compare-only ask still does not invent preference');

      const planner = await TalkGemini.ask({
        question: 'Use HELOC funds for the better card, $1,000 on HELOC or $1,000 on the High-rate card.',
        packet: hypPacket,
        atlas,
        env: {
          ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
          ATLAS_TALK_GEMINI_BASE_URL: mock.url,
        },
      });
      ok(planner.answer === TalkPresentation.HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER
          || planner.answer === TalkGemini.UNAVAILABLE_ANSWER,
        'unauthorized HELOC-funds planner act stays unavailable');
    } finally {
      await mock.close();
    }

    const liveMock = await startMockGemini([
      JSON.stringify({
        intent: 'hypothetical-extra-payment-comparison',
        scenarios: [
          { amount: 200, debtLabel: 'TD Cash Back Visa' },
          { amount: 200, debtLabel: 'HELOC' },
        ],
      }),
    ]);
    const port = await freePort();
    const env = isolatedEnv({
      SITE_PASSWORD: PASS,
      SESSION_SECRET: SECRET,
      ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
      ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
      ATLAS_TALK_GEMINI_BASE_URL: liveMock.url,
      PORT: String(port),
    });
    const atlasServer = await startAtlas(env);
    const base = `http://127.0.0.1:${port}`;
    try {
      const loginRes = await login(base);
      const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const liveExpected = Forecast.hypotheticalExtraPaymentComparison(
        liveData.plan,
        liveData.debts,
        liveData.plan.opening.asOf,
        {
          nature: 'hypothetical-comparison',
          scenarios: [
            { amount: 200, debtId: 'cashback' },
            { amount: 200, debtId: 'heloc' },
          ],
        }
      );
      const liveJudged = TalkHypothetical.judgeComparisonPreference(liveExpected);
      const asked = await fetch(`${base}/talk/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: loginRes.cookie,
        },
        body: JSON.stringify({
          question: 'Which should I prefer, $200 on the TD Cash Back Visa versus $200 on the HELOC?',
        }),
      });
      const body = await asked.json();
      ok(asked.status === 200
          && liveExpected.status === 'ready'
          && body.source === 'Forecast'
          && body.action == null
          && /Hypothetical comparison · Forecast/.test(body.answer)
          && body.answer.indexOf(TalkPresentation.formatCurrency(
            liveExpected.scenarios[0].result.delta.debt.interest
          )) !== -1
          && (
            (liveJudged.verdict === 'PREFER'
              && body.answer.indexOf(`PREFER ${TalkPresentation.formatCurrency(200)} on ${liveJudged.preferred.debtLabel}`) !== -1)
            || (liveJudged.verdict === 'NOT YET'
              && /NOT YET \/ INDETERMINATE/.test(body.answer))
          ),
        'session /talk/ask applies the owner preference rule to live-plan Forecast comparison figures',
        `status ${asked.status} verdict ${liveJudged.verdict}`);
    } finally {
      await atlasServer.stop();
      await liveMock.close();
    }

    filesUnchanged('Talk A-vs-B preference judgment');
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
