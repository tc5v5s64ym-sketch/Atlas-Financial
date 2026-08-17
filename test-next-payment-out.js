'use strict';
/* Focused proof for Forecast.nextPaymentOut(). The correctness cases are
 * hand-computed against a fixture event stream, not against the function that
 * now produces the answer. The live-plan check reconciles the published tile
 * against the two Burrard commitment literals in data.json, not against a
 * second copy of the page's old filter-and-sum.
 *
 * Until this move public/plan.js decided the tile, where no test could reach
 * it. B73 recorded the mutation: summing the day → the single largest outflow
 * left npm test green.
 */
const fs = require('fs');
const vm = require('vm');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = x => JSON.parse(JSON.stringify(x));
const cents = n => Math.round(n * 100);
const same = (a, b) => cents(a) === cents(b);
const read = p => sourceText(fs.readFileSync(p, 'utf8'));

/* A stream built so that EVERY excluded event sits on or before the winner's
 * date. If any exclusion failed to bite, that event would change the day or
 * the total, so the assertions on 12 August at $623.00 are load-bearing for
 * all three rules.
 *
 *   date          amount    kind        why it does or does not count
 *   2026-08-09     -50.00   bill        before as-of           → excluded
 *   2026-08-11    -800.00   noncash     capitalised interest   → excluded
 *   2026-08-12   +4264.00   income      inflow                 → excluded
 *   2026-08-12    -320.00   commitment  Burrard child 1        → counts
 *   2026-08-12    -303.00   commitment  Burrard child 2        → counts
 *   2026-08-13     -78.40   bill        the next day           → later
 *
 * As of 2026-08-10 the next cash-out day is 12 August. Child 1 is $320.00 and
 * child 2 is $303.00. Added by hand: 320 + 303 = 623. That is what has to be
 * in the account that day, not the larger registration alone. 10 Aug to
 * 12 Aug is two days.
 */
const AS_OF = '2026-08-10';
const EVENTS = [
  { date: '2026-08-09', amount: -50, kind: 'bill', label: 'Yesterday' },
  { date: '2026-08-11', amount: -800, kind: 'noncash', label: 'HELOC interest charged' },
  { date: '2026-08-12', amount: 4264, kind: 'income', label: 'Payroll — Seaspan' },
  { date: '2026-08-12', amount: -320, kind: 'commitment',
    label: 'Burrard registration — child 1' },
  { date: '2026-08-12', amount: -303, kind: 'commitment',
    label: 'Burrard registration — child 2' },
  { date: '2026-08-13', amount: -78.40, kind: 'bill', label: 'Shaw internet' },
];
const HAND_DATE = '2026-08-12';
const HAND_CHILD_1 = 320;
const HAND_CHILD_2 = 303;
const HAND_TOTAL = 623; // 320 + 303, added on paper, not by the engine
const HAND_DAYS = 2;    // 10 Aug → 12 Aug
const HAND_LABEL = '2 payments — Burrard registration and others';

console.log('=== hand-computed day total ===');
const next = F.nextPaymentOut(EVENTS, AS_OF);
ok(!!next, 'an eligible cash-out day is found');
ok(next && next.date === HAND_DATE, 'it is 12 August', next ? next.date : 'none');
ok(next && next.count === 2, 'both registrations count', next ? String(next.count) : 'none');
ok(next && same(next.amount, HAND_TOTAL),
  'the day costs $623.00 — $320.00 + $303.00',
  next ? String(next.amount) : 'none');
ok(next && next.amount !== HAND_CHILD_1 && next.amount !== HAND_CHILD_2,
  'the winner is the day total, not either registration alone');
ok(next && next.daysUntil === HAND_DAYS,
  '10 Aug to 12 Aug is two days', next ? String(next.daysUntil) : 'none');
ok(next && next.label === HAND_LABEL,
  'two payments share the first event\'s stem',
  next ? next.label : 'none');
ok(HAND_TOTAL === HAND_CHILD_1 + HAND_CHILD_2,
  'the expected total is the arithmetic identity 320 + 303 = 623');

console.log('\n=== each exclusion is what kept the event out ===');
const beforeYesterday = F.nextPaymentOut(EVENTS, '2026-08-09');
ok(beforeYesterday && beforeYesterday.date === '2026-08-09'
  && same(beforeYesterday.amount, 50) && beforeYesterday.count === 1,
  'Yesterday lost only because it was already before as-of',
  beforeYesterday ? `${beforeYesterday.date} $${beforeYesterday.amount}` : 'none');

const asCash = clone(EVENTS);
asCash[1].kind = 'obligation';
const withCash = F.nextPaymentOut(asCash, AS_OF);
ok(withCash && withCash.date === '2026-08-11' && same(withCash.amount, 800),
  'the HELOC charge lost only because it is non-cash',
  withCash ? `${withCash.date} $${withCash.amount}` : 'none');

const payrollOut = clone(EVENTS);
payrollOut[2].amount = -4264;
payrollOut[2].kind = 'obligation';
const withPayrollOut = F.nextPaymentOut(payrollOut, AS_OF);
ok(withPayrollOut && withPayrollOut.date === HAND_DATE
  && same(withPayrollOut.amount, 4264 + HAND_TOTAL),
  'the payroll inflow lost only because it is money arriving',
  withPayrollOut ? String(withPayrollOut.amount) : 'none');

console.log('\n=== one event keeps its own label ===');
const one = F.nextPaymentOut(EVENTS.filter(e => e.label === 'Shaw internet'), '2026-08-13');
ok(one && one.count === 1 && one.label === 'Shaw internet' && same(one.amount, 78.40),
  'a single outflow is named, not counted',
  one ? `${one.label} $${one.amount}` : 'none');

console.log('\n=== stream order names a multi-payment day, not size ===');
const ordered = [
  { date: HAND_DATE, amount: -210, kind: 'commitment', label: 'Dentist — filling' },
  { date: HAND_DATE, amount: -275, kind: 'commitment', label: 'Car insurance' },
];
const firstStem = F.nextPaymentOut(ordered, AS_OF);
ok(firstStem && firstStem.label === '2 payments — Dentist and others'
  && same(firstStem.amount, 485),
  'the first event in stream order supplies the stem, not the larger amount',
  firstStem ? `${firstStem.label} $${firstStem.amount}` : 'none');
const reversed = [ordered[1], ordered[0]];
const secondStem = F.nextPaymentOut(reversed, AS_OF);
ok(secondStem && secondStem.label === '2 payments — Car insurance and others'
  && same(secondStem.amount, 485),
  'reversing the stream reverses the stem and leaves the day total',
  secondStem ? secondStem.label : 'none');

console.log('\n=== boundaries ===');
const today = F.nextPaymentOut(EVENTS, HAND_DATE);
ok(today && today.date === HAND_DATE && today.daysUntil === 0
  && same(today.amount, HAND_TOTAL),
  'an outflow due today is next out, at zero days',
  today ? `${today.date} in ${today.daysUntil}d $${today.amount}` : 'none');

ok(F.nextPaymentOut(EVENTS.slice(0, 3), AS_OF) === null,
  'no eligible cash-out returns null');
ok(F.nextPaymentOut([], AS_OF) === null, 'an empty stream returns null');
ok(F.nextPaymentOut(undefined, AS_OF) === null, 'a missing stream returns null');

console.log('\n=== live plan: independent of the old page expression ===');
/* data.json as-of 2026-08-16. Burrards are settled. The next dated joint-cash
 * outflows are the four unposted 15 August bills reserved on this opening:
 * BCAA $82.96 + ICBC $99.91 + RESP $100.00 + union $25.00 = $307.87. */
const asOf = data.meta.asOf;
const outstanding = (data.plan.bills || []).filter(b => /aug15-outstanding/.test(b.id));
ok(asOf === '2026-08-16', 'the published as-of is 16 August', asOf);
ok(outstanding.length === 4, 'data.json reserves four unposted 15 August bills');
const liveExpected = outstanding.reduce((s, b) => s + b.amount, 0);
ok(same(liveExpected, 307.87), 'independent 15 August reserve is $307.87');

const live = F.nextPaymentOut(
  F.recommend(data.plan, asOf, {
    scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
    targetBuffer: data.plan.defaults.targetBuffer,
  }).sim.events,
  asOf);
ok(live && live.date === '2026-08-16' && live.count === 4
  && same(live.amount, liveExpected) && live.daysUntil === 0,
  'the published tile is 16 August, the reserved mid-month total, due today',
  live ? `${live.label} on ${live.date} $${live.amount} in ${live.daysUntil}d` : 'none');

console.log('\n=== page is a renderer ===');
const page = read('public/plan.js');
ok(/Forecast\.nextPaymentOut\(/.test(page),
  'the Plan page reads the day total from Forecast.nextPaymentOut');
ok(!/nextCritical/.test(page), 'the page no longer builds nextCritical');
ok(!/nextOutDate/.test(page), 'the page no longer selects the next outflow date');
ok(!/e\.kind !== 'noncash' && e\.date >= asOf/.test(page),
  'the page no longer filters cash outflows for this tile');

console.log('\n=== mutation: summing the day is what the suite now reaches ===');
/* B73's recorded mutation, at its new home: replace the day sum with the
 * single largest outflow. On the fixture that publishes $320.00 instead of
 * $623.00. A decision that survives being broken is not being tested. */
const FORECAST_SRC = read('public/forecast.js');
const FROM = '    const dayTotal = sameDay.reduce((cash, event) => cash + event.amount, 0);';
const TO = '    const dayTotal = sameDay.reduce((cash, event) => event.amount < cash ? event.amount : cash, 0);';
ok(FORECAST_SRC.split(FROM).length - 1 === 1,
  'the day-total sum appears once in the engine, so the mutation is aimed');
const sandbox = { module: { exports: {} } };
try {
  vm.runInNewContext(FORECAST_SRC.replace(FROM, TO), sandbox, { filename: 'forecast-mutant.js' });
} catch (e) {
  ok(false, 'mutant engine loads', e.message);
}
const mutant = sandbox.module.exports;
const broken = mutant && mutant.nextPaymentOut(EVENTS, AS_OF);
ok(mutant && broken && same(broken.amount, HAND_CHILD_1)
  && !same(broken.amount, HAND_TOTAL),
  'summing the day → the single largest outflow changes the answer to $320.00',
  broken ? String(broken.amount) : 'mutant missing');
ok(next && same(next.amount, HAND_TOTAL),
  'the real engine still answers $623.00 on the same fixture');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
