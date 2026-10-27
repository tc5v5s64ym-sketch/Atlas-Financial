'use strict';
// REAL owner command, validator and install/readback APIs. SQL/TLS/Windows ACL
// fixtures are OFFLINE DOUBLES. No credential, driver network or custody proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const {spawnSync}=require('node:child_process');
const X=require('./test-settlement-evidence-terminal-certificate');
const C=require('../scripts/planned-obligation-settlement-contract');
const {main}=require('../scripts/restore-settlement-evidence');
const CANARY='PUBLIC-DUMMY-RESTORE-PASSWORD-CANARY', host='db.example.test';
const profile={doc_head:[true,true,false],doc_staged:[false,false,true],journal:[false,false,true],quarantine:[true,false,false],terminal_history:[true,true,false]};
function metadata(){return Object.keys(profile).map(name=>({name,kind:'r',persistence:'p',rls:false,forceRls:false,unsafe:false,primaryKeyCount:1,
 columns:(name==='quarantine'?['scope','name','label','bytes']:name==='terminal_history'?['scope','history_bytes','checkpoint_bytes']:['scope','bytes']).map(name=>({name,type:['bytes','history_bytes','checkpoint_bytes'].includes(name)?'bytea':'text',notNull:name!=='label',generated:''})),primaryKey:name==='quarantine'?['scope','name']:['scope']}));}
function driver(options={}){
 const w={clients:[],log:[],ends:0,active:0,maxActive:0,head:null,staged:Buffer.from('old-stage'),journal:null,terminal:null,quarantine:new Map(),lock:null};
 class Client extends EventEmitter{
  constructor(config){super();this.number=w.clients.length;this.config=config;this.pid=100+this.number;w.clients.push(this);this.connection={stream:{encrypted:true,authorized:true,servername:host,getPeerCertificate:()=>({subjectaltname:'DNS:'+host}),...options.tls}};if(options.construct)options.construct(w,this);}
  async connect(){w.active++;w.maxActive=Math.max(w.maxActive,w.active);if(options.connect)await options.connect(w,this);}
  async end(){w.ends++;if(options.end)await options.end(w,this);w.active--;if(w.lock===this.pid)w.lock=null;this.emit('end');}
  async query(text,v){w.log.push({number:this.number,text,values:v});if(options.query){const r=await options.query(w,this,text,v);if(r!==undefined)return r;}
   const res=(command,rows=[],rowCount=rows.length)=>({command,rows,rowCount});
   if(text.includes('owner-identity'))return res('SELECT',[{database:'synthetic',user:'maintenance_app',pid:this.pid,searchPath:'pg_catalog',version:180006,readOnly:this.number===1,defaultReadOnly:this.number===1,...options.identity}]);
   if(text.includes('owner-role'))return res('SELECT',[{canLogin:true,superuser:false,createDb:false,createRole:false,inherit:false,replication:false,bypassRls:false,connectionLimit:1,memberships:0,ownedObjects:0,...options.role}]);
   if(text.includes('owner-privileges'))return res('SELECT',Object.entries(profile).map(([name,grants])=>{const r={name,select:true,insert:grants[0],update:grants[1],delete:grants[2],truncate:false,references:false,trigger:false,anyInsert:grants[0],anyUpdate:grants[1],anyReferences:false,connect:true,schemaUsage:true,databaseCreate:false,schemaCreate:false,functions:true};
    assert(text.includes("has_any_column_privilege")&&text.includes("'REFERENCES'"));if(options.acl)options.acl(r);return r;}));
   if(text.includes('owner-schema'))return res('SELECT',options.schema?options.schema(metadata()):metadata());
   if(text.includes('pg_try_advisory_lock')){if(w.lock!==null&&w.lock!==this.pid)return res('SELECT',[{locked:false}]);w.lock=this.pid;return res('SELECT',[{locked:true}]);}
   if(text.includes('pg_backend_pid'))return res('SELECT',[{pid:this.pid}]);
   if(text.startsWith('BEGIN')){this.snapshot={head:w.head,staged:w.staged,journal:w.journal,terminal:w.terminal,quarantine:new Map(w.quarantine)};return res('BEGIN',[],null);}
   if(text==='COMMIT'){this.snapshot=null;return res('COMMIT',[],null);}
   if(text==='ROLLBACK'){if(this.snapshot)Object.assign(w,this.snapshot);this.snapshot=null;return res('ROLLBACK',[],null);}
   if(/^SELECT bytes FROM/.test(text)){const key=text.includes('.doc_head')?'head':text.includes('.doc_staged')?'staged':'journal';return res('SELECT',w[key]?[{bytes:Buffer.from(w[key])}]:[]);}
   if(/^SELECT history_bytes, checkpoint_bytes/.test(text))return res('SELECT',w.terminal?[{history_bytes:Buffer.from(w.terminal.h),checkpoint_bytes:Buffer.from(w.terminal.c)}]:[]);
   if(/^SELECT 1 AS present/.test(text))return res('SELECT',w.quarantine.has(v[1])?[{present:1}]:[]);
   if(/^INSERT INTO .*\.quarantine/.test(text)){w.quarantine.set(v[1],Buffer.from(v[3]));return res('INSERT',[],1);}
   if(/^INSERT INTO .*\.doc_head/.test(text)){w.head=Buffer.from(v[1]);return res('INSERT',[],1);}
   if(/^UPDATE .*\.terminal_history/.test(text)){if(!w.terminal)return res('UPDATE',[],0);w.terminal={h:Buffer.from(v[1]),c:Buffer.from(v[2])};return res('UPDATE',[],1);}
   if(/^INSERT INTO .*\.terminal_history/.test(text)){w.terminal={h:Buffer.from(v[1]),c:Buffer.from(v[2])};return res('INSERT',[],1);}
   if(/^DELETE FROM/.test(text)){const key=text.includes('.doc_staged')?'staged':'journal';const had=!!w[key];w[key]=null;return res('DELETE',[],had?1:0);}
   throw Error('UNMODELLED SQL');
  }
 }
 w.Client=Client;return w;
}
async function fixture(){const w=X.makeExclusionWorld(),s=w.newStore(),p=await w.prepare(s);assert.equal((await w.seal(s,p)).status,'certified');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-owner-restore-'));fs.chmodSync(root,0o700);
 const request={schema:'settlement-owner-restore-request-1',target:{host,port:5432,database:'synthetic',user:'maintenance_app',schema:'atlas_settle',scope:'household-a'},domain:{householdId:JSON.parse(w.doc).householdId,ledgerNamespace:w.domain.ledgerNamespace},
  anchors:{ledger:{revision:0,documentDigest:JSON.parse(w.doc).digest},history:w.checkpoint},candidate:{ledgerFile:'ledger.json',historyFile:'history.json'},pin:C.pin(w.doc,JSON.parse(w.doc).householdId),
  preconditions:{quiescent:true,restartInhibited:true,anchorsCurrent:true,ownerDecrypted:true}};
 const write=()=>{fs.writeFileSync(path.join(root,'request.json'),JSON.stringify(request),{mode:0o600});};write();fs.writeFileSync(path.join(root,'ledger.json'),w.doc,{mode:0o600});fs.writeFileSync(path.join(root,'history.json'),w.historyBytes,{mode:0o600});
 return {root,request,write,ledger:Buffer.from(w.doc),history:Buffer.from(w.historyBytes)};
}
async function run(f,w=driver(),overrides={}){let stdout='',passwordReads=0;
 const output=path.join(f.root,'report-'+Math.random().toString(16).slice(2)+'.json');
 const deps={Client:w.Client,readPassword:async()=>{passwordReads++;return CANARY;},stdout:s=>{stdout+=s;},
  // Windows fixture ACLs are NOT claimed qualified; Linux exercises real modes.
  ...(process.platform==='win32'?{privateCheck:()=>true}:{}),
  limits:{connect:40,preflight:500,query:80,close:30,dispatch:3000,outer:3500},...overrides};
 const exit=await main(['--private-root',f.root,'--request',path.join(f.root,'request.json'),'--report',output],deps);
 const report=fs.existsSync(output)?JSON.parse(fs.readFileSync(output)):null;const encoded=JSON.stringify({stdout,report});assert(!encoded.includes(CANARY));assert(!encoded.includes('postgres://'));
 return {exit,report,stdout,passwordReads,w,output};
}
test('owner command validates and uses real installer/fresh verification, closes both before private success',async()=>{
 const f=await fixture(),r=await run(f);assert.equal(r.exit,0);assert.equal(r.report.status,'verified-install');assert.equal(r.report.reopen,false);
 assert.equal(r.w.clients.length,2);assert.equal(r.w.maxActive,1);assert.equal(r.w.ends,2);assert(r.w.head.equals(f.ledger));assert(r.w.terminal.h.equals(f.history));
 assert.deepEqual(r.report.closures.map(x=>x.close),['confirmed','confirmed']);assert.equal(r.report.preconditions,'operator-asserted-not-proved');
 assert.equal(r.w.clients[0].config.ssl.rejectUnauthorized,true);assert.equal(r.w.clients[0].config.ssl.servername,host);
 assert.match(r.w.clients[1].config.options,/default_transaction_read_only=on/);assert(r.w.log.some(x=>x.number===1&&x.text==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
 assert(!r.w.log.some(x=>x.number===1&&/^(INSERT|UPDATE|DELETE|SET|GRANT|CREATE)/.test(x.text)));
 assert(r.report.counts.queries<=128);assert(Buffer.byteLength(JSON.stringify(r.report))<=16384);
});
test('unsafe explicit inputs and candidate/pin mismatches refuse before Client or secret access',async()=>{
 for(const change of [r=>{delete r.domain;},r=>{r.preconditions.quiescent=false;},r=>{r.pin='f'.repeat(64);},r=>{r.target.host='db-pooler.example.test';},r=>{r.target.password=CANARY;},r=>{r.candidate.historyFile='../outside';},r=>{r.anchors.history.revision++;},r=>{r.extra=true;}]){const f=await fixture();change(f.request);f.write();const w=driver(),r=await run(f,w);assert.notEqual(r.exit,0);assert.equal(w.clients.length,0);assert.equal(r.passwordReads,0);}
});
test('input bytes/target captured before constructor or awaited work cannot be retargeted',async()=>{
 const f=await fixture();const w=driver({construct:()=>{f.request.target.user='unexpected';f.write();fs.writeFileSync(path.join(f.root,'ledger.json'),'changed');}});const r=await run(f,w);assert.equal(r.exit,0);assert(w.head.equals(f.ledger));assert.equal(w.clients[1].config.user,'maintenance_app');
});
test('strict TLS, identity, role, schema and effective forbidden column privileges refuse',async()=>{
 for(const options of [{tls:{authorized:false}},{tls:{servername:'other.test'}},{identity:{version:170005}},{identity:{searchPath:'public'}},{role:{memberships:1}},{schema:rows=>rows.slice(0,-1)},
  {schema:rows=>rows.map(r=>r.name==='terminal_history'?{...r,columns:r.columns.map(c=>({...c,generated:'s'}))}:r)},
  {acl:r=>{if(r.name==='quarantine')r.anyUpdate=true;}},{acl:r=>{if(r.name==='doc_staged')r.anyInsert=true;}},{acl:r=>{if(r.name==='journal')r.anyReferences=true;}}]){
  const w=driver(options),r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(w.clients.length,1);assert.equal(w.ends,1);assert(!w.log.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x.text)));
 }
});
test('verification read-only posture is checked, never permits private success if server reports writable',async()=>{
 const w=driver({query:(_w,c,t)=>c.number===1&&t.includes('owner-identity')?{command:'SELECT',rows:[{database:'synthetic',user:'maintenance_app',pid:c.pid,searchPath:'pg_catalog',version:180006,readOnly:false,defaultReadOnly:false}]}:undefined});
 const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(r.report.install.status,'installed-unverified');assert.equal(w.ends,2);assert(!w.log.some(x=>x.number===1&&x.text.startsWith('BEGIN')));
});
test('malformed envelopes and getters never publish success or expose raw diagnostics',async()=>{
 for(const kind of ['getter','null','bad-command','mixed']){let touched=0;const w=driver({query:(_w,_c,t)=>{if(!t.includes('owner-identity'))return; if(kind==='getter')return Object.defineProperty({command:'SELECT'},'rows',{get(){touched++;throw Error(CANARY);}});if(kind==='null')return null;if(kind==='bad-command')return{command:'UPDATE',rows:[]};return{command:'SELECT',rows:[null]};}});
  const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(touched,0);assert.equal(w.clients.length,1);assert.equal(w.ends,1);}
});
test('unknown dispatched COMMIT stops after one session, no reinstall or verification',async()=>{
 const w=driver({query:(_w,_c,t)=>{if(t==='COMMIT')throw Object.assign(Error(CANARY+' postgres://secret'),{code:'ECONNRESET'});}});
 const r=await run(await fixture(),w);assert.equal(r.report.status,'unknown');assert.equal(w.clients.length,1);assert.equal(w.ends,1);assert.equal(w.log.filter(x=>x.text==='COMMIT').length,1);
});
test('failed/unconfirmed close prevents opening verification and remains unknown',async()=>{
 for(const close of ['failed','unconfirmed']){const w=driver({end:()=>close==='failed'?Promise.reject(Error(CANARY)):new Promise(()=>{})});const r=await run(await fixture(),w);assert.equal(r.report.status,'unknown');assert.equal(r.report.closures[0].close,close);assert.equal(w.clients.length,1);assert.equal(w.ends,1);}
});
test('failed/late connect has bounded once-only close and no SQL or verification',async()=>{
 for(const connect of [()=>Promise.reject(Error(CANARY)),()=>new Promise(()=>{})]){const w=driver({connect});const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(w.clients.length,1);assert.equal(w.ends,1);assert.equal(w.log.length,0);}
});
test('query limits stop dispatch and unknown readback cannot claim verified install',async()=>{
 const w=driver(),r=await run(await fixture(),w,{limits:{connect:40,preflight:500,query:80,close:30,dispatch:3000,outer:3500,queries:8}});assert.notEqual(r.exit,0);assert(w.log.length<=8);assert.equal(w.clients.length,1);
 const x=driver({query:(_w,c,t)=>{if(c.number===1&&/^SELECT bytes FROM/.test(t))throw Error(CANARY);}}),s=await run(await fixture(),x);assert.equal(s.report.status,'unknown');assert.equal(s.report.install.status,'installed-unverified');assert.equal(x.clients.length,2);assert.equal(x.ends,2);
});
test('existing report or unsafe private root refuses without connecting',async()=>{
 const f=await fixture(),out=path.join(f.root,'exists.json');fs.writeFileSync(out,'keep',{mode:0o600});let reads=0;const w=driver();const exit=await main(['--private-root',f.root,'--request',path.join(f.root,'request.json'),'--report',out],{Client:w.Client,readPassword:()=>{reads++;return CANARY;},stdout:()=>{},privateCheck:()=>true});assert.notEqual(exit,0);assert.equal(fs.readFileSync(out,'utf8'),'keep');assert.equal(reads,0);assert.equal(w.clients.length,0);
 const denied=await run(await fixture(),driver(),{privateCheck:()=>false});assert.notEqual(denied.exit,0);assert.equal(denied.passwordReads,0);assert.equal(denied.w.clients.length,0);
});
test('actual CLI invalid invocation and help are inert, bounded and never print supplied canary',()=>{
 const script=path.join(__dirname,'..','scripts','restore-settlement-evidence.js');for(const args of [[],['--unexpected',CANARY],['--help']]){const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:3000});assert.ifError(r.error);assert(!r.stdout.includes(CANARY));assert.equal(r.stderr,'');assert(r.stdout.length<1500);assert.equal(r.status,args[0]==='--help'?0:1);}
});
test('driver errors cannot forge trusted diagnostics or invoke safe/code accessors',async()=>{
 let touched=0;const w=driver({connect:()=>{const e=Error(CANARY);Object.defineProperty(e,'safe',{get(){touched++;throw Error(CANARY);}});throw e;}});
 const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(touched,0);assert.equal(w.ends,1);
 const x=driver({connect:()=>{throw {safe:true,stage:CANARY,category:CANARY,code:CANARY};}});
 const s=await run(await fixture(),x);assert.notEqual(s.exit,0);assert.equal(s.report.diagnostic.stage,'connect');assert.equal(s.report.diagnostic.code,null);
});
test('failed closure retains its sanitized code and the primary failure',async()=>{
 const w=driver({connect:()=>{throw Object.assign(Error(CANARY),{code:'ECONNREFUSED'});},end:()=>{throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}});
 const r=await run(await fixture(),w);assert.equal(r.report.diagnostic.code,'ECONNREFUSED');assert.equal(r.report.closures[0].diagnostic.code,'ECONNRESET');assert.equal(w.ends,1);
});
test('aggregate preflight and global outer deadline suppress delayed publications',async()=>{
 for(const mode of ['preflight','outer']){const w=driver({query:async(_w,_c,t)=>{if(t.includes('owner-identity'))await new Promise(r=>setTimeout(r,100));}});
  const r=await run(await fixture(),w,{limits:{connect:40,preflight:mode==='preflight'?15:500,query:200,close:30,dispatch:3000,outer:mode==='outer'?15:3500}});
  assert.notEqual(r.exit,0);assert.equal(w.log.length,1);assert.equal(w.ends,1);assert.equal(w.clients.length,1);assert.equal(w.head,null);
 }
});
test('every preflight and install-query rejection closes once and never opens a verifier',async()=>{
 const good=await run(await fixture());const count=good.w.log.filter(x=>x.number===0).length;
 for(let position=0;position<count;position++){let n=0;const w=driver({query:()=>{if(n++===position)throw Object.assign(Error(CANARY),{code:'ECONNRESET'});}});
  const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(w.clients.length,1);assert.equal(w.ends,1);assert.equal(w.log.length,position+1);assert(r.report.sessionDiagnostics.some(d=>d.code==='ECONNRESET'));
 }
});
test('readback byte mismatch stays a mismatch, never a private verified report',async()=>{
 const w=driver({query:(_w,c,t)=>c.number===1&&/^SELECT bytes FROM .*doc_head/.test(t)?{command:'SELECT',rows:[{bytes:Buffer.from('wrong')}]}:undefined});
 const r=await run(await fixture(),w);assert.notEqual(r.exit,0);assert.equal(r.report.verification.status,'mismatch');assert.equal(r.report.verification.reason,'head-mismatch');assert.equal(w.ends,2);
});
test('late connection and session loss never dispatch after ownership is retired',async()=>{
 const w=driver({connect:async()=>{await new Promise(r=>setTimeout(r,80));}}),r=await run(await fixture(),w,{limits:{connect:10,preflight:100,query:80,close:10,dispatch:3000,outer:3500}});
 assert.equal(r.report.closures[0].close,'unconfirmed');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(w.log.length,0);assert.equal(w.ends,1);assert.equal(w.clients.length,1);
 const x=driver({query:(_w,c,t)=>{if(/^INSERT INTO .*doc_head/.test(t))c.emit('error',Object.assign(Error(CANARY),{code:'ECONNRESET'}));}});
 const s=await run(await fixture(),x);assert.notEqual(s.exit,0);assert.equal(x.ends,1);assert.equal(x.clients.length,1);assert(!x.log.some(q=>q.text==='COMMIT'));
});
test('owned result bytes are copied before the next driver dispatch can mutate them',async()=>{
 const incumbent=Buffer.from('incumbent'),f=await fixture();let previous;
 const w=driver({construct:(_w,c)=>{if(c.number===0)_w.head=Buffer.from(incumbent);},query:(_w,_c,t)=>{if(previous){previous.fill(0);previous=null;}if(/^SELECT bytes FROM .*doc_head/.test(t)&&_c.number===0){previous=Buffer.from(incumbent);return {command:'SELECT',rows:[{bytes:previous}]};}}});
 const r=await run(f,w);assert.equal(r.exit,0);assert([...w.quarantine.values()].some(b=>b.equals(incumbent)));
});
test('constructor errors, reused Client objects and parameter caps fail closed without retry',async()=>{
 let created=0;const f=await fixture();const r=await run(f,driver(),{Client:class {constructor(){created++;throw Error(CANARY);}}});assert.notEqual(r.exit,0);assert.equal(created,1);assert.equal(r.report.closures[0].close,'unconfirmed');
 const w=driver(),original=w.Client;let first;class Reused {constructor(config){return first||=(new original(config));}}const s=await run(await fixture(),w,{Client:Reused});assert.notEqual(s.exit,0);assert.equal(w.ends,1);assert.equal(w.clients.length,1);assert.equal(s.report.closures[1].close,'unconfirmed');
 const x=driver(),b=await run(await fixture(),x,{limits:{connect:40,preflight:500,query:80,close:30,dispatch:3000,outer:3500,parameters:1}});assert.notEqual(b.exit,0);assert(b.report.counts.parameterBytes<=1);assert.equal(x.clients.length,1);
});
test('driver byte ownership uses intrinsic views, not caller-shadowable Buffer methods',async()=>{
 let touched=0;const original=Buffer.from('incumbent');const w=driver({query:(_w,c,t)=>{if(c.number===0&&/^SELECT bytes FROM .*doc_head/.test(t)){const bytes=Buffer.from(original);bytes.valueOf=()=>{touched++;throw Error(CANARY);};return {command:'SELECT',rows:[{bytes}]};}}});
 const r=await run(await fixture(),w);assert.equal(r.exit,0);assert.equal(touched,0);assert([...w.quarantine.values()].some(b=>b.equals(original)));
});
