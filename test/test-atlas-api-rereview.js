'use strict';

const fs = require('fs');
const path = require('path');
const helper = require('../scripts/atlas-api-rereview');

let failures = 0;
function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}

const oldHead = 'a'.repeat(40);
const newHead = 'b'.repeat(40);
const handoff = `<!-- CURSOR_AUTOMATION_ID: x -->\nAtlas re-review requested.\n\n- **New exact head:** \`${newHead}\`\n- **Prior reviewed SHA:** \`${oldHead}\`\n- **Prior review outcome:** NOT PASS\n`;

console.log('=== handoff exact-head gate ===');
let result = helper.parseHandoff(handoff, newHead);
ok(result.ok && result.newHead === newHead && result.priorHead === oldHead && result.priorOutcome === 'NOT PASS',
  'accepts a Cursor repair handoff for the live exact head');
result = helper.parseHandoff(handoff, 'c'.repeat(40));
ok(!result.ok && result.code === 'stale-handoff', 'rejects a stale Cursor handoff');
result = helper.parseHandoff(handoff.replace('NOT PASS', 'PASS'), newHead);
ok(!result.ok && result.code === 'malformed-handoff', 'rejects a handoff whose prior outcome was not blocking');

console.log('\n=== prior trusted review gate ===');
const priorReviews = [
  { id: 1, commit_id: oldHead, submitted_at: '2026-08-15T01:00:00Z', user: { login: helper.TRUSTED_REVIEWER }, body: `${helper.NOT_PASS_MARKER}\nfirst blocker` },
];
result = helper.validatePriorReview(priorReviews, oldHead, 'NOT PASS');
ok(result.ok && result.reviewId === 1, 'accepts the latest trusted blocking review on the claimed prior SHA');
result = helper.validatePriorReview([{ ...priorReviews[0], user: { login: 'cursor[bot]' } }], oldHead, 'NOT PASS');
ok(!result.ok && result.code === 'missing-prior-review', 'rejects a blocking assertion that is not backed by the trusted Atlas reviewer');
result = helper.validatePriorReview([{ ...priorReviews[0], body: helper.NOT_PASS_MARKER }], oldHead, 'NOT PASS');
ok(!result.ok && result.code === 'empty-prior-finding', 'rejects a prior blocking review with no concrete finding text');
result = helper.validatePriorReview([
  priorReviews[0],
  { id: 2, commit_id: oldHead, submitted_at: '2026-08-15T02:00:00Z', user: { login: helper.TRUSTED_REVIEWER }, body: `${helper.PASS_MARKER}\nfixed` },
], oldHead, 'NOT PASS');
ok(!result.ok && result.code === 'prior-outcome-mismatch', 'rejects an old NOT PASS when the latest trusted review on that SHA is PASS');

console.log('\n=== pending review-card gate ===');
const pendingBody = `## Atlas Contract / Systems Review\n\n- **Required**: REQUIRED\n- **Exact reviewed head**: ${newHead}\n- **Reviewer**: ChatGPT\n- **Review outcome**: PENDING\n- **Findings and fix verification**: Awaiting exact-head re-review after automated repair.\n\n### Next\ntext\n`;
result = helper.assertPending(pendingBody, newHead);
ok(result.ok, 'accepts PENDING only on the live exact head');
result = helper.assertPending(pendingBody, oldHead);
ok(!result.ok && result.code === 'pending-head-mismatch', 'rejects PENDING for another head');

console.log('\n=== bounded model result ===');
result = helper.validateModelResult({ outcome: 'PASS', summary: 'No blocker remains.', blockers: [] });
ok(result.ok, 'accepts PASS with zero blockers');
result = helper.validateModelResult({ outcome: 'PASS', summary: 'Contradiction.', blockers: ['bad'] });
ok(!result.ok && result.code === 'pass-with-blockers', 'rejects PASS with blockers');
result = helper.validateModelResult({ outcome: 'NOT PASS', summary: 'Blocked.', blockers: [] });
ok(!result.ok && result.code === 'not-pass-without-blocker', 'rejects NOT PASS without a concrete blocker');
const rendered = helper.renderReview({ outcome: 'NOT PASS', summary: 'One real blocker.', blockers: ['Exact-head proof is missing.'] }, newHead, 'gpt-5.6');
ok(rendered.startsWith('Atlas Contract / Systems Review — NOT PASS\n'), 'renders the canonical NOT PASS marker');
ok(rendered.includes(`Exact reviewed head: \`${newHead}\``), 'renders the exact reviewed SHA');

console.log('\n=== dispatch exact-head gate ===');
const mergeSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const movedHead = 'c'.repeat(40);
result = helper.evaluateDispatchExactHead({
  liveHead: newHead,
  associatedPullHead: newHead,
  workflowRunHead: mergeSha,
  mergeParents: [baseSha, newHead],
});
ok(result.ok && result.action === 'proceed' && result.source === 'associated-pull-head',
  'legitimate handoff proceeds when the workflow_run SHA is the synthetic merge commit');
result = helper.evaluateDispatchExactHead({
  liveHead: newHead,
  associatedPullHead: '',
  workflowRunHead: mergeSha,
  mergeParents: [baseSha, newHead],
});
ok(result.ok && result.action === 'proceed' && result.source === 'merge-ref-second-parent',
  'legitimate handoff proceeds by re-resolving the PR head from the merge commit parents');
result = helper.evaluateDispatchExactHead({
  liveHead: movedHead,
  associatedPullHead: newHead,
  workflowRunHead: mergeSha,
  mergeParents: [baseSha, newHead],
});
ok(!result.ok && result.action === 'skip' && result.code === 'stale-head',
  'genuine head movement still skips when the associated PR head is behind the live head');
result = helper.evaluateDispatchExactHead({
  liveHead: movedHead,
  associatedPullHead: '',
  workflowRunHead: mergeSha,
  mergeParents: [baseSha, newHead],
});
ok(!result.ok && result.action === 'skip' && result.code === 'stale-head',
  'genuine head movement still skips when only the merge-ref second parent identifies the old head');
result = helper.evaluateDispatchExactHead({
  liveHead: newHead,
  associatedPullHead: '',
  workflowRunHead: mergeSha,
  mergeParents: [],
});
ok(!result.ok && result.action === 'fail' && result.code === 'unresolved-dispatch-head',
  'fails closed instead of treating workflow_run.head_sha as the PR head');
result = helper.evaluateDispatchExactHead({
  liveHead: mergeSha,
  associatedPullHead: mergeSha,
  workflowRunHead: mergeSha,
  mergeParents: [baseSha, newHead],
});
ok(!result.ok && result.action === 'fail' && result.code === 'merge-sha-used-as-pr-head',
  'refuses a resolved head that is the synthetic merge SHA');

console.log('\n=== dispatcher Cursor identity gate ===');
ok(helper.CURSOR_HANDOFF_LOGINS.includes('cursor'),
  'closed login set includes the live Cursor Automation login');
ok(helper.isCursorHandoffReviewer('cursor') === true,
  'live GitHub login cursor is an eligible Cursor handoff reviewer');
ok(helper.isCursorHandoffReviewer('cursor[bot]') === true,
  'REST/App form cursor[bot] remains the same Cursor identity');
ok(helper.isCursorHandoffReviewer('Cursor') === false,
  'Cursor login match is exact and case-sensitive');
ok(helper.isCursorHandoffReviewer('cursor-automation') === false,
  'prefix-similar logins are not treated as Cursor');
result = helper.evaluateDispatchHandoff({ login: 'cursor', body: handoff });
ok(result.ok && result.action === 'proceed',
  'dispatcher job executes for the live Cursor handoff login');
result = helper.evaluateDispatchHandoff({ login: 'cursor[bot]', body: handoff });
ok(result.ok && result.action === 'proceed',
  'dispatcher job still executes for the REST/App Cursor login');
for (const login of ['octocat', 'github-actions[bot]', 'dependabot[bot]', 'chatgpt-codex-connector[bot]', 'tc5v5s64ym-sketch', 'Cursor', '']) {
  result = helper.evaluateDispatchHandoff({ login, body: handoff });
  ok(!result.ok && result.action === 'skip' && result.code === 'not-cursor-reviewer',
    `dispatcher rejects a handoff-shaped review from ${login || '(empty)'}`);
}
result = helper.evaluateDispatchHandoff({ login: 'cursor', body: 'Looks ready to merge.' });
ok(!result.ok && result.code === 'not-handoff',
  'dispatcher rejects a Cursor review that is not the handoff marker');

console.log('\n=== retired paid API re-review contract ===');
const retiredWorkflowPaths = [
  '.github/workflows/atlas-first-review-dispatch.yml',
  '.github/workflows/atlas-first-review.yml',
  '.github/workflows/atlas-rereview-dispatch.yml',
  '.github/workflows/atlas-rereview.yml',
];
for (const retiredPath of retiredWorkflowPaths) {
  ok(!fs.existsSync(path.join(__dirname, '..', retiredPath)),
    `retired API reviewer workflow is absent: ${retiredPath}`);
}

const claude = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
const chatgpt = fs.readFileSync(path.join(__dirname, '..', 'CHATGPT.md'), 'utf8');
ok(/If\s+the head moves, request review again on the new full SHA/.test(chatgpt),
  'a moved repair head requires a new direct exact-head review request');
ok(/any prior blocking finding that bounds a\s+re-review/.test(chatgpt),
  'bounded re-review carries the prior blocking finding');
ok(/A GitHub review, comment, label, or workflow run is evidence only/.test(claude),
  'GitHub handoff artifacts remain evidence rather than dispatch authority');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
