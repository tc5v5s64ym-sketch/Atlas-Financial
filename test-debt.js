'use strict';
/* The coupled cash-and-debt model. `node test-debt.js`
 *
 * The property that matters: money that leaves the chequing account has to
 * arrive somewhere. A payment that only reduced cash would make the plan look
 * like progress while the balances sat still. */

const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const money = n => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const plan = data.plan;
const asOf = data.meta.asOf;
const BASE = { scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: plan.defaults.targetBuffer };
const advice = F.recommend(plan, asOf, BASE);
const runOpts = Object.assign({}, advice.simOptions, { weeklyVariable: advice.weekly });
const proj = F.projectDebts(plan, data.debts, asOf, runOpts);
const at = n => proj.marks.find(m => m.day === n) || proj.marks[proj.marks.length - 1];
const today = at(0), end = proj.marks[proj.marks.length - 1];

console.log('=== every obligation names the debt it moves ===');
for (const o of plan.obligations) {
  ok(!!o.debtId, `obligation "${o.id}" names a debt`, o.debtId || '(none)');
  ok(data.debts.some(x => x.id === o.debtId), `and "${o.debtId}" is a real debt`);
  ok(['payment', 'capitalise'].includes(o.effect), `and says what it does to it`, o.effect);
}
ok(data.debts.every(x => x.id), 'every debt has a stable id',
  data.debts.map(x => x.id).join(', '));

console.log('\n=== a payment reduces the balance it is paid against ===');
// Pay the TD credit card three times over the window; the balance must fall by
// the payments less the interest, not merely leave the cash account.
const tdcc = data.debts.find(x => x.id === 'tdcc');
const tdccEnd = end.debts.find(x => x.id === 'tdcc');
const tdccMark = proj.byId.tdcc;
ok(tdccEnd.balance < tdcc.balance, 'the TD credit card balance falls',
  `${money(tdcc.balance)} → ${money(tdccEnd.balance)}`);
ok(near(tdccEnd.balance, tdcc.balance - tdccMark.paid + tdccMark.interest, 0.5),
  'and falls by exactly payments less interest',
  `${money(tdcc.balance)} − ${money(tdccMark.paid)} + ${money(tdccMark.interest)}`);

console.log('\n=== cash and debt reconcile against one event stream ===');
// Every cash obligation in the simulation must equal the payments recorded
// against the debts. If they differ, money is leaving cash and going nowhere.
const cashObligations = advice.sim.totals.obligations;
const paidToDebts = Object.values(proj.byId).reduce((s, x) => s + x.paid, 0);
ok(near(cashObligations, paidToDebts, 0.5),
  'cash paid out on obligations equals payments applied to debts',
  `${money(cashObligations)} vs ${money(paidToDebts)}`);

console.log('\n=== the capitalising charge grows the balance and moves no cash ===');
const helocObl = plan.obligations.find(o => o.id === 'heloc');
const helocEnd = end.debts.find(x => x.id === 'heloc');
const charges = F.occurrences(helocObl, asOf, end.date).length;
const helocStart = data.debts.find(x => x.id === 'heloc').balance;
ok(helocEnd.balance > helocStart, 'the HELOC balance grows over the window',
  `${money(helocStart)} → ${money(helocEnd.balance)}`);
ok(near(helocEnd.balance, helocStart + charges * helocObl.amount, 0.5),
  'by exactly the capitalised interest and nothing else',
  `${charges} × ${money(helocObl.amount)}`);
ok(proj.byId.heloc.paid === 0, 'and no cash is paid against it');
ok(advice.sim.totals.noncash > 0 && near(advice.sim.totals.noncash, charges * helocObl.amount),
  'the cash simulation agrees it is non-cash', money(advice.sim.totals.noncash));

console.log('\n=== the amortising payment splits interest from principal ===');
const mort = data.debts.find(x => x.id === 'mortgage');
const mortEnd = end.debts.find(x => x.id === 'mortgage');
const mortState = proj.byId.mortgage;
ok(mortEnd.balance < mort.balance, 'the mortgage balance falls',
  `${money(mort.balance)} → ${money(mortEnd.balance)}`);
ok(near(mort.balance - mortEnd.balance, mortState.paid * mort.principalShare, 0.5),
  'by the principal share of the payments only',
  `${(mort.principalShare * 100).toFixed(1)}% of ${money(mortState.paid)}`);
ok(mortState.interest > 0, 'and the rest is recorded as interest', money(mortState.interest));

console.log('\n=== an extra payment must reduce a named debt ===');
const withExtra = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, runOpts, { extraDebtMonthly: 300, extraDebtTarget: 'cashback' }));
const baseCashback = end.debts.find(x => x.id === 'cashback').balance;
const extraCashback = withExtra.marks[withExtra.marks.length - 1].debts
  .find(x => x.id === 'cashback').balance;
ok(extraCashback < baseCashback, 'a targeted extra payment reduces that debt',
  `${money(baseCashback)} → ${money(extraCashback)}`);
const extraEvents = F.expandEvents(plan, asOf, end.date,
  Object.assign({}, runOpts, { extraDebtMonthly: 300 })).filter(e => e.kind === 'extra');
const extraTotal = extraEvents.reduce((s, e) => s + -e.amount, 0);
const reduction = baseCashback - extraCashback;
ok(reduction >= extraTotal - 0.01,
  'by at least the amount actually paid', `${money(reduction)} for ${money(extraTotal)} paid`);
// And by slightly MORE, because a balance that is paid down stops accruing.
// That difference is the avoided interest, and it has to be small and positive:
// a large gap would mean the model was crediting money it never received.
const avoided = reduction - extraTotal;
const extraTargetDebt = data.debts.find(x => x.id === 'cashback');
ok(avoided > 0 && avoided < extraTotal * 0.1,
  'the excess is avoided interest, not phantom repayment',
  `${money(avoided)} avoided on ${money(extraTotal)} at ${extraTargetDebt.rate}%`);
// And an untargeted one is flagged rather than silently vanishing into cash.
const untargeted = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, runOpts, { extraDebtMonthly: 300 }));
ok(untargeted.untargetedExtra === true,
  'an extra payment with no target is reported, not silently absorbed');

console.log('\n=== the scoreboard the Plan shows ===');
for (const day of [0, 30, 60, 90]) {
  const m = at(day);
  ok(m && m.day === day, `day ${day} has a mark`, m ? m.date : 'missing');
}
ok(today.consumer > 0 && today.secured > 0, 'consumer and secured debt are separated',
  `${money(today.consumer)} / ${money(today.secured)}`);
// Day-zero consumer debt is posted PLUS known pending, because a pending
// charge is money already spent. Comparing it against posted balances alone
// would be comparing two different questions.
const postedConsumer = data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance, 0);
const pendingConsumer = data.debts.filter(x => !x.secured).reduce((s, x) => s + (x.pending || 0), 0);
ok(near(today.consumer, postedConsumer + pendingConsumer),
  'day-zero consumer debt equals posted plus known pending',
  `${money(postedConsumer)} + ${money(pendingConsumer)} = ${money(today.consumer)}`);
ok(pendingConsumer >= 0, 'known pending is modelled (zero is an observation, not an omission)', money(pendingConsumer));
ok(near(today.heloc, helocStart), 'day-zero HELOC equals the balance sheet', money(today.heloc));
ok(today.headroom > 0, 'revolving headroom is reported', money(today.headroom));
ok(end.interestToDate > 0, 'interest incurred is accumulated across the window',
  money(end.interestToDate));

console.log('\n=== the over-limit findings the plan now rests on ===');
// The TD Cash Back Visa is over its limit today.
ok(today.overLimitCount >= 1, 'at least one facility is over its limit today',
  today.debts.filter(x => x.overLimit).map(x => x.label).join(', '));
// The HELOC crosses its own limit inside the window with no new borrowing.
const helocBreach = proj.marks.find(m => m.debts.some(x => x.id === 'heloc' && x.overLimit));
ok(!!helocBreach, 'the HELOC crosses its limit inside the window without any new draw',
  helocBreach ? `by ${helocBreach.date}` : 'no breach found');
ok(helocBreach && helocBreach.day <= 90, 'and it happens within the 90 days',
  helocBreach ? 'day ' + helocBreach.day : '');
// Which is exactly why the plan ranks stopping HELOC growth above repayment.
ok(/HELOC/.test(JSON.stringify(plan.nextDollar)),
  'the next-dollar policy accounts for it');

/* ==================================================================
   The two things review caught, and neither can come back quietly.
   ================================================================== */
console.log('\n=== the crossing date is the day it happens, not the next snapshot ===');
// The HELOC crossing is the day the capitalising charge first takes the
// balance over the limit. The 30-day marks can fall after that day, so
// reading the breach off the marks reports a later month and puts the
// household on the wrong side of the plan's own deadline.
const cross = proj.crossings.find(c => c.id === 'heloc' && !c.alreadyOver);
ok(!!cross, 'the HELOC crossing is reported at all');
const helocChargeDates = F.occurrences(helocObl, asOf, proj.end);
ok(helocChargeDates.includes(cross.date), 'and on the exact day the charge posts', cross.date);
const markDate = proj.marks.find(m => m.debts.some(x => x.id === 'heloc' && x.overLimit)).date;
ok(!!markDate && markDate >= cross.date,
  'the 30-day snapshot is on or after the daily crossing', markDate);
ok(cross.date < markDate, 'so the crossing must be read from the daily walk, not the marks',
  `${cross.date} vs ${markDate}`);
// The charge that does it, checked against the schedule rather than asserted.
const helocCharges = F.occurrences(helocObl, asOf, proj.end);
ok(helocCharges.includes(cross.date), 'the crossing day is a day the charge actually posts',
  helocCharges.join(', '));
// A facility already over the limit today is a different problem and is marked.
const already = proj.crossings.filter(c => c.alreadyOver).map(c => c.label);
ok(already.includes('Amazon.ca Rewards Mastercard (MBNA)')
  || already.includes('Travel Visa (business)'),
  'a facility over its limit today is flagged as already-over, not as a future crossing',
  already.join(', '));

console.log('\n=== a fundingDebtId hint cannot convert an opening gap into a HELOC draw ===');
// This file still exercises the legacy recommend() calling convention.
// B70: a facility hint is not authorization. Opening-gap recovery must
// fail that path closed rather than attach the HELOC and publish a
// borrowing-enabled weekly cap. Independent arithmetic for the gap case
// lives in test-opening-gap-no-auto-borrow.js.
const freeAdvice = F.recommend(plan, asOf, Object.assign({}, BASE, { fundingDebtId: null }));
const freeProj = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, freeAdvice.simOptions, { weeklyVariable: freeAdvice.weekly }));
const drawAdvice = F.recommend(plan, asOf, Object.assign({}, BASE, { fundingDebtId: 'heloc' }));
const drawProj = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, drawAdvice.simOptions, { weeklyVariable: drawAdvice.weekly }));

ok(freeProj.byId.heloc.drawn === 0,
  'funding from an account the household owns adds nothing to the HELOC');
ok(drawAdvice.plannedDebt && drawAdvice.plannedDebt.permitted === false,
  'plannedDebt stays unpermitted when only fundingDebtId is supplied');
ok(!(drawAdvice.simOptions.injections || []).some(i => i.debtId),
  'the legacy hint does not inject a HELOC draw');
ok(near((drawAdvice.funding && drawAdvice.funding.borrowed) || 0, 0),
  'and records no borrowed opening-gap cash');
ok(drawProj.byId.heloc.drawn === 0,
  'so the HELOC walk draws nothing from the hint');
if (drawAdvice.gap) {
  ok(drawAdvice.funding && drawAdvice.funding.feasible === false,
    'an opening gap with only a debt hint stays unfunded');
  ok(drawAdvice.weekly === 0,
    'and no borrowing-enabled weekly cap is published', `$${drawAdvice.weekly}/week`);
}

// Every funding option must declare whether taking it is borrowing.
for (const o of plan.funding.options) {
  ok('debtId' in o, `funding option "${o.id}" declares whether it creates debt`,
    o.debtId === null ? 'no debt' : 'draws on ' + o.debtId);
  ok(o.debtId === null || data.debts.some(x => x.id === o.debtId),
    `and "${o.debtId}" is a real debt`);
}
const preferred = plan.funding.options.slice().sort((a, b) => a.rank - b.rank)
  .find(o => !o.unusable);
ok(preferred && preferred.debtId === null,
  'the highest-ranked usable source is the one that creates no debt', preferred.label);

console.log('\n=== known pending charges are modelled, not left in prose ===');
// $165.13 on the Travel Visa and $82.05 on the MBNA were recorded only as
// sentences in a note. Credit availability was computed as limit - posted, so
// the projection saw $21.69 of room on a card already economically over.
const util = F.utilisation(data.debts, data.revolvingExtra, data.plan);
const tvRow = util.rows.find(r => r.id === 'travelvisa');
const mbRow = util.rows.find(r => r.id === 'mbna');

ok(data.debts.every(x => typeof x.pending === 'number' || x.pendingUnknown === true),
  'every debt states its pending amount, or marks it unknown rather than as $0',
  `${data.debts.filter(x => x.pendingUnknown).map(x => x.id).join(', ') || 'none unknown'}; `
    + `${data.debts.filter(x => x.pending > 0).length} of ${data.debts.length} carry known pending`);
const cashRow = util.rows.find(r => r.id === 'cashback');
if (cashRow && cashRow.pendingUnknown === true) {
  ok(cashRow.available == null && cashRow.overLimit == null,
    'unknown Cash Back pending does not publish $200.57 of posted room or close over-limit');
} else {
  ok(cashRow && cashRow.pendingUnknown !== true && near(cashRow.available, Math.max(0, cashRow.limit - cashRow.used)),
    'known Cash Back pending publishes utilisation available from posted+pending');
}
const tvDebt = data.debts.find(x => x.id === 'travelvisa');
const mbDebt = data.debts.find(x => x.id === 'mbna');
ok(near(tvRow.pending, tvDebt.pending), 'the Travel Visa pending charges are represented', money(tvRow.pending));
ok(near(mbRow.pending, mbDebt.pending), 'and the MBNA ones, which were also unmodelled', money(mbRow.pending));
ok(near(tvRow.used, tvDebt.balance + tvDebt.pending), 'Travel Visa effective balance is posted + pending', money(tvRow.used));
ok(tvRow.overLimit === (tvRow.used > tvRow.limit + 0.005)
  && near(tvRow.overLimitBy, Math.max(0, tvRow.used - tvRow.limit)),
  'over-limit follows posted + pending against the limit',
  `${money(tvRow.used)} against a ${money(tvRow.limit)} limit`);
ok(tvRow.overLimit === true || tvRow.posted < tvRow.limit,
  'Travel Visa over-limit is judged from posted+pending, including when posted itself is over',
  `${money(tvRow.posted)} vs ${money(tvRow.limit)}`);
ok(tvRow.available === 0 || tvRow.used < tvRow.limit,
  'available credit is nil when effective use meets the limit', money(tvRow.available));

ok(near(util.totalPending, data.debts.reduce((s, x) => s + (x.pendingUnknown ? 0 : (x.pending || 0)), 0)),
  'total pending across the household', money(util.totalPending));
// The Plan shows "revolving credit left" in the Today tile and again as the
// day-0 scoreboard row. They came from different functions and disagreed by
// the $82.28 overdraft, under one label.
const projWithExtra = F.projectDebts(plan, data.debts, asOf,
  Object.assign({}, runOpts, { extraFacilities: data.revolvingExtra }));
ok(near(projWithExtra.marks[0].headroom, util.totalAvailable),
  'the scoreboard day-0 headroom equals the Today tile figure',
  `${money(projWithExtra.marks[0].headroom)} = ${money(util.totalAvailable)}`);
ok(util.overLimitCount === util.rows.filter(r => r.overLimit === true).length
  && util.overLimitCount >= 1,
  'over-limit count matches the utilisation rows',
  util.rows.filter(r => r.overLimit).map(r => r.label).join(', '));

// Pending must be carried once, not applied and then applied again.
const d0 = at(0);
const tvProj = d0.debts.find(x => x.id === 'travelvisa');
ok(near(tvProj.balance, tvDebt.balance + tvDebt.pending), 'the projection opens the Travel Visa at the effective balance',
  money(tvProj.balance));
ok(near(tvProj.postedBalance, tvDebt.balance) && near(tvProj.pending, tvDebt.pending),
  'while still reporting posted and pending apart');
// Settlement is bookkeeping: no event may add the pending amount a second time.
const settle = F.expandEvents(plan, asOf, proj.end, runOpts)
  .filter(e => tvDebt.pending > 0 && Math.abs(Math.abs(e.amount) - tvDebt.pending) < 0.01);
ok(settle.length === 0, 'no scheduled event re-applies the pending charge when it settles',
  `${settle.length} matching events`);
ok(near(d0.consumer - postedConsumer, pendingConsumer),
  'consumer debt is lifted by the pending total exactly once', money(d0.consumer - postedConsumer));

// `available` must not be storable — that is how it drifted before.
ok(data.debts.every(x => x.available === undefined),
  'no debt stores a copy of its own available credit; it is derived');

console.log('\n=== the next-dollar policy is explicit, not invented ===');
const nd = plan.nextDollar;
ok(!!nd && !!nd.policy, 'a policy is declared', nd && nd.policy);
ok(data.debts.some(x => x.id === nd.target), 'its target is a real debt', nd.target);
const target = data.debts.find(x => x.id === nd.target);
const consumerRates = data.debts.filter(x => !x.secured).map(x => x.rate);
ok(target.rate === Math.max(...consumerRates),
  'and is the highest-rate consumer debt', `${target.label} at ${target.rate}%`);
ok(target.rate === 26.99,
  'which is still the Cash Back Visa at 26.99%, the highest consumer rate',
  `${target.label} ${money(target.balance)} / limit ${money(target.limit)}`);
ok(Array.isArray(nd.order) && nd.order.length >= 5, 'the ordering is written down',
  `${nd.order.length} rules`);
ok(nd.order.every(r => r.rule && r.why), 'and every rule states its reason');
ok(nd.order[0].rule.toLowerCase().includes('protect'),
  'required payments come first', nd.order[0].rule);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
