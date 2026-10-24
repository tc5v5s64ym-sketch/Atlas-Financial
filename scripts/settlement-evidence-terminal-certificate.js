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
// injected transport's atomic state transitions, operation-wide across
// actors, generations and controllers.
//
// Fencing dependency contract (ONE injected dependency, `fence`). Every
// transition below must be atomic AT THE TRANSPORT (a durable
// compare-and-set, a unique constraint, a conditional write): a
// read-then-write composed by a caller, a stored response record, or a
// process-local Set does NOT satisfy this contract.
// - `atomicSeal` must be exactly `true`: the transport's declaration that
//   all of these transitions are atomic compare-and-transitions.
// - `seal(operationId, record)` atomically transitions UNSEALED → SEALED
//   exactly once, and only while no admission reservation is live and no
//   committed record exists. Returns `{sealed:true, record}` for the
//   winning claim, `{sealed:false, existing}` when a seal already exists,
//   or `{sealed:false, existing:null, blocked}` with blocked
//   `'admission-reserved'` or `'committed'` when another terminal track
//   currently holds the operation.
// - `reserveAdmission(operationId, reservation)` atomically reserves the
//   operation for one admission iff it is unsealed, uncommitted and
//   unreserved: `{reserved:true}`, else `{reserved:false, reason}` with
//   reason `'sealed'`, `'committed'` or `'reserved'`. Admission NEVER
//   proceeds from a state read; the reservation IS the admission, so a
//   seal attempted while a reservation is live is refused by the
//   transport, and a reservation attempted after a seal is refused too —
//   the two tracks exclude each other atomically, not by re-reading.
// - `commitReservation(operationId, nonce, committedRecord)` atomically
//   lands the commit iff the caller still holds the live reservation and
//   no seal exists. The RESERVATION'S OWN RECORDED IDENTITY is
//   authoritative for that check — operation, actor and nonce as stored
//   by `reserveAdmission`, never the caller-presented ticket's claims:
//   a ticket copied and relabelled to another actor must not spend the
//   original actor's reservation. On an identity mismatch it returns
//   `{committed:false, reason:'identity-mismatch'}`; on success it
//   consumes the reservation, stores the committed record and returns
//   `{committed:true, operationId}`; other failures return
//   `{committed:false, reason}` with reason `'sealed'` or
//   `'reservation-lost'`. The commit landing is this transport transition
//   — the protocol deliberately accepts NO caller callback that performs
//   a write elsewhere, because a write outside the transport cannot be
//   fenced against the seal.
// - `releaseAdmission(operationId, nonce)` atomically clears a live
//   reservation held under that nonce: `{released:true|false}`.
// - `readSeal(operationId)` / `readCommitted(operationId)` return the
//   stored record or explicit `null`. `undefined` is a contract
//   violation, never absence: any undefined, malformed, unreadable or
//   identity-mismatched read makes the operation's state divergent and
//   every dependent operation resolves to `unknown`.
// A dependency missing any method, or with `atomicSeal` not exactly
// `true`, is refused at construction: the protocol is inert and every
// operation resolves to `unknown`. This module cannot verify a
// transport's atomicity beyond that declared contract and the result
// discipline below; test transports MODEL the atomic guarantee (see the
// suite header) and no production durability is claimed or qualified here.
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
//   terminal outcomes, and a consumed reservation can never land twice.
// - Commit outcomes have exact settlement semantics: only a strictly
//   validated `{status:'committed', operationId, actorId, revision,
//   documentDigest}` record bound to the reservation's own operation and
//   actor may surface as `committed`. A supplied `unknown` propagates as
//   `unknown`; any other supplied outcome propagates as a refusal.
//   Promise resolution alone is never commitment.
// - Admission is never labelled usable over unqualified persistence:
//   when the stored state is malformed, unreadable or divergent,
//   admission resolves to `unknown` and no actionable ticket is issued.
//   A read-integrity gate qualifies the state first; the atomic
//   reservation remains the fence that decides exclusion.
// - Caller-owned inputs are snapshotted and validated BEFORE any await,
//   and dispatch uses only the owned snapshot values: ticket and outcome
//   objects are flat, so the snapshot is a frozen shallow copy taken at
//   entry. Mutating the caller's objects during a suspended read cannot
//   alter a validated revision, smuggle in a field, or retarget a commit
//   to another reservation.
// - KNOWN LIMIT — abandoned reservations (intentional, fail-closed): the
//   reservation-versus-seal refusal is an intentional exclusion. An
//   admission reservation whose holder crashes or abandons it HOLDs its
//   operation: seals are refused (`admission-reserved`) and further
//   admissions are refused (`operation-reserved`) until the holder
//   itself releases or commits. This protocol deliberately provides NO
//   expiry, TTL, automatic retry, or third-party release, and it must
//   never silently expire or release an unknown in-flight reservation.
//   A qualified recovery lifecycle for abandoned reservations —
//   operator identity, authorisation scope, audit record — requires a
//   WIDER dependency contract than this foundation defines and is NOT
//   provided here; that gap is a stated limit, not a hidden behaviour.
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
const COMMITTED_KEYS = ['status', 'operationId', 'actorId', 'revision', 'documentDigest'];

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

function isCommittedRecord(value, operationId, actorId) {
  return isPlainObject(value)
    && hasExactKeys(value, COMMITTED_KEYS)
    && value.status === 'committed'
    && value.operationId === operationId
    && value.actorId === actorId
    && Number.isInteger(value.revision)
    && value.revision >= 0
    && DIGEST_PATTERN.test(value.documentDigest);
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
    && typeof fence.reserveAdmission === 'function'
    && typeof fence.commitReservation === 'function'
    && typeof fence.releaseAdmission === 'function'
    && typeof fence.readSeal === 'function'
    && typeof fence.readCommitted === 'function';
}

function isValidTicket(ticket) {
  return isPlainObject(ticket)
    && OPERATION_ID_PATTERN.test(ticket.operationId)
    && ACTOR_ID_PATTERN.test(ticket.actorId)
    && typeof ticket.nonce === 'string'
    && ticket.nonce.length > 0;
}

function createTerminalCertificateProtocol(dependencies) {
  const deps = isPlainObject(dependencies) ? dependencies : {};
  const fence = honourableFence(deps.fence) ? deps.fence : null;
  const connected = fence !== null;

  // Reads both terminal surfaces once and validates CONTEXTUAL identity,
  // not just shape: a record is only evidence about the operation it was
  // read for when its own operationId names that same operation. Any
  // throw, any undefined (absence must be explicit null), any malformed
  // value, or any identity mismatch is divergent persistence → `{ok:false}`
  // and every caller resolves to unknown.
  async function readTerminalState(operationId) {
    let seal;
    let committed;
    try {
      seal = await fence.readSeal(operationId);
      committed = await fence.readCommitted(operationId);
    } catch {
      return { ok: false };
    }
    if (seal === undefined || committed === undefined) return { ok: false };
    if (seal !== null) {
      if (!isCertificateRecord(seal)) return { ok: false };
      if (seal.operationId !== operationId) return { ok: false };
    }
    if (committed !== null) {
      if (!isPlainObject(committed)) return { ok: false };
      if (Object.prototype.hasOwnProperty.call(committed, 'operationId')
        && committed.operationId !== operationId) return { ok: false };
    }
    return { ok: true, seal, committed };
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
    } else if (outcome.existing === null || outcome.existing === undefined) {
      // Not sealed and no prior seal: only an explicit blocked marker is a
      // well-formed transport answer; anything else is divergent.
      if (outcome.blocked === 'admission-reserved') {
        return { status: 'refused', operationId: record.operationId, reason: 'admission-reserved' };
      }
      if (outcome.blocked === 'committed') {
        return { status: 'conflict', operationId: record.operationId, reason: 'committed-coexists' };
      }
      return unknown(operationId);
    } else {
      if (!isCertificateRecord(outcome.existing)) return unknown(operationId);
      // Contextual binding in EVERY branch: an answer naming a different
      // operation is divergent persistence, never a decision about this
      // one — it must not surface as already-sealed here.
      if (outcome.existing.operationId !== record.operationId) return unknown(operationId);
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
    if (state.seal || state.committed) return { status: 'sealed', operationId };
    return { status: 'open', operationId };
  }

  async function beginAdmission(operationId, actorId) {
    if (!connected) return unknown(operationId);
    if (!OPERATION_ID_PATTERN.test(operationId) || !ACTOR_ID_PATTERN.test(actorId)) {
      return unknown(operationId);
    }
    // Admission is never labelled usable over unqualified persistence:
    // divergent reads resolve to unknown and no ticket is issued. This
    // gate qualifies state only — the fence below remains the atomic
    // reservation that decides exclusion, so the gate reintroduces no
    // read-then-act race.
    const gate = await readTerminalState(operationId);
    if (!gate.ok) return unknown(operationId);
    // Admission is the atomic reservation itself, never a state read: the
    // transport decides, in one transition, whether this admission holds
    // the operation against every seal, commit and competing admission.
    const reservation = Object.freeze({
      operationId,
      actorId,
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    let outcome;
    try {
      outcome = await fence.reserveAdmission(operationId, reservation);
    } catch {
      return unknown(operationId);
    }
    if (!isPlainObject(outcome) || typeof outcome.reserved !== 'boolean') return unknown(operationId);
    if (outcome.reserved) return { status: 'admitted', operationId, ticket: reservation };
    if (outcome.reason === 'sealed' || outcome.reason === 'committed') {
      return { status: 'refused', operationId, reason: 'operation-sealed' };
    }
    if (outcome.reason === 'reserved') {
      return { status: 'refused', operationId, reason: 'operation-reserved' };
    }
    return unknown(operationId);
  }

  async function releaseAdmission(ticketInput) {
    // Snapshot the caller-owned input before any await; only the owned
    // snapshot is validated and dispatched on.
    const ticket = isPlainObject(ticketInput) ? Object.freeze({ ...ticketInput }) : ticketInput;
    const operationId = isPlainObject(ticket) ? ticket.operationId : undefined;
    if (!connected || !isValidTicket(ticket)) return unknown(operationId);
    let outcome;
    try {
      outcome = await fence.releaseAdmission(ticket.operationId, ticket.nonce);
    } catch {
      return unknown(ticket.operationId);
    }
    if (!isPlainObject(outcome) || typeof outcome.released !== 'boolean') {
      return unknown(ticket.operationId);
    }
    if (outcome.released) return { status: 'released', operationId: ticket.operationId };
    return { status: 'refused', operationId: ticket.operationId, reason: 'reservation-lost' };
  }

  async function commitAdmission(ticketInput, outcomeInput) {
    // Snapshot BOTH caller-owned inputs before any await and validate /
    // dispatch only on the owned snapshots: both shapes are flat, so a
    // frozen shallow copy is the whole value. Mutating the caller's
    // objects during the suspended integrity read below cannot change a
    // validated field, smuggle in a new one, or retarget this commit to
    // another operation or reservation.
    const ticket = isPlainObject(ticketInput) ? Object.freeze({ ...ticketInput }) : ticketInput;
    const committedOutcome = isPlainObject(outcomeInput)
      ? Object.freeze({ ...outcomeInput })
      : outcomeInput;
    const operationId = isPlainObject(ticket) ? ticket.operationId : undefined;
    if (!connected || !isValidTicket(ticket)) return unknown(operationId);
    // Exact settlement semantics for the supplied outcome, decided before
    // any transport call: unknown propagates as unknown; a committed
    // claim must be the strict record shape bound to THIS reservation's
    // operation and actor; every other outcome propagates as a refusal.
    // Nothing is wrapped as committed on the strength of being supplied.
    if (!isPlainObject(committedOutcome)) return unknown(ticket.operationId);
    if (committedOutcome.status === 'unknown') return unknown(ticket.operationId);
    if (committedOutcome.status !== 'committed') {
      return { status: 'refused', operationId: ticket.operationId, reason: 'not-committed' };
    }
    if (!isCommittedRecord(committedOutcome, ticket.operationId, ticket.actorId)) {
      return unknown(ticket.operationId);
    }
    // Read integrity gate: divergent persistence (undefined, malformed,
    // identity-mismatched) resolves to unknown and the commit transition
    // is never invoked. This read is a fail-closed gate only — the fence
    // itself is the atomic transition below, which re-decides exclusion
    // at landing time.
    const state = await readTerminalState(ticket.operationId);
    if (!state.ok) return unknown(ticket.operationId);
    let outcome;
    try {
      outcome = await fence.commitReservation(
        ticket.operationId,
        ticket.nonce,
        frozenCopy(committedOutcome),
      );
    } catch {
      // The transition may have landed; the ambiguity resolves by reading
      // state, never by assuming commitment or non-commitment.
      return unknown(ticket.operationId);
    }
    if (!isPlainObject(outcome) || typeof outcome.committed !== 'boolean') {
      return unknown(ticket.operationId);
    }
    if (outcome.committed) {
      if (outcome.operationId !== ticket.operationId) return unknown(ticket.operationId);
      return {
        status: 'committed',
        operationId: ticket.operationId,
        record: frozenCopy(committedOutcome),
      };
    }
    if (outcome.reason === 'sealed') {
      return { status: 'refused', operationId: ticket.operationId, reason: 'operation-sealed' };
    }
    if (outcome.reason === 'reservation-lost') {
      return { status: 'refused', operationId: ticket.operationId, reason: 'reservation-lost' };
    }
    if (outcome.reason === 'identity-mismatch') {
      // The transport's recorded reservation identity is authoritative:
      // the presented ticket was copied/relabelled, or the record names
      // another actor. The reservation itself is NOT consumed by this
      // refusal — its real holder can still land or release it.
      return { status: 'refused', operationId: ticket.operationId, reason: 'identity-mismatch' };
    }
    return unknown(ticket.operationId);
  }

  return Object.freeze({
    connected,
    sealNegative,
    lookupCertificate,
    admissionState,
    beginAdmission,
    releaseAdmission,
    commitAdmission,
  });
}

module.exports = { createTerminalCertificateProtocol, TERMINAL_CERTIFICATE_SCHEMA: SCHEMA };
