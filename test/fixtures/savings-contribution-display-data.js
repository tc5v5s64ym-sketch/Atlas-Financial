'use strict';
// Independently invented household; no live or scaled household observations.
// Next payday capacity: 1300 - 240 - 160 - 310 = 590.
// A 875 goal due before the following payday therefore requires 285 now.
module.exports = function savingsContributionDisplayData() {
  const data = require('./budget-funding-data')();
  data.meta.title = 'Synthetic savings contribution display';
  data.plan.income[0].amount = 1300;
  data.plan.bills[0].amount = 240;
  data.plan.bills[1].amount = 160;
  data.plan.budget.categories[0].plannedPayday = 310;
  data.plan.budget.categories[0].plannedWeekly = 155;
  data.plan.commitments = [
    { id: 'garden-course', label: 'Garden course', date: '2026-09-10', amount: 875, confidence: 'confirmed' },
    { id: 'reading-nook', label: 'Reading nook with a deliberately long goal name', amount: 410, confidence: 'estimated' },
  ];
  return data;
};
