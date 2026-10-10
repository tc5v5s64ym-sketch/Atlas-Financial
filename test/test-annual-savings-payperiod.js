'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const F = require('../public/forecast');
const { ledger } = require('./fixtures/chronological-savings-data');
const { advance, clone } = require('./fixtures/savings-daily-allocation-contract');

// Independent invented ledger: 80 operating + 119 savings; 60 club due
// October 21, 17.29 annual premium due October 25, 77 receipt November 2.
// The insurance recurrence is the same yearly-card-paid class as Square One.
function fixture(premium = 17.29) {
  const i = advance(ledger(), '2026-10-10');
  i.plan.income[0].anchor = '2026-08-14';
  i.plan.opening.paydaySnapshot = { periodStart: '2026-10-09', asOf: '2026-10-09', opening: 80 };
  i.plan.opening.representedEvents = [];
  i.opts.currentPeriodActuals.coverageStart = '2026-10-09';
  i.plan.bills = [{ id: 'annual', label: 'Invented annual premium', amount: premium,
    frequency: 'yearly', month: 10, day: 25, firstDue: '2026-10-25',
    jointCash: false, confidence: 'estimated' }];
  return i;
}
const run = i => F.recommend(i.plan, i.asOf, { ...i.opts, debts: i.debts || [], weeklyVariable: 0 });
const period = (a, start) => a.payPeriodViews.find(p => p.start === start);
const figures = p => [p.incomeTotal, p.periodBillLoad, p.totalBillsThisPeriod,
  p.remainingBills, p.budgetHold, p.afterBills, p.balanceAfterDeductions];
const point = (a, date) => {
  assert.equal(a.savingsFunding.timeline.status, 'ready', a.savingsFunding.timeline.reason);
  return a.savingsFunding.timeline.daily.find(row => row.date === date);
};

test('annual savings cost stays off payday Bills and October current figures stay unchanged', () => {
  const i = fixture(), before = JSON.stringify(i), a = run(i);
  const without = clone(i); without.plan.bills = [];
  assert.deepEqual(figures(period(a, '2026-10-09')), figures(period(run(without), '2026-10-09')));
  const next = period(a, '2026-10-23');
  assert.deepEqual(figures(next), [77, 0, 0, 0, 0, 77, 77],
    '77 receipt minus zero routine bills and zero Household Budget; no second 17.29 deduction');
  assert.ok(!next.bills.some(row => row.id === 'annual'));
  assert.equal(next.predictedEndingBalanceTerms.assignedBills, 0);
  assert.equal(next.predictedEndingBalanceTerms.closes, true);
  assert.equal(JSON.stringify(i), before, 'no input, paid state, date or estimate mutation');
});

test('one dated obligation consumes savings once and conserves household cash', () => {
  const i = fixture(), a = run(i), s = a.savingsFunding;
  const occurrence = F.expandEvents(i.plan, i.asOf, '2026-11-05').filter(e => e.id === 'annual');
  assert.equal(occurrence.length, 1);
  assert.equal(occurrence[0].date, '2026-10-25');
  assert.equal(occurrence[0].amount, -17.29);
  assert.equal(occurrence[0].confidence, 'estimated');
  assert.equal(s.backing.items.find(row => row.id === 'annual').needed, 17.29);
  assert.equal(s.backing.items.find(row => row.id === 'annual').saved, 17.29);
  const payments = s.timeline.payments.filter(row => row.id === 'annual');
  assert.equal(payments.length, 1);
  assert.equal(payments[0].amount, 17.29);
  assert.equal(payments[0].fromCurrentStock, 17.29);
  assert.equal(payments[0].fromProjectedTopups, 0);
  for (const [date, operating, savings, total] of [
    ['2026-10-10', 80, 119, 199],
    ['2026-10-21', 80, 59, 139],
    ['2026-10-25', 80, 41.71, 121.71],
    ['2026-11-02', 157, 41.71, 198.71],
  ]) {
    const row = point(a, date);
    assert.deepEqual([row.operatingCash, row.savingsCash, row.combinedHouseholdCash], [operating, savings, total]);
    assert.equal(Math.round(row.operatingCash * 100) + Math.round(row.savingsCash * 100), Math.round(total * 100));
  }
  assert.equal(period(a, '2026-10-23').plannedCostFunding.billPaymentsAlreadyDeducted, 0);
  assert.equal(period(a, '2026-10-23').plannedCostFunding.proposedFundingForBillPayments, 0);
});

test('unfunded premium is still a real dated shortage, never erased or financed by later income', () => {
  const i = fixture(200), a = run(i);
  const row = a.savingsFunding.backing.items.find(row => row.id === 'annual');
  assert.equal(row.needed, 200);
  assert.equal(row.saved, 59, '119 stock less earlier 60 club cost');
  const e = F.expandEvents(i.plan, i.asOf, '2026-11-05').find(e => e.id === 'annual');
  assert.equal(e.amount, -200);
  assert.equal(e.reserveFunding.amount, 59);
  const sim = F.simulate(i.plan, i.asOf, { ...i.opts, weeklyVariable: 0 });
  assert.equal(sim.daily.find(row => row.date === '2026-10-25').balance, -61,
    '80 operating less 141 unfunded premium; November receipt cannot fund October');
  assert.equal(a.savingsFunding.schedule.status, 'funding-gap');
  assert.equal(a.savingsFunding.actionPermission, 'not-granted');
});

test('missing savings or unknown premium retains requirement and fails funding closed', () => {
  for (const kind of ['stock', 'premium']) {
    const i = fixture();
    if (kind === 'stock') i.plan.savingsPoolObservation.accounts.pop();
    else delete i.plan.bills[0].amount;
    const a = run(i), s = a.savingsFunding;
    assert.equal(s.backing.status, 'unavailable');
    assert.equal(s.period.proposal, null);
    assert.equal(s.timeline.status, 'unavailable');
    const annual = [...s.backing.items, ...s.unresolved].find(row => row.id === 'annual');
    assert.ok(annual, 'obligation remains named');
    assert.equal(annual.needed, kind === 'stock' ? 17.29 : null);
    assert.equal(annual.saved, null);
  }
});

test('ordinary card bills and yearly joint-cash bills retain their existing paycheck deductions', () => {
  const i = fixture();
  i.plan.bills.push(
    { id: 'monthly-card', label: 'Invented monthly card bill', amount: 11.13, frequency: 'monthly',
      day: 24, jointCash: false, confidence: 'estimated' },
    { id: 'annual-cash', label: 'Invented annual cash bill', amount: 23.17, frequency: 'yearly',
      month: 10, day: 26, confidence: 'confirmed' });
  const next = period(run(i), '2026-10-23');
  assert.deepEqual(next.bills.map(row => row.id), ['monthly-card', 'annual-cash']);
  assert.equal(next.periodBillLoad, 34.30);
  assert.equal(next.balanceAfterDeductions, 42.70);
});

test('undated annual cost remains an unknown savings requirement without a payday bill', () => {
  const i = fixture(); i.plan.bills[0].needsDate = true;
  const a = run(i), s = a.savingsFunding;
  assert.equal(s.status, 'unavailable');
  assert.ok(s.unresolved.some(row => row.id === 'annual' && row.date === null && row.needed === 17.29));
  assert.ok(!a.defaultView.undatedBills.some(row => row.id === 'annual'));
  assert.ok(!F.expandEvents(i.plan, i.asOf, '2026-11-05').some(row => row.id === 'annual'));
});

test('routine remainder cannot release an unfunded or unknown annual premium into extra debt', () => {
  const i = fixture(200);
  i.plan.nextDollar = { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' };
  i.debts = [{ id: 'card', label: 'Invented card', structure: 'Revolving credit', balance: 500,
    rate: 20, pending: 0, limit: 1000, secured: false, confidence: 'verified' }];
  const next = period(run(i), '2026-10-23');
  assert.equal(next.balanceAfterDeductions, 77, 'routine income less Bills and Household Budget stays 77');
  assert.equal(next.extraDebt.allocated, 0, '141 unbacked premium is protected before the 20 floor');
  const before = period(run(i), '2026-11-06');
  assert.ok(before.opening == null || before.opening < 80,
    'internal carry cannot restore the 141 unfunded expense');
  delete i.plan.bills[0].amount;
  assert.equal(period(run(i), '2026-10-23').extraDebt.allocated, null, 'unknown amount grants no new debt instruction');
  i.plan.bills[0].amount = 200; i.plan.bills[0].needsDate = true;
  assert.equal(period(run(i), '2026-10-23').extraDebt.allocated, null, 'unknown timing grants no new debt instruction');
});
