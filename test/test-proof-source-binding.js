'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { captureSourceBinding, verifySourceBinding } = require('./proof-source-binding');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-proof-binding-'));
const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
const write = (file, body) => fs.writeFileSync(path.join(root, file), body);
try {
  git(['init', '-q']);
  git(['config', 'user.name', 'Invented proof test']);
  git(['config', 'user.email', 'proof@example.test']);
  git(['config', 'core.autocrlf', 'false']);
  write('source.js', 'const invented = 1;\n');
  git(['add', 'source.js']); git(['commit', '-qm', 'source']);
  const base = git(['rev-parse', 'HEAD']).toString().trim();
  const binding = captureSourceBinding(root, ['source.js'], base);
  assert.equal(binding.cleanAtStart, true);
  assert.equal(binding.files['source.js'].gitBlob, git(['rev-parse', 'HEAD:source.js']).toString().trim());
  assert.equal(verifySourceBinding(root, binding), base);
  // Git may call a CRLF checkout clean while its committed bytes are LF.
  git(['config', 'core.autocrlf', 'true']);
  write('source.js', 'const invented = 1;\r\n');
  // Git's cached text attributes vary across hosts. Either cleanliness or
  // exact-byte validation must reject CRLF; verification always compares bytes.
  assert.throws(() => captureSourceBinding(root, ['source.js']), /clean checkout|Checkout bytes differ/);
  assert.throws(() => verifySourceBinding(root, binding), /Exercised source bytes changed/);
  git(['config', 'core.autocrlf', 'false']); git(['checkout-index', '-af']);
  for (const bytes of ['const invented = 1;\r\n', '\uFEFFconst invented = 1;\n', 'const invented = 2;\n']) {
    write('source.js', bytes);
    assert.throws(() => verifySourceBinding(root, binding), /Exercised source bytes changed/);
    assert.throws(() => captureSourceBinding(root, ['source.js']), /clean checkout/);
    git(['checkout-index', '-af']);
  }
  write('untracked.txt', 'invented\n');
  assert.throws(() => captureSourceBinding(root, ['source.js']), /clean checkout/);
  fs.unlinkSync(path.join(root, 'untracked.txt'));
  assert.throws(() => captureSourceBinding(root, ['../outside']), /repository-relative/);
  assert.throws(() => captureSourceBinding(root, ['missing.js']));
  assert.throws(() => captureSourceBinding(root, []), /must not be empty/);
  fs.mkdirSync(path.join(root, 'docs/proof'), { recursive: true });
  write('docs/proof/receipt.json', '{}\n');
  assert.equal(verifySourceBinding(root, binding), base, 'Generated evidence need not mutate exercised code.');
  git(['add', 'docs']); git(['commit', '-qm', 'evidence']);
  assert.throws(() => verifySourceBinding(root, binding), /code commit changed/);
  assert.equal(verifySourceBinding(root, binding, { allowEvidenceCommit: true }),
    git(['rev-parse', 'HEAD']).toString().trim());
  write('source.js', 'const invented = 2;\n'); git(['add', 'source.js']); git(['commit', '-qm', 'changed source']);
  assert.throws(() => verifySourceBinding(root, binding, { allowEvidenceCommit: true }), /Only generated proof/);
  console.log('PASS clean proof source binding: exact Git blobs, CRLF/BOM/content rejection, clean start, immutable source and evidence-only publication');
} finally {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('atlas-proof-binding-'));
  fs.rmSync(resolved, { recursive: true, force: true });
}
