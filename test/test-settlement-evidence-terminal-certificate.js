'use strict';
// D1(i) intentionally replaces the unused reservation/second-commit API.
// Fresh authoritative checkpoint + atomic append CAS are MODELLED guarantees;
// no production transport, custody, hidden alias or independent registry proof.
// Shared fixtures register no tests on import; only the three existing suites.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const C = require('../scripts/planned-obligation-settlement-contract');
const S = require('../scripts/settlement-evidence-store');
const TC = require('../scripts/settlement-evidence-terminal-certificate');
const householdId = 'household-' + 'a'.repeat(32), actorId = 'session-' + 'b'.repeat(64);
const otherActor = 'session-' + 'c'.repeat(64), namespace = 'ledger-' + 'd'.repeat(32);
const op = n => 'operation-' + n.toString(16).padStart(32,'0');
const generation = n => 'generation-' + n.toString(16).padStart(32,'0');
const clone = x => JSON.parse(JSON.stringify(x));
function encoded(records, hh=householdId, ns=namespace) {
  const body={schema:'terminal-history-1',householdId:hh,ledgerNamespace:ns,revision:records.length,records:clone(records)},digest=C.digest(body);
  return {historyBytes:Buffer.from(JSON.stringify({...body,digest})),checkpoint:{schema:'terminal-history-checkpoint-1',householdId:hh,ledgerNamespace:ns,revision:records.length,digest}};
}
function makeExclusionWorld(options={}) {
  const hh=options.householdId||householdId,ns=options.namespace||'ledger-'+crypto.randomBytes(16).toString('hex');
  const genesis=C.adopt({householdId:hh}), state=JSON.parse(genesis), initial=encoded([],hh,ns);
  const w={time:Date.parse('2026-10-20T12:00:00Z'),hooks:{},writes:[],reads:0,appends:0,doc:options.empty?null:Buffer.from(genesis),temp:null,journal:null,
    pin:options.empty?null:{revision:0,digest:state.digest,timestamp:1},backups:new Map(),...initial};
  if(!options.empty) w.backups.set(state.digest,{revision:0,digest:state.digest,artifactId:'synthetic-0',bytes:Buffer.from(genesis)});
  const run=async(name,action,...args)=>w.hooks[name]?w.hooks[name](action,...args):action();
  const documentStore={async read(){return run('docRead',()=>w.doc&&Buffer.from(w.doc));},async readStaged(){return w.temp&&Buffer.from(w.temp);},
    async writeTemp(b){w.writes.push('temp');return run('temp',()=>{w.temp=Buffer.from(b);});},
    async commitTemp(){w.writes.push('rename');return run('rename',()=>{w.doc=w.temp;w.temp=null;});},
    async discardTemp(){w.writes.push('discard');w.temp=null;}};
  const journalStore={async read(){return run('journalRead',()=>w.journal&&Buffer.from(w.journal));},
    async write(v){w.writes.push('journal');return run('journal',()=>{w.journal=Buffer.from(JSON.stringify(v));});},
    async clear(){w.writes.push('clear');return run('clear',()=>{w.journal=null;});}};
  const pinStore={async read(){return run('pinRead',()=>w.pin&&clone(w.pin));},
    async advance(e,n){w.writes.push('pin');return run('pin',()=>{if(e===null?w.pin!==null:!w.pin||e.revision!==w.pin.revision||e.digest!==w.pin.digest)return false;w.pin=clone(n);return true;});}};
  const backupStore={async put(revision,digest,bytes){w.writes.push('backup');const e={revision,digest,artifactId:'synthetic-'+revision};w.backups.set(digest,{...e,bytes:Buffer.from(bytes)});return e;},
    async get(r,d){const e=w.backups.get(d);return e?.revision===r?Buffer.from(e.bytes):null;},
    async list(){return [...w.backups.values()].map(({bytes,...e})=>clone(e));}};
  let tail=Promise.resolve();const lock={withLock(fn){const r=tail.then(fn,fn);tail=r.catch(()=>{});return r;}};
  const terminalHistory={async readSnapshot(){w.reads++;return run('historyRead',()=>({historyBytes:w.historyBytes&&Buffer.from(w.historyBytes),checkpoint:w.checkpoint&&clone(w.checkpoint)}));},
    async compareAndAppend(input){w.appends++;return run('append',()=>{if(!require('node:util').isDeepStrictEqual(input.expectedCheckpoint,w.checkpoint))return false;
      Object.assign(w,encoded([...JSON.parse(w.historyBytes).records,clone(input.certificate)],hh,ns));return true;},input);}};
  w.domain={ledgerNamespace:ns,serializationAuthority:'authority-'+crypto.randomBytes(16).toString('hex'),historyAuthority:'authority-'+crypto.randomBytes(16).toString('hex')};
  w.adapters={documentStore,journalStore,pinStore,backupStore,quarantine:{async put(){w.writes.push('quarantine');}},lock};
  w.terminalHistory=terminalHistory;
  w.newStore=(extra={})=>{const a=extra.wrap?Object.fromEntries(Object.entries(w.adapters).map(([k,v])=>[k,Object.fromEntries(Object.keys(v).map(m=>[m,(...args)=>v[m](...args)]))])):w.adapters;
    return S.createSettlementEvidenceStore({householdId:hh,...a,now:()=>w.time,exclusionDomain:{...w.domain,...extra.domain},...(extra.gated===false?{}:{terminalHistory:extra.history||terminalHistory})});};
  w.command=(n=1)=>{const evidence={accountId:'synthetic-cash',currency:'cad',direction:'debit',date:'2026-10-19',cents:6000,posted:true};
    return {version:1,kind:'link',goalId:'commitment:synthetic-trip',txRef:'tx-'+n.toString(16).padStart(32,'0'),evidence,evidenceDigest:C.digest(evidence),assignedCents:2500,asOf:'2026-10-20'};};
  w.prepare=(s,n=1,actor=actorId)=>s.prepare({actorId:actor,operationId:op(n),command:w.command(n)});
  w.input=p=>({actorId:p.preview.actorId,preview:p.preview,confirmationDigest:p.confirmationDigest});
  w.claim=(p,n=1,reason='preview-expired')=>({...w.input(p),generation:generation(n),kind:'link',reason});
  w.seal=(s,p,n=1,r)=>s.terminalExclusion?.sealNegative(w.claim(p,n,r))||Promise.resolve({status:'unknown'});
  w.records=()=>JSON.parse(w.historyBytes).records;
  w.protocol=s=>TC.createTerminalCertificateProtocol({householdId:hh,ledgerNamespace:ns,store:s.terminalExclusion});
  return w;
}
module.exports={makeExclusionWorld,encoded,householdId,actorId,otherActor,namespace,op,generation};
if(require.main===module){
 const test=require('node:test');
 test('D1 native protocol replaces reservation and second commitment with real store exclusion',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s),protocol=w.protocol(s);
  assert.deepEqual(Object.keys(protocol).sort(),['connected','lookupCertificate','sealNegative']);assert.equal(protocol.connected,true);
  assert.equal((await protocol.sealNegative(w.claim(p))).status,'certified');assert.equal(w.records().length,1);assert.deepEqual(w.writes,[]);
 });
 test('D1 certificate lookup is actor private generation exact and namespace bound',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s),protocol=w.protocol(s);
  assert.equal((await protocol.sealNegative(w.claim(p))).status,'certified');
  assert.deepEqual(await protocol.lookupCertificate(op(1),actorId,{generation:generation(1)}),{status:'not-applied',operationId:op(1),generation:generation(1)});
  assert.equal((await protocol.lookupCertificate(op(1),otherActor)).status,'unknown');
  assert.equal((await protocol.lookupCertificate(op(1),actorId,{generation:generation(2)})).status,'unknown');
  for(const fields of [{householdId:'household-'+'f'.repeat(32)},{ledgerNamespace:'ledger-'+'f'.repeat(32)}]){
    const wrong=TC.createTerminalCertificateProtocol({householdId,ledgerNamespace:namespace,store:s.terminalExclusion,...fields});
    assert.equal(wrong.connected,false);assert.equal((await wrong.lookupCertificate(op(1),actorId)).status,'unknown');
  }
 });
 test('D1 postauthorization suppresses response without undoing landed seal',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);
  assert.equal((await w.protocol(s).sealNegative(w.claim(p),{authorize:async()=>false})).status,'suppressed');
  assert.equal(w.records().length,1);assert.notEqual((await s.commit(w.input(p))).status,'committed');assert.deepEqual(w.writes,[]);
 });

 test('D1 owned claims and authorization callbacks cannot be retargeted across a suspended read',{timeout:5000},async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s),protocol=w.protocol(s);
  let release,reached;const gate=new Promise(r=>{release=r;}),seen=new Promise(r=>{reached=r;});
  w.hooks.historyRead=async perform=>{reached();await gate;return perform();};
  const claim=clone(w.claim(p)),options={authorize:async()=>false},pending=protocol.sealNegative(claim,options);await seen;
  claim.preview.operationId=op(2);claim.actorId=otherActor;claim.generation=generation(2);options.authorize=async()=>true;release();
  assert.equal((await pending).status,'suppressed','the original authorization callback is retained');
  assert.equal(w.records()[0].operationId,op(1));assert.equal(w.records()[0].generation,generation(1));assert.deepEqual(w.writes,[]);
 });
 test('D1 malformed claims and accessors never invoke persistence or getters',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s),protocol=w.protocol(s);let getters=0;
  const accessed=clone(w.claim(p));Object.defineProperty(accessed,'generation',{enumerable:true,get(){getters++;return generation(1);}});
  for(const input of [null,'claim',accessed,{...w.claim(p),extra:true},{...w.claim(p),actorId:otherActor},
   {...w.claim(p),generation:''},{...w.claim(p),kind:'withdrawal'},{...w.claim(p),reason:'recovery-required'},
   {...w.claim(p),confirmationDigest:'f'.repeat(64)}])assert.equal((await protocol.sealNegative(input)).status,'unknown');
  assert.equal(getters,0);assert.equal(w.appends,0);assert.deepEqual(w.writes,[]);
 });
 test('D1 stale self-consistent history pairs cannot roll back an observed canonical domain',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);assert.equal((await w.seal(s,p)).status,'certified');
  Object.assign(w,encoded([],householdId,w.domain.ledgerNamespace));const reopened=w.newStore({wrap:true});
  assert.equal((await reopened.inspectAttempt(w.input(p))).ready,false);
  assert.notEqual((await reopened.commitWithoutRecovery(w.input(p))).status,'committed');assert.deepEqual(w.writes,[]);
 });
 test('D1 torn or getter-backed snapshots and malformed positive append acknowledgements yield no certificate',async()=>{
  for(const mode of ['torn','getter','wrong-append']){
   const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);let getters=0;
   if(mode==='torn')w.hooks.append=()=>{w.historyBytes=Buffer.from('{}');return true;};
   if(mode==='getter')w.hooks.historyRead=()=>Object.defineProperties({},{historyBytes:{enumerable:true,get(){getters++;return w.historyBytes;}},checkpoint:{enumerable:true,value:w.checkpoint}});
   if(mode==='wrong-append')w.hooks.append=(perform,input)=>{Object.assign(w,encoded([{...input.certificate,operationId:op(2)}],householdId,w.domain.ledgerNamespace));return true;};
   assert.equal((await w.protocol(s).sealNegative(w.claim(p))).status,'unknown');assert.equal(getters,0);assert.deepEqual(w.writes,[]);
  }
 });

 test('D1 Addendum A canonical authority bindings are immutable and malformed construction is inert',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),bound=TC.registerDomain(householdId,w.domain,true,[]);
  assert.equal(Object.isFrozen(bound),true);
  assert.throws(()=>{bound.historyAuthority='authority-'+'f'.repeat(32);},TypeError);
  assert.throws(()=>{bound.enabled=false;},TypeError);
  for(const value of [null,undefined,[],false,{}, {store:{}}]){
   const protocol=TC.createTerminalCertificateProtocol(value);assert.equal(protocol.connected,false);
   assert.equal((await protocol.lookupCertificate(op(1),actorId)).status,'unknown');
  }
  assert.equal(w.reads,0);assert.equal(w.appends,0);
  assert.throws(()=>w.newStore({history:{}}),/incomplete/);
  assert.equal(w.protocol(s).connected,true);
 });
 test('D1 complete persisted negative record validation rejects missing extra and malformed fields',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);await w.seal(s,p);const valid=w.records()[0];
  const missing={...valid};delete missing.confirmationDigest;
  for(const bad of [missing,{...valid,extra:true},{...valid,schema:'wrong'},{...valid,householdId:'bad'},
   {...valid,ledgerNamespace:'bad'},{...valid,operationId:'bad'},{...valid,actorId:'bad'},
   {...valid,kind:'refund'},{...valid,generation:'bad'},{...valid,reason:'recovery-required'},
   {...valid,expectedRevision:0.5},{...valid,expectedDocumentDigest:'bad'},{...valid,confirmationDigest:'bad'},
   {...valid,decidedAt:0}]){
    assert.equal(TC.isCertificate(bad),false);
    const v=makeExclusionWorld(),t=v.newStore();
    const record={...bad,householdId:bad.householdId===valid.householdId?householdId:bad.householdId,
      ledgerNamespace:bad.ledgerNamespace===valid.ledgerNamespace?v.domain.ledgerNamespace:bad.ledgerNamespace};
    if(!Number.isInteger(record.expectedRevision)){
      // Fractions have no contract-canonical digest. Inject damaged raw bytes
      // while preserving the prior checkpoint; do not ask the real hasher to
      // manufacture a supposedly qualified fractional record.
      const damaged=encoded([{...record,expectedRevision:0}],householdId,v.domain.ledgerNamespace);
      const body=JSON.parse(damaged.historyBytes);body.records[0].expectedRevision=record.expectedRevision;
      damaged.historyBytes=Buffer.from(JSON.stringify(body));Object.assign(v,damaged);
    }else Object.assign(v,encoded([record],householdId,v.domain.ledgerNamespace));
    assert.equal((await v.protocol(t).lookupCertificate(op(1),actorId)).status,'unknown');
    assert.deepEqual(v.writes,[]);assert.equal(v.appends,0);
  }
 });

 test('D1 an advanced authoritative tip cannot rewrite an already observed negative prefix',async()=>{
  const w=makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);await w.seal(s,p);const old=w.records()[0];
  // Deliberately violate append-only persistence while retaining valid shapes,
  // a larger revision and a self-consistent new checkpoint. Known prefix
  // evidence must still prevent this from reopening the original operation.
  Object.assign(w,encoded([{...old,operationId:op(2),generation:generation(2)},
    {...old,operationId:op(3),generation:generation(3)}],householdId,w.domain.ledgerNamespace));
  assert.notEqual((await w.newStore({wrap:true}).commitWithoutRecovery(w.input(p))).status,'committed');
  assert.deepEqual(w.writes,[]);
 });
}
