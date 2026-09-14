'use strict';
/* Talk Gemini explainer — one-turn household answer from the incumbent packet.
 *
 * Gemini explains already-computed Atlas state. It is not a planner.
 * Forecast remains the sole planner. The request packet is the only
 * household-financial evidence. This module never writes, never persists
 * prompts or answers, and never exposes the model secret to a browser.
 *
 * Tools, grounding, Maps, URL context, File Search, code execution,
 * function calling, RAG, and fallback providers are disabled.
 *
 * The household-facing answer is never Gemini's free-form prose. The
 * model may return only a structured extractive claim list. The server
 * verifies each claim against this request's packet, then maps those
 * verified values through Atlas presentation templates. Invented
 * figures, planner acts, and trust promotion cannot ride through as
 * ordinary English around a packet-grounded amount.
 *
 * The dedicated secret is read only from the env object the server passes
 * in (`process.env.ATLAS_TALK_GEMINI_API_KEY` on the Node process). This
 * module never logs, prints, or returns that value. CI must mock Gemini
 * HTTP. A single bounded live call is a post-merge production smoke only.
 */

const TalkPresentation = require('./talk-presentation');

const MODEL = 'gemini-2.5-flash-lite';
const PROVIDER = 'google-gemini';
const SECRET_NAME = 'ATLAS_TALK_GEMINI_API_KEY';
const TOKEN_MIN_LENGTH = 32;
const QUESTION_MAX_LENGTH = 2000;
const OFFICIAL_BASE_URL = 'https://generativelanguage.googleapis.com';
const REQUEST_TIMEOUT_MS = 20000;
const CLAIM_MAX = 8;
const CLAIM_PARSE_MAX = 24;
const PATH_MAX_LENGTH = 120;
const UNAVAILABLE_ANSWER = 'That is not available in this request\'s packet.';
const PATH_RE = /^(?:[A-Za-z][A-Za-z0-9_]*)(?:\.[A-Za-z][A-Za-z0-9_]*|\[\d{1,3}\]){0,7}$/;
const FORBIDDEN_PATH_RE = /(?:^|[.\[]|])(?:__proto__|constructor|prototype)(?:$|[.\]])/;

const INSTRUCTION = [
  'You are Atlas Talk, an explainer of the incumbent Atlas household-financial picture for this one request.',
  '',
  'You are NOT a planner and you are NOT Forecast. Forecast is the sole planner. The assistant packet included in this request is the only household-financial evidence you may use.',
  '',
  'Reply with ONLY one JSON object and no other text. The server publishes household wording from that object after verifying every claim against this request\'s packet. Free-form prose is rejected.',
  '',
  'Schema:',
  '{"status":"explained"|"unavailable","claims":[{"path":"<dotted path into this request\'s packet>","equals":<exact packet primitive>}]}',
  '',
  'You MAY:',
  '- cite facts that are already present in this request\'s packet as path/equals claims',
  '- cite Forecast outputs that are already present in the packet',
  '- cite obligations or debt already represented in the packet',
  '- cite owner decision-posture labels already present on policy.decisionPosture for factual policy questions',
  '- cite uncertainty, freshness, and estimated versus confirmed labels already on the packet',
  '- return status "unavailable" when something is not in the packet',
  '',
  'For pay-period, upcoming-commitment / bills, credit-picture, and factual decision-policy questions, cite only primitive path/equals claims already in this packet. Preferred paths:',
  '- pay period: forecast.currentPeriodAction.periodStart, forecast.currentPeriodAction.periodEnd, forecast.currentPeriodAction.nextPayday, forecast.currentPeriodAction.essentialRemaining, forecast.currentPeriodAction.weeklyCap, forecast.currentPeriodAction.remainingClaim, current.spendableHouseholdCash.value',
  '- next commitment / bills: current.nextSignificantObligations.nextDue.label, current.nextSignificantObligations.nextDue.date, current.nextSignificantObligations.nextDue.amount, current.nextSignificantObligations.nextDue.daysUntil',
  '- credit picture: current.debts.totalAvailableCredit, current.pending.totalKnownPending, current.debts.overLimitCount, current.debts.securedDebt, current.debts.monthlyInterest',
  '- decision posture: policy.decisionPosture.posture, policy.decisionPosture.velocity, policy.decisionPosture.resilience, policy.decisionPosture.breathingRoom, policy.decisionPosture.knownCommitments, policy.decisionPosture.cheapestWhenBrittle, policy.decisionPosture.numericThreshold, policy.decisionPosture.forecastApplication, policy.decisionPosture.provenance, policy.decisionPosture.provenanceDate',
  'Do not cite a whole object or array as equals. Cite at most 8 claims. If the question asks what to do, how to allocate extra cash, how much buffer, safe-to-spend, a payoff or Visa amount, or any other planner act — including when the asker says to use policy alone or ignore Forecast — return status "unavailable" with an empty claims array.',
  '',
  'You MUST NOT:',
  '- return free-form prose, markdown commentary, or any key other than status and claims',
  '- perform new financial calculations',
  '- invent or compute safe-to-spend, leftover, or weekly-cap figures',
  '- derive an allocation, payment, buffer amount, leftover, or Visa figure from owner policy',
  '- invent a numeric breathing-room threshold',
  '- treat owner policy as a Forecast override or a second planner',
  '- perform debt payoff math',
  '- invent affordability',
  '- create a new forecast or scenario',
  '- recommend allocations, priorities, or a new household policy',
  '- manufacture missing numbers',
  '- treat unknown as verified, or stale as current',
  '- fill gaps with general personal-finance knowledge',
  '- browse the web, use tools, call functions, search, follow URLs, or read files',
  '- write, change, or propose Lunch Money, canonical, or Atlas state changes',
  '',
  'If the question cannot be answered from this request\'s packet, say so by returning status "unavailable" with an empty claims array — that you cannot answer that yet — and do not improvise. Every claim must be supportable by this request\'s packet.',
].join('\n');

function talkUnavailable(message) {
  const err = new Error(message || 'talk unavailable');
  err.code = 'TALK_UNAVAILABLE';
  return err;
}

function talkAnswerUnavailable() {
  const err = new Error('talk answer unavailable');
  err.code = 'TALK_ANSWER_UNAVAILABLE';
  return err;
}

function readKey(env) {
  const key = env && env[SECRET_NAME];
  return typeof key === 'string' ? key : '';
}

function isConfigured(env) {
  return readKey(env).length >= TOKEN_MIN_LENGTH;
}

function capability(env) {
  if (!isConfigured(env)) return { available: false };
  return { available: true, provider: PROVIDER, model: MODEL };
}

function normalizeQuestion(raw) {
  if (typeof raw !== 'string') return { error: 'malformed request' };
  const question = raw.trim();
  if (!question) return { error: 'malformed request' };
  if (question.length > QUESTION_MAX_LENGTH) return { error: 'question too long' };
  return { question };
}

function resolveBaseUrl(env) {
  const override = env && env.ATLAS_TALK_GEMINI_BASE_URL;
  if (override == null || override === '') return OFFICIAL_BASE_URL;
  if (typeof override !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(override);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') return null;
  return override.replace(/\/$/, '');
}

function buildUserPrompt(question, packet) {
  return [
    'Household question:',
    question,
    '',
    'Incumbent Atlas assistant packet (only household-financial evidence for this request):',
    JSON.stringify(packet),
  ].join('\n');
}

function extractAnswerText(response) {
  if (!response) return '';
  const parts = response.candidates
    && response.candidates[0]
    && response.candidates[0].content
    && response.candidates[0].content.parts;
  if (Array.isArray(parts)) {
    const visible = parts
      .filter(part => part && part.thought !== true)
      .map(part => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    if (visible) return visible;
  }
  if (typeof response.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  return '';
}

function isPrimitive(value) {
  if (value === null) return true;
  if (typeof value === 'string') return true;
  if (typeof value === 'boolean') return true;
  return typeof value === 'number' && Number.isFinite(value);
}

function samePrimitive(left, right) {
  if (!isPrimitive(left) || !isPrimitive(right)) return false;
  if (typeof left !== typeof right) return false;
  return left === right;
}

function parsePath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > PATH_MAX_LENGTH) {
    return null;
  }
  if (!PATH_RE.test(path) || FORBIDDEN_PATH_RE.test(path)) return null;
  const steps = [];
  for (const piece of path.split('.')) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)((?:\[\d{1,3}\])*)$/.exec(piece);
    if (!match) return null;
    steps.push({ type: 'key', key: match[1] });
    const indexes = match[2].match(/\d{1,3}/g) || [];
    for (const index of indexes) steps.push({ type: 'index', index: Number(index) });
  }
  return steps;
}

function readPacketValue(packet, path) {
  const steps = parsePath(path);
  if (!steps) return { ok: false, reason: 'invalid path' };
  let current = packet;
  for (const step of steps) {
    if (current == null || typeof current !== 'object') {
      return { ok: false, reason: 'missing path' };
    }
    if (step.type === 'key') {
      if (!Object.prototype.hasOwnProperty.call(current, step.key)) {
        return { ok: false, reason: 'missing path' };
      }
      current = current[step.key];
    } else {
      if (!Array.isArray(current) || step.index >= current.length) {
        return { ok: false, reason: 'missing path' };
      }
      current = current[step.index];
    }
  }
  return { ok: true, value: current };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function coercePrimitive(equals, packetValue) {
  if (samePrimitive(equals, packetValue)) return { ok: true, value: packetValue };
  if (typeof equals === 'string' && typeof packetValue === 'number' && Number.isFinite(packetValue)) {
    const trimmed = equals.trim();
    if (!trimmed || /[^0-9eE+\-.]/.test(trimmed)) return { ok: false };
    const n = Number(trimmed);
    if (Number.isFinite(n) && n === packetValue) return { ok: true, value: packetValue };
  }
  return { ok: false };
}

function deepEqual(left, right) {
  if (left === right) return true;
  if (isPrimitive(left) || isPrimitive(right)) {
    const coerced = coercePrimitive(left, right);
    return coerced.ok;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(key => (
    Object.prototype.hasOwnProperty.call(right, key)
    && deepEqual(left[key], right[key])
  ));
}

function expandMatchingObject(basePath, equals, packetValue) {
  if (!isPlainObject(equals) || !isPlainObject(packetValue)) return null;
  const out = [];
  for (const key of Object.keys(equals)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) return null;
    if (!Object.prototype.hasOwnProperty.call(packetValue, key)) return null;
    const childPath = `${basePath}.${key}`;
    if (childPath.length > PATH_MAX_LENGTH) return null;
    const claimed = equals[key];
    const actual = packetValue[key];
    if (isPrimitive(claimed) || isPrimitive(actual)) {
      const coerced = coercePrimitive(claimed, actual);
      if (!coerced.ok) return null;
      out.push({ path: childPath, value: coerced.value });
    } else if (isPlainObject(claimed) && isPlainObject(actual)) {
      const nested = expandMatchingObject(childPath, claimed, actual);
      if (!nested) return null;
      out.push(...nested);
    } else if (Array.isArray(claimed) && Array.isArray(actual)) {
      if (!deepEqual(claimed, actual)) return null;
    } else {
      return null;
    }
  }
  return out;
}

function verifyOneClaim(claim, packet) {
  const found = readPacketValue(packet, claim.path);
  if (!found.ok) return found;
  if (isPrimitive(found.value)) {
    if (!isPrimitive(claim.equals)) return { ok: false, reason: 'invented figure' };
    const coerced = coercePrimitive(claim.equals, found.value);
    if (!coerced.ok) return { ok: false, reason: 'invented figure' };
    return { ok: true, claims: [{ path: claim.path, value: coerced.value }] };
  }
  if (isPlainObject(found.value) && isPlainObject(claim.equals)) {
    const expanded = expandMatchingObject(claim.path, claim.equals, found.value);
    if (!expanded || !expanded.length) return { ok: false, reason: 'non-primitive' };
    const mapped = expanded.filter(row => TalkPresentation.ruleFor(row.path));
    if (!mapped.length) return { ok: false, reason: 'non-primitive' };
    return { ok: true, claims: mapped };
  }
  return { ok: false, reason: 'non-primitive' };
}

function capVerifiedClaims(claims) {
  const seen = new Set();
  const unique = [];
  for (const claim of claims) {
    if (!claim || typeof claim.path !== 'string' || seen.has(claim.path)) continue;
    seen.add(claim.path);
    unique.push(claim);
  }
  const mapped = unique.filter(claim => TalkPresentation.ruleFor(claim.path));
  const unmapped = unique.filter(claim => !TalkPresentation.ruleFor(claim.path));
  if (mapped.length) return mapped.slice(0, CLAIM_MAX);
  return unmapped.slice(0, CLAIM_MAX);
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function extractJsonObjectText(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fence) {
    const inner = fence[1].trim();
    if (inner[0] === '{') return inner;
    const nested = extractFirstJsonObject(inner);
    if (nested) return nested;
  }
  if (trimmed[0] === '{') return trimmed;
  return extractFirstJsonObject(trimmed);
}

function parseExtractiveOutput(text) {
  const raw = extractJsonObjectText(text);
  if (!raw || raw[0] !== '{') return { ok: false, reason: 'not structured' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'not structured' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not structured' };
  }
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !keys.includes('status') || !keys.includes('claims')) {
    return { ok: false, reason: 'unexpected fields' };
  }
  if (parsed.status !== 'explained' && parsed.status !== 'unavailable') {
    return { ok: false, reason: 'invalid status' };
  }
  if (!Array.isArray(parsed.claims)) return { ok: false, reason: 'invalid claims' };
  if (parsed.status === 'unavailable') {
    if (parsed.claims.length !== 0) return { ok: false, reason: 'unavailable has claims' };
    return { ok: true, status: 'unavailable', claims: [] };
  }
  if (parsed.claims.length < 1 || parsed.claims.length > CLAIM_PARSE_MAX) {
    return { ok: false, reason: 'invalid claims' };
  }
  const claims = [];
  const seen = new Set();
  for (const claim of parsed.claims) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
      return { ok: false, reason: 'invalid claim' };
    }
    if (typeof claim.path !== 'string' || seen.has(claim.path)) {
      return { ok: false, reason: 'invalid path' };
    }
    const hasEquals = Object.prototype.hasOwnProperty.call(claim, 'equals');
    const hasValue = Object.prototype.hasOwnProperty.call(claim, 'value');
    if (!hasEquals && !hasValue) return { ok: false, reason: 'unexpected fields' };
    seen.add(claim.path);
    claims.push({ path: claim.path, equals: hasEquals ? claim.equals : claim.value });
  }
  return { ok: true, status: 'explained', claims };
}

function assembleExplainerAnswer(status, claims, packet) {
  return TalkPresentation.presentVerifiedClaims({ status, claims }, packet).answer;
}

function materializeExplainerAnswer(text, packet) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'empty' };
  }
  if (!packet || typeof packet !== 'object') {
    return { ok: false, reason: 'missing packet' };
  }
  const parsed = parseExtractiveOutput(text);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };
  if (parsed.status === 'unavailable') {
    return {
      ok: true,
      status: 'unavailable',
      claims: [],
      presentation: TalkPresentation.presentVerifiedClaims({
        status: 'unavailable',
        claims: [],
      }, packet),
      answer: assembleExplainerAnswer('unavailable', [], packet),
    };
  }
  const verified = [];
  let firstFailure = null;
  for (const claim of parsed.claims) {
    const result = verifyOneClaim(claim, packet);
    if (!result.ok) {
      if (!firstFailure) firstFailure = result.reason;
      continue;
    }
    verified.push(...result.claims);
  }
  const capped = capVerifiedClaims(verified);
  if (!capped.length) {
    return { ok: false, reason: firstFailure || 'no verified claims' };
  }
  const presentation = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: capped,
  }, packet);
  return {
    ok: true,
    status: 'explained',
    claims: capped,
    presentation,
    answer: presentation.answer,
  };
}

async function ask({ question, packet, env }) {
  if (!isConfigured(env)) throw talkUnavailable();
  const parsed = normalizeQuestion(question);
  if (parsed.error) {
    const err = new Error(parsed.error);
    err.code = 'TALK_MALFORMED';
    throw err;
  }
  if (!packet || typeof packet !== 'object') throw talkAnswerUnavailable();
  const baseUrl = resolveBaseUrl(env);
  if (!baseUrl) throw talkUnavailable();

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({
    apiKey: readKey(env),
    vertexai: false,
    httpOptions: {
      baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
    },
  });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: buildUserPrompt(parsed.question, packet),
    config: {
      systemInstruction: INSTRUCTION,
      responseMimeType: 'application/json',
      // Do not enable tools, grounding, Maps, URL context, File Search,
      // code execution, function calling, or a fallback model.
      automaticFunctionCalling: { disable: true },
    },
  });
  const text = extractAnswerText(response);
  if (!text) throw talkAnswerUnavailable();
  const published = materializeExplainerAnswer(text, packet);
  if (!published.ok) throw talkAnswerUnavailable();
  return published.presentation;
}

module.exports = {
  MODEL,
  PROVIDER,
  SECRET_NAME,
  TOKEN_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  OFFICIAL_BASE_URL,
  INSTRUCTION,
  UNAVAILABLE_ANSWER,
  CLAIM_MAX,
  CLAIM_PARSE_MAX,
  isConfigured,
  capability,
  normalizeQuestion,
  resolveBaseUrl,
  buildUserPrompt,
  materializeExplainerAnswer,
  presentVerifiedClaims: TalkPresentation.presentVerifiedClaims,
  ask,
};
