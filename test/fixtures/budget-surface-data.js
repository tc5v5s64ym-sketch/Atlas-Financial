'use strict';
// One invented household for the active Budget surface: no captured values,
// provider IDs, merchants or balances. Every dollar below is made up so the
// surface's figures can be reconciled against these inputs independently.
//
// Pay period Aug 14-27, 2026; household date Aug 20.
//   Received pay Aug 14: 2,600 (payroll, confirmed).
//   Expected partner pay Aug 25: 1,450 (estimated).
//   Bills in the period: mortgage 1,400 (Aug 15, paid), hydro 120 (Aug 18,
//   estimated, no payment linked), internet 85 (Aug 24), card minimum 60
//   (Aug 22). Floor: 300.
//   Spending: groceries 212.40 + 96.15, fuel 74.20, dining 38.75,
//   unassigned 22.99.
// Canonical opening Aug 13; the live overlay advances it to Aug 20.
// Opening balances follow independently from the Aug 20 observation:
//   bills account   1,215 - 2,600 pay + 1,400 mortgage            = 15
//   spending account  160 + 212.40 + 74.20 + 38.75 + 96.15 + 22.99 = 604.49
const AS_OF = '2026-08-20';
const OPENING = '2026-08-13';

function canonical() {
  return {
    meta: { asOf: OPENING, title: 'Synthetic Budget surface' },
    accounts: [], revolvingExtra: [],
    debts: [{ id: 'travelvisa', label: 'Synthetic card', structure: 'Revolving',
      secured: false, balance: 2000, pending: 0, limit: 5000, rate: 19.99 }],
    plan: {
      windowDays: 91,
      opening: { asOf: OPENING },
      startingCash: { breakdown: [
        { id: 'chequing-a', label: 'Synthetic bills account', value: 15 },
        { id: 'chequing-b', label: 'Synthetic spending account', value: 604.49 },
        { id: 'savings', label: 'Synthetic savings', value: 0 },
      ] },
      defaults: { targetBuffer: 300, extraDebtMonthly: 0, scenario: 'expected' },
      income: [
        { id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
          anchor: '2026-08-14', amount: 2600, confidence: 'confirmed' },
        { id: 'partner', label: 'Partner salary', frequency: 'monthly',
          day: 25, amount: 1450, confidence: 'estimated' },
      ],
      bills: [
        { id: 'mortgage', label: 'Mortgage', frequency: 'monthly', day: 15,
          amount: 1400, confidence: 'confirmed', payingAccount: 'chequing-a' },
        { id: 'hydro', label: 'Hydro', frequency: 'monthly', day: 18,
          amount: 120, confidence: 'estimated', payingAccount: 'chequing-a' },
        { id: 'internet', label: 'Internet', frequency: 'monthly', day: 24,
          amount: 85, confidence: 'confirmed', payingAccount: 'chequing-a' },
      ],
      obligations: [
        { id: 'card-minimum', label: 'Synthetic card minimum', debtId: 'travelvisa',
          effect: 'payment', frequency: 'monthly', day: 22, amount: 60, confidence: 'confirmed',
          payingAccount: 'chequing-a' },
      ],
      budget: { categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'],
          plannedPayday: 450, confidence: 'confirmed' },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Gas'],
          plannedPayday: 160, confidence: 'confirmed' },
        { id: 'restaurants', label: 'Eating out', class: 'discretionary', from: ['Restaurants'],
          plannedPayday: 120, confidence: 'confirmed' },
      ] },
      commitments: [
        { id: 'school-trip', label: 'School trip', date: '2026-09-12',
          amount: 400, confidence: 'confirmed' },
        { id: 'winter-tires', label: 'Winter tires', date: '2026-10-15',
          amount: 900, confidence: 'estimated' },
      ],
    },
  };
}

const map = { schema: 'atlas-provider-account-map/v1', provider: 'lunchmoney', scope: 'fixture',
  mappings: [
    { providerAccountId: '1001', canonical: { collection: 'cash', id: 'chequing-a' }, atlasRole: 'household-cash' },
    { providerAccountId: '1002', canonical: { collection: 'cash', id: 'chequing-b' }, atlasRole: 'household-cash' },
    { providerAccountId: '1003', canonical: { collection: 'cash', id: 'savings' }, atlasRole: 'household-cash' },
    { providerAccountId: '2001', canonical: { collection: 'debts', id: 'travelvisa' }, atlasRole: 'revolving-credit' },
  ] };

const tx = (id, account, date, amount, payee, category, extra = {}) => ({
  id, account_id: account, date, amount, payee, category_id: category,
  is_pending: false, status: 'cleared', ...extra,
});

function payload() {
  return { provider: 'lunchmoney', fetchedAt: AS_OF + 'T18:00:00.000Z',
    transactionWindow: { startDate: '2026-08-13', endDate: AS_OF, complete: true, hasMore: false, truncated: false },
    pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false, truncated: false },
    accounts: [
      { id: 1001, type: 'cash', balance: 1215 }, { id: 1002, type: 'cash', balance: 160 },
      { id: 1003, type: 'cash', balance: 0 }, { id: 2001, type: 'credit', balance: 2000, credit_limit: 5000 },
    ].map(a => ({ ...a, currency: 'cad', updated_at: AS_OF + 'T17:55:00.000Z' })),
    categories: [
      { id: 11, name: 'Groceries', is_income: false, exclude_from_totals: false },
      { id: 12, name: 'Gas', is_income: false, exclude_from_totals: false },
      { id: 13, name: 'Restaurants', is_income: false, exclude_from_totals: false },
      { id: 14, name: 'Shopping', is_income: false, exclude_from_totals: false },
      { id: 15, name: 'Income', is_income: true, exclude_from_totals: false },
      { id: 16, name: 'Housing', is_income: false, exclude_from_totals: false },
    ],
    transactions: [
      tx(92001, 1001, '2026-08-14', -2600, 'Synthetic payroll', 15),
      tx(92002, 1001, '2026-08-15', 1400, 'Synthetic mortgage', 16),
      tx(92003, 1002, '2026-08-16', 212.40, 'Synthetic grocer', 11),
      tx(92004, 1002, '2026-08-17', 74.20, 'Synthetic fuel stop', 12),
      tx(92005, 1002, '2026-08-18', 38.75, 'Synthetic diner', 13),
      tx(92006, 1002, '2026-08-19', 96.15, 'Synthetic market', 11),
      tx(92007, 1002, '2026-08-19', 22.99, 'Synthetic general store', 14),
    ],
  };
}

const identity = { schema: 'atlas-provider-transaction-identity/v1', rules: [
  { eventId: 'payroll', payeePattern: 'Synthetic payroll', atlasAccountId: 'chequing-a', direction: 'credit' },
  { eventId: 'mortgage', payeePattern: 'Synthetic mortgage', atlasAccountId: 'chequing-a', direction: 'debit' },
] };

// Savings accounts configured, starting allocations not yet confirmed: the
// state in which Forecast withholds new savings proposals.
function withheldSavings(data) {
  data.plan.savingsEarmarks = { version: 1, currency: 'CAD', pools: [
    { id: 'reserve-a', accountId: 'savings', label: 'Synthetic reserve A' },
    { id: 'reserve-b', accountId: 'synthetic-reserve-b', label: 'Synthetic reserve B' },
  ], history: [] };
  return data;
}

// The served /data.json packet, through the real observation and overlay.
// opts.unavailablePlan: the server's fail-closed packet for a refresh it
// could not trust — the dated Aug 13 opening, observed Aug 20.
// Independently invented deductions above period income: a confirmed levy
// in the Aug 14–27 window. Forecast must publish negative after-bills and
// after-household/final balances; the surface must not treat those as unknown.
function deficitPeriod(data) {
  data.plan.bills.push({
    id: 'levy', label: 'Synthetic levy', frequency: 'monthly', day: 16,
    amount: 5000, confidence: 'confirmed', payingAccount: 'chequing-a',
  });
  return data;
}

function served(opts = {}) {
  const Live = require('../../scripts/live-plan');
  const data = opts.withheldSavings ? withheldSavings(canonical())
    : opts.deficitPeriod ? deficitPeriod(canonical())
    : canonical();
  const overlay = Live.fromObservation({ data, payload: payload(), accountMap: map, identity });
  if (opts.unavailablePlan) {
    return Live.failedOverlay(canonical(), 'Synthetic refresh could not be trusted.', { report: overlay.report });
  }
  return overlay.data;
}

module.exports = { AS_OF, OPENING, canonical, payload, map, identity, served };
