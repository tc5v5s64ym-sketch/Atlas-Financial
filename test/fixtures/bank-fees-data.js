'use strict';
// Independently invented ledger. No household transaction, provider id or amount.
const source = require('./card-purchase-coverage-data');
module.exports = function fixture(amount = 80, location = 'card', paid = 0) {
  const x = source('before');
  x.data.plan.bills = [{ id: 'tdfees', label: 'Invented fee allowance', frequency: 'monthly',
    day: 30, amount: 24, payingAccount: 'chequing-a', confidence: 'confirmed' }];
  x.payload.categories = [{ id: 910, name: 'Bank fees', archived: false, is_group: false,
    is_income: false, exclude_from_totals: false, exclude_from_budget: false }];
  x.payload.transactions = [{ id: 80001, account_id: location === 'card' ? 3004 : 3001,
    date: x.asOf, amount, currency: 'cad', is_pending: false, category_id: 910,
    category_name: 'Bank fees', payee: 'Invented issuer cost' }];
  x.payload.accounts[0].balance = location === 'cash' ? 500 - amount : 500 - paid;
  x.payload.accounts[3].balance = location === 'card' ? 400 + amount - paid : 400;
  if (paid) {
    x.payload.transactions.push(
      { id: 80002, account_id: 3001, date: x.asOf, amount: paid, currency: 'cad',
        is_pending: false, payee: 'TFR-TO C/C', category_name: 'Credit Card Payment' },
      { id: 80003, account_id: 3004, date: x.asOf, amount: -paid, currency: 'cad',
        is_pending: false, payee: 'PAYMENT - THANK YOU', category_name: 'Credit Card Payment' });
    source.confirm(x, 'invented-fee-payment', 80002, 80003, [[80001, paid]]);
  }
  return x;
};
module.exports.ref = source.ref;
