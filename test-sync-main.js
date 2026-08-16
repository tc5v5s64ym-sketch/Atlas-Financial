'use strict';
/* Safety contract for scripts/sync-main.ps1.
 *
 * This script must stay a fast-forward-only local updater. A wording change
 * that introduces reset --hard, a force push, or an automatic branch switch
 * would let a scheduled task discard work. CI is Linux, so this inspects the
 * source rather than executing PowerShell.
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

const src = sourceText(fs.readFileSync(path.join(__dirname, 'scripts', 'sync-main.ps1'), 'utf8'));

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

console.log('=== sync-main.ps1 safety contract ===');
ok(src.includes('merge --ff-only'), 'fast-forwards with --ff-only');
ok(src.includes('git fetch origin --prune'), 'fetches and prunes');
ok(/refuse to touch a dirty worktree|Cannot fast-forward main: dirty/.test(src), 'refuses a dirty main worktree');
ok(/leave the current branch alone if it is not main/.test(src), 'does not switch off a feature branch');
ok(!/\bgit\s+reset\s+--hard/.test(src), 'never git reset --hard');
ok(!/push\s+--force|push\s+-f\b/.test(src), 'never force-pushes');
ok(!/--no-verify/.test(src), 'never bypasses hooks');
ok(!/\bgit\s+push\b/.test(src), 'never pushes');
ok(/AtlasFinancial-SyncMain/.test(src), 'scheduled task has a stable name');
ok(/sync-main\.log/.test(src), 'writes a local log outside the repo');

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll sync-main safety checks passed.');
