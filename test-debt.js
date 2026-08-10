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
ok(helocEnd.balance > 201586.16, 'the HELOC balance grows over the window',
  `${money(201586.16)} → ${money(helocEnd.balance)}`);
ok(near(helocEnd.balance, 201586.16 + charges * helocObl.amount, 0.5),
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
ok(near(today.consumer, data.debts.filter(x => !x.secured).reduce((s, x) => s + x.balance, 0)),
  'and day-zero consumer debt equals the balance sheet', money(today.consumer));
ok(near(today.heloc, 201586.16), 'day-zero HELOC equals the balance sheet', money(today.heloc));
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

console.log('\n=== the next-dollar policy is explicit, not invented ===');
const nd = plan.nextDollar;
ok(!!nd && !!nd.policy, 'a policy is declared', nd && nd.policy);
ok(data.debts.some(x => x.id === nd.target), 'its target is a real debt', nd.target);
const target = data.debts.find(x => x.id === nd.target);
const consumerRates = data.debts.filter(x => !x.secured).map(x => x.rate);
ok(target.rate === Math.max(...consumerRates),
  'and is the highest-rate consumer debt', `${target.label} at ${target.rate}%`);
ok(target.balance > target.limit,
  'which is also the one over its limit — the reason it beats rate alone',
  `${money(target.balance)} against ${money(target.limit)}`);
ok(Array.isArray(nd.order) && nd.order.length >= 5, 'the ordering is written down',
  `${nd.order.length} rules`);
ok(nd.order.every(r => r.rule && r.why), 'and every rule states its reason');
ok(nd.order[0].rule.toLowerCase().includes('protect'),
  'required payments come first', nd.order[0].rule);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
