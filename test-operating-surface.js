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
    grab(planSrc, /^function futurePlanRequirement\([\s\S]*?\n\}$/m, 'futurePlanRequirement'),
    grab(planSrc, /^function futurePlanTiming\([\s\S]*?\n\}$/m, 'futurePlanTiming'),
    grab(planSrc, /^function futureGravityHtml\([\s\S]*?\n\}$/m, 'futureGravityHtml'),
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

console.log('\n=== five ordered household operating questions ===');
{
  const { plan, asOf, advice, debtProjection } = currentResult();
  const composer = loadComposer();
  const target = plan.nextDollar && debtProjection.byId[plan.nextDollar.target];
  const rendered = composer.operatingSurfaceHtml({
    plan, asOf, advice, weekly: advice.weekly, recommended: advice.weekly,
    liveOverlay: data.liveOverlay, extraDebtTarget: target,
  });
  const prompts = [
    'What do I do now?',
    'What can we spend until next payday?',
    "What is today's money protecting?",
    'What debt is receiving surplus?',
    'What could make this answer wrong?',
  ];
  let previous = -1;
  for (const prompt of prompts) {
    const at = rendered.indexOf(prompt);
    ok(at > previous, `${prompt} appears in the required order`);
    previous = at;
  }
  ok((rendered.match(/data-operating-question=/g) || []).length === 5,
    'the default surface contains exactly five decision questions');
}

console.log('\n=== every displayed financial answer traces to incumbents ===');
{
  const { plan, advice, debtProjection } = currentResult();
  const composer = loadComposer();
  const target = plan.nextDollar && debtProjection.byId[plan.nextDollar.target];
  const rendered = composer.operatingSurfaceHtml({
    plan, asOf: data.meta.asOf, advice, weekly: advice.weekly,
    recommended: advice.weekly, liveOverlay: data.liveOverlay,
    extraDebtTarget: target,
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
    ok(rendered.includes('No debt is receiving surplus this period.'),
      'a zero incumbent allocation publishes that no debt receives surplus');
    ok(!target || !rendered.includes(target.label),
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
  const target = { label: 'Synthetic incumbent debt target' };
  const zeroAdvice = JSON.parse(JSON.stringify(advice));
  zeroAdvice.paydayAllocation.extraDebt.allocated = 0;
  const zero = composer.operatingSurfaceHtml({
    advice: zeroAdvice, liveOverlay: data.liveOverlay, extraDebtTarget: target,
  });
  ok(zero.includes('No debt is receiving surplus this period.'),
    'zero allocation explicitly says no debt receives surplus');
  ok(zero.includes('$0.00 extra debt allocated'),
    'zero allocation is rendered from the incumbent amount');
  ok(!zero.includes(target.label),
    'zero allocation does not turn the existence of a policy target into a payment');

  const positiveAdvice = JSON.parse(JSON.stringify(advice));
  positiveAdvice.paydayAllocation.extraDebt.allocated = 25;
  const positive = composer.operatingSurfaceHtml({
    advice: positiveAdvice, liveOverlay: data.liveOverlay, extraDebtTarget: target,
  });
  ok(positive.includes(target.label) && positive.includes('$25.00 extra'),
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
    && /extraDebtTarget: debtProj\.byId/.test(planSrc),
  'renderPlan wires the incumbent recommendation and debt projection into the surface');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
