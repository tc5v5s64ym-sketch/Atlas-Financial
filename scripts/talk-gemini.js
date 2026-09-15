'use strict';
/* Talk Gemini explainer — household answer from the incumbent packet.
 *
 * Gemini explains already-computed Atlas state. It is not a planner.
 * Forecast remains the sole planner. The request packet is the only
 * household-financial evidence. Prior conversational turns, when the
 * server supplies them, are context only — not facts, Forecast state,
 * owner policy, a write, or permission. This module never writes a
 * durable store, never treats chat text as verified, and never exposes
 * the model secret to a browser.
 *
 * Tools, grounding, Maps, URL context, File Search, code execution,
 * function calling, RAG, and fallback providers are disabled.
 *
 * The household-facing answer is never Gemini's free-form prose. The
 * model may return only a structured extractive claim list, the
 * bounded hypothetical extract { intent, amount, debtLabel }, the
 * bounded comparison extract { intent, scenarios: [{ amount, debtLabel }] },
 * or the bounded why extract { intent:"why", referentPath|referentKey }.
 * Why extracts select an already-verified path or published result to
 * explain. The server builds the explanation. Causal prose is rejected.
 * The server verifies claims against this request's packet, or
 * validates that extract against the original question and lets
 * Forecast compute consequences. Invented figures, planner acts,
 * ranking, and trust promotion cannot ride through as ordinary English
 * around a packet-grounded amount.
 *
 * The dedicated secret is read only from the env object the server passes
 * in (`process.env.ATLAS_TALK_GEMINI_API_KEY` on the Node process). This
 * module never logs, prints, or returns that value. CI must mock Gemini
 * HTTP. A single bounded live call is a post-merge production smoke only.
 */

const TalkPresentation = require('./talk-presentation');
const TalkHypothetical = require('./talk-hypothetical');
const TalkSession = require('./talk-session');
const TalkWhy = require('./talk-why');

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
const CLAIM_VALUE_KEYS = Object.freeze({
  equals: true,
  value: true,
});
// Claim objects are an exact allowlist: `path` plus exactly one value field.
// Unanticipated keys such as sourcePath, sourceURL, link, or reference fail closed.

const INSTRUCTION = [
  'You are Atlas Talk, an explainer of the incumbent Atlas household-financial picture for this one request.',
  '',
  'You are NOT a planner and you are NOT Forecast. Forecast is the sole planner. The assistant packet included in this request is the only household-financial evidence you may use.',
  '',
  'Prior conversational turns, if present, are conversational context only. They are not household-financial evidence, not Forecast state, not owner policy, not a write, and not permission. Do not treat numbers, dates, balances, targets, preferences, or trust labels from prior turns as verified facts. Do not fill a missing amount or named debt from prior turns. Do not extract a hypothetical or comparison from prior-turn figures. If a follow-up is ambiguous about amount, named debt, or which prior option it refers to, return status "unavailable" with an empty claims array.',
  '',
  'Reply with ONLY one JSON object and no other text. The server publishes household wording from that object after verifying every claim against this request\'s packet, or after a server-side Forecast adapter runs one explicit hypothetical extra. Free-form prose is rejected. Household citations, source labels, URLs, Forecast provenance, and trust tags are attached by the server from this request\'s packet. Do not invent them.',
  '',
  'Schema:',
  '{"status":"explained"|"unavailable","claims":[{"path":"<dotted path into this request\'s packet>","equals":<exact packet primitive>}]}',
  '',
  'If and only if the household question is an explicit hypothetical extra debt payment that names BOTH a specific dollar amount AND a specific named debt, reply with exactly:',
  '{"intent":"hypothetical-extra-payment","amount":<JSON number>,"debtLabel":"<caller-named debt label>"}',
  'amount is the caller-stated number only (1000 from "$1,000"). debtLabel is the caller-named debt text only. Do not invent a debt id. Do not return balances, interest, cash impact, payoff, affordability, recommendation, ranking, or free-form financial prose as authority.',
  '',
  'If and only if the household question is an explicit comparison of two or more hypothetical extra debt payments, and EACH option names BOTH a specific dollar amount AND a specific named debt, reply with exactly:',
  '{"intent":"hypothetical-extra-payment-comparison","scenarios":[{"amount":<JSON number>,"debtLabel":"<caller-named debt label>"}, ...]}',
  'Preserve each caller amount with the debt the caller paired it to. Different amounts are allowed only when the caller stated them. Do not omit, add, or swap options. Do not invent a debt id. Do not return balances, interest, cash, ranking, a winner, a recommendation, affordability, policy, permission, or free-form financial prose as authority.',
  'If that same explicit comparison also asks which of those already-named options to prefer, or which is better for interest given the same cash, still reply with only that comparison extract. Do not return a winner, ranking, recommendation, or preference field. The server applies any authorized preference from Forecast comparison figures only.',
  '',
  'If and only if the household question asks why Atlas published an already-shown figure, bill, debt-risk picture, or last answer, reply with exactly one of:',
  '{"intent":"why"}',
  '{"intent":"why","referentPath":"<one allowlisted dotted path already in this request\'s packet>"}',
  '{"intent":"why","referentKey":"last-presented"|"next-due"|"debt-risk"|"pay-period"|"spendable-cash"|"decision-posture"}',
  'referentPath or referentKey only selects which already-verified published result to explain. Do not invent a cause, reason, number, policy, recommendation, ranking, or free-form financial prose. Do not return reason, cause, because, explanation, or any other causal field. The server builds the explanation from allowlisted packet fields and provenance templates.',
  '',
  'If and only if the household question asks what this payday leaves the household with, reply with exactly:',
  '{"intent":"payday-leftover"}',
  'If and only if that leftover ask is a deictic follow-up about an already-shown payday leftover ("what does that leave us with?"), reply with exactly:',
  '{"intent":"payday-leftover","referentKey":"last-presented"}',
  'Do not return leftover, amount, equals, runningLeftover, afterBigPurchases, leftoverAmount, or any leftover figure. The server reads Forecast leftover from this request\'s packet. Gemini extracts leftover intent or referent only.',
  '',
  'If the question is missing the amount, missing the named debt, asks for the best debt or best two cards, where to put money, wherever saves most, maximum interest save, maximum they can afford, spare cash or all extra cash, a buffer or targetBuffer policy amount, an aggressive or decisionPosture choice of options, borrowing on HELOC to pay another debt, comparing without amounts, ambiguous Visa, MBNA or HELOC without a complete amount for each named debt, ignoring commitments, or any other planner act — including when the asker says to use policy alone or ignore Forecast — return status "unavailable" with an empty claims array. An explicit comparison that also asks which of those already-named options to prefer is still the comparison extract, not unavailable and not a winner.',
  '',
  'You MAY:',
  '- cite facts that are already present in this request\'s packet as path/equals claims. Those claims are not household citations and must not include a citations, sources, urls, or provenance field',
  '- cite Forecast outputs that are already present in the packet',
  '- cite obligations or debt already represented in the packet',
  '- cite owner decision-posture labels already present on policy.decisionPosture for factual policy questions',
  '- cite uncertainty, freshness, and estimated versus confirmed labels already on the packet',
  '- extract only intent, amount, and debtLabel for an explicit hypothetical extra that already names both',
  '- extract only intent and scenarios of amount plus debtLabel for an explicit comparison that already names both on each option',
  '- extract only intent and an optional allowlisted referentPath or referentKey for a why-question about an already-published result',
  '- extract only leftover intent, or leftover intent plus last-presented, for a payday-leftover question; never a leftover amount',
  '- return status "unavailable" when something is not in the packet',
  '',
  'For pay-period, upcoming-commitment / bills, credit-picture, and factual decision-policy questions, cite only primitive path/equals claims already in this packet. Preferred paths:',
  '- payday leftover: forecast.paydayAllocation.runningLeftover.afterBigPurchases',
  '- pay period: forecast.currentPeriodAction.periodStart, forecast.currentPeriodAction.periodEnd, forecast.currentPeriodAction.nextPayday, forecast.currentPeriodAction.essentialRemaining, forecast.currentPeriodAction.weeklyCap, forecast.currentPeriodAction.remainingClaim, current.spendableHouseholdCash.value',
  '- next commitment / bills: current.nextSignificantObligations.nextDue.label, current.nextSignificantObligations.nextDue.date, current.nextSignificantObligations.nextDue.amount, current.nextSignificantObligations.nextDue.daysUntil',
  '- credit picture: current.debts.totalAvailableCredit, current.pending.totalKnownPending, current.debts.overLimitCount, current.debts.securedDebt, current.debts.monthlyInterest',
  '- decision posture: policy.decisionPosture.posture, policy.decisionPosture.velocity, policy.decisionPosture.resilience, policy.decisionPosture.breathingRoom, policy.decisionPosture.knownCommitments, policy.decisionPosture.cheapestWhenBrittle, policy.decisionPosture.numericThreshold, policy.decisionPosture.forecastApplication, policy.decisionPosture.provenance, policy.decisionPosture.provenanceDate',
  'Do not cite a whole object or array as equals. Cite at most 8 claims. If the question asks what to do, how to allocate extra cash, how much buffer, safe-to-spend, a payoff or Visa amount, or any other planner act — including when the asker says to use policy alone or ignore Forecast — return status "unavailable" with an empty claims array.',
  '',
  'You MUST NOT:',
  '- return free-form prose, markdown commentary, or any key other than status, claims, intent, amount, debtLabel, scenarios, referentPath, and referentKey',
  '- invent a cause, reason, because-clause, or other causal financial explanation',
  '- invent citations, source paths, URLs, Forecast provenance, trust labels, or account facts',
  '- return a citations, sources, urls, href, provenance, trust, or asOf field',
  '- invent a debt id, or return balances, interest, cash impact, payoff, affordability, recommendation, or ranking as authority',
  '- perform new financial calculations',
  '- invent or compute safe-to-spend, leftover, or weekly-cap figures',
  '- derive an allocation, payment, buffer amount, leftover, or Visa figure from owner policy',
  '- invent a numeric breathing-room threshold',
  '- treat owner policy as a Forecast override or a second planner',
  '- perform debt payoff math',
  '- invent affordability',
  '- create a new forecast or computed scenario; the only permitted scenario list is caller-stated amount and debtLabel pairs on the comparison extract',
  '- recommend allocations, priorities, a winner, or a new household policy',
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

function sanitizeConversation(conversation) {
  if (!Array.isArray(conversation)) return [];
  const out = [];
  for (const turn of conversation) {
    if (!turn || typeof turn !== 'object') continue;
    const question = typeof turn.question === 'string' ? turn.question.trim() : '';
    if (!question) continue;
    out.push({
      question: question.slice(0, QUESTION_MAX_LENGTH),
      presented: typeof turn.presented === 'string'
        ? turn.presented.trim().slice(0, 400)
        : '',
    });
    if (out.length >= 8) break;
  }
  return out;
}

function buildUserPrompt(question, packet, conversation) {
  const parts = [
    'Household question:',
    question,
    '',
  ];
  const turns = sanitizeConversation(conversation);
  if (turns.length) {
    parts.push(
      'Prior conversational turns (NOT household-financial evidence; NOT verified facts; NOT Forecast state; NOT owner policy):'
    );
    for (let i = 0; i < turns.length; i += 1) {
      parts.push(`${i + 1}. Household: ${turns[i].question}`);
      if (turns[i].presented) {
        parts.push(`   Atlas presentation in this session (wording only, not evidence): ${turns[i].presented}`);
      }
    }
    parts.push('');
  }
  parts.push(
    'Incumbent Atlas assistant packet (only household-financial evidence for this request):',
    JSON.stringify(packet)
  );
  return parts.join('\n');
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

function parseTalkModelOutput(text) {
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
  const comparison = TalkHypothetical.parseComparisonExtract(parsed);
  if (comparison.ok) return comparison;
  if (comparison.reason !== 'not-comparison') {
    return { ok: false, kind: 'hypothetical-comparison', reason: comparison.reason };
  }
  const why = TalkWhy.parseExtract(parsed);
  if (why.ok) return why;
  if (why.reason !== 'not-why') {
    return { ok: false, kind: 'why', reason: why.reason };
  }
  const leftover = TalkSession.parseLeftoverExtract(parsed);
  if (leftover.ok) return leftover;
  if (leftover.reason !== 'not-leftover') {
    return { ok: false, kind: TalkSession.LEFTOVER_INTENT, reason: leftover.reason };
  }
  const hyp = TalkHypothetical.parseExtract(parsed);
  if (hyp.ok) return hyp;
  if (hyp.reason !== 'not-hypothetical') {
    return { ok: false, kind: 'hypothetical', reason: hyp.reason };
  }
  return parseExtractiveObject(parsed);
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
  return parseExtractiveObject(parsed);
}

function claimValueField(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return null;
  const keys = Object.keys(claim);
  if (keys.length !== 2 || !keys.includes('path')) return null;
  const valueKey = keys[0] === 'path' ? keys[1] : keys[0];
  return CLAIM_VALUE_KEYS[valueKey] ? valueKey : null;
}

function parseExtractiveObject(parsed) {
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
    const valueKey = claimValueField(claim);
    if (!valueKey) {
      return { ok: false, reason: claim && typeof claim === 'object' && !Array.isArray(claim)
        ? 'unexpected fields'
        : 'invalid claim' };
    }
    if (typeof claim.path !== 'string' || seen.has(claim.path)) {
      return { ok: false, reason: 'invalid path' };
    }
    seen.add(claim.path);
    claims.push({ path: claim.path, equals: claim[valueKey] });
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

function presentHypotheticalExtract(extract, packet, atlas, question) {
  const result = TalkHypothetical.evaluate({
    amount: extract.amount,
    debtLabel: extract.debtLabel,
    question,
    plan: atlas && atlas.plan,
    debts: atlas && atlas.debts,
    packet,
  });
  const presented = TalkPresentation.presentHypotheticalExtra(result, packet);
  return attachSessionTurn(
    presented,
    TalkSession.sessionTurnFromHypothetical(result, presented)
  );
}

function presentComparisonExtract(extract, packet, atlas, question) {
  const result = TalkHypothetical.evaluateComparison({
    scenarios: extract.scenarios,
    question,
    plan: atlas && atlas.plan,
    debts: atlas && atlas.debts,
    packet,
  });
  const preference = TalkHypothetical.questionAsksAuthorizedPreference(question)
    ? TalkHypothetical.judgeComparisonPreference(result)
    : null;
  const presented = TalkPresentation.presentHypotheticalComparison(result, packet, preference);
  return attachSessionTurn(
    presented,
    TalkSession.sessionTurnFromComparison(result, presented)
  );
}

function attachSessionTurn(presented, sessionTurn) {
  if (!presented || typeof presented !== 'object') return presented;
  presented.sessionTurn = sessionTurn && typeof sessionTurn === 'object'
    ? sessionTurn
    : { kind: 'unavailable' };
  return presented;
}

function presentLeftoverExtract(extract, packet, question, priorTurn) {
  const resolved = TalkSession.resolvePaydayLeftover({
    question,
    priorTurn,
    extract,
  });
  if (resolved.status !== 'resolved-reference') {
    return attachSessionTurn(
      TalkPresentation.presentVerifiedClaims({ status: 'unavailable', claims: [] }, packet),
      { kind: 'unavailable' }
    );
  }
  const claims = TalkWhy.publishablePaths(resolved.paths, packet);
  const presented = TalkPresentation.presentVerifiedClaims(
    claims.length ? { status: 'explained', claims } : { status: 'unavailable', claims: [] },
    packet
  );
  return attachSessionTurn(
    presented,
    claims.length ? TalkWhy.sessionTurnFromExplained(claims) : { kind: 'unavailable' }
  );
}

function presentWhyExtract(extract, packet, question, priorTurn) {
  const result = TalkWhy.resolve({
    question,
    packet,
    priorTurn,
    extract,
  });
  return attachSessionTurn(
    TalkPresentation.presentWhyExplanation(result, packet),
    TalkWhy.sessionTurnFromWhy(result)
  );
}

async function ask({ question, packet, env, atlas, conversation, priorTurn }) {
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
    contents: buildUserPrompt(parsed.question, packet, conversation),
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
  const model = parseTalkModelOutput(text);
  if (!model.ok) {
    if (model.kind === TalkSession.LEFTOVER_INTENT) {
      return attachSessionTurn(
        TalkPresentation.presentVerifiedClaims({ status: 'unavailable', claims: [] }, packet),
        { kind: 'unavailable' }
      );
    }
    if (model.kind === 'why') {
      return attachSessionTurn(
        TalkPresentation.presentWhyExplanation({ status: 'unavailable' }, packet),
        { kind: 'unavailable' }
      );
    }
    if (model.kind === 'hypothetical-comparison') {
      return attachSessionTurn(
        TalkPresentation.presentHypotheticalComparison({ status: 'unavailable' }, packet),
        { kind: 'unavailable' }
      );
    }
    if (model.kind === 'hypothetical') {
      return attachSessionTurn(
        TalkPresentation.presentHypotheticalExtra({ status: 'unavailable' }, packet),
        { kind: 'unavailable' }
      );
    }
    throw talkAnswerUnavailable();
  }
  if (model.intent === TalkSession.LEFTOVER_INTENT) {
    const presented = presentLeftoverExtract(model, packet, parsed.question, priorTurn);
    if (!presented || typeof presented.answer !== 'string' || !presented.answer.trim()) {
      throw talkAnswerUnavailable();
    }
    return presented;
  }
  if (model.intent === TalkWhy.WHY_INTENT) {
    const presented = presentWhyExtract(model, packet, parsed.question, priorTurn);
    if (!presented || typeof presented.answer !== 'string' || !presented.answer.trim()) {
      throw talkAnswerUnavailable();
    }
    return presented;
  }
  if (TalkWhy.questionAsksWhy(parsed.question)
      && (model.intent === TalkHypothetical.COMPARISON_INTENT
        || model.intent === TalkHypothetical.HYPOTHETICAL_INTENT)) {
    return attachSessionTurn(
      TalkPresentation.presentWhyExplanation({ status: 'unavailable' }, packet),
      { kind: 'unavailable' }
    );
  }
  if (model.intent === TalkHypothetical.COMPARISON_INTENT) {
    const presented = presentComparisonExtract(model, packet, atlas, parsed.question);
    if (!presented || typeof presented.answer !== 'string' || !presented.answer.trim()) {
      throw talkAnswerUnavailable();
    }
    return presented;
  }
  if (model.intent === TalkHypothetical.HYPOTHETICAL_INTENT) {
    const presented = presentHypotheticalExtract(model, packet, atlas, parsed.question);
    if (!presented || typeof presented.answer !== 'string' || !presented.answer.trim()) {
      throw talkAnswerUnavailable();
    }
    return presented;
  }
  const published = materializeExplainerAnswer(text, packet);
  if (!published.ok) throw talkAnswerUnavailable();
  if (TalkWhy.questionAsksWhy(parsed.question)) {
    if (published.status !== 'explained' || !published.claims.length) {
      return attachSessionTurn(
        TalkPresentation.presentWhyExplanation({ status: 'unavailable' }, packet),
        { kind: 'unavailable' }
      );
    }
    const whyResult = {
      status: 'ready',
      claims: published.claims,
      paths: published.claims.map(claim => claim.path),
    };
    return attachSessionTurn(
      TalkPresentation.presentWhyExplanation(whyResult, packet),
      TalkWhy.sessionTurnFromWhy(whyResult)
    );
  }
  return attachSessionTurn(published.presentation, published.status === 'unavailable'
    ? { kind: 'unavailable' }
    : TalkWhy.sessionTurnFromExplained(published.claims));
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
  parseTalkModelOutput,
  presentVerifiedClaims: TalkPresentation.presentVerifiedClaims,
  ask,
};
