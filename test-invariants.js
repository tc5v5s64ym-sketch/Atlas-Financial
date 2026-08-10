'use strict';
/* Data and authority invariants. `node test-invariants.js`

   ONE FACT, ONE HOME. This file is where that principle is enforced rather
   than merely stated. A contradiction between two parts of the repository is
   a TEST FAILURE, not a warning — a financial plan that disagrees with itself
   is worse than no plan, because it still looks authoritative.

   Every check here exists because the contradiction it tests for was real. */

const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');
const data = require('./data.json');
const periods = require('./public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const plan = data.plan;
const asOf = data.meta.asOf;

console.log('=== cash classification ===');
const cash = plan.startingCash;
const CLASSES = ['spendable', 'operational', 'staging', 'other-liquid', 'restricted'];
const spendableSum = cash.breakdown.reduce((s, b) => s + b.value, 0);
ok(near(spendableSum, cash.amount),
  'spendable household cash equals its component accounts',
  `${money(spendableSum)} = ${money(cash.amount)}`);
ok(cash.breakdown.every(b => b.class === 'spendable'),
  'every account inside the plan opening balance is classified spendable');
ok((cash.heldElsewhere || []).every(h => CLASSES.includes(h.class)),
  'every excluded pot carries a real classification',
  (cash.heldElsewhere || []).map(h => h.class).join(', '));
ok((cash.heldElsewhere || []).every(h => h.class !== 'spendable'),
  'nothing excluded from the plan is labelled spendable');

// Amanda's account is operational, not household money. This is the whole
// reason the plan opens at $79.84 rather than $2,771.69.
const amanda = (cash.heldElsewhere || []).find(h => /DEBT&PAYMENTS/.test(h.label));
ok(amanda && amanda.class === 'operational',
  "Amanda's DEBT&PAYMENTS account is operational / pass-through, not spendable",
  amanda ? money(amanda.value) : 'missing');

// The cash register must still reconcile to the balance sheet: every cash
// account in `assets` appears in exactly one class, and the totals agree.
const cashAccounts = cash.breakdown.concat(cash.heldElsewhere || []);
const registerTotal = cashAccounts.reduce((s, a) => s + a.value, 0);
const assetCashLabels = ['DEBT&PAYMENTS chequing', 'Chequing A', 'Chequing B', 'Savings',
  'SAVINGS-DONT TOUCH', 'Wise (two US spending accounts)'];
const assetCashTotal = data.assets
  .filter(a => assetCashLabels.includes(a.label))
  .reduce((s, a) => s + a.value, 0);
ok(near(registerTotal, assetCashTotal),
  'the cash register reconciles to the cash rows on the balance sheet',
  `${money(registerTotal)} vs ${money(assetCashTotal)}`);
ok(cashAccounts.length === assetCashLabels.length,
  'and covers exactly the same accounts, no more and no fewer',
  `${cashAccounts.length} accounts`);

// The defect this replaced: a headline tile that added all six together.
ok(!data.headline.some(h => /cash on hand/i.test(h.label)),
  'the undifferentiated "Cash on hand" headline is gone',
  'it summed spendable, pass-through, staging and US holiday money as one figure');
ok(/startingCash/.test(read('public/deepdive.js')),
  'the Deep Dive cash tile derives from the plan cash register instead');

console.log('\n=== assets and debts reconcile ===');
const assetTotal = data.assets.reduce((s, a) => s + a.value, 0);
ok(near(assetTotal, data.netWorth.assets),
  'assets sum to the published net-worth asset figure',
  `${money(assetTotal)} vs ${money(data.netWorth.assets)}`);
const debtTotal = data.debts.reduce((s, x) => s + (x.balance || 0), 0);
ok(near(debtTotal, data.netWorth.debts),
  'debts sum to the published net-worth debt figure',
  `${money(debtTotal)} vs ${money(data.netWorth.debts)}`);
const secured = data.debts.filter(x => x.secured).reduce((s, x) => s + x.balance, 0);
const consumer = data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance, 0);
ok(near(secured + consumer, debtTotal),
  'secured plus consumer debt is the whole of it',
  `${money(secured)} + ${money(consumer)}`);
ok(data.debts.every(x => typeof x.secured === 'boolean'),
  'every debt declares whether it is secured');

console.log('\n=== HELOC semantics agree everywhere ===');
const heloc = plan.obligations.find(o => o.id === 'heloc');
ok(heloc && heloc.nonCash === true,
  'the plan marks HELOC interest as a non-cash charge');
const withHeloc = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
const stripped = JSON.parse(JSON.stringify(plan));
stripped.obligations = stripped.obligations.filter(o => !o.nonCash);
const without = F.simulate(stripped, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
ok(near(withHeloc.ending, without.ending),
  'and it therefore moves no cash', `${money(withHeloc.ending)} either way`);
ok(withHeloc.totals.noncash > 0,
  'while still being tracked as a real economic cost', money(withHeloc.totals.noncash));
// The economic cost has to appear on the debt side, or it is being hidden.
ok(/capitalis/i.test(read('docs/ACCOUNT_FACTS.md')),
  'ACCOUNT_FACTS records the capitalisation');
ok(/capitalis/i.test(JSON.stringify(plan.assumptions)),
  'and the plan assumptions say so too');

console.log('\n=== one authority per contested fact ===');
const accountFacts = read('docs/ACCOUNT_FACTS.md');
const master = read('docs/00_MASTER_PICTURE.md');
const dataStr = JSON.stringify(data);

// Amanda's pay cadence. ACCOUNT_FACTS once said both bi-weekly and
// semi-monthly, in the same file, 236 lines apart.
ok(/semi-monthly/i.test(accountFacts),
  'ACCOUNT_FACTS states the semi-monthly cadence');
ok(!/Tennis BC pay is also bi-weekly/i.test(accountFacts),
  'and no longer also claims it is bi-weekly');
ok(!/Seaspan and Tennis BC both land the same day/i.test(dataStr),
  'data.json no longer claims her pay lands on the Seaspan payday');
ok(!/\$?3,507/.test(master),
  'the stale $3,507/month Tennis BC figure is gone from the master picture');

// BC Hydro. Three files disagreed about whether it still had a household route.
ok(!/no current route through chequing:\*\* BC Hydro/i.test(accountFacts),
  'ACCOUNT_FACTS no longer lists BC Hydro as an unknown route');
ok(/moved to Amanda's DEBT&PAYMENTS account in May 2026|moved here in May 2026/i.test(accountFacts),
  'and records that it moved to her account in May 2026');
ok(!/BC Hydro \(absent from chequing since April 2026/i.test(dataStr),
  'the stale HELOC-route claim is gone from the plan assumptions');
ok(!/They ride inside the variable budget's averages instead/.test(dataStr),
  'and BC Hydro is no longer said to ride inside the household variable budget');
ok(!/summary: 'BC Hydro/.test(read('scripts/calendar-ics.js')),
  'the household calendar no longer emits a BC Hydro reminder');

console.log('\n=== no financial event appears twice ===');
const window = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
const keys = new Map();
for (const e of window.events) keys.set(e.id + '@' + e.date, (keys.get(e.id + '@' + e.date) || 0) + 1);
const duplicated = [...keys].filter(([, n]) => n > 1);
ok(duplicated.length === 0, 'every scheduled event is unique on (id, date)',
  duplicated.length ? duplicated.map(([k]) => k).join(', ') : `${keys.size} events`);

const ids = plan.income.concat(plan.obligations, plan.bills || [], plan.commitments).map(x => x.id);
ok(new Set(ids).size === ids.length, 'every plan item has a unique id', `${ids.length} items`);

// A dated bill must not also be inside the variable budget for its category.
const budget = F.budgetBreakdown(plan, periods, { paypalPerMonth: data.paypal.perMonth });
const catIds = new Set(plan.budget.categories.map(c => c.id));
for (const b of (plan.bills || [])) {
  ok(b.budgetCategory === null || catIds.has(b.budgetCategory),
    `bill "${b.id}" resolves to a real budget category or explicitly to none`);
}
for (const c of budget.categories) {
  ok(c.planned <= c.historical + 0.01 || c.target != null,
    `category "${c.id}" never carries more than it has historically cost`,
    `${money(c.planned)} of ${money(c.historical)}`);
}

console.log('\n=== the plan derives from canonical state ===');
const advice = F.recommend(plan, asOf, {
  scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: plan.defaults.targetBuffer,
});
ok(advice.sim.daily[0] !== undefined && near(
  advice.zero.daily[0].balance + 0, plan.startingCash.amount),
  'the forecast opens on the cash register, not a typed-in number',
  money(plan.startingCash.amount));
// The page must not be able to show a different weekly figure from the engine.
const planJs = read('public/plan.js');
ok(/Forecast\.recommend\(/.test(planJs),
  'the Plan page calls the single recommendation authority');
ok(!/recommendWeekly\(/.test(planJs),
  'and does not solve the budget a second time by itself');
ok(!/postGapWeekly|shifted\.startingCash/.test(planJs),
  'the DOM-level re-slicing that double-counted the first payday is gone');

console.log('\n=== confidence, provenance and freshness ===');
const planItems = plan.income.concat(plan.obligations, plan.bills || [], plan.commitments);
const missingConfidence = planItems.filter(x => !x.confidence);
ok(missingConfidence.length === 0, 'every planning input carries a confidence tag',
  missingConfidence.map(x => x.id).join(', ') || `${planItems.length} items`);
ok(planItems.every(x => ['confirmed', 'estimated', 'planned'].includes(x.confidence)),
  'and the tags come from a closed vocabulary');
ok(/^\d{4}-\d{2}-\d{2}$/.test(data.meta.asOf), 'the as-of date is a real date', data.meta.asOf);
ok(periods.asOf === data.meta.asOf,
  'the generated spending history is as-of the same day as the plan',
  `${periods.asOf} vs ${data.meta.asOf}`);
ok(plan.budget.ownerTargets && plan.budget.ownerTargets.status,
  'the budget records whether an owner target exists',
  plan.budget.ownerTargets.status);

console.log('\n=== stale publication fails validation ===');
// The generated file must not be older than the hand-edited one, and must not
// be empty — a dashboard of $0.00s once shipped that way.
ok(periods.periods && Object.keys(periods.periods).length >= 3,
  'periods.json carries its period lenses', Object.keys(periods.periods).join(', '));
ok(periods.periods.ytd.spendingTotal > 0,
  'and real spending totals, not zeros', money(periods.periods.ytd.spendingTotal));
ok((periods.monthly || []).length > 0, 'and a monthly series', `${periods.monthly.length} months`);

// Every data.json key must be read by some page, or it is dead weight that
// will drift out of date unnoticed.
const allScripts = ['app', 'forecast', 'plan', 'modellers', 'deepdive', 'records']
  .map(f => read('public/' + f + '.js')).join('\n');
const orphans = Object.keys(data).filter(k => !new RegExp('\\.' + k + '\\b').test(allScripts));
ok(orphans.length === 0, 'no orphaned data.json keys', orphans.join(', ') || 'all keys rendered');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
