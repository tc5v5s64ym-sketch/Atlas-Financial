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
 * Live cents are the thing under test here, not a copied behaviour spec.
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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
