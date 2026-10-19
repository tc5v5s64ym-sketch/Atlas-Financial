'use strict';
// Synthetic contract evidence only: no filesystem persistence, no production
// adapter, no Forecast import. Every figure below is invented.
const assert = require('node:assert/strict');
const C = require('../scripts/planned-obligation-settlement-contract');
const householdId = 'household-' + 'a'.repeat(32);
const otherHousehold = 'household-' + 'b'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const otherActor = 'session-' + 'd'.repeat(64);
const now = Date.parse('2030-01-01T12:00:00.000Z');
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const copy = value => JSON.parse(JSON.stringify(value));
let checks = 0;
const eq = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
const refuses = (fn, why) => { assert.throws(fn, /settlement-evidence-unavailable/, why); checks++; };

const evidence = (overrides = {}) => ({
  accountId: 'acct-main', currency: 'cad', direction: 'debit',
  date: '2030-03-01', cents: 10000, posted: true, ...overrides,
});
const refundEvidence = (overrides = {}) => evidence({
  direction: 'credit', date: '2030-03-10', cents: 4000, ...overrides,
});
const link = (goalId, txRef, ev, assignedCents, asOf = '2030-03-02') => ({
  version: 1, kind: 'link', goalId, txRef, evidence: ev,
  evidenceDigest: C.digest(ev), assignedCents, asOf,
});
const retract = targetOperationId => ({ version: 1, kind: 'retract', targetOperationId });
const reverse = (targetOperationId, counterTxRef, counterEvidence, cents) => ({
  version: 1, kind: 'reverse', targetOperationId, counterTxRef, counterEvidence,
  counterEvidenceDigest: C.digest(counterEvidence), cents,
});
const lineage = (pendingTxRef, postedTxRef, postedEvidenceDigest) =>
  ({ version: 1, kind: 'lineage', pendingTxRef, postedTxRef, postedEvidenceDigest });

const adopt = () => C.adopt({ householdId });
const prepare = (body, n, command, at = now) =>
  C.prepare(body, { householdId, actorId, operationId: op(n), command, now: at });
const confirm = (body, prepared, at = now + 1) => C.confirmCandidate(body,
  { householdId, actorId, preview: prepared.preview,
    confirmationDigest: prepared.confirmationDigest, now: at });
const record = (body, n, command, at = now) => {
  const prepared = prepare(body, n, command, at);
  const result = confirm(body, prepared, at);
  eq(result.status, 'candidate', 'command records as a candidate');
  return result.document;
};
const view = body => {
  const state = JSON.parse(body.toString('utf8'));
  return C.effectiveEvidence({
    householdId: state.householdId, revision: state.revision, operations: state.operations,
  });
};
const linksOf = (body, goalId) =>
  (view(body).commitments.find(entry => entry.goalId === goalId) || { links: [] }).links;

// --- Adoption, integrity, household binding --------------------------------
{
  const body = adopt();
  eq(view(body), { commitments: [] }, 'an adopted document carries no evidence');
  eq(C.outcome(body, { householdId, actorId, operationId: op(99) }),
    { status: 'unknown', operationId: op(99) }, 'unrecorded operation outcome is unknown');
  refuses(() => C.prepare(body, { householdId: otherHousehold, actorId, operationId: op(1),
    command: link('commitment:a', tx(1), evidence(), 100), now }),
    'a document refuses work for another household');
  const tampered = Buffer.from(body.toString('utf8').replace('"revision":0', '"revision":1'));
  refuses(() => C.pin(tampered, householdId), 'a tampered document has no pin');
  refuses(() => C.restore(tampered, C.pin(body, householdId)), 'restore refuses tampered bytes');
  eq(C.restore(body, C.pin(body, householdId)), body, 'restore accepts the pinned bytes');
}

// --- Happy-path link, exact evidence shape, idempotent confirm -------------
{
  let body = adopt();
  const cmd = link('commitment:roof', tx(1), evidence(), 10000);
  const prepared = prepare(body, 1, cmd);
  eq(prepared.effect.commitments.length, 1, 'the preview effect shows the trial link');
  eq(linksOf(body, 'commitment:roof'), [], 'prepare alone records nothing');
  const saved = confirm(body, prepared);
  eq(saved.status, 'candidate', 'first confirmation yields a candidate');
  eq(C.verifyReadback(saved.document, { householdId, operationId: op(1), nextPin: saved.nextPin }),
    true, 'readback verifies against the candidate pin');
  eq(C.outcome(saved.document, { householdId, actorId, operationId: op(1) }),
    { status: 'recorded', operationId: op(1), revision: 1 }, 'the link is recorded at revision 1');
  const entries = linksOf(saved.document, 'commitment:roof');
  eq(entries.length, 1, 'one active link is published as evidence');
  eq(Object.keys(entries[0]).sort(),
    ['asOf', 'effectiveDate', 'evidenceDigest', 'operationId', 'reversals', 'assignedCents', 'txRef'].sort(),
    'an evidence entry carries identity and cents only — no totals, no paid state');
  eq(entries[0].assignedCents, 10000, 'the assigned cents are the frozen claim');
  eq(entries[0].effectiveDate, '2030-03-01', 'the financial effective date is the evidence date');
  eq(entries[0].reversals, [], 'no reversals recorded yet');
  const again = confirm(saved.document, prepared, now + 2);
  eq(again.status, 'already-recorded', 're-confirming the same operation is idempotent');
  eq(again.document, saved.document, 'idempotent confirmation changes no bytes');
  refuses(() => prepare(saved.document, 1, cmd), 'a recorded operation id cannot be re-prepared');
  refuses(() => C.outcome(saved.document, { householdId, actorId: otherActor, operationId: op(1) }),
    'another actor cannot claim the recorded operation');
}

// --- Stale and expired previews --------------------------------------------
{
  let body = adopt();
  const first = prepare(body, 1, link('commitment:a', tx(1), evidence(), 100));
  body = record(body, 2, link('commitment:b', tx(2), evidence(), 100));
  eq(confirm(body, first).status, 'rejected', 'a stale preview is rejected after another write');
  eq(confirm(body, first).reason, 'revision-changed', 'the rejection names the moved revision');
  const fresh = prepare(body, 3, link('commitment:c', tx(3), evidence(), 100));
  eq(confirm(body, fresh, now + C.TTL_MS + 2).reason, 'preview-expired',
    'an expired preview is rejected distinctly');
}

// --- One transaction, one conserved budget, shared partial allocations -----
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 6000));
  body = record(body, 2, link('commitment:b', tx(1), evidence(), 4000));
  eq(linksOf(body, 'commitment:a')[0].assignedCents, 6000, 'first partial allocation stands');
  eq(linksOf(body, 'commitment:b')[0].assignedCents, 4000, 'second partial allocation shares the budget');
  refuses(() => prepare(body, 3, link('commitment:c', tx(1), evidence(), 1)),
    'one cent beyond the shared budget is refused');
  // The same total in the opposite order reaches the same boundary.
  let reordered = adopt();
  reordered = record(reordered, 1, link('commitment:b', tx(1), evidence(), 4000));
  reordered = record(reordered, 2, link('commitment:a', tx(1), evidence(), 6000));
  refuses(() => prepare(reordered, 3, link('commitment:c', tx(1), evidence(), 1)),
    'competing allocations conserve in either order');
  const substance = doc => view(doc).commitments.map(entry => ({
    goalId: entry.goalId,
    links: entry.links.map(({ operationId, ...rest }) => rest),
  }));
  eq(substance(reordered), substance(body),
    'the published allocations are order-independent (operation ids aside)');
}

// --- Changed evidence is not a new identity --------------------------------
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  refuses(() => prepare(body, 2, link('commitment:a', tx(1), evidence({ cents: 9000 }), 100)),
    'the same identity with a changed amount is changed evidence, not new capacity');
  refuses(() => prepare(body, 2, link('commitment:a', tx(1), evidence({ date: '2030-03-02' }), 100)),
    'the same identity with a changed date is changed evidence');
  body = record(body, 3, retract(op(1)));
  refuses(() => prepare(body, 4, link('commitment:a', tx(1), evidence({ cents: 9000 }), 100)),
    'retraction does not launder changed evidence into a new identity');
}

// --- Mistaken link: retraction frees only the named claim; relink is new ---
{
  let body = adopt();
  body = record(body, 1, link('commitment:wrong', tx(1), evidence(), 10000));
  refuses(() => prepare(body, 2, link('commitment:right', tx(1), evidence(), 1)),
    'while the mistaken link is active its budget stays consumed');
  body = record(body, 3, retract(op(1)));
  eq(linksOf(body, 'commitment:wrong'), [], 'retraction removes the named link from active evidence');
  eq(linksOf(body, 'commitment:right'), [], 'retraction never relinks anything by itself');
  body = record(body, 4, link('commitment:right', tx(1), evidence(), 10000));
  eq(linksOf(body, 'commitment:right').length, 1,
    'a fresh explicit link after retraction uses the freed budget');
  refuses(() => prepare(body, 5, retract(op(1))), 'a retracted link cannot be retracted twice');
  refuses(() => prepare(body, 5, retract(op(77))), 'an unknown target cannot be retracted');
  // Retraction frees exactly its own allocation, not a sibling's.
  let shared = adopt();
  shared = record(shared, 1, link('commitment:a', tx(2), evidence(), 6000));
  shared = record(shared, 2, link('commitment:b', tx(2), evidence(), 4000));
  shared = record(shared, 3, retract(op(1)));
  eq(linksOf(shared, 'commitment:b').length, 1, 'the sibling allocation survives the retraction');
  shared = record(shared, 4, link('commitment:c', tx(2), evidence(), 6000));
  refuses(() => prepare(shared, 5, link('commitment:d', tx(2), evidence(), 1)),
    'only the retracted 6000 was freed');
}

// --- Reversals: exact counter-entry, cumulative bound, no new capacity -----
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence(), 3000));
  body = record(body, 3, reverse(op(1), tx(10), refundEvidence({ date: '2030-03-12' }), 7000));
  const entry = linksOf(body, 'commitment:a')[0];
  eq(entry.reversals.map(r => r.cents), [3000, 7000], 'partial reversals accumulate against the link');
  eq(entry.reversals[0].counterTxRef, tx(9), 'each reversal names its exact counter-entry');
  refuses(() => prepare(body, 4, reverse(op(1), tx(11), refundEvidence(), 1)),
    'one cent of reversal beyond the assigned cents is refused');
  refuses(() => prepare(body, 4, reverse(op(1), tx(9), refundEvidence(), 1)),
    'a counter-entry identity cannot be claimed twice');
  refuses(() => prepare(body, 4, link('commitment:b', tx(1), evidence(), 1)),
    'reversed cents restore no capacity on the original transaction');
  refuses(() => prepare(body, 4, link('commitment:b', tx(9), refundEvidence(), 100)),
    'a counter-entry identity can never be linked as payment evidence');
  refuses(() => prepare(body, 4, reverse(op(1), tx(12), evidence({ cents: 100 }), 100)),
    'a debit record cannot pose as a reversal counter-entry');
  // A reversal against a retracted link is an orphan counter-claim.
  let orphan = adopt();
  orphan = record(orphan, 1, link('commitment:a', tx(1), evidence(), 5000));
  orphan = record(orphan, 2, retract(op(1)));
  refuses(() => prepare(orphan, 3, reverse(op(1), tx(9), refundEvidence(), 100)),
    'a retracted link accepts no reversal');
}

// --- Pending lineage: pending never settles; lineage must be proven --------
{
  refuses(() => prepare(adopt(), 1, link('commitment:a', tx(1), evidence({ posted: false }), 100)),
    'pending evidence cannot be linked');
  refuses(() => prepare(adopt(), 1, link('commitment:a', tx(1), refundEvidence(), 100)),
    'a credit cannot be linked as a payment');
  let body = adopt();
  refuses(() => prepare(body, 1, lineage(tx(5), tx(1), C.digest(evidence()))),
    'lineage cannot be asserted before the posted identity is recorded');
  body = record(body, 2, link('commitment:a', tx(1), evidence(), 2000));
  refuses(() => prepare(body, 3, lineage(tx(5), tx(1), C.digest(evidence({ cents: 1 })))),
    'lineage with a mismatched posted digest is refused');
  body = record(body, 4, lineage(tx(5), tx(1), C.digest(evidence())));
  refuses(() => prepare(body, 5, link('commitment:b', tx(5), evidence(), 100)),
    'the pending identity can never be linked after lineage is proven');
  refuses(() => prepare(body, 5, lineage(tx(5), tx(1), C.digest(evidence()))),
    'lineage for one pending identity is recorded once');
}

// --- Deferred semantics stay unrepresentable -------------------------------
{
  const body = adopt();
  refuses(() => prepare(body, 1, { version: 1, kind: 'correct', goalId: 'commitment:a',
    remainingCents: 0 }), 'an absolute remaining correction is not a version-1 command');
  refuses(() => prepare(body, 1, { version: 1, kind: 'remaining-correction',
    goalId: 'commitment:a', remainingCents: 5000 }), 'no alias reintroduces it');
  refuses(() => prepare(body, 1, { ...link('commitment:a', tx(1), evidence(), 100), extra: 1 }),
    'commands carry exact key sets');
  refuses(() => prepare(body, 1, link('commitment:a', tx(1), evidence(), 0)),
    'a zero assignment manufactures nothing');
  refuses(() => prepare(body, 1, link('goal:a', tx(1), evidence(), 100)),
    'targets are commitments, nothing else');
  const badDigest = link('commitment:a', tx(1), evidence(), 100);
  badDigest.evidenceDigest = C.digest(evidence({ cents: 5 }));
  refuses(() => prepare(body, 1, badDigest), 'the frozen evidence must match its digest');
}

// --- Historical revisions are never rewritten -------------------------------
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 2500), now);
  const pinnedBytes = body, pinnedPin = C.pin(body, householdId);
  const snapshot = view(body);
  body = record(body, 2, link('commitment:b', tx(2), evidence({ date: '2030-01-15' }), 3000),
    now + 86400000);
  eq(C.restore(pinnedBytes, pinnedPin), pinnedBytes, 'the earlier revision restores byte-exact');
  eq(view(pinnedBytes), snapshot, 'the earlier revision publishes its original evidence');
  const stored = JSON.parse(body.toString('utf8')).operations;
  eq(stored[0].recordedAt, now, 'recorded time stays the confirmation time');
  eq(stored[0].command.evidence.date, '2030-03-01',
    'the financial effective date stays the evidence date, distinct from recorded time');
  eq(view(body), view(Buffer.from(JSON.stringify(JSON.parse(body.toString('utf8'))))),
    'replay is deterministic across parses');
}

console.log('PASS planned-obligation-settlement-contract: ' + checks + ' synthetic checks');
