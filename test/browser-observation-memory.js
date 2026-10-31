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
    let dataRequests = 0, sourceCheck;
    page.on('request', request => { if (new URL(request.url()).pathname === '/data.json') dataRequests++; });
    page.on('response', response => {
      if (new URL(response.url()).pathname !== '/data.json') return;
      sourceCheck = { source: response.headers()['x-atlas-observation-source'],
        qualified: response.headers()['x-atlas-observation-qualified'],
        checkedAt: response.headers()['x-atlas-observation-checked-at'] };
    });
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
    const providerStartDeadline = Date.now() + 5000;
    while (mock.calls.length === cancelCount && Date.now() < providerStartDeadline) await page.waitForTimeout(25);
    assert.ok(mock.calls.length > cancelCount, 'a real held provider GET starts before the cancellation proof');
    await notice.getByRole('button', { name: 'Cancel', exact: true }).click();
    await notice.getByText('Loading cancelled.', { exact: false }).waitFor();
    mock.release();
    await Promise.all([page.waitForEvent('domcontentloaded'), notice.getByRole('button', { name: 'Retry', exact: true }).click()]);
    await ready();
    const reviewStatus = [];
    for (const viewport of [{ name: 'desktop', width: 1280, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const status = page.locator('[data-observation-check]');
      const bell = page.locator('[data-transaction-review-open]');
      const dialog = page.locator('[data-budget-detail-sheet]');
      const originalText = await status.textContent();
      const originalData = await page.evaluate(() => JSON.stringify(App.data));
      const providerBefore = mock.calls.length, requestsBefore = dataRequests;
      const originalCheck = { ...sourceCheck };
      assert.deepEqual(originalCheck, { source: 'memory', qualified: 'true', checkedAt: CLOCK });
      assert.ok(await page.locator('[data-manual-refresh]').isVisible());
      assert.ok(await bell.isVisible());
      assert.equal(await status.isVisible(), false, 'source status belongs to the closed review sheet');
      await bell.focus(); await page.keyboard.press('Enter');
      await dialog.waitFor({ state: 'visible' });
      assert.ok(await dialog.evaluate(element => element.open));
      assert.equal(await dialog.locator('[data-observation-check]').count(), 1, 'the original status node moves into the dialog');
      await status.scrollIntoViewIfNeeded();
      assert.ok(await status.isVisible());
      assert.equal(await status.textContent(), originalText);
      assert.ok(originalText.startsWith('Using last successful check:'));
      assert.ok(originalText.includes('Aug 20, 2026, 11:00 a.m. PT'), 'opening does not redate the original observation');
      const box = await status.boundingBox();
      assert.ok(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.x + box.width <= viewport.width + 1);
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), originalData, 'opening is presentation only');
      await page.screenshot({ path: path.join(output, viewport.name + '-status.png'), fullPage: false });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(await status.isVisible(), false);
      assert.equal(await bell.getAttribute('aria-expanded'), 'false');
      assert.ok(await bell.evaluate(element => element === document.activeElement), 'closing returns focus to the bell');
      assert.equal(mock.calls.length, providerBefore, 'opening and closing make no provider request');
      assert.equal(dataRequests, requestsBefore, 'opening and closing do not reload financial data');
      assert.deepEqual(sourceCheck, originalCheck);
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), originalData, 'closing does not mutate financial data');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no horizontal overflow');
      await page.screenshot({ path: path.join(output, viewport.name + '.png'), fullPage: false });
      reviewStatus.push({ viewport, sourceCheck: originalCheck, text: originalText,
        providerGETs: 0, dataRequests: 0, financialDataUnchanged: true, focusRestored: true });
    }
    await context.clearCookies(); await page.locator('[data-manual-refresh]').click();
    await page.waitForURL(app.base + '/login');
    assert.deepEqual(errors, []);
    const receipt = { proof: 'synthetic authenticated server and actual browser boot; external assets blocked',
      checkDatesRetained: true, manualRefresh: true, failureWithholdsShell: true, forceRetry: true,
      cancellation: true, sessionExpiry: true, mobileOverflow: false, measurements: results, reviewStatus,
      limitation: 'local response and two-frame render measurements; no deployed or cold-start claim' };
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log('PASS browser observation memory ' + JSON.stringify(receipt));
    console.log('Synthetic proof directory: ' + output);
  } finally { mock.release(); await browser.close(); await app.close(); await mock.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
