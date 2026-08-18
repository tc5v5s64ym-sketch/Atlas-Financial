'use strict';
/* B78 / AF-INGEST-01 — identity-stable idempotent Lunch Money observation.
 *
 * Proves the incumbent observer/reconciler: same evidence is a no-op,
 * provider-account identity survives a display-name change, a corrected
 * amount updates the same canonical target, historical posting candidates
 * do not enter the current-opening compare, same-day CHANGE chooses no
 * winner, unmapped accounts fail closed, and credit capacity is not cash.
 * Does not write data.json. Does not invent a pending→posted case.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const O = require('./scripts/provider-observe.js');
const R = require('./scripts/reconcile.js');

const ROOT = __dirname;
const SAMPLE = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json');
const SAMPLE_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json');
const PENDING = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-pending-acceptance.json');
const PENDING_MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'pending-account-map.json');
const IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const DATA = path.join(ROOT, 'data.json');
const PAYDAY = '2026-08-14';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const identity = JSON.parse(fs.readFileSync(IDENTITY, 'utf8'));
const samplePayload = JSON.parse(fs.readFileSync(SAMPLE, 'utf8'));
const sampleMap = JSON.parse(fs.readFileSync(SAMPLE_MAP, 'utf8'));
const pendingPayload = JSON.parse(fs.readFileSync(PENDING, 'utf8'));
const pendingMap = JSON.parse(fs.readFileSync(PENDING_MAP, 'utf8'));

function observeSample(payload, extra) {
  return O.observe(Object.assign({
    provider: 'lunchmoney',
    payload: payload || samplePayload,
    accountMap: sampleMap,
    data,
    identity,
    fetchedAt: (payload || samplePayload).fetchedAt,
  }, extra || {}));
}

function observePending(payload, extra) {
  return O.observe(Object.assign({
    provider: 'lunchmoney',
    payload: payload || pendingPayload,
    accountMap: pendingMap,
    data,
    identity,
    fetchedAt: (payload || pendingPayload).fetchedAt,
  }, extra || {}));
}

console.log('=== A. same payload observed twice is an identity no-op ===');
{
  const before = hashFile(DATA);
  const first = observePending();
  const second = observePending();
  const cmp = O.compareIdentityFingerprints(first.identityProof, second.identityProof);
  ok(cmp.equal && cmp.keysEqual, 'second observe matches the first fingerprint exactly');
  ok(first.writesCanonicalState === false && second.writesCanonicalState === false,
    'neither run claims a canonical write');
  ok(hashFile(DATA) === before, 'data.json bytes are unchanged after two observes');
  ok(O.identityProofLooksSanitized(first.identityProof),
    'identity proof omits provider IDs, transaction IDs, and the token name');
}

console.log('\n=== B. display-name change keeps the same canonical target ===');
{
  const renamed = clone(pendingPayload);
  renamed.accounts = renamed.accounts.map(a => (
    a.id === 3001 ? Object.assign({}, a, { name: 'BILLS ACCOUNT RENAMED' }) : a
  ));
  const baseline = observePending();
  const report = observePending(renamed);
  const cmp = O.compareIdentityFingerprints(baseline.identityProof, report.identityProof);
  ok(cmp.keysEqual, 'renamed mapped account keeps the same identity keys');
  const hits = report.mapped.filter(m => m.atlasId === 'chequing-a');
  ok(hits.length === 1 && hits[0].providerAccountId === '3001',
    'provider 3001 still maps only to chequing-a');
  ok(hits[0].displayName === 'BILLS ACCOUNT RENAMED',
    'new display name remains a label');
  const cash = report.observations.find(o => o.canonical && o.canonical.id === 'chequing-a'
    && o.canonical.collection === 'cash');
  ok(cash && near(cash.evidenceValue, 1320.13),
    'the renamed account still observes the same chequing-a cash target');
}

console.log('\n=== C. a corrected amount updates the same target, not a second identity ===');
{
  const corrected = clone(pendingPayload);
  corrected.accounts = corrected.accounts.map(a => (
    a.id === 3002 ? Object.assign({}, a, { balance: 922.05 }) : a
  ));
  const baseline = observePending();
  const report = observePending(corrected);
  const baseKeys = baseline.identityProof.observations.map(o => o.key).sort();
  const newKeys = report.identityProof.observations.map(o => o.key).sort();
  ok(JSON.stringify(baseKeys) === JSON.stringify(newKeys),
    'correcting Chequing B does not mint another observation key');
  const before = baseline.identityProof.observations.find(o => o.key === 'cash:chequing-b');
  const after = report.identityProof.observations.find(o => o.key === 'cash:chequing-b');
  ok(before && near(before.evidenceValue, 932.05),
    'baseline Chequing B is the fixture $932.05');
  ok(after && near(after.evidenceValue, 922.05),
    'corrected observation stays on cash:chequing-b at $922.05');
  const row = report.reconciliation.rows.find(r => r.canonicalTarget === 'cash:chequing-b');
  ok(row && row.status === 'CHANGE' && near(row.evidenceValue, 922.05),
    'reconciler updates the same Chequing B target');
  ok(report.writesCanonicalState === false,
    'the correction remains evidence — it does not write data.json');
}

console.log('\n=== D. historical payroll candidates do not enter current-opening compare ===');
{
  const report = observePending();
  const payroll = report.representedEventCandidates.find(c => c.id === 'payroll' && c.date === PAYDAY);
  ok(!!payroll, '120-day-style fixture still identifies the 14 August Seaspan payroll');
  ok(payroll.currentOpeningImpact === false && payroll.mustNotBackfillOpening === true,
    '14 August payroll is classified as not a current-opening correction');
  ok(payroll.openingRelevance === 'historical-before-opening',
    'opening as-of 2026-08-16 makes 14 August historical');
  ok(!report.identityProof.currentOpeningRepresentedEventCandidates.some(c => c.eventId === 'payroll'),
    'historical payroll is absent from current-opening posting candidates');
  ok(report.identityProof.historicalRepresentedEventCandidates
    .some(c => c.eventId === 'payroll' && c.date === PAYDAY && c.mustNotBackfillOpening),
    'historical candidate is recorded with mustNotBackfillOpening');
  ok(!(report.reconciliation.rows || []).some(r =>
    r.fact === 'posting' && r.eventId === 'payroll' && r.scheduledDate === PAYDAY),
    'reconciler does not receive a current CHANGE against representedEvents for that payroll');
  ok((data.plan.opening.representedEvents || []).length === 0,
    'live representedEvents remains empty — nothing was backfilled');
}

console.log('\n=== E. a current-opening posting candidate still reconciles in place ===');
{
  const paydayData = clone(data);
  paydayData.plan.opening = {
    asOf: PAYDAY,
    representedEvents: [],
  };
  const report = observePending(pendingPayload, { data: paydayData });
  const payroll = report.representedEventCandidates.find(c => c.id === 'payroll' && c.date === PAYDAY);
  ok(payroll && payroll.currentOpeningImpact === true,
    'same payroll is current-opening when as-of is 14 August');
  const row = report.reconciliation.rows.find(r =>
    r.fact === 'posting' && r.eventId === 'payroll' && r.scheduledDate === PAYDAY);
  ok(row && row.status === 'CHANGE' && row.canonicalTarget === 'representedEvents:payroll@' + PAYDAY,
    'current-opening posted payroll still compares against that one representedEvents target');
  ok(report.writesCanonicalState === false,
    'current-opening CHANGE still does not write representedEvents');
}

console.log('\n=== F. same-day CHANGE chooses no canonical winner ===');
{
  const sameDay = clone(pendingPayload);
  sameDay.accounts = sameDay.accounts.map(a => (
    a.id === 3002 ? Object.assign({}, a, { balance: 922.05 }) : a
  ));
  const report = observePending(sameDay);
  const row = report.reconciliation.rows.find(r => r.canonicalTarget === 'cash:chequing-b');
  ok(row && row.status === 'CHANGE' && row.dateRelation === 'same-day',
    'Chequing B $10 move on the canonical as-of day is same-day CHANGE');
  const flagged = report.sameDayDiscrepancies.find(d => d.canonicalTarget === 'cash:chequing-b');
  ok(flagged && flagged.winnerChosen === false,
    'same-day CHANGE records winnerChosen false');
  ok(/no canonical winner/i.test(flagged.reason),
    'the reason names the missing time evidence');
  ok(report.writesCanonicalState === false,
    'same-day discrepancy does not silently replace the canonical figure');
}

console.log('\n=== G. unmapped accounts fail closed; credit is never cash ===');
{
  const report = observeSample();
  ok(report.unmapped.some(u => u.providerAccountId === '9999'),
    'unknown provider account stays unmapped');
  ok(!report.observations.some(o => o.providerAccountId === '9999'),
    'unmapped account produces no observation');
  ok(!report.identityProof.observations.some(o => /9999/.test(o.key)),
    'unmapped id is absent from identity keys');
  ok(report.cardCapacityIsCash === 0 && report.identityProof.cardCapacityIsCash === 0,
    'cardCapacityIsCash remains 0');
  ok(R.householdCashFromCardCapacity() === 0,
    'reconciler independently still returns 0 household cash from capacity');
  ok(near(report.spendableCash, 79.84),
    'spendable cash is mapped cash only, not available credit');
}

console.log('\n=== H. CLI identity-proof print is sanitized and read-only ===');
{
  const before = hashFile(DATA);
  const out = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'provider-observe.js'),
    '--provider', 'lunchmoney',
    '--fixture', PENDING,
    '--map', PENDING_MAP,
    '--identity-proof',
  ], { cwd: ROOT, encoding: 'utf8' });
  const printed = JSON.parse(out);
  ok(printed.mappingBy === 'provider-account-id', 'CLI identity-proof names provider-account identity');
  ok(printed.endpointOriginPreserved === false,
    'CLI does not fabricate automatic-versus-manual endpoint origin');
  ok(printed.canonicalWriteAuthorized === false, 'CLI proof does not authorize a write');
  ok(O.identityProofLooksSanitized(printed),
    'CLI identity-proof JSON has no provider IDs or token');
  ok(hashFile(DATA) === before, 'CLI run leaves data.json untouched');
}

console.log('\n=== I. no second identity system, store, or writer ===');
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'provider-observe.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'scripts', 'reconcile.js'), 'utf8');
  ok(/function mappingFor/.test(src) && /providerAccountId/.test(src),
    'identity remains existing provider account IDs');
  ok(!/function newIdentity|createIdentitySystem|IdentityStore/.test(src),
    'no second identity system was added');
  ok(!/sqlite|postgres|mongodb/i.test(src), 'no store was introduced');
  ok(!/writeFileSync?\s*\(\s*(DEFAULT_DATA|args\.data)/.test(src),
    'observer and reconciler still do not write data.json');
  ok(!/--save-payload/.test(src) && !/\bsavePayload\b/.test(src),
    'observer has no raw-payload write flag');
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll B78 identity checks passed.');
