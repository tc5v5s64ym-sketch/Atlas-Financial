'use strict';
/* Planning — Your Financial Road Ahead phone-native presentation.
 *
 * Proves the mobile shell is presentation-only: Forecast figures are reprinted,
 * not recomputed; Month/Pay period controls stay authoritative; timeline selection
 * stays semantically accessible; household bottom dock rules are unchanged.
 */
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
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stripComments = src => String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function mobilePlanningRoadBlock(css) {
  const start = css.indexOf('/* Planning — Road Ahead phone-native shell');
  if (start < 0) return '';
  const end = css.indexOf('@media (min-width:641px) {\n  .planning-list', start);
  return end > start ? css.slice(start, end) : css.slice(start);
}

function loadPage() {
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
    `${helpers}\nfunction planningStubEl(){ const attrs = {}; return { innerHTML: '', textContent: '', querySelector(){return null;}, querySelectorAll(){return [];}, classList:{toggle(){},add(){},remove(){}}, setAttribute(k,v){ attrs[k]=v; }, getAttribute(k){ return attrs[k] != null ? attrs[k] : null; } }; }\nconst $ = id => elements[id] || (elements[id] = planningStubEl());\n${read('public/planning.js')}`,
    ctx, { filename: 'public/planning.js' });
  return {
    ctx,
    render(data, p) {
      for (const k of Object.keys(elements)) delete elements[k];
      elements.asof = {
        textContent: `As at ${data.meta.asOf}`,
        innerHTML: `As at ${data.meta.asOf}`,
      };
      for (const fn of ctx.App.hooks) fn(data, p || null, null);
      return elements;
    },
    composeRoad(data, p, granularity, periodKey, asOf) {
      return ctx.planningRoadAheadHtml(
        ctx.planningTrajectory(data, p || null),
        granularity || 'month',
        periodKey,
        asOf || data.meta.asOf,
      );
    },
    composeRoadTraj(traj, granularity, periodKey, asOf) {
      return ctx.planningRoadAheadHtml(traj, granularity || 'month', periodKey, asOf);
    },
  };
}

/* A Forecast-shaped publication with one funding-gap month, so the gap hero and
 * the gap stage story can be proved without waiting for live data to turn
 * negative. Stage figures are internally consistent the way Forecast's own
 * identity is: stage2 = stage1 − commitments, stage3 = stage2 − extras. */
function gapTrajectory(baseTraj, month) {
  const traj = JSON.parse(JSON.stringify(baseTraj));
  const row = traj.months.find(m => m.month === month);
  row.stage1.result = { amount: 1041, status: 'calculated' };
  row.stage2.commitments = { amount: 1400, status: 'estimated' };
  row.stage2.result = { amount: -359, status: 'calculated' };
  row.stage3.extras = { amount: 600, status: 'calculated', source: 'plan.defaults.extraDebtMonthly' };
  row.stage3.result = { amount: -959, status: 'calculated' };
  return { traj, row };
}

const page = loadPage();
const css = read('public/styles.css');
const mobile = mobilePlanningRoadBlock(css);
const planningSrc = stripComments(read('public/planning.js'));

console.log('=== 1. Mobile shell markup and viewport priority ===');
{
  const html = read('public/planning.html');
  ok(/viewport-fit=cover/.test(html), 'planning.html keeps viewport-fit=cover for safe-area');
  ok(/id="planning-road-ahead"/.test(html), 'road-ahead mount exists on planning.html');
  ok(/sitenav-household/.test(html), 'planning reuses incumbent household bottom dock');

  const liveEl = page.render(live, periods);
  const road = liveEl['planning-road-ahead'].innerHTML;
  ok(/data-planning-road-shell="ready"/.test(road), 'render wraps road-ahead in phone-native shell');
  ok(/planning-road-app-head/.test(road), 'shell includes compact page identity header');
  ok(/planning-road-app-eyebrow">PLANNING</.test(road)
    && /<h2 class="planning-road-app-title">Road Ahead</.test(road),
    'Frame 01 identity is PLANNING eyebrow plus Road Ahead title');
  ok(/planning-road-hero-eyebrow/.test(road)
    && /NEXT FUNDING GAP|NEXT PRESSURE/.test(road),
    'Frame 01 hero uses NEXT FUNDING GAP or NEXT PRESSURE language');
  ok(/planning-road-segmented/.test(road)
    && />Month</.test(road) && />Pay period</.test(road)
    && /data-trajectory-funding-granularity="month"/.test(road)
    && /data-trajectory-funding-granularity="pay-period"/.test(road),
    'Frame 01 Month | Pay period segmented control is present');
  ok(/role="tablist"/.test(road) && /role="tab"/.test(road)
    && /aria-selected="true"/.test(road) && /aria-selected="false"/.test(road)
    && /id="planning-road-view-panel"/.test(road) && /role="tabpanel"/.test(road),
    'DESIGN §8 segmented control uses tablist semantics over the trajectory panel');
  ok(/planning-road-spine/.test(road)
    && /Normal life/.test(road)
    && /After planned spending/.test(road)
    && /After debt strategy/.test(road)
    && /planning-road-spine-index/.test(road)
    && /Projected [A-Z][a-z]+ result|Projected result/.test(road),
    'Frame 03 vertical numbered spine uses household stage titles plus projected-result bar');
  ok(/planning-road-horizon-stats/.test(road)
    && /data-road-horizon-stat="surplus"/.test(road)
    && /data-road-horizon-stat="gap"/.test(road),
    'horizon band keeps Fable surplus/gap shape while counts stay unavailable');
  ok(!/About this view/.test(road) && !/planning-road-app-asof/.test(road),
    'road-ahead shell strips About this view and dense as-of chrome');
  ok(/data-planning-road-primary="lead"/.test(road), 'lead card is in the primary viewport band');
  ok(/data-planning-road-primary="counts-and-strip"/.test(road)
    && /data-planning-road-primary="horizon"/.test(road)
    && /data-planning-road-horizon="unavailable"/.test(road),
    'horizon band is present but fail-closed until Forecast publishes surplus/gap counts');
  ok(/has not published surplus and funding-gap counts/i.test(road),
    'horizon band explains Forecast has not published surplus/gap counts');
  ok(/data-planning-road-primary="strip"/.test(road), 'trajectory strip is a named primary band');
  ok(/data-planning-road-primary="stages"/.test(road) && /data-planning-road-stages="ready"/.test(road),
    'three-stage story is its own primary band');
  ok(/data-planning-road-primary="breakdown"/.test(road) && /data-planning-road-breakdown="sheet"/.test(road),
    'progressive breakdown sheet follows the stage story');
  const htmlStatic = read('public/planning.html');
  ok(!/baseline walk|published horizon|legacy layout|full table/i.test(htmlStatic),
    'planning.html static copy follows DESIGN glossary');
  const leadAt = road.indexOf('data-planning-road-primary="lead"');
  const horizonAt = road.indexOf('data-planning-road-primary="horizon"');
  const stripAt = road.indexOf('data-planning-road-primary="strip"');
  const stagesAt = road.indexOf('data-planning-road-primary="stages"');
  const breakdownAt = road.indexOf('data-planning-road-primary="breakdown"');
  const whatifAt = road.indexOf('data-planning-road-primary="whatif"');
  ok(leadAt >= 0 && horizonAt > leadAt && stripAt > horizonAt && stagesAt > stripAt
    && breakdownAt > stagesAt && whatifAt > breakdownAt,
    'phone order is hero → horizon → strip → stages → breakdown → quarantined what-if');
  const scenarioAt = road.indexOf('data-trajectory-scenario-section="controls"');
  ok(scenarioAt === whatifAt || scenarioAt > breakdownAt,
    'hypothetical scenario sits below breakdown on the phone-first stack');
  ok(!/sustainable|on track|safe to spend|key takeaway|what can you do/i.test(road),
    'road-ahead shell renders no forbidden verdict copy');
  ok(!/baseline walk|published horizon|legacy layout|full table/i.test(road),
    'road-ahead shell avoids DESIGN glossary banned phrases');
  ok(/data-trajectory-scenario-preview="idle"/.test(road)
    && /planning-road-whatif-preview/.test(road),
    'idle what-if preview shows em-dash placeholders until user runs a scenario');
  ok(/planning-road-hero-card/.test(road) && /planning-road-fable-stage/.test(road),
    'Fable hero card and numbered stage treatments render on live shell');
  ok(/planning-road-whatif-quarantine/.test(road) && /Reset/.test(road),
    'what-if is quarantined and offers Reset only (no save-as-plan)');
  ok(!/save as plan|save-as-plan/i.test(road),
    'road-ahead what-if has no save-as-plan affordance');
  ok(/planning-road-period-nav/.test(road) && /aria-label="Trajectory period navigation"/.test(road),
    'period navigation is a named landmark section');
}

console.log('\n=== 1b. Frame 01 anatomy — identity, freshness, hero, horizon, strip head ===');
{
  const road = page.render(live, periods)['planning-road-ahead'].innerHTML;
  ok(/planning-road-freshness/.test(road) && /As at /.test(road),
    'Frame 01 freshness pill is present and states the real opening date');
  ok(/planning-road-app-sub">Your projected money, month by month</.test(road),
    'Frame 01 subtitle reads "Your projected money, month by month"');
  ok(/planning-road-hero-icon planning-road-hero-icon-(gap|pressure|clear)/.test(road),
    'hero carries the Frame 01 tinted icon tile, keyed to the lead kind');
  ok(/planning-road-hero-when/.test(road) && /planning-road-hero-period/.test(road),
    'hero states the period on its own line under the eyebrow');
  ok(/planning-road-hero-relative"> · (this month|next month|in \d+ months)</.test(road),
    'DESIGN §4 relative time sits next to the absolute period');
  ok(/planning-road-hero-narrative/.test(road),
    'hero carries the one-line attribution Forecast supports');
  ok(/planning-road-hero-cta/.test(road) && /See what's behind /.test(road)
    && /data-road-focus-period="/.test(road),
    'Frame 01 hero CTA opens the period story for that exact period');
  ok(/planning-road-horizon-stat-dot-surplus/.test(road)
    && /planning-road-horizon-stat-dot-gap/.test(road)
    && /months with a projected surplus</.test(road)
    && /months with a funding gap</.test(road),
    'Frame 01 horizon tiles carry the dot plus the household count label');
  ok(/planning-road-horizon-caption">Through [^<]*as far as Forecast can currently project\./.test(road),
    'DESIGN §4 horizon caption names Forecast\'s own published horizon end');
  ok(/planning-road-strip-title">Projected monthly result</.test(road),
    'Frame 01 strip is headed "Projected monthly result"');
  ok(/planning-road-timeline-year">\d{4}</.test(road)
    && /planning-road-timeline-plot/.test(road)
    && /planning-road-timeline-bar planning-road-timeline-bar-(surplus|gap|withheld)/.test(road),
    'Frame 01 chips carry a year line and a baseline-anchored mini bar');
  ok(/planning-road-status-pill planning-road-status-(gap|surplus|withheld)/.test(road)
    && /planning-road-pager/.test(road)
    && /data-road-pager="next"/.test(road)
    && /planning-road-selected-sub">Three steps from your regular life/.test(road),
    'Frame 03 period header carries the status pill, chevron pager and three-steps line');
  ok(/planning-road-nav-btn" data-road-select-period="[^"]+" data-road-pager="next" aria-label="[A-Z][a-z]+ \d{4}"/.test(road)
    || /data-road-pager="next" aria-label="\d+ [A-Z][a-z]+ \d{4}/.test(road),
    'DESIGN §8 pager buttons carry the real period name for VoiceOver');
  ok(/planning-road-stage-card/.test(road)
    && /planning-road-stage-includes">Income minus bills, required debt payments and your household budget</.test(road)
    && /planning-road-stage-note/.test(road),
    'Frame 03 stage card carries the what-is-included line and the plain-language note');
  ok(/planning-road-breakdown-summary-label">Full [A-Z][a-z]+ breakdown</.test(road)
    && /planning-road-breakdown-group-title">Money in</.test(road)
    && /planning-road-breakdown-group-title">Bills &amp; required costs|planning-road-breakdown-group-title">Bills & required costs/.test(road),
    'Frame 06 breakdown is a named sheet row with grouped line items');
  ok(/This is a preview, not a change\. Trying numbers here never updates your plan and never moves or schedules money\./.test(road),
    'DESIGN §6 what-if banner copy is exact');
  ok(/What-if: extra payment/.test(road)
    && /planning-road-whatif-preview-head[\s\S]{0,120}>Plan<[\s\S]{0,60}>Preview</.test(road),
    'Frame 08 what-if is titled and compares Plan against Preview');
  ok(/aria-label="[A-Z][a-z]+ \d{4} — Projected (surplus|funding gap|result)/.test(road)
    || /aria-label="\d+ [A-Z][a-z]+ \d{4}[^"]*— Projected/.test(road),
    'chip accessible name is the whole period plus the Forecast result phrase');
}

console.log('\n=== 1c. Frame 01/03 gap variant — hero attribution, stage story, delta pills ===');
{
  const base = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  const month = base.months.find(m => m.month === '2026-12') ? '2026-12' : base.months[2].month;
  const { traj, row } = gapTrajectory(base, month);
  const road = page.composeRoadTraj(traj, 'month', month, live.meta.asOf);
  const monthName = new Date(month + '-15T00:00:00Z')
    .toLocaleDateString('en-CA', { month: 'long', timeZone: 'UTC' });

  ok(/data-road-lead="funding-gap"/.test(road.lead)
    && road.lead.includes(money2(row.stage3.result.amount))
    && /NEXT FUNDING GAP/.test(road.lead),
    'a published negative stage3 leads with the Frame 01 funding-gap hero');
  ok(road.lead.includes(`${monthName} ${month.slice(0, 4)}`)
    && /planning-road-hero-relative/.test(road.lead),
    'gap hero names the month and how far away it is');
  ok(new RegExp(`Your regular household costs are covered that month\\. ${monthName}'s planned spending and the extra debt payment create this gap\\.`)
    .test(road.lead),
    'gap hero attribution names the stages whose signs Forecast published');
  ok(road.lead.includes(`See what's behind ${monthName}`),
    'gap hero CTA names the month it opens');

  const stages = road.stages;
  ok(stages.includes(money2(row.stage1.result.amount))
    && stages.includes(money2(row.stage2.result.amount))
    && stages.includes(money2(row.stage3.result.amount)),
    'all three stage running totals are reprinted from Forecast');
  ok(stages.includes(`Your regular household costs are covered this month, with ${money2(row.stage1.result.amount)} left over.`),
    'stage 1 note reprints the normal-life surplus Forecast published');
  ok(stages.includes(`${monthName}'s planned spending of ${money2(row.stage2.commitments.amount)} is more than the normal-life surplus.`),
    'stage 2 note is chosen from the published signs and reprints the commitments figure');
  ok(stages.includes(`The planned ${money2(row.stage3.extras.amount)} extra payment widens ${monthName}'s gap.`),
    'stage 3 note names the extra payment that widened an already-negative period');
  ok(stages.includes(`−${money2(row.stage2.commitments.amount)} planned spending`)
    && stages.includes(`−${money2(row.stage3.extras.amount)} extra debt payment`),
    'Frame 03 delta pills reprint the component Forecast subtracts at each stage');

  // Independent check: the pill magnitudes must equal the drop Forecast's own
  // stage results show, so the pill's minus direction is Forecast's, not ours.
  const stage1To2 = Math.round((row.stage1.result.amount - row.stage2.result.amount) * 100) / 100;
  const stage2To3 = Math.round((row.stage2.result.amount - row.stage3.result.amount) * 100) / 100;
  ok(stage1To2 === row.stage2.commitments.amount && stage2To3 === row.stage3.extras.amount,
    'pill components reconcile with the stage-to-stage drop in Forecast\'s own results',
    `${stage1To2} / ${stage2To3}`);

  ok(/data-road-result-sign="gap"/.test(stages)
    && stages.includes(`Projected ${monthName} result`),
    'Frame 03 projected-result bar is period-named and carries the Forecast sign');
  ok(/data-road-period-sign="gap"/.test(road.periodHeader)
    && /Projected funding gap/.test(road.periodHeader),
    'period header pill states the gap in words, not colour alone');

  const surplusMonth = base.months.find(m => m.stage3 && m.stage3.result
    && isFinite(m.stage3.result.amount) && m.stage3.result.amount > 0);
  if (surplusMonth) {
    const surplus = page.composeRoadTraj(base, 'month', surplusMonth.month, live.meta.asOf);
    ok(/data-road-result-sign="surplus"/.test(surplus.stages)
      && /Projected surplus/.test(surplus.periodHeader)
      && !/sustainable|well done|great|healthy/i.test(surplus.stages + surplus.periodHeader),
      'surplus periods use the identical anatomy with no praise copy (DESIGN §3)');
  }

  const withheldMonth = JSON.parse(JSON.stringify(base));
  const target = withheldMonth.months[1];
  target.stage2.commitments = { status: 'unavailable', reason: 'Forecast withheld this component.' };
  target.stage2.result = { status: 'unavailable', reason: 'Forecast withheld this stage.' };
  const withheld = page.composeRoadTraj(withheldMonth, 'month', target.month, live.meta.asOf);
  ok(/planning-road-amount-unavailable/.test(withheld.stages)
    && /It is not counted as \$0\./.test(withheld.stages)
    && !/\$0\.00/.test(withheld.stages),
    'a withheld stage or component stays an em-dash with the not-$0 sentence');
}

console.log('\n=== 2. Responsive CSS — snap timeline, touch targets, vertical stages ===');
{
  ok(mobile.length > 200, 'phone-native road-ahead CSS block is present');
  ok(/scroll-snap-type:\s*x mandatory/.test(mobile),
    'trajectory strip uses horizontal scroll snap on phone widths');
  ok(/min-height:\s*44px/.test(mobile),
    'mobile road-ahead controls meet touch-target floor');
  ok(/#planning > h1[\s\S]*display:\s*none/.test(mobile),
    'duplicate desktop Planning h1 is hidden on phone');
  ok(/planning-road-selected[\s\S]*flex-direction:\s*column/.test(mobile)
    || /planning-road-stages[\s\S]*flex-direction:\s*column/.test(mobile),
    'three-stage funding stacks vertically in the selected-period story');
  ok(/planning-road-whatif-quarantine/.test(css),
    'what-if quarantine styling is present for Fable preview framing');
  ok(/planning-road-trust-estimated/.test(css),
    'estimated trust chip uses amber presentation class');
  ok(/--hypo-accent/.test(css) && /--hypo-border/.test(css),
    'what-if quarantine uses hypo design tokens');
  ok(/--road-trust-confirmed/.test(css) && /--road-gap/.test(css),
    'Road Ahead uses DESIGN §9 trust and status tokens');
  ok(/planning-road-trust-planned/.test(css),
    'planned trust chip uses blue presentation class');
  ok(/data-trajectory-funding-result-sign="gap"/.test(css),
    'stage results expose Forecast sign for presentation-only gap/surplus styling');
  ok(/body:has\(#planning\)[\s\S]*\.site-head-row \.brand[\s\S]*display:\s*none/.test(mobile),
    'planning phone view trims masthead brand chrome');
  ok(/body:has\(#planning\)[\s\S]*\.site-head-row \.chip[\s\S]*display:\s*none/.test(mobile),
    'planning phone view hides the dense site-head as-of chip');
  ok(/planning-road-spine[\s\S]*flex-direction:\s*column/.test(css)
    || /planning-road-spine[\s\S]*flex-direction:\s*column/.test(mobile),
    'Frame 03 stage spine is a vertical column');
  ok(/planning-road-segmented[\s\S]*flex-wrap:\s*nowrap/.test(mobile)
    || /planning-road-granularity[\s\S]*flex-wrap:\s*nowrap/.test(mobile),
    'Month|Pay segmented control stays on one row at phone width');
  ok(/\.planning-road-segmented \.planning-trajectory-granularity-btn\[aria-selected="true"\]/.test(mobile),
    'the raised active segment follows aria-selected, the state the tablist exposes');
  ok(/\.planning-road-hero-cta \{[\s\S]*min-height:\s*48px/.test(css),
    'hero CTA is a full-size tap target');
  ok(/\.planning-road-nav-btn \{[\s\S]*min-height:\s*40px/.test(css),
    'pager chevrons keep a real tap target');
  ok(/\.planning-road-timeline-plot::before \{[\s\S]*top:\s*50%/.test(css)
    && /\.planning-road-timeline-bar-surplus \{[\s\S]*bottom:\s*50%/.test(css)
    && /\.planning-road-timeline-bar-gap \{[\s\S]*top:\s*50%/.test(css),
    'DESIGN §8 baseline hairline gives the chip bars a shared zero, signed by direction');
  ok(/\.planning-road-projected-result-gap \{[\s\S]*var\(--road-gap-tint\)/.test(css)
    && /\.planning-road-projected-result-surplus \{[\s\S]*var\(--road-surplus-tint\)/.test(css),
    'the projected-result bar tints from the DESIGN §9 status tints');
  ok(/--road-gap-tint:/.test(css) && /--road-surplus-tint:/.test(css)
    && /--road-est-tint:/.test(css) && /--road-unav-tint:/.test(css),
    'DESIGN §9 tints exist as tokens, scoped to Road Ahead');
  ok(/:root\[data-theme="dark"\] \.planning-road-shell \{[\s\S]*--road-gap-tint:/.test(css),
    'dark is a re-tuned token swap, not an inversion');
  ok(/\.planning-road-stage-card \{/.test(css) && /\.planning-road-stage-pill \{/.test(css)
    && /\.planning-road-breakdown-group-title \{/.test(css)
    && /\.planning-road-freshness \{/.test(css),
    'Frame chrome — stage card, delta pill, breakdown group heads, freshness pill — is styled');
  ok(/font-variant-numeric:\s*tabular-nums/.test(css),
    'money is set with tabular numerals');
}

console.log('\n=== 3. Forecast reprints unchanged — no page-side trajectory math ===');
{
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  const month = traj.months[0];
  const road = page.composeRoad(live, periods, 'month', month.month, live.meta.asOf);
  ok(road.timeline.includes(money2(month.stage3.result.amount)),
    'mobile compose path still copies Forecast stage3 on the timeline');
  ok(road.selected.includes(money2(month.stage3.result.amount)),
    'selected-period panel still copies the same Forecast stage3 amount');
  const shell = page.render(live, periods)['planning-road-ahead'].innerHTML;
  ok(shell.includes(money2(month.stage3.result.amount)),
    'live shell reprints Forecast stage3 without alternate arithmetic');

  const roadBlock = planningSrc.split('function planningRoadAheadScrollSelectedTimeline')[0]
    .split('function planningRoadAheadWireSelection')[0];
  ok(!/stage1Amount|stage2Amount|stage3Amount|baselineTrajectoryMonthFunding/.test(roadBlock),
    'road-ahead presentation block does not recompute stage totals');
  ok(!/\+\s*period\.stage|stage\d\.result\.amount\s*[-+*/]/.test(
    planningSrc.split('function planningRoadAheadHtml')[1].split('function planningTrajectoryFundingHtml')[0]),
    'road-ahead helpers do not derive new amounts from stage results');
  const horizonFn = planningSrc.match(
    /function planningRoadAheadHorizonCountsHtml\([\s\S]*?\n\}/);
  ok(horizonFn && !/surplus\s*\+|gap\s*\+|data-road-horizon-kind/.test(horizonFn[0]),
    'horizon counts helper does not aggregate periods into surplus/gap tallies');
  ok(/data-trajectory-funding-result-sign="(gap|surplus)"/.test(shell),
    'Fable stage amounts expose Forecast sign for gap/surplus presentation CSS');
  ok(/planning-road-trust-calculated/.test(shell) && />Calculated</.test(shell),
    'calculated trust reprints as Calculated, not Confirmed');
  ok(!/planning-road-trust-calculated[^>]*>Confirmed</.test(shell),
    'Calculated chip label is never Confirmed');
  const chipFn = planningSrc.match(/function planningRoadTrustChip\([\s\S]*?\n\}/);
  ok(chipFn && /calculated: \{ cls: 'planning-road-trust-calculated', label: 'Calculated' \}/.test(chipFn[0]),
    'trust map sends Forecast calculated to Calculated');
  ok(chipFn && !/calculated:[^}]*Confirmed/.test(chipFn[0]),
    'trust map does not alias calculated to Confirmed');
}

console.log('\n=== 4. Granularity, accessibility, and fail-closed presentation ===');
{
  const rendered = page.render(live, periods)['planning-road-ahead'].innerHTML;
  ok(/data-trajectory-funding-granularity="month"/.test(rendered)
    && /data-trajectory-funding-granularity="pay-period"/.test(rendered),
    'Month and Pay period toggles are both rendered');
  ok(/aria-pressed="true"/.test(rendered) && /aria-pressed="false"/.test(rendered),
    'granularity buttons expose pressed state for assistive tech');
  ok(/aria-pressed=/.test(rendered) && /planning-road-timeline-btn/.test(rendered),
    'timeline period pickers remain buttons with aria-pressed, not table role=button');
  ok(!/role="button"/.test(rendered) || !/<table[\s\S]*role="button"/.test(rendered),
    'road-ahead strip does not replace table semantics with role=button');

  const withheld = page.composeRoad(
    { plan: null, debts: [], meta: { asOf: live.meta.asOf }, revolvingExtra: null },
    periods, 'month', null, live.meta.asOf);
  ok(/unavailable|Withheld|Forecast unavailable/.test(withheld.lead + withheld.timeline),
    'unavailable trajectory still fails closed in the mobile shell path');
  const roadBlock = planningSrc.split('function planningRoadAheadScrollSelectedTimeline')[0];
  ok(/planning-road-amount-unavailable[\s\S]*—/.test(roadBlock)
    || /aria-label="Unavailable">—</.test(roadBlock),
    'unavailable amounts reprint as em dash, not $0');
}

console.log('\n=== 5. Bottom dock — incumbent safe-area rules untouched ===');
{
  const dockBlock = /@media \(max-width:640px\) \{[\s\S]*?\.sitenav-household a\[aria-current\]::before/.exec(css);
  ok(dockBlock && /env\(safe-area-inset-bottom/.test(dockBlock[0]),
    'household dock still accounts for iOS safe-area inset');
  ok(/padding-bottom:calc\(var\(--nav-dock-height\)/.test(css),
    'body padding still reserves space so the dock does not cover content');
}

console.log('\n=== 6. Desktop presentation preserved ===');
{
  ok(/@media \(min-width:641px\)[\s\S]*\.planning-road-app-head \{ display: none; \}/.test(css),
    'compact app head is phone-only; desktop keeps incumbent page chrome');
  ok(/@media \(min-width:641px\)[\s\S]*grid-template-columns: repeat\(3/.test(css),
    'desktop road-ahead selected period keeps three-column stage grid');
}

console.log('\n=== 7. Cross-year timeline chip labels (Fable trajectory strip) ===');
{
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods, extraFacilities: live.revolvingExtra,
  });
  const monthYears = new Set((traj.months || []).map(m => String(m.month).slice(0, 4)));
  ok(monthYears.size > 1,
    'live baseline trajectory spans multiple calendar years for chip-label proof');
  const road = page.composeRoad(live, periods, 'month', '2027-01', live.meta.asOf);
  const chipText = (timeline, key) => {
    const m = new RegExp(`data-road-timeline-period="${key}"[\\s\\S]*?planning-road-timeline-label">([^<]+)<[\\s\\S]*?planning-road-timeline-year">([^<]*)<`)
      .exec(timeline);
    return m ? { label: m[1], year: m[2] } : null;
  };
  const jan27 = chipText(road.timeline, '2027-01');
  const aug26 = chipText(road.timeline, '2026-08');
  const dec26 = chipText(road.timeline, '2026-12');
  ok(jan27 && jan27.label === 'Jan' && jan27.year === '2027',
    'every month chip states its own calendar year, so Jan 2027 never reads as Jan 2026',
    jan27 ? `${jan27.label} ${jan27.year}` : 'missing');
  ok(dec26 && dec26.label === 'Dec' && dec26.year === '2026',
    'the month before the year turns carries its own year on the same chip',
    dec26 ? `${dec26.label} ${dec26.year}` : 'missing');
  ok(aug26 && aug26.year === '2026',
    'anchor-year chips carry a year too, so no chip depends on its neighbours');

  // Unique chip identity is the property PR #341 fixed. The per-chip year line
  // is now what carries it, for every chip rather than only later years.
  const chipIdentities = timeline => [...timeline.matchAll(
    /planning-road-timeline-label">([^<]+)<\/span>\s*<span class="planning-road-timeline-year">([^<]*)</g)]
    .map(m => `${m[1]} ${m[2]}`);
  const monthChips = chipIdentities(road.timeline);
  ok(monthChips.length === traj.months.length,
    'one chip per published month', `${monthChips.length}/${traj.months.length}`);
  ok(new Set(monthChips).size === monthChips.length,
    'no two month chips read the same on the strip', monthChips.join(' | '));

  const payRoad = page.composeRoad(live, periods, 'pay-period', '2027-07-30', live.meta.asOf);
  const payChip = chipText(payRoad.timeline, '2027-07-30');
  ok(payChip && payChip.label.includes('\u2013') && payChip.year === '2027',
    'pay-period chips are date-range labelled and carry the year (DESIGN Month <-> Pay Period)',
    payChip ? `${payChip.label} ${payChip.year}` : 'missing');
  const payChips = chipIdentities(payRoad.timeline);
  ok(payChips.length === traj.payPeriods.length
    && new Set(payChips).size === payChips.length,
    'no two pay-period chips read the same on the strip', `${payChips.length} chips`);

  const chipFn = planningSrc.match(/function planningRoadAheadChipLabel\([\s\S]*?\n\}/);
  ok(chipFn && !/yearContext/.test(chipFn[0]),
    'chip label helper no longer needs neighbour context to stay unambiguous');
  ok(/function planningRoadAheadChipYear\(/.test(planningSrc)
    && /function planningRoadAheadChipAccessibleLabel\(/.test(planningSrc),
    'chip year and accessible-label helpers are present for static contract check');
  ok(!/planningRoadAheadTimelineYearContext|planningRoadAheadChipYearSuffix/.test(planningSrc),
    'the superseded year-suffix mechanism is gone — one authority for chip identity');
}

console.log('\n=== 8. Timeline scroll containment (no window jump) ===');
{
  const road = page.render(live, periods)['planning-road-ahead'].innerHTML;
  ok(!/As of\s+As at/i.test(road) && !/planning-road-app-asof-label/.test(road),
    'road-ahead header does not prefix a second As of label onto As at …');

  const scrollFnMatch = planningSrc.match(
    /function planningRoadAheadScrollSelectedTimeline\([\s\S]*?\n\}/);
  const scrollFn = scrollFnMatch ? scrollFnMatch[0] : '';
  ok(scrollFn.length > 80, 'scroll helper is present for static contract check');
  ok(!/scrollIntoView/.test(scrollFn),
    'selected timeline scroll does not call window scrollIntoView after renderPlanning');
  ok(/planning-road-timeline|closest\(/.test(scrollFn)
    && /scrollTo|scrollLeft/.test(scrollFn),
    'scroll helper moves the horizontal timeline strip only');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll planning road-ahead mobile presentation checks passed.');
