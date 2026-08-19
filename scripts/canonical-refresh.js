'use strict';
/* Earned trusted canonical refresh — B81 / AF-LIVE-02.
 *
 *   node scripts/canonical-refresh.js --fixture <file>
 *   node scripts/canonical-refresh.js --fixture <file> --apply --approve <previewId>
 *   node scripts/canonical-refresh.js --fixture <file> --cutover-as-of YYYY-MM-DD
 *   node scripts/canonical-refresh.js --fixture <file> --cutover-as-of YYYY-MM-DD --apply --approve-cutover <cutoverApprovalId>
 *
 * Default is a non-writing preview. --apply --approve updates only the
 * posted cash/debt fields listed in that preview. previewId cannot
 * authorize pending. Observe and reconcile remain the incumbents.
 * Forecast remains the planner.
 *
 * --cutover-as-of without --apply is preflight. It does not write
 * data.json, meta.asOf, plan.opening, or snapshots. Combining it with
 * --apply --approve <previewId> is refused: posted approval is not a
 * cutover approval. MATCH is not freshness.
 *
 * --cutover-as-of --apply --approve-cutover writes only the exact
 * candidate-date pending transitions in that cutover fingerprint.
 * It does not advance the opening date.
 *
 * Never writes without --apply --approve. Never POST/PUT/PATCH/DELETE
 * Lunch Money. Never stores a token. Unattended production writes are
 * not this command.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const O = require('./provider-observe.js');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const DEFAULT_IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const SCHEMA = 'atlas-canonical-refresh-preview/v1';
const CUTOVER_PENDING_SCHEMA = 'atlas-cutover-pending-approval/v1';
const SNAPSHOT_COMMAND = 'node scripts/snapshot-balances.js';
const EPSILON = 0.005;
const PENDING_ZERO_PROOF = 'is_pending-unbounded';

const POSTED_CASH = new Set(['chequing-a', 'chequing-b', 'savings']);
// Owner-named monthly statement cadence, keyed by canonical Atlas id.
// Not a generic freshness default. Not Lunch Money provider IDs.
const OWNER_STATEMENT_CADENCE = Object.freeze({
  triangle: Object.freeze({ kind: 'monthly-statement', day: 17 }),
  mbna: Object.freeze({ kind: 'monthly-statement', day: 8 }),
});
const FRESHNESS_EXACT_DAY = 'exact-day';
const FRESHNESS_STATEMENT_CADENCE = 'owner-approved-monthly-statement-cadence';
const CREDIT_REFUSE_FACTS = new Set([
  'pending', 'limit', 'available-credit', 'confirmed-payment', 'scheduled-payment',
]);
const BACKFILL_FACTS = new Set(['posting']);
const ISO_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function fail(message) {
  const err = new Error(message);
  err.code = 'refresh-failed';
  throw err;
}

function parseArgs(argv) {
  const out = {
    provider: 'lunchmoney',
    fixture: null,
    live: false,
    map: null,
    data: DEFAULT_DATA,
    apply: false,
    approve: null,
    approveCutover: null,
    identity: DEFAULT_IDENTITY,
    cutoverAsOf: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--provider') out.provider = argv[++i];
    else if (a === '--fixture') out.fixture = argv[++i];
    else if (a === '--live') out.live = true;
    else if (a === '--map') out.map = argv[++i];
    else if (a === '--data') out.data = argv[++i];
    else if (a === '--apply') out.apply = true;
    else if (a === '--approve') out.approve = argv[++i];
    else if (a === '--approve-cutover') out.approveCutover = argv[++i];
    else if (a === '--identity') out.identity = argv[++i];
    else if (a === '--cutover-as-of') out.cutoverAsOf = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--preview-out') {
      fail('--preview-out is not accepted. Preview writes to stdout only and cannot target canonical state.');
    } else {
      fail(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function near(a, b) {
  return Math.abs(Number(a) - Number(b)) <= EPSILON;
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseLocator(locator) {
  if (!locator || typeof locator !== 'string') return null;
  const [collection, rest] = locator.split(':');
  if (!collection || !rest) return null;
  const hash = rest.indexOf('#');
  const id = hash === -1 ? rest : rest.slice(0, hash);
  const field = hash === -1 ? null : rest.slice(hash + 1);
  return { collection, id, field };
}

function cashRow(data, id) {
  const cash = (data.plan && data.plan.startingCash) || {};
  const rows = (cash.breakdown || []).concat(cash.heldElsewhere || []);
  return rows.find(row => row && row.id === id) || null;
}

function debtRow(data, id) {
  return ((data.debts || []).find(row => row && row.id === id)) || null;
}

function readCurrent(data, locator) {
  const parsed = parseLocator(locator);
  if (!parsed) return { found: false, value: null };
  if (parsed.collection === 'cash' && !parsed.field) {
    const row = cashRow(data, parsed.id);
    return row
      ? { found: true, value: Number(row.value), field: 'value' }
      : { found: false, value: null };
  }
  if (parsed.collection === 'debts' && !parsed.field) {
    const row = debtRow(data, parsed.id);
    return row
      ? { found: true, value: Number(row.balance), field: 'balance' }
      : { found: false, value: null };
  }
  return { found: false, value: null };
}

function eligiblePosted(row) {
  const parsed = parseLocator(row && row.canonicalTarget);
  if (!parsed || parsed.field) return false;
  if (row.fact && CREDIT_REFUSE_FACTS.has(row.fact)) return false;
  if (row.fact && BACKFILL_FACTS.has(row.fact)) return false;
  if (parsed.collection === 'cash') {
    return POSTED_CASH.has(parsed.id) && (!row.fact || row.fact === 'posted-balance');
  }
  if (parsed.collection === 'debts') {
    return !row.fact || row.fact === 'posted-balance';
  }
  return false;
}

function refuseReason(row) {
  const fact = row && row.fact;
  if (fact && CREDIT_REFUSE_FACTS.has(fact)) {
    if (fact === 'pending') {
      return row.unknown === true || row.evidenceValue == null
        ? 'unresolved-pending'
        : 'unresolved-pending';
    }
    return 'credit-capacity-not-cash';
  }
  if (fact && BACKFILL_FACTS.has(fact)) return 'historical-opening-backfill';
  if (row && row.status === 'CONFLICT') return 'conflicting-observations';
  if (row && row.status === 'MISSING') return 'unknown-value';
  if (row && (row.unknown === true || row.evidenceValue == null || !isFinite(row.evidenceValue))) {
    return 'unknown-value';
  }
  if (row && row.dateRelation === 'same-day') return 'same-day-no-winner';
  if (row && row.dateRelation === 'canonical-newer') return 'stale-not-current';
  if (row && row.dateRelation === 'incomparable') return 'incomparable-freshness';
  if (!eligiblePosted(row)) return 'not-posted-current-state';
  return 'not-proposed';
}

function sanitizedUnmapped(entry) {
  return {
    reason: 'unmapped-provider-account',
    accountLabel: entry && entry.accountLabel ? String(entry.accountLabel) : null,
  };
}

function proposeFromReport(report) {
  const proposed = [];
  const refused = [];
  const seen = new Set();
  for (const row of (report && report.reconciliation && report.reconciliation.rows) || []) {
    const locator = row.canonicalTarget;
    if (!locator || seen.has(locator + '|' + (row.fact || ''))) continue;
    seen.add(locator + '|' + (row.fact || ''));
    if (row.status === 'MATCH') continue;
    const eligible = eligiblePosted(row)
      && row.status === 'CHANGE'
      && row.dateRelation === 'canonical-older'
      && row.unknown !== true
      && row.evidenceValue != null
      && isFinite(row.evidenceValue)
      && row.canonicalValue != null
      && isFinite(row.canonicalValue);
    if (!eligible) {
      refused.push({
        locator,
        fact: row.fact || null,
        status: row.status || null,
        dateRelation: row.dateRelation || null,
        currentValue: row.canonicalValue,
        observedValue: row.unknown === true ? null : row.evidenceValue,
        evidenceDate: row.evidenceDate || row.observedAsOf || null,
        reason: refuseReason(row),
      });
      continue;
    }
    const parsed = parseLocator(locator);
    proposed.push({
      locator,
      collection: parsed.collection,
      id: parsed.id,
      field: parsed.collection === 'cash' ? 'value' : 'balance',
      currentValue: round2(row.canonicalValue),
      proposedValue: round2(row.evidenceValue),
      evidenceDate: row.evidenceDate || row.observedAsOf || null,
      source: 'provider-observe:lunchmoney',
      dateRelation: row.dateRelation,
      reason: 'reconcile CHANGE; evidence newer than canonical as-of',
    });
  }
  for (const entry of (report && report.unmapped) || []) {
    refused.push(sanitizedUnmapped(entry));
  }
  for (const candidate of (report && report.representedEventCandidates) || []) {
    if (candidate && candidate.mustNotBackfillOpening !== false) {
      refused.push({
        locator: 'plan.opening.representedEvents',
        fact: 'posting',
        eventId: candidate.id || null,
        evidenceDate: candidate.date || null,
        reason: 'historical-opening-backfill',
      });
    }
  }
  proposed.sort((a, b) => String(a.locator).localeCompare(String(b.locator)));
  refused.sort((a, b) => String(a.locator || a.reason).localeCompare(String(b.locator || b.reason))
    || String(a.reason).localeCompare(String(b.reason)));
  return { proposed, refused };
}

function previewFingerprint(proposed, refused) {
  return {
    proposed: (proposed || []).map(row => ({
      locator: row.locator,
      field: row.field,
      currentValue: row.currentValue,
      proposedValue: row.proposedValue,
      evidenceDate: row.evidenceDate,
      reason: row.reason,
    })),
    refused: (refused || []).map(row => ({
      locator: row.locator || null,
      reason: row.reason,
      evidenceDate: row.evidenceDate || null,
    })),
  };
}

function previewIdFrom(proposed, refused) {
  const body = JSON.stringify(previewFingerprint(proposed, refused));
  return crypto.createHash('sha256').update(body).digest('hex');
}

function identityProofLooksSanitized(doc) {
  const blob = JSON.stringify(doc == null ? {} : doc);
  return !/"providerAccountId"\s*:/.test(blob)
    && !/"providerTransactionId"\s*:/.test(blob)
    && !/Bearer\s+\S+/.test(blob)
    && !/LUNCHMONEY_ACCESS_TOKEN/.test(blob);
}

function dateOnly(value) {
  return Forecast.financialDate(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

function ownerStatementCadence(canonicalId) {
  const row = canonicalId ? OWNER_STATEMENT_CADENCE[canonicalId] : null;
  return row ? { kind: row.kind, day: row.day } : null;
}

// Calendar-month day clamp. Same formula Forecast uses; not 30-day arithmetic.
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function statementDateInMonth(year, month, day) {
  const clamped = Math.min(Number(day), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

function currentStatementCycleStart(requestedAsOf, statementDay) {
  if (!isIsoDate(requestedAsOf) || !isFinite(Number(statementDay))) return null;
  const [year, month] = requestedAsOf.split('-').map(Number);
  const thisMonth = statementDateInMonth(year, month, statementDay);
  if (thisMonth <= requestedAsOf) return thisMonth;
  let priorYear = year;
  let priorMonth = month - 1;
  if (priorMonth < 1) {
    priorMonth = 12;
    priorYear -= 1;
  }
  return statementDateInMonth(priorYear, priorMonth, statementDay);
}

function nextStatementDate(cycleStart, statementDay) {
  if (!isIsoDate(cycleStart) || !isFinite(Number(statementDay))) return null;
  const [year, month] = cycleStart.split('-').map(Number);
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  return statementDateInMonth(nextYear, nextMonth, statementDay);
}

function statementCadenceAccepts(canonicalId, evidenceDate, requestedAsOf) {
  const cadence = ownerStatementCadence(canonicalId);
  if (!cadence || cadence.kind !== 'monthly-statement') return false;
  if (!isIsoDate(evidenceDate) || !isIsoDate(requestedAsOf)) return false;
  if (evidenceDate > requestedAsOf) return false;
  const cycleStart = currentStatementCycleStart(requestedAsOf, cadence.day);
  if (!cycleStart) return false;
  const nextStart = nextStatementDate(cycleStart, cadence.day);
  if (nextStart && requestedAsOf >= nextStart) return false;
  return evidenceDate >= cycleStart && evidenceDate <= requestedAsOf;
}

function issue(code, explanation, extra) {
  return Object.assign({ code, explanation }, extra || {});
}

function reconRows(report) {
  return (report && report.reconciliation && report.reconciliation.rows) || [];
}

function isPostedFact(row) {
  if (!row) return false;
  if (row.fact && CREDIT_REFUSE_FACTS.has(row.fact)) return false;
  if (row.fact && BACKFILL_FACTS.has(row.fact)) return false;
  return !row.fact || row.fact === 'posted-balance';
}

function requiredPostedLocators(data) {
  const out = [];
  for (const id of POSTED_CASH) {
    const row = cashRow(data, id);
    out.push({
      locator: `cash:${id}`,
      collection: 'cash',
      id,
      canonicalValue: row && row.value != null && isFinite(Number(row.value))
        ? Number(row.value)
        : null,
    });
  }
  for (const debt of (data && data.debts) || []) {
    if (!debt || !debt.id) continue;
    if (debt.balance == null || !isFinite(Number(debt.balance))) continue;
    out.push({
      locator: `debts:${debt.id}`,
      collection: 'debts',
      id: debt.id,
      canonicalValue: Number(debt.balance),
    });
  }
  return out;
}

function postedRowsForLocator(report, locator) {
  return reconRows(report).filter(row => row && row.canonicalTarget === locator && isPostedFact(row));
}

function pickDatedRow(rows, requestedAsOf, opts) {
  const allowNonExact = !!(opts && opts.allowNonExact);
  if (!rows.length) return null;
  const dated = rows.map(row => ({
    row,
    date: dateOnly(row.evidenceDate || row.observedAsOf),
  }));
  const exact = dated.filter(item => item.date === requestedAsOf);
  if (exact.length) {
    return (exact.find(item => item.row.status === 'CONFLICT') || exact[0]).row;
  }
  if (!allowNonExact) return null;
  const notAfter = dated.filter(item => item.date && item.date <= requestedAsOf)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (notAfter.length) return notAfter[0].row;
  const after = dated.filter(item => item.date && item.date > requestedAsOf)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (after.length) return after[0].row;
  return rows[0];
}

function hasPendingState(debt) {
  if (!debt) return false;
  if (debt.pendingUnknown === true || debt.unknownPending === true) return true;
  if (!Object.prototype.hasOwnProperty.call(debt, 'pending')) return false;
  return debt.secured === false;
}

function pendingRowsForDebt(report, id) {
  const locator = `debts:${id}#pending`;
  return reconRows(report).filter(row => row && row.fact === 'pending' && (
    row.cardId === id || row.canonicalTarget === locator
  ));
}

function pendingCoverageComplete(report) {
  const classified = O.classifyPendingCoverage(report || {});
  return classified.complete === true && classified.status === 'complete'
    && classified.basis === PENDING_ZERO_PROOF && classified.hasMore === false;
}

function pendingObservation(report, cardId) {
  return ((report && report.observations) || []).find(row => (
    row && row.fact === 'pending' && row.cardId === cardId
  )) || null;
}

function canonicalPendingState(debt) {
  const unknown = !!(debt && (debt.pendingUnknown === true || debt.unknownPending === true));
  const known = !unknown && debt && debt.pending != null && debt.pending !== '' && isFinite(Number(debt.pending));
  return {
    unknown,
    known,
    value: known ? Number(debt.pending) : null,
  };
}

function evaluateCandidatePending(debt, report, requestedAsOf) {
  const locator = `debts:${debt.id}#pending`;
  const canonical = canonicalPendingState(debt);
  const candidatePending = pendingRowsForDebt(report, debt.id).filter(item => (
    dateOnly(item.evidenceDate || item.observedAsOf) === requestedAsOf
  ));
  if (candidatePending.some(item => item.status === 'CONFLICT')) {
    return {
      locator,
      kind: 'conflict',
      currentUnknown: canonical.unknown,
      currentValue: canonical.value,
      proposedValue: null,
      evidenceDate: requestedAsOf,
    };
  }
  const row = pickDatedRow(pendingRowsForDebt(report, debt.id), requestedAsOf, { allowNonExact: false });
  const evidenceDate = row ? dateOnly(row.evidenceDate || row.observedAsOf) : null;
  const numeric = !!(row && row.unknown !== true && row.evidenceValue != null && isFinite(row.evidenceValue)
    && evidenceDate === requestedAsOf);
  if (canonical.unknown) {
    if (!numeric) {
      return {
        locator,
        kind: 'unknown-remain',
        currentUnknown: true,
        currentValue: null,
        proposedValue: null,
        evidenceDate: evidenceDate,
      };
    }
  } else if (!canonical.known) {
    return { locator, kind: 'skip', currentUnknown: false, currentValue: null, proposedValue: null, evidenceDate };
  } else if (!numeric) {
    return {
      locator,
      kind: 'unproven',
      currentUnknown: false,
      currentValue: canonical.value,
      proposedValue: null,
      evidenceDate: evidenceDate,
    };
  }
  const proposedValue = round2(row.evidenceValue);
  const obs = pendingObservation(report, debt.id);
  const proof = obs && obs.pendingProof ? String(obs.pendingProof) : null;
  const zero = near(proposedValue, 0);
  const coverageOk = pendingCoverageComplete(report);
  if (!coverageOk || (zero && proof !== PENDING_ZERO_PROOF)) {
    if (canonical.unknown) {
      return {
        locator,
        kind: 'unknown-remain',
        currentUnknown: true,
        currentValue: null,
        proposedValue: null,
        evidenceDate,
      };
    }
    if (zero || !numeric) {
      return {
        locator,
        kind: 'unproven',
        currentUnknown: false,
        currentValue: canonical.value,
        proposedValue: null,
        evidenceDate,
      };
    }
    return {
      locator,
      kind: 'unwritable',
      currentUnknown: false,
      currentValue: canonical.value,
      proposedValue,
      evidenceDate,
    };
  }
  if (!canonical.unknown && near(proposedValue, canonical.value)) {
    return {
      locator,
      kind: 'match',
      currentUnknown: false,
      currentValue: canonical.value,
      proposedValue,
      evidenceDate,
      proof: zero ? PENDING_ZERO_PROOF : (proof || 'candidate-date-pending'),
    };
  }
  return {
    locator,
    kind: 'writable',
    currentUnknown: canonical.unknown,
    currentValue: canonical.value,
    proposedValue,
    evidenceDate,
    proof: zero ? PENDING_ZERO_PROOF : (proof || 'candidate-date-pending'),
    cardId: debt.id,
  };
}

function pendingTransitionFromEval(evaluated) {
  return {
    locator: evaluated.locator,
    collection: 'debts',
    id: evaluated.cardId,
    field: 'pending',
    currentUnknown: evaluated.currentUnknown === true,
    currentValue: evaluated.currentUnknown ? null : round2(evaluated.currentValue),
    proposedValue: round2(evaluated.proposedValue),
    evidenceDate: evaluated.evidenceDate,
    proof: evaluated.proof,
    source: 'provider-observe:lunchmoney',
    reason: evaluated.currentUnknown
      ? 'UNKNOWN canonical pending; candidate-date evidence is numeric'
      : 'candidate-date pending differs from canonical pending',
  };
}

function cutoverPendingFingerprint(requestedAsOf, transitions) {
  return {
    schema: CUTOVER_PENDING_SCHEMA,
    requestedAsOf,
    transitions: (transitions || []).map(row => ({
      locator: row.locator,
      currentUnknown: row.currentUnknown === true,
      currentValue: row.currentUnknown === true ? null : row.currentValue,
      proposedValue: row.proposedValue,
      evidenceDate: row.evidenceDate,
      proof: row.proof || null,
    })),
  };
}

function cutoverApprovalIdFrom(requestedAsOf, transitions) {
  const body = JSON.stringify(cutoverPendingFingerprint(requestedAsOf, transitions));
  return crypto.createHash('sha256').update(body).digest('hex');
}

function collectPendingDebts(data, report) {
  const pendingDebts = [];
  const seenPending = new Set();
  for (const debt of (data && data.debts) || []) {
    if (!hasPendingState(debt) || seenPending.has(debt.id)) continue;
    seenPending.add(debt.id);
    pendingDebts.push(debt);
  }
  for (const row of reconRows(report)) {
    if (!row || row.fact !== 'pending' || !row.cardId || seenPending.has(row.cardId)) continue;
    const debt = debtRow(data, row.cardId);
    if (!debt || !hasPendingState(debt)) continue;
    seenPending.add(row.cardId);
    pendingDebts.push(debt);
  }
  return pendingDebts;
}

function proposePendingTransitions(data, report, requestedAsOf) {
  const proposed = [];
  for (const debt of collectPendingDebts(data, report)) {
    const evaluated = evaluateCandidatePending(debt, report, requestedAsOf);
    if (evaluated.kind === 'writable') proposed.push(pendingTransitionFromEval(evaluated));
  }
  proposed.sort((a, b) => String(a.locator).localeCompare(String(b.locator)));
  return proposed;
}

function schedulePlan(plan) {
  return {
    income: (plan && plan.income) || [],
    obligations: (plan && plan.obligations) || [],
    bills: (plan && plan.bills) || [],
    commitments: (plan && plan.commitments) || [],
    startingCash: plan && plan.startingCash,
    opening: plan && plan.opening,
  };
}

function isJointCashOutflow(event) {
  return !!(event && event.amount < 0 && event.kind !== 'noncash' && event.jointCash !== false);
}

function carriedUnresolvedOutflows(data, requestedAsOf) {
  const plan = data && data.plan;
  if (!plan) return { count: 0, total: 0, items: [] };
  const events = Forecast.expandEvents(schedulePlan(plan), requestedAsOf, requestedAsOf, {});
  const items = [];
  for (const event of events) {
    if (!event || event.date >= requestedAsOf) continue;
    if (!isJointCashOutflow(event)) continue;
    items.push({
      id: event.id || null,
      scheduledDate: event.date,
      amount: round2(event.amount),
      kind: event.kind || null,
    });
  }
  items.sort((a, b) => String(a.scheduledDate).localeCompare(String(b.scheduledDate))
    || String(a.id).localeCompare(String(b.id)));
  const total = round2(items.reduce((sum, item) => sum + Number(item.amount), 0));
  return { count: items.length, total, items };
}

function sameDayScheduledEvents(data, requestedAsOf) {
  const plan = data && data.plan;
  if (!plan) return [];
  return Forecast.expandEvents(schedulePlan(plan), requestedAsOf, requestedAsOf, {})
    .filter(event => event && event.date === requestedAsOf && event.kind !== 'noncash');
}

function sanitizedRepresentedCandidates(report, requestedAsOf) {
  return ((report && report.representedEventCandidates) || []).map((candidate) => {
    const classified = O.classifyRepresentedCandidate(candidate, requestedAsOf);
    return {
      id: classified.id || null,
      date: classified.date || null,
      openingRelevance: classified.openingRelevance,
      currentOpeningImpact: classified.currentOpeningImpact === true,
      mustNotBackfillOpening: classified.mustNotBackfillOpening !== false,
    };
  });
}

function pushUnique(list, item) {
  const key = [item.code, item.locator || '', item.eventId || '', item.evidenceDate || ''].join('|');
  if (list.some(existing => [existing.code, existing.locator || '', existing.eventId || '', existing.evidenceDate || ''].join('|') === key)) {
    return;
  }
  list.push(item);
}

function newerEvidenceSupersedes(report, locator, requestedAsOf) {
  return postedRowsForLocator(report, locator).some((row) => {
    const evidenceDate = dateOnly(row.evidenceDate || row.observedAsOf);
    return evidenceDate === requestedAsOf
      && row.status !== 'CONFLICT'
      && row.status !== 'MISSING'
      && row.unknown !== true
      && row.evidenceValue != null
      && isFinite(row.evidenceValue)
      && row.dateRelation === 'canonical-older';
  });
}

function buildOpeningCutover(data, report, requestedAsOf) {
  if (!isIsoDate(requestedAsOf)) {
    fail('--cutover-as-of must be an explicit YYYY-MM-DD date. Do not infer it from fetchedAt.');
  }
  const blockers = [];
  const warnings = [];
  const metaAsOf = data && data.meta && data.meta.asOf ? String(data.meta.asOf) : null;
  const openingAsOf = data && data.plan && data.plan.opening && data.plan.opening.asOf
    ? String(data.plan.opening.asOf)
    : null;

  if (!metaAsOf || !openingAsOf || metaAsOf !== openingAsOf) {
    pushUnique(blockers, issue(
      'canonical-as-of-incoherent',
      'meta.asOf and plan.opening.asOf must already agree before Atlas can reason about a successor opening.',
      { currentMetaAsOf: metaAsOf, currentOpeningAsOf: openingAsOf }
    ));
  }
  if (openingAsOf && requestedAsOf < openingAsOf) {
    pushUnique(blockers, issue(
      'requested-as-of-before-current-opening',
      'A requested cutover date earlier than the current canonical opening is rejected.',
      { requestedAsOf, currentOpeningAsOf: openingAsOf }
    ));
  }
  if (openingAsOf && requestedAsOf === openingAsOf) {
    pushUnique(warnings, issue(
      'same-date-not-an-opening-advance',
      'This is a same-date diagnostic of the current opening, not an opening-date advance.'
    ));
  }

  const accountFreshness = requiredPostedLocators(data).map((loc) => {
    const rows = postedRowsForLocator(report, loc.locator);
    const row = pickDatedRow(rows, requestedAsOf, { allowNonExact: true });
    const evidenceDate = row ? dateOnly(row.evidenceDate || row.observedAsOf) : null;
    const observedValue = row && row.unknown !== true && row.evidenceValue != null && isFinite(row.evidenceValue)
      ? row.evidenceValue
      : null;
    const exactDay = evidenceDate === requestedAsOf;
    const cadenceAccepted = statementCadenceAccepts(loc.id, evidenceDate, requestedAsOf);
    const trustworthy = !!(row
      && row.unknown !== true
      && observedValue != null
      && row.status !== 'CONFLICT'
      && row.status !== 'MISSING');
    const fresh = !!(trustworthy && (exactDay || cadenceAccepted));
    const freshnessBasis = !fresh
      ? null
      : (exactDay ? FRESHNESS_EXACT_DAY : FRESHNESS_STATEMENT_CADENCE);
    if (!row) {
      pushUnique(blockers, issue(
        'missing-posted-opening-evidence',
        `No trustworthy posted evidence exists for ${loc.locator} on ${requestedAsOf}.`,
        { locator: loc.locator }
      ));
    } else if (row.status === 'CONFLICT' && (exactDay || cadenceAccepted)) {
      pushUnique(blockers, issue(
        'same-day-no-winner',
        `Conflicting posted observations for ${loc.locator} on ${requestedAsOf} have no trustworthy winner.`,
        { locator: loc.locator, evidenceDate }
      ));
    } else if (!fresh && evidenceDate !== requestedAsOf) {
      pushUnique(blockers, issue(
        'stale-posted-opening-evidence',
        `Posted evidence for ${loc.locator} is dated ${evidenceDate || 'unknown'}, not ${requestedAsOf}. MATCH is not freshness.`,
        { locator: loc.locator, evidenceDate, reconcileStatus: row.status || null }
      ));
    }
    return {
      locator: loc.locator,
      canonicalValue: loc.canonicalValue,
      observedValue,
      evidenceDate,
      reconcileStatus: row ? (row.status || null) : 'MISSING',
      dateRelation: row ? (row.dateRelation || null) : null,
      freshForRequestedAsOf: fresh,
      freshnessBasis,
    };
  });

  const pendingTransitions = [];
  for (const debt of collectPendingDebts(data, report)) {
    const evaluated = evaluateCandidatePending(debt, report, requestedAsOf);
    const locator = evaluated.locator;
    if (evaluated.kind === 'conflict') {
      pushUnique(blockers, issue(
        'pending-state-change-unresolved',
        `Candidate-date pending observations for ${debt.id} conflict. Atlas cannot choose one numeric pending amount. Pending cannot be written.`,
        {
          locator,
          canonicalValue: evaluated.currentValue,
          observedValue: null,
        }
      ));
      continue;
    }
    if (evaluated.kind === 'unknown-remain') {
      pushUnique(warnings, issue(
        'pending-remains-unknown',
        `Canonical pending for ${debt.id} remains UNKNOWN. UNKNOWN is not zero.`,
        { locator, observedValue: null }
      ));
      continue;
    }
    if (evaluated.kind === 'unproven') {
      pushUnique(blockers, issue(
        'pending-freshness-unproven',
        !evaluated.evidenceDate
          ? `Canonical pending for ${debt.id} is a known numeric value from an older opening and has no candidate-date evidence. It is not current.`
          : `Candidate-date pending evidence for ${debt.id} does not prove the numeric pending state.`,
        { locator, canonicalValue: evaluated.currentValue, observedValue: null }
      ));
      continue;
    }
    if (evaluated.kind === 'unwritable') {
      pushUnique(blockers, issue(
        'pending-state-change-unresolved',
        `Candidate-date pending for ${debt.id} differs from canonical pending. The new opening cannot retain ${evaluated.currentValue}. Pending cannot be written.`,
        { locator, canonicalValue: evaluated.currentValue, observedValue: evaluated.proposedValue }
      ));
      continue;
    }
    if (evaluated.kind === 'writable') {
      pendingTransitions.push(pendingTransitionFromEval(evaluated));
    }
  }
  pendingTransitions.sort((a, b) => String(a.locator).localeCompare(String(b.locator)));
  const cutoverApprovalId = pendingTransitions.length
    ? cutoverApprovalIdFrom(requestedAsOf, pendingTransitions)
    : null;

  for (const discrepancy of (report && report.sameDayDiscrepancies) || []) {
    if (!discrepancy || !discrepancy.canonicalTarget) continue;
    if (discrepancy.fact && CREDIT_REFUSE_FACTS.has(discrepancy.fact) && discrepancy.fact !== 'pending') continue;
    if (discrepancy.fact === 'pending') continue;
    if (newerEvidenceSupersedes(report, discrepancy.canonicalTarget, requestedAsOf)) continue;
    pushUnique(blockers, issue(
      'same-day-no-winner',
      `Same-day reconciliation conflict for ${discrepancy.canonicalTarget} has no trustworthy winner and must not silently participate in the requested opening.`,
      {
        locator: discrepancy.canonicalTarget,
        evidenceDate: discrepancy.evidenceDate || null,
        fact: discrepancy.fact || null,
      }
    ));
  }

  const candidates = sanitizedRepresentedCandidates(report, requestedAsOf);
  const sameDayEvents = sameDayScheduledEvents(data, requestedAsOf).map((event) => {
    const hit = candidates.find(candidate => candidate.id === event.id
      && candidate.date === event.date
      && candidate.currentOpeningImpact === true);
    if (hit) {
      return {
        id: event.id,
        date: event.date,
        kind: event.kind,
        amount: round2(event.amount),
        representation: 'REPRESENTED',
        representedEventsCandidate: { id: event.id, date: event.date },
      };
    }
    return {
      id: event.id,
      date: event.date,
      kind: event.kind,
      amount: round2(event.amount),
      representation: 'UNKNOWN',
      representedEventsCandidate: null,
    };
  });
  for (const event of sameDayEvents) {
    if (event.representation !== 'UNKNOWN') continue;
    pushUnique(blockers, issue(
      'same-day-event-representation-unknown',
      `Scheduled cash event ${event.id} on ${event.date} is not proven to be already inside the observed opening balances.`,
      { eventId: event.id, date: event.date }
    ));
  }
  for (const candidate of candidates) {
    if (!candidate.date || candidate.date >= requestedAsOf) continue;
    pushUnique(warnings, issue(
      'historical-represented-candidate-not-promoted',
      `Provider identity hit for ${candidate.id} on ${candidate.date} is historical evidence and must not become representedEvents on ${requestedAsOf}.`,
      { eventId: candidate.id, evidenceDate: candidate.date }
    ));
  }

  const unmappedCount = report && report.unmapped ? report.unmapped.length : 0;
  if (unmappedCount > 0) {
    pushUnique(warnings, issue(
      'unmapped-account-materiality-unknown',
      'Unmapped provider accounts are not inferred into household state. Materiality remains unknown; they are not spendable household cash.',
      { unmappedCount }
    ));
  }

  blockers.sort((a, b) => String(a.code).localeCompare(String(b.code))
    || String(a.locator || '').localeCompare(String(b.locator || ''))
    || String(a.eventId || '').localeCompare(String(b.eventId || '')));
  warnings.sort((a, b) => String(a.code).localeCompare(String(b.code))
    || String(a.locator || '').localeCompare(String(b.locator || ''))
    || String(a.eventId || '').localeCompare(String(b.eventId || '')));

  return {
    requestedAsOf,
    currentMetaAsOf: metaAsOf,
    currentOpeningAsOf: openingAsOf,
    writesOpening: false,
    cutoverWriteSupported: false,
    pendingWriteSupported: pendingTransitions.length > 0,
    cutoverApprovalId,
    pendingTransitions,
    status: blockers.length ? 'BLOCKED' : 'READY_FOR_OWNER_REVIEW',
    accountFreshness,
    blockers,
    warnings,
    sameDayEvents,
    carriedUnresolvedOutflows: carriedUnresolvedOutflows(data, requestedAsOf),
    unmappedCount,
  };
}

function buildPreview(report, opts) {
  const { proposed, refused } = proposeFromReport(report);
  const previewId = previewIdFrom(proposed, refused);
  return {
    schema: SCHEMA,
    writesCanonicalState: false,
    canonicalWriteAuthorized: false,
    unattended: false,
    productionWrite: false,
    previewId,
    source: 'provider-observe:lunchmoney',
    fetchedAt: report && report.fetchedAt ? report.fetchedAt : null,
    proposed,
    refused,
    unmappedCount: (report && report.unmapped ? report.unmapped.length : 0),
    cardCapacityIsCash: report && report.cardCapacityIsCash === 0
      ? 0
      : (report && report.cardCapacityIsCash) || 0,
    snapshotFollows: SNAPSHOT_COMMAND,
    identityProofSanitized: true,
    note: (opts && opts.note)
      || 'Preview only. No approval means no canonical write. Opening as-of is not a new cutover.',
  };
}

function observeInput(args, data, payload, accountMap) {
  const identity = fs.existsSync(args.identity) ? loadJson(args.identity) : { rules: [], billPaymentPayees: [] };
  return {
    provider: 'lunchmoney',
    payload,
    accountMap,
    data,
    identity,
    fetchedAt: payload && payload.fetchedAt,
  };
}

async function loadPayload(args) {
  if (args.live && args.fixture) fail('Use either --fixture or --live, not both.');
  if (!args.live && !args.fixture) fail('Pass --fixture <file> or --live.');
  if (args.live) {
    return O.fetchLunchMoneyLive(
      process.env[O.TOKEN_ENV],
      new Date().toISOString(),
      O.historyDaysFromArgs({ mode: 'current-state' })
    );
  }
  return loadJson(args.fixture);
}

function previewFrom(input, opts) {
  const report = O.observe(input);
  const preview = buildPreview(report);
  if (opts && opts.cutoverAsOf) {
    preview.openingCutover = buildOpeningCutover(input.data, report, opts.cutoverAsOf);
  }
  preview.identityProofSanitized = identityProofLooksSanitized(preview);
  if (!preview.identityProofSanitized) fail('Preview is not sanitized.');
  return { report, preview };
}

function applyChange(data, change) {
  const parsed = parseLocator(change.locator);
  if (!parsed) fail(`Unsupported locator: ${change.locator}`);
  if (parsed.collection === 'cash' && change.field === 'value' && POSTED_CASH.has(parsed.id)) {
    const row = cashRow(data, parsed.id);
    if (!row) fail(`Missing cash row ${parsed.id}`);
    if (!near(row.value, change.currentValue)) {
      fail(`Stale preview for ${change.locator}: canonical is ${row.value}, preview expected ${change.currentValue}`);
    }
    row.value = round2(change.proposedValue);
    return;
  }
  if (parsed.collection === 'debts' && change.field === 'balance' && !parsed.field) {
    const row = debtRow(data, parsed.id);
    if (!row) fail(`Missing debt row ${parsed.id}`);
    if (!near(row.balance, change.currentValue)) {
      fail(`Stale preview for ${change.locator}: canonical is ${row.balance}, preview expected ${change.currentValue}`);
    }
    row.balance = round2(change.proposedValue);
    return;
  }
  fail(`Refusing write of ${change.locator} field ${change.field}`);
}

function collectNumericState(data) {
  const out = {};
  for (const id of POSTED_CASH) {
    const row = cashRow(data, id);
    if (row) out[`cash:${id}`] = Number(row.value);
  }
  for (const row of data.debts || []) {
    if (row && row.id) out[`debts:${row.id}`] = Number(row.balance);
  }
  return out;
}

function validateApplied(before, after, preview) {
  if (!after || !after.plan || !after.plan.startingCash) fail('Applied document is missing plan.startingCash.');
  if (!Array.isArray(after.debts)) fail('Applied document is missing debts.');
  if (!after.meta || !after.meta.asOf) fail('Applied document is missing meta.asOf.');
  const allowed = new Set((preview.proposed || []).map(row => row.locator));
  const beforeNums = collectNumericState(before);
  const afterNums = collectNumericState(after);
  for (const locator of Object.keys(beforeNums)) {
    if (allowed.has(locator)) continue;
    if (!near(beforeNums[locator], afterNums[locator])) {
      fail(`Unapproved locator changed: ${locator}`);
    }
  }
  for (const change of preview.proposed || []) {
    const got = afterNums[change.locator];
    if (got == null || !near(got, change.proposedValue)) {
      fail(`Approved locator ${change.locator} did not receive ${change.proposedValue}`);
    }
  }
  const cash = Forecast.startingCashAmount(after.plan);
  if (!isFinite(cash)) fail('Forecast cannot consume the applied starting cash.');
  if (after.plan.nextDollar && before.plan.nextDollar) {
    if (JSON.stringify(after.plan.nextDollar) !== JSON.stringify(before.plan.nextDollar)) {
      fail('Refresh must not rewrite plan.nextDollar.');
    }
  }
}

function encodeData(data) {
  return `${JSON.stringify(data, null, 4)}\n`;
}

function replaceFileAtomically(dest, nextBytes) {
  const destPath = path.resolve(dest);
  const tmp = `${destPath}.atlas-refresh-tmp`;
  fs.writeFileSync(tmp, nextBytes, { encoding: 'utf8' });
  try {
    const fd = fs.openSync(tmp, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    // POSIX rename and Node's Windows MoveFileEx replace dest in one step.
    // If that replace cannot complete, fail closed with dest still intact.
    // Never rename dest aside: a crash between dest→bak and tmp→dest would
    // leave canonical state missing.
    fs.renameSync(tmp, destPath);
    JSON.parse(fs.readFileSync(destPath, 'utf8'));
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw err;
  }
}

function readCanonicalPending(data, id) {
  const row = debtRow(data, id);
  if (!row) return { found: false, unknown: false, value: null, limit: null, balance: null };
  const unknown = row.pendingUnknown === true || row.unknownPending === true;
  const known = !unknown && row.pending != null && row.pending !== '' && isFinite(Number(row.pending));
  return {
    found: true,
    unknown,
    value: known ? Number(row.pending) : null,
    limit: row.limit == null || row.limit === '' ? null : Number(row.limit),
    balance: row.balance == null || row.balance === '' ? null : Number(row.balance),
  };
}

function applyPendingChange(data, change) {
  const parsed = parseLocator(change && change.locator);
  if (!parsed || parsed.collection !== 'debts' || parsed.field !== 'pending' || change.field !== 'pending') {
    fail(`Refusing pending write of ${change && change.locator} field ${change && change.field}`);
  }
  const row = debtRow(data, parsed.id);
  if (!row) fail(`Missing debt row ${parsed.id}`);
  if (row.secured !== false) fail(`Pending write refused for secured debt ${parsed.id}`);
  if (!hasPendingState(row)) fail(`Pending write refused for debt without pending state ${parsed.id}`);
  const current = readCanonicalPending(data, parsed.id);
  if (change.currentUnknown === true) {
    if (!current.unknown) {
      fail(`Stale cutover pending preview for ${change.locator}: canonical is no longer UNKNOWN`);
    }
  } else {
    if (current.unknown) {
      fail(`Stale cutover pending preview for ${change.locator}: canonical became UNKNOWN`);
    }
    if (current.value == null || !near(current.value, change.currentValue)) {
      fail(`Stale cutover pending preview for ${change.locator}: canonical is ${current.value}, preview expected ${change.currentValue}`);
    }
  }
  if (change.proposedValue == null || !isFinite(Number(change.proposedValue))) {
    fail(`Pending write refused unknown proposed value for ${change.locator}`);
  }
  row.pending = round2(change.proposedValue);
  row.pendingUnknown = false;
  if (Object.prototype.hasOwnProperty.call(row, 'unknownPending')) row.unknownPending = false;
}

function collectPendingNumericState(data) {
  const out = {};
  for (const row of data.debts || []) {
    if (!row || !row.id || !hasPendingState(row)) continue;
    const current = readCanonicalPending(data, row.id);
    out[`debts:${row.id}#pending`] = {
      unknown: current.unknown,
      value: current.unknown ? null : current.value,
      limit: current.limit,
      balance: current.balance,
    };
  }
  return out;
}

function validatePendingApplied(before, after, preview) {
  if (!after || !after.plan || !after.plan.startingCash) fail('Applied document is missing plan.startingCash.');
  if (!Array.isArray(after.debts)) fail('Applied document is missing debts.');
  if (!after.meta || !after.meta.asOf) fail('Applied document is missing meta.asOf.');
  if (String(after.meta.asOf) !== String(before.meta.asOf)) fail('Pending write must not move meta.asOf.');
  const beforeOpening = before.plan.opening && before.plan.opening.asOf;
  const afterOpening = after.plan.opening && after.plan.opening.asOf;
  if (String(afterOpening) !== String(beforeOpening)) fail('Pending write must not move plan.opening.asOf.');
  if (JSON.stringify(after.plan.opening && after.plan.opening.representedEvents)
    !== JSON.stringify(before.plan.opening && before.plan.opening.representedEvents)) {
    fail('Pending write must not rewrite representedEvents.');
  }
  if (after.plan.nextDollar && before.plan.nextDollar
    && JSON.stringify(after.plan.nextDollar) !== JSON.stringify(before.plan.nextDollar)) {
    fail('Pending write must not rewrite plan.nextDollar.');
  }
  const allowed = new Set((preview.openingCutover.pendingTransitions || []).map(row => row.locator));
  const beforePosted = collectNumericState(before);
  const afterPosted = collectNumericState(after);
  for (const locator of Object.keys(beforePosted)) {
    if (!near(beforePosted[locator], afterPosted[locator])) {
      fail(`Unapproved locator changed: ${locator}`);
    }
  }
  const beforePending = collectPendingNumericState(before);
  const afterPending = collectPendingNumericState(after);
  for (const locator of Object.keys(beforePending)) {
    const prev = beforePending[locator];
    const next = afterPending[locator];
    if (!next) fail(`Pending locator disappeared: ${locator}`);
    if (prev.limit != null && next.limit != null && !near(prev.limit, next.limit)) {
      fail(`Pending write must not change limit on ${locator}`);
    }
    if (allowed.has(locator)) continue;
    if (prev.unknown !== next.unknown || (prev.value == null ? next.value != null : !near(prev.value, next.value))) {
      fail(`Unapproved pending locator changed: ${locator}`);
    }
  }
  for (const change of preview.openingCutover.pendingTransitions || []) {
    const got = afterPending[change.locator];
    if (!got || got.unknown || got.value == null || !near(got.value, change.proposedValue)) {
      fail(`Approved pending locator ${change.locator} did not receive ${change.proposedValue}`);
    }
  }
  const cash = Forecast.startingCashAmount(after.plan);
  if (!isFinite(cash)) fail('Forecast cannot consume the applied starting cash.');
  const used = Forecast.utilisation(after.debts, null, after.plan);
  if (!used || !Array.isArray(used.rows)) fail('Forecast cannot consume the applied debt pending state.');
}

function applyPendingPreview(data, preview, destPath) {
  const cutover = preview && preview.openingCutover;
  if (!preview || preview.schema !== SCHEMA) fail('Preview schema is not the earned refresh preview.');
  if (!cutover || cutover.writesOpening === true) fail('Opening cutover write is not this approval.');
  if (!cutover.cutoverApprovalId) fail('Cutover pending approval is missing.');
  if (!Array.isArray(cutover.pendingTransitions) || !cutover.pendingTransitions.length) {
    fail('Empty cutover pending proposal cannot authorize a write.');
  }
  const recomputed = cutoverApprovalIdFrom(cutover.requestedAsOf, cutover.pendingTransitions);
  if (String(recomputed) !== String(cutover.cutoverApprovalId)) {
    fail('Cutover approval fingerprint does not match the pending proposal. Canonical state was not written.');
  }
  const next = clone(data);
  for (const change of cutover.pendingTransitions) applyPendingChange(next, change);
  validatePendingApplied(data, next, preview);
  const encoded = encodeData(next);
  JSON.parse(encoded);
  replaceFileAtomically(destPath, encoded);
  const written = loadJson(destPath);
  validatePendingApplied(data, written, preview);
  return written;
}

function applyPreview(data, preview, destPath) {
  if (!preview || preview.schema !== SCHEMA) fail('Preview schema is not the earned refresh preview.');
  if (!preview.previewId) fail('Preview is missing previewId.');
  if ((preview.proposed || []).some(row => row && (row.field === 'pending' || /#pending$/.test(String(row.locator || ''))))) {
    fail('Posted preview cannot authorize pending. Canonical state was not written.');
  }
  if (!Array.isArray(preview.proposed) || !preview.proposed.length) {
    fail('Empty preview cannot authorize a canonical write.');
  }
  const next = clone(data);
  for (const change of preview.proposed) applyChange(next, change);
  validateApplied(data, next, preview);
  const encoded = encodeData(next);
  JSON.parse(encoded);
  replaceFileAtomically(destPath, encoded);
  const written = loadJson(destPath);
  validateApplied(data, written, preview);
  return written;
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/canonical-refresh.js --fixture <file> [--map <file>] [--data <file>]\n'
      + '       node scripts/canonical-refresh.js --fixture <file> --apply --approve <previewId> --data <file>\n'
      + '       node scripts/canonical-refresh.js --fixture <file> --cutover-as-of YYYY-MM-DD\n'
      + '       node scripts/canonical-refresh.js --fixture <file> --cutover-as-of YYYY-MM-DD --apply --approve-cutover <cutoverApprovalId> --data <file>\n'
      + 'Default is a non-writing preview. --apply --approve writes posted fields only.\n'
      + '--cutover-as-of without --approve-cutover is read-only. previewId cannot authorize pending.\n'
    );
    return 0;
  }
  if (args.provider !== 'lunchmoney') fail('Only --provider lunchmoney is implemented.');
  if (args.approve && args.approveCutover) {
    fail('Posted preview approval and cutover pending approval cannot be combined. Canonical state was not written.');
  }
  if (args.approveCutover && !args.cutoverAsOf) {
    fail('--approve-cutover requires --cutover-as-of. Canonical state was not written.');
  }
  if (args.cutoverAsOf && args.approve) {
    fail('--cutover-as-of is read-only for posted previewId. Combining it with --approve is refused. Canonical state was not written.');
  }
  if (args.cutoverAsOf && args.apply && !args.approveCutover) {
    fail('--cutover-as-of is read-only without --approve-cutover. Canonical state was not written.');
  }
  if (args.cutoverAsOf && !isIsoDate(args.cutoverAsOf)) {
    fail('--cutover-as-of must be an explicit YYYY-MM-DD date. Do not infer it from fetchedAt.');
  }
  if (args.apply && !args.approve && !args.approveCutover) {
    fail('No approval = no canonical write. Pass --approve <previewId> or --approve-cutover <cutoverApprovalId>.');
  }
  const data = loadJson(args.data);
  const originalBytes = fs.readFileSync(args.data);
  const payload = await loadPayload(args);
  const mapPath = args.map || O.resolveMapPath({ live: args.live, fixture: args.fixture, map: args.map });
  const accountMap = loadJson(mapPath);
  if (args.live) O.assertLiveMap(accountMap);
  const { preview } = previewFrom(
    observeInput(args, data, payload, accountMap),
    args.cutoverAsOf ? { cutoverAsOf: args.cutoverAsOf } : undefined
  );
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    return 0;
  }
  if (args.approveCutover) {
    const cutover = preview.openingCutover;
    if (!cutover || !cutover.cutoverApprovalId) {
      fail('No cutover pending proposal exists to approve. Canonical state was not written.');
    }
    if (String(args.approveCutover) === String(preview.previewId)) {
      fail('Posted previewId cannot authorize a pending write. Canonical state was not written.');
    }
    if (String(args.approveCutover) !== String(cutover.cutoverApprovalId)) {
      fail('Cutover approval does not match the recomputed pending proposal. Canonical state was not written.');
    }
    applyPendingPreview(data, preview, args.data);
    const afterBytes = fs.readFileSync(args.data);
    const result = {
      schema: CUTOVER_PENDING_SCHEMA,
      writesCanonicalState: true,
      canonicalWriteAuthorized: true,
      unattended: false,
      productionWrite: false,
      previewId: preview.previewId,
      cutoverApprovalId: cutover.cutoverApprovalId,
      requestedAsOf: cutover.requestedAsOf,
      applied: cutover.pendingTransitions,
      snapshotFollows: SNAPSHOT_COMMAND,
      byteChange: afterBytes.compare(originalBytes) !== 0,
      note: 'Bounded owner-approved pending write. Opening as-of was not advanced. Posted previewId did not authorize this write.',
    };
    if (!identityProofLooksSanitized(result)) fail('Apply result is not sanitized.');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (String(args.approve) !== String(preview.previewId)) {
    fail('Approval does not match the recomputed preview. Canonical state was not written.');
  }
  applyPreview(data, preview, args.data);
  const afterBytes = fs.readFileSync(args.data);
  const result = {
    schema: SCHEMA,
    writesCanonicalState: true,
    canonicalWriteAuthorized: true,
    unattended: false,
    productionWrite: false,
    previewId: preview.previewId,
    applied: preview.proposed,
    snapshotFollows: SNAPSHOT_COMMAND,
    byteChange: afterBytes.compare(originalBytes) !== 0,
    note: 'Bounded owner-approved write. Run node scripts/snapshot-balances.js only after a successful as-of cutover; this slice does not invent history.',
  };
  if (!identityProofLooksSanitized(result)) fail('Apply result is not sanitized.');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

const api = {
  SCHEMA,
  CUTOVER_PENDING_SCHEMA,
  DEFAULT_DATA,
  SNAPSHOT_COMMAND,
  parseArgs,
  parseLocator,
  eligiblePosted,
  proposeFromReport,
  proposePendingTransitions,
  previewIdFrom,
  cutoverApprovalIdFrom,
  identityProofLooksSanitized,
  isIsoDate,
  ownerStatementCadence,
  currentStatementCycleStart,
  nextStatementDate,
  statementCadenceAccepts,
  OWNER_STATEMENT_CADENCE,
  FRESHNESS_EXACT_DAY,
  FRESHNESS_STATEMENT_CADENCE,
  requiredPostedLocators,
  buildOpeningCutover,
  buildPreview,
  previewFrom,
  applyChange,
  applyPendingChange,
  validateApplied,
  validatePendingApplied,
  replaceFileAtomically,
  applyPreview,
  applyPendingPreview,
  run,
};

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
} else {
  module.exports = api;
}
