'use strict';
/* Planning page — "What are we preparing and saving for?" `node test/test-planning-page.js`
 *
 * The page renders Forecast.majorPlans (plus the matching
 * Forecast.paydayAllocation row) from the same Forecast.recommend call the
 * Plan page and the assistant packet use. This suite runs the real
 * planning.js in a vm with the real app.js formatters and a stub App, and
 * reads the HTML the household would read. Behaviour uses a synthetic
 * fixture whose verdicts and amounts are forced by construction; the live
 * data.json proves the settled-row exclusion and field pass-through against
 * Forecast's own output. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const periods = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/periods.json'), 'utf8'));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' });
const strip = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const stripComments = src => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ---------------------------------------------------------------- harness */
function loadPage(script) {
  const appSrc = read('public/app.js');
  const grab = re => { const m = re.exec(appSrc); if (!m) throw new Error('missing ' + re); return m[0]; };
  const helpers = [
    grab(/^const money = .*$/m), grab(/^const money2 = .*$/m), grab(/^const pct = .*$/m),
    grab(/^const fmtDate = .*$/m), grab(/^const fmtDateLong = .*$/m), grab(/^const fmtDateFull = .*$/m),
  ].join('\n');
  const elements = {};
  const ctx = {
    Forecast: F, console, elements,
    App: { hooks: [], bootOpts: null, register(fn) { this.hooks.push(fn); }, boot(opts) { this.bootOpts = opts || {}; } },
  };
  vm.runInNewContext(
    `${helpers}\nfunction planningStubEl(){ return { innerHTML: '', textContent: '', querySelector(){return null;}, querySelectorAll(){return [];}, classList:{toggle(){},add(){},remove(){}}, setAttribute(){}, getAttribute(){return null;} }; }\nconst $ = id => elements[id] || (elements[id] = planningStubEl());\n${read(script)}`,
    ctx, { filename: script });
  return {
    ctx,
    render(data, p) {
      for (const k of Object.keys(elements)) delete elements[k];
      for (const fn of ctx.App.hooks) fn(data, p || null, null);
      return elements;
    },
    // The same composer the page runs, on an advice object the test controls.
    compose(advice, liveOverlay) { return ctx.planningPageHtml(advice, liveOverlay); },
    composeTrajectory(data, p) {
      return ctx.planningTrajectoryHtml(ctx.planningTrajectory(data, p || null));
    },
    composePressure(data, p) {
      return ctx.planningTrajectoryPressureHtml(ctx.planningTrajectory(data, p || null));
    },
    composeDebtDirection(data, p) {
      return ctx.planningTrajectoryDebtDirectionHtml(ctx.planningTrajectory(data, p || null));
    },
    composeFunding(data, p, monthKey) {
      return ctx.planningTrajectoryFundingHtml(ctx.planningTrajectory(data, p || null), monthKey);
    },
  };
}

function row(html, id) {
  const re = new RegExp(`<article class="planning-row[^"]*" data-planning-id="${id}"[\\s\\S]*?<\\/article>`);
  const m = re.exec(html);
  return m ? m[0] : null;
}
function factOf(rowHtml, name) {
  const re = new RegExp(`<div data-planning-fact="${name}">[\\s\\S]*?<\\/div>`);
  const m = re.exec(rowHtml || '');
  return m ? m[0] : null;
}
const ids = html => [...String(html || '').matchAll(/data-planning-id="([^"]+)"/g)].map(m => m[1]);

/* ---------------------------------------------------------------- fixture */
// Plenty of cash so every verdict is ON TRACK by construction, except a
// dated point cost placed beyond the cash on hand before payday.
const AS_OF = '2026-03-10';
function fixture(cashValue) {
  return {
    meta: { asOf: AS_OF },
    revolvingExtra: [],
    debts: [],
    plan: {
      windowDays: 91,
      defaults: { scenario: 'expected', targetBuffer: 0, extraDebtMonthly: 0 },
      opening: { asOf: AS_OF },
      startingCash: { breakdown: [{ id: 'chequing-a', label: 'Chequing A', value: cashValue == null ? 50000 : cashValue }] },
      income: [{ id: 'pay', label: 'Pay', frequency: 'biweekly', anchor: '2026-03-06', amount: 2000, confidence: 'confirmed' }],
      obligations: [],
      bills: [],
      commitments: [
        { id: 'settled-camp', date: '2026-03-01', label: 'Settled camp', amount: 786, confidence: 'confirmed', settledOn: '2026-03-02' },
        { id: 'dated-point', date: '2026-04-10', label: 'Dated point cost', amount: 800, confidence: 'estimated', adjustable: true },
        { id: 'point', label: 'Point estimate', amount: 2000, when: 'late Sep 2026', confidence: 'estimated' },
        { id: 'range', label: 'Range cost', amount: null, amountMin: 700, amountMax: 1200, when: 'Fall 2026', confidence: 'estimated', adjustable: true },
        { id: 'tbd', label: 'Timing TBD cost', amount: 1000, when: 'timing TBD', confidence: 'estimated' },
        { id: 'optional', label: 'Optional wish', amount: 300, when: 'someday', confidence: 'estimated', optional: true },
      ],
    },
  };
}

const page = loadPage('public/planning.js');

console.log('=== 1–2. The page consumes Forecast.majorPlans and invents no verdict ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/Forecast\.recommend\(/.test(src) && /advice\.majorPlans/.test(src) && /advice\.paydayAllocation/.test(src),
    'planning.js reads majorPlans and paydayAllocation off Forecast.recommend');
  ok(!/plan\.commitments/.test(src), 'planning.js never reads plan.commitments');
  ok(!/Forecast\.(fundingSequence|majorPlans|simulate|expandEvents)\(/.test(src),
    'planning.js does not call the sequence or walk itself — one recommend call, like Plan and the assistant packet');
  const verdictAssign = /verdict\s*=\s*['"](ON TRACK|AT RISK|FUNDING GAP)['"]/.test(src)
    || /['"](ON TRACK|AT RISK|FUNDING GAP)['"]\s*:\s*\(?\s*\w*\s*(>|<|>=|<=|-|\+)/.test(src);
  ok(!verdictAssign, 'no verdict is computed in the page; the three strings appear only as presentation keys');
  ok(!/remaining\s*[-+*/]=|\.need\s*[-+*/]|\.amountMin\s*[-+*/]|\.amountMax\s*[-+*/]|\/\s*2/.test(src),
    'no arithmetic on need, remaining or range bounds (no midpoint, no total)');
  ok(!/new Date\(\)|Date\.now|localStorage/.test(src), 'no browser clock and no persisted knob');
  const fx = fixture();
  const el = page.render(fx, null);
  const advice = F.recommend(fx.plan, AS_OF, { fundingSources: null, debts: [], extraFacilities: [], periods: null });
  const rendered = ids(el['planning-list'].innerHTML);
  ok(JSON.stringify(rendered) === JSON.stringify(advice.majorPlans.map(p => p.id)),
    'rows are exactly Forecast.majorPlans, in Forecast order', rendered.join(','));
  for (const p of advice.majorPlans) {
    ok(new RegExp(`data-planning-verdict="${p.verdict}"`).test(row(el['planning-list'].innerHTML, p.id)),
      `${p.id} prints Forecast's verdict ${p.verdict}`);
  }
}

console.log('\n=== 3–4. Unsettled plans render; settled commitments are not savings goals ===');
{
  const el = page.render(fixture(), null);
  const html = el['planning-list'].innerHTML;
  ok(['dated-point', 'point', 'range', 'tbd', 'optional'].every(id => row(html, id)), 'every unsettled row renders');
  ok(!row(html, 'settled-camp') && !/Settled camp/.test(html), 'a settledOn ≤ as-of commitment does not appear');
  const later = fixture();
  later.plan.commitments.find(c => c.id === 'settled-camp').settledOn = '2026-03-20';
  const laterHtml = page.render(later, null)['planning-list'].innerHTML;
  ok(!!row(laterHtml, 'settled-camp'), 'a commitment settled after as-of is still unsettled on this opening and renders (Forecast rule, not a page rule)');
  const liveEl = page.render(live, periods);
  const liveHtml = liveEl['planning-list'].innerHTML;
  const settled = live.plan.commitments.filter(c => F.commitmentSettledBy(c, live.meta.asOf));
  ok(settled.length > 0 && settled.every(c => !row(liveHtml, c.id) && !liveHtml.includes(c.label)),
    `live: ${settled.length} settled commitments (${settled.map(c => c.id).join(', ')}) are absent`);
  const unsettled = live.plan.commitments.filter(c => !F.commitmentSettledBy(c, live.meta.asOf));
  ok(unsettled.every(c => !!row(liveHtml, c.id)), `live: all ${unsettled.length} unsettled commitments render`);
}

console.log('\n=== 5–8. Points stay points, ranges stay ranges, approximate stays approximate, unknown stays unresolved ===');
{
  const el = page.render(fixture(), null);
  const html = el['planning-list'].innerHTML;
  const point = row(html, 'point');
  ok(/data-planning-amount="point"/.test(point) && strip(factOf(point, 'requirement')).includes('$2,000.00 Cost'),
    'a point estimate prints as one amount');
  const range = row(html, 'range');
  ok(/data-planning-amount="range"/.test(range) && /\$700\.00–\$1,200\.00/.test(range) && /Cost range/.test(range),
    'a range prints as $700.00–$1,200.00');
  ok(!/\$950/.test(range) && !/\$700\.00 Cost </.test(strip(range)), 'no midpoint ($950) and no floor stand-in is printed for the range');
  ok(/data-planning-timing="approximate"/.test(point) && /<span data-planning-when>late Sep 2026<\/span>/.test(point),
    '"late Sep 2026" is printed as stated');
  ok(/<span data-planning-when>Fall 2026<\/span>/.test(range), '"Fall 2026" is printed as stated');
  ok(!/September|October|November|\d{1,2} (Sep|Oct|Nov)/.test(strip(point) + strip(range)),
    'no calendar day is invented from approximate timing');
  const tbd = row(html, 'tbd');
  ok(/<span data-planning-when>timing TBD<\/span>/.test(tbd) && /EXACT DATE UNRESOLVED/.test(tbd),
    '"timing TBD" stays unresolved and is flagged EXACT DATE UNRESOLVED');
  const dated = row(html, 'dated-point');
  ok(/data-planning-timing="dated"/.test(dated) && strip(dated).includes(longDate('2026-04-10')),
    'a dated commitment prints its Forecast date');
  const fxAdvice = F.recommend(fixture().plan, AS_OF, { fundingSources: null, debts: [], extraFacilities: [], periods: null });
  ok(fxAdvice.majorPlans.every(p => /MAY MOVE/.test(row(html, p.id)) === !!p.deferred),
    'MAY MOVE appears exactly where Forecast marked the row deferred');
  ok(/>FLEXIBLE</.test(range) && />REQUIRED</.test(point) && />OPTIONAL</.test(row(html, 'optional')),
    'flexibility chips follow Forecast flexibility');
  // Live ranges from the current data: whatever Forecast returns with both bounds.
  const liveEl = page.render(live, periods);
  const liveHtml = liveEl['planning-list'].innerHTML;
  const liveAdvice = F.recommend(live.plan, live.meta.asOf, {
    fundingSources: live.plan.funding && live.plan.funding.options, debts: live.debts,
    extraFacilities: live.revolvingExtra, periods,
  });
  const liveRanges = liveAdvice.majorPlans.filter(p => p.need == null && p.amountMin != null && p.amountMax != null);
  ok(liveRanges.length > 0 && liveRanges.every(p => {
    const r = row(liveHtml, p.id);
    return r && r.includes(`${money2(p.amountMin)}–${money2(p.amountMax)}`)
      && !r.includes(money2((p.amountMin + p.amountMax) / 2));
  }), `live: ${liveRanges.length} range rows print min–max and never a midpoint`);
  ok(liveAdvice.majorPlans.filter(p => p.when).every(p => new RegExp(`<span data-planning-when>${p.when.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</span>`).test(row(liveHtml, p.id))),
    'live: every approximate `when` is printed verbatim');
}

console.log('\n=== 9–10. Forecast remaining / projected values unchanged; set-aside only from Forecast allocation ===');
{
  const fx = fixture();
  const el = page.render(fx, null);
  const html = el['planning-list'].innerHTML;
  const advice = F.recommend(fx.plan, AS_OF, { fundingSources: null, debts: [], extraFacilities: [], periods: null });
  for (const p of advice.majorPlans) {
    ok(strip(factOf(row(html, p.id), 'remaining')).startsWith(money2(p.remaining)),
      `${p.id} prints Forecast remaining ${money2(p.remaining)} unchanged`);
  }
  const alloc = advice.paydayAllocation;
  const datedAlloc = (alloc.futureCosts || []).find(r => r.id === 'dated-point');
  ok(datedAlloc && strip(factOf(row(html, 'dated-point'), 'projected')).includes(money2(datedAlloc.projectedByDeadline)),
    'the dated cost prints Forecast projectedByDeadline from paydayAllocation');
  const setAside = factOf(row(html, 'dated-point'), 'set-aside');
  ok(datedAlloc && (Number(datedAlloc.allocated) > 0
    ? strip(setAside).includes(money2(datedAlloc.allocated)) && /Set aside this payday/.test(setAside)
    : /None/.test(setAside) && /No set-aside this payday/.test(setAside)),
  `set-aside mirrors Forecast allocated (${datedAlloc && datedAlloc.allocated}) — printed only as Forecast assigned it`);
  ok(/Not assigned/.test(factOf(row(html, 'point'), 'set-aside')) && /Exact date not set/.test(factOf(row(html, 'point'), 'set-aside')),
    'an undated required cost prints Not assigned (Forecast unresolved), not a $0 set-aside');
  ok(!factOf(row(html, 'point'), 'projected'), 'no projected-by-deadline is printed where Forecast produced none');
  // A composed advice with a FUNDING GAP and AT RISK row: the page prints those verdicts and remaining verbatim.
  const composed = page.compose({
    majorPlans: [
      { id: 'gap', label: 'Gap cost', date: '2026-04-01', need: 5000, flexibility: 'required', confidence: 'estimated', verdict: 'FUNDING GAP', remaining: 1234.56, deferred: false },
      { id: 'risk', label: 'Risky range', when: 'Fall 2026', amountMin: 100, amountMax: 900, flexibility: 'bounded-flex', confidence: 'estimated', adjustable: true, verdict: 'AT RISK', remaining: 800, deferred: true },
    ],
    paydayAllocation: { futureCosts: [{ id: 'gap', allocated: 250, projectedByDeadline: 3765.44 }], optional: [], unresolved: [{ id: 'risk' }] },
    knowledge: { end: '2027-03-09', encumbered: 100 },
  }, null);
  ok(/data-planning-verdict="FUNDING GAP"/.test(row(composed.list, 'gap')) && strip(factOf(row(composed.list, 'gap'), 'remaining')).includes('$1,234.56 Funding gap'),
    'FUNDING GAP verdict and remaining are printed as given');
  ok(strip(factOf(row(composed.list, 'gap'), 'set-aside')).includes('$250.00 Set aside this payday')
      && strip(factOf(row(composed.list, 'gap'), 'projected')).includes('$3,765.44 Projected available by deadline'),
    'set-aside and projection are printed as given');
  ok(/data-planning-verdict="AT RISK"/.test(row(composed.list, 'risk')) && strip(factOf(row(composed.list, 'risk'), 'remaining')).includes('$800.00 At-risk amount')
      && /MAY MOVE/.test(row(composed.list, 'risk')) && /\$100\.00–\$900\.00/.test(row(composed.list, 'risk')),
    'AT RISK verdict, remaining, MAY MOVE and range are printed as given');
  const withheld = page.compose({ operatingPlanUnavailable: true, operatingPlanNote: 'Current plan unavailable — test.' }, { operatingPlan: 'unavailable' });
  ok(/data-operating-plan="unavailable"/.test(withheld.list) && !/data-planning-id/.test(withheld.list),
    'when Forecast withholds the current operating plan, no verdict is printed (incumbent Plan rule)');
}

console.log('\n=== 11–12. No saved balance is invented; no independent ranking or total ===');
{
  const el = page.render(live, periods);
  const html = el['planning-list'].innerHTML + el['planning-lede'].textContent + el['planning-note'].textContent;
  ok(!/Saved \$|saved so far|\bSaved\b.*\$0/i.test(html), 'no "Saved $0" or saved-so-far figure anywhere');
  ok(/does not track a dedicated saved balance/.test(el['planning-note'].textContent), 'the page says Atlas does not track a saved balance');
  const src = stripComments(read('public/planning.js'));
  ok(!/savedSoFar|\.sort\(|reverse\(\)|priority/.test(src), 'planning.js does not sort, reverse, or read priority; Forecast order is rendered');
  const liveAdvice = F.recommend(live.plan, live.meta.asOf, {
    fundingSources: live.plan.funding && live.plan.funding.options, debts: live.debts,
    extraFacilities: live.revolvingExtra, periods,
  });
  const pointTotal = liveAdvice.majorPlans.filter(p => p.need != null).reduce((s, p) => s + p.need, 0);
  ok(!html.includes(money2(pointTotal)), `the page does not print an independent total of point estimates (${money2(pointTotal)})`);
  const floorTotal = liveAdvice.majorPlans.reduce((s, p) => s + (p.need != null ? p.need : (p.amountMin || 0)), 0);
  ok(!html.includes(money2(floorTotal)) || Math.abs(floorTotal - liveAdvice.knowledge.encumbered) < 0.005,
    'no page-summed floor total appears unless it is Forecast\'s own protected floor');
  ok(el['planning-lede'].textContent.includes(money2(liveAdvice.knowledge.encumbered))
      && /protected floor, not a total/.test(el['planning-lede'].textContent)
      && /ranges count at their low end/.test(el['planning-lede'].textContent),
    'the only aggregate is Forecast knowledge.encumbered, labelled as a protected floor with ranges at their low end');
  ok(el['planning-lede'].textContent.includes(longDate(liveAdvice.knowledge.end)), 'the lede names the Forecast knowledge horizon end');
}

console.log('\n=== 13–15. Baseline trajectory reprints Forecast.baselineTrajectory ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/Forecast\.baselineTrajectory\(/.test(src),
    'planning.js calls Forecast.baselineTrajectory');
  ok(!/Forecast\.simulate\(|Forecast\.projectDebts\(|Forecast\.expandEvents\(/.test(src),
    'planning.js does not walk cash or debt for the trajectory table');
  const liveEl = page.render(live, periods);
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  ok(traj.status === 'ready' && Array.isArray(traj.months) && traj.months.length > 0,
    'live baselineTrajectory is ready with months');
  const tableHtml = liveEl['planning-trajectory'].innerHTML;
  ok(/planning-trajectory-table/.test(tableHtml), 'trajectory renders a table');
  for (const month of traj.months) {
    ok(new RegExp(`data-trajectory-month="${month.month}"`).test(tableHtml),
      `live: month ${month.month} is printed, not omitted`);
    const income = month.income || {};
    ok(new RegExp(`data-trajectory-month="${month.month}"[^>]*data-trajectory-income-status="${income.status}"`).test(tableHtml),
      `live: ${month.month} income status is ${income.status}`);
    if (income.status === 'unavailable') {
      ok(/Forecast unavailable/.test(tableHtml) && income.reason && tableHtml.includes(income.reason),
        `live: ${month.month} unavailable income prints Forecast reason`);
      ok(!new RegExp(`data-trajectory-month="${month.month}"[\\s\\S]*?planning-trajectory-income[^>]*>\\s*<b>\\$0\\.00</b>`).test(tableHtml),
        `live: ${month.month} unavailable income is not printed as $0`);
    } else if (income.amount != null) {
      ok(tableHtml.includes(money2(income.amount)), `live: ${month.month} income amount matches Forecast`);
    }
    const cash = month.cash || {};
    ok(new RegExp(`data-trajectory-month="${month.month}"[^>]*data-trajectory-cash-status="${cash.status}"`).test(tableHtml),
      `live: ${month.month} cash status is ${cash.status}`);
    if (cash.status === 'unavailable') {
      ok(cash.reason && tableHtml.includes(cash.reason),
        `live: ${month.month} unavailable cash prints Forecast reason`);
    } else if (cash.amount != null) {
      ok(tableHtml.includes(money2(cash.amount)), `live: ${month.month} cash amount matches Forecast`);
    }
  }
  const jan2027 = traj.months.find(m => m.month === '2027-01');
  ok(jan2027 && jan2027.income && jan2027.income.status === 'estimated'
    && jan2027.cash && jan2027.cash.status === 'estimated'
    && typeof jan2027.income.amount === 'number' && jan2027.income.amount !== 0,
    'live: January 2027 is Forecast-estimated Dale income and cash, not carried 2026 net');
  ok(/does not walk cash or debt itself/.test(liveEl['planning-trajectory-note'].textContent),
    'trajectory footnote says the page does not walk cash or debt');
  ok(!/Cash \(month-end\)/.test(tableHtml),
    'cash column is not labelled month-end (period end matches Forecast span)');
  ok(/Cash \(period end\)/.test(tableHtml), 'cash column names period end');
  ok(/Secured incl\. HELOC/.test(tableHtml) && /of which HELOC/.test(tableHtml),
    'secured vs HELOC relationship is explicit on the page');
  for (const month of traj.months) {
    ok(new RegExp(`data-trajectory-period-start="${month.start}"`).test(tableHtml)
      && new RegExp(`data-trajectory-period-end="${month.end}"`).test(tableHtml),
      `live: ${month.month} prints Forecast period ${month.start}–${month.end}`);
    const rowRe = new RegExp(
      `<tr[^>]*data-trajectory-month="${month.month}"[^>]*>[\\s\\S]*?</tr>`);
    const rowMatch = rowRe.exec(tableHtml);
    ok(rowMatch, `live: ${month.month} row is present for period inspection`);
    if (month.start.slice(0, 7) === month.month) {
      const [y, m] = month.month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
      const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const partial = month.start !== monthStart || month.end !== monthEnd;
      if (partial) {
        ok(/data-trajectory-partial="true"/.test(rowMatch[0]) && /Partial period/.test(rowMatch[0]),
          `live: ${month.month} partial boundary row is marked`);
      }
    }
    const cash = month.cash || {};
    if (cash.asOf) {
      ok(new RegExp(`data-trajectory-cash-asof="${cash.asOf}"`).test(tableHtml),
        `live: ${month.month} cash.asOf ${cash.asOf} is visible`);
    }
    const debt = month.debt || {};
    if (debt.asOf) {
      ok(new RegExp(`data-trajectory-debt-asof="${debt.asOf}"`).test(tableHtml),
        `live: ${month.month} debt.asOf ${debt.asOf} is visible`);
    }
  }
}

console.log('\n=== 16. Trajectory pressure reprints Forecast.baselineTrajectory.pressure ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/Forecast\.baselineTrajectory\(/.test(src),
    'pressure reprint still uses the incumbent Forecast.baselineTrajectory call');
  ok(!/baselineTrajectoryPressure|trajectorySignalAttribution|trajectoryPressureUnavailable/.test(src),
    'planning.js does not compute pressure or attribution');
  ok(!/baselineTrajectoryScenario/.test(src),
    'planning.js does not reprint baselineTrajectoryScenario');
  ok(/planningTrajectoryAttributionHtml\(/.test(src)
    && /signal\.attribution/.test(src),
    'planning.js reprints signal.attribution from Forecast only');
  ok(!/TRAJECTORY_DRIVER_CLASS_ORDER|trajectoryCollectCashDrivers|trajectoryCashWindowAttribution/.test(src),
    'planning.js does not import Forecast attribution math');
  ok(!/TOTAL RISK|safe-to-spend|RYG|affordability/i.test(src),
    'planning pressure attribution carries no ranking or policy-threshold wording');
  ok(!/assistant-packet|\/talk\//.test(src),
    'planning.js does not touch packet or Talk seams');

  const liveEl = page.render(live, periods);
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  ok(traj.pressure && traj.pressure.status === 'ready'
    && Array.isArray(traj.pressure.signals),
    'live baselineTrajectory pressure is ready with signals');
  const pressureHtml = liveEl['planning-trajectory-pressure'].innerHTML;
  ok(/data-trajectory-pressure="ready"/.test(pressureHtml),
    'live pressure list is marked ready');
  ok(traj.pressure.signals.length > 0,
    'live fixture has at least one pressure signal to copy');
  const kindOrder = [...pressureHtml.matchAll(/data-trajectory-pressure-kind="([^"]+)"/g)].map(m => m[1]);
  ok(kindOrder.length === traj.pressure.signals.length,
    'live: every Forecast pressure signal is printed');
  ok(kindOrder.every((kind, i) => kind === traj.pressure.signals[i].kind),
    'live: pressure signal order matches Forecast');
  for (let i = 0; i < traj.pressure.signals.length; i++) {
    const s = traj.pressure.signals[i];
    const itemRe = new RegExp(
      `<li class="planning-trajectory-pressure-item"[^>]*data-trajectory-pressure-index="${i}"[^>]*>`);
    ok(itemRe.test(pressureHtml), `live: pressure signal ${i} (${s.kind}) is present`);
    if (s.month) {
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[^>]*data-trajectory-pressure-month="${s.month}"`).test(pressureHtml),
        `live: signal ${i} month ${s.month} is copied`);
    }
    if (s.date) {
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[^>]*data-trajectory-pressure-date="${s.date}"`).test(pressureHtml),
        `live: signal ${i} date ${s.date} is copied`);
    }
    if (s.trust) {
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[^>]*data-trajectory-pressure-trust="${s.trust}"`).test(pressureHtml),
        `live: signal ${i} trust ${s.trust} is copied`);
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[\\s\\S]*?${s.trust.toUpperCase()}`).test(pressureHtml),
        `live: signal ${i} trust chip is visible`);
    }
    if (s.amount != null && isFinite(Number(s.amount))) {
      ok(pressureHtml.includes(money2(s.amount)),
        `live: signal ${i} amount ${money2(s.amount)} is copied`);
    }
    if (s.id) {
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[^>]*data-trajectory-pressure-id="${s.id}"`).test(pressureHtml),
        `live: signal ${i} id ${s.id} is copied`);
    }
    if (s.asOf) {
      ok(new RegExp(`data-trajectory-pressure-index="${i}"[^>]*data-trajectory-pressure-asof="${s.asOf}"`).test(pressureHtml),
        `live: signal ${i} asOf ${s.asOf} is copied`);
    }
  }
  const readyWithDrivers = traj.pressure.signals.find(s => s.attribution
    && s.attribution.status === 'ready'
    && Array.isArray(s.attribution.drivers)
    && s.attribution.drivers.length > 0);
  ok(readyWithDrivers, 'live fixture has a ready attribution with drivers');
  if (readyWithDrivers) {
    const idx = traj.pressure.signals.indexOf(readyWithDrivers);
    ok(new RegExp(`data-trajectory-pressure-index="${idx}"[\\s\\S]*?data-trajectory-pressure-attribution="ready"`).test(pressureHtml),
      'live: ready attribution block is printed under its signal');
    const driver = readyWithDrivers.attribution.drivers[0];
    ok(new RegExp(`data-trajectory-attribution-driver-class="${driver.class}"`).test(pressureHtml),
      `live: first driver class ${driver.class} is copied`);
    if (driver.amount != null && isFinite(Number(driver.amount))) {
      ok(pressureHtml.includes(money2(driver.amount)),
        `live: driver amount ${money2(driver.amount)} is copied`);
    }
    const itemRe = new RegExp(
      `<li class="planning-trajectory-pressure-item"[^>]*data-trajectory-pressure-index="${idx}"[^>]*>[\\s\\S]*?</li>`);
    const itemMatch = itemRe.exec(pressureHtml);
    const itemHtml = itemMatch ? itemMatch[0] : '';
    const driverOrder = [...itemHtml.matchAll(/data-trajectory-attribution-driver-class="([^"]+)"/g)].map(m => m[1]);
    const forecastOrder = readyWithDrivers.attribution.drivers.map(d => d.class);
    ok(driverOrder.join(',') === forecastOrder.join(','),
      'live: driver order under one signal matches Forecast', `${driverOrder.join(',')} vs ${forecastOrder.join(',')}`);
    if (readyWithDrivers.attribution.change != null && isFinite(Number(readyWithDrivers.attribution.change))) {
      ok(pressureHtml.includes(money2(readyWithDrivers.attribution.change)),
        'live: attributed change amount is copied');
    }
  }
  const unavailableAttr = traj.pressure.signals.find(s => s.attribution
    && s.attribution.status === 'unavailable' && s.attribution.reason);
  ok(unavailableAttr, 'live fixture has unavailable attribution with a reason');
  if (unavailableAttr) {
    const idx = traj.pressure.signals.indexOf(unavailableAttr);
    ok(new RegExp(`data-trajectory-pressure-index="${idx}"[\\s\\S]*?data-trajectory-pressure-attribution="unavailable"`).test(pressureHtml),
      'live: unavailable attribution block is printed under its signal');
    ok(pressureHtml.includes(unavailableAttr.attribution.reason),
      'live: unavailable attribution prints Forecast attribution.reason');
  }

  const missingAttrHtml = page.ctx.planningTrajectoryPressureSignalHtml({
    kind: 'cash-trough', date: '2026-01-01', amount: 100,
  }, 0);
  ok(/data-trajectory-pressure-attribution="unavailable"/.test(missingAttrHtml),
    'missing attribution object is unavailable, not invented');
  ok(!/data-trajectory-attribution-driver-class=/.test(missingAttrHtml),
    'missing attribution does not invent drivers');

  const missingTraj = F.baselineTrajectory(null, [], live.meta.asOf, { periods });
  const missingPressure = page.composePressure({ plan: null, debts: [], meta: { asOf: live.meta.asOf }, revolvingExtra: null }, periods);
  ok(missingTraj.pressure && missingTraj.pressure.status === 'unavailable',
    'missing plan pressure is unavailable on Forecast');
  ok(/data-trajectory-pressure="unavailable"/.test(missingPressure.list),
    'unavailable pressure is not rendered as an empty success');
  ok(missingPressure.list.includes(missingTraj.pressure.reason),
    'unavailable pressure prints Forecast pressure.reason');
  ok(/does not score, rank, or compute pressure or attribution/.test(missingPressure.note),
    'pressure footnote says the page does not compute pressure or attribution');
}

console.log('\n=== 17. Trajectory debt direction reprints Forecast.baselineTrajectory.debtDirection ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/Forecast\.baselineTrajectory\(/.test(src),
    'debt direction reprint still uses the incumbent Forecast.baselineTrajectory call');
  ok(/planningTrajectoryDebtDirectionHtml\(/.test(src) && /traj\.debtDirection/.test(src),
    'planning.js reprints traj.debtDirection from Forecast only');
  ok(!/baselineTrajectoryDebtDirection|trajectoryBalanceDirection|trajectoryDebtDirectionUnavailable/.test(src),
    'planning.js does not compute debt direction');
  ok(!/baselineTrajectoryScenario|assistant-packet|\/talk\//.test(src),
    'planning.js does not touch scenario, packet, or Talk seams');
  ok(!/payoff order|comfort band|affordability|safe-to-spend|RYG/i.test(src),
    'debt direction copy carries no ranking or policy-threshold wording');

  const liveEl = page.render(live, periods);
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  ok(traj.debtDirection && traj.debtDirection.status === 'ready'
    && Array.isArray(traj.debtDirection.debts),
    'live baselineTrajectory debtDirection is ready with per-debt rows');
  const ddHtml = liveEl['planning-trajectory-debt-direction'].innerHTML;
  ok(/data-trajectory-debt-direction="ready"/.test(ddHtml),
    'live debt direction block is marked ready');
  const h = traj.debtDirection.household || {};
  if (h.direction) {
    ok(new RegExp(`data-trajectory-debt-direction-household-direction="${h.direction}"`).test(ddHtml),
      'live household direction is copied');
    if (h.opening != null && isFinite(Number(h.opening))) {
      ok(ddHtml.includes(money2(h.opening)), 'live household opening is copied');
    }
    if (h.ending != null && isFinite(Number(h.ending))) {
      ok(ddHtml.includes(money2(h.ending)), 'live household ending is copied');
    }
  }
  if (traj.debtDirection.inventedBorrowing === false) {
    ok(/Invented borrowing/.test(ddHtml) && /no \(Forecast\)/.test(ddHtml),
      'live inventedBorrowing false is copied');
  }
  if (traj.debtDirection.availableCreditIsNotCash === true) {
    ok(/Available credit is not cash/.test(ddHtml),
      'live availableCreditIsNotCash is stated');
  }
  for (const kind of ['declining', 'persistent', 'increasing']) {
    const ids = Array.isArray(traj.debtDirection[kind]) ? traj.debtDirection[kind] : [];
    if (!ids.length) {
      ok(new RegExp(`data-trajectory-debt-direction-${kind}="none"`).test(ddHtml),
        `live: no ${kind} debts marker is present`);
    } else {
      ok(new RegExp(`data-trajectory-debt-direction-${kind}="ready"`).test(ddHtml),
        `live: ${kind} id list is present`);
      for (const id of ids) {
        ok(new RegExp(`data-trajectory-debt-direction-debt-id="${id}"`).test(ddHtml),
          `live: ${kind} list includes ${id}`);
      }
    }
  }
  ok(traj.debtDirection.debts.length > 0, 'live fixture has per-debt direction rows');
  for (let i = 0; i < traj.debtDirection.debts.length; i++) {
    const debt = traj.debtDirection.debts[i];
    const itemRe = new RegExp(
      `<li class="planning-trajectory-debt-direction-item"[^>]*data-trajectory-debt-direction-index="${i}"[^>]*>`);
    ok(itemRe.test(ddHtml), `live: debt direction row ${i} (${debt.id}) is present`);
    if (debt.direction) {
      ok(new RegExp(`data-trajectory-debt-direction-index="${i}"[^>]*data-trajectory-debt-direction-direction="${debt.direction}"`).test(ddHtml),
        `live: debt ${debt.id} direction ${debt.direction} is copied`);
    }
    if (debt.opening != null && isFinite(Number(debt.opening))) {
      ok(ddHtml.includes(money2(debt.opening)), `live: debt ${debt.id} opening is copied`);
    }
    if (debt.ending != null && isFinite(Number(debt.ending))) {
      ok(ddHtml.includes(money2(debt.ending)), `live: debt ${debt.id} ending is copied`);
    }
    if (debt.interest && debt.interest.status === 'calculated'
      && debt.interest.amount != null && isFinite(Number(debt.interest.amount))) {
      ok(ddHtml.includes(money2(debt.interest.amount)),
        `live: debt ${debt.id} interest amount is copied`);
    } else if (debt.interest && debt.interest.status === 'unavailable' && debt.interest.reason) {
      ok(ddHtml.includes(debt.interest.reason),
        `live: debt ${debt.id} unavailable interest prints reason, not $0`);
    }
    if (debt.milestone && debt.milestone.kind === 'cleared-within-published-horizon') {
      ok(new RegExp(`data-trajectory-debt-direction-milestone="${debt.milestone.kind}"`).test(ddHtml),
        `live: debt ${debt.id} cleared-within-published-horizon milestone is copied`);
      if (debt.milestone.month) {
        ok(new RegExp(`data-trajectory-debt-direction-milestone-month="${debt.milestone.month}"`).test(ddHtml),
          `live: debt ${debt.id} milestone month is copied`);
      }
    }
  }
  const debtOrder = [...ddHtml.matchAll(/data-trajectory-debt-direction-index="(\d+)"[^>]*data-trajectory-debt-direction-debt-id="([^"]+)"/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(m => m[2]);
  ok(debtOrder.join(',') === traj.debtDirection.debts.map(d => d.id).join(','),
    'live: per-debt order matches Forecast');

  const missingTraj = F.baselineTrajectory(null, [], live.meta.asOf, { periods });
  const missingDd = page.composeDebtDirection({ plan: null, debts: [], meta: { asOf: live.meta.asOf }, revolvingExtra: null }, periods);
  ok(missingTraj.debtDirection && missingTraj.debtDirection.status === 'unavailable',
    'missing plan debtDirection is unavailable on Forecast');
  ok(/data-trajectory-debt-direction="unavailable"/.test(missingDd.list),
    'unavailable debt direction is not rendered as an empty success');
  ok(missingDd.list.includes(missingTraj.debtDirection.reason),
    'unavailable debt direction prints Forecast debtDirection.reason');
  ok(/does not rank debts, recommend which debt to pay first, or compute direction/.test(missingDd.note),
    'debt direction footnote says the page does not compute direction');
}

console.log('\n=== 18. Trajectory three-stage funding reprints Forecast.baselineTrajectory stage1/2/3 ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/Forecast\.baselineTrajectory\(/.test(src),
    'funding reprint still uses the incumbent Forecast.baselineTrajectory call');
  ok(/planningTrajectoryFundingHtml\(/.test(src) && /month\.stage1/.test(src)
    && /month\.stage2/.test(src) && /month\.stage3/.test(src),
    'planning.js reprints month stage1 / stage2 / stage3 from Forecast only');
  ok(!/baselineTrajectoryMonthFunding/.test(src),
    'planning.js does not call the internal funding helper');
  ok(!/stage1Amount|stage2Amount|stage3Amount/.test(src),
    'planning.js does not recompute stage amounts');
  ok(!/baselineTrajectoryScenario|assistant-packet|\/talk\//.test(src),
    'planning.js does not touch scenario, packet, or Talk seams');
  ok(!/safe-to-spend|affordability|sustainable|breathing room/i.test(src),
    'funding copy carries no policy-threshold or comfort wording');

  const liveEl = page.render(live, periods);
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  ok(traj.status === 'ready' && traj.months.length > 0, 'live trajectory has months with funding stages');
  const pickMonth = traj.months[0];
  const fundingHtml = liveEl['planning-trajectory-funding'].innerHTML;
  ok(/data-trajectory-funding-month="/.test(fundingHtml),
    'live funding panel renders for a selected month');
  ok(/data-trajectory-funding-stage="1"/.test(fundingHtml)
    && /data-trajectory-funding-stage="2"/.test(fundingHtml)
    && /data-trajectory-funding-stage="3"/.test(fundingHtml),
    'live funding panel shows all three stages');
  ok(/Normal life/.test(fundingHtml) && /After planned spending/.test(fundingHtml)
    && /After debt strategy/.test(fundingHtml),
    'live funding uses Forecast stage labels');
  if (pickMonth.stage1 && pickMonth.stage1.result) {
    ok(fundingHtml.includes(money2(pickMonth.stage1.result.amount)),
      'live stage 1 result amount is copied from Forecast');
    if (pickMonth.stage1.result.status === 'estimated') {
      ok(/ESTIMATED/.test(fundingHtml), 'live estimated stage 1 stays estimated on the page');
    }
  }
  if (pickMonth.stage2 && pickMonth.stage2.result && isFinite(pickMonth.stage2.result.amount)) {
    ok(fundingHtml.includes(money2(pickMonth.stage2.result.amount)),
      'live stage 2 result amount is copied from Forecast');
  }
  if (pickMonth.stage3 && pickMonth.stage3.result && isFinite(pickMonth.stage3.result.amount)) {
    ok(fundingHtml.includes(money2(pickMonth.stage3.result.amount)),
      'live stage 3 result amount is copied from Forecast');
  }
  const unavailableMonth = traj.months.find(m => m.stage1 && m.stage1.status === 'unavailable');
  if (unavailableMonth) {
    const withheld = page.composeFunding(live, periods, unavailableMonth.month);
    ok(/data-trajectory-funding-stage-status="unavailable"/.test(withheld.panel),
      'unavailable month stage prints unavailable status');
    ok(unavailableMonth.stage1.reason && withheld.panel.includes(unavailableMonth.stage1.reason),
      'unavailable stage prints Forecast reason');
    ok(!new RegExp(`data-trajectory-funding-month="${unavailableMonth.month}"[\\s\\S]*?data-trajectory-funding-result="ready"[\\s\\S]*?<b>\\$0\\.00</b>`).test(withheld.panel),
      'unavailable funding is not printed as $0 surplus');
  }

  const composed = page.composeFunding({
    plan: null, debts: [], meta: { asOf: live.meta.asOf }, revolvingExtra: null,
  }, periods, null);
  ok(/data-trajectory-funding="unavailable"/.test(composed.panel),
    'missing trajectory funding is not rendered as an empty success');
  ok(/does not subtract stages, recompute funding/.test(composed.note),
    'funding footnote says the page does not recompute stages');

  const pressureStill = liveEl['planning-trajectory-pressure'].innerHTML;
  const ddStill = liveEl['planning-trajectory-debt-direction'].innerHTML;
  ok(/data-trajectory-pressure="ready"/.test(pressureStill) || /data-trajectory-pressure="empty"/.test(pressureStill),
    'pressure reprint remains after funding section');
  ok(/data-trajectory-debt-direction="ready"/.test(ddStill) || /data-trajectory-debt-direction="unavailable"/.test(ddStill),
    'debt direction reprint remains after funding section');
}

console.log('\n=== Page contract ===');
{
  const src = stripComments(read('public/planning.js'));
  ok(/App\.register\(renderPlanning\)/.test(src) && /App\.boot\(\{ periods: true \}\)/.test(src), 'planning.js registers on the shared boot and asks for periods');
  ok(!/fetch\(|XMLHttpRequest|require\(|data\.json/.test(src), 'planning.js fetches nothing itself');
  const html = read('public/planning.html');
  ok(/<h1>Planning<\/h1>/.test(html) && /Known future costs Atlas is protecting and planning for\./.test(html),
    'heading Planning with the plain-language lede');
  ok(!/\$\d|\d\.\d\d\b/.test(html.replace(/<meta[^>]*>/g, '')), 'planning.html hardcodes no figure');
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  ok(['planning-lede', 'planning-list', 'planning-note', 'planning-trajectory-lede', 'planning-trajectory', 'planning-trajectory-note', 'planning-trajectory-funding-lede', 'planning-trajectory-funding-picker', 'planning-trajectory-funding', 'planning-trajectory-funding-note', 'planning-trajectory-pressure-lede', 'planning-trajectory-pressure', 'planning-trajectory-pressure-note', 'planning-trajectory-debt-direction-lede', 'planning-trajectory-debt-direction', 'planning-trajectory-debt-direction-note'].every(id => ids.has(id)),
    'planning.html has every element planning.js writes to');
  ok(/<script src="\/forecast.js"><\/script>\s*<script src="\/planning.js">/.test(html), 'planning.html loads forecast.js before planning.js');
  ok(!/sports|Seattle|Christmas|couch|painting|Indio|Provincials|insurance|vehicle/i.test(stripComments(read('public/planning.js')) + html),
    'no example list is hardcoded in the page or script');
}

console.log('\n' + '═'.repeat(60));
if (failures) { console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`); process.exit(1); }
console.log('\x1b[32mALL CHECKS PASSED\x1b[0m');
