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
//  * GET /assistant/current is a separate read-only consumer. POST
//    /assistant/mcp is the Streamable HTTP MCP adapter over that same packet.
//    Neither is unlocked by the browser session. Both require
//    ATLAS_ASSISTANT_TOKEN as a Bearer secret. Unset token → 503. They never
//    write.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SnapshotBalances = require('./scripts/snapshot-balances.js');
const LivePlan = require('./scripts/live-plan.js');
const Assistant = require('./scripts/assistant-packet.js');
const AssistantMcp = require('./scripts/assistant-mcp.js');

const PASSWORD = process.env.SITE_PASSWORD;
const SECRET = process.env.SESSION_SECRET;
const ASSISTANT_TOKEN = process.env.ATLAS_ASSISTANT_TOKEN || '';
const PORT = process.env.PORT || 3000;
const SESSION_HOURS = 24 * 14;

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
// Secure is mandatory in production (Render is always HTTPS) but must be
// omitted over plain http, or a local test session can never be sent back.
function secureFlag(req) {
  return (req.secure || req.get('x-forwarded-proto') === 'https') ? ' Secure;' : '';
}

// Simple in-memory throttle. Enough to stop guessing; resets on restart.
// Login guesses and assistant Bearer guesses keep separate maps so a website
// brute-force cannot 429 a later valid ChatGPT MCP handshake.
const attempts = new Map();
const assistantAttempts = new Map();
function tooManyOn(map, ip) {
  const rec = map.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > 15 * 60 * 1000) { map.delete(ip); return false; }
  return rec.count >= 8;
}
function noteOn(map, ip) {
  const rec = map.get(ip);
  if (!rec || Date.now() - rec.first > 15 * 60 * 1000) map.set(ip, { count: 1, first: Date.now() });
  else rec.count++;
}
function tooManyAttempts(ip) {
  return tooManyOn(attempts, ip);
}
function noteAttempt(ip) {
  noteOn(attempts, ip);
}
function tooManyAssistantAttempts(ip) {
  return tooManyOn(assistantAttempts, ip);
}
function noteAssistantAttempt(ip) {
  noteOn(assistantAttempts, ip);
}
function clearAssistantAttempts(ip) {
  assistantAttempts.delete(ip);
}
function isAssistantPath(pathname) {
  return pathname === '/assistant/current' || pathname === '/assistant/mcp';
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
function assistantAuthGate(req, res, opts) {
  const ip = req.ip || 'unknown';
  if (!assistantConfigured()) {
    res.status(503).json({ error: 'assistant unavailable' });
    return false;
  }
  if (opts && opts.checkOrigin && !AssistantMcp.originAllowed(req.get('origin'))) {
    res.status(403).json({ error: 'origin not allowed' });
    return false;
  }
  if (tooManyAssistantAttempts(ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return false;
  }
  if (!assistantAuthed(req)) {
    if (readBearer(req)) noteAssistantAttempt(ip);
    assistantUnauthorized(res);
    return false;
  }
  clearAssistantAttempts(ip);
  return true;
}
async function buildServedAssistantPacket() {
  const served = await servedAtlasData();
  return Assistant.buildPacket({
    data: served,
    env: process.env,
    now: new Date().toISOString(),
  });
}
app.get('/assistant/current', async (req, res) => {
  if (!assistantAuthGate(req, res)) return;
  try {
    res.json(await buildServedAssistantPacket());
  } catch (err) {
    console.error('assistant packet could not be built:', err.message);
    res.status(500).json({ error: 'assistant unavailable' });
  }
});
app.all('/assistant/current', (_req, res) => {
  res.set('Allow', 'GET');
  return res.status(405).json({ error: 'method not allowed' });
});

const mcpJson = express.json({ limit: '32kb' });
app.post('/assistant/mcp', (req, res, next) => {
  if (!assistantAuthGate(req, res, { checkOrigin: true })) return;
  const protocolHeader = req.get('mcp-protocol-version');
  if (!AssistantMcp.protocolVersionHeaderAllowed(protocolHeader)) {
    return res.status(400).json({ error: 'unsupported protocol version' });
  }
  mcpJson(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
    }
    next();
  });
}, async (req, res) => {
  try {
    const handled = await AssistantMcp.handleMessage(req.body, {
      getPacket: buildServedAssistantPacket,
    });
    if (handled.logMessage) {
      console.error('assistant MCP handler:', handled.logMessage);
    }
    if (handled.status === 202 && handled.body == null) {
      return res.status(202).end();
    }
    return res.status(handled.status).json(handled.body);
  } catch (err) {
    console.error('assistant MCP could not be served:', err.message);
    return res.status(500).json({ error: 'assistant unavailable' });
  }
});
app.get('/assistant/mcp', (req, res) => {
  if (!assistantAuthGate(req, res, { checkOrigin: true })) return;
  res.set('Allow', 'POST');
  return res.status(405).json({ error: 'method not allowed' });
});
app.all('/assistant/mcp', (req, res) => {
  if (!assistantAuthGate(req, res, { checkOrigin: true })) return;
  res.set('Allow', 'POST');
  return res.status(405).json({ error: 'method not allowed' });
});

// ---------------------------------------------------------------- gate
// styles.css is needed by the login page, so it stays public. Everything else
// requires a session. The assistant route has its own Bearer gate above and
// is not unlocked by a browser cookie.
app.use((req, res, next) => {
  if (req.path === '/login' || req.path === '/styles.css' || req.path === '/robots.txt') return next();
  if (isAssistantPath(req.path)) {
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
