'use strict';
/* Talk planning-horizon baseline trajectory reprints planning.trajectory.
 *
 * Independent proof: each Talk month figure equals the assistant packet
 * planning.trajectory row for the same fixture, reconciled against
 * Forecast.baselineTrajectory for the live plan. Talk does not import
 * Forecast or call baselineTrajectory. Gemini extracts intent only.
 * Payday / leftover phrasing fails closed. operatingPlan unavailable
 * does not withhold trajectory when the packet published it.
 * `node test/test-talk-baseline-trajectory.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Assistant = require('../scripts/assistant-packet.js');
const TalkGemini = require('../scripts/talk-gemini.js');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkSession = require('../scripts/talk-session.js');
const Forecast = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

const liveHash = hashFile(DATA);
const forecastHash = hashFile(path.join(ROOT, 'public/forecast.js'));
const packetHash = hashFile(path.join(ROOT, 'scripts/assistant-packet.js'));

function filesUnchanged(label) {
  ok(hashFile(DATA) === liveHash, `${label}: data.json bytes unchanged`);
  ok(hashFile(path.join(ROOT, 'public/forecast.js')) === forecastHash,
    `${label}: public/forecast.js bytes unchanged`);
  ok(hashFile(path.join(ROOT, 'scripts/assistant-packet.js')) === packetHash,
    `${label}: assistant-packet.js bytes unchanged`);
}

console.log('=== 1. Authority: packet planning.trajectory only; no Forecast in Talk ===');
{
  const sessionSrc = read('scripts/talk-session.js');
  const presentationSrc = read('scripts/talk-presentation.js');
  const geminiSrc = TalkGemini.INSTRUCTION;
  const serverSrc = read('server.js');
  ok(!/require\([^)]*forecast/i.test(sessionSrc + presentationSrc + geminiSrc),
    'Talk trajectory modules do not import Forecast');
  ok(!/Forecast\.baselineTrajectory\s*\(/.test(sessionSrc + presentationSrc + geminiSrc + serverSrc),
    'Talk does not call Forecast.baselineTrajectory');
  ok(/planning\.trajectory/.test(presentationSrc),
    'Talk presentation reads planning.trajectory from the packet');
  ok(/intent":"planning-horizon-trajectory/.test(geminiSrc)
      && /planning-horizon-trajectory intent only/.test(geminiSrc),
    'Gemini contract is planning-horizon-trajectory intent only');
  ok(/PLANNING_HORIZON_TRAJECTORY_INTENT/.test(serverSrc)
      && /presentPlanningHorizonTrajectory/.test(serverSrc),
    'server /talk/ask presents trajectory without Gemini when grammar matches');
  ok(!/decisionPosture/.test(
    presentationSrc.split('function presentPlanningHorizonTrajectory')[1]
      .split('function presentPaydayRemainingBills')[0]
  ),
    'trajectory presentation does not cite decisionPosture');
}

const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const periods = Assistant.loadPeriods();
const packet = Assistant.buildPacket({
  data: liveData,
  periods,
  now: '2026-09-15T12:00:00.000Z',
  env: {},
});
const traj = Forecast.baselineTrajectory(liveData.plan, liveData.debts, liveData.meta.asOf, {
  periods,
  extraFacilities: liveData.revolvingExtra,
});

console.log('\n=== 2. Packet trajectory matches independent Forecast ===');
{
  const projected = packet.planning && packet.planning.trajectory;
  ok(projected && projected.status === 'ready', 'live packet trajectory is ready');
  ok(projected.months.length === traj.months.length, 'packet publishes every horizon month');
  for (const month of traj.months) {
    const row = projected.months.find(m => m.month === month.month);
    ok(row, `packet has ${month.month}`);
    if (month.income.amount != null) {
      ok(near(row.income.amount, month.income.amount),
        `${month.month} packet income matches Forecast`, `${row.income.amount} vs ${month.income.amount}`);
    }
    if (month.cash.amount != null) {
      ok(near(row.cash.amount, month.cash.amount),
        `${month.month} packet cash matches Forecast`);
    }
  }
}

console.log('\n=== 3. Talk reprints every packet month with Planning parity ===');
{
  const presented = TalkPresentation.presentPlanningHorizonTrajectory(packet);
  ok(presented.trust === 'calculated', 'live trajectory presentation is available');
  ok(presented.source === 'Planning' && presented.action && presented.action.href === '/planning.html',
    'trajectory cites Planning surface');
  ok(/Forecast baseline cash and debt by calendar month/.test(presented.answer),
    'answer includes horizon lede');
  ok(/Planned weekly variable:/.test(presented.answer),
    'answer includes planned weekly variable when packet publishes it');
  ok(/does not walk cash or debt itself/.test(presented.answer),
    'answer includes Planning parity footnote');
  for (const month of packet.planning.trajectory.months) {
    ok(presented.answer.indexOf(month.month) !== -1,
      `answer names month ${month.month}`);
    if (month.income && month.income.status !== 'unavailable' && month.income.amount != null) {
      const money = TalkPresentation.formatCurrency(month.income.amount);
      ok(presented.answer.indexOf(money) !== -1,
        `${month.month} income amount is in the answer`, money);
    }
    if (month.cash && month.cash.status !== 'unavailable' && month.cash.amount != null) {
      const money = TalkPresentation.formatCurrency(month.cash.amount);
      ok(presented.answer.indexOf(money) !== -1,
        `${month.month} cash amount is in the answer`, money);
    }
  }
  ok((presented.cards && presented.cards.items.length) >= packet.planning.trajectory.months.length,
    'cards include a row per horizon month');
}

console.log('\n=== 4. Allowlisted grammar and payday/leftover collisions fail closed ===');
{
  const intentOnly = TalkSession.parsePlanningHorizonTrajectoryExtract({
    intent: TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
  });
  const q = 'What does our monthly cash and debt look like over the planning horizon?';
  const follow = TalkSession.resolveFollowup({
    question: q,
    priorTurn: null,
    debts: liveData.debts,
    packet,
  });
  ok(follow.status === 'resolved-reference'
      && follow.referentKey === TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
    'authorized planning-horizon question resolves locally');

  ok(TalkSession.resolveFollowup({
    question: 'Show me the baseline cash and debt trajectory',
    priorTurn: null,
    debts: liveData.debts,
    packet,
  }).referentKey === TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
    'show baseline trajectory grammar is authorized');

  ok(TalkSession.resolveFollowup({
    question: 'What is our financial trajectory by month?',
    priorTurn: null,
    debts: liveData.debts,
    packet,
  }).referentKey === TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
    'financial trajectory by month grammar is authorized');

  ok(TalkSession.questionCollidesWithPaydayLeftoverGrammar(
    'What does this payday leave us with?'),
    'leftover grammar is a collision');
  ok(TalkSession.resolvePlanningHorizonTrajectory({
    question: 'What does this payday leave us with?',
    extract: intentOnly,
  }).status === 'ambiguous',
    'payday leftover blocks trajectory even when Gemini returns intent');

  ok(TalkSession.resolvePlanningHorizonTrajectory({
    question: 'What does our monthly cash and debt look like over the planning horizon?',
    extract: intentOnly,
  }).status === 'resolved-reference',
    'clean planning-horizon question with intent resolves');

  ok(TalkSession.resolveFollowup({
    question: 'How does our monthly cash look over the planning horizon?',
    priorTurn: null,
    debts: liveData.debts,
    packet,
  }).status === 'none',
    'near-miss grammar stays unavailable');
}

console.log('\n=== 5. Gemini extract is intent-only; invented figures fail closed ===');
{
  const invented = TalkSession.parsePlanningHorizonTrajectoryExtract({
    intent: TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
    months: [],
  });
  ok(invented.ok === false && invented.reason === 'invented trajectory',
    'Gemini cannot return months');

  const intentOnly = TalkSession.parsePlanningHorizonTrajectoryExtract({
    intent: TalkSession.PLANNING_HORIZON_TRAJECTORY_INTENT,
  });
  ok(intentOnly.ok === true, 'intent-only extract passes');

  const resolved = TalkSession.resolvePlanningHorizonTrajectory({
    question: 'Show me the baseline cash and debt trajectory',
    extract: intentOnly,
  });
  const presented = TalkPresentation.presentPlanningHorizonTrajectory(packet);
  ok(resolved.status === 'resolved-reference'
      && presented.trust === 'calculated',
    'Gemini intent path still reads packet trajectory only');
}

console.log('\n=== 6. operatingPlan withheld on forecast does not withhold trajectory ===');
{
  const stalePacket = JSON.parse(JSON.stringify(packet));
  stalePacket.forecast = {
    status: 'unavailable',
    reason: 'Current plan unavailable while the dated opening is stale.',
    recommendation: { status: 'unavailable' },
    currentPeriodAction: { status: 'unavailable' },
    paydayAllocation: { status: 'unavailable' },
  };
  ok(stalePacket.planning.trajectory.status === 'ready',
    'stale forecast packet still carries ready planning.trajectory');
  const presented = TalkPresentation.presentPlanningHorizonTrajectory(stalePacket);
  ok(presented.trust === 'calculated'
      && /Forecast baseline cash and debt/.test(presented.answer),
    'Talk still reprints trajectory when only forecast is unavailable');
}

filesUnchanged('Talk baseline trajectory');
ok(hashFile(DATA) === liveHash, 'suite end data.json unchanged');
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
