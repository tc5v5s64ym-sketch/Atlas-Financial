'use strict';
/* Household mobile navigation presentation: Budget | Bills | Subscriptions |
 * Credit | Planning, shared dock treatment, iPhone safe-area clearance, and
 * no new UI dependency. Presentation only — Forecast authority is untouched.
 *
 * `node test/test-household-nav-presentation.js`
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const HOUSEHOLD_PAGES = [
  ['public/index.html', 'Budget', '/'],
  ['public/bills.html', 'Bills', '/bills.html'],
  ['public/subscriptions.html', 'Subscriptions', '/subscriptions.html'],
  ['public/credit.html', 'Credit', '/credit.html'],
  ['public/planning.html', 'Planning', '/planning.html'],
];
const HOUSEHOLD_NAV = [
  ['/', 'Budget', 'budget'],
  ['/bills.html', 'Bills', 'bills'],
  ['/subscriptions.html', 'Subscriptions', 'subscriptions'],
  ['/credit.html', 'Credit', 'credit'],
  ['/planning.html', 'Planning', 'planning'],
];

function siteNav(html) {
  const match = /<nav class="sitenav(?: [^"]*)?" aria-label="Pages">([\s\S]*?)<\/nav>/.exec(html);
  if (!match) return null;
  return [...match[1].matchAll(/<a href="([^"]+)"([^>]*)>([\s\S]*?)<\/a>/g)].map(m => {
    const labelled = /class="sitenav-label"[^>]*>([^<]+)</.exec(m[3]);
    const nav = /data-nav="([^"]+)"/.exec(m[2]);
    return {
      href: m[1],
      current: /aria-current="page"/.test(m[2]),
      label: (labelled ? labelled[1] : m[3]).replace(/<[^>]+>/g, '').trim(),
      dataNav: nav ? nav[1] : '',
      hasIcon: /class="sitenav-icon"/.test(m[3]),
    };
  });
}

function mobileNavBlock(css) {
  const start = css.search(/@media \(max-width:640px\) \{/);
  if (start < 0) return '';
  let i = css.indexOf('{', start) + 1;
  let depth = 1;
  while (i < css.length && depth > 0) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
    i++;
  }
  return css.slice(start, i);
}

const css = read('public/styles.css');
const glass = read('public/nav-glass.css');
const householdView = read('public/household-view.css');
const pkg = JSON.parse(read('package.json'));
const mobile = mobileNavBlock(css);

console.log('=== 1–8. Shared household destinations, routes, order, and current page ===');
{
  const expected = JSON.stringify(HOUSEHOLD_NAV.map(n => [n[0], n[1]]));
  for (const [file, label] of HOUSEHOLD_PAGES) {
    const nav = siteNav(read(file));
    ok(nav && nav.length === 5, `${file} has exactly five household destinations`,
      nav ? nav.map(l => l.label).join(' | ') : 'no nav');
    ok(nav && JSON.stringify(nav.map(l => [l.href, l.label])) === expected,
      `${file} reads Budget | Bills | Subscriptions | Credit | Planning`);
    ok(nav && nav[0].href === '/' && nav[0].label === 'Budget',
      `${file} Budget still routes to /`);
    ok(nav && nav[1].href === '/bills.html' && nav[2].href === '/subscriptions.html'
        && nav[3].href === '/credit.html' && nav[4].href === '/planning.html',
      `${file} keeps the incumbent Bills / Subscriptions / Credit / Planning routes`);
    const current = nav ? nav.filter(l => l.current) : [];
    ok(current.length === 1 && current[0].label === label,
      `${file} marks exactly one destination current: ${label}`);
    ok(nav && nav.every(l => l.hasIcon && l.dataNav),
      `${file} uses the shared icon + data-nav vocabulary, not label-only links`);
    ok(/class="sitenav sitenav-household"/.test(read(file)),
      `${file} marks the household dock so diagnostic sitenav is not restyled`);
  }
}

console.log('\n=== 9–13. iPhone dock: safe area, clearance, touch targets, motion ===');
{
  ok(/viewport-fit=cover/.test(read('public/index.html'))
      && HOUSEHOLD_PAGES.every(([file]) => /viewport-fit=cover/.test(read(file))),
    'every household page enables viewport-fit=cover so iOS safe-area insets apply');
  ok(/--nav-dock-height:66px/.test(css) && /--nav-dock-lift:12px/.test(css)
      && /--nav-dock-inset:10px/.test(css),
    'shared dock tokens name height, lift above the home indicator, and side inset');
  ok(mobile.includes('env(safe-area-inset-bottom, 0px)')
      && /bottom:calc\(\s*var\(--nav-dock-lift\)\s*\+\s*env\(safe-area-inset-bottom/.test(mobile)
      && /left:calc\(\s*var\(--nav-dock-inset\)\s*\+\s*env\(safe-area-inset-left/.test(mobile)
      && /right:calc\(\s*var\(--nav-dock-inset\)\s*\+\s*env\(safe-area-inset-right/.test(mobile),
    'the floating dock is placed relative to the iOS safe area, not flush to the physical edge');
  ok(/body:has\(\.sitenav-household\) \{[\s\S]*padding-bottom:calc\(\s*var\(--nav-dock-height\)\s*\+\s*var\(--nav-dock-lift\)\s*\+\s*18px\s*\+\s*env\(safe-area-inset-bottom/.test(mobile)
      && /\.sitenav-household \{/.test(mobile)
      && !/\.sitenav:not\(\.subnav\)/.test(css),
    'dock clearance and the five-column dock apply only to household nav, not every sitenav');
  ok(/grid-template-columns:\s*repeat\(5,minmax\(0,1fr\)\)/.test(mobile),
    'mobile dock is a five-column grid, not the retired four-column website bar');
  ok(/min-height:52px/.test(mobile) && /min-height:var\(--nav-dock-height\)/.test(mobile),
    'dock items keep a ≥52px touch target and the dock itself is at least 66px tall');
  ok(/white-space:nowrap/.test(mobile) && !/overflow-wrap:anywhere/.test(mobile),
    'mobile labels stay on one line so Subscriptions does not wrap to a stray s');
  const reduced = /@media \(max-width:640px\) and \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(css);
  ok(reduced && /transition:\s*none/.test(reduced[0]) && /transform:\s*none/.test(reduced[0]),
    'press-scale and color motion are disabled when the household prefers reduced motion');
  ok(/transition:color \.16s ease/.test(mobile) && /a:active \{ transform:scale\(\.96\); \}/.test(mobile),
    'active-state motion exists and stays short');
}

console.log('\n=== 13b. Diagnostic pages keep the four-link text nav ===');
{
  const diagnostic = [
    ['public/modellers.html', 'Modellers'],
    ['public/deepdive.html', 'Deep Dive'],
    ['public/records.html', 'Records'],
  ];
  const expected = JSON.stringify([
    ['/', 'Plan'],
    ['/modellers.html', 'Modellers'],
    ['/deepdive.html', 'Deep Dive'],
    ['/records.html', 'Records'],
  ]);
  for (const [file, label] of diagnostic) {
    const html = read(file);
    const nav = siteNav(html);
    ok(!/sitenav-household/.test(html),
      `${file} is not marked as the household dock`);
    ok(nav && nav.length === 4, `${file} still has four diagnostic destinations`,
      nav ? nav.map(l => l.label).join(' | ') : 'no nav');
    ok(nav && JSON.stringify(nav.map(l => [l.href, l.label])) === expected,
      `${file} still reads Plan | Modellers | Deep Dive | Records`);
    ok(nav && nav.every(l => !l.hasIcon && !l.dataNav),
      `${file} stays text-only — no empty icon wells`);
    const current = nav ? nav.filter(l => l.current) : [];
    ok(current.length === 1 && current[0].label === label,
      `${file} marks exactly one diagnostic destination current: ${label}`);
  }
}

console.log('\n=== 13c. iOS glass selector and cross-page sliding selection ===');
{
  ok(/^@import url\('\/nav-glass\.css'\);/.test(householdView),
    'Budget loads the shared glass dock through its existing household-view stylesheet');
  for (const file of ['public/bills.html', 'public/subscriptions.html', 'public/credit.html', 'public/planning.html']) {
    ok(/<link rel="stylesheet" href="\/nav-glass\.css">/.test(read(file)),
      `${file} loads the shared glass dock stylesheet`);
  }
  ok(/@view-transition\s*\{\s*navigation:\s*auto;\s*\}/.test(glass)
      && /view-transition-name:\s*atlas-tab-indicator/.test(glass)
      && /::view-transition-group\(atlas-tab-indicator\)/.test(glass),
    'the selected glass capsule participates in cross-document view transitions instead of popping onto the next tab');
  ok(/\.sitenav-household::before\s*\{[\s\S]*transform:translateX\(calc\(var\(--nav-selected-index\) \* 100%\)\)/.test(glass)
      && /transition:transform \.32s cubic-bezier/.test(glass),
    'one shared selector capsule moves horizontally across the five tab slots');
  ok(['budget','bills','subscriptions','credit','planning'].every((name, index) =>
      new RegExp(`data-nav="${name}"\\]\\[aria-current="page"\\]\\) \\{ --nav-selected-index:${index}; \\}`).test(glass)),
    'aria-current deterministically places the glass selector on all five destinations');
  ok(/--nav-icon-budget:url\("data:image\/svg\+xml[^\n]*M3\.5 10\.5 12 3\.5/.test(glass)
      && /--nav-icon-credit:url\("data:image\/svg\+xml[^\n]*rect x='2\.75' y='5\.5'/.test(glass),
    'Budget uses a home icon while Credit keeps a distinct credit-card icon');
  ok(/backdrop-filter:blur\(26px\) saturate\(1\.55\)/.test(glass)
      && /border-radius:28px/.test(glass)
      && /linear-gradient\(180deg/.test(glass),
    'dock and selector use the intended frosted-glass depth rather than a flat white bar');
  ok(/prefers-reduced-motion:reduce[\s\S]*\.sitenav-household::before[\s\S]*transition:none/.test(glass),
    'glass selector motion has a reduced-motion fallback');
}

console.log('\n=== 14–17. No new dependency; Forecast and Credit content stay put ===');
{
  ok(!Object.keys(pkg.dependencies || {}).some(name =>
      /icon|fontawesome|lucide|heroicons|feather|bootstrap|react|vue|svelte|tailwind/i.test(name)),
    'package.json gained no icon library, UI kit, or frontend framework');
  ok(/--nav-icon-budget:url\("data:image\/svg\+xml/.test(css)
      && /--nav-icon-bills:url\("data:image\/svg\+xml/.test(css)
      && /--nav-icon-subscriptions:url\("data:image\/svg\+xml/.test(css)
      && /--nav-icon-credit:url\("data:image\/svg\+xml/.test(css)
      && /--nav-icon-planning:url\("data:image\/svg\+xml/.test(css),
    'the five icons remain inline SVG data URIs with no external icon dependency');
  ok(!/cdn\.|unpkg\.|jsdelivr|fontawesome|fonts\.google/.test(css + glass)
      && HOUSEHOLD_PAGES.every(([file]) => !/cdn\.|unpkg\.|jsdelivr/.test(read(file))),
    'household pages and styles load no external icon or UI host');
  const forecast = read('public/forecast.js');
  ok(/function paydayAllocation\(/.test(forecast) && /function recommend\(/.test(forecast)
      && /function creditAccounts\(/.test(forecast) && /function householdBills\(/.test(forecast)
      && /function householdSubscriptions\(/.test(forecast),
    'Forecast authorities still live in forecast.js; this suite does not rewrite them');
  const credit = read('public/credit.html');
  ok(/data-page-shell="credit"/.test(credit)
      && /<h1>Credit<\/h1>/.test(credit)
      && /id="credit-secured"/.test(credit)
      && /id="credit-cards"/.test(credit)
      && /class="credit-list credit-list-secured"/.test(credit)
      && /class="credit-list credit-list-cards"/.test(credit)
      && /Credit cards/.test(credit),
    'Credit keeps its incumbent financial content structure');
  ok(/\.credit-account \{/.test(css) && /top:0; left:0; right:0; height:3px/.test(css),
    'Credit card visual language (white surface, top rule) is still in styles.css');
  ok(/class="fact-card-list"/.test(read('public/bills.html'))
      && /class="fact-card-list"/.test(read('public/subscriptions.html'))
      && /\.fact-card, \.credit-account \{/.test(css),
    'Bills and Subscriptions keep the merged Credit-style fact-card implementation');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);