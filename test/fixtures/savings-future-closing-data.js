'use strict';
const fx = require('./chronological-savings-data');
module.exports = function input() {
  const x = fx.ledger();
  x.plan.income = [{ ...x.plan.income[0], amount: 0 },
    { id: 'p1', label: 'Invented first receipt', frequency: 'once', date: '2026-10-16', amount: 1000, confidence: 'confirmed' },
    { id: 'p2', label: 'Invented second receipt', frequency: 'once', date: '2026-10-30', amount: 1000, confidence: 'confirmed' }];
  x.plan.commitments = [
    { id: 'a', label: 'Invented first goal', date: '2026-12-18', amount: 1500, confidence: 'confirmed', sinkingFund: true },
    { id: 'b', label: 'Invented second goal', date: '2027-01-04', amount: 1000, confidence: 'confirmed', sinkingFund: true }];
  return x;
};
