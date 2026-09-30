'use strict';
// Exercise the authenticated HTML actually served by Atlas. No provider access.
const assert = require('assert/strict');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const PASSWORD = 'synthetic-build-test-password';
const SECRET = 'synthetic-build-test-session-secret';

async function start(metadata) {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, PORT: String(port), SITE_PASSWORD: PASSWORD,
      SESSION_SECRET: SECRET, ATLAS_LIVE_OVERLAY: 'off', ...metadata },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Server startup timed out')); }, 10000);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('listening')) { clearTimeout(timer); resolve(); }
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
  });
  return { child, base: `http://127.0.0.1:${port}` };
}

async function main() {
  let previousEtag = 'W/"previous-deployment"';
  let previousHtml;
  const cases = [
    [{ RENDER_GIT_COMMIT: 'abcdef01'.repeat(5), ATLAS_GIT_SHA: '1111111' }, 'Running commit abcdef0'],
    [{ RENDER_GIT_COMMIT: '12345678'.repeat(5) }, 'Running commit 1234567'],
    [{ ATLAS_GIT_SHA: '7654321' }, 'Running commit 7654321'],
    [{}, 'Running build unavailable'],
    [{ RENDER_GIT_COMMIT: '<script>unsafe</script>', ATLAS_GIT_SHA: '7654321' }, 'Running build unavailable'],
  ];
  for (const [metadata, expected] of cases) {
    const { child, base } = await start(metadata);
    try {
      assert.equal((await fetch(base + '/', { redirect: 'manual' })).status, 302);
      assert.equal((await fetch(base + '/index.html', { redirect: 'manual' })).status, 302);
      const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: PASSWORD }) });
      assert.equal(login.status, 302);
      const cookie = login.headers.get('set-cookie').split(';')[0];
      for (const route of ['/', '/index.html']) {
        const response = await fetch(base + route, { headers: { cookie,
          ...(previousEtag ? { 'if-none-match': previousEtag } : {}) } });
        assert.equal(response.status, 200, 'An old build validator must not hide a new build');
        assert.match(response.headers.get('cache-control'), /no-store/);
        assert.equal(response.headers.get('etag'), null, 'Build HTML does not reuse cache validators');
        const html = await response.text();
        assert.equal(html.match(/<p class="running-build"[^>]*>([^<]+)<\/p>/)[1], expected);
        assert.ok(html.indexOf('class="running-build"') < html.indexOf('id="operating-surface"'));
        assert.ok(html.includes('A reliable PR mapping is unavailable'));
        assert.ok(!html.includes(PASSWORD) && !html.includes(SECRET) && !html.includes('<script>unsafe'));
        assert.ok(!/Running PR/.test(html), 'No inferred/latest PR number');
        if (route === '/') {
          if (!previousHtml) previousHtml = html;
        }
      }
      assert.ok(previousHtml.includes('Running commit abcdef0'), 'Previously loaded HTML keeps its own build');
      const css = await fetch(base + '/running-build.css', { headers: { cookie } });
      assert.equal(css.status, 200);
      assert.match(css.headers.get('cache-control'), /no-store/);
      console.log(`PASS authenticated Budget routes: ${expected}`);
    } finally {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await stopped;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
