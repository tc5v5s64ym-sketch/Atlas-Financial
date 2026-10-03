'use strict';
const fixture = require('./budget-funding-data');
function backedFixture() {
  const data = fixture(), plan = data.plan;
  plan.startingCash.heldElsewhere = [{ id: 'savings-dont-touch', class: 'purpose-reserve', value: 99.99 }];
  plan.savingsEarmarks = { version: 1, currency: 'CAD', pools: [
    { id: 'sports', accountId: 'savings', role: 'purpose-reserve', purpose: 'Synthetic sports' },
    { id: 'home', accountId: 'savings-dont-touch', role: 'purpose-reserve', purpose: 'Synthetic home', reconciledOn: data.meta.asOf },
  ], history: [{ revision: 1, confirmedAt: data.meta.asOf, source: 'Synthetic confirmation', pools: [
    { poolId: 'sports', allocations: [{ goalRef: { kind: 'commitment', id: 'named-cost' }, amount: 169.37 }] },
    { poolId: 'home', allocations: [] },
  ] }] };
  plan.savingsPoolObservation = { asOf: data.meta.asOf, accounts: [
    { accountId: 'savings', value: 301.17, currency: 'CAD', evidenceDate: data.meta.asOf, pendingState: 'clear', source: 'provider-observe:lunchmoney' },
    { accountId: 'savings-dont-touch', value: 99.99, currency: 'CAD', evidenceDate: data.meta.asOf, pendingState: 'clear', source: 'provider-observe:lunchmoney' },
  ] };
  return data;
}
module.exports = { backedFixture };
