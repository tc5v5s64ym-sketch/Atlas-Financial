'use strict';
// Optional real-browser proof; requires Playwright and a Chromium installation.
// CHROME_PATH=/usr/bin/chromium node test/browser-budget-stepped-layout.js
// Uses only synthetic publications; never starts Atlas, fetches data or logs in.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const screenshots = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR
  || path.join(require('node:os').tmpdir(), 'atlas-budget-review');
fs.mkdirSync(screenshots, { recursive: true });
const { ctx, state } = require('./test-budget-stepped-layout');
const forecast = fs.readFileSync(path.join(root, 'public/forecast.js'), 'utf8');
const source = fs.readFileSync(path.join(root, 'public/plan.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');
// Load the production formatters without app.js's network/bootstrap path.
const helpers = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8').split('\n')
  .filter(line => /^const (money|money2|fmtDate|fmtDateLong) =/.test(line)).join('\n');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'],
  });
  try {
    const errors = [];
    async function setup(width, touch = false) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 }, hasTouch: touch, reducedMotion: 'reduce',
      });
      page.on('pageerror', e => errors.push(e.message));
      await page.setContent(`<html data-theme="light"><head></head><body>
        <main class="wrap" style="max-width:900px;padding-top:24px">
          <p>Synthetic review fixture — not household balances</p><div id="budget"></div>
        </main></body></html>`);
      await page.addStyleTag({ content: style });
      await page.addScriptTag({ content: forecast });
      await page.addScriptTag({ content: `${helpers};const budgetTestCtx=${JSON.stringify(ctx)};` });
      await page.addScriptTag({ content: source });
      await page.evaluate(value => Object.assign(state, value), state);
      await page.evaluate(() => {
        const mount = document.getElementById('budget');
        mount.innerHTML = operatingSurfaceHtml(budgetTestCtx);
        wirePlanLookPicker(mount, budgetTestCtx);
      });
      return page;
    }
    async function geometry(page) {
      const result = await page.evaluate(() => ({
        width: innerWidth, scroll: document.documentElement.scrollWidth,
        clipped: Array.from(document.querySelectorAll('.budget-step-summary'))
          .filter(el => el.scrollWidth > el.clientWidth).length,
      }));
      assert.ok(result.scroll <= result.width, JSON.stringify(result));
      assert.equal(result.clipped, 0, JSON.stringify(result));
    }
    const selected = page => page.locator('[data-pay-period-swipe]')
      .getAttribute('data-selected-pay-period');
    async function step(page, kind, key) {
      await page.locator(`[data-budget-wheel="${kind}"] [aria-current="true"]`).focus();
      await page.keyboard.press(key);
    }
    async function mouseSwipe(page, kind, left) {
      const box = await page.locator(`[data-budget-wheel="${kind}"]`).boundingBox();
      const y = box.y + box.height / 2;
      const center = box.x + box.width / 2;
      await page.mouse.move(center + (left ? 60 : -60), y);
      await page.mouse.down();
      await page.mouse.move(center + (left ? -80 : 80), y, { steps: 6 });
      await page.mouse.up();
    }
    async function touchSwipe(page, kind, left) {
      const wheel = page.locator(`[data-budget-wheel="${kind}"]`);
      await wheel.scrollIntoViewIfNeeded();
      const box = await wheel.boundingBox();
      const session = await page.context().newCDPSession(page);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      try {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ x: x + (left ? 55 : -55), y }],
        });
        for (let i = 1; i <= 6; i++) {
          await session.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + (left ? 55 : -55) + (left ? -125 : 125) * i / 6, y }],
          });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } finally {
        await session.detach();
      }
      await page.evaluate(() => new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function screenshot(page, name) {
      await page.screenshot({ path: path.join(screenshots, name), fullPage: true });
    }

    const desk = await setup(1440);
    await geometry(desk);
    assert.equal(await selected(desk), 'current');
    const summary = desk.locator('.budget-step-summary').first();
    await summary.focus();
    await desk.keyboard.press('Enter');
    assert.equal(await summary.evaluate(el => el.parentElement.open), true);
    assert.equal(await summary.evaluate(el => document.activeElement === el), true);
    await desk.keyboard.press('Space');
    assert.equal(await summary.evaluate(el => el.parentElement.open), false);
    await summary.click();
    assert.equal(await summary.evaluate(el => el.parentElement.open), true);
    await summary.click();
    assert.equal(await summary.evaluate(el => el.parentElement.open), false);
    await screenshot(desk, 'desktop-collapsed.png');
    await summary.click();
    await screenshot(desk, 'desktop-income-expanded.png');
    await step(desk, 'period', 'ArrowRight');
    assert.equal(await selected(desk), 'next');
    assert.equal(await desk.locator('[data-live-current-balance]').count(), 0);
    assert.match(await desk.locator('[data-selected-pay-period-status]').innerText(), /Projected/);
    await step(desk, 'month', 'ArrowRight');
    assert.equal(await selected(desk), 'nov');
    await step(desk, 'month', 'ArrowRight');
    assert.equal(await selected(desk), 'dec');
    await step(desk, 'month', 'ArrowRight');
    assert.equal(await selected(desk), 'jan');
    assert.match(await desk.locator('[data-selected-pay-period-range]').innerText(),
      /Jan 1, 2027 – Jan 14, 2027/);
    await step(desk, 'month', 'ArrowRight');
    assert.equal(await selected(desk), 'jan');
    for (let i = 0; i < 10; i++) await step(desk, 'period', 'ArrowLeft');
    assert.equal(await selected(desk), 'past');
    assert.equal(await desk.locator('[data-live-current-balance]').count(), 0);
    await step(desk, 'month', 'ArrowRight');
    assert.equal(await selected(desk), 'current');
    assert.equal(await desk.locator('[data-budget-wheel="month"] [aria-current="true"]')
      .evaluate(el => document.activeElement === el), true);
    await mouseSwipe(desk, 'month', true);
    assert.equal(await selected(desk), 'nov');
    await mouseSwipe(desk, 'month', false);
    assert.equal(await selected(desk), 'current');

    for (const width of [390, 320]) {
      const phone = await setup(width, true);
      await geometry(phone);
      await screenshot(phone, `mobile-${width}-collapsed.png`);
      await phone.locator('[data-operating-question="06"] summary').tap();
      assert.equal(await phone.locator('[data-operating-question="06"] details')
        .getAttribute('open'), '');
      await geometry(phone);
      await screenshot(phone, `mobile-${width}-household-expanded.png`);
      await phone.locator('[data-operating-question="06"] summary').tap();
      await touchSwipe(phone, 'period', true);
      assert.equal(await selected(phone), 'next');
      await touchSwipe(phone, 'period', false);
      assert.equal(await selected(phone), 'current');
      await touchSwipe(phone, 'month', true);
      assert.equal(await selected(phone), 'nov');
      await touchSwipe(phone, 'month', false);
      assert.equal(await selected(phone), 'current');
      for (let i = 0; i < 7; i++) await touchSwipe(phone, 'month', true);
      assert.equal(await selected(phone), 'jan');
      await geometry(phone);
      await screenshot(phone, `mobile-${width}-future.png`);
      await phone.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS real Chromium: 1440/390/320 layouts, native accordion click/keyboard/touch/focus, linked wheels, repeated swipes and month/year bounds, current/future/past roles, no overflow or console errors');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
