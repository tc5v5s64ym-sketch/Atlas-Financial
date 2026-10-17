'use strict';
// Full native Month navigation with invented served-plan fixtures. Separate
// native component-renderer controls exercise negative/unavailable publication
// records. No live data, credentials, provider calls or money calculation here.
// NODE_PATH=<external modules> CHROME_PATH=<Edge> PROOF_OUTPUT_DIR=<outside repo>
// [PROOF_BASELINE=<before receipt>] node test/browser-budget-month-contrast.js
const fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const { serializeReceipt } = require('./lib/month-contrast-receipt');
const fixture = require('./fixtures/budget-surface-data');
const root = path.join(__dirname, '..'), out = process.env.PROOF_OUTPUT_DIR;
assert.ok(out && path.isAbsolute(out) && !path.resolve(out).startsWith(root + path.sep), 'Evidence directory must be absolute and outside the checkout');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const rgb = text => text.match(/[\d.]+/g).slice(0, 3).map(Number);
const luminance = color => color.map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

function dataFor(key) {
  const data = fixture.served();
  if (key === 'calculated') for (const rows of [data.plan.income, data.plan.bills, data.plan.obligations,
    data.plan.commitments, data.plan.budget.categories]) rows.forEach(row => { row.confidence = 'confirmed'; });
  if (key === 'large') {
    data.plan.income.forEach(row => { row.amount = 1234567.89; });
    data.plan.bills.forEach(row => { row.amount = 123456.78; });
  }
  if (key === 'hero-control') {
    const shifted = JSON.parse(JSON.stringify(data).replace(/\d{4}-\d{2}-\d{2}/g,
      s => new Date(Date.parse(s + 'T00:00:00Z') + 140 * 86400000).toISOString().slice(0, 10)));
    delete shifted.liveOverlay; delete shifted.refreshTrust; delete shifted.plan.opening.paydaySnapshot;
    shifted.plan.opening.representedEvents = []; shifted.plan.opening.notReliedUponEvents = [];
    shifted.plan.income = [{ id: 'payroll', label: 'Synthetic Seaspan payroll', frequency: 'biweekly',
      anchor: '2027-01-01', amount: 4444.44, confidence: 'confirmed' }];
    shifted.plan.bills = [{ id: 'synthetic-levy', label: 'Synthetic levy', frequency: 'monthly', day: 3,
      amount: 1234567.89, confidence: 'confirmed', payingAccount: 'chequing-a' }];
    shifted.plan.obligations = []; shifted.plan.commitments = [];
    shifted.plan.budget.categories = [100.01, 200.02, 300.03].map((amount, i) => ({
      id: ['groceries', 'fuel', 'restaurants'][i], label: 'Synthetic category ' + i,
      class: 'essential', from: [], plannedPayday: amount, confidence: 'confirmed' }));
    return shifted;
  }
  return data;
}

(async () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'public', 'scripts/*.js', 'test/fixtures',
    'test/browser-budget-month-contrast.js', 'test/lib/month-contrast-receipt.js', 'test/proof-source-binding.js', 'package.json', 'package-lock.json'],
  { cwd: root }).toString().split('\0').filter(Boolean);
  const binding = captureSourceBinding(root, files);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true,
    args: ['--disable-accelerated-2d-canvas'] });
  const failures = [], records = [], heroes = [], screenshots = {}, errors = [], external = [];
  const check = (truth, label) => { if (!truth) failures.push(label); };
  const settle = page => page.evaluate(async () => { await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  try {
    for (const width of [320, 390, 1440]) for (const theme of ['dark', 'light']) {
      for (const key of ['estimated', 'calculated', 'large', 'hero-control']) {
        const id = `${key}-${width}-${theme}`;
        console.log('Render ' + id);
        const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1,
          colorScheme: theme, reducedMotion: 'reduce' });
        await page.addInitScript(chosen => localStorage.setItem('hfd-theme', chosen), theme);
        const data = dataFor(key);
        page.on('pageerror', error => errors.push(id + ': ' + error.message));
        await page.route('**/*', route => {
          const u = new URL(route.request().url());
          if (u.origin !== 'http://month.test') { external.push(u.origin); return route.abort(); }
          if (u.pathname === '/data.json') return route.fulfill({ json: data });
          if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) return route.fulfill({ json: null });
          const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
          if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          const bytes = fs.readFileSync(file), relative = path.relative(root, file).split(path.sep).join('/');
          assert.equal(sha256(bytes), binding.files[relative]?.sha256, 'served bytes match source: ' + relative);
          const types = { '.css': 'text/css', '.js': 'application/javascript', '.woff2': 'font/woff2', '.png': 'image/png' };
          return route.fulfill({ body: bytes, contentType: types[path.extname(file)] || 'text/html' });
        });
        await page.goto('http://month.test/');
        await page.waitForSelector('[data-blend-figures-open]');
        await settle(page);
        if (key === 'hero-control') {
          const state = await page.evaluate(() => {
            const face = document.querySelector('.blend-hero .blend-bad'), hero = face.closest('.blend-hero');
            const rect = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
            return { text: face.textContent, dollars: face.querySelector('.blend-dollars').textContent,
              hero: rect(hero), parts: [...face.querySelectorAll('.blend-dollars,.blend-cents')].map(rect),
              protected: [...face.closest('.budget-step-value').querySelectorAll('.blend-clip,.blend-est')].map(el => el.outerHTML) };
          });
          check(state.text === '−$1,230,723.51' && state.dollars === '−$1,230,723', id + ': PR636 exact sign and cents retained');
          check(state.parts.every(b => b.left >= state.hero.left && b.right <= state.hero.right), id + ': PR636 complete amount remains inside hero');
          heroes.push({ id, ...state });
          if (width === 390 && theme === 'dark') {
            const file = id + '.png';
            await page.locator('.blend-hero').screenshot({ path: path.join(out, file), animations: 'disabled' });
            screenshots[file] = sha256(fs.readFileSync(path.join(out, file)));
          }
          await page.close(); continue;
        }
        await page.locator('[data-blend-figures-open]').click();
        await page.locator('dialog[open] [data-budget-granularity="month"]').click();
        await page.waitForSelector('.budget-v3-month');
        await page.evaluate(() => {
          const rows = document.querySelector('[data-budget-month-section-target="flow"] .budget-month-rows');
          // Direct published-contract controls run the actual incumbent row
          // renderer. They are not injected Forecast inputs or engine proof.
          for (const [label, record] of [
            ['Signed control', { amount: -12.34, status: 'calculated' }],
            ['Unavailable control', { amount: null, status: 'unavailable', reason: 'Synthetic source unavailable.' }],
          ]) {
            const wrap = document.createElement('div'); wrap.className = 'budget-v3-month-component';
            wrap.dataset.monthContrastControl = label;
            wrap.innerHTML = budgetMonthComponentRow(label, record, false); rows.appendChild(wrap);
          }
        });
        await settle(page);
        const card = page.locator('[data-budget-month-section-target="flow"]');
        const png = await card.screenshot({ animations: 'disabled' });
        const state = await card.evaluate(card => {
          const cb = card.getBoundingClientRect();
          const box = b => ({ x: b.x - cb.x, y: b.y - cb.y, width: b.width, height: b.height });
          return { background: getComputedStyle(card).backgroundColor, backgroundImage: getComputedStyle(card).backgroundImage,
            card: { width: cb.width, height: cb.height }, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth,
            rows: [...card.querySelectorAll('.budget-month-row')].map(row => {
              const amount = row.querySelector('.budget-month-amount');
              const ranges = [];
              if (amount) {
                const walker = document.createTreeWalker(amount, NodeFilter.SHOW_TEXT); let node;
                while ((node = walker.nextNode())) if (!node.parentElement.closest('.trust-tag') && node.textContent.trim()) {
                  const range = document.createRange(); range.selectNodeContents(node);
                  for (const b of range.getClientRects()) ranges.push(box(b));
                }
              }
              return { label: row.querySelector('.budget-month-label').textContent, text: row.textContent, html: row.outerHTML,
                amount: amount?.textContent || null, foreground: amount ? getComputedStyle(amount).color : null,
                amountBox: amount ? box(amount.getBoundingClientRect()) : null, rowBox: box(row.getBoundingClientRect()), ranges,
                trust: [...row.querySelectorAll('.trust-tag')].map(el => ({ html: el.outerHTML, color: getComputedStyle(el).color,
                  background: getComputedStyle(el).backgroundColor })),
                outflow: amount?.querySelector('[aria-label="outflow"]')?.outerHTML || null,
                unavailable: row.querySelector('.budget-month-unavailable')?.outerHTML || null };
            }) };
        });
        const pixels = await page.evaluate(async ({ png, areas, background }) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
          const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
          const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
          const samples = areas.map(row => {
            let best = null, distance = Infinity;
            for (const b of row.ranges) for (let y = Math.max(0, Math.floor(b.y)); y < Math.min(img.height, Math.ceil(b.y + b.height)); y++)
              for (let x = Math.max(0, Math.floor(b.x)); x < Math.min(img.width, Math.ceil(b.x + b.width)); x++) {
                const p = (y * img.width + x) * 4, color = [rgba[p], rgba[p + 1], rgba[p + 2]];
                const d = color.reduce((sum, v, i) => sum + (v - row.foreground[i]) ** 2, 0);
                if (d < distance) { distance = d; best = color; }
              }
            return { nearestForegroundPixel: best, squaredDistance: distance };
          });
          let backgroundPixels = 0;
          for (let p = 0; p < rgba.length; p += 4) if (background.every((v, i) => rgba[p + i] === v)) backgroundPixels++;
          return { width: img.width, height: img.height, backgroundPixels, samples };
        }, { png: png.toString('base64'), background: rgb(state.background),
          areas: state.rows.map(row => ({ ranges: row.ranges, foreground: row.foreground ? rgb(row.foreground) : [] })) });
        check(state.backgroundImage === 'none' && pixels.backgroundPixels > 1000, id + ': screenshot confirms opaque computed card background');
        check(state.scrollWidth <= state.clientWidth + 1, id + ': card has no horizontal overflow');
        for (let i = 0; i < state.rows.length; i++) {
          const row = state.rows[i];
          if (row.amount) {
            row.contrast = contrast(rgb(row.foreground), rgb(state.background));
            row.pixel = pixels.samples[i];
            row.pixelContrast = contrast(row.pixel.nearestForegroundPixel, rgb(state.background));
            check(row.contrast >= 4.5, id + '/' + row.label + ': computed amount contrast >= 4.5');
            check(row.pixelContrast >= 4.5, id + '/' + row.label + ': raster amount contrast >= 4.5');
            check(row.ranges.every(b => b.x >= -0.5 && b.x + b.width <= state.card.width + 0.5), id + '/' + row.label + ': complete numeric text stays in card');
          }
        }
        check(state.rows.find(row => row.label === 'Signed control').amount === '−$12.34 calculated', id + ': signed renderer control retains minus/cents/trust');
        const unknown = state.rows.find(row => row.label === 'Unavailable control');
        check(!unknown.amount && unknown.unavailable.includes('Synthetic source unavailable.') && unknown.text.includes('Not $0.'), id + ': unavailable stays distinct from zero');
        check(state.rows.some(row => row.outflow), id + ': native outflow marker retained');
        check(state.rows.find(row => row.label === 'Planned spending').amount.includes('$0.00'), id + ': genuine zero planned spending');
        if (key === 'large') check(state.rows.some(row => /\$1,234,567\.89/.test(row.amount || '')), id + ': large native amount present');
        if (key === 'estimated') check(state.rows.some(row => row.trust.some(tag => tag.html.includes('trust-estimated'))), id + ': estimated native state present');
        if (key === 'estimated' || (key === 'large' && width === 390)) {
          const file = id + '.png'; fs.writeFileSync(path.join(out, file), png); screenshots[file] = sha256(png);
        }
        records.push({ id, key, width, theme, ...state, pixels: { width: pixels.width, height: pixels.height, backgroundPixels: pixels.backgroundPixels } });
        await page.close();
      }
    }
    if (process.env.PROOF_BASELINE) {
      const before = JSON.parse(fs.readFileSync(process.env.PROOF_BASELINE, 'utf8'));
      for (let i = 0; i < records.length; i++) for (const field of ['id', 'card', 'rows']) {
        const stable = value => field !== 'rows' ? value : value.map(row => ({ label: row.label, text: row.text,
          html: row.html, amountBox: row.amountBox, rowBox: row.rowBox, ranges: row.ranges, trust: row.trust,
          outflow: row.outflow, unavailable: row.unavailable }));
        check(JSON.stringify(stable(records[i][field])) === JSON.stringify(stable(before.records[i][field])), records[i].id + ': before/after ' + field + ' preserved');
      }
      check(JSON.stringify(heroes) === JSON.stringify(before.heroes), 'all six PR636 hero text/geometry/accessibility controls unchanged');
    }
    check(errors.length === 0 && external.length === 0, 'no page errors or external requests');
    verifySourceBinding(root, binding);
    const receipt = { binding, status: failures.length ? 'FAIL' : 'PASS', failures, records, heroes, screenshots, errors, external,
      runtime: { node: process.version, browser: await browser.version(), playwright: require('playwright-core/package.json').version,
        viewportScale: 1, renderer: 'headless Edge; --disable-accelerated-2d-canvas' }, unchangedAfterRun: true,
      limits: 'Synthetic full App/Forecast Month navigation. Two explicitly identified native row-renderer publication controls per card. Pixel samples exclude trust pills. No household/live/provider/credential/physical-device claim.' };
    fs.writeFileSync(path.join(out, 'receipt.json'), serializeReceipt(receipt));
    console.log(JSON.stringify({ status: receipt.status, monthCases: records.length, heroControls: heroes.length,
      amountRecords: records.reduce((n, row) => n + row.rows.filter(x => x.amount).length, 0), failures, errors, external }));
    process.exitCode = failures.length ? 1 : 0;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
