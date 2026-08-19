'use strict';
/* Deliberately live household reconciliation. `node test-live-household.js`
 *
 * These assertions exist because the current canonical figure itself is the
 * thing under test. They are allowed to fail when that figure is intentionally
 * mutated. Behaviour suites must not copy them.
 */
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const payroll = data.plan.income.find(s => s.id === 'payroll');
const EMP004_LO = 4247.92;
const EMP004_HI = 4274.98;

console.log('=== live payroll vs EMP-004 observed net range ===');
ok(!!payroll, 'payroll is present on the plan');
ok(payroll && payroll.amount >= EMP004_LO && payroll.amount <= EMP004_HI,
  'canonical payroll net sits inside the EMP-004 observed deposit range',
  payroll ? `$${payroll.amount} vs $${EMP004_LO}–$${EMP004_HI}` : 'missing');

console.log('\n=== live as-of ===');
ok(typeof data.meta.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.meta.asOf),
  'published as-of is an explicit YYYY-MM-DD date', data.meta.asOf);
ok(data.plan.opening && data.plan.opening.asOf === data.meta.asOf,
  'plan.opening.asOf agrees with meta.asOf');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
