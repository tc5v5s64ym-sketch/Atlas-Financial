'use strict';
/* Mechanical coverage for Merge Card → GitHub primary-risk projection.
 * `node test/test-atlas-primary-risk.js`
 *
 * Proves the helper parses the closed Primary risk vocabulary, plans an
 * idempotent label sync from the card, and fails the gate when the live
 * GitHub labels do not equal that card value. Also proves the shipped
 * workflow contracts: trusted default-branch helper, edited-card wakeup,
 * no PR-head execution, no second PRIMARY list, and no auto-merge.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('../scripts/atlas-primary-risk');

const WORKFLOW = path.join(__dirname, '..', '.github/workflows/risk-label-gate.yml');
const HELPER = path.join(__dirname, '..', 'scripts/atlas-primary-risk.js');

let failures = 0;

function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

function card(primary, extra = '') {
  return [
    '## Atlas Merge Card',
    '',
    '| Field | Value |',
    '|---|---|',
    `| **Title** | Example |`,
    `| **Primary risk** | ${primary} |`,
    extra,
    '',
    '### Atlas Contract / Systems Review',
    '',
    '- **Required**: NOT REQUIRED — docs only',
  ].join('\n');
}

console.log('=== closed Primary risk vocabulary ===');
ok(helper.PRIMARY.join(',') === 'auto-safe,figures-moved,owner-decision,blocked',
  'helper names the four primary labels');
ok(helper.parsePrimaryRisk(card('auto-safe')).value === 'auto-safe',
  'table row auto-safe parses');
ok(helper.parsePrimaryRisk(card('figures-moved — Plan tile weekly cap')).value === 'figures-moved',
  'explanation after an em-dash is still the closed value');
ok(helper.parsePrimaryRisk(card('OWNER-DECISION')).value === 'owner-decision',
  'closed value is case-insensitive');
ok(helper.parsePrimaryRisk(card('**auto-safe**')).value === 'auto-safe',
  'existing bold emphasis around the closed value still parses');
ok(helper.parsePrimaryRisk('## Atlas Merge Card\n\n- **Primary risk**: blocked\n').value === 'blocked',
  'bullet form parses');
ok(helper.parsePrimaryRisk(card('auto-safe / owner-decision')).ok === false,
  'slash-separated leftover template is not auto-safe');
ok(helper.parsePrimaryRisk(card('<!-- auto-safe / owner-decision / figures-moved / blocked -->')).code === 'blank',
  'HTML placeholder is blank');
ok(helper.parsePrimaryRisk('No card here').code === 'missing-card',
  'missing Merge Card heading fails');
ok(helper.parsePrimaryRisk('## Atlas Merge Card\n\n| **Title** | x |\n').code === 'missing-row',
  'missing Primary risk row fails');
ok(helper.parsePrimaryRisk(card('maybe-safe')).code === 'invalid',
  'unknown primary risk fails');

console.log('\n=== #81/#82/#83 inline-code presentation ===');
ok(helper.parsePrimaryRisk(card('`auto-safe`')).value === 'auto-safe',
  'table row `auto-safe` parses as auto-safe');
ok(helper.parsePrimaryRisk(card('`figures-moved`')).value === 'figures-moved',
  'table row `figures-moved` parses as figures-moved');
ok(helper.parsePrimaryRisk(card('`owner-decision`')).value === 'owner-decision',
  'table row `owner-decision` parses as owner-decision');
ok(helper.parsePrimaryRisk(card('`blocked`')).value === 'blocked',
  'table row `blocked` parses as blocked');
ok(helper.parsePrimaryRisk(card('`figures-moved` — Plan tile weekly cap')).value === 'figures-moved',
  'inline-code value plus explanation is still figures-moved');
ok(helper.parsePrimaryRisk(card('`AUTO-SAFE`')).value === 'auto-safe',
  'inline-code closed value stays case-insensitive');
ok(helper.parsePrimaryRisk(card('`probably-fine`')).code === 'invalid',
  'inline-code around an unknown value still fails');
ok(helper.parsePrimaryRisk(card('`auto-safe` `figures-moved`')).ok === false,
  'two inline-code values are not one closed Primary risk');
ok(helper.parsePrimaryRisk(card('`auto-safe` / `owner-decision`')).ok === false,
  'slash-separated inline-code leftover template is not auto-safe');
ok(helper.parsePrimaryRisk(card('`auto`')).code === 'invalid',
  'partial closed value in inline code still fails');
ok(helper.parsePrimaryRisk(card('`auto-safe')).code === 'invalid',
  'unclosed inline-code around a closed value still fails');
ok(helper.evaluateGate({
  body: card('`figures-moved`'),
  labels: ['figures-moved'],
}).state === 'success', 'inline-code card still matches the GitHub label');
ok(helper.evaluate({
  body: card('`auto-safe`'),
  labels: ['auto-safe', 'tests'],
}).code === 'ok', 'inline-code card does not invent a second label plan');

console.log('\n=== card is the authority; GitHub label is the projection ===');
const match = helper.evaluate({
  body: card('auto-safe'),
  labels: ['auto-safe', 'tests', 'infrastructure'],
});
ok(match.ok && match.code === 'ok' && match.add.length === 0 && match.remove.length === 0,
  'matching card and label is a no-op', match.code);
ok(helper.evaluateGate({
  body: card('auto-safe'),
  labels: ['auto-safe', 'tests'],
}).state === 'success', 'matching card and label passes the gate');

const missing = helper.evaluate({
  body: card('auto-safe'),
  labels: ['tests', 'infrastructure'],
});
ok(missing.ok && missing.add.join() === 'auto-safe' && missing.remove.length === 0,
  'missing GitHub label is added from the card', missing.add.join());
ok(helper.evaluateGate({
  body: card('auto-safe'),
  labels: ['tests'],
}).state === 'failure', 'missing GitHub label fails the gate until sync');

const stale = helper.evaluate({
  body: card('owner-decision'),
  labels: ['auto-safe', 'tests'],
});
ok(stale.add.join() === 'owner-decision' && stale.remove.join() === 'auto-safe',
  'stale auto-safe is replaced by the card value', `${stale.add} / ${stale.remove}`);
ok(helper.evaluateGate({
  body: card('owner-decision'),
  labels: ['auto-safe'],
}).code === 'mismatch', 'stale auto-safe fails the gate against an owner-decision card');

const extra = helper.evaluate({
  body: card('auto-safe'),
  labels: ['auto-safe', 'blocked', 'tests'],
});
ok(extra.add.length === 0 && extra.remove.join() === 'blocked',
  'second primary label is removed; card value is kept', extra.remove.join());

const malformed = helper.evaluate({
  body: card('not-a-risk'),
  labels: ['auto-safe'],
});
ok(malformed.ok === false && malformed.add.length === 0 && malformed.remove.length === 0,
  'malformed card does not invent or strip labels');
ok(helper.evaluateGate({
  body: card('not-a-risk'),
  labels: ['auto-safe'],
}).state === 'failure', 'malformed card fails the gate even if a GitHub label exists');

const blank = helper.evaluateGate({
  body: card(''),
  labels: [],
});
ok(blank.state === 'failure' && /blank|placeholder/i.test(blank.description),
  'blank Primary risk is a red actionable failure');

console.log('\n=== independent of the helper: owner-decision must not keep auto-safe ===');
const fixture = helper.evaluate({
  body: card('owner-decision'),
  labels: ['auto-safe'],
});
ok(!(fixture.add.includes('auto-safe') || fixture.remove.includes('owner-decision')),
  'sync never preserves auto-safe against an owner-decision card');
ok(fixture.add.includes('owner-decision') && fixture.remove.includes('auto-safe'),
  'fixture card owner-decision drops auto-safe');
ok(helper.evaluateGate({
  body: card('owner-decision'),
  labels: ['owner-decision'],
}).state === 'success' && helper.evaluateGate({
  body: card('owner-decision'),
  labels: ['auto-safe'],
}).state === 'failure',
  'gate success requires the GitHub label to equal the card');

console.log('\n=== CLI ===');
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atlas-primary-risk-'));
const requestPath = path.join(tmp, 'request.json');
fs.writeFileSync(requestPath, JSON.stringify({
  body: card('figures-moved'),
  labels: ['auto-safe'],
}));
const cli = spawnSync(process.execPath, [HELPER, 'evaluate', requestPath], { encoding: 'utf8' });
ok(cli.status === 0, 'evaluate CLI exits 0 with a usable plan', String(cli.status));
const cliPlan = JSON.parse(cli.stdout);
ok(cliPlan.cardValue === 'figures-moved' && cliPlan.add.join() === 'figures-moved'
  && cliPlan.remove.join() === 'auto-safe',
  'evaluate CLI plans the card-driven replacement');
const gateCli = spawnSync(process.execPath, [HELPER, 'evaluate-gate', requestPath], { encoding: 'utf8' });
ok(gateCli.status === 2, 'evaluate-gate CLI exits 2 on mismatch', String(gateCli.status));
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }

console.log('\n=== shipped workflow contracts ===');
const workflow = fs.readFileSync(WORKFLOW, 'utf8');
ok(/pull_request_target:/.test(workflow), 'gate still runs from trusted default-branch pull_request_target');
ok(/types:\s*\[[^\]]*edited[^\]]*\]/.test(workflow), 'card edits retrigger the projection');
ok(/ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/.test(workflow)
  && /persist-credentials:\s*false/.test(workflow),
  'helper checkout is the default branch with credentials disabled');
ok(/scripts\/atlas-primary-risk\.js/.test(workflow), 'workflow uses the helper');
ok(!/const PRIMARY = \[/.test(workflow), 'workflow does not keep a second PRIMARY list');
const mergeCardWorkflow = fs.readFileSync(
  path.join(__dirname, '..', '.github/workflows/merge-card-check.yml'),
  'utf8',
);
ok(/scripts\/atlas-primary-risk\.js/.test(mergeCardWorkflow),
  'merge-card-check uses the same helper');
ok(!/const PRIMARY_RISK = \[/.test(mergeCardWorkflow),
  'merge-card-check does not keep a second PRIMARY list');
const mergeCardDefaultBranch = mergeCardWorkflow.search(
  /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/,
);
const mergeCardRequire = mergeCardWorkflow.search(/atlas-primary-risk\.js/);
ok(mergeCardDefaultBranch >= 0 && mergeCardRequire > mergeCardDefaultBranch
  && /persist-credentials:\s*false/.test(mergeCardWorkflow),
  'merge-card-check checks out the trusted default branch before requiring the helper');
ok(!/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(mergeCardWorkflow),
  'merge-card-check never checks out the PR head');
ok(/pull-requests:\s*write/.test(workflow), 'label mutation is the declared write scope');
ok(!/CURSOR_API_KEY|OPENAI_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(workflow),
  'projection does not use repository secrets');
ok(!/auto-merge|enablePullRequestAutoMerge|merge_method/.test(workflow),
  'no auto-merge machinery');
ok(!/ref:\s*\$\{\{\s*github\.event\.pull_request\.head/.test(workflow),
  'workflow never checks out the PR head');
ok(/live head[\s\S]*event head/.test(workflow) || /liveHead[\s\S]*eventHead/.test(workflow),
  'live head must still equal the event head');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
