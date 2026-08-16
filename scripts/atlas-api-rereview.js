'use strict';

const fs = require('fs');

const SHA_RE = /^[0-9a-f]{40}$/i;
const HANDOFF_MARKER = 'Atlas re-review requested.';
const PASS_MARKER = 'Atlas Contract / Systems Review — PASS';
const NOT_PASS_MARKER = 'Atlas Contract / Systems Review — NOT PASS';
const BLOCKING_MARKER = 'Atlas Contract / Systems Review — BLOCKING';
const TRUSTED_REVIEWER = 'tc5v5s64ym-sketch';
// Live Cursor Automation reviews on this repository use GitHub login
// `cursor`. The REST/App form of the same identity is `cursor[bot]`.
// Accept only those two exact logins; do not match prefixes or other users.
const CURSOR_HANDOFF_LOGINS = Object.freeze(['cursor', 'cursor[bot]']);

function clean(value) {
  return String(value == null ? '' : value).replace(/\r/g, '').trim();
}

function parseMarkdownSha(body, label) {
  const text = String(body || '');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}[^\\n]*?\\x60([0-9a-f]{40})\\x60`, 'i');
  const match = re.exec(text);
  return match ? match[1].toLowerCase() : '';
}

function isCursorHandoffReviewer(login) {
  return CURSOR_HANDOFF_LOGINS.includes(String(login || ''));
}

function evaluateDispatchHandoff(input) {
  const login = input && input.login != null ? String(input.login) : '';
  const body = input && input.body != null ? String(input.body) : '';
  if (!isCursorHandoffReviewer(login)) {
    return {
      ok: false,
      action: 'skip',
      code: 'not-cursor-reviewer',
      reason: 'Reviewer is not the Cursor Automation identity used by this repository.',
    };
  }
  if (!body.includes(HANDOFF_MARKER)) {
    return {
      ok: false,
      action: 'skip',
      code: 'not-handoff',
      reason: 'Review body is not a Cursor Atlas re-review handoff.',
    };
  }
  return { ok: true, action: 'proceed', code: 'ok' };
}

function parseHandoff(body, currentHead) {
  const text = String(body || '');
  const liveHead = clean(currentHead).toLowerCase();
  if (!text.includes(HANDOFF_MARKER)) {
    return { ok: false, code: 'not-handoff', reason: 'Cursor review is not an Atlas re-review handoff.' };
  }
  if (!SHA_RE.test(liveHead)) {
    return { ok: false, code: 'malformed-live-head', reason: 'Live PR head is not a 40-character SHA.' };
  }
  const newHead = parseMarkdownSha(text, 'New exact head');
  const priorHead = parseMarkdownSha(text, 'Prior reviewed SHA');
  const outcomeMatch = /Prior review outcome[^\n]*?\*{0,2}:?\*{0,2}\s*(NOT PASS|BLOCKING)\b/i.exec(text);
  const priorOutcome = outcomeMatch ? outcomeMatch[1].toUpperCase() : '';
  if (!newHead || !priorHead || !priorOutcome) {
    return { ok: false, code: 'malformed-handoff', reason: 'Cursor handoff is missing the new head, prior reviewed SHA, or blocking prior outcome.' };
  }
  if (newHead !== liveHead) {
    return { ok: false, code: 'stale-handoff', reason: `Handoff head ${newHead.slice(0, 7)} is not live head ${liveHead.slice(0, 7)}.` };
  }
  if (priorHead === newHead) {
    return { ok: false, code: 'head-not-moved', reason: 'Repair handoff did not move the PR head.' };
  }
  return { ok: true, code: 'ok', newHead, priorHead, priorOutcome };
}

function classifyAtlasReview(body) {
  const text = String(body || '');
  if (text.startsWith(PASS_MARKER)) return 'PASS';
  if (text.startsWith(NOT_PASS_MARKER)) return 'NOT PASS';
  if (text.startsWith(BLOCKING_MARKER)) return 'BLOCKING';
  return '';
}

function markerForOutcome(outcome) {
  if (outcome === 'PASS') return PASS_MARKER;
  if (outcome === 'NOT PASS') return NOT_PASS_MARKER;
  if (outcome === 'BLOCKING') return BLOCKING_MARKER;
  return '';
}

function validatePriorReview(reviews, priorHead, claimedOutcome) {
  const sha = clean(priorHead).toLowerCase();
  const claimed = clean(claimedOutcome).toUpperCase();
  if (!SHA_RE.test(sha)) {
    return { ok: false, code: 'malformed-prior-head', reason: 'Handoff prior reviewed SHA is malformed.' };
  }
  if (!['NOT PASS', 'BLOCKING'].includes(claimed)) {
    return { ok: false, code: 'nonblocking-prior-outcome', reason: 'Handoff prior outcome is not a blocking Atlas outcome.' };
  }
  const list = Array.isArray(reviews) ? reviews : [];
  const candidates = list
    .filter((review) => review && review.user && review.user.login === TRUSTED_REVIEWER)
    .filter((review) => clean(review.commit_id).toLowerCase() === sha)
    .map((review) => ({ ...review, atlasOutcome: classifyAtlasReview(review.body) }))
    .filter((review) => Boolean(review.atlasOutcome))
    .sort((left, right) => String(left.submitted_at || '').localeCompare(String(right.submitted_at || '')));
  if (!candidates.length) {
    return { ok: false, code: 'missing-prior-review', reason: 'No trusted Atlas review exists on the handoff prior SHA.' };
  }
  const latest = candidates[candidates.length - 1];
  if (latest.atlasOutcome !== claimed) {
    return {
      ok: false,
      code: 'prior-outcome-mismatch',
      reason: `Latest trusted Atlas review on the prior SHA is ${latest.atlasOutcome}, not ${claimed}.`,
    };
  }
  const marker = markerForOutcome(latest.atlasOutcome);
  if (!clean(String(latest.body || '').slice(marker.length))) {
    return { ok: false, code: 'empty-prior-finding', reason: 'Trusted prior blocking review has no concrete finding text.' };
  }
  return { ok: true, code: 'ok', reviewId: latest.id, outcome: latest.atlasOutcome, priorHead: sha };
}

function assertPending(body, currentHead) {
  const head = clean(currentHead).toLowerCase();
  if (!SHA_RE.test(head)) {
    return { ok: false, code: 'malformed-live-head', reason: 'Live PR head is not a 40-character SHA.' };
  }
  const text = String(body || '');
  const heading = /(^|\n)[ \t]*#{2,4}[ \t]*Atlas Contract \/ Systems Review[ \t]*(?=\n|$)/i.exec(text);
  if (!heading) return { ok: false, code: 'missing-review-section', reason: 'PR body has no Atlas Contract / Systems Review section.' };
  const afterStart = heading.index + heading[0].length;
  const after = text.slice(afterStart);
  const nextHeading = /\n[ \t]*#{1,6}[ \t]+/.exec(after);
  const section = nextHeading ? after.slice(0, nextHeading.index) : after;
  const headMatch = /Exact reviewed head\*{0,2}\s*:\s*`?([0-9a-f]{40})`?/i.exec(section);
  const outcomeMatch = /Review outcome\*{0,2}\s*:\s*PENDING\b/i.exec(section);
  if (!headMatch || headMatch[1].toLowerCase() !== head) {
    return { ok: false, code: 'pending-head-mismatch', reason: 'Review block is not pending on the live exact head.' };
  }
  if (!outcomeMatch) {
    return { ok: false, code: 'not-pending', reason: 'Review block is not awaiting exact-head re-review.' };
  }
  return { ok: true, code: 'ok', head };
}

function validateModelResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'malformed-model-result', reason: 'Model result is not an object.' };
  }
  const outcome = clean(value.outcome).toUpperCase();
  const summary = clean(value.summary);
  const blockers = Array.isArray(value.blockers)
    ? value.blockers.map(clean).filter(Boolean)
    : null;
  if (!['PASS', 'NOT PASS'].includes(outcome)) {
    return { ok: false, code: 'bad-outcome', reason: 'Model result must be PASS or NOT PASS.' };
  }
  if (!summary || summary.length > 1800) {
    return { ok: false, code: 'bad-summary', reason: 'Model summary is missing or too long.' };
  }
  if (!blockers || blockers.length > 8 || blockers.some((item) => item.length > 1200)) {
    return { ok: false, code: 'bad-blockers', reason: 'Model blockers are malformed or exceed the bounded review contract.' };
  }
  if (outcome === 'PASS' && blockers.length !== 0) {
    return { ok: false, code: 'pass-with-blockers', reason: 'PASS cannot carry blockers.' };
  }
  if (outcome === 'NOT PASS' && blockers.length === 0) {
    return { ok: false, code: 'not-pass-without-blocker', reason: 'NOT PASS must name at least one blocker.' };
  }
  return { ok: true, code: 'ok', outcome, summary, blockers };
}

function shaOrEmpty(value) {
  const sha = clean(value).toLowerCase();
  return SHA_RE.test(sha) ? sha : '';
}

function parentShas(value) {
  if (!Array.isArray(value)) return [];
  return value.map(shaOrEmpty).filter(Boolean);
}

/**
 * pull_request_review dispatchers run on refs/pull/<n>/merge. GitHub therefore
 * sets workflow_run.head_sha to that synthetic merge commit, not the PR head.
 * The expected exact head must come from the associated PR head in the
 * workflow_run payload, or from the merge commit's second parent. Never treat
 * workflow_run.head_sha itself as the PR head.
 */
function evaluateDispatchExactHead(input) {
  const liveHead = shaOrEmpty(input && input.liveHead);
  const associatedPullHead = shaOrEmpty(input && input.associatedPullHead);
  const workflowRunHead = shaOrEmpty(input && input.workflowRunHead);
  const mergeParents = parentShas(input && input.mergeParents);

  if (!liveHead) {
    return {
      ok: false,
      action: 'fail',
      code: 'malformed-live-head',
      reason: 'Live PR head is not a 40-character SHA.',
    };
  }

  let expectedHead = '';
  let source = '';
  if (associatedPullHead) {
    expectedHead = associatedPullHead;
    source = 'associated-pull-head';
  } else if (mergeParents.length >= 2) {
    expectedHead = mergeParents[1];
    source = 'merge-ref-second-parent';
  } else {
    return {
      ok: false,
      action: 'fail',
      code: 'unresolved-dispatch-head',
      reason: 'Dispatch-time PR head could not be derived without treating workflow_run.head_sha as the PR head.',
    };
  }

  if (workflowRunHead && expectedHead === workflowRunHead && mergeParents.length >= 2) {
    return {
      ok: false,
      action: 'fail',
      code: 'merge-sha-used-as-pr-head',
      reason: 'Resolved dispatch head equals the workflow_run merge SHA; refusing to treat that as the PR head.',
    };
  }

  if (liveHead !== expectedHead) {
    return {
      ok: false,
      action: 'skip',
      code: 'stale-head',
      reason: `Live PR head ${liveHead.slice(0, 7)} moved beyond dispatch-time PR head ${expectedHead.slice(0, 7)}.`,
      liveHead,
      expectedHead,
      source,
    };
  }

  return {
    ok: true,
    action: 'proceed',
    code: 'ok',
    head: liveHead,
    expectedHead,
    source,
  };
}

function reviewSection(body) {
  const text = String(body || '');
  const heading = /(^|\n)[ \t]*#{2,4}[ \t]*Atlas Contract \/ Systems Review[ \t]*(?=\n|$)/i.exec(text);
  if (!heading) return null;
  const afterStart = heading.index + heading[0].length;
  const after = text.slice(afterStart);
  const nextHeading = /\n[ \t]*#{1,6}[ \t]+/.exec(after);
  return nextHeading ? after.slice(0, nextHeading.index) : after;
}

function readReviewField(section, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `^[ \\t]*[-*][ \\t]*\\*{0,2}${escaped}\\*{0,2}[ \\t]*:(.*)$`,
    'im'
  ).exec(String(section || ''));
  if (!match) return null;
  return String(match[1])
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function parseRequiredReviewField(body) {
  const section = reviewSection(body);
  if (section == null) {
    return {
      ok: false,
      action: 'skip',
      code: 'missing-review-section',
      required: false,
      reason: 'PR body has no Atlas Contract / Systems Review section.',
    };
  }
  const raw = readReviewField(section, 'Required');
  if (raw == null || raw === '') {
    return {
      ok: false,
      action: 'skip',
      code: 'missing-required-field',
      required: false,
      reason: 'Live Merge Card has no parseable Required field.',
    };
  }
  const required = /^REQUIRED(?:\b|[ \t]*[—–:.-])/i.test(raw);
  const notRequired = /^NOT[ \t]+REQUIRED(?:\b|[ \t]*[—–:.-])/i.test(raw);
  if (required) {
    return {
      ok: true,
      action: 'proceed',
      code: 'required',
      required: true,
      raw,
    };
  }
  if (notRequired) {
    return {
      ok: false,
      action: 'skip',
      code: 'not-required',
      required: false,
      raw,
      reason: 'Live Merge Card says Required: NOT REQUIRED; no first-review API spend.',
    };
  }
  return {
    ok: false,
    action: 'skip',
    code: 'unparsed-required',
    required: false,
    raw,
    reason: 'Live Merge Card Required field is not REQUIRED or NOT REQUIRED; no first-review API spend.',
  };
}

function latestTrustedAtlasVerdict(reviews, sha) {
  const head = shaOrEmpty(sha);
  if (!head) return null;
  const list = Array.isArray(reviews) ? reviews : [];
  const candidates = list
    .filter((review) => review && review.user && review.user.login === TRUSTED_REVIEWER)
    .filter((review) => clean(review.commit_id).toLowerCase() === head)
    .map((review) => ({ ...review, atlasOutcome: classifyAtlasReview(review.body) }))
    .filter((review) => Boolean(review.atlasOutcome))
    .sort((left, right) => String(left.submitted_at || '').localeCompare(String(right.submitted_at || '')));
  return candidates.length ? candidates[candidates.length - 1] : null;
}

function hasTrustedAtlasVerdictOnSha(reviews, sha) {
  return Boolean(latestTrustedAtlasVerdict(reviews, sha));
}

function evaluateFirstReviewEligibility(input) {
  const liveHead = shaOrEmpty(input && input.liveHead);
  if (!liveHead) {
    return {
      ok: false,
      action: 'fail',
      code: 'malformed-live-head',
      reason: 'Live PR head is not a 40-character SHA.',
    };
  }
  const parsed = parseRequiredReviewField(input && input.body);
  if (parsed.action === 'skip') {
    return { ...parsed, head: liveHead };
  }
  const existing = latestTrustedAtlasVerdict(input && input.reviews, liveHead);
  if (existing) {
    return {
      ok: false,
      action: 'skip',
      code: 'duplicate-trusted-verdict',
      reason: `Trusted Atlas ${existing.atlasOutcome} already exists on ${liveHead}; no duplicate API call.`,
      head: liveHead,
      existingOutcome: existing.atlasOutcome,
      existingReviewId: existing.id,
    };
  }
  return {
    ok: true,
    action: 'proceed',
    code: 'ok',
    head: liveHead,
  };
}

function renderReview(value, head, model) {
  const sha = clean(head).toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error('Exact reviewed head is malformed.');
  const validated = validateModelResult(value);
  if (!validated.ok) throw new Error(validated.reason);
  const modelName = clean(model) || 'gpt-5.6';
  const marker = validated.outcome === 'PASS' ? PASS_MARKER : NOT_PASS_MARKER;
  const lines = [
    marker,
    '',
    `Exact reviewed head: \`${sha}\``,
    '',
    `Automated exact-head review via owner-authorized OpenAI API model \`${modelName}\`.`,
    '',
    validated.summary,
  ];
  if (validated.outcome === 'PASS') {
    lines.push('', 'No merge blockers found.');
  } else {
    lines.push('', 'Merge blockers:');
    validated.blockers.forEach((blocker, index) => lines.push(`${index + 1}. ${blocker}`));
  }
  lines.push('', 'This review does not authorize owner-reserved financial facts, schema/destructive changes, secrets, or production writes.');
  return `${lines.join('\n')}\n`;
}

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function main(argv) {
  const command = argv[2];
  if (command === 'parse-handoff') {
    const result = parseHandoff(fs.readFileSync(argv[3], 'utf8'), argv[4]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }
  if (command === 'validate-prior-review') {
    const result = validatePriorReview(readJson(argv[3]), argv[4], argv[5]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }
  if (command === 'assert-pending') {
    const result = assertPending(fs.readFileSync(argv[3], 'utf8'), argv[4]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  }
  if (command === 'evaluate-dispatch-head') {
    const result = evaluateDispatchExactHead({
      liveHead: argv[3],
      associatedPullHead: argv[4],
      workflowRunHead: argv[5],
      mergeParents: argv[6] ? JSON.parse(argv[6]) : [],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.action === 'skip') return 2;
    return result.ok ? 0 : 1;
  }
  if (command === 'render-review') {
    process.stdout.write(renderReview(readJson(argv[3]), argv[4], argv[5]));
    return 0;
  }
  if (command === 'parse-required') {
    const result = parseRequiredReviewField(fs.readFileSync(argv[3], 'utf8'));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.action === 'skip') return 2;
    return result.ok ? 0 : 1;
  }
  if (command === 'evaluate-first-review') {
    const result = evaluateFirstReviewEligibility({
      body: fs.readFileSync(argv[3], 'utf8'),
      reviews: readJson(argv[4]),
      liveHead: argv[5],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.action === 'skip') return 2;
    return result.ok ? 0 : 1;
  }
  process.stderr.write('usage: atlas-api-rereview.js parse-handoff|validate-prior-review|assert-pending|evaluate-dispatch-head|render-review|parse-required|evaluate-first-review ...\n');
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  SHA_RE,
  HANDOFF_MARKER,
  PASS_MARKER,
  NOT_PASS_MARKER,
  BLOCKING_MARKER,
  TRUSTED_REVIEWER,
  CURSOR_HANDOFF_LOGINS,
  isCursorHandoffReviewer,
  evaluateDispatchHandoff,
  parseHandoff,
  classifyAtlasReview,
  markerForOutcome,
  validatePriorReview,
  assertPending,
  evaluateDispatchExactHead,
  parseRequiredReviewField,
  latestTrustedAtlasVerdict,
  hasTrustedAtlasVerdictOnSha,
  evaluateFirstReviewEligibility,
  validateModelResult,
  renderReview,
};
