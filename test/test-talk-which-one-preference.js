'use strict';
/* B103 Slice 4 — bare Which one? after exactly one earned A-vs-B.
 *
 * Independent proof: Talk preference on those stored pairs equals
 * judgeComparisonPreference on an independently computed Forecast
 * comparison of the same amount+debtId rows. Gemini cannot choose the
 * winner. Existing prefer-grammar still works. Leftover, payday-picture,
 * remaining-bills, and follow-up-ref asks stay on their incumbent paths.
 * `node test/test-talk-which-one-preference.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Forecast = require('../public/forecast.js');
const TalkGemini = require('../scripts/talk-gemini.js');
const TalkHypothetical = require('../scripts/talk-hypothetical.js');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkSession = require('../scripts/talk-session.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const START = '2026-01-15';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const liveHash = hashFile(DATA);

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
      id: 'heloc', label: 'HELOC',
      balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
      structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
    },
    {
      id: 'mbna', label: 'Amazon.ca Rewards Mastercard (MBNA)',
      balance: 700, pending: 0, rate: 21.74, rateConvention: 'card',
      structure: 'Revolving — synthetic mbna', secured: false, limit: 800,
    },
  ];
  return { plan, debts };
}

function packetFor(debts) {
  return {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
    current: {
      debts: { facilities: debts.map(row => ({ id: row.id, label: row.label })) },
    },
  };
}

function avbTurn() {
  return {
    kind: 'comparison',
    question: 'Compare $200 on the High-rate card versus $200 on the Low-rate card.',
    presented: 'Hypothetical comparison of two extras.',
    scenarios: [
      { amount: 200, debtId: 'high', debtLabel: 'High-rate card' },
      { amount: 200, debtId: 'low', debtLabel: 'Low-rate card' },
    ],
  };
}

function leftoverTurn() {
  return {
    kind: 'explained',
    question: 'What does this payday leave us with?',
    presented: 'Forecast leftover after big purchases is $12.34.',
    referentKeys: ['payday-leftover'],
    referentPaths: ['forecast.paydayAllocation.runningLeftover.afterBigPurchases'],
  };
}

function remainingTurn() {
  return {
    kind: 'explained',
    question: 'Is Shaw still due?',
    presented: 'Shaw internet is still due.',
    referentKeys: [TalkSession.REMAINING_BILLS_INTENT],
    billId: 'shaw',
    billLabel: 'Shaw internet',
  };
}

function hypTurn() {
  return {
    kind: 'hypothetical',
    question: 'What if I put $200 on the High-rate card?',
    presented: 'Hypothetical extra on High-rate card.',
    amount: 200,
    debtId: 'high',
    debtLabel: 'High-rate card',
  };
}

console.log('=== 1. Bare Which one? binds the one earned A-vs-B ===');
{
  const { plan, debts } = fixture();
  const packet = packetFor(debts);
  const prior = avbTurn();

  ok(TalkHypothetical.questionAsksWhichOneReferent('Which one?') === true
      && TalkHypothetical.questionAsksWhichOneReferent('So which one?') === true
      && TalkHypothetical.questionAsksWhichOneReferent('And which one') === true
      && TalkHypothetical.questionAsksAuthorizedPreference('Which one?') === false,
    'bare Which one? is a referent, not a broadened prefer-grammar');
  ok(TalkHypothetical.questionAsksWhichOneReferent(
    'Which is better for interest given the same cash, $200 on the High-rate card versus $200 on the Low-rate card?'
  ) === false
      && TalkHypothetical.questionAsksAuthorizedPreference(
        'Which is better for interest given the same cash, $200 on the High-rate card versus $200 on the Low-rate card?'
      ) === true,
    'explicit which-is-better prefer-grammar is unchanged');

  const follow = TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: prior,
    priorTurns: [prior],
    debts,
    packet,
  });
  ok(follow.status === 'resolved-preference'
      && follow.scenarios.length === 2
      && follow.scenarios[0].debtId === 'high'
      && follow.scenarios[0].amount === 200
      && follow.scenarios[1].debtId === 'low'
      && follow.scenarios[1].amount === 200,
    'Which one? reuses the exact earned High-rate vs Low-rate pairs');

  const independent = Forecast.hypotheticalExtraPaymentComparison(plan, debts, START, {
    nature: 'hypothetical-comparison',
    scenarios: [
      { amount: 200, debtId: 'high' },
      { amount: 200, debtId: 'low' },
    ],
  });
  const high = Forecast.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200, debtId: 'high', nature: 'hypothetical',
  });
  const low = Forecast.hypotheticalExtraPayment(plan, debts, START, {
    amount: 200, debtId: 'low', nature: 'hypothetical',
  });
  const reductionHigh = high.baseline.debt.interest - high.scenario.debt.interest;
  const reductionLow = low.baseline.debt.interest - low.scenario.debt.interest;
  ok(independent.status === 'ready'
      && high.status === 'ready' && low.status === 'ready'
      && high.absorbed.unabsorbed === 0 && low.absorbed.unabsorbed === 0
      && Math.abs(high.scenario.cash.ending - low.scenario.cash.ending) <= Forecast.EPSILON
      && reductionHigh > reductionLow + Forecast.EPSILON,
    'independent Forecast walks: same cash ending, both absorbed, High-rate interest reduction is strictly greater');

  const recomputed = TalkHypothetical.evaluateComparisonResolved({
    scenarios: follow.scenarios,
    plan,
    debts,
    packet,
  });
  const judged = TalkHypothetical.judgeComparisonPreference(recomputed);
  const independentJudged = TalkHypothetical.judgeComparisonPreference(independent);
  ok(recomputed.status === 'ready'
      && recomputed.scenarios[0].result.delta.debt.interest
        === independent.scenarios[0].result.delta.debt.interest
      && recomputed.scenarios[1].result.delta.cash.ending
        === independent.scenarios[1].result.delta.cash.ending,
    'Which one? recomputes the same Forecast comparison as the stored pairs');
  ok(judged.verdict === 'PREFER'
      && judged.preferred.debtId === 'high'
      && judged.preferred.amount === 200
      && judged.preferred.debtLabel === 'High-rate card'
      && judged.preferred.debtId === independentJudged.preferred.debtId
      && judged.actionPermission === 'not-granted'
      && judged.recommendation === null,
    'owner rule prefers the High-rate $200 extra from independently recomputed Forecast figures');

  const presented = TalkPresentation.presentHypotheticalComparison(
    recomputed, packet, judged
  );
  ok(/PREFER \$200\.00 on High-rate card/.test(presented.answer)
      && /not a payment authority/i.test(presented.answer)
      && presented.action === null,
    'presentation names PREFER on those exact two options');
}

console.log('\n=== 2. Ambiguous / multi / stale / 3+ fail closed ===');
{
  const { debts } = fixture();
  const packet = packetFor(debts);
  const prior = avbTurn();
  const other = {
    kind: 'comparison',
    question: 'Compare $200 on the High-rate card versus $200 on the HELOC.',
    presented: 'A second comparison.',
    scenarios: [
      { amount: 200, debtId: 'high', debtLabel: 'High-rate card' },
      { amount: 200, debtId: 'heloc', debtLabel: 'HELOC' },
    ],
  };
  const three = {
    kind: 'comparison',
    question: 'Compare three extras.',
    presented: 'Three options.',
    scenarios: [
      { amount: 200, debtId: 'high', debtLabel: 'High-rate card' },
      { amount: 200, debtId: 'low', debtLabel: 'Low-rate card' },
      { amount: 200, debtId: 'mbna', debtLabel: 'Amazon.ca Rewards Mastercard (MBNA)' },
    ],
  };

  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: prior,
    priorTurns: [prior, other],
    debts,
    packet,
  }).status === 'ambiguous',
    'two different earned comparisons fail closed');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: three,
    priorTurns: [three],
    debts,
    packet,
  }).status === 'ambiguous',
    'a 3-option prior fails closed');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: hypTurn(),
    priorTurns: [hypTurn()],
    debts,
    packet,
  }).status === 'ambiguous',
    'a prior that did not earn A-vs-B preference eligibility fails closed');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: leftoverTurn(),
    priorTurns: [prior, leftoverTurn()],
    debts,
    packet,
  }).status === 'ambiguous',
    'Which one? after leftover does not bind the earlier comparison');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: remainingTurn(),
    priorTurns: [prior, remainingTurn()],
    debts,
    packet,
  }).status === 'ambiguous',
    'Which one? after remaining bills does not pick a bill or a winner');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: null,
    priorTurns: [],
    debts,
    packet,
  }).status === 'ambiguous',
    'Which one? without a prior comparison fails closed');

  const staleDebts = debts.filter(row => row.id !== 'low');
  ok(TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: prior,
    priorTurns: [prior],
    debts: staleDebts,
    packet: packetFor(staleDebts),
  }).status === 'ambiguous',
    'current data that invalidates a stored target fails closed');

  const sameAgain = Object.assign({}, prior, {
    question: 'Which of those should I prefer?',
    presented: 'PREFER $200.00 on High-rate card.',
  });
  const repeat = TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: sameAgain,
    priorTurns: [prior, sameAgain],
    debts,
    packet,
  });
  ok(repeat.status === 'resolved-preference'
      && repeat.scenarios[0].debtId === 'high'
      && repeat.scenarios[1].debtId === 'low',
    'repeating the same earned A-vs-B still binds those exact two options');
}

console.log('\n=== 3. Gemini cannot pick the winner ===');
{
  ok(/bare Which one\?/.test(TalkGemini.INSTRUCTION)
      && /referentKey":"last-presented"/.test(TalkGemini.INSTRUCTION)
      && /History may resolve the referent only/.test(TalkGemini.INSTRUCTION)
      && /Gemini does not choose or change the winner/.test(TalkGemini.INSTRUCTION)
      && /already-named options to prefer/.test(TalkGemini.INSTRUCTION)
      && /Do not return a winner/.test(TalkGemini.INSTRUCTION),
    'Gemini instruction may resolve the Which one? referent only');

  const referent = TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    referentKey: 'last-presented',
  });
  ok(referent.ok === true && referent.referentKey === 'last-presented' && !referent.scenarios,
    'Gemini may extract last-presented comparison referent only');
  ok(TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    referentKey: 'last-presented',
    winner: 'Low-rate card',
  }).ok === false,
    'a model winner field on a Which one? extract fails closed');
  ok(TalkHypothetical.parseComparisonExtract({
    intent: 'hypothetical-extra-payment-comparison',
    referentKey: 'last-presented',
    preference: 'Low-rate card',
  }).ok === false,
    'a model preference field on a Which one? extract fails closed');
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    intent: 'hypothetical-extra-payment-comparison',
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'Low-rate card' },
    ],
    winner: 'Low-rate card',
  })).ok === false,
    'a model winner on an explicit comparison extract still fails closed');

  const { plan, debts } = fixture();
  const packet = packetFor(debts);
  const prior = avbTurn();
  const invented = TalkHypothetical.evaluateComparisonResolved({
    scenarios: [
      { amount: 200, debtId: 'low', debtLabel: 'Low-rate card' },
      { amount: 200, debtId: 'high', debtLabel: 'High-rate card' },
    ],
    plan,
    debts,
    packet,
  });
  invented.ranking = 'low';
  invented.recommendation = 'Low-rate card';
  invented.winner = 'low';
  const follow = TalkSession.resolveFollowup({
    question: 'Which one?',
    priorTurn: prior,
    priorTurns: [prior],
    debts,
    packet,
  });
  const live = TalkHypothetical.evaluateComparisonResolved({
    scenarios: follow.scenarios,
    plan,
    debts,
    packet,
  });
  ok(TalkHypothetical.judgeComparisonPreference(invented).preferred.debtId === 'high'
      && TalkHypothetical.judgeComparisonPreference(live).preferred.debtId === 'high',
    'Gemini or caller cannot pick or change the winner on the comparison object');
}

console.log('\n=== 4. Existing prefer-grammar still works ===');
{
  const { debts } = fixture();
  const packet = packetFor(debts);
  const prior = avbTurn();
  const prefer = TalkSession.resolveFollowup({
    question: 'Which of those should I prefer?',
    priorTurn: prior,
    debts,
    packet,
  });
  ok(prefer.status === 'resolved-preference'
      && prefer.scenarios.length === 2
      && prefer.scenarios[0].debtId === 'high'
      && prefer.scenarios[1].debtId === 'low',
    'Which of those should I prefer? still reuses the last explicit comparison pairs');
  ok(TalkHypothetical.questionAsksAuthorizedPreference(
    'Which should I prefer, $200 on the High-rate card versus $200 on the Low-rate card?'
  ) === true
      && TalkHypothetical.questionIsPlannerActComparison(
        'Which should I prefer, $200 on the High-rate card versus $200 on the Low-rate card?'
      ) === false,
    'explicit A-vs-B preference ask is still authorized prefer-grammar');
}

console.log('\n=== 5. Leftover / payday-picture / remaining-bills / follow-up refs stay intact ===');
{
  const { debts } = fixture();
  const packet = packetFor(debts);
  ok(TalkSession.classifyVerifiedFollowup('What does this payday leave us with?') === 'payday-leftover'
      && TalkSession.classifyVerifiedFollowup('What does that leave us with?') === 'payday-leftover-deixis'
      && TalkSession.classifyVerifiedFollowup('What does this payday look like?') === 'payday-picture'
      && TalkSession.classifyVerifiedFollowup('What bills are coming before next payday?') === 'payday-remaining-bills'
      && TalkSession.classifyVerifiedFollowup('What about that one?') === 'last-presented-one'
      && TalkSession.classifyVerifiedFollowup('Which one?') == null,
    'Which one? does not steal leftover, picture, bills, or that-one grammar');
  ok(TalkSession.resolveFollowup({
    question: 'What does this payday leave us with?',
    priorTurn: leftoverTurn(),
    debts,
    packet,
  }).referentKey === 'payday-leftover'
      && TalkSession.resolveFollowup({
        question: 'What does this payday look like?',
        priorTurn: leftoverTurn(),
        debts,
        packet,
      }).referentKey === 'payday-picture'
      && TalkSession.resolveFollowup({
        question: 'What does that leave us with?',
        priorTurn: leftoverTurn(),
        debts,
        packet,
      }).referentKey === 'payday-leftover',
    'leftover and picture exact asks are unchanged');
  ok(TalkSession.resolveFollowup({
    question: 'What about that one?',
    priorTurn: remainingTurn(),
    debts,
    packet,
  }).status === 'resolved-reference'
      && TalkSession.resolveFollowup({
        question: 'What about that one?',
        priorTurn: remainingTurn(),
        debts,
        packet,
      }).referentKey === TalkSession.REMAINING_BILLS_INTENT,
    'what about that one? still binds the earned unique remaining-bill ref');
}

console.log('\n=== 6. Server recomputes Forecast; docs record the referent ===');
{
  const serverSrc = read('server.js');
  const sessionSrc = read('scripts/talk-session.js');
  const hypoSrc = read('scripts/talk-hypothetical.js');
  ok(/priorTurns/.test(serverSrc)
      && /resolved-preference/.test(serverSrc)
      && /judgeComparisonPreference/.test(serverSrc),
    'server passes session turns into resolveFollowup and still judges preference on Forecast');
  ok(/questionAsksWhichOneReferent/.test(sessionSrc)
      && /resolved-preference/.test(sessionSrc)
      && /currentDebtStillLive/.test(sessionSrc),
    'talk-session resolves Which one? against live current debts');
  ok(/questionAsksWhichOneReferent/.test(hypoSrc)
      && /AUTHORIZED_PREFERENCE_ASK_RES/.test(hypoSrc)
      && !/which\\s\+one/.test(hypoSrc.split('AUTHORIZED_PREFERENCE_ASK_RES')[1].split('function questionAsksAuthorizedPreference')[0]),
    'prefer-grammar is not broadened to include bare Which one?');
  ok(hashFile(DATA) === liveHash, 'data.json bytes unchanged');
}

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nAll Which one? preference checks passed.');
