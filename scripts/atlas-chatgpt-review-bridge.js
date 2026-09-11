'use strict';

const TRUSTED_REVIEWER = 'tc5v5s64ym-sketch';
const SOURCE_LOGINS = Object.freeze([
  'chatgpt-codex-connector[bot]',
  'chatgpt-codex-connector',
]);
const RESULT_MARKER = '<!-- atlas-chatgpt-review-result -->';
const PASS_MARKER = 'Atlas Contract / Systems Review — PASS';
const BLOCKING_MARKER = 'Atlas Contract / Systems Review — BLOCKING';
const SHA_RE = /^[0-9a-f]{40}$/i;

function isAllowedSource(login) {
  return SOURCE_LOGINS.includes(String(login || ''));
}

function isFullSha(value) {
  return SHA_RE.test(String(value || '').trim());
}

function isOpenMainPr(pr) {
  return Boolean(
    pr
    && pr.state === 'open'
    && pr.draft !== true
    && pr.base
    && pr.base.ref === 'main'
    && pr.head
    && isFullSha(pr.head.sha)
    && pr.head.ref,
  );
}

function reviewBodyFromComment(body) {
  const text = String(body || '').replace(/\r/g, '').trim();
  if (!text.startsWith(RESULT_MARKER)) return '';
  const review = text.slice(RESULT_MARKER.length).trim();
  if (!review.startsWith(PASS_MARKER) && !review.startsWith(BLOCKING_MARKER)) return '';
  return review;
}

function claimedHead(reviewBody) {
  const match = /(?:^|\n)Exact reviewed head:\s*`([0-9a-f]{40})`\s*(?:\n|$)/i.exec(String(reviewBody || ''));
  return match ? match[1].toLowerCase() : '';
}

module.exports = {
  TRUSTED_REVIEWER,
  SOURCE_LOGINS,
  RESULT_MARKER,
  PASS_MARKER,
  BLOCKING_MARKER,
  isAllowedSource,
  isFullSha,
  isOpenMainPr,
  reviewBodyFromComment,
  claimedHead,
};
