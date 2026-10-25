'use strict';
// Real factory/adapter/store/HTTP constructors; SQL, TLS, custody and Express
// transport below are OFFLINE DOUBLES. No driver, network or custody proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const { makeExclusionWorld } = require('./test-settlement-evidence-terminal-certificate');
const load = () => require(path.join(ROOT, 'scripts/settlement-evidence-postgres-runtime'))
  .createSettlementEvidencePostgresRuntime;
const host = 'db.example.test', CANARY = 'PUBLIC-DUMMY-SECRET-CANARY';
const defer = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
const turn = () => new Promise(r => setImmediate(r));
function world(hooks = {}) {
  const w = makeExclusionWorld(); // Explicitly simulated independent pin/archive/history.
  Object.assign(w, { clients:[], queries:[], ends:0, connects:0 });
  const metadata = [
    [{database:'synthetic',user:'synthetic_app',pid:314,searchPath:'pg_catalog'}],
    [{canLogin:true,superuser:false,createDb:false,createRole:false,inherit:false,
      replication:false,bypassRls:false,connectionLimit:1,memberships:0,ownedObjects:0}],
    [{connect:true,schemaUsage:true,databaseCreate:false,schemaCreate:false,tables:true,functions:true}],
    ['doc_head','doc_staged','journal','quarantine'].map(name => ({name,kind:'r',persistence:'p',
      rls:false,forceRls:false,unsafe:false,primaryKeyCount:1,
      columns:(name==='quarantine'?['scope','name','label','bytes']:['scope','bytes']).map(name =>
        ({name,type:name==='bytes'?'bytea':'text',notNull:name!=='label',generated:''})),
      primaryKey:name==='quarantine'?['scope','name']:['scope']}))
  ];
  class Client extends EventEmitter {
    constructor() { super(); w.clients.push(this); this.connection={stream:{encrypted:true,authorized:true,
      servername:host,getPeerCertificate:()=>({subjectaltname:'DNS:'+host})}};
      if(hooks.tls)Object.assign(this.connection.stream,hooks.tls); }
    async connect() {w.connects++;if(hooks.connect)await hooks.connect();}
    async end() {w.ends++;if(hooks.end)await hooks.end();this.emit('end');}
    async query(text, values) {
      const index=w.queries.length;w.queries.push(text);
      if(hooks.query){const result=await hooks.query(text,index);if(result!==undefined)return result;}
      if(index<4)return {command:'SELECT',rows:metadata[index]};
      const result=(rows=[],rowCount=0)=>({command:text.split(' ')[0],rows,rowCount});
      if(/pg_try_advisory_lock/.test(text))return result([{locked:true}]);
      if(/pg_advisory_unlock/.test(text))return result([{unlocked:true}]);
      if(/pg_backend_pid/.test(text))return result([{pid:314}]);
      if(['BEGIN','COMMIT','ROLLBACK'].includes(text))return result();
      if(/^SELECT bytes FROM/.test(text)){
        const field=text.includes('.doc_head')?'doc':text.includes('.journal')?'journal':'temp';
        return result(w[field]?[{bytes:Buffer.from(w[field])}]:[]);
      }
      if(/^WITH s AS/.test(text)){w.doc=w.temp;w.temp=null;return result([],1);}
      if(/^INSERT INTO/.test(text)){
        const field=text.includes('.doc_staged')?'temp':'journal';w[field]=Buffer.from(values[1]);return result([],1);
      }
      if(/^DELETE FROM/.test(text)){w[text.includes('.journal')?'journal':'temp']=null;return result([],1);}
      throw Error('unmodelled SQL');
    }
  }
  w.options = {connection:{Client,config:{host,port:5432,database:'synthetic',user:'synthetic_app',
    password:CANARY,ssl:{rejectUnauthorized:true,servername:host}},schema:'synthetic_state',scope:'synthetic-scope',
    timeouts:{connect:50,preflight:100,query:50,close:20}},
    custody:{pinStore:w.adapters.pinStore,backupStore:w.adapters.backupStore,
      terminalHistory:w.terminalHistory,exclusionDomain:w.domain},
    application:{householdId:JSON.parse(w.doc).householdId,origin:'https://atlas.example.test',
      authorize:async c=>({householdId:JSON.parse(w.doc).householdId,actorId:c.actorId}),
      acquire:async()=>{throw Error('unused acquisition double');},contextReader:()=>({}),
      readBase:async()=>({}),now:()=>w.time}};
  w.construct=()=>load()(w.options);
  w.start=async()=>{const r=w.construct();await r.connect();return r;};
  w.prepare=r=>w.prepareRuntime(r);
  w.prepareRuntime=r=>r.settlement.store.prepare({actorId:'session-'+'b'.repeat(64),
    operationId:'operation-'+'1'.repeat(32),command:w.command()});
  return w;
}
function unavailable(error) {
  assert.equal(error.code,'SETTLEMENT_RUNTIME_UNAVAILABLE');assert.ok(!JSON.stringify(error).includes(CANARY));return true;
}
test('default construction and retirement perform zero I/O and expose no settlement',async()=>{
  const r=load()();assert.equal(r.settlement,undefined);assert.equal(r.status().state,'disconnected');
  assert.deepEqual(Object.keys(r).sort(),['connect','retire','settlement','status']);
  assert.equal((await r.retire()).close,'not-opened');await assert.rejects(r.connect(),unavailable);
});
test('construction validates all application/custody dependencies before any Client',()=>{
  for(const mutate of [o=>delete o.application.authorize,o=>o.application.origin+='/',
    o=>delete o.custody.backupStore.get,o=>delete o.custody.terminalHistory,
    o=>o.custody.exclusionDomain={bad:true},o=>o.unrecognized=1]){
    const w=world();mutate(w.options);assert.throws(w.construct,TypeError);assert.equal(w.clients.length,0);
  }
  const w=world();Object.defineProperty(w.options.application,'authorize',{get(){throw Error(CANARY);}});
  assert.throws(w.construct,e=>!String(e).includes(CANARY));assert.equal(w.clients.length,0);
});
test('explicit single connect owns one session and only supplies incumbent consumer capabilities',async()=>{
  const w=world(),r=w.construct();assert.equal(w.connects,0);
  assert.throws(r.settlement.readDocument,unavailable);
  const a=r.connect(),b=r.connect();assert.equal(a,b);await a;
  assert.equal(r.status().state,'ready');assert.equal(w.connects,1);assert.equal(w.queries.length,4);
  assert.equal(r.settlement.query,undefined);assert.equal(r.settlement.store.bootstrap,undefined);
  assert.equal(r.settlement.store.reconcile,undefined);assert.equal(r.settlement.store.commit,undefined);
  assert.ok(r.settlement.store.terminalExclusion);assert.ok(Object.isFrozen(r.settlement));
  assert.equal(r.retire(),r.retire());await r.retire();assert.equal(w.ends,1);
  await assert.rejects(r.connect(),unavailable);assert.equal(w.connects,1);
});
test('actual HTTP consumer constructs its real resolver/controller/readers over composed store',async()=>{
  const w=world(),r=await w.start();
  // Only Express routing is stubbed; load the unchanged real HTTP module.
  const filename=path.join(ROOT,'scripts/settlement-evidence-http.js');
  const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
  const normal=m.require.bind(m),router={use(){},post(){},get(){}};
  m.require=id=>id==='express'?{Router:()=>router,json:()=>()=>{}}:normal(id);m._compile(fs.readFileSync(filename,'utf8'),filename);
  const bridge=m.exports.mountSettlementHttp({use(){}},()=> 'session-'+'b'.repeat(64),r.settlement);
  assert.equal(bridge.active,true);
  const base={plan:{commitments:[]},settlementEvidence:{stale:true}};
  const data=await bridge.browserData({},async()=>base,x=>x);
  assert.equal(data.settlementEvidenceStatus.status,'qualified');
  assert.notEqual(data.settlementEvidence,base.settlementEvidence);
  await r.retire();let published=false;
  await assert.rejects(bridge.browserData({},async()=>base,()=>{published=true;}),
    e=>e.code==='settlement-browser-unavailable');assert.equal(published,false);
});
test('real store commits and returns the exact original qualified receipt with custody doubles',async()=>{
  const w=world(),r=await w.start(),p=await w.prepare(r);assert.ok(p.preview);
  const input=w.input(p),receipt=await r.settlement.commitAdmitted(input,()=>true);
  assert.equal(receipt.status,'committed');assert.equal(receipt.revision,1);
  const {actorId,...publicReceipt}=receipt;
  assert.equal(actorId,input.actorId);
  assert.deepEqual(await r.settlement.store.outcome({actorId:input.actorId,operationId:p.preview.operationId}),publicReceipt);
  assert.deepEqual(await r.settlement.commitAdmitted(input,()=>{throw Error('must not re-admit');}),receipt);
  assert.equal(w.pin.revision,1);assert.equal(w.journal,null);assert.equal(w.temp,null);await r.retire();
});
for(const stage of ['connect','tls','identity','role','privileges','schema'])test('failed '+stage+' never publishes a session',async()=>{
  const hooks=stage==='connect'?{connect:()=>{throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}}
    :stage==='tls'?{tls:{authorized:false}}
    :{query:(_t,i)=>i===['identity','role','privileges','schema'].indexOf(stage)?{command:'SELECT',rows:[]}:undefined};
  const w=world(hooks),r=w.construct();await assert.rejects(r.connect(),e=>{
    assert.ok(!String(e).includes(CANARY));assert.equal(e.diagnostic.stage,stage);return true;});
  assert.notEqual(r.status().state,'ready');await r.retire();assert.equal(w.ends,1);
  assert.throws(r.settlement.readDocument,unavailable);assert.equal(w.connects,1);
});
test('retirement during pending connect fences late success and waits for sole close',async()=>{
  const gate=defer(),w=world({connect:()=>gate.promise}),r=w.construct(),opening=r.connect();
  await turn();const retiring=r.retire();gate.resolve();await assert.rejects(opening,unavailable);
  assert.equal((await retiring).close,'confirmed');assert.equal(w.ends,1);assert.equal(w.connects,1);
});
test('late connect timeout retains factory primary and does not reconnect',async()=>{
  const gate=defer(),w=world({connect:()=>gate.promise});w.options.connection.timeouts.connect=5;
  const r=w.construct();await assert.rejects(r.connect(),e=>e.diagnostic.category==='timeout');
  const report=await r.retire();assert.equal(report.close,'unconfirmed');gate.resolve();await turn();
  assert.equal(w.ends,1);assert.notEqual(r.status().state,'ready');
});
for(const event of ['error','end','query'])test(event+' loss permanently fences all capabilities',async()=>{
  let rejectQuery=false;
  const w=world({query:(_t,i)=>{if(rejectQuery&&i>=4)throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}}),r=await w.start();
  if(event==='query'){rejectQuery=true;await assert.rejects(r.settlement.readDocument(),unavailable);}
  else w.clients[0].emit(event,Object.assign(Error(CANARY),{code:'ECONNRESET'}));
  await r.retire();const count=w.queries.length;
  assert.throws(r.settlement.readPin,unavailable);
  assert.throws(()=>r.settlement.store.outcome({}),unavailable);
  assert.equal(w.queries.length,count);assert.equal(w.ends,1);assert.equal(w.connects,1);
  assert.ok(!JSON.stringify(r.status()).includes(CANARY));
  await assert.rejects(r.connect(),unavailable);
});
for(const close of ['failed','unconfirmed'])test('close '+close+' is preserved, never retried',async()=>{
  const w=world({end:close==='failed'?()=>{throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}:()=>new Promise(()=>{})});
  const r=await w.start(),report=await r.retire();assert.equal(report.close,close);
  assert.equal(report.closeDiagnostic.stage,'end');assert.ok(!JSON.stringify(report).includes(CANARY));
  assert.equal(await r.retire(),report);assert.equal(w.ends,1);
});
test('late custody read cannot publish or continue to SQL after retirement',async()=>{
  const gate=defer(),w=world();w.hooks.pinRead=()=>gate.promise;
  const r=await w.start(),pending=w.prepare(r);await turn();await r.retire();const count=w.queries.length;
  gate.resolve({...w.pin});await assert.rejects(pending,unavailable);assert.equal(w.queries.length,count);
});
test('retirement during archive acknowledgement never advances pin or fabricates a receipt',async()=>{
  const gate=defer(),entered=defer(),w=world();const put=w.options.custody.backupStore.put;
  w.options.custody.backupStore={...w.options.custody.backupStore,put:async(...args)=>{entered.resolve();await gate.promise;return put(...args);}};
  const r=await w.start(),p=await w.prepare(r),pending=r.settlement.commitAdmitted(w.input(p),()=>true);
  await entered.promise;await r.retire();const count=w.queries.length;gate.resolve();
  await assert.rejects(pending,unavailable);assert.equal(w.pin.revision,0);assert.ok(w.journal);
  assert.equal(w.queries.length,count);assert.equal(w.ends,1);
});
test('unreadable injected custody stays unknown without leaking raw diagnostic or retry',async()=>{
  const w=world();w.hooks.pinRead=()=>{throw Error(CANARY);};const r=await w.start();
  const result=await w.prepare(r);assert.equal(result.status,'unavailable');
  assert.ok(!JSON.stringify(result).includes(CANARY));await r.retire();assert.equal(w.connects,1);
});
test('retiring a configured but unopened runtime never constructs a Client',async()=>{
  const w=world(),r=w.construct();assert.equal((await r.retire()).close,'not-opened');
  await assert.rejects(r.connect(),unavailable);assert.equal(w.clients.length,0);
});
test('late preflight cannot publish after retirement and close diagnostics retain primary',async()=>{
  const gate=defer(),entered=defer();
  const w=world({query:(_t,i)=>{if(i===1){entered.resolve();return gate.promise;}},
    end:()=>{throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}}),r=w.construct();
  const pending=r.connect();await entered.promise;const retiring=r.retire();gate.resolve({command:'SELECT',rows:[]});
  await assert.rejects(pending,e=>e.diagnostic.stage==='role');
  const report=await retiring;assert.equal(report.close,'failed');assert.equal(report.primary.stage,'role');
  assert.equal(report.closeDiagnostic.code,'ECONNRESET');assert.equal(r.status().retirement,report);
  assert.equal(w.ends,1);assert.equal(w.queries.length,2);
});
test('late query result cannot escape retirement or dispatch a subsequent query',async()=>{
  const gate=defer(),entered=defer(),w=world({query:(_t,i)=>{
    if(i===4){entered.resolve();return gate.promise;}
  }}),r=await w.start();
  const pending=r.settlement.readDocument();await entered.promise;await r.retire();
  await assert.rejects(pending,unavailable);gate.resolve({command:'SELECT',rows:[{bytes:w.doc}]});await turn();
  assert.equal(w.queries.length,5);assert.equal(w.ends,1);
});
test('pending policy/base/acquisition responses cannot escape after retirement',async()=>{
  for(const name of ['authorize','readBase','acquire','contextReader']){
    const gate=defer(),w=world();w.options.application[name]=()=>gate.promise;
    const r=await w.start(),pending=r.settlement[name]({actorId:'invented'});await r.retire();gate.resolve({});
    await assert.rejects(pending,unavailable);assert.equal(w.queries.length,4);
  }
});
test('connection inputs are snapshotted and invalid driver config is refused before construction',async()=>{
  const w=world(),r=w.construct();w.options.connection.config.ssl.rejectUnauthorized=false;
  w.options.connection.config.host='changed.example.test';w.options.application.now=()=>{throw Error(CANARY);};
  await r.connect();assert.equal(r.settlement.now(),w.time);await r.retire();
  const bad=world();bad.options.connection.config.ssl.rejectUnauthorized=false;
  const refused=bad.construct();await assert.rejects(refused.connect(),e=>e.diagnostic.category==='invalid-config');
  assert.equal(bad.clients.length,0);assert.equal((await refused.retire()).close,'not-opened');
});
test('same known custody surface cannot be rewrapped into a conflicting terminal domain',()=>{
  const w=world();w.construct();const other=world();other.options.custody.pinStore=w.options.custody.pinStore;
  assert.throws(other.construct,TypeError);assert.equal(other.clients.length,0);
});
