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
  const advice = F.recommend(data.plan, data.meta.asOf, {
    fundingSources: data.plan && data.plan.funding && data.plan.funding.options,
    debts: data.debts || [],
    extraFacilities: data.revolvingExtra || [],
    periods: p || null,
  });
  const trajectory = F.baselineTrajectory(data.plan, data.debts || [], data.meta.asOf, { periods: p || null });
  advice.planSpendFundingPaths = F.planSpendFundingPaths(advice.majorPlans, trajectory);
  return advice;
}
function pageList(data, p) {
  return page.compose(adviceFrom(data, p), data.liveOverlay || null);
}

console.log('=== 1. Plan spend consumes Forecast.majorPlans and invents nothing ===');
{
  const src = stripComments(read('public/plan-spend.js'));
  ok(/Forecast\.recommend\(/.test(src) && /advice\.majorPlans/.test(src)
    && /Forecast\.planSpendFundingPaths\(/.test(src),
    'plan-spend.js reads majorPlans and Forecast funding explanations');
  ok(!/plan\.commitments/.test(src), 'plan-spend.js never reads plan.commitments');
  ok(!/Forecast\.(fundingSequence|majorPlans|simulate|expandEvents)\(/.test(src),
    'plan-spend.js does not calculate sequence, verdict, events, or walk');
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
  const liveAdvice = adviceFrom(live, periods);
  const liveCards = F.planSpendCards(liveAdvice.majorPlans);
  const summaryMembers = new Set(liveCards.filter(c => c.kind === 'summary')
    .flatMap(c => (c.members || []).map(m => m.id)));
  const unsettled = live.plan.commitments.filter(c => !F.commitmentSettledBy(c, live.meta.asOf));
  ok(unsettled.every(c => summaryMembers.has(c.id) || !!row(liveHtml, c.id)),
    `live: every unsettled commitment is a card or a summary member`);
  ok(liveCards.filter(c => c.kind === 'summary').every(c => {
    const card = row(liveHtml, c.id);
    return card && c.members.every(m => !row(liveHtml, m.id));
  }), 'live summary groups render one card and not one card per member');
}

console.log('\n=== 3. Points, ranges, timing, and truthful shortfall wording ===');
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
    const card = row(html, p.id);
    if (p.verdict === 'FUNDING GAP') {
      ok(card.split('<details')[0].includes(money2(p.remaining)),
        `${p.id} prints Forecast's funding shortfall ${money2(p.remaining)}`);
    } else {
      ok(!/Still unfunded in the plan|Covered in the plan/.test(card),
        `${p.id} does not recast Forecast remaining as saved money`);
    }
  }
}

console.log('\n=== 3b. Forecast date wins over approximate when; no invented dates ===');
{
  const timingSpan = html => {
    const m = /<span data-plan-spend-when>([^<]*)<\/span>/.exec(html || '');
    return m ? m[1] : null;
  };
  const adviceRow = extra => ({
    id: extra.id,
    label: extra.label,
    date: extra.date,
    when: extra.when,
    need: 1,
    remaining: 1,
    verdict: 'ON TRACK',
    flexibility: 'required',
    confidence: 'estimated',
  });
  const datedWithWhen = page.compose({
    majorPlans: [adviceRow({
      id: 'dated-with-when',
      label: 'Dated with month wording',
      date: '2026-12-09',
      when: 'Dec 2026',
    })],
    paydayAllocation: {},
    knowledge: {},
  }, null).list;
  const datedRow = row(datedWithWhen, 'dated-with-when');
  ok(/data-plan-spend-timing="dated"/.test(datedRow)
      && timingSpan(datedRow) === `Due ${longDate('2026-12-09')}`
      && timingSpan(datedRow) !== 'Dec 2026',
    'date 2026-12-09 wins over when Dec 2026 and prints the calendar date');
  ok(!/Dec 2026/.test(datedRow), 'approximate when is not printed beside a Forecast date');

  const christmas = page.compose({
    majorPlans: [adviceRow({
      id: 'dated-christmas',
      label: 'Dated holiday wording',
      date: '2026-12-25',
      when: 'by Christmas 2026',
    })],
    paydayAllocation: {},
    knowledge: {},
  }, null).list;
  const christmasRow = row(christmas, 'dated-christmas');
  ok(/data-plan-spend-timing="dated"/.test(christmasRow)
      && timingSpan(christmasRow) === `Due ${longDate('2026-12-25')}`
      && !/by Christmas 2026/.test(christmasRow),
    'date 2026-12-25 wins over when by Christmas 2026');

  const whenOnly = page.compose({
    majorPlans: [adviceRow({
      id: 'when-only',
      label: 'Approximate only',
      date: null,
      when: 'Dec 2026',
    })],
    paydayAllocation: {},
    knowledge: {},
  }, null).list;
  const whenRow = row(whenOnly, 'when-only');
  ok(/data-plan-spend-timing="approximate"/.test(whenRow) && timingSpan(whenRow) === 'Dec 2026',
    'when-only rows still print approximate when');
  ok(!whenRow.includes(longDate('2026-12-09'))
      && !whenRow.includes(longDate('2026-12-15'))
      && !whenRow.includes(longDate('2026-12-25'))
      && !/December/.test(whenRow),
    'no calendar day is invented from Dec 2026');

  const liveHtml = pageList(live, periods).list;
  const liveAdvice = adviceFrom(live, periods);
  const liveCards = F.planSpendCards(liveAdvice.majorPlans);
  const summaryMembers = new Set(liveCards.filter(c => c.kind === 'summary')
    .flatMap(c => (c.members || []).map(m => m.id)));
  const liveDated = liveAdvice.majorPlans.filter(p => p.date && !p.tripWindow && !summaryMembers.has(p.id));
  ok(liveDated.length > 0 && liveDated.every(p => {
    const r = row(liveHtml, p.id);
    return r && /data-plan-spend-timing="dated"/.test(r) && timingSpan(r) === `Due ${longDate(p.date)}`;
  }), `live: ${liveDated.length} Forecast-dated rows print fmtDateFull(date)`);
  const liveApprox = liveAdvice.majorPlans.filter(p => !p.date && p.when && !summaryMembers.has(p.id));
  ok(liveApprox.length > 0 && liveApprox.every(p => {
    const r = row(liveHtml, p.id);
    return r && /data-plan-spend-timing="approximate"/.test(r) && timingSpan(r) === p.when;
  }), `live: ${liveApprox.length} when-only rows print when verbatim`);
  const trip = liveAdvice.majorPlans.find(p => p.tripWindow);
  ok(trip && timingSpan(row(liveHtml, trip.id)) === `${trip.tripWindow} trip · Due ${longDate(trip.date)}`
      && /data-plan-spend-timing="trip-window"/.test(row(liveHtml, trip.id))
      && row(liveHtml, trip.id).includes(longDate(trip.date)),
    'a Forecast trip window and distinct cash due date appear in the glance');
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
  ok(!composed.lede.includes(money2(liveAdvice.knowledge.encumbered))
      && /does not mean the cash is already saved/.test(composed.lede),
    'the lede explains feasibility without exposing an internal protected-floor figure');
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
  ok(/id="plan-spend-list"[^>]*class="[^"]*\bplan-spend-list\b/.test(html),
    'the list mount carries plan-spend-list so the compact card rules apply');
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

console.log('\n=== 6. Summary cards reprint Forecast.planSpendCards; compact disclosure ===');
{
  const grouped = page.compose({
    majorPlans: [
      { id: 'a', group: 'g', groupLabel: 'Grouped cost', planSpendSummary: true, label: 'Part A', need: 1200, date: '2026-10-31', verdict: 'ON TRACK', remaining: 0, confidence: 'estimated', flexibility: 'required' },
      { id: 'b', group: 'g', groupLabel: 'Grouped cost', planSpendSummary: true, label: 'Part B', need: 900, date: '2026-12-31', verdict: 'ON TRACK', remaining: 0, confidence: 'estimated', flexibility: 'required' },
      { id: 'c', label: 'Solo', need: 10, when: 'timing TBD', verdict: 'FUNDING GAP', remaining: 10, confidence: 'estimated', flexibility: 'required' },
    ],
    paydayAllocation: {},
    knowledge: { encumbered: 1 },
  }, null).list;
  const cards = F.planSpendCards([
    { id: 'a', group: 'g', groupLabel: 'Grouped cost', planSpendSummary: true, label: 'Part A', need: 1200, date: '2026-10-31', verdict: 'ON TRACK', remaining: 0, confidence: 'estimated', flexibility: 'required' },
    { id: 'b', group: 'g', groupLabel: 'Grouped cost', planSpendSummary: true, label: 'Part B', need: 900, date: '2026-12-31', verdict: 'ON TRACK', remaining: 0, confidence: 'estimated', flexibility: 'required' },
    { id: 'c', label: 'Solo', need: 10, when: 'timing TBD', verdict: 'FUNDING GAP', remaining: 10, confidence: 'estimated', flexibility: 'required' },
  ]);
  const summary = cards.find(c => c.kind === 'summary');
  const independent = 1200 + 900;
  ok(summary && summary.scheduleRemaining === independent,
    'Forecast.planSpendCards schedule remaining is the independent sum of published needs',
    summary && String(summary.scheduleRemaining));
  ok(!!row(grouped, 'g') && !row(grouped, 'a') && !row(grouped, 'b') && !!row(grouped, 'c'),
    'the page prints one summary card plus the ungrouped row');
  const card = row(grouped, 'g');
  ok(card && card.includes(money2(independent)) && card.includes('data-plan-spend-member="a"')
      && card.includes('data-plan-spend-member="b"') && card.includes(money2(1200))
      && card.includes(money2(900)),
    'the summary reprints the Forecast sum and each member amount');
  const glance = card.split('<details')[0];
  ok(glance.includes(money2(independent)) && !glance.includes(money2(1200)) && !glance.includes(money2(900)),
    'member amounts stay behind the disclosure; the glance shows the summary once');
  ok(summary && summary.verdict === 'ON TRACK'
      && /data-plan-spend-verdict="ON TRACK"/.test(glance)
      && /class="[^"]*\bon-track\b/.test(card.split('>')[0]),
    'same-verdict members still publish ON TRACK on the grouped glance');
  ok(/<details class="plan-spend-more">/.test(card) && /class="plan-spend-glance"/.test(card),
    'summary card uses the compact glance plus a disclosure');
  const mixedMembers = [
    { id: 'fusion-oct', group: 'fusion-household', groupLabel: 'Fusion Lacrosse', planSpendSummary: true, label: 'October', need: 1200, date: '2026-10-31', verdict: 'FUNDING GAP', remaining: 1200, confidence: 'confirmed', flexibility: 'required' },
    { id: 'fusion-nov', group: 'fusion-household', groupLabel: 'Fusion Lacrosse', planSpendSummary: true, label: 'November', need: 1200, date: '2026-11-30', verdict: 'ON TRACK', remaining: 0, confidence: 'confirmed', flexibility: 'required' },
    { id: 'fusion-dec', group: 'fusion-household', groupLabel: 'Fusion Lacrosse', planSpendSummary: true, label: 'December', need: 900, date: '2026-12-31', verdict: 'ON TRACK', remaining: 0, confidence: 'confirmed', flexibility: 'required' },
  ];
  const mixedCards = F.planSpendCards(mixedMembers);
  const mixedSummary = mixedCards.find(c => c.kind === 'summary');
  const mixedHtml = page.compose({
    majorPlans: mixedMembers,
    paydayAllocation: {},
    knowledge: { encumbered: 1 },
  }, null).list;
  const mixedCard = row(mixedHtml, 'fusion-household');
  const mixedGlance = mixedCard ? mixedCard.split('<details')[0] : '';
  ok(mixedSummary && mixedSummary.verdict === 'FUNDING GAP'
      && mixedSummary.members.map(m => m.verdict).join(',') === 'FUNDING GAP,ON TRACK,ON TRACK',
    'Forecast.planSpendCards publishes the FUNDING GAP member verdict on a mixed group');
  ok(/data-plan-spend-verdict="FUNDING GAP"/.test(mixedGlance)
      && /class="[^"]*\bfunding-gap\b/.test((mixedCard || '').split('>')[0])
      && /<span class="chip c">FUNDING SHORTFALL<\/span>/.test(mixedGlance),
    'mixed FUNDING GAP + ON TRACK shows the gap chip and card styling on the glance, without opening Details');
  const css = read('public/styles.css');
  ok(/\.plan-spend-list \.plan-spend-card \{\s*padding:14px 16px;/.test(css)
      && /grid-template-columns:minmax\(0,1fr\) auto;/.test(css)
      && /@media \(max-width:380px\)/.test(css),
    'plan spend cards separate facts and adapt on narrow widths');
}

console.log('\n=== 7. Forecast-owned funding explanation and household wording ===');
{
  const trip = { id: 'trip', label: 'Fixture trip', need: 100, date: '2026-04-10',
    verdict: 'ON TRACK', remaining: 0, confidence: 'confirmed' };
  const pressurePeriod = {
    start: '2026-04-03', end: '2026-04-16',
    stage2: { commitments: { lines: [{ id: 'trip', date: trip.date, amount: 100 }] } },
    stage3: { result: { amount: -50, status: 'estimated',
      identity: 'standalone-period-surplus-deficit' } },
  };
  const path = F.planSpendFundingPaths([trip], { status: 'ready', payPeriods: [pressurePeriod] })[0];
  ok(path && path.allocation === 'unallocated' && path.setAsideNow === null
      && path.futureCashFlowNeeded === null && path.duePeriod.amount === -50
      && path.duePeriod.kind === 'shortfall',
    'Forecast links a due cash event while leaving unproven savings and future-flow amounts unknown');
  const rendered = page.compose({ majorPlans: [trip], planSpendFundingPaths: [path] }, null).list;
  const glance = row(rendered, 'trip').split('<details')[0];
  ok(/data-plan-spend-verdict="ON TRACK"/.test(glance)
      && /FEASIBLE IN CURRENT PLAN/.test(glance) && !/>ON TRACK</.test(glance),
    'internal ON TRACK remains unchanged while the household sees feasible wording');
  ok(glance.includes('−$50.00 shortfall') && glance.includes('Current Forecast can cover this by the deadline.')
      && /data-plan-spend-period-status="estimated"/.test(glance) && />ESTIMATED<\/span>/.test(glance),
    'a due-period shortfall coexists with feasibility and keeps its own estimated trust');
  ok(/Set-aside amount now<\/dt><dd>Not established<\/dd>/.test(glance)
      && /Still needed from future cash flow<\/dt><dd>Not established<\/dd>/.test(glance)
      && !/\$0\.00/.test(glance),
    'absence does not become $0 saved or $0 future need');
  ok(/Show funding path/.test(rendered) && /path is unallocated/.test(rendered)
      && !/\+\$\d.*toward Fixture trip/.test(rendered),
    'funding path explains the unallocated cash path without a made-up contribution schedule');
  const noLine = F.planSpendFundingPaths([trip], { status: 'ready', payPeriods: [
    Object.assign({}, pressurePeriod, { stage2: { commitments: { lines: [{ id: 'other', date: trip.date }] } } }),
  ] })[0];
  const undated = F.planSpendFundingPaths([Object.assign({}, trip, { date: null })],
    { status: 'ready', payPeriods: [pressurePeriod] })[0];
  ok(noLine.duePeriod === null && undated.duePeriod === null,
    'a period requires the exact cash event and an undated plan gets no invented due-period result');
  const gap = Object.assign({}, trip, { id: 'gap', verdict: 'FUNDING GAP', remaining: 25 });
  const risk = Object.assign({}, trip, { id: 'risk', verdict: 'AT RISK', remaining: 25,
    amountMin: 100, amountMax: 125, need: null });
  const adverse = page.compose({ majorPlans: [gap, risk] }, null).list;
  ok(/FUNDING SHORTFALL/.test(row(adverse, 'gap').split('<details')[0])
      && row(adverse, 'gap').includes('$25.00')
      && /this cost is short by \$25\.00/.test(row(adverse, 'gap'))
      && /AT RISK/.test(row(adverse, 'risk').split('<details')[0])
      && /protected uncertainty/.test(row(adverse, 'risk')),
    'gap stays conspicuous and AT RISK retains protected-uncertainty meaning');
  const css = read('public/styles.css');
  ok(/\.plan-spend-facts dt/.test(css) && /\.plan-spend-facts dd/.test(css)
      && /\.plan-spend-facts \{ grid-template-columns:1fr; \}/.test(css)
      && !/NoneNo|Projected available by deadline/.test(rendered),
    'mobile facts use separate label and value elements without concatenated legacy copy');
}

console.log('\n=== 8. Current canonical Road Ahead reprint reconciles ===');
{
  const advice = adviceFrom(live, periods);
  const trajectory = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, { periods });
  const seattle = advice.majorPlans.find(p => p.id === 'seattle-nov');
  const sanDiego = advice.majorPlans.find(p => p.id === 'san-diego');
  const seattlePeriod = trajectory.payPeriods.find(p => p.start <= seattle.date && seattle.date <= p.end);
  const sanPeriod = trajectory.payPeriods.find(p => p.start <= sanDiego.date && sanDiego.date <= p.end);
  const independentResult = p => p.stage1.income.amount - p.stage1.bills.amount
    - p.stage1.obligations.amount - p.stage1.householdBudget.amount
    - p.stage2.commitments.amount - p.stage3.extras.amount;
  ok(Math.abs(independentResult(seattlePeriod) - seattlePeriod.stage3.result.amount) < 0.005
      && Math.abs(independentResult(sanPeriod) - sanPeriod.stage3.result.amount) < 0.005,
    'Road Ahead due-period results reconcile to independently summed published components');
  const html = pageList(live, periods).list;
  ok(seattle.verdict === 'ON TRACK' && sanDiego.verdict === 'ON TRACK'
      && row(html, 'seattle-nov').includes(`+${money2(seattlePeriod.stage3.result.amount)} surplus`)
      && row(html, 'san-diego').includes(`${money2(sanPeriod.stage3.result.amount)} shortfall`),
    'canonical Seattle and San Diego cards copy their own Road Ahead pay-period results');
  ok(!/silver/i.test(read('public/plan-spend.js'))
      && !advice.planSpendFundingPaths.some(path => path.setAsideNow != null),
    'silver is not a funding source and no canonical plan-specific saved amount is invented');
}

console.log('\n=== 9. Shared overdue aggregate and carried residual due period ===');
{
  const asOf = '2026-11-16';
  const plan = JSON.parse(JSON.stringify(live.plan));
  plan.opening = Object.assign({}, plan.opening, {
    asOf,
    priorAsOf: live.plan.opening.asOf,
  });
  const advanced = {
    meta: { asOf },
    plan,
    debts: live.debts,
    revolvingExtra: live.revolvingExtra || [],
  };
  const advice = adviceFrom(advanced, periods);
  const overdueIds = ['burrards-team-fees', 'fusion-household-oct', 'seattle-nov'];
  const overdue = overdueIds.map(id => advice.majorPlans.find(p => p.id === id));
  const seattlePlan = overdue[2];
  const shared = overdue[0] && overdue[0].remaining;
  ok(overdue.every(p => p && p.verdict === 'FUNDING GAP'
      && p.remainingIdentity === 'joint-protected-overdue-shortfall'
      && p.remaining === shared),
    'Burrards, Fusion October, and Seattle November publish one joint overdue shortfall');
  ok(seattlePlan && seattlePlan.need === 1500 && shared !== seattlePlan.need && shared > seattlePlan.need,
    'that shared amount is not Seattle November\'s own $1,500 cost',
    seattlePlan && `${shared} vs need ${seattlePlan.need}`);
  const html = page.compose(advice, null).list;
  const member = id => {
    const re = new RegExp(`data-plan-spend-member="${id}"[\\s\\S]*?<\\/li>`);
    const m = re.exec(html);
    return m ? m[0] : row(html, id);
  };
  ok(overdue.every(p => {
    const card = member(p.id) || '';
    return /shared overdue funding shortfall/i.test(card)
      && !/this cost is short by/.test(card);
  }), 'no overdue protected row describes the shared aggregate as its private shortfall');
  ok(/not this cost's private shortfall/i.test(row(html, 'seattle-nov') || '')
      && /not this cost's private shortfall/i.test(row(html, 'burrards-team-fees') || ''),
    'individual overdue cards name the shared aggregate and deny a private shortfall');
  const later = advice.majorPlans.find(p => p.id === 'seattle-dec');
  ok(later && later.remainingIdentity == null
      && /this cost is short by/.test(row(html, 'seattle-dec') || ''),
    'a later dated cost keeps its own Forecast shortfall wording');
  const trajectory = F.baselineTrajectory(plan, live.debts, asOf, { periods });
  const residual = (trajectory.payPeriods || []).find(p => p.windowKind === 'as-of-residual' && p.start === asOf);
  const line = residual && residual.stage2 && residual.stage2.commitments
    && (residual.stage2.commitments.lines || []).find(l => l && l.id === 'seattle-nov' && l.date === seattlePlan.date);
  ok(residual && residual.start === '2026-11-16' && residual.end === '2026-11-19'
      && line && seattlePlan.date < residual.start,
    'the clipped residual carries Seattle November with its original Stage 2 date');
  const path = advice.planSpendFundingPaths.find(p => p.id === 'seattle-nov');
  ok(path && path.duePeriod && path.duePeriod.start === residual.start
      && path.duePeriod.end === residual.end
      && path.duePeriod.amount === residual.stage3.result.amount
      && path.duePeriod.identity === 'standalone-period-surplus-deficit'
      && path.setAsideNow === null && path.futureCashFlowNeeded === null,
    'the carried cost links to that residual period\'s published Stage 3 result');
  ok((row(html, 'seattle-nov') || '').includes(money2(residual.stage3.result.amount))
      && !/remaining\s*[-+*/]/.test(stripComments(read('public/plan-spend.js'))),
    'the card reprints the published Stage 3 amount and the page does no remaining arithmetic');

  const canonAdvice = adviceFrom(live, periods);
  const canonTrajectory = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, { periods });
  const canonSea = canonAdvice.majorPlans.find(p => p.id === 'seattle-nov');
  const canonSd = canonAdvice.majorPlans.find(p => p.id === 'san-diego');
  const canonSeaPath = canonAdvice.planSpendFundingPaths.find(p => p.id === 'seattle-nov');
  const canonSdPath = canonAdvice.planSpendFundingPaths.find(p => p.id === 'san-diego');
  const canonSeaPeriod = canonTrajectory.payPeriods.find(p => p.start <= canonSea.date && canonSea.date <= p.end);
  const canonSdPeriod = canonTrajectory.payPeriods.find(p => p.start <= canonSd.date && canonSd.date <= p.end);
  ok(canonSea.verdict === 'ON TRACK' && canonSd.verdict === 'ON TRACK'
      && canonSea.remainingIdentity == null && canonSd.remainingIdentity == null
      && canonSeaPath.duePeriod.amount === 220.62
      && canonSdPath.duePeriod.amount === -1934.62
      && canonSeaPath.duePeriod.amount === canonSeaPeriod.stage3.result.amount
      && canonSdPath.duePeriod.amount === canonSdPeriod.stage3.result.amount
      && canonSea.date >= canonSeaPath.duePeriod.start
      && canonSea.date <= canonSeaPath.duePeriod.end,
    'canonical in-window Seattle +$220.62 and San Diego −$1,934.62 still match their published periods');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
