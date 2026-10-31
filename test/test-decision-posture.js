'use strict';
/* Owner-authorized household decision posture — Talk Slice 5.
 *
 * Proves plan.decisionPosture is a first-class owner-stated policy row
 * beside plan.nextDollar, that it invents no numeric threshold, that
 * Forecast does not apply it in this slice, and that the assistant
 * packet projects the closed labels without changing other financial
 * facts or adding a write/planner path.
 * `node test/test-decision-posture.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Assistant = require('../scripts/assistant-packet.js');
const Forecast = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const QUESTIONS = path.join(ROOT, 'docs', '01_OPEN_QUESTIONS.md');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const clone = value => JSON.parse(JSON.stringify(value));
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const liveHash = crypto.createHash('sha256').update(fs.readFileSync(DATA)).digest('hex');
const posture = liveData.plan && liveData.plan.decisionPosture;

const CLOSED = {
  posture: 'aggressive-not-brittle',
  velocity: 'fastest-to-goal',
  resilience: 'enough-cash-flexibility-for-real-life-and-known-commitments',
  breathingRoom: 'sustainable-slack-not-waste-permission',
  knownCommitments: 'exert-gravity',
  cheapestWhenBrittle: 'not-best-household-decision',
  numericThreshold: 'none',
  forecastApplication: 'not-applied-this-slice',
  provenance: 'owner-stated',
  provenanceDate: '2026-09-14',
};

function walkTypes(value, acc) {
  if (value == null) return acc;
  if (typeof value === 'number') {
    acc.numbers.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    value.forEach(item => walkTypes(item, acc));
    return acc;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      acc.keys.push(key);
      walkTypes(child, acc);
    }
  }
  return acc;
}

function planningSlice(data) {
  const asOf = (data.plan && data.plan.opening && data.plan.opening.asOf)
    || (data.meta && data.meta.asOf);
  const advice = Forecast.recommend(data.plan, asOf, {
    fundingSources: data.plan.funding && data.plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
  });
  const priority = Forecast.debtPriority(data.plan, data.debts);
  return {
    weekly: advice && advice.weekly,
    mode: advice && advice.mode,
    infeasible: advice && advice.infeasible,
    target: priority && priority.target && priority.target.id,
    nextTarget: priority && priority.nextTarget && priority.nextTarget.id,
    extraDebt: advice && advice.paydayAllocation && advice.paydayAllocation.extraDebt,
  };
}

function packetFacts(packet) {
  return {
    schema: packet.schema,
    writesCanonicalState: packet.writesCanonicalState,
    productionWrite: packet.productionWrite,
    unattended: packet.unattended,
    authority: packet.authority,
    current: packet.current,
    forecast: packet.forecast,
    actuals: packet.actuals,
    uncertainty: packet.uncertainty,
  };
}

function buildLivePacket(data) {
  return Assistant.buildPacket({
    data,
    periods: Assistant.loadPeriods(),
    questionsMarkdown: fs.readFileSync(QUESTIONS, 'utf8'),
    now: '2026-09-14T18:00:00.000Z',
    env: { ATLAS_GIT_SHA: 'ee8f89005a41b96a856d89140ff13d682a4cc72e' },
  });
}

console.log('=== 1. Semantic fidelity of the owner policy row ===');
ok(!!posture && typeof posture === 'object' && !Array.isArray(posture),
  'plan.decisionPosture exists beside plan.nextDollar');
ok(liveData.plan.nextDollar && liveData.plan.nextDollar.policy === 'true-surplus-highest-interest',
  'incumbent nextDollar policy is unchanged');
for (const [key, allowed] of Object.entries(CLOSED)) {
  ok(posture[key] === allowed, `decisionPosture.${key} is the closed owner label`,
    posture[key]);
}
ok(posture.velocity !== posture.resilience,
  'velocity and resilience are distinct dimensions');
ok(/aggressive/i.test(posture.posture) && /not-brittle/.test(posture.posture),
  'posture is aggressive and not brittle');
ok(posture.knownCommitments === 'exert-gravity',
  'known future commitments exert gravity');
ok(/records policy only/i.test(posture.note)
    && /Forecast does not apply this row in this slice/i.test(posture.note),
  'the note records policy only and withholds Forecast application this slice');
ok(/distinct dimensions/i.test(posture.provenanceNote)
    && /unacceptably brittle/i.test(posture.provenanceNote)
    && /No universal numeric breathing-room threshold/i.test(posture.provenanceNote)
    && /Known authorized future commitments exert gravity/i.test(posture.provenanceNote)
    && /not waste permission/i.test(posture.provenanceNote),
  'provenanceNote restates the owner intent without a second policy home');

console.log('\n=== 2. No numeric threshold is introduced ===');
{
  const walked = walkTypes(posture, { numbers: [], keys: [] });
  ok(walked.numbers.length === 0,
    'decisionPosture stores no numeric values',
    JSON.stringify(walked.numbers));
  const blob = JSON.stringify(posture);
  ok(!/\$/.test(blob) && !/%/.test(blob) && !/\b500\b/.test(blob),
    'decisionPosture text has no currency, percent, or targetBuffer figure');
  ok(!walked.keys.some(key =>
    /targetBuffer|safeToSpend|minChequing|emergencyReserve|minLeftover|debtPaymentCeiling/i.test(key)),
    'decisionPosture does not add buffer, leftover, or payment-ceiling keys');
  ok(posture.numericThreshold === 'none',
    'the closed numeric-threshold label is none');
  ok(liveData.plan.defaults && liveData.plan.defaults.targetBuffer === 500,
    'defaults.targetBuffer remains the incumbent Forecast input and is not this row');
}

console.log('\n=== 3. Owner provenance is present ===');
ok(posture.provenance === 'owner-stated',
  'provenance is owner-stated, not Forecast or calculated');
ok(posture.provenanceDate === '2026-09-14',
  'provenanceDate is the owner-authorization date in America/Vancouver');
ok(/Owner-authorized Atlas Coordinator Talk Slice 5/i.test(posture.provenanceNote)
    && /America\/Vancouver/.test(posture.provenanceNote),
  'provenanceNote names the owner authorization');

console.log('\n=== 4. Forecast remains the sole planner and does not apply this row ===');
{
  const forecastSrc = read('public/forecast.js');
  ok(!/decisionPosture/.test(forecastSrc),
    'public/forecast.js does not read plan.decisionPosture');
  const withRow = planningSlice(liveData);
  const stripped = clone(liveData);
  delete stripped.plan.decisionPosture;
  const withoutRow = planningSlice(stripped);
  ok(JSON.stringify(withRow) === JSON.stringify(withoutRow),
    'recommend / debtPriority / extra-debt answers are identical with the row removed');
  ok(withRow.target != null || withRow.mode != null,
    'Forecast still produces a planning slice from incumbent nextDollar and facts');
}

console.log('\n=== 8–10. Packet adds the policy projection only; no write; no second planner ===');
{
  const packet = buildLivePacket(liveData);
  const stripped = clone(liveData);
  delete stripped.plan.decisionPosture;
  const without = buildLivePacket(stripped);
  const projected = packet.policy && packet.policy.decisionPosture;
  ok(projected && projected.status === 'ok'
      && projected.source === 'data.json plan.decisionPosture',
    'packet projects decisionPosture from data.json');
  for (const [key, allowed] of Object.entries(CLOSED)) {
    ok(projected[key] === allowed, `packet policy.decisionPosture.${key} matches the owner row`,
      projected[key]);
  }
  ok(JSON.stringify(packetFacts(packet)) === JSON.stringify(packetFacts(without)),
    'current / forecast / actuals / uncertainty / authority are unchanged aside from the policy block');
  ok(without.policy.decisionPosture.status === 'unavailable',
    'a missing row projects unavailable rather than inventing labels');
  const stuffed = clone(liveData);
  stuffed.plan.decisionPosture.minCash = 2000;
  stuffed.plan.decisionPosture.safeToSpend = 847;
  stuffed.plan.decisionPosture.extraDebtPercent = 40;
  const stuffedPacket = buildLivePacket(stuffed);
  const stuffedRow = stuffedPacket.policy.decisionPosture;
  const stuffedBlob = JSON.stringify(stuffedRow);
  ok(!Object.prototype.hasOwnProperty.call(stuffedRow, 'minCash')
      && !Object.prototype.hasOwnProperty.call(stuffedRow, 'safeToSpend')
      && !Object.prototype.hasOwnProperty.call(stuffedRow, 'extraDebtPercent')
      && !/2000|847/.test(stuffedBlob),
    'packet projection drops invented numeric policy keys');
  ok(packet.writesCanonicalState === false
      && packet.productionWrite === false
      && packet.unattended === false,
    'packet still declares no write path');
  ok(packet.authority.planner === 'Forecast'
      && /not a second planner/.test(packet.authority.note),
    'Forecast remains the declared planner');
  const packetSrc = read('scripts/assistant-packet.js');
  ok(!/writeFileSync|writeFile\(/.test(packetSrc),
    'assistant-packet.js still does not write files');
}

console.log('\n=== architecture names the new policy owner ===');
{
  const architecture = read('ARCHITECTURE.md');
  ok(/plan\.decisionPosture/.test(architecture)
      && /Forecast does not apply this row in this slice/.test(architecture),
    'ARCHITECTURE.md names plan.decisionPosture and withholds Forecast application this slice');
}

ok(crypto.createHash('sha256').update(fs.readFileSync(DATA)).digest('hex') === liveHash,
  'this suite does not rewrite data.json');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
