'use strict';

// ATLAS-080 / B3 FOUNDATION — NOT COMPLETION. Synthetic protocol proof for
// the private terminal-certificate module. No production consumer exists:
// nothing in the repository imports the module, and this suite is its only
// caller.
//
// INJECTED TRANSPORT ASSUMPTION — STATED EXPLICITLY: the tests in this
// suite MODEL an atomic compare-and-seal transport. The in-memory fence
// below performs its check-and-set without an intervening await, which
// makes the seal atomic inside this single-threaded test process and lets
// several protocol instances share one modelled transport state. That is
// a MODELLED guarantee only. The foundation module alone does NOT fence
// the incumbent settlement store or confirmation controller — no
// production admission path consults it, so the cross-controller failure
// executed as acceptance case B3A-27c remains possible in the shipped
// composition until a later integration wires this protocol into
// admission — and nothing in this suite qualifies production durability,
// a real durable transport, storage, or activation.
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

// One modelled transport state. Several fences (and therefore several
// protocol instances, including "restarted" and "second controller"
// instances) can be facades over the same state, exactly as the protocol
// contract assumes a shared durable transport beneath them.
function makeTransportState() {
  return { seals: new Map(), committed: new Map() };
}

function makeFence(state) {
  return {
    atomicSeal: true,
    // Modelled atomic compare-and-seal: the check-and-set below completes
    // without an intervening await, which is what makes it atomic in this
    // model. A production transport would have to provide the same
    // transition atomically at the durable layer; this model does not
    // provide or qualify one.
    async seal(operationId, record) {
      if (state.seals.has(operationId)) {
        return { sealed: false, existing: state.seals.get(operationId) };
      }
      state.seals.set(operationId, record);
      return { sealed: true, record };
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
  const constructions = [
    () => createTerminalCertificateProtocol(),
    () => createTerminalCertificateProtocol({}),
    () => createTerminalCertificateProtocol({ fence: null }),
    () => createTerminalCertificateProtocol({ fence: { atomicSeal: true } }),
    () => createTerminalCertificateProtocol({
      fence: { seal: good.seal, readSeal: good.readSeal, readCommitted: good.readCommitted },
    }),
    () => createTerminalCertificateProtocol({ fence: { ...good, atomicSeal: false } }),
    () => createTerminalCertificateProtocol({
      fence: { atomicSeal: true, seal: good.seal, readSeal: good.readSeal },
    }),
  ];
  for (const construct of constructions) {
    const protocol = construct();
    assert.equal(protocol.connected, false);
    const operationId = op(1);
    assert.deepEqual(await protocol.sealNegative(claimFor(operationId)), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.lookupCertificate(operationId, actorA), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.admissionState(operationId), UNKNOWN_FOR(operationId));
    assert.deepEqual(await protocol.beginAdmission(operationId, actorA), UNKNOWN_FOR(operationId));
    let commits = 0;
    assert.deepEqual(
      await protocol.commitAdmission(
        { operationId, actorId: actorA, nonce: 'n' },
        async () => { commits++; },
      ),
      UNKNOWN_FOR(operationId),
    );
    assert.equal(commits, 0, 'an inert protocol never invokes a commit');
  }
  assert.equal(state.seals.size, 0, 'an inert protocol seals nothing');
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

test('unreadable persistence resolves to unknown and never invokes a commit', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(7);
  const begun = await protocol.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  const base = makeFence(state);
  const unreadable = createTerminalCertificateProtocol({
    fence: {
      ...base,
      async readSeal() { throw new Error('synthetic unreadable seal surface'); },
    },
  });
  assert.deepEqual(await unreadable.lookupCertificate(operationId, actorA), UNKNOWN_FOR(operationId));
  assert.deepEqual(await unreadable.admissionState(operationId), UNKNOWN_FOR(operationId));
  assert.deepEqual(await unreadable.beginAdmission(operationId, actorA), UNKNOWN_FOR(operationId));
  let commits = 0;
  assert.deepEqual(
    await unreadable.commitAdmission(begun.ticket, async () => { commits++; }),
    UNKNOWN_FOR(operationId),
  );
  assert.equal(commits, 0, 'unreadable state fails closed before any commit runs');
});

test('divergent stored records read as unknown, one corruption at a time', async () => {
  const good = claimFor(op(8));
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
    state.seals.set(op(8), corrupt);
    const protocol = makeProtocol(state);
    assert.deepEqual(
      await protocol.lookupCertificate(op(8), actorA),
      UNKNOWN_FOR(op(8)),
      `corruption "${name}" must read unknown, never not-applied`,
    );
    assert.deepEqual(await protocol.admissionState(op(8)), UNKNOWN_FOR(op(8)), `corruption "${name}"`);
  }
});

test('committed and negative coexistence is an explicit conflict refusal, never precedence', async () => {
  // Committed first: the negative seal is refused and nothing is sealed.
  const stateA = makeTransportState();
  const operationA = op(9);
  stateA.committed.set(operationA, { status: 'committed', operationId: operationA, revision: 4 });
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
  const operationB = op(10);
  const protocolB = makeProtocol(stateB);
  assert.equal((await protocolB.sealNegative(claimFor(operationB))).status, 'certified');
  stateB.committed.set(operationB, { status: 'committed', operationId: operationB, revision: 4 });
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
  const operationId = op(11);
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
  const fresh = op(12);
  assert.equal((await after.beginAdmission(fresh, actorA)).status, 'admitted');
});

test('cross-controller and cross-actor exclusion with both controllers live', async () => {
  const state = makeTransportState();
  const controller1 = makeProtocol(state);
  const controller2 = makeProtocol(state);
  const operationId = op(13);
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
  const fresh = op(14);
  const begun = await controller2.beginAdmission(fresh, actorB);
  assert.equal(begun.status, 'admitted', 'a different operationId is never fenced by this seal');
  let commits = 0;
  const committed = await controller2.commitAdmission(begun.ticket, async () => { commits++; return 'ok'; });
  assert.equal(committed.status, 'committed');
  assert.equal(commits, 1);
});

test('a stale suspended admission cannot commit after the seal lands', async () => {
  const state = makeTransportState();
  const suspender = makeProtocol(state);
  const sealer = makeProtocol(state);
  const operationId = op(15);
  const begun = await suspender.beginAdmission(operationId, actorA);
  assert.equal(begun.status, 'admitted');
  // The admission is now suspended (its caller is away deciding); while
  // it is suspended, another instance seals the operation terminally.
  assert.equal((await sealer.sealNegative(claimFor(operationId))).status, 'certified');
  let commits = 0;
  const result = await suspender.commitAdmission(begun.ticket, async () => { commits++; });
  assert.deepEqual(result, { status: 'refused', operationId, reason: 'operation-sealed' });
  assert.equal(commits, 0, 'the suspended commit is never invoked after the seal');

  // Control: the same suspended shape commits when no seal intervenes.
  const open = op(16);
  const begunOpen = await suspender.beginAdmission(open, actorA);
  let openCommits = 0;
  const openResult = await suspender.commitAdmission(begunOpen.ticket, async () => {
    openCommits++;
    return { revision: 5 };
  });
  assert.deepEqual(openResult, { status: 'committed', operationId: open, result: { revision: 5 } });
  assert.equal(openCommits, 1);
});

test('failed post-seal authorization suppresses the response without undoing the seal', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(17);
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

  const throwing = op(18);
  assert.deepEqual(
    await protocol.sealNegative(claimFor(throwing), {
      authorize: async () => { throw new Error('synthetic authorization failure'); },
    }),
    { status: 'suppressed', operationId: throwing },
  );
  assert.equal((await protocol.admissionState(throwing)).status, 'sealed');

  const allowed = op(19);
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
  const neverPrepared = op(20);
  assert.deepEqual(await protocol.lookupCertificate(neverPrepared, actorA), UNKNOWN_FOR(neverPrepared));
  const preparedOnly = op(21);
  assert.equal((await protocol.beginAdmission(preparedOnly, actorA)).status, 'admitted');
  assert.deepEqual(
    await protocol.lookupCertificate(preparedOnly, actorA),
    UNKNOWN_FOR(preparedOnly),
    'an operation that was only prepared has no certificate — absence of a receipt is not a negative',
  );
  const committedOnly = op(22);
  state.committed.set(committedOnly, { status: 'committed', operationId: committedOnly, revision: 1 });
  assert.deepEqual(
    await protocol.lookupCertificate(committedOnly, actorA),
    UNKNOWN_FOR(committedOnly),
    'a committed-only operation has no negative certificate to serve',
  );
});

test('malformed claims fail closed and seal nothing', async () => {
  const state = makeTransportState();
  const protocol = makeProtocol(state);
  const operationId = op(23);
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
