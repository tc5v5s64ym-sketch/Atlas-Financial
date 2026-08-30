'use strict';
/* Default Plan view contract: order, kitchen-counter labels, Forecast-owned
 * running leftover, paid bills stay listed, no invented payees.
 *
 * Independent leftover identity uses paydayAllocation allocated amounts,
 * not the page and not live household cents (L-002 / L-006).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
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
    `${source}\n({ operatingSurfaceHtml, money2 });`,
    { Forecast: F }
  );
}

function defaultGlance(html) {
  let out = String(html || '');
  const openRe = /<details\b/i;
  while (openRe.test(out)) {
    const start = out.search(openRe);
    const openMatch = out.slice(start).match(/<details\b[^>]*>/i);
    if (!openMatch) break;
    let i = start + openMatch[0].length;
    let depth = 1;
    while (i < out.length && depth > 0) {
      const rest = out.slice(i);
      const nextOpen = rest.search(/<details\b/i);
      const nextClose = rest.search(/<\/details>/i);
      if (nextClose < 0) {
        i = out.length;
        break;
      }
      if (nextOpen >= 0 && nextOpen < nextClose) {
        const nested = rest.slice(nextOpen).match(/<details\b[^>]*>/i);
        depth++;
        i += nextOpen + (nested ? nested[0].length : 8);
      } else {
        depth--;
        i += nextClose + 10;
      }
    }
    out = out.slice(0, start) + out.slice(i);
  }
  return out;
}

function bannedOnGlance(html) {
  const text = defaultGlance(html).replace(/<[^>]+>/g, ' ');
  return /paydayAllocation|thisPaydayPaid|thisPaydayDue|representedEvents|unverified-settlement|true surplus|owner-fact/.exec(text)
    || /\bunverified\b|\brepresented\b|\boverlay\b|\bForecast\b|\bAtlas\b/i.exec(text)
    || /posting unknown/i.exec(text)
    || /leftover cash|current cash flow/i.exec(text)
    || /(?<![A-Za-z])asOf(?![A-Za-z])/.exec(text);
}

const PAYDAY = '2026-08-28';
const AS_OF = '2026-08-29';
const PAYROLL = 1111.11;
const MORTGAGE = 1234.56;
const FIT = 13.13;
const CHILD = 77.77;
const BCAA = 55.55;
const TRAVEL = 18.18;
const FEES = 44.44;
const GROCERIES = 200;
const FUEL = 80;
const PETS = 40;
const EATING = 90;

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 4000 },
    nextDollar: {
      policy: 'true-surplus-highest-interest',
      provenance: 'owner-stated',
    },
    opening: {
      asOf: AS_OF,
      priorAsOf: '2026-08-19',
      representedEvents: [
        { id: 'payroll', date: PAYDAY },
        { id: 'mortgage', date: PAYDAY },
        { id: 'fit4less', date: PAYDAY },
        { id: 'childBenefit', date: '2026-08-20' },
        { id: 'bcaa-aug15-outstanding', date: '2026-08-16' },
      ],
    },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor: '2026-08-14', amount: PAYROLL, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Canada child benefit', frequency: 'monthly',
        day: 20, amount: CHILD, confidence: 'confirmed',
      },
    ],
    obligations: [
      {
        id: 'mortgage', label: 'Mortgage', frequency: 'biweekly',
        anchor: '2026-08-14', amount: MORTGAGE, confidence: 'confirmed',
        debtId: 'mortgage', effect: 'payment',
      },
      {
        id: 'travel', label: 'Travel Visa minimum', frequency: 'monthly',
        day: 26, amount: TRAVEL, confidence: 'confirmed',
        debtId: 'travelvisa', effect: 'payment',
      },
    ],
    bills: [
      {
        id: 'fit4less', label: 'Fit4Less membership', frequency: 'biweekly',
        anchor: '2026-08-14', amount: FIT, confidence: 'confirmed',
      },
      {
        id: 'tdfees', label: 'TD account fees (two accounts)', frequency: 'monthly',
        day: 30, amount: FEES, confidence: 'confirmed',
      },
      {
        id: 'bcaa-aug15-outstanding',
        label: 'BCAA insurance — 15 August posting unknown',
        frequency: 'once', date: '2026-08-16', amount: BCAA, confidence: 'confirmed',
      },
    ],
    commitments: [
      {
        id: 'camp', label: 'Synthetic camp', date: '2026-10-01',
        amount: 500, flexibility: 'required', confidence: 'confirmed',
      },
    ],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedMonthly: GROCERIES, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel & transport', class: 'essential', plannedMonthly: FUEL, ownerLine: 'Transportation / Gas' },
        { id: 'pets', label: 'Pets', class: 'essential', plannedMonthly: PETS, ownerLine: 'Dog food' },
        { id: 'restaurants', label: 'Dining out & takeaway', class: 'discretionary', plannedMonthly: EATING, ownerLine: 'Restaurants / Takeout' },
      ],
    },
  };
}

const debts = [
  {
    id: 'cashback', label: 'Synthetic high card', secured: false,
    structure: 'Revolving — test', balance: 400, rate: 26.99, payment: 20, pending: 0,
  },
  {
    id: 'mbna', label: 'Synthetic other card', secured: false,
    structure: 'Revolving — test', balance: 200, rate: 21.74, payment: 15, pending: 0,
  },
  {
    id: 'heloc', label: 'HELOC', secured: true,
    structure: 'Interest-only revolving — never amortises', balance: 1000, rate: 4.9, payment: 0, pending: 0,
  },
  {
    id: 'mortgage', label: 'Mortgage', secured: true,
    structure: 'Amortising', balance: 5000, rate: 3.64, payment: 1600, pending: 0,
  },
];

const composer = loadComposer();

console.log('=== 1. Forecast-owned running leftover identity ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const alloc = advice.paydayAllocation;
  const view = advice.defaultView;
  const futureTaken = (alloc.futureCosts || [])
    .reduce((s, r) => s + (Number(r.allocated) || 0), 0);
  const afterBills = Math.round((alloc.available - alloc.obligations.allocated) * 100) / 100;
  const afterBudget = Math.round((afterBills - alloc.essentials.allocated) * 100) / 100;
  const afterDebt = Math.round((afterBudget - alloc.extraDebt.allocated) * 100) / 100;
  const afterPurchases = Math.round((afterDebt - futureTaken) * 100) / 100;
  ok(view && alloc.runningLeftover, 'recommend publishes defaultView and runningLeftover');
  ok(near(view.currentBalance, alloc.available)
      && near(view.currentBalance, alloc.runningLeftover.currentBalance),
    'Current Balance copies paydayAllocation.available');
  ok(near(view.afterBills, afterBills)
      && near(view.afterHouseholdBudget, afterBudget)
      && near(view.afterDebtRepayment, afterDebt)
      && near(view.afterBigPurchases, afterPurchases),
    'running leftover after each displayed consume equals available minus those allocated amounts');
  ok(near(view.afterBills, alloc.runningLeftover.afterBills),
    'defaultView leftover is the paydayAllocation leftover, not a page total');
}

console.log('\n=== 2. default view order and kitchen-counter labels ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  const prompts = [
    'Current Balance',
    'Bills',
    'Balance after bills',
    'Household budget',
    'Balance after household budget',
    'Credit card to pay off first',
    'Other credit cards',
    'Balance after debt repayment',
    'Big purchases on the horizon',
    'Balance after big purchase allocation',
  ];
  let previous = -1;
  for (const prompt of prompts) {
    const at = glance.indexOf(prompt);
    ok(at > previous, `${prompt} appears on the default view in order`);
    previous = at;
  }
  ok((html.match(/data-operating-question=/g) || []).length === 10,
    'the default surface has the ten layout questions');
  ok(/Current Balance\. Not credit/.test(glance) && !/leftover cash/i.test(glance)
      && !/current cash flow/i.test(glance),
    'cash is labelled Current Balance, not leftover or current cash flow');
  const banned = bannedOnGlance(html);
  ok(!banned, 'default glance has no Forecast field names or settlement code words',
    banned && banned[0]);
  ok(/See how payday is reserved/.test(html) && !/See how payday is reserved/.test(glance),
    'allocation diagnostics stay folded');
}

console.log('\n=== 3. bills this pay period: paid stay listed, history stays off ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const ids = (advice.defaultView.bills || []).map(r => r.id);
  ok(ids.includes('mortgage') && ids.includes('fit4less'),
    'paid mortgage and gym stay on the period-bill list');
  ok(ids.includes('tdfees') && ids.includes('travel'),
    'still-due TD fees and Travel Visa min stay on the list');
  ok(!ids.includes('childBenefit') && ids.includes('bcaa-aug15-outstanding'),
    'income stays off the bills list; Aug 16 BCAA is in the calendar month');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  ok(/Mortgage · Aug 28 · PAID/.test(glance)
      && /Fit4Less membership · Aug 28 · PAID/.test(glance),
    'paid bills print PAID rather than being hidden');
  ok(/TD account fees \(two accounts\) · Aug 30 · still due/.test(glance),
    'later-in-month bills stay still due');
  ok(!/Canada child benefit/.test(glance)
      && !/Rogers/.test(glance) && !/CMAW/.test(glance),
    'glance does not invent bills or print income as a bill');
  ok(glance.includes('−' + composer.money2(MORTGAGE)),
    'bill movements print money out as −');
}

console.log('\n=== 4. household budget prints existing owner targets only ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const budgetIds = (advice.defaultView.householdBudget || []).map(r => r.id).sort();
  ok(JSON.stringify(budgetIds) === JSON.stringify(['fuel', 'groceries', 'pets', 'restaurants']),
    'prints groceries, fuel, dog food, eating out');
  ok(!(advice.defaultView.householdBudget || []).some(r => /Dale|Amanda/i.test(r.label)),
    'does not invent Dale or Amanda spending rows');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  ok(/Groceries/.test(glance) && /Fuel/.test(glance) && /Dog food/.test(glance)
      && /Eating out/.test(glance),
    'kitchen-counter budget labels print');
  ok(!/Dale spending/.test(glance) && !/Amanda spending/.test(glance),
    'missing owner-target adults are omitted');
}

console.log('\n=== 5. first card is revolving extra; HELOC stays off the card lists ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const view = advice.defaultView;
  ok(view.firstCard && view.firstCard.id === 'cashback',
    'first card is the highest-rate revolving card');
  ok(view.firstCard.extraThisPayday != null,
    'extra this payday is published even when it is $0');
  ok((view.otherCards || []).some(r => r.id === 'mbna')
      && !(view.otherCards || []).some(r => r.id === 'heloc' || r.id === 'mortgage'),
    'other cards include the remaining revolving card and omit HELOC/mortgage');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  ok(/Synthetic high card/.test(glance) && /Synthetic other card/.test(glance),
    'card labels print on the default view');
  const q6 = glance.slice(glance.indexOf('Credit card to pay off first'),
    glance.indexOf('Other credit cards'));
  const q7 = glance.slice(glance.indexOf('Other credit cards'),
    glance.indexOf('Balance after debt repayment'));
  ok(!/HELOC/.test(q6) && !/HELOC/.test(q7) && !/>Mortgage</.test(q7),
    'HELOC and mortgage are not listed as credit cards');
}

console.log('\n=== 6. big purchases print Forecast cost and $0 saved; page does not subtract ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0, debts });
  const camp = (advice.defaultView.bigPurchases || []).find(r => r.id === 'camp');
  ok(camp && near(camp.cost, 500) && near(camp.savedSoFar, 0),
    'big purchase cost is Forecast need; saved so far is $0 when Forecast has no savings plan');
  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'operatingSurfaceHtml calls no Forecast function');
  ok(fn && !/view\.currentBalance\s*-|afterBills\s*-|allocatedObligations/.test(fn[0]),
    'the payday sheet does not subtract leftover');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  ok(defaultGlance(html).includes(composer.money2(advice.defaultView.afterBills)),
    'balance after bills prints the Forecast leftover');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
