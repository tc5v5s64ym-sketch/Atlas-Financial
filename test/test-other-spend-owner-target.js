'use strict';
/* Other spend $800/month is a Household Budget owner target.
 *
 * Owner-stated 2026-09-18: Forecast assumes $800 of other spend as
 * plan.budget.categories[].plannedMonthly on other-spend. Cadence is
 * calendar-month. Not extraDebtMonthly, not targetBuffer, not a bill or
 * commitment, and not Forecast Other spending confirmation actuals.
 *
 * Independent of Forecast.ownerTargetMonthly (L-002): a plannedMonthly
 * amount is already a calendar-month figure, so the expected monthly
 * target is 800 without conversion. Trajectory smear uses that 800 and
 * the calendar week identity 365.25/12/7, not the producing helper.
 * `node test/test-other-spend-owner-target.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const live = require('../data.json');
const periods = require('../public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;

const OTHER_MONTHLY = 800;
const OTHER_ID = 'other-spend';
const OTHER_LABEL = 'Other spend';
const CALENDAR_MONTH_DAYS = 365.25 / 12;
const WEEKS_PER_MONTH = CALENDAR_MONTH_DAYS / 7;
const START = '2026-06-15';
const JUL = '2026-07';
const SEP = '2026-09';
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function independentOwnerTargetMonthly(cat) {
  if (!cat) return null;
  if (cat.plannedWeekly != null) {
    return roundCent(Number(cat.plannedWeekly) * CALENDAR_MONTH_DAYS / 7);
  }
  if (cat.plannedPayday != null) {
    if (cat.paydayCadence === 'first-seaspan-of-month'
        || cat.paydayCadence === 'every-other-seaspan') {
      return roundCent(Number(cat.plannedPayday) || 0);
    }
    return roundCent(Number(cat.plannedPayday) * CALENDAR_MONTH_DAYS / 14);
  }
  if (cat.plannedMonthly != null) return roundCent(Number(cat.plannedMonthly) || 0);
  return null;
}

function cats(plan) {
  return (plan && plan.budget && plan.budget.categories) || [];
}
function byId(plan, id) {
  return cats(plan).find(c => c && c.id === id) || null;
}
function lineByLabel(lines, label) {
  return (lines || []).find(row => row && row.label === label) || null;
}

function periodsFixture() {
  return {
    periods: {
      ytd: {
        label: 'YTD fixture',
        months: 1,
        spending: [{ label: 'Groceries', total: 1 }],
      },
    },
  };
}

function syntheticPlan() {
  return {
    windowDays: 91,
    startingCash: { amount: 8000 },
    defaults: { targetBuffer: 200, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: START },
    budget: {
      basis: 'ytd',
      categories: [
        {
          id: OTHER_ID,
          label: OTHER_LABEL,
          class: 'essential',
          from: [],
          plannedMonthly: OTHER_MONTHLY,
          ownerLine: OTHER_LABEL,
          targetSource: 'owner-stated-2026-09-18',
        },
        {
          id: 'travel',
          label: 'Travel',
          class: 'discretionary',
          from: ['Travel'],
        },
      ],
    },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan',
      frequency: 'biweekly', anchor: '2026-06-12',
      amount: 2000, confidence: 'estimated',
    }],
    obligations: [],
    bills: [],
    commitments: [],
  };
}

const debts = [{
  id: 'card', label: 'Synthetic card',
  balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
  structure: 'Revolving — synthetic', secured: false, limit: 1500,
}];

const INDEPENDENT_WEEKLY = roundCent(OTHER_MONTHLY / WEEKS_PER_MONTH);

console.log('=== 1. Live JSON home is other-spend.plannedMonthly 800 ===');
{
  const row = byId(live.plan, OTHER_ID);
  const uncat = byId(live.plan, 'uncategorised');
  ok(!!row, 'other-spend category exists on the live plan');
  ok(row && row.plannedMonthly === OTHER_MONTHLY,
    'exact JSON home is plan.budget.categories[id=other-spend].plannedMonthly = 800',
    row ? String(row.plannedMonthly) : 'missing');
  ok(row && row.plannedPayday == null && row.plannedWeekly == null
      && row.paydayCadence == null,
    'other-spend has no payday or weekly cadence',
    row ? `${row.plannedPayday}/${row.plannedWeekly}/${row.paydayCadence}` : 'missing');
  ok(row && row.ownerLine === OTHER_LABEL
      && row.targetSource === 'owner-stated-2026-09-18'
      && row.label === OTHER_LABEL,
    'ownerLine / targetSource / label are owner-stated Other spend this turn');
  ok(row && Array.isArray(row.from) && row.from.length === 0,
    'other-spend has no Lunch Money from-mapping; it is a planning home, not a classification bucket');
  ok(uncat && uncat.plannedMonthly == null && uncat.id === 'uncategorised',
    'uncategorised remains the unmatched-merchant remainder, not the $800 home');
  ok(independentOwnerTargetMonthly(row) === OTHER_MONTHLY,
    'independent: plannedMonthly 800 is already a calendar-month figure, so monthly target is 800',
    String(independentOwnerTargetMonthly(row)));
}

console.log('\n=== 2. Named grocery / fuel / eating-out / guilt-free amounts are unchanged ===');
{
  const groceries = byId(live.plan, 'groceries');
  const fuel = byId(live.plan, 'fuel');
  const restaurants = byId(live.plan, 'restaurants');
  const dale = byId(live.plan, 'dale-guilt-free');
  const amanda = byId(live.plan, 'amanda-guilt-free');
  ok(groceries && groceries.plannedWeekly === 450 && groceries.plannedMonthly == null,
    'groceries stays plannedWeekly 450');
  ok(fuel && fuel.plannedPayday === 325 && fuel.plannedMonthly == null,
    'fuel stays plannedPayday 325');
  ok(restaurants && restaurants.plannedPayday === 200 && restaurants.plannedMonthly == null,
    'eating out stays plannedPayday 200');
  ok(dale && dale.plannedPayday === 150 && dale.plannedMonthly == null,
    'Dale guilt-free stays plannedPayday 150');
  ok(amanda && amanda.plannedPayday === 150 && amanda.plannedMonthly == null,
    'Amanda guilt-free stays plannedPayday 150');
}

console.log('\n=== 3. Not extraDebtMonthly, targetBuffer, a bill, or a commitment ===');
{
  const extra = live.plan.defaults && live.plan.defaults.extraDebtMonthly;
  const buffer = live.plan.defaults && live.plan.defaults.targetBuffer;
  ok(extra === 0 && extra !== OTHER_MONTHLY,
    'plan.defaults.extraDebtMonthly is not the $800 other-spend home',
    String(extra));
  ok(buffer !== OTHER_MONTHLY,
    'plan.defaults.targetBuffer is not the $800 other-spend home',
    String(buffer));
  ok(!(live.plan.bills || []).some(b => b && (b.id === OTHER_ID || b.budgetCategory === OTHER_ID
      || /other spend/i.test(b.label || ''))),
    'no bill was invented for other spend');
  ok(!(live.plan.commitments || []).some(c => c && (c.id === OTHER_ID
      || c.budgetCategory === OTHER_ID || /other spend/i.test(c.label || ''))),
    'no commitment was invented for other spend');
  ok(!(live.plan.commitments || []).some(c => c && (c.id === 'seattle-nov'
      || c.id === 'seattle-dec' || c.id === 'christmas-2026') && c.amount === OTHER_MONTHLY),
    'dating-tip commitments were not used as the $800 home');
}

console.log('\n=== 4. ownerTargets lock includes Other spend $800/month ===');
{
  const note = live.plan.budget.ownerTargets.note;
  ok(/Other spend \$800\/month/.test(note) && /plannedMonthly 800/.test(note)
      && /other-spend/.test(note) && /2026-09-18/.test(note),
    'ownerTargets.note records the Other spend $800/month lock');
  ok(/\$1,825\.00/.test(note) && /\$1,725\.00/.test(note),
    'payday-cycle totals stay $1,825.00 / $1,725.00; $800/month is not converted into a payday hold');
}

console.log('\n=== 5. Forecast Other spending confirmation row is not the planning home ===');
{
  const src = read('public/forecast.js');
  ok(/const OTHER_SPENDING_ID = 'other-spending'/.test(src),
    'Forecast confirmation actuals still use OTHER_SPENDING_ID other-spending');
  ok(OTHER_ID !== 'other-spending',
    'the planning category id is other-spend, distinct from other-spending');
  const calendarIds = src.slice(
    src.indexOf('const CALENDAR_PERIOD_BUDGET_IDS = ['),
    src.indexOf('function householdBudgetSupportingSpendEligible('));
  ok(!/other-spend/.test(calendarIds),
    'CALENDAR_PERIOD_BUDGET_IDS does not invent a payday hold for other-spend');
}

console.log('\n=== 6. budgetBreakdown owner-target monthly is independently 800 ===');
{
  const bd = F.budgetBreakdown(live.plan, periods, { paypalPerMonth: live.paypal.perMonth });
  const row = (bd.categories || []).find(c => c && c.id === OTHER_ID);
  ok(row && row.source === 'owner-target',
    'budgetBreakdown labels other-spend as owner-target',
    row ? String(row.source) : 'missing');
  ok(row && near(row.target, OTHER_MONTHLY) && near(row.planned, OTHER_MONTHLY),
    'budgetBreakdown target and planned remainder are independently $800',
    row ? `${row.target}/${row.planned}` : 'missing');
  ok(row && near(row.target, independentOwnerTargetMonthly(byId(live.plan, OTHER_ID))),
    'engine target agrees with the independent plannedMonthly identity');
  const contributing = (bd.categories || [])
    .filter(c => c && c.class !== 'reserve' && c.source !== 'historical-actual')
    .reduce((s, c) => s + (Number(c.planned) || 0), 0);
  ok(contributing >= OTHER_MONTHLY - 0.005,
    'Household Budget planned remainder includes at least the $800 other-spend',
    String(contributing));
}

console.log('\n=== 7. Synthetic trajectory Household Budget path is 800/month ===');
{
  const plan = syntheticPlan();
  const bd = F.budgetBreakdown(plan, periodsFixture(), { asOf: START });
  const row = (bd.categories || []).find(c => c && c.id === OTHER_ID);
  const travel = (bd.categories || []).find(c => c && c.id === 'travel');
  ok(row && near(row.target, OTHER_MONTHLY) && row.source === 'owner-target',
    'synthetic budgetBreakdown other-spend target is 800');
  ok(travel && travel.source === 'historical-actual',
    'synthetic Travel stays historical-actual and is not the $800 home');

  const traj = F.baselineTrajectory(plan, debts, START, { periods: periodsFixture() });
  ok(traj && traj.status === 'ready', 'synthetic trajectory is ready');
  ok(traj.weeklyVariable && near(traj.weeklyVariable.amount, INDEPENDENT_WEEKLY),
    'trajectory weeklyVariable equals independently 800 / calendar weeks',
    traj.weeklyVariable ? `${traj.weeklyVariable.amount} vs ${INDEPENDENT_WEEKLY}` : 'missing');
  ok(traj.weeklyVariable && traj.weeklyVariable.historicalActuals === 'excluded',
    'planned weeklyVariable still excludes historical actuals');

  const july = (traj.months || []).find(m => m.month === JUL);
  ok(july && july.stage1 && july.stage1.householdBudget
      && july.stage1.status !== 'unavailable',
    'July Stage 1 householdBudget is published');
  const walkDays = july.stage1.householdBudget.walkDays;
  const expectedSmear = roundCent(INDEPENDENT_WEEKLY * walkDays / 7);
  ok(near(july.stage1.householdBudget.amount, expectedSmear),
    'Stage 1 householdBudget amount is the independent 800-month smear',
    `${july.stage1.householdBudget.amount} vs ${expectedSmear}`);
  const otherLine = lineByLabel(july.stage1.householdBudget.lines, OTHER_LABEL);
  ok(otherLine && near(otherLine.amount, expectedSmear) && otherLine.status === 'calculated',
    'Stage 1 householdBudget lines include Other spend at the independent smear',
    otherLine ? `${otherLine.amount}` : 'missing');
  ok(!(july.stage1.householdBudget.lines || []).some(l => /travel/i.test(l.label || '')),
    'historical-actual Travel is not published as a Household Budget line');
}

console.log('\n=== 8. Live trajectory Household Budget path includes the $800 monthly ===');
{
  const asOf = live.meta.asOf;
  const trajOpts = { periods, extraFacilities: live.revolvingExtra };
  const traj = F.baselineTrajectory(live.plan, live.debts, asOf, trajOpts);
  ok(traj && traj.status === 'ready', 'live trajectory is ready');

  const liveBd = F.budgetBreakdown(live.plan, periods, {
    paypalPerMonth: live.paypal.perMonth,
    asOf,
    extraFacilities: live.revolvingExtra,
  });
  const otherBd = (liveBd.categories || []).find(c => c && c.id === OTHER_ID);
  ok(otherBd && near(otherBd.planned, OTHER_MONTHLY),
    'live budgetBreakdown planned remainder for other-spend is 800');

  const without = JSON.parse(JSON.stringify(live.plan));
  const withoutRow = byId(without, OTHER_ID);
  withoutRow.plannedMonthly = null;
  delete withoutRow.ownerLine;
  delete withoutRow.targetSource;
  const bdWithout = F.budgetBreakdown(without, periods, {
    paypalPerMonth: live.paypal.perMonth,
    asOf,
    extraFacilities: live.revolvingExtra,
  });
  const rowWithout = (bdWithout.categories || []).find(c => c && c.id === OTHER_ID);
  ok(rowWithout && rowWithout.source === 'historical-actual' && near(rowWithout.planned, 0),
    'removing plannedMonthly 800 drops other-spend out of the planned remainder (empty from → historical 0)');
  const trajWithout = F.baselineTrajectory(without, live.debts, asOf, trajOpts);
  ok(trajWithout && trajWithout.status === 'ready', 'clone without the $800 still forms a trajectory');
  ok(near(traj.weeklyVariable.amount - trajWithout.weeklyVariable.amount, INDEPENDENT_WEEKLY),
    'live weeklyVariable rises by independently 800 / calendar weeks when the owner target is present',
    `${traj.weeklyVariable.amount} − ${trajWithout.weeklyVariable.amount} vs ${INDEPENDENT_WEEKLY}`);

  const sep = (traj.months || []).find(m => m.month === SEP);
  const sepWithout = (trajWithout.months || []).find(m => m.month === SEP);
  ok(sep && sep.stage1 && sep.stage1.householdBudget
      && sep.stage1.status !== 'unavailable',
    'live September Stage 1 householdBudget is published');
  const walkDays = sep.stage1.householdBudget.walkDays;
  const expectedOtherLine = roundCent((OTHER_MONTHLY / WEEKS_PER_MONTH) * walkDays / 7);
  const otherLine = lineByLabel(sep.stage1.householdBudget.lines, OTHER_LABEL);
  ok(otherLine && near(otherLine.amount, expectedOtherLine, 0.01) && otherLine.status === 'calculated',
    'live September householdBudget lines include Other spend from independently smeared $800/month',
    otherLine ? `${otherLine.amount} vs ${expectedOtherLine}` : 'missing');
  const withoutLines = sepWithout && sepWithout.stage1 && sepWithout.stage1.householdBudget
    && sepWithout.stage1.householdBudget.lines;
  ok(!lineByLabel(withoutLines, OTHER_LABEL),
    'without the owner target, September does not publish an Other spend Household Budget line');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
