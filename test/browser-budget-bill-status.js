'use strict';
// Actual App/Budget sheet; independent invented publication rows exercise the
// display contract. This matrix is not a Forecast calculation/settlement proof.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const fx=require('./fixtures/budget-surface-data');
const root=path.join(__dirname,'..');
const output=process.env.ATLAS_BUDGET_SCREENSHOTS_DIR||path.join(require('node:os').tmpdir(),'atlas-bill-status');
const states=[
  ['PAID','represented','Paid','paid'],
  ['still due','upcoming','Not paid','to-pay'],
  ['still due','unverified','To confirm','check'],
  ['still due',null,'Unknown','unknown'],
  ['pending','pending','Pending','pending'],
  ['unknown','unknown','Unknown','unknown'],
  ['needs confirmation',null,'To confirm','check'],
  ['PAID','unverified','To confirm','check'],
];
const dates=['2026-08-20','2026-08-17','2026-08-16','2026-08-21',null,'2026-02-30'];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH,headless:true});
  const errors=[],external=[];
  try{
    for(const width of [1440,390,320]) for(const theme of ['light','dark']){
      const page=await browser.newPage({viewport:{width,height:1000},colorScheme:theme,reducedMotion:'reduce'});
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='http://budget.test'){external.push(url.origin);return route.abort();}
        if(url.pathname==='/data.json')return route.fulfill({json:fx.served()});
        if(['/periods.json','/balance-history.json','/running-build.json'].includes(url.pathname))return route.fulfill({json:null});
        const file=path.join(root,'public',url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1)));
        if(!file.startsWith(path.join(root,'public'))||!fs.existsSync(file))return route.fulfill({status:404,body:''});
        const ext=path.extname(file);return route.fulfill({body:fs.readFileSync(file),contentType:ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.svg'?'image/svg+xml':'text/html'});
      });
      await page.goto('http://budget.test/');
      await page.locator('[data-budget-surface]').waitFor();
      await page.evaluate(theme=>{
        document.documentElement.setAttribute('data-theme',theme);
        document.body.setAttribute('data-theme',theme);
      },theme);
      const bills=page.locator('[data-budget-browse="bills"]');
      const paidFilter=bills.locator('[data-budget-bill-filter="paid"]');
      const unpaidFilter=bills.locator('[data-budget-bill-filter="not-paid"]');
      assert.equal(await paidFilter.count(),1);assert.equal(await unpaidFilter.count(),1);
      assert.equal(await bills.locator('[data-budget-bill-bucket="paid"] [data-budget-bill-open]').count(),1);
      assert.equal(await bills.locator('[data-budget-bill-bucket="not-paid"] [data-budget-bill-open]').count(),3);
      await unpaidFilter.focus();await page.keyboard.press('Enter');
      assert.equal(await bills.locator('[data-budget-bill-bucket="paid"]').isVisible(),false);
      assert.match(await bills.locator('[data-budget-bill-bucket="not-paid"]').innerText(),/Not confirmed/);
      await page.locator('[data-budget-bill-bucket="not-paid"] [data-budget-bill-open="hydro"]').click();
      assert.match(await page.locator('[data-budget-detail-body]').innerText(),/Missing evidence does not mean unpaid/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-budget-bill-bucket="not-paid"] [data-budget-bill-open="hydro"]').evaluate(node=>node===document.activeElement),true);
      await paidFilter.focus();await page.keyboard.press('Enter');
      assert.equal(await unpaidFilter.getAttribute('aria-pressed'),'false');
      assert.equal(await bills.locator('[data-budget-bill-bucket="not-paid"]').isVisible(),false);
      const colours=await Promise.all([paidFilter,unpaidFilter].map(control=>control.evaluate(node=>getComputedStyle(node).color)));
      assert.notEqual(colours[0],colours[1]);
      await page.keyboard.press('Enter');
      assert.equal(await bills.locator('[data-budget-bill-bucket="not-paid"]').isVisible(),true);
      assert.equal(await paidFilter.evaluate(node=>node===document.activeElement),true);
      await bills.screenshot({path:path.join(output,'bill-filters-'+theme+'-'+width+'.png'),animations:'disabled',style:'.sitenav-household { visibility:hidden !important; }'});
      const savings=page.locator('[data-budget-savings-goals]');
      assert.match(await savings.innerText(),/School trip[\s\S]*Not confirmed[\s\S]*Winter tires/);
      await savings.screenshot({path:path.join(output,'savings-goals-'+theme+'-'+width+'.png'),animations:'disabled',style:'.sitenav-household { visibility:hidden !important; }'});
      const accounts=page.locator('.budget-savings-accounts');
      assert.equal(await accounts.evaluate(node=>node.open),false,'technical accounts start behind evidence');
      await accounts.locator('summary').focus();await page.keyboard.press('Enter');
      assert.equal(await accounts.evaluate(node=>node.open),true,'complete inventory remains keyboard reachable');
      await page.keyboard.press('Enter');
      // Publish invented status rows through the incumbent BillDetail formatter,
      // then let the actual decorator and sheet controller handle those nodes.
      await page.evaluate(({states,dates})=>{
        const source=document.querySelector('[data-operating-question="04"] .budget-step-body');
        if(!source)throw Error('Native Bills evidence source missing');
        source.innerHTML=states.flatMap(([status,settlement,label,kind],i)=>dates.map((date,j)=>{
          const row={id:'synthetic-state-'+i+'-'+j,label:'Synthetic '+label+' '+(j+1),status,settlement,date,
            planned:99,actual:kind==='paid'?99:null,remaining:kind==='paid'?0:kind==='to-pay'?99:null};
          return BillDetail.html(row,App.data,{label:row.label,amount:'$99.00',status});
        })).join('');
      },{states,dates});
      await page.waitForFunction(count=>document.querySelectorAll('[data-atlas-bill-row][data-period-bill^="synthetic-state-"]').length===count,states.length*dates.length);
      await page.locator('[data-operating-question="04"] .budget-step-details > summary').click();
      await page.locator('[data-budget-detail-sheet]').waitFor({state:'visible'});
      const body=page.locator('[data-budget-detail-body]');
      assert.doesNotMatch(await body.innerText(),/ON DATE|DOUBLE-CHECK/);
      for(let i=0;i<states.length;i++)for(let j=0;j<dates.length;j++){
        const row=body.locator('[data-period-bill="synthetic-state-'+i+'-'+j+'"]');
        const badge=row.locator('[data-atlas-bill-state]');
        assert.equal(await badge.innerText(),states[i][2]);
        assert.equal(await badge.getAttribute('data-atlas-bill-state'),states[i][3]);
        assert.equal(await row.getAttribute('data-bill-status'),states[i][0],'raw published status remains intact');
        const css=await badge.evaluate(node=>({color:getComputedStyle(node).color,before:getComputedStyle(node,'::before').content}));
        const paidColor=await body.locator('[data-atlas-bill-state="paid"]').first().evaluate(node=>getComputedStyle(node).color);
        if(states[i][3]!=='paid'){
          assert.notEqual(css.color,paidColor,'non-paid state cannot share the Paid green');
          assert.ok(css.before==='none'||css.before==='normal','only Paid has the payment checkmark');
        }
      }
      const statusColours=await body.locator('[data-atlas-bill-state]').evaluateAll(nodes=>Object.fromEntries(nodes.map(node=>[node.getAttribute('data-atlas-bill-state'),getComputedStyle(node).color])));
      assert.notEqual(statusColours['to-pay'],statusColours.check,'Not paid red differs from unconfirmed amber');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no page overflow at 320px');
      await page.locator('[data-budget-detail-sheet]').screenshot({path:path.join(output,'bill-status-'+theme+'-'+width+'.png'),animations:'disabled'});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-operating-question="04"] .budget-step-details > summary').evaluate(node=>node===document.activeElement),true,'Back restores the native Bills trigger');
      await page.close();
      console.log('PASS '+width+'px '+theme+': '+states.length*dates.length+' status/date combinations in the real Bills sheet; distinct colours, checkmarks, raw statuses, keyboard return');
    }
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
