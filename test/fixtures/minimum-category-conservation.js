'use strict';
const assert = require('node:assert/strict');

// These salary-only ledgers have no category IDs. Extend the immutable
// pre-protocol expected report with exactly the two declared schema additions;
// never delete actual fields or relax comparison of any historical value.
module.exports = function minimumCategoryExpectation(report, input, historicalObserver) {
  assert.ok(!Object.hasOwn(report, 'cardMinimumCategoryEvidence'),
    'historical baseline predates the minimum category packet');
  const expected = JSON.parse(JSON.stringify(report));
  for (const field of ['transactions', 'collapsedTransactions']) {
    assert.ok(Array.isArray(expected[field]), field + ' remains part of whole-payload conservation');
    for (const tx of expected[field]) {
      assert.equal(tx.categoryId, null, 'salary fixture cannot supply a minimum category ID');
      assert.ok(!Object.hasOwn(tx, 'minimumCategoryDebt'), 'historical transaction predates the new leaf');
      tx.minimumCategoryDebt = null;
    }
  }
  expected.cardMinimumCategoryEvidence = {
    source: 'lunchmoney-minimum-category',
    asOf: historicalObserver.householdFinancialDate(input, report.observations),
    payments: [],
  };
  return expected;
};
