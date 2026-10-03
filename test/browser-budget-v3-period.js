'use strict';
// Optional actual-page proof. Independent invented observation/overlay fixture;
// every request is intercepted, and no server or provider credential is used.
// CHROME_PATH=<Chromium executable> node test/browser-budget-v3-period.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fx = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..');
const screenshots = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR
  || path.join(require('node:os').tmpdir(), 'atlas-budget-v3-period');
fs.mkdirSync(screenshots, { recursive: true });
async function geometry(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
    'no horizontal page scroll');
  const escaped = await page.locator('.budget-step-summary').evaluateAll(rows => rows.flatMap(row =>
    [...row.children].filter(el => {
      const a = el.getBoundingClientRect(), b = row.getBoundingClientRect();
      return a.width && (a.left < b.left - 1 || a.right > b.right + 1 || el.scrollWidth > el.clientWidth + 1);
    }).map(el => ({className:el.className, text:el.textContent, scroll:el.scrollWidth, client:el.clientWidth}))));
  assert.deepEqual(escaped, [], 'summary children fit their row');
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [], external = [];
  try {
    for (const width of [1440, 390, 320]) {
      let data = fx.served();
      const page = await browser.newPage({ viewport: { width, height: 1000 },
        colorScheme: 'light', reducedMotion: 'reduce' });
      page.on('pageerror', err => errors.push(err.message));
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
        if (u.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) {
          return route.fulfill({ json: null });
        }
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css')
          ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html' });
      });
      const boot = async () => {
        await page.goto('http://budget.test/');
        await page.locator('[data-budget-surface]').waitFor();
        assert.equal(await page.evaluate(() => App.data.meta.title), 'Synthetic Budget surface');
      };
      await boot();
      await geometry(page);
      const hero = page.locator('[data-budget-period-result]');
      assert.match(await hero.innerText(), /1,632\.01/); // 4050 - 1665 - 752.99
      assert.match(await hero.innerText(), /estimated[\s\S]*Before savings/);
      assert.equal(await page.locator('.budget-surface-today').evaluate(el => getComputedStyle(el).position), 'static');
      await page.screenshot({ path: path.join(screenshots, `current-${width}.png`), fullPage: true });
      await page.locator('[data-calendar-waterfall]').screenshot({ path: path.join(screenshots, `period-${width}.png`) });
      // Native disclosures remain reachable, keep focus, and expose the real evidence.
      for (const id of ['02', '04', '05', '06', 'savings', '07']) {
        const summary = page.locator(`[data-operating-question="${id}"] > details > summary`);
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await summary.evaluate(el => el.parentElement.open), true);
        assert.equal(await summary.evaluate(el => el === document.activeElement), true);
        if (id === '04') assert.match(await page.locator('[data-operating-question="04"]').innerText(), /1,400\.00|Mortgage/);
        if (id === '06') assert.match(await page.locator('[data-operating-question="06"]').innerText(), /Synthetic grocer|Groceries/);
        await page.keyboard.press('Space');
        assert.equal(await summary.evaluate(el => el.parentElement.open), false);
      }
      // Tab reaches every Today control, with the focused element inside the viewport.
      const todaySummaries = page.locator('.budget-surface-today summary');
      await todaySummaries.first().focus();
      for (let i = 0; i < await todaySummaries.count(); i++) {
        const bounds = await page.evaluate(() => {
          const r = document.activeElement.getBoundingClientRect(); return [r.top, r.bottom, innerHeight];
        });
        assert.ok(bounds[0] >= 0 && bounds[1] <= bounds[2], `Today focus visible: ${bounds}`);
        await page.keyboard.press('Tab');
      }
      // Rerender restores the switch or picker instead of falling back to body.
      const month = page.locator('[data-budget-granularity="month"]');
      await month.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-budget-granularity="month"]').evaluate(el => el === document.activeElement), true);
      const picker = page.locator('[data-budget-month-picker]');
      const options = await picker.locator('option').evaluateAll(els => els.map(el => el.value));
      await picker.focus(); await picker.selectOption(options[options.length - 1]);
      assert.equal(await page.locator('[data-budget-month-picker]').evaluate(el => el === document.activeElement), true);
      await page.locator('.budget-granularity [data-budget-granularity="pay-period"]').focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('.budget-granularity [data-budget-granularity="pay-period"]').evaluate(el => el === document.activeElement), true);
      const drill = page.locator('[data-budget-drilldown-picker]');
      if (await drill.count()) {
        const periods = await drill.locator('option').evaluateAll(els => els.map(el => el.value));
        await drill.focus(); await drill.selectOption(periods[periods.length - 1]);
        assert.equal(await page.locator('[data-budget-drilldown-picker]').evaluate(el => el === document.activeElement), true);
      }
      await page.locator('[data-budget-drilldown-exit]').click();
      assert.equal(await page.locator('[data-budget-granularity="pay-period"]').evaluate(el => el === document.activeElement), true);
      // Configured pools with unknown assignments must retain the withholding reason.
      data = fx.served({ withheldSavings: true }); await boot(); await geometry(page);
      assert.match(await page.locator('#savings-inventory').innerText(), /Assignments unknown/);
      await page.locator('[data-from-today-proposal] summary').click();
      assert.match(await page.locator('[data-from-today-proposal]').innerText(), /withheld|withholding/);
      await page.screenshot({ path: path.join(screenshots, `withheld-${width}.png`), fullPage: true });
      data = fx.served({ unavailablePlan: true }); await boot();
      assert.equal(await page.locator('[data-budget-period-result]').count(), 0);
      assert.match(await page.locator('[data-budget-surface="unavailable"]').innerText(), /Last trusted opening/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(screenshots, `unavailable-${width}.png`), fullPage: true });
      data = fx.served({ deficitPeriod: true }); await boot(); await geometry(page);
      assert.match(await page.locator('[data-budget-period-result]').innerText(), /3,367\.99/);
      assert.match(await page.locator('[data-operating-question="07"] .budget-step-value').innerText(), /estimated/);
      const trackState = id => page.locator(`[data-operating-question="${id}"] .budget-waterfall-track`)
        .evaluate(el => ({ deficit: el.classList.contains('is-deficit'), unknown: el.classList.contains('is-unknown'),
          hatch: getComputedStyle(el).backgroundImage }));
      const householdTrack = await trackState('06');
      const finalTrack = await trackState('07');
      const savingsTrack = await trackState('savings');
      assert.deepEqual({ deficit: householdTrack.deficit, unknown: householdTrack.unknown }, { deficit: true, unknown: false });
      assert.deepEqual({ deficit: finalTrack.deficit, unknown: finalTrack.unknown }, { deficit: true, unknown: false });
      assert.ok(!finalTrack.hatch.includes('repeating-linear-gradient'), 'known deficit is not the unknown hatch');
      assert.deepEqual({ deficit: savingsTrack.deficit, unknown: savingsTrack.unknown }, { deficit: false, unknown: true });
      assert.ok(savingsTrack.hatch.includes('repeating-linear-gradient'), 'unavailable savings keep the hatch');
      await page.screenshot({ path: path.join(screenshots, `deficit-${width}.png`), fullPage: true });
      await page.locator('[data-calendar-waterfall]').screenshot({ path: path.join(screenshots, `deficit-period-${width}.png`) });
      await page.close();
      console.log(`PASS ${width}px: financial hero, geometry, evidence, keyboard reachability, focus restoration, unknown assignments, unavailable plan and known deficit`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS actual App.boot → Forecast → active Budget renderer; no external requests or page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
