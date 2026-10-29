'use strict';
// #768 Slice 1 — bill amount correction contract. FOUNDATION - NOT COMPLETION.
// Synthetic fixtures only: invented ids and amounts, no filesystem, network,
// environment, provider, Forecast or household data. Serialization only, not
// storage durability.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('../scripts/planned-input-contract');
const B = C.bills;
const householdId = 'household-' + 'a'.repeat(32);
const otherHousehold = 'household-' + 'b'.repeat(32);
const actorId = 'session-' + 'c'.repeat(64);
const otherActor = 'session-' + 'd'.repeat(64);
const now = Date.parse('2030-01-01T12:00:00.000Z');
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const copy = value => JSON.parse(JSON.stringify(value));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
let checks = 0;
const eq = (actual, expected, why) => { assert.deepEqual(actual, expected, why); checks++; };
const ok = (value, why) => { assert.ok(value, why); checks++; };
const refuses = (fn, why) => { assert.throws(fn, /planned-input-unavailable/, why); checks++; };

const bills = () => [
  { id: 'synthetic-power', label: 'Synthetic power', amount: 80.5, frequency: 'monthly', day: 12,
    confidence: 'estimated', owner: 'synthetic-owner' },
  { id: 'synthetic-water', label: 'Synthetic water', amount: 210.25, frequency: 'quarterly', month: 2, day: 1,
    confidence: 'unknown' },
  { id: 'synthetic-fee', label: 'Synthetic annual fee', amount: 99, frequency: 'yearly', month: 6, day: 3,
    confidence: 'estimated' },
  { id: 'synthetic-transit', label: 'Synthetic transit', amount: 45.1, frequency: 'biweekly', anchor: '2030-01-03',
    confidence: 'estimated' },
  { id: 'synthetic-locked', label: 'Synthetic confirmed', amount: 60, frequency: 'monthly', day: 5, confidence: 'confirmed' },
  { id: 'synthetic-noconf', label: 'Synthetic missing confidence', amount: 30, frequency: 'monthly', day: 7 },
  { id: 'synthetic-once', label: 'Synthetic one-off', amount: 500, frequency: 'once', date: '2030-03-01',
    confidence: 'estimated' },
  { id: 'synthetic-settled', label: 'Synthetic settled', amount: 70, frequency: 'monthly', day: 9,
    confidence: 'estimated', settled: true },
  { id: 'synthetic-settledon', label: 'Synthetic settledOn', amount: 71, frequency: 'monthly', day: 9,
    confidence: 'estimated', settledOn: '2029-12-09' },
  { id: 'synthetic-range', label: 'Synthetic range', amount: 40, amountMin: 30, amountMax: 50,
    frequency: 'monthly', day: 20, confidence: 'estimated' },
];
const correct = (target = 'bill:synthetic-power', value = 92.34, headOperationId = null) =>
  ({ version: 1, kind: 'correct', target, headOperationId, changes: { amount: value } });
const reset = (target, headOperationId) => ({ version: 1, kind: 'reset', target, headOperationId, changes: null });
const adopt = (source = bills()) => B.adoptBaseline({ householdId, bills: source, expectedFingerprint: B.fingerprint(source) });
const prepare = (body, n = 1, command = correct(), overrides = {}) =>
  B.prepare(body, { householdId, actorId, operationId: op(n), command, bills: bills(), now, ...overrides });
const confirm = (body, prepared, overrides = {}) => B.confirmCandidate(body,
  { householdId, actorId, preview: prepared.preview, confirmationDigest: prepared.confirmationDigest,
    bills: bills(), now: now + 1, ...overrides });
const record = (body, n, command, at = now) => {
  const p = prepare(body, n, command, { now: at });
  const c = confirm(body, p, { now: at + 1 });
  eq(c.status, 'candidate', 'confirm yields candidate bytes');
  eq(B.verifyReadback(c.document, c), { status: 'recorded', operationId: op(n), revision: c.nextPin.revision },
    'readback receipt matches the candidate');
  return { body: c.document, p, c };
};

function moduleShape() {
  // The contract module stays pure: its only import is node:crypto.
  const source = fs.readFileSync(path.join(__dirname, '../scripts/planned-input-contract.js'), 'utf8');
  eq([...source.matchAll(/require\(([^)]*)\)/g)].map(m => m[1]), ["'node:crypto'"], 'only node:crypto is imported');
  eq(B.SCHEMA, 'atlas-private-planned-bill-inputs/v1', 'distinct bill document schema');
  eq(B.PREVIEW_SCHEMA, 'atlas-private-planned-bill-input-preview/v1', 'distinct bill preview schema');
  ok(B.SCHEMA !== C.SCHEMA, 'bill schema is not the commitment schema');
  ok(Object.isFrozen(B), 'bill namespace is frozen');
}

function adoption() {
  const source = bills(), body = adopt(source);
  eq(B.pin(body, householdId).revision, 0, 'adoption has no correction history');
  eq(B.compose(body, { householdId, bills: source }), source,
    'zero operations compose to the complete adopted inventory, unsupported rows retained unchanged');
  eq(JSON.parse(body).schema, B.SCHEMA, 'document carries the bill schema');
  refuses(() => B.adoptBaseline({ householdId, bills: source, expectedFingerprint: 'f'.repeat(64) }), 'wrong fingerprint');
  const dup = [...bills(), bills()[0]];
  refuses(() => B.adoptBaseline({ householdId, bills: dup, expectedFingerprint: B.fingerprint(bills()) }), 'duplicate id');
  refuses(() => B.fingerprint(dup), 'duplicate id fingerprint');
  refuses(() => B.fingerprint([{ label: 'no id', amount: 1 }]), 'missing id');
  refuses(() => B.fingerprint([]), 'empty inventory');
  const many = Array.from({ length: 201 }, (_, i) => ({ id: 'synthetic-' + i, amount: 1, frequency: 'monthly' }));
  refuses(() => B.fingerprint(many), 'more than 200 rows');
  refuses(() => B.fingerprint([Object.assign(Object.create({ x: 1 }), { id: 'synthetic-proto' })]), 'non-plain row');
  refuses(() => B.adoptBaseline({ householdId: 'household-x', bills: source,
    expectedFingerprint: B.fingerprint(source) }), 'malformed household');
}

function corrections() {
  const body = adopt();
  for (const [target, value] of [['bill:synthetic-power', 92.34], ['bill:synthetic-water', 12.34],
    ['bill:synthetic-fee', 0], ['bill:synthetic-transit', 46]]) {
    const p = prepare(body, 1, correct(target, value));
    const id = target.slice(5), base = bills().find(row => row.id === id);
    eq(p.before, base, 'before is the adopted row for ' + id);
    eq(p.after, { ...base, amount: value }, 'only amount changes for ' + id);
    eq(Object.keys(p.after).sort(), Object.keys(base).sort(), 'no key added or removed for ' + id);
    eq(p.after.confidence, base.confidence, 'confidence is not rewritten for ' + id);
  }
  // Currency units with exact cents, not integer cents.
  eq(prepare(body, 1, correct('bill:synthetic-power', 12.34)).after.amount, 12.34, 'exact-cent currency units');
}

function refusals() {
  const body = adopt();
  const refusedRows = { 'synthetic-locked': 'confirmed confidence', 'synthetic-noconf': 'missing confidence',
    'synthetic-once': 'once frequency', 'synthetic-settled': 'settled===true', 'synthetic-settledon': 'own settledOn',
    'synthetic-range': 'range keys' };
  for (const [id, why] of Object.entries(refusedRows)) refuses(() => prepare(body, 1, correct('bill:' + id, 1)), why);
  // Each unsupported key individually, plus confidence variants and missing amount, via a dedicated inventory.
  const variants = [
    ...['amountMin', 'amountMax', 'amountSchedule', 'dateWindow', 'paymentTiming']
      .map(k => [k, { [k]: k === 'amountSchedule' ? [] : 1 }]),
    ['null confidence', { confidence: null }], ['malformed confidence', { confidence: 7 }],
    ['unrecognized confidence', { confidence: 'guessed' }], ['uppercase confidence', { confidence: 'Estimated' }],
    ['missing frequency', { frequency: undefined }], ['unknown frequency', { frequency: 'weekly' }],
    ['missing amount', { amount: undefined }], ['string amount', { amount: '80' }],
  ];
  for (const [why, patch] of variants) {
    const row = JSON.parse(JSON.stringify({ ...bills()[0], ...patch }));
    const source = [row];
    const doc = adopt(source);
    refuses(() => B.prepare(doc, { householdId, actorId, operationId: op(1), command: correct('bill:synthetic-power', 1),
      bills: source, now }), why);
  }
  // A null current amount on an explicit unknown bill may be corrected to a known amount.
  const unknownRow = [{ id: 'synthetic-null', amount: null, frequency: 'monthly', confidence: 'unknown' }];
  eq(B.prepare(adopt(unknownRow), { householdId, actorId, operationId: op(1), command: correct('bill:synthetic-null', 5),
    bills: unknownRow, now }).after.amount, 5, 'explicit unknown null-amount row corrected to a known amount');
  // Command shape.
  const bad = [
    ['amount null', correct(undefined, null)], ['negative', correct(undefined, -1)],
    ['NaN', correct(undefined, NaN)], ['Infinity', correct(undefined, Infinity)],
    ['sub-cent', correct(undefined, 1.005)], ['string amount', correct(undefined, '1.00')],
    ['no-op', correct(undefined, 80.5)], ['unknown target', correct('bill:synthetic-missing', 1)],
    ['commitment target', correct('commitment:synthetic-power', 1)], ['malformed target', correct('bill:Bad Id', 1)],
    ['reset on uncorrected row', reset('bill:synthetic-power', null)],
    ['remove kind', { ...correct(), kind: 'remove', changes: null }],
    ['retract kind', { ...correct(), kind: 'retract', changes: null, headOperationId: op(9) }],
    ['version 2', { ...correct(), version: 2 }], ['extra command key', { ...correct(), extra: 1 }],
    ['missing command key', (({ headOperationId, ...rest }) => rest)(correct())],
    ['goalId instead of target', { version: 1, kind: 'correct', goalId: 'bill:synthetic-power',
      headOperationId: null, changes: { amount: 1 } }],
    ['reset with changes', { ...reset('bill:synthetic-power', null), changes: { amount: 1 } }],
    ['empty changes', { ...correct(), changes: {} }], ['changes not an object', { ...correct(), changes: 5 }],
  ];
  for (const k of ['day', 'month', 'anchor', 'firstDue', 'frequency', 'date', 'confidence', 'label'])
    bad.push(['extra change key ' + k, { ...correct(), changes: { amount: 1, [k]: 1 } }]);
  bad.push(['date-only change', { ...correct(), changes: { date: '2030-01-01' } }]);
  for (const [why, command] of bad) refuses(() => prepare(body, 1, command), why);
  refuses(() => prepare(body, 1, correct(), { actorId: 'session-x' }), 'malformed actor');
  refuses(() => prepare(body, 1, correct(), { operationId: 'operation-x' }), 'malformed operation');
  refuses(() => prepare(body, 1, correct(), { now: -1 }), 'malformed time');
  refuses(() => prepare(body, 1, correct(), { bills: bills().slice(1) }), 'source drift at prepare');
}

function previewAndCandidate() {
  const body = adopt(), before = body;
  const p = prepare(body);
  eq(Object.keys(p).sort(), ['after', 'before', 'confirmationDigest', 'preview'], 'private prepare shape');
  eq(Object.keys(p.preview).sort(), ['actorId', 'baselineFingerprint', 'command', 'expectedDocumentDigest',
    'expectedRevision', 'expiresAt', 'householdId', 'issuedAt', 'operationId', 'schema'], 'exact preview keys');
  eq(p.preview.schema, B.PREVIEW_SCHEMA, 'bill preview schema');
  eq(p.preview.expiresAt - p.preview.issuedAt, 10 * 60 * 1000, 'ten-minute TTL');
  eq(p.confirmationDigest, C.digest(p.preview), 'confirmationDigest binds the preview including its schema');
  eq(body, before, 'prepare records nothing');
  eq(B.outcome(body, { householdId, actorId, operationId: op(1) }), { status: 'unknown', operationId: op(1) },
    'unrecorded operation is unknown');
  const c = confirm(body, p);
  eq(c.status, 'candidate', 'candidate bytes');
  eq(c.expectedPin, B.pin(body, householdId), 'expected pin is the prior document');
  eq(c.nextPin.revision, 1, 'next revision');
  eq(c.nextPin.documentDigest, C.digest(c.document), 'documentDigest is digest() of the encoded document string');
  ok(c.document.includes(JSON.stringify(B.SCHEMA)), 'the hashed document bytes include the schema');
  eq(B.verifyReadback(c.document, c), { status: 'recorded', operationId: op(1), revision: 1 }, 'readback receipt');
  refuses(() => B.verifyReadback(body, c), 'readback of the old body is refused');
  refuses(() => B.verifyReadback(c.document, { ...c, status: 'rejected' }), 'readback needs a candidate');
  eq(confirm(c.document, p), { status: 'already-recorded',
    receipt: { status: 'recorded', operationId: op(1), revision: 1 } }, 'same operation and digest is idempotent');
  refuses(() => confirm(c.document, p, { actorId: otherActor }), 'same operation, other actor');
  const p2 = prepare(body, 1, correct(undefined, 93));
  refuses(() => confirm(c.document, p2), 'same operation id, different digest');
  eq(B.outcome(c.document, { householdId, actorId, operationId: op(1) }),
    { status: 'recorded', operationId: op(1), revision: 1 }, 'outcome reports the recorded receipt');
  eq(B.outcome(c.document, { householdId, actorId: otherActor, operationId: op(1) }),
    { status: 'unknown', operationId: op(1) }, 'outcome is actor-bound');
  refuses(() => prepare(c.document, 1, correct('bill:synthetic-water', 5), { now: now + 2 }), 'operation id reuse at prepare');
  refuses(() => confirm(body, p, { confirmationDigest: 'e'.repeat(64) }), 'digest mismatch');
  refuses(() => confirm(body, { ...p, preview: { ...p.preview, extra: 1 } }), 'extra preview key');
  refuses(() => confirm(body, { ...p, preview: { ...p.preview, expiresAt: p.preview.expiresAt + 1 } }), 'TTL tamper');
}

function revisionBinding() {
  const body = adopt(), p = prepare(body);
  eq(confirm(body, p, { now: now + 10 * 60 * 1000 }), { status: 'rejected', reason: 'preview-expired' }, 'expired');
  eq(confirm(body, p, { now: now - 1 }), { status: 'rejected', reason: 'preview-expired' }, 'before issue');
  const other = record(body, 2, correct('bill:synthetic-water', 5)).body;
  eq(confirm(other, p, { now: now + 2 }), { status: 'rejected', reason: 'revision-changed' }, 'revision changed');
  const sameRevOther = record(body, 3, correct('bill:synthetic-fee', 1)).body;
  const pOther = prepare(other, 4, correct('bill:synthetic-fee', 2), { now: now + 2 });
  eq(confirm(sameRevOther, pOther, { now: now + 3 }), { status: 'rejected', reason: 'revision-changed' },
    'same revision but different document digest');
  const drifted = bills(); drifted[0].label = 'Synthetic drift';
  eq(confirm(body, p, { bills: drifted }), { status: 'rejected', reason: 'source-changed' }, 'baseline drift');
  // Stale head fork: two corrections prepared from the same head.
  const first = record(body, 5, correct('bill:synthetic-power', 90)).body;
  refuses(() => prepare(first, 6, correct('bill:synthetic-power', 91, null), { now: now + 2 }), 'stale head fork');
  const second = prepare(first, 6, correct('bill:synthetic-power', 91, op(5)), { now: now + 2 });
  eq(second.before.amount, 90, 'chained correction sees the current head');
  // Non-monotonic recordedAt.
  const late = record(body, 7, correct('bill:synthetic-water', 6), now + 100).body;
  const early = prepare(late, 8, correct('bill:synthetic-fee', 7), { now: now + 10 });
  refuses(() => confirm(late, early, { now: now + 11 }), 'recordedAt cannot go backwards');
}

function resetToBaseline() {
  let body = adopt();
  const base = bills()[0];
  body = record(body, 1, correct('bill:synthetic-power', 90)).body;
  body = record(body, 2, correct('bill:synthetic-power', 95, op(1)), now + 2).body;
  const p = prepare(body, 3, reset('bill:synthetic-power', op(2)), { now: now + 4 });
  eq(p.after, base, 'reset returns the exact adopted row');
  body = record(body, 3, reset('bill:synthetic-power', op(2)), now + 4).body;
  const rows = B.compose(body, { householdId, bills: bills() });
  eq(C.digest(rows[0]), C.digest(base), 'effective row digest-equal to baseline after reset');
  eq(rows.length, bills().length, 'bill still present after reset');
  eq(B.pin(body, householdId).revision, 3, 'three dated revisions');
  refuses(() => prepare(body, 4, reset('bill:synthetic-power', op(3)), { now: now + 6 }), 'reset at baseline refused');
  refuses(() => prepare(body, 4, reset('bill:synthetic-power', op(2)), { now: now + 6 }), 'reset with stale head');
  // A corrected row can be corrected again after reset.
  eq(prepare(body, 4, correct('bill:synthetic-power', 1, op(3)), { now: now + 6 }).after.amount, 1, 'correct after reset');
}

function compose() {
  let body = adopt();
  body = record(body, 1, correct('bill:synthetic-water', 12.34)).body;
  const rows = B.compose(body, { householdId, bills: bills() });
  eq(rows.map(row => row.id), bills().map(row => row.id), 'native order preserved');
  eq(rows[1], { ...bills()[1], amount: 12.34 }, 'corrected row');
  for (const i of [0, 2, 3, 4, 5, 6, 7, 8, 9]) eq(C.digest(rows[i]), C.digest(bills()[i]), 'unrelated row unchanged ' + i);
  const drifted = bills(); drifted[3].amount = 46;
  refuses(() => B.compose(body, { householdId, bills: drifted }), 'source drift fails closed, never empty');
  refuses(() => B.compose(body, { householdId, bills: bills().slice(0, 9) }), 'missing source row fails closed');
}

function serialization() {
  let body = adopt();
  body = record(body, 1, correct('bill:synthetic-transit', 47.5)).body;
  const inProcess = B.compose(body, { householdId, bills: bills() });
  const script = `const B=require(${JSON.stringify(path.join(__dirname, '../scripts/planned-input-contract'))}).bills;` +
    `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const {body,householdId,bills}=JSON.parse(s);` +
    `process.stdout.write(JSON.stringify(B.compose(body,{householdId,bills})));});`;
  const child = spawnSync(process.execPath, ['-e', script],
    { input: JSON.stringify({ body, householdId, bills: bills() }), encoding: 'utf8' });
  eq(child.status, 0, 'fresh process decoded the document');
  eq(JSON.parse(child.stdout), inProcess, 'fresh-process compose is identical (serialization only)');
}

function tamper() {
  const body = adopt(), doc = JSON.parse(body);
  const entries = [B.pin, B.outcome, B.compose, B.prepare, B.confirmCandidate];
  const attempts = {
    'corrupt JSON': body.slice(0, -1),
    'digest mismatch': JSON.stringify({ ...doc, digest: 'f'.repeat(64) }),
    'unknown schema': JSON.stringify({ ...doc, schema: 'atlas-private-planned-bill-inputs/v2' }),
    'extra envelope key': JSON.stringify({ ...doc, extra: 1 }),
    'extra state key': (() => { const s = { ...doc.state, extra: 1 }; return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'missing state key': (() => { const { operations, ...s } = doc.state; return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'revision mismatch': (() => { const s = { ...doc.state, revision: 1 }; return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'fingerprint mismatch': (() => { const s = copy(doc.state); s.baseline.fingerprint = 'a'.repeat(64); return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'extra baseline key': (() => { const s = copy(doc.state); s.baseline.extra = 1; return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'v1 legacy key in bill state': (() => { const { baseline, ...rest } = doc.state; const s = { ...rest, legacy: { fingerprint: baseline.fingerprint, commitments: baseline.bills } }; return JSON.stringify({ schema: doc.schema, state: s, digest: C.digest(s) }); })(),
    'over-size body': ' '.repeat(2 * 1024 * 1024 + 1),
    'empty body': '',
  };
  for (const [why, bad] of Object.entries(attempts)) {
    refuses(() => B.pin(bad, householdId), why + ' (pin)');
    refuses(() => B.compose(bad, { householdId, bills: bills() }), why + ' (compose)');
  }
  // A forged event whose after does not replay is refused.
  const good = record(body, 1, correct()).body, g = JSON.parse(good);
  const s = copy(g.state); s.operations[0].after.amount = 1;
  refuses(() => B.pin(JSON.stringify({ schema: g.schema, state: s, digest: C.digest(s) }), householdId), 'forged after');
  const s2 = copy(g.state); s2.operations[0].command.changes.amount = null; s2.operations[0].after.amount = null;
  refuses(() => B.pin(JSON.stringify({ schema: g.schema, state: s2, digest: C.digest(s2) }), householdId), 'forged null correction');
  refuses(() => B.pin(body, otherHousehold), 'other household');
  ok(entries.every(fn => typeof fn === 'function'), 'entry points present');
}

function isolation() {
  // Every state-consuming entry point in each namespace refuses the other namespace.
  const commitments = [{ id: 'synthetic-power', label: 'Synthetic', amount: 80.5, date: '2030-04-10',
    confidence: 'estimated', sinkingFund: true }];
  const v1 = C.adoptLegacy({ householdId, legacyCommitments: commitments, expectedLegacyFingerprint: C.legacyFingerprint(commitments) });
  const bill = adopt();
  const v1Prep = C.prepare(v1, { householdId, actorId, operationId: op(1), legacyCommitments: commitments, now,
    command: { version: 1, kind: 'correct', goalId: 'commitment:synthetic-power', headOperationId: null, changes: { amount: 90 } } });
  const billPrep = prepare(bill);
  const v1Cand = C.confirmCandidate(v1, { householdId, actorId, ...v1Prep, legacyCommitments: commitments, now: now + 1 });
  const billCand = confirm(bill, billPrep);
  // Bill document into v1.
  refuses(() => C.pin(bill, householdId), 'v1 pin refuses bill doc');
  refuses(() => C.restore(bill, B.pin(bill, householdId)), 'v1 restore refuses bill doc');
  refuses(() => C.compose(bill, { householdId, legacyCommitments: bills() }), 'v1 compose refuses bill doc');
  refuses(() => C.prepare(bill, { householdId, actorId, operationId: op(1), legacyCommitments: bills(), now,
    command: { version: 1, kind: 'correct', goalId: 'commitment:synthetic-power', headOperationId: null, changes: { amount: 90 } } }),
  'v1 prepare refuses bill doc');
  refuses(() => C.confirmCandidate(bill, { householdId, actorId, ...v1Prep, legacyCommitments: commitments, now: now + 1 }),
    'v1 confirm refuses bill doc');
  refuses(() => C.outcome(bill, { householdId, actorId, operationId: op(1) }), 'v1 outcome refuses bill doc');
  refuses(() => C.verifyReadback(billCand.document, billCand), 'v1 readback refuses bill candidate');
  // v1 document into bills.
  refuses(() => B.pin(v1, householdId), 'bill pin refuses v1 doc');
  refuses(() => B.restore(v1, C.pin(v1, householdId)), 'bill restore refuses v1 doc');
  refuses(() => B.compose(v1, { householdId, bills: commitments }), 'bill compose refuses v1 doc');
  refuses(() => B.prepare(v1, { householdId, actorId, operationId: op(1), command: correct(), bills: commitments, now }),
    'bill prepare refuses v1 doc');
  refuses(() => B.confirmCandidate(v1, { householdId, actorId, preview: billPrep.preview,
    confirmationDigest: billPrep.confirmationDigest, bills: commitments, now: now + 1 }), 'bill confirm refuses v1 doc');
  refuses(() => B.outcome(v1, { householdId, actorId, operationId: op(1) }), 'bill outcome refuses v1 doc');
  refuses(() => B.verifyReadback(v1Cand.document, v1Cand), 'bill readback refuses v1 candidate');
  // Cross-namespace previews.
  refuses(() => C.confirmCandidate(v1, { householdId, actorId, preview: billPrep.preview,
    confirmationDigest: billPrep.confirmationDigest, legacyCommitments: commitments, now: now + 1 }), 'v1 refuses bill preview');
  refuses(() => confirm(bill, v1Prep), 'bill refuses v1 preview');
  // Transplanted envelopes: the envelope digest covers state, not schema, so swapping
  // the schema string keeps the digest valid and must still be refused by exact keys.
  const bd = JSON.parse(bill), vd = JSON.parse(v1);
  eq(bd.digest, C.digest(bd.state), 'envelope digest is over canonical state');
  const billAsV1 = JSON.stringify({ ...bd, schema: C.SCHEMA }), v1AsBill = JSON.stringify({ ...vd, schema: B.SCHEMA });
  refuses(() => C.pin(billAsV1, householdId), 'bill state under v1 schema');
  refuses(() => C.compose(billAsV1, { householdId, legacyCommitments: bills() }), 'bill state under v1 schema compose');
  refuses(() => B.pin(v1AsBill, householdId), 'v1 state under bill schema');
  refuses(() => B.compose(v1AsBill, { householdId, bills: commitments }), 'v1 state under bill schema compose');
  // Transplanted bill preview with the schema relabelled is refused by exact keys and digest binding.
  const relabelled = { ...billPrep.preview, schema: 'atlas-private-planned-input-preview/v1' };
  refuses(() => C.confirmCandidate(v1, { householdId, actorId, preview: relabelled,
    confirmationDigest: C.digest(relabelled), legacyCommitments: commitments, now: now + 1 }), 'relabelled preview');
  // Transplanted to another household or another document of the same household.
  refuses(() => B.pin(bill, otherHousehold), 'bill document transplanted to another household');
  refuses(() => confirm(bill, billPrep, { householdId: otherHousehold }), 'preview transplanted to another household');
  const otherDoc = adopt(bills().slice(0, 4));
  eq(B.confirmCandidate(otherDoc, { householdId, actorId, preview: billPrep.preview,
    confirmationDigest: billPrep.confirmationDigest, bills: bills().slice(0, 4), now: now + 1 }),
  { status: 'rejected', reason: 'revision-changed' }, 'preview transplanted to another same-revision document');
  ok(sha(bill) !== sha(v1) && B.pin(bill, householdId).documentDigest !== C.pin(v1, householdId).documentDigest,
    'documents and pins are distinct');
}

function v1BytePin() {
  // Captured at base ccb1316d before any edit (synthetic v1 adopt -> prepare -> confirm -> readback).
  const rows = [
    { id: 'synthetic-a', label: 'Synthetic target A', amount: 120, date: '2030-04-10', confidence: 'estimated', sinkingFund: true },
    { id: 'synthetic-b', label: 'Synthetic target B', amount: null, date: null, confidence: 'unknown', sinkingFund: true },
  ];
  const doc0 = C.adoptLegacy({ householdId, legacyCommitments: rows, expectedLegacyFingerprint: C.legacyFingerprint(rows) });
  const p = C.prepare(doc0, { householdId, actorId, operationId: op(1), legacyCommitments: rows, now,
    command: { version: 1, kind: 'correct', goalId: 'commitment:synthetic-a', headOperationId: null, changes: { amount: 150.25 } } });
  const c = C.confirmCandidate(doc0, { householdId, actorId, preview: p.preview,
    confirmationDigest: p.confirmationDigest, legacyCommitments: rows, now: now + 1 });
  eq(C.legacyFingerprint(rows), '753c71ff7a352993f0b53a6ef92a4f2526768ef0faea3408de4fe7be1e063a4c', 'v1 fingerprint pinned');
  eq(sha(doc0), 'a1b956a764c7231ef66406a34f970b0c02a84c64eb5ec500959d59f791f233ae', 'v1 adopted document bytes pinned');
  eq(C.pin(doc0, householdId).documentDigest, '6ad98f6499649e14064f21d3b9a3b57e4b72e6dc6a844268d5eb6d946d7f6928', 'v1 pin pinned');
  eq(p.confirmationDigest, 'd493a0c72311b0d798ad337c7764c2fdcd22351f94729fec12cffe6fa59f4018', 'v1 confirmationDigest pinned');
  eq(sha(c.document), '6158be9807fb6c2d46ec3873332dc8d697bca9be0d56ac806a68afa631f53d2c', 'v1 candidate bytes pinned');
  eq(c.nextPin.documentDigest, '06ab5043a66516da47c246f16decc11bd025e2205807e3933cf8aaadc5a8e6f6', 'v1 next pin pinned');
  eq(C.verifyReadback(c.document, c), { status: 'recorded', operationId: op(1), revision: 1 }, 'v1 receipt pinned');
  eq(Object.keys(C).filter(k => k !== 'bills'), ['SCHEMA', 'TTL_MS', 'digest', 'legacyFingerprint', 'adoptLegacy',
    'pin', 'restore', 'compose', 'prepare', 'confirmCandidate', 'outcome', 'verifyReadback'], 'v1 exports unchanged');
}

moduleShape();
adoption();
corrections();
refusals();
previewAndCandidate();
revisionBinding();
resetToBaseline();
compose();
serialization();
tamper();
isolation();
v1BytePin();
console.log(`planned bill input contract: ${checks} synthetic checks passed`);
