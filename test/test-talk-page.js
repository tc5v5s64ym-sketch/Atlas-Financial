'use strict';
/* Talk to Atlas — household conversation shell.
 *
 * Proves the authenticated UI surface exists, sits first-class on the
 * household dock, publishes no figure, and does not call a model.
 * `node test/test-talk-page.js`
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const vm = require('vm');
const { spawn } = require('child_process');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const PROMPTS = [
  'What should I know today?',
  'Can we afford this?',
  'What should we do about our debt?',
  'What commitments are coming up?',
];

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function siteNav(html) {
  const match = /<nav class="sitenav(?: [^"]*)?" aria-label="Pages">([\s\S]*?)<\/nav>/.exec(html);
  if (!match) return null;
  return [...match[1].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map(m => {
    const labelled = /class="sitenav-label"[^>]*>([^<]+)</.exec(m[3]);
    return {
      href: m[1],
      current: /aria-current="page"/.test(m[2]),
      label: (labelled ? labelled[1] : m[3]).replace(/<[^>]+>/g, '').trim(),
    };
  });
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

console.log('=== 1. Talk page identity, empty state, composer, prompts ===');
{
  const html = read('public/talk.html');
  const css = read('public/talk.css');
  ok(/<title>Household finances — talk<\/title>/.test(html)
      && /<h1>Talk to Atlas<\/h1>/.test(html)
      && /data-page-shell="talk"/.test(html)
      && /class="talk-page"/.test(html),
    'the page is the Talk to Atlas household surface');
  ok(/<link rel="stylesheet" href="\/talk.css">/.test(html)
      && /<link rel="stylesheet" href="\/nav-glass.css">/.test(html)
      && /<link rel="stylesheet" href="\/styles.css">/.test(html),
    'Talk loads styles, nav-glass and its own stylesheet');
  ok(/id="talk-empty"/.test(html) && /id="talk-composer"/.test(html)
      && /id="talk-input"/.test(html) && /id="talk-send"/.test(html)
      && /id="talk-seam"/.test(html) && /id="talk-cards"/.test(html)
      && /id="talk-thread"/.test(html) && /id="talk-prompts"/.test(html),
    'empty state, thread, reserved cards mount, composer and seam are present');
  ok(/disabled/.test(html) && /Coming soon/.test(html)
      && /not a second planner/.test(html),
    'Send is disabled in markup and the coming-soon seam is visible');
  for (const prompt of PROMPTS) {
    ok(html.includes(`data-talk-prompt="${prompt}"`) && html.includes(prompt),
      `static prompt is present: ${prompt}`);
  }
  ok(!/\$\d|\d\.\d\d\b|%/.test(html.replace(/<meta[^>]*>/g, '')),
    'talk.html hardcodes no dollar figure or rate');
  ok(/talk-empty/.test(css) && /talk-composer/.test(css)
      && /talk-prompt/.test(css) && /talk-bubble/.test(css),
    'talk.css styles the empty state, composer, prompts and future bubbles');
}

console.log('\n=== 2. talk.js is a shell — no model, no Forecast, no figures ===');
{
  const src = stripComments(read('public/talk.js'));
  const html = read('public/talk.html');
  ok(/App\.boot\(\)/.test(src) && /INTELLIGENCE SEAM/.test(read('public/talk.js')),
    'talk.js boots the shared header and names the intelligence seam');
  ok(!/Forecast|recommend\(|money2\(|money\(/.test(src),
    'talk.js does not call Forecast or format money');
  ok(!/fetch\(|XMLHttpRequest|WebSocket|EventSource/.test(src),
    'talk.js opens no network of its own');
  ok(!/assistant\/current|assistant\/mcp|openai|anthropic|chatgpt|llm|ATLAS_ASSISTANT/i.test(src + html),
    'Talk does not call the assistant packet, MCP, or a model host');
  ok(/send\.disabled = true/.test(src) && /preventDefault/.test(src),
    'Send stays disabled and submit is swallowed');
  ok(/talk-cards/.test(html) && /hidden/.test(html),
    'structured answer cards have a reserved hidden mount');
  try {
    new vm.Script(read('public/talk.js'), { filename: 'talk.js' });
    ok(true, 'talk.js compiles');
  } catch (err) {
    ok(false, 'talk.js compiles', err.message);
  }
}

console.log('\n=== 3. Talk is first-class on every household dock ===');
{
  const expected = JSON.stringify([
    ['/', 'Budget'],
    ['/bills.html', 'Bills'],
    ['/subscriptions.html', 'Subscriptions'],
    ['/credit.html', 'Credit'],
    ['/planning.html', 'Planning'],
    ['/talk.html', 'Talk'],
  ]);
  for (const file of [
    'public/index.html',
    'public/bills.html',
    'public/subscriptions.html',
    'public/credit.html',
    'public/planning.html',
    'public/talk.html',
  ]) {
    const nav = siteNav(read(file));
    ok(nav && JSON.stringify(nav.map(l => [l.href, l.label])) === expected,
      `${file} dock reads Budget | Bills | Subscriptions | Credit | Planning | Talk`);
  }
}

console.log('\n=== 4. the Talk shell is gated by the incumbent session ===');
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
(async () => {
  const port = await freePort();
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/^(ATLAS_|LUNCHMONEY_)/.test(key)) delete env[key];
  }
  Object.assign(env, { SITE_PASSWORD: PASS, SESSION_SECRET: SECRET, PORT: String(port) });
  const atlas = await startAtlas(env);
  const base = `http://127.0.0.1:${port}`;
  try {
    const anon = await fetch(base + '/talk.html', { redirect: 'manual' });
    ok(anon.status === 302 && /\/login$/.test(anon.headers.get('location') || ''),
      '/talk.html without a session redirects to /login');
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(PASS)}`,
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    ok(login.status === 302 && /^hfd_session=/.test(cookie), 'synthetic login issues a session');
    const page = await fetch(base + '/talk.html', { headers: { cookie } });
    const body = await page.text();
    const nav = siteNav(body);
    ok(page.status === 200 && /<h1>Talk to Atlas<\/h1>/.test(body)
        && nav && nav.find(l => l.current).label === 'Talk',
      '/talk.html serves 200 with Talk current');
    ok(/no-store/.test(page.headers.get('cache-control') || '')
        && /script-src 'self'/.test(page.headers.get('content-security-policy') || ''),
      '/talk.html carries the incumbent no-store and CSP headers');
    const script = await fetch(base + '/talk.js', { headers: { cookie } });
    ok(script.status === 200, '/talk.js is served to a session');
  } finally {
    await atlas.stop();
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
