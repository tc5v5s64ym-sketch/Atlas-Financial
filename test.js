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
  ['source line-ending independence', 'test-line-endings.js'],
  ['forecast engine + opening-gap regression', 'test-forecast.js'],
  ['quarterly recurrence (every 3 months)', 'test-quarterly-recurrence.js'],
  ['income dependency deadline', 'test-income-deadline.js'],
  ['next due obligation', 'test-next-due.js'],
  ['next payment out', 'test-next-payment-out.js'],
  ['household schedule authority', 'test-schedule-authority.js'],
  ['question status authority', 'test-question-status.js'],
  ['unallocated / free cash', 'test-unallocated-cash.js'],
  ['compact snapshot', 'test-compact-snapshot.js'],
  ['publication totals', 'test-publication-totals.js'],
  ['homepage mission', 'test-mission.js'],
  ['plan status band + funding verdicts', 'test-status-band.js'],
  ['what the next move achieves', 'test-nextmove.js'],
  ['gap counterfactuals', 'test-counterfactuals.js'],
  ['May 2027 renewal', 'test-renewal.js'],
  ['payoff modeller', 'test-payoff.js'],
  ['household budget reconciliation', 'test-budget.js'],
  ['workbook evidence cannot overwrite owner policy', 'test-workbook-authority.js'],
  ['spending classification reconciliation', 'test-classification.js'],
  ['weekly cap conversion + discretionary room', 'test-weekly-cap.js'],
  ['food and fuel monthly figures', 'test-food-fuel.js'],
  ['phase titles and risk list', 'test-plan-phases.js'],
  ['Deep Dive derived totals', 'test-deepdive.js'],
  ['HELOC Deep Dive current-opening agreement (B19)', 'test-heloc-deepdive.js'],
  ['coupled cash and debt', 'test-debt.js'],
  ['authority invariants', 'test-invariants.js'],
  ['authority surface coverage', 'test-authority-coverage.js'],
  ['evidence-use register routing', 'test-evidence-use-register.js'],
  ['live household reconciliation', 'test-live-household.js'],
  ['duplicate live-fact cleanup (B93)', 'test-dedup-facts.js'],
  ['refresh isolation (B92)', 'test-refresh-isolation.js'],
  ['non-writing reconciliation (B91)', 'test-reconcile.js'],
  ['current-state cutover (B91)', 'test-cutover.js'],
  ['commitment settlement (B91 D3)', 'test-settlement.js'],
  ['Hydro dated obligation (B91 D4+D5)', 'test-hydro.js'],
  ['Amanda income split (B91 D2)', 'test-amanda-income.js'],
  ['card current state (B91 D8)', 'test-card-state.js'],
  ['schedule vs posted (B91 D7)', 'test-posting.js'],
  ['near-boundary payday output (B91 D11)', 'test-near-boundary.js'],
  ['B91 live current-state cutover', 'test-b91-cutover.js'],
  ['merge-card check behaviour', 'test-mergecard.js'],
  ['Codex Cursor repair gate', 'test-codex-cursor-repair.js'],
  ['Atlas review-block card sync', 'test-atlas-review-block.js'],
  ['instant Atlas API re-review', 'test-atlas-api-rereview.js'],
  ['Atlas first REQUIRED review wake-up', 'test-atlas-first-review.js'],
  ['Merge Card primary-risk projection', 'test-atlas-primary-risk.js'],
  ['GitHub PR-head confirmation after push', 'test-github-pr-head-sync.js'],
  ['local main sync safety contract', 'test-sync-main.js'],
  ['failed-check auto-repair contract', 'test-atlas-test-repair.js'],
  ['read-only provider observation (connectivity spike)', 'test-provider-observe.js'],
  ['live pending observations (B91 / B78)', 'test-pending-observe.js'],
  ['idempotent Lunch Money identity (B78 / AF-INGEST-01)', 'test-b78-identity.js'],
  ['trusted canonical refresh (B81 / AF-LIVE-02)', 'test-b81-refresh.js'],
  ['Aug. 16 household evidence absorption', 'test-aug16-evidence.js'],
  ['major future costs on the master plan', 'test-major-future-costs.js'],
  ['master forecast engine (B94 / AF-PLAN-01)', 'test-master-forecast.js'],
  ['end-to-end payday proof (B96 / AF-PLAN-02)', 'test-b96-payday.js'],
  ['balance history as a refresh by-product (B20 / AF-HIST-01)', 'test-b20-history.js'],
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
