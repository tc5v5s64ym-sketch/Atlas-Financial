'use strict';

// ATLAS-080 / B3 FOUNDATION — NOT COMPLETION. The private terminal-certificate
// protocol: an irreversible operation seal plus the certificate issued only
// after that seal lands. DEFAULT-UNCONNECTED: nothing in the repository
// imports this module, no production path constructs it, and the incumbent
// settlement store, confirmation controller, HTTP layer and browser are
// untouched by it. It fences NOTHING in production today: the incumbent
// admission paths do not consult it, and wiring it into them is a separate,
// later integration step (Atlas's sequence: protocol + seal first, then
// outcome/HTTP/browser integration). This module also does NOT fix B3 by
// itself; it is the foundation the B3 integration would build on.
//
// The B3 defect this foundation addresses (design: B3 lost-negative
// recovery): a definitive no-effect decision whose response is lost leaves
// no durable trace, so the operation can neither be recovered nor safely
// re-admitted — and, as the executed B3A-27c acceptance case showed, a
// second live controller over the same store ignores another controller's
// process-local terminal decision and commits the operation anyway.
// Actor/generation keying is therefore NOT a fence. The fence here is the
// injected transport's atomic seal, operation-wide across actors,
// generations and controllers.
//
// Fencing dependency contract (ONE injected dependency, `fence`):
// - `atomicSeal` must be exactly `true`: the transport's declaration that
//   `seal` below is an atomic compare-and-seal at the transport itself.
// - `seal(operationId, record)` atomically transitions the operation from
//   UNSEALED to SEALED exactly once and returns `{sealed:true, record}`
//   for the winning claim or `{sealed:false, existing}` when a seal
//   already exists. The atomicity must live in the transport (a durable
//   compare-and-set, a unique constraint, a conditional write); a
//   read-then-write composed by a caller, a stored response record, or a
//   process-local Set does NOT satisfy this contract.
// - `readSeal(operationId)` returns the sealed record or `null`.
// - `readCommitted(operationId)` returns the operation's committed record
//   or `null`; it is how the protocol detects the invariant violation of a
//   committed record and a negative certificate coexisting.
// A dependency that cannot honour this contract — missing methods, or
// `atomicSeal` not exactly `true` — is refused at construction: the
// resulting protocol is inert and every operation resolves to `unknown`.
// This module cannot verify a transport's atomicity beyond that declared
// contract and the result discipline below; test transports MODEL the
// atomic guarantee (see the suite header) and no production durability is
// claimed or qualified here.
//
// Protocol semantics (frozen):
// - States: UNSEALED → SEALED-NEGATIVE, irreversible. A certificate is
//   issued ONLY AFTER the seal lands. Sealing is operation-wide: it binds
//   the operationId, never just an actor or a generation.
// - A committed record and a negative certificate coexisting for one
//   operationId is an invariant violation, surfaced as an explicit
//   CONFLICT refusal — never resolved by precedence in either direction.
// - A failed post-seal authorization suppresses the certificate response
//   WITHOUT undoing the seal.
// - A lost seal acknowledgement may have landed: it is resolved by reading
//   state, never by reopening admission. Ambiguous, malformed or
//   unreadable persistence resolves to `unknown`, never `not-applied`.
// - Sealed operationIds are never reusable, including across a restart
//   (modelled by a fresh protocol instance over the same transport state)
//   and including committed operationIds: admission stays closed for both
//   terminal outcomes.
// - The recovery read is actor-private (any other actor receives
//   `unknown`) and generation-exact when a generation is supplied, and
//   returns exactly the three-field recovery shape
//   `{status:'not-applied', operationId, generation}`. There is no
//   browser consumer in this slice.

const crypto = require('node:crypto');

const SCHEMA = 'terminal-certificate-1';
const OPERATION_ID_PATTERN = /^operation-[a-f0-9]{32}$/;
const ACTOR_ID_PATTERN = /^session-[a-f0-9]{64}$/;
const HOUSEHOLD_ID_PATTERN = /^household-[a-f0-9]{32}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const KINDS = new Set(['link', 'withdrawal']);
const REASONS = new Set([
  'preview-expired',
  'selection-changed',
  'assignment-changed',
  'store-conflict',
  'admission-refused',
]);
const RECORD_KEYS = [
  'schema',
  'householdId',
  'operationId',
  'actorId',
  'kind',
  'generation',
  'reason',
  'expectedRevision',
  'expectedDocumentDigest',
  'confirmationDigest',
  'decidedAt',
];

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function isCertificateRecord(value) {
  if (!isPlainObject(value) || !hasExactKeys(value, RECORD_KEYS)) return false;
  return value.schema === SCHEMA
    && HOUSEHOLD_ID_PATTERN.test(value.householdId)
    && OPERATION_ID_PATTERN.test(value.operationId)
    && ACTOR_ID_PATTERN.test(value.actorId)
    && KINDS.has(value.kind)
    && typeof value.generation === 'string'
    && value.generation.length > 0
    && value.generation.length <= 128
    && REASONS.has(value.reason)
    && Number.isInteger(value.expectedRevision)
    && value.expectedRevision >= 0
    && DIGEST_PATTERN.test(value.expectedDocumentDigest)
    && DIGEST_PATTERN.test(value.confirmationDigest)
    && Number.isInteger(value.decidedAt)
    && value.decidedAt >= 0;
}

// Builds the stored record from a claim, or returns null when the claim is
// not exactly the frozen shape. Claims carry every record field except the
// schema tag; anything missing, extra or malformed fails closed.
function recordFromClaim(claim) {
  if (!isPlainObject(claim)) return null;
  const record = {
    schema: SCHEMA,
    householdId: claim.householdId,
    operationId: claim.operationId,
    actorId: claim.actorId,
    kind: claim.kind,
    generation: claim.generation,
    reason: claim.reason,
    expectedRevision: claim.expectedRevision,
    expectedDocumentDigest: claim.expectedDocumentDigest,
    confirmationDigest: claim.confirmationDigest,
    decidedAt: claim.decidedAt,
  };
  if (Object.keys(claim).length !== RECORD_KEYS.length - 1) return null;
  return isCertificateRecord(record) ? record : null;
}

// Two records are the same DECISION when every field except the decision
// tick agrees; the tick is captured per attempt and is not identity.
function isSameDecision(a, b) {
  return RECORD_KEYS.every(key => key === 'decidedAt' || a[key] === b[key]);
}

function frozenCopy(record) {
  return Object.freeze({ ...record });
}

function unknown(operationId) {
  return { status: 'unknown', operationId: typeof operationId === 'string' ? operationId : null };
}

function honourableFence(fence) {
  return isPlainObject(fence)
    && fence.atomicSeal === true
    && typeof fence.seal === 'function'
    && typeof fence.readSeal === 'function'
    && typeof fence.readCommitted === 'function';
}

function createTerminalCertificateProtocol(dependencies) {
  const deps = isPlainObject(dependencies) ? dependencies : {};
  const fence = honourableFence(deps.fence) ? deps.fence : null;
  const connected = fence !== null;

  // Reads both terminal surfaces once. Any throw, or any value that is
  // neither null nor an object, is divergent persistence → null sentinel
  // result `{ok:false}` and every caller resolves to unknown.
  async function readTerminalState(operationId) {
    let seal;
    let committed;
    try {
      seal = await fence.readSeal(operationId);
      committed = await fence.readCommitted(operationId);
    } catch {
      return { ok: false };
    }
    if (seal !== null && seal !== undefined && !isPlainObject(seal)) return { ok: false };
    if (committed !== null && committed !== undefined && !isPlainObject(committed)) return { ok: false };
    return { ok: true, seal: seal ?? null, committed: committed ?? null };
  }

  async function sealNegative(claim, options) {
    const operationId = isPlainObject(claim) ? claim.operationId : undefined;
    if (!connected) return unknown(operationId);
    const record = recordFromClaim(claim);
    if (!record) return unknown(operationId);

    // Committed first: sealing a negative over a committed record would
    // manufacture the invariant violation this protocol exists to refuse.
    const before = await readTerminalState(record.operationId);
    if (!before.ok) return unknown(operationId);
    if (before.committed) {
      return { status: 'conflict', operationId: record.operationId, reason: 'committed-coexists' };
    }

    let outcome;
    try {
      outcome = await fence.seal(record.operationId, frozenCopy(record));
    } catch {
      // The seal may have landed (lost acknowledgement). Nothing here
      // reopens anything: the caller resolves the ambiguity by reading
      // state, and admission state is read from the same transport.
      return unknown(operationId);
    }
    if (!isPlainObject(outcome) || typeof outcome.sealed !== 'boolean') return unknown(operationId);

    let issued;
    if (outcome.sealed) {
      if (!isCertificateRecord(outcome.record) || !isSameDecision(outcome.record, record)) {
        return unknown(operationId);
      }
      issued = outcome.record;
    } else {
      if (!isCertificateRecord(outcome.existing)) return unknown(operationId);
      if (!isSameDecision(outcome.existing, record)) {
        return { status: 'refused', operationId: record.operationId, reason: 'already-sealed' };
      }
      issued = outcome.existing;
    }

    // The seal has landed and is irreversible from here on. Post-seal
    // authorization may suppress the response; it can never undo the seal.
    const authorize = isPlainObject(options) ? options.authorize : undefined;
    if (authorize !== undefined) {
      let authorized = false;
      try {
        authorized = typeof authorize === 'function' && (await authorize(frozenCopy(issued))) === true;
      } catch {
        authorized = false;
      }
      if (!authorized) return { status: 'suppressed', operationId: record.operationId };
    }
    return { status: 'certified', operationId: record.operationId, certificate: frozenCopy(issued) };
  }

  async function lookupCertificate(operationId, actorId, options) {
    if (!connected) return unknown(operationId);
    if (!OPERATION_ID_PATTERN.test(operationId) || !ACTOR_ID_PATTERN.test(actorId)) {
      return unknown(operationId);
    }
    const state = await readTerminalState(operationId);
    if (!state.ok) return unknown(operationId);
    if (state.seal !== null && !isCertificateRecord(state.seal)) return unknown(operationId);
    if (!state.seal) return unknown(operationId);
    // Actor-private: a wrong actor learns nothing, not even that a seal or
    // a conflict exists for this operation.
    if (state.seal.actorId !== actorId) return unknown(operationId);
    if (state.committed) {
      return { status: 'conflict', operationId, reason: 'committed-coexists' };
    }
    const expectedGeneration = isPlainObject(options) ? options.generation : undefined;
    if (expectedGeneration !== undefined && expectedGeneration !== state.seal.generation) {
      return unknown(operationId);
    }
    return { status: 'not-applied', operationId, generation: state.seal.generation };
  }

  async function admissionState(operationId) {
    if (!connected || !OPERATION_ID_PATTERN.test(operationId)) return unknown(operationId);
    const state = await readTerminalState(operationId);
    if (!state.ok) return unknown(operationId);
    if (state.seal !== null && !isCertificateRecord(state.seal)) return unknown(operationId);
    if (state.seal || state.committed) return { status: 'sealed', operationId };
    return { status: 'open', operationId };
  }

  async function beginAdmission(operationId, actorId) {
    if (!connected) return unknown(operationId);
    if (!OPERATION_ID_PATTERN.test(operationId) || !ACTOR_ID_PATTERN.test(actorId)) {
      return unknown(operationId);
    }
    const state = await admissionState(operationId);
    if (state.status === 'sealed') {
      return { status: 'refused', operationId, reason: 'operation-sealed' };
    }
    if (state.status !== 'open') return unknown(operationId);
    const ticket = Object.freeze({
      operationId,
      actorId,
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    return { status: 'admitted', operationId, ticket };
  }

  async function commitAdmission(ticket, commit) {
    const operationId = isPlainObject(ticket) ? ticket.operationId : undefined;
    if (!connected || typeof commit !== 'function') return unknown(operationId);
    if (!isPlainObject(ticket)
      || !OPERATION_ID_PATTERN.test(ticket.operationId)
      || !ACTOR_ID_PATTERN.test(ticket.actorId)
      || typeof ticket.nonce !== 'string'
      || ticket.nonce.length === 0) {
      return unknown(operationId);
    }
    // The stale-suspension fence: admission state is re-read at the moment
    // of commit, never trusted from when the ticket was issued. A seal
    // that landed while this admission was suspended refuses the commit
    // and the commit function is never invoked.
    const state = await admissionState(ticket.operationId);
    if (state.status === 'sealed') {
      return { status: 'refused', operationId: ticket.operationId, reason: 'operation-sealed' };
    }
    if (state.status !== 'open') return unknown(ticket.operationId);
    let result;
    try {
      result = await commit();
    } catch {
      // A commit whose outcome could not be observed is ambiguous, exactly
      // like the shipped discipline: unknown, never not-applied.
      return unknown(ticket.operationId);
    }
    return { status: 'committed', operationId: ticket.operationId, result };
  }

  return Object.freeze({
    connected,
    sealNegative,
    lookupCertificate,
    admissionState,
    beginAdmission,
    commitAdmission,
  });
}

module.exports = { createTerminalCertificateProtocol, TERMINAL_CERTIFICATE_SCHEMA: SCHEMA };
