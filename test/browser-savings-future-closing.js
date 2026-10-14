'use strict';
// Real selector and renderer proof. Only invented inputs, intercepted GETs.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const crypto = require('node:crypto'), cp = require('node:child_process');
const { chromium } = require('playwright');
const fixture = require('./fixtures/savings-future-closing-data');
const shell = require('./fixtures/savings-daily-consumer-data');
const root = path.resolve(__dirname, '..'), assets = path.join(root, 'public');
const out = process.env.ATLAS_FUTURE_SAVINGS_PROOF || path.join(require('node:os').tmpdir(), 'atlas-future-savings-proof');
fs.mkdirSync(out, { recursive: true });
const cases = [], errors = [], external = [], writes = [], served = new Map();
const hash = body => crypto.createHash('sha256').update(body).digest('hex');
async function step(page, direction) {
  const before = await page.locator('[data-budget-window-progress]').getAttribute('data-start');
  await page.locator('.river').focus();
  await page.keyboard.press(direction > 0 ? 'ArrowRight' : 'ArrowLeft');
  await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start !== start, before);
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try { for (const width of [1440, 390, 320]) for (const mode of ['ready', 'group', 'installments', 'expense', 'unknown']) {
    const x = fixture(), data = shell('ready'); data.meta.asOf = x.asOf; data.plan = x.plan;
    data.plan.groups = [];
    if (mode === 'group') { data.plan.groups = [{ id: 'shared', label: 'Invented shared group', planSpendSummary: true }];
      data.plan.commitments.forEach(c => { c.group = 'shared'; }); }
    if (mode === 'installments') {
      data.plan.groups = [{ id: 'installments', label: 'Invented installment group', planSpendSummary: true }];
      data.plan.commitments = [
        { id: 'one', label: 'Invented installment one', group: 'installments', date: '2026-10-29', amount: 80, confidence: 'confirmed', sinkingFund: true },
        { id: 'two', label: 'Invented installment two', group: 'installments', date: '2026-11-12', amount: 60, confidence: 'confirmed', sinkingFund: true },
        { id: 'later', label: 'Invented later requirement', date: '2027-01-04', amount: 3000, confidence: 'confirmed', sinkingFund: true }];
    }
    if (mode === 'expense') { data.plan.commitments[0].date = '2026-11-03'; data.plan.commitments[0].amount = 80; }
    if (mode === 'unknown') delete x.opts.currentPeriodActuals;
    data.liveOverlay = { applied: true, operatingPlan: 'live', ...x.opts,
      observedCash: { asOf: x.asOf, complete: true, accounts: data.plan.startingCash.breakdown
        .filter(r => r.id.startsWith('chequing')).map(r => ({ ...r, evidenceDate: x.asOf })) } };
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => localStorage.setItem('hfd-plan-knobs-v1', JSON.stringify({ weeklyVariable: 0 })));
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://future-savings.test') { external.push(url.origin); return route.abort(); }
      if (route.request().method() !== 'GET') { writes.push(route.request().method()); return route.abort(); }
      if (url.pathname === '/data.json') return route.fulfill({ json: data });
      if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
      const file = path.resolve(assets, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(assets + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      const body = fs.readFileSync(file); served.set(path.relative(root, file).replaceAll('\\', '/'), hash(body));
      return route.fulfill({ body, contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    });
    await page.goto('http://future-savings.test/');
    const tile = page.locator('[data-budget-savings-goals]'); await tile.waitFor();
    const current = await tile.innerText(), before = await page.evaluate(() => JSON.stringify(App.data));
    assert.doesNotMatch(current, /Forecast Savings at close/);
    await step(page, 1);
    const first = await tile.innerText(); assert.match(first, /Forecast Savings at close/);
    if (mode === 'unknown') assert.match(first, /Unavailable/);
    else if (mode === 'installments') {
      assert.match(first, /1,039\.00/); assert.match(first, /Invented installment two/i);
      assert.doesNotMatch(first, /Invented installment one/i);
    } else assert.match(first, /1,119\.00/);
    await step(page, 1);
    const second = await tile.innerText();
    if (mode === 'ready' || mode === 'group') { assert.match(second, /2,119\.00/); assert.match(second, /1,500\.00/); assert.match(second, /619\.00/); }
    if (mode === 'expense') { assert.match(second, /2,039\.00/); assert.doesNotMatch(second, /Invented first goal/i); }
    if (mode === 'installments') { assert.match(second, /1,979\.00/); assert.doesNotMatch(second, /Invented installment/i); }
    if (mode === 'unknown') assert.match(second, /Unavailable/);
    await tile.locator('[data-budget-funding-inventory]').focus(); await page.keyboard.press('Enter');
    const dialog = page.locator('[data-budget-detail-sheet]'); await dialog.waitFor({ state: 'visible' });
    const info = dialog.locator('[data-budget-savings-info] > summary');
    if (!await info.evaluate(node => node.parentElement.open)) await info.click();
    await dialog.locator('[data-savings-inventory]').waitFor({ state: 'visible' });
    await dialog.locator('[data-savings-inventory] > details > summary').click();
    const inventory = await dialog.locator('[data-savings-inventory]').innerText();
    assert.match(inventory, /Forecast combined savings at close/);
    assert.match(inventory, /Actual future balances/);
    if (mode === 'ready' || mode === 'group') assert.match(inventory, /2,119\.00/);
    if (mode === 'group') { assert.match(inventory, /1,500\.00/); assert.match(inventory, /619\.00/); }
    if (mode === 'expense') assert.match(inventory, /2,039\.00/);
    if (mode === 'installments') { assert.match(inventory, /1,979\.00/); assert.doesNotMatch(inventory, /Invented installment/i); }
    if (mode === 'unknown') assert.match(inventory, /Unknown/);
    await dialog.screenshot({ path: path.join(out, `${mode}-${width}.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await step(page, -1); await step(page, -1); assert.equal(await tile.innerText(), current);
    await step(page, 1); await step(page, 1); assert.equal(await tile.innerText(), second);
    await page.evaluate(() => App.rerender()); assert.equal(await tile.innerText(), second);
    assert.equal(await page.evaluate(() => JSON.stringify(App.data)), before);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    cases.push({ width, mode, first, second, inventory, replay: true, currentRestored: true, immutable: true });
    console.log('PASS ' + mode + ' ' + width); await page.close();
  } } finally { await browser.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
  const head = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ head, synthetic: true, cases,
    served: Object.fromEntries(served), errors, external, writes }, null, 2) + '\n');
})().catch(e => { console.error(e); process.exitCode = 1; });
