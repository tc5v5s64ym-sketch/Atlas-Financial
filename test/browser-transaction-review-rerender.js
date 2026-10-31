'use strict';
// Actual media changes exercise App's native media-query rerender path.
// Invented transfer facts only; transient row positions never saved identity.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const{chromium,webkit}=require('playwright');
const{openPage,closed,errors,writes,external}=require('./browser-transaction-review');
const root=path.join(__dirname,'..'),out=process.env.ATLAS_REVIEW_PROOF_DIR||path.join(require('node:os').tmpdir(),'atlas-review-rerender');
fs.mkdirSync(out,{recursive:true});
const records=[];
async function remounted(page,change,label){
 const dialog=page.locator('[data-budget-detail-sheet]');
 await dialog.evaluate(el=>el.setAttribute('data-rerender-proof','old'));
 await change();
 await page.waitForFunction(()=>document.querySelector('[data-budget-detail-sheet]')?.getAttribute('data-rerender-proof')!=='old');
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 assert.equal(await dialog.evaluate(el=>el.open),true,label+': native review remains open after a real remount');
 assert.equal(await page.locator('[data-transaction-review-open]').getAttribute('aria-expanded'),'true');
 assert.equal(await page.locator('[data-transaction-review]').count(),1,'same single source node');
 assert.equal(await page.locator('[data-observation-check]').count(),1,'same single source-check node');
 assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,'focus stays within restored dialog');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no overflow after rerender');
}
const activeFacts=page=>page.locator('[data-review-item]:not([hidden])').innerText().then(s=>s.replace(/\s+/g,' '));
async function main(){
 for(const[name,engine]of[['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch({headless:true});
 try{for(const width of[320,390,1440])for(const theme of['light','dark']){
 const{page}=await openPage(browser,width,theme,'multiple');
 // Automatic theme mode allows an OS change to affect real style as well as remount.
 await page.evaluate(()=>{localStorage.setItem('hfd-theme','auto');document.documentElement.removeAttribute('data-theme');});
 const bell=page.locator('[data-transaction-review-open]'),dialog=page.locator('[data-budget-detail-sheet]');
 await bell.click();
 await dialog.getByRole('button',{name:'Next transfer',exact:true}).click();
 const facts=await activeFacts(page);assert.match(facts,/2 of 2/);assert.match(facts,/\$28\.50/);
 const focusSelector=width===320?'[data-review-previous]':width===390?'[data-review-return]':'[data-budget-detail-close]';
 await dialog.locator(focusSelector).focus();
 const destination=width<=640?900:390;
 await remounted(page,()=>page.setViewportSize({width:destination,height:1000}),name+'/'+width+'/'+theme+'/breakpoint');
 assert.equal(await activeFacts(page),facts,'same projected facts and displayed row retained');
 assert.equal(await dialog.locator(focusSelector).evaluate(el=>el===document.activeElement),true,'same semantic control keeps focus');
 await remounted(page,()=>page.emulateMedia({colorScheme:theme==='light'?'dark':'light'}),name+'/'+width+'/'+theme+'/OS-theme');
 assert.equal(await activeFacts(page),facts);
 assert.equal(await dialog.locator(focusSelector).evaluate(el=>el===document.activeElement),true);
 await remounted(page,()=>page.setViewportSize({width,height:1000}),name+'/'+width+'/'+theme+'/return breakpoint');
 assert.equal(await activeFacts(page),facts);
 assert.equal(await dialog.locator(focusSelector).evaluate(el=>el===document.activeElement),true);
 await dialog.getByRole('button',{name:'Back to Budget',exact:true}).click();await closed(page);
 await bell.click();assert.match(await activeFacts(page),/1 of 2/,'an explicit reopen still resets transient navigation');
 await remounted(page,()=>page.emulateMedia({colorScheme:theme}),name+'/'+width+'/'+theme+'/second OS change');
 await page.keyboard.press('Escape');await closed(page);
 records.push({browser:name,version:browser.version(),width,theme,destination,focusSelector,remounts:4,sourceCount:1,statusCount:1,selectedFactsRetained:true,closeAndEscapeFocusReturned:true});
 await page.close();
 }}finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(external,[]);
 fs.writeFileSync(path.join(out,'rerender-proof.json'),JSON.stringify({synthetic:true,executionHead:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),records,errors,writes,external,physicalSafariAcceptance:'not performed'},null,2)+'\n');
 console.log('PASS review rerender: 12 Chromium/WebKit width/theme journeys, 48 actual breakpoint/OS-theme remounts; same facts, transient row, control focus and close/Escape return');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
