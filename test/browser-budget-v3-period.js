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
      const trackBounds = await page.locator('.budget-waterfall-track').evaluateAll(rows => rows.map(row => {
        const r = row.getBoundingClientRect(); return [r.left, r.width];
      }));
      assert.ok(trackBounds.every(([left, width]) => Math.abs(left - trackBounds[0][0]) < .01
        && Math.abs(width - trackBounds[0][1]) < .01), 'all waterfall rows share the same rendered track origin and width');
      const hero = page.locator('[data-budget-period-result]');
      assert.match(await hero.innerText(), /1,632\.01/); // 4050 - 1665 - 752.99
      assert.match(await hero.innerText(), /estimated[\s\S]*Before savings/);
      assert.equal(await page.locator('[data-budget-cash-hero]').innerText(), '$1,215.00');
      assert.match(await page.locator('.budget-cash-sub').innerText(), /Bills account only/);
      assert.equal(await page.locator('[data-live-current-balance-amount]').count(), 1);
      assert.equal(await page.locator('[data-budget-today-evidence]').isVisible(), false);
      assert.equal(await page.locator('[data-budget-cash-answer]').isVisible(), false);
      assert.equal(await page.locator('[data-budget-cash-detail]').isVisible(), false);
      assert.equal(await page.locator('[data-budget-cash-keep]').isVisible(), false);
      assert.equal(await page.locator('[data-from-today-proposal]').isVisible(), false);
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
        await geometry(page);
        if (id === '04') assert.match(await page.locator('[data-operating-question="04"]').innerText(), /1,400\.00|Mortgage/);
        if (id === '06') assert.match(await page.locator('[data-operating-question="06"]').innerText(), /Synthetic grocer|Groceries/);
        await page.keyboard.press('Space');
        assert.equal(await summary.evaluate(el => el.parentElement.open), false);
      }
      // Compact overview: ⓘ opens the whole incumbent evidence, with exact
      // return focus. Next payday opens the exact published funding row.
      const how = page.locator('[data-budget-cash-how]');
      await how.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-budget-today-evidence]').isVisible(), true);
      assert.equal(await page.locator('[data-budget-cash-detail]').isVisible(), true);
      assert.equal(await page.locator('[data-budget-cash-keep]').isVisible(), true);
      assert.match(await page.locator('[data-budget-cash-keep]').innerText(), /After bills & essentials.*across chequing/);
      assert.match(await page.locator('[data-budget-cash-answer]').innerText(), /873\.50[\s\S]*501\.50/);
      assert.match(await page.locator('.budget-cash-plan-scope').innerText(), /Across chequing accounts/);
      await page.locator('[data-budget-cash-detail]').screenshot({ path: path.join(screenshots, `today-details-${width}.png`) });
      assert.equal(await page.locator('[data-budget-cash-back]').evaluate(el => el === document.activeElement), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-budget-today-evidence]').isVisible(), false);
      assert.equal(await how.evaluate(el => el === document.activeElement), true);
      const periodInfo = page.locator('.budget-period-info > summary');
      await periodInfo.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-from-today-proposal]').isVisible(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-from-today-proposal]').isVisible(), false);
      assert.equal(await periodInfo.evaluate(el => el === document.activeElement), true);
      const nextPayday = page.locator('[data-budget-cash-next]');
      await nextPayday.focus(); await page.keyboard.press('Enter');
      const funding = page.locator('[data-payday-breakdown="planned-cost-funding"]');
      assert.equal(await funding.evaluate(el => el.open), true);
      assert.equal(await funding.locator('summary').evaluate(el => el === document.activeElement), true);
      assert.match(await funding.innerText(), /August 28 payday/);
      await geometry(page);
      await page.locator('[data-budget-cash-back]').click();
      assert.equal(await nextPayday.evaluate(el => el === document.activeElement), true);
      await how.click();
      const todaySummaries = page.locator('.budget-surface-today [data-payday-breakdown] > summary');
      // The original financial evidence is still keyboard reachable, with
      // focused controls inside the viewport rather than under sticky chrome.
      for (let i = 0; i < await todaySummaries.count(); i++) {
        await todaySummaries.nth(i).focus();
        const bounds = await page.evaluate(() => {
          const r = document.activeElement.getBoundingClientRect(); return [r.top, r.bottom, innerHeight];
        });
        assert.ok(bounds[0] >= 0 && bounds[1] <= bounds[2], `Today focus visible: ${bounds}`);
        await page.keyboard.press('Enter');
        await geometry(page);
      }
      await page.locator('[data-budget-cash-back]').click();
      assert.equal(await how.evaluate(el => el === document.activeElement), true);
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
      // Signed Forecast results keep known trust. No-income geometry is an
      // explicit unscaled known state; it must never become an unknown hatch.
      for (const [name, options, expected] of [
        ['deficit', { periodInternet: 1800 }, '82.99'],
        ['overflow', { periodInternet: 10000 }, '8,282.99'],
        ['zero-income', { zeroIncome: true }, '2,417.99'],
      ]) {
        data = fx.served(options); await boot(); await geometry(page);
        const final = page.locator('[data-operating-question="07"] > details > summary');
        assert.match(await final.innerText(), new RegExp(expected.replace('.', '\\.')));
        assert.equal(await final.locator('[data-sign="negative"]').count(), 1);
        assert.equal(await final.locator('.is-unknown').count(), 0);
        assert.equal(await page.locator('[data-operating-question="06"] > details > summary .is-unknown').count(), 0);
        if (name === 'deficit') {
          assert.equal(await page.locator('[data-operating-question="06"] .budget-waterfall-bar').count(), 2);
          assert.equal(await final.locator('.budget-waterfall-bar.is-negative').count(), 1);
          assert.equal(await page.locator('.budget-waterfall-zero').count(), 6);
        } else if (name === 'overflow') {
          assert.equal(await final.locator('.is-overflow-start').count(), 1);
        } else {
          assert.match(await page.locator('[data-operating-question="02"] > details > summary').innerText(), /0\.00/);
          assert.equal(await page.locator('[data-budget-bar-state="zero-income"]').count(), 5);
          assert.equal(await page.locator('.budget-waterfall-bar').count(), 0);
        }
        await page.screenshot({ path: path.join(screenshots, `${name}-${width}.png`), fullPage: true });
        await page.locator('[data-calendar-waterfall]').screenshot({ path: path.join(screenshots, `${name}-period-${width}.png`) });
      }
      // Configured pools with unknown assignments must retain the withholding reason.
      data = fx.served({ withheldSavings: true }); await boot(); await geometry(page);
      assert.equal(await page.locator('[data-budget-cash-hero]').innerText(), '$1,215.00');
      assert.equal(await page.locator('[data-budget-cash-withheld]').isVisible(), true);
      assert.equal(await page.locator('.budget-cash-chart').count(), 0);
      assert.match(await page.locator('#savings-inventory').innerText(), /Assignments unknown/);
      await page.locator('.budget-period-info > summary').click();
      await page.locator('[data-from-today-proposal] summary').click();
      assert.match(await page.locator('[data-from-today-proposal]').innerText(), /withheld|withholding/);
      await page.screenshot({ path: path.join(screenshots, `withheld-${width}.png`), fullPage: true });
      data = fx.served({ spendingCash: -50, savingsCash: 8000 }); await boot(); await geometry(page);
      assert.equal(await page.locator('[data-budget-cash-hero]').innerText(), '$1,215.00');
      await how.click();
      assert.match(await page.locator('[data-budget-cash-part="household"]').innerText(), /308\.50/);
      await page.screenshot({ path: path.join(screenshots, `negative-spending-${width}.png`), fullPage: true });
      data = fx.served({ groceriesExtra: 200 }); await boot(); await geometry(page);
      assert.match(await page.locator('[data-budget-period-result]').innerText(), /1,573\.46/);
      assert.match(await page.locator('[data-operating-question="06"] > details > summary').innerText(), /811\.54/);
      assert.equal(await page.locator('[data-budget-cash-hero]').innerText(), '$1,215.00');
      await page.screenshot({ path: path.join(screenshots, `overspending-${width}.png`), fullPage: true });
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
      await page.screenshot({ path: path.join(screenshots, `levy-deficit-${width}.png`), fullPage: true });
      await page.locator('[data-calendar-waterfall]').screenshot({ path: path.join(screenshots, `levy-deficit-period-${width}.png`) });
      // Preserve the concurrent no-observation zero-income regression separately
      // from the observation/overlay fixture, which retains actual Other Spend.
      data = fx.served({ zeroIncomeWithoutSpend: true }); await boot(); await geometry(page);
      assert.match(await page.locator('[data-budget-period-result]').innerText(), /2,395\.00/);
      assert.match(await page.locator('[data-operating-question="02"] .budget-step-value').innerText(), /0\.00/);
      assert.match(await page.locator('[data-operating-question="07"] .budget-step-value').innerText(), /estimated/);
      const zeroIncomeTrack = page.locator('[data-operating-question="02"] .budget-waterfall-track');
      assert.equal(await zeroIncomeTrack.evaluate(el => el.classList.contains('is-noscale')), true);
      for (const id of ['02', '04', '05', '06', '07']) {
        const track = await trackState(id);
        assert.equal(track.unknown, false);
        assert.ok(!track.hatch.includes('repeating-linear-gradient'));
        assert.equal(await page.locator(`[data-operating-question="${id}"] .budget-waterfall-bar`).count(), 0);
        if (id !== '02') assert.equal(track.deficit, true);
      }
      assert.equal((await trackState('savings')).unknown, true);
      assert.ok((await trackState('savings')).hatch.includes('repeating-linear-gradient'));
      await page.screenshot({ path: path.join(screenshots, `zero-income-no-observations-${width}.png`), fullPage: true });
      await page.locator('[data-calendar-waterfall]').screenshot({ path: path.join(screenshots, `zero-income-no-observations-period-${width}.png`) });
      await page.close();
      console.log(`PASS ${width}px: financial hero, geometry, evidence, keyboard reachability, focus restoration, unknown assignments, unavailable plan and known deficit`);
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS actual App.boot → Forecast → active Budget renderer; no external requests or page errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
