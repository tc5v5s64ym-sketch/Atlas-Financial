'use strict';
/* Configured purpose-reserve transfers are household cash counterparts.
 *
 * householdCashLocationId already pairs a household-reserve leg. Downstream
 * recognition — known household-cash counterpart, operating-cash effect,
 * location labels, and payday Current Balance — must use the same validated
 * purpose-reserve identities. Legacy `savings` stays recognized. Unconfigured
 * and external counterparts stay fail-closed.
 *
 * Independent oracles do not call the Forecast helpers under repair (L-002).
 * Synthetic amounts only (L-006).
 *
 * `node test/test-purpose-reserve-transfers.js`
 */

const F = require('../public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const clone = x => JSON.parse(JSON.stringify(x));

const PAYDAY = '2026-09-25';
const DAY_BEFORE = '2026-09-24';
const NON_PAYDAY = '2026-09-26';
const BILLS = 1000;
const WEEKLY = 80;
const SAVINGS = 20;
const HOME = 17.23;
const PAYROLL = 4000;
const TRANSFER = 250;
const NEAR_PAYROLL = 4020;
const OPERATING = new Set(['chequing-a', 'chequing-b']);
const LEGACY_RESERVE = 'savings';
const HOME_RESERVE = 'savings-dont-touch';
const CONFIGURED_RESERVES = new Set([LEGACY_RESERVE, HOME_RESERVE]);
const TFR_RE = /\b([A-Z]{2}\d{3})\s+TFR-(TO|FR)\b/i;

function purposePlan() {
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: BILLS },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: WEEKLY },
        { id: 'savings', label: 'EMERGENCY SAVING', value: SAVINGS },
      ],
      heldElsewhere: [
        {
          id: HOME_RESERVE,
          label: 'SAVINGS-DONT TOUCH',
          value: HOME,
          class: 'purpose-reserve',
        },
      ],
    },
    opening: { asOf: DAY_BEFORE, representedEvents: [] },
    income: [{
      id: 'payroll',
      label: 'Payroll — Seaspan',
      frequency: 'biweekly',
      anchor: '2026-08-14',
      amount: PAYROLL,
      confidence: 'confirmed',
    }],
    bills: [],
    obligations: [],
    commitments: [],
    budget: { categories: [] },
    savingsEarmarks: {
      version: 1,
      currency: 'CAD',
      pools: [
        {
          id: 'sports',
          accountId: LEGACY_RESERVE,
          label: 'Synthetic sports reserve',
          role: 'purpose-reserve',
          purpose: 'Synthetic sports',
        },
        {
          id: 'home',
          accountId: HOME_RESERVE,
          label: 'Synthetic home reserve',
          role: 'purpose-reserve',
          purpose: 'Synthetic home costs',
          reconciledOn: '2026-08-19',
        },
      ],
      history: [],
    },
  };
}

function unconfiguredPlan() {
  const plan = purposePlan();
  delete plan.savingsEarmarks;
  plan.startingCash.heldElsewhere[0].class = 'staging';
  return plan;
}

function packet(txs, through) {
  return {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: through,
    coverageStart: PAYDAY,
    coverageThrough: through,
    pendingCoverage: 'complete',
    transactionCoverage: 'complete',
    representedActuals: [],
    transactions: txs,
  };
}

function tfrLeg(opts) {
  const dir = opts.dir;
  const amount = dir === 'TO' ? opts.amount : -opts.amount;
  return {
    id: opts.id,
    date: opts.date || PAYDAY,
    amount,
    pending: false,
    categoryLabel: 'Payment, Transfer',
    accountRole: opts.accountRole,
    atlasAccountId: opts.atlasAccountId,
    account: opts.atlasAccountId,
    excludeFromTotals: true,
    kindHint: 'transfer',
    displayedPayee: opts.payee,
    originalMerchant: opts.payee,
    tfrReference: opts.tfrReference,
    tfrDirection: dir,
    isIncome: false,
  };
}

function reserveRole(id) {
  return id === HOME_RESERVE ? 'household-reserve' : 'household-cash';
}

function transferPair(opts) {
  const date = opts.date || PAYDAY;
  const ref = opts.ref;
  const amount = opts.amount;
  const from = opts.from;
  const to = opts.to;
  return [
    tfrLeg({
      id: opts.outId,
      dir: 'TO',
      amount,
      date,
      atlasAccountId: from,
      accountRole: from === HOME_RESERVE ? 'household-reserve' : reserveRole(from),
      payee: `${ref} TFR-TO ${to.toUpperCase()}`,
      tfrReference: ref,
    }),
    tfrLeg({
      id: opts.inId,
      dir: 'FR',
      amount,
      date,
      atlasAccountId: to,
      accountRole: to === HOME_RESERVE ? 'household-reserve' : reserveRole(to),
      payee: `${ref} TFR-FR ${from.toUpperCase()}`,
      tfrReference: ref,
    }),
  ];
}

function payrollCredit(amount) {
  return {
    id: 'payroll-unlabelled',
    date: PAYDAY,
    amount: -amount,
    pending: false,
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    displayedPayee: 'SEASPAN ULC PAY',
    isIncome: false,
  };
}

function parseIndependentTfr(tx) {
  if (!tx) return null;
  if (tx.tfrReference && (tx.tfrDirection === 'TO' || tx.tfrDirection === 'FR')) {
    return {
      ref: String(tx.tfrReference).toUpperCase(),
      dir: String(tx.tfrDirection).toUpperCase(),
    };
  }
  const blob = [tx.displayedPayee, tx.originalMerchant].filter(Boolean).join(' ');
  const match = TFR_RE.exec(blob);
  return match ? { ref: match[1].toUpperCase(), dir: match[2].toUpperCase() } : null;
}

function independentLocation(tx, configured) {
  if (!tx) return null;
  if (tx.accountRole === 'household-external' || tx.accountRole === 'unmapped') return null;
  const id = String(tx.atlasAccountId || tx.account || '').trim();
  if (!id) return null;
  if (tx.accountRole === 'household-reserve') {
    if (id === LEGACY_RESERVE) return id;
    return configured && CONFIGURED_RESERVES.has(id) ? id : null;
  }
  if (tx.accountRole && tx.accountRole !== 'household-cash') return null;
  if (OPERATING.has(id) || id === LEGACY_RESERVE) return id;
  return configured && CONFIGURED_RESERVES.has(id) ? id : null;
}

function independentPairs(txs, configured) {
  const groups = new Map();
  for (const tx of txs || []) {
    if (!tx || tx.pending === true || tx.id == null) continue;
    const parsed = parseIndependentTfr(tx);
    const loc = independentLocation(tx, configured);
    if (!parsed || !loc) continue;
    const amt = Number(tx.amount);
    if (parsed.dir === 'TO' && !(amt > 0)) continue;
    if (parsed.dir === 'FR' && !(amt < 0)) continue;
    const list = groups.get(parsed.ref) || [];
    list.push({ tx, parsed, loc, amt });
    groups.set(parsed.ref, list);
  }
  const out = [];
  groups.forEach((legs, ref) => {
    if (legs.length !== 2) return;
    const left = legs[0];
    const right = legs[1];
    if (left.parsed.dir === right.parsed.dir || left.loc === right.loc) return;
    if (roundCent(Math.abs(left.amt)) !== roundCent(Math.abs(right.amt))) return;
    const source = left.parsed.dir === 'TO' ? left : right;
    const dest = left.parsed.dir === 'FR' ? left : right;
    out.push({
      amount: roundCent(Math.abs(source.amt)),
      sourceAccountId: source.loc,
      destinationAccountId: dest.loc,
      sourceTransactionId: String(source.tx.id),
      destinationTransactionId: String(dest.tx.id),
      tfrReference: ref,
      householdIncome: 0,
      householdConsumption: 0,
      householdAssetDelta: roundCent(source.amt + dest.amt),
    });
  });
  return out;
}

function independentKnownCash(id, configured) {
  if (OPERATING.has(id) || id === LEGACY_RESERVE) return true;
  return configured === true && CONFIGURED_RESERVES.has(id);
}

function independentOperatingEffect(sourceAccountId, destinationAccountId, configured) {
  const srcOp = OPERATING.has(sourceAccountId);
  const dstOp = OPERATING.has(destinationAccountId);
  const srcSav = independentKnownCash(sourceAccountId, configured) && !srcOp;
  const dstSav = independentKnownCash(destinationAccountId, configured) && !dstOp;
  if (srcOp && dstOp) return 'stays-in-operating-cash';
  if (srcOp && dstSav) return 'leaves-operating-cash';
  if (srcSav && dstOp) return 'enters-operating-cash';
  return null;
}

function independentBillsEffect(sourceAccountId, destinationAccountId) {
  const srcBills = sourceAccountId === 'chequing-a';
  const dstBills = destinationAccountId === 'chequing-a';
  if (srcBills && !dstBills) return 'leaves-bills';
  if (dstBills && !srcBills) return 'enters-bills';
  return null;
}

function independentLabel(plan, id) {
  const cash = (plan && plan.startingCash) || {};
  const rows = (cash.breakdown || []).concat(cash.heldElsewhere || []);
  const row = rows.find(item => item && item.id === id && item.label);
  if (row) return String(row.label);
  if (id === 'chequing-a') return 'BILLS ACCOUNT';
  if (id === 'chequing-b') return 'WEEKLY SPENDING';
  if (id === LEGACY_RESERVE) return 'designated savings';
  const pool = ((plan && plan.savingsEarmarks && plan.savingsEarmarks.pools) || [])
    .find(item => item && item.accountId === id && item.role === 'purpose-reserve');
  return pool ? String(pool.label || pool.purpose || '') || null : null;
}

function nearPayroll(amount) {
  const windowCents = Math.max(1, Math.round(Math.abs(PAYROLL) * 0.01 * 100));
  return Math.abs(Math.round(amount * 100) - Math.round(PAYROLL * 100)) <= windowCents;
}

function independentPaydayBalance(txs, configured) {
  const pairs = independentPairs(txs, configured);
  const byId = new Map();
  for (const move of pairs) {
    byId.set(move.sourceTransactionId, { move, counterpart: move.destinationAccountId });
    byId.set(move.destinationTransactionId, { move, counterpart: move.sourceAccountId });
  }
  let sameDay = 0;
  let deposits = 0;
  for (const tx of txs || []) {
    if (!tx || tx.pending === true || tx.date !== PAYDAY) continue;
    if (tx.atlasAccountId !== 'chequing-a') continue;
    const amt = roundCent(-Number(tx.amount));
    if (!Number.isFinite(amt) || amt === 0) return null;
    if (!(amt > 0)) {
      sameDay = roundCent(sameDay + amt);
      continue;
    }
    const proven = byId.get(String(tx.id));
    const transfer = proven && independentKnownCash(proven.counterpart, configured);
    if (transfer) {
      sameDay = roundCent(sameDay + amt);
      continue;
    }
    if (nearPayroll(amt)) {
      deposits += 1;
      if (deposits > 1) return null;
      continue;
    }
    return null;
  }
  return {
    prePayday: BILLS,
    sameDay,
    current: roundCent(BILLS + sameDay + PAYROLL),
  };
}

function recommend(plan, asOf, txs) {
  return F.recommend(plan, asOf, {
    debts: [],
    targetBuffer: 500,
    currentPeriodActuals: packet(txs, asOf),
  });
}

function published(advice) {
  const alloc = advice && advice.paydayAllocation;
  const view = advice && advice.defaultView;
  return {
    amount: alloc && alloc.liveCurrentBalance,
    view: view && view.liveCurrentBalance,
    publication: (alloc && alloc.currentBalancePublication)
      || (view && view.currentBalancePublication),
    explanation: view && view.operatingCashExplanation,
  };
}

function billsMove(set, id) {
  return ((set && set.movements) || []).find(row => row && row.id === id) || null;
}

ok(F.savingsEarmarksState(purposePlan(), PAYDAY).status === 'ready',
  'synthetic purpose fixture is a valid ready configuration');
ok(near(F.startingCashAmount(purposePlan()), BILLS + WEEKLY)
    && !near(F.startingCashAmount(purposePlan()), BILLS + WEEKLY + SAVINGS)
    && !near(F.startingCashAmount(purposePlan()), BILLS + WEEKLY + HOME),
  'independent spendable opening stays chequing-only after purpose configuration');

console.log('=== A. Configured reserve ↔ Bills pairing and signed classification ===');
{
  const plan = purposePlan();
  const cases = [
    {
      name: 'home reserve → Bills',
      txs: transferPair({
        ref: 'HA101', amount: TRANSFER, from: HOME_RESERVE, to: 'chequing-a',
        outId: 'home-out', inId: 'bills-in',
      }),
      billsId: 'bills-in',
      counterpart: HOME_RESERVE,
      signed: TRANSFER,
    },
    {
      name: 'Bills → home reserve',
      txs: transferPair({
        ref: 'HA102', amount: TRANSFER, from: 'chequing-a', to: HOME_RESERVE,
        outId: 'bills-out', inId: 'home-in',
      }),
      billsId: 'bills-out',
      counterpart: HOME_RESERVE,
      signed: -TRANSFER,
    },
    {
      name: 'legacy savings → Bills',
      txs: transferPair({
        ref: 'SA101', amount: TRANSFER, from: LEGACY_RESERVE, to: 'chequing-a',
        outId: 'sav-out', inId: 'bills-from-sav',
      }),
      billsId: 'bills-from-sav',
      counterpart: LEGACY_RESERVE,
      signed: TRANSFER,
    },
    {
      name: 'Bills → legacy savings',
      txs: transferPair({
        ref: 'SA102', amount: TRANSFER, from: 'chequing-a', to: LEGACY_RESERVE,
        outId: 'bills-to-sav', inId: 'sav-in',
      }),
      billsId: 'bills-to-sav',
      counterpart: LEGACY_RESERVE,
      signed: -TRANSFER,
    },
  ];
  for (const row of cases) {
    const independent = independentPairs(row.txs, true);
    const set = F.postedAccountMovements(plan, 'chequing-a', {
      start: PAYDAY, through: PAYDAY,
    }, { currentPeriodActuals: packet(row.txs, PAYDAY) });
    const move = billsMove(set, row.billsId);
    ok(independent.length === 1
        && near(independent[0].householdAssetDelta, 0)
        && near(independent[0].householdIncome, 0)
        && (independent[0].sourceAccountId === 'chequing-a'
          || independent[0].destinationAccountId === 'chequing-a'),
      `independent ${row.name} is one conserved household transfer`);
    ok(move && move.internalTransfer === true
        && move.classification === 'internal-transfer'
        && move.counterpartAccountId === row.counterpart
        && near(move.amount, row.signed)
        && near(move.householdIncome, 0)
        && near(move.householdConsumption, 0),
      `Forecast ${row.name} stays an internal transfer with the signed Bills amount`);
  }
}

console.log('=== B. Seaspan payday Current Balance keeps valid reserve counterparts ===');
{
  const plan = purposePlan();
  const homeIn = transferPair({
    ref: 'HA201', amount: TRANSFER, from: HOME_RESERVE, to: 'chequing-a',
    outId: 'home-pay-out', inId: 'bills-pay-in',
  });
  const homeNear = transferPair({
    ref: 'HA202', amount: NEAR_PAYROLL, from: HOME_RESERVE, to: 'chequing-a',
    outId: 'home-near-out', inId: 'bills-near-in',
  });
  const homeOut = transferPair({
    ref: 'HA203', amount: TRANSFER, from: 'chequing-a', to: HOME_RESERVE,
    outId: 'bills-pay-out', inId: 'home-pay-in',
  });
  const savingsIn = transferPair({
    ref: 'SA201', amount: TRANSFER, from: LEGACY_RESERVE, to: 'chequing-a',
    outId: 'sav-pay-out', inId: 'bills-from-sav-pay',
  });
  const payrollOnly = [payrollCredit(PAYROLL)];
  const payrollPlusHome = homeIn.concat([payrollCredit(PAYROLL)]);

  const cases = [
    { name: 'home reserve 250 into Bills', txs: homeIn, expected: 5250 },
    { name: 'home reserve near-payroll into Bills', txs: homeNear, expected: 9020 },
    { name: 'Bills 250 into home reserve', txs: homeOut, expected: 4750 },
    { name: 'legacy savings 250 into Bills', txs: savingsIn, expected: 5250 },
    { name: 'real unlabelled payroll control', txs: payrollOnly, expected: 5000 },
    { name: 'home reserve plus real payroll', txs: payrollPlusHome, expected: 5250 },
  ];
  for (const row of cases) {
    const oracle = independentPaydayBalance(row.txs, true);
    const pub = published(recommend(plan, PAYDAY, row.txs));
    ok(oracle && near(oracle.current, row.expected),
      `independent ${row.name} Current Balance is ${row.expected}`);
    ok(pub.publication && pub.publication.status === 'planned-dale-payday'
        && near(pub.amount, row.expected)
        && near(pub.view, row.expected)
        && near(pub.publication.assumedDalePayroll, PAYROLL)
        && pub.publication.accountId === 'chequing-a',
      `Forecast ${row.name} stays available and equals the independent payday total`,
      pub.publication ? `${pub.publication.status}:${pub.amount}` : 'missing');
    ok(!near(pub.amount, BILLS + PAYROLL) || near(row.expected, BILLS + PAYROLL),
      `Forecast ${row.name} is not the dropped-transfer payroll-only figure`);
  }
}

console.log('=== C. Non-payday explanation names each configured reserve once ===');
{
  const plan = purposePlan();
  const cases = [
    {
      name: 'home reserve → Bills',
      txs: transferPair({
        ref: 'HA301', amount: TRANSFER, from: HOME_RESERVE, to: 'chequing-a',
        outId: 'home-np-out', inId: 'bills-np-in', date: NON_PAYDAY,
      }),
    },
    {
      name: 'Bills → home reserve',
      txs: transferPair({
        ref: 'HA302', amount: TRANSFER, from: 'chequing-a', to: HOME_RESERVE,
        outId: 'bills-np-out', inId: 'home-np-in', date: NON_PAYDAY,
      }),
    },
    {
      name: 'legacy savings → Bills',
      txs: transferPair({
        ref: 'SA301', amount: TRANSFER, from: LEGACY_RESERVE, to: 'chequing-a',
        outId: 'sav-np-out', inId: 'bills-from-sav-np', date: NON_PAYDAY,
      }),
    },
    {
      name: 'Bills → legacy savings',
      txs: transferPair({
        ref: 'SA302', amount: TRANSFER, from: 'chequing-a', to: LEGACY_RESERVE,
        outId: 'bills-to-sav-np', inId: 'sav-np-in', date: NON_PAYDAY,
      }),
    },
  ];
  for (const row of cases) {
    const independent = independentPairs(row.txs, true)[0];
    const effect = independentOperatingEffect(
      independent.sourceAccountId, independent.destinationAccountId, true);
    const billsEffect = independentBillsEffect(
      independent.sourceAccountId, independent.destinationAccountId);
    const sourceLabel = independentLabel(plan, independent.sourceAccountId);
    const destLabel = independentLabel(plan, independent.destinationAccountId);
    const pub = published(recommend(plan, NON_PAYDAY, row.txs));
    const move = pub.explanation && pub.explanation.movements
      && pub.explanation.movements[0];
    ok(independent && effect && sourceLabel && destLabel
        && near(independent.householdAssetDelta, 0),
      `independent ${row.name} has one signed operating effect and both labels`);
    ok(pub.publication && pub.publication.status === 'provider-confirmed'
        && near(pub.amount, BILLS)
        && pub.explanation && pub.explanation.movements.length === 1
        && move.operatingCashEffect === effect
        && move.billsLocationEffect === billsEffect
        && move.sourceLabel === sourceLabel
        && move.destinationLabel === destLabel
        && near(move.amount, TRANSFER)
        && near(move.householdIncome, 0)
        && near(move.householdConsumption, 0)
        && move.purpose == null,
      `Forecast ${row.name} is explained once on a non-payday and Current Balance stays posted Bills`,
      pub.explanation ? `${pub.explanation.movements.length}:${move && move.operatingCashEffect}` : String(pub.publication && pub.publication.status));
  }
}

console.log('=== D. Payday explanation and unconfigured / external fail-closed ===');
{
  const plan = purposePlan();
  const paydayHome = transferPair({
    ref: 'HA401', amount: TRANSFER, from: HOME_RESERVE, to: 'chequing-a',
    outId: 'home-expl-out', inId: 'bills-expl-in',
  });
  const independent = independentPairs(paydayHome, true)[0];
  const paydayPub = published(recommend(plan, PAYDAY, paydayHome));
  const paydayMove = paydayPub.explanation && paydayPub.explanation.movements
    && paydayPub.explanation.movements[0];
  ok(paydayPub.explanation && paydayPub.explanation.movements.length === 1
      && paydayMove.operatingCashEffect === 'enters-operating-cash'
      && paydayMove.billsLocationEffect === 'enters-bills'
      && paydayMove.sourceLabel === independentLabel(plan, HOME_RESERVE)
      && paydayMove.destinationLabel === independentLabel(plan, 'chequing-a'),
    'Seaspan payday explains the configured home-reserve inflow once');

  const bare = unconfiguredPlan();
  const unconfiguredHome = transferPair({
    ref: 'XX501', amount: TRANSFER, from: HOME_RESERVE, to: 'chequing-a',
    outId: 'unconfig-out', inId: 'unconfig-in',
  });
  const unconfiguredOracle = independentPaydayBalance(unconfiguredHome, false);
  const unconfiguredPub = published(recommend(bare, PAYDAY, unconfiguredHome));
  ok(unconfiguredOracle == null
      && unconfiguredPub.publication
      && unconfiguredPub.publication.status === 'unavailable'
      && unconfiguredPub.amount == null
      && !near(unconfiguredPub.amount, 5250),
    'unconfigured savings-dont-touch still fails closed on payday');

  const external = [
    tfrLeg({
      id: 'tennis-out', dir: 'TO', amount: TRANSFER, atlasAccountId: 'amanda-debt-payments',
      accountRole: 'household-external', payee: 'EX601 TFR-TO CHEQUING-A', tfrReference: 'EX601',
    }),
    tfrLeg({
      id: 'bills-from-tennis', dir: 'FR', amount: TRANSFER, atlasAccountId: 'chequing-a',
      accountRole: 'household-cash', payee: 'EX601 TFR-FR TENNIS', tfrReference: 'EX601',
    }),
  ];
  const externalOracle = independentPaydayBalance(external, true);
  const externalPub = published(recommend(plan, PAYDAY, external));
  ok(independentPairs(external, true).length === 0
      && externalOracle == null
      && externalPub.publication.status === 'unavailable'
      && externalPub.amount == null,
    'an external TENNIS counterpart is not household cash');

  const alias = [
    tfrLeg({
      id: 'alias-out', dir: 'TO', amount: TRANSFER, atlasAccountId: 'alias-for-staging',
      accountRole: 'household-reserve', payee: 'AL701 TFR-TO CHEQUING-A', tfrReference: 'AL701',
    }),
    tfrLeg({
      id: 'bills-from-alias', dir: 'FR', amount: TRANSFER, atlasAccountId: 'chequing-a',
      accountRole: 'household-cash', payee: 'AL701 TFR-FR ALIAS', tfrReference: 'AL701',
    }),
  ];
  const aliasOracle = independentPaydayBalance(alias, true);
  const aliasPub = published(recommend(plan, PAYDAY, alias));
  ok(independentPairs(alias, true).length === 0
      && aliasOracle == null
      && aliasPub.publication.status === 'unavailable'
      && aliasPub.amount == null
      && !near(aliasPub.amount, 5250),
    'an unconfigured household-reserve alias is not treated as household cash');
}

if (failures) {
  console.log(`${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('PASS purpose-reserve transfers: configured reserves are known counterparts both ways, payday Current Balance stays available, explanations carry labels and sign, legacy savings is preserved, unconfigured/external identities fail closed');
