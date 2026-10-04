'use strict';
// App.boot uses independently invented provider receipt/transfer fixtures.
// Every network request is intercepted; no server or credentials are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),fx=require('./fixtures/budget-income-receipts'),provider=require('../scripts/provider-observe');
const root=path.join(__dirname,'..'),out=process.env.ATLAS_BUDGET_SCREENSHOTS_DIR||path.join(require('node:os').tmpdir(),'budget-income-receipts');
fs.mkdirSync(out,{recursive:true});
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
const errors=[],external=[];
try{for(const width of [1440,390,320])for(const state of ['received','partial','unknown','history','missing-actual']){
 const rows=fx.transactions().filter(x=>state!=='partial'||x.providerTransactionId!=='salary');
 const fixture=fx.build(rows,fx.rules,provider,state==='history'?'2026-07-20':fx.AS_OF);
 if(state==='missing-actual')fixture.packet.representedActuals.find(row=>row.id==='amandaSalaryMonthEnd').actual=null;
 if(state==='unknown')fixture.data.liveOverlay.currentPeriodActuals.transactionCoverage='truncated';
 const page=await browser.newPage({viewport:{width,height:1000},colorScheme:'light',reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!=='http://budget.test'){external.push(u.origin);return route.abort();}
 if(u.pathname==='/data.json')return route.fulfill({json:fixture.data});
 if(['/periods.json','/balance-history.json','/running-build.json'].includes(u.pathname))return route.fulfill({json:null});
 const file=path.join(root,'public',u.pathname==='/'?'index.html':u.pathname.slice(1));
 if(!fs.existsSync(file))return route.fulfill({status:404,body:''});
 return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});});
 await page.goto('http://budget.test/');await page.locator('[data-budget-surface]').waitFor();
 assert.equal(await page.evaluate(()=>App.data.meta.title),'Invented receipt reconciliation');
 if(state==='history'){await page.locator('[data-budget-window-step="-1"]').click();assert.match(await page.locator('[data-budget-window-range]').innerText(),/Jun 26.*Jul 9/);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'320px has no horizontal overflow');
 const income=page.locator('[data-operating-question="02"] > details > summary');
 const text=await income.innerText();
 assert.match(text,/4,320\.50/,'original denominator remains planned income');
 if(state==='received'||state==='history'){
  assert.match(text,/4,226\.36/,'actual = 2493.18 payroll + 1733.18 uniquely proven external salary');
  assert.equal(await income.locator('[data-budget-progress-partial]').count(),0);
  if(state!=='history')assert.match(await page.locator('[data-operating-question="06"] > details > summary').innerText(),/345\.94[\s\S]*365\.00/);
  if(state!=='history')assert.match(await page.locator('[data-operating-question="07"] > details > summary').innerText(),/3,834\.08/,'final uses unchanged reserve 392.28, not actual consumption 345.94');
 }else if(state==='partial'||state==='missing-actual'){
  assert.match(text,/2,493\.18\*/,'partial confirmed subtotal is marked, never forced to plan');
  assert.equal(await income.locator('[data-budget-progress-partial]').count(),1);
 }else assert.match(text,/Unknown/,'truncated evidence cannot become an actual');
 for(const id of ['02','04','06','savings','07']){
  const summary=page.locator(`[data-operating-question="${id}"] > details > summary`);
  assert.equal(await summary.locator('.budget-step-caption').count(),0);
  assert.doesNotMatch(await summary.innerText(),/Received \/ planned|Paid \/ scheduled|Partial actuals|Spent \/ planned|Actual unavailable|Fulfilled \/ Forecast requirement|Before savings/);
 }
 const savings=page.locator('[data-operating-question="savings"] > details > summary');
 assert.equal((await savings.locator('[data-budget-ratio-actual]').innerText()).trim(),'Unknown','two absent amounts use one compact unknown');
 assert.equal(await savings.locator('[data-budget-ratio-plan]').evaluate(el=>{const r=el.getBoundingClientRect();return r.width<=1&&r.height<=1;}),true,
  'unknown-plan wording is available to screen readers without a visible subtitle');
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
 await page.screenshot({path:path.join(out,`${state}-${width}.png`),fullPage:true,animations:'disabled'});
 await income.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-budget-detail-sheet]')?.open);
 const evidence=await page.locator('[data-budget-detail-body]').innerText();
 if(state==='received'||state==='history')assert.match(evidence,/4,226\.36/);
 if(state==='partial'||state==='missing-actual')assert.match(evidence,/partial evidence[\s\S]*Some occurrence settlement amounts are not confirmed/);
 if(state==='unknown')assert.match(evidence,/Actual: Unavailable/);
 const body=page.locator('[data-budget-detail-body]');
 const received=await body.locator('[data-income-status="received"]').evaluateAll(rows=>rows.map(row=>({
  id:row.dataset.periodIncome||row.dataset.otherIncomeItem,
  amount:row.querySelector('[data-income-line-amount]')?.textContent.trim(),
  original:row.querySelector('[data-income-original-plan]')?.textContent.trim()})));
 const dale=received.find(row=>row.id==='payroll');assert.equal(dale.amount,'+$2,493.18');assert.match(dale.original,/Original plan.*2,520\.25/);
 const amanda=received.find(row=>row.id==='amandaSalaryMonthEnd');
 if(state==='partial')assert.equal(amanda,undefined,'unproven salary is never marked received');
 else{assert.equal(amanda.amount,state==='missing-actual'?'Unavailable':'+$1,733.18');assert.match(amanda.original,/Original plan.*1,800\.25/);}
 const cents=text=>{const m=text.match(/[$]([0-9,]+)\.([0-9]{2})/);return m?Number(m[1].replaceAll(',',''))*100+Number(m[2]):null;};
 const lineCents=received.reduce((sum,row)=>sum+(cents(row.amount)??0),0);
 if(state!=='unknown'){
  const actualText=await body.locator('[data-budget-progress-evidence="income"]').innerText();
  const actual=cents(actualText.split('Actual:')[1]);
  assert.equal(lineCents,state==='partial'||state==='missing-actual'?249318:422636,'independent actual receipt cents; plans are separately labeled');
  assert.equal(actual,lineCents,'opened Info received-line sum equals its printed Actual total');
 }

 await page.screenshot({path:path.join(out,`${state}-info-${width}.png`),fullPage:false,animations:'disabled'});
 await page.keyboard.press('Escape');assert.equal(await income.evaluate(el=>el===document.activeElement),true,'exact income trigger regains focus');
 const r=await income.evaluate(el=>{const b=el.getBoundingClientRect(),dock=document.querySelector('.sitenav-household');return {top:b.top,bottom:b.bottom,limit:dock&&getComputedStyle(dock).position==='fixed'?dock.getBoundingClientRect().top:innerHeight};});
 assert.ok(r.top>=0&&r.bottom<=r.limit,'restored focus is visible above the mobile dock');
 await page.close();console.log(`PASS ${width}px ${state}: actual/original numerics, no subtitles, truthful unknowns, Info, exact focus and reserve identity`);
 }assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS actual App.boot -> sanitized provider receipts -> Forecast -> active Budget; all 15 current/history/missing views, received line sums and keyboard Info');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
