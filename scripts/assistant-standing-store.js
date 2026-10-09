'use strict';
// One-host private capability/audit authority. No provider or mailbox access.
// Runtime holds a pinned owner PUBLIC key only. Owner signatures alone provision
// grants/context/revocation; evidence claims never carry owner authority.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const Policy = require('./assistant-standing-corrections');
const SCHEMA = 'atlas-standing-authority/v1';
const clone = x => JSON.parse(JSON.stringify(x));
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])])) : x;
const digest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ownerDigest = x => digest(canonical(x));
const opaque = type => type + '-' + crypto.randomBytes(12).toString('hex');
function check(ok, reason) { if (!ok) throw new Error(reason); }
function sign(payload, key) {
  return { payload: clone(payload), signature: crypto.sign(null, Buffer.from(JSON.stringify(canonical(payload))), key).toString('base64') };
}
function verified(envelope, publicKey) {
  check(envelope && typeof envelope.signature === 'string' && envelope.payload, 'owner-signature-required');
  check(crypto.verify(null, Buffer.from(JSON.stringify(canonical(envelope.payload))), publicKey,
    Buffer.from(envelope.signature, 'base64')), 'owner-signature-invalid');
  return envelope.payload;
}
function protectedFingerprint(tx) {
  return ownerDigest(Object.fromEntries(Object.entries(tx).filter(([k]) => !['updated_at', 'category_id'].includes(k))));
}
function createAuthority({ root, publicKey, resource, now = Date.now, fault = () => {} }) {
  check(process.platform !== 'win32', 'posix-durable-store-required');
  check(path.isAbsolute(root), 'private-absolute-store-required');
  const dir = fs.lstatSync(root);
  check(dir.isDirectory() && !dir.isSymbolicLink(), 'private-store-not-directory');
  if (process.platform !== 'win32') check((dir.mode & 0o077) === 0, 'private-store-permissions-required');
  check(crypto.createPublicKey(publicKey).asymmetricKeyType === 'ed25519', 'ed25519-owner-key-required'); // Parse once, never accept a request's key.
  const statePath = path.join(root, 'authority.json');
  const lockPath = path.join(root, 'authority.lock');
  function read() {
    const stat = fs.lstatSync(statePath);
    check(stat.isFile() && !stat.isSymbolicLink() && stat.size < 32 * 1024 * 1024, 'private-store-invalid');
    if (process.platform !== 'win32') check((stat.mode & 0o077) === 0, 'private-state-permissions-required');
    const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    check(saved.schema === SCHEMA && ownerDigest(saved.state) === saved.digest, 'private-state-corrupt');
    check(saved.state.host === os.hostname(), 'single-host-store-required');
    return saved.state;
  }
  function persist(state) {
    const temp = path.join(root, 'commit-' + crypto.randomBytes(12).toString('hex'));
    const data = JSON.stringify({ schema: SCHEMA, digest: ownerDigest(state), state });
    check(Buffer.byteLength(data) < 32 * 1024 * 1024, 'private-store-capacity');
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, data); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fault('before-rename');
      fs.renameSync(temp, statePath);
      // The supported activation topology is POSIX one-host durable storage.
      // Directory fsync is necessary to survive a renamed snapshot after crash.
      const directory = fs.openSync(root, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      fault('after-commit');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  async function mutate(work) {
    let fd;
    for (let n = 0; n < 100; n++) {
      try { fd = fs.openSync(lockPath, 'wx', 0o600); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 5)); }
    }
    check(fd !== undefined, 'authority-busy-or-owner-recovery-required');
    fs.writeFileSync(fd, JSON.stringify({ host: os.hostname(), pid: process.pid, nonce: opaque('lock'), createdAt: now() }));
    fs.fsyncSync(fd);
    try { const state = read(); const result = work(state); persist(state); return clone(result); }
    finally { fs.closeSync(fd); fs.unlinkSync(lockPath); }
  }
  function contextIn(state) {
    const p = verified(state.context, publicKey);
    check(p.kind === 'context' && p.context.resource === resource && p.context.notesEnabled === false, 'owner-context-mismatch');
    const context = clone(p.context);
    if (context.providerProof?.expiresAt <= now()) context.ruleEffects = 'unknown';
    return context;
  }
  function grantIn(state, ref) {
    const envelope = state.grants[ref];
    if (!envelope) return null;
    const p = verified(envelope, publicKey);
    check(p.kind === 'grant' && p.grant.grantRef === ref && p.grant.resource === resource
      && p.grant.evidencePolicy === Policy.DELEGATED_POLICY && p.grant.allowNotes === false, 'owner-grant-mismatch');
    const revoked = state.revocations[ref];
    if (revoked) { const r = verified(revoked, publicKey); check(r.grantRef === ref && (r.kind === 'revoke' || r.kind === 'reconcile' && r.revoke === true), 'owner-revocation-invalid'); }
    const attempts = Object.values(state.attempts).filter(a => a.grantRef === ref).length;
    return { ...clone(p.grant), attempts, revokedAt: revoked ? revoked.payload.at : null,
      suspended: Object.values(state.attempts).some(a => a.grantRef === ref && !a.acknowledged) };
  }
  function ownerUpdate(envelope) {
    const p = verified(envelope, publicKey);
    return mutate(state => {
      if (p.kind === 'grant') {
        const g = p.grant; const ctx = contextIn(state);
        check(g.evidencePolicy === Policy.DELEGATED_POLICY && g.allowNotes === false
          && g.resource === resource && g.approvedByOwner === true && g.attempts === 0
          && g.suspended === false && g.revokedAt === null, 'category-only-owner-grant-required');
        check(!state.grants[g.grantRef], 'grant-cannot-be-overwritten-or-renewed');
        // Fully validate bounds without installing a provider or source record.
        Policy.validateGrantShape(g, ctx, now());
        state.grants[g.grantRef] = clone(envelope);
        return { grantRef: g.grantRef, digest: ownerDigest(p), provisioned: true };
      }
      if (p.kind === 'revoke') {
        check(state.grants[p.grantRef] && Number.isSafeInteger(p.at) && p.at > 0, 'invalid-owner-revocation');
        state.revocations[p.grantRef] = clone(envelope);
        return { grantRef: p.grantRef, revoked: true };
      }
      throw new Error('owner-operation-not-allowed');
    });
  }
  async function admit(input) {
    return mutate(state => {
      const context = contextIn(state); const grant = grantIn(state, input.grantRef);
      check(grant, 'owner-grant-required');
      Policy.validateDelegatedReview({ ...input, context, grant, now: now() });
      const key = ownerDigest({ grantRef: grant.grantRef, transactionId: input.tx.id,
        beforeFingerprint: digest(input.tx), body: input.body, review: input.review });
      check(!state.admissions[key], 'evidence-already-admitted');
      check(Object.keys(state.evidence).length < 2000, 'evidence-capacity');
      const evidenceRef = opaque('evidence');
      const record = { schema: 'atlas-delegated-category-evidence/v1', evidenceRef,
        grantRef: grant.grantRef, grantRevision: grant.revision, policy: Policy.DELEGATED_POLICY,
        contextVersion: grant.contextVersion, parserRevision: grant.parserRevision,
        resolution: 'resolved', attestedBy: 'delegated-client-review',
        transactionId: input.tx.id, beforeFingerprint: digest(input.tx), body: clone(input.body),
        expiresAt: Math.min(grant.expiresAt, now() + 600000),
        provenance: { kind: 'delegated-client-review', independentlyVerified: false,
          principal: input.auth.principal, clientId: input.auth.clientId, resource: input.auth.resource,
          reviewDigest: ownerDigest(input.review) },
        review: clone(input.review), categoryContext: clone(input.categoryContext) };
      state.evidence[evidenceRef] = record; state.admissions[key] = evidenceRef;
      return { evidenceRef, expiresAt: record.expiresAt, provenance: record.provenance };
    });
  }
  function eligibility(state, attempt, charged = false) {
    const ctx = contextIn(state); const grant = grantIn(state, attempt.grantRef);
    const evidence = state.evidence[attempt.evidenceRef];
    check(grant && evidence, 'grant-or-evidence-unavailable');
    // An in-flight charged reservation may use its final budget slot, but no
    // new reservation may; suspended here means any different pending attempt.
    const active = { ...grant, suspended: false, attempts: charged ? grant.attempts - 1 : grant.attempts };
    check(!Object.values(state.attempts).some(a => a.grantRef === grant.grantRef
      && !a.acknowledged && (!charged || a.reservation.attemptRef !== attempt.reservation.attemptRef)), 'grant-quarantined');
    Policy.validate({ grant: active, evidence, context: ctx,
      auth: { principal: attempt.principal, clientId: attempt.clientId, resource: attempt.resource },
      tx: attempt.beforeProvider, body: evidence.body, fingerprint: attempt.beforeFingerprint, now: now(),
      categoryContext: attempt.categoryContext });
    check(digest(evidence.body) === attempt.proposedFingerprint && attempt.expiresAt > now()
      && attempt.contextVersion === ctx.contextVersion && attempt.parserRevision === ctx.parserRevision
      && attempt.credentialVersion === ctx.credentialVersion, 'reservation-binding-changed');
    return { grant, evidence, ctx };
  }
  async function reserve(attempt) {
    return mutate(state => {
      const { grant } = eligibility(state, attempt);
      const target = attempt.budgetRef + ':' + attempt.transactionId;
      check(!state.targets[target] && !state.consumedEvidence[attempt.evidenceRef]
        && !state.consumedPreviews[attempt.previewId], 'target-or-evidence-quarantined');
      const reservation = { attemptRef: opaque('attempt'), grantRef: grant.grantRef,
        grantRevision: grant.revision, durable: true, authorized: true };
      state.attempts[reservation.attemptRef] = { ...clone(attempt), reservation, target,
        outcome: 'pending', acknowledged: false };
      state.targets[target] = reservation.attemptRef;
      state.consumedEvidence[attempt.evidenceRef] = true; state.consumedPreviews[attempt.previewId] = true;
      return reservation;
    });
  }
  async function verifyReservation(attempt) {
    return mutate(state => {
      const saved = state.attempts[attempt.reservation.attemptRef];
      check(saved && !saved.acknowledged && state.targets[saved.target] === attempt.reservation.attemptRef
        && saved.beforeFingerprint === attempt.beforeFingerprint, 'reservation-lease-lost');
      eligibility(state, { ...saved, categoryContext: attempt.categoryContext, reservation: attempt.reservation }, true);
      return { valid: true, attemptRef: attempt.reservation.attemptRef };
    });
  }
  async function finish(record) {
    return mutate(state => {
      const a = state.attempts[record.reservation.attemptRef];
      check(a && !a.acknowledged && a.outcome === 'pending', 'terminal-receipt-already-recorded');
      a.terminal = clone(record); a.outcome = record.outcome;
      a.receipt = { receiptRef: opaque('receipt'), actorRef: a.actorRef || opaque('actor'),
        attemptRef: record.reservation.attemptRef, recordFingerprint: digest(record), durable: true };
      return a.receipt; // NEVER releases the target or grant quarantine.
    });
  }
  async function acknowledgeVerified(ack) {
    return mutate(state => {
      const a = state.attempts[ack.reservation.attemptRef];
      check(a && a.receipt?.receiptRef === ack.receiptRef && a.receipt.recordFingerprint === ack.recordFingerprint
        && a.outcome === 'applied' && a.terminal.verifiedByReadback === true, 'verified-audit-required');
      a.acknowledged = true; delete state.targets[a.target];
      return { acknowledged: true };
    });
  }
  async function suspend(input) {
    return mutate(state => {
      const a = state.attempts[input.attemptRef]; check(a && a.grantRef === input.grantRef, 'reservation-required');
      a.suspension = { reason: input.reason, at: now() }; return { suspended: true };
    });
  }
  async function audit({ grantRef, auth }) {
    const state = read(); const grant = grantIn(state, grantRef);
    check(grant && grant.principal === auth.principal && grant.clientId === auth.clientId
      && grant.resource === auth.resource, 'audit-subject-client-resource-mismatch');
    return Object.values(state.attempts).filter(a => a.grantRef === grantRef).map(a => ({
      reservation: a.reservation, outcome: a.outcome, acknowledged: a.acknowledged,
      before: a.before, proposed: a.proposed, terminal: a.terminal || null,
      receipt: a.receipt || null, evidenceProvenance: state.evidence[a.evidenceRef]?.provenance,
      delegatedReview: state.evidence[a.evidenceRef]?.review }));
  }
  async function reconcile(envelope, fetchTransaction) {
    const p = verified(envelope, publicKey);
    check(p.kind === 'reconcile' && typeof fetchTransaction === 'function', 'owner-read-only-reconciliation-required');
    const state = read(); const a = state.attempts[p.attemptRef]; check(a && !a.acknowledged, 'pending-attempt-required');
    const row = await fetchTransaction(a.transactionId);
    const observed = digest(row);
    check(observed === p.observedFingerprint, 'owner-observation-changed');
    const position = observed === a.beforeFingerprint ? 'before'
      : row.category_id === a.expectedCategory && protectedFingerprint(row) === a.untargetedFingerprint ? 'after' : null;
    check(position, 'provider-state-unresolved');
    return mutate(live => {
      const current = live.attempts[p.attemptRef];
      check(current && !current.acknowledged && current.beforeFingerprint === a.beforeFingerprint, 'reconciliation-raced');
      current.ownerReconciliation = clone(envelope); current.outcome = 'owner-reconciled-' + position;
      current.acknowledged = true; delete live.targets[current.target];
      // Reconciliation cannot revive a grant. A signed permanent revoke closes
      // it; further work needs another exact owner-provisioned grant.
      live.revocations[current.grantRef] = signRequiredRevocation(envelope, current.grantRef);
      return { outcome: current.outcome, grantRequiresReplacement: true };
    });
  }
  function signRequiredRevocation(envelope, grantRef) {
    // Reconciliation payload itself carries an owner-signed revoke binding.
    check(envelope.payload.grantRef === grantRef && envelope.payload.revoke === true, 'reconciliation-must-revoke');
    return envelope;
  }
  function list() {
    const state = read();
    return { context: contextIn(state), grants: Object.keys(state.grants).map(ref => grantIn(state, ref)),
      attempts: Object.values(state.attempts).map(a => ({ attemptRef: a.reservation.attemptRef,
        grantRef: a.grantRef, outcome: a.outcome, acknowledged: a.acknowledged })) };
  }
  function recoverLock(envelope) {
    const p = verified(envelope, publicKey); const raw = fs.readFileSync(lockPath, 'utf8'); const lock = JSON.parse(raw);
    check(p.kind === 'recover-lock' && p.lockDigest === digest(raw) && lock.host === os.hostname(), 'owner-lock-proof-required');
    let alive = true; try { process.kill(lock.pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
    check(!alive, 'lock-process-still-live');
    check(fs.readFileSync(lockPath, 'utf8') === raw, 'lock-changed');
    fs.unlinkSync(lockPath); return { lockRecovered: true, attemptsStillQuarantined: true };
  }
  async function planReconciliation(attemptRef, fetchTransaction) {
    const state = read(), a = state.attempts[attemptRef]; check(a && !a.acknowledged, 'pending-attempt-required');
    const row = await fetchTransaction(a.transactionId);
    const position = digest(row) === a.beforeFingerprint ? 'before'
      : row.category_id === a.expectedCategory && protectedFingerprint(row) === a.untargetedFingerprint ? 'after' : null;
    check(position, 'provider-state-unresolved');
    return { kind: 'reconcile', grantRef: a.grantRef, attemptRef, revoke: true,
      observedFingerprint: digest(row), at: now() };
  }
  function planLockRecovery() {
    return { kind: 'recover-lock', lockDigest: digest(fs.readFileSync(lockPath, 'utf8')), at: now() };
  }
  read(); // Existing owner-initialized store required; never mkdir on startup.
  return { durable: true, context: async () => contextIn(read()),
    grant: async ref => grantIn(read(), ref), evidence: async ref => clone(read().evidence[ref] || null),
    admit, reserve, verifyReservation, finish, acknowledgeVerified, suspend, audit,
    ownerUpdate, reconcile, planReconciliation, recoverLock, planLockRecovery, list };
}
function initialize({ root, publicKey, contextEnvelope }) {
  check(process.platform !== 'win32', 'posix-durable-store-required');
  check(path.isAbsolute(root), 'private-absolute-store-required');
  const p = verified(contextEnvelope, publicKey);
  check(p.kind === 'context' && p.context.notesEnabled === false && p.context.resource, 'signed-category-context-required');
  fs.mkdirSync(root, { mode: 0o700 });
  const state = { host: os.hostname(), context: clone(contextEnvelope), grants: {}, revocations: {},
    evidence: {}, admissions: {}, attempts: {}, targets: {}, consumedEvidence: {}, consumedPreviews: {} };
  const fd = fs.openSync(path.join(root, 'authority.json'), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ schema: SCHEMA, state, digest: ownerDigest(state) })); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  const directory = fs.openSync(root, 'r'); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
module.exports = { createAuthority, initialize, sign, verified, digest, ownerDigest, protectedFingerprint, opaque };
