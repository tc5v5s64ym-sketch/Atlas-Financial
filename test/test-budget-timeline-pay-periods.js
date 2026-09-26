'use strict';
/* Budget timeline: one chronological Budget-shaped Seaspan sequence.
 *
 * Expected cents below are literal arithmetic on this fixture. They are
 * not copied from Forecast helper output.
 *
 * Seaspan anchor 2026-08-14, +14 days. As-of 2026-10-09:
 *   current  Oct 9–22     Dale 4000 + Amanda 15th 2000 + child benefit Oct 20 500 = 6500
 *                        bills 0; Household Budget 200 + 150 + 100 = 450
 *                        BAD 6500 − 0 − 450 = 6050
 *   next     Oct 23–Nov 5 Dale 4000 + Amanda month-end Oct 31 1500 = 5500
 *                        mortgage Nov 1 1600 + hydro Nov 3 199 = 1799
 *                        Household Budget 200 + 150 + 0 = 350
 *                        BAD 5500 − 1799 − 350 = 3351
 *   N+2      Nov 6–19     Dale 4000 + Amanda Nov 15 2000 = 6000
 *                        bills 0; Household Budget 450; BAD 5550
 *   N+3      Nov 20–Dec 3 Dale 4000 + Amanda Nov 30 (day 31 clamped) 1500
 *                        + child benefit Nov 20 500 = 6000
 *                        mortgage Dec 1 1600 + hydro Dec 3 199 = 1799
 *                        Household Budget 350; BAD 3851
 *
 * Household Budget on a future or current row with no actuals:
 *   groceries plannedWeekly 100 → 200; dale-guilt-free plannedPayday 150;
 *   pets 100 only on the first Seaspan start of that calendar month
 *   (Oct 9, Nov 6, Dec 4), else 0.
 *
 * `node test/test-budget-timeline-pay-periods.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');

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
function roundCent(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const ANCHOR = '2026-08-14';
const AS_OF = '2026-10-09';
const DALE = 4000;
const AMANDA_15 = 2000;
const AMANDA_END = 1500;
const CHILD = 500;
const MORTGAGE = 1600;
const HYDRO = 199;
const GROCERY_CYCLE = 200;
const DALE_FREE = 150;
const PETS = 100;
const MODELLED_THROUGH = '2026-12-31';

const debts = [];

function timelinePlan(asOf, extra) {
  extra = extra || {};
  return {
    defaults: { targetBuffer: 500 },
    windowDays: 91,
    startingCash: {
      breakdown: [{
        id: 'chequing-a', label: 'BILLS ACCOUNT', value: 2000, class: 'spendable',
      }],
    },
    opening: Object.assign({ asOf }, extra.opening || {}),
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor: ANCHOR, amount: DALE, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda salary — 15th', frequency: 'monthly',
        day: 15, amount: AMANDA_15, confidence: 'confirmed',
      },
      {
        id: 'amandaSalaryMonthEnd', label: 'Amanda salary — month-end', frequency: 'monthly',
        day: 31, amount: AMANDA_END, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Child benefit', frequency: 'monthly',
        day: 20, amount: CHILD, confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'mortgage', label: 'Mortgage', amount: MORTGAGE,
        frequency: 'monthly', day: 1, confidence: 'confirmed',
        payingAccount: 'chequing-a',
      },
      {
        id: 'hydro', label: 'Hydro', amount: HYDRO,
        frequency: 'monthly', day: 3, confidence: 'confirmed',
        payingAccount: 'chequing-a',
      },
    ].concat(extra.bills || []),
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', plannedWeekly: 100 },
        { id: 'dale-guilt-free', label: 'Dale guilt-free spending', plannedPayday: DALE_FREE },
        {
          id: 'pets', label: 'Dog food', plannedPayday: PETS,
          paydayCadence: 'first-seaspan-of-month',
        },
      ],
    },
  };
}

function recommend(plan, asOf, opts) {
  return F.recommend(plan, asOf || AS_OF, Object.assign({
    targetBuffer: 500,
    debts,
  }, opts || {}));
}

function rowByRole(advice, role) {
  return (advice.payPeriodViews || []).find(p => p && p.timelineRole === role) || null;
}
function rowByStart(advice, start) {
  return (advice.payPeriodViews || []).find(p => p && p.start === start) || null;
}
function incomeOn(period, id, date) {
  return ((period && period.income) || []).filter(r => r && r.id === id && r.date === date);
}
function billOn(period, id, date) {
  return ((period && period.bills) || []).filter(r => r && r.id === id && r.date === date);
}
function budgetItem(period, id) {
  return ((period && period.householdBudget) || []).find(r => r && r.id === id) || null;
}
function holdFor(pets) {
  return roundCent(GROCERY_CYCLE + DALE_FREE + pets);
}

const CURRENT = { start: '2026-10-09', end: '2026-10-22', income: 6500, bills: 0, hold: holdFor(PETS), bad: 6050 };
const NEXT = { start: '2026-10-23', end: '2026-11-05', income: 5500, bills: roundCent(MORTGAGE + HYDRO), hold: holdFor(0), bad: 3351 };
const N2 = { start: '2026-11-06', end: '2026-11-19', income: 6000, bills: 0, hold: holdFor(PETS), bad: 5550 };
const N3 = { start: '2026-11-20', end: '2026-12-03', income: 6000, bills: roundCent(MORTGAGE + HYDRO), hold: holdFor(0), bad: 3851 };

function expectPeriod(period, spec, label) {
  ok(!!period, label + ' exists');
  if (!period) return;
  ok(period.start === spec.start && period.end === spec.end,
    label + ' dates', `${period.start}..${period.end}`);
  ok(near(period.incomeTotal, spec.income),
    label + ' income', `${period.incomeTotal} vs ${spec.income}`);
  ok(near(period.periodBillLoad, spec.bills),
    label + ' bills', `${period.periodBillLoad} vs ${spec.bills}`);
  ok(near(period.budgetHold, spec.hold),
    label + ' household budget', `${period.budgetHold} vs ${spec.hold}`);
  ok(near(period.balanceAfterDeductions, spec.bad),
    label + ' BAD', `${period.balanceAfterDeductions} vs ${spec.bad}`);
  ok(near(period.balanceAfterDeductions, roundCent(spec.income - spec.bills - spec.hold)),
    label + ' BAD is income − bills − household budget');
  const terms = period.predictedEndingBalanceTerms;
  ok(terms && terms.closes === true && terms.identity === 'balance-after-deductions',
    label + ' terms close on balance-after-deductions');
  ok(terms && !Object.prototype.hasOwnProperty.call(terms, 'opening'),
    label + ' opening is not a BAD term');
}

console.log('=== 1. current row is the incumbent calendar period, to the cent ===');
{
  const plan = timelinePlan(AS_OF);
  const advice = recommend(plan);
  const periods = advice.defaultView.calendarPeriods || [];
  const current = rowByRole(advice, 'current');
  ok(periods.length === 2, 'calendarPeriods stays two rows', 'length=' + periods.length);
  ok(periods[0] && periods[0].id === 'this-pay-period', 'first calendar row is This Pay Period');
  ok(current === periods[0], 'timeline current is the same object as calendarPeriods[0]');
  expectPeriod(current, CURRENT, 'current');
  ok(current && current.timelineOffset === 0 && current.evidenceState === 'live',
    'current labels are offset 0 and live evidence');
  const pets = budgetItem(current, 'pets');
  ok(pets && near(pets.planned, PETS), 'Oct 9 is the first Seaspan start of October, so dog food is 100');
}

console.log('\n=== 2. timeline next is Budget Next Pay Period; nextPeriodView is not ===');
{
  const plan = timelinePlan(AS_OF);
  const advice = recommend(plan);
  const periods = advice.defaultView.calendarPeriods || [];
  const next = rowByRole(advice, 'next');
  ok(periods[1] && periods[1].id === 'next-pay-period', 'second calendar row is Next Pay Period');
  ok(next === periods[1], 'timeline next is the same object as calendarPeriods[1]');
  expectPeriod(next, NEXT, 'timeline next');
  ok(next && next.timelineRole === 'next' && next.evidenceState === 'projected',
    'timeline next is projected evidence on Budget\'s next row');
  ok(next && next.openingLabel == null,
    'the shared Budget next row does not gain a second opening label');
  const lookahead = advice.nextPeriodView;
  ok(lookahead && lookahead !== next, 'nextPeriodView is a different object');
  ok(lookahead.periodStart === NEXT.start && lookahead.periodEnd === NEXT.end,
    'nextPeriodView still spans the next Seaspan cycle');
  ok(lookahead.balanceAfterDeductions == null
      && lookahead.predictedEndingBalanceIdentity == null,
    'nextPeriodView publishes no Balance After Deductions identity');
  ok(lookahead.cashNote === 'Current Balance. Not credit. Opening this pay period.',
    'nextPeriodView keeps the lookahead cash note');
  const lookBudget = lookahead.householdBudget || [];
  const groceries = lookBudget.find(r => r && r.id === 'groceries');
  ok(groceries && near(groceries.amount, GROCERY_CYCLE),
    'lookahead groceries are the 14-day weekly scale, 200');
  ok(!lookBudget.some(r => r && r.id === 'dale-guilt-free'),
    'lookahead ten-block omits dale-guilt-free, which Budget\'s next row holds');
  ok(!near(lookahead.afterHouseholdBudget, NEXT.bad),
    'lookahead leftover is not Budget next BAD',
    `${lookahead.afterHouseholdBudget} vs ${NEXT.bad}`);
  ok(!(advice.payPeriodViews || []).some(p => p && p.id && String(p.id).indexOf('future:') === 0
      && periods.indexOf(p) >= 0),
    'further future rows are not added to calendarPeriods');
}

console.log('\n=== 3. N+2 and N+3 BAD match the hand arithmetic ===');
{
  const advice = recommend(timelinePlan(AS_OF));
  const futures = (advice.payPeriodViews || []).filter(p => p && p.timelineRole === 'future');
  ok(futures.length === 4, 'four further future cycles fit before 2026-12-31',
    'count=' + futures.length);
  expectPeriod(futures[0], N2, 'N+2');
  expectPeriod(futures[1], N3, 'N+3');
  ok(futures[0] && futures[0].timelineOffset === 2, 'N+2 offset is +2');
  ok(futures[1] && futures[1].timelineOffset === 3, 'N+3 offset is +3');
  ok(near(N2.bad, roundCent(6000 - 0 - holdFor(PETS))), 'N+2 literal 6000 − 0 − 450 = 5550');
  ok(near(N3.bad, roundCent(6000 - (MORTGAGE + HYDRO) - holdFor(0))),
    'N+3 literal 6000 − 1799 − 350 = 3851');
}

console.log('\n=== 4. each dated item lands in exactly one period ===');
{
  const advice = recommend(timelinePlan(AS_OF));
  const views = advice.payPeriodViews || [];
  function placements(id, date, kind) {
    const hits = [];
    for (const period of views) {
      const rows = kind === 'bill' ? billOn(period, id, date) : incomeOn(period, id, date);
      if (rows.length) hits.push(period.start);
    }
    return hits;
  }
  function once(id, date, kind, start, label) {
    const hits = placements(id, date, kind);
    ok(hits.length === 1 && hits[0] === start,
      label, `hits=${hits.join(',') || 'none'}`);
  }
  once('payroll', '2026-10-09', 'income', CURRENT.start, 'Dale Oct 9 is current');
  once('payroll', '2026-10-23', 'income', NEXT.start, 'Dale Oct 23 is next');
  once('payroll', '2026-11-06', 'income', N2.start, 'Dale Nov 6 is N+2');
  once('payroll', '2026-11-20', 'income', N3.start, 'Dale Nov 20 is N+3');
  once('payroll', '2026-12-04', 'income', '2026-12-04', 'Dale Dec 4 is that cycle');
  once('payroll', '2026-12-18', 'income', '2026-12-18', 'Dale Dec 18 is that cycle');
  ok(placements('payroll', '2027-01-01', 'income').length === 0,
    'Dale Jan 1 2027 is not published');
  once('amandaSalary15', '2026-10-15', 'income', CURRENT.start, 'Amanda Oct 15 is current');
  once('amandaSalary15', '2026-11-15', 'income', N2.start, 'Amanda Nov 15 is N+2');
  once('amandaSalary15', '2026-12-15', 'income', '2026-12-04', 'Amanda Dec 15 is Dec 4–17');
  ok(placements('amandaSalary15', '2027-01-15', 'income').length === 0,
    'Amanda Jan 15 2027 is not published');
  once('amandaSalaryMonthEnd', '2026-10-31', 'income', NEXT.start,
    'Amanda Oct 31 is the cross-month next period');
  once('amandaSalaryMonthEnd', '2026-11-30', 'income', N3.start,
    'Amanda day 31 clamps to Nov 30 and lands in Nov 20–Dec 3');
  ok(placements('amandaSalaryMonthEnd', '2026-11-31', 'income').length === 0,
    'November does not keep an unclamped day 31');
  once('amandaSalaryMonthEnd', '2026-12-31', 'income', '2026-12-18',
    'Amanda Dec 31 is Dec 18–31');
  ok(placements('amandaSalaryMonthEnd', '2027-02-28', 'income').length === 0,
    'February 2027 month-end clamp is outside the payroll boundary');
  once('childBenefit', '2026-10-20', 'income', CURRENT.start, 'Child benefit Oct 20 is current');
  once('childBenefit', '2026-11-20', 'income', N3.start, 'Child benefit Nov 20 opens that cycle');
  once('childBenefit', '2026-12-20', 'income', '2026-12-18', 'Child benefit Dec 20 is Dec 18–31');
  once('mortgage', '2026-11-01', 'bill', NEXT.start, 'Mortgage Nov 1 is the cross-month next period');
  once('mortgage', '2026-12-01', 'bill', N3.start, 'Mortgage Dec 1 is Nov 20–Dec 3');
  ok(placements('mortgage', '2027-01-01', 'bill').length === 0,
    'Mortgage Jan 1 2027 is not published');
  once('hydro', '2026-11-03', 'bill', NEXT.start, 'Hydro Nov 3 is the cross-month next period');
  once('hydro', '2026-12-03', 'bill', N3.start, 'Hydro Dec 3 is the last day of Nov 20–Dec 3');
  const cross = rowByStart(advice, NEXT.start);
  ok(cross && incomeOn(cross, 'amandaSalaryMonthEnd', '2026-10-31').length === 1
      && billOn(cross, 'mortgage', '2026-11-01').length === 1
      && billOn(cross, 'hydro', '2026-11-03').length === 1
      && incomeOn(cross, 'payroll', '2026-10-23').length === 1,
    'the Oct 23–Nov 5 cross-month period holds Dale, Amanda month-end, mortgage, and hydro');
  ok(cross && incomeOn(cross, 'amandaSalary15', '2026-11-15').length === 0
      && incomeOn(cross, 'payroll', '2026-11-06').length === 0,
    'the cross-month period does not take the next cycle\'s payday or Amanda 15th');
  const petsStarts = views.filter(p => {
    const pets = budgetItem(p, 'pets');
    return pets && near(pets.planned, PETS) && p.timelineRole !== 'past';
  }).map(p => p.start);
  ok(petsStarts.join(',') === '2026-10-09,2026-11-06,2026-12-04',
    'dog food is assigned once, on the first Seaspan start of each month',
    petsStarts.join(','));
}

console.log('\n=== 5. future rows do not invent actuals ===');
{
  const advice = recommend(timelinePlan(AS_OF));
  const later = (advice.payPeriodViews || []).filter(p =>
    p && (p.timelineRole === 'next' || p.timelineRole === 'future'));
  ok(later.length >= 2, 'next and future rows are present');
  for (const period of later) {
    const paid = (period.bills || []).filter(b => b && (b.status === 'PAID' || b.glanceKind === 'paid'));
    ok(paid.length === 0, period.start + ' has no PAID bill without evidence',
      paid.map(b => b.id).join(','));
    ok(period.liveCurrentBalance == null, period.start + ' live Current Balance is null');
    ok(period.evidenceState === 'projected', period.start + ' evidence is projected');
    const items = period.householdBudget || [];
    ok(items.length > 0 && items.every(item => item && item.spent == null && item.projected === true),
      period.start + ' household budget spent is null and projected');
    if (period.timelineRole === 'future') {
      ok(period.openingLabel === 'Projected period cash',
        period.start + ' opening is labelled projected period cash');
      ok(period.cashNote && /Projected opening/.test(period.cashNote)
          && !/today's balance\.$/.test(period.cashNote.replace('Not today\'s balance.', '')),
        period.start + ' cash note is a projected opening');
    }
  }
  ok(!(advice.payPeriodTimeline && Object.prototype.hasOwnProperty.call(
    advice.payPeriodTimeline, 'extraDebt')),
    'the timeline does not publish an extra-debt total');
  ok(['count', 'currentIndex', 'horizonReason', 'incomeRegimeBoundary', 'through']
    .every(key => Object.prototype.hasOwnProperty.call(advice.payPeriodTimeline, key))
    && Object.keys(advice.payPeriodTimeline).length === 5,
    'payPeriodTimeline has only the bound fields');
}

console.log('\n=== 5b. represented future occurrence stays PAID and stays in the bill load ===');
{
  const plan = timelinePlan(AS_OF, {
    opening: {
      representedEvents: [{ id: 'represented-future', date: '2026-11-10' }],
    },
    bills: [{
      id: 'represented-future', label: 'Represented future bill', amount: 42,
      frequency: 'once', date: '2026-11-10', confidence: 'confirmed',
      payingAccount: 'chequing-a',
    }],
  });
  const advice = recommend(plan);
  const host = rowByStart(advice, N2.start);
  const represented = billOn(host, 'represented-future', '2026-11-10');
  ok(represented.length === 1 && represented[0].status === 'PAID',
    'a represented Nov 10 occurrence prints PAID on the future row');
  ok(host && near(host.periodBillLoad, 42),
    'that occurrence stays in the bill load', String(host && host.periodBillLoad));
  ok(host && near(host.balanceAfterDeductions, roundCent(6000 - 42 - holdFor(PETS))),
    'N+2 BAD with the represented bill is 6000 − 42 − 450 = 5508',
    String(host && host.balanceAfterDeductions));
  const others = (advice.payPeriodViews || []).filter(p =>
    p && (p.timelineRole === 'future' || p.timelineRole === 'next'));
  for (const period of others) {
    const paid = (period.bills || []).filter(b => b && b.status === 'PAID' && b.id !== 'represented-future');
    ok(paid.length === 0, period.start + ' has no other PAID bill',
      paid.map(b => b.id).join(','));
  }
}

console.log('\n=== 6. completed historical period is unchanged on the timeline ===');
{
  const historyAsOf = '2026-09-09';
  const plan = {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{
        id: 'chequing-a', label: 'BILLS ACCOUNT', value: 2300, class: 'spendable',
      }],
    },
    opening: {
      asOf: historyAsOf,
      paydaySnapshot: { periodStart: '2026-08-28', asOf: '2026-08-28', opening: 1000 },
      representedEvents: [
        { id: 'bill-prev', date: '2026-08-21' },
        { id: 'bill-earlier', date: '2026-08-07' },
      ],
    },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
        anchor: ANCHOR, amount: DALE, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda salary — 15th', frequency: 'monthly',
        day: 15, amount: AMANDA_15, confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'bill-prev', label: 'Synthetic previous bill', amount: 80,
        frequency: 'once', date: '2026-08-21', confidence: 'confirmed',
      },
      {
        id: 'bill-earlier', label: 'Synthetic earlier bill', amount: 90,
        frequency: 'once', date: '2026-08-07', confidence: 'confirmed',
      },
      {
        id: 'bill-recur-prev', label: 'Synthetic recurring previous',
        amount: 120, frequency: 'monthly', day: 21,
        confidence: 'confirmed', payingAccount: 'chequing-a',
      },
    ],
    obligations: [],
    commitments: [],
    budget: {
      categories: [{
        id: 'groceries', label: 'Groceries', class: 'essential',
        plannedWeekly: 100, ownerLine: 'Groceries', from: ['Groceries'],
      }],
    },
  };
  const actuals = {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: historyAsOf,
    coverageStart: '2026-07-31',
    coverageThrough: historyAsOf,
    pendingCoverage: 'complete',
    transactions: [
      {
        id: 'tx-past-gift', date: '2026-08-20', amount: -50, isIncome: true,
        categoryLabel: 'gifts', displayedPayee: 'Past gift', accountRole: 'household-cash',
      },
      {
        id: 'tx-grocery-prev', date: '2026-08-20', amount: 40, pending: false,
        categoryLabel: 'Groceries', accountRole: 'household-cash',
        displayedPayee: 'Save-On-Foods', originalMerchant: 'Save-On-Foods',
      },
    ],
    representedActuals: [],
  };
  const advice = F.recommend(plan, historyAsOf, {
    targetBuffer: 500,
    debts: [{
      id: 'triangle', label: 'Triangle', secured: false, structure: 'Revolving',
      balance: 2000, rate: 21.99, payment: 250, pending: 0,
    }],
    currentPeriodActuals: actuals,
    paydaySnapshot: plan.opening.paydaySnapshot,
  });
  const prev = (advice.pastPeriodViews || [])[0];
  const onTimeline = rowByStart(advice, '2026-08-14');
  ok(prev && prev.start === '2026-08-14' && prev.end === '2026-08-27',
    'newest completed period is Aug 14–27');
  ok(onTimeline === prev, 'timeline past row is the same pastPeriodViews object');
  ok(onTimeline && onTimeline.timelineRole === 'past' && onTimeline.evidenceState === 'historical',
    'that row is historical evidence');
  ok(onTimeline && onTimeline.liveCurrentBalance == null,
    'completed period does not publish live Current Balance');
  // Income 4000 + 2000 + observed gift 50 = 6050.
  // Bill load is the represented once bill 80. The recurring 120 is inside
  // the dated opening at print, so the incumbent load does not deduct it
  // again; historical sealing then shows it as planned.
  // Household budget hold is the observed grocery actual 40, not the 200 plan.
  // BAD = 6050 − 80 − 40 = 5930.
  ok(near(prev.incomeTotal, 6050), 'completed income is 6050', String(prev && prev.incomeTotal));
  ok(near(prev.periodBillLoad, 80), 'completed bill load is the represented 80',
    String(prev && prev.periodBillLoad));
  ok(near(prev.budgetHold, 40), 'completed household budget is observed spent 40',
    String(prev && prev.budgetHold));
  ok(near(prev.balanceAfterDeductions, 5930), 'completed BAD is 5930',
    String(prev && prev.balanceAfterDeductions));
  const recur = (prev.bills || []).find(b => b && b.id === 'bill-recur-prev');
  ok(recur && recur.status === 'planned', 'unproven recurring bill stays planned');
}

console.log('\n=== 7. payday rollover shifts rows without a duplicate or a skip ===');
{
  const before = recommend(timelinePlan('2026-10-09'), '2026-10-09');
  const after = recommend(timelinePlan('2026-10-23'), '2026-10-23');
  const beforeCurrent = rowByRole(before, 'current');
  const beforeNext = rowByRole(before, 'next');
  const beforeFuture = (before.payPeriodViews || []).find(p => p && p.timelineRole === 'future');
  const afterPast = (after.pastPeriodViews || [])[0];
  const afterCurrent = rowByRole(after, 'current');
  const afterNext = rowByRole(after, 'next');
  ok(beforeCurrent && beforeCurrent.start === '2026-10-09', 'before current starts Oct 9');
  ok(beforeNext && beforeNext.start === '2026-10-23', 'before next starts Oct 23');
  ok(beforeFuture && beforeFuture.start === '2026-11-06', 'before first future starts Nov 6');
  ok(afterPast && afterPast.start === '2026-10-09', 'after, previous current is the newest past');
  ok(rowByStart(after, '2026-10-09') === afterPast
      && rowByStart(after, '2026-10-09').timelineRole === 'past',
    'timeline past for Oct 9 is that same past row');
  ok(afterCurrent && afterCurrent.start === '2026-10-23', 'after, previous next is current');
  ok(afterNext && afterNext.start === '2026-11-06', 'after, previous first future is next');
  function startsFrom(advice, start) {
    return (advice.payPeriodViews || []).map(p => p.start).filter(s => s >= start);
  }
  const fromBefore = startsFrom(before, '2026-10-09');
  const fromAfter = startsFrom(after, '2026-10-09');
  ok(fromBefore.join(',') === fromAfter.join(','),
    'starts from Oct 9 through the horizon do not duplicate or skip',
    fromBefore.join(',') + ' vs ' + fromAfter.join(','));
  function contiguous(advice) {
    const starts = (advice.payPeriodViews || []).map(p => p.start);
    if (new Set(starts).size !== starts.length) return false;
    for (let i = 1; i < starts.length; i++) {
      if (addCalendarDays(starts[i - 1], 14) !== starts[i]) return false;
    }
    return starts.length > 1;
  }
  ok(contiguous(before) && contiguous(after),
    'both timelines are unique Seaspan starts 14 days apart');
  ok(!(after.payPeriodViews || []).some(p => p && p.start >= '2027-01-01'),
    'rollover still does not publish a 2027 cycle');
}

console.log('\n=== 8. repeated recommend is identical and does not mutate the plan ===');
{
  const plan = timelinePlan(AS_OF);
  const frozen = JSON.stringify(plan);
  const first = recommend(plan);
  const second = recommend(plan);
  ok(frozen === JSON.stringify(plan), 'recommend does not mutate the plan');
  ok(JSON.stringify(first.payPeriodViews) === JSON.stringify(second.payPeriodViews),
    'two recommends publish the same payPeriodViews');
  ok(JSON.stringify(first.payPeriodTimeline) === JSON.stringify(second.payPeriodTimeline),
    'two recommends publish the same payPeriodTimeline');
  ok(JSON.stringify(first.defaultView.calendarPeriods) === JSON.stringify(second.defaultView.calendarPeriods),
    'calendarPeriods do not accumulate');
  ok(JSON.stringify(first.nextPeriodView) === JSON.stringify(second.nextPeriodView),
    'nextPeriodView does not change across calls');
  ok(JSON.stringify(first.pastPeriodViews) === JSON.stringify(second.pastPeriodViews),
    'pastPeriodViews do not change across calls');
  ok(first.payPeriodViews.length === second.payPeriodViews.length,
    'the timeline does not grow on the second call');
}

console.log('\n=== horizon stops at the last full cycle on or before the boundary ===');
{
  const advice = recommend(timelinePlan(AS_OF));
  const timeline = advice.payPeriodTimeline;
  const futures = (advice.payPeriodViews || []).filter(p => p && p.timelineRole === 'future');
  ok(timeline.through === MODELLED_THROUGH, 'through is 2026-12-31');
  ok(timeline.incomeRegimeBoundary === MODELLED_THROUGH,
    'Dale-income authority end is the payroll-modelled boundary');
  ok(futures[futures.length - 1] && futures[futures.length - 1].end === MODELLED_THROUGH,
    'last future cycle ends on the boundary');
  ok(futures.every(p => p.end <= MODELLED_THROUGH),
    'every further cycle ends on or before the boundary');
  ok(/Payroll-modelled Dale-income authority ends 2026-12-31/.test(timeline.horizonReason),
    'horizonReason names the payroll-modelled boundary');
  ok(/2027 estimated payroll regime is unavailable/.test(timeline.horizonReason),
    'without planning assumptions the 2027 regime is unavailable');
  ok(/is not met inside this through date/.test(timeline.horizonReason),
    'horizonReason states the owner minimum is not met');
  ok(/2026 modelled net is not carried into 2027/.test(timeline.horizonReason),
    'horizonReason states the 2026 net is not carried forward');
  const extended = recommend(timelinePlan(AS_OF), AS_OF, {
    daleIncomeAuthorityEnd: '2027-12-31',
  });
  ok(extended.payPeriodTimeline.incomeRegimeBoundary === MODELLED_THROUGH
      && extended.payPeriodTimeline.through === MODELLED_THROUGH,
    'without the regime, a later requested end stays at 2026-12-31');
  ok(!(extended.payPeriodViews || []).some(p => p && p.start >= '2027-01-01'),
    'requesting 2027 does not publish a 2027 cycle when the regime is unavailable');
  const shortened = recommend(timelinePlan(AS_OF), AS_OF, {
    daleIncomeAuthorityEnd: '2026-11-05',
  });
  ok(shortened.payPeriodTimeline.through === '2026-11-05',
    'an earlier authority end is the through date');
  ok((shortened.payPeriodViews || []).filter(p => p && p.timelineRole === 'future').length === 0,
    'no partial cycle is added past that earlier end');
  ok(rowByRole(shortened, 'next') && rowByRole(shortened, 'next').end === '2026-11-05',
    'the incumbent next period remains even when it ends on the boundary');
  const early = recommend(timelinePlan('2026-08-14'), '2026-08-14');
  const earlyFutures = (early.payPeriodViews || []).filter(p => p && p.timelineRole === 'future');
  ok(earlyFutures.length === 8, 'from Aug 14, eight further cycles fit inside 2026',
    'count=' + earlyFutures.length);
  ok(earlyFutures[earlyFutures.length - 1]
      && earlyFutures[earlyFutures.length - 1].end === MODELLED_THROUGH,
    'those eight end on Dec 31');
  ok(/meets the owner minimum/.test(early.payPeriodTimeline.horizonReason)
      && !/is not met until/.test(early.payPeriodTimeline.horizonReason),
    'when eight cycles fit, the reason does not claim the minimum is unmet');
}

console.log('\n=== unavailable operating plan nulls timeline operating-cash claims ===');
{
  const advice = recommend(timelinePlan(AS_OF), AS_OF, { operatingPlan: 'unavailable' });
  const rows = advice.payPeriodViews || [];
  ok(rows.length > 2, 'unavailable plan still publishes the timeline');
  ok(rows.every(p => p && p.operatingCashExplanation == null),
    'every timeline row\'s operating-cash explanation is null');
  ok(advice.defaultView && advice.defaultView.operatingCashExplanation == null,
    'defaultView operating-cash explanation is null');
}

console.log('\n=== timeline source does not read Road Ahead ===');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'forecast.js'), 'utf8');
  function body(name, nextName) {
    const start = src.indexOf('function ' + name);
    const end = src.indexOf('function ' + nextName);
    if (start < 0 || end < start) return '';
    return src.slice(start, end);
  }
  const windows = body('timelinePayPeriodWindows', 'completedPayPeriodWindows');
  const compose = body('composePayPeriodTimeline', 'attachPaydayCarryover');
  const bound = body('payPeriodTimelineBound', 'payPeriodTimelineHorizonReason');
  const regime = body('timelineEstimatedDaleRegime', 'payPeriodTimelineBound');
  ok(windows && compose && bound && regime, 'timeline helpers are present');
  const blob = windows + compose + bound + regime;
  ok(!/baselineTrajectory|stage3|month-close|monthClose/.test(blob),
    'timeline windows, bound, composer, and regime stamp do not read Road Ahead values');
  ok(/daleEstimatedPayrollDeposits/.test(regime + bound),
    'the 2027 stamp reads the payroll-regime authority');
}

console.log('\n=== 2027 estimated regime on further-future rows only ===');
{
  // First 2027 Seaspan regular, deposit-year CPP/EI restart, annual 158091:
  //   gross 6080.42, pension 364.83, tax 1413.30, CPP 353.78, EI 99.11
  //   net 6080.42 − 1413.30 − 353.78 − 99.11 − 364.83 = 3849.40
  // February bonus is 18% of 158091 = 28456.38 gross. After four identical
  // regulars the bonus net is 14717.64 (tax 11581.75, CPP 1693.15, EI 463.84).
  const DALE_2027 = 3849.40;
  const BONUS_2027 = 14717.64;
  const assumptions = {
    salaryRaiseFactor: 1.04,
    bonusRate: 0.18,
    authorizedThroughYear: 2027,
  };
  function withRegime(asOf) {
    const plan = timelinePlan(asOf);
    plan.payrollPlanningAssumptions = assumptions;
    return plan;
  }
  const forbidden = /received|relied-upon|provider/i;
  function daleRows(period) {
    return ((period && period.income) || []).filter(r => r && (r.id === 'payroll' || r.id === 'payrollBonus'));
  }

  const oct = recommend(withRegime(AS_OF));
  const current = rowByRole(oct, 'current');
  const next = rowByRole(oct, 'next');
  ok(current === oct.defaultView.calendarPeriods[0],
    'regime plan current is still calendarPeriods[0]');
  ok(next === oct.defaultView.calendarPeriods[1],
    'regime plan next is still calendarPeriods[1]');
  expectPeriod(current, CURRENT, 'regime current');
  expectPeriod(next, NEXT, 'regime next');
  ok(daleRows(current).every(r => r.amount === DALE && !r.incomeRegime),
    'current Dale row stays the 2026 fixture amount');
  ok(daleRows(next).every(r => r.amount === DALE && !r.incomeRegime),
    'Budget next Dale row stays the 2026 fixture amount');

  const dec = rowByStart(oct, '2026-12-18');
  const jan = rowByStart(oct, '2027-01-01');
  ok(dec && dec.timelineRole === 'future', 'Dec 18–31 is a further-future row');
  ok(jan && jan.timelineRole === 'future', 'Jan 1–14 is a further-future row');
  const decDale = incomeOn(dec, 'payroll', '2026-12-18');
  ok(decDale.length === 1 && decDale[0].amount === DALE && !decDale[0].incomeRegime,
    'the December 2026 pay stays the fixture amount', decDale[0] && String(decDale[0].amount));
  expectPeriod(dec, {
    start: '2026-12-18', end: '2026-12-31',
    income: 6000, bills: 0, hold: holdFor(0), bad: 5650,
  }, 'Dec 18 boundary');
  const janDale = incomeOn(jan, 'payroll', '2027-01-01');
  ok(janDale.length === 1 && janDale[0].amount === DALE_2027,
    'the January 2027 pay is the estimated net', janDale[0] && String(janDale[0].amount));
  ok(janDale[0] && janDale[0].amount !== DALE && janDale[0].amount !== 4264,
    'January does not carry 4000 or 4264');
  const janIncome = roundCent(DALE_2027);
  const janBills = roundCent(MORTGAGE + HYDRO);
  const janHold = holdFor(PETS);
  const janBad = roundCent(janIncome - janBills - janHold);
  ok(janBad === 1600.40, 'hand BAD for Jan 1–14 is 1600.40', String(janBad));
  expectPeriod(jan, {
    start: '2027-01-01', end: '2027-01-14',
    income: janIncome, bills: janBills, hold: janHold, bad: janBad,
  }, 'Jan 1 estimated');
  ok(budgetItem(jan, 'pets') && near(budgetItem(jan, 'pets').planned, PETS),
    'January dog food lands on the first Seaspan start');
  ok(billOn(jan, 'mortgage', '2027-01-01').length === 1
      && billOn(jan, 'hydro', '2027-01-03').length === 1,
    'January mortgage and hydro land once in Jan 1–14');
  ok(billOn(dec, 'mortgage', '2027-01-01').length === 0,
    'January mortgage is not also in the December period');

  const labelled = (oct.payPeriodViews || []).filter(p => p && p.timelineRole === 'future');
  let estimatedRows = 0;
  for (const period of labelled) {
    for (const row of daleRows(period)) {
      if (!row.date || row.date < '2027-01-01') continue;
      estimatedRows += 1;
      const mark = [row.status, row.settlement, row.confidence, row.incomeRegime].join(' ');
      ok(row.confidence === 'estimated' && row.status === 'estimated'
          && row.incomeRegime === '2027-estimated' && row.settlement === 'estimated',
        row.date + ' Dale row is marked estimated', mark);
      ok(!forbidden.test(mark), row.date + ' has no received, relied-upon, or provider language', mark);
      ok(row.amount !== DALE && row.amount !== 4264,
        row.date + ' is not the carried 2026 net', String(row.amount));
    }
  }
  ok(estimatedRows > 0, 'at least one 2027 Dale row is labelled', 'count=' + estimatedRows);

  const bonusHits = [];
  for (const period of oct.payPeriodViews || []) {
    for (const row of (period.income || [])) {
      if (row && (row.id === 'payrollBonus' || row.date === '2027-02-25')) {
        bonusHits.push({ start: period.start, row });
      }
    }
  }
  ok(bonusHits.length === 1 && bonusHits[0].start === '2027-02-12'
      && bonusHits[0].row.amount === BONUS_2027
      && bonusHits[0].row.incomeRegime === '2027-estimated',
    'the February bonus is in Feb 12–25 once',
    bonusHits.map(h => h.start + ':' + (h.row && h.row.amount)).join(','));
  const feb = rowByStart(oct, '2027-02-12');
  const febRegular = incomeOn(feb, 'payroll', '2027-02-12');
  ok(febRegular.length === 1 && febRegular[0].amount === DALE_2027,
    'Feb 12 regular is still the pre-anniversary estimated net');
  const febIncome = roundCent(DALE_2027 + BONUS_2027 + AMANDA_15 + CHILD);
  const febHold = holdFor(PETS);
  const febBad = roundCent(febIncome - 0 - febHold);
  ok(febBad === 20617.04, 'hand BAD for the bonus period is 20617.04', String(febBad));
  expectPeriod(feb, {
    start: '2027-02-12', end: '2027-02-25',
    income: febIncome, bills: 0, hold: febHold, bad: febBad,
  }, 'Feb 12 bonus period');
  ok(feb && feb.evidenceState === 'projected' && feb.liveCurrentBalance == null,
    'the bonus period invents no live Current Balance');
  ok((feb.householdBudget || []).every(item => item && item.spent == null),
    'the bonus period invents no household spent');

  const rolled = recommend(withRegime('2026-12-18'), '2026-12-18');
  const rolledCurrent = rowByRole(rolled, 'current');
  const rolledNext = rowByRole(rolled, 'next');
  const rolledFuture = rowByStart(rolled, '2027-01-15');
  ok(rolledCurrent && rolledCurrent.start === '2026-12-18'
      && incomeOn(rolledCurrent, 'payroll', '2026-12-18')[0].amount === DALE,
    'when December is current, its Dale pay stays the fixture amount');
  ok(rolledNext && rolledNext.id === 'next-pay-period'
      && rolledNext === rolled.defaultView.calendarPeriods[1]
      && incomeOn(rolledNext, 'payroll', '2027-01-01')[0].amount === DALE
      && !incomeOn(rolledNext, 'payroll', '2027-01-01')[0].incomeRegime,
    'Budget next keeps the incumbent January amount, not the estimate');
  ok(rolledFuture && rolledFuture.timelineRole === 'future'
      && incomeOn(rolledFuture, 'payroll', '2027-01-15')[0].amount === DALE_2027
      && incomeOn(rolledFuture, 'payroll', '2027-01-15')[0].incomeRegime === '2027-estimated',
    'the following future row uses the January estimate');

  const sep = recommend(withRegime('2026-09-25'), '2026-09-25');
  const sepTimeline = sep.payPeriodTimeline;
  const sepFutures = (sep.payPeriodViews || []).filter(p => p && p.timelineRole === 'future');
  const eighth = rowByStart(sep, '2027-01-29');
  ok(sepTimeline.incomeRegimeBoundary === MODELLED_THROUGH,
    'incomeRegimeBoundary stays 2026-12-31');
  ok(sepTimeline.through === '2027-09-24',
    'from Sep 25 the knowledge horizon binds through', sepTimeline.through);
  ok(/binding boundary is the knowledge horizon/.test(sepTimeline.horizonReason),
    'horizonReason names the knowledge horizon');
  ok(/2027 estimated payroll regime through 2027-12-31/.test(sepTimeline.horizonReason),
    'horizonReason names the estimated-regime end');
  ok(eighth && eighth.end === '2027-02-11' && eighth.timelineRole === 'future',
    'next+8 reaches Jan 29–Feb 11 2027');
  ok(sepFutures.length >= 8, 'at least eight further future rows are published',
    'count=' + sepFutures.length);
  ok(sepFutures.every(p => p.end <= sepTimeline.through),
    'every further cycle ends on or before through');
  ok(/meets the owner minimum/.test(sepTimeline.horizonReason),
    'Sep 25 meets the owner minimum');
  const starts = (sep.payPeriodViews || []).map(p => p.start);
  ok(new Set(starts).size === starts.length, 'Sep 25 timeline starts do not duplicate');
  console.log('  future-row count from 2026-09-25: ' + sepFutures.length);

  const capped = recommend(withRegime(AS_OF), AS_OF, {
    daleIncomeAuthorityEnd: '2028-06-30',
  });
  ok(capped.payPeriodTimeline.through === '2027-10-08',
    'a later requested end cannot pass the knowledge horizon',
    capped.payPeriodTimeline.through);
  ok(!(capped.payPeriodViews || []).some(p => p && p.start >= '2028-01-01'),
    '2028 cycles stay unpublished');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
