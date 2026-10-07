'use strict';
// Invented native packet, not captured account or ledger values.
// H = 300.22 groceries + 220.15 dining = 520.37.
// F = 240.16 Weekly funding + 31.27 direct Bills + 88.43 confirmed backfill
//   = 359.86; remaining target = 160.51.
// Closing = 1373.29 + 643.17 - 93.41 - 27.19 - 160.51 = 1735.35.
const source = require('./budget-surface-data');
const AS_OF = '2026-08-20';
const START = '2026-08-14';
const tx = (id, account, date, amount, categoryLabel, extra = {}) => ({
  id, coverageRef: 'invented-' + id, account, atlasAccountId: account, date, amount,
  currency: 'cad', pending: false, categoryLabel,
  accountRole: account === 'travelvisa' ? 'revolving-credit' : 'household-cash',
  displayedPayee: 'Invented ' + id, ...extra,
});
function served() {
  const data = source.served();
  data.meta.title = 'Invented Bills period-end balance';
  const p = data.plan;
  p.opening = { asOf: AS_OF, priorAsOf: '2026-08-13', representedEvents: [{ id: 'payroll', date: START }] };
  p.startingCash.breakdown = [
    { id: 'chequing-a', label: 'Invented Bills', value: 1373.29 },
    { id: 'chequing-b', label: 'Invented Weekly', value: -411.19 },
    { id: 'savings', label: 'Invented Savings', value: 9999.99 },
  ];
  p.income = [
    { id: 'payroll', label: 'Payroll - Seaspan', frequency: 'biweekly', anchor: START, amount: 2107.13, confidence: 'confirmed' },
    { id: 'partner', label: 'Invented partner salary', frequency: 'monthly', day: 25, amount: 643.17, confidence: 'confirmed' },
  ];
  p.bills = [{ id: 'service', label: 'Invented service', frequency: 'once', date: '2026-08-24', amount: 93.41, confidence: 'confirmed', payingAccount: 'chequing-a' }];
  p.obligations = [];
  p.commitments = [{ id: 'cost', label: 'Invented commitment', date: '2026-08-23', amount: 27.19, confidence: 'confirmed', payingAccount: 'chequing-a' }];
  p.budget = { categories: [
    { id: 'groceries', label: 'Groceries', class: 'essential', from: ['Groceries'], plannedPayday: 300.22, confidence: 'confirmed' },
    { id: 'restaurants', label: 'Eating out', class: 'discretionary', from: ['Restaurants'], plannedPayday: 220.15, confidence: 'confirmed' },
  ] };
  p.cardPurchaseCoverage = {
    opening: { asOf: START, confirmed: true, currency: 'cad', fundingAccountId: 'chequing-a', purchases: [] },
    payments: [{ id: 'mixed-payment', confirmed: true, debitRef: 'invented-card-debit', creditRef: 'invented-card-credit',
      allocations: [{ purchaseRef: 'invented-card-purchase', amount: 88.43 }], otherAmount: 22.68, otherPurpose: 'prior-debt' }],
    refunds: [], reversals: [],
  };
  const packet = { schema: 'atlas-current-period-actuals/v1', observationAsOf: AS_OF,
    coverageStart: START, coverageThrough: AS_OF, transactionCoverage: 'complete', pendingCoverage: 'complete',
    representedActuals: [{ id: 'payroll', date: START, actual: -2107.13 }],
    transactions: [
      tx('weekly-debit', 'chequing-a', '2026-08-18', 240.16, 'Payment, Transfer', { displayedPayee: 'AB123 TFR-TO invented' }),
      tx('weekly-credit', 'chequing-b', '2026-08-18', -240.16, 'Payment, Transfer', { displayedPayee: 'AB123 TFR-FR invented' }),
      tx('direct-grocery', 'chequing-a', '2026-08-19', 31.27, 'Groceries'),
      tx('weekly-dining', 'chequing-b', '2026-08-19', 40.11, 'Restaurants'),
      tx('card-purchase', 'travelvisa', '2026-08-19', 88.43, 'Groceries'),
      tx('card-debit', 'chequing-a', AS_OF, 111.11, 'Credit Card Payment'),
      tx('card-credit', 'travelvisa', AS_OF, -111.11, 'Credit Card Payment'),
    ] };
  data.liveOverlay.currentPeriodActuals = packet;
  data.liveOverlay.effectiveAsOf = data.liveOverlay.observedAsOf = AS_OF;
  data.liveOverlay.operatingPlan = 'current';
  data.liveOverlay.observedCash = { complete: true, asOf: AS_OF,
    accounts: p.startingCash.breakdown.filter(r => r.id !== 'savings').map(r => ({ id: r.id, value: r.value, evidenceDate: AS_OF })) };
  return data;
}
function fixture() {
  const data = served();
  return { data, plan: data.plan, asOf: AS_OF, opts: { currentPeriodActuals: data.liveOverlay.currentPeriodActuals,
    debts: data.debts, observedCash: data.liveOverlay.observedCash } };
}
// Reviewer-selected independent cents, with a complete empty ledger to
// isolate native future requirements from observed funding reconciliation.
function requirementsServed() {
  const data = served(), p = data.plan;
  p.startingCash.breakdown[0].value = data.liveOverlay.observedCash.accounts[0].value = 823.47;
  p.startingCash.breakdown[1].value = data.liveOverlay.observedCash.accounts[1].value = -119.53;
  p.startingCash.breakdown[2].value = 777.19;
  p.income[0].amount = 1077.37; p.income[1].amount = 263.19;
  data.liveOverlay.currentPeriodActuals.representedActuals[0].actual = -1077.37;
  p.budget.categories[0].plannedPayday = 71.13; p.budget.categories[1].plannedPayday = 29.27;
  p.bills[0].amount = 17.23; p.commitments[0].amount = 9.41;
  data.liveOverlay.currentPeriodActuals.transactions = []; p.cardPurchaseCoverage.payments = [];
  return data;
}
function requirementsFixture() {
  const data = requirementsServed();
  return { data, plan: data.plan, asOf: AS_OF, opts: { currentPeriodActuals: data.liveOverlay.currentPeriodActuals,
    debts: data.debts, observedCash: data.liveOverlay.observedCash } };
}
module.exports = { served, fixture, requirementsServed, requirementsFixture, tx, AS_OF, START };
