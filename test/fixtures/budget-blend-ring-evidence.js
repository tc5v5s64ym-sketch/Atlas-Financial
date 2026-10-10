'use strict';
// Fixture only. Reuses the invented observations in other-period-target;
// no real account data, prototype values, or production imports.
const fx = require('./other-period-target');

// Independent cents from the fixture inputs: Groceries plan 22000,
// observed 11037; Fuel plan 8500, observed zero. These expectations are
// not calculated with Forecast or the presentation adapter.
const expected = Object.freeze({
  groceries: Object.freeze({
    id: 'groceries', planned: '$220.00', spent: '$110.37',
    status: '$109.63 left', remaining: '$109.63', fraction: 10963 / 22000,
  }),
  zero: Object.freeze({
    id: 'fuel', planned: '$85.00', spent: '$0.00',
    status: '$85.00 left', remaining: '$85.00', fraction: 1,
  }),
  incompleteStatus: 'Remaining unavailable',
});

function packet(coverage = 'complete') {
  if (!['complete', 'partial', 'unknown'].includes(coverage)) {
    throw new Error('Unknown ring-evidence coverage fixture: ' + coverage);
  }
  return fx.build(137.26, fx.asOf, coverage === 'complete' ? {} : { pendingCoverage: coverage }).data;
}

module.exports = { packet, expected };
