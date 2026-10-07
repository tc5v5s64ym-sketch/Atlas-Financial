'use strict';
// Hand arithmetic and explicit evidence counterexamples, never live cents.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../public/forecast');
const O = require('../scripts/provider-observe');
const Live = require('../scripts/live-plan');
const OA = require('../scripts/operating-answer');
const Assistant = require('../scripts/assistant-packet');
const fixture = require('./fixtures/early-income-data');
const clone = x => JSON.parse(JSON.stringify(x));
let checks = 0;
function eq(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
function run(input) {
  const before = JSON.stringify(input.data);
  const report = O.observe({ provider: 'lunchmoney', ...input });
  const out = Live.overlayLiveState({ data: input.data, report });
  eq(JSON.stringify(input.data), before, 'canonical input unchanged');
  eq(out.writesCanonicalState, false, 'no canonical write');
  eq(out.data.plan.income, input.data.plan.income, 'salary amount and calendar untouched');
  eq(out.data.plan.bills, input.data.plan.bills, 'bill policy untouched');
  const sim = F.simulate(out.data.plan, input.asOf, { horizonDays: 3, weeklyVariable: 0 });
  return { ...out, report, sim };
}
const retained = [];
for (const kind of ['amanda', 'payroll']) {
  const input = fixture(kind), out = run(input);
  retained.push([input, out]);
  const cash = kind === 'payroll' ? 3500 : 2800.25; // opening 1000 + one real receipt
  eq(F.startingCashAmount(out.data.plan), cash, kind + ': actual posted stock retained');
  eq(out.data.plan.opening.representedEvents, [], kind + ': no invented early settlement');
  eq(out.data.liveOverlay.applied, true, kind + ': fresh balance overlay retained');
  eq(out.data.liveOverlay.operatingPlan, 'unavailable', kind + ': current operating claims held');
  eq(out.sim.status, 'unavailable', kind + ': standalone cash walk held');
  eq(out.sim.ending, null, kind + ': duplicate projected closing cash withheld, not zero');
  eq(out.sim.daily.map(row => row.balance), [null, null, null], kind + ': no daily forward cash leak');
  eq(out.sim.events.filter(row => row.kind === 'income').map(row => row.amount), [input.amount], kind + ': planned occurrence retained');
  eq(F.recommendWeekly(out.data.plan, input.asOf), null, kind + ': direct spend permission held');
}
for (const [kind, control] of [['amanda', 'bracketed'], ['amanda', 'same-day'], ['payroll', 'same-day'], ['payroll', 'unpaid']]) {
  const input = fixture(kind, control), out = run(input);
  eq(Object.hasOwn(out.report, 'incomeReconciliation'), false, kind + ' ' + control + ': conflict-free observer shape unchanged');
  eq(out.data.liveOverlay.operatingPlan, 'live', kind + ' ' + control + ': live availability unchanged');
  eq(out.sim.ending, kind === 'payroll' ? 3500 : 2800.25, kind + ' ' + control + ': independent closing cash');
}
function negative(name, mutate, kind = 'amanda') {
  const input = fixture(kind); mutate(input);
  const out = run(input);
  eq(Object.hasOwn(out.report, 'incomeReconciliation'), false, name + ': no qualified overlap manufactured');
}
const row = (x, id) => x.payload.transactions.find(tx => tx.id === id);
negative('no incoming Bills credit', x => x.payload.transactions.pop());
negative('untransferred external salary', x => x.payload.transactions.splice(1));
negative('no employer receipt', x => x.payload.transactions.shift());
negative('coaching merchant', x => row(x, 'invented-employer-receipt').payee = 'INVENTED COACHING CLIENT');
negative('wrong payroll merchant', x => x.payload.transactions[0].payee = 'INVENTED OTHER EMPLOYER', 'payroll');
negative('wrong Bills account', x => row(x, 'invented-transfer-credit').account_id = 'invented-cash-1');
negative('wrong payroll account', x => x.payload.transactions[0].account_id = 'invented-cash-1', 'payroll');
negative('wrong external identity', x => x.accountMap.mappings[3].externalId = 'invented-other-source');
negative('wrong external role', x => x.accountMap.mappings[3].atlasRole = 'household-reserve');
negative('source and transfer amounts differ', x => row(x, 'invented-employer-receipt').amount = -1733.18);
negative('counterpart amount differs', x => row(x, 'invented-transfer-debit').amount = 1733.18);
negative('non-income source', x => { row(x, 'invented-employer-receipt').is_income = false; row(x, 'invented-employer-receipt').category_name = 'Transfer'; });
negative('payroll debit', x => x.payload.transactions[0].amount = 2500, 'payroll');
negative('zero payroll', x => x.payload.transactions[0].amount = 0, 'payroll');
for (const id of ['invented-employer-receipt', 'invented-transfer-debit', 'invented-transfer-credit']) {
  negative(id + ' pending', x => row(x, id).is_pending = true);
  negative(id + ' foreign currency', x => row(x, id).currency = 'usd');
  negative(id + ' contradictory', x => row(x, id).contradictoryEvidence = true);
}
negative('pending payroll', x => x.payload.transactions[0].is_pending = true, 'payroll');
negative('foreign payroll', x => x.payload.transactions[0].currency = 'usd', 'payroll');
negative('future provider payroll row', x => x.payload.transactions[0].date = '2027-01-01', 'payroll');
negative('stale receipt from previous native interval', x => {
  x.payload.transactionWindow.startDate = '2026-12-01';x.payload.transactions[0].date = '2026-12-17';
}, 'payroll');
for (const key of ['complete', 'hasMore', 'truncated']) {
  const input = fixture(); input.payload.transactionWindow[key] = key !== 'complete';
  const report = O.observe({ provider: 'lunchmoney', ...input });
  eq(Object.hasOwn(report, 'incomeReconciliation'), false, key + ': incomplete packet does not qualify an income match');
}
for (const id of ['invented-employer-receipt', 'invented-transfer-debit', 'invented-transfer-credit']) {
  const input = fixture(); input.payload.transactions.push({ ...row(input, id), id: id + '-competing' });
  const out = run(input);
  eq(out.report.incomeReconciliation.status, 'unavailable', id + ': competing qualified packet cannot assure extra income');
  eq(out.data.plan.opening.representedEvents, [], id + ': competing packet cannot settle occurrence');
}
// Strong employer evidence may differ from the planned amount: this gate does
// not turn a plan amount into identity or require a new net-pay estimate.
{
  const input = fixture(); input.payload.transactions.forEach(tx => { tx.amount = tx.amount > 0 ? 1733.18 : -1733.18; });
  eq(run(input).report.incomeReconciliation.status, 'unavailable', 'different actual net salary still unresolved');
}
// A refresh rebuilds the transient gate and resolves it only through the
// incumbent supported matcher, never from its previous outcome.
{
  const [input, early] = retained[0], next = fixture('amanda', 'same-day');
  next.data = clone(early.data);
  const resolved = run(next);
  eq(Object.hasOwn(resolved.report, 'incomeReconciliation'), false, 'fresh supported occurrence resolves gate');
  eq(resolved.sim.ending, 2800.25, 'resolved opening is counted once');
  const again = clone(input); again.data = clone(early.data);
  eq(run(again).report.incomeReconciliation.status, 'unavailable', 'same-date refresh retains unresolved overlap');
  again.payload.transactions = [];
  eq(run(again).data.liveOverlay.operatingPlan, 'unavailable', 'missing row on same-date fetch does not resolve prior evidence');
}
// Exercise the real API projector and active renderer; pages print the same
// Forecast reason and never calculate a second conflict or financial total.
for (const [input, out] of retained) {
  const opts = OA.recommendOpts(out.data, {});
  const advice = F.recommend(out.data.plan, input.asOf, opts);
  eq(advice.weekly, null, 'recommend spend permission unavailable');
  eq(advice.sim.ending, null, 'recommend cash path unavailable');
  eq(advice.zero.ending, null, 'recommend unfunded path unavailable');
  eq(advice.knowledge.ending, null, 'master ending unavailable');
  eq(advice.paydayAllocation.available, null, 'income-backed cash allocation unavailable');
  eq(advice.paydayAllocation.liveCurrentBalance, input.amount + 1000, 'known current Bills stock survives');
  eq(advice.defaultView.balanceAfterDeductions, null, 'active period balance withheld');
  eq(F.incomeDeadline(out.data.plan, input.asOf, input.id).endingWithout, null, 'income guidance withheld');
  eq(advice.operatingPlanNote, out.data.liveOverlay.operatingPlanNote, 'one API/UI reason');
  const packet = Assistant.buildPacket({ data: out.data, asOf: input.asOf, periods: null, questionsMarkdown: '' });
  eq(packet.forecast.status, 'unavailable', 'assistant API forecast unavailable');
  eq(packet.forecast.reason, advice.operatingPlanNote, 'assistant reason agrees');
  eq(packet.planning.trajectory.status, 'unavailable', 'assistant trajectory cannot leak conditional cash');
  eq(packet.planning.trajectory.reason, advice.operatingPlanNote, 'trajectory shares income reason');
  eq(F.baselineTrajectory(out.data.plan, [], input.asOf).status, 'unavailable', 'standalone trajectory held');
  eq(F.baselineTrajectoryScenario(out.data.plan, [], input.asOf, { amount: 20, debtId: 'invented-card' }).status,
    'unavailable', 'trajectory scenario held');
  eq(F.hypotheticalExtraPayment(out.data.plan, [], input.asOf, { nature: 'hypothetical', amount: 20, debtId: 'invented-card' }).status,
    'unavailable', 'hypothetical cash comparison held');
  const context = { Forecast: F, console, module: { exports: {} }, money2: n => '$' + n.toFixed(2),
    fmtDateLong: x => x, fmtDate: x => x, escapeHtml: x => x, $: () => null };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8'), context);
  const html = context.module.exports.unavailableOperatingSurfaceHtml({ advice, liveOverlay: out.data.liveOverlay,
    planView: advice.defaultView, asOf: input.asOf, refreshTrust: null });
  eq(html.includes(advice.operatingPlanNote), true, 'active Budget prints shared unavailable reason');
  eq(html.includes('data-current-operating="unavailable"'), true, 'active Budget marks unavailable');
  eq(html.includes('data-live-current-balance-amount'), true, 'Budget keeps known current stock');
  eq(html.includes('Last trusted opening'), false, 'fresh posted stock is not mislabelled as an old opening');
  eq(Assistant.looksSanitized(packet), true, 'assistant publication sanitized');
}
console.log('PASS early income uncertainty: ' + checks + ' independent assertions; observed cash preserved, no early settlement, native interval, API projector and active Budget unavailable contract');
