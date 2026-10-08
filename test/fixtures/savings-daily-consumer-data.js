'use strict';
// Independent invented ledger, wrapped for the real authenticated-page consumer.
const fx = require('./savings-daily-allocation-contract');
module.exports = function dailyConsumerData(mode = 'ready') {
  const input = fx.fixture();
  input.plan.savingsEarmarks.allocationPolicy = { order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-05', source: 'Independent invented owner policy' };
  if (mode === 'before-policy') fx.advance(input, '2026-10-04');
  if (mode === 'ranged-need') {
    delete input.plan.commitments[1].amount;
    input.plan.commitments[1].amountMin = 170;
    input.plan.commitments[1].amountMax = 190;
  }
  if (mode === 'fully-backed') {
    input.plan.savingsPoolObservation.accounts[0].value = 230;
    input.plan.startingCash.breakdown[2].value = 230;
  }
  if (mode === 'partial') fx.transfer(input, 30);
  if (mode === 'full') fx.transfer(input, 80);
  if (mode === 'multiple') { fx.transfer(input, 30); fx.transfer(input, 20, 'BB202'); }
  if (mode === 'returned') {
    fx.transfer(input, 80); fx.transfer(input, -20, 'CC303');
    input.opts.currentPeriodActuals.transactions.at(-2).originalMerchant = 'CC303 TFR-FR Invented reserve';
    input.opts.currentPeriodActuals.transactions.at(-1).originalMerchant = 'CC303 TFR-TO Invented operating';
  }
  if (mode === 'pending') { fx.transfer(input, 30); input.opts.currentPeriodActuals.transactions.slice(-2).forEach(tx => { tx.pending = true; }); }
  if (mode === 'unmatched') { fx.transfer(input, 30); input.opts.currentPeriodActuals.transactions.pop(); }
  if (mode === 'missing-stock') input.plan.savingsPoolObservation.accounts.pop();
  if (mode === 'missing-cash') delete input.plan.startingCash.breakdown[0].value;
  if (mode === 'saved-income') {
    input.plan.commitments[1].amount = 500;
    input.plan.startingCash.breakdown[0].value += 500; input.plan.opening.paydaySnapshot.opening += 500;
    input.plan.savingsPoolObservation.accounts[0].value += 80; input.plan.startingCash.breakdown[2].value += 80;
    input.opts.currentPeriodActuals.transactions.push({ id: 'saved-income', date: input.asOf, amount: -80,
      pending: false, currency: 'CAD', atlasAccountId: 'savings', accountRole: 'household-reserve',
      isIncome: true, displayedPayee: 'Invented saved gift' });
  }
  const data = require('./budget-funding-data')();
  data.meta = { asOf: input.asOf, title: 'Invented daily Savings consumer review' };
  data.plan = input.plan;
  data.liveOverlay = { applied: true, operatingPlan: 'live', currentPeriodActuals: input.opts.currentPeriodActuals,
    observedCash: { asOf: input.asOf, complete: true, accounts: input.plan.startingCash.breakdown
      .filter(row => row.id.startsWith('chequing')).map(row => ({ ...row, evidenceDate: input.asOf })) } };
  return data;
};
