'use strict';
// Full native Budget/App/Forecast path, invented bills only. Optional browser
// proof: NODE_PATH=<playwright> CHROME_PATH=<Chromium> node test/browser-bills-usability.js
// After committing, BILLS_SOURCE_BOUND=1 requires exact Git bytes and a clean
// checkout. Screenshots stay outside Git unless deliberately added as proof.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const fx = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..');
const output = process.env.BILLS_PROOF_DIR || path.join(require('node:os').tmpdir(), 'atlas-bills-usability');
fs.mkdirSync(output, { recursive: true });
const sourceBound = process.env.BILLS_SOURCE_BOUND === '1';
const git = args => execFileSync('git', args, { cwd: root, maxBuffer: 16 * 1024 * 1024 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBinding = { head: git(['rev-parse', 'HEAD']).toString().trim(),
  tree: git(['rev-parse', 'HEAD^{tree}']).toString().trim(), files: {} };
if (sourceBound) assert.equal(git(['status', '--porcelain']).toString().trim(), '', 'Source-bound proof starts clean');
function fixture() {
  const data = fx.served();
  for (let i = 0; i < 3; i++) data.plan.bills.push({ id: `synthetic-extra-${i}`, label: `Synthetic service ${i + 1}`,
    frequency: 'monthly', day: 24, amount: 20 + i, confidence: i === 1 ? 'estimated' : 'confirmed', payingAccount: 'chequing-a' });
  for (let i = 0; i < 7; i++) data.plan.bills.push({ id: `synthetic-roster-${i}`, label: `Synthetic household bill ${i + 1}`,
    frequency: 'monthly', day: 26, amount: 10 + i, confidence: 'confirmed', payingAccount: 'chequing-a' });
  return data;
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [], writes = [], measurements = [], shots = [];
  try {
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme,
        reducedMotion: 'reduce', hasTouch: width < 400, isMobile: width < 400 });
      await context.addInitScript(chosen => localStorage.setItem('hfd-theme', chosen), theme);
      const data = fixture();
      await context.route('**/*', route => {
        if (route.request().method() !== 'GET') writes.push(route.request().method());
        const url = new URL(route.request().url());
        if (url.origin !== 'http://bills.test') return route.abort();
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const bytes = fs.readFileSync(file), relative = path.relative(root, file).split(path.sep).join('/');
        const bound = { sha256: sha(bytes), bytes: bytes.length };
        if (sourceBound) {
          bound.blob = git(['rev-parse', 'HEAD:' + relative]).toString().trim();
          assert.equal(sha(git(['cat-file', 'blob', bound.blob])), bound.sha256, relative + ' is exact Git bytes');
        }
        assert.ok(!sourceBinding.files[relative] || sourceBinding.files[relative].sha256 === bound.sha256);
        sourceBinding.files[relative] = bound;
        return route.fulfill({ body: bytes, contentType: file.endsWith('.js') ? 'application/javascript'
          : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html' });
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(`${width}/${theme}: ${error.message}`));
      const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const sheet = () => page.locator('[data-budget-detail-sheet][open]');
      const close = async opener => {
        await page.locator('[data-budget-detail-close]').click(); await settle();
        assert.equal(await sheet().count(), 0);
        assert.equal(await opener.evaluate(el => document.activeElement === el), true, 'Close restores the visible opener');
        assert.equal(await opener.getAttribute('aria-expanded'), 'false');
      };
      const day = date => page.locator(`[data-blend-bill="day:${date}"]`);
      const visibleRows = () => sheet().locator('.budget-bill-row:visible');
      const takeShot = async name => {
        await settle(); const file = `${width}-${theme}-${name}.png`;
        await page.screenshot({ path: path.join(output, file) }); shots.push(file);
      };
      await page.goto('http://bills.test'); await page.locator('[data-blend-cal]').waitFor(); await settle();
      const originalData = await page.evaluate(() => JSON.stringify(App.data));
      const period = () => page.locator('[data-budget-window-progress]').getAttribute('data-start');
      const originalPeriod = await period();
      const four = day('2026-08-24');
      assert.equal(await four.locator('..').locator('.blend-day-more').innerText(), '+3');
      assert.ok((await four.boundingBox()).height >= 44, 'full-square hit target');
      // Empty days remain inert; no invented bill or second dialog.
      const empty = page.locator('.blend-day').filter({ has: page.locator('.blend-day-n', { hasText: /^20$/ }) });
      await empty.click(); assert.equal(await sheet().count(), 0); assert.equal(await empty.locator('button').count(), 0);
      // Every square area invokes one native day list, with each occurrence once.
      for (const area of ['background', 'logo', 'count']) {
        await four.scrollIntoViewIfNeeded();
        if (area === 'background') await four.click({ position: { x: 8, y: 28 } });
        if (area === 'logo') await four.locator('svg').click();
        if (area === 'count') {
          const box = await four.locator('..').locator('.blend-day-more').boundingBox();
          if (width < 400) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
          else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        assert.equal(await page.locator('dialog[open]').count(), 1, 'one native modal owns list and details');
        await four.evaluate(el => { el.click(); el.click(); });
        assert.equal(await page.evaluate(() => document.querySelector('[data-budget-detail-sheet]').budgetSheet.snapshot().frames.length), 1);
        assert.equal(await visibleRows().count(), 4);
        assert.deepEqual(await visibleRows().evaluateAll(rows => rows.map(r => r.dataset.budgetBillOpen).sort()),
          ['internet', 'synthetic-extra-0', 'synthetic-extra-1', 'synthetic-extra-2']);
        assert.equal(await sheet().locator('[data-budget-bill-day]').getAttribute('data-budget-bill-day'), '2026-08-24');
        assert.doesNotMatch(await sheet().innerText(), /Hydro|Mortgage/, 'the day list includes no other-day attention badge');
        assert.equal(await period(), originalPeriod);
        await close(four);
      }
      await four.focus(); await page.keyboard.press('Enter'); assert.equal(await visibleRows().count(), 4);
      await takeShot('four-bill-day');
      for (const id of ['internet', 'synthetic-extra-0', 'synthetic-extra-1', 'synthetic-extra-2']) {
        const row = sheet().locator(`[data-budget-bill-open="${id}"]`);
        const printed = await row.locator('strong').innerText();
        await row.focus(); await page.keyboard.press(id === 'internet' ? 'Space' : 'Enter');
        const detail = sheet().locator('[data-bill-detail]');
        assert.equal(await detail.count(), 1);
        assert.equal(await detail.locator('summary').first().getAttribute('data-period-bill'), id);
        assert.equal(await detail.locator('summary').first().getAttribute('data-bill-date'), '2026-08-24');
        assert.match(await page.locator('[data-budget-detail-title]').innerText(), new RegExp(printed));
        assert.match(await detail.innerText(), /Transaction evidence is unavailable.*Missing evidence does not mean unpaid/s);
        assert.equal(await page.evaluate(() => document.querySelector('[data-budget-detail-sheet]').budgetSheet.snapshot().frames.length), 2);
        // Duplicate dispatched clicks cannot replace/stack the already-held detail.
        await row.evaluate(el => { el.click(); el.click(); });
        assert.equal(await page.evaluate(() => document.querySelector('[data-budget-detail-sheet]').budgetSheet.snapshot().frames.length), 2);
        assert.equal(await page.locator('dialog[open]').count(), 1);
        await page.locator('[data-budget-detail-back]').click();
        assert.equal(await visibleRows().count(), 4);
        assert.equal(await row.evaluate(el => document.activeElement === el), true, 'Back returns focus to its bill');
      }
      // Same-period remount retains day, detail identity, Back and final opener.
      await page.evaluate(() => App.rerender()); await settle(); assert.equal(await visibleRows().count(), 4);
      await sheet().locator('[data-budget-bill-open="synthetic-extra-2"]').click();
      await page.evaluate(() => App.rerender()); await settle();
      assert.equal(await sheet().locator('[data-period-bill]').getAttribute('data-period-bill'), 'synthetic-extra-2');
      await page.locator('[data-budget-detail-back]').click(); assert.equal(await visibleRows().count(), 4);
      await close(four);
      await four.focus(); await page.keyboard.press('Space'); assert.equal(await visibleRows().count(), 4);
      await page.keyboard.press('Escape'); await settle(); assert.equal(await four.evaluate(el => document.activeElement === el), true);
      // One-bill paid and uncertain days open the exact incumbent evidence.
      for (const [id, date, status] of [['mortgage', '2026-08-15', 'PAID'], ['hydro', '2026-08-18', 'to confirm']]) {
        const single = page.locator(`[data-blend-bill="${id}:${date}"]`);
        await single.click({ position: { x: 8, y: 28 } });
        const summary = sheet().locator(`[data-period-bill="${id}"]`);
        assert.equal(await summary.getAttribute('data-bill-date'), date);
        assert.equal(await summary.getAttribute('data-bill-status'), status);
        assert.equal(await page.locator('[data-budget-detail-back]').isVisible(), false);
        await close(single);
      }
      // The hero opens the same compact roster; details remain one tap away.
      const hero = page.locator('[data-operating-question="04"] .budget-step-summary');
      await hero.focus(); await page.keyboard.press('Enter'); assert.equal(await visibleRows().count(), 14);
      await hero.evaluate(el => { el.click(); el.click(); });
      assert.equal(await page.evaluate(() => document.querySelector('[data-budget-detail-sheet]').budgetSheet.snapshot().frames.length), 1);
      assert.equal(await sheet().locator('[data-budget-bill-day]').count(), 0);
      assert.equal(await sheet().locator('[data-bill-detail]').count(), 0, 'no repeated large detail summaries in the roster');
      const metrics = await visibleRows().evaluateAll(rows => ({ count: rows.length,
        visibleWithinViewport: rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }).length,
        heights: rows.map(r => r.getBoundingClientRect().height),
        amountSizes: rows.map(r => parseFloat(getComputedStyle(r.querySelector('.budget-bill-amount')).fontSize)),
        nameSizes: rows.map(r => parseFloat(getComputedStyle(r.querySelector('strong')).fontSize)),
        pageOverflow: document.documentElement.scrollWidth > innerWidth }));
      assert.ok(metrics.heights.every(h => h >= 44));
      assert.ok(metrics.nameSizes.every(size => size >= 15)); assert.ok(metrics.amountSizes.every(size => size <= 16));
      assert.equal(metrics.pageOverflow, false);
      if (width === 1440) assert.ok(metrics.visibleWithinViewport >= 10, JSON.stringify(metrics));
      measurements.push({ width, theme, ...metrics }); await takeShot('compact-hero-bills');
      await sheet().locator('[data-budget-bill-open="internet"]').click();
      assert.equal(await sheet().locator('[data-period-bill]').getAttribute('data-period-bill'), 'internet');
      await page.locator('[data-budget-detail-back]').click(); assert.equal(await visibleRows().count(), 14);
      const last = visibleRows().last(); await last.scrollIntoViewIfNeeded();
      const lastId = await last.getAttribute('data-budget-bill-open'); await last.click();
      assert.equal(await sheet().locator('[data-period-bill]').getAttribute('data-period-bill'), lastId, 'scrolling reaches the last bill');
      await page.locator('[data-budget-detail-back]').click();
      assert.equal(await last.evaluate(el => document.activeElement === el), true);
      // Preserve the native filters and the original period evidence controls.
      const controls = sheet().locator('.blend-bill-list-context'); await controls.locator(':scope > summary').click();
      await sheet().locator('[data-budget-bill-filter="paid"]').click();
      assert.equal(await visibleRows().count(), 1); assert.equal(await visibleRows().first().getAttribute('data-budget-bill-open'), 'mortgage');
      await sheet().locator('[data-budget-bill-filter="all"]').click(); assert.equal(await visibleRows().count(), 14);
      await controls.locator(':scope > summary').click();
      await page.evaluate(() => App.rerender()); await settle(); assert.equal(await visibleRows().count(), 14);
      await close(hero);
      // Native period navigation remounts the roster without stale date filters.
      const river = page.locator('.g-river-wrap .river'); await river.focus(); await page.keyboard.press('ArrowRight'); await settle();
      assert.notEqual(await period(), originalPeriod);
      await hero.click(); assert.equal(await sheet().locator('[data-budget-bill-day]').count(), 0);
      await close(hero); await river.focus(); await page.keyboard.press('ArrowLeft'); await settle();
      assert.equal(await period(), originalPeriod);
      await four.click(); assert.equal(await visibleRows().count(), 4); await close(four);
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), originalData, 'interaction never mutates source or settlement');
      await context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    if (sourceBound) {
      assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), sourceBinding.head);
      for (const [file, bound] of Object.entries(sourceBinding.files)) assert.equal(sha(fs.readFileSync(path.join(root, file))), bound.sha256);
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ sourceBound, sourceBinding, measurements, shots, errors, writes }, null, 2));
    console.log('PASS Bills native square/day/compact roster: 1440/390/320, light/dark, every occurrence, keyboard, Back/Close focus, duplicate clicks, remounts and periods');
    console.log(JSON.stringify({ sourceBound, head: sourceBinding.head, output, desktop: measurements.filter(m => m.width === 1440) }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
