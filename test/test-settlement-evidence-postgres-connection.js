'use strict';
// Offline injected-Client qualification only. No pg, socket, credential or provider.
// TLS certificates, SQL metadata and close behavior below are public test doubles;
// this suite cannot establish real-driver TLS, permissions or server durability.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const { createSettlementEvidencePostgresConnection: open } = require(path.join(ROOT,
  'scripts/settlement-evidence-postgres-connection'));

const host = 'db.example.test';
const CANARY = 'PUBLIC-DUMMY-NOT-A-CREDENTIAL-CANARY';
const config = () => ({ host, port: 5432, database: 'synthetic', user: 'synthetic_app',
  password: CANARY, ssl: { rejectUnauthorized: true, servername: host } });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(r => setImmediate(r));
const delay = ms => new Promise(r => setTimeout(r, ms));
const safeError = code => Object.assign(new Error(CANARY + ' postgres://hidden:password@host'), { code, detail: CANARY, cause: CANARY });
function metadata() {
  return [
    { database: 'synthetic', user: 'synthetic_app', pid: 314, searchPath:'pg_catalog' },
    { canLogin:true, superuser:false, createDb:false, createRole:false, inherit:false,
      replication:false, bypassRls:false, connectionLimit:1, memberships:0, ownedObjects:0 },
    { connect:true, schemaUsage:true, databaseCreate:false, schemaCreate:false, tables:true, functions:true },
    ['doc_head','doc_staged','journal','quarantine'].map(name => ({ name, kind:'r', persistence:'p',
      rls:false, forceRls:false, unsafe:false, constraintCount:1,
      columns:(name === 'quarantine' ? ['scope','name','label','bytes'] : ['scope','bytes'])
        .map(n => ({ name:n, type:n === 'bytes' ? 'bytea' : 'text', notNull:n !== 'label' })),
      primaryKey:name === 'quarantine' ? ['scope','name'] : ['scope'] }))
  ];
}
function world(options = {}) {
  const w = { constructed:0, connects:0, ends:0, queries:[], clients:[], rows:metadata(), data:null };
  class Client extends EventEmitter {
    constructor(c) {
      super(); w.constructed++; w.config=c; w.clients.push(this);
      this.connection={ stream:{ encrypted:true, authorized:true, servername:host,
        getPeerCertificate:() => ({ subjectaltname:'DNS:' + host }) } };
      if (options.tls) Object.assign(this.connection.stream, options.tls);
    }
    async connect() { w.connects++; if (options.connect) await options.connect(this); }
    async end() { w.ends++; if (options.end) await options.end(this); this.emit('end'); }
    async query(text, values) {
      const index=w.queries.length; w.queries.push({ text, values });
      if (options.query) { const r=await options.query({ text, values, index, client:this, w }); if (r !== undefined) return r; }
      if (index < 4) return { command:'SELECT', rows:index === 3 ? w.rows[3] : [w.rows[index]] };
      if (/pg_try_advisory_lock/.test(text)) return { command:'SELECT', rows:[{ locked:options.locked !== false }] };
      if (/pg_advisory_unlock/.test(text)) return { command:'SELECT', rows:[{ unlocked:true }] };
      if (/pg_backend_pid/.test(text)) return { command:'SELECT', rows:[{ pid:314 }] };
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { command:text, rows:[] };
      if (/^SELECT bytes/.test(text)) return { command:'SELECT', rows:w.data === null ? [] : [{ bytes:w.data }] };
      if (/^INSERT/.test(text)) { w.data=Buffer.from(values[1]); return { command:'INSERT', rows:[], rowCount:1 }; }
      throw safeError('UNSUPPORTED');
    }
  }
  w.Client=Client;
  w.open = extra => open({ Client, config:config(), schema:'synthetic_state', scope:'synthetic-scope', ...extra });
  return w;
}
const retirement = e => { assert.equal(e.code,'SETTLEMENT_CONNECTION'); assert.ok(e.retirement); return e; };

test('F1 import is inert; factory constructs only when explicitly called', async () => {
  const w=world(); assert.equal(w.constructed,0);
  const owner=await w.open(); assert.equal(w.connects,1); assert.equal(w.queries.length,4);
  assert.equal(w.config.connectionString,undefined); assert.deepEqual(w.config.ssl,{ rejectUnauthorized:true, servername:host });
  assert.ok(w.queries.every(q => /^SELECT\b/.test(q.text) && Array.isArray(q.values)));
  assert.equal((await owner.retire()).close,'confirmed');
});
test('F2 invalid config is rejected before construction, without invoking getters', async () => {
  const changes=[{host:'127.0.0.1'},{host:'https://db.example.test'},{host:'db-pooler.example.test'},
    {port:0},{database:''},{user:'bad user'},{password:''},{connectionString:'postgres://'+CANARY},
    {ssl:{ rejectUnauthorized:false, servername:host }},{ssl:{ rejectUnauthorized:true, servername:'other.test' }},
    {ssl:{ rejectUnauthorized:true, servername:host, ca:CANARY }}];
  for (const change of changes) { const w=world(); await assert.rejects(w.open({config:{...config(),...change}})); assert.equal(w.constructed,0); }
  for (const extra of [{scope:'bad_scope'},{schema:'pg_bad'},{timeouts:{connect:10001}},{timeouts:{query:0}},{unexpected:true}]) {
    const w=world(); await assert.rejects(w.open(extra)); assert.equal(w.constructed,0);
  }
  let getters=0; const c=config(); Object.defineProperty(c,'password',{get(){getters++;throw Error(CANARY);}});
  const w=world(); await assert.rejects(w.open({config:c})); assert.equal(getters,0); assert.equal(w.constructed,0);
});
test('F3 ambient PostgreSQL/trust override names are refused before construction', async () => {
  for(const key of ['PGHOST','PGOPTIONS','NODE_OPTIONS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_EXTRA_CA_CERTS',
    'NODE_USE_SYSTEM_CA','SSL_CERT_FILE','SSL_CERT_DIR','OPENSSL_CONF','OPENSSL_MODULES']) {
    const old=process.env[key]; process.env[key]='public-dummy';
    try { const w=world(); await assert.rejects(w.open()); assert.equal(w.constructed,0); }
    finally { if(old===undefined)delete process.env[key];else process.env[key]=old; }
  }
});
test('F4 structured identity and SSL are snapshotted before a suspended connect', async () => {
  const gate=deferred(),w=world({connect:()=>gate.promise}),c=config();
  const p=w.open({config:c}); c.host='other.test'; c.ssl.rejectUnauthorized=false;
  gate.resolve(); const owner=await p; assert.equal(w.config.host,host); assert.equal(w.config.ssl.rejectUnauthorized,true);
  await owner.retire();
});
test('F5 connect failure retains safe primary and failed-close diagnostics once', async () => {
  const w=world({connect:()=>{throw safeError('28P01');},end:()=>{throw safeError('ECONNRESET');}});
  const e=await w.open().catch(retirement); assert.equal(e.diagnostic.stage,'connect');
  assert.equal(e.diagnostic.code,'28P01'); assert.equal(e.retirement.close,'failed');
  assert.equal(e.retirement.closeDiagnostic.code,'ECONNRESET'); assert.equal(w.ends,1); assert.equal(w.queries.length,0);
  assert.ok(!JSON.stringify(e).includes(CANARY)); assert.ok(!String(e.stack).includes(CANARY));
});
test('F6 connect timeout and late completion never publish capabilities or preflight', async () => {
  for (const completes of [true,false]) {
    const gate=deferred(),w=world({connect:()=>gate.promise,end:()=>{if(completes)gate.resolve();}});
    const p=w.open({timeouts:{connect:8,close:completes?2000:8}}).catch(retirement);
    const e=await p; assert.equal(e.diagnostic.category,'timeout'); assert.equal(w.ends,1); assert.equal(w.queries.length,0);
    assert.equal(e.retirement.close,completes?'confirmed':'unconfirmed');
    gate.resolve(); await tick(); assert.equal(w.ends,1); assert.equal(w.queries.length,0);
  }
});
test('F7 TLS is checked after connect, including actual hostname verification', async () => {
  for (const tls of [{encrypted:false},{authorized:false},{servername:'other.test'},
    {authorizationError:CANARY},{getPeerCertificate:()=>({subjectaltname:'DNS:other.test'})},
    {getPeerCertificate:()=>({})}]) {
    const w=world({tls}); const e=await w.open().catch(retirement);
    assert.equal(e.diagnostic.stage,'tls'); assert.equal(w.queries.length,0); assert.equal(w.ends,1);
  }
  const w=world({connect:c=>{c.connection.stream.authorized=true;},tls:{authorized:false}});
  await (await w.open()).retire();
});
test('F8 each metadata stage rejects query failure without raw SQLSTATE leakage', async () => {
  for(let index=0;index<4;index++) {
    const w=world({query:q=>{if(q.index===index)throw safeError('42501');}});
    const e=await w.open().catch(retirement); assert.equal(e.diagnostic.code,'42501');
    assert.equal(w.queries.length,index+1); assert.equal(w.ends,1);
  }
});
test('F8 malformed identity, elevated role, effective ACL or schema never qualifies', async () => {
  const mutations=[r=>r[0].database='other',r=>r[0].user='owner',r=>r[0].pid=0,r=>r[0].searchPath='public, pg_catalog',
    r=>r[1].superuser=true,r=>r[1].memberships=1,r=>r[1].ownedObjects=1,r=>r[1].connectionLimit=-1,
    r=>r[2].tables=false,r=>r[2].functions=false,r=>r[2].schemaCreate=true,
    r=>r[3].pop(),r=>r[3][0].columns[1].type='text',r=>r[3][0].primaryKey=[],
    r=>r[3][0].unsafe=true,r=>r[3][0].rls=true,r=>r[3][0].constraintCount=2];
  for(const mutate of mutations){const w=world();mutate(w.rows);const e=await w.open().catch(retirement);assert.equal(e.code,'SETTLEMENT_CONNECTION');assert.equal(w.ends,1);}
  for(const rows of [[],[{}],null]){
    const w=world({query:q=>q.index===0?{command:'SELECT',rows}:undefined}); await assert.rejects(w.open());assert.equal(w.ends,1);
  }
});
test('F9 query and aggregate preflight deadlines retire without later dispatch', async () => {
  const gate=deferred(),w=world({query:q=>q.index===1?gate.promise:undefined});
  const e=await w.open({timeouts:{query:8,preflight:30}}).catch(retirement);
  assert.equal(e.diagnostic.category,'timeout'); assert.equal(w.ends,1); assert.equal(w.queries.length,2);
  gate.resolve({command:'SELECT',rows:[metadata()[1]]});await tick();assert.equal(w.queries.length,2);
  const x=world({query:async q=>{if(q.index<4)await delay(7);}});
  const ex=await x.open({timeouts:{query:30,preflight:12}}).catch(retirement);
  assert.equal(ex.diagnostic.category,'timeout');assert.ok(x.queries.length<4);assert.equal(x.ends,1);
});
test('F10 real unchanged adapter consumes connection: lock, transaction, journal and read', async () => {
  const w=world(),owner=await w.open();
  assert.equal(await owner.documentStore.read(),null);
  await owner.lock.withLock(async()=>{await owner.journalStore.write({v:'invented'});assert.deepEqual(JSON.parse(await owner.journalStore.read()),{v:'invented'});});
  assert.ok(w.queries.some(q=>q.text==='COMMIT')); assert.equal(owner.status().state,'ready');
  await owner.retire();assert.equal(w.constructed,1);assert.equal(w.ends,1);
});
test('F11 capability surface is immutable and exposes no reusable raw client/query', async () => {
  const w=world(),owner=await w.open();
  assert.deepEqual(Object.keys(owner).sort(),['contract','documentStore','journalStore','lock','quarantine','retire','status'].sort());
  assert.equal(owner.query,undefined);assert.equal(owner.client,undefined);assert.ok(Object.isFrozen(owner));
  assert.ok(Object.isFrozen(owner.documentStore));await owner.retire();
});
for(const event of ['error','end'])test('F12 '+event+' permanently loses a suspended read and future work', async()=>{
  const gate=deferred(),w=world({query:q=>q.index===4?gate.promise:undefined}),owner=await w.open();
  const read=owner.documentStore.read();await tick();w.clients[0].emit(event,safeError('ECONNRESET'));
  await assert.rejects(read);gate.resolve({command:'SELECT',rows:[{bytes:Buffer.from(CANARY)}]});await tick();
  await assert.rejects(owner.documentStore.read());assert.equal(w.queries.length,5);await owner.retire();assert.equal(w.ends,1);
});
test('F13 runtime rejection preserves safe SQLSTATE before adapter wrapping and never reconnects', async()=>{
  const w=world({query:q=>{if(q.index>=4)throw safeError('57P01');}}),owner=await w.open();
  await assert.rejects(owner.documentStore.read());assert.equal(owner.status().primary.code,'57P01');
  await assert.rejects(owner.documentStore.read());assert.equal(w.queries.length,5);await owner.retire();assert.equal(w.constructed,1);
});
test('F13 runtime query timeout suppresses late result', async()=>{
  const gate=deferred(),w=world({query:q=>q.index>=4?gate.promise:undefined}),owner=await w.open({timeouts:{query:8}});
  await assert.rejects(owner.documentStore.read());gate.resolve({command:'SELECT',rows:[]});await tick();
  assert.equal(owner.status().primary.category,'timeout');await owner.retire();assert.equal(w.ends,1);
});
test('F14 explicit retirement is once-only and fences late work', async()=>{
  const gate=deferred(),w=world({query:q=>q.index===4?gate.promise:undefined}),owner=await w.open();
  const read=owner.documentStore.read();await tick();const a=owner.retire(),b=owner.retire();assert.equal(a,b);
  await assert.rejects(read);gate.resolve({command:'SELECT',rows:[]});await a;await tick();
  await assert.rejects(owner.lock.withLock(async()=>{}));assert.equal(w.ends,1);assert.equal(w.queries.length,5);
});
test('F15 malformed COMMIT and unlock acknowledgements retire exact owner', async()=>{
  for(const target of ['COMMIT','pg_advisory_unlock']){
    const w=world({query:q=>q.index>=4&&(q.text===target||q.text.includes(target))?{command:'ROLLBACK',rows:[]}:undefined});
    const owner=await w.open();let acknowledged=false;
    await owner.lock.withLock(async()=>{await owner.journalStore.write({v:1});acknowledged=true;}).catch(()=>{});
    if(target==='COMMIT')assert.equal(acknowledged,false);
    assert.notEqual(owner.status().state,'ready');assert.equal((await owner.retire()).primary.stage,'adapter');assert.equal(w.ends,1);
  }
});
test('F16 failed/hanging close is bounded, explicit and never retried', async()=>{
  for(const mode of ['failed','unconfirmed']){
    const gate=deferred(),w=world({end:()=>mode==='failed'?Promise.reject(safeError('ECONNRESET')):gate.promise});
    const owner=await w.open({timeouts:{close:8}});const a=owner.retire(),b=owner.retire();assert.equal(a,b);
    const report=await a;assert.equal(report.close,mode);assert.ok(report.closeDiagnostic);assert.equal(w.ends,1);
    gate.resolve();await tick();assert.equal((await owner.retire()).close,mode);assert.equal(w.ends,1);
  }
});
test('F17 unsupported diagnostic codes and rejected late promises never escape', async()=>{
  const gate=deferred(),w=world({connect:()=>gate.promise,end:()=>{throw safeError(CANARY);}});
  const e=await w.open({timeouts:{connect:8,close:8}}).catch(retirement);
  gate.reject(safeError(CANARY));await tick();assert.ok(!JSON.stringify(e).includes(CANARY));assert.equal(e.retirement.closeDiagnostic.code,null);
});
test('F17 expected lock refusal preserves qualified session', async()=>{
  const w=world({locked:false}),owner=await w.open();await assert.rejects(owner.lock.withLock(async()=>{}));
  assert.equal(owner.status().state,'ready');assert.equal(w.ends,0);await owner.retire();
});
test('F6 event-loop-delayed connect completion still exceeds the monotonic deadline', async()=>{
  const w=world({connect:()=>{const until=performance.now()+16;while(performance.now()<until){ /* bounded public dummy */ }}});
  const e=await w.open({timeouts:{connect:8}}).catch(retirement);
  assert.equal(e.diagnostic.category,'timeout');assert.equal(w.queries.length,0);assert.equal(w.ends,1);
});
test('F14 retirement before the next dispatch microtask prevents any SQL', async()=>{
  const w=world(),owner=await w.open();const read=owner.documentStore.read();const close=owner.retire();
  await assert.rejects(read);await close;assert.equal(w.queries.length,4);assert.equal(w.ends,1);
});
test('F14 suspended lock callback cannot publish a late success after retirement', async()=>{
  const gate=deferred(),entered=deferred(),w=world(),owner=await w.open();
  const work=owner.lock.withLock(async()=>{entered.resolve();await gate.promise;return 'late-value';});
  await entered.promise;const n=w.queries.length;await owner.retire();await assert.rejects(work);
  gate.resolve();await tick();assert.equal(w.queries.length,n);assert.equal(w.ends,1);
});
test('F10 capability wrapping preserves unchanged adapter call-time snapshots', async()=>{
  const w=world(),owner=await w.open();
  await owner.lock.withLock(async()=>{const value={v:'original'};const write=owner.journalStore.write(value);value.v='mutated';await write;});
  assert.equal(JSON.parse(w.data).v,'original');await owner.retire();
});
test('F11 reused injected session is refused without retiring its existing owner', async()=>{
  const w=world(),owner=await w.open();const Client=function(){return w.clients[0];};
  await assert.rejects(w.open({Client}));assert.equal(w.ends,0);assert.equal(owner.status().state,'ready');await owner.retire();
});
test('F2 hostile input proxy and Client setup errors are sanitized before connect', async()=>{
  const w=world();const c=new Proxy(config(),{getPrototypeOf(){throw safeError(CANARY);}});
  const e=await w.open({config:c}).catch(e=>e);assert.equal(e.code,'SETTLEMENT_CONNECTION');assert.ok(!String(e.stack).includes(CANARY));assert.equal(w.constructed,0);
  const bad=await w.open({Client:class {constructor(){throw safeError(CANARY);}}}).catch(e=>e);
  assert.equal(bad.diagnostic.stage,'client-setup');assert.ok(!JSON.stringify(bad).includes(CANARY));
});
test('F16 late close after event-loop delay is unconfirmed rather than false success', async()=>{
  const w=world({end:()=>{const until=performance.now()+16;while(performance.now()<until){ /* public dummy */ }}});
  const owner=await w.open({timeouts:{close:8}});assert.equal((await owner.retire()).close,'unconfirmed');assert.equal(w.ends,1);
});
