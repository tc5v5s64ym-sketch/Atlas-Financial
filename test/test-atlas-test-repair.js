'use strict';
/* Contract for the unattended failed-check repair.
 *
 * A red `tests` or merge-card check must start a repair. The repair must not
 * spend OpenAI, merge, weaken financial tests, or loop forever.
 */
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
ok(/rounds >= 2/.test(src), 'stops after two attempts');
ok(/atlas-test-repair-state/.test(src), 'persists the attempt count on the PR');
ok(/secrets\.CURSOR_API_KEY/.test(src), 'uses the existing Cursor credential');
ok(!/OPENAI_API_KEY/.test(src), 'does not spend OpenAI');
ok(/Do not weaken, delete, skip, or rewrite a financial/.test(src),
  'forbids weakening a financial test to go green');
ok(/Do not invent household figures/.test(src), 'forbids inventing figures');
ok(/Do not merge, push, commit/.test(src), 'Cursor is file-edits only');
ok(/atlas-cursor-repair-deny-git\.sh/.test(src) && /atlas-cursor-repair-deny-gh\.sh/.test(src),
  'installs the deny wrappers on Cursor PATH');
ok(/npm test/.test(src), 'proves the patch with npm test before push');
ok(/Live head moved/.test(src), 'refuses to overwrite a moved PR head');
ok(!/gh pr merge|merge_pull_request/.test(src), 'cannot merge');
ok(/persist-credentials:\s*false/.test(src), 'the edit checkout cannot push');
ok(/ATLAS_AUTOMATION_TOKEN/.test(src), 'push uses the existing automation token');

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll atlas-test-repair contract checks passed.');
