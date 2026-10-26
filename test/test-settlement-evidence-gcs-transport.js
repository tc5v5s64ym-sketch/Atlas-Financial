'use strict';
// OFFLINE JSON-API request fixtures, NOT Google Cloud/provider qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname,'..');
const load = () => require(path.join(ROOT,'scripts/settlement-evidence-gcs-transport')).createSettlementEvidenceGcsTransport;
const OA = require(path.join(ROOT,'scripts/settlement-evidence-object-adapter'));
const C = require(path.join(ROOT,'scripts/planned-obligation-settlement-contract'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const md5 = b => crypto.createHash('md5').update(b).digest('base64');
const KEY='candidate/pin.json', CANARY='invented-private-canary-do-not-emit';
function fixture(over={}) {
  const calls=[], objects=new Map(); let generation=9007199254740993n, stable=true;
  let hook=null;
  const descriptor=(name,o)=>({bucket:'atlas-offline-candidate',name,generation:o.generation,
    metageneration:'1',size:String(o.bytes.length),md5Hash:md5(o.bytes)});
  const request=async q=>{
    calls.push(q); const u=new URL(q.url), name=u.searchParams.get('name')
      || (u.pathname.includes('/o/')?decodeURIComponent(u.pathname.split('/o/')[1]):null);
    if(hook){const reply=await hook(q,{u,name});if(reply!==undefined)return reply;}
    if(q.method==='POST') {
      const current=objects.get(name), expected=u.searchParams.get('ifGenerationMatch');
      assert.ok(expected!==null,'all writes have generation precondition');
      if(expected==='0'?!!current:!current||current.generation!==expected)return {status:412,body:{}};
      const o={bytes:Buffer.from(q.body),generation:String(++generation)};objects.set(name,o);
      return {status:200,body:descriptor(name,o)};
    }
    assert.equal(q.method,'GET');
    if(!u.pathname.includes('/o'))return {status:200,body:{name:'atlas-offline-candidate',projectNumber:'123456789',location:'US-WEST1'}};
    if(name){const o=objects.get(name);if(!o)return {status:404,body:{error:{code:404,errors:[{reason:'notFound'}]}}};
      const gen=u.searchParams.get('generation');if(gen&&gen!==o.generation)return {status:404,body:{}};
      return {status:200,body:u.searchParams.get('alt')==='media'?Buffer.from(o.bytes):descriptor(name,o)};}
    const keys=[...objects.keys()].filter(k=>k.startsWith(u.searchParams.get('prefix'))).sort();
    const remaining=keys.filter(k=>k>(u.searchParams.get('pageToken')||'')), size=Number(u.searchParams.get('maxResults'));
    return {status:200,body:{items:remaining.slice(0,size).map(k=>descriptor(k,objects.get(k))),
      ...(size<remaining.length?{nextPageToken:remaining[size-1]}:{})}};
  };
  const options={request,bucket:'atlas-offline-candidate',namespace:'candidate',projectNumber:'123456789',location:'US-WEST1',
    assertStableNamespace:()=>stable,...over};
  return {calls,objects,options,make:()=>load()(options),setHook:fn=>{hook=fn;},setStable:v=>{stable=v;}};
}
test('disconnected and configured construction have no I/O and exactly four methods',async()=>{
  const f=fixture(), t=f.make();assert.deepEqual(Object.keys(t).sort(),['create','list','read','replace']);assert.equal(f.calls.length,0);
  const off=load()();await assert.rejects(off.read(KEY),e=>e.category==='unconfigured');assert.equal(f.calls.length,0);
});
test('target/config validation precedes requests and snapshots target',async()=>{
  for(const patch of [{bucket:'../escape'},{request:undefined},{namespace:'../bad'},{projectNumber:123},{location:''},
    {assertStableNamespace:null},{limits:{maxBytes:5*1024*1024}},{endpoint:'https://invalid.example'}]){
    const f=fixture(patch);assert.throws(f.make);assert.equal(f.calls.length,0);
  }
  const f=fixture(),t=f.make();f.options.bucket='other';await t.create(KEY,Buffer.from('a'),{revision:0});
  assert.ok(f.calls.every(q=>new URL(q.url).hostname==='storage.googleapis.com'&&q.url.includes('atlas-offline-candidate')));
  for(const k of ['other/pin','candidate/../pin','candidate//pin','candidate/pin?x'])await assert.rejects(t.read(k));
});
test('absent-only create/read preserve bytes and scalar metadata',async()=>{
  const f=fixture(),t=f.make(),b=Buffer.from([0,255,3]);const ack=await t.create(KEY,b,{revision:0});
  assert.equal(ack.integrity,hash(b));assert.equal(typeof ack.version,'string');
  assert.equal(new URL(f.calls[0].url).searchParams.get('ifGenerationMatch'),'0');
  assert.deepEqual(await t.read(KEY),{bytes:b,metadata:{revision:0},version:ack.version});
  await assert.rejects(t.create(KEY,b,{revision:0}),e=>e.code==='conflict');
});
test('native generation CAS refuses stale tokens and identical bytes get fresh versions',async()=>{
  const f=fixture(),t=f.make(),b=Buffer.from('same');const a=await t.create(KEY,b,{revision:0});
  const next=await t.replace(KEY,b,a.version,{revision:0});assert.notEqual(a.version,next.version);
  assert.ok(BigInt(a.version)>BigInt(Number.MAX_SAFE_INTEGER));
  await assert.rejects(t.replace(KEY,b,a.version,{revision:0}),e=>e.code==='conflict');
  for(const v of [0,1,'0','01','x','1&x=0',''])await assert.rejects(t.replace(KEY,b,v,{}));
});
test('generation-selected media refuses a metadata/data replacement race instead of mixing',async()=>{
  const f=fixture(),t=f.make();await t.create(KEY,Buffer.from('old'),{revision:0});
  f.setHook((q,{u,name})=>{if(u.searchParams.get('alt')==='media'){
    assert.ok(u.searchParams.get('generation')); f.objects.set(name,{generation:String(BigInt(f.objects.get(name).generation)+50n),bytes:Buffer.from('new')});
    return {status:404,body:{}};
  }});await assert.rejects(t.read(KEY),e=>e.category!=='missing');
});
test('retained old generation is read coherently even when the latest generation advances',async()=>{
  const f=fixture(),t=f.make();const a=await t.create(KEY,Buffer.from('old'),{revision:0});
  const old=f.objects.get(KEY);f.setHook((q,{u,name})=>{if(u.searchParams.get('alt')==='media'){
    assert.equal(u.searchParams.get('generation'),a.version);
    f.objects.set(name,{generation:String(BigInt(a.version)+1n),bytes:Buffer.from('new-generation')});
    return {status:200,body:Buffer.from(old.bytes)};
  }});const back=await t.read(KEY);assert.equal(back.bytes.toString(),'old');assert.equal(back.version,a.version);
});
test('wire metadata is unaffected by mutable GCS custom metadata',async()=>{
  const f=fixture(),t=f.make();await t.create(KEY,Buffer.from('bytes'),{revision:0});
  f.setHook((q,{u,name})=>{if(name&&u.searchParams.get('alt')!=='media'&&q.method==='GET'){
    const o=f.objects.get(name);return {status:200,body:{bucket:f.options.bucket,name,generation:o.generation,
      metageneration:'999',size:String(o.bytes.length),md5Hash:md5(o.bytes),metadata:{revision:'evil'}}};
  }});assert.deepEqual((await t.read(KEY)).metadata,{revision:0});
});
test('malformed metadata identity/generation/size/hash refuse',async()=>{
  for(const patch of [{bucket:'foreign'},{name:'candidate/other'},{generation:42},{generation:'01'},{size:'0'},{md5Hash:'bad'}]){
    const f=fixture(),t=f.make();await t.create(KEY,Buffer.from('safe'),{});
    f.setHook((q,{u,name})=>{if(name&&u.searchParams.get('alt')!=='media'){
      const o=f.objects.get(name);return {status:200,body:{bucket:f.options.bucket,name,generation:o.generation,
        size:String(o.bytes.length),md5Hash:md5(o.bytes),...patch}};}});
    await assert.rejects(t.read(KEY));
  }
});
test('wire logical checksum/key/base64 corruption and foreign envelope refuse',async()=>{
  for(const mutate of [w=>{w.integrity='0'.repeat(64);},w=>{w.key='other/pin';},w=>{w.bytes+='!';},w=>{w.v=2;}]){
    const f=fixture(),t=f.make();await t.create(KEY,Buffer.from('safe'),{});const o=f.objects.get(KEY);
    const w=JSON.parse(o.bytes);mutate(w);o.bytes=Buffer.from(JSON.stringify(w));await assert.rejects(t.read(KEY));
  }
});
test('unknown writes and bad readback stay unknown with no automatic retry',async()=>{
  for(const reply of ['throw','empty','wrong','media']){
    const f=fixture(),t=f.make();f.setHook((q,{u})=>{
      if(q.method==='POST'&&reply==='throw')throw Error(CANARY);
      if(q.method==='POST'&&reply==='empty')return {status:200,body:{}};
      if(q.method==='POST'&&reply==='wrong')return {status:500,body:{message:CANARY}};
      if(u.searchParams.get('alt')==='media'&&reply==='media')return {status:200,body:Buffer.from(CANARY)};
    });await assert.rejects(t.create(KEY,Buffer.from('safe'),{}),e=>e.category==='unknown-write'&&!String(e.stack).includes(CANARY));
    assert.equal(f.calls.filter(q=>q.method==='POST').length,1);
  }
});
test('denied/failed/malformed missing reads throw; only verified object absence returns null',async()=>{
  const f=fixture(),t=f.make();assert.equal(await t.read(KEY),null);assert.equal(f.calls.length,2);
  for(const status of [401,403,500]){const x=fixture();x.setHook(()=>({status,body:{message:CANARY}}));await assert.rejects(x.make().read(KEY));}
  const x=fixture();x.setHook(()=>({status:404,body:{}}));await assert.rejects(x.make().read(KEY));
  const y=fixture();y.setHook((q,{name})=>!name?{status:200,body:{name:y.options.bucket,projectNumber:'other',location:'US-WEST1'}}:undefined);
  await assert.rejects(y.make().read(KEY));
});
test('complete paginated list composes real object adapter; encryption/request doubles only',async()=>{
  const f=fixture({limits:{pageSize:1}}),t=f.make(),hh='household-'+'a'.repeat(32);
  const a=OA.createSettlementEvidenceObjectAdapter({householdId:hh,namespace:'candidate',transport:t,
    encrypt:async b=>Buffer.concat([Buffer.from('OFFLINE-ENCRYPTION-DOUBLE:'),b])});
  const b=C.adopt({householdId:hh}),d=JSON.parse(b).digest;
  await a.backupStore.put(0,d,b);assert.equal(await a.pinStore.advance(null,{revision:0,digest:d,timestamp:1}),true);
  assert.equal(await a.pinStore.advance(null,{revision:0,digest:d,timestamp:1}),false);
  assert.equal((await a.pinStore.read()).digest,d);assert.equal((await a.backupStore.list()).length,1);
  await assert.rejects(a.backupStore.get());assert.ok(f.calls.filter(q=>new URL(q.url).searchParams.has('prefix')).length>=2);
});
test('empty intermediate list page continues; repeated/malformed cursors and entries refuse',async()=>{
  const f=fixture();let page=0;f.setHook((q,{name})=>!name&&q.url.includes('/o?')?{status:200,body:++page===1?{nextPageToken:'opaque'}:{items:[]}}:undefined);
  const t=f.make(),first=await t.list('candidate/',null);assert.ok(first.nextCursor);assert.deepEqual((await t.list('candidate/',first.nextCursor)).entries,[]);
  for(const body of [{nextPageToken:''},{items:null},{prefixes:['hidden/']},{items:[{name:'foreign/key',generation:'1'}]}]){
    const x=fixture();x.setHook(()=>({status:200,body}));await assert.rejects(x.make().list('candidate/',null));
  }
  const x=fixture();x.setHook(()=>({status:200,body:{nextPageToken:'same'}}));const xt=x.make(),p=await xt.list('candidate/',null);
  await assert.rejects(xt.list('candidate/',p.nextCursor));await assert.rejects(xt.list('candidate/','invented'));
});
test('list explicitly refuses lost stable-namespace witness, not a provider snapshot claim',async()=>{
  const f=fixture(),t=f.make();f.setStable(false);await assert.rejects(t.list('candidate/',null));assert.equal(f.calls.length,0);
  f.setStable(true);f.setHook(()=>{f.setStable(false);return {status:200,body:{items:[]}};});await assert.rejects(t.list('candidate/',null));
  const x=fixture({limits:{pageSize:1}}),xt=x.make();
  await xt.create('candidate/a',Buffer.from('a'),{});await xt.create('candidate/z',Buffer.from('z'),{});
  const first=await xt.list('candidate/',null);
  // Deliberate bypass of the promised stable namespace, simulating an insertion
  // behind the last name in a GCS page token. This is a LIMITATION control.
  const w=JSON.parse(x.objects.get('candidate/a').bytes);w.key='candidate/0';
  x.objects.set(w.key,{generation:'123456789',bytes:Buffer.from(JSON.stringify(w))});
  const last=await xt.list('candidate/',first.nextCursor);
  assert.equal(last.nextCursor,null);assert.equal(x.objects.size,3);
  assert.equal(first.entries.length+last.entries.length,2,'an untruthful witness cannot certify concurrent completeness');
});
test('caller input is snapshotted before await and outputs do not alias stored bytes',async()=>{
  const f=fixture(),t=f.make(),b=Buffer.from('before'),m={revision:0};
  const pending=t.create(KEY,b,m);b.fill(0);m.revision=9;await pending;
  const back=await t.read(KEY);assert.equal(back.bytes.toString(),'before');assert.equal(back.metadata.revision,0);
  back.bytes.fill(0);assert.equal((await t.read(KEY)).bytes.toString(),'before');
});
test('finite timeout/bounds and no retry after late request completion',async()=>{
  const f=fixture({limits:{maxBytes:4,requestMs:10}}),t=f.make();await assert.rejects(t.create(KEY,Buffer.alloc(5),{}));assert.equal(f.calls.length,0);
  let finish;f.setHook(()=>new Promise(resolve=>{finish=resolve;}));
  await assert.rejects(t.create(KEY,Buffer.from('a'),{}),e=>e.category==='unknown-write');assert.equal(f.calls.length,1);
  finish({status:200,body:{}});await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);
});
test('page/entry/scan caps and repeated keys fail closed',async()=>{
  for(const limits of [{maxPages:1,pageSize:1},{maxEntries:1,pageSize:1}]){
    const f=fixture({limits}),t=f.make();await t.create('candidate/a',Buffer.from('a'),{});
    await t.create('candidate/z',Buffer.from('z'),{});const p=await t.list('candidate/',null);
    await assert.rejects(t.list('candidate/',p.nextCursor));
  }
  const f=fixture({limits:{requestMs:100,scanMs:10}}),t=f.make();let finish;
  f.setHook(()=>new Promise(r=>{finish=r;}));await assert.rejects(t.list('candidate/',null));
  assert.equal(f.calls[0].signal.aborted,true);finish({status:200,body:{items:[]}});
  const x=fixture(),xt=x.make();await xt.create(KEY,Buffer.from('a'),{});let page=0;
  x.setHook((q,{name})=>!name&&q.url.includes('/o?')?{status:200,body:{items:[{bucket:x.options.bucket,name:KEY,
    generation:x.objects.get(KEY).generation,metageneration:'1',size:String(x.objects.get(KEY).bytes.length),
    md5Hash:md5(x.objects.get(KEY).bytes)}],...(++page===1?{nextPageToken:'next'}:{})}}:undefined);
  const p=await xt.list('candidate/',null);await assert.rejects(xt.list('candidate/',p.nextCursor));
});
test('stable predicate refuses throwing/Promise results without assimilating foreign then',async()=>{
  for(const value of [()=>{throw Error(CANARY);},()=>Promise.reject(Error(CANARY)),()=>({get then(){throw Error(CANARY);}})]){
    const f=fixture({assertStableNamespace:value});await assert.rejects(f.make().list('candidate/',null));assert.equal(f.calls.length,0);
  }
  await new Promise(r=>setImmediate(r));
});
test('source boundary has no network/auth imports or unconditional mutation surfaces',()=>{
  const source=fs.readFileSync(path.join(ROOT,'scripts/settlement-evidence-gcs-transport.js'),'utf8');
  assert.doesNotMatch(source,/require\(['"](?:https?|google|@google-cloud)/);
  assert.doesNotMatch(source,/process\.env|\bfetch\(|method:\s*['"](?:PUT|PATCH|DELETE)['"]/);
});
