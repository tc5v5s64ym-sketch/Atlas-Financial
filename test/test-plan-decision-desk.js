'use strict';
/* Plan homepage decision desk — presentation of incumbent Forecast outputs.
 *
 * Synthetic cents are unlike live household figures. This suite proves the
 * homepage lead, spend answer, payday reservation, future-cost compression,
 * extra-debt copy, and mobile stacking. It does not become a second planner.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  }
};
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const raw = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

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
    grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
    grab(planSrc, /^function paydayActionRows\([\s\S]*?\n\}$/m, 'paydayActionRows'),
    grab(planSrc, /^function paydayCashNote\([\s\S]*?\n\}$/m, 'paydayCashNote'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function paydayCoverageNote\([\s\S]*?\n\}$/m, 'paydayCoverageNote'),
    grab(planSrc, /^const PAYDAY_ACTION_KIND = \{[\s\S]*?^\};$/m, 'PAYDAY_ACTION_KIND'),
    grab(planSrc, /^function paydayAllocationTrustNote\([\s\S]*?\n\}$/m, 'paydayAllocationTrustNote'),
    grab(planSrc, /^function paydayAllocationSheetHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSheetHtml'),
    grab(planSrc, /^function currentPeriodConfidence\([\s\S]*?\n\}$/m, 'currentPeriodConfidence'),
    grab(planSrc, /^function currentPeriodBillGroup\([\s\S]*?\n\}$/m, 'currentPeriodBillGroup'),
    grab(planSrc, /^function betweenPaydaysOperatingHtml\([\s\S]*?\n\}$/m, 'betweenPaydaysOperatingHtml'),
    grab(planSrc, /^const FUTURE_PLAN_VERDICT = \{[\s\S]*?^\};$/m, 'FUTURE_PLAN_VERDICT'),
    grab(planSrc, /^const FUTURE_PLAN_FLEXIBILITY = \{[\s\S]*?^\};$/m, 'FUTURE_PLAN_FLEXIBILITY'),
    grab(planSrc, /^function futureCostNeedsAttention\([\s\S]*?\n\}$/m, 'futureCostNeedsAttention'),
    grab(planSrc, /^function futurePlanRemainingLabel\([\s\S]*?\n\}$/m, 'futurePlanRemainingLabel'),
    grab(planSrc, /^function futurePlanMeaning\([\s\S]*?\n\}$/m, 'futurePlanMeaning'),
    grab(planSrc, /^function futurePlanRequirement\([\s\S]*?\n\}$/m, 'futurePlanRequirement'),
    grab(planSrc, /^function futurePlanTiming\([\s\S]*?\n\}$/m, 'futurePlanTiming'),
    grab(planSrc, /^function futurePlanCardHtml\([\s\S]*?\n\}$/m, 'futurePlanCardHtml'),
    grab(planSrc, /^function futureGravityHtml\([\s\S]*?\n\}$/m, 'futureGravityHtml'),
    grab(planSrc, /^function operatingDebtAnswerHtml\([\s\S]*?\n\}$/m, 'operatingDebtAnswerHtml'),
    grab(planSrc, /^const REFRESH_TRUST_STATE = \{[\s\S]*?^\};$/m, 'REFRESH_TRUST_STATE'),
    grab(planSrc, /^function refreshTrustHtml\([\s\S]*?\n\}$/m, 'refreshTrustHtml'),
    grab(planSrc, /^function cashUnsafe\([\s\S]*?\n\}$/m, 'cashUnsafe'),
    grab(planSrc, /^function todayActionRowsHtml\([\s\S]*?\n\}$/m, 'todayActionRowsHtml'),
    grab(planSrc, /^function todayDecisionHtml\([\s\S]*?\n\}$/m, 'todayDecisionHtml'),
    grab(planSrc, /^function spendDecisionHtml\([\s\S]*?\n\}$/m, 'spendDecisionHtml'),
    grab(planSrc, /^function paydayBucketRow\([\s\S]*?\n\}$/m, 'paydayBucketRow'),
    grab(planSrc, /^function postedThisPeriodHtml\([\s\S]*?\n\}$/m, 'postedThisPeriodHtml'),
    grab(planSrc, /^function glanceSignedMoney\([\s\S]*?\n\}$/m, 'glanceSignedMoney'),
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function alreadyPaidRowsHtml\([\s\S]*?\n\}$/m, 'alreadyPaidRowsHtml'),
    grab(planSrc, /^function alreadyPaidHtml\([\s\S]*?\n\}$/m, 'alreadyPaidHtml'),
    grab(planSrc, /^function stillDueItems\([\s\S]*?\n\}$/m, 'stillDueItems'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function mustLeaveHtml\([\s\S]*?\n\}$/m, 'mustLeaveHtml'),
    grab(planSrc, /^function extraDebtGlanceHtml\([\s\S]*?\n\}$/m, 'extraDebtGlanceHtml'),
    grab(planSrc, /^function runningLeftoverHtml\([\s\S]*?\n\}$/m, 'runningLeftoverHtml'),
    grab(planSrc, /^function periodBillLine\([\s\S]*?\n\}$/m, 'periodBillLine'),
    grab(planSrc, /^function calendarIncomeHtml\([\s\S]*?\n\}$/m, 'calendarIncomeHtml'),
    grab(planSrc, /^function calendarBudgetHtml\([\s\S]*?\n\}$/m, 'calendarBudgetHtml'),
    grab(planSrc, /^function calendarPeriodBillsHtml\([\s\S]*?\n\}$/m, 'calendarPeriodBillsHtml'),
    grab(planSrc, /^function extraRepaymentHtml\([\s\S]*?\n\}$/m, 'extraRepaymentHtml'),
    grab(planSrc, /^function calendarWaterfallHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallHtml'),
    grab(planSrc, /^function calendarPickerHtml\([\s\S]*?\n\}$/m, 'calendarPickerHtml'),
    grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml'),
    grab(planSrc, /^function periodBillsHtml\([\s\S]*?\n\}$/m, 'periodBillsHtml'),
    grab(planSrc, /^function householdBudgetHtml\([\s\S]*?\n\}$/m, 'householdBudgetHtml'),
    grab(planSrc, /^function budgetDigestHtml\([\s\S]*?\n\}$/m, 'budgetDigestHtml'),
    grab(planSrc, /^function firstCardHtml\([\s\S]*?\n\}$/m, 'firstCardHtml'),
    grab(planSrc, /^function otherCardsHtml\([\s\S]*?\n\}$/m, 'otherCardsHtml'),
    grab(planSrc, /^function bigPurchasesHtml\([\s\S]*?\n\}$/m, 'bigPurchasesHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, futureGravityHtml, money, money2, fmtDateLong });`,
    { Forecast: F }
  );
}

function question(html, number) {
  const start = html.indexOf(`data-operating-question="${number}"`);
  if (start < 0) return '';
  const end = html.indexOf('data-operating-question=', start + 1);
  const certainty = html.indexOf('data-operating-certainty', start + 1);
  const allocation = html.indexOf('data-payday-allocation-details', start + 1);
  let stop = html.length;
  if (end >= 0) stop = end;
  if (certainty >= 0 && certainty < stop) stop = certainty;
  if (allocation >= 0 && allocation < stop) stop = allocation;
  return html.slice(start, stop);
}

function healthyAdvice() {
  return {
    weekly: 85,
    mode: 'ok',
    infeasible: null,
    funding: { feasible: true, shortfall: 0 },
    knowledge: { days: 400 },
    currentPeriodAction: {
      mode: 'between-paydays',
      asOf: '2026-09-08',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-14',
      nextPayday: '2026-09-15',
      weeklyCap: 85,
      spendPermission: 170,
      todayActions: [],
      noMovementToday: true,
      currentShortfall: false,
      remainingClaim: 'precise',
      bills: [],
      categories: [],
      coverage: { status: 'current', remainingClaim: 'precise', coverageThrough: '2026-09-08' },
    },
    paydayAllocation: {
      mode: 'between-paydays',
      available: 412.3,
      remainder: 12.3,
      unallocated: 12.3,
      allocatedTotal: 400,
      payday: '2026-09-15',
      lines: [
        { key: 'obligations', kind: 'obligations', label: 'Keep for bills', amount: 200 },
        { key: 'essentials', kind: 'essentials', label: 'Hold for essential costs', amount: 200 },
      ],
      obligations: { wanted: 200, allocated: 200, shortfall: 0, items: [] },
      essentials: { wanted: 200, allocated: 200, shortfall: 0, items: [] },
      extraDebt: {
        allocated: 0,
        target: { id: 'high-card', label: 'Synthetic high card', confidence: 'verified' },
        consequence: null,
      },
      requiredDebtPayments: { items: [] },
      futureCosts: [],
      optional: [],
      unresolved: [],
      risks: [],
    },
    majorPlans: [
      {
        id: 'later-cost', label: 'Later required cost', when: 'Nov 2026', date: null,
        need: 2000, remaining: 0, verdict: 'ON TRACK',
        confidence: 'estimated', flexibility: 'required',
      },
    ],
  };
}

const composer = loadComposer();

console.log('=== 1. healthy / actionable safe-to-spend ===');
{
  const advice = healthyAdvice();
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q1 = question(html, '01');
  const q4 = question(html, '04');
  ok(/data-today-decision="spend-cap"/.test(html) && /This week's spend is \$85 until September 15/.test(html),
    'healthy state still publishes this week\'s spend, not leftover cash as the next move');
  ok(!/Hold this week's spend/.test(html) && !/Hold discretionary spending/.test(html),
    'healthy state does not warn the owner to hold spending');
  ok(/data-spend-decision="amount"/.test(html)
    && html.includes(`${composer.money(85)} / week`),
    'healthy state still shows this week\'s spend behind disclosure');
  ok(/\$412\.30/.test(q1) && /data-payday-cash/.test(q1) && /Current Balance\. Not credit/.test(q1),
    'Current Balance is copied from Forecast.paydayAllocation.available');
  ok(!/LEFT OVER/.test(html),
    'LEFT OVER is not the payday-sheet next move');
}

console.log('\n=== 2. no safe spending / protected shortfall ===');
{
  const advice = healthyAdvice();
  advice.mode = 'infeasible';
  advice.funding = { feasible: false, shortfall: 621.11 };
  advice.currentPeriodAction.currentShortfall = false;
  advice.currentPeriodAction.noMovementToday = true;
  advice.paydayAllocation.available = -92.17;
  advice.paydayAllocation.obligations.shortfall = 40.5;
  advice.paydayAllocation.essentials.shortfall = 80.25;
  advice.paydayAllocation.risks = [
    { id: 'obligations', reason: 'This payday cannot cover required obligations in cash.', shortfall: 40.5 },
    { id: 'essentials', reason: 'This payday cannot protect essential household spending in cash.', shortfall: 80.25 },
  ];
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q4 = question(html, '04');
  ok(/data-today-decision="hold"/.test(html)
    && /Hold this week's spend until September 15/.test(html),
    'protected shortfall still publishes one hold instruction');
  ok(!/No payment or transfer is required today/.test(html),
    'the hold instruction is not a due-date warning that also says do not pay');
  ok(/data-spend-decision="none"/.test(html)
    && /No safe amount for this week's spend until September 15/.test(html),
    'this week\'s spend states there is no safe amount');
  ok(/Why\?/.test(html) && /No safe-to-spend figure exists until that protected shortfall is solved/.test(html),
    'the incumbent infeasibility reason remains behind disclosure');
  ok(!/No action required today/.test(html) && !/No money movement needed today/.test(html)
    && !/Spend at most \$0/.test(html) && !/\$0 \/ week/.test(q4),
    'the unsafe surface does not lead with a no-action reassurance or a fake $0/week yes');
}

console.log('\n=== 3. immediate required payment due today ===');
{
  const advice = healthyAdvice();
  advice.currentPeriodAction.noMovementToday = false;
  advice.currentPeriodAction.todayActions = [{
    id: 'travel-visa', label: 'Travel Visa minimum', amount: 17.44,
    date: '2026-09-08', remaining: 17.44, confidence: 'confirmed',
  }];
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  ok(/data-today-decision="pay-today"/.test(html)
    && /Pay Travel Visa minimum \(\$17\.44\) by Sep 8/.test(html),
    'a Forecast todayAction remains the listed pay-today decision');
  ok(/data-current-today-action="travel-visa"/.test(html),
    'the same incumbent today action remains listed with its amount');
}

console.log('\n=== 4. $0 extra debt with a valid Forecast target ===');
{
  const advice = healthyAdvice();
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q5 = question(html, '05');
  ok(/data-operating-question="05"/.test(html) && /Balance after household budget/.test(q5),
    'zero extra principal still publishes leftover after household budget');
  ok(!/Put \$/.test(html.replace(/<details[\s\S]*?<\/details>/g, ''))
    && !/Pay extra/.test(html)
    && !/Extra debt money this payday goes to Synthetic high card/.test(html),
    'the Forecast target is not a pay instruction when allocated is $0');
}

console.log('\n=== 5. on-track future cost with no current-payday contribution ===');
{
  const advice = {
    knowledge: { days: 400 },
    majorPlans: [
      {
        id: 'on-track', label: 'Later required cost', when: 'Nov 2026', date: null,
        need: 2000, remaining: 0, verdict: 'ON TRACK',
        confidence: 'estimated', flexibility: 'required',
      },
      {
        id: 'gap', label: 'Near gap', when: null, date: '2026-10-02',
        need: 500, remaining: 120, verdict: 'FUNDING GAP',
        confidence: 'confirmed', flexibility: 'required',
      },
    ],
    paydayAllocation: {
      futureCosts: [
        { id: 'on-track', allocated: 0 },
        { id: 'gap', allocated: 0 },
      ],
      optional: [],
      unresolved: [{ id: 'on-track', reason: 'No exact date.' }],
    },
  };
  const html = composer.futureGravityHtml(advice);
  const sheet = composer.operatingSurfaceHtml({
    advice: Object.assign({ weekly: 90, mode: 'ok' }, advice),
    weekly: 90, recommended: 90,
  });
  const glance = sheet.replace(/<details[\s\S]*?<\/details>/g, '');
  ok(/data-future-gravity-attention/.test(html) && html.includes('data-future-gravity-id="gap"'),
    'a FUNDING GAP row stays in the primary attention set');
  ok(!/ON TRACK/.test(glance) && !/FUNDING GAP/.test(glance),
    'ON TRACK and FUNDING GAP inventory stay off the default payday glance');
  ok(/See later bills and big purchases/.test(sheet) && /Later required cost/.test(sheet)
    && html.includes('Cost still required') && html.includes('$2,000.00'),
    'the full inventory remains available behind disclosure');
  ok(/Exact date is not set yet/.test(html) && /EXACT DATE UNRESOLVED/.test(html),
    'unresolved exact date keeps its Forecast meaning in household language');
}

console.log('\n=== 6. mobile-responsive section headings stack above content ===');
{
  const css = raw('public/styles.css');
  const household = raw('public/household-view.css');
  const mobile = /@media \(max-width:700px\) \{[\s\S]*?\.current-period-category > span/.exec(css);
  ok(mobile && /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(mobile[0]),
    'narrow layout gives the operating question a single full-width column');
  ok(mobile && /operating-answer \{ grid-column:\s*auto/.test(mobile[0])
    && /operating-number \{ display:none/.test(mobile[0]),
    'narrow layout does not pin the answer to a leftover 34px number column');
  ok(/flex-direction:\s*column/.test(household),
    'the household presentation stacks prompt above answer');
  ok(!/grid-template-columns:\s*34px/.test(css) && !/grid-template-columns:\s*38px minmax\(180px/.test(css),
    'the collapsed-prompt left column is gone from both default and mobile grids');
}

console.log('\n=== 7. authority boundaries remain intact ===');
{
  const planSrc = read('public/plan.js');
  const helpers = [
    'function cashGlanceHtml',
    'function postedThisPeriodHtml',
    'function mustLeaveHtml',
    'function extraDebtGlanceHtml',
    'function todayDecisionHtml',
    'function spendDecisionHtml',
    'function paydayAllocationSummaryHtml',
    'function futureGravityHtml',
    'function operatingSurfaceHtml',
    'function cashUnsafe',
  ];
  for (const name of helpers) {
    const fn = new RegExp(name + '\\([\\s\\S]*?\\n\\}').exec(planSrc);
    ok(!!fn, `${name} is a bounded formatter`);
    ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
      `${name} calls no Forecast function`);
    ok(fn && !/\.reduce\(|monthlyFromWeekly|projectDebts|fundingSequence/.test(fn[0]),
      `${name} does not total, convert, or walk debts`);
  }
  const household = raw('public/household-view.js');
  ok(!/Forecast\s*\./.test(household) && !/paydayAllocation|currentPeriodAction/.test(household),
    'the readability layer still does not become a planner');
  ok(/data-today-decision/.test(planSrc) && /data-spend-decision/.test(planSrc)
    && /data-payday-decision/.test(planSrc),
    'the decision desk is emitted by the Forecast-consuming renderer');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
