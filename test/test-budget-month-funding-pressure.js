'use strict';
/* AMANDA SLICE 8 — MONTHLY FUNDING PRESSURE DETAIL.
 *
 * The Budget Month lens names the known planned costs with Forecast cash
 * dates in the selected month, reprinting the incumbent
 * planSpendPaydayFunding publication the payday shell already consumes
 * (Slice 5). Month membership comes only from each cost's
 * Forecast-published cash date — never from a page-side allocation rule,
 * and never as a causal claim. The block describes these as costs
 * cash-dated in the selected month, not as "the costs causing this month's
 * pressure", and states that costs outside the month can also affect the
 * month's funding result.
 *
 * Truth boundaries: every figure is a Forecast reprint; the page selects,
 * arranges, labels, formats and reprints. No ranking, no sorting
 * (Forecast's publication order is kept), no recommendations, no page-side
 * financial arithmetic. Estimated stays estimated. Unavailable is never
 * $0. A future cost with no scheduled contribution is "none scheduled" —
 * never "not required".
 *
 * Proof map (owner brief):
 *   P1  selected month with multiple relevant planned costs
 *   P2  a planned cost funded normally
 *   P3  a real Forecast-published funding gap/shortfall
 *   P4  unscheduled future cost never "not required"
 *   P5  needed-by / cash-date semantics preserved
 *   P6  estimated trust remains estimated
 *   P7  missing/unavailable fails closed, never $0
 *   P8  no ranking or recommendation language
 *   P9  no page-side financial arithmetic/allocation
 *   P10 Month <-> Pay Period toggle intact
 *   P11 Slice 7 ladder and Month verdict unchanged
 *   P12 Slice 4/5 semantics intact (neighboring suites, run separately)
 *   P13 phone-width rendering usable (incumbent classes only)
 *
 * `node test/test-budget-month-funding-pressure.js`
 */
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

let checks = 0;
function check(label, run) { run(); checks++; console.log('  PASS  ' + label); }

// ---------------------------------------------------------------- Part A ---
// The incumbent publication, built by the real engine (independent of the
// page fixtures below). Synthetic plan: two January costs — one fundable,
// one genuinely beyond the walk's reach — plus a July cost outside the
// selected month.

function slice8Plan() {
  return {
    defaults: { targetBuffer: 0, extraDebtMonthly: 0 },
    opening: { asOf: '2026-01-02' },
    startingCash: { breakdown: [{ id: 'chequing-a', value: 500 }] },
    income: [{ id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
      anchor: '2026-01-02', amount: 3000, confidence: 'confirmed' }],
    obligations: [], bills: [], budget: { categories: [] },
    commitments: [
      { id: 'fusion', label: 'Fusion', date: '2026-01-10', amount: 700, confidence: 'confirmed' },
      { id: 'roof', label: 'Roof repair', date: '2026-01-20', amount: 9000, confidence: 'estimated' },
      { id: 'proptax', label: 'Property tax', date: '2026-07-02', amount: 5639.67, confidence: 'estimated' },
    ],
  };
}

function slice8Schedule() {
  const plan = slice8Plan();
  const asOf = plan.opening.asOf;
  const sim = F.simulate(plan, asOf, { horizonDays: 200, viewDays: 200, weeklyVariable: 0 });
  const seq = F.fundingSequence(plan, asOf);
  return F.planSpendPaydayFunding(plan, asOf, sim, seq,
    F.majorPlans(plan, asOf, { weeklyVariable: 0 }));
}

check('P3a: the engine publishes a genuine funding-gap cost (independent of the page)', () => {
  const schedule = slice8Schedule();
  assert.ok(schedule && schedule.status === 'funding-gap', 'schedule carries a real funding gap');
  const roof = schedule.costs.find(c => c.id === 'roof');
  assert.ok(roof, 'roof cost published');
  assert.equal(roof.verdict, 'FUNDING GAP', 'Forecast verdict is FUNDING GAP, not a page inference');
  assert.equal(roof.date, '2026-01-20', 'cash date published');
  assert.equal(roof.baseRequirement, 9000, 'amount published in dollars');
  assert.equal(roof.confidence, 'estimated', 'estimated confidence published, not promoted');
});

check('P2a: the engine publishes a normally-funded cost beside it', () => {
  const schedule = slice8Schedule();
  const fusion = schedule.costs.find(c => c.id === 'fusion');
  assert.ok(fusion, 'fusion cost published');
  assert.equal(fusion.verdict, 'ON TRACK', 'Forecast verdict is ON TRACK');
  assert.equal(fusion.baseRequirement, 700, 'amount published');
  assert.equal(fusion.confidence, 'confirmed', 'confirmed confidence published');
  assert.deepEqual(fusion.nextContribution, { payday: '2026-01-02', amount: 700 },
    'next scheduled contribution published');
  assert.equal(fusion.projectedFullyFunded, '2026-01-02', 'projected fully-funded date published');
});

check('P1a: the publication carries the cash dates the month filter reads', () => {
  const schedule = slice8Schedule();
  const byId = new Map(schedule.costs.map(c => [c.id, c.date]));
  assert.equal(byId.get('fusion'), '2026-01-10', 'fusion cash-dated in January');
  assert.equal(byId.get('roof'), '2026-01-20', 'roof cash-dated in January');
  assert.equal(byId.get('proptax'), '2026-07-02', 'property tax cash-dated in July');
});

// ---------------------------------------------------------------- Part B ---
// Page reprint behaviour. Deterministic synthetic fixtures shaped exactly
// like the engine publication Part A verified.

const planSource = sourceText(fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8'));
const context = vm.createContext({
  Forecast: F,
  money2: n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA',
    { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  // app.js household date formatter, stubbed identically for the VM.
  fmtDateLong: iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA',
    { day: 'numeric', month: 'long' }),
});
vm.runInContext(planSource, context);
const P = context;

function costFixture(overrides = {}) {
  return Object.assign({
    id: 'fusion', label: 'Fusion', date: '2026-01-10', confidence: 'confirmed',
    baseRequirement: 700, verdict: 'ON TRACK',
    nextContribution: { payday: '2026-01-02', amount: 700 },
    projectedFullyFunded: '2026-01-02',
  }, overrides);
}

function scheduleFixture(overrides = {}) {
  return Object.assign({
    status: 'ready',
    source: 'Forecast.planSpendPaydayFunding',
    costs: [
      costFixture(),
      costFixture({ id: 'roof', label: 'Roof repair', date: '2026-01-20',
        confidence: 'estimated', baseRequirement: 9000, verdict: 'FUNDING GAP',
        nextContribution: { payday: '2026-01-02', amount: 2800 },
        projectedFullyFunded: null }),
      costFixture({ id: 'proptax', label: 'Property tax', date: '2026-07-02',
        confidence: 'estimated', baseRequirement: 5639.67, verdict: 'ON TRACK',
        nextContribution: null, projectedFullyFunded: null }),
    ],
  }, overrides);
}

const pressureHtml = (scheduleOverrides, monthKey = '2026-01') =>
  P.budgetMonthFundingPressureHtml(
    { advice: { planSpendPaydayFunding: scheduleOverrides === null ? null : scheduleFixture(scheduleOverrides) } },
    { month: monthKey });

// The block under test, scoped so later-block assertions cannot leak.
function pressureSection(html) {
  const start = html.indexOf('Planned costs in view');
  assert.ok(start !== -1, 'Planned costs in view block rendered');
  return html.slice(start);
}

check('P1: selected month names each relevant planned cost with amount and needed-by', () => {
  const section = pressureSection(pressureHtml());
  assert.match(section, /Fusion/, 'first cost named');
  assert.match(section, /Roof repair/, 'second cost named');
  assert.match(section, /\$700\.00/, 'first amount reprinted exactly');
  assert.match(section, /\$9,000\.00/, 'second amount reprinted exactly');
  assert.match(section, /Needed by January 10/, 'first cash date reprinted');
  assert.match(section, /Needed by January 20/, 'second cash date reprinted');
});

check('P2: normally-funded cost reads On track with its published path', () => {
  const section = pressureSection(pressureHtml());
  const fusion = section.slice(section.indexOf('data-budget-month-cost="fusion"'),
    section.indexOf('data-budget-month-cost="roof"'));
  assert.match(fusion, /Funding state.*On track/s, 'funding state reprints the ON TRACK verdict');
  assert.match(fusion, /Next scheduled contribution.*\$700\.00.*on.*January 2/s,
    'next contribution reprinted');
  assert.match(fusion, /Forecast projects fully funded by.*January 2/s, 'funded-by reprinted');
});

check('P3: funding-gap cost reads Funding gap — the published shortfall state', () => {
  const section = pressureSection(pressureHtml());
  const roof = section.slice(section.indexOf('data-budget-month-cost="roof"'));
  assert.match(roof, /Funding state.*Funding gap/s, 'funding state reprints the FUNDING GAP verdict');
  assert.doesNotMatch(roof, /On track/, 'a gapped cost never reads On track');
});

check('P4: unscheduled future cost is "none scheduled" — never "not required"', () => {
  const html = pressureHtml({}, '2026-07');
  const section = pressureSection(html);
  assert.match(section, /Property tax/, 'July cost in view for July');
  assert.match(section, /Next scheduled contribution.*none scheduled/s, 'honest unscheduled wording');
  assert.match(section, /Projected funded by.*not published/s, 'unpublished funded-by stays unpublished');
  assert.doesNotMatch(section, /not required|nothing required/i, 'no false "not required" wording');
  assert.doesNotMatch(section, /\$0\.00/, 'no invented $0');
});

check('P5: cash-date semantics — membership is the published cash date only', () => {
  // A cost cash-dated on the last day of the month is in view; the first
  // day of the next month is not. No date arithmetic on the page.
  const html = pressureHtml({
    costs: [
      costFixture({ id: 'a', label: 'End of Jan', date: '2026-01-31' }),
      costFixture({ id: 'b', label: 'Start of Feb', date: '2026-02-01' }),
    ],
  });
  const section = pressureSection(html);
  assert.match(section, /End of Jan/, 'Jan 31 cost in view for January');
  assert.doesNotMatch(section, /Start of Feb/, 'Feb 1 cost not in view for January');
});

check('P6: estimated trust remains estimated — never promoted', () => {
  const section = pressureSection(pressureHtml());
  const roof = section.slice(section.indexOf('data-budget-month-cost="roof"'));
  assert.match(roof, /<span class="trust-tag trust-estimated">estimate<\/span>/,
    'estimated cost keeps the estimate tag');
  assert.doesNotMatch(roof, />calculated</, 'no promotion to calculated');
  const fusion = section.slice(section.indexOf('data-budget-month-cost="fusion"'),
    section.indexOf('data-budget-month-cost="roof"'));
  assert.match(fusion, /<span class="trust-tag">confirmed<\/span>/, 'confirmed cost keeps its own tag');
});

check('P7a: unavailable publication fails closed — never $0', () => {
  const html = pressureHtml(null);
  assert.match(html, /Planned costs in view/, 'block still rendered');
  assert.match(html, /unavailable — Forecast did not publish the planned-spending schedule/,
    'neutral unavailable wording');
  assert.doesNotMatch(html, /\$0\.00/, 'unknown never rendered as $0');
});

check('P7b: a month with no cash-dated costs is neutral — not "nothing required"', () => {
  const html = pressureHtml({}, '2026-03');
  const section = pressureSection(html);
  assert.match(section, /Forecast published no planned costs with cash dates in March 2026/,
    'neutral empty-month wording');
  assert.doesNotMatch(section, /nothing required|not required/i, 'no false terminal wording');
  assert.doesNotMatch(section, /\$0\.00/, 'no invented $0');
});

check('P7c: unpublished per-cost trust fails the figures closed — never $0, never untagged', () => {
  const html = pressureHtml({
    costs: [costFixture({ id: 'mystery', label: 'Mystery cost', date: '2026-01-15', confidence: null })],
  });
  const section = pressureSection(html);
  assert.match(section, /Mystery cost/, 'cost still named');
  assert.match(section, /Needed by January 15/, 'cash date still reprinted');
  assert.match(section, /unavailable — trust not published/, 'figures fail closed on unpublished trust');
  assert.doesNotMatch(section, /\$700\.00/, 'untrusted amount never shown');
  assert.doesNotMatch(section, /\$0\.00/, 'unknown never rendered as $0');
});

check('P8: no ranking or recommendation language anywhere in the block', () => {
  const html = pressureHtml();
  assert.doesNotMatch(html, /caus/i, 'no causal claims');
  assert.doesNotMatch(html, /you can.?t afford|can.?t afford/i, 'no affordability claims');
  assert.doesNotMatch(html, /\bcut\b|\bskip\b/i, 'no cut/skip recommendations');
  assert.doesNotMatch(html, /fund this first|priorit/i, 'no priority recommendations');
  assert.doesNotMatch(html, /recommend/i, 'no recommendations');
  assert.doesNotMatch(html, /should (fund|pay|cut|skip|delay|move)/i, 'no should-directives');
});

check('P8b: the block never claims these are "the" pressure or the cause', () => {
  // Dale's Systems Review scrutiny: the month filter must not imply costs
  // outside the month are irrelevant, and the list must not read as the
  // cause of the month's result.
  const html = pressureHtml();
  assert.doesNotMatch(html, /causing this month|caused|pressure on/i,
    'no "causing the pressure" framing');
  assert.match(html, /costs outside this month can also affect the month's funding result/,
    'the scope disclaimer is present');
  assert.match(html, /Only costs cash-dated in January 2026 are listed/,
    'membership is described as cash-dated-in-month');
});

check('P9: page keeps Forecast publication order — no page-side sort', () => {
  // Deliberately non-chronological publication order; the page must not fix it.
  const html = pressureHtml({
    costs: [
      costFixture({ id: 'roof', label: 'Roof repair', date: '2026-01-20',
        confidence: 'estimated', baseRequirement: 9000, verdict: 'FUNDING GAP',
        nextContribution: { payday: '2026-01-02', amount: 2800 }, projectedFullyFunded: null }),
      costFixture(),
    ],
  });
  const section = pressureSection(html);
  assert.ok(section.indexOf('Roof repair') < section.indexOf('Fusion'),
    'publication order preserved, not date-sorted page-side');
});

check('P12: amounts are reprinted exactly — no page-side financial arithmetic', () => {
  const schedule = scheduleFixture();
  const html = pressureHtml();
  for (const cost of schedule.costs.filter(c => c.date.slice(0, 7) === '2026-01')) {
    const expected = '$' + Number(cost.baseRequirement).toLocaleString('en-CA',
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    assert.ok(html.includes(expected), `${cost.id}: $${cost.baseRequirement} reprinted exactly`);
  }
  // The two January amounts are shown as published; no combined total exists.
  assert.doesNotMatch(html, /\$9,700\.00/, 'no summed total invented');
});

// ---------------------------------------------------------------- Part D ---
// Full-view integration: the new block sits beneath the Slice 7 ladder and
// the Month verdict inside the real month view; the toggle is intact.

function evalInPage(js) { return vm.runInContext(js, context); }

check('P10/P11: full month view — toggle, ladder, verdict, and the new block together', () => {
  const plan = {
    windowDays: 91,
    defaults: { targetBuffer: 0, extraDebtMonthly: 50, scenario: 'expected' },
    opening: { asOf: '2026-09-25' },
    startingCash: { amount: 10000 },
    income: [
      { id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
        anchor: '2026-09-11', amount: 2500, confidence: 'confirmed' },
    ],
    obligations: [],
    bills: [
      { id: 'rent', label: 'Rent', frequency: 'monthly', day: 1,
        amount: 1200, confidence: 'confirmed' },
    ],
    budget: {
      basis: 'ytd',
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedWeekly: 140 },
      ],
    },
    commitments: [
      { id: 'roof', label: 'Roof repair', date: '2026-10-05', amount: 2000, confidence: 'confirmed' },
    ],
  };
  const asOf = plan.opening.asOf;
  const sim = F.simulate(plan, asOf, { horizonDays: 200, viewDays: 200, weeklyVariable: 0 });
  const seq = F.fundingSequence(plan, asOf);
  const schedule = F.planSpendPaydayFunding(plan, asOf, sim, seq,
    F.majorPlans(plan, asOf, { weeklyVariable: 0 }));
  const src = {
    plan, debts: [], asOf, meta: { asOf },
    liveOverlay: null, revolvingExtra: null,
    periods: { periods: { ytd: { label: 'YTD fixture', months: 1, spending: [{ label: 'Groceries', total: 50000 }] } } },
    advice: { planSpendPaydayFunding: schedule },
  };
  evalInPage(`budgetGranularity = 'month';`);
  evalInPage(`budgetSelectedMonth = '2026-10';`);
  evalInPage('budgetTrajectoryCache = null; budgetTrajectoryCacheKey = null;');
  try {
    const html = P.budgetMonthViewHtml(src);
    assert.ok(html.includes('data-budget-month-view="2026-10"'), 'month view rendered');
    assert.ok(html.includes('How October 2026 holds together'), 'Slice 7 ladder unchanged');
    assert.ok(/Monthly (surplus|deficit|balance)/.test(html), 'Month verdict unchanged');
    assert.ok(html.includes('Planned costs in view'), 'new detail block rendered in the full view');
    assert.ok(html.includes('Roof repair'), 'real October cost named from the real publication');
    assert.ok(html.includes('data-budget-month-funding-pressure="2026-10"'), 'block scoped to the month');
    const toggle = P.budgetGranularityToggleHtml();
    assert.ok(toggle.includes('Month') && toggle.includes('Pay Period'), 'Month <-> Pay Period toggle intact');
  } finally {
    evalInPage(`budgetGranularity = 'pay-period';`);
    evalInPage('budgetSelectedMonth = null;');
    evalInPage('budgetTrajectoryCache = null; budgetTrajectoryCacheKey = null;');
  }
});

// ---------------------------------------------------------------- Part C ---
// Source guards: the page must not allocate, rank, sort, or compute.

const slice8Region = (() => {
  const start = planSource.indexOf('AMANDA SLICE 8');
  assert.ok(start !== -1, 'slice 8 block present in plan.js');
  const end = planSource.indexOf('function budgetMonthViewHtml', start);
  assert.ok(end !== -1 && end > start, 'slice 8 region bounded');
  return planSource.slice(start, end);
})();

check('P9a: no page-side ordering of costs in the slice 8 region', () => {
  assert.doesNotMatch(slice8Region, /\.sort\(/, 'no sort() — Forecast order kept');
});

check('P9b: no Math.* financial computation in the slice 8 region', () => {
  assert.doesNotMatch(slice8Region, /Math\./, 'no Math.* — the page reprints, Forecast computes');
});

check('P9c: no page-side amount arithmetic in the slice 8 region', () => {
  // Single-operand presentation (money2, Number, String.slice on the date)
  // is formatting, not arithmetic. Combining two financial values is not.
  const lines = slice8Region.split('\n');
  const bad = lines.filter(line => {
    const t = line.trim();
    if (!t || t.startsWith('//') || t.startsWith('*')) return false;
    return /\b(amount|baseRequirement|nextAmount)\s*[-+*/]\s*[^=]/.test(t)
      && !/money2|Number\(/.test(t);
  });
  assert.deepEqual(bad, [], 'no amount is combined with another: ' + bad.join(' | '));
});

check('P9d: no priority/rank/score constructs in the slice 8 region', () => {
  assert.doesNotMatch(slice8Region, /\.(priority|rank|score)\b/i, 'no .priority/.rank/.score reads');
});

check('P13: phone-width rendering reuses incumbent classes only', () => {
  // The block reuses the operating-line(s) structure the existing
  // phone-width CSS already handles — no new classes, no inline styles.
  const classes = new Set([...slice8Region.matchAll(/class="([^"]+)"/g)]
    .flatMap(m => m[1].split(/\s+/)));
  const allowed = new Set(['operating-lead', 'operating-note', 'operating-lines',
    'operating-line', 'trust-tag', 'trust-estimated', 'budget-month-funding-pressure']);
  for (const cls of classes) {
    assert.ok(allowed.has(cls), `class "${cls}" is incumbent or the block wrapper`);
  }
  assert.doesNotMatch(slice8Region, /style="/, 'no inline styles');
});

console.log(`\n${checks} checks passed.`);
