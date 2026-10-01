'use strict';
// Optional Chromium proof of server routing, authentication, App.boot and the
// real Forecast. Only the three financial JSON responses are synthetic.
// CHROME_PATH=/usr/bin/chromium node test/browser-budget-routed-layout.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const makeData = require('./fixtures/budget-layout-data');
const makeFundingData = require('./fixtures/budget-funding-data');
const root = path.join(__dirname, '..');
const screenshots = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR
  || path.join(require('node:os').tmpdir(), 'atlas-budget-routed-review');
fs.mkdirSync(screenshots, { recursive: true });

(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const syntheticPassword = randomBytes(24).toString('hex');
  const syntheticSession = randomBytes(32).toString('hex');
  // Explicit environment: never inherit any integration credential or enable
  // a live overlay/provider call while testing a presentation change.
  const server = spawn(process.execPath, ['server.js'], { cwd: root,
    env: { PATH: process.env.PATH, PORT: String(port), NODE_ENV: 'test',
      SITE_PASSWORD: syntheticPassword,
      SESSION_SECRET: syntheticSession, ATLAS_LIVE_OVERLAY: 'off' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = '';
  server.stdout.on('data', chunk => { serverLog += chunk; });
  server.stderr.on('data', chunk => { serverLog += chunk; });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { ready = (await fetch(`${base}/login`)).ok; } catch { /* starting */ }
      if (ready) break;
      if (server.exitCode != null) throw new Error(serverLog);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(ready, 'synthetic local server must start');
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH,
      args: ['--no-sandbox'] });
    const errors = [], external = [];
    for (const width of [1440, 390, 320]) {
      let data = makeData();
      const context = await browser.newContext({ viewport: { width, height: 900 },
        hasTouch: width < 400, isMobile: width < 400,
        colorScheme: 'light', reducedMotion: 'reduce' });
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) {
          external.push(url.origin); return route.abort();
        }
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json'].includes(url.pathname)) {
          return route.fulfill({ json: null });
        }
        return route.continue();
      });
      const login = await context.request.post(`${base}/login`, {
        form: { password: syntheticPassword } });
      assert.ok(login.ok());
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(base);
      await page.locator('.budget-step-summary').first().waitFor();
      assert.equal(await page.evaluate(() => App.data.meta.title), 'Synthetic Budget review');
      assert.equal(await page.locator('.budget-step-details').count(), 6);
      assert.equal(await page.locator('.atlas-budget-section').count(), 0);
      const balance = await page.locator('[data-live-current-balance]').boundingBox();
      assert.ok(balance.y < 250 && balance.height < 250, JSON.stringify(balance));
      assert.match(await page.locator('[data-live-current-balance]').innerText(), /2,500\.00/);
      assert.equal(await page.locator('[data-current-payday-details]').evaluate(el => el.open), false);
      assert.equal(await page.getByRole('heading', { name: "Today's money", exact: true }).isVisible(), false);
      const waterfall = await page.locator('[data-calendar-waterfall]').boundingBox();
      const folded = await page.locator('[data-current-payday-details]').boundingBox();
      assert.ok(balance.y + balance.height <= waterfall.y);
      assert.ok(waterfall.y + waterfall.height <= folded.y);
      assert.equal(await page.locator('#road-ahead').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(screenshots, `routed-${width}-current.png`), fullPage: true });
      const income = page.locator('[data-operating-question="02"] summary');
      await income.focus();
      await page.keyboard.press('Enter');
      assert.equal(await income.evaluate(el => el.parentElement.open), true);
      assert.equal(await income.evaluate(el => document.activeElement === el), true);
      await page.keyboard.press('Space');
      assert.equal(await income.evaluate(el => el.parentElement.open), false);
      // Full-cycle click across a year boundary keeps both nav rows linked.
      await page.locator('[data-budget-wheel="month"] button').filter({ hasText: 'January' }).click();
      assert.match(await page.locator('[data-selected-pay-period-range]').innerText(),
        /Jan 1, 2027 – Jan 14, 2027/);
      assert.equal(await page.locator('[data-live-current-balance]').count(), 0);
      const expected = { '02': '3,849.40', '04': '1,799.00', '05': '2,050.40', '07': '1,950.40' };
      for (const [id, amount] of Object.entries(expected)) {
        const header = await page.locator(`[data-operating-question="${id}"] summary`).innerText();
        assert.ok(header.includes(amount), header);
        if (id !== '04') assert.match(header, /≈ estimated/);
        else assert.doesNotMatch(header, /≈ estimated/);
      }
      await page.screenshot({ path: path.join(screenshots, `routed-${width}-2027-estimated.png`), fullPage: true });
      await income.click();
      assert.match(await page.locator('[data-period-income="payroll"]').innerText(), /≈ estimated/);
      await income.click();
      // Genuine touch swipe through the production listener, then back.
      if (width < 400) {
        const touch = await context.newCDPSession(page);
        const swipe = async left => {
          const wheel = page.locator('[data-budget-wheel="period"]');
          await wheel.scrollIntoViewIfNeeded();
          const box = await wheel.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
          await touch.send('Input.dispatchTouchEvent', { type: 'touchStart',
            touchPoints: [{ x: x + (left ? 55 : -55), y }] });
          for (let i = 1; i <= 6; i++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove',
            touchPoints: [{ x: x + (left ? 55 : -55) + (left ? -125 : 125) * i / 6, y }] });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.waitForTimeout(350);
        };
        const selected = () => page.locator('[data-pay-period-swipe]').getAttribute('data-selected-pay-period');
        const first = await selected();
        for (let i = 0; i < 3; i++) {
          await swipe(true); assert.notEqual(await selected(), first);
          await swipe(false); assert.equal(await selected(), first);
        }
        await touch.detach();
        await page.waitForTimeout(500);
        assert.equal(await page.locator('[data-operating-question="06"] details').evaluate(el => el.open), false,
          'a wheel swipe must not open the household accordion');
        await page.locator('[data-operating-question="06"] summary').tap();
        await page.waitForFunction(() => document.querySelector('[data-operating-question="06"] details').open,
          null, { timeout: 2000 });
        await page.locator('[data-operating-question="06"] summary').tap();
      }
      // Unknown source trust stays unavailable through the real bootstrap.
      data.plan.bills[1].confidence = 'unknown';
      await page.reload();
      await page.locator('.budget-step-summary').first().waitFor();
      await page.locator('[data-budget-wheel="month"] button').filter({ hasText: 'January' }).click();
      for (const id of ['04', '05', '07']) assert.match(
        await page.locator(`[data-operating-question="${id}"] summary`).innerText(), /Unavailable/);
      data.plan.startingCash.breakdown = [];
      await page.reload();
      await page.locator('.budget-step-summary').first().waitFor();
      assert.doesNotMatch(await page.locator('[data-live-current-balance]').innerText(), /\$0\.00/);
      assert.match(await page.locator('[data-live-current-balance]').innerText(), /—/);

      // Same authenticated production route, now with independently checked
      // Budget contributions. This is real Forecast output, not injected HTML.
      data = makeFundingData();
      await page.reload();
      const savings = page.locator('[data-operating-question="savings"] summary');
      await savings.waitFor();
      assert.equal(await page.locator('[data-plan-spend-earmark]').count(), 0,
        'the selected Budget schedule must not compete with the old cap-basis banner');
      assert.match(await savings.innerText(), /250\.00/);
      assert.match(await page.locator('[data-operating-question="07"] summary').innerText(), /250\.00/);
      await savings.focus();
      await page.keyboard.press('Enter');
      const named = page.locator('[data-budget-funding-item="named-cost"]');
      assert.match(await named.innerText(), /250\.00 \/ \$600\.00/);
      assert.match(await named.innerText(), /350\.00/);
      assert.match(await named.innerText(), /Actual saved: unavailable/);
      assert.equal(await savings.evaluate(el => document.activeElement === el), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(screenshots, `routed-${width}-funding-current.png`), fullPage: true });
      await page.keyboard.press('Space');
      assert.equal(await savings.evaluate(el => el.parentElement.open), false);
      await page.locator('[data-budget-wheel="period"] button').filter({ hasText: /Aug 28/ }).click();
      // Wheel settle can re-render the selected period after animation; open
      // the accordion only after it has settled, then prove visible content.
      await page.waitForTimeout(500);
      assert.match(await page.locator('[data-selected-pay-period-range]').innerText(), /Aug 28, 2026 – Sep 10, 2026/);
      assert.match(await savings.innerText(), /350\.00/);
      assert.match(await page.locator('[data-operating-question="07"] summary').innerText(), /0\.00/);
      await savings.click();
      await named.waitFor({ state: 'visible' });
      assert.match(await named.innerText(), /600\.00 \/ \$600\.00/);
      assert.match(await named.innerText(), /Still to set aside after this period\s+\$0\.00/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(screenshots, `routed-${width}-funding-next.png`), fullPage: true });

      data.plan.commitments[0].confidence = 'unknown';
      await page.reload();
      await savings.waitFor();
      assert.match(await savings.innerText(), /Unavailable/);
      assert.equal(await page.locator('[data-plan-spend-earmark]').count(), 0);
      await savings.click();
      assert.match(await named.innerText(), /Named cost/);
      assert.doesNotMatch(await named.innerText(), /\$0\.00/);
      assert.match(await page.locator('[data-operating-question="07"] summary').innerText(), /Before savings/);
      await context.close();
    }
    assert.deepEqual(external, [], 'routed proof must make no provider or external requests');
    assert.deepEqual(errors, []);
    console.log('PASS authenticated production Budget route + App.boot + real Forecast: 1440/390/320 first viewport, Current Balance first, folded payday details below waterfall, 2027 estimate propagation, unknown trust, proposed funding/current-next progress and gap, keyboard/focus/accordion, repeated real touch swipes, no overflow/errors/external requests. All financial JSON is synthetic.');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await new Promise(resolve => { if (server.exitCode != null) resolve(); else server.once('exit', resolve); });
  }
})().catch(error => { console.error(error); process.exit(1); });
