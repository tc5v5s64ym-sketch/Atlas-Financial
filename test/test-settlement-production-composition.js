'use strict';
// ATLAS-083: real startup/listen, connection owners, stores, controller and HTTP.
// SQL/TLS, independent custody, household policy and refresh/provider acquisition
// below are explicitly OFFLINE SYNTHETIC DOUBLES, not live qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const C = require('../scripts/planned-obligation-settlement-contract');
const Refresh = require('../scripts/server-live-refresh');
const { makeExclusionWorld, householdId, op } = require('./test-settlement-evidence-terminal-certificate');
const { startServer } = require('../server');
const syntheticPassword = 'synthetic-composition-password';
const syntheticSessionSecret = 'synthetic-composition-session-secret';
const env = { SITE_PASSWORD:syntheticPassword, SESSION_SECRET:syntheticSessionSecret,
  ATLAS_LIVE_OVERLAY:'live' };
const host = 'db.example.test', canary = 'SYNTHETIC-CONFIG-SECRET-CANARY';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const clone = x => structuredClone(x);
const defer = () => { let resolve; const promise = new Promise(r => { resolve=r; }); return {promise,resolve}; };
const turn = () => new Promise(r => setImmediate(r));

function world() {
  const w = makeExclusionWorld();
  w.time = Date.now(); w.clients=[]; w.sql=[]; w.events=[]; w.hooks={};
  w.eligibility=new Map(); w.revoked=new Set(); w.sessions=new Set();
  w.base=require('./fixtures/savings-daily-consumer-data')();
  w.base.plan.savingsEarmarks.pools[0].goalRefs=[{kind:'commitment',id:'near'}];
  const packet=clone(w.base.liveOverlay.currentPeriodActuals);
  packet.transactions=[{id:'synthetic-row',date:'2026-10-03',amount:60,currency:'cad',pending:false,
    categoryLabel:'Groceries',merchantKnown:true,atlasAccountId:'chequing-a',accountRole:'household-cash',
    displayedPayee:'Synthetic recorded payment'}];
  packet.transactionWindow={startDate:'2026-10-02',endDate:'2026-10-05',complete:true,hasMore:false,truncated:false};
  w.acquisition={packet,plan:clone(w.base.plan),join:[{localId:'synthetic-row',
    providerAccountId:'SYNTHETIC-ACCOUNT',transactionId:'SYNTHETIC-TRANSACTION'}],
    map:{mappings:[{providerAccountId:'SYNTHETIC-ACCOUNT',canonical:{id:'chequing-a',collection:'cash'}}]}};
  w.context={canonical:w.base,env:{...env},domain:'synthetic-household-authority',contextRevision:1};
  w.allowed=true; w.acquireCalls=0; w.witnessCalls=0; w.serveCalls=0;
  const metadata = kind => [
    [{database:'synthetic',user:kind+'_app',pid:kind==='financial'?301:302,searchPath:'pg_catalog'}],
    [{canLogin:true,superuser:false,createDb:false,createRole:false,inherit:false,
      replication:false,bypassRls:false,connectionLimit:1,memberships:0,ownedObjects:0}],
    [{connect:true,schemaUsage:true,databaseCreate:false,schemaCreate:false,tables:true,functions:true}],
    kind==='financial' ? ['doc_head','doc_staged','journal','quarantine'].map(name=>({name,kind:'r',persistence:'p',
      rls:false,forceRls:false,unsafe:false,primaryKeyCount:1,
      columns:(name==='quarantine'?['scope','name','label','bytes']:['scope','bytes']).map(name=>
        ({name,type:name==='bytes'?'bytea':'text',notNull:name!=='label',generated:''})),
      primaryKey:name==='quarantine'?['scope','name']:['scope']}))
      : Object.entries({auth_eligibility:[['scope','text'],['household_id','text'],['operation_id','text'],
          ['generation','text'],['confirmation_digest','text'],['secret_digest','text'],['issued_at','bigint']],
        auth_revocation:[['scope','text'],['operation_id','text'],['generation','text'],['revoked_at','bigint']],
        auth_session_revocation:[['scope','text'],['sid_digest','text'],['revoked_at','bigint']]})
        .map(([name,columns])=>({name,kind:'r',persistence:'p',rls:false,forceRls:false,unsafe:false,primaryKeyCount:1,
          columns:columns.map(([name,type])=>({name,type,notNull:true,generated:''})),
          primaryKey:name==='auth_session_revocation'?['scope','sid_digest']:['scope','operation_id','generation']}))
  ];
  function client(kind) {
    return class SyntheticClient extends EventEmitter {
      constructor(config) { super(); this.kind=kind; this.config=config; this.ends=0; this.count=0;
        this.connection={stream:{encrypted:true,authorized:true,servername:host,
          getPeerCertificate:()=>({subjectaltname:'DNS:'+host})}};
        w.clients.push(this); w.events.push('construct:'+kind); }
      async connect() { w.events.push('connect:'+kind); if(w.hooks.connect)await w.hooks.connect(kind); }
      async end() { this.ends++; w.events.push('end:'+kind);
        if(w.hooks.end)await w.hooks.end(kind); this.emit('end'); }
      async query(text,values=[]) {
        w.sql.push({kind,text,values});
        if(w.hooks.query) {const v=await w.hooks.query(kind,text,values);if(v!==undefined)return v;}
        if(this.count++<4)return {command:'SELECT',rows:metadata(kind)[this.count-1]};
        const result=(rows=[],rowCount=0)=>({command:text.split(' ')[0],rows,rowCount});
        if(['BEGIN','COMMIT','ROLLBACK'].includes(text))return result();
        if(kind==='authorization') {
          const key=values[1]+'|'+values[2];
          if(text.startsWith('SELECT e.household_id')) {
            const e=w.eligibility.get(key);
            const rows=[e?{household_id:e.householdId,operation_id:e.operationId,generation:e.generation,
              confirmation_digest:e.confirmationDigest,secret_digest:e.secretDigest,issued_at:String(e.issuedAt),
              operation_revoked:w.revoked.has(key),session_revoked:w.sessions.has(values[3])}
              :{household_id:null,operation_id:null,generation:null,confirmation_digest:null,secret_digest:null,issued_at:null,
                operation_revoked:w.revoked.has(key),session_revoked:w.sessions.has(values[3])}];
            if(w.hooks.snapshot)await w.hooks.snapshot(rows[0],values);
            return result(rows);
          }
          if(text.startsWith('SELECT scope, household_id')) {
            const e=w.eligibility.get(key);return result(e?[{scope:values[0],household_id:e.householdId,
              operation_id:e.operationId,generation:e.generation,confirmation_digest:e.confirmationDigest,
              secret_digest:e.secretDigest,issued_at:String(e.issuedAt)}]:[]);
          }
          if(text.startsWith('SELECT revoked_at'))return result((text.includes('auth_session_revocation')
            ?w.sessions.has(values[1]):w.revoked.has(key))?[{revoked_at:'1'}]:[]);
          if(text.startsWith('INSERT INTO')) {
            if(text.includes('auth_eligibility'))w.eligibility.set(values[2]+'|'+values[3],{
              householdId:values[1],operationId:values[2],generation:values[3],confirmationDigest:values[4],
              secretDigest:values[5],issuedAt:values[6]});
            else if(text.includes('auth_session_revocation'))w.sessions.add(values[1]);
            else w.revoked.add(key);
            return result([],1);
          }
        } else {
          if(text.includes('pg_try_advisory_lock'))return result([{locked:true}]);
          if(text.includes('pg_advisory_unlock'))return result([{unlocked:true}]);
          if(text.includes('pg_backend_pid'))return result([{pid:301}]);
          if(text.startsWith('SELECT bytes FROM')) {
            const field=text.includes('.doc_head')?'doc':text.includes('.journal')?'journal':'temp';
            return result(w[field]?[{bytes:Buffer.from(w[field])}]:[]);
          }
          if(text.startsWith('WITH s AS')) {w.doc=w.temp;w.temp=null;return result([],1);}
          if(text.startsWith('INSERT INTO')) {
            if(text.includes('.quarantine'))throw Error('synthetic maintenance forbidden');
            w[text.includes('.doc_staged')?'temp':'journal']=Buffer.from(values[1]);return result([],1);
          }
          if(text.startsWith('DELETE FROM')) {w[text.includes('.journal')?'journal':'temp']=null;return result([],1);}
        }
        throw Error('unmodelled synthetic SQL');
      }
    };
  }
  const connection=kind=>({Client:client(kind),config:{host,port:5432,database:'synthetic',user:kind+'_app',
    password:canary,ssl:{rejectUnauthorized:true,servername:host}},schema:'synthetic_'+kind,scope:'synthetic-scope',
    timeouts:{connect:100,preflight:1000,query:1000,close:40}});
  w.config={connection:connection('financial'),authorization:connection('authorization'),
    custody:{pinStore:w.adapters.pinStore,backupStore:w.adapters.backupStore,terminalHistory:w.terminalHistory,
      exclusionDomain:w.domain},application:{householdId,origin:'https://atlas.example.test',
      authorize:c=>{if(!w.allowed)throw Error('synthetic household denied');return {householdId,actorId:c.actorId};},
      authorizeRecovery:async c=>({householdId,actorId:c.actorId,operationId:c.operationId}),
      contextReader:()=>w.context,now:()=>w.time}};
  w.start=()=>startServer({env:{...env},host:'127.0.0.1',port:0,settlement:w.config});
  return w;
}

// Labelled provider/refresh DOUBLE: exercises the exact production call shape,
// private acquisition pairing and trust revision; existing refresh suites own
// worker/provider lifecycle proof. No served rows reconstruct private provenance.
async function started(t,w=world()) {
  const serve=Refresh.serve, acquire=Refresh.acquireSettlementWithWitness;
  Refresh.serve=async(c,e)=>{w.serveCalls++;if(w.hooks.serve)await w.hooks.serve();return clone(c);};
  Refresh.acquireSettlementWithWitness=async(c,e,o)=>{
    w.acquireCalls++; assert.equal(typeof o.contextReader,'function');
    const captured=clone(o.contextReader());
    assert.deepEqual(c,captured.canonical);assert.deepEqual(e,captured.env);
    if(w.hooks.acquire)await w.hooks.acquire();
    return {acquisition:clone(w.acquisition),witness:()=>{w.witnessCalls++;
      const cur=o.contextReader();return cur.contextRevision===captured.contextRevision&&cur.domain===captured.domain;}};
  };
  t.after(async()=>{if(w.owner)await w.owner.close();Refresh.serve=serve;Refresh.acquireSettlementWithWitness=acquire;});
  w.owner=await w.start(); w.url='http://127.0.0.1:'+w.owner.server.address().port;
  w.cookie=await login(w); return w;
}
function request(w,path,body,cookie=w.cookie) {
  return new Promise((resolve,reject)=>{
    const bytes=body===undefined?null:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
    const req=http.request(w.url+path,{method:bytes?'POST':'GET',agent:false,headers:{
      ...(cookie?{Cookie:cookie}:{}),...(bytes?{'Content-Type':typeof body==='string'?'application/x-www-form-urlencoded':'application/json',
        'Content-Length':bytes.length,Origin:'https://atlas.example.test','X-Atlas-Settlement':'same-origin','Sec-Fetch-Site':'same-origin'}:{})}},res=>{
      let raw='';res.setEncoding('utf8');res.on('data',x=>{raw+=x;});res.on('end',()=>{
        let value;try{value=JSON.parse(raw);}catch{value=raw;}resolve({status:res.statusCode,headers:res.headers,value});});
    }); req.setTimeout(5000,()=>req.destroy(Error('synthetic request deadline')));req.on('error',reject);req.end(bytes);
  });
}
async function login(w) {const r=await request(w,'/login','password='+env.SITE_PASSWORD,null);
  assert.equal(r.status,302);return r.headers['set-cookie'][0].split(';')[0];}
async function prepared(w,n=1) {
  const catalogue=(await request(w,'/settlement/selections',{})).value;
  assert.equal(catalogue.status,'available');
  const r=(await request(w,'/settlement/prepare',{operationId:op(n),selection:{
    transaction:catalogue.transactions[0].handle,commitment:catalogue.commitments.find(x=>x.label.includes('first')).handle},assignedCents:2500})).value;
  assert.equal(r.status,'prepared');assert.match(r.recoverySecret,/^[a-f0-9]{64}$/);return r;
}
const confirm=(w,p)=>request(w,'/settlement/confirm',{operationId:p.operationId,previewToken:p.previewToken,generation:p.generation,confirmed:true});
const credential=p=>({operationId:p.operationId,generation:p.generation,recoverySecret:p.recoverySecret});

test('PC1 real startup/listen is inactive by default, with no settlement client or custody work',async t=>{
  assert.equal(typeof startServer,'function');
  const w=world();w.owner=await startServer({env:{...env},host:'127.0.0.1',port:0,baseSource:async()=>clone(w.base)});
  t.after(()=>w.owner.close());w.url='http://127.0.0.1:'+w.owner.server.address().port;w.cookie=await login(w);
  assert.equal((await request(w,'/healthz')).value,'ok');
  assert.equal((await request(w,'/settlement/capability')).value.status,'inactive');
  assert.equal(w.clients.length,0);assert.equal(w.reads,0);assert.deepEqual(w.writes,[]);
  assert.match(fs.readFileSync(require.resolve('../server'),'utf8'),/if \(require.main === module\)[\s\S]*startServer\(/);
});
test('PC1 all explicit profiles and capabilities validate before either Client is constructed',async()=>{
  for(const mutate of [c=>{c.authorization.config.ssl.rejectUnauthorized=false;},c=>{c.connection.config.host='localhost';},
    c=>{c.authorization.timeouts.query=7001;},c=>{delete c.application.authorizeRecovery;},
    c=>{c.custody.terminalHistory={};},c=>{c.application.contextReader=async()=>({});},
    c=>{c.connection.extra=true;},c=>{c.authorization.config.password='';}]) {
    const w=world();mutate(w.config);await assert.rejects(w.start,/composition/);assert.equal(w.clients.length,0);
  }
});
test('PC2 two sessions, catalog-only startup, and once-only close ordering',async t=>{
  const w=await started(t);assert.equal(w.clients.length,2);assert.equal(w.sql.length,8);
  assert.deepEqual(w.events.slice(0,4),['construct:financial','connect:financial','construct:authorization','connect:authorization']);
  assert.equal(w.reads,0);assert.deepEqual(w.writes,[]);assert.equal(w.owner.status().state,'ready');
  const a=w.owner.close(),b=w.owner.close();assert.equal(a,b);const reports=await a;
  assert.equal(reports.financial.close,'confirmed');assert.equal(reports.authorization.close,'confirmed');
  assert.ok(w.clients.every(c=>c.ends===1));assert.equal(w.owner.status().state,'retired');
});
test('PC2 partial startup failure retires the financial and allocated authorization sessions',async()=>{
  const w=world();w.hooks.connect=k=>{if(k==='authorization')throw Error(canary);};
  await assert.rejects(w.start,e=>{assert.ok(!String(e).includes(canary));return /composition/.test(String(e));});
  assert.equal(w.clients.length,2);assert.ok(w.clients.every(c=>c.ends===1));
});
test('PC2 unconfirmed close remains lost, never retried or claimed confirmed',async t=>{
  const w=await started(t);w.hooks.end=k=>k==='authorization'?new Promise(()=>{}):undefined;
  const r=await w.owner.close();assert.equal(r.authorization.close,'unconfirmed');assert.equal(w.owner.status().state,'lost');
  await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});
test('PC3 assignment/confirm/original receipt/reload use the assembled production stack exactly once',async t=>{
  const w=await started(t),p=await prepared(w),r=await confirm(w,p);assert.equal(r.value.status,'committed');
  assert.equal(w.witnessCalls,1);assert.equal(JSON.parse(w.doc).revision,1);
  assert.deepEqual((await confirm(w,p)).value,r.value);assert.equal(JSON.parse(w.doc).revision,1);
  const view=await request(w,'/settlement/publication',{operationId:p.operationId});
  assert.equal(view.value.status,'committed');assert.equal(view.value.publication,'included');
  assert.equal((await request(w,'/data.json')).value.settlementEvidenceStatus.status,'qualified');
  const later=await login(w);assert.notEqual(later,w.cookie);
  const recovered=await request(w,'/settlement/outcome',credential(p),later);
  assert.deepEqual(recovered.value,{status:'committed',operationId:p.operationId});
  const read=w.sql.filter(x=>x.text.startsWith('SELECT e.household_id')).at(-1);
  assert.equal(read.values[3],hash(JSON.parse(Buffer.from(later.split('=')[1].split('.')[0],'base64url')).sid));
  assert.equal(JSON.parse(w.doc).revision,1);
  assert.equal((await request(w,'/settlement/outcome',{operationId:p.operationId},later)).status,503);
  for(const bad of [{...credential(p),generation:'generation-'+'f'.repeat(32)},
    {...credential(p),recoverySecret:'f'.repeat(64)}])assert.notEqual((await request(w,'/settlement/outcome',bad,later)).value.status,'committed');
});
test('PC4 settled uncertainty keeps its latch until private inspection proves disposition AND readiness',async t=>{
  const w=await started(t),p=await prepared(w);let denyOnce=true;
  w.hooks.query=(kind,text)=>{if(denyOnce&&kind==='financial'&&text.startsWith('DELETE FROM')&&text.includes('.journal')){
    denyOnce=false;w.allowed=false;return {command:'DELETE',rows:[],rowCount:0};}};
  assert.equal((await confirm(w,p)).value.status,'unavailable');w.allowed=true;
  assert.equal(JSON.parse(w.doc).revision,1);assert.ok(w.journal);
  assert.deepEqual(await w.owner.recoverSettledUncertainty(),{status:'blocked'});
  // Labelled maintenance DOUBLE resolves its journal outside startup, not by
  // any production route or bootstrap/reconcile capability.
  w.journal=null;assert.deepEqual(await w.owner.recoverSettledUncertainty(),{status:'resolved'});
  assert.equal((await request(w,'/settlement/outcome',{operationId:p.operationId})).value.status,'committed');
  assert.equal(JSON.parse(w.doc).revision,1);
});
test('PC5 startup never repairs traces; missing/malformed pin/checkpoint refuses admission',async t=>{
  const w=world();w.journal=Buffer.from('{"synthetic":"retained-uncertainty"}');
  const saved=Buffer.from(w.journal);await started(t,w);assert.deepEqual(w.journal,saved);assert.deepEqual(w.writes,[]);
  w.journal=null;w.pin=null;assert.notEqual((await request(w,'/data.json')).value.settlementEvidenceStatus.status,'qualified');
  assert.deepEqual(w.writes,[]);w.pin={revision:0,digest:'malformed'};
  assert.notEqual((await request(w,'/data.json')).value.settlementEvidenceStatus.status,'qualified');
  w.checkpoint=null;assert.notEqual((await request(w,'/settlement/assignments',{})).value.status,'available');
});
test('PC6 trusted context ABA during acquisition/prewrite and regressed revisions refuse without commit',async t=>{
  const w=await started(t),p=await prepared(w);
  w.hooks.acquire=()=>{w.context={...w.context,contextRevision:w.context.contextRevision+2};};
  assert.notEqual((await confirm(w,p)).value.status,'committed');assert.equal(JSON.parse(w.doc).revision,0);
  w.context={...w.context,contextRevision:1};assert.equal((await request(w,'/data.json')).status,503);
  w.context={...w.context,contextRevision:3};assert.equal((await request(w,'/data.json')).status,503,
    'restored inputs cannot silently reopen a retired configured lifetime');
});
test('PC6 either owned session loss fences the composition and retires both sessions',async t=>{
  const w=await started(t);w.clients[1].emit('error',Error(canary));await turn();await turn();
  assert.notEqual(w.owner.status().state,'ready');
  assert.equal((await request(w,'/data.json')).status,503);
  await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});
test('PC7 final authority separates pre-snapshot revocation from permitted post-snapshot completion',async t=>{
  const w=await started(t),p=await prepared(w);assert.equal((await confirm(w,p)).value.status,'committed');
  const later=await login(w),sid=JSON.parse(Buffer.from(later.split('=')[1].split('.')[0],'base64url')).sid;
  w.sessions.add(hash(sid));assert.equal((await request(w,'/settlement/outcome',credential(p),later)).status,503);
  w.sessions.clear();let reads=0;w.hooks.snapshot=()=>{reads++;w.sessions.add(hash(sid));};
  assert.equal((await request(w,'/settlement/outcome',credential(p),later)).value.status,'committed');assert.equal(reads,1);
  assert.equal((await request(w,'/settlement/outcome',credential(p),later)).status,503);
});
test('PC7 expiry and household revocation during the final read suppress disclosure',async t=>{
  const w=await started(t),p=await prepared(w);await confirm(w,p);const later=await login(w);
  w.hooks.snapshot=()=>{w.allowed=false;};
  assert.equal((await request(w,'/settlement/publication',credential(p),later)).status,503);
  w.allowed=true;w.hooks.snapshot=()=>{w.time=Date.now()+15*24*3600*1000;};
  assert.equal((await request(w,'/settlement/outcome',credential(p),later)).status,503);
});
test('PC8 logout awaits a durable session tombstone; repeated logout is already-present',async t=>{
  const w=await started(t),entered=defer(),release=defer();
  w.hooks.query=async(k,text)=>{if(k==='authorization'&&text.includes('INSERT INTO')&&text.includes('auth_session_revocation')){
    entered.resolve();await release.promise;}};
  let finished=false;const out=request(w,'/logout',{}).then(r=>{finished=true;return r;});await entered.promise;
  assert.equal(finished,false);release.resolve();const r=await out;assert.equal(r.status,302);
  assert.match(r.headers['set-cookie'][0],/Max-Age=0/);assert.equal(w.sessions.size,1);
  assert.equal((await request(w,'/logout',{})).status,302);assert.equal(w.sessions.size,1);
});
test('PC8 logout lost acknowledgement clears cookie, stays unknown, retires both, and never replays',async t=>{
  const w=await started(t);let commits=0;
  w.hooks.query=(k,text)=>{if(k==='authorization'&&text==='COMMIT'){commits++;throw Error(canary);}};
  const r=await request(w,'/logout',{});assert.equal(r.status,503);assert.match(r.headers['set-cookie'][0],/Max-Age=0/);
  assert.equal(w.sessions.size,1);assert.equal(commits,1);await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});
test('PC9 lost issuance acknowledgement installs no usable preview and is never replayed',async t=>{
  const w=await started(t);let commits=0;
  w.hooks.query=(k,text)=>{if(k==='authorization'&&text==='COMMIT'){commits++;throw Error(canary);}};
  const c=(await request(w,'/settlement/selections',{})).value;
  const r=await request(w,'/settlement/prepare',{operationId:op(1),selection:{transaction:c.transactions[0].handle,
    commitment:c.commitments[0].handle},assignedCents:2500});
  assert.equal(r.value.status,'unavailable');assert.equal(r.value.previewToken,undefined);assert.equal(commits,1);
  assert.equal(JSON.parse(w.doc).revision,0);await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});
test('PC10 browser dispatched marker credential survives failed recovery and clears only after receipt-bound publication',async t=>{
  const w=await started(t),p=await prepared(w);await confirm(w,p);w.cookie=await login(w);
  const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
  const start=source.indexOf('const SettlementSave ='),end=source.indexOf('\n})();',start)+6;
  assert.ok(start>=0&&end>start);
  const key='atlas-settlement-pending-v1',marker=JSON.stringify({...credential(p),phase:'dispatched'}),storage=new Map([[key,marker]]);
  const sandbox={navigator:{locks:{request:async(...args)=>args.at(-1)()}},localStorage:{getItem:k=>storage.get(k)??null,
    setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},AbortController,setTimeout,clearTimeout,
    fetch:async(url,options={})=>{const r=await request(w,url,options.body?JSON.parse(options.body):undefined);
      return {ok:r.status>=200&&r.status<300,status:r.status,json:async()=>r.value};}};
  vm.createContext(sandbox);vm.runInContext(source.slice(start,end)+'\nglobalThis.save=SettlementSave;',sandbox);
  const attempt={signal:new AbortController().signal,current:()=>true};
  w.allowed=false;await assert.rejects(sandbox.save.initialData(async()=>clone(w.base),attempt.signal,attempt));assert.equal(storage.get(key),marker);
  w.allowed=true;const published=await sandbox.save.initialData(async()=>clone(w.base),attempt.signal,attempt);
  await sandbox.save.publishInitial(attempt,published,()=>{});await sandbox.save.initialized(attempt);
  assert.equal(published.settlementEvidenceStatus.status,'qualified');assert.equal(storage.has(key),false);
  const publicData=JSON.stringify(published);for(const hidden of [p.recoverySecret,canary,'confirmationDigest','sidDigest','historyBytes'])
    assert.ok(!publicData.includes(hidden));
});

test('PC5 negative certificate recovery is bound to the exact operation and generation',async t=>{
  const w=await started(t),p=await prepared(w);w.time+=C.TTL_MS+1;
  const negative=await confirm(w,p);assert.equal(negative.value.status,'not-applied');
  assert.equal(JSON.parse(w.doc).revision,0);assert.equal(w.records().length,1);
  const later=await login(w);
  assert.deepEqual((await request(w,'/settlement/outcome',credential(p),later)).value,
    {status:'not-applied',operationId:p.operationId,generation:p.generation});
  for(const bad of [{...credential(p),generation:'generation-'+'f'.repeat(32)},
    {...credential(p),operationId:op(2)}])
    assert.notEqual((await request(w,'/settlement/outcome',bad,later)).value.status,'not-applied');
});

test('PC9 lost pin acknowledgement preserves durable save and recovery latch without replay',async t=>{
  const w=world(),advance=w.config.custody.pinStore.advance;let advances=0;
  w.config.custody.pinStore={...w.config.custody.pinStore,async advance(...args){
    advances++;await advance(...args);return undefined;}};
  await started(t,w);const p=await prepared(w),r=await confirm(w,p);
  assert.equal(r.value.status,'unknown');assert.equal(JSON.parse(w.doc).revision,1);assert.ok(w.journal);
  assert.deepEqual(await w.owner.recoverSettledUncertainty(),{status:'blocked'});
  // A subsequent confirm may READ the now-proven original receipt. It must
  // never execute the write again or pretend the first acknowledgement landed.
  assert.equal((await confirm(w,p)).value.status,'committed');assert.equal(advances,1);
  const retained=Buffer.from(w.journal);await w.owner.close();
  w.owner=await w.start();w.url='http://127.0.0.1:'+w.owner.server.address().port;w.cookie=await login(w);
  assert.deepEqual(w.journal,retained,'restart preserves settled uncertainty and performs no repair');
  assert.equal((await request(w,'/settlement/outcome',credential(p))).value.status,'committed');
  assert.equal(JSON.parse(w.doc).revision,1);
  assert.equal(advances,1);
});

test('PC9 unknown final authorization read retires both owners without disclosure or cached replay',async t=>{
  const w=await started(t),p=await prepared(w);await confirm(w,p);const later=await login(w);
  let reads=0;w.hooks.query=(kind,text)=>{if(kind==='authorization'&&text.startsWith('SELECT e.household_id')){
    reads++;throw Error(canary);}};
  const r=await request(w,'/settlement/outcome',credential(p),later);
  assert.equal(r.status,503);assert.deepEqual(r.value,{status:'unavailable'});assert.equal(reads,1);
  assert.equal((await request(w,'/settlement/outcome',credential(p),later)).status,503);assert.equal(reads,1);
  await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});

test('PC6 retirement while final authorization awaits refuses a late affirmative snapshot',async t=>{
  const w=await started(t),p=await prepared(w);await confirm(w,p);const later=await login(w);
  const entered=defer(),release=defer();w.hooks.snapshot=async()=>{entered.resolve();await release.promise;};
  const pending=request(w,'/settlement/publication',credential(p),later);await entered.promise;
  const closed=w.owner.close();release.resolve();const r=await pending;
  assert.equal(r.status,503);assert.deepEqual(r.value,{status:'unavailable'});await closed;
  assert.ok(w.clients.every(c=>c.ends===1));
});

test('PC6 failed trusted context or refresh never reopens admission when inputs are restored',async t=>{
  const w=await started(t);w.hooks.serve=()=>{throw Error(canary);};
  assert.equal((await request(w,'/data.json')).status,503);delete w.hooks.serve;
  assert.equal((await request(w,'/settlement/selections',{})).status,503);
  await w.owner.close();assert.ok(w.clients.every(c=>c.ends===1));
});
