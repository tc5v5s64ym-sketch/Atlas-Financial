'use strict';
/* Two calendar-half waterfalls: opening chain, paid bills, income, HELOC
 * cash once, card mins once, current-cash identity, Bell outside remaining,
 * equal-half household budget, scheduled-due bill assignment, two bill
 * totals, subscriptions bills-only (not a household-budget hold),
 * Dale/Amanda guilt-free actuals from evidenced shopping txs.
 *
 * Dates and totals are hand-computed from cadence and the calendar, then
 * Forecast is asked whether it reproduced them (L-002 / L-006).
 *
 * `node test-plan-calendar-waterfalls.js`
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
    `${source}\n({ operatingSurfaceHtml, money2 });`,
    { Forecast: F }
  );
}

function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p.id === id);
}
function billsOf(p) {
  return (p && p.bills) || [];
}
function incomeOf(p) {
  return (p && p.income) || [];
}
function budgetRow(p, id) {
  return ((p && p.householdBudget) || []).find(r => r.id === id) || null;
}
function roundCent(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
// Independent of Forecast.calendarHalfPlanned: equal split, leftover
// cents on Period 2 so the two sides add back to monthly. Not 15/daysInMonth.
function halfPlanned(monthly, half) {
  const first = roundCent(Number(monthly) / 2);
  return half === 1 ? first : roundCent(Number(monthly) - first);
}
function spendOn(txs, label, start, through) {
  let spent = 0;
  for (const tx of txs) {
    if (!tx || !tx.date || tx.categoryLabel !== label) continue;
    if (start && tx.date < start) continue;
    if (through && tx.date > through) continue;
    spent += Number(tx.amount) || 0;
  }
  return roundCent(spent);
}
function actualsPacket(txs, asOf) {
  return {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: asOf,
    coverageStart: '2026-08-01',
    coverageThrough: asOf,
    pendingCoverage: 'complete',
    transactions: txs,
  };
}

const HOLD_IDS = [
  'groceries', 'fuel', 'household', 'pets', 'restaurants',
  'dale-guilt-free', 'amanda-guilt-free',
];
const PERIOD_PLANNED = {
  groceries: 450,
  fuel: 325,
  household: 37.50,
  pets: 27.50,
  restaurants: 200,
  'dale-guilt-free': 150,
  'amanda-guilt-free': 150,
};
const PERIOD_PLANNED_TOTAL = 1340;
const BOTH_PERIODS_PLANNED = 2680;
const SUBSCRIPTION_BILLS = [
  { id: 'youtube-premium', label: 'YouTube Premium', day: 2, amount: 17, half: 1 },
  { id: 'icloud-storage', label: 'iCloud Storage', day: 14, amount: 13, half: 1 },
  { id: 'chatgpt-plus-dale', label: 'ChatGPT Plus — Dale', day: 14, amount: 28, half: 1 },
  { id: 'chatgpt-plus-amanda', label: 'ChatGPT Plus — Amanda', day: 14, amount: 24.99, half: 1 },
  { id: 'netflix', label: 'Netflix', day: 17, amount: 26.87, half: 2 },
  { id: 'spotify', label: 'Spotify', day: 17, amount: 26.87, half: 2 },
  { id: 'google-storage-100gb', label: 'Google storage — 100 GB', day: 31, amount: 3.13, half: 2 },
];

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: '2026-08-30' },
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor: '2026-08-14', amount: 2000, confidence: 'confirmed',
      },
      {
        id: 'amanda15', label: 'Amanda salary 15th', frequency: 'monthly',
        day: 15, amount: 2100, confidence: 'confirmed',
      },
      {
        id: 'amandaEnd', label: 'Amanda salary month-end', frequency: 'monthly',
        day: 31, amount: 2300, confidence: 'confirmed',
      },
    ],
    obligations: [
      {
        id: 'mortgage', label: 'Mortgage', frequency: 'biweekly',
        anchor: '2026-08-14', amount: 1600, confidence: 'confirmed',
        debtId: 'mortgage', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'heloc', label: 'HELOC interest', frequency: 'monthly',
        day: 31, amount: 80, confidence: 'confirmed',
        debtId: 'heloc', effect: 'capitalise', nonCash: true,
        cashPayment: 80, cashDay: 21, cashFirstDue: '2026-09-21',
        cashLabel: 'HELOC minimum', cashConfidence: 'estimated',
        payingAccount: 'chequing-a',
      },
      {
        id: 'triangle', label: 'Triangle Mastercard minimum', frequency: 'monthly',
        day: 7, firstDue: '2026-09-07', amount: 250, confidence: 'estimated',
        debtId: 'triangle', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'cashback', label: 'TD Cash Back Visa minimum', frequency: 'monthly',
        day: 1, firstDue: '2026-10-01', amount: 170, confidence: 'estimated',
        debtId: 'cashback', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'tdcc', label: 'TD credit card minimum', frequency: 'monthly',
        day: 17, firstDue: '2026-09-17', amount: 94.03, confidence: 'estimated',
        debtId: 'tdcc', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'mbna-aug31', label: 'Amazon.ca Mastercard — August statement minimum',
        frequency: 'once', date: '2026-08-31', amount: 158.27, confidence: 'confirmed',
        debtId: 'mbna', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'mbna', label: 'Amazon.ca Mastercard minimum', frequency: 'monthly',
        day: 31, firstDue: '2026-09-30', amount: 158.27, confidence: 'estimated',
        debtId: 'mbna', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'travel', label: 'Travel Visa minimum', frequency: 'monthly',
        day: 26, amount: 17, confidence: 'estimated',
        debtId: 'travelvisa', effect: 'payment', payingAccount: 'chequing-a',
      },
    ],
    bills: [
      {
        id: 'day15', label: 'Day 15 bill', frequency: 'monthly',
        day: 15, amount: 15, confidence: 'confirmed', payingAccount: 'chequing-a',
      },
      {
        id: 'netflix', label: 'Netflix', frequency: 'monthly',
        day: 17, amount: 26.87, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'spotify', label: 'Spotify', frequency: 'monthly',
        day: 17, amount: 26.87, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'google-storage-100gb', label: 'Google storage — 100 GB',
        frequency: 'monthly', day: 31, amount: 3.13, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'ultimate-guitar', label: 'Ultimate Guitar', frequency: 'yearly',
        month: 5, day: 8, amount: 50, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'icloud-storage', label: 'iCloud Storage', frequency: 'monthly',
        day: 14, amount: 13, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'youtube-premium', label: 'YouTube Premium', frequency: 'monthly',
        day: 2, amount: 17, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'chatgpt-plus-dale', label: 'ChatGPT Plus — Dale', frequency: 'monthly',
        day: 14, amount: 28, confidence: 'estimated',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'chatgpt-plus-amanda', label: 'ChatGPT Plus — Amanda', frequency: 'monthly',
        day: 14, amount: 24.99, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'bell', label: 'Bell', frequency: 'monthly',
        amount: 121, confidence: 'estimated', needsDate: true,
        budgetCategory: 'telecom', payingAccount: 'chequing-a',
      },
    ],
    commitments: [
      {
        id: 'seattle-nov', label: 'Seattle tournament #1', amount: 1200,
        when: 'Nov 2026', flexibility: 'required', confidence: 'estimated',
      },
    ],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedMonthly: 900, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel', class: 'essential', plannedMonthly: 650, ownerLine: 'Fuel' },
        { id: 'household', label: 'Household', class: 'essential', plannedMonthly: 75, ownerLine: 'Household' },
        { id: 'pets', label: 'Pets', class: 'essential', plannedMonthly: 55, ownerLine: 'Dog food' },
        { id: 'restaurants', label: 'Dining', class: 'discretionary', plannedMonthly: 400, ownerLine: 'Eating out' },
        { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary', plannedMonthly: 300, ownerLine: 'Dale guilt-free spending' },
        { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary', plannedMonthly: 300, ownerLine: 'Amanda guilt-free spending' },
        { id: 'shopping', label: 'Shopping', class: 'discretionary', from: ['Shopping', 'Personal'], plannedMonthly: null },
        { id: 'health', label: 'Health', class: 'essential', from: ['Health'], plannedMonthly: null },
        { id: 'sport', label: 'Sport', class: 'discretionary', from: ['Sport & fitness'], plannedMonthly: null },
        { id: 'subscriptions', label: 'Subscriptions', class: 'discretionary', plannedMonthly: null },
      ],
    },
  };
}

const debts = [
  { id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving', balance: 100, rate: 21.99, payment: 250, pending: 0 },
  { id: 'cashback', label: 'Cash Back', secured: false, structure: 'Revolving', balance: 200, rate: 26.99, payment: 170, pending: 0 },
  { id: 'tdcc', label: 'TD personal Visa', secured: false, structure: 'Revolving', balance: 90, rate: 24.99, payment: 94.03, pending: 0 },
  { id: 'mbna', label: 'Amazon.ca Mastercard', secured: false, structure: 'Revolving', balance: 150, rate: 21.74, payment: 158.27, pending: 0 },
  { id: 'travelvisa', label: 'Travel Visa', secured: false, structure: 'Revolving', balance: 80, rate: 19.99, payment: 17, pending: 0 },
  { id: 'heloc', label: 'HELOC', secured: true, structure: 'Interest-only revolving', balance: 1000, rate: 4.9, payment: 0, pending: 0, cashPayment: 0, interestTreatment: 'capitalised' },
  { id: 'mortgage', label: 'Mortgage', secured: true, structure: 'Amortising', balance: 5000, rate: 3.64, payment: 1600, pending: 0 },
];

const composer = loadComposer();

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
      if (nextClose < 0) { i = out.length; break; }
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

console.log('=== 1. Period 1 projected ending flows into Period 2 opening ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-10', { targetBuffer: 500, debts });
  const view = advice.defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  ok(p1 && p1.role === 'active' && p2 && p2.role === 'future',
    'as-of Aug 10: Period 1 is live, Period 2 is future');
  ok(p1.openingKnown && near(p1.opening, advice.paydayAllocation.available),
    'Period 1 opens from existing Forecast current cash');
  ok(p2.openingKnown && near(p2.opening, p1.projectedEnding),
    'Period 2 opening equals Period 1 projected ending',
    p2 && p1 && `${p2.opening} vs ${p1.projectedEnding}`);
  ok(!near(p2.opening, advice.paydayAllocation.available)
      || near(p1.projectedEnding, advice.paydayAllocation.available),
    'Period 2 does not reuse today\'s current balance as its own opening');
  const p2Income = incomeOf(p2).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  ok(p2.available != null && near(p2.available, p2.opening + p2.incomeAdded)
      && near(p2.incomeAdded, p2Income),
    'future Period 2 adds all of that period\'s income after the inherited opening');
}

console.log('\n=== 2. Paid bills are not deducted twice ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-20', {
    targetBuffer: 500, debts,
    representedEvents: [{ id: 'netflix', date: '2026-08-17' }],
  });
  const p2 = period(advice.defaultView, 'calendar-16-end');
  const netflix = billsOf(p2).find(r => r.id === 'netflix');
  ok(netflix && netflix.status === 'PAID' && near(netflix.remaining, 0),
    'represented Netflix stays visible as PAID with remaining $0');
  const remainingIds = billsOf(p2).filter(r => r.status !== 'PAID').map(r => r.id);
  ok(!remainingIds.includes('netflix'),
    'PAID Netflix is omitted from remaining-bills');
  const independentRemaining = billsOf(p2)
    .filter(r => r.status !== 'PAID')
    .reduce((s, r) => s + (Number(r.remaining) || 0), 0);
  ok(near(p2.remainingBills, independentRemaining),
    'remaining-bills equals the unpaid rows only',
    `${p2.remainingBills} vs ${independentRemaining}`);
  ok(p2.available != null && near(p2.afterRemainingBills, p2.available - p2.remainingBills),
    'leftover after remaining bills subtracts unpaid rows once');
}

console.log('\n=== 3. Income never lands in remaining-bills ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-08-20', { targetBuffer: 500, debts }).defaultView;
  for (const p of view.calendarPeriods) {
    ok(!(p.bills || []).some(r => r.kind === 'income'),
      `${p.label} bills list has no income rows`);
    ok((p.income || []).every(r => r.kind === 'income'),
      `${p.label} income sits in its own block`);
  }
  ok(view.billSections.length === 2
      && !view.billSections.some(s => /Seaspan|Amanda|payroll|salary/i.test(s.label)),
    'income dates do not spawn extra bill sections');
}

console.log('\n=== 4. HELOC cash is not double-counted with capitalised interest ===');
{
  const plan = syntheticPlan();
  const aug = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts }).defaultView;
  const augHeloc = (aug.bills || []).filter(r => r.id === 'heloc' || r.cashMinimum);
  ok(augHeloc.length === 0,
    'August has no remaining HELOC cash row (cashFirstDue 2026-09-21)');
  const sep = F.recommend(plan, '2026-09-10', { targetBuffer: 500, debts }).defaultView;
  const p2 = period(sep, 'calendar-16-end');
  const heloc = billsOf(p2).filter(r => r.id === 'heloc');
  ok(heloc.length === 1 && heloc[0].date === '2026-09-21' && near(heloc[0].amount, 80),
    'September HELOC cash min prints once in Period 2 on the 21st');
  const events = F.expandEvents(plan, '2026-09-01', '2026-09-30');
  ok(events.filter(e => e.id === 'heloc').every(e => e.kind === 'noncash'),
    'expandEvents still emits only the capitalise event');
  ok(!events.some(e => e.id === 'heloc' && e.kind !== 'noncash'),
    'HELOC cash is not a second household cash event on the walk');
}

console.log('\n=== 5. Each active card min appears once, including paid ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts }).defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  const triangle = billsOf(p1).filter(r => r.id === 'triangle');
  const cashback = billsOf(p1).filter(r => r.id === 'cashback');
  const tdcc = billsOf(p2).filter(r => r.id === 'tdcc');
  const travel = billsOf(p2).filter(r => r.id === 'travel');
  const amazonOnce = billsOf(p2).filter(r => r.id === 'mbna-aug31');
  const amazonMonthly = billsOf(p2).filter(r => r.id === 'mbna');
  ok(triangle.length === 1 && triangle[0].date === '2026-08-07'
      && near(triangle[0].amount, 250) && triangle[0].status === 'PAID',
    'Triangle min day 7 prints once in Period 1 as PAID');
  ok(cashback.length === 1 && cashback[0].date === '2026-08-01'
      && near(cashback[0].amount, 170) && cashback[0].status === 'PAID',
    'Cash Back min day 1 prints once in Period 1 as PAID');
  ok(tdcc.length === 1 && tdcc[0].date === '2026-08-17'
      && near(tdcc[0].amount, 94.03) && tdcc[0].status === 'PAID',
    'tdcc min $94.03 Aug 17 prints once in Period 2 as PAID');
  ok(travel.length === 1 && travel[0].date === '2026-08-26',
    'Travel Visa min day 26 prints once in Period 2');
  ok(amazonOnce.length === 1 && amazonOnce[0].date === '2026-08-31'
      && amazonMonthly.length === 0,
    'August Amazon min is the once row, not also the monthly row');
}

console.log('\n=== 6. Current cash identity; no BILLS-minus-spend rewrite ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts });
  const view = advice.defaultView;
  const p2 = period(view, 'calendar-16-end');
  const p1 = period(view, 'calendar-1-15');
  ok(p2 && p2.role === 'active' && p1 && p1.role === 'lookback',
    'as-of Aug 30: Period 1 is lookback, Period 2 is the live waterfall');
  ok(near(p2.opening, advice.paydayAllocation.available)
      && near(p2.opening, F.startingCashAmount(plan)),
    'live Period 2 opening matches paydayAllocation.available / starting cash',
    p2 && `${p2.opening} vs ${advice.paydayAllocation.available}`);
  ok(p1.lookback && p1.opening !== advice.paydayAllocation.available,
    'lookback Period 1 does not reuse today\'s current balance');
  const src = read('public/forecast.js');
  ok(!/chequing-a[\s\S]{0,80}minus[\s\S]{0,40}spend|BILLS ACCOUNT[\s\S]{0,80}- posted/i.test(src),
    'Forecast does not redefine current cash as BILLS ACCOUNT minus posted spend');
}

console.log('\n=== 7. Bell undated is visible and excluded from remaining ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts }).defaultView;
  const bell = (view.undatedBills || []).find(r => r.id === 'bell');
  ok(bell && bell.needsDate && bell.date == null && near(bell.amount, 121),
    'Bell prints as needs-date with no fabricated day');
  for (const p of view.calendarPeriods) {
    ok(!(p.bills || []).some(r => r.id === 'bell'),
      `${p.label} remaining-bills does not include undated Bell`);
  }
  const html = composer.operatingSurfaceHtml({
    advice: { defaultView: view, paydayAllocation: { available: view.calendarPeriods[1].opening, cashBasis: { asOf: '2026-08-30' } } },
    weekly: 0, recommended: 0,
  });
  ok(/needs confirmation/i.test(html) && /Not included in either period's remaining bills/.test(html),
    'page prints Bell outside both period remaining totals');
}

console.log('\n=== 8. Extra debt never takes leftover below the $500 floor ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-10', { targetBuffer: 500, debts });
  for (const p of advice.defaultView.calendarPeriods) {
    if (p.afterHouseholdBudget == null) continue;
    if (p.afterHouseholdBudget >= 500) {
      ok(p.projectedEnding + 0.005 >= 500,
        `${p.label} ending stays at or above the $500 floor when leftover could`);
    } else {
      ok(near(p.extraDebt.allocated, 0),
        `${p.label} extra is $0 when leftover is already under the floor`);
    }
  }
}

console.log('\n=== 9. Live August 30 sheet: lookback P1, live P2, card mins, HELOC ===');
{
  const live = require('./data.json');
  const advice = F.recommend(live.plan, '2026-08-30', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  });
  const view = advice.defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  ok(p1 && p1.role === 'lookback' && p2 && p2.role === 'active',
    'live Aug 30: Period 1 lookback, Period 2 live');
  ok(near(p2.opening, advice.paydayAllocation.available),
    'live Period 2 opening is existing Forecast current cash');
  const ids = (p, id) => billsOf(p).filter(r => r.id === id);
  ok(ids(p1, 'triangle').length === 1 && ids(p1, 'triangle')[0].status === 'PAID',
    'live Triangle min appears once in Period 1, paid');
  ok(ids(p1, 'cashback').length === 1 && ids(p1, 'cashback')[0].status === 'PAID',
    'live Cash Back min appears once in Period 1, paid');
  ok(ids(p2, 'tdcc').length === 1 && near(ids(p2, 'tdcc')[0].amount, 94.03)
      && ids(p2, 'tdcc')[0].status === 'PAID',
    'live tdcc $94.03 Aug 17 appears once in Period 2, paid');
  ok(ids(p2, 'travel').length === 1,
    'live Travel Visa min appears once in Period 2');
  ok(ids(p2, 'mbna-aug31').length === 1 && ids(p2, 'mbna').length === 0,
    'live August Amazon min is the once row only');
  ok(ids(p1, 'heloc').length === 0 && ids(p2, 'heloc').length === 0,
    'live August has no HELOC cash row');
  const sep = F.recommend(live.plan, '2026-09-10', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  }).defaultView;
  const sepHeloc = billsOf(period(sep, 'calendar-16-end')).filter(r => r.id === 'heloc');
  ok(sepHeloc.length === 1 && sepHeloc[0].date === '2026-09-21',
    'next HELOC cash min is 2026-09-21 in Period 2');
  const seattle = (p2.bigPurchases || []).filter(r => /seattle/i.test(r.id + r.label));
  ok(seattle.every(r => near(r.cost, 1200)),
    'Seattle tournament amounts are the $1,200 plan.commitments facts');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  ok(/Pay Period 1/.test(html) && /Pay Period 2/.test(html),
    'page names the two calendar waterfalls');
  ok(/data-calendar-waterfall="calendar-16-end"/.test(html),
    'default print shows the active Period 2 waterfall');
  ok(!/\bForecast\b|\bAtlas\b|\brepresented\b|\bunverified\b|\basOf\b/.test(glance),
    'default glance has no Forecast/Atlas jargon or settlement code words');
  ok(!/CMAW|Pixieset|Mailchimp/i.test(glance),
    'cancelled CMAW / Pixieset / Mailchimp are not tracked on the sheet');
}

console.log('\n=== 10. grocery actuals stay in their calendar half ===');
{
  const asOf = '2026-08-20';
  const p1Start = '2026-08-01';
  const p1End = '2026-08-15';
  const p2Start = '2026-08-16';
  const txs = [
    { date: '2026-08-05', amount: 40.10, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-08-18', amount: 55.20, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-08-25', amount: 70.00, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-07-30', amount: 99.00, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-09-02', amount: 88.00, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-08-04', amount: 11.00, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash' },
    { date: '2026-08-17', amount: 14.00, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash' },
    { date: '2026-08-03', amount: 5.00, pending: false, categoryLabel: 'Household', accountRole: 'household-cash' },
    { date: '2026-08-19', amount: 6.00, pending: false, categoryLabel: 'Household', accountRole: 'household-cash' },
    { date: '2026-08-06', amount: 3.00, pending: false, categoryLabel: 'Pets', accountRole: 'household-cash' },
    { date: '2026-08-18', amount: 4.00, pending: false, categoryLabel: 'Pets', accountRole: 'household-cash' },
    { date: '2026-08-07', amount: 8.00, pending: false, categoryLabel: 'Dining', accountRole: 'household-cash' },
    { date: '2026-08-16', amount: 9.00, pending: false, categoryLabel: 'Dining', accountRole: 'household-cash' },
  ];
  const plan = syntheticPlan();
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  }).defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  const groc1 = budgetRow(p1, 'groceries');
  const groc2 = budgetRow(p2, 'groceries');
  const expectP1 = spendOn(txs, 'Groceries', p1Start, p1End < asOf ? p1End : asOf);
  const expectP2 = spendOn(txs, 'Groceries', p2Start, asOf);
  ok(near(expectP1, 40.10) && near(expectP2, 55.20),
    'independent window: 5 Aug in P1, 18 Aug in P2, 25 Aug after as-of and July/Sept outside');
  ok(groc1 && near(groc1.spent, expectP1) && !near(groc1.spent, expectP2)
      && !near(groc1.spent, 40.10 + 55.20),
    'P1 groceries actual is the P1 tx only, not P2 and not full-month',
    groc1 && String(groc1.spent));
  ok(groc2 && near(groc2.spent, expectP2) && !near(groc2.spent, expectP1)
      && !near(groc2.spent, 40.10 + 55.20 + 70),
    'P2 groceries actual is the in-half, on-or-before as-of tx only',
    groc2 && String(groc2.spent));
  ok(groc1 && groc2 && !near(groc1.spent, 99) && !near(groc2.spent, 99)
      && !near(groc1.spent, 88) && !near(groc2.spent, 88)
      && !near(groc2.spent, 70),
    'txs outside the month, and P2 dates after as-of, are in neither half');
  const src = read('public/forecast.js');
  const fn = /function calendarHouseholdBudget\([\s\S]*?\n  \}/.exec(src);
  ok(fn && /sumCategoryActuals\(plan, through, start, opts\)/.test(fn[0])
      && /calendarHalfThrough\(asOf, end\)/.test(fn[0])
      && /actualsReady && start/.test(fn[0]),
    'waterfall actuals call sumCategoryActuals with that half\'s start and a through no later than half end or as-of');
  const mtd = spendOn(txs, 'Groceries', '2026-08-01', asOf);
  ok(groc1 && groc2 && near(roundCent(groc1.spent + groc2.spent), mtd)
      && near(mtd, 40.10 + 55.20),
    'P1 spent + P2 spent through asOf equals month-to-asOf groceries',
    groc1 && groc2 && `${groc1.spent} + ${groc2.spent} vs ${mtd}`);
  const remainingCats = [
    ['fuel', 'Fuel', 11, 14],
    ['household', 'Household', 5, 6],
    ['pets', 'Pets', 3, 4],
    ['restaurants', 'Dining', 8, 9],
  ];
  for (const [id, label, p1Amt, p2Amt] of remainingCats) {
    const r1 = budgetRow(p1, id);
    const r2 = budgetRow(p2, id);
    ok(r1 && r2 && near(r1.spent, p1Amt) && near(r2.spent, p2Amt)
        && !near(r1.spent, p1Amt + p2Amt) && !near(r2.spent, p1Amt + p2Amt),
      `${id} actuals stay in their calendar half`,
      r1 && r2 && `${r1.spent} / ${r2.spent}`);
  }
  const withIncome = JSON.parse(JSON.stringify(plan));
  withIncome.income.push({
    id: 'bonus16', label: 'One-off deposit 16th', frequency: 'once',
    date: '2026-08-16', amount: 400, confidence: 'confirmed',
  });
  const viewInc = F.recommend(withIncome, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  }).defaultView;
  ok((viewInc.calendarPeriods || []).length === 2
      && !(viewInc.calendarPeriods || []).some(p => /bonus|deposit/i.test(p.label)),
    'income on the 16th does not open a third bill-planning window');
  const p1i = period(viewInc, 'calendar-1-15');
  const p2i = period(viewInc, 'calendar-16-end');
  ok(budgetRow(p1i, 'groceries') && near(budgetRow(p1i, 'groceries').spent, expectP1)
      && budgetRow(p2i, 'groceries') && near(budgetRow(p2i, 'groceries').spent, expectP2),
    'income on the 16th does not dump P1 grocery spend into P2');
}

console.log('\n=== 11. each half\'s planned is the locked owner period table ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-08-20', { targetBuffer: 500, debts }).defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  const dayCountP1 = roundCent(900 * 15 / 31);
  const dayCountP2 = roundCent(900 - dayCountP1);
  function plannedSum(p) {
    return roundCent((p.householdBudget || [])
      .filter(r => !r.needsConfirmation)
      .reduce((s, r) => s + (Number(r.planned) || 0), 0));
  }
  ok(near(plannedSum(p1), PERIOD_PLANNED_TOTAL)
      && near(plannedSum(p2), PERIOD_PLANNED_TOTAL)
      && near(roundCent(plannedSum(p1) + plannedSum(p2)), BOTH_PERIODS_PLANNED),
    'each half\'s planned rows sum to 1340; P1+P2 planned = 2680',
    `${plannedSum(p1)} + ${plannedSum(p2)}`);
  for (const id of HOLD_IDS) {
    const cat = plan.budget.categories.find(c => c.id === id);
    const monthly = roundCent(cat.plannedMonthly);
    const r1 = budgetRow(p1, id);
    const r2 = budgetRow(p2, id);
    const expect1 = halfPlanned(monthly, 1);
    const expect2 = halfPlanned(monthly, 2);
    ok(r1 && r2 && near(r1.planned, expect1) && near(r2.planned, expect2)
        && near(roundCent(r1.planned + r2.planned), monthly)
        && near(r1.planned, PERIOD_PLANNED[id]) && near(r2.planned, PERIOD_PLANNED[id]),
      `${id}: P1 planned + P2 planned equals plannedMonthly and the locked period amount`,
      r1 && r2 && `${r1.planned} + ${r2.planned} vs ${monthly}`);
    ok(r1 && r2 && !near(r1.planned, monthly) && !near(r2.planned, monthly),
      `${id}: waterfall planned is the period share, not full-month`);
  }
  const g1 = budgetRow(p1, 'groceries');
  const g2 = budgetRow(p2, 'groceries');
  ok(g1 && g2 && near(g1.planned, 450) && near(g2.planned, 450)
      && !near(g1.planned, 900) && !near(g1.planned, dayCountP1)
      && !near(g2.planned, dayCountP2),
    'groceries 900 splits 450 / 450, not 15/31 leftover on Period 2',
    g1 && g2 && `${g1.planned} / ${g2.planned}`);
  const src = read('public/forecast.js');
  const plannedFn = /function calendarHalfPlanned\([\s\S]*?\n  \}/.exec(src);
  ok(plannedFn && /monthly\)\s*\/\s*2/.test(plannedFn[0])
      && !/15\s*\/\s*days/.test(plannedFn[0])
      && !/CALENDAR_MONTH_DAYS/.test(plannedFn[0]),
    'calendarHalfPlanned is monthly/2, not 15/daysInMonth or CALENDAR_MONTH_DAYS');
  const labels = (p1.householdBudget || []).map(r => r.label);
  ok(labels.includes('Groceries') && labels.includes('Fuel')
      && labels.includes('Household') && labels.includes('Dog food')
      && labels.includes('Eating out')
      && labels.includes('Dale guilt-free spending')
      && labels.includes('Amanda guilt-free spending'),
    'printed labels are the locked plain-language names');
  ok(!(p1.householdBudget || []).some(r => r.id === 'shopping' && !r.needsConfirmation)
      && !(p1.householdBudget || []).some(r => /Personal$/.test(r.label) && !r.needsConfirmation),
    'combined Personal / shopping is not a planned household-budget row');
}

console.log('\n=== 12. subscriptions exist only under Bills, never as a household-budget hold ===');
{
  const plan = syntheticPlan();
  plan.opening.asOf = '2026-08-10';
  const advice = F.recommend(plan, '2026-08-10', { targetBuffer: 500, debts });
  const p1 = period(advice.defaultView, 'calendar-1-15');
  const p2 = period(advice.defaultView, 'calendar-16-end');
  for (const p of [p1, p2]) {
    ok(!(p.householdBudget || []).some(r => r.id === 'subscriptions'
        || /subscriptions/i.test(r.label || '')),
      `${p.label} householdBudget has no subscriptions row`);
    ok(!(p.householdBudget || []).some(r => r.id === 'health' || /Medical/i.test(r.label || '')),
      `${p.label} householdBudget has no Medical / health row`);
    ok(!(p.householdBudget || []).some(r => r.id === 'sport' || /Children & sports/i.test(r.label || '')),
      `${p.label} householdBudget has no Children & sports row`);
  }
  const netflix = billsOf(p2).find(r => r.id === 'netflix');
  ok(netflix && netflix.status !== 'PAID' && near(netflix.remaining, 26.87)
      && netflix.date === '2026-08-17' && /BILLS ACCOUNT/i.test(netflix.payerLabel || ''),
    'Netflix sits in Period 2 remaining-bills with amount, date, and paying account');
  const independentHold = HOLD_IDS.reduce((sum, id) => {
    const cat = plan.budget.categories.find(c => c.id === id);
    const planned = halfPlanned(cat.plannedMonthly, 2);
    return roundCent(sum + Math.max(0, planned));
  }, 0);
  ok(near(independentHold, PERIOD_PLANNED_TOTAL),
    'independent P2 hold of the seven planned rows is 1340',
    String(independentHold));
  ok(near(p2.budgetHold, independentHold)
      && !near(p2.budgetHold, independentHold + 300)
      && !near(p2.budgetHold, independentHold + 150)
      && !near(p2.budgetHold, PERIOD_PLANNED_TOTAL + 300),
    'leftover hold omits the old $300 subscriptions target',
    `${p2.budgetHold} vs ${independentHold}`);
  ok(p2.afterRemainingBills != null && p2.afterHouseholdBudget != null
      && near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - independentHold))
      && !near(p2.afterHouseholdBudget,
        roundCent(p2.afterRemainingBills - independentHold - netflix.remaining)),
    'after household budget does not subtract the Netflix bill a second time');
  const halfId = half => half === 1 ? 'calendar-1-15' : 'calendar-16-end';
  for (const spec of SUBSCRIPTION_BILLS) {
    const host = spec.half === 1 ? p1 : p2;
    const other = spec.half === 1 ? p2 : p1;
    const row = billsOf(host).find(r => r.id === spec.id);
    const copies = billsOf(p1).concat(billsOf(p2)).filter(r => r.id === spec.id);
    ok(row && copies.length === 1 && near(row.amount, spec.amount)
        && String(row.date).slice(8, 10) === String(spec.day).padStart(2, '0')
        && /BILLS ACCOUNT/i.test(row.payerLabel || '')
        && (row.status === 'PAID' || row.status === 'still due' || row.status === 'pending'),
      `${spec.id} appears once in ${halfId(spec.half)} with amount, date, account, status`,
      row && `${row.date} ${row.amount} ${row.status} ${row.payerLabel}`);
    ok(!billsOf(other).some(r => r.id === spec.id),
      `${spec.id} is absent from the other calendar half`);
  }
  const ug = billsOf(p1).concat(billsOf(p2)).find(r => r.id === 'ultimate-guitar');
  ok(!ug, 'Ultimate Guitar yearly May 8 is not an August household-budget or August bill');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planCalendarShow: 'calendar-16-end',
  });
  const budgetBlock = /data-payday-household-budget[\s\S]*?<\/div>\s*<\/div>/.exec(html);
  ok(budgetBlock && !/Subscriptions/i.test(budgetBlock[0])
      && !/included in Bills, remaining not deducted/.test(budgetBlock[0]),
    'Household Budget block does not print a subscriptions line');
  ok(/data-period-bill="netflix"/.test(html) && /Netflix/.test(html)
      && /BILLS ACCOUNT/.test(html),
    'page prints Netflix as a Bills row with paying account');
  ok(!/Pixieset|Mailchimp|CMAW/i.test(html),
    'Pixieset / Mailchimp / CMAW stay off the sheet');
}

console.log('\n=== 13. overspend remaining is negative; leftover does not take the overshoot ===');
{
  const asOf = '2026-08-20';
  const txs = [
    { date: '2026-08-18', amount: 2000, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const plan = syntheticPlan();
  const advice = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  });
  const p2 = period(advice.defaultView, 'calendar-16-end');
  const groc = budgetRow(p2, 'groceries');
  const planned = halfPlanned(900, 2);
  const spent = spendOn(txs, 'Groceries', p2.start, asOf);
  const remaining = roundCent(planned - spent);
  ok(groc && near(groc.planned, planned) && near(groc.spent, spent)
      && near(groc.remaining, remaining) && remaining < 0,
    'groceries remaining is negative after posted overspend',
    groc && `${groc.remaining}`);
  ok(groc && near(groc.hold, 0),
    'overspent groceries hold used in leftover is $0, not the negative remaining');
  const independentHold = HOLD_IDS.reduce((sum, id) => {
    const cat = plan.budget.categories.find(c => c.id === id);
    const rowPlanned = halfPlanned(cat.plannedMonthly, 2);
    const rowSpent = id === 'groceries' ? spent : 0;
    const rowRemaining = roundCent(rowPlanned - rowSpent);
    return roundCent(sum + Math.max(0, rowRemaining));
  }, 0);
  ok(near(p2.budgetHold, independentHold),
    'hold total is unused period planned, not planned minus the overshoot');
  ok(p2.afterRemainingBills != null && p2.afterHouseholdBudget != null
      && near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - independentHold)),
    'leftover after household budget does not subtract the already-posted overshoot');
  const ifSpentAgain = roundCent(p2.afterRemainingBills - independentHold - spent);
  const ifOvershootAgain = roundCent(p2.afterRemainingBills - independentHold - (spent - planned));
  ok(!near(p2.afterHouseholdBudget, ifSpentAgain)
      && !near(p2.afterHouseholdBudget, ifOvershootAgain),
    'leftover is not opening-chain minus posted groceries a second time');
}

console.log('\n=== 13b. Dale/Amanda shopping actuals; unlabeled needs confirmation ===');
{
  const asOf = '2026-08-20';
  const txs = [
    {
      date: '2026-08-18', amount: 40, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', tags: ['dale'],
    },
    {
      date: '2026-08-19', amount: 25, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', note: 'Amanda',
    },
    {
      date: '2026-08-19', amount: 12, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash',
    },
    {
      date: '2026-08-18', amount: 33, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', atlasAccountId: 'chequing-b',
      accountLabel: 'WEEKLY SPENDING',
    },
    {
      date: '2026-08-18', amount: 18, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', atlasAccountId: 'amanda-debt-payments',
      accountLabel: 'TENNIS INCOME',
    },
    {
      date: '2026-08-05', amount: 9, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', tags: ['dale'],
    },
    {
      date: '2026-08-18', amount: 50, pending: false, categoryLabel: 'Health',
      accountRole: 'household-cash',
    },
    {
      date: '2026-08-18', amount: 22, pending: false, categoryLabel: 'Sport & fitness',
      accountRole: 'household-cash',
    },
  ];
  const plan = syntheticPlan();
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  }).defaultView;
  const p1 = period(view, 'calendar-1-15');
  const p2 = period(view, 'calendar-16-end');
  const dale2 = budgetRow(p2, 'dale-guilt-free');
  const amanda2 = budgetRow(p2, 'amanda-guilt-free');
  const unassigned2 = (p2.householdBudget || []).find(r => r.needsConfirmation);
  const dale1 = budgetRow(p1, 'dale-guilt-free');
  ok(dale2 && near(dale2.spent, 40) && near(dale2.planned, 150) && near(dale2.hold, 110),
    'fixture shopping tx with Dale evidence lands on Dale in that period',
    dale2 && String(dale2.spent));
  ok(amanda2 && near(amanda2.spent, 25) && near(amanda2.planned, 150),
    'fixture shopping tx with Amanda evidence lands on Amanda',
    amanda2 && String(amanda2.spent));
  ok(unassigned2 && unassigned2.needsConfirmation && near(unassigned2.planned, 0)
      && near(unassigned2.hold, 0) && near(unassigned2.spent, 12 + 33)
      && /needs confirmation/i.test(unassigned2.label),
    'unlabeled shopping and WEEKLY SPENDING shopping are needs-confirmation, not attributed',
    unassigned2 && String(unassigned2.spent));
  ok(dale2 && !near(dale2.spent, 40 + 33) && !near(dale2.spent, 40 + 9),
    'chequing-b / WEEKLY SPENDING is not Dale; P1 Dale tx stays in P1');
  ok(amanda2 && !near(amanda2.spent, 25 + 18),
    'TENNIS INCOME / amanda-debt-payments is not Amanda guilt-free spending');
  ok(dale1 && near(dale1.spent, 9),
    'period date windows still apply to Dale guilt-free actuals');
  ok(!(p2.householdBudget || []).some(r => r.id === 'health' || /Medical/i.test(r.label || '')),
    'medical Lunch Money txs do not reappear as a Household Budget row');
  ok(!(p2.householdBudget || []).some(r => r.id === 'sport' || /Children & sports/i.test(r.label || '')),
    'sports Lunch Money txs do not reappear as a Household Budget row');
  const groc2 = budgetRow(p2, 'groceries');
  const fuel2 = budgetRow(p2, 'fuel');
  ok(groc2 && near(groc2.spent, 0) && fuel2 && near(fuel2.spent, 0),
    'medical and sports txs are not dumped into Groceries or Fuel');
  const holdWithoutUnassigned = HOLD_IDS.reduce((sum, id) => {
    const cat = plan.budget.categories.find(c => c.id === id);
    const rowPlanned = halfPlanned(cat.plannedMonthly, 2);
    let rowSpent = 0;
    if (id === 'dale-guilt-free') rowSpent = 40;
    if (id === 'amanda-guilt-free') rowSpent = 25;
    return roundCent(sum + Math.max(0, roundCent(rowPlanned - rowSpent)));
  }, 0);
  ok(near(p2.budgetHold, holdWithoutUnassigned)
      && !near(p2.budgetHold, holdWithoutUnassigned + 12 + 33),
    'leftover hold is the seven planned rows only; confirmation spent is not a hold');
  const html = composer.operatingSurfaceHtml({
    advice: { defaultView: view, paydayAllocation: { available: p2.opening, cashBasis: { asOf } } },
    weekly: 0, recommended: 0, planCalendarShow: 'calendar-16-end',
  });
  ok(/Dale guilt-free spending/.test(html) && /Amanda guilt-free spending/.test(html)
      && /needs confirmation/.test(html)
      && !/calendarHalfPlanned|sumCategoryActuals/.test(html),
    'page prints Dale/Amanda and the confirmation line in plain language');
}

console.log('\n=== 14. page prints Forecast; leftover is not computed in plan.js ===');
{
  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'operatingSurfaceHtml calls no Forecast function');
  const liveSrc = fs.readFileSync(path.join(__dirname, 'scripts', 'live-plan.js'), 'utf8');
  ok(!/fs\.writeFileSync/.test(liveSrc),
    'live-plan.js still does not write data.json');
}

function displayedAbs(row) {
  if (!row) return 0;
  if (row.movement != null && isFinite(Number(row.movement))) {
    return Math.abs(Number(row.movement));
  }
  return Math.abs(Number(row.amount) || 0);
}

function independentScheduleDate(plan, id, eventDate) {
  const recs = (plan.bills || []).concat(plan.obligations || []);
  const row = recs.find(r => r && r.id === id);
  if (!row || row.frequency !== 'once') return eventDate;
  let sibling = null;
  for (const rec of recs) {
    if (!rec || rec.frequency === 'once' || rec.day == null) continue;
    if (id !== rec.id && id.startsWith(rec.id + '-')
        && (!sibling || rec.id.length > sibling.id.length)) sibling = rec;
  }
  if (!sibling) return eventDate;
  const [y, m, postedDay] = String(eventDate).split('-').map(Number);
  let year = y;
  let month = m;
  if (postedDay < Number(sibling.day)) {
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
  }
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const due = Math.min(Number(sibling.day), dim);
  return `${year}-${String(month).padStart(2, '0')}-${String(due).padStart(2, '0')}`;
}

function weekendReservePlan() {
  const plan = syntheticPlan();
  plan.bills.push(
    {
      id: 'bcaa', label: 'BCAA insurance', frequency: 'monthly',
      day: 15, firstDue: '2026-09-15', amount: 82.96, confidence: 'confirmed',
      payingAccount: 'chequing-a',
    },
    {
      id: 'bcaa-aug15-outstanding',
      label: 'BCAA insurance — 15 August posting unknown',
      frequency: 'once', date: '2026-08-16', amount: 82.96,
      confidence: 'confirmed', payingAccount: 'chequing-a',
    },
    {
      id: 'icbc', label: 'ICBC insurance', frequency: 'monthly',
      day: 15, firstDue: '2026-09-15', amount: 99.91, confidence: 'confirmed',
      payingAccount: 'chequing-a',
    },
    {
      id: 'icbc-aug15-outstanding',
      label: 'ICBC insurance — 15 August posting unknown',
      frequency: 'once', date: '2026-08-16', amount: 99.91,
      confidence: 'confirmed', payingAccount: 'chequing-a',
    },
    {
      id: 'resp', label: 'RESP contribution', frequency: 'monthly',
      day: 15, firstDue: '2026-09-15', amount: 100, confidence: 'confirmed',
      payingAccount: 'chequing-a',
    },
    {
      id: 'resp-aug15-outstanding',
      label: 'RESP contribution — 15 August posting unknown',
      frequency: 'once', date: '2026-08-16', amount: 100,
      confidence: 'confirmed', payingAccount: 'chequing-a',
    }
  );
  return plan;
}

const WEEKEND_IDS = [
  'bcaa-aug15-outstanding', 'icbc-aug15-outstanding', 'resp-aug15-outstanding',
];

console.log('\n=== 15. weekend posting keeps 15 August bills in Period 1, paid ===');
{
  const asOf = '2026-08-20';
  const plan = weekendReservePlan();
  const representedEvents = [
    { id: 'bcaa-aug15-outstanding', date: '2026-08-16' },
    { id: 'icbc-aug15-outstanding', date: '2026-08-16' },
    { id: 'resp-aug15-outstanding', date: '2026-08-16' },
    { id: 'day15', date: '2026-08-15' },
    { id: 'netflix', date: '2026-08-17' },
  ];
  const representedActuals = [
    { id: 'bcaa-aug15-outstanding', date: '2026-08-16', actual: 82.96, postedOn: '2026-08-16' },
    { id: 'icbc-aug15-outstanding', date: '2026-08-16', actual: 99.91, postedOn: '2026-08-16' },
    { id: 'resp-aug15-outstanding', date: '2026-08-16', actual: 100, postedOn: '2026-08-16' },
    { id: 'day15', date: '2026-08-15', actual: 15, postedOn: '2026-08-16' },
    { id: 'netflix', date: '2026-08-17', actual: 26.87, postedOn: '2026-08-18' },
  ];
  const advice = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    representedEvents,
    currentPeriodActuals: {
      schema: 'atlas-current-period-actuals/v1',
      observationAsOf: asOf,
      coverageStart: '2026-08-01',
      coverageThrough: asOf,
      pendingCoverage: 'complete',
      representedActuals,
      transactions: [],
    },
  });
  const p1 = period(advice.defaultView, 'calendar-1-15');
  const p2 = period(advice.defaultView, 'calendar-16-end');
  const three = 82.96 + 99.91 + 100;
  for (const id of WEEKEND_IDS) {
    const row = billsOf(p1).find(r => r.id === id);
    ok(row && row.status === 'PAID' && row.date === '2026-08-15',
      `${id} is Period 1 PAID on scheduled 15 August, not the 16th post date`,
      row && `${row.status} ${row.date}`);
    ok(!billsOf(p2).some(r => r.id === id),
      `${id} is absent from Period 2`);
  }
  const p2RemainingIds = billsOf(p2).filter(r => r.status !== 'PAID').map(r => r.id);
  ok(WEEKEND_IDS.every(id => !p2RemainingIds.includes(id)),
    'BCAA / ICBC / RESP are absent from Period 2 remaining bills to pay');
  ok(p2.role === 'active' && near(p2.opening, advice.paydayAllocation.available),
    'Period 2 current cash stays paydayAllocation.available');
  const ifDeductedAgain = roundCent(p2.available - p2.remainingBills - three);
  ok(p2.afterRemainingBills != null
      && near(p2.afterRemainingBills, p2.available - p2.remainingBills)
      && !near(p2.afterRemainingBills, ifDeductedAgain),
    'Period 2 leftover does not deduct the three paid 15 August bills from current cash');
  const live = require('./data.json');
  const liveView = F.recommend(live.plan, '2026-08-30', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  }).defaultView;
  const liveP1 = period(liveView, 'calendar-1-15');
  const liveP2 = period(liveView, 'calendar-16-end');
  for (const id of WEEKEND_IDS) {
    ok(billsOf(liveP1).some(r => r.id === id) && !billsOf(liveP2).some(r => r.id === id),
      `live ${id} sits in Pay Period 1, not Period 2`);
  }
}

console.log('\n=== 16. paid bills use scheduled due, not post date ===');
{
  const asOf = '2026-08-20';
  const plan = weekendReservePlan();
  const representedEvents = [
    { id: 'bcaa-aug15-outstanding', date: '2026-08-16' },
    { id: 'icbc-aug15-outstanding', date: '2026-08-16' },
    { id: 'resp-aug15-outstanding', date: '2026-08-16' },
    { id: 'day15', date: '2026-08-15' },
    { id: 'netflix', date: '2026-08-17' },
  ];
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts, representedEvents,
    currentPeriodActuals: {
      schema: 'atlas-current-period-actuals/v1',
      observationAsOf: asOf,
      coverageStart: '2026-08-01',
      coverageThrough: asOf,
      pendingCoverage: 'complete',
      representedActuals: [
        { id: 'bcaa-aug15-outstanding', date: '2026-08-16', actual: 82.96, postedOn: '2026-08-16' },
        { id: 'icbc-aug15-outstanding', date: '2026-08-16', actual: 99.91, postedOn: '2026-08-16' },
        { id: 'resp-aug15-outstanding', date: '2026-08-16', actual: 100, postedOn: '2026-08-16' },
        { id: 'day15', date: '2026-08-15', actual: 15, postedOn: '2026-08-16' },
        { id: 'netflix', date: '2026-08-17', actual: 26.87, postedOn: '2026-08-18' },
      ],
      transactions: [],
    },
  }).defaultView;
  const paid = [];
  for (const p of view.calendarPeriods) {
    for (const row of billsOf(p)) {
      if (row.status === 'PAID') paid.push({ period: p.id, row });
    }
  }
  ok(paid.length > 0, 'fixture has paid bills to assign');
  const recs = (plan.bills || []).concat(plan.obligations || []);
  for (const { period: periodId, row } of paid) {
    const planRow = recs.find(r => r && r.id === row.id);
    const seedDate = (planRow && planRow.date) || row.date;
    const due = independentScheduleDate(plan, row.id, seedDate);
    const expectHalf = Number(String(due).slice(8, 10)) <= 15
      ? 'calendar-1-15' : 'calendar-16-end';
    ok(periodId === expectHalf,
      `${row.id} paid bill sits in the scheduled-due half ${expectHalf}`,
      `${periodId} vs ${expectHalf} due ${due}`);
    ok(row.date !== '2026-08-16' || expectHalf === 'calendar-16-end',
      `${row.id} is not parked in Period 2 solely because Lunch Money posted the 16th`);
  }
  const day15 = paid.find(x => x.row.id === 'day15');
  ok(day15 && day15.period === 'calendar-1-15' && day15.row.date === '2026-08-15',
    'monthly day-15 bill posted the 16th stays Period 1 on the 15th');
}

console.log('\n=== 17. bills block totals: this period vs remaining to pay ===');
{
  const asOf = '2026-08-20';
  const plan = weekendReservePlan();
  const advice = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    representedEvents: [
      { id: 'bcaa-aug15-outstanding', date: '2026-08-16' },
      { id: 'netflix', date: '2026-08-17' },
    ],
  });
  const view = advice.defaultView;
  for (const p of view.calendarPeriods) {
    const rows = billsOf(p);
    const independentTotal = roundCent(rows.reduce((s, r) => s + displayedAbs(r), 0));
    const stillDue = rows.filter(r => r.status !== 'PAID' && !r.needsDate);
    const independentRemaining = roundCent(stillDue.reduce((s, r) => (
      s + Math.abs(Number(r.remaining != null ? r.remaining : r.amount) || 0)
    ), 0));
    ok(near(p.totalBillsThisPeriod, independentTotal),
      `${p.label} total bills this period equals sum of displayed rows`,
      `${p.totalBillsThisPeriod} vs ${independentTotal}`);
    ok(near(p.remainingBills, independentRemaining),
      `${p.label} remaining bills to pay equals still-due rows`,
      `${p.remainingBills} vs ${independentRemaining}`);
    if (p.available != null) {
      ok(near(p.afterRemainingBills, roundCent(p.available - p.remainingBills)),
        `${p.label} after remaining bills is available minus remaining, not total`);
      if (!near(independentTotal, independentRemaining)) {
        ok(!near(p.afterRemainingBills, roundCent(p.available - p.totalBillsThisPeriod)),
          `${p.label} leftover is not available minus the paid-inclusive total`);
      }
    }
  }
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planCalendarShow: 'both',
  });
  ok(/Total bills this period/.test(html) && /Remaining bills to pay/.test(html),
    'page prints both bill totals in plain language');
  ok(!/>Remaining bills </.test(html),
    'old remaining-only label is gone');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
