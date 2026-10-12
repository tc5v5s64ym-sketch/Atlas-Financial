'use strict';
/* Prepare local evidence, never an approval or a public artifact. The caller
 * supplies a previously authorized private directory and exact PR revisions. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { formatFiguresComment } = require('./figures-comment');
const SHA = /^[a-f0-9]{40}$/;
function verify(directory, baseSha, headSha) {
  if (!SHA.test(baseSha) || !SHA.test(headSha)) throw new Error('invalid-revisions');
  const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
  const detail = fs.readFileSync(path.join(directory, 'figures.md'));
  if (receipt.baseSha !== baseSha || receipt.headSha !== headSha
      || receipt.acceptance !== 'withheld'
      || receipt.detailSha256 !== crypto.createHash('sha256').update(detail).digest('hex'))
    throw new Error('stale-or-missing-evidence');
  return receipt;
}
function prepare(directory, baseSha, headSha, cwd = process.cwd()) {
  if (!SHA.test(baseSha) || !SHA.test(headSha) || !path.isAbsolute(directory))
    throw new Error('invalid-revisions-or-private-directory');
  // No overwrite of evidence, and no mutable branch name resolves the inputs.
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git(['rev-parse', 'HEAD']) !== headSha) throw new Error('stale-head');
  for (const sha of [baseSha, headSha])
    if (git(['rev-parse', sha + '^{commit}']) !== sha) throw new Error('invalid-revisions');
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const worktrees = [];
  try {
    const snapshots = [];
    for (const [name, sha] of [['base', baseSha], ['head', headSha]]) {
      const checkout = path.join(directory, name);
      git(['worktree', 'add', '--detach', checkout, sha]);
      worktrees.push(checkout);
      const env = { ...process.env };
      for (const key of ['GITHUB_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS', 'NODE_PATH',
        'GITHUB_STEP_SUMMARY', 'GITHUB_ENV', 'GITHUB_OUTPUT', 'GITHUB_PATH', 'GITHUB_STATE']) delete env[key];
      const bytes = execFileSync(process.execPath, ['scripts/figures-snapshot.js'],
        { cwd: checkout, env, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });
      fs.writeFileSync(path.join(directory, name + '.json'), bytes, { mode: 0o600 });
      snapshots.push(JSON.parse(bytes));
    }
    const detail = `Exact comparison: base ${baseSha}; head ${headSha}.\n\n`
      + formatFiguresComment(snapshots[0], snapshots[1], baseSha);
    fs.writeFileSync(path.join(directory, 'figures.md'), detail, { mode: 0o600 });
    fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify({
      baseSha, headSha, detailSha256: crypto.createHash('sha256').update(detail).digest('hex'),
      acceptance: 'withheld', ownerReconciliationPerformed: false,
    }, null, 2) + '\n', { mode: 0o600 });
    return verify(directory, baseSha, headSha);
  } finally {
    // These are only the exact worktrees created above, inside the verified
    // absolute private directory. Never remove the caller's evidence directory.
    for (const checkout of worktrees) git(['worktree', 'remove', '--force', checkout]);
  }
}
function main(argv) {
  try {
    const [mode, baseSha, headSha, directory] = argv;
    if (argv.length !== 4 || !['prepare', 'verify'].includes(mode)) throw new Error('invalid-configuration');
    if (mode === 'prepare') prepare(directory, baseSha, headSha);
    else verify(directory, baseSha, headSha);
    console.log(JSON.stringify({ type: 'figures-private-evidence', status: 'prepared', acceptance: 'withheld' }));
    return 0;
  } catch {
    console.log(JSON.stringify({ type: 'figures-private-evidence', status: 'incomplete', acceptance: 'withheld' }));
    return 78;
  }
}
if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { prepare, verify, main };
