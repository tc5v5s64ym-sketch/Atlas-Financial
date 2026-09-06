'use strict';
// Independent cash ledger for the PR #262 follow-up. Expected dollars are
// hand-worked literals, never obtained from another Forecast calculation.
const assert = require('assert/strict');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');
const START = '2026-08-28';
const AS_OF = '2026-09-04';

function plan(cash = 5000, mixed = false) {
  return {
    windowDays: 14, defaults: { targetBuffer: 0 },
    startingCash: { amount: cash },
    opening: {
      asOf: AS_OF, priorAsOf: START, representedEvents: [],
      paydaySnapshot: { periodStart: START, asOf: START, opening: 3000 },
    },
    income: [{ id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
      anchor: START, amount: 2000, confidence: 'confirmed' }],
    obligations: [], bills: [], commitments: [],
    budget: { categories: [
      { id: 'groceries', label: 'Groceries', class: 'essential',
        from: ['Groceries'], plannedWeekly: 450 },
      ...(mixed ? [
        { id: 'fuel', label: 'Fuel', class: 'essential',
          from: ['Fuel'], plannedPayday: 325 },
        { id: 'restaurants', label: 'Eating out', class: 'discretionary',
          from: ['Restaurants'], plannedPayday: 200 },
      ] : []),
    ] },
  };
}
function tx(amount, extra = {}) {
  return { id: 'grocery', date: '2026-09-01', amount, pending: false,
    categoryLabel: 'Groceries', confirmedGrocery: true,
    accountRole: 'household-cash', atlasAccountId: 'chequing-a', ...extra };
}
function packet(transactions, extra = {}) {
  return { schema: 'atlas-current-period-actuals/v1', observationAsOf: AS_OF,
    coverageStart: START, coverageThrough: AS_OF, pendingCoverage: 'complete',
    transactionCoverage: 'complete', transactions, ...extra };
}
function options(transactions, extra = {}) {
  return { debts: [], targetBuffer: 0, weeklyVariable: 0,
    currentPeriodActuals: packet(transactions), ...extra };
}
function check(name, cash, transactions, hold, calendarLeft, mixed = false) {
  const p = plan(cash, mixed);
  const opts = options(transactions);
  const a = F.paydayAllocation(p, AS_OF, opts);
  assert.equal(a.available, cash, name + ': posted cash is not replayed');
  assert.equal(a.essentials.wanted, hold, name + ': essential cash requirement');
  assert.equal(a.essentials.allocated, hold, name + ': funded requirement');
  assert.equal(a.identity, cash, name + ': allocation conservation');
  const rec = F.recommend(p, AS_OF, opts);
  assert.equal(rec.paydayAllocation.essentials.wanted, hold, name + ': recommend integration');
  const period = rec.defaultView.calendarPeriods.find(r => r.id === 'this-pay-period');
  assert.equal(period.available, 5000, name + ': frozen 3000 + 2000 income');
  assert.equal(period.afterHouseholdBudget, calendarLeft, name + ': PR #262 unchanged');
  console.log('PASS ' + name);
  return a;
}

// Frozen resources $5,000. Settled cash purchases reduce current cash.
// No purchase: 5000 - 900 = 4100. Under plan: 4400 - 300 = 4100.
// At plan: 4100 - 0 = 4100. Over plan: 4000 - 0 = 4000.
check('no actuals yet', 5000, [], 900, 4100);
const under = check('600 settled, under 900 plan', 4400, [tx(600)], 300, 4100);
check('900 settled, exactly at plan', 4100, [tx(900)], 0, 4100);
const over = check('1000 settled, 100 overspend', 4000, [tx(1000)], 0, 4000);
assert.equal(over.essentials.items[0].remaining, -100);
// Reapplying max(plan, actual) to CURRENT cash counts settled cash twice.
assert.equal(4400 - under.essentials.wanted, 4100);
assert.notEqual(4400 - 900, 4100);

const other = tx(250, { id: 'other', confirmedGrocery: false, categoryLabel: 'Gifts' });
check('Other Spending already left current cash', 4750, [other], 900, 3850);
// Cash: 5000 - 1000 groceries - 200 fuel - 250 dining - 100 Other = 3450.
// Essential future need: 0 groceries + 125 fuel. Dining is discretionary.
// Calendar load: 1000 + 325 + 250 + 100 = 1675; leftover 3325.
check('planned essentials, discretionary category, and Other', 3450, [
  tx(1000),
  tx(200, { id: 'fuel', confirmedGrocery: false, categoryLabel: 'Fuel', confirmedFuel: true }),
  tx(250, { id: 'dining', confirmedGrocery: false, categoryLabel: 'Restaurants' }),
  { ...other, amount: 100 },
], 125, 3325, true);

const pending = tx(600, { pending: true, pendingTreatment: 'unresolved' });
// Cash has NOT left: 5000 - (600 awaiting debit + 300 future groceries) = 4100.
// Current main instead holds only 300 and releases the pending 600.
check('pending cash must remain reserved', 5000, [pending], 900, 4100);
check('pending cash over plan must remain reserved', 5000, [{ ...pending, amount: 1000 }], 1000, 4000);
check('400 posted plus 600 pending cash', 4600, [
  tx(400), { ...pending, id: 'pending-second' },
], 600, 4000);
check('same purchase after cash settlement', 4400, [tx(600)], 300, 4100);

// Card purchases consume grocery capacity but do not debit chequing.
// Pending -> posted leaves $600 debt exposure and $300 future grocery need.
for (const state of ['pending', 'posted']) {
  const card = { id: 'card', label: 'Card', structure: 'Revolving',
    rate: 20, balance: state === 'posted' ? 600 : 0,
    pending: state === 'pending' ? 600 : 0, limit: 2000 };
  const a = F.paydayAllocation(plan(), AS_OF, options([
    tx(600, { accountRole: 'revolving-credit', atlasAccountId: 'card',
      pending: state === 'pending', pendingTreatment: state === 'pending' ? 'unresolved' : 'confirmed-settled' }),
  ], { debts: [card] }));
  assert.equal(a.available, 5000);
  assert.equal(a.essentials.wanted, 300);
  assert.equal(card.balance + card.pending, 600);
  assert.equal(F.utilisation([card]).rows[0].used, 600);
}

// Incumbent possible-replacement flags: confirmed spend counts posted once;
// the unresolved pending twin is not new identity or a second cash hold.
check('flagged pending/posted pair', 4400, [
  tx(600, { id: 'posted', pendingPostedDuplicate: true }),
  { ...pending, id: 'pending', pendingPostedDuplicate: true },
], 300, 4100);

// Exercise the real observer's directed identity and sanitized packet path.
const mapping = { mappings: [{ providerAccountId: 'synthetic-cash',
  atlasRole: 'household-cash',
  canonical: { collection: 'startingCash', id: 'chequing-a', field: 'value' } }] };
const rawPending = { providerTransactionId: 'p', providerAccountId: 'synthetic-cash',
  plaidTransactionId: 'pending-link', date: '2026-09-01', amount: '600',
  pending: true, payee: 'Walmart', originalName: 'Walmart', categoryLabel: 'Groceries' };
const rawPosted = { ...rawPending, providerTransactionId: 's', pending: false,
  plaidTransactionId: 'posted-link', pendingTransactionId: 'pending-link' };
function observed(rows) {
  return O.sanitizedCurrentPeriodActuals({ asOf: AS_OF,
    transactionWindow: { startDate: START, endDate: AS_OF, complete: true },
    pendingCoverage: { complete: true }, transactions: rows,
  }, { plan: plan(), accountMap: mapping, asOf: AS_OF });
}
const before = observed([rawPending]);
const after = observed([rawPending, rawPosted]);
assert.equal(before.transactions.length, 1);
assert.equal(after.transactions.length, 1, 'directed link collapses the pending identity');
assert.equal(before.transactions[0].accountRole, 'household-cash');
assert.equal(after.transactions[0].pending, false);
assert.equal(F.paydayAllocation(plan(), AS_OF, options([], { currentPeriodActuals: before })).essentials.wanted, 900);
assert.equal(F.paydayAllocation(plan(4400), AS_OF, options([], { currentPeriodActuals: after })).essentials.wanted, 300);

// Partial pending coverage retains every observed cash debit; it is qualified.
const partial = F.paydayAllocation(plan(), AS_OF, options([], {
  currentPeriodActuals: packet([pending], { pendingCoverage: 'partial' }),
}));
assert.equal(partial.actualsCoverage.remainingClaim, 'posted-only');
assert.equal(partial.essentials.wanted, 900);
// Existing split, account, and non-consumption rules apply to cash holds too.
check('split parent is not a second pending debit', 5000, [
  { ...pending, id: 'parent', isGroup: true },
  { ...pending, id: 'child', parentId: 'parent' },
], 900, 4100);
for (const extra of [
  { accountRole: 'household-external' }, { kindHint: 'transfer' },
  { kindHint: 'card-payment' }, { representedBill: true },
  { amount: -600 },
]) {
  const a = F.paydayAllocation(plan(), AS_OF, options([{ ...pending, ...extra }]));
  assert.equal(a.essentials.wanted, 900, 'excluded actual cannot change essential cash');
}
// An already-settled treatment is not still-unsettled cash.
check('incumbent confirmed-settled treatment', 4400, [
  { ...pending, pendingTreatment: 'confirmed-settled' },
], 300, 4100);
// No packet preserves the incumbent remaining-days planning fallback.
const absent = F.paydayAllocation(plan(), AS_OF, { debts: [], targetBuffer: 0, weeklyVariable: 0 });
assert.equal(absent.actualsCoverage.remainingClaim, 'unavailable');
assert.equal(absent.essentials.wanted, 450);
console.log('ALL CASH IDENTITY CHECKS PASSED');
