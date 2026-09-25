'use strict';
// Road Ahead Month keeps calendar-dated income separate from surplus that
// becomes available when a Seaspan pay period closes. Expected income cents
// are summed from expandEvents in this file. They do not call Forecast's
// income-line helper. Expected surplus cents are an integer payday calendar
// in this file. They do not call Forecast's month-funding helper.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast');

const AS_OF = '2026-01-01';
const ANCHOR = '2026-01-02';
const PAY = 1000;
const AMANDA_15 = 2168.85;
const AMANDA_EOM = 2387.99;
const AMANDA_MONTH = 4556.84;
let checks = 0;
function eq(actual, expected, label) {
  assert.deepEqual(actual, expected, label);
  checks++;
}
function cents(n) {
  return Math.round(Number(n) * 100);
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

function plan(extra) {
  return Object.assign({
    windowDays: 70,
    startingCash: { amount: 4000 },
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: AS_OF },
    budget: {
      basis: 'ytd',
      categories: [{
        id: 'groceries', label: 'Groceries', class: 'essential',
        from: ['Groceries'], plannedWeekly: 0,
      }],
    },
    income: [
      {
        id: 'payroll', label: 'Dale — Seaspan',
        frequency: 'biweekly', anchor: ANCHOR, amount: PAY, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda salary — Tennis BC — 15th',
        frequency: 'monthly', day: 15, amount: AMANDA_15, confidence: 'confirmed',
        firstDue: '2026-01-15',
      },
      {
        id: 'amandaSalaryMonthEnd', label: 'Amanda salary — Tennis BC — month end',
        frequency: 'monthly', day: 31, amount: AMANDA_EOM, confidence: 'confirmed',
      },
      {
        id: 'child-benefit', label: 'Child benefit',
        frequency: 'monthly', day: 20, amount: 200, confidence: 'confirmed',
      },
    ],
    obligations: [],
    bills: [],
    commitments: [],
  }, extra || {});
}

function ask(p) {
  return F.baselineTrajectory(p, [], p.opening.asOf, {
    periods: { periods: { ytd: { months: 1, spending: [] } } },
  });
}

function handPeriods(p, from, through) {
  const events = F.expandEvents(p, from, through).filter(event =>
    event && event.kind === 'income' && event.date >= from && event.date <= through);
  const rows = [];
  let payday = ANCHOR;
  while (payday <= through) {
    const next = add(payday, 14);
    const close = add(next, -1);
    if (close >= from && payday <= through && close <= through) {
      const income = events.filter(event => event.date >= payday && event.date <= close)
        .reduce((sum, event) => sum + event.amount, 0);
      rows.push({
        payday,
        close,
        month: close.slice(0, 7),
        surplus: Math.round(income * 100) / 100,
      });
    }
    payday = next;
  }
  return rows;
}

// Dated income in a calendar month, from expandEvents. Not the line helper.
function datedIncome(p, month) {
  const start = month + '-01';
  const end = month === '2026-02' ? '2026-02-28' : month + '-31';
  return F.expandEvents(p, start, end).filter(event =>
    event && event.kind === 'income' && event.date >= start && event.date <= end
    && event.date.slice(0, 7) === month);
}

const basePlan = plan();
const budgetBefore = F.budgetBreakdown(basePlan, { periods: { ytd: { months: 1, spending: [] } } });
const traj = ask(basePlan);
assert.equal(traj.status, 'ready');
const budgetAfter = F.budgetBreakdown(basePlan, { periods: { ytd: { months: 1, spending: [] } } });
eq(budgetAfter.categories.map(c => [c.id, c.planned]),
  budgetBefore.categories.map(c => [c.id, c.planned]),
  'budget targets are not rewritten');

const janEvents = datedIncome(basePlan, '2026-01');
const amandaEvents = janEvents.filter(event => /tennis bc/i.test(event.label || ''));
eq(amandaEvents.map(event => event.date).sort(), ['2026-01-15', '2026-01-31'],
  'both January Tennis BC deposits keep their dates');
eq(cents(amandaEvents.reduce((sum, event) => sum + event.amount, 0)), cents(AMANDA_MONTH),
  'independent January Amanda sum is both deposits');
const janIncomeHand = cents(janEvents.reduce((sum, event) => sum + event.amount, 0));
const jan = traj.months.find(month => month.month === '2026-01');
const feb = traj.months.find(month => month.month === '2026-02');
eq(jan.income.identity, 'calendar-dated-income', 'January income is calendar-dated');
eq(cents(jan.income.amount), janIncomeHand, 'published January income matches dated events');
const amandaLine = (jan.income.lines || []).find(row => /Tennis BC/.test(row.label));
eq(cents(amandaLine.amount), cents(AMANDA_MONTH), 'Amanda line is both January deposits');
const lineSum = cents((jan.income.lines || []).reduce((sum, row) => sum + row.amount, 0));
eq(lineSum, cents(jan.income.amount), 'named calendar lines sum to published income');
eq(janEvents.some(event => event.date === '2026-01-31'), true,
  'month-end salary is a January cash date');
eq(datedIncome(basePlan, '2026-02').some(event => event.date === '2026-01-31'), false,
  'month-end salary is not a February cash date');

const hand = handPeriods(basePlan, AS_OF, traj.horizon.end);
const janClose = hand.filter(row => row.month === '2026-01');
const febClose = hand.filter(row => row.month === '2026-02');
eq(janClose.some(row => row.payday === '2026-01-30'), false,
  'Jan 30 period does not close in January');
eq(febClose.some(row => row.payday === '2026-01-30'), true,
  'Jan 30 period closes in February');
const janSurplus = janClose.reduce((sum, row) => sum + row.surplus, 0);
eq(cents(jan.stage1.result.amount), cents(janSurplus),
  'January available surplus is only January closes');
const publishedCloseSum = cents((jan.closingPayPeriods || []).reduce((sum, row) => sum + row.stage1, 0));
eq(publishedCloseSum, cents(jan.stage1.result.amount),
  'contributing pay-period rows sum to available surplus');
eq(jan.closingPayPeriods.every(row => row.displayRange), true,
  'each contributing period publishes a display range');
eq(cents(jan.income.amount) === cents(jan.stage1.result.amount), false,
  'calendar income is not required to equal available surplus');
eq(feb.closingPayPeriods.some(row => row.payday === '2026-01-30'), true,
  'February receives the period that contains the January month-end salary');
eq((feb.income.lines || []).some(row => row.date === '2026-01-31'), false,
  'February calendar income does not take the January month-end deposit');

const early = ask(plan({
  commitments: [{
    id: 'jan-buy', label: 'January purchase',
    date: '2026-01-31', amount: janSurplus + 100, flexibility: 'required', confidence: 'confirmed',
  }],
}));
const earlyJan = early.months.find(month => month.month === '2026-01');
const earlyLine = earlyJan.stage2.commitments.lines.find(row => row.id === 'jan-buy');
eq(earlyLine.shortfall, 100, 'January 31 cannot use the February close');
eq(cents(earlyJan.stage2.result.amount), cents(-100),
  'January after planned spending stays short without the later close');
const febPeriodHand = hand.find(row => row.payday === '2026-01-30');
eq(early.payPeriods.find(row => row.payday === '2026-01-30').stage1.result.amount, febPeriodHand.surplus,
  'the February-closing period still has its own surplus');

const rich = ask(plan({ startingCash: { amount: 90000 } }));
const poor = ask(plan({ startingCash: { amount: 100 } }));
eq(rich.months.find(month => month.month === '2026-01').stage1.result.amount,
  poor.months.find(month => month.month === '2026-01').stage1.result.amount,
  'opening cash does not change January available surplus');
eq(rich.months.find(month => month.month === '2026-01').cash.amount
  === poor.months.find(month => month.month === '2026-01').cash.amount, false,
  'opening cash still moves the calendar cash walk');
eq(rich.months.find(month => month.month === '2026-01').cash.roadAheadFunding, false,
  'cash is not the month funding result');
eq(rich.payPeriods.map(row => row.stage3.result.amount),
  poor.payPeriods.map(row => row.stage3.result.amount),
  'opening cash does not change pay-period results');

const positive = ask(plan());
const positiveJan = positive.months.find(month => month.month === '2026-01');
eq(positiveJan.stage2.result.amount > 0, true, 'fixture January result is positive');

const negative = earlyJan;
eq(negative.stage2.result.amount < 0, true, 'fixture January result can be negative');

function loadPage() {
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
  const grab = re => {
    const match = re.exec(appSrc);
    if (!match) throw new Error('missing ' + re);
    return match[0];
  };
  const helpers = [
    grab(/^const money = .*$/m), grab(/^const money2 = .*$/m), grab(/^const pct = .*$/m),
    grab(/^const fmtDate = .*$/m), grab(/^const fmtDateLong = .*$/m), grab(/^const fmtDateFull = .*$/m),
  ].join('\n');
  const ctx = { Forecast: F, console, App: { hooks: [], register() {}, boot() {} }, $() { return { innerHTML: '', textContent: '' }; } };
  vm.runInNewContext(`${helpers}\n${fs.readFileSync(path.join(__dirname, '..', 'public/planning.js'), 'utf8')}`, ctx, { filename: 'public/planning.js' });
  return ctx;
}

const page = loadPage();
const monthHtml = page.planningRoadAheadHtml(positive, 'month', '2026-01', AS_OF);
const monthView = monthHtml.lead + monthHtml.stages;
eq(/Income received this month/.test(monthView), true, 'month view names calendar income');
eq(/Available surplus this month/.test(monthView), true, 'month view names available surplus');
eq(/Surplus after deductions/.test(monthView), true, 'positive month result is Surplus after deductions');
eq(/Shortfall after deductions/.test(monthView), false, 'positive month result is not labeled Shortfall');
eq(/planning-road-lead-neutral/.test(monthHtml.lead), true, 'month card surface stays neutral');
eq(/planning-road-lead-gap|planning-road-lead-surplus/.test(monthHtml.lead), false,
  'month card is not tinted by the downstream result');
eq(monthView.includes('Jan 2–Jan 15') || monthView.includes('Jan 2–15'), true,
  'January reprints a Forecast display range');

const gapHtml = page.planningRoadAheadHtml(early, 'month', '2026-01', AS_OF);
const gapView = gapHtml.lead + gapHtml.stages;
eq(/Shortfall after deductions/.test(gapView), true, 'negative month result is Shortfall after deductions');
eq(/Surplus after deductions/.test(gapView), false, 'negative month result is not labeled Surplus');
eq(/planning-road-lead-neutral/.test(gapHtml.lead), true, 'shortfall month card stays neutral');
eq(/planning-road-decision-surplus/.test(gapHtml.lead), true,
  'the positive available-surplus step keeps its own sign');
eq(/planning-road-decision-gap/.test(gapHtml.lead), true,
  'the shortfall step keeps its own sign');

const pay = positive.payPeriods.find(row => row.payday === '2026-01-02');
const payHtml = page.planningRoadAheadWaterfallHtml(pay, 'pay-period');
eq(/data-planning-road-wf="bills"/.test(payHtml), true, 'pay period waterfall still shows bills');
eq(/Income received this month/.test(payHtml), false, 'pay period waterfall does not use the month income heading');
eq(pay.stage1.result.identity, 'standalone-period-surplus-deficit', 'pay period identity unchanged');
eq(pay.income && pay.income.identity, undefined, 'pay period income is not relabeled as calendar-month income');

console.log('Road Ahead month income: ' + checks + ' assertions passed.');
