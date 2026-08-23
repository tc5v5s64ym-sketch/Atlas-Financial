'use strict';
/* Read-only live plan overlay.
 *
 * Lunch Money observation → reconcile → in-memory current account state
 * → Forecast. Historical openings and snapshots stay on disk. This
 * command never writes data.json, positions.csv, or snapshots/.
 *
 *   node scripts/live-plan.js --fixture <file>
 *   node scripts/live-plan.js --live
 *
 * Overlay is today's live plan only: posted household-cash and debt
 * balances, plus revolving pending, plus an in-memory Forecast start
 * equal to a freshness-qualified observation date. fetchedAt alone
 * does not advance that start. MATCH is not freshness: required
 * spendable cash identities need acceptable evidence for the live
 * date, and required revolving pending must be known/current, or the
 * overlay fails closed and keeps the dated opening. Owner policy,
 * bills, income rules, and commitments stay on canonical Atlas data.
 * Same-day CHANGE may overlay a current observation; that is not a
 * canonical write. Scheduled joint-cash occurrences in
 * (historicalOpeningAsOf, liveAsOf] are accounted for before as-of
 * advances: posting/representation evidence names them on in-memory
 * representedEvents; unrepresented joint-cash outflows stay reserved
 * via plan.opening.priorAsOf so Forecast does not drop them. Same-day
 * scheduled cash events still need posting / representation evidence
 * or the overlay fails closed. Triangle/MBNA
 * statement cadence may keep canonical posted values. Unknown, stale,
 * conflicting, unmapped, credit-capacity, and transfer-as-income
 * evidence fail closed. Historical data.json and snapshots stay
 * byte-identical.
 *
 * Production /data.json stays the dated opening unless ATLAS_LIVE_OVERLAY
 * is explicitly `fixture` or `live`. Owner-authorized production read-only
 * Lunch Money access uses ATLAS_LIVE_OVERLAY=live plus owner-supplied
 * Render secrets. Unattended canonical writes remain unauthorized.
 */

const fs = require('fs');
const path = require('path');
const O = require('./provider-observe.js');
const C = require('./canonical-refresh.js');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const SCHEMA = 'atlas-live-plan-overlay/v1';
const DEFAULT_DATA = path.join(ROOT, 'data.json');
const DEFAULT_IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const EPSILON = 0.005;
const POSTED_CASH = new Set(['chequing-a', 'chequing-b', 'savings']);
const CREDIT_CAPACITY_FACTS = new Set([
  'limit', 'available-credit', 'confirmed-payment', 'scheduled-payment',
]);
const TRANSFER_INCOME_FACTS = new Set([
  'employment-deposit', 'household-transfer', 'coaching-receipt',
  'business-obligation', 'internal-transfer', 'household-available',
]);
const BACKFILL_FACTS = new Set(['posting', 'settlement']);

function fail(message) {
  const err = new Error(message);
  err.code = 'live-plan-failed';
  throw err;
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

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sanitizeLiveFailureReason(message) {
  const raw = String(message || 'overlay-failed');
  if (/timeout/i.test(raw)) return 'provider-request-timeout';
  if (/duplicate-provider-account-id/.test(raw)) return 'duplicate-provider-account-id';
  if (/missing-required-cash-mapping|live-account-map-missing/.test(raw)) {
    return 'missing-required-cash-mapping';
  }
  if (/unsupported-atlas-role|invalid-atlas-account-id|live-account-map-invalid/.test(raw)) {
    return 'live-account-map-invalid';
  }
  if (/Fixture account map/.test(raw)) return 'fixture-map-not-live';
  if (/rejected the access token|HTTP 401|HTTP 403|is not set/i.test(raw)) {
    return 'live-observation-unavailable';
  }
  if (/HTTP \d+|request failed|ENOTFOUND|ECONNREFUSED|provider unavailable/i.test(raw)) {
    return 'provider-unavailable';
  }
  const known = raw.match(/^(missing-live-cash-evidence|stale-live-cash-evidence|pending-freshness-unproven|same-day-event-representation-unknown)(?::|\s|$)/);
  if (known) return known[1];
  if (/token|Bearer|LUNCHMONEY|Authorization|ATLAS_PROVIDER_ACCOUNT_MAP_JSON/i.test(raw)) {
    return 'live-observation-unavailable';
  }
  return raw.replace(/\b\d{4,}\b/g, '[id]').slice(0, 200);
}

function logLiveFailure(reason) {
  console.error('live overlay failed:', reason);
}

function observationNow(env) {
  const source = env || process.env;
  const pinned = source && source.ATLAS_LIVE_OVERLAY_NOW;
  if (pinned == null || String(pinned).trim() === '') return new Date().toISOString();
  try {
    O.lunchMoneyApiBase(source);
  } catch (e) {
    fail('ATLAS_LIVE_OVERLAY_NOW is only valid with a loopback Lunch Money API base.');
  }
  const base = source[O.API_BASE_ENV];
  if (base == null || String(base).trim() === '') {
    fail('ATLAS_LIVE_OVERLAY_NOW is only valid with a loopback Lunch Money API base.');
  }
  return String(pinned).trim();
}

function overlayModeFromEnv(env) {
  const raw = env && env.ATLAS_LIVE_OVERLAY != null
    ? env.ATLAS_LIVE_OVERLAY : process.env.ATLAS_LIVE_OVERLAY;
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'fixture' || v === 'live') return v;
  return 'off';
}

function actualsPacketLooksSanitized(packet) {
  const blob = JSON.stringify(packet == null ? {} : packet);
  return !/"payee"\s*:/.test(blob)
    && !/"providerTransactionId"\s*:/.test(blob)
    && !/"providerAccountId"\s*:/.test(blob)
    && !/"original_name"\s*:/.test(blob)
    && !/Bearer\s+\S+/.test(blob);
}

function reconRows(report) {
  return (report && report.reconciliation && report.reconciliation.rows) || [];
}

function cashRow(data, id) {
  const cash = (data.plan && data.plan.startingCash) || {};
  const rows = (cash.breakdown || []).concat(cash.heldElsewhere || []);
  return rows.find(row => row && row.id === id) || null;
}

function debtRow(data, id) {
  return ((data.debts || []).find(row => row && row.id === id)) || null;
}

function hasPendingState(debt) {
  if (!debt) return false;
  if (debt.pendingUnknown === true || debt.unknownPending === true) return true;
  if (!Object.prototype.hasOwnProperty.call(debt, 'pending')) return false;
  return debt.secured === false;
}

function pendingCoverageComplete(report) {
  const cov = report && report.pendingCoverage;
  if (cov && cov.complete === true && cov.basis === O.PENDING_COVERAGE_BASIS) return true;
  const classified = O.classifyPendingCoverage(
    cov ? { pendingCoverage: cov } : (report || {})
  );
  return classified.complete === true
    && classified.basis === O.PENDING_COVERAGE_BASIS;
}

function dateAllowsOverlay(row) {
  return row && (row.dateRelation === 'canonical-older' || row.dateRelation === 'same-day');
}

function liveEvidenceDate(row) {
  return Forecast.financialDate(row && (row.evidenceDate || row.observedAsOf));
}

function postedBalanceRow(row) {
  if (!row) return false;
  if (row.fact && CREDIT_CAPACITY_FACTS.has(row.fact)) return false;
  if (row.fact && TRANSFER_INCOME_FACTS.has(row.fact)) return false;
  if (row.fact && BACKFILL_FACTS.has(row.fact)) return false;
  if (row.fact === 'pending') return false;
  return !row.fact || row.fact === 'posted-balance';
}

function trustworthyNumeric(row) {
  return !!(row
    && row.unknown !== true
    && row.status !== 'CONFLICT'
    && row.status !== 'MISSING'
    && row.evidenceValue != null
    && isFinite(row.evidenceValue));
}

function postedFreshForLiveAsOf(row, liveAsOf) {
  if (!trustworthyNumeric(row) || !liveAsOf) return false;
  const evidenceDate = liveEvidenceDate(row);
  if (evidenceDate === liveAsOf) return true;
  const parsed = C.parseLocator(row.canonicalTarget);
  return !!(parsed && C.statementCadenceAccepts(parsed.id, evidenceDate, liveAsOf));
}

function pendingFreshForLiveAsOf(row, report, liveAsOf) {
  if (!trustworthyNumeric(row) || !liveAsOf) return false;
  if (liveEvidenceDate(row) !== liveAsOf) return false;
  if (row.status !== 'MATCH' && row.status !== 'CHANGE') return false;
  if (near(row.evidenceValue, 0) && !pendingCoverageComplete(report)) return false;
  return true;
}

function rowFreshForLiveAsOf(row, report, liveAsOf) {
  if (!row || !liveAsOf) return false;
  if (row.fact === 'pending') return pendingFreshForLiveAsOf(row, report, liveAsOf);
  if (!postedBalanceRow(row)) return false;
  return postedFreshForLiveAsOf(row, liveAsOf);
}

function postedRowsForLocator(report, locator) {
  return reconRows(report).filter(row => (
    row && row.canonicalTarget === locator && postedBalanceRow(row)
  ));
}

function pendingRowsForDebt(report, id) {
  const locator = `debts:${id}#pending`;
  return reconRows(report).filter(row => row && row.fact === 'pending' && (
    row.cardId === id || row.canonicalTarget === locator
  ));
}

function assertFreshLivePacket(data, report, liveAsOf) {
  if (!liveAsOf) fail('Live overlay is missing a household financial date.');
  for (const id of POSTED_CASH) {
    const locator = `cash:${id}`;
    const rows = postedRowsForLocator(report, locator);
    const fresh = rows.find(row => (
      trustworthyNumeric(row) && liveEvidenceDate(row) === liveAsOf
    ));
    if (!fresh) {
      const sample = rows.find(row => trustworthyNumeric(row)) || rows[0];
      if (!sample) fail(`missing-live-cash-evidence: ${locator}`);
      const dated = liveEvidenceDate(sample) || 'unknown';
      fail(`stale-live-cash-evidence: ${locator} dated ${dated}; MATCH is not freshness`);
    }
  }
  const mappedDebts = new Set(((report && report.mapped) || [])
    .filter(row => row && row.collection === 'debts' && row.atlasId)
    .map(row => row.atlasId));
  for (const debt of (data && data.debts) || []) {
    if (!hasPendingState(debt)) continue;
    const pendingRows = pendingRowsForDebt(report, debt.id);
    if (!mappedDebts.has(debt.id) && !pendingRows.length) continue;
    const locator = `debts:${debt.id}#pending`;
    const fresh = pendingRows.find(row => pendingFreshForLiveAsOf(row, report, liveAsOf));
    if (!fresh) fail(`pending-freshness-unproven: ${locator}`);
  }
}

function sanitizedUnmapped(entry) {
  return {
    locator: null,
    fact: null,
    reason: 'unmapped-provider-account',
    accountLabel: entry && entry.accountLabel ? String(entry.accountLabel)
      : (entry && entry.displayName ? String(entry.displayName) : null),
  };
}

function refuseRow(row, reason) {
  return {
    locator: (row && row.canonicalTarget) || null,
    fact: (row && row.fact) || null,
    status: (row && row.status) || null,
    dateRelation: (row && row.dateRelation) || null,
    currentValue: row && row.canonicalValue != null && isFinite(row.canonicalValue)
      ? round2(row.canonicalValue) : null,
    observedValue: row && row.unknown === true ? null
      : (row && row.evidenceValue != null && isFinite(row.evidenceValue)
        ? round2(row.evidenceValue) : null),
    evidenceDate: (row && (row.evidenceDate || row.observedAsOf)) || null,
    reason,
  };
}

function postedOverlayEligible(row) {
  if (!C.eligiblePosted(row)) return false;
  if (!row || row.status !== 'CHANGE') return false;
  if (row.unknown === true) return false;
  if (row.evidenceValue == null || !isFinite(row.evidenceValue)) return false;
  if (row.canonicalValue == null || !isFinite(row.canonicalValue)) return false;
  return dateAllowsOverlay(row);
}

function pendingOverlayEligible(row, report) {
  if (!row || row.fact !== 'pending') return false;
  if (row.status !== 'CHANGE') return false;
  if (row.unknown === true) return false;
  if (row.evidenceValue == null || !isFinite(row.evidenceValue)) return false;
  if (!dateAllowsOverlay(row)) return false;
  if (near(row.evidenceValue, 0) && !pendingCoverageComplete(report)) return false;
  const parsed = C.parseLocator(row.canonicalTarget);
  if (!parsed || parsed.collection !== 'debts' || parsed.field !== 'pending') return false;
  return true;
}

function postedRefuseReason(row) {
  const fact = row && row.fact;
  if (fact && CREDIT_CAPACITY_FACTS.has(fact)) return 'credit-capacity-not-cash';
  if (fact && TRANSFER_INCOME_FACTS.has(fact)) return 'transfer-not-income';
  if (fact && BACKFILL_FACTS.has(fact)) return 'historical-opening-backfill';
  if (row && row.status === 'CONFLICT') return 'conflicting-observations';
  if (row && row.status === 'MISSING') return 'unknown-value';
  if (fact === 'pending' && (row.unknown === true || row.evidenceValue == null)) {
    return 'unresolved-pending';
  }
  if (row && (row.unknown === true || row.evidenceValue == null || !isFinite(row.evidenceValue))) {
    return 'unknown-value';
  }
  if (row && row.dateRelation === 'canonical-newer') {
    const parsed = C.parseLocator(row.canonicalTarget);
    const id = parsed && parsed.id;
    const evidenceDate = row.evidenceDate || row.observedAsOf || null;
    const asOf = row.canonicalAsOf
      || (row && row._canonicalAsOf)
      || null;
    if (id && evidenceDate && asOf && C.statementCadenceAccepts(id, evidenceDate, asOf)) {
      return 'statement-cadence-keep-canonical';
    }
    return 'stale-not-current';
  }
  if (row && row.dateRelation === 'incomparable') return 'incomparable-freshness';
  if (row && row.dateRelation === 'same-day' && row.status !== 'CHANGE') {
    return 'same-day-no-winner';
  }
  if (!C.eligiblePosted(row) && fact !== 'pending') return 'not-posted-current-state';
  return 'not-proposed';
}

function proposeOverlay(report, canonicalAsOf, liveAsOf) {
  const proposed = [];
  const refused = [];
  const seen = new Set();
  for (const row of reconRows(report)) {
    const locator = row && row.canonicalTarget;
    const key = String(locator || '') + '|' + String(row && row.fact || '');
    if (!locator || seen.has(key)) continue;
    seen.add(key);
    const annotated = Object.assign({}, row, { _canonicalAsOf: canonicalAsOf });
    if (row.status === 'MATCH') {
      if (liveAsOf && (row.fact === 'pending' || postedBalanceRow(annotated))
        && !rowFreshForLiveAsOf(annotated, report, liveAsOf)) {
        const zeroUnproven = row.fact === 'pending'
          && row.unknown !== true
          && row.evidenceValue != null
          && isFinite(row.evidenceValue)
          && near(row.evidenceValue, 0)
          && !pendingCoverageComplete(report);
        refused.push(refuseRow(annotated, zeroUnproven
          ? 'unproven-zero-pending'
          : 'stale-not-current'));
      }
      continue;
    }
    if (row.fact === 'pending') {
      if (pendingOverlayEligible(annotated, report)) {
        const parsed = C.parseLocator(locator);
        proposed.push({
          locator,
          collection: 'debts',
          id: parsed.id,
          field: 'pending',
          currentValue: row.canonicalValue == null ? null : round2(row.canonicalValue),
          proposedValue: round2(row.evidenceValue),
          evidenceDate: row.evidenceDate || row.observedAsOf || null,
          dateRelation: row.dateRelation,
          source: 'provider-observe:lunchmoney',
          reason: 'reconcile pending CHANGE; overlay current pending onto today\'s live plan',
        });
        continue;
      }
      const zeroUnproven = row.status === 'CHANGE'
        && row.unknown !== true
        && row.evidenceValue != null
        && isFinite(row.evidenceValue)
        && near(row.evidenceValue, 0)
        && !pendingCoverageComplete(report);
      refused.push(refuseRow(row, zeroUnproven
        ? 'unproven-zero-pending'
        : (row.dateRelation === 'canonical-newer'
          ? 'stale-not-current'
          : postedRefuseReason(annotated))));
      continue;
    }
    if (postedOverlayEligible(annotated)) {
      const parsed = C.parseLocator(locator);
      proposed.push({
        locator,
        collection: parsed.collection,
        id: parsed.id,
        field: parsed.collection === 'cash' ? 'value' : 'balance',
        currentValue: round2(row.canonicalValue),
        proposedValue: round2(row.evidenceValue),
        evidenceDate: row.evidenceDate || row.observedAsOf || null,
        dateRelation: row.dateRelation,
        source: 'provider-observe:lunchmoney',
        reason: row.dateRelation === 'same-day'
          ? 'reconcile CHANGE; same-day observation overlays today\'s live plan only'
          : 'reconcile CHANGE; evidence newer than canonical opening',
      });
      continue;
    }
    refused.push(refuseRow(annotated, postedRefuseReason(annotated)));
  }
  for (const entry of (report && report.unmapped) || []) {
    refused.push(sanitizedUnmapped(entry));
  }
  proposed.sort((a, b) => String(a.locator).localeCompare(String(b.locator))
    || String(a.field).localeCompare(String(b.field)));
  refused.sort((a, b) => String(a.locator || a.reason).localeCompare(String(b.locator || b.reason))
    || String(a.reason).localeCompare(String(b.reason)));
  return { proposed, refused };
}

function applyPostedOverlay(data, change) {
  const parsed = C.parseLocator(change.locator);
  if (!parsed) fail(`Unsupported overlay locator: ${change.locator}`);
  if (parsed.collection === 'cash' && change.field === 'value' && POSTED_CASH.has(parsed.id)) {
    const row = cashRow(data, parsed.id);
    if (!row) fail(`Missing cash row ${parsed.id}`);
    row.value = round2(change.proposedValue);
    return;
  }
  if (parsed.collection === 'debts' && change.field === 'balance' && !parsed.field) {
    const row = debtRow(data, parsed.id);
    if (!row) fail(`Missing debt row ${parsed.id}`);
    row.balance = round2(change.proposedValue);
    return;
  }
  fail(`Refusing overlay of ${change.locator} field ${change.field}`);
}

function applyPendingOverlay(data, change) {
  const parsed = C.parseLocator(change.locator);
  if (!parsed || parsed.collection !== 'debts' || parsed.field !== 'pending'
    || change.field !== 'pending') {
    fail(`Refusing pending overlay of ${change && change.locator}`);
  }
  const row = debtRow(data, parsed.id);
  if (!row) fail(`Missing debt row ${parsed.id}`);
  if (row.secured !== false) fail(`Pending overlay refused for secured debt ${parsed.id}`);
  if (!hasPendingState(row)) fail(`Pending overlay refused for debt without pending state ${parsed.id}`);
  if (change.proposedValue == null || !isFinite(Number(change.proposedValue))) {
    fail(`Pending overlay refused unknown proposed value for ${change.locator}`);
  }
  row.pending = round2(change.proposedValue);
  row.pendingUnknown = false;
  if (Object.prototype.hasOwnProperty.call(row, 'unknownPending')) row.unknownPending = false;
}

function assertOwnerPolicyUntouched(before, after) {
  const keys = ['income', 'bills', 'obligations', 'commitments', 'budget', 'actions', 'nextDollar'];
  for (const key of keys) {
    if (JSON.stringify((before.plan || {})[key]) !== JSON.stringify((after.plan || {})[key])) {
      fail(`Live overlay must not rewrite plan.${key}.`);
    }
  }
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

function scheduledCashEventsOn(plan, date) {
  if (!plan || !date) return [];
  return Forecast.expandEvents(schedulePlan(plan), date, date, {})
    .filter(event => event && event.date === date && event.kind !== 'noncash');
}

function scheduledCashEventsIn(plan, afterExclusive, throughInclusive) {
  if (!plan || !afterExclusive || !throughInclusive) return [];
  if (throughInclusive <= afterExclusive) return [];
  const from = Forecast.addDays(afterExclusive, 1);
  if (!from || from > throughInclusive) return [];
  return Forecast.expandEvents(schedulePlan(plan), from, throughInclusive, {})
    .filter(event => event && event.date > afterExclusive
      && event.date <= throughInclusive
      && event.kind !== 'noncash');
}

function liveAsOfFrom(report, historicalOpeningAsOf) {
  const observed = Forecast.financialDate(report && report.fetchedAt)
    || Forecast.financialDate(report && report.observedAsOf);
  return observed || historicalOpeningAsOf || null;
}

function representedCandidatesFor(report, historicalOpeningAsOf, liveAsOf) {
  return ((report && report.representedEventCandidates) || [])
    .map(candidate => O.classifyRepresentedCandidate(candidate, liveAsOf))
    .filter(candidate => candidate && candidate.id && candidate.date
      && historicalOpeningAsOf
      && candidate.date > historicalOpeningAsOf
      && candidate.date <= liveAsOf);
}

function sortRepresented(a, b) {
  return String(a.date).localeCompare(String(b.date))
    || String(a.id).localeCompare(String(b.id));
}

function mergeRepresented(existing, added) {
  const out = [];
  const seen = new Set();
  for (const row of (existing || []).concat(added || [])) {
    if (!row || !row.id || !row.date) continue;
    const key = String(row.id) + '@' + String(row.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: row.id, date: row.date });
  }
  out.sort(sortRepresented);
  return out;
}

function refuseNonLiveRepresented(report, historicalOpeningAsOf, liveAsOf) {
  const refused = [];
  for (const candidate of (report && report.representedEventCandidates) || []) {
    const classified = O.classifyRepresentedCandidate(candidate, liveAsOf);
    if (classified.date && historicalOpeningAsOf
        && classified.date > historicalOpeningAsOf
        && classified.date <= liveAsOf) continue;
    refused.push({
      locator: 'plan.opening.representedEvents',
      fact: 'posting',
      eventId: classified.id || null,
      evidenceDate: classified.date || null,
      reason: classified.date && historicalOpeningAsOf
        && classified.date <= historicalOpeningAsOf
        ? 'historical-opening-backfill'
        : 'not-live-as-of',
    });
  }
  return refused;
}

function applyLiveCutover(next, report, historicalOpeningAsOf) {
  const liveAsOf = liveAsOfFrom(report, historicalOpeningAsOf);
  if (!liveAsOf) fail('Live overlay is missing a household financial date.');
  const windowEvents = scheduledCashEventsIn(next.plan, historicalOpeningAsOf, liveAsOf)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || String(a.id).localeCompare(String(b.id)));
  const candidates = representedCandidatesFor(report, historicalOpeningAsOf, liveAsOf);
  const represented = [];
  const unknownSameDay = [];
  for (const event of windowEvents) {
    const hit = candidates.find(candidate => candidate.id === event.id
      && candidate.date === event.date);
    if (hit) {
      represented.push({ id: event.id, date: event.date });
      continue;
    }
    if (event.date === liveAsOf) unknownSameDay.push(event);
  }
  represented.sort(sortRepresented);
  const advances = !!(historicalOpeningAsOf && liveAsOf > historicalOpeningAsOf);
  if (advances && unknownSameDay.length) {
    const named = unknownSameDay.map(event => `${event.id}@${event.date}`).join(', ');
    fail(`same-day-event-representation-unknown: ${named}`);
  }
  if (historicalOpeningAsOf && liveAsOf < historicalOpeningAsOf) {
    return {
      liveAsOf: historicalOpeningAsOf,
      representedEvents: mergeRepresented(
        (next.plan.opening && next.plan.opening.representedEvents) || [],
        []
      ),
      advanced: false,
    };
  }
  const existing = (next.plan.opening && next.plan.opening.representedEvents) || [];
  const nextOpening = Object.assign({}, next.plan.opening || {}, {
    asOf: liveAsOf,
    representedEvents: advances ? represented : mergeRepresented(existing, represented),
  });
  if (advances) nextOpening.priorAsOf = historicalOpeningAsOf;
  next.plan.opening = nextOpening;
  if (!next.meta) next.meta = {};
  next.meta.asOf = liveAsOf;
  return {
    liveAsOf,
    representedEvents: nextOpening.representedEvents,
    advanced: advances,
  };
}

function overlayMeta(opts) {
  return {
    schema: SCHEMA,
    writesCanonicalState: false,
    productionWrite: false,
    unattended: false,
    applied: opts.applied === true,
    historicalOpeningAsOf: opts.historicalOpeningAsOf || null,
    effectiveAsOf: opts.effectiveAsOf || null,
    observedAsOf: opts.observedAsOf || null,
    representedEvents: opts.representedEvents || [],
    overlays: opts.overlays || [],
    refused: opts.refused || [],
    source: 'provider-observe:lunchmoney',
    note: opts.note || 'In-memory overlay for today\'s live plan. Dated openings and snapshots are unchanged.',
    reason: opts.reason || null,
    currentPeriodActuals: opts.currentPeriodActuals || null,
  };
}

function overlayLiveState(input) {
  const data = input && input.data;
  if (!data || !data.plan || !Array.isArray(data.debts)) fail('Canonical data is missing plan or debts.');
  const report = input.report;
  if (!report) fail('Observation report is required.');
  if (report.writesCanonicalState !== false) fail('Observer must declare writesCanonicalState false.');
  const historicalOpeningAsOf = (data.plan.opening && data.plan.opening.asOf)
    || (data.meta && data.meta.asOf) || null;
  const liveAsOf = liveAsOfFrom(report, historicalOpeningAsOf);
  const { proposed, refused } = proposeOverlay(report, historicalOpeningAsOf, liveAsOf);
  const postingRefused = refuseNonLiveRepresented(report, historicalOpeningAsOf, liveAsOf);
  if (historicalOpeningAsOf && liveAsOf && liveAsOf > historicalOpeningAsOf) {
    assertFreshLivePacket(data, report, liveAsOf);
  }
  const next = clone(data);
  const cutover = applyLiveCutover(next, report, historicalOpeningAsOf);
  for (const change of proposed) {
    if (change.field === 'pending') applyPendingOverlay(next, change);
    else applyPostedOverlay(next, change);
  }
  assertOwnerPolicyUntouched(data, next);
  const cash = Forecast.startingCashAmount(next.plan);
  if (!isFinite(cash)) fail('Forecast cannot consume the overlaid starting cash.');
  const allRefused = refused.concat(postingRefused).sort((a, b) =>
    String(a.locator || a.reason).localeCompare(String(b.locator || b.reason))
    || String(a.reason).localeCompare(String(b.reason)));
  next.liveOverlay = overlayMeta({
    applied: true,
    historicalOpeningAsOf,
    effectiveAsOf: cutover.liveAsOf,
    observedAsOf: liveAsOf || historicalOpeningAsOf,
    representedEvents: cutover.representedEvents,
    overlays: proposed.map(row => ({
      locator: row.locator,
      field: row.field,
      currentValue: row.currentValue,
      proposedValue: row.proposedValue,
      evidenceDate: row.evidenceDate,
      reason: row.reason,
    })),
    refused: allRefused.map(row => ({
      locator: row.locator || null,
      fact: row.fact || null,
      reason: row.reason,
      evidenceDate: row.evidenceDate || null,
    })),
    currentPeriodActuals: report.currentPeriodActuals || null,
  });
  if (!C.identityProofLooksSanitized(next.liveOverlay)
    || !O.identityProofLooksSanitized(next.liveOverlay)) {
    fail('Live overlay metadata is not sanitized.');
  }
  if (next.liveOverlay.currentPeriodActuals
    && !actualsPacketLooksSanitized(next.liveOverlay.currentPeriodActuals)) {
    fail('Current-period actuals packet is not sanitized.');
  }
  return {
    data: next,
    overlays: proposed,
    refused: allRefused,
    writesCanonicalState: false,
    historicalOpeningAsOf,
    effectiveAsOf: cutover.liveAsOf,
  };
}

function observeInput(opts) {
  const identity = opts.identity || (
    fs.existsSync(opts.identityPath || DEFAULT_IDENTITY)
      ? loadJson(opts.identityPath || DEFAULT_IDENTITY)
      : { rules: [], billPaymentPayees: [] }
  );
  return {
    provider: 'lunchmoney',
    payload: opts.payload,
    accountMap: opts.accountMap,
    data: opts.data,
    identity,
    fetchedAt: opts.payload && opts.payload.fetchedAt,
  };
}

function fromObservation(opts) {
  const report = O.observe(observeInput(opts));
  const overlaid = overlayLiveState({ data: opts.data, report });
  return Object.assign({ report }, overlaid);
}

function loadPeriods() {
  const file = path.join(ROOT, 'public', 'periods.json');
  if (!fs.existsSync(file)) return null;
  return loadJson(file);
}

function forecastFrom(data) {
  const plan = data && data.plan;
  const asOf = (data && data.liveOverlay && data.liveOverlay.applied === true
    && data.liveOverlay.effectiveAsOf)
    || (plan && plan.opening && plan.opening.asOf)
    || (data && data.meta && data.meta.asOf);
  if (!plan || !asOf) fail('Overlaid data is missing a Forecast opening.');
  const overlay = data && data.liveOverlay;
  const actuals = overlay && overlay.applied === true
    ? overlay.currentPeriodActuals
    : null;
  const advice = Forecast.recommend(plan, asOf, {
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
    periods: loadPeriods(),
    currentPeriodActuals: actuals,
  });
  const used = Forecast.utilisation(data.debts, data.revolvingExtra, plan);
  const action = advice && advice.currentPeriodAction;
  return {
    asOf,
    startingCash: Forecast.startingCashAmount(plan),
    weekly: advice && advice.weekly,
    mode: advice && advice.mode,
    utilisation: {
      totalAvailable: used.totalAvailable,
      totalPending: used.totalPending,
      overLimitCount: used.overLimitCount,
    },
    writesCanonicalState: false,
    currentPeriod: action ? {
      mode: action.mode,
      remainingClaim: action.remainingClaim,
      nextPayday: action.nextPayday,
      noMovementToday: action.noMovementToday,
      coverage: action.coverage,
    } : null,
  };
}

function failedOverlay(canonical, reason) {
  const sanitized = sanitizeLiveFailureReason(reason);
  logLiveFailure(sanitized);
  const next = clone(canonical);
  next.liveOverlay = overlayMeta({
    applied: false,
    historicalOpeningAsOf: (canonical.plan && canonical.plan.opening && canonical.plan.opening.asOf)
      || (canonical.meta && canonical.meta.asOf) || null,
    effectiveAsOf: null,
    representedEvents: [],
    overlays: [],
    refused: [],
    reason: sanitized,
    note: 'Live overlay failed closed. Dated opening is unchanged.',
  });
  return next;
}

function loadIdentity() {
  if (!fs.existsSync(DEFAULT_IDENTITY)) return { rules: [], billPaymentPayees: [] };
  return loadJson(DEFAULT_IDENTITY);
}

function fixturePathsFromEnv(env) {
  const fixture = (env && env.ATLAS_LIVE_OVERLAY_FIXTURE)
    || process.env.ATLAS_LIVE_OVERLAY_FIXTURE;
  const mapPath = (env && env.ATLAS_LIVE_OVERLAY_MAP)
    || process.env.ATLAS_LIVE_OVERLAY_MAP
    || O.FIXTURE_MAP;
  return { fixture, mapPath };
}

function applyFixtureOverlay(canonical, env) {
  const { fixture, mapPath } = fixturePathsFromEnv(env);
  if (!fixture) fail('ATLAS_LIVE_OVERLAY=fixture requires ATLAS_LIVE_OVERLAY_FIXTURE.');
  const result = fromObservation({
    data: canonical,
    payload: loadJson(fixture),
    accountMap: loadJson(mapPath),
    identity: loadIdentity(),
  });
  return result.data;
}

function serveCanonicalOrFixture(canonical, env) {
  const mode = overlayModeFromEnv(env);
  if (mode === 'off') return canonical;
  if (mode !== 'fixture') fail('serveCanonicalOrFixture handles fixture overlay only.');
  try {
    return applyFixtureOverlay(canonical, env);
  } catch (err) {
    const message = err && err.message ? err.message : 'overlay-failed';
    return failedOverlay(canonical, message);
  }
}

async function applyForServer(canonical, env) {
  const mode = overlayModeFromEnv(env);
  if (mode === 'off' || mode === 'fixture') {
    return serveCanonicalOrFixture(canonical, env);
  }
  try {
    const accountMap = O.loadLiveAccountMap(env || process.env, canonical);
    const payload = await O.fetchLunchMoneyLive(
      await O.resolveLiveToken({ env: env || process.env }),
      observationNow(env || process.env),
      O.CURRENT_STATE_HISTORY_DAYS,
      { env: env || process.env }
    );
    const result = fromObservation({
      data: canonical,
      payload,
      accountMap,
      identity: loadIdentity(),
    });
    return result.data;
  } catch (err) {
    const message = err && err.message ? err.message : 'overlay-failed';
    return failedOverlay(canonical, message);
  }
}

function snapshotPaths() {
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => path.join(SNAPSHOT_DIR, name));
}

function parseArgs(argv) {
  const args = {
    live: false,
    fixture: null,
    map: null,
    data: DEFAULT_DATA,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--fixture') args.fixture = argv[++i];
    else if (a === '--map') args.map = argv[++i];
    else if (a === '--data') args.data = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else fail(`Unknown argument: ${a}`);
  }
  return args;
}

function summary(result) {
  const figures = forecastFrom(result.data);
  return {
    schema: SCHEMA,
    writesCanonicalState: false,
    historicalOpeningAsOf: result.historicalOpeningAsOf,
    effectiveAsOf: result.effectiveAsOf
      || (result.data.liveOverlay && result.data.liveOverlay.effectiveAsOf)
      || null,
    overlayCount: result.overlays.length,
    refusedCount: result.refused.length,
    overlays: result.data.liveOverlay && result.data.liveOverlay.overlays,
    refused: result.data.liveOverlay && result.data.liveOverlay.refused,
    forecast: figures,
  };
}

async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(
      'Usage: node scripts/live-plan.js --fixture <file>\n'
      + '       node scripts/live-plan.js --live\n'
      + 'Read-only. Never writes data.json or snapshots.\n'
    );
    return 0;
  }
  if (args.live && args.fixture) fail('Use either --fixture or --live, not both.');
  if (!args.live && !args.fixture) fail('Pass --fixture <file> or --live.');
  const data = loadJson(args.data);
  const identity = loadIdentity();
  let result;
  if (args.live) {
    const mapPath = args.map
      || (fs.existsSync(O.LOCAL_MAP) ? O.LOCAL_MAP : O.DEFAULT_MAP);
    const accountMap = loadJson(mapPath);
    O.assertLiveMap(accountMap);
    const payload = await O.fetchLunchMoneyLive(
      await O.resolveLiveToken(),
      new Date().toISOString(),
      O.CURRENT_STATE_HISTORY_DAYS
    );
    result = fromObservation({ data, payload, accountMap, identity });
  } else {
    const mapPath = args.map || O.FIXTURE_MAP;
    result = fromObservation({
      data,
      payload: loadJson(args.fixture),
      accountMap: loadJson(mapPath),
      identity,
    });
  }
  const printed = summary(result);
  if (!C.identityProofLooksSanitized(printed) || !O.identityProofLooksSanitized(printed)) {
    fail('Live plan output is not sanitized.');
  }
  process.stdout.write(`${JSON.stringify(printed, null, 2)}\n`);
  return 0;
}

const api = {
  SCHEMA,
  POSTED_CASH,
  overlayModeFromEnv,
  sanitizeLiveFailureReason,
  proposeOverlay,
  overlayLiveState,
  fromObservation,
  forecastFrom,
  liveAsOfFrom,
  scheduledCashEventsOn,
  serveCanonicalOrFixture,
  applyForServer,
  failedOverlay,
  snapshotPaths,
  parseArgs,
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
