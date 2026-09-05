'use strict';
/* Dog food is $100 once per calendar month, assigned to the first
 * Seaspan pay-period start in that YYYY-MM.
 *
 * Independent of Forecast helpers under change (L-002): expected
 * planned amounts are grouped from an independently walked biweekly
 * calendar. Household Budget totals are summed from the incumbent
 * owner-target components, not by reading Forecast back to itself.
 *
 * `node test/test-dog-food-monthly-cadence.js`
 */
const F = require('../public/forecast.js');

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

// Independent Seaspan calendar: 14-day steps from the supplied anchor.
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

const OTHER_TARGETS = {
  groceries: 900,
  fuel: 325,
  household: 37.5,
  restaurants: 200,
  'dale-guilt-free': 150,
  'amanda-guilt-free': 150,
};
const OTHER_TOTAL = roundCent(Object.values(OTHER_TARGETS).reduce((s, n) => s + n, 0));
const WITH_DOG = roundCent(OTHER_TOTAL + 100);
const WITHOUT_DOG = OTHER_TOTAL;

ok(near(OTHER_TOTAL, 1762.50) && near(WITH_DOG, 1862.50) && near(WITHOUT_DOG, 1762.50),
  'independent component sum: $1,762.50 without Dog food, $1,862.50 with it');
ok(near(WITH_DOG - WITHOUT_DOG, 100),
  'the two period totals differ by exactly $100');

const debts = [
  { id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving',
    balance: 100, rate: 21.99, payment: 25, pending: 0 },
];

function budgetCats(cadence) {
  return [
    { id: 'groceries', label: 'Groceries', class: 'essential',
      plannedWeekly: 450, plannedMonthly: null, ownerLine: 'Groceries' },
    { id: 'fuel', label: 'Fuel', class: 'essential',
      plannedPayday: 325, plannedMonthly: null, ownerLine: 'Fuel' },
    { id: 'household', label: 'Household', class: 'essential',
      plannedPayday: 37.5, plannedMonthly: null, ownerLine: 'Household' },
    { id: 'pets', label: 'Pets', class: 'essential',
      plannedPayday: 100, plannedMonthly: null, ownerLine: 'Dog food',
      paydayCadence: cadence || undefined },
    { id: 'restaurants', label: 'Dining', class: 'discretionary',
      plannedPayday: 200, plannedMonthly: null, ownerLine: 'Eating out' },
    { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary',
      plannedPayday: 150, plannedMonthly: null, ownerLine: 'Dale guilt-free spending' },
    { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary',
      plannedPayday: 150, plannedMonthly: null, ownerLine: 'Amanda guilt-free spending' },
  ];
}

function syntheticPlan(anchor, cadence) {
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
    budget: { categories: budgetCats(cadence) },
  };
}

function budgetRow(period, id) {
  return ((period && period.householdBudget) || []).find(r => r && r.id === id) || null;
}

function periodOn(advice, start) {
  return ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(p => p && p.start === start) || null;
}

function recommendOn(plan, asOf) {
  return F.recommend(plan, asOf, { targetBuffer: 500, debts });
}

function proveStarts(label, plan, anchor, starts) {
  console.log(`\n=== ${label} ===`);
  const expectedByStart = new Map();
  for (const start of starts) {
    const expected = independentDogFoodPlanned(anchor, start);
    expectedByStart.set(start, expected);
    const [y, m] = String(start).split('-').map(Number);
    const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
    const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDayOfMonth(y, m)).padStart(2, '0')}`;
    const monthFirst = independentFirstStartByMonth(anchor, monthStart, monthEnd)
      .get(monthKey(start));
    ok(expected === 100 || expected === 0,
      `${start} independent Dog food is $100 or $0`, String(expected));
    if (start === monthFirst) {
      ok(expected === 100,
        `${start} is the earliest independent start in ${monthKey(start)} → $100`);
    } else {
      ok(expected === 0,
        `${start} is a later ${monthKey(start)} start (first is ${monthFirst}) → $0`);
    }
  }

  for (const start of starts) {
    const advice = recommendOn(plan, start);
    const period = periodOn(advice, start);
    const pets = budgetRow(period, 'pets');
    const expected = expectedByStart.get(start);
    ok(!!period, `${start} Forecast publishes that operating period`);
    ok(pets && near(pets.planned, expected),
      `${start} Forecast Dog food planned is the independent $${expected}`,
      pets && String(pets.planned));
    for (const [id, amount] of Object.entries(OTHER_TARGETS)) {
      const row = budgetRow(period, id);
      ok(row && near(row.planned, amount),
        `${start} ${id} planned stays $${amount}`,
        row && String(row.planned));
    }
    const independentHold = roundCent(OTHER_TOTAL + expected);
    ok(period && near(period.budgetHold, independentHold),
      `${start} Household Budget hold is independently $${independentHold.toFixed(2)}`,
      period && String(period.budgetHold));
  }
}

const LIVE_ANCHOR = '2026-08-14';
const livePlan = syntheticPlan(LIVE_ANCHOR, 'first-seaspan-of-month');

proveStarts(
  '1. two paydays in September 2026',
  livePlan, LIVE_ANCHOR, ['2026-09-11', '2026-09-25']
);

proveStarts(
  '2. next month resets on the live Seaspan calendar',
  livePlan, LIVE_ANCHOR, ['2026-09-25', '2026-10-09', '2026-10-23']
);
{
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-09-25') === 0,
    'independent: Sep 25 is not September\'s first Seaspan start');
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-10-09') === 100,
    'independent: Oct 9 is October\'s first Seaspan start');
  ok(independentDogFoodPlanned(LIVE_ANCHOR, '2026-10-23') === 0,
    'independent: Oct 23 is a later October start');
}

const THREE_ANCHOR = '2026-01-02';
const threePlan = syntheticPlan(THREE_ANCHOR, 'first-seaspan-of-month');

proveStarts(
  '3. three Seaspan starts in January 2026',
  threePlan, THREE_ANCHOR, ['2026-01-02', '2026-01-16', '2026-01-30']
);
{
  const januaryStarts = ['2026-01-02', '2026-01-16', '2026-01-30'];
  const independentJanuary = januaryStarts.reduce(
    (s, d) => s + independentDogFoodPlanned(THREE_ANCHOR, d), 0);
  const forecastJanuary = januaryStarts.reduce((s, d) => {
    const period = periodOn(recommendOn(threePlan, d), d);
    const pets = budgetRow(period, 'pets');
    return roundCent(s + (pets ? Number(pets.planned) : 0));
  }, 0);
  ok(independentJanuary === 100 && near(forecastJanuary, 100),
    'January-starting cycles plan exactly $100 Dog food in total',
    `independent ${independentJanuary} / Forecast ${forecastJanuary}`);
}

console.log('\n=== 4. December → January resets by YYYY-MM, not month name ===');
{
  const decJan = ['2025-12-05', '2025-12-19', '2026-01-02', '2027-01-01'];
  // 2027-01-01 is 26 × 14 days after 2026-01-02.
  ok(addDays('2026-01-02', 26 * 14) === '2027-01-01',
    'independent: 26 Seaspan steps from 2026-01-02 is 2027-01-01');
  ok(independentDogFoodPlanned(THREE_ANCHOR, '2025-12-05') === 100,
    'independent: Dec 5 2025 owns December 2025');
  ok(independentDogFoodPlanned(THREE_ANCHOR, '2025-12-19') === 0,
    'independent: Dec 19 2025 is the later December 2025 start');
  ok(independentDogFoodPlanned(THREE_ANCHOR, '2026-01-02') === 100,
    'independent: Jan 2 2026 owns January 2026');
  ok(independentDogFoodPlanned(THREE_ANCHOR, '2027-01-01') === 100,
    'independent: Jan 1 2027 owns January 2027, not January 2026');
  proveStarts(
    '4b. Forecast year-boundary assignment',
    threePlan, THREE_ANCHOR, decJan
  );
}

console.log('\n=== 5–6. other targets unchanged; totals reconcile by components ===');
{
  const withDog = periodOn(recommendOn(livePlan, '2026-09-11'), '2026-09-11');
  const withoutDog = periodOn(recommendOn(livePlan, '2026-09-25'), '2026-09-25');
  ok(withDog && near(withDog.budgetHold, WITH_DOG),
    'first-of-month period hold is independently $1,862.50');
  ok(withoutDog && near(withoutDog.budgetHold, WITHOUT_DOG),
    'later-in-month period hold is independently $1,762.50');
  ok(withDog && withoutDog
      && near(withDog.budgetHold - withoutDog.budgetHold, 100),
    'the two Forecast holds differ by exactly $100');
  ok(withDog && near(withDog.afterHouseholdBudget,
      roundCent(withDog.afterRemainingBills - withDog.budgetHold)),
    'first-of-month leftover is remaining-bills minus the $1,862.50 hold');
  ok(withoutDog && near(withoutDog.afterHouseholdBudget,
      roundCent(withoutDog.afterRemainingBills - withoutDog.budgetHold)),
    'later-in-month leftover is remaining-bills minus the $1,762.50 hold');
}

console.log('\n=== current and next period use the same rule ===');
{
  const advice = recommendOn(livePlan, '2026-09-11');
  const current = (advice.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'this-pay-period');
  const next = (advice.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'next-pay-period');
  ok(current && current.start === '2026-09-11',
    'This Pay Period starts on the first September Seaspan payday');
  ok(next && next.start === '2026-09-25',
    'Next Pay Period starts on the later September Seaspan payday');
  ok(budgetRow(current, 'pets') && near(budgetRow(current, 'pets').planned, 100),
    'This Pay Period Dog food is $100');
  ok(budgetRow(next, 'pets') && near(budgetRow(next, 'pets').planned, 0),
    'Next Pay Period Dog food is $0 from the same rule, not a current-only special case');
}

console.log('\n=== week views hold Dog food only on the first Seaspan start of the month ===');
{
  const advice = recommendOn(livePlan, '2026-09-11');
  const weeks = advice.weekViews || [];
  ok(weeks.length > 1, 'week views exist');
  let firstPaydayWeeks = 0;
  let laterPaydayWeeks = 0;
  let emptyWeeks = 0;
  const horizonEnd = addDays('2026-09-11', 40);
  for (const week of weeks) {
    if (!week.periodStart || week.periodStart > horizonEnd) continue;
    const dates = independentSeaspanDates(LIVE_ANCHOR, week.periodStart, week.periodEnd);
    const qualifying = dates.filter(d => independentDogFoodPlanned(LIVE_ANCHOR, d) === 100);
    const pets = (week.householdBudget || []).find(r => r.id === 'pets');
    const digest = ((week.budgetDigest && week.budgetDigest.rows) || [])
      .find(r => r.id === 'pets');
    if (qualifying.length > 0) {
      firstPaydayWeeks += 1;
      ok(pets && near(pets.amount, 100 * qualifying.length),
        `week ${week.periodStart} containing the monthly Dog food payday holds $100`,
        pets && String(pets.amount));
      ok(digest && near(digest.planned, 100 * qualifying.length),
        `week ${week.periodStart} digest holds $100`,
        digest && String(digest.planned));
    } else if (dates.length > 0) {
      laterPaydayWeeks += 1;
      ok(!pets,
        `week ${week.periodStart} with only a later-in-month payday omits Dog food`);
      ok(!digest,
        `week ${week.periodStart} digest omits Dog food when the week is not the monthly assignment`);
    } else {
      emptyWeeks += 1;
      ok(!pets, `week ${week.periodStart} with no payday omits Dog food`);
    }
    ok(!pets || !near(pets.amount, 50),
      `week ${week.periodStart} is not a $50 Dog food proration`);
  }
  ok(firstPaydayWeeks > 0 && laterPaydayWeeks > 0 && emptyWeeks > 0,
    'week proof covers first-of-month payday, later payday, and no-payday weeks',
    `${firstPaydayWeeks} first / ${laterPaydayWeeks} later / ${emptyWeeks} empty`);
}

console.log('\n=== monthly equivalent is $100, not 26-cycle annualization ===');
{
  const periods = {
    asOf: '2026-09-11',
    periods: { ytd: { label: 'YTD', months: 8, spending: [] } },
  };
  const bd = F.budgetBreakdown(livePlan, periods, {});
  const pets = (bd.categories || []).find(c => c.id === 'pets');
  const fuel = (bd.categories || []).find(c => c.id === 'fuel');
  const smeared = Math.round(100 * (365.25 / 12) / 14 * 100) / 100;
  const fuelMonthly = Math.round(325 * (365.25 / 12) / 14 * 100) / 100;
  ok(pets && near(pets.target, 100) && !near(pets.target, smeared),
    'Dog food master-plan monthly target is $100, not $100 × month-days / 14',
    pets && String(pets.target));
  ok(fuel && near(fuel.target, fuelMonthly),
    'Fuel monthly equivalent is still payday-annualized $325',
    fuel && String(fuel.target));
}

console.log('\n=== absent cadence keeps every-payday Dog food (fixture compatibility) ===');
{
  const every = syntheticPlan(LIVE_ANCHOR, null);
  const first = periodOn(recommendOn(every, '2026-09-11'), '2026-09-11');
  const later = periodOn(recommendOn(every, '2026-09-25'), '2026-09-25');
  ok(budgetRow(first, 'pets') && near(budgetRow(first, 'pets').planned, 100),
    'without paydayCadence, Sep 11 still plans $100');
  ok(budgetRow(later, 'pets') && near(budgetRow(later, 'pets').planned, 100),
    'without paydayCadence, Sep 25 still plans $100 — default is every Seaspan payday');
}

console.log('\n=== 7. Surrey Meat classification is unchanged ===');
{
  const txs = [
    { date: '2026-09-12', amount: 48.2, categoryLabel: 'Groceries',
      displayedPayee: 'SURREY MEAT PKR _F', originalMerchant: 'SURREY MEAT PKR _F' },
    { date: '2026-09-12', amount: 48.2, categoryLabel: 'Pets',
      displayedPayee: 'SURREY MEAT PKR', originalMerchant: 'SURREY MEAT PKR' },
    { date: '2026-09-12', amount: 48.2, categoryLabel: 'Groceries',
      displayedPayee: 'SURREY MEAT PAC _F', originalMerchant: 'SURREY MEAT PAC _F' },
  ];
  for (const tx of txs) {
    const cls = F.classifyCurrentPeriodTransaction(tx, livePlan, {});
    ok(cls && cls.kind === 'spend' && cls.categoryId === 'pets',
      `${tx.originalMerchant} still classifies as Dog food, never Groceries`,
      cls && `${cls.kind}/${cls.categoryId}/${cls.includeReason || cls.reason}`);
    ok(cls && cls.includeReason === 'dog-food-merchant' || cls.reason === 'dog-food-merchant',
      `${tx.originalMerchant} still uses the incumbent dog-food-merchant reason`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
