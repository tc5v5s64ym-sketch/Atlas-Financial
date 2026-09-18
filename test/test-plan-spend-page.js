'use strict';
/* Plan spend — isolated reprint of Forecast.majorPlans. `node test/test-plan-spend-page.js`
 *
 * The page renders Forecast.majorPlans (plus the matching
 * Forecast.paydayAllocation row) from the same Forecast.recommend call the
 * Plan page, Forecast composer, and the assistant packet use. This suite
 * runs the real plan-spend.js in a vm with the real app.js formatters and a
 * stub App, and reads the HTML the household would read. Behaviour uses a
 * synthetic fixture whose verdicts and amounts are forced by construction;
 * live data.json proves settled-row exclusion and field pass-through against
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
    `${helpers}\nfunction stubEl(){ const attrs = {}; return { innerHTML: '', textContent: '', querySelector(){return null;}, querySelectorAll(){return [];}, classList:{toggle(){},add(){},remove(){}}, setAttribute(k,v){ attrs[k]=v; }, getAttribute(k){ return attrs[k] != null ? attrs[k] : null; } }; }\nconst $ = id => elements[id] || (elements[id] = stubEl());\n${read(script)}`,
    ctx, { filename: script });
  return {
    ctx,
    render(data, p) {
      for (const k of Object.keys(elements)) delete elements[k];
      for (const fn of ctx.App.hooks) fn(data, p || null, null);
      return elements;
    },
    compose(advice, liveOverlay) { return ctx.planSpendPageHtml(advice, liveOverlay); },
  };
}

function row(html, id) {
  const re = new RegExp(`<article class="planning-row[^"]*" data-plan-spend-id="${id}"[\\s\\S]*?<\\/article>`);
  const m = re.exec(html);
  return m ? m[0] : null;
}
function factOf(rowHtml, name) {
  const re = new RegExp(`<div data-plan-spend-fact="${name}">[\\s\\S]*?<\\/div>`);
  const m = re.exec(rowHtml || '');
  return m ? m[0] : null;
}
const ids = html => [...String(html || '').matchAll(/data-plan-spend-id="([^"]+)"/g)].map(m => m[1]);

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

const page = loadPage('public/plan-spend.js');
function adviceFrom(data, p) {
  return F.recommend(data.plan, data.meta.asOf, {
    fundingSources: data.plan && data.plan.funding && data.plan.funding.options,
    debts: data.debts || [],
    extraFacilities: data.revolvingExtra || [],
    periods: p || null,
  });
}
function pageList(data, p) {
  return page.compose(adviceFrom(data, p), data.liveOverlay || null);
}

console.log('=== 1. Plan spend consumes Forecast.majorPlans and invents nothing ===');
{
  const src = stripComments(read('public/plan-spend.js'));
  ok(/Forecast\.recommend\(/.test(src) && /advice\.majorPlans/.test(src) && /advice\.paydayAllocation/.test(src),
    'plan-spend.js reads majorPlans and paydayAllocation off Forecast.recommend');
  ok(!/plan\.commitments/.test(src), 'plan-spend.js never reads plan.commitments');
  ok(!/Forecast\.(fundingSequence|majorPlans|simulate|expandEvents|baselineTrajectory)\(/.test(src),
    'plan-spend.js does not call the sequence, walk, or trajectory itself');
  const verdictAssign = /verdict\s*=\s*['"](ON TRACK|AT RISK|FUNDING GAP)['"]/.test(src)
    || /['"](ON TRACK|AT RISK|FUNDING GAP)['"]\s*:\s*\(?\s*\w*\s*(>|<|>=|<=|-|\+)/.test(src);
  ok(!verdictAssign, 'no verdict is computed in the page; the three strings appear only as presentation keys');
  ok(!/remaining\s*[-+*/]=|\.need\s*[-+*/]|\.amountMin\s*[-+*/]|\.amountMax\s*[-+*/]|\/\s*2/.test(src),
    'no arithmetic on need, remaining or range bounds');
  ok(!/new Date\(\)|Date\.now|localStorage/.test(src), 'no browser clock and no persisted knob');
  const fx = fixture();
  const composed = pageList(fx, null);
  const advice = adviceFrom(fx, null);
  const rendered = ids(composed.list);
  ok(JSON.stringify(rendered) === JSON.stringify(advice.majorPlans.map(p => p.id)),
    'rows are exactly Forecast.majorPlans, in Forecast order', rendered.join(','));
  for (const p of advice.majorPlans) {
    ok(new RegExp(`data-plan-spend-verdict="${p.verdict}"`).test(row(composed.list, p.id)),
      `${p.id} prints Forecast's verdict ${p.verdict}`);
  }
}

console.log('\n=== 2. Unsettled plans render; settled commitments are absent ===');
{
  const html = pageList(fixture(), null).list;
  ok(['dated-point', 'point', 'range', 'tbd', 'optional'].every(id => row(html, id)), 'every unsettled row renders');
  ok(!row(html, 'settled-camp') && !/Settled camp/.test(html), 'a settledOn ≤ as-of commitment does not appear');
  const later = fixture();
  later.plan.commitments.find(c => c.id === 'settled-camp').settledOn = '2026-03-20';
  const laterHtml = pageList(later, null).list;
  ok(!!row(laterHtml, 'settled-camp'), 'a commitment settled after as-of still renders (Forecast rule)');
  const liveHtml = pageList(live, periods).list;
  const settled = live.plan.commitments.filter(c => F.commitmentSettledBy(c, live.meta.asOf));
  ok(settled.length > 0 && settled.every(c => !row(liveHtml, c.id) && !liveHtml.includes(c.label)),
    `live: ${settled.length} settled commitments are absent`);
  const unsettled = live.plan.commitments.filter(c => !F.commitmentSettledBy(c, live.meta.asOf));
  ok(unsettled.every(c => !!row(liveHtml, c.id)), `live: all ${unsettled.length} unsettled commitments render`);
}

console.log('\n=== 3. Points, ranges, approximate timing, and Forecast remaining reprint ===');
{
  const html = pageList(fixture(), null).list;
  const point = row(html, 'point');
  ok(/data-plan-spend-amount="point"/.test(point) && strip(factOf(point, 'requirement')).includes('$2,000.00 Cost'),
    'a point estimate prints as one amount');
  const range = row(html, 'range');
  ok(/data-plan-spend-amount="range"/.test(range) && /\$700\.00–\$1,200\.00/.test(range) && /Cost range/.test(range),
    'a range prints as $700.00–$1,200.00');
  ok(!/\$950/.test(range), 'no midpoint is printed for the range');
  ok(/data-plan-spend-timing="approximate"/.test(point) && /<span data-plan-spend-when>late Sep 2026<\/span>/.test(point),
    '"late Sep 2026" is printed as stated');
  ok(!/September|October|November|\d{1,2} (Sep|Oct|Nov)/.test(strip(point) + strip(range)),
    'no calendar day is invented from approximate timing');
  const dated = row(html, 'dated-point');
  ok(/data-plan-spend-timing="dated"/.test(dated) && strip(dated).includes(longDate('2026-04-10')),
    'a dated commitment prints its Forecast date');
  const advice = adviceFrom(fixture(), null);
  for (const p of advice.majorPlans) {
    ok(strip(factOf(row(html, p.id), 'remaining')).startsWith(money2(p.remaining)),
      `${p.id} prints Forecast remaining ${money2(p.remaining)} unchanged`);
  }
}

console.log('\n=== 4. Fail-closed empty / unavailable; no invented saved balance ===');
{
  const withheld = page.compose(
    { operatingPlanUnavailable: true, operatingPlanNote: 'Current plan unavailable — test.' },
    { operatingPlan: 'unavailable' });
  ok(/data-operating-plan="unavailable"/.test(withheld.list) && !/data-plan-spend-id/.test(withheld.list),
    'when Forecast withholds the current operating plan, no commitment row is printed');
  const empty = page.compose({ majorPlans: [], paydayAllocation: {}, knowledge: {} }, null);
  ok(/data-plan-spend="empty"/.test(empty.list) && !/data-plan-spend-id/.test(empty.list),
    'an empty Forecast.majorPlans list fail-closes empty rather than inventing rows');
  const composed = pageList(live, periods);
  const html = composed.list + composed.lede + composed.note;
  ok(!/Saved \$|saved so far|\bSaved\b.*\$0/i.test(html), 'no invented saved-so-far figure');
  const src = stripComments(read('public/plan-spend.js'));
  ok(!/savedSoFar|\.sort\(|reverse\(\)|priority/.test(src),
    'plan-spend.js does not sort, reverse, or read priority; Forecast order is rendered');
  const liveAdvice = adviceFrom(live, periods);
  const pointTotal = liveAdvice.majorPlans.filter(p => p.need != null).reduce((s, p) => s + p.need, 0);
  ok(!html.includes(money2(pointTotal)),
    `the page does not print an independent total of point estimates (${money2(pointTotal)})`);
  ok(composed.lede.includes(money2(liveAdvice.knowledge.encumbered))
      && /protected floor, not a total/.test(composed.lede),
    'the only aggregate is Forecast knowledge.encumbered');
}

console.log('\n=== 5. Page contract and dock chrome ===');
{
  const src = stripComments(read('public/plan-spend.js'));
  ok(/App\.register\(renderPlanSpend\)/.test(src) && /App\.boot\(\{ periods: true \}\)/.test(src),
    'plan-spend.js registers on the shared boot and asks for periods');
  ok(!/fetch\(|XMLHttpRequest|require\(|data\.json/.test(src), 'plan-spend.js fetches nothing itself');
  const html = read('public/plan-spend.html');
  ok(/<title>Household finances — plan spend<\/title>/.test(html)
      && /<h1>Plan spend<\/h1>/.test(html)
      && /data-page-shell="plan-spend"/.test(html),
    'the page identifies itself as Plan spend');
  ok(/<div class="kicker">Plan spend<\/div>/.test(html), 'static page kicker is Plan spend');
  ok(/href="\/planning.html">Forecast<\/a>/.test(html),
    'Plan spend points at Forecast for the funding story');
  ok(!/\$\d|\d\.\d\d\b/.test(html.replace(/<meta[^>]*>/g, '')), 'plan-spend.html hardcodes no figure');
  const mounts = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  ok(mounts.has('plan-spend-lede') && mounts.has('plan-spend-list') && mounts.has('plan-spend-note'),
    'plan-spend.html mounts lede, list and note');
  ok(/<script src="\/forecast.js"><\/script>\s*<script src="\/plan-spend.js">/.test(html),
    'plan-spend.html loads forecast.js before plan-spend.js');
  ok(!/Fusion|Berard|Indio|Seattle|Christmas|couch|painting/i.test(stripComments(read('public/plan-spend.js')) + html),
    'no example commitment list is hardcoded');
  const rendered = page.render(live, periods);
  ok(rendered['plan-spend-list'] && /data-plan-spend-id=/.test(rendered['plan-spend-list'].innerHTML),
    'renderPlanSpend fills the list from Forecast.majorPlans on live data');
  const nav = /<nav class="sitenav(?: [^"]*)?" aria-label="Pages">([\s\S]*?)<\/nav>/.exec(html);
  const links = [...(nav ? nav[1] : '').matchAll(/class="sitenav-label"[^>]*>([^<]+)</g)].map(m => m[1]);
  ok(JSON.stringify(links) === JSON.stringify(['Budget', 'Forecast', 'Bills', 'Subscriptions', 'Credit', 'Plan spend']),
    'Plan spend dock is Budget | Forecast | Bills | Subscriptions | Credit | Plan spend');
  ok(!/Talk/.test(nav ? nav[1] : ''), 'Talk is not on the Plan spend dock');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
