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
for (const mode of ['ready', 'partial', 'full', 'multiple', 'returned', 'pending', 'unmatched', 'missing-stock', 'missing-cash', 'fully-backed', 'before-policy', 'saved-income', 'ranged-need']) {
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
  if (mode === 'ranged-need') {
    assert.equal(packet.status, 'unavailable');
    const home = packet.rows.find(row => row.key === 'yearly-bill:home-cost');
    assert.equal(home.needed, 24, 'independent exact home requirement');
    assert.equal(home.trust, 'calculated');
    assert.equal(home.neededTrust, 'calculated', 'unavailable backing retains independent exact requirement trust');
    ctx.knownNeed = home;
    assert.match(vm.runInContext('budgetDailyNeededHtml(knownNeed)', ctx), /24\.00/);
    const homeHtml = html.split('data-budget-savings-total-goal="yearly-bill:home-cost"')[1].split('</li>')[0];
    assert.match(homeHtml.split('data-budget-savings-total-needed>')[1], /24\.00/);
    assert.match(homeHtml.split('data-budget-savings-total-saved>')[1].split('</span>')[0], /Unavailable/);
    assert.match(homeHtml.split('data-budget-savings-proposed>')[1].split('</span>')[0], /Unavailable/);
    assert.match(vm.runInContext('budgetSavingsGoalsHtml(src,period,null)', ctx), /24\.00/);
  }
  assert.equal(JSON.stringify(data), before, 'canonical fixture not mutated');
}

for (const row of [
  { needed: null, trust: 'calculated' }, { needed: '24', trust: 'calculated' },
  { needed: 24, trust: 'unknown' }, { needed: 24, neededTrust: 'unknown', trust: 'calculated' },
]) {
  ctx.knownNeed = row;
  assert.match(vm.runInContext('budgetDailyNeededHtml(knownNeed)', ctx), /Unavailable/, 'no coercion or override of explicit unknown requirement trust');
}

delete ctx.src.advice.savingsFunding;
ctx.packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
assert.equal(ctx.packet.stock, undefined, 'failed daily publication does not invent stock');
const failed = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory:src.advice.savingsInventory,asOf:src.asOf})', ctx);
assert.match(failed, /data-budget-daily-savings/);
assert.match(failed.split('data-budget-daily-proposal>')[1].split('</strong>')[0], /Unavailable/);
const failedStockCents = ctx.src.plan.savingsPoolObservation.accounts
  .reduce((sum, row) => sum + Math.round(row.value * 100), 0);
assert.match(failed.split('data-operating-question="savings"')[1].split('</summary>')[0],
  new RegExp((failedStockCents / 100).toFixed(2).replace('.', '\\.')),
  'daily publication failure cannot erase independently observed inventory stock');
assert.doesNotMatch(failed, /data-operating-question="reserve-use"/);
ctx.Forecast = F;
const readyData = fixture('ready');
ctx.src = { plan: readyData.plan, debts: [], asOf: readyData.meta.asOf,
  advice: F.recommend(readyData.plan, readyData.meta.asOf, { weeklyVariable: 40, ...readyData.liveOverlay }),
  liveOverlay: readyData.liveOverlay, weekly: 40, weeklyOverride: 40 };
const valid = vm.runInContext('budgetDailySavingsFor(src)', ctx);
ctx.period = ctx.src.advice.payPeriodViews.find(p => p.timelineRole === 'current');
const rejectedStockCents = ctx.src.plan.savingsPoolObservation.accounts
  .reduce((sum, row) => sum + Math.round(row.value * 100), 0);
const rejectedStockRe = new RegExp((rejectedStockCents / 100).toFixed(2).replace('.', '\\.'));
for (const mutate of [p => { p.source = 'other'; }, p => { p.asOf = '2026-10-06'; }, p => { p.currency = 'USD'; }, p => { p.period.basis = 'after-proposals'; }, p => { p.period.start = '2026-10-16'; }, p => { p.moneyMovementPermission = 'granted'; }, p => { p.period.allocations = null; }, p => { p.period.allocations[0].amount = null; }, p => { p.period.cycleAllocations[0].amount = '80'; }]) {
  const invalid = JSON.parse(JSON.stringify(valid)); mutate(invalid);
  ctx.src.advice.savingsFunding = invalid;
  ctx.packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
  assert.equal(ctx.packet.status, 'unavailable', 'invalid scope or authority never borrows legacy amounts');
  assert.equal(ctx.packet.stock, undefined, 'rejected daily packet does not invent stock');
  const withheld = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory:src.advice.savingsInventory,asOf:src.asOf})', ctx);
  assert.match(withheld.split('data-budget-daily-proposal>')[1].split('</strong>')[0], /Unavailable/);
  assert.match(withheld.split('data-operating-question="savings"')[1].split('</summary>')[0], rejectedStockRe,
    'rejected daily packet cannot erase independently observed inventory stock');
}
// A publication failure may preserve current verified stock, never stale or
// invalid inventory. These are independent inputs, not derived expected totals.
for (const failure of ['exception', 'currency', 'allocation']) {
  const rejected = JSON.parse(JSON.stringify(valid));
  if (failure === 'currency') rejected.currency = 'USD';
  if (failure === 'allocation') rejected.period.allocations[0].amount = null;
  ctx.src.advice.savingsFunding = failure === 'exception' ? undefined : rejected;
  ctx.packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
  assert.equal(ctx.packet.source, 'Budget.savingsDailyFundingUnavailable');
  for (const [label, mutate] of [
    ['verified current stock', () => {}],
    ['stale inventory', i => { i.asOf = '2026-10-04'; }],
    ['stale stock', i => { i.reportedStock.asOf = '2026-10-04'; }],
    ['foreign inventory currency', i => { i.currency = 'USD'; }],
    ['foreign stock currency', i => { i.reportedStock.currency = 'USD'; }],
    ['wrong inventory source', i => { i.source = 'other'; }],
    ['additive inventory', i => { i.nonAdditive = false; }],
    ['unknown stock evidence', i => { i.reportedStock.evidenceTrust = 'unknown'; }],
    ['nonnumeric stock', i => { i.reportedStock.amount = '119'; }],
    ['duplicate accounts', i => { i.reportedStock.accountIds = ['savings', 'savings']; }],
    ['missing pool', i => { i.pools.pop(); }],
  ]) {
    ctx.inventory = JSON.parse(JSON.stringify(ctx.src.advice.savingsInventory)); mutate(ctx.inventory);
    const html = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory,asOf:src.asOf})', ctx);
    assert.match(html.split('data-operating-question="savings"')[1].split('</summary>')[0],
      label === 'verified current stock' ? /119\.00/ : /Unavailable/, failure + ': ' + label);
    assert.match(html.split('data-budget-daily-proposal>')[1].split('</strong>')[0], /Unavailable/);
  }
  const today = vm.runInContext('budgetUpcomingFundingHtml(src)', ctx).split('data-budget-funding-panel="today"')[1].split('data-budget-funding-panel="payday"')[0];
  assert.match(today.split('data-budget-funding-proposal>')[1].split('</strong>')[0], /Unavailable/);
}
const nativeUnavailable = JSON.parse(JSON.stringify(valid));
nativeUnavailable.status = nativeUnavailable.period.status = 'unavailable';
nativeUnavailable.period.proposal = null;
Object.assign(nativeUnavailable.stock, { status: 'unavailable', amount: null, trust: 'unknown', evidenceTrust: 'unknown' });
ctx.src.advice.savingsFunding = nativeUnavailable;
ctx.packet = vm.runInContext('budgetDailySavingsFor(src)', ctx);
assert.equal(ctx.packet.source, 'Forecast.savingsDailyFunding', 'accepted native stock uncertainty retains its authority');
const nativeHtml = vm.runInContext('calendarWaterfallHtml(period,src.liveOverlay,null,src.plan,true,{daily:packet,inventory:src.advice.savingsInventory,asOf:src.asOf})', ctx);
assert.match(nativeHtml.split('data-operating-question="savings"')[1].split('</summary>')[0], /119\.00/, 'independently reported stock survives unavailable daily backing');
assert.match(nativeHtml.split('data-budget-daily-proposal>')[1].split('</strong>')[0], /Unavailable/);
console.log('PASS active current Budget/Savings consumer: thirteen independent ledgers, replace-only refresh, transfer once, native surplus vs entitlement, independently known requirement, publication boundary and guarded stock fallback');


// The second live page also refuses malformed shared metadata instead of
// borrowing a plausible legacy schedule. The valid schedule is an alias.
vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/plan-spend.js'),'utf8'),ctx);
ctx.spendAdvice=F.recommend(readyData.plan,readyData.meta.asOf,{weeklyVariable:40,...readyData.liveOverlay});
const spendPacket=ctx.spendAdvice.savingsFunding;
assert.equal(vm.runInContext('planSpendFundingSchedule(spendAdvice)',ctx),spendPacket.schedule);
for(const mutate of [p=>{p.source='other';},p=>{p.currency='USD';},p=>{p.moneyMovementPermission='granted';},
 p=>{p.rows=null;},p=>{p.schedule=null;}]) {
 const bad=JSON.parse(JSON.stringify(spendPacket));mutate(bad);ctx.spendAdvice.savingsFunding=bad;
 assert.equal(vm.runInContext('planSpendFundingSchedule(spendAdvice)',ctx).status,'unavailable');
 assert.match(vm.runInContext('planSpendPageHtml(spendAdvice,null).lede',ctx),/publication is unavailable/);
}
ctx.spendAdvice.savingsFunding=spendPacket;


// A missing selected-period child cannot substitute the current 119 stock.
ctx.src.advice=F.recommend(readyData.plan,readyData.meta.asOf,{weeklyVariable:40,...readyData.liveOverlay});
const future=ctx.src.advice.savingsFunding.periodViews.find(row=>row.role==='next');
assert.ok(future?.packet);delete future.packet;ctx.futureId=future.id;
const missingFuture=vm.runInContext('budgetDailySavingsFor(src,futureId)',ctx);
assert.equal(missingFuture.status,'unavailable');assert.equal(missingFuture.stock,undefined);
assert.equal(missingFuture.period.proposal,null,'no current offer is borrowed into a missing future publication');
