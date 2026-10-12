'use strict';
const assert = require('node:assert/strict');

// These salary-only ledgers have no category IDs. Extend the immutable
// pre-protocol expected report with exactly the declared schema additions;
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
  assert.ok(!input.accountMap.mappings.some(row => ['savings', 'savings-dont-touch'].includes(row.canonical?.id)),
    'these salary-only ledgers have no canonical Savings accounts');
  assert.ok(!Object.hasOwn(expected.currentPeriodActuals, 'savingsMovementUnconfirmed'),
    'historical actuals predate the account-scoped Savings provenance leaf');
  expected.currentPeriodActuals.savingsMovementUnconfirmed = [];
  const rawWindow = input.payload.transactionWindow || input.payload.transaction_window || {};
  const originalDate = keys => {
    const values = keys.filter(key => Object.hasOwn(rawWindow, key)).map(key => rawWindow[key]);
    return values.length && values.every(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && value === values[0]) ? values[0] : null;
  };
  const sourceWindow = { complete: Object.hasOwn(rawWindow, 'complete') && rawWindow.complete === true
    && ['hasMore', 'has_more', 'truncated'].every(key => !Object.hasOwn(rawWindow, key)
      || rawWindow[key] == null || rawWindow[key] === false),
    startDate: originalDate(['startDate', 'start_date']), endDate: originalDate(['endDate', 'end_date']) };
  assert.ok(!Object.hasOwn(expected.transactionWindow, 'savingsFetchCoverage'));
  assert.ok(!Object.hasOwn(expected.currentPeriodActuals, 'savingsFetchCoverage'));
  expected.transactionWindow.savingsFetchCoverage = sourceWindow;
  expected.currentPeriodActuals.savingsFetchCoverage = sourceWindow;
  return expected;
};
