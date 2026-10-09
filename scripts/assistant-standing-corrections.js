'use strict';
// Disabled foundation. No grant/evidence creation or production store is wired.
// The adapter is a trusted server dependency, never an MCP argument.
const SCOPE = 'atlas.transactions.correct-with-grant';
const MAX_GRANT_MS = 30 * 86400000;
const adapterMethods = ['context', 'grant', 'evidence', 'noteEffects', 'reserve', 'finish'];
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
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function available(options) {
  return options.enabled === true && options.adapter?.durable === true
    && adapterMethods.every(k => typeof options.adapter[k] === 'function');
}
function appendNotes(before, addition) {
  if (before != null && typeof before !== 'string') deny('notes-evidence-unavailable');
  if (typeof addition !== 'string' || !addition.trim() || addition.length > 500
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(addition)) deny('invalid-note-addition');
  const result = (before || '') + (before ? '\n' : '') + addition;
  if (result.length > 1000) deny('notes-capacity');
  return result;
}
function validate({ grant, evidence, auth, context, tx, body, fingerprint, now }) {
  if (!keys(grant, ['schema', 'grantRef', 'revision', 'principal', 'clientId', 'budgetRef',
    'credentialVersion', 'approvalRef', 'approvedByOwner', 'createdAt', 'expiresAt',
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
      || grant.credentialVersion !== context.credentialVersion) deny('standing-grant-binding-mismatch');
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
      || grant.categoryTransitions.some(t => !keys(t, ['from', 'to'])
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
  if (!record(evidence) || evidence.schema !== 'atlas-standing-correction-evidence/v1'
      || !/^evidence-[a-f0-9]{24}$/.test(evidence.evidenceRef)
      || evidence.grantRef !== grant.grantRef || evidence.grantRevision !== grant.revision
      || typeof grant.evidencePolicy !== 'string' || !grant.evidencePolicy
      || evidence.policy !== grant.evidencePolicy || evidence.resolution !== 'resolved'
      || evidence.attestedBy !== 'trusted-evidence-policy'
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
    // Compare NOTE-ONLY effects with the category held fixed. The production
    // adapter must use the incumbent observer/parser with the real map/plan/tags.
    const effects = await adapter.noteEffects(input.tx, { ...input.tx, notes: input.body.notes });
    if (!record(effects) || effects.schema !== 'atlas-standing-note-effects/v1'
        || typeof effects.parserRevision !== 'string' || !effects.parserRevision
        || !record(effects.before) || !record(effects.after)
        || !same(effects.before, effects.after)) deny('standing-note-parser-effect-changed');
  }
  return { ...boundary, budgetRef: context.budgetRef, credentialVersion: context.credentialVersion };
}
function unchangedOtherFields(before, after, body) {
  const ignored = new Set(['updated_at', ...Object.keys(body)]);
  const project = tx => Object.fromEntries(Object.entries(tx).filter(([k]) => !ignored.has(k)).sort(([a], [b]) => a.localeCompare(b)));
  return same(project(before), project(after));
}
module.exports = { SCOPE, MAX_GRANT_MS, available, appendNotes, validate, authorize, unchangedOtherFields };
