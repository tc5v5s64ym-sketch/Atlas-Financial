'use strict';
/* Current Balance is posted planning-hub cash only (L-002 / L-006).
 *
 * Independent reconstruction reads Chequing A / BILLS ACCOUNT from the
 * plan rows. Chequing B / WEEKLY SPENDING, Savings, TENNIS INCOME,
 * overdraft, and every other cash-type account stay out.
 * Forecast.postedHouseholdChequingCash remains the walk / spendable
 * opening pool (A+B) and is not this headline.
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

function independentHub(plan) {
  const rows = ((plan.startingCash && plan.startingCash.breakdown) || []);
  const matches = rows.filter(item => item && item.id === 'chequing-a');
  if (matches.length !== 1) return null;
  const value = Number(matches[0].value);
  return Number.isFinite(value) ? roundCent(value) : null;
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

console.log('=== 1. Planning hub is Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentHub(plan);
  ok(near(expected, CHEQUING_A),
    'independent hub cash is Chequing A / BILLS ACCOUNT', String(expected));
  const pub = publishedCurrentBalance(plan);
  ok(near(pub.alloc, expected) && near(pub.view, expected),
    'published Current Balance independently equals hub cash',
    `${pub.alloc} / ${pub.view} vs ${expected}`);
  ok(pub.period && near(pub.period.liveCurrentBalance, expected),
    'active calendar period live Current Balance is the same hub cash');
  ok(!near(pub.alloc, independentChequing(plan)),
    'Current Balance is not pooled Chequing A + Chequing B');
}


console.log('\n=== 2. Savings is excluded from Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentHub(plan);
  const spendable = independentSpendable(plan);
  const pub = publishedCurrentBalance(plan);
  ok(near(spendable, INDEPENDENT_SPENDABLE) && !near(spendable, expected),
    'independent breakdown still includes savings and is not Current Balance');
  ok(near(F.startingCashAmount(plan), independentChequing(plan)),
    'Forecast spendable opening (startingCashAmount) is still chequing-only A+B');
  ok(near(F.startingCashAmount(plan), independentChequing(plan)) && !near(F.startingCashAmount(plan), spendable),
    'designated savings is not ordinary Forecast spendable opening');
  ok(near(pub.alloc, expected) && !near(pub.alloc, spendable),
    'Current Balance is not chequing + savings');
  const html = composer.liveCurrentBalanceHtml(pub.advice.defaultView, null, pub.advice.paydayAllocation);
  ok(html.includes(composer.money2(expected)) && !html.includes(composer.money2(spendable)),
    'homepage Current Balance prints hub cash, not the savings-inclusive pool');
}

console.log('\n=== 3. TENNIS INCOME is excluded from Current Balance ===');
{
  const plan = cashPlan();
  const expected = independentHub(plan);
  const withTennis = roundCent(expected + TENNIS);
  const pub = publishedCurrentBalance(plan);
  ok(!near(pub.alloc, withTennis) && near(pub.alloc, expected),
    'TENNIS INCOME is not added into Current Balance');
  const html = composer.liveCurrentBalanceHtml(pub.advice.defaultView, null, pub.advice.paydayAllocation);
  ok(!html.includes(composer.money2(withTennis)),
    'homepage Current Balance does not print hub + tennis');
}

console.log('\n=== 4. Increasing savings alone does not change Current Balance ===');
{
  const base = cashPlan();
  const before = publishedCurrentBalance(base);
  const bumped = setCash(base, 'savings', SAVINGS + 100);
  const after = publishedCurrentBalance(bumped);
  const expected = independentHub(bumped);
  ok(near(independentSpendable(bumped), independentSpendable(base) + 100),
    'savings +$100 raises the breakdown total by $100');
  ok(near(F.startingCashAmount(bumped), F.startingCashAmount(base)),
    'savings +$100 does not change Forecast spendable opening');
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
  ok(near(independentHub(bumped), independentHub(base)),
    'independent hub cash ignores the tennis-account bump');
  ok(near(after.alloc, before.alloc) && near(after.view, before.view),
    'Current Balance is unchanged when only TENNIS INCOME moves');
}

console.log('\n=== 6. Increasing BILLS changes Current Balance; Weekly does not ===');
{
  const base = cashPlan();
  const before = publishedCurrentBalance(base);
  const billsBumped = setCash(base, 'chequing-a', CHEQUING_A + 85.15);
  const billsAfter = publishedCurrentBalance(billsBumped);
  const billsExpected = independentHub(billsBumped);
  ok(near(billsExpected, roundCent(CHEQUING_A + 85.15)),
    'independent BILLS bump is +$85.15 on Chequing A');
  ok(near(billsAfter.alloc, roundCent(before.alloc + 85.15))
      && near(billsAfter.view, roundCent(before.view + 85.15))
      && near(billsAfter.alloc, billsExpected),
    'Current Balance rises by the same BILLS ACCOUNT amount');

  const weeklyBumped = setCash(base, 'chequing-b', CHEQUING_B + 12.40);
  const weeklyAfter = publishedCurrentBalance(weeklyBumped);
  ok(near(weeklyAfter.alloc, before.alloc)
      && near(weeklyAfter.alloc, independentHub(weeklyBumped))
      && !near(weeklyAfter.alloc, independentChequing(weeklyBumped)),
    'Current Balance does not follow Chequing B / WEEKLY SPENDING');
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
  ok(near(pub.alloc, independentHub(plan)),
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
  const expected = independentHub(plan);
  const pub = publishedCurrentBalance(plan);
  const everyPositive = roundCent(CHEQUING_A + CHEQUING_B + SAVINGS + 205.92 + TENNIS + 74.20);
  ok(near(pub.alloc, expected) && !near(pub.alloc, everyPositive),
    'Current Balance is not an aggregate of every positive cash-type account');
}

console.log('\n=== 10. Authority stays in Forecast; pages do not subtract savings ===');
{
  ok(/function postedBillsAccountCash\(plan\)/.test(forecastSrc),
    'Forecast owns posted planning-hub cash');
  ok(/liveCurrentBalance: liveCurrentBalance != null \? roundCent\(liveCurrentBalance\) : null/.test(forecastSrc)
      && /postedBillsAccountCash\(plan\)/.test(forecastSrc),
    'paydayAllocation publishes hub cash as liveCurrentBalance and fails closed');
  const htmlFn = grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml');
  ok(/view\.liveCurrentBalance|alloc\.liveCurrentBalance/.test(htmlFn)
      && !/startingCashAmount/.test(htmlFn)
      && !/Math\.max\(0,\s*b\)/.test(htmlFn),
    'plan.js reprints Forecast liveCurrentBalance and does not compose A + max(0, B)');
  const household = read('public/household-view.js');
  ok(!/savings/.test(household) || !/Current Balance/.test(household)
      || !/startingCashAmount/.test(household),
    'household-view does not compute Current Balance');
}

console.log('\n=== 11. Weekly surplus or overdraft does not change hub Current Balance ===');
{
  const surplusPlan = setCash(cashPlan(), 'chequing-b', 120.40);
  const surplusExpected = independentHub(surplusPlan);
  const surplusPub = publishedCurrentBalance(surplusPlan);
  ok(near(surplusExpected, CHEQUING_A),
    'independent hub reconstruction ignores positive Weekly');
  ok(near(surplusPub.alloc, surplusExpected) && near(surplusPub.view, surplusExpected),
    'Forecast Current Balance stays hub cash when Chequing B is positive');
  const surplusHtml = composer.liveCurrentBalanceHtml(
    surplusPub.advice.defaultView, null, surplusPub.advice.paydayAllocation
  );
  ok(surplusHtml.includes(composer.money2(surplusExpected)),
    'Budget Current Balance prints the hub figure');

  const overdraftPlan = setCash(cashPlan(), 'chequing-b', -75.10);
  const overdraftExpected = independentHub(overdraftPlan);
  const pooledOverdraft = independentChequing(overdraftPlan);
  const overdraftPub = publishedCurrentBalance(overdraftPlan);
  ok(near(overdraftExpected, CHEQUING_A)
      && !near(overdraftExpected, pooledOverdraft),
    'independent hub reconstruction ignores a negative Weekly register');
  ok(near(overdraftPub.alloc, overdraftExpected) && near(overdraftPub.view, overdraftExpected),
    'Forecast Current Balance does not include a negative Chequing B register');
  const overdraftHtml = composer.liveCurrentBalanceHtml(
    overdraftPub.advice.defaultView, null, overdraftPub.advice.paydayAllocation
  );
  ok(overdraftHtml.includes(composer.money2(overdraftExpected))
      && !overdraftHtml.includes(composer.money2(pooledOverdraft)),
    'Budget Current Balance reprints hub cash and does not print pooled A+B');
}

if (failures) {
  console.log('\nFAILED ' + failures);
  process.exit(1);
}
console.log('\nAll current-balance chequing-cash proofs passed.');
