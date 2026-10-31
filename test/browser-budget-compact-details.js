'use strict';
// Optional full Budget document/App.boot/Forecast proof using invented data.
// This static HTTP transport serves only public assets and synthetic JSON;
// authentication/server behavior remains covered by browser-budget-routed-layout.
// NODE_PATH=<playwright modules> CHROME_PATH=<chromium> node test/browser-budget-compact-details.js
// ATLAS_BUDGET_CAPTURE_ONLY=1 and ATLAS_BUDGET_ASSETS_DIR=<main public snapshot>
// capture the same synthetic cases before a change without enforcing its fix.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const makeData = require('./fixtures/budget-funding-data');
const root = process.env.ATLAS_BUDGET_ASSETS_DIR || path.join(__dirname, '..', 'public');
const output = process.env.ATLAS_BUDGET_SCREENSHOTS_DIR
  || path.join(require('node:os').tmpdir(), 'atlas-budget-compact-review');
const captureOnly = process.env.ATLAS_BUDGET_CAPTURE_ONLY === '1';
fs.mkdirSync(output, { recursive: true });

function fixture(shortfall) {
  const data = makeData();
  data.plan.bills[0].amount = shortfall ? 2000 : 200;
  // A long planning card beside short/empty cards reproduces grid stretching.
  for (let i = 0; i < 8; i++) data.plan.commitments.push({
    id: `synthetic-${i}`, label: `Synthetic planned cost ${i + 1}`,
    date: '2026-09-10', amount: 20, confidence: i % 2 ? 'estimated' : 'confirmed',
  });
  return data;
}

(async () => {
  let data = fixture(false), browser;
  const errors = [], external = [], measurements = [];
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (['/data.json', '/periods.json', '/balance-history.json'].includes(pathname)) {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(pathname === '/data.json' ? data : null));
    }
    const file = path.resolve(root, pathname === '/' ? 'index.html' : `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file)) {
      res.writeHead(404); return res.end();
    }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH,
      args: ['--no-sandbox'] });
    const screenshot = async (page, file) => {
      await page.evaluate(() => scrollTo(0, 0));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: path.join(output, file), fullPage: true });
    };
    for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 },
        hasTouch: width < 400, isMobile: width < 400, colorScheme: theme, reducedMotion: 'reduce' });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) { external.push(url.origin); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      for (const shortfall of [false, true]) {
        data = fixture(shortfall);
        await page.goto(base);
        const details = page.locator('[data-current-payday-details]');
        await details.waitFor();
        assert.equal(await page.evaluate(() => App.data.meta.title), 'Synthetic Budget funding review');
        const published = await page.evaluate(() => {
          const a = Forecast.paydayAllocation(App.data.plan, App.data.meta.asOf, {});
          return { bills: a.obligations.shortfall, household: a.essentials.shortfall };
        });
        // Independent hand calculation: $1,000 available minus the required
        // $2,000 bill leaves a $1,000 bills shortfall, plus $300 essentials.
        assert.deepEqual(published, shortfall ? { bills: 1000, household: 300 } : { bills: 0, household: 0 });
        const summary = details.locator(':scope > summary');
        const initialOpen = await details.evaluate(el => el.open);
        const label = `${width}-${theme}-${shortfall ? 'shortfall' : 'covered'}`;
        await screenshot(page, `${label}-closed.png`);
        if (!captureOnly) {
          assert.equal(initialOpen, false, 'shortfall must not auto-open the details');
          assert.equal(await summary.locator('.budget-shortfall-summary').count(), shortfall ? 1 : 0);
          if (shortfall) {
            assert.match(await summary.innerText(), /shortfall reported/);
            assert.ok(await summary.locator('.budget-shortfall-summary').isVisible());
          }
          const waterfall = await page.locator('[data-calendar-waterfall]').boundingBox();
          const range = await page.locator('[data-selected-pay-period-status]').boundingBox();
          const folded = await details.boundingBox();
          assert.ok(waterfall.y - (range.y + range.height) >= 0);
          assert.ok(waterfall.y - (range.y + range.height) <= 32, 'no oversized gap before the waterfall');
          assert.ok(folded.y - (waterfall.y + waterfall.height) >= 0);
          assert.ok(folded.y - (waterfall.y + waterfall.height) <= 32, 'no oversized gap after the waterfall');
          assert.ok(folded.height <= 120, 'collapsed disclosure stays compact on phones');
          assert.ok((await summary.boundingBox()).height >= 44, 'summary remains a usable tap target');
        }
        if (initialOpen) await summary.click();
        const shell = details.locator('[data-payday-instruction-shell]');
        const originalText = await shell.textContent();
        await summary.focus();
        await page.keyboard.press('Enter');
        assert.equal(await details.evaluate(el => el.open), true);
        assert.equal(await summary.evaluate(el => document.activeElement === el), true);
        assert.ok(await shell.locator('h2').isVisible());
        if (!captureOnly) {
          const rows = shell.locator('.instruction-block');
          assert.ok(await rows.count() >= 7);
          assert.equal(await rows.evaluateAll(nodes => nodes.some(el => el.open)), false);
          assert.equal(await shell.locator('.instruction-context').evaluate(el => el.open), false);
          assert.ok((await shell.boundingBox()).height <= (width < 400 ? 1300 : 1000),
            'the default breakdown must remain short even with many future costs');
          assert.equal(await shell.getByText('Synthetic planned cost 8', { exact: true }).isVisible(), false,
            'the long future-funding list requires an explicit second disclosure');
        }
        const metrics = await shell.evaluate(el => {
          const rgb = color => {
            const values = color.match(/[\d.]+/g).map(Number);
            return color.startsWith('color(srgb')
              ? values.map((v, i) => i < 3 ? v * 255 : v) : values;
          };
          const blend = (top, bottom) => {
            const alpha = top[3] == null ? 1 : top[3];
            return top.slice(0, 3).map((channel, i) => channel * alpha + bottom[i] * (1 - alpha));
          };
          const background = node => {
            const chain = []; for (let p = node; p; p = p.parentElement) chain.unshift(p);
            return chain.reduce((bg, p) => blend(rgb(getComputedStyle(p).backgroundColor), bg), [255, 255, 255]);
          };
          const luminance = color => color.map(c => c / 255).map(c =>
            c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
            .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
          const contrast = node => {
            const bg = background(node), fg = blend(rgb(getComputedStyle(node).color), bg);
            const a = luminance(bg), b = luminance(fg);
            return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          };
          const texts = [...el.querySelectorAll('h2,h3,p,span,b,strong')].filter(node =>
            node.getBoundingClientRect().width && node.getBoundingClientRect().height &&
            [...node.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
          const cards = [...el.querySelectorAll('.instruction-block')];
          const warning = document.querySelector('.budget-shortfall-summary');
          return { minContrast: Math.min(...texts.map(contrast)),
            warningContrast: warning ? contrast(warning) : null, cards: cards.map(card => ({
            title: card.querySelector('h3').textContent, height: card.getBoundingClientRect().height,
          })),
          shellOverflow: el.scrollWidth > el.clientWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth };
        });
        measurements.push({ label, initialOpen, ...metrics, publicationText: {
          shell: await shell.textContent(),
          waterfall: await page.locator('[data-calendar-waterfall]').textContent(),
        } });
        if (captureOnly) {
          await screenshot(page, `${label}-expanded.png`);
          continue;
        }
        if (!captureOnly) {
          assert.ok(metrics.minContrast >= 4.5, JSON.stringify(metrics));
          if (shortfall) assert.ok(metrics.warningContrast >= 4.5, JSON.stringify(metrics));
          const money = metrics.cards.find(card => card.title === 'Money available');
          assert.ok(money.height < 150, 'a compact row must not grow with the hidden future-funding list');
          assert.equal(metrics.shellOverflow || metrics.pageOverflow, false);
        }
        if (shortfall) {
          assert.match(await shell.innerText(), /Shortfall of \$1,000\.00 — bills are not fully covered/);
          assert.ok(await shell.locator('[data-payday-breakdown="planned-cost-funding"] .instruction-warning').isVisible(),
            'published funding-gap warning must remain visible before the nested detail is opened');
        }
        const planned = shell.locator('[data-payday-breakdown="planned-cost-funding"]');
        await planned.locator(':scope > summary').focus();
        await page.keyboard.press('Enter');
        assert.equal(await planned.evaluate(el => el.open), true);
        assert.ok(await shell.getByText('Synthetic planned cost 8', { exact: true }).isVisible());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => App.rerender());
          assert.equal(await details.evaluate(el => el.open), true);
          assert.equal(await planned.evaluate(el => el.open), true);
          assert.equal(await shell.textContent(), originalText, 'repeated render must preserve the publication');
        }
        await planned.locator(':scope > summary').focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => !document.querySelector('[data-payday-breakdown="planned-cost-funding"]').open);
        if (width < 400) await planned.locator(':scope > summary').tap();
        else await planned.locator(':scope > summary').click();
        assert.equal(await planned.evaluate(el => el.open), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await planned.locator(':scope > summary').click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await summary.focus();
        await page.keyboard.press('Space');
        await page.waitForFunction(() => !document.querySelector('[data-current-payday-details]').open);
        if (width < 400) await summary.tap(); else await summary.click();
        assert.equal(await details.evaluate(el => el.open), true);
        assert.equal(await shell.textContent(), originalText, 'opening must preserve every label, amount and explanation');
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => App.rerender());
          assert.equal(await details.evaluate(el => el.open), true, 'explicit open choice survives re-render');
          assert.equal(await planned.evaluate(el => el.open), false, 'explicit closed choice survives re-render');
          assert.equal(await shell.textContent(), originalText, 'repeated render must preserve the publication');
        }
        await screenshot(page, `${label}-expanded.png`);
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    fs.writeFileSync(path.join(output, 'measurements.json'), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify({ mode: captureOnly ? 'baseline capture' : 'PASS', cases: measurements.length,
      minimumContrast: Math.min(...measurements.map(m => m.minContrast)), output,
      proof: 'production Budget document, App.boot, real Forecast; synthetic JSON; desktop/phone light/dark, shortfall/covered, keyboard/tap/re-render/contrast/geometry' }));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exit(1); });
