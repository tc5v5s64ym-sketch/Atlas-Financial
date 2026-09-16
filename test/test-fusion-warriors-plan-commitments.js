'use strict';
/* Owner 2026-09-16 Fusion household + Warriors U13 plan.commitments.
 * Independent sums: remaining instalments $3,300; owner $1,200 paid is note-only
 * (amount null, no settledOn / no LM twin) so publication does not encumber it. */
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
const OWNER_PAID = 1200;
const REMAINING = 3300;
const HOUSEHOLD_TOTAL = 4500;

console.log('=== stale rows retired (owner supersedes) ===');
ok(!byId['fusion-season'], 'fusion-season ~$2,000 row removed — not open beside new rows');
ok(!rows.some(c => c.id === 'warriors' && c.amount != null && near(c.amount, 800)
  && c.date === '2026-09-15'),
  'warriors ~$800 / Sep 15 stale row replaced — not left open');

console.log('\n=== owner Fusion + Warriors rows load once ===');
for (const id of ['warriors', 'fusion-household-paid', 'fusion-household-oct',
  'fusion-household-nov', 'fusion-household-dec']) {
  ok(rows.filter(r => r.id === id).length === 1, `exactly one row ${id}`);
}

console.log('\n=== Fusion remaining does not double-count paid ===');
const remainingIds = ['fusion-household-oct', 'fusion-household-nov', 'fusion-household-dec'];
const remainingSum = remainingIds.reduce((s, id) => s + byId[id].amount, 0);
ok(near(remainingSum, REMAINING), 'Oct/Nov/Dec sum to $3,300', String(remainingSum));
ok(near(OWNER_PAID + remainingSum, HOUSEHOLD_TOTAL),
  'owner narrative $1,200 paid + $3,300 remaining = $4,500 household total');
ok(byId['fusion-household-paid'].amount == null && !byId['fusion-household-paid'].settledOn,
  'paid portion has no amount and no settledOn (NEAR_MATCH not promoted to LM settlement)');
ok(/NEAR_MATCH/i.test(byId['fusion-household-paid'].note || ''),
  'paid note records NEAR_MATCH pending LM confirmation');
const pub = F.publicationTotals(data);
const fusionEncumbered = pub.commitmentItems
  .filter(i => /^fusion-household-/.test(i.id))
  .reduce((s, i) => s + (i.amount || 0), 0);
ok(near(fusionEncumbered, REMAINING),
  'publicationTotals encumbers only remaining Fusion instalments',
  String(fusionEncumbered));

console.log('\n=== Warriors + tax encoding ===');
ok(byId.warriors.date === '2026-09-23'
  && byId.warriors.amount == null && near(byId.warriors.amountMin, 895),
  'Warriors is dated $895 floor, tax not a point amount');
ok(/no LM ~\$895 payment/i.test(byId.warriors.note || '')
  && /PDF/i.test(byId.warriors.note || ''),
  'Warriors note: PDF fee context, no LM ~$895 posted yet');
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
