'use strict';
/* Workbook evidence cannot silently become current owner policy.
 * `node test/test-workbook-authority.js`
 *
 * The 2026-08-31 owner-locked period table wins. A historical per-paycheque
 * workbook or a My Recommendation section does not replace them without an
 * explicit targetSource transition away from owner-stated-2026-08-31.
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const data = require('../data.json');
const periods = require('../public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const OWNER_SOURCE = 'owner-stated-2026-08-31';
const OWNER_PAYDAY_TARGETS = {
  fuel: 325,
  household: 37.5,
  restaurants: 200,
  'dale-guilt-free': 150,
  'amanda-guilt-free': 150,
};
const GROCERY_WEEKLY = 450;
const DOG_FOOD_PAYDAY = 100;
const RETIRED_HOLD_IDS = ['health', 'sport', 'shopping', 'subscriptions'];

// Approximate monthly equivalents from HOME BUDGET.xlsx per-paycheque lines.
// These are historical planning figures. They must not become plannedMonthly
// while targetSource is still the Aug. 10 owner statement.
const HISTORICAL_WORKBOOK_MONTHLY = {
  groceries: 1200,
  fuel: 400,
};

const cats = data.plan.budget.categories;
const byId = id => cats.find(c => c.id === id);
const questions = fs.readFileSync(path.join(__dirname, '..', 'docs', '01_OPEN_QUESTIONS.md'), 'utf8');
const note = data.plan.budget.ownerTargets.note;

console.log('=== 2026-08-31 owner period table is the live policy ===');
for (const [id, amount] of Object.entries(OWNER_PAYDAY_TARGETS)) {
  const c = byId(id);
  ok(!!c, `category ${id} exists`);
  ok(c && c.plannedPayday === amount && c.plannedMonthly == null,
    `${id} plannedPayday stays $${amount}, not a plannedMonthly half-month encoding`,
    c ? `${c.plannedPayday} / ${c.plannedMonthly}` : 'missing');
  ok(c && c.targetSource === OWNER_SOURCE,
    `${id} targetSource remains ${OWNER_SOURCE}`,
    c ? String(c.targetSource) : 'missing');
}
{
  const g = byId('groceries');
  ok(g && g.plannedWeekly === GROCERY_WEEKLY && g.plannedMonthly == null,
    'groceries owner target is plannedWeekly 450, not plannedMonthly 900',
    g ? `${g.plannedWeekly} / ${g.plannedMonthly}` : 'missing');
  ok(g && g.targetSource === OWNER_SOURCE,
    'groceries targetSource remains owner-stated-2026-08-31');
}
{
  const p = byId('pets');
  ok(p && p.plannedPayday === DOG_FOOD_PAYDAY && p.plannedMonthly == null,
    'dog food owner target is plannedPayday 100, not plannedMonthly 55',
    p ? `${p.plannedPayday} / ${p.plannedMonthly}` : 'missing');
  ok(p && p.paydayCadence === 'first-seaspan-of-month',
    'dog food paydayCadence is first-seaspan-of-month',
    p ? String(p.paydayCadence) : 'missing');
  ok(p && p.targetSource === OWNER_SOURCE,
    'pets targetSource remains owner-stated-2026-08-31');
  ok(p && /cadence restated by owner 2026-09-04/.test(p.why || ''),
    'pets why records the cadence restatement on the household-financial date 2026-09-04',
    p ? String(p.why) : 'missing');
  ok(p && !/cadence restated by owner 2026-09-05/.test(p.why || ''),
    'pets why does not advance that restatement to the UTC date 2026-09-05');
}
for (const id of RETIRED_HOLD_IDS) {
  const c = byId(id);
  ok(!!c, `retired mapping category ${id} still exists`);
  ok(c && c.plannedMonthly == null, `${id} has no household-budget plannedMonthly`,
    c ? String(c.plannedMonthly) : 'missing');
}

console.log('\n=== historical / advisory workbook values cannot overwrite that policy ===');
ok(byId('groceries').plannedWeekly === GROCERY_WEEKLY
  && byId('groceries').plannedMonthly !== HISTORICAL_WORKBOOK_MONTHLY.groceries,
  'groceries is $450/week, not the historical workbook ~$1,200/month');
ok(byId('fuel').plannedPayday === OWNER_PAYDAY_TARGETS.fuel
  && byId('fuel').plannedMonthly !== HISTORICAL_WORKBOOK_MONTHLY.fuel,
  'fuel is $325/payday, not the historical workbook ~$400/month');
for (const c of cats) {
  if (c.plannedMonthly == null) continue;
  const src = String(c.targetSource || '');
  ok(!/workbook|recommendation|monthly_budget_tracker|home budget/i.test(src),
    `${c.id} is not sourced from a workbook or recommendation`, src || '(none)');
}
ok(!/My Recommendation/.test(JSON.stringify(cats.map(c => c.targetSource))),
  'no category names My Recommendation as its authority');

console.log('\n=== Q0 / live notes no longer claim the workbooks are missing ===');
ok(/### Q0\.[^\n]*\n\*\*Status:\*\*\s*ANSWERED/.test(questions),
  'canonical Q0 is ANSWERED');
ok(!/### Q0\.[\s\S]*?\*\*Status:\*\*\s*OPEN/.test(questions),
  'canonical Q0 is not still OPEN');
ok(!/still absent|never supplied|never reached this repository|still not absorbed/i.test(note),
  'ownerTargets.note does not claim the workbooks are missing');
ok(/classified/.test(note) && /HOUSEHOLD_BUDGET_WORKBOOKS_2026-08-16/.test(note),
  'ownerTargets.note points at the classification record');

console.log('\n=== Forecast still reads the 2026-08-31 owner targets ===');
const budget = F.budgetBreakdown(data.plan, periods, { paypalPerMonth: data.paypal.perMonth });
const groceries = budget.categories.find(c => c.id === 'groceries');
const fuel = budget.categories.find(c => c.id === 'fuel');
const groceryMonthly = Math.round(450 * (365.25 / 12) / 7 * 100) / 100;
const fuelMonthly = Math.round(325 * (365.25 / 12) / 14 * 100) / 100;
const pets = budget.categories.find(c => c.id === 'pets');
const petsSmeared = Math.round(100 * (365.25 / 12) / 14 * 100) / 100;
ok(groceries && Math.abs(groceries.target - groceryMonthly) < 0.01
  && fuel && Math.abs(fuel.target - fuelMonthly) < 0.01 && fuel.target !== 650,
  'engine grocery target is weekly 450 converted to calendar-month monthly; fuel is payday 325 annualized');
ok(pets && Math.abs(pets.target - 100) < 0.01 && Math.abs(pets.target - petsSmeared) > 1,
  'engine dog-food target is $100/month, not $100 annualized over 26 Seaspan cycles',
  pets ? String(pets.target) : 'missing');
ok(Math.abs((groceries.planned + fuel.planned) - (groceryMonthly + fuelMonthly)) < 0.01,
  'food+fuel requirement is grocery weekly-equivalent plus payday-annualized fuel');
ok(Math.abs(325 * (365.25 / 14) - 12 * (325 * (365.25 / 12) / 14)) < 1e-9,
  'independent: fuel payday cycles and 12 calendar months are the same annual amount');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
