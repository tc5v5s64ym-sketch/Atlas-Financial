'use strict';
// Independent supplied-dollar ledger, exercised through recommend (not a
// second invocation of the allocator as an oracle). All data is synthetic.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const fixture = require('./fixtures/budget-funding-data');
const AS_OF = '2026-08-20';
function state() {
  const data = fixture();
  data.meta.asOf = data.plan.opening.asOf = AS_OF;
  data.plan.opening.priorAsOf = '2026-08-13';
  data.plan.startingCash.breakdown[0].value = 1000;
  data.plan.defaults.targetBuffer = 50;
  data.plan.bills.push({ id: 'still-due', label: 'Still due', frequency: 'once',
    date: '2026-08-25', amount: 150, confidence: 'confirmed' });
  data.plan.obligations.push({ id: 'minimum', label: 'Required card payment',
    debtId: 'travelvisa', effect: 'payment', frequency: 'once', date: '2026-08-25',
    amount: 25, confidence: 'confirmed' });
  data.debts = [{ id: 'travelvisa', structure: 'Revolving', balance: 400,
    pending: 50, rate: 20, limit: 1000 }];
  const packet = { schema: 'atlas-current-period-actuals/v1', observationAsOf: AS_OF,
    coverageStart: '2026-08-14', coverageThrough: AS_OF,
    transactionCoverage: 'complete', pendingCoverage: 'complete', transactions: [
      { id: 'synthetic-groceries', date: '2026-08-19', amount: 50, account: 'travelvisa',
        accountRole: 'revolving-credit', categoryLabel: 'Groceries', displayedPayee: 'Synthetic grocer', pending: true },
      { id: 'synthetic-payroll', date: '2026-08-14', amount: -1000, account: 'chequing-a',
        accountRole: 'household-cash', categoryLabel: 'Income', kindHint: 'income', pending: false },
    ] };
  return { data, packet };
}
const run = s => F.recommend(s.data.plan, AS_OF,
  { debts: s.data.debts, currentPeriodActuals: s.packet });
const current = a => a.payPeriodViews.find(p => p.start === '2026-08-14');
const today = s => current(run(s)).fromTodayFunding;
const s = state(), before = JSON.stringify(s), a = run(s), f = current(a).fromTodayFunding;
assert.equal(f.status, 'ready');
assert.equal(f.currentCash, 1000, 'payroll is already in the observed opening, not another 1000');
assert.equal(f.operatingBills, 200 + 150 + 25);
assert.equal(f.remainingHousehold, 300 - 50, 'pending card purchase fulfills consumption once');
assert.equal(f.requiredOperatingCash, 200 + 150 + 25 + 250 + 50);
assert.equal(f.availableNow, 1000 - 200 - 150 - 25 - 250 - 50);
assert.equal(f.contribution, 600 - (1000 - 200 - 150 - 300));
assert.equal(f.cashAfterProposal, 1000 - 250);
assert.equal(f.items[0].cumulativeProposed, 250);
assert.equal(f.items[0].remainingGap, 350);
assert.equal(f.periods[1].contribution, 350);
assert.equal(f.periods[1].items[0].cumulativeProposed, 600);
assert.equal(f.periods[1].items[0].remainingGap, 0);
assert.equal(f.periods[1].protectedAfterPayments, 0, 'payment consumes the earmark, not new cash twice');
assert.equal(f.actualSaved, null);
assert.equal(f.items[0].actualSaved, null);
assert.equal(f.originalPaydayPlan, null);
assert.equal(current(a).plannedCostFunding.contribution, null);
assert.equal(a.payPeriodViews.find(p => p.start === '2026-08-28').plannedCostFunding.contribution, 350,
  'existing future-payday income capacity stays consistent');
assert.deepEqual(run(s), a, 'identical refreshes produce identical publications');
assert.equal(JSON.stringify(s), before, 'no inputs, observations or saved balance written');

// A paid bill is inside the lower cash balance. Settlement releases its hold
// exactly once; the resulting proposal is unchanged, not $200 richer.
const paid = state();
paid.data.plan.startingCash.breakdown[0].value -= 200;
paid.data.plan.opening.representedEvents = [{ id: 'bill', date: '2026-08-14' }];
const paidFunding = today(paid);
assert.equal(paidFunding.operatingBills, 150 + 25);
assert.equal(paidFunding.availableNow, f.availableNow);
assert.equal(paidFunding.contribution, 250);

// Card posting and interest: 450 principal accrues six days before the
// Aug 25 payment and one day after it; the cash payment is still only $25.
const posted = state(); posted.packet.transactions[0].pending = false;
posted.data.debts[0].balance = 450; posted.data.debts[0].pending = 0;
assert.deepEqual(today(posted), f);
for (const input of [s, posted]) {
  const debt = F.projectDebts(input.data.plan, input.data.debts, AS_OF, { debtHorizonDays: 7 });
  const expected = (450 * (1 + .20 / 365) ** 6 - 25) * (1 + .20 / 365);
  assert.ok(Math.abs(debt.byId.travelvisa.balance - expected) < 1e-9);
  assert.equal(debt.byId.travelvisa.paid, 25);
}
const issuer = state();
issuer.packet.transactions.push({ ...issuer.packet.transactions[0], id: 'synthetic-interest',
  amount: 20, categoryLabel: 'Interest charge', displayedPayee: 'INTEREST CHARGE -PURCHASE' });
issuer.data.debts[0].pending = 70;
assert.equal(today(issuer).remainingHousehold, 250, 'issuer interest is debt, not household consumption');
assert.equal(today(issuer).contribution, 250);
const issuerWalk = F.projectDebts(issuer.data.plan, issuer.data.debts, AS_OF, { debtHorizonDays: 1 });
assert.ok(Math.abs(issuerWalk.byId.travelvisa.interest - 470 * .20 / 365) < 1e-9);
issuer.data.debts[0].pending = 50;
assert.equal(today(issuer).contribution, null, 'issuer charges also require complete facility evidence');

// Extra cash already received may back the opening but is never added again
// from an Other Income, refund or internal-transfer observation.
for (const [label, kind] of [['Other Income', 'income'], ['Refund', 'refund'], ['Transfer', 'transfer']]) {
  const extra = state(); extra.data.plan.startingCash.breakdown[0].value += 125;
  extra.packet.transactions.push({ id: 'synthetic-' + kind, date: AS_OF, amount: -125,
    account: 'chequing-a', accountRole: 'household-cash', categoryLabel: label,
    kindHint: kind, pending: false });
  const got = today(extra);
  assert.equal(got.currentCash, 1125);
  assert.equal(got.availableNow, f.availableNow + 125);
  assert.equal(got.contribution, 250);
  assert.equal(got.futureIncomeThisPeriod, 0);
}
const reserves = state();
reserves.data.plan.startingCash.breakdown.push({ id: 'savings', value: 9000 });
reserves.data.plan.startingCash.heldElsewhere = [{ id: 'silver', value: 9000 }];
assert.deepEqual(today(reserves), f, 'shared savings / silver cannot double-count or become spendable');

const arriving = state();
arriving.data.plan.income.push({ id: 'future-confirmed', label: 'Future confirmed receipt',
  frequency: 'once', date: '2026-08-25', amount: 500, confidence: 'confirmed' });
assert.equal(today(arriving).availableNow, f.availableNow, 'future receipts cannot fund today');
assert.equal(today(arriving).futureIncomeThisPeriod, 500);
const onPayday = state();
onPayday.data.plan.opening.asOf = '2026-08-14';
delete onPayday.data.plan.opening.priorAsOf;
onPayday.packet.observationAsOf = onPayday.packet.coverageThrough = '2026-08-14';
onPayday.packet.transactions = [];
onPayday.data.debts[0].pending = 0;
const paydayAdvice = F.recommend(onPayday.data.plan, '2026-08-14', {
  debts: onPayday.data.debts, currentPeriodActuals: onPayday.packet });
const paydayFunding = current(paydayAdvice).fromTodayFunding;
assert.equal(paydayFunding.currentCash, 1000);
assert.equal(paydayFunding.futureIncomeThisPeriod, 0, 'same-day scheduled payroll is not added to observed cash');
assert.equal(paydayFunding.availableNow, 1000 - 200 - 150 - 25 - 300 - 50);
assert.equal(paydayFunding.contribution, 250);

const poor = state(); poor.data.plan.startingCash.breakdown[0].value = 750;
const gap = today(poor);
assert.equal(gap.status, 'funding-gap');
assert.equal(gap.contribution, 750 - 675);
assert.equal(gap.gap.shortBy, 250 - 75);
assert.equal(gap.items[0].remainingGap, 600 - 75);
assert.equal(gap.periods[1].contribution, null);
assert.match(gap.periods[1].reason, /2026-08-20.*175.00.*Named cost/);
const insufficient = state(); insufficient.data.plan.startingCash.breakdown[0].value = 100;
assert.equal(today(insufficient).contribution, 0);
assert.equal(today(insufficient).operatingShortfall, 675 - 100);

const overdue = state(); overdue.data.plan.commitments[0].date = '2026-08-19';
assert.match(today(overdue).reason, /overdue/);
assert.equal(today(overdue).items[0].date, '2026-08-19');
assert.equal(today(overdue).contribution, null);
const undated = state(); undated.data.plan.commitments.push({ id: 'unknown-date', label: 'Undated cost',
  amount: 100, confidence: 'estimated' });
assert.equal(today(undated).unscheduled.find(r => r.id === 'unknown-date').contribution, null);
assert.equal(today(undated).unscheduled.find(r => r.id === 'unknown-date').date, null);
assert.equal(today(undated).trust, 'estimated');
const beforePayday = state(); beforePayday.data.plan.commitments[0].date = '2026-08-26';
const near = today(beforePayday);
assert.equal(near.contribution, 325, 'near deadline cannot wait for the next payroll');
assert.equal(near.gap.shortBy, 600 - 325);

for (const [name, change] of [
  ['missing actuals', x => { x.packet = null; }],
  ['incomplete coverage', x => { x.packet.transactionCoverage = 'truncated'; }],
  ['unknown pending', x => { x.packet.pendingCoverage = 'unknown'; }],
  ['stale observation', x => { x.packet.observationAsOf = '2026-08-19'; }],
  ['stale cash', x => { x.data.plan.opening.asOf = '2026-08-19'; }],
  ['null cash', x => { x.data.plan.startingCash.breakdown[0].value = null; }],
  ['missing cash', x => { x.data.plan.startingCash.breakdown = []; }],
  ['duplicate cash', x => { x.data.plan.startingCash.breakdown.push({ ...x.data.plan.startingCash.breakdown[0] }); }],
  ['unsupported pending card', x => { x.data.debts[0].pending = 49; }],
  ['duplicate pending observation', x => { x.packet.transactions.push({ ...x.packet.transactions[0] }); }],
  ['missing transaction amount', x => { x.packet.transactions[0].amount = null; }],
  ['duplicate posted identity', x => { x.packet.transactions.push({ ...x.packet.transactions[1] }); }],
  ['unknown cost', x => { x.data.plan.commitments[0].amount = null; }],
]) {
  const input = state(); change(input);
  const got = today(input);
  assert.equal(got.status, 'unavailable', name);
  assert.equal(got.contribution, null, name);
}
const withheld = current(F.recommend(s.data.plan, AS_OF, { debts: s.data.debts,
  currentPeriodActuals: s.packet, operatingPlan: 'unavailable' })).fromTodayFunding;
assert.equal(withheld.contribution, null, 'stale operating plan cannot publish a current proposal');
const estimatedCash = state(); estimatedCash.data.plan.startingCash.breakdown[0].confidence = 'estimated';
assert.equal(today(estimatedCash).trust, 'estimated');

// Supported rolling-year horizon uses only already-authorized payroll rules.
const year = state(); year.data.plan.payrollPlanningAssumptions = {
  salaryRaiseFactor: 1.04, bonusRate: 0, authorizedThroughYear: 2027 };
const yearFunding = today(year);
assert.ok(yearFunding.through >= '2027-08-01');
assert.ok(yearFunding.through <= '2027-08-20');
assert.equal(yearFunding.trust, 'estimated');
assert.equal(yearFunding.periods.length, 26);
console.log('PASS from-today funding: independent current-cash ledger, settlement, gaps, evidence, horizon and no mutation');
