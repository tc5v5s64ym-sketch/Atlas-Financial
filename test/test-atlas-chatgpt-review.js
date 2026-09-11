'use strict';

const fs = require('fs');
const path = require('path');
const wake = require('../scripts/atlas-chatgpt-review-wakeup');
const bridge = require('../scripts/atlas-chatgpt-review-bridge');

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

console.log('=== wake-up eligibility ===');
let result = wake.decide({ pr: basePr, checks: greenChecks, reviews: [], comments: [] });
ok(result.ok && result.code === 'ready', 'green required candidate wakes ChatGPT Work');
result = wake.decide({
  pr: basePr,
  checks: greenChecks.map((check) => check.name === 'test' ? { ...check, conclusion: 'failure' } : check),
  reviews: [],
  comments: [],
});
ok(!result.ok && result.code === 'checks-not-green', 'failed deterministic checks suppress the wake-up');
result = wake.decide({
  pr: basePr,
  checks: greenChecks,
  reviews: [{ user: { login: wake.TRUSTED_REVIEWER }, commit_id: head, body: wake.PASS_MARKER }],
  comments: [],
});
ok(!result.ok && result.code === 'already-reviewed', 'a trusted exact-head review is not duplicated');
result = wake.decide({
  pr: basePr,
  checks: greenChecks,
  reviews: [],
  comments: [{ body: `${wake.WAKE_MARKER}\nChatGPT Work: review exact head \`${head}\`.` }],
});
ok(!result.ok && result.code === 'wake-already-posted', 'a wake-up is idempotent on the exact head');
result = wake.decide({
  pr: { ...basePr, draft: true },
  checks: greenChecks,
  reviews: [],
  comments: [],
});
ok(!result.ok && result.code === 'draft', 'draft PRs do not wake ChatGPT Work');

console.log('\n=== bridge result validation ===');
const passComment = [
  bridge.RESULT_MARKER,
  bridge.PASS_MARKER,
  `Exact reviewed head: \`${head}\``,
  'Summary: No unsafe or architecturally wrong condition remains on this exact head.',
].join('\n');
let body = bridge.reviewBodyFromComment(passComment);
ok(body.startsWith(bridge.PASS_MARKER), 'bridge strips only the transport marker from PASS');
ok(bridge.claimedHead(body) === head, 'bridge extracts the full exact reviewed SHA');
ok(bridge.isAllowedSource('chatgpt-codex-connector[bot]'), 'bridge accepts the connected ChatGPT source identity');
ok(!bridge.isAllowedSource('octocat'), 'bridge rejects an unrelated comment author');
ok(bridge.isOpenMainPr(basePr), 'bridge accepts an open non-draft main PR');
ok(!bridge.isOpenMainPr({ ...basePr, base: { ref: 'develop' } }), 'bridge rejects a retargeted PR');
ok(!bridge.reviewBodyFromComment(`${bridge.RESULT_MARKER}\nLooks good.`), 'bridge rejects an unstructured result');
ok(bridge.claimedHead(body) !== oldHead, 'bridge does not confuse an older SHA with the live result');

console.log('\n=== committed automation contract ===');
const root = path.join(__dirname, '..');
ok(fs.existsSync(path.join(root, '.github/chatgpt/atlas-contract-review.md')), 'durable ChatGPT Work prompt is committed');
ok(fs.existsSync(path.join(root, '.github/workflows/atlas-chatgpt-review-wakeup.yml')), 'trusted wake-up workflow is committed');
ok(fs.existsSync(path.join(root, '.github/workflows/atlas-chatgpt-review-bridge.yml')), 'trusted result bridge workflow is committed');
const prompt = fs.readFileSync(path.join(root, '.github/chatgpt/atlas-contract-review.md'), 'utf8');
ok(prompt.includes(wake.WAKE_MARKER) && prompt.includes(bridge.RESULT_MARKER), 'the task prompt and bridge share explicit markers');
ok(prompt.includes('Do not modify code, push commits, merge the PR'), 'the ChatGPT task cannot become the builder');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
