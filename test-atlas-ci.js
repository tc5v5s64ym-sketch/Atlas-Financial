'use strict';
/* Shape of the lean delivery system. `node test-atlas-ci.js`
 *
 * Proves Atlas CI is the only GitHub-hosted workflow, that it still runs the
 * real safety properties, that retired orchestration stays gone, and that a
 * PR cannot redefine the trusted merge gate by editing atlas-ci.yml or the
 * helper that decides whether that YAML is safe.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { compare } = require('./scripts/figures-compare');
const {
  evaluatePr,
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
const testJob = (atlasCi.match(/^  test:\n[\s\S]*?(?=^  publish:)/m) || [''])[0];
const publishJob = (atlasCi.match(/^  publish:\n[\s\S]*/m) || [''])[0];
const workflowPerms = atlasCi.split(/^jobs:/m)[0];

function writePrTree({ workflow = atlasCi, helper = gateSource, extra = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-ci-pr-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  if (workflow != null) {
    fs.writeFileSync(path.join(root, '.github', 'workflows', 'atlas-ci.yml'), workflow);
  }
  if (helper != null) {
    fs.writeFileSync(path.join(root, 'scripts', 'atlas-ci-gate.js'), helper);
  }
  for (const [name, body] of Object.entries(extra)) {
    const dest = path.join(root, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
  return root;
}

const shippedEval = evaluateWorkflowText(atlasCi, 'atlas-ci.yml');
const shippedDirEval = evaluatePr(__dirname, __dirname);

console.log('=== one GitHub-hosted workflow ===');
ok(workflowFiles.length === 1, 'exactly one workflow file', workflowFiles.join(', ') || 'none');
ok(workflowFiles[0] === 'atlas-ci.yml', 'that file is atlas-ci.yml');
ok(/^name:\s*Atlas CI\s*$/m.test(atlasCi), 'workflow name is Atlas CI');
ok(/^\s+name:\s*Atlas CI\s*$/m.test(atlasCi), 'required job name is Atlas CI');
ok((atlasCi.match(/^jobs:/gm) || []).length === 1, 'the file declares jobs once');
ok((atlasCi.match(/runs-on:/g) || []).length === 2,
  'exactly two runs-on — unprivileged suite plus status publisher');
ok(/^jobs:\n  test:\n    name: Atlas CI suite/m.test(atlasCi),
  'the suite job id is test');
ok(/^  publish:\n    name: Atlas CI/m.test(atlasCi),
  'the publisher job id is publish and its check name is Atlas CI');

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
ok(/atlas-ci-gate\.js evaluate-pr pr trusted/.test(atlasCi),
  'validates the PR tree against trusted copies of the gate files');
ok(/path:\s*pr/.test(atlasCi) && /steps\.head\.outputs\.sha/.test(atlasCi),
  'checks out the exact live PR head SHA');
ok(/Live head .* is not the event head/.test(atlasCi),
  'fails closed when the live PR head is not the event SHA');
ok(/Fork pull requests are refused/.test(atlasCi),
  'fails closed on fork heads rather than checking them out');

console.log('\n=== suite job still runs the real safety properties ===');
ok(/npm test/.test(testJob), 'runs npm test (correctness + static/raw-data guard)');
ok(/working-directory:\s*pr/.test(testJob), 'npm test runs on the PR-head checkout');
ok(/scripts\/figures-snapshot\.js/.test(testJob), 'snapshots published figures on each revision');
ok(/cd pr && node scripts\/figures-snapshot\.js/.test(testJob),
  'head snapshot uses the PR revision\'s own script');
ok(/cd trusted && node scripts\/figures-snapshot\.js/.test(testJob),
  'base snapshot uses the default-branch revision\'s own script');
ok(/trusted\/scripts\/figures-compare\.js/.test(testJob),
  'compare helper is the trusted default-branch copy');
ok(/GITHUB_STEP_SUMMARY/.test(testJob), 'writes the comparison to the check summary');
ok(!/issues\.createComment|pull-requests:\s*write/.test(atlasCi),
  'does not spend a runner job posting a PR comment');
ok(/context:"Atlas CI"/.test(publishJob),
  'publishes the required status named Atlas CI onto the exact head');

console.log('\n=== untrusted suite and status publication are isolated ===');
ok(!/statuses:\s*write/.test(workflowPerms),
  'workflow-level permissions do not grant statuses:write');
ok(/statuses:\s*none/.test(testJob) && !/statuses:\s*write/.test(testJob),
  'suite job sets statuses: none and does not receive statuses:write');
ok(/statuses:\s*write/.test(publishJob),
  'publisher job is the only one granted statuses:write');
ok(/needs:\s*test/.test(publishJob), 'publisher waits on the suite job');
ok(/needs\.test\.result/.test(publishJob),
  'publisher consumes only the prior job result');
ok(!/actions\/checkout/.test(publishJob),
  'publisher does not check out PR or trusted code');
ok(!/npm test/.test(publishJob), 'publisher does not run npm test');
ok(!/node /.test(publishJob), 'publisher executes no Node / PR code');
ok(/GITHUB_TOKEN:\s*['"]{2}/.test(testJob),
  'unsets GITHUB_TOKEN before running PR code');
ok(/GH_TOKEN:\s*['"]{2}/.test(testJob),
  'unsets GH_TOKEN before running PR code');

console.log('\n=== no secrets / paid AI / privileged token to PR code ===');
ok(!/OPENAI_API_KEY/.test(atlasCi), 'does not reference OPENAI_API_KEY');
ok(!/ATLAS_AUTOMATION_TOKEN/.test(atlasCi), 'does not reference ATLAS_AUTOMATION_TOKEN');
ok(!/CURSOR_API_KEY/.test(atlasCi), 'does not reference CURSOR_API_KEY');
ok(!/\$\{\{\s*secrets\./.test(atlasCi), 'holds no repository secrets');
ok(!/contents:\s*write/.test(atlasCi), 'does not grant contents:write');
ok(!/pull-requests:\s*write/.test(atlasCi), 'does not grant pull-requests:write');
ok(/permissions:[\s\S]*contents:\s*read[\s\S]*pull-requests:\s*read/.test(workflowPerms),
  'workflow permissions are contents:read, pull-requests:read');

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
  'identical PR and trusted copies are accepted',
  (shippedDirEval.reasons || []).join('; '));
ok(/path: trusted/.test(atlasCi) && /evaluate-pr pr trusted/.test(atlasCi),
  'PR YAML is data for the trusted helper, not the executed gate');

const exit0 = writePrTree({
  workflow: [
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
const exit0Result = evaluatePr(exit0, __dirname);
ok(!exit0Result.ok, 'a PR that changes the gate to pull_request + exit 0 is rejected');
ok((exit0Result.reasons || []).some(r => /atlas-ci\.yml does not match/.test(r)),
  'because the workflow bytes differ from the trusted copy',
  (exit0Result.reasons || []).join('; '));

const guttedTrusted = writePrTree({
  workflow: [
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
const guttedResult = evaluatePr(guttedTrusted, __dirname);
ok(!guttedResult.ok,
  'a PR that keeps pull_request_target but replaces the suite with exit 0 is rejected');
ok((guttedResult.reasons || []).some(r => /atlas-ci\.yml does not match/.test(r)),
  'so a no-op cannot land as the next trusted definition');

const deleted = writePrTree({ workflow: null });
const deletedResult = evaluatePr(deleted, __dirname);
ok(!deletedResult.ok, 'a PR that deletes atlas-ci.yml is rejected');
ok((deletedResult.reasons || []).some(r => /deleted|no GitHub workflow|missing \.github\/workflows\/atlas-ci\.yml/i.test(r)),
  'with an explicit missing-gate reason');

const extra = writePrTree({
  extra: {
    '.github/workflows/evil.yml': [
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
  },
});
const extraResult = evaluatePr(extra, __dirname);
ok(!extraResult.ok, 'a PR that adds a second pull_request workflow is rejected');
ok((extraResult.reasons || []).some(r => /only atlas-ci\.yml/.test(r)),
  'so a spoof check named Atlas CI cannot be authored by the PR');

const secrets = writePrTree({
  workflow: atlasCi.replace(
    'statuses: write',
    'statuses: write\n    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}'
  ),
});
const secretsResult = evaluatePr(secrets, __dirname);
ok(!secretsResult.ok, 'a PR that introduces OPENAI_API_KEY / secrets. is rejected');
ok((secretsResult.reasons || []).some(r => /atlas-ci\.yml does not match/.test(r)),
  'because any workflow byte change is refused');

const helperOnly = writePrTree({
  helper: gateSource + '\n// weaken the next PR\'s trusted validator\n',
});
const helperOnlyResult = evaluatePr(helperOnly, __dirname);
ok(!helperOnlyResult.ok, 'a PR that edits only scripts/atlas-ci-gate.js is rejected');
ok((helperOnlyResult.reasons || []).some(r => /scripts\/atlas-ci-gate\.js does not match/.test(r)),
  'because the helper bytes differ from the trusted copy',
  (helperOnlyResult.reasons || []).join('; '));
ok(!(helperOnlyResult.reasons || []).some(r => /atlas-ci\.yml does not match/.test(r)),
  'while the unchanged workflow copy is not the reason');

const missingHelper = writePrTree({ helper: null });
const missingHelperResult = evaluatePr(missingHelper, __dirname);
ok(!missingHelperResult.ok, 'a PR that deletes scripts/atlas-ci-gate.js is rejected');
ok((missingHelperResult.reasons || []).some(r => /missing scripts\/atlas-ci-gate\.js/.test(r)),
  'with an explicit missing-helper reason');

ok(/Does not execute PR YAML/.test(atlasCi) || /PR tree as data/.test(atlasCi),
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
