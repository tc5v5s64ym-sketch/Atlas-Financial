'use strict';
// Real App.boot and unchanged bar painter; all requests receive invented data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const cp = require('node:child_process'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const O = require('../scripts/provider-observe'), provider = require('./fixtures/savings-v2-observation-data');
const consumer = require('./fixtures/savings-daily-consumer-data');
const transferCutoffs = require('./fixtures/savings-transfer-cutoffs');
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public');
const output = process.env.ATLAS_LATEST_SAVINGS_PROOF || path.join(require('node:os').tmpdir(), 'atlas-latest-savings-browser');
const files = cp.execFileSync('git', ['ls-files', '-z', '--', 'public', 'scripts/provider-observe.js',
  'test/fixtures/savings-v2-observation-data.js', 'test/fixtures/savings-daily-consumer-data.js',
  'test/fixtures/savings-daily-allocation-contract.js', 'test/fixtures/budget-funding-data.js',
  'test/fixtures/savings-transfer-cutoffs.js',
  'test/browser-savings-latest-known-allocation.js', 'test/proof-source-binding.js'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const binding = captureSourceBinding(root, files, process.env.PROOF_BASE_SHA || null);
fs.mkdirSync(output, { recursive: true });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function input(mode) {
  if (mode.startsWith('cutoff-')) {
    const input = transferCutoffs(mode.slice('cutoff-'.length)), data = consumer('ready');
    data.meta.asOf = input.asOf; data.plan = input.plan;
    data.liveOverlay = { applied: true, operatingPlan: 'live', currentPeriodActuals: input.opts.currentPeriodActuals,
      observedCash: { asOf: input.asOf, complete: true, accounts: input.plan.startingCash.breakdown
        .filter(row => row.id.startsWith('chequing')).map(row => ({ ...row, evidenceDate: input.asOf })) } };
    return data;
  }
  if (mode === 'prior-check-day') {
    const data = provider.served('prior-household-day', O).data;
    data.meta.asOf = data.plan.opening.asOf = '2026-10-07';
    return data;
  }
  if (mode === 'full-dated') {
    const data = consumer('fully-backed');
    data.plan.savingsPoolObservation.accounts.forEach(row => { row.evidenceDate = '2026-10-04'; });
    return data;
  }
  return provider.served(mode, O).data;
}
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  const errors = [], external = [], writes = [], cases = [], served = {};
  try {
    const selected = process.env.ATLAS_LATEST_SAVINGS_CASES?.split(',');
    for (const [mode, width, theme, expected, bands] of [
      ['stale-date', 390, 'light', [95, 24], ['is-amber', 'is-full']],
      ['stale-both', 390, 'light', [95, 24], ['is-amber', 'is-full']],
      ['prior-household-day', 320, 'dark', [95, 24], ['is-amber', 'is-full']],
      ['prior-check-day', 390, 'light', [95, 24], ['is-amber', 'is-full']],
      ['cutoff-double-count', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['cutoff-inverse', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['cutoff-both-before', 390, 'light', [76, 24], ['is-amber', 'is-full']],
      ['cutoff-both-after', 390, 'light', [76, 24], ['is-amber', 'is-full']],
      ['cutoff-unrelated-mixed', 390, 'light', [95, 24], ['is-amber', 'is-full']],
      ['cutoff-zero', 390, 'light', [0, 0], ['is-red', 'is-red']],
      ['cutoff-duplicate', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['cutoff-hint-only', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['cutoff-invalid-reference', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['cutoff-missing-reference', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['blocked-prior-day', 390, 'light', [95, 24], ['is-amber', 'is-full']],
      ['withdrawal-stale', 390, 'light', [39.02, 0], ['is-red', 'is-red']],
      ['zero-stale', 390, 'light', [0, 0], ['is-red', 'is-red']],
      ['full-dated', 390, 'light', [230, 24], ['is-full', 'is-full']],
      ['pending-movement', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
      ['future-date', 390, 'light', [null, null], ['is-unknown', 'is-unknown']],
    ].filter(row => !selected || selected.includes(row[0]))) {
      const data = input(mode), inputHash = hash(JSON.stringify(data));
      const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      page.setDefaultTimeout(20000);
      await page.addInitScript(({ theme }) => {
        localStorage.setItem('hfd-plan-knobs-v1', JSON.stringify({ weeklyVariable: 40 }));
        localStorage.setItem('hfd-theme', theme);
      }, { theme });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (request.method() !== 'GET') { writes.push(request.method()); return route.abort(); }
        if (url.origin !== 'http://latest-savings.test') { external.push(url.origin); return route.abort(); }
        if (url.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
        const file = path.resolve(assets, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
        if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const bytes = fs.readFileSync(file), relative = path.relative(root, file).replace(/\\/g, '/');
        assert.equal(binding.files[relative]?.sha256, hash(bytes), 'served bytes match committed sources');
        served[relative] = hash(bytes);
        return route.fulfill({ body: bytes, contentType: file.endsWith('.js') ? 'application/javascript'
          : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html' });
      });
      await page.goto('http://latest-savings.test/');
      await page.locator('[data-budget-savings-goals] .blend-g-bar').first().waitFor();
      const result = await page.evaluate(() => {
        const card = document.querySelector('[data-budget-savings-goals]');
        return { rows: [...card.querySelectorAll('[data-budget-savings-goal]')].map(row => ({
          key: row.dataset.budgetSavingsGoal, saved: row.getAttribute('data-budget-goal-saved-amount'),
          needed: row.getAttribute('data-budget-goal-required-amount') })),
          bars: [...card.querySelectorAll('.blend-g-bar')].map(bar => ({ classes: bar.className,
            width: bar.style.getPropertyValue('--w'), fill: getComputedStyle(bar, '::before').backgroundColor })),
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
          source: JSON.stringify(App.data), text: card.innerText };
      });
      assert.deepEqual(result.rows.map(row => row.saved), expected.map(value => value == null ? null : String(value)), mode + ': Forecast Saved stamps');
      assert.deepEqual(result.rows.map(row => row.needed), ['230', '24']);
      assert.equal(result.bars.length, 2);
      result.bars.forEach((bar, i) => assert.ok(bar.classes.includes(bands[i]), mode + ': existing painter band'));
      assert.equal(result.noOverflow, true);
      assert.equal(hash(result.source), inputHash, 'App input is unchanged');
      const filename = mode + '-' + width + '-' + theme + '.png';
      await page.locator('[data-budget-savings-goals]').screenshot({ path: path.join(output, filename), animations: 'disabled' });
      const summary = page.locator('[data-operating-question="savings"] > details > summary');
      await summary.focus(); await page.keyboard.press('Enter');
      const body = page.locator('[data-budget-detail-body]');
      await page.locator('[data-budget-detail-sheet]').waitFor({ state: 'visible' });
      if (mode !== 'cutoff-both-after') assert.match(await body.locator('[data-budget-daily-proposal]').innerText(), /Unavailable/);
      if (mode.startsWith('cutoff-') && expected[0] == null) {
        await body.locator('[data-budget-savings-info] > summary').click();
        assert.match(await body.innerText(), /Saved allocation is withheld/);
        assert.match(await body.locator('[data-budget-savings-total-needed]').first().innerText(), /230\.00/);
        assert.match(await body.locator('[data-budget-savings-total-saved]').first().innerText(), /Unavailable/);
      }
      if (expected[0] != null) {
        await body.locator('[data-budget-savings-info] > summary').click();
        assert.match(await body.innerText(), /Latest reported balances checked/);
        if (mode === 'prior-check-day') {
          assert.match(await body.innerText(), /Latest reported balances checked 2026-10-06/);
          const earlier = body.locator('[data-budget-savings-legacy-evidence]');
          await earlier.locator(':scope > summary').click();
          assert.match(await earlier.innerText(), /Observed 2026-10-05/);
          assert.match(await earlier.innerText(), /Balance dates are separate from the observation check date/);
          assert.doesNotMatch(await earlier.innerText(), /today's observation date/);
        }
      }
      await page.keyboard.press('Escape');
      assert.equal(await summary.evaluate(el => el === document.activeElement), true);
      cases.push({ mode, width, theme, rows: result.rows, bars: result.bars, noOverflow: true,
        topUpHeld: mode !== 'cutoff-both-after', focusRestored: true, inputSha256: inputHash,
        screenshot: filename, screenshotSha256: hash(fs.readFileSync(path.join(output, filename))) });
      await page.close(); console.log('PASS latest Saved browser: ' + mode + ' ' + width + 'px');
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
    verifySourceBinding(root, binding);
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ outcome: 'PASS', browser: await browser.version(),
      sourceBinding: binding, servedSources: served, syntheticOnly: true, cases, errors, external, writes }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
