'use strict';
/* Talk to Atlas — household conversation shell plus one-turn Gemini explainer.
 *
 * This file fetches GET /talk/context and GET /talk/capability with the
 * same-origin session cookie, and POSTs { question } to /talk/ask when
 * the model path is available. It does not call /assistant/current or
 * /assistant/mcp, does not send a Bearer or OAuth token, does not hold
 * ATLAS_TALK_GEMINI_API_KEY, does not read Forecast, and does not publish
 * a figure of its own. Model answer text is assigned via textContent.
 *
 * Send stays disabled until capability says the model path is available.
 * When it is not, suggested prompts keep the Slice 1/2 stub. Structured
 * answer cards stay reserved in #talk-cards.
 */

const TALK_STUB_COPY = 'Talk is not connected yet. It will not invent an answer.';
const TALK_LOADING_COPY = 'Atlas is reading the current picture…';
const TALK_ERROR_COPY = 'Atlas could not answer just now. Try again, or see Budget, Bills, Credit or Planning.';
const TALK_CONTEXT_PATH = '/talk/context';
const TALK_CAPABILITY_PATH = '/talk/capability';
const TALK_ASK_PATH = '/talk/ask';
const TALK_PACKET_SCHEMA = 'atlas-assistant-packet/v1';
const TALK_QUESTION_MAX = 2000;
const TALK_SEAM_UNAVAILABLE = 'Coming soon — Talk is a place to ask. It is not a second planner and does not answer yet.';
const TALK_SEAM_AVAILABLE = 'Atlas explains the current Atlas picture. It is not a second planner.';
const TALK_SUB_UNAVAILABLE = 'Ask Atlas about this payday, bills, credit or planning. Atlas does not invent numbers. Context can connect; answers are not connected yet.';
const TALK_SUB_AVAILABLE = 'Ask Atlas about this payday, bills, credit or planning. Atlas explains the current picture. It does not invent numbers.';
const TALK_EMPTY_UNAVAILABLE = 'The live picture stays on Budget, Bills, Credit and Planning. Talk will not invent an answer. Pick a starting question — Send is not connected yet.';
const TALK_EMPTY_AVAILABLE = 'The live picture stays on Budget, Bills, Credit and Planning. Ask a question and Atlas will explain the current picture. It will not invent an answer.';

let talkModelAvailable = false;
let talkAskInFlight = false;

function talkEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function talkThread() {
  return $('talk-thread');
}

function hideTalkEmpty() {
  const empty = $('talk-empty');
  if (empty) empty.hidden = true;
}

function appendTalkBubble(role, className, text) {
  const thread = talkThread();
  if (!thread) return null;
  const article = document.createElement('article');
  article.className = 'talk-bubble ' + className;
  article.setAttribute('data-talk-role', role);
  const p = document.createElement('p');
  p.textContent = text;
  article.appendChild(p);
  thread.appendChild(article);
  return article;
}

function talkStubHtml() {
  return `<article class="talk-bubble talk-bubble-atlas" data-talk-role="atlas-stub">
      <p>${TALK_STUB_COPY}</p>
      <p class="talk-card-links">See <a href="/">Budget</a>, <a href="/bills.html">Bills</a>, <a href="/credit.html">Credit</a> or <a href="/planning.html">Planning</a>.</p>
    </article>`;
}

function talkUserHtml(text) {
  return `<article class="talk-bubble talk-bubble-household" data-talk-role="household">
      <p>${talkEscape(text)}</p>
    </article>`;
}

function showTalkPreview(text) {
  const thread = talkThread();
  if (!thread || !text) return;
  hideTalkEmpty();
  thread.insertAdjacentHTML('beforeend', talkUserHtml(text) + talkStubHtml());
}

function setTalkSendEnabled(enabled) {
  const send = $('talk-send');
  if (!send) return;
  send.disabled = !enabled;
  send.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function renderTalkModelAvailability(available) {
  talkModelAvailable = available === true;
  setTalkSendEnabled(talkModelAvailable && !talkAskInFlight);
  const seam = $('talk-seam');
  if (seam) seam.textContent = talkModelAvailable ? TALK_SEAM_AVAILABLE : TALK_SEAM_UNAVAILABLE;
  const root = typeof document !== 'undefined' ? document : null;
  const sub = root && root.querySelector('#talk .sub');
  if (sub) sub.textContent = talkModelAvailable ? TALK_SUB_AVAILABLE : TALK_SUB_UNAVAILABLE;
  const emptyCopy = root && root.querySelector('.talk-empty-copy');
  if (emptyCopy) emptyCopy.textContent = talkModelAvailable ? TALK_EMPTY_AVAILABLE : TALK_EMPTY_UNAVAILABLE;
}

function talkContextStatus(packet) {
  if (!packet || packet.schema !== TALK_PACKET_SCHEMA || !packet.metadata) {
    return { state: 'unavailable', text: 'Atlas context unavailable' };
  }
  const asOf = packet.metadata.effectiveAsOf || packet.metadata.canonicalAsOf || null;
  const freshness = packet.metadata.freshness || {};
  const trust = freshness.confidence || null;
  const parts = ['Atlas context connected'];
  if (asOf) parts.push('as of ' + asOf);
  if (trust) parts.push(trust);
  return { state: 'available', text: parts.join(' · ') };
}

function renderTalkContext(status) {
  const el = $('talk-context');
  if (!el || !status) return;
  el.textContent = status.text;
  el.dataset.talkContext = status.state;
}

async function loadTalkContext() {
  const el = $('talk-context');
  if (!el) return;
  try {
    const res = await fetch(TALK_CONTEXT_PATH, { credentials: 'same-origin' });
    if (!res.ok) {
      renderTalkContext({ state: 'unavailable', text: 'Atlas context unavailable' });
      return;
    }
    const packet = await res.json();
    renderTalkContext(talkContextStatus(packet));
  } catch {
    renderTalkContext({ state: 'unavailable', text: 'Atlas context unavailable' });
  }
}

async function loadTalkCapability() {
  try {
    const res = await fetch(TALK_CAPABILITY_PATH, { credentials: 'same-origin' });
    if (!res.ok) {
      renderTalkModelAvailability(false);
      return;
    }
    const body = await res.json();
    renderTalkModelAvailability(body && body.available === true);
  } catch {
    renderTalkModelAvailability(false);
  }
}

function normalizeComposerQuestion(raw) {
  const question = String(raw || '').trim();
  if (!question) return '';
  if (question.length > TALK_QUESTION_MAX) return question.slice(0, TALK_QUESTION_MAX);
  return question;
}

function replaceTalkLoading(node) {
  const loading = document.querySelector('[data-talk-role="atlas-loading"]');
  if (loading && loading.parentNode) loading.parentNode.removeChild(loading);
  if (node) {
    const thread = talkThread();
    if (thread) thread.appendChild(node);
  }
}

function talkAnswerNode(text) {
  const article = document.createElement('article');
  article.className = 'talk-bubble talk-bubble-atlas talk-bubble-answer';
  article.setAttribute('data-talk-role', 'atlas-answer');
  const p = document.createElement('p');
  p.textContent = text;
  article.appendChild(p);
  return article;
}

function talkErrorNode(text) {
  const article = document.createElement('article');
  article.className = 'talk-bubble talk-bubble-atlas talk-bubble-error';
  article.setAttribute('data-talk-role', 'atlas-error');
  const p = document.createElement('p');
  p.textContent = text;
  article.appendChild(p);
  return article;
}

async function askTalk(question) {
  const res = await fetch(TALK_ASK_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = new Error(body && body.error === 'talk unavailable' ? 'unavailable' : 'error');
    throw err;
  }
  if (typeof body.answer !== 'string' || !body.answer.trim()) {
    throw new Error('error');
  }
  return body.answer;
}

async function submitTalkQuestion(raw) {
  const question = normalizeComposerQuestion(raw);
  if (!question || talkAskInFlight) return;
  hideTalkEmpty();
  appendTalkBubble('household', 'talk-bubble-household', question);
  const input = $('talk-input');
  if (input) input.value = '';
  if (!talkModelAvailable) {
    const thread = talkThread();
    if (thread) thread.insertAdjacentHTML('beforeend', talkStubHtml());
    return;
  }
  talkAskInFlight = true;
  setTalkSendEnabled(false);
  appendTalkBubble('atlas-loading', 'talk-bubble-atlas talk-bubble-loading', TALK_LOADING_COPY);
  try {
    const answer = await askTalk(question);
    replaceTalkLoading(talkAnswerNode(answer));
  } catch (err) {
    if (err && err.message === 'unavailable') {
      replaceTalkLoading(null);
      const thread = talkThread();
      if (thread) thread.insertAdjacentHTML('beforeend', talkStubHtml());
    } else {
      replaceTalkLoading(talkErrorNode(TALK_ERROR_COPY));
    }
  } finally {
    talkAskInFlight = false;
    setTalkSendEnabled(talkModelAvailable);
  }
}

function setupTalkSurface() {
  const composer = $('talk-composer');
  const input = $('talk-input');
  const send = $('talk-send');
  const prompts = $('talk-prompts');

  // Fail closed: Send stays disabled until GET /talk/capability says
  // the Gemini path is available. The model secret never enters this file.
  if (send) {
    send.disabled = true;
    send.setAttribute('aria-disabled', 'true');
  }
  if (input) {
    input.setAttribute('maxlength', String(TALK_QUESTION_MAX));
  }
  if (composer) {
    composer.addEventListener('submit', event => {
      event.preventDefault();
      if (!talkModelAvailable) return;
      submitTalkQuestion(input ? input.value : '');
    });
  }
  if (prompts) {
    prompts.addEventListener('click', event => {
      const button = event.target.closest('[data-talk-prompt]');
      if (!button) return;
      const text = button.getAttribute('data-talk-prompt') || '';
      if (talkModelAvailable) {
        submitTalkQuestion(text);
      } else {
        if (input) input.value = text;
        showTalkPreview(text);
      }
    });
  }
  loadTalkContext();
  loadTalkCapability();
}

setupTalkSurface();
App.boot();
