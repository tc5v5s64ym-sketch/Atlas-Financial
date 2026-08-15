'use strict';
/* B91 first slice — Aug. 14 current-state cutover (D1).
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Synthetic amounts on purpose: the live Aug. 14 observation is not an
 * owner-approved canonical edit, and this suite must not promote session
 * numbers into data.json merely to pass.
 *
 * Independent proof: occurrence dates from Forecast.occurrences, plus a
 * hand walk of opening ± named amounts. That is not a second call to the
 * filter under test.
 */
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);

const AS_OF = '2026-08-14';
const END = F.addDays(AS_OF, 27);
const PAYROLL = 1000;
const MORTGAGE = 200;
const OPENING = 800;
const OTHER_BILL = 50;

function fixture(extra) {
  return Object.assign({
    windowDays: 28,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: OPENING },
    opening: {
      asOf: AS_OF,
      representedEvents: [{ id: 'payroll', date: AS_OF }],
    },
    income: [{
      id: 'payroll',
      label: 'Payroll',
      frequency: 'biweekly',
      anchor: AS_OF,
      amount: PAYROLL,
      confidence: 'confirmed',
    }],
    obligations: [{
      id: 'mortgage',
      label: 'Mortgage',
      frequency: 'biweekly',
      anchor: AS_OF,
      amount: MORTGAGE,
      confidence: 'confirmed',
    }],
    bills: [{
      id: 'other-same-day',
      label: 'Unsettled same-day bill',
      frequency: 'once',
      date: AS_OF,
      amount: OTHER_BILL,
      confidence: 'confirmed',
    }],
    commitments: [],
  }, extra || {});
}

const plan = fixture();
const payrollDates = F.occurrences(plan.income[0], AS_OF, END);
const mortgageDates = F.occurrences(plan.obligations[0], AS_OF, END);
const nextPayroll = F.addDays(AS_OF, 14);

console.log('=== A. opening is after payroll; schedule still names both ===');
ok(payrollDates[0] === AS_OF, 'independent occurrences: payroll is scheduled on Aug. 14');
ok(mortgageDates[0] === AS_OF, 'independent occurrences: mortgage is scheduled on Aug. 14');
ok(payrollDates.includes(nextPayroll),
  'the next payroll is still on the biweekly grid', nextPayroll);
ok(near(OPENING, 800), 'synthetic opening is the post-payroll observed cash');

console.log('\n=== B. old replay double-counts same-day payroll ===');
{
  const oldEvents = F.expandEvents(fixture({ opening: undefined }), AS_OF, END, {});
  const day0 = oldEvents.filter(e => e.date === AS_OF);
  const payroll = day0.find(e => e.id === 'payroll');
  const mortgage = day0.find(e => e.id === 'mortgage');
  ok(!!payroll && near(payroll.amount, PAYROLL),
    'old behaviour still emits Aug. 14 payroll');
  ok(!!mortgage && near(mortgage.amount, -MORTGAGE),
    'old behaviour still emits Aug. 14 mortgage');
  const independentOldNet = PAYROLL - MORTGAGE - OTHER_BILL;
  const day0Net = day0.reduce((s, e) => s + e.amount, 0);
  ok(near(day0Net, independentOldNet),
    'old day-0 net is +payroll −mortgage −other',
    money(day0Net));
  const oldSim = F.simulate(fixture({ opening: undefined }), AS_OF, { weeklyVariable: 0 });
  const independentOldClose = OPENING + independentOldNet
    + (payrollDates.length - 1) * PAYROLL
    + (mortgageDates.length - 1) * -MORTGAGE;
  ok(near(oldSim.ending, independentOldClose),
    'old window ending matches the hand walk that adds payroll again',
    money(oldSim.ending));
  ok(near(oldSim.daily[0].balance, OPENING + independentOldNet),
    'old first-day close is opening plus the double-counted payday');
}

console.log('\n=== C. represented payroll is not replayed; mortgage still is ===');
{
  const events = F.expandEvents(plan, AS_OF, END, {});
  const day0 = events.filter(e => e.date === AS_OF);
  ok(!day0.some(e => e.id === 'payroll'),
    'Forecast does not add the already-represented Aug. 14 payroll');
  const mortgage = day0.find(e => e.id === 'mortgage');
  ok(!!mortgage && near(mortgage.amount, -MORTGAGE),
    'Forecast still deducts the unposted Aug. 14 mortgage');
  const other = day0.find(e => e.id === 'other-same-day');
  ok(!!other && near(other.amount, -OTHER_BILL),
    'an unrepresented same-day event is not silently discarded');
  ok(events.some(e => e.id === 'payroll' && e.date === nextPayroll),
    'later payroll occurrences still fire — this is not a stream disable');

  const independentNewNet = -MORTGAGE - OTHER_BILL;
  const day0Net = day0.reduce((s, e) => s + e.amount, 0);
  ok(near(day0Net, independentNewNet),
    'new day-0 net is −mortgage −other, with no payroll',
    money(day0Net));

  const sim = F.simulate(plan, AS_OF, { weeklyVariable: 0 });
  const independentNewClose = OPENING + independentNewNet
    + (payrollDates.length - 1) * PAYROLL
    + (mortgageDates.length - 1) * -MORTGAGE;
  ok(near(sim.ending, independentNewClose),
    'new window ending matches the hand walk that does not add payroll again',
    money(sim.ending));
  ok(near(sim.daily[0].balance, OPENING + independentNewNet),
    'first-day close is observed opening minus unposted same-day outflows');
  ok(!near(sim.daily[0].balance, OPENING + PAYROLL + independentNewNet),
    'that first-day close is not the old double-counted answer');
}

console.log('\n=== D. opts.representedEvents is the same rule ===');
{
  const bare = fixture({ opening: undefined });
  const events = F.expandEvents(bare, AS_OF, END, {
    representedEvents: [{ id: 'payroll', date: AS_OF }],
  });
  ok(!events.some(e => e.id === 'payroll' && e.date === AS_OF),
    'opts.representedEvents suppresses that dated occurrence');
  ok(events.some(e => e.id === 'mortgage' && e.date === AS_OF),
    'and still leaves the unrepresented mortgage');
}

console.log('\n=== E. no broad date-based suppression ===');
{
  const wrong = fixture({
    opening: { asOf: AS_OF, representedEvents: [] },
  });
  const events = F.expandEvents(wrong, AS_OF, END, {});
  const day0 = events.filter(e => e.date === AS_OF);
  ok(day0.some(e => e.id === 'payroll'),
    'an opening asOf alone does not skip payroll');
  ok(day0.some(e => e.id === 'mortgage'),
    'an opening asOf alone does not skip mortgage');
  ok(day0.some(e => e.id === 'other-same-day'),
    'an opening asOf alone does not skip an unrepresented bill');

  const disabled = F.expandEvents(fixture({ opening: undefined }), AS_OF, END, {
    disabled: ['payroll'],
  });
  ok(disabled.some(e => e.id === 'payroll' && e.date === AS_OF),
    'disabled[] is commitments-only — it is not a hidden date skip for income');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
