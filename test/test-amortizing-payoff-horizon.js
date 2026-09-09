'use strict';
/* After a named amortising balance is exhausted, later scheduled
 * installments — including a fixed interest share — must not drain cash.
 * Expected cash is a remaining-principal walk on literal dates. The
 * production debt walker is not the oracle.
 * Run: node test/test-amortizing-payoff-horizon.js
 */
const F = require('../public/forecast.js');

let failures = 0;
const ok = (condition, label) => {
  if (!condition) failures++;
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
};
const near = (actual, expected, label) => ok(
  Number.isFinite(actual) && Math.abs(actual - expected) < 0.005,
  `${label}: ${actual} / expected ${expected}`);
const START = '2026-01-01';
const MONTH_ENDS = [
  '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
  '2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31',
  '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
];

function plan(extra) {
  return Object.assign({
    windowDays: 91,
    startingCash: { amount: 5000 },
    defaults: { targetBuffer: 0 },
    income: [], obligations: [], bills: [], commitments: [],
  }, extra || {});
}
function monthlyMortgage(amount) {
  return {
    id: 'mortgage-payment', label: 'Synthetic mortgage',
    frequency: 'monthly', day: 31, amount,
    debtId: 'mortgage', effect: 'payment', confidence: 'confirmed',
  };
}
function mortgage(balance, extra) {
  return Object.assign({
    id: 'mortgage', label: 'Synthetic mortgage', balance, pending: 0,
    rate: 12, interestByEvent: true, principalShare: 0.5,
    secured: true, limit: null,
  }, extra || {});
}
function recommend(p, debts) {
  return F.recommend(p, START, { debts, targetBuffer: 0, extraDebtMonthly: 0 });
}
function zeroWalk(p, advice) {
  return F.simulate(p, START, Object.assign({}, advice.simOptions, {
    weeklyVariable: 0, horizonDays: advice.knowledge.days,
    viewDays: advice.knowledge.days, viewStart: START,
  }));
}

// Independent remaining-principal walk. A later installment exists only
// while named principal remains. Interest share is the contractual
// leftover of that installment, not a call into projectDebts.
function expectedAbsorbed(dates, amount, opening, principalShare) {
  let remaining = opening;
  return dates.map(date => {
    if (!(remaining > 0.005)) return { date, cash: 0, principal: 0, interest: 0 };
    const principalDue = amount * principalShare;
    const interestDue = amount - principalDue;
    const principal = Math.min(principalDue, remaining);
    remaining -= principal;
    return { date, cash: principal + interestDue, principal, interest: interestDue };
  });
}

console.log('=== amortising payoff stops later interest share ===');
{
  const amount = 200;
  const opening = 300;
  const share = 0.5;
  const expected = expectedAbsorbed(MONTH_ENDS, amount, opening, share);
  const expectedCash = expected.reduce((sum, row) => sum + row.cash, 0);
  ok(expected.filter(row => row.cash > 0).map(row => row.date).join(',')
    === MONTH_ENDS.slice(0, 3).join(','),
    'independent walk pays January through March only');
  near(expectedCash, 3 * amount, 'three contractual installments exhaust $300 principal');
  ok(expected.slice(3).every(row => row.cash === 0),
    'independent walk assigns $0 after named principal is gone');

  const p = plan({ obligations: [monthlyMortgage(amount)] });
  const debts = [mortgage(opening)];
  const before = JSON.stringify({ p, debts });
  const result = recommend(p, debts);
  const full = zeroWalk(p, result);
  const events = full.events.filter(e => e.kind === 'obligation')
    .sort((a, b) => a.date < b.date ? -1 : 1);
  ok(JSON.stringify({ p, debts }) === before, 'recommendation leaves inputs unchanged');

  near(full.totals.obligations, expectedCash,
    'recommend cash walk matches the independent remaining-principal total');
  near(full.ending, 5000 - expectedCash,
    'zero-spend ending is opening cash minus those installments only');
  ok(events.map(e => e.date).join(',') === MONTH_ENDS.slice(0, 3).join(','),
    'later scheduled month-ends are omitted from the cash walk');
  ok(events.every((e, i) => Math.abs(-e.amount - expected[i].cash) < 0.005),
    'each surviving installment equals the independent contractual cash');
  ok(!events.some(e => e.date === '2026-04-30'),
    'April interest share is not taken after March exhausts the balance');
}

console.log('\n=== last installment may be smaller than the contractual principal share ===');
{
  const amount = 200;
  const opening = 250;
  const share = 0.5;
  const expected = expectedAbsorbed(MONTH_ENDS, amount, opening, share);
  const expectedCash = expected.reduce((sum, row) => sum + row.cash, 0);
  // Jan/Feb full $200; March $50 remaining principal + $100 interest.
  near(expected[0].cash, 200, 'January is still a full installment');
  near(expected[2].cash, 150, 'March keeps contractual interest and remaining principal');
  near(expectedCash, 550, 'independent total is two full installments plus the exhausting remainder');
  ok(expected.slice(3).every(row => row.cash === 0),
    'later months stay at zero after the exhausting March payment');

  const p = plan({ startingCash: { amount: 2000 }, obligations: [monthlyMortgage(amount)] });
  const result = recommend(p, [mortgage(opening)]);
  const full = zeroWalk(p, result);
  const events = full.events.filter(e => e.kind === 'obligation')
    .sort((a, b) => a.date < b.date ? -1 : 1);
  near(full.totals.obligations, expectedCash,
    'partial final amortising payment matches the independent walk');
  near(full.ending, 2000 - expectedCash, 'no cash leaves after the exhausting payment');
  ok(events.map(e => `${e.date}:${(-e.amount).toFixed(2)}`).join(',')
    === expected.filter(row => row.cash > 0)
      .map(row => `${row.date}:${row.cash.toFixed(2)}`).join(','),
    'surviving dates and amounts match the independent exhausting walk');
}

console.log('\n=== a loan that is not exhausted keeps every contractual installment ===');
{
  const amount = 200;
  const opening = 10000;
  const expected = expectedAbsorbed(MONTH_ENDS, amount, opening, 0.5);
  const expectedCash = expected.reduce((sum, row) => sum + row.cash, 0);
  near(expectedCash, 12 * amount, 'twelve month-ends remain due while principal lasts');
  const p = plan({ startingCash: { amount: 4000 }, obligations: [monthlyMortgage(amount)] });
  const result = recommend(p, [mortgage(opening)]);
  near(zeroWalk(p, result).totals.obligations, expectedCash,
    'unexhausted amortising debt still deducts every scheduled installment');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exitCode = failures ? 1 : 0;
