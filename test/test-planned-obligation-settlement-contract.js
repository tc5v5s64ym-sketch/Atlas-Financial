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
  body = record(body, 3, reverse(op(1), tx(10), refundEvidence({ date: '2030-03-12', cents: 7000 }), 7000));
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

// --- Review round: a reversal is bounded by its own counter-entry (C1) -----
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 10000));
  refuses(() => prepare(body, 2, reverse(op(1), tx(9), refundEvidence(), 7000)),
    'a reversal may not exceed the cents its counter-entry actually carries');
  refuses(() => prepare(body, 2, reverse(op(1), tx(9), refundEvidence(), 4001)),
    'one cent beyond the counter-entry is refused');
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence(), 4000));
  eq(linksOf(body, 'commitment:a')[0].reversals[0].cents, 4000,
    'a reversal at exactly the counter-entry amount stands');
}

// --- Review round: retraction releases only unreversed cents (C2) ----------
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 3000 }), 3000));
  body = record(body, 3, retract(op(1)));
  refuses(() => prepare(body, 4, link('commitment:b', tx(1), evidence(), 10000)),
    'reversed cents stay consumed after retraction — no double capacity');
  body = record(body, 4, link('commitment:b', tx(1), evidence(), 7000));
  eq(linksOf(body, 'commitment:b')[0].assignedCents, 7000,
    'the net unreversed remainder can be linked again');
  refuses(() => prepare(body, 5, link('commitment:c', tx(1), evidence(), 1)),
    'reversed 3000 plus relinked 7000 exhausts the identity');
}

// --- Review round: one identity, one role (C3) ------------------------------
{
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  body = record(body, 2, link('commitment:b', tx(2), evidence(), 5000));
  refuses(() => prepare(body, 3, reverse(op(2), tx(1), refundEvidence({ cents: 1000 }), 1000)),
    'an identity already holding the payment role cannot be a counter-entry');
  let lin = adopt();
  lin = record(lin, 1, link('commitment:a', tx(1), evidence(), 5000));
  lin = record(lin, 2, lineage(tx(5), tx(1), C.digest(evidence())));
  lin = record(lin, 3, link('commitment:b', tx(2), evidence(), 5000));
  refuses(() => prepare(lin, 4, reverse(op(3), tx(5), refundEvidence({ cents: 1000 }), 1000)),
    'a proven pending identity cannot be a counter-entry');
}

// --- Composed replay controls (Atlas review round, 2026-10-18) -------------
{
  // Partial reversal, then retraction, then fresh reassignment of the net.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 3000 }), 3000));
  const bytesAt2 = body;
  body = record(body, 3, retract(op(1)));
  body = record(body, 4, link('commitment:b', tx(1), evidence(), 7000));
  refuses(() => prepare(body, 5, link('commitment:c', tx(1), evidence(), 1)),
    'composed: reversed 3000 + reassigned 7000 exhaust the identity');
  // Repeated retraction and repeated reversal are both refused.
  refuses(() => prepare(body, 5, retract(op(1))), 'composed: a second retraction is refused');
  refuses(() => prepare(body, 5, reverse(op(4), tx(9), refundEvidence({ cents: 1000 }), 1000)),
    'composed: the same counter-entry identity cannot reverse twice');
  // The composed history restores exactly, and the pinned pre-retraction
  // bytes still show the link active with its reversal history intact.
  eq(C.restore(body, C.pin(body, householdId)), body, 'composed: final document restores');
  eq(C.restore(bytesAt2, C.pin(bytesAt2, householdId)), bytesAt2,
    'composed: the pre-retraction revision restores byte-exact');
  eq(linksOf(bytesAt2, 'commitment:a').length, 1,
    'composed: the pre-retraction revision still shows the link active');
  eq(linksOf(bytesAt2, 'commitment:a')[0].reversals.length, 1,
    'composed: frozen evidence and reversal history survive retraction intact');
}
{
  // Full reversal, then retraction: nothing returns to the budget.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 10000 }), 10000));
  body = record(body, 3, retract(op(1)));
  refuses(() => prepare(body, 4, link('commitment:b', tx(1), evidence(), 1)),
    'composed: a fully reversed link releases nothing when retracted');
  refuses(() => prepare(body, 4, reverse(op(1), tx(10), refundEvidence({ cents: 1 }), 1)),
    'composed: reversing a retracted link is refused');
}
{
  // Role ordering, both directions: counter-entry first, then the same
  // identity offered as a payment or proven as pending — both refused.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 1000 }), 1000));
  refuses(() => prepare(body, 3, link('commitment:b', tx(9), evidence({ date: '2030-03-12', cents: 1000 }), 1000)),
    'composed: a counter-entry identity cannot later become a payment');
  refuses(() => prepare(body, 3, lineage(tx(9), tx(1), C.digest(evidence()))),
    'composed: a counter-entry identity cannot later be proven pending lineage');
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

// --- Rule D: one active allocation per (goalId, txRef) pair -----------------
// Forward-only admission guard. The pair key is goalId + txRef alone:
// assignedCents and evidenceDigest are never compared, so a different
// amount is not an amendment. "Active" is replay's definition: set by
// link, cleared only by retract; a reversal never clears it. Case labels
// RD-1..RD-17 follow the acceptance table in the Rule D refinement.
{
  // RD-1: no active link for the pair — admitted exactly as before, both
  // on an empty document and beside other pairs.
  let body = adopt();
  body = record(body, 1, link('commitment:b', tx(2), evidence(), 100));
  body = record(body, 2, link('commitment:a', tx(1), evidence(), 4000));
  eq(linksOf(body, 'commitment:a').length, 1, 'RD-1: a fresh pair is admitted beside other pairs');
  eq(linksOf(body, 'commitment:a')[0].assignedCents, 4000, 'RD-1: the admitted link stands as recorded');
}
{
  // RD-2: retrying the recorded operation itself returns its original
  // receipt through the already-recorded branch; the guard never judges it.
  let body = adopt();
  const preparedA = prepare(body, 1, link('commitment:a', tx(1), evidence({ cents: 60000 }), 30000));
  const saved = confirm(body, preparedA, now);
  eq(saved.status, 'candidate', 'RD-2: the original link records');
  body = record(saved.document, 2, link('commitment:b', tx(2), evidence(), 100));
  const again = confirm(body, preparedA, now + 5);
  eq(again.status, 'already-recorded', 'RD-2: a same-operation retry is already-recorded, never held');
  eq(again.document, body, 'RD-2: the retry returns the handed document unchanged');
  eq(again.nextPin, C.pin(body, householdId), 'RD-2: the retry receipt names the current pin');
  eq(C.outcome(body, { householdId, actorId, operationId: op(1) }),
    { status: 'recorded', operationId: op(1), revision: 1 }, 'RD-2: outcome still reports the original revision');
}
{
  // RD-3: an identical second tuple under a new operation is held at
  // prepare, even with budget headroom to spare; nothing records.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 60000 }), 30000));
  refuses(() => prepare(body, 2, link('commitment:a', tx(1), evidence({ cents: 60000 }), 30000)),
    'RD-3: an identical second allocation for the active pair is refused');
  eq(JSON.parse(body.toString('utf8')).revision, 1, 'RD-3: the refused prepare records nothing');
  eq(C.outcome(body, { householdId, actorId, operationId: op(2) }),
    { status: 'unknown', operationId: op(2) }, 'RD-3: the refused operation stays unrecorded');
}
{
  // RD-4: different assignedCents is not an amendment path. The budget
  // would admit 30000 + 20000 against 50000; the pair guard refuses.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 50000 }), 30000));
  refuses(() => prepare(body, 2, link('commitment:a', tx(1), evidence({ cents: 50000 }), 20000)),
    'RD-4: a different-cents second allocation for the active pair is refused');
}
{
  // RD-5: the second allocation would also exceed the budget; the refusal
  // does not depend on which check fires.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 30000 }), 30000));
  refuses(() => prepare(body, 2, link('commitment:a', tx(1), evidence({ cents: 30000 }), 20000)),
    'RD-5: an over-budget duplicate pair is refused either way');
}
{
  // RD-6: retract frees the pair; an identical relink is a fresh act.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 30000 }), 30000));
  body = record(body, 2, retract(op(1)));
  body = record(body, 3, link('commitment:a', tx(1), evidence({ cents: 30000 }), 30000));
  eq(linksOf(body, 'commitment:a').length, 1, 'RD-6: retract-then-relink admits the identical tuple');
  eq(linksOf(body, 'commitment:a')[0].assignedCents, 30000, 'RD-6: the relink stands at full amount');
}
{
  // RD-7: pair-free is not budget-free. After a 10000 partial reversal and
  // a retract, the pair is admissible but only 20000 of capacity returned.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 30000 }), 30000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 10000 }), 10000));
  body = record(body, 3, retract(op(1)));
  refuses(() => prepare(body, 4, link('commitment:a', tx(1), evidence({ cents: 30000 }), 20001)),
    'RD-7: a relink past the unreversed remainder still fails the budget cap');
  body = record(body, 4, link('commitment:a', tx(1), evidence({ cents: 30000 }), 20000));
  eq(linksOf(body, 'commitment:a')[0].assignedCents, 20000,
    'RD-7: a relink at the unreversed remainder is admitted');
}
{
  // RD-8: a link reversed in full is still active; only retract frees it.
  // Budget headroom (10000 of 20000 unused) isolates the guard as the
  // refusing check.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 20000 }), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 10000 }), 10000));
  eq(linksOf(body, 'commitment:a').length, 1, 'RD-8: the fully reversed link still projects as active');
  eq(linksOf(body, 'commitment:a')[0].reversals.length, 1, 'RD-8: the full reversal stays on the link');
  refuses(() => prepare(body, 3, link('commitment:a', tx(1), evidence({ cents: 20000 }), 5000)),
    'RD-8: a fully reversed link still blocks its pair');
}
{
  // RD-9: a partial reversal likewise leaves the pair blocked.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 20000 }), 10000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 4000 }), 4000));
  refuses(() => prepare(body, 3, link('commitment:a', tx(1), evidence({ cents: 20000 }), 5000)),
    'RD-9: a partially reversed link still blocks its pair');
}
{
  // RD-10: a different goal against the same transaction is a different
  // pair; the shared budget is the only governor.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 6000));
  body = record(body, 2, link('commitment:b', tx(1), evidence(), 4000));
  eq(linksOf(body, 'commitment:b')[0].assignedCents, 4000,
    'RD-10: a different-goal allocation within budget is admitted');
}
{
  // RD-11: a different-goal allocation past the budget is refused by the
  // pre-existing cap, exactly as before; the guard is not involved.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 6000));
  refuses(() => prepare(body, 2, link('commitment:b', tx(1), evidence(), 5000)),
    'RD-11: a different-goal allocation over budget is refused by the cap');
}
{
  // RD-12: a different goal with a different evidence digest for the same
  // transaction is refused by the pre-existing one-digest rule.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  refuses(() => prepare(body, 2, link('commitment:b', tx(1), evidence({ cents: 9000 }), 100)),
    'RD-12: changed evidence for the same identity is refused as before');
}
{
  // RD-13: the same goal funded by a second transaction is a different
  // pair; multi-transaction goal funding is preserved.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  body = record(body, 2, link('commitment:a', tx(2), evidence(), 5000));
  eq(linksOf(body, 'commitment:a').length, 2, 'RD-13: one goal, two transactions, both admitted');
}
{
  // RD-14: a historical document already containing duplicate active pairs
  // (same and different amounts, recorded while the gap was open) decodes,
  // replays, digests, pins and projects byte-identically; only NEW
  // admissions against it are held. Built by hand because the guarded
  // prepare can no longer mint such a document.
  const histEvent = (revision, n, command, at) => ({
    revision, operationId: op(n), actorId, recordedAt: at,
    requestDigest: C.digest({ historical: n }), command,
  });
  const histState = {
    householdId, revision: 4,
    operations: [
      histEvent(1, 41, link('commitment:roof', tx(1), evidence({ cents: 90000 }), 30000), now),
      histEvent(2, 42, link('commitment:roof', tx(1), evidence({ cents: 90000 }), 20000), now + 1),
      histEvent(3, 43, link('commitment:roof', tx(2), evidence({ cents: 60000 }), 30000), now + 2),
      histEvent(4, 44, link('commitment:roof', tx(2), evidence({ cents: 60000 }), 30000), now + 3),
    ],
  };
  const histBody = Buffer.from(JSON.stringify({
    schema: C.SCHEMA, ...histState,
    digest: C.digest({ schema: C.SCHEMA, ...histState }),
  }));
  eq(C.restore(histBody, C.pin(histBody, householdId)), histBody,
    'RD-14: the duplicate-pair document restores under its own pin');
  eq(linksOf(histBody, 'commitment:roof').length, 4,
    'RD-14: both historical duplicate pairs still project as active evidence');
  eq(C.outcome(histBody, { householdId, actorId, operationId: op(41) }),
    { status: 'recorded', operationId: op(41), revision: 1 },
    'RD-14: historical receipts keep their identity');
  eq(C.outcome(histBody, { householdId, actorId, operationId: op(44) }),
    { status: 'recorded', operationId: op(44), revision: 4 },
    'RD-14: the last historical operation keeps its revision');
  refuses(() => prepare(histBody, 45, link('commitment:roof', tx(1), evidence({ cents: 90000 }), 1000), now + 10),
    'RD-14: a NEW link for a historically duplicated pair is held (forward-only)');
  const extended = record(histBody, 46, link('commitment:roof', tx(3), evidence(), 1000), now + 10);
  eq(linksOf(extended, 'commitment:roof').length, 5,
    'RD-14: a new link for an unduplicated pair against the same document is admitted');
}
{
  // RD-15: the ordinary two-preview race is preserved. Both previews are
  // prepared against the same base revision; the first confirm commits,
  // the second is refused by the existing revision/pin check, and exactly
  // one active allocation exists.
  let body = adopt();
  const first = prepare(body, 1, link('commitment:a', tx(1), evidence({ cents: 50000 }), 30000));
  const second = prepare(body, 2, link('commitment:a', tx(1), evidence({ cents: 50000 }), 20000));
  const saved = confirm(body, first);
  eq(saved.status, 'candidate', 'RD-15: the first racer commits');
  body = saved.document;
  const raced = confirm(body, second);
  eq(raced.status, 'rejected', 'RD-15: the second racer cannot commit');
  eq(raced.reason, 'revision-changed', 'RD-15: the stale preview is refused by the revision/pin check');
  eq(linksOf(body, 'commitment:a').length, 1, 'RD-15: exactly one active allocation exists');
}
{
  // RD-16: non-link commands are never evaluated by the guard; while the
  // pair is active they behave exactly per the pre-existing rules.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence(), 5000));
  body = record(body, 2, reverse(op(1), tx(9), refundEvidence({ cents: 1000 }), 1000));
  body = record(body, 3, lineage(tx(5), tx(1), C.digest(evidence())));
  body = record(body, 4, retract(op(1)));
  eq(linksOf(body, 'commitment:a'), [], 'RD-16: reverse, lineage and retract proceed unaffected');
}
{
  // RD-17: confirmCandidate invoked directly with a candidate that is
  // CURRENT against the decoded state (valid pin, unexpired) whose link
  // duplicates the already-active pair in that same state — the guard
  // itself refuses, isolated from the revision/pin check. The preview is
  // built by hand because the guarded prepare can no longer mint it. The
  // budget would admit 30000 + 20000 against 50000, and the same
  // construction for a fresh pair returns a candidate, proving the pin
  // was valid and the guard is the refusing check.
  let body = adopt();
  body = record(body, 1, link('commitment:a', tx(1), evidence({ cents: 50000 }), 30000));
  const parsed = JSON.parse(body.toString('utf8'));
  const handPreview = (operationId, command) => ({
    schema: C.PREVIEW_SCHEMA, householdId, actorId, operationId,
    expectedRevision: parsed.revision, expectedDocumentDigest: parsed.digest,
    issuedAt: now, expiresAt: now + C.TTL_MS, command,
  });
  const dupPreview = handPreview(op(9), link('commitment:a', tx(1), evidence({ cents: 50000 }), 20000));
  refuses(() => C.confirmCandidate(body,
    { householdId, actorId, preview: dupPreview,
      confirmationDigest: C.digest(dupPreview), now: now + 1 }),
    'RD-17: a current candidate duplicating the active pair is refused by the guard');
  eq(JSON.parse(body.toString('utf8')).revision, 1, 'RD-17: the refused candidate changes no bytes');
  const freshPreview = handPreview(op(10), link('commitment:a', tx(2), evidence({ cents: 50000 }), 20000));
  eq(C.confirmCandidate(body,
    { householdId, actorId, preview: freshPreview,
      confirmationDigest: C.digest(freshPreview), now: now + 1 }).status, 'candidate',
    'RD-17: the identical construction for a fresh pair is admitted — the pin was valid');
}

console.log('PASS planned-obligation-settlement-contract: ' + checks + ' synthetic checks');
