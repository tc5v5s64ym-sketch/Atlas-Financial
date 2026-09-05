'use strict';
/* Household has no planned Household Budget target.
 *
 * Independent of Forecast helpers under change (L-002): expected
 * planned amounts are summed from the authorized remaining owner-target
 * components, not by reading Forecast back to itself. Dog food still
 * uses the already-merged first-Seaspan-of-month calendar.
 *
 * `node test/test-household-target-removed.js`
 */
const F = require('../public/forecast.js');
const liveData = require('../data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  }
};
const near = (a, b, eps = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;

function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function independentSeaspanDates(anchor, from, to) {
  const out = [];
  let t = anchor;
  while (t > from) t = addDays(t, -14);
  while (t <= to) {
    if (t >= from) out.push(t);
    t = addDays(t, 14);
  }
  return out;
}

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

function independentFirstStartByMonth(anchor, from, to) {
  const first = new Map();
  for (const d of independentSeaspanDates(anchor, from, to)) {
    const key = monthKey(d);
    if (!first.has(key)) first.set(key, d);
  }
  return first;
}

function independentDogFoodPlanned(anchor, start) {
  const [y, m] = String(start).split('-').map(Number);
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
  const first = independentFirstStartByMonth(anchor, monthStart, monthEnd).get(monthKey(start));
  return first === start ? 100 : 0;
}

const REMAINING_EVERY_CYCLE = {
  groceries: 900,
  fuel: 325,
  restaurants: 200,
  'dale-guilt-free': 150,
  'amanda-guilt-free': 150,
};
const REMOVED_HOUSEHOLD = 37.5;
const EVERY_CYCLE = roundCent(Object.values(REMAINING_EVERY_CYCLE).reduce((s, n) => s + n, 0));
const WITH_DOG = roundCent(EVERY_CYCLE + 100);
const WITHOUT_DOG = EVERY_CYCLE;
const OLD_WITH_DOG = roundCent(WITH_DOG + REMOVED_HOUSEHOLD);
const OLD_WITHOUT_DOG = roundCent(WITHOUT_DOG + REMOVED_HOUSEHOLD);

ok(near(EVERY_CYCLE, 1725) && near(WITH_DOG, 1825) && near(WITHOUT_DOG, 1725),
  'independent component sum: $1,825.00 with monthly Dog food, $1,725.00 without');
ok(near(OLD_WITH_DOG, 1862.50) && near(OLD_WITHOUT_DOG, 1762.50),
  'independent prior totals with Household $37.50 were $1,862.50 / $1,762.50');
ok(near(OLD_WITH_DOG - WITH_DOG, 37.5) && near(OLD_WITHOUT_DOG - WITHOUT_DOG, 37.5),
  'exact source delta is $37.50 on every affected payday cycle');

const debts = [
  { id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving',
    balance: 100, rate: 21.99, payment: 25, pending: 0 },
];

function budgetCats(opts) {
  opts = opts || {};
  const cats = [
    { id: 'groceries', label: 'Groceries', class: 'essential',
      plannedWeekly: 450, plannedMonthly: null, ownerLine: 'Groceries' },
    { id: 'fuel', label: 'Fuel', class: 'essential',
      plannedPayday: 325, plannedMonthly: null, ownerLine: 'Fuel' },
    { id: 'household', label: 'Household supplies & utilities', class: 'essential',
      from: ['Household'], plannedMonthly: null },
    { id: 'pets', label: 'Pets', class: 'essential',
      plannedPayday: 100, plannedMonthly: null, ownerLine: 'Dog food',
      paydayCadence: 'first-seaspan-of-month' },
    { id: 'restaurants', label: 'Dining', class: 'discretionary',
      plannedPayday: 200, plannedMonthly: null, ownerLine: 'Eating out' },
    { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary',
      plannedPayday: 150, plannedMonthly: null, ownerLine: 'Dale guilt-free spending' },
    { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary',
      plannedPayday: 150, plannedMonthly: null, ownerLine: 'Amanda guilt-free spending' },
  ];
  if (opts.withHouseholdTarget) {
    const hh = cats.find(c => c.id === 'household');
    hh.plannedPayday = 37.5;
    hh.ownerLine = 'Household';
  }
  return cats;
}

function syntheticPlan(anchor, opts) {
  return {
    defaults: { targetBuffer: 500, windowDays: 91 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: anchor },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor, amount: 4000, confidence: 'confirmed',
      },
    ],
    bills: [],
    commitments: [],
    obligations: [],
    budget: { categories: budgetCats(opts) },
  };
}

function recommendOn(plan, asOf) {
  return F.recommend(plan, asOf, { targetBuffer: 500, debts });
}

function periodOn(advice, start) {
  const periods = ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .concat(advice.futureOperatingPeriods || []);
  return periods.find(p => p && p.start === start) || null;
}

function budgetRow(period, id) {
  return ((period && period.householdBudget) || []).find(r => r.id === id) || null;
}

function plannedById(period) {
  const out = {};
  for (const row of (period && period.householdBudget) || []) {
    if (row && row.id) out[row.id] = row.planned;
  }
  return out;
}

const LIVE_ANCHOR = '2026-08-14';
const noHold = syntheticPlan(LIVE_ANCHOR);
const withHold = syntheticPlan(LIVE_ANCHOR, { withHouseholdTarget: true });

console.log('\n=== 1–2. first and later Seaspan starts omit Household and keep Dog food ===');
{
  const first = periodOn(recommendOn(noHold, '2026-09-11'), '2026-09-11');
  const later = periodOn(recommendOn(noHold, '2026-09-25'), '2026-09-25');
  const firstOld = periodOn(recommendOn(withHold, '2026-09-11'), '2026-09-11');
  const laterOld = periodOn(recommendOn(withHold, '2026-09-25'), '2026-09-25');
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-09-11') === 100,
    'independent: Sep 11 is September\'s first Seaspan start');
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-09-25') === 0,
    'independent: Sep 25 is a later September start');
  ok(first && !budgetRow(first, 'household'),
    'first-of-month waterfall omits Household rather than printing $0');
  ok(later && !budgetRow(later, 'household'),
    'later-in-month waterfall omits Household rather than printing $0');
  ok(first && near(budgetRow(first, 'pets').planned, 100),
    'CASE 4: first-of-month Dog food remains $100');
  ok(later && near(budgetRow(later, 'pets').planned, 0),
    'CASE 4: later-in-month Dog food remains $0');
  ok(first && near(first.budgetHold, WITH_DOG),
    'CASE 1: first-of-month hold is independently $1,825.00');
  ok(later && near(later.budgetHold, WITHOUT_DOG),
    'CASE 2: later-in-month hold is independently $1,725.00');
  ok(firstOld && laterOld
      && near(firstOld.budgetHold - first.budgetHold, 37.5)
      && near(laterOld.budgetHold - later.budgetHold, 37.5),
    'CASE 3: Forecast hold falls by independently $37.50 against the prior authorized set');
}

console.log('\n=== 5. other authorized targets unchanged ===');
{
  const first = periodOn(recommendOn(noHold, '2026-09-11'), '2026-09-11');
  const later = periodOn(recommendOn(noHold, '2026-09-25'), '2026-09-25');
  const firstMap = plannedById(first);
  const laterMap = plannedById(later);
  ok(near(firstMap.groceries, 900) && near(laterMap.groceries, 900),
    'Groceries stays $900 both cycles');
  ok(near(firstMap.fuel, 325) && near(laterMap.fuel, 325),
    'Fuel stays $325 both cycles');
  ok(near(firstMap.restaurants, 200) && near(laterMap.restaurants, 200),
    'Eating out stays $200 both cycles');
  ok(near(firstMap['dale-guilt-free'], 150) && near(laterMap['dale-guilt-free'], 150),
    'Dale stays $150 both cycles');
  ok(near(firstMap['amanda-guilt-free'], 150) && near(laterMap['amanda-guilt-free'], 150),
    'Amanda stays $150 both cycles');
  ok(Object.keys(firstMap).sort().join(',') ===
      'amanda-guilt-free,dale-guilt-free,fuel,groceries,pets,restaurants',
    'first-of-month planned rows are only the remaining authorized targets');
}

console.log('\n=== 6. Household historical/actual classification is intact ===');
{
  const tx = {
    date: '2026-09-12',
    amount: 18.40,
    categoryLabel: 'Household',
    displayedPayee: 'DOLLARAMA',
    originalMerchant: 'DOLLARAMA',
  };
  const cls = F.classifyCurrentPeriodTransaction(tx, noHold, {});
  ok(cls && cls.kind === 'spend' && cls.categoryId === 'household',
    'a Household-labelled tx still classifies as household',
    cls && `${cls.kind}/${cls.categoryId}/${cls.includeReason || cls.reason}`);
  ok(cls && cls.categoryId !== 'other-spending' && cls.needsConfirmation !== true,
    'that tx is not moved into Other Spending');
  ok(cls && cls.includeReason !== 'dog-food-merchant',
    'merchant identity is not rewritten to Dog food');
  const liveTx = {
    date: '2026-08-20',
    amount: 12.00,
    categoryLabel: 'Household',
    displayedPayee: 'DOLLARAMA',
    originalMerchant: 'DOLLARAMA',
  };
  const liveCls = F.classifyCurrentPeriodTransaction(liveTx, liveData.plan, {});
  ok(liveCls && liveCls.kind === 'spend' && liveCls.categoryId === 'household',
    'live data.json still classifies Household actuals as household',
    liveCls && `${liveCls.kind}/${liveCls.categoryId}`);
}

console.log('\n=== 7. This / Next / future operating periods use the same rule ===');
{
  const advice = recommendOn(noHold, '2026-09-11');
  const current = (advice.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'this-pay-period');
  const next = (advice.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'next-pay-period');
  ok(current && current.start === '2026-09-11',
    'This Pay Period starts on the first September Seaspan payday');
  ok(next && next.start === '2026-09-25',
    'Next Pay Period starts on the later September Seaspan payday');
  ok(current && !budgetRow(current, 'household') && near(current.budgetHold, WITH_DOG),
    'This Pay Period has no Household hold and totals $1,825.00');
  ok(next && !budgetRow(next, 'household') && near(next.budgetHold, WITHOUT_DOG),
    'Next Pay Period has no Household hold and totals $1,725.00');
  const october = periodOn(advice, '2026-10-09')
    || (advice.weekViews || []).find(w => w.periodStart === '2026-10-09');
  const octAdvice = recommendOn(noHold, '2026-10-09');
  const octCurrent = (octAdvice.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'this-pay-period');
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-10-09') === 100,
    'independent: Oct 9 is October\'s first Seaspan start');
  ok(octCurrent && !budgetRow(octCurrent, 'household')
      && near(budgetRow(octCurrent, 'pets').planned, 100)
      && near(octCurrent.budgetHold, WITH_DOG),
    'a future month\'s first Seaspan start still omits Household and keeps Dog food $100');
  ok(october || octCurrent, 'future operating period proof ran');
}

console.log('\n=== 8. downstream leftover increases by the removed hold ===');
{
  const first = periodOn(recommendOn(noHold, '2026-09-11'), '2026-09-11');
  const firstOld = periodOn(recommendOn(withHold, '2026-09-11'), '2026-09-11');
  const later = periodOn(recommendOn(noHold, '2026-09-25'), '2026-09-25');
  const laterOld = periodOn(recommendOn(withHold, '2026-09-25'), '2026-09-25');
  ok(first && firstOld
      && near(first.afterHouseholdBudget,
        roundCent(first.afterRemainingBills - first.budgetHold))
      && near(first.afterHouseholdBudget - firstOld.afterHouseholdBudget, 37.5),
    'first-of-month leftover rises by $37.50 after the hold falls');
  ok(later && laterOld
      && near(later.afterHouseholdBudget,
        roundCent(later.afterRemainingBills - later.budgetHold))
      && near(later.afterHouseholdBudget - laterOld.afterHouseholdBudget, 37.5),
    'later-in-month leftover rises by $37.50 after the hold falls');
}

console.log('\n=== monthly / weekly source delta from the retired payday target ===');
{
  const paydayMonthly = roundCent(37.5 * (365.25 / 12) / 14);
  const paydayWeekly = roundCent(paydayMonthly / (365.25 / 12 / 7));
  ok(near(paydayMonthly, 81.53) && near(paydayWeekly, 18.75),
    'independent: $37.50 per 14-day cycle is $81.53/month and $18.75/week');
  const periods = {
    asOf: '2026-09-11',
    periods: { ytd: { label: 'YTD', months: 8, spending: [] } },
  };
  const bdGone = F.budgetBreakdown(noHold, periods, {});
  const bdKept = F.budgetBreakdown(withHold, periods, {});
  const hhGone = (bdGone.categories || []).find(c => c.id === 'household');
  const hhKept = (bdKept.categories || []).find(c => c.id === 'household');
  ok(hhKept && near(hhKept.target, paydayMonthly) && hhKept.source === 'owner-target',
    'with the retired target present, master-plan monthly is payday-annualized $81.53');
  ok(hhGone && hhGone.target == null && hhGone.source === 'historical-actual',
    'without the planned target, Household is historical-actual, not a $0 owner target');
  ok(near(bdKept.essentialMonthly - bdGone.essentialMonthly, paydayMonthly)
      || near(hhKept.planned - (hhGone.planned || 0), paydayMonthly),
    'independent $81.53 payday-annualized source is the owner-target monthly that left the hold',
    `kept ${hhKept && hhKept.planned} gone ${hhGone && hhGone.planned}`);
}

console.log('\n=== live data.json no longer reserves Household $37.50 ===');
{
  const live = liveData.plan.budget.categories.find(c => c.id === 'household');
  ok(live && live.plannedPayday == null && live.plannedWeekly == null
      && live.plannedMonthly == null && !live.ownerLine,
    'live household category has no planned target');
  const rec = F.recommend(liveData.plan, liveData.meta.asOf, {
    debts: liveData.debts || [],
  });
  const current = (rec.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'this-pay-period');
  const next = (rec.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'next-pay-period');
  ok(current && !budgetRow(current, 'household') && near(current.budgetHold, 1862.5 - 37.5),
    'live This Pay Period omits Household and hold is $1,825.00');
  ok(next && !budgetRow(next, 'household') && near(next.budgetHold, 1762.5 - 37.5),
    'live Next Pay Period omits Household and hold is $1,725.00');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
