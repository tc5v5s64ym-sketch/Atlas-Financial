'use strict';
/* Unresolved once cash obligations remain binding when Forecast start
 * advances past the placeholder date used to reserve them.
 *
 * Independent proof: plan-row presence, posting-unknown observations,
 * hand addition of named amounts, nextDue/nextPaymentOut schedule identity
 * across starts, and a mutant that restores window-only once outflows.
 * That is not a second call to onceOutflowDates.
 *
 * Does not write data.json. Does not call Lunch Money. Does not move the
 * canonical opening. Posted refresh remains a B81 preview/approve write,
 * not a new cutover — proved by the existing test-b81-refresh.js suite.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const live = require('./data.json');
const posting = require('./docs/reconciliation/posting-observations.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const clone = x => JSON.parse(JSON.stringify(x));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const DATA = path.join(__dirname, 'data.json');
const hashBefore = hashFile(DATA);

const OPENING = '2026-08-16';
const LATER = '2026-08-18';
const OWED = 100;
const CASH = 2000;
const BUFFER = 0;
const PAYROLL = 1000;
const MORTGAGE = 200;
const OTHER_BILL = 50;
const WINDOW = 91;

function independentlyOnceOutflowDates(item, start, end) {
  if (!item || item.frequency !== 'once' || !item.date) return [];
  if (item.date > end) return [];
  if (item.date >= start) return [item.date];
  if (item.nonCash) return [];
  return [item.date];
}

function windowEnd(start) {
  return F.addDays(start, WINDOW - 1);
}

function recOpts(extra) {
  return Object.assign({
    scenario: 'expected',
    incomeOverrides: {},
    disabled: [],
    extraDebtMonthly: 0,
    targetBuffer: BUFFER,
  }, extra || {});
}

function owedPlan(extra) {
  return Object.assign({
    windowDays: WINDOW,
    defaults: { targetBuffer: BUFFER },
    startingCash: { amount: CASH },
    income: [{
      id: 'payroll',
      label: 'Payroll',
      frequency: 'biweekly',
      anchor: '2026-08-14',
      amount: PAYROLL,
      confidence: 'confirmed',
    }],
    obligations: [],
    bills: [{
      id: 'owed',
      label: 'Unresolved once obligation',
      frequency: 'once',
      date: OPENING,
      amount: OWED,
      confidence: 'confirmed',
    }],
    commitments: [],
  }, extra || {});
}

function cutoverFixture() {
  const asOf = '2026-08-14';
  return {
    windowDays: 28,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 800 },
    opening: {
      asOf,
      representedEvents: [{ id: 'payroll', date: asOf }],
    },
    income: [{
      id: 'payroll',
      label: 'Payroll',
      frequency: 'biweekly',
      anchor: asOf,
      amount: PAYROLL,
      confidence: 'confirmed',
    }],
    obligations: [{
      id: 'mortgage',
      label: 'Mortgage',
      frequency: 'biweekly',
      anchor: asOf,
      amount: MORTGAGE,
      confidence: 'confirmed',
    }],
    bills: [{
      id: 'other-same-day',
      label: 'Unsettled same-day bill',
      frequency: 'once',
      date: asOf,
      amount: OTHER_BILL,
      confidence: 'confirmed',
    }],
    commitments: [],
  };
}

function reservedAmount(events, id) {
  const hit = (events || []).find(e => e.id === id);
  return hit ? -hit.amount : 0;
}

console.log('=== CASE 1 — unresolved once obligation at opening ===');
{
  const plan = owedPlan();
  const end = windowEnd(OPENING);
  const independentDates = independentlyOnceOutflowDates(plan.bills[0], OPENING, end);
  ok(independentDates.length === 1 && independentDates[0] === OPENING,
    'independent rule: the once date is this opening');
  ok(F.occurrences(plan.bills[0], OPENING, end)[0] === OPENING,
    'cadence occurrences still names the declared date inside the window');
  const events = F.expandEvents(plan, OPENING, end, {});
  ok(events.some(e => e.id === 'owed' && e.date === OPENING && near(e.amount, -OWED)),
    'Forecast reserves $100.00 on 2026-08-16');
  const sim = F.simulate(plan, OPENING, { weeklyVariable: 0, targetBuffer: BUFFER });
  ok(near(sim.daily[0].balance, CASH - OWED),
    'day-0 close is opening cash minus the unresolved $100',
    money(sim.daily[0].balance));
}

console.log('\n=== CASE 2 — merely advance opening; obligation still binds ===');
{
  const plan = owedPlan();
  const end = windowEnd(LATER);
  ok(plan.bills[0].date < LATER, 'the declared reservation date is now before Forecast start');
  ok(F.occurrences(plan.bills[0], LATER, end).length === 0,
    'cadence occurrences does not invent a new due date on 2026-08-18');
  const independentDates = independentlyOnceOutflowDates(plan.bills[0], LATER, end);
  ok(independentDates.length === 1 && independentDates[0] === OPENING,
    'independent rule: the unresolved outflow keeps its scheduled date');
  const events = F.expandEvents(plan, LATER, end, {});
  ok(events.some(e => e.id === 'owed' && e.date === OPENING && near(e.amount, -OWED)),
    'Forecast still reserves $100.00 after start moves to 2026-08-18');
  ok(!events.some(e => e.id === 'owed' && e.date === LATER),
    'the same canonical row does not acquire 2026-08-18 as a new due date');
  const sim = F.simulate(plan, LATER, { weeklyVariable: 0, targetBuffer: BUFFER });
  ok(near(sim.daily[0].balance, CASH - OWED),
    'day-0 close still deducts the unresolved $100',
    money(sim.daily[0].balance));
  ok(!near(sim.daily[0].balance, CASH),
    'the $100 did not disappear into the opening cash');
}

console.log('\n=== CASE 3 — representing the new start is not a rewritten due date ===');
{
  const plan = owedPlan();
  const end = windowEnd(LATER);
  const events = F.expandEvents(plan, LATER, end, {
    representedEvents: [{ id: 'owed', date: LATER }],
  });
  ok(events.some(e => e.id === 'owed' && e.date === OPENING),
    'representedEvents on the later start does not suppress a past scheduled date');
  const sim = F.simulate(plan, LATER, {
    weeklyVariable: 0,
    targetBuffer: BUFFER,
    representedEvents: [{ id: 'owed', date: LATER }],
  });
  ok(near(sim.daily[0].balance, CASH - OWED),
    'cash still deducts the unresolved $100; representing start is not settlement',
    money(sim.daily[0].balance));
}

console.log('\n=== CASE 4 — ordinary historical once items do not become eternal ===');
{
  const start = LATER;
  const end = windowEnd(start);
  const plan = owedPlan({
    income: [
      {
        id: 'old-pay',
        label: 'Historical once income',
        frequency: 'once',
        date: '2026-08-01',
        amount: 500,
        confidence: 'confirmed',
      },
      {
        id: 'payroll',
        label: 'Payroll',
        frequency: 'biweekly',
        anchor: '2026-08-14',
        amount: PAYROLL,
        confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'monthly-bill',
        label: 'Recurring bill',
        frequency: 'monthly',
        day: 15,
        firstDue: '2026-09-15',
        amount: 80,
        confidence: 'confirmed',
      },
    ],
    commitments: [{
      id: 'paid-camp',
      date: '2026-08-12',
      label: 'Settled commitment',
      amount: 786,
      confidence: 'confirmed',
      settledOn: '2026-08-14',
    }],
  });
  const events = F.expandEvents(plan, start, end, {});
  ok(!events.some(e => e.id === 'old-pay'),
    'historical once income dated before start does not replay');
  ok(!events.some(e => e.id === 'monthly-bill' && e.date < '2026-09-15'),
    'firstDue keeps the August occurrence off the schedule — no leftover once row');
  ok(events.some(e => e.id === 'monthly-bill' && e.date === '2026-09-15'),
    'the recurring bill still fires on its next declared date');
  ok(!events.some(e => e.id === 'paid-camp'),
    'a commitment with settledOn on or before start does not reserve again');
  ok(!events.some(e => e.id === 'owed'),
    'a once outflow that is no longer on the plan does not fire');
}

console.log('\n=== CASE 5 — existing same-day represented payroll cutover remains ===');
{
  const plan = cutoverFixture();
  const asOf = plan.opening.asOf;
  const end = F.addDays(asOf, 27);
  const nextPayroll = F.addDays(asOf, 14);
  const events = F.expandEvents(plan, asOf, end, {});
  ok(!events.some(e => e.id === 'payroll' && e.date === asOf),
    'represented payroll does not replay');
  ok(events.some(e => e.id === 'mortgage' && e.date === asOf && near(e.amount, -MORTGAGE)),
    'unrepresented mortgage still fires');
  ok(events.some(e => e.id === 'other-same-day' && e.date === asOf && near(e.amount, -OTHER_BILL)),
    'unrelated same-day bill still fires');
  ok(events.some(e => e.id === 'payroll' && e.date === nextPayroll && near(e.amount, PAYROLL)),
    'next payroll still fires');
}

console.log('\n=== CASE 6 — live B91 unknown mid-month arithmetic still binds on Aug. 18 ===');
{
  ok(live.meta.asOf === OPENING && live.plan.opening.asOf === OPENING,
    'canonical opening remains 2026-08-16 — this test does not move it');
  ok(Array.isArray(live.plan.opening.representedEvents)
    && live.plan.opening.representedEvents.length === 0,
    'live representedEvents stay empty');
  const unknownPosting = posting.observations.filter(o => o.unknown === true);
  ok(unknownPosting.length >= 4,
    'posting observations still record at least four UNKNOWN items');
  const reservedRows = (live.plan.bills || []).filter(b =>
    b.frequency === 'once' && b.date === OPENING);
  ok(reservedRows.length === 4, 'four once bills remain reserved on the published opening');
  const independent = 82.96 + 99.91 + 100 + 25;
  ok(near(independent, 307.87), 'independent 82.96 + 99.91 + 100.00 + 25.00 = 307.87');
  const fromRows = reservedRows.reduce((s, b) => s + Number(b.amount), 0);
  ok(near(fromRows, independent),
    'live once-row amounts independently total $307.87', money(fromRows));
  const laterEvents = F.expandEvents(live.plan, LATER, windowEnd(LATER), {});
  const laterReserved = laterEvents.filter(e => reservedRows.some(b => b.id === e.id));
  ok(laterReserved.length === 4,
    'all four unresolved live rows still emit at a 2026-08-18 diagnostic start');
  const laterTotal = laterReserved.reduce((s, e) => s + (-e.amount), 0);
  ok(near(laterTotal, independent),
    'Forecast still reserves $307.87 when posting remains UNKNOWN',
    money(laterTotal));
  ok(laterReserved.every(e => e.date === OPENING),
    'the live reservation keeps 2026-08-16, not a rewritten diagnostic opening');
  const openingEvents = F.expandEvents(live.plan, OPENING, windowEnd(OPENING), {});
  const openingTotal = openingEvents.filter(e => reservedRows.some(b => b.id === e.id))
    .reduce((s, e) => s + (-e.amount), 0);
  ok(near(openingTotal, independent),
    'the published 2026-08-16 path still reserves the same $307.87');
}

console.log('\n=== CASE 7 — advancing start alone must not manufacture weekly capacity ===');
{
  const withOwed = owedPlan();
  const withoutOwed = owedPlan({ bills: [] });
  const recOpen = F.recommend(withOwed, OPENING, recOpts());
  const recLater = F.recommend(withOwed, LATER, recOpts());
  const recDropped = F.recommend(withoutOwed, LATER, recOpts());
  ok(typeof recLater.weekly === 'number' && recLater.weekly >= 0,
    'later start still produces a weekly figure', String(recLater.weekly));
  ok(reservedAmount(recLater.sim.events, 'owed') === OWED,
    'the later recommendation walk still contains the $100 obligation');
  ok(reservedAmount(recDropped.sim.events, 'owed') === 0,
    'removing the row is the settlement path — that walk has no $100');
  ok(recDropped.weekly > recLater.weekly,
    'dropping the obligation is what raises the recommendation',
    `${money(recLater.weekly)}/week with it vs ${money(recDropped.weekly)}/week without`);
  const liftFromDropping = recDropped.weekly - recLater.weekly;
  ok(liftFromDropping > 0,
    'the manufactured capacity is the missing obligation, not new household income',
    money(liftFromDropping) + '/week');
  ok(recLater.weekly <= recOpen.weekly + 0.005
    || reservedAmount(recOpen.sim.events, 'owed') === OWED,
    'the published-style opening also reserved the $100; later start does not free it');
  const owedOpen = recOpen.sim.events.find(e => e.id === 'owed');
  const owedLater = recLater.sim.events.find(e => e.id === 'owed');
  ok(owedOpen && owedLater && owedOpen.date === OPENING && owedLater.date === OPENING,
    'recommend walks keep the same scheduled date for both starts');
}

console.log('\n=== CASE 8 — nextDue / nextPaymentOut keep the scheduled date ===');
{
  const plan = owedPlan();
  const third = '2026-08-19';
  const openEvents = F.expandEvents(plan, OPENING, windowEnd(OPENING), {});
  const laterEvents = F.expandEvents(plan, LATER, windowEnd(LATER), {});
  const thirdEvents = F.expandEvents(plan, third, windowEnd(third), {});
  const dates = [openEvents, laterEvents, thirdEvents]
    .map(ev => (ev.find(e => e.id === 'owed') || {}).date);
  ok(dates.every(d => d === OPENING),
    'the same canonical row keeps 2026-08-16 for starts 16, 18, and 19',
    dates.join(', '));
  const dueOpen = F.nextDue(openEvents, OPENING);
  const dueLater = F.nextDue(laterEvents, LATER);
  const outOpen = F.nextPaymentOut(openEvents, OPENING);
  const outLater = F.nextPaymentOut(laterEvents, LATER);
  ok(dueOpen && dueOpen.due === OPENING && dueOpen.what === 'Unresolved once obligation',
    'nextDue names the obligation on its scheduled date at the original start');
  ok(outOpen && outOpen.date === OPENING && near(outOpen.amount, OWED),
    'nextPaymentOut on the original start is that same scheduled cash-out');
  ok(!(dueLater && dueLater.due === LATER && dueLater.what === 'Unresolved once obligation'),
    'nextDue does not present the overdue item as newly due on 2026-08-18');
  ok(!(outLater && outLater.date === LATER && /Unresolved once obligation/.test(outLater.label)),
    'nextPaymentOut does not move the overdue cash-out onto the later start');
  ok(!dueLater || dueLater.due >= LATER,
    'any later nextDue is on or after the later start, not a rewritten past date');
  const simLater = F.simulate(plan, LATER, { weeklyVariable: 0, targetBuffer: BUFFER });
  ok(near(simLater.daily[0].balance, CASH - OWED),
    'the later cash walk still deducts $100 without renaming the due date',
    money(simLater.daily[0].balance));
  ok(simLater.events.some(e => e.id === 'owed' && e.date === OPENING),
    'that walk still carries the original scheduled date');
}

console.log('\n=== CASE 9 — historical once non-cash is not recapitalised ===');
{
  const CHARGE = 50;
  const OPENING_DEBT = 1000;
  const plan = owedPlan({
    bills: [],
    obligations: [{
      id: 'old-charge',
      label: 'Historical capitalised charge',
      frequency: 'once',
      date: OPENING,
      amount: CHARGE,
      nonCash: true,
      effect: 'capitalise',
      debtId: 'heloc',
      confidence: 'confirmed',
    }],
  });
  const laterEvents = F.expandEvents(plan, LATER, windowEnd(LATER), {});
  ok(!laterEvents.some(e => e.id === 'old-charge'),
    'a historical once non-cash obligation does not replay after start advances');
  const debts = [{
    id: 'heloc', label: 'HELOC', balance: OPENING_DEBT, rate: 0, annualInterest: 0,
    limit: 5000, pending: 0, secured: true, confidence: 'confirmed',
  }];
  const proj = F.projectDebts(plan, debts, LATER, {});
  const heloc = proj.byId && proj.byId.heloc;
  ok(heloc && near(heloc.balance, OPENING_DEBT),
    'ending debt is unchanged — the historical charge is not capitalised again',
    heloc ? money(heloc.balance) : 'missing');
  ok(heloc && near(heloc.opening, OPENING_DEBT) && near(heloc.capitalised || 0, 0),
    'opening debt was not grown by a replayed once charge');
  const laterDue = F.nextDue(laterEvents, LATER);
  ok(!(laterDue && /Historical capitalised/.test(laterDue.what)),
    'nextDue does not name the historical non-cash charge');
}

console.log('\n=== mutation: window-only once outflows recreate the defect ===');
{
  const src = sourceText(fs.readFileSync(path.join(__dirname, 'public', 'forecast.js'), 'utf8'));
  const from = '    if (item.nonCash) return [];\n    return [item.date];';
  const to = '    if (item.nonCash) return [];\n    return [];';
  ok(src.split(from).length - 1 === 1,
    'the keep-scheduled-date return appears once, so the mutation is aimed');
  const sandbox = { module: { exports: {} } };
  try {
    vm.runInNewContext(src.replace(from, to), sandbox, { filename: 'forecast-mutant.js' });
  } catch (err) {
    ok(false, 'mutant engine loads', err.message);
  }
  const mutant = sandbox.module.exports;
  const plan = owedPlan();
  const mutantEvents = mutant.expandEvents(plan, LATER, windowEnd(LATER), {});
  ok(!mutantEvents.some(e => e.id === 'owed'),
    'window-only once semantics drop the unresolved $100 at a later start');
  const real = F.recommend(plan, LATER, recOpts());
  const broken = mutant.recommend(plan, LATER, recOpts());
  ok(broken.weekly > real.weekly,
    'that drop manufactures a higher weekly recommendation',
    `${money(real.weekly)}/week real vs ${money(broken.weekly)}/week mutant`);
}

console.log('\n=== live data.json hash is unchanged ===');
{
  const hashAfter = hashFile(DATA);
  ok(hashAfter === hashBefore, 'data.json SHA-256 is unchanged');
  ok(live.meta.asOf === OPENING && live.plan.opening.asOf === OPENING,
    'canonical as-of was not rewritten as a new cutover');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
