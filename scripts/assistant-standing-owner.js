'use strict';
// Owner-only out-of-band signing CLI. The server never mounts the signing key.
// This file defines commands; importing it creates no storage or grants.
const fs = require('node:fs');
const path = require('node:path');
const Store = require('./assistant-standing-store');
const Runtime = require('./assistant-standing-runtime');
async function run(argv, output = value => console.log(JSON.stringify(value, null, 2))) {
  const command = argv[0]; const flags = {};
  for (let i = 1; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith('--') || !argv[i + 1] || flags[argv[i]]) throw new Error('invalid-owner-arguments');
    flags[argv[i]] = argv[i + 1];
  }
  const input = () => JSON.parse(fs.readFileSync(flags['--file'], 'utf8'));
  if (command === 'plan') { const payload = input(); output({ digest: Store.ownerDigest(payload), payload }); return; }
  if (command === 'approve') {
    const payload = input();
    if (flags['--approve-digest'] !== Store.ownerDigest(payload)) throw new Error('exact-owner-digest-required');
    const keyPath = flags['--signing-key'];
    if (!keyPath || !path.isAbsolute(keyPath)) throw new Error('owner-signing-key-required');
    const stat = fs.lstatSync(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || process.platform !== 'win32' && (stat.mode & 0o077)) throw new Error('private-owner-key-required');
    output(Store.sign(payload, fs.readFileSync(keyPath))); return;
  }
  const root = flags['--root'], keyPath = flags['--public-key'];
  if (!root || !keyPath || !path.isAbsolute(root) || !path.isAbsolute(keyPath)) throw new Error('private-owner-installation-required');
  if (!Runtime.outside(path.resolve(__dirname, '..'), root) || !Runtime.outside(path.resolve(__dirname, '..'), keyPath)
      || !Runtime.outside(root, keyPath)) throw new Error('owner-store-must-be-outside-project');
  const publicKey = fs.readFileSync(keyPath, 'utf8');
  if (command === 'init') {
    const envelope = input();
    Store.initialize({ root, publicKey, contextEnvelope: envelope });
    output({ initialized: true, noGrantProvisioned: true }); return;
  }
  const resource = flags['--resource'];
  const authority = Store.createAuthority({ root, publicKey, resource });
  if (command === 'list') { output(authority.list()); return; }
  if (command === 'provision' || command === 'revoke') {
    const envelope = input();
    if (envelope.payload?.kind !== (command === 'provision' ? 'grant' : 'revoke')) throw new Error('owner-command-kind-mismatch');
    output(await authority.ownerUpdate(envelope)); return;
  }
  if (command === 'plan-lock-recovery') { const payload = authority.planLockRecovery(); output({ digest: Store.ownerDigest(payload), payload }); return; }
  if (command === 'recover-lock') { output(authority.recoverLock(input())); return; }
  const fetchTransaction = id => Runtime.readOnlyProvider({ context: authority.list().context }, id);
  if (command === 'plan-reconcile') {
    const payload = await authority.planReconciliation(flags['--attempt-ref'], fetchTransaction);
    output({ digest: Store.ownerDigest(payload), payload }); return;
  }
  if (command === 'reconcile') { output(await authority.reconcile(input(), fetchTransaction)); return; }
  throw new Error('unknown-owner-command');
}
if (require.main === module) run(process.argv.slice(2)).catch(() => {
  console.error('Owner standing operation refused; no provider write was made.'); process.exitCode = 1;
});
module.exports = { run };
