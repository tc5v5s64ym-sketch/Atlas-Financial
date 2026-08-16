'use strict';
/* B91 D11 — expose near-boundary obligations in payday output.
 *
 * Acceptance corpus: docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md
 * Forecast remains the only calculation engine. This slice derives a view of
 * existing events; it does not add a horizon, a payday engine, or $600/week.
 *
 * Independent proof: synthetic ledger walked by hand, plus plan-row
 * occurrences summed on the two boundary dates. That is not a second call
 * to the recommend weekly search.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const live = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const clone = x => JSON.parse(JSON.stringify(x));
const ids = result => (result.parts || []).map(p => p.id).join(' → ');
const part = (result, id) => (result.parts || []).find(p => p.id === id) || null;
const read = p => sourceText(fs.readFileSync(p, 'utf8'));

const AS_OF = '2026-03-01';
const PAYDAY = '2026-03-06';
const NEXT_DAY = '2026-03-07';
const LATER = '2026-03-09';
const OPENING = 2500;
const PAY = 2000;
const BILL = 900;
const BUFFER = 500;
const WINDOW = 21;
const FROZEN_WEEKLY = 1030;
const FROZEN_ENDING = OPENING + PAY - BILL - FROZEN_WEEKLY * (WINDOW / 7);

function fixture(billDate, extra) {
  return Object.assign({
    windowDays: WINDOW,
    defaults: { targetBuffer: BUFFER },
    startingCash: { amount: OPENING },
    income: [{
      id: 'payroll', label: 'Payroll', frequency: 'once', date: PAYDAY,
      amount: PAY, confidence: 'confirmed',
    }],
    obligations: [],
    bills: [{
      id: 'hydro', label: 'Hydro', frequency: 'once', date: billDate,
      amount: BILL, confidence: 'confirmed',
    }],
    commitments: [],
  }, extra || {});
}

const EMPTY_WALK = { marks: [], crossings: [] };

console.log('=== A. synthetic: surplus before payday, obligation immediately after ===');
const plan = fixture(NEXT_DAY);
const zero = F.simulate(plan, AS_OF, { weeklyVariable: 0, targetBuffer: BUFFER });
ok(near(zero.min.balance, OPENING) && zero.min.date === AS_OF,
  'at zero spend the floor is the opening $2,500 on 1 March — apparent surplus before payday',
  `${zero.min.balance} on ${zero.min.date}`);
ok(zero.min.balance - BUFFER === 2000,
  'that opening is $2,000 above the $500 buffer');
ok(zero.events.some(e => e.id === 'hydro' && e.date === NEXT_DAY && near(-e.amount, BILL)),
  'the existing Forecast event stream already contains the $900 Hydro on 7 March');
ok(!zero.events.some(e => e.amount < 0 && e.date < PAYDAY),
  'no cash outflow falls before payday');

const rec = F.recommend(plan, AS_OF, { targetBuffer: BUFFER });
ok(rec.mode === 'normal' && rec.gap == null,
  'there is no opening gap — the surplus before payday is real in the opening-gap sense');
ok(rec.weekly === FROZEN_WEEKLY,
  'the weekly cap is the frozen $1,030 from current-main arithmetic',
  String(rec.weekly));
ok(near(rec.sim.ending, FROZEN_ENDING) && near(rec.sim.min.balance, FROZEN_ENDING),
  'ending cash is $2,500 + $2,000 − $900 − $1,030 × 3 = $510',
  String(rec.sim.ending));
ok(rec.holds === true && rec.sim.min.date === '2026-03-21',
  'the $510 floor is on the last day and still holds the buffer');

const nb = rec.nearBoundary;
ok(!!nb && nb.payday === PAYDAY && nb.until === NEXT_DAY,
  'near-boundary window is the next payday and the following calendar day',
  nb ? `${nb.payday}..${nb.until}` : 'none');
ok(nb && nb.items.length === 1 && nb.items[0].id === 'hydro'
  && nb.items[0].date === NEXT_DAY && near(nb.items[0].amount, BILL),
  'payday output names the $900 Hydro already in Forecast events');
ok(nb && near(nb.total, BILL),
  'the exposed total is that same $900, derived from the items, not stored twice');

const mission = F.mission(rec, EMPTY_WALK, { weeklyOverride: null });
ok(ids(mission) === 'holdSpending → nearBoundary → surplusToCard',
  'mission exposes the obligation before surplus-use guidance',
  ids(mission));
ok(part(mission, 'nearBoundary').total === nb.total
  && part(mission, 'nearBoundary').payday === PAYDAY
  && part(mission, 'nearBoundary').items
  && part(mission, 'nearBoundary').items[0].label === 'Hydro',
  'the mission part carries the recommend total, payday and item names');
ok(part(mission, 'holdSpending').weekly === FROZEN_WEEKLY,
  'the spending instruction is still the unchanged weekly cap');

console.log('\n=== B. same-day payday bill is at the boundary; three days later is not ===');
const sameDay = F.recommend(fixture(PAYDAY), AS_OF, { targetBuffer: BUFFER });
ok(sameDay.nearBoundary.items.length === 1
  && sameDay.nearBoundary.items[0].date === PAYDAY
  && near(sameDay.nearBoundary.total, BILL),
  'a bill on payday itself is near-boundary (after deposits, same calendar day)');
ok(ids(F.mission(sameDay, EMPTY_WALK, { weeklyOverride: null }))
  === 'holdSpending → nearBoundary → surplusToCard',
  'and the mission still names it before surplus use');

const later = F.recommend(fixture(LATER), AS_OF, { targetBuffer: BUFFER });
ok(later.nearBoundary.items.length === 0 && later.nearBoundary.total === 0,
  'a bill three days after payday is not immediately after, and is not exposed');
ok(ids(F.mission(later, EMPTY_WALK, { weeklyOverride: null }))
  === 'holdSpending → surplusToCard',
  'without a near-boundary item the surplus instruction is unchanged',
  ids(F.mission(later, EMPTY_WALK, { weeklyOverride: null })));
ok(later.zero.events.some(e => e.id === 'hydro' && e.date === LATER),
  'the later bill remains in the 21-day Forecast; this slice only changes visibility');

console.log('\n=== C. Forecast arithmetic is unchanged ===');
const recWeekly = F.recommendWeekly(plan, AS_OF, { targetBuffer: BUFFER });
ok(rec.weekly === recWeekly && recWeekly === FROZEN_WEEKLY,
  'recommend.weekly still is recommendWeekly — the search was not retargeted');
const independentSim = F.simulate(plan, AS_OF, {
  weeklyVariable: rec.weekly, targetBuffer: BUFFER,
});
ok(near(independentSim.ending, rec.sim.ending)
  && near(independentSim.min.balance, rec.sim.min.balance)
  && independentSim.min.date === rec.sim.min.date,
  'a direct simulate at that weekly reproduces recommend.sim min and ending');
ok(near(FROZEN_ENDING, OPENING + PAY - BILL - (FROZEN_WEEKLY / 7) * WINDOW),
  'the frozen ending is the hand identity, not a second call to recommend');
const over = F.simulate(plan, AS_OF, {
  weeklyVariable: FROZEN_WEEKLY + 5, targetBuffer: BUFFER,
});
ok(over.min.balance < BUFFER,
  'one $5 step still breaches — the cap is the same binding cap');

console.log('\n=== D. extras, injections, and external payers are not invented obligations ===');
const withExtra = F.recommend(plan, AS_OF, {
  targetBuffer: BUFFER, extraDebtMonthly: 400,
});
ok(withExtra.nearBoundary.items.every(item => item.kind !== 'extra'),
  'an extra debt payment is surplus use and is not listed as a near-boundary obligation');
ok(withExtra.nearBoundary.items.length === 1 && withExtra.nearBoundary.items[0].id === 'hydro',
  'the Hydro bill is still the only named near-boundary item when extras exist');

const external = fixture(NEXT_DAY);
external.startingCash = {
  amount: OPENING,
  heldElsewhere: [{ id: 'amanda', label: 'Amanda', value: 800 }],
};
external.bills[0] = Object.assign({}, external.bills[0], { payingAccount: 'amanda' });
const extRec = F.recommend(external, AS_OF, { targetBuffer: BUFFER });
ok(extRec.zero.events.some(e => e.id === 'hydro' && e.jointCash === false),
  'an externally paid household obligation remains on the Forecast schedule');
ok(extRec.nearBoundary.items.length === 0,
  'but it is not a joint-cash claim on current surplus, so payday output does not treat it as one');

console.log('\n=== E. no payday in the window yields an empty derived view ===');
const noPay = fixture(NEXT_DAY);
noPay.income = [];
const none = F.recommend(noPay, AS_OF, { targetBuffer: BUFFER });
ok(none.nearBoundary.payday == null && none.nearBoundary.items.length === 0
  && none.nearBoundary.total === 0,
  'without a payday the derived view is empty rather than guessed');

console.log('\n=== F. live plan: expose existing Aug 14–15 cluster; weekly follows current commitments ===');
const liveOpts = {
  scenario: 'expected', incomeOverrides: {}, disabled: [], extraDebtMonthly: 0,
  targetBuffer: live.plan.defaults.targetBuffer,
  fundingSources: live.plan.funding && live.plan.funding.options,
  debts: live.debts,
  extraFacilities: live.revolvingExtra,
  extraDebtTarget: live.plan.nextDollar && live.plan.nextDollar.target,
};
const liveRec = F.recommend(live.plan, live.meta.asOf, liveOpts);
ok(liveRec.weekly === 1165 && liveRec.mode === 'openingGap'
  && near(liveRec.gap.amount, 1043.16)
  && near(liveRec.sim.min.balance, 500) && liveRec.sim.min.date === '2026-08-12'
  && near(liveRec.sim.ending, 5629.80),
  'live weekly $1,165, gap $1,043.16, floor $500 on 12 Aug, ending $5,629.80',
  `${liveRec.weekly} / ${liveRec.gap && liveRec.gap.amount} / ${liveRec.sim.min.balance} / ${liveRec.sim.ending}`);

ok(liveRec.nearBoundary.payday === '2026-08-14'
  && liveRec.nearBoundary.until === '2026-08-15',
  'live next payday from 9 Aug is 14 Aug, window through 15 Aug');

const PAYDAY_LIVE = '2026-08-14';
const UNTIL_LIVE = '2026-08-15';
const handItems = [];
for (const o of live.plan.obligations || []) {
  if (o.nonCash) continue;
  for (const date of F.occurrences(o, PAYDAY_LIVE, UNTIL_LIVE)) {
    handItems.push({ id: o.id, label: o.label, date, amount: o.amount });
  }
}
for (const b of live.plan.bills || []) {
  if (!F.billIsHouseholdObligation(b) || !F.billAffectsJointCash(b, live.plan)) continue;
  for (const date of F.occurrences(b, PAYDAY_LIVE, UNTIL_LIVE)) {
    handItems.push({ id: b.id, label: b.label, date, amount: b.amount });
  }
}
for (const c of live.plan.commitments || []) {
  if (F.commitmentSettledBy(c, live.meta.asOf)) continue;
  if (c.date >= PAYDAY_LIVE && c.date <= UNTIL_LIVE) {
    handItems.push({ id: c.id, label: c.label, date: c.date, amount: c.amount });
  }
}
const handTotal = handItems.reduce((s, item) => s + item.amount, 0);
ok(handItems.length === 7 && near(handTotal, 1997.81),
  'plan-row occurrences on 14–15 Aug independently total $1,997.81 across 7 items',
  `${handItems.length} items, ${handTotal}`);
ok(liveRec.nearBoundary.items.length === handItems.length
  && near(liveRec.nearBoundary.total, handTotal),
  'recommend.nearBoundary matches that independent plan-row total',
  String(liveRec.nearBoundary.total));
const recIds = liveRec.nearBoundary.items.map(i => i.id).sort().join(',');
const handIds = handItems.map(i => i.id).sort().join(',');
ok(recIds === handIds,
  'the named ids are the plan-row set, not a second schedule',
  recIds);

const liveWalk = F.projectDebts(live.plan, live.debts, live.meta.asOf, Object.assign({},
  liveRec.simOptions, { weeklyVariable: liveRec.weekly }));
const liveMission = F.mission(liveRec, liveWalk, { weeklyOverride: null, sim: liveRec.sim });
const nbIdx = liveMission.parts.findIndex(p => p.id === 'nearBoundary');
const surplusIdx = liveMission.parts.findIndex(p => p.id === 'surplusToCard' || p.id === 'helocLimit');
ok(nbIdx >= 0 && surplusIdx >= 0 && nbIdx < surplusIdx,
  'live mission names the Aug 14–15 obligations before surplus-use guidance',
  ids(liveMission));
ok(near(part(liveMission, 'nearBoundary').total, 1997.81),
  'the live mission total is the independent $1,997.81');
const handLabels = handItems.map(i => i.label).sort().join(',');
const missionLabels = (part(liveMission, 'nearBoundary').items || [])
  .map(i => i.label).sort().join(',');
ok(handLabels === missionLabels,
  'the live mission carries the independent plan-row labels',
  missionLabels);
ok(!/\$600/.test(JSON.stringify(liveRec.nearBoundary))
  && !/\$600/.test(ids(liveMission)),
  '$600/week is not encoded as payday or surplus policy');

console.log('\n=== G. page renders the engine part; mutation drops the exposure ===');
const planSrc = read('public/plan.js');
ok(/nearBoundary:\s*p\s*=>/.test(planSrc),
  'the Plan page has wording for the near-boundary instruction');
ok(/p\.items\.map\(\s*x\s*=>\s*x\.label\s*\)/.test(planSrc),
  'that wording renders the item names the engine carried');
ok(/Forecast\.mission\(/.test(planSrc),
  'the page still reads the mission from Forecast');
ok(!/nearBoundaryObligations/.test(planSrc),
  'the page does not compute the boundary list itself');

const appSrc = read('public/app.js');
const grab = (src, re) => (re.exec(src) || [''])[0];
const FORMATTERS = [
  grab(appSrc, /^const money = .*$/m),
  grab(appSrc, /^const money2 = .*$/m),
  grab(appSrc, /^const fmtDateLong = .*$/m),
  grab(planSrc, /^const fmtMonth = .*$/m),
].join('\n');
const MAP_SRC = grab(planSrc, /^const MISSION_PART = \{[\s\S]*?^\};$/m);
const MISSION_PART = vm.runInNewContext(`${FORMATTERS}\n${MAP_SRC}\nMISSION_PART;`);
const liveSentence = liveMission.parts.map(p => MISSION_PART[p.id](p)).join(', ')
  .replace(/^./, c => c.toUpperCase()) + '.';
ok(handItems.every(item => item.label && liveSentence.includes(item.label)),
  'the live Plan sentence names every independent 14–15 Aug obligation',
  handItems.filter(item => !liveSentence.includes(item.label)).map(i => i.label).join(', ')
    || liveSentence);

const FORECAST_SRC = read('public/forecast.js');
const FROM = '        nearBoundary: nearBoundaryObligations(zeroSim.events, asOf, payFloor),';
const TO = '        nearBoundary: { payday: null, until: null, items: [], total: 0 },';
ok(FORECAST_SRC.split(FROM).length - 1 === 1,
  'the recommend attachment appears once, so the mutation is aimed');
const sandbox = { module: { exports: {} } };
try {
  vm.runInNewContext(FORECAST_SRC.replace(FROM, TO), sandbox, { filename: 'forecast-mutant.js' });
} catch (e) {
  ok(false, 'mutant engine loads', e.message);
}
const mutant = sandbox.module.exports;
const broken = mutant && mutant.recommend(plan, AS_OF, { targetBuffer: BUFFER });
ok(mutant && broken && broken.weekly === FROZEN_WEEKLY
  && near(broken.sim.ending, FROZEN_ENDING)
  && broken.nearBoundary.items.length === 0,
  'dropping the attachment leaves weekly/ending unchanged and hides the obligation');
ok(mutant && ids(mutant.mission(broken, EMPTY_WALK, { weeklyOverride: null }))
  === 'holdSpending → surplusToCard',
  'and the mutant mission skips straight to surplus use');

console.log('\n=== H. no $600/week, no second horizon, no live write ===');
const src = FORECAST_SRC + planSrc;
ok(!/600\s*\/\s*week/.test(src) && !/weekly:\s*600/.test(src),
  'this slice does not encode $600/week');
ok(!/windowDays:\s*14/.test(FORECAST_SRC)
  && /zeroSim\.events/.test(FORECAST_SRC),
  'the list is filtered from existing zero-sim events, not a new windowDays');
ok(!fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8').includes('"nearBoundary"'),
  'data.json does not store a duplicate near-boundary total');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
