'use strict';
const fixture = require('./savings-future-closing-data');
module.exports = function input(priorSurplus = 100, deficit = 200, stock = 500, operating = 20) {
  const x = fixture();
  x.plan.startingCash.breakdown[0].value = x.plan.opening.paydaySnapshot.opening = operating;
  x.plan.savingsPoolObservation.accounts[0].value = x.plan.startingCash.breakdown[2].value = stock;
  x.plan.savingsPoolObservation.accounts[1].value = x.plan.startingCash.heldElsewhere[0].value = 0;
  x.plan.income[1].amount = priorSurplus; x.plan.income[2].amount = 0;
  x.plan.commitments[0].date = '2027-01-03';
  x.plan.bills = [{ id: 'routine', label: 'Invented next-period routine bill', frequency: 'once',
    date: '2026-11-03', amount: deficit, confidence: 'confirmed' }];
  return x;
};
