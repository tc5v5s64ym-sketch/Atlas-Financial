'use strict';
// Real App.boot, intercepted synthetic data, exact current-main asset control.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { execFileSync } = require('node:child_process'), { createHash } = require('node:crypto');
const { chromium } = require('playwright'), fx = require('./fixtures/other-period-target');
const root = path.join(__dirname, '..'), base = 'c1d8c155552d87bc93aa0425147f1a00570146a9';
const out = process.env.ATLAS_HOUSEHOLD_DELTA_PROOF_DIR || path.join(require('node:os').tmpdir(), 'atlas-household-total-copy-proof');
fs.mkdirSync(out, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const sources = {}, results = [], screenshots = [], errors = [], external = [], writes = [];
const cases = [
  ['under', 137.26, {}, '$248 / $925', '$678 left'],
  ['zero', 814.63, {}, '$925 / $925', '$0 left'],
  ['over', 1034.19, {}, '$1,145 / $925', '$220 over'],
  ['cent-over', 815.63, {}, '$926 / $926', '$1 over'],
  ['missing', 137.26, {}, 'Unknown / $925', 'Remaining unavailable'],
  ['pending-gap', 137.26, { pendingCoverage: 'unknown' }, '$248* / $925', 'Remaining unavailable'],
  ['estimated-pending', 137.26, { pendingOther: 17.43 }, '≈ $266 / $925', '≈ $660 left'],
  ['future', 137.26, {}, 'Unknown / ≈ $925', 'Remaining unavailable'],
  ['history', 137.26, {}, '$248 / Unknown', 'Remaining unavailable'],
];
const cache = new Map();
function asset(relative, variant) {
  const key = variant + ':' + relative;
  if (!cache.has(key)) cache.set(key, variant === 'before'
    ? execFileSync('git', ['show', base + ':' + relative], { cwd: root, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
    : fs.readFileSync(path.join(root, relative)));
  const bytes = cache.get(key);
  sources[key] = sha(/\.(?:js|css|html|json)$/.test(relative) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
  return bytes;
}
async function snapshot(page) {
  return page.evaluate(() => {
    const section = document.querySelector('[data-budget-browse="spending"]'), totals = section.querySelector('.blend-house-totals');
    const ratio = totals.querySelector('[data-budget-ratio]'), delta = totals.querySelector('[data-budget-household-delta]');
    const shown = node => { if (!node) return null; const copy = node.cloneNode(true); copy.querySelectorAll('.budget-cash-sr').forEach(n => n.remove()); return copy.textContent.replace(/\s+/g, ' ').trim(); };
    const pseudo = selector => { const style = getComputedStyle(ratio.querySelector(selector), '::before'); return { content: style.content, clip: style.clipPath, width: style.width, height: style.height }; };
    const rings = [...section.querySelectorAll('[data-blend-cat]')].map(node => ({ id: node.dataset.blendCat,
      // The incumbent wave phase follows each page's clock, not a money value.
      label: node.getAttribute('aria-label'), html: node.innerHTML.replace(/--blend-wave-phase: -?[\d.]+s/g, '--blend-wave-phase: page-clock'),
      style: node.getAttribute('style'), class: node.className }));
    const probe = document.createElement('span'); probe.style.color = 'var(--critical)'; document.body.append(probe);
    const red = getComputedStyle(probe).color; probe.remove();
    return { pair: shown(ratio), delta: shown(delta), deltaVisible: !!delta && !delta.hidden,
      deltaColor: delta ? getComputedStyle(delta).color : null, red,
      actualPrefix: pseudo('[data-budget-ratio-actual]'), planPrefix: pseudo('[data-budget-ratio-plan]'),
      rings, overflow: document.documentElement.scrollWidth > innerWidth,
      cards: document.querySelector('[data-budget-card-movements]')?.outerHTML,
      savings: document.querySelector('[data-budget-browse="savings"]')?.outerHTML };
  });
}
async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  try {
    for (const width of [1440, 320]) for (const theme of ['light', 'dark']) for (const [state, other, opts, expectedPair, expectedDelta] of cases) {
      const f = fx.build(other, state === 'history' ? '2026-10-18' : fx.asOf, opts);
      if (state === 'cent-over') f.plan.budget.categories.find(row => row.id === 'groceries').plannedPayday = 220.99;
      if (state === 'missing') f.packet.transactionCoverage = 'truncated';
      const input = JSON.stringify(f), readings = {};
      for (const variant of ['before', 'after']) {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: 'reduce' });
        await page.addInitScript(t => localStorage.setItem('hfd-theme', t), theme);
        page.on('pageerror', e => errors.push({ state, variant, error: e.message }));
        await page.route('**/*', route => {
          const request = route.request(), u = new URL(request.url());
          if (request.method() !== 'GET') { writes.push(u.pathname); return route.abort(); }
          if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
          if (u.pathname === '/data.json') return route.fulfill({ json: f.data });
          if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
          const relative = 'public/' + (u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
          const extension = path.extname(relative), type = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' }[extension] || 'text/html';
          try { return route.fulfill({ body: asset(relative, variant), contentType: type }); }
          catch { return route.fulfill({ status: 404, body: '' }); }
        });
        await page.goto('http://budget.test/'); await page.locator('[data-budget-surface]').waitFor();
        // The blend river hides this native control; use its incumbent handler
        // for selected-period fixtures, without claiming a navigation proof.
        if (state === 'future' || state === 'history') await page.locator(`[data-budget-window-step="${state === 'future' ? 1 : -1}"]`).evaluate(button => button.click());
        await page.locator('.blend-house-totals').waitFor(); await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const data = await snapshot(page);
        data.accessiblePair = await page.locator('.blend-house-totals [data-budget-browse-hold]').ariaSnapshot();
        const trigger = page.locator('[data-operating-question="06"] > details > summary');
        await trigger.focus(); await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-budget-detail-sheet]')?.open);
        data.sheet = await page.locator('[data-budget-detail-body]').innerHTML();
        await page.keyboard.press('Escape');
        if (variant === 'after') {
          assert.equal(data.pair, expectedPair, state + ' preserves published pair/qualifiers and order');
          assert.equal(data.delta, '· ' + expectedDelta, state + ' prints exact-source delta with whole-dollar ceiling');
          assert.equal(data.deltaVisible, true); assert.equal(data.overflow, false);
          assert.equal(data.actualPrefix.clip, 'inset(50%)'); assert.equal(data.planPrefix.clip, 'inset(50%)');
          assert.equal(data.actualPrefix.width, '1px'); assert.equal(data.planPrefix.width, '1px');
          if (state.includes('over')) assert.equal(data.deltaColor, data.red, 'over uses established critical red');
          assert.doesNotMatch(data.delta, /-\$0/);
          for (const key of ['pair', 'accessiblePair', 'rings', 'sheet', 'cards', 'savings']) assert.deepEqual(data[key], readings.before[key], key + ' unchanged: ' + state);
          if (width === 320 && ['under', 'zero', 'cent-over', 'missing', 'estimated-pending'].includes(state)) {
            const name = `household-${state}-${width}-${theme}.png`, file = path.join(out, name);
            await page.locator('[data-budget-browse="spending"]').screenshot({ path: file, animations: 'disabled' });
            screenshots.push({ name, sha256: sha(fs.readFileSync(file)) });
          }
          results.push({ state, width, theme, pair: data.pair, delta: data.delta, sheetSha256: sha(data.sheet), ringsSha256: sha(JSON.stringify(data.rings)) });
        }
        readings[variant] = data; await page.close();
      }
      assert.equal(JSON.stringify(f), input, 'browser proof cannot mutate synthetic evidence');
      console.log('PASS ' + [state, width, theme].join(' '));
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(writes, []);
    const receipt = { base, source: 'synthetic App.boot before/after', results, sources, screenshots, errors, external, writes };
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(receipt, null, 2));
    console.log('PASS Household total delta: ' + results.length + ' cases; proof ' + path.join(out, 'proof.json'));
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
