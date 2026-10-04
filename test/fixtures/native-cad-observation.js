'use strict';
// These legacy synthetic observation suites supply invented native CAD amounts.
// Declare their units at the fixture boundary, without changing assertions or
// assigning household payment purpose. Explicit foreign/null units survive.
// Production and the new missing/foreign-unit proof do not use this helper.
const payload = source => source && { ...source,
  transactions: (source.transactions || []).map(row => ({ currency: 'cad', ...row })) };
module.exports = observer => ({ ...observer,
  observe(input) { return observer.observe({ ...input, payload: payload(input.payload) }); },
  sanitizedCurrentPeriodActuals(report, opts) {
    return observer.sanitizedCurrentPeriodActuals({ ...report,
      ...(report.transactions ? { transactions: payload(report).transactions } : {}),
      ...(report.collapsedTransactions ? { collapsedTransactions:
        payload({ transactions: report.collapsedTransactions }).transactions } : {})
    }, opts);
  }
});
