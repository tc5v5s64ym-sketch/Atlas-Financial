'use strict';
// Versioned extension: existing category grants gain no metadata permission.
const Cleanup = require('./assistant-cleanup-instructions');
const POLICY = 'atlas-delegated-routine-cleanup/v1';
const SCHEMA = 'atlas-standing-correction-grant/v2';
const same = (a, b) => a === undefined || b === undefined ? a === b
  : require('./assistant-standing-store').ownerDigest(a) === require('./assistant-standing-store').ownerDigest(b);
function check(ok, reason = 'cleanup-outside-owner-instruction') { if (!ok) throw new Error(reason); }
function grantShape(grant, context, now) {
  const P = require('./assistant-standing-corrections');
  check(grant.schema === SCHEMA && grant.evidencePolicy === POLICY && context.cleanupEnabled === true
    && /^[a-f0-9]{64}$/.test(context.financialContextDigest), 'cleanup-context-not-approved');
  check(same(context.providerProof?.cleanupFields, ['category_id', 'payee', 'notes', 'additional_tag_ids'])
    && context.providerProof?.updateBalanceFalse === true, 'cleanup-provider-contract-not-approved');
  check(Array.isArray(grant.cleanupInstructions) && grant.cleanupInstructions.length > 0 && grant.cleanupInstructions.length <= 100
    && grant.cleanupInstructions.every(i => Cleanup.schema.safeParse(i).success)
    && new Set(grant.cleanupInstructions.map(i => i.name)).size === grant.cleanupInstructions.length
    && grant.allowNotes === grant.cleanupInstructions.some(i => i.changes.notesAppend !== undefined), 'invalid-cleanup-owner-grant');
  check(grant.cleanupInstructions.every(i => !i.changes.payee || !/^transfer\s*:/i.test(i.changes.payee)),
    'transfer-label-requires-structured-evidence');
  // Reuse all v1 structural/binding/time/account/attempt checks. No v1 grant is
  // mutated or upgraded. A metadata-only grant needs no category transition.
  const { cleanupInstructions, ...base } = grant;
  const transitions = base.categoryTransitions.length ? base.categoryTransitions : [
    { from: null, to: 1, fromSignature: null, toSignature: '0'.repeat(64) }];
  P.validateGrantShape({ ...base, schema: 'atlas-standing-correction-grant/v1', allowNotes: false,
    evidencePolicy: P.DELEGATED_POLICY, categoryTransitions: transitions }, context, now);
}
function boundary({ grant, evidence, context, tx, body, categoryContext, metadataContext }) {
  const P = require('./assistant-standing-corrections');
  check(tx.status === 'reviewed' && typeof tx.original_name === 'string' && tx.original_name.trim(), 'cleanup-posted-original-required');
  const instruction = evidence?.cleanupInstruction;
  check(instruction && grant.cleanupInstructions.some(i => same(i, instruction)));
  const changes = instruction.changes, expected = {};
  if (changes.payee !== undefined && changes.payee !== tx.payee) expected.payee = changes.payee;
  if (changes.notesAppend !== undefined) {
    const already = typeof tx.notes === 'string' && (tx.notes === changes.notesAppend || tx.notes.endsWith('\n' + changes.notesAppend));
    if (!already) expected.notes = P.appendNotes(tx.notes, changes.notesAppend);
  }
  if (changes.tagNamesAdd) {
    check(Array.isArray(tx.tag_ids) && tx.tag_ids.every(id => Number.isSafeInteger(id) && id > 0));
    check(metadataContext?.tags?.length === changes.tagNamesAdd.length
      && metadataContext.tags.every((tag, i) => tag.name === changes.tagNamesAdd[i] && Number.isSafeInteger(tag.id) && tag.id > 0));
    const additions = metadataContext.tags.map(t => t.id).filter(id => !tx.tag_ids.includes(id));
    if (additions.length) expected.additional_tag_ids = additions;
  }
  if (changes.categoryName !== undefined) {
    check(categoryContext?.toName === changes.categoryName);
    if (categoryContext.toId !== tx.category_id) {
      expected.category_id = categoryContext.toId;
      check(grant.categoryTransitions.some(t => t.from === (tx.category_id ?? null) && t.to === expected.category_id
        && t.fromSignature === categoryContext.from && t.toSignature === categoryContext.to));
      // Prevent a category correction from granting income, total exclusions
      // or minimum-payment/settlement intent. Those are different authorities.
      check(categoryContext.financialSemanticsUnchanged === true, 'cleanup-category-financial-authority-changed');
    }
  }
  if (changes.transferLabel) {
    const pair = metadataContext?.transfer;
    check(pair?.length === 2 && pair.every((a, i) => a.name === [changes.transferLabel.from, changes.transferLabel.to][i].name
      && a.type === [changes.transferLabel.from, changes.transferLabel.to][i].type));
    const label = 'Transfer: ' + pair[0].name + ' → ' + pair[1].name;
    if (label !== tx.payee) expected.payee = label;
    check(evidence.transferProof?.kind === 'bank-directed-counterpart'
      && /^[a-f0-9]{64}$/.test(evidence.transferProof.counterpartFingerprint), 'cleanup-transfer-evidence-unresolved');
  }
  check(Object.keys(expected).length && same(expected, body));
  check(same(evidence.metadataContext, metadataContext) && same(evidence.categoryContext, categoryContext), 'cleanup-catalog-binding-changed');
  check(context.cleanupEnabled === true, 'cleanup-disabled');
}
function review({ grant, context, auth, tx, body, review, categoryContext, metadataContext, cleanupInstruction, transferProof, now }) {
  grantShape(grant, context, now);
  check(review && Object.keys(review).every(k => ['schema', 'status', 'sources', 'rationale', 'issues', 'facts', 'supportedChanges', 'categoryReceipt'].includes(k))
    && review.schema === POLICY && review.status === 'resolved' && Array.isArray(review.issues) && review.issues.length === 0
    && typeof review.rationale === 'string' && review.rationale.trim() && review.rationale.length <= 1000
    && Array.isArray(review.sources) && review.sources.length > 0 && review.sources.length <= 5
    && review.sources.every(s => Object.keys(s).every(k => ['system', 'reference', 'excerptDigest'].includes(k))
      && ['gmail', 'library', 'user-provided', 'other-authorized'].includes(s.system)
      && typeof s.reference === 'string' && s.reference.trim() && s.reference.length <= 300
      && !/[\u0000-\u001f]/.test(s.reference) && /^[a-f0-9]{64}$/.test(s.excerptDigest)), 'cleanup-review-unresolved');
  const f = review.facts;
  check(f && same(Object.keys(f).sort(), ['amount', 'currency', 'date', 'originalBankDescription', 'payee'].sort())
    && f.date === tx.date && f.payee === tx.payee && f.originalBankDescription === tx.original_name
    && f.currency === tx.currency && f.amount === tx.amount, 'cleanup-exact-facts-mismatch');
  // Every changed field needs an explicit assertion from the researched source,
  // not an inferred merchant default. Provenance remains delegated, not fetched.
  check(same(review.supportedChanges, cleanupInstruction.changes), 'cleanup-source-does-not-support-instruction');
  if (review.categoryReceipt) check(review.categoryReceipt.status === 'resolved'
    && Array.isArray(review.categoryReceipt.issues) && review.categoryReceipt.issues.length === 0, 'cleanup-review-unresolved');
  if (body.category_id !== undefined) {
    const { cleanupInstructions, ...base } = grant;
    require('./assistant-standing-corrections').validateDelegatedReview({
      grant: { ...base, schema: 'atlas-standing-correction-grant/v1', allowNotes: false,
        evidencePolicy: require('./assistant-standing-corrections').DELEGATED_POLICY },
      context, auth, tx, body: { category_id: body.category_id }, review: review.categoryReceipt,
      categoryContext: { from: categoryContext.from, to: categoryContext.to }, now });
  }
  const evidence = { cleanupInstruction, categoryContext, metadataContext, transferProof };
  boundary({ grant, context, tx, body, categoryContext, metadataContext, evidence });
  require('./assistant-standing-corrections').validate({ grant, context, auth, tx, body, now,
    categoryContext, metadataContext, fingerprint: 'admission-only', evidence: {
      ...evidence, schema: 'atlas-delegated-cleanup-evidence/v1', evidenceRef: 'evidence-' + '0'.repeat(24),
      grantRef: grant.grantRef, grantRevision: grant.revision, policy: POLICY,
      contextVersion: grant.contextVersion, parserRevision: grant.parserRevision, resolution: 'resolved',
      attestedBy: 'delegated-client-review', expiresAt: grant.expiresAt, transactionId: tx.id,
      beforeFingerprint: 'admission-only', body, provenance: { kind: 'delegated-client-review', independentlyVerified: false,
        principal: auth.principal, clientId: auth.clientId, resource: auth.resource, reviewDigest: '0'.repeat(64) } } });
}
module.exports = { POLICY, SCHEMA, grantShape, boundary, review };
