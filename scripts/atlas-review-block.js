'use strict';
/* Patch the Atlas Contract / Systems Review block in a pull-request body.
 * `node scripts/atlas-review-block.js`
 *
 * This is not a second review authority. ChatGPT remains the only reviewer who
 * may produce PASS. This helper only copies an already-validated trusted review
 * into the five merge-card fields, or marks a successfully repaired head
 * PENDING. It never infers PASS from CI, Cursor, comments, or an older SHA.
 *
 * The GitHub workflow calls it from a default-branch checkout after live PR
 * revalidation. It never talks to the network and never reads secrets.
 *
 * CLI:
 *   evaluate-review <request.json>     → JSON; exit 0 apply, 2 skip, 1 error
 *   evaluate-pending <request.json>    → JSON; exit 0 apply, 2 skip, 1 error
 *   patch <body-file> <fields.json>    → patched body on stdout; exit 0 or 1
 *   select-card-review <reviews.json> <sha>  → review id or empty
 */

const fs = require('fs');
const path = require('path');
const gate = require('./atlas-cursor-repair-gate');

const REVIEW_HEADING_RE = /^[ \t]*#{2,4}[ \t]*Atlas Contract \/ Systems Review[ \t]*$/gim;
const NEXT_HEADING_RE = /\n[ \t]*#{1,6}[ \t]+/;
const REVIEW_FIELDS = Object.freeze([
  'Required',
  'Exact reviewed head',
  'Reviewer',
  'Review outcome',
  'Findings and fix verification',
]);
const PATCH_FIELDS = Object.freeze([
  'Exact reviewed head',
  'Reviewer',
  'Review outcome',
  'Findings and fix verification',
]);
const ALLOWED_OUTCOMES = Object.freeze(['PASS', 'NOT PASS', 'BLOCKING', 'PENDING']);
const PASS_FINDINGS = 'exact-head PASS recorded from trusted Atlas Contract / Systems Review';
const PENDING_FINDINGS = 'Awaiting exact-head re-review after automated repair.';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_FINDINGS_CHARS = 280;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fieldLineRe(label, flags) {
  return new RegExp(
    `^([ \\t]*[-*][ \\t]*\\*{0,2}${escapeRegExp(label)}\\*{0,2}[ \\t]*:)[ \\t]*(.*)$`,
    flags,
  );
}

function classifyExactAtlasPrefix(body) {
  const text = String(body || '');
  if (text.startsWith(gate.ATLAS_PASS_MARKER)) {
    return { outcome: 'PASS', marker: gate.ATLAS_PASS_MARKER };
  }
  const marker = gate.ATLAS_BLOCKING_MARKERS.find((prefix) => text.startsWith(prefix));
  if (!marker) return null;
  return {
    outcome: marker === 'Atlas Contract / Systems Review — BLOCKING' ? 'BLOCKING' : 'NOT PASS',
    marker,
  };
}

function reviewLogin(review) {
  return review && review.user && review.user.login;
}

function isPullRequestReviewSource(input) {
  return input && input.source === 'pull_request_review';
}

function findReviewHeadings(body) {
  const text = String(body || '');
  const matches = [];
  const re = new RegExp(REVIEW_HEADING_RE.source, REVIEW_HEADING_RE.flags);
  let match = re.exec(text);
  while (match) {
    matches.push({ index: match.index, text: match[0], length: match[0].length });
    match = re.exec(text);
  }
  return matches;
}

function locateReviewSection(body) {
  const text = String(body == null ? '' : body);
  const headings = findReviewHeadings(text);
  if (headings.length === 0) {
    return { ok: false, code: 'missing-review-section', reason: 'PR body has no Atlas Contract / Systems Review section.' };
  }
  if (headings.length !== 1) {
    return { ok: false, code: 'duplicate-review-section', reason: 'PR body has more than one Atlas Contract / Systems Review section.' };
  }
  const heading = headings[0];
  const contentStart = heading.index + heading.length;
  const after = text.slice(contentStart);
  const next = NEXT_HEADING_RE.exec(after);
  const contentEnd = next ? contentStart + next.index : text.length;
  const section = text.slice(contentStart, contentEnd);
  return {
    ok: true,
    code: 'ok',
    heading,
    contentStart,
    contentEnd,
    section,
    body: text,
  };
}

function readFieldMatches(section, label) {
  const re = fieldLineRe(label, 'gim');
  return [...String(section || '').matchAll(re)];
}

function inspectReviewBlock(body) {
  const located = locateReviewSection(body);
  if (!located.ok) return located;
  const fields = {};
  for (const label of REVIEW_FIELDS) {
    const matches = readFieldMatches(located.section, label);
    if (matches.length === 0) {
      return { ok: false, code: 'malformed-review-section', reason: `Review block is missing "${label}".` };
    }
    if (matches.length !== 1) {
      return { ok: false, code: 'malformed-review-section', reason: `Review block has more than one "${label}" field.` };
    }
    fields[label] = matches[0][2];
  }
  return { ...located, fields };
}

function sanitizeFieldValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function summarizeReviewFindings(body, marker) {
  const rest = String(body || '').slice(String(marker || '').length);
  const collapsed = sanitizeFieldValue(rest);
  if (!collapsed) return 'See the submitted Atlas Contract / Systems Review.';
  if (collapsed.length <= MAX_FINDINGS_CHARS) return collapsed;
  return `${collapsed.slice(0, MAX_FINDINGS_CHARS - 3)}...`;
}

function assertPatchFields(fields) {
  if (!fields || typeof fields !== 'object') {
    return { ok: false, code: 'malformed-fields', reason: 'Patch fields are missing.' };
  }
  const extra = Object.keys(fields).filter((key) => !PATCH_FIELDS.includes(key) && key !== 'Required');
  if (extra.length) {
    return { ok: false, code: 'malformed-fields', reason: `Patch attempted to write non-review field(s): ${extra.join(', ')}.` };
  }
  const outcome = sanitizeFieldValue(fields['Review outcome']);
  if (!ALLOWED_OUTCOMES.includes(outcome)) {
    return { ok: false, code: 'malformed-fields', reason: `Review outcome ${outcome || '(empty)'} is not an allowed closed form.` };
  }
  if (outcome === 'PASS') {
    const findings = sanitizeFieldValue(fields['Findings and fix verification']);
    if (findings !== PASS_FINDINGS) {
      return { ok: false, code: 'pass-not-authorized', reason: 'PASS findings must be the exact trusted-review record, not inferred text.' };
    }
    if (sanitizeFieldValue(fields.Reviewer) !== 'ChatGPT') {
      return { ok: false, code: 'pass-not-authorized', reason: 'PASS must record Reviewer: ChatGPT.' };
    }
  }
  if (outcome === 'PENDING') {
    if (sanitizeFieldValue(fields['Findings and fix verification']) !== PENDING_FINDINGS) {
      return { ok: false, code: 'malformed-fields', reason: 'PENDING findings must be the exact awaiting-re-review record.' };
    }
  }
  const sha = sanitizeFieldValue(fields['Exact reviewed head']).replace(/[`]/g, '');
  if (!SHA_RE.test(sha)) {
    return { ok: false, code: 'malformed-fields', reason: 'Exact reviewed head must be a 40-character SHA.' };
  }
  return { ok: true, code: 'ok', outcome, sha: sha.toLowerCase() };
}

function patchReviewBlock(body, fields) {
  const inspected = inspectReviewBlock(body);
  if (!inspected.ok) return inspected;
  const allowed = assertPatchFields(fields);
  if (!allowed.ok) return allowed;

  let section = inspected.section;
  for (const label of PATCH_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, label)) {
      return { ok: false, code: 'malformed-fields', reason: `Patch is missing "${label}".` };
    }
    const value = sanitizeFieldValue(fields[label]);
    if (!value) {
      return { ok: false, code: 'malformed-fields', reason: `Patch value for "${label}" is empty.` };
    }
    const matches = readFieldMatches(section, label);
    if (matches.length !== 1) {
      return { ok: false, code: 'malformed-review-section', reason: `Review block cannot deterministically update "${label}".` };
    }
    const match = matches[0];
    const lineStart = match.index;
    const lineEnd = lineStart + match[0].length;
    section = `${section.slice(0, lineStart)}${match[1]} ${value}${section.slice(lineEnd)}`;
  }

  const patched = `${inspected.body.slice(0, inspected.contentStart)}${section}${inspected.body.slice(inspected.contentEnd)}`;
  return { ok: true, code: 'ok', body: patched, outcome: allowed.outcome };
}

function cardFieldsFromTrustedReview(outcome, sha, reviewBody, marker) {
  if (outcome === 'PASS') {
    return {
      'Exact reviewed head': sha,
      Reviewer: 'ChatGPT',
      'Review outcome': 'PASS',
      'Findings and fix verification': PASS_FINDINGS,
    };
  }
  return {
    'Exact reviewed head': sha,
    Reviewer: 'ChatGPT',
    'Review outcome': outcome,
    'Findings and fix verification': summarizeReviewFindings(reviewBody, marker),
  };
}

function evaluateTrustedReview(input) {
  if (!isPullRequestReviewSource(input)) {
    return {
      ok: false,
      code: 'not-pull-request-review',
      reason: 'Only a submitted pull-request review may update the Atlas review block.',
    };
  }
  if (!gate.isTrustedAtlasReviewer(input && input.reviewerLogin)) {
    return { ok: false, code: 'untrusted-reviewer', reason: 'Reviewer is not the trusted Atlas Contract / Systems Review identity.' };
  }
  if (!gate.isOpenPrTargetingMain(input && input.pr)) {
    const pr = input && input.pr;
    if (!pr || pr.state !== 'open') {
      return { ok: false, code: 'pr-not-open', reason: 'Pull request is not open.' };
    }
    return { ok: false, code: 'pr-not-targeting-main', reason: 'Pull request does not target main.' };
  }
  const classified = classifyExactAtlasPrefix(input && input.reviewBody);
  if (!classified) {
    return { ok: false, code: 'not-atlas-review-marker', reason: 'Review body is not an exact Atlas Contract / Systems Review marker.' };
  }
  const currentHead = (input.currentHeadSha || (input.pr && input.pr.head && input.pr.head.sha) || '').toLowerCase();
  if (!gate.isExactCurrentHead(input.reviewedSha, currentHead)) {
    return { ok: false, code: 'stale-head', reason: 'Reviewed SHA is not the current PR head.' };
  }
  if (!SHA_RE.test(String(currentHead))) {
    return { ok: false, code: 'malformed-head', reason: 'Current PR head is not a 40-character SHA.' };
  }
  const fields = cardFieldsFromTrustedReview(
    classified.outcome,
    currentHead,
    input.reviewBody,
    classified.marker,
  );
  return {
    ok: true,
    code: 'ok',
    outcome: classified.outcome,
    skipCursor: classified.outcome === 'PASS',
    fields,
    reason: classified.outcome === 'PASS'
      ? 'Trusted Atlas Contract / Systems Review PASS on the current head.'
      : `Trusted Atlas Contract / Systems Review ${classified.outcome} on the current head.`,
  };
}

function requiredOpens(value, token) {
  return new RegExp(`^${escapeRegExp(token)}(?:\\b|[ \\t]*[—–:.-])`, 'i').test(sanitizeFieldValue(value));
}

function evaluateRepairPending(input) {
  const pr = input && input.pr;
  if (!gate.isOpenPrTargetingMain(pr)) {
    if (!pr || pr.state !== 'open') {
      return { ok: false, code: 'pr-not-open', reason: 'Pull request is not open.' };
    }
    return { ok: false, code: 'pr-not-targeting-main', reason: 'Pull request does not target main.' };
  }
  const newHead = String(input.newHeadSha || '').toLowerCase();
  const liveHead = String(pr.head && pr.head.sha || '').toLowerCase();
  if (!SHA_RE.test(newHead) || !gate.isExactCurrentHead(newHead, liveHead)) {
    return { ok: false, code: 'head-not-confirmed', reason: 'New PR head was not confirmed after the repair push.' };
  }
  const inspected = inspectReviewBlock(input.body);
  if (!inspected.ok) return inspected;
  if (requiredOpens(inspected.fields.Required, 'NOT REQUIRED')) {
    return { ok: false, code: 'not-required-skip', reason: 'NOT REQUIRED review block is left unchanged after a non-Atlas repair.' };
  }
  if (!requiredOpens(inspected.fields.Required, 'REQUIRED')) {
    return { ok: false, code: 'malformed-review-section', reason: 'Required is not a closed REQUIRED / NOT REQUIRED form.' };
  }
  const previousHead = sanitizeFieldValue(inspected.fields['Exact reviewed head']).replace(/[`]/g, '').toLowerCase();
  if (previousHead && previousHead === newHead) {
    return { ok: false, code: 'head-not-moved', reason: 'Repair push did not produce a new head SHA.' };
  }
  return {
    ok: true,
    code: 'ok',
    outcome: 'PENDING',
    skipCursor: true,
    fields: {
      'Exact reviewed head': newHead,
      Reviewer: 'ChatGPT',
      'Review outcome': 'PENDING',
      'Findings and fix verification': PENDING_FINDINGS,
    },
    reason: 'Automated repair pushed a new head; review block waits for exact-head re-review.',
  };
}

function isAtlasCardSyncCandidate(review, currentHeadSha) {
  return gate.isTrustedAtlasReviewer(reviewLogin(review))
    && gate.isExactCurrentHead(review && review.commit_id, currentHeadSha)
    && Boolean(classifyExactAtlasPrefix(review && review.body));
}

function selectCardReview(reviews, currentHeadSha) {
  const list = Array.isArray(reviews) ? reviews.slice() : [];
  const candidates = list.filter((review) => isAtlasCardSyncCandidate(review, currentHeadSha));
  if (!candidates.length) return null;
  candidates.sort((left, right) => (
    String(left && left.submitted_at || '').localeCompare(String(right && right.submitted_at || ''))
  ));
  return candidates[candidates.length - 1];
}

function readJsonArg(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  const command = argv[2];
  if (command === 'evaluate-review') {
    const result = evaluateTrustedReview(readJsonArg(argv[3]));
    writeJson(result);
    if (result.ok) return 0;
    return result.code === 'malformed-head' ? 1 : 2;
  }
  if (command === 'evaluate-pending') {
    const request = readJsonArg(argv[3]);
    const result = evaluateRepairPending(request);
    writeJson(result);
    if (result.ok) return 0;
    if (result.code === 'missing-review-section'
      || result.code === 'duplicate-review-section'
      || result.code === 'malformed-review-section') {
      return 1;
    }
    return 2;
  }
  if (command === 'patch') {
    const body = fs.readFileSync(path.resolve(argv[3]), 'utf8');
    const fields = readJsonArg(argv[4]);
    const result = patchReviewBlock(body, fields);
    if (!result.ok) {
      process.stderr.write(`${result.reason}\n`);
      return 1;
    }
    process.stdout.write(result.body);
    return 0;
  }
  if (command === 'select-card-review') {
    const selected = selectCardReview(readJsonArg(argv[3]), argv[4]);
    if (selected && selected.id != null && selected.id !== '') {
      process.stdout.write(String(selected.id));
    }
    return 0;
  }
  process.stderr.write('usage: atlas-review-block.js evaluate-review|evaluate-pending|patch|select-card-review\n');
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  REVIEW_FIELDS,
  PATCH_FIELDS,
  PASS_FINDINGS,
  PENDING_FINDINGS,
  classifyExactAtlasPrefix,
  locateReviewSection,
  inspectReviewBlock,
  patchReviewBlock,
  evaluateTrustedReview,
  evaluateRepairPending,
  selectCardReview,
  summarizeReviewFindings,
};
