'use strict';
// Independent invented ledger (the daily-allocation contract household),
// wrapped for the real authenticated-page consumer. Mode 'ready' adds one
// yearly card-paid bill carrying the production fee identity so the real
// Forecast publishes its yearly-bill funding row; mode 'no-fee' omits it.
// All labels and amounts are invented; no household/provider data.
const fx = require('./savings-daily-allocation-contract');
module.exports = function travelVisaAnnualFeeData(mode = 'ready') {
  const input = fx.fixture();
  input.plan.savingsEarmarks.allocationPolicy = { order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-05', source: 'Independent invented owner policy' };
  if (mode === 'ready') {
    input.plan.bills.push({ id: 'travelvisa-annual-fee-2027', label: 'Travel Visa annual fee',
      frequency: 'yearly', month: 10, day: 6, firstDue: '2027-10-06', amount: 149,
      confidence: 'estimated', dateConfidence: 'estimated', jointCash: false,
      payingAccount: 'travelvisa' });
  }
  const data = require('./budget-funding-data')();
  data.meta = { asOf: input.asOf, title: 'Invented Travel Visa annual fee review' };
  data.plan = input.plan;
  data.liveOverlay = { applied: true, operatingPlan: 'live', currentPeriodActuals: input.opts.currentPeriodActuals,
    observedCash: { asOf: input.asOf, complete: true, accounts: input.plan.startingCash.breakdown
      .filter(row => row.id.startsWith('chequing')).map(row => ({ ...row, evidenceDate: input.asOf })) } };
  return { data, input };
};
