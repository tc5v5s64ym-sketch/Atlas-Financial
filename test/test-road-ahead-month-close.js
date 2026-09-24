'use strict';
// Road Ahead Month available surplus follows the Seaspan close, not a
// calendar slice. Expected cents are built from an integer payday calendar
// in this file. They do not call Forecast's funding helper.
const assert = require('assert/strict');
const F = require('../public/forecast');

const ANCHOR = '2026-09-25';
const PAY = 1000;
let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function day(iso) {
  return Date.parse(iso + 'T00:00:00Z') / 86400000;
}
function iso(n) {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}
function add(s, n) {
  return iso(day(s) + n);
}

// Payday-to-payday closes. The close is the day before the next payday.
function handPeriods(anchor, from, through) {
  const rows = [];
  let payday = anchor;
  while (payday <= through) {
    const next = add(payday, 14);
    const close = add(next, -1);
    const start = payday < from ? from : payday;
    if (close >= from && start <= close) {
      rows.push({ payday, start, close, month: close.slice(0, 7) });
    }
    payday = next;
  }
  return rows;
}

function plan(extra) {
  return Object.assign({
    windowDays: 120,
    startingCash: { amount: 4000 },
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: ANCHOR },
    budget: {
      basis: 'ytd',
      categories: [{
        id: 'groceries', label: 'Groceries', class: 'essential',
        from: ['Groceries'], plannedWeekly: 0,
      }],
    },
    income: [{
      id: 'payroll', label: 'Dale — Seaspan',
      frequency: 'biweekly', anchor: ANCHOR, amount: PAY,
      confidence: 'confirmed',
    }],
    obligations: [],
    bills: [
      { id: 'sep-costs', label: 'September costs', frequency: 'once', date: '2026-09-28', amount: 105, confidence: 'confirmed' },
      { id: 'oct-costs', label: 'October costs', frequency: 'once', date: '2026-10-12', amount: 738, confidence: 'confirmed' },
    ],
    commitments: [],
  }, extra || {});
}

function ask(p) {
  return F.baselineTrajectory(p, [], p.opening.asOf, {
    periods: { periods: { ytd: { months: 1, spending: [] } } },
  });
}

function periodSurplus(row, bills) {
  const income = row.payday >= row.start && row.payday <= row.close ? PAY : 0;
  const outflow = bills.filter(b => b.date >= row.start && b.date <= row.close)
    .reduce((sum, b) => sum + b.amount, 0);
  return Math.round((income - outflow) * 100) / 100;
}

const bills = [
  { date: '2026-09-28', amount: 105 },
  { date: '2026-10-12', amount: 738 },
];

const base = ask(plan({
  commitments: [{
    id: 'oct-purchase', label: 'October purchase',
    date: '2026-10-31', amount: 1200, flexibility: 'required', confidence: 'confirmed',
  }],
}));
assert.equal(base.status, 'ready');
const horizonEnd = base.horizon.end;
const hand = handPeriods(ANCHOR, ANCHOR, horizonEnd).map(row => Object.assign(row, {
  surplus: periodSurplus(row, bills),
}));
const byMonth = {};
for (const row of hand) {
  byMonth[row.month] = Math.round(((byMonth[row.month] || 0) + row.surplus) * 100) / 100;
}
eq(hand.find(r => r.payday === '2026-09-25').surplus, 895, 'Sep 25–Oct 8 hand surplus');
eq(hand.find(r => r.payday === '2026-10-09').surplus, 262, 'Oct 9–22 hand surplus');
eq(hand.find(r => r.payday === '2026-10-23').surplus, 1000, 'Oct 23–Nov 5 hand surplus');
eq(byMonth['2026-10'], 1157, 'October hand total is the two closes');
eq(hand.find(r => r.close === '2026-11-05').month, '2026-11', 'Nov 5 close belongs to November');

const oct = base.months.find(m => m.month === '2026-10');
const nov = base.months.find(m => m.month === '2026-11');
eq(oct.stage1.result.amount, 1157, 'October surplus before planned spending');
eq(oct.stage1.result.futurePeriodSurplus, 'excluded', 'October does not borrow a later close');
eq(oct.stage2.commitments.amount, 1200, 'October 31 requirement stays in October');
eq(oct.stage2.result.amount, -43, 'October is short without the November close');
const octLine = oct.stage2.commitments.lines.find(l => l.id === 'oct-purchase');
eq(octLine.shortfall, 43, 'October 31 line is short on its own date');
eq(nov.stage1.result.amount, byMonth['2026-11'], 'November receives the Nov 5 period');
eq((nov.stage2.commitments && nov.stage2.commitments.amount) || 0, 0, 'October 31 is not charged again in November');
eq(nov.closingPayPeriods.some(r => r.payday === '2026-10-23' && r.stage1 === 1000), true, 'Nov 5 period is inside November');
eq(oct.closingPayPeriods.some(r => r.payday === '2026-10-23'), false, 'Nov 5 period is outside October');

const seen = new Set();
for (const month of base.months) {
  if (!month.stage1 || month.stage1.status === 'unavailable') continue;
  eq(Math.round((month.stage1.income.amount - month.stage1.bills.amount
    - month.stage1.obligations.amount - month.stage1.householdBudget.amount) * 100) / 100,
  month.stage1.result.amount, month.month + ' stage 1 reconciles');
  eq(Math.round((month.stage1.result.amount - month.stage2.commitments.amount) * 100) / 100,
    month.stage2.result.amount, month.month + ' stage 2 reconciles');
  for (const row of month.closingPayPeriods) {
    eq(seen.has(row.payday), false, 'no double count');
    seen.add(row.payday);
  }
}
const readyCloses = base.payPeriods.filter(p =>
  p.windowKind !== 'horizon-clipped' && p.stage1 && p.stage1.status !== 'unavailable');
eq(seen.size, readyCloses.length, 'every ready closed pay period is in one month');

const early = ask(plan({
  commitments: [{
    id: 'early-buy', label: 'Before close',
    date: '2026-10-05', amount: 500, flexibility: 'required', confidence: 'confirmed',
  }],
}));
const earlyOct = early.months.find(m => m.month === '2026-10');
const earlyLine = earlyOct.stage2.commitments.lines.find(l => l.id === 'early-buy');
eq(earlyLine.shortfall, 500, 'October 5 cannot use the October 8 close');
eq(earlyLine.coveredByClosedSurplus, 0, 'no surplus has closed by October 5');

const later = ask(plan({
  commitments: [{
    id: 'after-close', label: 'After close',
    date: '2026-10-25', amount: 400, flexibility: 'required', confidence: 'confirmed',
  }],
}));
const laterOct = later.months.find(m => m.month === '2026-10');
const laterLine = laterOct.stage2.commitments.lines.find(l => l.id === 'after-close');
eq(laterLine.coveredByClosedSurplus, 400, 'October 25 can use the October 8 and 22 closes');
eq(laterLine.shortfall, 0, 'October 25 is covered without November');
eq(laterOct.stage2.result.amount, 757, '400 leaves 757 of the October closes');

const rich = ask(plan({ startingCash: { amount: 90000 } }));
const poor = ask(plan({ startingCash: { amount: 100 } }));
function stage1(traj, payday) {
  const row = traj.payPeriods.find(p => p.payday === payday);
  return row.stage1.result.amount;
}
eq(stage1(rich, '2026-09-25'), stage1(poor, '2026-09-25'), 'opening cash does not change pay-period surplus');
eq(rich.months.find(m => m.month === '2026-10').stage1.result.amount,
  poor.months.find(m => m.month === '2026-10').stage1.result.amount,
  'opening cash does not change October month surplus');
eq(rich.payPeriods.find(p => p.payday === '2026-09-25').stage1.result.identity,
  'standalone-period-surplus-deficit', 'pay period identity unchanged');
eq(rich.months.find(m => m.month === '2026-10').cash.roadAheadFunding, false, 'cash is not the month result');
eq(rich.months.find(m => m.month === '2026-10').cash.amount
  === poor.months.find(m => m.month === '2026-10').cash.amount, false,
  'opening cash still moves the calendar walk');

const deficitBills = bills.concat([{ date: '2026-12-10', amount: 1500 }]);
const deficit = ask(plan({
  bills: plan().bills.concat([{
    id: 'dec-costs', label: 'December costs', frequency: 'once',
    date: '2026-12-10', amount: 1500, confidence: 'confirmed',
  }]),
}));
const deficitHand = handPeriods(ANCHOR, ANCHOR, deficit.horizon.end).map(row => Object.assign(row, {
  surplus: periodSurplus(row, deficitBills),
}));
const decClose = deficitHand.find(r => r.start <= '2026-12-10' && r.close >= '2026-12-10');
eq(decClose.surplus, -500, 'a closing deficit stays negative');
eq(deficit.months.find(m => m.month === decClose.month).closingPayPeriods
  .some(r => r.payday === decClose.payday && r.stage1 === -500), true,
  'the deficit is kept in its close month');

const budgetBefore = F.budgetBreakdown(plan(), { periods: { ytd: { months: 1, spending: [] } } });
ask(plan());
const budgetAfter = F.budgetBreakdown(plan(), { periods: { ytd: { months: 1, spending: [] } } });
eq(budgetAfter.categories.map(c => [c.id, c.planned]),
  budgetBefore.categories.map(c => [c.id, c.planned]),
  'budget targets are not rewritten');

console.log('Road Ahead month close: ' + checks + ' assertions passed.');
