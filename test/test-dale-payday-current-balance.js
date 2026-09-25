'use strict';
/* Dale/Seaspan payday Current Balance.
 *
 * From 00:00 America/Vancouver on a scheduled Dale payday, Current Balance
 * is the pre-payday canonical chequing-a balance plus that planned payroll
 * until representedEvents prove the deposit. The numerical oracle adds
 * those cents itself. It does not call the production Current Balance helper.
 *
 * `node test/test-dale-payday-current-balance.js`
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
const cents = n => Math.round(Number(n) * 100);
const fromCents = c => c / 100;
const oracle = (pre, payroll) => fromCents(cents(pre) + cents(payroll));
const clone = x => JSON.parse(JSON.stringify(x));
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const PAYDAY = '2026-09-25';
const BEFORE = '2026-09-24';
const NEXT = '2026-10-09';
const PRE = 166.42;
const PAY = 4264;
const NEG = -500;
const WEEKLY = 880.15;
const SAVINGS = 2400;

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
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ liveCurrentBalanceHtml, money2 });`,
    { Forecast: F }
  );
}

function plan(opts) {
  opts = opts || {};
  const bills = opts.bills != null ? opts.bills : PRE;
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [
        { id: 'chequing-a', value: bills, label: 'BILLS ACCOUNT', class: 'spendable' },
        { id: 'chequing-b', value: opts.weekly != null ? opts.weekly : WEEKLY, label: 'WEEKLY SPENDING', class: 'spendable' },
        { id: 'savings', value: opts.savings != null ? opts.savings : SAVINGS, label: 'EMERGENCY SAVING', class: 'spendable' },
      ],
    },
    opening: {
      asOf: opts.asOf || BEFORE,
      priorAsOf: opts.priorAsOf || null,
      representedEvents: opts.represented || [],
      notReliedUponEvents: opts.notRelied || [],
    },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan',
        frequency: 'biweekly', anchor: '2026-09-11', amount: PAY, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda Tennis BC 15th',
        frequency: 'monthly', day: 15, amount: 2100, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Child benefit',
        frequency: 'monthly', day: 20, amount: 647.5, confidence: 'confirmed',
      },
      {
        id: 'other-income:refund', label: 'Other income refund',
        frequency: 'once', date: '2026-09-25', amount: 40, confidence: 'estimated',
        incomeClass: 'other',
      },
    ],
    bills: [],
    obligations: [],
    commitments: [],
    budget: { categories: [] },
  };
}

function recommend(p, asOf, extra) {
  return F.recommend(p, asOf, Object.assign({ debts: [], targetBuffer: 500 }, extra || {}));
}

function published(advice) {
  const alloc = advice && advice.paydayAllocation;
  const view = advice && advice.defaultView;
  const period = ((view && view.calendarPeriods) || []).find(row => row && row.role === 'active');
  return {
    alloc: alloc && alloc.liveCurrentBalance,
    view: view && view.liveCurrentBalance,
    period: period && period.liveCurrentBalance,
    publication: (alloc && alloc.currentBalancePublication)
      || (view && view.currentBalancePublication),
    income: (period && period.income) || [],
  };
}

function daleRows(pub) {
  return pub.income.filter(row => row && row.id === 'payroll');
}

function vancouverDate(instant) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const year = parts.find(p => p.type === 'year').value;
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  return `${year}-${month}-${day}`;
}

const composer = loadComposer();
const planSrc = read('public/plan.js');
const forecastSrc = read('public/forecast.js');

console.log('=== 1. Identity stays canonical chequing-a ===');
{
  const p = plan();
  const pub = published(recommend(p, PAYDAY));
  ok(pub.publication && pub.publication.accountId === 'chequing-a',
    'publication account is chequing-a');
  ok(near(pub.alloc, oracle(PRE, PAY)) && !near(pub.alloc, PRE + WEEKLY + PAY),
    'Weekly Spending is not in the assumed Current Balance');
  ok(!near(pub.alloc, PRE + SAVINGS + PAY),
    'savings is not in the assumed Current Balance');
}

console.log('\n=== 2. One second before payday: no salary assumption ===');
{
  const beforeInstant = '2026-09-25T06:59:59.000Z';
  const atInstant = '2026-09-25T07:00:00.000Z';
  const independentBefore = vancouverDate(beforeInstant);
  const independentAt = vancouverDate(atInstant);
  ok(independentBefore === BEFORE && independentAt === PAYDAY,
    'independent Vancouver reconstruction names the midnight boundary',
    `${independentBefore} / ${independentAt}`);
  ok(F.financialDate(beforeInstant) === independentBefore
      && F.financialDate(atInstant) === independentAt,
    'Forecast.financialDate matches that independent boundary');
  const early = published(recommend(plan(), F.financialDate(beforeInstant)));
  ok(near(early.alloc, PRE) && early.publication.status === 'provider-confirmed'
      && early.publication.assumedDalePayroll == null && !early.publication.note,
    'D−1 23:59:59 Vancouver publishes posted BILLS cash only');
}

console.log('\n=== 3. Vancouver midnight includes planned Dale salary once ===');
{
  const expected = oracle(PRE, PAY);
  const p = plan();
  const beforeJson = JSON.stringify(p);
  const first = published(recommend(p, F.financialDate('2026-09-25T07:00:00.000Z')));
  const second = published(recommend(p, PAYDAY));
  ok(near(expected, 4430.42), 'oracle cents are the owner positive example');
  ok(near(first.alloc, expected) && near(first.view, expected) && near(first.period, expected),
    'midnight Current Balance is pre-pay BILLS plus planned payroll',
    String(first.alloc));
  ok(near(second.alloc, first.alloc) && near(second.view, first.view),
    'a second Forecast.recommend does not accumulate salary');
  ok(JSON.stringify(p) === beforeJson, 'recommend does not mutate the plan');
  ok(daleRows(first).length === 1 && near(daleRows(first)[0].amount, PAY),
    'Dale salary remains one Income row');
  ok(first.publication.status === 'planned-dale-payday'
      && first.publication.providerConfirmed === false
      && near(first.publication.assumedDalePayroll, PAY)
      && first.publication.note === 'Includes planned Dale payday +$4,264.00 awaiting bank update',
    'assumption is labelled planned and awaiting the bank update');
  const html = composer.liveCurrentBalanceHtml(
    first.publication && { liveCurrentBalance: first.view, currentBalancePublication: first.publication },
    null,
    { liveCurrentBalance: first.alloc, currentBalancePublication: first.publication }
  );
  ok(html.includes(composer.money2(expected)) && html.includes(first.publication.note)
      && !/synthetic|overlay/i.test(html),
    'page reprints Forecast amount and note');
}

console.log('\n=== 4. Negative pre-pay balance ===');
{
  const expected = oracle(NEG, PAY);
  ok(near(expected, 3764), 'oracle cents are the owner negative example');
  const pub = published(recommend(plan({ bills: NEG }), PAYDAY));
  ok(near(pub.alloc, expected) && near(pub.publication.prePaydayBills, NEG),
    'negative pre-pay BILLS plus planned payroll', String(pub.alloc));
}

console.log('\n=== 5. Post-payday refresh does not add payroll again ===');
{
  const landed = oracle(PRE, PAY);
  const doubled = oracle(landed, PAY);
  ok(near(landed, 4430.42) && near(doubled, 8694.42),
    'independent oracle names the landed balance and the double-count');
  const refreshed = plan({
    asOf: PAYDAY,
    priorAsOf: BEFORE,
    bills: landed,
    notRelied: [{ id: 'payroll', date: PAYDAY, reason: 'same-day-inbound-unproven' }],
  });
  const pub = published(recommend(refreshed, PAYDAY));
  ok(pub.alloc == null && pub.view == null && pub.period == null
      && pub.publication.status === 'unavailable',
    'a same-day BILLS refresh is not a proven pre-payday base', String(pub.alloc));
  ok(!near(pub.alloc, doubled) && !near(pub.view, doubled) && !near(pub.period, doubled)
      && !near(pub.alloc, oracle(4427.10, PAY)),
    'representation lag does not add planned payroll onto the refreshed balance');
  const html = composer.liveCurrentBalanceHtml(
    pub.publication && { liveCurrentBalance: pub.view, currentBalancePublication: pub.publication },
    null,
    { liveCurrentBalance: pub.alloc, currentBalancePublication: pub.publication }
  );
  ok(html.includes('—') && !html.includes(composer.money2(doubled))
      && !html.includes(composer.money2(landed)) && !/awaiting bank update/.test(html),
    'the page does not print the refreshed balance plus planned payroll');
  const actual = published(recommend(plan({
    asOf: PAYDAY,
    priorAsOf: BEFORE,
    bills: 4427.10,
  }), PAYDAY));
  ok(actual.alloc == null && actual.view == null
      && !near(actual.alloc, oracle(4427.10, PAY))
      && !near(actual.view, oracle(4427.10, PAY)),
    'an actual deposited balance without representation is not increased by the plan');
}

console.log('\n=== 6. Provider confirmation replaces the assumption ===');
{
  const observed = 4427.10;
  const proved = plan({
    asOf: PAYDAY,
    priorAsOf: BEFORE,
    bills: observed,
    represented: [{ id: 'payroll', date: PAYDAY }],
  });
  const pub = published(recommend(proved, PAYDAY));
  ok(near(pub.alloc, observed) && pub.publication.status === 'provider-confirmed'
      && pub.publication.assumedDalePayroll == null && !pub.publication.note,
    'observed BILLS cash wins and the pending note is gone', String(pub.alloc));
  ok(!near(pub.alloc, oracle(PRE, PAY)) && !near(pub.alloc, oracle(observed, PAY)),
    'planned payroll is not retained and not added again');
  ok(daleRows(pub).length === 1, 'Income still shows Dale salary once');
}

console.log('\n=== 7. Already represented on first payday load ===');
{
  const observed = 4430.42;
  const pub = published(recommend(plan({
    asOf: PAYDAY,
    bills: observed,
    represented: [{ id: 'payroll', date: PAYDAY }],
  }), PAYDAY));
  ok(near(pub.alloc, observed) && pub.publication.providerConfirmed === true,
    'represented payroll is not given a temporary assumption');
}

console.log('\n=== 8. Next day does not replay yesterday ===');
{
  const observed = 4400;
  const pub = published(recommend(plan({
    asOf: PAYDAY,
    bills: observed,
    notRelied: [{ id: 'payroll', date: PAYDAY, reason: 'same-day-inbound-unproven' }],
  }), '2026-09-26'));
  ok(near(pub.alloc, observed) && pub.publication.assumedDalePayroll == null,
    'the day after payday publishes observed BILLS cash only', String(pub.alloc));
}

console.log('\n=== 9. Next payday uses only that occurrence ===');
{
  const nextPre = 90.5;
  const expected = oracle(nextPre, PAY);
  const pub = published(recommend(plan({ asOf: '2026-10-08', bills: nextPre }), NEXT));
  ok(F.spendingCycle(plan(), NEXT).start === NEXT, 'Oct 9 is the next Seaspan payday');
  ok(near(pub.alloc, expected) && near(pub.publication.assumedDalePayroll, PAY)
      && !near(pub.alloc, oracle(oracle(nextPre, PAY), PAY)),
    'the next payday adds only that occurrence', String(pub.alloc));
}

console.log('\n=== 10. Amanda, child benefit, and Other Income are not pre-posted ===');
{
  const amanda = published(recommend(plan({ asOf: '2026-09-14', bills: PRE }), '2026-09-15'));
  const child = published(recommend(plan({ asOf: '2026-09-19', bills: PRE }), '2026-09-20'));
  ok(near(amanda.alloc, PRE) && amanda.publication.assumedDalePayroll == null,
    'Amanda salary day does not change Current Balance');
  ok(near(child.alloc, PRE) && child.publication.assumedDalePayroll == null,
    'child-benefit day does not change Current Balance');
  const onPayday = published(recommend(plan(), PAYDAY));
  ok(near(onPayday.alloc, oracle(PRE, PAY)) && !near(onPayday.alloc, oracle(PRE, PAY + 40)),
    'same-day Other Income is not added to the Dale assumption');
}

console.log('\n=== 11. Page does not add, and Forecast does not write canonical state ===');
{
  const htmlFn = grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml');
  ok(/currentBalancePublication/.test(htmlFn)
      && !/assumedDalePayroll\s*\+/.test(htmlFn)
      && !/prePayday/.test(htmlFn),
    'plan.js reprints the Forecast publication and does not add payroll');
  ok(/function householdCurrentBalance\(/.test(forecastSrc)
      && !/startingCash\.breakdown[\s\S]{0,80}value\s*=/.test(
        grab(forecastSrc, /function householdCurrentBalance\([\s\S]*?\n  function paydayAllocation\(/, 'household')
      ),
    'the assumption is computed in Forecast and does not assign canonical cash');
}

console.log('\n=== 12. Missing hub evidence fails closed ===');
{
  const p = plan();
  p.startingCash.breakdown = p.startingCash.breakdown.filter(row => row.id !== 'chequing-a');
  const pub = published(recommend(p, PAYDAY));
  ok(pub.alloc == null && pub.publication.status === 'unavailable',
    'no chequing-a row does not become $0 or planned payroll alone');
}

if (failures) {
  console.log('\nFAILED ' + failures);
  process.exit(1);
}
console.log('\nAll Dale payday Current Balance proofs passed.');
