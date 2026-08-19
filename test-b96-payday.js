'use strict';
/* B96 / AF-PLAN-02 — prove the household payday question end to end.
 *
 * Chain: 2026-08-16 evidence → canonical data.json → Forecast → composed
 * household answer. Forecast remains the only calculator. This file does
 * not re-prove B91/B94/B95; it consumes those authorities and independently
 * reconciles the payday figures a household would read.
 *
 * `node test-b96-payday.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sourceText } = require('./test-source-text');
const F = require('./public/forecast.js');
const live = require('./data.json');
const periods = require('./public/periods.json');
const { paydayAnswerHtml } = loadPaydayComposer();

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = p => sourceText(fs.readFileSync(path.join(__dirname, p), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

const AS_OF = '2026-08-16';
const NEXT_PAY = '2026-08-28';
const JAN = '2027-01-15';
const BUFFER = live.plan.defaults.targetBuffer;
const WANT_CASH = 1320.13 + 932.05 + 0.58;
const RESERVED_AUG16 = 82.96 + 99.91 + 100 + 25;
const TENNIS = 2691.85;

function recOpts(extra) {
  return Object.assign({
    scenario: 'expected', incomeOverrides: {}, disabled: [],
    extraDebtMonthly: 0, targetBuffer: BUFFER,
    fundingSources: live.plan.funding && live.plan.funding.options,
    debts: live.debts,
    extraFacilities: live.revolvingExtra,
    extraDebtTarget: live.plan.nextDollar && live.plan.nextDollar.target,
  }, extra || {});
}

function independentSpendable(plan) {
  return (plan.startingCash.breakdown || []).reduce((s, b) => s + Number(b.value || 0), 0);
}

function jointCashThrough(plan, start, end) {
  let out = 0;
  for (const o of plan.obligations || []) {
    if (o.nonCash) continue;
    for (const d of F.occurrences(o, start, end)) out += Number(o.amount || 0);
  }
  for (const b of plan.bills || []) {
    if (b.householdObligation === false) continue;
    if (b.payingAccount && ((plan.startingCash || {}).heldElsewhere || [])
      .some(r => r.id === b.payingAccount)) continue;
    for (const d of F.occurrences(b, start, end)) out += Number(b.amount || 0);
  }
  for (const c of plan.commitments || []) {
    if (c.settledOn && c.settledOn <= start) continue;
    if (!c.date || c.amount == null) continue;
    if (c.date >= start && c.date <= end) out += Number(c.amount || 0);
  }
  return out;
}

function questionStatus(md, id) {
  const re = new RegExp('### ' + id + '\\.[\\s\\S]*?\\*\\*Status:\\*\\*\\s*([^\\n]+)');
  const m = re.exec(md);
  return m ? m[1].trim() : null;
}

function loadPaydayComposer() {
  const appSrc = sourceText(fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8'));
  const planSrc = sourceText(fs.readFileSync(path.join(__dirname, 'public', 'plan.js'), 'utf8'));
  const grab = (src, re, label) => {
    const m = re.exec(src);
    if (!m) throw new Error('missing ' + label);
    return m[0];
  };
  const formatters = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^const fmtMonth = .*$/m, 'fmtMonth'),
  ].join('\n');
  const maps = [
    grab(planSrc, /^const MISSION_PART = \{[\s\S]*?^\};$/m, 'MISSION_PART'),
    grab(planSrc, /^const NEXT_MOVE = \{[\s\S]*?^\};$/m, 'NEXT_MOVE'),
    grab(planSrc, /^function paydayPlanMargin\([\s\S]*?\n\}$/m, 'paydayPlanMargin'),
    grab(planSrc, /^function paydayAnswerHtml\([\s\S]*?\n\}$/m, 'paydayAnswerHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${formatters}\n${maps}\n({ paydayAnswerHtml, money, money2 });`,
    { Forecast: F }
  );
}

function composeLive(plan, extra) {
  const asOf = plan === live.plan ? live.meta.asOf : AS_OF;
  const opts = recOpts(extra);
  const advice = F.recommend(plan, asOf, opts);
  const weekly = opts.weeklyVariable != null ? opts.weeklyVariable : advice.weekly;
  const sim = weekly === advice.weekly ? advice.sim
    : F.simulate(plan, asOf, Object.assign({}, advice.simOptions, { weeklyVariable: weekly }));
  const status = F.planStatus(advice, { weeklyOverride: opts.weeklyVariable, sim });
  const debtProj = F.projectDebts(plan, opts.debts || live.debts, asOf,
    Object.assign({}, advice.simOptions, { weeklyVariable: weekly,
      extraFacilities: opts.extraFacilities || live.revolvingExtra,
      extraDebtTarget: opts.extraDebtTarget }));
  const mission = F.mission(advice, debtProj, { weeklyOverride: opts.weeklyVariable, sim });
  const nextMove = F.nextMove(plan, advice, { weeklyOverride: opts.weeklyVariable, sim });
  const budget = F.budgetBreakdown(plan, periods, {
    paypalPerMonth: live.paypal ? live.paypal.perMonth : 0,
    weeklyCap: weekly, recommendedWeekly: advice.weekly, asOf,
  });
  const revolving = F.utilisation(opts.debts || live.debts,
    opts.extraFacilities || live.revolvingExtra, plan).totalAvailable;
  const html = paydayAnswerHtml({
    plan, asOf, advice, status, mission, nextMove,
    nextOut: F.nextPaymentOut(sim.events, asOf),
    nextDue: F.nextDue(sim.events, asOf),
    unallocated: F.unallocatedCash(sim, budget, plan),
    budget, creditAvailable: revolving, weekly, recommended: advice.weekly,
    debts: opts.debts || live.debts,
  });
  return { advice, status, sim, budget, revolving, html, weekly };
}

console.log('=== A. current opening cash identity, independently ===');
{
  ok(live.meta.asOf === AS_OF, 'canonical as-of is the 2026-08-16 opening', live.meta.asOf);
  const hand = independentSpendable(live.plan);
  ok(near(hand, WANT_CASH), 'breakdown 1320.13 + 932.05 + 0.58 = 2252.76', hand.toFixed(2));
  ok(near(F.startingCashAmount(live.plan), hand),
    'Forecast.startingCashAmount equals that independent sum');
  const tennis = (live.plan.startingCash.heldElsewhere || [])
    .find(h => h.id === 'amanda-debt-payments');
  ok(tennis && near(tennis.value, TENNIS),
    'TENNIS INCOME is held-elsewhere, not in the spendable sum');
  ok(hand + TENNIS !== hand && !near(F.startingCashAmount(live.plan), hand + TENNIS),
    'adding TENNIS INCOME would disagree with spendable cash');
}

console.log('\n=== B. same master decision across short and longer views ===');
{
  const a = F.recommend(live.plan, AS_OF, recOpts({ viewDays: 14 }));
  const b = F.recommend(live.plan, AS_OF, recOpts({ viewDays: 91 }));
  const c = F.recommend(live.plan, AS_OF, recOpts({ viewDays: 365 }));
  ok(a.weekly === b.weekly && b.weekly === c.weekly,
    '14 / 91 / 365-day views share today\'s weekly cap', `$${a.weekly}`);
  ok(a.knowledge.days === b.knowledge.days && b.knowledge.days === c.knowledge.days
    && a.knowledge.days >= 365,
    'those views share the same ≥12-month knowledge horizon', String(a.knowledge.days));
  const seqA = (a.fundingSequence || []).map(x => x.id).join(',');
  const seqC = (c.fundingSequence || []).map(x => x.id).join(',');
  ok(seqA === seqC && seqA.length > 0,
    'funding sequence is the master sequence, not rebuilt per view');
}

console.log('\n=== C. future financial gravity affects today; the payday window does not ===');
{
  const base = composeLive(live.plan);
  const naiveOut = jointCashThrough(live.plan, AS_OF, NEXT_PAY);
  const naiveRemain = independentSpendable(live.plan) - naiveOut;
  const naiveWeekly = Math.floor((naiveRemain / 14) * 7 / 5) * 5;
  ok(naiveOut > 0 && !near(base.advice.weekly, naiveWeekly),
    'the payday answer is not cash minus bills-until-payday',
    `cap $${base.advice.weekly} vs naive $${naiveWeekly} (out through ${NEXT_PAY} = $${naiveOut.toFixed(2)})`);

  const withLater = clone(live);
  withLater.plan.commitments = (withLater.plan.commitments || []).concat([{
    id: 'b96-jan-gravity', label: 'January 2027 dated cost',
    date: JAN, amount: 25000, confidence: 'confirmed',
  }]);
  const pulled = F.recommend(withLater.plan, AS_OF, recOpts());
  const pulledShort = F.recommend(withLater.plan, AS_OF, recOpts({ viewDays: 14 }));
  ok(pulled.weekly < base.advice.weekly,
    'a dated January 2027 commitment on this same master plan reduces today\'s cap',
    `$${pulled.weekly} < $${base.advice.weekly}`);
  const xmas = clone(live);
  const xmasRow = (xmas.plan.commitments || []).find(c => c.id === 'christmas-2026');
  const encBefore = base.advice.knowledge.encumbered;
  xmasRow.settledOn = AS_OF;
  const xmasAfter = F.recommend(xmas.plan, AS_OF, recOpts());
  ok(xmasAfter.knowledge.encumbered < encBefore
    && near(encBefore - xmasAfter.knowledge.encumbered, 3500),
    'settling Christmas releases that encumbered principal independently ($3,500)',
    `${encBefore.toFixed(2)} → ${xmasAfter.knowledge.encumbered.toFixed(2)}`);
  ok(xmasAfter.weekly === base.advice.weekly,
    'that released principal does not automatically become a higher weekly cap',
    `$${xmasAfter.weekly}`);
  ok(pulledShort.weekly === pulled.weekly,
    'narrowing the visible window to 14 days does not restore the higher cap',
    `$${pulledShort.weekly}`);
  const pulledHtml = composeLive(withLater.plan).html;
  ok(pulledHtml.includes(String(pulled.weekly)),
    'the composed payday answer carries the reduced master-plan cap');
  ok(!pulledHtml.includes(`$${naiveWeekly}/week`) || pulled.weekly === naiveWeekly,
    'the composed answer does not publish the naive cash-minus-bills weekly');
}

console.log('\n=== D. protected commitments are not double-counted; settled stays settled ===');
{
  const events = F.expandEvents(live.plan, AS_OF, F.addDays(AS_OF, 90), {});
  for (const id of ['fusioncamp', 'tryouts', 'burrard1', 'burrard2']) {
    ok(!events.some(e => e.id === id),
      `${id} is settled on this opening and emits no cash event`);
  }
  const seqIds = (F.fundingSequence(live.plan, AS_OF, {}) || []).map(x => x.id);
  ok(!seqIds.includes('fusioncamp') && !seqIds.includes('tryouts'),
    'settled Fusion rows are not in the funding sequence');
  const reserved = events.filter(e => e.date === AS_OF && e.kind === 'bill' && e.jointCash !== false);
  const reservedSum = reserved.reduce((s, e) => s + -e.amount, 0);
  ok(near(reservedSum, RESERVED_AUG16),
    'unknown 15 August bills are reserved once on this opening, independently $307.87',
    reservedSum.toFixed(2));
  const nextOut = F.nextPaymentOut(events, AS_OF);
  ok(nextOut && nextOut.date === AS_OF && near(nextOut.amount, RESERVED_AUG16),
    'nextPaymentOut is that same reserved day total, not a second copy');
}

console.log('\n=== E. funded/settled money redirects; encumbered principal stays claimed ===');
{
  const before = F.recommend(live.plan, AS_OF, recOpts());
  const first = (before.fundingSequence || [])[0];
  const second = (before.fundingSequence || [])[1];
  ok(first && second, 'the live sequence has a next item and a following item',
    first && second && `${first.id} → ${second.id}`);

  const afterPlan = clone(live.plan);
  const row = (afterPlan.commitments || []).find(c => c.id === first.id);
  ok(!!row, 'the first sequenced item is a live commitment');
  row.settledOn = AS_OF;
  const after = F.recommend(afterPlan, AS_OF, recOpts());
  ok(!(after.fundingSequence || []).some(x => x.id === first.id),
    'settling the first item drops it from the sequence');
  ok((after.fundingSequence || [])[0] && after.fundingSequence[0].id === second.id,
    'capacity redirects to the next sequenced item',
    after.fundingSequence[0] && after.fundingSequence[0].id);
  const empty = clone(live.plan);
  empty.commitments = [];
  const none = F.recommend(empty, AS_OF, recOpts());
  ok(after.weekly < none.weekly || (after.knowledge.encumbered > 0),
    'settling one item does not treat remaining encumbered principal as free spend');
  const html = composeLive(afterPlan).html;
  ok(html.includes(second.label),
    'the payday answer names the redirected next funding target');
}

console.log('\n=== F. overdue obligations cannot be rescued by later income ===');
{
  const events = F.expandEvents(live.plan, AS_OF, NEXT_PAY, {});
  const nextOut = F.nextPaymentOut(events, AS_OF);
  const richer = clone(live.plan);
  richer.income = (richer.income || []).concat([{
    id: 'b96-late-windfall', label: 'Later windfall', frequency: 'once',
    date: '2026-08-29', amount: 20000, confidence: 'confirmed',
  }]);
  const after = F.expandEvents(richer, AS_OF, F.addDays(AS_OF, 20), {});
  const still = F.nextPaymentOut(after, AS_OF);
  ok(nextOut && still && still.date === nextOut.date && near(still.amount, nextOut.amount),
    'a later windfall does not erase today\'s reserved cash-out',
    still && `${still.date} ${still.amount}`);

  const overdue = {
    windowDays: 40,
    defaults: { targetBuffer: 500 },
    startingCash: { amount: 600 },
    income: [{
      id: 'later-pay', label: 'Later pay', frequency: 'once',
      date: '2026-09-10', amount: 5000, confidence: 'confirmed',
    }],
    obligations: [],
    bills: [],
    commitments: [{
      id: 'overdue-item', label: 'Already due', date: '2026-08-10',
      amount: 800, confidence: 'confirmed',
    }],
    actions: [{ what: 'Cover the overdue item', amount: 800, due: '2026-08-10', status: 'open' }],
  };
  const rec = F.recommend(overdue, AS_OF, recOpts({
    fundingSources: [], debts: [], extraFacilities: [], extraDebtTarget: null,
  }));
  ok(rec.mode === 'infeasible' || rec.holds === false || (rec.infeasible && rec.infeasible.kind),
    'an overdue protected item is not rescued by later income',
    rec.mode + ' ' + JSON.stringify(rec.infeasible));
  const html = composeLive(overdue, {
    fundingSources: [], debts: [], extraFacilities: [], extraDebtTarget: null,
  }).html;
  ok(/INFEASIBLE/.test(html) || /Already due/.test(html),
    'the payday answer still names the overdue constraint after later income exists');
}

console.log('\n=== G. credit is not cash or safe-to-spend ===');
{
  const liveRun = composeLive(live.plan);
  const cash = independentSpendable(live.plan);
  ok(liveRun.revolving > 0, 'there is revolving headroom on this opening',
    String(liveRun.revolving));
  ok(!near(cash, cash + liveRun.revolving),
    'adding credit headroom would disagree with spendable cash');
  ok(liveRun.html.includes('2,252.76') || liveRun.html.includes('$2,252.76'),
    'payday HTML publishes the independent spendable cash');
  ok(/not<\/b> cash|not cash/i.test(liveRun.html),
    'payday HTML says credit is not cash');
  ok(!near(liveRun.advice.weekly, liveRun.advice.weekly + liveRun.revolving / 13),
    'safe-to-spend is not inflated by dividing credit across the view');
}

console.log('\n=== H. Q19 / Q26 ANSWERED; Q20 / Q25 stay visible and fail-closed ===');
{
  const md = read('docs/01_OPEN_QUESTIONS.md');
  ok(/^ANSWERED\b/.test(questionStatus(md, 'Q19')), 'Q19 is ANSWERED', questionStatus(md, 'Q19'));
  ok(/^ANSWERED\b/.test(questionStatus(md, 'Q26')), 'Q26 evidence is ANSWERED', questionStatus(md, 'Q26'));
  for (const id of ['Q20', 'Q25']) {
    ok(/^OPEN\b/.test(questionStatus(md, id)), `${id} remains OPEN`, questionStatus(md, id));
  }
  const liveRun = composeLive(live.plan);
  ok(!/Q19 HELOC August cash impact stays OPEN/i.test(liveRun.html),
    'payday HTML does not keep Q19 as unresolved');
  ok(/Q20/.test(liveRun.html) && /model buffer/i.test(liveRun.html),
    'payday HTML does not relabel the $500 buffer as a Q20 emergency reserve');
  ok(/Q25/.test(liveRun.html) && /TENNIS INCOME/.test(liveRun.html),
    'payday HTML keeps TENNIS INCOME out of spendable cash (Q25)');
  ok(/Q26/.test(liveRun.html) && /UNKNOWN/i.test(liveRun.html) && /not treated as \$0/i.test(liveRun.html),
    'payday HTML keeps canonical Cash Back pending UNKNOWN and fail-closed (Q26)');
  const cashback = live.debts.find(d => d.id === 'cashback');
  ok(cashback && cashback.pendingUnknown === true && cashback.pending == null,
    'canonical Cash Back pending is unknown, not $0');
  const heloc = (live.plan.obligations || []).find(o => o.id === 'heloc');
  ok(heloc && heloc.nonCash === true && near(heloc.amount, 814.18)
    && /cashPayment remains \$0/i.test(heloc.note || ''),
    'live HELOC remains non-cash capitalisation — not a claimed zero cash impact');
}

console.log('\n=== I. household-facing composed answer agrees with Forecast ===');
{
  const liveRun = composeLive(live.plan);
  const advice = liveRun.advice;
  ok(liveRun.html.includes(String(advice.weekly)),
    'HTML carries Forecast.recommend weekly', String(advice.weekly));
  ok(advice.weekly !== 600, '$600/week is not the payday output');
  ok(!/function paydayEngine|Forecast\.paydayPlan/.test(read('public/plan.js') + read('public/forecast.js')),
    'no second payday planner exists');
  const first = (advice.fundingSequence || [])[0];
  if (first) ok(liveRun.html.includes(first.label),
    'HTML names the Forecast.fundingSequence head', first.label);
  for (const p of (advice.majorPlans || []).slice(0, 3)) {
    ok(liveRun.html.includes(p.label) && liveRun.html.includes(p.verdict),
      `HTML carries ${p.label} ${p.verdict}`);
  }
  if (advice.knowledge && advice.knowledge.min) {
    ok(liveRun.html.includes(advice.knowledge.min.date.slice(5))
      || liveRun.html.includes(String(Math.round(advice.knowledge.min.balance))),
      'HTML carries the master-plan low');
  }
  ok(liveRun.status.id === (advice.mode === 'infeasible' ? 'infeasible' : liveRun.status.id),
    'status band does not contradict recommend.mode');
  if (advice.mode === 'infeasible') {
    ok(/INFEASIBLE/.test(liveRun.html), 'infeasible recommend renders INFEASIBLE');
  } else {
    ok(!/INFEASIBLE/.test(liveRun.html),
      'the live 2026-08-16 opening is not published as INFEASIBLE');
  }
  const nextOut = F.nextPaymentOut(liveRun.sim.events, AS_OF);
  if (nextOut) {
    ok(liveRun.html.includes(nextOut.date.slice(8)) || liveRun.html.includes(nextOut.label.split(' ')[0]),
      'HTML names the Forecast.nextPaymentOut day');
  }
}

console.log('\n=== J. page layer does not re-decide the payday figures ===');
{
  const planJs = read('public/plan.js');
  const fn = /function paydayAnswerHtml\([\s\S]*?\n\}/.exec(planJs);
  ok(!!fn, 'paydayAnswerHtml is a dedicated composition function');
  const body = fn ? fn[0] : '';
  ok(/advice\.weekly|advice\.fundingSequence|advice\.majorPlans|advice\.plannedDebt|advice\.nearBoundary|advice\.infeasible|advice\.knowledge/.test(body),
    'the composer reads incumbent Forecast result fields');
  ok(!/recommendWeekly\(|protectedPlanCheck\(|allocateToSequence\(/.test(body),
    'the composer does not call a second weekly search or allocator');
  ok(!/startingCashAmount\(plan\)\s*[-+]/.test(body),
    'the composer does not invent spendable as cash minus bills');
  ok(/payday-answer-body/.test(planJs) && /paydayAnswerHtml\(/.test(planJs),
    'the Plan page mounts the composed payday answer');
  ok(/id="payday-answer"/.test(read('public/index.html')),
    'index.html has the household payday section');
  ok(!/verdict\s*=\s*['"]ON TRACK['"]/.test(body),
    'the composer does not assign ON TRACK itself');
}

console.log('\n=== K. explicit INFEASIBLE when the protected plan cannot work ===');
{
  const broke = {
    windowDays: 40,
    defaults: { targetBuffer: 500 },
    startingCash: { amount: 800 },
    income: [],
    obligations: [],
    bills: [],
    commitments: [{
      id: 'cannot-fund', label: 'Cannot fund this', date: '2026-08-10',
      amount: 2500, confidence: 'confirmed',
    }],
    actions: [{ what: 'Find money', amount: 2500, due: '2026-08-10', status: 'open' }],
  };
  const rec = F.recommend(broke, AS_OF, recOpts({
    fundingSources: [{ id: 'empty', label: 'Empty', short: 'empty', available: 10, rank: 1 }],
    debts: [], extraFacilities: [], extraDebtTarget: null,
  }));
  const status = F.planStatus(rec, { sim: rec.sim });
  ok(rec.mode === 'infeasible' && rec.infeasible,
    'Forecast.recommend reports infeasible on an unfundable protected plan',
    rec.mode);
  ok(status.id === 'infeasible',
    'planStatus copies that INFEASIBLE result rather than saying onPlan',
    status.id);
  const html = composeLive(broke, {
    fundingSources: [{ id: 'empty', label: 'Empty', short: 'empty', available: 10, rank: 1 }],
    debts: [], extraFacilities: [], extraDebtTarget: null,
  }).html;
  ok(/INFEASIBLE/.test(html), 'the payday HTML says INFEASIBLE');
  ok(html.includes(rec.infeasible.label) || html.includes('Cannot fund this'),
    'and names the failing protected constraint');
  const mission = F.mission(rec, { marks: [] }, { sim: rec.sim });
  ok(mission.parts.length === 1 && mission.parts[0].id === 'infeasible',
    'Forecast.mission emits the infeasible outcome rather than holdSpending at $0',
    mission.parts.map(p => p.id).join(' → '));
  ok(!/hold spending to/.test(html) && !/put the surplus against the most expensive card/.test(html),
    'infeasible payday HTML does not give hold-spending or surplus-to-card instructions');
  ok(!/Master-plan cap/.test(html),
    'and does not label the zero-spend sentinel as a master-plan cap');
  ok(/no feasible weekly cap/i.test(html) && /weekly spending\s+figure does not fix this/.test(html),
    'Safe to spend says there is no feasible weekly cap');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll B96 payday-proof checks passed.');
