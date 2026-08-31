'use strict';
/* Generic HELOC limit-crossing date guard.
 *
 * `Forecast.projectDebts.crossings` is the sole authority for the exact day
 * the HELOC first exceeds its limit. A stored calendar day in plan narrative
 * or page/source copy is a second authority, whether that day is September,
 * October, November, or any later answer.
 *
 * This matcher therefore fails closed on any exact calendar day attached to a
 * crossing claim. It does not enumerate today's derived date.
 */

const MONTH_NAME =
  'January|February|March|April|May|June|July|August|September|' +
  'October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec';

const CALENDAR_DAY = new RegExp(
  String.raw`(?:` +
    String.raw`\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])` +
    String.raw`|\d{1,2}(?:st|nd|rd|th)?\s+\b(?:${MONTH_NAME})\b(?:\s+\d{4})?` +
    String.raw`|\b(?:${MONTH_NAME})\b\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?` +
  String.raw`)`,
  'i'
);

const CROSSING_CLAIM = /\b(?:crosses|crossing|passes its own limit)\b/gi;
const CLAIM_WINDOW = 160;

function containsCalendarDay(text) {
  CALENDAR_DAY.lastIndex = 0;
  return CALENDAR_DAY.test(String(text || ''));
}

function findCrossingDateClaims(blob) {
  const text = String(blob || '');
  const claims = [];
  const claimRe = new RegExp(CROSSING_CLAIM.source, 'gi');
  let match;
  while ((match = claimRe.exec(text))) {
    const from = Math.max(0, match.index - CLAIM_WINDOW);
    const to = Math.min(text.length, match.index + match[0].length + CLAIM_WINDOW);
    const window = text.slice(from, to);
    CALENDAR_DAY.lastIndex = 0;
    if (CALENDAR_DAY.test(window)) claims.push(window.replace(/\s+/g, ' ').trim());
  }
  return claims;
}

function storedCrossingClaims(plan) {
  const blobs = [
    ...(plan.assumptions || []),
    JSON.stringify(plan.nextDollar || {}),
    ...(plan.actions || []).map(a => `${a.why || ''} ${a.note || ''}`),
    plan.actionsNote || '',
  ];
  return blobs.flatMap(findCrossingDateClaims);
}

module.exports = {
  CALENDAR_DAY,
  containsCalendarDay,
  findCrossingDateClaims,
  storedCrossingClaims,
};
