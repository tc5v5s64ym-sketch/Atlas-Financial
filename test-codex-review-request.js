'use strict';
/* Mechanical coverage for .github/workflows/codex-review-request.yml.
 * `node test-codex-review-request.js`
 *
 * Proves the two defects Codex found on PR #45 cannot recur in the shipped
 * workflow: automatic advisory re-request on every synchronize, and
 * pipefail-unsafe `gh api --paginate | grep -q` deduplication.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sourceText } = require('./test-source-text');

const WORKFLOW = path.join(__dirname, '.github/workflows/codex-review-request.yml');
let failures = 0;

function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

const yaml = sourceText(fs.readFileSync(WORKFLOW, 'utf8'));

console.log('=== P1 — first advisory pass is not retriggered on synchronize ===');
const autoTypesMatch = yaml.match(/pull_request_target:\n\s*types:\s*\[([^\]]+)\]/);
ok(Boolean(autoTypesMatch), 'declares pull_request_target types');
const autoTypes = (autoTypesMatch ? autoTypesMatch[1] : '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
ok(!autoTypes.includes('synchronize'),
  'synchronize is not an automatic pull_request_target trigger',
  autoTypes.join(', ') || 'no types');
ok(
  autoTypes.includes('opened')
    && autoTypes.includes('reopened')
    && autoTypes.includes('ready_for_review'),
  'still requests a first pass on opened, reopened, and ready_for_review',
  autoTypes.join(', '),
);
ok(/^ {2}workflow_dispatch:/m.test(yaml),
  'explicit workflow_dispatch remains for a justified second pass');

console.log('\n=== P2 — paginated comments are materialized before the marker search ===');
ok(!/paginate[\s\S]{0,80}\|\s*grep/.test(yaml),
  'does not pipe `gh api --paginate` into grep');
ok(
  /mktemp[\s\S]{0,400}gh api --paginate[\s\S]{0,200}>\s*"\$\{comments\}"/.test(yaml)
    && /grep -Fq "\$\{marker\}" "\$\{comments\}"/.test(yaml),
  'writes every paginated comment body to a temp file, then greps that file',
);

console.log('\n=== the SIGPIPE failure mode the old pipeline had ===');
const marker = '<!-- atlas-codex-review:deadbeef -->';
const producer = [
  'producer() {',
  `  printf '%s\\n' '${marker}'`,
  '  dd if=/dev/zero bs=65536 count=32 status=none',
  '}',
].join('\n');

const piped = spawnSync('bash', ['-c', [
  'set -euo pipefail',
  producer,
  `if producer | grep -Fq '${marker}'; then echo MATCH; else echo PIPE_FAILED; fi`,
].join('\n')], { encoding: 'utf8' });
ok(
  piped.status === 0 && /PIPE_FAILED/.test(piped.stdout),
  'the old `producer | grep -q` pipeline misses a present marker under pipefail',
  `status=${piped.status} stdout=${JSON.stringify(piped.stdout.trim())}`,
);

const materialized = spawnSync('bash', ['-c', [
  'set -euo pipefail',
  'comments="$(mktemp "${TMPDIR:-/tmp}/atlas-codex-comments.XXXXXX")"',
  'trap \'rm -f "${comments}"\' EXIT',
  producer,
  'producer > "${comments}"',
  `if grep -Fq '${marker}' "\${comments}"; then echo MATCH; else echo NOMATCH; fi`,
].join('\n')], { encoding: 'utf8' });
ok(
  materialized.status === 0 && /MATCH/.test(materialized.stdout),
  'materializing the producer output first finds the same marker under pipefail',
  `status=${materialized.status} stdout=${JSON.stringify(materialized.stdout.trim())}`,
);

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
