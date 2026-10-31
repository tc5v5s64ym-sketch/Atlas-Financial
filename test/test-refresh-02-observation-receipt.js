'use strict';
/* AF-REFRESH-02 — one trusted on-demand observation receipt.
 *
 * Independent of observationReceipt for coverage/identity reconstruction:
 * mapped atlas ids, unmapped count, posted/pending completeness, and
 * pending-to-posted transitions are rebuilt from normalizeLunchMoneyPayload,
 * mappingFor, and collapseByProviderTransactionId. Canonical no-write is
 * proved by hashing incumbent files, not by reading writesCanonicalState.
 * Incomplete/truncated evidence is constructed explicitly.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const O = require('../scripts/provider-observe.js');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const SAMPLE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json');
const SAMPLE_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const PENDING = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-pending-acceptance.json');
const PENDING_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'pending-account-map.json');
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const PERIODS = path.join(ROOT, 'public', 'periods.json');
const SNAPSHOTS = path.join(ROOT, 'snapshots');
const OBSERVE = path.join(ROOT, 'scripts', 'provider-observe.js');
const RECONCILE = path.join(ROOT, 'scripts', 'reconcile.js');
const LIVE_PLAN = path.join(ROOT, 'scripts', 'live-plan.js');
const CANONICAL = path.join(ROOT, 'scripts', 'canonical-refresh.js');

let failures = 0;
function ok(cond, label, detail) {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }
function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function hashTree() {
  const snapNames = fs.readdirSync(SNAPSHOTS).filter(n => n.endsWith('.json')).sort();
  const snap = snapNames.map(n => n + ':' + hashFile(path.join(SNAPSHOTS, n))).join('|');
  return {
    data: hashFile(DATA),
    positions: hashFile(POSITIONS),
    periods: hashFile(PERIODS),
    snapshots: crypto.createHash('sha256').update(snap).digest('hex'),
  };
}
function load(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const samplePayload = load(SAMPLE);
const sampleMap = load(SAMPLE_MAP);
const pendingPayload = load(PENDING);
const pendingMap = load(PENDING_MAP);
const data = load(DATA);

function withCompleteCoverage(payload, extraWindow) {
  const out = clone(payload);
  out.pendingCoverage = {
    complete: true,
    basis: O.PENDING_COVERAGE_BASIS,
    hasMore: false,
    startDate: null,
    endDate: null,
    truncated: false,
  };
  out.transactionWindow = Object.assign({
    startDate: '2026-08-02',
    endDate: '2026-08-16',
    complete: true,
    hasMore: false,
    truncated: false,
  }, extraWindow || {});
  return out;
}

function observeWith(payload, accountMap) {
  return O.observe({
    provider: 'lunchmoney',
    payload,
    accountMap,
    data,
    fetchedAt: payload.fetchedAt,
  });
}

// Second method: rebuild coverage/identity from incumbent seams, not from
// observationReceipt. This is the independent proof of the fingerprint.
function independentCoverage(payload, accountMap) {
  const normalized = O.normalizeLunchMoneyPayload(payload, payload.fetchedAt);
  const expected = [];
  const seen = new Set();
  for (const mapping of accountMap.mappings || []) {
    if (!mapping || mapping.atlasRole === O.EXTERNAL_LIVE_ROLE) continue;
    const id = mapping.canonical && mapping.canonical.id;
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    expected.push(key);
  }
  expected.sort();
  const observed = [];
  let unmappedCount = 0;
  for (const account of normalized.accounts) {
    const mapping = O.mappingFor(accountMap, account.providerAccountId);
    if (mapping && mapping.atlasRole === O.EXTERNAL_LIVE_ROLE) continue;
    if (!mapping || !mapping.canonical || !mapping.canonical.id) {
      unmappedCount += 1;
      continue;
    }
    observed.push(String(mapping.canonical.id));
  }
  observed.sort();
  const collapsed = O.collapseByProviderTransactionId(normalized.transactions);
  const pendingToPosted = (collapsed.identityEvidence || [])
    .filter(e => e && e.transition === 'pending-to-posted').length;
  const window = normalized.transactionWindow || {};
  const postedComplete = window.complete === true
    && window.truncated !== true
    && window.hasMore !== true;
  const pending = normalized.pendingCoverage || {};
  const pendingComplete = pending.complete === true
    && pending.status === 'complete'
    && pending.basis === O.PENDING_COVERAGE_BASIS;
  const requiredCashMissing = O.REQUIRED_LIVE_CASH_IDS.filter(id => observed.indexOf(id) === -1);
  const missingExpected = expected.filter(id => observed.indexOf(id) === -1);
  const requiredCashBalanceMissing = [];
  for (const id of O.REQUIRED_LIVE_CASH_IDS) {
    if (observed.indexOf(id) === -1) continue;
    let usable = false;
    for (const account of normalized.accounts) {
      const mapping = O.mappingFor(accountMap, account.providerAccountId);
      if (!mapping || mapping.atlasRole !== 'household-cash') continue;
      if (!mapping.canonical || String(mapping.canonical.id) !== id) continue;
      if (account.balance != null && isFinite(Number(account.balance))) {
        usable = true;
        break;
      }
    }
    if (!usable) requiredCashBalanceMissing.push(id);
  }
  const ready = postedComplete
    && pendingComplete
    && requiredCashMissing.length === 0
    && requiredCashBalanceMissing.length === 0
    && missingExpected.length === 0;
  return {
    observedAt: normalized.fetchedAt,
    householdDate: Forecast.financialDate(normalized.fetchedAt),
    mappedHouseholdIdentities: observed,
    unmappedCount,
    missingExpectedIdentities: missingExpected,
    requiredCashMissing,
    requiredCashBalanceMissing,
    postedComplete,
    pendingComplete,
    pendingToPostedTransitions: pendingToPosted,
    readyForReconciliation: ready,
  };
}

function independentDigest(parts) {
  const fingerprint = {
    schema: O.RECEIPT_SCHEMA,
    provider: 'lunchmoney',
    observedAt: parts.observedAt || null,
    householdDate: parts.householdDate || null,
    writesCanonicalState: false,
    canonicalStateChanged: false,
    mappedHouseholdIdentities: parts.mappedHouseholdIdentities || [],
    unmappedCount: Number(parts.unmappedCount) || 0,
    missingExpectedIdentities: parts.missingExpectedIdentities || [],
    requiredCashMissing: parts.requiredCashMissing || [],
    requiredCashBalanceMissing: parts.requiredCashBalanceMissing || [],
    postedComplete: parts.postedComplete === true,
    pendingComplete: parts.pendingComplete === true,
    pendingToPostedTransitions: Number(parts.pendingToPostedTransitions) || 0,
    readyForReconciliation: parts.readyForReconciliation === true,
  };
  return {
    fingerprint,
    digest: crypto.createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex'),
  };
}

console.log('=== A. identical evidence produces the same sanitized receipt ===');
{
  const complete = withCompleteCoverage(pendingPayload);
  const first = observeWith(complete, pendingMap);
  const second = observeWith(complete, pendingMap);
  const indep = independentCoverage(complete, pendingMap);
  const indepHash = independentDigest(indep);
  ok(first.observationReceipt.fingerprintDigest === second.observationReceipt.fingerprintDigest,
    'two observe() calls over identical evidence share one digest');
  ok(JSON.stringify(first.observationReceipt.fingerprint)
    === JSON.stringify(second.observationReceipt.fingerprint),
    'structured fingerprints are byte-identical');
  ok(indepHash.digest === first.observationReceipt.fingerprintDigest,
    'independently reconstructed coverage/identity hashes to the same digest',
    indepHash.digest + ' vs ' + first.observationReceipt.fingerprintDigest);
  ok(JSON.stringify(indep.mappedHouseholdIdentities)
    === JSON.stringify(first.observationReceipt.fingerprint.mappedHouseholdIdentities),
    'independent mapped atlas ids match the receipt');
  ok(indep.unmappedCount === first.observationReceipt.fingerprint.unmappedCount,
    'independent unmapped count matches the receipt');
  ok(indep.pendingToPostedTransitions
    === first.observationReceipt.fingerprint.pendingToPostedTransitions,
    'independent pending-to-posted count matches the receipt');
  ok(first.observationReceipt.readyForReconciliation === true,
    'complete pending-acceptance clone is ready for incumbent reconciliation');
  ok(O.observationReceiptLooksSanitized(first.observationReceipt),
    'receipt omits provider ids, payees, recon statuses, and evidence values');
}

console.log('\n=== B. repeated observation causes zero canonical diff ===');
{
  const before = hashTree();
  const complete = withCompleteCoverage(pendingPayload);
  observeWith(complete, pendingMap);
  observeWith(complete, pendingMap);
  const afterObserve = hashTree();
  const out = execFileSync(process.execPath, [
    OBSERVE,
    '--provider', 'lunchmoney',
    '--fixture', PENDING,
    '--map', PENDING_MAP,
    '--receipt',
  ], { cwd: ROOT, encoding: 'utf8' });
  const printed = JSON.parse(out);
  const afterCli = hashTree();
  ok(before.data === afterObserve.data && afterObserve.data === afterCli.data,
    'data.json bytes unchanged after two observes and CLI --receipt');
  ok(before.positions === afterCli.positions, 'positions.csv unchanged');
  ok(before.periods === afterCli.periods, 'public/periods.json unchanged');
  ok(before.snapshots === afterCli.snapshots, 'snapshots/ tree unchanged');
  ok(printed.canonicalStateChanged === false && printed.writesCanonicalState === false,
    'receipt declares no canonical write or change');
}

console.log('\n=== C. B78 identity/idempotency remains intact on the same seam ===');
{
  const first = observeWith(pendingPayload, pendingMap);
  const second = observeWith(pendingPayload, pendingMap);
  const cmp = O.compareIdentityFingerprints(first.identityProof, second.identityProof);
  ok(cmp.equal && cmp.keysEqual, 'B78 identity fingerprint still matches on replay');
  ok(first.identityProof.mappingBy === 'provider-account-id',
    'identity remains provider-account-id mapping');
  ok(O.identityProofLooksSanitized(first.identityProof),
    'B78 identity proof is still sanitized');
  const renamed = clone(pendingPayload);
  renamed.accounts = renamed.accounts.map(a => (
    a.id === 3001 ? Object.assign({}, a, { name: 'BILLS ACCOUNT RENAMED' }) : a
  ));
  const renamedReport = observeWith(renamed, pendingMap);
  const keysCmp = O.compareIdentityFingerprints(first.identityProof, renamedReport.identityProof);
  ok(keysCmp.keysEqual, 'display-name rename still keeps B78 identity keys');
  ok(first.observationReceipt.fingerprint.mappedHouseholdIdentities
    .join(',') === renamedReport.observationReceipt.fingerprint.mappedHouseholdIdentities.join(','),
    'receipt mapped identities survive a display-name change');
}

console.log('\n=== D. truncated or partial evidence cannot report ready/complete ===');
{
  const complete = withCompleteCoverage(pendingPayload);
  const truncated = withCompleteCoverage(pendingPayload, {
    complete: false,
    hasMore: true,
    truncated: true,
  });
  const bounded = clone(complete);
  bounded.pendingCoverage = {
    complete: false,
    basis: O.PENDING_COVERAGE_BASIS,
    hasMore: false,
    startDate: '2026-08-01',
    endDate: '2026-08-16',
    truncated: false,
  };
  const sample = observeWith(samplePayload, sampleMap);
  const truncatedReceipt = observeWith(truncated, pendingMap).observationReceipt;
  const boundedReceipt = observeWith(bounded, pendingMap).observationReceipt;
  const truncatedIndep = independentCoverage(truncated, pendingMap);
  const sampleIndep = independentCoverage(samplePayload, sampleMap);

  ok(truncatedReceipt.readyForReconciliation === false,
    'truncated posted window is not ready for reconciliation');
  ok(truncatedReceipt.postedTransactionCoverage.status === 'truncated'
    && truncatedReceipt.postedTransactionCoverage.complete === false,
    'truncated window reports truncated, not complete');
  ok(truncatedReceipt.failClosedReasons.indexOf('posted-window-truncated') !== -1,
    'fail-closed reason names the truncated posted window');
  ok(truncatedIndep.readyForReconciliation === false
    && truncatedIndep.postedComplete === false,
    'independent reconstruction also refuses truncated evidence');

  ok(boundedReceipt.readyForReconciliation === false,
    'date-bounded pending coverage is not ready');
  ok(boundedReceipt.pendingTransactionCoverage.complete === false
    && boundedReceipt.pendingTransactionCoverage.status === 'bounded-window',
    'bounded pending is not reported complete');
  ok(boundedReceipt.failClosedReasons.indexOf('pending-coverage-bounded-window') !== -1,
    'fail-closed reason names the bounded pending window');

  ok(sample.observationReceipt.readyForReconciliation === false,
    'sample fixture with unproven coverage is not ready');
  ok(sample.observationReceipt.failClosedReasons.indexOf('pending-coverage-unproven') !== -1,
    'missing pending metadata fails closed as unproven');
  ok(sample.observationReceipt.failClosedReasons.indexOf('required-cash-unobserved') !== -1,
    'sample map missing savings fails closed on required cash');
  ok(sample.observationReceipt.accountCoverage.requiredCashMissing.indexOf('savings') !== -1,
    'receipt names savings as the missing required cash identity');
  ok(sampleIndep.readyForReconciliation === false
    && sampleIndep.requiredCashMissing.indexOf('savings') !== -1,
    'independent reconstruction also reports savings missing');
  ok(sample.observationReceipt.identity.pendingToPostedTransitions === 1,
    'sample intra-payload pending-to-posted remains visible without claiming complete');
}

console.log('\n=== D2. mapped required cash with a null balance cannot report ready ===');
{
  const complete = withCompleteCoverage(pendingPayload);
  const nullBalance = clone(complete);
  nullBalance.accounts = nullBalance.accounts.map(a => (
    a.id === 3003 ? Object.assign({}, a, { balance: null }) : a
  ));
  const rawSavings = nullBalance.accounts.find(a => a.id === 3003);
  ok(rawSavings && rawSavings.balance === null,
    'constructed fixture has mapped savings with a null balance');
  const report = observeWith(nullBalance, pendingMap);
  const receipt = report.observationReceipt;
  const savingsCashObs = (report.observations || []).find(o =>
    o && o.canonical && o.canonical.collection === 'cash' && o.canonical.id === 'savings');
  ok(report.mapped.some(m => m.atlasId === 'savings'),
    'null-balance savings remains a mapped household identity');
  ok(!savingsCashObs,
    'incumbent mapper emits no cash observation when the provider balance is null');
  ok(receipt.accountCoverage.requiredCashMissing.indexOf('savings') === -1,
    'account coverage still counts savings as observed');
  ok(receipt.balanceCoverage.status === 'incomplete'
    && receipt.balanceCoverage.requiredCashMissingDatedBalance.indexOf('savings') !== -1,
    'balance coverage reports savings as missing dated/value evidence');
  ok(receipt.readyForReconciliation === false,
    'receipt is not ready for reconciliation');
  ok(receipt.failClosedReasons.indexOf('required-cash-balance-unproven') !== -1,
    'fail-closed reason names the unproven required-cash balance');
  ok(receipt.fingerprint.requiredCashBalanceMissing.indexOf('savings') !== -1,
    'fingerprint records mapped savings without a usable balance');
}

console.log('\n=== E. CLI --receipt is sanitized and does not leak provider detail ===');
{
  const before = hashTree();
  const out = execFileSync(process.execPath, [
    OBSERVE,
    '--provider', 'lunchmoney',
    '--fixture', SAMPLE,
    '--receipt',
  ], { cwd: ROOT, encoding: 'utf8' });
  const printed = JSON.parse(out);
  ok(printed.schema === O.RECEIPT_SCHEMA, 'CLI --receipt uses the observation-receipt schema');
  ok(printed.provider === 'lunchmoney', 'provider identity is lunchmoney, not a raw account');
  ok(O.observationReceiptLooksSanitized(printed), 'CLI receipt is sanitized');
  ok(!/Bell Mobility|PENDING GROCER|TENNIS BC|Mystery Account/.test(out),
    'CLI receipt has no payee or account display names');
  ok(!/"1001"|"3001"|"88002"|"2461295531"/.test(out),
    'CLI receipt has no fixture provider or transaction ids');
  ok(printed.readyForReconciliation === false, 'unproven sample CLI receipt is not ready');
  ok(hashTree().data === before.data, 'CLI --receipt leaves data.json untouched');
}

console.log('\n=== F. provider-observe remains GET-only and does not write canonical state ===');
{
  const src = fs.readFileSync(OBSERVE, 'utf8');
  ok(/method:\s*'GET'/.test(src), 'live fetch still uses HTTP GET');
  ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(src),
    'observer source has no POST/PUT/PATCH/DELETE');
  ok(!/writeFileSync?\s*\(\s*(DEFAULT_DATA|args\.data)/.test(src),
    'observer still does not write data.json');
  ok(!/--save-payload/.test(src) && !/\bsavePayload\b/.test(src),
    'observer still has no raw-payload write flag');
  const receiptSrc = /function observationReceipt\([\s\S]*?\nfunction representedEventCandidates/.exec(src);
  ok(!!receiptSrc, 'observationReceipt is a distinct function');
  ok(!/Forecast\.recommend|currentPeriodAction|paydayAllocation/.test(receiptSrc[0]),
    'receipt function does not call Forecast financial decisions');
  ok(!/\.reconcile\s*\(/.test(receiptSrc[0]),
    'receipt function does not call the reconciler');
}

console.log('\n=== G. receipt does not invent reconciliation classification or a second matcher ===');
{
  const complete = withCompleteCoverage(pendingPayload);
  const report = observeWith(complete, pendingMap);
  const blob = JSON.stringify(report.observationReceipt);
  ok(!/"status":"(MATCH|CHANGE|CONFLICT|MISSING|STALE)"/.test(blob),
    'receipt has no MATCH/CHANGE/CONFLICT/MISSING/STALE classification');
  ok(report.reconciliation && typeof require('../scripts/reconcile.js').reconcile === 'function',
    'incumbent reconciler remains the matcher on the observe report');
  ok(report.observationReceipt.identity.vsPriorObservation === 'not-claimed',
    'receipt does not invent a prior-observation delta store');
  const reconSrc = fs.readFileSync(RECONCILE, 'utf8');
  const liveSrc = fs.readFileSync(LIVE_PLAN, 'utf8');
  const refreshSrc = fs.readFileSync(CANONICAL, 'utf8');
  ok(/function reconcile/.test(reconSrc), 'scripts/reconcile.js remains the compare authority');
  ok(/overlay/.test(liveSrc) || /function livePlan/.test(liveSrc) || /clone/.test(liveSrc),
    'live-plan overlay file still exists');
  ok(/previewId|approve/.test(refreshSrc), 'canonical-refresh preview/approve writer still exists');
}

console.log('\n=== H. no Forecast financial decision is calculated by this layer ===');
{
  const complete = withCompleteCoverage(pendingPayload);
  const receipt = observeWith(complete, pendingMap).observationReceipt;
  ok(!Object.prototype.hasOwnProperty.call(receipt, 'safeToSpend'),
    'receipt has no safeToSpend');
  ok(!Object.prototype.hasOwnProperty.call(receipt, 'recommend'),
    'receipt has no recommend');
  ok(receipt.balanceCoverage.freshnessVerdict === 'not-claimed',
    'receipt does not claim current merely because balances are dated');
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll AF-REFRESH-02 observation-receipt checks passed.');
