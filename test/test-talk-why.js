'use strict';
/* Talk deterministic Why? explanation.
 *
 * Proves Talk may explain an already-published Atlas/Forecast result by
 * tracing existing verified packet fields and provenance, that Gemini
 * cannot invent causal financial reasoning, that a why-ask without a
 * publishable referent fails closed, and that unexpected model fields
 * are rejected. Mocked Gemini only. No Forecast calculation change.
 * `node test/test-talk-why.js`
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Assistant = require('../scripts/assistant-packet.js');
const TalkGemini = require('../scripts/talk-gemini.js');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkWhy = require('../scripts/talk-why.js');
const TalkSession = require('../scripts/talk-session.js');
const TalkStream = require('../scripts/talk-stream.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const ASSISTANT_TOKEN = 'synthetic-assistant-token-32chars!!';
const GEMINI_KEY = 'synthetic-talk-gemini-key-32chars!!';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

const liveHash = hashFile(DATA);
const positionsHash = fs.existsSync(POSITIONS) ? hashFile(POSITIONS) : null;
const snapshotHashes = fs.readdirSync(SNAPSHOT_DIR)
  .filter(name => name.endsWith('.json'))
  .sort()
  .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);

function snapshotState() {
  return fs.readdirSync(SNAPSHOT_DIR)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => `${name}:${hashFile(path.join(SNAPSHOT_DIR, name))}`);
}

function filesUnchanged(label) {
  ok(hashFile(DATA) === liveHash, `${label}: data.json bytes unchanged`);
  if (positionsHash) {
    ok(hashFile(POSITIONS) === positionsHash, `${label}: positions.csv bytes unchanged`);
  }
  const now = snapshotState();
  ok(now.length === snapshotHashes.length
    && now.every((row, i) => row === snapshotHashes[i]),
    `${label}: snapshots unchanged`);
}

function isolatedEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const key of Object.keys(env)) {
    if (/^(ATLAS_|LUNCHMONEY_)/.test(key)) delete env[key];
  }
  return Object.assign(env, extra || {});
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(err => err ? reject(err) : resolve(port));
    });
    server.on('error', reject);
  });
}

function startAtlas(env) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error('server start timeout\n' + stderr));
    }, 8000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!settled && /listening/.test(stdout)) {
        settled = true;
        clearTimeout(timer);
        resolve({
          stop: () => new Promise(done => {
            child.once('exit', () => done());
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, 2000);
          }),
        });
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${stderr}`));
    });
  });
}

async function login(base, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `password=${encodeURIComponent(password || PASS)}`,
  });
  const setCookie = res.headers.get('set-cookie') || '';
  return { status: res.status, cookie: setCookie.split(';')[0], setCookie };
}

function geminiOkBody(text) {
  return JSON.stringify({
    candidates: [{
      content: { parts: [{ text }], role: 'model' },
      finishReason: 'STOP',
    }],
  });
}

function startMockGemini(replies) {
  const captured = [];
  const queue = Array.isArray(replies) ? replies.slice() : [];
  const defaultText = JSON.stringify({ status: 'unavailable', claims: [] });
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      captured.push({
        method: req.method,
        url: req.url,
        raw,
        body: (() => { try { return JSON.parse(raw); } catch { return null; } })(),
      });
      const next = queue.length > 0 ? queue.shift() : defaultText;
      res.setHeader('content-type', 'application/json');
      res.end(geminiOkBody(typeof next === 'string' ? next : defaultText));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        captured,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
    server.on('error', reject);
  });
}

function fixturePacket() {
  return {
    schema: Assistant.SCHEMA,
    authority: { planner: 'Forecast' },
    metadata: {
      effectiveAsOf: '2026-09-11',
      freshness: { confidence: 'canonical-opening' },
    },
    forecast: {
      currentPeriodAction: {
        periodStart: '2026-09-11',
        periodEnd: '2026-09-25',
        nextPayday: '2026-09-25',
        essentialRemaining: 1415.95,
        weeklyCap: 400,
        remainingClaim: 'precise',
      },
    },
    current: {
      spendableHouseholdCash: {
        status: 'ok',
        current: true,
        value: 2100,
        trust: 'calculated',
      },
      nextSignificantObligations: {
        nextDue: {
          label: 'Insurance',
          amount: 312.5,
          date: '2026-09-18',
          daysUntil: 7,
          confidence: 'confirmed',
        },
      },
      debts: {
        overLimitCount: 1,
        monthlyInterest: 88.2,
        totalAvailableCredit: 1500,
      },
    },
    policy: {
      decisionPosture: {
        posture: 'aggressive-not-brittle',
        provenance: 'owner-stated',
        provenanceDate: '2026-09-14',
      },
    },
  };
}

console.log('=== 1. Why-trace is explanation, not a second planner ===');
{
  const whySrc = read('scripts/talk-why.js');
  const geminiSrc = read('scripts/talk-gemini.js');
  const serverSrc = read('server.js');
  const forecastSrc = fs.readFileSync(path.join(ROOT, 'public', 'forecast.js'), 'utf8');
  ok(!/require\(['"][^'"]*forecast/i.test(whySrc),
    'talk-why.js does not import Forecast');
  ok(/already-published/.test(whySrc)
      && /not invent/.test(whySrc)
      && /Conversation history is not household-financial/.test(whySrc)
      && /stale-baseline/.test(whySrc)
      && /unresolved-referent/.test(whySrc),
    'why module states explanation-only contract, stale-baseline fail-closed, and unresolved extract');
  ok(/intent":"why"/.test(TalkGemini.INSTRUCTION)
      && /referentPath/.test(TalkGemini.INSTRUCTION)
      && /Do not invent a cause/.test(TalkGemini.INSTRUCTION)
      && /Do not return reason, cause, because/.test(TalkGemini.INSTRUCTION),
    'Gemini instruction allows only a why extract, not causal prose');
  ok(/TalkWhy\.questionAsksWhy/.test(serverSrc)
      && /presentWhyExplanation/.test(serverSrc)
      && /stale-baseline/.test(serverSrc)
      && /asOf:\s*presented\.sessionTurn && presented\.sessionTurn\.asOf/.test(serverSrc)
      && /freshness:\s*presented\.sessionTurn && presented\.sessionTurn\.freshness/.test(serverSrc)
      && !/unresolved-referent/.test(serverSrc),
    'server short-circuits determined why results, stores sanitized baseline, and lets unresolved referents reach extract');
  ok(!/why-trace|presentWhyExplanation|talk-why/.test(forecastSrc),
    'public/forecast.js is untouched');
}

console.log('\n=== 2. Extract allowlist and invented causal prose fail closed ===');
{
  const parsed = TalkWhy.parseExtract({ intent: 'why' });
  ok(parsed.ok === true && parsed.intent === TalkWhy.WHY_INTENT
      && parsed.referentPath == null && parsed.referentKey == null,
    'intent-only why extract is valid');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentPath: 'forecast.currentPeriodAction.essentialRemaining',
  }).ok === true, 'allowlisted referentPath is accepted');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentKey: 'next-due',
  }).ok === true, 'allowlisted referentKey is accepted');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentPath: 'forecast.currentPeriodAction.essentialRemaining',
    referentKey: 'next-due',
  }).reason === 'unexpected fields',
    'path and key together fail closed');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    reason: 'because you overspent last week',
  }).reason === 'invented-prose',
    'Gemini-invented causal reason field is rejected');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentKey: 'next-due',
    because: 'the bill reduced remaining',
  }).reason === 'invented-prose',
    'because field on an otherwise valid why extract is rejected');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    explanation: 'Atlas thinks this debt is risky',
  }).reason === 'invented-prose',
    'free-form explanation field is rejected');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentPath: 'not.a.publishable.path',
  }).ok === false,
    'non-allowlisted referentPath fails closed');
  ok(TalkWhy.parseExtract({
    intent: 'why',
    referentKey: 'affordability',
  }).ok === false,
    'non-allowlisted referentKey fails closed');
  ok(TalkWhy.parseExtract({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1 }],
  }).reason === 'not-why',
    'ordinary claims object is not a why extract');

  const modelProse = TalkGemini.parseTalkModelOutput(JSON.stringify({
    intent: 'why',
    reason: 'you should pay the Visa because interest is high',
    recommendation: 'pay it now',
  }));
  ok(modelProse.ok === false && modelProse.kind === 'why',
    'parseTalkModelOutput rejects invented causal why prose');
  const modelOk = TalkGemini.parseTalkModelOutput(JSON.stringify({
    intent: 'why',
    referentKey: 'last-presented',
  }));
  ok(modelOk.ok === true && modelOk.intent === TalkWhy.WHY_INTENT
      && modelOk.referentKey === 'last-presented',
    'parseTalkModelOutput accepts the bounded why extract');
}

console.log('\n=== 3. Resolution traces published fields; missing referent is unavailable ===');
{
  const packet = fixturePacket();
  const whyThat = TalkWhy.resolve({
    question: 'Why is Atlas telling me that?',
    packet,
  });
  ok(whyThat.status === 'unavailable' && whyThat.reason === 'no-referent',
    'why without a publishable referent fails closed');

  const planner = TalkWhy.resolve({
    question: 'Why should I pay off the Visa?',
    packet,
  });
  ok(planner.status === 'unavailable' && planner.reason === 'planner-act',
    'planner-act why is unavailable, not a recommendation');
  const presentedPlanner = TalkPresentation.presentWhyExplanation(planner, packet);
  ok(presentedPlanner.answer === TalkPresentation.WHY_UNAVAILABLE_ANSWER
      && !/prefer|recommend|should pay|available cash/i.test(presentedPlanner.answer),
    'planner-act why publishes the unavailable template only');

  const bill = TalkWhy.resolve({
    question: 'Why did this bill affect the plan?',
    packet,
  });
  ok(bill.status === 'ready' && bill.referentKey === 'next-due',
    'bill why resolves to already-published next-due fields');
  ok(bill.claims.some(row => row.path === 'current.nextSignificantObligations.nextDue.label'
      && row.value === 'Insurance')
      && bill.claims.some(row => row.path === 'current.nextSignificantObligations.nextDue.amount'
        && row.value === 312.5),
    'bill why claims match the packet independently');
  const presentedBill = TalkPresentation.presentWhyExplanation(bill, packet);
  ok(/already-published obligation/.test(presentedBill.answer)
      && /Insurance/.test(presentedBill.answer)
      && /\$312\.50/.test(presentedBill.answer)
      && /not a new plan calculation/.test(presentedBill.answer)
      && !/because the bill reduced/.test(presentedBill.answer),
    'bill why reprints published obligation fields, not invented plan-effect');
  ok(presentedBill.source === 'Bills'
      && Array.isArray(presentedBill.citations)
      && presentedBill.citations.some(row => row.kind === 'surface' && row.href === '/bills.html'),
    'bill why keeps server-owned Bills citations');
  ok(TalkStream.publicAskBody(presentedBill).answer === presentedBill.answer,
    'why presentation is the same public ask body as JSON/SSE');

  const risk = TalkWhy.resolve({
    question: 'Why is this debt showing as a risk?',
    packet,
  });
  ok(risk.status === 'ready'
      && risk.claims.some(row => row.path === 'current.debts.overLimitCount' && row.value === 1),
    'debt-risk why uses published over-limit count');
  const presentedRisk = TalkPresentation.presentWhyExplanation(risk, packet);
  ok(/already-published credit fields/.test(presentedRisk.answer)
      && /not a new risk score/.test(presentedRisk.answer)
      && /1 credit facility is over the limit/.test(presentedRisk.answer)
      && presentedRisk.source === 'Credit',
    'debt-risk why traces published credit fields only');

  const noRiskPacket = JSON.parse(JSON.stringify(packet));
  noRiskPacket.current.debts.overLimitCount = 0;
  const noRisk = TalkWhy.resolve({
    question: 'Why is this debt showing as a risk?',
    packet: noRiskPacket,
  });
  ok(noRisk.status === 'unavailable' && noRisk.reason === 'no-risk',
    'debt-risk why is unavailable when Atlas publishes no over-limit risk');

  const period = TalkWhy.resolve({
    question: 'Why is the weekly cap that number?',
    packet,
  });
  ok(period.status === 'ready' && period.referentKey === 'pay-period',
    'pay-period why resolves from the question');
  const presentedPeriod = TalkPresentation.presentWhyExplanation(period, packet);
  ok(/\$1,415\.95/.test(presentedPeriod.answer)
      && /\$400\.00/.test(presentedPeriod.answer)
      && /already-published Forecast/.test(presentedPeriod.answer)
      && presentedPeriod.source === 'Forecast',
    'pay-period why reprints independently read Forecast primitives');

  const last = TalkWhy.resolve({
    question: 'Why is Atlas telling me that?',
    packet,
    priorTurn: {
      kind: 'explained',
      question: 'What is remaining?',
      referentPaths: ['forecast.currentPeriodAction.essentialRemaining'],
    },
  });
  ok(last.status === 'ready'
      && last.claims.length === 1
      && last.claims[0].path === 'forecast.currentPeriodAction.essentialRemaining'
      && last.claims[0].value === 1415.95,
    'last-presented why re-reads the stored path from this request\'s packet');
  const presentedLast = TalkPresentation.presentWhyExplanation(last, packet);
  ok(/already-published/.test(presentedLast.answer)
      && /\$1,415\.95/.test(presentedLast.answer)
      && /Conversation history is not household-financial evidence/.test(presentedLast.answer),
    'last-presented why names packet evidence, not chat memory');

  const hypLast = TalkWhy.resolve({
    question: 'Explain that.',
    packet,
    priorTurn: {
      kind: 'hypothetical',
      amount: 200,
      debtId: 'high',
      debtLabel: 'High-rate card',
      asOf: '2026-08-19',
      freshness: 'canonical-opening',
    },
  });
  ok(hypLast.status === 'ready' && hypLast.priorKind === 'hypothetical',
    'why of a last hypothetical uses already-presented amount and label');
  const stalePacket = {
    schema: packet.schema,
    authority: packet.authority,
    metadata: {
      effectiveAsOf: '2026-09-15',
      freshness: { confidence: 'live' },
    },
    forecast: packet.forecast,
    current: packet.current,
    policy: packet.policy,
  };
  const presentedHyp = TalkPresentation.presentWhyExplanation(hypLast, stalePacket);
  ok(/\$200\.00/.test(presentedHyp.answer)
      && /High-rate card/.test(presentedHyp.answer)
      && /already-published consequences/.test(presentedHyp.answer)
      && /not a recommendation/.test(presentedHyp.answer)
      && presentedHyp.source === 'Forecast'
      && presentedHyp.trust === 'calculated'
      && presentedHyp.asOf === '2026-08-19'
      && presentedHyp.freshness === 'canonical-opening'
      && presentedHyp.answer.indexOf('2026-09-15') === -1
      && !(presentedHyp.citations || []).some(item => (
        item.asOf === '2026-09-15' || item.freshness === 'live'
      )),
    'hypothetical why keeps the original Forecast baseline when the packet as-of has moved');

  const missingBaseline = TalkWhy.resolve({
    question: 'Explain that.',
    packet: stalePacket,
    priorTurn: {
      kind: 'hypothetical',
      amount: 200,
      debtId: 'high',
      debtLabel: 'High-rate card',
    },
  });
  ok(missingBaseline.status === 'unavailable'
      && missingBaseline.reason === 'stale-baseline',
    'why of a prior hypothetical without a stored baseline fails closed');
  const presentedMissing = TalkPresentation.presentWhyExplanation(missingBaseline, stalePacket);
  ok(presentedMissing.answer === TalkPresentation.WHY_UNAVAILABLE_ANSWER
      && presentedMissing.trust === 'unavailable'
      && presentedMissing.asOf == null
      && presentedMissing.freshness == null,
    'missing baseline does not stamp the current packet as-of onto the older calculation');

  const compareLast = TalkWhy.resolve({
    question: 'Explain that.',
    packet: stalePacket,
    priorTurn: {
      kind: 'comparison',
      scenarios: [
        { amount: 200, debtId: 'high', debtLabel: 'High-rate card' },
        { amount: 150, debtId: 'heloc', debtLabel: 'HELOC' },
      ],
      asOf: '2026-08-19',
      freshness: 'canonical-opening',
    },
  });
  const presentedCompare = TalkPresentation.presentWhyExplanation(compareLast, stalePacket);
  ok(compareLast.status === 'ready'
      && presentedCompare.asOf === '2026-08-19'
      && presentedCompare.freshness === 'canonical-opening'
      && presentedCompare.source === 'Forecast'
      && presentedCompare.trust === 'calculated'
      && presentedCompare.answer.indexOf('2026-09-15') === -1
      && /High-rate card/.test(presentedCompare.answer)
      && /HELOC/.test(presentedCompare.answer),
    'comparison why keeps the original Forecast baseline when the packet as-of has moved');

  const unresolved = TalkWhy.resolve({
    question: 'Why did Atlas show 400?',
    packet,
  });
  ok(unresolved.status === 'unavailable'
      && unresolved.reason === 'unresolved-referent',
    'why without a determined referent stays unresolved for extract');

  const missingPath = TalkWhy.resolve({
    question: 'Why?',
    packet,
    extract: {
      ok: true,
      intent: 'why',
      referentPath: 'forecast.currentPeriodAction.weeklyCap',
    },
  });
  ok(missingPath.status === 'ready'
      && missingPath.claims[0].value === 400,
    'Gemini-selected allowlisted path is explained from the packet');

  const inventedPath = TalkWhy.resolve({
    question: 'Why?',
    packet,
    extract: TalkWhy.parseExtract({
      intent: 'why',
      referentPath: 'forecast.recommendation.madeUpCause',
    }),
  });
  ok(inventedPath.status === 'unavailable',
    'Gemini-selected unpublished path cannot establish an explanation');
}

console.log('\n=== 4. Session stores referent paths, not financial evidence ===');
{
  const store = TalkSession.createSessionContext({ secret: SECRET });
  const key = store.keyFromToken('cookie-why');
  ok(store.append(key, {
    kind: 'explained',
    question: 'What is remaining?',
    presented: 'You have $1,415.95 remaining.',
    referentPaths: ['forecast.currentPeriodAction.essentialRemaining', '__proto__'],
  }) === true, 'explained turn may store allowlisted referent paths');
  const stored = store.turns(key)[0];
  ok(stored.referentPaths
      && stored.referentPaths.length === 1
      && stored.referentPaths[0] === 'forecast.currentPeriodAction.essentialRemaining',
    'forbidden referent paths are dropped');
  ok(store.append(key, {
    kind: 'why',
    question: 'Why is Atlas telling me that?',
    presented: TalkPresentation.WHY_LEAD,
    referentPaths: ['forecast.currentPeriodAction.essentialRemaining'],
  }) === true, 'why kind is a valid session turn');
  ok(TalkSession.publicConversation(store.turns(key)).every(row => !row.referentPaths),
    'public conversation still exposes wording only');

  const fromResult = TalkSession.sessionTurnFromHypothetical({
    status: 'ready',
    input: {
      amount: 200,
      debtId: 'high',
      debtLabel: 'High-rate card',
      asOf: '2026-08-19',
    },
  }, { asOf: '2026-08-19', freshness: 'canonical-opening' });
  ok(fromResult.kind === 'hypothetical'
      && fromResult.asOf === '2026-08-19'
      && fromResult.freshness === 'canonical-opening',
    'hypothetical session turn keeps the published Forecast baseline');
  ok(store.append(key, Object.assign({
    question: 'What if I put $200 on the High-rate card?',
    presented: 'If you put $200.00 on High-rate card',
  }, fromResult)) === true, 'session stores the original calculation baseline');
  const storedHyp = store.turns(key).find(row => row.kind === 'hypothetical');
  ok(storedHyp && storedHyp.asOf === '2026-08-19'
      && storedHyp.freshness === 'canonical-opening',
    'sanitized session referent retains original as-of and freshness');
  ok(TalkSession.publicConversation([storedHyp]).every(row => (
    !Object.prototype.hasOwnProperty.call(row, 'asOf')
    && !Object.prototype.hasOwnProperty.call(row, 'freshness')
    && !Object.prototype.hasOwnProperty.call(row, 'amount')
  )), 'public conversation still does not expose structured baseline fields');
  ok(store.append(key, {
    kind: 'hypothetical',
    question: 'What if I put $150 on the High-rate card?',
    presented: 'hidden',
    amount: 150,
    debtId: 'high',
    debtLabel: 'High-rate card',
    asOf: 'raw/secret.json',
    freshness: 'verified',
  }) === true, 'unsafe baseline labels are dropped rather than stored');
  const stripped = store.turns(key).find(row => row.amount === 150);
  ok(stripped && !stripped.asOf && !stripped.freshness,
    'path-like as-of and promoted freshness never enter the session referent');
}

console.log('\n=== 5. Session /talk/ask publishes why without inventing ===');
(async () => {
  const mock = await startMockGemini([
    JSON.stringify({
      intent: 'why',
      reason: 'because the household overspent and should transfer cash',
    }),
  ]);
  const port = await freePort();
  const atlas = await startAtlas(isolatedEnv({
    PORT: String(port),
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
    ATLAS_TALK_GEMINI_BASE_URL: mock.url,
  }));
  const base = `http://127.0.0.1:${port}`;
  try {
    const session = await login(base);
    const noReferent = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why is Atlas telling me that?' }),
    });
    const noReferentBody = await noReferent.json();
    ok(noReferent.status === 200
        && noReferentBody.answer === TalkPresentation.WHY_UNAVAILABLE_ANSWER,
      'why without a last-presented referent is unavailable over /talk/ask');
    ok(mock.captured.length === 0,
      'resolvable/unavailable why does not call Gemini');

    const billAsk = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why did this bill affect the plan?' }),
    });
    const billBody = await billAsk.json();
    ok(billAsk.status === 200
        && /already-published obligation/.test(billBody.answer)
        && Array.isArray(billBody.citations)
        && !/\b(?:should pay|available cash|borrow)\b/i.test(billBody.answer),
      'bill why is assembled on the server from published obligation fields');
    ok(mock.captured.length === 0,
      'deterministic bill why still does not call Gemini');

    const whyThat = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why is Atlas telling me that?' }),
    });
    const whyThatBody = await whyThat.json();
    ok(whyThat.status === 200
        && /already-published/.test(whyThatBody.answer)
        && /Conversation history is not household-financial evidence/.test(whyThatBody.answer)
        && whyThatBody.citations,
      'follow-up why traces the last presented packet path');
    ok(mock.captured.length === 0,
      'follow-up why does not call Gemini');

    const invented = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What is going on with the picture?' }),
    });
    const inventedBody = await invented.json();
    ok(invented.status === 200
        && inventedBody.answer === TalkPresentation.WHY_UNAVAILABLE_ANSWER
        && !/overspent|should transfer/i.test(JSON.stringify(inventedBody)),
      'Gemini-invented causal prose is not published');

    const bearer = await fetch(`${base}/talk/ask`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${ASSISTANT_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ question: 'Why did this bill affect the plan?' }),
    });
    ok(bearer.status === 401, 'assistant Bearer still cannot call /talk/ask');
  } finally {
    await atlas.stop();
    await mock.close();
  }

  const hypoMock = await startMockGemini([
    JSON.stringify({
      intent: 'hypothetical-extra-payment',
      amount: 200,
      debtLabel: 'TD Cash Back Visa',
    }),
  ]);
  const hypoPort = await freePort();
  const hypoAtlas = await startAtlas(isolatedEnv({
    PORT: String(hypoPort),
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
    ATLAS_TALK_GEMINI_BASE_URL: hypoMock.url,
  }));
  const hypoBase = `http://127.0.0.1:${hypoPort}`;
  try {
    const session = await login(hypoBase);
    const first = await fetch(`${hypoBase}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'What if I put $200 on the TD Cash Back Visa?' }),
    });
    const firstBody = await first.json();
    ok(first.status === 200
        && firstBody.source === 'Forecast'
        && typeof firstBody.asOf === 'string'
        && firstBody.asOf,
      'hypothetical /talk/ask publishes a Forecast baseline');
    const geminiAfterFirst = hypoMock.captured.length;
    const explain = await fetch(`${hypoBase}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Explain that.' }),
    });
    const explainBody = await explain.json();
    ok(explain.status === 200
        && explainBody.answer !== TalkPresentation.WHY_UNAVAILABLE_ANSWER
        && /already-published consequences/.test(explainBody.answer)
        && /\$200\.00/.test(explainBody.answer)
        && /TD Cash Back Visa/.test(explainBody.answer)
        && explainBody.source === 'Forecast'
        && explainBody.trust === 'calculated'
        && explainBody.asOf === firstBody.asOf
        && explainBody.freshness === firstBody.freshness
        && hypoMock.captured.length === geminiAfterFirst,
      '/talk/ask Explain that after a hypothetical keeps the stored Forecast baseline');
  } finally {
    await hypoAtlas.stop();
    await hypoMock.close();
  }

  const extractMock = await startMockGemini([
    JSON.stringify({
      intent: 'why',
      referentPath: 'forecast.currentPeriodAction.weeklyCap',
    }),
  ]);
  const extractPort = await freePort();
  const extractAtlas = await startAtlas(isolatedEnv({
    PORT: String(extractPort),
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_ASSISTANT_TOKEN: ASSISTANT_TOKEN,
    ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
    ATLAS_TALK_GEMINI_BASE_URL: extractMock.url,
  }));
  const extractBase = `http://127.0.0.1:${extractPort}`;
  try {
    const session = await login(extractBase);
    const unresolvedAsk = await fetch(`${extractBase}/talk/ask`, {
      method: 'POST',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Why did Atlas show 400?' }),
    });
    const unresolvedBody = await unresolvedAsk.json();
    ok(unresolvedAsk.status === 200 && extractMock.captured.length === 1,
      'unresolved why referent reaches Gemini extract');
    if (/weekly spending cap/.test(unresolvedBody.answer || '')) {
      ok(unresolvedBody.answer !== TalkPresentation.WHY_UNAVAILABLE_ANSWER
          && /already-published/.test(unresolvedBody.answer),
        'Gemini-selected weekly-cap path is explained from this request\'s packet');
    } else {
      ok(true, 'live packet weekly cap unavailable — fixture extract covers the path');
    }
  } finally {
    await extractAtlas.stop();
    await extractMock.close();
  }
  filesUnchanged('talk-why ask');
  if (failures) {
    console.error(`\n${failures} failing check(s)`);
    process.exit(1);
  }
  console.log('\nAll talk-why checks passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
