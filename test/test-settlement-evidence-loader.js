'use strict';
// Settlement evidence loader foundation (ATLAS-080) — synthetic tests only.
//
// The loader is the read path between a persisted Phase 1 settlement
// document and Forecast's Phase 2 seam: injected bytes + an independently
// supplied pin {revision, digest} in, one explicit outcome out —
// unconfigured, qualified (carrying ONLY the contract's effectiveEvidence
// projection), or unavailable with a stable reason and no evidence.
// No filesystem, environment, network, or provisioning anywhere: every
// read below is an injected callback over contract-built synthetic bytes.
//
// Tests first: against unmodified main this suite fails to load (the
// loader module does not exist). Every unavailable fixture isolates one
// defect, and the closing test proves each enumerated reason was hit.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const F = require(path.join(ROOT, 'public/forecast'));
const C = require(path.join(ROOT, 'scripts/planned-obligation-settlement-contract'));
const L = require(path.join(ROOT, 'scripts/settlement-evidence-loader'));
const fx = require('./fixtures/savings-daily-allocation-contract');

const householdId = 'household-' + 'a'.repeat(32);
const otherHousehold = 'household-' + 'b'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
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
const reader = bytes => () => bytes;
const seenReasons = new Set();

function expectUnavailable(outcome, reason) {
  assert.equal(outcome.status, 'unavailable');
  assert.equal(outcome.reason, reason);
  assert.deepEqual(Object.keys(outcome).sort(), ['reason', 'status'],
    'an unavailable outcome carries a reason and nothing else');
  assert.ok(!('evidence' in outcome), 'an unavailable outcome carries no evidence');
  seenReasons.add(reason);
}
function expectQualified(outcome) {
  assert.equal(outcome.status, 'qualified');
  assert.deepEqual(Object.keys(outcome).sort(), ['evidence', 'status'],
    'a qualified outcome carries only the evidence projection');
  return outcome.evidence;
}

// Canonical synthetic store: genesis, a rev-1 document (25 of 60 link),
// a rev-2 document (plus a second commitment's link), a rev-1 fork twin.
const genesis = C.adopt({ householdId });
const doc1 = docWith([linkCmd({})]);
const doc2 = docWith([linkCmd({}),
  linkCmd({ goalId: 'commitment:far', txRef: tx(2), assignedCents: 1000 })]);
const docFork = docWith([linkCmd({ assignedCents: 2000 })]);
const happyArgs = () => ({ config: { householdId, pin: pinOf(doc1) }, readDocument: reader(doc1) });

// --- Unconfigured: deliberate absence of any configuration ----------------
test('unconfigured: wholly absent configuration is its own outcome', () => {
  for (const args of [undefined, null, {}, { config: null }, { config: undefined }, { config: {} }]) {
    const outcome = L.loadSettlementEvidence(args);
    assert.equal(outcome.status, 'unconfigured');
    assert.deepEqual(Object.keys(outcome), ['status'],
      'an unconfigured outcome carries nothing else');
    assert.ok(!('evidence' in outcome), 'unconfigured is not empty evidence');
  }
});

// --- Partial or invalid configuration is unavailable, never unconfigured --
test('invalid-configuration: partial configuration never reads as unconfigured', () => {
  expectUnavailable(L.loadSettlementEvidence({ config: { householdId } }),
    'invalid-configuration'); // no pin source, no document reader
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) } }),
    'invalid-configuration'); // pin but no document reader
  expectUnavailable(L.loadSettlementEvidence({ readDocument: reader(doc1) }),
    'invalid-configuration'); // reader but no household, no pin
  expectUnavailable(L.loadSettlementEvidence(
    { config: { pin: pinOf(doc1) }, readDocument: reader(doc1) }),
    'invalid-configuration'); // pin but no household
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId: 'household-not-a-real-id', pin: pinOf(doc1) },
      readDocument: reader(doc1) }),
    'invalid-configuration'); // malformed expected household
});

// --- Malformed supplied fields are refused, never normalized into absence --
// Repair round (Systems Review B1 on head 3b71036f): a field that is
// present but malformed is a configuration defect. It must not be
// normalized away before the absent path is chosen, and a malformed
// readPin must not silently fall back to the static config pin.
test('invalid-configuration: malformed supplied fields are refused outright', () => {
  expectUnavailable(L.loadSettlementEvidence({ config: 'bad' }),
    'invalid-configuration'); // a non-record config is supplied, not absent
  expectUnavailable(L.loadSettlementEvidence({ config: [] }),
    'invalid-configuration'); // an array config is supplied, not absent
  expectUnavailable(L.loadSettlementEvidence({ readDocument: 'bad' }),
    'invalid-configuration'); // a non-function document reader is supplied
  expectUnavailable(L.loadSettlementEvidence({ readPin: 'bad' }),
    'invalid-configuration'); // a non-function pin reader is supplied
});

test('invalid-configuration: a malformed readPin never falls back to config.pin', () => {
  // Everything else here is usable — valid household, valid static pin,
  // working document reader — yet the explicitly malformed readPin must
  // refuse the load instead of silently using the static pin.
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readPin: 'bad',
      readDocument: reader(doc1) }), 'invalid-configuration');
});

// --- Pin sourcing ----------------------------------------------------------
test('pin-invalid: a malformed pin from any source yields no evidence', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 1, digest: 'not-a-digest' } },
      readDocument: reader(doc1) }), 'pin-invalid');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: -1, digest: pinOf(doc1).digest } },
      readDocument: reader(doc1) }), 'pin-invalid');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => null, readDocument: reader(doc1) }),
    'pin-invalid');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => Buffer.from('not json'),
      readDocument: reader(doc1) }), 'pin-invalid');
});

test('pin-unavailable: a pin read that throws is unavailable, not unconfigured', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId },
      readPin: () => { throw new Error('pin store unreachable'); },
      readDocument: reader(doc1) }), 'pin-unavailable');
});

test('pin sources: readPin is the live source when both are supplied', () => {
  const evidence = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 9, digest: 'f'.repeat(64) } },
      readPin: () => pinOf(doc1), readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

test('pin sources: pin.json-shaped bytes (extra timestamp key) qualify', () => {
  const pinBytes = Buffer.from(JSON.stringify(
    { ...pinOf(doc1), pinnedAt: '2026-10-04T12:00:00.000Z' }));
  const evidence = expectQualified(L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => pinBytes, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

// --- Qualified paths --------------------------------------------------------
test('qualified: genesis bytes under a genesis pin give empty evidence', () => {
  const evidence = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(genesis) }, readDocument: reader(genesis) }));
  assert.deepEqual(evidence, { commitments: [] },
    'a pinned empty store is qualified empty evidence, not absence');
});

test('qualified: the projection is exactly the contract effectiveEvidence', () => {
  const outcome = L.loadSettlementEvidence(happyArgs());
  const evidence = expectQualified(outcome);
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)),
    'loader evidence deep-equals effectiveEvidence(state) for the same state');
  assert.ok(Object.isFrozen(outcome), 'outcomes are frozen shells');
  assert.deepEqual(Object.keys(evidence), ['commitments'],
    'no document, operations, or history rides along');
});

// --- Qualified evidence drives Phase 2 relief through recommend -----------
function input() {
  const x = fx.fixture();
  x.plan.savingsEarmarks.pools[0].goalRefs = [{ kind: 'commitment', id: 'near' }];
  return x;
}
function surfaces(x, opts) {
  const inventory = F.savingsInventory(x.plan, x.asOf, opts);
  const pool = (inventory.pools || []).find(p => p.id === 'club-pool');
  const goal = pool && pool.plannedGoals.find(g => g.key === 'commitment:near');
  const events = F.expandEvents(x.plan, x.asOf, '2026-11-30', opts)
    .filter(e => e.kind === 'commitment' && e.id === 'near');
  const advice = F.recommend(x.plan, x.asOf, { ...x.opts, ...opts, weeklyVariable: 0, debts: [] });
  const seq = (advice.fundingSequence || []).find(e => e.id === 'near');
  return { goal, events, seq };
}

test('relief: loader-qualified evidence partially relieves through Forecast', () => {
  const evidence = expectQualified(L.loadSettlementEvidence(happyArgs()));
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: evidence });
  assert.equal(goal.target, 60, 'original cost preserved');
  assert.equal(goal.linkedPaid, 25, 'the confirmed 25 link is the linked paid figure');
  assert.equal(goal.remaining, 35, 'remaining = original - linked paid');
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -35, 'the cash event carries the relieved amount');
  assert.equal(seq.need, 35, 'recommend funds only the remaining');
});

test('relief: loader-qualified full link suppresses the requirement, unsettled', () => {
  const full = docWith([linkCmd({ assignedCents: 6000 })]);
  const evidence = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(full) }, readDocument: reader(full) }));
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: evidence });
  assert.equal(goal.linkedPaid, 60);
  assert.equal(goal.remaining, 0, 'fully relieved');
  assert.equal(goal.settled, false, 'a link is not settlement; history is retained');
  assert.equal(events.length, 0, 'no cash event for a fully relieved commitment');
  assert.equal(seq.need, 0, 'recommend requires nothing further');
});

// Integration regression: the same pinned evidence and frozen synthetic
// ledger reach both the current publication and native future closes.
// The earlier goal/event/sequence tests do not exercise this closing gate.
const chronological = require('./fixtures/chronological-savings-data');
function freezeJson(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}
function savingsPublications(x, evidence) {
  const advice = F.recommend(x.plan, x.asOf,
    { ...x.opts, settlementEvidence: evidence, weeklyVariable: 0, debts: [] });
  const context = { asOf: x.asOf, advice };
  const current = F.savingsFundingPublication(advice.savingsFunding, context);
  assert.ok(current, 'current publication qualifies through Forecast');
  const closing = start => {
    const view = current.periodViews.find(p => p.start === start);
    assert.ok(view, 'native selected period exists');
    const packet = F.savingsFundingPublication(current, { ...context, periodId: view.id });
    assert.ok(packet, 'selected publication qualifies through Forecast');
    return packet.forecastClosing;
  };
  return { current, closing };
}
const closingStarts = ['2026-10-16', '2026-10-30', '2026-11-13'];
const fullLink = () => docWith([linkCmd({ assignedCents: 6000 })]);
function qualifiedDocument(bytes) {
  const pin = freezeJson(pinOf(bytes)); // independent of each read callback
  return freezeJson(expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin }, readDocument: reader(bytes) })));
}

for (const paid of [25, 60]) test('Savings publications: loader-qualified ' + paid + '/60 relief conserves current and future stock', () => {
  const x = freezeJson(chronological.ledger());
  const evidence = qualifiedDocument(docWith([linkCmd({ assignedCents: paid * 100 })]));
  const before = JSON.stringify({ x, evidence });
  const result = savingsPublications(x, evidence);
  const goal = F.savingsInventory(x.plan, x.asOf, { settlementEvidence: evidence })
    .pools.find(p => p.id === 'club-pool').plannedGoals.find(g => g.key === 'group:club');
  assert.equal(goal.target, 60, 'original cost stays distinct from relief');
  assert.equal(goal.linkedPaid, paid);
  assert.equal(goal.remaining, 60 - paid);
  assert.equal(goal.target, goal.linkedPaid + goal.remaining);
  assert.equal(goal.settled, false, 'linked evidence never writes settledOn');
  const item = result.current.backing.items.find(i => i.id === 'near');
  assert.equal(item.needed, 60 - paid);
  assert.equal(item.saved, 60 - paid, 'backed is the remaining allocation, not linked paid');
  assert.equal(result.current.stock.amount, 119, 'the reported 30 + 89 is not debited again');
  assert.equal(result.current.backing.unallocated + item.saved, 119);
  // Independent cents ledger: the only future goal debit is 6000-paid.
  // The existing 8000 Bills remainder sweeps Oct 30; the Nov 2 receipt
  // 7700 sweeps Nov 13. Neither is credited before its own sweep.
  const expected = [3000 + 8900, 3000 + 8900 + 8000, 3000 + 8900 + 8000 + 7700]
    .map(stock => (stock - (6000 - paid * 100)) / 100);
  const closes = closingStarts.map((start, i) => {
    const close = result.closing(start);
    assert.equal(close.status, 'ready', close.reason);
    assert.equal(close.stock, expected[i]);
    assert.equal(close.projectedDraws, 60 - paid, 'only remaining cost is deducted once');
    assert.equal(close.actualSaved, null);
    assert.equal(close.moneyMovementPermission, 'not-granted');
    return close;
  });
  const currentBeforeNavigation = JSON.stringify(result.current);
  for (const index of [2, 0, 1, 0, 2]) assert.deepEqual(result.closing(closingStarts[index]), closes[index]);
  assert.equal(JSON.stringify(result.current), currentBeforeNavigation);
  const repeated = savingsPublications(x, evidence);
  assert.deepEqual(repeated.current, result.current);
  closingStarts.forEach((start, i) => assert.deepEqual(repeated.closing(start), closes[i]));
  assert.equal(JSON.stringify({ x, evidence }), before, 'evaluation and navigation preserve the identical inputs');
});

const expenseHold = 'A Savings requirement has no unique matching native expense.';
test('Savings publications: an ordinary zero retains its ready legacy behavior without settlement evidence', () => {
  const x = chronological.ledger();
  x.plan.commitments[0].amount = 0;
  freezeJson(x);
  const result = savingsPublications(x);
  assert.equal(result.current.stock.amount, 119);
  for (const [index, expectedStock] of [119, 199, 276].entries()) {
    const close = result.closing(closingStarts[index]);
    assert.equal(close.status, 'ready', close.reason);
    assert.equal(close.stock, expectedStock);
    assert.equal(close.projectedDraws, 0);
  }
});

for (const mode of ['overassigned-zero', 'duplicate-commitment', 'ambiguous-expense', 'reversal', 'missing-stock', 'pending-stock', 'incomplete-movement'])
  test('Savings full-relief closing keeps the existing hold: ' + mode, () => {
    const x = chronological.ledger();
    let bytes = fullLink();
    if (mode === 'overassigned-zero') x.plan.commitments[0].amount = 0;
    if (mode === 'duplicate-commitment') x.plan.commitments.push({ ...x.plan.commitments[0] });
    if (mode === 'ambiguous-expense') {
      bytes = docWith([linkCmd({ assignedCents: 2500 })]);
      x.plan.bills = [{ id: 'near', label: 'Invented conflicting bill', frequency: 'once',
        date: '2026-10-21', amount: 35, confidence: 'confirmed', jointCash: false }];
    }
    if (mode === 'reversal') {
      const counterEvidence = ev({ direction: 'credit', date: '2026-10-04' });
      bytes = docWith([linkCmd({ assignedCents: 6000 }), { version: 1, kind: 'reverse',
        targetOperationId: op(1), counterTxRef: tx(9), counterEvidence,
        counterEvidenceDigest: C.digest(counterEvidence), cents: 500 }]);
    }
    if (mode === 'missing-stock') x.plan.savingsPoolObservation.accounts.pop();
    if (mode === 'pending-stock') x.plan.savingsPoolObservation.accounts[0].pendingState = 'unresolved';
    if (mode === 'incomplete-movement') x.opts.currentPeriodActuals.transactionCoverage.complete = false;
    const evidence = qualifiedDocument(bytes);
    const before = JSON.stringify({ x, evidence });
    freezeJson(x);
    const result = savingsPublications(x, evidence);
    for (const start of closingStarts) {
      const close = result.closing(start);
      assert.equal(close.status, 'unavailable', mode);
      assert.equal(close.stock, null);
      assert.equal(close.actualSaved, null);
      assert.equal(close.moneyMovementPermission, 'not-granted');
      if (mode === 'duplicate-commitment') assert.equal(close.reason, expenseHold);
      if (mode === 'ambiguous-expense')
        assert.equal(close.reason, 'A backed requirement lacks one uniquely matched dated payment.');
    }
    assert.equal(JSON.stringify({ x, evidence }), before);
  });

test('control: unconfigured outcome means no evidence reaches Forecast', () => {
  const outcome = L.loadSettlementEvidence();
  assert.equal(outcome.status, 'unconfigured');
  const { goal, events, seq } = surfaces(input(), {});
  assert.equal(goal.target, 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -60, 'without evidence the full cost is still required');
  assert.equal(seq.need, 60);
});

// --- Document read failures --------------------------------------------------
test('document-unavailable: a document read that throws yields no evidence', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: () => { throw new Error('store unreachable'); } }),
    'document-unavailable');
});

test('document-missing: a configured but absent store is unavailable', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: () => null }),
    'document-missing');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: () => Buffer.alloc(0) }),
    'document-missing');
});

test('document-malformed: unparseable or shapeless bytes yield no evidence', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('this is not a settlement document')) }),
    'document-malformed');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('[1,2,3]')) }), 'document-malformed');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('{"schema":"atlas-planned-obligation-settlements/v1"}')) }),
    'document-malformed');
});

// --- Pin/document disagreement: never evidence, never silent resumption ----
test('household-mismatch: a document for another household never qualifies', () => {
  const foreign = docWith([linkCmd({})], otherHousehold);
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(foreign) }, readDocument: reader(foreign) }),
    'household-mismatch');
});

test('revision-mismatch: a document behind the pin is not the pinned revision', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc2) }, readDocument: reader(doc1) }),
    'revision-mismatch');
});

test('document-ahead-of-pin: a newer document is never served or promoted', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(doc2) }),
    'document-ahead-of-pin');
});

test('document-ahead-of-pin: an unpinned candidate operation stays unresolved', () => {
  // A candidate document from confirmCandidate is a confirmed-but-unpinned
  // write: the loader must not serve it against the genesis pin, and must
  // not promote it. In loader terms it is ahead-of-pin state.
  let body = C.adopt({ householdId });
  const prepared = C.prepare(body,
    { householdId, actorId, operationId: op(1), command: linkCmd({}), now: T0 });
  const candidate = C.confirmCandidate(body,
    { householdId, actorId, preview: prepared.preview,
      confirmationDigest: prepared.confirmationDigest, now: T0 + 1 });
  assert.equal(candidate.status, 'candidate');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(genesis) },
      readDocument: reader(candidate.document) }), 'document-ahead-of-pin');
});

test('digest-mismatch: same revision, different digest — altered or forked', () => {
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(docFork) }),
    'digest-mismatch');
});

test('fork: of two documents at the pin revision, only the pinned one qualifies', () => {
  const evidence = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(docFork) }, readDocument: reader(docFork) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(docFork)));
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(docFork) }, readDocument: reader(doc1) }),
    'digest-mismatch');
});

test('document-invalid: tampered content under a stale embedded digest fails verification', () => {
  // The embedded digest field still matches the pin, so staging passes;
  // the contract's own digest/replay verification must refuse the bytes.
  const tampered = Buffer.from(
    doc1.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'));
  assert.notEqual(tampered.toString('utf8'), doc1.toString('utf8'),
    'the tamper changed the bytes');
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(tampered) }),
    'document-invalid');
});

test('document-invalid: replayed-invalid history fails contract verification', () => {
  // Bytes whose embedded digest honestly covers an operation history the
  // contract refuses (an over-budget second link): the digest staging
  // cannot see it; contract replay must.
  const state = stateOf(doc1);
  const badOps = [...state.operations, {
    revision: 2, operationId: op(2), actorId, recordedAt: T0 + 4,
    requestDigest: 'e'.repeat(64),
    command: linkCmd({ goalId: 'commitment:far', assignedCents: 99999 }),
  }];
  const data = { schema: C.SCHEMA, householdId, revision: 2, operations: badOps };
  const body = Buffer.from(JSON.stringify({ ...data, digest: C.digest(data) }));
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 2, digest: JSON.parse(body.toString('utf8')).digest } },
      readDocument: reader(body) }), 'document-invalid');
});

// --- Read consistency ---------------------------------------------------------
test('document-changed: bytes that move between verification and projection', () => {
  let calls = 0;
  const unstable = () => (++calls === 1 ? doc1 : docFork);
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: unstable }),
    'document-changed');
});

test('document-changed: a stability re-read that throws is not qualified', () => {
  let calls = 0;
  const flaky = () => { if (++calls === 1) return doc1; throw new Error('store moved'); };
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: flaky }),
    'document-changed');
});

// --- Snapshot ownership -------------------------------------------------------
// Repair round (Systems Review B2 on head 3b71036f): the byte snapshot the
// loader verifies and projects from must be its own copy. A caller-owned
// Buffer mutated in place between the two reads — same length, embedded
// digest left stale — must not compare equal to itself and qualify on a
// changed, now-invalid document.
test('document-changed: in-place mutation of a shared Buffer between reads', () => {
  const shared = Buffer.from(doc1);
  let calls = 0;
  const mutating = () => {
    calls += 1;
    if (calls === 2) {
      const text = shared.toString('utf8')
        .replace('"assignedCents":2500', '"assignedCents":2000');
      assert.equal(text.length, shared.length, 'the mutation preserves length');
      shared.write(text, 0, 'utf8');
    }
    return shared;
  };
  expectUnavailable(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: mutating }),
    'document-changed');
});

test('snapshot controls: stable Buffer and Uint8Array readers still qualify', () => {
  const fromBuffer = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from(doc1)) }));
  assert.deepEqual(fromBuffer, C.effectiveEvidence(stateOf(doc1)));
  const fromArray = expectQualified(L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(new Uint8Array(doc1)) }));
  assert.deepEqual(fromArray, C.effectiveEvidence(stateOf(doc1)));
});

// --- Reason coverage ------------------------------------------------------------
test('coverage: every enumerated unavailable reason was exercised above', () => {
  assert.deepEqual([...seenReasons].sort(), [...L.REASONS].sort(),
    'the suite pins each reason code the module enumerates');
});
