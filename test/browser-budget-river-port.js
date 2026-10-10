'use strict';
// Real native selection while a mouse/touch gesture is still held. Synthetic
// fixture data only; expected dates come from native publications, not this port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const riverHarnessHtml = theme => '<!doctype html><html data-theme="' + theme + '"><head><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/budget-blend.css"><link rel="stylesheet" href="/budget-gface.css"><script src="/budget-river.js"></script></head><body></body></html>';

async function proveRiverPort({ open, capture }) {
  const cases = [];
  for (const width of [1440, 935, 390, 320]) for (const theme of ['light', 'dark']) {
    const data = width === 935 ? require('./fixtures/budget-surface-data').served() : null;
    if (data) for (let i = 0; i < 24; i++) data.plan.bills.push({id:'stress-bill-'+i,label:'Synthetic recurring bill '+i,
      frequency:'monthly',day:i+1,amount:12+i,confidence:'confirmed',payingAccount:'chequing-a'});
    const page = await open(width, theme, data ? { data } : {});
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.t-river')).opacity) === 1);
    const before = await page.evaluate(width => {
      const river = document.querySelector('.river');
      const selected = Number(river.getAttribute('aria-valuenow')) - 1;
      const rows = [...document.querySelector('ol[data-bad-timeline]').children];
      const target = rows[selected + 1];
      window.__heldRiverElement = river;
      window.__heldRiverLabels = [...river.querySelectorAll('.rv')];
      window.__heldAurora = document.querySelector('.blend-aurora');
      window.__heldFocusEvents = [];
      document.addEventListener('focusin', e => {
        if (e.target.closest('[data-budget-wheel]')) window.__heldFocusEvents.push(e.target.className);
      });
      const label = river.querySelector('.rv.is-sel').getBoundingClientRect();
      const rect = river.getBoundingClientRect(), mobile = rect.width < 640;
      const fit = (rect.width - (mobile ? 52 : 72)) / (rows.length - 1);
      const pan = fit < (mobile ? 44 : 52);
      return { selected, height: rect.height, radius: getComputedStyle(river.parentElement).borderRadius,
        theme: river.parentElement.dataset.riverTheme, start: target.dataset.badTimelineStart,
        period: target.dataset.badTimelinePeriod, range: target.dataset.badTimelineRangeLabel,
        x: label.left + label.width / 2, y: label.top + label.height / 2,
        spacing: pan ? (mobile ? 44 : 52) : fit, pan };
    }, width);
    // Owner-approved shorter tile (Atlas decision, 2026-10-10): 123px desktop /
  // 114px mobile. The prototype fixture below keeps the original 164/152.
  assert.equal(before.height, width < 760 ? 114 : 123, 'approved tile height');
    assert.equal(before.radius, width < 760 ? '24px' : '28px', 'source radius');
    assert.equal(before.theme, theme);
    await page.mouse.move(before.x, before.y); await page.mouse.down();
    // Original gesture directions differ between fitting and panning ranges.
    await page.mouse.move(before.x + (before.pan ? -before.spacing : before.spacing), before.y, { steps: 8 });
    await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start === start, before.start);
    const held = await page.evaluate(() => ({
      start: document.querySelector('[data-budget-window-progress]').dataset.start,
      period: document.querySelector('.blend-hero [data-bad-terms]').dataset.badTermsPeriod,
      range: document.querySelector('.blend-hero-range').textContent.replace(/\s+/g, ' ').trim(),
      dragging: document.querySelector('.river').classList.contains('is-dragging'),
      sameElement: document.querySelector('.river') === window.__heldRiverElement,
      sameLabels: [...document.querySelectorAll('.river .rv')].every((node, i) => node === window.__heldRiverLabels[i]),
      sameAurora: document.querySelector('.blend-aurora') === window.__heldAurora,
      hiddenWheelFocus: window.__heldFocusEvents.length,
      opacity: Number(getComputedStyle(document.querySelector('.t-river')).opacity),
      nativeAmount: document.querySelector('.blend-hero [data-bad-term="balanceAfterDeductions"] [data-bad-term-amount]').textContent,
    }));
    assert.equal(held.start, before.start, 'native date changes before release');
    assert.equal(held.period, before.period, 'hero prints the selected native period before release');
    assert.equal(held.range.replace(/\s/g, ''), before.range.replace(/\s/g, ''), 'visible tile date agrees before release');
    assert.equal(held.dragging, true, 'gesture remains held across native remount');
    assert.equal(held.sameElement, true, 'original controller survives native remount');
    assert.equal(held.sameLabels, true, 'held selection retains the original label nodes without rebuilding the year');
    assert.equal(held.sameAurora, true, 'held selection retains the original WebGL canvas');
    assert.equal(held.hiddenWheelFocus, 0, 'held selection never focuses the hidden native chooser');
    assert.equal(held.opacity, 1, 'native remount does not replay the entrance while held');
    // Keep the same gesture held through a second native tile replacement.
    const second = await page.evaluate(i => {
      const row = document.querySelector('ol[data-bad-timeline]').children[i];
      return { start: row.dataset.badTimelineStart, period: row.dataset.badTimelinePeriod };
    }, before.selected + 2);
    await page.mouse.move(before.x + (before.pan ? -2 : 2) * before.spacing, before.y, { steps: 8 });
    await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start === start, second.start);
    assert.equal(await page.evaluate(() => document.querySelector('.river') === window.__heldRiverElement && document.querySelectorAll('.g-river-wrap').length === 1), true);
    assert.equal(await page.locator('.t-river').evaluate(el=>Number(getComputedStyle(el).opacity)),1,'second held remount stays visible');
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('.river .rv')].every((node, i) => node === window.__heldRiverLabels[i])
      && document.querySelector('.blend-aurora') === window.__heldAurora && window.__heldFocusEvents.length === 0), true, 'second held update retains artwork and label nodes without hidden focus');
    // Cancellation aligns with the last actual native publication, without fling.
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.river').classList.contains('is-dragging'));
    assert.equal(await page.locator('[data-budget-window-progress]').getAttribute('data-start'), second.start);
    assert.equal(await page.evaluate(() => document.querySelector('.river') === document.activeElement), true, 'cancelled gesture keeps visible selector focus');
    await page.locator('.river').focus(); await page.keyboard.press('t');
    await page.waitForFunction(() => document.querySelector('ol[data-bad-timeline] > [data-bad-timeline-role="current"]')?.dataset.badTimelineStart === document.querySelector('[data-budget-window-progress]')?.dataset.start);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[data-blend-river-today]')?.classList.contains('on'));
    await page.locator('[data-blend-river-today]').click();
    await page.waitForFunction(() => !document.querySelector('[data-blend-river-today]')?.classList.contains('on'));
    let touch = null;
    if (width === 390) {
      await page.waitForFunction(() => document.querySelector('.river')?.dataset.riverMotion === 'settled');
      const point = await page.evaluate(() => {const river=document.querySelector('.river'),b=river.querySelector('.rv.is-sel').getBoundingClientRect(),rows=[...document.querySelector('ol[data-bad-timeline]').children],i=+river.getAttribute('aria-valuenow')-1;return{x:b.left+b.width/2,y:b.top+b.height/2,start:rows[i+1].dataset.badTimelineStart}});
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true});
      await page.evaluate(()=>{window.__touchTrace=[];for(const type of ['pointerdown','pointermove','pointercancel','lostpointercapture'])window.addEventListener(type,e=>__touchTrace.push([type,e.pointerId,e.clientX,e.clientY,e.target.className]))});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y}]});
      for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-step*44/8,y:point.y}]});
      await page.waitForFunction(start=>document.querySelector('[data-budget-window-progress]')?.dataset.start===start,point.start);
      assert.equal(await page.locator('.river').evaluate(el=>el.classList.contains('is-dragging')),true,'touch updates before release: '+JSON.stringify(await page.evaluate(()=>__touchTrace)));
      await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
      await page.waitForFunction(()=>!document.querySelector('.river').classList.contains('is-dragging'));
      assert.equal(await page.locator('[data-budget-window-progress]').getAttribute('data-start'),point.start);
      await cdp.detach();touch={nativeBeforeRelease:true,cancelPreservesNative:true};
      await page.keyboard.press('t');
    }
    cases.push({ width, theme, dragFromAmount: true, beforeRelease: held, secondHeldPublication: second, cancelPreservesNative: true, returnCurrent: true, touch });
    await page.waitForFunction(() => document.querySelector('.river')?.dataset.riverMotion === 'settled');
    await page.evaluate(()=>window.scrollTo(0,0));
    if (capture) await capture(page, 'budget-river-port-' + width + '-' + theme + '.png');
    if (width === 935) {
      const beforeRefresh = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.river .rv')];
        window.__beforeRefreshLabels = labels;
        window.__beforeRefreshCanvas = document.querySelector('.river canvas');
        const old = labels.map(node => node.dataset.riverNativeValue).join('|');
        // Invented fixture change, passed through the real App -> Forecast ->
        // native printer path. Same dates must not make retained labels stale.
        App.data.plan.income[0].amount += 111.11;
        App.rerender(); return old;
      });
      await page.waitForFunction(old => [...document.querySelectorAll('.river .rv')].map(node => node.dataset.riverNativeValue).join('|') !== old, beforeRefresh);
      const refreshed = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('.river .rv')];
        const rows = [...document.querySelector('ol[data-bad-timeline]').children];
        return { sameCanvas: document.querySelector('.river canvas') === window.__beforeRefreshCanvas,
          rebuiltLabels: labels.some((node,i) => node !== window.__beforeRefreshLabels[i]),
          faithful: labels.every((node,i) => (['calculated','estimated'].includes(rows[i]?.dataset.badTermTrust)
            ? rows[i].querySelector('[data-bad-term-amount]')?.textContent.replace(/\s+/g,' ').trim() : 'Unavailable') === node.dataset.riverNativeValue) };
      });
      assert.deepEqual(refreshed, { sameCanvas:true, rebuiltLabels:true, faithful:true }, 'new same-date native publication replaces stale labels without discarding the canvas');
      cases.at(-1).publicationRefresh = refreshed;
    }
    for(let cycle=0;cycle<3;cycle++) {
      await page.locator('[data-blend-theme]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(await page.locator('.t-river').getAttribute('data-river-theme')!==theme)break;
    }
    await page.waitForFunction(theme=>document.querySelector('.t-river')?.dataset.riverTheme!==theme,theme);
    for(let cycle=0;cycle<3;cycle++) {
      await page.locator('[data-blend-theme]').click();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      if(await page.locator('.t-river').getAttribute('data-river-theme')===theme)break;
    }
    await page.waitForFunction(theme=>document.querySelector('.t-river')?.dataset.riverTheme===theme,theme);
    await page.evaluate(()=>document.documentElement.removeAttribute('data-theme'));
    await page.emulateMedia({colorScheme:theme==='dark'?'light':'dark'});
    await page.waitForFunction(theme=>document.querySelector('.t-river')?.dataset.riverTheme!==theme,theme);
    await page.close();
  }
  const paired = await proveOriginal({ open, capture });
  return { nativeLiveDrag: cases, originalComparison: paired };
}

async function proveOriginal({ open, capture }) {
  const originalJs = fs.readFileSync(path.join(__dirname, 'fixtures/g-blend-river-original.js'), 'utf8');
  const originalCss = fs.readFileSync(path.join(__dirname, 'fixtures/g-blend-river-original.css'), 'utf8');
  const results = [];
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    const page = await open(width, theme, { riverHarness: true });
    await page.addScriptTag({ content: originalJs });
    await page.addStyleTag({ content: originalCss + '\n.original-reference {--r-tile:28px;--river-bg:#0b0c10;--rx:0deg;--ry:0deg;--ease:cubic-bezier(.2,.8,.2,1);--ease-out:cubic-bezier(.16,1,.3,1);--ease-spring:cubic-bezier(.34,1.4,.64,1); } .original-reference .tile {border:0} @keyframes tile-in{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:rotateX(var(--rx)) rotateY(var(--ry))}} @media(max-width:759px){.original-reference .tile.t-river{height:152px;--r-tile:24px}}' });
    const setup = await page.evaluate(() => {
      // Fixed invented publications only. Never import the mockup's data.js or calculators.
      const periods = [
        ['2026-08-14','2026-08-27',1200,'healthy'], ['2026-08-28','2026-09-10',-420,'short'],
        ['2026-09-11','2026-09-24',0,'healthy'], ['2026-09-25','2026-10-08',700,'healthy'],
        ['2026-10-09','2026-10-22',-80,'short'], ['2026-10-23','2026-11-05',1500,'healthy'],
        ['2026-11-06','2026-11-19',300,'healthy'], ['2026-11-20','2026-12-03',900,'healthy'],
      ].map(([start,end,bad,state], i) => ({start,end,bad,state,role:i<2?'past':i===2?'current':'future'}));
      document.body.innerHTML = '<main id="river-pair"></main>';
      const tree = '<nav class="tile t-river"><div class="river" tabindex="0"><canvas class="river-canvas"></canvas><div class="river-slide"><div class="river-vals"></div><div class="months"></div></div><div class="playhead"><div class="playhead-pill"><span>Test publication</span><b>$0.00</b></div><span class="playhead-beam"></span><span class="playhead-orb"></span></div></div></nav>';
      const host = document.querySelector('main'); host.style.padding = '12px';
      const original = document.createElement('section'); original.className = 'original-reference'; original.innerHTML = '<p>Original source (dark river in both themes)</p>' + tree; host.appendChild(original);
      const candidate = document.createElement('section'); candidate.className = 'budget-bento atlas-g'; candidate.innerHTML = '<p>Atlas source port (' + document.documentElement.dataset.theme + ')</p><div class="g-river-wrap">' + tree + '</div>'; host.appendChild(candidate);
      const fmt = v => {const a=Math.abs(v),s=v<0?'−':'';return a>=999.5?s+'$'+(a/1000).toFixed(1).replace(/\.0$/,'')+'k':s+'$'+Math.round(a)};
      const events = {original:[],port:[]};
      const options = (section, kind) => ({el:section.querySelector('.river'),canvas:section.querySelector('canvas'),playhead:section.querySelector('.playhead'),pill:section.querySelector('.playhead-pill'),slide:section.querySelector('.river-slide'),monthsEl:section.querySelector('.months'),valsEl:section.querySelector('.river-vals'),periods:periods.map(p=>({...p})),index:2,cur:2,reduce:false,noIntro:false,fmt,onChange:(i,how)=>events[kind].push({i,how})});
      River.init(options(original,'original'));
      const port = BudgetRiver.create({...options(candidate,'port'),enabled:true,dark:document.documentElement.dataset.theme==='dark',knownRuns:[periods.map((_,i)=>i)]});
      window.__riverPair={original:River,port,events};
      const geometry = r => ({W:r.W,H:r.H,pad:r.padL,sp:r.sp,pan:r.pan,top:r.top,bot:r.bot,xs:r.xs,ys:r.ys,ms:r.ms,parts:r.parts.length,samples:[0,.5,1.5,3.2,6.6,7].map(f=>r.yAt(f))});
      return {original:geometry(River),port:geometry(port)};
    });
    // The port no longer shares the prototype's vertical geometry: Atlas
    // approved a ~25% shorter tile with rebalanced insets (2026-10-10), and
    // the fixture keeps the original 164/152px geometry. Horizontal layout,
    // run structure and behaviour must still match the prototype exactly, and
    // every vertical position of the port must be the prototype's position
    // affinely remapped from the old band onto the new band — the same value
    // domain through different insets, not a new curve.
    const { original, port } = setup;
    assert.deepEqual(
      { W: port.W, pad: port.pad, sp: port.sp, pan: port.pan, xs: port.xs, parts: port.parts },
      { W: original.W, pad: original.pad, sp: original.sp, pan: original.pan, xs: original.xs, parts: original.parts },
      'horizontal geometry and run structure at ' + width + '/' + theme);
    const portMobileJs = port.W < 640;
    assert.equal(port.H, width < 760 ? 114 : 123, 'approved port tile height at ' + width);
    assert.equal(port.top, portMobileJs ? 36 : 38, 'approved port top inset at ' + width);
    assert.equal(port.bot, port.H - (portMobileJs ? 49 : 51), 'approved port bottom inset at ' + width);
    assert.equal(original.top, 52, 'prototype top inset unchanged at ' + width);
    assert.equal(original.bot, original.H - (original.W < 640 ? 50 : 52), 'prototype bottom inset unchanged at ' + width);
    const remapY = y => port.top + (y - original.top) * (port.bot - port.top) / (original.bot - original.top);
    const remapped = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.05,
      label + ' at ' + width + '/' + theme + ': ' + actual + ' vs affine remap ' + expected);
    port.ys.forEach((y, i) => { if (y != null && original.ys[i] != null) remapped(y, remapY(original.ys[i]), 'curve y[' + i + ']'); });
    port.samples.forEach((y, i) => remapped(y, remapY(original.samples[i]), 'yAt sample[' + i + ']'));
    const slopeRatio = (port.bot - port.top) / (original.bot - original.top);
    port.ms.forEach((m, i) => assert.ok(Math.abs(m - original.ms[i] * slopeRatio) < 0.05,
      'slope m[' + i + '] at ' + width + '/' + theme + ': ' + m + ' vs scaled ' + (original.ms[i] * slopeRatio)));
    await page.waitForFunction(() => window.__riverPair.port.reveal === 1 && window.__riverPair.original.reveal === 1);
    // The canvases now have different heights, so a cross-canvas pixel diff is
    // meaningless. Pixel proof is the port's own determinism: a settled frame
    // redrawn at the same fixed time must reproduce exactly, and moving the
    // camera to another settled position must change the frame.
    const pixelProof = await page.evaluate(() => {
      const { port } = window.__riverPair;
      port.reduce = true; port.place(2); port.draw(12, 2);
      const grab = () => port.ctx.getImageData(0, 0, port.canvas.width, port.canvas.height).data;
      const a = grab(); port.place(2); port.draw(12, 2); const b = grab();
      let selfDifferences = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) selfDifferences++;
      port.place(3); port.draw(12, 3); const c = grab();
      let movedDifferences = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) movedDifferences++;
      port.place(2); port.draw(12, 2);
      return { selfDifferences, movedDifferences };
    });
    assert.equal(pixelProof.selfDifferences, 0, 'port static frame is deterministic at ' + width + '/' + theme);
    assert.ok(pixelProof.movedDifferences > 0, 'port frame changes with the camera at ' + width + '/' + theme);
    const staticPixels = pixelProof.selfDifferences;
    const pixels = { differences: pixelProof.movedDifferences };
    const input = async kind => {
      const rect = await page.evaluate(kind => {const r=window.__riverPair[kind],b=r.el.getBoundingClientRect();return{x:b.left+r.xc(2)-r.off,y:b.bottom-38,dx:r.pan?-r.sp:r.sp}},kind);
      await page.mouse.move(rect.x,rect.y);await page.mouse.down();await page.mouse.move(rect.x+rect.dx,rect.y,{steps:8});
      const held=await page.evaluate(kind=>({dragging:window.__riverPair[kind].dragging,events:window.__riverPair.events[kind]}),kind);
      assert.equal(held.dragging,true);assert.deepEqual(held.events.at(-1),{i:3,how:'scrub'});
      await page.mouse.up();return held;
    };
    const originalHeld=await input('original'),portHeld=await input('port');
    assert.deepEqual(portHeld,originalHeld,'matched held pointer inputs');
    // Use identical position springs, independently sampled from each actual controller.
    const spring=await page.evaluate(()=>{const{original,port}=window.__riverPair;original.head.set(0);port.head.set(0);original.head.target=port.head.target=7;const a=[],b=[];for(let i=0;i<80;i++){a.push(original.head.step(.016));b.push(port.head.step(.016))}return{a,b}});
    assert.deepEqual(spring.b,spring.a,'original spring sequence');
    await page.setViewportSize({width:width===1440?390:1440,height:1000});
    await page.waitForFunction(() => __riverPair.original.W===__riverPair.port.W);
    assert.equal(await page.evaluate(()=>__riverPair.original.sp===__riverPair.port.sp&&__riverPair.original.pan===__riverPair.port.pan),true,'resize agrees with original');
    await page.setViewportSize({width,height:1000});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(()=>__riverPair.port.reduce);
    assert.equal(await page.evaluate(()=>__riverPair.port.head.settled&&__riverPair.port.reveal===1),true);
    assert.equal(await page.locator('.budget-bento .t-river').evaluate(el=>Number(getComputedStyle(el).opacity)),1,'reduced-motion selector stays visible');
    // Resize resets a canvas. Repaint both at the same fixed camera/time for
    // the paired capture; the original itself does not invalidate a settled reduced frame.
    await page.evaluate(()=>{for(const r of [__riverPair.original,__riverPair.port]){r.layout();r.head.set(3);r.index=3;r.mark(3);r.place(3);r.reveal=1;r.draw(12,3);r.pill.querySelector('b').textContent='$700.00'}});
    results.push({width,theme,geometryComparison:'horizontal identical; vertical affine remap onto approved insets',originalLiveInput:originalHeld,portLiveInput:portHeld,staticPixelDifferences:staticPixels,movingPixelDifferences:pixels.differences,springIdentical:true,resize:true,reducedMotion:true});
    if(capture)await capture(page,'budget-river-pair-'+width+'-'+theme+'.png');
    await page.close();
  }
  return results;
}

module.exports = { proveRiverPort, riverHarnessHtml };

if (require.main === module) {
  (async () => {
    const { chromium } = require('playwright');
    const root = path.resolve(__dirname, '..'), fx = require('./fixtures/budget-surface-data');
    // Optional recorded result (Systems Review 5480338180): with
    // RIVER_RESULT_JSON=<path>, the run's structured results are written to
    // that path, source-bound via test/proof-source-binding.js — the PASS is
    // then evidence in the receipt, not prose in a packet.
    const receiptPath = process.env.RIVER_RESULT_JSON || null;
    let binding = null, verifyBinding = null;
    if (receiptPath) {
      const sbl = require('./proof-source-binding');
      binding = sbl.captureSourceBinding(root, [
        'public/budget-river.js', 'public/budget-gface.css', 'public/budget-blend.css', 'public/budget-blend.js',
        'public/styles.css', 'public/fonts.css', 'public/index.html', 'public/plan.js', 'public/forecast.js',
        'test/browser-budget-river-port.js', 'test/proof-source-binding.js', 'test/fixtures/budget-surface-data.js',
      ], process.env.PROOF_BASE_SHA || null);
      verifyBinding = sbl.verifySourceBinding;
    }
    const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true });
    try {
      const errors = [];
      const open = async (width, theme, options = {}) => {
        const page = await browser.newPage({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: options.reducedMotion || 'no-preference' });
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(chosen => localStorage.setItem('hfd-theme', chosen), theme);
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== 'http://budget.test') return route.abort();
          if (url.pathname === '/' && options.riverHarness) return route.fulfill({ body:riverHarnessHtml(theme),contentType:'text/html' });
          if (url.pathname === '/data.json') return route.fulfill({ json: options.data || fx.served(options) });
          if (['/periods.json', '/balance-history.json', '/running-build.json'].includes(url.pathname)) return route.fulfill({ json: null });
          const file = path.join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
          if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: '' });
          const contentType = file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.woff2') ? 'font/woff2' : 'text/html';
          return route.fulfill({ body: fs.readFileSync(file), contentType });
        });
        await page.goto('http://budget.test/'); if(!options.riverHarness)await page.locator('.river').waitFor();
        await page.evaluate(() => document.fonts.ready);
        return page;
      };
      const capture = process.env.RIVER_DEV_SHOTS ? async (page,file) => {fs.mkdirSync(process.env.RIVER_DEV_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.RIVER_DEV_SHOTS,file),fullPage:true,animations:'disabled'})} : null;
      const result = await proveRiverPort({ open, capture }); assert.deepEqual(errors, []);
      if (receiptPath) {
        verifyBinding(root, binding);
        fs.writeFileSync(receiptPath, JSON.stringify({
          proof: 'timeline-geometry-native-harness',
          harness: 'test/browser-budget-river-port.js',
          syntheticOnly: true,
          runtime: { node: process.version, chromium: await browser.version() },
          sourceBinding: { ...binding, unchangedAfterRun: true },
          results: result,
          pageErrors: errors,
          failures: [],
        }, null, 2));
      }
      console.log('PASS native river live drag: ' + result.nativeLiveDrag.length + ' viewport/theme cases, amount-label starts and retained controller across native remounts');
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
