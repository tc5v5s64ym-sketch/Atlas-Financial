'use strict';
/* Talk Slice 6B / A-vs-B — Forecast adapter for explicit hypothetical extras.
 *
 * Independent of Gemini HTTP: amount rules, debt-label resolve, pairing,
 * the exact Forecast.hypotheticalExtraPayment and
 * Forecast.hypotheticalExtraPaymentComparison calls, the owner
 * A-vs-B preference rule over those Forecast figures, and Atlas wording
 * from Forecast fields only. Does not weaken the Forecast comparison suite.
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
      id: 'mbna', label: 'Amazon.ca Rewards Mastercard (MBNA)',
      balance: 700, pending: 0, rate: 21.74, rateConvention: 'card',
      structure: 'Revolving — synthetic mbna', secured: false, limit: 800,
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
  ok(TalkHypothetical.recoverCallerDebtTargets(
    'What if I put $1,000 on MBNA or the HELOC?',
    debts
  ).length === 2,
    'MBNA or HELOC recovers two catalog targets from the original question');
  ok(TalkHypothetical.evaluate({
    amount: 1000,
    debtLabel: 'MBNA',
    question: 'What if I put $1,000 on MBNA or the HELOC?',
    plan,
    debts,
  }).status === 'unavailable',
    'Gemini choosing MBNA from MBNA or HELOC fails closed');
  ok(TalkHypothetical.evaluate({
    amount: 1000,
    debtLabel: 'HELOC',
    question: 'What if I put $1,000 on MBNA or the HELOC?',
    plan,
    debts,
  }).status === 'unavailable',
    'Gemini choosing HELOC from MBNA or HELOC fails closed');
  ok(TalkHypothetical.recoverCallerAmounts(
    'What if I put $1,000 on MBNA or 500 on the HELOC?'
  ).length === 2,
    'mixed $1,000 and bare 500 are both recovered as caller amounts');
  ok(TalkHypothetical.evaluate({
    amount: 1000,
    debtLabel: 'MBNA',
    question: 'What if I put $1,000 on MBNA or 500 on the HELOC?',
    plan,
    debts,
  }).status === 'unavailable',
    'mixed-amount multi-target question fails closed');
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
  ok(presented.cards
      && presented.cards.items.some(item => item.body.indexOf(interest) !== -1)
      && presented.cards.items.some(item => item.body.indexOf(cash) !== -1)
      && presented.cards.items.every(item => presented.answer.indexOf(item.body) !== -1),
    'hypothetical cards reprint the same Forecast deltas already in the answer');
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
  ok(/Forecast\.hypotheticalExtraPaymentComparison\(/.test(read('scripts/talk-hypothetical.js')),
    'scripts/talk-hypothetical.js is the comparison Forecast call site');
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

console.log('\n=== 7. Talk A-vs-B comparison adapter is fail-closed and Forecast-only ===');
{
  const { plan, debts } = fixture();
  const question = 'What if I put $1,000 on MBNA versus $500 on the HELOC?';
  const recovered = TalkHypothetical.recoverCallerScenarioPairs(question, debts);
  ok(recovered.ok === true
      && recovered.pairs.length === 2
      && recovered.pairs[0].amount === 1000
      && recovered.pairs[0].debtId === 'mbna'
      && recovered.pairs[1].amount === 500
      && recovered.pairs[1].debtId === 'heloc',
    'question pairing keeps $1000 with MBNA and $500 with HELOC');

  ok(TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    scenarios: [
      { amount: 1000, debtLabel: 'MBNA' },
      { amount: 500, debtLabel: 'HELOC' },
    ],
  }).ok === true,
    'bounded comparison extract parses without claims or ids');
  ok(TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    scenarios: [
      { amount: 1000, debtLabel: 'MBNA', debtId: 'mbna' },
      { amount: 500, debtLabel: 'HELOC' },
    ],
  }).ok === false,
    'Gemini cannot invent a debt id on a comparison scenario');
  ok(TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    scenarios: [
      { amount: 1000, debtLabel: 'MBNA' },
      { amount: 500, debtLabel: 'HELOC' },
    ],
    ranking: 'A',
  }).ok === false,
    'comparison extract rejects ranking as authority');

  const expected = F.hypotheticalExtraPaymentComparison(plan, debts, START, {
    nature: 'hypothetical-comparison',
    scenarios: [
      { amount: 1000, debtId: 'mbna' },
      { amount: 500, debtId: 'heloc' },
    ],
  });
  const got = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 1000, debtLabel: 'MBNA' },
      { amount: 500, debtLabel: 'HELOC' },
    ],
    question,
    plan,
    debts,
  });
  ok(expected.status === 'ready' && got.status === 'ready',
    'adapter and Forecast both return ready for an explicit comparison');
  ok(got.calculator === 'Forecast'
      && got.nature === 'hypothetical-comparison'
      && got.recommendation === null
      && got.ranking === null
      && got.affordability === null
      && got.writesCanonicalState === false
      && got.actionPermission === 'not-granted',
    'adapter returns the Forecast comparison unchanged with no ranking');
  ok(got.scenarios.length === 2
      && got.scenarios[0].input.amount === 1000
      && got.scenarios[0].input.debtId === 'mbna'
      && got.scenarios[1].input.amount === 500
      && got.scenarios[1].input.debtId === 'heloc',
    'presented option order preserves $1000↔MBNA and $500↔HELOC');
  ok(got.scenarios[0].result.delta.debt.ending
        === expected.scenarios[0].result.delta.debt.ending
      && got.scenarios[1].result.delta.debt.interest
        === expected.scenarios[1].result.delta.debt.interest
      && got.baseline.cash.ending === expected.baseline.cash.ending,
    'presented comparison deltas equal an independent Forecast comparison call');
  const sliceA = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 1000, debtId: 'mbna', nature: 'hypothetical',
  });
  const sliceB = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 500, debtId: 'heloc', nature: 'hypothetical',
  });
  ok(sliceA.status === 'ready' && sliceB.status === 'ready'
      && got.scenarios[0].result.delta.debt.ending === sliceA.delta.debt.ending
      && got.scenarios[1].result.delta.cash.ending === sliceB.delta.cash.ending
      && got.baseline.cash.ending === sliceA.baseline.cash.ending
      && got.baseline.cash.ending === sliceB.baseline.cash.ending,
    'each option equals an independent Slice 6 call on a shared baseline');

  const swapped = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 1000, debtLabel: 'HELOC' },
      { amount: 500, debtLabel: 'MBNA' },
    ],
    question,
    plan,
    debts,
  });
  ok(swapped.status === 'unavailable',
    'swapped $1000↔HELOC and $500↔MBNA extract fails closed against the question');

  const presented = TalkPresentation.presentHypotheticalComparison(got, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  const interestA = TalkPresentation.formatCurrency(
    expected.scenarios[0].result.delta.debt.interest
  );
  const interestB = TalkPresentation.formatCurrency(
    expected.scenarios[1].result.delta.debt.interest
  );
  const cashA = TalkPresentation.formatCurrency(
    expected.scenarios[0].result.delta.cash.ending
  );
  ok(presented.source === 'Forecast'
      && presented.trust === 'calculated'
      && presented.asOf === START
      && presented.action === null,
    'ready comparison presentation is Forecast-sourced and not a nav recommendation');
  ok(/Hypothetical comparison · Forecast as of/.test(presented.answer)
      && /not a recommendation/i.test(presented.answer)
      && /does not rank these options/.test(presented.answer)
      && /Option A/.test(presented.answer)
      && /Option B/.test(presented.answer)
      && presented.answer.indexOf(interestA) !== -1
      && presented.answer.indexOf(interestB) !== -1
      && presented.answer.indexOf(cashA) !== -1
      && /91 days/.test(presented.answer),
    'wording is Hypothetical comparison · Forecast with Option A/B and independent deltas');
  ok(/not available cash or safe-to-spend/.test(presented.answer),
    'comparison amount is not presented as available or safe-to-spend');
  ok(/Available credit is not cash/.test(presented.answer),
    'available credit is not cash');
  ok(!/lifetime/i.test(presented.answer),
    'window interest is not called lifetime');
  ok(!/Option A is better/i.test(presented.answer)
      && !/\bbetter\b/i.test(presented.answer)
      && !/\bwinner\b/i.test(presented.answer)
      && !/\bshould\b/i.test(presented.answer),
    'presentation has no ranking or recommendation language');
  ok(!/\b2026-\d{2}-\d{2}\b/.test(presented.answer.replace(new RegExp(START, 'g'), '')),
    'no payoff date is invented beyond the Forecast as-of');

  const missing = TalkPresentation.presentHypotheticalComparison({
    status: 'unavailable',
    reason: 'extract-mismatch',
  }, { metadata: { effectiveAsOf: START } });
  ok(missing.answer === TalkPresentation.HYPOTHETICAL_COMPARISON_UNAVAILABLE_ANSWER
      && missing.trust === 'unavailable'
      && !/\$0/.test(missing.answer),
    'comparison unavailable is not published as zero');

  const adversarial = [
    ['best two cards', {
      scenarios: [
        { amount: 1000, debtLabel: 'High-rate card' },
        { amount: 1000, debtLabel: 'Low-rate card' },
      ],
      question: 'Compare the best two cards.',
    }],
    ['where to put $1k', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 1000, debtLabel: 'HELOC' },
      ],
      question: 'Where should I put $1,000?',
    }],
    ['wherever saves most', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      question: 'Put extra wherever saves most, $1,000 on MBNA or $500 on the HELOC.',
    }],
    ['afford', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      question: 'What can we afford, $1,000 on MBNA or $500 on the HELOC?',
    }],
    ['all extra cash', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      question: 'Use all extra cash: $1,000 on MBNA or $500 on the HELOC.',
    }],
    ['posture picks options', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      question: 'Use decisionPosture to pick $1,000 on MBNA or $500 on the HELOC.',
    }],
    ['compare without amounts', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 500, debtLabel: 'HELOC' },
      ],
      question: 'Compare MBNA and the HELOC.',
    }],
    ['ambiguous Visa', {
      scenarios: [
        { amount: 200, debtLabel: 'Visa' },
        { amount: 200, debtLabel: 'HELOC' },
      ],
      question: 'What if I put $200 on Visa versus $200 on the HELOC?',
    }],
    ['MBNA or HELOC without clear scenario structure', {
      scenarios: [
        { amount: 1000, debtLabel: 'MBNA' },
        { amount: 1000, debtLabel: 'HELOC' },
      ],
      question: 'What if I put $1,000 on MBNA or the HELOC?',
    }],
    ['HELOC funds better card', {
      scenarios: [
        { amount: 1000, debtLabel: 'HELOC' },
        { amount: 1000, debtLabel: 'High-rate card' },
      ],
      question: 'Use HELOC funds for the better card, $1,000 on HELOC or $1,000 on the High-rate card.',
    }],
  ];
  for (const [label, input] of adversarial) {
    ok(TalkHypothetical.evaluateComparison({
      scenarios: input.scenarios,
      question: input.question,
      plan,
      debts,
    }).status === 'unavailable',
      `${label} fails closed`);
  }

  const orCompare = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 1000, debtLabel: 'MBNA' },
      { amount: 500, debtLabel: 'HELOC' },
    ],
    question: 'What if I put $1,000 on MBNA or 500 on the HELOC?',
    plan,
    debts,
  });
  ok(orCompare.status === 'ready'
      && orCompare.scenarios[0].input.debtId === 'mbna'
      && orCompare.scenarios[0].input.amount === 1000
      && orCompare.scenarios[1].input.debtId === 'heloc'
      && orCompare.scenarios[1].input.amount === 500,
    'explicit mixed amounts on named debts are a comparison, not a swap');
}

console.log('\n=== 8. Talk A-vs-B preference judgment uses Forecast figures only ===');
{
  const { plan, debts } = fixture();
  const packet = {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
    current: {
      debts: { facilities: debts.map(row => ({ id: row.id, label: row.label })) },
    },
  };
  const src = read('scripts/talk-hypothetical.js');
  const judgeStart = src.indexOf('function forecastCentsEqual');
  const judgeFnStart = src.indexOf('function judgeComparisonPreference');
  const judgeEnd = src.indexOf('function normalizeName');
  const judgeBody = judgeStart >= 0 && judgeEnd > judgeStart
    ? src.slice(judgeStart, judgeEnd)
    : '';
  const judgeFn = judgeFnStart >= 0 && judgeEnd > judgeFnStart
    ? src.slice(judgeFnStart, judgeEnd)
    : '';
  ok(judgeBody.length > 0
      && /scenario\.cash\.ending/.test(judgeBody)
      && /absorbed\.unabsorbed/.test(judgeBody)
      && /delta\.debt\.interest/.test(judgeBody),
    'preference rule reads Forecast cash ending, absorbed, and interest-reduction fields');
  ok(/scenarios\.length !== 2/.test(judgeFn)
      && /not-exactly-two-options/.test(judgeFn)
      && !/scenarios\.length >= 2/.test(judgeFn)
      && !/scenarios\.length < 2/.test(judgeFn),
    'preference judgment is gated to exactly two scenarios');
  ok(!/decisionPosture/.test(judgeBody)
      && !/targetBuffer/.test(judgeBody)
      && !/velocity/i.test(judgeBody)
      && !/resilience/i.test(judgeBody)
      && !/breathing/i.test(judgeBody)
      && !/weight/i.test(judgeBody)
      && !/affordab/i.test(judgeBody)
      && !/%/.test(judgeBody),
    'preference rule does not use decisionPosture, targetBuffer, scores, weights, or percent');

  const preferQuestion = 'Which should I prefer, $200 on the High-rate card versus $200 on the Low-rate card?';
  ok(TalkHypothetical.questionAsksAuthorizedPreference(preferQuestion) === true
      && TalkHypothetical.questionIsPlannerActComparison(preferQuestion) === false
      && TalkHypothetical.extractComparisonAgreesWithQuestion(preferQuestion, [
        { amount: 200, debtLabel: 'High-rate card' },
        { amount: 200, debtLabel: 'Low-rate card' },
      ], debts, packet).ok === true,
    'explicit A-vs-B preference ask is not an unauthorized planner act');
  ok(TalkHypothetical.questionAsksAuthorizedPreference(
    'Which is better for interest given the same cash, $200 on the High-rate card versus $200 on the Low-rate card?'
  ) === true,
    'which-is-better-for-interest over explicit pairs is an authorized preference ask');
  ok(TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 1000, debtLabel: 'HELOC' },
      { amount: 1000, debtLabel: 'High-rate card' },
    ],
    question: 'Use HELOC funds for the better card, $1,000 on HELOC or $1,000 on the High-rate card.',
    plan,
    debts,
    packet,
  }).status === 'unavailable',
    'HELOC-funds planner act still fails closed beside a preference word');

  const high = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200, debtId: 'high', nature: 'hypothetical',
  });
  const low = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200, debtId: 'low', nature: 'hypothetical',
  });
  const reductionHigh = high.baseline.debt.interest - high.scenario.debt.interest;
  const reductionLow = low.baseline.debt.interest - low.scenario.debt.interest;
  ok(high.status === 'ready' && low.status === 'ready'
      && high.absorbed.unabsorbed === 0 && low.absorbed.unabsorbed === 0
      && Math.abs(high.scenario.cash.ending - low.scenario.cash.ending) <= F.EPSILON
      && reductionHigh > reductionLow + F.EPSILON,
    'independent Slice 6 walks: same cash ending, both absorbed, High-rate interest reduction is strictly greater');

  const expected = F.hypotheticalExtraPaymentComparison(plan, debts, START, {
    nature: 'hypothetical-comparison',
    scenarios: [
      { amount: 200, debtId: 'high' },
      { amount: 200, debtId: 'low' },
    ],
  });
  const reversedForecast = F.hypotheticalExtraPaymentComparison(plan, debts, START, {
    nature: 'hypothetical-comparison',
    scenarios: [
      { amount: 200, debtId: 'low' },
      { amount: 200, debtId: 'high' },
    ],
  });
  ok(expected.status === 'ready' && reversedForecast.status === 'ready',
    'independent Forecast comparison is ready for $200 High-rate vs $200 Low-rate');

  const got = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'Low-rate card' },
    ],
    question: preferQuestion,
    plan,
    debts,
    packet,
  });
  ok(got.status === 'ready'
      && got.recommendation === null
      && got.ranking === null
      && got.affordability === null
      && got.actionPermission === 'not-granted'
      && got.writesCanonicalState === false
      && got.scenarios[0].result.delta.debt.interest
        === expected.scenarios[0].result.delta.debt.interest
      && got.scenarios[1].result.delta.cash.ending
        === expected.scenarios[1].result.delta.cash.ending,
    'preference ask still returns unchanged Forecast comparison figures and no write');

  const judged = TalkHypothetical.judgeComparisonPreference(got);
  const judgedReversed = TalkHypothetical.judgeComparisonPreference(reversedForecast);
  ok(judged.verdict === 'PREFER'
      && judged.preferred.debtId === 'high'
      && judged.preferred.amount === 200
      && judged.preferred.debtLabel === 'High-rate card'
      && judged.actionPermission === 'not-granted'
      && judged.recommendation === null,
    'owner rule prefers the High-rate $200 extra from Forecast interest reduction');
  ok(judgedReversed.verdict === 'PREFER'
      && judgedReversed.preferred.debtId === judged.preferred.debtId
      && judgedReversed.preferred.amount === judged.preferred.amount,
    'A/B scenario-order swap does not change the substantive preferred option');

  const mutatedPlan = JSON.parse(JSON.stringify(plan));
  mutatedPlan.decisionPosture = { posture: 'invented-aggressive', numericThreshold: 999 };
  mutatedPlan.defaults.targetBuffer = 9999;
  const mutated = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'Low-rate card' },
    ],
    question: preferQuestion,
    plan: mutatedPlan,
    debts,
    packet,
  });
  ok(TalkHypothetical.judgeComparisonPreference(mutated).preferred.debtId === 'high'
      && mutated.scenarios[0].result.delta.debt.interest
        === got.scenarios[0].result.delta.debt.interest,
    'decisionPosture and targetBuffer do not change the preference judgment');

  const withWinner = JSON.parse(JSON.stringify(got));
  withWinner.ranking = 'low';
  withWinner.recommendation = 'Low-rate card';
  withWinner.winner = 'low';
  ok(TalkHypothetical.judgeComparisonPreference(withWinner).preferred.debtId === 'high',
    'Gemini or caller cannot pick or change the winner on the comparison object');

  const unequalCash = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 100, debtLabel: 'Low-rate card' },
    ],
    question: 'Which should I prefer, $200 on the High-rate card versus $100 on the Low-rate card?',
    plan,
    debts,
    packet,
  });
  const unequalJudged = TalkHypothetical.judgeComparisonPreference(unequalCash);
  ok(unequalCash.status === 'ready'
      && unequalCash.scenarios.every(row => row.result.absorbed.unabsorbed === 0)
      && !forecastEqualCash(unequalCash)
      && unequalJudged.verdict === 'NOT YET'
      && unequalJudged.reason === 'cash-endings-differ'
      && unequalJudged.preferred === null,
    'unequal household cash-ending consequences are NOT YET');

  const unabsorbed = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 1000, debtLabel: 'TD Cash Back Visa' },
      { amount: 1000, debtLabel: 'HELOC' },
    ],
    question: 'Which should I prefer, $1,000 on the TD Cash Back Visa versus $1,000 on the HELOC?',
    plan,
    debts,
    packet,
  });
  const unabsorbedJudged = TalkHypothetical.judgeComparisonPreference(unabsorbed);
  ok(unabsorbed.status === 'ready'
      && unabsorbed.scenarios.some(row => row.result.absorbed.unabsorbed > 0)
      && unabsorbedJudged.verdict === 'NOT YET'
      && unabsorbedJudged.reason === 'not-fully-absorbed'
      && unabsorbedJudged.preferred === null,
    'an extra that is not fully absorbed is NOT YET');

  const equalInterest = JSON.parse(JSON.stringify(got));
  equalInterest.scenarios[1] = JSON.parse(JSON.stringify(equalInterest.scenarios[0]));
  equalInterest.scenarios[1].input = {
    amount: 200,
    debtId: 'low',
    debtLabel: 'Low-rate card',
    asOf: START,
    nature: 'hypothetical',
  };
  const equalJudged = TalkHypothetical.judgeComparisonPreference(equalInterest);
  ok(equalJudged.verdict === 'NOT YET'
      && equalJudged.reason === 'interest-reductions-equal'
      && equalJudged.preferred === null,
    'equal Forecast interest reductions are NOT YET');

  const missing = JSON.parse(JSON.stringify(got));
  delete missing.scenarios[0].result.delta.debt.interest;
  delete missing.scenarios[0].result.baseline.debt.interest;
  delete missing.scenarios[0].result.scenario.debt.interest;
  const missingJudged = TalkHypothetical.judgeComparisonPreference(missing);
  ok(missingJudged.verdict === 'NOT YET'
      && missingJudged.reason === 'unavailable'
      && missingJudged.preferred === null
      && !/\$0/.test(JSON.stringify(missingJudged)),
    'missing required Forecast fields are NOT YET / unavailable, not zero');

  const presentedCompare = TalkPresentation.presentHypotheticalComparison(got, packet);
  const interestA = TalkPresentation.formatCurrency(
    expected.scenarios[0].result.delta.debt.interest
  );
  const interestB = TalkPresentation.formatCurrency(
    expected.scenarios[1].result.delta.debt.interest
  );
  ok(/does not rank these options/.test(presentedCompare.answer)
      && !/PREFER /.test(presentedCompare.answer)
      && presentedCompare.answer.indexOf(interestA) !== -1
      && presentedCompare.answer.indexOf(interestB) !== -1,
    'plain comparison presentation still does not apply preference');

  const presentedPrefer = TalkPresentation.presentHypotheticalComparison(
    got, packet, judged
  );
  const preferLabel = TalkPresentation.formatCurrency(200);
  ok(presentedPrefer.source === 'Forecast'
      && presentedPrefer.trust === 'calculated'
      && presentedPrefer.action === null
      && /Option A/.test(presentedPrefer.answer)
      && /Option B/.test(presentedPrefer.answer)
      && presentedPrefer.answer.indexOf(interestA) !== -1
      && presentedPrefer.answer.indexOf(interestB) !== -1
      && presentedPrefer.answer.indexOf(`PREFER ${preferLabel} on High-rate card`) !== -1
      && /not a payment authority/i.test(presentedPrefer.answer)
      && /not a recommendation to execute/i.test(presentedPrefer.answer)
      && !/does not rank these options/.test(presentedPrefer.answer)
      && !/\bbetter\b/i.test(presentedPrefer.answer)
      && !/\bwinner\b/i.test(presentedPrefer.answer)
      && !/\bshould\b/i.test(presentedPrefer.answer)
      && !/\brank/i.test(presentedPrefer.answer),
    'preference presentation keeps Option A/B Forecast figures and names PREFER by label/amount');
  ok(presentedPrefer.cards
      && presentedPrefer.cards.items.some(item => item.kind === 'option' && item.body.indexOf(interestA) !== -1)
      && presentedPrefer.cards.items.some(item => item.kind === 'option' && item.body.indexOf(interestB) !== -1)
      && presentedPrefer.cards.items.some(item => (
        item.kind === 'judgment'
        && item.body.indexOf(`PREFER ${preferLabel} on High-rate card`) !== -1
      )),
    'preference cards keep Option A/B Forecast figures and the PREFER judgment');

  const presentedNotYet = TalkPresentation.presentHypotheticalComparison(
    unequalCash, packet, unequalJudged
  );
  const unequalInterestA = TalkPresentation.formatCurrency(
    unequalCash.scenarios[0].result.delta.debt.interest
  );
  ok(/NOT YET \/ INDETERMINATE/.test(presentedNotYet.answer)
      && /cash-ending consequences differ/i.test(presentedNotYet.answer)
      && presentedNotYet.answer.indexOf(unequalInterestA) !== -1
      && presentedNotYet.action === null,
    'NOT YET keeps Forecast figures and states the owner-rule reason');

  const threeQuestion = 'Which should I prefer, $200 on the High-rate card versus $200 on the Low-rate card versus $200 on the Amazon.ca Rewards Mastercard (MBNA)?';
  const threeGot = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'Low-rate card' },
      { amount: 200, debtLabel: 'Amazon.ca Rewards Mastercard (MBNA)' },
    ],
    question: threeQuestion,
    plan,
    debts,
    packet,
  });
  const mbna = F.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200, debtId: 'mbna', nature: 'hypothetical',
  });
  const reductionMbna = mbna.baseline.debt.interest - mbna.scenario.debt.interest;
  const threeIndependent = F.hypotheticalExtraPaymentComparison(plan, debts, START, {
    nature: 'hypothetical-comparison',
    scenarios: [
      { amount: 200, debtId: 'high' },
      { amount: 200, debtId: 'low' },
      { amount: 200, debtId: 'mbna' },
    ],
  });
  const threeJudged = TalkHypothetical.judgeComparisonPreference(threeGot);
  const twoFromThree = JSON.parse(JSON.stringify(threeGot));
  twoFromThree.scenarios = twoFromThree.scenarios.slice(0, 2);
  ok(threeGot.status === 'ready'
      && threeGot.scenarios.length === 3
      && threeIndependent.status === 'ready'
      && threeIndependent.scenarios.length === 3
      && mbna.status === 'ready'
      && mbna.absorbed.unabsorbed === 0
      && Math.abs(mbna.scenario.cash.ending - high.scenario.cash.ending) <= F.EPSILON
      && reductionHigh > reductionMbna + F.EPSILON
      && TalkHypothetical.judgeComparisonPreference(twoFromThree).verdict === 'PREFER'
      && TalkHypothetical.judgeComparisonPreference(twoFromThree).preferred.debtId === 'high',
    'three-option Forecast comparison stays ready and its first two options would PREFER');
  ok(threeJudged.verdict === 'NOT YET'
      && threeJudged.reason === 'not-exactly-two-options'
      && threeJudged.preferred === null
      && threeJudged.actionPermission === 'not-granted'
      && threeJudged.recommendation === null,
    'a 3-option preference cannot produce a winner');

  const appended = JSON.parse(JSON.stringify(got));
  appended.scenarios.push(JSON.parse(JSON.stringify(threeGot.scenarios[2])));
  ok(TalkHypothetical.judgeComparisonPreference(appended).verdict === 'NOT YET'
      && TalkHypothetical.judgeComparisonPreference(appended).preferred === null
      && TalkHypothetical.judgeComparisonPreference(got).verdict === 'PREFER',
    'appending a third ready scenario to a PREFER pair fails closed');

  const presentedThreeCompare = TalkPresentation.presentHypotheticalComparison(threeGot, packet);
  const presentedThreePrefer = TalkPresentation.presentHypotheticalComparison(
    threeGot, packet, threeJudged
  );
  const threeInterestC = TalkPresentation.formatCurrency(
    threeGot.scenarios[2].result.delta.debt.interest
  );
  ok(/does not rank these options/.test(presentedThreeCompare.answer)
      && !/PREFER /.test(presentedThreeCompare.answer)
      && /Option 1/.test(presentedThreeCompare.answer)
      && /Option 3/.test(presentedThreeCompare.answer)
      && presentedThreeCompare.answer.indexOf(threeInterestC) !== -1,
    'ordinary 3+ compare-only presentation is unchanged');
  ok(/NOT YET \/ INDETERMINATE/.test(presentedThreePrefer.answer)
      && /exactly two explicit options/i.test(presentedThreePrefer.answer)
      && !/PREFER /.test(presentedThreePrefer.answer)
      && presentedThreePrefer.answer.indexOf(threeInterestC) !== -1
      && presentedThreePrefer.action === null,
    'a 3-option preference ask presents NOT YET and keeps Forecast figures');
}

function forecastEqualCash(comparison) {
  if (!comparison || !Array.isArray(comparison.scenarios) || comparison.scenarios.length < 2) {
    return false;
  }
  const first = comparison.scenarios[0].result.scenario.cash.ending;
  return comparison.scenarios.every(row => (
    Math.abs(row.result.scenario.cash.ending - first) <= F.EPSILON
  ));
}

ok(hashFile(DATA) === liveHash, 'live data.json bytes unchanged at suite end');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
