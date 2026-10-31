'use strict';
// Card-detail panel cleanup (Atlas-approved boundary): the panel leads
// with the publication's own reported balance, and the Opening/Closing
// endpoints with their remnant evidence move verbatim inside a native
// <details> labelled exactly "Balance and payment details", collapsed
// initially. Renderer-level assertions on Forecast publications built
// from the same invented fixture as test-card-period-movements.js; the
// figures below are the fixture's own published values, restated here
// only to prove placement — nothing is recomputed.
const assert = require('node:assert/strict');
const F = require('../public/forecast');
const View = require('../public/budget-card-movements');
const { fixture, copy } = require('./fixtures/card-period-movements-data');
let checks = 0;
const eq = (a, b, message) => { assert.equal(a, b, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const publish = x => F.cardPeriodMovements(x.plan, x.debts, x.asOf, x.window,
  { currentPeriodActuals: x.packet, cardPeriodBalanceEvidence: x.balanceEvidence, liveOverlay: x.overlay || null });
const fmt = { money: value => '$' + value.toFixed(2), date: value => value };
const x = fixture(), pub = publish(x), html = View.html(pub, fmt);
const panel = (markup, id) => {
  const chunks = markup.split('<section class="card-movement-panel"');
  const chunk = chunks.find(part => part.includes(`data-budget-card-panel="${id}"`));
  assert.ok(chunk, 'panel exists for ' + id);
  return chunk;
};
const leadOf = chunk => {
  const match = chunk.match(/<p class="card-movement-lead">([^<]*)<\/p>/);
  assert.ok(match, 'panel carries a lead line');
  return match[1];
};
const detailsOf = chunk => {
  const match = chunk.match(/<details class="card-movement-details">[\s\S]*?<\/details>/);
  assert.ok(match, 'panel carries the balance disclosure');
  return match[0];
};

// Lead content: the published reported balance, its as-of date and the
// manual qualification stay attached; undated evidence invents no date.
eq(leadOf(panel(html, 'travelvisa')), 'Reported balance $927.40 · Date unavailable',
  'Travel lead is its published balance with the undated state kept');
eq(leadOf(panel(html, 'mbna')), 'Reported balance $760.00 · 2026-08-08 · Manual statement observation',
  'Amazon lead keeps amount, as-of date and manual qualification');
eq(leadOf(panel(html, 'cashback')), 'Reported balance $2264.20 · Date unavailable',
  'Cash Back lead is its published balance');
// The lead is the panel's first content, ahead of the disclosure and the
// posted-activity heading.
{
  const chunk = panel(html, 'travelvisa');
  const order = [chunk.indexOf('card-movement-lead'), chunk.indexOf('card-movement-details'),
    chunk.indexOf('Posted activity')];
  ok(order[0] > -1 && order[0] < order[1] && order[1] < order[2],
    'panel order is lead, then balance disclosure, then posted activity');
}
// A genuine published zero leads as $0.00 — visible, never suppressed.
const zeroDebt = copy(x); zeroDebt.debts[2].balance = 0;
ok(leadOf(panel(View.html(publish(zeroDebt), fmt), 'tdcc')).startsWith('Reported balance $0.00'),
  'genuine zero reported balance renders visibly as $0.00 in the lead');
// A missing reported balance is never fabricated: the historical period
// publishes no current stock, so every lead shows the unavailable state
// and none of them prints an invented zero.
const historical = copy(x); historical.window = { start: '2026-07-31', end: '2026-08-13' };
const historicalHtml = View.html(publish(historical), fmt);
for (const id of ['travelvisa', 'cashback', 'tdcc', 'triangle', 'mbna']) {
  eq(leadOf(panel(historicalHtml, id)), 'Reported balance Unavailable',
    id + ' lead shows unavailable when no balance is published');
}
eq(historicalHtml.includes('Reported balance $0.00'), false,
  'no lead invents a zero for a missing balance');
// A malformed (non-numeric) reported balance is rejected the same way:
// the lead shows unavailable and the malformed amount renders nowhere.
const badBalance = copy(pub); badBalance.cards[0].reportedBalance = { amount: '927.40', date: '2026-08-20', status: 'dated' };
const badChunk = panel(View.html(badBalance, fmt), 'travelvisa');
eq(leadOf(badChunk), 'Reported balance Unavailable', 'malformed balance amount is not rendered as a figure');
eq(badChunk.includes('$927.40 · 2026-08-20'), false, 'malformed balance date/amount pair never prints');
// The disclosure: exactly one native details per panel, exact summary
// label, collapsed as rendered (no open attribute).
for (const id of ['travelvisa', 'cashback', 'tdcc', 'triangle', 'mbna']) {
  const chunk = panel(html, id);
  eq((chunk.match(/<details class="card-movement-details">/g) || []).length, 1,
    id + ' panel carries exactly one balance disclosure');
  eq(chunk.includes('<details class="card-movement-details" open'), false,
    id + ' disclosure renders collapsed');
  ok(detailsOf(chunk).startsWith('<details class="card-movement-details"><summary>Balance and payment details</summary>'),
    id + ' summary label is exactly "Balance and payment details"');
}
// Opening/Closing figures, dates and the endpoint evidence live inside
// the disclosure — verbatim — and no longer print ahead of it.
{
  const chunk = panel(html, 'travelvisa');
  const details = detailsOf(chunk);
  // The prefix check strips the lead itself: in this fixture the reported
  // balance and the closing balance are the same published $927.40, and
  // the lead is exactly where that figure belongs.
  const beforeDetails = chunk.slice(0, chunk.indexOf('<details'))
    .replace(/<p class="card-movement-lead">[^<]*<\/p>/, '');
  for (const text of ['Opening · 2026-08-14', '$820.00', 'Closing · 2026-08-20', '$927.40',
    'This dated observation does not establish both period endpoints.',
    'Provider observation · 2026-08-20']) {
    ok(details.includes(text), 'disclosure keeps verbatim: ' + text);
    eq(beforeDetails.includes(text), false,
      'nothing balance-endpoint prints before the disclosure: ' + text);
  }
}
// The reasons evidence moves verbatim into the disclosure too: a card
// whose net change is withheld keeps its qualification behind the summary.
const missingOpening = copy(x); delete missingOpening.balanceEvidence.cards[0].opening;
{
  const details = detailsOf(panel(View.html(publish(missingOpening), fmt), 'travelvisa'));
  ok(details.includes('Opening balance unavailable. Net change remains unavailable.'),
    'reason evidence prints verbatim inside the disclosure');
}
const future = copy(x); future.window = { start: '2026-08-28', end: '2026-09-10' };
{
  const details = detailsOf(panel(View.html(publish(future), fmt), 'travelvisa'));
  ok(details.includes('Future period not observed. Net change remains unavailable.'),
    'future-period qualification prints verbatim inside the disclosure');
  eq(leadOf(panel(View.html(publish(future), fmt), 'travelvisa')), 'Reported balance Unavailable',
    'future period lead never borrows the current reported balance');
}
// wire(): opening a panel resets its disclosure to collapsed before the
// sheet receives it — the sheet re-homes the same node across opens, so
// an expanded state must not survive a close/reopen cycle.
{
  const listeners = {};
  const details = { open: true };
  const fakePanel = { attrs: { 'data-budget-card-panel': 'travelvisa', 'aria-label': 'Travel activity' },
    getAttribute(key) { return this.attrs[key] ?? null; },
    querySelector(sel) { return sel.includes('card-movement-details') ? details : null; } };
  const trigger = { attrs: { 'data-budget-card-toggle': 'travelvisa' },
    getAttribute(key) { return this.attrs[key] ?? null; },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(type, fn) { listeners[type] = fn; } };
  const strip = { querySelectorAll(sel) { return sel.includes('toggle') ? [trigger] : [fakePanel]; } };
  const mount = { querySelector(sel) { return sel.includes('card-movements') ? strip : null; } };
  let openAtSheetCall = null;
  View.wire(mount, { open: () => { openAtSheetCall = details.open; } });
  listeners.click();
  eq(openAtSheetCall, false, 'disclosure is collapsed before the sheet opens the panel');
  eq(details.open, false, 'disclosure stays collapsed after the open call');
}
console.log(`PASS card panel lead: ${checks} independent assertions`);
