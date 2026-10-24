'use strict';
// Synthetic HTTP responses into the real Budget page and shared browser boot.
// This is browser presentation proof, not live provider or server admission proof.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const os = require('node:os'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { cases, dataFor } = require('./fixtures/source-check-status');
const root = path.join(__dirname, '..');
const output = process.env.ATLAS_STATUS_PROOF_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-source-check-'));
fs.mkdirSync(output, { recursive: true });
(async () => {
  const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    sourceSha256: Object.fromEntries(['public/app.js', 'public/budget-gface.css', 'test/browser-source-check-status.js',
      'test/fixtures/source-check-status.js'].map(file => [file,
      crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
    proof: 'Real Budget/shared boot; synthetic HTTP metadata and incumbent trust fixtures; no provider request, authentication or admission claim',
    states: [], failures: [], errors: [], externalRequests: [] };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  try {
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) for (const testCase of cases) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      page.on('pageerror', error => report.errors.push(error.message));
      await page.addInitScript(chosen => localStorage.setItem('hfd-theme', chosen), theme);
      const input = dataFor(testCase), before = JSON.stringify(input);
      let dataRequests = 0;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://status.test') { report.externalRequests.push(url.origin); return route.abort(); }
        assert.equal(route.request().method(), 'GET');
        if (url.pathname === '/data.json') { dataRequests++; return route.fulfill({ json: input, headers: testCase.headers }); }
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
      });
      await page.goto('http://status.test/');
      await page.waitForFunction(() => typeof App !== 'undefined' && App.data && !document.querySelector('[data-boot-notice]'));
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const status = page.locator('[data-observation-check]'), originalText = await status.textContent();
      const bell = page.locator('[data-transaction-review-open]');
      const dialog = page.locator('[data-budget-detail-sheet]');
      const requestsBefore = dataRequests;
      const facts = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
        headerInert: document.querySelector('.site-head').inert, theme: document.documentElement.dataset.theme,
        data: JSON.stringify(App.data) }));
      assert.equal(facts.data, before, 'status never changes the admitted financial data');
      assert.ok(await bell.isVisible());
      assert.ok(await page.locator('[data-manual-refresh]').isVisible());
      assert.equal(await status.isVisible(), false, 'source status is inside the closed review sheet');
      await bell.focus(); await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'visible' });
      assert.ok(await dialog.evaluate(element => element.open));
      assert.equal(await dialog.locator('[data-observation-check]').count(), 1);
      await status.scrollIntoViewIfNeeded();
      assert.ok(await status.isVisible());
      const text = await status.innerText();
      assert.equal(text, originalText, 'opening preserves original source, qualification and check date');
      for (const expected of testCase.includes) if (!text.includes(expected)) report.failures.push({ width, theme, state: testCase.name, expected, actual: text });
      if (testCase.headers['X-Atlas-Observation-Checked-At'] === '2038-06-06T18:00:00.000Z') {
        assert.ok(text.includes('Jun 6, 2038, 11:00 a.m. PT'), 'the original check time remains distinct from financial as-of');
      }
      assert.equal(facts.headerInert, false);
      assert.equal(facts.theme, theme);
      const box = await status.boundingBox();
      const dialogBox = await dialog.boundingBox();
      if (!box || !dialogBox || box.width <= 0 || box.height <= 0 || box.x < dialogBox.x
          || box.x + box.width > dialogBox.x + dialogBox.width + 1 || box.x < 0 || box.x + box.width > width + 1
          || await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) {
        report.failures.push({ width, theme, state: testCase.name, expected: 'Readable status inside the native dialog without overflow', box, dialogBox });
      }
      const screenshot = `${testCase.name}-${width}-${theme}.png`;
      await page.screenshot({ path: path.join(output, screenshot), fullPage: false });
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before, 'opening does not mutate financial data');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await status.isVisible(), false);
      assert.equal(await bell.getAttribute('aria-expanded'), 'false');
      assert.ok(await bell.evaluate(element => element === document.activeElement), 'closing restores bell focus');
      assert.equal(dataRequests, requestsBefore, 'review open/close makes no data request; all provider transport is synthetic');
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before, 'closing does not mutate financial data');
      assert.equal(await status.textContent(), originalText);
      report.states.push({ width, height: width === 390 ? 844 : 1000, theme, state: testCase.name,
        headers: testCase.headers, text, overflow: facts.overflow, screenshot,
        openCloseDataRequests: 0, financialDataUnchanged: true, focusRestored: true });
      await page.close();
    }
    assert.deepEqual(report.errors, []); assert.deepEqual(report.externalRequests, []);
  } finally {
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
  }
  console.log(JSON.stringify({ head: report.head, sourceSha256: report.sourceSha256, states: report.states.length, failures: report.failures.length, output }));
  assert.deepEqual(report.failures, [], 'source check and financial coverage must be distinct in every browser state');
  console.log('PASS source-check status browser: native review dialog at 320/390/1440, light/dark, seven source/coverage cases; original source/date, focus restoration, no open/close data requests, overflow, data mutation, browser errors or external requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
