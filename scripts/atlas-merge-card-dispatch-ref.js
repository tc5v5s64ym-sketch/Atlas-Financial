'use strict';
/* Choose the merge-card-check workflow_dispatch ref.
 * `node scripts/atlas-merge-card-dispatch-ref.js`
 *
 * `gh workflow run --ref` uses the branch or tag that contains the workflow
 * version. A PR head created before `workflow_dispatch` reached
 * merge-card-check.yml cannot be targeted. Those heads use the default-branch
 * workflow version; merge-card-check then records the required check on the
 * expected PR head.
 *
 * This helper never talks to the network and never reads secrets.
 *
 * CLI:
 *   select <workflow-file> <live-ref> <default-branch>  → ref on stdout; exit 0 or 1
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_DISPATCH_RE = /^[ \t]*workflow_dispatch:/m;

function fail(code, reason) {
  return { ok: false, code, reason };
}

function selectDispatchRef(workflowText, liveRef, defaultBranch) {
  const live = String(liveRef || '').trim();
  const fallback = String(defaultBranch || '').trim();
  if (!live) {
    return fail('missing-live-ref', 'Live PR head ref is missing.');
  }
  const text = String(workflowText || '').replace(/\r\n?/g, '\n');
  if (!text.trim()) {
    return fail('missing-workflow', 'merge-card-check.yml at the live head is missing.');
  }
  if (WORKFLOW_DISPATCH_RE.test(text)) {
    return { ok: true, ref: live, source: 'pr-head' };
  }
  if (!fallback) {
    return fail(
      'missing-default-branch',
      'Default branch is missing for a PR head that predates workflow_dispatch.',
    );
  }
  return { ok: true, ref: fallback, source: 'default-branch' };
}

function main(argv) {
  const command = argv[2];
  if (command === 'select') {
    const filePath = argv[3];
    const liveRef = argv[4];
    const defaultBranch = argv[5];
    if (!filePath || liveRef == null || defaultBranch == null) {
      process.stderr.write(
        'usage: atlas-merge-card-dispatch-ref.js select <workflow-file> <live-ref> <default-branch>\n',
      );
      return 1;
    }
    let workflowText;
    try {
      workflowText = fs.readFileSync(path.resolve(filePath), 'utf8');
    } catch (error) {
      const detail = error && error.message ? ` (${error.message})` : '.';
      process.stderr.write(`Could not read merge-card-check.yml at the live head${detail}\n`);
      return 1;
    }
    const result = selectDispatchRef(workflowText, liveRef, defaultBranch);
    if (!result.ok) {
      process.stderr.write(`${result.reason}\n`);
      return 1;
    }
    process.stderr.write(`Merge Card dispatch uses the ${result.source} workflow version.\n`);
    process.stdout.write(`${result.ref}\n`);
    return 0;
  }
  process.stderr.write(
    'usage: atlas-merge-card-dispatch-ref.js select <workflow-file> <live-ref> <default-branch>\n',
  );
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  WORKFLOW_DISPATCH_RE,
  selectDispatchRef,
};
