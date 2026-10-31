'use strict';
/* Failed checks remain failures; automatic edits are withheld until private
 * artifact transport exists. Normal tests and genuine review remain required. */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

const src = sourceText(fs.readFileSync(
  path.join(__dirname, '..', '.github/workflows/atlas-test-repair.yml'),
  'utf8',
));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

console.log('=== atlas-test-repair.yml contract ===');
ok(/workflows:\s*\["tests", "Merge card check"\]/.test(src),
  'wakes on failed tests and merge-card completeness');
ok(/github\.event\.workflow_run\.conclusion == 'failure'/.test(src),
  'ignores green and cancelled runs');
ok(/ref: \$\{\{ github.event.repository.default_branch \}\}/.test(src), 'gate runs trusted default-branch code');
ok(/ci-output.js --identity atlas-test-repair-gate -- node trusted\/scripts\/ci-repair-privacy.js test-failure/.test(src),
  'failed-check gate runs behind private output capture');
ok(!/secrets\.|CURSOR_API_KEY|OPENAI_API_KEY|ATLAS_AUTOMATION_TOKEN/.test(src), 'no model or automation credentials');
ok(!/cursor-agent|git (?:push|commit)|upload-artifact|download-artifact|download.*logs/.test(src),
  'no automatic edits, raw artifacts, logs, commits or pushes');
const gate = fs.readFileSync(path.join(__dirname, '..', 'scripts/ci-repair-privacy.js'), 'utf8');
ok(/HOLD_EXIT = 78/.test(gate) && /private-artifact-blocked/.test(gate), 'eligible repair fails closed with bounded status');
ok(/pr.draft === true/.test(gate), 'Draft test-failure lane remains skipped');
const tests = sourceText(fs.readFileSync(path.join(__dirname, '..', '.github/workflows/test.yml'), 'utf8'));
const runner = require('./test');
ok(require('../package.json').scripts.test === 'node test/test.js',
  'npm test retains the complete serial reference');
ok(/^        run: bash scripts\/ci-test.sh standard$/m.test(tests)
  && /^        run: bash scripts\/ci-test.sh refresh-isolation$/m.test(tests),
  'normal CI runs both explicit correctness groups');
const combined = [...runner.selectSuites('standard'), ...runner.selectSuites('refresh-isolation')]
  .map(([, file]) => file);
const full = runner.suites.map(([, file]) => file);
ok(combined.length === full.length && new Set(combined).size === full.length
  && JSON.stringify([...combined].sort()) === JSON.stringify([...full].sort()),
  'split correctness jobs cover the full manifest exactly once');
ok(/^    needs: \[standard, refresh-isolation\]$/m.test(tests)
  && /^    if: \$\{\{ always\(\) \}\}$/m.test(tests),
  'the stable aggregate requires both groups even after a non-success');
ok(!/gh pr merge|merge_pull_request/.test(src), 'cannot merge');
ok(/persist-credentials:\s*false/.test(src), 'trusted checkout does not persist credentials');

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll atlas-test-repair contract checks passed.');
