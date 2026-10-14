'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(root, 'public/forecast'));
const make = require('./fixtures/savings-selected-roster-data');
const money = n => '$' + n.toFixed(2);
const P = vm.createContext({ Forecast: F, money2: money, money, fmtDate: s => s });
vm.runInContext(fs.readFileSync(path.join(root, 'public/savings-inventory.js'), 'utf8'), P);
vm.runInContext(fs.readFileSync(path.join(root, 'public/plan.js'), 'utf8'), P);
function run(mode) {
  const x = make(mode), before = JSON.stringify(x);
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  assert.equal(JSON.stringify(x), before);
  return { x, advice };
}
function select(r, start) {
  const period = r.advice.payPeriodViews.find(p => p.start === start);
  return F.savingsFundingPublication(r.advice.savingsFunding,
    { asOf: r.x.asOf, advice: r.advice, periodId: period.id });
}
function rows(packet) { P.packet = packet; return vm.runInContext('budgetDailySavingsRows(packet,null)', P); }
for (const mode of ['ready', 'card', 'missing', 'stale']) {
  test(mode + ': inclusive planned retirement and remaining installment amount', () => {
    const r = run(mode), first = select(r, '2026-10-16'), second = select(r, '2026-10-30');
    assert.deepEqual(Array.from(rows(first), z => z.key), ['group:installments', 'commitment:later']);
    assert.deepEqual(Array.from(rows(first)[0].members), ['next@2026-10-30']);
    assert.equal(rows(first)[0].needed, 40); // 50 and 30 paid in the plan by Oct29; next40 remains.
    assert.deepEqual(Array.from(rows(second), z => z.key), ['commitment:later']);
    assert.equal(rows(second)[0].needed, 80);
    if (mode !== 'ready') {
      assert.equal(first.forecastClosing.status, 'unavailable');
      assert.equal(first.forecastClosing.stock, null);
      assert.equal(first.forecastClosing.trust, 'unknown');
      for (const row of rows(first)) { assert.equal(row.saved, null); assert.equal(row.thisPeriod, null); }
    }
    assert.equal(first.forecastClosing.actualSaved, null);
    assert.equal(first.forecastClosing.moneyMovementPermission, 'not-granted');
    assert.ok(first.plannedRequirements, 'Forecast publishes roster independently');
    for (const item of first.plannedRequirements.items) { assert.equal(item.saved, null); assert.equal(item.actualSaved, null); }
  });
  test(mode + ': both renderers and navigation replay leave current unchanged', () => {
    const r = run(mode), current = r.advice.savingsFunding;
    const currentBefore = JSON.stringify(current), currentHtml = (() => { P.packet = current;
      return vm.runInContext('budgetDailySavingsHtml(packet)', P); })();
    const first = select(r, '2026-10-16'); P.packet = first;
    P.context = { asOf: r.x.asOf, advice: r.advice,
      period: r.advice.payPeriodViews.find(p => p.start === '2026-10-16') };
    const budget = vm.runInContext('budgetDailySavingsHtml(packet)', P);
    const inventory = vm.runInContext('SavingsInventory.html(packet,context)', P);
    for (const html of [budget, inventory]) {
      assert.doesNotMatch(html, /Invented early installment|Invented boundary installment/);
      assert.match(html, /Invented next installment/);
    }
    select(r, '2026-10-30');
    P.packet = select(r, '2026-10-16');
    assert.equal(vm.runInContext('budgetDailySavingsHtml(packet)', P), budget);
    P.packet = current;
    assert.equal(vm.runInContext('budgetDailySavingsHtml(packet)', P), currentHtml);
    assert.equal(JSON.stringify(current), currentBefore);
    assert.equal(current.plannedRequirements, undefined);
  });
}
test('unqualified all-retired roster stays empty rather than reconstructing current goals', () => {
  const r = run('card'), p = select(r, '2026-11-13');
  assert.deepEqual(Array.from(rows(p)), []);
  P.packet = p;
  assert.match(vm.runInContext('budgetDailySavingsHtml(packet)', P), /No remaining Savings requirements/);
  assert.equal(p.forecastClosing.status, 'unavailable');
});
test('unknown planning date retains its requirement without invented retirement or cents', () => {
  const r = run('undated'), p = select(r, '2026-10-30');
  assert.ok(rows(p).some(row => row.key === 'commitment:later'));
  assert.equal(p.forecastClosing.status, 'unavailable');
});
test('selected roster cannot be replayed under another period boundary', () => {
  const r = run('card'), period = r.advice.payPeriodViews.find(p => p.start === '2026-10-16');
  const p = r.advice.savingsFunding.periodViews.find(p => p.id === period.id).packet;
  if (p.plannedRequirements) p.plannedRequirements.end = '2026-11-12';
  assert.equal(F.savingsFundingPublication(r.advice.savingsFunding,
    { asOf: r.x.asOf, advice: r.advice, periodId: period.id }), null);
});
test('partially retired installment group keeps two later members and no withheld contributions', () => {
  const x = make('card');
  x.plan.commitments.push({ id: 'last', label: 'Invented fourth installment', group: 'installments',
    date: '2026-11-04', amount: 60, confidence: 'confirmed', sinkingFund: true });
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const p = select({ x, advice }, '2026-10-16'), row = rows(p)[0];
  assert.equal(row.needed, 100); // only next40 + last60, not early50 + boundary30.
  assert.deepEqual(Array.from(row.members), ['next@2026-10-30', 'last@2026-11-04']);
  P.packet = p; P.row = row;
  const members = vm.runInContext('budgetSavingsRowMembers(packet,row)', P);
  assert.ok(members.members.every(m => m.item.saved === null && m.thisPeriod === null));
  assert.equal(p.forecastClosing.stock, null);
});
for (const damage of ['missing', 'row-money', 'item-money']) test('malformed planned roster ' + damage + ' fails closed', () => {
  const r = run('card'), period = r.advice.payPeriodViews.find(p => p.start === '2026-10-16');
  const p = r.advice.savingsFunding.periodViews.find(p => p.id === period.id).packet;
  if (damage === 'missing') delete p.plannedRequirements;
  if (damage === 'row-money') p.plannedRequirements.rows[0].forecastSaved = 1;
  if (damage === 'item-money') p.plannedRequirements.items[0].forecastContribution = 1;
  assert.equal(F.savingsFundingPublication(r.advice.savingsFunding,
    { asOf: r.x.asOf, advice: r.advice, periodId: period.id }), null);
});
test('overdue unproved cost stays visible without claiming actual settlement', () => {
  const x = make('card'); x.plan.commitments[0].date = '2026-10-06';
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, weeklyVariable: 0, debts: [] });
  const p = select({ x, advice }, '2026-10-30');
  assert.ok(p.plannedRequirements.items.some(i => i.id === 'early'));
  assert.equal(p.forecastClosing.status, 'unavailable');
});
