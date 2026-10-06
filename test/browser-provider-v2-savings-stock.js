'use strict';
// Optional real-page proof; intercepted independent v2 observations, no login/server.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), { chromium } = require('playwright');
const root = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const O = require(path.join(root, 'scripts/provider-observe'));
const fx = require('./fixtures/savings-v2-observation-data');
const output = process.env.ATLAS_V2_STOCK_PROOF || path.join(require('node:os').tmpdir(), 'atlas-v2-stock');
const executionHead = cp.execFileSync('git', ['-c', 'safe.directory=' + root.replace(/\\/g, '/'),
  'rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const known = new Set(['valid-v2', 'legacy-date', 'offset-date', 'calendar-date', 'v2-over-update', 'sender-unknown', 'pending-movement']);
const modes = ['valid-v2', 'legacy-date', 'offset-date', 'calendar-date', 'v2-over-update', 'sender-unknown',
  'stale-date', 'future-date', 'malformed-date', 'malformed-type', 'impossible-date',
  'missing-date', 'sync-only', 'foreign-currency', 'missing-account', 'duplicate-account', 'pending-movement'];
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [], external = [], cases = [];
  try {
    for (const width of [1440, 390, 320]) for (const mode of modes) {
      const { data } = fx.served(mode, O), before = JSON.stringify(data);
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await page.addInitScript(() => localStorage.setItem('hfd-plan-knobs-v1', JSON.stringify({ weeklyVariable: 40 })));
      page.on('pageerror', e => errors.push(e.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://v2-stock.test') { external.push(url.origin); return route.abort(); }
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.resolve(root, 'public', '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css'
          : file.endsWith('.js') ? 'application/javascript' : 'text/html' });
      });
      await page.goto('http://v2-stock.test/');
      const summary = page.locator('[data-operating-question="savings"] > details > summary');
      await summary.waitFor();
      const stock = summary.locator('.budget-step-value');
      await page.locator('.budget-surface-period').screenshot({ path: path.join(output, mode + '-overview-' + width + '.png'),
        animations: 'disabled', style: '.sitenav-household{visibility:hidden!important}' });
      assert.equal(await stock.innerText(), known.has(mode) ? '$119.00' : 'Unavailable', mode + ': active observed stock');
      assert.equal(await page.locator('[data-budget-period-result]').count(), 1, 'one final balance');
      assert.equal(await page.locator('[data-live-current-balance-amount]').count(), 1, 'one Current Balance');
      const proposal = page.locator('[data-budget-funding-panel="today"] [data-budget-funding-proposal]');
      if (mode === 'sender-unknown') {
        assert.equal(await page.locator('[data-operating-question="07"] .budget-step-value').innerText(), 'Unavailable');
        assert.equal(await proposal.innerText(), 'Unavailable');
      }
      if (!known.has(mode) || mode === 'pending-movement') assert.equal(await proposal.innerText(), 'Unavailable');
      if (mode === 'valid-v2') assert.match(await proposal.innerText(), /^calculated\s+\$80\.00$/,
        'independent preexisting ledger entitlement retains calculated trust');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
      await summary.focus(); await page.keyboard.press('Enter');
      const dialog = page.locator('[data-budget-detail-sheet]');
      await dialog.waitFor({ state: 'visible' });
      const body = page.locator('[data-budget-detail-body]');
      const info = body.locator('[data-budget-savings-info] > summary');
      await info.focus(); await page.keyboard.press('Enter');
      assert.match(await body.innerText(), /Only matched settled transfers/);
      await page.screenshot({ path: path.join(output, mode + '-evidence-' + width + '.png'), animations: 'disabled' });
      await page.keyboard.press('Escape');
      assert.equal(await summary.evaluate(el => el === document.activeElement), true, 'exact Savings trigger focus restoration');
      assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before, 'browser input unchanged');
      cases.push({ mode, width, stockReady: known.has(mode), keyboardFocusRestored: true, noOverflow: true, inputUnchanged: true });
      await page.close();
      if (cases.length % modes.length === 0) console.log('PASS v2-stock ' + width + 'px: ' + modes.length + ' raw observer/Forecast/browser cases');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({
      executionHead, syntheticOnly: true, productionCredentialsUsed: false, cases, errors, external }, null, 2));
    console.log('PASS v2 observer -> Forecast -> active Budget browser: ' + cases.length + ' cases; unknowns and keyboard/focus preserved');
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
