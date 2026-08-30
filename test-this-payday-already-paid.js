'use strict';
/* This-payday already-paid set, and cancelled CMAW dues drop.
 *
 * Independent of thisPaydayPaidFrom / alreadyPaidHtml: payday-date
 * expandEvents plus representedEvents decide what that cheque already
 * paid. Independently enumerated 15ths decide that cancelled CMAW dues
 * are gone. Synthetic cents are unlike live household figures (L-006).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const data = require('./data.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, file), 'utf8'));

const PAYDAY = '2026-08-28';
const AS_OF = '2026-08-29';
const PRIOR = '2026-08-19';
const PAYROLL = 1111.11;
const MORTGAGE = 1234.56;
const FIT = 13.13;
const CHILD = 77.77;
const BCAA = 55.55;
const TRAVEL = 18.18;
const FEES = 44.44;

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
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function alreadyPaidRowsHtml\([\s\S]*?\n\}$/m, 'alreadyPaidRowsHtml'),
    grab(planSrc, /^function alreadyPaidHtml\([\s\S]*?\n\}$/m, 'alreadyPaidHtml'),
    grab(planSrc, /^function stillDueItems\([\s\S]*?\n\}$/m, 'stillDueItems'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function mustLeaveHtml\([\s\S]*?\n\}$/m, 'mustLeaveHtml'),
    grab(planSrc, /^function extraDebtGlanceHtml\([\s\S]*?\n\}$/m, 'extraDebtGlanceHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, money, money2 });`,
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

function syntheticPlan() {
  return {
    windowDays: 40,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 4000 },
    opening: {
      asOf: AS_OF,
      priorAsOf: PRIOR,
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
    commitments: [],
    budget: { categories: [] },
  };
}

function independentPaydayPaid(plan, payday) {
  const represented = new Set(
    ((plan.opening && plan.opening.representedEvents) || [])
      .filter(row => row && row.id && row.date)
      .map(row => row.id + '@' + row.date)
  );
  const events = F.expandEvents(plan, payday, payday, { keepRepresented: true });
  const inflows = events.filter(e => e && e.kind === 'income' && e.date === payday
    && represented.has(e.id + '@' + e.date));
  const bills = events.filter(e => e && e.amount < 0 && e.kind !== 'income'
    && e.date === payday && represented.has(e.id + '@' + e.date));
  return { inflows, bills, represented };
}

console.log('=== this-payday already-paid is the cheque date, not the whole period ===');
{
  const plan = syntheticPlan();
  const indep = independentPaydayPaid(plan, PAYDAY);
  ok(indep.inflows.length === 1 && indep.inflows[0].id === 'payroll'
      && near(indep.inflows[0].amount, PAYROLL),
    'independent payday-date stream has Seaspan in only');
  ok(indep.bills.some(e => e.id === 'mortgage' && near(-e.amount, MORTGAGE))
      && indep.bills.some(e => e.id === 'fit4less' && near(-e.amount, FIT))
      && indep.bills.length === 2,
    'independent payday-date stream has mortgage and Fit4Less paid only');
  ok(!indep.inflows.some(e => e.id === 'childBenefit')
      && !indep.bills.some(e => e.id === 'bcaa-aug15-outstanding'),
    'independent payday-date stream omits Aug 20 child benefit and Aug 16 BCAA');

  const action = F.currentPeriodAction(plan, AS_OF, {
    targetBuffer: 0,
    representedEvents: plan.opening.representedEvents,
  });
  ok(action.thisPayday === PAYDAY, 'thisPayday is the Aug 28 cheque date');
  const paidIds = [
    ...(action.thisPaydayPaid.inflows || []).map(r => r.id),
    ...(action.thisPaydayPaid.bills || []).map(r => r.id),
  ].sort();
  ok(JSON.stringify(paidIds) === JSON.stringify(['fit4less', 'mortgage', 'payroll'].sort()),
    'thisPaydayPaid is Seaspan, mortgage, Fit4Less',
    paidIds.join(','));
  ok(!(action.thisPaydayPaid.inflows || []).some(r => r.id === 'childBenefit'),
    'Aug 20 child benefit is not this payday already paid');
  ok(!(action.thisPaydayPaid.bills || []).some(r => r.id === 'bcaa-aug15-outstanding'),
    'Aug 16 BCAA is not this payday already paid');
  const dueIds = (action.thisPaydayDue || []).map(r => r.id).sort();
  ok(dueIds.includes('travel') && dueIds.includes('tdfees'),
    'Travel Visa min and TD fees stay still due',
    dueIds.join(','));
  ok(!dueIds.includes('bcaa-aug15-outstanding') && !dueIds.includes('mortgage')
      && !dueIds.includes('fit4less'),
    'previous-cycle BCAA and paid payday bills are not still due',
    dueIds.join(','));
}

console.log('\n=== default glance prints that set in kitchen-counter language ===');
{
  const plan = syntheticPlan();
  const advice = F.recommend(plan, AS_OF, { targetBuffer: 0 });
  const composer = loadComposer();
  const html = composer.operatingSurfaceHtml({
    advice,
    weekly: advice.weekly,
    recommended: advice.weekly,
  });
  const glance = defaultGlance(html);
  const text = glance.replace(/<[^>]+>/g, ' ');
  ok(/Already paid/.test(html) && !/Already left this payday/.test(html),
    'the heading is already paid, not already left');
  ok(/data-payday-already-paid/.test(html) && /data-payday-still-due/.test(html),
    'still due and already paid are distinct blocks');
  ok(/Still needs to leave/.test(html) && /Already paid from this payday/.test(html),
    'the two lists do not share the same leftover-to-pay wording');
  ok(/Payroll — Seaspan · Aug 28 · in/.test(glance)
      && /Mortgage · Aug 28 · paid/.test(glance)
      && /Fit4Less membership · Aug 28 · paid/.test(glance),
    'default glance already paid is Seaspan in, mortgage paid, Fit4Less paid');
  ok(!/Canada child benefit/.test(glance) && !/BCAA/.test(glance)
      && !/ICBC/.test(glance) && !/RESP/.test(glance) && !/CMAW/.test(glance)
      && !/union dues/i.test(glance),
    'default glance omits Aug 15/16 stubs and Aug 20 child benefit');
  ok(/Travel Visa minimum/.test(glance) && /TD account fees/.test(glance)
      && /still due/.test(glance),
    'Travel Visa min and TD fees stay still due without an invented payee');
  ok(!/posting unknown/i.test(text),
    'default glance does not print posting unknown');
  ok(!/unverified-settlement|\boverlay\b|\bForecast\b|\bAtlas\b|\bunverified\b|\brepresented\b/.test(text),
    'default glance stays kitchen-counter language');
  const q2 = html.slice(html.indexOf('data-operating-question="02"'),
    html.indexOf('data-operating-question="03"'));
  const q3 = html.slice(html.indexOf('data-operating-question="03"'),
    html.indexOf('data-operating-question="04"'));
  ok(/still due/.test(q2) && !/ · paid/.test(q2) && !/ · in/.test(q2),
    'still due does not reprint the already-paid list');
  ok(/ · paid/.test(q3) && / · in/.test(q3) && !/still due/.test(q3),
    'already paid does not reprint the still-due list');
}

console.log('\n=== page prints Forecast; it does not date-filter ===');
{
  const planSrc = read('public/plan.js');
  const paidFn = /function alreadyPaidRowsHtml\([\s\S]*?\n\}/.exec(planSrc);
  const dueFn = /function stillDueItems\([\s\S]*?\n\}/.exec(planSrc);
  ok(paidFn && /thisPaydayPaid/.test(paidFn[0]) && !/row\.date\s*===/.test(paidFn[0]),
    'alreadyPaidRowsHtml copies thisPaydayPaid and does not filter dates');
  ok(dueFn && /thisPaydayDue/.test(dueFn[0]) && !/frequency === 'once'/.test(dueFn[0]),
    'stillDueItems copies thisPaydayDue and does not classify once stubs');
}

console.log('\n=== cancelled CMAW dues are gone from Plan/Forecast bills ===');
{
  const plan = data.plan;
  const outstandingId = 'uniondues-aug15-outstanding';
  ok(!(plan.bills || []).some(b => b.id === 'uniondues' || b.id === outstandingId
      || /cmaw/i.test(b.label || '')),
    'canonical bills have no CMAW or uniondues row');
  const asOf = data.meta.asOf;
  const events = F.expandEvents(plan, '2026-08-16', '2027-08-15', {});
  const cmaw = events.filter(e => e.id === 'uniondues' || e.id === outstandingId
    || /cmaw|union dues/i.test(e.label || ''));
  ok(cmaw.length === 0, 'Forecast emits no CMAW cash event, including August',
    cmaw.map(e => e.id + '@' + e.date).join(','));
  function monthlyFifteenths(startIso, endIso) {
    const out = [];
    let [year, month] = startIso.split('-').map(Number);
    const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
    const pad = n => String(n).padStart(2, '0');
    for (;;) {
      const iso = year + '-' + pad(month) + '-' + pad(Math.min(15, daysInMonth(year, month)));
      if (iso > endIso) break;
      if (iso >= startIso) out.push(iso);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return out;
  }
  const fifteenths = monthlyFifteenths('2026-08-15', '2027-08-15');
  ok(fifteenths[0] === '2026-08-15' && fifteenths.length >= 12,
    'independent calendar still lists the 15ths');
  ok(!fifteenths.some(iso => events.some(e => e.date === iso && near(-e.amount, 25)
      && /cmaw|union/i.test((e.id || '') + (e.label || '')))),
    'none of those 15ths is a $25 CMAW cash event');
  ok(!/uniondues-aug15-outstanding/.test(JSON.stringify(plan.bills)),
    'the posting-unknown stub id is gone from bills');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
