'use strict';
// Active Budget App.boot and renderer; localhost transport contains only invented fixtures.
// NODE_PATH=<local playwright> CHROME_PATH=<browser> ATLAS_FEES_SCREENSHOTS=<dir> node test/browser-bank-fees-composition.js
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const Live=require('../scripts/live-plan'),fixture=require('./fixtures/bank-fees-data');
const root=path.join(__dirname,'..'),out=process.env.ATLAS_FEES_SCREENSHOTS;
if(out) fs.mkdirSync(out,{recursive:true});
const variants=[['unpaid',()=>fixture()],['paid',()=>fixture(80,'card',80)],
  ['cash',()=>fixture(80,'cash')],['pending',()=>{const x=fixture(10);x.payload.transactions[0].is_pending=true;return x;}],
  ['missing',()=>{const x=fixture();x.payload.categories=[];return x;}],
  ['unknown-opening',()=>{const x=fixture();x.data.plan.cardPurchaseCoverage.opening.confirmed=false;return x;}]];
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  const errors=[],external=[],writes=[],results=[];
  try {
    for(const width of [1440,390,320]) for(const [name,make] of variants) {
      const x=make(),data=Live.fromObservation(x).data;
      data.meta.title='Independent invented Fees acceptance';
      const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce',
        isMobile:width<400,hasTouch:width<400,colorScheme:width===320?'dark':'light'});
      await context.route('**/*',route=>{
        const req=route.request(),u=new URL(req.url());
        if(req.method()!=='GET'){writes.push(req.method());return route.abort();}
        if(u.origin!=='http://fees.test'){external.push(u.origin);return route.abort();}
        if(u.pathname==='/data.json') return route.fulfill({json:data});
        if(['/periods.json','/balance-history.json','/running-build.json'].includes(u.pathname)) return route.fulfill({json:null});
        const file=path.resolve(root,'public',u.pathname==='/'?'index.html':u.pathname.slice(1));
        if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)) return route.fulfill({status:404,body:''});
        return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'application/javascript'
          :file.endsWith('.css')?'text/css':'text/html'});
      });
      const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
      await page.goto('http://fees.test/');
      const bills=page.locator('[data-budget-browse="bills"]');await bills.waitFor();
      const group=bills.locator('[data-bank-fees]');await group.waitFor();
      const initial=await page.evaluate(()=>JSON.stringify(App.data));
      const text=await group.innerText();
      if(name==='missing') {
        assert.equal(await group.getAttribute('data-bank-fees'),'unavailable');
        assert.match(text,/unavailable|unconfirmed/);assert.equal(await group.locator('[data-fee-transaction]').count(),0);
      } else {
        assert.equal(await group.getAttribute('data-bank-fees'),'ready');
        assert.equal(await group.locator('[data-fee-transaction]').count(),1);
        assert.match(text,name==='pending'?/Pending fee/:/Posted fee/);
        assert.doesNotMatch(await group.locator('[data-fee-transaction]').innerText(),/PAID|provider|80001|910|Invented issuer cost/);
        assert.match(text,name==='unknown-opening'?/Cash coverage unconfirmed/:name==='paid'?/Cash coverage confirmed/
          :name==='cash'?/Cash debit posted/:/Bills cash reserved/);
        assert.match(text,name==='pending'?/Actual including pending/:/Actual/);
        const color=await group.locator('[data-fee-transaction]').evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.equal(color,'rgb(48, 35, 67)','purple is accompanied by explicit transaction/coverage text');
      }
      const receipt=await page.evaluate(()=>{
        const a=Forecast.recommend(App.data.plan,App.data.meta.asOf,simOpts({currentPeriodActuals:App.data.liveOverlay.currentPeriodActuals,
          observedCash:App.data.liveOverlay.observedCash,operatingPlan:App.data.liveOverlay.operatingPlan}));
        const p=a.payPeriodViews.find(p=>p.start<=App.data.meta.asOf&&p.end>=App.data.meta.asOf);
        return {cash:p.liveCurrentBalance,bad:p.balanceAfterDeductions,actual:p.budgetProgress.bills.actual.amount,
          reserve:a.cardPurchaseCoverage.reservedCash};
      });
      assert.equal(receipt.cash,['paid','cash'].includes(name)?420:500);
      assert.equal(receipt.bad,name==='missing'?null:name==='pending'?801:745);
      assert.equal(receipt.actual,name==='missing'?null:name==='pending'?10:80);
      const trigger=bills.locator('[data-budget-browse-evidence="04"]');
      await trigger.focus();await page.keyboard.press('Enter');
      const sheet=page.locator('[data-budget-detail-body]');await sheet.waitFor();
      assert.match(await sheet.innerText(),name==='missing'?/unavailable|unconfirmed/i:/Fees/);
      const original=sheet.locator('.bank-fees-original > summary');
      if(name!=='missing') {
        await original.focus();await page.keyboard.press('Enter');
        assert.equal(await original.evaluate(el=>el.parentElement.open),true);
      } else assert.equal(await original.count(),0,'unavailable deduction cannot expose a normal-looking bill amount');
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(el=>document.activeElement===el),true,'fee evidence sheet restores the invoking button');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await page.evaluate(()=>JSON.stringify(App.data)),initial,'rendering/disclosure never mutates financial evidence');
      if(out) await bills.screenshot({path:path.join(out,name+'-'+width+'.png'),animations:'disabled'});
      results.push({width,name,noOverflow:true,focusRestored:true,actual:receipt.actual,cash:receipt.cash,bad:receipt.bad});
      await context.close();
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
    if(out) fs.writeFileSync(path.join(out,'browser-receipt.json'),JSON.stringify({fixture:'independently-invented',results,
      browserErrors:0,externalRequests:0,writes:0},null,2));
    console.log('PASS active Budget Fees desktop/mobile rendering, purple/status, financial receipts, unknowns and keyboard focus ('+results.length+' cases)');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
