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
 * balances, plus revolving pending. Owner policy, bills, income rules,
 * and commitments stay on canonical Atlas data. Same-day CHANGE may
 * overlay a current observation; that is not a canonical write.
 * Triangle/MBNA statement cadence may keep canonical posted values.
 * Unknown, stale, conflicting, unmapped, credit-capacity, and
 * transfer-as-income evidence fail closed.
 *
 * Production /data.json stays the dated opening unless ATLAS_LIVE_OVERLAY
 * is explicitly `fixture` or `live`. A Render Lunch Money token is still
 * not authorised.
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

function overlayModeFromEnv(env) {
  const raw = env && env.ATLAS_LIVE_OVERLAY != null
    ? env.ATLAS_LIVE_OVERLAY : process.env.ATLAS_LIVE_OVERLAY;
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'fixture' || v === 'live') return v;
  return 'off';
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

function proposeOverlay(report, canonicalAsOf) {
  const proposed = [];
  const refused = [];
  const seen = new Set();
  for (const row of reconRows(report)) {
    const locator = row && row.canonicalTarget;
    const key = String(locator || '') + '|' + String(row && row.fact || '');
    if (!locator || seen.has(key)) continue;
    seen.add(key);
    const annotated = Object.assign({}, row, { _canonicalAsOf: canonicalAsOf });
    if (row.status === 'MATCH') continue;
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

function assertPolicyUntouched(before, after) {
  const keys = ['income', 'bills', 'obligations', 'commitments', 'budget', 'actions', 'nextDollar'];
  for (const key of keys) {
    if (JSON.stringify((before.plan || {})[key]) !== JSON.stringify((after.plan || {})[key])) {
      fail(`Live overlay must not rewrite plan.${key}.`);
    }
  }
  if (String(after.meta && after.meta.asOf) !== String(before.meta && before.meta.asOf)) {
    fail('Live overlay must not rewrite meta.asOf.');
  }
  if (JSON.stringify(after.plan && after.plan.opening)
    !== JSON.stringify(before.plan && before.plan.opening)) {
    fail('Live overlay must not rewrite plan.opening.');
  }
}

function overlayMeta(opts) {
  return {
    schema: SCHEMA,
    writesCanonicalState: false,
    productionWrite: false,
    unattended: false,
    applied: opts.applied === true,
    historicalOpeningAsOf: opts.historicalOpeningAsOf || null,
    observedAsOf: opts.observedAsOf || null,
    overlays: opts.overlays || [],
    refused: opts.refused || [],
    source: 'provider-observe:lunchmoney',
    note: opts.note || 'In-memory overlay for today\'s live plan. Dated openings and snapshots are unchanged.',
    reason: opts.reason || null,
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
  const { proposed, refused } = proposeOverlay(report, historicalOpeningAsOf);
  const next = clone(data);
  for (const change of proposed) {
    if (change.field === 'pending') applyPendingOverlay(next, change);
    else applyPostedOverlay(next, change);
  }
  assertPolicyUntouched(data, next);
  const cash = Forecast.startingCashAmount(next.plan);
  if (!isFinite(cash)) fail('Forecast cannot consume the overlaid starting cash.');
  next.liveOverlay = overlayMeta({
    applied: true,
    historicalOpeningAsOf,
    observedAsOf: Forecast.financialDate(report.fetchedAt) || historicalOpeningAsOf,
    overlays: proposed.map(row => ({
      locator: row.locator,
      field: row.field,
      currentValue: row.currentValue,
      proposedValue: row.proposedValue,
      evidenceDate: row.evidenceDate,
      reason: row.reason,
    })),
    refused: refused.map(row => ({
      locator: row.locator || null,
      fact: row.fact || null,
      reason: row.reason,
      evidenceDate: row.evidenceDate || null,
    })),
  });
  if (!C.identityProofLooksSanitized(next.liveOverlay)
    || !O.identityProofLooksSanitized(next.liveOverlay)) {
    fail('Live overlay metadata is not sanitized.');
  }
  return {
    data: next,
    overlays: proposed,
    refused,
    writesCanonicalState: false,
    historicalOpeningAsOf,
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

function forecastFrom(data) {
  const plan = data && data.plan;
  const asOf = (plan && plan.opening && plan.opening.asOf)
    || (data && data.meta && data.meta.asOf);
  if (!plan || !asOf) fail('Overlaid data is missing a Forecast opening.');
  const advice = Forecast.recommend(plan, asOf, {
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
  });
  const used = Forecast.utilisation(data.debts, data.revolvingExtra, plan);
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
  };
}

function failedOverlay(canonical, reason) {
  const next = clone(canonical);
  next.liveOverlay = overlayMeta({
    applied: false,
    historicalOpeningAsOf: (canonical.plan && canonical.plan.opening && canonical.plan.opening.asOf)
      || (canonical.meta && canonical.meta.asOf) || null,
    overlays: [],
    refused: [],
    reason: String(reason || 'overlay-failed').slice(0, 200),
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
    const mapPath = (env && env.ATLAS_LIVE_OVERLAY_MAP)
      || process.env.ATLAS_LIVE_OVERLAY_MAP
      || (fs.existsSync(O.LOCAL_MAP) ? O.LOCAL_MAP : O.DEFAULT_MAP);
    const accountMap = loadJson(mapPath);
    O.assertLiveMap(accountMap);
    const payload = await O.fetchLunchMoneyLive(
      await O.resolveLiveToken(),
      new Date().toISOString(),
      O.CURRENT_STATE_HISTORY_DAYS
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
    if (/token|Bearer|LUNCHMONEY/i.test(message)) {
      return failedOverlay(canonical, 'live-observation-unavailable');
    }
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
  proposeOverlay,
  overlayLiveState,
  fromObservation,
  forecastFrom,
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
