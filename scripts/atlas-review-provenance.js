'use strict';
/* Mechanical provenance validation for Atlas Contract / Systems Review PASS.
 * `node scripts/atlas-review-provenance.js` (no CLI; required as a module)
 *
 * A Merge Card saying PASS is not enough by itself. For a REQUIRED Systems
 * Review, a PASS is merge-authorizing only when the current exact head has
 * one mechanically valid provenance path:
 *
 *   Path A — direct trusted review: a submitted GitHub pull-request review
 *   from the trusted Atlas reviewer identity, carrying an exact
 *   machine-readable verdict (ATLAS_SYSTEMS_REVIEW_V1) or a preserved
 *   historical marker, whose reviewed SHA / commit_id equals the live PR
 *   head. Latest valid verdict on that exact head wins (submitted_at order,
 *   review ID tie-break).
 *
 *   Path B — owner-authorized transcription fallback: exactly one
 *   ATLAS_SYSTEMS_REVIEW_TRANSCRIPT_V1 block inside the PR body's Atlas
 *   Contract / Systems Review section, in the fixed closed form, whose SHA
 *   equals the live PR head and whose fields exactly agree with the Merge
 *   Card. This path exists only when ChatGPT completed the review but its
 *   normal GitHub PR-review write could not durably record the verdict. It
 *   is NOT a second review: nobody may infer PASS from it.
 *
 * An issue-comment PASS is never direct provenance: only a submitted
 * pull-request review carries a GitHub commit_id that binds natively to the
 * PR head.
 *
 * HONEST LIMITATION: the fallback mechanically proves internal consistency,
 * current-head binding, closed format, and absence of contradiction. It
 * cannot cryptographically prove that the human/agent transcription
 * originated from ChatGPT. It is an owner-authorized clerical attestation,
 * not a second reviewer.
 *
 * Pure: no network, no secrets. Loaded from the trusted default-branch
 * checkout by merge-card-check; unit-tested directly.
 */

const gate = require('./atlas-cursor-repair-gate');
const block = require('./atlas-review-block');

const TRANSCRIPT_HEADER = 'ATLAS_SYSTEMS_REVIEW_TRANSCRIPT_V1';
const TRANSCRIPT_KEYS = Object.freeze(['head', 'mode', 'reviewer', 'verdict']);
const TRANSCRIPT_MODE = 'owner-authorized-transcription';
const TRANSCRIPT_REVIEWER = 'ChatGPT';
const MERGE_VERDICTS = Object.freeze(['PASS', 'BLOCKING', 'NOT PASS']);
const SHA_RE = /^[0-9a-f]{40}$/;

function normalizeSha(value) {
  return String(value == null ? '' : value).replace(/[`\s]/g, '').toLowerCase();
}

function fail(code, message) {
  return { ok: false, code, message: String(message) };
}

/* Is the provenance gate applicable to this card? Only REQUIRED cards that
 * claim PASS. NOT REQUIRED, PENDING, BLOCKING, and NOT PASS keep their
 * incumbent documentary behavior. */
function provenanceGateApplies(card) {
  const required = /^REQUIRED(?:\b|[ \t]*[—–:.-])/i.test(String((card && card.Required) || ''));
  const outcome = String((card && card['Review outcome']) || '');
  const pass = /^PASS(?:\b|[ \t]*[—–:.-])/i.test(outcome);
  return required && pass;
}

/* ---- Path A: direct trusted PR reviews -------------------------------- */

function isSubmittedReview(review) {
  return Boolean(review)
    && typeof review === 'object'
    && String(review.state || '').toUpperCase() !== 'PENDING';
}

/* Trusted verdicts bound to the exact current head, oldest first. Only
 * submitted pull-request reviews qualify: the API review list is the source,
 * and every candidate must carry a commit_id equal to the live head. */
function directVerdictsOnHead(reviews, currentHead) {
  const head = normalizeSha(currentHead);
  const verdicts = [];
  const list = Array.isArray(reviews) ? reviews : [];
  for (const review of list) {
    if (!isSubmittedReview(review)) continue;
    if (!gate.isTrustedAtlasReviewer(review.user && review.user.login)) continue;
    const classified = block.classifyAtlasVerdict(review.body);
    if (!classified) continue;
    if (!MERGE_VERDICTS.includes(classified.outcome)) continue;
    if (normalizeSha(review.commit_id) !== head) continue;
    if (classified.format === 'machine-v1' && classified.head !== head) continue;
    verdicts.push({
      verdict: classified.outcome,
      id: review.id,
      submittedAt: String(review.submitted_at || ''),
    });
  }
  verdicts.sort((left, right) => {
    if (left.submittedAt < right.submittedAt) return -1;
    if (left.submittedAt > right.submittedAt) return 1;
    return Number(left.id || 0) - Number(right.id || 0);
  });
  return verdicts;
}

/* ---- Path B: owner-authorized transcription fallback -------------------- */

function transcriptHeaderIndexes(lines) {
  const indexes = [];
  lines.forEach((line, index) => {
    if (String(line).trim() === TRANSCRIPT_HEADER) indexes.push(index);
  });
  return indexes;
}

function parseTranscriptAt(lines, startIndex) {
  const fields = {};
  let index = startIndex + 1;
  for (; index < lines.length; index += 1) {
    const line = String(lines[index]);
    if (!line.trim()) break;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)[ \t]*:[ \t]*(\S(?:.*\S)?)[ \t]*$/.exec(line);
    if (!match) break;
    const key = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      return fail(
        'malformed-transcript',
        'Systems Review transcript rejected: duplicate field inside the transcript block. Keep exactly one of each closed field.',
      );
    }
    fields[key] = match[2];
  }
  const keys = Object.keys(fields).sort();
  if (JSON.stringify(keys) !== JSON.stringify(TRANSCRIPT_KEYS)) {
    return fail(
      'malformed-transcript',
      'Systems Review transcript rejected: transcript block must contain exactly reviewer, verdict, head, mode and nothing else.',
    );
  }
  if (fields.reviewer !== TRANSCRIPT_REVIEWER) {
    return fail(
      'malformed-transcript',
      'Systems Review transcript rejected: reviewer must be exactly ChatGPT.',
    );
  }
  if (!MERGE_VERDICTS.includes(fields.verdict)) {
    return fail(
      'malformed-transcript',
      'Systems Review transcript rejected: verdict must be a closed PASS / BLOCKING / NOT PASS value.',
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(fields.head || '')) {
    return fail(
      'malformed-transcript-sha',
      'Systems Review transcript rejected: head must be a 40-character SHA.',
    );
  }
  if (fields.mode !== TRANSCRIPT_MODE) {
    return fail(
      'malformed-transcript',
      'Systems Review transcript rejected: mode must be exactly owner-authorized-transcription.',
    );
  }
  return {
    ok: true,
    reviewer: fields.reviewer,
    verdict: fields.verdict,
    head: String(fields.head).toLowerCase(),
  };
}

function validateTranscriptPath({ body, card, currentHead }) {
  const head = normalizeSha(currentHead);
  const located = block.locateReviewSection(body);
  if (!located.ok) {
    return fail(
      'no-provenance',
      'Systems Review PASS rejected: no trusted current-head PR review or valid transcription exists.',
    );
  }
  const lines = String(located.section).split(/\r?\n/);
  const starts = transcriptHeaderIndexes(lines);
  if (starts.length === 0) {
    return fail(
      'no-provenance',
      'Systems Review PASS rejected: no trusted current-head PR review or valid transcription exists.',
    );
  }
  if (starts.length > 1) {
    return fail(
      'duplicate-transcript',
      'Systems Review transcript rejected: duplicate transcript blocks found. Keep exactly one transcript for the current head.',
    );
  }
  const parsed = parseTranscriptAt(lines, starts[0]);
  if (!parsed.ok) return parsed;
  if (parsed.head !== head) {
    return fail(
      'transcript-stale-head',
      'Systems Review transcript rejected: transcript head does not equal current PR head. Request a fresh exact-head ChatGPT review.',
    );
  }
  if (parsed.verdict !== 'PASS') {
    return fail(
      'transcript-not-pass',
      'Systems Review transcript rejected: transcript verdict is not PASS.',
    );
  }
  const fields = card || {};
  const cardOutcome = String(fields['Review outcome'] || '').trim();
  const cardReviewer = String(fields['Reviewer'] || '').trim();
  const cardHead = normalizeSha(fields['Exact reviewed head']);
  if (cardOutcome !== parsed.verdict) {
    return fail(
      'transcript-card-verdict-mismatch',
      'Systems Review transcript rejected: Merge Card verdict does not match transcript verdict.',
    );
  }
  if (cardReviewer !== parsed.reviewer) {
    return fail(
      'transcript-card-reviewer-mismatch',
      'Systems Review transcript rejected: Merge Card reviewer does not match transcript reviewer.',
    );
  }
  if (cardHead !== parsed.head) {
    return fail(
      'transcript-card-head-mismatch',
      'Systems Review transcript rejected: Merge Card reviewed head does not match transcript head.',
    );
  }
  return {
    ok: true,
    code: 'ok',
    path: 'transcript',
    message: 'Systems Review PASS provenance validated via owner-authorized transcription on the current exact head.',
  };
}

/* ---- Main entry --------------------------------------------------------- */

function validateProvenance(input) {
  const pr = (input && input.pr) || {};
  const head = normalizeSha(pr.headSha);
  if (!SHA_RE.test(head)) {
    return fail(
      'malformed-head',
      'Systems Review PASS rejected: current PR head is not a 40-character SHA. Request a fresh exact-head ChatGPT review.',
    );
  }
  if (!pr || pr.state !== 'open' || pr.merged === true) {
    return fail('pr-not-open', 'Systems Review PASS rejected: pull request is not open.');
  }
  if (pr.baseRef !== 'main') {
    return fail('pr-not-targeting-main', 'Systems Review PASS rejected: pull request does not target main.');
  }

  // Path A: latest valid trusted direct verdict on the exact head wins.
  const direct = directVerdictsOnHead(input && input.reviews, head);
  if (direct.length > 0) {
    const latest = direct[direct.length - 1];
    if (latest.verdict === 'PASS') {
      return {
        ok: true,
        code: 'ok',
        path: 'direct',
        reviewId: latest.id,
        message: 'Systems Review PASS provenance validated: trusted direct PR review on the current exact head.',
      };
    }
    if (latest.verdict === 'BLOCKING') {
      return fail(
        'direct-blocking',
        'Systems Review PASS rejected: a later trusted BLOCKING verdict exists on this exact head.',
      );
    }
    return fail(
      'direct-not-pass',
      'Systems Review PASS rejected: the latest trusted Systems Review verdict on this exact head is not PASS.',
    );
  }

  // Path B: no exact-head direct verdict exists, so no direct record can be
  // contradicted. A transcript never overrides a direct trusted verdict.
  return validateTranscriptPath({ body: input && input.body, card: input && input.card, currentHead: head });
}

module.exports = {
  TRANSCRIPT_HEADER,
  TRANSCRIPT_MODE,
  provenanceGateApplies,
  directVerdictsOnHead,
  validateTranscriptPath,
  validateProvenance,
};
