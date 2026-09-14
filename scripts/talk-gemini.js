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
 * Model output is fail-closed on a deterministic server-side contract
 * before it becomes a household-facing answer. The instruction prompt
 * is not the only Forecast-authority control: invented figures, payoff
 * math, and allocation recommendations are rejected even when Gemini
 * ignored the prompt.
 *
 * The dedicated secret is read only from the env object the server passes
 * in (`process.env.ATLAS_TALK_GEMINI_API_KEY` on the Node process). This
 * module never logs, prints, or returns that value. CI must mock Gemini
 * HTTP. A single bounded live call is a post-merge production smoke only.
 */

const MODEL = 'gemini-2.5-flash-lite';
const PROVIDER = 'google-gemini';
const SECRET_NAME = 'ATLAS_TALK_GEMINI_API_KEY';
const TOKEN_MIN_LENGTH = 32;
const QUESTION_MAX_LENGTH = 2000;
const OFFICIAL_BASE_URL = 'https://generativelanguage.googleapis.com';
const REQUEST_TIMEOUT_MS = 20000;

const INSTRUCTION = [
  'You are Atlas Talk, an explainer of the incumbent Atlas household-financial picture for this one request.',
  '',
  'You are NOT a planner and you are NOT Forecast. Forecast is the sole planner. The assistant packet included in this request is the only household-financial evidence you may use.',
  '',
  'You MAY:',
  '- summarize or explain facts that are already present in this request\'s packet',
  '- explain Forecast outputs that are already present in the packet',
  '- explain obligations or debt already represented in the packet',
  '- describe uncertainty, freshness, and estimated versus confirmed labels already on the packet',
  '- say when something is unavailable in the packet',
  '',
  'You MUST NOT:',
  '- perform new financial calculations',
  '- invent or compute safe-to-spend, leftover, or weekly-cap figures',
  '- perform debt payoff math',
  '- invent affordability',
  '- create a new forecast or scenario',
  '- recommend allocations, priorities, or household policy',
  '- manufacture missing numbers',
  '- treat unknown as verified, or stale as current',
  '- fill gaps with general personal-finance knowledge',
  '- browse the web, use tools, call functions, search, follow URLs, or read files',
  '- write, change, or propose Lunch Money, canonical, or Atlas state changes',
  '',
  'If the question cannot be answered from this request\'s packet, say so in plain language — that you cannot answer that yet — and do not improvise. Every substantive claim must be supportable by this request\'s packet.',
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
  if (typeof response.text === 'string' && response.text.trim()) {
    return response.text.trim();
  }
  const parts = response.candidates
    && response.candidates[0]
    && response.candidates[0].content
    && response.candidates[0].content.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map(part => (part && typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

const CURRENCY_AMOUNT_RE = /(?:CAD|USD|C\$|\$)\s*-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gi;
const LABELED_FIGURE_RE = /(?:safe[\s-]?to[\s-]?spend|leftover|weekly[\s-]?cap|headroom)\s*(?:is|of|at|:)?\s*\$?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)/gi;
const CURRENCY_ARITHMETIC_RE = /\$\s*-?[\d,]+(?:\.\d{1,2})?\s*[\+\-\*x×÷\/]|[\+\-\*x×÷\/]\s*\$\s*-?[\d,]+(?:\.\d{1,2})?|\bequals\s+\$/i;

const PLANNER_FORBIDDEN = [
  { re: /\byou should\b/i, reason: 'recommendation' },
  { re: /\b(?:I|we) recommend\b/i, reason: 'recommendation' },
  { re: /\brecommend(?:s|ed|ing)? that you\b/i, reason: 'recommendation' },
  { re: /\ballocate\b/i, reason: 'allocation' },
  { re: /\ballocating\b/i, reason: 'allocation' },
  { re: /\bprioriti[sz]e\b/i, reason: 'priority recommendation' },
  { re: /\byou (?:can |could )?afford\b/i, reason: 'invented affordability' },
  { re: /\bpay(?:ing)? off\b.{0,80}\b(?:in|within)\s+\d+/i, reason: 'payoff math' },
  { re: /\bin\s+\d+\s+(?:months?|years?|weeks?)\b.{0,80}\bpay(?:ing)? off\b/i, reason: 'payoff math' },
  { re: /\bif you (?:pay|put|add|contribute)\b/i, reason: 'payoff math' },
  { re: /\bextra (?:per (?:month|week|payday)|payment|toward)\b/i, reason: 'payoff math' },
  { re: /\bmonths? to (?:pay(?:off)?|clear|zero)\b/i, reason: 'payoff math' },
  { re: /\b(?:new|another|alternate|alternative) (?:forecast|scenario|plan)\b/i, reason: 'new forecast' },
  { re: /\bunknown (?:is|as) verified\b/i, reason: 'trust promotion' },
  { re: /\bestimated (?:is|as) verified\b/i, reason: 'trust promotion' },
  { re: /\bstale (?:is|as) current\b/i, reason: 'trust promotion' },
];

function parseAmountToCents(raw) {
  const cleaned = String(raw == null ? '' : raw).replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function collectPacketMoneyCents(packet) {
  const cents = new Set();
  function add(value) {
    const parsed = parseAmountToCents(value);
    if (parsed != null) cents.add(parsed);
  }
  function walk(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      cents.add(Math.round(value * 100));
      return;
    }
    if (typeof value === 'string') {
      CURRENCY_AMOUNT_RE.lastIndex = 0;
      const matches = value.match(CURRENCY_AMOUNT_RE) || [];
      for (const match of matches) add(match);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  }
  walk(packet);
  return cents;
}

function claimedAnswerCents(text) {
  const cents = [];
  const seen = new Set();
  function push(raw) {
    const parsed = parseAmountToCents(raw);
    if (parsed == null || seen.has(parsed)) return;
    seen.add(parsed);
    cents.push(parsed);
  }
  CURRENCY_AMOUNT_RE.lastIndex = 0;
  const currency = String(text || '').match(CURRENCY_AMOUNT_RE) || [];
  for (const match of currency) push(match);
  LABELED_FIGURE_RE.lastIndex = 0;
  let labeled;
  while ((labeled = LABELED_FIGURE_RE.exec(text || '')) !== null) {
    push(labeled[1]);
  }
  return cents;
}

function guardExplainerAnswer(text, packet) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, reason: 'empty' };
  }
  if (!packet || typeof packet !== 'object') {
    return { ok: false, reason: 'missing packet' };
  }
  for (const rule of PLANNER_FORBIDDEN) {
    if (rule.re.test(text)) return { ok: false, reason: rule.reason };
  }
  if (CURRENCY_ARITHMETIC_RE.test(text)) {
    return { ok: false, reason: 'new calculation' };
  }
  const allowed = collectPacketMoneyCents(packet);
  for (const cents of claimedAnswerCents(text)) {
    if (!allowed.has(cents)) return { ok: false, reason: 'invented figure' };
  }
  return { ok: true };
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
      // Do not enable tools, grounding, Maps, URL context, File Search,
      // code execution, function calling, or a fallback model.
      automaticFunctionCalling: { disable: true },
    },
  });
  const text = extractAnswerText(response);
  if (!text) throw talkAnswerUnavailable();
  if (!guardExplainerAnswer(text, packet).ok) throw talkAnswerUnavailable();
  return text;
}

module.exports = {
  MODEL,
  PROVIDER,
  SECRET_NAME,
  TOKEN_MIN_LENGTH,
  QUESTION_MAX_LENGTH,
  OFFICIAL_BASE_URL,
  INSTRUCTION,
  isConfigured,
  capability,
  normalizeQuestion,
  resolveBaseUrl,
  buildUserPrompt,
  guardExplainerAnswer,
  ask,
};
