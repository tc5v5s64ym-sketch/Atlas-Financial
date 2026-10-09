'use strict';
// Bounded correction policy. Production construction remains default-off.
// The adapter is a trusted server dependency, never an MCP argument.
const SCOPE = 'atlas.transactions.correct-with-grant';
const DELEGATED_POLICY = 'atlas-delegated-category-review/v1';
const MAX_GRANT_MS = 30 * 86400000;
const adapterMethods = ['context', 'grant', 'evidence', 'reserve', 'finish', 'suspend', 'acknowledgeVerified', 'verifyReservation'];
function deny(reason) { throw new Error(reason); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, allowed) {
  return record(value) && Object.keys(value).every(k => allowed.includes(k));
}
function boundedDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
}
function instant(v) { return typeof v === 'number' && Number.isSafeInteger(v) && v > 0; }
function same(a, b) {
  const ordered = x => Array.isArray(x) ? x.map(ordered) : record(x)
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, ordered(x[k])])) : x;
  return JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
}
function available(options) {
  return options.enabled === true && options.adapter?.durable === true
    && adapterMethods.every(k => typeof options.adapter[k] === 'function')
    && (options.notesEnabled !== true || typeof options.adapter.noteEffects === 'function');
}
function appendNotes(before, addition) {
  if (before != null && typeof before !== 'string') deny('notes-evidence-unavailable');
  if (typeof addition !== 'string' || !addition.trim() || addition.length > 500
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(addition)) deny('invalid-note-addition');
  const result = (before || '') + (before ? '\n' : '') + addition;
  if (result.length > 1000) deny('notes-capacity');
  return result;
}
function validate({ grant, evidence, auth, context, tx, body, fingerprint, now, categoryContext }) {
  if (!keys(grant, ['schema', 'grantRef', 'revision', 'principal', 'clientId', 'budgetRef',
    'resource', 'credentialVersion', 'contextVersion', 'parserRevision', 'approvalRef', 'approvedByOwner', 'createdAt', 'expiresAt',
    'revokedAt', 'suspended', 'accounts', 'startDate', 'endDate', 'categoryTransitions',
    'allowNotes', 'evidencePolicy', 'maxAttempts', 'attempts'])) deny('invalid-standing-grant');
  if (grant.schema !== 'atlas-standing-correction-grant/v1'
      || !/^grant-[a-f0-9]{24}$/.test(grant.grantRef)
      || !Number.isSafeInteger(grant.revision) || grant.revision < 1
      || grant.approvedByOwner !== true || !/^approval-[a-f0-9]{24}$/.test(grant.approvalRef)
      || grant.revokedAt !== null || grant.suspended !== false
      || !instant(grant.createdAt) || !instant(grant.expiresAt)
      || grant.createdAt > now || grant.expiresAt <= now
      || grant.expiresAt - grant.createdAt > MAX_GRANT_MS
      || !Number.isSafeInteger(grant.maxAttempts) || grant.maxAttempts < 1 || grant.maxAttempts > 1000
      || !Number.isSafeInteger(grant.attempts) || grant.attempts < 0 || grant.attempts >= grant.maxAttempts)
    deny('standing-grant-inactive');
  if (!auth.principal || !auth.clientId || auth.clientId === 'oauth-client'
      || grant.principal !== auth.principal || grant.clientId !== auth.clientId
      || typeof grant.budgetRef !== 'string' || !grant.budgetRef
      || typeof grant.credentialVersion !== 'string' || !grant.credentialVersion
      || !record(context) || context.ruleEffects !== 'none-verified'
      || !/^[a-f0-9]{64}$/.test(context.credentialDigest)
      || grant.budgetRef !== context.budgetRef
      || grant.credentialVersion !== context.credentialVersion
      || typeof grant.contextVersion !== 'string' || !grant.contextVersion || grant.contextVersion !== context.contextVersion
      || typeof grant.parserRevision !== 'string' || !grant.parserRevision || grant.parserRevision !== context.parserRevision)
    deny('standing-grant-binding-mismatch');
  if (!boundedDate(grant.startDate) || !boundedDate(grant.endDate)
      || grant.startDate > grant.endDate
      || Date.parse(grant.endDate) - Date.parse(grant.startDate) > 366 * 86400000
      || !boundedDate(tx.date) || tx.date < grant.startDate || tx.date > grant.endDate)
    deny('standing-date-outside-grant');
  // Both provider namespaces, missing account, and pending/deleted/group/split
  // rows fail closed. No merchant, amount or fuzzy targeting.
  const account = tx.plaid_account_id != null && tx.manual_account_id == null
    ? { type: 'plaid', id: tx.plaid_account_id }
    : tx.manual_account_id != null && tx.plaid_account_id == null
      ? { type: 'manual', id: tx.manual_account_id } : null;
  if (!account || !Number.isSafeInteger(account.id) || account.id < 1
      || !Array.isArray(grant.accounts) || !grant.accounts.length || grant.accounts.length > 100
      || grant.accounts.some(a => !keys(a, ['type', 'id']) || !['plaid', 'manual'].includes(a.type)
        || !Number.isSafeInteger(a.id) || a.id < 1)
      || !grant.accounts.some(a => same(a, account))
      || tx.is_pending !== false || tx.is_split_parent || tx.split_parent_id != null
      || tx.is_group_parent || tx.group_parent_id != null || tx.is_parent || tx.is_group
      || ['delete_pending', 'deleted_pending'].includes(tx.status)) deny('standing-transaction-outside-grant');
  if (!keys(body, ['category_id', 'notes']) || !Object.keys(body).length)
    deny('standing-operation-not-allowed');
  if (typeof grant.allowNotes !== 'boolean' || !Array.isArray(grant.categoryTransitions)
      || grant.categoryTransitions.length > 1000
      || grant.categoryTransitions.some(t => !keys(t, ['from', 'to', 'fromSignature', 'toSignature'])
        || !(t.from === null || Number.isSafeInteger(t.from) && t.from > 0)
        || !Number.isSafeInteger(t.to) || t.to < 1)) deny('invalid-standing-grant');
  if (body.category_id !== undefined
      && (!Number.isSafeInteger(body.category_id) || body.category_id < 1
        || body.category_id === tx.category_id
        || !grant.categoryTransitions.some(t => t.from === (tx.category_id ?? null) && t.to === body.category_id)))
    deny('standing-category-outside-grant');
  if (body.notes !== undefined && (!grant.allowNotes || typeof body.notes !== 'string'
      || body.notes.length > 1000 || body.notes === (tx.notes ?? '')
      || !body.notes.startsWith((tx.notes || '') + (tx.notes ? '\n' : ''))
      || !body.notes.slice((tx.notes || '').length).trim())) deny('standing-notes-not-additive');
  const delegated = grant.evidencePolicy === DELEGATED_POLICY;
  if (delegated) {
    // Provider settings may auto-mark edited rows reviewed. This initial
    // category-only policy cannot authorize an incidental status change.
    if (tx.status !== 'reviewed') deny('delegated-reviewed-transaction-required');
    const transition = grant.categoryTransitions.find(t => t.from === (tx.category_id ?? null) && t.to === body.category_id);
    if (!instant(context.providerProof?.expiresAt) || context.providerProof.expiresAt <= now)
      deny('provider-proof-expired-or-invalid');
    if (grant.resource !== context.resource || auth.resource !== grant.resource || grant.allowNotes !== false
        || !keys(body, ['category_id']) || !transition || !record(categoryContext)
        || transition.fromSignature !== categoryContext.from || transition.toSignature !== categoryContext.to
        || !same(evidence?.categoryContext, categoryContext)) deny('delegated-category-boundary-mismatch');
  }
  if (!record(evidence) || evidence.schema !== (delegated ? 'atlas-delegated-category-evidence/v1' : 'atlas-standing-correction-evidence/v1')
      || !/^evidence-[a-f0-9]{24}$/.test(evidence.evidenceRef)
      || evidence.grantRef !== grant.grantRef || evidence.grantRevision !== grant.revision
      || typeof grant.evidencePolicy !== 'string' || !grant.evidencePolicy
      || evidence.policy !== grant.evidencePolicy || evidence.contextVersion !== grant.contextVersion
      || evidence.parserRevision !== grant.parserRevision || evidence.resolution !== 'resolved'
      || evidence.attestedBy !== (delegated ? 'delegated-client-review' : 'trusted-evidence-policy')
      || delegated && (!record(evidence.provenance) || evidence.provenance.kind !== 'delegated-client-review'
        || evidence.provenance.independentlyVerified !== false || evidence.provenance.principal !== auth.principal
        || evidence.provenance.clientId !== auth.clientId || evidence.provenance.resource !== auth.resource
        || !/^[a-f0-9]{64}$/.test(evidence.provenance.reviewDigest))
      || !instant(evidence.expiresAt) || evidence.expiresAt <= now
      || evidence.transactionId !== tx.id || evidence.beforeFingerprint !== fingerprint
      || !same(evidence.body, body)) deny('standing-evidence-unresolved-or-mismatched');
  return { grantRef: grant.grantRef, grantRevision: grant.revision, evidenceRef: evidence.evidenceRef };
}
async function authorize(options, input) {
  if (!available(options)) deny('standing-corrections-disabled');
  const adapter = options.adapter;
  const context = await adapter.context();
  if (input.credentialDigest !== undefined && input.credentialDigest !== context?.credentialDigest)
    deny('standing-provider-budget-binding-mismatch');
  const grant = await adapter.grant(input.grantRef);
  const evidence = await adapter.evidence(input.evidenceRef);
  if (grant?.grantRef !== input.grantRef || evidence?.evidenceRef !== input.evidenceRef)
    deny('standing-reference-binding-mismatch');
  const boundary = validate({ ...input, context, grant, evidence });
  if (input.body.notes !== undefined) {
    if (options.notesEnabled !== true) deny('standing-notes-disabled');
    // Check note-only effects under BOTH the original and resulting category.
    // The production adapter normalizes labels from the real current catalog.
    for (const categoryId of new Set([input.tx.category_id, input.body.category_id ?? input.tx.category_id])) {
      const baseline = { ...input.tx, category_id: categoryId };
      const effects = await adapter.noteEffects(baseline, { ...baseline, notes: input.body.notes });
      if (!record(effects) || effects.schema !== 'atlas-standing-note-effects/v1'
          || effects.parserRevision !== context.parserRevision
          || !record(effects.before) || !record(effects.after)
          || !same(effects.before, effects.after)) deny('standing-note-parser-effect-changed');
    }
  }
  return { ...boundary, budgetRef: context.budgetRef, credentialVersion: context.credentialVersion,
    contextVersion: context.contextVersion, parserRevision: context.parserRevision, evidenceExpiresAt: evidence.expiresAt,
    ...(grant.resource ? { resource: grant.resource } : {}),
    ...(evidence.provenance ? { evidenceProvenance: evidence.provenance } : {}) };
}
function unchangedOtherFields(before, after, body) {
  const ignored = new Set(['updated_at', ...Object.keys(body)]);
  const project = tx => Object.fromEntries(Object.entries(tx).filter(([k]) => !ignored.has(k)).sort(([a], [b]) => a.localeCompare(b)));
  return same(project(before), project(after));
}

function categorySignature(row) {
  if (row == null) return null;
  return require('node:crypto').createHash('sha256').update(JSON.stringify(
    ['id', 'name', 'is_group', 'group_id', 'is_income', 'exclude_from_budget', 'exclude_from_totals', 'archived']
      .map(k => [k, row[k] ?? null]))).digest('hex');
}
function validateGrantShape(grant, context, now) {
  if (typeof grant.principal !== 'string' || !grant.principal || grant.principal.length > 200
      || typeof grant.clientId !== 'string' || !grant.clientId || grant.clientId.length > 200
      || grant.evidencePolicy !== DELEGATED_POLICY || grant.allowNotes !== false
      || typeof grant.resource !== 'string' || !grant.resource || grant.resource !== context.resource
      || !grant.categoryTransitions?.length || grant.categoryTransitions.some(t =>
        !(t.from === null && t.fromSignature === null || /^[a-f0-9]{64}$/.test(t.fromSignature))
        || !/^[a-f0-9]{64}$/.test(t.toSignature))) deny('invalid-delegated-owner-grant');
  // Structural eligibility uses no provider, receipt, or persisted evidence.
  const a = grant.accounts?.[0], t = grant.categoryTransitions[0];
  const tx = { id: 1, date: grant.startDate, category_id: t.from, is_pending: false,
    plaid_account_id: a?.type === 'plaid' ? a.id : null, manual_account_id: a?.type === 'manual' ? a.id : null };
  const categoryContext = { from: t.fromSignature, to: t.toSignature };
  const auth = { principal: grant.principal, clientId: grant.clientId, resource: grant.resource };
  const body = { category_id: t.to };
  validate({ grant, context, auth, tx, body, fingerprint: 'structural-only', now, categoryContext,
    evidence: { schema: 'atlas-delegated-category-evidence/v1', evidenceRef: 'evidence-' + '0'.repeat(24),
      grantRef: grant.grantRef, grantRevision: grant.revision, policy: grant.evidencePolicy,
      contextVersion: grant.contextVersion, parserRevision: grant.parserRevision, resolution: 'resolved',
      attestedBy: 'delegated-client-review', expiresAt: grant.expiresAt, transactionId: 1,
      beforeFingerprint: 'structural-only', body, categoryContext,
      provenance: { kind: 'delegated-client-review', independentlyVerified: false,
        ...auth, reviewDigest: '0'.repeat(64) } } });
}
function decimal(value) {
  if (typeof value !== 'string' || !/^\d{1,10}(\.\d{1,4})?$/.test(value)) deny('receipt-amount-unresolved');
  const [whole, fraction = ''] = value.split('.');
  if (/[1-9]/.test(fraction.slice(2))) deny('receipt-fractional-cent-unresolved');
  return BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
}
function validateDelegatedReview({ grant, context, auth, tx, body, review, categoryContext, now }) {
  validateGrantShape(grant, context, now);
  if (!keys(review, ['schema', 'status', 'sources', 'facts', 'rationale', 'issues'])
      || review.schema !== DELEGATED_POLICY || review.status !== 'resolved'
      || !Array.isArray(review.issues) || review.issues.length
      || typeof review.rationale !== 'string' || !review.rationale.trim() || review.rationale.length > 1000
      || !Array.isArray(review.sources) || !review.sources.length || review.sources.length > 5
      || review.sources.some(s => !keys(s, ['system', 'reference', 'excerptDigest'])
        || !['gmail', 'library', 'user-provided', 'other-authorized'].includes(s.system)
        || typeof s.reference !== 'string' || !s.reference.trim() || s.reference.length > 300
        || /[\u0000-\u001f]/.test(s.reference) || !/^[a-f0-9]{64}$/.test(s.excerptDigest)))
    deny('delegated-review-unresolved');
  const f = review.facts;
  if (!keys(f, ['date', 'payee', 'amount', 'currency', 'items', 'completeReceipt'])
      || f.completeReceipt !== true || f.date !== tx.date || f.currency !== tx.currency
      || typeof f.payee !== 'string' || f.payee !== tx.payee || decimal(f.amount) !== decimal(tx.amount)
      || decimal(f.amount) <= 0n || !Array.isArray(f.items) || !f.items.length || f.items.length > 40
      || f.items.some(i => !keys(i, ['description', 'amount', 'category_id'])
        || typeof i.description !== 'string' || !i.description.trim() || i.description.length > 200
        || i.category_id !== body.category_id || decimal(i.amount) <= 0n)
      || f.items.reduce((sum, i) => sum + decimal(i.amount), 0n) !== decimal(f.amount))
    deny('delegated-facts-inconsistent-or-mixed');
  // Reuse the real grant boundary. This ephemeral validation object is NEVER
  // issued/persisted as trusted independent evidence or owner authority.
  validate({ grant, context, auth, tx, body, now, categoryContext, fingerprint: 'admission-only',
    evidence: { schema: 'atlas-delegated-category-evidence/v1', evidenceRef: 'evidence-' + '0'.repeat(24),
      grantRef: grant.grantRef, grantRevision: grant.revision, policy: DELEGATED_POLICY,
      contextVersion: grant.contextVersion, parserRevision: grant.parserRevision, resolution: 'resolved',
      attestedBy: 'delegated-client-review', expiresAt: grant.expiresAt, transactionId: tx.id,
      beforeFingerprint: 'admission-only', body, categoryContext,
      provenance: { kind: 'delegated-client-review', independentlyVerified: false,
        principal: auth.principal, clientId: auth.clientId, resource: auth.resource, reviewDigest: '0'.repeat(64) } } });
}

module.exports = { DELEGATED_POLICY, categorySignature, validateGrantShape, validateDelegatedReview, SCOPE, MAX_GRANT_MS, available, appendNotes, validate, authorize, unchangedOtherFields };
