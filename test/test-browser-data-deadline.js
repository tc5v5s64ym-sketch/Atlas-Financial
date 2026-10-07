'use strict';
// Exercise the shared browser boot with controlled elapsed time and responses.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
let checks=0;const eq=(actual,expected,why)=>{assert.deepEqual(actual,expected,why);checks++;};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function browser(initial){
 const timers=new Map();let sequence=0,mode=initial,rendered=0,wired=0,now=0,resolveLate;
 class Element{
  constructor(){this.children=[];this.listeners={};this.textContent='';}
  set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}
  setAttribute(){}removeAttribute(){}querySelectorAll(){return [];}
  prepend(child){this.children.unshift(child);child.parent=this;}
  append(child){this.children.push(child);child.parent=this;}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  addEventListener(name,fn){this.listeners[name]=fn;}
 }
 const wrap=new Element(),document={body:new Element(),documentElement:new Element(),getElementById:()=>null,querySelectorAll:()=>[],querySelector:selector=>selector==='.wrap'?wrap:null,createElement:()=>new Element()};
 const context={document,console,AbortController,addEventListener(){},location:{href:''},matchMedia:()=>({addEventListener(){}}),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),fetch:(_url,options)=>{
  eq(options.credentials,'same-origin','session credentials preserved');
  if(mode==='pending')return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{const error=new Error('aborted');error.name='AbortError';reject(error);},{once:true}));
  if(mode==='late')return new Promise(resolve=>{resolveLate=()=>resolve({status:200,ok:true,json:()=>Promise.resolve({meta:{asOf:'2038-06-06'},plan:{}})});});
  const status=mode==='good'?200:mode==='unauthorized'?401:503;
  return Promise.resolve({status,ok:status===200,json:()=>Promise.resolve(status===200?{meta:{asOf:'2038-06-06'},plan:{}}:{error:'data unavailable'})});
 }};
 vm.createContext(context);vm.runInContext(source+'\nglobalThis.app=App;',context);
 context.app.register(()=>rendered++);context.app.once(()=>wired++);context.app.boot();
 return {context,wrap,timers,setMode:value=>mode=value,counts:()=>({rendered,wired}),resolveLate:()=>resolveLate(),advance:ms=>{now+=ms;for(const [id,timer]of timers)if(timer.at<=now){timers.delete(id);timer.fn();}}};
}
(async()=>{
 const pending=browser('pending');eq(pending.context.app.data,null,'pending refresh publishes no data');eq(pending.counts(),{rendered:0,wired:0},'pending refresh runs no financial hooks');
 const notice=pending.wrap.children[0];assert.ok(notice.textContent.startsWith('Loading current data...'));checks++;eq(notice.children[0].textContent,'Cancel','loading offers cancellation');
 const deadline=[...pending.timers.values()].find(timer=>timer.ms===180000);assert.ok(deadline);checks++;
 pending.advance(118000);await flush();eq(pending.context.app.data,null,'previously observed118second workload remains pending');eq(pending.counts(),{rendered:0,wired:0},'long pending load makes no financial claim');
 pending.advance(62000);await flush();await flush();
 eq(pending.context.app.data,null,'timeout does not promote an error or cached payload');eq(pending.counts(),{rendered:0,wired:0},'timeout keeps financial hooks inactive');
 assert.ok(notice.textContent.includes('Current data could not be loaded'));checks++;eq(notice.children[0].textContent,'Retry','explicit retry available');
 pending.setMode('good');notice.children[0].listeners.click();await flush();await flush();eq(pending.counts(),{rendered:1,wired:1},'successful retry initializes and renders once');eq(pending.context.app.data.meta.asOf,'2038-06-06','successful data retains its financial date');eq(pending.wrap.children.length,0,'successful retry removes loading/error notice');eq(pending.timers.size,0,'load deadlines cleaned up');
 const failed=browser('unavailable');await flush();await flush();eq(failed.context.app.data,null,'HTTP unavailable body cannot become financial data');eq(failed.counts(),{rendered:0,wired:0},'HTTP unavailable never renders financial output');
 const unauthorized=browser('unauthorized');await flush();await flush();eq(unauthorized.context.location.href,'/login','401 still redirects to session login');eq(unauthorized.counts(),{rendered:0,wired:0},'unauthorized response never renders');
 const cancelled=browser('pending'),cancelNotice=cancelled.wrap.children[0];cancelNotice.children[0].listeners.click();await flush();await flush();eq(cancelled.counts(),{rendered:0,wired:0},'user cancellation keeps financial hooks inactive');assert.ok(cancelNotice.textContent.startsWith('Loading cancelled.'));checks++;eq(cancelled.timers.size,0,'cancel cleans up deadline');
 cancelled.setMode('good');const retry=cancelNotice.children[0];retry.listeners.click();retry.listeners.click();await flush();await flush();eq(cancelled.counts(),{rendered:1,wired:1},'double retry starts one successful load');
 const late=browser('late');late.wrap.children[0].children[0].listeners.click();late.resolveLate();await flush();await flush();eq(late.context.app.data,null,'late success after cancellation cannot publish');eq(late.counts(),{rendered:0,wired:0},'late cancelled success runs no hooks');
 const longSuccess=browser('late');longSuccess.advance(118000);longSuccess.resolveLate();await flush();await flush();eq(longSuccess.counts(),{rendered:1,wired:1},'118second successful response renders exactly once');eq(longSuccess.context.app.data.meta.asOf,'2038-06-06','long response retains its financial date');eq(longSuccess.timers.size,0,'long success clears browser deadline');
 console.log('PASS shared browser data deadline: '+checks+' checks; pending/timeout/unavailable stay unrendered, visible loading/retry, successful retry and unchanged session redirect');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
