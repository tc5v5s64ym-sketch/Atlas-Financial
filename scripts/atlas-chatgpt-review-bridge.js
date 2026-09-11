'use strict';

const wake = require('./atlas-chatgpt-review-wakeup');

const TRUSTED_REVIEWER = 'tc5v5s64ym-sketch';
const BUILDER_SOURCE_LOGINS = Object.freeze([
  'chatgpt-codex-connector[bot]',
  'chatgpt-codex-connector',
]);
const BUILDER_APP_SLUGS = Object.freeze([
  'chatgpt-codex-connector',
]);
const WORK_LOGIN_VAR = 'ATLAS_CHATGPT_WORK_LOGIN';
const RESULT_MARKER = '<!-- atlas-chatgpt-review-result -->';
const PASS_MARKER = 'Atlas Contract / Systems Review — PASS';
const BLOCKING_MARKER = 'Atlas Contract / Systems Review — BLOCKING';
const SHA_RE = /^[0-9a-f]{40}$/i;
const HEAD_LINE_RE = /^Exact reviewed head:\s*`([0-9a-f]{40})`\s*$/i;
const WAKE_LINE_RE = /^Wake-up:\s*`([0-9a-f]{32})`\s*$/i;
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
const HARD_FAIL_CODES = Object.freeze([
  'builder-source',
  'builder-app',
  'source-not-distinct',
  'malformed-result',
]);

function isBuilderSource(login) {
  return BUILDER_SOURCE_LOGINS.includes(String(login || ''));
}

function isBuilderApp(app) {
  const slug = String(app && (app.slug || app.name) || '').trim().toLowerCase();
  return BUILDER_APP_SLUGS.includes(slug);
}

function isAllowedSource(login, configuredWorkLogin) {
  const source = String(login || '');
  const configured = String(configuredWorkLogin || '').trim();
  if (!source || !configured) return false;
  if (isBuilderSource(source) || isBuilderSource(configured)) return false;
  if (source === TRUSTED_REVIEWER || configured === TRUSTED_REVIEWER) return false;
  if (source === wake.TRUSTED_WAKE_AUTHOR || configured === wake.TRUSTED_WAKE_AUTHOR) return false;
  return source === configured;
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
  if (lines.length < 4) return null;

  const headMatch = HEAD_LINE_RE.exec(lines[1]);
  const wakeMatch = WAKE_LINE_RE.exec(lines[2]);
  if (!headMatch || !wakeMatch) return null;
  const sha = headMatch[1].toLowerCase();
  const wakeId = wakeMatch[1].toLowerCase();

  if (lines[0] === PASS_MARKER) {
    if (lines.length !== 4) return null;
    const summary = closedFieldValue(lines[3], SUMMARY_PREFIX, MAX_SUMMARY_CHARS);
    if (!summary) return null;
    return { outcome: 'PASS', sha, wakeId, summary };
  }

  if (lines[0] === BLOCKING_MARKER) {
    if (lines.length !== 5) return null;
    const blocker = closedFieldValue(lines[3], BLOCKER_PREFIX, MAX_BLOCKER_CHARS);
    const proofNeeded = closedFieldValue(lines[4], PROOF_PREFIX, MAX_PROOF_CHARS);
    if (!blocker || !proofNeeded) return null;
    return { outcome: 'BLOCKING', sha, wakeId, blocker, proofNeeded };
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

function decidePublish(input) {
  const sourceLogin = String(input && input.sourceLogin || '');
  if (isBuilderSource(sourceLogin)) {
    return { ok: false, code: 'builder-source', reason: 'Shared Codex/builder connector cannot mint the trusted Atlas review.' };
  }
  if (isBuilderApp(input && input.performedViaApp)) {
    return { ok: false, code: 'builder-app', reason: 'Result was produced through the shared Codex/builder GitHub App.' };
  }
  if (!isAllowedSource(sourceLogin, input && input.configuredWorkLogin)) {
    return { ok: false, code: 'source-not-distinct', reason: 'Work-review source is missing, shared, or does not match the configured distinct identity.' };
  }

  const parsed = parseClosedReviewComment(input && input.sourceBody);
  if (!parsed) {
    return { ok: false, code: 'malformed-result', reason: 'ChatGPT Work result marker is missing or malformed.' };
  }

  const eligible = wake.eligibility(input);
  if (!eligible.ok) return eligible;
  if (parsed.sha !== eligible.headSha) {
    return { ok: false, code: 'head-mismatch', reason: 'Result SHA is not the live PR head.' };
  }

  const invocation = wake.trustedWakeInvocation(input && input.comments, eligible.headSha);
  if (!invocation) {
    return { ok: false, code: 'no-trusted-wake', reason: 'No trusted github-actions wake-up is bound to the live exact head.' };
  }
  if (parsed.wakeId !== invocation.id) {
    return { ok: false, code: 'wake-mismatch', reason: 'Result wake-up id does not match the trusted exact-head invocation.' };
  }
  const resultCreated = String(input && input.commentCreatedAt || '');
  if (resultCreated && invocation.createdAt && resultCreated < invocation.createdAt) {
    return { ok: false, code: 'result-before-wake', reason: 'Result comment predates the trusted wake-up it claims.' };
  }

  if ((Array.isArray(input && input.reviews) ? input.reviews : []).some((review) => (
    wake.isAtlasReview(review, eligible.headSha)
  ))) {
    return { ok: false, code: 'already-reviewed', reason: 'An Atlas review already exists on the live exact head.' };
  }

  return {
    ok: true,
    code: 'publish',
    reason: 'Distinct Work provenance is bound to the trusted wake-up and the live eligible head.',
    headSha: eligible.headSha,
    reviewBody: formatTrustedReview(parsed),
    outcome: parsed.outcome,
  };
}

function isHardFail(code) {
  return HARD_FAIL_CODES.includes(String(code || ''));
}

module.exports = {
  TRUSTED_REVIEWER,
  BUILDER_SOURCE_LOGINS,
  BUILDER_APP_SLUGS,
  WORK_LOGIN_VAR,
  RESULT_MARKER,
  PASS_MARKER,
  BLOCKING_MARKER,
  AUTHORITY_FILES,
  DEFAULT_BRANCH_REF_PATH,
  MAX_SUMMARY_CHARS,
  MAX_BLOCKER_CHARS,
  MAX_PROOF_CHARS,
  HARD_FAIL_CODES,
  isBuilderSource,
  isBuilderApp,
  isAllowedSource,
  isFullSha,
  isOpenMainPr,
  parseClosedReviewComment,
  formatTrustedReview,
  reviewBodyFromComment,
  claimedHead,
  decidePublish,
  isHardFail,
};
