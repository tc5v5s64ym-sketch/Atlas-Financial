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
const HEAD_LINE_RE = /^Exact reviewed head:\s*`([0-9a-f]{40})`\s*$/i;
const SUMMARY_PREFIX = 'Summary:';
const BLOCKER_PREFIX = 'Blocker:';
const PROOF_PREFIX = 'Proof needed:';
const MAX_SUMMARY_CHARS = 200;
const MAX_BLOCKER_CHARS = 800;
const MAX_PROOF_CHARS = 800;
const DEFAULT_BRANCH_REF_PATH = '/repos/tc5v5s64ym-sketch/Atlas-Financial/git/ref/heads/main';
const AUTHORITY_FILES = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  'ARCHITECTURE.md',
  'docs/ACCOUNT_FACTS.md',
  'docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md',
  'BACKLOG.md',
]);

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

function hasForbiddenMarkup(text) {
  return /<!--/.test(String(text || '')) || /-->/.test(String(text || ''));
}

function hasControlCharacters(text) {
  // eslint-disable-next-line no-control-regex
  return /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/.test(String(text || ''));
}

function closedFieldValue(line, prefix, maxChars) {
  if (!String(line || '').startsWith(prefix)) return '';
  const value = String(line).slice(prefix.length).trim();
  if (!value || value.length > maxChars) return '';
  if (hasForbiddenMarkup(value) || hasControlCharacters(value) || /```/.test(value)) return '';
  return value;
}

function parseClosedReviewComment(body) {
  const text = String(body || '').replace(/\r/g, '').trim();
  if (!text.startsWith(RESULT_MARKER)) return null;
  const review = text.slice(RESULT_MARKER.length).trim();
  if (!review || hasForbiddenMarkup(review)) return null;

  const lines = review.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return null;

  const headMatch = HEAD_LINE_RE.exec(lines[1]);
  if (!headMatch) return null;
  const sha = headMatch[1].toLowerCase();

  if (lines[0] === PASS_MARKER) {
    if (lines.length !== 3) return null;
    const summary = closedFieldValue(lines[2], SUMMARY_PREFIX, MAX_SUMMARY_CHARS);
    if (!summary) return null;
    return { outcome: 'PASS', sha, summary };
  }

  if (lines[0] === BLOCKING_MARKER) {
    if (lines.length !== 4) return null;
    const blocker = closedFieldValue(lines[2], BLOCKER_PREFIX, MAX_BLOCKER_CHARS);
    const proofNeeded = closedFieldValue(lines[3], PROOF_PREFIX, MAX_PROOF_CHARS);
    if (!blocker || !proofNeeded) return null;
    return { outcome: 'BLOCKING', sha, blocker, proofNeeded };
  }

  return null;
}

function formatTrustedReview(parsed) {
  if (!parsed) return '';
  if (parsed.outcome === 'PASS') {
    return [
      PASS_MARKER,
      `Exact reviewed head: \`${parsed.sha}\``,
      `Summary: ${parsed.summary}`,
    ].join('\n');
  }
  return [
    BLOCKING_MARKER,
    `Exact reviewed head: \`${parsed.sha}\``,
    `Blocker: ${parsed.blocker}`,
    `Proof needed: ${parsed.proofNeeded}`,
  ].join('\n');
}

function reviewBodyFromComment(body) {
  return formatTrustedReview(parseClosedReviewComment(body));
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
  AUTHORITY_FILES,
  DEFAULT_BRANCH_REF_PATH,
  MAX_SUMMARY_CHARS,
  MAX_BLOCKER_CHARS,
  MAX_PROOF_CHARS,
  isAllowedSource,
  isFullSha,
  isOpenMainPr,
  parseClosedReviewComment,
  formatTrustedReview,
  reviewBodyFromComment,
  claimedHead,
};
