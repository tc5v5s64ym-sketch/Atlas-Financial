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
    assert.match(glance, /215\.04[\s\S]*600\.00[\s\S]*177\.96[\s\S]*Proposed this period/);
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
for (const mode of ['projection', 'projection-remaining', 'projection-missing-cash', 'projection-stale']) {
  const data = fixture(mode), original = JSON.stringify(data);
  const advice = F.recommend(data.plan, data.meta.asOf, {});
  const timeline = F.savingsFundingTimeline(data.plan, [], data.meta.asOf, { weeklyVariable: 35 });
  const current = advice.payPeriodViews.find(row => row.timelineRole === 'current');
  const render = (period = current, packet = timeline, inventory = advice.savingsInventory) => {
    ctx.probe = period; ctx.plan = data.plan;
    ctx.savings = { inventory, timeline: packet, asOf: data.meta.asOf };
    return vm.runInContext('calendarWaterfallHtml(probe,null,null,plan,true,savings)', ctx);
  };
  const publication = JSON.stringify({ advice, timeline });
  const html = render(), section = html.split('data-budget-planned-savings-summary>')[1].split('<details')[0];
  assert.equal((section.match(/data-budget-savings-total-goal=/g) || []).length, 3);
  assert.equal((section.match(/data-budget-savings-total-saved><span class="budget-v3-unknown">Unknown/g) || []).length, 3,
    'observed pool cash and projected location never become saved goal assignments');
  assert.match(section, /Funding plan not confirmed/);
  assert.match(html.split('data-operating-question="savings"')[1].split('</summary>')[0], /Unavailable/,
    'hypothetical contributions do not replace the incumbent Savings deduction');
  if (['projection', 'projection-remaining'].includes(mode)) {
    assert.match(section, /Hypothetical projection/);
    assert.match(section, /Actual contributions unknown/);
    const camp = section.split('data-budget-savings-total-goal="group:camp-a"')[1].split('</li>')[0];
    const annual = section.split('data-budget-savings-total-goal="yearly-bill:annual-a"')[1].split('</li>')[0];
    assert.match(camp, /280\.00/, 'two invented dated needs, 80 + 200, grouped by Forecast once');
    assert.match(camp, mode === 'projection' ? /270\.00/ : /0\.00/,
      'independent first ledger: 70 advance + 200 close; remaining fixture has zero capacity');
    assert.match(annual, mode === 'projection' ? /40\.00/ : /0\.00/, '70 need less 30 observed pool is a 40 hypothetical contribution');
    const undated = section.split('data-budget-savings-total-goal="commitment:undated-a"')[1].split('</li>')[0];
    assert.match(undated, /data-budget-savings-projection><span class="budget-v3-unknown">Unknown/);
    assert.match(section, mode === 'projection' ? /Projected this period/ : /Projected remaining period/);
    if (mode === 'projection-remaining') {
      assert.match(section, /data-budget-savings-projection-gap/);
      assert.match(html, /data-budget-savings-projection-gap-detail/);
    }
    assert.doesNotMatch(render({ ...current, operatingPlanUnavailable: true }), /data-budget-savings-projection/);
    assert.doesNotMatch(render({ ...current, timelineRole: 'past', lookback: true }), /data-budget-savings-projection/);
    const staleInventory = structuredClone(advice.savingsInventory);
    staleInventory.pools[0].observedTrust = 'unknown';
    assert.doesNotMatch(render(current, timeline, staleInventory), /data-budget-savings-projection/);
    const next = advice.payPeriodViews.find(row => row.timelineRole === 'next');
    const nextHtml = render(next);
    assert.match(nextHtml, /Projected this period/);
    assert.doesNotMatch(nextHtml, /Projected remaining period/);
    const past = advice.payPeriodViews.find(row => row.timelineRole === 'past');
    assert.doesNotMatch(render(past), /data-budget-savings-projection/);
    for (const mutate of [
      p => { p.source = 'Other'; }, p => { p.asOf = '2026-09-09'; }, p => { p.currency = 'USD'; },
      p => { p.status = 'unavailable'; }, p => { p.trust = 'calculated'; },
      p => { p.nature = 'confirmed'; }, p => { p.actionPermission = 'granted'; },
      p => { p.incrementalInstructions = 'ready'; }, p => { p.actualContributions = 0; },
      p => { p.payPeriods[0].cycleEnd = '2026-09-24'; }, p => { p.payPeriods[0].end = '2026-09-22'; },
      p => { p.payPeriods[0].windowKind = 'unsupported'; },
      p => { p.payPeriods.push(p.payPeriods[0]); },
    ]) {
      const changed = JSON.parse(JSON.stringify(timeline)); mutate(changed);
      assert.doesNotMatch(render(current, changed), /data-budget-savings-projection/, 'mismatched source, trust, permission or window withheld');
    }
    for (const mutate of [
      g => { g.actualSaved = 0; }, g => { g.actualContribution = 0; }, g => { g.trust = 'calculated'; },
      g => { g.projectedContribution = '270'; }, g => { g.projectedContribution = NaN; },
    ]) {
      const changed = structuredClone(timeline); mutate(changed.payPeriods[0].goals[0]);
      const row = render(current, changed).split('data-budget-savings-total-goal="group:camp-a"')[1].split('</li>')[0];
      assert.match(row, /data-budget-savings-projection><span class="budget-v3-unknown">Unknown/);
    }
  } else assert.doesNotMatch(html, /data-budget-savings-projection/, 'unknown cash and stale evidence do not supply a projection');
  assert.equal(JSON.stringify({ advice, timeline }), publication);
  assert.equal(JSON.stringify(data), original);
}
// Same-date reserve refresh must read current evidence rather than an older Month cache.
const refreshed = fixture('projection');
ctx.source = { plan: refreshed.plan, debts: [], asOf: refreshed.meta.asOf, weekly: 35, weeklyOverride: 35,
  advice: F.recommend(refreshed.plan, refreshed.meta.asOf, {}), revolvingExtra: [] };
assert.equal(vm.runInContext('budgetSavingsTimelineFor(source).status', ctx), 'ready');
delete ctx.source.plan.startingCash.breakdown[0].value;
assert.equal(vm.runInContext('budgetSavingsTimelineFor(source).status', ctx), 'unavailable');
console.log('PASS Planned Savings: independent grouped projection amounts, remaining/future/historical windows, unknown actuals, strict packet boundaries, same-date evidence refresh, incumbent deduction and immutable outputs');
