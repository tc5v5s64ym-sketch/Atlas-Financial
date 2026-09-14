'use strict';
/* Talk to Atlas — household conversation shell plus session context seam.
 *
 * This file fetches only GET /talk/context (same-origin session cookie).
 * It does not call /assistant/current or /assistant/mcp, does not send a
 * Bearer or OAuth token, does not call a model, does not read Forecast,
 * and does not publish a figure. The Talk UI this slice shows is packet
 * metadata only (available / unavailable, as-of, freshness/trust already
 * on the incumbent packet). Suggested prompts stay static HTML. Send is
 * a disabled seam for a later intelligence PR.
 *
 * Future structured answer cards can mount in #talk-cards and link to
 * Budget / Bills / Credit / Planning. Do not invent those answers here.
 */

const TALK_STUB_COPY = 'Talk is not connected yet. It will not invent an answer.';
const TALK_CONTEXT_PATH = '/talk/context';
const TALK_PACKET_SCHEMA = 'atlas-assistant-packet/v1';

function talkEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function hideTalkEmpty() {
  const empty = $('talk-empty');
  if (empty) empty.hidden = true;
}

function showTalkPreview(text) {
  const thread = $('talk-thread');
  if (!thread || !text) return;
  hideTalkEmpty();
  thread.insertAdjacentHTML('beforeend', talkUserHtml(text) + talkStubHtml());
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

function setupTalkSurface() {
  const composer = $('talk-composer');
  const input = $('talk-input');
  const send = $('talk-send');
  const prompts = $('talk-prompts');

  // INTELLIGENCE SEAM — later PR. Do not enable Send, do not call a model,
  // do not fetch assistant/current or MCP, and do not invent a figure.
  if (send) {
    send.disabled = true;
    send.setAttribute('aria-disabled', 'true');
  }
  if (composer) {
    composer.addEventListener('submit', event => {
      event.preventDefault();
    });
  }
  if (prompts) {
    prompts.addEventListener('click', event => {
      const button = event.target.closest('[data-talk-prompt]');
      if (!button) return;
      const text = button.getAttribute('data-talk-prompt') || '';
      if (input) input.value = text;
      showTalkPreview(text);
    });
  }
  loadTalkContext();
}

setupTalkSurface();
App.boot();
