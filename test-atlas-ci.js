'use strict';
/* Shape of the lean delivery system. `node test-atlas-ci.js`
 *
 * Proves the retired orchestration is gone, that Atlas CI is the only
 * GitHub-hosted workflow, and that it still runs the real safety properties:
 * npm test (correctness + static/raw-data guard) and published-figure
 * comparison. It does not re-run the financial suites.
 */

const fs = require('fs');
const path = require('path');
const { compare } = require('./scripts/figures-compare');

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

console.log('\n=== trigger is PR-head only ===');
ok(/^\s+pull_request:\s*$/m.test(atlasCi), 'triggers on pull_request');
ok(/types:\s*\[opened,\s*synchronize,\s*reopened\]/.test(atlasCi),
  'and only on opened / synchronize / reopened');
ok(!/^\s+push:/m.test(atlasCi), 'does not also trigger on push');
ok(!/pull_request_target/.test(atlasCi), 'does not use pull_request_target');
ok(!/workflow_run:/.test(atlasCi), 'does not chain through workflow_run');
ok(!/pull_request_review:/.test(atlasCi), 'does not retrigger on reviews');
ok(!/workflow_dispatch:/.test(atlasCi), 'has no dispatcher entry point');

console.log('\n=== real safety properties are in the one job ===');
ok(/npm test/.test(atlasCi), 'runs npm test (correctness + static/raw-data guard)');
ok(/scripts\/figures-snapshot\.js/.test(atlasCi), 'snapshots published figures on each revision');
ok(/scripts\/figures-compare\.js/.test(atlasCi), 'compares those snapshots in the same job');
ok(/GITHUB_STEP_SUMMARY/.test(atlasCi), 'writes the comparison to the check summary');
ok(!/issues\.createComment|pull-requests:\s*write/.test(atlasCi),
  'does not spend a runner job posting a PR comment');

console.log('\n=== no paid review/repair orchestration ===');
ok(!/OPENAI_API_KEY/.test(atlasCi), 'does not reference OPENAI_API_KEY');
ok(!/ATLAS_AUTOMATION_TOKEN/.test(atlasCi), 'does not reference ATLAS_AUTOMATION_TOKEN');
ok(!/CURSOR_API_KEY/.test(atlasCi), 'does not reference CURSOR_API_KEY');
ok(!/\$\{\{\s*secrets\./.test(atlasCi), 'holds no repository secrets');
ok(/permissions:\s*\n\s+contents:\s*read\s*$/m.test(atlasCi),
  'contents:read is the only permission');

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
  return /OPENAI_API_KEY/.test(body);
});
ok(secretHits.length === 0,
  'no OPENAI_API_KEY remains under .github/ or scripts/',
  secretHits.join(', ') || 'none');

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
