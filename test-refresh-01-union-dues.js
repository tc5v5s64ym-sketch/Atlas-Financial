'use strict';

// AF-REFRESH-01 — retire the cancelled CMAW recurrence.
// Independent of Forecast.monthlyDates / recommend: calendar 15ths are
// enumerated here; historical actuals are read from periods.json and from
// the pre-change main snapshot; settlement traces to posting-observations,
// not to the recurrence edit.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Forecast = require('./public/forecast.js');
const icsMod = require('./scripts/calendar-ics.js');

const ROOT = __dirname;
const BEFORE_SHA = '14296286cde64ab35cf577d5055766a67b56fc12';
const DATA_PATH = path.join(ROOT, 'data.json');
const PERIODS_PATH = path.join(ROOT, 'public/periods.json');
const POSTING_PATH = path.join(ROOT, 'docs/reconciliation/posting-observations.json');
const FACTS_PATH = path.join(ROOT, 'docs/ACCOUNT_FACTS.md');
const REFRESH_JS = path.join(ROOT, 'scripts/canonical-refresh.js');
const LIVE_JS = path.join(ROOT, 'scripts/live-plan.js');

let failures = 0;
function ok(condition, label, detail) {
  if (condition) {
    console.log('\x1b[32m✓\x1b[0m ' + label);
    return;
  }
  failures += 1;
  console.log('\x1b[31m✗\x1b[0m ' + label + (detail ? ' — ' + detail : ''));
}
function near(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.005;
}
function load(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function gitShow(shaPath) {
  return JSON.parse(execFileSync('git', ['show', shaPath], {
    cwd: ROOT, encoding: 'utf8',
  }));
}
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function pad(n) { return String(n).padStart(2, '0'); }
function monthlyFifteenths(startIso, endIso) {
  const out = [];
  let [year, month] = startIso.split('-').map(Number);
  for (;;) {
    const iso = year + '-' + pad(month) + '-' + pad(Math.min(15, daysInMonth(year, month)));
    if (iso > endIso) break;
    if (iso >= startIso) out.push(iso);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

const data = load(DATA_PATH);
const before = gitShow(BEFORE_SHA + ':data.json');
const periods = load(PERIODS_PATH);
const beforePeriods = gitShow(BEFORE_SHA + ':public/periods.json');
const posting = load(POSTING_PATH);
const facts = fs.readFileSync(FACTS_PATH, 'utf8');
const plan = data.plan;
const asOf = data.meta.asOf;
const outstandingId = 'uniondues-aug15-outstanding';

console.log('=== cancellation authority is the recorded owner statement ===');
ok(/owner-confirmed 2026-08-24/i.test(facts)
    && /recurring \$25\/month payment cancelled/i.test(facts),
  'ACCOUNT_FACTS records owner-confirmed 2026-08-24 cancellation');
ok(!(plan.bills || []).some(bill => bill.id === 'uniondues'),
  'canonical plan no longer carries a monthly uniondues bill');
const outstanding = (plan.bills || []).find(bill => bill.id === outstandingId);
ok(outstanding && outstanding.frequency === 'once' && outstanding.date === '2026-08-16'
    && near(outstanding.amount, 25) && outstanding.confidence === 'confirmed',
  'the 15 August posting-unknown once row remains $25 on 2026-08-16');
const cancel = (plan.actions || []).find(action => /CMAW Local 1995/i.test(action.what));
ok(cancel && cancel.status === 'done',
  'the cancel-dues action is done rather than left open');

console.log('\n=== independently enumerated 15ths are not future CMAW obligations ===');
const unauthorizedFifteenths = monthlyFifteenths('2026-09-15', '2027-08-15');
ok(unauthorizedFifteenths.length === 12
    && unauthorizedFifteenths[0] === '2026-09-15'
    && unauthorizedFifteenths[11] === '2027-08-15',
  'independent calendar lists twelve 15ths from September 2026 through August 2027',
  unauthorizedFifteenths.join(','));
ok(near(unauthorizedFifteenths.length * 25, 300),
  'independent unauthorized recurrence total is 12 × $25 = $300');
const horizonEvents = Forecast.expandEvents(plan, asOf, '2027-08-15', {});
const cmawEvents = horizonEvents.filter(event => event.id === 'uniondues'
  || event.id === outstandingId
  || /cmaw|union dues/i.test(event.label || ''));
ok(!cmawEvents.some(event => event.id === 'uniondues'),
  'Forecast expansion emits no monthly uniondues events',
  cmawEvents.map(event => event.id + '@' + event.date).join(','));
ok(!unauthorizedFifteenths.some(iso => cmawEvents.some(event => event.date === iso
      && near(-event.amount, 25))),
  'none of the independently listed 15ths is a $25 CMAW cash event');
ok(cmawEvents.length === 1 && cmawEvents[0].id === outstandingId
    && cmawEvents[0].date === '2026-08-16' && near(cmawEvents[0].amount, -25),
  'the only remaining CMAW cash event is the reserved August occurrence');
const ics = icsMod.buildHouseholdCalendar(plan, asOf, icsMod.ICS_HORIZON_END);
ok(!(ics.payments || []).some(payment => payment.sourceId === 'uniondues'),
  'ICS payment VEVENTs do not expand a monthly CMAW recurrence');

console.log('\n=== historical Union dues actuals are unchanged ===');
function unionTotal(source, bucket) {
  return ((source.periods[bucket] || {}).spending || [])
    .find(row => row.label === 'Union dues');
}
const beforeUnion = {
  thisMonth: unionTotal(beforePeriods, 'thisMonth'),
  lastMonth: unionTotal(beforePeriods, 'lastMonth'),
  ytd: unionTotal(beforePeriods, 'ytd'),
  all: unionTotal(beforePeriods, 'all'),
};
const afterUnion = {
  thisMonth: unionTotal(periods, 'thisMonth'),
  lastMonth: unionTotal(periods, 'lastMonth'),
  ytd: unionTotal(periods, 'ytd'),
  all: unionTotal(periods, 'all'),
};
ok(near(beforeUnion.thisMonth.total, 25) && near(afterUnion.thisMonth.total, 25)
    && near(beforeUnion.lastMonth.total, 25) && near(afterUnion.lastMonth.total, 25)
    && near(beforeUnion.ytd.total, 200) && near(afterUnion.ytd.total, 200)
    && near(beforeUnion.all.total, 475) && near(afterUnion.all.total, 475),
  'periods.json Union dues thisMonth $25 / lastMonth $25 / YTD $200 / all $475 are unchanged');
ok(JSON.stringify(beforePeriods.periods.thisMonth.spending.find(s => s.label === 'Union dues'))
    === JSON.stringify(afterUnion.thisMonth),
  'August historical Union dues row is byte-identical to pre-change main');
ok(JSON.stringify(beforePeriods) === JSON.stringify(periods),
  'the historical actuals file as a whole is unchanged');

console.log('\n=== current-cycle settlement traces to posting evidence, not cancellation ===');
const postingRow = (posting.observations || [])
  .find(row => row.observationId === 'payday-uniondues-posting-unknown');
ok(postingRow && postingRow.unknown === true && postingRow.posted !== true
    && postingRow.scheduledDate === '2026-08-15',
  'incumbent posting observation still records 15 August CMAW as unknown');
ok(!(plan.opening.representedEvents || [])
    .some(row => row.id === 'uniondues' || row.id === outstandingId),
  'representedEvents still does not claim the August occurrence posted');
ok(/posting remains unknown/i.test(outstanding.note)
    && /cancellation is not settlement/i.test(outstanding.note),
  'the once-row note refuses to treat cancellation as settlement');
ok(near(afterUnion.thisMonth.total, 25) && postingRow.unknown === true,
  'August historical $25 actuals exist and still do not settle the Forecast row');

console.log('\n=== no unrelated obligation or household policy changed ===');
function billKey(bill) {
  return JSON.stringify({
    id: bill.id,
    label: bill.label,
    frequency: bill.frequency,
    day: bill.day,
    amount: bill.amount,
    date: bill.date,
    firstDue: bill.firstDue,
    anchor: bill.anchor,
    confidence: bill.confidence,
    budgetCategory: bill.budgetCategory,
    householdObligation: bill.householdObligation,
    payingAccount: bill.payingAccount,
  });
}
const beforeOther = (before.plan.bills || [])
  .filter(bill => bill.id !== 'uniondues' && bill.id !== outstandingId)
  .map(billKey);
const afterById = new Map((plan.bills || [])
  .filter(bill => bill.id !== outstandingId)
  .map(bill => [bill.id, billKey(bill)]));
ok(beforeOther.every(key => {
  const id = JSON.parse(key).id;
  return afterById.get(id) === key;
}),
  'every pre-existing non-CMAW bill identity/amount/cadence is unchanged');
ok(JSON.stringify(before.plan.obligations) === JSON.stringify(plan.obligations),
  'plan.obligations are unchanged');
ok(JSON.stringify(before.plan.commitments) === JSON.stringify(plan.commitments),
  'plan.commitments are unchanged');
ok(JSON.stringify(before.plan.income) === JSON.stringify(plan.income),
  'plan.income is unchanged');
ok(JSON.stringify(before.debts) === JSON.stringify(data.debts),
  'debt openings are unchanged');
ok(JSON.stringify(before.plan.startingCash) === JSON.stringify(plan.startingCash),
  'starting cash is unchanged');
ok(JSON.stringify(before.plan.nextDollar) === JSON.stringify(plan.nextDollar),
  'surplus-debt policy is unchanged');

console.log('\n=== Forecast consumes the canonical plan; refresh code does not calculate it ===');
ok(!/CMAW|uniondues/.test(fs.readFileSync(REFRESH_JS, 'utf8')),
  'canonical-refresh.js does not special-case CMAW or calculate a dues answer');
ok(!/CMAW|uniondues/.test(fs.readFileSync(LIVE_JS, 'utf8')),
  'live-plan.js does not special-case CMAW or calculate a dues answer');
const beforeHorizon = Forecast.expandEvents(before.plan, before.meta.asOf, '2027-08-15', {})
  .filter(event => event.id === 'uniondues');
ok(beforeHorizon.length === 12
    && beforeHorizon.every(event => near(-event.amount, 25) && event.date >= '2026-09-15'),
  'pre-change main still expands twelve monthly $25 CMAW events from firstDue 2026-09-15',
  String(beforeHorizon.length));
ok(beforeHorizon.length * 25 === unauthorizedFifteenths.length * 25,
  'removed future cash equals the independently enumerated 15ths × $25');

if (failures) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nAF-REFRESH-01 union-dues proofs passed.');
