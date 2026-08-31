'use strict';
/* Mechanical coverage for Codex / trusted Atlas → Cursor repair.
 * `node test/test-codex-cursor-repair.js`
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
const gate = require('../scripts/atlas-cursor-repair-gate');

const DISPATCH = path.join(__dirname, '..', '.github/workflows/codex-cursor-repair-dispatch.yml');
const REPAIR = path.join(__dirname, '..', '.github/workflows/codex-cursor-repair.yml');
const DENY_GIT = path.join(__dirname, '..', 'scripts/atlas-cursor-repair-deny-git.sh');
const DENY_GH = path.join(__dirname, '..', 'scripts/atlas-cursor-repair-deny-gh.sh');

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

ok(!fs.existsSync(path.join(__dirname, '..', '.github/workflows/codex-review-request.yml')),
  'Request Codex review comment-dispatcher is retired');
ok(!/@codex review/.test(dispatch) && !/@codex review/.test(repair),
  'Codex→Cursor repair path does not post @codex review');
ok(!/ATLAS_CODEX_REVIEW_TOKEN/.test(dispatch) && !/ATLAS_CODEX_REVIEW_TOKEN/.test(repair),
  'repair path does not use the retired review-request token');

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
ok(/startsWith\(github\.event\.review\.body, 'Atlas Contract \/ Systems Review — PASS'\)/.test(dispatch),
  'dispatch records trusted Atlas PASS so the trusted workflow can sync the card');
ok(/Trusted Atlas PASS does not start a repair/.test(repair),
  'trusted workflow does not start Cursor after Atlas PASS');
ok(/gh workflow run merge-card-check\.yml/.test(repair)
  && /expected_head_sha/.test(repair)
  && /atlas-merge-card-dispatch-ref\.js/.test(repair),
  'trusted Atlas PASS dispatches Merge Card check with a head-aware workflow ref');
ok(/actions:\s*write/.test(repair),
  'trusted workflow has actions:write so it can dispatch Merge Card check');
ok(!/gh api --method PATCH[\s\S]{0,120}\btitle\b/.test(repair)
  && !/gh run rerun/.test(repair),
  'repair workflow has no synthetic title edit or manual Merge Card rerun');
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

console.log('\n=== Cursor-first push still syncs PENDING ===');
const TREE = '1'.repeat(40);
const OTHER_TREE = '2'.repeat(40);
function aheadCompare(base, head, extras = {}) {
  return {
    status: 'ahead',
    merge_base_commit: { sha: base },
    ahead_by: extras.ahead_by == null ? 1 : extras.ahead_by,
    behind_by: 0,
    head: { sha: head },
    ...extras,
  };
}
function trustedProvenance(overrides = {}) {
  return {
    reviewedSha: HEAD,
    expectedTreeSha: TREE,
    liveTreeSha: TREE,
    ...overrides,
  };
}
const stillGated = gate.classifyRepairPushHead(HEAD, HEAD, HEAD, aheadCompare(HEAD, HEAD));
ok(stillGated.ok && stillGated.action === 'push' && stillGated.mutate === true,
  'unchanged gated/local/live heads still take the push path', stillGated.action);
const stillGatedReviewed = gate.classifyRepairPushHead(
  HEAD, HEAD, HEAD, aheadCompare(HEAD, HEAD), trustedProvenance(),
);
ok(stillGatedReviewed.ok && stillGatedReviewed.action === 'push',
  'unchanged heads still push when reviewed SHA matches the gated SHA');
const cursorPushed = gate.classifyRepairPushHead(
  HEAD, NEXT, NEXT, aheadCompare(HEAD, NEXT), trustedProvenance(),
);
ok(cursorPushed.ok && cursorPushed.action === 'adopt-live' && cursorPushed.mutate === false,
  'Cursor-pushed descendant is adopted without mutation when the trusted tree matches', cursorPushed.action);
ok(cursorPushed.repairSha === NEXT && cursorPushed.code === 'already-repaired',
  'adopt-live records the live repair SHA');
const staleCheckout = gate.classifyRepairPushHead(
  HEAD, HEAD, NEXT, aheadCompare(HEAD, NEXT), trustedProvenance(),
);
ok(staleCheckout.ok && staleCheckout.action === 'adopt-live' && staleCheckout.mutate === false,
  'gated local checkout with a trusted live repair still skips mutation', staleCheckout.action);
const diverged = gate.classifyRepairPushHead(HEAD, HEAD, NEXT, {
  status: 'diverged',
  merge_base_commit: { sha: 'c'.repeat(40) },
  ahead_by: 1,
  behind_by: 1,
}, trustedProvenance());
ok(diverged.ok === false && diverged.mutate === false && diverged.code === 'head-moved',
  'a diverged live head still fails closed without mutation', diverged.code);
const thirdHead = 'c'.repeat(40);
const unexpectedLocal = gate.classifyRepairPushHead(
  HEAD, thirdHead, NEXT, aheadCompare(HEAD, NEXT), trustedProvenance(),
);
ok(unexpectedLocal.ok === false && unexpectedLocal.code === 'head-moved',
  'an unexpected local SHA fails closed even when live is a descendant', unexpectedLocal.code);

console.log('\n=== adopt-live rejects untrusted descendants ===');
const noProvenance = gate.classifyRepairPushHead(HEAD, NEXT, NEXT, aheadCompare(HEAD, NEXT));
ok(noProvenance.ok === false && noProvenance.mutate === false && noProvenance.code === 'reviewed-mismatch',
  'a descendant without reviewed-SHA provenance is not adopted', noProvenance.code);
const reviewedOther = gate.classifyRepairPushHead(
  HEAD, NEXT, NEXT, aheadCompare(HEAD, NEXT), trustedProvenance({ reviewedSha: thirdHead }),
);
ok(reviewedOther.ok === false && reviewedOther.code === 'reviewed-mismatch',
  'adopt-live fails closed when reviewed SHA is not the gated SHA', reviewedOther.code);
const unrelatedTree = gate.classifyRepairPushHead(
  HEAD, NEXT, NEXT, aheadCompare(HEAD, NEXT), trustedProvenance({ liveTreeSha: OTHER_TREE }),
);
ok(unrelatedTree.ok === false && unrelatedTree.mutate === false && unrelatedTree.code === 'unrelated-descendant',
  'an unrelated one-commit descendant with a different tree is rejected', unrelatedTree.code);
const extraAhead = gate.classifyRepairPushHead(
  HEAD, NEXT, NEXT, aheadCompare(HEAD, NEXT, { ahead_by: 2 }), trustedProvenance(),
);
ok(extraAhead.ok === false && extraAhead.mutate === false && extraAhead.code === 'extra-descendant',
  'a two-commit descendant is rejected even when the live tree matches', extraAhead.code);
const extraCommits = gate.classifyRepairPushHead(
  HEAD,
  NEXT,
  NEXT,
  aheadCompare(HEAD, NEXT, {
    commits: [
      { sha: thirdHead, commit: { tree: { sha: TREE } } },
      { sha: NEXT, commit: { tree: { sha: TREE } } },
    ],
  }),
  trustedProvenance(),
);
ok(extraCommits.ok === false && extraCommits.code === 'extra-descendant',
  'compare.commits longer than one is rejected as an extra descendant', extraCommits.code);
ok(gate.isSingleForwardRepairCompare(HEAD, NEXT, aheadCompare(HEAD, NEXT)) === true,
  'a one-commit ahead compare is a single forward repair');
ok(gate.isSingleForwardRepairCompare(HEAD, NEXT, aheadCompare(HEAD, NEXT, { ahead_by: 2 })) === false,
  'ahead_by greater than 1 is not a single forward repair');

const compareFile = path.join(require('os').tmpdir(), `atlas-push-compare-${process.pid}.json`);
const provenanceFile = path.join(require('os').tmpdir(), `atlas-push-provenance-${process.pid}.json`);
fs.writeFileSync(compareFile, JSON.stringify(aheadCompare(HEAD, NEXT)));
fs.writeFileSync(provenanceFile, JSON.stringify(trustedProvenance()));
const classifyBare = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, NEXT, NEXT, compareFile,
], { encoding: 'utf8' });
ok(classifyBare.status === 1 && /reviewed SHA/.test(classifyBare.stderr),
  'classify-push-head CLI fails closed for a descendant without provenance');
const classifyAdopt = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, NEXT, NEXT, compareFile, provenanceFile,
], { encoding: 'utf8' });
ok(classifyAdopt.status === 0 && /adopt-live/.test(classifyAdopt.stdout),
  'classify-push-head CLI exits 0 for a trusted Cursor-first repair tree');
const classifyFail = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, HEAD, NEXT, compareFile, provenanceFile,
], { encoding: 'utf8' });
ok(classifyFail.status === 0 && /adopt-live/.test(classifyFail.stdout),
  'classify-push-head CLI adopts when local is still gated and live is the trusted repair');
fs.writeFileSync(provenanceFile, JSON.stringify(trustedProvenance({ liveTreeSha: OTHER_TREE })));
const classifyUnrelated = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, NEXT, NEXT, compareFile, provenanceFile,
], { encoding: 'utf8' });
ok(classifyUnrelated.status === 1 && /repair\.patch tree/.test(classifyUnrelated.stderr),
  'classify-push-head CLI rejects an unrelated descendant tree');
fs.writeFileSync(compareFile, JSON.stringify(aheadCompare(HEAD, NEXT, { ahead_by: 2 })));
fs.writeFileSync(provenanceFile, JSON.stringify(trustedProvenance()));
const classifyExtra = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, NEXT, NEXT, compareFile, provenanceFile,
], { encoding: 'utf8' });
ok(classifyExtra.status === 1 && /more than one commit/.test(classifyExtra.stderr),
  'classify-push-head CLI rejects an extra descendant');
fs.writeFileSync(compareFile, JSON.stringify({
  status: 'diverged',
  merge_base_commit: { sha: thirdHead },
  ahead_by: 1,
  behind_by: 1,
}));
const classifyMoved = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'classify-push-head', HEAD, HEAD, NEXT, compareFile, provenanceFile,
], { encoding: 'utf8' });
ok(classifyMoved.status === 1 && /moved after the gate/.test(classifyMoved.stderr),
  'classify-push-head CLI fails closed when the live head is not a forward repair');
try { fs.unlinkSync(compareFile); } catch { /* ignore */ }
try { fs.unlinkSync(provenanceFile); } catch { /* ignore */ }

const assertSame = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'assert-head', HEAD, HEAD, HEAD,
], { encoding: 'utf8' });
ok(assertSame.status === 0, 'assert-head CLI exits 0 when the head is unchanged');
const assertMoved = spawnSync(process.execPath, [
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
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
  path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js'),
  'select-review', reviewsFile, HEAD,
], { encoding: 'utf8' });
ok(selectedCli.status === 0 && selectedCli.stdout === '77',
  'select-review CLI returns the latest eligible review id on the current head');
try { fs.unlinkSync(reviewsFile); } catch { /* ignore */ }

ok(!fs.existsSync(path.join(__dirname, '..', '.github/workflows/atlas-cursor-repair.yml')),
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
const cachedApplyAt = pushScript.indexOf('git apply --cached');
const mutationApplyAt = (() => {
  let idx = 0;
  while (idx < pushScript.length) {
    const found = pushScript.indexOf('git apply', idx);
    if (found < 0) return -1;
    if (!pushScript.slice(found).startsWith('git apply --cached')) return found;
    idx = found + 1;
  }
  return -1;
})();
const commitAt = pushScript.indexOf('git commit');
const gitPushAt = pushScript.indexOf('git push');
const classifyAt = pushScript.indexOf('classify-push-head');
ok(assertCalls.length === 2,
  'both pre-mutation assert-head calls remain', `count=${assertCalls.length}`);
ok(firstAssertAt >= 0 && secondAssertAt > firstAssertAt
  && mutationApplyAt > secondAssertAt && commitAt > mutationApplyAt && gitPushAt > commitAt,
  'worktree git apply occurs only after both assert-head checks; commit/push only after apply',
  `assert1=${firstAssertAt} assert2=${secondAssertAt} apply=${mutationApplyAt} commit=${commitAt} push=${gitPushAt}`);
ok(cachedApplyAt >= 0 && cachedApplyAt < classifyAt && classifyAt < mutationApplyAt,
  'expected tree is derived from repair.patch before classify; mutation apply stays after classify');
ok(/push-provenance\.json/.test(pushScript)
  && /reviewedSha/.test(pushScript)
  && /expectedTreeSha/.test(pushScript)
  && /liveTreeSha/.test(pushScript)
  && /REVIEWED_SHA/.test(pushScript),
  'push binds classify-push-head to reviewed SHA and the trusted patch tree');
ok(/git write-tree/.test(pushScript) && pushScript.indexOf('git write-tree') < classifyAt,
  'trusted expected tree is written from the gated index plus repair.patch');
ok(/adopt-live/.test(pushScript) && /evaluate-pending/.test(pushScript)
  && pushScript.indexOf('adopt-live') < pushScript.indexOf('evaluate-pending'),
  'adopt-live still reaches PENDING bookkeeping without a second push');
ok(/git apply/.test(pushScript) && /push_action.*"push"/.test(pushScript.replace(/\s+/g, ' '))
  || /push_action\}" == "push"/.test(pushScript),
  'git apply remains inside the classified push arm');
ok(!/git apply(?! --cached)|git commit|git push|git rebase|git merge/.test(pushScript.slice(0, firstAssertAt)),
  'no worktree apply, commit, push, rebase, or merge before the first assert-head');
ok(/atlas-github-pr-head-sync\.js/.test(pushJob),
  'push confirms the live PR head through the bounded helper');
ok(/git push/.test(pushScript) && pushScript.indexOf('git push') < pushScript.indexOf('atlas-github-pr-head-sync.js'),
  'live PR-head confirmation happens after git push');
ok(pushScript.indexOf('atlas-github-pr-head-sync.js') < pushScript.indexOf('evaluate-pending')
  && pushScript.indexOf('atlas-github-pr-head-sync.js') < pushScript.indexOf('atlas-cursor-repair-state'),
  'PENDING and the repair-round marker wait for live PR-head confirmation');
ok(!/git rebase|git merge|git push --force|git push -f/.test(pushJob),
  'push path has no rebase, merge, or force-push');
ok(/path: trusted/.test(pushJob.split('Checkout the PR branch')[0] || ''),
  'trusted default-branch checkout uses path trusted');
ok(preserveStep.includes('trusted/scripts/atlas-cursor-repair-gate.js')
  && preserveStep.includes('${RUNNER_TEMP}/atlas-trusted-scripts/atlas-cursor-repair-gate.js'),
  'push job copies the trusted default-branch gate script to RUNNER_TEMP');
ok(preserveStep.includes('trusted/scripts/atlas-github-pr-head-sync.js')
  && preserveStep.includes('${RUNNER_TEMP}/atlas-trusted-scripts/atlas-github-pr-head-sync.js'),
  'push job copies the trusted live PR-head confirmation helper to RUNNER_TEMP');
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
const gateSrc = path.join(__dirname, '..', 'scripts/atlas-cursor-repair-gate.js');
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

console.log('\n=== adopt-live binds to the trusted patch tree from a real git repo ===');
const bindDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-repair-bind-'));
const bindGit = (args, opts = {}) => spawnSync('git', args, {
  cwd: bindDir, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: undefined, ...opts.env },
});
bindGit(['init', '-q']);
bindGit(['config', 'user.email', 'atlas@example.test']);
bindGit(['config', 'user.name', 'atlas-test']);
fs.writeFileSync(path.join(bindDir, 'file.txt'), 'gated\n');
bindGit(['add', 'file.txt']);
bindGit(['commit', '-q', '-m', 'gated head']);
const bindGated = bindGit(['rev-parse', 'HEAD']).stdout.trim();
fs.writeFileSync(path.join(bindDir, 'file.txt'), 'trusted-repair\n');
bindGit(['add', 'file.txt']);
const bindPatch = path.join(bindDir, 'repair.patch');
fs.writeFileSync(bindPatch, bindGit(['diff', '--cached', '--binary']).stdout);
bindGit(['commit', '-q', '-m', 'trusted repair']);
const bindRepair = bindGit(['rev-parse', 'HEAD']).stdout.trim();
const bindRepairTree = bindGit(['rev-parse', 'HEAD^{tree}']).stdout.trim();
fs.writeFileSync(path.join(bindDir, 'file.txt'), 'unrelated-descendant\n');
bindGit(['add', 'file.txt']);
bindGit(['commit', '-q', '-m', 'unrelated extra']);
const bindUnrelated = bindGit(['rev-parse', 'HEAD']).stdout.trim();
const bindUnrelatedTree = bindGit(['rev-parse', 'HEAD^{tree}']).stdout.trim();
const expectedIndex = path.join(bindDir, 'expected.index');
const derivedTree = bindGit(['write-tree'], {
  env: (() => {
    bindGit(['read-tree', `--index-output=${expectedIndex}`, bindGated]);
    const applied = spawnSync('git', ['apply', '--cached', bindPatch], {
      cwd: bindDir, encoding: 'utf8', env: { ...process.env, GIT_INDEX_FILE: expectedIndex },
    });
    ok(applied.status === 0, 'trusted repair.patch applies to the gated index');
    return { GIT_INDEX_FILE: expectedIndex };
  })(),
}).stdout.trim();
ok(derivedTree === bindRepairTree && derivedTree !== bindUnrelatedTree,
  'write-tree from gated index plus repair.patch equals the trusted repair tree only');
const bindCompare = (head, aheadBy) => ({
  status: 'ahead',
  merge_base_commit: { sha: bindGated },
  ahead_by: aheadBy,
  behind_by: 0,
  head: { sha: head },
});
const bindAdopt = gate.classifyRepairPushHead(bindGated, bindRepair, bindRepair, bindCompare(bindRepair, 1), {
  reviewedSha: bindGated,
  expectedTreeSha: derivedTree,
  liveTreeSha: bindRepairTree,
});
ok(bindAdopt.ok && bindAdopt.action === 'adopt-live',
  'real trusted one-commit repair tree is adopted', bindAdopt.code);
const bindRejectUnrelated = gate.classifyRepairPushHead(
  bindGated, bindUnrelated, bindUnrelated, bindCompare(bindUnrelated, 1), {
    reviewedSha: bindGated,
    expectedTreeSha: derivedTree,
    liveTreeSha: bindUnrelatedTree,
  },
);
ok(bindRejectUnrelated.ok === false && bindRejectUnrelated.code === 'unrelated-descendant',
  'real unrelated descendant tree is rejected', bindRejectUnrelated.code);
const bindRejectExtra = gate.classifyRepairPushHead(
  bindGated, bindUnrelated, bindUnrelated, bindCompare(bindUnrelated, 2), {
    reviewedSha: bindGated,
    expectedTreeSha: derivedTree,
    liveTreeSha: derivedTree,
  },
);
ok(bindRejectExtra.ok === false && bindRejectExtra.code === 'extra-descendant',
  'real extra descendant is rejected even if a later tree is restated as trusted', bindRejectExtra.code);
try { fs.rmSync(bindDir, { recursive: true, force: true }); } catch { /* ignore */ }

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
