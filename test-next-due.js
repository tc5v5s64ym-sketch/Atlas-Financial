'use strict';
/* Focused proof for Forecast.nextDue(). The correctness cases are hand
 * computed against a fixture calendar, not against the function that now
 * produces the answer; the real-plan check only proves this authority move
 * preserves what the Deep Dive page already showed.
 *
 * Every exclusion is proved twice: once by the winner it does not displace,
 * and once by removing the disqualifier and watching that item win. A filter
 * that excluded nothing would pass the first check and fail the second.
 */
const fs = require('fs');
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = x => JSON.parse(JSON.stringify(x));

/* A calendar built so that EVERY excluded item is dated before the winner.
 * If any exclusion rule failed to bite, that item would win instead, so the
 * single assertion on the winner is load-bearing for all three rules.
 *
 *   due          what                     amount   why it does or does not win
 *   2026-02-06   Hydro — missed           140.00   4 days past due  → excluded
 *   2026-02-11   HELOC interest charged   800.00   non-cash         → excluded
 *   2026-02-12   Phone bill                65.00   already paid     → excluded
 *   2026-02-13   Car insurance            210.00   WINNER
 *   2026-02-13   Dentist                  275.00   same day, listed second
 *   2026-02-20   Mortgage               1,600.00   a week later
 *
 * As of 2026-02-10, three items are eligible. The earliest eligible date is
 * 13 February, three days away. Two obligations share that date, and the
 * calendar lists Car insurance first, so Car insurance at $210.00 is next due.
 */
const AS_OF = '2026-02-10';
const CALENDAR = [
  { due: '2026-02-06', what: 'Hydro — missed', amount: 140, status: 'due' },
  { due: '2026-02-11', what: 'HELOC interest charged', amount: 800, status: 'scheduled', kind: 'noncash' },
  { due: '2026-02-12', what: 'Phone bill', amount: 65, status: 'paid' },
  { due: '2026-02-13', what: 'Car insurance', amount: 210, status: 'due' },
  { due: '2026-02-13', what: 'Dentist', amount: 275, status: 'due', kind: 'commitment' },
  { due: '2026-02-20', what: 'Mortgage', amount: 1600, status: 'due' },
];

console.log('=== hand-computed winner ===');
const next = F.nextDue(CALENDAR, AS_OF);
ok(!!next, 'an eligible obligation is found');
ok(next && next.what === 'Car insurance',
  'Car insurance wins — the earliest eligible date, first on that date',
  next ? next.what : 'none');
ok(next && next.due === '2026-02-13', 'it is dated 13 February', next ? next.due : 'none');
ok(next && next.amount === 210, 'its own amount is reported', next ? String(next.amount) : 'none');
ok(next && next.daysUntil === 3, '10 Feb to 13 Feb is three days', next ? String(next.daysUntil) : 'none');
// One obligation, named. $485.00 is what 13 February costs in total, which is a
// different question and belongs to Forecast.nextPaymentOut (B74 reconciles
// the two look-aheads).
ok(next && next.amount !== 485,
  'the winner is one obligation, not the day total');

console.log('\n=== each exclusion is what kept the item out ===');
// Past due: nothing about Hydro changes except the day the household is standing
// on. As of 5 February it is one day away, and it is the earliest eligible item.
const beforeHydro = F.nextDue(CALENDAR, '2026-02-05');
ok(beforeHydro && beforeHydro.what === 'Hydro — missed' && beforeHydro.daysUntil === 1,
  'Hydro lost only because it was already past due',
  beforeHydro ? `${beforeHydro.what} in ${beforeHydro.daysUntil}d` : 'none');

// Paid: the same phone bill, unpaid, is dated before the winner and takes it.
const unpaid = clone(CALENDAR);
unpaid[2].status = 'due';
const withUnpaid = F.nextDue(unpaid, AS_OF);
ok(withUnpaid && withUnpaid.what === 'Phone bill',
  'the phone bill lost only because it was paid',
  withUnpaid ? withUnpaid.what : 'none');

// Non-cash: capitalised interest is a real cost but no cash leaves an account.
// Called cash, the same row would be next due.
const asCash = clone(CALENDAR);
delete asCash[1].kind;
const withCash = F.nextDue(asCash, AS_OF);
ok(withCash && withCash.what === 'HELOC interest charged',
  'the HELOC charge lost only because it is non-cash',
  withCash ? withCash.what : 'none');

console.log('\n=== same-day ordering is stated, not incidental ===');
// Dentist is the LARGER of the two 13 February obligations and still loses, so
// the rule is the calendar's own order rather than size. Reversing the two
// entries reverses the answer, and nothing else does.
const swapped = clone(CALENDAR);
[swapped[3], swapped[4]] = [swapped[4], swapped[3]];
const afterSwap = F.nextDue(swapped, AS_OF);
ok(afterSwap && afterSwap.what === 'Dentist' && afterSwap.amount === 275,
  'listing Dentist first makes Dentist the answer',
  afterSwap ? afterSwap.what : 'none');
ok(next && next.amount < 275,
  'the larger same-day obligation does not win on size alone');
// Determinism: the same input always gives the same answer, whatever the sort
// implementation underneath. The old page comparator never returned 0, so this
// was not a property the previous code could claim.
const repeated = new Set(Array.from({ length: 50 }, () => JSON.stringify(F.nextDue(CALENDAR, AS_OF))));
ok(repeated.size === 1, 'repeated calls give one answer', `${repeated.size} distinct`);

console.log('\n=== boundaries ===');
// Due today is still due. The exclusion is "before today", not "not after".
const today = F.nextDue(CALENDAR, '2026-02-13');
ok(today && today.what === 'Car insurance' && today.daysUntil === 0,
  'an obligation due today is next due, at zero days',
  today ? `${today.what} in ${today.daysUntil}d` : 'none');

// Everything settled, non-cash or behind: there is no next payment to name, and
// the tile stays hidden rather than showing an invented one.
const nothingLeft = F.nextDue(CALENDAR.slice(0, 3), AS_OF);
ok(nothingLeft === null, 'no eligible item returns null', String(nothingLeft));
ok(F.nextDue([], AS_OF) === null, 'an empty calendar returns null');
ok(F.nextDue(undefined, AS_OF) === null, 'a missing calendar returns null');

console.log('\n=== real-calendar migration equivalence ===');
// The exact expression public/deepdive.js used before this move, run against
// the published calendar, must still name the same obligation.
const asOfDate = new Date(data.meta.asOf + 'T00:00:00');
const daysUntil = due => Math.round((new Date(due + 'T00:00:00') - asOfDate) / 86400000);
const legacy = data.upcoming
  .filter(u => u.status !== 'paid' && u.kind !== 'noncash' && daysUntil(u.due) >= 0)
  .sort((a, b) => a.due < b.due ? -1 : 1)[0];
const moved = F.nextDue(data.upcoming, data.meta.asOf);
ok(!!legacy && !!moved, 'both the old expression and the engine find an answer');
ok(moved && legacy && moved.what === legacy.what && moved.due === legacy.due
  && moved.amount === legacy.amount && moved.daysUntil === daysUntil(legacy.due),
  'the engine-owned selection preserves the published answer',
  moved ? `${moved.what} ${moved.due} $${moved.amount} in ${moved.daysUntil}d` : 'none');

console.log('\n=== page is a renderer ===');
const page = fs.readFileSync('public/deepdive.js', 'utf8');
ok(/Forecast\.nextDue\(/.test(page), 'Deep Dive reads the winner from Forecast.nextDue');
ok(!/status\s*!==\s*'paid'/.test(page), 'Deep Dive no longer applies the paid rule itself');
ok(!/kind\s*!==\s*'noncash'/.test(page), 'Deep Dive no longer applies the non-cash rule itself');
ok(!/a\.due\s*<\s*b\.due/.test(page), 'Deep Dive no longer orders the obligations itself');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
