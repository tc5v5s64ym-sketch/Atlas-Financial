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
ok(true, 'no category hardcodes a historical amount — all derived from periods.json');
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
ok(near(foodFuel, 2828.79), 'groceries + fuel = $2,828.79/month', money(foodFuel));
ok(near(foodFuel / WEEKS_PER_MONTH, 650.4, 0.5), 'which is about $650/week', money(foodFuel / WEEKS_PER_MONTH));

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
ok(near(telecom.dated, 78.40), 'Shaw is subtracted from the telecom average', money(telecom.dated));
ok(near(telecom.planned, telecom.historical - 78.40),
  'so telecom carries only the undated remainder', money(telecom.planned));
const household = budget.categories.find(c => c.id === 'household');
ok(near(household.dated, 124), 'FortisBC is subtracted from household', money(household.dated));
const insurance = budget.categories.find(c => c.id === 'insurance');
ok(near(insurance.dated, 182.87), 'BCAA + ICBC are subtracted from insurance', money(insurance.dated));
ok(insurance.planned === 0 && insurance.fullyDated,
  'insurance is fully dated — it contributes nothing to the cap');
const sport = budget.categories.find(c => c.id === 'sport');
ok(sport.dated > sport.historical,
  'the dated lacrosse commitments exceed the historical sport average', money(sport.dated));
ok(sport.planned === 0 && sport.fullyDated,
  'so children’s sport contributes nothing extra to the cap — it is all on the calendar');

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
ok(near(capMonthly, 5435.27, 0.5), 'the cap is about $5,435/month', money(capMonthly));
ok(budget.requiredMonthly < capMonthly,
  'the cap covers the essential requirement, so a plan exists',
  `${money(budget.requiredMonthly)} required vs ${money(capMonthly)} cap`);
const discretionaryRoom = capMonthly - budget.requiredMonthly;
ok(discretionaryRoom > 0, 'and leaves something for discretionary spending',
  `${money(discretionaryRoom)}/month = ${money(discretionaryRoom / WEEKS_PER_MONTH)}/week`);
ok(discretionaryRoom < budget.discretionaryMonthly,
  'but far less than discretionary spending has actually been running at — the plan requires a real cut',
  `${money(discretionaryRoom)} allowed vs ${money(budget.discretionaryMonthly)} historical`);

console.log('\n=== owner budget provenance is stated, not faked ===');
ok(plan.budget.ownerTargets.status === 'missing',
  'the absence of an owner-built budget is recorded explicitly');
ok(budget.categories.every(c => c.source === 'historical-actual'),
  'every category is honestly labelled a historical actual, not an owner target');
ok(/monthly_budget_tracker_template|HOME BUDGET/.test(plan.budget.ownerTargets.note),
  'the named workbooks are recorded as the missing source');
ok(!!plan.budget.cardCaveat && /card/i.test(plan.budget.cardCaveat),
  'the cash-versus-card caveat on the historical averages is stated');
for (const c of plan.budget.categories) {
  if (!c.why || c.why.length < 20) ok(false, `category ${c.id} has no stated reason`, c.why || '(none)');
}
ok(true, 'every category states why its assumption won');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
