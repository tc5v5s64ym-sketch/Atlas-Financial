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
const F = require('./public/forecast.js');
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
const read = file => sourceText(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const raw = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

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
  let stop = html.length;
  if (end >= 0) stop = end;
  if (certainty >= 0 && certainty < stop) stop = certainty;
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
  const q2 = question(html, '02');
  ok(/data-today-decision="none"/.test(q1) && /No action required today\./.test(q1),
    'healthy state leads with no action required');
  ok(!/Hold discretionary spending/.test(q1),
    'healthy state does not warn the owner to hold spending');
  ok(/data-spend-decision="amount"/.test(q2)
    && q2.includes(`${composer.money(85)} / week`),
    'healthy state shows the incumbent weekly permission prominently');
  ok(/\$412\.30/.test(q1) && /Spendable cash · not credit/.test(q1),
    'spendable cash is copied from Forecast.paydayAllocation.available');
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
  const q1 = question(html, '01');
  const q2 = question(html, '02');
  ok(/data-today-decision="hold"/.test(q1)
    && /Hold discretionary spending until September 15/.test(q1),
    'protected shortfall leads with hold-spending, not a reassuring no-movement headline');
  ok(/No payment or transfer is required today\. Protected cash needs are still unfunded\./.test(q1),
    'no-movement and unfunded cash are distinguished as different facts');
  ok(/Protected shortfall \$621\.11/.test(q1)
    && /Required bills are short \$40\.50/.test(q1)
    && /Everyday essentials are short \$80\.25/.test(q1),
    'incumbent shortfall fields are shown without summing a new figure');
  ok(/data-spend-decision="none"/.test(q2)
    && /No safe spending amount until September 15/.test(q2),
    'Q2 states there is no safe spending amount without requiring a paragraph first');
  ok(/Why\?/.test(q2) && /No safe-to-spend figure exists until that protected shortfall is solved/.test(q2),
    'the incumbent infeasibility reason remains behind disclosure');
  ok(!/No action required today/.test(q1) && !/No money movement needed today/.test(q1),
    'the unsafe surface does not lead with a no-action reassurance');
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
  const q1 = question(html, '01');
  ok(/data-today-decision="pay-today"/.test(q1)
    && /Pay the \$17\.44 Travel Visa minimum by Sep 8/.test(q1),
    'a Forecast todayAction becomes the primary decision');
  ok(/data-current-today-action="travel-visa"/.test(q1),
    'the same incumbent today action remains listed with its amount');
}

console.log('\n=== 4. $0 extra debt with a valid Forecast target ===');
{
  const advice = healthyAdvice();
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q5 = question(html, '05');
  ok(/No extra debt payment this payday/.test(q5)
    && q5.includes('$0.00 extra principal allocated this payday'),
    'zero extra principal is explicit');
  ok(/Debt target:/.test(q5) && /Synthetic high card/.test(q5)
    && !/Extra debt money this payday goes to Synthetic high card/.test(q5),
    'the Forecast target is named without implying a payment happened');
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
  ok(/data-future-gravity-attention/.test(html) && html.includes('data-future-gravity-id="gap"'),
    'a FUNDING GAP row stays in the primary attention set');
  ok(/data-future-gravity-compact="on-track"/.test(html)
    && /Later required cost · ON TRACK/.test(html),
    'an ON TRACK cost is named without dumping its full card into the first screen');
  ok(/No set-aside this payday\. Forecast still treats it as required/.test(html),
    'ON TRACK + $0 this payday is explained as later coverage, not a contradiction');
  ok(/See all future costs/.test(html) && html.includes('Cost still required')
    && html.includes('$2,000.00'),
    'the full 365-day inventory remains available behind disclosure');
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
