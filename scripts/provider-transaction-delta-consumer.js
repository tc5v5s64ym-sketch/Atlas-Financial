'use strict';
/* Inert Lunch Money transaction-delta CONSUMER (ATLAS-038).
 *
 * This module is NOT wired to any routine, server, assistant/MCP surface,
 * or scheduler. Nothing calls it in production. It exists so the delta
 * reader's consumer contract — scoped under ATLAS-038 and ruled on by
 * Atlas (ChatGPT, Slack ts 1792138178.535059) — has exactly one sanctioned
 * implementation ahead of any future, separately approved wiring step.
 * It adds no persisted watermark, no automatic run, and no exposed tool.
 *
 * ONE CYCLE, IN ORDER:
 *   1. Capture the cycle-start instant BEFORE any fetch. That instant is
 *      the only value the cycle may offer as an advanceable cursor.
 *   2. Run the created pass, then the updated pass, through
 *      Delta.fetchTransactionDelta with the SAME since/token/base.
 *   3. Merge the two passes by providerId (convergence / conflict rules).
 *   4. Build the candidate state and run the mandatory full-window
 *      reconciliation leg against it, in the same cycle.
 *   5. Return merged rows, conflict/divergence records, and the
 *      advanceable cursor or null.
 *
 * CANDIDATE CONSTRUCTION (exact): the candidate compared against the
 * window is the caller-supplied known state keyed by providerId, updated
 * by the cycle's merged delta rows — a delta row replaces the known row
 * with the same providerId, a new providerId is added, and identical
 * payloads collapse to one row. The candidate is then compared
 * row-by-row against the window rows aligned into the same mapped shape
 * via Delta.mapDeltaTransaction. Candidate IDs absent from the window
 * are absent-from-window records (deletion unproven — never deletions);
 * window-only IDs are newly-visible divergences.
 *
 * KNOWN-STATE SCOPE GATE (Q3, round 2 — Systems Review BLOCK 5545500868):
 * known state is a SCOPED input, { rows, scope }, where scope declares
 * the effective date bounds and the four query flags the state was
 * captured under. The scope is required even when rows is empty, and it
 * is validated against the reconciliation scope (the window's effective
 * bounds and emitted flags) BEFORE any diffing. A missing, malformed,
 * or mismatched scope returns an unqualified cycle — status
 * 'unqualified', no certification, no applicable rows, no cursor, no
 * absence findings — because payload equality across incomparable
 * scopes certifies nothing. The round-1 bare-array shape declares no
 * scope and is therefore always unqualified.
 *
 * CONVERGENCE / CONFLICT: the two passes merge as a union by providerId.
 * An ID present in only one pass is included as-is — membership
 * differences between the created/updated predicates are NOT conflicts.
 * The same ID with any divergent mapped field across the passes IS a
 * conflict, and a conflict fails the whole cycle as a unit: no merged
 * output, no candidates, no cursor.
 *
 * CURSOR RULE (three conditions): the cycle-start instant is offered as
 * advanceableCursor only when (i) both delta passes are pageComplete and
 * neither threw, (ii) there is no cross-pass conflict, and (iii) the
 * reconciliation leg is complete AND divergence-free. Otherwise
 * advanceableCursor is null. The consumer never persists, stores, or
 * itself advances a cursor; cursor state is caller-held.
 *
 * OUTPUT RULE: applicable merged rows are returned only on a fully clean
 * cycle. Partial, failed, or divergent cycles return no
 * authoritative/applicable output; where a merge was computed it is
 * returned only as explicitly labelled diagnostic candidates, and a
 * cross-pass conflict withholds merged candidates entirely.
 *
 * WINDOW LEG: the reconciliation window URL is consumer-owned. The span
 * derivation reuses ProviderObserve.lunchMoneyTransactionsUrl (one
 * authority for the date math), and the consumer then sets BOTH topology
 * flags (include_group_children, include_split_parents) on the emitted
 * URL so the window leg is flag-identical to the delta leg; the consumer
 * fails closed if its own emitted URL is not flag-identical. The window
 * descriptor is caller-supplied and validated — no history floor is
 * invented here. Divergence records are computed only on a COMPLETE
 * window read; a truncated or failed window read reports reconciliation
 * incomplete and manufactures no absence claims.
 *
 * HONESTY: ledgerComplete is false in every result. A delta is a change
 * feed, never a complete ledger; the delta envelopes' caveat and
 * updatedAtBehavior are propagated verbatim. ID dedup proves idempotent
 * re-delivery only — never boundary completeness — and merging is never
 * gated on the cursor: a late arrival timestamped behind the cursor
 * still merges by providerId, and repeated cycles converge.
 *
 * Raw provider IDs appear only inside this trust boundary (internal
 * result records and synthetic tests). They are never logged and never
 * cross an assistant/MCP response (ARCHITECTURE.md OAuth boundary).
 * Amounts and every other financial field are preserved verbatim and
 * never interpreted, totalled, rounded, or re-typed; Forecast state is
 * never read or mutated.
 */

const Delta = require('./provider-transaction-delta.js');
const ProviderObserve = require('./provider-observe.js');

const SCHEMA = 'atlas-lunchmoney-transaction-delta-consumer/v1';
const DIAGNOSTIC_LABEL = 'diagnostic — not authoritative, not applicable';

// Fields that describe split/group topology rather than the row's own
// payload. A cross-source difference confined to these fields is a
// topology divergence (still unresolved, still cursor-withholding).
const TOPOLOGY_FIELDS = new Set([
  'isGroupParent',
  'groupParentId',
  'isSplitParent',
  'splitParentId',
  'parentId',
  'children',
]);

const ALIGNMENT_FLAGS = [
  'include_pending',
  'include_metadata',
  'include_group_children',
  'include_split_parents',
];

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => deepEqual(value, b[index]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every(
      (key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]),
    );
  }
  return false;
}

// Names of the top-level mapped fields on which two rows disagree.
function divergentFields(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const fields = [];
  for (const key of keys) {
    if (!deepEqual(a ? a[key] : undefined, b ? b[key] : undefined)) fields.push(key);
  }
  return fields.sort();
}

function compareIds(a, b) {
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB) && String(numA) === a && String(numB) === b) {
    return numA - numB;
  }
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function errorMessage(err) {
  return err && err.message ? String(err.message) : String(err);
}

// Q3: the window is caller-supplied and validated. No floor is invented:
// a missing or invalid descriptor fails closed before any fetch, because
// reconciliation is mandatory in the same cycle (Q7) — there is no
// delta-only cycle.
function validateWindowDescriptor(windowDescriptor) {
  if (!windowDescriptor || typeof windowDescriptor !== 'object') {
    throw new Error('Delta consumer cycle requires a window descriptor { now, historyDays }; reconciliation is mandatory in the same cycle.');
  }
  const { now, historyDays } = windowDescriptor;
  if (now == null || !Number.isFinite(Date.parse(now))) {
    throw new Error('Delta consumer window descriptor "now" must be a parseable timestamp.');
  }
  if (typeof historyDays !== 'number' || !Number.isFinite(historyDays) || historyDays <= 0) {
    throw new Error('Delta consumer window descriptor "historyDays" must be a positive finite number supplied by the caller; no floor is invented.');
  }
  return { now, historyDays };
}

// Q4: known state is caller-supplied and SCOPED — { rows, scope } — and
// is keyed here by providerId. The consumer owns no store and
// integrates with no memory path. A bare array is the round-1 shape: it
// declares no scope, so it parses as rows with a null scope and the
// scope gate returns the cycle unqualified.
function parseKnownStateInput(knownState) {
  if (knownState == null) return { rows: [], scope: null };
  if (Array.isArray(knownState)) return { rows: knownState, scope: null };
  if (typeof knownState === 'object') {
    if (!Array.isArray(knownState.rows)) {
      throw new Error('Delta consumer "knownState.rows" must be an array of mapped transaction rows supplied by the caller.');
    }
    return { rows: knownState.rows, scope: knownState.scope != null ? knownState.scope : null };
  }
  throw new Error('Delta consumer "knownState" must be a scoped input { rows, scope } supplied by the caller.');
}

function indexKnownState(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || row.providerId == null || row.providerId === '') {
      throw new Error('Delta consumer known-state row is missing its providerId; failing closed.');
    }
    const id = String(row.providerId);
    if (byId.has(id)) {
      throw new Error(`Delta consumer known state contains duplicate providerId ${id}; failing closed.`);
    }
    byId.set(id, row);
  }
  return byId;
}

// Q3 scope gate (round 2): normalize the caller-declared known-state
// scope into a comparable form — effective date bounds (YYYY-MM-DD)
// plus the four query flags as booleans. Anything missing or malformed
// normalizes to null, which the gate treats as unqualified: a scope
// that cannot be stated exactly cannot certify anything.
function normalizeKnownStateScope(scope) {
  if (!scope || typeof scope !== 'object') return null;
  const { startDate, endDate } = scope;
  const dateOk = (value) => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value));
  if (!dateOk(startDate) || !dateOk(endDate)) return null;
  const normalized = { startDate, endDate };
  for (const flag of ALIGNMENT_FLAGS) {
    if (typeof scope[flag] !== 'boolean') return null;
    normalized[flag] = scope[flag];
  }
  return normalized;
}

// The reconciliation scope the known-state scope is validated against:
// the window's effective date bounds and its emitted query flags.
function reconciliationScopeOf(windowUrl, descriptor) {
  const scope = {
    startDate: windowUrl.startDate || windowUrl.searchParams.get('start_date'),
    endDate: windowUrl.endDate || windowUrl.searchParams.get('end_date'),
    historyDays: descriptor.historyDays,
  };
  for (const flag of ALIGNMENT_FLAGS) {
    scope[flag] = windowUrl.searchParams.get(flag) === 'true';
  }
  return scope;
}

function knownScopeMatches(knownScope, reconciliationScope) {
  if (!knownScope) return false;
  if (knownScope.startDate !== reconciliationScope.startDate) return false;
  if (knownScope.endDate !== reconciliationScope.endDate) return false;
  return ALIGNMENT_FLAGS.every((flag) => knownScope[flag] === reconciliationScope[flag]);
}

// PIN 1: the window URL is consumer-owned. The incumbent builder derives
// the date span; the consumer then sets both topology flags so the
// emitted window request is flag-identical to the delta leg, and fails
// closed if the emitted URL somehow is not.
function buildConsumerWindowUrl(descriptor, base) {
  const url = ProviderObserve.lunchMoneyTransactionsUrl(descriptor.now, descriptor.historyDays, base);
  url.searchParams.set('include_group_children', 'true');
  url.searchParams.set('include_split_parents', 'true');
  for (const flag of ALIGNMENT_FLAGS) {
    if (url.searchParams.get(flag) !== 'true') {
      throw new Error(`Delta consumer window URL is not flag-aligned with the delta leg (${flag}); failing closed rather than comparing incomparable row sets.`);
    }
  }
  return url;
}

// Union by providerId over the two passes. Identical payloads collapse;
// any divergent mapped field on the same ID is a conflict record.
function mergePasses(createdRows, updatedRows) {
  const byId = new Map();
  const order = [];
  for (const row of createdRows || []) {
    if (!byId.has(row.providerId)) order.push(row.providerId);
    byId.set(row.providerId, row);
  }
  const conflicts = [];
  for (const row of updatedRows || []) {
    const existing = byId.get(row.providerId);
    if (!existing) {
      byId.set(row.providerId, row);
      order.push(row.providerId);
      continue;
    }
    const fields = divergentFields(existing, row);
    if (fields.length) {
      conflicts.push({ providerId: row.providerId, fields });
    }
  }
  conflicts.sort((a, b) => compareIds(a.providerId, b.providerId));
  return { merged: order.map((id) => byId.get(id)), conflicts };
}

// Row-by-row diff of the candidate against a COMPLETE window read.
function diffCandidateAgainstWindow(candidate, windowRows) {
  const divergences = [];
  const windowById = new Map();
  for (const row of windowRows) {
    if (windowById.has(row.providerId)) {
      divergences.push({ providerId: row.providerId, type: 'duplicate-in-window', fields: [] });
    } else {
      windowById.set(row.providerId, row);
    }
  }
  for (const [id, candidateRow] of candidate) {
    const windowRow = windowById.get(id);
    if (!windowRow) {
      // R3: absence from a bounded window is never a deletion finding.
      divergences.push({ providerId: id, type: 'absent-from-window', fields: [], deletionProven: false });
      continue;
    }
    const fields = divergentFields(candidateRow, windowRow);
    if (fields.length) {
      const topologyOnly = fields.every((field) => TOPOLOGY_FIELDS.has(field));
      divergences.push({
        providerId: id,
        type: topologyOnly ? 'topology-mismatch' : 'field-mismatch',
        fields,
      });
    }
  }
  for (const id of windowById.keys()) {
    if (!candidate.has(id)) {
      divergences.push({ providerId: id, type: 'newly-visible', fields: [] });
    }
  }
  divergences.sort((a, b) => compareIds(a.providerId, b.providerId) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return divergences;
}

async function consumeDeltaCycle(options = {}) {
  const {
    since,
    token,
    base,
    fetchOptions,
  } = options;

  // Input validation fails closed BEFORE any fetch.
  if (!token) throw new Error('Delta consumer cycle has no Lunch Money credential.');
  Delta.validateSinceTimestamp(since);
  const descriptor = validateWindowDescriptor(options.window);
  const knownInput = parseKnownStateInput(options.knownState);
  const known = indexKnownState(knownInput.rows);
  const knownScope = normalizeKnownStateScope(knownInput.scope);

  // 1. Cycle-start instant, captured before any fetch. Callers may inject
  // it (tests, a caller's own clock discipline); when injected it must
  // carry an explicit timezone, like `since`.
  const cycleStart = options.cycleStart != null
    ? Delta.validateSinceTimestamp(options.cycleStart)
    : new Date().toISOString();

  const result = {
    schema: SCHEMA,
    status: 'failed',
    ledgerComplete: false,
    caveat: Delta.CAVEAT,
    updatedAtBehavior: Delta.UPDATED_AT_BEHAVIOR,
    cycleStart,
    since,
    pairComplete: false,
    reconciliationOutcome: 'not-run',
    reconciliationComplete: false,
    reconciliationCertified: false,
    reconciliationError: null,
    windowScope: null,
    knownStateScope: knownScope,
    scopeQualified: false,
    rows: null,
    diagnosticCandidates: null,
    conflicts: [],
    divergences: [],
    failures: [],
    advanceableCursor: null,
  };

  // Q3 scope gate — BEFORE any fetch or diffing: the known-state scope
  // must equal the reconciliation scope. The window URL is built here
  // (pure construction, no fetch) so its effective bounds and emitted
  // flags are the exact values the diffing leg will use. A missing,
  // malformed, or mismatched scope returns the cycle unqualified: no
  // certification, no applicable rows, no cursor, no absence findings.
  const windowUrl = buildConsumerWindowUrl(descriptor, base);
  const reconciliationScope = reconciliationScopeOf(windowUrl, descriptor);
  result.windowScope = {
    startDate: reconciliationScope.startDate,
    endDate: reconciliationScope.endDate,
    historyDays: reconciliationScope.historyDays,
  };
  result.scopeQualified = knownScopeMatches(knownScope, reconciliationScope);
  if (!result.scopeQualified) {
    result.status = 'unqualified';
    result.reconciliationOutcome = 'unqualified';
    return result;
  }

  // 2. Created pass, then updated pass — identical since/token/base. A
  // thrown pass fails the cycle closed: no merge, no reconciliation, no
  // partial success.
  let created = null;
  let updated = null;
  try {
    created = await Delta.fetchTransactionDelta({ kind: 'created', since, token, base, fetchOptions });
  } catch (err) {
    result.failures.push({ leg: 'created', error: errorMessage(err) });
  }
  if (created) {
    try {
      updated = await Delta.fetchTransactionDelta({ kind: 'updated', since, token, base, fetchOptions });
    } catch (err) {
      result.failures.push({ leg: 'updated', error: errorMessage(err) });
    }
  }
  if (result.failures.length) {
    return result;
  }
  // Envelope honesty propagates verbatim from the passes themselves.
  result.caveat = created.caveat;
  result.updatedAtBehavior = created.updatedAtBehavior;
  result.pairComplete = created.pageComplete === true && updated.pageComplete === true;

  // 3. Merge. A cross-pass conflict fails the whole cycle as a unit and
  // withholds merged candidates entirely.
  const { merged, conflicts } = mergePasses(created.transactions, updated.transactions);
  if (conflicts.length) {
    result.status = 'conflict';
    result.conflicts = conflicts;
    return result;
  }

  // 4. Candidate = known state keyed by providerId, updated by the merged
  // delta rows; then the mandatory same-cycle reconciliation leg.
  const candidate = new Map(known);
  for (const row of merged) candidate.set(row.providerId, row);

  let windowRows = null;
  try {
    const page = await ProviderObserve.fetchLunchMoneyTransactionsPaged(windowUrl, token, fetchOptions);
    if (page && page.complete === true && page.truncated !== true) {
      windowRows = (page.transactions || []).map((raw) => Delta.mapDeltaTransaction(raw));
      result.reconciliationComplete = true;
    } else {
      result.reconciliationError = 'Full-window reconciliation read did not complete (truncated or has_more unresolved).';
    }
  } catch (err) {
    result.reconciliationError = errorMessage(err);
  }

  // Divergence records are computed only on a complete window read.
  if (result.reconciliationComplete) {
    result.divergences = diffCandidateAgainstWindow(candidate, windowRows);
    result.reconciliationCertified = result.divergences.length === 0;
    result.reconciliationOutcome = result.reconciliationCertified ? 'complete' : 'divergent';
  } else {
    result.reconciliationOutcome = 'incomplete';
  }

  // 5. Outcome. Applicable rows and the advanceable cursor exist only on
  // a fully clean cycle; otherwise the merge is diagnostic only.
  if (result.pairComplete && result.reconciliationCertified) {
    result.status = 'complete';
    result.rows = merged;
    result.advanceableCursor = cycleStart;
  } else {
    // Precedence: any incompleteness outranks divergence — a cycle whose
    // evidence is partial is 'incomplete' even if the complete leg also
    // produced divergence records.
    result.status = (!result.pairComplete || !result.reconciliationComplete)
      ? 'incomplete'
      : 'divergent';
    result.diagnosticCandidates = {
      applicable: false,
      label: DIAGNOSTIC_LABEL,
      rows: merged,
    };
  }
  return result;
}

module.exports = {
  SCHEMA,
  consumeDeltaCycle,
};
