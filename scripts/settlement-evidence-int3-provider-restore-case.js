'use strict';
// RQ8 provider backup/restore SCENARIO - OFFLINE build only (#751 section D).
// Composes the merged B provider-operation lifecycle; it never calls the
// provider transport itself and adds no adapter, command, resource or I/O.
// A future, expressly admitted INT-3/INT-5 case caller supplies the concrete B
// adapter and read-only capabilities. Here every capability is injected, so a
// complete scenario is evidence completeness only: the live proof stays
// unexecuted and nothing produced here is provider or application qualification.
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { createProviderOperation } = require('./settlement-evidence-int3-provider-operation');

const PLAN = ['schema', 'caseId', 'attemptId', 'target', 'evidenceDestination', 'source', 'recoveryUnits',
  'affectedAnchors', 'preconditions', 'dependentChecks', 'budget'];
const BUDGET = ['maxObservations', 'maxReconciliations', 'timeoutMs', 'totalMs'];
const IDENTITY = ['operationId', 'mechanism', 'target', 'source', 'checkpoint', 'recoveryUnits', 'evidence'];
const OUTCOMES = ['pass', 'fail', 'refused', 'unavailable', 'unknown', 'unexecuted'];
// Only a provider-native backup restored by the provider mechanism is in scope.
// File copies, doubles, local snapshots and dumps are never provider restore.
const SOURCE_KIND = 'provider-backup', MECHANISM = 'provider-restore';

function data(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || !keys.every(key =>
    Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value'))) throw null;
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
function list(value, item) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw null;
  const fields = Object.getOwnPropertyDescriptors(value), n = fields.length.value;
  if (!Number.isInteger(n) || n > 1000 || Reflect.ownKeys(fields).length !== n + 1) throw null;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!Object.hasOwn(fields, String(i)) || !Object.hasOwn(fields[String(i)], 'value')) throw null;
    out.push(item(fields[String(i)].value));
  }
  return out;
}
function token(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value)) throw null;
  return value;
}
function unique(values) { if (new Set(values).size !== values.length) throw null; return values; }
function hex(value) { return createHash('sha256').update(value).digest('hex'); }
function digest(value) { return 'sha256:' + hex(value); }
function units(value) {
  const parsed = list(value, u => { const x = data(u, ['id', 'anchors']);
    return { id: token(x.id), anchors: unique(list(x.anchors, token)).sort() }; });
  if (!parsed.length) throw null;
  unique(parsed.map(u => u.id)); unique(parsed.flatMap(u => u.anchors));
  return parsed.sort((a, b) => (a.id < b.id ? -1 : 1));
}
// The B recovery-unit token commits to every actual unit AND its anchors.
function commitment(sorted) { return 'units-' + hex(JSON.stringify(sorted.map(u => [u.id, u.anchors]))); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function createProviderRestoreCase(options) {
  let plan = null, reads = null, operation = null, sorted = null, binding = null, invalid = true;
  try {
    const input = data(options, ['plan', 'adapter', 'reads']);
    const p = data(input.plan, PLAN);
    if (p.schema !== 'settlement-int3-provider-restore-case-plan-1') throw null;
    for (const key of ['caseId', 'attemptId', 'target', 'evidenceDestination']) token(p[key]);
    const source = data(p.source, ['id', 'kind', 'checkpoint']);
    token(source.id); token(source.kind); token(source.checkpoint);
    sorted = units(p.recoveryUnits);
    const affected = unique(list(p.affectedAnchors, token));
    if (!affected.length) throw null;
    const pre = data(p.preconditions, ['quiescence', 'closure', 'controls']);
    const gate = v => { const x = data(v, ['status', 'evidenceId']); token(x.status); token(x.evidenceId); return x; };
    const controls = list(pre.controls, c => { const x = data(c, ['id', 'provenance', 'evidenceId']);
      token(x.id); token(x.provenance); token(x.evidenceId); return x; });
    unique(controls.map(c => c.id));
    const checks = unique(list(p.dependentChecks, token));
    if (!checks.length) throw null;
    const budget = data(p.budget, BUDGET);
    reads = Object.freeze(data(input.reads, ['identity', 'dependents']));
    if (!Object.values(reads).every(fn => typeof fn === 'function')) throw null;
    plan = { ...p, source, affected, checks, budget, quiescence: gate(pre.quiescence), closure: gate(pre.closure), controls };
    binding = commitment(sorted);
    const request = { attemptId: p.attemptId, kind: 'restore', target: p.target, source: source.id,
      checkpoint: source.checkpoint, recoveryUnit: binding, evidenceDestination: p.evidenceDestination };
    // B validates the adapter and budget; an invalid configuration refuses here.
    operation = createProviderOperation({ approval: { ...request, maxSubmissions: 1, ...budget }, adapter: input.adapter });
    if (operation.snapshot().reason === 'invalid-configuration') throw null;
    plan.request = Object.freeze(request);
    invalid = false;
  } catch { plan = null; reads = null; operation = null; binding = null; }

  let status = invalid ? 'invalid' : 'planned', reason = invalid ? 'invalid-configuration' : 'not-run';
  let identity = null, dependents = null, opSnapshot = null, running = null, final = null;
  const phases = [];
  const phase = (name, outcome) => phases.push(Object.freeze({ sequence: phases.length + 1, phase: name, outcome }));

  function snapshot() {
    if (final) return final;
    return deepFreeze({ schema: 'settlement-int3-provider-restore-case-1',
      caseId: plan ? digest(plan.caseId) : null, status, reason,
      evidenceClass: opSnapshot ? 'injected-adapter-claim' : 'none',
      recoveryUnitBinding: binding ? digest(binding) : null,
      preconditions: plan ? { quiescence: digest(plan.quiescence.evidenceId), closure: digest(plan.closure.evidenceId),
        controls: plan.controls.map(c => digest(c.evidenceId)) } : null,
      operation: opSnapshot, postOperationIdentity: identity, dependents, phases: [...phases],
      qualified: false, liveProof: 'unexecuted', providerQualification: 'not-qualified', caseResult: 'not-scored' });
  }
  function end(s, r) { status = s; reason = r; final = snapshot(); return final; }
  // Each read has its own monotonic deadline, fixed before the capability runs.
  // A result observed at/after it is overdue even if blocking work delayed the timer.
  async function bounded(invoke) {
    const deadline = performance.now() + plan.budget.timeoutMs;
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(invoke),
        new Promise((_, reject) => { timer = setTimeout(() => reject(null), plan.budget.timeoutMs); })]);
      if (performance.now() >= deadline) throw null;
      return result;
    } finally { clearTimeout(timer); }
  }

  async function scenario() {
    if (invalid) return end('invalid', 'invalid-configuration');
    // 1. Plan: provider-native source and full anchor binding, before anything else.
    if (plan.source.kind !== SOURCE_KIND) { phase('plan', 'refused'); return end('refused', 'not-provider-restore'); }
    const bound = new Set(sorted.flatMap(u => u.anchors));
    if (!plan.affected.every(a => bound.has(a))) { phase('plan', 'refused'); return end('refused', 'anchor-not-bound'); }
    phase('plan', 'bound');
    // 2. Preconditions: quiescence, closure and independent controls; else NOT_READY.
    const missing = plan.quiescence.status !== 'confirmed' ? 'quiescence-unconfirmed'
      : plan.closure.status !== 'confirmed' ? 'closure-unconfirmed'
        : !plan.controls.length ? 'controls-missing'
          : !plan.controls.every(c => c.provenance === 'independent') ? 'control-not-independent' : null;
    if (missing) { phase('preconditions', 'not-ready'); return end('not-ready', missing); }
    phase('preconditions', 'confirmed');
    // 3. Operation through B only: one submission, bounded read-only follow-up.
    let s = await operation.submit({ ...plan.request });
    for (let i = 0; i < plan.budget.maxObservations && s.status !== 'completed'; i++) s = await operation.observe();
    for (let i = 0; i < plan.budget.maxReconciliations && s.status !== 'completed'; i++) s = await operation.reconcile();
    opSnapshot = operation.snapshot();
    if (opSnapshot.status !== 'completed') { phase('operation', opSnapshot.status); return end('operation-unconfirmed', opSnapshot.reason); }
    phase('operation', 'completed');
    // 4. Post-operation identity: actual mechanism, operation, source, target and units.
    try {
      const query = deepFreeze({ target: plan.target, source: plan.source.id, checkpoint: plan.source.checkpoint,
        recoveryUnits: sorted.map(u => ({ id: u.id, anchors: [...u.anchors] })), readOnly: true });
      const r = data(await bounded(() => reads.identity(query)), IDENTITY);
      token(r.operationId); token(r.mechanism);
      const proof = data(r.evidence, ['id', 'kind']); token(proof.id);
      if (proof.kind !== 'post-operation-identity') throw null;
      if (r.mechanism !== MECHANISM) {
        identity = { status: 'not-provider-restore', operationId: null, evidenceId: digest(proof.id) };
        phase('post-operation-identity', 'not-provider-restore'); return end('refused', 'not-provider-restore');
      }
      if (digest(r.operationId) !== opSnapshot.operationId || r.target !== plan.target || r.source !== plan.source.id ||
        r.checkpoint !== plan.source.checkpoint || commitment(units(r.recoveryUnits)) !== binding) throw null;
      identity = { status: 'matched', operationId: digest(r.operationId), evidenceId: digest(proof.id) };
    } catch {
      identity = { status: 'unverified', operationId: null, evidenceId: null };
      phase('post-operation-identity', 'unverified'); return end('identity-unverified', 'post-operation-identity-unverified');
    }
    phase('post-operation-identity', 'matched');
    // 5. Dependent RQ outcomes: exactly the required checks, each kept individually.
    try {
      const query = deepFreeze({ checks: [...plan.checks], operationId: opSnapshot.operationId, readOnly: true });
      const rows = list(await bounded(() => reads.dependents(query)), row => {
        const x = data(row, ['check', 'outcome', 'evidenceId']); token(x.check); token(x.evidenceId);
        if (!OUTCOMES.includes(x.outcome)) throw null; return x; });
      unique(rows.map(x => x.check));
      if (rows.length !== plan.checks.length || !rows.every(x => plan.checks.includes(x.check))) throw null;
      dependents = plan.checks.map(check => { const x = rows.find(row => row.check === check);
        return { check: digest(check), outcome: x.outcome, evidenceId: digest(x.evidenceId) }; });
    } catch {
      dependents = null; phase('dependent-outcomes', 'incomplete');
      return end('evidence-incomplete', 'dependent-outcomes-incomplete');
    }
    phase('dependent-outcomes', 'recorded');
    return end('evidence-complete', 'offline-evidence-complete-unqualified');
  }
  // One instance owns one scenario: repeated or concurrent runs share it.
  function run() { if (!running) running = scenario().catch(() => end('invalid', 'internal-refusal')); return running; }
  return Object.freeze({ run, snapshot });
}
module.exports = { createProviderRestoreCase };
