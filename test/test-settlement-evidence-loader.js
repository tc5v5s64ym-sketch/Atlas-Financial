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
test('unconfigured: wholly absent configuration is its own outcome', async () => {
  for (const args of [undefined, null, {}, { config: null }, { config: undefined }, { config: {} }]) {
    const outcome = await L.loadSettlementEvidence(args);
    assert.equal(outcome.status, 'unconfigured');
    assert.deepEqual(Object.keys(outcome), ['status'],
      'an unconfigured outcome carries nothing else');
    assert.ok(!('evidence' in outcome), 'unconfigured is not empty evidence');
  }
});

// --- Partial or invalid configuration is unavailable, never unconfigured --
test('invalid-configuration: partial configuration never reads as unconfigured', async () => {
  expectUnavailable(await L.loadSettlementEvidence({ config: { householdId } }),
    'invalid-configuration'); // no pin source, no document reader
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) } }),
    'invalid-configuration'); // pin but no document reader
  expectUnavailable(await L.loadSettlementEvidence({ readDocument: reader(doc1) }),
    'invalid-configuration'); // reader but no household, no pin
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { pin: pinOf(doc1) }, readDocument: reader(doc1) }),
    'invalid-configuration'); // pin but no household
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId: 'household-not-a-real-id', pin: pinOf(doc1) },
      readDocument: reader(doc1) }),
    'invalid-configuration'); // malformed expected household
});

// --- Malformed supplied fields are refused, never normalized into absence --
// Repair round (Systems Review B1 on head 3b71036f): a field that is
// present but malformed is a configuration defect. It must not be
// normalized away before the absent path is chosen, and a malformed
// readPin must not silently fall back to the static config pin.
test('invalid-configuration: malformed supplied fields are refused outright', async () => {
  expectUnavailable(await L.loadSettlementEvidence({ config: 'bad' }),
    'invalid-configuration'); // a non-record config is supplied, not absent
  expectUnavailable(await L.loadSettlementEvidence({ config: [] }),
    'invalid-configuration'); // an array config is supplied, not absent
  expectUnavailable(await L.loadSettlementEvidence({ readDocument: 'bad' }),
    'invalid-configuration'); // a non-function document reader is supplied
  expectUnavailable(await L.loadSettlementEvidence({ readPin: 'bad' }),
    'invalid-configuration'); // a non-function pin reader is supplied
});

test('invalid-configuration: a malformed readPin never falls back to config.pin', async () => {
  // Everything else here is usable — valid household, valid static pin,
  // working document reader — yet the explicitly malformed readPin must
  // refuse the load instead of silently using the static pin.
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readPin: 'bad',
      readDocument: reader(doc1) }), 'invalid-configuration');
});

// --- Pin sourcing ----------------------------------------------------------
test('pin-invalid: a malformed pin from any source yields no evidence', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 1, digest: 'not-a-digest' } },
      readDocument: reader(doc1) }), 'pin-invalid');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: -1, digest: pinOf(doc1).digest } },
      readDocument: reader(doc1) }), 'pin-invalid');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => null, readDocument: reader(doc1) }),
    'pin-invalid');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => Buffer.from('not json'),
      readDocument: reader(doc1) }), 'pin-invalid');
});

test('pin-unavailable: a pin read that throws is unavailable, not unconfigured', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId },
      readPin: () => { throw new Error('pin store unreachable'); },
      readDocument: reader(doc1) }), 'pin-unavailable');
});

test('pin sources: readPin is the live source when both are supplied', async () => {
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 9, digest: 'f'.repeat(64) } },
      readPin: () => pinOf(doc1), readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

test('pin sources: pin.json-shaped bytes (extra timestamp key) qualify', async () => {
  const pinBytes = Buffer.from(JSON.stringify(
    { ...pinOf(doc1), pinnedAt: '2026-10-04T12:00:00.000Z' }));
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => pinBytes, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

// --- Qualified paths --------------------------------------------------------
test('qualified: genesis bytes under a genesis pin give empty evidence', async () => {
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(genesis) }, readDocument: reader(genesis) }));
  assert.deepEqual(evidence, { commitments: [] },
    'a pinned empty store is qualified empty evidence, not absence');
});

test('qualified: the projection is exactly the contract effectiveEvidence', async () => {
  const outcome = await L.loadSettlementEvidence(happyArgs());
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

test('relief: loader-qualified evidence partially relieves through Forecast', async () => {
  const evidence = expectQualified(await L.loadSettlementEvidence(happyArgs()));
  const { goal, events, seq } = surfaces(input(), { settlementEvidence: evidence });
  assert.equal(goal.target, 60, 'original cost preserved');
  assert.equal(goal.linkedPaid, 25, 'the confirmed 25 link is the linked paid figure');
  assert.equal(goal.remaining, 35, 'remaining = original - linked paid');
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -35, 'the cash event carries the relieved amount');
  assert.equal(seq.need, 35, 'recommend funds only the remaining');
});

test('relief: loader-qualified full link suppresses the requirement, unsettled', async () => {
  const full = docWith([linkCmd({ assignedCents: 6000 })]);
  const evidence = expectQualified(await L.loadSettlementEvidence(
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
async function qualifiedDocument(bytes) {
  const pin = freezeJson(pinOf(bytes)); // independent of each read callback
  return freezeJson(expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin }, readDocument: reader(bytes) })));
}

for (const paid of [25, 60]) test('Savings publications: loader-qualified ' + paid + '/60 relief conserves current and future stock', async () => {
  const x = freezeJson(chronological.ledger());
  const evidence = await qualifiedDocument(docWith([linkCmd({ assignedCents: paid * 100 })]));
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
test('Savings publications: an ordinary zero retains its ready legacy behavior without settlement evidence', async () => {
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
  test('Savings full-relief closing keeps the existing hold: ' + mode, async () => {
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
    const evidence = await qualifiedDocument(bytes);
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

test('control: unconfigured outcome means no evidence reaches Forecast', async () => {
  const outcome = await L.loadSettlementEvidence();
  assert.equal(outcome.status, 'unconfigured');
  const { goal, events, seq } = surfaces(input(), {});
  assert.equal(goal.target, 60);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, -60, 'without evidence the full cost is still required');
  assert.equal(seq.need, 60);
});

// --- Document read failures --------------------------------------------------
test('document-unavailable: a document read that throws yields no evidence', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: () => { throw new Error('store unreachable'); } }),
    'document-unavailable');
});

test('document-missing: a configured but absent store is unavailable', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: () => null }),
    'document-missing');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: () => Buffer.alloc(0) }),
    'document-missing');
});

test('document-malformed: unparseable or shapeless bytes yield no evidence', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('this is not a settlement document')) }),
    'document-malformed');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('[1,2,3]')) }), 'document-malformed');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from('{"schema":"atlas-planned-obligation-settlements/v1"}')) }),
    'document-malformed');
});

// --- Pin/document disagreement: never evidence, never silent resumption ----
test('household-mismatch: a document for another household never qualifies', async () => {
  const foreign = docWith([linkCmd({})], otherHousehold);
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(foreign) }, readDocument: reader(foreign) }),
    'household-mismatch');
});

test('revision-mismatch: a document behind the pin is not the pinned revision', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc2) }, readDocument: reader(doc1) }),
    'revision-mismatch');
});

test('document-ahead-of-pin: a newer document is never served or promoted', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(doc2) }),
    'document-ahead-of-pin');
});

test('document-ahead-of-pin: an unpinned candidate operation stays unresolved', async () => {
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
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(genesis) },
      readDocument: reader(candidate.document) }), 'document-ahead-of-pin');
});

test('digest-mismatch: same revision, different digest — altered or forked', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(docFork) }),
    'digest-mismatch');
});

test('fork: of two documents at the pin revision, only the pinned one qualifies', async () => {
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(docFork) }, readDocument: reader(docFork) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(docFork)));
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(docFork) }, readDocument: reader(doc1) }),
    'digest-mismatch');
});

test('document-invalid: tampered content under a stale embedded digest fails verification', async () => {
  // The embedded digest field still matches the pin, so staging passes;
  // the contract's own digest/replay verification must refuse the bytes.
  const tampered = Buffer.from(
    doc1.toString('utf8').replace('"assignedCents":2500', '"assignedCents":2000'));
  assert.notEqual(tampered.toString('utf8'), doc1.toString('utf8'),
    'the tamper changed the bytes');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: reader(tampered) }),
    'document-invalid');
});

test('document-invalid: replayed-invalid history fails contract verification', async () => {
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
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: { revision: 2, digest: JSON.parse(body.toString('utf8')).digest } },
      readDocument: reader(body) }), 'document-invalid');
});

// --- Read consistency ---------------------------------------------------------
test('document-changed: bytes that move between verification and projection', async () => {
  let calls = 0;
  const unstable = () => (++calls === 1 ? doc1 : docFork);
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: unstable }),
    'document-changed');
});

test('document-changed: a stability re-read that throws is not qualified', async () => {
  let calls = 0;
  const flaky = () => { if (++calls === 1) return doc1; throw new Error('store moved'); };
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: flaky }),
    'document-changed');
});

// --- Snapshot ownership -------------------------------------------------------
// Repair round (Systems Review B2 on head 3b71036f): the byte snapshot the
// loader verifies and projects from must be its own copy. A caller-owned
// Buffer mutated in place between the two reads — same length, embedded
// digest left stale — must not compare equal to itself and qualify on a
// changed, now-invalid document.
test('document-changed: in-place mutation of a shared Buffer between reads', async () => {
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
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: mutating }),
    'document-changed');
});

test('snapshot controls: stable Buffer and Uint8Array readers still qualify', async () => {
  const fromBuffer = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(Buffer.from(doc1)) }));
  assert.deepEqual(fromBuffer, C.effectiveEvidence(stateOf(doc1)));
  const fromArray = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) },
      readDocument: reader(new Uint8Array(doc1)) }));
  assert.deepEqual(fromArray, C.effectiveEvidence(stateOf(doc1)));
});

// --- Async readers: Promise-returning read callbacks --------------------------
// The production storage adapters' read methods are async, so a reader
// may return a Promise of its value. These pins cover the timing axis
// only: same outcomes, same protocols — plus the ownership defence the
// new suspension points require (a value is snapshotted at acquisition,
// before any suspension can let its owner move it).

test('async readers: Promise-returning readers qualify with exact invocation counts', async () => {
  let pinCalls = 0; let docCalls = 0;
  const evidence = expectQualified(await L.loadSettlementEvidence({
    config: { householdId },
    readPin: async () => { pinCalls += 1; return pinOf(doc1); },
    readDocument: async () => { docCalls += 1; return doc1; },
  }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.equal(pinCalls, 1, 'the pin is acquired exactly once');
  assert.equal(docCalls, 2, 'the document is acquired exactly twice (verify + stability)');
});

test('async readers: mixed timing qualifies — async document with static pin, sync document with async pin', async () => {
  const fromAsyncDoc = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: async () => doc1 }));
  assert.deepEqual(fromAsyncDoc, C.effectiveEvidence(stateOf(doc1)));
  const fromAsyncPin = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: async () => pinOf(doc1),
      readDocument: reader(doc1) }));
  assert.deepEqual(fromAsyncPin, C.effectiveEvidence(stateOf(doc1)));
});

test('async rejection taxonomy: a rejected read classifies exactly like a throwing read, by position', async () => {
  const boom = () => Promise.reject(new Error('backing store unreachable'));
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: boom, readDocument: reader(doc1) }),
    'pin-unavailable');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: boom }),
    'document-unavailable');
  let calls = 0;
  const rejectSecond = async () => {
    calls += 1;
    if (calls === 2) throw new Error('store moved');
    return doc1;
  };
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: rejectSecond }),
    'document-changed');
});

test('async absence: a document read resolving null is document-missing, a pin read resolving null is pin-invalid', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: async () => null }),
    'document-missing');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: async () => null, readDocument: reader(doc1) }),
    'pin-invalid');
});

test('async rejections: no rejection escapes the loader as an unhandled rejection', async () => {
  const escaped = [];
  const guard = reason => { escaped.push(String(reason && reason.message || reason)); };
  process.on('unhandledRejection', guard);
  try {
    const boom = () => Promise.reject(new Error('backing store unreachable'));
    expectUnavailable(await L.loadSettlementEvidence(
      { config: { householdId }, readPin: boom, readDocument: reader(doc1) }),
      'pin-unavailable');
    expectUnavailable(await L.loadSettlementEvidence(
      { config: { householdId, pin: pinOf(doc1) }, readDocument: boom }),
      'document-unavailable');
    // Let any dropped Promise settle: none may surface here.
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(escaped, [], 'every rejection was classified, none dropped');
  } finally {
    process.removeListener('unhandledRejection', guard);
  }
});

test('pin coherence: an async pin against a moved document lands in the mismatch family', async () => {
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: async () => pinOf(doc2),
      readDocument: reader(doc1) }), 'revision-mismatch');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: async () => pinOf(doc1),
      readDocument: reader(doc2) }), 'document-ahead-of-pin');
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: async () => pinOf(docFork),
      readDocument: reader(doc1) }), 'digest-mismatch');
});

test('document-changed: in-place mutation of a reused Buffer across the await gap', async () => {
  // Async twin of the synchronous snapshot pin: the reader hands back
  // the same caller-owned Buffer on both reads and mutates it in place
  // before the second return. The first acquisition is the loader's own
  // copy, so the move is seen.
  const shared = Buffer.from(doc1);
  let calls = 0;
  const mutating = async () => {
    calls += 1;
    if (calls === 2) {
      shared.write(shared.toString('utf8')
        .replace('"assignedCents":2500', '"assignedCents":2000'), 0, 'utf8');
    }
    return shared;
  };
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: mutating }),
    'document-changed');
});

test('document-changed: mutation landing while the first async read settles still meets an owned snapshot', async () => {
  // The mutation is scheduled on a later turn than the first read's
  // return; the loader's snapshot is bound to the acquisition, so the
  // second read observes the move and the pair disagrees.
  const shared = Buffer.from(doc1);
  let calls = 0;
  const readerFn = async () => {
    calls += 1;
    if (calls === 1) {
      setImmediate(() => {
        shared.write(shared.toString('utf8')
          .replace('"assignedCents":2500', '"assignedCents":2000'), 0, 'utf8');
      });
      return shared;
    }
    await new Promise(resolve => setImmediate(resolve));
    return shared;
  };
  expectUnavailable(await L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: readerFn }),
    'document-changed');
});

test('ownership: caller mutation after the call cannot move a synchronous acquisition', async () => {
  // The load is invoked but not yet awaited: the caller mutates the
  // shared document Buffer in place. The first read was already
  // snapshotted in the invocation turn, so the stability re-read sees
  // the move — the outcome is document-changed, never a qualification
  // over bytes that were never the pinned ones.
  const shared = Buffer.from(doc1);
  const pending = L.loadSettlementEvidence(
    { config: { householdId, pin: pinOf(doc1) }, readDocument: () => shared });
  shared.write(shared.toString('utf8')
    .replace('"assignedCents":2500', '"assignedCents":2000'), 0, 'utf8');
  expectUnavailable(await pending, 'document-changed');
});

test('ownership: caller mutation after the call cannot move a synchronous pin record or the static pin', async () => {
  // Live pin source: the record object the reader returns is
  // snapshotted to its scalar pair at acquisition; mutating the caller's object
  // afterwards cannot change the pin this load verifies against.
  const livePin = pinOf(doc1);
  const pendingLive = L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => livePin, readDocument: reader(doc1) });
  livePin.digest = pinOf(docFork).digest;
  assert.deepEqual(expectQualified(await pendingLive),
    C.effectiveEvidence(stateOf(doc1)));
  // Static pin: snapshotted in the synchronous prologue, before the
  // first suspension (the document acquisition) can interleave.
  const staticPin = pinOf(doc1);
  const pendingStatic = L.loadSettlementEvidence(
    { config: { householdId, pin: staticPin }, readDocument: reader(doc1) });
  staticPin.digest = pinOf(docFork).digest;
  assert.deepEqual(expectQualified(await pendingStatic),
    C.effectiveEvidence(stateOf(doc1)));
});

test('ownership: bytes mutated during the pin suspension are judged as acquired, never pre-snapshotted', async () => {
  // While the pin read is suspended, the caller's document bytes are
  // tampered with (embedded digest left stale). The document read has
  // not happened yet, so the loader must acquire and judge the bytes as
  // they now stand: contract verification refuses them.
  const shared = Buffer.from(doc1);
  let resolvePin;
  const pinPromise = new Promise(resolve => { resolvePin = resolve; });
  const pending = L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => pinPromise, readDocument: () => shared });
  shared.write(shared.toString('utf8')
    .replace('"assignedCents":2500', '"assignedCents":2000'), 0, 'utf8');
  resolvePin(pinOf(doc1));
  expectUnavailable(await pending, 'document-invalid');
});

// --- Pin snapshot integrity: foreign records never cross the boundary --------
// The pin snapshot is the load-bearing scalar pair, extracted at
// acquisition from the SELECTED source only. Three properties: a
// foreign record's `then` is never invoked (Promise resolution must
// not assimilate the snapshot — running foreign code, substituting a
// pin, or hanging the load); only revision/digest are read, by direct
// access (non-enumerable fields are honoured, unrelated getters never
// fire); and an unselected static fallback is never observed at all.

test('pin snapshot: a thenable pin record is judged by its scalar pair — its then is never invoked', async () => {
  let thenCalls = 0;
  const counting = {
    ...pinOf(doc1),
    then(resolve) { thenCalls += 1; resolve(pinOf(doc1)); },
  };
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => counting, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.equal(thenCalls, 0, 'the record then was never invoked');
});

test('pin snapshot: a then that would substitute a different pin changes nothing', async () => {
  let thenCalls = 0;
  const substituting = {
    ...pinOf(doc1),
    then(resolve) { thenCalls += 1; resolve(pinOf(doc2)); },
  };
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => substituting, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)),
    'the load is governed by the record scalar pair, not by its then');
  assert.equal(thenCalls, 0, 'the record then was never invoked');
});

test('pin snapshot: a then that never settles cannot hang the load', { timeout: 5000 }, async () => {
  const hanging = { ...pinOf(doc1), then() { /* never calls back */ } };
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => hanging, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

test('pin snapshot: a thenable STATIC pin is likewise judged by its scalar pair', async () => {
  let thenCalls = 0;
  const counting = {
    ...pinOf(doc1),
    then(resolve) { thenCalls += 1; resolve(pinOf(doc2)); },
  };
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: counting }, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.equal(thenCalls, 0, 'the static record then was never invoked');
});

test('pin snapshot: non-enumerable revision/digest qualify exactly as their enumerable twin', async () => {
  const pair = pinOf(doc1);
  const hidden = {};
  Object.defineProperties(hidden, {
    revision: { value: pair.revision },
    digest: { value: pair.digest },
  });
  const fromLive = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => hidden, readDocument: reader(doc1) }));
  assert.deepEqual(fromLive, C.effectiveEvidence(stateOf(doc1)));
  const fromStatic = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: hidden }, readDocument: reader(doc1) }));
  assert.deepEqual(fromStatic, C.effectiveEvidence(stateOf(doc1)));
});

test('pin snapshot: unrelated properties are never read — a counting getter stays at zero', async () => {
  let unrelatedReads = 0;
  const pin = { ...pinOf(doc1) };
  Object.defineProperty(pin, 'unrelated', {
    enumerable: true,
    get() { unrelatedReads += 1; return 'must not be read'; },
  });
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId }, readPin: () => pin, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.equal(unrelatedReads, 0, 'the snapshot reads revision and digest only');
});

test('pin snapshot: a throwing unrelated getter on the static pin cannot break the load', async () => {
  const pin = { ...pinOf(doc1) };
  Object.defineProperty(pin, 'unrelated', {
    enumerable: true,
    get() { throw new Error('unrelated getter must not fire'); },
  });
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin }, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
});

test('pin snapshot: a hostile UNUSED static fallback is never observed when readPin is supplied', async () => {
  let observed = 0;
  const hostile = {};
  for (const key of ['revision', 'digest', 'unrelated']) {
    Object.defineProperty(hostile, key, {
      enumerable: true,
      get() { observed += 1; throw new Error('unused fallback must not be observed'); },
    });
  }
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin: hostile }, readPin: () => pinOf(doc1),
      readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)),
    'the live pin source governs; the static value is never a fallback read');
  assert.equal(observed, 0, 'the unselected static pin was never read');
});

test('pin snapshot: the static source obeys the same scalar rules when it is the selected source', async () => {
  const pair = pinOf(doc1);
  let unrelatedReads = 0;
  const pin = {};
  Object.defineProperties(pin, {
    revision: { value: pair.revision },
    digest: { value: pair.digest },
    unrelated: { enumerable: true, get() { unrelatedReads += 1; return 'x'; } },
  });
  const evidence = expectQualified(await L.loadSettlementEvidence(
    { config: { householdId, pin }, readDocument: reader(doc1) }));
  assert.deepEqual(evidence, C.effectiveEvidence(stateOf(doc1)));
  assert.equal(unrelatedReads, 0, 'the snapshot reads revision and digest only');
});

// --- Reason coverage ------------------------------------------------------------
test('coverage: every enumerated unavailable reason was exercised above', async () => {
  assert.deepEqual([...seenReasons].sort(), [...L.REASONS].sort(),
    'the suite pins each reason code the module enumerates');
});
