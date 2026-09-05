'use strict';
/* Household information architecture: nav Plan | Credit | Planning, routable
 * Credit / Planning pages on the incumbent header (content proved in
 * test-credit-page.js and test-planning-page.js), and a Plan waterfall that
 * ends at Balance after household budget.
 *
 * Presentation only. Forecast still computes the extra-debt / big-purchase
 * chain and the projected ending; this suite proves those fields survive and
 * still reconcile by independent arithmetic, while the household Plan surface
 * prints nothing past Q07.
 *
 * The last section starts server.js with synthetic secrets so the shells are
 * proved routable behind the same session gate as every other page.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const net = require('net');
const { spawn } = require('child_process');
const F = require('../public/forecast.js');
const data = require('../data.json');
const periods = require('../public/periods.json');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const exists = file => fs.existsSync(path.join(ROOT, file));

const HOUSEHOLD_NAV = [
  ['/', 'Plan'],
  ['/credit.html', 'Credit'],
  ['/planning.html', 'Planning'],
];
const RETIRED_FROM_NAV = ['Modellers', 'Deep Dive', 'Records'];
const REMOVED_ROWS = [
  'Extra credit-card repayment',
  'Balance after debt repayment',
  'Big-purchase savings',
  'Projected ending balance',
];
const KEPT_ROWS = [
  'Income',
  'Balance after payday',
  'Bills',
  'Balance after remaining bills',
  'Household budget',
  'Balance after household budget',
];

function siteNav(html) {
  const match = /<nav class="sitenav" aria-label="Pages">([\s\S]*?)<\/nav>/.exec(html);
  if (!match) return null;
  return [...match[1].matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map(m => ({
    href: m[1],
    current: /aria-current="page"/.test(m[2]),
    label: m[3].trim(),
  }));
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const grab = (src, re, label) => {
    const match = re.exec(src);
    if (!match) throw new Error('missing ' + label);
    return match[0];
  };
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function liveOperatingPlanNote\([\s\S]*?\n\}$/m, 'liveOperatingPlanNote'),
    grab(planSrc, /^function currentOperatingUnavailableHtml\([\s\S]*?\n\}$/m, 'currentOperatingUnavailableHtml'),
    grab(planSrc, /^function paydayActionRows\([\s\S]*?\n\}$/m, 'paydayActionRows'),
    grab(planSrc, /^function paydayCashNote\([\s\S]*?\n\}$/m, 'paydayCashNote'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function paydayCoverageNote\([\s\S]*?\n\}$/m, 'paydayCoverageNote'),
    grab(planSrc, /^const PAYDAY_ACTION_KIND = \{[\s\S]*?^\};$/m, 'PAYDAY_ACTION_KIND'),
    grab(planSrc, /^function paydayAllocationTrustNote\([\s\S]*?\n\}$/m, 'paydayAllocationTrustNote'),
    grab(planSrc, /^function paydayAllocationSheetHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSheetHtml'),
    grab(planSrc, /^function currentPeriodConfidence\([\s\S]*?\n\}$/m, 'currentPeriodConfidence'),
    grab(planSrc, /^function currentPeriodBillGroup\([\s\S]*?\n\}$/m, 'currentPeriodBillGroup'),
    grab(planSrc, /^function betweenPaydaysOperatingHtml\([\s\S]*?\n\}$/m, 'betweenPaydaysOperatingHtml'),
    grab(planSrc, /^const FUTURE_PLAN_VERDICT = \{[\s\S]*?^\};$/m, 'FUTURE_PLAN_VERDICT'),
    grab(planSrc, /^const FUTURE_PLAN_FLEXIBILITY = \{[\s\S]*?^\};$/m, 'FUTURE_PLAN_FLEXIBILITY'),
    grab(planSrc, /^function futureCostNeedsAttention\([\s\S]*?\n\}$/m, 'futureCostNeedsAttention'),
    grab(planSrc, /^function futurePlanRemainingLabel\([\s\S]*?\n\}$/m, 'futurePlanRemainingLabel'),
    grab(planSrc, /^function futurePlanMeaning\([\s\S]*?\n\}$/m, 'futurePlanMeaning'),
    grab(planSrc, /^function futurePlanRequirement\([\s\S]*?\n\}$/m, 'futurePlanRequirement'),
    grab(planSrc, /^function futurePlanTiming\([\s\S]*?\n\}$/m, 'futurePlanTiming'),
    grab(planSrc, /^function futurePlanCardHtml\([\s\S]*?\n\}$/m, 'futurePlanCardHtml'),
    grab(planSrc, /^function futureGravityHtml\([\s\S]*?\n\}$/m, 'futureGravityHtml'),
    grab(planSrc, /^function operatingDebtAnswerHtml\([\s\S]*?\n\}$/m, 'operatingDebtAnswerHtml'),
    grab(planSrc, /^const REFRESH_TRUST_STATE = \{[\s\S]*?^\};$/m, 'REFRESH_TRUST_STATE'),
    grab(planSrc, /^function refreshTrustHtml\([\s\S]*?\n\}$/m, 'refreshTrustHtml'),
    grab(planSrc, /^function cashUnsafe\([\s\S]*?\n\}$/m, 'cashUnsafe'),
    grab(planSrc, /^function todayActionRowsHtml\([\s\S]*?\n\}$/m, 'todayActionRowsHtml'),
    grab(planSrc, /^function todayDecisionHtml\([\s\S]*?\n\}$/m, 'todayDecisionHtml'),
    grab(planSrc, /^function spendDecisionHtml\([\s\S]*?\n\}$/m, 'spendDecisionHtml'),
    grab(planSrc, /^function paydayBucketRow\([\s\S]*?\n\}$/m, 'paydayBucketRow'),
    grab(planSrc, /^function postedThisPeriodHtml\([\s\S]*?\n\}$/m, 'postedThisPeriodHtml'),
    grab(planSrc, /^function glanceSignedMoney\([\s\S]*?\n\}$/m, 'glanceSignedMoney'),
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function alreadyPaidRowsHtml\([\s\S]*?\n\}$/m, 'alreadyPaidRowsHtml'),
    grab(planSrc, /^function alreadyPaidHtml\([\s\S]*?\n\}$/m, 'alreadyPaidHtml'),
    grab(planSrc, /^function stillDueItems\([\s\S]*?\n\}$/m, 'stillDueItems'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
    grab(planSrc, /^function mustLeaveHtml\([\s\S]*?\n\}$/m, 'mustLeaveHtml'),
    grab(planSrc, /^function extraDebtGlanceHtml\([\s\S]*?\n\}$/m, 'extraDebtGlanceHtml'),
    grab(planSrc, /^function runningLeftoverHtml\([\s\S]*?\n\}$/m, 'runningLeftoverHtml'),
    grab(planSrc, /^function periodBillLine\([\s\S]*?\n\}$/m, 'periodBillLine'),
    grab(planSrc, /^function calendarIncomeHtml\([\s\S]*?\n\}$/m, 'calendarIncomeHtml'),
    grab(planSrc, /^function householdBudgetCycleText\([\s\S]*?\n\}$/m, 'householdBudgetCycleText'),
    grab(planSrc, /^function householdBudgetMetric\([\s\S]*?\n\}$/m, 'householdBudgetMetric'),
    grab(planSrc, /^function householdBudgetCategoryHtml\([\s\S]*?\n\}$/m, 'householdBudgetCategoryHtml'),
    grab(planSrc, /^function calendarBudgetHtml\([\s\S]*?\n\}$/m, 'calendarBudgetHtml'),
    grab(planSrc, /^function calendarPeriodBillsHtml\([\s\S]*?\n\}$/m, 'calendarPeriodBillsHtml'),
    grab(planSrc, /^function extraRepaymentHtml\([\s\S]*?\n\}$/m, 'extraRepaymentHtml'),
    grab(planSrc, /^function calendarWaterfallHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallHtml'),
    grab(planSrc, /^function calendarPickerHtml\([\s\S]*?\n\}$/m, 'calendarPickerHtml'),
    grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml'),
    grab(planSrc, /^function periodBillsHtml\([\s\S]*?\n\}$/m, 'periodBillsHtml'),
    grab(planSrc, /^function householdBudgetHtml\([\s\S]*?\n\}$/m, 'householdBudgetHtml'),
    grab(planSrc, /^function budgetDigestHtml\([\s\S]*?\n\}$/m, 'budgetDigestHtml'),
    grab(planSrc, /^function firstCardHtml\([\s\S]*?\n\}$/m, 'firstCardHtml'),
    grab(planSrc, /^function otherCardsHtml\([\s\S]*?\n\}$/m, 'otherCardsHtml'),
    grab(planSrc, /^function bigPurchasesHtml\([\s\S]*?\n\}$/m, 'bigPurchasesHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, calendarWaterfallHtml, money2 });`,
    { Forecast: F }
  );
}

function currentAdvice() {
  const plan = data.plan;
  const asOf = data.meta.asOf;
  return F.recommend(plan, asOf, {
    scenario: 'expected',
    targetBuffer: plan.defaults.targetBuffer,
    extraDebtMonthly: 0,
    disabled: [],
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: plan.nextDollar && plan.nextDollar.target,
    periods,
    paypalPerMonth: data.paypal && data.paypal.perMonth,
  });
}

console.log('=== 1. Plan household nav is Plan | Credit | Planning ===');
{
  const nav = siteNav(read('public/index.html'));
  ok(nav && nav.length === 3, 'the Plan page has exactly three household nav links',
    nav ? nav.map(l => l.label).join(' | ') : 'no nav');
  ok(nav && JSON.stringify(nav.map(l => [l.href, l.label])) === JSON.stringify(HOUSEHOLD_NAV),
    'links are Plan (/), Credit (/credit.html), Planning (/planning.html) in that order');
  ok(nav && nav.filter(l => l.current).length === 1 && nav[0].current,
    'Plan is the one aria-current page on the Plan nav');
}

console.log('\n=== 2. Credit and Planning shells share the household nav on the incumbent header ===');
for (const [page, label, id] of [['credit.html', 'Credit', 'credit'], ['planning.html', 'Planning', 'planning']]) {
  ok(exists('public/' + page), `${page} exists`);
  const html = read('public/' + page);
  const nav = siteNav(html);
  ok(nav && JSON.stringify(nav.map(l => [l.href, l.label])) === JSON.stringify(HOUSEHOLD_NAV),
    `${page} carries the same three household nav links in the same order`);
  const current = nav ? nav.filter(l => l.current) : [];
  ok(current.length === 1 && current[0].label === label,
    `${page} marks ${label} as the aria-current page`);
  ok(new RegExp(`<title>Household finances — ${label.toLowerCase()}</title>`).test(html)
      && new RegExp(`<h1>${label}</h1>`).test(html)
      && new RegExp(`data-page-shell="${id}"`).test(html),
    `${page} identifies itself as ${label}`);
  ok(/class="brand">Household finances</.test(html) && /id="asof"/.test(html)
      && /id="theme-btn"/.test(html) && /action="\/logout"/.test(html)
      && /<link rel="stylesheet" href="\/styles.css">/.test(html)
      && /<meta name="robots" content="noindex, nofollow">/.test(html),
    `${page} uses the incumbent header: brand, as-of chip, theme, sign out, stylesheet, noindex`);
  ok(/<script src="\/app.js"><\/script>/.test(html)
      && /<script src="\/forecast.js"><\/script>/.test(html)
      && new RegExp(`<script src="/${id}.js"></script>`).test(html)
      && !/<script>/.test(html),
    `${page} loads the shared core, the Forecast engine and its own page script, and no inline script (CSP)`);
  const pageScript = read(`public/${id}.js`);
  ok(/App\.boot\(/.test(pageScript) && /App\.register\(/.test(pageScript),
    `${id}.js boots the shared core and renders through the shared data hook (served /data.json, one as-of chip)`);
  ok(!/\$\d|\d\.\d\d\b|%/.test(html.replace(/<meta[^>]*>/g, '')),
    `${page} hardcodes no figure — every figure arrives through the shared boot`);
  for (const href of [...html.matchAll(/href="(\/[^"#]*)"/g)].map(m => m[1])) {
    const target = href === '/' ? 'public/index.html' : 'public' + href;
    ok(exists(target), `${page} link ${href} resolves to a file`);
  }
}

console.log('\n=== 3. Modellers, Deep Dive, Records leave the household nav but stay routable ===');
{
  for (const page of ['index.html', 'credit.html', 'planning.html']) {
    const nav = siteNav(read('public/' + page)) || [];
    ok(!nav.some(l => RETIRED_FROM_NAV.includes(l.label))
        && !nav.some(l => /modellers|deepdive|records/.test(l.href)),
      `${page} household nav has no Modellers / Deep Dive / Records entry`);
  }
  for (const page of ['modellers.html', 'deepdive.html', 'records.html']) {
    ok(exists('public/' + page), `${page} still exists (not deleted; only removed from the household nav)`);
  }
  for (const script of ['modellers.js', 'deepdive.js', 'records.js']) {
    ok(exists('public/' + script), `${script} still exists`);
  }
}

console.log('\n=== 4 + 5. Plan waterfall keeps Balance after household budget and stops there ===');
{
  const advice = currentAdvice();
  const composer = loadComposer();
  const html = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    liveOverlay: data.liveOverlay,
  });
  const active = (advice.defaultView.calendarPeriods || []).find(p => p.role === 'active')
    || advice.defaultView.calendarPeriods[0];
  ok(/data-calendar-waterfall=/.test(html), 'the default Plan renders the calendar waterfall');
  ok(/data-live-current-balance/.test(html)
      && html.indexOf('data-live-current-balance') < html.indexOf('data-operating-prompt="Income"'),
    'live Current Balance prints before the payday snapshot');
  let previous = -1;
  for (const prompt of KEPT_ROWS) {
    const at = html.indexOf(`data-operating-prompt="${prompt}"`);
    ok(at > previous, `${prompt} is printed, in order`);
    previous = at;
  }
  ok(/data-operating-question="07"[^>]*data-operating-prompt="Balance after household budget"/.test(html),
    'Q07 is Balance after household budget');
  ok(html.includes(composer.money2(active.afterHouseholdBudget)),
    'Q07 prints the Forecast afterHouseholdBudget figure');
  const questions = [...html.matchAll(/data-operating-question="(\d+)"/g)].map(m => m[1]);
  ok(questions.length === 6 && questions.every(n => Number(n) <= 7) && !questions.includes('01'),
    'the active snapshot has six questions, numbered 02–07', questions.join(','));
  for (const prompt of REMOVED_ROWS) {
    ok(!html.includes(prompt), `${prompt} is not on the Plan`);
  }
  ok(!/data-payday-first-card|data-card-id=|data-payday-big-purchases|Other credit cards/.test(html),
    'no card row or big-purchase row is rendered (not merely hidden)');
  ok(!/operating-ending/.test(html),
    'no ending-styled row remains in the calendar waterfall');
  ok(!/Extra credit-card repayment|Big-purchase savings|Projected ending balance|Balance after debt repayment/
    .test(composer.calendarWaterfallHtml(active, data.liveOverlay, advice.paydayAllocation)),
  'calendarWaterfallHtml itself emits none of the four removed prompts');
  const both = composer.operatingSurfaceHtml({
    advice, weekly: advice.weekly, recommended: advice.weekly,
    liveOverlay: data.liveOverlay, planCalendarShow: 'both',
  });
  const sections = (both.match(/<section class="calendar-waterfall"/g) || []).length;
  const activeQs = (both.match(/data-calendar-role="active"[\s\S]*?<\/section>/) || [''])[0]
    .match(/data-operating-question=/g) || [];
  const futureQs = (both.match(/data-calendar-role="future"[\s\S]*?<\/section>/) || [''])[0]
    .match(/data-operating-question=/g) || [];
  ok(sections === (advice.defaultView.calendarPeriods || []).length
      && activeQs.length === 6
      && futureQs.length === 7
      && /data-live-current-balance/.test(both)
      && !REMOVED_ROWS.some(prompt => both.includes(prompt)),
    'Show both prints live Current Balance once, then the active snapshot without a Current Balance row and the future period with its opening');
  const planSrc = read('public/plan.js');
  const fn = /function calendarWaterfallHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(fn && !/'08'|'09'|'10'|'11'/.test(fn[0]) && !/projectedEnding|afterDebtRepayment/.test(fn[0]),
    'calendarWaterfallHtml stops at Q07 in source, not by CSS');
  ok(!/display:\s*none[^}]*operating-question|data-operating-question="(08|09|10|11)"[^}]*display:\s*none/
    .test(read('public/styles.css') + read('public/household-view.css')),
  'no stylesheet hides waterfall rows');
  const page = read('public/index.html');
  ok(!/extra debt and big purchases/.test(page)
      && /Live Current Balance, then this payday’s income, bills and household budget\./.test(page),
    'the Plan lede describes live Current Balance then the payday snapshot');
  ok(!/extra debt and big purchases/.test(planSrc),
    'the plan.js lede constant matches');
}

console.log('\n=== 6. Forecast still computes the chain past the household-budget boundary ===');
{
  const advice = currentAdvice();
  const alloc = advice.paydayAllocation;
  const periodsOut = advice.defaultView.calendarPeriods || [];
  const active = periodsOut.find(p => p.role === 'active');
  const next = periodsOut.find(p => p.role === 'future');
  ok(active && typeof active.afterDebtRepayment === 'number'
      && typeof active.projectedEnding === 'number'
      && active.extraDebt && typeof active.extraDebt.allocated === 'number'
      && Array.isArray(active.bigPurchases) && active.firstCard,
    'the active period still carries extraDebt, firstCard, bigPurchases, afterDebtRepayment, projectedEnding');
  const purchasesTaken = (active.bigPurchases || [])
    .reduce((s, r) => s + (Number(r.allocation) || 0), 0);
  const independentAfterDebt = Math.round((active.afterHouseholdBudget - active.extraDebt.allocated) * 100) / 100;
  const independentEnding = Math.round((independentAfterDebt - purchasesTaken) * 100) / 100;
  ok(near(active.afterDebtRepayment, independentAfterDebt),
    'afterDebtRepayment = afterHouseholdBudget − extraDebt.allocated (independent arithmetic)');
  ok(near(active.projectedEnding, independentEnding),
    'projectedEnding = afterDebtRepayment − Σ big-purchase allocation (independent arithmetic)');
  ok(next && next.openingKnown && near(next.opening, active.projectedEnding),
    'the next pay period still opens from the unprinted projected ending');
  ok(alloc && alloc.extraDebt && typeof alloc.extraDebt.allocated === 'number'
      && alloc.runningLeftover && typeof alloc.runningLeftover.afterDebtRepayment === 'number'
      && typeof alloc.runningLeftover.afterBigPurchases === 'number',
    'paydayAllocation.extraDebt and runningLeftover.afterDebtRepayment / afterBigPurchases remain');
  const forecastSrc = read('public/forecast.js');
  ok(/projectedEnding:\s*afterBigPurchases/.test(forecastSrc)
      && /afterDebtRepayment,/.test(forecastSrc)
      && /bigPurchases:\s*purchases\.items/.test(forecastSrc),
    'forecast.js still publishes projectedEnding, afterDebtRepayment and bigPurchases on each period');
}

console.log('\n=== 7. the shells are routable behind the incumbent session gate ===');
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
    server.on('error', reject);
  });
}
function startAtlas(env) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('server start timeout\n' + stderr));
    }, 8000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!settled && /listening/.test(stdout)) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stop: () => new Promise(done => {
            child.once('exit', () => done());
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, 2000);
          }),
        });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${stderr}`));
    });
  });
}
(async () => {
  const port = await freePort();
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/^(ATLAS_|LUNCHMONEY_)/.test(key)) delete env[key];
  }
  Object.assign(env, { SITE_PASSWORD: PASS, SESSION_SECRET: SECRET, PORT: String(port) });
  const atlas = await startAtlas(env);
  const base = `http://127.0.0.1:${port}`;
  try {
    for (const page of ['/credit.html', '/planning.html']) {
      const anon = await fetch(base + page, { redirect: 'manual' });
      ok(anon.status === 302 && /\/login$/.test(anon.headers.get('location') || ''),
        `${page} without a session redirects to /login`);
    }
    const login = await fetch(`${base}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `password=${encodeURIComponent(PASS)}`,
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    ok(login.status === 302 && /^hfd_session=/.test(cookie), 'synthetic login issues a session');
    for (const [page, label] of [['/credit.html', 'Credit'], ['/planning.html', 'Planning'], ['/', 'Plan']]) {
      const res = await fetch(base + page, { headers: { cookie } });
      const body = await res.text();
      const nav = siteNav(body);
      ok(res.status === 200 && nav
          && JSON.stringify(nav.map(l => [l.href, l.label])) === JSON.stringify(HOUSEHOLD_NAV)
          && nav.find(l => l.current).label === label,
        `${page} serves 200 with the household nav and ${label} current`);
      ok(/no-store/.test(res.headers.get('cache-control') || '')
          && /script-src 'self'/.test(res.headers.get('content-security-policy') || ''),
        `${page} carries the incumbent no-store and CSP headers`);
    }
    for (const script of ['/credit.js', '/planning.js']) {
      const res = await fetch(base + script, { headers: { cookie } });
      ok(res.status === 200, `${script} is served to a session`);
    }
    for (const page of ['/modellers.html', '/deepdive.html', '/records.html']) {
      const res = await fetch(base + page, { headers: { cookie } });
      ok(res.status === 200, `${page} remains routable to a session`);
    }
  } finally {
    await atlas.stop();
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
