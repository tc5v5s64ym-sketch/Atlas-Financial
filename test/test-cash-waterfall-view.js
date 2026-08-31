'use strict';
/* Household cash-waterfall acceptance.
 *
 * Synthetic figures prove the presentation copies incumbent rendered values
 * without becoming another financial calculator or silently promoting
 * historical spending into household policy.
 */
const fs = require('fs');
const path = require('path');
const W = require('../public/cash-waterfall.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

console.log('=== historical actuals stay reference norms ===');
{
  ok(W.historicalNormFromText('budgeted $700, has been $612.34/mo · $80 dated') === '$612.34',
    'historical parser takes the actual, not the owner target');
  ok(W.historicalNormFromText('has been $245/mo') === '$245',
    'historical parser accepts whole-dollar rendered actuals');
  ok(W.historicalNormFromText('budgeted $700/mo') === null,
    'a target with no historical actual is not promoted into a norm');
}

console.log('\n=== schedule signs are display-only ===');
{
  ok(W.displayAmount('+4,264.00') === '$4,264.00',
    'scheduled income sign is presented as a household dollar amount');
  ok(W.displayAmount('−1,600.00') === '$1,600.00',
    'scheduled outflow sign is presented as an absolute household dollar amount');
  ok(W.displayAmount('$123.45') === '$123.45',
    'already-formatted amounts are copied unchanged');
}

console.log('\n=== waterfall model copies figures instead of recalculating them ===');
{
  const source = {
    action: 'Hold discretionary spending until Sep 15.',
    actionTone: 'tight',
    spendableCash: '$1,234.56',
    nextPayday: 'September 15',
    scheduledIncome: [
      { label: 'Synthetic payroll', value: '$4,321.09', date: 'Sep 15', meta: 'estimated' },
    ],
    requiredBills: [
      { label: 'Required bills', value: '$987.65' },
    ],
    scheduledOutflows: [
      { label: 'Synthetic mortgage', value: '$765.43', date: 'Sep 15' },
      { label: 'Synthetic Visa minimum', value: '$12.34', date: 'Sep 14' },
    ],
    household: [
      { label: 'Everyday essentials', value: '$456.78 · of $789.01 · short $332.23' },
    ],
    historicalNorms: [
      { label: 'Groceries', value: '$654.32 / month', meta: 'Recent actual · essential' },
      { label: 'Fuel & transport', value: '$234.56 / month', meta: 'Recent actual · essential' },
    ],
    debtMinimums: [
      { label: 'Synthetic Visa minimum', value: '$12.34', date: 'Sep 14', meta: 'estimated' },
    ],
    futureAllocations: [
      { label: 'Synthetic future cost', value: '$88.88' },
    ],
    extraDebt: [
      { label: 'Extra debt', value: '$77.77' },
    ],
    debtTarget: 'Synthetic high-rate card.',
    leftover: [
      { label: 'Left after that', value: '$66.66' },
    ],
    dataStatus: 'Data status: Current',
    dataAsOf: 'Updated Sep 10.',
  };
  const model = W.buildModel(source);
  ok(model.spendableCash === '$1,234.56'
      && model.requiredBills.value === '$987.65'
      && model.household.value === '$456.78 · of $789.01 · short $332.23'
      && model.extraDebt.value === '$77.77'
      && model.leftover.value === '$66.66',
    'cash, bills, household, extra debt, and LEFT OVER are byte-for-byte incumbent strings');
  ok(model.scheduledIncome[0].value === '$4,321.09'
      && model.futureAllocations[0].value === '$88.88',
    'income and future-cost values are passed through unchanged');
  ok(model.scheduledOutflows.length === 1
      && model.scheduledOutflows[0].label === 'Synthetic mortgage',
    'a debt minimum already broken out below is not duplicated in the calendar context');
  ok(model.historicalNorms[0].value === '$654.32 / month'
      && model.historicalNorms[1].value === '$234.56 / month',
    'historical norms remain labelled monthly reference values');
  ok(model.debtTarget === 'Synthetic high-rate card.',
    'debt target is copied rather than selected by the presentation layer');

  const sections = W.waterfallSections(model);
  const reconciledText = JSON.stringify(sections.reconciled);
  ok(sections.reconciled.currentCash.value === '$1,234.56'
      && sections.reconciled.leftover.value === '$66.66',
    'reconciled waterfall starts from current spendable cash and ends at incumbent LEFT OVER');
  ok(!reconciledText.includes('Synthetic payroll') && !reconciledText.includes('$4,321.09'),
    'next-payday income cannot enter the reconciled current-cash waterfall');
  ok(!reconciledText.includes('Synthetic mortgage') && !reconciledText.includes('$765.43'),
    '14-day calendar outflows cannot enter the reconciled current-cash waterfall');
  ok(sections.calendarContext.income[0].label === 'Synthetic payroll'
      && sections.calendarContext.income[0].value === '$4,321.09'
      && sections.calendarContext.outflows[0].label === 'Synthetic mortgage',
    'future calendar rows remain available only as separate timing context');
}

console.log('\n=== runtime stays downstream of financial authority ===');
{
  const src = read('public/cash-waterfall.js');
  ok(!/Forecast\s*\./.test(src), 'does not call Forecast');
  ok(!/fetch\s*\(|data\.json|periods\.json/.test(src),
    'does not fetch or read financial source files');
  ok(!/reduce\s*\(|parseFloat\s*\(|Number\s*\(/.test(src),
    'does not total or numerically reinterpret rendered dollars');
  ok(!/paydayAllocation\s*\(|budgetBreakdown\s*\(|recommend\s*\(/.test(src),
    'does not recreate or invoke an allocation/planning authority');
  ok(/Recent historical actuals are a starting norm, not a spending target or permission\./.test(src),
    'historical actuals are explicitly kept below owner-policy authority');
  ok(/Future paydays are not included\./.test(src),
    'current-cash resource pool explicitly excludes future paydays');
  ok(/They are not inputs to LEFT OVER\./.test(src),
    '14-day calendar rows explicitly declare they are outside LEFT OVER');
  ok(/Copied from Forecast after the current protected allocations above\./.test(src),
    'LEFT OVER declares that it is copied from the incumbent authority');
  ok(/See full Atlas detail/.test(src),
    'the existing detailed operating surface remains available behind disclosure');
}

console.log('\n=== Plan payday sheet is the homepage, not the leftover waterfall ===');
{
  const html = read('public/index.html');
  const planAt = html.indexOf('<script src="/plan.js"></script>');
  const householdAt = html.indexOf('<script src="/household-view.js"></script>');
  const waterfallAt = html.indexOf('<script src="/cash-waterfall.js"></script>');
  ok(planAt >= 0 && householdAt > planAt,
    'Plan and the plain-language household layer still load');
  ok(waterfallAt < 0,
    'the leftover waterfall is not the default Plan presentation');
  ok(!/<link rel="stylesheet" href="\/cash-waterfall\.css">/.test(html),
    'cash-waterfall stylesheet is not the Plan first-screen');
  ok(/<h1>This payday<\/h1>/.test(html),
    'the homepage h1 is this payday');
}

console.log('\n=== mobile layout keeps the answer compact ===');
{
  const css = read('public/cash-waterfall.css');
  ok(/\.cash-flow-leftover[\s\S]*font-size: clamp\(2\.2rem, 9vw, 4rem\)/.test(css),
    'LEFT OVER is visually dominant');
  ok(/@media \(max-width: 700px\)/.test(css),
    'phone-specific layout is defined');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
