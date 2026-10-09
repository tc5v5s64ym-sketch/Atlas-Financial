'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Store = require('./assistant-standing-store');
const Credentials = require('./local-credentials');
function outside(parent, child) {
  const relative = path.relative(parent, child);
  return relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative);
}
function privateInstallation({ root, keyPath, projectRoot = path.resolve(__dirname, '..'), creating = false }) {
  if (!root || !keyPath || !path.isAbsolute(root) || !path.isAbsolute(keyPath))
    throw new Error('private-installation-required');
  const project = fs.realpathSync(projectRoot);
  const resolvedRoot = creating
    ? path.join(fs.realpathSync(path.dirname(root)), path.basename(root)) : fs.realpathSync(root);
  const resolvedKey = fs.realpathSync(keyPath);
  if (!outside(project, resolvedRoot) || !outside(project, resolvedKey) || !outside(resolvedRoot, resolvedKey))
    throw new Error('owner-store-must-be-outside-project');
  if (!creating && fs.lstatSync(root).isSymbolicLink() || fs.lstatSync(keyPath).isSymbolicLink())
    throw new Error('pinned-owner-installation-required');
  return { root: resolvedRoot, keyPath: resolvedKey };
}
function fromEnv({ env = process.env, resource, projectRoot = path.resolve(__dirname, '..'),
  now = Date.now, testOnly = false } = {}) {
  // Default construction performs NO filesystem/provider reads and creates no
  // grant, storage, key, or consent. Activation is separately owner approved.
  if (env.ATLAS_STANDING_CORRECTIONS_ENABLED !== 'true') return { enabled: false, notesEnabled: false };
  try {
    if (process.platform === 'win32' || !resource) throw new Error('unsupported-topology');
    const root = env.ATLAS_STANDING_STORE_PATH, keyPath = env.ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH;
    const installation = privateInstallation({ root, keyPath, projectRoot });
    const publicKey = fs.readFileSync(installation.keyPath, 'utf8');
    const adapter = Store.createAuthority({ root: installation.root, publicKey, resource, now });
    const context = adapter.list().context;
    const proof = context.providerProof;
    if (context.ruleEffects !== 'none-verified' || !Store.validProofExpiry(proof, now())
        || !(proof.kind === 'provider-confirmed-api-contract' || testOnly && proof.kind === 'synthetic-test')
        || typeof proof.reference !== 'string' || !proof.reference || !/^[a-f0-9]{64}$/.test(proof.digest))
      throw new Error('provider-rule-effects-unestablished');
    const rawContext = adapter.context;
    adapter.context = async () => {
      const current = await rawContext();
      if (!Store.validProofExpiry(current.providerProof, now())) current.ruleEffects = 'unknown';
      return current;
    };
    return { enabled: true, notesEnabled: false, adapter };
  } catch (_) {
    return { enabled: false, notesEnabled: false, reason: 'standing-activation-prerequisite-unavailable' };
  }
}
async function readOnlyProvider({ env = process.env, context }, id) {
  const { token } = await Credentials.resolveLunchMoneyAccessToken({ env });
  if (Store.digest(token) !== context.credentialDigest) throw new Error('provider-credential-changed');
  const Provider = require('./provider-observe');
  const response = await fetch(Provider.lunchMoneyApiBase(env) + '/transactions/' + id, {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!response.ok) throw new Error('read-only-reconciliation-unavailable');
  return response.json();
}
module.exports = { fromEnv, readOnlyProvider, outside, privateInstallation };
