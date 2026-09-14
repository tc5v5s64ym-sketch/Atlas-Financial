'use strict';
/* Talk Slice 6B — Forecast adapter for one explicit hypothetical extra.
 *
 * Independent of Gemini HTTP: amount rules, debt-label resolve, the
 * exact Forecast.hypotheticalExtraPayment call, and Atlas wording from
 * Forecast fields only. Does not weaken test-hypothetical-extra-payment.js.
 * `node test/test-talk-hypothetical.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('../public/forecast.js');
const TalkHypothetical = require('../scripts/talk-hypothetical');
const TalkPresentation = require('../scripts/talk-presentation');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const liveHash = hashFile(DATA);
const START = '2026-01-15';

function fixture() {
  const plan = {
    windowDays: 91,
    startingCash: { amount: 2000 },
    defaults: { targetBuffer: 500, extraDebtMonthly: 0, scenario: 'expected' },
    opening: { asOf: START },
    nextDollar: {
      policy: 'true-surplus-highest-interest',
      provenance: 'owner-stated',
    },
    decisionPosture: {
      posture: 'aggressive-not-brittle',
      numericThreshold: 'none',
    },
    income: [],
    obligations: [],
    bills: [],
    commitments: [],
  };
  const debts = [
    {
      id: 'high', label: 'High-rate card',
      balance: 800, pending: 0, rate: 26.99, rateConvention: 'card',
      structure: 'Revolving — synthetic high', secured: false, limit: 1200,
    },
    {
      id: 'low', label: 'Low-rate card',
      balance: 600, pending: 0, rate: 19.99, rateConvention: 'card',
      structure: 'Revolving — synthetic low', secured: false, limit: 1000,
    },
    {
      id: 'cashback', label: 'TD Cash Back Visa',
      balance: 400, pending: 0, rate: 26.99, rateConvention: 'card',
      structure: 'Revolving — synthetic cashback', secured: false, limit: 500,
    },
    {
      id: 'travelvisa', label: 'Travel Visa (business)',
      balance: 300, pending: 0, rate: 19.99, rateConvention: 'card',
      structure: 'Revolving — synthetic travel', secured: false, limit: 400,
    },
    {
      id: 'tdcc', label: 'TD credit card',
      balance: 100, pending: 0, rate: 20.99, rateConvention: 'card',
      structure: 'Revolving — synthetic tdcc', secured: false, limit: 200,
    },
    {
      id: 'heloc', label: 'HELOC',
      balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
      structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
    },
    {
      id: 'mortgage', label: 'Mortgage',
      balance: 200000, pending: 0, rate: 3.64, rateConvention: 'variable',
      structure: 'Amortising — synthetic', secured: true, limit: null,
    },
  ];
  return { plan, debts };
}

console.log('=== 1. Amount contract matches Slice 6 before Forecast ===');
{
  ok(TalkHypothetical.parseCallerAmount(1000).ok === true
      && TalkHypothetical.parseCallerAmount(1000).amount === 1000,
    'plain 1000 is accepted');
  ok(TalkHypothetical.parseCallerAmount('$1,000').ok === true
      && TalkHypothetical.parseCallerAmount('$1,000').amount === 1000,
    'NL $1,000 becomes 1000');
  ok(TalkHypothetical.parseCallerAmount('$1,000.00').amount === 1000,
    'NL $1,000.00 becomes 1000');
  ok(TalkHypothetical.parseCallerAmount('a grand or two').ok === false,
    'a grand or two fails closed');
  ok(TalkHypothetical.parseCallerAmount('everything left').ok === false,
    'everything left fails closed');
  ok(TalkHypothetical.parseCallerAmount('half of what we have').ok === false,
    'half of what we have fails closed');
  ok(TalkHypothetical.parseCallerAmount(0).ok === false
      && TalkHypothetical.parseCallerAmount(-25).ok === false,
    'zero and negative fail closed');
  ok(TalkHypothetical.parseCallerAmount(TalkHypothetical.HYPOTHETICAL_EXTRA_MAX + 0.01).ok === false,
    'over the Slice 6 max fails closed');
  ok(TalkHypothetical.parseCallerAmount(10.001).ok === false,
    'sub-cent amounts fail closed');
}

console.log('\n=== 2. Debt-label resolve is deterministic and fail-closed ===');
{
  const { debts } = fixture();
  ok(TalkHypothetical.resolveDebtLabel('High-rate card', debts).debtId === 'high',
    'exact unique label resolves to the stable id');
  ok(TalkHypothetical.resolveDebtLabel('HELOC', debts).debtId === 'heloc',
    'HELOC resolves uniquely');
  ok(TalkHypothetical.resolveDebtLabel('TD Cash Back Visa', debts).debtId === 'cashback',
    'Cash Back Visa is a unique alias already on the debt label');
  ok(TalkHypothetical.resolveDebtLabel('Visa', debts).ok === false,
    'Visa with two matches is unavailable');
  ok(TalkHypothetical.resolveDebtLabel('credit card', debts).ok === false,
    'generic credit card does not resolve to TD credit card');
  ok(TalkHypothetical.resolveDebtLabel('TD card', debts).ok === false,
    'generic TD card does not resolve to TD credit card');
  ok(TalkHypothetical.resolveDebtLabel('TD credit card', debts).debtId === 'tdcc',
    'exact TD credit card label still resolves');
  ok(TalkHypothetical.resolveDebtLabel('best debt', debts).ok === false,
    'best debt does not resolve');
  ok(TalkHypothetical.resolveDebtLabel('Mortgage', debts).debtId === 'mortgage',
    'Mortgage uniquely names the ineligible row; Forecast decides eligibility');
  ok(TalkHypothetical.parseExtract({
    intent: 'hypothetical-extra-payment',
    amount: 200,
    debtLabel: 'High-rate card',
    debtId: 'high',
  }).ok === false,
    'Gemini cannot invent a debt id field');
}

console.log('\n=== 3. Forecast is the sole calculator; nextDollar is not substituted ===');
{
  const { plan, debts } = fixture();
  const expected = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200,
    debtId: 'high',
    nature: 'hypothetical',
  });
  const got = TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'High-rate card',
    question: 'What if I put $200 on the High-rate card?',
    plan,
    debts,
  });
  ok(expected.status === 'ready' && got.status === 'ready',
    'adapter and Forecast both return ready for an explicit extra');
  ok(got.calculator === 'Forecast'
      && got.input.debtId === 'high'
      && got.input.amount === 200
      && got.recommendation === null
      && got.writesCanonicalState === false,
    'adapter returns the Forecast result unchanged');
  ok(got.delta.debt.ending === expected.delta.debt.ending
      && got.delta.debt.interest === expected.delta.debt.interest
      && got.delta.cash.ending === expected.delta.cash.ending,
    'presented deltas equal an independent Forecast.hypotheticalExtraPayment call');
  ok(got.provenance && got.provenance.ownerNextDollarNotUsedForHypotheticalTarget === true
      && got.provenance.targetSource === 'caller',
    'caller target is honored; nextDollar is not substituted');
  ok(got.input.amount !== plan.defaults.targetBuffer
      && got.input.amount !== 500,
    'amount is not inferred from targetBuffer');
}

console.log('\n=== 4. Fail-closed planner acts and Forecast ineligibility ===');
{
  const { plan, debts } = fixture();
  ok(TalkHypothetical.evaluate({
    amount: 'everything I can afford',
    debtLabel: 'HELOC',
    question: 'Put everything I can afford on the HELOC.',
    plan,
    debts,
  }).status === 'unavailable',
    'max-afford wording is not an amount');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'best debt',
    question: 'Put $200 on the best debt.',
    plan,
    debts,
  }).status === 'unavailable',
    'best-debt label is unavailable');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'Visa',
    question: 'What if I put $200 on Visa?',
    plan,
    debts,
  }).status === 'unavailable',
    'ambiguous Visa is unavailable');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'Mortgage',
    question: 'What if I put $200 on the Mortgage?',
    plan,
    debts,
  }).status === 'unavailable',
    'named mortgage is Forecast-ineligible and stays unavailable');
  ok(TalkHypothetical.evaluate({
    amount: 2000,
    debtLabel: 'High-rate card',
    question: 'What if I put $200 on the High-rate card?',
    plan,
    debts,
  }).status === 'unavailable',
    'Gemini-altered amount fails closed against the original question');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'Travel Visa (business)',
    question: 'What if I put $200 on the High-rate card?',
    plan,
    debts,
  }).status === 'unavailable',
    'Gemini-substituted debt label fails closed against the original question');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'credit card',
    question: 'What if I put $200 on the credit card?',
    plan,
    debts,
  }).status === 'unavailable',
    'credit card extract stays unavailable even when it is in the question');
  ok(TalkHypothetical.evaluate({
    amount: 200,
    debtLabel: 'TD card',
    question: 'What if I put $200 on the TD card?',
    plan,
    debts,
  }).status === 'unavailable',
    'TD card extract stays unavailable even when it is in the question');
  const funded = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 50, debtId: 'heloc', nature: 'hypothetical', fundFrom: 'heloc',
  });
  ok(funded.status === 'unavailable',
    'Forecast still refuses HELOC-as-source extras; adapter does not add that key');
}

console.log('\n=== 5. Presentation uses Forecast fields only ===');
{
  const { plan, debts } = fixture();
  const result = TalkHypothetical.evaluate({
    amount: '$200',
    debtLabel: 'High-rate card',
    question: 'What if I put $200 on the High-rate card?',
    plan,
    debts,
  });
  const presented = TalkPresentation.presentHypotheticalExtra(result, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  const interest = TalkPresentation.formatCurrency(result.delta.debt.interest);
  const cash = TalkPresentation.formatCurrency(result.delta.cash.ending);
  const credit = Number.isFinite(result.delta.debt.availableCredit)
    ? TalkPresentation.formatCurrency(result.delta.debt.availableCredit)
    : null;
  ok(presented.source === 'Forecast'
      && presented.trust === 'calculated'
      && presented.asOf === START
      && presented.action === null,
    'ready presentation is Forecast-sourced and not a nav recommendation');
  ok(/hypothetical scenario from Forecast/i.test(presented.answer)
      && /not a recommendation/i.test(presented.answer),
    'wording states Hypothetical scenario · Forecast and Not a recommendation');
  ok(presented.answer.indexOf(interest) !== -1
      && presented.answer.indexOf(cash) !== -1,
    'wording reprints independent Forecast interest and cash deltas');
  ok(/not available cash or safe-to-spend/.test(presented.answer),
    'amount is not presented as available or safe-to-spend');
  ok(/Available credit is not cash/.test(presented.answer) === !!credit,
    'available-credit disclaimer is present only when Forecast returned that delta');
  ok(!/lifetime/i.test(presented.answer),
    'window interest is not called lifetime');
  ok(!/\b2026-\d{2}-\d{2}\b/.test(presented.answer.replace(START, '')),
    'no payoff date is invented beyond the Forecast as-of');
  const missing = TalkPresentation.presentHypotheticalExtra({
    status: 'unavailable',
    reason: 'unresolved-debt',
  }, { metadata: { effectiveAsOf: START } });
  ok(missing.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER
      && missing.trust === 'unavailable'
      && !/\$0/.test(missing.answer),
    'unavailable is not published as zero');
}

console.log('\n=== 6. Talk files keep Forecast math in the adapter only ===');
{
  ok(/Forecast\.hypotheticalExtraPayment\(/.test(read('scripts/talk-hypothetical.js')),
    'scripts/talk-hypothetical.js is the Forecast call site');
  for (const file of [
    'scripts/talk-gemini.js',
    'scripts/talk-presentation.js',
    'server.js',
    'public/talk.js',
  ]) {
    ok(!/hypotheticalExtraPayment/.test(read(file)),
      `${file} does not reopen Forecast math`);
  }
  ok(!/require\(['"][^'"]*forecast/i.test(read('scripts/talk-presentation.js')),
    'presentation still does not import Forecast');
}

ok(hashFile(DATA) === liveHash, 'live data.json bytes unchanged at suite end');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
