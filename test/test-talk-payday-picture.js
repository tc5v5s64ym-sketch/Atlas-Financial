'use strict';
/* Talk payday look-like reprints Forecast.paydayAllocation stages.
 *
 * Independent proof: each Talk money figure equals the corresponding
 * Forecast paydayAllocation field for the same fixture. Talk does not
 * reconstruct a leftover stage by subtracting. History is referential
 * only. Unavailable is not $0. Forecast $0 stays $0. Gemini extracts
 * payday-picture intent only. #309 leftover deixis still binds only
 * after leftover was earned, including from this verified picture.
 * `node test/test-talk-payday-picture.js`
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
const TalkSession = require('../scripts/talk-session.js');
const TalkWhy = require('../scripts/talk-why.js');
const Forecast = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const POSITIONS = path.join(ROOT, 'docs', 'positions.csv');
const SNAPSHOT_DIR = path.join(ROOT, 'snapshots');
const PASS = 'synthetic-site-password';
const SECRET = 'synthetic-session-secret';
const GEMINI_KEY = 'synthetic-talk-gemini-key-32chars!!';
const LEFTOVER_PATH = TalkSession.LEFTOVER_PATH;
const PICTURE_PATHS = TalkSession.PAYDAY_PICTURE_PATHS;

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
const talkJsHash = hashFile(path.join(ROOT, 'public/talk.js'));
const leftoverSuiteHash = hashFile(path.join(ROOT, 'test/test-talk-payday-leftover.js'));
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
  ok(hashFile(path.join(ROOT, 'public/forecast.js')) === forecastHash,
    `${label}: public/forecast.js bytes unchanged`);
  ok(hashFile(path.join(ROOT, 'public/talk.js')) === talkJsHash,
    `${label}: public/talk.js bytes unchanged`);
  ok(hashFile(path.join(ROOT, 'test/test-talk-payday-leftover.js')) === leftoverSuiteHash,
    `${label}: leftover suite bytes unchanged`);
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
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      captured.push({ method: req.method, url: req.url, raw });
      const next = queue.length > 0 ? queue.shift() : JSON.stringify({
        status: 'explained',
        claims: [{ path: 'authority.planner', equals: 'Forecast' }],
      });
      const text = typeof next === 'function' ? next(raw) : next;
      res.setHeader('content-type', 'application/json');
      res.end(geminiOkBody(typeof text === 'string' ? text : JSON.stringify(text)));
    });
  });
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        captured,
        close: () => new Promise(done => server.close(() => done())),
      });
    });
    server.on('error', reject);
  });
}

function askJson(base, cookie, question) {
  return fetch(`${base}/talk/ask`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ question }),
  });
}

function adviceFor(data, periods) {
  const overlay = data && data.liveOverlay;
  const asOf = (overlay && overlay.applied === true && overlay.effectiveAsOf)
    || (data.plan && data.plan.opening && data.plan.opening.asOf)
    || (data.meta && data.meta.asOf);
  const actuals = overlay && overlay.applied === true
    ? overlay.currentPeriodActuals
    : null;
  return Forecast.recommend(data.plan, asOf, {
    fundingSources: data.plan.funding && data.plan.funding.options,
    debts: data.debts,
    revolvingExtra: data.revolvingExtra,
    periods: periods || null,
    currentPeriodActuals: actuals,
    operatingPlan: overlay && overlay.operatingPlan,
    operatingPlanNote: overlay && overlay.operatingPlanNote,
  });
}

function pictureFields(alloc) {
  const leftover = alloc && alloc.runningLeftover;
  return {
    currentBalance: leftover && leftover.currentBalance,
    afterBills: leftover && leftover.afterBills,
    afterHouseholdBudget: leftover && leftover.afterHouseholdBudget,
    afterDebtRepayment: leftover && leftover.afterDebtRepayment,
    afterBigPurchases: leftover && leftover.afterBigPurchases,
    obligationsAllocated: alloc && alloc.obligations && alloc.obligations.allocated,
    essentialsAllocated: alloc && alloc.essentials && alloc.essentials.allocated,
    extraDebtAllocated: alloc && alloc.extraDebt && alloc.extraDebt.allocated,
  };
}

function packetPictureFields(block) {
  const leftover = block && block.runningLeftover;
  return {
    currentBalance: leftover && leftover.currentBalance,
    afterBills: leftover && leftover.afterBills,
    afterHouseholdBudget: leftover && leftover.afterHouseholdBudget,
    afterDebtRepayment: leftover && leftover.afterDebtRepayment,
    afterBigPurchases: leftover && leftover.afterBigPurchases,
    obligationsAllocated: block && block.obligations && block.obligations.allocated,
    essentialsAllocated: block && block.essentials && block.essentials.allocated,
    extraDebtAllocated: block && block.extraDebt && block.extraDebt.allocated,
  };
}

const FIELD_PATHS = Object.freeze({
  currentBalance: 'forecast.paydayAllocation.runningLeftover.currentBalance',
  obligationsAllocated: 'forecast.paydayAllocation.obligations.allocated',
  afterBills: 'forecast.paydayAllocation.runningLeftover.afterBills',
  essentialsAllocated: 'forecast.paydayAllocation.essentials.allocated',
  afterHouseholdBudget: 'forecast.paydayAllocation.runningLeftover.afterHouseholdBudget',
  extraDebtAllocated: 'forecast.paydayAllocation.extraDebt.allocated',
  afterDebtRepayment: 'forecast.paydayAllocation.runningLeftover.afterDebtRepayment',
  afterBigPurchases: 'forecast.paydayAllocation.runningLeftover.afterBigPurchases',
});

const FIELD_SENTENCES = Object.freeze({
  currentBalance: value => `This payday has ${TalkPresentation.formatCurrency(value)}.`,
  obligationsAllocated: value => `Forecast set aside ${TalkPresentation.formatCurrency(value)} for bills.`,
  afterBills: value => `After bills, ${TalkPresentation.formatCurrency(value)} remains.`,
  essentialsAllocated: value => `Forecast is holding ${TalkPresentation.formatCurrency(value)} for household costs.`,
  afterHouseholdBudget: value => `After household costs, ${TalkPresentation.formatCurrency(value)} remains.`,
  extraDebtAllocated: value => `Forecast allocated ${TalkPresentation.formatCurrency(value)} to extra debt.`,
  afterDebtRepayment: value => `After extra debt, ${TalkPresentation.formatCurrency(value)} remains.`,
  afterBigPurchases: value => `This payday leaves us with ${TalkPresentation.formatCurrency(value)}.`,
});

const STAGE_ORDER = Object.freeze([
  'currentBalance',
  'obligationsAllocated',
  'afterBills',
  'essentialsAllocated',
  'afterHouseholdBudget',
  'extraDebtAllocated',
  'afterDebtRepayment',
  'afterBigPurchases',
]);

function picturePacket(fields, extras) {
  extras = extras || {};
  const leftover = extras.unavailable
    ? null
    : {
      currentBalance: fields.currentBalance,
      afterBills: fields.afterBills,
      afterHouseholdBudget: fields.afterHouseholdBudget,
      afterDebtRepayment: fields.afterDebtRepayment,
      afterBigPurchases: fields.afterBigPurchases,
    };
  return {
    schema: Assistant.SCHEMA,
    authority: { planner: 'Forecast' },
    metadata: {
      effectiveAsOf: extras.asOf || '2026-09-15',
      freshness: { confidence: extras.freshness || 'canonical-opening' },
    },
    forecast: {
      predictedEndingBalance: extras.pebUnavailable
        ? { status: 'unavailable', reason: 'predicted-ending-balance-unavailable' }
        : {
          status: 'ok',
          source: 'Forecast.calendarPeriodWaterfalls',
          amount: extras.predictedEndingBalance != null
            ? extras.predictedEndingBalance
            : fields.afterBigPurchases,
        },
      paydayAllocation: extras.unavailable
        ? { status: 'unavailable', reason: 'payday-leftover-unavailable' }
        : {
          status: 'ok',
          source: 'Forecast.paydayAllocation',
          runningLeftover: leftover,
          obligations: { allocated: fields.obligationsAllocated },
          essentials: { allocated: fields.essentialsAllocated },
          extraDebt: { allocated: fields.extraDebtAllocated },
        },
      currentPeriodAction: {
        essentialRemaining: 1415.95,
        weeklyCap: 400,
        periodStart: '2026-09-11',
        periodEnd: '2026-09-24',
        nextPayday: '2026-09-25',
        remainingClaim: 'precise',
      },
    },
    current: {
      debts: {
        facilities: [
          { id: 'high', label: 'High-rate card', available: 400, trust: 'calculated' },
        ],
      },
    },
  };
}

function expectedPictureAnswer(fields) {
  return STAGE_ORDER.map(key => FIELD_SENTENCES[key](fields[key])).join(' ');
}

function presentPicture(packet) {
  const claims = TalkWhy.publishablePaths(PICTURE_PATHS, packet);
  return TalkPresentation.presentVerifiedClaims(
    claims.length ? { status: 'explained', claims } : { status: 'unavailable', claims: [] },
    packet
  );
}

function assertTalkEqualsForecast(label, fields, packet) {
  const presented = presentPicture(packet);
  const expected = expectedPictureAnswer(fields);
  ok(presented.answer === expected,
    `${label}: Talk reprints Forecast paydayAllocation fields in Forecast stage order`,
    presented.answer);
  ok(!/safe to spend/i.test(presented.answer)
      && !/\bpaid\b/i.test(presented.answer)
      && !/runningLeftover|afterHouseholdBudget|afterBigPurchases/.test(presented.answer),
    `${label}: household wording has no leftover jargon, paid claim, or safe-to-spend`);
  ok(presented.cards
      && presented.cards.items.filter(item => item.kind === 'answer').length === STAGE_ORDER.length
      && STAGE_ORDER.every((key, index) => (
        presented.cards.items[index].body === FIELD_SENTENCES[key](fields[key])
      ))
      && presented.summary
      && JSON.stringify(presented.summary).indexOf(TalkPresentation.formatCurrency(fields.afterBigPurchases)) !== -1,
    `${label}: cards follow Forecast stage order and summary reprints leftover`);
  ok(presented.source === 'Forecast'
      && presented.trust === 'calculated'
      && (presented.citations || []).some(row => row.source === 'Forecast')
      && presented.action && presented.action.href === '/',
    `${label}: provenance, trust, and Budget citation survive`);
  return presented;
}

function syntheticPaydayData(extra) {
  extra = extra || {};
  const asOf = extra.asOf || '2026-09-01';
  return {
    meta: { asOf },
    plan: {
      windowDays: 200,
      defaults: { targetBuffer: extra.targetBuffer != null ? extra.targetBuffer : 0 },
      opening: { asOf },
      startingCash: { amount: extra.cash != null ? extra.cash : 4000 },
      income: extra.income || [
        { id: 'p1', label: 'Pay 1', frequency: 'once', date: '2026-09-15', amount: 560, confidence: 'confirmed' },
      ],
      obligations: extra.obligations || [],
      bills: extra.bills || [
        {
          id: 'bill', label: 'Synthetic bill', frequency: 'once',
          date: asOf, amount: extra.billAmount != null ? extra.billAmount : 200,
          confidence: 'confirmed',
        },
      ],
      commitments: extra.commitments || [
        {
          id: 'camp', label: 'Synthetic camp', date: '2026-10-10',
          amount: extra.futureAmount != null ? extra.futureAmount : 300,
          flexibility: extra.futureFlex || 'required',
          confidence: 'confirmed',
        },
      ],
      budget: extra.budget || {
        categories: [
          {
            id: 'groceries', label: 'Groceries', class: 'essential',
            plannedMonthly: extra.groceries != null ? extra.groceries : 400,
            ownerLine: 'Groceries',
          },
        ],
      },
      nextDollar: extra.nextDollar || {
        policy: 'highest-interest',
        provenance: 'owner-stated',
      },
    },
    debts: extra.debts || [
      {
        id: 'card', label: 'Synthetic high card', secured: false,
        structure: 'Revolving — test', balance: 8000, rate: 19.99, limit: 10000, pending: 0,
      },
    ],
  };
}

console.log('=== 1. Authority path stays Forecast paydayAllocation; no Talk/browser arithmetic ===');
{
  const packetSrc = read('scripts/assistant-packet.js');
  const sessionSrc = read('scripts/talk-session.js');
  const presentationSrc = read('scripts/talk-presentation.js');
  const geminiSrc = TalkGemini.INSTRUCTION;
  const talkSrc = read('public/talk.js');
  const forecastSrc = fs.readFileSync(path.join(ROOT, 'public/forecast.js'), 'utf8');
  ok(/projectPaydayAllocation/.test(packetSrc)
      && /obligations/.test(packetSrc)
      && /essentials/.test(packetSrc)
      && /extraDebt/.test(packetSrc)
      && /runningLeftover/.test(packetSrc)
      && /Forecast\.paydayAllocation/.test(packetSrc)
      && !/currentBalance\s*-\s*|afterBills\s*-/.test(packetSrc),
    'assistant packet copies Forecast leftover stages and leftover-consuming allocated amounts');
  ok(!/require\(['"][^'"]*forecast/i.test(sessionSrc),
    'talk-session.js does not import Forecast');
  ok(/payday-picture/.test(sessionSrc)
      && /what does this payday look like/.test(sessionSrc)
      && /what does this payday leave us with/.test(sessionSrc)
      && /what does that leave us with/.test(sessionSrc),
    'session look-like grammar is exact and does not replace leftover deixis');
  ok(!/afterBills\s*-|currentBalance\s*-|allocated\s*\+|remaining\s*=/.test(sessionSrc)
      && !/afterBills\s*-|currentBalance\s*-|allocated\s*\+/.test(presentationSrc),
    'Talk session and presentation do not reconstruct leftover stages by subtracting');
  ok(/This payday has/.test(presentationSrc)
      && /Forecast set aside/.test(presentationSrc)
      && /After bills/.test(presentationSrc)
      && /Forecast is holding/.test(presentationSrc)
      && /After household costs/.test(presentationSrc)
      && /Forecast allocated/.test(presentationSrc)
      && /After extra debt/.test(presentationSrc)
      && /This payday leaves us with/.test(presentationSrc)
      && !/safe to spend/i.test(presentationSrc),
    'PATH_RULE reprints Forecast stages in household wording');
  ok(/intent":"payday-picture/.test(geminiSrc)
      && /payday-picture intent only/.test(geminiSrc)
      && /This is not leftover intent/.test(geminiSrc),
    'Gemini payday-picture contract is intent only');
  ok(!/Forecast\.|recommend\(|money2\(|paydayAllocation/.test(talkSrc),
    'talk.js still does not calculate paydayAllocation');
  ok(!/resolved-reference|payday-picture|what does this payday look like/.test(forecastSrc),
    'public/forecast.js is untouched');
}

console.log('\n=== 2. Packet picture equals independent Forecast paydayAllocation ===');
const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const periods = Assistant.loadPeriods();
const advice = adviceFor(liveData, periods);
const packet = Assistant.buildPacket({
  data: liveData,
  periods,
  now: '2026-09-15T12:00:00.000Z',
  env: {},
});
const forecastFields = pictureFields(advice && advice.paydayAllocation);
const packetFields = packetPictureFields(packet.forecast && packet.forecast.paydayAllocation);
{
  ok(advice && advice.paydayAllocation && advice.paydayAllocation.runningLeftover,
    'Forecast.recommend still publishes paydayAllocation leftover stages');
  ok(packet.forecast.paydayAllocation
      && packet.forecast.paydayAllocation.status === 'ok'
      && packet.forecast.paydayAllocation.source === 'Forecast.paydayAllocation',
    'packet forecast block exposes sanitized paydayAllocation picture fields');
  ok(STAGE_ORDER.every(key => near(packetFields[key], forecastFields[key])),
    'packet leftover stages and leftover-consuming allocated amounts equal independent Forecast',
    `${JSON.stringify(packetFields)} vs ${JSON.stringify(forecastFields)}`);
  ok(near(forecastFields.currentBalance, advice.paydayAllocation.available),
    'Forecast leftover currentBalance still equals paydayAllocation.available');
}

console.log('\n=== 3. Talk-published picture equals that Forecast picture ===');
{
  const presented = assertTalkEqualsForecast('live', forecastFields, packet);
  const leftoverMoney = TalkPresentation.formatCurrency(forecastFields.afterBigPurchases);
  ok(presented.answer.indexOf(`This payday leaves us with ${leftoverMoney}.`) !== -1,
    'look-like still reprints the #309 leftover sentence from Forecast leftover');
}

console.log('\n=== 4. Look-like intent is server-owned; leftover deixis stays #309 ===');
{
  const fixture = picturePacket({
    currentBalance: 1000,
    obligationsAllocated: 200,
    afterBills: 800,
    essentialsAllocated: 300,
    afterHouseholdBudget: 500,
    extraDebtAllocated: 100,
    afterDebtRepayment: 400,
    afterBigPurchases: 350,
  });
  const debts = [{ id: 'high', label: 'High-rate card' }];
  const direct = TalkSession.resolveFollowup({
    question: 'What does this payday look like?',
    priorTurn: null,
    debts,
    packet: fixture,
  });
  ok(direct.status === 'resolved-reference'
      && direct.referentKey === 'payday-picture'
      && direct.paths.length === PICTURE_PATHS.length
      && direct.paths.every((path, i) => path === PICTURE_PATHS[i])
      && direct.paths[0] === FIELD_PATHS.currentBalance
      && direct.paths[direct.paths.length - 1] === FIELD_PATHS.afterBigPurchases
      && direct.paths[direct.paths.length - 1] !== LEFTOVER_PATH,
    'look-like reads Forecast paydayAllocation stage paths, not Predicted Ending Balance');

  ok(TalkSession.resolveFollowup({
    question: 'How does this payday look?',
    priorTurn: null,
    debts,
    packet: fixture,
  }).status === 'none',
    'look-like grammar is not broadened');

  ok(TalkSession.resolveFollowup({
    question: 'What does that leave us with?',
    priorTurn: null,
    debts,
    packet: fixture,
  }).status === 'ambiguous',
    'that-leave-us-with without an earned leftover presentation still fails closed');

  const claims = TalkWhy.publishablePaths(direct.paths, fixture);
  const lookTurn = TalkWhy.sessionTurnFromExplained(claims);
  const store = TalkSession.createSessionContext({ secret: SECRET });
  const key = store.keyFromToken('cookie-picture');
  ok(store.append(key, Object.assign({
    kind: 'explained',
    question: 'What does this payday look like?',
    presented: expectedPictureAnswer(pictureFields({
      runningLeftover: {
        currentBalance: 1000,
        afterBills: 800,
        afterHouseholdBudget: 500,
        afterDebtRepayment: 400,
        afterBigPurchases: 350,
      },
      obligations: { allocated: 200 },
      essentials: { allocated: 300 },
      extraDebt: { allocated: 100 },
    })),
  }, lookTurn)) === true,
    'explained look-like turn stores Forecast picture paths');
  const stored = store.turns(key)[0];
  ok(stored.referentKeys
      && stored.referentKeys.includes('payday-picture')
      && stored.referentKeys.includes('payday-leftover'),
    'look-like presentation earns leftover for #309 deixis');

  const that = TalkSession.resolveFollowup({
    question: 'What does that leave us with?',
    priorTurn: stored,
    debts,
    packet: picturePacket({
      currentBalance: 12,
      obligationsAllocated: 0,
      afterBills: 12,
      essentialsAllocated: 0,
      afterHouseholdBudget: 12,
      extraDebtAllocated: 0,
      afterDebtRepayment: 12,
      afterBigPurchases: 12.34,
    }, { predictedEndingBalance: 12.34 }),
  });
  ok(that.status === 'resolved-reference'
      && that.referentKey === 'payday-leftover'
      && that.paths.length === 1
      && that.paths[0] === LEFTOVER_PATH,
    'earned leftover deixis stays leftover-only and does not broaden to the picture');
  const stalePacket = picturePacket({
    currentBalance: 12,
    obligationsAllocated: 0,
    afterBills: 12,
    essentialsAllocated: 0,
    afterHouseholdBudget: 12,
    extraDebtAllocated: 0,
    afterDebtRepayment: 12,
    afterBigPurchases: 12.34,
  }, { predictedEndingBalance: 12.34 });
  const staleClaims = TalkWhy.publishablePaths(that.paths, stalePacket);
  const stalePresented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: staleClaims,
  }, stalePacket);
  ok(staleClaims[0] && near(staleClaims[0].value, 12.34)
      && stalePresented.answer === 'Predicted ending balance for this pay period is $12.34.'
      && stalePresented.answer.indexOf('350') === -1,
    'leftover follow-up re-reads Forecast Predicted Ending Balance, not look-like prose');
}

console.log('\n=== 5. Adversarial Forecast fixtures: extra debt, future costs, zeros, unavailable ===');
{
  const extraData = syntheticPaydayData({
    cash: 5000,
    billAmount: 250,
    groceries: 200,
    futureAmount: 400,
    debts: [
      {
        id: 'card', label: 'Synthetic high card', secured: false,
        structure: 'Revolving — test', balance: 8000, rate: 26.99, limit: 10000, pending: 0,
      },
    ],
  });
  extraData.plan.nextDollar = { policy: 'highest-interest', provenance: 'owner-stated' };
  const extraAdvice = adviceFor(extraData, null);
  const extraPacket = Assistant.buildPacket({
    data: extraData,
    periods: null,
    now: '2026-09-01T12:00:00.000Z',
    env: {},
    questionsMarkdown: '',
  });
  const extraFields = pictureFields(extraAdvice && extraAdvice.paydayAllocation);
  ok(Number(extraFields.extraDebtAllocated) > 0,
    'synthetic extra-debt fixture produces Forecast extraDebt.allocated > 0',
    String(extraFields.extraDebtAllocated));
  ok(STAGE_ORDER.every(key => (
    near(packetPictureFields(extraPacket.forecast.paydayAllocation)[key], extraFields[key])
  )),
    'synthetic extra-debt packet copies Forecast picture fields');
  assertTalkEqualsForecast('extra-debt', extraFields, extraPacket);
  const extraAlloc = extraAdvice.paydayAllocation;
  const futureTaken = (extraAlloc.futureCosts || [])
    .reduce((sum, row) => sum + (Number(row.allocated) || 0), 0);
  const optionalTaken = (extraAlloc.optional || [])
    .reduce((sum, row) => sum + (Number(row.allocated) || 0), 0);
  if (futureTaken > 0) {
    ok(!near(extraFields.afterDebtRepayment, extraFields.afterBigPurchases),
      'non-zero Forecast big-purchase set-aside moves leftover after extra debt');
  }
  ok(near(extraFields.afterBigPurchases, extraAlloc.runningLeftover.afterBigPurchases),
    'Talk leftover remains Forecast afterBigPurchases, not leftover minus optional');
  ok(optionalTaken === 0 || !presentPicture(extraPacket).answer.includes('optional residual'),
    'Talk does not invent an optional leftover stage');

  const zeroFields = {
    currentBalance: 0,
    obligationsAllocated: 0,
    afterBills: 0,
    essentialsAllocated: 0,
    afterHouseholdBudget: 0,
    extraDebtAllocated: 0,
    afterDebtRepayment: 0,
    afterBigPurchases: 0,
  };
  const zeroPresented = presentPicture(picturePacket(zeroFields));
  ok(zeroPresented.answer === expectedPictureAnswer(zeroFields)
      && /This payday has \$0\.00/.test(zeroPresented.answer)
      && /Forecast set aside \$0\.00 for bills/.test(zeroPresented.answer)
      && /This payday leaves us with \$0\.00/.test(zeroPresented.answer)
      && zeroPresented.trust === 'calculated'
      && !/unavailable/.test(zeroPresented.answer),
    'genuine Forecast zeros stay $0 and are not an error');

  const missing = presentPicture({
    schema: Assistant.SCHEMA,
    metadata: { effectiveAsOf: '2026-09-15', freshness: { confidence: 'canonical-opening' } },
    forecast: {
      paydayAllocation: {
        status: 'ok',
        source: 'Forecast.paydayAllocation',
        runningLeftover: {
          currentBalance: 80,
          afterBills: 80,
          afterHouseholdBudget: 80,
          afterDebtRepayment: 80,
          afterBigPurchases: null,
        },
        obligations: { allocated: 0 },
        essentials: { allocated: 0 },
        extraDebt: { allocated: 0 },
      },
    },
  });
  ok(/Payday leftover is unavailable/.test(missing.answer)
      && !/\$0\.00 leftover/.test(missing.answer)
      && missing.answer.indexOf('This payday has $80.00.') !== -1
      && missing.trust === 'unavailable',
    'null leftover stays unavailable and is not coerced to $0');

  const unavailable = presentPicture(picturePacket(zeroFields, { unavailable: true }));
  ok(unavailable.answer === TalkPresentation.UNAVAILABLE_ANSWER
      && unavailable.trust === 'unavailable'
      && !/\$0/.test(JSON.stringify(unavailable)),
    'unavailable paydayAllocation is not a $0 picture');

  const invented = TalkSession.parsePaydayPictureExtract({
    intent: TalkSession.PAYDAY_PICTURE_INTENT,
    amount: 99999,
  });
  ok(invented.ok === false && invented.reason === 'invented payday picture',
    'Gemini payday-picture extract cannot carry an amount');
  const pictureIntent = TalkSession.parsePaydayPictureExtract({
    intent: TalkSession.PAYDAY_PICTURE_INTENT,
  });
  ok(pictureIntent.ok === true && pictureIntent.intent === TalkSession.PAYDAY_PICTURE_INTENT,
    'payday-picture extract may name intent only');
  const fromIntent = TalkSession.resolvePaydayPicture({
    question: 'Show me the payday picture',
    extract: pictureIntent,
  });
  const intentClaims = TalkWhy.publishablePaths(fromIntent.paths, picturePacket({
    currentBalance: 10,
    obligationsAllocated: 1,
    afterBills: 9,
    essentialsAllocated: 2,
    afterHouseholdBudget: 7,
    extraDebtAllocated: 3,
    afterDebtRepayment: 4,
    afterBigPurchases: 4,
  }));
  ok(fromIntent.status === 'resolved-reference'
      && near(intentClaims.find(row => row.path === FIELD_PATHS.afterBigPurchases).value, 4)
      && intentClaims.every(row => Number.isFinite(Number(row.value))),
    'payday-picture intent still reads amounts from the packet, not from Gemini');

  const leftoverSteal = TalkSession.parseLeftoverExtract({
    intent: TalkSession.PAYDAY_PICTURE_INTENT,
  });
  ok(leftoverSteal.ok === false && leftoverSteal.reason === 'not-leftover',
    'look-like intent cannot pass the leftover extract');

  const wrongEquals = TalkGemini.materializeExplainerAnswer(JSON.stringify({
    status: 'explained',
    claims: [{ path: FIELD_PATHS.extraDebtAllocated, equals: 99999 }],
  }), picturePacket(forecastFields));
  ok(wrongEquals.ok === false,
    'Gemini cannot publish an extra-debt amount that is not the packet amount');
}

console.log('\n=== 6. Session HTTP look-like equals Forecast and earns leftover deixis ===');
async function runHttpProof() {
  const expected = expectedPictureAnswer(forecastFields);
  const leftoverMoney = TalkPresentation.formatCurrency(forecastFields.afterBigPurchases);
  const mock = await startMockGemini([
    JSON.stringify({
      intent: TalkSession.PAYDAY_PICTURE_INTENT,
      amount: 99999,
    }),
  ]);
  const port = await freePort();
  const atlas = await startAtlas(isolatedEnv({
    SITE_PASSWORD: PASS,
    SESSION_SECRET: SECRET,
    ATLAS_TALK_GEMINI_API_KEY: GEMINI_KEY,
    ATLAS_TALK_GEMINI_BASE_URL: mock.url,
    PORT: String(port),
  }));
  const base = `http://127.0.0.1:${port}`;
  try {
    const sessionA = await login(base);
    await new Promise(resolve => setTimeout(resolve, 5));
    const sessionB = await login(base);

    const first = await askJson(base, sessionA.cookie, 'What does this payday look like?');
    const firstBody = await first.json();
    ok(first.status === 200
        && firstBody.answer === expected
        && mock.captured.length === 0,
      'look-like reprints Forecast picture and does not call Gemini',
      firstBody && firstBody.answer);
    ok(firstBody.cards
        && firstBody.cards.items.some(item => item.body === `This payday has ${TalkPresentation.formatCurrency(forecastFields.currentBalance)}.`)
        && firstBody.cards.items.some(item => item.body === `This payday leaves us with ${leftoverMoney}.`)
        && JSON.stringify(firstBody.summary || {}).indexOf(leftoverMoney) !== -1
        && (firstBody.citations || []).some(row => row.source === 'Forecast'),
      'HTTP look-like cards, summary, and citations keep Forecast figures');

    const that = await askJson(base, sessionA.cookie, 'What does that leave us with?');
    const thatBody = await that.json();
    const peb = packet.forecast && packet.forecast.predictedEndingBalance;
    const pebKnown = peb && peb.status === 'ok' && Number.isFinite(Number(peb.amount));
    const pebMoney = pebKnown ? TalkPresentation.formatCurrency(peb.amount) : null;
    ok(that.status === 200
        && (pebKnown
          ? thatBody.answer === `Predicted ending balance for this pay period is ${pebMoney}.`
          : /Predicted ending balance is unavailable/.test(thatBody.answer))
        && mock.captured.length === 0,
      'look-like earns leftover deixis that reprints Forecast Predicted Ending Balance');

    const isolated = await askJson(base, sessionB.cookie, 'What does that leave us with?');
    const isolatedBody = await isolated.json();
    ok(isolated.status === 200
        && isolatedBody.answer === TalkPresentation.UNAVAILABLE_ANSWER
        && isolatedBody.answer.indexOf(leftoverMoney) === -1
        && mock.captured.length === 0,
      'session B cannot bind session A leftover deixis after a look-like');
  } finally {
    await atlas.stop();
    await mock.close();
  }
  filesUnchanged('Talk payday operating picture');
}

runHttpProof().then(() => {
  ok(hashFile(DATA) === liveHash, 'live data.json bytes unchanged at suite end');
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
