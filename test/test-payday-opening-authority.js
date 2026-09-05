'use strict';
/* Payday-cycle opening authority (systems-review repair).
 *
 * A walked payday opening is authoritative only when the
 * opening-to-payday interval is complete enough to reconcile every
 * household-cash movement, or when a recorded payday snapshot exists.
 * Scheduled income plus represented outflows is not completeness:
 * unscheduled groceries / fuel / restaurants / transfers in that gap
 * must change the opening or withhold it.
 *
 * Independent reconstruction when the gap packet is complete:
 *   dated opening + every household-cash movement in the gap
 *     = frozen payday opening
 *   payday opening + period income not already inside that opening
 *     = Balance after payday
 *
 * Live mid-period cash is a separate fact. The page does not add.
 *
 * `node test/test-payday-opening-authority.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function liveOperatingPlanNote\([\s\S]*?\n\}$/m, 'liveOperatingPlanNote'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function glanceSignedMoney\([\s\S]*?\n\}$/m, 'glanceSignedMoney'),
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
    grab(planSrc, /^function runningLeftoverHtml\([\s\S]*?\n\}$/m, 'runningLeftoverHtml'),
    grab(planSrc, /^function periodBillLine\([\s\S]*?\n\}$/m, 'periodBillLine'),
    grab(planSrc, /^function calendarCurrentUnavailableHtml\([\s\S]*?\n\}$/m, 'calendarCurrentUnavailableHtml'),
    grab(planSrc, /^function calendarIncomeHtml\([\s\S]*?\n\}$/m, 'calendarIncomeHtml'),
    grab(planSrc, /^function householdBudgetCycleText\([\s\S]*?\n\}$/m, 'householdBudgetCycleText'),
    grab(planSrc, /^function householdBudgetMetric\([\s\S]*?\n\}$/m, 'householdBudgetMetric'),
    grab(planSrc, /^function householdBudgetCategoryHtml\([\s\S]*?\n\}$/m, 'householdBudgetCategoryHtml'),
    grab(planSrc, /^function calendarBudgetHtml\([\s\S]*?\n\}$/m, 'calendarBudgetHtml'),
    grab(planSrc, /^function calendarPeriodBillsHtml\([\s\S]*?\n\}$/m, 'calendarPeriodBillsHtml'),
    grab(planSrc, /^function extraRepaymentHtml\([\s\S]*?\n\}$/m, 'extraRepaymentHtml'),
    grab(planSrc, /^function calendarWaterfallHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallHtml'),
    grab(planSrc, /^function calendarPickerHtml\([\s\S]*?\n\}$/m, 'calendarPickerHtml'),
    grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ calendarWaterfallHtml, calendarWaterfallsHtml, liveCurrentBalanceHtml, money2 });`,
    { Forecast: F }
  );
}

const DATED = '2026-08-19';
const PAYDAY = '2026-08-28';
const MID = '2026-09-04';
const OPENING = 1000;
const CHILD = 150;
const PRE_BILL = 40;
const DALE = 4000;
const AMANDA = 2000;
const PERIOD_BILL = 500;
const BUDGET_HOLD = 200;
const LIVE_MID = 2337.21;
const LIVE_LATER = 1800.05;
const GROCERY = 75;
const PERIOD_INCOME = roundCent(DALE + AMANDA);
const INDEPENDENT_MORNING = roundCent(OPENING + CHILD);
const INDEPENDENT_MORNING_WITH_GROCERY = roundCent(OPENING + CHILD - GROCERY);
const REMAINING_UNPAID = roundCent(PRE_BILL + PERIOD_BILL);
const AFTER_PAYDAY = roundCent(INDEPENDENT_MORNING + PERIOD_INCOME);
const AFTER_BILLS = roundCent(AFTER_PAYDAY - REMAINING_UNPAID);
const AFTER_BUDGET = roundCent(AFTER_BILLS - BUDGET_HOLD);

function completeGapCash(movements) {
  return {
    complete: true,
    coverageStart: '2026-08-20',
    coverageThrough: '2026-08-27',
    movements: movements || [],
  };
}

function basePlan(overrides) {
  return Object.assign({
    defaults: { targetBuffer: 0 },
    startingCash: { amount: OPENING },
    nextDollar: {
      policy: 'true-surplus-highest-interest',
      provenance: 'owner-stated',
    },
    opening: { asOf: DATED, representedEvents: [] },
    income: [
      {
        id: 'payroll', label: 'Dale', frequency: 'biweekly',
        anchor: PAYDAY, amount: DALE, confidence: 'confirmed',
      },
      {
        id: 'amandaPayday', label: 'Amanda', frequency: 'once',
        date: '2026-08-31', amount: AMANDA, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Child benefit', frequency: 'once',
        date: '2026-08-20', amount: CHILD, confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'pre-bill', label: 'Before payday', frequency: 'once',
        date: '2026-08-26', amount: PRE_BILL, confidence: 'confirmed',
      },
      {
        id: 'period-bill', label: 'Period bill', frequency: 'once',
        date: '2026-09-01', amount: PERIOD_BILL, confidence: 'confirmed',
      },
    ],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          plannedPayday: BUDGET_HOLD,
        },
      ],
    },
  }, overrides || {});
}

function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p.id === id);
}

function incomeRow(p, id) {
  return ((p && p.income) || []).find(r => r && r.id === id) || null;
}

function recommend(plan, asOf, extra) {
  return F.recommend(plan, asOf, Object.assign({
    targetBuffer: plan.defaults && plan.defaults.targetBuffer,
    debts: [],
  }, extra || {}));
}

const composer = loadComposer();
const planSrc = read('public/plan.js');

console.log('=== 1. Incomplete scheduled-only gap withholds the payday opening ===');
{
  const plan = basePlan();
  const snap = F.establishPaydaySnapshot(plan, PAYDAY);
  ok(snap == null,
    'establishPaydaySnapshot withholds a scheduled-only walk; child benefit plus unpaid Aug 26 is not completeness');

  const advice = recommend(plan, MID);
  const active = period(advice.defaultView, 'this-pay-period');
  ok(active && active.start === PAYDAY && active.openingKnown !== true
      && active.opening == null && active.available == null
      && active.afterRemainingBills == null && active.afterHouseholdBudget == null,
    'mid-period dated plan does not publish a plausible reconstructed leftover chain');
  const dale = incomeRow(active, 'payroll');
  const amanda = incomeRow(active, 'amandaPayday');
  ok(dale && near(dale.amount, DALE) && amanda && near(amanda.amount, AMANDA),
    'period income rows stay visible while the opening is withheld');
}

console.log('\n=== 2. Mid-period live cash cannot substitute for the opening ===');
{
  const livePlan = basePlan({
    startingCash: { amount: LIVE_MID },
    opening: {
      asOf: MID,
      priorAsOf: DATED,
      paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: INDEPENDENT_MORNING },
      representedEvents: [
        { id: 'payroll', date: PAYDAY },
        { id: 'amandaPayday', date: '2026-08-31' },
        { id: 'period-bill', date: '2026-09-01' },
      ],
    },
  });
  const first = recommend(livePlan, MID);
  const active = period(first.defaultView, 'this-pay-period');
  ok(near(first.defaultView.liveCurrentBalance, LIVE_MID),
    'live Current Balance follows the mid-period observation');
  ok(active.openingSource === 'snapshot' && near(active.opening, INDEPENDENT_MORNING)
      && !near(active.opening, LIVE_MID),
    'frozen payday opening stays the walked morning figure, not $2,337.21');
  ok(near(active.available, AFTER_PAYDAY)
      && !near(active.available, roundCent(LIVE_MID + PERIOD_INCOME))
      && !near(active.available, LIVE_MID),
    'Balance after payday is not live cash and is not live cash plus income');

  const laterPlan = basePlan({
    startingCash: { amount: LIVE_LATER },
    opening: {
      asOf: '2026-09-06',
      priorAsOf: DATED,
      paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: INDEPENDENT_MORNING },
      representedEvents: [
        { id: 'payroll', date: PAYDAY },
        { id: 'amandaPayday', date: '2026-08-31' },
        { id: 'period-bill', date: '2026-09-01' },
      ],
    },
  });
  const later = recommend(laterPlan, '2026-09-06');
  const laterActive = period(later.defaultView, 'this-pay-period');
  ok(near(later.defaultView.liveCurrentBalance, LIVE_LATER)
      && !near(later.defaultView.liveCurrentBalance, LIVE_MID),
    'later live Current Balance can move');
  ok(near(laterActive.opening, INDEPENDENT_MORNING)
      && near(laterActive.opening, active.opening)
      && near(laterActive.available, active.available),
    'payday opening and Balance after payday stay stable after later transactions');
}

console.log('\n=== 3. Income is counted exactly once; paid bills are not deducted again ===');
{
  const livePlan = basePlan({
    startingCash: { amount: LIVE_MID },
    opening: {
      asOf: MID,
      priorAsOf: DATED,
      paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: INDEPENDENT_MORNING },
      representedEvents: [
        { id: 'payroll', date: PAYDAY },
        { id: 'amandaPayday', date: '2026-08-31' },
        { id: 'period-bill', date: '2026-09-01' },
      ],
    },
  });
  const advice = recommend(livePlan, MID);
  const active = period(advice.defaultView, 'this-pay-period');
  const dale = incomeRow(active, 'payroll');
  const amanda = incomeRow(active, 'amandaPayday');
  ok(dale && near(dale.amount, DALE) && dale.alreadyInCash === true,
    'received Dale row stays visible as settlement evidence');
  ok(amanda && near(amanda.amount, AMANDA),
    'Amanda period income stays on the snapshot');
  ok(near(active.incomeAdded, PERIOD_INCOME)
      && near(active.available, AFTER_PAYDAY)
      && !near(active.available, roundCent(INDEPENDENT_MORNING + PERIOD_INCOME + PERIOD_INCOME)),
    'Dale and Amanda are added to the payday opening once');
  ok(!near(active.available, roundCent(LIVE_MID + PERIOD_INCOME)),
    'the same paycheques are not added on top of live cash');
  const paid = (active.bills || []).find(r => r && r.id === 'period-bill');
  ok(paid && paid.status === 'PAID' && near(paid.remaining, 0),
    'represented period bill stays listed as paid');
  ok(near(active.remainingBills, PRE_BILL)
      && near(active.afterRemainingBills, roundCent(AFTER_PAYDAY - PRE_BILL)),
    'paid period bill is not subtracted again; unpaid pre-payday once-bill stays reserved once');
}

console.log('\n=== 4. Represented pre-payday outflow is not a completeness substitute ===');
{
  const plan = basePlan({
    opening: {
      asOf: DATED,
      representedEvents: [{ id: 'pre-bill', date: '2026-08-26' }],
    },
  });
  ok(F.establishPaydaySnapshot(plan, PAYDAY) == null,
    'a represented scheduled bill without complete gap cash still withholds');
  const paidMorning = roundCent(OPENING + CHILD - PRE_BILL);
  const livePlan = basePlan({
    startingCash: { amount: LIVE_MID },
    opening: {
      asOf: MID,
      priorAsOf: DATED,
      paydaySnapshot: {
        periodStart: PAYDAY, asOf: PAYDAY, opening: paidMorning,
      },
      representedEvents: [{ id: 'pre-bill', date: '2026-08-26' }],
    },
  });
  const advice = recommend(livePlan, MID);
  const active = period(advice.defaultView, 'this-pay-period');
  const pre = (active.bills || []).find(r => r && r.id === 'pre-bill');
  ok(near(active.opening, paidMorning)
      && (!pre || pre.status === 'PAID' || near(pre.remaining, 0)),
    'a recorded snapshot still keeps the represented Aug 26 bill inside payday morning');
  ok(near(active.remainingBills, PERIOD_BILL)
      && near(active.afterRemainingBills, roundCent(paidMorning + PERIOD_INCOME - PERIOD_BILL)),
    'only the still-unpaid period bill remains after the represented pre-payday bill');
}

console.log('\n=== 5. Live-advanced cash without a walkable dated opening still fails closed ===');
{
  const orphan = basePlan({
    startingCash: { amount: LIVE_MID },
    opening: { asOf: MID, priorAsOf: PAYDAY, representedEvents: [] },
  });
  const closed = recommend(orphan, MID);
  const active = period(closed.defaultView, 'this-pay-period');
  ok(near(closed.defaultView.liveCurrentBalance, LIVE_MID),
    'fail-closed mid-period still publishes live Current Balance');
  ok(active.openingKnown !== true && active.opening == null
      && active.available == null && active.afterRemainingBills == null
      && active.afterHouseholdBudget == null,
    'live-advanced cash with no dated pre-payday opening still fails closed');
  ok(F.establishPaydaySnapshot(orphan, PAYDAY) == null,
    'establishPaydaySnapshot refuses live-advanced starting cash');
}

console.log('\n=== 6. Incomplete gap withholds leftovers; complete gap is Forecast-owned ===');
{
  const incomplete = recommend(basePlan(), MID);
  const incompleteActive = period(incomplete.defaultView, 'this-pay-period');
  const incompleteHtml = composer.calendarWaterfallsHtml(
    incomplete.defaultView, 'this-pay-period', {
      applied: true,
      operatingPlan: 'live',
      fetchedAt: '2026-09-04T18:00:00.000Z',
      observedAsOf: MID,
      observedCash: {
        complete: true,
        asOf: MID,
        accounts: [
          { id: 'chequing-a', value: LIVE_MID, evidenceDate: MID },
        ],
      },
    }, incomplete.paydayAllocation);
  ok(incompleteActive.available == null && incompleteActive.afterRemainingBills == null
      && incompleteActive.afterHouseholdBudget == null,
    'incomplete gap does not publish leftover balances');
  ok(/PAYDAY OPENING IS NOT RECORDED/i.test(incompleteHtml)
      || /Opening is not recorded/i.test(incompleteHtml)
      || /—/.test(incompleteHtml),
    'page does not invent leftover dollars for an incomplete gap');

  const plan = basePlan();
  const advice = recommend(plan, MID, {
    paydayGapCash: completeGapCash([
      { date: '2026-08-20', amount: CHILD, accountRole: 'household-cash' },
    ]),
  });
  const active = period(advice.defaultView, 'this-pay-period');
  const html = composer.calendarWaterfallsHtml(
    advice.defaultView, 'this-pay-period', {
      applied: true,
      operatingPlan: 'live',
      fetchedAt: '2026-09-04T18:00:00.000Z',
      observedAsOf: MID,
      observedCash: {
        complete: true,
        asOf: MID,
        accounts: [
          { id: 'chequing-a', value: LIVE_MID, evidenceDate: MID },
        ],
      },
    }, advice.paydayAllocation);
  ok(active.openingKnown === true && active.openingSource === 'cutover-walk'
      && near(active.opening, INDEPENDENT_MORNING)
      && near(active.available, AFTER_PAYDAY)
      && near(active.afterRemainingBills, AFTER_BILLS)
      && near(active.afterHouseholdBudget, AFTER_BUDGET),
    'complete gap publishes opening + Dale + Amanda, then bills, then the Forecast hold');
  ok(html.includes(composer.money2(active.available))
      && html.includes(composer.money2(active.afterRemainingBills))
      && html.includes(composer.money2(active.afterHouseholdBudget)),
    'page prints the Forecast leftover balances instead of em dashes');
  ok(!/PAYDAY OPENING IS NOT RECORDED/i.test(html)
      && !/Opening is not recorded/i.test(html),
    'complete walked opening does not print the missing-snapshot warning');
  const waterfallFn = grab(planSrc, /^function calendarWaterfallHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallHtml');
  ok(/period\.available/.test(waterfallFn)
      && /period\.afterRemainingBills/.test(waterfallFn)
      && /period\.afterHouseholdBudget/.test(waterfallFn)
      && !/\.opening\s*\+/.test(waterfallFn)
      && !/incomeAdded/.test(waterfallFn),
    'plan.js renders Forecast leftovers; it does not add opening + income');
}

console.log('\n=== 7. Unscheduled pre-payday outflow must change the opening or withhold it ===');
{
  const plan = basePlan();
  const scheduledOnly = F.establishPaydaySnapshot(plan, PAYDAY);
  const groceryIncomplete = F.establishPaydaySnapshot(plan, PAYDAY, {
    paydayGapCash: {
      complete: false,
      coverageStart: '2026-08-20',
      coverageThrough: '2026-08-27',
      movements: [
        { date: '2026-08-20', amount: CHILD, accountRole: 'household-cash' },
        { date: '2026-08-25', amount: -GROCERY, accountRole: 'household-cash' },
      ],
    },
  });
  const withoutGrocery = F.establishPaydaySnapshot(plan, PAYDAY, {
    paydayGapCash: completeGapCash([
      { date: '2026-08-20', amount: CHILD, accountRole: 'household-cash' },
    ]),
  });
  const withGrocery = F.establishPaydaySnapshot(plan, PAYDAY, {
    paydayGapCash: completeGapCash([
      { date: '2026-08-20', amount: CHILD, accountRole: 'household-cash' },
      { date: '2026-08-25', amount: -GROCERY, accountRole: 'household-cash' },
    ]),
  });
  ok(scheduledOnly == null && groceryIncomplete == null,
    'unscheduled grocery without proven completeness withholds; it does not equal the scheduled-only opening');
  ok(withoutGrocery && near(withoutGrocery.opening, INDEPENDENT_MORNING),
    'complete gap without the grocery independently equals 1000 + 150');
  ok(withGrocery && near(withGrocery.opening, INDEPENDENT_MORNING_WITH_GROCERY)
      && !near(withGrocery.opening, withoutGrocery.opening)
      && !near(withGrocery.opening, INDEPENDENT_MORNING),
    'complete gap incorporates the $75 grocery from trusted evidence; opening is not the no-grocery figure');

  const liveLater = 1800.05;
  const reversed = F.establishPaydaySnapshot(basePlan({
    startingCash: { amount: liveLater },
    opening: { asOf: DATED, representedEvents: [] },
  }), PAYDAY);
  ok(reversed == null && !near(INDEPENDENT_MORNING_WITH_GROCERY, liveLater),
    'repair does not reverse-walk later live cash to invent the grocery-adjusted opening');

  const advice = recommend(plan, MID, {
    paydayGapCash: completeGapCash([
      { date: '2026-08-20', amount: CHILD, accountRole: 'household-cash' },
      { date: '2026-08-25', amount: -GROCERY, accountRole: 'household-cash' },
    ]),
  });
  const active = period(advice.defaultView, 'this-pay-period');
  ok(active.openingKnown === true
      && near(active.opening, INDEPENDENT_MORNING_WITH_GROCERY)
      && near(active.available, roundCent(INDEPENDENT_MORNING_WITH_GROCERY + PERIOD_INCOME))
      && !near(active.available, AFTER_PAYDAY),
    'This Payday leftover chain follows the grocery-adjusted complete opening, not the no-grocery walk');
}

if (failures) {
  console.log(`\nFAILED ${failures}`);
  process.exit(1);
}
console.log('\nOK');
