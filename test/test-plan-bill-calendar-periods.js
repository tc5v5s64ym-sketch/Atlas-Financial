'use strict';
/* Homepage bills list: two calendar halves, BILLS ACCOUNT future payer,
 * Bell without an invented day, HELOC cash once, no subscription lump.
 *
 * Dates and totals below are hand-computed from cadence and the calendar,
 * then Forecast is asked whether it reproduced them (L-002 / L-006).
 *
 * `node test/test-plan-bill-calendar-periods.js`
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
const clone = x => JSON.parse(JSON.stringify(x));

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

function section(view, id) {
  return ((view && view.billSections) || []).find(s => s.id === id);
}
function idsIn(sec) {
  return ((sec && sec.rows) || []).map(r => r.id);
}
function rowIn(sec, id) {
  return ((sec && sec.rows) || []).find(r => r.id === id);
}

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 0 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'Chequing A', value: 8000 }],
      heldElsewhere: [{ id: 'amanda-debt-payments', value: 100 }],
    },
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
        id: 'travel', label: 'Travel Visa minimum', frequency: 'monthly',
        day: 26, amount: 17, confidence: 'estimated',
        debtId: 'travelvisa', effect: 'payment', payingAccount: 'chequing-a',
      },
      {
        id: 'cashback', label: 'TD Cash Back Visa minimum', frequency: 'monthly',
        day: 1, firstDue: '2026-10-01', amount: 170, confidence: 'estimated',
        debtId: 'cashback', effect: 'payment', payingAccount: 'chequing-a',
      },
    ],
    bills: [
      {
        id: 'day15', label: 'Day 15 bill', frequency: 'monthly',
        day: 15, amount: 15, confidence: 'confirmed', payingAccount: 'chequing-a',
      },
      {
        id: 'day16', label: 'Day 16 bill', frequency: 'monthly',
        day: 16, amount: 16, confidence: 'confirmed', payingAccount: 'chequing-a',
      },
      {
        id: 'monthEnd', label: 'Last-day bill', frequency: 'monthly',
        day: 31, amount: 31, confidence: 'confirmed', payingAccount: 'chequing-a',
      },
      {
        id: 'fit4less', label: 'Fit4Less membership', frequency: 'biweekly',
        anchor: '2026-08-14', amount: 11.54, confidence: 'confirmed',
        payingAccount: 'chequing-a',
      },
      {
        id: 'netflix', label: 'Netflix', frequency: 'monthly',
        day: 17, amount: 26.87, confidence: 'confirmed',
        budgetCategory: 'subscriptions', payingAccount: 'chequing-a',
      },
      {
        id: 'bell', label: 'Bell', frequency: 'monthly',
        amount: 121, confidence: 'estimated', needsDate: true,
        budgetCategory: 'telecom', payingAccount: 'chequing-a',
      },
    ],
    commitments: [],
    budget: {
      categories: [
        {
          id: 'subscriptions', label: 'Subscriptions', class: 'discretionary',
          plannedMonthly: 300, ownerLine: 'Subscriptions',
        },
        {
          id: 'telecom', label: 'Phones & internet', class: 'essential',
          plannedMonthly: null, currentMonthly: 121,
        },
      ],
    },
  };
}

const debts = [
  { id: 'travelvisa', label: 'Travel Visa', secured: false, balance: 100, rate: 20, payment: 17, pending: 0 },
  { id: 'cashback', label: 'Cash Back', secured: false, balance: 200, rate: 26, payment: 170, pending: 0 },
  { id: 'heloc', label: 'HELOC', secured: true, balance: 1000, rate: 4.9, payment: 0, pending: 0, cashPayment: 0, interestTreatment: 'capitalised' },
  { id: 'mortgage', label: 'Mortgage', secured: true, balance: 5000, rate: 3.64, payment: 1600, pending: 0 },
];

const composer = loadComposer();

console.log('=== 1. calendar halves: day 15 / 16 / last day / Feb clamp ===');
{
  const plan = syntheticPlan();
  const aug = F.recommend(plan, '2026-08-20', { targetBuffer: 0, debts });
  const p1 = section(aug.defaultView, 'calendar-1-15');
  const p2 = section(aug.defaultView, 'calendar-16-end');
  ok(p1 && p2 && aug.defaultView.billSections.length === 2,
    'default view publishes exactly two calendar bill sections');
  ok(p1.start === '2026-08-01' && p1.end === '2026-08-15'
      && p2.start === '2026-08-16' && p2.end === '2026-08-31',
    'August halves are 1–15 and 16–31');
  ok(idsIn(p1).includes('day15') && !idsIn(p2).includes('day15'),
    'day 15 lands in Pay Period 1');
  ok(idsIn(p2).includes('day16') && !idsIn(p1).includes('day16'),
    'day 16 lands in Pay Period 2');
  ok(idsIn(p2).includes('monthEnd') && !idsIn(p1).includes('monthEnd'),
    'last calendar day lands in Pay Period 2');
  ok(idsIn(p1).includes('mortgage') && idsIn(p2).includes('mortgage'),
    'biweekly mortgage appears in the half that contains each date');
  const feb = F.recommend(plan, '2027-02-10', { targetBuffer: 0, debts });
  const feb2 = section(feb.defaultView, 'calendar-16-end');
  const last = rowIn(feb2, 'monthEnd');
  ok(last && last.date === '2027-02-28',
    'day 31 clamps to 28 Feb 2027 and stays in Pay Period 2',
    last && last.date);
}

console.log('\n=== 2. future payingAccount is BILLS ACCOUNT; page prints Forecast ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, '2026-09-10', { targetBuffer: 0, debts });
  const rows = (advice.defaultView.bills || []).concat(advice.defaultView.undatedBills || []);
  const want = ['mortgage', 'heloc', 'travel', 'day15', 'day16', 'monthEnd', 'fit4less', 'netflix', 'bell'];
  for (const id of want) {
    const row = rows.find(r => r.id === id);
    ok(row && row.payingAccount === 'chequing-a'
        && row.payerLabel === 'BILLS ACCOUNT (Chequing A)',
      `${id} future row is BILLS ACCOUNT (Chequing A)`);
  }
  const cashback = (advice.defaultView.bills || []).find(r => r.id === 'cashback');
  ok(!cashback, 'Cash Back min firstDue 2026-10-01 is omitted from September');
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
  });
  ok(/Pay Period 1/.test(html) && /Pay Period 2/.test(html),
    'plan.js prints the two Forecast section labels');
  ok(/BILLS ACCOUNT \(Chequing A\)/.test(html),
    'plan.js prints the Forecast payer label');
  const fn = /function periodBillsHtml\([\s\S]*?\n\}/.exec(read('public/plan.js'));
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0])
      && !/reduce\s*\(/.test(fn[0]),
    'periodBillsHtml does not calculate or call Forecast');
}

console.log('\n=== 3. period totals equal the printed rows ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-09-10', { targetBuffer: 0, debts }).defaultView;
  // Independent of Forecast totals: biweekly from 2026-08-14 is 11 Sep and
  // 25 Sep; monthly day 15 / 16 / 26 / 31; HELOC cash 21 Sep.
  const want = {
    'calendar-1-15': 1600 + 11.54 + 15,
    'calendar-16-end': 1600 + 11.54 + 16 + 31 + 17 + 80 + 26.87,
  };
  for (const sec of view.billSections) {
    ok(near(sec.total, want[sec.id]),
      `${sec.label} total equals the independently summed rows`,
      `${sec.total} vs ${want[sec.id]}`);
  }
}

console.log('\n=== 4. subscriptions are not a $300 lump and are not double-counted ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-09-10', { targetBuffer: 0, debts }).defaultView;
  const rows = (view.bills || []).concat(view.undatedBills || []);
  ok(!rows.some(r => /subscriptions/i.test(r.label) && near(r.amount, 300)),
    'the $300 subscriptions target is not printed as a bill');
  ok((view.bills || []).some(r => r.id === 'netflix'),
    'dated Netflix is the printed subscription bill');
  const periods = {
    periods: { ytd: { months: 3, spending: [] } },
  };
  const bd = F.budgetBreakdown(plan, periods, { asOf: '2026-09-10' });
  const subs = bd.categories.find(c => c.id === 'subscriptions');
  ok(subs && near(subs.dated, 26.87) && near(subs.planned, 300 - 26.87),
    'weekly-cap remainder is owner target minus the dated Netflix row',
    subs && `${subs.dated} dated / ${subs.planned} planned`);
  const telecom = bd.categories.find(c => c.id === 'telecom');
  ok(telecom && near(telecom.reserved, 121) && near(telecom.dated, 0),
    'undated Bell is not a second dated telecom amount beside currentMonthly');
}

console.log('\n=== 5. card mins once; HELOC cash vs capitalise; no extra income sections ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-09-10', { targetBuffer: 0, debts }).defaultView;
  const travel = (view.bills || []).filter(r => r.id === 'travel');
  ok(travel.length === 1 && travel[0].date === '2026-09-26',
    'Travel Visa min prints once in the half of its day');
  const helocCash = (view.bills || []).filter(r => r.id === 'heloc');
  ok(helocCash.length === 1 && helocCash[0].date === '2026-09-21'
      && near(helocCash[0].amount, 80)
      && helocCash[0].confidence === 'estimated',
    'September HELOC cash prints once on the 21st, estimated');
  const events = F.expandEvents(plan, '2026-09-01', '2026-09-30');
  const helocEv = events.filter(e => e.id === 'heloc');
  ok(helocEv.length === 1 && helocEv[0].kind === 'noncash',
    'expandEvents still emits only the capitalise event, not a second cash bill');
  ok(!events.some(e => e.id === 'heloc' && e.kind !== 'noncash'),
    'HELOC cash is not a second household cash event on the walk');
  ok(view.billSections.length === 2
      && !view.billSections.some(s => /Seaspan|Amanda|payroll|salary/i.test(s.label)),
    'income dates do not spawn extra bill sections');
  ok(!(view.bills || []).some(r => r.kind === 'income'),
    'income is not printed as a bill row');
}

console.log('\n=== 6. Bell has no invented date; historical LM txs are not rewritten ===');
{
  const plan = syntheticPlan();
  const view = F.recommend(plan, '2026-09-10', { targetBuffer: 0, debts }).defaultView;
  const bell = (view.undatedBills || []).find(r => r.id === 'bell');
  ok(bell && bell.needsDate === true && bell.date == null
      && near(bell.amount, 121) && bell.confidence === 'estimated',
    'Bell prints as needs-date, estimated $121, no fabricated day');
  const bellEvents = F.expandEvents(plan, '2026-09-01', '2026-12-31')
    .filter(e => e.id === 'bell');
  ok(bellEvents.length === 0, 'expandEvents does not invent a Bell date');
  const live = require('../data.json');
  const liveSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'live-plan.js'), 'utf8');
  ok(!/fs\.writeFileSync/.test(liveSrc),
    'live-plan.js does not write data.json');
  ok(!(live.plan.bills || []).some(b => b.id === 'bell' && b.day != null),
    'live Bell row does not invent a due day');
}

console.log('\n=== 7. live listed ids: BILLS ACCOUNT; Aug once vs Sep monthly ===');
{
  const live = require('../data.json');
  const listed = [
    'mortgage', 'fortis', 'hydro-due-sep1', 'shaw', 'bell', 'bcaa', 'icbc',
    'resp', 'fit4less', 'tdfees', 'noble-garbage', 'affirm-final', 'netflix',
    'spotify', 'google-storage-100gb', 'icloud-storage', 'youtube-premium',
    'ultimate-guitar', 'chatgpt-plus-dale', 'chatgpt-plus-amanda', 'heloc',
    'triangle', 'cashback', 'tdcc', 'travel', 'mbna', 'mbna-aug31',
  ];
  for (const id of listed) {
    const row = (live.plan.bills || []).find(b => b.id === id)
      || (live.plan.obligations || []).find(o => o.id === id);
    ok(row && row.payingAccount === 'chequing-a',
      `${id} future payingAccount is chequing-a`);
  }
  const augIds = (F.recommend(live.plan, '2026-08-19', { debts: live.debts })
    .defaultView.bills || []).map(r => r.id);
  const sepIds = (F.recommend(live.plan, '2026-09-10', { debts: live.debts })
    .defaultView.bills || []).map(r => r.id);
  const once = ['bcaa-aug15-outstanding', 'icbc-aug15-outstanding', 'resp-aug15-outstanding'];
  const monthly = ['bcaa', 'icbc', 'resp'];
  ok(once.every(id => augIds.includes(id)) && monthly.every(id => !augIds.includes(id)),
    'August prints the once rows, not the September 15 monthly rows');
  ok(monthly.every(id => sepIds.includes(id)) && once.every(id => !sepIds.includes(id)),
    'September prints the monthly 15th rows once, not the August once rows');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
