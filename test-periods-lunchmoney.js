'use strict';

const assert = require('assert');
const Periods = require('./scripts/periods.js');

const data = {
  plan: {
    startingCash: {
      breakdown: [
        { id: 'chequing-a' },
        { id: 'chequing-b' },
        { id: 'savings' },
      ],
    },
  },
  debts: [
    { id: 'cashback', label: 'Cash Back Visa' },
    { id: 'mbna', label: 'Amazon Mastercard' },
  ],
};

const accountMap = {
  schema: 'atlas-provider-account-map/v1',
  provider: 'lunchmoney',
  scope: 'live',
  mappings: [
    { providerAccountId: 'cash-a-secret', atlasRole: 'household-cash', canonical: { collection: 'cash', id: 'chequing-a' } },
    { providerAccountId: 'cash-b-secret', atlasRole: 'household-cash', canonical: { collection: 'cash', id: 'chequing-b' } },
    { providerAccountId: 'savings-secret', atlasRole: 'household-cash', canonical: { collection: 'cash', id: 'savings' } },
    { providerAccountId: 'card-secret', atlasRole: 'revolving-credit', canonical: { collection: 'debts', id: 'cashback' } },
    { providerAccountId: 'mbna-secret', atlasRole: 'revolving-credit', canonical: { collection: 'debts', id: 'mbna' } },
    { providerAccountId: 'external-secret', atlasRole: 'household-external' },
  ],
};

const tx = (id, account, date, amount, categoryLabel, extra) => ({
  providerTransactionId: id,
  providerAccountId: account,
  date,
  amount,
  categoryLabel,
  pending: false,
  isIncome: false,
  excludeFromTotals: false,
  ...extra,
});

const transactions = [
  tx('grocery-id', 'cash-a-secret', '2026-02-01', 100, 'Groceries', { payee: 'Market Secret' }),
  tx('refund-id', 'cash-a-secret', '2026-02-02', -10, 'Groceries', { payee: 'Market Secret' }),
  tx('travel-id', 'cash-a-secret', '2026-02-03', 50, 'Lodging'),
  tx('transfer-id', 'cash-a-secret', '2026-02-04', 500, 'Transfer'),
  tx('income-id', 'cash-a-secret', '2026-02-05', -2000, 'Salary', { isIncome: true }),
  tx('payment-id', 'cash-a-secret', '2026-02-06', 400, 'Payment'),
  tx('paypal-id', 'cash-a-secret', '2026-02-07', 75, 'Shopping', { payee: 'PAYPAL Merchant Secret' }),
  tx('external-id', 'external-secret', '2026-02-08', 60, 'Shopping'),
  tx('unknown-id', 'cash-b-secret', '2026-02-09', 20, 'Owner Review Needed'),
  tx('interest-id', 'card-secret', '2026-02-10', 5, 'Interest Charge'),
  tx('fee-id', 'cash-b-secret', '2026-02-11', 3, 'Other Bank Fees'),
  tx('fee-reversal-id', 'cash-b-secret', '2026-02-12', -3, 'Other Bank Fees'),
  tx('card-spend-id', 'card-secret', '2026-02-10', 30, 'Shopping'),
  tx('pending-id', 'card-secret', '2026-02-13', 999, 'Shopping', { pending: true }),
];

const normalized = {
  transactionWindow: {
    startDate: '2025-02-18',
    endDate: '2026-08-24',
    complete: true,
  },
  transactions,
};

const spendingRows = [
  { iso: '2026-02-01', card: 'cashback', category: 'Shopping', type: 'discretionary', amount: '40' },
  { iso: '2026-02-10', card: 'cashback', category: 'Shopping', type: 'discretionary', amount: '4000' },
  { iso: '2026-03-01', card: 'cashback', category: 'Shopping', type: 'discretionary', amount: '5000' },
  { iso: '2025-08-01', card: 'amazon-mbna', category: 'Shopping', type: 'discretionary', amount: '25' },
];

const transactionRows = [
  { iso: '2026-02-02', card: 'cashback', kind: 'cost', merchant: 'INTEREST', amount: '7' },
  { iso: '2026-03-02', card: 'cashback', kind: 'cost', merchant: 'INTEREST', amount: '7000' },
  { iso: '2025-08-02', card: 'amazon-mbna', kind: 'cost', merchant: 'INTEREST', amount: '4' },
];

const built = Periods.buildLunchMoneyEvents({
  normalized,
  accountMap,
  data,
  spendingRows,
  transactionRows,
});

// Independent fixture arithmetic: accepted provider spending is
// 100 - 10 + 50 + 20 + 30; pre-provider card evidence adds 40 + 25.
// Interest is 5 + 7 + 4 and fees are 3. The deliberately huge overlapping
// rows must never appear.
const expectedSpend = (100 - 10 + 50 + 20 + 30) + (40 + 25);
const expectedInterest = 5 + 7 + 4;
const expectedFees = 3;
assert.strictEqual(expectedSpend, 255);
assert.strictEqual(expectedInterest, 16);
assert.strictEqual(expectedFees, 3);

assert.strictEqual(built.metadata.postedTransactions, 13, 'pending rows are not posted history');
assert.strictEqual(built.metadata.providerEventNet, 198, 'provider net must reconcile before fallback');
assert.strictEqual(built.metadata.fallbackCardEvents, 4, 'only pre-provider or uncovered-card evidence survives');
assert.strictEqual(built.metadata.categoryClaim, 'incomplete', 'unknown cleaned labels preserve uncertainty');
assert.strictEqual(built.metadata.uncategorisedTransactions, 1);
assert.strictEqual(built.metadata.uncategorisedNet, 20);
assert.deepStrictEqual(built.metadata.excluded, {
  transfer: 1,
  income: 1,
  debtPayment: 1,
  paypalFunding: 1,
  householdExternal: 1,
  reversal: 1,
});

const output = Periods.buildPeriods(built.events, '2026-08-24', built.metadata);
assert.strictEqual(output.periods.all.spendingTotal, expectedSpend);
assert.strictEqual(output.periods.all.interestTotal, expectedInterest);
assert.strictEqual(output.periods.all.feesTotal, expectedFees);
assert.strictEqual(output.periods.all.spending.find(row => row.label === 'Travel').total, 50,
  'travel must stay outside Fuel & transport');
assert.strictEqual(output.periods.all.spending.find(row => row.label === 'Uncategorised').type, 'unknown');
assert.strictEqual(output.monthly.find(row => row.m === '2025-08').cardsCovered, true);

const published = JSON.stringify(output);
for (const secret of ['cash-a-secret', 'card-secret', 'grocery-id', 'Market Secret', 'PAYPAL Merchant Secret']) {
  assert(!published.includes(secret), `aggregate output leaked provider evidence: ${secret}`);
}

assert.throws(() => Periods.buildLunchMoneyEvents({
  normalized: { ...normalized, transactionWindow: { ...normalized.transactionWindow, complete: false } },
  accountMap,
  data,
}), /incomplete or truncated/);

assert.throws(() => Periods.buildLunchMoneyEvents({
  normalized: { ...normalized, transactions: transactions.concat({ ...transactions[0] }) },
  accountMap,
  data,
}), /duplicate posted transaction id/);

assert.throws(() => Periods.buildLunchMoneyEvents({
  normalized: {
    ...normalized,
    transactions: [tx('unmapped-id', 'unmapped-secret', '2026-02-01', 1, 'Shopping')],
  },
  accountMap,
  data,
}), /unmapped provider account/);

console.log('Lunch Money historical actuals adapter reconciles independently and preserves boundaries');
