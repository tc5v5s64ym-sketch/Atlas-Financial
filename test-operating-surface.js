'use strict';
/* AF-OPERATE-02 — the homepage leads with five ordered operating answers,
 * composed from incumbent Forecast outputs. No page-side financial arithmetic.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
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
    `${source}\n({ operatingSurfaceHtml, paydayCoverageNote, money2 });`,
    { Forecast: F }
  );
}

function currentResult() {
  const plan = data.plan;
  const asOf = data.meta.asOf;
  const opts = {
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
  };
  const advice = F.recommend(plan, asOf, opts);
  const debtProjection = F.projectDebts(plan, data.debts, asOf,
    Object.assign({}, advice.simOptions, {
      weeklyVariable: advice.weekly,
      extraFacilities: data.revolvingExtra,
      extraDebtTarget: plan.nextDollar && plan.nextDollar.target,
    }));
  return { plan, asOf, advice, debtProjection };
}

console.log('=== homepage order and secondary detail ===');
{
  const html = read('public/index.html');
  const firstSection = /<section id="([^"]+)"/.exec(html);
  ok(firstSection && firstSection[1] === 'operating-surface',
    'the decision-first operating surface is the first homepage section');
  ok(html.indexOf('id="operating-surface"') < html.indexOf('id="payday-answer"')
    && html.indexOf('id="payday-answer"') < html.indexOf('id="outlook"'),
  'the full worksheet and outlook follow the operating surface');
  const detail = /<section id="payday-answer"[\s\S]*?<\/section>/.exec(html);
  ok(detail && /<details class="disclose secondary-disclose">/.test(detail[0])
    && /View full current-period worksheet/.test(detail[0]),
  'the incumbent detailed worksheet remains available in a closed secondary disclosure');
  for (const id of ['payday-answer-body', 'status-band', 'nextmove-card', 'cap-headline',
    'major-plans-list', 'risk-list', 'hero-ledger', 'balance-history']) {
    ok((html.match(new RegExp(`id="${id}"`, 'g')) || []).length === 1,
      `existing diagnostic mount ${id} remains exactly once`);
  }
}

console.log('\n=== six ordered payday-sheet questions ===');
{
  const { plan, asOf, advice, debtProjection } = currentResult();
  const composer = loadComposer();
  const rendered = composer.operatingSurfaceHtml({
    plan, asOf, advice, weekly: advice.weekly, recommended: advice.weekly,
    liveOverlay: data.liveOverlay,
  });
  const prompts = [
    'What cash is this?',
    'What must leave this payday?',
    'What can I spend this week?',
    'Extra debt this payday?',
    'Big purchases?',
    'The next move?',
  ];
  let previous = -1;
  for (const prompt of prompts) {
    const at = rendered.indexOf(prompt);
    ok(at > previous, `${prompt} appears in the required order`);
    previous = at;
  }
  ok((rendered.match(/data-operating-question=/g) || []).length === 6,
    'the default surface contains exactly six payday-sheet questions');
}

console.log('\n=== every displayed financial answer traces to incumbents ===');
{
  const { plan, advice, debtProjection } = currentResult();
  const composer = loadComposer();
  const target = advice.paydayAllocation.extraDebt.target;
  const rendered = composer.operatingSurfaceHtml({
    plan, asOf: data.meta.asOf, advice, weekly: advice.weekly,
    recommended: advice.weekly, liveOverlay: data.liveOverlay,
  });
  const independentCash = (plan.startingCash.breakdown || [])
    .reduce((sum, row) => sum + Number(row.value || 0), 0);
  ok(near(advice.paydayAllocation.available, independentCash),
    'incumbent payday available reconciles to the independent spendable-account sum');
  ok(rendered.includes(composer.money2(independentCash)),
    'the displayed available amount is that reconciled Forecast payday amount');
  ok(rendered.includes(`$${advice.weekly.toLocaleString('en-CA')} / week`),
    'the displayed spending answer is Forecast.recommend.weekly');
  const protectedLines = advice.paydayAllocation.lines.filter(row =>
    row.key !== 'extra-debt' && !String(row.key || '').startsWith('optional:'));
  for (const row of protectedLines) {
    ok(rendered.includes(row.label) && rendered.includes(composer.money2(row.amount)),
      `protected allocation renders incumbent line ${row.key}`);
  }
  const extra = advice.paydayAllocation.extraDebt.allocated;
  if (extra > 0) {
    ok(rendered.includes(composer.money2(extra) + ' extra'),
      'the displayed extra-debt amount is Forecast.paydayAllocation.extraDebt');
    ok(target && rendered.includes(target.label),
      'a positive allocation names the debt row from the incumbent Forecast debt projection');
  } else {
    ok(rendered.includes('No extra debt this payday.'),
      'a zero incumbent allocation publishes that no debt receives surplus');
    ok(!target || (rendered.includes(target.label)
      && !rendered.includes(`Pay extra`) && !rendered.includes(`Extra debt money this payday goes to ${target.label}`)),
    'a policy target is not presented as a payment when Forecast allocated zero');
  }
  const coverageCopy = composer.paydayCoverageNote(advice.currentPeriodAction);
  ok(rendered.includes(coverageCopy),
  'the limitations answer carries the incumbent current-period coverage state');
  for (const risk of advice.paydayAllocation.risks || []) {
    ok(rendered.includes(risk.reason) && rendered.includes(composer.money2(risk.shortfall)),
      `funding limitation renders incumbent risk ${risk.id}`);
  }
}

console.log('\n=== Q4 follows the incumbent extra-debt allocation ===');
{
  const { advice } = currentResult();
  const composer = loadComposer();
  const target = { label: 'Synthetic incumbent debt target', confidence: 'verified' };
  const zeroAdvice = JSON.parse(JSON.stringify(advice));
  zeroAdvice.paydayAllocation.extraDebt.allocated = 0;
  zeroAdvice.paydayAllocation.extraDebt.target = target;
  const zero = composer.operatingSurfaceHtml({
    advice: zeroAdvice, liveOverlay: data.liveOverlay,
  });
  ok(zero.includes('No extra debt this payday.'),
    'zero allocation explicitly says no debt receives surplus');
  ok(!zero.includes('$0.00 extra principal allocated this payday'),
    'zero surplus does not print a fake extra-principal payment amount on the glance');
  ok(zero.includes(target.label)
    && !zero.includes(`Pay extra`) && !zero.includes(`Extra debt money this payday goes to ${target.label}`),
    'zero allocation may name the current target but does not say it receives surplus');

  const positiveAdvice = JSON.parse(JSON.stringify(advice));
  positiveAdvice.paydayAllocation.extraDebt.allocated = 25;
  positiveAdvice.paydayAllocation.extraDebt.target = target;
  const positive = composer.operatingSurfaceHtml({
    advice: positiveAdvice, liveOverlay: data.liveOverlay,
  });
  ok(positive.includes(`Pay extra $25.00 to ${target.label} this payday`)
    && positive.includes('$25.00'),
    'positive allocation names the incumbent target and allocated amount');
}

console.log('\n=== page remains a renderer, not a financial authority ===');
{
  const planSrc = read('public/plan.js');
  const fn = /function operatingSurfaceHtml\([\s\S]*?\n\}/.exec(planSrc);
  ok(!!fn, 'the operating-surface formatter is a bounded readable function');
  ok(fn && !/\bForecast\.[A-Za-z]+\s*\(/.test(fn[0]),
    'the formatter calls no Forecast function and consumes the one result passed to it');
  ok(fn && !/\.reduce\(|monthlyFromWeekly|projectDebts|majorPlans|fundingSequence/.test(fn[0]),
    'the formatter contains no page-side totals, conversions, debt walk, or future-plan calculation');
  ok(/operatingSurfaceHtml\(\{[\s\S]*?advice/.test(planSrc)
    && !/extraDebtTarget: debtProj\.byId/.test(planSrc),
  'renderPlan wires the incumbent recommendation directly and supplies no page-selected target');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
