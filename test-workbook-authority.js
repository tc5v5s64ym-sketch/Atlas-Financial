'use strict';
/* Workbook evidence cannot silently become current owner policy.
 * `node test-workbook-authority.js`
 *
 * The nine Aug. 10 owner-stated targets win. A historical per-paycheque
 * workbook or a My Recommendation section does not replace them without an
 * explicit targetSource transition away from owner-stated-2026-08-10.
 */
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

const OWNER_SOURCE = 'owner-stated-2026-08-10';
const OWNER_TARGETS = {
  groceries: 1800,
  fuel: 1300,
  restaurants: 800,
  shopping: 600,
  subscriptions: 300,
  pets: 110,
  sport: 250,
  household: 150,
  health: 100,
};

// Approximate monthly equivalents from HOME BUDGET.xlsx per-paycheque lines.
// These are historical planning figures. They must not become plannedMonthly
// while targetSource is still the Aug. 10 owner statement.
const HISTORICAL_WORKBOOK_MONTHLY = {
  groceries: 1200,
  fuel: 400,
};

const cats = data.plan.budget.categories;
const byId = id => cats.find(c => c.id === id);
const questions = fs.readFileSync(path.join(__dirname, 'docs', '01_OPEN_QUESTIONS.md'), 'utf8');
const note = data.plan.budget.ownerTargets.note;

console.log('=== Aug. 10 owner targets remain the live policy ===');
for (const [id, amount] of Object.entries(OWNER_TARGETS)) {
  const c = byId(id);
  ok(!!c, `category ${id} exists`);
  ok(c && c.plannedMonthly === amount, `${id} plannedMonthly stays $${amount}`,
    c ? String(c.plannedMonthly) : 'missing');
  ok(c && c.targetSource === OWNER_SOURCE,
    `${id} targetSource remains ${OWNER_SOURCE}`,
    c ? String(c.targetSource) : 'missing');
}

console.log('\n=== historical / advisory workbook values cannot overwrite that policy ===');
ok(byId('groceries').plannedMonthly !== HISTORICAL_WORKBOOK_MONTHLY.groceries,
  'groceries is not the historical workbook ~$1,200/month');
ok(byId('fuel').plannedMonthly !== HISTORICAL_WORKBOOK_MONTHLY.fuel,
  'fuel is not the historical workbook ~$400/month');
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

console.log('\n=== Forecast still reads the Aug. 10 owner targets ===');
const budget = F.budgetBreakdown(data.plan, periods, { paypalPerMonth: data.paypal.perMonth });
const groceries = budget.categories.find(c => c.id === 'groceries');
const fuel = budget.categories.find(c => c.id === 'fuel');
ok(groceries && groceries.target === 1800 && fuel && fuel.target === 1300,
  'engine grocery/fuel targets are still $1,800 and $1,300');
ok(Math.abs((groceries.planned + fuel.planned) - 3100) < 0.01,
  'food+fuel requirement is still $3,100/month');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
