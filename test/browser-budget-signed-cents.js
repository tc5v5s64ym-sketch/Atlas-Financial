'use strict';
// Synthetic full-page proof. Install Playwright outside the checkout and run:
// NODE_PATH=<modules> CHROME_PATH=<Edge/Chromium> PROOF_OUTPUT_DIR=<outside repo>
// node test/browser-budget-signed-cents.js
// Exits nonzero on the unpatched source, while still writing its evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const fixture = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..');
const out = process.env.PROOF_OUTPUT_DIR;
assert.ok(out && path.isAbsolute(out), 'PROOF_OUTPUT_DIR must be an absolute evidence directory outside the checkout');
assert.ok(!path.resolve(out).startsWith(root + path.sep), 'proof output stays outside the checkout');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function dataFor(levy) {
  // Move the invented Aug 14-27 period forward exactly 140 calendar days.
  const data = JSON.parse(JSON.stringify(fixture.served()).replace(/\d{4}-\d{2}-\d{2}/g,
    s => new Date(Date.parse(s + 'T00:00:00Z') + 140 * 86400000).toISOString().slice(0, 10)));
  data.plan.bills.push({ id: 'synthetic-january-levy', label: 'Synthetic January levy',
    frequency: 'monthly', day: 3, amount: levy, confidence: 'confirmed', payingAccount: 'chequing-a' });
  return data;
}
const cases = [
  // Independent fixture identity: 2,600 income - levy - 752.99 household hold.
  { name: 'positive', levy: 0, expected: '$1,847.01' },
  { name: 'zero', levy: 1847.01, expected: '$0.00' },
  { name: 'negative', levy: 5000, expected: '−$3,152.99' },
];

(async () => {
  const files = require('node:child_process').execFileSync('git', ['ls-files', '-z', '--', 'public',
    'scripts/*.js', 'test/fixtures', 'test/proof-source-binding.js',
    'test/browser-budget-signed-cents.js', 'package.json', 'package-lock.json'], { cwd: root })
    .toString().split('\0').filter(Boolean);
  const binding = captureSourceBinding(root, files);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ['--disable-accelerated-2d-canvas'] });
  const failures = [], results = [], screenshots = {}, external = [], errors = [];
  const check = (truth, label) => { if (!truth) failures.push(label); };
  try {
    for (const width of [320, 390, 1440]) for (const theme of ['dark', 'light']) for (const c of cases) {
      const name = `${c.name}-${width}-${theme}`;
      const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript(chosen => localStorage.setItem('hfd-theme', chosen), theme);
      page.on('pageerror', e => errors.push(name + ': ' + e.message));
      const data = dataFor(c.levy);
      await page.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
        if (u.pathname === '/data.json') return route.fulfill({ json: data });
        if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
        const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
        if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
        const bytes = fs.readFileSync(file), relative = path.relative(root, file).split(path.sep).join('/');
        assert.equal(sha256(bytes), binding.files[relative]?.sha256, 'served bytes match bound source: ' + relative);
        const types = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png' };
        return route.fulfill({ body: bytes, contentType: types[path.extname(file)] || 'text/html' });
      });
      await page.goto('http://budget.test/');
      await page.waitForSelector('.blend-hero .blend-bad');
      await page.evaluate(() => document.fonts.ready);
      const read = await page.evaluate(() => {
        const face = document.querySelector('.blend-hero .blend-bad');
        const native = document.querySelector('ol[data-bad-timeline]>[data-bad-timeline-start="2027-01-01"] [data-bad-term-amount]');
        const dollars = face.querySelector('.blend-dollars'), prefix = face.querySelector('.blend-term-prefix');
        const rect = el => el && { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y,
          width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height };
        const hatches = [...document.querySelectorAll('.budget-waterfall-track.is-unknown')].map(el => ({
          class: el.className, image: getComputedStyle(el).backgroundImage, rect: rect(el) }));
        // A CSS-only unknown-track control: the same native hatch selector,
        // with a box so its unchanged paint can be captured independently.
        const control = document.createElement('div');
        control.className = 'budget-waterfall-track is-unknown';
        control.style.cssText = 'display:block;width:240px;height:12px;margin:12px';
        control.dataset.signedCentsHatchControl = '';
        document.body.appendChild(control);
        return { native: native?.textContent, text: face.textContent, dollars: dollars?.textContent,
          prefix: prefix?.textContent || '', face: rect(face), dollarRect: rect(dollars), prefixRect: rect(prefix),
          color: getComputedStyle(dollars || face).color, heroBackground: getComputedStyle(face.closest('.blend-hero')).backgroundColor,
          hatches, hatchControl: getComputedStyle(control).backgroundImage,
          range: document.querySelector('.blend-hero-range')?.textContent.replace(/\s+/g, ' ').trim() };
      });
      check(read.native === c.expected, name + ': independent fixture amount');
      check(read.text === c.expected, name + ': visible text equals unchanged native amount');
      check(read.dollars === c.expected.slice(0, -3), name + ': sign grouped with dollar digits');
      check(read.prefix === '', name + ': no isolated minus prefix');
      check(read.range.includes('Jan 1') && read.range.includes('Jan 14'), name + ': reported January range');
      check(read.hatchControl.includes('repeating-linear-gradient'), name + ': unknown hatch retained');
      check(read.color === (c.name === 'negative' ? (theme === 'dark' ? 'rgb(224, 82, 82)' : 'rgb(199, 55, 55)')
        : theme === 'dark' ? 'rgb(245, 246, 248)' : 'rgb(11, 12, 16)'), name + ': original readable amount color');
      if (width === 390 && c.name === 'negative') {
        const file = name + '.png';
        await page.locator('.blend-hero').screenshot({ path: path.join(out, file), animations: 'disabled' });
        screenshots[file] = sha256(fs.readFileSync(path.join(out, file)));
        const hatchFile = 'hatch-' + theme + '.png';
        await page.locator('[data-signed-cents-hatch-control]').screenshot({ path: path.join(out, hatchFile) });
        screenshots[hatchFile] = sha256(fs.readFileSync(path.join(out, hatchFile)));
      }
      results.push({ name, ...read });
      await page.close();
    }
    check(external.length === 0, 'no external requests');
    check(errors.length === 0, 'no page errors');
    verifySourceBinding(root, binding);
    const receipt = { binding, runtime: { node: process.version, browser: await browser.version(),
      playwright: require('playwright-core/package.json').version, renderer: 'headless Edge; --disable-accelerated-2d-canvas' },
      results, screenshots, external, errors, failures, unchangedAfterRun: true,
      status: failures.length ? 'FAIL' : 'PASS',
      limits: 'Synthetic local intercepted full Budget HTML. Unknown hatch also exercised as an explicit CSS control. No original report screenshot, signed-in/live site, provider or physical-device proof.' };
    fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ status: receipt.status, cases: results.length, failures, external, errors }));
    process.exitCode = failures.length ? 1 : 0;
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
