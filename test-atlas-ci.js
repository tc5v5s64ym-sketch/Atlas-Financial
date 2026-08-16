'use strict';
/* Shape of the lean delivery system. `node test-atlas-ci.js`
 *
 * Proves Atlas CI is the only GitHub-hosted workflow, that it still runs the
 * real safety properties, that retired orchestration stays gone, and that a
 * PR cannot redefine the trusted merge gate by editing atlas-ci.yml.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { compare } = require('./scripts/figures-compare');
const {
  evaluatePrWorkflows,
  evaluateWorkflowText,
  workflowEvents,
} = require('./scripts/atlas-ci-gate');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');
const exists = p => fs.existsSync(path.join(__dirname, p));

const workflowDir = path.join(__dirname, '.github', 'workflows');
const workflowFiles = fs.readdirSync(workflowDir).filter(f => /\.ya?ml$/.test(f)).sort();
const atlasCi = read('.github/workflows/atlas-ci.yml');
const gateSource = read('scripts/atlas-ci-gate.js');

function writeFixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ci-gate-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

const shippedEval = evaluateWorkflowText(atlasCi, 'atlas-ci.yml');
const shippedDirEval = evaluatePrWorkflows(workflowDir);

console.log('=== one GitHub-hosted workflow ===');
ok(workflowFiles.length === 1, 'exactly one workflow file', workflowFiles.join(', ') || 'none');
ok(workflowFiles[0] === 'atlas-ci.yml', 'that file is atlas-ci.yml');
ok(/^name:\s*Atlas CI\s*$/m.test(atlasCi), 'workflow name is Atlas CI');
ok(/^\s+name:\s*Atlas CI\s*$/m.test(atlasCi), 'job name is Atlas CI');
ok((atlasCi.match(/^jobs:/gm) || []).length === 1, 'the file declares jobs once');
ok((atlasCi.match(/runs-on:/g) || []).length === 1,
  'exactly one runs-on — one GitHub-hosted job');
ok(/^jobs:\n  ci:\n    name: Atlas CI/m.test(atlasCi),
  'that job id is ci and its check name is Atlas CI');

console.log('\n=== trusted default-branch definition ===');
ok(/^\s+pull_request_target:\s*$/m.test(atlasCi),
  'triggers on pull_request_target so GitHub uses the default-branch YAML');
ok(workflowEvents(atlasCi).join(',') === 'pull_request_target',
  'the only event is pull_request_target', workflowEvents(atlasCi).join(', '));
ok(!/^\s+pull_request:\s*$/m.test(atlasCi),
  'does not also trigger on pull_request — that event would run PR-authored YAML');
ok(!/^\s+push:/m.test(atlasCi), 'does not also trigger on push');
ok(!/workflow_run:/.test(atlasCi), 'does not chain through workflow_run');
ok(!/pull_request_review:/.test(atlasCi), 'does not retrigger on reviews');
ok(!/workflow_dispatch:/.test(atlasCi), 'has no dispatcher entry point');
ok(/github\.event\.repository\.default_branch/.test(atlasCi),
  'checks out a trusted default-branch copy');
ok(/persist-credentials:\s*false/.test(atlasCi),
  'checkouts disable credentials so PR code does not keep GITHUB_TOKEN');
ok(/atlas-ci-gate\.js evaluate-pr/.test(atlasCi),
  'validates the PR workflow directory with the default-branch helper');
ok(/path:\s*pr/.test(atlasCi) && /steps\.head\.outputs\.sha/.test(atlasCi),
  'checks out the exact live PR head SHA');
ok(/Live head .* is not the event head/.test(atlasCi),
  'fails closed when the live PR head is not the event SHA');
ok(/Fork pull requests are refused/.test(atlasCi),
  'fails closed on fork heads rather than checking them out');

console.log('\n=== real safety properties are in the one job ===');
ok(/npm test/.test(atlasCi), 'runs npm test (correctness + static/raw-data guard)');
ok(/working-directory:\s*pr/.test(atlasCi), 'npm test runs on the PR-head checkout');
ok(/scripts\/figures-snapshot\.js/.test(atlasCi), 'snapshots published figures on each revision');
ok(/cd pr && node scripts\/figures-snapshot\.js/.test(atlasCi),
  'head snapshot uses the PR revision\'s own script');
ok(/cd trusted && node scripts\/figures-snapshot\.js/.test(atlasCi),
  'base snapshot uses the default-branch revision\'s own script');
ok(/trusted\/scripts\/figures-compare\.js/.test(atlasCi),
  'compare helper is the trusted default-branch copy');
ok(/GITHUB_STEP_SUMMARY/.test(atlasCi), 'writes the comparison to the check summary');
ok(!/issues\.createComment|pull-requests:\s*write/.test(atlasCi),
  'does not spend a runner job posting a PR comment');
ok(/context:"Atlas CI"/.test(atlasCi),
  'publishes the required status named Atlas CI onto the exact head');

console.log('\n=== no secrets / paid AI / privileged token to PR code ===');
ok(!/OPENAI_API_KEY/.test(atlasCi), 'does not reference OPENAI_API_KEY');
ok(!/ATLAS_AUTOMATION_TOKEN/.test(atlasCi), 'does not reference ATLAS_AUTOMATION_TOKEN');
ok(!/CURSOR_API_KEY/.test(atlasCi), 'does not reference CURSOR_API_KEY');
ok(!/\$\{\{\s*secrets\./.test(atlasCi), 'holds no repository secrets');
ok(!/contents:\s*write/.test(atlasCi), 'does not grant contents:write');
ok(!/pull-requests:\s*write/.test(atlasCi), 'does not grant pull-requests:write');
ok(/GITHUB_TOKEN:\s*['"]{2}/.test(atlasCi),
  'unsets GITHUB_TOKEN before running PR code');
ok(/GH_TOKEN:\s*['"]{2}/.test(atlasCi),
  'unsets GH_TOKEN before running PR code');
ok(/permissions:[\s\S]*contents:\s*read[\s\S]*pull-requests:\s*read[\s\S]*statuses:\s*write/.test(atlasCi),
  'permissions are contents:read, pull-requests:read, statuses:write');

const retiredWorkflows = [
  'test.yml',
  'figures-review.yml',
  'merge-card-check.yml',
  'risk-label-gate.yml',
  'labeler.yml',
  'labels.yml',
  'atlas-first-review.yml',
  'atlas-first-review-dispatch.yml',
  'atlas-rereview.yml',
  'atlas-rereview-dispatch.yml',
  'codex-cursor-repair.yml',
  'codex-cursor-repair-dispatch.yml',
];
for (const file of retiredWorkflows) {
  ok(!exists(`.github/workflows/${file}`), `retired workflow gone: ${file}`);
}

const retiredScripts = [
  'scripts/atlas-api-rereview.js',
  'scripts/atlas-openai-call.sh',
  'scripts/atlas-review-block.js',
  'scripts/atlas-primary-risk.js',
  'scripts/atlas-merge-card-dispatch-ref.js',
  'scripts/atlas-github-pr-head-sync.js',
  'scripts/atlas-cursor-repair-gate.js',
  'scripts/atlas-cursor-repair-deny-git.sh',
  'scripts/atlas-cursor-repair-deny-gh.sh',
];
for (const file of retiredScripts) {
  ok(!exists(file), `retired script gone: ${file}`);
}

const retiredTests = [
  'test-mergecard.js',
  'test-codex-cursor-repair.js',
  'test-atlas-review-block.js',
  'test-atlas-api-rereview.js',
  'test-atlas-first-review.js',
  'test-atlas-primary-risk.js',
  'test-github-pr-head-sync.js',
];
for (const file of retiredTests) {
  ok(!exists(file), `retired orchestration test gone: ${file}`);
}

ok(!exists('.github/labels.yml'), 'label manifest retired with the label Actions');
ok(!exists('.github/labeler.yml'), 'labeler config retired with the label Actions');

const tracked = [];
const walk = dir => {
  for (const e of fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (/^(\.git|node_modules|raw|derived)$/.test(e.name)) continue;
    if (e.isDirectory()) walk(rel);
    else if (/\.(js|yml|yaml|sh|md)$/.test(e.name)) tracked.push(rel);
  }
};
walk('.github');
walk('scripts');
const secretHits = tracked.filter(f => {
  const body = read(f);
  return /\$\{\{\s*secrets\.OPENAI_API_KEY/.test(body);
});
ok(secretHits.length === 0,
  'no OPENAI_API_KEY remains under .github/ or scripts/',
  secretHits.join(', ') || 'none');

console.log('\n=== self-edit cannot redefine the trusted gate ===');
ok(shippedEval.ok,
  'the shipped atlas-ci.yml is accepted by the trusted gate helper',
  (shippedEval.reasons || []).join('; '));
ok(shippedDirEval.ok,
  'the shipped workflows directory is accepted',
  (shippedDirEval.reasons || []).join('; '));
ok(/path: trusted/.test(atlasCi) && /evaluate-pr pr\/\.github\/workflows/.test(atlasCi),
  'PR YAML is data for the trusted helper, not the executed gate');

const exit0 = writeFixture({
  'atlas-ci.yml': [
    'name: Atlas CI',
    'on:',
    '  pull_request:',
    'jobs:',
    '  ci:',
    '    name: Atlas CI',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: exit 0',
    '',
  ].join('\n'),
});
const exit0Result = evaluatePrWorkflows(exit0);
ok(!exit0Result.ok, 'a PR that changes the gate to pull_request + exit 0 is rejected');
ok((exit0Result.reasons || []).some(r => /pull_request/.test(r)),
  'because pull_request would run PR-authored YAML',
  (exit0Result.reasons || []).join('; '));
ok((exit0Result.reasons || []).some(r => /npm test/.test(r)),
  'and because npm test is missing');

const guttedTrusted = writeFixture({
  'atlas-ci.yml': [
    'name: Atlas CI',
    'on:',
    '  pull_request_target:',
    'jobs:',
    '  ci:',
    '    name: Atlas CI',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: exit 0',
    '',
  ].join('\n'),
});
const guttedResult = evaluatePrWorkflows(guttedTrusted);
ok(!guttedResult.ok,
  'a PR that keeps pull_request_target but replaces the suite with exit 0 is rejected');
ok((guttedResult.reasons || []).some(r => /npm test/.test(r)),
  'so a no-op cannot land as the next trusted definition');

const deleted = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ci-deleted-'));
const deletedResult = evaluatePrWorkflows(deleted);
ok(!deletedResult.ok, 'a PR that deletes atlas-ci.yml is rejected');
ok((deletedResult.reasons || []).some(r => /deleted|no GitHub workflow/i.test(r)),
  'with an explicit missing-gate reason');

const extra = writeFixture({
  'atlas-ci.yml': atlasCi,
  'evil.yml': [
    'name: Atlas CI',
    'on:',
    '  pull_request:',
    'jobs:',
    '  ci:',
    '    name: Atlas CI',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: exit 0',
    '',
  ].join('\n'),
});
const extraResult = evaluatePrWorkflows(extra);
ok(!extraResult.ok, 'a PR that adds a second pull_request workflow is rejected');
ok((extraResult.reasons || []).some(r => /only atlas-ci\.yml/.test(r)),
  'so a spoof check named Atlas CI cannot be authored by the PR');

const secrets = writeFixture({
  'atlas-ci.yml': atlasCi.replace(
    'statuses: write',
    'statuses: write\n    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}'
  ),
});
const secretsResult = evaluatePrWorkflows(secrets);
ok(!secretsResult.ok, 'a PR that introduces OPENAI_API_KEY / secrets. is rejected');

ok(/Does not execute PR YAML/.test(read('.github/workflows/atlas-ci.yml'))
  || /PR workflows as data/.test(atlasCi),
  'the shipped workflow states that PR YAML is not executed as the gate');
ok(!/require\('\.\/scripts\/atlas-ci-gate'\)/.test(gateSource),
  'the gate helper has no dependency on PR test code');

console.log('\n=== figures-compare helper ===');
const unchanged = compare(
  { 'plan.weeklyCap': 1250, 'action.openCount': 3 },
  { 'plan.weeklyCap': 1250, 'action.openCount': 3 },
  'main'
);
ok(/unchanged/.test(unchanged) && /Plan-page headline figures/.test(unchanged),
  'identical snapshots report Plan-page figures unchanged');
ok(!/household is told/.test(unchanged),
  'and do not claim the household is told the same thing on every page');

const moved = compare(
  { 'plan.weeklyCap': 1250, 'budget.essentialPerMonth': 2000 },
  { 'plan.weeklyCap': 1650, 'budget.essentialPerMonth': 2000 },
  'main'
);
ok(/1 published figure moved/.test(moved) && /plan\.weeklyCap/.test(moved),
  'a moved money figure is named');
ok(!/budget\.essentialPerMonth/.test(moved),
  'an unchanged figure is omitted from the moved table');
ok(/\+\$400\.00/.test(moved), 'the money delta is visible');

const firstRun = compare(null, { 'plan.weeklyCap': 1250 }, 'main');
ok(/baseline to compare against/.test(firstRun) && /plan\.weeklyCap/.test(firstRun),
  'a missing base snapshot is reported rather than inventing additions');

const registry = read('test.js');
ok(/test-static\.js/.test(registry), 'npm test still registers the static/raw-data guard');
ok(/test-forecast\.js/.test(registry), 'npm test still registers the forecast engine suite');
ok(/test-invariants\.js/.test(registry), 'npm test still registers authority invariants');
ok(/test-atlas-ci\.js/.test(registry), 'this delivery-system guard is itself in npm test');
ok(!/test-mergecard\.js/.test(registry), 'npm test no longer runs merge-card orchestration tests');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
