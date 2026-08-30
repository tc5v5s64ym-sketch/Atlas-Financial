'use strict';
/* AF-OPERATE-07 — smallest missing acceptance proof for the complete
 * decision-first household operating experience.
 *
 * AF-OPERATE-01 through -06 already independently prove historical actuals,
 * the five-question surface, payday allocation identity, between-paydays
 * trust limits, future-gravity protection vs optional residual, and
 * required-debt vs extra-principal. This suite does not re-call those
 * Forecast authorities to "prove" themselves. It checks the composed
 * homepage contract that those slices left open: competing diagnostics are
 * collapsed, live overlay fail-closed is explicit, and the default surface
 * still renders incumbent answers without page-side arithmetic. `$0`
 * extra-debt allocation implies no extra-principal payment; it does not
 * imply that required contractual `requiredDebtPayments` disappear.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const O = require('./scripts/provider-observe.js');
const data = require('./data.json');
const periods = require('./public/periods.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, file), 'utf8'));
const exists = file => fs.existsSync(path.join(__dirname, file));

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
    grab(planSrc, /^function paydayActionRows\([\s\S]*?\n\}$/m, 'paydayActionRows'),
    grab(planSrc, /^function paydayCashNote\([\s\S]*?\n\}$/m, 'paydayCashNote'),
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
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function mustLeaveHtml\([\s\S]*?\n\}$/m, 'mustLeaveHtml'),
    grab(planSrc, /^function extraDebtGlanceHtml\([\s\S]*?\n\}$/m, 'extraDebtGlanceHtml'),
    grab(planSrc, /^function paydayAllocationSummaryHtml\([\s\S]*?\n\}$/m, 'paydayAllocationSummaryHtml'),
    grab(planSrc, /^function operatingSurfaceHtml\([\s\S]*?\n\}$/m, 'operatingSurfaceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ operatingSurfaceHtml, paydayCashNote, paydayCoverageNote, money, money2 });`,
    { Forecast: F }
  );
}

function currentAdvice() {
  const plan = data.plan;
  const asOf = data.meta.asOf;
  const priority = F.debtPriority(plan, data.debts);
  const advice = F.recommend(plan, asOf, {
    scenario: 'expected',
    targetBuffer: plan.defaults.targetBuffer,
    extraDebtMonthly: 0,
    disabled: [],
    fundingSources: plan.funding && plan.funding.options,
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    extraDebtTarget: priority.target && priority.target.id,
    periods,
    paypalPerMonth: data.paypal && data.paypal.perMonth,
  });
  return { plan, asOf, priority, advice };
}

function independentAvailable(plan, asOf) {
  const opening = (plan.startingCash.breakdown || [])
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  let sameDayIncome = 0;
  for (const row of plan.income || []) {
    if (row.frequency === 'once' && row.date === asOf) {
      sameDayIncome += Number(row.amount || 0);
    }
  }
  return opening + sameDayIncome;
}

function section(html, id) {
  const match = new RegExp(`<section id="${id}"[\\s\\S]*?<\\/section>`).exec(html);
  return match ? match[0] : '';
}

function question(html, number) {
  const start = html.indexOf(`data-operating-question="${number}"`);
  if (start < 0) return '';
  const end = html.indexOf('data-operating-question=', start + 1);
  const certainty = html.indexOf('data-operating-certainty', start + 1);
  const allocation = html.indexOf('data-payday-allocation-details', start + 1);
  let stop = html.length;
  if (end >= 0) stop = end;
  if (certainty >= 0 && certainty < stop) stop = certainty;
  if (allocation >= 0 && allocation < stop) stop = allocation;
  return html.slice(start, stop);
}

const PRIOR_SUITES = [
  ['AF-OPERATE-01', 'test-periods-lunchmoney.js'],
  ['AF-OPERATE-02', 'test-operating-surface.js'],
  ['AF-OPERATE-03', 'test-operate-payday-action-sheet.js'],
  ['AF-OPERATE-04', 'test-operate-between-paydays.js'],
  ['AF-OPERATE-05', 'test-operate-future-gravity.js'],
  ['AF-OPERATE-06', 'test-operate-debt-answer.js'],
];

console.log('=== campaign closeout and prior-slice proofs remain ===');
{
  const registry = read('test.js');
  for (const [id, file] of PRIOR_SUITES) {
    ok(exists(file), `${id} independent proof ${file} remains as regression`);
    ok(registry.includes(file), `${id} stays registered in npm test`);
  }
  ok(exists('docs/AF_OPERATE_PAYDAY_OPERATING_SURFACE_PLAN.md') === false,
    'the temporary AF-OPERATE campaign plan is deleted');
  ok(!exists('docs/.AF_OPERATE_07_DISPATCH.md'),
    'the temporary AF-OPERATE-07 dispatch file is deleted');
  ok(!exists('docs/AF_REFRESH_TRUSTED_STATE_LOOP_PLAN.md'),
    'the temporary AF-REFRESH campaign plan is deleted');
}

console.log('\n=== default homepage answers the operating questions first ===');
{
  const html = read('public/index.html');
  const operatingAt = html.indexOf('id="operating-surface"');
  const worksheetAt = html.indexOf('id="payday-answer"');
  const roadAt = html.indexOf('id="road-ahead"');
  const footerAt = html.indexOf('<footer>');
  const defaultSurface = html.slice(operatingAt, roadAt);
  const roadHead = html.slice(roadAt, html.indexOf('id="outlook"'));
  const road = html.slice(roadAt, footerAt);
  ok(operatingAt >= 0 && worksheetAt > operatingAt && roadAt > worksheetAt && footerAt > roadAt,
    'operating surface, then the collapsed worksheet, then Why / Road ahead');
  ok(/<h1>Payday operating sheet<\/h1>/.test(defaultSurface)
    && (html.match(/<h1[\s>]/g) || []).length === 1,
  'the only page h1 is the payday operating sheet');
  const worksheet = section(html, 'payday-answer');
  ok(worksheet && /<details class="disclose secondary-disclose">/.test(worksheet)
    && !/<details[^>]*\sopen(?:\s|>)/.test(worksheet)
    && /View full current-period worksheet/.test(worksheet),
  'the incumbent current-period worksheet stays a closed secondary disclosure');
  ok(/<summary>Why \/ Road ahead<\/summary>/.test(roadHead)
    && /<details class="disclose secondary-disclose">/.test(roadHead)
    && !/\sopen(?:\s|>)/.test(roadHead),
  'Why / Road ahead is a closed secondary disclosure');
  const competing = [
    'nextmove-card', 'hero-tiles', 'cap-headline', 'major-plans-list',
    'risk-list', 'plan-mission', 'snapshot-tiles',
  ];
  for (const id of competing) {
    ok(road.includes(`id="${id}"`) && !defaultSurface.includes(`id="${id}"`),
      `competing diagnostic ${id} lives only inside closed Why / Road ahead`);
  }
  ok(/Deep Dive/.test(html) && /Modellers/.test(html) && /Records/.test(html),
    'diagnostic pages that still serve a purpose remain linked');
}

console.log('\n=== composed surface: cash, identity, debt, protection, limits ===');
{
  const { plan, asOf, priority, advice } = currentAdvice();
  const composer = loadComposer();
  const alloc = advice.paydayAllocation;
  const action = advice.currentPeriodAction;
  const rendered = composer.operatingSurfaceHtml({
    plan, asOf, advice, weekly: advice.weekly, recommended: advice.weekly,
    liveOverlay: data.liveOverlay,
  });
  const independentCash = independentAvailable(plan, asOf);
  const creditHeadroom = (data.revolvingExtra || []).reduce((sum, row) => {
    const limit = Number(row && row.limit);
    return sum + (isFinite(limit) ? limit : 0);
  }, 0);
  const lineSum = (alloc.lines || []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const extraLine = (alloc.lines || []).find(row => row && row.key === 'extra-debt');
  const requiredItems = (alloc.requiredDebtPayments && alloc.requiredDebtPayments.items) || [];
  const q1 = question(rendered, '01');
  const q2 = question(rendered, '02');
  const q3 = question(rendered, '03');
  const q4 = question(rendered, '04');
  const q5 = question(rendered, '05');
  const q6 = question(rendered, '06');

  ok(action && action.mode === 'between-paydays',
    'the dated opening is between paydays, so current-period details stay behind Q6');
  ok(/data-payday-cash/.test(q1) && /Spendable cash\. Not credit\./.test(q1),
    'Q1 is the one Forecast spendable cash figure');
  ok(/data-payday-must-leave/.test(q2),
    'Q2 publishes required payday bills from paydayAllocation.obligations');
  ok(/data-spend-decision/.test(q3),
    'Q3 publishes Forecast.recommend weekly cap');
  ok(/data-payday-extra-debt/.test(q4),
    'Q4 publishes extra-debt only from paydayAllocation.extraDebt');
  ok(/data-payday-decision/.test(rendered) && /data-allocation-available/.test(rendered),
    'the incumbent payday allocation remains available in the allocation disclosure');
  ok(/data-current-period-action/.test(q6),
    'between-paydays currentPeriodAction stays under the next-move details');
  ok(near(independentCash, alloc.available),
    'available cash independently equals spendable opening plus same-day income');
  ok(creditHeadroom > 0 && alloc.available + 0.005 < independentCash + creditHeadroom,
    'available credit is not treated as household cash');
  ok(q1.includes(composer.money2(independentCash))
    && /Spendable cash\. Not credit\./.test(q1)
    && /dated opening/.test(q1)
    && !/live Lunch Money overlay/.test(q1)
    && !/Available in chequing/.test(q1)
    && /Overdraft and credit are not cash/.test(q1),
  'Q1 publishes that independent cash figure as dated-opening spendable cash, not credit, not an available-in-chequing headline, and not live overlay');
  ok(near(lineSum, alloc.allocatedTotal)
    && near(lineSum + Number(alloc.remainder), alloc.available),
  'independent allocation-line sum plus remainder equals available resources');
  ok(q3.includes(`${composer.money(action.weeklyCap)} / week`)
    && near(action.weeklyCap, advice.weekly),
  'Q3 spend permission is Forecast.recommend.weekly from the same recommend result');
  ok(/future-gravity|Still to cover before payday|No unsettled major future costs/.test(q5),
    "Q5 publishes today's protected future-cost answer from incumbent Forecast outputs");
  const protectionEnd = q5.indexOf("does not constrain today's safe-to-spend");
  const protectionBlock = q5.slice(0, protectionEnd < 0 ? q5.length : protectionEnd);
  for (const row of alloc.optional || []) {
    if (!row || !row.label || Number(row.allocated) > 0) continue;
    ok(!protectionBlock.includes(row.label),
      `zero optional residual ${row.id} is not labelled as protected current-period money`);
  }
  for (const item of requiredItems) {
    ok(q2.includes(item.label) && q2.includes(composer.money2(item.amount)),
      `Q2 required debt ${item.id} is the Forecast required item, not extra principal`);
    if (item.confidence === 'estimated') {
      ok(q2.includes('estimated'),
        `Q2 preserves the required-debt estimated trust state for ${item.id}`);
    }
    if (item.settlement === 'unverified') {
      ok(q2.includes('unverified'),
        `Q2 labels unverified ${item.id} as unverified`);
    }
  }
  ok(requiredItems.length >= 1,
    'Forecast still exposes requiredDebtPayments separately from extra principal');
  const extraAllocated = Number(alloc.extraDebt.allocated);
  ok((extraAllocated === 0 && !extraLine)
    || (extraLine && near(extraLine.amount, extraAllocated)),
    'zero extra principal adds no extra-debt line; a positive extra line equals Forecast.extraDebt.allocated');
  if (extraAllocated === 0) {
    ok(q4.includes('No extra debt this payday.')
      && !/Pay extra/.test(q4)
      && !/Extra debt money this payday goes to/.test(q4),
    '$0 extra-debt allocation implies no extra-principal payment');
    ok(!/Forecast has no required debt payment/.test(q5),
      '$0 extra principal does not imply required contractual debt payments disappear');
  } else {
    ok(q4.includes(composer.money2(alloc.extraDebt.allocated))
      && alloc.extraDebt.target && q4.includes(alloc.extraDebt.target.label),
    'positive extra principal names the Forecast-authorized target and amount');
  }
  ok(priority.status === 'ready' && priority.target
    && plan.nextDollar && plan.nextDollar.policy === 'true-surplus-highest-interest'
    && plan.nextDollar.target == null,
  'debt target comes from Forecast.debtPriority plus recorded owner policy, not a stored rank');
  ok(q4.includes(priority.target.label),
    'Q4 names the Forecast/owner-policy target');
  const coverage = composer.paydayCoverageNote(action);
  ok(/data-operating-certainty/.test(rendered) && rendered.includes(coverage)
    && /Transaction actuals were not supplied|unavailable|through/.test(coverage),
    'certainty block carries the incumbent between-paydays coverage limitation');
  ok(!data.liveOverlay,
    'the committed opening carries no applied live overlay to mistake for current live truth');
}

console.log('\n=== $0 extra-debt allocation does not erase required debt ===');
{
  const { advice } = currentAdvice();
  const composer = loadComposer();
  const required = ((advice.paydayAllocation.requiredDebtPayments
    && advice.paydayAllocation.requiredDebtPayments.items) || [])
    .filter(item => item && item.label && item.amount != null);
  ok(required.length >= 1,
    'the incumbent result still has requiredDebtPayments to preserve');
  const zeroAdvice = JSON.parse(JSON.stringify(advice));
  zeroAdvice.paydayAllocation.extraDebt.allocated = 0;
  const q2 = question(composer.operatingSurfaceHtml({
    advice: zeroAdvice, weekly: zeroAdvice.weekly, recommended: zeroAdvice.weekly,
  }), '02');
  const q4 = question(composer.operatingSurfaceHtml({
    advice: zeroAdvice, weekly: zeroAdvice.weekly, recommended: zeroAdvice.weekly,
  }), '04');
  for (const item of required) {
    ok(q2.includes(item.label) && q2.includes(composer.money2(item.amount)),
      `$0 extra principal still publishes required debt ${item.id}`);
  }
  ok(q4.includes('No extra debt this payday.')
    && !/Pay extra/.test(q4)
    && !/Extra debt money this payday goes to/.test(q4),
  '$0 extra-debt allocation implies no extra-principal payment');
  ok(!/No required bills are reserved this payday/.test(q2)
    && /data-payday-must-leave/.test(q2),
  '$0 extra principal leaves requiredDebtPayments visible and separate');
}

console.log('\n=== payday mode still uses the ordered allocation sheet ===');
{
  const { advice } = currentAdvice();
  const composer = loadComposer();
  const paydayAdvice = JSON.parse(JSON.stringify(advice));
  paydayAdvice.currentPeriodAction = Object.assign({}, paydayAdvice.currentPeriodAction, {
    mode: 'payday',
    todayActions: [],
    noMovementToday: false,
  });
  const html = composer.operatingSurfaceHtml({
    advice: paydayAdvice, weekly: paydayAdvice.weekly, recommended: paydayAdvice.weekly,
  });
  const q1 = question(html, '01');
  const q3 = question(html, '03');
  const q6 = question(html, '06');
  ok(/data-payday-cash/.test(q1) && !/data-allocation-available/.test(q1),
    'payday-mode Q1 stays the one spendable cash figure, not the allocation sheet');
  ok(/data-spend-decision/.test(q3),
    'payday-mode Q3 is the weekly cap');
  ok(/data-today-decision/.test(q6) && /data-allocation-available/.test(html),
    'a payday-mode result still renders the next move and keeps the ordered allocation sheet');
  ok(/What cash is this\?/.test(html) && /What can I spend this week\?/.test(html)
    && /Extra debt this payday\?/.test(html)
    && /Big purchases\?/.test(html)
    && /The next move\?/.test(html),
  'payday mode still answers the six payday-sheet questions in order');
}

console.log('\n=== live overlay cannot be authorized from committed git state ===');
{
  const committedMap = require('./docs/connectivity/provider-account-map.json');
  ok(Array.isArray(committedMap.mappings) && committedMap.mappings.length === 0,
    'the committed Lunch Money map contains no live account IDs');
  let reason = '';
  try {
    O.assertLiveMap(committedMap);
  } catch (err) {
    reason = String(err && err.message || err);
  }
  ok(/missing-required-cash-mapping/.test(reason),
    'the committed map fails closed and cannot authorize a live overlay',
    reason);
  ok(!exists('docs/connectivity/provider-account-map.local.json'),
    'this checkout has no local live account map');
  const composer = loadComposer();
  const note = composer.paydayCashNote({
    available: 100, asOf: data.meta.asOf, cashBasis: { asOf: data.meta.asOf },
  }, null);
  ok(/dated opening/.test(note) && /Spendable cash\. Not credit\./.test(note)
    && !/live Lunch Money overlay/.test(note),
  'absent overlay evidence is labelled a dated opening, not current live truth');
  const refused = composer.paydayCashNote({
    available: 100, asOf: data.meta.asOf, cashBasis: { asOf: data.meta.asOf },
  }, { applied: false });
  ok(/Live overlay not applied/.test(refused) && /dated opening/.test(refused),
    'a refused overlay stays visible as not applied');
}

console.log('\n=== the composed page remains a renderer ===');
{
  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(!!fn, 'operatingSurfaceHtml remains a bounded formatter');
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'the composed formatter calls no Forecast function');
  ok(fn && !/\.reduce\(|monthlyFromWeekly|projectDebts|fundingSequence/.test(fn[0]),
    'the composed formatter contains no page-side totals, conversions, or debt walk');
  ok(/operatingSurfaceHtml\(\{[\s\S]*?advice/.test(planSrc)
    && /refreshTrust: d\.refreshTrust/.test(planSrc),
  'renderPlan wires the incumbent recommendation and refresh-trust packet');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
