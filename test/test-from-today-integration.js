'use strict';
// Real observation -> reconciliation -> live overlay -> Forecast -> Budget
// renderer. Synthetic provider IDs and dollars only; no provider GET/write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Live = require('../scripts/live-plan');
const F = require('../public/forecast');
const fixture = require('./fixtures/budget-funding-data');
const AS_OF = '2026-08-20';
const data = fixture();
data.plan.bills.push({ id: 'synthetic-due', label: 'Synthetic due bill', frequency: 'once',
  date: '2026-08-19', amount: 100, confidence: 'confirmed' });
data.plan.startingCash.breakdown = [
  { id: 'chequing-a', label: 'Synthetic Bills', value: 800 },
  { id: 'chequing-b', label: 'Synthetic Weekly', value: 0 },
  { id: 'savings', label: 'Synthetic savings including silver', value: 5000 },
];
data.debts = [{ id: 'travelvisa', label: 'Synthetic card', structure: 'Revolving',
  secured: false, balance: 400, pending: 0, limit: 1000, rate: 20 }];
const map = { schema: 'atlas-provider-account-map/v1', provider: 'lunchmoney', scope: 'fixture',
  mappings: [
    { providerAccountId: '1001', canonical: { collection: 'cash', id: 'chequing-a' }, atlasRole: 'household-cash' },
    { providerAccountId: '1002', canonical: { collection: 'cash', id: 'chequing-b' }, atlasRole: 'household-cash' },
    { providerAccountId: '1003', canonical: { collection: 'cash', id: 'savings' }, atlasRole: 'household-cash' },
    { providerAccountId: '2001', canonical: { collection: 'debts', id: 'travelvisa' }, atlasRole: 'revolving-credit' },
  ] };
const payload = { provider: 'lunchmoney', fetchedAt: AS_OF + 'T18:00:00.000Z',
  transactionWindow: { startDate: '2026-08-14', endDate: AS_OF, complete: true, hasMore: false, truncated: false },
  pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false, truncated: false },
  accounts: [
    { id: 1001, type: 'cash', balance: 800 }, { id: 1002, type: 'cash', balance: 0 },
    { id: 1003, type: 'cash', balance: 5000 }, { id: 2001, type: 'credit', balance: 400, credit_limit: 1000 },
  ].map(a => ({ ...a, currency: 'cad', updated_at: AS_OF + 'T17:55:00.000Z' })),
  categories: [{ id: 11, name: 'Groceries', is_income: false, exclude_from_totals: false },
    { id: 12, name: 'Income', is_income: true, exclude_from_totals: false }],
  transactions: [
    { id: 91001, account_id: 2001, date: '2026-08-19', amount: 50,
      payee: 'Synthetic grocer', category_id: 11, is_pending: true, status: 'unreviewed' },
    { id: 91002, account_id: 1001, date: '2026-08-14', amount: -1000,
      payee: 'Synthetic payroll', category_id: 12, is_pending: false, status: 'cleared' },
    { id: 91003, account_id: 1001, date: '2026-08-18', amount: -125,
      payee: 'Synthetic irregular receipt', category_id: 12, is_pending: false, status: 'cleared' },
  ] };
const identity = { schema: 'atlas-provider-transaction-identity/v1', rules: [{
  eventId: 'synthetic-due', payeePattern: 'Synthetic due bill',
  atlasAccountId: 'chequing-a', direction: 'debit',
}] };
const original = JSON.stringify({ data, payload, map, identity });
const diskBefore = fs.readFileSync(require.resolve('../data.json'), 'utf8');
function refresh(source = payload) {
  const overlay = Live.fromObservation({ data, payload: source, accountMap: map, identity });
  assert.equal(overlay.writesCanonicalState, false);
  assert.equal(overlay.data.liveOverlay.applied, true);
  const d = overlay.data;
  const advice = F.recommend(d.plan, d.meta.asOf, { debts: d.debts,
    currentPeriodActuals: d.liveOverlay.currentPeriodActuals,
    operatingPlan: d.liveOverlay.operatingPlan });
  return { overlay, advice, current: advice.payPeriodViews.find(p => p.start === '2026-08-14') };
}
const first = refresh(), second = refresh();
const proposal = first.current.fromTodayFunding;
assert.equal(proposal.status, 'ready');
assert.equal(proposal.currentCash, 800, '125 irregular receipt and 1000 payroll already inside 800 cash');
assert.equal(proposal.remainingHousehold, 300 - 50);
assert.equal(proposal.operatingBills, 100, 'unsettled earlier bill remains reserved');
assert.equal(proposal.contribution, 600 - (1000 - 200 - 150 - 300));
assert.equal(first.current.plannedCostFunding.contribution, null);
assert.deepEqual(second.current, first.current, 'repeated provider refresh has no accumulation');
const duplicate = structuredClone(payload);
duplicate.transactions.push({ ...duplicate.transactions[2] });
assert.equal(refresh(duplicate).current.fromTodayFunding.contribution, null,
  'duplicate identity within one observation fails closed instead of creating another deposit');
assert.equal(first.overlay.data.debts[0].pending, 50);
assert.equal(JSON.stringify({ data, payload, map, identity }), original);
assert.equal(fs.readFileSync(require.resolve('../data.json'), 'utf8'), diskBefore);
const paidPayload = structuredClone(payload);
paidPayload.accounts[0].balance = 700;
paidPayload.transactions.push({ id: 91004, account_id: 1001, date: '2026-08-19', amount: 100,
  payee: 'Synthetic due bill', is_pending: false, status: 'cleared' });
const settled = refresh(paidPayload);
assert.ok(settled.overlay.data.plan.opening.representedEvents.some(e => e.id === 'synthetic-due'));
assert.equal(settled.current.fromTodayFunding.currentCash, 700);
assert.equal(settled.current.fromTodayFunding.operatingBills, 0);
assert.equal(settled.current.fromTodayFunding.availableNow, proposal.availableNow);
assert.equal(settled.current.fromTodayFunding.contribution, 250,
  'posting the bill and reducing cash releases only its existing hold');

// Execute the actual Budget page with its actual helpers. DOM boot is held
// for an explicit render, not replaced by a fake funding implementation.
const context = vm.createContext({ Forecast: F, console, addEventListener() {},
  document: { addEventListener() {}, querySelectorAll() { return []; },
    getElementById() { return null; }, documentElement: { dataset: {}, style: {} } },
  window: { addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; } },
  localStorage: { getItem() { return null; }, setItem() {} },
  location: { pathname: '/' },
});
vm.runInContext(fs.readFileSync(require.resolve('../public/app.js'), 'utf8'), context);
vm.runInContext('App.boot = () => {};', context);
vm.runInContext(fs.readFileSync(require.resolve('../public/plan.js'), 'utf8'), context);
context.row = first.current; context.plan = first.overlay.data.plan;
context.overlay = first.overlay.data.liveOverlay; context.alloc = first.advice.paydayAllocation;
const html = vm.runInContext('calendarWaterfallHtml(row, overlay, alloc, plan)', context);
assert.match(html, /From today · 2026-08-20/);
assert.match(html, /data-from-today="2026-08-20"/);
assert.match(html, /Proposed to set aside now<\/span><span>\$250\.00/);
assert.match(html, /Current chequing cash<\/span><span>\$800\.00/);
assert.match(html, /Remaining household needs<\/span><span>\$250\.00/);
assert.match(html, /data-from-today-period="2026-08-28"/);
assert.match(html, /no original funding snapshot/);
assert.match(html, /Shared savings and silver are not added/);
assert.match(html, /Actual saved and destination account: unknown/);
assert.equal((html.match(/data-operating-question=/g) || []).length, 6,
  'from-today proposal is outside the original payday arithmetic steps');
context.row = structuredClone(first.current);
context.row.fromTodayFunding.trust = 'estimated';
assert.match(vm.runInContext('calendarWaterfallHtml(row, overlay, alloc, plan)', context),
  /Proposed to set aside now<\/span><span>\$250\.00 ≈ estimated/);

const low = structuredClone(payload); low.accounts[0].balance = 100;
const short = refresh(low); context.row = short.current;
const shortHtml = vm.runInContext('calendarWaterfallHtml(row, overlay, alloc, plan)', context);
assert.match(shortHtml, /Proposals stop after the protected funding gap on 2026-08-20/);
assert.match(shortHtml, /2026-08-28 · Unavailable proposed/);
assert.doesNotMatch(shortHtml, /2026-08-28 · \$0\.00 proposed/);
console.log('PASS from-today integration: provider observation, read-only refresh, Forecast and real Budget rendering');
