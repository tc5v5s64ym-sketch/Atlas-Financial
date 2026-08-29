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
//    exposing the same packet as one read-only tool. Browser, static assistant,
//    and OAuth credentials do not unlock one another.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SnapshotBalances = require('./scripts/snapshot-balances.js');
const LivePlan = require('./scripts/live-plan.js');
const Assistant = require('./scripts/assistant-packet.js');
const AssistantMcp = require('./scripts/assistant-mcp.js');
const AssistantOAuth = require('./scripts/assistant-oauth.js');

const PASSWORD = process.env.SITE_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
const ASSISTANT_TOKEN = process.env.ATLAS_ASSISTANT_TOKEN || '';
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
  if (req.path === '/data.json' || req.path === '/balance-history.json') {
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
