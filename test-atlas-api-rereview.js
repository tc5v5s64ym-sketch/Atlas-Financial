'use strict';

const fs = require('fs');
const path = require('path');
const helper = require('./scripts/atlas-api-rereview');

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

console.log('\n=== shipped workflow contract ===');
const dispatchPath = path.join(__dirname, '.github/workflows/atlas-rereview-dispatch.yml');
const reviewerPath = path.join(__dirname, '.github/workflows/atlas-rereview.yml');
const dispatch = fs.readFileSync(dispatchPath, 'utf8');
const reviewer = fs.readFileSync(reviewerPath, 'utf8');
ok(/pull_request_review:\s*\n\s*types:\s*\[submitted\]/.test(dispatch), 'secret-free dispatcher listens to submitted PR reviews');
ok(dispatch.includes("github.event.review.user.login == 'cursor'"),
  'dispatcher YAML accepts the live Cursor Automation login');
ok(dispatch.includes("github.event.review.user.login == 'cursor[bot]'"),
  'dispatcher YAML still accepts the REST/App Cursor login');
ok(/Atlas re-review requested\./.test(dispatch), 'dispatcher is scoped to the Cursor handoff marker');
ok(!/startsWith\(github\.event\.review\.user\.login/.test(dispatch) && !/contains\(github\.event\.review\.user\.login/.test(dispatch),
  'dispatcher does not broaden Cursor identity with prefix or contains matching');
ok(!/secrets\./.test(dispatch) && !/write\b/.test((dispatch.match(/permissions:[\s\S]*?\n\n/) || [''])[0]), 'dispatcher carries no secrets or write permission');
ok(/workflow_run:\s*\n\s*workflows:\s*\["Atlas re-review handoff dispatch"\]/.test(reviewer), 'secret-bearing reviewer is default-branch workflow_run');
ok(/permissions:[\s\S]*?actions:\s*read[\s\S]*?checks:\s*read[\s\S]*?contents:\s*read[\s\S]*?pull-requests:\s*read/.test(reviewer), 'reviewer has only the read scopes needed for run jobs, checks, contents, and PR evidence');
ok(!/permissions:[\s\S]*?\bwrite\b/.test((reviewer.match(/permissions:[\s\S]*?\n\n/) || [''])[0]), 'reviewer GITHUB_TOKEN has no repository write scope');
ok(/validate-prior-review/.test(reviewer), 'reviewer independently validates the trusted Atlas review behind the Cursor handoff');
ok(/compare\/\$\{prior_head\}\.\.\.\$\{head_sha\}/.test(reviewer) && /merge_base.*prior_head/.test(reviewer), 'reviewer proves the live repair head descends from the prior reviewed SHA');
ok(/prior-review\.md/.test(reviewer) && /prior-comments\.json/.test(reviewer) && /repair\.diff/.test(reviewer), 'review context carries the named prior blocker record and the focused repair diff');
ok(/reviews\/\$\{prior_review_id\}\/comments[\s\S]*select\(\.user\.login == "tc5v5s64ym-sketch"\)/.test(reviewer), 'only comments from the trusted prior reviewer enter the trusted closure record');
ok(/for attempt in \$\(seq 1 24\)/.test(reviewer) && /sleep 5/.test(reviewer) && /120 seconds/.test(reviewer), 'reviewer waits boundedly for PENDING bookkeeping before API spend');
ok(/Call owner-authorized OpenAI Atlas reviewer[\s\S]*?GH_TOKEN:\s*\$\{\{ github\.token \}\}/.test(reviewer), 'post-model PR and review reads use the read-only GITHUB_TOKEN');
ok(/secrets\.OPENAI_API_KEY/.test(reviewer), 'reviewer uses the owner-approved OpenAI API key');
ok(/secrets\.ATLAS_AUTOMATION_TOKEN/.test(reviewer), 'reviewer reuses the existing owner automation credential');
ok(/gh api user/.test(reviewer) && /tc5v5s64ym-sketch/.test(reviewer), 'reviewer fails closed unless the automation token is the trusted reviewer identity');
ok(/MODEL: gpt-5\.6/.test(reviewer) && /json_schema/.test(reviewer) && /store:\s*false/.test(reviewer), 'reviewer uses GPT-5.6 structured output without Responses application-state storage');
ok(/canonical_contracts contains trusted policy text/.test(reviewer) && /prior_review_body[\s\S]*trusted/.test(reviewer), 'developer prompt trusts only default-branch policy and the validated prior Atlas blocker record');
ok(/--rawfile portability docs\/BUILDER_PORTABILITY\.md/.test(reviewer)
  && /--rawfile contextDoc CONTEXT\.md/.test(reviewer)
  && /--rawfile accountFacts docs\/ACCOUNT_FACTS\.md/.test(reviewer)
  && /--rawfile buildStrategy docs\/ATLAS_FINANCIAL_BUILD_STRATEGY\.md/.test(reviewer)
  && /--rawfile backlog BACKLOG\.md/.test(reviewer)
  && /--rawfile openQuestions docs\/01_OPEN_QUESTIONS\.md/.test(reviewer),
  'follow-up trusted context includes the remaining AGENTS.md routed documents');
ok(/builder_portability:\$portability/.test(reviewer)
  && /account_facts:\$accountFacts/.test(reviewer)
  && /build_strategy:\$buildStrategy/.test(reviewer)
  && /backlog:\$backlog/.test(reviewer)
  && /open_questions:\$openQuestions/.test(reviewer),
  'follow-up canonical_contracts exposes those remaining documents to the API reviewer');
ok(/bounded follow-up review/.test(reviewer) && /Do not reopen untouched work/.test(reviewer), 'review prompt follows the bounded repair re-review protocol');
ok(/Queued or in-progress checks do not by themselves/.test(reviewer), 'review prompt does not turn ordinary CI timing into review churn');
ok(/workflow_run\.pull_requests\[0\]\.head\.sha/.test(reviewer) && /evaluate-dispatch-head/.test(reviewer),
  'reviewer derives the dispatch-time PR head from the associated pull head or merge parents');
ok(!/head_sha\}" != "\$\{RUN_HEAD\}"/.test(reviewer) && !/head_sha != "\$\{RUN_HEAD\}"/.test(reviewer),
  'reviewer does not equate workflow_run.head_sha to the live PR head');
ok(/live_head.*HEAD_SHA/.test(reviewer) && /immediately before review post/.test(reviewer), 'reviewer rechecks the live exact head after the model call and immediately before posting');
ok(/pulls\/\$\{PR_NUMBER\}\/reviews/.test(reviewer) && /event:\"COMMENT\"/.test(reviewer), 'reviewer posts a normal GitHub review on the exact commit');
ok(!/gh pr merge|merge_pull_request|git push/.test(reviewer), 'instant reviewer cannot merge or push code');
ok(/bash scripts\/atlas-openai-call\.sh/.test(reviewer), 'follow-up reviewer calls OpenAI through the shared retry helper');
ok(!/curl -fsS https:\/\/api\.openai.com/.test(reviewer), 'follow-up reviewer does not fail-fast curl OpenAI');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
