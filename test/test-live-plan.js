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
const vm = require('vm');
const O = require('../scripts/provider-observe.js');
const C = require('../scripts/canonical-refresh.js');
const Live = require('../scripts/live-plan.js');
const OA = require('../scripts/operating-answer.js');
const Assistant = require('../scripts/assistant-packet.js');
const Forecast = require('../public/forecast.js');
const Chequing = require('../public/forecast-chequing.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
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
const NEXT_DAY_AT = '2026-08-29T18:00:00.000Z';
const NEXT_DAY_AS_OF = '2026-08-29';
const PURCHASE = 40;
const CASH_PURCHASE = 30;
const SYNTHETIC_PAYROLL = 1000;
const SYNTHETIC_MORTGAGE_OBSERVED = 1234.56;
const SYNTHETIC_FIT_OBSERVED = 9.99;
const SYNTHETIC_TRANSFER = 19.03;
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
  const payload = {
    provider: 'lunchmoney',
    fetchedAt: extraPayload.fetchedAt || FETCHED_AT,
    source: 'Synthetic live-plan fixture. Not a live institution pull. Fixture IDs 3001–3010 are not live provider IDs.',
    pendingCoverage: extraPayload.pendingCoverage === undefined
      ? completePendingCoverage()
      : extraPayload.pendingCoverage,
    accounts: matchingAccounts(data, extraPayload.tweaks),
    transactions: extraPayload.transactions || [],
  };
  if (extraPayload.categories) payload.categories = extraPayload.categories;
  if (extraPayload.transactionWindow) payload.transactionWindow = extraPayload.transactionWindow;
  return payload;
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

console.log('\n=== 9. unknown same-day income fails closed ===');
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
  ok(/childBenefit@2026-08-20/.test(threw && threw.message || ''),
    'unknown same-day income names the unrepresented child benefit');
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

console.log('\n=== 16. fail-closed overlay still reports current observed chequing ===');
{
  const OWNER_A = 217.69;
  const OWNER_B = -591;
  const OWNER_SAVINGS = 0.58;
  const LIMIT = 600;
  const independentNet = Math.round((OWNER_A + OWNER_B) * 100) / 100;
  const independentUsed = Math.max(0, -OWNER_B);
  const independentUnused = Math.max(0, LIMIT - independentUsed);
  const independentAvailable = Math.round(
    (Math.max(0, OWNER_A) + Math.max(0, OWNER_B) + independentUnused) * 100) / 100;
  ok(near(independentNet, -373.31) && near(independentUnused, 9)
      && near(independentAvailable, 226.69),
    'independent owner identity is net −$373.31, unused $9, available $226.69');

  const canonical = clone(liveData);
  const staleA = cashValue(canonical, 'chequing-a');
  const staleB = cashValue(canonical, 'chequing-b');
  const staleSavings = cashValue(canonical, 'savings');
  const staleCash = Forecast.startingCashAmount(canonical.plan);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-chequing-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, {
    pendingCoverage: null,
    tweaks: {
      'chequing-a': OWNER_A,
      'chequing-b': OWNER_B,
      savings: OWNER_SAVINGS,
    },
  }), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'Forecast overlay still fails closed when pending freshness is unproven');
  ok(near(cashValue(served, 'chequing-a'), staleA)
      && near(cashValue(served, 'chequing-b'), staleB)
      && near(Forecast.startingCashAmount(served.plan), staleCash),
    'fail-closed overlay does not rewrite the Forecast cash opening');
  const observed = served.liveOverlay && served.liveOverlay.observedCash;
  ok(observed && observed.complete === true,
    'freshness-qualified posted cash is still attached as observedCash');
  const observedA = (observed.accounts || []).find(row => row.id === 'chequing-a');
  const observedB = (observed.accounts || []).find(row => row.id === 'chequing-b');
  const observedSavings = (observed.accounts || []).find(row => row.id === 'savings');
  ok(observedA && near(observedA.value, OWNER_A)
      && observedB && near(observedB.value, OWNER_B)
      && observedSavings && near(observedSavings.value, OWNER_SAVINGS),
    'observedCash carries current Chequing A, Chequing B, and Savings');
  const summary = Chequing.chequingAvailability(served.plan, served.revolvingExtra, served.liveOverlay);
  ok(summary.cashSource === 'observed-cash' && near(summary.chequingBalance, independentNet),
    'chequing availability reads observed cash, not the stale opening');
  ok(near(summary.overdraftUsed, independentUsed) && near(summary.overdraftRemaining, independentUnused),
    'unused overdraft is $9, not the full $600 limit');
  ok(near(summary.available, independentAvailable),
    'available in chequing is the independent $226.69 identity',
    String(summary.available));
  ok(!near(summary.available, staleA + staleB + LIMIT),
    'stale $939.04 opening plus $600 cannot produce the headline');
  ok(!near(summary.available, OWNER_A + LIMIT),
    'the full $600 overdraft is not added after $591 has already been consumed');
  ok(!near(summary.available, independentAvailable + OWNER_SAVINGS),
    'savings is excluded from available-in-chequing');
  const util = Forecast.utilisation(served.debts, served.revolvingExtra, served.plan);
  ok(util.totalAvailable > summary.available + 1000,
    'card and HELOC utilisation remain a separate revolving total');
  ok(!near(summary.available, util.totalAvailable)
      && !near(summary.available, independentAvailable + Number((served.debts.find(d => d.id === 'heloc') || {}).limit || 0)),
    'no credit-card or HELOC capacity enters available-in-chequing');
  ok(near(staleA, 629.27) && near(staleB, 309.77) && near(staleSavings, 0.58),
    'canonical opening used as the stale baseline remains the Aug 19 cash rows');
  filesUnchanged('observed chequing on fail-closed overlay');
}

console.log('\n=== 17. posted payday-window mortgage and Fit4less Msp are represented; unknown payee still reserves ===');
{
  const canonical = clone(liveData);
  const scheduledMortgage = Number((canonical.plan.obligations || [])
    .find(row => row && row.id === 'mortgage').amount);
  const scheduledFit = Number((canonical.plan.bills || [])
    .find(row => row && row.id === 'fit4less').amount);
  ok(scheduledMortgage > 0 && scheduledFit > 0,
    'plan still names the biweekly mortgage and Fit4Less amounts');
  ok(!near(SYNTHETIC_MORTGAGE_OBSERVED, scheduledMortgage),
    'observed mortgage debit is deliberately not the scheduled amount');
  ok(!near(SYNTHETIC_FIT_OBSERVED, scheduledFit),
    'observed Fit4Less debit is deliberately not the scheduled amount');

  const mortgageRule = (identity.rules || []).find(r => r && r.eventId === 'mortgage');
  ok(mortgageRule && mortgageRule.payeePattern === 'TD MORTGAGE'
    && mortgageRule.atlasAccountId === 'chequing-a' && mortgageRule.direction === 'debit',
    'mortgage identity is documented TD MORTGAGE + Chequing A debit');
  const fitRule = (identity.rules || []).find(r => r && r.eventId === 'fit4less');
  ok(fitRule && fitRule.payeePattern === 'Fit4less Msp'
    && fitRule.atlasAccountId === 'chequing-a' && fitRule.direction === 'debit',
    'Fit4Less identity is documented Fit4less Msp + Chequing A debit');
  ok(!(identity.rules || []).some(r => r && r.eventId === 'tdfees'),
    'TD fees have no invented payee identity');
  const travelRule = (identity.rules || []).find(r => r && r.eventId === 'travel');
  ok(travelRule && travelRule.atlasAccountId === 'travelvisa'
    && travelRule.direction === 'credit'
    && travelRule.payeePattern === 'TFR-TO C/C'
    && !(travelRule.payeePatterns || []).some(p => /travel visa/i.test(p)),
    'Travel Visa min identity is a payment onto the mapped card, not an invented chequing payee');

  const categories = [
    { id: 21, name: 'Income', is_income: true, exclude_from_totals: false },
    { id: 22, name: 'Mortgage', is_income: false, exclude_from_totals: false },
    { id: 23, name: 'Personal Care', is_income: false, exclude_from_totals: false },
    { id: 24, name: 'Payment/Transfer', is_income: false, exclude_from_totals: true },
  ];
  const window = {
    startDate: '2026-08-16',
    endDate: NEXT_DAY_AS_OF,
    complete: true,
    hasMore: false,
    truncated: false,
  };
  const fitTx = (payee, amount) => ({
    id: 92029,
    account_id: 3001,
    date: PAYDAY_AS_OF,
    amount,
    payee,
    category_id: 23,
    is_pending: false,
    status: 'reviewed',
  });
  const sharedTx = amount => [
    {
      id: 92028,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: -SYNTHETIC_PAYROLL,
      payee: 'SEASPAN PAYROLL',
      category_id: 21,
      is_pending: false,
      status: 'reviewed',
    },
    fitTx('GYM STORE', amount),
    {
      id: 92030,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: SYNTHETIC_TRANSFER,
      payee: 'INTERNAL TRANSFER',
      category_id: 24,
      exclude_from_totals: true,
      is_pending: false,
      status: 'reviewed',
    },
  ];
  const mortgageTx = payee => ({
    id: 92031,
    account_id: 3001,
    date: PAYDAY_AS_OF,
    amount: SYNTHETIC_MORTGAGE_OBSERVED,
    payee,
    category_id: 22,
    is_pending: false,
    status: 'reviewed',
  });
  const extra = (mortgagePayee, fitPayee, fitAmount) => {
    const amt = fitAmount != null ? fitAmount : scheduledFit;
    const txs = sharedTx(amt).map(tx => (
      tx.id === 92029 ? fitTx(fitPayee || 'GYM STORE', amt) : tx
    ));
    return {
      fetchedAt: NEXT_DAY_AT,
      categories,
      transactionWindow: window,
      tweaks: {
        'chequing-a': cashValue(canonical, 'chequing-a')
          + SYNTHETIC_PAYROLL - SYNTHETIC_MORTGAGE_OBSERVED - amt - SYNTHETIC_TRANSFER,
        cashAt: '2026-08-29T17:55:00.000Z',
      },
      transactions: txs.concat([mortgageTx(mortgagePayee)]),
    };
  };

  const control = overlay(clone(canonical), extra('UNKNOWN MORTGAGE PAYEE', 'GYM STORE', scheduledFit));
  const result = overlay(clone(canonical), extra('TD MORTGAGE', 'GYM STORE', scheduledFit));
  const identified = overlay(clone(canonical), extra('TD MORTGAGE', 'Fit4less Msp', SYNTHETIC_FIT_OBSERVED));
  ok(control.data.liveOverlay && control.data.liveOverlay.applied === true,
    'control overlay still applies without guessing the mortgage');
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'Aug 29 overlay applies when TD MORTGAGE is identified');
  ok(identified.data.liveOverlay && identified.data.liveOverlay.applied === true,
    'Aug 29 overlay applies when Fit4less Msp is identified');
  ok(String(result.data.meta.asOf) === NEXT_DAY_AS_OF,
    'in-memory as-of is the day after payday');
  ok(!(result.report.currentPeriodActuals.transactions || [])
      .some(tx => tx && tx.date === NEXT_DAY_AS_OF),
    'fixture has no transactions dated 2026-08-29');

  const mortgageHit = (result.report.representedEventCandidates || [])
    .find(c => c.id === 'mortgage' && c.date === PAYDAY_AS_OF);
  ok(mortgageHit && mortgageHit.identity === 'payee+account+date'
    && mortgageHit.amountNotUsed === true
    && near(mortgageHit.observedAmount, SYNTHETIC_MORTGAGE_OBSERVED),
    'mortgage identity is payee+account+date, not the scheduled $ amount');
  ok(!(control.report.representedEventCandidates || [])
      .some(c => c.id === 'mortgage'),
    'amount and Mortgage category without TD MORTGAGE is not identity');
  ok((result.data.plan.opening.representedEvents || [])
      .some(e => e.id === 'mortgage' && e.date === PAYDAY_AS_OF),
    'posted payday-window mortgage is named on the in-memory opening');
  ok(!(result.data.plan.opening.representedEvents || [])
      .some(e => e.id === 'fit4less'),
    'Personal Care amount is not invented into Fit4Less representation');

  const fitHit = (identified.report.representedEventCandidates || [])
    .find(c => c.id === 'fit4less' && c.date === PAYDAY_AS_OF);
  ok(fitHit && fitHit.identity === 'payee+account+date'
    && fitHit.amountNotUsed === true
    && near(fitHit.observedAmount, SYNTHETIC_FIT_OBSERVED),
    'Fit4Less identity is payee+account+date, not the scheduled $ amount');
  ok((identified.data.plan.opening.representedEvents || [])
      .some(e => e.id === 'fit4less' && e.date === PAYDAY_AS_OF),
    'posted Friday Fit4less Msp is named on the in-memory opening');

  const payrollHits = (result.data.plan.opening.representedEvents || [])
    .filter(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF);
  ok(payrollHits.length === 1,
    'Aug 28 payroll is represented once and not replayed onto representedEvents');
  ok(!Forecast.expandEvents(result.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
      .some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'Forecast does not emit the posted Aug 28 payroll again');
  ok(Forecast.expandEvents(canonical.plan, canonical.plan.opening.asOf, PAYDAY_AS_OF, {})
      .some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'the dated opening would still emit that payroll');

  ok(!Forecast.expandEvents(result.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
      .some(e => e.id === 'mortgage' && e.date === PAYDAY_AS_OF),
    'Forecast does not reserve the posted mortgage again');
  ok(Forecast.expandEvents(control.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
      .some(e => e.id === 'mortgage' && e.date === PAYDAY_AS_OF),
    'without TD MORTGAGE identity the mortgage remains reserved');
  const controlReserved = Forecast.expandEvents(control.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
    .find(e => e.id === 'mortgage' && e.date === PAYDAY_AS_OF);
  ok(controlReserved && near(-controlReserved.amount, scheduledMortgage),
    'independent reserved amount is the plan mortgage row, not the observed debit');

  const fitReserved = Forecast.expandEvents(result.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
    .find(e => e.id === 'fit4less' && e.date === PAYDAY_AS_OF);
  ok(fitReserved && near(-fitReserved.amount, scheduledFit),
    'unknown Fit4Less payee still reserves the gym membership');
  ok(!Forecast.expandEvents(identified.data.plan, NEXT_DAY_AS_OF, NEXT_DAY_AS_OF, {})
      .some(e => e.id === 'fit4less' && e.date === PAYDAY_AS_OF),
    'Fit4less Msp leaves the gym membership reserved');

  const advice = Forecast.recommend(result.data.plan, NEXT_DAY_AS_OF, {
    currentPeriodActuals: result.data.liveOverlay.currentPeriodActuals,
    debts: result.data.debts,
    revolvingExtra: result.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  const controlAdvice = Forecast.recommend(control.data.plan, NEXT_DAY_AS_OF, {
    currentPeriodActuals: control.data.liveOverlay.currentPeriodActuals,
    debts: control.data.debts,
    revolvingExtra: control.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  const identifiedAdvice = Forecast.recommend(identified.data.plan, NEXT_DAY_AS_OF, {
    currentPeriodActuals: identified.data.liveOverlay.currentPeriodActuals,
    debts: identified.data.debts,
    revolvingExtra: identified.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  const items = (advice.paydayAllocation && advice.paydayAllocation.obligations
    && advice.paydayAllocation.obligations.items) || [];
  const controlItems = (controlAdvice.paydayAllocation
    && controlAdvice.paydayAllocation.obligations
    && controlAdvice.paydayAllocation.obligations.items) || [];
  const identifiedItems = (identifiedAdvice.paydayAllocation
    && identifiedAdvice.paydayAllocation.obligations
    && identifiedAdvice.paydayAllocation.obligations.items) || [];
  ok(!items.some(row => row.id === 'mortgage' && row.date === PAYDAY_AS_OF),
    'paydayAllocation does not treat the posted mortgage as still due');
  ok(controlItems.some(row => row.id === 'mortgage' && row.date === PAYDAY_AS_OF
      && row.settlement === 'unverified'),
    'control still lists the unidentified mortgage as unverified');
  ok(items.some(row => row.id === 'fit4less' && row.date === PAYDAY_AS_OF
      && row.settlement === 'unverified'),
    'unknown Fit4Less payee stays reserved');
  ok(!identifiedItems.some(row => row.id === 'fit4less' && row.date === PAYDAY_AS_OF),
    'Fit4less Msp does not keep the gym membership reserved');
  ok(identifiedItems.some(row => row.id === 'travel' || row.label === 'Travel Visa minimum')
    || identifiedItems.some(row => row.id === 'tdfees'),
    'Travel Visa and/or TD fees can remain reserved without an invented identity');
  ok(near(
    controlAdvice.paydayAllocation.obligations.wanted - advice.paydayAllocation.obligations.wanted,
    scheduledMortgage
  ), 'independent wanted delta is the scheduled mortgage, not the observed debit');
  ok(near(
    advice.paydayAllocation.obligations.wanted - identifiedAdvice.paydayAllocation.obligations.wanted,
    scheduledFit
  ), 'independent Fit4Less wanted delta is the scheduled gym amount, not the observed debit');

  const bills = (advice.currentPeriodAction && advice.currentPeriodAction.bills) || [];
  const identifiedBills = (identifiedAdvice.currentPeriodAction
    && identifiedAdvice.currentPeriodAction.bills) || [];
  const identifiedInflows = (identifiedAdvice.currentPeriodAction
    && identifiedAdvice.currentPeriodAction.inflows) || [];
  ok(bills.some(row => row.id === 'mortgage' && row.settlement === 'represented'
      && near(row.actual, SYNTHETIC_MORTGAGE_OBSERVED)),
    'currentPeriodAction names the mortgage represented with the observed actual');
  ok(bills.some(row => row.id === 'fit4less' && row.settlement === 'unverified'),
    'unknown Fit4Less payee stays unverified on currentPeriodAction');
  ok(identifiedBills.some(row => row.id === 'fit4less' && row.settlement === 'represented'
      && near(row.actual, SYNTHETIC_FIT_OBSERVED)),
    'Fit4less Msp is already paid with the observed actual, not the scheduled amount');
  ok(identifiedInflows.some(row => row.id === 'payroll' && row.date === PAYDAY_AS_OF),
    'represented Friday Seaspan is an inflow on currentPeriodAction');

  const transferActual = (result.report.currentPeriodActuals.transactions || [])
    .find(tx => tx && tx.date === PAYDAY_AS_OF && near(tx.amount, SYNTHETIC_TRANSFER));
  ok(transferActual && transferActual.excludeFromTotals === true
      && transferActual.accountRole === 'household-cash',
    'Aug 28 Payment/Transfer excludeFromTotals is observed household-cash');
  const unmatched = (result.report.obligationReconciliationReceipt
    && result.report.obligationReconciliationReceipt.unmatchedCashEvidence) || [];
  ok(!unmatched.some(row => near(row.amount, SYNTHETIC_TRANSFER)),
    'excludeFromTotals transfer is not unmatched household cash');
  ok(result.writesCanonicalState === false
      && result.data.liveOverlay.writesCanonicalState === false,
    'live overlay still does not write canonical state');
  const preview = C.buildPreview(result.report, { data: canonical });
  ok(!(preview.proposed || []).some(row => near(row.proposedValue, SYNTHETIC_TRANSFER)
      || near(row.currentValue, SYNTHETIC_TRANSFER)),
    'canonical preview does not write the unmatched $ transfer');
  ok(!(preview.unresolved || []).some(row =>
      row.reason === 'unmatched-household-cash-must-not-write'
      && near(row.amount, SYNTHETIC_TRANSFER)),
    'excludeFromTotals transfer does not become an unmatched write row');
  ok((preview.ownerQuestions || []).some(row => row.id === 'fit4less'
      && row.reason === 'unverified-settlement-owner-fact'),
    'unknown Fit4Less payee remains an unverified-settlement owner question');
  ok(!(preview.ownerQuestions || []).some(row => row.id === 'mortgage'),
    'represented mortgage is not an owner settlement question');
  const identifiedPreview = C.buildPreview(identified.report, { data: canonical });
  ok(!(identifiedPreview.ownerQuestions || []).some(row => row.id === 'fit4less'),
    'Fit4less Msp is not an owner settlement question');
  const question = result.data.refreshTrust && result.data.refreshTrust.ownerQuestion;
  ok(question && question.reason === 'unverified-settlement-owner-fact',
    'refresh-trust still surfaces the unverified-settlement owner-fact gate',
    question && `${question.id} ${question.reason}`);
  filesUnchanged('posted payday-window mortgage');
}

console.log('\n=== 18. complete live cash plus missing same-day unposted bill still overlays ===');
{
  const FEE_DAY_AT = '2026-08-30T18:00:00.000Z';
  const FEE_DAY_AS_OF = '2026-08-30';
  const SYNTHETIC_LIVE_A = 410.11;
  const SYNTHETIC_LIVE_B = -80.07;
  const SYNTHETIC_LIVE_SAVINGS = 1.33;
  const independentLeftover = Math.round(
    (SYNTHETIC_LIVE_A + SYNTHETIC_LIVE_B + SYNTHETIC_LIVE_SAVINGS) * 100
  ) / 100;
  const canonical = clone(liveData);
  const openingCash = Forecast.startingCashAmount(canonical.plan);
  const scheduledFees = Number((canonical.plan.bills || [])
    .find(row => row && row.id === 'tdfees').amount);
  ok(scheduledFees > 0, 'plan still names the month-end TD fees amount');
  ok(!(identity.rules || []).some(r => r && r.eventId === 'tdfees'),
    'TD fees have no invented payee identity');
  const travelRule = (identity.rules || []).find(r => r && r.eventId === 'travel');
  ok(travelRule && travelRule.atlasAccountId === 'travelvisa'
    && travelRule.direction === 'credit'
    && travelRule.payeePattern === 'TFR-TO C/C'
    && !(travelRule.payeePatterns || []).some(p => /travel visa/i.test(p)),
    'Travel Visa min identity is a payment onto the mapped card, not an invented chequing payee');
  ok(!near(independentLeftover, openingCash),
    'synthetic live cash is not the dated opening leftover');

  const paydayTxs = [
    {
      id: 93028,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: -SYNTHETIC_PAYROLL,
      payee: 'SEASPAN PAYROLL',
      category_id: 21,
      is_pending: false,
      status: 'reviewed',
    },
    {
      id: 93029,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: SYNTHETIC_MORTGAGE_OBSERVED,
      payee: 'TD MORTGAGE',
      category_id: 22,
      is_pending: false,
      status: 'reviewed',
    },
    {
      id: 93030,
      account_id: 3001,
      date: PAYDAY_AS_OF,
      amount: SYNTHETIC_FIT_OBSERVED,
      payee: 'Fit4less Msp',
      category_id: 23,
      is_pending: false,
      status: 'reviewed',
    },
  ];
  const extra = {
    fetchedAt: FEE_DAY_AT,
    categories: [
      { id: 21, name: 'Income', is_income: true, exclude_from_totals: false },
      { id: 22, name: 'Mortgage', is_income: false, exclude_from_totals: false },
      { id: 23, name: 'Personal Care', is_income: false, exclude_from_totals: false },
    ],
    transactionWindow: {
      startDate: '2026-08-16',
      endDate: FEE_DAY_AS_OF,
      complete: true,
      hasMore: false,
      truncated: false,
    },
    tweaks: {
      'chequing-a': SYNTHETIC_LIVE_A,
      'chequing-b': SYNTHETIC_LIVE_B,
      savings: SYNTHETIC_LIVE_SAVINGS,
      cashAt: '2026-08-30T17:55:00.000Z',
    },
    transactions: paydayTxs,
  };

  const result = overlay(clone(canonical), extra);
  ok(result.data.liveOverlay && result.data.liveOverlay.applied === true,
    'Aug 30 overlay applies when Friday payday is represented and TD fees are unposted');
  ok(String(result.data.meta.asOf) === FEE_DAY_AS_OF,
    'in-memory as-of is the morning household date');
  const represented = result.data.plan.opening.representedEvents || [];
  ok(represented.length > 0, 'representedEvents are not emptied by the unposted same-day bill');
  ok(represented.some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'Friday Seaspan stays represented');
  ok(represented.some(e => e.id === 'mortgage' && e.date === PAYDAY_AS_OF),
    'Friday mortgage stays represented');
  ok(represented.some(e => e.id === 'fit4less' && e.date === PAYDAY_AS_OF),
    'Friday Fit4Less stays represented');
  ok(!represented.some(e => e.id === 'tdfees'),
    'unposted TD fees are not invented onto representedEvents');
  ok(!represented.some(e => e.id === 'travel'),
    'Travel Visa is not invented onto representedEvents');

  ok(near(cashValue(result.data, 'chequing-a'), SYNTHETIC_LIVE_A)
      && near(cashValue(result.data, 'chequing-b'), SYNTHETIC_LIVE_B)
      && near(cashValue(result.data, 'savings'), SYNTHETIC_LIVE_SAVINGS),
    'posted cash overlays the complete live observation');
  const liveCash = Forecast.startingCashAmount(result.data.plan);
  ok(near(liveCash, independentLeftover),
    'leftover cash is the independent live posted sum',
    String(liveCash));
  ok(!near(liveCash, openingCash),
    'leftover cash is not the dated opening');

  ok(Forecast.expandEvents(result.data.plan, FEE_DAY_AS_OF, FEE_DAY_AS_OF, {})
      .some(e => e.id === 'tdfees' && e.date === FEE_DAY_AS_OF),
    'Forecast still emits unposted TD fees on the live as-of');
  ok(!Forecast.expandEvents(result.data.plan, FEE_DAY_AS_OF, FEE_DAY_AS_OF, {})
      .some(e => e.id === 'payroll' && e.date === PAYDAY_AS_OF),
    'Forecast does not replay Friday Seaspan onto the live as-of');

  const advice = Forecast.recommend(result.data.plan, FEE_DAY_AS_OF, {
    currentPeriodActuals: result.data.liveOverlay.currentPeriodActuals,
    debts: result.data.debts,
    revolvingExtra: result.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  ok(near(advice.paydayAllocation.available, independentLeftover),
    'payday leftover copies live posted cash, not the dated opening');
  const due = (advice.currentPeriodAction && advice.currentPeriodAction.thisPaydayDue) || [];
  const paid = (advice.currentPeriodAction && advice.currentPeriodAction.thisPaydayPaid) || {};
  ok(due.some(row => row.id === 'tdfees' && row.date === FEE_DAY_AS_OF),
    'still due can list TD fees');
  ok(due.some(row => row.id === 'travel' || /Travel Visa/i.test(String(row.label || ''))),
    'Travel Visa min stays still due with no invented payee');
  ok((paid.inflows || []).some(row => row.id === 'payroll' && row.date === PAYDAY_AS_OF),
    'already paid keeps Friday Seaspan in');
  ok((paid.bills || []).some(row => row.id === 'mortgage' && row.date === PAYDAY_AS_OF),
    'already paid keeps Friday mortgage');
  ok((paid.bills || []).some(row => row.id === 'fit4less' && row.date === PAYDAY_AS_OF),
    'already paid keeps Friday Fit4Less');
  const actuals = result.data.liveOverlay.currentPeriodActuals;
  ok(actuals && Array.isArray(actuals.transactions) && actuals.transactions.length > 0,
    'applied overlay keeps current-period actuals');
  ok(!(result.report.representedEventCandidates || []).some(c => c.id === 'tdfees'),
    'observer does not invent a TD fees candidate');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-fees-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, extra), null, 2)}\n`);
  const served = Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
  ok(served.liveOverlay && served.liveOverlay.applied === true,
    'server overlay still applies on the unposted same-day bill');
  ok((served.plan.opening.representedEvents || []).length > 0,
    'server representedEvents are not emptied');
  ok(near(Forecast.startingCashAmount(served.plan), independentLeftover),
    'served leftover stays the live posted sum');

  const withUnknownIncome = clone(canonical);
  withUnknownIncome.plan = Object.assign({}, withUnknownIncome.plan, {
    income: (withUnknownIncome.plan.income || []).concat([{
      id: 'same-day-unknown-income',
      label: 'Synthetic same-day income',
      frequency: 'once',
      date: FEE_DAY_AS_OF,
      amount: 50,
      confidence: 'confirmed',
    }]),
  });
  let threw = null;
  try {
    overlay(withUnknownIncome, extra);
  } catch (err) {
    threw = err;
  }
  ok(threw && /same-day-event-representation-unknown: same-day-unknown-income@2026-08-30/.test(threw.message),
    'unknown same-day income still refuses the overlay',
    threw && threw.message);
  filesUnchanged('unposted same-day bill overlay');
}

console.log('\n=== 19. extra payment onto a mapped card covers that card min; chequing TFR-TO C/C does not ===');
{
  const SYNTHETIC_CARD_PAY = 40.4;
  const SYNTHETIC_SHORT = 5.05;
  const canonical = clone(liveData);
  const scheduledTravel = Number((canonical.plan.obligations || [])
    .find(row => row && row.id === 'travel').amount);
  ok(scheduledTravel > 0, 'plan still names the Travel Visa minimum');
  ok(SYNTHETIC_CARD_PAY + 0.005 >= scheduledTravel && !near(SYNTHETIC_CARD_PAY, scheduledTravel),
    'identified extra payment covers the min and is not the scheduled $');
  ok(SYNTHETIC_SHORT + 0.005 < scheduledTravel,
    'short card credit is independently below the min');

  const paydayTxs = [
    {
      id: 94028, account_id: 3001, date: PAYDAY_AS_OF, amount: -SYNTHETIC_PAYROLL,
      payee: 'SEASPAN PAYROLL', category_id: 21, is_pending: false, status: 'reviewed',
    },
    {
      id: 94029, account_id: 3001, date: PAYDAY_AS_OF, amount: SYNTHETIC_MORTGAGE_OBSERVED,
      payee: 'TD MORTGAGE', category_id: 22, is_pending: false, status: 'reviewed',
    },
    {
      id: 94030, account_id: 3001, date: PAYDAY_AS_OF, amount: SYNTHETIC_FIT_OBSERVED,
      payee: 'Fit4less Msp', category_id: 23, is_pending: false, status: 'reviewed',
    },
  ];
  const window = {
    startDate: '2026-08-16',
    endDate: NEXT_DAY_AS_OF,
    complete: true,
    hasMore: false,
    truncated: false,
  };
  const categories = [
    { id: 21, name: 'Income', is_income: true, exclude_from_totals: false },
    { id: 22, name: 'Mortgage', is_income: false, exclude_from_totals: false },
    { id: 23, name: 'Personal Care', is_income: false, exclude_from_totals: false },
    { id: 24, name: 'Payment/Transfer', is_income: false, exclude_from_totals: true },
  ];
  const extraFor = (cardTx) => ({
    fetchedAt: NEXT_DAY_AT,
    categories,
    transactionWindow: window,
    tweaks: {
      'chequing-a': cashValue(canonical, 'chequing-a')
        + SYNTHETIC_PAYROLL - SYNTHETIC_MORTGAGE_OBSERVED - SYNTHETIC_FIT_OBSERVED,
      cashAt: '2026-08-29T17:55:00.000Z',
    },
    transactions: paydayTxs.concat(cardTx || []),
  });

  const chequingOnly = overlay(clone(canonical), extraFor([{
    id: 94031, account_id: 3001, date: PAYDAY_AS_OF, amount: SYNTHETIC_CARD_PAY,
    payee: 'TFR-TO C/C', category_id: 24, exclude_from_totals: true,
    is_pending: false, status: 'reviewed',
  }]));
  const shortCard = overlay(clone(canonical), extraFor([{
    id: 94032, account_id: 3006, date: PAYDAY_AS_OF, amount: -SYNTHETIC_SHORT,
    payee: 'TFR-TO C/C', is_pending: false, status: 'reviewed',
  }]));
  const identified = overlay(clone(canonical), extraFor([{
    id: 94033, account_id: 3006, date: PAYDAY_AS_OF, amount: -SYNTHETIC_CARD_PAY,
    payee: 'TFR-TO C/C', is_pending: false, status: 'reviewed',
  }]));

  ok(chequingOnly.data.liveOverlay && chequingOnly.data.liveOverlay.applied === true,
    'chequing TFR-TO C/C overlay still applies');
  ok(identified.data.liveOverlay && identified.data.liveOverlay.applied === true,
    'card-account extra payment overlay applies');
  ok(!(chequingOnly.report.representedEventCandidates || []).some(c => c.id === 'travel'),
    'TFR-TO C/C leaving chequing is not Travel Visa identity');
  ok(!(shortCard.report.representedEventCandidates || []).some(c => c.id === 'travel'),
    'identified card credit below the min does not settle it');
  const hit = (identified.report.representedEventCandidates || [])
    .find(c => c.id === 'travel');
  ok(hit && hit.date === '2026-08-26' && hit.postingDate === PAYDAY_AS_OF
      && hit.identity === 'payee+account+date' && hit.amountNotUsed === true
      && near(hit.observedAmount, -SYNTHETIC_CARD_PAY),
    'Travel Visa identity is payee + mapped card + credit covering Aug 26, not the $17');
  ok((identified.data.plan.opening.representedEvents || [])
      .some(e => e.id === 'travel' && e.date === '2026-08-26'),
    'in-memory opening names the covered min on its scheduled date');

  const advice = Forecast.recommend(identified.data.plan, NEXT_DAY_AS_OF, {
    currentPeriodActuals: identified.data.liveOverlay.currentPeriodActuals,
    debts: identified.data.debts,
    revolvingExtra: identified.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  const controlAdvice = Forecast.recommend(chequingOnly.data.plan, NEXT_DAY_AS_OF, {
    currentPeriodActuals: chequingOnly.data.liveOverlay.currentPeriodActuals,
    debts: chequingOnly.data.debts,
    revolvingExtra: chequingOnly.data.revolvingExtra,
    targetBuffer: canonical.plan.defaults.targetBuffer,
  });
  const paid = (advice.currentPeriodAction && advice.currentPeriodAction.thisPaydayPaid) || {};
  const due = (advice.currentPeriodAction && advice.currentPeriodAction.thisPaydayDue) || [];
  const controlDue = (controlAdvice.currentPeriodAction
    && controlAdvice.currentPeriodAction.thisPaydayDue) || [];
  ok((paid.bills || []).some(row => row.id === 'travel' && row.date === PAYDAY_AS_OF
      && near(row.movement, -SYNTHETIC_CARD_PAY)),
    'already paid this payday shows the extra card payment as money out');
  ok(!due.some(row => row.id === 'travel'),
    'covered Travel Visa min is not still due');
  ok(controlDue.some(row => row.id === 'travel'),
    'chequing TFR-TO C/C leaves the min still due');
  ok(due.some(row => row.id === 'tdfees') || controlDue.some(row => row.id === 'tdfees'),
    'TD fees are not invented away');
  filesUnchanged('extra payment onto mapped card');
}

function independentSeaspanCycle(asOf) {
  // Independent of Forecast.spendingCycle: 14-day steps from Friday 2026-08-14.
  const dayMs = 24 * 60 * 60 * 1000;
  const asOfMs = Date.parse(asOf + 'T00:00:00Z');
  let startMs = Date.parse('2026-08-14T00:00:00Z');
  while (startMs + 14 * dayMs <= asOfMs) startMs += 14 * dayMs;
  while (startMs > asOfMs) startMs -= 14 * dayMs;
  const nextMs = startMs + 14 * dayMs;
  const iso = ms => new Date(ms).toISOString().slice(0, 10);
  return { start: iso(startMs), end: iso(nextMs - dayMs), nextPayday: iso(nextMs) };
}

function activeCalendarPeriod(advice) {
  const view = advice && advice.defaultView;
  const periods = (view && view.calendarPeriods) || [];
  return periods.find(p => p && p.role === 'active') || null;
}

function serveFixtureOverlay(canonical, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-live-plan-asof-'));
  const fixture = path.join(dir, 'fixture.json');
  fs.writeFileSync(fixture, `${JSON.stringify(payloadFrom(canonical, extra), null, 2)}\n`);
  return Live.serveCanonicalOrFixture(canonical, {
    ATLAS_LIVE_OVERLAY: 'fixture',
    ATLAS_LIVE_OVERLAY_FIXTURE: fixture,
    ATLAS_LIVE_OVERLAY_MAP: MAP,
  });
}

function browserPlanComposer() {
  const appSrc = sourceText(fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8'));
  const planSrc = sourceText(fs.readFileSync(path.join(ROOT, 'public', 'plan.js'), 'utf8'));
  const grab = (src, re, label) => {
    const m = re.exec(src);
    if (!m) throw new Error('missing ' + label);
    return m[0];
  };
  return vm.runInNewContext([
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^const fmtMonth = .*$/m, 'fmtMonth'),
    grab(planSrc, /^const addDays = .*$/m, 'addDays'),
    grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function liveOperatingPlanNote\([\s\S]*?\n\}$/m, 'liveOperatingPlanNote'),
    grab(planSrc, /^function currentOperatingUnavailableHtml\([\s\S]*?\n\}$/m, 'currentOperatingUnavailableHtml'),
    grab(planSrc, /^function currentOperatingCashHeroTiles\([\s\S]*?\n\}$/m, 'currentOperatingCashHeroTiles'),
    grab(planSrc, /^function paydayActionRows\([\s\S]*?\n\}$/m, 'paydayActionRows'),
    grab(planSrc, /^function paydayOtherActionRows\([\s\S]*?\n\}$/m, 'paydayOtherActionRows'),
    grab(planSrc, /^function paydayReservedIds\([\s\S]*?\n\}$/m, 'paydayReservedIds'),
    grab(planSrc, /^function paydayComingRows\([\s\S]*?\n\}$/m, 'paydayComingRows'),
    grab(planSrc, /^function paydaySheet\([\s\S]*?\n\}$/m, 'paydaySheet'),
    grab(planSrc, /^function paydayCashNote\([\s\S]*?\n\}$/m, 'paydayCashNote'),
    grab(planSrc, /^function paydayObligationNote\([\s\S]*?\n\}$/m, 'paydayObligationNote'),
    grab(planSrc, /^function paydayCoverageNote\([\s\S]*?\n\}$/m, 'paydayCoverageNote'),
    grab(planSrc, /^function paydayBillStatusNote\([\s\S]*?\n\}$/m, 'paydayBillStatusNote'),
    grab(planSrc, /^function paydayAmountCell\([\s\S]*?\n\}$/m, 'paydayAmountCell'),
    grab(planSrc, /^function paydayAnswerHtml\([\s\S]*?\n\}$/m, 'paydayAnswerHtml'),
    '({ paydayAnswerHtml, currentOperatingCashHeroTiles })',
  ].join('\n'), { Forecast });
}

console.log('\n=== 20. same-day inbound fail-closed does not publish a stale cycle as current ===');
{
  const LIVE_FAILURE_AT = '2026-08-31T18:00:00.000Z';
  const LIVE_FAILURE_AS_OF = '2026-08-31';
  const openingAsOf = String(liveData.plan.opening.asOf);
  ok(openingAsOf === '2026-08-19',
    'canonical opening on this main is still 2026-08-19');
  const independentOpening = independentSeaspanCycle(openingAsOf);
  const independentLive = independentSeaspanCycle(LIVE_FAILURE_AS_OF);
  ok(independentOpening.start === '2026-08-14' && independentOpening.end === '2026-08-27'
      && independentOpening.nextPayday === '2026-08-28',
    'independent 14-day steps from Aug 14: as-of Aug 19 is Aug 14–27');
  ok(independentLive.start === '2026-08-28' && independentLive.end === '2026-09-10'
      && independentLive.nextPayday === '2026-09-11',
    'independent 14-day steps from Aug 14: as-of Aug 31 is Aug 28–Sep 10');
  const engineOpening = Forecast.spendingCycle(liveData.plan, openingAsOf);
  const engineLive = Forecast.spendingCycle(liveData.plan, LIVE_FAILURE_AS_OF);
  ok(engineOpening && engineOpening.start === independentOpening.start
      && engineOpening.end === independentOpening.end,
    'spendingCycle stays faithful to the Aug 19 as-of it is given');
  ok(engineLive && engineLive.start === independentLive.start
      && engineLive.end === independentLive.end,
    'spendingCycle for a trusted Aug 31 as-of is Aug 28–Sep 10');

  const extra = {
    fetchedAt: LIVE_FAILURE_AT,
    tweaks: {
      cashAt: '2026-08-31T17:55:00.000Z',
      cardAt: '2026-08-31T17:55:00.000Z',
      loanAt: '2026-08-31T17:55:00.000Z',
      triangleAt: '2026-08-31T17:55:00.000Z',
    },
  };
  const canonical = clone(liveData);
  let threw = null;
  try {
    overlay(canonical, extra);
  } catch (err) {
    threw = err;
  }
  ok(threw && /same-day-event-representation-unknown/.test(threw.message),
    'Aug 31 overlay fails closed without Amanda month-end posting evidence',
    threw && threw.message);
  ok(/amandaSalaryMonthEnd@2026-08-31/.test(threw && threw.message || ''),
    'unknown same-day inbound names amandaSalaryMonthEnd, not unposted bills',
    threw && threw.message);

  const served = serveFixtureOverlay(canonical, extra);
  ok(served.liveOverlay && served.liveOverlay.applied === false,
    'server overlay fail-closes rather than applying a mixed Aug 31 / Aug 19 state');
  ok(served.liveOverlay.operatingPlan === Live.OPERATING_PLAN_UNAVAILABLE,
    'fail-closed later observation marks the current operating plan unavailable');
  ok(/unavailable/.test(String(served.liveOverlay.operatingPlanNote || ''))
      && /stale/.test(String(served.liveOverlay.operatingPlanNote || '')),
    'fail-closed copy is explicit unavailable/stale');
  ok(String(served.meta.asOf) === openingAsOf
      && String(served.plan.opening.asOf) === openingAsOf,
    'fail-closed overlay does not advance the served opening');
  ok(served.liveOverlay.observedAsOf === LIVE_FAILURE_AS_OF,
    'observed as-of is the observation household date, not Date.now');

  const staleAdvice = Forecast.recommend(served.plan, served.meta.asOf, {
    debts: served.debts,
    revolvingExtra: served.revolvingExtra,
    targetBuffer: served.plan.defaults.targetBuffer,
    operatingPlan: served.liveOverlay.operatingPlan,
    operatingPlanNote: served.liveOverlay.operatingPlanNote,
  });
  const active = activeCalendarPeriod(staleAdvice);
  ok(active && active.operatingPlanUnavailable === true,
    'Forecast withholds the current operating plan rather than publishing the dated cycle');
  ok(active.spendingCycleLabel == null && active.spendingCycle == null,
    'Household Budget does not print Spending cycle: Aug 14–Aug 27 as current');
  ok(!/Aug 14/.test(String(active.operatingPlanNote || ''))
      && !/Aug 28/.test(String(active.operatingPlanNote || '')),
    'unavailable copy does not mix an Aug 31 cycle with an Aug 19 opening');
  ok(/unavailable/.test(String(active.operatingPlanNote || ''))
      && /stale/.test(String(active.operatingPlanNote || '')),
    'Forecast note is explicit unavailable/stale');
  ok(staleAdvice.operatingPlanUnavailable === true
      && staleAdvice.weekly == null
      && staleAdvice.currentPeriodAction
      && staleAdvice.currentPeriodAction.unavailable === true
      && staleAdvice.currentPeriodAction.remainingClaim === 'unavailable',
    'Forecast withholds weekly permission and current-period action while operatingPlan is unavailable');
  ok(!staleAdvice.paydayAllocation
      || staleAdvice.paydayAllocation.extraDebt == null
      || staleAdvice.paydayAllocation.extraDebt.status === 'unavailable'
      || staleAdvice.paydayAllocation.extraDebt.allocated == null,
    'Forecast withholds extra-debt instruction while operatingPlan is unavailable');
  ok(staleAdvice.funding == null,
    'Forecast does not publish opening-gap funding as a current claim while operatingPlan is unavailable');

  const operating = OA.fromRefreshedState(served, { mode: 'live-overlay' });
  ok(operating.provenance.operatingPlan === Live.OPERATING_PLAN_UNAVAILABLE,
    'operating-answer provenance records operatingPlan unavailable');
  ok(operating.moneyAvailable.value == null
      && operating.moneyAvailable.status === 'unavailable'
      && operating.currentSpendingPermission.weekly == null
      && operating.currentSpendingPermission.remainingClaim === 'unavailable'
      && operating.extraDebtAllocation.status === 'unavailable'
      && operating.extraDebtAllocation.allocated == null,
    'operating-answer does not copy money available, spend permission, or extra-debt as current from the stale opening');

  const packet = Assistant.buildPacket({
    data: served,
    periods: Assistant.loadPeriods(),
    questionsMarkdown: '',
    now: LIVE_FAILURE_AT,
    env: {},
  });
  ok(packet.current.spendableHouseholdCash.status !== 'ok'
      && packet.current.spendableHouseholdCash.current === false,
    'get_atlas_current does not publish dated opening cash as current');
  ok(packet.forecast.status === 'unavailable'
      && packet.forecast.recommendation.status === 'unavailable'
      && packet.forecast.currentPeriodAction.status === 'unavailable',
    'get_atlas_current does not emit a current recommendation or current-period action');
  ok(!/\d+\s*\/\s*week/.test(JSON.stringify(packet.forecast.recommendation))
      && packet.forecast.recommendation.weekly == null,
    'assistant forecast recommendation does not carry a weekly spend permission');

  const planSrc = sourceText(fs.readFileSync(path.join(ROOT, 'public', 'plan.js'), 'utf8'));
  const helperSrc = [
    /function liveOperatingPlanUnavailable\([\s\S]*?\n\}/.exec(planSrc),
    /function liveOperatingPlanNote\([\s\S]*?\n\}/.exec(planSrc),
    /function currentOperatingUnavailableHtml\([\s\S]*?\n\}/.exec(planSrc),
  ];
  ok(helperSrc.every(Boolean),
    'plan.js names the current-operating unavailable helper');
  const unavailableHtml = vm.runInNewContext(
    `${helperSrc.map(m => m[0]).join('\n')}\ncurrentOperatingUnavailableHtml;`,
    {}
  )(staleAdvice, served.liveOverlay);
  ok(/data-current-operating="unavailable"/.test(unavailableHtml)
      && /data-operating-plan="unavailable"/.test(unavailableHtml)
      && /unavailable/.test(unavailableHtml)
      && /stale/.test(unavailableHtml)
      && !/\$/.test(unavailableHtml),
    'browser operating helper emits unavailable/stale and no spend amount');
  const liveHtml = vm.runInNewContext(
    `${helperSrc.map(m => m[0]).join('\n')}\ncurrentOperatingUnavailableHtml;`,
    {}
  )({ weekly: 400 }, { operatingPlan: 'live' });
  ok(liveHtml == null, 'browser helper stays silent when the operating plan is live');
  const browser = browserPlanComposer();
  const paydayHtml = browser.paydayAnswerHtml({
    plan: served.plan,
    asOf: served.meta.asOf,
    advice: staleAdvice,
    recommended: staleAdvice.weekly,
    weekly: staleAdvice.weekly,
    liveOverlay: served.liveOverlay,
  });
  ok(/data-current-operating="unavailable"/.test(paydayHtml)
      && /data-operating-plan="unavailable"/.test(paydayHtml)
      && /unavailable/.test(paydayHtml)
      && /stale/.test(paydayHtml)
      && !/\$/.test(paydayHtml),
    'paydayAnswerHtml fail-closes the current payday answer on the Aug 31 unavailable fixture');
  ok(!/Money available/.test(paydayHtml)
      && !/What to do with this paycheque/.test(paydayHtml)
      && !/Bills \/ required payments/.test(paydayHtml)
      && !/Coming before next payday/.test(paydayHtml)
      && !/Funding risks/.test(paydayHtml)
      && !/payday-hero/.test(paydayHtml),
    'unavailable paydayAnswerHtml does not emit current Money available, paycheque action, or other current action from the Aug 19 opening');
  const heroTiles = browser.currentOperatingCashHeroTiles(
    served.plan,
    served.meta.asOf,
    staleAdvice.sim || { events: [] },
    staleAdvice,
    served.liveOverlay
  );
  const spendableTile = heroTiles.find(t => t.lab === 'Spendable household cash');
  const cashOutTile = heroTiles.find(t => t.lab === 'Next cash-out total');
  ok(spendableTile && spendableTile.val === 'unavailable' && !/\$/.test(String(spendableTile.val)),
    'Plan hero tile does not publish numeric current Spendable household cash while unavailable');
  ok(cashOutTile && cashOutTile.val === 'unavailable' && !/\$/.test(String(cashOutTile.val)),
    'Plan hero tile does not publish numeric current Next cash-out total while unavailable');
  const renderFn = /function renderPlan\([\s\S]*?\n\}/.exec(planSrc);
  const paydayFn = /function paydayAnswerHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(renderFn && /currentOperatingCashHeroTiles\(/.test(renderFn[0]),
    'renderPlan prints currentOperatingCashHeroTiles rather than a parallel current-cash path');
  ok(paydayFn && /currentOperatingUnavailableHtml\(/.test(paydayFn[0])
      && /liveOperatingPlanUnavailable\(/.test(paydayFn[0]),
    'paydayAnswerHtml withholds the current payday block while operatingPlan is unavailable');
  const surfaceFn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(surfaceFn && /currentOperatingUnavailableHtml/.test(surfaceFn[0])
      && /data-today-decision="unavailable"/.test(surfaceFn[0]),
    'operatingSurfaceHtml fail-closes spend permission, extra-debt, and today-action while operatingPlan is unavailable');
  const extraFn = /function extraRepaymentHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(extraFn && /operatingPlanUnavailable/.test(extraFn[0])
      && /data-operating-plan="unavailable"/.test(extraFn[0]),
    'calendar extra-debt instruction fail-closes on the active unavailable period');
  const mixed = Forecast.recommend(served.plan, served.meta.asOf, {
    debts: served.debts,
    revolvingExtra: served.revolvingExtra,
    targetBuffer: served.plan.defaults.targetBuffer,
  });
  const mixedActive = activeCalendarPeriod(mixed);
  ok(mixedActive && mixedActive.spendingCycle && mixedActive.spendingCycle.start === '2026-08-14',
    'without the overlay flag, Aug 19 as-of still computes Aug 14–27 (cycle math unchanged)');

  const trusted = clone(liveData);
  trusted.plan = Object.assign({}, trusted.plan, {
    income: (trusted.plan.income || []).map(row => {
      if (!row || row.id !== 'amandaSalaryMonthEnd') return row;
      return Object.assign({}, row, { firstDue: '2026-09-30' });
    }),
  });
  const trustedServed = serveFixtureOverlay(trusted, extra);
  ok(trustedServed.liveOverlay && trustedServed.liveOverlay.applied === true,
    'unposted same-day joint-cash bills do not fail the overlay when inbound is not in-window');
  ok(trustedServed.liveOverlay.operatingPlan === Live.OPERATING_PLAN_LIVE,
    'independently trusted current opening applies as live');
  ok(String(trustedServed.plan.opening.asOf) === LIVE_FAILURE_AS_OF
      && String(trustedServed.meta.asOf) === LIVE_FAILURE_AS_OF,
    'trusted overlay advances as-of with the opening, not a mixed state');
  const trustedAdvice = Forecast.recommend(trustedServed.plan, trustedServed.meta.asOf, {
    debts: trustedServed.debts,
    revolvingExtra: trustedServed.revolvingExtra,
    targetBuffer: trustedServed.plan.defaults.targetBuffer,
    operatingPlan: trustedServed.liveOverlay.operatingPlan,
    operatingPlanNote: trustedServed.liveOverlay.operatingPlanNote,
  });
  const trustedActive = activeCalendarPeriod(trustedAdvice);
  ok(trustedActive && trustedActive.spendingCycle
      && trustedActive.spendingCycle.start === independentLive.start
      && trustedActive.spendingCycle.end === independentLive.end
      && trustedActive.spendingCycleLabel === engineLive.label
      && trustedActive.operatingPlanUnavailable !== true,
    'trusted Aug 31 as-of publishes Household Budget Aug 28–Sep 10');
  ok(trustedAdvice.operatingPlanUnavailable !== true
      && trustedAdvice.weekly != null
      && !(trustedAdvice.currentPeriodAction && trustedAdvice.currentPeriodAction.unavailable),
    'trusted control still publishes weekly permission and current-period action');
  const trustedOperating = OA.fromRefreshedState(trustedServed, { mode: 'live-overlay' });
  ok(trustedOperating.currentSpendingPermission.weekly != null
      && trustedOperating.moneyAvailable.value != null
      && trustedOperating.extraDebtAllocation.status !== 'unavailable',
    'trusted operating-answer still publishes current money available and spend permission');
  const trustedPacket = Assistant.buildPacket({
    data: trustedServed,
    periods: Assistant.loadPeriods(),
    questionsMarkdown: '',
    now: LIVE_FAILURE_AT,
    env: {},
  });
  ok(trustedPacket.forecast.status === 'ok'
      && trustedPacket.forecast.recommendation.weekly != null
      && trustedPacket.forecast.currentPeriodAction.status === 'ok'
      && trustedPacket.current.spendableHouseholdCash.status === 'ok',
    'trusted get_atlas_current still publishes current cash, recommendation, and current-period action');
  const trustedPayday = browser.paydayAnswerHtml({
    plan: trustedServed.plan,
    asOf: trustedServed.meta.asOf,
    advice: trustedAdvice,
    recommended: trustedAdvice.weekly,
    weekly: trustedAdvice.weekly,
    liveOverlay: trustedServed.liveOverlay,
  });
  ok(!/data-current-operating="unavailable"/.test(trustedPayday)
      && /\$/.test(trustedPayday)
      && (/What to do now/.test(trustedPayday)
          || /Money available/.test(trustedPayday))
      && /Household spending permission/.test(trustedPayday)
      && /payday-hero/.test(trustedPayday),
    'trusted control paydayAnswerHtml still publishes a current operating answer');
  const trustedHero = browser.currentOperatingCashHeroTiles(
    trustedServed.plan,
    trustedServed.meta.asOf,
    trustedAdvice.sim,
    trustedAdvice,
    trustedServed.liveOverlay
  );
  const trustedCash = trustedHero.find(t => t.lab === 'Spendable household cash');
  const trustedOut = trustedHero.find(t => t.lab === 'Next cash-out total');
  ok(trustedCash && trustedCash.val !== 'unavailable' && /\$/.test(String(trustedCash.val)),
    'trusted control still publishes numeric Spendable household cash');
  ok(!trustedOut || (trustedOut.val !== 'unavailable' && /\$/.test(String(trustedOut.val))),
    'trusted control still publishes numeric Next cash-out total when a cash-out exists');

  const budgetFn = /function calendarBudgetHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(budgetFn && /operatingPlanUnavailable/.test(budgetFn[0])
      && /data-operating-plan="unavailable"/.test(budgetFn[0])
      && !/Date\.now/.test(budgetFn[0]),
    'plan.js prints Forecast operatingPlanUnavailable; it does not invent a cycle or wall-clock as-of');
  const fromFn = /function operatingPlanFromOverlay\([\s\S]*?\n\}/.exec(
    fs.readFileSync(path.join(ROOT, 'scripts', 'live-plan.js'), 'utf8'));
  ok(fromFn && /liveAsOf > historicalOpeningAsOf/.test(fromFn[0]) && !/Date\.now/.test(fromFn[0]),
    'operatingPlan unavailable is later observed as-of vs dated opening, not wall-clock');
  filesUnchanged('same-day inbound fail-closed stale cycle');
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} live-plan check(s)`);
  process.exit(1);
}
console.log('ALL LIVE-PLAN OVERLAY CHECKS PASSED');
