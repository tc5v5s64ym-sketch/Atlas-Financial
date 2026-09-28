'use strict';
/* AMANDA SLICE 1 — payday instruction shell.
 *
 * The default Budget homepage answers "where does this money need to go?"
 * with one concise shell that reprints Forecast-owned figures only:
 * money available, bills & required minimums, current household spending,
 * the Nest Money instruction (AMANDA SLICE 2), protected cash / minimum
 * floor, optional extra debt, and genuinely unassigned money.
 *
 * AMANDA SLICE 2 — the shell shows this payday's funding plan for
 * future planned costs, and what it is for: the live payday's
 * Plan-Spend-attributable contribution, with its named allocations, is
 * the Nest Money earmark; everything else stays in the BILLS/chequing
 * account. P1 4117851665 repair: the block presents the figure as an
 * earmark/funding-plan amount only — never as an amount to transfer or
 * set aside into a separate bucket, and never with a subtract-prior-
 * moves requirement for the household — because the engine publishes
 * no prior Nest Money move state. The earmark carries an explicit
 * blindness qualifier; it never claims a transfer occurred.
 *
 * Part A (Forecast authority): Forecast.planSpendPaydayFunding publishes
 * the non-overlapping decomposition of the live payday's protectedPath
 * hold — contribution (Plan-Spend-attributable) + nonPlanSpendProtected
 * (everything else in that hold). Deterministic engine fixtures; no live
 * household figures.
 *
 * Part B (page presentation): plan.js reprints those figures with zero
 * page-side arithmetic. In particular the page never derives
 * protectedPath − planSpendAttributed. Unknown is not $0.
 *
 * `node test/test-payday-instruction-shell.js`
 */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

let checks = 0;
function check(label, run) { run(); checks++; console.log('  PASS  ' + label); }

const cent = x => Math.round(Number(x) * 100);

// ---------------------------------------------------------------- Part A ---
// Forecast-owned decomposition, through the real engine.

function basePlan(pay) {
  return {
    defaults: { targetBuffer: 0, extraDebtMonthly: 0 },
    opening: { asOf: '2026-01-16' }, // a Seaspan payday (anchor 2026-01-02 + 14d)
    startingCash: { breakdown: [{ id: 'chequing-a', value: 0 }] },
    income: [{ id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
      anchor: '2026-01-02', amount: pay, confidence: 'confirmed' }],
    obligations: [], bills: [], budget: { categories: [] },
    commitments: [],
  };
}

function runEngine(plan, incumbent) {
  const asOf = plan.opening.asOf;
  const sim = F.simulate(plan, asOf, { horizonDays: 60, viewDays: 60, weeklyVariable: 0 });
  const seq = F.fundingSequence(plan, asOf, {});
  const plans = F.majorPlans(plan, asOf, { weeklyVariable: 0 });
  const alloc = incumbent || F.paydayAllocation(plan, asOf, {
    weeklyVariable: 0, majorPlans: plans,
    plannedDebt: F.plannedDebt(plan, asOf, { weeklyVariable: 0, majorPlans: plans }),
  });
  const sched = F.planSpendPaydayFunding(plan, asOf, sim, seq, plans, alloc);
  const live = sched.paydays.find(p => p.payday === asOf) || null;
  return { asOf, sched, live, alloc };
}

// Mixed ordinary + reserve fixture (mirrors the mixed-reconciliation
// identity case): trip $250 due 1/31 (needs $50 today) + property tax
// $150 due 1/20 (needs $150 today). $200/payday.
function mixedPlan() {
  const plan = basePlan(200);
  plan.commitments = [{ id: 'trip', label: 'Trip', date: '2026-01-31',
    amount: 250, confidence: 'confirmed' }];
  plan.budget.categories = [{ id: 'propertytax', label: 'Property tax', class: 'reserve',
    plannedAmount: 150, planningDate: '2026-01-20', confidence: 'confirmed' }];
  return plan;
}

check('A1: live row publishes nonPlanSpendProtected when the path hold exceeds the Plan Spend attribution', () => {
  const plan = mixedPlan();
  const real = runEngine(plan);
  assert.equal(real.sched.status, 'ready');
  const realAlloc = real.alloc;
  const fcTotal = realAlloc.futureCosts.reduce((s, r) => s + cent(r.allocated || 0), 0);
  const pathAmt = cent(realAlloc.protectedPath.allocated || 0);
  assert.equal(fcTotal, 5000);
  assert.equal(pathAmt, 15000);
  // Synthetic incumbent: same named futureCosts, but the protectedPath
  // hold is $225 — $75 of pending-shaped general protection beyond the
  // $150 this payday's Plan Spend attributes from the path.
  const synthetic = {
    futureCosts: realAlloc.futureCosts,
    protectedPath: { status: 'calculated', allocated: 225 },
  };
  const { sched, live } = runEngine(plan, synthetic);
  assert.equal(sched.status, 'ready');
  assert.ok(live, 'live row exists');
  assert.equal(live.nonPlanSpendProtected, 75);
});

check('A2: contribution + nonPlanSpendProtected counts the hold exactly once (no double counting)', () => {
  const plan = mixedPlan();
  const real = runEngine(plan);
  const synthetic = {
    futureCosts: real.alloc.futureCosts,
    protectedPath: { status: 'calculated', allocated: 225 },
  };
  const { live } = runEngine(plan, synthetic);
  const fcTotal = 5000; // trip, from the incumbent named parts
  const pathTotal = 22500; // bumped protectedPath hold, in cents
  assert.equal(cent(live.contribution) + cent(live.nonPlanSpendProtected), fcTotal + pathTotal);
  // The $75 of general protection is not inside the named allocations:
  // named dollars still sum exactly to the contribution.
  const namedSum = (live.allocations || []).reduce((s, a) => s + cent(a.amount), 0);
  assert.equal(namedSum, cent(live.contribution));
  assert.equal(namedSum, 20000);
});

check('A3: a fully-attributable path publishes a known $0, not an absent field', () => {
  const { sched, live } = runEngine(mixedPlan());
  assert.equal(sched.status, 'ready');
  assert.ok(live, 'live row exists');
  assert.equal(live.nonPlanSpendProtected, 0);
});

check('A4: non-live payday rows publish null (concept does not apply)', () => {
  const { asOf, sched } = runEngine(mixedPlan());
  const later = sched.paydays.filter(p => p.payday !== asOf);
  assert.ok(later.length > 0, 'later payday rows exist');
  for (const row of later) assert.equal(row.nonPlanSpendProtected, null);
});

check('A5: incumbent allocation/reconciliation identity is intact', () => {
  const { sched, live, alloc } = runEngine(mixedPlan());
  assert.equal(sched.status, 'ready');
  const fcTotal = alloc.futureCosts.reduce((s, r) => s + cent(r.allocated || 0), 0);
  const pathAmt = cent(alloc.protectedPath.allocated || 0);
  assert.equal(cent(live.contribution), fcTotal + pathAmt);
  const namedSum = (live.allocations || []).reduce((s, a) => s + cent(a.amount), 0);
  assert.equal(namedSum, cent(live.contribution));
  const ids = (live.allocations || []).map(a => a.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------- Part B ---
// Page reprint behaviour. Deterministic fixture figures (not live numbers).

const planSource = sourceText(fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8'));
const context = vm.createContext({
  fmtDate: value => value,
  fmtDateLong: value => value,
  money2: n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  liveCurrentBalanceHtml: () => '<div data-live-current-balance>cash</div>',
  calendarWaterfallHtml: () => '<article data-waterfall>waterfall</article>',
  periodBillLine: () => '',
});
vm.runInContext(planSource, context);
vm.runInContext(`
  calendarWaterfallHtml = () => '<article data-waterfall>waterfall</article>';
  liveCurrentBalanceHtml = () => '<div data-live-current-balance>cash</div>';
`, context);
const f = context;

const allocFixture = (overrides = {}) => Object.assign({
  payday: '2026-09-25',
  asOf: '2026-09-25',
  lines: [{}],
  available: 5000,
  obligations: { allocated: 2000, shortfall: 0 },
  requiredDebtPayments: { items: [{ id: 'visa-min', label: 'Visa required minimum', amount: 150 }] },
  essentials: { allocated: 800 },
  // Decoy: the raw protectedPath hold. The page must never print it and
  // must never derive a residual from it.
  protectedPath: { status: 'calculated', allocated: 9999.99 },
  extraDebt: { allocated: 250, target: { id: 'travel-visa', label: 'Travel Visa' }, status: 'ok' },
  remainder: 450,
  unresolved: [],
}, overrides);

const scheduleFixture = (overrides = {}) => Object.assign({
  status: 'ready',
  asOf: '2026-09-25',
  source: 'Forecast.planSpendPaydayFunding',
  paydays: [{
    payday: '2026-09-25',
    contribution: 1200,
    allocations: [
      { id: 'a', label: 'Property tax reserve', amount: 700 },
      { id: 'b', label: 'Trip fund', amount: 500 },
    ],
    nonPlanSpendProtected: 300,
    gap: null,
    // Trust state Forecast publishes on the live row; the page renders
    // only this published state.
    trust: 'calculated',
  }],
  gap: null,
}, overrides);

const currentPeriod = { id: 'current:2026-09-25', start: '2026-09-25', end: '2026-10-08', timelineRole: 'current' };

const adviceFixture = (allocOverrides, scheduleOverrides) => ({
  buffer: 500,
  // Trust packet Forecast publishes for the shell (AMANDA SLICE 1 repair).
  // Every figure the shell reprints carries a published trust state.
  paydayShellTrust: {
    available: 'calculated',
    obligations: 'calculated',
    household: 'calculated',
    extraDebt: 'calculated',
    optional: 'calculated',
    remainder: 'calculated',
    buffer: 'calculated',
  },
  paydayAllocation: allocFixture(allocOverrides),
  planSpendPaydayFunding: scheduleOverrides === null ? null : scheduleFixture(scheduleOverrides),
  payPeriodViews: [currentPeriod],
  defaultView: { asOf: '2026-09-25' },
});

const shell = (allocOverrides, scheduleOverrides, period = currentPeriod) =>
  f.paydayInstructionShellHtml(adviceFixture(allocOverrides, scheduleOverrides), period);

check('B1: normal payday renders every block with exact Forecast figures', () => {
  const html = shell();
  assert.match(html, /data-payday-instruction-shell="2026-09-25"/);
  assert.match(html, /Where this payday's money needs to go/);
  assert.match(html, /\$5,000\.00/); // available
  assert.match(html, /\$2,000\.00/); // bills & required minimums
  assert.match(html, /\$800\.00/); // household spending
  assert.match(html, /\$1,200\.00/); // planned spending
  assert.match(html, /Property tax reserve/);
  assert.match(html, /Trip fund/);
  assert.match(html, /Keep at least \$500\.00/); // buffer floor
  assert.match(html, /\$300\.00/); // other protected
  assert.match(html, /\$250\.00/); // extra debt
  assert.match(html, /Travel Visa/);
  assert.match(html, /\$450\.00/); // remainder
});

check('B2: required debt minimums stay inside bills; optional extra stays separate', () => {
  const html = shell();
  assert.match(html, /Required debt minimums are inside this figure/);
  assert.doesNotMatch(html, /Visa required minimum/);
  assert.match(html, /Extra on focus debt/);
  assert.match(html, /\$250\.00/);
});

check('B3: $0 extra debt is explicit and does not erase required minimums', () => {
  const html = shell({ extraDebt: { allocated: 0, target: 'Travel Visa', status: 'ok' } });
  assert.match(html, /No extra principal this payday/);
  assert.match(html, /Required minimums are already in bills above/);
  assert.match(html, /\$2,000\.00/); // bills (with minimums) still shown
});

check('B4: Nest Money earmark shows the contribution with its named purposes', () => {
  const html = shell();
  assert.match(html, /Nest Money funding plan/);
  assert.match(html, /Property tax reserve.*\$700\.00/s);
  assert.match(html, /Trip fund.*\$500\.00/s);
  // P1 4117851665: no move directive — the block is an earmark/funding-plan
  // amount only, never a transfer/set-aside instruction, and never asks
  // the household to subtract prior moves.
  assert.doesNotMatch(html, /Move this amount to your Nest Money bucket/);
  assert.doesNotMatch(html, /Set aside this amount/i);
  assert.match(html, /This payday's share of the funding plan/);
  assert.match(html, /Atlas can't see money you've already moved/);
  assert.doesNotMatch(html, /subtract anything you already set aside/);
  assert.match(html, /No transfer has happened/);
});

check('B5: buffer is a floor/guardrail, never an emergency fund or transfer', () => {
  const html = shell();
  assert.match(html, /Keep at least \$500\.00/);
  assert.match(html, /A cash floor, not a transfer/);
  assert.doesNotMatch(html, /emergency fund/i);
  assert.doesNotMatch(html, /Move \$.*to [Ss]avings/);
});

check('B6: other protected cash is the Forecast-published figure, keep-in-chequing', () => {
  const html = shell();
  assert.match(html, /Other protected cash — keep in chequing/);
  assert.match(html, /\$300\.00/);
  assert.match(html, /not a savings transfer/);
});

check('B7: unresolved planned costs are not relabelled as free money', () => {
  const html = shell({ unresolved: [{ id: 'x', label: 'Mystery cost' }] });
  assert.match(html, /1 planned cost is still unresolved — this is not free money/);
  assert.match(html, /\$450\.00/);
});

check('B8: funding-gap schedule keeps the valid earmark and names the gap', () => {
  const html = shell({}, {
    status: 'funding-gap',
    paydays: [{
      payday: '2026-09-25', contribution: 1200,
      allocations: [{ id: 'a', label: 'Property tax reserve', amount: 1200 }],
      nonPlanSpendProtected: 300, gap: null,
      trust: 'calculated',
    }],
    gap: { payday: '2026-09-25', shortBy: 200, cashDate: '2026-10-15' },
  });
  assert.match(html, /\$1,200\.00/);
  assert.match(html, /Funding shortfall ahead/);
  assert.match(html, /\$200\.00/);
});

check('B9: unavailable schedule fails closed — unknown is not $0', () => {
  const html = shell({}, { status: 'unavailable', paydays: [] });
  assert.match(html, /Nest Money funding plan: unavailable/);
  assert.match(html, /Other protected cash — keep in chequing: unavailable/);
  assert.doesNotMatch(html, /data-plan-spend-earmark/);
});

check('B10: no matching payday row fails closed', () => {
  const html = shell({}, {}, { id: 'x', start: '2026-10-09', end: '2026-10-22', timelineRole: 'future' });
  assert.match(html, /Nest Money funding plan: unavailable/);
});

check('B11: no shell at all without a payday allocation', () => {
  const advice = adviceFixture();
  advice.paydayAllocation = null;
  assert.equal(f.paydayInstructionShellHtml(advice, currentPeriod), '');
});

check('B12: the page never prints or derives from the raw protectedPath hold', () => {
  const html = shell();
  // The decoy hold must not appear anywhere…
  assert.doesNotMatch(html, /9,999\.99/);
  // …nor may either forbidden page-side residual appear…
  assert.doesNotMatch(html, /9,699\.99/); // 9999.99 − 300
  assert.doesNotMatch(html, /8,799\.99/); // 9999.99 − 1200
  // …while the Forecast-published decomposition is reprinted exactly.
  assert.match(html, /\$1,200\.00/);
  const otherProtectedHits = (html.match(/\$300\.00/g) || []).length;
  assert.equal(otherProtectedHits, 1);
});

check('B13: bills shortfall is disclosed, not hidden', () => {
  const html = shell({ obligations: { allocated: 2000, shortfall: 150 } });
  assert.match(html, /Shortfall of \$150\.00 — bills are not fully covered/);
});

check('B14: shell opens the default Budget surface ahead of the waterfall', () => {
  const advice = adviceFixture();
  const html = f.operatingSurfaceHtml({ advice, liveOverlay: null, planLook: 'this-period' });
  const shellAt = html.indexOf('data-payday-instruction-shell');
  const waterfallAt = html.indexOf('data-waterfall');
  assert.ok(shellAt >= 0, 'shell mounts on the default surface');
  assert.ok(waterfallAt >= 0, 'waterfall still renders');
  assert.ok(shellAt < waterfallAt, 'shell opens ahead of the waterfall');
});

check('B15: shell does not render on non-default looks', () => {
  const advice = adviceFixture();
  const html = f.operatingSurfaceHtml({ advice, liveOverlay: null, planLook: 'past:2026-08-01' });
  assert.doesNotMatch(html, /data-payday-instruction-shell/);
});

check('B16: extra-debt target object renders its label, never [object Object]', () => {
  const html = shell();
  assert.match(html, /on Travel Visa/);
  assert.doesNotMatch(html, /\[object Object\]/);
  const stringTarget = shell({ extraDebt: { allocated: 250, target: 'Travel Visa', status: 'ok' } });
  assert.match(stringTarget, /on Travel Visa/);
  const noTarget = shell({ extraDebt: { allocated: 250, target: null, status: 'ok' } });
  assert.match(noTarget, /on the focus debt/);
  assert.doesNotMatch(noTarget, /\[object Object\]/);
});

check('B17: funded optional plans render as named lines; block omitted when none', () => {
  const withOptional = shell({
    optional: [
      { id: 'opt-trip', label: 'Optional trip top-up', date: '2026-12-01', need: 100, allocated: 100, flexibility: 'optional' },
      { id: 'opt-zero', label: 'Unfunded idea', date: '2026-12-01', need: 50, allocated: 0, flexibility: 'optional' },
    ],
  });
  assert.match(withOptional, /Optional plans/);
  assert.match(withOptional, /Optional trip top-up/);
  assert.match(withOptional, /\$100\.00/);
  assert.doesNotMatch(withOptional, /Unfunded idea/);
  const withoutOptional = shell();
  assert.doesNotMatch(withoutOptional, /Optional plans/);
});

// ---------------------------------------------------------------- Part C ---
// Trust tags (AMANDA SLICE 1 repair): every shell figure carries its
// Forecast-published trust state ('calculated' | 'estimated') so estimated
// state is never flattened into indistinguishable bare currency. The page
// renders only the published state and fails closed when it is absent.

check('C1: paydayAllocation publishes trust — confirmed inputs are calculated, anything weaker is estimated', () => {
  const confirmed = runEngine(basePlan(200));
  for (const key of ['available', 'obligations', 'household', 'extraDebt', 'optional', 'remainder']) {
    assert.equal(confirmed.alloc.paydayShellTrust[key], 'calculated', key);
  }
  const estimatedPlan = basePlan(200);
  estimatedPlan.income[0].confidence = 'estimated';
  const estimated = runEngine(estimatedPlan);
  assert.equal(estimated.alloc.paydayShellTrust.available, 'estimated');
  assert.equal(estimated.alloc.paydayShellTrust.household, 'estimated');
  // Missing confidence is not confirmed: it never promotes an estimate.
  const missingPlan = basePlan(200);
  delete missingPlan.income[0].confidence;
  const missing = runEngine(missingPlan);
  assert.equal(missing.alloc.paydayShellTrust.available, 'estimated');
});

check('C2: the live schedule row publishes its own trust — confirmed row is calculated', () => {
  const { live } = runEngine(mixedPlan());
  assert.ok(live, 'live row exists');
  assert.equal(live.trust, 'calculated');
});

check('C3: the 2027 Dale-payroll projection renders as estimate, not bare currency', () => {
  const plan = {
    defaults: { targetBuffer: 500 },
    opening: { asOf: '2027-01-15' },
    startingCash: { breakdown: [{ id: 'chequing-a', value: 2000 }] },
    income: [{ id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: '2026-08-14', amount: 4000, confidence: 'confirmed' }],
    obligations: [], bills: [], budget: { categories: [] }, commitments: [],
    payrollPlanningAssumptions: { salaryRaiseFactor: 1.04, bonusRate: 0.18, authorizedThroughYear: 2027 },
  };
  const asOf = '2027-01-15';
  const sim = F.simulate(plan, asOf, { horizonDays: 60, viewDays: 60, weeklyVariable: 0 });
  const seq = F.fundingSequence(plan, asOf, {});
  const plans = F.majorPlans(plan, asOf, { weeklyVariable: 0 });
  const alloc = F.paydayAllocation(plan, asOf, {
    weeklyVariable: 0, majorPlans: plans,
    plannedDebt: F.plannedDebt(plan, asOf, { weeklyVariable: 0, majorPlans: plans }),
  });
  // The stream said confirmed, but the 2027 regime amount comes from the
  // authorized projection — Forecast publishes estimated, not confirmed.
  assert.equal(alloc.paydayShellTrust.available, 'estimated');
  const sched = F.planSpendPaydayFunding(plan, asOf, sim, seq, plans, alloc);
  const live = sched.paydays.find(p => p.payday === asOf);
  assert.ok(live, 'live row exists');
  assert.equal(live.trust, 'estimated');
  const advice = {
    buffer: 500,
    paydayAllocation: alloc,
    // Composed exactly the way the plan builder does.
    paydayShellTrust: Object.assign({}, alloc.paydayShellTrust, { buffer: 'calculated' }),
    planSpendPaydayFunding: sched,
    payPeriodViews: [{ id: 'x', start: asOf, end: '2027-01-29', timelineRole: 'current' }],
    defaultView: { asOf },
  };
  const html = f.paydayInstructionShellHtml(advice, { id: 'x', start: asOf });
  assert.match(html, /\$5,849\.40/);
  assert.match(html, /5,849\.40 <span class="trust-tag trust-estimated">estimate<\/span>/);
  assert.doesNotMatch(html, /unavailable/);
});

check('C4: every shell figure on the normal payday renders with its trust tag', () => {
  const html = shell();
  assert.match(html, /\$5,000\.00 <span class="trust-tag">calculated<\/span>/); // available
  assert.match(html, /\$2,000\.00 <span class="trust-tag">calculated<\/span>/); // bills
  assert.match(html, /\$800\.00 <span class="trust-tag">calculated<\/span>/); // household
  assert.match(html, /\$1,200\.00 <span class="trust-tag">calculated<\/span>/); // planned
  assert.match(html, /Keep at least \$500\.00 <span class="trust-tag">calculated<\/span>/); // buffer
  assert.match(html, /\$300\.00 <span class="trust-tag">calculated<\/span>/); // other protected
  assert.match(html, /\$250\.00 <span class="trust-tag">calculated<\/span>/); // extra debt
  assert.match(html, /\$450\.00 <span class="trust-tag">calculated<\/span>/); // remainder
  assert.match(html, /Every figure carries its trust tag/);
});

check('C5: unpublished trust fails closed — figures render unavailable, never bare currency', () => {
  const advice = adviceFixture();
  delete advice.paydayShellTrust;
  const html = f.paydayInstructionShellHtml(advice, currentPeriod);
  assert.match(html, /Money available: unavailable/);
  assert.match(html, /Bills & required minimums: unavailable/);
  assert.match(html, /Current household spending: unavailable/);
  assert.match(html, /Minimum cash floor: unavailable/);
  assert.match(html, /Extra on focus debt: unavailable/);
  assert.match(html, /Truly unassigned: unavailable/);
  // The live row still publishes its own trust, so the row-gated blocks
  // keep rendering — only the packet-gated blocks fail closed here.
  assert.match(html, /\$1,200\.00 <span class="trust-tag">calculated<\/span>/);
  // A live row with no published trust fails the planned blocks closed too.
  const advice2 = adviceFixture();
  delete advice2.planSpendPaydayFunding.paydays[0].trust;
  const html2 = f.paydayInstructionShellHtml(advice2, currentPeriod);
  assert.match(html2, /Nest Money funding plan: unavailable/);
  assert.match(html2, /Other protected cash — keep in chequing: unavailable/);
});

// ---------------------------------------------------------------- Part D ---
// AMANDA SLICE 2 — Nest Money instruction identity proof.
//
// The shell answers "what is this payday's funding plan for future planned
// costs, and what is it for?" These checks prove, on the rendered HTML
// the household actually reads (independent of the engine's own
// namedSum === contribution invariant, L-002):
//   Nest Money instruction = sum of the named Nest Money allocations shown.
// No dollar may appear simultaneously as Nest Money and as other
// protected cash, optional spending, extra debt, or genuinely unassigned
// money. Synthetic fixtures only (L-006).

function nestMoneyBlock(html) {
  const title = '<h3>Nest Money funding plan</h3>';
  const start = html.indexOf(title);
  assert.ok(start !== -1, 'Nest Money block is present');
  const after = html.slice(start);
  const next = after.indexOf('<h3>', title.length);
  return next === -1 ? after : after.slice(0, next);
}
const headlineAmount = blockHtml => {
  const m = blockHtml.match(/instruction-amount">\$([\d,]+\.\d\d)/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};
const namedLineAmounts = blockHtml => {
  const amounts = [];
  const re = /operating-line"><span>[^<]*<\/span><span>\$([\d,]+\.\d\d)/g;
  let m;
  while ((m = re.exec(blockHtml))) amounts.push(Number(m[1].replace(/,/g, '')));
  return amounts;
};

check('D1: Nest Money instruction equals the sum of its named allocations', () => {
  const blockHtml = nestMoneyBlock(shell());
  const lines = namedLineAmounts(blockHtml);
  assert.deepEqual(lines, [700, 500]);
  assert.equal(headlineAmount(blockHtml), lines.reduce((a, b) => a + b, 0));
});

check('D2: $0 Nest Money payday is explicit — earmark shown, not unavailable', () => {
  const html = shell({}, { paydays: [{
    payday: '2026-09-25', contribution: 0, allocations: [],
    nonPlanSpendProtected: 300, gap: null, trust: 'calculated',
  }] });
  const blockHtml = nestMoneyBlock(html);
  assert.equal(headlineAmount(blockHtml), 0);
  assert.deepEqual(namedLineAmounts(blockHtml), []);
  assert.match(blockHtml, /No Nest Money earmark this payday\./);
  assert.doesNotMatch(blockHtml, /unavailable/);
});

check('D3: estimated-paycheck Nest Money instruction is tagged estimate, never verified', () => {
  const html = shell({}, { paydays: [{
    payday: '2026-09-25', contribution: 1200,
    allocations: [{ id: 'a', label: 'Property tax reserve', amount: 1200 }],
    nonPlanSpendProtected: 300, gap: null, trust: 'estimated',
  }] });
  const blockHtml = nestMoneyBlock(html);
  assert.equal(headlineAmount(blockHtml), 1200);
  assert.match(blockHtml, /trust-estimated">estimate</);
  assert.doesNotMatch(blockHtml, />calculated</);
});

check('D4: funding-gap payday keeps the Nest Money identity — instruction still sums to its lines', () => {
  const html = shell({}, {
    status: 'funding-gap',
    paydays: [{
      payday: '2026-09-25', contribution: 1200,
      allocations: [
        { id: 'a', label: 'Property tax reserve', amount: 700 },
        { id: 'b', label: 'Trip fund', amount: 500 },
      ],
      nonPlanSpendProtected: 300, gap: null, trust: 'calculated',
    }],
    gap: { payday: '2026-09-25', shortBy: 200, cashDate: '2026-10-15' },
  });
  const blockHtml = nestMoneyBlock(html);
  const lines = namedLineAmounts(blockHtml);
  // The earmark's named purposes still sum to the headline; the Slice 4
  // gap block adds a separate shortfall figure (not an allocation), so the
  // identity is proved on the named purposes, not on every dollar figure.
  assert.equal(headlineAmount(blockHtml), 1200);
  assert.match(blockHtml, /Property tax reserve.*\$700\.00/s);
  assert.match(blockHtml, /Trip fund.*\$500\.00/s);
  // AMANDA SLICE 4: the Forecast-published gap is exposed with shortfall
  // and date, in the brief's specified copy.
  assert.match(blockHtml, /Funding shortfall ahead/);
  assert.match(blockHtml, /Short by.*\$200\.00/s);
});

check('D5: unknown schedule fails the Nest Money instruction closed — unknown is not $0', () => {
  const blockHtml = nestMoneyBlock(shell({}, null));
  assert.match(blockHtml, /Nest Money funding plan: unavailable/);
  assert.equal(headlineAmount(blockHtml), null);
  assert.doesNotMatch(blockHtml, /\$0\.00/);
});

check('D6: general protected cash, extra debt, optional spending and unassigned money never enter the Nest Money block', () => {
  const html = shell(
    { optional: [{ id: 'lax', label: 'Lacrosse fees', allocated: 100 }] },
    { paydays: [{
      payday: '2026-09-25', contribution: 1200,
      allocations: [
        { id: 'a', label: 'Property tax reserve', amount: 700 },
        { id: 'b', label: 'Trip fund', amount: 500 },
      ],
      nonPlanSpendProtected: 300, gap: null, trust: 'calculated',
    }] });
  const blockHtml = nestMoneyBlock(html);
  assert.doesNotMatch(blockHtml, /\$300\.00/); // other protected cash stays out
  assert.doesNotMatch(blockHtml, /\$250\.00/); // extra debt stays out
  assert.doesNotMatch(blockHtml, /\$100\.00/); // optional spending stays out
  assert.doesNotMatch(blockHtml, /\$450\.00/); // unassigned remainder stays out
  assert.doesNotMatch(blockHtml, /Lacrosse fees/);
  // ...and those dollars still render in their own blocks — nothing dropped.
  assert.match(html, /Other protected cash — keep in chequing/);
  assert.match(html, /Lacrosse fees/);
  assert.match(html, /Truly unassigned/);
});

// ---------------------------------------------------------------- Part E ---
// P1 4117851665 — no Nest Money transfer instruction the engine cannot
// reconcile.
//
// Reproduced through the real engine (/tmp/repro2.js): payday 1
// instructs $200 ($150 property tax + $50 trip); the household moves it
// to the Nest bucket (chequing down, designated savings up); payday 2's
// fresh computation — which has no prior-move input — instructs the
// full $400 again: $600 total for a $400 need. The repair presents the
// figure as an earmark/funding-plan amount only: no transfer or
// set-aside directive, and no subtract-prior-moves requirement on the
// household, until Forecast can consume authoritative prior Nest Money
// state.

check('E1: a positive Nest Money earmark issues no move directive', () => {
  const html = shell();
  assert.doesNotMatch(html, /Move this amount to your Nest Money bucket/);
  assert.doesNotMatch(html, /should be moved to your separate bucket/);
  assert.doesNotMatch(html, /move Nest Money aside/i);
  assert.doesNotMatch(html, /Set aside this amount/i);
});

check('E2: the Nest Money block carries the prior-move-blindness qualifier, without asking the household to subtract', () => {
  const blockHtml = nestMoneyBlock(shell());
  assert.match(blockHtml, /Atlas can't see money you've already moved to your Nest Money bucket/);
  assert.match(blockHtml, /this is a planning amount only — not an instruction to transfer or move money into a separate bucket/);
  // The missing reconciliation must not be shifted to the household:
  // no subtract-prior-moves requirement anywhere in the block.
  assert.doesNotMatch(blockHtml, /subtract anything you already set aside/);
  assert.doesNotMatch(blockHtml, /don't set aside the same dollars twice/);
  assert.doesNotMatch(blockHtml, /subtract/i);
});

check('E3: the $0 earmark and the shell intro carry no move language', () => {
  const zero = shell({}, { paydays: [{
    payday: '2026-09-25', contribution: 0, allocations: [],
    nonPlanSpendProtected: 300, gap: null, trust: 'calculated',
  }] });
  assert.doesNotMatch(zero, /nothing to move aside/);
  assert.doesNotMatch(zero, /Move this amount/);
  assert.doesNotMatch(zero, /nothing to set aside/);
  assert.match(shell(), /the Nest Money funding plan, with the rest staying in chequing/);
  assert.match(shell(), /a planning amount, not an instruction to transfer or move money/);
});

check('E4: the engine publishes no prior Nest Money move state — the qualifier is required', () => {
  const { sched, live } = runEngine(mixedPlan());
  assert.equal(sched.status, 'ready');
  assert.ok(live, 'live row exists');
  assert.ok(cent(live.contribution) > 0, 'fixture has a positive instruction');
  // P1-cited: hardcoded 0, not derived from household moves.
  assert.equal(sched.projectionOpeningProtected, 0);
  // A fresh computation opens with no recognized prior protection.
  assert.equal(live.openingProtected, 0);
  // ...so every positive instruction must carry the qualifier (E2).
});

console.log(`\n${checks} checks passed.`);
