'use strict';
/* Live Plan residual: a posted Travel Visa Bell Mobility debit is the
 * incumbent bell-sep15-2026 (September) or bell (recurring from
 * 2026-10-15) actual, not Other spending. Identity is the existing
 * bill-settlement mechanism (payee + Travel Visa + debit +
 * early-or-covers-due). Amount is not identity. Forecast remains the
 * classifier. Synthetic observe fixtures and independent arithmetic
 * (L-002 / L-006).
 *
 * `node test/test-bell-travelvisa-classification.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const SEP_AS_OF = '2026-09-16';
const SEP_ID = 'bell-sep15-2026';
const SEP_DUE = '2026-09-15';
const SEP_TX = 283.94;
const REC_ID = 'bell';
const REC_DUE = '2026-10-15';
const REC_AS_OF = '2026-10-16';
const REC_TX = 159.03;
const OTHER_TX = 19.17;
const EARLY_RULE = 'covers-early-or-due-on-or-before-posting';
const TRAVEL_PROVIDER_ID = 2004;
