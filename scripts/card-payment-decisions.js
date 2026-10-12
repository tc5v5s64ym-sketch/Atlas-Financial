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
    if (!state.decisions.length) return { ...data, revision: state.revision };
    const policy = data.plan.cardPurchaseCoverage || { payments: [], refunds: [], reversals: [] };
    policy.payments = [...(policy.payments || []), ...state.decisions.map(decision => ({ ...clone(decision.record),
      confirmed: Store.digest(selectedEvidence(data, decision.record)) === decision.evidenceDigest
        && qualified(source, state, decision.record).status === 'ready' }))];
    data.plan.cardPurchaseCoverage = policy;
    return { ...data, revision: state.revision };
  }
  async function input() { return compose(await evidence.read(), await store.snapshot()); }
  function qualified(source, state, record) {
    // Evidence loss withholds publication, never retires the household's claim.
    const retainedRecords = state.decisions.filter(d => d.record.id !== record.id).map(d => d.record);
    return Forecast.validateCardPaymentDecision({ ...source, record, retainedRecords });
  }
  return { input, async prepare({ session, selection }) {
    try {
      const actor = actorFor(session), state = await store.snapshot(), source = await evidence.read();
      const record = clone(await evidence.resolve(selection, source));
      record.id = Store.opaque('decision-'); record.confirmed = true; Store.recordValid(record);
      const result = qualified(source, state, record);
      if (result.status !== 'ready') return { status: 'unavailable' };
      for (const [key, value] of previews) if (value.expiresAt <= now()) previews.delete(key);
      if (previews.size >= 200) return { status: 'unavailable' };
      const operationId = Store.opaque('operation-'), expiresAt = now() + TTL_MS;
      previews.set(operationId, { actor, record, revision: state.revision, expiresAt,
        digest: Store.digest(source), evidenceDigest: Store.digest(selectedEvidence(source, record)),
        referenceDates: selectedEvidence(source, record).flatMap(part => part.rows.map(tx => tx.date)) });
      return { status: 'prepared', operationId, revision: state.revision, expiresAt,
        allocation: result.allocation };
    } catch { return { status: 'unavailable' }; }
  }, async confirm({ session, operationId }) {
    try {
      const actor = actorFor(session);
      if (!Store.operationValid(operationId)) return { status: 'unavailable' };
      const receipt = await store.outcome({ actor, operationId });
      if (receipt.status !== 'unknown') return receipt;
      const preview = previews.get(operationId);
      if (!preview || preview.actor !== actor) return { status: 'unknown', operationId };
      if (inFlight.has(operationId)) return { status: 'unavailable', operationId };
      inFlight.add(operationId); previews.delete(operationId); // Consume before any awaited validation/write.
      try {
        const source = await evidence.read(), state = await store.snapshot();
        const reason = preview.expiresAt <= now() ? 'preview-expired'
          : Store.digest(source) !== preview.digest ? 'evidence-changed'
          : qualified(source, state, preview.record).status !== 'ready' ? 'validation-unavailable' : null;
        return await store.commit({ actor, operationId, expectedRevision: preview.revision, reason,
          decision: reason ? null : { record: preview.record, actor, recordedAt: new Date(now()).toISOString(),
            evidenceDigest: preview.evidenceDigest, referenceDates: preview.referenceDates } });
      } finally { inFlight.delete(operationId); }
    } catch { return { status: 'unavailable', ...(Store.operationValid(operationId) ? { operationId } : {}) }; }
  }, async outcome({ session, operationId }) {
    try { return await store.outcome({ actor: actorFor(session), operationId }); }
    catch { return { status: 'unavailable' }; }
  } };
}
module.exports = { createController, TTL_MS };
