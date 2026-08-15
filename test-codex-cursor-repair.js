'use strict';
/* Mechanical coverage for Codex / trusted Atlas → Cursor repair.
 * `node test-codex-cursor-repair.js`
 *
 * Proves the gate predicates and the shipped workflow contracts: genuine
 * Codex still accepted, trusted owner Atlas NOT PASS / BLOCKING accepted,
 * PASS / unrelated / arbitrary / stale / empty Atlas rejected, round cap,
 * exact-SHA pin after the gate, no untrusted PR code in a secret-bearing
 * job, automation-token push, Atlas findings in the Cursor prompt, and
 * both lanes using the same downstream repair path.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sourceText } = require('./test-source-text');
const gate = require('./scripts/atlas-cursor-repair-gate');

const DISPATCH = path.join(__dirname, '.github/workflows/codex-cursor-repair-dispatch.yml');
const REPAIR = path.join(__dirname, '.github/workflows/codex-cursor-repair.yml');
const DENY_GIT = path.join(__dirname, 'scripts/atlas-cursor-repair-deny-git.sh');
const DENY_GH = path.join(__dirname, 'scripts/atlas-cursor-repair-deny-gh.sh');

let failures = 0;

function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

const HEAD = 'a'.repeat(40);
const NEXT = 'b'.repeat(40);
const ATLAS_FINDING = 'Named blocker: the repair gate must re-validate the reviewed SHA before mutation.';

function request(overrides = {}) {
  return {
    reviewerLogin: 'chatgpt-codex-connector[bot]',
    reviewedSha: HEAD,
    currentHeadSha: HEAD,
    reviewBody: '### Codex Review',
    reviewComments: [{
      body: 'P1: the workflow retriggers on synchronize.',
      user: { login: 'chatgpt-codex-connector[bot]' },
    }],
    stateComments: [],
    pr: {
      number: 45,
      state: 'open',
      base: { ref: 'main' },
      head: { sha: HEAD, ref: 'agent/example' },
    },
    ...overrides,
  };
}

function atlasRequest(overrides = {}) {
  return request({
    reviewerLogin: gate.TRUSTED_ATLAS_REVIEWER_LOGIN,
    reviewBody: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
    reviewComments: [],
    ...overrides,
  });
}

console.log('=== genuine Codex trigger accepted ===');
const accepted = gate.evaluateRepairRequest(request());
ok(accepted.ok && accepted.code === 'ok', 'Codex connector on current head is eligible', accepted.code);
ok(accepted.nextRound === 1, 'first eligible repair is round 1');
ok(accepted.lane === 'codex', 'genuine Codex uses the codex lane');

console.log('\n=== owner Atlas NOT PASS accepted ===');
const atlasNotPass = gate.evaluateRepairRequest(atlasRequest({
  reviewBody: `Atlas Contract / Systems Review — NOT PASS\n\n${ATLAS_FINDING}`,
}));
ok(atlasNotPass.ok && atlasNotPass.code === 'ok' && atlasNotPass.lane === 'atlas',
  'owner Atlas NOT PASS on current head is eligible', atlasNotPass.code);
ok(atlasNotPass.nextRound === 1, 'Atlas NOT PASS starts at round 1');

console.log('\n=== owner Atlas BLOCKING accepted ===');
const atlasBlocking = gate.evaluateRepairRequest(atlasRequest());
ok(atlasBlocking.ok && atlasBlocking.code === 'ok' && atlasBlocking.lane === 'atlas',
  'owner Atlas BLOCKING on current head is eligible', atlasBlocking.code);
ok(atlasBlocking.nextRound === 1, 'Atlas BLOCKING starts at round 1');

console.log('\n=== owner Atlas PASS rejected ===');
const atlasPass = gate.evaluateRepairRequest(atlasRequest({
  reviewBody: `Atlas Contract / Systems Review — PASS\n\n${ATLAS_FINDING}`,
}));
ok(!atlasPass.ok && atlasPass.code === 'atlas-pass',
  'owner Atlas PASS does not start a repair', atlasPass.code);

console.log('\n=== owner unrelated review rejected ===');
const ownerUnrelated = gate.evaluateRepairRequest(atlasRequest({
  reviewBody: 'Looks good. Please merge when CI is green.',
}));
ok(!ownerUnrelated.ok && ownerUnrelated.code === 'not-atlas-blocking-review',
  'ordinary owner review does not start a repair', ownerUnrelated.code);
const ownerCommentOnly = gate.evaluateRepairRequest(atlasRequest({
  reviewBody: 'LGTM',
  stateComments: [
    `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
  ],
}));
ok(!ownerCommentOnly.ok && ownerCommentOnly.code === 'not-atlas-blocking-review',
  'an issue comment cannot supply the Atlas trigger', ownerCommentOnly.code);

console.log('\n=== arbitrary reviewer Atlas-looking text rejected ===');
for (const login of ['octocat', 'github-actions[bot]', 'cursor[bot]', 'dependabot[bot]', 'ChatGPT', 'Tc5v5s64ym-sketch']) {
  const result = gate.evaluateRepairRequest(atlasRequest({ reviewerLogin: login }));
  ok(!result.ok && result.code === 'not-codex-reviewer',
    `rejects Atlas-looking text from ${login}`, result.code);
}
ok(gate.isGenuineCodexReviewer(gate.TRUSTED_ATLAS_REVIEWER_LOGIN) === false,
  'trusted Atlas login is not treated as Codex');
ok(gate.isTrustedAtlasReviewer('tc5v5s64ym-sketch') === true, 'trusted Atlas login matches exactly');
ok(gate.isTrustedAtlasReviewer('Tc5v5s64ym-sketch') === false, 'trusted Atlas login is case-sensitive');

console.log('\n=== stale Atlas review SHA rejected ===');
const staleAtlas = gate.evaluateRepairRequest(atlasRequest({
  currentHeadSha: NEXT,
  pr: { number: 45, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' } },
}));
ok(!staleAtlas.ok && staleAtlas.code === 'stale-head',
  'stale Atlas reviewed SHA is rejected', staleAtlas.code);

console.log('\n=== empty Atlas finding rejected ===');
ok(gate.evaluateRepairRequest(atlasRequest({
  reviewBody: 'Atlas Contract / Systems Review — BLOCKING',
})).code === 'empty-atlas-finding', 'BLOCKING marker with no finding text is rejected');
ok(gate.evaluateRepairRequest(atlasRequest({
  reviewBody: 'Atlas Contract / Systems Review — NOT PASS\n\n   \n',
})).code === 'empty-atlas-finding', 'NOT PASS marker with only whitespace is rejected');

console.log('\n=== arbitrary reviewer rejected ===');
for (const login of ['octocat', 'github-actions[bot]', 'cursor[bot]', 'dependabot[bot]', '']) {
  const result = gate.evaluateRepairRequest(request({ reviewerLogin: login }));
  ok(!result.ok && result.code === 'not-codex-reviewer',
    `rejects ${login || '(empty)'}`, result.code);
}

console.log('\n=== stale-head finding rejected ===');
const stale = gate.evaluateRepairRequest(request({ currentHeadSha: NEXT, pr: {
  number: 45, state: 'open', base: { ref: 'main' }, head: { sha: NEXT, ref: 'agent/example' },
} }));
ok(!stale.ok && stale.code === 'stale-head', 'reviewed SHA behind the live head is rejected', stale.code);
ok(!gate.isExactCurrentHead(HEAD, NEXT), 'exact-head helper distinguishes the two SHAs');

console.log('\n=== repair round cap enforced ===');
const cappedState = gate.serializeRepairState({
  rounds: 3,
  last_reviewed_sha: 'c'.repeat(40),
  last_repair_sha: 'd'.repeat(40),
  review_id: '1',
});
const capped = gate.evaluateRepairRequest(request({ stateComments: [cappedState] }));
ok(!capped.ok && capped.code === 'round-cap', 'a fourth automated round is rejected', capped.code);
ok(!gate.canStartRound({ rounds: 3 }), 'canStartRound is false at 3');
ok(gate.canStartRound({ rounds: 2 }), 'canStartRound is true at 2');
ok(gate.MAX_ROUNDS === 3, 'cap is exactly 3');

const atlasCapped = gate.evaluateRepairRequest(atlasRequest({ stateComments: [cappedState] }));
ok(!atlasCapped.ok && atlasCapped.code === 'round-cap',
  'Atlas lane is capped at the same 3 automated rounds', atlasCapped.code);

const already = gate.evaluateRepairRequest(request({
  stateComments: [gate.serializeRepairState({
    rounds: 1, last_reviewed_sha: HEAD, last_repair_sha: NEXT, review_id: '9',
  })],
}));
ok(!already.ok && already.code === 'already-repaired-this-head',
  'the same reviewed head is not repaired twice', already.code);

console.log('\n=== other closed-form rejects ===');
ok(gate.evaluateRepairRequest(request({
  pr: { number: 1, state: 'closed', base: { ref: 'main' }, head: { sha: HEAD, ref: 'x' } },
})).code === 'pr-not-open', 'closed PR rejected');
ok(gate.evaluateRepairRequest(request({
  pr: { number: 1, state: 'open', base: { ref: 'develop' }, head: { sha: HEAD, ref: 'x' } },
})).code === 'pr-not-targeting-main', 'non-main base rejected');
ok(gate.evaluateRepairRequest(request({
  reviewComments: [],
  reviewBody: '',
})).code === 'no-findings', 'empty Codex review rejected');

console.log('\n=== repair prompt is bounded ===');
const prompt = gate.buildRepairPrompt(request());
ok(prompt.includes('pull request #45'), 'prompt names the PR number');
ok(prompt.includes(HEAD), 'prompt names the exact current head SHA');
ok(prompt.includes('P1: the workflow retriggers on synchronize.'), 'prompt includes Codex findings');
ok(/Read AGENTS\.md and CLAUDE\.md/.test(prompt), 'prompt requires the Atlas briefs');
ok(/Fix only the genuine Codex review findings/.test(prompt), 'prompt limits work to genuine findings');
ok(/Do not expand scope/.test(prompt), 'prompt forbids scope expansion');
ok(/Edit files only/.test(prompt), 'prompt confines Cursor to file edits');
ok(/Do not run git commit, git push, git merge/.test(prompt), 'prompt forbids git mutation');
ok(/Do not mutate the pull request/.test(prompt), 'prompt forbids PR mutation');

console.log('\n=== Cursor prompt includes Atlas review findings exactly ===');
const atlasPrompt = gate.buildRepairPrompt(atlasRequest());
ok(atlasPrompt.includes(ATLAS_FINDING), 'Atlas prompt includes the review finding text exactly');
ok(atlasPrompt.includes('Atlas Contract / Systems Review findings:'),
  'Atlas prompt labels the findings as Atlas Contract / Systems Review');
ok(/Fix only the genuine Atlas Contract \/ Systems Review findings/.test(atlasPrompt),
  'Atlas prompt limits work to Atlas findings');
ok(!atlasPrompt.includes('Codex findings:'), 'Atlas prompt does not relabel findings as Codex');
ok(atlasPrompt.includes(HEAD), 'Atlas prompt names the exact current head SHA');
ok(/Edit files only/.test(atlasPrompt), 'Atlas prompt confines Cursor to file edits');

console.log('\n=== Codex and Atlas lanes share one downstream repair path ===');
ok(accepted.ok && atlasBlocking.ok && accepted.nextRound === atlasBlocking.nextRound,
  'both lanes return the same eligible round shape');
ok(typeof gate.evaluateRepairRequest === 'function' && typeof gate.buildRepairPrompt === 'function',
  'both lanes use the same evaluate and prompt functions');
const selectedCodex = gate.selectEligibleReview([{
  id: 11,
  user: { login: 'chatgpt-codex-connector[bot]' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: '### Codex Review',
}], HEAD);
const selectedAtlas = gate.selectEligibleReview([{
  id: 22,
  user: { login: 'tc5v5s64ym-sketch' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
}], HEAD);
ok(selectedCodex && String(selectedCodex.id) === '11', 'select-review accepts genuine Codex');
ok(selectedAtlas && String(selectedAtlas.id) === '22', 'select-review accepts owner Atlas BLOCKING');
ok(gate.selectEligibleReview([{
  id: 23,
  user: { login: 'tc5v5s64ym-sketch' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: `Atlas Contract / Systems Review — PASS\n\n${ATLAS_FINDING}`,
}], HEAD) == null, 'select-review rejects owner Atlas PASS');
ok(gate.selectEligibleReview([{
  id: 24,
  user: { login: 'octocat' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
}], HEAD) == null, 'select-review rejects arbitrary Atlas-looking text');
ok(gate.selectEligibleReview([{
  id: 25,
  user: { login: 'tc5v5s64ym-sketch' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
}], NEXT) == null, 'select-review rejects a stale Atlas SHA');
ok(gate.selectEligibleReview([{
  id: 26,
  user: { login: 'tc5v5s64ym-sketch' },
  commit_id: HEAD,
  submitted_at: '2026-08-15T00:00:00Z',
  body: 'Atlas Contract / Systems Review — BLOCKING',
}], HEAD) == null, 'select-review rejects an empty Atlas finding');

console.log('\n=== Cursor is denied git/gh mutation tools ===');
ok(gate.deniedGitVerb(['status']) == null, 'git status is not denied');
ok(gate.deniedGitVerb(['push', 'origin', 'HEAD']) === 'push', 'git push is denied');
ok(gate.deniedGitVerb(['commit', '-am', 'x']) === 'commit', 'git commit is denied');
ok(gate.deniedGitVerb(['merge', 'main']) === 'merge', 'git merge is denied');

const denyGit = spawnSync('sh', [DENY_GIT, 'push', 'origin', 'HEAD'], {
  encoding: 'utf8',
  env: { ...process.env, ATLAS_REAL_GIT: '/bin/true' },
});
ok(denyGit.status === 126 && /git push is disabled/.test(denyGit.stderr),
  'deny-git wrapper blocks push', `status=${denyGit.status}`);
const denyGh = spawnSync('sh', [DENY_GH], { encoding: 'utf8' });
ok(denyGh.status === 126 && /gh is disabled/.test(denyGh.stderr),
  'deny-gh wrapper blocks gh');

console.log('\n=== shipped workflows ===');
const dispatch = sourceText(fs.readFileSync(DISPATCH, 'utf8'));
const repair = sourceText(fs.readFileSync(REPAIR, 'utf8'));

ok(!/\$\{\{\s*secrets\./.test(dispatch), 'dispatch workflow references no secrets');
ok(/pull_request_review:/.test(dispatch) && /types:\s*\[submitted\]/.test(dispatch),
  'dispatch listens for submitted reviews only');
ok(!/issue_comment:/.test(dispatch), 'dispatch is not triggered by an issue comment');
ok(!/CURSOR_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(dispatch),
  'dispatch names neither automation secret');
ok(/chatgpt-codex-connector\[bot\]/.test(dispatch)
  && /chatgpt-codex-connector'/.test(dispatch),
  'dispatch still requires the genuine Codex identities');
ok(!/\btrim\s*\(/.test(dispatch),
  'dispatch GitHub Actions expression contains no trim(');
ok(/startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — NOT PASS'\)/.test(dispatch),
  'dispatch accepts exact-prefix Atlas NOT PASS');
ok(/startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — BLOCKING'\)/.test(dispatch),
  'dispatch accepts exact-prefix Atlas BLOCKING');
ok(!/Atlas Contract \/ Systems Review — PASS/.test(dispatch),
  'dispatch does not treat Atlas PASS as a trigger');
ok(!/startsWith\(\s*trim\s*\(/.test(dispatch)
  && !/startsWith\(\s*['"][ \t]/.test(dispatch),
  'dispatch does not rely on leading-whitespace normalization');
ok(/tc5v5s64ym-sketch/.test(dispatch),
  'dispatch still requires the trusted Atlas reviewer login');

ok(/workflow_run:/.test(repair) && /workflow_dispatch:/.test(repair),
  'secret-bearing workflow starts from workflow_run or explicit dispatch');
ok(!/^\s+pull_request_target:|^\s+pull_request:|^\s+pull_request_review:/m.test(repair),
  'secret-bearing workflow is not triggered by a PR-controlled event');
ok(!/issue_comment:/.test(repair),
  'secret-bearing workflow is not triggered by an issue comment');
ok(/select-review/.test(repair),
  'trusted repair workflow selects Codex and Atlas reviews through the same gate');
ok(!/ascii_downcase\) == "chatgpt-codex-connector/.test(repair),
  'trusted workflow no longer hard-filters review_id to Codex-only jq');
ok((repair.match(/cursor-agent --print/g) || []).length === 1,
  'one cursor-agent invocation serves both lanes');
ok((repair.match(/atlas-cursor-repair-gate\.js evaluate/g) || []).length === 1
  && (repair.match(/atlas-cursor-repair-gate\.js prompt/g) || []).length === 1,
  'one evaluate step and one prompt step serve both lanes');
ok(/permissions:\n(?:  [^\n]+\n)*  contents: read/.test(repair),
  'GITHUB_TOKEN contents permission is read-only');
ok(!/contents:\s*write/.test(repair), 'GITHUB_TOKEN is not granted contents:write');
ok(!/auto-merge|enablePullRequestAutoMerge|merge_method/.test(repair),
  'no auto-merge machinery');

const repairJob = (repair.split(/^  repair:\n/m)[1] || '').split(/^  test:\n/m)[0];
const testJob = (repair.split(/^  test:\n/m)[1] || '').split(/^  push:\n/m)[0];
const pushJob = repair.split(/^  push:\n/m)[1] || '';
ok(Boolean(repairJob && testJob && pushJob), 'repair, test, and push are separate jobs');
ok(/npm test/.test(testJob) && !/CURSOR_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(testJob),
  'the test job runs npm test without either secret');
ok(!/npm test/.test(repairJob) && !/npm test/.test(pushJob),
  'secret-bearing jobs do not execute the PR test suite');
ok(!/checkout@v4[\s\S]{0,400}ref: \$\{ \{ needs\.gate\.outputs\.head_ref/.test(repair)
  || /persist-credentials:\s*false/.test(repair),
  'PR checkout used for Cursor has persist-credentials disabled or is not the secret push checkout');
ok(/persist-credentials:\s*false/.test(repair),
  'at least one checkout disables persisted credentials');
ok(/ATLAS_AUTOMATION_TOKEN/.test(repair) && /git push/.test(repair),
  'deterministic push path is present');
ok(/token: \$\{\{ secrets\.ATLAS_AUTOMATION_TOKEN \}\}/.test(repair),
  'push checkout uses the automation credential');
const envBlocks = [...repair.matchAll(/^\s+env:\n(?:[ \t]+[^\n]+\n)+/gm)].map((match) => match[0]);
ok(envBlocks.length > 0, 'repair workflow declares job or step env blocks');
ok(envBlocks.every((block) => !(
  block.includes('CURSOR_API_KEY') && block.includes('ATLAS_AUTOMATION_TOKEN')
)), 'Cursor API key and automation token are not in the same job env block');
ok(/atlas-cursor-repair-deny-git\.sh/.test(repair)
  && /atlas-cursor-repair-deny-gh\.sh/.test(repair),
  'repair job installs the deny wrappers on Cursor PATH');
ok(/env -u GITHUB_TOKEN -u GH_TOKEN -u ATLAS_AUTOMATION_TOKEN/.test(repair),
  'Cursor process is launched without GitHub tokens');
ok(/vars\.ATLAS_CURSOR_MODEL/.test(repair)
  && /cursor-agent --list-models/.test(repair)
  && !/ATLAS_CURSOR_MODEL:-/.test(repair)
  && !/\|\| ['"]grok/.test(repair),
  'model id is an explicit repository variable with no silent fallback');
ok(/--print/.test(repair) && /--trust/.test(repair),
  'cursor-agent is invoked non-interactively');
ok(/atlas-cursor-repair-state/.test(repair),
  'round count is persisted in a GitHub comment marker');
ok(/gh api --paginate[\s\S]{0,200}>\s*"\$\{/.test(repair),
  'paginated comments are materialized before the state-marker search');

console.log('\n=== gate→repair race: exact SHA pin ===');
ok(gate.assertHeadsStillGated(HEAD, HEAD, HEAD).mutate === true,
  'identical gated/local/remote SHAs may mutate');
const movedRemote = gate.assertHeadsStillGated(HEAD, HEAD, NEXT);
ok(movedRemote.ok === false && movedRemote.mutate === false && movedRemote.code === 'head-moved',
  'a later remote head blocks mutation', movedRemote.code);
const movedLocal = gate.assertHeadsStillGated(HEAD, NEXT, NEXT);
ok(movedLocal.mutate === false, 'a later local checkout blocks mutation');

const assertSame = spawnSync(process.execPath, [
  path.join(__dirname, 'scripts/atlas-cursor-repair-gate.js'),
  'assert-head', HEAD, HEAD, HEAD,
], { encoding: 'utf8' });
ok(assertSame.status === 0, 'assert-head CLI exits 0 when the head is unchanged');
const assertMoved = spawnSync(process.execPath, [
  path.join(__dirname, 'scripts/atlas-cursor-repair-gate.js'),
  'assert-head', HEAD, HEAD, NEXT,
], { encoding: 'utf8' });
ok(assertMoved.status === 1 && /moved after the gate/.test(assertMoved.stderr),
  'assert-head CLI fails closed when the remote head moved');

const reviewsFile = path.join(require('os').tmpdir(), `atlas-select-review-${process.pid}.json`);
fs.writeFileSync(reviewsFile, JSON.stringify([
  {
    id: 77,
    user: { login: 'tc5v5s64ym-sketch' },
    commit_id: HEAD,
    submitted_at: '2026-08-15T01:00:00Z',
    body: `Atlas Contract / Systems Review — BLOCKING\n\n${ATLAS_FINDING}`,
  },
  {
    id: 76,
    user: { login: 'chatgpt-codex-connector[bot]' },
    commit_id: HEAD,
    submitted_at: '2026-08-15T00:00:00Z',
    body: '### Codex Review',
  },
]));
const selectedCli = spawnSync(process.execPath, [
  path.join(__dirname, 'scripts/atlas-cursor-repair-gate.js'),
  'select-review', reviewsFile, HEAD,
], { encoding: 'utf8' });
ok(selectedCli.status === 0 && selectedCli.stdout === '77',
  'select-review CLI returns the latest eligible review id on the current head');
try { fs.unlinkSync(reviewsFile); } catch { /* ignore */ }

ok(!fs.existsSync(path.join(__dirname, '.github/workflows/atlas-cursor-repair.yml')),
  'no second Atlas-specific repair workflow');

ok(repairJob.includes('ref: ${{ needs.gate.outputs.head_sha }}'),
  'repair job checks out the gated SHA');
ok(!/needs\.gate\.outputs\.head_ref/.test(repairJob),
  'repair job does not check out the mutable branch ref');
ok(/needs\.gate\.outputs\.head_sha/.test(testJob)
  && !/needs\.gate\.outputs\.head_ref/.test(testJob),
  'test job checks out the gated SHA, not the branch ref');
ok(/needs\.gate\.outputs\.head_ref/.test(pushJob),
  'push job may check out the branch because it must mutate it');
const pushSteps = pushJob.split(/\n      - name: /);
const preserveStep = pushSteps.find((step) => step.includes('atlas-trusted-scripts')) || '';
const prCheckoutStep = pushSteps.find((step) => step.startsWith('Checkout the PR branch')) || '';
const commitStep = pushSteps.find((step) => step.startsWith('Commit, push, and persist the round')) || '';
const pushScript = (commitStep.match(/run: \|\n([\s\S]*)$/) || [, ''])[1];
const assertCalls = [...pushScript.matchAll(/node[^\n]*assert-head/g)].map((match) => match[0]);
const firstAssertAt = pushScript.indexOf('assert-head');
const secondAssertAt = pushScript.indexOf('assert-head', firstAssertAt + 1);
const applyAt = pushScript.indexOf('git apply');
const commitAt = pushScript.indexOf('git commit');
const gitPushAt = pushScript.indexOf('git push');
ok(assertCalls.length === 2,
  'both pre-mutation assert-head calls remain', `count=${assertCalls.length}`);
ok(firstAssertAt >= 0 && secondAssertAt > firstAssertAt
  && applyAt > secondAssertAt && commitAt > applyAt && gitPushAt > commitAt,
  'git apply occurs only after both assert-head checks; commit/push only after apply',
  `assert1=${firstAssertAt} assert2=${secondAssertAt} apply=${applyAt} commit=${commitAt} push=${gitPushAt}`);
ok(!/git apply|git commit|git push|git rebase|git merge/.test(pushScript.slice(0, firstAssertAt)),
  'no apply, commit, push, rebase, or merge before the first assert-head');
ok(/pulls\/\$\{PR_NUMBER\}" --jq '\.head\.sha'/.test(pushJob),
  'push re-fetches the current remote PR head SHA');
ok(!/git rebase|git merge|git push --force|git push -f/.test(pushJob),
  'push path has no rebase, merge, or force-push');
ok(/path: trusted/.test(pushJob.split('Checkout the PR branch')[0] || ''),
  'trusted default-branch checkout uses path trusted');
ok(preserveStep.includes('trusted/scripts/atlas-cursor-repair-gate.js')
  && preserveStep.includes('${RUNNER_TEMP}/atlas-trusted-scripts/atlas-cursor-repair-gate.js'),
  'push job copies the trusted default-branch gate script to RUNNER_TEMP');
ok(pushJob.indexOf('atlas-trusted-scripts') >= 0
  && pushJob.indexOf('Checkout the PR branch') > pushJob.indexOf('atlas-trusted-scripts'),
  'the trusted gate script is preserved before the PR-branch checkout');
ok(/path: pr-worktree/.test(prCheckoutStep),
  'PR-branch checkout uses sibling path pr-worktree and cannot overwrite trusted/');
ok(!/clean:\s*false/.test(pushJob),
  'push job does not keep trusted/ by disabling checkout clean inside the PR tree');
ok(/working-directory:\s*pr-worktree/.test(commitStep),
  'push mutation step runs inside the PR worktree');
ok(assertCalls.every((call) => (
  call.includes('${RUNNER_TEMP}/atlas-trusted-scripts/atlas-cursor-repair-gate.js')
)), 'both assert-head calls use the preserved RUNNER_TEMP trusted script');
ok(!/node trusted\/scripts\/atlas-cursor-repair-gate\.js/.test(commitStep),
  'assert-head does not depend on workspace trusted/ after the PR checkout');
ok((repair.match(/^  push:\n/gm) || []).length === 1
  && /LANE/.test(commitStep)
  && /lane_label="Codex"/.test(commitStep)
  && /LANE\}" == "atlas"/.test(commitStep),
  'existing Codex and Atlas lanes still share the same downstream push path');

console.log('\n=== push job trusted script survives PR-branch checkout ===');
const simRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-push-trusted-'));
const simWorkspace = path.join(simRoot, 'workspace');
const simTemp = path.join(simRoot, 'runner-temp');
const simTrustedDir = path.join(simWorkspace, 'trusted', 'scripts');
const simPreservedDir = path.join(simTemp, 'atlas-trusted-scripts');
fs.mkdirSync(simTrustedDir, { recursive: true });
fs.mkdirSync(simPreservedDir, { recursive: true });
const gateSrc = path.join(__dirname, 'scripts/atlas-cursor-repair-gate.js');
const simTrusted = path.join(simTrustedDir, 'atlas-cursor-repair-gate.js');
const simPreserved = path.join(simPreservedDir, 'atlas-cursor-repair-gate.js');
fs.copyFileSync(gateSrc, simTrusted);
fs.copyFileSync(simTrusted, simPreserved);
ok(fs.existsSync(simTrusted), 'trusted checkout has the gate script before the PR checkout');
for (const name of fs.readdirSync(simWorkspace)) {
  fs.rmSync(path.join(simWorkspace, name), { recursive: true, force: true });
}
ok(!fs.existsSync(simTrusted),
  'a workspace-root PR checkout deletes trusted/scripts — the live MODULE_NOT_FOUND path');
ok(fs.existsSync(simPreserved),
  'the preserved RUNNER_TEMP copy is not deleted or overwritten by the PR-branch checkout');
const preservedAssert = spawnSync(process.execPath, [
  simPreserved, 'assert-head', HEAD, HEAD, HEAD,
], { encoding: 'utf8' });
ok(preservedAssert.status === 0,
  'assert-head can run from the preserved trusted script after the workspace wipe');
const wipedAssert = spawnSync(process.execPath, [
  simTrusted, 'assert-head', HEAD, HEAD, HEAD,
], { encoding: 'utf8' });
ok(wipedAssert.status !== 0,
  'assert-head against the wiped workspace trusted/ path fails closed');
const siblingRoot = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-push-sibling-'));
const siblingTrusted = path.join(siblingRoot, 'trusted', 'scripts');
const siblingPr = path.join(siblingRoot, 'pr-worktree');
fs.mkdirSync(siblingTrusted, { recursive: true });
fs.mkdirSync(siblingPr, { recursive: true });
fs.copyFileSync(gateSrc, path.join(siblingTrusted, 'atlas-cursor-repair-gate.js'));
fs.writeFileSync(path.join(siblingPr, 'README.md'), 'pr branch\n');
ok(fs.existsSync(path.join(siblingTrusted, 'atlas-cursor-repair-gate.js')),
  'a sibling pr-worktree checkout leaves the trusted default-branch copy in place');
try { fs.rmSync(simRoot, { recursive: true, force: true }); } catch { /* ignore */ }
try { fs.rmSync(siblingRoot, { recursive: true, force: true }); } catch { /* ignore */ }

const raceDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-repair-race-'));
const git = (args, opts = {}) => spawnSync('git', args, {
  cwd: raceDir, encoding: 'utf8', ...opts,
});
git(['init', '-q']);
git(['config', 'user.email', 'atlas@example.test']);
git(['config', 'user.name', 'atlas-test']);
fs.writeFileSync(path.join(raceDir, 'file.txt'), 'gated\n');
git(['add', 'file.txt']);
git(['commit', '-q', '-m', 'gated head']);
const gated = git(['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(path.join(raceDir, 'file.txt'), 'later\n');
git(['add', 'file.txt']);
git(['commit', '-q', '-m', 'later head']);
const later = git(['rev-parse', 'HEAD']).stdout.trim();
git(['checkout', '-q', gated]);
fs.writeFileSync(path.join(raceDir, 'file.txt'), 'repair-for-gated\n');
const patch = git(['diff', '--', 'file.txt']).stdout;
git(['checkout', '-q', '--', 'file.txt']);
git(['checkout', '-q', later]);
const race = gate.assertHeadsStillGated(gated, later, later);
ok(gated !== later && race.mutate === false, 'patch generated for the gated SHA must not apply to a later head');
if (!race.mutate) {
  ok(fs.readFileSync(path.join(raceDir, 'file.txt'), 'utf8') === 'later\n',
    'failing closed leaves the later head unmutated');
} else {
  ok(false, 'failing closed leaves the later head unmutated');
}
ok(patch.includes('repair-for-gated'), 'the discarded patch was generated against the gated tree');
try { fs.rmSync(raceDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
