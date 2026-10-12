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
  // Authorized addition (outgoing e-transfer review list): the sanitized
  // packet now stamps an identity boolean on every row and carries the
  // transaction window bounds. These salary-only ledgers contain no
  // SEND E-TFR descriptor, so every expected boolean is exactly false, and
  // the expected window is the report's own normalized window re-stamped
  // in the packet's shape — no historical value is deleted or relaxed.
  const packet = expected.currentPeriodActuals;
  assert.ok(packet && Array.isArray(packet.transactions),
    'current-period packet remains part of whole-report conservation');
  assert.ok(!Object.hasOwn(packet, 'transactionWindow'),
    'historical packet predates the window-bounds leaf');
  for (const tx of packet.transactions) {
    assert.ok(!Object.hasOwn(tx, 'outgoingETransferIdentity'),
      'historical packet row predates the identity boolean');
    tx.outgoingETransferIdentity = false;
  }
  const w = expected.transactionWindow || {};
  packet.transactionWindow = {
    startDate: w.startDate || null,
    endDate: w.endDate || null,
    complete: w.complete === true ? true : w.complete === false ? false : null,
    hasMore: w.hasMore === true ? true : w.hasMore === false ? false : null,
    truncated: w.truncated === true,
  };
  return expected;
};
