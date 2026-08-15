'use strict';
/* Mechanical coverage for Codex → Cursor repair.
 * `node test-codex-cursor-repair.js`
 *
 * Proves the gate predicates and the shipped workflow contracts: genuine
 * Codex only, stale heads rejected, round cap, exact-SHA pin after the
 * gate, no untrusted PR code in a secret-bearing job, automation-token
 * push, and no GitHub mutation tools in Cursor's PATH.
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

console.log('=== genuine Codex trigger accepted ===');
const accepted = gate.evaluateRepairRequest(request());
ok(accepted.ok && accepted.code === 'ok', 'Codex connector on current head is eligible', accepted.code);
ok(accepted.nextRound === 1, 'first eligible repair is round 1');

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
ok(!/CURSOR_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(dispatch),
  'dispatch names neither automation secret');

ok(/workflow_run:/.test(repair) && /workflow_dispatch:/.test(repair),
  'secret-bearing workflow starts from workflow_run or explicit dispatch');
ok(!/^\s+pull_request_target:|^\s+pull_request:|^\s+pull_request_review:/m.test(repair),
  'secret-bearing workflow is not triggered by a PR-controlled event');
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

ok(repairJob.includes('ref: ${{ needs.gate.outputs.head_sha }}'),
  'repair job checks out the gated SHA');
ok(!/needs\.gate\.outputs\.head_ref/.test(repairJob),
  'repair job does not check out the mutable branch ref');
ok(/needs\.gate\.outputs\.head_sha/.test(testJob)
  && !/needs\.gate\.outputs\.head_ref/.test(testJob),
  'test job checks out the gated SHA, not the branch ref');
ok(/needs\.gate\.outputs\.head_ref/.test(pushJob),
  'push job may check out the branch because it must mutate it');
const pushScript = (pushJob.match(/run: \|\n([\s\S]*)$/) || [, ''])[1];
const assertAt = pushScript.indexOf('assert-head');
const applyAt = pushScript.indexOf('git apply');
const commitAt = pushScript.indexOf('git commit');
const gitPushAt = pushScript.indexOf('git push');
ok(assertAt >= 0 && applyAt > assertAt && commitAt > applyAt && gitPushAt > commitAt,
  'push re-checks the live head before apply, commit, or push',
  `assert=${assertAt} apply=${applyAt} commit=${commitAt} push=${gitPushAt}`);
ok(/pulls\/\$\{PR_NUMBER\}" --jq '\.head\.sha'/.test(pushJob),
  'push re-fetches the current remote PR head SHA');
ok(!/git rebase|git merge|git push --force|git push -f/.test(pushJob),
  'push path has no rebase, merge, or force-push');

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
