'use strict';

// ATLAS-080 FOUNDATION — NOT COMPLETION. Strictly synthetic, unimported
// prepare/confirm/outcome caller boundary. No route, provider client, default
// identity, cookie interpretation, production resolver, identity hashing,
// key/registry, environment access or bootstrap is supplied here, and no
// production recovery wiring either: the settled-uncertainty recovery below
// (P2) is a private no-argument capability handed only to a trusted
// construction-time registration callback; it is never a caller-facing
// reset, takes no caller proof, and clears a latched uncertainty only on
// the store's read-only inspection proof plus store readiness.
//
// Trusted injection contract:
// - householdId binds the injected, unchanged store to ONE household;
// - authorize(ownedContext) returns {householdId, actorId}, with a currently
//   authorized, contract-valid SESSION actor. An expiry-only cookie is not an
//   actor. This module never turns a cookie, subject or caller ID into one;
// - resolveSelection({authority, selection, classify}) uniquely resolves the
//   current posted CAD debit and current plan commitment. Its immutable
//   identity is (householdId, 'lunchmoney', providerAccountId, transactionId).
//   Its txRef MUST remain stable for that tuple across content changes and
//   restarts; neither tx-N nor pc-* is a contract reference. selectionBinding
//   privately binds the selected row: the authoritative transaction AND the
//   classification context (the current authoritative plan and the
//   current-period packet as of asOf) under which its classification verdict
//   was produced; goalBinding binds the current authoritative plan goal and
//   the relevant current goal/plan context, and asOf is the authoritative
//   financial date. Changed binding, evidence, goal or asOf requires a new
//   explicitly prepared operation.
//   Only synthetic deterministic fixture mappings implement this contract yet;
// - classify is a controller-owned closure, fresh per resolve. It stays open
//   until the controller's own continuation of the awaited resolveSelection
//   call runs (its finally, after it acquires the owned selection snapshot),
//   NOT at the exact instant the resolver's value or Promise fulfils: work
//   the resolver queues as a microtask ahead of that continuation still
//   lands inside the window and is counted. The resolver MUST invoke it exactly once,
//   with the canonical transaction it resolved, the current authoritative
//   plan, and opts including the current-period packet as of selection.asOf,
//   and MUST NOT return any verdict field of its own: the controller uses
//   only the verdict its own closure obtains from Forecast, projected
//   immediately to {kind, categoryId, householdSpending, reason,
//   needsConfirmation}. Zero invocations, a second invocation, a classifier
//   error (even one the resolver catches and swallows), a malformed or
//   impossible verdict each fail the attempt as a protocol failure; no code
//   path reads a supplied verdict. An invocation after closure throws and
//   records nothing, so it cannot mutate accepted state (a retained preview,
//   a later attempt or a durable receipt); it does not retroactively undo an
//   attempt that already completed. The controller does NOT independently verify that
//   the resolver's transaction is the one its identity names, or that its
//   plan is genuinely the authoritative plan: that mapping is the
//   resolver's contract, exactly as it already is for the identity tuple
//   and the evidence sextuple.
// - Admission (Rule E foundation qualification — NOT live enforcement: no
//   production resolver exists yet): a selection is admitted only when
//   Forecast's verdict is a genuine spend (kind 'spend', householdSpending
//   true, needsConfirmation false, a non-empty categoryId, reason null).
//   transfer, card-payment and internal-movement verdicts are refused
//   rejected('selection-ineligible') before any store call; bill and every
//   other class without established settlement policy are refused
//   unavailable('selection-eligibility-unresolved') — unresolved, never
//   permanent ineligibility. The projection rides inside the retained
//   selection only: confirm re-derives it through the same closure and the
//   existing deep compare refuses classification drift as
//   selection-changed. The verdict is never persisted and never enters the
//   command or any digest, so admitted commands and receipts are
//   byte-identical to before Rule E, and a recorded operation's original
//   receipt is always read before any re-resolution or re-classification.
// - Write admission (optional trusted pair, selected whole at
//   construction): when the composition supplies BOTH a paired resolver
//   capability (resolvePairedSelection) and the store's admission
//   capability (commitAdmitted), the controller runs fenced for its whole
//   lifetime. Each resolve returns the ordinary selection plus the
//   freshness witness paired with that exact acquisition; prepare
//   discards its witness, and confirm carries the witness paired with
//   its FRESH confirm-time resolution — never prepare's older
//   acquisition — through the existing probe and authorization waits
//   into commitAdmitted. Exactly one capability (or a non-function
//   value) refuses construction; a fenced controller never falls back to
//   commitWithoutRecovery and an unfenced controller never touches the
//   admission capability. A definite admission refusal from the store
//   retires the attempted preview and clears the uncertainty latch
//   through the same postauthorization discipline as the other
//   definitive outcomes; if postauthorization itself fails, the P2
//   behaviour above is preserved. The witness is never snapshotted,
//   compared, persisted, serialized or exposed on any public shape, and
//   no caller input can supply one. This fences only the process-local
//   admission boundary under the trusted current-context-reader
//   contract: no atomicity with external writers, unobserved provider
//   changes or session revocation is claimed.
// - store is bound above and MUST supply commitWithoutRecovery; ordinary
//   commit is never a fallback. now is the injected clock.
// Context and requests are plain JSON data, snapshotted before any await.
// operationId is a caller correlation token, never authority or a minted ID.
//
// Only the exact private store preview/digest may reach commit. The store
// owns ledger math, conservation, revision/CAS, expiry and durable receipts.
// Each retained operation permits at most one commit invocation, including
// concurrent callers. An unknown result is never retried here; the private
// recovery capability never resubmits a commit either — on exact
// not-committed proof it retires the attempted entry, and fresh work needs
// a fresh prepare and an explicit confirm.
// A subsequent explicit outcome/confirm may READ an original durable receipt,
// even after preview expiry, later commits or restart. A restarted controller
// has no uncommitted previews. Household effects are read independently through
// the existing loader; receipt ownership does not hide those effects.
// Preview capacity is active work, never a lifetime quota: expired entries
// without an attempted write and definitive no-write outcomes are reclaimed;
// attempted/in-flight/unknown entries survive TTL until a durable receipt is
// verified. Each generation receives an independent random 256-bit token,
// returned only with the sanitized preview. The token is neither identity nor
// the store confirmation digest and is never persisted or sent to the store.
// Authorization and selection qualification are observations. The store lock
// does not atomically lock provider data or session revocation.

const { isDeepStrictEqual } = require('node:util');
const crypto = require('node:crypto');
const C = require('./planned-obligation-settlement-contract');
const Forecast = require('../public/forecast.js');

const HOUSEHOLD = /^household-[a-f0-9]{32}$/;
const ACTOR = /^session-[a-f0-9]{64}$/;
const OPERATION = /^operation-[a-f0-9]{32}$/;
const TRANSACTION = /^tx-[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_PREVIEWS = 200;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
function shape(value, required, optional = []) {
  return record(value) && required.every(k => Object.hasOwn(value, k))
    && Object.keys(value).every(k => required.includes(k) || optional.includes(k));
}
function fail() { throw new Error('settlement-confirmation-unavailable'); }
function date(value) {
  if (!matches(/^\d{4}-\d{2}-\d{2}$/, value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
const privateToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048;
const unavailable = reason => Object.freeze({ status: 'unavailable', reason });
const rejected = reason => Object.freeze({ status: 'rejected', reason });
const unknown = operationId => Object.freeze({ status: 'unknown', operationId });

// No toJSON, accessors, exotic prototypes or shared foreign references. A
// snapshot is owned AND recursively frozen before another dependency can run.
function snapshot(value, seen = new Set(), depth = 0) {
  if (depth > 20) fail();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (value.length > 8192) fail(); return value; }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    return value;
  }
  if ((!record(value) && !Array.isArray(value)) || seen.has(value)) fail();
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string')) fail();
  const result = Array.isArray(value) ? [] : {};
  for (const [key, property] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!property.enumerable || !Object.hasOwn(property, 'value') || key === '__proto__') fail();
    result[key] = snapshot(property.value, seen, depth + 1);
  }
  seen.delete(value);
  return Object.freeze(result);
}

// Rule E verdict handling. The raw Forecast verdict is never carried: it
// is projected immediately, inside the classify closure, to this bounded
// owned shape (an internal-movement verdict, for example, also carries a
// float amount the snapshot discipline rejects). needsConfirmation is
// normalized raw === true: genuine verdicts either carry a boolean or omit
// the field entirely.
function projectVerdict(raw) {
  if (!record(raw)) fail();
  const projection = { kind: raw.kind, categoryId: raw.categoryId,
    householdSpending: raw.householdSpending, reason: raw.reason,
    needsConfirmation: raw.needsConfirmation === true };
  if (typeof projection.kind !== 'string' || projection.kind.length === 0
    || typeof projection.householdSpending !== 'boolean'
    || !(projection.categoryId === null || typeof projection.categoryId === 'string')
    || !(projection.reason === null || typeof projection.reason === 'string')) fail();
  // Impossible combinations the genuine classifier never emits. A called
  // verdict in one of these shapes means a broken resolver or a changed
  // Forecast shape: a protocol failure, never an eligibility answer.
  if (projection.kind === 'spend' && (projection.householdSpending !== true
    || projection.needsConfirmation !== false || projection.reason !== null
    || typeof projection.categoryId !== 'string' || projection.categoryId.length === 0)) fail();
  if (projection.kind === 'transfer' && projection.householdSpending === true) fail();
  if (projection.kind === 'unclassified' && projection.categoryId === 'uncategorised'
    && projection.needsConfirmation !== true) fail();
  // The classifier's 'missing' verdict means the resolver classified no
  // transaction at all: a protocol failure, not a verdict about a selection.
  if (projection.kind === 'unclassified' && projection.reason === 'missing') fail();
  return Object.freeze(projection);
}
function eligibleVerdict(projection) {
  return projection.kind === 'spend' && projection.householdSpending === true
    && projection.needsConfirmation === false && projection.reason === null
    && typeof projection.categoryId === 'string' && projection.categoryId.length > 0;
}
function admissionFor(projection) {
  if (eligibleVerdict(projection)) return 'admitted';
  if (projection.kind === 'transfer' || projection.kind === 'card-payment'
    || projection.kind === 'internal-movement') return 'ineligible';
  return 'unresolved';
}

function validSelection(value) {
  return shape(value, ['transaction', 'commitment'])
    && matches(/^selection-[a-f0-9]{32}$/, value.transaction)
    && matches(/^choice-[a-f0-9]{32}$/, value.commitment);
}
function qualified(value, authority) {
  if (!shape(value, ['matchCount', 'identity', 'txRef', 'selectionBinding',
    'goalId', 'goalBinding', 'asOf', 'evidence']) || value.matchCount !== 1) fail();
  const { identity, evidence } = value;
  if (!shape(identity, ['householdId', 'source', 'providerAccountId', 'transactionId'])
    || identity.householdId !== authority.householdId || identity.source !== 'lunchmoney'
    || !privateToken(identity.providerAccountId) || !privateToken(identity.transactionId)
    || !matches(TRANSACTION, value.txRef) || !privateToken(value.selectionBinding)
    || !privateToken(value.goalBinding) || typeof value.goalId !== 'string'
    || !value.goalId.startsWith('commitment:')
    || !matches(IDENTIFIER, value.goalId.slice('commitment:'.length)) || !date(value.asOf)) fail();
  if (!shape(evidence, ['accountId', 'currency', 'direction', 'date', 'cents', 'posted'])
    || !matches(IDENTIFIER, evidence.accountId) || evidence.currency !== 'cad'
    || evidence.direction !== 'debit' || evidence.posted !== true || !positive(evidence.cents)
    || !date(evidence.date) || evidence.date > value.asOf) fail();
  return value;
}
function link(selection, assignedCents) {
  return snapshot({ version: 1, kind: 'link', goalId: selection.goalId,
    txRef: selection.txRef, evidence: selection.evidence,
    evidenceDigest: C.digest(selection.evidence), assignedCents, asOf: selection.asOf });
}
function validPreview(result, authority, operationId, command, now) {
  const p = result?.preview;
  if (!shape(p, ['schema', 'householdId', 'actorId', 'operationId', 'expectedRevision',
    'expectedDocumentDigest', 'issuedAt', 'expiresAt', 'command'])
    || p.schema !== C.PREVIEW_SCHEMA || p.householdId !== authority.householdId
    || p.actorId !== authority.actorId || p.operationId !== operationId
    || !Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0
    || !matches(HASH, p.expectedDocumentDigest) || !positive(p.issuedAt)
    || p.issuedAt > now || p.expiresAt !== p.issuedAt + C.TTL_MS || p.expiresAt <= now
    || !isDeepStrictEqual(p.command, command)
    || result.confirmationDigest !== C.digest(p)) fail();
  return p;
}
function receipt(result, authority, operationId) {
  if (result?.status !== 'committed' || result.operationId !== operationId
    || !positive(result.revision) || !matches(HASH, result.digest)
    || (Object.hasOwn(result, 'actorId') && result.actorId !== authority.actorId)) return null;
  return Object.freeze({ status: 'committed', operationId,
    revision: result.revision, digest: result.digest });
}

function createSettlementEvidenceConfirmation(deps) {
  if (!record(deps)) throw new TypeError('settlement-confirmation: dependencies required');
  const { householdId, authorize, resolveSelection, resolvePairedSelection, commitAdmitted,
    store, now, registerRecovery } = deps;
  // Write admission fencing is selected whole at construction: a paired
  // resolver capability AND the store's admission capability, or neither.
  // Exactly one (or a non-function value) is a partial setup and refuses:
  // a fenced controller never falls back to commitWithoutRecovery, and an
  // unfenced controller never touches the admission capability.
  const fenced = typeof resolvePairedSelection === 'function' && typeof commitAdmitted === 'function';
  if (!matches(HOUSEHOLD, householdId) || typeof authorize !== 'function'
    || typeof resolveSelection !== 'function' || typeof now !== 'function'
    || (registerRecovery !== undefined && typeof registerRecovery !== 'function')
    || (resolvePairedSelection !== undefined && typeof resolvePairedSelection !== 'function')
    || (commitAdmitted !== undefined && typeof commitAdmitted !== 'function')
    || ((resolvePairedSelection === undefined) !== (commitAdmitted === undefined))
    || !store || ['prepare', 'commitWithoutRecovery', 'outcome'].some(k => typeof store[k] !== 'function')) {
    throw new TypeError('settlement-confirmation: incomplete trusted dependencies');
  }
  const previews = new Map(), preparing = new Map();
  // Never recycle a terminal-proof operation in this composition. Bounded and
  // fail-closed, not a durable/global nonreuse claim: restart/other instances
  // are fenced in the browser by the separate random generation discriminator.
  const terminalOperations = new Set();
  const MAX_TERMINAL_OPERATIONS = 1000;
  let writeInFlight = false, uncertainOperation = null;
  function tick() { const value = now(); if (!positive(value)) fail(); return value; }
  function retire(operationId, expected) {
    // A delayed result may belong to a reclaimed generation. It must never
    // delete a replacement (including an identical command/operation ID).
    if (expected && previews.get(operationId) === expected) previews.delete(operationId);
  }
  function sweepExpired() {
    const time = tick();
    for (const [operationId, entry] of previews) {
      // Read-only confirmations may be paused across this sweep. Their final
      // identity/token check prevents them from committing after replacement.
      // Once a write is attempted, TTL alone can no longer establish safety.
      if (!entry.attempted && time >= entry.preview.expiresAt) retire(operationId, entry);
    }
  }
  function terminal(operationId, entry, reason, definitiveAttempt = false) {
    // Another confirmation can enter the sole write while this read-only
    // validation awaits. Its uncertainty takes precedence over a stale refusal.
    if (entry.attempted && !definitiveAttempt) return unknown(operationId);
    retire(operationId, entry);
    return rejected(reason);
  }
  async function terminalNoEffect(context, authority, request, entry, reason, prejournalRefused = false) {
    // Legacy clients have no persisted generation. Keep their existing
    // conservative receipt-only recovery; a reason string is never proof.
    if (!Object.hasOwn(request, 'generation')) {
      if (prejournalRefused) uncertainOperation = null;
      return terminal(request.operationId, entry, reason, prejournalRefused);
    }
    await sameAuthority(context, authority);
    if (previews.get(request.operationId) !== entry || request.previewToken !== entry.previewToken
      || request.generation !== entry.generation || terminalOperations.size >= MAX_TERMINAL_OPERATIONS)
      return unknown(request.operationId);
    if (prejournalRefused) {
      // The sole store invocation has returned an exact trusted prejournal
      // admission/expiry refusal
      // and was reauthorized. Its invocation remains excluded until finally.
      if (!entry.attempted || !writeInFlight || uncertainOperation !== request.operationId)
        return unknown(request.operationId);
    } else if (entry.attempted || writeInFlight || uncertainOperation) return unknown(request.operationId);
    // No await between exclusion, retirement and acknowledgement construction.
    // Every suspended confirmation still holds this retired entry and fails
    // the exact-entry check before it can enter a future commit.
    terminalOperations.add(request.operationId);
    retire(request.operationId, entry);
    if (prejournalRefused) uncertainOperation = null;
    return Object.freeze({ status: 'not-applied', operationId: request.operationId,
      generation: entry.generation, previewToken: entry.previewToken });
  }
  // One resolve call under the Rule E binding. The classify closure stays
  // open until this helper's own continuation of the resolver await runs
  // (the finally closes it, after the owned selection snapshot is taken),
  // not at the exact instant the resolver's value or Promise fulfils, so a
  // microtask the resolver queued ahead of that continuation still counts.
  // The closure latches its own invocation count, classifier error and
  // projection, so a resolver that swallows a classifier error, classifies
  // twice, or never classifies still fails the attempt once it closes.
  // A stashed closure invoked after closure throws, records nothing and
  // can touch nothing but its own dead session — never the accepted
  // snapshot, another attempt or a durable receipt — and it does not
  // retroactively undo an attempt that already completed.
  // The resolved selection is snapshotted and qualified HERE, in the same
  // continuation as the resolver await: acquisition and snapshot are one
  // step, exactly as the base acquired its selection, so no foreign
  // reference crosses this helper's return — only the owned frozen
  // selection and the owned projection do. A mutation landing in the
  // helper-to-caller interval can therefore neither rewrite the selection
  // paired with the projection nor restore a changed binding past the
  // confirm comparison.
  // In fenced mode the helper additionally returns the freshness witness
  // paired with THIS resolution, extracted by descriptor in the same
  // continuation. The witness is a live capability: it is never
  // snapshotted, compared, persisted or serialized, and prepare discards
  // its own — only confirm's fresh witness is carried into admission.
  async function resolveClassified(authority, selection) {
    const session = { open: true, calls: 0, error: null, projection: null };
    const classify = (tx, plan, opts) => {
      if (!session.open) fail();
      session.calls++;
      if (session.calls > 1) fail();
      try {
        const raw = Forecast.classifyCurrentPeriodTransaction(tx, plan, opts);
        session.projection = projectVerdict(raw);
        return raw;
      } catch (error) {
        if (!session.error) session.error = error;
        throw error;
      }
    };
    let ownedSelection, witness = null;
    try {
      if (fenced) {
        // The paired result is unpacked by own DATA descriptors in this
        // same continuation: the selection enters the snapshot path, the
        // witness — a live function, never data — is carried beside it.
        // An accessor, a missing field or a non-function witness is a
        // protocol failure, and the accessor is never invoked.
        const paired = await resolvePairedSelection({ authority, selection, classify });
        if (!shape(paired, ['selection', 'witness'])) fail();
        const selectionDescriptor = Object.getOwnPropertyDescriptor(paired, 'selection');
        const witnessDescriptor = Object.getOwnPropertyDescriptor(paired, 'witness');
        if (!selectionDescriptor || !Object.hasOwn(selectionDescriptor, 'value')
          || !witnessDescriptor || !Object.hasOwn(witnessDescriptor, 'value')
          || typeof witnessDescriptor.value !== 'function') fail();
        witness = witnessDescriptor.value;
        ownedSelection = snapshot(selectionDescriptor.value);
      } else {
        ownedSelection = snapshot(await resolveSelection({ authority, selection, classify }));
      }
    } finally { session.open = false; }
    if (session.error || session.calls !== 1) fail();
    return { selection: qualified(ownedSelection, authority), projection: session.projection, witness };
  }
  async function authorityFor(context) {
    const value = snapshot(await authorize(context));
    if (!shape(value, ['householdId', 'actorId']) || value.householdId !== householdId
      || !matches(ACTOR, value.actorId)) fail();
    return value;
  }
  async function sameAuthority(context, original) {
    if (!isDeepStrictEqual(await authorityFor(context), original)) fail();
  }
  async function originalOutcome(context, authority, operationId, expected = previews.get(operationId)) {
    const result = snapshot(await store.outcome({ actorId: authority.actorId, operationId }));
    await sameAuthority(context, authority);
    if (result.status === 'unknown') return null;
    const original = receipt(result, authority, operationId);
    if (!original) fail();
    if (uncertainOperation === operationId) uncertainOperation = null;
    retire(operationId, expected);
    return original;
  }

  // Settled-uncertainty recovery (P2). This private NO-ARGUMENT capability
  // is exposed only through the optional trusted construction-time
  // registration callback below; it never appears on the public object. It
  // captures the retained uncertain attempt itself — the entry's retained
  // authority, frozen preview and confirmation digest — and accepts no
  // caller context, operation ID, proof, reset flag or authority override,
  // so nothing a caller supplies can aim it at another operation or
  // fabricate the proof it acts on. It refuses while the actual
  // commit/postauthorization invocation remains in flight (an outside
  // waiter's timeout is not proof that invocation ended). After awaiting
  // the store's read-only inspection it rechecks, with no intervening
  // await, that the same latch, the same generation/entry (identity and
  // token) and no in-flight write hold; only then, on exact committed or
  // not-committed proof AND store readiness, does it clear only that latch
  // and retire only its attempted entry. A delayed inspection that finds
  // its generation replaced reports obsolete and preserves the newer
  // state. It never retries the commit and returns only a maintenance
  // acknowledgement — never a receipt, an actor or financial data.
  const ack = status => Object.freeze({ status });
  async function recoverSettledUncertainty() {
    if (writeInFlight) return ack('blocked');
    const operationId = uncertainOperation;
    if (!operationId) return ack('idle');
    const entry = previews.get(operationId);
    if (!entry || !entry.attempted) return ack('blocked');
    if (typeof store.inspectAttempt !== 'function') return ack('blocked');
    const capturedToken = entry.previewToken;
    let disposition, ready;
    try {
      const inspection = snapshot(await store.inspectAttempt({
        actorId: entry.authority.actorId, preview: entry.preview,
        confirmationDigest: entry.confirmationDigest,
      }));
      disposition = inspection.disposition; ready = inspection.ready;
    } catch { return ack('blocked'); }
    // Recheck with no intervening await: the decision and the clearing are
    // one synchronous step after the inspection settles.
    if (uncertainOperation !== operationId || previews.get(operationId) !== entry
      || entry.previewToken !== capturedToken) return ack('obsolete');
    if (writeInFlight) return ack('blocked');
    if ((disposition === 'committed' || disposition === 'not-committed') && ready === true) {
      uncertainOperation = null;
      retire(operationId, entry);
      return ack('resolved');
    }
    return ack('blocked');
  }
  if (registerRecovery) registerRecovery(recoverSettledUncertainty);

  async function prepare(context, input) {
    let request, ownedContext, reservation;
    try {
      ownedContext = snapshot(context); request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId', 'selection', 'assignedCents'])
        || !matches(OPERATION, request.operationId) || !validSelection(request.selection)
        || !positive(request.assignedCents)) return unavailable('invalid-request');
      sweepExpired();
      if (uncertainOperation) return unavailable('outcome-unresolved');
      if (terminalOperations.has(request.operationId) || terminalOperations.size >= MAX_TERMINAL_OPERATIONS)
        return unavailable('preview-unavailable');
      if (previews.has(request.operationId) || preparing.has(request.operationId)
        || previews.size + preparing.size >= MAX_PREVIEWS) return unavailable('preview-unavailable');
      reservation = {}; preparing.set(request.operationId, reservation);
      const authority = await authorityFor(ownedContext);
      const resolvedCall = await resolveClassified(authority, request.selection);
      const selection = Object.freeze({ ...resolvedCall.selection,
        classification: resolvedCall.projection });
      // Admission is decided before the command exists and before any
      // store call: an ineligible or unresolved verdict retains no preview.
      const admission = admissionFor(resolvedCall.projection);
      if (admission === 'ineligible') return rejected('selection-ineligible');
      if (admission === 'unresolved') return unavailable('selection-eligibility-unresolved');
      const command = link(selection, request.assignedCents);
      const result = snapshot(await store.prepare({ actorId: authority.actorId,
        operationId: request.operationId, command }));
      const preview = validPreview(result, authority, request.operationId, command, tick());
      await sameAuthority(ownedContext, authority);
      if (tick() >= preview.expiresAt) return rejected('preview-expired');
      if (uncertainOperation) return unavailable('outcome-unresolved');
      const previewToken = crypto.randomBytes(32).toString('hex');
      const generation = 'generation-' + crypto.randomBytes(16).toString('hex');
      // Convert the reservation to a live entry without counting both slots.
      preparing.delete(request.operationId);
      previews.set(request.operationId, { authority, selection, request, preview,
        confirmationDigest: result.confirmationDigest, previewToken, generation, attempted: false });
      return snapshot({ status: 'prepared', operationId: request.operationId,
        previewToken, generation,
        selection: request.selection, assignedCents: command.assignedCents,
        currency: command.evidence.currency, date: command.evidence.date, asOf: command.asOf,
        operation: { version: 1, kind: 'link' }, expiresAt: preview.expiresAt });
    } catch { return unavailable('prepare-unavailable'); }
    finally {
      if (reservation && preparing.get(request.operationId) === reservation) preparing.delete(request.operationId);
    }
  }

  async function confirm(context, input) {
    let request, enteredCommit = false;
    try {
      const ownedContext = snapshot(context); request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId'], ['confirmed', 'previewToken', 'generation'])
        || !matches(OPERATION, request.operationId)
        || (Object.hasOwn(request, 'generation') && !matches(/^generation-[a-f0-9]{32}$/, request.generation))
        || (Object.hasOwn(request, 'confirmed') && typeof request.confirmed !== 'boolean')) {
        return unavailable('invalid-request');
      }
      const authority = await authorityFor(ownedContext);
      // Original commitment takes precedence over ephemeral previews, current
      // provider evidence, expiry and explicit-confirmation requirements.
      const original = await originalOutcome(ownedContext, authority, request.operationId);
      if (original) return original;
      if (uncertainOperation || writeInFlight) return unknown(request.operationId);
      const retained = previews.get(request.operationId);
      if (!retained || !isDeepStrictEqual(retained.authority, authority)) return unknown(request.operationId);
      if (!matches(HASH, request.previewToken) || request.previewToken !== retained.previewToken) return rejected('preview-token-invalid');
      if (Object.hasOwn(request, 'generation') && request.generation !== retained.generation) return rejected('preview-generation-invalid');
      if (retained.attempted) return unknown(request.operationId);
      if (request.confirmed !== true) return rejected('confirmation-required');
      if (tick() >= retained.preview.expiresAt) return await terminalNoEffect(ownedContext, authority, request, retained, 'preview-expired');
      let fresh, admissionWitness = null;
      try {
        const resolvedCall = await resolveClassified(authority, retained.request.selection);
        fresh = Object.freeze({ ...resolvedCall.selection,
          classification: resolvedCall.projection });
        // Fenced mode: the witness paired with THIS fresh confirm-time
        // resolution — never prepare's older acquisition — is held in a
        // local and carried through the probe and authorization waits
        // below into the admission commit. It is not part of the frozen
        // selection, the deep compare, or any persisted shape.
        admissionWitness = resolvedCall.witness;
      } catch { return retained.attempted ? unknown(request.operationId) : rejected('selection-unavailable'); }
      if (!isDeepStrictEqual(fresh, retained.selection)) return await terminalNoEffect(ownedContext, authority, request, retained, 'selection-changed');
      // Read-only optimization only: another caller can change the store
      // after this probe releases the lock (including during authorization).
      // commitWithoutRecovery owns the atomic no-recovery decision under the
      // store lock. Discard this fresh preview; never replace the original.
      let current;
      try {
        const result = snapshot(await store.prepare({ actorId: authority.actorId,
          operationId: request.operationId, command: retained.preview.command }));
        current = validPreview(result, authority, request.operationId, retained.preview.command, tick());
      } catch { return unavailable('store-unavailable'); }
      if (current.expectedRevision !== retained.preview.expectedRevision
        || current.expectedDocumentDigest !== retained.preview.expectedDocumentDigest) {
        return terminal(request.operationId, retained, 'store-conflict');
      }
      await sameAuthority(ownedContext, authority);
      if (tick() >= retained.preview.expiresAt) return await terminalNoEffect(ownedContext, authority, request, retained, 'preview-expired');
      // No await between this check, consuming the sole attempt and invoking
      // commit. The store sees the original frozen preview, never a rebase.
      if (retained.attempted || writeInFlight || uncertainOperation) return unknown(request.operationId);
      if (previews.get(request.operationId) !== retained || request.previewToken !== retained.previewToken) {
        return rejected('preview-token-invalid');
      }
      retained.attempted = true; enteredCommit = true; writeInFlight = true;
      uncertainOperation = request.operationId;
      const result = snapshot(fenced
        ? await commitAdmitted({ actorId: authority.actorId,
          preview: retained.preview, confirmationDigest: retained.confirmationDigest }, admissionWitness)
        : await store.commitWithoutRecovery({ actorId: authority.actorId,
          preview: retained.preview, confirmationDigest: retained.confirmationDigest }));
      await sameAuthority(ownedContext, authority);
      const committed = receipt(result, authority, request.operationId);
      if (committed) { uncertainOperation = null; retire(request.operationId, retained); return committed; }
      if (result.status === 'rejected' && result.reason === 'admission-refused') {
        // A definite admission refusal: the store wrote nothing. Retire
        // the attempted preview and clear the latch through the same
        // postauthorization discipline as the other definitive outcomes
        // (a sameAuthority failure above still preserves uncertainty for
        // P2). Fresh work requires a fresh prepare and explicit confirm.
        if (Object.hasOwn(request, 'generation') && (!fenced || !shape(result, ['status', 'reason'])))
          return unknown(request.operationId);
        return await terminalNoEffect(ownedContext, authority, request, retained, 'admission-refused', true);
      }
      if (result.status === 'rejected' && result.reason === 'preview-expired') {
        // The real store validates expiry before its journal write. Time can
        // cross the boundary after the controller's final read-only check.
        // Only the exact trusted fenced result is negative proof.
        if (Object.hasOwn(request, 'generation') && (!fenced || !shape(result, ['status', 'reason'])))
          return unknown(request.operationId);
        return await terminalNoEffect(ownedContext, authority, request, retained, 'preview-expired', true);
      }
      if (result.status === 'rejected' && result.reason === 'recovery-required') {
        uncertainOperation = null; return terminal(request.operationId, retained, 'recovery-required', true);
      }
      if (result.status === 'conflict') { uncertainOperation = null; return terminal(request.operationId, retained, 'store-conflict', true); }
      return unknown(request.operationId);
    } catch {
      return enteredCommit ? unknown(request.operationId) : unavailable('confirmation-unavailable');
    } finally { if (enteredCommit) writeInFlight = false; }
  }

  async function outcome(context, input) {
    try {
      const ownedContext = snapshot(context), request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId'])
        || !matches(OPERATION, request.operationId)) return unavailable('invalid-request');
      const authority = await authorityFor(ownedContext);
      return await originalOutcome(ownedContext, authority, request.operationId) || unknown(request.operationId);
    } catch { return unavailable('outcome-unavailable'); }
  }
  return Object.freeze({ prepare, confirm, outcome });
}

module.exports = { createSettlementEvidenceConfirmation };
