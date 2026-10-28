'use strict';
// Offline protocol doubles only. No target, SQL, private input or launcher.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInt3Session } = require('../scripts/settlement-evidence-int3-session');
const secret = 'synthetic-' + 'private-canary-751';
function fixture(fault) {
  const calls = [];
  const manifest = { target: 'synthetic-target', financialRole: 'financial_runtime',
    authorizationRole: 'authorization_runtime', caseId: 'offline-case', rotationApproved: true };
  let unexpected;
  const report = { close: 'confirmed' };
  const step = async (name, value) => {
    calls.push(name);
    if (fault === name) throw new Error(secret);
    if (fault === name + '-timeout') return new Promise(() => {});
    if (fault === name + '-callback') unexpected(secret);
    return value;
  };
  const owner = { rotatePassword: (role, password) => {
    assert.equal(password, secret);
    return step('rotate-' + role, { acknowledged: true });
  }, commit: () => step('commit', { acknowledged: fault !== 'uncertain' }),
  close: () => step('owner-close', { close: fault === 'owner-unconfirmed' ? 'unconfirmed' : 'confirmed' }) };
  const financial = { retire: () => step('financial-retire', report), status: () => ({state:'ready'}) };
  const authorization = { retire: () => step('authorization-retire', report), status: () => ({state:'ready'}) };
  const dependencies = {
    privateInput: () => step('input', { financialPassword: secret, authorizationPassword: secret }),
    openOwner: (_, callback) => { unexpected = callback; return step('owner', owner); },
    createFinancial: config => { assert.equal(config.password, secret); return step('financial', financial); },
    createAuthorization: config => { assert.equal(config.password, secret); return step('authorization', authorization); },
    runCase: sessions => { assert.equal(sessions.financial, financial); assert.equal(sessions.authorization, authorization);
      return step('case', { state: fault === 'case-unknown' ? 'unknown' : 'pass', private: secret }); }
  };
  return { manifest, dependencies, calls, run: () => runInt3Session({manifest, dependencies, timeoutMs: 30}) };
}
test('acknowledged rotation and owner close precede factories and one case; retire both', async () => {
  const f = fixture(); const r = await f.run();
  assert.deepEqual(f.calls, ['input','owner','rotate-financial_runtime','rotate-authorization_runtime',
    'commit','owner-close','financial','authorization','case','authorization-retire','financial-retire']);
  assert.equal(r.state, 'completed'); assert.equal(r.caseResult, 'pass');
  assert.equal(r.retirement.financial, 'confirmed'); assert.equal(r.retirement.authorization, 'confirmed');
  assert.equal(r.serverRevocation, 'not-performed');
});
for (const fault of ['input','owner','rotate-financial_runtime','rotate-authorization_runtime','commit','uncertain',
  'owner-close','owner-unconfirmed','financial','authorization','owner-callback','commit-callback',
  'financial-callback','authorization-callback','input-timeout','owner-timeout','commit-timeout',
  'financial-timeout','authorization-timeout']) {
  test('no case admission: ' + fault, async () => {
    const f = fixture(fault); const r = await f.run();
    assert.equal(r.state, 'blocked'); assert.ok(!f.calls.includes('case'));
    assert.ok(!JSON.stringify(r).includes(secret));
    for (const name of new Set(f.calls)) assert.equal(f.calls.filter(x => x === name).length, 1);
    if (f.calls.includes('financial') && fault.startsWith('authorization')) assert.ok(f.calls.includes('financial-retire'));
    if (fault === 'financial') assert.equal(r.retirement.financial, 'unconfirmed');
    if (fault === 'authorization') assert.equal(r.retirement.authorization, 'unconfirmed');
  });
}
for (const fault of ['case','case-timeout','case-callback','case-unknown','financial-retire','authorization-retire',
  'financial-retire-timeout','authorization-retire-timeout']) {
  test('case failure or retirement uncertainty never completes: ' + fault, async () => {
    const f=fixture(fault); const r=await f.run();
    assert.equal(r.state,'blocked'); assert.ok(f.calls.includes('financial-retire'));
    assert.ok(f.calls.includes('authorization-retire')); assert.ok(!JSON.stringify(r).includes(secret));
  });
}
test('invalid manifest, duplicate roles and arbitrary entrypoints fail before input', async () => {
  for (const change of [{rotationApproved:false},{authorizationRole:'financial_runtime'}, {command:'anything'}, {caseId:'../arbitrary'}]) {
    const f=fixture(); Object.assign(f.manifest,change);
    assert.equal((await f.run()).state,'blocked'); assert.deepEqual(f.calls,[]);
  }
});
test('untrusted factory errors cannot assert retirement through missing/accessor evidence', async () => {
  for (const error of [new Error(secret), Object.defineProperty({},'retirement',{get(){throw new Error(secret);}}),
    {retirement:{close:'not-a-confirmation', private:secret}}]) {
    const f=fixture(); f.dependencies.createFinancial=async()=>{throw error;};
    const r=await f.run(); assert.equal(r.retirement.financial, 'unconfirmed'); assert.ok(!JSON.stringify(r).includes(secret));
  }
});
test('factory rejection preserves only bounded explicit retirement evidence', async () => {
  for(const close of ['confirmed','failed','unconfirmed']) {
    const f=fixture(); f.dependencies.createAuthorization=async()=>{throw {message:secret,retirement:{close,private:secret}};};
    const r=await f.run(); assert.equal(r.retirement.authorization,close);
    assert.equal(r.state,'blocked'); assert.equal(r.retirement.financial,'confirmed');
    assert.ok(!f.calls.includes('case')); assert.ok(!JSON.stringify(r).includes(secret));
  }
});
test('late factory completion is retired once, never admitted or upgraded to confirmed', async () => {
  const f=fixture(); let resolve; let closes=0;
  f.dependencies.createFinancial=()=>new Promise(done=>{resolve=done;});
  const r=await f.run(); assert.equal(r.retirement.financial,'unconfirmed');
  resolve({retire:async()=>{closes++;return {close:'confirmed'};}});
  await new Promise(done=>setImmediate(done));
  assert.equal(closes,1); assert.equal(r.retirement.financial,'unconfirmed');
  assert.ok(!f.calls.includes('case')); assert.ok(!f.calls.includes('authorization'));
});
test('runtime loss before case and malformed case results fail closed', async () => {
  const f=fixture(); f.dependencies.createAuthorization=async()=>({retire:async()=>({close:'confirmed'}),status:()=>({state:'lost'})});
  assert.equal((await f.run()).state,'blocked'); assert.ok(!f.calls.includes('case'));
  for(const value of [null,{}, {state:secret},Object.defineProperty({},'state',{get(){throw new Error(secret);}})]) {
    const g=fixture(); g.dependencies.runCase=async()=>value;
    assert.equal((await g.run()).state,'blocked');
  }
});
test('unexpected callback queued immediately before invocation prevents case admission', async () => {
  const f=fixture(); let count=0;
  f.dependencies.runCase=async()=>{f.calls.push('case');return {state:'pass'};};
  f.dependencies.createFinancial=async (_,callback)=>({retire:async()=>({close:'confirmed'}),status:()=>{
    if(++count===2) queueMicrotask(()=>callback(secret));
    return {state:'ready'};
  }});
  const r=await f.run(); assert.equal(r.state,'blocked'); assert.ok(!f.calls.includes('case'));
});
test('canary never reaches outputs, errors, files, argv or environment', async () => {
  const beforeEnv=JSON.stringify(process.env), beforeArgv=JSON.stringify(process.argv);
  const files=['scripts/settlement-evidence-int3-session.js','test/test.js'];
  const before=files.map(p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8'));
  const writes=[]; const originals=[];
  // Observe the actual sinks rather than trusting returned JSON alone.
  for(const [object,key] of [[fs,'writeFileSync'],[fs,'writeFile'],[fs,'appendFileSync'],
    [fs,'appendFile'],[fs.promises,'writeFile'],[fs.promises,'appendFile'],
    [process.stdout,'write'],[process.stderr,'write']]) {
    const original=object[key]; originals.push(()=>{object[key]=original;});
    object[key]=(...args)=>{writes.push(args);return key==='write'?true:undefined;};
  }
  try {
    for (const fault of [undefined,'commit','financial','authorization','case']) {
      const r=await fixture(fault).run(); assert.ok(!JSON.stringify(r).includes(secret));
    }
  } finally { originals.reverse().forEach(restore=>restore()); }
  assert.deepEqual(writes,[]);
  assert.equal(JSON.stringify(process.env),beforeEnv); assert.equal(JSON.stringify(process.argv),beforeArgv);
  files.forEach((p,i)=>{const after=fs.readFileSync(path.join(__dirname,'..',p),'utf8');
    assert.equal(after,before[i]); assert.ok(!after.includes(secret));});
});
