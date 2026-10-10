'use strict';
// Real native selection while a mouse/touch gesture is still held. Synthetic
// fixture data only; expected dates come from native publications, not this port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const riverHarnessHtml = theme => '<!doctype html><html data-theme="' + theme + '"><head><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/budget-blend.css"><link rel="stylesheet" href="/budget-gface.css"><script src="/budget-river.js"></script></head><body></body></html>';

async function proveRiverPort({ open, capture }) {
  const cases = [];
  for (const width of [1440, 390, 320]) for (const theme of ['light', 'dark']) {
    const page = await open(width, theme);
    await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.t-river')).opacity) === 1);
    const before = await page.evaluate(width => {
      const river = document.querySelector('.river');
      const selected = Number(river.getAttribute('aria-valuenow')) - 1;
      const rows = [...document.querySelector('ol[data-bad-timeline]').children];
      const target = rows[selected + 1];
      window.__heldRiverElement = river;
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
    assert.equal(before.height, width < 760 ? 152 : 164, 'source height');
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
      nativeAmount: document.querySelector('.blend-hero [data-bad-term="balanceAfterDeductions"] [data-bad-term-amount]').textContent,
    }));
    assert.equal(held.start, before.start, 'native date changes before release');
    assert.equal(held.period, before.period, 'hero prints the selected native period before release');
    assert.equal(held.range.replace(/\s/g, ''), before.range.replace(/\s/g, ''), 'visible tile date agrees before release');
    assert.equal(held.dragging, true, 'gesture remains held across native remount');
    assert.equal(held.sameElement, true, 'original controller survives native remount');
    // Keep the same gesture held through a second native tile replacement.
    const second = await page.evaluate(i => {
      const row = document.querySelector('ol[data-bad-timeline]').children[i];
      return { start: row.dataset.badTimelineStart, period: row.dataset.badTimelinePeriod };
    }, before.selected + 2);
    await page.mouse.move(before.x + (before.pan ? -2 : 2) * before.spacing, before.y, { steps: 8 });
    await page.waitForFunction(start => document.querySelector('[data-budget-window-progress]')?.dataset.start === start, second.start);
    assert.equal(await page.evaluate(() => document.querySelector('.river') === window.__heldRiverElement && document.querySelectorAll('.g-river-wrap').length === 1), true);
    // Cancellation aligns with the last actual native publication, without fling.
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('.river').classList.contains('is-dragging'));
    assert.equal(await page.locator('[data-budget-window-progress]').getAttribute('data-start'), second.start);
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
    assert.deepEqual(setup.port, setup.original, 'independent original geometry at ' + width + '/' + theme);
    await page.waitForFunction(() => window.__riverPair.port.reveal === 1 && window.__riverPair.original.reveal === 1);
    // Freeze to the same animation time and position: dark render pixels must match exactly.
    const pixels = await page.evaluate(() => {
      const {original,port} = window.__riverPair;
      original.place(2);port.place(2);original.draw(12,2);port.draw(12,2);
      const a=original.ctx.getImageData(0,0,original.canvas.width,original.canvas.height).data;
      const b=port.ctx.getImageData(0,0,port.canvas.width,port.canvas.height).data;
      let differences=0; for(let i=0;i<a.length;i++) if(a[i]!==b[i]) differences++;
      return {differences,total:a.length};
    });
    // Particles have evolved on different wall-clock RAFs; compare deterministic draw with motion disabled.
    const staticPixels = await page.evaluate(() => {
      const {original,port}=window.__riverPair;original.reduce=port.reduce=true;original.draw(12,2);port.draw(12,2);
      const a=original.ctx.getImageData(0,0,original.canvas.width,original.canvas.height).data,b=port.ctx.getImageData(0,0,port.canvas.width,port.canvas.height).data;
      let differences=0;for(let i=0;i<a.length;i++) if(a[i]!==b[i]) differences++;
      return differences;
    });
    if(theme==='dark') assert.equal(staticPixels,0,'dark original curve, beads, lens and zero marker pixels');
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
    results.push({width,theme,geometryIdentical:true,originalLiveInput:originalHeld,portLiveInput:portHeld,staticPixelDifferences:staticPixels,movingPixelDifferences:pixels.differences,springIdentical:true,resize:true,reducedMotion:true});
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
          if (url.pathname === '/data.json') return route.fulfill({ json: fx.served(options) });
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
      console.log('PASS native river live drag: ' + result.nativeLiveDrag.length + ' viewport/theme cases, amount-label starts and retained controller across native remounts');
    } finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
