'use strict';
// Independently invented ledgers; canonical data and provider reads are excluded.
const fx = require('./savings-daily-allocation-contract');
const consumer = require('./savings-daily-consumer-data');
function policy(input) {
  input.plan.savingsEarmarks.allocationPolicy = { order: 'due-date-first-combined-pool',
    effectiveFrom: '2026-10-07', source: 'Independent invented one-pot owner instruction' };
  return input;
}
function ledger() {
  const input = policy(fx.advance(fx.fixture(), '2026-10-07'));
  input.plan.income[0].amount = 0; // calendar only, no future receipt assumed
  input.plan.bills = []; input.plan.budget.categories = [];
  input.plan.commitments = [input.plan.commitments[0]];
  input.plan.startingCash.breakdown[0].value = input.plan.opening.paydaySnapshot.opening = 80;
  input.plan.savingsPoolObservation.accounts[0].value = input.plan.startingCash.breakdown[2].value = 30;
  input.plan.savingsPoolObservation.accounts[1].value = input.plan.startingCash.heldElsewhere[0].value = 89;
  input.opts.currentPeriodActuals.transactions = []; input.opts.currentPeriodActuals.representedActuals = [];
  input.plan.income.push({ id: 'future-gift', label: 'Invented future receipt', frequency: 'once',
    date: '2026-11-02', amount: 77, confidence: 'estimated' });
  return input;
}
function data(mode = 'ready') {
  const d = consumer('ready');
  const input = policy(fx.advance({plan:d.plan,opts:{currentPeriodActuals:d.liveOverlay.currentPeriodActuals}},'2026-10-07'));
  d.meta.asOf = input.asOf;
  d.plan.savingsPoolObservation.accounts[0].value = d.plan.startingCash.breakdown[2].value = 30;
  d.plan.savingsPoolObservation.accounts[1].value = d.plan.startingCash.heldElsewhere[0].value = 89;
  d.plan.commitments.push({ id:'trip', label:'Invented winter trip', date:'2027-01-15', amount:37,
    confidence:'confirmed', sinkingFund:true });
  if (mode === 'deposit') fx.transfer(input,10,'AA101','savings-dont-touch');
  if (mode === 'settled') d.plan.commitments[0].settledOn = '2026-10-04';
  if (mode === 'missing') d.plan.savingsPoolObservation.accounts.pop();
  if (mode === 'stale') d.plan.savingsPoolObservation.accounts[1].evidenceDate = '2026-10-06';
  if (mode === 'pending') d.plan.savingsPoolObservation.accounts[1].pendingState = 'unresolved';
  if (mode === 'negative') d.plan.savingsPoolObservation.accounts[1].value = -1;
  if (mode === 'undated') delete d.plan.commitments[1].date;
  d.liveOverlay.observedCash = { asOf:input.asOf,complete:true,accounts:d.plan.startingCash.breakdown
    .filter(row=>row.id.startsWith('chequing')).map(row=>({...row,evidenceDate:input.asOf})) };
  return d;
}
module.exports = {ledger,data,policy};