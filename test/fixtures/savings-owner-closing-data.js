'use strict';
const base = require('./savings-future-closing-data');
module.exports = function input(operating = 80, income = 400) {
  const x = base();
  x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = operating;
  x.plan.savingsPoolObservation.accounts[0].value = x.plan.startingCash.breakdown[2].value = 300;
  x.plan.savingsPoolObservation.accounts[1].value = x.plan.startingCash.heldElsewhere[0].value = 0;
  x.plan.income[1].amount = x.plan.income[2].amount = income;
  x.plan.commitments = [
    { id: 'a', label: 'Invented first cost', date: '2026-10-21', amount: 500, confidence: 'confirmed', sinkingFund: true },
    { id: 'b', label: 'Invented second cost', date: '2026-11-04', amount: 400, confidence: 'confirmed', sinkingFund: true }];
  return x;
};
