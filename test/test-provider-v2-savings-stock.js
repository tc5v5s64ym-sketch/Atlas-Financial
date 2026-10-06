'use strict';
// Raw invented v2 account evidence -> real observer -> Forecast -> active Budget.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.ATLAS_TEST_APP_ROOT || path.join(__dirname, '..');
const O = require(path.join(root, 'scripts/provider-observe'));
const F = require(path.join(root, 'public/forecast'));
const fx = require('./fixtures/savings-v2-observation-data');
let checks = 0;
function eq(a, b, why) { assert.deepEqual(a, b, why); checks++; }

// The exact date comes from provider evidence; sync/fetch time is diagnostic only.
function dateBoundaryChecks() {
const raw = { id: '9003', type: 'depository', balance: '95', currency: 'cad',
  balance_last_update: '2026-10-05T19:00:00Z', last_fetch: '2026-10-06T19:00:00Z',
  updated_at: '2026-10-04T19:00:00Z' };
const normalized = O.normalizeLunchMoneyAccount(raw);
eq(normalized.balanceLastUpdate, raw.balance_last_update, 'v2 balance date must survive normalization');
eq(O.postedBalanceEvidenceInstant(normalized), raw.balance_last_update,
  'posted evidence uses v2 semantic balance date ahead of generic object update');
eq(O.genericAccountEvidenceInstant(normalized), raw.updated_at, 'generic update dating stays unchanged');
eq(normalized.dateLastFetched, null, 'v2 sync timestamp is not silently made legacy balance evidence');
eq(O.postedBalanceEvidenceInstant(O.normalizeLunchMoneyAccount({ ...raw,
  balance_as_of: '2026-10-03T19:00:00Z' })), '2026-10-03T19:00:00Z', 'existing explicit balance_as_of precedence survives');
for (const value of ['not-a-date', '2026-02-30', '2026-02-30T19:00:00Z', '', 42, ['2026-10-05'], { date: '2026-10-05' }]) {
  eq(O.postedBalanceEvidenceInstant(O.normalizeLunchMoneyAccount({ ...raw, balance_last_update: value })), null,
    'malformed v2 date cannot fall back to a different update/sync timestamp');
}
}

const stub = () => ({ innerHTML: '', value: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, appendChild() {}, replaceChildren() {} });
const page = vm.createContext({ Forecast: F, console, setTimeout, clearTimeout, addEventListener() {},
  document: { getElementById: stub, querySelectorAll() { return []; }, addEventListener() {},
    documentElement: { dataset: {}, style: {} } },
  localStorage: { getItem() { return null; }, setItem() {} }, location: { pathname: '/', search: '' } });
page.window = page; page.matchMedia = () => ({ matches: false, addEventListener() {} });
for (const name of ['app', 'bill-detail', 'savings-inventory', 'budget-surface', 'plan']) {
  if (name === 'bill-detail') vm.runInContext('App.boot=()=>{};', page);
  vm.runInContext(fs.readFileSync(path.join(root, 'public/' + name + '.js'), 'utf8'), page);
}
vm.runInContext('state.targetBuffer=20;state.extraDebtMonthly=0;state.debts=[];', page);
const known = new Set(['valid-v2', 'legacy-date', 'offset-date', 'calendar-date', 'v2-over-update', 'sender-unknown', 'pending-movement']);
for (const mode of ['valid-v2', 'legacy-date', 'offset-date', 'calendar-date', 'v2-over-update', 'sender-unknown',
  'stale-date', 'future-date', 'malformed-date', 'malformed-type', 'impossible-date',
  'missing-date', 'sync-only', 'foreign-currency', 'missing-account', 'duplicate-account', 'pending-movement']) {
  const original = fx.input(mode), before = JSON.stringify(original);
  const report = O.observe({ provider: 'lunchmoney', ...original });
  eq(JSON.stringify(original), before, mode + ': raw input is unchanged');
  const data = { ...original.data, plan: { ...original.data.plan, savingsPoolObservation: report.savingsPools } };
  const advice = F.recommend(data.plan, data.meta.asOf, { weeklyVariable: 40, debts: data.debts, ...data.liveOverlay });
  page.src = { plan: data.plan, debts: data.debts, asOf: data.meta.asOf, advice,
    liveOverlay: data.liveOverlay, weekly: 40, weeklyOverride: 40 };
  const inventory = advice.savingsInventory;
  const daily = vm.runInContext('budgetDailySavingsFor(src)', page);
  page.period = advice.payPeriodViews.find(row => row.timelineRole === 'current'); page.packet = daily;
  const html = vm.runInContext('budgetSurfaceHtml(src)', page);
  const summary = html.split('data-operating-question="savings"')[1].split('</summary>')[0];
  assert.match(summary, known.has(mode) ? /119\.00/ : /Unavailable/, mode + ': actual active composer stock headline'); checks++;
  eq(inventory.observedStock.status, known.has(mode) ? 'ready' : 'unavailable', mode + ': independently dated stock gate');
  eq(inventory.observedStock.amount, known.has(mode) ? 95 + 24 : null, mode + ': only the two invented stocks, no partial sum');
  eq(daily.stock.status, known.has(mode) ? 'ready' : 'unavailable', mode + ': daily publisher retains independent stock truth');
  eq((html.match(/data-budget-surface="pay-period"/g) || []).length, 1, 'one active Budget renderer');
  eq(inventory.revision, null, 'date recovery never confirms a manual assignment');
  if (mode === 'sender-unknown') {
    eq(advice.cardMinimumPayments.status, 'unavailable', 'unknown card cash/minimum stays unknown');
    eq(daily.period.proposal, null, 'known savings stock does not recover spending/funding permission');
    assert.match(html.split('data-operating-question="07"')[1].split('</summary>')[0], /Unavailable/); checks++;
  }
  if (mode === 'pending-movement') {
    eq(inventory.observedStock.pendingState, 'unresolved', 'posted stock and pending movement remain distinct');
    eq(daily.period.proposal, null, 'pending movement never earns a funding proposal');
  }
  eq(JSON.stringify(original), before, mode + ': Forecast and renderer leave source unchanged');
}
dateBoundaryChecks();
console.log('PASS v2 observer -> Forecast -> active Budget stock: ' + checks + ' independent checks; semantic/legacy dates, unknown cash, pending, stale/future/malformed and identity/currency holds');
