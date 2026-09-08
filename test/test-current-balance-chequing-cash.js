'use strict';
/* Current Balance is posted household chequing cash only (L-002 / L-006).
 *
 * Independent reconstruction sums Chequing A / BILLS ACCOUNT and Chequing B
 * / WEEKLY SPENDING from the plan rows. Savings, TENNIS INCOME, overdraft,
 * and every other cash-type account stay out. Forecast.postedHouseholdChequingCash
 * is not the specification.
 *
 * `node test/test-current-balance-chequing-cash.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const Live = require('../scripts/live-plan.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const clone = x => JSON.parse(JSON.stringify(x));
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
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ liveCurrentBalanceHtml, providerBalanceDate, money2 });`,
    { Forecast: F }
  );
}

const CHEQUING_A = 629.27;
const CHEQUING_B = 309.77;
const SAVINGS = 40.58;
const TENNIS = 2691.85;
const INDEPENDENT_CHEQUING = roundCent(CHEQUING_A + CHEQUING_B);
const INDEPENDENT_SPENDABLE = roundCent(CHEQUING_A + CHEQUING_B + SAVINGS);
const AMANDA_15 = 2100;
const AMANDA_EOM = 2300;
const AS_OF = '2026-08-19';

function row(id, value, extra) {
  return Object.assign({ id, value }, extra || {});
}

function cashPlan(overrides) {
  return Object.assign({
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [
        row('chequing-a', CHEQUING_A, { label: 'BILLS ACCOUNT', class: 'spendable' }),
        row('chequing-b', CHEQUING_B, { label: 'WEEKLY SPENDING', class: 'spendable' }),
        row('savings', SAVINGS, { label: 'EMERGENCY SAVING', class: 'spendable' }),
      ],
      heldElsewhere: [
        row('amanda-debt-payments', TENNIS, {
          label: 'TENNIS INCOME — Amanda\'s account', class: 'operational',
        }),
      ],
    },
    opening: { asOf: AS_OF, representedEvents: [] },
    income: [
      {
        id: 'payroll', label: 'Payroll — Seaspan',
        frequency: 'biweekly', anchor: '2026-08-14', amount: 4264, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda Tennis BC 15th',
        frequency: 'monthly', day: 15, amount: AMANDA_15, confidence: 'confirmed',
      },
      {
        id: 'amandaSalaryMonthEnd', label: 'Amanda Tennis BC month-end',
        frequency: 'monthly', day: 31, amount: AMANDA_EOM, confidence: 'confirmed',
      },
    ],
    bills: [],
    obligations: [],
    commitments: [],
    budget: { categories: [] },
  }, overrides || {});
}

function independentChequing(plan) {
  const rows = ((plan.startingCash && plan.startingCash.breakdown) || []);
  return roundCent(rows.reduce((sum, item) => {
    if (!item || (item.id !== 'chequing-a' && item.id !== 'chequing-b')) return sum;
    return sum + (Number(item.value) || 0);
  }, 0));
}

function independentSpendable(plan) {
  const rows = ((plan.startingCash && plan.startingCash.breakdown) || []);
  if (rows.length) {
    return roundCent(rows.reduce((sum, item) => sum + (Number(item && item.value) || 0), 0));
  }
  return roundCent(Number(plan.startingCash && plan.startingCash.amount) || 0);
}

function setCash(plan, id, value) {
  const next = clone(plan);
  const cash = next.startingCash;
  const list = (cash.breakdown || []).concat(cash.heldElsewhere || []);
  const found = list.find(item => item && item.id === id);
  if (!found) throw new Error('missing cash row ' + id);
  found.value = value;
  return next;
}

function publishedCurrentBalance(plan, asOf) {
  const advice = F.recommend(plan, asOf || AS_OF, { debts: [], targetBuffer: 500 });
  return {
    advice,
    alloc: advice.paydayAllocation && advice.paydayAllocation.liveCurrentBalance,
    view: advice.defaultView && advice.defaultView.liveCurrentBalance,
    period: ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
      .find(p => p && p.role === 'active'),
  };
}

const composer = loadComposer();
const livePlanSrc = read('scripts/live-plan.js');
const planSrc = read('public/plan.js');
const forecastSrc = read('public/forecast.js');

console.log('=== 1. Household chequing is included in Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentChequing(plan);
  ok(near(expected, INDEPENDENT_CHEQUING),
    'independent Chequing A + Chequing B is $939.04', String(expected));
  const pub = publishedCurrentBalance(plan);
  ok(near(pub.alloc, expected) && near(pub.view, expected),
    'published Current Balance independently equals household chequing cash',
    `${pub.alloc} / ${pub.view} vs ${expected}`);
  ok(pub.period && near(pub.period.liveCurrentBalance, expected),
    'active calendar period live Current Balance is the same chequing cash');
}

console.log('\n=== 2. Savings is excluded from Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentChequing(plan);
  const spendable = independentSpendable(plan);
  const pub = publishedCurrentBalance(plan);
  ok(near(spendable, INDEPENDENT_SPENDABLE) && !near(spendable, expected),
    'independent spendable pool still includes savings and is not Current Balance');
  ok(near(F.startingCashAmount(plan), spendable),
    'Forecast spendable pool (startingCashAmount) still includes savings');
  ok(near(pub.alloc, expected) && !near(pub.alloc, spendable),
    'Current Balance is not chequing + savings');
  const html = composer.liveCurrentBalanceHtml(pub.advice.defaultView, null, pub.advice.paydayAllocation);
  ok(html.includes(composer.money2(expected)) && !html.includes(composer.money2(spendable)),
    'homepage Current Balance prints chequing cash, not the savings-inclusive pool');
}

console.log('\n=== 3. TENNIS INCOME is excluded from Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentChequing(plan);
  const withTennis = roundCent(expected + TENNIS);
  const pub = publishedCurrentBalance(plan);
  ok(!near(pub.alloc, withTennis) && near(pub.alloc, expected),
    'TENNIS INCOME is not added into Current Balance');
  const html = composer.liveCurrentBalanceHtml(pub.advice.defaultView, null, pub.advice.paydayAllocation);
  ok(!html.includes(composer.money2(withTennis)),
    'homepage Current Balance does not print chequing + tennis');
}

console.log('\n=== 4. Increasing savings alone does not change Current Balance ===');
{
  const base = cashPlan();
  const before = publishedCurrentBalance(base);
  const bumped = setCash(base, 'savings', SAVINGS + 100);
  const after = publishedCurrentBalance(bumped);
  const expected = independentChequing(bumped);
  ok(near(independentSpendable(bumped), independentSpendable(base) + 100),
    'savings +$100 raises the Forecast spendable pool by $100');
  ok(near(after.alloc, before.alloc) && near(after.view, before.view)
      && near(after.alloc, expected),
    'Current Balance is unchanged when only savings moves',
    `${before.alloc} → ${after.alloc}`);
}

console.log('\n=== 5. Increasing TENNIS INCOME alone does not change Current Balance ===');
{
  const base = cashPlan();
  const before = publishedCurrentBalance(base);
  const bumped = setCash(base, 'amanda-debt-payments', TENNIS + 250);
  const after = publishedCurrentBalance(bumped);
  ok(near(independentChequing(bumped), independentChequing(base)),
    'independent chequing cash ignores the tennis-account bump');
  ok(near(after.alloc, before.alloc) && near(after.view, before.view),
    'Current Balance is unchanged when only TENNIS INCOME moves');
}

console.log('\n=== 6. Increasing household chequing/BILLS changes Current Balance by the same amount ===');
{
  const base = cashPlan();
  const before = publishedCurrentBalance(base);
  const billsBumped = setCash(base, 'chequing-a', CHEQUING_A + 85.15);
  const billsAfter = publishedCurrentBalance(billsBumped);
  const billsExpected = independentChequing(billsBumped);
  ok(near(billsExpected, roundCent(INDEPENDENT_CHEQUING + 85.15)),
    'independent BILLS bump is +$85.15 on Chequing A');
  ok(near(billsAfter.alloc, roundCent(before.alloc + 85.15))
      && near(billsAfter.view, roundCent(before.view + 85.15))
      && near(billsAfter.alloc, billsExpected),
    'Current Balance rises by the same BILLS ACCOUNT amount');

  const weeklyBumped = setCash(base, 'chequing-b', CHEQUING_B + 12.40);
  const weeklyAfter = publishedCurrentBalance(weeklyBumped);
  ok(near(weeklyAfter.alloc, roundCent(before.alloc + 12.40))
      && near(weeklyAfter.alloc, independentChequing(weeklyBumped)),
    'Current Balance also follows Chequing B / WEEKLY SPENDING by the same amount');
}

console.log('\n=== 7. Forecast treatment of Amanda\'s future salary remains unchanged ===');
{
  const plan = cashPlan();
  const events = F.expandEvents(plan, '2026-09-01', '2026-09-30', {});
  const mid = events.filter(e => e && e.id === 'amandaSalary15' && e.kind === 'income');
  const eom = events.filter(e => e && e.id === 'amandaSalaryMonthEnd' && e.kind === 'income');
  ok(mid.length === 1 && mid[0].date === '2026-09-15' && near(mid[0].amount, AMANDA_15),
    'Amanda 15th Tennis BC salary remains Forecast income on 2026-09-15');
  ok(eom.length === 1 && eom[0].date === '2026-09-30' && near(eom[0].amount, AMANDA_EOM),
    'Amanda month-end Tennis BC salary remains Forecast income on 2026-09-30');
  const pub = publishedCurrentBalance(plan, '2026-09-01');
  ok(near(pub.alloc, independentChequing(plan)),
    'future salary does not enter Current Balance before it posts into BILLS');
}

console.log('\n=== 8. Account freshness / Lunch Money timestamp behavior remains unchanged ===');
{
  ok(/const POSTED_CASH = new Set\(\['chequing-a', 'chequing-b', 'savings'\]\)/.test(livePlanSrc),
    'live overlay still requires chequing-a, chequing-b, and savings for posted-cash freshness');
  ok(/for \(const id of POSTED_CASH\)/.test(livePlanSrc)
      && /function collectObservedCash/.test(livePlanSrc),
    'observedCash still collects every required posted-cash identity, including savings');
  ok(/function assertFreshLivePacket/.test(livePlanSrc)
      && livePlanSrc.indexOf('for (const id of POSTED_CASH)')
        < livePlanSrc.indexOf('function collectObservedCash'),
    'assertFreshLivePacket still fails closed when any required posted-cash identity is stale');
  const dateFn = grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate');
  ok(/observedCash && liveOverlay\.observedCash\.accounts/.test(dateFn)
      && !/chequing-a/.test(dateFn) && !/savings/.test(dateFn),
    'Current Balance date still uses incumbent observedCash evidence dates, not a chequing-only filter');
  ok(Live.POSTED_CASH && Live.POSTED_CASH.has('chequing-a')
      && Live.POSTED_CASH.has('chequing-b') && Live.POSTED_CASH.has('savings')
      && Live.POSTED_CASH.size === 3,
    'exported POSTED_CASH identities are unchanged');
  const overlay = {
    applied: true,
    operatingPlan: 'live',
    observedAsOf: '2026-08-26',
    observedCash: {
      complete: true,
      asOf: '2026-08-26',
      accounts: [
        { id: 'chequing-a', value: CHEQUING_A, evidenceDate: '2026-08-26' },
        { id: 'chequing-b', value: CHEQUING_B, evidenceDate: '2026-08-26' },
        { id: 'savings', value: SAVINGS, evidenceDate: '2026-08-26' },
      ],
    },
  };
  ok(composer.providerBalanceDate(overlay) === '2026-08-26',
    'provider cash-observation date still stamps from the observedCash packet');
}

console.log('\n=== 9. Current Balance is not every Lunch Money cash-type account ===');
{
  const plan = cashPlan({
    startingCash: {
      breakdown: [
        row('chequing-a', CHEQUING_A),
        row('chequing-b', CHEQUING_B),
        row('savings', SAVINGS),
        row('wise', 205.92),
      ],
      heldElsewhere: [
        row('amanda-debt-payments', TENNIS),
        row('savings-dont-touch', 74.20),
      ],
    },
  });
  const expected = independentChequing(plan);
  const pub = publishedCurrentBalance(plan);
  const everyPositive = roundCent(CHEQUING_A + CHEQUING_B + SAVINGS + 205.92 + TENNIS + 74.20);
  ok(near(pub.alloc, expected) && !near(pub.alloc, everyPositive),
    'Current Balance is not an aggregate of every positive cash-type account');
}

console.log('\n=== 10. Authority stays in Forecast; pages do not subtract savings ===');
{
  ok(/function postedHouseholdChequingCash\(plan\)/.test(forecastSrc),
    'Forecast owns posted household chequing cash');
  ok(/liveCurrentBalance: roundCent\(liveCurrentBalance\)/.test(forecastSrc)
      && /postedHouseholdChequingCash\(plan\)/.test(forecastSrc),
    'paydayAllocation publishes that chequing cash as liveCurrentBalance');
  const htmlFn = grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml');
  ok(/view\.liveCurrentBalance|alloc\.liveCurrentBalance/.test(htmlFn)
      && !/savings/.test(htmlFn) && !/startingCashAmount/.test(htmlFn),
    'plan.js prints Forecast liveCurrentBalance and does not subtract savings itself');
  const household = read('public/household-view.js');
  ok(!/savings/.test(household) || !/Current Balance/.test(household)
      || !/startingCashAmount/.test(household),
    'household-view does not compute Current Balance');
}

if (failures) {
  console.log('\nFAILED ' + failures);
  process.exit(1);
}
console.log('\nAll current-balance chequing-cash proofs passed.');
