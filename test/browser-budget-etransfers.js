'use strict';
// Outgoing e-transfer review list — browser proof on the actual post-boot
// DOM, after budget-blend.js has run. Fixtures are the invented Budget
// surface household (test/fixtures/budget-surface-data) plus one invented
// SEND E-TFR provider row; every request is intercepted, no server or
// credentials are used. States: complete / posted-only /
// incomplete-observed (legacy-missing transactionCoverage) /
// incomplete-truncated / stale / plan-unavailable.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'),
  cp = require('node:child_process'), crypto = require('node:crypto');
const { chromium } = require('playwright'), fx = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..'),
  out = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR || path.join(require('node:os').tmpdir(), 'budget-etransfers');
fs.mkdirSync(out, { recursive: true });
const executionHead = cp.execFileSync('git', ['-c', 'safe.directory=' + root.replace(/\\/g, '/'), 'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const CHROME_152 = path.join(root, '..', 'atlas-timeline-verify', 'chrome-linux64', 'chrome');
const journeys = [];

function servedFor(state) {
  if (state === 'unavailable') return fx.served({ unavailablePlan: true });
  const data = fx.served({ etransfer: true });
  const packet = data.liveOverlay.currentPeriodActuals;
  if (state === 'posted-only') packet.pendingCoverage = 'unknown';
  if (state === 'incomplete-observed') delete packet.transactionCoverage;
  if (state === 'incomplete-truncated') packet.transactionCoverage = 'truncated';
  if (state === 'stale') packet.coverageThrough = '2026-08-19';
  return data;
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || (fs.existsSync(CHROME_152) ? CHROME_152 : undefined),
    headless: true,
  });
  const errors = [], external = [], writes = [];
  try {
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark'])
      for (const state of ['complete', 'posted-only', 'incomplete-observed', 'incomplete-truncated', 'stale', 'unavailable']) {
        const servedData = servedFor(state);
        const page = await browser.newPage({
          viewport: { width, height: 1000 }, isMobile: width < 400, hasTouch: width < 400,
          colorScheme: theme, reducedMotion: 'reduce',
        });
        page.setDefaultTimeout(15000);
        page.on('pageerror', e => errors.push(`${width}/${theme}/${state}: ${e.message}`));
        await page.addInitScript(chosen => {
          try { localStorage.setItem('hfd-theme', chosen); } catch (e) {}
        }, theme);
        await page.route('**/*', route => {
          const u = new URL(route.request().url());
          if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
          if (route.request().method() !== 'GET') writes.push(route.request().method());
          if (u.pathname === '/data.json') return route.fulfill({ json: servedData });
          if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
          const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
          if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
        });
        await page.goto('http://budget.test/');
        await page.locator('[data-budget-surface]').waitFor();
        // Post-blend visibility: blend runs during boot/render; wait for two
        // frames so any relocation has settled before measuring.
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        });
        const section = page.locator('[data-budget-browse="e-transfers"]');
        assert.equal(await section.count(), 1, `${state}: exactly one e-transfer section in the post-boot DOM`);
        await section.scrollIntoViewIfNeeded();
        const box = await section.boundingBox();
        assert.ok(box && box.width > 0 && box.height > 0, `${state}: section is actually visible post-blend (real bounding box)`);
        assert.equal(await section.isVisible(), true, `${state}: section isVisible post-blend`);
        const text = await section.innerText();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
          `${state}: no horizontal overflow at ${width}px`);
        assert.doesNotMatch(await page.evaluate(() => document.body.innerText), /SEND E-TFR|Synthetic recipient/,
          `${state}: no descriptor or payee text anywhere on the page`);
        const items = section.locator('[data-etransfer-item]');
        if (state === 'complete') {
          assert.equal(await section.getAttribute('data-etransfer-state'), 'available-complete');
          assert.equal(await items.count(), 1, 'complete: the one flagged row is listed');
          assert.match(text, /Outgoing e-transfer/); assert.match(text, /\$75\.00/);
          assert.match(text, /chequing-b/); assert.match(text, /Aug 19/);
          assert.match(text, /1 outgoing e-transfer observed this period/);
        } else if (state === 'posted-only') {
          assert.equal(await section.getAttribute('data-etransfer-state'), 'available-posted-only');
          assert.equal(await items.count(), 1, 'posted-only: observed items still shown');
          assert.match(text, /Pending coverage is incomplete/);
          assert.match(text, /\$75\.00/);
        } else if (state === 'incomplete-observed') {
          assert.equal(await section.getAttribute('data-etransfer-state'), 'available-incomplete');
          assert.equal(await items.count(), 1, 'incomplete-observed: collected items still shown');
          assert.match(text, /observed subset/); assert.match(text, /may be missing items/);
        } else if (state === 'incomplete-truncated') {
          assert.equal(await section.getAttribute('data-etransfer-state'), 'available-incomplete');
          assert.equal(await items.count(), 0, 'truncated: nothing collected, no list');
          assert.match(text, /may be missing items/); assert.doesNotMatch(text, /\$/);
        } else if (state === 'stale') {
          assert.equal(await section.getAttribute('data-etransfer-state'), 'unavailable-stale');
          assert.equal(await items.count(), 0, 'stale: no list resurrected as current fact');
          assert.match(text, /can't be confirmed/); assert.doesNotMatch(text, /\$/);
        } else {
          assert.equal(await page.locator('[data-budget-surface]').getAttribute('data-budget-surface'), 'unavailable',
            'unavailable: the plan-unavailable surface is the one rendered');
          assert.match(await section.getAttribute('data-etransfer-state'), /^unavailable-/);
          assert.equal(await items.count(), 0, 'unavailable: notice only, no items');
          assert.match(text, /can't be confirmed/); assert.doesNotMatch(text, /\$/);
        }
        await page.screenshot({ path: path.join(out, `${state}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
        journeys.push({ width, theme, state, sectionState: await section.getAttribute('data-etransfer-state'), items: await items.count() });
        await page.close();
        console.log(`PASS ${width}px ${theme} ${state}: post-blend visibility, whitelist fields, truthful state consequence, no overflow`);
      }
    // Navigation journey (current -> future -> current -> past -> current,
    // then month and back) on the complete state: the section belongs to
    // the current pay period only and must not leak across views.
    {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(`navigation: ${e.message}`));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
        if (u.pathname === '/data.json') return route.fulfill({ json: servedFor('complete') });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      });
      await page.goto('http://budget.test/');
      await page.locator('[data-budget-surface]').waitFor();
      const section = page.locator('[data-budget-browse="e-transfers"]');
      assert.equal(await section.count(), 1, 'navigation: section present on the current period');
      const selected = () => page.locator('[data-pay-period-swipe]').getAttribute('data-selected-pay-period');
      const current = await selected();
      // Post-blend, the native window header is retained hidden and the
      // river slider is the period control; drive it by keyboard, the
      // river's own documented interaction.
      const stepRiver = async (key, fromSel) => {
        await page.locator('.g-river-wrap .river').focus();
        await page.keyboard.press(key);
        await page.waitForFunction(
          sel => document.querySelector('[data-pay-period-swipe]')?.getAttribute('data-selected-pay-period') !== sel,
          fromSel, { timeout: 10000 });
        await page.waitForTimeout(300);
        return selected();
      };
      const future = await stepRiver('ArrowRight', current);
      assert.equal(await section.count(), 0, 'navigation: future period shows no e-transfer section');
      await stepRiver('ArrowLeft', future);
      assert.equal(await selected(), current);
      assert.equal(await section.count(), 1, 'navigation: returning to current restores the section');
      const past = await stepRiver('ArrowLeft', current);
      assert.equal(await section.count(), 0, 'navigation: past period shows no e-transfer section');
      await stepRiver('ArrowRight', past);
      assert.equal(await selected(), current);
      assert.equal(await section.count(), 1, 'navigation: back to current again restores the section');
      // Month view: the granularity toggle lives in the figures sheet
      // post-blend (the result tile is its visible opener).
      await page.locator('[data-operating-question="07"] .budget-step-summary').first().click();
      await page.waitForFunction(() => document.querySelector('[data-budget-detail-sheet]')?.open);
      await page.locator('[data-budget-detail-sheet] [data-budget-granularity="month"]').click();
      await page.locator('[data-budget-month-view]').waitFor();
      assert.equal(await section.count(), 0, 'navigation: month view shows no e-transfer section');
      await page.locator('[data-budget-granularity="pay-period"]').first().click();
      await page.locator('[data-budget-drilldown-exit]').click();
      await page.locator('[data-pay-period-swipe]').waitFor();
      assert.equal(await selected(), current, 'navigation: drilldown exit returns to the current period');
      assert.equal(await section.count(), 1, 'navigation: returning from month restores the section on the current period');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'navigation: no overflow after the journey');
      await page.screenshot({ path: path.join(out, 'navigation-1440-light.png'), fullPage: true, animations: 'disabled' });
      journeys.push({ journey: 'current/future/past/month navigation', sectionRestored: true });
      await page.close();
      console.log('PASS navigation journey: current-only section across future/past/month navigation and back');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
    fs.writeFileSync(path.join(out, 'etransfer-proof.json'), JSON.stringify({
      synthetic: true, executionHead,
      browserCompanionSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
      journeys,
    }, null, 2) + '\n');
    console.log('PASS browser proof: 36 state × theme × width views + navigation journey, post-blend visibility and field whitelist hold');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
