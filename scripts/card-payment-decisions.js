'use strict';
// FOUNDATION only: adapters are explicit; no routes, env, provider client or production importer.
const Store = require('./card-payment-decision-store');
const Forecast = require('../public/forecast');
const TTL_MS = 10 * 60 * 1000;
const clone = value => JSON.parse(JSON.stringify(value));
function references(record) {
  return [record.debitRef, record.creditRef, ...record.allocations.map(part => part.purchaseRef)];
}
function selectedEvidence(evidence, record) {
  return references(record).sort().map(ref => ({ ref, rows: (evidence.packet?.transactions || [])
    .filter(tx => tx?.coverageRef === ref).map(({ id, ...row }) => row) }));
}
function createController({ store, evidence, sessions, now = Date.now }) {
  const previews = new Map(), inFlight = new Set();
  const actorFor = session => {
    const actor = sessions.actor(session);
    if (!Store.actorValid(actor)) throw new Error('card-decision-unavailable');
    return actor;
  };
  function compose(source, state) {
    const data = clone(source);
    const decisions = Store.effectiveDecisions(state);
    if (!decisions.length) return { ...data, revision: state.revision };
    const policy = data.plan.cardPurchaseCoverage || { payments: [], refunds: [], reversals: [] };
    policy.payments = [...(policy.payments || []), ...decisions.map(decision => ({ ...clone(decision.record),
      confirmed: Store.digest(selectedEvidence(data, decision.record)) === decision.evidenceDigest
        && qualified(source, state, decision.record).status === 'ready' }))];
    data.plan.cardPurchaseCoverage = policy;
    return { ...data, revision: state.revision };
  }
  async function input() { return compose(await evidence.read(), await store.snapshot()); }
  function qualified(source, state, record, replacedId = null) {
    // Evidence loss withholds publication, never retires the household's claim.
    const retainedRecords = Store.effectiveDecisions(state)
      .filter(d => d.record.id !== record.id && d.record.id !== replacedId).map(d => d.record);
    return Forecast.validateCardPaymentDecision({ ...source, record, retainedRecords });
  }
  return { input, async prepare({ session, selection, command = { version: 1, kind: 'append', targetId: null } }) {
    try {
      const actor = actorFor(session), state = await store.snapshot(), source = await evidence.read();
      if (state.schema !== Store.SCHEMA) return { status: 'unavailable' }; // Explicit migration only.
      command = clone(command); Store.commandValid(command);
      const target = Store.operationTarget(state, command);
      if (command.kind !== 'append' && !target) return { status: 'unavailable' };
      let record = null;
      if (command.kind !== 'retract') {
        record = clone(await evidence.resolve(selection, source));
        record.id = Store.opaque('decision-'); record.confirmed = true; Store.recordValid(record);
        if (target && (record.creditRef !== target.record.creditRef || record.debitRef !== target.record.debitRef)) return { status: 'unavailable' };
        if (command.kind === 'append' && state.decisions.some(d => d.record.creditRef === record.creditRef)) return { status: 'unavailable' };
      }
      const result = record ? qualified(source, state, record, command.targetId) : { status: 'ready' };
      if (result.status !== 'ready') return { status: 'unavailable' };
      for (const [key, value] of previews) if (value.expiresAt <= now()) previews.delete(key);
      if (previews.size >= 200) return { status: 'unavailable' };
      const operationId = Store.opaque('operation-'), expiresAt = now() + TTL_MS;
      previews.set(operationId, { actor, record, command, revision: state.revision, expiresAt,
        digest: Store.digest(source), evidenceDigest: record && Store.digest(selectedEvidence(source, record)),
        referenceDates: record && selectedEvidence(source, record).flatMap(part => part.rows.map(tx => tx.date)) });
      return { status: 'prepared', operationId, revision: state.revision, expiresAt,
        operation: { version: command.version, kind: command.kind }, ...(record ? { allocation: result.allocation } : {}) };
    } catch { return { status: 'unavailable' }; }
  }, async confirm({ session, operationId }) {
    try {
      const actor = actorFor(session);
      if (!Store.operationValid(operationId)) return { status: 'unavailable' };
      const receipt = await store.outcome({ actor, operationId });
      if (receipt.status !== 'unknown') { previews.delete(operationId); return receipt; }
      const preview = previews.get(operationId);
      if (!preview || preview.actor !== actor) return { status: 'unknown', operationId };
      if (inFlight.has(operationId)) return { status: 'unavailable', operationId };
      inFlight.add(operationId); // Keep the exact preview after an uncertain/pre-commit failure.
      try {
        const source = await evidence.read(), state = await store.snapshot();
        const reason = preview.expiresAt <= now() ? 'preview-expired'
          : Store.digest(source) !== preview.digest ? 'evidence-changed'
          : preview.command.kind !== 'append' && !Store.operationTarget(state, preview.command) ? 'target-changed'
          : preview.record && qualified(source, state, preview.record, preview.command.targetId).status !== 'ready' ? 'validation-unavailable' : null;
        preview.recordedAt ||= new Date(now()).toISOString();
        const result = await store.commit({ actor, operationId, expectedRevision: preview.revision, reason, command: preview.command,
          decision: reason || !preview.record ? null : { record: preview.record, actor, recordedAt: preview.recordedAt,
            evidenceDigest: preview.evidenceDigest, referenceDates: preview.referenceDates } });
        if (['confirmed', 'rejected', 'conflict'].includes(result.status)) previews.delete(operationId);
        return result;
      } finally { inFlight.delete(operationId); }
    } catch { return { status: 'unavailable', ...(Store.operationValid(operationId) ? { operationId } : {}) }; }
  }, async outcome({ session, operationId }) {
    try { return await store.outcome({ actor: actorFor(session), operationId }); }
    catch { return { status: 'unavailable' }; }
  } };
}
module.exports = { createController, TTL_MS };
