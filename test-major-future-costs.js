'use strict';
/* Known major future costs live on plan.commitments (or the property-tax
 * reserve), once each, and are not Deep Dive prose. Undated rows do not
 * become cash events and do not change the 91-day weekly cap.
 *
 * Amounts below are the owner estimates from the 2026-08-16 instruction,
 * written as literals — not read back from the rows they prove.
 */
const F = require('./public/forecast.js');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const plan = data.plan;
const asOf = data.meta.asOf;
const windowEnd = F.addDays(asOf, (plan.windowDays || 91) - 1);
const rows = plan.commitments || [];
const byId = Object.fromEntries(rows.map(r => [r.id, r]));

const NEW_IDS = [
  'fusion-season',
  'burrards-team-fees',
  'seattle-nov',
  'seattle-dec',
  'christmas-2026',
  'downstairs-couch',
  'exterior-painting',
  'indio-tournament',
  'provincials',
  'home-insurance',
  'vehicle-maintenance',
];
const POINT = {
  'fusion-season': 2000,
  'burrards-team-fees': 700,
  'seattle-nov': 1200,
  'seattle-dec': 1200,
  'christmas-2026': 3500,
  'downstairs-couch': 1700,
  'provincials': 1000,
  'home-insurance': 3131.76,
  'vehicle-maintenance': 2400,
};
const RANGES = {
  'exterior-painting': [700, 1200],
  'indio-tournament': [5260, 5460],
};
const FLEXIBLE = ['downstairs-couch', 'exterior-painting'];
const PREEXISTING = ['burrard1', 'burrard2', 'fusioncamp', 'tryouts', 'warriors'];

console.log('=== each known major cost has one plan home ===');
for (const id of NEW_IDS.concat(['warriors'])) {
  const hits = rows.filter(r => r.id === id);
  ok(hits.length === 1, `exactly one plan.commitments row ${id}`);
}
ok(!(plan.bills || []).some(b => NEW_IDS.includes(b.id)),
  'none of the new costs is also a dated bill');
ok(!rows.some(r => r.id === 'property-tax' || r.id === 'propertytax'),
  'property tax is not a second plan.commitments row');
const property = (plan.budget.categories || []).find(c => c.id === 'propertytax');
ok(property && property.class === 'reserve'
  && /5,600|5600/.test(property.why) && /6,000|6000/.test(property.why)
  && /5,639\.67|5639\.67/.test(property.why),
  'property tax stays the reserve category, with the owner range and the Jul 2026 actual');

console.log('\n=== owner estimates are on the rows, not invented midpoints ===');
for (const [id, amount] of Object.entries(POINT)) {
  const row = byId[id];
  ok(row && near(row.amount, amount) && row.confidence === 'estimated',
    `${id} is the owner estimate $${amount}`,
    row ? String(row.amount) : 'missing');
  ok(row && row.date == null, `${id} has no fabricated date`);
}
for (const [id, [lo, hi]] of Object.entries(RANGES)) {
  const row = byId[id];
  ok(row && row.amount == null && near(row.amountMin, lo) && near(row.amountMax, hi),
    `${id} keeps the range $${lo}–$${hi} and invents no midpoint`);
  ok(row && row.date == null, `${id} has no fabricated date`);
}
for (const id of FLEXIBLE) {
  ok(byId[id] && byId[id].adjustable === true, `${id} is marked flexible`);
}
ok(byId.warriors && byId.warriors.date === '2026-09-15' && near(byId.warriors.amount, 800),
  'Warriors keeps its existing dated row — this PR does not invent a second one');

console.log('\n=== not merely prose ===');
ok(data.commitments.items == null && data.commitments.schedule == null,
  'data.commitments.items is gone — not a second list');
const pub = F.publicationTotals(data);
ok(Array.isArray(pub.commitmentItems)
  && NEW_IDS.every(id => pub.commitmentItems.some(i => i.id === id)),
  'Forecast.publicationTotals lists every absorbed cost from plan.commitments');
ok(!PREEXISTING.every(id => (data.commitments.note || '').includes(id)),
  'the Deep Dive note is chrome, not the row authority');

console.log('\n=== undated rows do not become 91-day cash ===');
const events = F.expandEvents(plan, asOf, windowEnd, {});
const newCash = events.filter(e => NEW_IDS.includes(e.id));
ok(newCash.length === 0,
  'expandEvents emits no cash event for an undated absorbed cost',
  newCash.map(e => e.id).join(',') || 'none');
ok(events.some(e => e.id === 'warriors' && e.date === '2026-09-15'),
  'Warriors still emits on its existing 15 September date');
const later = F.expandEvents(plan, asOf, '2027-12-31', {});
ok(!later.some(e => NEW_IDS.includes(e.id)),
  'a longer expander walk still invents no day for undated rows');

console.log('\n=== 91-day weekly cap is unchanged by undated rows ===');
const recOpts = {
  scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: plan.defaults.targetBuffer,
};
const withNew = F.recommend(plan, asOf, recOpts);
const withoutNew = F.recommend(plan, asOf, Object.assign({}, recOpts, { disabled: NEW_IDS }));
ok(withNew.weekly === withoutNew.weekly,
  'disabling the new undated rows does not change recommend.weekly',
  `$${withNew.weekly} vs $${withoutNew.weekly}`);
const budget = F.budgetBreakdown(plan, require('./public/periods.json'), {
  paypalPerMonth: data.paypal ? data.paypal.perMonth : 0,
  asOf,
});
ok(!(budget.sinkingItems || []).some(s =>
  /Fusion season|Burrards team fees|Seattle tournament|Christmas 2026|Downstairs couch|Exterior painting|Indio|Provincials|Home insurance|Vehicle maintenance/.test(s.label)),
  'undated rows are not smeared into 91-day sinkingMonthly');

console.log('\n=== published point-estimate total is independently summed ===');
const preexistingPoints = 800;
const absorbedPoints = 2000 + 700 + 1200 + 1200 + 3500 + 1700 + 1000 + 3131.76 + 2400;
const HAND_TOTAL = preexistingPoints + absorbedPoints;
ok(near(preexistingPoints, 800) && near(absorbedPoints, 16831.76)
  && near(HAND_TOTAL, 17631.76),
  'hand total is unsettled Warriors $800 plus the absorbed point estimates; settled rows are excluded');
ok(near(pub.commitmentsTotal, HAND_TOTAL),
  'publicationTotals matches that independent sum',
  String(pub.commitmentsTotal));
ok(!pub.commitmentItems.some(i => i.id === 'exterior-painting' && i.amount != null)
  && !pub.commitmentItems.some(i => i.id === 'indio-tournament' && i.amount != null),
  'open ranges contribute no point amount to the total');

console.log('\n=== ON TRACK / AT RISK / FUNDING GAP is not invented here ===');
ok(!NEW_IDS.some(id => /ON TRACK|AT RISK|FUNDING GAP/.test(JSON.stringify(byId[id]))),
  'no absorbed row carries a B94 verdict');
ok(!/ON TRACK|AT RISK|FUNDING GAP/.test(JSON.stringify(pub.commitmentItems)),
  'publicationTotals does not publish those verdicts');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll major-future-cost checks passed.');
