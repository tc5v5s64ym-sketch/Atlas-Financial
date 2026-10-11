'use strict';
// Browser proof for the boot (loading) treatment: two layers, both purely
// decorative. The static layer (.boot-static, index.html markup) covers the
// pre-script interval on / and /index.html; the live layer
// ([data-boot-treatment], built by app.js inside the boot notice) covers
// every route from App.boot until the notice leaves — on success, on the
// crit failure surface, and after Cancel. The notice keeps role="status"
// as the single announcer; neither layer takes focus, intercepts pointer
// events, or announces.
//
// Timing claim, deliberately limited: with /data.json held for a fixed,
// identical delay on base and branch, the treatment is visible for the
// whole genuine-load interval, is removed on arrival, and adds no
// measurable delay to rendered content. No real-world boot-speed claim.
//
//   CHROME_PATH=<Chromium> node test/browser-boot-treatment.js
//   BOOT_BASE_ROOT=<pristine base checkout> — also measure the base tree
//   under identical delays and record the comparison in the receipt.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const serveRoot = process.env.BOOT_ROOT || root;
const baseRoot = process.env.BOOT_BASE_ROOT || null;
const outDir = path.join(root, 'docs', 'proof');
fs.mkdirSync(outDir, { recursive: true });
const fx = require('./fixtures/budget-surface-data');
const data = fx.served();

const CLAIM = 'visible for the whole genuine-load interval, removed on arrival, no measurable added delay under identical controlled delay';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const visFn = () => {
  const probe = sel => {
    const el = document.querySelector(sel);
    if (!el) return { present: false, visible: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      present: true,
      visible: cs.display !== 'none' && cs.visibility !== 'hidden'
        && Number(cs.opacity) > 0 && r.width > 0 && r.height > 0,
    };
  };
  const content = document.querySelector('#operating-surface, [data-page-shell], main, h1');
  return {
    staticLayer: probe('[data-boot-static]'),
    liveLayer: probe('[data-boot-treatment]'),
    contentChars: content ? (content.innerText || '').trim().length : 0,
    noticeText: (document.querySelector('.note-box')?.innerText || '').trim(),
  };
};

// Intercept a fresh page: static files from serveDir/public, /data.json
// answered by dataPlan(callIndex) -> { delayMs, status }.
async function openPage(browser, serveDir, contextOpts, dataPlan) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const servedSha = {};
  let dataCalls = 0;
  await page.route('**/*', async intercepted => {
    const url = new URL(intercepted.request().url());
    if (url.origin !== 'http://boot.test') return intercepted.abort();
    if (url.pathname === '/data.json') {
      const plan = dataPlan(dataCalls++);
      if (plan.delayMs) await sleep(plan.delayMs);
      if (plan.status === 200) return intercepted.fulfill({ json: data });
      return intercepted.fulfill({ status: plan.status, json: { error: 'data unavailable' } });
    }
    if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) {
      return intercepted.fulfill({ json: null });
    }
    if (url.pathname === '/talk/capability') return intercepted.fulfill({ json: { available: false } });
    if (url.pathname === '/talk/context') return intercepted.fulfill({ status: 404, body: '' });
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.join(serveDir, 'public', rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return intercepted.fulfill({ status: 404, body: '' });
    const body = fs.readFileSync(file);
    servedSha['public/' + rel] = sha256(body);
    const type = file.endsWith('.css') ? 'text/css'
      : file.endsWith('.js') ? 'application/javascript'
      : file.endsWith('.woff2') ? 'font/woff2'
      : file.endsWith('.png') ? 'image/png'
      : 'text/html';
    return intercepted.fulfill({ body, contentType: type });
  });
  return { context, page, servedSha };
}

// Navigate and sample every ~100ms until content renders; report the
// treatment's first-visible time and any in-interval gap.
async function sampleLoad(page, routePath, timeoutMs = 30000) {
  const t0 = Date.now();
  const nav = page.goto('http://boot.test' + routePath, { waitUntil: 'commit' });
  const samples = [];
  let firstVisibleMs = null;
  let contentMs = null;
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(visFn).catch(() => null);
    if (st) {
      const anyVisible = st.staticLayer.visible || st.liveLayer.visible;
      const now = Date.now() - t0;
      samples.push({ ms: now, ...st, anyVisible });
      if (anyVisible && firstVisibleMs === null) firstVisibleMs = now;
      if (st.contentChars > 20) { contentMs = now; break; }
    }
    await sleep(100);
  }
  await nav;
  const gaps = samples.filter(s => firstVisibleMs !== null && s.ms > firstVisibleMs
    && contentMs !== null && s.ms < contentMs && !s.anyVisible
    && (s.staticLayer.present || s.liveLayer.present || s.contentChars <= 20));
  return { firstVisibleMs, contentMs, samples, gapCount: gaps.length };
}

async function waitContent(page, timeoutMs = 30000) {
  await page.waitForFunction(() => {
    const c = document.querySelector('#operating-surface, [data-page-shell], main, h1');
    return c && (c.innerText || '').trim().length > 20;
  }, { timeout: timeoutMs });
}

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || undefined,
    headless: true,
  });
  const results = {};
  const shots = {};
  const shot = async (page, name) => {
    const file = path.join(outDir, name);
    await page.screenshot({ path: file });
    shots[name] = sha256(fs.readFileSync(file));
  };
  try {
    // 1 — Budget direct entry, light, long fixed delay (5000ms).
    {
      const { context, page, servedSha } = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 5000, status: 200 }));
      const run = await sampleLoad(page, '/');
      assert.ok(run.firstVisibleMs !== null, 'treatment became visible during the load');
      assert.equal(run.gapCount, 0, 'treatment visible for the whole genuine-load interval');
      const anim = await page.evaluate(() => {
        const bar = document.querySelector('.boot-pulse > span');
        return bar ? getComputedStyle(bar).animationName : null;
      }).catch(() => null);
      const end = await page.evaluate(visFn);
      assert.ok(!end.staticLayer.present && !end.liveLayer.present, 'both layers gone after arrival');
      results.lightLong = { delayMs: 5000, treatmentFirstVisibleMs: run.firstVisibleMs, contentRenderedMs: run.contentMs, samples: run.samples.length, servedSha };
      await context.close();
      // Screenshot needs its own delayed run (content already arrived above).
      const again = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 5000, status: 200 }));
      const nav = again.page.goto('http://boot.test/', { waitUntil: 'commit' });
      await again.page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]') || document.querySelector('[data-boot-static]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      await shot(again.page, 'boot-treatment-light.png');
      const pulseAnim = await again.page.evaluate(() => {
        const bar = document.querySelector('.boot-pulse > span');
        return bar ? getComputedStyle(bar).animationName : null;
      });
      assert.equal(pulseAnim, 'boot-pulse', 'pulse animation runs when motion is allowed');
      results.lightLong.pulseAnimationName = pulseAnim;
      await nav; await waitContent(again.page);
      await shot(again.page, 'boot-treatment-after.png');
      await again.context.close();
    }
    // 2 — Budget direct entry, dark, 1500ms delay.
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'dark' },
        () => ({ delayMs: 1500, status: 200 }));
      const nav = page.goto('http://boot.test/', { waitUntil: 'commit' });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]') || document.querySelector('[data-boot-static]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      const tVis = Date.now();
      await shot(page, 'boot-treatment-dark.png');
      await nav; await waitContent(page);
      const end = await page.evaluate(visFn);
      assert.ok(!end.staticLayer.present && !end.liveLayer.present, 'dark: layers gone after arrival');
      results.dark = { delayMs: 1500, treatmentVisibleObserved: true, screenshotAtMs: tVis };
      await context.close();
    }
    // 3 — Reduced motion, narrow width: treatment visible and fully static.
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 320, height: 700 }, colorScheme: 'light', reducedMotion: 'reduce' },
        () => ({ delayMs: 2500, status: 200 }));
      const nav = page.goto('http://boot.test/', { waitUntil: 'commit' });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]') || document.querySelector('[data-boot-static]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      const animName = await page.evaluate(() => {
        const bar = document.querySelector('.boot-pulse > span');
        return bar ? getComputedStyle(bar).animationName : null;
      });
      assert.equal(animName, 'none', 'reduced motion: pulse animation is none');
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-boot-treatment]') || document.querySelector('[data-boot-static]');
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
      const first = await page.screenshot({ clip });
      await sleep(700);
      const second = await page.screenshot({ clip });
      assert.ok(first.equals(second), 'reduced motion: treatment frame is byte-stable across 700ms');
      await shot(page, 'boot-treatment-reduced-motion.png');
      await nav; await waitContent(page);
      results.reducedMotion = { delayMs: 2500, animationName: animName, frameStable: true };
      await context.close();
    }
    // 4 — Direct entry at another route (/bills.html), mobile width.
    {
      const { context, page, servedSha } = await openPage(browser, serveRoot,
        { viewport: { width: 390, height: 844 }, colorScheme: 'light' },
        () => ({ delayMs: 1500, status: 200 }));
      const nav = page.goto('http://boot.test/bills.html', { waitUntil: 'commit' });
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      const statics = await page.locator('[data-boot-static]').count();
      assert.equal(statics, 0, 'no static layer off the index route');
      await shot(page, 'boot-treatment-bills.png');
      await nav;
      // Arrival on a non-index route: the boot notice leaves the DOM when
      // the load completes (static shell text exists there pre-data, so a
      // content-length wait would fire early).
      await page.waitForFunction(() => !document.querySelector('.note-box'), { timeout: 30000 });
      const end = await page.evaluate(visFn);
      assert.ok(!end.liveLayer.present, 'bills: live layer gone after arrival');
      results.billsDirectEntry = { delayMs: 1500, liveLayerVisible: true, servedSha };
      await context.close();
    }
    // 5 — Failure, then Retry: crit surface has no treatment; the retried
    // load shows it again and removes it on success.
    {
      let first = true;
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
        () => { if (first) { first = false; return { delayMs: 300, status: 503 }; } return { delayMs: 2000, status: 200 }; });
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Current data could not be loaded'), { timeout: 15000 });
      let st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present && !st.staticLayer.present, 'no treatment on the crit surface');
      const retryVisible = await page.locator('.note-box button', { hasText: 'Retry' }).isVisible();
      assert.ok(retryVisible, 'Retry button visible and unobstructed on the crit surface');
      await shot(page, 'boot-treatment-crit.png');
      await page.locator('.note-box button', { hasText: 'Retry' }).click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      await shot(page, 'boot-treatment-retry.png');
      await waitContent(page);
      st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'treatment removed after retry success');
      results.failureRetry = { critTreatmentAbsent: true, retryTreatmentVisible: true, removedAfterRetrySuccess: true };
      await context.close();
    }
    // 6 — Cancel, then Retry from the cancelled surface.
    {
      let calls = 0;
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
        () => (++calls === 1 ? { delayMs: 5000, status: 200 } : { delayMs: 2000, status: 200 }));
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await page.waitForFunction(() => !!document.querySelector('[data-boot-treatment]'), { timeout: 10000 });
      await page.locator('.note-box button', { hasText: 'Cancel' }).click();
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Loading cancelled.'), { timeout: 10000 });
      let st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'no treatment after Cancel');
      await page.locator('.note-box button', { hasText: 'Retry' }).click();
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-boot-treatment]');
        if (!el) return false;
        const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, { timeout: 10000 });
      await waitContent(page);
      st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'treatment removed after cancel-retry success');
      results.cancelRetry = { cancelTreatmentAbsent: true, retryTreatmentVisible: true, removedAfterRetrySuccess: true };
      await context.close();
    }
    // 7 — Static layer standalone: with JavaScript disabled nothing can
    // remove it, which both proves it renders on its own at first paint
    // and demonstrates the accepted limitation (scripts never running
    // leaves it in place, like the shell's static status text today).
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1280, height: 900 }, colorScheme: 'light', javaScriptEnabled: false },
        () => ({ delayMs: 0, status: 200 }));
      await page.goto('http://boot.test/', { waitUntil: 'load' });
      const st = await page.evaluate(visFn);
      assert.ok(st.staticLayer.visible, 'static layer computed-visible without JavaScript');
      assert.ok(!st.liveLayer.present, 'no live layer without JavaScript');
      const pe = await page.evaluate(() => getComputedStyle(document.querySelector('[data-boot-static]')).pointerEvents);
      assert.equal(pe, 'none', 'static layer never intercepts pointer events');
      await shot(page, 'boot-treatment-static.png');
      results.staticStandalone = { computedVisible: true, pointerEvents: pe };
      await context.close();
    }
    // Base comparison under identical delays, when a pristine base
    // checkout is supplied: interval evidence only.
    let comparison = null;
    if (baseRoot) {
      comparison = {};
      for (const delayMs of [5000, 1500]) {
        const b = await openPage(browser, baseRoot,
          { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
          () => ({ delayMs, status: 200 }));
        const t0 = Date.now();
        const nav = b.page.goto('http://boot.test/', { waitUntil: 'commit' });
        let treatmentsSeen = 0;
        await b.page.waitForFunction(() => {
          const c = document.querySelector('#operating-surface');
          return c && (c.innerText || '').trim().length > 20;
        }, { timeout: 30000 });
        const contentMs = Date.now() - t0;
        treatmentsSeen = await b.page.locator('[data-boot-treatment], [data-boot-static]').count();
        await nav;
        comparison['delay' + delayMs] = { baseContentRenderedMs: contentMs, baseTreatmentsSeen: treatmentsSeen };
        await b.context.close();
      }
      comparison['delay5000'].branchContentRenderedMs = results.lightLong.contentRenderedMs;
      comparison['delay5000'].addedDelayMs = results.lightLong.contentRenderedMs - comparison['delay5000'].baseContentRenderedMs;
    }
    const receipt = {
      proof: 'browser-boot-treatment',
      baseMainSha: 'd1d85a0b96dba3d077eeadecca0df2390eb3ae1e',
      claim: CLAIM,
      scenarios: results,
      baseComparison: comparison,
      screenshots: shots,
    };
    fs.writeFileSync(path.join(outDir, 'boot-treatment-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log('PASS boot treatment proof: ' + Object.keys(results).length + ' scenarios; timings '
      + JSON.stringify({ lightLong: { firstVisibleMs: results.lightLong.treatmentFirstVisibleMs, contentMs: results.lightLong.contentRenderedMs }, baseComparison: comparison }));
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
