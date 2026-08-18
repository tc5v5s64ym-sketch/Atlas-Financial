'use strict';
/* Earned trusted canonical refresh — B81 / AF-LIVE-02.
 *
 *   node scripts/canonical-refresh.js --fixture <file>
 *   node scripts/canonical-refresh.js --fixture <file> --apply --approve <previewId>
 *
 * Default is a non-writing preview. An approved write updates only the
 * posted cash/debt fields listed in that preview. Observe and reconcile
 * remain the incumbents. Forecast remains the planner.
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
const SNAPSHOT_COMMAND = 'node scripts/snapshot-balances.js';
const EPSILON = 0.005;

const POSTED_CASH = new Set(['chequing-a', 'chequing-b', 'savings']);
const CREDIT_REFUSE_FACTS = new Set([
  'pending', 'limit', 'available-credit', 'confirmed-payment', 'scheduled-payment',
]);
const BACKFILL_FACTS = new Set(['posting']);

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
    identity: DEFAULT_IDENTITY,
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
    else if (a === '--identity') out.identity = argv[++i];
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

function previewFrom(input) {
  const report = O.observe(input);
  const preview = buildPreview(report);
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

function applyPreview(data, preview, destPath) {
  if (!preview || preview.schema !== SCHEMA) fail('Preview schema is not the earned refresh preview.');
  if (!preview.previewId) fail('Preview is missing previewId.');
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
      + 'Default is a non-writing preview. --live is preview-only unless --apply --approve is also set.\n'
    );
    return 0;
  }
  if (args.provider !== 'lunchmoney') fail('Only --provider lunchmoney is implemented.');
  if (args.apply && !args.approve) fail('No approval = no canonical write. Pass --approve <previewId>.');
  const data = loadJson(args.data);
  const originalBytes = fs.readFileSync(args.data);
  const payload = await loadPayload(args);
  const mapPath = args.map || O.resolveMapPath({ live: args.live, fixture: args.fixture, map: args.map });
  const accountMap = loadJson(mapPath);
  if (args.live) O.assertLiveMap(accountMap);
  const { preview } = previewFrom(observeInput(args, data, payload, accountMap));
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
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
  DEFAULT_DATA,
  SNAPSHOT_COMMAND,
  parseArgs,
  parseLocator,
  eligiblePosted,
  proposeFromReport,
  previewIdFrom,
  identityProofLooksSanitized,
  buildPreview,
  previewFrom,
  applyChange,
  validateApplied,
  replaceFileAtomically,
  applyPreview,
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
