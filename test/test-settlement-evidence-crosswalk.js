'use strict';

// ATLAS-080 — same-pass settlement crosswalk exporter proof. The exporter
// (scripts/provider-observe.js: acquireSettlementCrosswalk) is the production
// surface addendum section A.8 said did not exist: it runs ONE incumbent
// observe()/sanitization execution over already-supplied payload/data/map
// and returns the owned coherent acquisition { packet, join, plan, map }
// for that pass, where join is the pass's own tuple -> emitted-row
// provenance captured at packet-row emission:
// { localId, providerAccountId, transactionId } per emitted packet row.
//
// Everything here is synthetic: the Lunch Money payload is the repo fixture
// or a mutation of it carrying SENTINEL native ids, the account map is the
// repo fixture map, and the plan is the repo data file the observer suites
// already use. No provider calls, no credentials, no household evidence.
// The exporter has no production caller and activates nothing; these tests
// pin the acquisition contract the merged resolver consumes, the
// byte-identity of the incumbent outputs, and the fail-closed edges.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const O = require('../scripts/provider-observe.js');
const R = require('../scripts/settlement-evidence-resolver.js');
const Forecast = require('../public/forecast.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json'), 'utf8'));
const FIXTURE_MAP = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json'), 'utf8'));
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
const clone = x => JSON.parse(JSON.stringify(x));

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'b'.repeat(64);
const AUTHORITY = { householdId, actorId };
const GOAL_ID = 'commitment:burrard1';

function rawTx(id, accountId, extra = {}) {
  return {
    id, account_id: accountId, date: '2026-08-15', amount: 25.5,
    payee: 'SYNTH SHOP', is_pending: false, status: 'reviewed',
    currency: 'cad', ...extra,
  };
}
function inputFor(transactions, extra = {}) {
  const payload = clone(FIXTURE);
  payload.transactions = transactions;
  if (extra.categories) payload.categories = extra.categories;
  return {
    provider: 'lunchmoney', payload, accountMap: clone(FIXTURE_MAP),
    data: extra.data || clone(DATA),
    ...(extra.identityRules ? { identityRules: extra.identityRules } : {}),
  };
}
function acquire(input) {
  assert.equal(typeof O.acquireSettlementCrosswalk, 'function',
    'exporter entry point exists');
  return O.acquireSettlementCrosswalk(input);
}
function joinKeys(acq) {
  return acq.join.map(e => `${e.localId}|${e.providerAccountId}|${e.transactionId}`);
}
function classifyRecorder() {
  const calls = [];
  const classify = (tx, plan, opts) => {
    const verdict = Forecast.classifyCurrentPeriodTransaction(tx, plan, opts);
    calls.push({ tx, plan, opts, verdict });
    return verdict;
  };
  return { classify, calls };
}
function handlesFor(acq, tuple, goalId = GOAL_ID) {
  return {
    transaction: R.deriveSelectionHandle(R.computeInstanceDigest(acq.packet),
      { householdId, ...tuple }),
    commitment: R.deriveChoiceHandle(R.computePlanDigest(acq.plan), goalId),
  };
}
async function resolveWith(acq, tuple, classify) {
  const resolver = R.createSettlementEvidenceResolver({
    householdId, acquire: async () => acq,
  });
  return resolver.resolveSelection({
    authority: AUTHORITY, selection: handlesFor(acq, tuple), classify,
  });
}

// ---------------------------------------------------------------------------
// CW-1: shape — one entry per emitted packet row, exact tuple provenance,
// owned plan/map, nothing extra.
// ---------------------------------------------------------------------------
test('CW-1 exporter returns the owned {packet, join, plan, map} of one pass', () => {
  const input = inputFor(clone(FIXTURE.transactions));
  const acq = acquire(input);
  assert.ok(acq, 'acquisition returned');
  assert.deepEqual(Object.keys(acq).sort(), ['join', 'map', 'packet', 'plan']);
  // The fixture pass emits exactly one packet row under incumbent
  // behaviour — payroll 88001 on account 1001; the 88002 card pair is
  // consumed before packet emission — and the join mirrors emission.
  assert.deepEqual(acq.join, [
    { localId: 'tx-1', providerAccountId: '1001', transactionId: '88001' },
  ]);
  for (const entry of acq.join) {
    assert.deepEqual(Object.keys(entry).sort(),
      ['localId', 'providerAccountId', 'transactionId']);
  }
  assert.equal(acq.packet.transactions.length, acq.join.length,
    'one join entry per emitted packet row');
  assert.deepEqual(acq.plan, DATA.plan);
  assert.deepEqual(acq.map, FIXTURE_MAP);
  assert.notEqual(acq.plan, input.data.plan, 'plan is an owned copy');
  assert.notEqual(acq.map, input.accountMap, 'map is an owned copy');
  assert.equal('join' in acq.packet, false, 'packet carries no join');
});

// ---------------------------------------------------------------------------
// CW-2: incumbent outputs are byte-identical and leak no native identity.
// ---------------------------------------------------------------------------
test('CW-2 observe() output is unchanged and no sentinel identity leaks', () => {
  const scenarios = [
    ['fixture', inputFor(clone(FIXTURE.transactions))],
    ['sentinel spends', inputFor([rawTx('SENTINEL-NATIVE-1', 1001), rawTx('SENTINEL-NATIVE-2', 1002)])],
    ['ghost parent', inputFor([rawTx('SENTINEL-CHILD', 1001, { parent_id: 'SENTINEL-GHOST' }), rawTx('SENTINEL-A', 1001)])],
  ];
  for (const [label, input] of scenarios) {
    const before = JSON.stringify(O.observe(clone(input)));
    const acq = acquire(clone(input));
    const after = JSON.stringify(O.observe(clone(input)));
    assert.equal(after, before, `${label}: observe() byte-identical around an acquisition`);
    assert.equal(JSON.stringify(acq.packet),
      JSON.stringify(O.observe(clone(input)).currentPeriodActuals),
      `${label}: acquisition packet is the pass's own packet`);
    // The sanitized packet is the privacy boundary: it carries no native
    // identity. (The internal report's own normalized transaction lists
    // legitimately carry provider ids — incumbent content, pinned
    // byte-identical above; what must not appear anywhere is the JOIN.)
    for (const sentinel of ['SENTINEL-NATIVE-1', 'SENTINEL-NATIVE-2', 'SENTINEL-GHOST', 'SENTINEL-CHILD']) {
      assert.equal(JSON.stringify(acq.packet).includes(sentinel), false,
        `${label}: packet carries no native sentinel (${sentinel})`);
    }
    const report = O.observe(clone(input));
    assert.equal(report.join, undefined, `${label}: no join added to the report`);
    assert.equal(report.currentPeriodActuals.join, undefined,
      `${label}: no join added to the packet`);
  }
  // The exported sanitizer keeps its incumbent packet-only contract.
  const report = O.observe(inputFor(clone(FIXTURE.transactions)));
  const packet = O.sanitizedCurrentPeriodActuals(report, {
    accountMap: clone(FIXTURE_MAP), plan: clone(DATA).plan, asOf: '2026-08-16',
  });
  assert.ok(Array.isArray(packet.transactions), 'sanitizer still returns the packet itself');
  assert.equal(packet.join, undefined, 'sanitizer packet gains no join field');
});

// ---------------------------------------------------------------------------
// CW-3: the actual producer output feeds the merged resolver — canonical
// emitted row, reference-equal packet aliases, exactly one classify call.
// ---------------------------------------------------------------------------
test('CW-3 producer acquisition resolves through the merged resolver', async () => {
  const input = inputFor([
    rawTx('SENTINEL-POS', 1001, { amount: 42.18, payee: 'SYNTH GROCER' }),
    rawTx('SENTINEL-OTHER', 1002, { amount: 10.25 }),
  ]);
  const acq = acquire(input);
  assert.ok(acq);
  const tuple = { providerAccountId: '1001', transactionId: 'SENTINEL-POS' };
  const { classify, calls } = classifyRecorder();
  const selection = await resolveWith(acq, tuple, classify);
  assert.ok(selection, 'selection resolves');
  assert.equal(selection.txRef, R.deriveTxRef({ householdId, ...tuple }));
  assert.deepEqual(selection.identity, {
    householdId, source: 'lunchmoney', ...tuple,
  });
  assert.deepEqual(selection.evidence, {
    accountId: 'chequing-a', currency: 'cad', direction: 'debit',
    date: '2026-08-15', cents: 4218, posted: true,
  });
  assert.equal(selection.goalId, GOAL_ID);
  assert.equal(calls.length, 1, 'classify invoked exactly once');
  const emitted = acq.packet.transactions.find(r => r.id === 'tx-1');
  assert.deepEqual(calls[0].tx, emitted, 'classify consumed the emitted packet row content');
  assert.equal(calls[0].opts.currentPeriodActuals, calls[0].opts.packet,
    'both packet aliases are the identical object');
  assert.ok(calls[0].opts.packet.transactions.some(r => r.id === emitted.id),
    'the aliased packet contains the joined row');
});

// ---------------------------------------------------------------------------
// CW-4: same native id across accounts — the filtered sibling has no
// provenance and cannot resolve to the survivor.
// ---------------------------------------------------------------------------
test('CW-4 null-amount sibling receives no provenance and cannot resolve', async () => {
  const input = inputFor([
    rawTx('SENTINEL-SHARED', 1001, { amount: 30 }),
    rawTx('SENTINEL-SHARED', 1002, { amount: null }),
  ]);
  const acq = acquire(input);
  assert.ok(acq);
  assert.equal(acq.packet.transactions.length, 1, 'only the survivor is emitted');
  assert.deepEqual(acq.join, [
    { localId: 'tx-1', providerAccountId: '1001', transactionId: 'SENTINEL-SHARED' },
  ]);
  const dropped = { providerAccountId: '1002', transactionId: 'SENTINEL-SHARED' };
  const rec = classifyRecorder();
  assert.equal(await resolveWith(acq, dropped, rec.classify), null,
    'the dropped sibling tuple resolves to nothing, never to the survivor');
  assert.equal(rec.calls.length, 0, 'classify never invoked');
  const survivor = { providerAccountId: '1001', transactionId: 'SENTINEL-SHARED' };
  assert.ok(await resolveWith(acq, survivor, classifyRecorder().classify),
    'the survivor tuple resolves');
});

// ---------------------------------------------------------------------------
// CW-5: same native id surviving on two accounts shares one local id —
// both tuples refuse as ambiguous.
// ---------------------------------------------------------------------------
test('CW-5 two survivors under one local id refuse ambiguity', async () => {
  const input = inputFor([
    rawTx('SENTINEL-SHARED', 1001, { amount: 30 }),
    rawTx('SENTINEL-SHARED', 1002, { amount: 30 }),
  ]);
  const acq = acquire(input);
  assert.ok(acq);
  assert.equal(acq.packet.transactions.length, 2);
  assert.ok(acq.packet.transactions.every(r => r.id === 'tx-1'),
    'the incumbent pass emits both rows under one local id');
  assert.deepEqual(joinKeys(acq).sort(), [
    'tx-1|1001|SENTINEL-SHARED', 'tx-1|1002|SENTINEL-SHARED',
  ]);
  for (const acct of ['1001', '1002']) {
    const rec = classifyRecorder();
    assert.equal(await resolveWith(acq,
      { providerAccountId: acct, transactionId: 'SENTINEL-SHARED' }, rec.classify), null,
    `tuple on account ${acct} refuses ambiguity`);
    assert.equal(rec.calls.length, 0, 'classify never invoked');
  }
});

// ---------------------------------------------------------------------------
// CW-6: dropped rows and reference-only ids create no orphan entries.
// ---------------------------------------------------------------------------
test('CW-6 undated, currency-dropped and parent-reference ids leave no orphans', () => {
  // Undated row is dropped before emission; the dated row keeps provenance.
  let acq = acquire(inputFor([
    rawTx('SENTINEL-UNDATED', 1001, { date: null }),
    rawTx('SENTINEL-DATED', 1001),
  ]));
  assert.deepEqual(acq.join, [
    { localId: 'tx-1', providerAccountId: '1001', transactionId: 'SENTINEL-DATED' },
  ]);

  // Currency-dropped: an identity rule requiring CAD drops the USD row.
  // The pass still assigns it a local id for the currency diagnostic
  // (currencyUnconfirmed names tx-1) — but no packet row is emitted, so
  // the join holds no entry for it and the survivor keeps its own tx-2.
  const data = clone(DATA);
  data.plan.bills.push({
    id: 'synthetic-currency-guard', label: 'Synthetic Guard Bill',
    frequency: 'once', date: '2026-08-15', amount: 25.5,
    confidence: 'confirmed', budgetCategory: 'household',
  });
  acq = acquire(inputFor([
    rawTx('SENTINEL-USD', 1001, { currency: 'usd', payee: 'SYNTH USD SHOP' }),
    rawTx('SENTINEL-CAD', 1001, { payee: 'OTHER SHOP' }),
  ], {
    data,
    identityRules: [{
      eventId: 'synthetic-currency-guard', payeePatterns: ['SYNTH USD SHOP'],
      atlasAccountId: 'chequing-a', direction: 'debit', requiredCurrency: 'cad',
      postingDateRule: 'covers-due-on-or-before-posting',
    }],
  }));
  assert.deepEqual(acq.packet.currencyUnconfirmed, [{ id: 'tx-1', currency: 'usd' }],
    'the dropped row consumed tx-1 in the diagnostic only');
  assert.deepEqual(acq.join, [
    { localId: 'tx-2', providerAccountId: '1001', transactionId: 'SENTINEL-CAD' },
  ], 'no orphan entry for the currency-dropped row');

  // Parent references: a ghost parent and a dropped (undated) parent are
  // assigned local ids by linkage, but neither is an emitted row and
  // neither earns a join entry.
  acq = acquire(inputFor([
    rawTx('SENTINEL-CHILD-G', 1001, { parent_id: 'SENTINEL-GHOST' }),
    rawTx('SENTINEL-PARENT-D', 1001, { date: null }),
    rawTx('SENTINEL-CHILD-D', 1001, { parent_id: 'SENTINEL-PARENT-D' }),
  ]));
  const joinedIds = acq.join.map(e => e.transactionId);
  assert.deepEqual(joinedIds.sort(), ['SENTINEL-CHILD-D', 'SENTINEL-CHILD-G']);
  assert.ok(acq.packet.transactions.every(r => joinedIds.includes(
    acq.join.find(e => e.localId === r.id).transactionId)),
  'every emitted row has exactly its own provenance');
});

// ---------------------------------------------------------------------------
// CW-7: pending -> posted collapse — provenance names the survivor only.
// ---------------------------------------------------------------------------
test('CW-7 collapsed pending predecessor leaves only the posted survivor', () => {
  const acq = acquire(inputFor([
    rawTx('SENTINEL-PP', 2001, { is_pending: true, payee: 'PENDING NAME' }),
    rawTx('SENTINEL-PP', 2001, { is_pending: false, payee: 'POSTED NAME' }),
  ]));
  assert.ok(acq);
  assert.equal(acq.packet.transactions.length, 1, 'one surviving row');
  assert.equal(acq.packet.transactions[0].pending, false);
  assert.deepEqual(acq.join, [
    { localId: 'tx-1', providerAccountId: '2001', transactionId: 'SENTINEL-PP' },
  ]);
});

// ---------------------------------------------------------------------------
// CW-8: final sanitation failure returns no usable acquisition, while the
// incumbent observe() still returns its (emptied) packet.
// ---------------------------------------------------------------------------
test('CW-8 sanitation failure yields no acquisition', () => {
  const input = inputFor(
    [rawTx('SENTINEL-CAT', 1001, { category_id: 777 })],
    {
      categories: [{
        id: 777, name: 'Bearer SENTINELCATEGORY', is_income: false,
        exclude_from_budget: false, exclude_from_totals: false,
      }],
    });
  const report = O.observe(clone(input));
  assert.deepEqual(report.currentPeriodActuals.transactions, [],
    'incumbent behaviour: failed sanitation empties the packet');
  assert.equal(acquire(input), null, 'exporter returns no usable acquisition');
});

// ---------------------------------------------------------------------------
// CW-9: identity distinctions are preserved exactly — case, leading zeros,
// NUL, and the string/number identity merge of the incumbent collapse.
// ---------------------------------------------------------------------------
test('CW-9 opaque identity distinctions survive the crosswalk', async () => {
  let acq = acquire(inputFor([
    rawTx('00123', 1001), rawTx(123, 1002),
    rawTx('sentinel-case', 1001), rawTx('SENTINEL-CASE', 1002),
    rawTx('SEN\u0000TINEL', 1001), rawTx('SENTINEL', 1002),
  ]));
  assert.deepEqual(acq.join.map(e => e.transactionId), [
    '00123', '123', 'sentinel-case', 'SENTINEL-CASE', 'SEN\u0000TINEL', 'SENTINEL',
  ], 'leading-zero, case and NUL distinctions are exact and in emission order');
  assert.equal(new Set(joinKeys(acq)).size, acq.join.length, 'no tuple collapsed');

  // Number 123 and string '123' are the same incumbent identity: two
  // posted rows collapse to two packet rows under one local id, the join
  // holds the single tuple once, and the resolver refuses the ambiguity.
  acq = acquire(inputFor([rawTx('123', 1001), rawTx(123, 1001)]));
  assert.equal(acq.packet.transactions.length, 2);
  assert.deepEqual(acq.join, [
    { localId: 'tx-1', providerAccountId: '1001', transactionId: '123' },
  ]);
  const rec = classifyRecorder();
  assert.equal(await resolveWith(acq,
    { providerAccountId: '1001', transactionId: '123' }, rec.classify), null,
  'a local id with several rows is unresolvable');
  assert.equal(rec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// CW-10: mutation, reordering and separate calls cannot mix acquisitions.
// ---------------------------------------------------------------------------
test('CW-10 acquisitions are owned, order-faithful and independent', () => {
  const mkTxs = () => [rawTx('SENTINEL-FIRST', 1001, { amount: 11 }), rawTx('SENTINEL-SECOND', 1002, { amount: 22 })];
  const input = inputFor(mkTxs());
  const acq = acquire(input);
  const snapshot = clone(acq);

  // Mutating the supplied payload/data/map after acquisition changes nothing.
  input.payload.transactions[0].amount = 999;
  input.data.plan.commitments[0].amount = 1;
  input.accountMap.mappings[0].canonical.id = 'mutated-account';
  assert.deepEqual(acq.packet, snapshot.packet, 'packet is owned');
  assert.deepEqual(acq.join, snapshot.join, 'join is owned');
  assert.deepEqual(acq.plan, snapshot.plan, 'plan is owned');
  assert.deepEqual(acq.map, snapshot.map, 'map is owned');

  // A second acquisition over a fresh identical input is deep-equal but
  // shares no object graph with the first.
  const acq2 = acquire(inputFor(mkTxs()));
  assert.deepEqual(acq2, snapshot);
  assert.notEqual(acq2.packet, acq.packet);
  assert.notEqual(acq2.packet.transactions[0], acq.packet.transactions[0]);
  acq.packet.transactions[0].amount = -1;
  assert.equal(acq2.packet.transactions[0].amount, snapshot.packet.transactions[0].amount,
    'mutating one acquisition cannot reach another');

  // Reordering the payload re-derives provenance for THIS pass: local ids
  // follow emission order, never a previous pass's assignment.
  const fresh = mkTxs();
  const reordered = acquire(inputFor([fresh[1], fresh[0]]));
  assert.deepEqual(reordered.join.map(e => e.transactionId),
    ['SENTINEL-SECOND', 'SENTINEL-FIRST']);
  assert.deepEqual(reordered.join.map(e => e.localId), ['tx-1', 'tx-2']);
});

// ---------------------------------------------------------------------------
// CW-11: malformed identity fails closed.
// ---------------------------------------------------------------------------
test('CW-11 missing account identity yields no acquisition', () => {
  const noAccount = rawTx('SENTINEL-NOACCT', null);
  delete noAccount.account_id;
  const input = inputFor([noAccount]);
  const report = O.observe(clone(input));
  assert.equal(report.currentPeriodActuals.transactions.length, 1,
    'incumbent behaviour: the unmapped row is still emitted');
  assert.equal(acquire(input), null,
    'a row without provider account identity has no usable provenance');
  // A missing native id is rejected by the incumbent normalization, and
  // the exporter inherits that failure rather than inventing provenance.
  const noId = rawTx('SENTINEL-X', 1001);
  delete noId.id;
  assert.throws(() => acquire(inputFor([noId])), /stable id/);
});

// ---------------------------------------------------------------------------
// CW-12: an empty pass is a valid empty acquisition.
// ---------------------------------------------------------------------------
test('CW-12 empty transaction set yields an empty, valid acquisition', () => {
  const acq = acquire(inputFor([]));
  assert.ok(acq);
  assert.deepEqual(acq.join, []);
  assert.deepEqual(acq.packet.transactions, []);
});
