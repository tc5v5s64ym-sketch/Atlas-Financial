'use strict';

const fs = require('fs');
const path = require('path');
const helper = require('./scripts/atlas-api-rereview');

let failures = 0;
function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
}

const head = 'b'.repeat(40);
const otherHead = 'c'.repeat(40);

function card(required) {
  return [
    '## Atlas Merge Card',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **Primary risk** | auto-safe |',
    '',
    '### Atlas Contract / Systems Review',
    '',
    `- **Required**: ${required}`,
    `- **Exact reviewed head**: ${head}`,
    '- **Reviewer**: ChatGPT',
    '- **Review outcome**: PENDING',
    '- **Findings and fix verification**: Awaiting exact-head Atlas review.',
    '',
    '### Additional findings',
    '',
    'none',
  ].join('\n');
}

const trustedPass = {
  id: 11,
  commit_id: head,
  submitted_at: '2026-08-16T01:00:00Z',
  user: { login: helper.TRUSTED_REVIEWER },
  body: `${helper.PASS_MARKER}\nNo merge blockers found.`,
};
const trustedNotPass = {
  id: 12,
  commit_id: head,
  submitted_at: '2026-08-16T02:00:00Z',
  user: { login: helper.TRUSTED_REVIEWER },
  body: `${helper.NOT_PASS_MARKER}\nExact-head proof is missing.`,
};
const trustedBlocking = {
  id: 13,
  commit_id: head,
  submitted_at: '2026-08-16T03:00:00Z',
  user: { login: helper.TRUSTED_REVIEWER },
  body: `${helper.BLOCKING_MARKER}\nOwner-reserved stop remains.`,
};
const nativeCodex = {
  id: 99,
  commit_id: head,
  submitted_at: '2026-08-16T04:00:00Z',
  user: { login: 'chatgpt-codex-connector[bot]' },
  body: `${helper.PASS_MARKER}\nAdvisory only.`,
};

console.log('=== live Required field ===');
let result = helper.parseRequiredReviewField(card('REQUIRED — high-risk workflow'));
ok(result.ok && result.required && result.action === 'proceed' && result.code === 'required',
  'REQUIRED on the live Merge Card is eligible for first review');
result = helper.parseRequiredReviewField(card('REQUIRED'));
ok(result.ok && result.required, 'bare REQUIRED is still REQUIRED');
result = helper.parseRequiredReviewField(card('NOT REQUIRED — docs only'));
ok(!result.ok && result.action === 'skip' && result.code === 'not-required' && result.required === false,
  'NOT REQUIRED skips with no API spend');
result = helper.parseRequiredReviewField(card('NOT REQUIRED'));
ok(!result.ok && result.code === 'not-required', 'bare NOT REQUIRED still skips');
result = helper.parseRequiredReviewField(card('MAYBE'));
ok(!result.ok && result.action === 'skip' && result.code === 'unparsed-required',
  'unparsed Required skips rather than spending');
result = helper.parseRequiredReviewField(card('<!-- REQUIRED — trigger; or NOT REQUIRED — why -->'));
ok(!result.ok && result.code === 'missing-required-field',
  'template placeholder comments do not count as REQUIRED');
result = helper.parseRequiredReviewField('## Atlas Merge Card\n\nno review section\n');
ok(!result.ok && result.code === 'missing-review-section',
  'a body without the review section skips');

console.log('\n=== first-review eligibility ===');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [],
  liveHead: head,
});
ok(result.ok && result.action === 'proceed' && result.head === head,
  'REQUIRED with no trusted verdict proceeds');
result = helper.evaluateFirstReviewEligibility({
  body: card('NOT REQUIRED — docs only'),
  reviews: [],
  liveHead: head,
});
ok(!result.ok && result.action === 'skip' && result.code === 'not-required',
  'NOT REQUIRED does not spend even when no review exists');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [trustedPass],
  liveHead: head,
});
ok(!result.ok && result.action === 'skip' && result.code === 'duplicate-trusted-verdict'
  && result.existingOutcome === 'PASS',
  'existing trusted PASS on the same SHA is not duplicated');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [trustedNotPass],
  liveHead: head,
});
ok(!result.ok && result.code === 'duplicate-trusted-verdict' && result.existingOutcome === 'NOT PASS',
  'existing trusted NOT PASS on the same SHA is not duplicated');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [trustedBlocking],
  liveHead: head,
});
ok(!result.ok && result.code === 'duplicate-trusted-verdict' && result.existingOutcome === 'BLOCKING',
  'existing trusted BLOCKING on the same SHA is not duplicated');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [nativeCodex],
  liveHead: head,
});
ok(result.ok && result.action === 'proceed',
  'a native Codex review is not a trusted Atlas verdict and does not skip spend');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [{ ...trustedPass, commit_id: otherHead }],
  liveHead: head,
});
ok(result.ok && result.action === 'proceed',
  'a trusted PASS on a different SHA does not skip the live head');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [{ ...trustedNotPass, commit_id: otherHead }],
  liveHead: head,
});
ok(!result.ok && result.action === 'skip' && result.code === 'prior-blocking-verdict'
  && result.priorOutcome === 'NOT PASS' && result.priorHead === otherHead,
  'an earlier trusted NOT PASS leaves the repaired head to the follow-up lane');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [{ ...trustedBlocking, commit_id: otherHead }],
  liveHead: head,
});
ok(!result.ok && result.action === 'skip' && result.code === 'prior-blocking-verdict'
  && result.priorOutcome === 'BLOCKING',
  'an earlier trusted BLOCKING leaves the repaired head to the follow-up lane');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [
    { ...trustedNotPass, commit_id: otherHead, submitted_at: '2026-08-16T02:00:00Z' },
    { ...trustedPass, commit_id: 'd'.repeat(40), submitted_at: '2026-08-16T04:00:00Z' },
  ],
  liveHead: head,
});
ok(result.ok && result.action === 'proceed',
  'a later trusted PASS on an intermediate SHA returns later heads to the initial-review lane');
const liveHandoff = {
  id: 22,
  commit_id: head,
  submitted_at: '2026-08-16T05:00:00Z',
  user: { login: 'cursor[bot]' },
  body: `Atlas re-review requested.\n\n- **New exact head:** \`${head}\`\n- **Prior reviewed SHA:** \`${otherHead}\`\n- **Prior review outcome:** NOT PASS\n`,
};
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [liveHandoff],
  liveHead: head,
});
ok(!result.ok && result.action === 'skip' && result.code === 'repair-handoff',
  'an active Cursor re-review handoff on the live head leaves the head to the follow-up lane');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [{ ...liveHandoff, user: { login: 'cursor' } }],
  liveHead: head,
});
ok(!result.ok && result.code === 'repair-handoff',
  'the live Cursor Automation login is also an active repair handoff');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [{ ...liveHandoff, commit_id: otherHead }],
  liveHead: head,
});
ok(result.ok && result.action === 'proceed',
  'a stale Cursor handoff on a prior SHA does not skip a new head');
ok(helper.hasTrustedAtlasVerdictOnSha([trustedPass], head) === true,
  'hasTrustedAtlasVerdictOnSha sees the trusted PASS');
ok(helper.hasTrustedAtlasVerdictOnSha([nativeCodex], head) === false,
  'hasTrustedAtlasVerdictOnSha ignores Codex');
ok(helper.hasActiveRepairHandoff([liveHandoff], head) === true,
  'hasActiveRepairHandoff sees the live-head Cursor handoff');
ok(helper.hasActiveRepairHandoff([{ ...liveHandoff, commit_id: otherHead }], head) === false,
  'hasActiveRepairHandoff ignores a handoff on another SHA');
result = helper.evaluateFirstReviewEligibility({
  body: card('REQUIRED — workflows'),
  reviews: [],
  liveHead: 'not-a-sha',
});
ok(!result.ok && result.action === 'fail' && result.code === 'malformed-live-head',
  'malformed live head fails closed rather than skipping as ineligible');

console.log('\n=== shipped first-review workflow contract ===');
const dispatchPath = path.join(__dirname, '.github/workflows/atlas-first-review-dispatch.yml');
const reviewerPath = path.join(__dirname, '.github/workflows/atlas-first-review.yml');
const followUpDispatchPath = path.join(__dirname, '.github/workflows/atlas-rereview-dispatch.yml');
const followUpReviewerPath = path.join(__dirname, '.github/workflows/atlas-rereview.yml');
const dispatch = fs.readFileSync(dispatchPath, 'utf8');
const reviewer = fs.readFileSync(reviewerPath, 'utf8');
const followUpDispatch = fs.readFileSync(followUpDispatchPath, 'utf8');
const followUpReviewer = fs.readFileSync(followUpReviewerPath, 'utf8');

ok(/pull_request:\s*\n\s*types:\s*\[[^\]]*opened[^\]]*reopened[^\]]*synchronize[^\]]*edited[^\]]*ready_for_review/.test(dispatch),
  'secret-free dispatcher listens to new and updated pull requests');
ok(/github\.event\.pull_request\.base\.ref == 'main'/.test(dispatch),
  'dispatcher is scoped to pull requests targeting main');
ok(/github\.event\.pull_request\.draft == false/.test(dispatch),
  'dispatcher does not wake first review on drafts');
ok(/^  note:/m.test(dispatch), 'dispatcher job is named note so the trusted reviewer can require it');
ok(!/secrets\./.test(dispatch) && !/write\b/.test((dispatch.match(/permissions:[\s\S]*?\n\n/) || [''])[0]),
  'dispatcher carries no secrets or write permission');
ok(/workflow_run:\s*\n\s*workflows:\s*\["Atlas first-review dispatch"\]/.test(reviewer),
  'secret-bearing first reviewer is default-branch workflow_run of that dispatcher');
ok(/permissions:[\s\S]*?actions:\s*read[\s\S]*?checks:\s*read[\s\S]*?contents:\s*read[\s\S]*?pull-requests:\s*read/.test(reviewer),
  'first reviewer has only the read scopes needed for run jobs, checks, contents, and PR evidence');
ok(!/permissions:[\s\S]*?\bwrite\b/.test((reviewer.match(/permissions:[\s\S]*?\n\n/) || [''])[0]),
  'first reviewer GITHUB_TOKEN has no repository write scope');
ok(/evaluate-dispatch-head/.test(reviewer) && /workflow_run\.pull_requests\[0\]\.head\.sha/.test(reviewer),
  'first reviewer derives the dispatch-time PR head from the associated pull head or merge parents');
ok(!/head_sha\}" != "\$\{RUN_HEAD\}"/.test(reviewer) && !/head_sha != "\$\{RUN_HEAD\}"/.test(reviewer),
  'first reviewer does not equate workflow_run.head_sha to the live PR head');
ok(/evaluate-first-review/.test(reviewer),
  'first reviewer uses the shared helper to read live Required, existing trusted verdicts, prior blockers, and repair handoffs');
ok(!/parse-handoff/.test(reviewer) && !/validate-prior-review/.test(reviewer) && !/assert-pending/.test(reviewer),
  'first reviewer does not require a Cursor handoff, prior blocker, or PENDING card');
ok(!/repair_provenance/.test(reviewer) && !/prior-review\.md/.test(reviewer) && !/repair\.diff/.test(reviewer),
  'first-review context has no repair provenance');
ok(!/for attempt in \$\(seq 1 24\)/.test(reviewer) && !/120 seconds/.test(reviewer) && !/sleep 5/.test(reviewer),
  'first reviewer does not wait for PENDING bookkeeping before API spend');
ok(/initial blocking architecture review/.test(reviewer) && /This is not a bounded follow-up review/.test(reviewer),
  'review prompt is the initial blockers-only protocol, not the repair follow-up');
ok(!/bounded follow-up review after an automated repair/.test(reviewer),
  'first-review prompt does not reuse the follow-up developer contract');
ok(/Do not wait for a PENDING merge-card state/.test(reviewer),
  'first-review prompt does not require PENDING before judging the head');
ok(/Call owner-authorized OpenAI Atlas reviewer[\s\S]*?GH_TOKEN:\s*\$\{\{ github\.token \}\}/.test(reviewer),
  'post-model PR and review reads use the read-only GITHUB_TOKEN');
ok(/secrets\.OPENAI_API_KEY/.test(reviewer), 'first reviewer uses the owner-approved OpenAI API key');
ok(/secrets\.ATLAS_AUTOMATION_TOKEN/.test(reviewer), 'first reviewer reuses the existing owner automation credential');
ok(/gh api user/.test(reviewer) && /tc5v5s64ym-sketch/.test(reviewer),
  'first reviewer fails closed unless the automation token is the trusted reviewer identity');
ok(/MODEL: gpt-5\.6/.test(reviewer) && /json_schema/.test(reviewer) && /store:\s*false/.test(reviewer),
  'first reviewer uses GPT-5.6 structured output without Responses application-state storage');
ok(/canonical_contracts contains trusted policy text/.test(reviewer),
  'developer prompt trusts only default-branch policy');
ok(/--rawfile portability docs\/BUILDER_PORTABILITY\.md/.test(reviewer)
  && /--rawfile contextDoc CONTEXT\.md/.test(reviewer)
  && /--rawfile accountFacts docs\/ACCOUNT_FACTS\.md/.test(reviewer)
  && /--rawfile buildStrategy docs\/ATLAS_FINANCIAL_BUILD_STRATEGY\.md/.test(reviewer)
  && /--rawfile backlog BACKLOG\.md/.test(reviewer)
  && /--rawfile openQuestions docs\/01_OPEN_QUESTIONS\.md/.test(reviewer),
  'first-review trusted context includes the remaining AGENTS.md routed documents');
ok(/builder_portability:\$portability/.test(reviewer)
  && /account_facts:\$accountFacts/.test(reviewer)
  && /build_strategy:\$buildStrategy/.test(reviewer)
  && /backlog:\$backlog/.test(reviewer)
  && /open_questions:\$openQuestions/.test(reviewer),
  'first-review canonical_contracts exposes those remaining documents to the API reviewer');
ok(/live_head.*HEAD_SHA/.test(reviewer) && /immediately before review post/.test(reviewer),
  'first reviewer rechecks the live exact head after the model call and immediately before posting');
ok(/evaluate-first-review[\s\S]*final-first-review\.json/.test(reviewer),
  'first reviewer rechecks Required and duplicate SHA immediately before posting');
ok(/pulls\/\$\{PR_NUMBER\}\/reviews/.test(reviewer) && /event:\"COMMENT\"/.test(reviewer),
  'first reviewer posts a normal GitHub review on the exact commit');
ok(!/gh pr merge|merge_pull_request|git push/.test(reviewer) && !/gh pr merge|merge_pull_request|git push/.test(dispatch),
  'first reviewer cannot merge or push code');
ok(/persist-credentials:\s*false/.test(reviewer),
  'trusted first reviewer checks out default-branch code without credentials');
ok(!/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha/.test(reviewer),
  'trusted first reviewer does not check out the PR head');
const openaiCall = fs.readFileSync(path.join(__dirname, 'scripts/atlas-openai-call.sh'), 'utf8');
ok(/bash scripts\/atlas-openai-call\.sh/.test(reviewer),
  'first reviewer calls OpenAI through the shared retry helper');
ok(!/curl -fsS https:\/\/api\.openai.com/.test(reviewer),
  'first reviewer does not fail-fast curl OpenAI');
ok(/429/.test(openaiCall) && /backing off/.test(openaiCall) && /seq 1/.test(openaiCall),
  'OpenAI helper retries 429 instead of exiting 22');
ok(!/curl -[a-z]*f/.test(openaiCall),
  'OpenAI helper does not use curl -f, which turns 429 into exit 22');

console.log('\n=== follow-up path is unchanged and separate ===');
ok(/Atlas re-review requested\./.test(followUpDispatch),
  'follow-up dispatcher is still scoped to the Cursor handoff marker');
ok(/pull_request_review:/.test(followUpDispatch) && !/types:\s*\[[^\]]*opened/.test(followUpDispatch),
  'follow-up dispatcher is still review-handoff, not new-PR opened');
ok(/bounded follow-up review/.test(followUpReviewer) && /validate-prior-review/.test(followUpReviewer),
  'follow-up reviewer still validates prior blockers');
ok(/workflows:\s*\["Atlas re-review handoff dispatch"\]/.test(followUpReviewer),
  'follow-up reviewer still listens only to the handoff dispatcher');
ok(!/evaluate-first-review/.test(followUpReviewer) && !/Atlas first-review dispatch/.test(followUpReviewer),
  'follow-up reviewer was not retargeted at the first-review dispatcher');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
