'use strict';
// Synthetic protocol tests only: no concrete provider, target or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createProviderOperation } = require('../scripts/settlement-evidence-int3-provider-operation');
const canary = 'synthetic-' + 'private-canary-751';
function fixture(budget = {}) {
  const calls = [];
  const request = { attemptId: 'attempt-1', kind: 'restore', target: 'target-1',
    source: 'source-1', checkpoint: 'checkpoint-1', recoveryUnit: 'unit-1', evidenceDestination: 'evidence-1' };
  const approval = { ...request, maxSubmissions: 1, maxObservations: 2, maxReconciliations: 1,
    timeoutMs: 1000, totalMs: 5000, ...budget };
  const response = (status = 'accepted', operationId = 'operation-1') => ({
    status, operationId, attemptId: request.attemptId, kind: request.kind, target: request.target, source: request.source,
    checkpoint: request.checkpoint, recoveryUnit: request.recoveryUnit,
    evidence: { id: 'receipt-1', kind: 'provider-record' }
  });
  const adapter = {
    submit: async input => { calls.push(['submit', input]); return response(); },
    observe: async input => { calls.push(['observe', input]); return response('pending'); },
    reconcile: async input => { calls.push(['reconcile', input]); return response('completed'); }
  };
  const lifecycle = () => createProviderOperation({ approval, adapter });
  return { request, approval, adapter, calls, response, lifecycle };
}
function privateSafe(value) {
  const json = JSON.stringify(value);
  assert.ok(!json.includes(canary));
  assert.ok(!json.includes('"operation-1"'));
  assert.ok(!json.includes('target-1'));
  assert.ok(!json.includes('receipt-1'));
  assert.equal(value.applicationQualification, 'not-assessed');
  assert.equal(value.caseResult, 'not-scored');
  assert.equal(value.qualified, false);
  assert.ok(Object.isFrozen(value));
}

test('one bound submission, read-only observation and reconciliation produce attributable evidence', async () => {
  const f = fixture(), op = f.lifecycle();
  const accepted = await op.submit(f.request);
  assert.equal(accepted.status, 'accepted'); assert.equal(accepted.submission, 'attempted');
  assert.match(accepted.operationId, /^sha256:[a-f0-9]{64}$/);
  assert.equal((await op.observe()).status, 'pending');
  const completed = await op.reconcile(); assert.equal(completed.status, 'completed');
  assert.deepEqual(f.calls.map(x => x[0]), ['submit', 'observe', 'reconcile']);
  assert.deepEqual(f.calls[0][1], f.request);
  assert.equal(f.calls[1][1].operationId, 'operation-1');
  assert.equal(f.calls[1][1].readOnly, true); assert.equal(f.calls[2][1].readOnly, true);
  assert.equal(completed.evidence.length, 3);
  assert.deepEqual(completed.evidence.map(x => x.phase), ['submission', 'observation', 'reconciliation']);
  for (const [i, event] of completed.evidence.entries()) {
    assert.equal(event.sequence, i + 1); assert.equal(event.attemptId, completed.attemptId);
    assert.equal(event.target, completed.target); assert.equal(event.source, completed.source);
    assert.equal(event.checkpoint, completed.checkpoint); assert.equal(event.recoveryUnit, completed.recoveryUnit);
    assert.equal(event.evidenceDestination, completed.evidenceDestination);
    assert.match(event.providerEvidenceId, /^sha256:[a-f0-9]{64}$/); assert.ok(Object.isFrozen(event));
  }
  privateSafe(accepted); privateSafe(completed);
  await op.submit(f.request); await op.observe(); await op.reconcile();
  assert.equal(f.calls.length, 3); assert.equal(op.snapshot().status, 'completed');
});

test('wrong target, source, checkpoint, recovery scope, operation and evidence destination refuse before submit', async () => {
  for (const key of Object.keys(fixture().request)) {
    const f = fixture(), op = f.lifecycle(); f.request[key] = 'wrong';
    const result = await op.submit(f.request);
    assert.equal(result.status, 'refused'); assert.equal(result.submission, 'not-attempted');
    assert.deepEqual(f.calls, []); privateSafe(result);
  }
});

test('invalid approval/budgets/dependencies and hostile schemas never throw or call provider', async () => {
  const variants = [null, {}, { maxSubmissions: 2 }, { maxObservations: -1 }, { maxObservations: 101 },
    { maxReconciliations: Infinity }, { timeoutMs: 0 }, { timeoutMs: 10001 }, { totalMs: 600001 },
    { totalMs: 1 }, { kind: 'arbitrary-command' }, { target: '' }, { checkpoint: null }, { extra: canary }];
  for (const variant of variants) {
    const f = fixture(); const approval = variant === null ? null : { ...f.approval, ...variant };
    if (variant && !Object.keys(variant).length) continue;
    const op = createProviderOperation({ approval, adapter: f.adapter });
    const result = await op.submit(f.request); assert.equal(result.status, 'refused');
    privateSafe(result); assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  for (const value of [null, {}, new Proxy({}, { ownKeys() { throw new Error(canary); } }),
    Object.defineProperty({}, 'approval', { get() { throw new Error(canary); } })]) {
    const op = createProviderOperation(value); privateSafe(await op.submit(f.request));
  }
  for (const input of [null, { ...f.request, extra: canary },
    Object.defineProperty({ ...f.request }, 'target', { get() { throw new Error(canary); } })]) {
    const op = f.lifecycle(); assert.equal((await op.submit(input)).status, 'refused');
  }
  assert.deepEqual(f.calls, []);
});

test('ambiguous submission consumes slot; concurrent/late responses cannot resubmit or change evidence', async () => {
  const f = fixture({ timeoutMs: 20, totalMs: 1000 }); let resolve;
  f.adapter.submit = input => { f.calls.push(['submit', input]); return new Promise(done => { resolve = done; }); };
  const op = f.lifecycle(); const pending = op.submit(f.request);
  await op.submit(f.request); await op.observe(); await op.reconcile();
  const result = await pending; assert.equal(result.status, 'unknown');
  await op.submit(f.request); assert.equal(f.calls.length, 1);
  resolve(f.response('completed')); await new Promise(done => setImmediate(done));
  assert.deepEqual(op.snapshot(), result);
  const reconciled = await op.reconcile(); assert.equal(reconciled.status, 'completed');
  assert.equal(f.calls[1][1].operationId, null); assert.equal(f.calls[1][1].attemptId, f.request.attemptId);
  assert.equal(f.calls.filter(x => x[0] === 'submit').length, 1); privateSafe(reconciled);
});

test('thrown, rejected, malformed and cross-bound provider submission responses are unknown and sanitized', async () => {
  for (const response of [null, {}, { operationId: null }, { status: 'refused' },
    { status: canary }, { attemptId: 'other-attempt' }, { kind: 'backup' }, { target: 'other-target' }, { source: 'other-source' },
    { checkpoint: 'other-checkpoint' }, { recoveryUnit: 'other-unit' }, { operationId: '' },
    { evidence: null }, { extra: canary },
    Object.defineProperty({}, 'status', { get() { throw new Error(canary); } }),
    new Proxy({}, { getPrototypeOf() { throw new Error(canary); } })]) {
    const f = fixture(); f.adapter.submit = async () => response && Object.keys(response).length && Object.getPrototypeOf(response) === Object.prototype
      ? { ...f.response(), ...response } : response;
    const op = f.lifecycle(); const result = await op.submit(f.request);
    assert.equal(result.status, 'unknown'); privateSafe(result);
    assert.equal((await op.submit(f.request)).status, 'unknown');
  }
  for (const fault of [() => { throw new Error(canary); }, async () => { throw { message: canary, stack: canary }; }]) {
    const f = fixture(); f.adapter.submit = fault;
    const result = await f.lifecycle().submit(f.request); assert.equal(result.status, 'unknown'); privateSafe(result);
  }
});

test('read budgets cap all observations/reconciliations, preserve unknown and never roll back', async () => {
  const f = fixture(); let count = 0;
  f.adapter.observe = async input => { f.calls.push(['observe', input]);
    if (++count === 1) throw new Error(canary); return f.response('pending'); };
  f.adapter.reconcile = async input => { f.calls.push(['reconcile', input]); return f.response('unknown'); };
  const op = f.lifecycle(); await op.observe(); await op.reconcile();
  assert.deepEqual(f.calls, []); await op.submit(f.request);
  assert.equal((await op.observe()).status, 'unknown');
  assert.equal((await op.observe()).status, 'unknown');
  for (let n = 0; n < 10; n++) { await op.observe(); await op.reconcile(); await op.submit(f.request); }
  assert.deepEqual(f.calls.map(x => x[0]), ['submit', 'observe', 'observe', 'reconcile']);
  assert.equal(op.snapshot().status, 'unknown'); assert.equal(op.snapshot().evidence.length, 4);
  privateSafe(op.snapshot());
});

test('read response must retain operation identity and complete binding, even when claiming completed', async () => {
  for (const change of [{ operationId: 'another-operation' }, { attemptId: 'other-attempt' }, { kind: 'backup' }, { target: 'wrong' }, { source: 'wrong' },
    { checkpoint: 'wrong' }, { recoveryUnit: 'wrong' }, { evidence: {} }, { extra: canary }]) {
    const f = fixture();
    f.adapter.observe = async () => ({ ...f.response('completed'), ...change });
    const op = f.lifecycle(); await op.submit(f.request);
    const result = await op.observe(); assert.equal(result.status, 'unknown'); privateSafe(result);
  }
});

test('total time budget and per-call timeout bound reads, no late completion upgrades', async () => {
  const f = fixture({ timeoutMs: 20, totalMs: 40 });
  let resolve; f.adapter.observe = () => { f.calls.push(['observe']); return new Promise(done => { resolve = done; }); };
  const op = f.lifecycle(); await op.submit(f.request);
  assert.equal((await op.observe()).status, 'unknown');
  await new Promise(done => setTimeout(done, 50));
  const result = await op.reconcile(); assert.equal(result.status, 'unknown'); assert.equal(f.calls.length, 2);
  resolve(f.response('completed')); await new Promise(done => setImmediate(done));
  assert.deepEqual(op.snapshot(), result);
});

test('capture immutable approval, request and adapter methods; snapshots cannot rewrite lifecycle', async () => {
  const f = fixture(), op = f.lifecycle();
  f.approval.target = 'wrong'; f.adapter.submit = () => { throw new Error(canary); };
  const r = await op.submit(f.request); assert.equal(r.status, 'accepted');
  f.request.target = 'wrong'; assert.equal(f.calls[0][1].target, 'target-1');
  assert.ok(Object.isFrozen(f.calls[0][1])); assert.ok(Object.isFrozen(r.evidence));
  assert.throws(() => { r.evidence[0].status = 'completed'; }, TypeError);
  assert.equal(op.snapshot().status, 'accepted');
});

test('reentrant request inspection and adapter invocation cannot submit twice; in-flight is unknown', async () => {
  const f = fixture(); let op; const nested = [];
  f.adapter.submit = input => { f.calls.push(['submit', input]); nested.push(op.submit(f.request));
    assert.equal(op.snapshot().status, 'unknown'); return f.response(); };
  op = f.lifecycle();
  const request = new Proxy(f.request, { getPrototypeOf(target) {
    nested.push(op.submit(f.request)); return Object.getPrototypeOf(target);
  } });
  assert.equal((await op.submit(request)).status, 'accepted'); await Promise.all(nested);
  assert.equal(f.calls.length, 1);
});

test('completed and unknown submissions are distinct; zero read budget never implies completion', async () => {
  for (const status of ['completed', 'unknown', 'pending']) {
    const f = fixture({ maxObservations: 0, maxReconciliations: 0 });
    f.adapter.submit = async input => { f.calls.push(['submit', input]); return f.response(status); };
    const op = f.lifecycle(); const result = await op.submit(f.request);
    assert.equal(result.status, status); privateSafe(result);
    await op.observe(); await op.reconcile(); await op.submit(f.request);
    assert.equal(f.calls.length, 1);
    assert.equal(op.snapshot().status, status === 'completed' ? 'completed' : 'unknown');
  }
});

test('all malformed read shapes and raw read errors remain unknown without throwing', async () => {
  for (const method of ['observe', 'reconcile']) {
    for (const value of [null, {}, new Error(canary), { status: canary },
      Object.defineProperty({}, 'status', { get() { throw new Error(canary); } }),
      new Proxy({}, { ownKeys() { throw new Error(canary); } })]) {
      const f = fixture(); f.adapter[method] = async () => value;
      const op = f.lifecycle(); await op.submit(f.request);
      const result = await op[method](); assert.equal(result.status, 'unknown'); privateSafe(result);
    }
  }
});

test('unknown identity/evidence strings and error payloads never reach output sinks or ambient state', async () => {
  const beforeEnv = JSON.stringify(process.env), beforeArgv = JSON.stringify(process.argv);
  const writes = [], restores = [];
  for (const [object, key] of [[fs, 'writeFileSync'], [fs, 'writeFile'], [fs, 'appendFileSync'],
    [fs, 'appendFile'], [fs.promises, 'writeFile'], [fs.promises, 'appendFile'],
    [process.stdout, 'write'], [process.stderr, 'write']]) {
    const original = object[key]; restores.push(() => { object[key] = original; });
    object[key] = (...args) => { writes.push(args); return key === 'write' ? true : undefined; };
  }
  try {
    const f = fixture(); f.approval.target = f.request.target = canary;
    f.adapter.submit = async () => ({ ...f.response('completed', canary), evidence: { id: canary, kind: 'provider-record' } });
    const result = await f.lifecycle().submit(f.request); assert.equal(result.status, 'completed'); privateSafe(result);
    const g = fixture(); g.adapter.submit = () => { throw new Error(canary); };
    privateSafe(await g.lifecycle().submit(g.request));
  } finally { restores.reverse().forEach(restore => restore()); }
  assert.deepEqual(writes, []); assert.equal(JSON.stringify(process.env), beforeEnv);
  assert.equal(JSON.stringify(process.argv), beforeArgv);
});
