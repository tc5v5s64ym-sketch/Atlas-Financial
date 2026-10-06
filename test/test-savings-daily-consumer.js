'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const F = require('../public/forecast'), fixture = require('./fixtures/savings-daily-consumer-data');
const stub = () => ({ innerHTML: '', value: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, replaceChildren() {} });
const ctx = vm.createContext({ Forecast: F, console, setTimeout, clearTimeout, addEventListener() {}, document: { getElementById: stub, querySelectorAll() { return []; }, addEventListener() {}, documentElement: { dataset: {}, style: {} } }, localStorage: { getItem() { return null; }, setItem() {} }, location: { pathname: '/', search: '' } });
ctx.window = ctx; ctx.matchMedia = () => ({ matches: false, addEventListener() {} });
for (const script of ['app', 'bill-detail', 'savings-inventory', 'budget-surface', 'plan']) {
  if (script === 'bill-detail') vm.runInContext('App.boot=()=>{};', ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/' + script + '.js'), 'utf8'), ctx);
}
vm.runInContext('state.targetBuffer=20;state.extraDebtMonthly=0;state.debts=[];', ctx);
for (const mode of ['ready', 'partial', 'full', 'multiple', 'returned', 'pending', 'unmatched', 'missing-stock', 'missing-cash', 'fully-backed', 'before-policy', 'saved-income']) {
  const data = fixture(mode), before = JSON.stringify(data);
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, ...data.liveOverlay });
  ctx.src = { plan: data.plan, debts: [], asOf: data.meta.asOf, advice, liveOverlay: data.liveOverlay, weekly: 40, weeklyOverride: 40 };
  const packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
  const expected = { ready: 80, partial: 50, full: 0, multiple: 30, returned: 0, 'fully-backed': 0, 'saved-income': 80 }[mode];
  assert.equal(packet.period.proposal, expected ?? null);
  assert.deepEqual(vm.runInContext('budgetDailySavingsFor(src)', ctx), packet, 'replace-only refresh');
  ctx.period = advice.payPeriodViews.find(p => p.timelineRole === 'current'); ctx.packet = packet;
  const html = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory:src.advice.savingsInventory,asOf:src.asOf})', ctx);
  assert.match(html, /data-budget-daily-savings/);
  assert.ok(html.indexOf('data-operating-question="07"') < html.indexOf('data-operating-question="savings"'));
  const proposal = html.split('data-budget-daily-proposal>')[1].split('</strong>')[0];
  if (expected == null) assert.match(proposal, /Unavailable/); else assert.match(proposal, new RegExp(expected.toFixed(2).replace('.', '\\.')));
  assert.match(html, /Earlier planning calculation &amp; obligation evidence/);
  assert.doesNotMatch(html, /data-operating-question="reserve-use"/);
  const upcoming = vm.runInContext('budgetUpcomingFundingHtml(src)', ctx);
  const today = upcoming.split('data-budget-funding-panel="today"')[1].split('data-budget-funding-panel="payday"')[0];
  if (expected == null) assert.match(today.split('data-budget-funding-proposal>')[1].split('</strong>')[0], /Unavailable/);
  else assert.match(today.split('data-budget-funding-proposal>')[1].split('</strong>')[0], new RegExp(expected.toFixed(2).replace('.', '\\.')));
  if (mode === 'partial') { assert.equal(packet.stock.amount, 149); assert.equal(packet.rows[0].saved, 125); assert.equal(packet.period.transferred, 30); }
  if (mode === 'saved-income') { assert.equal(packet.period.nativePeriodSurplus, 160); assert.equal(packet.period.entitlement, 80); assert.equal(ctx.period.afterHouseholdBudget, 160); }
  if (mode === 'missing-cash') assert.equal(packet.stock.amount, 119, 'cash uncertainty cannot erase observed stock');
  if (mode === 'before-policy') assert.match(html.split('data-operating-question="savings"')[1].split('</summary>')[0], /119\.00/, 'policy uncertainty cannot erase observed stock');
  if (mode === 'fully-backed') {
    assert.equal(packet.period.unassigned, 80);
    assert.match(html, /Unassigned capacity[\s\S]*80\.00/);
    assert.doesNotMatch(html, /Unassigned top-up/);
  }
  assert.equal(JSON.stringify(data), before, 'canonical fixture not mutated');
}

ctx.Forecast = { ...F, savingsDailyFunding() { throw new Error('Invented unavailable selector'); } };
ctx.packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
const failed = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory:src.advice.savingsInventory,asOf:src.asOf})', ctx);
assert.match(failed, /data-budget-daily-savings/);
assert.match(failed.split('data-budget-daily-proposal>')[1].split('</strong>')[0], /Unavailable/);
assert.doesNotMatch(failed, /data-operating-question="reserve-use"/);
ctx.Forecast = F;
const valid = vm.runInContext('budgetDailySavingsFor(src)', ctx);
for (const mutate of [p => { p.source = 'other'; }, p => { p.asOf = '2026-10-06'; }, p => { p.currency = 'USD'; }, p => { p.period.basis = 'after-proposals'; }, p => { p.period.start = '2026-10-16'; }, p => { p.moneyMovementPermission = 'granted'; }, p => { p.period.allocations = null; }, p => { p.period.allocations[0].amount = null; }, p => { p.period.cycleAllocations[0].amount = '80'; }]) {
  const invalid = JSON.parse(JSON.stringify(valid)); mutate(invalid);
  ctx.Forecast = { ...F, savingsDailyFunding: () => invalid };
  assert.equal(vm.runInContext('budgetDailySavingsFor(src).status', ctx), 'unavailable', 'invalid scope or authority never borrows legacy amounts');
}
console.log('PASS active current Budget/Savings consumer: twelve independent ledgers, replace-only refresh, transfer once, native surplus vs entitlement, unavailable evidence retained, publication boundary');
