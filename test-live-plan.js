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
const FETCHED_AT = '2026-08-21T18:00:00.000Z';
const OBSERVED = '2026-08-21T17:55:00.000Z';
const LIVE_AS_OF = '2026-08-21';
const UNKNOWN_SAME_DAY_AT = '2026-08-20T18:00:00.000Z';
const PAYDAY_AT = '2026-08-28T18:00:00.000Z';
const PAYDAY_AS_OF = '2026-08-28';
const PURCHASE = 40;
const CASH_PURCHASE = 30;
const SYNTHETIC_PAYROLL = 1000;
const SYNTHETIC_CCB = 50;
const CCB_AS_OF = '2026-08-20';
const ELAPSED_WEEKLY = 70;
const UNPAID_INTERVENING = 100;
const UNPAID_BILL_DATE = '2026-08-20';

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
  if (t.omitProviderIds && t.omitProviderIds.length) {
    const omit = new Set(t.omitProviderIds);
    return accounts.filter(account => !omit.has(account.id));
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
  ok(/key:\s*ATLAS_LIVE_OVERLAY[\s\S]*?value:\s*"live"/.test(render),
    'Render enables the incumbent live overlay');
  ok(/key:\s*LUNCHMONEY_ACCESS_TOKEN[\s\S]*?sync:\s*false/.test(render),
    'Render declares Lunch Money token as owner-supplied');
  ok(!/key:\s*LUNCHMONEY_ACCESS_TOKEN[\s\S]*?value:/.test(render),
    'Render does not assign a Lunch Money token value');
  ok(/key:\s*ATLAS_PROVIDER_ACCOUNT_MAP_JSON[\s\S]*?sync:\s*false/.test(render),
    'Render declares private account-map JSON as owner-supplied');
  ok(!/key:\s*ATLAS_PROVIDER_ACCOUNT_MAP_JSON[\s\S]*?value:/.test(render),
    'Render does not assign account-map JSON');
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
      date: LIVE_AS_OF,
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
  ok(String(result.data.liveOverlay.historicalOpeningAsOf) === String(canonical.plan.opening.asOf),
    'historical opening as-of is recorded on the overlay, not discarded');
  ok(String(result.data.meta.asOf) === LIVE_AS_OF,
    'in-memory meta.asOf is the observation household date');
  ok(String(result.data.plan.opening.asOf) === LIVE_AS_OF,
    'in-memory plan.opening.asOf is the live Forecast start');
  ok(String(canonical.meta.asOf) === String(liveData.meta.asOf),
    'the caller canonical clone is not rewritten');
  ok(String(result.data.liveOverlay.effectiveAsOf) === LIVE_AS_OF,
    'overlay metadata names the live effective as-of');
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
  const recBefore = Forecast.recommend(canonical.plan, canonical.plan.opening.asOf, {
    fundingSources: canonical.plan.funding && canonical.plan.funding.options,
    debts: canonical.debts,
    revolvingExtra: canonical.revolvingExtra,
  });

  const result = overlay(canonical, {
    tweaks: { 'chequing-a': cheqBefore - CASH_PURCHASE },
    transactions: [{
      id: 91002,
      account_id: 3001,
      date: LIVE_AS_OF,
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

  const recAfter = Forecast.recommend(result.data.plan, result.data.meta.asOf, {
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
  ok(figures.asOf === LIVE_AS_OF,
    'live-plan Forecast summary starts on the observation household date');
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
      date: LIVE_AS_OF,
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
      fetchedAt: `${canonical.plan.opening.asOf}T18:00:00.000Z`,
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
          evidenceDate: canonical.plan.opening.asOf,
          dateRelation: 'same-day',
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
  let threw = null;
  try {
    overlay(canonical, {
      pendingCoverage: null,
      transactions: [],
    });
  } catch (err) {
    threw = err;
  }
  ok(threw && /pending-freshness-unproven/.test(threw.message),
    'incomplete pending census fails closed rather than advancing the Forecast clock',
    threw && threw.message);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-pending-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    pendingCoverage: null,
    transactions: [],
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'server overlay returns the dated opening when pending freshness is unproven');
  ok(near(debt(served, 'cashback').pending, 25),
    'incomplete pending census does not overlay $0 over known pending');
  ok(String(served.meta.asOf) === String(canonical.meta.asOf),
    'unproven pending does not advance the served as-of');
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
  ok(parsed.effectiveAsOf === LIVE_AS_OF, 'CLI reports the live effective as-of');
  ok(parsed.forecast && parsed.forecast.asOf === LIVE_AS_OF,
    'CLI Forecast starts on the observation household date');
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
      date: LIVE_AS_OF,
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
  ok(String(served.meta.asOf) === LIVE_AS_OF,
    'served clone Forecast start is the observation household date');
  ok(String(canonical.meta.asOf) === String(liveData.meta.asOf),
    'the cached canonical object keeps the dated opening as-of');
  ok(near(debt(served, 'cashback').pending, Number(debt(canonical, 'cashback').pending || 0) + PURCHASE),
    'served clone has the pending purchase');
  ok(near(debt(canonical, 'cashback').pending, Number(debt(liveData, 'cashback').pending || 0)),
    'the cached canonical object is not mutated');
  ok(near(cashValue(liveData, 'chequing-a'), cashValue(canonical, 'chequing-a')),
    'live data.json is still the dated opening after server overlay');
  filesUnchanged('server fixture overlay');
}

console.log('\n=== 9. unknown same-day scheduled events fail closed ===');
{
  const canonical = clone(liveData);
  let threw = null;
  try {
    overlay(canonical, {
      fetchedAt: UNKNOWN_SAME_DAY_AT,
      tweaks: { cashAt: '2026-08-20T17:55:00.000Z' },
    });
  } catch (err) {
    threw = err;
  }
  ok(threw && /same-day-event-representation-unknown/.test(threw.message),
    'Aug 20 overlay fails closed without child-benefit posting evidence',
    threw && threw.message);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-sameday-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    fetchedAt: UNKNOWN_SAME_DAY_AT,
    tweaks: { cashAt: '2026-08-20T17:55:00.000Z' },
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'server overlay returns the dated opening when same-day representation is unknown');
  ok(/same-day-event-representation-unknown/.test(String(served.liveOverlay.reason || '')),
    'failed overlay names the same-day representation blocker');
  ok(String(served.meta.asOf) === String(canonical.meta.asOf),
    'failed overlay does not move the served as-of');
  ok(String(served.plan.opening.asOf) === String(canonical.plan.opening.asOf),
    'failed overlay does not rewrite the served opening');
  filesUnchanged('unknown same-day');
}

console.log('\n=== 10. posted payroll in the live balance is not emitted again ===');
{
  const canonical = clone(liveData);
  canonical.plan = Object.assign({}, canonical.plan, {
    income: [{
      id: 'payroll',
      label: 'Synthetic payroll',
      frequency: 'biweekly',
      anchor: '2026-08-14',
      amount: SYNTHETIC_PAYROLL,
      confidence: 'confirmed',
    }],
    bills: [],
    obligations: [],
    commitments: [],
  });
  const cheqBefore = cashValue(canonical, 'chequing-a');
  const expectedCash = Math.round((cheqBefore + SYNTHETIC_PAYROLL) * 100) / 100;
  const histAsOf = canonical.plan.opening.asOf;
  const replayBeforeCutover = Forecast.expandEvents(canonical.plan, histAsOf, PAYDAY_AS_OF, {})
    .filter(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF);
  ok(replayBeforeCutover.length === 1,
    'dated opening from 19 Aug would still emit the 28 Aug payroll');
  ok(near(replayBeforeCutover[0].amount, SYNTHETIC_PAYROLL),
    'replayed payroll amount is the synthetic figure, not a live household cent');

  const result = overlay(canonical, {
    fetchedAt: PAYDAY_AT,
    tweaks: {
      'chequing-a': cheqBefore + SYNTHETIC_PAYROLL,
      cashAt: '2026-08-28T17:55:00.000Z',
    },
    transactions: [{
      id: 91028,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: -SYNTHETIC_PAYROLL,
      payee: 'SEASPAN PAYROLL',
      is_pending: false,
      status: 'reviewed',
    }],
  });

  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'payday overlay applies when the posted payroll is identified');
  ok(String(result.data.meta.asOf) === PAYDAY_AS_OF,
    'in-memory as-of is payday');
  ok((result.data.plan.opening.representedEvents || [])
    .some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'posted payroll is named on the in-memory live opening');
  ok(near(cashValue(result.data, 'chequing-a'), expectedCash),
    'Chequing A includes the synthetic payroll by hand',
    String(cashValue(result.data, 'chequing-a')));

  const liveEvents = Forecast.expandEvents(result.data.plan, PAYDAY_AS_OF, PAYDAY_AS_OF, {});
  ok(!liveEvents.some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'Forecast does not emit the posted payroll again on the live as-of');
  const replay = Forecast.expandEvents(result.data.plan, histAsOf, PAYDAY_AS_OF, {});
  ok(replay.some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'starting from the historical opening would still replay payday — the cutover is what prevents it');
  filesUnchanged('posted payroll');
}

console.log('\n=== 11. a later live purchase changes the plan without replaying elapsed days ===');
{
  const canonical = clone(liveData);
  const cashBefore = Forecast.startingCashAmount(canonical.plan);
  const expectedCash = Math.round((cashBefore - CASH_PURCHASE) * 100) / 100;
  const histAsOf = canonical.plan.opening.asOf;
  const result = overlay(canonical, {
    tweaks: { 'chequing-a': cashValue(canonical, 'chequing-a') - CASH_PURCHASE },
    transactions: [{
      id: 91021,
      account_id: 3001,
      date: LIVE_AS_OF,
      amount: CASH_PURCHASE,
      payee: 'SYNTHETIC STORE',
      is_pending: false,
      status: 'reviewed',
    }],
  });
  ok(near(Forecast.startingCashAmount(result.data.plan), expectedCash),
    'live starting cash falls by the synthetic purchase');
  ok(String(result.data.meta.asOf) === LIVE_AS_OF,
    'Forecast start is the later observation date');

  const elapsed = Forecast.diffDays(histAsOf, LIVE_AS_OF);
  ok(elapsed > 0, 'observation is after the dated opening');
  const expectedElapsedVariable = Math.round((ELAPSED_WEEKLY / 7) * elapsed * 100) / 100;
  const replay = Forecast.simulate(result.data.plan, histAsOf, {
    weeklyVariable: ELAPSED_WEEKLY, viewDays: 14, horizonDays: 14,
  });
  const coherent = Forecast.simulate(result.data.plan, LIVE_AS_OF, {
    weeklyVariable: ELAPSED_WEEKLY, viewDays: 14, horizonDays: 14,
  });
  const replayElapsed = (replay.daily || []).filter(d => d.date < LIVE_AS_OF);
  ok(replayElapsed.length === elapsed,
    'historical start walks the elapsed days against already-live cash');
  ok(near(replayElapsed.length * (ELAPSED_WEEKLY / 7), expectedElapsedVariable),
    'elapsed variable spend is weekly/7 times elapsed days by hand');
  ok((coherent.daily || []).every(d => d.date >= LIVE_AS_OF),
    'live as-of does not replay elapsed calendar days');
  ok(!Forecast.expandEvents(result.data.plan, LIVE_AS_OF, LIVE_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === '2026-08-20'),
    'intervening 20 Aug child benefit is not emitted on the live start');
  ok(Forecast.expandEvents(canonical.plan, histAsOf, LIVE_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === '2026-08-20'),
    'the dated opening would still have emitted that intervening child benefit');
  filesUnchanged('elapsed days');
}

console.log('\n=== 12. stale MATCH cash does not advance Forecast or skip elapsed events ===');
{
  const canonical = clone(liveData);
  const histAsOf = canonical.plan.opening.asOf;
  let threw = null;
  try {
    overlay(canonical, {
      fetchedAt: FETCHED_AT,
      tweaks: { cashAt: '2026-08-19T17:55:00.000Z' },
    });
  } catch (err) {
    threw = err;
  }
  ok(threw && /stale-live-cash-evidence/.test(threw.message),
    'later fetch with Aug 19 MATCH cash fails closed',
    threw && threw.message);
  ok(threw && /MATCH is not freshness/.test(threw.message),
    'failure names MATCH is not freshness');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-stale-match-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    fetchedAt: FETCHED_AT,
    tweaks: { cashAt: '2026-08-19T17:55:00.000Z' },
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'server overlay keeps the dated opening when MATCH cash is stale');
  ok(/stale-live-cash-evidence/.test(String(served.liveOverlay.reason || '')),
    'failed overlay names stale live cash evidence');
  ok(String(served.meta.asOf) === String(histAsOf),
    'stale MATCH does not advance meta.asOf');
  ok(String(served.plan.opening.asOf) === String(histAsOf),
    'stale MATCH does not advance plan.opening.asOf');
  ok(Forecast.expandEvents(served.plan, histAsOf, LIVE_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === '2026-08-20'),
    'elapsed 20 Aug child benefit is not skipped when the opening does not advance');
  filesUnchanged('stale MATCH cash');
}

console.log('\n=== 13. unmapped required cash does not advance Forecast or skip elapsed events ===');
{
  const canonical = clone(liveData);
  const histAsOf = canonical.plan.opening.asOf;
  let threw = null;
  try {
    overlay(canonical, {
      tweaks: { omitProviderIds: [3001] },
    });
  } catch (err) {
    threw = err;
  }
  ok(threw && /missing-live-cash-evidence/.test(threw.message),
    'missing Chequing A evidence fails closed',
    threw && threw.message);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-unmap-cash-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    tweaks: { omitProviderIds: [3001] },
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'server overlay keeps the dated opening when required cash is missing');
  ok(/missing-live-cash-evidence/.test(String(served.liveOverlay.reason || '')),
    'failed overlay names missing live cash evidence');
  ok(String(served.plan.opening.asOf) === String(histAsOf),
    'unmapped required cash does not advance the opening');
  ok(Forecast.expandEvents(served.plan, histAsOf, LIVE_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === '2026-08-20'),
    'elapsed 20 Aug child benefit is not skipped when required cash is missing');
  filesUnchanged('unmapped required cash');
}

console.log('\n=== 14. intervening unpaid joint-cash outflow stays reserved ===');
{
  const unpaidBill = {
    id: 'synthetic-unpaid-bill',
    label: 'Synthetic intervening unpaid bill',
    frequency: 'monthly',
    day: 20,
    amount: UNPAID_INTERVENING,
    confidence: 'confirmed',
    budgetCategory: 'household',
  };
  const enginePlan = {
    income: [],
    obligations: [],
    bills: [unpaidBill],
    commitments: [],
    startingCash: { amount: 1000 },
    opening: {
      asOf: LIVE_AS_OF,
      priorAsOf: liveData.plan.opening.asOf,
      representedEvents: [],
    },
  };
  const engineEvents = Forecast.expandEvents(enginePlan, LIVE_AS_OF, LIVE_AS_OF, {});
  const engineHit = engineEvents.find(e => e.id === unpaidBill.id && e.date === UNPAID_BILL_DATE);
  ok(engineHit && near(-engineHit.amount, UNPAID_INTERVENING),
    'Forecast.expandEvents reserves the unpaid $100 from priorAsOf without overlayLiveState');
  ok(!Forecast.expandEvents(Object.assign({}, enginePlan, {
    opening: { asOf: LIVE_AS_OF, representedEvents: [] },
  }), LIVE_AS_OF, LIVE_AS_OF, {}).some(e => e.id === unpaidBill.id),
    'without priorAsOf the recurring intervening bill disappears — the overlay bug');
  ok(!Forecast.expandEvents(Object.assign({}, enginePlan, {
    opening: {
      asOf: LIVE_AS_OF,
      priorAsOf: liveData.plan.opening.asOf,
      representedEvents: [{ id: unpaidBill.id, date: UNPAID_BILL_DATE }],
    },
  }), LIVE_AS_OF, LIVE_AS_OF, {}).some(e => e.id === unpaidBill.id),
    'posting evidence on representedEvents does not reserve the $100 again');

  const canonical = clone(liveData);
  canonical.plan = Object.assign({}, canonical.plan, {
    bills: (canonical.plan.bills || []).concat([unpaidBill]),
  });
  const histAsOf = canonical.plan.opening.asOf;
  const control = overlay(clone(liveData), {});
  const result = overlay(canonical, {});
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'Aug 21 overlay still applies with an unpaid 20 Aug bill');
  ok(String(result.data.plan.opening.priorAsOf) === String(histAsOf),
    'live opening records the historical as-of as priorAsOf');
  ok(JSON.stringify(result.data.plan.bills) === JSON.stringify(canonical.plan.bills),
    'overlay does not rewrite plan.bills to carry the unpaid occurrence');
  ok(!(result.data.plan.opening.representedEvents || [])
    .some(e => e.id === unpaidBill.id && e.date === UNPAID_BILL_DATE),
    'unpaid intervening bill is not named represented');

  const liveEvents = Forecast.expandEvents(result.data.plan, LIVE_AS_OF, LIVE_AS_OF, {});
  const reserved = liveEvents.find(e => e.id === unpaidBill.id && e.date === UNPAID_BILL_DATE);
  ok(reserved && near(-reserved.amount, UNPAID_INTERVENING),
    'live overlay still emits the unpaid $100 on the live start',
    reserved && String(reserved.amount));
  ok(!Forecast.expandEvents(control.data.plan, LIVE_AS_OF, LIVE_AS_OF, {})
    .some(e => e.id === unpaidBill.id),
    'the control overlay without that bill does not invent it');

  const simOpts = { weeklyVariable: 0, viewDays: 1, horizonDays: 1, targetBuffer: 0 };
  const withBill = Forecast.simulate(result.data.plan, LIVE_AS_OF, simOpts);
  const withoutBill = Forecast.simulate(control.data.plan, LIVE_AS_OF, simOpts);
  ok(withBill.daily && withBill.daily[0] && withoutBill.daily && withoutBill.daily[0],
    'both simulations produce the live as-of day');
  ok(near(withoutBill.daily[0].balance - withBill.daily[0].balance, UNPAID_INTERVENING),
    'first-day close falls by the unpaid $100 by hand, not by a live household cent',
    String(withoutBill.daily[0].balance - withBill.daily[0].balance));
  ok(near(Forecast.startingCashAmount(result.data.plan),
      Forecast.startingCashAmount(control.data.plan)),
    'starting cash is unchanged — the $100 is reserved, not subtracted from the live balance');
  filesUnchanged('intervening unpaid outflow');
}

console.log('\n=== 15. posted child benefit on Chequing B is represented, amount is not identity ===');
{
  const rule = (identity.rules || []).find(r => r && r.eventId === 'childBenefit');
  ok(rule && rule.payeePattern === 'CHILD TAX BEN' && rule.atlasAccountId === 'chequing-b'
    && rule.direction === 'credit',
    'identity rule is CHILD TAX BEN + chequing-b + credit');

  const canonical = clone(liveData);
  const cheqBefore = cashValue(canonical, 'chequing-b');
  const expectedCash = Math.round((cheqBefore + SYNTHETIC_CCB) * 100) / 100;
  const histAsOf = canonical.plan.opening.asOf;
  const ccbTx = {
    id: 91020,
    account_id: 3002,
    date: CCB_AS_OF,
    amount: -SYNTHETIC_CCB,
    payee: 'CHILD TAX BEN CCB',
    is_pending: false,
    status: 'reviewed',
  };
  const result = overlay(canonical, {
    fetchedAt: UNKNOWN_SAME_DAY_AT,
    tweaks: {
      'chequing-b': cheqBefore + SYNTHETIC_CCB,
      cashAt: '2026-08-20T17:55:00.000Z',
    },
    transactions: [ccbTx],
  });
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'Aug 20 overlay applies when CHILD TAX BEN CCB is posted on Chequing B');
  ok(String(result.data.meta.asOf) === CCB_AS_OF,
    'in-memory as-of is the child-benefit date');
  ok((result.data.plan.opening.representedEvents || [])
    .some(e => e.id === 'childBenefit' && e.date === CCB_AS_OF),
    'posted child benefit is named on the in-memory live opening');
  ok(near(cashValue(result.data, 'chequing-b'), expectedCash),
    'Chequing B includes the synthetic credit by hand',
    String(cashValue(result.data, 'chequing-b')));
  ok(!Forecast.expandEvents(result.data.plan, CCB_AS_OF, CCB_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === CCB_AS_OF),
    'Forecast does not emit the posted child benefit again on the live as-of');
  ok(Forecast.expandEvents(canonical.plan, histAsOf, CCB_AS_OF, {})
    .some(e => e.id === 'childBenefit' && e.date === CCB_AS_OF),
    'the dated opening would still have emitted that child benefit');

  const observed = O.observe({
    provider: 'lunchmoney',
    payload: payloadFrom(canonical, {
      fetchedAt: UNKNOWN_SAME_DAY_AT,
      tweaks: { cashAt: '2026-08-20T17:55:00.000Z' },
      transactions: [ccbTx],
    }),
    accountMap,
    data: canonical,
    identity,
    fetchedAt: UNKNOWN_SAME_DAY_AT,
  });
  const hit = (observed.representedEventCandidates || [])
    .find(c => c.id === 'childBenefit' && c.date === CCB_AS_OF);
  ok(hit && hit.identity === 'payee+account+date' && hit.amountNotUsed === true,
    'observer identity is payee+account+date, not amount');

  function sameDayFails(transactions, label) {
    let threw = null;
    try {
      overlay(clone(liveData), {
        fetchedAt: UNKNOWN_SAME_DAY_AT,
        tweaks: { cashAt: '2026-08-20T17:55:00.000Z' },
        transactions,
      });
    } catch (err) {
      threw = err;
    }
    ok(threw && /same-day-event-representation-unknown: childBenefit@2026-08-20/.test(threw.message),
      label, threw && threw.message);
  }
  sameDayFails([{
    id: 91021,
    account_id: 3002,
    date: CCB_AS_OF,
    amount: -SYNTHETIC_CCB,
    payee: 'UNKNOWN DEPOSIT',
    is_pending: false,
    status: 'reviewed',
  }], 'same amount without CHILD TAX BEN payee is not child benefit');
  sameDayFails([{
    id: 91022,
    account_id: 3001,
    date: CCB_AS_OF,
    amount: -SYNTHETIC_CCB,
    payee: 'CHILD TAX BEN CCB',
    is_pending: false,
    status: 'reviewed',
  }], 'CHILD TAX BEN credit on Chequing A is not child benefit');
  sameDayFails([{
    id: 91023,
    account_id: 3002,
    date: CCB_AS_OF,
    amount: -SYNTHETIC_CCB,
    payee: 'CHILD TAX BEN CCB',
    is_pending: true,
    status: 'unreviewed',
  }], 'pending CHILD TAX BEN is not posting evidence');
  sameDayFails([{
    id: 91024,
    account_id: 3002,
    date: CCB_AS_OF,
    amount: SYNTHETIC_CCB,
    payee: 'CHILD TAX BEN CCB',
    is_pending: false,
    status: 'reviewed',
  }], 'CHILD TAX BEN debit is not child benefit');
  sameDayFails([
    {
      id: 91025,
      account_id: 3002,
      date: CCB_AS_OF,
      amount: -SYNTHETIC_CCB,
      payee: 'CHILD TAX BEN CCB',
      is_pending: false,
      status: 'reviewed',
    },
    {
      id: 91026,
      account_id: 3002,
      date: CCB_AS_OF,
      amount: -40,
      payee: 'CHILD TAX BEN CCB',
      is_pending: false,
      status: 'reviewed',
    },
  ], 'two matching CHILD TAX BEN credits stay fail-closed');
  filesUnchanged('posted child benefit identity');
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} live-plan check(s)`);
  process.exit(1);
}
console.log('ALL LIVE-PLAN OVERLAY CHECKS PASSED');
