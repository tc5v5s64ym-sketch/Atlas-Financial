'use strict';
// Independent invented household, real App.boot and Forecast, all requests
// intercepted. No live data, credentials, captured or scaled household values.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fx = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..');
const output = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR || path.join(require('node:os').tmpdir(), 'atlas-funding-month');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [], external = [];
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: 'light', reducedMotion: 'reduce' });
      let data = fx.served();
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://budget.test') { external.push(url.origin); return route.abort(); }
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
        return fs.existsSync(file) ? route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' }) : route.fulfill({ status: 404, body: '' });
      });
      const boot = async () => { await page.goto('http://budget.test/'); await page.locator('[data-budget-funding-section]').waitFor(); };
      const geometry = async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal page overflow');
        assert.equal(await page.locator('.budget-funding-cost-head').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)), true, 'cost names and amounts fit at 320px');
      };
      const visibleFocus = async selector => {
        const state = await page.locator(selector).evaluate(node => {
          const rect = node.getBoundingClientRect();
          const dock = document.querySelector('.sitenav-household')?.getBoundingClientRect();
          return { focused: node === document.activeElement, shown: !!node.getClientRects().length,
            top: rect.top, bottom: rect.bottom, limit: dock && dock.top > 0 ? dock.top : innerHeight };
        });
        assert.equal(state.focused && state.shown, true, 'exact restored trigger remains visible and focused');
        assert.ok(state.top >= 0 && state.bottom <= state.limit + 1, 'restored focus stays above the actual mobile dock');
      };
      const capture = async (name, selector) => {
        if (!selector) await page.evaluate(() => scrollTo(0, 0));
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
        const options = { path: path.join(output, `${name}-${width}.png`), animations: 'disabled' };
        return selector ? page.locator(selector).screenshot({ ...options, style: '.sitenav-household,.budget-section-nav {visibility:hidden !important;}' })
          : page.screenshot({ ...options, fullPage: true });
      };
      await boot();
      await geometry();
      const today = page.locator('[data-budget-funding-panel="today"]');
      assert.match(await today.locator('[data-budget-funding-proposal]').innerText(), /\$0\.00/,
        'no contribution assigned to either later-dated cost today; capacity is a different field');
      assert.match(await today.innerText(), /never add them together/);
      await capture('upcoming-today', '[data-budget-funding-section]');
      const tabs = page.locator('[data-budget-funding-tab]');
      await tabs.first().focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.last().getAttribute('aria-selected'), 'true');
      assert.equal(await tabs.last().evaluate(node => node === document.activeElement), true);
      assert.equal(await today.isVisible(), false);
      const payday = page.locator('[data-budget-funding-panel="payday"]');
      assert.equal(await payday.isVisible(), true);
      assert.match(await tabs.last().innerText(), /Aug 28/);
      assert.match(await payday.innerText(), /exact published payday schedule/i);
      await capture('upcoming-payday', '[data-budget-funding-section]');
      const evidenceButton = payday.locator('[data-budget-funding-evidence]');
      await evidenceButton.focus(); await page.keyboard.press('Enter');
      await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-budget-detail-sheet]').evaluate(node => node.open), true);
      assert.match(await page.locator('[data-budget-detail-body]').innerText(), /August 28 payday|Aug 28/);
      await page.locator('[data-budget-detail-body] [data-payday-breakdown="planned-cost-funding"]').evaluate(node => { window.__originalPaydayFunding = node; });
      await page.evaluate(() => App.rerender());
      await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-budget-detail-body] [data-payday-breakdown="planned-cost-funding"]').evaluate(node => node !== window.__originalPaydayFunding), true,
        'rerender uses refreshed complete evidence rather than a cached packet');
      assert.equal(await page.locator('[data-budget-funding-tab="payday"]').getAttribute('aria-selected'), 'true', 'the selected lens survives evidence refresh');
      if (width === 390) {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
        assert.equal(await page.locator('[data-budget-funding-tab="payday"]').getAttribute('aria-selected'), 'true', 'the selected lens survives responsive remount');
        await page.setViewportSize({ width, height: 1000 });
        await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
      }
      await page.keyboard.press('Escape');
      assert.equal(await evidenceButton.evaluate(node => node === document.activeElement), true);
      await visibleFocus('[data-budget-funding-panel="payday"] [data-budget-funding-evidence]');
      await tabs.last().focus(); await page.keyboard.press('Home');
      const todayButton = today.locator('[data-budget-funding-evidence]');
      await page.locator('[data-from-today-proposal]').evaluate(node => { window.__fundingOriginal = node; });
      await todayButton.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.locator('[data-budget-detail-body] [data-from-today-proposal]').evaluate(node => node === window.__fundingOriginal), true, 'original complete evidence node is moved');
      assert.match(await page.locator('[data-budget-detail-body]').innerText(), /1,375\.00[\s\S]*265\.00[\s\S]*308\.50/);
      assert.match(await page.locator('[data-budget-detail-body]').innerText(), /501\.50/,
        'capacity reconciles independently: 1375 cash - 265 remaining bills - 308.50 household - 300 floor');
      await page.keyboard.press('Escape');
      assert.equal(await todayButton.evaluate(node => node === document.activeElement), true);
      await visibleFocus('[data-budget-funding-panel="today"] [data-budget-funding-evidence]');
      await page.locator('[data-budget-funding-inventory]').click();
      assert.match(await page.locator('[data-budget-detail-body]').innerText(), /unknown|await confirmation|not been supplied/i);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-budget-funding-inventory]').evaluate(node => node === document.activeElement), true);
      await visibleFocus('[data-budget-funding-inventory]');
      const todayScope = await today.innerText();
      await page.locator('[data-budget-window-step="-1"]').click();
      assert.match(await page.locator('[data-calendar-waterfall]').getAttribute('data-calendar-waterfall'), /2026-07-31/);
      assert.equal(await page.locator('[data-budget-funding-panel="today"]').innerText(), todayScope,
        'historical period selection keeps the dated current-cash proposal separate');
      await page.locator('[data-budget-window-step="1"]').click();
      await page.locator('[data-budget-window-step="1"]').click();
      assert.equal(await page.locator('[data-budget-funding-panel="today"]').innerText(), todayScope,
        'future period selection does not relabel current cash as a future receipt');
      await geometry();
      await page.locator('[data-budget-granularity="month"]').click();
      assert.equal(await page.locator('[data-budget-month-picker]').count(), 1);
      assert.equal(await page.locator('[data-budget-month-ladder-view]').count(), 1);
      assert.equal(await page.locator('[data-budget-month-ladder]').count(), 3);
      assert.match(await page.locator('.budget-v3-month').innerText(), /Published projection window[\s\S]*Each month funds itself/i);
      const reading = page.locator('[data-budget-reading-info]');
      assert.equal(await reading.getAttribute('open'), null, 'reading explanations start collapsed');
      await reading.locator('summary').focus(); await page.keyboard.press('Enter');
      assert.equal(await reading.evaluate(node => node.open), true, 'reading explanations are keyboard reachable');
      assert.equal(await reading.locator('summary').evaluate(node => getComputedStyle(node).outlineStyle), 'solid', 'reading info has visible keyboard focus');
      assert.match(await reading.innerText(), /Pending[\s\S]*Not confirmed[\s\S]*Unknown/);
      await page.keyboard.press('Enter');
      assert.equal(await reading.evaluate(node => node.open), false, 'keyboard closes reading explanations');
      await reading.locator('summary').evaluate(node => node.blur());
      assert.equal(await page.getByRole('button', { name: 'Preview missing data' }).count(), 0, 'prototype demo control never ships');
      await geometry(); await capture('month');
      await capture('month-flow', '.budget-v3-month-bottom > section:first-child');
      const picker = page.locator('[data-budget-month-picker]');
      await picker.selectOption('2026-09');
      assert.equal(await picker.evaluate(node => node === document.activeElement), true);
      assert.match(await page.locator('[data-budget-month-cost="school-trip"]').innerText(), /School trip/);
      assert.equal(await page.locator('[data-budget-month-cost="winter-tires"]').count(), 0, 'cash-date month membership, no other-month cost bleed');
      assert.match(await page.locator('[data-budget-month-funding-pressure]').innerText(), /outside this month can also affect/);
      await geometry(); await capture('month-costs', '.budget-v3-month-bottom > section:last-child');
      const monthEvidence = page.locator('[data-budget-month-funding-open]');
      await page.locator('[data-budget-month-funding-evidence]').evaluate(node => { window.__originalMonthFunding = node; });
      await monthEvidence.focus(); await page.keyboard.press('Enter');
      await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[data-budget-detail-body] [data-budget-month-funding-evidence]').evaluate(node => node === window.__originalMonthFunding), true,
        'Month opens the complete incumbent Month-input evidence node');
      assert.match(await page.locator('[data-budget-detail-body]').innerText(), /August 28|Aug 28/);
      await page.keyboard.press('Escape');
      await visibleFocus('[data-budget-month-funding-open]');
      await page.locator('.budget-granularity [data-budget-granularity="pay-period"]').click();
      await page.locator('[data-budget-drilldown-exit]').click();
      data = fx.served({ withUndatedCost: true }); await boot();
      const undated = page.locator('[data-budget-funding-panel="today"] [data-budget-funding-cost="fixture-undated"]');
      assert.equal(await undated.count(), 1);
      assert.match(await undated.innerText(), /275\.00[\s\S]*Date not established[\s\S]*Contribution unknown/);
      assert.equal(await undated.locator('.budget-funding-track i').count(), 0);
      await geometry(); await capture('upcoming-undated', '[data-budget-funding-section]');
      data = fx.served({ withheldSavings: true }); await boot();
      assert.match(await page.locator('[data-budget-funding-panel="today"] [data-budget-funding-proposal]').innerText(), /Unavailable/);
      assert.match(await page.locator('[data-budget-funding-section]').innerText(), /unconfirmed|unknown|await confirmation/i);
      await page.locator('[data-budget-funding-tab="payday"]').click();
      assert.match(await page.locator('[data-budget-funding-panel="payday"] [data-budget-funding-proposal]').innerText(), /Unavailable/);
      await geometry(); await capture('upcoming-withheld', '[data-budget-funding-section]');
      data = fx.served({ zeroIncomeWithoutSpend: true }); await boot();
      assert.match(await page.locator('[data-budget-funding-panel="today"] [data-budget-funding-proposal]').innerText(), /Unavailable/);
      await page.locator('[data-budget-granularity="month"]').click();
      assert.match(await page.locator('[data-budget-month-view]').innerText(), /deficit|unavailable/i);
      await geometry(); await capture('month-zero-income');
      for (const [coverage, settlement] of [['missing', 'unverified'], ['partial', 'paid'], ['full', 'unverified'],
        ['full', 'paid'], ['truncated', 'unverified'], ['posted-only', 'paid']]) {
        data = fx.fundingHistorical(coverage, settlement); await boot();
        const ready = !['truncated', 'posted-only'].includes(coverage);
        const capacity = settlement === 'paid' ? /501\.50/ : /396\.50/;
        assert.match(await page.locator('[data-budget-funding-context="today"]').innerText(), ready ? capacity : /Unavailable/);
        for (const role of ['past', 'current', 'next']) {
          if (role === 'past') await page.locator('[data-budget-window-step="-1"]').click();
          else await page.locator('[data-budget-window-step="1"]').click();
          const section = page.locator('[data-budget-funding-section]');
          assert.match(await page.locator('[data-budget-funding-tab="today"]').innerText(), /Aug 20/);
          assert.match(await page.locator('[data-budget-funding-context="today"]').innerText(), ready ? capacity : /Unavailable/);
          assert.equal(await page.locator('[data-from-today-proposal]').count(), 1, 'one original current-cash evidence source in every selection');
          const trigger = section.locator('[data-budget-funding-panel="today"] [data-budget-funding-evidence]');
          await trigger.focus(); await page.keyboard.press('Enter');
          await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
          assert.match(await page.locator('[data-budget-detail-body]').innerText(), ready ? capacity : /unavailable|incomplete|withholding/i);
          assert.match(await page.locator('[data-budget-detail-body]').innerText(), /2026-08-20/);
          await page.keyboard.press('Escape');
          await visibleFocus('[data-budget-funding-panel="today"] [data-budget-funding-evidence]');
          await geometry();
        }
        if (coverage === 'full' || coverage === 'truncated') await capture(`funding-history-${coverage}-${settlement}`, '[data-budget-funding-section]');
      }
      data = fx.served({ unavailablePlan: true });
      await page.goto('http://budget.test/');
      await page.locator('[data-budget-surface="unavailable"]').waitFor();
      assert.equal(await page.locator('[data-budget-funding-section]').count(), 0, 'untrusted refresh never exposes the funding renderer');
      await page.close();
      console.log(`PASS ${width}px: invented cash reconciliation, separate scopes, keyboard tabs, original evidence, focus restoration, Month hierarchy and cash-date membership`);
    }
    assert.deepEqual(errors, [], 'no browser errors'); assert.deepEqual(external, [], 'no external requests');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
