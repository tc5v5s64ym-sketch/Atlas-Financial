'use strict';

// Pure planned-obligation settlement evidence contract (ATLAS-080 Phase 1).
//
// This module records owner-confirmed payment evidence against planned
// Savings commitments: which stable provider transaction was assigned, for
// how many cents, under which frozen evidence and financial as-of. It is an
// evidence ledger only. It performs no financial calculation: it never
// computes remaining cost, paid state, or any Forecast figure. Forecast
// (Phase 2) owns every financial interpretation of the recorded evidence.
//
// Conservation rules enforced here are ledger-integrity rules, not financial
// policy: one stable transaction identity carries one globally conserved
// cents budget shared by every active allocation against it; a changed
// evidence digest for the same identity is changed evidence, never a new
// allocatable identity; a retraction removes only its named link's active
// claim and never rewrites history or relinks anything; a reversal records
// the exact counter-entry against its named link and restores no capacity
// anywhere. Commands requiring a relative remaining-cost semantics (an
// absolute remaining correction) are deliberately not representable in
// version 1.
//
// No filesystem, network, provider, storage, or activation behaviour exists
// in this module. Callers own transport and persistence; every public entry
// point validates the exact document it was handed.

const crypto = require('node:crypto');

const SCHEMA = 'atlas-planned-obligation-settlements/v1';
const PREVIEW_SCHEMA = 'atlas-planned-obligation-settlement-preview/v1';
const TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_OPERATIONS = 1000;

function fail() { throw new Error('settlement-evidence-unavailable'); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value, expected) {
  if (!isRecord(value)) fail();
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) fail();
}
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (isRecord(value)) {
    return '{' + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  fail();
}
function digest(value) {
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const household = value => typeof value === 'string' && /^household-[a-f0-9]{32}$/.test(value);
const actor = value => typeof value === 'string' && /^session-[a-f0-9]{64}$/.test(value);
const operation = value => typeof value === 'string' && /^operation-[a-f0-9]{32}$/.test(value);
const identifier = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const txRef = value => typeof value === 'string' && /^tx-[a-f0-9]{32}$/.test(value);
const goalId = value => typeof value === 'string' && value.startsWith('commitment:')
  && identifier(value.slice('commitment:'.length));
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
const cents = value => Number.isSafeInteger(value) && value > 0;
const tick = value => Number.isSafeInteger(value) && value > 0;

const EVIDENCE_KEYS = ['accountId', 'currency', 'direction', 'date', 'cents', 'posted'];
function evidenceValid(evidence, direction) {
  keys(evidence, EVIDENCE_KEYS);
  if (!identifier(evidence.accountId) || evidence.currency !== 'cad'
    || evidence.direction !== direction || !date(evidence.date)
    || !cents(evidence.cents) || typeof evidence.posted !== 'boolean') fail();
}

const COMMAND_KEYS = {
  link: ['version', 'kind', 'goalId', 'txRef', 'evidence', 'evidenceDigest', 'assignedCents', 'asOf'],
  retract: ['version', 'kind', 'targetOperationId'],
  reverse: ['version', 'kind', 'targetOperationId', 'counterTxRef', 'counterEvidence',
    'counterEvidenceDigest', 'cents'],
  lineage: ['version', 'kind', 'pendingTxRef', 'postedTxRef', 'postedEvidenceDigest'],
};
function commandValid(command) {
  if (!isRecord(command) || command.version !== 1
    || !Object.prototype.hasOwnProperty.call(COMMAND_KEYS, command.kind)) fail();
  keys(command, COMMAND_KEYS[command.kind]);
  if (command.kind === 'link') {
    if (!goalId(command.goalId) || !txRef(command.txRef) || !hash(command.evidenceDigest)
      || !cents(command.assignedCents) || !date(command.asOf)) fail();
    evidenceValid(command.evidence, 'debit');
    if (command.evidence.posted !== true
      || digest(command.evidence) !== command.evidenceDigest) fail();
  } else if (command.kind === 'retract') {
    if (!operation(command.targetOperationId)) fail();
  } else if (command.kind === 'reverse') {
    if (!operation(command.targetOperationId) || !txRef(command.counterTxRef)
      || !hash(command.counterEvidenceDigest) || !cents(command.cents)) fail();
    evidenceValid(command.counterEvidence, 'credit');
    if (command.counterEvidence.posted !== true
      || digest(command.counterEvidence) !== command.counterEvidenceDigest) fail();
  } else if (command.kind === 'lineage') {
    if (!txRef(command.pendingTxRef) || !txRef(command.postedTxRef)
      || command.pendingTxRef === command.postedTxRef
      || !hash(command.postedEvidenceDigest)) fail();
  }
}

// The ledger is derived state, recomputed from the operation list on every
// read. It is never stored, so a replayed document cannot smuggle a ledger
// that disagrees with its own history.
function emptyLedger() {
  return { links: new Map(), budgets: new Map(), counters: new Set(), pending: new Map() };
}
function applyCommand(ledger, command, operationId) {
  if (command.kind === 'link') {
    if (ledger.pending.has(command.txRef) || ledger.counters.has(command.txRef)) fail();
    let budget = ledger.budgets.get(command.txRef);
    if (budget && budget.digest !== command.evidenceDigest) fail();
    if (!budget) {
      budget = { digest: command.evidenceDigest, cents: command.evidence.cents, usedCents: 0 };
      ledger.budgets.set(command.txRef, budget);
    }
    if (budget.usedCents + command.assignedCents > budget.cents) fail();
    budget.usedCents += command.assignedCents;
    ledger.links.set(operationId, {
      goalId: command.goalId, txRef: command.txRef, assignedCents: command.assignedCents,
      effectiveDate: command.evidence.date, asOf: command.asOf,
      evidenceDigest: command.evidenceDigest, active: true, reversedCents: 0,
      reversals: [],
    });
  } else if (command.kind === 'retract') {
    const target = ledger.links.get(command.targetOperationId);
    if (!target || !target.active) fail();
    target.active = false;
    target.retractedBy = operationId;
    // Only the unreversed part of the claim is released. Cents already
    // reversed against this link stay consumed for the identity: the
    // counter-entry is a separate fact and the reversed portion of the
    // original payment cannot become fresh positive capacity.
    ledger.budgets.get(target.txRef).usedCents -= target.assignedCents - target.reversedCents;
  } else if (command.kind === 'reverse') {
    const target = ledger.links.get(command.targetOperationId);
    if (!target || !target.active || command.counterTxRef === target.txRef
      || ledger.counters.has(command.counterTxRef)
      || ledger.budgets.has(command.counterTxRef) || ledger.pending.has(command.counterTxRef)
      || command.cents > command.counterEvidence.cents
      || target.reversedCents + command.cents > target.assignedCents) fail();
    target.reversedCents += command.cents;
    target.reversals.push({
      operationId, counterTxRef: command.counterTxRef, cents: command.cents,
      date: command.counterEvidence.date,
    });
    ledger.counters.add(command.counterTxRef);
  } else if (command.kind === 'lineage') {
    const posted = ledger.budgets.get(command.postedTxRef);
    if (ledger.pending.has(command.pendingTxRef) || ledger.budgets.has(command.pendingTxRef)
      || ledger.counters.has(command.pendingTxRef)
      || !posted || posted.digest !== command.postedEvidenceDigest) fail();
    ledger.pending.set(command.pendingTxRef, command.postedTxRef);
  }
}
function replay(state) {
  if (!household(state.householdId) || state.revision !== state.operations.length
    || state.operations.length > MAX_OPERATIONS) fail();
  const ledger = emptyLedger();
  const seen = new Set();
  let previousTick = 0;
  state.operations.forEach((event, index) => {
    keys(event, ['revision', 'operationId', 'actorId', 'recordedAt', 'requestDigest', 'command']);
    if (event.revision !== index + 1 || !operation(event.operationId) || seen.has(event.operationId)
      || !actor(event.actorId) || !tick(event.recordedAt) || event.recordedAt < previousTick
      || !hash(event.requestDigest)) fail();
    seen.add(event.operationId);
    previousTick = event.recordedAt;
    commandValid(event.command);
    applyCommand(ledger, event.command, event.operationId);
  });
  return ledger;
}

// Active evidence only, in recorded order, with no sums, no remaining cost
// and no paid state: interpretation belongs to Forecast.
function effectiveEvidence(state) {
  const ledger = replay(state);
  const byGoal = new Map();
  for (const [operationId, link] of ledger.links) {
    if (!link.active) continue;
    if (!byGoal.has(link.goalId)) byGoal.set(link.goalId, []);
    byGoal.get(link.goalId).push({
      operationId, txRef: link.txRef, assignedCents: link.assignedCents,
      effectiveDate: link.effectiveDate, asOf: link.asOf,
      evidenceDigest: link.evidenceDigest,
      reversals: link.reversals.map(reversal => ({ ...reversal })),
    });
  }
  return {
    commitments: [...byGoal.keys()].sort().map(id => ({ goalId: id, links: byGoal.get(id) })),
  };
}

function encode(state) {
  const data = { schema: SCHEMA, ...state };
  return Buffer.from(canonical({ ...data, digest: digest(data) }));
}
function decode(body, expectedHousehold) {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BYTES) fail();
  let value;
  try { value = JSON.parse(body.toString('utf8')); } catch { fail(); }
  keys(value, ['schema', 'householdId', 'revision', 'operations', 'digest']);
  if (value.schema !== SCHEMA || !household(value.householdId)
    || value.householdId !== expectedHousehold || !hash(value.digest)) fail();
  const state = {
    householdId: value.householdId, revision: value.revision, operations: value.operations,
  };
  if (digest({ schema: SCHEMA, ...state }) !== value.digest) fail();
  replay(state);
  return { ...state, digest: value.digest };
}
function adopt(input) {
  keys(input, ['householdId']);
  if (!household(input.householdId)) fail();
  return encode({ householdId: input.householdId, revision: 0, operations: [] });
}
function pin(body, expectedHousehold) {
  const state = decode(body, expectedHousehold);
  return digest({
    householdId: state.householdId, revision: state.revision, documentDigest: state.digest,
  });
}
function restore(body, expectedPin) {
  let state;
  try { state = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : ''); } catch { fail(); }
  if (!isRecord(state) || !household(state.householdId)) fail();
  if (pin(body, state.householdId) !== expectedPin) fail();
  return body;
}

// Rule D admission guard (forward-only). A new link command is refused
// when the replayed CURRENT state already holds an active link for the
// same (goalId, txRef) pair. The pair is keyed on goalId and txRef alone:
// assignedCents and evidenceDigest are never compared, so a second
// allocation at a different amount is not an amendment — the amendment
// path is retract, then relink. "Active" is replay's own definition: a
// link is active from its link command until a retract clears it; a
// reversal, even in full, never clears it. The guard judges only new
// admissions against the committed pre-append state; recorded operations
// are never re-judged, so a document that already contains duplicate
// active pairs still decodes, replays and digests exactly as before.
function activePairConflict(state, command) {
  if (command.kind !== 'link') return false;
  const ledger = replay(state);
  for (const link of ledger.links.values()) {
    if (link.active === true && link.goalId === command.goalId
      && link.txRef === command.txRef) return true;
  }
  return false;
}

function previewValid(preview) {
  keys(preview, ['schema', 'householdId', 'actorId', 'operationId', 'expectedRevision',
    'expectedDocumentDigest', 'issuedAt', 'expiresAt', 'command']);
  if (preview.schema !== PREVIEW_SCHEMA || !household(preview.householdId)
    || !actor(preview.actorId) || !operation(preview.operationId)
    || !Number.isSafeInteger(preview.expectedRevision) || preview.expectedRevision < 0
    || !hash(preview.expectedDocumentDigest) || !tick(preview.issuedAt)
    || preview.expiresAt !== preview.issuedAt + TTL_MS) fail();
  commandValid(preview.command);
}
function prepare(body, input) {
  keys(input, ['householdId', 'actorId', 'operationId', 'command', 'now']);
  const state = decode(body, input.householdId);
  if (!actor(input.actorId) || !operation(input.operationId) || !tick(input.now)) fail();
  if (state.operations.some(event => event.operationId === input.operationId)) fail();
  commandValid(input.command);
  if (activePairConflict(state, input.command)) fail();
  const preview = {
    schema: PREVIEW_SCHEMA, householdId: input.householdId, actorId: input.actorId,
    operationId: input.operationId, expectedRevision: state.revision,
    expectedDocumentDigest: state.digest, issuedAt: input.now, expiresAt: input.now + TTL_MS,
    command: JSON.parse(canonical(input.command)),
  };
  const trial = {
    householdId: state.householdId, revision: state.revision + 1,
    operations: [...state.operations, {
      revision: state.revision + 1, operationId: input.operationId, actorId: input.actorId,
      recordedAt: input.now, requestDigest: digest(preview), command: preview.command,
    }],
  };
  return { preview, confirmationDigest: digest(preview), effect: effectiveEvidence(trial) };
}
function confirmCandidate(body, input) {
  keys(input, ['householdId', 'actorId', 'preview', 'confirmationDigest', 'now']);
  const state = decode(body, input.householdId);
  if (!actor(input.actorId) || !tick(input.now)) fail();
  const recorded = state.operations.find(event => event.operationId
    === (isRecord(input.preview) ? input.preview.operationId : null));
  if (recorded) {
    if (recorded.actorId !== input.actorId || recorded.requestDigest !== input.confirmationDigest) fail();
    const currentPin = pin(body, input.householdId);
    return { status: 'already-recorded', expectedPin: currentPin, nextPin: currentPin, document: body };
  }
  previewValid(input.preview);
  const expectedPin = digest({
    householdId: input.householdId, revision: input.preview.expectedRevision,
    documentDigest: input.preview.expectedDocumentDigest,
  });
  if (input.preview.householdId !== input.householdId || input.preview.actorId !== input.actorId
    || pin(body, input.householdId) !== expectedPin) {
    return { status: 'rejected', reason: 'revision-changed' };
  }
  if (digest(input.preview) !== input.confirmationDigest || input.now >= input.preview.expiresAt) {
    return { status: 'rejected', reason: 'preview-expired' };
  }
  if (activePairConflict(state, input.preview.command)) fail();
  const next = {
    householdId: state.householdId, revision: state.revision + 1,
    operations: [...state.operations, {
      revision: state.revision + 1, operationId: input.preview.operationId,
      actorId: input.actorId, recordedAt: input.now, requestDigest: input.confirmationDigest,
      command: input.preview.command,
    }],
  };
  replay(next);
  const candidate = encode(next);
  return {
    status: 'candidate', expectedPin, nextPin: pin(candidate, input.householdId), document: candidate,
  };
}
function outcome(body, input) {
  keys(input, ['householdId', 'actorId', 'operationId']);
  const state = decode(body, input.householdId);
  if (!actor(input.actorId) || !operation(input.operationId)) fail();
  const recorded = state.operations.find(event => event.operationId === input.operationId);
  if (!recorded) return { status: 'unknown', operationId: input.operationId };
  if (recorded.actorId !== input.actorId) fail();
  return { status: 'recorded', operationId: input.operationId, revision: recorded.revision };
}
function verifyReadback(body, expected) {
  keys(expected, ['householdId', 'operationId', 'nextPin']);
  try {
    if (pin(body, expected.householdId) !== expected.nextPin) return false;
    const state = decode(body, expected.householdId);
    return state.operations.some(event => event.operationId === expected.operationId);
  } catch { return false; }
}

module.exports = {
  SCHEMA, PREVIEW_SCHEMA, TTL_MS, digest, adopt, pin, restore, prepare, confirmCandidate,
  outcome, verifyReadback, effectiveEvidence,
};
