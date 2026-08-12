'use strict';
/* Focused proof for the weekly↔monthly conversion and the discretionary-room
 * verdict. `node test-weekly-cap.js`
 *
 * The household reads a WEEKLY figure; the budget is derived in MONTHS. One
 * conversion sits between them, and it decides a published verdict —
 * "Discretionary room — nothing left. The cap is below what normal life
 * costs." Until this move `public/plan.js` owned all of it, and so did
 * `scripts/figures-snapshot.js`: three copies of one constant, none of them
 * compared with the others. The page's could be changed from 4.35 to 4.00 —
 * moving every budget-derived /wk figure it publishes by about 8% — and
 * `npm test` stayed green.
 *
 * Four kinds of check:
 *
 *   1. THE CALENDAR IDENTITY, re-derived here rather than imported. `Forecast`
 *      deliberately does not export the constant: a test that imported it
 *      would prove the engine agrees with itself. This file computes
 *      365.25 / 12 / 7 from the definition of a Gregorian year and requires
 *      the engine to match, so the two can genuinely disagree.
 *   2. HAND-COMPUTED CASES on literal fixtures, with every expected figure
 *      reasoned in the comment above it.
 *   3. THE BOUNDARY, both sides — a cap above, exactly at, and below the
 *      essential need.
 *   4. MUTATION — the constant, the verdict, the room and the shortfall each
 *      broken in the engine source, and the answer required to change.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const data = require('./data.json');
const periods = require('./public/periods.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const cents = n => Math.round(n * 100);

/* --------------------------------------------------- the calendar identity */
/* Derived from what a year and a week ARE, not copied from the engine:
 * 365.25 days in a Gregorian year (three common years and one leap in four),
 * twelve months in a year, seven days in a week. */
const DAYS_IN_YEAR = 365 + 1 / 4;
const WEEKS = DAYS_IN_YEAR / 12 / 7;

console.log('=== 1. the conversion is the calendar\'s, and the engine has no other ===');
ok(near(WEEKS, 4.348214285714286),
  'the identity computes 4.3482142857… weeks a month', String(WEEKS));
ok(near(F.monthlyFromWeekly(1), WEEKS),
  'a $1/week cap is $4.3482…/month — the engine agrees with the calendar',
  String(F.monthlyFromWeekly(1)));
ok(near(F.monthlyFromWeekly(1250), 1250 * WEEKS) && near(F.monthlyFromWeekly(0), 0),
  'and it scales linearly, through zero');
ok(F.WEEKS_PER_MONTH === undefined,
  'the constant is NOT exported — a test importing it would prove nothing');
{
  // Three months of weeks is a quarter of a year, to the day. An independent
  // route to the same number.
  ok(near(WEEKS * 12 * 7, 365.25), 'twelve months of weeks is one Gregorian year');
  ok(near(F.monthlyFromWeekly(7) * 12, 365.25),
    'and $7/week — a dollar a day — is $365.25 a year through the engine',
    String(F.monthlyFromWeekly(7) * 12));
}

/* ------------------------------------------------------------- fixtures */
/* A minimal plan and history, so every monthly figure below is a literal.
 * Two essential categories and one discretionary, no dated items, no sinking
 * funds — the arithmetic is meant to be checkable by hand. */
const FIXTURE_PLAN = {
  windowDays: 91,
  budget: {
    basis: 'ytd',
    categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedMonthly: 1200 },
      { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedMonthly: 800 },
      { id: 'dining', label: 'Dining', class: 'discretionary', from: ['Dining'], plannedMonthly: 400 },
    ],
  },
};
const FIXTURE_PERIODS = {
  periods: {
    ytd: {
      label: 'Year to date', months: 10,
      spending: [
        { label: 'Groceries', total: 11000 },   // $1,100/month historical
        { label: 'Fuel', total: 6000 },         //   $600/month historical
        { label: 'Dining', total: 5000 },       //   $500/month historical
      ],
    },
  },
};
const budgetAt = (weeklyCap, extra) => F.budgetBreakdown(FIXTURE_PLAN, FIXTURE_PERIODS,
  Object.assign({ weeklyCap }, extra || {}));

console.log('\n=== 2. hand-computed: a cap well above the essential need ===');
/* The owner targets beat the historical averages, so planned is $1,200 + $800
 * = $2,000/month essential and $400/month discretionary. Nothing is dated, so
 * nothing is netted off.
 *
 * At $600/week the cap is 600 × 4.3482142857… = $2,608.928571…/month.
 *
 *   essential monthly  2000
 *   essential weekly   2000 / 4.3482142857… = 459.95893223819…
 *   room monthly       2608.928571… − 2000  = 608.928571…
 *   room weekly        608.928571… / 4.3482142857… = 140.0411…
 *   food+fuel planned  2000/month, 459.9589…/week (all of the essentials here)
 *   food+fuel historic 1100 + 600 = 1700/month, 390.9651…/week
 *   household discretionary  400/month → 91.9918…/week
 *   room vs household  budget 91.9918… vs room 140.0411… → EXCEEDS by 48.0493…
 *   inCap              2000 + 400 = 2400;  overCap = 0 (cap is larger)
 */
{
  const b = budgetAt(600);
  const c = b.cap;
  ok(b.requiredMonthly === 2000 && b.discretionaryMonthly === 400,
    'the fixture derives $2,000 essential and $400 discretionary a month',
    `${b.requiredMonthly} / ${b.discretionaryMonthly}`);
  ok(near(c.monthly, 600 * WEEKS), 'the monthly cap is the weekly cap × weeks-per-month',
    String(c.monthly));
  ok(near(c.monthly, 2608.9285714285716), 'which is $2,608.9285…', String(c.monthly));
  ok(near(c.essentialWeekly, 2000 / WEEKS) && near(c.essentialWeekly, 459.95893223819303),
    'the weekly essential need is requiredMonthly ÷ weeks-per-month',
    String(c.essentialWeekly));
  ok(c.hasDiscretionaryRoom === true, 'a cap above the need leaves room');
  ok(near(c.discretionaryRoomMonthly, 608.9285714285716)
    && near(c.discretionaryRoomWeekly, 608.9285714285716 / WEEKS),
  'the room is the positive remainder after the essentials',
  `${c.discretionaryRoomMonthly} / ${c.discretionaryRoomWeekly}`);
  ok(c.essentialShortfallMonthly === 0 && c.essentialShortfallWeekly === 0,
    'and there is no shortfall');
  ok(near(c.foodFuelPlannedMonthly, 2000) && near(c.foodFuelPlannedWeekly, 2000 / WEEKS),
    'planned food and fuel reconcile with their monthly inputs',
    String(c.foodFuelPlannedWeekly));
  ok(near(c.foodFuelHistoricalMonthly, 1700) && near(c.foodFuelHistoricalWeekly, 1700 / WEEKS),
    'and so do the historical ones — $11,000 + $6,000 over ten months',
    String(c.foodFuelHistoricalWeekly));
  ok(near(c.groceriesPlannedWeekly, 1200 / WEEKS) && near(c.fuelPlannedWeekly, 800 / WEEKS),
    'each of groceries and fuel converts on its own');
  ok(near(c.groceriesPlannedWeekly + c.fuelPlannedWeekly, c.foodFuelPlannedWeekly),
    'and the two add to the pair');
  ok(near(c.householdDiscretionaryWeekly, 400 / WEEKS),
    'the household\'s own discretionary budget is converted the same way',
    String(c.householdDiscretionaryWeekly));
  ok(c.roomVersusHousehold.verdict === 'exceeds',
    'and here the room EXCEEDS that budget, which is named rather than signed',
    c.roomVersusHousehold.verdict);
  // 400/W = 91.9917864… budgeted; 600 − 2000/W = 140.0410677… left. The gap is
  // 48.0492813…, and it is reported as that rather than as −48.0492813….
  ok(near(c.roomVersusHousehold.weekly, Math.abs(400 / WEEKS - (600 - 2000 / WEEKS)))
    && near(c.roomVersusHousehold.weekly, 48.04928131416837)
    && c.roomVersusHousehold.weekly > 0,
  'by $48.0492813…/wk — a magnitude, never a negative number',
  String(c.roomVersusHousehold.weekly));
  ok(near(c.inCapMonthly, 2400) && c.overCapMonthly === 0,
    'the categories total $2,400 against a larger cap, so nothing has to come off',
    `${c.inCapMonthly} / ${c.overCapMonthly}`);
}

console.log('\n=== 3. hand-computed: a cap BELOW the essential need ===');
/* At $400/week the cap is 400 × 4.3482142857… = $1,739.2857…/month against a
 * $2,000 essential need.
 *
 *   shortfall monthly  2000 − 1739.285714… = 260.714285…
 *   shortfall weekly   260.714285… / 4.3482142857… = 59.95893223819…
 *                      = 459.95893… − 400, the essential week minus the cap week
 *   room               none, and reported as exactly zero rather than negative
 *   overCap            2400 − 1739.285714… = 660.714285…
 */
{
  const c = budgetAt(400).cap;
  ok(c.hasDiscretionaryRoom === false, 'a cap below the need leaves no room');
  ok(c.discretionaryRoomMonthly === 0 && c.discretionaryRoomWeekly === 0,
    'the room is exactly zero, never negative',
    `${c.discretionaryRoomMonthly} / ${c.discretionaryRoomWeekly}`);
  ok(near(c.essentialShortfallMonthly, 260.71428571428567),
    'the monthly shortfall is the exact remainder', String(c.essentialShortfallMonthly));
  ok(near(c.essentialShortfallWeekly, 260.71428571428567 / WEEKS)
    && near(c.essentialShortfallWeekly, 59.95893223819301),
  'and the weekly shortfall converts with the same identity',
  String(c.essentialShortfallWeekly));
  ok(near(c.essentialShortfallWeekly, c.essentialWeekly - 400),
    'which reconciles independently: essential/week − cap/week',
    `${c.essentialWeekly} − 400 = ${c.essentialWeekly - 400}`);
  ok(near(c.overCapMonthly, 660.7142857142853),
    'and the categories overrun the cap by the full difference', String(c.overCapMonthly));
}

console.log('\n=== 4. the boundary, from both sides and exactly on it ===');
/* The essential need is $2,000/month. The weekly cap that lands exactly there
 * is 2000 / 4.3482142857… = $459.94200105…/week. The page compared two
 * unrounded monthly sums with a bare `>`, so a cap a hundredth of a cent under
 * published "nothing left — the cap is below what normal life costs" beside a
 * shortfall that rounds to $0/week. The engine's epsilon is half a cent, finer
 * than any of these figures is published to. */
{
  const exact = 2000 / WEEKS;
  const on = budgetAt(exact).cap;
  ok(near(on.monthly, 2000, 1e-9), 'the boundary cap really is $2,000/month', String(on.monthly));
  ok(on.hasDiscretionaryRoom === true,
    'a cap EXACTLY at the essential need leaves room — of zero, not "nothing left"');
  ok(cents(on.discretionaryRoomWeekly) === 0 && cents(on.essentialShortfallWeekly) === 0,
    'with both room and shortfall at $0.00');

  const hair = budgetAt(exact - 0.0000001).cap;
  ok(hair.hasDiscretionaryRoom === true,
    'a cap a ten-millionth of a dollar under is still at the need, not below it');
  ok(cents(hair.essentialShortfallWeekly) === 0,
    'and its shortfall is $0.00 — which is why calling it a shortfall was wrong');

  // A real cent under is a real shortfall. The epsilon must not swallow money
  // the household can actually see.
  const realCent = budgetAt((2000 - 0.02) / WEEKS).cap;
  ok(realCent.hasDiscretionaryRoom === false,
    'two cents a month under the need IS below it', String(realCent.essentialShortfallMonthly));
  ok(cents(realCent.essentialShortfallMonthly) === 2,
    'and the shortfall is the two cents', String(realCent.essentialShortfallMonthly));

  const above = budgetAt(exact + 1).cap;
  ok(above.hasDiscretionaryRoom === true && above.discretionaryRoomWeekly > 0,
    'a dollar a week above the need leaves a dollar a week of room',
    String(above.discretionaryRoomWeekly));
  ok(near(above.discretionaryRoomWeekly, 1, 1e-9),
    'exactly a dollar', String(above.discretionaryRoomWeekly));
}

console.log('\n=== 5. the cap measured is the cap being SHOWN ===');
/* The household can set its own weekly figure. The budget must be measured
 * against what the page displays — comparing the essentials with a
 * recommendation nobody is looking at describes a different plan. The
 * recommended figure stays available beside it, because the page still says
 * "your setting — the forecast supports $X/wk". */
{
  const override = budgetAt(900, { recommendedWeekly: 600 }).cap;
  ok(override.weekly === 900, 'the active cap is the override', String(override.weekly));
  ok(near(override.monthly, 900 * WEEKS),
    'and the monthly figure follows the override, not the recommendation',
    String(override.monthly));
  ok(override.recommendedWeekly === 600,
    'the recommendation remains independently available', String(override.recommendedWeekly));
  ok(override.isOverride === true, 'and the result says the two differ');

  const same = budgetAt(600, { recommendedWeekly: 600 }).cap;
  ok(same.isOverride === false, 'with no override set, nothing is flagged as one');

  const silent = budgetAt(900).cap;
  ok(silent.recommendedWeekly === null && silent.isOverride === false,
    'a caller that names no recommendation gets null rather than a guess');

  // The decisive case: an override BELOW the need while the recommendation is
  // above it. Measuring the recommendation would publish room that the figure
  // on screen does not leave.
  const low = budgetAt(400, { recommendedWeekly: 600 }).cap;
  ok(low.hasDiscretionaryRoom === false,
    'an override below the need reports no room, though the recommendation would have left some');
  ok(budgetAt(600, { recommendedWeekly: 600 }).cap.hasDiscretionaryRoom === true,
    'and the recommendation on its own does leave room — so the two genuinely differ');
}

console.log('\n=== 6. no cap named, no verdict invented ===');
{
  const b = F.budgetBreakdown(FIXTURE_PLAN, FIXTURE_PERIODS, {});
  ok(b.cap === null, 'a caller that names no cap gets null, not a cap of zero');
  ok(b.requiredMonthly === 2000, 'while the monthly budget is unaffected');
  ok(F.budgetBreakdown(FIXTURE_PLAN, null, { weeklyCap: 600 }) === null,
    'and no spending history still returns null overall');
}

console.log('\n=== 7. the published plan reconciles ===');
/* The real numbers, checked against the identity rather than against the
 * engine's own arithmetic. */
{
  const plan = data.plan, asOf = data.meta.asOf;
  const adv = F.recommend(plan, asOf, {
    scenario: plan.defaults.scenario, targetBuffer: plan.defaults.targetBuffer,
    extraDebtMonthly: 0, incomeOverrides: {}, disabled: [], debts: data.debts,
    extraDebtTarget: plan.nextDollar.target, fundingSources: plan.funding.options,
  });
  const b = F.budgetBreakdown(plan, periods, {
    paypalPerMonth: data.paypal.perMonth, disabled: [],
    weeklyCap: adv.weekly, recommendedWeekly: adv.weekly,
  });
  const c = b.cap;
  ok(near(c.monthly, adv.weekly * WEEKS),
    `the published $${adv.weekly}/week cap is $${c.monthly.toFixed(2)}/month`);
  ok(near(c.essentialWeekly, b.requiredMonthly / WEEKS),
    'the published weekly essential need divides the monthly one',
    `${b.requiredMonthly.toFixed(2)} → ${c.essentialWeekly.toFixed(2)}`);
  ok(near(c.essentialWeekly + c.discretionaryRoomWeekly, adv.weekly, 1e-9),
    'essential need + discretionary room = the whole weekly cap',
    `${c.essentialWeekly.toFixed(2)} + ${c.discretionaryRoomWeekly.toFixed(2)} = ${adv.weekly}`);
  ok(near(c.essentialMonthly + c.discretionaryRoomMonthly, c.monthly, 1e-9),
    'and the same identity holds in months');
  ok(near(c.inCapMonthly, b.requiredMonthly + b.discretionaryMonthly),
    'the in-cap total is the essential need plus the household discretionary budget');
  ok(near(c.overCapMonthly, c.inCapMonthly - c.monthly, 1e-9) && c.overCapMonthly > 0,
    'and the overrun is the difference, which is real on the published plan',
    `$${c.overCapMonthly.toFixed(2)}/month`);
}

console.log('\n=== 8. mutation: breaking the engine breaks the answer ===');
const FORECAST_SRC = read('public/forecast.js');
function mutant(from, to) {
  const occurrences = FORECAST_SRC.split(from).length - 1;
  if (occurrences !== 1) return { error: `target appears ${occurrences} time(s)` };
  const sandbox = { module: { exports: {} } };
  try {
    vm.runInNewContext(FORECAST_SRC.replace(from, to), sandbox, { filename: 'forecast-mutant.js' });
  } catch (e) { return { error: e.message }; }
  return { engine: sandbox.module.exports };
}
const mBudget = (m, weeklyCap, extra) => m.budgetBreakdown(FIXTURE_PLAN, FIXTURE_PERIODS,
  Object.assign({ weeklyCap }, extra || {})).cap;

const MUTATIONS = [
  { label: 'the 4.35 → 4.00 mutation the page hid is now visible',
    from: '  const WEEKS_PER_MONTH = 365.25 / 12 / 7;',
    to: '  const WEEKS_PER_MONTH = 4.00;',
    check: m => !near(mBudget(m, 600).essentialWeekly, 2000 / WEEKS, 0.01),
    real: () => near(budgetAt(600).cap.essentialWeekly, 2000 / WEEKS) },

  { label: 'dropping the leap-quarter day moves every weekly figure',
    from: '  const WEEKS_PER_MONTH = 365.25 / 12 / 7;',
    to: '  const WEEKS_PER_MONTH = 365 / 12 / 7;',
    check: m => !near(mBudget(m, 600).monthly, 600 * WEEKS, 1e-9),
    real: () => near(budgetAt(600).cap.monthly, 600 * WEEKS, 1e-9) },

  { label: 'reversing the monthly conversion turns a cap into a fraction of itself',
    from: '  function monthlyFromWeekly(weekly) { return weekly * WEEKS_PER_MONTH; }',
    to: '  function monthlyFromWeekly(weekly) { return weekly / WEEKS_PER_MONTH; }',
    check: m => !near(m.monthlyFromWeekly(600), 600 * WEEKS, 0.01),
    real: () => near(F.monthlyFromWeekly(600), 600 * WEEKS, 1e-9) },

  { label: 'dropping the room test publishes room where the cap cannot pay the essentials',
    from: '    const hasDiscretionaryRoom = atLeast(monthly, requiredMonthly);',
    to: '    const hasDiscretionaryRoom = true;',
    check: m => mBudget(m, 400).hasDiscretionaryRoom === true,
    real: () => budgetAt(400).cap.hasDiscretionaryRoom === false },

  { label: 'a bare comparison calls a cap exactly at the need a shortfall',
    from: '    const hasDiscretionaryRoom = atLeast(monthly, requiredMonthly);',
    to: '    const hasDiscretionaryRoom = monthly > requiredMonthly;',
    check: m => mBudget(m, 2000 / WEEKS).hasDiscretionaryRoom === false,
    real: () => budgetAt(2000 / WEEKS).cap.hasDiscretionaryRoom === true },

  { label: 'unbounding the room reports a negative remainder as spending money',
    from: '    const discretionaryRoomMonthly = Math.max(0, monthly - requiredMonthly);',
    to: '    const discretionaryRoomMonthly = monthly - requiredMonthly;',
    check: m => mBudget(m, 400).discretionaryRoomMonthly < 0,
    real: () => budgetAt(400).cap.discretionaryRoomMonthly === 0 },

  { label: 'reversing the shortfall reports the wrong figure below the need',
    from: '    const essentialShortfallMonthly = Math.max(0, requiredMonthly - monthly);',
    to: '    const essentialShortfallMonthly = Math.max(0, monthly - requiredMonthly);',
    check: m => mBudget(m, 400).essentialShortfallMonthly === 0,
    real: () => cents(budgetAt(400).cap.essentialShortfallMonthly) === 26071 },

  { label: 'measuring the recommendation instead of the override describes a plan nobody is shown',
    from: '    const weekly = opts.weeklyCap;',
    to: '    const weekly = opts.recommendedWeekly != null ? opts.recommendedWeekly : opts.weeklyCap;',
    check: m => mBudget(m, 400, { recommendedWeekly: 600 }).hasDiscretionaryRoom === true,
    real: () => budgetAt(400, { recommendedWeekly: 600 }).cap.hasDiscretionaryRoom === false },

  { label: 'a signed difference lets the page publish a negative shortfall again',
    from: `      weekly: Math.abs(householdDiscretionaryWeekly - roomWeekly),`,
    to: `      weekly: householdDiscretionaryWeekly - roomWeekly,`,
    check: m => mBudget(m, 600).roomVersusHousehold.weekly < 0,
    real: () => budgetAt(600).cap.roomVersusHousehold.weekly > 0 },

  { label: 'calling every case a shortfall mislabels a cap that leaves more than the budget',
    from: `      verdict: below(roomWeekly, householdDiscretionaryWeekly) ? 'short'
        : below(householdDiscretionaryWeekly, roomWeekly) ? 'exceeds'
          : 'meets',`,
    to: `      verdict: 'short',`,
    check: m => mBudget(m, 600).roomVersusHousehold.verdict === 'short',
    real: () => budgetAt(600).cap.roomVersusHousehold.verdict === 'exceeds' },

  { label: 'swapping the two sides of the comparison inverts the verdict',
    from: `      verdict: below(roomWeekly, householdDiscretionaryWeekly) ? 'short'
        : below(householdDiscretionaryWeekly, roomWeekly) ? 'exceeds'
          : 'meets',`,
    to: `      verdict: below(householdDiscretionaryWeekly, roomWeekly) ? 'short'
        : below(roomWeekly, householdDiscretionaryWeekly) ? 'exceeds'
          : 'meets',`,
    check: m => mBudget(m, 600).roomVersusHousehold.verdict === 'short'
      && mBudget(m, 400).roomVersusHousehold.verdict === 'exceeds',
    real: () => budgetAt(600).cap.roomVersusHousehold.verdict === 'exceeds' },
];
for (const m of MUTATIONS) {
  const built = mutant(m.from, m.to);
  if (built.error) { ok(false, m.label, built.error); continue; }
  ok(m.check(built.engine) && m.real(), m.label);
}

console.log('\n=== 9. the page and the snapshot divide nothing ===');
{
  const planSrc = read('public/plan.js');
  const snapSrc = read('scripts/figures-snapshot.js');
  for (const [name, src] of [['public/plan.js', planSrc], ['scripts/figures-snapshot.js', snapSrc]]) {
    ok(!/365\.25\s*\/\s*12\s*\/\s*7/.test(src),
      `${name} holds no copy of the weeks-per-month constant`);
    ok(!/WEEKS_PER_MONTH/.test(src), `${name} names no such constant at all`);
  }
  ok(!/const perWeek =/.test(planSrc), 'the page has no conversion helper');
  ok(!/recMonthly/.test(planSrc), 'and no monthly-cap arithmetic of its own');
  ok(!/Math\.max\(0, recMonthly - required\)/.test(planSrc),
    'no discretionary-room arithmetic');
  ok(!/const short = required - recMonthly/.test(planSrc), 'and no shortfall arithmetic');
  ok(/Forecast\.monthlyFromWeekly\(/.test(planSrc), 'the page reads the monthly conversion from Forecast');
  ok(/\bF\.monthlyFromWeekly\(/.test(snapSrc), 'and so does the snapshot script');
  ok(/weeklyCap: weekly/.test(planSrc) && /recommendedWeekly: recommended/.test(planSrc),
    'and the page tells the engine which cap is on screen');
  ok(/cap\.hasDiscretionaryRoom/.test(planSrc),
    'the discretionary-room verdict is read, not decided');
}

console.log('\n=== 9b. the room-versus-budget sentence, rendered on all three sides ===');
/* The blocking review's finding, and the gap in the proof that let it through:
 * section 2 asserted the negative comparison and never rendered it. The page's
 * clause map is lifted from source here — not copied — and every verdict is put
 * through it. A rendered financial sentence may never contain a negative
 * amount: "the plan is −$48/wk short of it and something has to give" is what
 * the signed field published. */
{
  const planSrc = read('public/plan.js');
  const appSrc = read('public/app.js');
  const grab = (src, re, what) => {
    const m = re.exec(src);
    ok(!!m, `${what} is readable from its source`);
    return m ? m[0] : '';
  };
  const moneySrc = grab(appSrc, /^const money = .*$/m, 'money()');
  const MAP_SRC = grab(planSrc, /^const ROOM_VERSUS_HOUSEHOLD = \{[\s\S]*?^\};$/m,
    'the room-versus-budget clause map');
  const ROOM = vm.runInNewContext(`${moneySrc}\n${MAP_SRC}\nROOM_VERSUS_HOUSEHOLD;`);

  const engineVerdicts = ['short', 'meets', 'exceeds'];
  ok(Object.keys(ROOM).sort().join(',') === engineVerdicts.slice().sort().join(','),
    'the page words exactly the three verdicts the engine can emit',
    Object.keys(ROOM).join(','));

  // One fixture per verdict, each built through the real engine.
  //   $600/wk → room $140.04 vs budget $91.99  → exceeds
  //   $400/wk → no room at all                 → short (by the whole budget)
  //   the meeting point                        → meets
  const meetsAt = budgetAt(600).cap.essentialWeekly + budgetAt(600).cap.householdDiscretionaryWeekly;
  const CASES = [
    { what: 'exceeds', weekly: 600 },
    { what: 'short', weekly: 460 },
    { what: 'meets', weekly: meetsAt },
  ];
  for (const k of CASES) {
    const c = budgetAt(k.weekly).cap;
    const r = c.roomVersusHousehold;
    ok(r.verdict === k.what, `a $${k.weekly.toFixed(2)}/wk cap is "${k.what}"`, r.verdict);
    const sentence = `own budget for those comes to ${vm.runInNewContext(`${moneySrc}\nmoney`)(c.householdDiscretionaryWeekly)}/wk, `
      + ROOM[r.verdict](r);
    ok(!/−\$/.test(sentence),
      `and its rendered sentence carries no negative amount — ${k.what}`, sentence);
    ok(!/undefined|NaN/.test(sentence), `nor undefined or NaN — ${k.what}`);
    if (k.what === 'short') {
      ok(/so the plan is \$\d[\d,]*\/wk short of it and something has to give\.$/.test(sentence),
        'the short sentence is the wording the household reads today', sentence);
    }
    if (k.what === 'exceeds') {
      ok(/and the plan leaves \$48\/wk more than that\.$/.test(sentence),
        'and the exceeds sentence says what is actually true', sentence);
    }
    if (k.what === 'meets') {
      ok(/which is what the plan leaves\.$/.test(sentence),
        'and the meets sentence claims neither', sentence);
    }
  }

  // The old shape, rendered, to show exactly what was being published.
  const money = vm.runInNewContext(`${moneySrc}\nmoney`);
  const c600 = budgetAt(600).cap;
  const signed = c600.householdDiscretionaryWeekly - c600.discretionaryRoomWeekly;
  ok(signed < 0 && /^−\$/.test(money(signed)),
    'the field this replaced rendered as a negative dollar amount',
    `so the plan is ${money(signed)}/wk short of it and something has to give.`);
}

console.log('\n=== 10. the real page, booted, on both sides of the sentence ===');
/* Everything above proves the engine and renders through its clause map. This
 * runs the page — `public/app.js`, `public/forecast.js`, `public/plan.js` in
 * the order `index.html` loads them, against a stub DOM, through `App.boot()`
 * on the real `data.json` — and reads back what the household is shown. It is
 * booted TWICE: once at the recommendation, and once with a stored $1,800/week
 * override, which is what a household can type into the weekly box and is the
 * setting the blocking review found publishing a negative shortfall. */
function bootPage(storedKnobs) {
  const els = new Map();
  const makeEl = id => {
    const el = {
      id, textContent: '', value: '', placeholder: '', checked: false, hidden: false,
      className: '', style: {}, children: [], listeners: {}, attributes: {},
      addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
      setAttribute(k, v) { this.attributes[k] = v; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(c) { this.children.push(c); return c; },
      insertAdjacentHTML(_, h) { this.innerHTML = String(h); },
      querySelectorAll: () => [],
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML',
      { get: () => html, set(v) { html = String(v); el.children = []; } });
    return el;
  };
  const get = id => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const sandbox = {
    document: {
      getElementById: get,
      createElement: () => makeEl('created'),
      createElementNS: () => makeEl('svg'),
      querySelector: () => null, querySelectorAll: () => [],
      documentElement: makeEl('html'), body: { scrollHeight: 0 },
    },
    // The knob store the page really reads its weekly override from.
    localStorage: {
      getItem: () => (storedKnobs ? JSON.stringify(storedKnobs) : null),
      setItem() {}, removeItem() {},
    },
    addEventListener() {}, matchMedia: () => ({ addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame() {}, innerWidth: 1200, innerHeight: 800, scrollY: 0, console,
    fetch: url => Promise.resolve({ status: 200, ok: true,
      json: () => (String(url).includes('periods') ? periods : data) }),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of ['public/app.js', 'public/forecast.js', 'public/plan.js']) {
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  return { get };
}
const flat = s => s.replace(/\s+/g, ' ').trim();
const settle = () => new Promise(r => setTimeout(r, 0));

(async () => {
  /* --- at the recommendation: the published state, unchanged --- */
  const def = bootPage(null);
  await settle();
  const capSplit = flat(def.get('cap-split').innerHTML);
  const budgetOut = flat(def.get('budget-out').innerHTML);
  const tiles = flat(def.get('hero-tiles').innerHTML);
  const catsNote = def.get('budget-cats-note').textContent;

  ok(/\$918/.test(capSplit), 'the booted page shows the $918/wk essential need');
  ok(/\$332/.test(capSplit), 'and $332/wk of discretionary room');
  ok(/Groceries \$414, fuel \$299/.test(capSplit), 'with groceries and fuel split per week');
  ok(/≈ \$5,435 a month/.test(capSplit), 'and the cap said in months');
  const roomNote = h => (/own budget for those comes to [^<]*/.exec(h) || ['(not found)'])[0];
  ok(/so the plan is \$522\/wk short of it and something has to give\./.test(capSplit),
    'and the household-budget sentence reads exactly as it does today', roomNote(capSplit));
  ok(/\$5,435 \/ month/.test(budgetOut), 'the ledger says the same monthly cap');
  ok(/\$332 \/ week/.test(budgetOut) && !/nothing left/.test(budgetOut),
    'and reports real discretionary room rather than "nothing left"');
  ok(/\$853\/week those have actually been running at/.test(budgetOut),
    'against the household\'s own discretionary budget');
  ok(/\$918\/wk/.test(tiles) && /\$713\/wk of it food and fuel/.test(tiles),
    'the tiles carry the weekly need and its food-and-fuel share');
  ok(/\$7,704\/month against a cap of \$5,435\/month/.test(catsNote)
    && /\$2,269\/month has to come off/.test(catsNote),
  'and the category note reconciles against the monthly cap');

  /* --- at a $1,800/week override: the state the review found --- */
  const over = bootPage({ weeklyVariable: 1800 });
  await settle();
  const overSplit = flat(over.get('cap-split').innerHTML);

  ok(/\$882/.test(overSplit),
    'at a stored $1,800/wk override the page shows $882/wk of room', roomNote(overSplit));
  ok(/and the plan leaves \$28\/wk more than that\./.test(overSplit),
    'and says the plan leaves MORE than the household budgets — the truthful sentence',
    roomNote(overSplit));
  ok(!/short of it and something has to give/.test(overSplit),
    'not that it is short of it');
  ok(!/−\$/.test(overSplit),
    'and no negative dollar amount reaches the household', roomNote(overSplit));

  for (const [name, html] of [['cap-split', capSplit], ['budget-out', budgetOut],
    ['hero-tiles', tiles], ['budget-cats-note', catsNote], ['cap-split @1800', overSplit]]) {
    ok(!/undefined|NaN|\[object/.test(html),
      `${name} contains no undefined, NaN or [object Object]`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})();
