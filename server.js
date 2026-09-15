'use strict';
// Household financial dashboard — password-gated.
//
// Design notes:
//  * Fails closed. Without SITE_PASSWORD and SESSION_SECRET the server refuses
//    to start, so a misconfigured deploy can never serve the data publicly.
//  * The financial data is served only to an authenticated session. Nothing
//    sensitive sits in the static directory.
//  * Sessions are stateless: an HMAC-signed cookie, so a restart (Render free
//    tier sleeps) does not force a re-login mid-session.
//  * GET /assistant/current remains a dedicated static-Bearer consumer.
//    POST /assistant/mcp is separate again: an OAuth-protected MCP resource
//    exposing the same packet as one read-only tool. GET /talk/context is the
//    household-session consumer of that same packet. POST /talk/ask is the
//    session-only Gemini explainer for Talk, with an ephemeral in-memory
//    turn buffer keyed to the authenticated session; GET /talk/capability
//    says whether that path is configured. Conversation history is
//    conversational context only and is not household-financial evidence.
//    POST /talk/ask may emit allowlisted SSE progress phases when the
//    browser asks for text/event-stream, then the same verified JSON
//    body. Gemini tokens are never streamed. Browser, static assistant,
//    and OAuth credentials do not unlock one another. The Talk model
//    secret never reaches the browser.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SnapshotBalances = require('./scripts/snapshot-balances.js');
const LivePlan = require('./scripts/live-plan.js');
const Assistant = require('./scripts/assistant-packet.js');
const AssistantMcp = require('./scripts/assistant-mcp.js');
const AssistantOAuth = require('./scripts/assistant-oauth.js');
const TalkGemini = require('./scripts/talk-gemini.js');
const TalkPresentation = require('./scripts/talk-presentation.js');
const TalkHypothetical = require('./scripts/talk-hypothetical.js');
const TalkSession = require('./scripts/talk-session.js');
const TalkStream = require('./scripts/talk-stream.js');
const TalkWhy = require('./scripts/talk-why.js');

const PASSWORD = process.env.SITE_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
const ASSISTANT_TOKEN = process.env.ATLAS_ASSISTANT_TOKEN || '';
const TALK_GEMINI_KEY = process.env.ATLAS_TALK_GEMINI_API_KEY || '';
const PORT = process.env.PORT || 3000;
const SESSION_HOURS = 24 * 14;
const MCP_OAUTH = AssistantOAuth.readConfig(process.env);
const MCP_BEARER_AUTH = MCP_OAUTH.configured
  ? AssistantOAuth.createBearerMiddleware(MCP_OAUTH)
  : null;

if (!PASSWORD || PASSWORD.length < 8) {
  console.error('FATAL: SITE_PASSWORD is not set, or is shorter than 8 characters.');
  process.exit(1);
}
if (!SECRET || SECRET.length < 16) {
  console.error('FATAL: SESSION_SECRET is not set, or is shorter than 16 characters.');
  process.exit(1);
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
if (ASSISTANT_TOKEN && ASSISTANT_TOKEN.length < Assistant.TOKEN_MIN_LENGTH) {
  console.error('FATAL: ATLAS_ASSISTANT_TOKEN is set but shorter than 32 characters.');
  process.exit(1);
}
if (ASSISTANT_TOKEN && sameSecret(ASSISTANT_TOKEN, PASSWORD)) {
  console.error('FATAL: ATLAS_ASSISTANT_TOKEN must not reuse SITE_PASSWORD.');
  process.exit(1);
}
if (ASSISTANT_TOKEN && sameSecret(ASSISTANT_TOKEN, SECRET)) {
  console.error('FATAL: ATLAS_ASSISTANT_TOKEN must not reuse SESSION_SECRET.');
  process.exit(1);
}
if (TALK_GEMINI_KEY && TALK_GEMINI_KEY.length < TalkGemini.TOKEN_MIN_LENGTH) {
  console.error('FATAL: ATLAS_TALK_GEMINI_API_KEY is set but shorter than 32 characters.');
  process.exit(1);
}
if (TALK_GEMINI_KEY && sameSecret(TALK_GEMINI_KEY, PASSWORD)) {
  console.error('FATAL: ATLAS_TALK_GEMINI_API_KEY must not reuse SITE_PASSWORD.');
  process.exit(1);
}
if (TALK_GEMINI_KEY && sameSecret(TALK_GEMINI_KEY, SECRET)) {
  console.error('FATAL: ATLAS_TALK_GEMINI_API_KEY must not reuse SESSION_SECRET.');
  process.exit(1);
}
if (TALK_GEMINI_KEY && ASSISTANT_TOKEN && sameSecret(TALK_GEMINI_KEY, ASSISTANT_TOKEN)) {
  console.error('FATAL: ATLAS_TALK_GEMINI_API_KEY must not reuse ATLAS_ASSISTANT_TOKEN.');
  process.exit(1);
}

const talkSessions = TalkSession.createSessionContext({ secret: SECRET });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render terminates TLS in front of us
app.use(express.urlencoded({ extended: false, limit: '8kb' }));

// ---------------------------------------------------------------- security
app.use((req, res, next) => {
  res.set({
    'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  next();
});

app.get('/robots.txt', (_req, res) => res.type('text/plain').send('User-agent: *\nDisallow: /\n'));

// ---------------------------------------------------------------- sessions
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}
function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function authed(req) {
  return verify(readCookie(req, 'hfd_session')) !== null;
}
function assistantConfigured() {
  return Assistant.tokenConfigured({ ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN });
}
function readBearer(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match ? match[1] : null;
}
function assistantAuthed(req) {
  if (!assistantConfigured()) return false;
  const suppliedRaw = readBearer(req);
  if (typeof suppliedRaw !== 'string') return false;
  const supplied = Buffer.from(suppliedRaw);
  const actual = Buffer.from(ASSISTANT_TOKEN);
  if (supplied.length !== actual.length) return false;
  return crypto.timingSafeEqual(supplied, actual);
}
function assistantHttpGuard(req, res) {
  const ip = req.ip || 'unknown';
  if (!assistantConfigured()) {
    res.status(503).json({ error: 'assistant unavailable' });
    return true;
  }
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return true;
  }
  if (!assistantAuthed(req)) {
    noteAttempt(ip);
    assistantUnauthorized(res);
    return true;
  }
  return false;
}
async function buildCurrentAssistantPacket() {
  const served = await servedAtlasData();
  return Assistant.buildPacket({
    data: served,
    env: process.env,
    now: new Date().toISOString(),
  });
}
// Secure is mandatory in production (Render is always HTTPS) but must be
// omitted over plain http, or a local test session can never be sent back.
function secureFlag(req) {
  return (req.secure || req.get('x-forwarded-proto') === 'https') ? ' Secure;' : '';
}

// Simple in-memory throttle. Enough to stop guessing; resets on restart.
const attempts = new Map();
function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 15 * 60 * 1000) { attempts.delete(ip); return false; }
  return rec.count >= 8;
}
function noteAttempt(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) attempts.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}

// ---------------------------------------------------------------- login
const LOGIN_HTML = (error) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Sign in</title><link rel="stylesheet" href="/styles.css"></head>
<body class="login-page"><main class="login-card">
<h1>Household finances</h1>
<p class="muted">This page is private. Enter the shared password to continue.</p>
${error ? `<p class="login-error" role="alert">${error}</p>` : ''}
<form method="POST" action="/login" autocomplete="on">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
</form>
</main></body></html>`;

app.get('/login', (req, res) => {
  if (authed(req)) return res.redirect('/');
  res.type('html').send(LOGIN_HTML(null));
});

app.post('/login', (req, res) => {
  const ip = req.ip || 'unknown';
  if (tooManyAttempts(ip)) {
    return res.status(429).type('html').send(LOGIN_HTML('Too many attempts. Wait 15 minutes.'));
  }
  const supplied = Buffer.from(String(req.body.password || ''));
  const actual = Buffer.from(PASSWORD);
  const ok = supplied.length === actual.length && crypto.timingSafeEqual(supplied, actual);
  if (!ok) {
    noteAttempt(ip);
    return res.status(401).type('html').send(LOGIN_HTML('That password is not right.'));
  }
  attempts.delete(ip);
  const token = sign({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.set('Set-Cookie',
    `hfd_session=${encodeURIComponent(token)}; HttpOnly;${secureFlag(req)} SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  const token = readCookie(req, 'hfd_session');
  if (token) talkSessions.clear(talkSessions.keyFromToken(token));
  res.set('Set-Cookie', `hfd_session=; HttpOnly;${secureFlag(req)} SameSite=Lax; Path=/; Max-Age=0`);
  res.redirect('/login');
});

// The health check has to answer before the gate, not behind it. render.yaml
// declares /healthz as the health-check path, but sitting below the gate it
// only ever returned a 302 to the login page — a platform that requires a 2xx
// would mark the service unhealthy and restart it in a loop. It serves the
// literal string "ok" and reads nothing, so this widens no data surface.
app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// OAuth protected-resource discovery is public metadata. It contains no token,
// credential, or household data. The authorization server itself is external;
// Atlas remains only the read-only resource server.
function oauthMetadata(_req, res) {
  if (!MCP_OAUTH.configured) {
    return res.status(503).json({ error: 'assistant oauth unavailable' });
  }
  return res.json(AssistantOAuth.protectedResourceMetadata(MCP_OAUTH));
}
app.get(AssistantOAuth.METADATA_PATH, oauthMetadata);
app.get(`${AssistantOAuth.METADATA_PATH}/assistant/mcp`, oauthMetadata);

// ---------------------------------------------------------------- data cache
// Shared by the browser /data.json session route and the assistant packet.
// Overlay is on-demand GET-only; this never writes canonical state.
let cachedData = null;
let cachedAt = 0;
function loadCanonicalData() {
  const file = path.join(__dirname, 'data.json');
  const stat = fs.statSync(file);
  if (!cachedData || stat.mtimeMs > cachedAt) {
    cachedData = JSON.parse(fs.readFileSync(file, 'utf8'));
    cachedAt = stat.mtimeMs;
  }
  return cachedData;
}
async function servedAtlasData() {
  return LivePlan.applyForServer(loadCanonicalData(), process.env);
}

// ---------------------------------------------------------------- assistant (dedicated auth; not the browser session)
function assistantUnauthorized(res) {
  res.set('WWW-Authenticate', 'Bearer realm="atlas-assistant"');
  return res.status(401).json({ error: 'not authenticated' });
}
app.get('/assistant/current', async (req, res) => {
  if (assistantHttpGuard(req, res)) return;
  try {
    res.json(await buildCurrentAssistantPacket());
  } catch (err) {
    console.error('assistant packet could not be built:', err.message);
    res.status(500).json({ error: 'assistant unavailable' });
  }
});
app.all('/assistant/current', (_req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ error: 'method not allowed' });
});

function mcpOAuthGate(req, res, next) {
  if (!MCP_OAUTH.configured || !MCP_BEARER_AUTH) {
    return res.status(503).json({ error: 'assistant oauth unavailable' });
  }
  if (!AssistantMcp.originAllowed(req.get('origin'))) {
    return res.status(403).json({ error: 'origin not allowed' });
  }
  return MCP_BEARER_AUTH(req, res, next);
}
const mcpJson = express.json({ limit: '32kb', type: 'application/json' });
app.post('/assistant/mcp', mcpOAuthGate, (req, res, next) => {
  mcpJson(req, res, (err) => {
    if (!err) return next();
    return res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'parse error' },
    });
  });
}, async (req, res) => {
  try {
    await AssistantMcp.handleHttp(req, res, { getPacket: buildCurrentAssistantPacket });
  } catch (err) {
    console.error('assistant MCP request failed');
    if (!res.headersSent) {
      return res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'internal error' },
      });
    }
  }
});
app.all('/assistant/mcp', mcpOAuthGate, (_req, res) => {
  res.set('Allow', 'POST');
  return res.status(405).json({ error: 'method not allowed' });
});

// ---------------------------------------------------------------- gate
// styles.css is needed by the login page, so it stays public. Everything else
// requires a session. The assistant route has its own Bearer gate above and
// is not unlocked by a browser cookie. MCP has its own OAuth gate above.
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/styles.css' || req.path === '/robots.txt') return next();
  if (req.path === '/assistant/current' || req.path === '/assistant/mcp') {
    return res.status(401).json({ error: 'not authenticated' });
  }
  if (authed(req)) return next();
  if (req.path === '/data.json' || req.path === '/balance-history.json'
      || req.path === '/talk/context' || req.path === '/talk/ask'
      || req.path === '/talk/capability') {
    return res.status(401).json({ error: 'not authenticated' });
  }
  return res.redirect('/login');
});

// ---------------------------------------------------------------- data
app.get('/data.json', async (_req, res) => {
  try {
    // Dated openings stay on disk. An explicit overlay (ATLAS_LIVE_OVERLAY=
    // fixture|live) may replace posted/pending for today's live plan only.
    // Production read-only Lunch Money uses live mode plus owner-supplied
    // secrets. Default without that flag remains the canonical file.
    const served = await servedAtlasData();
    res.json(served);
  } catch (err) {
    console.error('data.json could not be read:', err.message);
    res.status(500).json({ error: 'data unavailable' });
  }
});

// Talk context — same incumbent assistant packet, browser session only.
// Does not change /assistant/current or /assistant/mcp auth semantics.
// Browser JS must not authenticate to those assistant endpoints.
app.get('/talk/context', async (_req, res) => {
  try {
    res.json(await buildCurrentAssistantPacket());
  } catch (err) {
    console.error('talk context packet could not be built:', err.message);
    res.status(500).json({ error: 'talk context unavailable' });
  }
});
app.all('/talk/context', (_req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ error: 'method not allowed' });
});

// Talk capability — session only. Reports whether the Gemini explainer
// path is configured. Never includes the model secret or the packet.
app.get('/talk/capability', (_req, res) => {
  res.json(TalkGemini.capability(process.env));
});
app.all('/talk/capability', (_req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ error: 'method not allowed' });
});

// Talk ask — session-only Gemini explainer plus authorized follow-ups.
// Builds the incumbent assistant packet (same builder as /talk/context).
// An ephemeral in-memory turn buffer is keyed to this authenticated
// session. History is conversational context only: it is not household-
// financial evidence, Forecast state, owner policy, a write, or
// permission. Follow-up amounts and named debts are filled only when
// the server can deterministically resolve them under the authorized
// contract; ambiguity is unavailable. Campaign-style verified
// follow-ups resolve only against ephemeral structured refs from a
// prior verified presentation and re-read this request's packet or
// recompute Forecast; conversation prose is not a figure source.
// Every financial answer still verifies against this request's packet
// or is computed by Forecast on current Atlas state. Client history
// fields are rejected. No durable store. Does not write.
//
// Accept: text/event-stream receives allowlisted progress phases, then
// the same verified public JSON body as a final result event. Gemini
// tokens, incomplete model JSON, and unverified prose are never written
// to the stream. Envelope failures stay JSON so the auth and body
// contract do not change.
const talkAskJson = express.json({ limit: '4kb', type: 'application/json' });

function appendTalkSessionTurn(sessionKey, question, presented) {
  talkSessions.append(sessionKey, {
    question,
    presented: presented.answer,
    kind: presented.sessionTurn && presented.sessionTurn.kind,
    amount: presented.sessionTurn && presented.sessionTurn.amount,
    debtId: presented.sessionTurn && presented.sessionTurn.debtId,
    debtLabel: presented.sessionTurn && presented.sessionTurn.debtLabel,
    scenarios: presented.sessionTurn && presented.sessionTurn.scenarios,
    referentPaths: presented.sessionTurn && presented.sessionTurn.referentPaths,
    referentKeys: presented.sessionTurn && presented.sessionTurn.referentKeys,
    billId: presented.sessionTurn && presented.sessionTurn.billId,
    billLabel: presented.sessionTurn && presented.sessionTurn.billLabel,
    priorKind: presented.sessionTurn && presented.sessionTurn.priorKind,
    // Already-sanitized published Forecast baseline only. Not evidence.
    asOf: presented.sessionTurn && presented.sessionTurn.asOf,
    freshness: presented.sessionTurn && presented.sessionTurn.freshness,
  });
}

async function presentTalkAskTurn(parsed, sessionKey, onPhase) {
  const phase = (name) => {
    if (typeof onPhase === 'function') onPhase(name);
  };
  phase('understanding');
  phase('checking-atlas-context');
  const priorTurns = talkSessions.turns(sessionKey);
  const served = await servedAtlasData();
  const packet = Assistant.buildPacket({
    data: served,
    env: process.env,
    now: new Date().toISOString(),
  });
  const atlas = {
    plan: served && served.plan,
    debts: served && served.debts,
  };
  const follow = TalkSession.resolveFollowup({
    question: parsed.question,
    priorTurn: TalkSession.lastTurn(priorTurns),
    priorTurns,
    debts: atlas.debts,
    packet,
    sessionComparison: talkSessions.sessionComparison(sessionKey),
  });
  let presented;
  if (follow.status === 'ambiguous') {
    presented = follow.nature === 'comparison'
      ? TalkPresentation.presentHypotheticalComparison({ status: 'unavailable' }, packet)
      : follow.nature === 'hypothetical'
        ? TalkPresentation.presentHypotheticalExtra({ status: 'unavailable' }, packet)
        : TalkPresentation.presentVerifiedClaims({ status: 'unavailable', claims: [] }, packet);
    presented.sessionTurn = { kind: 'unavailable' };
  } else if (follow.status === 'resolved-hypothetical') {
    phase('running-forecast');
    const result = TalkHypothetical.evaluateResolved({
      amount: follow.amount,
      debtId: follow.debtId,
      plan: atlas.plan,
      debts: atlas.debts,
      packet,
    });
    presented = TalkPresentation.presentHypotheticalExtra(result, packet);
    presented.sessionTurn = TalkSession.sessionTurnFromHypothetical(result, presented);
  } else if (follow.status === 'resolved-comparison'
      || follow.status === 'resolved-preference') {
    phase('running-forecast');
    const result = TalkHypothetical.evaluateComparisonResolved({
      scenarios: follow.scenarios,
      plan: atlas.plan,
      debts: atlas.debts,
      packet,
    });
    const preference = follow.status === 'resolved-preference'
      || TalkHypothetical.questionAsksAuthorizedPreference(parsed.question)
      ? TalkHypothetical.judgeComparisonPreference(result)
      : null;
    presented = TalkPresentation.presentHypotheticalComparison(result, packet, preference);
    presented.sessionTurn = TalkSession.sessionTurnFromComparison(result, presented);
  } else if (follow.status === 'resolved-reference') {
    if (follow.referentKey === TalkSession.REMAINING_BILLS_INTENT) {
      presented = TalkPresentation.presentPaydayRemainingBills(follow, packet);
      presented.sessionTurn = presented && presented.trust !== 'unavailable'
        ? TalkSession.sessionTurnFromRemainingBills(follow)
        : { kind: 'unavailable' };
    } else {
      const claims = TalkWhy.publishablePaths(follow.paths, packet);
      presented = TalkPresentation.presentVerifiedClaims(
        claims.length ? { status: 'explained', claims } : { status: 'unavailable', claims: [] },
        packet
      );
      presented.sessionTurn = claims.length
        ? TalkWhy.sessionTurnFromExplained(claims)
        : { kind: 'unavailable' };
    }
  } else if (TalkWhy.questionAsksWhy(parsed.question)) {
    const why = TalkWhy.resolve({
      question: parsed.question,
      packet,
      priorTurn: TalkSession.lastTurn(priorTurns),
    });
    // Determined local results only: ready, planner-act, missing last
    // referent, no published risk, missing packet, or stale baseline.
    // A why-ask whose referent is not yet selected reaches Gemini extract.
    if (why.status === 'ready' || why.reason === 'planner-act'
        || why.reason === 'no-referent' || why.reason === 'no-risk'
        || why.reason === 'missing packet' || why.reason === 'stale-baseline') {
      presented = TalkPresentation.presentWhyExplanation(why, packet);
      presented.sessionTurn = TalkWhy.sessionTurnFromWhy(why);
    } else {
      presented = await TalkGemini.ask({
        question: parsed.question,
        packet,
        env: process.env,
        atlas,
        conversation: talkSessions.publicConversation(priorTurns),
        priorTurn: TalkSession.lastTurn(priorTurns),
        priorTurns,
      });
    }
  } else {
    presented = await TalkGemini.ask({
      question: parsed.question,
      packet,
      env: process.env,
      atlas,
      conversation: talkSessions.publicConversation(priorTurns),
      priorTurn: TalkSession.lastTurn(priorTurns),
      priorTurns,
    });
  }
  if (!presented || typeof presented.answer !== 'string' || !presented.answer.trim()) {
    return { error: 'talk answer unavailable' };
  }
  phase('preparing-verified-answer');
  return { presented };
}

function finishTalkAskJson(res, presented, sessionKey, question) {
  const body = TalkStream.publicAskBody(presented);
  if (!body) return res.status(502).json({ error: 'talk answer unavailable' });
  appendTalkSessionTurn(sessionKey, question, presented);
  return res.json(body);
}

function finishTalkAskError(res, stream, err) {
  if (err && err.code === 'TALK_UNAVAILABLE') {
    if (stream) {
      TalkStream.writeError(res, 'talk unavailable');
      TalkStream.endStream(res);
      return;
    }
    return res.status(503).json({ error: 'talk unavailable' });
  }
  if (err && err.code === 'TALK_MALFORMED') {
    const message = err.message === 'question too long' ? 'question too long' : 'malformed request';
    if (stream) {
      TalkStream.writeError(res, message);
      TalkStream.endStream(res);
      return;
    }
    return res.status(400).json({ error: err.message || 'malformed request' });
  }
  console.error('talk ask failed');
  if (stream) {
    TalkStream.writeError(res, 'talk answer unavailable');
    TalkStream.endStream(res);
    return;
  }
  return res.status(502).json({ error: 'talk answer unavailable' });
}

app.post('/talk/ask', (req, res, next) => {
  talkAskJson(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'malformed request' });
    return next();
  });
}, async (req, res) => {
  const stream = TalkStream.wantsStream(req);
  try {
    if (!TalkGemini.isConfigured(process.env)) {
      return res.status(503).json({ error: 'talk unavailable' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'malformed request' });
    }
    const keys = Object.keys(body);
    if (keys.length !== 1 || keys[0] !== 'question') {
      return res.status(400).json({ error: 'malformed request' });
    }
    const parsed = TalkGemini.normalizeQuestion(body.question);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    const token = readCookie(req, 'hfd_session');
    const sessionKey = talkSessions.keyFromToken(token);
    if (stream) {
      const gate = TalkStream.createAbortGate(req, res);
      TalkStream.beginStream(res);
      const onPhase = (name) => {
        if (!gate.closed) TalkStream.writeStatus(res, name);
      };
      const outcome = await presentTalkAskTurn(parsed, sessionKey, onPhase);
      if (gate.closed) {
        TalkStream.endStream(res);
        return;
      }
      if (outcome.error || !outcome.presented) {
        TalkStream.writeError(res, 'talk answer unavailable');
        TalkStream.endStream(res);
        return;
      }
      const write = TalkStream.writeResult(res, outcome.presented);
      if (write.accepted) {
        appendTalkSessionTurn(sessionKey, parsed.question, outcome.presented);
      }
      TalkStream.endStream(res);
      return;
    }
    const outcome = await presentTalkAskTurn(parsed, sessionKey, null);
    if (outcome.error || !outcome.presented) {
      return res.status(502).json({ error: 'talk answer unavailable' });
    }
    return finishTalkAskJson(res, outcome.presented, sessionKey, parsed.question);
  } catch (err) {
    return finishTalkAskError(res, stream && res.headersSent, err);
  }
});
app.all('/talk/ask', (_req, res) => {
  res.set('Allow', 'POST');
  return res.status(405).json({ error: 'method not allowed' });
});

// Dated balance snapshots. Assembled at request time from snapshots/*.json
// so that folder remains the history authority. Not Forecast input and not
// a second current-state document.
let cachedHistory = null;
let cachedHistoryAt = 0;
function historyMtime(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((max, name) => {
    const st = fs.statSync(path.join(dir, name));
    return st.mtimeMs > max ? st.mtimeMs : max;
  }, 0);
}
app.get('/balance-history.json', (_req, res) => {
  try {
    const dir = SnapshotBalances.DEFAULT_OUT;
    const stamp = historyMtime(dir);
    if (!cachedHistory || stamp !== cachedHistoryAt) {
      cachedHistory = SnapshotBalances.loadHistory(dir);
      cachedHistoryAt = stamp;
    }
    res.json(cachedHistory);
  } catch (err) {
    console.error('balance history could not be read:', err.message);
    res.status(500).json({ error: 'history unavailable' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false, lastModified: false, maxAge: 0,
  setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

app.use((_req, res) => res.status(404).type('text/plain').send('Not found'));

app.listen(PORT, () => {
  console.log(`Household finance dashboard listening on ${PORT}`);
});
