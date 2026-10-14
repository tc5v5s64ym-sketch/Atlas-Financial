'use strict';
/* Dale 2026-10-14 (confirmed via Atlas, Slack ts 1792001200.601709):
 * fuel classification owner rules, superseding the 2026-09-23
 * convenience-store fail-closed rule.
 *
 *   1. An exact Lunch Money "Fuel" category is itself explicit fuel
 *      evidence. A 7-Eleven (or other convenience-store) purchase the
 *      owner categorized Fuel classifies as Fuel; it is no longer held
 *      for confirmation without a note / tag / MCC / kind hint.
 *   2. A 7-Eleven purchase over $30 classifies as Fuel. For that
 *      merchant the amount rule takes precedence over the transaction's
 *      other purchase category (Shopping, Fast Food, Household, ...).
 *      Exactly $30 does NOT fire the rule: the prior behaviour is
 *      preserved and pinned below. Under-$30 Fast Food at 7-Eleven
 *      stays Eating out (owner 2026-09-17 snack treatment).
 *
 * Boundaries kept: the amount rule is 7-Eleven only (Circle K and other
 * convenience stores are not swept); no Transportation / Ridesharing
 * aliases are added; non-purchase identities (income, refunds,
 * transfers, card payments) still return before any category rule;
 * owner guilt-free categories (Dale / Amanda) and the plan Business
 * exclusion still win over the merchant amount rule, as they do over
 * every merchant rule in the classification contract.
 *
 * Synthetic fixtures only. No provider access, no Lunch Money write.
 *
 * `node test/test-fuel-classification-owner-rules.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8')).plan;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

/* Raw shape: no precomputed flags; the classifier derives merchant
 * identity and evidence from the transaction's own fields. */
function rawTx(over) {
  return Object.assign({
    id: 'fuel-rules-raw-1', date: '2026-10-08', amount: 50.00, pending: false,
    categoryLabel: 'Fuel',
    payee: '7-Eleven', originalMerchant: '7-Eleven', displayedPayee: '7-Eleven',
    notes: null, tags: null, mcc: null, kindHint: null,
    isIncome: false, excludeFromTotals: false,
    accountRole: 'household-cash', atlasAccountId: 'chequinga', account: 'chequinga',
  }, over || {});
}

/* Packet shape: exactly the fields provider-observe publishes into the
 * canonical current-period packet, with flags as the observer stamps
 * them for an uncategorized-evidence 7-Eleven purchase. */
function packetTx(over) {
  return Object.assign({
    id: 'fuel-rules-packet-1', date: '2026-10-08', amount: 50.00, pending: false,
    categoryLabel: 'Fuel',
    displayedPayee: '7-Eleven', originalMerchant: '7-Eleven',
    isIncome: false, excludeFromTotals: false, excludeFromBudget: false,
    accountRole: 'household-cash', atlasAccountId: 'chequinga', account: 'chequinga',
    kindHint: null,
    dogFood: false, convenienceStore: true, canadianTire: false,
    groceryUncertain: false, groceryMixed: false, merchantKnown: true,
    fuelEvidence: false, confirmedGrocery: false, confirmedFuel: false,
    ownerConfirmedFuel: false,
  }, over || {});
}

function classify(tx) {
  return F.classifyCurrentPeriodTransaction(tx, plan, {});
}
function isFuel(cls) {
  return !!cls && cls.kind === 'spend' && cls.categoryId === 'fuel';
}
function describe(cls) {
  return cls ? `${cls.kind}/${cls.categoryId}/${cls.includeReason || cls.reason}` : 'null';
}

console.log('\n=== rule 1: an exact Fuel category is explicit fuel evidence ===');
{
  const packet = classify(packetTx({}));
  ok(isFuel(packet) && packet.includeReason === 'fuel-category',
    'packet: 7-Eleven + Fuel category, no corroborating flag -> Fuel',
    describe(packet));
  const raw = classify(rawTx({}));
  ok(isFuel(raw) && raw.includeReason === 'fuel-category',
    'raw: 7-Eleven + Fuel category, no note/tag/MCC -> Fuel',
    describe(raw));
  const circleK = classify(rawTx({
    payee: 'Circle K', originalMerchant: 'Circle K', displayedPayee: 'Circle K',
  }));
  ok(isFuel(circleK) && circleK.includeReason === 'fuel-category',
    'raw: Circle K + Fuel category -> Fuel (the gate admission is the evidence rule, not a 7-Eleven sweep)',
    describe(circleK));
  const noMerchant = classify(rawTx({
    payee: '', originalMerchant: null, displayedPayee: null,
  }));
  ok(isFuel(noMerchant) && noMerchant.includeReason === 'fuel-category',
    'raw: Fuel category with no merchant identity -> Fuel (the category is the evidence; fuel-merchant-missing no longer holds it)',
    describe(noMerchant));
  const noted = classify(rawTx({ notes: 'Fuel for the truck' }));
  ok(isFuel(noted) && noted.includeReason === 'fuel-category',
    'control: 7-Eleven + Fuel + fuel note still Fuel',
    describe(noted));
  const ownerExact = classify(packetTx({
    date: '2026-09-22', amount: 75.00, atlasAccountId: 'chequingb', account: 'chequingb',
  }));
  ok(isFuel(ownerExact) && ownerExact.includeReason === 'fuel-merchant',
    'control: the exact owner-confirmed September 2026 transaction still classifies by identity first',
    describe(ownerExact));
  const flags = F.classifyCurrentPeriodTransaction.derivedFlags(rawTx({}));
  ok(flags.fuelEvidence === true && flags.convenienceStore === true,
    'derivedFlags: the observer now stamps fuelEvidence for an exact Fuel category',
    JSON.stringify({ fuelEvidence: flags.fuelEvidence, convenienceStore: flags.convenienceStore }));
}

console.log('\n=== rule 2: a 7-Eleven purchase over $30 is Fuel, ahead of its purchase category ===');
{
  const shopping = classify(rawTx({ categoryLabel: 'Shopping', amount: 44.19 }));
  ok(isFuel(shopping) && shopping.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $44.19 Shopping -> Fuel (conflicting purchase category overridden)',
    describe(shopping));
  const shoppingPacket = classify(packetTx({ categoryLabel: 'Shopping', amount: 44.19 }));
  ok(isFuel(shoppingPacket) && shoppingPacket.includeReason === 'seven-eleven-over-threshold-fuel',
    'packet: 7-Eleven $44.19 Shopping -> Fuel through the canonical packet shape',
    describe(shoppingPacket));
  const justOver = classify(rawTx({ categoryLabel: 'Shopping', amount: 30.01 }));
  ok(isFuel(justOver) && justOver.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $30.01 Shopping -> Fuel (strictly over the threshold)',
    describe(justOver));
  const fastFoodOver = classify(rawTx({ categoryLabel: 'Fast Food', amount: 35.00 }));
  ok(isFuel(fastFoodOver) && fastFoodOver.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $35.00 Fast Food -> Fuel (amount rule beats the eating-out gate over the threshold)',
    describe(fastFoodOver));
  const household = classify(rawTx({ categoryLabel: 'Household', amount: 50.00 }));
  ok(isFuel(household) && household.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $50.00 Household -> Fuel',
    describe(household));
  const groceries = classify(rawTx({ categoryLabel: 'Groceries', amount: 50.00 }));
  ok(isFuel(groceries) && groceries.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $50.00 Groceries -> Fuel',
    describe(groceries));
  const noCategory = classify(rawTx({ categoryLabel: null, amount: 50.00 }));
  ok(isFuel(noCategory) && noCategory.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $50.00 with no category -> Fuel (any purchase over $30 at 7-Eleven)',
    describe(noCategory));
  const variant = classify(rawTx({
    categoryLabel: 'Shopping', amount: 50.00,
    payee: '7-ELEVEN 4451', originalMerchant: '7-ELEVEN 4451', displayedPayee: '7-ELEVEN 4451',
  }));
  ok(isFuel(variant) && variant.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: "7-ELEVEN 4451" $50.00 Shopping -> Fuel (store-number merchant variant)',
    describe(variant));
  const fuelOver = classify(rawTx({ amount: 50.00 }));
  ok(isFuel(fuelOver) && fuelOver.includeReason === 'fuel-category',
    'raw: 7-Eleven $50.00 Fuel keeps the fuel-category path (the amount rule does not relabel Fuel itself)',
    describe(fuelOver));
}

console.log('\n=== threshold boundary: at and under $30 the prior behaviour is preserved ===');
{
  const exactThirty = classify(rawTx({ categoryLabel: 'Shopping', amount: 30.00 }));
  ok(!isFuel(exactThirty) && exactThirty.reason === 'personal-unassigned',
    'raw: 7-Eleven exactly $30.00 Shopping -> NOT Fuel; existing personal-unassigned confirmation preserved',
    describe(exactThirty));
  const justUnder = classify(rawTx({ categoryLabel: 'Shopping', amount: 29.99 }));
  ok(!isFuel(justUnder) && justUnder.reason === 'personal-unassigned',
    'raw: 7-Eleven $29.99 Shopping -> NOT Fuel; existing behaviour preserved',
    describe(justUnder));
  const snack = classify(rawTx({ categoryLabel: 'Fast Food', amount: 12.00 }));
  ok(snack.kind === 'spend' && snack.categoryId === 'restaurants'
      && snack.includeReason === 'eating-out-category',
    'raw: 7-Eleven $12.00 Fast Food -> Eating out (under-$30 snack treatment retained)',
    describe(snack));
  const fuelUnder = classify(rawTx({ amount: 29.99 }));
  ok(isFuel(fuelUnder) && fuelUnder.includeReason === 'fuel-category',
    'raw: 7-Eleven $29.99 Fuel -> Fuel by its category (rule 1 has no amount floor)',
    describe(fuelUnder));
  const noCategoryUnder = classify(rawTx({ categoryLabel: null, amount: 25.00 }));
  ok(!isFuel(noCategoryUnder) && noCategoryUnder.reason === 'no-category',
    'raw: 7-Eleven $25.00 with no category -> existing no-category confirmation',
    describe(noCategoryUnder));
}

console.log('\n=== no broadening: other merchants and unadded aliases ===');
{
  const circleKShopping = classify(rawTx({
    categoryLabel: 'Shopping', amount: 44.19,
    payee: 'Circle K', originalMerchant: 'Circle K', displayedPayee: 'Circle K',
  }));
  ok(!isFuel(circleKShopping) && circleKShopping.reason === 'personal-unassigned',
    'raw: Circle K $44.19 Shopping -> NOT Fuel (amount rule is 7-Eleven only)',
    describe(circleKShopping));
  const cornerShopping = classify(rawTx({
    categoryLabel: 'Shopping', amount: 44.19,
    payee: 'CORNER MARKET', originalMerchant: 'CORNER MARKET', displayedPayee: 'CORNER MARKET',
  }));
  ok(!isFuel(cornerShopping) && cornerShopping.reason === 'personal-unassigned',
    'raw: CORNER MARKET $44.19 Shopping -> NOT Fuel',
    describe(cornerShopping));
  const petroFuel = classify(rawTx({
    payee: 'PETRO-CANADA', originalMerchant: 'PETRO-CANADA', displayedPayee: 'PETRO-CANADA',
  }));
  ok(isFuel(petroFuel) && petroFuel.includeReason === 'fuel-category',
    'control: Petro-Canada + Fuel -> Fuel, unchanged',
    describe(petroFuel));
  const petroShopping = classify(rawTx({
    categoryLabel: 'Shopping', amount: 50.00,
    payee: 'PETRO-CANADA', originalMerchant: 'PETRO-CANADA', displayedPayee: 'PETRO-CANADA',
  }));
  ok(!isFuel(petroShopping) && petroShopping.reason === 'personal-unassigned',
    'raw: Petro-Canada $50.00 Shopping -> NOT Fuel',
    describe(petroShopping));
  const transportation = classify(rawTx({ categoryLabel: 'Transportation', amount: 50.00 }));
  ok(isFuel(transportation) && transportation.includeReason === 'seven-eleven-over-threshold-fuel',
    'raw: 7-Eleven $50.00 Transportation -> Fuel by the merchant amount rule (not by any alias: the label itself is still unmapped, as the two pins below prove)',
    describe(transportation));
  const transportationOtherMerchant = classify(rawTx({
    categoryLabel: 'Transportation', amount: 50.00,
    payee: 'PETRO-CANADA', originalMerchant: 'PETRO-CANADA', displayedPayee: 'PETRO-CANADA',
  }));
  ok(!isFuel(transportationOtherMerchant) && transportationOtherMerchant.reason === 'unmapped-label',
    'raw: Petro-Canada $50.00 Transportation -> still unmapped-label (no Transportation/Ridesharing alias added in this change)',
    describe(transportationOtherMerchant));
  const transportationUnder = classify(rawTx({ categoryLabel: 'Transportation', amount: 25.00 }));
  ok(!isFuel(transportationUnder) && transportationUnder.reason === 'unmapped-label',
    'raw: 7-Eleven $25.00 Transportation -> still unmapped-label (under the threshold the label is untouched)',
    describe(transportationUnder));
}

console.log('\n=== non-purchase movements at 7-Eleven are not swept into Fuel ===');
{
  const refundAmount = classify(rawTx({ categoryLabel: 'Shopping', amount: -50.00 }));
  ok(refundAmount.kind === 'refund',
    '7-Eleven -$50.00 -> refund (negative amount returns before the amount rule)',
    describe(refundAmount));
  const refundLabel = classify(rawTx({ categoryLabel: 'Refund', amount: 50.00 }));
  ok(refundLabel.kind === 'refund',
    '7-Eleven $50.00 Refund category -> refund',
    describe(refundLabel));
  const transferLabel = classify(rawTx({ categoryLabel: 'Transfer', amount: 50.00 }));
  ok(transferLabel.kind === 'transfer',
    '7-Eleven $50.00 Transfer category -> transfer',
    describe(transferLabel));
  const cardPayment = classify(rawTx({ categoryLabel: 'Shopping', amount: 50.00, kindHint: 'payment' }));
  ok(cardPayment.kind === 'card-payment',
    '7-Eleven $50.00 with a payment kind hint -> card-payment',
    describe(cardPayment));
  const income = classify(rawTx({ categoryLabel: 'Shopping', amount: 50.00, isIncome: true }));
  ok(income.kind === 'income',
    '7-Eleven $50.00 flagged income -> income',
    describe(income));
}

console.log('\n=== precedence kept: owner categories and Business still beat the merchant rule ===');
{
  const dale = classify(rawTx({ categoryLabel: 'Dale', amount: 50.00 }));
  ok(dale.kind === 'spend' && dale.categoryId === 'dale-guilt-free',
    '7-Eleven $50.00 Dale category -> Dale guilt-free (owner category beats merchant, as in the incumbent contract)',
    describe(dale));
  const business = classify(rawTx({ categoryLabel: 'Business', amount: 50.00 }));
  ok(business.kind === 'business',
    '7-Eleven $50.00 Business category -> Business exclusion, not Fuel',
    describe(business));
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nfuel classification owner rules: ok');
