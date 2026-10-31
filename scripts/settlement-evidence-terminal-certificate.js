'use strict';
// D1(i): INCOMPATIBLE replacement of the unused reservation/second-commit API.
// The incumbent pin-covered financial ledger is the ONLY positive landing.
// This module validates negative history and wraps a real store-owned capability;
// it never reserves, commits elsewhere, provisions history, repairs or retries.
// INJECTED contract: readSnapshot is CURRENT authoritative history+checkpoint,
// not a stale self-consistent cache. compareAndAppend(true) atomically appends
// exactly the supplied validated certificate and advances its matching anchor;
// false appended nothing; throw/malformed is UNKNOWN. No production dependency.
// Addendum A: permanent process registry keys (householdId, ledgerNamespace),
// binding mode and both declared authorities; wrapper identity is not the key.
// Hidden physical aliases, independent registries/old binaries and rollback of
// the checkpoint authority itself remain unqualified production prerequisites.
const C = require('./planned-obligation-settlement-contract');
const HH=/^household-[a-f0-9]{32}$/, OP=/^operation-[a-f0-9]{32}$/, ACT=/^session-[a-f0-9]{64}$/;
const NS=/^ledger-[a-f0-9]{32}$/, AUTH=/^authority-[a-f0-9]{32}$/;
const HASH=/^[a-f0-9]{64}$/, GEN=/^generation-[a-f0-9]{32}$/;
const SCHEMA='terminal-certificate-2';
const reasons=new Set(['preview-expired','selection-changed','assignment-changed','store-conflict','admission-refused']);
const fields=['schema','householdId','ledgerNamespace','operationId','actorId','kind','generation','reason','expectedRevision','expectedDocumentDigest','confirmationDigest','decidedAt'];
const domains=new Map(), surfaces=new WeakMap(), checkpoints=new WeakMap(), serializationDomains=new Map();
const plain=x=>x!==null&&typeof x==='object'&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>plain(x)&&Reflect.ownKeys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function own(x,seen=new Set(),depth=0){
 if(depth>24)throw Error('terminal depth');
 if(x===null||typeof x==='boolean'||typeof x==='string')return x;
 if(typeof x==='number'&&Number.isSafeInteger(x)&&!Object.is(x,-0))return x;
 if((!plain(x)&&!Array.isArray(x))||seen.has(x))throw Error('terminal data');
 seen.add(x);const out=Array.isArray(x)?[]:{};
 for(const k of Reflect.ownKeys(x)){
  if(Array.isArray(x)&&k==='length')continue;
  const d=Object.getOwnPropertyDescriptor(x,k);
  if(typeof k!=='string'||k==='__proto__'||!d.enumerable||!Object.hasOwn(d,'value'))throw Error('terminal descriptor');
  out[k]=own(d.value,seen,depth+1);
 }
 seen.delete(x);return Object.freeze(out);
}
function isCertificate(x){
 return exact(x,fields)&&x.schema===SCHEMA&&HH.test(x.householdId)&&NS.test(x.ledgerNamespace)&&OP.test(x.operationId)&&ACT.test(x.actorId)
  &&['link','withdrawal'].includes(x.kind)&&GEN.test(x.generation)&&reasons.has(x.reason)&&integer(x.expectedRevision)
  &&HASH.test(x.expectedDocumentDigest)&&HASH.test(x.confirmationDigest)&&integer(x.decidedAt)&&x.decidedAt>0;
}
function sameDecision(a,b){return fields.every(k=>k==='decidedAt'||a[k]===b[k]);}
function registerDomain(householdId,input,enabled,refs){
 let domain;
 if(input!==undefined){
  domain=own(input);
  if(!exact(domain,['ledgerNamespace','serializationAuthority','historyAuthority'])||!NS.test(domain.ledgerNamespace)
    ||!AUTH.test(domain.serializationAuthority)||!AUTH.test(domain.historyAuthority))throw TypeError('terminal exclusion domain malformed');
 }
 if(enabled&&!domain)throw TypeError('terminal exclusion domain required');
 const key=domain ? householdId+'|'+domain.ledgerNamespace : null;
 const binding=domain?Object.freeze({...domain,householdId,enabled,key}):null;
 const previous=domain&&domains.get(key);
 const serialized=domain&&serializationDomains.get(domain.serializationAuthority);
 if(serialized&&serialized.enabled!==enabled)throw TypeError('terminal exclusion mixed serialization authority');
 if(previous&&Object.keys(binding).some(k=>previous[k]!==binding[k]))throw TypeError('terminal exclusion domain authority/mode conflict');
 for(const ref of refs){
  const previousSurface=surfaces.get(ref);
  if(previousSurface&&(previousSurface.enabled!==enabled||(previousSurface.key&&previousSurface.key!==key)))throw TypeError('terminal exclusion mixed/aliased domain');
 }
 const registered=previous||binding;
 if(domain&&!previous)domains.set(key,registered);
 if(domain&&!serialized)serializationDomains.set(domain.serializationAuthority,registered);
 for(const ref of refs)surfaces.set(ref,registered||{enabled:false});
 return registered;
}
function qualifySnapshot(raw,domain){
 // Read all supplied values through own data descriptors; never invoke getters.
 if(!exact(raw,['historyBytes','checkpoint']))throw Error('terminal snapshot');
 const b=Object.getOwnPropertyDescriptor(raw,'historyBytes'),a=Object.getOwnPropertyDescriptor(raw,'checkpoint');
 if(!b||!a||!Object.hasOwn(b,'value')||!Object.hasOwn(a,'value')||!(Buffer.isBuffer(b.value)||b.value instanceof Uint8Array))throw Error('terminal bytes');
 const bytes=Buffer.from(b.value),checkpoint=own(a.value),history=own(JSON.parse(bytes.toString('utf8')));
 if(!exact(checkpoint,['schema','householdId','ledgerNamespace','revision','digest'])||checkpoint.schema!=='terminal-history-checkpoint-1'
  ||!exact(history,['schema','householdId','ledgerNamespace','revision','records','digest'])||history.schema!=='terminal-history-1'
  ||history.householdId!==domain.householdId||history.ledgerNamespace!==domain.ledgerNamespace||checkpoint.householdId!==domain.householdId
  ||checkpoint.ledgerNamespace!==domain.ledgerNamespace||!integer(history.revision)||!Array.isArray(history.records)||history.revision!==history.records.length
  ||checkpoint.revision!==history.revision||checkpoint.digest!==history.digest||!HASH.test(history.digest))throw Error('terminal identity/anchor');
 const {digest,...payload}=history;
 if(C.digest(payload)!==digest)throw Error('terminal digest');
 const ids=new Set();
 for(const r of history.records){
  if(!isCertificate(r)||r.householdId!==domain.householdId||r.ledgerNamespace!==domain.ledgerNamespace||ids.has(r.operationId))throw Error('terminal record');
  ids.add(r.operationId);
 }
 const floor=checkpoints.get(domain);
 if(floor){
  if(checkpoint.revision<floor.revision)throw Error('terminal rollback');
  const prefix={schema:history.schema,householdId:history.householdId,ledgerNamespace:history.ledgerNamespace,
    revision:floor.revision,records:history.records.slice(0,floor.revision)};
  if(C.digest(prefix)!==floor.digest)throw Error('terminal history prefix changed');
 }
 checkpoints.set(domain,checkpoint);
 return {history,checkpoint};
}
const unknown=operationId=>({status:'unknown',operationId:typeof operationId==='string'?operationId:null});
function createTerminalCertificateProtocol(deps={}){
 if(!plain(deps))deps={};
 const cap=deps.store,hh=deps.householdId,ns=deps.ledgerNamespace;
 const connected=HH.test(hh)&&NS.test(ns)&&cap?.householdId===hh&&cap?.ledgerNamespace===ns
   &&typeof cap.sealNegative==='function'&&typeof cap.lookupCertificate==='function';
 async function sealNegative(input,options={}){
  let request,authorize;
  try{
   request=own(input);
   if(!plain(options)||Reflect.ownKeys(options).some(k=>k!=='authorize'))return unknown(request?.preview?.operationId);
   const descriptor=Object.getOwnPropertyDescriptor(options,'authorize');
   if(descriptor){
    if(!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='function')return unknown(request?.preview?.operationId);
    authorize=descriptor.value;
   }
  }catch{return unknown();}
  const id=request?.preview?.operationId;
  if(!connected)return unknown(id);
  let result;try{result=own(await cap.sealNegative(request));}catch{return unknown(id);}
  if(result.status!=='certified')return unknown(id);
  const c=result.certificate;
  if(!exact(result,['status','operationId','certificate'])||result.operationId!==id||!isCertificate(c)||c.householdId!==hh||c.ledgerNamespace!==ns
   ||c.operationId!==id||c.actorId!==request.actorId||c.generation!==request.generation||c.kind!==request.kind||c.reason!==request.reason
   ||c.confirmationDigest!==request.confirmationDigest||c.expectedRevision!==request.preview.expectedRevision||c.expectedDocumentDigest!==request.preview.expectedDocumentDigest)return unknown(id);
  if(authorize!==undefined){
   let ok=false;try{ok=(await authorize(c))===true;}catch{}
   if(!ok)return {status:'suppressed',operationId:id};
  }
  return result;
 }
 async function lookupCertificate(operationId,actorId,options={}){
  if(!connected||!OP.test(operationId)||!ACT.test(actorId))return unknown(operationId);
  let request,result;try{
   const opts=own(options);
   if(!plain(opts)||Object.keys(opts).some(k=>k!=='generation'))return unknown(operationId);
   request=own({operationId,actorId,...(opts.generation===undefined?{}:{generation:opts.generation})});
   result=own(await cap.lookupCertificate(request));
  }catch{return unknown(operationId);}
  if(!exact(result,['status','operationId','generation'])||result.status!=='not-applied'||result.operationId!==operationId||!GEN.test(result.generation)
    ||(request.generation!==undefined&&request.generation!==result.generation))return unknown(operationId);
  return result;
 }
 return Object.freeze({connected,sealNegative,lookupCertificate});
}
module.exports={createTerminalCertificateProtocol,TERMINAL_CERTIFICATE_SCHEMA:SCHEMA,own,isCertificate,sameDecision,registerDomain,qualifySnapshot};
