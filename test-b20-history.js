'use strict';
/* B20 / AF-HIST-01 — truthful account-balance history as a by-product of
 * successful refresh. M3: independent provenance, not a second call of the
 * writer asserting its own output.
 *
 * Live cents appear only in the reconciliation of the committed openings.
 * Writer behaviour is proved on fixtures.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const live = require('./data.json');
const map = require('./docs/reconciliation/balance-map.json');
const periods = require('./public/periods.json');
const S = require('./scripts/snapshot-balances.js');
const History = require('./public/balance-history.js');
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const parseCsv = text => S.parsePositions(text);

function gitShow(spec) {
  try {
    return execFileSync('git', ['show', spec], { encoding: 'utf8' });
  } catch (err) {
    const detail = err && err.message ? err.message : String(err);
    throw new Error(
      `B20 independent proof needs git history for ${spec} `
      + `(CI checkout must use fetch-depth: 0). ${detail}`
    );
  }
}

const AUG9 = '2026-08-09';
const AUG16 = '2026-08-16';
const MIXED = '08fd3e1';
const AUG9_REV = '81210ac';

const AUG9_INDEPENDENT = {
  'chequing-a': 506.98,
  'chequing-b': -517.72,
  savings: 90.58,
  'amanda-debt-payments': 2691.85,
  'savings-dont-touch': 74.2,
  mortgage: 546026.58,
  heloc: 201586.16,
  triangle: 13497,
  cashback: 5612.43,
  mbna: 7855.12,
  tdcc: 1799.97,
  travelvisa: 1078.31,
};
const AUG16_INDEPENDENT = {
  'chequing-a': 1320.13,
  'chequing-b': 932.05,
  savings: 0.58,
  mortgage: 545188.30,
  heloc: 200486.16,
  triangle: 13197,
  cashback: 4799.43,
  mbna: 8003.61,
  tdcc: 1705.94,
  travelvisa: 862.68,
};

const snap9 = JSON.parse(read('snapshots/2026-08-09.json'));
const snap16 = JSON.parse(read('snapshots/2026-08-16.json'));
const positionsNow = parseCsv(read('docs/positions.csv'));
const history = S.loadHistory(path.join(__dirname, 'snapshots'));

function acc(snap, id) {
  return (snap.accounts || []).find(a => a.id === id) || null;
}

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function fixtureData(asOf, cash, debts) {
  const data = {
    meta: { asOf },
    plan: {
      opening: { asOf },
      startingCash: {
        breakdown: cash.filter(r => r.pot !== 'held-elsewhere'),
        heldElsewhere: cash.filter(r => r.pot === 'held-elsewhere'),
      },
    },
    debts,
  };
  return data;
}

function fixturePositions(rows) {
  const header = 'entity,institution,account_label,account_type,side,currency,balance,credit_limit,available,interest_rate_pct,rate_basis,fixed_or_variable,structure,payment_amount,payment_frequency,next_due_date,maturity_or_renewal,annual_interest_cost,confidence,as_of,notes';
  const lines = [header];
  for (const r of rows) {
    lines.push([
      'Household', 'TD', r.label, r.type || 'Chequing', r.side || 'Asset', r.currency || 'CAD',
      Number(r.balance).toFixed(2), '', '', '', '', '', '', '', '', '', '', '',
      r.confidence || 'VERIFIED_TD', r.asOf, '',
    ].join(','));
  }
  return lines.join('\n') + '\n';
}

function writeFixturePair(dir, data, positionsText) {
  const dataPath = path.join(dir, 'data.json');
  const posPath = path.join(dir, 'positions.csv');
  fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
  fs.writeFileSync(posPath, positionsText);
  return { dataPath, posPath };
}

console.log('=== 1. 2026-08-16 snapshot agrees with canonical data.json ===');
{
  ok(snap16.asOf === AUG16, 'committed Aug. 16 snapshot is dated 2026-08-16');
  ok(live.meta.asOf === AUG16 && live.plan.opening.asOf === AUG16,
    'live data.json as-of is still 2026-08-16');
  for (const [id, amount] of Object.entries(AUG16_INDEPENDENT)) {
    const row = acc(snap16, id);
    ok(!!row, `${id} is in the Aug. 16 snapshot`);
    if (!row) continue;
    const canonical = id === 'chequing-a' || id === 'chequing-b' || id === 'savings'
      ? live.plan.startingCash.breakdown.find(r => r.id === id)
      : live.debts.find(r => r.id === id);
    const canonicalAmt = canonical && (canonical.value != null ? canonical.value : canonical.balance);
    ok(near(row.balance, amount) && near(row.balance, canonicalAmt),
      `${id} snapshot ${money(row.balance)} matches data.json and independent ${money(amount)}`);
    const pos = positionsNow.find(p => p.account_label === map.mappings.find(m => m.canonical.id === id).accountLabel);
    ok(pos && pos.as_of === AUG16 && near(Number(pos.balance), amount),
      `${id} contemporaneous positions.csv ${pos && pos.as_of} ${pos && pos.balance}`);
  }
  ok(!acc(snap16, 'amanda-debt-payments'),
    'Aug. 16 snapshot omits the 2026-08-09 TENNIS INCOME reading');
  ok(!acc(snap16, 'savings-dont-touch'),
    'Aug. 16 snapshot omits the 2026-08-09 SAVINGS-DONT TOUCH reading');
}

console.log('\n=== 2. account identity is stable across readings ===');
{
  const ids9 = new Set(snap9.accounts.map(a => a.id));
  const ids16 = new Set(snap16.accounts.map(a => a.id));
  for (const id of Object.keys(AUG16_INDEPENDENT)) {
    ok(ids9.has(id) && ids16.has(id), `${id} keeps the same id on both openings`);
    const a = acc(snap9, id);
    const b = acc(snap16, id);
    ok(a.collection === b.collection && a.side === b.side && a.currency === b.currency,
      `${id} keeps collection/side/currency`);
  }
}

console.log('\n=== 3. each historical balance has an independently defensible date and amount ===');
{
  ok(snap9.asOf === AUG9, 'committed Aug. 9 snapshot is dated 2026-08-09');
  const histData = JSON.parse(gitShow(`${AUG9_REV}:data.json`));
  const histPos = parseCsv(gitShow(`${AUG9_REV}:docs/positions.csv`));
  ok(histData.meta.asOf === AUG9, '81210ac data.json as-of is 2026-08-09');
  for (const [id, amount] of Object.entries(AUG9_INDEPENDENT)) {
    const row = acc(snap9, id);
    ok(!!row && near(row.balance, amount),
      `${id} Aug. 9 snapshot is independently ${money(amount)}`,
      row ? money(row.balance) : 'missing');
    const mapping = map.mappings.find(m => m.canonical.id === id);
    const pos = histPos.find(p => p.account_label === mapping.accountLabel);
    ok(pos && pos.as_of === AUG9 && near(Number(pos.balance), amount),
      `${id} 81210ac positions.csv is ${money(amount)} on 2026-08-09`);
    if (id === 'chequing-a' || id === 'chequing-b' || id === 'savings'
      || id === 'amanda-debt-payments' || id === 'savings-dont-touch') {
      const cash = (histData.plan.startingCash.breakdown || [])
        .concat(histData.plan.startingCash.heldElsewhere || [])
        .find(r => r.id === id);
      ok(cash && near(cash.value, amount), `${id} 81210ac data.json cash is ${money(amount)}`);
    } else {
      const debt = histData.debts.find(r => r.id === id);
      ok(debt && near(debt.balance, amount), `${id} 81210ac data.json debt is ${money(amount)}`);
    }
  }
  ok(near(201586.16 - 1100, 200486.16),
    'independent HELOC identity: 201586.16 − 1100.00 = 200486.16');
  ok(near(546026.58 - 545188.30, 838.28),
    'independent mortgage identity: 546026.58 − 545188.30 = 838.28');
  ok(near(1799.97 - 94.03, 1705.94),
    'independent TD card identity: 1799.97 − 94.03 = 1705.94');
  ok(near(5612.43 - 50 - 763, 4799.43),
    'independent Cash Back identity: 5612.43 − 50.00 − 763.00 = 4799.43');
  ok(near(13497 - 300, 13197),
    'independent Triangle identity: 13497.00 − 300.00 = 13197.00');
}

console.log('\n=== 4. mixed-date source rows cannot become one dated snapshot ===');
{
  const dir = tmpDir('atlas-b20-mixed-');
  const data = fixtureData(AUG16, [
    { id: 'chequing-a', label: 'Chequing A', value: 100, pot: 'spendable' },
    { id: 'chequing-b', label: 'Chequing B', value: 200, pot: 'spendable' },
  ], [
    { id: 'heloc', label: 'HELOC', balance: 1000, pending: 0, confidence: 'verified' },
  ]);
  const positions = fixturePositions([
    { label: 'Chequing A', balance: 100, asOf: AUG16, side: 'Asset' },
    { label: 'Chequing B', balance: 200, asOf: AUG9, side: 'Asset' },
    { label: 'HELOC', balance: 1000, asOf: AUG16, side: 'Liability', type: 'Home equity line' },
  ]);
  const built = S.buildSnapshot(data, S.parsePositions(positions), map);
  ok(built.asOf === AUG16, 'fixture snapshot keeps the canonical as-of');
  ok(!!acc(built, 'chequing-a') && !!acc(built, 'heloc'),
    'same-date rows are included');
  ok(!acc(built, 'chequing-b'),
    'a 2026-08-09 row is not copied into the 2026-08-16 snapshot');
  ok(built.omitted.some(o => o.id === 'chequing-b' && o.reason === 'different-as-of'),
    'the mixed-date omission is explicit');

  const mixed = S.buildSnapshot(
    JSON.parse(gitShow(`${MIXED}:data.json`)),
    parseCsv(gitShow(`${MIXED}:docs/positions.csv`)),
    JSON.parse(gitShow(`${MIXED}:docs/reconciliation/balance-map.json`))
  );
  ok(mixed.asOf === AUG9, '08fd3e1 still publishes as-of 2026-08-09');
  ok(!acc(mixed, 'triangle') && !acc(mixed, 'mbna'),
    '08fd3e1 Triangle/MBNA 2026-08-16 rows are not a 2026-08-09 snapshot');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n=== 5. re-running the same reading produces no duplicate or mutation ===');
{
  const dir = tmpDir('atlas-b20-idem-');
  const first = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts', 'snapshot-balances.js'),
    '--out', dir,
  ], { encoding: 'utf8' });
  const dest = path.join(dir, '2026-08-16.json');
  const bytes1 = fs.readFileSync(dest);
  const second = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts', 'snapshot-balances.js'),
    '--out', dir,
  ], { encoding: 'utf8' });
  const bytes2 = fs.readFileSync(dest);
  ok(/written 2026-08-16/.test(first), 'first run writes the dated file', first.trim());
  ok(/unchanged 2026-08-16/.test(second), 'second run is unchanged', second.trim());
  ok(bytes1.equals(bytes2), 'file bytes are identical');
  ok(fs.readdirSync(dir).filter(f => f.endsWith('.json')).length === 1,
    'no duplicate file was created');
  fs.rmSync(dir, { recursive: true, force: true });

  const again = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts', 'snapshot-balances.js'),
  ], { encoding: 'utf8' });
  ok(/unchanged 2026-08-16/.test(again),
    're-running against the committed snapshots/ directory is a no-op', again.trim());
}

console.log('\n=== 6–7. data.json remains current-state authority; history is not rewritten ===');
{
  const dir = tmpDir('atlas-b20-auth-');
  execFileSync(process.execPath, [
    path.join(__dirname, 'scripts', 'snapshot-balances.js'), '--out', dir,
  ]);
  const original = fs.readFileSync(path.join(dir, '2026-08-16.json'));
  const mutated = JSON.parse(JSON.stringify(live));
  const heloc = mutated.debts.find(d => d.id === 'heloc');
  heloc.balance = heloc.balance + 50;
  const dataPath = path.join(dir, 'mutated-data.json');
  fs.writeFileSync(dataPath, JSON.stringify(mutated, null, 2));
  let disagreed = false;
  try {
    S.run(['--data', dataPath, '--out', dir]);
  } catch (err) {
    disagreed = /disagrees/.test(err.message);
  }
  ok(disagreed, 'a mutated data.json that no longer matches positions.csv fails closed');

  const agreed = JSON.parse(JSON.stringify(live));
  agreed.debts.find(d => d.id === 'heloc').balance = 200536.16;
  const posMut = read('docs/positions.csv').replace('200486.16', '200536.16');
  const agreedData = path.join(dir, 'agreed-data.json');
  const agreedPos = path.join(dir, 'agreed-positions.csv');
  fs.writeFileSync(agreedData, JSON.stringify(agreed, null, 2));
  fs.writeFileSync(agreedPos, posMut);
  let conflicted = false;
  try {
    S.run(['--data', agreedData, '--positions', agreedPos, '--out', dir]);
  } catch (err) {
    conflicted = err.code === 'SNAPSHOT_CONFLICT'
      || /refusing to rewrite/.test(err.message);
  }
  ok(conflicted, 'an internally consistent new reading still does not rewrite an existing dated file');
  ok(fs.readFileSync(path.join(dir, '2026-08-16.json')).equals(original),
    'the existing 2026-08-16 file bytes are unchanged after the conflict');
  ok(near(live.debts.find(d => d.id === 'heloc').balance, 200486.16),
    'live data.json HELOC is still the current 2026-08-16 opening');
  ok(near(F.startingCashAmount(live.plan), 1320.13 + 932.05 + 0.58),
    'Forecast still opens from data.json spendable cash, not from snapshots');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n=== 8. snapshots are not an input to Forecast current-state decisions ===');
{
  const forecastSrc = read('public/forecast.js');
  ok(!/snapshots\//.test(forecastSrc) && !/balance-history/.test(forecastSrc),
    'Forecast source does not mention snapshots/ or balance-history');
  ok(!/require\(['"]\.\/scripts\/snapshot-balances/.test(forecastSrc),
    'Forecast does not load the snapshot writer');
  const before = F.startingCashAmount(live.plan);
  const rec = F.recommend(live.plan, live.plan.opening.asOf, {
    scenario: 'expected',
    targetBuffer: live.plan.defaults.targetBuffer,
    debts: live.debts,
    extraFacilities: live.revolvingExtra,
    extraDebtTarget: live.plan.nextDollar && live.plan.nextDollar.target,
  });
  ok(near(F.startingCashAmount(live.plan), before),
    'running recommend does not change starting cash');
  ok(rec && rec.weekly != null, 'Forecast still recommends from the live plan');
}

console.log('\n=== 9. credit remains debt/capacity, never cash ===');
{
  for (const id of ['heloc', 'triangle', 'cashback', 'mbna', 'tdcc', 'travelvisa']) {
    ok(acc(snap16, id).side === 'liability' && acc(snap16, id).collection === 'debts',
      `${id} is a liability debt in the Aug. 16 snapshot`);
  }
  const spendable = History.spendableSeries(history);
  const last = spendable[spendable.length - 1];
  ok(last && last.ids.every(id => ['chequing-a', 'chequing-b', 'savings'].includes(id)),
    'spendable display sum uses only the three household cash accounts');
  ok(!last.ids.includes('heloc') && !last.ids.includes('triangle'),
    'no credit facility is inside the spendable sum');
  const html = History.render(history);
  ok(/Liability/.test(html) && /HELOC/.test(html),
    'the page names HELOC as a liability');
}

console.log('\n=== 10. asset and liability direction is rendered correctly ===');
{
  const helocDelta = roundIndependent(AUG16_INDEPENDENT.heloc - AUG9_INDEPENDENT.heloc);
  const cashADelta = roundIndependent(AUG16_INDEPENDENT['chequing-a'] - AUG9_INDEPENDENT['chequing-a']);
  const mbnaDelta = roundIndependent(AUG16_INDEPENDENT.mbna - AUG9_INDEPENDENT.mbna);
  ok(helocDelta < 0, 'independent HELOC movement is a fall', money(helocDelta));
  ok(cashADelta > 0, 'independent Chequing A movement is a rise', money(cashADelta));
  ok(mbnaDelta > 0, 'independent MBNA movement is a rise', money(mbnaDelta));

  const helocMove = History.displayMove(History.seriesFor(history, 'heloc'));
  const cashMove = History.displayMove(History.seriesFor(history, 'chequing-a'));
  const mbnaMove = History.displayMove(History.seriesFor(history, 'mbna'));
  ok(near(helocMove.delta, helocDelta) && helocMove.direction === 'down',
    'display HELOC direction is down by the independent delta');
  ok(near(cashMove.delta, cashADelta) && cashMove.direction === 'up',
    'display Chequing A direction is up by the independent delta');
  ok(near(mbnaMove.delta, mbnaDelta) && mbnaMove.direction === 'up',
    'display MBNA direction is up — a larger card balance is not called a fall');

  const helocWord = History.movementWord(helocMove, 'HELOC');
  const mbnaWord = History.movementWord(mbnaMove, 'MBNA');
  ok(/fell/.test(helocWord) && !/rose/.test(helocWord),
    'HELOC wording says the balance fell');
  ok(/rose/.test(mbnaWord) && !/fell/.test(mbnaWord),
    'MBNA wording says the balance rose, not that it improved');
  ok(!/improv/i.test(helocWord + mbnaWord) && !/better/i.test(helocWord + mbnaWord),
    'wording does not moralize the household');
}

function roundIndependent(n) {
  return Math.round(Number(n) * 100) / 100;
}

console.log('\n=== 11. missing historical observations stay missing ===');
{
  const amanda = History.seriesFor(history, 'amanda-debt-payments');
  const move = History.displayMove(amanda);
  ok(amanda.length === 1 && amanda[0].asOf === AUG9,
    'TENNIS INCOME has only the 2026-08-09 opening');
  ok(move.sufficient === false && move.prior == null,
    'one point is not turned into a trend');
  const html = History.render(history);
  ok(/Not enough history yet for a trend/.test(html),
    'the page says trend history is not yet sufficient');
  ok(!History.seriesFor(history, 'wise').length,
    'Wise is not invented — it is not in the closed B91 map');
}

console.log('\n=== 12. public/periods.json remains the spending/interest/fee history ===');
{
  ok(Array.isArray(periods.monthly) && periods.monthly.length > 0,
    'periods.json still has a monthly spending series');
  const snapBlob = JSON.stringify(snap9) + JSON.stringify(snap16);
  ok(!/"monthly"/.test(snapBlob) && !/periods\.json/.test(snapBlob),
    'balance snapshots do not carry the spending series');
  ok(!/function rollupSpending/.test(read('scripts/snapshot-balances.js')),
    'the snapshot writer does not re-derive spending');
  ok(read('ARCHITECTURE.md').includes('generated `public/periods.json`'),
    'spending-history authority is still named on periods.json');
}

console.log('\n=== 13. household-facing trend agrees with the underlying snapshot balances ===');
{
  const expectedHeloc = roundIndependent(AUG16_INDEPENDENT.heloc - AUG9_INDEPENDENT.heloc);
  const expectedCash = roundIndependent(
    (1320.13 + 932.05 + 0.58) - (506.98 + -517.72 + 90.58)
  );
  ok(near(expectedHeloc, -1100), 'independent HELOC delta is −$1,100.00');
  ok(near(506.98 + -517.72 + 90.58, 79.84),
    'independent Aug. 9 spendable cash is $79.84');
  ok(near(1320.13 + 932.05 + 0.58, 2252.76),
    'independent Aug. 16 spendable cash is $2,252.76');
  ok(near(expectedCash, 2172.92), 'independent spendable delta is +$2,172.92');

  const html = History.render(history);
  ok(html.includes(History.money2(200486.16)) && html.includes(History.money2(201586.16)),
    'render shows both independently known HELOC openings');
  ok(html.includes(History.signedMoney(expectedHeloc)),
    'render shows the independently computed HELOC delta');
  ok(html.includes(History.money2(2252.76)) && html.includes(History.money2(79.84)),
    'render shows both independently known spendable totals');
  ok(html.includes(History.signedMoney(expectedCash)),
    'render shows the independently computed spendable delta');
}

console.log('\n=== 14. no second reconciliation or current-state calculation in the page layer ===');
{
  const page = read('public/balance-history.js') + '\n' + read('public/plan.js');
  ok(!/reconcile\.js/.test(page) && !/buildSnapshot/.test(page),
    'Plan / display layer does not run the snapshot writer or reconciler');
  ok(!/Forecast\.recommend/.test(read('public/balance-history.js')),
    'display assembly does not call Forecast.recommend');
  ok(!/startingCashAmount/.test(read('public/balance-history.js')),
    'display assembly does not re-open current cash from Forecast');
}

console.log('\n=== 15. snapshots stay a financial-state subset, not a policy copy ===');
{
  for (const doc of [snap9, snap16]) {
    ok(doc.schema === 'atlas-balance-snapshot/v1', `${doc.asOf} uses the snapshot schema`);
    ok(doc.role === 'historical-observation', `${doc.asOf} is marked historical`);
    ok(doc.currentStateAuthority === 'data.json', `${doc.asOf} names data.json as current-state`);
    ok(!doc.plan && !doc.actions && !doc.nextDollar && !doc.budget && !doc.helocHistory,
      `${doc.asOf} does not copy plan policy or helocHistory`);
    ok(!JSON.stringify(doc).includes('SITE_PASSWORD'),
      `${doc.asOf} contains no secret material`);
    for (const a of doc.accounts) {
      ok(a.provenance && a.provenance.canonicalLocator && a.provenance.sourceAsOf === doc.asOf,
        `${doc.asOf} ${a.id} provenance is the same dated reading`);
    }
  }
}

console.log('\n=== 16. incomplete spendable snapshots cannot publish a complete household total ===');
{
  const cash = (id, label, balance) => ({
    id, label, collection: 'cash', pot: 'spendable', side: 'asset', balance,
  });
  const onlyA = {
    snapshots: [{
      asOf: AUG16,
      accounts: [cash('chequing-a', 'Chequing A', 999.00)],
    }],
  };
  const seriesOnlyA = History.spendableSeries(onlyA);
  ok(seriesOnlyA.length === 0,
    'Chequing A alone is withheld from the spendable-household-cash series');
  ok(!History.accountRows(onlyA).some(r => r.id === 'spendable-cash'),
    'account rows do not invent a complete spendable total from one cash account');
  const htmlOnlyA = History.render(onlyA);
  ok(!/Spendable household cash/.test(htmlOnlyA),
    'the page does not label Chequing A as Spendable household cash');
  ok(htmlOnlyA.includes(History.money2(999)),
    'the missing-account fixture still shows Chequing A as its own opening');

  const mixedCompleteness = {
    snapshots: [
      {
        asOf: AUG9,
        accounts: [
          cash('chequing-a', 'Chequing A', 100),
          cash('chequing-b', 'Chequing B', 200),
          cash('savings', 'Savings', 50),
        ],
      },
      {
        asOf: AUG16,
        accounts: [cash('chequing-a', 'Chequing A', 999.00)],
      },
    ],
  };
  const series = History.spendableSeries(mixedCompleteness);
  ok(series.length === 1 && series[0].asOf === AUG9 && near(series[0].balance, 350),
    'only the complete three-account opening is a household spendable total');
  ok(!series.some(p => near(p.balance, 999)),
    'the incomplete 2026-08-16 Chequing A reading is not a complete total');
  const agg = History.accountRows(mixedCompleteness).find(r => r.id === 'spendable-cash');
  ok(agg && agg.move.current && agg.move.current.asOf === AUG9 && near(agg.move.current.balance, 350),
    'latest published household cash is the complete opening, not $999');
  ok(agg.move.sufficient === false,
    'an incomplete later snapshot does not create a two-point household-cash trend');
  const htmlMixed = History.render(mixedCompleteness);
  ok(!htmlMixed.includes(History.signedMoney(649)),
    'page does not publish 999 − 350 as the spendable household movement');

  const liveSpendable = History.spendableSeries(history);
  ok(liveSpendable.length === 2 && liveSpendable.every(p => p.complete === true),
    'committed openings still have the complete Chequing A / B / Savings set');
  ok(liveSpendable.every(p => ['chequing-a', 'chequing-b', 'savings'].every(id => p.ids.includes(id))),
    'live spendable totals include all three expected identities');
}

console.log('\n=== 17. revolving history discloses pending and fails closed when pending is unknown ===');
{
  const travelPosted9 = AUG9_INDEPENDENT.travelvisa;
  const travelPosted16 = AUG16_INDEPENDENT.travelvisa;
  const travelPending9 = 165.13;
  const travelPending16 = 250;
  const travelExposure9 = roundIndependent(travelPosted9 + travelPending9);
  const travelExposure16 = roundIndependent(travelPosted16 + travelPending16);
  ok(near(travelExposure9, 1243.44) && near(travelExposure16, 1112.68),
    'independent Travel Visa exposure is posted plus known pending');

  const travelMove = History.displayMove(History.seriesFor(history, 'travelvisa'));
  ok(near(travelMove.current.balance, travelPosted16) && near(travelMove.current.pending, travelPending16),
    'Travel Visa series keeps posted $862.68 and pending $250.00');
  ok(near(travelMove.currentExposure, travelExposure16) && near(travelMove.priorExposure, travelExposure9),
    'Travel Visa exposure uses posted plus pending on both openings');
  ok(travelMove.exposureSufficient === true && travelMove.sufficient === true,
    'known pending is enough for a complete Travel Visa debt trend');
  ok(near(travelMove.exposureDelta, roundIndependent(travelExposure16 - travelExposure9)),
    'Travel Visa exposure fell independently by posted-plus-pending');

  const mbnaPosted9 = AUG9_INDEPENDENT.mbna;
  const mbnaPosted16 = AUG16_INDEPENDENT.mbna;
  const mbnaPending9 = 82.05;
  const mbnaPending16 = 0;
  const mbnaExposure9 = roundIndependent(mbnaPosted9 + mbnaPending9);
  const mbnaExposure16 = roundIndependent(mbnaPosted16 + mbnaPending16);
  ok(near(mbnaExposure9, 7937.17) && near(mbnaExposure16, 8003.61),
    'independent MBNA exposure is $7,937.17 → $8,003.61');
  ok(near(roundIndependent(mbnaPosted16 - mbnaPosted9), 148.49),
    'independent MBNA posted movement is +$148.49');
  ok(near(roundIndependent(mbnaExposure16 - mbnaExposure9), 66.44),
    'independent MBNA exposure movement is +$66.44');

  const mbnaMove = History.displayMove(History.seriesFor(history, 'mbna'));
  ok(near(mbnaMove.postedDelta, 148.49) && mbnaMove.postedDirection === 'up',
    'posted MBNA series still records the +$148.49 posted rise');
  ok(near(mbnaMove.exposureDelta, 66.44) && mbnaMove.exposureDirection === 'up',
    'household-facing MBNA trend is the +$66.44 exposure rise');
  const mbnaWord = History.movementWord(mbnaMove, 'MBNA');
  ok(/posted-plus-pending exposure/.test(mbnaWord) && /rose/.test(mbnaWord),
    'MBNA wording names exposure, not posted-only movement');
  ok(mbnaWord.includes(History.money2(66.44)),
    'MBNA wording uses the independent exposure delta, not +$148.49');

  const cashMove = History.displayMove(History.seriesFor(history, 'cashback'));
  ok(cashMove.current && cashMove.current.pendingUnknown === true,
    'Cash Back current opening still carries Q26 pendingUnknown');
  ok(cashMove.pendingUnknown === true && cashMove.sufficient === false
    && cashMove.exposureSufficient === false,
    'unknown pending fails closed — Cash Back has no complete debt trend');
  const cashWord = History.movementWord(cashMove, 'Cash Back');
  ok(/pending is unknown/.test(cashWord) && !/fell/.test(cashWord) && !/rose/.test(cashWord),
    'Cash Back wording does not imply a complete rise or fall');

  const html = History.render(history);
  ok(html.includes('pending unknown'),
    'the page discloses that Cash Back pending is unknown');
  ok(html.includes(History.money2(250)) && html.includes('pending'),
    'the page shows Travel Visa $250.00 pending beside posted');
  ok(html.includes(History.signedMoney(66.44)),
    'the page publishes the independent MBNA exposure movement');
  ok(!html.includes(History.signedMoney(148.49)),
    'the page does not publish MBNA posted-only +$148.49 as the debt movement');
}

console.log('\n=== T2. the HELOC question is answerable from stored history ===');
{
  const move = History.displayMove(History.seriesFor(history, 'heloc'));
  const word = History.movementWord(move, 'HELOC');
  ok(move.sufficient, 'HELOC has two independently dated openings');
  ok(near(move.prior.balance, 201586.16) && move.prior.asOf === AUG9,
    'prior HELOC is the 2026-08-09 $201,586.16 opening');
  ok(near(move.current.balance, 200486.16) && move.current.asOf === AUG16,
    'current HELOC is the 2026-08-16 $200,486.16 opening');
  ok(near(move.delta, -1100) && /fell/.test(word),
    'from stored history: the HELOC fell $1,100.00 between those openings', word);
}

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} B20 history check(s)`);
  process.exit(1);
}
console.log('B20 / AF-HIST-01 PROVED');
