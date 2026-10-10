'use strict';
const fs=require('fs'), path=require('path'), assert=require('assert/strict');
const {chromium}=require('playwright'), {createHash}=require('crypto'), {execFileSync}=require('child_process');
// Run with BILLS_MAIN_SOURCE pointing to a clean exact-main checkout.
const root=path.resolve(process.env.BILLS_MAIN_SOURCE||path.join(__dirname,'atlas-bills-baseline')),
out=path.resolve(process.env.BILLS_MAIN_PROOF_DIR||path.join(__dirname,'main-5d-triage-proof'));
const git=args=>execFileSync('git',args,{cwd:root,maxBuffer:16777216});
const hash=b=>createHash('sha256').update(b).digest('hex');
const head=git(['rev-parse','HEAD']).toString().trim();
assert.equal(head,'5dceb7c6d4f673e4b464c34021b2266f6beb2313');
assert.equal(git(['status','--porcelain']).toString().trim(),'');
const data=require(path.join(root,'test/fixtures/budget-surface-data')).served();
for(let i=0;i<3;i++)data.plan.bills.push({id:'synthetic-extra-'+i,label:'Synthetic service '+(i+1),frequency:'monthly',day:24,amount:20+i,confidence:i===1?'estimated':'confirmed',payingAccount:'chequing-a'});
for(let i=0;i<7;i++)data.plan.bills.push({id:'synthetic-roster-'+i,label:'Synthetic household bill '+(i+1),frequency:'monthly',day:26,amount:10+i,confidence:'confirmed',payingAccount:'chequing-a'});
(async()=>{fs.mkdirSync(out,{recursive:true}); const files={},errors=[],writes=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
const dependencies={};for(const file of Object.keys(require.cache).filter(f=>f.startsWith(root+path.sep))){
const rel=path.relative(root,file).split(path.sep).join('/'),bytes=fs.readFileSync(file),blob=git(['rev-parse','HEAD:'+rel]).toString().trim();
assert.equal(hash(bytes),hash(git(['cat-file','blob',blob])));dependencies[rel]={sha256:hash(bytes),bytes:bytes.length,blob};}
try{const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light',reducedMotion:'reduce'});
page.on('pageerror',e=>errors.push(e.message)); await page.addInitScript(()=>localStorage.setItem('hfd-theme','light'));
await page.route('**/*',route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET')writes.push(req.method());if(u.origin!=='http://bills.test')return route.abort();
if(u.pathname==='/data.json')return route.fulfill({json:data});if(['/periods.json','/balance-history.json','/running-build.json'].includes(u.pathname))return route.fulfill({json:null});
const file=path.join(root,'public',u.pathname==='/'?'index.html':u.pathname.slice(1));if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
const bytes=fs.readFileSync(file),rel=path.relative(root,file).split(path.sep).join('/'),blob=git(['rev-parse','HEAD:'+rel]).toString().trim(); assert.equal(hash(bytes),hash(git(['cat-file','blob',blob])));
files[rel]={sha256:hash(bytes),bytes:bytes.length,blob};return route.fulfill({body:bytes,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html'});});
await page.goto('http://bills.test');await page.locator('[data-blend-cal]').waitFor();
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const square=page.locator('.blend-day').filter({has:page.locator('.blend-day-n',{hasText:/^24$/})}),button=square.locator('.blend-day-hit');
await page.keyboard.press('Tab');await button.focus();await button.scrollIntoViewIfNeeded();
const focus=await button.evaluate(el=>{const rect=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}};const s=getComputedStyle(el);return {square:rect(el.parentElement),button:rect(el),icon:rect(el.querySelector('svg')),visible:el.matches(':focus-visible'),outline:s.outline,offset:s.outlineOffset}});
await page.screenshot({path:path.join(out,'calendar-keyboard-focus.png')});
await page.evaluate(()=>{window.triageClick=null;document.addEventListener('click',e=>window.triageClick={tag:e.target.tagName,classes:e.target.className?.baseVal||e.target.className,day:e.target.closest('.blend-day')?.querySelector('.blend-day-n')?.textContent},{once:true,capture:true});});
await square.click({position:{x:8,y:28}});const target=await page.evaluate(()=>window.triageClick),backgroundActivates=await page.locator('dialog[open]').count()>0;
if(backgroundActivates)await page.locator('[data-budget-detail-close]').click();
await button.click();const dayDetails=await page.locator('dialog[open] [data-bill-detail]').count(),dayRows=await page.locator('dialog[open] .budget-bill-row').count();await page.screenshot({path:path.join(out,'four-bill-first-only.png')});
await page.locator('[data-budget-detail-close]').click();await settle();
const heading=page.locator('[data-blend-bills-open]'),hero=page.locator('[data-operating-question="04"] .budget-step-summary');
await heading.click();await page.keyboard.press('Escape');await settle();
const headingEscape=await page.evaluate(()=>({heading:document.activeElement?.hasAttribute('data-blend-bills-open'),hero:document.activeElement?.matches('[data-operating-question="04"] .budget-step-summary'),active:document.activeElement?.outerHTML.slice(0,220)}));
await hero.click();const summaries=page.locator('dialog[open] [data-bill-detail] > summary');
const heroMetrics={rows:await summaries.count(),height:await summaries.first().evaluate(el=>el.getBoundingClientRect().height),amountSize:await summaries.first().locator('.blend-bill-summary-amount').evaluate(el=>getComputedStyle(el).fontSize)};
await page.screenshot({path:path.join(out,'hero-giant-bills.png')});await page.locator('[data-budget-detail-close]').click();await settle();
await heading.click();const statuses=await page.locator('dialog[open] .budget-bill-row').evaluateAll(rows=>rows.map(r=>({id:r.dataset.budgetBillOpen,text:r.querySelector('.budget-bill-state')?.textContent,amount:r.querySelector('.budget-bill-amount')?.textContent})));
await page.locator('dialog[open] [data-budget-bill-open="internet"]').click();const detailStatus=await page.locator('dialog[open] [data-period-bill="internet"]').getAttribute('data-bill-status');
const screenshots={};for(const name of ['calendar-keyboard-focus.png','four-bill-first-only.png','hero-giant-bills.png']){const b=fs.readFileSync(path.join(out,name));screenshots[name]={sha256:hash(b),bytes:b.length};}
const report={surface:'offline http://bills.test; not live production',head,probeSha256:hash(fs.readFileSync(__filename)),
runtime:{node:process.version,platform:process.platform,playwright:require('playwright/package.json').version,chromium:browser.version()},
fixture:hash(Buffer.from(JSON.stringify(data))),files,dependencies,focus,target,backgroundActivates,dayDetails,dayRows,headingEscape,heroMetrics,statuses,detailStatus,screenshots,errors,writes};
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({head,focus,target,backgroundActivates,dayDetails,dayRows,headingEscape,heroMetrics,detailStatus}));
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
