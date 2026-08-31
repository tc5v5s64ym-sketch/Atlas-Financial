'use strict';

const fs = require('fs');
const path = require('path');
const helper = require('../scripts/atlas-api-rereview');

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

console.log('\n=== manual systems-review handoff contract ===');
const retiredWorkflowPaths = [
  '.github/workflows/atlas-first-review-dispatch.yml',
  '.github/workflows/atlas-first-review.yml',
  '.github/workflows/atlas-rereview-dispatch.yml',
  '.github/workflows/atlas-rereview.yml',
];
for (const retiredPath of retiredWorkflowPaths) {
  ok(!fs.existsSync(path.join(__dirname, '..', retiredPath)),
    `retired paid reviewer workflow is absent: ${retiredPath}`);
}

const claude = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
const chatgpt = fs.readFileSync(path.join(__dirname, '..', 'CHATGPT.md'), 'utf8');
const riskLabels = fs.readFileSync(path.join(__dirname, '..', 'docs/RISK_LABELS.md'), 'utf8');

ok(/deliver the review request directly to the active ChatGPT\s+decision-desk session/.test(claude),
  'governance requires a direct handoff to the active ChatGPT decision desk');
ok(/cannot\s+wake ChatGPT and does not start or satisfy this review/.test(claude),
  'governance says GitHub artifacts cannot wake or satisfy ChatGPT review');
ok(/Paid OpenAI reviewer\s+workflows are retired\. Do not wait for them\./.test(claude),
  'governance retires the misleading paid reviewer wait');
ok(/## Required review handoff/.test(chatgpt)
  && /pull request number, current full head SHA/.test(chatgpt),
  'the ChatGPT adapter requires PR number and exact head in the direct request');
ok(/successful workflow\s+as a request to ChatGPT/.test(chatgpt)
  && /cannot wake this session/.test(chatgpt),
  'the ChatGPT adapter rejects a green workflow as a review request');
ok(/After a\s+`PASS`[\s\S]*record the exact reviewed SHA/.test(chatgpt),
  'the manual handoff records PASS on the exact reviewed head');
ok(/Their parked\s+versions exited successfully without performing a review/.test(riskLabels),
  'risk documentation records the demonstrated false-progress failure');
ok(/do not wake ChatGPT, satisfy the review, or add API spend/.test(riskLabels),
  'risk documentation keeps manual review required without API spend');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
