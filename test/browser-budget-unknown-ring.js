'use strict';
// Unobserved or incompletely qualified remaining amounts must not paint liquid/arc geometry.
// NODE_PATH=<Playwright modules> CHROME_PATH=<Chromium> node test/browser-budget-unknown-ring.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const ringEvidence = require('./fixtures/budget-blend-ring-evidence');
const { expected } = ringEvidence;
const root = path.join(__dirname, '..');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
  const errors = [];
  const external = [];
  try {
    const open = async options => {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 },
        colorScheme: 'light', reducedMotion: 'reduce' });
      page.on('pageerror', err => errors.push(err.message));
      const data = ringEvidence.packet(options?.pendingCoverage || 'complete');
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
      return page;
    };
    const readRing = (page, id) => page.evaluate(category => {
      const row = document.querySelector('[data-budget-browse="spending"] [data-budget-category-open="' + CSS.escape(category) + '"]');
      const ring = document.querySelector('.blend-ring[data-blend-cat="' + CSS.escape(category) + '"]');
      const arc = ring?.querySelector('.rg-arc');
      const dash = (arc?.getAttribute('stroke-dasharray') || '').split(/\s+/).map(Number);
      return {
        status: row?.querySelector('.budget-category-status')?.textContent.trim(),
        meta: row?.querySelector('.budget-category-meta')?.textContent.replace(/\s+/g, ' ').trim(),
        scale: row?.querySelector('.budget-category-bar')?.getAttribute('data-budget-category-scale'),
        spentWidth: row?.querySelector('.budget-category-fill')?.style.width || '',
        known: !!ring?.classList.contains('is-known'),
        unknown: !!ring?.classList.contains('is-unknown'),
        dotted: !!ring?.querySelector('.rg-track.is-dotted'),
        arc: !!arc,
        arcFraction: arc ? dash[0] / dash[1] : null,
        liquid: !!ring?.querySelector('.blend-ring-liquid'),
        left: ring?.style.getPropertyValue('--left') ?? 'missing-ring',
        pct: ring?.style.getPropertyValue('--pct') ?? 'missing-ring',
        amount: ring?.querySelector('.blend-ring-v')?.textContent.trim(),
        label: ring?.getAttribute('aria-label') || '',
      };
    }, id);
    const noRemainingGeometry = (row, reason) => {
      assert.equal(row.unknown, true, reason);
      assert.equal(row.known, false, reason);
      assert.equal(row.dotted, true, reason);
      assert.equal(row.arc, false, reason);
      assert.equal(row.liquid, false, reason);
      assert.equal(row.left, '', reason);
      assert.equal(row.pct, '', reason);
    };
    const page = await open();
    const css = await page.evaluate(() => [...document.styleSheets].flatMap(sheet => {
      try { return [...sheet.cssRules].map(rule => rule.cssText); } catch (err) { return []; }
    }).join('\n'));
    assert.equal(/var\(\s*--left\s*,/.test(css), false, 'liquid height has no zero fallback');
    const known = await readRing(page, expected.groceries.id);
    // Independent fixture cents: 22000 planned minus 11037 observed leaves 10963.
    assert.equal(known.status, expected.groceries.status);
    assert.ok(known.meta.includes(expected.groceries.spent));
    assert.ok(known.meta.includes(expected.groceries.planned));
    assert.equal(known.amount, expected.groceries.status);
    assert.equal(known.known, true);
    assert.equal(known.liquid, true);
    assert.equal(known.arc, true);
    assert.ok(Math.abs(Number(known.left) - expected.groceries.fraction) < 0.0001, 'liquid represents independently reconciled remaining fraction');
    assert.ok(Math.abs(known.arcFraction - expected.groceries.fraction) < 0.0001, 'arc represents remaining, not spent');
    const zero = await readRing(page, expected.zero.id);
    assert.equal(zero.status, expected.zero.status);
    assert.equal(zero.amount, expected.zero.status);
    assert.equal(zero.scale, 'numeric');
    assert.equal(parseFloat(zero.spentWidth), 0, 'fixture publishes actual zero spending');
    assert.ok(zero.meta.includes(expected.zero.spent));
    assert.ok(zero.meta.includes(expected.zero.planned));
    assert.equal(zero.known, true);
    assert.equal(zero.unknown, false);
    assert.equal(zero.liquid, true);
    assert.equal(zero.arc, true);
    assert.equal(zero.dotted, false);
    assert.equal(Number(zero.left), expected.zero.fraction, 'confirmed zero spending leaves the full published plan');
    assert.equal(zero.arcFraction, expected.zero.fraction);
    const pill = page.getByRole('button', { name: /^Choose period or month/ });
    await pill.click();
    assert.equal(await pill.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.blend-toolbar').evaluate(el => el.contains(document.activeElement)), true);
    await page.locator('[data-budget-window-step="1"]').click();
    await page.locator('[data-budget-window-range]').filter({ hasText: /Oct 9/ }).waitFor();
    await page.locator('[data-blend-rings]').waitFor();
    const ids = await page.locator('[data-budget-browse="spending"] .budget-category-row').evaluateAll(rows =>
      rows.map(row => row.getAttribute('data-budget-category-open')).filter(id => id !== 'other-spending'));
    const future = await Promise.all(ids.map(id => readRing(page, id)));
    const unobserved = future.filter(row => /Not observed/.test(row.status));
    assert.ok(unobserved.length > 0, 'the next period publishes Not observed categories');
    unobserved.forEach(row => {
      assert.equal(row.scale, 'unavailable');
      noRemainingGeometry(row, 'unobserved categories never imply a remaining fraction');
    });
    assert.equal(future.some(row => row.left === '0' && row.unknown), false);
    await page.close();
    // These fixtures retain real numeric spent/plan bars while the native
    // publication withholds remaining because pending evidence is incomplete.
    for (const pendingCoverage of ['partial', 'unknown']) {
      const partialPage = await open({ pendingCoverage });
      const partial = await readRing(partialPage, expected.groceries.id);
      assert.equal(partial.status, expected.incompleteStatus);
      assert.equal(partial.scale, 'numeric', 'regression requires numeric source geometry');
      assert.ok(parseFloat(partial.spentWidth) > 0, 'observed spending survives the missing remaining qualification');
      assert.ok(partial.meta.includes(expected.groceries.spent));
      assert.ok(partial.meta.includes(expected.groceries.planned));
      assert.equal(partial.amount, expected.incompleteStatus);
      assert.match(partial.label, /Remaining unavailable/);
      noRemainingGeometry(partial, `${pendingCoverage} evidence cannot qualify remaining`);
      const zeroPartial = await readRing(partialPage, expected.zero.id);
      assert.equal(zeroPartial.status, expected.incompleteStatus);
      assert.equal(zeroPartial.scale, 'numeric');
      assert.equal(parseFloat(zeroPartial.spentWidth), 0, 'incomplete fixture retains observed zero spending');
      assert.ok(zeroPartial.meta.includes(expected.zero.spent));
      assert.ok(zeroPartial.meta.includes(expected.zero.planned));
      assert.equal(zeroPartial.amount, expected.incompleteStatus, 'zero spending must not replace remaining uncertainty with a dash');
      assert.match(zeroPartial.label, /Remaining unavailable/);
      noRemainingGeometry(zeroPartial, `${pendingCoverage} zero spending cannot qualify remaining`);
      await partialPage.close();
    }
    for (const widthEvidence of ['missing', 'blank']) {
      const incomplete = await open();
      await incomplete.evaluate(mode => {
        const row = document.querySelector('[data-budget-browse="spending"] [data-budget-category-open="groceries"]');
        const fill = row.querySelector('.budget-category-fill');
        if (mode === 'missing') fill.remove();
        else fill.style.width = '';
        // Withhold the redundant printed denominator too: a missing width must
        // not become confirmed zero through fallback parsing of absent data.
        row.querySelector('.budget-category-meta').textContent = 'Spent Unavailable / of planned Unavailable';
        document.querySelector('[data-blend-rings]')?.remove();
        document.querySelector('.blend-other')?.remove();
        document.querySelector('[data-budget-bento]')?.removeAttribute('data-blend-ready');
        document.getElementById('operating-surface-body').appendChild(document.createTextNode(''));
      }, widthEvidence);
      await incomplete.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const missing = await readRing(incomplete, 'groceries');
      assert.equal(missing.spentWidth, '');
      noRemainingGeometry(missing, widthEvidence + ' numeric evidence is not zero spending');
      await incomplete.close();
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log(`PASS remaining rings: independently reconciled known/zero fractions, ${unobserved.length} Not observed next period, partial/unknown/blank evidence withheld`);
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
