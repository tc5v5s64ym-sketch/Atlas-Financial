'use strict';
/* Current-pay-period Predicted Ending Balance — owner 2026-09-21.
 *
 * Supersedes the 2026-09-09 income-led leftover. One Forecast identity:
 *
 *   payday-boundary opening
 *   + income not already inside that opening (actual when observed)
 *   − assigned bills not already inside that opening
 *   − Household Budget hold
 *   = Predicted Ending Balance
 *
 * Payday balance remains the income identity and is not this answer.
 * paydayAllocation.runningLeftover remains the current-cash allocation
 * chain and is not this answer. Long-horizon baselineTrajectory is
 * untouched. Independent arithmetic (L-002 / L-006). No live cents as
 * the specification.
 *
 * `node test/test-predicted-ending-balance.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const Assistant = require('../scripts/assistant-packet.js');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkSession = require('../scripts/talk-session.js');
const TalkWhy = require('../scripts/talk-why.js');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
  } else {
    console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`);
  }
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const read = file => sourceText(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function liveOperatingPlanNote\([\s\S]*?\n\}$/m, 'liveOperatingPlanNote'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function glanceSignedMoney\([\s\S]*?\n\}$/m, 'glanceSignedMoney'),
    grab(planSrc, /^function glanceMoney\([\s\S]*?\n\}$/m, 'glanceMoney'),
    grab(planSrc, /^function glanceLineLabel\([\s\S]*?\n\}$/m, 'glanceLineLabel'),
    grab(planSrc, /^function cashGlanceHtml\([\s\S]*?\n\}$/m, 'cashGlanceHtml'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
    grab(planSrc, /^function runningLeftoverHtml\([\s\S]*?\n\}$/m, 'runningLeftoverHtml'),
    grab(planSrc, /^function periodBillLine\([\s\S]*?\n\}$/m, 'periodBillLine'),
    grab(planSrc, /^function calendarCurrentUnavailableHtml\([\s\S]*?\n\}$/m, 'calendarCurrentUnavailableHtml'),
    grab(planSrc, /^function calendarIncomeHtml\([\s\S]*?\n\}$/m, 'calendarIncomeHtml'),
    grab(planSrc, /^function householdBudgetCycleText\([\s\S]*?\n\}$/m, 'householdBudgetCycleText'),
    grab(planSrc, /^function householdBudgetMetric\([\s\S]*?\n\}$/m, 'householdBudgetMetric'),
    grab(planSrc, /^function householdBudgetCategoryHtml\([\s\S]*?\n\}$/m, 'householdBudgetCategoryHtml'),
    grab(planSrc, /^function calendarBudgetHtml\([\s\S]*?\n\}$/m, 'calendarBudgetHtml'),
    grab(planSrc, /^function calendarPeriodBillsHtml\([\s\S]*?\n\}$/m, 'calendarPeriodBillsHtml'),
    grab(planSrc, /^function extraRepaymentHtml\([\s\S]*?\n\}$/m, 'extraRepaymentHtml'),
    grab(planSrc, /^function calendarWaterfallHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallHtml'),
    grab(planSrc, /^function operatingCashExplanationHtml\([\s\S]*?\n\}$/m, 'operatingCashExplanationHtml'),
    grab(planSrc, /^function calendarPickerHtml\([\s\S]*?\n\}$/m, 'calendarPickerHtml'),
    grab(planSrc, /^function calendarWaterfallsHtml\([\s\S]*?\n\}$/m, 'calendarWaterfallsHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ calendarWaterfallsHtml, calendarWaterfallHtml, money2 });`,
    { Forecast: F }
  );
}

const PAYDAY = '2026-09-11';
const AS_OF = '2026-09-18';
const OPENING = 800;
const DALE = 2000;
const AMANDA = 1500;
const CHILD = 219.45;
const BILL = 400;
const GROCERY_PLAN = 900;
const LIVE_CASH = 1234.56;

function period(view, id) {
  return ((view && view.calendarPeriods) || []).find(p => p && p.id === id);
}

function groceryTx(amount, extra) {
  return Object.assign({
    id: 'tx-groc',
    date: PAYDAY,
    amount,
    pending: false,
    categoryLabel: 'Groceries',
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    displayedPayee: 'Save-On-Foods',
    originalMerchant: 'Save-On-Foods',
  }, extra || {});
}

function otherTx(amount, extra) {
  return Object.assign({
    id: 'tx-other',
    date: PAYDAY,
    amount,
    pending: false,
    categoryLabel: 'Gifts',
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    displayedPayee: 'Unassigned shop',
    originalMerchant: 'Unassigned shop',
  }, extra || {});
}

function actuals(transactions, extra) {
  return Object.assign({
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: AS_OF,
    coverageStart: PAYDAY,
    coverageThrough: AS_OF,
    pendingCoverage: 'complete',
    transactionCoverage: 'complete',
    transactions: transactions || [],
    representedActuals: [],
  }, extra || {});
}

function fixturePlan(extra) {
  extra = extra || {};
  return {
    defaults: { targetBuffer: 0 },
    windowDays: 14,
    startingCash: extra.startingCash || {
      amount: LIVE_CASH,
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: 900 },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: 334.56 },
        { id: 'savings', label: 'EMERGENCY SAVING', value: 100 },
      ],
    },
    opening: extra.opening || {
      asOf: AS_OF,
      priorAsOf: PAYDAY,
      representedEvents: extra.representedEvents || [],
      paydaySnapshot: {
        periodStart: PAYDAY,
        asOf: PAYDAY,
        opening: extra.openingAmount != null ? extra.openingAmount : OPENING,
      },
    },
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: extra.income || [
      {
        id: 'payroll', label: 'Dale income', frequency: 'biweekly',
        anchor: '2026-08-14', amount: DALE, confidence: 'confirmed',
      },
      {
        id: 'amandaPayday', label: 'Amanda income', frequency: 'once',
        date: PAYDAY, amount: AMANDA, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Canada Child Benefit', frequency: 'once',
        date: '2026-09-20', amount: CHILD, confidence: 'confirmed',
      },
    ],
    bills: extra.bills || [
      {
        id: 'netflix', label: 'Netflix', frequency: 'once', date: '2026-09-12',
        amount: BILL, confidence: 'confirmed',
      },
    ],
    obligations: extra.obligations || [],
    commitments: extra.commitments || [],
    budget: {
      categories: extra.categories || [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedWeekly: 450, ownerLine: 'Groceries',
        },
      ],
    },
  };
}

function recommend(plan, txs, extraOpts) {
  return F.recommend(plan, extraOpts && extraOpts.asOf || AS_OF, Object.assign({
    targetBuffer: 0,
    debts: extraOpts && extraOpts.debts || [],
    currentPeriodActuals: actuals(txs, extraOpts && extraOpts.actualsExtra),
  }, extraOpts || {}));
}

function activeOf(advice) {
  return period(advice && advice.defaultView, 'this-pay-period');
}

function independentPeb(opening, incomeAdded, bills, hold) {
  return roundCent(opening + incomeAdded - bills - hold);
}

const composer = loadComposer();

console.log('=== A. Day-1 prediction reserves the full planned Household Budget ===');
{
  const plan = fixturePlan();
  const advice = recommend(plan, []);
  const row = activeOf(advice);
  const incomeAdded = DALE + AMANDA + CHILD;
  const hold = GROCERY_PLAN;
  const expected = independentPeb(OPENING, incomeAdded, BILL, hold);
  const incomeLed = roundCent(incomeAdded - BILL - hold);
  ok(row && row.openingKnown === true && near(row.opening, OPENING),
    'payday-boundary opening is the recorded snapshot');
  ok(near(row.available, incomeAdded),
    'Payday balance stays the income identity');
  ok(near(row.budgetHold, hold),
    'Day-1 Household Budget hold is the full grocery plan');
  ok(near(row.afterHouseholdBudget, expected)
      && near(row.predictedEndingBalance, expected),
    'PEB = opening + income − bills − full plan hold',
    `${row && row.afterHouseholdBudget} vs ${expected}`);
  ok(!near(row.afterHouseholdBudget, incomeLed),
    'PEB is not the superseded income-led remainder');
}

console.log('\n=== B. Spending below plan does not increase PEB ===');
{
  const none = activeOf(recommend(fixturePlan(), []));
  const under = activeOf(recommend(fixturePlan(), [groceryTx(100)]));
  ok(near(under.budgetHold, GROCERY_PLAN)
      && near(under.afterHouseholdBudget, none.afterHouseholdBudget),
    'under-plan groceries keep the $900 hold; PEB does not rise');
}

console.log('\n=== C. Spending above plan reduces PEB by the overage ===');
{
  const atPlan = activeOf(recommend(fixturePlan(), [groceryTx(900)]));
  const over = activeOf(recommend(fixturePlan(), [groceryTx(1050)]));
  ok(near(atPlan.budgetHold, 900) && near(over.budgetHold, 1050),
    'at-plan hold stays $900; overspend hold is $1,050');
  ok(near(atPlan.afterHouseholdBudget - over.afterHouseholdBudget, 150),
    'PEB falls exactly $150 for the grocery overage');
}

console.log('\n=== D. Other Spending reduces PEB dollar-for-dollar ===');
{
  const base = activeOf(recommend(fixturePlan(), [groceryTx(100)]));
  const withOther = activeOf(recommend(fixturePlan(), [
    groceryTx(100),
    otherTx(75),
  ]));
  ok(near(withOther.budgetHold - base.budgetHold, 75)
      && near(base.afterHouseholdBudget - withOther.afterHouseholdBudget, 75),
    'Other Spending $75 reduces PEB by $75 and does not touch the grocery reserve');
}

console.log('\n=== E/F. Cross-account card spend counts once; later payment does not ===');
{
  const cardSpend = groceryTx(200, {
    id: 'tx-visa-groc',
    accountRole: 'revolving-credit',
    atlasAccountId: 'travelvisa',
    categoryLabel: 'Groceries',
  });
  const cardPay = {
    id: 'tx-visa-pay',
    date: '2026-09-16',
    amount: 200,
    pending: false,
    categoryLabel: 'Credit Card Payment',
    accountRole: 'household-cash',
    atlasAccountId: 'chequing-a',
    kindHint: 'card-payment',
    excludeFromTotals: true,
    displayedPayee: 'TRAVEL VISA PAYMENT',
    originalMerchant: 'TRAVEL VISA PAYMENT',
  };
  const none = activeOf(recommend(fixturePlan(), []));
  const cardOnly = activeOf(recommend(fixturePlan(), [cardSpend], {
    debts: [{
      id: 'travelvisa', label: 'Travel Visa', structure: 'Revolving',
      rate: 19.99, balance: 200, pending: 0, limit: 5000,
    }],
  }));
  const afterPay = activeOf(recommend(fixturePlan(), [cardSpend, cardPay], {
    debts: [{
      id: 'travelvisa', label: 'Travel Visa', structure: 'Revolving',
      rate: 19.99, balance: 0, pending: 0, limit: 5000,
    }],
  }));
  ok(near(cardOnly.budgetHold, GROCERY_PLAN)
      && near(cardOnly.afterHouseholdBudget, none.afterHouseholdBudget),
    'Travel Visa grocery $200 under plan does not change PEB (hold stays plan)');
  ok(near(afterPay.afterHouseholdBudget, cardOnly.afterHouseholdBudget)
      && near(afterPay.budgetHold, cardOnly.budgetHold),
    'later Bills → Travel Visa payment does not deduct the $200 again');
}

console.log('\n=== G. Bills → Weekly does not change household PEB ===');
{
  const tfrTo = {
    id: 'tfr-to', date: PAYDAY, amount: 120, pending: false,
    categoryLabel: 'Payment, Transfer', accountRole: 'household-cash',
    atlasAccountId: 'chequing-b', excludeFromTotals: true, kindHint: 'transfer',
    displayedPayee: 'AB123 TFR-TO', originalMerchant: 'AB123 TFR-TO',
    tfrReference: 'AB123', tfrDirection: 'TO',
  };
  const tfrFr = {
    id: 'tfr-fr', date: PAYDAY, amount: -120, pending: false,
    categoryLabel: 'Payment, Transfer', accountRole: 'household-cash',
    atlasAccountId: 'chequing-a', excludeFromTotals: true, kindHint: 'transfer',
    displayedPayee: 'AB123 TFR-FR', originalMerchant: 'AB123 TFR-FR',
    tfrReference: 'AB123', tfrDirection: 'FR',
  };
  const none = activeOf(recommend(fixturePlan(), []));
  const moved = activeOf(recommend(fixturePlan(), [tfrTo, tfrFr]));
  ok(near(moved.afterHouseholdBudget, none.afterHouseholdBudget)
      && near(moved.budgetHold, none.budgetHold),
    'Bills → Weekly is an internal movement, not consumption');
}

console.log('\n=== H. Bills → Savings does not destroy household money ===');
{
  const tfrTo = {
    id: 'sav-to', date: PAYDAY, amount: 450, pending: false,
    categoryLabel: 'Payment, Transfer', accountRole: 'household-cash',
    atlasAccountId: 'savings', excludeFromTotals: true, kindHint: 'transfer',
    displayedPayee: 'CD456 TFR-TO SAVE01', originalMerchant: 'CD456 TFR-TO SAVE01',
    tfrReference: 'CD456', tfrDirection: 'TO',
  };
  const tfrFr = {
    id: 'sav-fr', date: PAYDAY, amount: -450, pending: false,
    categoryLabel: 'Payment, Transfer', accountRole: 'household-cash',
    atlasAccountId: 'chequing-a', excludeFromTotals: true, kindHint: 'transfer',
    displayedPayee: 'CD456 TFR-FR BILLS', originalMerchant: 'CD456 TFR-FR BILLS',
    tfrReference: 'CD456', tfrDirection: 'FR',
  };
  const none = activeOf(recommend(fixturePlan(), []));
  const moved = activeOf(recommend(fixturePlan(), [tfrTo, tfrFr]));
  const expl = moved.operatingCashExplanation;
  ok(near(moved.afterHouseholdBudget, none.afterHouseholdBudget),
    'Bills → Savings does not reduce Predicted Ending Balance');
  ok(expl && expl.leftoverIdentity === 'predicted-ending-balance'
      && expl.sameContract === false
      && /Savings/.test(expl.leftoverNote),
    'reconciliation names PEB and keeps leftover ≠ cash; Savings stays household money');
  ok(expl && expl.sameContract === false && !('gap' in expl) && !('plug' in expl),
    'Savings location stays an explanation fact; no leftover plug is introduced');
}

console.log('\n=== I. Positive and negative payday-boundary positions ===');
{
  const pos = activeOf(recommend(fixturePlan({ openingAmount: 250 }), []));
  const neg = activeOf(recommend(fixturePlan({ openingAmount: -180 }), []));
  const incomeAdded = DALE + AMANDA + CHILD;
  ok(near(pos.afterHouseholdBudget,
      independentPeb(250, incomeAdded, BILL, GROCERY_PLAN)),
    'positive opening is added, not manufactured as income');
  ok(near(neg.afterHouseholdBudget,
      independentPeb(-180, incomeAdded, BILL, GROCERY_PLAN)),
    'negative Weekly/operating opening reduces PEB and is not a fake purchase');
  ok(neg.budgetHold === pos.budgetHold,
    'negative opening does not invent Household Budget spending');
}

console.log('\n=== J. Actual income variance updates the living prediction ===');
{
  const paydayOpening = {
    asOf: PAYDAY,
    representedEvents: [{ id: 'payroll', date: PAYDAY }],
    paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: OPENING },
  };
  const modeled = activeOf(recommend(fixturePlan({ opening: paydayOpening }), [], {
    asOf: PAYDAY,
    actualsExtra: { observationAsOf: PAYDAY, coverageThrough: PAYDAY },
  }));
  const actualDale = 2140;
  const varied = activeOf(recommend(fixturePlan({
    opening: paydayOpening,
    representedEvents: [{ id: 'payroll', date: PAYDAY }],
  }), [], {
    asOf: PAYDAY,
    actualsExtra: {
      observationAsOf: PAYDAY,
      coverageThrough: PAYDAY,
      representedActuals: [{ id: 'payroll', date: PAYDAY, actual: actualDale }],
    },
  }));
  ok(near(varied.afterHouseholdBudget - modeled.afterHouseholdBudget, actualDale - DALE),
    'observed Dale actual $2,140 vs modeled $2,000 moves PEB by the $140 variance',
    `${varied && varied.afterHouseholdBudget} vs ${modeled && modeled.afterHouseholdBudget}`);
}

console.log('\n=== K. Budget/Plan and Talk reprint the same Forecast PEB ===');
{
  const plan = fixturePlan();
  const advice = recommend(plan, [groceryTx(100), otherTx(40)]);
  const row = activeOf(advice);
  const html = composer.calendarWaterfallHtml(row, null, advice.paydayAllocation, plan);
  ok(/data-operating-prompt="Predicted Ending Balance"/.test(html)
      && html.includes(composer.money2(row.afterHouseholdBudget)),
    'Budget Q07 reprints Forecast Predicted Ending Balance');
  ok(near(advice.defaultView.predictedEndingBalance, row.afterHouseholdBudget)
      && advice.defaultView.predictedEndingBalanceIdentity === 'predicted-ending-balance',
    'recommend.defaultView.predictedEndingBalance equals the calendar leftover');
  const packet = {
    forecast: {
      predictedEndingBalance: {
        status: 'ok',
        source: 'Forecast.calendarPeriodWaterfalls',
        identity: 'predicted-ending-balance',
        amount: row.afterHouseholdBudget,
      },
    },
  };
  const claims = TalkWhy.publishablePaths([TalkSession.LEFTOVER_PATH], packet);
  const presented = TalkPresentation.presentVerifiedClaims(
    { status: 'explained', claims },
    packet
  );
  ok(TalkSession.LEFTOVER_PATH === 'forecast.predictedEndingBalance.amount',
    'Talk leftover path is the Forecast PEB field');
  ok(presented && presented.answer
      && presented.answer.indexOf(TalkPresentation.formatCurrency(row.afterHouseholdBudget)) >= 0,
    'Talk leftover reprints the same Forecast PEB amount');
  ok(!near(row.afterHouseholdBudget, advice.paydayAllocation.runningLeftover.afterHouseholdBudget)
      || near(row.afterHouseholdBudget, advice.paydayAllocation.runningLeftover.afterHouseholdBudget),
    'paydayAllocation leftover may differ; PEB does not copy it as a third engine');
}

console.log('\n=== L. Long-horizon baselineTrajectory remains intact ===');
{
  const plan = fixturePlan();
  const asOf = AS_OF;
  const opts = {
    targetBuffer: 0,
    debts: [],
    currentPeriodActuals: actuals([]),
  };
  let baseline = null;
  let baselineThrew = false;
  try {
    baseline = F.baselineTrajectory(plan, [], asOf, opts);
  } catch (err) {
    baselineThrew = true;
  }
  ok(!baselineThrew,
    'baselineTrajectory does not throw after the current-pay-period PEB restore');
  ok(!baseline || !baseline.predictedEndingBalance,
    'long-horizon trajectory does not own Predicted Ending Balance');
  const advice = F.recommend(plan, asOf, opts);
  ok(advice && advice.defaultView && advice.defaultView.predictedEndingBalance != null
      && advice.paydayAllocation && advice.paydayAllocation.runningLeftover,
    'current-pay-period PEB and paydayAllocation coexist; trajectory is separate');
}

console.log('\n=== M. Missing payday-boundary opening fails closed ===');
{
  const plan = fixturePlan({
    opening: { asOf: AS_OF, priorAsOf: PAYDAY, representedEvents: [] },
  });
  const row = activeOf(recommend(plan, []));
  ok(row && row.openingKnown !== true && row.opening == null,
    'no snapshot and a live-advanced mid-period opening fail closed');
  ok(row.available != null && near(row.available, row.incomeTotal),
    'Payday balance still publishes the income identity');
  ok(row.afterHouseholdBudget == null && row.predictedEndingBalance == null
      && row.afterBills == null,
    'PEB is withheld rather than inventing an income-led remainder');
}

console.log('\n=== O. Mid-period cutover cash does not double-count pre-cutover spend ===');
{
  // Named household facts, independent of Forecast leftover terms.
  // Payday-morning cash is known to the test and is not given to Forecast
  // as a snapshot. The dated opening is mid-period cash after $100 of
  // the $900 grocery target has already left the accounts.
  const PAYDAY_MORNING_CASH = 1000;
  const GROCERY_TARGET = 900;
  const PRE_CUTOVER_GROCERY = 100;
  const CUTOVER_CASH = PAYDAY_MORNING_CASH - PRE_CUTOVER_GROCERY;
  const independentPaydayRemainder = PAYDAY_MORNING_CASH - GROCERY_TARGET;
  const doubleCountTrap = CUTOVER_CASH - GROCERY_TARGET;
  ok(near(CUTOVER_CASH, 900) && near(independentPaydayRemainder, 100)
      && near(doubleCountTrap, 0) && !near(independentPaydayRemainder, doubleCountTrap),
    'independent facts: payday remainder $100; cutover minus full hold is $0');
  const plan = {
    defaults: { targetBuffer: 0 },
    windowDays: 14,
    startingCash: {
      amount: CUTOVER_CASH,
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: CUTOVER_CASH },
      ],
    },
    opening: { asOf: AS_OF },
    nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
    income: [
      {
        id: 'payroll', label: 'Seaspan', frequency: 'biweekly',
        anchor: '2026-08-14', amount: 0, confidence: 'confirmed',
      },
    ],
    bills: [],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedWeekly: 450, ownerLine: 'Groceries',
        },
      ],
    },
  };
  const row = activeOf(recommend(plan, []));
  ok(row && row.start === PAYDAY && row.openingKnown === true
      && row.openingSource === 'cutover-opening' && near(row.opening, CUTOVER_CASH)
      && row.paydayBoundaryOpening !== true,
    'Q01 still publishes the mid-period cutover; it is not a payday-boundary opening');
  ok(near(row.budgetHold, GROCERY_TARGET),
    'Household Budget hold remains the full-period grocery target');
  ok(row.afterBills == null && row.afterHouseholdBudget == null
      && row.predictedEndingBalance == null,
    'Forecast withholds PEB rather than treating cutover cash as payday morning');
  ok(row.predictedEndingBalance == null
      && row.predictedEndingBalance !== doubleCountTrap,
    'Forecast does not publish the $0 double-count of the already-reflected $100');
  ok(row.predictedEndingBalance == null
      && row.predictedEndingBalance !== independentPaydayRemainder,
    'Forecast does not invent a remaining-budget remainder from unrecorded payday cash');
  const echo = independentPeb(
    row.opening, row.incomeAdded || 0, row.periodBillLoad || 0, row.budgetHold);
  ok(near(echo, doubleCountTrap) && row.predictedEndingBalance == null,
    'opening + incomeAdded − bills − hold on cutover cash is the $0 trap, not the published PEB');
}

console.log('\n=== N. No unexplained balancing adjustment ===');
{
  const src = read('public/forecast.js');
  ok(!/leftover\s*=\s*operatingCash|plugAdjustment|forceEqual|balancingPlug\s*=/.test(src),
    'Forecast does not introduce a leftover balancing plug');
  const row = activeOf(recommend(fixturePlan(), [groceryTx(100)]));
  const expl = row.operatingCashExplanation;
  const reconstructed = independentPeb(
    row.opening, row.incomeAdded, row.periodBillLoad, row.budgetHold);
  ok(near(row.afterHouseholdBudget, reconstructed),
    'PEB equals the named-facts reconstruction with no residual plug');
  ok(expl && expl.sameContract === false
      && expl.leftoverSameAsBillsCash === false
      && expl.leftoverIdentity === 'predicted-ending-balance',
    'explanation keeps PEB, Current Balance, and BILLS cash as different contracts');
}

console.log('\n=== Sep 11–24 acceptance: restored identity uses opening and stays fluid ===');
{
  const plan = fixturePlan();
  const day1 = activeOf(recommend(plan, []));
  const later = activeOf(recommend(plan, [groceryTx(100), otherTx(80)]));
  const expectedDay1 = independentPeb(
    OPENING, DALE + AMANDA + CHILD, BILL, GROCERY_PLAN);
  ok(day1.start === PAYDAY && day1.end === '2026-09-24',
    'fixture is the Sep 11–24 Seaspan window');
  ok(near(day1.afterHouseholdBudget, expectedDay1)
      && !near(day1.afterHouseholdBudget, expectedDay1 - OPENING),
    'Sep 11–24 PEB includes the payday-boundary opening');
  ok(near(day1.afterHouseholdBudget - later.afterHouseholdBudget, 80),
    'later Other Spending updates the living prediction dollar-for-dollar');
}

console.log('\n=== Live reconstruction: PEB follows named facts, never hardcoded Q07 ===');
{
  const live = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const asOf = (live.plan && live.plan.opening && live.plan.opening.asOf)
    || (live.meta && live.meta.asOf);
  const advice = F.recommend(live.plan, asOf, { debts: live.debts || [] });
  const row = activeOf(advice);
  if (!row) {
    ok(false, 'live This Pay Period exists');
  } else if (row.paydayBoundaryOpening === true && row.incomeAdded != null
      && row.periodBillLoad != null && row.budgetHold != null) {
    const reconstructed = independentPeb(
      row.opening, row.incomeAdded, row.periodBillLoad, row.budgetHold);
    ok(near(row.afterHouseholdBudget, reconstructed)
        && near(row.predictedEndingBalance, reconstructed),
      'live PEB equals payday-boundary opening + incomeAdded − bills − hold');
    const incomeLed = roundCent(row.incomeTotal - row.periodBillLoad - row.budgetHold);
    if (Math.abs(row.opening) > 0.005) {
      ok(!near(row.afterHouseholdBudget, incomeLed),
        'live PEB is not the superseded income-led Q07 when opening is nonzero');
    }
  } else {
    ok(row.afterHouseholdBudget == null && row.predictedEndingBalance == null
        && row.paydayBoundaryOpening !== true,
      'live PEB fails closed when payday-boundary opening is not proven');
    ok(row.available != null || row.operatingPlanUnavailable === true,
      'income identity or unavailable operating plan remains explicit');
    if (row.openingKnown === true && row.openingSource === 'cutover-opening'
        && row.openingAsOf && row.start && row.openingAsOf !== row.start) {
      ok(row.predictedEndingBalance == null && row.afterHouseholdBudget == null,
        'live mid-period cutover is not published as payday-boundary leftover');
    }
  }
}

console.log('\n=== A. Production Sep 11–24 signed-actual regression cannot recur ===');
{
  // Named reconstruction of the 2026-09-21 live defect. These cents are
  // the broken equation, not a specification of a desired household PEB.
  const PROD_OPENING = 310.47;
  const DALE_LM_SIGNED = -4274.98;
  const DALE_INFLOW = 4274.98;
  const AMANDA_PLANNED = 2168.85;
  const CHILD_AMT = 219.45;
  const PROD_BILLS = 3413.07;
  const PROD_HOLD = 2287.17;
  const BROKEN_INCOME = roundCent(DALE_LM_SIGNED + CHILD_AMT);
  const BROKEN_AFTER_BILLS = roundCent(PROD_OPENING + BROKEN_INCOME - PROD_BILLS);
  const BROKEN_PEB = roundCent(BROKEN_AFTER_BILLS - PROD_HOLD);
  ok(near(BROKEN_INCOME, -4055.53) && near(BROKEN_AFTER_BILLS, -7158.13)
      && near(BROKEN_PEB, -9445.3),
    'independent reconstruction of the published broken equation');

  const plan = fixturePlan({
    openingAmount: PROD_OPENING,
    opening: {
      asOf: '2026-09-21',
      priorAsOf: '2026-08-19',
      representedEvents: [
        { id: 'payroll', date: PAYDAY },
        { id: 'childBenefit', date: '2026-09-20' },
      ],
      notReliedUponEvents: [
        { id: 'amandaSalary15', date: '2026-09-15', reason: 'unconfirmed-transfer' },
      ],
      paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: PROD_OPENING },
    },
    income: [
      {
        id: 'payroll', label: 'Dale income', frequency: 'biweekly',
        anchor: '2026-08-14', amount: 4264, confidence: 'confirmed',
      },
      {
        id: 'amandaSalary15', label: 'Amanda income', frequency: 'once',
        date: '2026-09-15', amount: AMANDA_PLANNED, confidence: 'confirmed',
      },
      {
        id: 'childBenefit', label: 'Canada Child Benefit', frequency: 'once',
        date: '2026-09-20', amount: CHILD_AMT, confidence: 'confirmed',
      },
    ],
    bills: [
      {
        id: 'period-bills', label: 'Assigned period bills', frequency: 'once',
        date: '2026-09-12', amount: PROD_BILLS, confidence: 'confirmed',
      },
    ],
    categories: [],
  });
  const row = activeOf(recommend(plan, [otherTx(PROD_HOLD)], {
    asOf: '2026-09-21',
    representedEvents: [
      { id: 'payroll', date: PAYDAY },
      { id: 'childBenefit', date: '2026-09-20' },
    ],
    notReliedUponEvents: [
      { id: 'amandaSalary15', date: '2026-09-15', reason: 'unconfirmed-transfer' },
    ],
    actualsExtra: {
      observationAsOf: '2026-09-21',
      coverageStart: PAYDAY,
      coverageThrough: '2026-09-21',
      representedActuals: [
        { id: 'payroll', date: PAYDAY, actual: DALE_LM_SIGNED, postedOn: PAYDAY },
        { id: 'childBenefit', date: '2026-09-20', actual: CHILD_AMT, postedOn: '2026-09-20' },
      ],
    },
  }));
  const correctIncome = roundCent(DALE_INFLOW + AMANDA_PLANNED + CHILD_AMT);
  const correctAfterBills = roundCent(PROD_OPENING + correctIncome - PROD_BILLS);
  const correctPeb = roundCent(correctAfterBills - PROD_HOLD);
  ok(row && near(row.opening, PROD_OPENING) && row.openingSource === 'snapshot'
      && row.paydayBoundaryOpening === true,
    'payday-boundary opening stays the Sep 11 snapshot, not live cash');
  ok(near(row.incomeAdded, correctIncome),
    'Lunch Money signed Dale actual becomes household inflow; Amanda planned stays',
    `${row && row.incomeAdded} vs ${correctIncome}`);
  ok(near(row.afterBills, correctAfterBills) && !near(row.afterBills, BROKEN_AFTER_BILLS),
    'Balance after bills is not the production −$7,158.13');
  ok(near(row.afterHouseholdBudget, correctPeb) && !near(row.afterHouseholdBudget, BROKEN_PEB),
    'PEB is not the production −$9,445.30');
  ok(row.predictedEndingBalanceTerms
      && row.predictedEndingBalanceTerms.closes === true
      && near(row.predictedEndingBalanceTerms.paydayBoundaryPosition, PROD_OPENING)
      && near(row.predictedEndingBalanceTerms.periodIncome, correctIncome)
      && near(row.predictedEndingBalanceTerms.assignedBills, PROD_BILLS)
      && near(row.predictedEndingBalanceTerms.householdBudgetHold, PROD_HOLD)
      && near(row.predictedEndingBalanceTerms.predictedEndingBalance, correctPeb),
    'Forecast publishes the closed PEB identity with no plug');
}

console.log('\n=== B. Every PEB term is inspectable and arithmetically closes ===');
{
  const row = activeOf(recommend(fixturePlan(), [groceryTx(100)]));
  const terms = row && row.predictedEndingBalanceTerms;
  const reconstructed = terms
    ? independentPeb(
      terms.paydayBoundaryPosition, terms.periodIncome,
      terms.assignedBills, terms.householdBudgetHold)
    : null;
  ok(terms && terms.closes === true && terms.identity === 'predicted-ending-balance',
    'terms packet declares the PEB identity and closes');
  ok(terms && near(reconstructed, terms.predictedEndingBalance)
      && near(reconstructed, row.afterHouseholdBudget),
    'payday-boundary + period income − bills − hold = PEB with no residual');
}

console.log('\n=== C. Realistic payday-boundary Bills + Weekly position ===');
{
  const BILLS_PAYDAY = 757.06;
  const WEEKLY_PAYDAY = -446.59;
  const POSITION = roundCent(BILLS_PAYDAY + WEEKLY_PAYDAY);
  const plan = fixturePlan({
    openingAmount: POSITION,
    startingCash: {
      amount: 190.24,
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: 593.29 },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: -403.05 },
        { id: 'savings', label: 'EMERGENCY SAVING', value: 772.58 },
      ],
    },
  });
  const row = activeOf(recommend(plan, []));
  const income = DALE + AMANDA + CHILD;
  ok(near(POSITION, 310.47),
    'independent Bills + Weekly payday-boundary is the snapshot position');
  ok(near(row.opening, POSITION) && row.openingSource === 'snapshot',
    'PEB opening is the composed Bills + Weekly payday position');
  ok(!near(row.opening, 190.24) && !near(row.opening, 593.29 - 403.05),
    'live Current Balance / live A+B is not the payday-boundary opening');
  ok(near(row.afterHouseholdBudget, independentPeb(POSITION, income, BILL, GROCERY_PLAN)),
    'composed payday position enters the identity exactly once');
}

console.log('\n=== D. Negative Weekly carry is position, not manufactured spending ===');
{
  const BILLS_OK = 400;
  const WEEKLY_NEG = -180;
  const POSITION = roundCent(BILLS_OK + WEEKLY_NEG);
  const none = activeOf(recommend(fixturePlan({ openingAmount: POSITION }), []));
  const spent = activeOf(recommend(fixturePlan({ openingAmount: POSITION }), [groceryTx(50)]));
  ok(near(none.opening, POSITION) && none.budgetHold === GROCERY_PLAN
      && spent.budgetHold === GROCERY_PLAN,
    'negative Weekly carry does not invent Household Budget spending');
  ok(near(none.afterHouseholdBudget,
      independentPeb(POSITION, DALE + AMANDA + CHILD, BILL, GROCERY_PLAN)),
    'negative carry reduces the starting position exactly once');
}

console.log('\n=== E. Payday Bills sweep/reset is not a giant negative opening ===');
{
  const SWEPT_BILLS = 0;
  const WEEKLY_CARRY = -200;
  const POSITION = roundCent(SWEPT_BILLS + WEEKLY_CARRY);
  const PERIOD_BILLS = 3000;
  const plan = fixturePlan({
    openingAmount: POSITION,
    bills: [
      {
        id: 'mortgage', label: 'Mortgage', frequency: 'once',
        date: '2026-09-12', amount: PERIOD_BILLS, confidence: 'confirmed',
      },
    ],
  });
  const row = activeOf(recommend(plan, []));
  ok(near(row.opening, POSITION) && !near(row.opening, -PERIOD_BILLS),
    'swept Bills payday position is Weekly carry, not minus the new bill load');
  ok(near(row.periodBillLoad, PERIOD_BILLS)
      && near(row.afterBills, roundCent(POSITION + row.incomeAdded - PERIOD_BILLS)),
    'assigned bills are deducted once after the swept opening');
}

console.log('\n=== F. Child Benefit entering Weekly is represented exactly once ===');
{
  const CHILD_LM = -219.45;
  const midOpening = {
    asOf: '2026-09-21',
    priorAsOf: '2026-08-19',
    representedEvents: [{ id: 'childBenefit', date: '2026-09-20' }],
    paydaySnapshot: { periodStart: PAYDAY, asOf: PAYDAY, opening: OPENING },
  };
  const daleOnly = [
    {
      id: 'payroll', label: 'Dale income', frequency: 'biweekly',
      anchor: '2026-08-14', amount: DALE, confidence: 'confirmed',
    },
  ];
  const withChildIncome = daleOnly.concat([
    {
      id: 'childBenefit', label: 'Canada Child Benefit', frequency: 'once',
      date: '2026-09-20', amount: CHILD, confidence: 'confirmed',
    },
  ]);
  const without = activeOf(recommend(fixturePlan({
    opening: midOpening,
    income: daleOnly,
  }), [], {
    asOf: '2026-09-21',
    actualsExtra: { observationAsOf: '2026-09-21', coverageThrough: '2026-09-21' },
  }));
  const withChild = activeOf(recommend(fixturePlan({
    opening: midOpening,
    income: withChildIncome,
    representedEvents: [{ id: 'childBenefit', date: '2026-09-20' }],
  }), [], {
    asOf: '2026-09-21',
    representedEvents: [{ id: 'childBenefit', date: '2026-09-20' }],
    actualsExtra: {
      observationAsOf: '2026-09-21',
      coverageThrough: '2026-09-21',
      representedActuals: [
        { id: 'childBenefit', date: '2026-09-20', actual: CHILD_LM, postedOn: '2026-09-20' },
      ],
    },
  }));
  ok(near(withChild.incomeAdded - without.incomeAdded, CHILD),
    'Child Benefit adds exactly the $219.45 inflow once',
    `${withChild && withChild.incomeAdded} vs ${without && without.incomeAdded}`);
  ok(near(withChild.opening, without.opening) && near(withChild.opening, OPENING),
    'Child Benefit is not also folded into the payday-boundary opening');
}

console.log('\n=== M. Live Current Balance is not substituted for payday-boundary ===');
{
  const plan = fixturePlan({
    startingCash: {
      amount: LIVE_CASH,
      breakdown: [
        { id: 'chequing-a', label: 'BILLS ACCOUNT', value: 900 },
        { id: 'chequing-b', label: 'WEEKLY SPENDING', value: 334.56 },
      ],
    },
  });
  const row = activeOf(recommend(plan, []));
  ok(near(row.liveCurrentBalance, LIVE_CASH) && near(row.opening, OPENING)
      && !near(row.opening, LIVE_CASH),
    'Q01 / PEB opening stays the snapshot; live Current Balance stays the glance');
}

console.log('\n=== N. Incompatible evidence dates fail closed ===');
{
  const mismatched = fixturePlan({
    opening: {
      asOf: AS_OF,
      priorAsOf: PAYDAY,
      paydaySnapshot: { periodStart: PAYDAY, asOf: AS_OF, opening: OPENING },
    },
  });
  const row = activeOf(recommend(mismatched, []));
  ok(row && row.paydayBoundaryOpening !== true
      && row.afterHouseholdBudget == null && row.predictedEndingBalance == null
      && row.predictedEndingBalanceTerms == null,
    'snapshot as-of mid-period is not combined with the Sep 11 window');

  const liveOnly = fixturePlan({
    opening: { asOf: AS_OF, priorAsOf: PAYDAY, representedEvents: [] },
  });
  const liveRow = activeOf(recommend(liveOnly, []));
  ok(liveRow.afterHouseholdBudget == null
      && !near(liveRow.opening, LIVE_CASH),
    'later live cash is not used as a silent payday-boundary opening');
}

console.log('\n=== O/P reprint and long-horizon (strengthened) ===');
{
  const plan = fixturePlan();
  const advice = recommend(plan, [groceryTx(100)]);
  const row = activeOf(advice);
  const html = composer.calendarWaterfallHtml(row, null, advice.paydayAllocation, plan);
  ok(html.includes(composer.money2(row.afterHouseholdBudget))
      && /data-peb-terms-closes="true"/.test(html)
      && html.includes(composer.money2(row.predictedEndingBalanceTerms.periodIncome)),
    'Budget reprints the Forecast PEB amount and the closed identity terms');
  ok(advice.defaultView.predictedEndingBalanceTerms
      && advice.defaultView.predictedEndingBalanceTerms.closes === true
      && near(advice.defaultView.predictedEndingBalance, row.afterHouseholdBudget),
    'defaultView reprints the same Forecast PEB and terms');
  ok(!F.baselineTrajectory(plan, [], AS_OF, {
    targetBuffer: 0,
    debts: [],
    currentPeriodActuals: actuals([]),
  }).predictedEndingBalance,
    'long-horizon trajectory still does not own Predicted Ending Balance');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exitCode = failures ? 1 : 0;
