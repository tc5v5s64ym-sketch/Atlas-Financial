'use strict';
/* B74 — one household cash schedule. `node test-schedule-authority.js`
 *
 * Protects the architecture, not the ICS renderer: Plan facts expand through
 * Forecast.expandEvents and every consumer (Plan calendar stream, nextDue,
 * nextPaymentOut, ICS payment VEVENTs) must follow. Reminders stay outside
 * that cash stream. A hardcoded conflicting payment must fail.
 */
const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');
const data = require('./data.json');
const icsMod = require('./scripts/calendar-ics.js');
const { burrardDue } = require('./test-helpers');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = x => JSON.parse(JSON.stringify(x));
const cents = n => Math.round(Number(n) * 100);
const same = (a, b) => cents(a) === cents(b);
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const plan = data.plan;
const asOf = data.meta.asOf;
const windowEnd = F.addDays(asOf, (plan.windowDays || 91) - 1);
const icsEnd = icsMod.ICS_HORIZON_END;

function cashEvents(p, start, end) {
  return F.expandEvents(p, start, end)
    .filter(e => e.amount < 0 && e.kind !== 'noncash' && e.jointCash !== false);
}
function paymentKey(date, id, amount) {
  return `${date}|${id}|${cents(amount)}`;
}
function icsPaymentKeys(built) {
  return new Set(built.payments.map(p => paymentKey(p.start, p.sourceId, p.amount)));
}
function streamPaymentKeys(events) {
  return new Set(events.map(e => paymentKey(e.date, e.id, -e.amount)));
}

console.log('=== single authority: a Plan edit moves every consumer ===');
{
  const base = cashEvents(plan, asOf, windowEnd);
  const baseIcs = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const edited = clone(plan);
  const bcaa = edited.bills.find(b => b.id === 'bcaa');
  ok(!!bcaa && bcaa.amount === 82.96 && bcaa.day === 15, 'BCAA is a canonical Plan bill');
  bcaa.amount = 199.99;
  bcaa.day = 18;
  const moved = cashEvents(edited, asOf, windowEnd).filter(e => e.id === 'bcaa');
  const movedIcs = icsMod.buildHouseholdCalendar(edited, asOf, icsEnd);
  const icsBcaa = movedIcs.payments.filter(p => p.sourceId === 'bcaa');
  ok(moved.length > 0 && moved.every(e => e.date.endsWith('-18') && same(-e.amount, 199.99)),
    'expandEvents follows the new BCAA day and amount',
    moved.map(e => `${e.date} ${-e.amount}`).join(', '));
  ok(icsBcaa.length === movedIcs.payments.filter(p => p.sourceId === 'bcaa').length
    && icsBcaa.every(p => p.start.endsWith('-18') && same(p.amount, 199.99)),
    'ICS payment VEVENTs follow the same Plan edit',
    icsBcaa.map(p => `${p.start} ${p.amount}`).join(', '));
  ok(base.filter(e => e.id === 'bcaa').every(e => e.date.endsWith('-15')),
    'the unedited Plan still lands BCAA on the 15th');
  ok(baseIcs.payments.filter(p => p.sourceId === 'bcaa').every(p => p.start.endsWith('-15')),
    'and the unedited ICS still does');

  // A date that has only the edited bill as its cash-out must move both
  // look-aheads. Invent a one-off so nothing else shares the day.
  edited.bills = (edited.bills || []).filter(b => !/aug15-outstanding/.test(b.id));
  const probeDate = asOf;
  edited.commitments.push({
    id: 'authority-probe', date: probeDate, label: 'Authority probe',
    amount: 12.34, confidence: 'confirmed',
  });
  const probeStream = F.expandEvents(edited, asOf, windowEnd);
  const due = F.nextDue(probeStream, asOf);
  const out = F.nextPaymentOut(probeStream, asOf);
  ok(due && due.what === 'Authority probe' && due.due === probeDate && same(due.amount, 12.34),
    'nextDue follows a new canonical commitment',
    due ? `${due.what} ${due.due} $${due.amount}` : 'none');
  ok(out && out.date === probeDate && same(out.amount, 12.34),
    'nextPaymentOut follows that same commitment',
    out ? `${out.date} $${out.amount}` : 'none');
}

console.log('\n=== ICS payments bijection with expandEvents ===');
{
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const stream = cashEvents(plan, asOf, icsEnd);
  const fromIcs = icsPaymentKeys(built);
  const fromStream = streamPaymentKeys(stream);
  const missing = [...fromStream].filter(k => !fromIcs.has(k));
  const extra = [...fromIcs].filter(k => !fromStream.has(k));
  ok(missing.length === 0,
    'every canonical cash event has an ICS payment VEVENT',
    missing.slice(0, 5).join(', ') || `${fromStream.size} matched`);
  ok(extra.length === 0,
    'every ICS payment VEVENT is a canonical cash event',
    extra.slice(0, 5).join(', ') || `${fromIcs.size} matched`);
  ok(built.payments.every(p => p.kind === 'payment'),
    'derived payment entries are tagged payment');
  ok(built.reminders.some(r => r.sourceId === 'hydro-due-sep1'
      && /not joint cash/i.test(r.summary)),
    'Hydro Sept. 1 is an ICS reminder, not a joint-cash payment');
  ok(!built.payments.some(p => p.sourceId === 'hydro-due-sep1'),
    'Hydro Sept. 1 has no ICS payment VEVENT');
}

console.log('\n=== reminder separation ===');
{
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const stream = F.expandEvents(plan, asOf, icsEnd);
  const cashIds = new Set(stream.filter(e => e.amount < 0 && e.kind !== 'noncash').map(e => e.id + '@' + e.date));
  ok(built.reminders.length > 0, 'standing reminders remain');
  ok(built.reminders.every(r => r.kind === 'reminder'),
    'reminder entries are tagged reminder, not payment');
  ok(built.reminders.every(r => /Reminder —/.test(r.summary) || /statement closes/i.test(r.summary)),
    'reminder summaries cannot be read as chequing outflows');
  const stmt = built.reminders.filter(r => /statement closes/i.test(r.summary));
  ok(stmt.length === 5, 'five statement-close reminders remain', String(stmt.length));
  ok(built.reminders.some(r => /property tax/i.test(r.summary)),
    'the annual property-tax reminder remains');
  ok(built.reminders.some(r => /CRA/i.test(r.summary)),
    'the annual CRA reminder remains');
  ok(built.reminders.some(r => /MORTGAGE MATURES/i.test(r.summary)),
    'the mortgage-maturity reminder remains');
  ok(stmt.every(r => !cashIds.has((r.sourceId || '') + '@' + r.start)),
    'statement-close reminders are not household cash events');
  ok(!stream.some(e => /statement closes/i.test(e.label)),
    'expandEvents does not emit statement-close cash events');
}

console.log('\n=== RESP joins the real cash path exactly once ===');
{
  const respBill = plan.bills.find(b => b.id === 'resp');
  ok(!!respBill && same(respBill.amount, 100) && respBill.day === 15
    && respBill.frequency === 'monthly' && respBill.budgetCategory === null,
    'RESP is a canonical $100 monthly bill on the 15th, not a spending category');
  const windowStream = F.expandEvents(plan, asOf, windowEnd);
  const resp = windowStream.filter(e => e.id === 'resp' || e.id === 'resp-aug15-outstanding');
  ok(resp.some(e => e.id === 'resp-aug15-outstanding' && e.date <= asOf),
    'the unposted 15 August RESP is reserved on this opening');
  ok(resp.filter(e => e.id === 'resp').every(e => e.date >= '2026-09-15'),
    'the monthly RESP resumes in September',
    resp.filter(e => e.id === 'resp').map(e => e.date).join(','));
  ok(resp.every(e => same(-e.amount, 100) && e.kind === 'bill'),
    'each is a $100 bill, not a special-case kind');
  const ids = resp.map(e => e.id + '@' + e.date);
  ok(new Set(ids).size === ids.length && ids.length === resp.length,
    'RESP is not double-counted in the event stream');
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const icsResp = built.payments.filter(p => p.sourceId === 'resp');
  ok(icsResp.length > 0 && icsResp.every(p => same(p.amount, 100) && p.start.endsWith('-15')),
    'ICS payment VEVENTs for RESP come from the Plan, not a second literal',
    `${icsResp.length} occurrences`);
  ok(!/RESP contribution — \$100\.00/.test(read('scripts/calendar-ics.js')),
    'the ICS script no longer hardcodes an RESP payment literal');
}

console.log('\n=== union dues stay reserved until cancellation is confirmed ===');
{
  const dues = (plan.bills || []).find(b => b.id === 'uniondues');
  ok(!!dues && same(dues.amount, 25) && dues.day === 15
    && dues.frequency === 'monthly' && dues.budgetCategory === null,
    'union dues are a canonical $25 monthly bill on the 15th, not a spending category');
  ok(!(plan.obligations || []).some(o => /union|cmaw/i.test(o.id + o.label)),
    'and they are a bill, not a second obligation');
  const windowStream = F.expandEvents(plan, asOf, windowEnd);
  const duesEvents = windowStream.filter(e => e.id === 'uniondues' || e.id === 'uniondues-aug15-outstanding');
  ok(duesEvents.some(e => e.id === 'uniondues-aug15-outstanding' && e.date <= asOf),
    'the unposted 15 August dues are reserved on this opening');
  ok(duesEvents.filter(e => e.id === 'uniondues').every(e => e.date >= '2026-09-15'),
    'the monthly dues resume in September',
    duesEvents.filter(e => e.id === 'uniondues').map(e => e.date).join(','));
  ok(duesEvents.every(e => same(-e.amount, 25) && e.kind === 'bill'),
    'each is a $25 bill, so the forecast still reserves the cash');
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const icsDues = built.payments.filter(p => p.sourceId === 'uniondues');
  ok(icsDues.length > 0 && icsDues.every(p => same(p.amount, 25) && p.start.endsWith('-15')),
    'ICS payment VEVENTs for dues come from the Plan, not a second literal',
    `${icsDues.length} occurrences`);
  ok(!/Union dues \(CMAW Local 1995\)/.test(read('scripts/calendar-ics.js')),
    'the ICS script no longer hardcodes the $25 dues literal');
  const cancel = (plan.actions || []).find(a => /CMAW Local 1995/i.test(a.what));
  ok(!!cancel && cancel.status === 'open' && same(cancel.amount, 25),
    'the cancel-dues action stays open until cancellation is confirmed',
    cancel ? cancel.what : 'missing');
  ok(/until cancellation is actually confirmed/i.test(cancel.why),
    'and the action still says the $25 is reserved until then');
  const tax = plan.budget.categories.find(c => c.id === 'tax');
  ok(tax && !/union dues/i.test(tax.label),
    'the CRA reserve is not labelled as if it included union dues',
    tax ? tax.label : 'missing');
  ok(/id uniondues/i.test(tax.why),
    'and the reserve note points at the dated bill rather than absorbing it');
}

console.log('\n=== next due / next payment out, same stream ===');
{
  const events = F.expandEvents(plan, asOf, windowEnd);
  const due = F.nextDue(events, asOf);
  const out = F.nextPaymentOut(events, asOf);
  ok(due && out && due.due === out.date,
    'both look-aheads name the same next cash-out date',
    due && out ? `${due.due} / ${out.date}` : 'none');
  const sameDay = events.filter(e => e.date === due.due && e.amount < 0 && e.kind !== 'noncash');
  ok(sameDay.length >= 1 && sameDay[0].label === due.what,
    'nextDue is the first named event on that date',
    sameDay.map(e => e.label).join(' | '));
  const daySum = sameDay.reduce((s, e) => s - e.amount, 0);
  ok(same(out.amount, daySum),
    'nextPaymentOut is the day total of joint-cash outflows',
    `due $${due.amount} vs out $${out.amount}`);
  ok(sameDay.length === 1 || !same(due.amount, out.amount),
    'when several payments share the day, nextDue is not the day total',
    `${sameDay.length} event(s)`);
  ok(/Next cash-out total/.test(read('public/plan.js')),
    'the Plan tile labels the day total as a cash-out total');
  ok(/Next named payment due/.test(read('public/deepdive.js')),
    'the Deep Dive tile labels the single obligation');
}

console.log('\n=== mutation: a hardcoded conflicting payment fails ===');
{
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  const stream = cashEvents(plan, asOf, icsEnd);
  const keys = streamPaymentKeys(stream);
  const conflict = {
    start: '2026-08-21', sourceId: 'heloc', amount: 814.18,
    summary: 'HELOC — minimum $814.18', kind: 'payment',
  };
  const mutantKeys = icsPaymentKeys({ payments: built.payments.concat(conflict) });
  ok(!keys.has(paymentKey(conflict.start, conflict.sourceId, conflict.amount)),
    'the conflicting 21st HELOC payment is not in the canonical cash stream');
  ok([...mutantKeys].some(k => !keys.has(k)),
    'reintroducing that hardcoded payment breaks the ICS bijection');
  ok(!/HELOC — minimum/.test(read('scripts/calendar-ics.js')),
    'the ICS script no longer hardcodes a HELOC minimum payment');
}

console.log('\n=== HELOC: only evidenced cash semantics are encoded ===');
{
  const heloc = plan.obligations.find(o => o.id === 'heloc');
  ok(!!heloc && heloc.nonCash === true && heloc.day === 31 && heloc.effect === 'capitalise',
    'the Plan still models HELOC interest as month-end non-cash capitalisation');
  const stream = F.expandEvents(plan, asOf, windowEnd);
  const helocEvents = stream.filter(e => e.id === 'heloc');
  ok(helocEvents.length === 3 && helocEvents.every(e => e.kind === 'noncash'),
    'expandEvents emits HELOC as noncash, never as a chequing outflow',
    helocEvents.map(e => `${e.date}:${e.kind}`).join(', '));
  ok(helocEvents.every(e => e.date === '2026-08-31' || e.date === '2026-09-30' || e.date === '2026-10-31'),
    'those charges land at month-end, matching the observed posting');
  const due = F.nextDue(stream, asOf);
  const out = F.nextPaymentOut(stream, asOf);
  ok(due && !/HELOC/i.test(due.what), 'nextDue does not name the capitalised charge');
  ok(out && !/HELOC/i.test(out.label), 'nextPaymentOut does not include it in the cash-out total');
  const built = icsMod.buildHouseholdCalendar(plan, asOf, icsEnd);
  ok(!built.payments.some(p => /HELOC/i.test(p.summary) || p.sourceId === 'heloc'),
    'ICS has no HELOC cash-payment VEVENT');
  ok(built.reminders.some(r => r.sourceId === 'heloc' && /no cash leaves/i.test(r.summary)),
    'ICS carries month-end capitalisation as a derived non-cash reminder');
  const due21 = built.reminders.find(r => r.sourceId === 'heloc-contractual-due');
  ok(!!due21 && due21.kind === 'reminder' && due21.start === '2026-08-21'
    && /BYMONTHDAY=21/.test(due21.rrule || '') && /not a chequing outflow/i.test(due21.summary),
    'ICS keeps the 21st as a reminder-only contractual due date');
  ok(!built.payments.some(p => p.start.endsWith('-21') && /HELOC/i.test(p.summary)),
    'the 21st is not encoded as a chequing outflow');
}

console.log('\n=== upcoming is no longer a schedule authority ===');
{
  ok(!Object.prototype.hasOwnProperty.call(data, 'upcoming'),
    'data.json no longer has an upcoming schedule array');
  ok(Array.isArray(data.settled) && data.settled.every(s => s.date && s.note),
    'paid forensic notes remain as a settled overlay only');
  ok(data.settled.every(s => s.date < asOf),
    'the settled overlay is historical relative to as-of, not a future schedule');
  const icsSrc = read('scripts/calendar-ics.js');
  ok(/Forecast\.expandEvents/.test(icsSrc),
    'calendar-ics.js calls the Plan expander');
  ok(!/summary: 'TD Cash Back Visa — minimum \$762\.36'/.test(icsSrc),
    'hardcoded Cash Back Visa payment literal is gone');
  ok(!/summary: 'FortisBC gas/.test(icsSrc),
    'hardcoded Fortis payment literal is gone');
}

console.log('\n=== longer ICS horizon reuses the Plan expander ===');
{
  const short = F.occurrences({ frequency: 'monthly', day: 15 }, asOf, windowEnd);
  const long = F.occurrences({ frequency: 'monthly', day: 15 }, asOf, icsEnd);
  ok(short.every(d => d >= asOf && d.endsWith('-15')) && short.length >= 2,
    'the 91-day window still contains the remaining 15ths',
    short.join(','));
  ok(long.includes('2027-01-15') && long.includes('2027-04-15'),
    'the same expander reaches past the old 5-month cap into 2027',
    long.filter(d => d.startsWith('2027')).join(', '));
  ok(long[long.length - 1] <= icsEnd, 'and does not walk past the requested end');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
