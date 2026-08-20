'use strict';
/* Independent proof that the figures-review comment states Plan-page
 * snapshot scope and does not claim the whole site is unchanged.
 * `node test-figures-comment.js`
 *
 * The snapshot script's own header is the scope authority. This suite does
 * not extend that snapshot to Deep Dive, Records, or Modellers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { sourceText } = require('./test-source-text');
const {
  MARKER,
  formatFiguresComment,
} = require('./scripts/figures-comment.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const workflow = sourceText(fs.readFileSync(
  path.join(__dirname, '.github/workflows/figures-review.yml'), 'utf8'));
const snapshotSrc = sourceText(fs.readFileSync(
  path.join(__dirname, 'scripts/figures-snapshot.js'), 'utf8'));
const helperSrc = sourceText(fs.readFileSync(
  path.join(__dirname, 'scripts/figures-comment.js'), 'utf8'));
const BROKEN_HEAD = '6f936052427802901c9e93c1681d3d4404331340';
const brokenWorkflow = sourceText(execFileSync(
  'git', ['show', `${BROKEN_HEAD}:.github/workflows/figures-review.yml`],
  { encoding: 'utf8' }));

const OVERCLAIM = 'Whatever this PR changes, it does not change what the household is told';
const SITEWIDE = 'what the household is told';

console.log('=== pre-fix head overclaimed Plan-page identity ===');
ok(brokenWorkflow.includes(OVERCLAIM),
  '6f936052 unchanged comment claims the household is told nothing changed');
ok(/Every row below is something the household would read differently/.test(brokenWorkflow),
  '6f936052 moved comment does not name Plan-page scope');

console.log('\n=== snapshot authority remains Plan page only ===');
ok(/household could read it off the[\s\S]{0,20}Plan page/.test(snapshotSrc),
  'figures-snapshot.js still owns Plan-page membership');
ok(!/deepdive|records|modellers/i.test(snapshotSrc.split('Output is a flat')[0]),
  'snapshot header does not add Deep Dive, Records, or Modellers');

console.log('\n=== workflow uses the helper; overclaim is gone ===');
ok(/node scripts\/figures-comment\.js/.test(workflow),
  'figures-review.yml runs the helper as a process');
ok(!workflow.includes(OVERCLAIM) && !workflow.includes(SITEWIDE),
  'the workflow file no longer contains the site-wide unchanged claim');
ok(!helperSrc.includes(OVERCLAIM),
  'the helper no longer contains the old unchanged overclaim sentence');
ok(/Plan-page snapshot only|Plan page/.test(helperSrc),
  'the helper still names Plan-page scope');
ok(/formatFiguresComment\(base, head, baseRef\)/.test(helperSrc),
  'the helper still owns the posted formatter');

const identical = { weekly: 920, buffer: 500, windowDays: 91 };
const unchanged = formatFiguresComment(identical, { ...identical }, 'main');

console.log('\n=== identical Plan snapshots do not claim the whole site ===');
ok(unchanged.startsWith(MARKER), 'unchanged comment keeps the marker');
ok(/Plan page is identical on this head and on `main`/.test(unchanged),
  'unchanged comment still names the Plan-page snapshot and both revisions');
ok(!unchanged.includes(OVERCLAIM) && !unchanged.includes(SITEWIDE),
  'unchanged comment stops after saying what was compared');
ok(!/Deep Dive|Records|Modellers/i.test(unchanged),
  'unchanged comment does not mention other pages as compared or identical');
ok(!/does not change/.test(unchanged),
  'unchanged comment does not generalise past the snapshot');

const movedHead = { weekly: 900, buffer: 500, windowDays: 91 };
const moved = formatFiguresComment(identical, movedHead, 'main');

console.log('\n=== a moved Plan figure is still reported, Plan-scoped ===');
ok(/1 published figure moved/.test(moved), 'one numeric Plan-page move is reported');
ok(/`weekly`/.test(moved) && /\$920\.00/.test(moved) && /\*\*`?\$900\.00`?\*\*/.test(moved),
  'the moved row names weekly and both values');
ok(/Every row below is a Plan-page figure the household would read differently/.test(moved),
  'moved comment names Plan-page scope instead of the whole site');
ok(/2 other Plan-page figures unchanged/.test(moved),
  'unchanged remainder is labelled as Plan-page figures');
ok(!moved.includes(SITEWIDE),
  'moved comment does not claim it covers what the household is told');

console.log('\n=== introducing the snapshot still has no base comparison ===');
const introduced = formatFiguresComment(null, identical, 'main');
ok(/no baseline to compare against/.test(introduced),
  'null base still reports that there is no comparison');
ok(/`weekly`/.test(introduced) && /\$920\.00/.test(introduced),
  'null base still lists the head snapshot rows');

console.log('\n=== helper CLI is what the workflow formats ===');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'figures-comment-'));
try {
  const baseFile = path.join(tmpDir, 'base.json');
  const headFile = path.join(tmpDir, 'head.json');
  fs.writeFileSync(baseFile, JSON.stringify(identical));
  fs.writeFileSync(headFile, JSON.stringify(identical));
  const cliUnchanged = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts/figures-comment.js'),
    baseFile,
    headFile,
    'main',
  ], { encoding: 'utf8' });
  ok(cliUnchanged === unchanged,
    'CLI stdout for identical snapshots is exactly formatFiguresComment');

  fs.writeFileSync(headFile, JSON.stringify(movedHead));
  const cliMoved = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts/figures-comment.js'),
    baseFile,
    headFile,
    'main',
  ], { encoding: 'utf8' });
  ok(cliMoved === moved,
    'CLI stdout for a moved Plan figure is exactly formatFiguresComment');

  fs.writeFileSync(baseFile, 'null\n');
  fs.writeFileSync(headFile, JSON.stringify(identical));
  const cliIntroduced = execFileSync(process.execPath, [
    path.join(__dirname, 'scripts/figures-comment.js'),
    baseFile,
    headFile,
    'main',
  ], { encoding: 'utf8' });
  ok(cliIntroduced === introduced,
    'CLI stdout for a null base is exactly formatFiguresComment');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('\n=== privileged posting step does not execute PR JavaScript ===');
const [workflowBeforePost, workflowPost, ...extraGithubScript] = workflow.split(
  /uses:\s*actions\/github-script@[^\n]+/
);
ok(typeof workflowPost === 'string' && extraGithubScript.length === 0,
  'figures-review.yml has exactly one github-script posting step');
ok(/env -u GITHUB_TOKEN -u GH_TOKEN/.test(workflowBeforePost)
  && /node scripts\/figures-comment\.js/.test(workflowBeforePost),
  'formatter runs without GitHub tokens');
ok(/env -u GITHUB_TOKEN -u GH_TOKEN node scripts\/figures-snapshot\.js/.test(workflowBeforePost),
  'head snapshot also runs without GitHub tokens');
ok(/persist-credentials:\s*false/.test(workflowBeforePost),
  'PR checkout does not persist the write-capable token for later git use');
ok(!/formatFiguresComment/.test(workflowPost),
  'privileged github-script does not call the PR formatter');
ok(!/figures-comment\.js/.test(workflowPost),
  'privileged github-script does not load the PR helper');
ok(!/require\([^)]*scripts\//.test(workflowPost)
  && !/GITHUB_WORKSPACE/.test(workflowPost),
  'privileged github-script does not require workspace modules');
ok(/comment\.md/.test(workflowPost) && /readFileSync/.test(workflowPost),
  'privileged github-script posts the inert formatted body');
ok(workflowPost.includes(MARKER),
  'privileged github-script still finds the existing comment by the helper marker');
ok(/formatFiguresComment\(base, head, baseRef\)/.test(helperSrc)
  && /node scripts\/figures-comment\.js/.test(workflowBeforePost),
  'the workflow posts the helper body rather than a second formatter');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
