'use strict';
// FOUNDATION - OFFLINE ONLY. Trusted injected capabilities, no default driver,
// secret reader, SQL, launcher, persistence or provider implementation.
// The future reviewed caller binds the exact target/case and supplies adapters
// for the shipped connection factories. This module grants no live authority.
const { performance } = require('node:perf_hooks');

function data(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || !keys.every(key =>
    Object.hasOwn(fields,key) && Object.hasOwn(fields[key],'value'))) throw null;
  return Object.fromEntries(keys.map(key => [key,fields[key].value]));
}
function own(value, key) {
  return Object.getOwnPropertyDescriptor(value, key)?.value;
}
async function runInt3Session(options) {
  let stage='manifest', failed=false, unexpected=false, active=true;
  let owner, financial, authorization, passwords, config;
  let timeoutMs, dependencies, manifest;
  const retirement={owner:'not-constructed',financial:'not-constructed',authorization:'not-constructed'};
  const closing=new Map();
  let caseResult='not-admitted', commit='not-attempted';
  // A timeout bounds observation, not the underlying operation. No retry or
  // compensating mutation is allowed. Late constructed owners are closed once;
  // returned evidence remains unconfirmed until a separately authorized observer.
  async function bounded(invoke) {
    let timer;
    const deadline=performance.now()+timeoutMs;
    try {
      const result=await Promise.race([Promise.resolve().then(invoke),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(null),timeoutMs);})]);
      if (performance.now()>=deadline) throw null;
      return result;
    } finally { clearTimeout(timer); }
  }
  function callback() { unexpected=true; }
  function guard() { if (unexpected) throw null; }
  async function close(name, resource) {
    if (closing.has(name)) return closing.get(name);
    retirement[name]='unconfirmed';
    const pending=(async()=>{
      try {
        const fn=own(resource,name==='owner'?'close':'retire');
        if(typeof fn!=='function') return;
        const result=await bounded(()=>fn.call(resource));
        // Only the narrow, exact evidence shape is accepted. Raw diagnostic
        // objects and errors are never returned or read for message/stack.
        const value=own(result,'close');
        if(active) retirement[name]=value==='confirmed'?'confirmed':value==='failed'?'failed':'unconfirmed';
      } catch { if(active) retirement[name]='unconfirmed'; }
    })();
    closing.set(name,pending); return pending;
  }
  async function construct(name, invoke) {
    retirement[name]='unconfirmed';
    let expired=false;
    try {
      return await bounded(()=>Promise.resolve().then(invoke).then(value=>{
        if(expired) { void close(name,value); throw null; }
        return value;
      }));
    } catch(error) {
      expired=true;
      // A shipped factory can reject after construction and attach its bounded
      // retirement report. Missing evidence stays unknown; never inspect raw
      // error strings, invoke accessors, or infer that construction never ran.
      try {
        const evidence=own(error,'retirement');
        const value=own(evidence,'close');
        if(['confirmed','failed','unconfirmed'].includes(value)) retirement[name]=value;
      } catch { /* absent/unreadable evidence is unconfirmed */ }
      throw null;
    }
  }
  function ready(resource) {
    const status=own(resource,'status');
    if(typeof status!=='function' || own(status.call(resource),'state')!=='ready') throw null;
  }
  try {
    const o=data(options,['manifest','dependencies','timeoutMs']);
    manifest=data(o.manifest,['target','financialRole','authorizationRole','caseId','rotationApproved']);
    dependencies=data(o.dependencies,['privateInput','openOwner','createFinancial','createAuthorization','runCase']);
    if(!Object.values(dependencies).every(x=>typeof x==='function')) throw null;
    timeoutMs=o.timeoutMs;
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000) throw null;
    for(const key of ['target','caseId']) if(typeof manifest[key]!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(manifest[key])) throw null;
    for(const key of ['financialRole','authorizationRole']) if(typeof manifest[key]!=='string'||!/^[a-z_][a-z0-9_]{0,62}$/.test(manifest[key])) throw null;
    if(manifest.financialRole===manifest.authorizationRole||manifest.rotationApproved!==true) throw null;
    Object.freeze(manifest);
    stage='private-input';
    passwords=data(await bounded(()=>dependencies.privateInput()),['financialPassword','authorizationPassword']);
    for(const value of Object.values(passwords)) if(typeof value!=='string'||!value.length||value.length>1024||value.includes('\0')) throw null;
    stage='owner'; owner=await construct('owner',()=>dependencies.openOwner(manifest,callback)); guard();
    const rotate=own(owner,'rotatePassword'), acknowledge=own(owner,'commit');
    if(typeof rotate!=='function'||typeof acknowledge!=='function') throw null;
    stage='rotation';
    // Exactly two existing named roles; no arbitrary SQL or setup callback.
    for(const [role,password] of [[manifest.financialRole,passwords.financialPassword],
      [manifest.authorizationRole,passwords.authorizationPassword]]) {
      guard(); const result=await bounded(()=>rotate.call(owner,role,password)); guard();
      if(own(result,'acknowledged')!==true) throw null;
    }
    stage='commit'; commit='unknown';
    const ack=await bounded(()=>acknowledge.call(owner)); guard();
    if(own(ack,'acknowledged')!==true) throw null;
    commit='acknowledged';
    stage='owner-close'; await close('owner',owner); guard();
    if(retirement.owner!=='confirmed') throw null;
    stage='financial'; config={target:manifest.target,user:manifest.financialRole,password:passwords.financialPassword};
    financial=await construct('financial',()=>dependencies.createFinancial(config,callback));
    config.password=null; config=null; guard(); ready(financial);
    stage='authorization'; config={target:manifest.target,user:manifest.authorizationRole,password:passwords.authorizationPassword};
    authorization=await construct('authorization',()=>dependencies.createAuthorization(config,callback));
    config.password=null; config=null; guard(); ready(authorization); ready(financial);
    passwords=null;
    stage='case'; guard();
    const result=await bounded(()=>dependencies.runCase(Object.freeze({financial,authorization}),manifest.caseId,callback));
    guard(); ready(financial); ready(authorization);
    const state=own(result,'state');
    caseResult=['pass','refused','unavailable','unknown'].includes(state)?state:'unknown';
    if(caseResult==='unknown') throw null;
  } catch { failed=true; }
  finally {
    passwords=null;
    if(config) config.password=null;
    config=null;
    if(authorization) await close('authorization',authorization);
    if(financial) await close('financial',financial);
    if(owner) await close('owner',owner);
    if(unexpected) failed=true;
    active=false;
  }
  const complete=!failed&&retirement.owner==='confirmed'&&retirement.financial==='confirmed'&&retirement.authorization==='confirmed';
  return Object.freeze({state:complete?'completed':'blocked',stage:complete?'complete':stage,
    commit,caseResult,retirement:Object.freeze({...retirement}),
    localSecrets:'discarded',serverRevocation:'not-performed'});
}
module.exports={runInt3Session};
