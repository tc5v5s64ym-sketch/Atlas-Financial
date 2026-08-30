'use strict';
/* Plan payday operating sheet — six glance answers from incumbent Forecast.
 *
 * Independent identities prove the page copies Forecast.recommend fields
 * and does not mix overdraft into spendable cash, invent a second planner,
 * or publish leftover remainder as the next move. Synthetic cents are
 * unlike live household figures.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const C = require('./public/forecast-chequing.js');
const OA = require('./scripts/operating-answer.js');
const data = require('./data.json');
const periods = require('./public/periods.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, file), 'utf8'));

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
    grab(planSrc, /^function postedThisPeriodHtml\([\s\S]*?\n\}$/m, 'postedThisPeriodHtml'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function mustLeaveHtml\([\s\S]*?\n\}$/m, 'mustLeaveHtml'),
    grab(planSrc, /^function extraDebtGlanceHtml\([\s\S]*?\n\}$/m, 'extraDebtGlanceHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, mustLeaveHtml, paydayAllocationSummaryHtml, futureGravityHtml, money, money2 });`,
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

function currentAdvice() {
  const plan = data.plan;
  const asOf = data.meta.asOf;
  const advice = F.recommend(plan, asOf, {
    scenario: 'expected',
    targetBuffer: plan.defaults.targetBuffer,
    extraDebtMonthly: 0,
    disabled: [],
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: plan.nextDollar && plan.nextDollar.target,
    periods,
    paypalPerMonth: data.paypal && data.paypal.perMonth,
  });
  return { plan, asOf, advice };
}

function independentSpendable(plan, asOf) {
  const opening = F.startingCashAmount(plan);
  const todayEvents = F.expandEvents(plan, asOf, asOf, {});
  let todayIncome = 0;
  for (const e of todayEvents) {
    if (e.kind === 'income') todayIncome += e.amount;
  }
  return Math.round((opening + todayIncome) * 100) / 100;
}

const composer = loadComposer();

console.log('=== 1. one spendable cash figure, no overdraft in the number ===');
{
  const { plan, asOf, advice } = currentAdvice();
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q1 = question(html, '01');
  const independent = independentSpendable(plan, asOf);
  const chequing = C.chequingAvailability(plan, data.revolvingExtra, data.liveOverlay);
  ok(near(advice.paydayAllocation.available, independent),
    'Forecast.paydayAllocation.available independently equals spendable opening plus same-day income');
  ok(q1.includes(composer.money2(independent)),
    'Q1 cash number is that spendable figure');
  ok(/data-payday-cash/.test(q1) && /Spendable cash\. Not credit/.test(q1),
    'Q1 is labelled spendable cash, not credit');
  ok(chequing.status === 'available' && !near(chequing.available, independent),
    'chequingAvailability (which includes unused overdraft) is a different number');
  ok(!q1.includes(composer.money2(chequing.available)),
    'Plan cash does not publish the overdraft-inclusive chequingAvailability figure');
  ok((html.match(/data-spendable-cash-amount/g) || []).length === 1,
    'the payday sheet publishes exactly one spendable-cash amount');
}

console.log('\n=== 2. recommend weekly cap, never a fake $0/week yes ===');
{
  const { advice } = currentAdvice();
  const healthy = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const q3 = question(healthy, '03');
  ok(/data-spend-decision="amount"/.test(q3)
    && q3.includes(`${composer.money(advice.weekly)} / week`),
    'feasible recommend weekly is the Q3 glance amount');

  const blocked = JSON.parse(JSON.stringify(advice));
  blocked.mode = 'infeasible';
  blocked.weekly = 0;
  blocked.infeasible = {
    label: 'Synthetic protected cost', date: '2026-10-02', shortfall: 321.11,
  };
  blocked.funding = { feasible: false, shortfall: 621.11 };
  const infeasibleHtml = composer.operatingSurfaceHtml({
    advice: blocked, weekly: 0, recommended: 0,
  });
  const infeasibleQ3 = question(infeasibleHtml, '03');
  ok(/data-spend-decision="none"/.test(infeasibleQ3),
    'infeasible recommend does not publish a weekly yes');
  ok(!/\$0 \/ week/.test(infeasibleQ3) && !/Spend at most \$0/.test(infeasibleQ3),
    'infeasible weekly = 0 is not a fake $0/week yes');
  ok(/INFEASIBLE/.test(infeasibleQ3) && /Synthetic protected cost/.test(infeasibleQ3)
    && infeasibleQ3.includes(composer.money2(321.11)),
    'infeasible names the failing constraint and shortfall');

  const modeOnly = JSON.parse(JSON.stringify(advice));
  modeOnly.mode = 'infeasible';
  modeOnly.weekly = 0;
  modeOnly.infeasible = null;
  const modeOnlyQ3 = question(composer.operatingSurfaceHtml({
    advice: modeOnly, weekly: 0, recommended: 0,
  }), '03');
  ok(/data-spend-decision="none"/.test(modeOnlyQ3) && /INFEASIBLE/.test(modeOnlyQ3)
    && !/\$0 \/ week/.test(modeOnlyQ3),
    'infeasible mode without a fail object still refuses a weekly yes');
}

console.log('\n=== 3. extra debt only from paydayAllocation surplus ===');
{
  const { advice } = currentAdvice();
  const zeroAdvice = JSON.parse(JSON.stringify(advice));
  zeroAdvice.paydayAllocation.extraDebt.allocated = 0;
  zeroAdvice.paydayAllocation.extraDebt.target = { id: 'high', label: 'Synthetic high card' };
  const zero = question(composer.operatingSurfaceHtml({
    advice: zeroAdvice, weekly: zeroAdvice.weekly, recommended: zeroAdvice.weekly,
  }), '04');
  ok(/No extra debt this payday/.test(zero) && /no true surplus/.test(zero),
    'zero surplus is explicit: no extra-debt payment');
  ok(!/Pay extra/.test(zero),
    'a named target is not a pay instruction when allocated is $0');

  const plusAdvice = JSON.parse(JSON.stringify(advice));
  plusAdvice.paydayAllocation.extraDebt.allocated = 40;
  plusAdvice.paydayAllocation.extraDebt.target = { id: 'high', label: 'Synthetic high card' };
  const plus = question(composer.operatingSurfaceHtml({
    advice: plusAdvice, weekly: plusAdvice.weekly, recommended: plusAdvice.weekly,
  }), '04');
  ok(/Pay extra \$40\.00 to Synthetic high card this payday/.test(plus),
    'positive surplus names facility and amount from paydayAllocation.extraDebt');
}

console.log('\n=== 4. majorPlans set-aside this payday vs later ON TRACK ===');
{
  const html = composer.futureGravityHtml({
    knowledge: { days: 400 },
    majorPlans: [
      {
        id: 'later', label: 'Later required cost', when: 'Nov 2026',
        need: 2000, remaining: 0, verdict: 'ON TRACK',
        confidence: 'estimated', flexibility: 'required',
      },
      {
        id: 'now', label: 'Near purchase', when: null, date: '2026-09-20',
        need: 500, remaining: 120, verdict: 'AT RISK',
        confidence: 'confirmed', flexibility: 'required',
      },
    ],
    paydayAllocation: {
      futureCosts: [
        { id: 'later', allocated: 0 },
        { id: 'now', allocated: 88.5, label: 'Near purchase' },
      ],
      optional: [],
      unresolved: [],
    },
  });
  ok(/No set-aside this payday/.test(html) && /Later required cost · ON TRACK/.test(html),
    'ON TRACK with $0 this payday is later coverage, not a current set-aside');
  ok(/\$88\.50/.test(html) && /Set aside this payday/.test(html) && /Near purchase/.test(html),
    'a current paydayAllocation.futureCosts allocation is the set-aside this payday');
}

console.log('\n=== 5. unverified bills labelled unverified ===');
{
  const html = composer.mustLeaveHtml({
    obligations: {
      wanted: 50, allocated: 50, shortfall: 0, items: [
        {
          id: 'travel', label: 'Travel Visa minimum', date: '2026-08-26',
          amount: 17, allocated: 17, settlement: 'unverified', confidence: 'confirmed',
        },
        {
          id: 'mortgage', label: 'Mortgage', date: '2026-08-28',
          amount: 1600, allocated: 1600, settlement: 'upcoming', confidence: 'confirmed',
        },
      ],
    },
  });
  ok(/Travel Visa minimum · Aug 26 · unverified/.test(html) && /data-unverified-bill="true"/.test(html),
    'unverified bills are labelled unverified');
  ok(/Mortgage · Aug 28 · due/.test(html),
    'upcoming required bills stay due, not unverified');
  ok(/settlement is not proven/.test(html),
    'unverified is not treated as unpaid');
}

console.log('\n=== 5b. leftover lists earned posted actuals, not an invented spend list ===');
{
  const action = {
    mode: 'between-paydays',
    bills: [
      {
        id: 'mortgage', label: 'Mortgage', date: '2026-08-28',
        planned: 1600, actual: 1234.56, remaining: 0,
        settlement: 'represented', confidence: 'confirmed',
      },
      {
        id: 'fit4less', label: 'Fit4Less membership', date: '2026-08-28',
        planned: 11.54, actual: null, remaining: 11.54,
        settlement: 'unverified', confidence: 'confirmed',
      },
    ],
  };
  const leave = composer.mustLeaveHtml({
    obligations: {
      wanted: 11.54, allocated: 11.54, shortfall: 0, items: [
        {
          id: 'fit4less', label: 'Fit4Less membership', date: '2026-08-28',
          amount: 11.54, allocated: 11.54, settlement: 'unverified', confidence: 'confirmed',
        },
      ],
    },
  }, action);
  ok(/data-payday-posted-actuals/.test(leave) && /Mortgage · Aug 28 · posted/.test(leave),
    'must-leave lists the represented mortgage from currentPeriodAction');
  ok(/\$1,234\.56/.test(leave),
    'posted mortgage uses Forecast actual, not a page-invented total');
  ok(!/Fit4Less membership · Aug 28 · posted/.test(leave),
    'unverified Fit4Less is not presented as posted');
  const leftover = composer.paydayAllocationSummaryHtml({
    lines: [{ key: 'obligations', kind: 'obligations', label: 'Bills', amount: 11.54 }],
    remainder: 88.12,
    obligations: { allocated: 11.54, wanted: 11.54, shortfall: 0, items: [] },
    essentials: { allocated: 0, wanted: 0, shortfall: 0 },
    extraDebt: { allocated: 0 },
    futureCosts: [],
    mode: 'between-paydays',
    payday: '2026-09-11',
  }, action);
  ok(/Left after that/.test(leftover) && /data-payday-posted-actuals/.test(leftover)
    && /Mortgage · Aug 28 · posted/.test(leftover),
    'leftover lists earned posted actuals beside remainder');
  ok(/Fit4Less membership · Aug 28 · unverified/.test(leave),
    'Fit4Less stays unverified on the reserved-bills list');
}

console.log('\n=== 6. operating-answer copies Forecast; page does not recalculate ===');
{
  const oa = read('scripts/operating-answer.js');
  ok(/Forecast\.recommend/.test(oa) && /paydayAllocation\.available/.test(oa),
    'operating-answer.js asks Forecast.recommend and copies paydayAllocation.available');
  ok(!/function paydayAllocation|function currentPeriodAction|function recommend\(/.test(oa),
    'operating-answer.js does not reimplement Forecast authorities');
  const { plan, asOf, advice } = currentAdvice();
  const packet = OA.fromRefreshedState({
    plan, debts: data.debts, revolvingExtra: data.revolvingExtra,
    meta: { asOf },
  }, { mode: 'canonical' });
  ok(near(packet.moneyAvailable.value, advice.paydayAllocation.available),
    'operating-answer moneyAvailable copies Forecast.paydayAllocation.available');
  ok(near(packet.currentSpendingPermission.weekly, advice.weekly),
    'operating-answer weekly copies Forecast.recommend.weekly');
  ok(packet.extraDebtAllocation.allocated === advice.paydayAllocation.extraDebt.allocated,
    'operating-answer extra debt copies Forecast.paydayAllocation.extraDebt');

  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'operatingSurfaceHtml calls no Forecast function');
  ok(fn && !/\.reduce\(|monthlyFromWeekly|projectDebts|fundingSequence/.test(fn[0]),
    'the payday sheet does not total, convert, or walk debts');
}

console.log('\n=== leftover remainder is not the next move ===');
{
  const html = composer.operatingSurfaceHtml({
    advice: {
      weekly: 90,
      mode: 'ok',
      currentPeriodAction: {
        mode: 'between-paydays', nextPayday: '2026-09-15',
        todayActions: [], bills: [], noMovementToday: true,
        remainingClaim: 'unavailable',
      },
      paydayAllocation: {
        available: 100, remainder: 1.14, extraDebt: { allocated: 0 },
        obligations: { items: [] }, futureCosts: [], unresolved: [], risks: [],
      },
      majorPlans: [],
    },
    weekly: 90, recommended: 90,
  });
  const q6 = question(html, '06');
  ok(/Spend at most \$90\/week until September 15/.test(q6),
    'with no pay/extra/set-aside, the next move is the recommend weekly cap');
  ok(!/\$1\.14/.test(q6) && !/LEFT OVER/.test(q6),
    'allocation remainder is not the next-move instruction');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
