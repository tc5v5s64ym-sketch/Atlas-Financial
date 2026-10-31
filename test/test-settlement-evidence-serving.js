'use strict';
// Settlement evidence serving bridge (ATLAS-080) — the private
// receipt-bound qualified publication read, plus the attach
// preservation pins for the bridge itself. Synthetic fixtures only:
// every document below is built through the real Phase 1 contract flow
// and every receipt through the store's immutable-prefix receipt
// definition restated over the contract digest (the same oracle the
// loader suite uses) — five-field, or four-field with the embedded
// actor dropped, matching the public projections the confirmation
// controller and the store's outcome actually return.
//
// The receipt-bound capability is a private opt-in method on the
// serving object, available only when the serving is constructed with
// a real reader dependency (server composition). It takes no served
// object and nothing a request can supply: the caller presents an
// authorized original committed receipt plus the trusted original
// actor identity, and learns either that the same qualified, pinned,
// stable snapshot the loader verifies includes that original operation
// — with that snapshot's publication — or an unavailable outcome.
// `attach` behaviour is unchanged by the capability's existence: its
// outputs are pinned byte/shape below.
//
// Against the pre-change serving module the receipt-bound tests fail
// per-test (the method does not exist) while the attach controls pass.
// This suite is exercised directly; registration in test/test.js is a
// separate registry change outside this slice's file boundary.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const { createSettlementEvidenceServing } = require(path.join(ROOT, 'scripts/settlement-evidence-serving'));

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const otherActor = 'session-' + 'd'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const T0 = Date.parse('2026-10-04T12:00:00Z');

// --- Contract document builders (real Phase 1 flow, synthetic facts) -----
const ev = (over = {}) => ({
  accountId: 'acct-main', currency: 'cad', direction: 'debit',
  date: '2026-10-03', cents: 6000, posted: true, ...over,
});
const linkCmd = (over = {}) => {
  const e = ev(over.evidence || {});
  return {
    version: 1, kind: 'link', goalId: over.goalId || 'commitment:near',
    txRef: over.txRef || tx(1), evidence: e, evidenceDigest: C.digest(e),
    assignedCents: over.assignedCents !== undefined ? over.assignedCents : 2500,
    asOf: over.asOf || '2026-10-04',
  };
};
function recordInto(body, hh, n, command) {
  const prepared = C.prepare(body,
    { householdId: hh, actorId, operationId: op(n), command, now: T0 + n * 2 });
  const confirmed = C.confirmCandidate(body,
    { householdId: hh, actorId, preview: prepared.preview,
      confirmationDigest: prepared.confirmationDigest, now: T0 + n * 2 + 1 });
  assert.equal(confirmed.status, 'candidate', 'synthetic command records');
  return confirmed.document;
}
function docWith(commands, hh = householdId) {
  let body = C.adopt({ householdId: hh });
  commands.forEach((command, i) => { body = recordInto(body, hh, i + 1, command); });
  return body;
}
const pinOf = bytes => {
  const s = JSON.parse(bytes.toString('utf8'));
  return { revision: s.revision, digest: s.digest };
};
const stateOf = bytes => {
  const s = JSON.parse(bytes.toString('utf8'));
  return { householdId: s.householdId, revision: s.revision, operations: s.operations };
};
// The store's receipt definition (receiptForOperation over
// prefixDigest) restated over the contract digest.
function receiptOf(bytes, operationId) {
  const state = stateOf(bytes);
  const recorded = state.operations.find(o => o.operationId === operationId);
  assert.ok(recorded, 'oracle receipt names a recorded operation');
  return {
    status: 'committed', operationId, actorId: recorded.actorId,
    revision: recorded.revision,
    digest: C.digest({
      schema: C.SCHEMA, householdId: state.householdId, revision: recorded.revision,
      operations: state.operations.slice(0, recorded.revision),
    }),
  };
}

const doc1 = docWith([linkCmd({})]);
const doc2 = docWith([linkCmd({}),
  linkCmd({ goalId: 'commitment:far', txRef: tx(2), assignedCents: 1000 })]);
const docRetracted = docWith([linkCmd({}),
  { version: 1, kind: 'retract', targetOperationId: op(1) }]);

function expectIncluded(outcome) {
  assert.equal(outcome.status, 'included');
  assert.deepEqual(Object.keys(outcome).sort(), ['evidence', 'status'],
    'an included outcome carries only the same-snapshot publication');
  return outcome.evidence;
}
function expectUnavailable(outcome, reason) {
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.reason, reason);
  assert.deepEqual(Object.keys(outcome).sort(), ['reason', 'status']);
  assert.ok(!('evidence' in outcome), 'no publication accompanies a non-inclusion');
}
const servingOver = bytes => createSettlementEvidenceServing({
  householdId, pin: pinOf(bytes), readDocument: () => bytes,
});

// --- The capability is opt-in: inactive or malformed servings refuse --------
test('receipt-bound: an inactive serving refuses without any reader to invoke', async () => {
  const receipt = receiptOf(doc1, op(1));
  for (const dep of [undefined, null]) {
    const serving = createSettlementEvidenceServing(dep);
    assert.equal(serving.active, false);
    expectUnavailable(await serving.receiptBoundPublication(receipt, actorId),
      'invalid-configuration');
  }
});

test('receipt-bound: malformed or empty dependencies fail closed as invalid-configuration', async () => {
  const receipt = receiptOf(doc1, op(1));
  for (const dep of ['readers', [], 42, {}]) {
    const serving = createSettlementEvidenceServing(dep);
    expectUnavailable(await serving.receiptBoundPublication(receipt, actorId),
      'invalid-configuration');
  }
});

// --- Included through the seam ----------------------------------------------
test('receipt-bound: a matching original receipt is included with the qualified publication', async () => {
  const serving = servingOver(doc1);
  const outcome = await serving.receiptBoundPublication(receiptOf(doc1, op(1)), actorId);
  const evidence = expectIncluded(outcome);
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.ok(Object.isFrozen(outcome), 'the private result is a frozen loader outcome');
});

test('receipt-bound: proof and publication share one acquisition through the dependency', async () => {
  let pinReads = 0; let docReads = 0;
  const serving = createSettlementEvidenceServing({
    householdId,
    readPin: () => { pinReads += 1; return pinOf(doc2); },
    readDocument: () => { docReads += 1; return doc2; },
  });
  const evidence = expectIncluded(
    await serving.receiptBoundPublication(receiptOf(doc1, op(1)), actorId));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc2)));
  assert.equal(pinReads, 1, 'exactly one pin acquisition');
  assert.equal(docReads, 2, 'exactly the loader stability pair');
});

test('receipt-bound: a later retraction keeps the original receipt included', async () => {
  const serving = servingOver(docRetracted);
  const evidence = expectIncluded(
    await serving.receiptBoundPublication(receiptOf(doc1, op(1)), actorId));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(docRetracted)));
  assert.deepEqual(evidence.commitments, []);
});

// --- Four-field public receipts through the seam -----------------------------
// The public receipt projections (controller confirm / outcome, store
// outcome) carry no embedded actor; the trusted actor presented
// alongside is the authority, exactly as at the loader. Dropping the
// oracle receipt's embedded actor reproduces that shape faithfully.
const receipt4Of = (bytes, operationId) => {
  const { actorId: _embedded, ...four } = receiptOf(bytes, operationId);
  return four;
};

test('receipt-bound: a four-field public receipt is included through the serving', async () => {
  const serving = servingOver(doc1);
  const receipt = receipt4Of(doc1, op(1));
  assert.deepEqual(Object.keys(receipt).sort(), ['digest', 'operationId', 'revision', 'status'],
    'the public projection carries exactly four fields — no embedded actor');
  assert.ok(!Object.hasOwn(receipt, 'actorId'),
    'the embedded actor property is absent, not present-but-undefined');
  const evidence = expectIncluded(await serving.receiptBoundPublication(receipt, actorId));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

test('receipt-bound: four-field refusals and present-embedded discipline mirror the loader', async () => {
  const serving = servingOver(doc1);
  const receipt = receipt4Of(doc1, op(1));
  // A wrong trusted actor: the validated history does not carry the
  // operation for this actor.
  expectUnavailable(await serving.receiptBoundPublication(receipt, otherActor),
    'receipt-not-included');
  // A missing trusted actor is a malformed binding, never an
  // actor-free fallback.
  expectUnavailable(await serving.receiptBoundPublication(receipt, undefined), 'receipt-invalid');
  const full = receiptOf(doc1, op(1));
  // A present-but-undefined embedded actor is malformed, not absent.
  expectUnavailable(await serving.receiptBoundPublication({ ...full, actorId: undefined }, actorId),
    'receipt-invalid');
  // A present embedded actor contradicting the recorded operation
  // never includes, even with the correct trusted actor alongside.
  expectUnavailable(await serving.receiptBoundPublication({ ...full, actorId: otherActor }, actorId),
    'receipt-not-included');
});

// --- Non-inclusion through the seam ------------------------------------------
test('receipt-bound: tampered, foreign and malformed receipts never include', async () => {
  const serving = servingOver(doc1);
  const receipt = receiptOf(doc1, op(1));
  const flip = h => h.slice(0, 63) + (h.endsWith('0') ? '1' : '0');
  expectUnavailable(await serving.receiptBoundPublication(
    { ...receipt, digest: flip(receipt.digest) }, actorId), 'receipt-not-included');
  expectUnavailable(await serving.receiptBoundPublication(receipt, otherActor),
    'receipt-not-included');
  expectUnavailable(await serving.receiptBoundPublication(
    { ...receipt, actorId: otherActor }, otherActor), 'receipt-not-included');
  expectUnavailable(await serving.receiptBoundPublication(null, actorId), 'receipt-invalid');
  expectUnavailable(await serving.receiptBoundPublication(receipt, undefined), 'receipt-invalid');
});

test('receipt-bound: caller mutation during the read cannot swap the frozen binding', async () => {
  const receipt = receiptOf(doc1, op(1));
  let calls = 0;
  const serving = createSettlementEvidenceServing({
    householdId, pin: pinOf(doc1),
    readDocument: () => {
      calls += 1;
      if (calls === 1) { receipt.digest = 'f'.repeat(64); receipt.operationId = op(9); }
      return doc1;
    },
  });
  expectIncluded(await serving.receiptBoundPublication(receipt, actorId));
  assert.equal(receipt.operationId, op(9), 'the mutation landed; the frozen copy governed');
});

test('receipt-bound: the dependency is fixed at construction — call arguments cannot select readers', async () => {
  let hostileReads = 0;
  const serving = servingOver(doc1);
  const outcome = await serving.receiptBoundPublication(receiptOf(doc1, op(1)), actorId, {
    householdId, pin: pinOf(doc1),
    readDocument: () => { hostileReads += 1; return doc2; },
  });
  expectIncluded(outcome);
  assert.equal(hostileReads, 0, 'a call-time reader is never invoked');
});

test('receipt-bound: no outcome is cached — a moved store is seen on the next call', async () => {
  let current = doc1;
  const serving = createSettlementEvidenceServing({
    householdId,
    readPin: () => pinOf(current),
    readDocument: () => current,
  });
  const receipt = receiptOf(doc1, op(1));
  const first = expectIncluded(await serving.receiptBoundPublication(receipt, actorId));
  assert.equal(first.commitments.length, 1);
  current = docRetracted;
  const second = expectIncluded(await serving.receiptBoundPublication(receipt, actorId));
  assert.deepEqual(second.commitments, [],
    'the retraction snapshot governs the next call; nothing was cached');
});

// --- attach is byte/shape unchanged by the capability ------------------------
test('attach preservation: qualified and unavailable projections keep their exact shapes', async () => {
  const served = { plan: { marker: 1 }, meta: { asOf: '2026-10-04' } };
  const qualified = await servingOver(doc1).attach(served);
  assert.deepEqual(qualified, {
    ...served,
    settlementEvidenceStatus: { status: 'qualified' },
    settlementEvidence: C.effectiveEvidence(stateOf(doc1)),
  });
  const missing = createSettlementEvidenceServing({
    householdId, pin: pinOf(doc1), readDocument: () => null,
  });
  assert.deepEqual(await missing.attach(served), {
    ...served,
    settlementEvidenceStatus: { status: 'unavailable', reason: 'document-missing' },
  });
  const inactive = createSettlementEvidenceServing();
  assert.equal(await inactive.attach(served), served, 'inactive attach is still identity');
});

test('attach preservation: no receipt material leaks into served output', async () => {
  const receipt = receiptOf(doc1, op(1));
  const serving = servingOver(doc1);
  expectIncluded(await serving.receiptBoundPublication(receipt, actorId));
  const out = await serving.attach({ plan: {} });
  const bytes = JSON.stringify(out);
  assert.ok(!bytes.includes(receipt.digest), 'the receipt prefix digest never reaches served data');
  assert.ok(!bytes.includes('receipt'), 'no receipt field or vocabulary reaches served data');
  assert.deepEqual(Object.keys(out).sort(),
    ['plan', 'settlementEvidence', 'settlementEvidenceStatus']);
  assert.deepEqual(out.settlementEvidenceStatus, { status: 'qualified' });
});
