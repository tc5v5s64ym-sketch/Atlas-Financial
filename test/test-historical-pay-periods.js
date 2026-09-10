'use strict';
/* Completed historical pay-period navigation (L-002 / L-006).
 *
 * Independent of spendingCycle / pastPeriodViews as the specification:
 * Seaspan is +14 calendar days from the 2026-08-14 ACCOUNT_FACTS anchor.
 * Carryover, salary, bills, and other-income are synthetic fixtures, not
 * live household cents.
 *
 * `node test/test-historical-pay-periods.js`
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
const near = (a, b, eps = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
const iso = (y, m, d) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function addCalendarDays(date, n) {
  const [y, m, d] = String(date).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function seaspanOnOrBefore(day) {
  let t = ANCHOR;
  while (t > day) t = addCalendarDays(t, -14);
  while (addCalendarDays(t, 14) <= day) t = addCalendarDays(t, 14);
  return t;
}
function independentCycle(asOf) {
  const start = seaspanOnOrBefore(asOf);
  const next = addCalendarDays(start, 14);
  return { start, end: addCalendarDays(next, -1), nextPayday: next };
}
function roundCent(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
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
    grab(planSrc, /^function paydayCarryoverHtml\([\s\S]*?\n\}$/m, 'paydayCarryoverHtml'),
    grab(planSrc, /^function historicalPeriodHtml\([\s\S]*?\n\}$/m, 'historicalPeriodHtml'),
    grab(planSrc, /^function calendarPickerHtml\([\s\S]*?\n\}$/m, 'calendarPickerHtml'),
    grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml'),
    grab(planSrc, /^function periodBillsHtml\([\s\S]*?\n\}$/m, 'periodBillsHtml'),
    grab(planSrc, /^function householdBudgetHtml\([\s\S]*?\n\}$/m, 'householdBudgetHtml'),
    grab(planSrc, /^function budgetDigestHtml\([\s\S]*?\n\}$/m, 'budgetDigestHtml'),
    grab(planSrc, /^function firstCardHtml\([\s\S]*?\n\}$/m, 'firstCardHtml'),
    grab(planSrc, /^function otherCardsHtml\([\s\S]*?\n\}$/m, 'otherCardsHtml'),
    grab(planSrc, /^function bigPurchasesHtml\([\s\S]*?\n\}$/m, 'bigPurchasesHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function selectedPlanView\([\s\S]*?\n\}$/m, 'selectedPlanView'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, selectedPlanView, historicalPeriodHtml, money2 });`,
    { Forecast: F }
  );
}

const ANCHOR = '2026-08-14';
const AS_OF = '2026-09-09';
const CARRY = 1000;
const DALE = 4000;
const AMANDA = 2000;
const PAST_GIFT = 50;
const LIVE_GIFT = 75;
const BILL_PREV = 80;
const BILL_EARLIER = 90;
const LIVE_CASH = 2300;

const debts = [
  { id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving',
    balance: 2000, rate: 21.99, payment: 250, pending: 0 },
];

function historyPlan() {
  const current = independentCycle(AS_OF);
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{
        id: 'chequing-a', label: 'BILLS ACCOUNT', value: LIVE_CASH, class: 'spendable',
      }],
    },
    opening: {
      asOf: AS_OF,
      paydaySnapshot: {
        periodStart: current.start,
        asOf: current.start,
        opening: CARRY,
      },
      representedEvents: [
        { id: 'bill-prev', date: '2026-08-21' },
        { id: 'bill-earlier', date: '2026-08-07' },
      ],
    },
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor: ANCHOR, amount: DALE, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda salary — 15th', frequency: 'monthly',
        day: 15, amount: AMANDA, confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'bill-prev', label: 'Synthetic previous bill', amount: BILL_PREV,
        frequency: 'once', date: '2026-08-21', confidence: 'confirmed',
      },
      {
        id: 'bill-earlier', label: 'Synthetic earlier bill', amount: BILL_EARLIER,
        frequency: 'once', date: '2026-08-07', confidence: 'confirmed',
      },
    ],
    obligations: [],
    commitments: [],
    budget: { categories: [] },
  };
}

function actualsPacket() {
  return {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: AS_OF,
    coverageStart: '2026-07-31',
    coverageThrough: AS_OF,
    pendingCoverage: 'complete',
    transactions: [
      {
        id: 'tx-past-gift',
        date: '2026-08-20',
        amount: -PAST_GIFT,
        isIncome: true,
        categoryLabel: 'gifts',
        displayedPayee: 'Past gift',
        accountRole: 'household-cash',
      },
      {
        id: 'tx-live-gift',
        date: '2026-09-04',
        amount: -LIVE_GIFT,
        isIncome: true,
        categoryLabel: 'gifts',
        displayedPayee: 'Live gift',
        accountRole: 'household-cash',
      },
    ],
    representedActuals: [],
  };
}

function recommend(plan) {
  return F.recommend(plan, AS_OF, {
    targetBuffer: 500,
    debts,
    currentPeriodActuals: actualsPacket(),
    paydaySnapshot: plan.opening.paydaySnapshot,
  });
}

function incomeIds(period) {
  return ((period && period.income) || []).map(r => r && r.id).filter(Boolean);
}
function billIds(period) {
  return ((period && period.bills) || []).map(r => r && r.id).filter(Boolean);
}

const composer = loadComposer();
const planSrc = read('public/plan.js');

console.log('=== 1. two completed periods use the independent Seaspan grid ===');
{
  const current = independentCycle(AS_OF);
  const previous = independentCycle(addCalendarDays(current.start, -1));
  const earlier = independentCycle(addCalendarDays(previous.start, -1));
  ok(current.start === '2026-08-28' && current.end === '2026-09-10',
    'independent current window is Aug 28–Sep 10');
  ok(previous.start === '2026-08-14' && previous.end === '2026-08-27',
    'independent previous window is Aug 14–Aug 27');
  ok(earlier.start === '2026-07-31' && earlier.end === '2026-08-13',
    'independent earlier window is Jul 31–Aug 13');
  const plan = historyPlan();
  const frozen = JSON.stringify(plan);
  const advice = recommend(plan);
  ok(frozen === JSON.stringify(plan),
    'recommend does not mutate the plan');
  const past = advice.pastPeriodViews || [];
  ok(past.length >= 2, 'Forecast publishes at least two completed periods',
    'count=' + past.length);
  const prev = past[0];
  const early = past[1];
  ok(prev && prev.start === previous.start && prev.end === previous.end,
    'previous completed period dates follow the independent Seaspan grid');
  ok(early && early.start === earlier.start && early.end === earlier.end,
    'earlier completed period dates follow the independent Seaspan grid');
  ok(prev.start !== early.start && prev.end !== early.end,
    'the two completed periods are distinct date windows');
  ok(prev.start !== current.start && early.start !== current.start,
    'completed periods are not the current operating window');
  const active = ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(p => p && p.id === 'this-pay-period');
  ok(active && active.start === current.start && active.end === current.end,
    'default this-pay-period is unchanged current Seaspan window');
}

console.log('\n=== 2. each completed period has its own income and bills ===');
{
  const plan = historyPlan();
  const advice = recommend(plan);
  const prev = (advice.pastPeriodViews || [])[0];
  const early = (advice.pastPeriodViews || [])[1];
  const active = ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(p => p && p.id === 'this-pay-period');
  const prevIncome = incomeIds(prev);
  const earlyIncome = incomeIds(early);
  const liveIncome = incomeIds(active);
  ok(prevIncome.includes('payroll') && (prev.income || []).some(r => r.date === '2026-08-14'),
    'previous period includes the Aug 14 Seaspan payday');
  ok(earlyIncome.includes('payroll') && (early.income || []).some(r => r.date === '2026-07-31'),
    'earlier period includes the Jul 31 Seaspan payday');
  ok(!(prev.income || []).some(r => r.date === '2026-07-31'),
    'previous period does not reprint the Jul 31 payday');
  ok(!(early.income || []).some(r => r.date === '2026-08-14'),
    'earlier period does not reprint the Aug 14 payday');
  ok(prevIncome.includes('amandaSalary15')
    && (prev.income || []).some(r => r.date === '2026-08-15'),
    'previous period includes Amanda 15 Aug');
  ok(!(early.income || []).some(r => r.date === '2026-08-15'),
    'earlier period does not include Amanda 15 Aug');
  ok(billIds(prev).includes('bill-prev') && !billIds(prev).includes('bill-earlier'),
    'previous period bills stay inside Aug 14–27');
  ok(billIds(early).includes('bill-earlier') && !billIds(early).includes('bill-prev'),
    'earlier period bills stay inside Jul 31–Aug 13');
  ok(!billIds(active).includes('bill-prev') && !billIds(active).includes('bill-earlier'),
    'current period does not inherit completed-period bills');
  const prevTotal = roundCent(DALE + AMANDA + PAST_GIFT);
  const earlyTotal = roundCent(DALE);
  ok(near(prev.incomeTotal, prevTotal),
    'previous income is Aug 14 payroll + Amanda 15th + past gift',
    `${prev.incomeTotal} vs ${prevTotal}`);
  ok(near(early.incomeTotal, earlyTotal),
    'earlier income is Jul 31 payroll only',
    `${early.incomeTotal} vs ${earlyTotal}`);
  ok(prev.incomeTotal !== early.incomeTotal,
    'the two completed periods do not share one income total');
  ok(prev.incomeTotal !== active.incomeTotal,
    'previous period income is not today\'s income relabeled');
}

console.log('\n=== 3. historical actuals stay inside their payday window ===');
{
  const plan = historyPlan();
  const advice = recommend(plan);
  const prev = (advice.pastPeriodViews || [])[0];
  const early = (advice.pastPeriodViews || [])[1];
  const active = ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(p => p && p.id === 'this-pay-period');
  const prevPayees = (prev.income || []).map(r => r.label);
  const earlyPayees = (early.income || []).map(r => r.label);
  const livePayees = (active.income || []).map(r => r.label);
  ok(prevPayees.some(l => /Past gift/.test(l)),
    'Aug 20 gift lands in the Aug 14–27 period');
  ok(!prevPayees.some(l => /Live gift/.test(l)),
    'Sep 4 gift does not leak into the completed August period');
  ok(!earlyPayees.some(l => /Past gift/.test(l) || /Live gift/.test(l)),
    'neither gift lands in Jul 31–Aug 13');
  ok(livePayees.some(l => /Live gift/.test(l)),
    'Sep 4 gift stays on the current period');
  ok(!livePayees.some(l => /Past gift/.test(l)),
    'Aug 20 gift does not reprint as current-period income');
}

console.log('\n=== 4. payday carryover is known cash carried forward, not income ===');
{
  const current = independentCycle(AS_OF);
  const plan = historyPlan();
  const advice = recommend(plan);
  const prev = (advice.pastPeriodViews || [])[0];
  const early = (advice.pastPeriodViews || [])[1];
  ok(prev.paydayCarryoverKnown === true && near(prev.paydayCarryover, CARRY),
    'previous period carryover is the recorded Aug 28 payday opening',
    String(prev.paydayCarryover));
  ok(prev.paydayCarryoverAsOf === current.start,
    'carryover is dated at the next payday, not today');
  ok(prev.paydayCarryoverSource === 'snapshot',
    'carryover source is the recorded payday snapshot');
  const incomeLabels = (prev.income || []).map(r => `${r.id} ${r.label} ${r.incomeClass || ''}`);
  ok(!incomeLabels.some(s => /carryover|carried forward|opening/i.test(s)),
    'carryover is not a salary, Other Income, or opening income row');
  ok(!(prev.otherIncome && prev.otherIncome.items || []).some(r =>
    r && near(r.amount, CARRY)),
    'carryover is not classified as Other Income');
  ok(!near(prev.incomeTotal, CARRY),
    'Payday balance is not the leftover cash relabeled as income');
  ok(near(prev.incomeTotal, roundCent(DALE + AMANDA + PAST_GIFT)),
    'Payday balance stays period income without the leftover cash');
  ok(early.paydayCarryoverKnown !== true && early.paydayCarryover == null,
    'earlier period omits carryover when no payday-boundary cash is known');
  const active = ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(p => p && p.id === 'this-pay-period');
  ok(active && near(active.opening, CARRY),
    'current period opening is the same leftover counted once as opening');
}

console.log('\n=== 5. picker prints Forecast past views; page does not compute them ===');
{
  const plan = historyPlan();
  const advice = recommend(plan);
  const prev = (advice.pastPeriodViews || [])[0];
  const early = (advice.pastPeriodViews || [])[1];
  const defaultHtml = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planLook: 'this-period', planView: advice.defaultView,
  });
  ok(/Previous pay period/.test(defaultHtml) && /value="past:2026-08-14"/.test(defaultHtml),
    'this-period More views lists the previous completed period');
  ok(/value="past:2026-07-31"/.test(defaultHtml),
    'this-period More views lists the earlier completed period');
  ok(!/data-payday-carryover/.test(defaultHtml),
    'current-period UI does not print payday carryover');
  ok(/data-live-current-balance/.test(defaultHtml),
    'current-period UI still prints live Current Balance');
  const prevView = composer.selectedPlanView(advice, 'past:2026-08-14');
  ok(prevView && prevView.start === prev.start && prevView.end === prev.end,
    'picker selects the Forecast previous-period view');
  const prevHtml = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planLook: 'past:2026-08-14', planView: prevView,
  });
  ok(/data-historical-period/.test(prevHtml),
    'previous period renders as a completed-period sheet');
  ok(/data-payday-carryover/.test(prevHtml) && prevHtml.includes(composer.money2(CARRY)),
    'previous period prints Payday carryover $1,000');
  ok(!/data-live-current-balance/.test(prevHtml),
    'completed-period sheet does not reprint live Current Balance');
  ok(/Past gift/.test(prevHtml) && !/Live gift/.test(prevHtml),
    'previous-period print keeps Aug 20 actuals and omits Sep 4');
  ok(/Synthetic previous bill/.test(prevHtml) && !/Synthetic earlier bill/.test(prevHtml),
    'previous-period print keeps that period\'s bill');
  const earlyView = composer.selectedPlanView(advice, 'past:2026-07-31');
  ok(earlyView && earlyView.start === early.start && earlyView.end === early.end,
    'picker selects the Forecast earlier-period view');
  const earlyHtml = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planLook: 'past:2026-07-31', planView: earlyView,
  });
  ok(/data-historical-period/.test(earlyHtml),
    'earlier period renders as a completed-period sheet');
  ok(!/data-payday-carryover/.test(earlyHtml),
    'earlier period does not invent a carryover figure');
  ok(/Jul 31/.test(earlyHtml) && !/Past gift/.test(earlyHtml),
    'earlier-period print uses its own dates and not the later gift');
  ok(/Synthetic earlier bill/.test(earlyHtml) && !/Synthetic previous bill/.test(earlyHtml),
    'earlier-period print keeps that period\'s bill');
  const pick = /function selectedPlanView\([\s\S]*?\n\}/.exec(planSrc);
  ok(pick && /advice\.pastPeriodViews/.test(pick[0]) && !/Forecast\./.test(pick[0]),
    'the picker selects a Forecast-published past view; it does not compute one');
  const surface = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(surface && !/\bForecast\.[A-Za-z]+\s*\(/.test(surface[0]),
    'operatingSurfaceHtml still calls no Forecast function');
}

console.log('\n=== 6. payday-morning carryover and unknown history stay honest ===');
{
  const payday = '2026-09-11';
  const current = independentCycle(payday);
  ok(current.start === payday,
    'independent grid places Sep 11 as a Seaspan payday');
  const previous = independentCycle(addCalendarDays(payday, -1));
  const plan = historyPlan();
  plan.opening = { asOf: payday };
  plan.startingCash.breakdown[0].value = 1800;
  const advice = F.recommend(plan, payday, { targetBuffer: 500, debts });
  const prev = (advice.pastPeriodViews || []).find(p => p && p.start === previous.start);
  ok(prev && prev.paydayCarryoverKnown === true && near(prev.paydayCarryover, 1800),
    'on payday morning, previous-period carryover is that morning\'s spendable cash');
  ok(prev.paydayCarryoverSource === 'payday-morning',
    'payday-morning carryover is not labelled snapshot or income');
  const noSnap = historyPlan();
  delete noSnap.opening.paydaySnapshot;
  noSnap.opening.asOf = AS_OF;
  const unknown = F.recommend(noSnap, AS_OF, { targetBuffer: 500, debts });
  const unknownPrev = (unknown.pastPeriodViews || [])[0];
  ok(unknownPrev && unknownPrev.paydayCarryoverKnown !== true
      && unknownPrev.paydayCarryover == null,
    'mid-period without a snapshot omits carryover rather than inventing it');
}

console.log('\n=== 7. switching views does not mutate canonical state ===');
{
  const plan = historyPlan();
  const before = JSON.stringify(plan);
  const first = recommend(plan);
  const second = recommend(plan);
  composer.operatingSurfaceHtml({
    advice: first, weekly: first.weekly, recommended: first.weekly,
    planLook: 'past:2026-08-14',
    planView: composer.selectedPlanView(first, 'past:2026-08-14'),
  });
  composer.operatingSurfaceHtml({
    advice: first, weekly: first.weekly, recommended: first.weekly,
    planLook: 'this-period', planView: first.defaultView,
  });
  ok(before === JSON.stringify(plan),
    'selecting historical then current views does not mutate the plan');
  ok(JSON.stringify(first.pastPeriodViews) === JSON.stringify(second.pastPeriodViews),
    'a second recommend reprints the same completed periods');
  ok(JSON.stringify(first.defaultView.calendarPeriods)
      === JSON.stringify(second.defaultView.calendarPeriods),
    'historical navigation does not rewrite current calendar periods');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
