'use strict';
/* Mechanical coverage for Atlas merge-card review-block sync.
 * `node test-atlas-review-block.js`
 *
 * Proves the helper and shipped workflows: a trusted exact-head PASS may
 * write PASS; stale / wrong-reviewer / issue-comment / malformed bodies fail
 * closed; NOT PASS and BLOCKING update the block; a successful Atlas repair
 * push moves the new head to PENDING without carrying the old outcome; PASS
 * does not start Cursor; the dispatcher stays secret-free and read-only; and
 * PR-body mutation lives only on the trusted default-branch workflow.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sourceText } = require('./test-source-text');
const gate = require('./scripts/atlas-cursor-repair-gate');
const block = require('./scripts/atlas-review-block');

const DISPATCH = path.join(__dirname, '.github/workflows/codex-cursor-repair-dispatch.yml');
const REPAIR = path.join(__dirname, '.github/workflows/codex-cursor-repair.yml');
const MERGE_CARD = path.join(__dirname, '.github/workflows/merge-card-check.yml');
const HELPER = path.join(__dirname, 'scripts/atlas-review-block.js');

let failures = 0;

function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const UNIQUE_BEFORE = 'UNIQUE-BEFORE-REVIEW-BLOCK-9f3c';
const UNIQUE_AFTER = 'UNIQUE-AFTER-REVIEW-BLOCK-2e1d';
const ATLAS_FINDING = 'Named blocker: the repair gate must re-validate the reviewed SHA before mutation.';

function sampleBody(overrides = {}) {
  const required = overrides.Required || 'REQUIRED — review machinery changed';
  const head = overrides['Exact reviewed head'] || 'N/A';
  const reviewer = overrides.Reviewer || 'N/A';
  const outcome = overrides['Review outcome'] || 'N/A';
  const findings = overrides['Findings and fix verification'] || 'N/A';
  return [
    '## 🟦 Atlas Merge Card',
    '',
    '| Field | Value |',
    '|---|---|',
    '| **Title** | Sync the review block |',
    `| **Current-state verdict** | STILL BROKEN — ${UNIQUE_BEFORE} |`,
    '',
    '### Current-state evidence',
    '',
    `Evidence token ${UNIQUE_BEFORE} must survive a review-block patch.`,
    '',
    '### Atlas Contract / Systems Review',
    '',
    '<!--',
    '  Closed forms enforced by CI.',
    '-->',
    '',
    `- **Required**: ${required}`,
    `- **Exact reviewed head**: ${head}`,
    `- **Reviewer**: ${reviewer}`,
    `- **Review outcome**: ${outcome}`,
    `- **Findings and fix verification**: ${findings}`,
    '',
    '### Additional findings',
    '',
    `Do not touch this section. ${UNIQUE_AFTER}`,
    '',
  ].join('\n');
}

function reviewRequest(overrides = {}) {
  return {
    source: 'pull_request_review',
    reviewerLogin: gate.TRUSTED_ATLAS_REVIEWER_LOGIN,
    reviewedSha: HEAD,
    currentHeadSha: HEAD,
    reviewBody: `Atlas Contract / Systems Review — PASS\n\nNo blockers remain.`,
    pr: {
      number: 53,
      state: 'open',
      base: { ref: 'main' },
      head: { sha: HEAD, ref: 'agent/example' },
    },
    ...overrides,
  };
}

function fieldValues(body) {
  const inspected = block.inspectReviewBlock(body);
  if (!inspected.ok) return inspected;
  const values = {};
  for (const label of block.REVIEW_FIELDS) {
    values[label] = inspected.fields[label];
  }
  return { ok: true, values, inspected };
}

function changedIndexes(before, after) {
  const max = Math.max(before.length, after.length);
  const indexes = [];
  for (let i = 0; i < max; i += 1) {
    if (before[i] !== after[i]) indexes.push(i);
  }
  return indexes;
}

console.log('=== 1. valid exact-head PASS updates review block to PASS ===');
const passEval = block.evaluateTrustedReview(reviewRequest());
ok(passEval.ok && passEval.outcome === 'PASS' && passEval.skipCursor === true,
  'trusted exact-head PASS is eligible to write the card', passEval.code);
ok(passEval.fields['Review outcome'] === 'PASS', 'PASS fields record Review outcome: PASS');
ok(passEval.fields.Reviewer === 'ChatGPT', 'PASS fields record Reviewer: ChatGPT');
ok(passEval.fields['Exact reviewed head'] === HEAD, 'PASS fields record the current head SHA');
ok(passEval.fields['Findings and fix verification'] === block.PASS_FINDINGS,
  'PASS findings are the exact trusted-review record');

const passPatched = block.patchReviewBlock(sampleBody(), passEval.fields);
ok(passPatched.ok, 'PASS patch applies to a well-formed review block', passPatched.reason);
const passFields = fieldValues(passPatched.body);
ok(passFields.ok && passFields.values['Review outcome'] === 'PASS',
  'patched block reads Review outcome: PASS');
ok(passFields.values['Exact reviewed head'] === HEAD, 'patched block reads the reviewed SHA');
ok(passFields.values.Reviewer === 'ChatGPT', 'patched block reads Reviewer: ChatGPT');

console.log('\n=== 2. PASS on stale SHA is rejected ===');
const stalePass = block.evaluateTrustedReview(reviewRequest({
  reviewedSha: HEAD,
  currentHeadSha: NEXT,
  pr: { number: 53, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' } },
}));
ok(!stalePass.ok && stalePass.code === 'stale-head',
  'stale PASS cannot update the card', stalePass.code);
ok(!stalePass.fields, 'stale PASS does not emit PASS fields');

console.log('\n=== 3. PASS from wrong reviewer is rejected ===');
for (const login of ['octocat', 'github-actions[bot]', 'cursor[bot]', 'chatgpt-codex-connector[bot]', 'ChatGPT', 'Tc5v5s64ym-sketch']) {
  const result = block.evaluateTrustedReview(reviewRequest({ reviewerLogin: login }));
  ok(!result.ok && result.code === 'untrusted-reviewer',
    `PASS from ${login} cannot write the card`, result.code);
}

console.log('\n=== 4. issue comment cannot produce PASS ===');
const commentPass = block.evaluateTrustedReview(reviewRequest({ source: 'issue_comment' }));
ok(!commentPass.ok && commentPass.code === 'not-pull-request-review',
  'an issue_comment source cannot write PASS', commentPass.code);
const missingSource = block.evaluateTrustedReview(reviewRequest({ source: undefined }));
ok(!missingSource.ok && missingSource.code === 'not-pull-request-review',
  'omitting source fails closed instead of inferring a review', missingSource.code);
ok(block.selectCardReview([{
  id: 9,
  user: { login: gate.TRUSTED_ATLAS_REVIEWER_LOGIN },
  commit_id: HEAD,
  body: 'Atlas Contract / Systems Review — PASS\n',
  submitted_at: '2026-08-15T00:00:00Z',
}], HEAD).id === 9, 'select-card-review still only reads pull-request review objects');

console.log('\n=== 5. NOT PASS updates review block correctly ===');
const notPassEval = block.evaluateTrustedReview(reviewRequest({
  reviewBody: `Atlas Contract / Systems Review — NOT PASS\n\n${ATLAS_FINDING}`,
}));
ok(notPassEval.ok && notPassEval.outcome === 'NOT PASS' && notPassEval.skipCursor === false,
  'trusted exact-head NOT PASS is eligible', notPassEval.code);
ok(notPassEval.fields['Review outcome'] === 'NOT PASS', 'NOT PASS fields record that outcome');
ok(notPassEval.fields['Findings and fix verification'].includes('Named blocker'),
  'NOT PASS findings summarize the submitted review');
const notPassPatched = block.patchReviewBlock(sampleBody(), notPassEval.fields);
ok(notPassPatched.ok && fieldValues(notPassPatched.body).values['Review outcome'] === 'NOT PASS',
  'patched block records NOT PASS');

console.log('\n=== 6. BLOCKING updates review block correctly ===');
const blockingEval = block.evaluateTrustedReview(reviewRequest({
  reviewBody: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
}));
ok(blockingEval.ok && blockingEval.outcome === 'BLOCKING' && blockingEval.skipCursor === false,
  'trusted exact-head BLOCKING is eligible', blockingEval.code);
const blockingPatched = block.patchReviewBlock(sampleBody(), blockingEval.fields);
ok(blockingPatched.ok && fieldValues(blockingPatched.body).values['Review outcome'] === 'BLOCKING',
  'patched block records BLOCKING');

console.log('\n=== 7. automated repair push moves new head to PENDING ===');
const pendingEval = block.evaluateRepairPending({
  newHeadSha: NEXT,
  body: sampleBody({
    Required: 'REQUIRED — workflows',
    'Exact reviewed head': HEAD,
    Reviewer: 'ChatGPT',
    'Review outcome': 'BLOCKING',
    'Findings and fix verification': ATLAS_FINDING,
  }),
  pr: { number: 53, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' } },
});
ok(pendingEval.ok && pendingEval.outcome === 'PENDING',
  'confirmed new head is eligible for PENDING', pendingEval.code);
ok(pendingEval.fields['Exact reviewed head'] === NEXT, 'PENDING fields use the new head SHA');
ok(pendingEval.fields['Review outcome'] === 'PENDING', 'PENDING fields do not copy BLOCKING');
ok(pendingEval.fields['Findings and fix verification'] === block.PENDING_FINDINGS,
  'PENDING findings are the awaiting-re-review record');
const pendingPatched = block.patchReviewBlock(sampleBody({
  Required: 'REQUIRED — workflows',
  'Exact reviewed head': HEAD,
  Reviewer: 'ChatGPT',
  'Review outcome': 'BLOCKING',
  'Findings and fix verification': ATLAS_FINDING,
}), pendingEval.fields);
ok(pendingPatched.ok, 'PENDING patch applies', pendingPatched.reason);

console.log('\n=== 8. old reviewed SHA is not carried forward as reviewed ===');
const pendingValues = fieldValues(pendingPatched.body).values;
ok(pendingValues['Exact reviewed head'] === NEXT, 'Exact reviewed head is the new SHA, not the old one');
ok(pendingValues['Review outcome'] === 'PENDING', 'previous BLOCKING outcome is not copied onto the new SHA');
ok(!pendingEval.fields['Exact reviewed head'].includes(HEAD),
  'PENDING fields do not mention the previously reviewed SHA');
const unconfirmed = block.evaluateRepairPending({
  newHeadSha: NEXT,
  body: sampleBody({ Required: 'REQUIRED — workflows' }),
  pr: { number: 53, state: 'open', base: { ref: 'main' }, head: { sha: HEAD, ref: 'agent/example' } },
});
ok(!unconfirmed.ok && unconfirmed.code === 'head-not-confirmed',
  'PENDING is refused when the live PR head is not the pushed SHA', unconfirmed.code);

console.log('\n=== 9. duplicate review sections fail closed ===');
const duplicate = `${sampleBody()}\n### Atlas Contract / Systems Review\n\n- **Required**: REQUIRED\n`;
const dupLocate = block.patchReviewBlock(duplicate, passEval.fields);
ok(!dupLocate.ok && dupLocate.code === 'duplicate-review-section',
  'duplicate review headings are not rewritten', dupLocate.code);

console.log('\n=== 10. missing review section fails closed ===');
const missing = block.patchReviewBlock('## 🟦 Atlas Merge Card\n\nNo review block.\n', passEval.fields);
ok(!missing.ok && missing.code === 'missing-review-section',
  'a missing review section is not rewritten', missing.code);

console.log('\n=== 11. unrelated PR body content is byte-for-byte preserved ===');
const original = sampleBody({
  Required: 'REQUIRED — keep this exact Required line',
  'Exact reviewed head': 'N/A',
  Reviewer: 'N/A',
  'Review outcome': 'N/A',
  'Findings and fix verification': 'N/A',
});
const preserved = block.patchReviewBlock(original, passEval.fields);
ok(preserved.ok, 'well-formed body still patches', preserved.reason);
ok(preserved.body.includes(UNIQUE_BEFORE) && preserved.body.includes(UNIQUE_AFTER),
  'unique tokens outside the review block remain');
const beforeReview = original.slice(0, original.indexOf('### Atlas Contract / Systems Review'));
const afterReview = original.slice(original.indexOf('### Additional findings'));
const patchedBefore = preserved.body.slice(0, preserved.body.indexOf('### Atlas Contract / Systems Review'));
const patchedAfter = preserved.body.slice(preserved.body.indexOf('### Additional findings'));
ok(beforeReview === patchedBefore, 'bytes before the review heading are unchanged');
ok(afterReview === patchedAfter, 'bytes from the next heading onward are unchanged');
ok(preserved.body.includes('- **Required**: REQUIRED — keep this exact Required line'),
  'Required is left byte-for-byte unchanged');

console.log('\n=== 12. only the five review-block field values change ===');
const origInspect = block.inspectReviewBlock(original);
const newInspect = block.inspectReviewBlock(preserved.body);
ok(origInspect.ok && newInspect.ok, 'both original and patched bodies still parse');
ok(origInspect.fields.Required === newInspect.fields.Required, 'Required value is unchanged');
ok(newInspect.fields['Exact reviewed head'] === HEAD, 'Exact reviewed head value changed');
ok(newInspect.fields.Reviewer === 'ChatGPT', 'Reviewer value changed');
ok(newInspect.fields['Review outcome'] === 'PASS', 'Review outcome value changed');
ok(newInspect.fields['Findings and fix verification'] === block.PASS_FINDINGS,
  'Findings value changed');
const origSection = origInspect.section;
const newSection = newInspect.section;
let reconstructed = origSection;
for (const label of block.PATCH_FIELDS) {
  const re = new RegExp(
    `^([ \\t]*[-*][ \\t]*\\*{0,2}${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*{0,2}[ \\t]*:)[ \\t]*(.*)$`,
    'im',
  );
  reconstructed = reconstructed.replace(re, `$1 ${newInspect.fields[label]}`);
}
ok(reconstructed === newSection,
  'the patched section equals the original with only the four writable field values replaced');
ok(changedIndexes(original, preserved.body).length > 0, 'the patch is not a no-op');

console.log('\n=== helper refuses invented PASS ===');
const invented = block.patchReviewBlock(sampleBody(), {
  'Exact reviewed head': HEAD,
  Reviewer: 'ChatGPT',
  'Review outcome': 'PASS',
  'Findings and fix verification': 'looks good to me',
});
ok(!invented.ok && invented.code === 'pass-not-authorized',
  'PASS cannot be written with inferred findings', invented.code);
const leadingSpace = block.evaluateTrustedReview(reviewRequest({
  reviewBody: ` Atlas Contract / Systems Review — PASS\n`,
}));
ok(!leadingSpace.ok && leadingSpace.code === 'not-atlas-review-marker',
  'leading whitespace is not an exact PASS marker', leadingSpace.code);

console.log('\n=== CLI: evaluate-review / patch / select-card-review ===');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-review-block-'));
const reqFile = path.join(tmp, 'request.json');
const bodyFile = path.join(tmp, 'body.md');
const fieldsFile = path.join(tmp, 'fields.json');
const reviewsFile = path.join(tmp, 'reviews.json');
fs.writeFileSync(reqFile, JSON.stringify(reviewRequest()));
fs.writeFileSync(bodyFile, original);
const evalCli = spawnSync(process.execPath, [HELPER, 'evaluate-review', reqFile], { encoding: 'utf8' });
ok(evalCli.status === 0 && /"outcome": "PASS"/.test(evalCli.stdout),
  'evaluate-review CLI exits 0 for trusted PASS');
const evalJson = JSON.parse(evalCli.stdout);
fs.writeFileSync(fieldsFile, JSON.stringify(evalJson.fields));
const patchCli = spawnSync(process.execPath, [HELPER, 'patch', bodyFile, fieldsFile], { encoding: 'utf8' });
ok(patchCli.status === 0 && /- \*\*Review outcome\*\*: PASS/.test(patchCli.stdout),
  'patch CLI writes Review outcome: PASS');
fs.writeFileSync(reviewsFile, JSON.stringify([{
  id: 88,
  user: { login: gate.TRUSTED_ATLAS_REVIEWER_LOGIN },
  commit_id: HEAD,
  submitted_at: '2026-08-15T02:00:00Z',
  body: 'Atlas Contract / Systems Review — PASS\n',
}]));
const selectCli = spawnSync(process.execPath, [HELPER, 'select-card-review', reviewsFile, HEAD], { encoding: 'utf8' });
ok(selectCli.status === 0 && selectCli.stdout === '88',
  'select-card-review CLI returns the trusted PASS review id');
const staleCli = spawnSync(process.execPath, [HELPER, 'evaluate-review', reqFile], {
  encoding: 'utf8',
});
ok(staleCli.status === 0, 'control: the written request is still a current-head PASS');
fs.writeFileSync(reqFile, JSON.stringify(reviewRequest({
  currentHeadSha: NEXT,
  pr: { number: 53, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' } },
})));
const staleEvalCli = spawnSync(process.execPath, [HELPER, 'evaluate-review', reqFile], { encoding: 'utf8' });
ok(staleEvalCli.status === 2 && /stale-head/.test(staleEvalCli.stdout),
  'evaluate-review CLI skips a stale PASS without writing fields');

console.log('\n=== shipped workflows ===');
const dispatch = sourceText(fs.readFileSync(DISPATCH, 'utf8'));
const repair = sourceText(fs.readFileSync(REPAIR, 'utf8'));
const mergeCard = sourceText(fs.readFileSync(MERGE_CARD, 'utf8'));

console.log('\n=== 13. PASS does not invoke Cursor repair ===');
ok(/startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — PASS'\)/.test(dispatch),
  'dispatch records trusted Atlas PASS so the card can sync');
ok(/skipCursor|card_outcome|PASS does not start/.test(repair)
  || /card_outcome=PASS/.test(repair)
  || /Trusted Atlas PASS/.test(repair),
  'trusted workflow has an explicit PASS path that skips Cursor');
ok(/needs\.gate\.outputs\.eligible == 'true'/.test(repair),
  'Cursor repair job still requires gate eligible=true');
ok((repair.match(/cursor-agent --print/g) || []).length === 1,
  'one cursor-agent invocation remains, on the eligible repair path');

console.log('\n=== 14. NOT PASS/BLOCKING still use the existing Cursor repair path ===');
ok(/startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — NOT PASS'\)/.test(dispatch)
  && /startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — BLOCKING'\)/.test(dispatch),
  'dispatch still accepts exact-prefix NOT PASS and BLOCKING');
ok(/atlas-cursor-repair-gate\.js evaluate/.test(repair)
  && /cursor-agent --print/.test(repair),
  'trusted workflow still evaluates the existing gate and runs Cursor');
ok(/chatgpt-codex-connector\[bot\]/.test(dispatch),
  'Codex dispatcher identities are unchanged');

console.log('\n=== 15. dispatcher remains secret-free and read-only ===');
ok(!/\$\{\{\s*secrets\./.test(dispatch), 'dispatch workflow references no secrets');
ok(!/CURSOR_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(dispatch),
  'dispatch names neither automation secret');
ok(/permissions:\n  contents: read\n  pull-requests: read\n/.test(dispatch),
  'dispatch GITHUB_TOKEN is contents:read and pull-requests:read');
ok(!/contents:\s*write|pull-requests:\s*write|issues:\s*write/.test(dispatch),
  'dispatch is granted no write permissions');
ok(!/pulls\/\$\{|pulls\/\$\{\{/.test(dispatch) && !/--method PATCH/.test(dispatch),
  'dispatch does not mutate a pull request body');

console.log('\n=== 16. PR-body mutation occurs only in trusted default-branch workflow ===');
ok(/workflow_run:/.test(repair) && !/^\s+pull_request_review:/m.test(repair),
  'secret-bearing workflow is still not PR-review triggered');
ok(/github\.event\.repository\.default_branch/.test(repair),
  'trusted scripts still come from the default branch');
ok(/atlas-review-block\.js/.test(repair),
  'trusted workflow calls the review-block helper');
ok(/pull-requests:\s*write/.test(repair),
  'trusted workflow has pull-requests:write so it can edit the PR body');
ok(!/contents:\s*write/.test(repair), 'GITHUB_TOKEN is still not granted contents:write');
ok(/atlas-review-block\.js/.test(repair.split(/^  push:\n/m)[0] || repair),
  'card sync from a trusted review runs in the default-branch gate path');

console.log('\n=== 17. merge-card check is expected to rerun after body edit ===');
ok(/types:\s*\[opened, edited, synchronize, reopened\]/.test(mergeCard),
  'merge-card-check still listens for pull_request edited');
ok(/pull_request:/.test(mergeCard), 'merge-card-check is a pull_request workflow');

console.log('\n=== repair-path contracts for card sync and PENDING ===');
const gateJob = (repair.split(/^  gate:\n/m)[1] || '').split(/^  repair:\n/m)[0];
const repairJob = (repair.split(/^  repair:\n/m)[1] || '').split(/^  test:\n/m)[0];
const pushJob = repair.split(/^  push:\n/m)[1] || '';
ok(/evaluate-review/.test(gateJob) && /atlas-review-block\.js patch/.test(gateJob),
  'gate job evaluates a trusted review and patches only through the helper');
ok(/select-card-review/.test(gateJob),
  'gate job selects trusted Atlas PASS/NOT PASS/BLOCKING reviews for the card');
ok(!/evaluate-review/.test(repairJob) && !/atlas-review-block\.js patch/.test(repairJob),
  'Cursor repair job does not patch the PR body');
ok(/evaluate-pending/.test(pushJob) && /atlas-review-block\.js"? patch/.test(pushJob),
  'push job moves a confirmed new head to PENDING through the helper');
const confirmCallAt = pushJob.search(/atlas-github-pr-head-sync\.js"?\s+confirm/);
ok(/git push/.test(pushJob) && pushJob.indexOf('git push') < confirmCallAt
  && confirmCallAt < pushJob.indexOf('evaluate-pending'),
  'PENDING evaluation happens only after live PR-head confirmation');
ok(/atlas-github-pr-head-sync\.js/.test(pushJob) && /live_head=/.test(pushJob),
  'push job still validates the confirmed live PR head before PENDING');
ok(/auto-merge|enablePullRequestAutoMerge|merge_method/.test(repair) === false,
  'no auto-merge machinery');
ok(!/git rebase|git merge|git push --force|git push -f/.test(pushJob),
  'push path still has no rebase, merge, or force-push');
ok(/atlas-trusted-scripts\/atlas-review-block\.js/.test(pushJob),
  'push job preserves the trusted review-block helper outside the PR worktree');

const skipNotRequired = block.evaluateRepairPending({
  newHeadSha: NEXT,
  body: sampleBody({ Required: 'NOT REQUIRED — docs only' }),
  pr: { number: 53, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' } },
});
ok(!skipNotRequired.ok && skipNotRequired.code === 'not-required-skip',
  'a NOT REQUIRED card is not rewritten to PENDING after a repair');

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
