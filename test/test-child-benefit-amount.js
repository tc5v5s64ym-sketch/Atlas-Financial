'use strict';
/* Canada Child Benefit plan.income.childBenefit is $219.45 monthly on day 20.
 *
 * Owner-authorized 2026-09-18. Standing rule: Lunch Money CHILD TAX BEN CCB
 * deposits are positive evidence Forecast income must update. Evidence:
 * 2026-08-20 LM/Atlas tx-141 $219.45 and owner 2026-09-18 TD Unlimited
 * Chequing CHILD TAX BEN CCB $219.45. Prior ~18 months through Jul 2026
 * were $153.59. Scheduled day stays 20 (Sep 18 is Friday before Sunday
 * Sep 20 CRA cadence). Confidence stays confirmed.
 *
 * Independent proof (L-002 / L-006): hand-listed monthly dates at day 20
 * and 3 × 219.45 = 658.35 over the 91-day window starting 2026-08-19.
 * Downstream weekly-cap / cash-path proof is the same restatement's
 * identity, not a second planner: extra CCB before the cash-buffer bind
 * unlocks STEP-sized weekly, and the longer window then spends that
 * higher weekly every day. Live cents are the thing under test here,
 * not a copied behaviour spec.
 *
 * `node test/test-child-benefit-amount.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const STREAM_ID = 'childBenefit';
const AMOUNT = 219.45;
const STALE = 153.59;
const DAY = 20;
const AS_OF = '2026-08-19';
const WINDOW_DAYS = 91;
const WINDOW_END = '2026-11-17';
const HORIZON_END = '2026-12-31';
const HAND_WINDOW_DATES = ['2026-08-20', '2026-09-20', '2026-10-20'];
const HAND_HORIZON_DATES = [
  '2026-08-20', '2026-09-20', '2026-10-20', '2026-11-20', '2026-12-20',
];
const HAND_WINDOW_TOTAL = 658.35;
const HAND_HORIZON_TOTAL = 1097.25;
const AMOUNT_DELTA = roundCent(AMOUNT - STALE);
const WEEKLY_STEP = 5;
const WEEKS_PER_MONTH = 365.25 / 12 / 7;
const SCOREBOARD_DAY_90 = 90;

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function independentMonthlyDates(day, start, end) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  for (;;) {
    const d = Math.min(day, daysInMonth(y, m));
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso > end) break;
    if (iso >= start) out.push(iso);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function fixturePlan() {
  return {
    windowDays: WINDOW_DAYS,
    defaults: { targetBuffer: 0 },
    startingCash: { breakdown: [{ id: 'chequing-b', value: 300, class: 'spendable' }] },
    income: [{
      id: STREAM_ID,
      label: 'Child benefit',
      frequency: 'monthly',
      day: DAY,
      amount: AMOUNT,
      confidence: 'confirmed',
    }],
    obligations: [],
    bills: [],
    commitments: [],
  };
}

function childEvents(plan, start, end) {
  return F.expandEvents(plan, start, end, {})
    .filter(e => e && e.id === STREAM_ID && e.kind === 'income')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

console.log('=== 1. independent hand list is day 20 monthly, not Forecast.occurrences ===');
{
  const walked = independentMonthlyDates(DAY, AS_OF, WINDOW_END);
  ok(WINDOW_END === F.addDays(AS_OF, WINDOW_DAYS - 1),
    '91-day window end from 2026-08-19 is independently 2026-11-17',
    WINDOW_END);
  ok(walked.join(',') === HAND_WINDOW_DATES.join(','),
    'independent walker lists Aug/Sep/Oct 20 and excludes Nov 20 (after window end)',
    walked.join(','));
  ok(independentMonthlyDates(DAY, AS_OF, HORIZON_END).join(',')
      === HAND_HORIZON_DATES.join(','),
    'independent walker lists five day-20 dates through 2026-12-31');
  ok(near(roundCent(3 * AMOUNT), HAND_WINDOW_TOTAL)
      && near(roundCent(5 * AMOUNT), HAND_HORIZON_TOTAL)
      && HAND_WINDOW_TOTAL === 658.35
      && HAND_HORIZON_TOTAL === 1097.25,
    'hand totals are 3 × 219.45 = 658.35 and 5 × 219.45 = 1097.25');
  ok(!HAND_WINDOW_DATES.includes('2026-09-18')
      && !HAND_HORIZON_DATES.includes('2026-09-18'),
    'independent list keeps day 20; does not invent Sep 18 as a scheduled day');
}

console.log('\n=== 2. fixture expandEvents publishes $219.45 on the hand-listed dates ===');
{
  const events = childEvents(fixturePlan(), AS_OF, WINDOW_END);
  ok(events.map(e => e.date).join(',') === HAND_WINDOW_DATES.join(','),
    'fixture dates match the independent hand list',
    events.map(e => e.date).join(','));
  ok(events.length === 3 && events.every(e =>
      near(e.amount, AMOUNT)
      && e.kind === 'income'
      && e.id === STREAM_ID
      && e.confidence === 'confirmed'
      && e.label === 'Child benefit'),
    'each fixture occurrence is confirmed Child benefit income of $219.45');
  ok(events.every(e => !near(e.amount, STALE)),
    'fixture occurrences are not the stale $153.59');
  const engineSum = roundCent(events.reduce((s, e) => s + Number(e.amount), 0));
  ok(near(engineSum, HAND_WINDOW_TOTAL),
    'fixture expandEvents total agrees with 3 × 219.45',
    `${engineSum} vs ${HAND_WINDOW_TOTAL}`);
}

console.log('\n=== 3. live plan.income.childBenefit encodes $219.45 monthly day 20 ===');
{
  const live = load('data.json');
  const stream = ((live.plan && live.plan.income) || [])
    .find(s => s && s.id === STREAM_ID);
  ok(!!stream, 'live plan has childBenefit');
  ok(stream && stream.frequency === 'monthly' && stream.day === DAY
      && near(stream.amount, AMOUNT) && stream.confidence === 'confirmed',
    'live encoding is confirmed $219.45 monthly on day 20',
    stream ? `${stream.amount} / ${stream.frequency} / day ${stream.day}` : 'missing');
  ok(stream && !near(stream.amount, STALE),
    'live encoding is not the stale $153.59');
  ok(stream && stream.day !== 18,
    'live encoding does not move the scheduled day to Sep 18');
  const note = stream && String(stream.note || '');
  ok(/219\.45/.test(note) && /153\.59/.test(note)
      && /tx-141/.test(note) && /2026-09-18/.test(note)
      && /CHILD TAX BEN CCB/.test(note),
    'live note records the CRA-year step and both evidence deposits');
}

console.log('\n=== 4. live expandEvents publishes $219.45, not $153.59 ===');
{
  const live = load('data.json');
  const asOf = live.meta && live.meta.asOf;
  const windowDays = live.plan && live.plan.windowDays;
  ok(asOf === AS_OF && windowDays === WINDOW_DAYS,
    'live opening as-of and 91-day window are the dated 2026-08-19 plan');
  const windowEvents = childEvents(live.plan, AS_OF, WINDOW_END);
  ok(windowEvents.map(e => e.date).join(',') === HAND_WINDOW_DATES.join(','),
    'live 91-day dates match the independent hand list',
    windowEvents.map(e => e.date).join(','));
  ok(windowEvents.length === 3 && windowEvents.every(e =>
      near(e.amount, AMOUNT)
      && e.kind === 'income'
      && e.id === STREAM_ID
      && e.confidence === 'confirmed'),
    'live 91-day expandEvents publishes confirmed $219.45 on each date');
  ok(windowEvents.every(e => !near(e.amount, STALE)),
    'live 91-day occurrences are not $153.59');
  const windowSum = roundCent(windowEvents.reduce((s, e) => s + Number(e.amount), 0));
  ok(near(windowSum, HAND_WINDOW_TOTAL),
    'live 91-day childBenefit total agrees with 3 × 219.45',
    `${windowSum} vs ${HAND_WINDOW_TOTAL}`);

  const horizonEvents = childEvents(live.plan, AS_OF, HORIZON_END);
  ok(horizonEvents.map(e => e.date).join(',') === HAND_HORIZON_DATES.join(','),
    'live dates through 2026-12-31 match the independent hand list');
  const horizonSum = roundCent(horizonEvents.reduce((s, e) => s + Number(e.amount), 0));
  ok(near(horizonSum, HAND_HORIZON_TOTAL)
      && horizonEvents.every(e => near(e.amount, AMOUNT)),
    'live horizon childBenefit total agrees with 5 × 219.45',
    `${horizonSum} vs ${HAND_HORIZON_TOTAL}`);
}

console.log('\n=== 5. ACCOUNT_FACTS standing income line matches the live amount ===');
{
  const facts = fs.readFileSync(path.join(__dirname, '..', 'docs/ACCOUNT_FACTS.md'), 'utf8');
  ok(!/\bchild benefit \*\*monthly\*\* \(~\$153\.59\)/.test(facts),
    'standing facts no longer publish ~$153.59 as the live monthly CCB amount');
  ok(/child benefit \*\*monthly\*\* \(~\$219\.45/.test(facts),
    'standing facts publish ~$219.45 as the live monthly CCB amount');
}

console.log('\n=== 6. weekly-cap and cash-path movement is the CCB identity, not a second planner ===');
{
  // Atlas Contract / Systems Review BLOCKING on
  // 052334b990bbd5f08d3053aef89d6ceeadec6f09: figures-gate weeklyCap
  // 225→275, weeklyCapMonthly +217.41, and 91-day ending cash −452.42
  // were unpublished side-effects. This block independently reconciles
  // those deltas. It does not change Forecast.recommend or freeze the
  // absolute $225 / $275 levels (L-006).
  const live = load('data.json');
  const plan = live.plan;
  const asOf = live.meta && live.meta.asOf;
  const buffer = plan && plan.defaults && plan.defaults.targetBuffer;
  ok(asOf === AS_OF && plan && plan.windowDays === WINDOW_DAYS && buffer === 500,
    'live recommend path is the dated 2026-08-19 plan with $500 buffer');

  function snapshotOpts() {
    return {
      scenario: plan.defaults.scenario,
      incomeOverrides: {},
      disabled: [],
      extraDebtMonthly: plan.defaults.extraDebtMonthly || 0,
      targetBuffer: buffer,
      fundingSources: (plan.funding || {}).options,
      extraFacilities: live.revolvingExtra,
    };
  }

  function planWithCcb(amount) {
    const copy = JSON.parse(JSON.stringify(plan));
    const stream = (copy.income || []).find(s => s && s.id === STREAM_ID);
    stream.amount = amount;
    return copy;
  }

  const staleAdvice = F.recommend(planWithCcb(STALE), asOf, snapshotOpts());
  const liveAdvice = F.recommend(planWithCcb(AMOUNT), asOf, snapshotOpts());
  ok(staleAdvice.mode === 'normal' && liveAdvice.mode === 'normal',
    'CCB restatement does not change recommend mode',
    `${staleAdvice.mode} → ${liveAdvice.mode}`);
  ok((staleAdvice.paydayAllocation && staleAdvice.paydayAllocation.extraDebt
        && staleAdvice.paydayAllocation.extraDebt.allocated === 0)
      && (liveAdvice.paydayAllocation && liveAdvice.paydayAllocation.extraDebt
        && liveAdvice.paydayAllocation.extraDebt.allocated === 0),
    'extra-debt allocation stays $0; it is not a second cash mover');

  const bindDate = staleAdvice.sim && staleAdvice.sim.min && staleAdvice.sim.min.date;
  const liveBindDate = liveAdvice.sim && liveAdvice.sim.min && liveAdvice.sim.min.date;
  ok(bindDate === liveBindDate && bindDate >= HAND_WINDOW_DATES[0],
    'cash-buffer bind date is unchanged and falls on or after the first CCB',
    `${bindDate} / ${liveBindDate}`);
  ok(staleAdvice.bindingIsReal === true && liveAdvice.bindingIsReal === true
      && staleAdvice.step === WEEKLY_STEP && liveAdvice.step === WEEKLY_STEP,
    'both answers are STEP-tight ($5); one step up breaches the buffer');

  const bindDays = F.diffDays(asOf, bindDate) + 1;
  const extraByBind = independentMonthlyDates(DAY, asOf, bindDate).length * AMOUNT_DELTA;
  const unlockedWeekly = extraByBind * 7 / bindDays;
  const independentWeeklyDelta = WEEKLY_STEP * Math.floor(unlockedWeekly / WEEKLY_STEP);
  ok(bindDays === 9 && near(extraByBind, AMOUNT_DELTA) && near(unlockedWeekly, 51.2244444444, 1e-9),
    'first CCB is the only extra dollar before Aug 27; 65.86 × 7 / 9 = 51.224…/week',
    `${bindDays}d / extra ${extraByBind} / unlocked ${unlockedWeekly}`);
  ok(independentWeeklyDelta === 50,
    'STEP 5 floors that unlock to +$50/week, not +$55 (9 × 55 / 7 > 65.86)');

  const engineWeeklyDelta = liveAdvice.weekly - staleAdvice.weekly;
  ok(engineWeeklyDelta === independentWeeklyDelta,
    'Forecast.recommend weekly delta equals the independent STEP-floored unlock',
    `${staleAdvice.weekly} → ${liveAdvice.weekly} (Δ ${engineWeeklyDelta})`);

  const independentMonthlyDelta = independentWeeklyDelta * WEEKS_PER_MONTH;
  const engineMonthlyDelta = F.monthlyFromWeekly(liveAdvice.weekly)
    - F.monthlyFromWeekly(staleAdvice.weekly);
  ok(near(independentMonthlyDelta, 217.4107142857, 1e-9)
      && near(engineMonthlyDelta, independentMonthlyDelta, 1e-9),
    'weeklyCapMonthly delta is 50 × 365.25 / 12 / 7 = 217.4107…',
    String(engineMonthlyDelta));

  const leftoverByBind = extraByBind - bindDays * independentWeeklyDelta / 7;
  const engineMinDelta = (liveAdvice.sim.min.balance - staleAdvice.sim.min.balance);
  ok(near(leftoverByBind, 1.5742857143, 1e-9) && near(engineMinDelta, leftoverByBind),
    'Aug 27 min-cash delta is leftover 65.86 − 9 × 50 / 7 = 1.574…',
    String(engineMinDelta));

  const extraInWindow = HAND_WINDOW_DATES.length * AMOUNT_DELTA;
  const independentEndingDelta = extraInWindow
    - WINDOW_DAYS * independentWeeklyDelta / 7;
  const engineEndingDelta = liveAdvice.sim.ending - staleAdvice.sim.ending;
  ok(near(extraInWindow, 197.58) && near(independentEndingDelta, -452.42)
      && near(engineEndingDelta, independentEndingDelta),
    '91-day ending-cash delta is 3 × 65.86 − 91 × 50 / 7 = −452.42',
    String(engineEndingDelta));

  const day90Date = F.addDays(asOf, SCOREBOARD_DAY_90 - 1);
  ok(day90Date === '2026-11-16',
    'scoreboard day 90 is as-of + 89 days = 2026-11-16 (i + 1 in projectDebts)');
  const extraByDay90 = independentMonthlyDates(DAY, asOf, day90Date).length * AMOUNT_DELTA;
  const independentDay90Delta = extraByDay90
    - SCOREBOARD_DAY_90 * independentWeeklyDelta / 7;
  const staleDay90 = (staleAdvice.sim.daily.find(p => p.date === day90Date) || {}).balance;
  const liveDay90 = (liveAdvice.sim.daily.find(p => p.date === day90Date) || {}).balance;
  ok(near(extraByDay90, 197.58) && near(independentDay90Delta, -445.2771428571, 1e-9)
      && near(liveDay90 - staleDay90, independentDay90Delta),
    'day-90 cash delta is 3 × 65.86 − 90 × 50 / 7 = −445.277…',
    String(liveDay90 - staleDay90));

  ok(near(liveAdvice.sim.totals.confirmedIncome - staleAdvice.sim.totals.confirmedIncome,
      extraInWindow),
    '91-day confirmed-income delta is only the three CCB extras',
    String(liveAdvice.sim.totals.confirmedIncome - staleAdvice.sim.totals.confirmedIncome));
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
