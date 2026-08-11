'use strict';
/* The financial publication correctness suite. `npm test`
 *
 * Runs every check that can be made without a password or a network, in
 * dependency order: syntax first (a broken file makes every later result
 * meaningless), then the engine, then the data it is fed, then the
 * contradictions between the two.
 *
 * An invariant failure is a FAILURE, not a warning. A financial plan that
 * disagrees with itself is worse than no plan, because it still looks
 * authoritative.
 *
 * Not run here, because they need something this process does not have:
 *   node test-local.js    needs TEST_PASSWORD and a running server
 *   node verify-live.js   needs the deployed site
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const suites = [
  ['static sanity', 'test-static.js'],
  ['forecast engine + opening-gap regression', 'test-forecast.js'],
  ['income dependency deadline', 'test-income-deadline.js'],
  ['next due obligation', 'test-next-due.js'],
  ['homepage mission', 'test-mission.js'],
  ['May 2027 renewal', 'test-renewal.js'],
  ['household budget reconciliation', 'test-budget.js'],
  ['coupled cash and debt', 'test-debt.js'],
  ['authority invariants', 'test-invariants.js'],
  ['authority surface coverage', 'test-authority-coverage.js'],
  ['merge-card check behaviour', 'test-mergecard.js'],
];

let failed = [];
for (const [name, file] of suites) {
  if (!fs.existsSync(path.join(__dirname, file))) {
    console.log(`\n\x1b[31m✗\x1b[0m ${name} — ${file} is missing`);
    failed.push(name);
    continue;
  }
  console.log(`\n\x1b[1m──────── ${name} ────────\x1b[0m`);
  try {
    execFileSync(process.execPath, [file], { cwd: __dirname, stdio: 'inherit' });
  } catch {
    failed.push(name);
  }
}

console.log('\n' + '═'.repeat(60));
if (failed.length) {
  console.log(`\x1b[31mFAILED\x1b[0m — ${failed.length} of ${suites.length} suites: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`\x1b[32mALL ${suites.length} SUITES PASSED\x1b[0m`);
