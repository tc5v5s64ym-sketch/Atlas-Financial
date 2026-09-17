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
  };
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
  ok(/data-planning-road-primary="lead"/.test(road), 'lead card is in the primary viewport band');
  const leadAt = road.indexOf('data-planning-road-primary="lead"');
  const scenarioAt = road.indexOf('data-trajectory-scenario-section="controls"');
  ok(leadAt >= 0 && scenarioAt > leadAt,
    'hypothetical scenario sits below lead/timeline/selected on the phone-first stack');
  ok(/planning-road-period-nav/.test(road) && /aria-label="Trajectory period navigation"/.test(road),
    'period navigation is a named landmark section');
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
  ok(/planning-road-selected[\s\S]*flex-direction:\s*column/.test(mobile),
    'three-stage funding stacks vertically in the selected-period story');
  ok(/data-trajectory-funding-result-sign="gap"/.test(css),
    'stage results expose Forecast sign for presentation-only gap/surplus styling');
  ok(/body:has\(#planning\)[\s\S]*\.site-head-row \.brand[\s\S]*display:\s*none/.test(mobile),
    'planning phone view trims masthead brand chrome');
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

console.log('\n=== 7. Tip repair — as-of identity and timeline scroll containment ===');
{
  const road = page.render(live, periods)['planning-road-ahead'].innerHTML;
  ok(/planning-road-app-asof/.test(road) && road.includes(`As at ${live.meta.asOf}`),
    'phone identity reprints the boot as-of chip text once');
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
