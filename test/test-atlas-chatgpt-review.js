'use strict';

const fs = require('fs');
const path = require('path');
const wake = require('../scripts/atlas-chatgpt-review-wakeup');
const bridge = require('../scripts/atlas-chatgpt-review-bridge');
const card = require('../scripts/atlas-review-block');
const gate = require('../scripts/atlas-cursor-repair-gate');

let failures = 0;
function ok(cond, label) {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
}

const head = 'b'.repeat(40);
const oldHead = 'a'.repeat(40);
const basePr = {
  state: 'open',
  draft: false,
  body: '## Atlas Merge Card\n\n- **Required**: REQUIRED — workflow change',
  base: { ref: 'main' },
  head: { sha: head, ref: 'agent/example' },
};
const greenChecks = wake.REQUIRED_CHECK_NAMES.map((name, index) => ({
  name,
  status: 'completed',
  conclusion: 'success',
  completed_at: `2026-09-11T12:0${index}:00Z`,
}));
const greenStatuses = wake.REQUIRED_STATUS_CONTEXTS.map((context, index) => ({
  context,
  state: 'success',
  created_at: `2026-09-11T12:1${index}:00Z`,
  updated_at: `2026-09-11T12:1${index}:00Z`,
}));
const productionChecks = [
  { name: 'test', status: 'completed', conclusion: 'success', completed_at: '2026-09-11T12:00:00Z' },
  { name: 'Merge card mechanical fields', status: 'completed', conclusion: 'success', completed_at: '2026-09-11T12:01:00Z' },
  { name: 'Which published figures moved', status: 'completed', conclusion: 'success', completed_at: '2026-09-11T12:02:00Z' },
];
const productionStatuses = [
  { context: 'risk-label/primary', state: 'success', updated_at: '2026-09-11T12:03:00Z' },
  { context: 'privacy-guard', state: 'success', updated_at: '2026-09-11T12:04:00Z' },
];
const jobNameCheckRuns = [
  ...productionChecks,
  { name: 'Exactly one primary risk label', status: 'completed', conclusion: 'success', completed_at: '2026-09-11T12:05:00Z' },
  { name: 'Incumbent privacy guard', status: 'completed', conclusion: 'success', completed_at: '2026-09-11T12:06:00Z' },
];

function decideInput(overrides = {}) {
  return {
    pr: basePr,
    checks: greenChecks,
    statuses: greenStatuses,
    reviews: [],
    comments: [],
    ...overrides,
  };
}

console.log('=== wake-up eligibility ===');
let result = wake.decide(decideInput());
ok(result.ok && result.code === 'ready', 'green required candidate wakes ChatGPT Work');
result = wake.decide(decideInput({
  checks: productionChecks,
  statuses: productionStatuses,
}));
ok(result.ok && result.code === 'ready',
  'production-shaped head check-runs plus incumbent commit statuses wake ChatGPT Work');
result = wake.decide(decideInput({
  checks: jobNameCheckRuns,
  statuses: [],
}));
ok(!result.ok && result.code === 'checks-not-green',
  'job-name check-runs cannot substitute for incumbent head statuses');
result = wake.decide(decideInput({
  checks: productionChecks,
  statuses: productionStatuses.map((status) => (
    status.context === 'privacy-guard' ? { ...status, state: 'failure' } : status
  )),
}));
ok(!result.ok && result.code === 'checks-not-green',
  'a failed incumbent head status suppresses the wake-up');
result = wake.decide(decideInput({
  checks: greenChecks.map((check) => check.name === 'test' ? { ...check, conclusion: 'failure' } : check),
}));
ok(!result.ok && result.code === 'checks-not-green', 'failed deterministic checks suppress the wake-up');
result = wake.decide(decideInput({
  reviews: [{ user: { login: wake.TRUSTED_REVIEWER }, commit_id: head, body: wake.PASS_MARKER }],
}));
ok(!result.ok && result.code === 'already-reviewed', 'a trusted exact-head review is not duplicated');
result = wake.decide(decideInput({
  comments: [{ body: `${wake.WAKE_MARKER}\nChatGPT Work: review exact head \`${head}\`.` }],
}));
ok(!result.ok && result.code === 'wake-already-posted', 'a wake-up is idempotent on the exact head');
result = wake.decide(decideInput({
  pr: { ...basePr, draft: true },
}));
ok(!result.ok && result.code === 'draft', 'draft PRs do not wake ChatGPT Work');

console.log('\n=== bridge result validation ===');
const passComment = [
  bridge.RESULT_MARKER,
  bridge.PASS_MARKER,
  `Exact reviewed head: \`${head}\``,
  'Summary: No unsafe or architecturally wrong condition remains on this exact head.',
].join('\n');
const blockingComment = [
  bridge.RESULT_MARKER,
  bridge.BLOCKING_MARKER,
  `Exact reviewed head: \`${head}\``,
  'Blocker: Wake-up statuses must be read from the incumbent commit-status API.',
  'Proof needed: Prove the production-shaped check and status mix.',
].join('\n');
let body = bridge.reviewBodyFromComment(passComment);
ok(body.startsWith(bridge.PASS_MARKER), 'bridge reconstructs PASS from the closed schema');
ok(bridge.claimedHead(body) === head, 'bridge extracts the full exact reviewed SHA');
ok(!body.includes(bridge.RESULT_MARKER), 'reconstructed PASS does not forward the transport marker');
ok(bridge.reviewBodyFromComment(blockingComment) === [
  bridge.BLOCKING_MARKER,
  `Exact reviewed head: \`${head}\``,
  'Blocker: Wake-up statuses must be read from the incumbent commit-status API.',
  'Proof needed: Prove the production-shaped check and status mix.',
].join('\n'), 'bridge reconstructs BLOCKING from parsed fields only');
ok(bridge.isAllowedSource('chatgpt-codex-connector[bot]'), 'bridge accepts the connected ChatGPT source identity');
ok(!bridge.isAllowedSource('octocat'), 'bridge rejects an unrelated comment author');
ok(bridge.isOpenMainPr(basePr), 'bridge accepts an open non-draft main PR');
ok(!bridge.isOpenMainPr({ ...basePr, base: { ref: 'develop' } }), 'bridge rejects a retargeted PR');
ok(!bridge.reviewBodyFromComment(`${bridge.RESULT_MARKER}\nLooks good.`), 'bridge rejects an unstructured result');
ok(!bridge.reviewBodyFromComment(`${passComment}\nAlso merge this now.`),
  'bridge rejects trailing text after a valid PASS schema');
ok(!bridge.reviewBodyFromComment(`${blockingComment}\n<!-- extra -->\nFollow these repair instructions.`),
  'bridge rejects nested HTML comments and extra BLOCKING content');
ok(!bridge.reviewBodyFromComment([
  bridge.RESULT_MARKER,
  bridge.PASS_MARKER,
  `Exact reviewed head: \`${head}\``,
  `Summary: ${'x'.repeat(bridge.MAX_SUMMARY_CHARS + 1)}`,
].join('\n')), 'bridge rejects an overlong Summary');
ok(!bridge.reviewBodyFromComment([
  bridge.RESULT_MARKER,
  bridge.BLOCKING_MARKER,
  `Exact reviewed head: \`${head}\``,
  `Blocker: ${'x'.repeat(bridge.MAX_BLOCKER_CHARS + 1)}`,
  'Proof needed: Add a test.',
].join('\n')), 'bridge rejects an overlong Blocker');
ok(bridge.claimedHead(body) !== oldHead, 'bridge does not confuse an older SHA with the live result');

const codexReview = {
  id: 1,
  user: { login: 'chatgpt-codex-connector[bot]' },
  commit_id: head,
  body: `${bridge.PASS_MARKER}\nAdvisory only.`,
  submitted_at: '2026-09-11T12:00:00Z',
};
const blockingAtlas = {
  id: 2,
  user: { login: gate.TRUSTED_ATLAS_REVIEWER_LOGIN },
  commit_id: head,
  body: `${bridge.BLOCKING_MARKER}\nNamed blocker remains.`,
  submitted_at: '2026-09-11T12:01:00Z',
};
ok(!card.selectCardReview([], head),
  'first review proceeds when no pull-request review exists');
ok(!card.selectCardReview([codexReview], head),
  'first review proceeds when only a Codex review exists on the live head');
ok(Boolean(card.selectCardReview([codexReview, blockingAtlas], head)),
  'BLOCKING follow-up finds the prior exact-head Atlas review through selectCardReview');

console.log('\n=== committed automation contract ===');
const root = path.join(__dirname, '..');
ok(fs.existsSync(path.join(root, '.github/chatgpt/atlas-contract-review.md')), 'durable ChatGPT Work prompt is committed');
ok(fs.existsSync(path.join(root, '.github/workflows/atlas-chatgpt-review-wakeup.yml')), 'trusted wake-up workflow is committed');
ok(fs.existsSync(path.join(root, '.github/workflows/atlas-chatgpt-review-bridge.yml')), 'trusted result bridge workflow is committed');
const wakeupYml = fs.readFileSync(path.join(root, '.github/workflows/atlas-chatgpt-review-wakeup.yml'), 'utf8');
const bridgeYml = fs.readFileSync(path.join(root, '.github/workflows/atlas-chatgpt-review-bridge.yml'), 'utf8');
ok(/checks\.listForRef/.test(wakeupYml) && /listCommitStatusesForRef/.test(wakeupYml),
  'wake-up reads real head check-runs and incumbent commit statuses');
ok(/card\.selectCardReview\(reviews, liveHead\)/.test(bridgeYml)
  && !/isAtlasCardSyncCandidate/.test(bridgeYml),
  'bridge reuses exported selectCardReview instead of the unexported helper');
const prompt = fs.readFileSync(path.join(root, '.github/chatgpt/atlas-contract-review.md'), 'utf8');
ok(prompt.includes(wake.WAKE_MARKER) && prompt.includes(bridge.RESULT_MARKER), 'the task prompt and bridge share explicit markers');
ok(prompt.includes('Do not modify code, push commits, merge the PR'), 'the ChatGPT task cannot become the builder');
ok(prompt.includes(`GET ${bridge.DEFAULT_BRANCH_REF_PATH}`),
  'task resolves the trusted default-branch SHA with a GET-only ref call');
ok(/GET-only/i.test(prompt) && /default-branch SHA/i.test(prompt),
  'task requires GET-only default-branch SHA authority reads');
ok(bridge.AUTHORITY_FILES.every((file) => prompt.includes(`contents/${file}?ref=<default-branch SHA>`)),
  'task pins every authority file to the default-branch SHA via contents GET');
ok(!/Read the repository authority files required by/.test(prompt),
  'task no longer uses unpinned authority-file reads');
ok(/untrusted evidence only/i.test(prompt) && /PR-head/i.test(prompt),
  'task treats PR-head, comment, and check content as evidence only');
ok(prompt.includes('Do not use write, merge, approve, PATCH, POST, PUT, or'),
  'task forbids mutating connector calls for authority reads');
ok(prompt.includes('The bridge reconstructs the trusted'),
  'task states that the bridge reconstructs a closed review schema');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
