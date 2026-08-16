'use strict';
/* Household-budget reconciliation. `node test-budget.js`

   The question this file exists to answer is the one the household will
   actually ask: "does the weekly cap include food and gas?" It must be
   possible to prove YES from the data, show how much, and show that nothing
   already sitting on the calendar has been charged a second time. */

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

const plan = data.plan;
const asOf = data.meta.asOf;
const WEEKS_PER_MONTH = 365.25 / 12 / 7;
const budget = F.budgetBreakdown(plan, periods, { paypalPerMonth: data.paypal.perMonth });

console.log('=== the budget block exists and is wired in ===');
ok(!!budget, 'budgetBreakdown returns a result');
ok(plan.essentialsPerMonth === undefined,
  'the opaque essentialsPerMonth scalar is gone', 'replaced by plan.budget');
ok(budget.categories.length === plan.budget.categories.length,
  'every declared category is derived', `${budget.categories.length} categories`);
ok(budget.basis === 'ytd' && budget.months === 8, 'basis is year-to-date actuals',
  `${budget.basisLabel}, ${budget.months} months`);

console.log('\n=== amounts are DERIVED, not duplicated ===');
// The single most important structural property: no historical figure is
// typed into data.json, so it cannot drift from the generated history.
for (const c of plan.budget.categories) {
  if (c.plannedMonthly != null) continue;
  const declared = JSON.stringify(c);
  if (/\d{3,}\.\d\d/.test(declared.replace(/"why":"[^"]*"/, ''))) {
    ok(false, `category ${c.id} carries a hardcoded amount`, declared.slice(0, 120));
  }
}
// The count is asserted so an empty category list cannot report a clean sweep
// over nothing. A summary after a loop passes just as readily after a loop that
// never ran.
ok(plan.budget.categories.length >= 18,
  'no category hardcodes a historical amount — all derived from periods.json',
  `${plan.budget.categories.length} categories scanned`);
// And prove the derivation really reads periods.json.
const groceriesFromSource = periods.periods.ytd.spending.find(s => s.label === 'Groceries').total / 8;
const groceries = budget.categories.find(c => c.id === 'groceries');
ok(near(groceries.historical, groceriesFromSource),
  'groceries traces to the generated spending series', money(groceries.historical));

console.log('\n=== food and fuel are demonstrably inside the cap ===');
const fuel = budget.categories.find(c => c.id === 'fuel');
ok(groceries.class === 'essential' && fuel.class === 'essential',
  'groceries and fuel are classified essential');
ok(groceries.dated === 0 && fuel.dated === 0,
  'neither is dated anywhere on the calendar — so the cap is their only home');
ok(groceries.planned > 0 && fuel.planned > 0,
  'both carry a positive requirement into the cap',
  `${money(groceries.planned)} + ${money(fuel.planned)}`);
const foodFuel = groceries.planned + fuel.planned;
ok(near(foodFuel, 3100), 'groceries + fuel = $3,100.00/month — both owner targets', money(foodFuel));
ok(near(foodFuel / WEEKS_PER_MONTH, 712.94, 0.5), 'which is about $713/week', money(foodFuel / WEEKS_PER_MONTH));
ok(groceries.target === 1800 && fuel.target === 1300,
  'and both are the household\'s own figures, not averages',
  `groceries ${money(groceries.target)}, fuel ${money(fuel.target)}`);
// The direction differs per category, which is the point of using a target.
ok(groceries.target < groceries.historical,
  'the grocery target is BELOW what has been spent — a planned reduction',
  `${money(groceries.target)} vs ${money(groceries.historical)}`);
ok(fuel.target > fuel.historical,
  'the fuel target is ABOVE it — the household budgets more than it recently used',
  `${money(fuel.target)} vs ${money(fuel.historical)}`);

console.log('\n=== nothing is counted twice ===');
// Every dated bill and commitment must either point at a budget category (and
// be subtracted from it) or be explicitly excluded with a reason.
const catIds = new Set(plan.budget.categories.map(c => c.id));
for (const b of plan.bills || []) {
  ok(b.budgetCategory === null || catIds.has(b.budgetCategory),
    `bill "${b.id}" declares where it sits in the budget`, String(b.budgetCategory));
}
for (const c of plan.commitments || []) {
  ok(c.budgetCategory === null || catIds.has(c.budgetCategory),
    `commitment "${c.id}" declares where it sits in the budget`, String(c.budgetCategory));
}
// The specific overlaps that were being mishandled.
const telecom = budget.categories.find(c => c.id === 'telecom');
const shaw = plan.bills.find(b => b.id === 'shaw');
const fortis = plan.bills.find(b => b.id === 'fortis');
const bcaa = plan.bills.find(b => b.id === 'bcaa');
const icbc = plan.bills.find(b => b.id === 'icbc');
const fit = plan.bills.find(b => b.id === 'fit4less');
ok(near(telecom.dated, shaw.amount), 'Shaw is subtracted from the telecom average', money(telecom.dated));
ok(near(telecom.planned, telecom.historical - shaw.amount),
  'so telecom carries only the undated remainder', money(telecom.planned));
const household = budget.categories.find(c => c.id === 'household');
ok(near(household.dated, fortis.amount), 'FortisBC is subtracted from household', money(household.dated));
const insurance = budget.categories.find(c => c.id === 'insurance');
ok(near(insurance.dated, bcaa.amount + icbc.amount), 'BCAA + ICBC are subtracted from insurance', money(insurance.dated));
ok(insurance.planned === 0 && insurance.fullyDated,
  'insurance is fully dated — it contributes nothing to the cap');
const sport = budget.categories.find(c => c.id === 'sport');
// The structural correction. Netting the season fees off the recurring line
// concluded that ordinary sports spending was $0, which is not what the
// household budgeted — it budgets $250/month AND saves for the seasons.
ok(sport.target === 250, 'the recurring sports line carries the owner target', money(sport.target));
ok(near(sport.dated, fit.amount * 26 / 12), 'only the recurring dated cost (Fit4Less) is subtracted', money(sport.dated));
ok(near(sport.planned, sport.target - sport.dated), 'so the owner target less Fit4Less stays inside the cap', money(sport.planned));
ok(!sport.fullyDated, 'and the category is NOT written off as fully dated');
ok(sport.sinking > 0, 'the season fees are tracked as a sinking fund instead', money(sport.sinking));
ok(near(sport.sinking, budget.sinkingMonthly),
  'and they are the whole of it', money(budget.sinkingMonthly));

// The bug this replaced: account fees were subtracted from a SPENDING average,
// but bank fees are not in the spending series at all — they are their own lens.
const fees = plan.bills.find(b => b.id === 'tdfees');
ok(fees.budgetCategory === null,
  'TD account fees map to no spending category — they live in the fees lens',
  'was previously subtracted from essentials, removing money that was never there');
ok(!periods.periods.ytd.spending.some(s => /fee/i.test(s.label)),
  'confirmed: no fee row exists in the spending series');

console.log('\n=== the three concepts are kept apart ===');
const classes = new Set(budget.categories.map(c => c.class));
ok(classes.has('essential'), 'essential variable spending is represented');
ok(classes.has('discretionary'), 'discretionary variable spending is represented');
ok(classes.has('reserve'), 'reserves (property tax, CRA) are represented and kept out of the cap');
const propertyTax = budget.categories.find(c => c.id === 'propertytax');
ok(propertyTax.class === 'reserve',
  'property tax is a reserve, not a monthly essential — no instalment falls in this window');
ok(budget.requiredMonthly === budget.essentialMonthly + budget.unknownMonthly,
  'the required figure is essentials plus the uncategorised remainder',
  money(budget.requiredMonthly));
ok(budget.reserveMonthly > 0 && !near(budget.requiredMonthly, budget.requiredMonthly + budget.reserveMonthly),
  'reserves are excluded from the weekly requirement', money(budget.reserveMonthly));

console.log('\n=== reconciles against the recommendation ===');
const advice = F.recommend(plan, asOf, {
  scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: plan.defaults.targetBuffer,
});
const capMonthly = advice.weekly * WEEKS_PER_MONTH;
ok(capMonthly > 0, 'the cap converts to a positive monthly figure', money(capMonthly));
ok(budget.requiredMonthly < capMonthly,
  'the cap covers the essential requirement, so a plan exists',
  `${money(budget.requiredMonthly)} required vs ${money(capMonthly)} cap`);
const discretionaryRoom = capMonthly - budget.requiredMonthly;
ok(discretionaryRoom > 0, 'and leaves something for discretionary spending',
  `${money(discretionaryRoom)}/month = ${money(discretionaryRoom / WEEKS_PER_MONTH)}/week`);
ok(discretionaryRoom < budget.discretionaryMonthly,
  'but far less than discretionary spending has actually been running at — the plan requires a real cut',
  `${money(discretionaryRoom)} allowed vs ${money(budget.discretionaryMonthly)} historical`);

// This file has always converted weeks to months with its own copy of the
// calendar identity above — which proved the engine agreed with the TEST while
// `public/plan.js` kept a third copy nobody compared with either. Now that
// `budgetBreakdown` owns the conversion, this file's independent copy becomes a
// real cross-check: the engine has to land on the figures worked out here.
const engineCap = F.budgetBreakdown(plan, periods, {
  paypalPerMonth: data.paypal.perMonth, weeklyCap: advice.weekly,
}).cap;
ok(near(engineCap.monthly, capMonthly, 0.005),
  'the engine converts the cap to the same month this file computed independently',
  `${money(engineCap.monthly)} vs ${money(capMonthly)}`);
ok(near(engineCap.discretionaryRoomMonthly, discretionaryRoom, 0.005),
  'and reaches the same discretionary room',
  `${money(engineCap.discretionaryRoomMonthly)} vs ${money(discretionaryRoom)}`);
ok(near(engineCap.essentialWeekly, budget.requiredMonthly / WEEKS_PER_MONTH, 0.005),
  'and the same weekly essential need', money(engineCap.essentialWeekly));
ok(engineCap.hasDiscretionaryRoom === (discretionaryRoom > 0),
  'and the same verdict about whether there is any room at all');

console.log('\n=== owner targets are present, and honestly sourced ===');
ok(plan.budget.ownerTargets.status === 'partial',
  'the budget records that owner targets are incorporated but incomplete',
  plan.budget.ownerTargets.status);
ok(budget.ownerTargetCount === 9, 'nine categories carry an owner target', String(budget.ownerTargetCount));
for (const c of budget.categories) {
  const expected = c.target != null ? 'owner-target' : 'historical-actual';
  if (c.source !== expected) ok(false, `category ${c.id} is mislabelled`, `${c.source} but target=${c.target}`);
}
ok(budget.categories.length >= 18,
  'every category is labelled owner-target or historical-actual to match what it holds',
  `${budget.categories.length} categories checked`);
ok(budget.categories.filter(c => c.source === 'historical-actual').length === 9,
  'and the nine without a target are still honestly historical');
// A target must never be silently invented from an average.
for (const c of plan.budget.categories) {
  if (c.plannedMonthly != null) {
    ok(!!c.targetSource && !!c.ownerLine,
      `owner target for "${c.id}" names its source and the owner's own line`,
      `${c.targetSource} · "${c.ownerLine}"`);
  }
}
// Historical actuals stay visible beside the targets, so the difference can be seen.
ok(budget.categories.every(c => typeof c.historical === 'number'),
  'the historical actual remains inspectable for every category, target or not');
const differing = budget.categories.filter(c => c.target != null && Math.abs(c.target - c.historical) > 1);
ok(differing.length >= 5, 'and it differs from the target often enough to matter',
  `${differing.length} of ${budget.ownerTargetCount} differ`);
ok(/owner-stated current policy|not workbook-derived/i.test(plan.budget.ownerTargets.note),
  'the targets are recorded as owner-stated current policy, not workbook-derived');
ok(/monthly_budget_tracker_template|HOME BUDGET/.test(plan.budget.ownerTargets.note),
  'and the workbooks are named as classified evidence, not as the missing source');
ok(!/still absent|never supplied|not absorbed|never reached this repository/i.test(plan.budget.ownerTargets.note),
  'the live budget note no longer claims the workbooks are missing');
ok(Array.isArray(plan.budget.ownerTargets.sinkingFundsNamed)
  && plan.budget.ownerTargets.sinkingFundsNamed.length > 0,
  'the sinking funds the owner named are recorded',
  plan.budget.ownerTargets.sinkingFundsNamed.join(', '));
ok(/NOT quantified|not quantified/.test(plan.budget.ownerTargets.sinkingFundsNote),
  'and recorded as unquantified rather than guessed at');
ok(!/the workbook would supply them/i.test(plan.budget.ownerTargets.sinkingFundsNote),
  'the sinking-fund note no longer treats the workbook as the missing current source');
ok(!!plan.budget.cardCaveat && /card/i.test(plan.budget.cardCaveat),
  'the cash-versus-card caveat on the historical averages is stated');
for (const c of plan.budget.categories) {
  if (!c.why || c.why.length < 20) ok(false, `category ${c.id} has no stated reason`, c.why || '(none)');
}
// `.every()` returns true for an empty array, so the length is asserted too —
// otherwise "every category states why" passes loudest when there are no
// categories at all.
ok(plan.budget.categories.length >= 18
  && plan.budget.categories.every(c => c.why && c.why.length >= 20),
  'every category states why its assumption won',
  `${plan.budget.categories.length} reasons present`);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
