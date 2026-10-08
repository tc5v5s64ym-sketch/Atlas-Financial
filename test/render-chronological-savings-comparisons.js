'use strict';
// Optional proof viewer: existing invented #480 references and active invented captures.
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),captures=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]||captures);
const png=file=>'data:image/png;base64,'+fs.readFileSync(file).toString('base64');
(async()=>{fs.mkdirSync(output,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROME_PATH});
try{for(const lens of ['today','payday'])for(const width of [1440,390,320]){
 const page=await browser.newPage({viewport:{width:width===1440?1440:width*2+64,height:1000},deviceScaleFactor:1,reducedMotion:'reduce'});
 const active=lens==='today'?'ready':'payday';
 await page.setContent(`<style>body{margin:0;padding:20px;background:#f0f0ed;font:14px system-ui;color:#222}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px}main{display:flex;gap:20px;align-items:flex-start}figure{margin:0;flex:1;min-width:0}figcaption{font-weight:600;margin-bottom:8px}img{width:100%;height:auto;display:block}</style>
 <h1>Chronological savings - ${lens} - ${width}px viewport</h1><p>Independent invented fixtures. Compare hierarchy and geometry; row counts, dates and financial states differ. Later owner savings policy replaces separate pots. Complete Budget v3 is not claimed.</p>
 <main><figure><figcaption>Approved #480 reference</figcaption><img src="${png(path.join(root,'docs/design/budget-v3-funding-month',`reference-upcoming-${lens}-${width}.png`))}"></figure>
 <figure><figcaption>Active Forecast-backed one-pot renderer</figcaption><img src="${png(path.join(captures,`chronological-savings-${active}-${width}.png`))}"></figure></main>`);
 await page.evaluate(async()=>{await Promise.all([...document.images].map(image=>image.decode()));await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
 await page.screenshot({path:path.join(output,`chronological-savings-comparison-${lens}-${width}.png`),fullPage:true,animations:'disabled'});await page.close();
}console.log('PASS six desktop/mobile/320px side-by-side comparisons');}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});