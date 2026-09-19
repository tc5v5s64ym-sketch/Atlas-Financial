'use strict';
/* Prepare Ahead is paydayAllocation.protectedPath — independent proof.
 *
 * Owner 2026-09-18/19: of leftover current cash after obligations and
 * essentials, how much must stay in chequing (not spent, not extra debt)
 * because the already-modelled future walk needs it. That amount is the
 * leftover that cannot be removed today while the master Forecast still
 * holds. It is not remaining ACR ÷ paydays, not a transfer into designated
 * Savings, and not additionalCashRequired.
 *
 * Independent of Forecast.paydayAllocation: reconstruct the largest same-day
 * removal that still leaves the walk feasible, then leftover minus that
 * removal. Live household cents are not the specification (L-006).
 *
 * `node test/test-prepare-ahead.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const EPS = 0.005;
const AS_OF = '2026-09-01';
const CARD = [{ id: 'card', label: 'Card', balance: 8000, rate: 19.99, limit: 10000, secured: false }];

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function periodsStub() {
  return { periods: { ytd: { label: 'stub', months: 1, spending: [] } } };
}

function allocOpts(extra) {
  return Object.assign({
    // High floor so fixture income is not a payday and the current period
    // is as-of only. Later bills stay on the walk / protectedPath, not
    // this-period obligations.
    paydayFloor: 10000,
    targetBuffer: 0,
    weeklyVariable: 0,
    debts: CARD,
    extraFacilities: [],
    extraDebtMonthly: 0,
  }, extra || {});
}

function cashPlan(chequing, savings, extra) {
  return Object.assign({
    windowDays: 200,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    startingCash: {
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: chequing, class: 'spendable' },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: 0, class: 'spendable' },
        { id: 'savings', label: 'EMERGENCY SAVING', value: savings, class: 'spendable' },
      ],
    },
    opening: { asOf: AS_OF },
    budget: { basis: 'ytd', categories: [] },
    income: [],
    bills: [],
    obligations: [],
    commitments: [],
  }, extra || {});
}

function onceBill(id, date, amount) {
  return { id, label: id, frequency: 'once', date, amount, confidence: 'confirmed' };
}

function onceIncome(id, date, amount) {
  return { id, label: id, frequency: 'once', date, amount, confidence: 'confirmed' };
}

function seaspanPaydays(from, to) {
  const dates = [];
  let d = from;
  while (d <= to) {
    dates.push(d);
    d = addDays(d, 14);
  }
  return dates;
}

// Independent of paydayAllocation: dated events, income-first within a day,
// weeklyVariable / 7 drain, then a same-day opening removal.
function independentWalk(opening, start, days, events, weeklyVariable, removeToday) {
  const byDate = new Map();
  for (const event of events || []) {
    if (!event || !event.date) continue;
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
  }
  const dailyDrain = (Number(weeklyVariable) || 0) / 7;
  let balance = roundCent(Number(opening) - Math.max(0, Number(removeToday) || 0));
  let min = { date: start, balance };
  const daily = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    const todays = byDate.get(date) || [];
    for (const event of todays) {
      balance = roundCent(balance + (Number(event.amount) || 0));
      if (balance < min.balance) min = { date, balance };
    }
    balance = roundCent(balance - dailyDrain);
    if (balance < min.balance) min = { date, balance };
    daily.push({ date, balance });
  }
  return { min, daily, additionalCashRequired: min.balance < 0 ? roundCent(-min.balance) : 0 };
}

function independentFeasible(opening, start, days, events, weekly, buffer, removeToday) {
  const walk = independentWalk(opening, start, days, events, weekly, removeToday);
  if (walk.min.balance < buffer - EPS) return false;
  return true;
}

function independentMaxRemoval(opening, start, days, events, weekly, buffer, leftover) {
  const cap = Math.max(0, Math.round((leftover || 0) * 100));
  const fits = cents => independentFeasible(opening, start, days, events, weekly, buffer, cents / 100);
  if (fits(cap)) return cap / 100;
  if (!fits(0)) return 0;
  let lo = 0;
  let hi = cap;
  while (lo + 1 < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return lo / 100;
}

function independentBacked(required, reserve) {
  const req = roundCent(required);
  const funded = roundCent(Math.min(req, Math.max(0, Number(reserve) || 0)));
  return { funded, remaining: roundCent(Math.max(0, req - funded)) };
}

function leftoverAfterOE(alloc) {
  return roundCent(alloc.available - alloc.obligations.allocated - alloc.essentials.allocated);
}

const src = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public/forecast.js'), 'utf8'));
const architecture = sourceText(fs.readFileSync(path.join(__dirname, '..', 'ARCHITECTURE.md'), 'utf8'));

console.log('=== authority: protectedPath is Prepare Ahead; ACR is not ===');
{
  ok(/Protected current cash is the leftover that cannot be removed today/.test(src)
      && /Prepare Ahead/.test(src)
      && /keep-in-chequing/.test(src)
      && /not additionalCashRequired/.test(src),
    'paydayAllocation source names Prepare Ahead as keep-in-chequing protectedPath, not ACR');
  ok(/function maxFeasiblePaydayRemoval\(/.test(src)
      && /protectedPath: \{/.test(src)
      && /function additionalCashRequiredFromWalkMin\(/.test(src),
    'Prepare Ahead stays on paydayAllocation.protectedPath; ACR stays the walk-min helper');
  ok(!/remainingAdditionalCashRequired\s*\/\s*/.test(src)
      && !/remaining \/ remaining paydays/.test(src),
    'no remaining-ACR ÷ paydays calculator exists in Forecast');
  ok(/Owner 2026-09-18\/19 Prepare Ahead is that same `protectedPath` hold/.test(architecture)
      && /not a transfer into designated Savings to fund ACR/.test(architecture),
    'ARCHITECTURE names protectedPath as Prepare Ahead keep-in-chequing protection');
  ok(/Prepare Ahead protection is `Forecast.paydayAllocation.protectedPath`/.test(architecture)
      && /transfer-to-Savings-to-fund-ACR remain out of scope/.test(architecture),
    'ACR packet still does not own spreading or Savings-to-fund-ACR');
}

console.log('\n=== 1. future cash-pressure leftover is not extra-debt surplus ===');
{
  const opening = 1000;
  const bill = 2000;
  const billDate = '2026-10-16';
  const income = [
    { date: '2026-09-15', amount: 400 },
    { date: '2026-10-15', amount: 400 },
  ];
  const plan = cashPlan(opening, 0, {
    income: [
      onceIncome('p1', '2026-09-15', 400),
      onceIncome('p2', '2026-10-15', 400),
    ],
    bills: [onceBill('heavy', billDate, bill)],
  });
  const events = income.concat([{ date: billDate, amount: -bill }]);
  const leftover = opening;
  const movable = independentMaxRemoval(
    opening, AS_OF, plan.windowDays, events, 0, 0, leftover);
  const protect = roundCent(leftover - movable);
  const walk = independentWalk(opening, AS_OF, plan.windowDays, events, 0, 0);
  ok(near(walk.min.balance, -200) && near(walk.additionalCashRequired, 200),
    'independent walk still goes $200 through zero after later pay and the October bill',
    `min ${walk.min.balance}`);
  ok(near(movable, 0) && near(protect, leftover),
    'independent master walk cannot release current leftover — sending it to extra debt deepens the hole',
    `movable ${movable} protect ${protect}`);
  const alloc = F.paydayAllocation(plan, AS_OF, allocOpts());
  ok(near(alloc.protectedPath.allocated, protect)
      && near(alloc.extraDebt.allocated, 0)
      && near(alloc.protectedPath.movable, 0),
    'protectedPath holds the leftover and extra debt receives none of it',
    `path ${alloc.protectedPath.allocated} extra ${alloc.extraDebt.allocated}`);
  const naivePaydays = seaspanPaydays(AS_OF, billDate);
  const acr = F.simulate(plan, AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
  ok(near(acr, 200) && naivePaydays.length >= 3,
    'zero-floor ACR is the $200 trough, already counting the later paydays');
  const naiveSplit = acr / naivePaydays.length;
  ok(!near(alloc.protectedPath.allocated, naiveSplit)
      && alloc.protectedPath.allocated > acr + EPS,
    'Prepare Ahead is not remaining ACR ÷ remaining paydays',
    `${alloc.protectedPath.allocated} vs ${acr} / ${naivePaydays.length} = ${naiveSplit}`);
}

console.log('\n=== 2. cash the walk does not need remains extra-debt eligible ===');
{
  const opening = 4000;
  const bill = 1500;
  const billDate = '2026-10-16';
  const plan = cashPlan(opening, 0, {
    bills: [onceBill('later', billDate, bill)],
  });
  const events = [{ date: billDate, amount: -bill }];
  const leftover = opening;
  const movable = independentMaxRemoval(
    opening, AS_OF, plan.windowDays, events, 0, 0, leftover);
  const protect = roundCent(leftover - movable);
  ok(near(movable, 2500) && near(protect, 1500),
    'independent walk can release $2,500 and must keep $1,500 for the later bill',
    `movable ${movable} protect ${protect}`);
  const alloc = F.paydayAllocation(plan, AS_OF, allocOpts());
  ok(near(alloc.protectedPath.allocated, protect)
      && near(alloc.extraDebt.allocated, movable),
    'only the walk-required leftover is protected; the rest is extra-debt surplus',
    `path ${alloc.protectedPath.allocated} extra ${alloc.extraDebt.allocated}`);
  ok(near(leftoverAfterOE(alloc), leftover),
    'this fixture has no obligation/essential take from the opening');
}

console.log('\n=== 3. two pressure periods net; they are not summed into protection ===');
{
  const opening = 100;
  const plan = cashPlan(opening, 0, {
    income: [onceIncome('recover', '2026-10-05', 80)],
    bills: [
      onceBill('first', '2026-09-20', 80),
      onceBill('second', '2026-10-20', 80),
    ],
    windowDays: 60,
  });
  const events = [
    { date: '2026-09-20', amount: -80 },
    { date: '2026-10-05', amount: 80 },
    { date: '2026-10-20', amount: -80 },
  ];
  const walk = independentWalk(opening, AS_OF, plan.windowDays, events, 0, 0);
  // $100 − $80 = $20, +$80 = $100, −$80 = $20. Global min is $20, not −$60.
  ok(near(walk.min.balance, 20) && near(walk.additionalCashRequired, 0),
    'recovery between red dates nets; independent required cash is $0, not $60',
    `min ${walk.min.balance}`);
  const movable = independentMaxRemoval(
    opening, AS_OF, plan.windowDays, events, 0, 0, opening);
  ok(near(movable, 20) && near(opening - movable, 80),
    'protection follows the recovered trough, not $80+$80',
    `movable ${movable}`);
  const alloc = F.paydayAllocation(plan, AS_OF, allocOpts());
  ok(near(alloc.protectedPath.allocated, opening - movable)
      && near(alloc.extraDebt.allocated, movable),
    'paydayAllocation protects the net path, not the sum of red periods',
    `path ${alloc.protectedPath.allocated} extra ${alloc.extraDebt.allocated}`);
  ok(!near(alloc.protectedPath.allocated, 160)
      && !near(alloc.protectedPath.allocated, 60),
    'protection is not the summed displayed holes');
}

console.log('\n=== 4. Prepare Ahead does not change additionalCashRequired ===');
{
  const plan = cashPlan(1000, 0, {
    bills: [onceBill('heavy', '2026-10-16', 2000)],
    income: [
      onceIncome('p1', '2026-09-15', 400),
      onceIncome('p2', '2026-10-15', 400),
    ],
  });
  const events = [
    { date: '2026-09-15', amount: 400 },
    { date: '2026-10-15', amount: 400 },
    { date: '2026-10-16', amount: -2000 },
  ];
  const independent = independentWalk(1000, AS_OF, plan.windowDays, events, 0, 0);
  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  const alloc = F.paydayAllocation(plan, AS_OF, allocOpts());
  ok(near(independent.additionalCashRequired, 200)
      && near(sim.additionalCashRequired, 200)
      && near(alloc.protectedPath.allocated, 1000),
    'holding leftover as Prepare Ahead does not rewrite additionalCashRequired',
    `ACR ${sim.additionalCashRequired} path ${alloc.protectedPath.allocated}`);
  ok(typeof sim.additionalCashRequired === 'number',
    'simulate additionalCashRequired remains the chequing-only number, not a packet rewrite');
}

console.log('\n=== 5. Case K: chequing→Savings is a pocket shuffle, not ACR funding ===');
{
  const bill = 1500;
  const billDate = '2026-10-16';
  const beforeChequing = 1000;
  const transfer = 400;
  const before = cashPlan(beforeChequing, 0, {
    bills: [onceBill('hole', billDate, bill)],
  });
  const after = cashPlan(beforeChequing - transfer, transfer, {
    bills: [onceBill('hole', billDate, bill)],
  });
  const eventsBefore = [{ date: billDate, amount: -bill }];
  const requiredBefore = independentWalk(
    beforeChequing, AS_OF, before.windowDays, eventsBefore, 0, 0).additionalCashRequired;
  const requiredAfter = independentWalk(
    beforeChequing - transfer, AS_OF, after.windowDays, eventsBefore, 0, 0).additionalCashRequired;
  const backedBefore = independentBacked(requiredBefore, 0);
  const backedAfter = independentBacked(requiredAfter, transfer);
  ok(near(requiredBefore, 500) && near(requiredAfter, 900),
    'moving $400 into Savings lowers the chequing walk and raises ACR amount $400',
    `${requiredBefore} → ${requiredAfter}`);
  ok(near(backedBefore.remaining, 500) && near(backedAfter.remaining, 500),
    'remaining ACR is unchanged — funded Savings rose by the same $400',
    `${backedBefore.remaining} vs ${backedAfter.remaining}`);
  const simBefore = F.simulate(before, AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
  const simAfter = F.simulate(after, AS_OF, { weeklyVariable: 0 }).additionalCashRequired;
  ok(near(simBefore, requiredBefore) && near(simAfter, requiredAfter),
    'Forecast additionalCashRequired follows the chequing walk, not the Savings pocket');
  const trajBefore = F.baselineTrajectory(before, [], AS_OF, { periods: periodsStub() });
  const trajAfter = F.baselineTrajectory(after, [], AS_OF, { periods: periodsStub() });
  ok(trajBefore.status === 'ready' && trajAfter.status === 'ready'
      && near(trajBefore.additionalCashRequired.remainingAdditionalCashRequired.amount, 500)
      && near(trajAfter.additionalCashRequired.remainingAdditionalCashRequired.amount, 500)
      && near(trajAfter.additionalCashRequired.amount, 900)
      && near(trajAfter.additionalCashRequired.fundedByDesignatedSavings.amount, 400),
    'trajectory remaining ACR is unchanged by the transfer; amount and funded move together');
  const allocBefore = F.paydayAllocation(before, AS_OF, allocOpts());
  const allocAfter = F.paydayAllocation(after, AS_OF, allocOpts());
  ok(near(allocBefore.opening, beforeChequing)
      && near(allocAfter.opening, beforeChequing - transfer)
      && !near(allocBefore.protectedPath.allocated, transfer)
      && !near(allocAfter.protectedPath.allocated, transfer),
    'designated Savings evidence is not the Prepare Ahead protection amount',
    `path ${allocBefore.protectedPath.allocated} vs transfer ${transfer}`);
}

console.log('\n=== 6. non-designated holdings do not back protection or ACR ===');
{
  const plan = cashPlan(1000, 0, {
    bills: [onceBill('hole', '2026-10-16', 1500)],
    startingCash: {
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: 1000, class: 'spendable' },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: 0, class: 'spendable' },
        { id: 'savings', label: 'EMERGENCY SAVING', value: 0, class: 'spendable' },
        { id: 'held-elsewhere', label: 'TENNIS INCOME', value: 5000, class: 'held-elsewhere' },
      ],
    },
  });
  const alloc = F.paydayAllocation(plan, AS_OF, allocOpts());
  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  ok(near(alloc.opening, 1000) && near(sim.additionalCashRequired, 500),
    'held-elsewhere cash is not spendable opening and does not close ACR');
  ok(alloc.protectedPath.allocated > EPS,
    'Prepare Ahead still holds chequing leftover; it does not borrow held-elsewhere');
  ok(alloc.plannedDebt.permitted === false && near(alloc.plannedDebt.borrowed, 0),
    'credit / borrowing is not used to manufacture Prepare Ahead cash');
}

console.log('\n=== 7. fail closed: no second planner, no Savings-funding identity ===');
{
  ok(!/thisPaydayReserve/.test(src)
      && !/prepareAheadAmount/.test(src)
      && !/function prepareAhead\(/.test(src),
    'Forecast did not grow a second Prepare Ahead calculator beside paydayAllocation');
  ok(/Keep for future cash path/.test(src),
    'the published path line remains the keep-in-chequing future-path hold');
}

if (failures) {
  console.log(`\nFAILED — ${failures} Prepare Ahead check(s)`);
  process.exit(1);
}
console.log('\nAll Prepare Ahead identity checks passed.');
