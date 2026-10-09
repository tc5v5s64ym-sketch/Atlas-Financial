'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const Store = require('../scripts/assistant-standing-store');
const Policy = require('../scripts/assistant-standing-corrections');
const Runtime = require('../scripts/assistant-standing-runtime');
const Owner = require('../scripts/assistant-standing-owner');
const LM = require('../scripts/assistant-lunchmoney');
const MCP = require('../scripts/assistant-mcp');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const clone = x => JSON.parse(JSON.stringify(x));
function child(input, dir) {
  const file = path.join(dir, crypto.randomBytes(8).toString('hex') + '.json');
  fs.writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
  return new Promise(resolve => {
    const p = spawn(process.execPath, [path.join(__dirname, 'test-assistant-standing-store-worker.js'), file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', b => { out += b; }); p.stderr.on('data', b => { err += b; });
    p.on('close', code => { let parsed; try { parsed = JSON.parse(out.trim()); } catch {}
      resolve({ code, parsed, err }); });
  });
}
async function fixture({ proofPatch = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-standing-synthetic-'));
  const root = path.join(dir, 'authority'); const clock = Date.parse('2026-10-09T00:00:00Z');
  const resource = 'https://atlas.example/assistant/mcp', token = 'synthetic-category-only-token';
  const keys = crypto.generateKeyPairSync('ed25519');
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPath = path.join(dir, 'owner-public.pem'), privateKeyPath = path.join(dir, 'owner-private.pem');
  fs.writeFileSync(publicKeyPath, publicKey, { mode: 0o600 }); fs.writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  const context = { resource, budgetRef: 'synthetic-budget', credentialVersion: 'synthetic-credential-v1',
    credentialDigest: Store.digest(token), contextVersion: 'synthetic-context-v1', parserRevision: 'category-only-v1',
    ruleEffects: 'none-verified', notesEnabled: false, providerProof: { kind: 'synthetic-test',
      reference: 'synthetic-provider-contract', digest: Store.ownerDigest('synthetic-contract'), expiresAt: clock + 86400000, ...proofPatch } };
  const contextPayload = { kind: 'context', context };
  const contextFile = path.join(dir, 'context.json');
  fs.writeFileSync(contextFile, JSON.stringify(contextPayload), { mode: 0o600 });
  let envelope;
  await assert.rejects(Owner.run(['approve', '--file', contextFile, '--approve-digest', 'wrong',
    '--signing-key', privateKeyPath], () => {}), /exact-owner-digest/);
  await Owner.run(['approve', '--file', contextFile, '--approve-digest', Store.ownerDigest(contextPayload),
    '--signing-key', privateKeyPath], value => { envelope = value; });
  const signedFile = path.join(dir, 'signed-context.json'); fs.writeFileSync(signedFile, JSON.stringify(envelope), { mode: 0o600 });
  await Owner.run(['init', '--file', signedFile, '--root', root, '--public-key', publicKeyPath], () => {});
  const adapter = Store.createAuthority({ root, publicKey, resource, now: () => clock });
  const categories = [{ id: 3, name: 'Groceries' }, { id: 8, name: 'Household' }];
  const tx = { id: 71, date: '2026-10-08', amount: '19.99', currency: 'cad', payee: 'Synthetic Shop',
    notes: 'Existing note', category_id: 3, plaid_account_id: 4, manual_account_id: null,
    is_pending: false, status: 'reviewed', tag_ids: [22] };
  const auth = { principal: 'synthetic-owner', clientId: 'synthetic-client', resource,
    scopes: [MCP.REQUIRED_SCOPE, LM.READ_SCOPE, LM.WRITE_SCOPE, Policy.SCOPE] };
  const categoryContext = { from: Policy.categorySignature(categories[0]), to: Policy.categorySignature(categories[1]) };
  async function grant(n = 1) {
    const g = { schema: 'atlas-standing-correction-grant/v1', grantRef: 'grant-' + n.toString(16).padStart(24, '0'),
      revision: 1, principal: auth.principal, clientId: auth.clientId, resource, budgetRef: context.budgetRef,
      credentialVersion: context.credentialVersion, contextVersion: context.contextVersion, parserRevision: context.parserRevision,
      approvalRef: 'approval-' + n.toString(16).padStart(24, '0'), approvedByOwner: true,
      createdAt: clock, expiresAt: clock + 86400000, revokedAt: null, suspended: false,
      accounts: [{ type: 'plaid', id: 4 }], startDate: '2026-10-01', endDate: '2026-10-31',
      categoryTransitions: [{ from: 3, to: 8, fromSignature: categoryContext.from, toSignature: categoryContext.to }],
      allowNotes: false, evidencePolicy: Policy.DELEGATED_POLICY, maxAttempts: 3, attempts: 0 };
    await adapter.ownerUpdate(Store.sign({ kind: 'grant', grant: g }, privateKey)); return g;
  }
  const review = { schema: Policy.DELEGATED_POLICY, status: 'resolved',
    sources: [{ system: 'gmail', reference: 'synthetic-existing-authorized-message', excerptDigest: Store.ownerDigest('synthetic receipt') }],
    facts: { date: tx.date, payee: tx.payee, amount: '19.99', currency: 'cad', completeReceipt: true,
      items: [{ description: 'Synthetic household item', amount: '19.99', category_id: 8 }] },
    rationale: 'All extracted items map to the same allowed category.', issues: [] };
  async function attempt(g, adapterOverride = adapter) {
    const e = await adapterOverride.admit({ grantRef: g.grantRef, auth, tx, body: { category_id: 8 }, review, categoryContext });
    return { grantRef: g.grantRef, grantRevision: 1, evidenceRef: e.evidenceRef, resource,
      budgetRef: context.budgetRef, credentialVersion: context.credentialVersion,
      contextVersion: context.contextVersion, parserRevision: context.parserRevision,
      previewId: 'edit-' + crypto.randomBytes(24).toString('hex'), principal: auth.principal, clientId: auth.clientId,
      transactionId: tx.id, beforeProvider: clone(tx), beforeFingerprint: Store.digest(tx),
      proposedFingerprint: Store.digest({ category_id: 8 }), categoryContext,
      untargetedFingerprint: Store.protectedFingerprint(tx), expectedCategory: 8,
      expiresAt: clock + 600000, requestedAt: clock, before: { category: 'Groceries' }, proposed: { category: 'Household' } };
  }
  return { dir, root, publicKey, privateKey, publicKeyPath, clock, resource, token, context, adapter,
    categories, tx, auth, categoryContext, grant, review, attempt };
}
module.exports = (async () => {
  const owned = [];
  const make = async options => { const f = await fixture(options); owned.push(f.dir); return f; };
  try {
    const f = await make(); const g = await f.grant();
    const unsigned = { payload: { kind: 'grant', grant: { ...g, grantRef: 'grant-' + 'f'.repeat(24) } }, signature: '' };
    await assert.rejects(f.adapter.ownerUpdate(unsigned), /owner-signature/);
    const forged = Store.sign(unsigned.payload, crypto.generateKeyPairSync('ed25519').privateKey);
    await assert.rejects(f.adapter.ownerUpdate(forged), /owner-signature/);
    await assert.rejects(f.adapter.ownerUpdate(Store.sign({ kind: 'grant', grant: { ...g, allowNotes: true } }, f.privateKey)), /category-only/);
    const bad = clone(f.review); bad.independentlyVerified = true;
    await assert.rejects(f.adapter.admit({ grantRef: g.grantRef, auth: f.auth, tx: f.tx,
      body: { category_id: 8 }, review: bad, categoryContext: f.categoryContext }), /unresolved/);
    for (const change of [
      x => { x.status = 'uncertain'; }, x => { x.issues = ['uncertain item']; },
      x => { x.facts.amount = '19.98'; }, x => { x.facts.items[0].category_id = 3; },
      x => { x.facts.completeReceipt = false; }, x => { x.facts.payee = 'Different Merchant'; },
    ]) {
      const review = clone(f.review); change(review);
      await assert.rejects(f.adapter.admit({ grantRef: g.grantRef, auth: f.auth, tx: f.tx,
        body: { category_id: 8 }, review, categoryContext: f.categoryContext }));
    }
    const a = await f.attempt(g); const evidence = await f.adapter.evidence(a.evidenceRef);
    assert.equal(evidence.attestedBy, 'delegated-client-review');
    assert.equal(evidence.provenance.independentlyVerified, false);
    assert.equal(evidence.provenance.principal, f.auth.principal);
    const r = await f.adapter.reserve(a);
    assert.equal((await f.adapter.verifyReservation({ ...a, reservation: r })).valid, true);
    await assert.rejects(f.adapter.reserve(a), /quarantined|inactive/);
    const record = { reservation: r, outcome: 'applied', reason: null, verifiedByReadback: true, finishedAt: f.clock, after: { category: 'Household' } };
    const receipt = await f.adapter.finish(record);
    assert.equal((await f.adapter.grant(g.grantRef)).suspended, true, 'finish retains durable quarantine');
    await assert.rejects(f.adapter.acknowledgeVerified({ reservation: r, receiptRef: receipt.receiptRef, recordFingerprint: 'wrong' }), /verified-audit/);
    await f.adapter.acknowledgeVerified({ reservation: r, receiptRef: receipt.receiptRef, recordFingerprint: Store.digest(record) });
    assert.equal((await f.adapter.grant(g.grantRef)).attempts, 1);
    await assert.rejects(f.adapter.reserve(a), /quarantined/);
    const revived = Store.createAuthority({ root: f.root, publicKey: f.publicKey, resource: f.resource, now: () => f.clock });
    assert.equal((await revived.grant(g.grantRef)).attempts, 1);
    assert.equal((await revived.audit({ grantRef: g.grantRef, auth: f.auth }))[0].outcome, 'applied');
    await assert.rejects(revived.audit({ grantRef: g.grantRef, auth: { ...f.auth, clientId: 'wrong' } }), /mismatch/);
    await revived.ownerUpdate(Store.sign({ kind: 'revoke', grantRef: g.grantRef, at: f.clock }, f.privateKey));
    assert.equal((await revived.grant(g.grantRef)).revokedAt, f.clock);
    // Two REAL processes contend for one target under different signed grants.
    const race = await make(), ga = await race.grant(1), gb = await race.grant(2);
    const aa = await race.attempt(ga), ab = await race.attempt(gb);
    const common = { root: race.root, publicKeyPath: race.publicKeyPath, resource: race.resource, clock: race.clock, action: 'reserve' };
    const results = await Promise.all([child({ ...common, attempt: aa }, race.dir), child({ ...common, attempt: ab }, race.dir)]);
    assert.equal(results.filter(x => x.parsed?.ok).length, 1, JSON.stringify(results));
    assert.equal(race.adapter.list().attempts.length, 1, 'one durable reservation and charged attempt');
    // Crash after reserve's fsync+rename but before reply/finally. No RAM block
    // survives; target and grant quarantine, plus stale process lock, do.
    const crash = await make(), gc = await crash.grant(); const ac = await crash.attempt(gc);
    const crashed = await child({ root: crash.root, publicKeyPath: crash.publicKeyPath,
      resource: crash.resource, clock: crash.clock, action: 'reserve', attempt: ac, crash: 'after-commit' }, crash.dir);
    assert.equal(crashed.code, 91);
    const restarted = Store.createAuthority({ root: crash.root, publicKey: crash.publicKey, resource: crash.resource, now: () => crash.clock });
    assert.equal((await restarted.grant(gc.grantRef)).suspended, true);
    assert.equal((await restarted.grant(gc.grantRef)).attempts, 1);
    await assert.rejects(restarted.reserve(ac), /authority-busy/);
    const recover = restarted.planLockRecovery();
    const readyPath = path.join(crash.dir, 'recovery-ready'), releasePath = path.join(crash.dir, 'recovery-release');
    const recoveryWorker = { root: crash.root, publicKeyPath: crash.publicKeyPath,
      resource: crash.resource, clock: crash.clock, action: 'recover', envelope: Store.sign(recover, crash.privateKey) };
    const firstRecovery = child({ ...recoveryWorker, readyPath, releasePath }, crash.dir);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(readyPath) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(fs.existsSync(readyPath), true, 'first recovery paused while holding acquisition gate');
    const adversaries = await Promise.all([child(recoveryWorker, crash.dir),
      child({ root: crash.root, publicKeyPath: crash.publicKeyPath, resource: crash.resource,
        clock: crash.clock, action: 'reserve', attempt: ac }, crash.dir)]);
    assert.equal(adversaries[0].parsed?.ok, false);
    assert.match(adversaries[0].parsed?.reason || '', /authority-recovery-busy/);
    assert.equal(adversaries[1].parsed?.ok, false);
    assert.match(adversaries[1].parsed?.reason || '', /authority-busy/);
    assert.equal(fs.existsSync(path.join(crash.root, 'authority.lock')), true);
    fs.writeFileSync(releasePath, 'synthetic-release');
    const recovered = await firstRecovery;
    assert.equal(recovered.parsed?.result?.attemptsStillQuarantined, true, JSON.stringify(recovered));
    await assert.rejects(restarted.reserve(ac), /quarantined|inactive/);
    const pending = restarted.list().attempts[0].attemptRef;
    const reconciliation = await restarted.planReconciliation(pending, async () => clone(crash.tx));
    await restarted.reconcile(Store.sign(reconciliation, crash.privateKey), async () => clone(crash.tx));
    assert.equal((await restarted.grant(gc.grantRef)).revokedAt, crash.clock, 'owner recovery cannot revive grant');
    // Finish durably commits, loses its reply; suspend also fails. Restart is
    // blocked by the ACTUAL stored pending acknowledgment, not test RAM.
    const lost = await make(), gl = await lost.grant(), al = await lost.attempt(gl);
    const lr = await lost.adapter.reserve(al);
    const unreliable = Store.createAuthority({ root: lost.root, publicKey: lost.publicKey, resource: lost.resource,
      now: () => lost.clock, fault: point => { if (point === 'after-commit') throw new Error('synthetic-reply-lost'); } });
    await assert.rejects(unreliable.finish({ reservation: lr, outcome: 'applied', reason: null,
      verifiedByReadback: true, finishedAt: lost.clock, after: { category: 'Household' } }), /reply-lost/);
    await assert.rejects(unreliable.suspend({ grantRef: gl.grantRef, attemptRef: lr.attemptRef, reason: 'audit-reply-lost' }), /reply-lost/);
    const ls = Store.createAuthority({ root: lost.root, publicKey: lost.publicKey, resource: lost.resource, now: () => lost.clock });
    assert.equal(ls.list().attempts[0].outcome, 'applied');
    assert.equal((await ls.grant(gl.grantRef)).suspended, true);
    await assert.rejects(ls.reserve(al), /quarantined|inactive/);
    // An armed request can still complete after a GET of the old category.
    // A signed owner observation and restart must not release that quarantine.
    const unknown = await make(), gu = await unknown.grant(), au = await unknown.attempt(gu);
    const ur = await unknown.adapter.reserve(au);
    await unknown.adapter.verifyReservation({ ...au, reservation: ur });
    await unknown.adapter.finish({ reservation: ur, outcome: 'unverified', reason: 'synthetic-timeout',
      verifiedByReadback: false, providerWriteMayHaveOccurred: true, providerRequestReturned: false,
      finishedAt: unknown.clock, after: null });
    const us = Store.createAuthority({ root: unknown.root, publicKey: unknown.publicKey,
      resource: unknown.resource, now: () => unknown.clock });
    let reads = 0;
    const oldGet = async () => { reads++; return clone(unknown.tx); };
    const observation = { kind: 'reconcile', grantRef: gu.grantRef, attemptRef: ur.attemptRef,
      revoke: true, observedFingerprint: Store.digest(unknown.tx), at: unknown.clock };
    await assert.rejects(us.planReconciliation(ur.attemptRef, oldGet), /provider-attempt-closure-unresolved/);
    await assert.rejects(us.reconcile(Store.sign(observation, unknown.privateKey), oldGet), /provider-attempt-closure-unresolved/);
    assert.equal(reads, 2, 'both recovery paths performed only the synthetic old-state GET');
    assert.equal(us.list().attempts[0].acknowledged, false);
    assert.equal((await us.grant(gu.grantRef)).suspended, true);
    assert.equal((await us.grant(gu.grantRef)).attempts, 1);
    const competingGrant = await unknown.grant(2), competing = await unknown.attempt(competingGrant);
    await assert.rejects(us.reserve(competing), /target-or-evidence-quarantined/);
    // Closure must also be rechecked INSIDE the locked mutation. Dispatch can
    // arm while an owner reconciliation awaits its read-only provider GET.
    const closeRace = await make(), gr = await closeRace.grant(), ar = await closeRace.attempt(gr);
    const rr = await closeRace.adapter.reserve(ar);
    const prior = await closeRace.adapter.planReconciliation(rr.attemptRef, async () => clone(closeRace.tx));
    await assert.rejects(closeRace.adapter.reconcile(Store.sign(prior, closeRace.privateKey), async () => {
      await closeRace.adapter.verifyReservation({ ...ar, reservation: rr });
      return clone(closeRace.tx);
    }), /provider-attempt-closure-unresolved/);
    assert.equal(closeRace.adapter.list().attempts[0].acknowledged, false);
    assert.equal((await closeRace.adapter.grant(gr.grantRef)).revokedAt, null);
    // A failed atomic snapshot replacement cannot charge or consume anything.
    const rollback = await make(), gbefore = await rollback.grant(), abefore = await rollback.attempt(gbefore);
    const failBeforeRename = Store.createAuthority({ root: rollback.root, publicKey: rollback.publicKey,
      resource: rollback.resource, now: () => rollback.clock,
      fault: point => { if (point === 'before-rename') throw new Error('synthetic-before-rename'); } });
    await assert.rejects(failBeforeRename.reserve(abefore), /synthetic-before-rename/);
    assert.equal(rollback.adapter.list().attempts.length, 0);
    assert.equal((await rollback.adapter.grant(gbefore.grantRef)).attempts, 0);
    assert.equal((await rollback.adapter.reserve(abefore)).durable, true);
    // Disabled production wiring does not open/create a path, accept a synthetic
    // provider proof, or advertise a capability solely because a flag is set.
    assert.equal(Runtime.fromEnv({ env: { ATLAS_STANDING_STORE_PATH: '/does-not-exist' } }).enabled, false);
    const env = { ATLAS_STANDING_CORRECTIONS_ENABLED: 'true', ATLAS_STANDING_STORE_PATH: f.root,
      ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH: f.publicKeyPath };
    assert.equal(Runtime.fromEnv({ env, resource: f.resource }).enabled, false, 'synthetic proof never activates production');
    assert.equal(Runtime.fromEnv({ env, resource: f.resource, testOnly: true, now: () => f.clock }).enabled, true);
    assert.equal(Runtime.fromEnv({ env: { ...env, ATLAS_STANDING_STORE_PATH: path.resolve(__dirname, '..') },
      resource: f.resource, testOnly: true, now: () => f.clock }).enabled, false);
    // Malformed owner-signed proof expiry cannot activate or mint a grant.
    for (const expiresAt of [undefined, null, NaN, 0, -1, 1.5, String(f.clock + 86400000), f.clock, Number.MAX_SAFE_INTEGER + 1]) {
      const invalid = await make({ proofPatch: { expiresAt } });
      const badEnv = { ATLAS_STANDING_CORRECTIONS_ENABLED: 'true', ATLAS_STANDING_STORE_PATH: invalid.root,
        ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH: invalid.publicKeyPath };
      assert.equal(Runtime.fromEnv({ env: badEnv, resource: invalid.resource, testOnly: true,
        now: () => invalid.clock }).enabled, false, 'malformed expiry: ' + String(expiresAt));
      assert.equal((await invalid.adapter.context()).ruleEffects, 'unknown');
      await assert.rejects(invalid.grant(), /binding-mismatch|provider-proof/);
    }
    const expiring = await make({ proofPatch: { expiresAt: f.clock + 500 } });
    const ge = await expiring.grant(), ae = await expiring.attempt(ge), er = await expiring.adapter.reserve(ae);
    const expired = Store.createAuthority({ root: expiring.root, publicKey: expiring.publicKey,
      resource: expiring.resource, now: () => expiring.clock + 500 });
    await assert.rejects(expired.verifyReservation({ ...ae, reservation: er }), /binding-mismatch|provider-proof/);
    assert.equal(expired.list().attempts[0].acknowledged, false, 'live proof expiry retains quarantine');
    // Resolve ancestor symlinks before containment, including owner init's
    // existing parent. Apparent outside paths can otherwise point into public.
    const links = await make(), project = path.join(links.dir, 'synthetic-project');
    const served = path.join(project, 'public'); fs.mkdirSync(served, { recursive: true });
    const apparentlyExternal = path.join(links.dir, 'external-alias'); fs.symlinkSync(served, apparentlyExternal, 'dir');
    const exposed = path.join(served, 'authority');
    Store.initialize({ root: exposed, publicKey: links.publicKey,
      contextEnvelope: Store.sign({ kind: 'context', context: links.context }, links.privateKey) });
    assert.equal(Runtime.fromEnv({ env: { ATLAS_STANDING_CORRECTIONS_ENABLED: 'true',
      ATLAS_STANDING_STORE_PATH: path.join(apparentlyExternal, 'authority'),
      ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH: links.publicKeyPath }, projectRoot: project,
      resource: links.resource, testOnly: true, now: () => links.clock }).enabled, false);
    const prospective = path.join(apparentlyExternal, 'new-authority');
    assert.throws(() => Runtime.privateInstallation({ root: prospective, keyPath: links.publicKeyPath,
      projectRoot: project, creating: true }), /outside-project/);
    assert.equal(fs.existsSync(path.join(served, 'new-authority')), false);
    const servedKey = path.join(served, 'owner-public.pem'); fs.copyFileSync(links.publicKeyPath, servedKey);
    assert.equal(Runtime.fromEnv({ env: { ATLAS_STANDING_CORRECTIONS_ENABLED: 'true',
      ATLAS_STANDING_STORE_PATH: links.root, ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH: path.join(apparentlyExternal, 'owner-public.pem') },
      projectRoot: project, resource: links.resource, testOnly: true, now: () => links.clock }).enabled, false);
    // The served public directory may itself link to an external directory;
    // containment must exclude that physical serving root as well.
    const publicLink = await make(), linkedProject = path.join(publicLink.dir, 'linked-project');
    const externalPublic = path.join(publicLink.dir, 'external-public');
    fs.mkdirSync(linkedProject); fs.mkdirSync(externalPublic);
    fs.symlinkSync(externalPublic, path.join(linkedProject, 'public'), 'dir');
    const servedAuthority = path.join(externalPublic, 'authority');
    Store.initialize({ root: servedAuthority, publicKey: publicLink.publicKey,
      contextEnvelope: Store.sign({ kind: 'context', context: publicLink.context }, publicLink.privateKey) });
    assert.equal(Runtime.fromEnv({ env: { ATLAS_STANDING_CORRECTIONS_ENABLED: 'true',
      ATLAS_STANDING_STORE_PATH: servedAuthority, ATLAS_STANDING_OWNER_PUBLIC_KEY_PATH: publicLink.publicKeyPath },
      projectRoot: linkedProject, resource: publicLink.resource, testOnly: true, now: () => publicLink.clock }).enabled, false);
    assert.throws(() => Runtime.privateInstallation({ root: path.join(externalPublic, 'new-authority'),
      keyPath: publicLink.publicKeyPath, projectRoot: linkedProject, creating: true }), /outside-project/);
    // Full MCP -> actual authority -> exact synthetic provider edit -> durable
    // audit exchange, plus two independently running service processes.
    const full = await make(), gf = await full.grant();
    const providerPath = path.join(full.dir, 'provider.json'), writesPath = path.join(full.dir, 'writes.log');
    fs.writeFileSync(providerPath, JSON.stringify(full.tx)); fs.writeFileSync(writesPath, '');
    const worker = { root: full.root, publicKeyPath: full.publicKeyPath, resource: full.resource, clock: full.clock,
      action: 'service', token: full.token, auth: full.auth, categories: full.categories, review: full.review,
      providerPath, writesPath };
    const g2 = await full.grant(2);
    const flow = await Promise.all([child({ ...worker, grantRef: gf.grantRef }, full.dir), child({ ...worker, grantRef: g2.grantRef }, full.dir)]);
    assert.equal(flow.filter(x => x.parsed?.result?.status === 'applied').length, 1, JSON.stringify(flow));
    assert.equal(fs.readFileSync(writesPath, 'utf8').trim().split('\n').length, 1);
    const after = JSON.parse(fs.readFileSync(providerPath, 'utf8'));
    assert.equal(after.category_id, 8); assert.equal(after.notes, full.tx.notes); assert.equal(after.amount, full.tx.amount);
    assert.equal(Store.protectedFingerprint(after), Store.protectedFingerprint(full.tx));
    console.log('Real standing authority: owner signatures/digests, delegated provenance, persistent audit/replay/revocation, two-process lease, unknown-dispatch quarantine, locked reconciliation race, atomic rollback, crash/reply-loss recovery and category-only synthetic execution PASS');
  } finally { for (const dir of owned) {
    assert.equal(path.isAbsolute(dir) && dir.startsWith(path.join(os.tmpdir(), 'atlas-standing-synthetic-')), true);
    fs.rmSync(dir, { recursive: true, force: true });
  } }
})().catch(e => { console.error(e); process.exitCode = 1; });
