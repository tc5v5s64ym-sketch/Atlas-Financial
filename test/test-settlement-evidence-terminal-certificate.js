'use strict';

// ATLAS-080 / B3 FOUNDATION — NOT COMPLETION. Synthetic protocol proof for
// the private terminal-certificate module. No production consumer exists:
// nothing in the repository imports the module, and this suite is its only
// caller.
//
// INJECTED TRANSPORT ASSUMPTION — STATED EXPLICITLY: the tests in this
// suite MODEL an atomic compare-and-seal transport. The in-memory fence
// below performs every transition (seal, admission reservation, commit
// landing, release) as a check-and-set without an intervening await,
// which makes those transitions atomic inside this single-threaded test
// process and lets several protocol instances share one modelled
// transport state. That is a MODELLED guarantee only. The foundation
// module alone does NOT fence the incumbent settlement store or
// confirmation controller — no production admission path consults it, so
// the cross-controller failure executed as acceptance case B3A-27c
// remains possible in the shipped composition until a later integration
// wires this protocol into admission — and nothing in this suite
// qualifies production durability, a real durable transport, storage, or
// activation.
//
// Repair history: the first head of this slice was BLOCKED in Systems
// Review for an admission/seal race (a suspended commit callback landing
// after a seal), a wrong-operation proof, undefined reads treated as
// absence, and unresolved callback outcomes wrapped as committed. The
// contract therefore changed: admission is an atomic transport
// reservation, the commit landing is a transport transition keyed by the
// reservation nonce (no caller write callback exists), reads validate
// contextual identity, undefined is a contract violation, and commit
// outcomes carry exact settlement semantics. Each blocker has a named
// regression test below.
// The second head was BLOCKED again (source-only review): a ticket
// copied and relabelled to another actor could spend the original
// actor's reservation (the transport checked only the nonce); caller
// inputs could be mutated during a suspended read, changing validated
// values or retargeting the commit; and a seal answer naming a different
// operation surfaced as already-sealed. Repairs: the transport binds the
// reservation's own recorded identity (operation + actor + nonce)
// atomically, caller inputs are snapshotted before any await, and seal
// answers are bound to the requested operation in every branch.
// AMENDED EXPECTATION (C3 disposition): admission over malformed or
// unknown persistence is `unknown`, never an actionable ticket — a
// read-integrity gate qualifies state before the atomic reservation,
// which remains the fence.
// AMENDED EXPECTATION (C7 disposition): the reservation-versus-seal
// refusal is an intentional exclusion change from the original contract.
// An abandoned or crashed reservation HOLDs its operation fail-closed;
// this protocol provides no expiry, TTL, automatic retry or third-party
// release, and never silently releases an unknown in-flight reservation.
// A qualified recovery lifecycle for abandoned reservations needs a
// wider dependency contract and is a KNOWN LIMIT of this foundation,
// pinned behaviourally below (the hold) rather than hidden.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createTerminalCertificateProtocol,
  TERMINAL_CERTIFICATE_SCHEMA,
} = require('../scripts/settlement-evidence-terminal-certificate');

const householdId = 'household-' + 'a'.repeat(32);
const actorA = 'session-' + 'b'.repeat(64);
const actorB = 'session-' + 'c'.repeat(64);
const generationA = 'generation-' + 'd'.repeat(32);
const generationB = 'generation-' + 'e'.repeat(32);
const digest = ch => ch.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');

function claimFor(operationId, overrides = {}) {
  return {
    householdId,
    operationId,
    actorId: actorA,
    kind: 'link',
    generation: generationA,
    reason: 'admission-refused',
    expectedRevision: 3,
    expectedDocumentDigest: digest('a'),
    confirmationDigest: digest('f'),
    decidedAt: 1000,
    ...overrides,
  };
}

function committedRecordFor(operationId, actorId = actorA, overrides = {}) {
  return {
    status: 'committed',
    operationId,
    actorId,
    revision: 4,
    documentDigest: digest('a'),
    ...overrides,
  };
}

// One modelled transport state. Several fences (and therefore several
// protocol instances, including "restarted" and "second controller"
// instances) can be facades over the same state, exactly as the protocol
// contract assumes a shared durable transport beneath them.
function makeTransportState() {
  return { seals: new Map(), committed: new Map(), reservations: new Map() };
}

function makeFence(state) {
  return {
    atomicSeal: true,
    // Modelled atomic transitions: each check-and-set below completes
    // without an intervening await, which is what makes it atomic in
    // this model. A production transport would have to provide the same
    // transitions atomically at the durable layer; this model does not
    // provide or qualify one.
    async seal(operationId, record) {
      if (state.seals.has(operationId)) {
        return { sealed: false, existing: state.seals.get(operationId) };
      }
      if (state.committed.has(operationId)) {
        return { sealed: false, existing: null, blocked: 'committed' };
      }
      if (state.reservations.has(operationId)) {
        return { sealed: false, existing: null, blocked: 'admission-reserved' };
      }
      state.seals.set(operationId, record);
      return { sealed: true, record };
    },
    async reserveAdmission(operationId, reservation) {
      if (state.seals.has(operationId)) return { reserved: false, reason: 'sealed' };
      if (state.committed.has(operationId)) return { reserved: false, reason: 'committed' };
      if (state.reservations.has(operationId)) return { reserved: false, reason: 'reserved' };
      state.reservations.set(operationId, reservation);
      return { reserved: true };
    },
    async commitReservation(operationId, nonce, record) {
      const held = state.reservations.get(operationId);
      if (!held || held.nonce !== nonce) return { committed: false, reason: 'reservation-lost' };
      // The reservation's OWN recorded identity is authoritative — a
      // caller-presented ticket relabelled to another actor, or a record
      // naming another actor, cannot spend this reservation.
      if (held.operationId !== operationId || held.actorId !== record.actorId) {
        return { committed: false, reason: 'identity-mismatch' };
      }
      if (state.seals.has(operationId)) return { committed: false, reason: 'sealed' };
      state.reservations.delete(operationId);
      state.committed.set(operationId, record);
      return { committed: true, operationId };
    },
    async releaseAdmission(operationId, nonce) {
      const held = state.reservations.get(operationId);
      if (!held || held.nonce !== nonce) return { released: false };
      state.reservations.delete(operationId);
      return { released: true };
    },
    async readSeal(operationId) {
      return state.seals.has(operationId) ? state.seals.get(operationId) : null;
    },
    async readCommitted(operationId) {
      return state.committed.has(operationId) ? state.committed.get(operationId) : null;
    },
  };
}

function makeProtocol(state) {
  return createTerminalCertificateProtocol({ fence: makeFence(state) });
}

const UNKNOWN_FOR = operationId => ({ status: 'unknown', operationId });

test('no-dependency and non-honouring constructions are inert', async () => {
  const state = makeTransportState();
  const good = makeFence(state);
  const without = key => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
  const constructions = [
    () => createTerminalCertificateProtocol(),
    () => createTerminalCertificateProtocol({}),
    () => createTerminalCertificateProtocol({ fence: null }),
    () => createTerminalCertificateProtocol({ fence: { atomicSeal: true } }),
    () => createTerminalCertificateProtocol({ fence: { ...good, atomicSeal: false } }),
    () => createTerminalCertificateProtocol({ fence: without('seal') }),
    () => createTerminalCertificateProtocol({ fence: without('reserveAdmission') }),
    () => createTerminalCertificateProtocol({ fence: without('commitReservation') }),
    () => createTerminalCertificateProtocol({ fence: without('releaseAdmission') }),
    () => createTerminalCertificateProtocol({ fence: without('readSeal') }),
    () => createTerminalCertificateProtocol({ fence: without('readCommitted') }),
  ];
  for (const construct of constructions) {
    const protocol = construct();
    assert.equal(protocol.connected, false);
    const operationId = op(1);
    assert.deepEqual(await protocol.sealNegative(claimFor(operationId)), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.lookupCertificate(operationId, actorA), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.admissionState(operationId), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.beginAdmission(operationId, actorA), UNKNOWN_FOR(operationId));
    assert.deepEqual(
      await protocol.commitAdmission(
        { operationId, actorId: actorA, nonce: 'n' },
        committedRecordFor(operationId),
      ),
      UNKNOWN_FOR(operationId),
    );
    assert.deepEqual(
      await protocol.releaseAdmission({ operationId, actorId: actorA, nonce: 'n' }),
      UNKNOWN_FOR(operationId),
    );
  }
  assert.equal(state.seals.size, 0, 'an inert protocol seals nothing');
  assert.equal(state.reservations.size, 0, 'an inert protocol reserves nothing');
});

test('a landed seal issues the certificate and the actor-private recovery read', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  assert.equal(protocol.connected, true);
  const operationId = op(2);
  const result = await protocol.sealNegative(claimFor(operationId));
  assert.equal(result.status, 'certified');
  assert.equal(result.operationId, operationId);
  assert.deepEqual(
    Object.keys(result.certificate).sort(),
    [
      'actorId', 'confirmationDigest', 'decidedAt', 'expectedDocumentDigest',
      'expectedRevision', 'generation', 'householdId', 'kind', 'operationId',
      'reason', 'schema',
    ],
    'the certificate carries exactly the frozen record keys — no preview token, no amounts',
  );
  assert.equal(result.certificate.schema, TERMINAL_CERTIFICATE_SCHEMA);
  assert.ok(Object.isFrozen(result.certificate));
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorA),
    { status: 'not-applied', operationId, generation: generationA },
    'the recovery read is exactly the three-field shape',
  );
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorB),
    UNKNOWN_FOR(operationId),
    'any other actor receives unknown — the seal is not even acknowledged',
  );
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorA, { generation: generationA }),
    { status: 'not-applied', operationId, generation: generationA },
  );
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorA, { generation: generationB }),
    UNKNOWN_FOR(operationId),
    'the recovery read is generation-exact when a generation is supplied',
  );
  assert.deepEqual(await protocol.admissionState(operationId), { status: 'sealed', operationId });
});

test('collision: two competing seals produce exactly one winner', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(3);
  const claimWinner = claimFor(operationId);
  const claimLoser = claimFor(operationId, {
    actorId: actorB,
    generation: generationB,
    confirmationDigest: digest('b'),
  });
  const results = await Promise.all([
    protocol.sealNegative(claimWinner),
    protocol.sealNegative(claimLoser),
  ]);
  const certified = results.filter(r => r.status === 'certified');
  const refused = results.filter(r => r.status === 'refused');
  assert.equal(certified.length, 1, 'exactly one competing seal wins');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0], { status: 'refused', operationId, reason: 'already-sealed' });
  assert.equal(state.seals.size, 1);
  const winnerActor = certified[0].certificate.actorId;
  const loserActor = winnerActor === actorA ? actorB : actorA;
  assert.equal((await protocol.lookupCertificate(operationId, winnerActor)).status, 'not-applied');
  assert.deepEqual(await protocol.lookupCertificate(operationId, loserActor), UNKNOWN_FOR(operationId));
});

test('an identical re-seal is the same decision, not a collision', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(4);
  const first = await protocol.sealNegative(claimFor(operationId));
  const second = await protocol.sealNegative(claimFor(operationId, { decidedAt: 1001 }));
  assert.equal(first.status, 'certified');
  assert.equal(second.status, 'certified');
  assert.deepEqual(second.certificate, first.certificate);
  assert.equal(state.seals.size, 1);
});

test('a lost seal acknowledgement may have landed and never reopens admission', async () => {
  const state = makeTransportState();
  const base = makeFence(state);
  const lostAckFence = {
    ...base,
    async seal(operationId, record) {
      const outcome = await base.seal(operationId, record);
      if (outcome.sealed) throw new Error('synthetic acknowledgement loss after the seal landed');
      return outcome;
    },
  };
  const protocol = createTerminalCertificateProtocol({ fence: lostAckFence });
  const operationId = op(5);
  assert.deepEqual(
    await protocol.sealNegative(claimFor(operationId)),
    UNKNOWN_FOR(operationId),
    'a lost acknowledgement is ambiguous at the caller — never a certificate, never not-applied',
  );
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorA),
    { status: 'not-applied', operationId, generation: generationA },
    'the landed seal is resolved by reading state',
  );
  assert.deepEqual(
    await protocol.beginAdmission(operationId, actorA),
    { status: 'refused', operationId, reason: 'operation-sealed' },
    'admission stays closed after a lost acknowledgement',
  );
  assert.deepEqual(
    await protocol.sealNegative(claimFor(operationId, { actorId: actorB, generation: generationB })),
    { status: 'refused', operationId, reason: 'already-sealed' },
    'a competing decision after a lost acknowledgement is refused, not admitted',
  );
});

test('a seal that fails before landing leaves the operation open and undecided', async () => {
  const state = makeTransportState();
  const base = makeFence(state);
  const failingFence = {
    ...base,
    async seal() { throw new Error('synthetic transport failure before landing'); },
  };
  const protocol = createTerminalCertificateProtocol({ fence: failingFence });
  const operationId = op(6);
  assert.deepEqual(await protocol.sealNegative(claimFor(operationId)), UNKNOWN_FOR(operationId));
  assert.deepEqual(await protocol.lookupCertificate(operationId, actorA), UNKNOWN_FOR(operationId));
  assert.deepEqual(await protocol.admissionState(operationId), { status: 'open', operationId });
  assert.equal((await protocol.beginAdmission(operationId, actorA)).status, 'admitted');
  assert.equal(state.seals.size, 0);
});

test('unreadable persistence resolves to unknown and never invokes a transition', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(7);
  const begun = await protocol.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  const base = makeFence(state);
  let commitCalls = 0;
  let sealCalls = 0;
  const unreadable = createTerminalCertificateProtocol({
    fence: {
      ...base,
      async readSeal() { throw new Error('synthetic unreadable seal surface'); },
      async seal(...args) { sealCalls++; return base.seal(...args); },
      async commitReservation(...args) { commitCalls++; return base.commitReservation(...args); },
    },
  });
  assert.deepEqual(await unreadable.lookupCertificate(operationId, actorA), UNKNOWN_FOR(operationId));
  assert.deepEqual(await unreadable.admissionState(operationId), UNKNOWN_FOR(operationId));
  assert.deepEqual(await unreadable.sealNegative(claimFor(operationId)), UNKNOWN_FOR(operationId));
  assert.equal(sealCalls, 0, 'the seal transition is never invoked over unreadable state');
  assert.deepEqual(
    await unreadable.commitAdmission(begun.ticket, committedRecordFor(operationId)),
    UNKNOWN_FOR(operationId),
  );
  assert.equal(commitCalls, 0, 'the commit transition is never invoked over unreadable state');
});

test('undefined reads are contract violations, never absence (both boundaries)', async () => {
  for (const boundary of ['readSeal', 'readCommitted']) {
    const state = makeTransportState();
    const good = makeProtocol(state);
    const operationId = op(8);
    const begun = await good.beginAdmission(operationId, actorA);
    assert.equal(begun.status, 'admitted');
    const base = makeFence(state);
    let commitCalls = 0;
    let sealCalls = 0;
    let reserveCalls = 0;
    const violating = createTerminalCertificateProtocol({
      fence: {
        ...base,
        async [boundary]() { return undefined; },
        async seal(...args) { sealCalls++; return base.seal(...args); },
        async reserveAdmission(...args) { reserveCalls++; return base.reserveAdmission(...args); },
        async commitReservation(...args) { commitCalls++; return base.commitReservation(...args); },
      },
    });
    assert.deepEqual(
      await violating.lookupCertificate(operationId, actorA),
      UNKNOWN_FOR(operationId),
      `${boundary}: undefined must not read as an empty surface`,
    );
    assert.deepEqual(
      await violating.beginAdmission(operationId, actorB),
      UNKNOWN_FOR(operationId),
      `${boundary}: admission over unqualified persistence is unknown, never an actionable ticket (C3)`,
    );
    assert.equal(reserveCalls, 0, `${boundary}: no reservation is attempted over a violated read`);
    assert.deepEqual(await violating.admissionState(operationId), UNKNOWN_FOR(operationId), boundary);
    assert.deepEqual(await violating.sealNegative(claimFor(operationId)), UNKNOWN_FOR(operationId), boundary);
    assert.equal(sealCalls, 0, `${boundary}: no seal transition over a violated read`);
    assert.deepEqual(
      await violating.commitAdmission(begun.ticket, committedRecordFor(operationId)),
      UNKNOWN_FOR(operationId),
      `${boundary}: undefined must never let a commit be invoked`,
    );
    assert.equal(commitCalls, 0, boundary);
    // The reservation held through the good protocol is untouched by the
    // violated reads and can still land through the honouring protocol.
    assert.equal(
      (await good.commitAdmission(begun.ticket, committedRecordFor(operationId))).status,
      'committed',
    );
  }
});

test('a record stored under a different operation key proves nothing (wrong-operation proof)', async () => {
  const state = makeTransportState();
  const opA = op(9);
  const opB = op(10);
  // A perfectly valid certificate for operation A, stored under key B.
  state.seals.set(opB, { schema: TERMINAL_CERTIFICATE_SCHEMA, ...claimFor(opA) });
  const protocol = makeProtocol(state);
  assert.deepEqual(
    await protocol.lookupCertificate(opB, actorA),
    UNKNOWN_FOR(opB),
    'contextual identity is validated, not just shape: no proof for the requested operation',
  );
  assert.deepEqual(await protocol.admissionState(opB), UNKNOWN_FOR(opB));
  // And the mirror image: a committed record naming A under key B is
  // divergent for B as well.
  const state2 = makeTransportState();
  state2.committed.set(opB, committedRecordFor(opA));
  const protocol2 = makeProtocol(state2);
  assert.deepEqual(await protocol2.admissionState(opB), UNKNOWN_FOR(opB));
  assert.deepEqual(await protocol2.lookupCertificate(opB, actorA), UNKNOWN_FOR(opB));
});

test('divergent stored records read as unknown, one corruption at a time', async () => {
  const good = claimFor(op(11));
  const record = { schema: TERMINAL_CERTIFICATE_SCHEMA, ...good };
  const corruptions = {
    'wrong schema': { ...record, schema: 'terminal-certificate-2' },
    'extra key': { ...record, previewToken: 'must-never-be-stored' },
    'missing key': (({ reason, ...rest }) => rest)(record),
    'actor format': { ...record, actorId: 'session-short' },
    'generation empty': { ...record, generation: '' },
    'reason outside enum': { ...record, reason: 'some-other-reason' },
    'negative revision': { ...record, expectedRevision: -1 },
    'digest format': { ...record, confirmationDigest: 'not-a-digest' },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    const state = makeTransportState();
    state.seals.set(op(11), corrupt);
    const protocol = makeProtocol(state);
    assert.deepEqual(
      await protocol.lookupCertificate(op(11), actorA),
      UNKNOWN_FOR(op(11)),
      `corruption "${name}" must read unknown, never not-applied`,
    );
    assert.deepEqual(await protocol.admissionState(op(11)), UNKNOWN_FOR(op(11)), `corruption "${name}"`);
  }
});

test('committed and negative coexistence is an explicit conflict refusal, never precedence', async () => {
  // Committed first: the negative seal is refused and nothing is sealed.
  const stateA = makeTransportState();
  const operationA = op(12);
  stateA.committed.set(operationA, committedRecordFor(operationA));
  const protocolA = makeProtocol(stateA);
  assert.deepEqual(
    await protocolA.sealNegative(claimFor(operationA)),
    { status: 'conflict', operationId: operationA, reason: 'committed-coexists' },
  );
  assert.equal(stateA.seals.size, 0, 'no negative certificate is written over a committed record');
  assert.deepEqual(
    await protocolA.admissionState(operationA),
    { status: 'sealed', operationId: operationA },
    'a committed operationId is terminal too: admission stays closed',
  );

  // Seal first, committed record appears anyway (test-only placement of
  // the impossible pair): the read surfaces the invariant violation
  // instead of silently serving either side.
  const stateB = makeTransportState();
  const operationB = op(13);
  const protocolB = makeProtocol(stateB);
  assert.equal((await protocolB.sealNegative(claimFor(operationB))).status, 'certified');
  stateB.committed.set(operationB, committedRecordFor(operationB));
  assert.deepEqual(
    await protocolB.lookupCertificate(operationB, actorA),
    { status: 'conflict', operationId: operationB, reason: 'committed-coexists' },
    'coexistence is surfaced as an incident, not resolved by precedence',
  );
  assert.deepEqual(
    await protocolB.lookupCertificate(operationB, actorB),
    UNKNOWN_FOR(operationB),
    'the conflict is not leaked to another actor',
  );
});

test('restart: a fresh protocol instance over the same transport keeps the seal', async () => {
  const state = makeTransportState();
  const before = makeProtocol(state);
  const operationId = op(14);
  assert.equal((await before.sealNegative(claimFor(operationId))).status, 'certified');
  // A restart is a fresh instance with fresh in-process state over the
  // same modelled transport state — the seal must survive it there.
  const after = makeProtocol(state);
  assert.deepEqual(
    await after.lookupCertificate(operationId, actorA),
    { status: 'not-applied', operationId, generation: generationA },
  );
  assert.deepEqual(
    await after.beginAdmission(operationId, actorA),
    { status: 'refused', operationId, reason: 'operation-sealed' },
    'a sealed operationId is never reusable across a restart',
  );
  const fresh = op(15);
  assert.equal((await after.beginAdmission(fresh, actorA)).status, 'admitted');
});

test('cross-controller and cross-actor exclusion with both controllers live', async () => {
  const state = makeTransportState();
  const controller1 = makeProtocol(state);
  const controller2 = makeProtocol(state);
  const operationId = op(16);
  assert.equal((await controller1.sealNegative(claimFor(operationId))).status, 'certified');
  // The B3A-27c lesson: a second live controller must be fenced by the
  // first controller's seal even though it shares no process state with
  // it — the fence is the shared transport, not actor/generation keying.
  assert.deepEqual(
    await controller2.beginAdmission(operationId, actorB),
    { status: 'refused', operationId, reason: 'operation-sealed' },
  );
  assert.deepEqual(
    await controller2.sealNegative(claimFor(operationId, {
      actorId: actorB, generation: generationB, confirmationDigest: digest('b'),
    })),
    { status: 'refused', operationId, reason: 'already-sealed' },
  );
  assert.deepEqual(await controller2.lookupCertificate(operationId, actorB), UNKNOWN_FOR(operationId));
  const fresh = op(17);
  const begun = await controller2.beginAdmission(fresh, actorB);
  assert.equal(begun.status, 'admitted', 'a different operationId is never fenced by this seal');
  const committed = await controller2.commitAdmission(begun.ticket, committedRecordFor(fresh, actorB));
  assert.equal(committed.status, 'committed');
  assert.deepEqual(state.committed.get(fresh), committedRecordFor(fresh, actorB));
});

test('admission reservation and seal exclude each other atomically (admission/seal race)', async () => {
  const state = makeTransportState();
  const p1 = makeProtocol(state);
  const p2 = makeProtocol(state);
  const operationId = op(18);
  // The admission reserves first. While the reservation is live — the
  // window in which the old design's suspended commit callback could be
  // overtaken — a seal from another live instance CANNOT land: there is
  // no caller-code window between an admission check and its commit,
  // because the commit lands through the same atomic transport.
  const begun = await p1.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  assert.deepEqual(
    await p2.sealNegative(claimFor(operationId)),
    { status: 'refused', operationId, reason: 'admission-reserved' },
    'no certificate is issued while an admission reservation is live',
  );
  assert.equal(state.seals.size, 0);
  const committed = await p1.commitAdmission(begun.ticket, committedRecordFor(operationId));
  assert.equal(committed.status, 'committed');
  assert.deepEqual(
    await p2.sealNegative(claimFor(operationId)),
    { status: 'conflict', operationId, reason: 'committed-coexists' },
    'after the commit lands, the negative decision is a conflict, not a seal',
  );

  // The mirror race: the seal lands first; admission is refused and even
  // a fabricated ticket cannot land a commit.
  const sealedFirst = op(19);
  assert.equal((await p1.sealNegative(claimFor(sealedFirst))).status, 'certified');
  assert.deepEqual(
    await p2.beginAdmission(sealedFirst, actorB),
    { status: 'refused', operationId: sealedFirst, reason: 'operation-sealed' },
  );
  const fabricated = { operationId: sealedFirst, actorId: actorB, nonce: 'forged' };
  assert.deepEqual(
    await p2.commitAdmission(fabricated, committedRecordFor(sealedFirst, actorB)),
    { status: 'refused', operationId: sealedFirst, reason: 'reservation-lost' },
  );
  assert.equal(state.committed.has(sealedFirst), false);
});

test('competing admissions: exactly one reservation wins; release frees the operation', async () => {
  const state = makeTransportState();
  const p1 = makeProtocol(state);
  const p2 = makeProtocol(state);
  const operationId = op(20);
  const [first, second] = await Promise.all([
    p1.beginAdmission(operationId, actorA),
    p2.beginAdmission(operationId, actorB),
  ]);
  const admitted = [first, second].filter(r => r.status === 'admitted');
  const refused = [first, second].filter(r => r.status === 'refused');
  assert.equal(admitted.length, 1, 'exactly one competing admission reserves the operation');
  assert.equal(refused.length, 1);
  assert.deepEqual(refused[0], { status: 'refused', operationId, reason: 'operation-reserved' });
  const winner = admitted[0].ticket.actorId === actorA ? p1 : p2;
  const winnerTicket = admitted[0].ticket;
  // Release: the reservation clears, the released ticket can no longer
  // commit, and the operation can then be sealed.
  assert.deepEqual(
    await winner.releaseAdmission(winnerTicket),
    { status: 'released', operationId },
  );
  assert.deepEqual(
    await winner.commitAdmission(winnerTicket, committedRecordFor(operationId, winnerTicket.actorId)),
    { status: 'refused', operationId, reason: 'reservation-lost' },
  );
  assert.equal((await p1.sealNegative(claimFor(operationId))).status, 'certified');
  assert.deepEqual(
    await winner.releaseAdmission(winnerTicket),
    { status: 'refused', operationId, reason: 'reservation-lost' },
    'a consumed or released reservation cannot be released twice',
  );
});

test('a relabelled ticket cannot spend another actor\u2019s reservation (actor-relabelling repair)', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(31);
  const begun = await protocol.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  // Copy A's issued ticket, relabel the actor to B, and supply B's own
  // committed record: every caller-presented claim is consistent, so only
  // the transport's recorded reservation identity can refuse it — and it
  // must, because the reservation belongs to A.
  const relabelled = { ...begun.ticket, actorId: actorB };
  assert.deepEqual(
    await protocol.commitAdmission(relabelled, committedRecordFor(operationId, actorB)),
    { status: 'refused', operationId, reason: 'identity-mismatch' },
  );
  assert.equal(state.committed.size, 0, 'nothing landed under the relabelled ticket');
  // The refusal does not consume A's reservation: A's own commit, with
  // A's own record, still lands.
  const committed = await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId, actorA));
  assert.equal(committed.status, 'committed');
  assert.deepEqual(state.committed.get(operationId), committedRecordFor(operationId, actorA));
});

test('caller inputs are snapshotted before any await (mutation-across-await repair)', async () => {
  // (a) Mutating the outcome during the suspended integrity read —
  // changing a validated revision and adding a forbidden field — changes
  // nothing: the persisted record is exactly the validated snapshot.
  const state = makeTransportState();
  const base = makeFence(state);
  const operationId = op(32);
  const outcome = committedRecordFor(operationId, actorA);
  let armed = false;
  const mutating = createTerminalCertificateProtocol({
    fence: {
      ...base,
      async readCommitted(id) {
        const value = await base.readCommitted(id);
        if (armed) {
          outcome.revision = 999;
          outcome.smuggled = 'forbidden-field';
        }
        return value;
      },
    },
  });
  const begun = await mutating.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  armed = true; // the attack lands during commitAdmission's suspended read
  const committed = await mutating.commitAdmission(begun.ticket, outcome);
  assert.equal(committed.status, 'committed');
  assert.deepEqual(
    state.committed.get(operationId),
    committedRecordFor(operationId, actorA),
    'the stored record is the validated snapshot — revision unchanged, no smuggled field persisted',
  );
  assert.deepEqual(
    Object.keys(state.committed.get(operationId)).sort(),
    ['actorId', 'documentDigest', 'operationId', 'revision', 'status'],
  );

  // (b) Retargeting the ticket during the suspended read — pointing it
  // at a second live reservation — cannot move the commit: dispatch uses
  // the snapshot, so the commit lands on the ORIGINAL operation only,
  // and the second reservation is untouched and still usable.
  const state2 = makeTransportState();
  const base2 = makeFence(state2);
  const op1 = op(33);
  const op2 = op(34);
  const setup = createTerminalCertificateProtocol({ fence: base2 });
  const begun1 = await setup.beginAdmission(op1, actorA);
  const begun2 = await setup.beginAdmission(op2, actorA);
  assert.equal(begun1.status, 'admitted');
  assert.equal(begun2.status, 'admitted');
  const mutableTicket = { ...begun1.ticket };
  const retargeting = createTerminalCertificateProtocol({
    fence: {
      ...base2,
      async readSeal(id) {
        const value = await base2.readSeal(id);
        mutableTicket.operationId = op2;
        mutableTicket.nonce = begun2.ticket.nonce;
        return value;
      },
    },
  });
  const landed = await retargeting.commitAdmission(mutableTicket, committedRecordFor(op1, actorA));
  assert.equal(landed.status, 'committed');
  assert.equal(landed.operationId, op1, 'the commit is reported for the snapshotted operation');
  assert.deepEqual(state2.committed.get(op1), committedRecordFor(op1, actorA));
  assert.equal(state2.committed.has(op2), false, 'nothing landed on the retargeted operation');
  const second = await setup.commitAdmission(begun2.ticket, committedRecordFor(op2, actorA));
  assert.equal(second.status, 'committed', 'the second reservation was never spent or disturbed');
});

test('a seal answer naming a different operation is unknown, never already-sealed (context-hole repair)', async () => {
  const opA = op(35);
  const opB = op(36);
  const recordA = { schema: TERMINAL_CERTIFICATE_SCHEMA, ...claimFor(opA) };
  for (const answer of [
    { sealed: false, existing: recordA },
    { sealed: true, record: recordA },
  ]) {
    const state = makeTransportState();
    const base = makeFence(state);
    const protocol = createTerminalCertificateProtocol({
      fence: { ...base, async seal() { return answer; } },
    });
    assert.deepEqual(
      await protocol.sealNegative(claimFor(opB)),
      UNKNOWN_FOR(opB),
      'contextual identity binds in EVERY seal branch — a valid record for A is not a decision about B',
    );
    assert.equal(state.seals.size, 0);
  }
});

test('an abandoned reservation holds the operation fail-closed (intentional C7 hold)', async () => {
  const state = makeTransportState();
  const p1 = makeProtocol(state);
  const p2 = makeProtocol(state);
  const operationId = op(37);
  const begun = await p1.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  // The holder never commits or releases (crash/abandonment). The hold
  // is fail-closed and indefinite WITHIN this protocol: no expiry, no
  // third-party release, no silent takeover — by design (C7). A
  // qualified recovery lifecycle needs a wider contract and is a known
  // limit of this foundation, not a behaviour hidden here.
  assert.deepEqual(
    await p2.sealNegative(claimFor(operationId)),
    { status: 'refused', operationId, reason: 'admission-reserved' },
  );
  assert.deepEqual(
    await p2.beginAdmission(operationId, actorB),
    { status: 'refused', operationId, reason: 'operation-reserved' },
  );
  assert.deepEqual(
    await p2.releaseAdmission({ operationId, actorId: actorB, nonce: 'not-the-holders-nonce' }),
    { status: 'refused', operationId, reason: 'reservation-lost' },
    'nobody but the reservation holder can release the hold',
  );
  assert.deepEqual(
    await p2.sealNegative(claimFor(operationId)),
    { status: 'refused', operationId, reason: 'admission-reserved' },
    'the hold persists after the failed takeover attempts',
  );
  // Only the holder's own release ends the hold.
  assert.deepEqual(await p1.releaseAdmission(begun.ticket), { status: 'released', operationId });
  assert.equal((await p2.sealNegative(claimFor(operationId))).status, 'certified');
});

test('only a validated committed outcome surfaces as committed (false-committed repair)', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(21);
  // Supplied outcomes propagate as themselves and never reach the
  // transport: unknown stays unknown, any refusal stays a refusal, and a
  // malformed committed claim is ambiguous — none is wrapped as committed.
  const begun = await protocol.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, { status: 'unknown', operationId }),
    UNKNOWN_FOR(operationId),
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, { status: 'refused', reason: 'no' }),
    { status: 'refused', operationId, reason: 'not-committed' },
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, {
      status: 'not-applied', operationId, generation: generationA,
    }),
    { status: 'refused', operationId, reason: 'not-committed' },
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, committedRecordFor(op(22))),
    UNKNOWN_FOR(operationId),
    'a committed claim for a different operation is not this reservation\u2019s commit',
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId, actorB)),
    UNKNOWN_FOR(operationId),
    'a committed claim by a different actor is not this reservation\u2019s commit',
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId, actorA, { revision: -1 })),
    UNKNOWN_FOR(operationId),
  );
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId, actorA, { extra: 1 })),
    UNKNOWN_FOR(operationId),
  );
  assert.equal(state.committed.size, 0, 'none of the refused or malformed outcomes landed');
  // The reservation is still live (none of the above consumed it), and a
  // strictly validated committed record lands exactly once.
  const committed = await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId));
  assert.equal(committed.status, 'committed');
  assert.deepEqual(committed.record, committedRecordFor(operationId));
  assert.deepEqual(state.committed.get(operationId), committedRecordFor(operationId));
  assert.deepEqual(
    await protocol.commitAdmission(begun.ticket, committedRecordFor(operationId)),
    { status: 'refused', operationId, reason: 'reservation-lost' },
    'a consumed reservation can never land a second commit',
  );
  // A malformed transport answer is ambiguous, never commitment.
  const state2 = makeTransportState();
  const base2 = makeFence(state2);
  const weird = createTerminalCertificateProtocol({
    fence: {
      ...base2,
      async commitReservation() { return { committed: 'yes' }; },
    },
  });
  const begun2 = await weird.beginAdmission(op(23), actorA);
  assert.equal(begun2.status, 'admitted');
  assert.deepEqual(
    await weird.commitAdmission(begun2.ticket, committedRecordFor(op(23))),
    UNKNOWN_FOR(op(23)),
  );
});

test('failed post-seal authorization suppresses the response without undoing the seal', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(24);
  const suppressed = await protocol.sealNegative(claimFor(operationId), {
    authorize: async () => false,
  });
  assert.deepEqual(
    suppressed,
    { status: 'suppressed', operationId },
    'no certificate is served when post-seal authorization fails',
  );
  assert.deepEqual(
    await protocol.lookupCertificate(operationId, actorA),
    { status: 'not-applied', operationId, generation: generationA },
    'the seal itself stands — suppression never unseals',
  );
  assert.deepEqual(await protocol.admissionState(operationId), { status: 'sealed', operationId });

  const throwing = op(25);
  assert.deepEqual(
    await protocol.sealNegative(claimFor(throwing), {
      authorize: async () => { throw new Error('synthetic authorization failure'); },
    }),
    { status: 'suppressed', operationId: throwing },
  );
  assert.equal((await protocol.admissionState(throwing)).status, 'sealed');

  const allowed = op(26);
  let seenByAuthorize = null;
  const certified = await protocol.sealNegative(claimFor(allowed), {
    authorize: async record => { seenByAuthorize = record; return true; },
  });
  assert.equal(certified.status, 'certified');
  assert.equal(seenByAuthorize.operationId, allowed);
  assert.equal(seenByAuthorize.actorId, actorA);
});

test('unknown never falls through to a negative', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const neverPrepared = op(27);
  assert.deepEqual(await protocol.lookupCertificate(neverPrepared, actorA), UNKNOWN_FOR(neverPrepared));
  const preparedOnly = op(28);
  assert.equal((await protocol.beginAdmission(preparedOnly, actorA)).status, 'admitted');
  assert.deepEqual(
    await protocol.lookupCertificate(preparedOnly, actorA),
    UNKNOWN_FOR(preparedOnly),
    'an operation that was only reserved has no certificate — absence of a receipt is not a negative',
  );
  const committedOnly = op(29);
  state.committed.set(committedOnly, committedRecordFor(committedOnly));
  assert.deepEqual(
    await protocol.lookupCertificate(committedOnly, actorA),
    UNKNOWN_FOR(committedOnly),
    'a committed-only operation has no negative certificate to serve',
  );
});

test('malformed claims fail closed and seal nothing', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(30);
  const variants = [
    claimFor('not-an-operation'),
    claimFor(operationId, { actorId: 'actor-a' }),
    claimFor(operationId, { householdId: 'household-short' }),
    claimFor(operationId, { kind: 'refund' }),
    claimFor(operationId, { reason: 'whatever' }),
    claimFor(operationId, { expectedRevision: -1 }),
    claimFor(operationId, { expectedDocumentDigest: 'xyz' }),
    claimFor(operationId, { extra: true }),
    (({ confirmationDigest, ...rest }) => rest)(claimFor(operationId)),
    null,
    'claim',
  ];
  for (const variant of variants) {
    const result = await protocol.sealNegative(variant);
    assert.equal(result.status, 'unknown');
    assert.equal('certificate' in result, false);
  }
  assert.equal(state.seals.size, 0);
  assert.deepEqual(await protocol.admissionState(operationId), { status: 'open', operationId });
});
