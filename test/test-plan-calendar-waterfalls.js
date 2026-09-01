'use strict';
/* Two payday-cycle waterfalls: opening chain, paid bills, income, HELOC
 * cash once, card mins once, current-cash identity, Bell outside remaining,
 * Household Budget on the Seaspan 14-day payday cycle (now the same window
 * as the operating Pay Period), scheduled-due bill assignment, two bill
 * totals, subscriptions bills-only (not a household-budget hold),
 * Dale/Amanda guilt-free actuals from evidenced shopping txs.
 *
 * Dates and totals are hand-computed from cadence and the calendar, then
 * Forecast is asked whether it reproduced them (L-002 / L-006).
 *
 * `node test/test-plan-calendar-waterfalls.js`
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
    grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function liveOperatingPlanNote\([\s\S]*?\n\}$/m, 'liveOperatingPlanNote'),
    grab(planSrc, /^function currentOperatingUnavailableHtml\([\s\S]*?\n\}$/m, 'currentOperatingUnavailableHtml'),
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
    grab(planSrc, /^function periodBillsHtml\([\s\S]*?\n\}$/m, 'periodBillsHtml'),
    grab(planSrc, /^function householdBudgetHtml\([\s\S]*?\n\}$/m, 'householdBudgetHtml'),
    grab(planSrc, /^function budgetDigestHtml\([\s\S]*?\n\}$/m, 'budgetDigestHtml'),
    grab(planSrc, /^function firstCardHtml\([\s\S]*?\n\}$/m, 'firstCardHtml'),
    grab(planSrc, /^function otherCardsHtml\([\s\S]*?\n\}$/m, 'otherCardsHtml'),
    grab(planSrc, /^function bigPurchasesHtml\([\s\S]*?\n\}$/m, 'bigPurchasesHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function unavailableOperatingSurfaceHtml\([\s\S]*?\n\}$/m, 'unavailableOperatingSurfaceHtml'),
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
function withoutSeaspan(plan) {
  const copy = JSON.parse(JSON.stringify(plan));
  copy.income = (copy.income || []).filter(row =>
    row && row.id !== 'payroll' && !/seaspan/i.test(row.label || ''));
  return copy;
}
function malformedSeaspan(plan, anchor) {
  const copy = JSON.parse(JSON.stringify(plan));
  const row = (copy.income || []).find(r => r && r.id === 'payroll');
  if (row) {
    if (anchor === undefined) delete row.anchor;
    else row.anchor = anchor;
  }
  return copy;
}
function roomyDebts() {
  return debts.map(d => d && d.secured
    ? d
    : Object.assign({}, d, { balance: 25000 }));
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
    coverageStart: '2026-07-01',
    coverageThrough: asOf,
    pendingCoverage: 'complete',
    transactions: txs,
  };
}

const HOLD_IDS = [
  'groceries', 'fuel', 'household', 'pets', 'restaurants',
  'dale-guilt-free', 'amanda-guilt-free',
];
const CYCLE_PLANNED = {
  groceries: 900,
  fuel: 325,
  household: 37.50,
  pets: 100,
  restaurants: 200,
  'dale-guilt-free': 150,
  'amanda-guilt-free': 150,
};
const CYCLE_PLANNED_TOTAL = 1862.50;
const SEASPAN_ANCHOR = '2026-08-14';
const MONTH_SHORT = [
  '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Independent of Forecast.spendingCycle: 14-day steps from Friday 2026-08-14.
function paydayCycleWindow(asOf) {
  let start = SEASPAN_ANCHOR;
  while (start > asOf) start = F.addDays(start, -14);
  let next = F.addDays(start, 14);
  while (next <= asOf) {
    start = next;
    next = F.addDays(start, 14);
  }
  const end = F.addDays(next, -1);
  const [ , ms, ds ] = String(start).split('-').map(Number);
  const [ , me, de ] = String(end).split('-').map(Number);
  return {
    start,
    end,
    nextPayday: next,
    days: F.diffDays(start, end) + 1,
    label: 'Spending cycle: ' + MONTH_SHORT[ms] + ' ' + ds + '–' + MONTH_SHORT[me] + ' ' + de,
  };
}
function reconSum(row) {
  return roundCent(((row && row.recon) || []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
}
const SUBSCRIPTION_BILLS = [
  { id: 'youtube-premium', label: 'YouTube Premium', day: 2, amount: 17, window: 'this' },
  { id: 'icloud-storage', label: 'iCloud Storage', day: 14, amount: 13, window: 'next' },
  { id: 'chatgpt-plus-dale', label: 'ChatGPT Plus — Dale', day: 14, amount: 28, window: 'next' },
  { id: 'chatgpt-plus-amanda', label: 'ChatGPT Plus — Amanda', day: 14, amount: 24.99, window: 'next' },
  { id: 'netflix', label: 'Netflix', day: 17, amount: 26.87, window: 'next' },
  { id: 'spotify', label: 'Spotify', day: 17, amount: 26.87, window: 'next' },
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
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedWeekly: 450, plannedMonthly: null, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel', 'Fuel & transport'], plannedPayday: 325, plannedMonthly: null, ownerLine: 'Fuel' },
        { id: 'household', label: 'Household', class: 'essential', plannedPayday: 37.5, plannedMonthly: null, ownerLine: 'Household' },
        { id: 'pets', label: 'Pets', class: 'essential', plannedPayday: 100, plannedMonthly: null, ownerLine: 'Dog food' },
        { id: 'restaurants', label: 'Dining', class: 'discretionary', from: ['Restaurants', 'Dining', 'Fast Food', 'Food Delivery'], plannedPayday: 200, plannedMonthly: null, ownerLine: 'Eating out' },
        { id: 'dale-guilt-free', label: 'Dale guilt-free spending', class: 'discretionary', plannedPayday: 150, plannedMonthly: null, ownerLine: 'Dale guilt-free spending' },
        { id: 'amanda-guilt-free', label: 'Amanda guilt-free spending', class: 'discretionary', plannedPayday: 150, plannedMonthly: null, ownerLine: 'Amanda guilt-free spending' },
        { id: 'shopping', label: 'Shopping', class: 'discretionary', from: ['Shopping', 'Personal'], plannedMonthly: null },
        { id: 'health', label: 'Health', class: 'essential', from: ['Health'], plannedMonthly: null },
        { id: 'sport', label: 'Sport', class: 'discretionary', from: ['Sport & fitness'], plannedMonthly: null },
        { id: 'subscriptions', label: 'Subscriptions', class: 'discretionary', plannedMonthly: null },
        { id: 'insurance', label: 'Insurance', class: 'essential', from: ['Insurance'], plannedMonthly: null },
        { id: 'telecom', label: 'Telecom', class: 'essential', from: ['Telecom'], plannedMonthly: null },
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
  const p1 = period(view, 'this-pay-period');
  const p2 = period(view, 'next-pay-period');
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
  const p1 = period(advice.defaultView, 'this-pay-period');
  const netflix = billsOf(p1).find(r => r.id === 'netflix');
  ok(netflix && netflix.status === 'PAID' && near(netflix.remaining, 0),
    'represented Netflix stays visible as PAID with remaining $0');
  const remainingIds = billsOf(p1).filter(r => r.status !== 'PAID').map(r => r.id);
  ok(!remainingIds.includes('netflix'),
    'PAID Netflix is omitted from remaining-bills');
  const independentRemaining = billsOf(p1)
    .filter(r => r.status !== 'PAID')
    .reduce((s, r) => s + (Number(r.remaining) || 0), 0);
  ok(near(p1.remainingBills, independentRemaining),
    'remaining-bills equals the unpaid rows only',
    `${p1.remainingBills} vs ${independentRemaining}`);
  ok(p1.available != null && near(p1.afterRemainingBills, p1.available - p1.remainingBills),
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
  const thisHeloc = billsOf(period(aug, 'this-pay-period'))
    .filter(r => r.id === 'heloc' || r.cashMinimum);
  ok(thisHeloc.length === 0,
    'Aug 28–Sep 10 has no HELOC cash row (cashFirstDue 2026-09-21)');
  const sep = F.recommend(plan, '2026-09-10', { targetBuffer: 500, debts }).defaultView;
  const p2 = period(sep, 'next-pay-period');
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
  const early = F.recommend(plan, '2026-08-10', { targetBuffer: 500, debts }).defaultView;
  const mid = F.recommend(plan, '2026-08-20', { targetBuffer: 500, debts }).defaultView;
  const late = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts }).defaultView;
  const earlyThis = period(early, 'this-pay-period');
  const midThis = period(mid, 'this-pay-period');
  const lateThis = period(late, 'this-pay-period');
  const triangle = billsOf(earlyThis).filter(r => r.id === 'triangle');
  const cashback = billsOf(earlyThis).filter(r => r.id === 'cashback');
  const tdcc = billsOf(midThis).filter(r => r.id === 'tdcc');
  const travel = billsOf(midThis).filter(r => r.id === 'travel');
  const amazonOnce = billsOf(lateThis).filter(r => r.id === 'mbna-aug31');
  const amazonMonthly = billsOf(lateThis).filter(r => r.id === 'mbna');
  ok(triangle.length === 1 && triangle[0].date === '2026-08-07'
      && near(triangle[0].amount, 250) && triangle[0].status === 'PAID',
    'Triangle min day 7 prints once in the Jul 31–Aug 13 payday window as PAID');
  ok(cashback.length === 1 && cashback[0].date === '2026-08-01'
      && near(cashback[0].amount, 170) && cashback[0].status === 'PAID',
    'Cash Back min day 1 prints once in the Jul 31–Aug 13 payday window as PAID');
  ok(tdcc.length === 1 && tdcc[0].date === '2026-08-17'
      && near(tdcc[0].amount, 94.03) && tdcc[0].status === 'PAID',
    'tdcc min $94.03 Aug 17 prints once in the Aug 14–27 payday window as PAID');
  ok(travel.length === 1 && travel[0].date === '2026-08-26',
    'Travel Visa min day 26 prints once in the Aug 14–27 payday window');
  ok(amazonOnce.length === 1 && amazonOnce[0].date === '2026-08-31'
      && amazonMonthly.length === 0,
    'August Amazon min is the once row, not also the monthly row');
}

console.log('\n=== 6. Current cash identity; no BILLS-minus-spend rewrite ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts });
  const view = advice.defaultView;
  const p2 = period(view, 'next-pay-period');
  const p1 = period(view, 'this-pay-period');
  ok(p1 && p1.role === 'active' && p2 && p2.role === 'future',
    'as-of Aug 30: This Pay Period is live, Next is future');
  ok(near(p1.opening, advice.paydayAllocation.available)
      && near(p1.opening, F.startingCashAmount(plan)),
    'live This Pay Period opening matches paydayAllocation.available / starting cash',
    p1 && `${p1.opening} vs ${advice.paydayAllocation.available}`);
  ok(p2.projected && near(p2.opening, p1.projectedEnding),
    'Next Pay Period does not reuse today\'s current balance as its own opening');
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
    advice: { defaultView: view, paydayAllocation: { available: (view.calendarPeriods.find(p => p.role === 'active') || view.calendarPeriods[0]).opening, cashBasis: { asOf: '2026-08-30' } } },
    weekly: 0, recommended: 0,
  });
  const bellLine = /data-period-bill="bell"[^>]*>\s*<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/.exec(html);
  ok(bellLine && bellLine[1] === 'Bell · needs confirmation'
      && /about/.test(bellLine[2]) && /121/.test(bellLine[2])
      && !/BILLS ACCOUNT/i.test(bellLine[1]),
    'Needs a Date Bell is name · needs confirmation, no paying account',
    bellLine && `${bellLine[1]} | ${bellLine[2]}`);
  ok(/needs confirmation/i.test(html) && /Not included in either period's remaining bills/.test(html)
      && /Needs a date/.test(html) && /data-bill-section="needs-date"/.test(html),
    'page prints Bell outside both period remaining totals');
  ok(!/See how payday is reserved/.test(html)
      && !/See later bills and big purchases/.test(html)
      && !/Notes behind these numbers/.test(html)
      && !/View full current-period worksheet/.test(html),
    'Needs a Date remains without restoring secondary Plan clutter');
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
  const live = require('../data.json');
  const advice = F.recommend(live.plan, '2026-08-30', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  });
  const view = advice.defaultView;
  const p1 = period(view, 'this-pay-period');
  const p2 = period(view, 'next-pay-period');
  ok(p1 && p1.role === 'active' && p2 && p2.role === 'future',
    'live Aug 30: This Pay Period live, Next future');
  ok(near(p1.opening, advice.paydayAllocation.available),
    'live This Pay Period opening is existing Forecast current cash');
  const ids = (p, id) => billsOf(p).filter(r => r.id === id);
  ok(ids(p1, 'mbna-aug31').length === 1 && ids(p1, 'mbna').length === 0,
    'live August Amazon min is the once row in the Aug 28–Sep 10 window');
  ok(ids(p1, 'heloc').length === 0,
    'live Aug 28–Sep 10 has no HELOC cash row');
  const sep = F.recommend(live.plan, '2026-09-10', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  }).defaultView;
  const sepHeloc = billsOf(period(sep, 'next-pay-period')).filter(r => r.id === 'heloc');
  ok(sepHeloc.length === 1 && sepHeloc[0].date === '2026-09-21',
    'next HELOC cash min is 2026-09-21 in Period 2');
  const seattle = (p2.bigPurchases || []).filter(r => /seattle/i.test(r.id + r.label));
  ok(seattle.every(r => near(r.cost, 1200)),
    'Seattle tournament amounts are the $1,200 plan.commitments facts');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  ok(/This Pay Period/.test(html) && /Next Pay Period/.test(html),
    'page names the two payday waterfalls');
  ok(/data-calendar-waterfall="this-pay-period"/.test(html),
    'default print shows the active This Pay Period waterfall');
  ok(!/\bForecast\b|\bAtlas\b|\brepresented\b|\bunverified\b|\basOf\b/.test(glance),
    'default glance has no Forecast/Atlas jargon or settlement code words');
  ok(!/CMAW|Pixieset|Mailchimp/i.test(glance),
    'cancelled CMAW / Pixieset / Mailchimp are not tracked on the sheet');
}

console.log('\n=== 10. Household Budget uses the Seaspan payday cycle, not bill-calendar dates ===');
{
  const handSum = roundCent(900 + 325 + 37.50 + 100 + 200 + 150 + 150);
  ok(near(handSum, 1862.50) && near(handSum, CYCLE_PLANNED_TOTAL)
      && near(450 * 2, 900)
      && near(Object.values(CYCLE_PLANNED).reduce((s, n) => roundCent(s + n), 0), CYCLE_PLANNED_TOTAL),
    'independent: 14-day grocery plan is $900; cycle total is $1,862.50');

  const asOf = '2026-08-30';
  const cycle = paydayCycleWindow(asOf);
  ok(cycle.start === '2026-08-28' && cycle.end === '2026-09-10'
      && cycle.nextPayday === '2026-09-11' && cycle.days === 14
      && cycle.label === 'Spending cycle: Aug 28–Sep 10',
    'independent 14-day steps from Aug 14: Aug 28–Sep 10, next payday Sep 11');
  const engineCycle = F.spendingCycle(syntheticPlan(), asOf);
  ok(engineCycle && engineCycle.start === cycle.start && engineCycle.end === cycle.end
      && engineCycle.nextPayday === cycle.nextPayday && engineCycle.days === cycle.days
      && engineCycle.label === cycle.label,
    'Forecast.spendingCycle matches the independent Aug 28–Sep 10 window');

  const leakTxs = [
    { date: '2026-08-16', amount: 200, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' },
    { date: '2026-08-20', amount: 300, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' },
    { date: '2026-08-27', amount: 638.67, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' },
    { date: '2026-08-17', amount: 209.64, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: '7-Eleven', originalMerchant: '7-Eleven' },
    { date: '2026-08-20', amount: 220.21, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: 'Shell', originalMerchant: 'Shell' },
    { date: '2026-08-18', amount: 49.16, pending: false, categoryLabel: 'Restaurants', accountRole: 'household-cash' },
    { date: '2026-08-17', amount: 10.00, pending: false, categoryLabel: 'Fast Food', accountRole: 'household-cash' },
    { date: '2026-08-23', amount: 44.18, pending: false, categoryLabel: 'Food Delivery', accountRole: 'household-cash' },
    { date: '2026-08-18', amount: 80, pending: false, categoryLabel: 'Pets', accountRole: 'household-cash', displayedPayee: 'SURREY MEAT PKR _F', originalMerchant: 'SURREY MEAT PKR _F' },
    { date: '2026-08-05', amount: 40, pending: false, categoryLabel: 'Shopping', accountRole: 'household-cash', tags: ['dale'] },
  ];
  const plan = syntheticPlan();
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(leakTxs, asOf),
  }).defaultView;
  const p1 = period(view, 'this-pay-period');
  const p2 = period(view, 'next-pay-period');
  ok(p1 && p1.role === 'active' && p2 && p2.role === 'future',
    'as-of Aug 30: This Pay Period is live, Next is future');
  ok(p1.spendingCycleLabel === cycle.label && p1.spendingCycle
      && p1.spendingCycle.start === cycle.start && p1.spendingCycle.end === cycle.end,
    'active waterfall labels Spending cycle: Aug 28–Sep 10');
  for (const id of HOLD_IDS) {
    const row = budgetRow(p1, id);
    ok(row && near(row.planned, CYCLE_PLANNED[id]) && near(row.spent, 0)
        && near(row.remaining, CYCLE_PLANNED[id]) && near(row.hold, CYCLE_PLANNED[id])
        && row.hold >= 0,
      `${id} planned is the payday-cycle amount with $0 spent from Aug 16–27`,
      row && `${row.planned} / spent ${row.spent}`);
  }
  const groc = budgetRow(p1, 'groceries');
  ok(groc && near(groc.planned, 900) && near(groc.plannedWeekly, 450)
      && !near(groc.planned, 964.29) && !near(groc.planned, 1028.57),
    '14-day grocery plan is $900, not calendar-day proration');
  ok(near(p1.budgetHold, CYCLE_PLANNED_TOTAL),
    'active hold is the unused $1,862.50 cycle reserve',
    String(p1.budgetHold));
  ok(near(p1.opening, F.recommend(plan, asOf, { targetBuffer: 500, debts }).paydayAllocation.available),
    'current cash stays paydayAllocation.available');
  const withIncome = JSON.parse(JSON.stringify(plan));
  withIncome.income.push({
    id: 'bonus16', label: 'One-off deposit 16th', frequency: 'once',
    date: '2026-08-16', amount: 400, confidence: 'confirmed',
  });
  withIncome.income.push({
    id: 'amanda-mid', label: 'Amanda salary 15th extra', frequency: 'once',
    date: '2026-08-15', amount: 2168, confidence: 'confirmed',
  });
  const viewInc = F.recommend(withIncome, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(leakTxs, asOf),
  }).defaultView;
  ok((viewInc.calendarPeriods || []).length === 2
      && !(viewInc.calendarPeriods || []).some(p => /bonus|deposit/i.test(p.label)),
    'income on the 15th or 16th does not open a third bill-planning window');
  const activeInc = period(viewInc, 'this-pay-period');
  ok(activeInc && activeInc.spendingCycle && activeInc.spendingCycle.start === '2026-08-28'
      && near(budgetRow(activeInc, 'groceries').spent, 0),
    'Amanda income does not reset the Seaspan household-spending cycle');
}

console.log('\n=== 11. Aug 28–30 live actuals are $0; bills/income/transfers excluded ===');
{
  const asOf = '2026-08-30';
  const txs = [
    { date: '2026-08-28', amount: 4247.92, pending: false, categoryLabel: 'Income', accountRole: 'household-cash', isIncome: true },
    { date: '2026-08-28', amount: 1600, pending: false, categoryLabel: 'Mortgage', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 11.54, pending: false, categoryLabel: 'Subscriptions', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 19.03, pending: false, categoryLabel: 'Transfer', accountRole: 'household-cash', kindHint: 'transfer', excludeFromTotals: true },
    { date: '2026-08-16', amount: 1138.67, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' },
    { date: '2026-08-17', amount: 669.01, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: '7-Eleven', originalMerchant: '7-Eleven' },
    { date: '2026-08-18', amount: 445.33, pending: false, categoryLabel: 'Restaurants', accountRole: 'household-cash' },
  ];
  const plan = syntheticPlan();
  const advice = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  });
  const p2 = period(advice.defaultView, 'this-pay-period');
  for (const id of HOLD_IDS) {
    const row = budgetRow(p2, id);
    ok(row && near(row.spent, 0) && near(reconSum(row), 0) && row.hold >= 0,
      `${id} spent this period is $0.00 as of Aug 30`,
      row && String(row.spent));
  }
  ok(!(p2.householdBudget || []).some(r => r.needsConfirmation && Number(r.spent) > 0),
    'confirmation list is empty when the only Aug 28–30 txs are excluded');
  ok(!near((budgetRow(p2, 'groceries') || {}).spent, 1138.67)
      && !near((budgetRow(p2, 'fuel') || {}).spent, 669.01)
      && !near((budgetRow(p2, 'restaurants') || {}).spent, 445.33),
    'Aug 16–30 audit totals are not the Aug 28 cycle spent');
  ok(near(p2.opening, advice.paydayAllocation.available)
      && near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - p2.budgetHold)),
    'leftover is opening minus remaining bills and unused hold; spent is not subtracted again');
  ok(near(p2.budgetHold, CYCLE_PLANNED_TOTAL),
    'with $0 spent, hold is the full $1,862.50 reserve');
}

console.log('\n=== 12. subscriptions exist only under Bills, never as a household-budget hold ===');
{
  const plan = syntheticPlan();
  plan.opening.asOf = '2026-08-10';
  const advice = F.recommend(plan, '2026-08-10', { targetBuffer: 500, debts });
  const p1 = period(advice.defaultView, 'this-pay-period');
  const p2 = period(advice.defaultView, 'next-pay-period');
  for (const p of [p1, p2]) {
    ok(!(p.householdBudget || []).some(r => r.id === 'subscriptions'
        || /subscriptions/i.test(r.label || '')),
      `${p.label} householdBudget has no subscriptions row`);
    ok(!(p.householdBudget || []).some(r => r.id === 'health' || /Medical/i.test(r.label || '')),
      `${p.label} householdBudget has no Medical / health row`);
    ok(!(p.householdBudget || []).some(r => r.id === 'sport' || /Children & sports/i.test(r.label || '')),
      `${p.label} householdBudget has no Children & sports row`);
    ok(!(p.householdBudget || []).some(r => r.id === 'shopping' && !r.needsConfirmation),
      `${p.label} householdBudget has no combined Personal row`);
  }
  const netflix = billsOf(p2).find(r => r.id === 'netflix');
  ok(netflix && netflix.status !== 'PAID' && near(netflix.remaining, 26.87)
      && netflix.date === '2026-08-17' && /BILLS ACCOUNT/i.test(netflix.payerLabel || ''),
    'Netflix sits in Period 2 remaining-bills with amount, date, and Forecast paying account');
  ok(p1.role === 'active' && near(p1.budgetHold, CYCLE_PLANNED_TOTAL),
    'as-of Aug 10, bill Period 1 is the active payday-cycle hold of $1,862.50',
    String(p1.budgetHold));
  ok(p2.role === 'future' && near(p2.budgetHold, CYCLE_PLANNED_TOTAL)
      && !near(p2.budgetHold, CYCLE_PLANNED_TOTAL + 300)
      && !near(p2.budgetHold, CYCLE_PLANNED_TOTAL + 150),
    'future Period 2 hold is the next cycle reserve, not subscriptions',
    `${p2.budgetHold}`);
  ok(p2.afterRemainingBills != null && p2.afterHouseholdBudget != null
      && near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - CYCLE_PLANNED_TOTAL))
      && !near(p2.afterHouseholdBudget,
        roundCent(p2.afterRemainingBills - CYCLE_PLANNED_TOTAL - netflix.remaining)),
    'after household budget does not subtract the Netflix bill a second time');
  const halfId = spec => spec.window === 'this' ? 'this-pay-period' : 'next-pay-period';
  for (const spec of SUBSCRIPTION_BILLS) {
    const host = spec.window === 'this' ? p1 : p2;
    const other = spec.window === 'this' ? p2 : p1;
    const row = billsOf(host).find(r => r.id === spec.id);
    const copies = billsOf(p1).concat(billsOf(p2)).filter(r => r.id === spec.id);
    ok(row && copies.length === 1 && near(row.amount, spec.amount)
        && String(row.date).slice(8, 10) === String(spec.day).padStart(2, '0')
        && /BILLS ACCOUNT/i.test(row.payerLabel || '')
        && (row.status === 'PAID' || row.status === 'still due' || row.status === 'pending'),
      `${spec.id} appears once in ${halfId(spec)} with amount, date, Forecast account, status`,
      row && `${row.date} ${row.amount} ${row.status} ${row.payerLabel}`);
    ok(!billsOf(other).some(r => r.id === spec.id),
      `${spec.id} is absent from the other payday window`);
  }
  const ug = billsOf(p1).concat(billsOf(p2)).find(r => r.id === 'ultimate-guitar');
  ok(!ug, 'Ultimate Guitar yearly May 8 is not an August household-budget or August bill');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planCalendarShow: 'next-pay-period',
  });
  const budgetBlock = /data-payday-household-budget[\s\S]*?<\/div>\s*<\/div>/.exec(html);
  ok(budgetBlock && !/Subscriptions/i.test(budgetBlock[0])
      && !/included in Bills, remaining not deducted/.test(budgetBlock[0]),
    'Household Budget block does not print a subscriptions line');
  const netflixLine = /data-period-bill="netflix"[^>]*>\s*<span>([^<]*)<\/span>/.exec(html);
  ok(netflixLine && /Netflix/.test(netflixLine[1]) && / · (PAID|pending|still due)$/.test(netflixLine[1])
      && !/BILLS ACCOUNT/i.test(netflixLine[1]),
    'page prints Netflix as a Bills row without paying account',
    netflixLine && netflixLine[1]);
  ok(!/Pixieset|Mailchimp|CMAW/i.test(html),
    'Pixieset / Mailchimp / CMAW stay off the sheet');
}

console.log('\n=== 12b. Aug 14 and Aug 15 hold the Aug 14–27 cycle exactly once ===');
{
  function cycleStarts(view) {
    return (view.calendarPeriods || [])
      .map(p => p && p.spendingCycle && p.spendingCycle.start)
      .filter(Boolean);
  }
  function holdForStart(view, start) {
    const rows = (view.calendarPeriods || []).filter(p =>
      p && p.spendingCycle && p.spendingCycle.start === start);
    return roundCent(rows.reduce((s, p) => s + (Number(p.budgetHold) || 0), 0));
  }
  for (const asOf of ['2026-08-14', '2026-08-15']) {
    const plan = syntheticPlan();
    plan.opening.asOf = asOf;
    const view = F.recommend(plan, asOf, { targetBuffer: 500, debts }).defaultView;
    const p1 = period(view, 'this-pay-period');
    const p2 = period(view, 'next-pay-period');
    const expected = paydayCycleWindow(asOf);
    ok(expected.start === '2026-08-14' && expected.end === '2026-08-27',
      `independent as-of ${asOf} cycle is Aug 14–27`);
    const starts = cycleStarts(view);
    const aug14 = starts.filter(s => s === '2026-08-14');
    ok(aug14.length === 1,
      `as-of ${asOf}: Aug 14–27 appears once across both waterfalls`,
      starts.join(','));
    ok(near(holdForStart(view, '2026-08-14'), CYCLE_PLANNED_TOTAL),
      `as-of ${asOf}: Aug 14–27 $1,862.50 is held exactly once`,
      String(holdForStart(view, '2026-08-14')));
    ok(p1 && p1.role === 'active' && p1.spendingCycle && p1.spendingCycle.start === '2026-08-14'
        && p1.spendingCycle.end === '2026-08-27'
        && p1.spendingCycleLabel === expected.label,
      `as-of ${asOf}: active Period 1 holds and labels Aug 14–27`);
    ok(p2 && p2.role === 'future' && p2.spendingCycleLabel == null,
      `as-of ${asOf}: future Period 2 does not print the active cycle label`);
    ok(!(p2.spendingCycle && p2.spendingCycle.start === '2026-08-14'),
      `as-of ${asOf}: future Period 2 does not hold the same Aug 14–27 cycle again`);
    ok(p1.cycleUnresolved !== true && p2.cycleUnresolved !== true,
      `as-of ${asOf}: a resolved already-held cycle is not marked unresolved`);
  }
  const aug10 = syntheticPlan();
  aug10.opening.asOf = '2026-08-10';
  const view10 = F.recommend(aug10, '2026-08-10', { targetBuffer: 500, debts }).defaultView;
  const starts10 = cycleStarts(view10);
  ok(starts10.filter(s => s === '2026-08-14').length === 1
      && starts10.filter(s => s === paydayCycleWindow('2026-08-10').start).length === 1
      && starts10[0] !== starts10[1],
    'as-of Aug 10 still holds two distinct cycles (current then Aug 14–27)');
}

console.log('\n=== 12c. unresolved Seaspan cycle fails closed; alreadyHeld stays separate ===');
{
  const src = read('public/forecast.js');
  ok(!/alreadyHeld\s*\|\|\s*!picked\.cycle/.test(src),
    'alreadyHeld skip-hold is not OR-ed with a missing cycle');
  ok(/picked\.alreadyHeld/.test(src) && /unresolvedCycle/.test(src),
    'alreadyHeld skip-hold and unresolved-cycle fail-closed are separate branches');

  const independentHold = roundCent(450 * 2 + 325 + 37.50 + 100 + 200 + 150 + 150);
  ok(near(independentHold, CYCLE_PLANNED_TOTAL) && near(independentHold, 1862.50),
    'independent payday-cycle reserve is $1,862.50');

  const leakTxs = [
    { date: '2026-08-16', amount: 200, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 80, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const asOf = '2026-08-30';
  const extraDebts = roomyDebts();
  const baselinePlan = syntheticPlan();
  const baseline = F.recommend(baselinePlan, asOf, {
    targetBuffer: 500, debts: extraDebts,
    currentPeriodActuals: actualsPacket(leakTxs, asOf),
  });
  const baseActive = period(baseline.defaultView, 'this-pay-period');
  ok(baseActive && near(baseActive.budgetHold, independentHold)
      && Number(baseActive.extraDebt.allocated) > 0,
    'resolved Aug 28 baseline holds $1,862.50 and has leftover-funded extra',
    baseActive && `${baseActive.budgetHold} extra ${baseActive.extraDebt.allocated}`);

  function assertFailClosed(plan, label, opts) {
    const advice = F.recommend(plan, asOf, Object.assign({
      targetBuffer: 500, debts: extraDebts,
      currentPeriodActuals: actualsPacket(leakTxs, asOf),
    }, opts || {}));
    const periods = (advice.defaultView && advice.defaultView.calendarPeriods) || [];
    const engineCycle = F.spendingCycle(plan, asOf);
    ok(engineCycle == null,
      `${label}: spendingCycle does not invent a payday`,
      engineCycle && JSON.stringify(engineCycle));
    ok(periods.length === 0,
      `${label}: missing Seaspan does not invent payday operating windows`);
    return null;
  }

  assertFailClosed(withoutSeaspan(baselinePlan), 'missing Seaspan stream');
  const unresolvableAnchor = malformedSeaspan(baselinePlan, 'not-a-date');
  const payroll = (unresolvableAnchor.income || []).find(r => r && r.id === 'payroll');
  if (payroll) {
    payroll.frequency = 'once';
    payroll.date = '2026-08-28';
  }
  assertFailClosed(unresolvableAnchor, 'unresolvable Seaspan anchor');
  ok(F.spendingCycle(malformedSeaspan(baselinePlan, undefined), asOf) == null,
    'payroll with no anchor does not invent a spending cycle');
  ok(F.spendingCycle(malformedSeaspan(baselinePlan, 'not-a-date'), asOf) == null,
    'malformed payroll anchor does not invent a spending cycle');
  ok(F.spendingCycle(malformedSeaspan(baselinePlan, '2026-13-40'), asOf) == null,
    'invalid ISO payroll anchor does not invent a spending cycle');

  for (const asOfHeld of ['2026-08-14', '2026-08-15']) {
    const plan = syntheticPlan();
    plan.opening.asOf = asOfHeld;
    const view = F.recommend(plan, asOfHeld, { targetBuffer: 500, debts }).defaultView;
    const p1 = period(view, 'this-pay-period');
    const p2 = period(view, 'next-pay-period');
    const starts = (view.calendarPeriods || [])
      .map(p => p && p.spendingCycle && p.spendingCycle.start)
      .filter(Boolean);
    ok(starts.filter(s => s === '2026-08-14').length === 1
        && near(p1.budgetHold, CYCLE_PLANNED_TOTAL)
        && !(p2.spendingCycle && p2.spendingCycle.start === '2026-08-14'),
      `already-held as-of ${asOfHeld}: Aug 14–27 remains held once`,
      starts.join(','));
  }
}

console.log('\n=== 13. overspend remaining is negative; leftover does not take the overshoot ===');
{
  const asOf = '2026-08-30';
  const txs = [
    { date: '2026-08-28', amount: 2000, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods' },
  ];
  const plan = syntheticPlan();
  const advice = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  });
  const p2 = period(advice.defaultView, 'this-pay-period');
  const groc = budgetRow(p2, 'groceries');
  ok(groc && groc.remaining < 0 && near(groc.remaining, roundCent(900 - 2000))
      && near(groc.hold, 0) && groc.hold >= 0,
    'grocery remaining is negative; hold is max(0, remaining) = $0');
  ok(near(p2.budgetHold, roundCent(CYCLE_PLANNED_TOTAL - 900))
      && p2.budgetHold >= 0,
    'period hold never goes negative; overspend releases only that row\'s hold',
    String(p2.budgetHold));
  ok(near(p2.opening, advice.paydayAllocation.available),
    'current cash is still paydayAllocation.available after overspend');
  ok(near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - p2.budgetHold))
      && !near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - 2000))
      && !near(p2.afterHouseholdBudget, roundCent(p2.afterRemainingBills - 1100)),
    'leftover does not subtract the grocery overshoot from cash again');
}

console.log('\n=== 13b. Dale/Amanda guilt-free actuals need explicit evidence inside the cycle ===');
{
  const asOf = '2026-08-30';
  const txs = [
    {
      date: '2026-08-28', amount: 40, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', tags: ['dale'],
    },
    {
      date: '2026-08-29', amount: 25, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', note: 'Amanda',
    },
    {
      date: '2026-08-29', amount: 12, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash',
    },
    {
      date: '2026-08-28', amount: 33, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', atlasAccountId: 'chequing-b',
      accountLabel: 'WEEKLY SPENDING',
    },
    {
      date: '2026-08-28', amount: 18, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', atlasAccountId: 'amanda-debt-payments',
      accountLabel: 'TENNIS INCOME',
    },
    {
      date: '2026-08-05', amount: 9, pending: false, categoryLabel: 'Shopping',
      accountRole: 'household-cash', tags: ['dale'],
    },
    {
      date: '2026-08-28', amount: 50, pending: false, categoryLabel: 'Health',
      accountRole: 'household-cash',
    },
    {
      date: '2026-08-28', amount: 22, pending: false, categoryLabel: 'Sport & fitness',
      accountRole: 'household-cash',
    },
  ];
  const plan = syntheticPlan();
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  }).defaultView;
  const p1 = period(view, 'this-pay-period');
  const p2 = period(view, 'next-pay-period');
  const dale = budgetRow(p1, 'dale-guilt-free');
  const amanda = budgetRow(p1, 'amanda-guilt-free');
  ok(dale && near(dale.planned, 150) && near(dale.spent, 40)
      && near(reconSum(dale), 40),
    'Dale guilt-free planned $150 always shows; spent is the tagged Aug 28 tx');
  ok(amanda && near(amanda.planned, 150) && near(amanda.spent, 25)
      && near(reconSum(amanda), 25),
    'Amanda guilt-free planned $150 always shows; spent is the noted Aug 29 tx');
  ok(!near(dale.spent, 49) && !near(dale.spent, 9),
    'Dale actuals do not include the Aug 5 tx dated before the payday cycle');
  const confirm = (p1.householdBudget || []).find(r => r.needsConfirmation);
  ok(confirm && confirm.id === 'other-spending' && confirm.otherSpending === true
      && confirm.label === 'Other spending'
      && confirm.planned == null && confirm.remaining == null
      && near(confirm.spent, 12 + 33) && confirm.hold === 0,
    'unlabeled personal and WEEKLY SPENDING are Other spending, hold $0',
    confirm && String(confirm.spent));
  ok(!near(amanda.spent, 18) && !near(dale.spent, 18),
    'TENNIS INCOME is not Dale or Amanda guilt-free spending');
  ok(!budgetRow(p1, 'health') && !budgetRow(p1, 'sport'),
    'Health and sport txs are not Household Budget rows');
  const nextDale = budgetRow(p2, 'dale-guilt-free');
  ok(!nextDale || near(nextDale.spent, 0),
    'Next Pay Period does not reuse this cycle\'s Dale/Amanda spent');
  const html = composer.operatingSurfaceHtml({
    advice: { defaultView: view, paydayAllocation: { available: p1.opening, cashBasis: { asOf } } },
    weekly: 0, recommended: 0, planCalendarShow: 'this-pay-period',
  });
  ok(/Dale guilt-free spending/.test(html) && /Amanda guilt-free spending/.test(html)
      && /Other spending/.test(html)
      && /Spending outside the budget categories above/.test(html)
      && !/Personal spending — needs confirmation/.test(html),
    'page prints Dale/Amanda and Other spending, not a needs-confirmation personal row');
}

console.log('\n=== 13c. classification: Surrey Meat, eating out, Canadian Tire, bills ===');
{
  const asOf = '2026-08-30';
  const variants = [
    'SURREY MEAT PKR _F',
    'SURREY MEAT PKR',
    'SURREY MEAT PAC _F',
  ];
  for (const name of variants) {
    const grocCls = F.classifyCurrentPeriodTransaction({
      date: '2026-08-28', amount: 40, categoryLabel: 'Groceries',
      originalMerchant: name, displayedPayee: name,
    }, syntheticPlan());
    const petsCls = F.classifyCurrentPeriodTransaction({
      date: '2026-08-28', amount: 40, categoryLabel: 'Pets',
      originalMerchant: name, displayedPayee: name, dogFood: true,
    }, syntheticPlan());
    ok(grocCls.kind === 'spend' && grocCls.categoryId === 'pets'
        && grocCls.atlasRow === 'pets',
      `${name} as Groceries classifies as Dog food, never Groceries`);
    ok(petsCls.kind === 'spend' && petsCls.categoryId === 'pets',
      `${name} as Pets classifies as Dog food`);
  }
  ok(F.classifyCurrentPeriodTransaction({
    date: '2026-08-28', amount: 10, categoryLabel: 'Groceries',
    originalMerchant: 'Meridian Farm', displayedPayee: 'Meridian Farm',
  }, syntheticPlan()).needsConfirmation,
    'Meridian Farm is not Dog food and is not confirmed Groceries');
  ok(F.classifyCurrentPeriodTransaction({
    date: '2026-08-28', amount: 10, categoryLabel: 'Groceries',
    originalMerchant: 'Iron Butcher', displayedPayee: 'Iron Butcher',
  }, syntheticPlan()).needsConfirmation,
    'Iron Butcher is not Dog food and is not confirmed Groceries');
  const eat = ['Restaurants', 'Fast Food', 'Food Delivery'].map(label =>
    F.classifyCurrentPeriodTransaction({
      date: '2026-08-28', amount: 10, categoryLabel: label, accountRole: 'household-cash',
    }, syntheticPlan()));
  ok(eat.every(c => c.kind === 'spend' && c.categoryId === 'restaurants'),
    'Restaurants, Fast Food, and Food Delivery map to Eating out');
  const tire = F.classifyCurrentPeriodTransaction({
    date: '2026-08-28', amount: 78.38, categoryLabel: 'Household',
    displayedPayee: 'Canadian Tire', originalMerchant: 'Canadian Tire',
  }, syntheticPlan());
  ok(tire.needsConfirmation && tire.categoryId !== 'household',
    'Canadian Tire is needs confirmation, not Household');
  const bill = F.classifyCurrentPeriodTransaction({
    date: '2026-08-28', amount: 11.54, categoryLabel: 'Subscriptions',
    accountRole: 'household-cash',
  }, syntheticPlan());
  ok(bill.kind === 'bill' && bill.householdSpending === false,
    'subscriptions classify as bills, not Household Budget spent');
  const seven = F.classifyCurrentPeriodTransaction({
    date: '2026-08-28', amount: 40, categoryLabel: 'Fuel',
    displayedPayee: '7-Eleven', originalMerchant: '7-Eleven',
  }, syntheticPlan());
  ok(seven.needsConfirmation && seven.categoryId !== 'fuel',
    '7-Eleven Fuel without tx-level fuel evidence is confirmation, not Fuel');

  const txs = [
    { date: '2026-08-28', amount: 12, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'SURREY MEAT PKR _F', originalMerchant: 'SURREY MEAT PKR _F' },
    { date: '2026-08-28', amount: 13, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash', displayedPayee: 'SURREY MEAT PKR', originalMerchant: 'SURREY MEAT PKR' },
    { date: '2026-08-29', amount: 14, pending: false, categoryLabel: 'Pets', accountRole: 'household-cash', displayedPayee: 'SURREY MEAT PAC _F', originalMerchant: 'SURREY MEAT PAC _F', dogFood: true },
    { date: '2026-08-28', amount: 10, pending: false, categoryLabel: 'Restaurants', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 20, pending: false, categoryLabel: 'Fast Food', accountRole: 'household-cash' },
    { date: '2026-08-29', amount: 30, pending: false, categoryLabel: 'Food Delivery', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 78.38, pending: false, categoryLabel: 'Superstores', accountRole: 'household-cash', displayedPayee: 'Canadian Tire', originalMerchant: 'Canadian Tire' },
    { date: '2026-08-29', amount: 96.30, pending: false, categoryLabel: 'Household', accountRole: 'household-cash', displayedPayee: 'Canadian Tire', originalMerchant: 'Canadian Tire' },
    { date: '2026-08-28', amount: 11.54, pending: false, categoryLabel: 'Subscriptions', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 1600, pending: false, categoryLabel: 'Mortgage', accountRole: 'household-cash' },
    { date: '2026-08-28', amount: 40, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: '7-Eleven', originalMerchant: '7-Eleven' },
    { date: '2026-08-29', amount: 55, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: 'Shell', originalMerchant: 'Shell' },
    { date: '2026-08-16', amount: 100, pending: false, categoryLabel: 'Fuel', accountRole: 'household-cash', displayedPayee: 'Shell', originalMerchant: 'Shell' },
  ];
  const plan = syntheticPlan();
  const view = F.recommend(plan, asOf, {
    targetBuffer: 500, debts,
    currentPeriodActuals: actualsPacket(txs, asOf),
  }).defaultView;
  const p2 = period(view, 'this-pay-period');
  const pets = budgetRow(p2, 'pets');
  const groc = budgetRow(p2, 'groceries');
  const eatRow = budgetRow(p2, 'restaurants');
  const hh = budgetRow(p2, 'household');
  const fuel = budgetRow(p2, 'fuel');
  const confirm = (p2.householdBudget || []).find(r => r.needsConfirmation);
  ok(pets && near(pets.spent, 12 + 13 + 14) && near(reconSum(pets), 12 + 13 + 14)
      && groc && near(groc.spent, 0),
    'three SURREY MEAT variants spend Dog food only, never Groceries',
    pets && groc && `${pets.spent} / groc ${groc.spent}`);
  ok(eatRow && near(eatRow.spent, 10 + 20 + 30) && near(reconSum(eatRow), 60),
    'Restaurants + Fast Food + Food Delivery spend Eating out once each');
  ok(hh && near(hh.spent, 0),
    'Canadian Tire is not Household spent');
  ok(fuel && near(fuel.spent, 55) && !near(fuel.spent, 55 + 40) && !near(fuel.spent, 55 + 100),
    'Fuel is the in-cycle evidenced Shell only; 7-Eleven and Aug 16 do not leak');
  ok(confirm && confirm.otherSpending === true && confirm.label === 'Other spending'
      && near(confirm.spent, 78.38 + 96.30 + 40) && confirm.hold === 0,
    'Canadian Tire and unconfirmed 7-Eleven sit on Other spending, not a hold',
    confirm && String(confirm.spent));
  ok(near(p2.budgetHold, roundCent(
    Math.max(0, 900 - 0) + Math.max(0, 325 - 55) + Math.max(0, 37.50 - 0)
    + Math.max(0, 100 - 39) + Math.max(0, 200 - 60) + 150 + 150
  )),
    'hold is max(0, remaining) per row; never negative',
    String(p2.budgetHold));
}

console.log('\n=== 14. page prints Forecast; leftover is not computed in plan.js ===');
{
  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'operatingSurfaceHtml calls no Forecast function');
  const budgetFn = /function calendarBudgetHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(budgetFn && /householdBudgetCycleText/.test(budgetFn[0])
      && /cycleUnresolved/.test(budgetFn[0])
      && /operatingPlanUnavailable/.test(budgetFn[0])
      && /calendarCurrentUnavailableHtml/.test(budgetFn[0])
      && !/calendarHalfPlanned|sumCategoryActuals/.test(budgetFn[0]),
    'calendarBudgetHtml prints Forecast cycle text / cycleUnresolved / operatingPlanUnavailable and does not recompute planned');
  const unavailableFn = /function calendarCurrentUnavailableHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(unavailableFn && /operatingPlanNote/.test(unavailableFn[0])
      && /data-operating-plan="unavailable"/.test(unavailableFn[0])
      && /data-current-waterfall="unavailable"/.test(unavailableFn[0]),
    'calendarCurrentUnavailableHtml is the current-waterfall unavailable copy');
  const liveSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'live-plan.js'), 'utf8');
  ok(!/fs\.writeFileSync/.test(liveSrc),
    'live-plan.js still does not write data.json');
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-08-30', { targetBuffer: 500, debts });
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    planCalendarShow: 'this-pay-period',
  });
  ok(/Aug 28–Sep 10/.test(html) && !/Spending cycle:/.test(html),
    'page prints Aug 28–Sep 10 without repeating Spending cycle:');
  ok(/\$450(?:\.00)?\/week/.test(html)
      && /<dt>Planned<\/dt>/.test(html)
      && /<dt>Remaining<\/dt>/.test(html)
      && /household-budget-metrics/.test(html)
      && !/planned this period/.test(html)
      && !/spent this period/.test(html),
    'page prints grocery $450/week and structured Planned / Remaining');
  ok(/Dale guilt-free spending/.test(html) && /Amanda guilt-free spending/.test(html),
    'page always prints both guilt-free rows');
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
  const p1 = period(advice.defaultView, 'this-pay-period');
  const p2 = period(advice.defaultView, 'next-pay-period');
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
  ok(p1.role === 'active' && near(p1.opening, advice.paydayAllocation.available),
    'This Pay Period current cash stays paydayAllocation.available');
  const ifDeductedAgain = roundCent(p1.available - p1.remainingBills - three);
  ok(p1.afterRemainingBills != null
      && near(p1.afterRemainingBills, p1.available - p1.remainingBills)
      && !near(p1.afterRemainingBills, ifDeductedAgain),
    'This Pay Period leftover does not deduct the three paid 15 August bills from current cash');
  const live = require('../data.json');
  const liveView = F.recommend(live.plan, '2026-08-20', {
    targetBuffer: live.plan.defaults.targetBuffer, debts: live.debts,
  }).defaultView;
  const liveP1 = period(liveView, 'this-pay-period');
  const liveP2 = period(liveView, 'next-pay-period');
  for (const id of WEEKEND_IDS) {
    ok(billsOf(liveP1).some(r => r.id === id) && !billsOf(liveP2).some(r => r.id === id),
      `live ${id} sits in This Pay Period (Aug 14–27), not Next`);
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
    const inThis = due >= '2026-08-14' && due <= '2026-08-27';
    const expectId = inThis ? 'this-pay-period' : 'next-pay-period';
    ok(periodId === expectId,
      `${row.id} paid bill sits in the payday window that contains scheduled due ${due}`,
      `${periodId} vs ${expectId} due ${due}`);
    ok(row.date !== '2026-08-16' || due !== '2026-08-15' || periodId === 'this-pay-period',
      `${row.id} is not parked in Next solely because Lunch Money posted the 16th`);
  }
  const day15 = paid.find(x => x.row.id === 'day15');
  ok(day15 && day15.period === 'this-pay-period' && day15.row.date === '2026-08-15',
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

console.log('\n=== 16. payday cadence annualizes with the master plan; week views stay whole ===');
{
  const MONTH = 365.25 / 12;
  const PAYDAY = {
    fuel: 325,
    household: 37.5,
    pets: 100,
    restaurants: 200,
    'dale-guilt-free': 150,
    'amanda-guilt-free': 150,
  };
  for (const [id, payday] of Object.entries(PAYDAY)) {
    const annualFromCycles = payday * (365.25 / 14);
    const annualFromMonths = 12 * (payday * MONTH / 14);
    ok(Math.abs(annualFromCycles - annualFromMonths) < 1e-9,
      `${id}: 365.25/14 cycles equal 12 calendar-month equivalents`);
    ok(Math.abs(annualFromCycles - 12 * payday * 2) > 1,
      `${id}: 24 half-months is not the payday annualization`);
  }

  const plan = syntheticPlan();
  const bd = F.budgetBreakdown(plan, {
    asOf: '2026-08-30',
    periods: { ytd: { label: 'YTD', months: 8, spending: [] } },
  }, {});
  for (const [id, payday] of Object.entries(PAYDAY)) {
    const cat = (bd.categories || []).find(c => c.id === id);
    const monthly = Math.round(payday * MONTH / 14 * 100) / 100;
    ok(cat && near(cat.target, monthly) && !near(cat.target, payday * 2),
      `${id} master-plan target is payday × calendar-month-days / 14, not 2× payday`,
      cat && String(cat.target));
  }

  const asOf = '2026-08-30';
  const advice = F.recommend(plan, asOf, { targetBuffer: 500, debts });
  const p2 = period(advice.defaultView, 'next-pay-period');
  for (const [id, payday] of Object.entries(PAYDAY)) {
    const row = budgetRow(p2, id);
    ok(row && near(row.planned, payday),
      `${id} cycle planned stays the owner payday amount`,
      row && String(row.planned));
  }

  function independentSeaspanDates(start, end) {
    const out = [];
    let t = SEASPAN_ANCHOR;
    while (t > start) t = F.addDays(t, -14);
    while (t <= end) {
      if (t >= start) out.push(t);
      t = F.addDays(t, 14);
    }
    return out;
  }

  const weeks = advice.weekViews || [];
  ok(weeks.length > 1, 'week views exist to prove discrete payday holds');
  let paydayWeeks = 0;
  let otherWeeks = 0;
  for (const week of weeks) {
    const n = independentSeaspanDates(week.periodStart, week.periodEnd).length;
    const pets = (week.householdBudget || []).find(r => r.id === 'pets');
    const digestPets = ((week.budgetDigest && week.budgetDigest.rows) || [])
      .find(r => r.id === 'pets');
    ok(!pets || !near(pets.amount, 50),
      `week ${week.periodStart} dog-food glance is not the $50 proration`,
      pets && String(pets.amount));
    ok(!digestPets || !near(digestPets.planned, 50),
      `week ${week.periodStart} dog-food digest is not the $50 proration`,
      digestPets && String(digestPets.planned));
    if (n > 0) {
      paydayWeeks += 1;
      ok(pets && near(pets.amount, 100 * n),
        `week ${week.periodStart} containing ${n} payday(s) holds whole dog food`,
        pets && String(pets.amount));
      ok(digestPets && near(digestPets.planned, 100 * n),
        `week ${week.periodStart} digest holds whole dog food`,
        digestPets && String(digestPets.planned));
    } else {
      otherWeeks += 1;
      ok(!pets,
        `week ${week.periodStart} with no payday omits dog food from the week hold`);
      ok(!digestPets,
        `week ${week.periodStart} with no payday omits dog food from the digest`);
    }
  }
  ok(paydayWeeks > 0 && otherWeeks > 0,
    'proof covers both a payday week and a week with no payday',
    `${paydayWeeks} payday / ${otherWeeks} other`);
}

console.log('\n=== 17. a monthly-backed payday row stays $3,600/year, not $3,900 ===');
{
  const MONTH_DAYS = 365.25 / 12;
  const monthly = 300;
  const independentAnnual = monthly * 12;
  const independentPayday = roundCent(monthly * 14 / MONTH_DAYS);
  const naiveHalf = 150;
  const naiveBiweeklyAnnual = naiveHalf * 26;
  ok(independentAnnual === 3600, 'independent $300/month annual is $3,600');
  ok(naiveBiweeklyAnnual === 3900, 'halving then ×26 would be $3,900 — the defect');
  ok(Math.abs((monthly * 14 / MONTH_DAYS) * (365.25 / 14) - independentAnnual) < 1e-9,
    'unrounded calendar 14-day × 365.25/14 equals monthly × 12');
  ok(!near(independentPayday, naiveHalf),
    'calendar 14-day equivalent of $300/month is not $150',
    String(independentPayday));

  const plan = syntheticPlan();
  plan.budget.categories = plan.budget.categories.map(c =>
    c.id === 'restaurants'
      ? {
        id: 'restaurants', label: 'Dining', class: 'discretionary',
        plannedMonthly: monthly, plannedPayday: null, ownerLine: 'Eating out',
      }
      : c);

  const bd = F.budgetBreakdown(plan, {
    asOf: '2026-08-30',
    periods: { ytd: { label: 'YTD', months: 8, spending: [] } },
  }, {});
  const rest = (bd.categories || []).find(c => c.id === 'restaurants');
  ok(rest && near(rest.target, monthly) && near(rest.target * 12, independentAnnual),
    'master Forecast annual of a $300/month target is $3,600, not $3,900',
    rest && `${rest.target} × 12 = ${roundCent(rest.target * 12)}`);
  ok(rest && !near(rest.target * 12, naiveBiweeklyAnnual),
    'Forecast annual is not 26 × $150');

  const asOf = '2026-08-30';
  const view = F.recommend(plan, asOf, { targetBuffer: 500, debts }).defaultView;
  const p2 = period(view, 'next-pay-period');
  const row = budgetRow(p2, 'restaurants');
  ok(row && near(row.planned, independentPayday) && !near(row.planned, naiveHalf),
    'payday-cycle planned for $300/month uses the calendar identity, not half',
    row && String(row.planned));
  const naiveCycleAnnual = roundCent((Number(row && row.planned) || 0) * 26);
  ok(row && !near(naiveCycleAnnual, independentAnnual)
      && near(rest.target * 12, independentAnnual),
    '26 × payday-cycle planned is not the Forecast annual; monthly × 12 is');
  ok(row && near(Number(row.planned) * (365.25 / 14), independentAnnual, 2)
      && !near(Number(row.planned) * 26, independentAnnual, 2),
    'calendar-annualized payday planned is ~$3,600/year, not $3,900',
    row && String(roundCent(Number(row.planned) * (365.25 / 14))));
}

console.log('\n=== 18. unavailable current period fail-closes the dependent next period ===');
{
  const independentAddDays = (iso, days) => {
    const ms = Date.parse(String(iso) + 'T00:00:00Z') + days * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  };
  const openingAsOf = '2026-08-10';
  const thisStart = '2026-07-31';
  const thisEnd = '2026-08-13';
  const nextStart = '2026-08-14';
  const nextEnd = '2026-08-27';
  ok(openingAsOf >= thisStart && openingAsOf <= thisEnd,
    'independent +14 grid: dated Aug 10 sits in Jul 31–Aug 13');
  ok(independentAddDays(nextStart, 13) === nextEnd,
    'independent next window is Aug 14–27');

  const plan = syntheticPlan();
  plan.opening.asOf = openingAsOf;
  const nextIncome = [];
  const seaspan = plan.income.find(r => r && r.id === 'payroll');
  const amanda15 = plan.income.find(r => r && r.id === 'amanda15');
  ok(seaspan && seaspan.anchor === '2026-08-14',
    'synthetic Seaspan payday Aug 14 starts the next window');
  nextIncome.push({ id: seaspan.id, date: '2026-08-14', amount: seaspan.amount, label: seaspan.label });
  ok(amanda15 && '2026-08-15' >= nextStart && '2026-08-15' <= nextEnd,
    'independent next window also contains Amanda 15th salary');
  const laterIncomeSum = roundCent(seaspan.amount + amanda15.amount);
  const netflix = plan.bills.find(r => r && r.id === 'netflix');
  const netflixDate = `2026-08-${String(netflix.day).padStart(2, '0')}`;
  ok(netflixDate >= nextStart && netflixDate <= nextEnd && near(netflix.amount, 26.87),
    'independent next window includes the Netflix day-17 bill');

  const unavailable = F.recommend(plan, openingAsOf, {
    targetBuffer: 500, debts,
    operatingPlan: 'unavailable',
    operatingPlanNote: 'Current plan unavailable. The dated opening is stale.',
  });
  const unView = unavailable.defaultView;
  const unP1 = period(unView, 'this-pay-period');
  const unP2 = period(unView, 'next-pay-period');
  ok(unView.asOf === openingAsOf,
    'unavailable walk keeps the dated opening as-of; it does not invent Aug 31');
  ok(unP1 && unP1.role === 'active' && unP1.operatingPlanUnavailable === true,
    'This Pay Period stays the dated-opening active window and is unavailable');
  ok(unP2 && unP2.role === 'future' && unP2.operatingPlanUnavailable === true,
    'Next Pay Period stays future (role still from the dated opening) and inherits unavailable');
  ok(unP2.openingKnown !== true && unP2.opening == null && unP2.currentBalance == null,
    'later half does not invent an opening after the unavailable current period');
  ok((unP2.income || []).length === 0 && unP2.incomeAdded == null && unP2.available == null,
    'later half does not publish arriving income or Available/leftover');
  ok((unP2.bills || []).length === 0
      && unP2.remainingBills == null
      && unP2.totalBillsThisPeriod == null
      && (unP2.householdBudget || []).length === 0
      && unP2.budgetHold == null
      && unP2.spendingCycle == null
      && unP2.afterRemainingBills == null
      && unP2.afterHouseholdBudget == null
      && unP2.afterDebtRepayment == null
      && unP2.projectedEnding == null,
    'later half does not publish bills, Household Budget, or leftover chain');
  ok(!(unP2.income || []).some(r => r.id === 'payroll' || r.id === 'amandaEnd')
      && !(unP2.bills || []).some(r => r.id === 'netflix'),
    'later half does not list the independent Aug 28/31 income or Netflix bill');

  const unHtml = composer.operatingSurfaceHtml({
    advice: unavailable,
    weekly: unavailable.weekly,
    recommended: unavailable.weekly,
    planCalendarShow: 'next-pay-period',
  });
  ok(/data-unavailable-primary/.test(unHtml)
      && /data-current-operating="unavailable"/.test(unHtml)
      && /data-operating-plan="unavailable"/.test(unHtml)
      && /unavailable/.test(unHtml)
      && /stale/.test(unHtml),
    'printed unavailable Plan surface is one compact unavailable/stale state');
  ok(!/data-calendar-waterfall/.test(unHtml)
      && !/data-calendar-period-picker/.test(unHtml)
      && !/Current Balance/.test(unHtml),
    'printed unavailable Plan surface does not render the current pay-period waterfall');
  ok(!/arriving/.test(unHtml)
      && !/Still arriving/.test(unHtml)
      && !/data-income-status="arriving"/.test(unHtml)
      && !/Payroll — Seaspan/.test(unHtml)
      && !/Amanda salary month-end/.test(unHtml)
      && !/Netflix/.test(unHtml)
      && !/planned this period/.test(unHtml)
      && !/household-budget-metrics/.test(unHtml)
      && !/Spending cycle:/.test(unHtml),
    'printed unavailable Plan surface does not list arriving income, Netflix, or Household Budget planned dollars');
  ok(!unHtml.includes(composer.money2(laterIncomeSum))
      && !unHtml.includes(composer.money2(netflix.amount)),
    'printed unavailable Plan surface does not publish the independent later-half income total or Netflix amount');

  const trusted = F.recommend(plan, openingAsOf, { targetBuffer: 500, debts });
  const liveP1 = period(trusted.defaultView, 'this-pay-period');
  const liveP2 = period(trusted.defaultView, 'next-pay-period');
  ok(trusted.operatingPlanUnavailable !== true
      && liveP1 && liveP1.role === 'active' && liveP1.operatingPlanUnavailable !== true
      && liveP2 && liveP2.role === 'future' && liveP2.operatingPlanUnavailable !== true
      && liveP2.openingKnown === true && liveP2.available != null,
    'trusted control on the same dated opening still publishes a normal future later half');
  ok((liveP2.income || []).some(r => r.id === 'payroll' && r.date === '2026-08-14')
      && (liveP2.income || []).some(r => r.id === 'amanda15' && r.date === '2026-08-15')
      && !(liveP2.income || []).some(r => r.date === '2026-08-28' || r.date === '2026-08-31')
      && near(liveP2.incomeAdded, laterIncomeSum)
      && (liveP2.bills || []).some(r => r.id === 'netflix')
      && (liveP2.householdBudget || []).length > 0
      && liveP2.budgetHold != null,
    'trusted next payday window lists independent Aug 14 Seaspan, Amanda 15th, Netflix, and Household Budget');
  const liveHtml = composer.operatingSurfaceHtml({
    advice: trusted,
    weekly: trusted.weekly,
    recommended: trusted.weekly,
    planCalendarShow: 'next-pay-period',
  });
  ok(/Payroll — Seaspan/.test(liveHtml)
      && /Amanda salary 15th/.test(liveHtml)
      && !/Amanda salary month-end/.test(liveHtml)
      && /Netflix/.test(liveHtml)
      && /<dt>Planned<\/dt>/.test(liveHtml)
      && /household-budget-metrics/.test(liveHtml)
      && !/data-operating-plan="unavailable"/.test(liveHtml),
    'trusted printed next payday window still publishes arriving Seaspan, Amanda 15th, bills, and Household Budget');

  const src = read('public/forecast.js');
  const waterfallFn = /function calendarPeriodWaterfalls\([\s\S]*?\n  \}/.exec(src);
  ok(waterfallFn && /unavailableOpeningLost/.test(waterfallFn[0])
      && /role === 'future' && unavailableOpeningLost/.test(waterfallFn[0])
      && !/operatingPlan === 'unavailable' && role === 'active';/.test(waterfallFn[0])
      && !/Date\.now/.test(waterfallFn[0]),
    'calendarPeriodWaterfalls fail-closes dependent future halves from the dated opening, not wall-clock as-of');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
