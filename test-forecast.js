'use strict';
// Tests for the forecast engine, run against BOTH a hand-computed fixture and
// the real data.json plan block. `node test-forecast.js`
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('=== date arithmetic ===');
ok(F.addDays('2026-08-09', 90) === '2026-11-07', 'asOf + 90 days = 7 Nov', F.addDays('2026-08-09', 90));
ok(F.addDays('2026-08-31', 1) === '2026-09-01', 'month rollover');
ok(F.diffDays('2026-08-09', '2026-11-07') === 90, 'diffDays');

console.log('\n=== recurrence expansion ===');
const win = { start: '2026-08-09', end: '2026-11-07' };
const biweekly = F.occurrences({ frequency: 'biweekly', anchor: '2026-08-14' }, win.start, win.end);
ok(biweekly.length === 7, '7 bi-weekly paydays in the window', biweekly.join(', '));
ok(biweekly[0] === '2026-08-14' && biweekly[6] === '2026-11-06', 'first 14 Aug, last 6 Nov');

const monthEnd = F.occurrences({ frequency: 'monthly', day: 31 }, win.start, win.end);
ok(monthEnd.join(',') === '2026-08-31,2026-09-30,2026-10-31', 'day-31 clamps to 30 Sep', monthEnd.join(','));

const firstDue = F.occurrences({ frequency: 'monthly', day: 7, firstDue: '2026-09-07' }, win.start, win.end);
ok(firstDue.join(',') === '2026-09-07,2026-10-07,2026-11-07', 'firstDue skips the paid August 7th', firstDue.join(','));

const anchorBefore = F.occurrences({ frequency: 'biweekly', anchor: '2026-08-14' }, '2026-08-20', '2026-09-30');
ok(anchorBefore.join(',') === '2026-08-28,2026-09-11,2026-09-25', 'anchor before window start still expands', anchorBefore.join(','));

console.log('\n=== hand-computed fixture ===');
// One income of 1000 on day 3, one bill of 400 on day 5, starting 500,
// weekly variable 70 (=10/day), 14-day window.
const fixture = {
  windowDays: 14,
  defaults: { targetBuffer: 0 },
  startingCash: { amount: 500 },
  income: [{ id: 'p', label: 'Pay', frequency: 'once', date: '2026-01-04', amount: 1000, confidence: 'confirmed' }],
  obligations: [{ id: 'b', label: 'Bill', frequency: 'once', date: '2026-01-06', amount: 400, confidence: 'confirmed' }],
  commitments: [],
};
const sim = F.simulate(fixture, '2026-01-01', { weeklyVariable: 70, targetBuffer: 0 });
// Day-by-day: 500 −10×3 = 470 on Jan 3; Jan 4: +1000 −10 → 1460; Jan 6: −400 −10.
ok(near(sim.daily[2].balance, 470), 'balance before income', sim.daily[2].balance.toFixed(2));
ok(near(sim.daily[3].balance, 1460), 'income lands day 4', sim.daily[3].balance.toFixed(2));
ok(near(sim.ending, 500 + 1000 - 400 - 140), 'ending = start + in − out − variable', sim.ending.toFixed(2));
ok(near(sim.min.balance, 470) && sim.min.date === '2026-01-03', 'min is the eve of payday', `${sim.min.balance.toFixed(2)} on ${sim.min.date}`);
ok(sim.weeks.length === 2 && near(sim.weeks[0].opening, 500) && near(sim.weeks[1].opening, sim.weeks[0].closing), 'weeks chain opening=prior closing');
ok(near(sim.totals.confirmedIncome, 1000) && near(sim.totals.obligations, 400) && near(sim.totals.variable, 140), 'totals');

// Intra-day dip: a payment on payday morning cannot hide below the daily close.
const fixture2 = Object.assign({}, fixture, {
  obligations: [{ id: 'b', label: 'Bill', frequency: 'once', date: '2026-01-04', amount: 400, confidence: 'confirmed' }],
});
const sim2 = F.simulate(fixture2, '2026-01-01', { weeklyVariable: 0, targetBuffer: 0 });
ok(near(sim2.daily[3].balance, 1100), 'same-day: income first, then the bill', sim2.daily[3].balance.toFixed(2));

console.log('\n=== the week-by-week track ===');
// Fixture: buffer 100. After week 1 (ends Jan 7) the future holds the Jan 6
// bill of 400 with only variable outflow (10/day) around it. The worst future
// dip from week 1's closing is −400 − 7×10 = −470 by Jan 13... computed by
// hand: cum from Jan 8..14 = −10×7 = −70; no bill remains (Jan 6 is inside
// week 1), so required closing of week 1 = 100 + 70 = 170.
const simReq = F.simulate(fixture, '2026-01-01', { weeklyVariable: 70, targetBuffer: 100 });
ok(near(simReq.weeks[0].requiredClosing, 170), 'week 1 must close ≥ buffer + future net outflow', simReq.weeks[0].requiredClosing.toFixed(2));
ok(near(simReq.weeks[1].requiredClosing, 100), 'final week track equals the buffer', simReq.weeks[1].requiredClosing.toFixed(2));

console.log('\n=== recommender ===');
const rec = F.recommendWeekly(fixture, '2026-01-01', { targetBuffer: 100 });
// Two constraints: day 3 (500 − 3W/7 ≥ 100 → W ≤ 933) and the ending
// (1100 − 2W ≥ 100 → W ≤ 500). The ending binds, exactly on a $5 step.
ok(rec === 500, 'solves the binding constraint to the nearest $5', String(rec));
const simRec = F.simulate(fixture, '2026-01-01', { weeklyVariable: rec, targetBuffer: 100 });
ok(simRec.min.balance >= 100, 'recommended budget respects the buffer', simRec.min.balance.toFixed(2));
const simOver = F.simulate(fixture, '2026-01-01', { weeklyVariable: rec + 10, targetBuffer: 100 });
ok(simOver.min.balance < 100, 'and $10 more breaches it', simOver.min.balance.toFixed(2));

console.log('\n=== the real plan block ===');
const plan = data.plan;
const asOf = data.meta.asOf;
const expected = F.simulate(plan, asOf, {
  scenario: 'expected', weeklyVariable: 0, targetBuffer: plan.defaults.targetBuffer,
});

// Confirmed income: 7 paydays × 4468.69 + 3 child benefits × 153.59.
ok(near(expected.totals.confirmedIncome, 7 * 4468.69 + 3 * 153.59), '90-day confirmed income',
  expected.totals.confirmedIncome.toFixed(2));
// Estimated (expected scenario): Amanda's transfers, 3 × 2182.
ok(near(expected.totals.estimatedIncome, 3 * 2182, 0.05), '90-day estimated income',
  expected.totals.estimatedIncome.toFixed(2));
// Obligations exclude the HELOC — its interest capitalises rather than being
// paid. Mortgage 7×1600, Triangle 3×253.57, CashBack 762.36 + 2×170,
// MBNA 3×158.27, TD cc 3×94.03, Travel 3×17.
const wantObl = 7 * 1600 + 3 * 253.57 + 762.36 + 2 * 170 + 3 * 158.27 + 3 * 94.03 + 3 * 17;
ok(near(expected.totals.obligations, wantObl), '90-day cash obligations', expected.totals.obligations.toFixed(2));
ok(near(expected.totals.noncash, 3 * 814.18), 'HELOC interest is tracked but not deducted',
  expected.totals.noncash.toFixed(2));
{
  // The non-cash charge must not move the balance.
  const withHeloc = expected.ending;
  const stripped = JSON.parse(JSON.stringify(plan));
  stripped.obligations = stripped.obligations.filter(o => !o.nonCash);
  const without = F.simulate(stripped, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: plan.defaults.targetBuffer }).ending;
  ok(near(withHeloc, without), 'removing the non-cash charge changes nothing', `${withHeloc.toFixed(2)} vs ${without.toFixed(2)}`);
}
// Bills: Fortis (day 3 — August's already paid, so Sep/Oct/Nov = 3), Shaw,
// BCAA, ICBC and fees ×3 each, Fit4Less bi-weekly ×7.
const wantBills = 3 * 124 + 3 * 78.40 + 3 * 82.96 + 3 * 99.91 + 3 * 35.90 + 7 * 11.54;
ok(near(expected.totals.bills, wantBills), '90-day named bills', expected.totals.bills.toFixed(2));
const fortisDates = expected.events.filter(e => e.id === 'fortis').map(e => e.date).join(',');
ok(fortisDates === '2026-09-03,2026-10-03,2026-11-03', 'Fortis skips the already-paid August bill', fortisDates);
// Commitments: 320+303+786+140+800+500×3.
ok(near(expected.totals.commitments, 3849), '90-day commitments', expected.totals.commitments.toFixed(2));
ok(expected.weeks.length === 13, '13 weeks');
ok(near(expected.ending,
  plan.startingCash.amount + expected.totals.income - expected.totals.obligations
  - expected.totals.bills - expected.totals.commitments),
  'ledger identity holds', expected.ending.toFixed(2));

// The Burrard pair is atomic: same day, same amount, all or nothing. If a
// future edit splits them across the payday the gap would vanish on paper.
{
  const grp = plan.commitments.filter(c => c.group === 'burrard');
  ok(grp.length === 2 && grp[0].date === grp[1].date, 'both Burrard registrations fall on one date', grp.map(c => c.date).join(','));
  ok((plan.groups || []).some(g => g.id === 'burrard' && g.atomic), 'and the pair is flagged atomic');
  const due = grp.reduce((s, c) => s + c.amount, 0);
  ok(near(due, 623), 'totalling $623 on the day', due.toFixed(2));
  // Only Amanda's account and the HELOC can reach it.
  const can = plan.funding.options.filter(o => !o.unusable && o.available >= due).map(o => o.id).sort();
  ok(can.join(',') === 'amanda,heloc', 'exactly two sources can cover it', can.join(',') || 'none');
  const cardsPlusOd = plan.funding.options.filter(o => o.unusable).reduce((s, o) => s + o.available, 0);
  ok(cardsPlusOd < due, 'cards and overdraft combined fall short', `$${cardsPlusOd.toFixed(2)} vs $${due}`);
}

// Starting cash is the household spending accounts only — her account excluded.
ok(near(plan.startingCash.amount, 506.98 - 517.72 + 90.58), 'starting cash = Chequing A + B + Savings',
  plan.startingCash.amount.toFixed(2));
ok(!plan.income.some(s => /tennis bc/i.test(s.label)),
  'her gross Tennis BC pay is not counted as household income');

// Scenario ordering: conservative ≤ expected ≤ optimistic on every day.
const cons = F.simulate(plan, asOf, { scenario: 'conservative', weeklyVariable: 0 });
const opti = F.simulate(plan, asOf, { scenario: 'optimistic', weeklyVariable: 0 });
ok(cons.daily.every((d, i) => d.balance <= expected.daily[i].balance + 1e-9), 'conservative never exceeds expected');
ok(expected.daily.every((d, i) => d.balance <= opti.daily[i].balance + 1e-9), 'expected never exceeds optimistic');

// Disabling an adjustable commitment raises the ending balance by its amount.
const noWarriors = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, disabled: ['warriors'] });
ok(near(noWarriors.ending - expected.ending, 800), 'disabling Warriors adds $800 to the ending cash');

// Extra debt payments reduce ending cash by the months applied.
const extra = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, extraDebtMonthly: 200 });
ok(near(expected.ending - extra.ending, 600), 'extra $200/month × 3 mid-month dates', (expected.ending - extra.ending).toFixed(2));

// The week-by-week track on the real plan: verify the backward pass against a
// brute recomputation from the daily balances.
{
  const s = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 1000, targetBuffer: 500 });
  let allMatch = true;
  for (let i = 0; i < 12; i++) {
    const next = (i + 1) * 7;
    let cum = 0, minCum = Infinity;
    for (let j = next; j < s.daily.length; j++) {
      cum += s.daily[j].balance - s.daily[j - 1].balance;
      if (cum < minCum) minCum = cum;
    }
    const brute = 500 - Math.min(0, minCum);
    if (!near(s.weeks[i].requiredClosing, brute)) {
      ok(false, `track matches brute force at week ${i + 1}`, `${s.weeks[i].requiredClosing} vs ${brute}`);
      allMatch = false;
      break;
    }
  }
  if (allMatch) ok(true, 'track matches brute force for all 12 interior weeks');
}

// Recommender. On the corrected model the opening fortnight is infeasible —
// $79.84 of household cash cannot cover the $623 Burrard fees due two days
// before payday — so the honest answer is $0 and the engine must say so
// rather than returning a plausible-looking number.
const w = F.recommendWeekly(plan, asOf, { scenario: 'expected', targetBuffer: 500 });
const zeroSim = F.simulate(plan, asOf, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 });
ok(w === 0 && zeroSim.min.balance < 500,
  'returns $0 when even zero spending breaches the buffer', `$${w}/week, floor ${zeroSim.min.balance.toFixed(2)}`);
ok(near(zeroSim.min.balance, 79.84 - 623), 'the breach is the 12 Aug Burrard fees against opening cash',
  zeroSim.min.balance.toFixed(2));
ok(zeroSim.min.date === '2026-08-12', 'and it happens on 12 August', zeroSim.min.date);
// Once past the opening squeeze the window is comfortable: from the first
// payday onward a real budget exists.
const later = F.simulate(plan, addDaysISO(asOf, 7), Object.assign({}, { scenario: 'expected', weeklyVariable: 0, targetBuffer: 500 }));
ok(later.ending > 0, 'the window is not structurally short — it is a timing squeeze', later.ending.toFixed(2));
function addDaysISO(iso, n) { return F.addDays(iso, n); }

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
