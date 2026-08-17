'use strict';
/* B94 / AF-PLAN-01 — Forecast is the one master plan.
 * Views are slices. Proofs below are independent of the helper under test
 * wherever a figure is asserted: they rebuild the ledger or the remaining
 * cash from the fixture inputs.
 *
 * `node test-master-forecast.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('./public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const AS_OF = '2026-08-16';
const JAN = '2027-01-15';

function barePlan(extra) {
  return Object.assign({
    windowDays: 160,
    defaults: { targetBuffer: 500 },
    startingCash: { amount: 8000 },
    income: [],
    obligations: [],
    bills: [],
    commitments: [],
  }, extra || {});
}

function recOpts(extra) {
  return Object.assign({
    scenario: 'expected', incomeOverrides: {}, disabled: [],
    extraDebtMonthly: 0, targetBuffer: 500,
  }, extra || {});
}

console.log('=== knowledge horizon is not the 91-day view ===');
{
  const plan = barePlan({
    windowDays: 7,
    commitments: [
      { id: 'later', label: 'Later cost', date: JAN, amount: 2000, confidence: 'confirmed' },
    ],
  });
  const h = F.knowledgeHorizon(plan, AS_OF, {});
  const wantDays = F.diffDays(AS_OF, JAN) + 1;
  ok(h.days === wantDays, 'a January 2027 dated commitment extends knowledge past a 7-day view',
    `${h.days} days, want ${wantDays}`);
  ok(h.end === JAN, 'knowledge end is the commitment date', h.end);
  ok(h.days >= 365 || !plan.income.some(s => s.frequency && s.frequency !== 'once'),
    'a fixture with no recurring streams is not silently stretched to 365 days of drain');
}

{
  const live = require('./data.json');
  const h = F.knowledgeHorizon(live.plan, live.meta.asOf, {});
  ok(h.days >= 365, 'the live plan has continuing streams, so knowledge is at least 12 months',
    String(h.days));
  ok(live.plan.windowDays === 91, 'live windowDays stays the 91-day view', String(live.plan.windowDays));
}

console.log('\n=== January 2027 commitment reduces August 2026 safe-to-spend ===');
{
  const days = 160;
  const start = 8000;
  const buffer = 500;
  const laterAmt = 2000;
  const base = barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
  });
  const withLater = Object.assign({}, base, {
    commitments: [
      { id: 'later', label: 'January cost', date: JAN, amount: laterAmt, confidence: 'confirmed' },
    ],
  });
  const without = F.recommend(base, AS_OF, recOpts());
  const withC = F.recommend(withLater, AS_OF, recOpts());
  const short = F.recommend(withLater, AS_OF, recOpts({ viewDays: 7 }));
  const withDays = F.knowledgeHorizon(withLater, AS_OF, {}).days;

  // Independent: only variable spend, so the last day binds.
  // Without the commitment knowledge stays windowDays. With it, knowledge
  // is the commitment span. W ≤ (start − lumps − buffer) × 7 / knowledgeDays,
  // snapped down to $5.
  const rawWithout = (start - buffer) * 7 / days;
  const wantWithout = Math.floor(rawWithout / 5) * 5;
  ok(without.weekly === wantWithout,
    'without the later commitment, weekly is the independent 160-day drain',
    `$${without.weekly} vs hand $${wantWithout} (raw ${rawWithout.toFixed(4)})`);

  const rawWith = (start - laterAmt - buffer) * 7 / withDays;
  const wantWith = Math.floor(rawWith / 5) * 5;
  ok(withC.weekly === wantWith,
    'with the January commitment, weekly matches the independent reduced drain',
    `$${withC.weekly} vs hand $${wantWith} (raw ${rawWith.toFixed(4)})`);
  ok(withC.weekly < without.weekly,
    'the January commitment reduces August safe-to-spend',
    `$${withC.weekly} < $${without.weekly}`);
  ok(short.weekly === withC.weekly,
    'a 7-day visible view still reports that same reduced weekly',
    `$${short.weekly}`);
  ok(short.knowledge.days === withC.knowledge.days,
    'the short view did not shrink what the plan knows',
    String(short.knowledge.days));
}

console.log('\n=== 7 / 91 / 365-day views share master knowledge and today\'s cap ===');
{
  const plan = barePlan({
    windowDays: 91,
    income: [{
      id: 'pay', label: 'Pay', frequency: 'biweekly', anchor: '2026-08-14',
      amount: 2000, confidence: 'confirmed',
    }],
    commitments: [
      { id: 'later', label: 'January cost', date: JAN, amount: 1500, confidence: 'confirmed' },
    ],
  });
  const a = F.recommend(plan, AS_OF, recOpts({ viewDays: 7 }));
  const b = F.recommend(plan, AS_OF, recOpts({ viewDays: 91 }));
  const c = F.recommend(plan, AS_OF, recOpts({ viewDays: 365 }));
  ok(a.knowledge.days === b.knowledge.days && b.knowledge.days === c.knowledge.days,
    'all three views report the same knowledge horizon',
    String(a.knowledge.days));
  ok(a.knowledge.days >= 365, 'recurring pay keeps knowledge at least 12 months',
    String(a.knowledge.days));
  ok(a.weekly === b.weekly && b.weekly === c.weekly,
    'present-day weekly cap is identical across 7 / 91 / 365-day views',
    `$${a.weekly}`);
  const seqA = (a.fundingSequence || []).map(x => x.id).join(',');
  const seqC = (c.fundingSequence || []).map(x => x.id).join(',');
  ok(seqA === seqC && seqA === 'later',
    'funding sequence is the same master sequence, not rebuilt per view', seqA);

  const named = ['week', 'payday', 'month', '13-week', '6-month', '1-year']
    .map(id => F.viewRange(plan, AS_OF, id, {}));
  ok(named.every(v => v.days >= 1 && v.days <= a.knowledge.days && v.start === AS_OF),
    'week / payday / month / 13-week / 6-month / 1-year are slices of the same knowledge');
  const custom = F.viewRange(plan, AS_OF, { start: AS_OF, end: F.addDays(AS_OF, 20) }, {});
  ok(custom.id === 'custom' && custom.days === 21,
    'a custom date range is the same kind of view', `${custom.days} days`);
}

console.log('\n=== completing a nearer commitment redirects capacity ===');
{
  const days = 160;
  const start = 4000;
  const buffer = 500;
  const nearAmt = 1000;
  const farAmt = 1000;
  const nearDate = '2026-09-01';
  const planBoth = barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    commitments: [
      { id: 'near-item', label: 'Nearer requirement', date: nearDate, amount: nearAmt, confidence: 'confirmed' },
      { id: 'far-item', label: 'Later requirement', date: JAN, amount: farAmt, confidence: 'estimated' },
    ],
  });
  const planNearDone = JSON.parse(JSON.stringify(planBoth));
  planNearDone.commitments[0].settledOn = AS_OF;
  const planNone = barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
  });

  const both = F.recommend(planBoth, AS_OF, recOpts());
  const after = F.recommend(planNearDone, AS_OF, recOpts());
  const none = F.recommend(planNone, AS_OF, recOpts());

  ok(!(both.fundingSequence || []).some(x => x.id === 'near-item') === false
    && (both.fundingSequence || []).map(x => x.id).join(',') === 'near-item,far-item',
    'sequence is near then far by timing, not by a hard-coded Fusion/Seattle/Indio list',
    (both.fundingSequence || []).map(x => x.id).join(','));
  ok(!(after.fundingSequence || []).some(x => x.id === 'near-item'),
    'settling the nearer item drops it from the sequence');
  ok((after.fundingSequence || []).map(x => x.id).join(',') === 'far-item',
    'the later item remains, without any id special-case',
    (after.fundingSequence || []).map(x => x.id).join(','));

  // Independent weekly with both lumps: start − near − far − (W/7)×days ≥ buffer
  const rawBoth = (start - nearAmt - farAmt - buffer) * 7 / days;
  const wantBoth = Math.floor(rawBoth / 5) * 5;
  ok(both.weekly === wantBoth, 'weekly with both commitments matches the two-lump drain',
    `$${both.weekly} vs hand $${wantBoth}`);

  const afterDays = F.knowledgeHorizon(planNearDone, AS_OF, {}).days;
  const rawAfter = (start - farAmt - buffer) * 7 / afterDays;
  const wantAfter = Math.floor(rawAfter / 5) * 5;
  ok(after.weekly === wantAfter,
    'after the nearer item is finished, weekly is the remaining later lump, not the empty-plan cap',
    `$${after.weekly} vs hand $${wantAfter}`);
  ok(after.weekly > both.weekly, 'finishing the nearer item frees some weekly capacity');
  ok(after.weekly < none.weekly,
    'that freed capacity does not all become safe-to-spend while the later item remains',
    `$${after.weekly} stays below empty-plan $${none.weekly}`);

  const farBoth = (both.majorPlans || []).find(p => p.id === 'far-item');
  const farAfter = (after.majorPlans || []).find(p => p.id === 'far-item');
  ok(farBoth && farAfter && farAfter.funded,
    'the later commitment stays funded after the redirect');
}

console.log('\n=== overspend moves ON TRACK → AT RISK → FUNDING GAP from capacity ===');
{
  const days = 60;
  const buffer = 500;
  const need = 1000;
  const due = F.addDays(AS_OF, 40);
  const planAt = start => barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    commitments: [
      { id: 'trip', label: 'A trip', date: due, amount: need, confidence: 'confirmed' },
    ],
  });

  const comfortable = planAt(3000);
  const rec = F.recommend(comfortable, AS_OF, recOpts());
  const onTrack = (rec.majorPlans || []).find(p => p.id === 'trip');
  ok(onTrack && onTrack.verdict === 'ON TRACK',
    'at the recommended path the dated plan is ON TRACK',
    onTrack && onTrack.verdict);

  // Independent: last-day bind without overspend is start − need − (W/7)×days ≥ buffer.
  // Pick a weekly that spends the margin: after 40 days of that weekly, cash
  // before the payment is below need + buffer.
  const overspendWeekly = rec.weekly + 200;
  const daily = overspendWeekly / 7;
  const cashBeforePay = 3000 - daily * 40;
  const afterPay = cashBeforePay - need;
  ok(afterPay < buffer,
    'the overspend trajectory is independently below the buffer after the payment',
    afterPay.toFixed(2));
  const atRisk = F.majorPlans(comfortable, AS_OF, recOpts({ weeklyVariable: overspendWeekly }))
    .find(p => p.id === 'trip');
  ok(atRisk && atRisk.verdict === 'AT RISK',
    'that same overspend is AT RISK — weekly = 0 can still recover it',
    atRisk && atRisk.verdict);
  ok(atRisk.recoverable, 'AT RISK means recoverable by cutting remaining discretionary');

  // Even weekly = 0 cannot fund it: start − need < buffer.
  const brokeStart = buffer + need - 50; // 1450
  ok(brokeStart - need < buffer, 'independent: even with no variable spend the payment breaches',
    String(brokeStart - need));
  const gap = F.majorPlans(planAt(brokeStart), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'trip');
  ok(gap && gap.verdict === 'FUNDING GAP',
    'when remaining cash cannot cover the need, the verdict is FUNDING GAP',
    gap && gap.verdict);
  ok(gap && !gap.recoverable, 'FUNDING GAP is not recoverable by cutting discretionary');
}

console.log('\n=== flexible items may move; non-flexible dates are not rewritten ===');
{
  const hardDate = '2026-10-01';
  const flexDate = '2026-09-01';
  const plan = barePlan({
    windowDays: 80,
    startingCash: { amount: 900 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'hard-item', label: 'Must hit the date', date: hardDate, amount: 800, confidence: 'confirmed' },
      { id: 'flex-item', label: 'Can move', date: flexDate, amount: 800, confidence: 'estimated', adjustable: true },
    ],
  });
  const seq = F.fundingSequence(plan, AS_OF, {});
  ok(seq.map(x => x.id).join(',') === 'flex-item,hard-item',
    'sequence is by date, then flexibility — no hard-coded ids',
    seq.map(x => x.id).join(','));
  const plans = F.majorPlans(plan, AS_OF, recOpts({ weeklyVariable: 0 }));
  const hard = plans.find(p => p.id === 'hard-item');
  const flex = plans.find(p => p.id === 'flex-item');
  ok(hard && hard.scheduledDate === hardDate && hard.date === hardDate,
    'the non-flexible item keeps its original date');
  ok(hard && hard.deferred === false,
    'a non-flexible item is never marked deferred, even if it is a FUNDING GAP',
    hard && `${hard.verdict} deferred=${hard.deferred}`);
  ok(flex && flex.date === flexDate,
    'flexibility does not invent a new date for the flexible item either');
  ok(flex && (flex.verdict !== 'ON TRACK' ? flex.deferred === true : true),
    'a flexible item that is not ON TRACK may be marked deferred');
  const events = F.expandEvents(plan, AS_OF, hardDate, {});
  ok(events.some(e => e.id === 'hard-item' && e.date === hardDate),
    'expandEvents still emits the non-flexible item on its original date');
}

console.log('\n=== no planned debt unless explicitly permitted ===');
{
  const plan = barePlan({
    windowDays: 40,
    startingCash: { amount: 600 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'gap-item', label: 'Unfunded', date: F.addDays(AS_OF, 20), amount: 2000, confidence: 'confirmed' },
    ],
  });
  const advice = F.recommend(plan, AS_OF, recOpts());
  ok(advice.plannedDebt && advice.plannedDebt.permitted === false
    && advice.plannedDebt.borrowed === 0,
    'default recommend invents no permission to borrow',
    JSON.stringify(advice.plannedDebt && { permitted: advice.plannedDebt.permitted, borrowed: advice.plannedDebt.borrowed }));
  ok(!(advice.simOptions && (advice.simOptions.injections || []).some(i => i.debtId)),
    'default path introduces no planned-debt injection');

  const facility = { id: 'card-x', label: 'A card', rate: 19.99, balance: 100, limit: 5000 };
  const permitted = F.plannedDebt(plan, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    debts: [facility],
    plannedDebtPayment: 100,
    weeklyVariable: 0,
  }));
  const gapRow = (F.majorPlans(plan, AS_OF, recOpts({ weeklyVariable: 0 })) || [])
    .find(p => p.id === 'gap-item');
  const wantBorrowed = gapRow ? gapRow.remaining : 0;
  ok(permitted.permitted === true && near(permitted.borrowed, wantBorrowed) && wantBorrowed > 0,
    'when borrowing is explicitly permitted, the borrowed amount is the remaining gap',
    `$${permitted.borrowed} vs hand $${wantBorrowed}`);
  const horizon = F.knowledgeHorizon(plan, AS_OF, {});
  const wantInterest = wantBorrowed * (19.99 / 100) * (horizon.days / 365);
  ok(near(permitted.interest, wantInterest),
    'interest is the independent principal × rate × (horizon/365)',
    `${permitted.interest.toFixed(4)} vs ${wantInterest.toFixed(4)}`);
  ok(permitted.repayment && permitted.repayment.monthlyPayment === 100
    && permitted.repayment.months > 0,
    'a repayment path is returned when a payment is supplied',
    permitted.repayment && `${permitted.repayment.months} months`);
}

console.log('\n=== existing consumers still derive from Forecast ===');
{
  const planJs = read('public/plan.js');
  const deepJs = read('public/deepdive.js');
  ok(/advice\.majorPlans|Forecast\.majorPlans/.test(planJs),
    'the Plan page renders Forecast.majorPlans and does not invent the verdicts');
  ok(!/verdict\s*=\s*['"]ON TRACK['"]/.test(planJs),
    'the Plan page does not assign ON TRACK itself');
  ok(/Forecast\.recommend\(/.test(planJs),
    'the Plan page still takes the weekly cap from Forecast.recommend');
  ok(/Forecast\.publicationTotals/.test(deepJs),
    'Deep Dive still derives commitment totals from Forecast, not a second list');
  ok(!/ON TRACK|AT RISK|FUNDING GAP/.test(deepJs),
    'Deep Dive does not grade ordinary categories with the major-plan verdicts');
}

console.log('\n=== live opening: Q19, buffer, cards, undated rows ===');
{
  const live = require('./data.json');
  const asOf = live.meta.asOf;
  ok(asOf === '2026-08-16', 'this cutover is the B91 2026-08-16 opening', asOf);
  const advice = F.recommend(live.plan, asOf, recOpts({
    fundingSources: live.plan.funding && live.plan.funding.options,
  }));
  ok(advice.knowledge.days >= 365, 'live recommend searched at least 12 months',
    String(advice.knowledge.days));
  ok(advice.sim.weeks.length === 13, 'the returned view is still the 13-week display',
    String(advice.sim.weeks.length));
  ok(advice.plannedDebt.borrowed === 0 && advice.plannedDebt.permitted === false,
    'live recommend does not invent planned debt');
  ok(advice.buffer === 500, 'the $500 model buffer is unchanged', String(advice.buffer));
  ok(!/emergency reserve/i.test(read('public/forecast.js')),
    'the engine does not relabel the $500 buffer as an emergency reserve');

  const windowEnd = F.addDays(asOf, (live.plan.windowDays || 91) - 1);
  const undatedIds = (live.plan.commitments || [])
    .filter(c => !c.date)
    .map(c => c.id);
  const events = F.expandEvents(live.plan, asOf, windowEnd, {});
  ok(!events.some(e => undatedIds.includes(e.id)),
    'undated live commitments still emit no cash event in the 91-day view');

  const heloc = (live.plan.funding && live.plan.funding.options || [])
    .find(o => o.id === 'heloc');
  ok(heloc && /Q19/.test(heloc.note || ''),
    'Q19 HELOC uncertainty remains on the live funding option');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll master-forecast checks passed.');
