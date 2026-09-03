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
    `${helpers}\nconst $ = id => elements[id] || (elements[id] = { innerHTML: '', textContent: '' });\n${read(script)}`,
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
  ok(!/plan\.commitments|\.commitments\b/.test(src), 'planning.js never reads plan.commitments');
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
  ok(['planning-lede', 'planning-list', 'planning-note'].every(id => ids.has(id)), 'planning.html has every element planning.js writes to');
  ok(/<script src="\/forecast.js"><\/script>\s*<script src="\/planning.js">/.test(html), 'planning.html loads forecast.js before planning.js');
  ok(!/sports|Seattle|Christmas|couch|painting|Indio|Provincials|insurance|vehicle/i.test(stripComments(read('public/planning.js')) + html),
    'no example list is hardcoded in the page or script');
}

console.log('\n' + '═'.repeat(60));
if (failures) { console.log(`\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`); process.exit(1); }
console.log('\x1b[32mALL CHECKS PASSED\x1b[0m');
