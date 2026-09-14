'use strict';
/* Talk to Atlas — household conversation shell.
 *
 * Presentation only. This file does not call a model, does not fetch
 * /assistant/current or /assistant/mcp, does not read Forecast, and does
 * not publish a figure. Suggested prompts are static copy already in the
 * HTML. Send is a disabled seam for a later intelligence PR.
 *
 * Future structured answer cards can mount in #talk-cards and link to
 * Budget / Bills / Credit / Planning. Do not invent those answers here.
 */

const TALK_STUB_COPY = 'Talk is not connected yet. It will not invent an answer.';

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
}

setupTalkSurface();
App.boot();
