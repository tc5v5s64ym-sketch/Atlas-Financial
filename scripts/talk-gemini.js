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
  ask,
};
