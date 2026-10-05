'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const F = require('../public/forecast');
const fixture = require('./fixtures/planned-savings-clarity-data');
const stub = () => ({ innerHTML: '', value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, replaceChildren() {} });
const ctx = vm.createContext({ Forecast: F, console, setTimeout, clearTimeout, addEventListener() {},
  document: { getElementById: stub, querySelectorAll() { return []; }, addEventListener() {}, documentElement: { dataset: {}, style: {} } },
  localStorage: { getItem() { return null; }, setItem() {} }, location: { pathname: '/', search: '' } });
ctx.window = ctx; ctx.matchMedia = () => ({ matches: false, addEventListener() {} });
for (const script of ['app', 'bill-detail', 'savings-inventory', 'budget-surface', 'plan']) {
  if (script === 'bill-detail') vm.runInContext('App.boot=()=>{};', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/' + script + '.js'), 'utf8'), ctx);
}
for (const mode of ['ready', 'unconfirmed', 'gap', 'backed', 'pool-deficit', 'stale', 'backed-ready', 'range']) {
  const data = fixture(mode), original = JSON.stringify(data);
  const advice = F.recommend(data.plan, data.meta.asOf, {});
  const period = advice.payPeriodViews.find(p => p.timelineRole === 'current');
  const published = JSON.stringify(advice);
  ctx.probe = period; ctx.plan = data.plan;
  ctx.savings = { inventory: advice.savingsInventory, asOf: data.meta.asOf };
  const html = vm.runInContext('calendarWaterfallHtml(probe,null,null,plan,true,savings)', ctx);
  const section = html.split('data-budget-planned-savings-summary>')[1].split('</section>')[0];
  const glance = section.split('<details')[0];
  assert.match(section, /data-budget-savings-info><summary>Info<\/summary>/);
  assert.doesNotMatch(glance, /original payday|snapshot|attributable|Required this period:|Remaining this period:/);
  assert.doesNotMatch(glance, /\d{4}-\d{2}-\d{2}|data-budget-savings-contribution=/, 'no dates or period-fulfilled substitute for total stock');
  if (['ready', 'gap', 'unconfirmed', 'backed-ready'].includes(mode)) assert.match(html, /data-budget-goal-fulfillment-evidence="invented-cost-13"/, 'all obligations remain in evidence');
  if (period.plannedCostFunding.status === 'unavailable') {
    assert.match(glance, /Funding plan not confirmed/);
    assert.equal(period.plannedCostFunding.contribution, null);
    assert.match(glance, /data-budget-savings-proposed><span class="budget-v3-unknown">Unknown/, 'unknown period contributions are not filled from saved stock');
  }
  if (mode === 'unconfirmed') {
    assert.equal((glance.match(/data-budget-savings-total-goal=/g) || []).length, 4);
    assert.match(glance, /Invented classes/);
    assert.match(glance, /143\.00/);
    assert.match(glance, /data-budget-savings-total-saved><span class="budget-v3-unknown">Unknown/);
    assert.doesNotMatch(glance, /\$0\.00/);
  }
  if (['backed', 'pool-deficit', 'stale', 'range'].includes(mode)) {
    assert.equal((glance.match(/data-budget-savings-total-goal=/g) || []).length, 3, 'shared goal appears once');
    const trip = glance.split('data-budget-savings-total-goal="commitment:trip-a"')[1].split('</li>')[0];
    assert.match(trip, /403\.21/);
    if (['backed', 'range'].includes(mode)) assert.match(trip, /215\.04/, '16937 + 4567 independently backed cents across two pools');
    else assert.match(trip, /data-budget-savings-total-saved><span class="budget-v3-unknown">Unknown/, 'incomplete backing withholds whole goal');
    if (mode === 'range') assert.match(trip, /403\.21[\s\S]*500\.00/, 'both published range bounds stay visible');
  }
  if (mode === 'backed-ready') {
    assert.match(glance, /215\.04[\s\S]*600\.00[\s\S]*177\.96[\s\S]*Put away this period/);
    assert.equal(Math.round(period.plannedCostFunding.contribution * 100), 60000 + 13 * 1100 - (16937 + 4567) - 35000,
      'existing pool stock is used once; period contribution funds only the remaining requirement');
    const summary = html.split('data-operating-question="savings"')[1].split('</summary>')[0];
    assert.match(summary, /177\.96/, 'waterfall deduction remains selected-period proposal, not total saved stock');
    assert.doesNotMatch(summary, /215\.04|600\.00/);
    for (const mutate of [
      p => { p.plannedCostFunding.source = 'Unrelated calculator'; },
      p => { p.plannedCostFunding.basis = 'unrelated-period'; },
      p => { p.plannedCostFunding.asOf = '2026-08-13'; },
      p => { p.budgetProgress.currency = 'USD'; },
      p => { delete p.budgetProgress; },
      p => { delete p.budgetProgress; delete p.plannedCostFunding.asOf; },
    ]) {
      const mismatched = JSON.parse(JSON.stringify(period));
      mutate(mismatched); ctx.probe = mismatched;
      const before = JSON.stringify(mismatched);
      const withheld = vm.runInContext('calendarWaterfallHtml(probe,null,null,plan,true,savings)', ctx);
      assert.match(withheld.split('data-operating-question="savings"')[1].split('</summary>')[0], /Unavailable/);
      const compact = withheld.split('data-budget-planned-savings-summary>')[1].split('<details')[0];
      assert.match(compact, /Funding plan not confirmed/);
      assert.match(compact, /data-budget-savings-proposed><span class="budget-v3-unknown">Unknown/);
      assert.equal(JSON.stringify(mismatched), before, 'withholding does not alter the financial publication');
    }
    ctx.probe = period;
  }
  if (mode === 'ready') assert.equal(period.plannedCostFunding.contribution, 600 + 13 * 11 - 350);
  if (mode === 'gap') assert.match(glance, /Funding shortfall:/, 'material gap stays visible without opening Info');
  const inventory = ctx.savings.inventory;
  ctx.savings = { inventory, asOf: '2026-08-21' };
  assert.doesNotMatch(vm.runInContext('calendarWaterfallHtml(probe,null,null,plan,true,savings)', ctx), /data-budget-savings-total-goal=/, 'a mismatched inventory cannot supply total stock');
  assert.equal(JSON.stringify(data), original);
  assert.equal(JSON.stringify(advice), published, 'renderer does not alter any financial publication');
}
console.log('PASS Planned Savings: total pool-backed saved/needed distinct from period proposal, grouped targets/shared stock once, unknown/stale/deficit withholding, compact Info and immutable financial outputs');
