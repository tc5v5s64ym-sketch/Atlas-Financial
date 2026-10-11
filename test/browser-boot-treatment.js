'use strict';
// Browser proof for the full-screen boot (loading) treatment — the
// follow-on to PR #581. The whole page IS the loading screen: two
// layers, one composition (large brand mark, ATLAS wordmark, status
// line, restrained brand glow on --plane). The static layer
// (.boot-static, index.html markup) covers the pre-script interval on
// / and /index.html; the live layer is the boot notice itself, stamped
// [data-boot-notice] by app.js, with the .boot-treatment mark built
// inside it on every load attempt. The overlay covers the full
// viewport including the header, in the loading state and on the crit
// (failure / cancelled) surface; all loading motion stops on the crit
// surface. While the overlay is up, app.js inerts the shell behind it
// (header + .wrap sections) with each element's prior inert /
// aria-hidden state captured and restored exactly on the successful
// resolution; Cancel and Retry stay operable throughout. The notice
// keeps role="status" as the single announcer; the treatment is
// aria-hidden decoration. In-content plan.js .note-box.crit boxes
// carry no [data-boot-notice] attribute and are never overlays —
// asserted below by computed style, not by class inspection.
//
// Timing claim, deliberately limited: with /data.json held for a fixed,
// identical delay on base and branch, the treatment is visible during
// the genuine-load interval with no gaps observed at ~100ms sampling
// after first visibility, and is removed on arrival. The repeated
// nav-to-content timing comparison is INCONCLUSIVE: the per-round
// paired deltas vary more than any effect, so the median paired delta
// and the difference of medians are recorded as measurements only —
// they do not establish that the treatment adds no delay. What is
// supported: the treatment adds no new blocking assets. No real-world
// boot-speed claim.
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

const CLAIM = 'visible during the genuine-load interval with no gaps observed at ~100ms sampling after first visibility, removed on arrival, no new blocking assets; timing comparison inconclusive — median paired delta and difference of medians recorded as measurements, not a no-delay conclusion';
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

const rectOf = (page, sel) => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
}, sel);
const coversViewport = r => !!r && Math.abs(r.x) <= 1 && Math.abs(r.y) <= 1
  && Math.abs(r.width - r.vw) <= 1 && Math.abs(r.height - r.vh) <= 1;

const treatmentVisible = page => page.waitForFunction(() => {
  const el = document.querySelector('[data-boot-treatment]');
  if (!el) return false;
  const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
  return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
}, { timeout: 10000 });

// Computed animation name of the first animated brand block inside a
// layer root ('[data-boot-treatment]' live, '[data-boot-static]'
// static); null when the layer or its mark is absent.
const markAnimName = (page, rootSel) => page.evaluate(s => {
  const el = document.querySelector(s + ' .boot-blocks-mark rect.boot-mark-a');
  return el ? getComputedStyle(el).animationName : null;
}, rootSel);

// Sample the four blocks' bounding-box centres across the animation
// loop and report, per block, the range of its distance from the
// mark's centre point — geometry, not animation-name bookkeeping:
// a phased separate -> bump -> settle loop must move the blocks
// measurably apart and together. The sampling loop lives on the Node
// side (repeated synchronous evaluates) because an async evaluate
// never resolves on the JavaScript-disabled static-layer page.
const markGeometry = async (page, rootSel, frames = 24, intervalMs = 160) => {
  const seen = [];
  for (let i = 0; i < frames; i++) {
    const centres = await markCentres(page, rootSel);
    if (!centres) return null;
    if (centres.length !== 4) return { blocks: centres.length, ranges: [] };
    seen.push(centres);
    await sleep(intervalMs);
  }
  const ranges = [0, 1, 2, 3].map(k => {
    const ds = seen.map(f => {
      const mx = f.reduce((a, p) => a + p.cx, 0) / f.length;
      const my = f.reduce((a, p) => a + p.cy, 0) / f.length;
      return Math.hypot(f[k].cx - mx, f[k].cy - my);
    });
    return Math.round((Math.max(...ds) - Math.min(...ds)) * 100) / 100;
  });
  return { blocks: 4, frames: seen.length, ranges };
};

const markCentres = (page, rootSel) => page.evaluate(s => {
  const rootEl = document.querySelector(s);
  if (!rootEl) return null;
  return [...rootEl.querySelectorAll('.boot-blocks-mark rect:not(.boot-mark-bg)')].map(r => {
    const b = r.getBoundingClientRect();
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  });
}, rootSel);

// Count elements in the boot notice subtree (notice included) whose
// computed animation is anything but none — the crit surface must be
// fully static (no loading motion after a load terminates).
const noticeAnimations = page => page.evaluate(() => {
  const notice = document.querySelector('[data-boot-notice]');
  if (!notice) return null;
  return [notice, ...notice.querySelectorAll('*')]
    .filter(el => getComputedStyle(el).animationName !== 'none').length;
});

// Stash the shell elements app.js inerts behind the overlay (header +
// .wrap children other than the notice itself) so later assertions
// read the SAME nodes' state after resolution.
const stashShellProbe = page => page.evaluate(() => {
  const els = [document.querySelector('.site-head'),
    ...document.querySelectorAll('.wrap > *')].filter(Boolean);
  window.__shellProbe = els.filter(el => !el.hasAttribute('data-boot-notice'));
  return window.__shellProbe.length;
});
const shellProbeState = page => page.evaluate(() =>
  (window.__shellProbe || []).map(el => ({
    id: el.id || null, inert: !!el.inert, ariaHidden: el.getAttribute('aria-hidden'),
  })));
const assertShellInert = async (page, why) => {
  const st = await shellProbeState(page);
  assert.ok(st.length > 3, why + ': shell probe captured the shell (' + st.length + ' elements)');
  assert.ok(st.every(s => s.inert && s.ariaHidden === 'true'),
    why + ': every shell element inert + aria-hidden behind the overlay');
  return st.length;
};
const assertShellRestored = async (page, why, exceptIds = []) => {
  const st = await shellProbeState(page);
  const bad = st.filter(s => !exceptIds.includes(s.id) && (s.inert || s.ariaHidden !== null));
  assert.equal(bad.length, 0, why + ': no boot-applied inert/aria-hidden left on the shell ' + JSON.stringify(bad));
  return st;
};

// Intercept a fresh page: static files from serveDir/public, /data.json
// answered by dataPlan(callIndex) -> { delayMs, status }.
// extra.htmlPatch(rel, bodyString) may rewrite a served document
// (used once, for the prior-state fixture in the early-ready run).
async function openPage(browser, serveDir, contextOpts, dataPlan, extra = {}) {
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
    let body = fs.readFileSync(file);
    if (extra.htmlPatch && rel.endsWith('.html')) body = Buffer.from(extra.htmlPatch(rel, body.toString('utf8')), 'utf8');
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
    // 1 — Budget direct entry, light, long fixed delay (5000ms):
    // visibility sampling, no-flash at removal, then a 9000ms run for
    // full-viewport coverage, header hit-testing, and block geometry
    // sampled across the animation loop.
    {
      const { context, page, servedSha } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 5000, status: 200 }));
      const run = await sampleLoad(page, '/');
      assert.ok(run.firstVisibleMs !== null, 'treatment became visible during the load');
      assert.equal(run.gapCount, 0, 'no treatment visibility gaps observed after first visibility (~100ms sampling)');
      const noFlash = run.samples.every(s => s.ms <= run.firstVisibleMs || s.anyVisible || s.contentChars > 20);
      assert.ok(noFlash, 'the removal sample coincides with rendered content (no flash of bare shell)');
      const end = await page.evaluate(visFn);
      assert.ok(!end.staticLayer.present && !end.liveLayer.present, 'both layers gone after arrival');
      results.lightLong = { delayMs: 5000, treatmentFirstVisibleMs: run.firstVisibleMs, contentRenderedMs: run.contentMs, samples: run.samples.length, visibilityGapsObserved: run.gapCount, noFlashAtRemoval: noFlash, servedSha };
      await context.close();
      // Geometry/coverage needs its own longer held run.
      const again = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 9000, status: 200 }));
      const nav = again.page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(again.page);
      await shot(again.page, 'boot-treatment-light.png');
      const noticeRect = await rectOf(again.page, '[data-boot-notice]');
      assert.ok(coversViewport(noticeRect), 'live overlay covers the full viewport at 1440 light ' + JSON.stringify(noticeRect));
      const headerHit = await again.page.evaluate(() => {
        const head = document.querySelector('.site-head');
        const r = head.getBoundingClientRect();
        const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return el ? (el.closest('[data-boot-notice]') ? 'notice' : 'other:' + el.tagName) : null;
      });
      assert.equal(headerHit, 'notice', 'the header region is covered by the boot overlay (hit test)');
      const animName = await markAnimName(again.page, '[data-boot-treatment]');
      assert.equal(animName, 'boot-blocks', 'brand blocks animate with the phased boot-blocks loop while loading');
      const geo = await markGeometry(again.page, '[data-boot-treatment]');
      assert.ok(geo && geo.blocks === 4, 'four animated blocks in the live mark');
      assert.ok(geo.ranges.every(r => r >= 0.8),
        'block geometry changes across the loop (separate/bump/settle), per-block centre-distance ranges ' + JSON.stringify(geo.ranges));
      results.lightLong.markAnimationName = animName;
      results.lightLong.overlayCoversViewport1440 = true;
      results.lightLong.headerCoveredByHitTest = true;
      results.lightLong.blockSeparationRangesPx = geo.ranges;
      results.lightLong.geometryRunDelayMs = 9000;
      await nav; await waitContent(again.page);
      await shot(again.page, 'boot-treatment-after.png');
      await again.context.close();
    }
    // 2 — Budget direct entry, dark, 1500ms delay: coverage + motion.
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
        () => ({ delayMs: 1500, status: 200 }));
      const nav = page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const tVis = Date.now();
      const noticeRect = await rectOf(page, '[data-boot-notice]');
      assert.ok(coversViewport(noticeRect), 'live overlay covers the full viewport at 1440 dark');
      const animName = await markAnimName(page, '[data-boot-treatment]');
      assert.equal(animName, 'boot-blocks', 'dark: blocks animate while loading');
      await shot(page, 'boot-treatment-dark.png');
      await nav; await waitContent(page);
      const end = await page.evaluate(visFn);
      assert.ok(!end.staticLayer.present && !end.liveLayer.present, 'dark: layers gone after arrival');
      results.dark = { delayMs: 1500, treatmentVisibleObserved: true, overlayCoversViewport1440: true, markAnimationName: animName, screenshotAtMs: tVis };
      await context.close();
    }
    // 3 — Reduced motion, narrow width: overlay covers 320px, the mark
    // is fully static (animation none, block centres stable).
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 320, height: 700 }, colorScheme: 'light', reducedMotion: 'reduce' },
        () => ({ delayMs: 2500, status: 200 }));
      const nav = page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const noticeRect = await rectOf(page, '[data-boot-notice]');
      assert.ok(coversViewport(noticeRect), 'live overlay covers the full viewport at 320');
      const animName = await markAnimName(page, '[data-boot-treatment]');
      assert.equal(animName, 'none', 'reduced motion: block animation is none');
      const centres1 = await markCentres(page, '[data-boot-treatment]');
      const box = await page.evaluate(() => {
        const el = document.querySelector('[data-boot-treatment]');
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
      const first = await page.screenshot({ clip });
      await sleep(700);
      const centres2 = await markCentres(page, '[data-boot-treatment]');
      const drift = Math.max(...centres1.map((c, i) => Math.hypot(c.cx - centres2[i].cx, c.cy - centres2[i].cy)));
      assert.ok(drift <= 0.6, 'reduced motion: block centres stable across 700ms (drift ' + drift + 'px)');
      const second = await page.screenshot({ clip });
      assert.ok(first.equals(second), 'reduced motion: treatment frame is byte-stable across 700ms');
      await shot(page, 'boot-treatment-reduced-motion.png');
      await nav; await waitContent(page);
      results.reducedMotion = { delayMs: 2500, animationName: animName, blockCentreDriftPx: drift, frameStable: true, overlayCoversViewport320: true };
      await context.close();
    }
    // 4 — Direct entry at another route (/bills.html), mobile width:
    // the live layer is full-viewport there too; no static layer
    // off-index; in-content note-boxes (if the page renders any) are
    // never fixed overlays.
    {
      const { context, page, servedSha } = await openPage(browser, serveRoot,
        { viewport: { width: 390, height: 844 }, colorScheme: 'light' },
        () => ({ delayMs: 1500, status: 200 }));
      const nav = page.goto('http://boot.test/bills.html', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const noticeRect = await rectOf(page, '[data-boot-notice]');
      assert.ok(coversViewport(noticeRect), 'live overlay covers the full viewport at 390 on /bills.html');
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
      const inContent = await page.evaluate(() =>
        [...document.querySelectorAll('.note-box:not([data-boot-notice])')]
          .map(el => getComputedStyle(el).position));
      assert.ok(inContent.every(p => p !== 'fixed'), 'bills: in-content note-boxes are never fixed overlays');
      results.billsDirectEntry = { delayMs: 1500, liveLayerVisible: true, overlayCoversViewport390: true, inContentNoteBoxesSeen: inContent.length, servedSha };
      await context.close();
    }
    // 5 — Failure, then Retry: the crit surface is the full-screen
    // overlay with NO treatment and NO running animation anywhere in
    // the notice, its class is exactly the crit class (no is-loading
    // semantics persist), the shell stays inert behind it, and Retry
    // is operable by keyboard (focus + Enter) and by touch (tap).
    // First failure -> keyboard retry -> second failure -> touch
    // retry -> success, with the shell restored at the end.
    {
      let call = 0;
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light', hasTouch: true },
        () => { call++; if (call === 1) return { delayMs: 1500, status: 503 }; if (call === 2) return { delayMs: 1200, status: 503 }; return { delayMs: 2000, status: 200 }; });
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const probed = await stashShellProbe(page);
      await assertShellInert(page, 'failure run, first pending');
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Current data could not be loaded'), { timeout: 15000 });
      let st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present && !st.staticLayer.present, 'no treatment on the crit surface');
      const crit = await page.evaluate(() => {
        const n = document.querySelector('[data-boot-notice]');
        return { cls: n.className, text: n.innerText.trim() };
      });
      assert.equal(crit.cls, 'note-box crit', 'crit surface carries exactly the crit class — no is-loading state persists');
      assert.ok(crit.text.startsWith('Current data could not be loaded. Figures remain unavailable.'), 'exact failure text on the crit surface');
      const critRect = await rectOf(page, '[data-boot-notice]');
      assert.ok(coversViewport(critRect), 'crit overlay covers the full viewport');
      assert.equal(await noticeAnimations(page), 0, 'crit surface: no running animation anywhere in the notice');
      await assertShellInert(page, 'failure run, crit surface');
      const retryVisible = await page.locator('.note-box button', { hasText: 'Retry' }).isVisible();
      assert.ok(retryVisible, 'Retry button visible on the crit surface');
      await shot(page, 'boot-treatment-crit.png');
      // Keyboard operability: focus the Retry button and press Enter.
      await page.locator('.note-box button', { hasText: 'Retry' }).focus();
      const focusedRetry = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
      assert.equal(focusedRetry, 'Retry', 'Retry is keyboard-focusable on the crit surface');
      await page.keyboard.press('Enter');
      await treatmentVisible(page);
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Current data could not be loaded'), { timeout: 15000 });
      assert.equal(await noticeAnimations(page), 0, 'second crit surface: motion still fully stopped');
      // Touch operability: tap the Retry button.
      await page.locator('.note-box button', { hasText: 'Retry' }).tap();
      await treatmentVisible(page);
      await shot(page, 'boot-treatment-retry.png');
      await waitContent(page);
      st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'treatment removed after retry success');
      await assertShellRestored(page, 'failure run, after retry success');
      results.failureRetry = { critTreatmentAbsent: true, critCoversViewport: true, critClassExact: true, critAnimationsRunning: 0, shellInertDuringCrit: true, retryKeyboardOperable: true, retryTouchOperable: true, retryTreatmentVisible: true, removedAfterRetrySuccess: true, shellRestoredAfterSuccess: true, shellElementsProbed: probed };
      await context.close();
    }
    // 6 — Cancel twice, then Retry to success: the cancelled surface
    // is the same static full-screen overlay (exact cancelled text,
    // no motion, shell still inert); Cancel is focusable during the
    // load and operable by touch and mouse across repeated cycles;
    // the shell is restored exactly once the boot resolves.
    {
      let calls = 0;
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light', hasTouch: true },
        () => (++calls <= 2 ? { delayMs: 5000, status: 200 } : { delayMs: 1500, status: 200 }));
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const probed = await stashShellProbe(page);
      await assertShellInert(page, 'cancel run, first pending');
      await page.locator('.note-box button', { hasText: 'Cancel' }).focus();
      const focusedCancel = await page.evaluate(() => document.activeElement && document.activeElement.textContent.trim());
      assert.equal(focusedCancel, 'Cancel', 'Cancel is keyboard-focusable during the load');
      await page.locator('.note-box button', { hasText: 'Cancel' }).tap();
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Loading cancelled.'), { timeout: 10000 });
      let st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'no treatment after Cancel');
      const cancelled = await page.evaluate(() => {
        const n = document.querySelector('[data-boot-notice]');
        return { cls: n.className, text: n.innerText.trim() };
      });
      assert.equal(cancelled.cls, 'note-box crit', 'cancelled surface carries exactly the crit class');
      assert.ok(cancelled.text.startsWith('Loading cancelled. Figures remain unavailable.'), 'exact cancelled text');
      const cancelRect = await rectOf(page, '[data-boot-notice]');
      assert.ok(coversViewport(cancelRect), 'cancelled overlay covers the full viewport');
      assert.equal(await noticeAnimations(page), 0, 'cancelled surface: no running animation in the notice');
      await assertShellInert(page, 'cancel run, cancelled surface');
      await shot(page, 'boot-treatment-cancel.png');
      // Second cycle: touch Retry, mouse Cancel, mouse Retry.
      await page.locator('.note-box button', { hasText: 'Retry' }).tap();
      await treatmentVisible(page);
      await page.locator('.note-box button', { hasText: 'Cancel' }).click();
      await page.waitForFunction(() => document.querySelector('.note-box')
        && document.querySelector('.note-box').innerText.includes('Loading cancelled.'), { timeout: 10000 });
      await assertShellInert(page, 'cancel run, second cancelled surface');
      await page.locator('.note-box button', { hasText: 'Retry' }).click();
      await treatmentVisible(page);
      await waitContent(page);
      st = await page.evaluate(visFn);
      assert.ok(!st.liveLayer.present, 'treatment removed after cancel-retry success');
      await assertShellRestored(page, 'cancel run, after final success');
      results.cancelRetry = { cancelTreatmentAbsent: true, cancelledCoversViewport: true, cancelledClassExact: true, cancelledAnimationsRunning: 0, cancelFocusableDuringLoad: true, cancelTouchOperable: true, cyclesCompleted: 2, shellInertThroughCycles: true, removedAfterRetrySuccess: true, shellRestoredAfterSuccess: true, shellElementsProbed: probed };
      await context.close();
    }
    // 7 — Static layer standalone, a small matrix: with JavaScript
    // disabled nothing can remove it, which both proves it renders on
    // its own at first paint — full-viewport at desktop and mobile
    // sizes in both schemes, blocks animating (or fully static under
    // reduced motion) — and demonstrates the accepted limitation
    // (scripts never running leaves it in place, like the shell's
    // static status text today).
    {
      const configs = [
        { name: 'w1440-light', viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
        { name: 'w1440-dark', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
        { name: 'w390-light', viewport: { width: 390, height: 844 }, colorScheme: 'light' },
        { name: 'w320-dark', viewport: { width: 320, height: 700 }, colorScheme: 'dark' },
        { name: 'w390-reduced', viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce' },
      ];
      const matrix = {};
      for (const cfg of configs) {
        const { context, page } = await openPage(browser, serveRoot,
          { viewport: cfg.viewport, colorScheme: cfg.colorScheme, reducedMotion: cfg.reducedMotion || 'no-preference', javaScriptEnabled: false },
          () => ({ delayMs: 0, status: 200 }));
        await page.goto('http://boot.test/', { waitUntil: 'load' });
        const st = await page.evaluate(visFn);
        assert.ok(st.staticLayer.visible, 'static layer computed-visible without JavaScript (' + cfg.name + ')');
        assert.ok(!st.liveLayer.present, 'no live layer without JavaScript (' + cfg.name + ')');
        const r = await rectOf(page, '[data-boot-static]');
        assert.ok(coversViewport(r), 'static layer covers the full viewport (' + cfg.name + ')');
        const entry = { computedVisible: true, coversViewport: true };
        if (cfg.name === 'w1440-light') {
          const pe = await page.evaluate(() => getComputedStyle(document.querySelector('[data-boot-static]')).pointerEvents);
          assert.equal(pe, 'none', 'static layer never intercepts pointer events');
          const animName = await markAnimName(page, '[data-boot-static]');
          assert.equal(animName, 'boot-blocks', 'static layer blocks animate with the same phased loop');
          const geo = await markGeometry(page, '[data-boot-static]');
          assert.ok(geo && geo.blocks === 4 && geo.ranges.every(x => x >= 0.8),
            'static layer block geometry changes across the loop ' + JSON.stringify(geo && geo.ranges));
          entry.pointerEvents = pe;
          entry.markAnimationName = animName;
          entry.blockSeparationRangesPx = geo.ranges;
          await shot(page, 'boot-treatment-static.png');
        }
        if (cfg.reducedMotion) {
          const animName = await markAnimName(page, '[data-boot-static]');
          assert.equal(animName, 'none', 'static layer reduced motion: block animation is none');
          const c1 = await markCentres(page, '[data-boot-static]');
          await sleep(700);
          const c2 = await markCentres(page, '[data-boot-static]');
          const drift = Math.max(...c1.map((c, i) => Math.hypot(c.cx - c2[i].cx, c.cy - c2[i].cy)));
          assert.ok(drift <= 0.6, 'static layer reduced motion: block centres stable (drift ' + drift + 'px)');
          entry.markAnimationName = animName;
          entry.blockCentreDriftPx = drift;
        }
        matrix[cfg.name] = entry;
        await context.close();
      }
      results.staticStandalone = matrix;
    }
    // 8 — Inertness and focus during a held load: Tab can never land
    // on a shell control behind the overlay, programmatic focus on a
    // header control is denied, the notice's Cancel IS reachable —
    // and after arrival the shell is fully restored and a header
    // control takes focus and clicks again.
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 6000, status: 200 }));
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await treatmentVisible(page);
      const probed = await stashShellProbe(page);
      await assertShellInert(page, 'inertness run, held load');
      const denied = await page.evaluate(() => {
        const btn = document.querySelector('[data-blend-theme], #theme-btn');
        if (!btn) return 'missing';
        btn.focus();
        return document.activeElement === btn ? 'focused' : 'denied';
      });
      assert.equal(denied, 'denied', 'programmatic focus on a covered header control is denied while inert');
      const zones = [];
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press('Tab');
        zones.push(await page.evaluate(() => {
          const a = document.activeElement;
          if (!a || a === document.body) return 'body';
          if (a.closest('[data-boot-notice]')) return 'notice';
          if (a.closest('.site-head')) return 'head';
          if (a.closest('.wrap')) return 'wrap';
          return 'other';
        }));
      }
      assert.ok(zones.includes('notice'), 'Tab reaches the notice (Cancel) during the held load: ' + zones.join(','));
      assert.ok(zones.every(z => z === 'notice' || z === 'body' || z === 'other'),
        'Tab never lands on a shell control behind the overlay: ' + zones.join(','));
      await waitContent(page);
      await assertShellRestored(page, 'inertness run, after arrival');
      const probe = await page.evaluate(() => {
        const btn = document.querySelector('[data-blend-theme], #theme-btn');
        if (!btn) return { missing: true };
        let fired = false;
        btn.addEventListener('click', () => { fired = true; }, { once: true });
        btn.focus();
        const focusedOk = document.activeElement === btn;
        btn.click();
        return { focusedOk, fired };
      });
      assert.ok(probe.focusedOk && probe.fired, 'header control is focusable and clickable again after arrival');
      results.inertFocus = { shellElementsProbed: probed, tabZonesSeen: zones, cancelReachableByTab: true, shellFocusDeniedDuringLoad: true, headerControlOperableAfterArrival: true, shellRestoredAfterArrival: true };
      await context.close();
    }
    // 9 — Early-ready: the load resolves almost immediately, so the
    // overlay barely paints. The restore path must still run
    // completely: no residual inert/aria-hidden anywhere boot applied
    // it, and an element that was ALREADY inert + aria-hidden before
    // boot (fixture: the served index.html carries inert +
    // aria-hidden="true" on #risks) keeps exactly that prior state —
    // restore returns prior state, it does not blanket-clear.
    // 10 — In-content crit isolation, on the same arrived page: a
    // rendered .note-box.crit without [data-boot-notice] is not an
    // overlay, by computed style.
    {
      const { context, page } = await openPage(browser, serveRoot,
        { viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
        () => ({ delayMs: 0, status: 200 }),
        {
          htmlPatch: (rel, body) => rel === 'index.html'
            ? body.replace('<section id="risks">', '<section id="risks" inert aria-hidden="true">')
            : body,
        });
      await page.goto('http://boot.test/', { waitUntil: 'commit' });
      await waitContent(page);
      await shot(page, 'boot-treatment-ready.png');
      const state = await page.evaluate(() => {
        const risks = document.querySelector('#risks');
        const others = [document.querySelector('.site-head'),
          ...document.querySelectorAll('.wrap > *')].filter(Boolean)
          .filter(el => el !== risks && !el.hasAttribute('data-boot-notice'));
        return {
          noticePresent: !!document.querySelector('[data-boot-notice]'),
          risks: { inert: !!risks.inert, ariaHidden: risks.getAttribute('aria-hidden') },
          othersCount: others.length,
          othersDirty: others.filter(el => el.inert || el.getAttribute('aria-hidden') !== null).length,
        };
      });
      assert.ok(!state.noticePresent, 'early-ready: boot notice removed after the fast load');
      assert.equal(state.othersDirty, 0, 'early-ready: zero residual inert/aria-hidden on the ' + state.othersCount + ' shell elements boot touched');
      assert.ok(state.risks.inert && state.risks.ariaHidden === 'true',
        'early-ready: the pre-existing inert + aria-hidden state on #risks is preserved exactly (prior-state restore)');
      const probe = await page.evaluate(() => {
        const btn = document.querySelector('[data-blend-theme], #theme-btn');
        if (!btn) return { missing: true };
        btn.focus();
        return { focusedOk: document.activeElement === btn };
      });
      assert.ok(probe.focusedOk, 'early-ready: header control focusable after the fast load');
      results.earlyReady = { delayMs: 0, noticeRemoved: true, residualInertOnTouchedShell: 0, priorStatePreservedOnFixtureElement: '#risks (inert + aria-hidden="true" in the served fixture)', headerControlFocusable: true, fixturePatchedIndex: 'served index.html carried inert + aria-hidden="true" on #risks for this run only' };
      const isolation = await page.evaluate(() => {
        const real = [...document.querySelectorAll('.note-box:not([data-boot-notice])')]
          .map(el => getComputedStyle(el).position);
        const host = document.querySelector('#today') || document.body;
        const div = document.createElement('div');
        div.className = 'note-box crit';
        div.textContent = 'CSS scoping probe';
        host.append(div);
        const cs = getComputedStyle(div);
        const r = div.getBoundingClientRect();
        const out = {
          probePosition: cs.position,
          probeCoversViewport: Math.abs(r.width - innerWidth) <= 1 && Math.abs(r.height - innerHeight) <= 1,
          realPositions: real,
        };
        div.remove();
        return out;
      });
      assert.notEqual(isolation.probePosition, 'fixed', 'a .note-box.crit without [data-boot-notice] is not position:fixed');
      assert.ok(!isolation.probeCoversViewport, 'a .note-box.crit without [data-boot-notice] does not cover the viewport');
      assert.ok(isolation.realPositions.every(p => p !== 'fixed'), 'rendered in-content note-boxes are never fixed');
      results.critIsolation = { probePosition: isolation.probePosition, probeCoversViewport: false, renderedInContentNoteBoxesSeen: isolation.realPositions.length, method: 'computed-style probe: a .note-box.crit element without the attribute, plus every rendered in-content note-box on the arrived page' };
      await context.close();
    }
    // Direct routes, counted from source: the HTML documents in the
    // served tree's public/ directory. The live layer reaches every
    // one of them through the shared App.boot; the static layer is
    // index.html only.
    const htmlDocs = fs.readdirSync(path.join(serveRoot, 'public')).filter(f => f.endsWith('.html')).sort();
    results.directRoutes = { htmlDocumentsInPublic: htmlDocs.length, documents: htmlDocs, countedFrom: 'public/ listing of the served tree at proof time' };
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
    // Repeated nav->content measures under an identical fixed delay,
    // alternating branch/base per round so slow drift hits both trees.
    // Timing evidence only: the per-round paired deltas vary more than
    // either aggregate (the fixture's post-arrival render dominates and
    // fluctuates by ~1s between identical runs), so both aggregates are
    // recorded as labelled measurements and the comparison is reported
    // as inconclusive — no no-delay conclusion is drawn from them.
    let repeatedTimingMeasures = null;
    if (baseRoot) {
      const measureContentMs = async serveDir => {
        const s = await openPage(browser, serveDir,
          { viewport: { width: 1280, height: 900 }, colorScheme: 'light' },
          () => ({ delayMs: 5000, status: 200 }));
        const t0 = Date.now();
        const nav = s.page.goto('http://boot.test/', { waitUntil: 'commit' });
        await s.page.waitForFunction(() => {
          const c = document.querySelector('#operating-surface');
          return c && (c.innerText || '').trim().length > 20;
        }, { timeout: 30000 });
        const ms = Date.now() - t0;
        await nav;
        await s.context.close();
        return ms;
      };
      const branchMs = [];
      const baseMs = [];
      for (let round = 0; round < 3; round++) {
        branchMs.push(await measureContentMs(serveRoot));
        baseMs.push(await measureContentMs(baseRoot));
      }
      const median = xs => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const pairedDeltasMs = branchMs.map((ms, i) => ms - baseMs[i]);
      const branchMedianMs = median(branchMs);
      const baseMedianMs = median(baseMs);
      repeatedTimingMeasures = {
        method: 'same nav->content measurement as the base comparison, fixed 5000ms /data.json delay, 3 alternating rounds per tree, headless Chromium on this machine',
        branchMs,
        baseMs,
        pairedDeltasMs,
        branchMedianMs,
        baseMedianMs,
        medianPairedDeltaMs: median(pairedDeltasMs),
        differenceOfMediansMs: branchMedianMs - baseMedianMs,
        conclusion: 'inconclusive',
        note: 'Per-round paired deltas vary more than either aggregate; the fixture post-arrival render dominates and fluctuates by ~1s between identical runs. These aggregates are measurements only and do not establish that the treatment adds no delay. The supported claim is narrower: the treatment adds no new blocking assets.',
      };
    }
    const receipt = {
      proof: 'browser-boot-treatment',
      baseMainSha: 'a96f911c252431ca4cfb2aba7bfda79134388d69',
      claim: CLAIM,
      scenarios: results,
      baseComparison: comparison,
      screenshots: shots,
      repeatedTimingMeasures,
    };
    fs.writeFileSync(path.join(outDir, 'boot-treatment-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log('PASS boot treatment proof: ' + Object.keys(results).length + ' scenarios; timings '
      + JSON.stringify({ lightLong: { firstVisibleMs: results.lightLong.treatmentFirstVisibleMs, contentMs: results.lightLong.contentRenderedMs }, baseComparison: comparison, repeatedTimingMeasures }));
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
