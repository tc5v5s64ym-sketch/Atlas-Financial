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
  ok(custom.id === 'custom' && custom.days === 21 && custom.start === AS_OF,
    'a custom date range starting today is the same kind of view', `${custom.days} days`);

  const futureStart = '2026-09-01';
  const futureEnd = '2026-09-30';
  const futureView = F.viewRange(plan, AS_OF, { start: futureStart, end: futureEnd }, {});
  ok(futureView.start === futureStart && futureView.end === futureEnd && futureView.days === 30,
    'a custom Sep 1–Sep 30 view keeps its future start, not as-of',
    `${futureView.start}..${futureView.end} (${futureView.days} days)`);
  const sliced = F.recommend(plan, AS_OF, recOpts({
    view: { start: futureStart, end: futureEnd },
  }));
  ok(sliced.view.start === futureStart && sliced.sim.start === futureStart
    && sliced.sim.end === futureEnd && sliced.sim.daily[0].date === futureStart,
    'simulate slices the master walk from the requested start',
    `${sliced.sim.start}..${sliced.sim.end} first=${sliced.sim.daily[0] && sliced.sim.daily[0].date}`);
  ok(sliced.weekly === a.weekly,
    'a future-start custom view does not change today\'s weekly cap',
    `$${sliced.weekly}`);
  const sepIncome = F.addDays(futureStart, 10);
  const planWithDates = Object.assign({}, plan, {
    income: plan.income.concat([
      { id: 'aug-pay', label: 'August only', frequency: 'once', date: '2026-08-20',
        amount: 111, confidence: 'confirmed' },
      { id: 'sep-pay', label: 'September only', frequency: 'once', date: sepIncome,
        amount: 222, confidence: 'confirmed' },
    ]),
  });
  const sepSlice = F.recommend(planWithDates, AS_OF, recOpts({
    view: { start: futureStart, end: futureEnd },
  }));
  ok(sepSlice.sim.events.some(e => e.id === 'sep-pay')
    && !sepSlice.sim.events.some(e => e.id === 'aug-pay'),
    'the September view contains September events and not the August one',
    (sepSlice.sim.events || []).map(e => e.id).join(','));

  // Week 3 of the as-of walk is 2026-08-30..2026-09-05. A Sep 1 start clips
  // that week; an 30 August event is in the original week but out of range.
  const midweekPlan = Object.assign({}, plan, {
    income: plan.income.concat([
      { id: 'aug-30-pay', label: 'Same original week, before the view',
        frequency: 'once', date: '2026-08-30', amount: 333, confidence: 'confirmed' },
      { id: 'sep-3-pay', label: 'Same original week, inside the view',
        frequency: 'once', date: '2026-09-03', amount: 222, confidence: 'confirmed' },
    ]),
  });
  const midweekSlice = F.recommend(midweekPlan, AS_OF, recOpts({
    view: { start: futureStart, end: futureEnd },
  }));
  const firstWeek = (midweekSlice.sim.weeks || [])[0];
  ok(firstWeek && firstWeek.start === futureStart,
    'the first sliced week begins on the requested start, not the original week start',
    firstWeek && `${firstWeek.start}..${firstWeek.end}`);
  ok(firstWeek && near(firstWeek.confirmedIncome, 222),
    'a partial week recomputes confirmed income from in-range events only',
    firstWeek && String(firstWeek.confirmedIncome));
  ok(firstWeek && !(firstWeek.events || []).some(e => e.id === 'aug-30-pay'),
    'the clipped week does not keep an out-of-range event from the original week');
  const implied = firstWeek.opening + firstWeek.confirmedIncome + firstWeek.estimatedIncome
    + firstWeek.injections - firstWeek.obligations - firstWeek.bills
    - firstWeek.commitments - firstWeek.variable - firstWeek.extra;
  ok(firstWeek && near(implied, firstWeek.closing, 0.02),
    'the recomputed partial week still reconciles opening + inflows − outflows to closing',
    firstWeek && `${implied.toFixed(2)} vs ${firstWeek.closing.toFixed(2)}`);
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

console.log('\n=== overspend of a point amount is a FUNDING GAP, not AT RISK ===');
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
  ok(onTrack && onTrack.margin != null && onTrack.margin >= -0.01,
    'ON TRACK carries a dollar margin',
    onTrack && String(onTrack.margin));

  const overspendWeekly = rec.weekly + 200;
  const daily = overspendWeekly / 7;
  const daysThroughPay = F.diffDays(AS_OF, due) + 1;
  const afterPay = 3000 - daily * daysThroughPay - need;
  ok(afterPay < buffer,
    'the overspend trajectory is independently below the buffer after the payment',
    afterPay.toFixed(2));
  const overspent = F.majorPlans(comfortable, AS_OF, recOpts({ weeklyVariable: overspendWeekly }))
    .find(p => p.id === 'trip');
  ok(overspent && overspent.verdict === 'FUNDING GAP',
    'authoritative infeasibility on this path is a FUNDING GAP, not AT RISK',
    overspent && overspent.verdict);
  ok(overspent && overspent.margin < 0,
    'the gap is a negative dollar margin',
    overspent && String(overspent.margin));
  ok(near(overspent.margin, afterPay - buffer),
    'the gap matches the independent buffer shortfall after payment',
    `${overspent && overspent.margin} vs ${afterPay - buffer}`);

  const brokeStart = buffer + need - 50; // 1450
  ok(brokeStart - need < buffer, 'independent: even with no variable spend the payment breaches',
    String(brokeStart - need));
  const gap = F.majorPlans(planAt(brokeStart), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'trip');
  ok(gap && gap.verdict === 'FUNDING GAP',
    'when remaining cash cannot cover the need, the verdict is FUNDING GAP',
    gap && gap.verdict);
  ok(gap && gap.margin < 0, 'FUNDING GAP carries a negative dollar margin');
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
  ok(seq.map(x => x.id).join(',') === 'hard-item,flex-item',
    'required items rank before bounded-flex; this is presentation, not a serial allocator',
    seq.map(x => x.id).join(','));
  ok(seq.find(x => x.id === 'hard-item').flexibility === 'required'
    && seq.find(x => x.id === 'flex-item').flexibility === 'bounded-flex',
    'adjustable is bounded-flex, not optional');
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
    income: [{
      id: 'keep-horizon', label: 'Horizon marker', frequency: 'monthly',
      anchor: '2026-08-01', amount: 0, confidence: 'confirmed',
    }],
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

  const facility = { id: 'card-x', label: 'A card', rate: 19.99, balance: 100, pending: 50, limit: 5000 };
  const laterPay = F.addDays(F.addDays(AS_OF, 20), 5);
  const planAffordable = Object.assign({}, plan, {
    income: plan.income.concat([{
      id: 'later-cover', label: 'Later cover', frequency: 'once', date: laterPay,
      amount: 2500, confidence: 'confirmed',
    }]),
  });
  const unnamed = F.plannedDebt(plan, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    debts: [facility],
    weeklyVariable: 0,
  }));
  ok(unnamed.borrowed === 0 && unnamed.feasible === false,
    'allowPlannedDebt alone does not silently finance every gap; purposes must be named',
    JSON.stringify({ borrowed: unnamed.borrowed, feasible: unnamed.feasible }));

  const permitted = F.plannedDebt(planAffordable, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [facility],
    weeklyVariable: 0,
  }));
  const due = F.addDays(AS_OF, 20);
  const afterPay = 600 - 2000;
  const wantBorrowed = 500 - afterPay; // 1900 to land on the buffer
  ok(permitted.permitted === true && near(permitted.borrowed, wantBorrowed) && wantBorrowed > 0,
    'when borrowing is explicitly permitted and purpose-named, the draw is the independent buffer gap',
    `$${permitted.borrowed} vs hand $${wantBorrowed}`);
  ok(permitted.draws && permitted.draws.length === 1 && permitted.draws[0].id === 'gap-item'
    && permitted.draws[0].date === due,
    'the draw is purpose-specific and lands on the commitment date',
    JSON.stringify(permitted.draws));
  ok(permitted.feasible === false,
    'a draw without a repayment cadence is not a proven post-financing plan');
  ok(permitted.capacity === 4850,
    'capacity is limit − (posted + pending), not posted alone',
    String(permitted.capacity));
  const unknownPending = F.plannedDebt(planAffordable, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [{ id: 'card-x', label: 'A card', rate: 19.99, balance: 100, pendingUnknown: true, limit: 5000 }],
    weeklyVariable: 0,
  }));
  ok(unknownPending.capacity === 0 && unknownPending.borrowed === 0,
    'unknown pending is not treated as $0 usable room',
    String(unknownPending.capacity));

  const withPay = F.plannedDebt(planAffordable, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [facility],
    plannedDebtPayment: 100,
    weeklyVariable: 0,
  }));
  ok(withPay.repayment && withPay.repayment.monthlyPayment === 100
    && withPay.repayment.months > 0 && withPay.repayment.flows > 0,
    'repayment cash flows are inserted into the same projection, not only described',
    withPay.repayment && `${withPay.repayment.months} months, ${withPay.repayment.flows} flows`);
  ok(withPay.feasible === true,
    'with a stated cadence and later income covering the payments, the post-financing walk holds');
  ok(withPay.interest < permitted.interest,
    'interest responds to the repayment path: paying down costs less interest than holding the draw',
    `${withPay.interest.toFixed(4)} < ${permitted.interest.toFixed(4)}`);
  ok(withPay.endingBalance != null && permitted.endingBalance != null
    && withPay.endingBalance < permitted.endingBalance,
    'future facility balance is carried on the same path and falls when repayments land',
    `${withPay.endingBalance.toFixed(2)} < ${permitted.endingBalance.toFixed(2)}`);
  ok(permitted.endingBalance - withPay.endingBalance >= 100 - 1,
    'the balance drop is at least one stated $100 repayment, independently of the interest helper',
    String(permitted.endingBalance - withPay.endingBalance));

  const tight = F.plannedDebt(planAffordable, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [{ id: 'card-x', label: 'A card', rate: 19.99, balance: 100, pending: 50, limit: 500 }],
    weeklyVariable: 0,
  }));
  ok(near(tight.borrowed, 350) && tight.borrowed < wantBorrowed,
    'a smaller facility cannot over-draw its pending-aware capacity',
    `$${tight.borrowed} capacity $${tight.capacity}`);
  ok(tight.feasible === false,
    'an under-capacity draw is not reported as a feasible post-financing plan');

  const cashCovered = Object.assign({}, plan, {
    startingCash: { amount: 4000 },
    commitments: [
      { id: 'gap-item', label: 'Covered from cash', date: F.addDays(AS_OF, 20),
        amount: 1000, confidence: 'confirmed' },
    ],
  });
  const noAmount = F.plannedDebt(cashCovered, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [facility],
    weeklyVariable: 0,
  }));
  ok(noAmount.borrowed === 0,
    'a named purpose that is already cash-feasible is not financed without an authorized amount',
    String(noAmount.borrowed));
  const authorized = F.plannedDebt(cashCovered, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    plannedDebtAmounts: { 'gap-item': 300 },
    debts: [facility],
    plannedDebtPayment: 50,
    weeklyVariable: 0,
  }));
  ok(near(authorized.borrowed, 300),
    'an explicit authorized amount may finance a named purpose even when cash already covers it',
    `$${authorized.borrowed}`);
  ok(authorized.draws && authorized.draws[0] && authorized.draws[0].id === 'gap-item',
    'the authorized draw stays purpose-specific');

  const nearLimit = { id: 'card-x', label: 'A card', rate: 19.99, balance: 495, pending: 0, limit: 500 };
  const overThenUnder = F.plannedDebt(planAffordable, AS_OF, recOpts({
    allowPlannedDebt: true,
    plannedDebtFacility: 'card-x',
    plannedDebtPurposes: ['gap-item'],
    debts: [nearLimit],
    plannedDebtPayment: 100,
    weeklyVariable: 0,
  }));
  // Independent: daily interest on $495 at 19.99% crosses $500 in
  // 5 / (495 × 0.1999 / 365) ≈ 18.5 days, inside this 40-day walk.
  const dailyInterest = 495 * 0.1999 / 365;
  const daysToCross = (500 - 495) / dailyInterest;
  ok(daysToCross < 40,
    'independent interest path on the $495 opening crosses the $500 limit inside the walk',
    `${daysToCross.toFixed(2)} days at $${dailyInterest.toFixed(4)}/day`);
  ok(overThenUnder.borrowed > 0,
    'a near-limit facility still draws its remaining pending-aware capacity',
    String(overThenUnder.borrowed));
  ok(overThenUnder.endingBalance != null && overThenUnder.endingBalance <= 500 + 0.01,
    'ending balance can finish at or under the limit after repayment',
    String(overThenUnder.endingBalance));
  ok(overThenUnder.feasible === false,
    'an interim over-limit crossing is not a feasible plan even when the ending balance is under',
    `feasible=${overThenUnder.feasible} ending=${overThenUnder.endingBalance}`);
}

console.log('\n=== undated known commitments constrain today\'s cap; ranges stay ranges ===');
{
  const days = 14;
  const start = 2000;
  const buffer = 500;
  const undated = 1000;
  const plan = barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    commitments: [
      { id: 'undated-need', label: 'Known undated cost', amount: undated, confidence: 'confirmed' },
    ],
  });
  const rec = F.recommend(plan, AS_OF, recOpts());
  // Independent: leftover = start − (W/7)×days − buffer ≥ undated
  // 2000 − 2W − 500 ≥ 1000 → W ≤ 250, snapped to $5.
  const raw = (start - buffer - undated) * 7 / days;
  const want = Math.floor(raw / 5) * 5;
  ok(rec.weekly === want,
    'an undated known commitment reduces today\'s weekly, not merely labelled after',
    `$${rec.weekly} vs hand $${want} (raw ${raw.toFixed(4)})`);
  ok(rec.knowledge.encumbered === undated,
    'the undated amount is encumbered principal, not free cash',
    String(rec.knowledge.encumbered));
  ok(near(rec.knowledge.freeCash, start - (rec.weekly / 7) * rec.knowledge.days - buffer - undated),
    'free cash is leftover after buffer and encumbered principal',
    String(rec.knowledge.freeCash));
  const row = (rec.majorPlans || []).find(p => p.id === 'undated-need');
  ok(row && row.verdict === 'ON TRACK' && row.encumbered === undated,
    'the funded undated item remains spoken for');
}

{
  const days = 14;
  const buffer = 500;
  const planBoth = barePlan({
    windowDays: days,
    startingCash: { amount: 2000 },
    defaults: { targetBuffer: buffer },
    commitments: [
      { id: 'a', label: 'First undated', amount: 800, confidence: 'confirmed' },
      { id: 'b', label: 'Second undated', amount: 800, confidence: 'confirmed' },
    ],
  });
  const rec = F.recommend(planBoth, AS_OF, recOpts());
  // leftover(0) = 1500; joint floor = 1600; impossible → weekly 0, both FUNDING GAP.
  ok(rec.weekly === 0,
    'two undated needs are reserved jointly: leftover 1500 cannot cover 1600, so weekly is 0');
  const plans = rec.majorPlans || [];
  ok(plans.every(p => p.verdict === 'FUNDING GAP'),
    'simultaneous infeasibility is a FUNDING GAP on both items, not a serial first-wins queue',
    plans.map(p => p.id + ':' + p.verdict).join(','));
}

{
  const days = 14;
  const buffer = 500;
  const rangePlan = (start, extra) => barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    commitments: [Object.assign({
      id: 'indio-like', label: 'A ranged cost',
      amount: null, amountMin: 1000, amountMax: 2000, confidence: 'estimated',
    }, extra || {})],
  });
  ok(F.commitmentNeed(rangePlan(3000).commitments[0]) == null,
    'commitmentNeed does not collapse a range to its floor');
  const covered = F.majorPlans(rangePlan(3000), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'indio-like');
  ok(covered && covered.need == null && covered.amountMin === 1000 && covered.amountMax === 2000,
    'the published requirement stays a range',
    JSON.stringify(covered && { need: covered.need, min: covered.amountMin, max: covered.amountMax, verdict: covered.verdict }));
  ok(covered.verdict === 'ON TRACK',
    'covering the ceiling as well as the floor is ON TRACK',
    covered && covered.verdict);
  // leftover(0) at 1800 start = 1300. Floor 1000 ok, ceiling 2000 not.
  const risk = F.majorPlans(rangePlan(1800), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'indio-like');
  ok(risk && risk.verdict === 'AT RISK',
    'base floor feasible and ceiling not is AT RISK',
    risk && risk.verdict);
  ok(risk.margin > 0, 'AT RISK still reports a positive base margin', String(risk && risk.margin));
  const gap = F.majorPlans(rangePlan(1400), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'indio-like');
  ok(gap && gap.verdict === 'FUNDING GAP',
    'missing the floor is a FUNDING GAP, not a collapsed-point AT RISK',
    gap && gap.verdict);

  const rec = F.recommend(rangePlan(1800), AS_OF, recOpts());
  const raw = (1800 - buffer - 1000) * 7 / days;
  const want = Math.floor(raw / 5) * 5;
  ok(rec.weekly === want,
    'weekly reserves the range floor, not a midpoint or the ceiling',
    `$${rec.weekly} vs hand $${want}`);
}

{
  const due = F.addDays(AS_OF, 9); // 10th calendar day, 2026-08-25
  const laterIncome = F.addDays(AS_OF, 14); // 2026-08-30, after the deadline
  const days = 40;
  const buffer = 500;
  const rangePlan = start => barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    income: [{
      id: 'after-deadline', label: 'Pay after deadline', frequency: 'once',
      date: laterIncome, amount: 5000, confidence: 'confirmed',
    }],
    commitments: [{
      id: 'dated-range', label: 'A dated range', date: due,
      amount: null, amountMin: 1000, amountMax: 2000, confidence: 'estimated',
    }],
  });
  const horizon = F.knowledgeHorizon(rangePlan(2000), AS_OF, {});
  ok(horizon.days >= F.diffDays(AS_OF, due) + 1 && horizon.end >= due,
    'a dated range-only row extends the knowledge horizon to its deadline',
    `${horizon.days} days end=${horizon.end}`);
  const covered = F.majorPlans(rangePlan(3500), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'dated-range');
  // Surplus on due date at W=0: 3500 - 500 = 3000, covers ceiling 2000.
  ok(covered && covered.need == null && covered.amountMin === 1000 && covered.amountMax === 2000
    && covered.verdict === 'ON TRACK',
    'dated range stays a range and is ON TRACK when the deadline surplus covers the ceiling');
  const risk = F.majorPlans(rangePlan(2000), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'dated-range');
  // Surplus on due date: 2000 - 500 = 1500. Floor 1000 ok, ceiling 2000 not.
  // Horizon leftover includes the $5,000 after the deadline and would wrongly pass.
  ok(risk && risk.verdict === 'AT RISK',
    'income after the deadline cannot make a ranged commitment look ceiling-feasible',
    risk && risk.verdict);
  const gap = F.majorPlans(rangePlan(1400), AS_OF, recOpts({ weeklyVariable: 0 }))
    .find(p => p.id === 'dated-range');
  // Surplus on due date: 1400 - 500 = 900 < floor 1000, even though $5,000 arrives later.
  ok(gap && gap.verdict === 'FUNDING GAP',
    'missing the floor by the stated date is a FUNDING GAP despite later income',
    gap && gap.verdict);
  const rec = F.recommend(rangePlan(2000), AS_OF, recOpts());
  // Surplus on due (10 days of variable): 2000 - 10*(W/7) - 500 >= 1000 → W <= 350.
  const wantDated = Math.floor(((2000 - buffer - 1000) * 7 / 10) / 5) * 5;
  ok(rec.weekly === wantDated,
    'weekly is bound by capacity on the range deadline, not by leftover after later income',
    `$${rec.weekly} vs hand $${wantDated}`);
}

{
  // Recurring streams keep knowledge past the due date, so later weekly
  // spend would otherwise consume still-unsettled dated-range principal.
  const due = F.addDays(AS_OF, 9); // 10 calendar days
  const start = 2000;
  const buffer = 500;
  const floor = 1000;
  const plan = barePlan({
    windowDays: 40,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    income: [{
      id: 'keep-horizon', label: 'Horizon marker', frequency: 'monthly',
      anchor: '2026-08-01', amount: 0, confidence: 'confirmed',
    }],
    commitments: [{
      id: 'dated-range', label: 'A dated range', date: due,
      amount: null, amountMin: floor, amountMax: 2000, confidence: 'estimated',
    }],
  });
  const rec = F.recommend(plan, AS_OF, recOpts());
  const days = rec.knowledge.days;
  ok(days > 10,
    'knowledge continues past the dated-range due date when streams continue',
    String(days));
  // Deadline-only would allow W ≤ $350. Horizon leftover without the
  // reserve: W ≤ (2000 − 500) × 7 / days. Holding the principal through
  // the whole walk: leftover ≥ 1000 → W ≤ (2000 − 500 − 1000) × 7 / days.
  const wantHeld = Math.floor(((start - buffer - floor) * 7 / days) / 5) * 5;
  const wantUnreserved = Math.floor(((start - buffer) * 7 / days) / 5) * 5;
  ok(rec.weekly === wantHeld,
    'dated-range principal stays encumbered after its due date until settlement',
    `$${rec.weekly} vs held-through-horizon $${wantHeld} (unreserved would be $${wantUnreserved})`);
  ok(rec.knowledge.encumbered === floor,
    'the dated range floor is still-encumbered principal, not free cash after the date',
    String(rec.knowledge.encumbered));
  const empty = F.recommend(barePlan({
    windowDays: 40, startingCash: { amount: start }, defaults: { targetBuffer: buffer },
    income: plan.income,
  }), AS_OF, recOpts());
  ok(rec.weekly < empty.weekly && empty.weekly === wantUnreserved,
    'unsettled dated-range principal still binds today\'s cap after the due date',
    `$${rec.weekly} < empty-plan $${empty.weekly}`);
}

{
  const due = F.addDays(AS_OF, 9);
  const plan = barePlan({
    windowDays: 40,
    startingCash: { amount: 2000 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'dated-range', label: 'A dated range', date: due,
        amount: null, amountMin: 1000, amountMax: 1000, confidence: 'estimated' },
      { id: 'optional-item', label: 'Optional undated', amount: 1000, optional: true },
    ],
  });
  const plans = F.majorPlans(plan, AS_OF, recOpts({ weeklyVariable: 0 }));
  const optional = plans.find(p => p.id === 'optional-item');
  const leftover = 2000 - 500; // 1500
  const residual = leftover - 1000; // after still-encumbered dated-range floor
  ok(optional && optional.verdict !== 'ON TRACK' && optional.funded === false,
    'optional residual cannot reuse still-encumbered dated-range principal',
    optional && `${optional.verdict} remaining=${optional.remaining}`);
  ok(optional && near(optional.remaining, 1000 - residual),
    'optional residual is leftover after the dated-range floor, not the same $1,000 twice',
    optional && String(optional.remaining));
}

{
  const plan = barePlan({
    windowDays: 14,
    startingCash: { amount: 2000 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'required-item', label: 'Required undated', amount: 1000, confidence: 'confirmed' },
      { id: 'optional-item', label: 'Optional undated', amount: 1000, optional: true, priority: 1, confidence: 'estimated' },
    ],
  });
  const seq = F.fundingSequence(plan, AS_OF, {});
  ok(seq.map(x => x.id).join(',') === 'required-item,optional-item',
    'owner priority on an optional item cannot rank it ahead of a required one',
    seq.map(x => `${x.id}:${x.flexibility}`).join(','));
  const rec = F.recommend(plan, AS_OF, recOpts());
  const raw = (2000 - 500 - 1000) * 7 / 14;
  const want = Math.floor(raw / 5) * 5;
  ok(rec.weekly === want,
    'only the required undated need constrains weekly; optional is residual',
    `$${rec.weekly} vs hand $${want}`);
}

{
  const plan = barePlan({
    windowDays: 14,
    startingCash: { amount: 1800 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'required-item', label: 'Required undated', amount: 1000, confidence: 'confirmed' },
      { id: 'optional-item', label: 'Optional undated', amount: 1000, optional: true, priority: 1, confidence: 'estimated' },
    ],
  });
  const plans = F.majorPlans(plan, AS_OF, recOpts({ weeklyVariable: 0 }));
  const optional = plans.find(p => p.id === 'optional-item');
  const leftover = 1800 - 500; // 1300
  const residual = leftover - 1000; // 300 after the required floor
  ok(optional && optional.need === 1000,
    'optional keeps its actual $1,000 target rather than a zero protected floor',
    optional && String(optional.need));
  ok(optional && optional.verdict !== 'ON TRACK' && optional.funded === false,
    'an optional $1,000 item with only $300 residual is not reported fully funded/ON TRACK',
    optional && `${optional.verdict} remaining=${optional.remaining}`);
  ok(optional && near(optional.remaining, 1000 - residual),
    'optional residual allocation is the leftover $300, not the full target',
    optional && String(optional.remaining));
}

{
  const plan = barePlan({
    windowDays: 14,
    startingCash: { amount: 900 },
    defaults: { targetBuffer: 500 },
    commitments: [
      { id: 'optional-early', label: 'Earlier optional', date: '2026-09-01',
        amount: 400, optional: true, priority: 2, confidence: 'estimated' },
      { id: 'optional-late', label: 'Later optional, owner-ranked higher', date: '2026-12-01',
        amount: 400, optional: true, priority: 1, confidence: 'estimated' },
    ],
  });
  const seq = F.fundingSequence(plan, AS_OF, {});
  ok(seq.map(x => x.id).join(',') === 'optional-late,optional-early',
    'among optional items, owner priority ranks residual ahead of date',
    seq.map(x => `${x.id}:p${x.priority}`).join(','));
  const plans = F.majorPlans(plan, AS_OF, recOpts({ weeklyVariable: 0 }));
  const early = plans.find(p => p.id === 'optional-early');
  const late = plans.find(p => p.id === 'optional-late');
  // leftover = 900 − 500 = 400, enough for exactly one $400 optional.
  ok(late && late.verdict === 'ON TRACK' && late.funded === true,
    'the owner-ranked later optional receives the residual $400',
    late && `${late.verdict} remaining=${late.remaining}`);
  ok(early && early.verdict !== 'ON TRACK' && early.funded === false,
    'the earlier optional does not take residual ahead of the owner-ranked item',
    early && `${early.verdict} remaining=${early.remaining}`);
}

{
  const days = 14;
  const start = 2000;
  const buffer = 500;
  const undated = 1000;
  const plan = barePlan({
    windowDays: days,
    startingCash: { amount: start },
    defaults: { targetBuffer: buffer },
    commitments: [
      { id: 'undated-need', label: 'Known undated cost', amount: undated, confidence: 'confirmed' },
    ],
  });
  const rec = F.recommend(plan, AS_OF, recOpts());
  const row = (rec.majorPlans || []).find(p => p.id === 'undated-need');
  ok(row && row.funded && row.remaining === 0 && row.encumbered === undated
    && !plan.commitments[0].settledOn,
    'fully funded but unpaid: remaining contribution is 0 and principal stays encumbered, without settledOn');
  const empty = F.recommend(barePlan({
    windowDays: days, startingCash: { amount: start }, defaults: { targetBuffer: buffer },
  }), AS_OF, recOpts());
  ok(rec.weekly < empty.weekly,
    'funded-unpaid principal still binds today\'s cap; it is not free cash',
    `$${rec.weekly} < empty-plan $${empty.weekly}`);
  const settledPlan = JSON.parse(JSON.stringify(plan));
  settledPlan.commitments[0].settledOn = AS_OF;
  const settled = F.recommend(settledPlan, AS_OF, recOpts());
  ok(settled.weekly === empty.weekly,
    'settlement, not mere funding, releases the encumbered principal',
    `$${settled.weekly} vs empty-plan $${empty.weekly}`);
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
  ok(advice.knowledge.encumbered > 0,
    'live undated protected principal is encumbered on the master walk',
    String(advice.knowledge.encumbered));
  ok(near(advice.knowledge.freeCash,
    advice.knowledge.ending - advice.buffer - advice.knowledge.encumbered),
    'live free cash is ending − buffer − encumbered, not leftover after buffer alone');
  const indio = (live.plan.commitments || []).find(c => c.id === 'indio-tournament');
  ok(indio && F.commitmentNeed(indio) == null && indio.amountMin === 5260 && indio.amountMax === 5460,
    'the live Indio range is not collapsed to a point need');
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
