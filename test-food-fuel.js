'use strict';
/* Focused proof for the Plan page's remaining food-and-fuel monthly figures.
 * Forecast.budgetBreakdown's cap block already owned the weekly pair
 * (planned/historical groceries+fuel). The page still found the two
 * categories and printed `target || historical` for each. That fallback
 * is a financial choice, and until this move no test could reach it.
 *
 * Before the move, replacing `food.target || food.historical` with
 * `food.historical` left npm test green — ALL 20 SUITES PASSED.
 */
const fs = require('fs');
const vm = require('vm');
const F = require('./public/forecast.js');
const data = require('./data.json');
const periods = require('./public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const same = (a, b) => a === b;
const read = p => fs.readFileSync(p, 'utf8');

/* Independent fixture. Owner targets beat the historical averages.
 *
 *   Groceries  plannedMonthly $1,200   historical $11,000 / 10 = $1,100
 *   Fuel       plannedMonthly   $800   historical  $6,000 / 10 =   $600
 *
 *   published monthly groceries = $1,200  (target, not $1,100)
 *   published monthly fuel      =   $800  (target, not $600)
 */
const FIXTURE_PLAN = {
  windowDays: 91,
  budget: {
    basis: 'ytd',
    categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedMonthly: 1200 },
      { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedMonthly: 800 },
      { id: 'dining', label: 'Dining', class: 'discretionary', from: ['Dining'], plannedMonthly: 400 },
    ],
  },
};
const FIXTURE_PERIODS = {
  periods: {
    ytd: {
      label: 'Year to date', months: 10,
      spending: [
        { label: 'Groceries', total: 11000 },
        { label: 'Fuel', total: 6000 },
        { label: 'Dining', total: 5000 },
      ],
    },
  },
};
const HAND_GROCERIES_HIST = 11000 / 10;
const HAND_FUEL_HIST = 6000 / 10;
const HAND_GROCERIES_MONTHLY = 1200;
const HAND_FUEL_MONTHLY = 800;

const capOf = (plan, extra) => F.budgetBreakdown(plan, FIXTURE_PERIODS,
  Object.assign({ weeklyCap: 600 }, extra || {})).cap;

console.log('=== hand-computed monthly grocery and fuel figures ===');
ok(HAND_GROCERIES_HIST === 1100 && HAND_FUEL_HIST === 600,
  'historical averages are $11,000/10 and $6,000/10');
ok(HAND_GROCERIES_MONTHLY !== HAND_GROCERIES_HIST
  && HAND_FUEL_MONTHLY !== HAND_FUEL_HIST,
  'the owner targets are not the historical averages — the fallback is load-bearing');

const cap = capOf(FIXTURE_PLAN);
ok(!!cap, 'a cap result is returned');
ok(cap && same(cap.groceriesMonthly, HAND_GROCERIES_MONTHLY),
  'groceries monthly is the $1,200 owner target, not $1,100 historical',
  cap ? String(cap.groceriesMonthly) : 'none');
ok(cap && same(cap.fuelMonthly, HAND_FUEL_MONTHLY),
  'fuel monthly is the $800 owner target, not $600 historical',
  cap ? String(cap.fuelMonthly) : 'none');
ok(cap && cap.groceriesHasOwnerTarget === true,
  'and the grocery line is flagged as an owner target');

console.log('\n=== fallback: no owner target uses the historical average ===');
const noTargetPlan = {
  windowDays: 91,
  budget: {
    basis: 'ytd',
    categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedMonthly: null },
      { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'] },
    ],
  },
};
const none = capOf(noTargetPlan);
ok(none && same(none.groceriesMonthly, HAND_GROCERIES_HIST)
  && same(none.fuelMonthly, HAND_FUEL_HIST)
  && none.groceriesHasOwnerTarget === false,
  'missing targets print $1,100 and $600 historical, with no owner-target chip');

console.log('\n=== a $0 owner target is a figure, not a missing one ===');
/* The page used `target || historical`. A household that budgets $0 for
 * groceries would have published the historical average instead. */
const zeroPlan = {
  windowDays: 91,
  budget: {
    basis: 'ytd',
    categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedMonthly: 0 },
      { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedMonthly: 800 },
    ],
  },
};
const zero = capOf(zeroPlan);
ok(zero && same(zero.groceriesMonthly, 0) && zero.groceriesHasOwnerTarget === true,
  'a $0 grocery target publishes $0, not the $1,100 historical',
  zero ? String(zero.groceriesMonthly) : 'none');
ok((0 || HAND_GROCERIES_HIST) === HAND_GROCERIES_HIST,
  'confirming `||` would have fallen through to historical');

console.log('\n=== live plan: owner-target literals, not the averages ===');
const LIVE_GROCERIES = 1800;
const LIVE_FUEL = 1300;
const LIVE_GROCERIES_HIST = 14717.26 / 8;
const LIVE_FUEL_HIST = 7913.03 / 8;
ok(data.plan.budget.categories.find(c => c.id === 'groceries').plannedMonthly === LIVE_GROCERIES,
  'data.json grocery target is $1,800');
ok(data.plan.budget.categories.find(c => c.id === 'fuel').plannedMonthly === LIVE_FUEL,
  'data.json fuel target is $1,300');
ok(periods.periods.ytd.months === 8
  && periods.periods.ytd.spending.find(s => s.label === 'Groceries').total === 14717.26
  && periods.periods.ytd.spending.find(s => s.label === 'Fuel & transport').total === 7913.03,
  'ytd grocery/fuel totals are $14,717.26 and $7,913.03 over 8 months');
ok(LIVE_GROCERIES !== LIVE_GROCERIES_HIST && LIVE_FUEL !== LIVE_FUEL_HIST,
  'those averages are $1,839.66 and $989.13 — not the published monthly figures');

const liveAdv = F.recommend(data.plan, data.meta.asOf, {
  scenario: data.plan.defaults.scenario, targetBuffer: data.plan.defaults.targetBuffer,
  extraDebtMonthly: 0, incomeOverrides: {}, disabled: [], debts: data.debts,
  extraDebtTarget: data.plan.nextDollar.target, fundingSources: data.plan.funding.options,
});
const live = F.budgetBreakdown(data.plan, periods, {
  paypalPerMonth: data.paypal.perMonth, disabled: [],
  weeklyCap: liveAdv.weekly, recommendedWeekly: liveAdv.weekly,
}).cap;
ok(live && same(live.groceriesMonthly, LIVE_GROCERIES)
  && same(live.fuelMonthly, LIVE_FUEL)
  && live.groceriesHasOwnerTarget === true,
  'live Plan sentence is $1,800 groceries and $1,300 fuel, both owner targets',
  live ? `${live.groceriesMonthly} / ${live.fuelMonthly}` : 'none');
ok(live && same(live.foodFuelPlannedMonthly, LIVE_GROCERIES + LIVE_FUEL),
  'and the already-owned weekly pair still sums those same two planned months',
  live ? String(live.foodFuelPlannedMonthly) : 'none');

console.log('\n=== page is a renderer ===');
const page = read('public/plan.js');
const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
ok(/cap\.groceriesMonthly/.test(page) && /cap\.fuelMonthly/.test(page),
  'the Plan page reads the monthly figures from the cap block');
ok(/cap\.groceriesHasOwnerTarget/.test(page),
  'and the owner-budget chip from the returned flag');
ok(!/id === 'groceries'/.test(pageCode) && !/id === 'fuel'/.test(pageCode),
  'the page no longer selects the grocery or fuel category');
ok(!/target\s*\|\|\s*\w*\.?historical/.test(pageCode),
  'the page no longer chooses target || historical');

console.log('\n=== mutation: dropping the grocery owner target now fails ===');
const FORECAST_SRC = read('public/forecast.js');
const FROM = '    const groceriesMonthly = groceries.target != null ? groceries.target : groceries.historical;';
const TO = '    const groceriesMonthly = groceries.historical;';
ok(FORECAST_SRC.split(FROM).length - 1 === 1,
  'the grocery monthly choice appears once in the engine, so the mutation is aimed');
const sandbox = { module: { exports: {} } };
try {
  vm.runInNewContext(FORECAST_SRC.replace(FROM, TO), sandbox, { filename: 'forecast-mutant.js' });
} catch (e) {
  ok(false, 'mutant engine loads', e.message);
}
const mutant = sandbox.module.exports;
const broken = mutant && mutant.budgetBreakdown(FIXTURE_PLAN, FIXTURE_PERIODS, { weeklyCap: 600 }).cap;
ok(mutant && broken && same(broken.groceriesMonthly, HAND_GROCERIES_HIST)
  && !same(broken.groceriesMonthly, HAND_GROCERIES_MONTHLY),
  'dropping the owner target publishes $1,100 historical instead of $1,200',
  broken ? String(broken.groceriesMonthly) : 'mutant missing');
ok(cap && same(cap.groceriesMonthly, HAND_GROCERIES_MONTHLY),
  'the real engine still answers the hand-computed $1,200 on the same fixture');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
