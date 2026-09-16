'use strict';
/* Owner + Interac Fusion $1,200 paid row; remaining instalments $3,300 only
 * after settledOn relative to opening. */
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

console.log('\n=== Fusion paid settled on Interac evidence ===');
const paid = byId['fusion-household-paid'];
ok(paid && near(paid.amount, OWNER_PAID) && paid.settledOn === '2026-09-10',
  'paid row is $1,200 settledOn 2026-09-10');
ok(/C1AkZfteDgMe|logan and lindens first payment/i.test(paid.note || ''),
  'note cites Interac ref and memo');
ok(/live LM id PENDING|do not invent LM transaction id/i.test(paid.note || ''),
  'LM id left pending — Interac settledOn only');
ok(/576\.19.*602\.44|Linden.*Logan/i.test(paid.note || ''),
  'Kara split noted; no further kid allocations invented');
ok(/50 percent of Fall term fees/i.test(paid.note || '')
  && /never plan\.income|baselineTrajectory income/i.test(paid.note || ''),
  'coaching cover is settlement context with income policy lock');
ok(!(plan.income || []).some(s => /3125|Lavinio|Cavalcante/i.test(JSON.stringify(s))),
  'plan.income has no coaching bonus row for Fusion settlement context');
ok(!paid.lmId && !paid.lunchMoneyId,
  'row carries no invented LM id field');

const remainingSum = ['fusion-household-oct', 'fusion-household-nov', 'fusion-household-dec']
  .reduce((s, id) => s + byId[id].amount, 0);
ok(near(remainingSum, REMAINING), 'remaining instalments sum to $3,300', String(remainingSum));
ok(near(OWNER_PAID + remainingSum, HOUSEHOLD_TOTAL),
  'paid + remaining = $4,500 household total');

const pubAfter = F.publicationTotals(Object.assign({}, data, {
  meta: Object.assign({}, data.meta, { asOf: '2026-09-11' }),
}));
const fusionAfter = pubAfter.commitmentItems
  .filter(i => /^fusion-household-/.test(i.id))
  .reduce((s, i) => s + (i.amount || 0), 0);
ok(near(fusionAfter, REMAINING),
  'after 2026-09-11 opening, publication encumbers remaining Fusion only',
  String(fusionAfter));
ok(!pubAfter.commitmentItems.some(i => i.id === 'fusion-household-paid'),
  'paid Fusion row drops from publication after settledOn');

console.log('\n=== Warriors unchanged ===');
ok(byId.warriors.date === '2026-09-23' && near(byId.warriors.amountMin, 895),
  'Warriors due 23 Sep, $895 pre-tax floor');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nFusion/Warriors plan commitment checks passed.');
