'use strict';
// Canonical pay-period Balance After Deductions.
// Expected cents below are the owner's Budget identity (income − assigned
// bills − Household Budget) and the October close-month sum of those
// results. They are not read back out of the helper to invent the expectation.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast');

const ROOT = path.join(__dirname, '..');
const data = require('../data.json');
const periods = require('../public/periods.json');
const asOf = data.meta.asOf;
const ALLOWANCE = 400;

let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function cents(n) {
  return Math.round(Number(n) * 100);
}
function handBad(income, bills, hold) {
  return Math.round((Number(income) - Number(bills) - Number(hold)) * 100) / 100;
}

const opts = {
  periods,
  debts: data.debts,
  extraFacilities: data.revolvingExtra,
};
const rec = F.recommend(data.plan, asOf, opts);
const traj = F.baselineTrajectory(data.plan, data.debts, asOf, opts);
assert.equal(traj.status, 'ready');

const budgetPeriods = (rec.defaultView && rec.defaultView.calendarPeriods) || [];
const active = budgetPeriods.find(p => p.role === 'active');
const next = budgetPeriods.find(p => p.id === 'next-pay-period');
eq(!!active && !!next, true, 'Budget still publishes the current and next pay periods');

function pictureFor(start) {
  return (traj.payPeriods || []).find(p => (p.cycleStart || p.payday) === start);
}

for (const period of [active, next]) {
  const hand = handBad(period.incomeTotal, period.periodBillLoad, period.budgetHold);
  const viaHelper = F.balanceAfterDeductionsAmount(
    period.incomeTotal, period.periodBillLoad, period.budgetHold);
  eq(cents(period.balanceAfterDeductions), cents(hand),
    period.id + ' Budget BAD is income minus bills minus Household Budget');
  eq(cents(viaHelper), cents(hand), period.id + ' shared helper matches the hand subtraction');
  const canonical = pictureFor(period.start);
  eq(cents(canonical.canonical.headline.amount), cents(period.balanceAfterDeductions),
    period.id + ' Forecast picture matches Budget to the cent');
  eq(canonical.canonical.otherSpendAllowance.deducted, false,
    period.id + ' Other spend allowance is not deducted from Budget BAD');
}

const sep = pictureFor('2026-09-25').canonical;
const oct9 = pictureFor('2026-10-09').canonical;
eq(cents(sep.headline.amount), cents(2290.66), 'Sep 25–Oct 8 BAD stays 2290.66');
eq(cents(oct9.headline.amount), cents(1782.23), 'Oct 9–Oct 22 BAD stays 1782.23');
eq(cents(sep.balanceAfterDeductions.amount), cents(sep.headline.amount),
  'pay-period headline is BAD');
eq(cents(F.balanceAfterDeductionsAmount(sep.income.amount, sep.bills.amount, sep.householdBudget.amount)),
  cents(sep.headline.amount), 'Sep 25 headline equals the shared helper');
eq(cents(F.balanceAfterDeductionsAmount(oct9.income.amount, oct9.bills.amount, oct9.householdBudget.amount)),
  cents(oct9.headline.amount), 'Oct 9 headline equals the shared helper');

const ready = (traj.payPeriods || []).filter(p =>
  p.canonical && p.canonical.headline && p.canonical.headline.amount != null);
eq(ready.length > 8, true, 'canonical pictures cover current and future pay periods');
for (const period of ready) {
  const picture = period.canonical;
  const viaHelper = F.balanceAfterDeductionsAmount(
    picture.income.amount, picture.bills.amount, picture.householdBudget.amount);
  eq(cents(picture.headline.amount), cents(viaHelper),
    (picture.start || period.payday) + ' BAD equals the shared helper');
  eq(cents(picture.headline.amount), cents(picture.balanceAfterDeductions.amount),
    (picture.start || period.payday) + ' headline is not reduced by a reference');
  eq(picture.otherSpendAllowance.amount, ALLOWANCE, 'Other spend allowance is $400');
  eq(picture.otherSpendAllowance.unitAmount, ALLOWANCE, 'allowance is $400 per pay period');
  eq(picture.otherSpendAllowance.deducted, false, 'allowance deducted flag is false');
  eq(picture.plannedSpending.deducted, false, 'planned spending reference is not deducted');
  eq(cents(picture.headline.amount) === cents(picture.balanceAfterDeductions.amount - ALLOWANCE),
    false, 'headline is not BAD minus the $400 allowance');
}

const october = traj.months.find(m => m.month === '2026-10');
const december = traj.months.find(m => m.month === '2026-12');
const octSum = Math.round(october.closingPayPeriods.reduce((sum, row) => sum + cents(row.bad), 0));
eq(octSum, cents(2290.66 + 1782.23), 'October closing BADs are the two Budget figures');
eq(cents(october.canonical.headline.amount), octSum,
  'October headline is the exact sum of closing BADs');
eq(cents(october.canonical.headline.amount), cents(4072.89), 'October headline is 4072.89');
eq(october.canonical.otherSpendAllowance.amount, 800, 'October Other spend reference is $800');
eq(october.canonical.otherSpendAllowance.count, 2, 'October has two closing pay periods');
eq(october.canonical.otherSpendAllowance.deducted, false, 'October allowance is not deducted');
const fusion = (october.canonical.plannedSpending.lines || []).find(line => line.id === 'fusion-household-oct');
eq(fusion && cents(fusion.amount), cents(1200), 'Fusion $1,200 is listed as planned spending due');
eq(october.canonical.plannedSpending.deducted, false, 'Fusion is not deducted from the headline');
eq(cents(october.canonical.headline.amount) === cents(4072.89 - 800 - 1200), false,
  'October headline is not the sum minus allowance minus Fusion');
eq(october.cash.roadAheadFunding, false, 'month cash is still the walk, not the headline');
eq(cents(october.cash.amount) === cents(october.canonical.headline.amount), false,
  'October cash is not replaced by the BAD headline');

eq(december.canonical.otherSpendAllowance.amount, 1200, 'December allowance reference is $1,200');
eq(december.canonical.otherSpendAllowance.count, 3, 'December has three closing pay periods');
eq(december.canonical.otherSpendAllowance.deducted, false, 'December allowance is not deducted');
const decSum = Math.round(december.closingPayPeriods.reduce((sum, row) => sum + cents(row.bad), 0));
eq(cents(december.canonical.headline.amount), decSum,
  'December headline is the exact sum of three closing BADs');
eq(cents(december.canonical.headline.amount) === cents(december.canonical.headline.amount - 1200), false,
  'December headline is not reduced by the $1,200 reference');

const square = pictureFor('2027-01-29').canonical;
const squareBill = (square.bills.lines || []).find(line => line.id === 'square-one');
const squarePlan = (square.plannedSpending.lines || []).find(line => line.id === 'square-one');
eq(!!squareBill, true, 'Square One stays in its pay period bill load');
eq(squarePlan, undefined, 'Square One is not listed again as planned spending');
eq(cents(square.headline.amount), cents(F.balanceAfterDeductionsAmount(
  square.income.amount, square.bills.amount, square.householdBudget.amount)),
  'Square One period headline is still just BAD');
eq(cents((square.income.lines || []).find(line => line.id === 'payroll').amount), cents(3849.4),
  'Jan 29 period uses the authorized 2027 estimated Seaspan net');

// Dropping the October Fusion commitment changes the reference, not BAD or the headline.
const withoutFusion = JSON.parse(JSON.stringify(data.plan));
withoutFusion.commitments = (withoutFusion.commitments || []).filter(row => row.id !== 'fusion-household-oct');
const trajWithout = F.baselineTrajectory(withoutFusion, data.debts, asOf, opts);
const octWithout = trajWithout.months.find(m => m.month === '2026-10');
eq(cents(octWithout.canonical.headline.amount), cents(october.canonical.headline.amount),
  'removing a planned-spending reference does not change the month headline');
eq(cents(pictureFor('2026-10-09').canonical.headline.amount),
  cents(trajWithout.payPeriods.find(p => p.payday === '2026-10-09').canonical.headline.amount),
  'removing Fusion does not change a pay-period BAD');
eq((octWithout.canonical.plannedSpending.lines || []).some(line => line.id === 'fusion-household-oct'),
  false, 'the removed commitment leaves the reference list');
eq(octWithout.canonical.otherSpendAllowance.amount, 800,
  'the $400 allowance is unchanged when a planned-spending row is removed');
eq(october.cash.identity, 'cumulative-walk-close', 'October cash keeps the walk identity');
eq(cents(october.cash.amount) === cents(4072.89 - 800 - 1200), false,
  'October cash is not the headline minus the two references');

// stage1.result remains on the walk and is not the rendered household surplus.
const octPeriod = pictureFor('2026-09-25');
eq(octPeriod.stage1.result.identity, 'standalone-period-surplus-deficit',
  'stage1.result keeps its walk identity');
eq(octPeriod.stage1.obligations && octPeriod.stage1.obligations.amount != null, true,
  'stage1.obligations stays published');
eq(cents(octPeriod.stage1.result.amount) === cents(octPeriod.canonical.headline.amount), false,
  'stage1.result is a different figure from the household BAD');

const planSrc = fs.readFileSync(path.join(ROOT, 'public/plan.js'), 'utf8');
const planningSrc = fs.readFileSync(path.join(ROOT, 'public/planning.js'), 'utf8');
function grab(src, re, label) {
  const m = src.match(re);
  if (!m) throw new Error('missing ' + label);
  return m[0];
}
const surfaceFn = grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml');
const waterfallsFn = grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml');
eq(/data-plan-look/.test(surfaceFn), false, 'Budget surface does not include the More views select');
eq(/data-calendar-period-picker/.test(surfaceFn), false, 'Budget surface does not include the This/Next switch');
eq(/calendarPickerHtml\(/.test(waterfallsFn), false, 'the pay-period switch is not printed on the waterfall');
eq(/activeId/.test(waterfallsFn), true, 'the waterfall still selects the active pay period');
eq(!!rec.nextPeriodView, true, 'Forecast still publishes nextPeriodView');
eq(Array.isArray(rec.pastPeriodViews), true, 'Forecast still publishes pastPeriodViews');
eq(!!rec.paydayCarryoverTrend, true, 'Forecast still publishes paydayCarryoverTrend');

const appSrc = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const grabConst = re => {
  const match = re.exec(appSrc);
  if (!match) throw new Error('missing ' + re);
  return match[0];
};
const helpers = [
  grabConst(/^const money = .*$/m), grabConst(/^const money2 = .*$/m), grabConst(/^const pct = .*$/m),
  grabConst(/^const fmtDate = .*$/m), grabConst(/^const fmtDateLong = .*$/m), grabConst(/^const fmtDateFull = .*$/m),
].join('\n');
const page = {
  Forecast: F,
  console,
  App: { hooks: [], register() {}, boot() {} },
  $() { return { innerHTML: '', textContent: '' }; },
};
vm.runInNewContext(`${helpers}\n${planningSrc}`, page, { filename: 'public/planning.js' });
const html = page.planningRoadAheadHtml(traj, 'pay-period', octPeriod.payday, asOf);
const combined = html.lead + html.stages;
eq(/data-canonical-headline="balance-after-deductions"/.test(combined), true,
  'pay-period view renders the canonical BAD headline');
eq(/data-reference-deducted="false"/.test(combined), true, 'references are marked not deducted');
eq(/Balance After Deductions/.test(html.lead), true, 'the pay-period lead names Balance After Deductions');
const leadAmount = html.lead.match(/data-planning-road-decision="canonical"[\s\S]*?data-road-lead-amount="([^"]+)"/);
eq(leadAmount && cents(leadAmount[1]), cents(octPeriod.canonical.headline.amount),
  'rendered headline amount is the canonical BAD');
eq(leadAmount && cents(leadAmount[1]) === cents(octPeriod.stage1.result.amount), false,
  'rendered headline is not stage1.result');

const monthHtml = page.planningRoadAheadHtml(traj, 'month', '2026-10', asOf);
eq(/data-canonical-headline="closing-pay-period-balance-after-deductions"/.test(monthHtml.lead + monthHtml.stages),
  true, 'month view renders the closing-BAD headline');
eq(/data-other-spend-allowance="800"/.test(monthHtml.lead + monthHtml.stages), true,
  'October renders the $800 Other spend reference');

const snap = require('../scripts/figures-snapshot').buildFiguresSnapshot(data, periods);
const keys = Object.keys(snap).sort();
eq(keys.filter(key => key.startsWith('operating.this.')).length > 0, true, 'operating.this snapshot keys remain');
eq(keys.filter(key => key.startsWith('operating.next.')).length > 0, true, 'operating.next snapshot keys remain');
eq(keys.includes('operating.this.incomeTotal') && keys.includes('operating.next.incomeTotal'), true,
  'current and next income snapshot keys were not renamed');

console.log('Canonical pay period: ' + checks + ' assertions passed.');
