'use strict';
// A future pay period's unobserved categories must not paint an empty liquid.
// NODE_PATH=<Playwright modules> CHROME_PATH=<Chromium> node test/browser-budget-unknown-ring.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const fx = require('./fixtures/other-period-target');
const root = path.join(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [];
  const external = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 },
      colorScheme: 'light', reducedMotion: 'reduce' });
    page.on('pageerror', err => errors.push(err.message));
    const data = fx.build().data;
    await page.route('**/*', route => {
      const u = new URL(route.request().url());
      if (u.origin !== 'http://budget.test') { external.push(u.origin); return route.abort(); }
      if (u.pathname === '/data.json') return route.fulfill({ json: data });
      if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(u.pathname)) {
        return route.fulfill({ json: null });
      }
      const file = path.join(root, 'public', u.pathname === '/' ? 'index.html' : u.pathname.slice(1));
      if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({
        body: fs.readFileSync(file),
        contentType: file.endsWith('.js') ? 'application/javascript'
          : file.endsWith('.css') ? 'text/css' : 'text/html',
      });
    });
    await page.goto('http://budget.test/');
    await page.locator('[data-budget-surface]').waitFor();
    await page.locator('[data-blend-rings]').waitFor();
    const css = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText); } catch (err) { return []; }
    }).join('\n'));
    assert.equal(/var\(\s*--left\s*,/.test(css), false, 'liquid height has no zero fallback');
    const known = await page.evaluate(() => [...document.querySelectorAll('.blend-ring.is-known')].map(ring => ({
      liquid: !!ring.querySelector('.blend-liquid'),
      left: ring.style.getPropertyValue('--left'),
    })));
    assert.ok(known.length > 0, 'the observed period has a known household ring');
    assert.ok(known.some(ring => ring.liquid && ring.left !== ''), 'a known ring draws its published complement');
    await page.locator('[data-budget-window-step="1"]').click();
    await page.locator('[data-budget-window-range]').filter({ hasText: /Oct 9/ }).waitFor();
    await page.locator('[data-blend-rings]').waitFor();
    const future = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.budget-category-row')]
        .filter(row => row.getAttribute('data-budget-category-open') !== 'other-spending');
      const rings = [...document.querySelectorAll('.blend-ring')];
      return rows.map((row, index) => {
        const ring = rings[index];
        return {
          status: (row.querySelector('.budget-category-status')?.textContent || '').replace(/\s+/g, ' ').trim(),
          scale: row.querySelector('.budget-category-bar')?.getAttribute('data-budget-category-scale') || '',
          known: !!(ring && ring.classList.contains('is-known')),
          unknown: !!(ring && ring.classList.contains('is-unknown')),
          hatched: !!(ring && ring.querySelector('.is-hatched')),
          liquid: !!(ring && ring.querySelector('.blend-liquid')),
          left: ring ? ring.style.getPropertyValue('--left') : 'missing-ring',
        };
      });
    });
    const unobserved = future.filter(row => /Not observed/.test(row.status));
    assert.ok(unobserved.length > 0, 'the next period publishes Not observed categories');
    unobserved.forEach(row => {
      assert.equal(row.scale, 'unavailable');
      assert.equal(row.unknown, true);
      assert.equal(row.known, false);
      assert.equal(row.hatched, true);
      assert.equal(row.liquid, false);
      assert.equal(row.left, '');
    });
    assert.equal(future.some(row => row.left === '0' && row.unknown), false);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`PASS unknown rings: ${known.length} known now, ${unobserved.length} Not observed next period`);
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
