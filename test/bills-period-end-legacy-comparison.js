'use strict';
const assert = require('node:assert/strict');

// Frozen engines predate this authorized addition. These probes have no
// actuals packet, so validate its concrete unavailable publication paths
// before comparing every incumbent field. Do not move a frozen baseline.
module.exports = function incumbentAdvice(value, asOf) {
  let publications = 0;
  const visit = (row, path) => {
    if (Array.isArray(row)) return row.map((child, index) => visit(child, path + '/' + index));
    if (!row || typeof row !== 'object') return row;
    const entries = [];
    for (const [key, child] of Object.entries(row)) {
      const childPath = path + '/' + key;
      if (key !== 'billsAccountPeriodBalance') { entries.push([key, visit(child, childPath)]); continue; }
      assert.match(childPath, /^\/(?:defaultView|defaultView\/calendarPeriods\/\d+|payPeriodViews\/\d+)\/billsAccountPeriodBalance$/);
      assert(child && typeof child === 'object', 'the added publication is present');
      assert.equal(child.source, 'Forecast.billsAccountPeriodBalance');
      assert.equal(child.accountId, 'chequing-a'); assert.equal(child.scope, 'bills-only');
      assert.equal(child.currency, 'CAD'); assert.equal(child.asOf, asOf);
      assert.equal(child.status, 'unavailable', 'absent actuals cannot establish a closing estimate');
      assert.equal(child.trust, 'unknown'); assert.equal(child.amount, null);
      assert.equal(child.grantsSpendPermission, false);
      assert(child.issues.some(issue => issue.code === 'posted-window-incomplete'));
      assert.equal(typeof child.reason, 'string'); assert(child.reason.length > 0);
      publications++;
    }
    return Object.fromEntries(entries);
  };
  const copy = visit(value, '');
  assert.equal(publications, 3, 'validate the default, active calendar and current timeline publications');
  return copy;
};
