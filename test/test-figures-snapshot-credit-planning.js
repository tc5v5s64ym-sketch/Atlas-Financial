'use strict';
/* B100 — figures-snapshot covers Credit and Planning published figures.
 * `node test/test-figures-snapshot-credit-planning.js`
 *
 * The snapshot copies Forecast.creditAccounts and the same Forecast.recommend
 * majorPlans / paydayAllocation / knowledge the pages render. It does not
 * recompute headroom, minimums, verdicts, or range midpoints. Plan-page keys
 * that already existed on main stay present and unchanged.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const F = require('../public/forecast.js');
const { buildFiguresSnapshot } = require('../scripts/figures-snapshot.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const MAIN = 'origin/main';
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const round = n => Math.round(Number(n) * 100) / 100;
const same = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 0.005;
  return a === b;
};

const PLAN_PREFIX = /^(meta|cash|plan|payday|operating|totals|budget|scoreboard|debt|balance|heloc|action|policy)\./;
const PLAN_KEYS_ON_MAIN = [
  'meta.asOf', 'meta.windowDays', 'meta.targetBuffer', 'meta.scenario',
  'cash.spendableToday', 'cash.elsewhere.operational', 'cash.elsewhere.staging',
  'cash.elsewhere.other-liquid', 'plan.mode', 'plan.weeklyCap', 'plan.weeklyCapMonthly',
  'plan.effectiveFrom', 'plan.bindingDate', 'plan.bindingBalance', 'plan.endingCash',
  'plan.lowestCash', 'plan.lowestCashDate', 'payday.available', 'payday.obligations',
  'payday.essentials', 'payday.liquidity', 'payday.futureCosts', 'payday.extraDebt',
  'payday.unallocated', 'payday.riskShortfall', 'operating.this.start',
  'operating.this.end', 'operating.this.available', 'operating.this.incomeAdded',
  'operating.this.projectedEnding', 'operating.next.start', 'operating.next.end',
  'operating.next.available', 'operating.next.incomeAdded',
  'operating.next.projectedEnding', 'totals.confirmedIncome', 'totals.estimatedIncome',
  'totals.obligations', 'totals.bills', 'totals.commitments', 'totals.nonCashInterest',
  'budget.basis', 'budget.essentialPerMonth', 'budget.requiredPerMonth',
  'budget.requiredPerWeek', 'budget.discretionaryPerMonth', 'budget.reservePerMonth',
  'budget.datedPerMonth', 'budget.foodAndFuelPerMonth', 'budget.foodAndFuelPerWeek',
  'scoreboard.today.cash', 'scoreboard.today.consumerDebt', 'scoreboard.today.heloc',
  'scoreboard.today.creditHeadroom', 'scoreboard.today.facilitiesOverLimit',
  'scoreboard.day30.cash', 'scoreboard.day30.consumerDebt', 'scoreboard.day30.heloc',
  'scoreboard.day30.creditHeadroom', 'scoreboard.day30.facilitiesOverLimit',
  'scoreboard.day60.cash', 'scoreboard.day60.consumerDebt', 'scoreboard.day60.heloc',
  'scoreboard.day60.creditHeadroom', 'scoreboard.day60.facilitiesOverLimit',
  'scoreboard.day90.cash', 'scoreboard.day90.consumerDebt', 'scoreboard.day90.heloc',
  'scoreboard.day90.creditHeadroom', 'scoreboard.day90.facilitiesOverLimit',
  'debt.interestOverWindow', 'debt.overLimit.triangle', 'debt.overLimit.travelvisa',
  'debt.overLimit.heloc', 'balance.assets', 'balance.debts',
  'balance.consumerDebtPosted', 'balance.consumerDebtPending',
  'balance.consumerDebtEffective', 'balance.securedDebt', 'heloc.vsLastMonth',
  'heloc.vsLastMonthVerdict', 'heloc.currentOpening', 'action.next',
  'action.nextAmount', 'action.nextDue', 'action.openCount', 'policy.nextDollarTarget',
];

/* ---------------------------------------------------------------- fixtures */
const CREDIT_AS_OF = '2026-03-10';
function creditFixture() {
  return {
    meta: { asOf: CREDIT_AS_OF },
    revolvingExtra: [],
    debts: [
      { id: 'card-a', label: 'Card A', secured: false, balance: 4200.10, pending: 300.55, pendingUnknown: false,
        limit: 5000, rate: 21.99, payment: 120, frequency: 'Monthly minimum', confidence: 'verified' },
      { id: 'card-b', label: 'Card B', secured: false, balance: 500, pendingUnknown: true,
        limit: 2000, rate: 19.99, payment: 25, frequency: 'Monthly minimum', confidence: 'verified' },
      { id: 'card-over', label: 'Card Over', secured: false, balance: 1050, pending: 0, pendingUnknown: false,
        limit: 1000, rate: 24.99, payment: 10, frequency: 'Monthly minimum', confidence: 'verified' },
      { id: 'heloc', label: 'HELOC', secured: true, balance: 90000, pending: 0, limit: 100000, rate: 4.9,
        payment: 400, interestTreatment: 'capitalised', cashPayment: 0, monthlyInterest: 400,
        confidence: 'verified' },
      { id: 'mortgage', label: 'Mortgage', secured: true, balance: 500000, pending: 0, limit: null, rate: 3.64,
        payment: 1600, frequency: 'Bi-weekly', confidence: 'verified' },
    ],
    plan: {
      windowDays: 91,
      defaults: { scenario: 'expected', targetBuffer: 0, extraDebtMonthly: 0 },
      opening: { asOf: CREDIT_AS_OF },
      startingCash: { breakdown: [{ id: 'chequing-a', label: 'Chequing A', value: 5000 }] },
      income: [{ id: 'pay', label: 'Pay', frequency: 'biweekly', anchor: '2026-03-06', amount: 2000, confidence: 'confirmed' }],
      obligations: [
        { id: 'mortgage', debtId: 'mortgage', effect: 'payment', label: 'Mortgage', frequency: 'biweekly',
          anchor: '2026-03-06', amount: 1600, confidence: 'confirmed', payingAccount: 'chequing-a' },
        { id: 'heloc', debtId: 'heloc', effect: 'capitalise', label: 'HELOC interest', frequency: 'monthly', day: 31,
          amount: 400, confidence: 'confirmed', nonCash: true, payingAccount: 'chequing-a',
          cashPayment: 400, cashDay: 21, cashFirstDue: '2026-03-21', cashLabel: 'HELOC minimum', cashConfidence: 'estimated' },
        { id: 'card-a', debtId: 'card-a', effect: 'payment', label: 'Card A minimum', frequency: 'monthly', day: 15,
          amount: 120, confidence: 'estimated', payingAccount: 'chequing-a' },
        { id: 'card-b-mar', debtId: 'card-b', effect: 'payment', label: 'Card B — March statement minimum', frequency: 'once',
          date: '2026-03-20', amount: 25, confidence: 'confirmed', payingAccount: 'chequing-a' },
        { id: 'card-over', debtId: 'card-over', effect: 'payment', label: 'Card Over minimum', frequency: 'monthly', day: 5,
          amount: 10, confidence: 'estimated', payingAccount: 'chequing-a' },
      ],
      bills: [],
      commitments: [],
    },
  };
}

const PLANNING_AS_OF = '2026-03-10';
function planningFixture() {
  return {
    meta: { asOf: PLANNING_AS_OF },
    revolvingExtra: [],
    debts: [],
    plan: {
      windowDays: 91,
      defaults: { scenario: 'expected', targetBuffer: 0, extraDebtMonthly: 0 },
      opening: { asOf: PLANNING_AS_OF },
      startingCash: { breakdown: [{ id: 'chequing-a', label: 'Chequing A', value: 50000 }] },
      income: [{ id: 'pay', label: 'Pay', frequency: 'biweekly', anchor: '2026-03-06', amount: 2000, confidence: 'confirmed' }],
      obligations: [],
      bills: [],
      commitments: [
        { id: 'dated-point', date: '2026-04-10', label: 'Dated point cost', amount: 800, confidence: 'estimated', adjustable: true },
        { id: 'point', label: 'Point estimate', amount: 2000, when: 'late Sep 2026', confidence: 'estimated' },
        { id: 'range', label: 'Range cost', amount: null, amountMin: 700, amountMax: 1200, when: 'Fall 2026', confidence: 'estimated', adjustable: true },
        { id: 'tbd', label: 'Timing TBD cost', amount: 1000, when: 'timing TBD', confidence: 'estimated' },
      ],
    },
  };
}

function snapshotRecommend(data) {
  return F.recommend(data.plan, data.meta.asOf, {
    scenario: data.plan.defaults.scenario, incomeOverrides: {}, disabled: [],
    extraDebtMonthly: data.plan.defaults.extraDebtMonthly || 0,
    targetBuffer: data.plan.defaults.targetBuffer,
    fundingSources: (data.plan.funding || {}).options,
    extraFacilities: data.revolvingExtra,
  });
}

function runCli() {
  return JSON.parse(execFileSync(process.execPath, [
    path.join(ROOT, 'scripts/figures-snapshot.js'),
  ], { encoding: 'utf8', cwd: ROOT }));
}

function runMainSnapshot() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figures-snapshot-main-'));
  try {
    const src = execFileSync('git', ['show', `${MAIN}:scripts/figures-snapshot.js`], {
      encoding: 'utf8', cwd: ROOT,
    });
    const script = path.join(tmp, 'figures-snapshot.js');
    fs.writeFileSync(script, src);
    return JSON.parse(execFileSync(process.execPath, [script], {
      encoding: 'utf8', cwd: ROOT,
    }));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const snapSrc = sourceText(read('scripts/figures-snapshot.js'));
const stripComments = src => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('=== 1. Credit published figures have stable snapshot keys ===');
{
  const fx = creditFixture();
  const snap = buildFiguresSnapshot(fx, null);
  const accounts = F.creditAccounts(fx.plan, fx.debts, CREDIT_AS_OF, {
    extraFacilities: fx.revolvingExtra,
  });
  ok(snap['credit.asOf'] === accounts.asOf, 'credit.asOf is Forecast.creditAccounts.asOf');
  const rows = [...accounts.secured, ...accounts.cards];
  ok(rows.length === 5, 'fixture has five credit accounts');
  for (const row of rows) {
    const p = `credit.${row.id}`;
    ok(same(snap[`${p}.balance`], row.balance == null ? null : round(row.balance)),
      `${row.id} balance is snapshotted`);
    ok(snap[`${p}.pendingUnknown`] === (row.pendingUnknown === true),
      `${row.id} pendingUnknown is snapshotted`);
    ok(same(snap[`${p}.pending`], row.pending),
      `${row.id} pending is Forecast.creditAccounts.pending`);
    ok(same(snap[`${p}.rate`], row.rate == null ? null : round(row.rate)),
      `${row.id} rate is snapshotted`);
    if (row.shape !== 'secured-term') {
      ok(same(snap[`${p}.limit`], row.limit == null ? null : round(row.limit)),
        `${row.id} limit is snapshotted`);
      ok(same(snap[`${p}.available`], row.available == null ? null : round(row.available)),
        `${row.id} available is Forecast.creditAccounts.available`);
      ok(snap[`${p}.overLimit`] === (row.overLimit === true),
        `${row.id} overLimit is snapshotted`);
    } else {
      ok(snap[`${p}.limit`] === undefined && snap[`${p}.available`] === undefined,
        `${row.id} term debt does not invent a limit or headroom key`);
    }
    ok(same(snap[`${p}.minimum`], row.nextPayment ? round(row.nextPayment.amount) : null),
      `${row.id} minimum is Forecast nextPayment.amount`);
    ok(snap[`${p}.due`] === (row.nextPayment ? row.nextPayment.date : null),
      `${row.id} due is Forecast nextPayment.date`);
  }
  const over = accounts.cards.find(r => r.id === 'card-over');
  ok(over && over.overLimit === true && same(snap['credit.card-over.overLimitBy'], round(over.overLimitBy)),
    'over-limit card snapshots Forecast overLimitBy');
  const unknown = accounts.cards.find(r => r.id === 'card-b');
  ok(unknown && unknown.pendingUnknown === true && snap['credit.card-b.pending'] == null,
    'unknown pending is copied as null, not invented as $0');
  const heloc = accounts.secured.find(r => r.id === 'heloc');
  ok(heloc && heloc.nextCapitalise
    && same(snap['credit.heloc.capitalise'], round(heloc.nextCapitalise.amount))
    && snap['credit.heloc.capitaliseDate'] === heloc.nextCapitalise.date
    && same(snap['credit.heloc.cashMinimum'], round(heloc.nextCashMinimum.amount))
    && snap['credit.heloc.cashMinimumDue'] === heloc.nextCashMinimum.date,
    'HELOC capitalise and cash minimum are Forecast occurrences');
  const mortgage = accounts.secured.find(r => r.id === 'mortgage');
  ok(mortgage && same(snap['credit.mortgage.regularPayment'], round(mortgage.regularPayment)),
    'mortgage regular payment is Forecast.creditAccounts.regularPayment');
}

console.log('\n=== 2. Planning / majorPlans published figures have stable snapshot keys ===');
{
  const fx = planningFixture();
  const snap = buildFiguresSnapshot(fx, null);
  const advice = snapshotRecommend(fx);
  ok(Array.isArray(advice.majorPlans) && advice.majorPlans.length >= 4,
    'fixture recommend returns majorPlans');
  ok(snap['planning.horizonEnd'] === advice.knowledge.end,
    'planning.horizonEnd is Forecast.knowledge.end');
  ok(same(snap['planning.encumbered'], round(advice.knowledge.encumbered)),
    'planning.encumbered is Forecast.knowledge.encumbered');
  const alloc = advice.paydayAllocation || {};
  const paydayRows = [...(alloc.futureCosts || []), ...(alloc.optional || [])];
  const unresolved = new Set((alloc.unresolved || []).map(r => r.id));
  for (const row of advice.majorPlans) {
    const p = `planning.${row.id}`;
    ok(snap[`${p}.verdict`] === row.verdict, `${row.id} verdict is Forecast.majorPlans.verdict`);
    ok(same(snap[`${p}.remaining`], round(row.remaining)),
      `${row.id} remaining is Forecast.majorPlans.remaining`);
    if (row.need != null) {
      ok(same(snap[`${p}.need`], round(row.need)), `${row.id} need is the point amount`);
      ok(snap[`${p}.amountMin`] === undefined && snap[`${p}.amountMax`] === undefined,
        `${row.id} does not invent range bounds`);
    }
    if (row.amountMin != null) ok(same(snap[`${p}.amountMin`], round(row.amountMin)), `${row.id} amountMin copied`);
    if (row.amountMax != null) ok(same(snap[`${p}.amountMax`], round(row.amountMax)), `${row.id} amountMax copied`);
    if (row.when) ok(snap[`${p}.when`] === row.when, `${row.id} when is copied verbatim`);
    if (row.date) ok(snap[`${p}.date`] === row.date, `${row.id} date is the Forecast date`);
    const payday = paydayRows.find(item => item.id === row.id);
    if (payday) {
      ok(same(snap[`${p}.allocated`], round(payday.allocated || 0)),
        `${row.id} allocated is paydayAllocation`);
      if (payday.projectedByDeadline != null) {
        ok(same(snap[`${p}.projectedByDeadline`], round(payday.projectedByDeadline)),
          `${row.id} projectedByDeadline is paydayAllocation`);
      }
    } else if (unresolved.has(row.id)) {
      ok(snap[`${p}.allocated`] === 'not-assigned',
        `${row.id} unresolved set-aside is not-assigned, not $0`);
    }
  }
  const range = advice.majorPlans.find(r => r.id === 'range');
  ok(range && range.amountMin === 700 && range.amountMax === 1200, 'range row is a range');
  ok(snap['planning.range.amountMin'] === 700 && snap['planning.range.amountMax'] === 1200,
    'range stays min/max; no midpoint key');
  ok(!Object.keys(snap).some(k => /midpoint|midRange|rangeMid/i.test(k)),
    'snapshot invents no midpoint key');
  const midpoint = (700 + 1200) / 2;
  ok(!Object.values(snap).includes(midpoint),
    'snapshot does not store the range midpoint as a value');
}

console.log('\n=== 3. Snapshot copies incumbent outputs; no second arithmetic ===');
{
  const creditBlock = snapSrc.split('Credit: Forecast.creditAccounts')[1] || '';
  const planningBlock = snapSrc.split('Planning: Forecast.majorPlans')[1] || '';
  const creditCode = stripComments(creditBlock.split('Planning: Forecast.majorPlans')[0] || '');
  const planningCode = stripComments(planningBlock);
  ok(/F\.creditAccounts\(plan, data\.debts, asOf/.test(creditCode),
    'Credit keys come from Forecast.creditAccounts');
  ok(!/limit\s*[-+*/]|balance\s*[-+*/]|pending\s*[-+*/]/.test(creditCode),
    'Credit block does not recompute headroom from limit/balance/pending');
  ok(!/new Date\(|Date\.now\(/.test(creditCode),
    'Credit block does not pick a due date from the clock');
  ok(/advice\.majorPlans/.test(planningCode),
    'Planning keys come from the same recommend result as Plan');
  ok(!/F\.majorPlans\(|Forecast\.majorPlans\(/.test(planningCode),
    'Planning block does not call majorPlans itself');
  ok(!/amountMin\s*[-+*/]|amountMax\s*[-+*/]|\/\s*2/.test(planningCode),
    'Planning block does not average a range');
  ok(!/plan\.commitments/.test(planningCode),
    'Planning block does not read plan.commitments');

  const liveSnap = buildFiguresSnapshot(live, periods);
  const liveAccounts = F.creditAccounts(live.plan, live.debts, live.meta.asOf, {
    extraFacilities: live.revolvingExtra,
  });
  const liveAdvice = snapshotRecommend(live);
  for (const row of [...liveAccounts.secured, ...liveAccounts.cards]) {
    if (row.shape !== 'secured-term') {
      ok(same(liveSnap[`credit.${row.id}.available`], row.available == null ? null : round(row.available)),
        `live ${row.id} available equals Forecast.creditAccounts, not a second formula`);
    }
    ok(same(liveSnap[`credit.${row.id}.minimum`], row.nextPayment ? round(row.nextPayment.amount) : null),
      `live ${row.id} minimum equals Forecast nextPayment`);
  }
  for (const row of liveAdvice.majorPlans || []) {
    ok(liveSnap[`planning.${row.id}.verdict`] === row.verdict,
      `live ${row.id} verdict equals advice.majorPlans`);
    ok(same(liveSnap[`planning.${row.id}.remaining`], round(row.remaining)),
      `live ${row.id} remaining equals advice.majorPlans`);
  }
}

console.log('\n=== 4. Existing Plan snapshot coverage remains intact ===');
{
  const liveSnap = buildFiguresSnapshot(live, periods);
  const mainSnap = runMainSnapshot();
  const missing = PLAN_KEYS_ON_MAIN.filter(k => !Object.prototype.hasOwnProperty.call(liveSnap, k));
  ok(missing.length === 0, 'every Plan key from current main is still present',
    missing.join(', '));
  const moved = PLAN_KEYS_ON_MAIN.filter(k => !same(liveSnap[k], mainSnap[k]));
  ok(moved.length === 0, 'Plan-key values match main\'s own snapshot script on the same data',
    moved.map(k => `${k}:${mainSnap[k]}→${liveSnap[k]}`).join(', '));
  const extraPlan = Object.keys(liveSnap).filter(k => PLAN_PREFIX.test(k) && !PLAN_KEYS_ON_MAIN.includes(k));
  ok(extraPlan.length === 0, 'no extra Plan-prefix keys were introduced', extraPlan.join(', '));
}

console.log('\n=== 5. Output is deterministic ===');
{
  const a = buildFiguresSnapshot(live, periods);
  const b = buildFiguresSnapshot(live, periods);
  ok(JSON.stringify(a) === JSON.stringify(b),
    'buildFiguresSnapshot is byte-identical across two calls');
  const cli = runCli();
  ok(JSON.stringify(cli) === JSON.stringify(a),
    'CLI stdout is exactly buildFiguresSnapshot of canonical data.json');
  const keys = Object.keys(a);
  const sorted = [...keys].sort();
  ok(JSON.stringify(Object.keys(cli)) === JSON.stringify(keys),
    'CLI key order matches the builder');
  ok(keys.filter(k => k.startsWith('credit.')).length > 0
    && keys.filter(k => k.startsWith('planning.')).length > 0,
    'canonical snapshot includes both credit.* and planning.* keys');
  void sorted;
}

console.log('\n=== live household surfaces are covered ===');
{
  const snap = buildFiguresSnapshot(live, periods);
  const accounts = F.creditAccounts(live.plan, live.debts, live.meta.asOf, {
    extraFacilities: live.revolvingExtra,
  });
  const advice = snapshotRecommend(live);
  const liveIds = [...accounts.secured, ...accounts.cards].map(r => r.id);
  ok(liveIds.length >= 5 && liveIds.every(id => Object.prototype.hasOwnProperty.call(snap, `credit.${id}.balance`)),
    `live Credit accounts (${liveIds.join(', ')}) each have balance keys`);
  const revolving = [...accounts.secured, ...accounts.cards].filter(r => r.shape !== 'secured-term');
  ok(revolving.every(r => Object.prototype.hasOwnProperty.call(snap, `credit.${r.id}.available`)
    && Object.prototype.hasOwnProperty.call(snap, `credit.${r.id}.limit`)),
    'live revolving Credit accounts each have limit and available keys');
  ok(liveIds.every(id => Object.prototype.hasOwnProperty.call(snap, `credit.${id}.minimum`)
    && Object.prototype.hasOwnProperty.call(snap, `credit.${id}.due`)),
    'live Credit accounts each have minimum and due keys');
  const planIds = (advice.majorPlans || []).map(r => r.id);
  ok(planIds.length >= 1 && planIds.every(id => snap[`planning.${id}.verdict`]),
    `live majorPlans (${planIds.join(', ')}) each have a verdict key`);
  ok(planIds.every(id => Object.prototype.hasOwnProperty.call(snap, `planning.${id}.remaining`)),
    'live majorPlans each have a remaining key');
  const ranges = (advice.majorPlans || []).filter(r => r.need == null && r.amountMin != null && r.amountMax != null);
  ok(ranges.length > 0 && ranges.every(r =>
    same(snap[`planning.${r.id}.amountMin`], round(r.amountMin))
    && same(snap[`planning.${r.id}.amountMax`], round(r.amountMax))),
    `live ranges (${ranges.map(r => r.id).join(', ')}) keep min/max`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
