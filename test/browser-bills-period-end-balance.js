'use strict';
// Real App.boot, invented provider packet, all network intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { chromium } = require('playwright');
const fx = require('./fixtures/bills-period-end-balance-data');
const root = path.join(__dirname, '..');
const out = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR || path.join(require('node:os').tmpdir(), 'bills-period-end-balance');
fs.mkdirSync(out, { recursive: true });
const states = [], errors = [], external = [], writes = [];
const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const width of [1440, 390, 320]) for (const state of ['estimated', 'coverage-unknown', 'ledger-unknown']) {
      const data = fx.served();
      if (state === 'coverage-unknown') data.plan.cardPurchaseCoverage.opening.confirmed = false;
      if (state === 'ledger-unknown') data.liveOverlay.currentPeriodActuals.transactionCoverage = 'truncated';
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
      page.setDefaultTimeout(12000);
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://closing.test') { external.push(u.origin); return route.abort(); }
        if (route.request().method() !== 'GET') writes.push(route.request().method());
        if (u.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        return fs.existsSync(file) ? route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404, body: '' });
      });
      await page.goto('http://closing.test/');
      const card = page.locator('[data-bills-closing]'); await card.waitFor();
      const text = await card.innerText();
      assert.match(text, /Expected Bills balance at period end/);
      assert.match(text, /1,373\.29/);
      assert.match(text, state === 'estimated' ? /Estimated\s+\$1,735\.35/ : /Unavailable/);
      assert.equal(await card.getAttribute('data-bills-closing-state'), state === 'estimated' ? 'estimated' : 'unavailable');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); });
      await page.screenshot({ path: path.join(out, `${state}-${width}.png`), fullPage: true, animations: 'disabled' });
      await card.screenshot({ path: path.join(out, `${state}-card-${width}.png`), animations: 'disabled' });
      const summary = card.locator('summary');
      await summary.focus(); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-bills-closing-details]')?.open);
      assert.match(await card.innerText(), /Weekly's balance and overdraft are excluded/);
      if (state === 'estimated') assert.match(await card.innerText(), /520\.37[\s\S]*359\.86/);
      await card.screenshot({ path: path.join(out, `${state}-details-${width}.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      assert.equal(await summary.evaluate(el => el === document.activeElement), true);
      assert.equal(await card.locator('details').evaluate(el => el.open), false);
      await summary.press('Enter'); await card.locator('[data-bills-closing-close]').click();
      assert.equal(await summary.evaluate(el => el === document.activeElement), true);
      if (state === 'estimated') {
        for (let repeat = 0; repeat < 2; repeat++) { await summary.press('Enter'); await page.keyboard.press('Escape'); }
        const amount = await card.locator('[data-bills-closing-amount]').innerText();
        await page.locator('[data-budget-window-step="1"]').click();
        await page.locator('[data-budget-window-step="-1"]').click();
        assert.equal(await page.locator('[data-bills-closing-amount]').innerText(), amount);
        await page.locator('[aria-label="Budget planning granularity"] [data-budget-granularity="month"]').click();
        await page.locator('[data-budget-month-view]').waitFor();
        assert.equal(await page.locator('[data-bills-closing]').count(), 0, 'Month has its original scope');
        await page.locator('[aria-label="Budget planning granularity"] [data-budget-granularity="pay-period"]').click();
        if (await page.locator('[data-budget-drilldown-exit]').count()) await page.locator('[data-budget-drilldown-exit]').click();
        assert.equal(await page.locator('[data-bills-closing-amount]').innerText(), amount);
        await page.setViewportSize({ width: width === 1440 ? 320 : 1440, height: 1000 });
        assert.equal(await page.locator('[data-bills-closing-amount]').innerText(), amount);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      states.push({ width, state, card: text.replace(/\s+/g, ' ').trim(), synthetic: true });
      await page.close();
      console.log(`PASS ${width}px ${state}: actual boot, keyboard close, repeat, navigation and resize`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(external, []);
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true, head, states, errors, writes, external }, null, 2) + '\n');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
