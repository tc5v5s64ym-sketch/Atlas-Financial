'use strict';
// Independently invented dates/cents. No canonical or provider inputs.
module.exports = function input(mode = 'ready') {
  const x = require('./savings-future-closing-data')();
  x.plan.groups = [{ id: 'installments', label: 'Invented installments', planSpendSummary: true }];
  x.plan.commitments = [
    { id: 'early', label: 'Invented early installment', group: 'installments', date: '2026-10-21', amount: 50 },
    { id: 'boundary', label: 'Invented boundary installment', group: 'installments', date: '2026-10-29', amount: 30 },
    { id: 'next', label: 'Invented next installment', group: 'installments', date: '2026-10-30', amount: 40 },
    { id: 'later', label: 'Invented later goal', date: '2026-11-13', amount: 80 },
  ].map(c => ({ ...c, confidence: 'confirmed', sinkingFund: true }));
  x.opts.currentPeriodActuals.transactionCoverage = 'complete';
  if (mode === 'card') x.opts.currentPeriodActuals.cardCoverageRequired = true;
  if (mode === 'missing') delete x.opts.currentPeriodActuals;
  if (mode === 'stale') x.plan.savingsPoolObservation.accounts[1].evidenceDate = '2026-10-06';
  if (mode === 'undated') delete x.plan.commitments[3].date;
  return x;
};
