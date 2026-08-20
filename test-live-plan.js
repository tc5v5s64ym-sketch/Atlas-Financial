'use strict';
/* Read-only live plan overlay: Lunch Money → observe/reconcile → in-memory
 * current account state → Forecast, without rewriting historical openings.
 *
 * Independent proof is hand arithmetic on named posted/pending/cash
 * amounts (L-002). Live data.json cents are a MATCH baseline, not the
 * expected specification (L-006). Does not write data.json or snapshots.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const O = require('./scripts/provider-observe.js');
const Live = require('./scripts/live-plan.js');
const Forecast = require('./public/forecast.js');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data.json');
const MAP = path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'b81-account-map.json');
const IDENTITY = path.join(ROOT, 'docs', 'connectivity', 'transaction-identity.json');
const SCRIPT = path.join(ROOT, 'scripts', 'live-plan.js');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const FETCHED_AT = '2026-08-20T18:00:00.000Z';
const OBSERVED = '2026-08-20T17:55:00.000Z';
const PURCHASE = 40;
const CASH_PURCHASE = 30;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));

const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const accountMap = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const identity = JSON.parse(fs.readFileSync(IDENTITY, 'utf8'));
const liveHash = hashFile(DATA);
const snapshotHashes = fs.readdirSync(SNAPSHOT_DIR)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);

function cashValue(data, id) {
  const rows = ((data.plan && data.plan.startingCash && data.plan.startingCash.breakdown) || []);
  const row = rows.find(r => r && r.id === id);
  return row ? Number(row.value) : null;
}

function debt(data, id) {
  return ((data.debts || []).find(d => d && d.id === id)) || null;
}

function independentUsed(posted, pending) {
  return Math.round((Number(posted) + Number(pending || 0)) * 100) / 100;
}

function independentAvailable(posted, pending, limit) {
  return Math.round(Math.max(0, Number(limit) - independentUsed(posted, pending)) * 100) / 100;
}

function completePendingCoverage() {
  return {
    complete: true,
    basis: 'is_pending-unbounded',
    hasMore: false,
    startDate: null,
    endDate: null,
  };
}

function matchingAccounts(data, tweaks) {
  const t = tweaks || {};
  const accounts = [
    {
      id: 3001, name: 'BILLS ACCOUNT', type: 'cash', subtype: 'checking',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t['chequing-a'] != null ? t['chequing-a'] : cashValue(data, 'chequing-a'),
      updated_at: t.cashAt || OBSERVED,
    },
    {
      id: 3002, name: 'WEEKLY SPENDING', type: 'cash', subtype: 'checking',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t['chequing-b'] != null ? t['chequing-b'] : cashValue(data, 'chequing-b'),
      updated_at: t.cashAt || OBSERVED,
    },
    {
      id: 3003, name: 'EMERGENCY SAVING', type: 'cash', subtype: 'savings',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.savings != null ? t.savings : cashValue(data, 'savings'),
      updated_at: t.savingsAt || t.cashAt || OBSERVED,
    },
    {
      id: 3004, name: 'PERSONAL CREDIT CARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.tdcc != null ? t.tdcc : debt(data, 'tdcc').balance,
      credit_limit: debt(data, 'tdcc').limit,
      available_balance: t.tdccAvailable,
      updated_at: t.cardAt || OBSERVED,
    },
    {
      id: 3005, name: 'TD CASH BACK VISA* CARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.cashback != null ? t.cashback : debt(data, 'cashback').balance,
      credit_limit: debt(data, 'cashback').limit,
      available_balance: t.cashbackAvailable,
      updated_at: t.cardAt || OBSERVED,
    },
    {
      id: 3006, name: 'TRAVEL VISA', type: 'credit', subtype: 'credit_card',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.travelvisa != null ? t.travelvisa : debt(data, 'travelvisa').balance,
      credit_limit: debt(data, 'travelvisa').limit,
      updated_at: t.cardAt || OBSERVED,
    },
    {
      id: 3007, name: 'LINE OF CREDIT - HOME EQUITY', type: 'loan', subtype: 'line_of_credit',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.heloc != null ? t.heloc : debt(data, 'heloc').balance,
      updated_at: t.loanAt || OBSERVED,
    },
    {
      id: 3008, name: 'MORTGAGE', type: 'loan', subtype: 'mortgage',
      institution_name: 'TD Canada Trust', currency: 'cad',
      balance: t.mortgage != null ? t.mortgage : debt(data, 'mortgage').balance,
      updated_at: t.loanAt || OBSERVED,
    },
    {
      id: 3010, name: 'TRIANGLE MASTERCARD', type: 'credit', subtype: 'credit_card',
      institution_name: 'Canadian Tire Bank', currency: 'cad',
      balance: t.triangle != null ? t.triangle : debt(data, 'triangle').balance,
      credit_limit: debt(data, 'triangle').limit,
      updated_at: t.triangleAt || OBSERVED,
    },
  ];
  if (t.unmapped) {
    accounts.push({
      id: 3999, name: 'Unmapped Extra', type: 'cash',
      institution_name: 'Unknown', currency: 'cad',
      balance: 50, updated_at: OBSERVED,
    });
  }
  return accounts;
}

function payloadFrom(data, extra) {
  const extraPayload = extra || {};
  return {
    provider: 'lunchmoney',
    fetchedAt: extraPayload.fetchedAt || FETCHED_AT,
    source: 'Synthetic live-plan fixture. Not a live institution pull. Fixture IDs 3001–3010 are not live provider IDs.',
    pendingCoverage: extraPayload.pendingCoverage === undefined
      ? completePendingCoverage()
      : extraPayload.pendingCoverage,
    accounts: matchingAccounts(data, extraPayload.tweaks),
    transactions: extraPayload.transactions || [],
  };
}

function overlay(data, extra) {
  return Live.fromObservation({
    data,
    payload: payloadFrom(data, extra),
    accountMap,
    identity,
  });
}

function snapshotState() {
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);
}

function filesUnchanged(label) {
  ok(hashFile(DATA) === liveHash, `${label}: data.json bytes unchanged`);
  const now = snapshotState();
  ok(now.length === snapshotHashes.length
    && now.every((row, i) => row === snapshotHashes[i]),
    `${label}: snapshots unchanged`);
}

console.log('=== 1. overlay defaults off and does not write ===');
{
  ok(Live.overlayModeFromEnv({}) === 'off', 'missing env is overlay off');
  ok(Live.overlayModeFromEnv({ ATLAS_LIVE_OVERLAY: '1' }) === 'off',
    'ATLAS_LIVE_OVERLAY=1 is not a live fetch');
  ok(Live.overlayModeFromEnv({ ATLAS_LIVE_OVERLAY: 'fixture' }) === 'fixture',
    'fixture mode is explicit');
  const render = fs.existsSync(path.join(ROOT, 'render.yaml'))
    ? fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
    : '';
  ok(!/ATLAS_LIVE_OVERLAY\s*[:=].*live/.test(render),
    'Render config does not enable live overlay');
  ok(!/LUNCHMONEY_ACCESS_TOKEN/.test(render),
    'Render config still has no Lunch Money token');
  const served = Live.serveCanonicalOrFixture(liveData, {});
  ok(served === liveData || served.liveOverlay == null,
    'server overlay off returns the dated opening');
  ok(!served.liveOverlay, 'no liveOverlay metadata when overlay is off');
  filesUnchanged('default off');
}

console.log('\n=== 2. pending purchase overlays utilisation, not the file ===');
{
  const canonical = clone(liveData);
  const card = debt(canonical, 'cashback');
  const posted = Number(card.balance);
  const pendingBefore = Number(card.pending || 0);
  const limit = Number(card.limit);
  const expectedUsed = independentUsed(posted, pendingBefore + PURCHASE);
  const expectedAvail = independentAvailable(posted, pendingBefore + PURCHASE, limit);
  const beforeAvail = independentAvailable(posted, pendingBefore, limit);
  const utilBefore = Forecast.utilisation(canonical.debts, canonical.revolvingExtra, canonical.plan);
  const rowBefore = utilBefore.rows.find(r => r.id === 'cashback');

  const result = overlay(canonical, {
    transactions: [{
      id: 91001,
      account_id: 3005,
      date: '2026-08-20',
      amount: PURCHASE,
      payee: 'SYNTHETIC GROCER',
      is_pending: true,
      status: 'unreviewed',
    }],
  });

  ok(result.writesCanonicalState === false, 'overlay declares no canonical write');
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'liveOverlay metadata marks the in-memory clone applied');
  ok(result.data.liveOverlay.writesCanonicalState === false,
    'metadata says writesCanonicalState false');
  ok(String(result.data.meta.asOf) === String(canonical.meta.asOf),
    'historical meta.asOf is unchanged');
  ok(String(result.data.plan.opening.asOf) === String(canonical.plan.opening.asOf),
    'historical plan.opening.asOf is unchanged');
  ok(near(debt(result.data, 'cashback').pending, pendingBefore + PURCHASE),
    'Cash Back pending overlays the synthetic purchase',
    String(debt(result.data, 'cashback').pending));
  ok(near(debt(result.data, 'cashback').balance, posted),
    'posted Cash Back balance is not rewritten by a pending purchase');

  const utilAfter = Forecast.utilisation(result.data.debts, result.data.revolvingExtra, result.data.plan);
  const rowAfter = utilAfter.rows.find(r => r.id === 'cashback');
  ok(rowAfter && near(rowAfter.used, expectedUsed),
    'Forecast.utilisation used matches posted + pending by hand',
    rowAfter && String(rowAfter.used));
  ok(rowAfter && near(rowAfter.available, expectedAvail),
    'Forecast.utilisation available matches limit − used by hand',
    rowAfter && String(rowAfter.available));
  ok(rowBefore && near(rowBefore.available - rowAfter.available, PURCHASE),
    'available credit falls by the synthetic purchase, not by an invented amount');
  ok(near(beforeAvail - expectedAvail, PURCHASE),
    'independent available delta is the purchase amount');
  ok(JSON.stringify(result.data.plan.income) === JSON.stringify(canonical.plan.income),
    'plan.income is untouched');
  ok(JSON.stringify(result.data.plan.bills) === JSON.stringify(canonical.plan.bills),
    'plan.bills are untouched');
  ok(JSON.stringify(result.data.plan.commitments) === JSON.stringify(canonical.plan.commitments),
    'plan.commitments are untouched');
  filesUnchanged('pending purchase');
}

console.log('\n=== 3. posted cash purchase moves starting cash and safe-to-spend ===');
{
  const canonical = clone(liveData);
  const cashBefore = Forecast.startingCashAmount(canonical.plan);
  const cheqBefore = cashValue(canonical, 'chequing-a');
  const expectedCash = Math.round((cashBefore - CASH_PURCHASE) * 100) / 100;
  const asOf = canonical.plan.opening.asOf;
  const recBefore = Forecast.recommend(canonical.plan, asOf, {
    fundingSources: canonical.plan.funding && canonical.plan.funding.options,
    debts: canonical.debts,
    revolvingExtra: canonical.revolvingExtra,
  });

  const result = overlay(canonical, {
    tweaks: { 'chequing-a': cheqBefore - CASH_PURCHASE },
    transactions: [{
      id: 91002,
      account_id: 3001,
      date: '2026-08-20',
      amount: CASH_PURCHASE,
      payee: 'SYNTHETIC STORE',
      is_pending: false,
      status: 'reviewed',
    }],
  });

  const cashAfter = Forecast.startingCashAmount(result.data.plan);
  ok(near(cashAfter, expectedCash),
    'Forecast.startingCashAmount falls by the synthetic cash purchase',
    String(cashAfter));
  ok(near(cashValue(result.data, 'chequing-a'), cheqBefore - CASH_PURCHASE),
    'Chequing A overlays the posted purchase');
  ok(near(cashValue(canonical, 'chequing-a'), cheqBefore),
    'the in-memory canonical clone passed in is not required to mutate; overlay returns a new document');
  ok(near(cashValue(liveData, 'chequing-a'), cheqBefore),
    'live data.json Chequing A is still the dated opening');

  const recAfter = Forecast.recommend(result.data.plan, asOf, {
    fundingSources: result.data.plan.funding && result.data.plan.funding.options,
    debts: result.data.debts,
    revolvingExtra: result.data.revolvingExtra,
  });
  ok(recAfter && (recAfter.weekly != null || recAfter.mode === 'infeasible'),
    'Forecast.recommend still answers on the overlaid opening');
  if (recBefore.mode !== 'infeasible' && recAfter.mode !== 'infeasible') {
    ok(recAfter.weekly <= recBefore.weekly + 0.005,
      'safe-to-spend does not rise after a cash purchase',
      `${recBefore.weekly} → ${recAfter.weekly}`);
  } else {
    ok(recBefore.mode === recAfter.mode || recAfter.mode === 'infeasible',
      'a cash purchase does not invent a newly feasible cap');
  }
  const figures = Live.forecastFrom(result.data);
  ok(near(figures.startingCash, expectedCash),
    'live-plan Forecast summary uses the overlaid starting cash');
  filesUnchanged('cash purchase');
}

console.log('\n=== 4. available credit is never cash; transfers are not income ===');
{
  const canonical = clone(liveData);
  const cashBefore = Forecast.startingCashAmount(canonical.plan);
  const incomeBefore = JSON.stringify(canonical.plan.income);
  const result = overlay(canonical, {
    tweaks: { cashbackAvailable: 10000 },
    transactions: [{
      id: 91003,
      account_id: 3001,
      date: '2026-08-20',
      amount: -200,
      payee: 'SEASPAN PAYROLL',
      is_pending: false,
      status: 'reviewed',
    }],
  });
  ok(near(Forecast.startingCashAmount(result.data.plan), cashBefore),
    'available credit 10000 does not enter spendable cash');
  ok(JSON.stringify(result.data.plan.income) === incomeBefore,
    'an inbound transfer transaction is not promoted into plan.income');
  ok(result.refused.some(r => r.reason === 'credit-capacity-not-cash'),
    'available-credit / limit facts are refused as credit-capacity-not-cash');
  const spendable = O.spendableCashFromObservations(result.report.observations);
  ok(near(spendable, cashBefore),
    'observer spendable cash is the mapped cash accounts, not card availability');
  filesUnchanged('credit and transfer');
}

console.log('\n=== 5. Triangle cadence keeps canonical; unmapped and conflict fail closed ===');
{
  const canonical = clone(liveData);
  const trianglePosted = Number(debt(canonical, 'triangle').balance);
  const result = overlay(canonical, {
    tweaks: {
      triangle: trianglePosted - 185.62,
      triangleAt: '2026-08-18T17:55:00.000Z',
      unmapped: true,
    },
  });
  ok(near(debt(result.data, 'triangle').balance, trianglePosted),
    'stale Triangle Lunch Money does not overlay over the cadence-accepted opening');
  ok(result.refused.some(r => r.reason === 'statement-cadence-keep-canonical'
    || r.reason === 'stale-not-current'),
    'Triangle stale evidence is refused rather than invented');
  ok(result.refused.some(r => r.reason === 'unmapped-provider-account'),
    'unmapped provider accounts fail closed');

  const conflicted = Live.overlayLiveState({
    data: canonical,
    report: {
      writesCanonicalState: false,
      fetchedAt: FETCHED_AT,
      pendingCoverage: completePendingCoverage(),
      unmapped: [],
      representedEventCandidates: [],
      reconciliation: {
        rows: [{
          fact: null,
          status: 'CONFLICT',
          canonicalTarget: 'cash:chequing-a',
          canonicalValue: cashValue(canonical, 'chequing-a'),
          evidenceValue: cashValue(canonical, 'chequing-a') - 10,
          evidenceDate: '2026-08-20',
          dateRelation: 'canonical-older',
        }],
      },
    },
  });
  ok(near(cashValue(conflicted.data, 'chequing-a'), cashValue(canonical, 'chequing-a')),
    'CONFLICT does not overlay a guessed Chequing A value');
  ok(conflicted.refused.some(r => r.reason === 'conflicting-observations'),
    'CONFLICT is refused as conflicting-observations');
  filesUnchanged('cadence and conflict');
}

console.log('\n=== 6. unknown pending is not invented as zero ===');
{
  const canonical = clone(liveData);
  canonical.debts = canonical.debts.map(row => {
    if (row.id !== 'cashback') return row;
    return Object.assign({}, row, { pending: 25, pendingUnknown: false });
  });
  const result = overlay(canonical, {
    pendingCoverage: null,
    transactions: [],
  });
  ok(near(debt(result.data, 'cashback').pending, 25),
    'incomplete pending census does not overlay $0 over known pending');
  ok(!result.overlays.some(o => o.locator === 'debts:cashback#pending' && near(o.proposedValue, 0)),
    'unproven zero pending is not proposed');
  filesUnchanged('unknown pending');
}

console.log('\n=== 7. CLI fixture run is read-only and sanitized ===');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-'));
  const fixture = path.join(dir, 'fixture.json');
  const canonical = clone(liveData);
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    tweaks: { 'chequing-a': cashValue(canonical, 'chequing-a') - CASH_PURCHASE },
  }), null, 2)}\n`);
  const stdout = execFileSync(process.execPath, [
    SCRIPT,
    '--fixture', fixture,
    '--map', MAP,
    '--data', DATA,
  ], { cwd: ROOT, encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  ok(parsed.writesCanonicalState === false, 'CLI JSON says writesCanonicalState false');
  ok(parsed.overlayCount >= 1, 'CLI overlay applied the cash CHANGE');
  ok(parsed.forecast && near(parsed.forecast.startingCash,
    Forecast.startingCashAmount(canonical.plan) - CASH_PURCHASE),
    'CLI Forecast starting cash matches the independent purchase delta');
  ok(!/"providerAccountId"\s*:/.test(stdout), 'CLI output has no providerAccountId');
  ok(!/LUNCHMONEY_ACCESS_TOKEN/.test(stdout), 'CLI output has no token env name as a secret');
  ok(!/Bearer\s+\S+/.test(stdout), 'CLI output has no Bearer token');
  filesUnchanged('CLI fixture');
}

console.log('\n=== 8. server fixture overlay does not mutate the cached opening ===');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-srv-'));
  const fixture = path.join(dir, 'fixture.json');
  const canonical = clone(liveData);
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    transactions: [{
      id: 91004,
      account_id: 3005,
      date: '2026-08-20',
      amount: PURCHASE,
      payee: 'SYNTHETIC GROCER',
      is_pending: true,
      status: 'unreviewed',
    }],
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served !== canonical, 'server overlay returns a clone');
  ok(served.liveOverlay && served.liveOverlay.applied === true,
    'served payload carries liveOverlay metadata');
  ok(near(debt(served, 'cashback').pending, Number(debt(canonical, 'cashback').pending || 0) + PURCHASE),
    'served clone has the pending purchase');
  ok(near(debt(canonical, 'cashback').pending, Number(debt(liveData, 'cashback').pending || 0)),
    'the cached canonical object is not mutated');
  ok(near(cashValue(liveData, 'chequing-a'), cashValue(canonical, 'chequing-a')),
    'live data.json is still the dated opening after server overlay');
  filesUnchanged('server fixture overlay');
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} live-plan check(s)`);
  process.exit(1);
}
console.log('ALL LIVE-PLAN OVERLAY CHECKS PASSED');
