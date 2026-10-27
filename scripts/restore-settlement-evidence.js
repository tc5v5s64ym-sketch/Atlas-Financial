'use strict';
// Explicit OWNER command, never an application startup/restore route. Import is
// inert. Inputs are already decrypted owner files and independently trusted
// anchors; this command proves neither custody/latestness nor quiescence.
const fs=require('node:fs'),path=require('node:path'),tls=require('node:tls'),net=require('node:net');
const {performance}=require('node:perf_hooks');
const {execFileSync}=require('node:child_process');
const {StringDecoder}=require('node:string_decoder');
const TC=require('./settlement-evidence-terminal-certificate');
const V=require('./settlement-evidence-restore-input');
const M=require('./settlement-evidence-restore-install');
const MAX=Object.freeze({connect:10000,preflight:10000,query:7000,close:2000,dispatch:120000,outer:150000,queries:128,parameters:64*1024*1024});
const TRUST=/^(?:PG.*|NODE_OPTIONS|NODE_PATH|NODE_TLS_REJECT_UNAUTHORIZED|NODE_EXTRA_CA_CERTS|NODE_USE_SYSTEM_CA|SSL_CERT_FILE|SSL_CERT_DIR|OPENSSL_.*)$/i;
const SAFE_CODES=new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','28000','28P01','42501','42P01','42703','53300','57P01','57014','55P03','08006','23505']);
const PROFILE=Object.freeze({doc_head:[true,true,false],doc_staged:[false,false,true],journal:[false,false,true],quarantine:[true,false,false],terminal_history:[true,true,false]});
const USAGE=`node scripts/restore-settlement-evidence.js --private-root ABS_DIRECTORY --request ABS_REQUEST_JSON --report ABS_NEW_REPORT_JSON [--password-fd N]
Owner-only files, outside the checkout, no links. Report must not exist.
Request JSON (all fields required; no password in this file):
{"schema":"settlement-owner-restore-request-1","target":{"host":"db.example.test","port":5432,"database":"atlas","user":"maintenance","schema":"atlas_settle","scope":"household-a"},"domain":{"householdId":"EXPLICIT","ledgerNamespace":"EXPLICIT"},"anchors":{"ledger":{"revision":0,"documentDigest":"64hex"},"history":{"schema":"EXPLICIT","householdId":"EXPLICIT","ledgerNamespace":"EXPLICIT","revision":0,"digest":"64hex"}},"candidate":{"ledgerFile":"ledger.json","historyFile":"history.json"},"pin":"independent64hex","preconditions":{"quiescent":true,"restartInhibited":true,"anchorsCurrent":true,"ownerDecrypted":true}}
Use the actual trusted domain/checkpoint schema/anchors, never the placeholders.
Password is hidden TTY input or an explicitly supplied private fd>=3. No defaults.
Requires Node24.22.1/pg8.16.3, provisioned PG18 maintenance grants and exact tables.
Limits: 2clients/128queries/64MiB parameters/120s dispatch/150s outer, no retry.
Owner proves quiescence, restart inhibition, anchor provenance and key custody.
This command neither retrieves/decrypts archives nor changes pins/reopens the app.
`;
const FAILURES=new WeakSet(),CLAIMED=new WeakSet();
const TYPED=Object.getPrototypeOf(Uint8Array.prototype);
const BYTE_BUFFER=Object.getOwnPropertyDescriptor(TYPED,'buffer').get;
const BYTE_OFFSET=Object.getOwnPropertyDescriptor(TYPED,'byteOffset').get;
const BYTE_LENGTH=Object.getOwnPropertyDescriptor(TYPED,'byteLength').get;
function failure(stage,category,code=null){const e=Object.assign(new Error('owner-restore unavailable'),{stage,category,code});FAILURES.add(e);return e;}
function requireThat(ok,stage,category='invalid-input'){if(!ok)throw failure(stage,category);}
function safe(error,stage){if(error&&FAILURES.has(error))return error;let code;try{code=Object.getOwnPropertyDescriptor(error,'code')?.value;}catch{}
 return failure(stage,SAFE_CODES.has(code)?'driver':'other',SAFE_CODES.has(code)?code:null);}
function exact(value,keys){requireThat(value&&Object.getPrototypeOf(value)===Object.prototype,'input');const d=Object.getOwnPropertyDescriptors(value);
 requireThat(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d,k)&&Object.hasOwn(d[k],'value')),'input');return value;}
function inside(root,p){const rel=path.relative(root,p);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);}
function privateOnOS(p){
 if(process.platform!=='win32'){const s=fs.lstatSync(p);return s.uid===process.getuid()&&(s.mode&0o077)===0;}
 // Metadata only; fixed code and literal path via a child-local nonsecret env.
 // No credential store, shell expansion, permission changes or user profile.
 const root=process.env.SystemRoot;requireThat(typeof root==='string'&&path.isAbsolute(root),'private-path');
 const script="$ErrorActionPreference='Stop';$p=$env:ATLAS_RESTORE_ACL_PATH;$s=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;$a=Get-Acl -LiteralPath $p;$r=@($a.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]));$ok=$a.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $s -and $r.Count -gt 0;foreach($x in $r){if($x.IdentityReference.Value -ne $s -or $x.AccessControlType -ne 'Allow'){$ok=$false}};if($ok){'true'}else{'false'}";
 const out=execFileSync(path.join(root,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],
  {env:{SystemRoot:root,WINDIR:root,ATLAS_RESTORE_ACL_PATH:p},encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:512,stdio:['ignore','pipe','pipe']});
 return out.trim()==='true';
}
function privatePaths(root,checker){
 requireThat(typeof root==='string'&&path.isAbsolute(root),'private-path');root=path.resolve(root);
 const repo=path.resolve(__dirname,'..');requireThat(root!==repo&&!inside(repo,root)&&!inside(root,repo),'private-path');
 function noLinks(p){let current=path.parse(p).root;for(const part of p.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);requireThat(!fs.lstatSync(current).isSymbolicLink(),'private-path');}}
 noLinks(root);requireThat(fs.lstatSync(root).isDirectory()&&checker(root)===true,'private-path');
 function checked(p,exists=true){requireThat(typeof p==='string'&&p.length>0&&p.length<=2048&&!p.includes('\0'),'private-path');
  p=path.isAbsolute(p)?path.resolve(p):path.resolve(root,p);requireThat(inside(root,p),'private-path');noLinks(exists?p:path.dirname(p));
  requireThat(checker(path.dirname(p))===true,'private-path');if(exists){const st=fs.lstatSync(p);requireThat(st.isFile()&&st.nlink===1&&checker(p)===true,'private-path');}return p;}
 function read(p,cap){p=checked(p);const before=fs.lstatSync(p);requireThat(before.size<=cap,'input','size');const fd=fs.openSync(p,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
  try{const s=fs.fstatSync(fd);requireThat(s.isFile()&&s.nlink===1&&s.dev===before.dev&&s.ino===before.ino&&s.size<=cap,'private-path');const b=fs.readFileSync(fd);requireThat(b.length===s.size&&b.length<=cap,'input','size');return Buffer.from(b);}finally{fs.closeSync(fd);}}
 function report(p){p=checked(p,false);const fd=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),0o600);
  try{requireThat(checker(p)===true&&fs.fstatSync(fd).nlink===1,'private-path');}catch(e){fs.closeSync(fd);throw e;}return fd;}
 return {read,report};
}
function options(args){requireThat(Array.isArray(args)&&args.every(x=>typeof x==='string'),'arguments');
 if(args.length===1&&args[0]==='--help')return {help:true};const values={};
 for(let i=0;i<args.length;i+=2){const k=args[i];requireThat(['--private-root','--request','--report','--password-fd'].includes(k)&&!Object.hasOwn(values,k)&&typeof args[i+1]==='string','arguments');values[k]=args[i+1];}
 requireThat(['--private-root','--request','--report'].every(k=>Object.hasOwn(values,k)),'arguments');
 if(values['--password-fd']!==undefined)requireThat(/^[3-9][0-9]?$/.test(values['--password-fd']),'arguments');return values;}
function captureRequest(bytes,files){let r;try{r=TC.own(JSON.parse(bytes.toString('utf8')));}catch{throw failure('input','invalid-input');}
 exact(r,['schema','target','domain','anchors','candidate','pin','preconditions']);requireThat(r.schema==='settlement-owner-restore-request-1','input');
 const t=exact(r.target,['host','port','database','user','schema','scope']);
 requireThat(typeof t.host==='string'&&t.host.length<=253&&t.host.includes('.')&&!net.isIP(t.host)&&!t.host.includes('-pooler')&&t.host.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s)),'input');
 requireThat(Number.isInteger(t.port)&&t.port>0&&t.port<=65535,'input');for(const k of ['database','user','schema'])requireThat(typeof t[k]==='string'&&/^[a-z_][a-z0-9_]{0,62}$/.test(t[k]),'input');
 requireThat(!t.schema.startsWith('pg_')&&t.schema!=='information_schema'&&typeof t.scope==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(t.scope),'input');
 exact(r.candidate,['ledgerFile','historyFile']);exact(r.preconditions,['quiescent','restartInhibited','anchorsCurrent','ownerDecrypted']);
 requireThat(Object.values(r.preconditions).every(v=>v===true),'input');requireThat(typeof r.pin==='string'&&/^[a-f0-9]{64}$/.test(r.pin),'input');
 const candidate={ledgerBytes:files.read(r.candidate.ledgerFile,M.LEDGER_MAX_BYTES),historyBytes:files.read(r.candidate.historyFile,M.HISTORY_MAX_BYTES)};
 const v=V.validateRestoreInput({domain:r.domain,anchors:r.anchors,candidate});requireThat(v.status==='valid'&&v.ledger.pin===r.pin,'input','candidate');
 return {request:r,candidate};
}
async function password(o){
 if(o['--password-fd']!==undefined){const fd=Number(o['--password-fd']),parts=[];let n=0;const b=Buffer.alloc(256);try{for(;;){const got=fs.readSync(fd,b,0,b.length,null);if(!got)break;n+=got;requireThat(n<=2048,'password');parts.push(Buffer.from(b.subarray(0,got)));}return Buffer.concat(parts).toString('utf8').replace(/\r?\n$/,'');}finally{b.fill(0);for(const p of parts)p.fill(0);}}
 requireThat(process.stdin.isTTY&&typeof process.stdin.setRawMode==='function','password','private-input-required');
 process.stdout.write('Maintenance password (hidden): ');
 return new Promise((resolve,reject)=>{const input=process.stdin,wasRaw=input.isRaw,wasPaused=input.isPaused(),decoder=new StringDecoder('utf8');let value='',done=false;
  const end=(err)=>{if(done)return;done=true;input.removeListener('data',read);input.removeListener('error',bad);input.setRawMode(!!wasRaw);if(wasPaused)input.pause();process.stdout.write('\n');err?reject(failure('password','cancelled')):resolve(value);value='';};
  const bad=()=>end(true);const read=chunk=>{for(const c of decoder.write(chunk)){if(c==='\u0003'){end(true);return;}if(c==='\r'||c==='\n'){end(false);return;}if(c==='\b'||c==='\u007f')value=Array.from(value).slice(0,-1).join('');else if(c<' '){end(true);return;}else value+=c;if(value.length>1024){end(true);return;}}};
  input.setRawMode(true);input.on('data',read);input.on('error',bad);input.resume();});
}

const IDENTITY=`SELECT /*owner-identity*/ current_database() AS database,current_user AS "user",pg_backend_pid() AS pid,
 current_setting('search_path') AS "searchPath",current_setting('server_version_num')::int AS version,
 current_setting('transaction_read_only')='on' AS "readOnly",current_setting('default_transaction_read_only')='on' AS "defaultReadOnly"`;
const ROLE=`SELECT /*owner-role*/ r.rolcanlogin AS "canLogin",r.rolsuper AS superuser,r.rolcreatedb AS "createDb",r.rolcreaterole AS "createRole",r.rolinherit AS inherit,r.rolreplication AS replication,r.rolbypassrls AS "bypassRls",r.rolconnlimit AS "connectionLimit",
 (SELECT count(*)::int FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid) AS memberships,
 (SELECT count(*)::int FROM pg_catalog.pg_shdepend d WHERE d.refclassid='pg_catalog.pg_authid'::regclass AND d.refobjid=r.oid AND d.deptype='o') AS "ownedObjects" FROM pg_catalog.pg_roles r WHERE r.rolname=current_user`;
const PRIVILEGES=`SELECT /*owner-privileges*/ t.name,has_database_privilege(current_database(),'CONNECT') AS connect,has_database_privilege(current_database(),'CREATE') AS "databaseCreate",has_schema_privilege($1,'USAGE') AS "schemaUsage",has_schema_privilege($1,'CREATE') AS "schemaCreate",
 has_table_privilege(format('%I.%I',$1,t.name),'SELECT') AS "select",has_table_privilege(format('%I.%I',$1,t.name),'INSERT') AS "insert",has_table_privilege(format('%I.%I',$1,t.name),'UPDATE') AS "update",has_table_privilege(format('%I.%I',$1,t.name),'DELETE') AS "delete",
 has_table_privilege(format('%I.%I',$1,t.name),'TRUNCATE') AS "truncate",has_table_privilege(format('%I.%I',$1,t.name),'TRIGGER') AS "trigger",has_table_privilege(format('%I.%I',$1,t.name),'REFERENCES') AS "references",
 has_any_column_privilege(format('%I.%I',$1,t.name),'INSERT') AS "anyInsert",has_any_column_privilege(format('%I.%I',$1,t.name),'UPDATE') AS "anyUpdate",has_any_column_privilege(format('%I.%I',$1,t.name),'REFERENCES') AS "anyReferences",
 has_function_privilege('pg_catalog.pg_try_advisory_lock(integer,integer)','EXECUTE') AND has_function_privilege('pg_catalog.pg_backend_pid()','EXECUTE') AS functions FROM (VALUES ('doc_head'),('doc_staged'),('journal'),('quarantine'),('terminal_history')) t(name)`;
const SCHEMA=`SELECT /*owner-schema*/ c.relname AS name,c.relkind AS kind,c.relpersistence AS persistence,c.relrowsecurity AS rls,c.relforcerowsecurity AS "forceRls",
 (c.relhasrules OR c.relispartition OR EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) OR EXISTS(SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND (k.contype NOT IN ('p','n') OR k.condeferrable OR NOT k.convalidated OR NOT k.conenforced))) AS unsafe,
 (SELECT count(*)::int FROM pg_catalog.pg_constraint k WHERE k.conrelid=c.oid AND k.contype='p') AS "primaryKeyCount",
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'generated',a.attgenerated) ORDER BY a.attnum) FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) AS columns,
 ARRAY(SELECT a.attname::text FROM pg_catalog.pg_constraint k CROSS JOIN LATERAL unnest(k.conkey) WITH ORDINALITY p(num,ord) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum=p.num WHERE k.conrelid=c.oid AND k.contype='p' ORDER BY p.ord) AS "primaryKey" FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind<>'i' ORDER BY c.relname LIMIT 6`;
function ownCell(v,depth=0){requireThat(depth<=24,'query','protocol');if(Buffer.isBuffer(v)){const length=Reflect.apply(BYTE_LENGTH,v,[]);requireThat(length<=M.QUARANTINE_MAX_BYTES,'query','size');const bytes=Buffer.alloc(length);Reflect.apply(TYPED.set,bytes,[new Uint8Array(Reflect.apply(BYTE_BUFFER,v,[]),Reflect.apply(BYTE_OFFSET,v,[]),length)]);return bytes;}if(v===null||['string','boolean','number','undefined'].includes(typeof v))return v;
 requireThat(Array.isArray(v)||Object.getPrototypeOf(v)===Object.prototype,'query','protocol');const out=Array.isArray(v)?[]:{};for(const k of Reflect.ownKeys(v)){if(k==='length'&&Array.isArray(v))continue;const d=Object.getOwnPropertyDescriptor(v,k);requireThat(typeof k==='string'&&k!=='__proto__'&&d&&Object.hasOwn(d,'value'),'query','protocol');out[k]=ownCell(d.value,depth+1);}return out;}
function result(raw){requireThat(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'query','protocol');const d=Object.getOwnPropertyDescriptors(raw);
 requireThat(d.command&&Object.hasOwn(d.command,'value')&&['SELECT','BEGIN','COMMIT','ROLLBACK','INSERT','UPDATE','DELETE'].includes(d.command.value)&&d.rows&&Object.hasOwn(d.rows,'value')&&Array.isArray(d.rows.value)&&d.rows.value.length<=6,'query','protocol');
 requireThat(!d.rowCount||Object.hasOwn(d.rowCount,'value'),'query','protocol');const rows=ownCell(d.rows.value);
 requireThat(rows.every(r=>r!==null&&typeof r==='object'&&!Array.isArray(r)&&Object.getPrototypeOf(r)===Object.prototype),'query','protocol');
 return {command:d.command.value,rows,rowCount:d.rowCount?.value};}
function one(r,stage){requireThat(r.command==='SELECT'&&r.rows.length===1&&r.rows[0]&&typeof r.rows[0]==='object',stage,'protocol');return r.rows[0];}
function schemaCheck(rows){requireThat(rows.length===5,'schema','schema');const names=new Set();for(const t of rows){requireThat(Object.hasOwn(PROFILE,t.name)&&!names.has(t.name),'schema','schema');names.add(t.name);
 requireThat(t.kind==='r'&&t.persistence==='p'&&t.rls===false&&t.forceRls===false&&t.unsafe===false&&t.primaryKeyCount===1,'schema','schema');
 const cols=t.name==='quarantine'?['scope','name','label','bytes']:t.name==='terminal_history'?['scope','history_bytes','checkpoint_bytes']:['scope','bytes'];
 requireThat(Array.isArray(t.columns)&&t.columns.length===cols.length&&t.columns.every((c,i)=>c.name===cols[i]&&c.type===(['bytes','history_bytes','checkpoint_bytes'].includes(c.name)?'bytea':'text')&&c.notNull===(c.name!=='label')&&c.generated===''),'schema','schema');
 requireThat(Array.isArray(t.primaryKey)&&JSON.stringify(t.primaryKey)===JSON.stringify(t.name==='quarantine'?['scope','name']:['scope']),'schema','schema');}}
function privileges(rows){requireThat(rows.length===5,'privileges','privileges');const names=new Set();for(const r of rows){requireThat(Object.hasOwn(PROFILE,r.name)&&!names.has(r.name),'privileges','privileges');names.add(r.name);const p=PROFILE[r.name];
 requireThat(r.select===true&&r.insert===p[0]&&r.update===p[1]&&r.delete===p[2]&&r.truncate===false&&r.trigger===false&&r.references===false&&r.anyReferences===false&&r.anyInsert===p[0]&&r.anyUpdate===p[1]&&r.connect===true&&r.schemaUsage===true&&r.databaseCreate===false&&r.schemaCreate===false&&r.functions===true,'privileges','privileges');}}
async function openOwner(ctx,Client,target,secret,verify){
 requireThat(!ctx.stopped&&performance.now()<ctx.deadline&&performance.now()<ctx.outerDeadline,'connect','timeout');
 requireThat(ctx.clients<2&&ctx.active===0,'connect','ownership');ctx.clients++;let raw;
 try{raw=new Client({host:target.host,port:target.port,database:target.database,user:target.user,password:secret,
  ssl:{rejectUnauthorized:true,servername:target.host},application_name:'atlas-owner-restore',connectionTimeoutMillis:ctx.limits.connect,query_timeout:ctx.limits.query,statement_timeout:5000,lock_timeout:1000,idle_in_transaction_session_timeout:10000,
  options:'-c default_transaction_read_only='+(verify?'on':'off')});}catch{ctx.closures.push({close:'unconfirmed'});throw failure('client-setup','unconfirmed');}
 if(CLAIMED.has(raw)){ctx.closures.push({close:'unconfirmed',diagnostic:{stage:'client-setup',category:'ownership',code:null}});throw failure('client-setup','ownership');}CLAIMED.add(raw);
 ctx.active++;let retired=false,closed=null,primary=null,connectStarted=false,connectFinished;const connected=new Promise(r=>{connectFinished=r;});let lose;
 const loss=new Promise(r=>{lose=r;});const listeners={error:new Set(),end:new Set()};
 function retire(){if(closed)return closed;retired=true;lose();if(!connectStarted)connectFinished();closed=(async()=>{let timer;const until=performance.now()+ctx.limits.close;
  const pending=Promise.resolve().then(()=>raw.end()).then(()=>connected.then(()=>({close:'confirmed'})),e=>{const s=safe(e,'end');return {close:'failed',diagnostic:{stage:s.stage,category:s.category,code:s.code}};});
  let answer=await Promise.race([pending,new Promise(r=>{timer=setTimeout(()=>r({close:'unconfirmed',diagnostic:{stage:'end',category:'timeout',code:null}}),ctx.limits.close);})]);clearTimeout(timer);
  if(answer.close==='confirmed'&&performance.now()>=until)answer={close:'unconfirmed',diagnostic:{stage:'end',category:'timeout',code:null}};
  ctx.closures.push(answer);if(answer.close==='confirmed')ctx.active--;return answer;})();return closed;}
 ctx.retire=retire;
 function lost(e,stage){if(!primary){primary=safe(e,stage);ctx.diagnostics.push({stage:primary.stage,category:primary.category,code:primary.code});}lose();void retire();}
 async function bounded(fn,stage,ms){requireThat(!retired&&!ctx.stopped&&performance.now()<ctx.deadline,stage,'retired');let timer;const deadline=Math.min(performance.now()+ms,ctx.deadline,ctx.outerDeadline);
  try{const r=await Promise.race([Promise.resolve().then(()=>{requireThat(!retired&&!ctx.stopped&&performance.now()<deadline,stage,'retired');return fn();}),loss.then(()=>{throw primary||failure(stage,'retired');}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(failure(stage,'timeout')),Math.max(1,deadline-performance.now()));})]);requireThat(!retired&&!ctx.stopped&&performance.now()<deadline,stage,'timeout');return r;}
  catch(e){const s=safe(e,stage);lost(s,stage);throw s;}finally{clearTimeout(timer);}}
 async function query(text,values,millis=ctx.limits.query){requireThat(typeof text==='string'&&Array.isArray(values),'query','protocol');
  if(verify)requireThat(/^SELECT\b/.test(text)||text==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'||text==='COMMIT','query','read-only');
  const copy=values.map(v=>{requireThat(Buffer.isBuffer(v)||v===null||['string','number','boolean'].includes(typeof v),'query','protocol');return Buffer.isBuffer(v)?Buffer.from(v):v;});
  const bytes=copy.reduce((n,v)=>n+(Buffer.isBuffer(v)?v.length:Buffer.byteLength(String(v))),0);
  try{return result(await bounded(()=>{requireThat(ctx.queries<ctx.limits.queries&&ctx.parameters+bytes<=ctx.limits.parameters,'query','budget');ctx.queries++;ctx.parameters+=bytes;return raw.query(text,copy);},'query',millis));}catch(e){lost(e,'query');throw e;}}
 const owner={session:Object.freeze({query,on:(event,fn)=>{requireThat(Object.hasOwn(listeners,event)&&typeof fn==='function','session','protocol');listeners[event].add(fn);},retire}),close:retire};
 try{
  requireThat(raw&&['connect','query','on','end'].every(k=>typeof raw[k]==='function')&&typeof raw.release!=='function','client-setup','protocol');
  for(const event of ['error','end'])raw.on(event,e=>{if(!retired)lost(e,'session');for(const fn of listeners[event]){try{fn();}catch{}}});
  await bounded(()=>{connectStarted=true;return Promise.resolve().then(()=>raw.connect()).finally(connectFinished);},'connect',ctx.limits.connect);
  const socket=raw.connection?.stream;requireThat(socket?.encrypted===true&&socket.authorized===true&&socket.servername===target.host&&!socket.authorizationError&&typeof socket.getPeerCertificate==='function'&&!tls.checkServerIdentity(target.host,socket.getPeerCertificate(true)),'tls','tls');
  const preflight=performance.now()+ctx.limits.preflight;const q=async sql=>{const remaining=preflight-performance.now();requireThat(remaining>0,'preflight','timeout');const r=await query(sql,[...(sql===PRIVILEGES||sql===SCHEMA?[target.schema]:[])],Math.min(ctx.limits.query,remaining));requireThat(performance.now()<preflight,'preflight','timeout');return r;};
  const id=one(await q(IDENTITY),'identity');requireThat(id.database===target.database&&id.user===target.user&&Number.isSafeInteger(id.pid)&&id.pid>0&&id.searchPath==='pg_catalog'&&Number.isInteger(id.version)&&id.version>=180000&&id.version<190000&&id.readOnly===verify&&id.defaultReadOnly===verify,'identity','identity');
  const role=one(await q(ROLE),'role');requireThat(role.canLogin===true&&['superuser','createDb','createRole','inherit','replication','bypassRls'].every(k=>role[k]===false)&&role.connectionLimit===1&&role.memberships===0&&role.ownedObjects===0,'role','privileges');
  const acl=await q(PRIVILEGES);requireThat(acl.command==='SELECT','privileges','protocol');privileges(acl.rows);const sc=await q(SCHEMA);requireThat(sc.command==='SELECT','schema','protocol');schemaCheck(sc.rows);return owner;
 }catch(e){await retire();throw safe(e,'qualification');}
}
function summary(r,verify=false){const allowed=verify?['verified','mismatch','refused','unknown']:['installed-unverified','refused','unknown'];const out={status:allowed.includes(r?.status)?r.status:'unknown'};
 const reasons=verify?M.VERIFY_REASONS:M.INSTALL_REASONS;if(reasons.includes(r?.reason))out.reason=r.reason;return out;}
async function main(argv,injected={}){
 const write=injected.stdout||((s)=>process.stdout.write(s));let reportFd=null,report=null,ctx=null,secret=null,stage='arguments',owner=null,outerTimer;let exit=1;
 try{
  const o=options(argv);if(o.help){write(USAGE);return 0;}
  requireThat(!Object.keys(process.env).some(k=>TRUST.test(k)),'environment','unsafe-environment');
  stage='input';const files=privatePaths(o['--private-root'],injected.privateCheck||privateOnOS);
  const {request,candidate}=captureRequest(files.read(o['--request'],32768),files);
  reportFd=files.report(o['--report']);report={schema:'settlement-owner-install-report-1',status:'refused',stage,preconditions:'operator-asserted-not-proved',domain:request.domain,anchors:request.anchors,reopen:false,install:null,verification:null,closures:[]};
  stage='driver';requireThat(process.version==='v24.22.1',stage,'runtime');let Client=injected.Client;
  if(!Client){requireThat(require('pg/package.json').version==='8.16.3',stage,'driver');Client=require('pg').Client;}requireThat(typeof Client==='function',stage,'driver');
  const limits={...MAX,...(injected.limits||{})};for(const k of Object.keys(limits))requireThat(Object.hasOwn(MAX,k)&&Number.isSafeInteger(limits[k])&&limits[k]>0&&limits[k]<=MAX[k],'input','limits');
  stage='password';secret=await(injected.readPassword?injected.readPassword(o):password(o));requireThat(typeof secret==='string'&&secret.length>0&&secret.length<=1024&&!secret.includes('\0'),stage,'private-input');
  const start=performance.now();ctx={limits,clients:0,active:0,queries:0,parameters:0,closures:[],diagnostics:[],deadline:start+limits.dispatch,outerDeadline:start+limits.outer,stopped:false,retire:null};
  outerTimer=setTimeout(()=>{ctx.stopped=true;if(ctx.retire)void ctx.retire();},limits.outer);
  stage='install-qualification';owner=await openOwner(ctx,Client,request.target,secret,false);
  const input={schema:request.target.schema,scope:request.target.scope,domain:request.domain,anchors:request.anchors,candidate};
  stage='install';const installed=await M.installRestoreCandidate({...input,session:owner.session});report.install=summary(installed);stage='install-close';const closed=await owner.close();owner=null;
  requireThat(closed.close==='confirmed',stage,'close');requireThat(installed.status==='installed-unverified','install',installed.status==='refused'?'refused':'unknown');
  stage='verify-qualification';owner=await openOwner(ctx,Client,request.target,secret,true);
  stage='verify';const verified=await M.verifyRestoreInstall({...input,session:owner.session,pin:request.pin});report.verification=summary(verified,true);stage='verify-close';const ended=await owner.close();owner=null;requireThat(ended.close==='confirmed',stage,'close');
  requireThat(verified.status==='verified'&&verified.ledger.pin===request.pin&&verified.history.digest===request.anchors.history.digest,'verify','unknown');
  requireThat(!ctx.stopped&&performance.now()<ctx.outerDeadline,'outer','timeout');report.status='verified-install';stage='complete';exit=0;
 }catch(e){const s=safe(e,stage);if(owner){try{await owner.close();}catch{}}if(report){report.status=ctx?'unknown':'refused';if(report.install?.status==='refused'&&ctx?.closures.every(c=>c.close==='confirmed'))report.status='refused';report.diagnostic={stage:s.stage,category:s.category,code:s.code};}exit=ctx?2:1;
 }finally{clearTimeout(outerTimer);secret=null;if(report){report.stage=stage;report.closures=ctx?.closures||[];report.sessionDiagnostics=ctx?.diagnostics||[];report.counts={clients:ctx?.clients||0,queries:ctx?.queries||0,parameterBytes:ctx?.parameters||0};report.limits={...(ctx?.limits||MAX),passwordPromptExcluded:true};}
  let written=false;if(reportFd!==null){try{const bytes=Buffer.from(JSON.stringify(report)+'\n');requireThat(bytes.length<=16384,'report','size');fs.writeFileSync(reportFd,bytes);fs.fsyncSync(reportFd);written=true;}catch{exit=2;}finally{try{fs.closeSync(reportFd);}catch{exit=2;}}}
  write(JSON.stringify({status:exit===0?'verified-install':ctx?'unknown':'refused',reportWritten:written})+'\n');
 }
 return exit;
}
module.exports={main};
if(require.main===module)main(process.argv.slice(2)).then(code=>process.exit(code),()=>{process.stdout.write('{"status":"unknown","reportWritten":false}\n');process.exit(2);});
