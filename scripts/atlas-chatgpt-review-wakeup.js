'use strict';

const crypto = require('crypto');

const WAKE_MARKER = '<!-- atlas-chatgpt-review-request -->';
const RESULT_MARKER = '<!-- atlas-chatgpt-review-result -->';
const TRUSTED_REVIEWER = 'tc5v5s64ym-sketch';
const TRUSTED_WAKE_AUTHOR = 'github-actions[bot]';
const WAKEUP_CONCURRENCY_GROUP = 'atlas-chatgpt-review-wakeup';
const WAKE_ID_RE = /^[0-9a-f]{32}$/i;
const WAKE_ID_LINE_RE = /^Wake-up:\s*`([0-9a-f]{32})`\s*$/im;
const PASS_MARKER = 'Atlas Contract / Systems Review — PASS';
const BLOCKING_MARKERS = Object.freeze([
  'Atlas Contract / Systems Review — BLOCKING',
  'Atlas Contract / Systems Review — NOT PASS',
]);

const REQUIRED_CHECK_NAMES = Object.freeze([
  'test',
  'Merge card mechanical fields',
  'Which published figures moved',
]);

const REQUIRED_STATUS_CONTEXTS = Object.freeze([
  'risk-label/primary',
  'privacy-guard',
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

function latestByContext(statuses) {
  const latest = new Map();
  for (const status of Array.isArray(statuses) ? statuses : []) {
    const context = clean(status && status.context);
    if (!context) continue;
    const previous = latest.get(context);
    const currentTime = String(status.updated_at || status.created_at || '');
    const previousTime = String(previous && (previous.updated_at || previous.created_at) || '');
    if (!previous || currentTime >= previousTime) latest.set(context, status);
  }
  return latest;
}

function statusesAreGreen(statuses) {
  const latest = latestByContext(statuses);
  return REQUIRED_STATUS_CONTEXTS.every((context) => {
    const status = latest.get(context);
    return status && status.state === 'success';
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

function generateWakeId(randomBytes = crypto.randomBytes) {
  return randomBytes(16).toString('hex');
}

function extractWakeId(text) {
  const match = WAKE_ID_LINE_RE.exec(String(text || ''));
  return match && WAKE_ID_RE.test(match[1]) ? match[1].toLowerCase() : '';
}

function formatWakeComment(headSha, wakeId) {
  return [
    WAKE_MARKER,
    '',
    `ChatGPT Work: review the Atlas Contract / Systems Review for exact head \`${headSha}\`.`,
    '',
    `Wake-up: \`${wakeId}\``,
    '',
    'The ChatGPT Work task must re-fetch the live PR and follow `.github/chatgpt/atlas-contract-review.md`.',
  ].join('\n');
}

function trustedWakeInvocation(comments, headSha) {
  const needle = `exact head \`${String(headSha || '')}\``.toLowerCase();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const login = String(comment && comment.user && comment.user.login || '');
    const body = String(comment && comment.body || '');
    if (login !== TRUSTED_WAKE_AUTHOR) continue;
    if (!body.toLowerCase().includes(WAKE_MARKER)) continue;
    if (!body.toLowerCase().includes(needle)) continue;
    const id = extractWakeId(body);
    if (!id) continue;
    return {
      id,
      createdAt: String(comment.created_at || ''),
    };
  }
  return null;
}

function wakeupConcurrencyGroup() {
  // pull_request_target completions (Risk label / Incumbent privacy) set
  // workflow_run.head_sha to the default-branch commit and often omit
  // pull_requests[]. A per-SHA or per-run group would split those from
  // ordinary PR-head gate completions. One repo-wide group queues every
  // wake-up, including parallel pull_request + pull_request_target runs.
  return WAKEUP_CONCURRENCY_GROUP;
}

function eligibility(input) {
  const pr = input && input.pr;
  const headSha = String(pr && pr.head && pr.head.sha || '').toLowerCase();
  if (!pr || pr.state !== 'open') return { ok: false, code: 'pr-not-open', reason: 'PR is not open.' };
  if (!pr.base || pr.base.ref !== 'main') return { ok: false, code: 'wrong-base', reason: 'PR does not target main.' };
  if (pr.draft === true) return { ok: false, code: 'draft', reason: 'PR is still a draft.' };
  if (!/^[0-9a-f]{40}$/.test(headSha)) return { ok: false, code: 'malformed-head', reason: 'Live PR head is not a full SHA.' };
  if (!hasRequiredCard(pr.body)) return { ok: false, code: 'not-required', reason: 'Merge Card does not say Required: REQUIRED.' };
  if (!checksAreGreen(input && input.checks) || !statusesAreGreen(input && input.statuses)) {
    return { ok: false, code: 'checks-not-green', reason: 'Required deterministic checks are not all green on the live head.' };
  }
  return { ok: true, code: 'eligible', reason: 'Live PR is an open required candidate with green deterministic gates.', headSha };
}

function decide(input) {
  const base = eligibility(input);
  if (!base.ok) return base;
  const headSha = base.headSha;
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
  TRUSTED_WAKE_AUTHOR,
  WAKEUP_CONCURRENCY_GROUP,
  PASS_MARKER,
  BLOCKING_MARKERS,
  REQUIRED_CHECK_NAMES,
  REQUIRED_STATUS_CONTEXTS,
  hasRequiredCard,
  checksAreGreen,
  statusesAreGreen,
  isAtlasReview,
  hasWakeComment,
  generateWakeId,
  extractWakeId,
  formatWakeComment,
  trustedWakeInvocation,
  wakeupConcurrencyGroup,
  eligibility,
  decide,
};
