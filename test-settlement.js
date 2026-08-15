'use strict';
/* B91 D3 — settlement-aware commitments.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Live Fusion camp / tryouts stay unsettled. This suite proves the
 * mechanism on synthetic fixtures plus the preserved Aug. 14 observations.
 *
 * Independent proof: hand subtraction of named amounts. That is not a
 * second call to expandEvents or simulate.
 */
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const F = require('./public/forecast.js');
const R = require('./scripts/reconcile.js');
const live = require('./data.json');
const settlements = require('./docs/reconciliation/commitment-settlements.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const money = n => '$' + Number(n).toFixed(2);
const clone = x => JSON.parse(JSON.stringify(x));
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const SETTLED_ON = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const independentlySettled = c =>
  typeof c.settledOn === 'string' && SETTLED_ON.test(c.settledOn);

const START = '2026-08-14';
const END = F.addDays(START, 27);
const OPENING = 2000;
const CAMP = 786;
const SIBLING = 50;
const CAMP_DATE = '2026-08-20';
const PAID_BEFORE_OPENING = '2026-08-10';

function fixture(extraCommitments) {
  return {
    windowDays: 28,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: OPENING },
    income: [],
    obligations: [],
    bills: [],
    commitments: extraCommitments || [
      {
        id: 'camp',
        date: CAMP_DATE,
        label: 'Fusion camp (synthetic)',
        amount: CAMP,
        confidence: 'estimated',
        sinkingFund: true,
      },
      {
        id: 'sibling',
        date: CAMP_DATE,
        label: 'Same-day sibling',
        amount: SIBLING,
        confidence: 'confirmed',
        sinkingFund: true,
      },
    ],
  };
}

function commitmentCash(plan) {
  return (plan.commitments || [])
    .filter(c => !independentlySettled(c) && c.date >= START && c.date <= END)
    .reduce((s, c) => s + Number(c.amount || 0), 0);
}

console.log('=== A. unsettled $786 future commitment reserves $786 ===');
{
  const plan = fixture();
  const events = F.expandEvents(plan, START, END, {});
  const camp = events.find(e => e.id === 'camp');
  ok(!!camp && camp.date === CAMP_DATE && near(camp.amount, -CAMP),
    'unsettled camp produces a cash event of −$786', money(camp && camp.amount));
  const independent = commitmentCash(plan);
  ok(near(independent, CAMP + SIBLING),
    'independent walk reserves camp + sibling', money(independent));
  const sim = F.simulate(plan, START, { weeklyVariable: 0 });
  ok(near(sim.ending, OPENING - independent),
    'unsettled ending is opening minus both commitments', money(sim.ending));
  ok(near(sim.totals.commitments, independent),
    'Forecast commitment total matches the independent walk');
}

console.log('\n=== B. canonical settledOn excludes the camp from Forecast ===');
{
  const plan = fixture();
  plan.commitments[0].settledOn = PAID_BEFORE_OPENING;
  ok(independentlySettled(plan.commitments[0]),
    'independent predicate reads settledOn as settlement');
  ok(F.commitmentStatus(plan.commitments[0]) === 'settled',
    'derived status is settled');
  const events = F.expandEvents(plan, START, END, {});
  ok(!events.some(e => e.id === 'camp'),
    'settled camp produces no future cash event');
  ok(near(commitmentCash(plan), SIBLING),
    'independent walk now reserves only the sibling');
  const sim = F.simulate(plan, START, { weeklyVariable: 0 });
  ok(near(sim.ending, OPENING - SIBLING),
    'settled ending is opening minus the sibling only', money(sim.ending));
  ok(near(sim.totals.commitments, SIBLING),
    'Forecast commitment total is the sibling only');
}

console.log('\n=== C. same-day sibling still fires ===');
{
  const plan = fixture();
  plan.commitments[0].settledOn = PAID_BEFORE_OPENING;
  const events = F.expandEvents(plan, START, END, {});
  const sibling = events.find(e => e.id === 'sibling');
  ok(!!sibling && sibling.date === CAMP_DATE && near(sibling.amount, -SIBLING),
    'sibling on the same date still fires at −$50');
  ok(events.filter(e => e.date === CAMP_DATE).length === 1,
    'exactly one cash event remains on that date');
}

console.log('\n=== D. settling changes ending cash by exactly +$786 ===');
{
  const unsettled = F.simulate(fixture(), START, { weeklyVariable: 0 });
  const settledPlan = fixture();
  settledPlan.commitments[0].settledOn = PAID_BEFORE_OPENING;
  const settled = F.simulate(settledPlan, START, { weeklyVariable: 0 });
  const delta = Math.round((settled.ending - unsettled.ending) * 100) / 100;
  ok(near(delta, CAMP),
    'settled ending − unsettled ending is +$786', money(delta));
  ok(near(unsettled.ending + CAMP, settled.ending),
    'hand identity: unsettled ending + $786 = settled ending');
}

console.log('\n=== E. settlement before the Forecast opening date is respected ===');
{
  const plan = fixture();
  plan.commitments[0].settledOn = PAID_BEFORE_OPENING;
  ok(PAID_BEFORE_OPENING < START, 'settledOn is strictly before the opening date');
  ok(CAMP_DATE > START, 'the commitment date is still in the future');
  const events = F.expandEvents(plan, START, END, {});
  ok(!events.some(e => e.id === 'camp'),
    'a pre-opening settlement still excludes the future-dated camp');

  const misuse = F.expandEvents(fixture(), START, END, {
    representedEvents: [{ id: 'camp', date: CAMP_DATE }],
  });
  ok(misuse.some(e => e.id === 'camp' && near(e.amount, -CAMP)),
    'representedEvents does not hide a future-dated paid commitment');
}

console.log('\n=== F. evidence that it was paid does not write data.json ===');
{
  const before = hashFile(R.DEFAULT_DATA);
  const liveCamp = live.plan.commitments.find(c => c.id === 'fusioncamp');
  const liveTryouts = live.plan.commitments.find(c => c.id === 'tryouts');
  ok(liveCamp && liveCamp.amount === CAMP && !independentlySettled(liveCamp),
    'live fusioncamp is still the $786 unsettled canonical row');
  ok(liveTryouts && liveTryouts.amount === 140 && !independentlySettled(liveTryouts),
    'live tryouts are still the $140 unsettled canonical row');

  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements,
  });
  const campRow = result.rows.find(r => r.observationId === 'payday-fusioncamp-settled');
  const tryRow = result.rows.find(r => r.observationId === 'payday-tryouts-settled');
  ok(campRow && campRow.status === 'CHANGE' && campRow.canonicalSettledOn == null,
    'Aug. 14 camp observation vs unsettled canonical is CHANGE');
  ok(tryRow && tryRow.status === 'CHANGE' && tryRow.canonicalSettledOn == null,
    'Aug. 14 tryouts observation vs unsettled canonical is CHANGE');

  const out = execFileSync(process.execPath, ['scripts/reconcile.js'], {
    cwd: __dirname, encoding: 'utf8',
  });
  const after = hashFile(R.DEFAULT_DATA);
  ok(before === after, 'running the CLI leaves data.json bytes unchanged');
  ok(/does not write data\.json/.test(out),
    'the printed report repeats the no-write contract');
  ok(/payday-fusioncamp-settled/.test(out) && /CHANGE/.test(out),
    'the live report names the Fusion camp CHANGE');

  const afterLive = JSON.parse(fs.readFileSync(R.DEFAULT_DATA, 'utf8'));
  const afterCamp = afterLive.plan.commitments.find(c => c.id === 'fusioncamp');
  ok(!afterCamp.settledOn,
    'reconciler did not write settledOn onto live fusioncamp');

  const liveEvents = F.expandEvents(live.plan, live.meta.asOf,
    F.addDays(live.meta.asOf, (live.plan.windowDays || 91) - 1), {});
  ok(liveEvents.some(e => e.id === 'fusioncamp' && near(e.amount, -CAMP)),
    'live Forecast still reserves $786 until the owner writes settledOn');
}

console.log('\n=== G. missing or conflicting evidence does not mark a commitment paid ===');
{
  const plan = fixture();
  const missing = R.reconcile({
    data: { plan },
    map: { mappings: [] },
    observations: [],
    settlementObservations: [{
      observationId: 'camp-missing-date',
      fact: 'settlement',
      commitmentId: 'camp',
      settledOn: null,
      canonical: { collection: 'commitments', id: 'camp' },
    }],
  });
  ok(missing.rows[0].status === 'MISSING',
    'an observation with no settledOn date is MISSING');
  ok(!independentlySettled(plan.commitments[0]),
    'that MISSING row did not attach settledOn to the commitment');
  ok(F.expandEvents(plan, START, END, {}).some(e => e.id === 'camp'),
    'Forecast still deducts the camp when settlement evidence is missing');

  const conflict = R.reconcile({
    data: { plan },
    map: { mappings: [] },
    observations: [],
    settlementObservations: [
      {
        observationId: 'camp-paid-a',
        fact: 'settlement',
        commitmentId: 'camp',
        settledOn: '2026-08-01',
        canonical: { collection: 'commitments', id: 'camp' },
      },
      {
        observationId: 'camp-paid-b',
        fact: 'settlement',
        commitmentId: 'camp',
        settledOn: '2026-08-10',
        canonical: { collection: 'commitments', id: 'camp' },
      },
    ],
  });
  ok(conflict.rows.every(r => r.status === 'CONFLICT'),
    'two disagreeing settlement dates are CONFLICT');
  ok(!plan.commitments[0].settledOn,
    'CONFLICT does not write a settlement date onto the commitment');
  ok(F.expandEvents(plan, START, END, {}).some(e => e.id === 'camp' && near(e.amount, -CAMP)),
    'Forecast still reserves $786 when settlement evidence conflicts');

  const garbage = fixture();
  garbage.commitments[0].settledOn = 'paid';
  ok(!independentlySettled(garbage.commitments[0]),
    'independent predicate rejects a non-date settledOn');
  ok(F.commitmentStatus(garbage.commitments[0]) === 'unsettled',
    'derived status stays unsettled for garbage');
  ok(F.expandEvents(garbage, START, END, {}).some(e => e.id === 'camp'),
    'garbage settledOn does not silently drop the cash event');

  const unknown = R.reconcile({
    data: { plan: fixture() },
    map: { mappings: [] },
    observations: [],
    settlementObservations: [{
      observationId: 'ghost-settled',
      fact: 'settlement',
      commitmentId: 'does-not-exist',
      settledOn: '2026-08-14',
      canonical: { collection: 'commitments', id: 'does-not-exist' },
    }],
  });
  ok(unknown.rows[0].status === 'MISSING',
    'settlement evidence for an unknown commitment id is MISSING');
}

console.log('\n=== live Fusion season instalments stay untouched ===');
{
  const ids = ['fusion-sep', 'fusion-oct', 'fusion-nov'];
  for (const id of ids) {
    const row = live.plan.commitments.find(c => c.id === id);
    ok(row && row.amount === 500 && !row.settledOn,
      `${id} remains a $500 unsettled live commitment`);
  }
  ok(!settlements.observations.some(o => ids.includes(o.commitmentId)),
    'the settlement fixture does not observe the three $500 instalments');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
