'use strict';
/* Talk remaining payday bills reprint Forecast.currentPeriodAction.bills.
 *
 * Independent proof: Talk-published remaining / covered / named bills
 * equal Forecast currentPeriodAction.bills for the same fixture. Talk
 * does not date-filter, sum remaining amounts, invent a paid list, or
 * treat unverified as unpaid. History is referential only. Unavailable
 * remaining is not none. Gemini extracts remaining-bills intent or
 * referent only. #309 leftover and #310 payday-picture contracts stay
 * in force.
 * `node test/test-talk-payday-remaining-bills.js`
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
const REMAINING_INTENT = TalkSession.REMAINING_BILLS_INTENT;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const near = (a, b) => Math.abs(Number(a) - Number(b) ) < 0.005;

const liveHash = hashFile(DATA);
const forecastHash = hashFile(path.join(ROOT, 'public/forecast.js'));
const talkJsHash = hashFile(path.join(ROOT, 'public/talk.js'));
const leftoverSuiteHash = hashFile(path.join(ROOT, 'test/test-talk-payday-leftover.js'));
const pictureSuiteHash = hashFile(path.join(ROOT, 'test/test-talk-payday-picture.js'));
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
  ok(hashFile(path.join(ROOT, 'test/test-talk-payday-picture.js')) === pictureSuiteHash,
    `${label}: payday-picture suite bytes unchanged`);
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

function forecastItems(advice) {
  const items = advice && advice.currentPeriodAction && advice.currentPeriodAction.bills;
  return Array.isArray(items) ? items : null;
}

function packetItems(packet) {
  const items = packet
    && packet.forecast
    && packet.forecast.currentPeriodAction
    && packet.forecast.currentPeriodAction.bills;
  return Array.isArray(items) ? items : null;
}

function itemFields(item) {
  if (!item) return null;
  return {
    id: item.id || null,
    label: item.label || null,
    date: item.date || null,
    planned: item.planned,
    remaining: item.remaining,
    actual: item.actual,
    settlement: item.settlement || null,
    confidence: item.confidence || null,
  };
}

function sameMoney(a, b) {
  if (a == null && b == null) return true;
  return near(a, b);
}

function itemsEqual(forecast, packet) {
  if (!forecast || !packet || forecast.length !== packet.length) return false;
  return forecast.every((row, i) => {
    const a = itemFields(row);
    const b = itemFields(packet[i]);
    return a.id === b.id
      && a.label === b.label
      && a.date === b.date
      && a.settlement === b.settlement
      && a.confidence === b.confidence
      && sameMoney(a.planned, b.planned)
      && sameMoney(a.remaining, b.remaining)
      && sameMoney(a.actual, b.actual);
  });
}

function stillDue(items) {
  return (items || []).filter(row => row && (
    row.settlement === 'upcoming' || row.settlement === 'unverified'
  ));
}

function represented(items) {
  return (items || []).filter(row => row && row.settlement === 'represented');
}

function remainingRef(ask, extras) {
  extras = extras || {};
  const resolved = {
    status: 'resolved-reference',
    referentKey: REMAINING_INTENT,
    ask: ask || 'remaining',
  };
  if (extras.billId) resolved.billId = extras.billId;
  if (extras.billLabel) resolved.billLabel = extras.billLabel;
  return resolved;
}

function presentRemaining(packet, ask, extras) {
  return TalkPresentation.presentPaydayRemainingBills(remainingRef(ask, extras), packet);
}

function leftoverPacket(amount, extras) {
  extras = extras || {};
  return {
    schema: Assistant.SCHEMA,
    authority: { planner: 'Forecast' },
    metadata: {
      effectiveAsOf: extras.asOf || '2026-09-15',
      freshness: { confidence: extras.freshness || 'canonical-opening' },
    },
    forecast: {
      paydayAllocation: extras.unavailable
        ? { status: 'unavailable', reason: 'payday-leftover-unavailable' }
        : {
          status: 'ok',
          source: 'Forecast.paydayAllocation',
          runningLeftover: {
            currentBalance: extras.currentBalance,
            afterBills: extras.afterBills,
            afterHouseholdBudget: extras.afterHouseholdBudget,
            afterDebtRepayment: extras.afterDebtRepayment,
            afterBigPurchases: amount,
          },
          obligations: extras.obligations || { allocated: 0 },
        },
      currentPeriodAction: extras.actionUnavailable
        ? { status: 'unavailable', reason: 'current-period-action-unavailable' }
        : {
        status: extras.actionStatus || 'ok',
        source: extras.actionSource || 'Forecast.currentPeriodAction',
        remainingClaim: extras.remainingClaim || 'precise',
        essentialRemaining: 1415.95,
        weeklyCap: 400,
        periodStart: '2026-09-11',
        periodEnd: '2026-09-24',
        nextPayday: '2026-09-25',
        bills: extras.bills,
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

function shawPaydayData(extra) {
  extra = extra || {};
  const asOf = extra.asOf || '2026-09-10';
  const shawDate = extra.shawDate || '2026-09-14';
  return {
    meta: { asOf },
    plan: {
      windowDays: 200,
      defaults: { targetBuffer: 0 },
      opening: {
        asOf,
        representedEvents: extra.represented
          ? [{ id: 'shaw', date: shawDate }]
          : [],
      },
      startingCash: { amount: extra.cash != null ? extra.cash : 4000 },
      income: [
        { id: 'p1', label: 'Pay 1', frequency: 'once', date: asOf, amount: 2000, confidence: 'confirmed' },
        { id: 'p2', label: 'Pay 2', frequency: 'once', date: '2026-09-25', amount: 2000, confidence: 'confirmed' },
      ],
      obligations: [],
      bills: extra.bills || [
        {
          id: 'shaw', label: 'Shaw internet', frequency: 'once',
          date: shawDate, amount: 78.4, confidence: 'confirmed',
        },
        {
          id: 'hydro', label: 'BC Hydro', frequency: 'once',
          date: extra.hydroDate || '2026-09-12', amount: 50, confidence: 'confirmed',
        },
      ],
      commitments: [],
      budget: {
        categories: [
          {
            id: 'groceries', label: 'Groceries', class: 'essential',
            plannedMonthly: 0, ownerLine: 'Groceries',
          },
        ],
      },
      nextDollar: { policy: 'highest-interest', provenance: 'owner-stated' },
    },
    debts: [
      {
        id: 'card', label: 'Synthetic high card', secured: false,
        structure: 'Revolving — test', balance: 8000, rate: 19.99, limit: 10000, pending: 0,
      },
    ],
  };
}

function leftoverTurn(amount) {
  return {
    kind: 'explained',
    question: 'What does this payday leave us with?',
    presented: `This payday leaves us with ${TalkPresentation.formatCurrency(amount)}.`,
    referentPaths: [LEFTOVER_PATH],
  };
}

console.log('=== 1. Authority path stays Forecast currentPeriodAction.bills; no Talk/browser arithmetic ===');
{
  const packetSrc = read('scripts/assistant-packet.js');
  const sessionSrc = read('scripts/talk-session.js');
  const presentationSrc = read('scripts/talk-presentation.js');
  const geminiSrc = TalkGemini.INSTRUCTION;
  const talkSrc = read('public/talk.js');
  const forecastSrc = fs.readFileSync(path.join(ROOT, 'public/forecast.js'), 'utf8');
  const itemHelper = packetSrc.slice(
    packetSrc.indexOf('function projectCurrentPeriodBill'),
    packetSrc.indexOf('function projectCurrentPeriodBills')
  );
  ok(/projectCurrentPeriodBills/.test(packetSrc)
      && /currentPeriodAction/.test(packetSrc)
      && /Forecast\.currentPeriodAction/.test(packetSrc)
      && itemHelper.indexOf('planned') !== -1
      && itemHelper.indexOf('remaining') !== -1
      && itemHelper.indexOf('actual') !== -1
      && itemHelper.indexOf('settlement') !== -1
      && itemHelper.indexOf('evidenceDate') === -1,
    'assistant packet projects sanitized Forecast currentPeriodAction.bills');
  ok(!/require\(['"][^'"]*forecast/i.test(sessionSrc)
      && !/require\(['"][^'"]*forecast/i.test(presentationSrc),
    'talk-session and talk-presentation do not import Forecast');
  ok(!/afterBills\s*-|currentBalance\s*-|allocated\s*\+|remaining\s*=/.test(sessionSrc)
      && !/afterBills\s*-|currentBalance\s*-|allocated\s*\+|remaining\s*=/.test(presentationSrc)
      && !/\.amount\s*\+/.test(presentationSrc),
    'Talk does not reconstruct leftover stages or sum remaining-bill amounts');
  ok(/payday-remaining-bills/.test(sessionSrc)
      && /what bills are coming before/.test(sessionSrc)
      && /what bills are left/.test(sessionSrc)
      && /which bills have already been covered/.test(sessionSrc)
      && sessionSrc.indexOf('still\\s+due') !== -1
      && !/shaw still due/.test(sessionSrc)
      && !/\.date\s*[<>]/.test(sessionSrc)
      && !/\.date\s*[<>]/.test(presentationSrc),
    'session remaining-bills grammar is generic; Talk does not date-filter or hardcode Shaw');
  ok(/Forecast still lists these bills/.test(presentationSrc)
      && /currentPeriodAction\.bills/.test(presentationSrc)
      && /not unpaid, late, overdue, or definitely due/.test(presentationSrc)
      && /lists these bills as represented/.test(presentationSrc),
    'presentation reprints Forecast period bills and represented settlement');
  ok(/intent":"payday-remaining-bills/.test(geminiSrc)
      && /never an amount or settlement status/.test(geminiSrc)
      && /This is not leftover or payday-picture intent/.test(geminiSrc),
    'Gemini remaining-bills contract is intent/referent/billLabel only');
  ok(!/Forecast\.|recommend\(|money2\(|paydayAllocation/.test(talkSrc),
    'talk.js still does not calculate remaining bills');
  ok(!/resolved-reference|payday-remaining-bills|what bills are left/.test(forecastSrc),
    'public/forecast.js is untouched');
  ok(TalkSession.classifyVerifiedFollowup('What does this payday leave us with?') === 'payday-leftover'
      && TalkSession.classifyVerifiedFollowup('What does this payday look like?') === 'payday-picture'
      && TalkSession.classifyVerifiedFollowup('What bills are coming before next payday?') === 'payday-remaining-bills'
      && TalkSession.classifyVerifiedFollowup('What bills are left?') === 'payday-remaining-bills',
    '#309 leftover and #310 picture classifiers still win their exact asks');
}

console.log('\n=== 2. Packet bills equal independent Forecast currentPeriodAction.bills ===');
const liveData = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const periods = Assistant.loadPeriods();
const advice = adviceFor(liveData, periods);
const packet = Assistant.buildPacket({
  data: liveData,
  periods,
  now: '2026-09-15T12:00:00.000Z',
  env: {},
});
const forecastListed = forecastItems(advice);
const packetListed = packetItems(packet);
{
  ok(advice && advice.currentPeriodAction && Array.isArray(forecastListed)
      && forecastListed.length > 0,
    'Forecast.recommend still publishes currentPeriodAction.bills');
  ok(packet.forecast.currentPeriodAction
      && packet.forecast.currentPeriodAction.status === 'ok'
      && packet.forecast.currentPeriodAction.source === 'Forecast.currentPeriodAction'
      && Array.isArray(packetListed),
    'packet currentPeriodAction exposes sanitized period bills');
  ok(itemsEqual(forecastListed, packetListed),
    'packet bills equal independent Forecast.currentPeriodAction.bills');
  ok(Array.isArray(packetListed)
      && !packetListed.some(row => Object.prototype.hasOwnProperty.call(row, 'evidenceDate')
      || Object.prototype.hasOwnProperty.call(row, 'kind')
      || Object.prototype.hasOwnProperty.call(row, 'debtId')),
    'packet bills omit evidenceDate, kind, and debtId');
  ok(packet.forecast.currentPeriodAction.remainingClaim === 'unavailable'
      && Array.isArray(packetListed) && packetListed.length === forecastListed.length,
    'remainingClaim unavailable does not withhold Forecast period bills');
}

console.log('\n=== 3A. Upcoming remaining bills reprint Forecast period bills ===');
{
  const presented = presentRemaining(packet, 'remaining');
  const due = stillDue(forecastListed);
  ok(presented.answer.indexOf(TalkPresentation.REMAINING_BILLS_LEAD) !== -1
      && !/Forecast remaining-obligation total/.test(presented.answer),
    'Talk remaining lead reprints Forecast bills and does not invent a total');
  ok(due.every((row) => {
    const money = TalkPresentation.formatCurrency(row.remaining != null ? row.remaining : row.planned);
    return presented.answer.indexOf(row.label) !== -1
      && presented.answer.indexOf(row.date) !== -1
      && presented.answer.indexOf(money) !== -1;
  }), 'each Forecast still-due bill label, date, and remaining is reprinted');
  ok(represented(forecastListed).every(row => presented.answer.indexOf(row.label) === -1),
    'remaining ask does not reprint Forecast represented bills');
  ok(presented.cards
      && presented.cards.items.some(item => item.body === TalkPresentation.REMAINING_BILLS_LEAD)
      && presented.summary
      && presented.source === 'Forecast'
      && presented.action && presented.action.href === '/bills.html',
    'cards, summary, Forecast source, and Bills action survive');
}

console.log('\n=== 3B. Represented Shaw is omitted from remaining; named ask is not unpaid ===');
{
  const upcoming = shawPaydayData();
  const upcomingAdvice = adviceFor(upcoming, null);
  const upcomingPacket = Assistant.buildPacket({
    data: upcoming,
    periods: null,
    now: '2026-09-10T12:00:00.000Z',
    env: {},
    questionsMarkdown: '',
  });
  const upcomingForecast = forecastItems(upcomingAdvice) || [];
  const upcomingPacketItems = packetItems(upcomingPacket) || [];
  ok(upcomingForecast.some(row => row.id === 'shaw' && row.settlement === 'upcoming')
      && upcomingPacketItems.some(row => row.id === 'shaw' && row.settlement === 'upcoming'),
    'Shaw settlement-identity fixture lists Shaw as upcoming when unrepresented');
  const shawDue = presentRemaining(upcomingPacket, 'named', { billLabel: 'Shaw' });
  ok(shawDue.answer.indexOf('Shaw internet is still due 2026-09-14 for $78.40.') !== -1
      && !/unpaid|late|overdue/.test(shawDue.answer),
    'named Shaw ask reprints Forecast upcoming item; no Shaw-hardcoded unpaid wording');

  const paid = shawPaydayData({ represented: true });
  const paidAdvice = adviceFor(paid, null);
  const paidPacket = Assistant.buildPacket({
    data: paid,
    periods: null,
    now: '2026-09-10T12:00:00.000Z',
    env: {},
    questionsMarkdown: '',
  });
  const paidForecast = forecastItems(paidAdvice) || [];
  const paidPacketItems = packetItems(paidPacket) || [];
  ok(paidForecast.some(row => row.id === 'shaw' && row.settlement === 'represented')
      && paidPacketItems.some(row => row.id === 'shaw' && row.settlement === 'represented')
      && paidForecast.some(row => row.id === 'hydro' && row.settlement === 'upcoming'),
    'represented Shaw stays on Forecast period bills as represented; Hydro remains upcoming');
  const remainingAfter = presentRemaining(paidPacket, 'remaining');
  ok(remainingAfter.answer.indexOf('Shaw') === -1
      && remainingAfter.answer.indexOf('BC Hydro') !== -1,
    'Talk remaining list omits represented Shaw via Forecast settlement and still reprints Hydro');
  const shawCovered = presentRemaining(paidPacket, 'named', { billLabel: 'Shaw' });
  ok(shawCovered.answer.indexOf('Shaw internet is represented 2026-09-14') !== -1
      && shawCovered.answer.indexOf('That is not still due.') !== -1
      && !/\bunpaid\b|\blate\b|\boverdue\b/.test(shawCovered.answer),
    'named Shaw after representation reprints Forecast represented settlement, not unpaid');
  const coveredList = presentRemaining(paidPacket, 'covered');
  ok(coveredList.answer.indexOf(TalkPresentation.REMAINING_BILLS_COVERED_LEAD) !== -1
      && coveredList.answer.indexOf('Shaw internet is represented 2026-09-14') !== -1
      && coveredList.answer.indexOf('BC Hydro') === -1,
    'covered ask reprints Forecast represented bills only');
}

console.log('\n=== 3C. Unverified is not unpaid, late, overdue, or definitely due ===');
{
  const unverified = forecastListed.filter(row => row.settlement === 'unverified');
  ok(unverified.length > 0, 'live Forecast still has unverified remaining items');
  const presented = presentRemaining(packet, 'remaining');
  ok(unverified.every((row) => {
    const money = TalkPresentation.formatCurrency(
      row.remaining != null ? row.remaining : row.planned
    );
    const sentence = `${row.label} was scheduled ${row.date} for ${money}`;
    return presented.answer.indexOf(sentence) !== -1;
  }), 'unverified items reprint scheduled date and remaining');
  ok(presented.answer.indexOf(TalkPresentation.REMAINING_BILLS_UNVERIFIED_NOTE) !== -1
      && !/\bis unpaid\b|\bis late\b|\bis overdue\b/.test(presented.answer),
    'unverified wording is the Forecast caveat, not unpaid/late/overdue');
}

console.log('\n=== 3D. Empty remaining only when Forecast establishes none; unavailable is not none ===');
{
  const emptyPacket = leftoverPacket(12.34, { bills: [] });
  const empty = presentRemaining(emptyPacket, 'remaining');
  ok(empty.answer === TalkPresentation.REMAINING_BILLS_EMPTY_ANSWER
      && empty.trust === 'calculated'
      && !/unavailable/.test(empty.answer),
    'Forecast empty currentPeriodAction.bills is none');

  const allRepresented = leftoverPacket(12.34, {
    bills: [{
      id: 'shaw', label: 'Shaw internet', date: '2026-09-14',
      planned: 78.4, remaining: 0, actual: 78.4, settlement: 'represented',
      confidence: 'confirmed',
    }],
  });
  const noneLeft = presentRemaining(allRepresented, 'remaining');
  ok(noneLeft.answer === TalkPresentation.REMAINING_BILLS_EMPTY_ANSWER
      && noneLeft.answer.indexOf('Shaw') === -1,
    'all-represented Forecast bills establish no remaining, without Talk date math');

  const missingItems = leftoverPacket(12.34, {});
  const unavailableItems = presentRemaining(missingItems, 'remaining');
  ok(unavailableItems.answer === TalkPresentation.REMAINING_BILLS_UNAVAILABLE_ANSWER
      && unavailableItems.trust === 'unavailable'
      && unavailableItems.answer.indexOf(TalkPresentation.REMAINING_BILLS_EMPTY_ANSWER) === -1
      && !/\$0/.test(unavailableItems.answer),
    'missing bills array is unavailable, not none and not $0');

  const blockGone = leftoverPacket(null, { unavailable: true, actionUnavailable: true });
  const missingBlock = presentRemaining(blockGone, 'remaining');
  ok(missingBlock.answer === TalkPresentation.REMAINING_BILLS_UNAVAILABLE_ANSWER
      && missingBlock.trust === 'unavailable'
      && !/none|no remaining/.test(missingBlock.answer),
    'unavailable currentPeriodAction is not an empty remaining list');
}

console.log('\n=== 3E. No Talk/browser remaining total; Forecast fields are reprinted ===');
{
  const presented = presentRemaining(packet, 'remaining');
  const presentationSrc = read('scripts/talk-presentation.js');
  const talkSrc = read('public/talk.js');
  ok(!/remaining-obligation total/.test(presented.answer)
      && !/\.remaining\s*\+/.test(presentationSrc)
      && !/\.planned\s*\+/.test(presentationSrc)
      && !/reduce\s*\(/.test(talkSrc)
      && !/\.date\s*[<>]/.test(presentationSrc),
    'Talk does not sum remaining amounts or date-filter bills');
}

console.log('\n=== 3F. Follow-up refs: that one binds a unique item; lists stay fail-closed ===');
{
  const upcoming = shawPaydayData();
  const upcomingPacket = Assistant.buildPacket({
    data: upcoming,
    periods: null,
    now: '2026-09-10T12:00:00.000Z',
    env: {},
    questionsMarkdown: '',
  });
  const debts = [{ id: 'card', label: 'Synthetic high card' }];
  const named = TalkSession.resolveFollowup({
    question: 'Is Shaw still due?',
    priorTurn: null,
    debts,
    packet: upcomingPacket,
  });
  ok(named.status === 'resolved-reference'
      && named.referentKey === REMAINING_INTENT
      && named.ask === 'named'
      && named.billId === 'shaw',
    'Is Shaw still due? matches Forecast item id/label, not a hardcoded Shaw path');
  const namedTurn = TalkSession.sessionTurnFromRemainingBills(named);
  const store = TalkSession.createSessionContext({ secret: SECRET });
  const key = store.keyFromToken('cookie-remaining');
  ok(store.append(key, Object.assign({
    kind: 'explained',
    question: 'Is Shaw still due?',
    presented: 'Shaw internet is still due 2026-09-14 for $78.40.',
  }, namedTurn)) === true, 'named remaining turn stores the Forecast item id');
  const stored = store.turns(key)[0];
  ok(stored.referentKeys && stored.referentKeys.includes(REMAINING_INTENT)
      && stored.billId === 'shaw',
    'sanitized remaining turn keeps the structured Shaw item ref');
  ok(TalkSession.publicConversation(store.turns(key)).every(row => (
    !row.referentKeys && !row.billId
  )), 'public conversation still exposes remaining wording only');

  const thatOne = TalkSession.resolveFollowup({
    question: 'What about that one?',
    priorTurn: stored,
    debts,
    packet: upcomingPacket,
  });
  ok(thatOne.status === 'resolved-reference'
      && thatOne.ask === 'named'
      && thatOne.billId === 'shaw',
    'what about that one? binds the earned unique remaining-bill ref');
  const stalePacket = Assistant.buildPacket({
    data: shawPaydayData({ represented: true }),
    periods: null,
    now: '2026-09-10T12:00:00.000Z',
    env: {},
    questionsMarkdown: '',
  });
  const stale = TalkPresentation.presentPaydayRemainingBills(thatOne, stalePacket);
  ok(stale.answer.indexOf('is represented 2026-09-14') !== -1
      && stale.answer.indexOf('still due 2026-09-14') === -1
      && stale.answer.indexOf('$78.40') !== -1,
    'that-one re-reads the current packet represented settlement, not stale still-due prose');

  const listAsk = TalkSession.resolveFollowup({
    question: 'What bills are left?',
    priorTurn: null,
    debts,
    packet: upcomingPacket,
  });
  ok(listAsk.status === 'resolved-reference' && listAsk.ask === 'remaining' && !listAsk.billId,
    'a multi-item remaining list does not invent a unique that-one ref');
  const listTurn = TalkSession.sessionTurnFromRemainingBills(listAsk);
  ok(TalkSession.resolveFollowup({
    question: 'What about that one?',
    priorTurn: Object.assign({
      kind: 'explained',
      question: 'What bills are left?',
      presented: 'Forecast still lists these obligations before the next payday.',
    }, listTurn),
    debts,
    packet: upcomingPacket,
  }).status === 'ambiguous',
    'what about that one? after a multi-item remaining list fails closed');

  ok(TalkSession.resolveFollowup({
    question: 'What about that one?',
    priorTurn: leftoverTurn(99.99),
    debts,
    packet: leftoverPacket(12.34),
  }).status === 'resolved-reference'
    && TalkSession.resolveFollowup({
      question: 'What about that one?',
      priorTurn: leftoverTurn(99.99),
      debts,
      packet: leftoverPacket(12.34),
    }).referentKey === 'last-presented',
    'that-one without a remaining-bills ref falls through to incumbent last-presented');

  ok(TalkSession.resolveFollowup({
    question: 'What does that leave us with?',
    priorTurn: Object.assign({
      kind: 'explained',
      question: 'What bills are left?',
      presented: 'Forecast still lists these obligations before the next payday.',
    }, listTurn),
    debts,
    packet: leftoverPacket(12.34),
  }).status === 'ambiguous',
    '#309 leftover deixis is not earned by a remaining-bills presentation');
}

console.log('\n=== 4. Covered asks stay Forecast-omitted semantics; leftover/picture stay intact ===');
{
  const covered = presentRemaining(packet, 'covered');
  const liveCovered = represented(forecastListed);
  ok((liveCovered.length
        ? covered.answer.indexOf(TalkPresentation.REMAINING_BILLS_COVERED_LEAD) !== -1
        : covered.answer === TalkPresentation.REMAINING_BILLS_COVERED_EMPTY)
      && !/\bpaid\b/.test(covered.answer)
      && !/safe to spend/i.test(covered.answer),
    'covered ask reprints Forecast represented bills or Forecast-established none');
  ok(TalkSession.resolveFollowup({
    question: 'What does this payday leave us with?',
    priorTurn: null,
    debts: [],
    packet,
  }).referentKey === 'payday-leftover'
      && TalkSession.resolveFollowup({
        question: 'What does this payday look like?',
        priorTurn: null,
        debts: [],
        packet,
      }).referentKey === 'payday-picture',
    'leftover and picture exact asks are unchanged');
}

console.log('\n=== 5. Gemini cannot invent remaining amounts or settlements ===');
{
  const invented = TalkSession.parseRemainingBillsExtract({
    intent: REMAINING_INTENT,
    amount: 99999,
    settlement: 'unpaid',
  });
  ok(invented.ok === false && invented.reason === 'invented remaining bills',
    'Gemini remaining extract cannot carry an amount or settlement');
  const intentOnly = TalkSession.parseRemainingBillsExtract({
    intent: REMAINING_INTENT,
  });
  ok(intentOnly.ok === true && intentOnly.intent === REMAINING_INTENT,
    'remaining extract may name remaining-bills intent only');
  const fromIntent = TalkSession.resolvePaydayRemainingBills({
    question: 'Which bills still have to come out?',
    priorTurn: null,
    packet,
    extract: intentOnly,
  });
  const intentPresented = TalkPresentation.presentPaydayRemainingBills(fromIntent, packet);
  const liveDue = stillDue(forecastListed)[0];
  const liveDueMoney = liveDue
    ? TalkPresentation.formatCurrency(liveDue.remaining != null ? liveDue.remaining : liveDue.planned)
    : '';
  ok(fromIntent.status === 'resolved-reference'
      && intentPresented.answer.indexOf(TalkPresentation.REMAINING_BILLS_LEAD) !== -1
      && (!liveDueMoney || intentPresented.answer.indexOf(liveDueMoney) !== -1),
    'remaining intent still reads bills from the packet, not from Gemini');
  ok(TalkSession.resolvePaydayRemainingBills({
    question: 'What about that one?',
    priorTurn: null,
    packet,
    extract: {
      ok: true,
      intent: REMAINING_INTENT,
      referentKey: 'last-presented',
    },
  }).status === 'ambiguous',
    'Gemini last-presented remaining without an earned item ref fails closed');
  const parsedWrong = TalkGemini.parseTalkModelOutput(JSON.stringify({
    intent: REMAINING_INTENT,
    unpaid: ['shaw'],
  }));
  ok(parsedWrong.ok === false && parsedWrong.kind === REMAINING_INTENT,
    'remaining extract with a status field is rejected before presentation');
}

console.log('\n=== 6. Session HTTP remaining bills equal Forecast and do not call Gemini ===');
async function runHttpProof() {
  const liveDue = stillDue(forecastListed)[0];
  const liveDueMoney = liveDue
    ? TalkPresentation.formatCurrency(liveDue.remaining != null ? liveDue.remaining : liveDue.planned)
    : '';
  const mock = await startMockGemini([
    JSON.stringify({
      intent: REMAINING_INTENT,
      amount: 99999,
      settlement: 'unpaid',
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

    const first = await askJson(base, sessionA.cookie, 'What bills are coming before next payday?');
    const firstBody = await first.json();
    ok(first.status === 200
        && firstBody.answer.indexOf(TalkPresentation.REMAINING_BILLS_LEAD) !== -1
        && (!liveDueMoney || firstBody.answer.indexOf(liveDueMoney) !== -1)
        && mock.captured.length === 0,
      'coming-before-next-payday reprints Forecast remaining bills and does not call Gemini',
      firstBody && firstBody.answer);
    ok(firstBody.cards
        && firstBody.cards.items.some(item => item.body === TalkPresentation.REMAINING_BILLS_LEAD)
        && (firstBody.citations || []).some(row => row.source === 'Forecast'),
      'HTTP remaining cards and citations keep the Forecast bills');

    const listThat = await askJson(base, sessionA.cookie, 'What about that one?');
    const listThatBody = await listThat.json();
    ok(listThat.status === 200
        && listThatBody.answer === TalkPresentation.UNAVAILABLE_ANSWER
        && mock.captured.length === 0,
      'that-one after a multi-item remaining list fails closed without Gemini');

    const shaw = await askJson(base, sessionA.cookie, 'Is Shaw still due?');
    const shawBody = await shaw.json();
    const liveHasShaw = (forecastListed || []).some(row => row.id === 'shaw');
    ok(shaw.status === 200
        && mock.captured.length === 0
        && (liveHasShaw
          ? shawBody.answer.indexOf('Shaw') !== -1
          : shawBody.answer.indexOf('does not list Shaw among this payday period') !== -1)
        && !/\bunpaid\b|\blate\b|\boverdue\b/.test(shawBody.answer || ''),
      'HTTP named Shaw uses Forecast remaining membership, not a paid/unpaid invention');

    const leftover = await askJson(base, sessionA.cookie, 'What does this payday leave us with?');
    const leftoverBody = await leftover.json();
    const peb = packet.forecast && packet.forecast.predictedEndingBalance;
    const pebKnown = peb && peb.status === 'ok' && Number.isFinite(Number(peb.amount));
    const leftoverMoney = pebKnown
      ? TalkPresentation.formatCurrency(peb.amount)
      : null;
    ok(leftover.status === 200
        && (pebKnown
          ? leftoverBody.answer === `Predicted ending balance for this pay period is ${leftoverMoney}.`
          : (leftoverBody.answer === TalkPresentation.UNAVAILABLE_ANSWER
            || /Predicted ending balance is unavailable/.test(leftoverBody.answer)))
        && mock.captured.length === 0,
      '#309 leftover exact ask still reprints Forecast Predicted Ending Balance');

    const isolated = await askJson(base, sessionB.cookie, 'What about that one?');
    const isolatedBody = await isolated.json();
    ok(isolated.status === 200
        && isolatedBody.answer === TalkPresentation.UNAVAILABLE_ANSWER
        && mock.captured.length === 0,
      'session B cannot bind session A remaining-bills deixis');

    const paraphrase = await askJson(
      base,
      sessionB.cookie,
      'Which household bills still have to come out before payday?'
    );
    const paraphraseBody = await paraphrase.json();
    ok(paraphrase.status === 200
        && mock.captured.length === 1
        && paraphraseBody.answer === TalkPresentation.UNAVAILABLE_ANSWER
        && paraphraseBody.answer.indexOf('99999') === -1
        && !/\bunpaid\b/.test(paraphraseBody.answer || ''),
      'Gemini-invented remaining amount/status is rejected and unpublished');
  } finally {
    await atlas.stop();
    await mock.close();
  }
  filesUnchanged('Talk payday remaining bills');
}

runHttpProof().then(() => {
  ok(hashFile(DATA) === liveHash, 'live data.json bytes unchanged at suite end');
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
