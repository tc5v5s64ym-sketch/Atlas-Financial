'use strict';
// Every account, goal, balance and assignment in this file is synthetic.
const { fixture: incumbent } = require('../test-savings-evidence-integration');
const AS_OF = '2026-08-20';
const clone = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const input = incumbent();
  input.data.plan.commitments = [
    { id: 'trip-a', label: 'Synthetic trip', date: '2026-10-02', amount: 403.21, confidence: 'confirmed', adjustable: false },
    { id: 'club-first', label: 'Synthetic club first', group: 'club-a', amount: 87.11, date: '2026-10-04', confidence: 'confirmed', adjustable: false },
    { id: 'club-second', label: 'Synthetic club second', group: 'club-a', amount: 91.09, date: '2026-11-04', confidence: 'confirmed', adjustable: false },
  ];
  input.data.plan.groups = [{ id: 'club-a', label: 'Synthetic club', planSpendSummary: true }];
  input.data.plan.bills.push({ id: 'annual-a', label: 'Synthetic annual bill', amount: 181.23,
    frequency: 'yearly', month: 12, day: 11, firstDue: '2026-12-11', jointCash: false, confidence: 'confirmed' });
  input.data.plan.savingsEarmarks = { version: 1, currency: 'CAD', pools: [
    { id: 'reserve-a', accountId: 'savings', label: 'Synthetic reserve A' },
    { id: 'reserve-b', accountId: 'synthetic-reserve-b', label: 'Synthetic reserve B' },
  ], history: [{ revision: 1, confirmedAt: '2026-08-19', source: 'Synthetic owner confirmation', pools: [
    { poolId: 'reserve-a', allocations: [
      { goalRef: { kind: 'commitment', id: 'trip-a' }, amount: 169.37 },
      { goalRef: { kind: 'yearly-bill', id: 'annual-a' }, amount: 78.43 },
    ] },
    { poolId: 'reserve-b', allocations: [{ goalRef: { kind: 'group', id: 'club-a' }, amount: 99.99 }] },
  ] }] };
  input.map.mappings.push({ providerAccountId: '1004', canonical: { collection: 'cash', id: 'synthetic-reserve-b' }, atlasRole: 'household-reserve' });
  input.payload.accounts.find(a => a.id === 1003).balance = 301.17;
  input.payload.accounts.push({ id: 1004, type: 'cash', balance: 144.08, currency: 'cad', balance_as_of: AS_OF + 'T17:55:00.000Z' });
  return input;
}
function observedPlan() {
  const input = fixture();
  input.data.plan.savingsPoolObservation = { asOf: AS_OF, accounts: [
    { accountId: 'savings', value: 301.17, currency: 'CAD', evidenceDate: AS_OF, pendingState: 'clear', source: 'provider-observe:lunchmoney' },
    { accountId: 'synthetic-reserve-b', value: 144.08, currency: 'CAD', evidenceDate: AS_OF, pendingState: 'clear', source: 'provider-observe:lunchmoney' },
  ] };
  return input.data.plan;
}
function propertyTaxFixture() {
  const input = fixture();
  input.data.plan.budget.categories.push({ id: 'synthetic-property-tax', label: 'Synthetic property tax',
    class: 'reserve', plannedAmount: 487.63, planningDate: '2026-10-21', confidence: 'estimated' });
  input.data.plan.savingsEarmarks.history[0].pools[1].allocations = [
    { goalRef: { kind: 'budget-reserve', id: 'synthetic-property-tax' }, amount: 103.27 },
    { goalRef: { kind: 'yearly-bill', id: 'annual-a' }, amount: 11.13 },
  ];
  return input;
}
module.exports = { AS_OF, fixture, observedPlan, propertyTaxFixture, clone };
