'use strict';
// FOUNDATION - OFFLINE interface only. No default adapter, I/O or launcher.
// A future reviewed caller supplies trusted capabilities and an exact approval;
// shape validation is not target authority or proof of actual provider behavior.
// One instance owns ONE attempt for its entire lifetime. Keep it across caller
// retries. Creating a new instance/process is not reconciliation or retry
// authority: a future live caller must preserve the single-writer attempt record.
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');

const REQUEST = ['attemptId', 'kind', 'target', 'source', 'checkpoint', 'recoveryUnit', 'evidenceDestination'];
const LIMITS = ['maxSubmissions', 'maxObservations', 'maxReconciliations', 'timeoutMs', 'totalMs'];
function data(value, keys) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw null;
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length !== keys.length || !keys.every(key =>
    Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value'))) throw null;
  return Object.fromEntries(keys.map(key => [key, fields[key].value]));
}
function token(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/.test(value)) throw null;
  return value;
}
// Identities are opaque commitments, never provider text. This is attribution,
// not encryption or a claim that low-entropy identifiers cannot be guessed.
function digest(value) { return 'sha256:' + createHash('sha256').update(value).digest('hex'); }

function createProviderOperation(options) {
  let approval, adapter, binding = null, publicBinding = {}, operationId = null;
  let status = 'refused', reason = 'invalid-configuration', attempted = false, busy = false;
  let observations = 0, reconciliations = 0, deadline = 0;
  const evidence = [];
  try {
    const input = data(options, ['approval', 'adapter']);
    approval = data(input.approval, [...REQUEST, ...LIMITS]);
    adapter = data(input.adapter, ['submit', 'observe', 'reconcile']);
    if (!Object.values(adapter).every(fn => typeof fn === 'function')) throw null;
    for (const key of REQUEST) token(approval[key]);
    if (!['backup', 'restore'].includes(approval.kind) || approval.maxSubmissions !== 1) throw null;
    for (const key of ['maxObservations', 'maxReconciliations']) {
      if (!Number.isInteger(approval[key]) || approval[key] < 0 || approval[key] > 100) throw null;
    }
    if (!Number.isInteger(approval.timeoutMs) || approval.timeoutMs < 1 || approval.timeoutMs > 10000 ||
      !Number.isInteger(approval.totalMs) || approval.totalMs < approval.timeoutMs || approval.totalMs > 600000) throw null;
    binding = Object.freeze(Object.fromEntries(REQUEST.map(key => [key, approval[key]])));
    approval = Object.freeze(approval); adapter = Object.freeze(adapter);
    publicBinding = Object.fromEntries(REQUEST.map(key => [key, key === 'kind' ? binding[key] : digest(binding[key])]));
    reason = 'not-submitted';
  } catch { binding = null; approval = null; adapter = null; }

  function snapshot() {
    return Object.freeze({ schema: 'settlement-int3-provider-operation-1', ...publicBinding,
      operationId: operationId === null ? null : digest(operationId), status, reason,
      submission: attempted ? 'attempted' : 'not-attempted',
      observations, reconciliations, evidence: Object.freeze([...evidence]),
      applicationQualification: 'not-assessed', caseResult: 'not-scored', qualified: false });
  }
  function record(phase, providerEvidenceId = null) {
    evidence.push(Object.freeze({ sequence: evidence.length + 1, phase, ...publicBinding,
      operationId: operationId === null ? null : digest(operationId), status, reason,
      providerEvidenceId: providerEvidenceId === null ? null : digest(providerEvidenceId),
      provenance: providerEvidenceId === null ? 'lifecycle-observation' : 'injected-adapter-claim' }));
  }
  async function bounded(invoke) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw null;
    const allowance = Math.min(approval.timeoutMs, remaining), end = performance.now() + allowance;
    let timer;
    try {
      const result = await Promise.race([Promise.resolve().then(invoke),
        new Promise((_, reject) => { timer = setTimeout(() => reject(null), allowance); })]);
      if (performance.now() >= end) throw null;
      return result;
    } finally { clearTimeout(timer); }
  }
  function response(value) {
    const result = data(value, ['operationId', 'status', 'attemptId', 'kind', 'target', 'source', 'checkpoint', 'recoveryUnit', 'evidence']);
    token(result.operationId);
    if (!['accepted', 'pending', 'completed', 'unknown'].includes(result.status)) throw null;
    for (const key of ['attemptId', 'kind', 'target', 'source', 'checkpoint', 'recoveryUnit']) {
      if (result[key] !== binding[key]) throw null;
    }
    if (operationId !== null && result.operationId !== operationId) throw null;
    const proof = data(result.evidence, ['id', 'kind']); token(proof.id);
    if (proof.kind !== 'provider-record') throw null;
    return { operationId: result.operationId, status: result.status, evidenceId: proof.id };
  }
  function accept(result, submission = false) {
    operationId = result.operationId;
    // Uncertainty is sticky until an attributable, bound completion is observed.
    // Neither a pending report nor a later submit response authorizes replay.
    if (submission || status !== 'unknown' || result.status === 'completed') status = result.status;
    reason = status === 'unknown' ? 'outcome-uncertain' : 'provider-reported';
  }
  async function submit(request) {
    if (!binding || attempted || busy) return snapshot();
    busy = true;
    try {
      const captured = data(request, REQUEST);
      if (!REQUEST.every(key => captured[key] === binding[key])) throw null;
    } catch { status = 'refused'; reason = 'request-mismatch'; busy = false; return snapshot(); }
    // Consume synchronously, before even scheduling the injected submission.
    // Errors, ambiguous replies, timeouts and reentrant callers cannot replay.
    attempted = true; busy = true; deadline = performance.now() + approval.totalMs;
    status = 'unknown'; reason = 'submission-in-flight';
    try {
      const result = response(await bounded(() => adapter.submit(binding)));
      accept(result, true); record('submission', result.evidenceId);
    } catch { status = 'unknown'; reason = 'outcome-uncertain'; record('submission'); }
    finally { busy = false; }
    return snapshot();
  }
  async function read(phase) {
    if (!binding || !attempted || busy || status === 'completed') return snapshot();
    const observing = phase === 'observation';
    if ((observing ? observations >= approval.maxObservations : reconciliations >= approval.maxReconciliations) ||
      performance.now() >= deadline) {
      status = 'unknown'; reason = 'budget-exhausted'; return snapshot();
    }
    if (observing) observations++; else reconciliations++;
    busy = true;
    try {
      // Only these separately injected read capabilities are exposed. No generic
      // command, rollback, cancellation, resubmit or write callback is provided.
      const query = Object.freeze({ ...binding, operationId, readOnly: true });
      const result = response(await bounded(() => observing ? adapter.observe(query) : adapter.reconcile(query)));
      accept(result); record(phase, result.evidenceId);
    } catch { status = 'unknown'; reason = 'outcome-uncertain'; record(phase); }
    finally { busy = false; }
    return snapshot();
  }
  return Object.freeze({ submit, observe: () => read('observation'), reconcile: () => read('reconciliation'), snapshot });
}
module.exports = { createProviderOperation };
