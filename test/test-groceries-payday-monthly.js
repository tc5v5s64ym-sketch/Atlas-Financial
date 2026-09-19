'use strict';
/* Groceries is $450 per 14-day Seaspan payday cycle and $900 per calendar
 * month (owner restatement 2026-09-18).
 *
 * Independent of Forecast.paydayCyclePlanned / ownerTargetMonthly (L-002):
 * a declared plannedPayday 450 on a 14-day Seaspan window is already the
 * cycle Planned figure; a declared plannedMonthly 900 is already the month
 * figure. Payday annualization of $450 is a different number ($978.35) and
 * must not win the month surface. Weekly×2 = $900 is the retired cadence.
 *
 * `node test/test-groceries-payday-monthly.js`
 */
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

const GROCERY_PAYDAY = 450;
const GROCERY_MONTHLY = 900;
const SEASPAN_ANCHOR = '2026-08-14';
const AS_OF = '2026-09-18';
const CYCLE_START = '2026-09-11';
const CYCLE_END = '2026-09-24';
const CALENDAR_MONTH_DAYS = 365.25 / 12;
const PAYDAY_ANNUALIZED_MONTHLY = roundCent(GROCERY_PAYDAY * CALENDAR_MONTH_DAYS / 14);
const WEEKLY_TIMES_TWO = roundCent(GROCERY_PAYDAY * 2);
const WEEKLY_ANNUALIZED_MONTHLY = roundCent(GROCERY_PAYDAY * CALENDAR_MONTH_DAYS / 7);

function addDays(iso, n) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return [
    dt.getUTCFullYear(),
    String(dt.getUTCMonth() + 1).padStart(2, '0'),
    String(dt.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function independentSeaspanStart(anchor, asOf) {
  let start = anchor;
  while (start > asOf) start = addDays(start, -14);
  let next = addDays(start, 14);
  while (next <= asOf) {
    start = next;
    next = addDays(start, 14);
  }
  return { start, end: addDays(next, -1), nextPayday: next };
}

function independentOwnerTargetMonthly(cat) {
  if (!cat) return null;
  if (cat.plannedWeekly != null) {
    return roundCent(Number(cat.plannedWeekly) * CALENDAR_MONTH_DAYS / 7);
  }
  if (cat.plannedMonthly != null && cat.plannedPayday != null) {
    return roundCent(Number(cat.plannedMonthly) || 0);
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

function independentPaydayCyclePlanned(cat) {
  if (!cat) return null;
  if (cat.plannedWeekly != null) return roundCent(Number(cat.plannedWeekly) * 2);
  if (cat.plannedPayday != null) return roundCent(Number(cat.plannedPayday) || 0);
  if (cat.plannedMonthly != null) {
    const monthly = Number(cat.plannedMonthly) || 0;
    if (monthly === 0) return null;
    return roundCent(monthly * 14 / CALENDAR_MONTH_DAYS);
  }
  return null;
}

function cats(plan) {
  return (plan && plan.budget && plan.budget.categories) || [];
}
function byId(plan, id) {
  return cats(plan).find(c => c && c.id === id) || null;
}
function budgetRow(period, id) {
  return ((period && period.householdBudget) || []).find(r => r && r.id === id) || null;
}

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 500, windowDays: 91 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: AS_OF },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: SEASPAN_ANCHOR, amount: 4000, confidence: 'confirmed',
    }],
    bills: [],
    commitments: [],
    obligations: [],
    budget: {
      categories: [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedPayday: GROCERY_PAYDAY,
          plannedMonthly: GROCERY_MONTHLY, ownerLine: 'Groceries',
          targetSource: 'owner-stated-2026-09-18',
        },
        {
          id: 'fuel', label: 'Fuel', class: 'essential',
          plannedPayday: 325, plannedMonthly: null, ownerLine: 'Fuel',
        },
        {
          id: 'pets', label: 'Pets', class: 'essential',
          plannedPayday: 100, plannedMonthly: null, ownerLine: 'Dog food',
          paydayCadence: 'every-other-seaspan', paydayCadenceAnchor: '2026-08-28',
        },
        {
          id: 'restaurants', label: 'Dining', class: 'discretionary',
          plannedPayday: 200, plannedMonthly: null, ownerLine: 'Eating out',
        },
      ],
    },
  };
}

const debts = [
  { id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving',
    balance: 100, rate: 21.99, payment: 25, pending: 0 },
];

ok(near(PAYDAY_ANNUALIZED_MONTHLY, 978.35) && WEEKLY_TIMES_TWO === 900
    && near(WEEKLY_ANNUALIZED_MONTHLY, 1956.70),
  'independent: payday-annualized $450 is $978.35/month; weekly×2 is $900/cycle; weekly annualized is $1,956.70');
ok(PAYDAY_ANNUALIZED_MONTHLY !== GROCERY_MONTHLY
    && WEEKLY_TIMES_TWO !== GROCERY_PAYDAY
    && WEEKLY_ANNUALIZED_MONTHLY !== GROCERY_MONTHLY,
  'those conversions are not the owner-stated $450 payday / $900 month pair');

console.log('\n=== 1. Live JSON home is groceries plannedPayday 450 + plannedMonthly 900 ===');
{
  const row = byId(live.plan, 'groceries');
  ok(!!row, 'groceries category exists on the live plan');
  ok(row && row.plannedPayday === GROCERY_PAYDAY && row.plannedMonthly === GROCERY_MONTHLY,
    'exact JSON home is plannedPayday 450 and plannedMonthly 900',
    row ? `${row.plannedPayday}/${row.plannedMonthly}` : 'missing');
  ok(row && row.plannedWeekly == null,
    'plannedWeekly is omitted so paydayCyclePlanned cannot do weekly×2',
    row ? String(row.plannedWeekly) : 'missing');
  ok(row && row.ownerLine === 'Groceries'
      && row.targetSource === 'owner-stated-2026-09-18',
    'ownerLine / targetSource name the 2026-09-18 restatement');
  ok(row && /\$900 per calendar month/.test(row.why || '')
      && /\$450/.test(row.why || '')
      && /2026-09-18/.test(row.why || '')
      && !/\$450 per week = \$900/.test(row.why || '')
      && !/Print \$450\/week/.test(row.why || ''),
    'why restates monthly $900 and payday $450 and retires the weekly framing');
  ok(independentPaydayCyclePlanned(row) === GROCERY_PAYDAY,
    'independent: plannedPayday 450 on a 14-day cycle is already 450',
    String(independentPaydayCyclePlanned(row)));
  ok(independentOwnerTargetMonthly(row) === GROCERY_MONTHLY,
    'independent: plannedMonthly 900 wins the month surface when payday is also set',
    String(independentOwnerTargetMonthly(row)));
}

console.log('\n=== 2. Named fuel / pets / restaurants / other-spend amounts are unchanged ===');
{
  const fuel = byId(live.plan, 'fuel');
  const pets = byId(live.plan, 'pets');
  const restaurants = byId(live.plan, 'restaurants');
  const other = byId(live.plan, 'other-spend');
  ok(fuel && fuel.plannedPayday === 325 && fuel.plannedMonthly == null
      && fuel.plannedWeekly == null,
    'fuel stays plannedPayday 325');
  ok(pets && pets.plannedPayday === 100 && pets.plannedMonthly == null
      && pets.paydayCadence === 'every-other-seaspan',
    'dog food stays plannedPayday 100 every-other-seaspan');
  ok(restaurants && restaurants.plannedPayday === 200 && restaurants.plannedMonthly == null,
    'eating out stays plannedPayday 200');
  ok(other && other.plannedMonthly === 800 && other.plannedPayday == null
      && other.plannedWeekly == null,
    'other-spend stays plannedMonthly 800');
}

console.log('\n=== 3. Seaspan This Pay Period 2026-09-11..2026-09-24 Planned is $450 ===');
{
  const independent = independentSeaspanStart(SEASPAN_ANCHOR, AS_OF);
  ok(independent.start === CYCLE_START && independent.end === CYCLE_END
      && independent.nextPayday === '2026-09-25',
    'independent 14-day steps from Aug 14: Sep 11–24, next payday Sep 25');
  const plan = syntheticPlan();
  const cycle = F.spendingCycle(plan, AS_OF);
  ok(cycle && cycle.start === CYCLE_START && cycle.end === CYCLE_END
      && cycle.days === 14,
    'Forecast.spendingCycle matches that Sep 11–24 window');
  const rec = F.recommend(plan, AS_OF, { targetBuffer: 500, debts });
  const current = (rec.defaultView.calendarPeriods || [])
    .find(p => p && p.id === 'this-pay-period');
  const groc = budgetRow(current, 'groceries');
  ok(current && current.start === CYCLE_START && current.end === CYCLE_END,
    'This Pay Period is the independent Sep 11–24 Seaspan window');
  ok(groc && near(groc.planned, GROCERY_PAYDAY)
      && groc.plannedWeekly == null
      && near(groc.plannedPayday, GROCERY_PAYDAY)
      && near(groc.monthly, GROCERY_MONTHLY),
    'calendar/payday budget row Planned is $450; month field is $900',
    groc ? `planned=${groc.planned} weekly=${groc.plannedWeekly} monthly=${groc.monthly}` : 'missing');
  ok(groc && !near(groc.planned, WEEKLY_TIMES_TWO)
      && !near(groc.planned, roundCent(GROCERY_MONTHLY * 14 / CALENDAR_MONTH_DAYS)),
    'Planned is not weekly×2 $900 and not $900 calendar-prorated across 14 days',
    groc ? String(groc.planned) : 'missing');
  const fuel = budgetRow(current, 'fuel');
  const restaurants = budgetRow(current, 'restaurants');
  ok(fuel && near(fuel.planned, 325), 'fuel payday Planned stays $325');
  ok(restaurants && near(restaurants.planned, 200), 'eating out payday Planned stays $200');
}

console.log('\n=== 4b. paydayAllocation / currentPeriodAction essentials groceries planned is $450, not ~$414 smear ===');
{
  const plan = syntheticPlan();
  const smear14 = roundCent(GROCERY_MONTHLY * 14 / CALENDAR_MONTH_DAYS);
  ok(smear14 > 413 && smear14 < 415 && !near(smear14, GROCERY_PAYDAY),
    'independent: monthly $900 × 14 / (365.25/12) is ~$414, not $450',
    String(smear14));

  function groceryEssential(alloc) {
    return ((alloc && alloc.essentials && alloc.essentials.items) || [])
      .find(r => r && r.id === 'groceries') || null;
  }
  function groceryAction(action) {
    return ((action && action.categories) || [])
      .find(r => r && r.id === 'groceries') || null;
  }

  for (const asOf of [CYCLE_START, AS_OF]) {
    const alloc = F.paydayAllocation(plan, asOf, { targetBuffer: 500, debts });
    const groc = groceryEssential(alloc);
    const rec = F.recommend(plan, asOf, { targetBuffer: 500, debts });
    const recGroc = groceryEssential(rec.paydayAllocation);
    const action = F.currentPeriodAction(plan, asOf, { targetBuffer: 500, debts });
    const actGroc = groceryAction(action);
    ok(groc && near(groc.planned, GROCERY_PAYDAY) && near(groc.required, GROCERY_PAYDAY),
      `paydayAllocation essentials groceries planned/required is $450 asOf ${asOf}`,
      groc ? `planned=${groc.planned} required=${groc.required}` : 'missing');
    ok(groc && !near(groc.planned, smear14),
      `paydayAllocation groceries is not the ~$414 monthly smear asOf ${asOf}`,
      groc ? String(groc.planned) : 'missing');
    ok(groc && near(groc.monthly, GROCERY_MONTHLY),
      `paydayAllocation groceries monthly / ownerTargetMonthly stays $900 asOf ${asOf}`,
      groc ? String(groc.monthly) : 'missing');
    ok(recGroc && near(recGroc.planned, GROCERY_PAYDAY),
      `recommend.paydayAllocation groceries planned is $450 asOf ${asOf}`,
      recGroc ? String(recGroc.planned) : 'missing');
    ok(actGroc && near(actGroc.planned, GROCERY_PAYDAY),
      `currentPeriodAction groceries planned is $450 asOf ${asOf}`,
      actGroc ? String(actGroc.planned) : 'missing');
    ok(actGroc && !near(actGroc.planned, smear14),
      `currentPeriodAction groceries is not the ~$414 monthly smear asOf ${asOf}`,
      actGroc ? String(actGroc.planned) : 'missing');
  }

  const liveAlloc = F.paydayAllocation(live.plan, CYCLE_START, {
    targetBuffer: 500, debts: live.debts || debts,
  });
  const liveGroc = groceryEssential(liveAlloc);
  ok(liveGroc && near(liveGroc.planned, GROCERY_PAYDAY)
      && near(liveGroc.monthly, GROCERY_MONTHLY),
    'live paydayAllocation groceries planned is $450; monthly stays $900',
    liveGroc ? `planned=${liveGroc.planned} monthly=${liveGroc.monthly}` : 'missing');
  const liveFuel = ((liveAlloc.essentials && liveAlloc.essentials.items) || [])
    .find(r => r && r.id === 'fuel');
  const livePets = ((liveAlloc.essentials && liveAlloc.essentials.items) || [])
    .find(r => r && r.id === 'pets');
  ok(liveFuel && near(liveFuel.planned, 325),
    'live fuel payday essential stays $325',
    liveFuel ? String(liveFuel.planned) : 'missing');
  ok(!livePets || near(livePets.planned, 0) || near(livePets.required, 0),
    'live Sep 11 OFF-cycle pets essential is not a smear of $100',
    livePets ? `planned=${livePets.planned}` : 'absent (OFF omit is also fine)');
}

console.log('\n=== 4. Month / owner monthly target is $900, not payday-annualized $978.35 ===');
{
  const plan = syntheticPlan();
  const fixturePeriods = {
    asOf: AS_OF,
    periods: { ytd: { label: 'YTD', months: 1, spending: [{ label: 'Groceries', total: 1 }] } },
  };
  const bd = F.budgetBreakdown(plan, fixturePeriods, {});
  const groc = (bd.categories || []).find(c => c.id === 'groceries');
  ok(groc && groc.source === 'owner-target' && near(groc.target, GROCERY_MONTHLY)
      && near(groc.planned, GROCERY_MONTHLY) && near(groc.gross, GROCERY_MONTHLY),
    'budgetBreakdown groceries target / planned / gross are owner $900/month',
    groc ? `${groc.target}/${groc.planned}/${groc.gross}` : 'missing');
  ok(groc && !near(groc.target, PAYDAY_ANNUALIZED_MONTHLY)
      && !near(groc.target, WEEKLY_ANNUALIZED_MONTHLY),
    'month target is not payday-annualized $978.35 and not weekly-annualized $1,956.70');
  const liveBd = F.budgetBreakdown(live.plan, periods, {
    paypalPerMonth: live.paypal ? live.paypal.perMonth : 0,
  });
  const liveG = (liveBd.categories || []).find(c => c.id === 'groceries');
  ok(liveG && liveG.source === 'owner-target' && near(liveG.target, GROCERY_MONTHLY),
    'live month/owner grocery target is $900',
    liveG ? String(liveG.target) : 'missing');
  const liveFuel = (liveBd.categories || []).find(c => c.id === 'fuel');
  const fuelMonthly = roundCent(325 * CALENDAR_MONTH_DAYS / 14);
  ok(liveFuel && near(liveFuel.target, fuelMonthly),
    'live fuel month surface still payday-annualizes $325',
    liveFuel ? String(liveFuel.target) : 'missing');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
