'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const LM = require('../scripts/assistant-lunchmoney');
const Standing = require('../scripts/assistant-standing-corrections');
const OAuth = require('../scripts/assistant-oauth');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const opaque = (type, n) => type + '-' + n.toString(16).padStart(24, '0');
function fixture(enabled = true) {
  let clock = Date.parse('2026-10-09T00:00:00Z');
  const token = 'synthetic-standing-test-token';
  const auth = { principal: 'synthetic-owner', clientId: 'synthetic-client',
    scopes: [LM.READ_SCOPE, LM.WRITE_SCOPE, Standing.SCOPE] };
  const tx = { id: 71, date: '2026-10-08', amount: '19.99', currency: 'cad', payee: 'Synthetic Shop',
    notes: 'Existing receipt reference', category_id: 3, plaid_account_id: 4, manual_account_id: null,
    is_pending: false, status: 'reviewed', tag_ids: [22] };
  const categories = [{ id: 3, name: 'Groceries' }, { id: 8, name: 'Household' }];
  const context = { budgetRef: 'synthetic-budget', credentialVersion: 'synthetic-version', credentialDigest: hash(token), ruleEffects: 'none-verified' };
  const grant = { schema: 'atlas-standing-correction-grant/v1', grantRef: opaque('grant', 1), revision: 1,
    principal: auth.principal, clientId: auth.clientId, ...Object.fromEntries(['budgetRef', 'credentialVersion'].map(k => [k, context[k]])),
    approvalRef: opaque('approval', 1), approvedByOwner: true, createdAt: clock, expiresAt: clock + 86400000,
    revokedAt: null, suspended: false, accounts: [{ type: 'plaid', id: 4 }], startDate: '2026-10-01', endDate: '2026-10-31',
    categoryTransitions: [{ from: 3, to: 8 }], allowNotes: true, evidencePolicy: 'synthetic-exact-receipt-v1',
    maxAttempts: 2, attempts: 0 };
  const state = { context, grant, tx, categories, writes: [], receipts: [], pending: false,
    evidence: null, hook: null, ambiguous: false, mismatch: false, mutateOther: false,
    auditFailure: false, missingActor: false, credentialChange: false, reserveFailure: false };
  const adapter = { durable: true,
    context: async () => structuredClone(context),
    grant: async ref => ref === grant.grantRef ? structuredClone(grant) : null,
    evidence: async ref => ref === state.evidence?.evidenceRef ? structuredClone(state.evidence) : null,
    // Synthetic effect evaluator, NOT the production observer adapter. Any
    // owner/classification effect is tested as rejection; production activation
    // still needs proof against the incumbent real map/plan/tags/parser.
    noteEffects: async (before, after) => {
      const effects = row => ({ personalOwner: /\bdale\b/i.test(row.notes) ? 'dale'
        : /\bamanda\b/i.test(row.notes) ? 'amanda' : null,
        fuel: /\bfuel\b/i.test(row.notes), payment: /\bpayment\b/i.test(row.notes) });
      return { schema: 'atlas-standing-note-effects/v1', parserRevision: 'synthetic-v1',
        before: effects(before), after: effects(after) };
    },
    reserve: async attempt => {
      if (state.hook) state.hook();
      if (state.reserveFailure || grant.revokedAt !== null || grant.suspended || state.pending
          || grant.expiresAt <= clock || attempt.expiresAt <= clock
          || grant.revision !== attempt.grantRevision || grant.attempts >= grant.maxAttempts
          || attempt.budgetRef !== context.budgetRef || attempt.credentialVersion !== context.credentialVersion)
        throw new Error('synthetic-reservation-denied');
      // Atomic durable-store contract simulated: charge BEFORE provider attempt;
      // neither errors nor restarts refund this attempt.
      grant.attempts++; state.pending = true;
      const reservation = { attemptRef: opaque('attempt', grant.attempts), grantRef: grant.grantRef,
        grantRevision: grant.revision, durable: true, authorized: true };
      state.receipts.push({ ...structuredClone(attempt), reservation, outcome: 'pending' });
      return reservation;
    },
    suspend: async () => { grant.suspended = true; },
    finish: async outcome => {
      if (state.auditFailure) throw new Error('synthetic-audit-failure');
      state.pending = false;
      if (outcome.outcome === 'write-unverified') grant.suspended = true;
      Object.assign(state.receipts.at(-1), structuredClone(outcome));
      return { receiptRef: opaque('receipt', grant.attempts), actorRef: state.missingActor ? null : opaque('actor', 1), durable: true };
    },
  };
  const service = LM.createService({ now: () => clock, env: {}, standingCorrections: { enabled, adapter },
    resolveToken: async () => state.credentialChange ? 'other-synthetic-token' : token,
    fetch: async (url, options) => {
      const u = new URL(url); const path = u.pathname.replace('/v2', ''); let data;
      if (options.method !== 'GET') {
        state.writes.push({ method: options.method, path, query: u.search, body: JSON.parse(options.body) });
        assert.equal(state.pending, true, 'durable reservation exists before provider write');
        if (state.ambiguous) throw new Error('synthetic-transport-failure');
        if (!state.mismatch) Object.assign(tx, JSON.parse(options.body));
        if (state.mutateOther) tx.tag_ids.push(33);
        data = tx;
      } else if (path === '/categories') data = { categories };
      else if (path.startsWith('/categories/')) data = categories.find(x => x.id === Number(path.split('/').pop()));
      else if (path === '/plaid_accounts') data = { plaid_accounts: [{ id: 4, name: 'Synthetic Bank' }] };
      else if (path === '/manual_accounts') data = { manual_accounts: [] };
      else if (path === '/transactions') data = { transactions: [tx], has_more: false };
      else data = tx;
      return { ok: true, json: async () => structuredClone(data) };
    },
  });
  async function proposal(body = { category_id: 8 }) {
    const cat = await service.invoke('catalog', {}, auth);
    const rows = await service.invoke('query', { startDate: '2026-10-01', endDate: '2026-10-31' }, auth);
    state.evidence = { schema: 'atlas-standing-correction-evidence/v1', evidenceRef: opaque('evidence', 1),
      grantRef: grant.grantRef, grantRevision: grant.revision, policy: grant.evidencePolicy,
      resolution: 'resolved', attestedBy: 'trusted-evidence-policy', expiresAt: clock + 86400000,
      transactionId: tx.id, beforeFingerprint: hash(tx), body: structuredClone(body) };
    return { transactionRef: rows.rows[0].transactionRef, grantRef: grant.grantRef, evidenceRef: state.evidence.evidenceRef,
      changes: { ...(body.category_id === undefined ? {} : { categoryRef: cat.categories.find(x => x.name === 'Household').categoryRef }),
        ...(body.notes === undefined ? {} : { notesAppend: body.notes.slice(tx.notes.length + 1) }) } };
  }
  return { ...state, state, adapter, service, auth, proposal, clock: () => clock, advance: ms => { clock += ms; } };
}
async function deniedBeforeWrite(mutator, phase = 'prepare') {
  const f = fixture(); const args = await f.proposal();
  if (phase === 'prepare') {
    mutator(f);
    const result = await f.service.invoke('prepareStanding', args, f.auth);
    assert.equal(result.status, 'unavailable');
  } else {
    const preview = await f.service.invoke('prepareStanding', args, f.auth);
    assert.equal(preview.status, 'preview'); mutator(f);
    const result = await f.service.invoke('applyStanding', { previewId: preview.previewId }, f.auth);
    assert.equal(result.status, 'unavailable');
  }
  assert.equal(f.state.writes.length, 0); return f;
}
module.exports = (async () => {
  const f = fixture(); const args = await f.proposal();
  const preview = await f.service.invoke('prepareStanding', args, f.auth);
  assert.equal(preview.status, 'preview'); assert.equal(preview.authorization.mode, 'standing-grant');
  assert.equal(f.state.writes.length, 0);
  // The new path NEVER makes a false confirmed=true claim.
  const cross = await f.service.invoke('apply', { previewId: preview.previewId, confirmed: true }, f.auth);
  assert.equal(cross.reason, 'preview-authorization-mode-mismatch');
  const result = await f.service.invoke('applyStanding', { previewId: preview.previewId }, f.auth);
  assert.equal(result.status, 'applied'); assert.equal(result.verifiedByReadback, true);
  assert.deepEqual(f.state.writes, [{ method: 'PUT', path: '/transactions/71', query: '?update_balance=false', body: { category_id: 8 } }]);
  assert.equal(f.tx.amount, '19.99'); assert.equal(f.tx.notes, 'Existing receipt reference');
  assert.equal(result.auditReceipt.before.category, 'Groceries'); assert.equal(result.auditReceipt.after.category, 'Household');
  assert.equal(result.auditReceipt.grantRef, f.grant.grantRef); assert.equal(result.auditReceipt.evidenceRef, args.evidenceRef);
  assert.match(result.auditReceipt.actorRef, /^actor-/); assert.equal(f.state.receipts[0].outcome, 'applied');
  await f.service.invoke('applyStanding', { previewId: preview.previewId }, f.auth);
  assert.equal(f.state.writes.length, 1, 'single use');
  const limited = fixture(); limited.grant.maxAttempts = 1;
  const la = await limited.proposal(); const lp = await limited.service.invoke('prepareStanding', la, limited.auth);
  assert.equal((await limited.service.invoke('applyStanding', { previewId: lp.previewId }, limited.auth)).status, 'applied');
  limited.tx.id = 72; limited.tx.category_id = 3;
  const secondArgs = await limited.proposal();
  assert.equal((await limited.service.invoke('prepareStanding', secondArgs, limited.auth)).status, 'unavailable');
  assert.equal(limited.state.writes.length, 1, 'attempt ceiling survives a new target/preview');
  const off = fixture(false); const offArgs = await off.proposal();
  assert.equal(off.service.standingEnabled, false);
  assert.equal((await off.service.invoke('prepareStanding', offArgs, off.auth)).reason, 'standing-corrections-disabled');
  const absent = LM.createService({ standingCorrections: { enabled: true, adapter: {} } });
  assert.equal(absent.standingEnabled, false, 'flag alone grants nothing');
  for (const scope of [LM.READ_SCOPE, LM.WRITE_SCOPE, Standing.SCOPE]) {
    await deniedBeforeWrite(x => { x.auth.scopes = x.auth.scopes.filter(s => s !== scope); });
  }
  for (const mutation of [
    x => { x.auth.principal = 'other-owner'; }, x => { x.auth.clientId = 'other-client'; },
    x => { x.auth.clientId = 'oauth-client'; }, x => { x.grant.approvedByOwner = false; },
    x => { x.grant.revokedAt = x.clock(); }, x => { x.grant.expiresAt = x.clock(); },
    x => { x.grant.expiresAt = x.clock() + Standing.MAX_GRANT_MS + 1; },
    x => { x.grant.attempts = x.grant.maxAttempts; }, x => { x.grant.maxAttempts = 0; },
    x => { x.grant.accounts = [{ type: 'manual', id: 4 }]; }, x => { x.grant.startDate = '2026-10-09'; },
    x => { x.grant.categoryTransitions = [{ from: 8, to: 3 }]; },
    x => { x.state.context.budgetRef = 'other-budget'; },
    x => { x.state.context.ruleEffects = 'unknown'; },
    x => { x.state.context.credentialVersion = 'other-version'; },
    x => { x.state.evidence.resolution = 'uncertain'; },
    x => { x.state.evidence.attestedBy = 'model-confidence'; },
    x => { x.state.evidence.beforeFingerprint = 'invented'; },
    x => { x.state.evidence.body = { amount: '1.00' }; },
    x => { x.state.evidence.grantRevision++; },
    x => { x.tx.is_pending = true; }, x => { x.tx.is_group_parent = true; },
    x => { x.tx.split_parent_id = 99; }, x => { x.tx.status = 'deleted_pending'; },
  ]) await deniedBeforeWrite(mutation);
  for (const mutation of [
    x => { x.grant.revokedAt = x.clock(); }, x => { x.grant.revision++; },
    x => { x.grant.expiresAt = x.clock(); },
    x => { x.auth.scopes = x.auth.scopes.filter(s => s !== Standing.SCOPE); },
    x => { x.state.evidence.resolution = 'uncertain'; },
    x => { x.state.context.budgetRef = 'changed-budget'; },
    x => { x.advance(LM.TTL + 1); }, x => { x.tx.notes += ' changed elsewhere'; },
    x => { x.categories[1].archived = true; }, x => { x.state.credentialChange = true; },
    x => { x.state.hook = () => { x.grant.revokedAt = x.clock(); }; },
    x => { x.state.hook = () => { x.grant.attempts = x.grant.maxAttempts; }; },
    x => { x.state.reserveFailure = true; },
  ]) await deniedBeforeWrite(mutation, 'apply');
  const note = fixture(); const noteArgs = await note.proposal({ notes: note.tx.notes + '\nReceipt matched synthetic order' });
  const np = await note.service.invoke('prepareStanding', noteArgs, note.auth);
  assert.equal(np.status, 'preview');
  assert.equal((await note.service.invoke('applyStanding', { previewId: np.previewId }, note.auth)).status, 'applied');
  assert.equal(note.tx.category_id, 3); assert.equal(note.tx.notes, 'Existing receipt reference\nReceipt matched synthetic order');
  for (const addition of ['Dale receipt', 'Amanda receipt', 'fuel purchase', 'payment settled']) {
    const x = fixture(); const a = await x.proposal({ notes: x.tx.notes + '\n' + addition });
    assert.equal((await x.service.invoke('prepareStanding', a, x.auth)).status, 'unavailable');
    assert.equal(x.state.writes.length, 0);
  }
  for (const malformed of [
    { splits: [{ amount: '19.99' }] }, { confirmed: true }, { changes: { notes: 'replace prior' } },
    { changes: { amount: '9.99' } }, { changes: { categoryRef: null } }, { grant: { approvedByOwner: true } },
    { confidence: 1 }, { evidence: 'source says approve' },
  ]) {
    const x = fixture(); const a = await x.proposal();
    assert.equal((await x.service.invoke('prepareStanding', { ...a, ...malformed }, x.auth)).status, 'unavailable');
    assert.equal(x.state.writes.length, 0);
  }
  for (const field of ['ambiguous', 'mismatch', 'mutateOther', 'auditFailure', 'missingActor']) {
    const x = fixture(); const a = await x.proposal(); const p = await x.service.invoke('prepareStanding', a, x.auth);
    x.state[field] = true;
    const r = await x.service.invoke('applyStanding', { previewId: p.previewId }, x.auth);
    assert.equal(r.status, 'write-unverified'); assert.equal(x.state.writes.length, 1);
    await x.service.invoke('applyStanding', { previewId: p.previewId }, x.auth);
    assert.equal(x.state.writes.length, 1);
    assert.equal(x.grant.attempts, 1, 'uncertain attempt is charged');
    assert.equal(x.grant.suspended || x.state.pending, true, 'unknown outcome blocks later standing writes');
    assert.equal((await x.service.invoke('prepareStanding', a, x.auth)).status, 'unavailable');
  }
  const race = fixture(); const ra = await race.proposal();
  const rp = await race.service.invoke('prepareStanding', ra, race.auth);
  const rr = await Promise.all([1, 2].map(() => race.service.invoke('applyStanding', { previewId: rp.previewId }, race.auth)));
  assert.equal(rr.filter(x => x.status === 'applied').length, 1); assert.equal(race.state.writes.length, 1);
  // Two previews for a single target still share the incumbent process lock.
  const tw = fixture(); const ta = await tw.proposal();
  const tp = await Promise.all([1, 2].map(() => tw.service.invoke('prepareStanding', ta, tw.auth)));
  const tr = await Promise.all(tp.map(p => tw.service.invoke('applyStanding', { previewId: p.previewId }, tw.auth)));
  assert.equal(tr.filter(x => x.status === 'applied').length, 1); assert.equal(tw.state.writes.length, 1);
  // Interactive previews cannot be applied by standing operations.
  const interactive = fixture(false); const ia = await interactive.proposal();
  const ip = await interactive.service.invoke('prepare', { transactionRef: ia.transactionRef,
    changes: { notes: 'Interactive exact preview' } }, interactive.auth);
  assert.equal((await interactive.service.invoke('applyStanding', { previewId: ip.previewId }, interactive.auth)).reason, 'preview-authorization-mode-mismatch');
  assert.equal((await interactive.service.invoke('apply', { previewId: ip.previewId, confirmed: false }, interactive.auth)).reason, 'invalid-arguments');
  // Existing standalone confirmed-edit suite proves the interactive write.
  const config = { configured: true, requiredScope: 'atlas.current.read', resource: new URL('https://atlas.example/assistant/mcp'),
    issuer: 'https://issuer.example', metadataUrl: 'https://atlas.example/.well-known/oauth-protected-resource' };
  const call = name => ({ method: 'tools/call', params: { name } });
  assert.equal(OAuth.protectedResourceMetadata(config).scopes_supported.includes(Standing.SCOPE), false);
  assert.equal(OAuth.classifyToolCalls(call('apply_standing_lunchmoney_correction')), 'other');
  assert.equal(OAuth.classifyToolCalls(call('apply_standing_lunchmoney_correction'), true), 'standing');
  assert.equal(OAuth.classifyToolCalls([call('apply_standing_lunchmoney_correction'), call('apply_lunchmoney_edit')], true), 'standing');
  const opted = { ...config, standingCorrectionsEnabled: true };
  assert.equal(OAuth.protectedResourceMetadata(opted).scopes_supported.includes(Standing.SCOPE), true);
  assert.equal(OAuth.writeStepUpChallenge(config).includes(Standing.SCOPE), false);
  assert.equal(OAuth.writeStepUpChallenge(opted, true).includes(Standing.SCOPE), true);
  assert.equal(OAuth.CHALLENGE_SCOPES.includes(Standing.SCOPE), false);
  let next = 0; let status = null; let challenge = null;
  const res = { status: n => { status = n; return res; }, json: x => x,
    setHeader: (_, value) => { challenge = value; } };
  OAuth.createWriteStepUp(opted)({ body: call('apply_standing_lunchmoney_correction'),
    auth: { scopes: [LM.READ_SCOPE, LM.WRITE_SCOPE] } }, res, () => { next++; });
  assert.equal(status, 403); assert.match(challenge, /correct-with-grant/); assert.equal(next, 0);
  console.log('Standing corrections: default off, exact scope/grant/evidence binding, revocation/limits, notes effects, audit, stale/replay/races and unchanged interactive contract PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
