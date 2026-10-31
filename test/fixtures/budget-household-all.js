'use strict';
// Proof only. Production never imports this file. The ids and labels are
// the household categories the repository already names. The amounts are
// invented placeholders so a face proof can show every row Forecast
// prints from that list. Forecast's calendar allowlist, not this file,
// decides which rows appear.

const fx = require('./budget-surface-data');

const HOUSEHOLD_CATEGORIES = [
  ['groceries', 'Groceries', 'essential', ['Groceries']],
  ['fuel', 'Fuel & transport', 'essential', ['Gas']],
  ['household', 'Household supplies & utilities', 'essential', ['Household supplies']],
  ['health', 'Medical & health', 'essential', ['Medical']],
  ['telecom', 'Phones & internet', 'essential', ['Phones']],
  ['insurance', 'Insurance', 'essential', ['Insurance']],
  ['pets', 'Pets', 'essential', ['Pets']],
  ['propertytax', 'Property tax', 'reserve', ['Property tax']],
  ['tax', 'CRA instalments', 'reserve', ['CRA']],
  ['restaurants', 'Dining out & takeaway', 'discretionary', ['Restaurants']],
  ['shopping', 'Shopping', 'discretionary', ['Personal shopping']],
  ['dale-guilt-free', 'Dale guilt-free spending', 'discretionary', ['Dale personal']],
  ['amanda-guilt-free', 'Amanda guilt-free spending', 'discretionary', ['Amanda personal']],
  ['other-spend', 'Other spend', 'essential', ['Other named spend']],
  ['travel', 'Travel', 'discretionary', ['Travel']],
  ['sport', 'Children & sports', 'discretionary', ['Sports']],
  ['entertainment', 'Entertainment', 'discretionary', ['Entertainment']],
  ['subscriptions', 'Subscriptions', 'discretionary', ['Subscriptions']],
  ['school', 'School & clubs', 'essential', ['School']],
  ['paypal', 'PayPal — online & app spend', 'discretionary', ['PayPal']],
  ['uncategorised', 'Uncategorised', 'unknown', ['Uncategorised bucket']],
];

function budgetCategories() {
  return HOUSEHOLD_CATEGORIES.map(([id, label, cls, from], index) => ({
    id,
    label,
    class: cls,
    from,
    plannedPayday: 100 + index,
    confidence: 'confirmed',
  }));
}

function packet() {
  return fx.served({ budgetCategories: budgetCategories() });
}

module.exports = { HOUSEHOLD_CATEGORIES, budgetCategories, packet };
