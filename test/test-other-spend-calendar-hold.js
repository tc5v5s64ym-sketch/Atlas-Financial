'use strict';
/* Other spend $800/month publishes a Planned/hold row on Household Budget.
 *
 * Owner-stated 2026-09-18 plannedMonthly 800 lives on other-spend. After
 * #353 that owner target fed budgetBreakdown / trajectory but
 * CALENDAR_PERIOD_BUDGET_IDS omitted it, so Budget → Household budget
 * (calendar waterfall Q06) never printed Planned $800. This suite proves
 * the calendar allowlist now includes other-spend, the cycle Planned is
 * the independent 14-day scale of 800/month via incumbent
 * paydayCyclePlanned identity, and confirmation other-spending remains
 * a separate spent-only row when recon exists.
 *
 * Independent of calendarHouseholdBudget / paydayCyclePlanned (L-002):
 * expected cycle hold is 800 × 14 / (365.25/12). Do not copy live cents
 * as the specification (L-006). Do not change the $800 amount.
 *
 * `node test/test-other-spend-calendar-hold.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const live = require('../data.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const OTHER_MONTHLY = 800;
const OTHER_ID = 'other-spend';
const OTHER_LABEL = 'Other spend';
const CONFIRM_ID = 'other-spending';
const CALENDAR_MONTH_DAYS = 365.25 / 12;
const INDEPENDENT_CYCLE = roundCent(OTHER_MONTHLY * 14 / CALENDAR_MONTH_DAYS);
const PAYDAY = '2026-08-28';
const AS_OF = '2026-09-04';
const GIFT = 42.00;

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
    grab(planSrc, /^function householdBudgetCycleText\([\s\S]*?\n\}$/m, 'householdBudgetCycleText'),
    grab(planSrc, /^function householdBudgetMetric\([\s\S]*?\n\}$/m, 'householdBudgetMetric'),
    grab(planSrc, /^function householdBudgetCategoryHtml\([\s\S]*?\n\}$/m, 'householdBudgetCategoryHtml'),
    grab(planSrc, /^function calendarCurrentUnavailableHtml\([\s\S]*?\n\}$/m, 'calendarCurrentUnavailableHtml'),
    grab(planSrc, /^function calendarBudgetHtml\([\s\S]*?\n\}$/m, 'calendarBudgetHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ calendarBudgetHtml, money2 });`,
    { Forecast: F }
  );
}

function cats(plan) {
  return (plan && plan.budget && plan.budget.categories) || [];
}
function byId(plan, id) {
  return cats(plan).find(c => c && c.id === id) || null;
}
function budgetRow(period, id) {
  return ((period && period.householdBudget) || []).find(r => r && r.id === id) || null;
}
function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p && p.id === id) || null;
}
function actualsPacket(txs) {
  return {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: AS_OF,
    coverageStart: '2026-07-01',
    coverageThrough: AS_OF,
    pendingCoverage: 'complete',
    transactions: txs,
  };
}

function syntheticPlan() {
  return {
    defaults: { targetBuffer: 500 },
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: PAYDAY, representedEvents: [] },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: '2026-08-14', amount: 4264, confidence: 'confirmed',
    }],
    bills: [],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential',
          plannedWeekly: 450, ownerLine: 'Groceries' },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'],
          plannedPayday: 325, ownerLine: 'Fuel' },
        {
          id: OTHER_ID, label: OTHER_LABEL, class: 'essential',
          from: [], plannedMonthly: OTHER_MONTHLY, ownerLine: OTHER_LABEL,
          targetSource: 'owner-stated-2026-09-18',
        },
        { id: 'shopping', label: 'Shopping', class: 'discretionary',
          from: ['Shopping', 'Personal'] },
      ],
    },
  };
}

function giftTx() {
  return {
    id: 'tx-gift',
    date: PAYDAY,
    amount: GIFT,
    pending: false,
    categoryLabel: 'Gifts',
    accountRole: 'household-cash',
    displayedPayee: 'Unmapped Gift Shop',
    originalMerchant: 'Unmapped Gift Shop',
  };
}

function groceryTx() {
  return {
    id: 'tx-grocery',
    date: PAYDAY,
    amount: 100,
    pending: false,
    categoryLabel: 'Groceries',
    accountRole: 'household-cash',
    displayedPayee: 'Save-On-Foods',
    originalMerchant: 'Save-On-Foods',
  };
}

function recommend(plan, txs) {
  return F.recommend(plan, AS_OF, {
    targetBuffer: 500,
    debts: [],
    currentPeriodActuals: actualsPacket(txs || []),
  });
}

const composer = loadComposer();
ok(near(INDEPENDENT_CYCLE, 367.97),
  'independent: $800/month × 14 / calendar-month days is $367.97 per cycle');

console.log('\n=== 1. Allowlist / labels / glance membership ===');
{
  const src = read('public/forecast.js');
  const calendarIds = src.slice(
    src.indexOf('const CALENDAR_PERIOD_BUDGET_IDS = ['),
    src.indexOf('function householdBudgetSupportingSpendEligible('));
  const glanceIds = src.slice(
    src.indexOf('const DEFAULT_VIEW_BUDGET_IDS = ['),
    src.indexOf('const CALENDAR_PERIOD_BUDGET_IDS = ['));
  const labels = src.slice(
    src.indexOf('const DEFAULT_VIEW_BUDGET_LABELS = {'),
    src.indexOf('const DALE_GUILT_FREE_ID'));
  ok(/'other-spend'/.test(calendarIds),
    'CALENDAR_PERIOD_BUDGET_IDS includes other-spend');
  ok(!/'other-spending'/.test(calendarIds),
    'CALENDAR_PERIOD_BUDGET_IDS does not include confirmation other-spending');
  ok(/'other-spend': 'Other spend'/.test(labels),
    'DEFAULT_VIEW_BUDGET_LABELS labels other-spend as Other spend');
  ok(!/'other-spend'/.test(glanceIds),
    'DEFAULT_VIEW_BUDGET_IDS kitchen-counter glance omits other-spend');
  ok(/paydayCyclePlanned\(cat, windowStart, plan\)/.test(src),
    'calendar Household Budget still uses incumbent paydayCyclePlanned');
}

console.log('\n=== 2. Dale Budget → Household budget is the calendar waterfall ===');
{
  const planSrc = read('public/plan.js');
  const surface = grab(planSrc, /function operatingSurfaceHtml\([\s\S]*?\n\}/,
    'operatingSurfaceHtml');
  const waterfall = grab(planSrc, /function calendarWaterfallHtml\([\s\S]*?\n\}/,
    'calendarWaterfallHtml');
  ok(/look === 'this-period'/.test(surface)
      && /calendarWaterfallsHtml\(/.test(surface)
      && /question\('04', 'Household budget', householdBudgetHtml\(view\)\)/.test(surface)
      && /defaultWaterfalls \|\| historical \|\| carryoverTrend \? ''/.test(surface),
    'default this-period prints calendar waterfalls; glance householdBudgetHtml is the More-views ten-block only');
  ok(/q\('06', 'Household budget'/.test(waterfall)
      && /calendarBudgetHtml\(period\)/.test(waterfall),
    'Budget Household budget Q06 consumes calendarBudgetHtml(period.householdBudget)');
  const polish = read('public/budget-polish.js');
  ok(/question\('06'\)/.test(polish)
      && /atlas-household-budget-card/.test(polish),
    'Budget visual polish groups waterfall Q06 as the Household Budget card');
}

console.log('\n=== 3. Live JSON home is still plannedMonthly 800 with empty from ===');
{
  const row = byId(live.plan, OTHER_ID);
  ok(row && row.plannedMonthly === OTHER_MONTHLY
      && row.plannedPayday == null && row.plannedWeekly == null
      && Array.isArray(row.from) && row.from.length === 0
      && row.label === OTHER_LABEL,
    'live other-spend is still $800/month with empty from: []');
}

console.log('\n=== 4. Calendar items include other-spend Planned from 800/mo ===');
{
  const advice = recommend(syntheticPlan(), [groceryTx()]);
  const active = period(advice.defaultView, 'this-pay-period');
  const next = period(advice.defaultView, 'next-pay-period');
  const row = budgetRow(active, OTHER_ID);
  const groc = budgetRow(active, 'groceries');
  ok(active && active.spendingCycle && active.spendingCycle.start === PAYDAY,
    'active cycle is the independent Aug 28 payday window');
  ok(row && row.id === OTHER_ID && row.label === OTHER_LABEL
      && near(row.monthly, OTHER_MONTHLY)
      && near(row.planned, INDEPENDENT_CYCLE)
      && near(row.hold, INDEPENDENT_CYCLE)
      && near(row.spent, 0)
      && near(row.remaining, INDEPENDENT_CYCLE)
      && row.otherSpending !== true && row.needsConfirmation !== true,
    'calendar Other spend Planned/hold is the independent $800/month cycle scale',
    row ? JSON.stringify({
      planned: row.planned, hold: row.hold, spent: row.spent, monthly: row.monthly,
    }) : 'missing');
  ok(groc && near(groc.planned, 900) && near(groc.spent, 100),
    'Groceries still plans $900 and records the constructed $100 spent');
  const nextRow = budgetRow(next, OTHER_ID);
  ok(nextRow && near(nextRow.planned, INDEPENDENT_CYCLE)
      && nextRow.spent == null && nextRow.projected === true,
    'Next Pay Period still publishes Other spend Planned, projected, no invented spent');
  const glance = (advice.defaultView && advice.defaultView.householdBudget) || [];
  ok(!glance.some(r => r && r.id === OTHER_ID),
    'kitchen-counter glance still omits Other spend');
}

console.log('\n=== 5. Confirmation other-spending stays separate when recon exists ===');
{
  const advice = recommend(syntheticPlan(), [groceryTx(), giftTx()]);
  const active = period(advice.defaultView, 'this-pay-period');
  const planned = budgetRow(active, OTHER_ID);
  const confirm = (active.householdBudget || []).find(r => r && r.otherSpending);
  ok(planned && planned.id === OTHER_ID && near(planned.planned, INDEPENDENT_CYCLE)
      && near(planned.spent, 0) && !(planned.recon || []).some(t => t && t.id === 'tx-gift'),
    'planned other-spend does not absorb the Gifts residual');
  ok(confirm && confirm.id === CONFIRM_ID && confirm.label === 'Other spending'
      && confirm.note === 'Not yet assigned to a budget category'
      && confirm.planned == null && confirm.remaining == null
      && confirm.needsConfirmation === true && confirm.otherSpending === true
      && near(confirm.spent, GIFT) && near(confirm.hold, GIFT)
      && (confirm.recon || []).some(t => t && t.id === 'tx-gift'),
    'confirmation other-spending remains spent-only and keeps the Gifts recon');
  const reconIds = [];
  for (const row of active.householdBudget || []) {
    for (const tx of row.recon || []) {
      if (tx && tx.id) reconIds.push(tx.id);
    }
  }
  ok(new Set(reconIds).size === reconIds.length,
    'no transaction appears on two Household Budget rows');
  ok(planned.id !== confirm.id,
    'planned other-spend and confirmation other-spending are distinct ids');
}

console.log('\n=== 6. Adding the row moves Household Budget Total by the independent cycle hold ===');
{
  const withRow = recommend(syntheticPlan(), []);
  const withoutPlan = syntheticPlan();
  withoutPlan.budget.categories = withoutPlan.budget.categories
    .filter(c => c && c.id !== OTHER_ID);
  const without = recommend(withoutPlan, []);
  const a = period(withRow.defaultView, 'this-pay-period');
  const b = period(without.defaultView, 'this-pay-period');
  ok(a && b && !budgetRow(b, OTHER_ID) && budgetRow(a, OTHER_ID)
      && near(a.budgetHold - b.budgetHold, INDEPENDENT_CYCLE)
      && near(b.afterHouseholdBudget - a.afterHouseholdBudget, INDEPENDENT_CYCLE),
    'budgetHold / leftover after Household Budget move by independently $367.97',
    a && b ? `${a.budgetHold} vs ${b.budgetHold}` : 'missing');
}

console.log('\n=== 7. Page prints Planned on the calendar Other spend row ===');
{
  const advice = recommend(syntheticPlan(), [giftTx()]);
  const active = period(advice.defaultView, 'this-pay-period');
  const html = composer.calendarBudgetHtml(active);
  const block = html.split(/data-budget-category="/).slice(1)
    .map(chunk => 'data-budget-category="' + chunk)
    .find(chunk => chunk.startsWith('data-budget-category="other-spend"'));
  const confirmBlock = html.split(/data-budget-category="/).slice(1)
    .map(chunk => 'data-budget-category="' + chunk)
    .find(chunk => chunk.startsWith('data-budget-category="other-spending"'));
  ok(block && /<h3 class="household-budget-name">Other spend<\/h3>/.test(block)
      && block.includes(`>${composer.money2(INDEPENDENT_CYCLE)}<`)
      && /<dt>Planned<\/dt>/.test(block)
      && !/data-other-spending/.test(block),
    'calendar HTML prints Other spend Planned, not the confirmation attribute',
    block ? block.slice(0, 280) : 'missing');
  ok(confirmBlock && /data-other-spending/.test(confirmBlock)
      && /<h3 class="household-budget-name">Other spending<\/h3>/.test(confirmBlock)
      && /Not yet assigned to a budget category/.test(confirmBlock)
      && !/<dt>Planned<\/dt>/.test(confirmBlock)
      && confirmBlock.includes(`>${composer.money2(GIFT)}<`),
    'confirmation Other spending still prints spent-only beside it');
  const surfaceSrc = read('public/plan.js');
  ok(/function operatingSurfaceHtml/.test(surfaceSrc)
      && /calendarWaterfallsHtml/.test(surfaceSrc),
    'Budget operating surface still consumes the calendar waterfall HTML');
}

console.log('\n=== 8. Live calendar waterfall publishes Other spend Planned ===');
{
  const rec = F.recommend(live.plan, live.meta.asOf, {
    debts: live.debts || [],
  });
  const current = period(rec.defaultView, 'this-pay-period');
  const row = budgetRow(current, OTHER_ID);
  ok(row && row.label === OTHER_LABEL && near(row.planned, INDEPENDENT_CYCLE)
      && near(row.monthly, OTHER_MONTHLY)
      && row.otherSpending !== true,
    'live This Pay Period Household Budget includes Other spend Planned from 800/mo',
    row ? JSON.stringify({ planned: row.planned, monthly: row.monthly }) : 'missing');
  const glance = (rec.defaultView && rec.defaultView.householdBudget) || [];
  ok(!glance.some(r => r && r.id === OTHER_ID),
    'live kitchen-counter glance still omits Other spend');
}

if (failures) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nAll assertions passed.');
