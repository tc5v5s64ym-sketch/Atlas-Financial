'use strict';
// Actual App.boot and selected-period controls. Invented data; all network
// intercepted. No credentials, live accounts, writes or DOM financial stubs.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const fx = require('./fixtures/card-period-movements-data');
const root = path.join(__dirname, '..');
const out = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR || path.join(require('node:os').tmpdir(), 'card-period-movements');
fs.mkdirSync(out, { recursive: true });
const executionHead = cp.execFileSync('git', ['-c', 'safe.directory=' + root.replace(/\\/g, '/'), 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const states = [], errors = [], writes = [], external = [];
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const width of [1440, 390, 320]) for (const state of ['complete', 'opening-missing', 'truncated', 'pending-unknown', 'credit-ambiguous']) {
      const data = fx.served();
      if (state === 'opening-missing') delete data.liveOverlay.cardPeriodBalanceEvidence.cards[0].opening;
      if (state === 'truncated') data.liveOverlay.currentPeriodActuals.transactionCoverage = 'truncated';
      if (state === 'pending-unknown') data.liveOverlay.currentPeriodActuals.pendingCoverage = 'unknown';
      if (state === 'credit-ambiguous') delete data.liveOverlay.currentPeriodActuals.transactions.find(tx => tx.id === 'payment-a').kindHint;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
      page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://cards.test') { external.push(u.origin); return route.abort(); }
        if (route.request().method() !== 'GET') writes.push(route.request().method());
        if (u.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        return fs.existsSync(file) ? route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404, body: '' });
      });
      await page.goto('http://cards.test/');
      const strip = page.locator('[data-budget-card-movements]');
      await strip.waitFor();
      const travel = page.locator('[data-budget-card-toggle="travelvisa"]');
      assert.equal(await strip.getAttribute('data-card-period-start'), fx.START);
      assert.equal(await strip.getAttribute('data-card-period-end'), fx.END);
      assert.deepEqual(await strip.locator('[data-budget-card-toggle]').evaluateAll(rows => rows.map(row => row.getAttribute('data-budget-card-toggle'))), ['travelvisa', 'cashback', 'tdcc', 'triangle', 'mbna']);
      const netUnavailable = ['opening-missing', 'truncated'].includes(state);
      const contrastChecks = [];
      assert.match(await travel.innerText(), netUnavailable ? /Net unavailable/ : /↑ \$107\.40/);
      if (state !== 'truncated') {
        assert.match(await page.locator('[data-budget-card-toggle="cashback"]').innerText(), /↓ \$135\.80/);
        assert.match(await page.locator('[data-budget-card-toggle="tdcc"]').innerText(), /\$0\.00/);
      }
      assert.match(await page.locator('[data-budget-card-toggle="mbna"]').innerText(), /Amazon Mastercard[\s\S]*Net unavailable/);
      assert.match(await page.locator('[data-budget-card-toggle="mbna"]').innerText(), /Dated Aug 8/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no viewport overflow');
      if (width < 600) assert.equal(await strip.locator('.card-movement-track').evaluate(el => el.scrollWidth > el.clientWidth), true, 'five cards scroll within the track');
      const layout = await page.evaluate(() => {
        const strip = document.querySelector('[data-budget-card-movements]');
        const period = document.querySelector('.budget-surface-grid');
        const browse = document.querySelector('.budget-browse-grid');
        const billsClosing = document.querySelector('[data-bills-closing]');
        const style = getComputedStyle(strip);
        return { after: !period || !!(period.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING),
          before: !browse || !!(strip.compareDocumentPosition(browse) & Node.DOCUMENT_POSITION_FOLLOWING),
          billsClosingBefore: !billsClosing || !!(billsClosing.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING),
          border: style.borderTopWidth, background: style.backgroundColor };
      });
      assert.equal(layout.after, true); assert.equal(layout.before, true); assert.equal(layout.border, '0px');
      assert.equal(layout.billsClosingBefore, true, 'Bills-only primary metric retains its place above the card strip');
      assert.equal(layout.background, 'rgba(0, 0, 0, 0)', 'no large container background');
      await travel.focus(); await page.keyboard.press('Enter');
      const panel = page.locator('[data-budget-card-panel="travelvisa"]');
      await panel.waitFor();
      assert.equal(await strip.locator('[data-budget-card-panel]:not([hidden])').count(), 1);
      assert.equal(await panel.locator('[data-card-movement-transaction]').count(), 6);
      assert.match(await panel.innerText(), /Pending authorization[\s\S]*28\.60/);
      assert.match(await panel.innerText(), /purchase backfills do not automatically settle scheduled minimums/);
      assert.equal(await panel.locator('[data-card-movement-transaction="cash-leg-a"]').count(), 0, 'paired cash leg not double-counted');
      assert.match(await panel.locator('[data-card-movement-transaction="payment-a"]').innerText(), state === 'credit-ambiguous' ? /Credit · type unconfirmed/ : /household purpose unconfirmed/);
      if (state === 'complete') {
        assert.match(await panel.innerText(), /\$820\.00[\s\S]*\$927\.40/);
        for (const theme of ['light', 'dark']) {
          await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
          await strip.locator('.card-movement-trigger').evaluateAll(rows => Promise.all(rows.flatMap(row => row.getAnimations()).map(animation => animation.finished.catch(() => {}))));
          const contrast = await strip.locator('.card-movement-trigger .card-movement-delta:is(.is-up,.is-down)').evaluateAll(rows => {
            const luminance = color => {
              const scale = color.startsWith('color(srgb') ? 1 : 255;
              const values = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
                const channel = value / scale; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
              return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
            };
            return rows.map(row => {
              const foreground = luminance(getComputedStyle(row).color);
              const background = luminance(getComputedStyle(row.closest('button')).backgroundColor);
              return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
            });
          });
          assert.ok(contrast.every(ratio => ratio >= 4.5), `${theme} red/green text contrast: ${contrast}`);
          contrastChecks.push({ theme, ratios: contrast });
        }
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        await page.evaluate(() => App.rerender());
        assert.equal(await panel.isVisible(), true, 'rerender retains open identity with fresh publication');
        assert.equal(await travel.evaluate(el => el === document.activeElement), true, 'exact card trigger restored after rerender');
        await page.setViewportSize({ width: width === 1440 ? 390 : 1440, height: 1000 });
        assert.equal(await panel.isVisible(), true); assert.match(await travel.innerText(), /107\.40/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.setViewportSize({ width, height: 1000 });
      }
      await page.keyboard.press('Escape');
      assert.equal(await panel.isVisible(), false); assert.equal(await travel.evaluate(el => el === document.activeElement), true);
      const amazon = page.locator('[data-budget-card-toggle="mbna"]');
      await amazon.click();
      const amazonPanel = page.locator('[data-budget-card-panel="mbna"]');
      assert.match(await amazonPanel.innerText(), /Aug 8[\s\S]*Manual statement observation/);
      await travel.click();
      assert.equal(await amazonPanel.isVisible(), false); assert.equal(await strip.locator('[data-budget-card-panel]:not([hidden])').count(), 1);
      await panel.locator('[data-budget-card-close]').click();
      assert.equal(await panel.isVisible(), false); assert.equal(await travel.evaluate(el => el === document.activeElement), true);
      if (state === 'complete') {
        await page.locator('[data-budget-window-step="1"]').click();
        assert.equal(await strip.getAttribute('data-card-period-start'), '2026-08-28');
        assert.match(await travel.innerText(), /Net unavailable/);
        await travel.click(); assert.match(await panel.innerText(), /Future period not observed/);
        assert.equal(await panel.locator('[data-card-movement-transaction]').count(), 0, 'future never borrows current ledger');
        await page.locator('[data-budget-window-step="-1"]').click();
        assert.equal(await strip.getAttribute('data-card-period-start'), fx.START);
        assert.equal(await strip.locator('[data-budget-card-panel]:not([hidden])').count(), 0, 'range change closes previous detail');
        await page.locator('[aria-label="Budget planning granularity"] [data-budget-granularity="month"]').click();
        assert.equal(await strip.count(), 0, 'no manufactured calendar-month net');
        await page.locator('[aria-label="Budget planning granularity"] [data-budget-granularity="pay-period"]').click();
        if (await page.locator('[data-budget-drilldown-exit]').count()) await page.locator('[data-budget-drilldown-exit]').click();
        assert.match(await travel.innerText(), /107\.40/);
      }
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
      await strip.screenshot({ path: path.join(out, `${state}-${width}.png`), animations: 'disabled' });
      await travel.click();
      await strip.screenshot({ path: path.join(out, `${state}-open-${width}.png`), animations: 'disabled' });
      states.push({ width, state, layout, contrastChecks, synthetic: true });
      await page.close(); console.log(`PASS ${width}px ${state}: native App.boot, exact period, all five cards, qualification and keyboard behavior`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(external, []);
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true, executionHead,
      browserSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'), states, errors, writes, external }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
