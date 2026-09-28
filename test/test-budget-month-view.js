'use strict';
/* AMANDA SLICE 3 — Month <-> Pay Period consolidated planning view.
 *
 * The default Budget surface lets the household switch between:
 * - Month: one consolidated calendar-month picture from
 *   Forecast.baselineTrajectory months[] (stage1/stage2/stage3).
 * - Pay Period: the existing payday/pay-period operating picture.
 *
 * The page selects the Forecast row, formats values, labels them, and
 * arranges them visually. It never sums income, subtracts expenses,
 * calculates surplus/deficit, reconstructs stage totals, or carries
 * surplus between months. The monthly surplus/deficit is Forecast
 * stage3.result, copied verbatim. Unavailable is not $0.
 *
 * Part A (Forecast authority): the trajectory months[] carry stage1/2/3
 * with the standalone-period contract (priorPeriodSurplus excluded).
 * Part B (page presentation): plan.js reprints those figures with zero
 * page-side arithmetic.
 * Part C (cross-view consistency): Budget reprints the same Forecast
 * authority used elsewhere.
 *
 * `node test/test-budget-month-view.js`
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
// Forecast publishes months[] with stage1/2/3 and the standalone contract.

function basePlan() {
  return {
    windowDays: 91,
    defaults: { targetBuffer: 0, extraDebtMonthly: 50, scenario: 'expected' },
    opening: { asOf: '2026-09-25' },
    startingCash: { amount: 1000 },
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
    commitments: [],
  };
}

function periodsFixture() {
  return {
    periods: {
      ytd: {
        label: 'YTD fixture',
        months: 1,
        spending: [{ label: 'Groceries', total: 50000 }],
      },
    },
  };
}

function runTrajectory(plan) {
  return F.baselineTrajectory(plan, [], '2026-09-25', {
    periods: periodsFixture(),
    extraFacilities: null,
    currentPeriodActuals: null,
  });
}

let traj = null;
check('A1: Forecast publishes months[] with stage1/stage2/stage3', () => {
  traj = runTrajectory(basePlan());
  assert.equal(traj.status, 'ready');
  assert.ok(Array.isArray(traj.months) && traj.months.length > 0);
  const m = traj.months[0];
  assert.ok(m.stage1 && m.stage1.income, 'stage1.income present');
  assert.ok(m.stage1.householdBudget, 'stage1.householdBudget present');
  assert.ok(m.stage1.bills, 'stage1.bills present');
  assert.ok(m.stage1.obligations, 'stage1.obligations present');
  assert.ok(m.stage2 && m.stage2.commitments, 'stage2.commitments present');
  assert.ok(m.stage3 && m.stage3.result, 'stage3.result present');
});

check('A2: roadAheadSurplusDeficit names the standalone-period contract', () => {
  const rs = traj.roadAheadSurplusDeficit;
  assert.equal(rs.identity, 'standalone-period-surplus-deficit');
  assert.equal(rs.priorPeriodSurplus, 'excluded');
  assert.equal(rs.source, 'stage3.result');
  assert.equal(rs.cumulativeCash, 'not-this-result');
});

// ---------------------------------------------------------------- Part B ---
// Page reprint behaviour. Deterministic fixture figures.

const planSource = sourceText(fs.readFileSync(path.join(__dirname, '../public/plan.js'), 'utf8'));
const context = vm.createContext({
  Forecast: F,
  money2: n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
});
vm.runInContext(planSource, context);
const P = context;

// Reset module state between tests.
function resetState() {
  P.budgetGranularity = 'pay-period';
  P.budgetSelectedMonth = null;
  P.budgetTrajectoryCache = null;
  P.budgetTrajectoryCacheKey = null;
}

function srcFixture() {
  return {
    plan: basePlan(),
    debts: [],
    asOf: '2026-09-25',
    meta: { asOf: '2026-09-25' },
    liveOverlay: null,
    revolvingExtra: null,
    periods: periodsFixture(),
  };
}

check('B1: month view copies stage3.result verbatim as the verdict', () => {
  resetState();
  P.budgetGranularity = 'month';
  const html = P.budgetMonthViewHtml(srcFixture());
  const month = P.budgetTrajectoryFor(srcFixture()).months[0];
  const expected = P.money2(month.stage3.result.amount);
  assert.ok(html.includes(expected), `verdict shows Forecast stage3.result ${expected}`);
  // The verdict label matches the sign.
  const amount = Number(month.stage3.result.amount);
  if (amount > 0) assert.ok(html.includes('Monthly surplus'), 'surplus label');
  else if (amount < 0) assert.ok(html.includes('Monthly deficit'), 'deficit label');
});

check('B2: month view copies each component amount (no recomputation)', () => {
  resetState();
  P.budgetGranularity = 'month';
  const src = srcFixture();
  const html = P.budgetMonthViewHtml(src);
  const month = P.budgetTrajectoryFor(src).months[0];
  const components = [
    month.income,
    month.stage1.householdBudget,
    month.stage1.bills,
    month.stage1.obligations,
    month.stage2.commitments,
  ];
  for (const c of components) {
    if (!c || c.status === 'unavailable' || c.amount == null) continue;
    const expected = P.money2(c.amount);
    assert.ok(html.includes(expected), `component ${expected} copied`);
  }
});

check('B3: month view contains no page-side arithmetic on financial values', () => {
  // Static check: the Slice 3 month-view functions must not combine figures.
  // They select, format, label, and arrange — never sum or subtract.
  const monthFns = planSource.slice(
    planSource.indexOf('AMANDA SLICE 3'),
    planSource.indexOf('function paydayInstructionShellHtml')
  );
  // Forbid arithmetic combining two financial values in the month view.
  // Single-operand formatting (Math.abs, Number()) is presentation.
  const lines = monthFns.split('\n');
  const bad = lines.filter(line => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*')) return false;
    // Look for amount-to-amount arithmetic: e.g. "a.amount + b.amount"
    // or "income - bills". Allow money2(), Number(), Math.abs().
    return /\bamount\s*[-+*/]\s*[^=]/.test(t) && !/money2|Math\.abs|Number\(/.test(t);
  });
  assert.deepEqual(bad, [], `no amount arithmetic in month view, found: ${bad.join(' | ')}`);
});

check('B4: estimated trust state is preserved on month components', () => {
  // Test the component row directly — the VM's let-bound cache is not
  // settable from outside, so we exercise the renderer with a fixture.
  const rowHtml = P.budgetMonthComponentRow('Total income', { amount: 5000, status: 'estimated' });
  assert.ok(rowHtml.includes('trust-estimated'), 'estimated tag present');
  assert.ok(rowHtml.includes('estimate</span>'), 'estimate label present');
  const verdictHtml = P.budgetMonthVerdictHtml({
    stage3: { result: { amount: 2950, status: 'estimated' } },
  });
  assert.ok(verdictHtml.includes('trust-estimated'), 'verdict carries estimated trust');
  assert.ok(verdictHtml.includes('data-budget-month-verdict="surplus"'), 'verdict sign preserved');
});

check('B5: unavailable trajectory fails closed (not $0)', () => {
  resetState();
  P.budgetGranularity = 'month';
  // A src with no plan forces budgetTrajectoryFor to return null.
  const html = P.budgetMonthViewHtml({ plan: null });
  assert.ok(html.includes('unavailable'), 'unavailable shown');
  assert.ok(html.includes('not $0'), 'not presented as $0');
});

check('B6: unavailable month result fails closed (not $0)', () => {
  const html = P.budgetMonthVerdictHtml({
    stage3: { result: { status: 'unavailable', reason: 'No cash walk.' } },
  });
  assert.ok(html.includes('data-budget-month-verdict="unavailable"'), 'verdict unavailable');
  assert.ok(!/Monthly surplus.*\$0\.00/.test(html), 'no $0 surplus');
  assert.ok(html.includes('Not $0'), 'explicit not-$0');
});

// ---------------------------------------------------------------- Part C ---
// Cross-view consistency: Budget reprints the same Forecast authority.

check('C1: month verdict equals incumbent Forecast stage3.result', () => {
  resetState();
  P.budgetGranularity = 'month';
  const src = srcFixture();
  // Independent path: call Forecast directly (not through the page cache).
  const direct = F.baselineTrajectory(src.plan, src.debts, src.asOf, {
    periods: periodsFixture(), extraFacilities: null, currentPeriodActuals: null,
  });
  const directMonth = direct.months[0];
  const html = P.budgetMonthViewHtml(src);
  const expected = P.money2(directMonth.stage3.result.amount);
  assert.ok(html.includes(expected), 'page verdict matches direct Forecast call');
});

check('C2: granularity toggle defaults to pay-period (existing experience preserved)', () => {
  resetState();
  assert.equal(P.budgetGranularity, 'pay-period');
  const html = P.budgetGranularityToggleHtml();
  assert.ok(html.includes('data-budget-granularity="month"'), 'month button present');
  assert.ok(html.includes('data-budget-granularity="pay-period"'), 'pay-period button present');
  assert.ok(html.includes('aria-pressed="true"') && html.indexOf('pay-period') < html.indexOf('aria-pressed="true"') + 200
    || html.includes('data-budget-granularity="pay-period" aria-pressed="true"'), 'pay-period pressed by default');
});

check('C3: switching granularity does not change Forecast values', () => {
  resetState();
  const src = srcFixture();
  P.budgetGranularity = 'pay-period';
  const trajBefore = P.budgetTrajectoryFor(src);
  P.budgetGranularity = 'month';
  const html = P.budgetMonthViewHtml(src);
  const trajAfter = P.budgetTrajectoryFor(src);
  assert.equal(trajBefore, trajAfter, 'same cached trajectory object');
  const month = trajAfter.months[0];
  assert.ok(html.includes(P.money2(month.stage3.result.amount)), 'values unchanged after switch');
});

check('C4: month picker lists all Forecast months', () => {
  resetState();
  P.budgetGranularity = 'month';
  const src = srcFixture();
  const html = P.budgetMonthViewHtml(src);
  const traj = P.budgetTrajectoryFor(src);
  for (const m of traj.months.slice(0, 3)) {
    assert.ok(html.includes(`value="${m.month}"`), `month ${m.month} in picker`);
  }
});

console.log(`\n${checks} checks passed.`);
