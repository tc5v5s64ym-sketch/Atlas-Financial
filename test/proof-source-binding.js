'use strict';
// Proof provenance only. No financial inputs are interpreted or calculated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const git = (root, args) => execFileSync('git', args, {
  cwd: root, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = file => typeof file === 'string' && file.length > 0
  && !file.includes('\\') && !file.includes(':') && !path.posix.isAbsolute(file)
  && !file.split('/').some(part => part === '..' || part === '.' || part === '');

function captureSourceBinding(root, files, baseCommit = null) {
  assert.equal(git(root, ['status', '--porcelain', '--untracked-files=normal']).toString().trim(), '',
    'Proof must start from a clean checkout, before generated evidence changes.');
  assert.ok(Array.isArray(files) && files.length > 0, 'Source scope must not be empty.');
  const headCommit = git(root, ['rev-parse', 'HEAD']).toString().trim();
  if (baseCommit) {
    assert.match(baseCommit, /^[a-f0-9]{40}$/);
    git(root, ['merge-base', '--is-ancestor', baseCommit, headCommit]);
  }
  const bound = {};
  for (const file of [...new Set(files)].sort()) {
    assert.ok(safePath(file), 'Source paths must be repository-relative: ' + file);
    const gitBlob = git(root, ['rev-parse', headCommit + ':' + file]).toString().trim();
    const committed = git(root, ['cat-file', 'blob', gitBlob]);
    const actual = fs.readFileSync(path.join(root, file));
    assert.ok(actual.equals(committed), 'Checkout bytes differ from committed bytes: ' + file);
    bound[file] = { gitBlob, sha256: hash(actual), bytes: actual.length };
  }
  return { sourceCommit: headCommit, sourceTree: git(root, ['rev-parse', 'HEAD^{tree}']).toString().trim(),
    baseCommit, cleanAtStart: true, method: 'exact checkout bytes equal Git blob bytes; no hash normalization',
    files: bound };
}

function verifySourceBinding(root, binding, { allowEvidenceCommit = false } = {}) {
  const current = git(root, ['rev-parse', 'HEAD']).toString().trim();
  if (current !== binding.sourceCommit) {
    assert.ok(allowEvidenceCommit, 'The code commit changed during proof execution.');
    git(root, ['merge-base', '--is-ancestor', binding.sourceCommit, current]);
    const changed = git(root, ['diff', '--name-only', '-z', binding.sourceCommit, current])
      .toString().split('\0').filter(Boolean);
    assert.ok(changed.every(file => file.startsWith('docs/proof/')),
      'Only generated proof/report files may follow the exercised code commit.');
  }
  for (const [file, expected] of Object.entries(binding.files)) {
    assert.ok(safePath(file));
    assert.equal(git(root, ['rev-parse', current + ':' + file]).toString().trim(), expected.gitBlob,
      'Published source blob changed: ' + file);
    const actual = fs.readFileSync(path.join(root, file));
    assert.ok(actual.equals(git(root, ['cat-file', 'blob', expected.gitBlob])),
      'Exercised source bytes changed: ' + file);
    assert.equal(hash(actual), expected.sha256, 'Exercised source hash changed: ' + file);
  }
  return current;
}

module.exports = { captureSourceBinding, verifySourceBinding };
