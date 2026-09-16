'use strict';
/* Owner 2026-09-16 Fusion household + Logan Warriors U13 plan.commitments.
 * Independent of expandEvents: remaining instalments sum to $3,300 and the
 * paid row drops out once settledOn is on or before the opening. */
const F = require('../public/forecast.js');
const data = require('../data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const plan = data.plan;
const rows = plan.commitments || [];
const byId = Object.fromEntries(rows.map(r => [r.id, r]));

console.log('=== owner Fusion + Warriors rows load once ===');
ok(!byId['fusion-season'], 'stale fusion-season row is absent');
for (const id of ['warriors', 'fusion-household-paid', 'fusion-household-oct',
  'fusion-household-nov', 'fusion-household-dec']) {
  ok(rows.filter(r => r.id === id).length === 1, `exactly one row ${id}`);
}

console.log('\n=== Fusion remaining does not double-count paid ===');
const remainingIds = ['fusion-household-oct', 'fusion-household-nov', 'fusion-household-dec'];
const remainingSum = remainingIds.reduce((s, id) => s + byId[id].amount, 0);
ok(near(remainingSum, 3300), 'Oct/Nov/Dec sum to $3,300', String(remainingSum));
ok(near(byId['fusion-household-paid'].amount + remainingSum, 4500),
  'paid $1,200 + remaining $3,300 = household $4,500 total');
const pubSep17 = F.publicationTotals(Object.assign({}, data, {
  meta: Object.assign({}, data.meta, { asOf: '2026-09-17' }),
}));
const fusionUnsettledAfter = pubSep17.commitmentItems
  .filter(i => /^fusion-household-/.test(i.id))
  .reduce((s, i) => s + (i.amount || 0), 0);
ok(near(fusionUnsettledAfter, 3300),
  'Sep 17 opening counts only remaining Fusion instalments',
  String(fusionUnsettledAfter));
ok(!pubSep17.commitmentItems.some(i => i.id === 'fusion-household-paid'),
  'paid Fusion row drops out after settledOn');

console.log('\n=== Warriors + tax encoding ===');
ok(byId.warriors.date === '2026-09-23'
  && byId.warriors.amount == null && near(byId.warriors.amountMin, 895),
  'Warriors is dated $895 floor, tax not a point amount');
const events = F.expandEvents(plan, data.meta.asOf, F.addDays(data.meta.asOf, 90), {});
ok(!events.some(e => e.id === 'warriors'),
  'Warriors does not emit a cash event with invented tax');
const mp = F.majorPlans(plan, data.meta.asOf, { weeklyVariable: 0 });
const w = mp.find(p => p.id === 'warriors');
ok(w && w.amountMin === 895 && w.need == null,
  'majorPlans keeps Warriors as a dated range floor');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFusion/Warriors plan commitment checks passed.');
