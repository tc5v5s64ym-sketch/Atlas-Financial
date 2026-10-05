'use strict';
// Independently invented input ledgers; no household/provider data.
const clone = value => JSON.parse(JSON.stringify(value));
const AS_OF = '2026-10-05';
function fixture() {
  return {
    asOf: AS_OF,
    plan: {
      windowDays: 91, opening: { asOf: AS_OF,
        paydaySnapshot: { periodStart: '2026-10-02', asOf: '2026-10-02', opening: 20 },
        representedEvents: [{ id: 'payroll', date: '2026-10-02' }] },
      defaults: { targetBuffer: 20, extraDebtMonthly: 0, scenario: 'expected' },
      startingCash: { breakdown: [
        { id: 'chequing-a', value: 200 }, { id: 'chequing-b', value: 0 },
        { id: 'savings', value: 95 },
      ], heldElsewhere: [{ id: 'savings-dont-touch', value: 24, class: 'purpose-reserve' }] },
      income: [{ id: 'payroll', label: 'Invented payroll', frequency: 'biweekly',
        anchor: '2026-10-02', amount: 200, confidence: 'confirmed' }],
      bills: [{ id: 'routine', label: 'Invented operating bill', frequency: 'biweekly',
        anchor: '2026-10-10', amount: 40, confidence: 'confirmed' },
      { id: 'home-cost', label: 'Invented annual home cost', frequency: 'yearly', month: 10, day: 25,
        firstDue: '2026-10-25', amount: 24, confidence: 'confirmed', jointCash: false }],
      obligations: [],
      commitments: [
        { id: 'near', label: 'Invented first club cost', group: 'club', date: '2026-10-21',
          amount: 60, confidence: 'confirmed', adjustable: false, sinkingFund: true },
        { id: 'far', label: 'Invented second club cost', group: 'club', date: '2026-10-28',
          amount: 170, confidence: 'confirmed', adjustable: false, sinkingFund: true },
      ], groups: [{ id: 'club', label: 'Invented club costs', planSpendSummary: true }],
      budget: { categories: [{ id: 'groceries', label: 'Invented groceries', class: 'essential',
        plannedPayday: 80, plannedWeekly: 40, confidence: 'confirmed' }] },
      savingsEarmarks: { version: 1, currency: 'CAD', history: [], pools: [
        { id: 'club-pool', accountId: 'savings', label: 'Invented club pool', role: 'purpose-reserve',
          purpose: 'Invented club', goalRefs: [{ kind: 'group', id: 'club' }] },
        { id: 'home-pool', accountId: 'savings-dont-touch', label: 'Invented home pool', role: 'purpose-reserve',
          reconciledOn: AS_OF, purpose: 'Invented home', goalRefs: [{ kind: 'yearly-bill', id: 'home-cost' }] },
      ] },
      savingsPoolObservation: { asOf: AS_OF, accounts: [
        { accountId: 'savings', value: 95, currency: 'CAD', source: 'provider-observe:lunchmoney',
          evidenceDate: AS_OF, pendingState: 'clear' },
        { accountId: 'savings-dont-touch', value: 24, currency: 'CAD', source: 'provider-observe:lunchmoney',
          evidenceDate: AS_OF, pendingState: 'clear' },
      ] },
    },
    opts: {
      weeklyVariable: 40,
      // Approved replacement policy represented with independent synthetic provenance.
      savingsAllocationPolicy: { schema: 'atlas-savings-daily-policy/v1', confirmedAt: AS_OF,
        source: 'Invented policy confirmation', order: 'due-date-first-within-pool',
        periodBasis: 'operating-surplus-before-proposals' },
      currentPeriodActuals: { schema: 'atlas-current-period-actuals/v1', currency: 'CAD',
        observationAsOf: AS_OF, coverageStart: '2026-10-02', coverageThrough: AS_OF,
        pendingCoverage: 'complete', transactionCoverage: { complete: true },
        representedActuals: [{ id: 'payroll', date: '2026-10-02', actual: 200, transactionId: 'income-1' }], transactions: [
          { id: 'income-1', date: '2026-10-02', amount: -200, pending: false, isIncome: true,
            atlasAccountId: 'chequing-a', accountRole: 'household-cash', currency: 'CAD',
            incomeId: 'payroll', displayedPayee: 'Invented payroll' },
          { id: 'food-1', date: '2026-10-03', amount: 20, pending: false, atlasAccountId: 'chequing-a',
            accountRole: 'household-cash', currency: 'CAD', categoryId: 'groceries',
            categoryLabel: 'Groceries', displayedPayee: 'Invented grocer' },
        ] },
    },
  };
}
function transfer(input, amount, reference = 'AA101', destination = 'savings', date = input.asOf) {
  const target = input.plan.savingsPoolObservation.accounts.find(row => row.accountId === destination);
  input.plan.startingCash.breakdown[0].value -= amount;
  target.value += amount;
  const mirror = input.plan.startingCash.breakdown.concat(input.plan.startingCash.heldElsewhere)
    .find(row => row.id === destination);
  mirror.value = target.value;
  input.opts.currentPeriodActuals.transactions.push(
    { id: reference + '-out', date, amount, pending: false, currency: 'CAD',
      atlasAccountId: 'chequing-a', accountRole: 'household-cash', kindHint: 'transfer',
      originalMerchant: reference + ' TFR-TO Invented reserve', excludeFromTotals: true },
    { id: reference + '-in', date, amount: -amount, pending: false, currency: 'CAD',
      atlasAccountId: destination, accountRole: 'household-reserve', kindHint: 'transfer',
      originalMerchant: reference + ' TFR-FR Invented operating', excludeFromTotals: true });
  return input;
}
function advance(input, asOf) {
  input.asOf = input.plan.opening.asOf = asOf;
  input.plan.savingsPoolObservation.asOf = asOf;
  input.plan.savingsPoolObservation.accounts.forEach(row => { row.evidenceDate = asOf; });
  input.opts.currentPeriodActuals.observationAsOf = input.opts.currentPeriodActuals.coverageThrough = asOf;
  return input;
}
function monthBoundaryFixture() {
  const input = advance(transfer(fixture(), 80), '2026-10-31');
  input.plan.commitments[0].date = '2026-11-14'; input.plan.commitments[1].date = '2026-11-21';
  input.plan.bills[1].month = 12; input.plan.bills[1].firstDue = '2026-12-25';
  input.plan.startingCash.breakdown[0].value = 210;
  input.plan.opening.paydaySnapshot = { periodStart: '2026-10-30', asOf: '2026-10-30', opening: 20 };
  input.plan.opening.representedEvents = [{ id: 'payroll', date: '2026-10-30' }];
  input.opts.currentPeriodActuals.coverageStart = '2026-10-30';
  input.opts.currentPeriodActuals.representedActuals.push({ id: 'payroll', date: '2026-10-30', actual: 200, transactionId: 'month-income' });
  input.opts.currentPeriodActuals.transactions.push(
    { id: 'month-income', date: '2026-10-30', amount: -200, currency: 'CAD', pending: false,
      isIncome: true, atlasAccountId: 'chequing-a', accountRole: 'household-cash', displayedPayee: 'Invented month payroll' },
    { id: 'month-food', date: '2026-10-31', amount: 10, currency: 'CAD', pending: false,
      atlasAccountId: 'chequing-a', accountRole: 'household-cash', categoryLabel: 'Groceries' });
  return input;
}
module.exports = { AS_OF, clone, fixture, transfer, advance, monthBoundaryFixture };
