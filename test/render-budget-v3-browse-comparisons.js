'use strict';
// Optional visual QA; both inputs use independent invented fixtures.
// NODE_PATH=<Playwright> CHROME_PATH=<Chromium> node test/render-budget-v3-browse-comparisons.js <captures> <output>
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const references = path.join(root, 'docs/design/budget-v3-spending-bills');
const captures = path.resolve(process.argv[2] || references);
const output = path.resolve(process.argv[3] || captures);
const data = file => 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
(async () => {
  fs.mkdirSync(output, {recursive:true});
  const browser = await chromium.launch({executablePath:process.env.CHROME_PATH});
  try {
    for (const section of ['spending','bills','attention']) for (const width of [1440,390,320]) {
      const page = await browser.newPage({viewport:{width:width === 1440 ? 1440 : width * 2 + 64,height:100},
        deviceScaleFactor:1,reducedMotion:'reduce'});
      await page.setContent(`<style>body{margin:0;padding:20px;background:#f0f0ed;font:14px system-ui;color:#222}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px}main{display:flex;gap:20px;align-items:flex-start}figure{margin:0;flex:1;min-width:0}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;height:auto;display:block}</style>
        <h1>Budget v3 ${section} - ${width}px viewport</h1>
        <p>Independent invented fixtures with different row counts. Compare design and interaction hierarchy; financial amounts are asserted separately. Full v3 remains unfinished.</p>
        <main><figure><figcaption>Approved #480 reference</figcaption><img src="${data(path.join(references,`reference-${section}-${width}.png`))}"></figure>
        <figure><figcaption>Active renderer</figcaption><img src="${data(path.join(captures,`${section}-${width}.png`))}"></figure></main>`);
      await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => img.decode()));
        await document.fonts.ready;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await page.screenshot({path:path.join(output,`comparison-${section}-${width}.png`),fullPage:true,animations:'disabled'});
      await page.close();
    }
    console.log('PASS: settled spending/bills/attention reference comparisons at desktop, mobile and 320px');
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
