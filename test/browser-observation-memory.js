'use strict';
// Actual synthetic authenticated server + shared browser boot. All figures are
// invented fixtures. Response time and two-frame rendering time are separate;
// these local measurements make no deployed/cold-start performance claim.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { provider, atlas, CLOCK } = require('./test-server-observation-memory');
const output = process.env.ATLAS_OBSERVATION_PROOF_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-observation-browser-'));
fs.mkdirSync(output, { recursive: true });
(async () => {
  const mock = await provider(), app = await atlas(mock);
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH,
    args: ['--disable-gpu'], });
  const results = [], errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', route => new URL(route.request().url()).origin === app.base ? route.continue() : route.abort());
    const separator = app.cookie.indexOf('=');
    await context.addCookies([{ name: app.cookie.slice(0, separator), value: app.cookie.slice(separator + 1), url: app.base }]);
    await context.addInitScript(() => {
      window.__syntheticRenderCycles = []; let seen = false, pending = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-boot-notice]')) { seen = true; return; }
        if (!seen || pending) return; seen = false; pending = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const response = performance.getEntriesByType('resource')
            .filter(entry => new URL(entry.name).pathname === '/data.json').at(-1);
          window.__syntheticRenderCycles.push({ responseMs: response?.duration,
            responseEnd: response?.responseEnd, renderComplete: performance.now(),
            renderAfterResponseMs: performance.now() - response?.responseEnd }); pending = false;
        }));
      }).observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => window.__syntheticRenderCycles.length > 0 && !document.querySelector('[data-boot-notice]'));
    for (const phase of ['first', 'warm']) {
      const before = mock.calls.length;
      await page.goto(app.base + '/', { waitUntil: 'domcontentloaded' }); await ready();
      const timing = await page.evaluate(() => window.__syntheticRenderCycles.at(-1));
      assert.equal(mock.calls.length - before, phase === 'first' ? 7 : 0);
      assert.ok(Number.isFinite(timing.responseMs) && Number.isFinite(timing.renderAfterResponseMs));
      assert.equal(await page.evaluate(() => App.data.liveOverlay.fetchedAt), CLOCK);
      const status = await page.locator('[data-observation-check]').textContent();
      assert.ok(status.startsWith(phase === 'warm' ? 'Using last successful check:' : 'Provider checked:'));
      assert.ok(!await page.locator('.site-head').evaluate(element => element.inert));
      results.push({ phase, providerGETs: mock.calls.length - before,
        responseMs: Math.round(timing.responseMs * 100) / 100,
        renderAfterResponseMs: Math.round(timing.renderAfterResponseMs * 100) / 100 });
    }
    const forceCount = mock.calls.length;
    await Promise.all([page.waitForEvent('domcontentloaded'), page.locator('[data-manual-refresh]').click()]);
    await ready();
    assert.equal(mock.calls.length - forceCount, 7);
    assert.ok((await page.locator('[data-observation-check]').textContent()).startsWith('Using last successful check:'));
    mock.mode('failure'); await page.locator('[data-manual-refresh]').click();
    const notice = page.locator('[data-boot-notice]');
    await notice.getByText('Provider refresh failed.', { exact: false }).waitFor();
    assert.ok(await page.locator('.site-head').evaluate(element => element.inert));
    assert.ok(await page.locator('.site-head').evaluate(element => element.getAttribute('aria-hidden') === 'true'));
    assert.equal(await page.locator('[data-observation-check]').textContent(), 'Provider refresh failed');
    mock.mode('ok'); const retryCount = mock.calls.length;
    await Promise.all([page.waitForEvent('domcontentloaded'), notice.getByRole('button', { name: 'Retry', exact: true }).click()]);
    await ready(); assert.equal(mock.calls.length - retryCount, 7);
    assert.ok(!await page.locator('.site-head').evaluate(element => element.inert));
    mock.hold(); const cancelCount = mock.calls.length;
    await page.locator('[data-manual-refresh]').click();
    await page.waitForTimeout(100); assert.ok(mock.calls.length > cancelCount);
    await notice.getByRole('button', { name: 'Cancel', exact: true }).click();
    await notice.getByText('Loading cancelled.', { exact: false }).waitFor();
    mock.release();
    await Promise.all([page.waitForEvent('domcontentloaded'), notice.getByRole('button', { name: 'Retry', exact: true }).click()]);
    await ready();
    await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('[data-manual-refresh]').isVisible());
    assert.ok(await page.locator('[data-observation-check]').isVisible());
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: false });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile has no horizontal overflow');
    await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: false });
    await context.clearCookies(); await page.locator('[data-manual-refresh]').click();
    await page.waitForURL(app.base + '/login');
    assert.deepEqual(errors, []);
    const receipt = { proof: 'synthetic authenticated server and actual browser boot; external assets blocked',
      checkDatesRetained: true, manualRefresh: true, failureWithholdsShell: true, forceRetry: true,
      cancellation: true, sessionExpiry: true, mobileOverflow: false, measurements: results,
      limitation: 'local response and two-frame render measurements; no deployed or cold-start claim' };
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log('PASS browser observation memory ' + JSON.stringify(receipt));
    console.log('Synthetic proof directory: ' + output);
  } finally { mock.release(); await browser.close(); await app.close(); await mock.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
