'use strict';
// Synthetic scenario tests only: fake adapters and fake read capabilities.
// No concrete provider, target, credentials, live restore or spend. A complete
// offline scenario is evidence completeness, never provider qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createProviderRestoreCase } = require('../scripts/settlement-evidence-int3-provider-restore-case');
const canary = 'synthetic-' + 'private-canary-rq8';
const SHA = /^sha256:[a-f0-9]{64}$/;

function fixture(overrides = {}) {
  const calls = [];
  const plan = {
    schema: 'settlement-int3-provider-restore-case-plan-1',
    caseId: 'rq8-case-1', attemptId: 'attempt-rq8-1', target: 'target-rq8', evidenceDestination: 'evidence-rq8',
    source: { id: 'backup-rq8', kind: 'provider-backup', checkpoint: 'checkpoint-rq8' },
    recoveryUnits: [{ id: 'unit-ledger', anchors: ['anchor-ledger-head', 'anchor-history-head'] },
      { id: 'unit-auth', anchors: ['anchor-auth-head'] }],
    affectedAnchors: ['anchor-ledger-head', 'anchor-auth-head'],
    preconditions: {
      quiescence: { status: 'confirmed', evidenceId: 'quiet-1' },
      closure: { status: 'confirmed', evidenceId: 'closed-1' },
      controls: [{ id: 'control-a', provenance: 'independent', evidenceId: 'control-ev-a' }]
    },
    dependentChecks: ['rq4-latest', 'rq6-anchor'],
    budget: { maxObservations: 2, maxReconciliations: 1, timeoutMs: 1000, totalMs: 5000 },
    ...overrides.plan
  };
  let operationId = 'provider-op-1';
  const reply = (input, status) => ({ operationId, status, attemptId: input.attemptId, kind: input.kind,
    target: input.target, source: input.source, checkpoint: input.checkpoint, recoveryUnit: input.recoveryUnit,
    evidence: { id: 'receipt-' + status, kind: 'provider-record' } });
  const adapter = {
    submit: async input => { calls.push(['submit', input]); return reply(input, 'accepted'); },
    observe: async input => { calls.push(['observe', input]); return reply(input, 'pending'); },
    reconcile: async input => { calls.push(['reconcile', input]); return reply(input, 'completed'); },
    ...overrides.adapter
  };
  const identityReply = () => ({ operationId, mechanism: 'provider-restore', target: plan.target,
    source: plan.source.id, checkpoint: plan.source.checkpoint,
    recoveryUnits: plan.recoveryUnits.map(u => ({ id: u.id, anchors: [...u.anchors] })),
    evidence: { id: 'identity-ev-1', kind: 'post-operation-identity' } });
  const reads = {
    identity: async query => { calls.push(['identity', query]); return identityReply(); },
    dependents: async query => { calls.push(['dependents', query]);
      return query.checks.map((check, i) => ({ check, outcome: i ? 'fail' : 'pass', evidenceId: 'dep-ev-' + i })); },
    ...overrides.reads
  };
  const make = () => createProviderRestoreCase({ plan, adapter, reads });
  return { plan, adapter, reads, calls, make, identityReply, setOperationId: v => { operationId = v; } };
}
function invariant(result) {
  assert.equal(result.schema, 'settlement-int3-provider-restore-case-1');
  assert.equal(result.qualified, false);
  assert.equal(result.liveProof, 'unexecuted');
  assert.equal(result.providerQualification, 'not-qualified');
  assert.equal(result.caseResult, 'not-scored');
  const json = JSON.stringify(result);
  for (const raw of [canary, 'target-rq8', 'backup-rq8', 'checkpoint-rq8', 'provider-op-1', 'anchor-ledger-head',
    'unit-ledger', 'receipt-', 'identity-ev-1', 'dep-ev-', 'quiet-1', 'control-ev-a', 'rq8-case-1', 'evidence-rq8']) {
    assert.ok(!json.includes(raw), 'raw identifier leaked: ' + raw);
  }
  const deep = v => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(deep); } };
  deep(result);
}

test('complete offline scenario runs in order, composes B and stays unqualified', async () => {
  const f = fixture(), c = f.make();
  const result = await c.run();
  assert.equal(result.status, 'evidence-complete');
  assert.equal(result.evidenceClass, 'injected-adapter-claim');
  assert.deepEqual(f.calls.map(x => x[0]), ['submit', 'observe', 'observe', 'reconcile', 'identity', 'dependents']);
  assert.deepEqual(result.phases.map(p => p.phase),
    ['plan', 'preconditions', 'operation', 'post-operation-identity', 'dependent-outcomes']);
  assert.equal(result.operation.schema, 'settlement-int3-provider-operation-1');
  assert.equal(result.operation.status, 'completed');
  assert.equal(result.operation.kind, 'restore');
  assert.equal(result.operation.qualified, false);
  assert.match(result.operation.operationId, SHA);
  assert.equal(result.postOperationIdentity.status, 'matched');
  assert.equal(result.postOperationIdentity.operationId, result.operation.operationId);
  assert.match(result.postOperationIdentity.evidenceId, SHA);
  assert.match(result.recoveryUnitBinding, SHA);
  assert.deepEqual(result.dependents.map(d => [d.outcome]), [['pass'], ['fail']]);
  for (const d of result.dependents) { assert.match(d.check, SHA); assert.match(d.evidenceId, SHA); }
  // B receives the bound recovery-unit commitment, never the raw unit list.
  const submitted = f.calls[0][1];
  assert.equal(submitted.kind, 'restore'); assert.equal(submitted.source, 'backup-rq8');
  assert.equal(submitted.checkpoint, 'checkpoint-rq8'); assert.match(submitted.recoveryUnit, /^units-[a-f0-9]{64}$/);
  assert.equal(f.calls[4][1].readOnly, true); assert.equal(f.calls[5][1].readOnly, true);
  invariant(result);
  assert.deepEqual(await c.run(), result); assert.equal(f.calls.length, 6, 'single use: no replay');
});

test('composes the merged B module and does not duplicate its transport', () => {
  const src = fs.readFileSync(path.join(__dirname, '../scripts/settlement-evidence-int3-provider-restore-case.js'), 'utf8');
  assert.match(src, /require\('\.\/settlement-evidence-int3-provider-operation'\)/);
  assert.match(src, /createProviderOperation\(/);
  assert.ok(!/adapter\.(submit|observe|reconcile)\s*\(/.test(src), 'D must not call the provider adapter directly');
  assert.ok(!/require\('(node:)?(child_process|fs|net|http|https|dgram|pg)'\)/.test(src), 'no I/O surface');
});

test('file-copy, double, snapshot-file and other non-provider sources are refused before any call', async () => {
  for (const kind of ['file-copy', 'double', 'fake', 'local-snapshot', 'synthetic', 'logical-dump']) {
    const f = fixture({ plan: { source: { id: 'backup-rq8', kind, checkpoint: 'checkpoint-rq8' } } });
    const result = await f.make().run();
    assert.equal(result.status, 'refused'); assert.equal(result.reason, 'not-provider-restore');
    assert.deepEqual(f.calls, []); invariant(result);
  }
});

test('a completed operation whose post-operation mechanism is a file copy or double is rejected', async () => {
  for (const mechanism of ['file-copy', 'double', 'manual-copy']) {
    const f = fixture({ reads: { identity: async () => { f.calls.push(['identity']); return { ...f.identityReply(), mechanism }; } } });
    const result = await f.make().run();
    assert.equal(result.status, 'refused'); assert.equal(result.reason, 'not-provider-restore');
    assert.equal(result.postOperationIdentity.status, 'not-provider-restore');
    assert.ok(!f.calls.some(x => x[0] === 'dependents')); assert.equal(result.dependents, null); invariant(result);
  }
});

test('every affected anchor must be bound to an actual recovery unit; the binding covers anchors', async () => {
  const f = fixture({ plan: { affectedAnchors: ['anchor-ledger-head', 'anchor-unbound'] } });
  const result = await f.make().run();
  assert.equal(result.status, 'refused'); assert.equal(result.reason, 'anchor-not-bound');
  assert.deepEqual(f.calls, []); invariant(result);
  const a = await fixture().make().run();
  const b = await fixture({ plan: { recoveryUnits: [{ id: 'unit-ledger', anchors: ['anchor-ledger-head'] },
    { id: 'unit-auth', anchors: ['anchor-auth-head'] }] } }).make().run();
  assert.notEqual(a.recoveryUnitBinding, b.recoveryUnitBinding);
  const reordered = await fixture({ plan: { recoveryUnits: [{ id: 'unit-auth', anchors: ['anchor-auth-head'] },
    { id: 'unit-ledger', anchors: ['anchor-history-head', 'anchor-ledger-head'] }] } }).make().run();
  assert.equal(reordered.recoveryUnitBinding, a.recoveryUnitBinding);
  for (const units of [[], [{ id: 'unit-a', anchors: [] }, { id: 'unit-a', anchors: ['anchor-auth-head'] }],
    [{ id: 'unit-a', anchors: ['anchor-auth-head', 'anchor-auth-head'] }]]) {
    const g = fixture({ plan: { recoveryUnits: units, affectedAnchors: ['anchor-auth-head'] } });
    assert.equal((await g.make().run()).status, 'invalid'); assert.deepEqual(g.calls, []);
  }
});

test('missing quiescence, closure or independent controls is NOT_READY with no submission', async () => {
  const base = fixture().plan.preconditions;
  const cases = [
    ['quiescence-unconfirmed', { ...base, quiescence: { status: 'unconfirmed', evidenceId: 'quiet-1' } }],
    ['closure-unconfirmed', { ...base, closure: { status: 'missing', evidenceId: 'closed-1' } }],
    ['controls-missing', { ...base, controls: [] }],
    ['control-not-independent', { ...base, controls: [{ id: 'control-a', provenance: 'provider-record', evidenceId: 'x-1' }] }]
  ];
  for (const [reason, preconditions] of cases) {
    const f = fixture({ plan: { preconditions } });
    const result = await f.make().run();
    assert.equal(result.status, 'not-ready'); assert.equal(result.reason, reason);
    assert.equal(result.operation, null); assert.deepEqual(f.calls, []); invariant(result);
  }
});

test('uncertain or unfinished operations stop before identity and dependents, without resubmission', async () => {
  const variants = {
    throws: { submit: async () => { throw new Error(canary); } },
    hangs: { submit: () => new Promise(() => {}) },
    ambiguous: { submit: async () => ({ status: 'completed' }) },
    pending: { observe: async input => ({ operationId: 'provider-op-1', status: 'pending', attemptId: input.attemptId,
      kind: input.kind, target: input.target, source: input.source, checkpoint: input.checkpoint,
      recoveryUnit: input.recoveryUnit, evidence: { id: 'receipt-p', kind: 'provider-record' } }) },
    wrongTarget: { observe: async input => ({ operationId: 'provider-op-1', status: 'completed', attemptId: input.attemptId,
      kind: input.kind, target: 'other-target', source: input.source, checkpoint: input.checkpoint,
      recoveryUnit: input.recoveryUnit, evidence: { id: 'receipt-w', kind: 'provider-record' } }) }
  };
  for (const [name, adapter] of Object.entries(variants)) {
    const counted = { submit: 0 };
    const f = fixture({ adapter, plan: { budget: { maxObservations: 1, maxReconciliations: 0, timeoutMs: 20, totalMs: 200 } } });
    const wrapped = f.adapter.submit;
    f.adapter.submit = (...a) => { counted.submit++; return wrapped(...a); };
    const result = await f.make().run();
    assert.equal(result.status, 'operation-unconfirmed', name);
    assert.notEqual(result.operation.status, 'completed', name);
    assert.equal(counted.submit, 1, name);
    assert.ok(!f.calls.some(x => x[0] === 'identity' || x[0] === 'dependents'), name);
    assert.equal(result.postOperationIdentity, null); assert.equal(result.dependents, null);
    invariant(result);
  }
});

test('post-operation identity must be read and must match operation, source, target and units', async () => {
  const mutate = {
    missing: async () => undefined,
    throws: async () => { throw new Error(canary); },
    otherOperation: async () => ({ ...fixture().identityReply(), operationId: 'provider-op-2' }),
    otherSource: async () => ({ ...fixture().identityReply(), source: 'backup-other' }),
    otherTarget: async () => ({ ...fixture().identityReply(), target: 'target-other' }),
    otherCheckpoint: async () => ({ ...fixture().identityReply(), checkpoint: 'checkpoint-other' }),
    droppedAnchor: async () => ({ ...fixture().identityReply(),
      recoveryUnits: [{ id: 'unit-ledger', anchors: ['anchor-ledger-head'] }, { id: 'unit-auth', anchors: ['anchor-auth-head'] }] }),
    providerRecordKind: async () => ({ ...fixture().identityReply(), evidence: { id: 'identity-ev-1', kind: 'provider-record' } }),
    extraKey: async () => ({ ...fixture().identityReply(), note: canary })
  };
  for (const [name, identity] of Object.entries(mutate)) {
    const f = fixture({ reads: { identity } });
    const result = await f.make().run();
    assert.equal(result.status, 'identity-unverified', name);
    assert.equal(result.postOperationIdentity.status, 'unverified', name);
    assert.ok(!f.calls.some(x => x[0] === 'dependents'), name); invariant(result);
  }
});

test('dependent outcomes are required exactly and preserved individually, never aggregated to PASS', async () => {
  const bad = {
    missing: async q => q.checks.slice(1).map(check => ({ check, outcome: 'pass', evidenceId: 'dep-ev-x' })),
    extra: async q => [...q.checks, 'rq9-extra'].map(check => ({ check, outcome: 'pass', evidenceId: 'dep-ev-x' })),
    duplicate: async q => [q.checks[0], q.checks[0]].map(check => ({ check, outcome: 'pass', evidenceId: 'dep-ev-x' })),
    invalidOutcome: async q => q.checks.map(check => ({ check, outcome: 'qualified', evidenceId: 'dep-ev-x' })),
    noEvidence: async q => q.checks.map(check => ({ check, outcome: 'pass' })),
    throws: async () => { throw new Error(canary); }
  };
  for (const [name, dependents] of Object.entries(bad)) {
    const f = fixture({ reads: { dependents } });
    const result = await f.make().run();
    assert.equal(result.status, 'evidence-incomplete', name); assert.equal(result.dependents, null, name); invariant(result);
  }
  const outcomes = ['refused', 'unavailable', 'unknown', 'unexecuted'];
  const f = fixture({ plan: { dependentChecks: ['c-1', 'c-2', 'c-3', 'c-4'] },
    reads: { dependents: async q => q.checks.map((check, i) => ({ check, outcome: outcomes[i], evidenceId: 'dep-ev-' + i })) } });
  const result = await f.make().run();
  assert.equal(result.status, 'evidence-complete');
  assert.deepEqual(result.dependents.map(d => d.outcome), outcomes);
  assert.equal(result.qualified, false); invariant(result);
});

test('invalid or hostile configuration never throws and never calls a capability', async () => {
  const f0 = fixture();
  const plans = [null, {}, { ...f0.plan, schema: 'other' }, { ...f0.plan, qualified: true },
    { ...f0.plan, liveProof: 'executed' }, { ...f0.plan, target: '' }, { ...f0.plan, dependentChecks: [] },
    { ...f0.plan, affectedAnchors: [] }, { ...f0.plan, budget: { ...f0.plan.budget, maxSubmissions: 2 } },
    { ...f0.plan, budget: { ...f0.plan.budget, totalMs: 1 } }, { ...f0.plan, caseId: canary + ' bad' }];
  const getter = { ...f0.plan }; Object.defineProperty(getter, 'target', { get() { throw new Error(canary); }, enumerable: true });
  plans.push(getter);
  for (const plan of plans) {
    const f = fixture(); const c = createProviderRestoreCase({ plan, adapter: f.adapter, reads: f.reads });
    const result = await c.run();
    assert.equal(result.status, 'invalid'); assert.deepEqual(f.calls, []); invariant(result);
  }
  for (const options of [undefined, null, { plan: f0.plan, adapter: f0.adapter }, { plan: f0.plan, adapter: {}, reads: f0.reads },
    { plan: f0.plan, adapter: f0.adapter, reads: { identity: 1, dependents: f0.reads.dependents } }]) {
    const result = await createProviderRestoreCase(options).run();
    assert.equal(result.status, 'invalid'); invariant(result);
  }
});

test('concurrent run calls share one scenario and one submission', async () => {
  const f = fixture(), c = f.make();
  const [a, b] = await Promise.all([c.run(), c.run()]);
  assert.deepEqual(a, b); assert.equal(f.calls.filter(x => x[0] === 'submit').length, 1);
  assert.equal(c.snapshot().status, 'evidence-complete');
});

// Synchronous work that blocks the event loop past timeoutMs lets the read's
// promise settle before the timer callback runs; the result is still overdue.
function blockFor(ms) { const until = Date.now() + ms; while (Date.now() < until) { /* synthetic overrun */ } }
const tight = { budget: { maxObservations: 2, maxReconciliations: 1, timeoutMs: 10, totalMs: 5000 } };

test('an identity read that blocks past its deadline is rejected and dependents never run', async () => {
  const f = fixture({ plan: tight });
  f.reads.identity = async query => { f.calls.push(['identity', query]); blockFor(60); return f.identityReply(); };
  const c = f.make();
  const result = await c.run();
  assert.equal(result.status, 'identity-unverified');
  assert.equal(result.reason, 'post-operation-identity-unverified');
  assert.deepEqual(result.postOperationIdentity, { status: 'unverified', operationId: null, evidenceId: null });
  assert.equal(result.dependents, null);
  assert.ok(f.calls.some(x => x[0] === 'identity'));
  assert.ok(!f.calls.some(x => x[0] === 'dependents'), 'dependents must not be invoked after an overdue identity');
  assert.equal(f.calls.filter(x => x[0] === 'submit').length, 1);
  assert.equal(c.snapshot(), result); assert.equal(await c.run(), result);
  invariant(result);
});

test('a dependent read that blocks past its deadline is rejected with no accepted rows', async () => {
  const f = fixture({ plan: tight });
  f.reads.dependents = async query => { f.calls.push(['dependents', query]); blockFor(60);
    return query.checks.map((check, i) => ({ check, outcome: i ? 'fail' : 'pass', evidenceId: 'dep-ev-' + i })); };
  const c = f.make();
  const result = await c.run();
  assert.equal(result.status, 'evidence-incomplete');
  assert.equal(result.reason, 'dependent-outcomes-incomplete');
  assert.equal(result.postOperationIdentity.status, 'matched');
  assert.equal(result.dependents, null);
  assert.equal(f.calls.filter(x => x[0] === 'submit').length, 1);
  assert.equal(c.snapshot(), result); assert.equal(await c.run(), result);
  invariant(result);
});

test('timely reads under a tight budget still complete, and hung reads still time out', async () => {
  const ok = await fixture({ plan: tight }).make().run();
  assert.equal(ok.status, 'evidence-complete'); invariant(ok);
  const hungIdentity = fixture({ plan: tight });
  hungIdentity.reads.identity = () => new Promise(() => {});
  const a = await hungIdentity.make().run();
  assert.equal(a.status, 'identity-unverified'); assert.ok(!hungIdentity.calls.some(x => x[0] === 'dependents')); invariant(a);
  const hungDependents = fixture({ plan: tight });
  hungDependents.reads.dependents = () => new Promise(() => {});
  const b = await hungDependents.make().run();
  assert.equal(b.status, 'evidence-incomplete'); assert.equal(b.dependents, null); invariant(b);
});
