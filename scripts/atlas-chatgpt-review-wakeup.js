'use strict';

const WAKE_MARKER = '<!-- atlas-chatgpt-review-request -->';
const RESULT_MARKER = '<!-- atlas-chatgpt-review-result -->';
const TRUSTED_REVIEWER = 'tc5v5s64ym-sketch';
const PASS_MARKER = 'Atlas Contract / Systems Review — PASS';
const BLOCKING_MARKERS = Object.freeze([
  'Atlas Contract / Systems Review — BLOCKING',
  'Atlas Contract / Systems Review — NOT PASS',
]);

const REQUIRED_CHECK_NAMES = Object.freeze([
  'test',
  'Merge card mechanical fields',
  'Which published figures moved',
  'Exactly one primary risk label',
  'Incumbent privacy guard',
]);

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function hasRequiredCard(body) {
  const text = String(body || '').replace(/<!--[\s\S]*?-->/g, '').replace(/\*/g, '');
  return /Required\s*\|\s*REQUIRED\b/i.test(text)
    || /Required\s*:\s*REQUIRED\b/i.test(text);
}

function latestByName(checks) {
  const latest = new Map();
  for (const check of Array.isArray(checks) ? checks : []) {
    const name = clean(check && check.name);
    if (!name) continue;
    const previous = latest.get(name);
    const currentTime = String(check.completed_at || check.started_at || '');
    const previousTime = String(previous && (previous.completed_at || previous.started_at) || '');
    if (!previous || currentTime >= previousTime) latest.set(name, check);
  }
  return latest;
}

function checksAreGreen(checks) {
  const latest = latestByName(checks);
  return REQUIRED_CHECK_NAMES.every((name) => {
    const check = latest.get(name);
    return check && check.status === 'completed' && check.conclusion === 'success';
  });
}

function isAtlasReview(review, headSha) {
  const login = String(review && review.user && review.user.login || '');
  const body = String(review && review.body || '').trim();
  const outcome = body.startsWith(PASS_MARKER) || BLOCKING_MARKERS.some((marker) => body.startsWith(marker));
  return login === TRUSTED_REVIEWER && String(review && review.commit_id || '').toLowerCase() === String(headSha || '').toLowerCase() && outcome;
}

function hasWakeComment(comments, headSha) {
  const needle = `exact head \`${String(headSha || '')}\``.toLowerCase();
  return (Array.isArray(comments) ? comments : []).some((comment) => (
    String(comment && comment.body || '').toLowerCase().includes(WAKE_MARKER)
    && String(comment && comment.body || '').toLowerCase().includes(needle)
  ));
}

function decide(input) {
  const pr = input && input.pr;
  const headSha = String(pr && pr.head && pr.head.sha || '').toLowerCase();
  if (!pr || pr.state !== 'open') return { ok: false, code: 'pr-not-open', reason: 'PR is not open.' };
  if (!pr.base || pr.base.ref !== 'main') return { ok: false, code: 'wrong-base', reason: 'PR does not target main.' };
  if (pr.draft === true) return { ok: false, code: 'draft', reason: 'PR is still a draft.' };
  if (!/^[0-9a-f]{40}$/.test(headSha)) return { ok: false, code: 'malformed-head', reason: 'Live PR head is not a full SHA.' };
  if (!hasRequiredCard(pr.body)) return { ok: false, code: 'not-required', reason: 'Merge Card does not say Required: REQUIRED.' };
  if (!checksAreGreen(input && input.checks)) return { ok: false, code: 'checks-not-green', reason: 'Required deterministic checks are not all green on the live head.' };
  if ((Array.isArray(input && input.reviews) ? input.reviews : []).some((review) => isAtlasReview(review, headSha))) {
    return { ok: false, code: 'already-reviewed', reason: 'An Atlas review already exists on the live exact head.' };
  }
  if (hasWakeComment(input && input.comments, headSha)) return { ok: false, code: 'wake-already-posted', reason: 'A wake-up already exists for the live exact head.' };
  return { ok: true, code: 'ready', reason: 'Stable required merge candidate has no Atlas review on the exact head.', headSha };
}

module.exports = {
  WAKE_MARKER,
  RESULT_MARKER,
  TRUSTED_REVIEWER,
  PASS_MARKER,
  BLOCKING_MARKERS,
  REQUIRED_CHECK_NAMES,
  hasRequiredCard,
  checksAreGreen,
  isAtlasReview,
  hasWakeComment,
  decide,
};
