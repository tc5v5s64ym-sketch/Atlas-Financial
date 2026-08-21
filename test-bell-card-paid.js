'use strict';
/* Independent proof that the known Bell telecom baseline exerts exactly
 * $121/month of Forecast gravity, once, without a due date and without
 * treating Travel Visa payment or minimum as a second Bell expense.
 * `node test-bell-card-paid.js`
 *
 * Does NOT use Forecast.simulate as the authority for the $121 amount.
 * The baseline is reconstructed from the June statement lines and the
 * second-account CSV lines. The horizon identity is the calendar month
 * 365.25/12. Live cents are not the specification.
 */
const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');
const live = require('./data.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => Number(n).toFixed(2);
const clone = x => JSON.parse(JSON.stringify(x));

const AS_OF = '2026-08-19';
const HORIZON = 365;
const DAYS_PER_MONTH = 365.25 / 12;
const MAIN_BELL = 70 + 25.80 + 8.40;
const SECOND_WATCH = 15 + 0.75 + 1.05;
const BELL = MAIN_BELL + SECOND_WATCH;
const WATCH_LINE_AGAIN = 15;
const TRAVEL_MIN = 17;
const TRAVEL_PAY = 250;
const OPENING = 20000;

function barePlan(currentMonthly) {
  return {
    windowDays: 91,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: OPENING },
    income: [],
    obligations: [
      {
        id: 'travel',
        debtId: 'travelvisa',
        effect: 'payment',
        label: 'Travel Visa minimum',
        frequency: 'monthly',
        day: 26,
        amount: TRAVEL_MIN,
        confidence: 'estimated',
      },
      {
        id: 'travel-bell-payment',
        debtId: 'travelvisa',
        effect: 'payment',
        label: 'Travel Visa Bell Mobility payment',
        frequency: 'once',
        date: '2026-08-26',
        amount: TRAVEL_PAY,
        confidence: 'confirmed',
      },
    ],
    bills: [],
    commitments: [],
    budget: {
      basis: 'ytd',
      categories: [{
        id: 'telecom',
        label: 'Phones & internet',
        class: 'essential',
        from: ['Telecom'],
        plannedMonthly: null,
        currentMonthly,
      }],
    },
  };
}

const debts = [{
  id: 'travelvisa',
  label: 'Travel Visa',
  balance: 1200,
  pending: 0,
  limit: 1100,
  rate: 0,
  interestByEvent: true,
}];

function walk(plan) {
  return F.simulate(plan, AS_OF, {
    weeklyVariable: 0,
    targetBuffer: 0,
    horizonDays: HORIZON,
    viewDays: HORIZON,
  });
}

function debtWalk(plan) {
  return F.projectDebts(plan, debts, AS_OF, {
    weeklyVariable: 0,
    horizonDays: HORIZON,
    debtHorizonDays: HORIZON,
  });
}

console.log('=== independent Bell baseline is $104.20 + $16.80 ===');
ok(near(MAIN_BELL, 104.20),
  'June main-account lines are $70.00 + $25.80 + $8.40 = $104.20', money(MAIN_BELL));
ok(near(SECOND_WATCH, 16.80),
  'second-account CSV lines are $15.00 + $0.75 + $1.05 = $16.80', money(SECOND_WATCH));
ok(near(BELL, 121.00),
  'undated Bell baseline is $104.20 + $16.80 = $121.00', money(BELL));
ok(near(BELL + WATCH_LINE_AGAIN, 136.00),
  'adding the $15 watch line again would be $136.00, not $121.00',
  money(BELL + WATCH_LINE_AGAIN));

const independent = BELL * HORIZON / DAYS_PER_MONTH;
ok(near(independent, BELL * 12 * HORIZON / 365.25),
  'horizon gravity is independently $121 × days / (365.25/12)',
  money(independent));

console.log('\n=== Forecast cash walk moves by exactly that independent amount ===');
const withBell = barePlan(BELL);
const withoutBell = barePlan(0);
const simBell = walk(withBell);
const simZero = walk(withoutBell);
const cashDelta = simZero.ending - simBell.ending;
ok(near(cashDelta, independent),
  'at weekly $0 over 365 days, currentMonthly $121 changes ending cash by the independent Bell total',
  `${money(cashDelta)} vs ${money(independent)}`);
ok(near(simBell.totals.reserved, independent) && near(simBell.totals.variable, 0),
  'the reserved amount is its own ledger total, not the weekly-cap variable column',
  money(simBell.totals.reserved));
ok(near(simZero.totals.reserved, 0) && near(simZero.totals.variable, 0),
  'zeroing currentMonthly removes that reserved spend');

{
  const weekDays = 7;
  const reservedPerWeek = BELL * weekDays / DAYS_PER_MONTH;
  const first = simBell.weeks[0];
  ok(near(first.variable, 0) && near(first.reserved, reservedPerWeek),
    'a weekly-cap of $0 leaves Budget at $0 while Reserved holds the independent Bell week',
    `${money(first.variable)} vs reserved ${money(first.reserved)}`);
  const implied = first.opening + first.confirmedIncome + first.estimatedIncome + first.injections
    - first.obligations - first.bills - first.commitments - first.variable - first.reserved - first.extra;
  ok(near(implied, first.closing, 0.02),
    'the week still reconciles once Reserved is its own outflow',
    `${money(implied)} vs ${money(first.closing)}`);
}

{
  const withCap = F.simulate(withBell, AS_OF, {
    weeklyVariable: 70, targetBuffer: 0, horizonDays: 14, viewDays: 14,
  });
  const reservedPerWeek = BELL * 7 / DAYS_PER_MONTH;
  ok(withCap.weeks.length === 2
    && withCap.weeks.every(w => near(w.variable, 70) && near(w.reserved, reservedPerWeek)),
    'Budget stays the selected weekly cap; Reserved is the independent Bell week',
    withCap.weeks.map(w => `${money(w.variable)} + ${money(w.reserved)}`).join(' | '));
  ok(withCap.weeks.every(w => w.variable + w.reserved > w.variable + 1),
    'the Budget column is not the cap plus the Bell reserve');
}

const end = F.addDays(AS_OF, HORIZON - 1);
const events = F.expandEvents(withBell, AS_OF, end, {});
ok(!events.some(e => e.kind === 'bill'),
  'no bill events — Bell is not a dated joint-cash bill');
ok(!events.some(e => /^(bell|telus|watch)/i.test(e.id)),
  'no Bell/watch/Telus obligation id is invented — no due date');
const travelPays = events.filter(e => e.id === 'travel' || e.id === 'travel-bell-payment');
ok(travelPays.length > 0 && travelPays.every(e => e.kind === 'obligation'),
  'Travel Visa minimum and the $250 payment remain card-payment obligations');
ok(!travelPays.some(e => near(Math.abs(e.amount), BELL)),
  'neither Travel Visa cash event is the $121 Bell baseline');

console.log('\n=== Travel Visa payment/minimum is not a second Bell expense ===');
const noTravelBell = walk(Object.assign(clone(withBell), { obligations: [] }));
const noTravelZero = walk(Object.assign(clone(withoutBell), { obligations: [] }));
ok(near(noTravelZero.ending - noTravelBell.ending, independent),
  'Bell gravity is the same when Travel Visa obligations are absent',
  money(noTravelZero.ending - noTravelBell.ending));
ok(near(simZero.ending - simBell.ending, independent),
  'and the same when both walks carry the $17 minimum and the $250 payment',
  money(simZero.ending - simBell.ending));

const debtBell = debtWalk(withBell);
const debtZero = debtWalk(withoutBell);
const travelBell = debtBell.byId.travelvisa;
const travelZero = debtZero.byId.travelvisa;
ok(near(travelBell.paid, travelZero.paid),
  'Travel Visa paid-down is unchanged by the Bell baseline',
  money(travelBell.paid));
ok(near(travelBell.capitalised || 0, 0) && near(travelZero.capitalised || 0, 0),
  'Bell is not capitalised onto Travel Visa');
ok(near(travelBell.balance, travelZero.balance),
  'Travel Visa projected balance is unchanged by the Bell baseline',
  money(travelBell.balance));

console.log('\n=== mutation: adding the $15 watch line again is not $121 ===');
const mutated = barePlan(BELL + WATCH_LINE_AGAIN);
const simMut = walk(mutated);
const mutDelta = simZero.ending - simMut.ending;
const mutIndependent = (BELL + WATCH_LINE_AGAIN) * HORIZON / DAYS_PER_MONTH;
ok(!near(mutDelta, independent),
  'adding the $15 watch line again does not still move Forecast by $121/month',
  money(mutDelta));
ok(near(mutDelta, mutIndependent),
  'it moves by the independent $136/month instead',
  money(mutDelta));

console.log('\n=== live plan: one $121 home, Q18 open, Telus $0, Travel Visa separate ===');
const questions = sourceText(fs.readFileSync(
  path.join(__dirname, 'docs/01_OPEN_QUESTIONS.md'), 'utf8'));
const q18 = /### Q18\.[\s\S]*?\*\*Status:\*\*\s*([^\n]+)/.exec(questions);
ok(q18 && /^OPEN\b/.test(q18[1].trim()),
  'Q18 remains OPEN for settlement state', q18 && q18[1].trim());
const telecom = (live.plan.budget.categories || []).find(c => c.id === 'telecom');
ok(telecom && telecom.currentMonthly === 121 && telecom.plannedMonthly == null,
  'live currentMonthly is $121.00, the one Bell amount');
ok(!(live.plan.bills || []).some(b => /bell|watch|telus/i.test(`${b.id} ${b.label}`)),
  'live plan.bills has no Bell, watch, or Telus row');
const travel = (live.plan.obligations || []).find(o => o.id === 'travel');
ok(travel && travel.debtId === 'travelvisa' && travel.effect === 'payment'
  && near(travel.amount, TRAVEL_MIN),
  'live Travel Visa minimum remains the $17 payment obligation',
  travel && money(travel.amount));
const travelDebt = (live.debts || []).find(d => d.id === 'travelvisa');
ok(travelDebt && near(travelDebt.pending, 0),
  'live Travel Visa pending remains $0.00 on this opening — the $250 is not replayed');

const liveAsOf = live.meta.asOf;
const liveHorizon = F.knowledgeHorizon(live.plan, liveAsOf, {}).days;
const liveZero = clone(live.plan);
liveZero.budget.categories = liveZero.budget.categories.map(c =>
  c.id === 'telecom' ? Object.assign({}, c, { currentMonthly: 0 }) : c);
const liveMut = clone(live.plan);
liveMut.budget.categories = liveMut.budget.categories.map(c =>
  c.id === 'telecom' ? Object.assign({}, c, { currentMonthly: BELL + WATCH_LINE_AGAIN }) : c);
const liveOpts = {
  weeklyVariable: 0, targetBuffer: 0,
  horizonDays: liveHorizon, viewDays: liveHorizon,
};
const liveBell = F.simulate(live.plan, liveAsOf, liveOpts);
const liveOff = F.simulate(liveZero, liveAsOf, liveOpts);
const liveWatch = F.simulate(liveMut, liveAsOf, liveOpts);
const liveIndependent = BELL * liveHorizon / DAYS_PER_MONTH;
ok(near(liveOff.ending - liveBell.ending, liveIndependent),
  'live plan: zeroing Bell currentMonthly lifts the knowledge-horizon walk by $121/month',
  money(liveOff.ending - liveBell.ending));
ok(!near(liveOff.ending - liveWatch.ending, liveIndependent),
  'live plan: adding the $15 watch line again is not the $121 identity');

console.log('\n=== partial-week slice reserved uses retained days, not a full week ===');
{
  const reservedDaily = BELL / DAYS_PER_MONTH;
  const oneDay = F.simulate(withBell, AS_OF, {
    weeklyVariable: 0, targetBuffer: 0, horizonDays: HORIZON, viewDays: 1,
  });
  const wantOne = reservedDaily * 1;
  const fullWeek = reservedDaily * 7;
  ok(oneDay.daily.length === 1 && oneDay.weeks.length === 1,
    'a 1-day as-of slice keeps one day and one truncated week');
  ok(oneDay.weeks[0].end === AS_OF,
    'the truncated week ends on the retained day, not the original week end',
    oneDay.weeks[0].end);
  ok(near(oneDay.weeks[0].reserved, wantOne),
    'the truncated week reserved is 1 independent Bell day, not 7',
    `${money(oneDay.weeks[0].reserved)} vs ${money(wantOne)}`);
  ok(near(oneDay.totals.reserved, wantOne) && !near(oneDay.totals.reserved, fullWeek),
    'the 1-day slice total is the retained-day identity, not a full-week amount',
    `${money(oneDay.totals.reserved)} vs ${money(wantOne)}`);

  const monthDays = 30;
  const monthSlice = F.simulate(withBell, AS_OF, {
    weeklyVariable: 0, targetBuffer: 0, horizonDays: HORIZON, viewDays: monthDays,
  });
  const truncated = monthSlice.weeks[monthSlice.weeks.length - 1];
  const retained = monthSlice.daily.filter(d => d.date >= truncated.start && d.date <= truncated.end).length;
  ok(monthSlice.daily.length === monthDays && retained > 0 && retained < 7,
    'a 30-day slice ends on a partial week',
    String(retained));
  ok(near(truncated.reserved, reservedDaily * retained),
    'that partial week reserved uses the retained day count',
    `${money(truncated.reserved)} vs ${money(reservedDaily * retained)}`);
  ok(near(monthSlice.totals.reserved, reservedDaily * monthDays)
    && !near(monthSlice.totals.reserved, reservedDaily * 7 * monthSlice.weeks.length),
    'the 30-day reserved total is 30 independent days, not five full weeks',
    `${money(monthSlice.totals.reserved)} vs ${money(reservedDaily * monthDays)}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
