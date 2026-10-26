'use strict';
// Candidate GCS JSON-API binding, DEFAULT DISCONNECTED. No auth/SDK/network/env
// resolver. request is a TRUSTED already-configured executor returning
// {status,body}: parsed JSON metadata or Buffer media, never a streaming body.
// It must enforce maxResponseBytes, honor signal, disable retries/redirects and
// caches, and preserve the specified target/query/headers/body. Timeout/abort
// cannot prove a dispatched upload did not land; no write is ever replayed.
//
// Official contracts: https://docs.cloud.google.com/storage/docs/metadata
// https://docs.cloud.google.com/storage/docs/request-preconditions
// https://docs.cloud.google.com/storage/docs/json_api/v1/objects/list
// https://docs.cloud.google.com/storage/docs/consistency
// Bytes AND adapter metadata live in one immutable generation's v1 envelope.
// Mutable GCS custom metadata/metageneration is NOT an adapter authority.
// Native generation strings remain opaque: no Number conversion, ETag or clock.
// A qualified private bucket/namespace and shared writer exclusion are REQUIRED.
// assertStableNamespace is a trusted synchronous exact-true current witness,
// checked around list awaits, NOT a distributed lock or provider snapshot.
// A writer bypassing that exclusion can invalidate completeness without being
// detectable here. No coordination log/barrier/lease or authority is invented.
// GCS replacement requires storage.objects.create AND storage.objects.delete:
// this API exposes no deletion, but the mutable-pin principal is NOT delete-free.
// Retention, lifecycle/other writers, public caching, IAM and provider behavior
// need separate live qualification. This module qualifies none of them.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { types } = require('node:util');
const promiseThen = Promise.prototype.then;
const MAX = Object.freeze({maxBytes:4*1024*1024,maxWireBytes:6*1024*1024,
  pageSize:100,maxPages:100,maxEntries:10000,requestMs:5000,scanMs:30000});
const safeErrors = new WeakSet();
function fail(category) {const e=new Error('settlement-gcs-transport: '+category);
  e.code=category==='conflict'?'conflict':'GCS_TRANSPORT';e.category=category;safeErrors.add(e);return e;}
function check(value,category='response') {if(!value)throw fail(category);}
const hash=(b,algorithm='sha256',encoding='hex')=>crypto.createHash(algorithm).update(b).digest(encoding);
const plain=x=>!!x&&Object.getPrototypeOf(x)===Object.prototype;
function record(value,allowed,required=allowed) {
  check(plain(value),'config');const ds=Object.getOwnPropertyDescriptors(value);
  check(Reflect.ownKeys(ds).every(k=>typeof k==='string'&&allowed.includes(k)&&Object.hasOwn(ds[k],'value'))
    &&required.every(k=>Object.hasOwn(ds,k)),'config');
  return Object.fromEntries(Object.entries(ds).map(([k,d])=>[k,d.value]));
}
const generation=x=>typeof x==='string'&&/^[1-9][0-9]{0,19}$/.test(x);
function metadataCopy(value) {
  check(plain(value),'input');const ds=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(ds);
  check(keys.length<=32,'bounds');const copy={};
  for(const k of keys){const d=ds[k];check(typeof k==='string'&&/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k)
    &&!['constructor','prototype','__proto__'].includes(k)&&d.enumerable&&Object.hasOwn(d,'value'),'input');
    const v=d.value;check(v===null||typeof v==='boolean'||typeof v==='string'&&v.length<=256
      ||Number.isSafeInteger(v)&&!Object.is(v,-0),'input');copy[k]=v;}
  check(Buffer.byteLength(JSON.stringify(copy))<=4096,'bounds');return copy;
}
function createSettlementEvidenceGcsTransport(options) {
  if(options===undefined)return Object.freeze(Object.fromEntries(['read','create','replace','list']
    .map(k=>[k,()=>Promise.reject(fail('unconfigured'))])));
  const o=record(options,['request','bucket','namespace','projectNumber','location','assertStableNamespace','limits'],
    ['request','bucket','namespace','projectNumber','location','assertStableNamespace']);
  check(typeof o.request==='function'&&typeof o.assertStableNamespace==='function','config');
  check(typeof o.bucket==='string'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(o.bucket)
    &&!/^goog/.test(o.bucket),'config');
  check(typeof o.namespace==='string'&&/^[a-z0-9][a-z0-9._-]{0,127}$/.test(o.namespace)
    &&!o.namespace.includes('..'),'config');
  check(typeof o.projectNumber==='string'&&/^[1-9][0-9]{0,19}$/.test(o.projectNumber)
    &&typeof o.location==='string'&&/^[A-Z][A-Z0-9-]{1,39}$/.test(o.location),'config');
  const limits={...MAX,...(o.limits===undefined?{}:record(o.limits,Object.keys(MAX),[]))};
  for(const k of Object.keys(MAX))check(Number.isInteger(limits[k])&&limits[k]>0&&limits[k]<=MAX[k],'config');
  const root='https://storage.googleapis.com/storage/v1/b/'+o.bucket;
  const prefix=o.namespace+'/';let busy=false,scan=null;
  function key(k){check(typeof k==='string'&&k.startsWith(prefix)&&k.length<=1024
    &&k.split('/').every(p=>p&&p!=='.'&&p!=='..'&&/^[a-zA-Z0-9._-]+$/.test(p)),'input');return k;}
  function url(base,params={}) {const u=new URL(base);for(const [k,v] of Object.entries(params))u.searchParams.set(k,String(v));return u.href;}
  const objectUrl=k=>root+'/o/'+encodeURIComponent(k);
  const fields='bucket,name,generation,metageneration,size,md5Hash,contentEncoding';
  function stable(){let v;try{v=o.assertStableNamespace();}catch{throw fail('unstable');}
    if(v!==true&&types.isPromise(v)){try{Reflect.apply(promiseThen,v,[()=>{},()=>{}]);}catch{ /* remains refused */ }}
    check(v===true,'unstable');}
  async function request(method,target,responseType,body) {
    const control=new AbortController();let timer;
    const remaining=scan?Math.min(limits.requestMs,scan.deadline-performance.now()):limits.requestMs;
    check(remaining>0,'bounds');
    const pending=Promise.resolve().then(()=>o.request(Object.freeze({method,url:target,responseType,
      headers:Object.freeze({'Cache-Control':'no-cache',...(body?{'Content-Type':'application/octet-stream'}:{})}),
      ...(body?{body:Buffer.from(body)}:{}),signal:control.signal,redirect:'error',
      maxResponseBytes:responseType==='bytes'?limits.maxWireBytes:1024*1024})));
    try {const r=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{
      control.abort();reject(fail('request'));},remaining);})]);
      check(r&&Number.isInteger(r.status)&&r.status>=100&&r.status<=599);return r;
    }catch{throw fail('request');}finally{clearTimeout(timer);}
  }
  function describe(d,k){check(plain(d)&&d.bucket===o.bucket&&d.name===k&&generation(d.generation)
    &&generation(d.metageneration)&&typeof d.size==='string'&&/^(0|[1-9][0-9]{0,7})$/.test(d.size)
    &&Number(d.size)<=limits.maxWireBytes&&typeof d.md5Hash==='string'
    &&/^[A-Za-z0-9+/]{22}==$/.test(d.md5Hash)&&(!d.contentEncoding||d.contentEncoding==='identity'));
    return Object.freeze({generation:d.generation,size:Number(d.size),md5Hash:d.md5Hash});}
  function decode(bytes,k){check(Buffer.isBuffer(bytes)&&bytes.length<=limits.maxWireBytes,'bounds');let w;
    try{w=JSON.parse(bytes.toString('utf8'));}catch{throw fail('integrity');}
    check(plain(w)&&Object.keys(w).sort().join(',')==='bytes,integrity,key,metadata,v'
      &&w.v===1&&w.key===k&&typeof w.bytes==='string'&&/^[a-f0-9]{64}$/.test(w.integrity),'integrity');
    const logical=Buffer.from(w.bytes,'base64');check(logical.toString('base64')===w.bytes
      &&logical.length<=limits.maxBytes&&hash(logical)===w.integrity,'integrity');
    const metadata=metadataCopy(w.metadata);return {bytes:logical,metadata};}
  async function media(k,d){const r=await request('GET',url(objectUrl(k),{alt:'media',generation:d.generation}),'bytes');
    check(r.status===200&&Buffer.isBuffer(r.body)&&r.body.length===d.size
      &&hash(r.body,'md5','base64')===d.md5Hash,'integrity');return r.body;}
  async function read(k){key(k);const r=await request('GET',url(objectUrl(k),{fields}),'json');
    if(r.status===404){check(plain(r.body?.error)&&r.body.error.code===404&&Array.isArray(r.body.error.errors)
      &&r.body.error.errors.length>0&&r.body.error.errors.every(e=>e.reason==='notFound'));
      const b=await request('GET',url(root,{fields:'name,projectNumber,location'}),'json');
      check(b.status===200&&b.body?.name===o.bucket&&b.body.projectNumber===o.projectNumber
        &&b.body.location===o.location);return null;}
    check(r.status===200);const d=describe(r.body,k),wire=await media(k,d);
    return {...decode(wire,k),version:d.generation};}
  async function write(k,bytes,expected,metadata){key(k);check(expected==='0'||generation(expected),'input');
    check(Buffer.isBuffer(bytes)||bytes instanceof Uint8Array,'input');const copy=Buffer.from(bytes),m=metadataCopy(metadata);
    check(copy.length<=limits.maxBytes,'bounds');const wire=Buffer.from(JSON.stringify({v:1,key:k,metadata:m,
      bytes:copy.toString('base64'),integrity:hash(copy)}));check(wire.length<=limits.maxWireBytes,'bounds');
    // All validation/snapshots above precede the first asynchronous dispatch.
    try{const upload='https://storage.googleapis.com/upload/storage/v1/b/'+o.bucket+'/o';
      const r=await request('POST',url(upload,{uploadType:'media',name:k,ifGenerationMatch:expected,fields}),'json',wire);
      if(r.status===412)throw fail('conflict');check(r.status===200);const d=describe(r.body,k);
      check(d.generation!==expected);const back=await media(k,d);check(back.equals(wire),'integrity');
      decode(back,k);return Object.freeze({version:d.generation,integrity:hash(copy)});
    }catch(e){if(safeErrors.has(e)&&e.category==='conflict')throw e;throw fail('unknown-write');}}
  async function list(p,cursor){check(p===prefix,'input');stable();
    if(cursor===null){check(scan===null,'cursor');scan={token:null,tokens:new Set(),keys:new Set(),pages:0,entries:0,
      deadline:performance.now()+limits.scanMs};}
    else check(scan&&typeof cursor==='string'&&cursor===scan.token,'cursor');
    const s=scan;check(s&&++s.pages<=limits.maxPages&&performance.now()<s.deadline,'bounds');
    const r=await request('GET',url(root+'/o',{prefix:p,maxResults:limits.pageSize,
      fields:'items('+fields+'),nextPageToken,prefixes',...(cursor===null?{}:{pageToken:cursor})}),'json');
    stable();check(performance.now()<s.deadline,'bounds');check(r.status===200&&plain(r.body));
    const b=r.body;check(!Object.hasOwn(b,'prefixes')||Array.isArray(b.prefixes)&&b.prefixes.length===0);
    check(!Object.hasOwn(b,'items')||Array.isArray(b.items));const items=b.items||[];
    check(items.length<=limits.pageSize&&(s.entries+=items.length)<=limits.maxEntries,'bounds');
    let next=null;if(Object.hasOwn(b,'nextPageToken')){check(typeof b.nextPageToken==='string'
      &&b.nextPageToken.length>0&&b.nextPageToken.length<=4096&&!s.tokens.has(b.nextPageToken),'cursor');
      next=b.nextPageToken;s.tokens.add(next);}
    // Snapshot listed generation descriptors before any subsequent awaits.
    const snapshots=items.map(item=>{const k=key(item.name);check(!s.keys.has(k),'cursor');s.keys.add(k);
      return {key:k,descriptor:describe(item,k)};});
    const entries=[];for(const item of snapshots){stable();check(performance.now()<s.deadline,'bounds');
      const wire=await media(item.key,item.descriptor);stable();check(performance.now()<s.deadline,'bounds');
      entries.push(Object.freeze({key:item.key,metadata:Object.freeze(decode(wire,item.key).metadata)}));}
    stable();scan=next===null?null:s;s.token=next;return {entries,nextCursor:next};}
  function run(fn){if(busy)return Promise.reject(fail('busy'));busy=true;let pending;
    try{pending=fn();}catch(e){pending=Promise.reject(e);}
    return Promise.resolve(pending).catch(e=>{scan=null;throw safeErrors.has(e)?e:fail('response');})
      .finally(()=>{busy=false;});}
  return Object.freeze({read:k=>run(()=>read(k)),create:(k,b,m)=>run(()=>write(k,b,'0',m)),
    replace:(k,b,v,m)=>run(()=>{check(generation(v),'input');return write(k,b,v,m);}),list:(p,c)=>run(()=>list(p,c))});
}
module.exports={createSettlementEvidenceGcsTransport};
