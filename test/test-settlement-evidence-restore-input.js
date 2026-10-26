'use strict';
// Exact-restore input validator (ATLAS-080): synthetic fixtures only.
// REAL dependencies: the contract (C.adopt/C.pin/C.digest), the real store
// (to produce committed ledger bytes) and the real terminal-certificate
// protocol (to seal negative certificates) via the shared exclusion world.
// DOUBLES (labelled): the exclusion world's in-memory adapters and history.
// ASSUMPTION (non-claim): the anchors are trusted maintenance input; nothing
// here proves anchor provenance or latestness, and 'valid' is not restore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../scripts/planned-obligation-settlement-contract');
const TC = require('../scripts/settlement-evidence-terminal-certificate');
const X = require('./test-settlement-evidence-terminal-certificate');
const MODULE = path.join(__dirname, '..', 'scripts', 'settlement-evidence-restore-input.js');
const R = require(MODULE);
const { householdId, op, encoded } = X;
const otherHousehold = 'household-' + 'e'.repeat(32), otherNamespace = 'ledger-' + 'f'.repeat(32);

// Synthetic world: ops 1..2 committed to the financial ledger, op 3 sealed
// negative, with snapshots of the ledger/history at each revision.
async function world() {
  const w = X.makeExclusionWorld(), s = w.newStore(), snaps = { ledger: [Buffer.from(w.doc)], history: [Buffer.from(w.historyBytes)] };
  for (const n of [1, 2]) {
    const p = await w.prepare(s, n);
    assert.equal((await s.commit(w.input(p))).status, 'committed');
    snaps.ledger.push(Buffer.from(w.doc));
  }
  const p3 = await w.prepare(s, 3);
  assert.equal((await w.seal(s, p3, 3)).status, 'certified');
  snaps.history.push(Buffer.from(w.historyBytes));
  const ns = w.domain.ledgerNamespace;
  const ledgerAnchor = bytes => { const v = JSON.parse(bytes); return { revision: v.revision, documentDigest: v.digest }; };
  const historyAnchor = bytes => { const v = JSON.parse(bytes); return { schema: 'terminal-history-checkpoint-1', householdId: v.householdId, ledgerNamespace: v.ledgerNamespace, revision: v.revision, digest: v.digest }; };
  const input = (o = {}) => ({
    domain: { householdId, ledgerNamespace: ns, ...o.domain },
    anchors: { ledger: o.ledgerAnchor || ledgerAnchor(snaps.ledger[2]), history: o.historyAnchor || historyAnchor(snaps.history[1]) },
    candidate: { ledgerBytes: o.ledgerBytes || Buffer.from(snaps.ledger[2]), historyBytes: o.historyBytes || Buffer.from(snaps.history[1]) },
  });
  return { w, ns, snaps, input, ledgerAnchor, historyAnchor };
}
const refused = (result, reason) => { assert.deepEqual({ ...result }, { status: 'refused', reason }); assert.ok(Object.isFrozen(result)); };

test('exact anchor pair is accepted with a bounded immutable verdict (validity is not restore success)', async () => {
  const { ns, snaps, input } = await world();
  const v = R.validateRestoreInput(input());
  assert.equal(v.status, 'valid');
  const doc = JSON.parse(snaps.ledger[2]), hist = JSON.parse(snaps.history[1]);
  assert.deepEqual(JSON.parse(JSON.stringify(v)), {
    status: 'valid', householdId, ledgerNamespace: ns,
    ledger: { revision: 2, documentDigest: doc.digest, pin: C.pin(snaps.ledger[2], householdId) },
    history: { revision: 1, digest: hist.digest }, operationCount: 2, negativeRecordCount: 1,
  });
  // independent reconciliation of the pin against the contract formula
  assert.equal(v.ledger.pin, C.digest({ householdId, revision: 2, documentDigest: doc.digest }));
  for (const o of [v, v.ledger, v.history]) assert.ok(Object.isFrozen(o));
  assert.throws(() => { 'use strict'; v.status = 'installed'; });
  assert.equal(Object.keys(v).some(k => /install|reopen|authority|restore/i.test(k)), false);
});

test('either anchor mismatched, corrupt or missing component refuses', async () => {
  const { snaps, input, ledgerAnchor, historyAnchor } = await world();
  const la = ledgerAnchor(snaps.ledger[2]), ha = historyAnchor(snaps.history[1]);
  refused(R.validateRestoreInput(input({ ledgerAnchor: { ...la, documentDigest: '0'.repeat(64) } })), 'ledger-anchor-mismatch');
  refused(R.validateRestoreInput(input({ ledgerAnchor: { ...la, revision: 3 } })), 'ledger-anchor-mismatch');
  refused(R.validateRestoreInput(input({ historyAnchor: { ...ha, digest: '0'.repeat(64) } })), 'history-anchor-mismatch');
  refused(R.validateRestoreInput(input({ historyAnchor: { ...ha, revision: 2 } })), 'history-anchor-mismatch');
  refused(R.validateRestoreInput(input({ ledgerAnchor: { ...la, documentDigest: 'XYZ' } })), 'anchor-malformed');
  refused(R.validateRestoreInput(input({ historyAnchor: { ...ha, schema: 'terminal-history-checkpoint-0' } })), 'anchor-malformed');
  const { revision, ...noRevision } = la;
  refused(R.validateRestoreInput(input({ ledgerAnchor: noRevision })), 'anchor-malformed');
  // corrupt / tampered bytes
  const flipped = Buffer.from(snaps.ledger[2]); flipped[flipped.length - 5] ^= 1;
  refused(R.validateRestoreInput(input({ ledgerBytes: flipped })), 'ledger-invalid');
  refused(R.validateRestoreInput(input({ ledgerBytes: Buffer.from('{not json') })), 'ledger-invalid');
  const tamperedHistory = JSON.parse(snaps.history[1]); tamperedHistory.records[0].reason = 'store-conflict';
  refused(R.validateRestoreInput(input({ historyBytes: Buffer.from(JSON.stringify(tamperedHistory)) })), 'history-invalid');
  refused(R.validateRestoreInput(input({ historyBytes: Buffer.from('[]') })), 'history-invalid');
  // missing components: never inferred as empty genesis
  for (const missing of ['ledgerBytes', 'historyBytes']) {
    const i = input(); delete i.candidate[missing];
    refused(R.validateRestoreInput(i), 'input-malformed');
    const j = input(); j.candidate[missing] = null;
    refused(R.validateRestoreInput(j), 'input-malformed');
  }
  refused(R.validateRestoreInput(input({ ledgerBytes: Buffer.alloc(0) })), 'ledger-invalid');
  refused(R.validateRestoreInput(input({ historyBytes: Buffer.alloc(0) })), 'history-invalid');
  for (const k of ['domain', 'anchors', 'candidate']) { const i = input(); delete i[k]; refused(R.validateRestoreInput(i), 'input-malformed'); }
  const i = input(); delete i.anchors.history; refused(R.validateRestoreInput(i), 'anchor-malformed');
  refused(R.validateRestoreInput({ ...input(), extra: 1 }), 'input-malformed');
  for (const bad of [undefined, null, 1, 'x', [], new Map()]) refused(R.validateRestoreInput(bad), 'input-malformed');
});

test('older candidates refuse with no fallback, and genesis is never inferred', async () => {
  const { snaps, input, ledgerAnchor, historyAnchor } = await world();
  // older, internally valid ledger/history revisions against the latest anchors
  refused(R.validateRestoreInput(input({ ledgerBytes: snaps.ledger[1] })), 'ledger-anchor-mismatch');
  refused(R.validateRestoreInput(input({ ledgerBytes: snaps.ledger[0] })), 'ledger-anchor-mismatch');
  refused(R.validateRestoreInput(input({ historyBytes: snaps.history[0] })), 'history-anchor-mismatch');
  // an empty genesis document from adopt() is refused against a non-genesis anchor
  refused(R.validateRestoreInput(input({ ledgerBytes: C.adopt({ householdId }) })), 'ledger-anchor-mismatch');
  // genesis is accepted only when the trusted anchor EXPLICITLY names it
  const v = R.validateRestoreInput(input({ ledgerBytes: snaps.ledger[0], ledgerAnchor: ledgerAnchor(snaps.ledger[0]),
    historyBytes: snaps.history[0], historyAnchor: historyAnchor(snaps.history[0]) }));
  assert.equal(v.status, 'valid'); assert.equal(v.ledger.revision, 0); assert.equal(v.history.revision, 0);
});

test('household and namespace boundaries are enforced at the supported boundaries', async () => {
  const { ns, snaps, input, historyAnchor } = await world();
  // ledger from another household (real contract bytes)
  refused(R.validateRestoreInput(input({ ledgerBytes: C.adopt({ householdId: otherHousehold }) })), 'ledger-household-mismatch');
  // domain names another household: ledger and anchor no longer bind
  refused(R.validateRestoreInput(input({ domain: { householdId: otherHousehold } })), 'history-domain-mismatch');
  // history anchor for another namespace (cross-domain substitution)
  refused(R.validateRestoreInput(input({ historyAnchor: { ...historyAnchor(snaps.history[1]), ledgerNamespace: otherNamespace } })), 'history-domain-mismatch');
  // history bytes self-consistent for another namespace, with a matching anchor
  const records = JSON.parse(snaps.history[1]).records.map(r => ({ ...r, ledgerNamespace: otherNamespace }));
  const foreign = encoded(records, householdId, otherNamespace);
  refused(R.validateRestoreInput(input({ historyBytes: foreign.historyBytes, historyAnchor: { ...foreign.checkpoint, ledgerNamespace: ns } })), 'history-domain-mismatch');
  // record-level namespace mismatch inside a correctly-labelled history
  const mixed = encoded(records, householdId, ns);
  refused(R.validateRestoreInput(input({ historyBytes: mixed.historyBytes, historyAnchor: mixed.checkpoint })), 'history-domain-mismatch');
  // malformed domain
  for (const d of [{ householdId: 'household-x' }, { ledgerNamespace: 'ledger-x' }]) refused(R.validateRestoreInput(input({ domain: d })), 'domain-malformed');
});

test('malformed or ambiguous history refuses', async () => {
  const { ns, snaps, input } = await world();
  const record = JSON.parse(snaps.history[1]).records[0];
  const dup = encoded([record, { ...record, generation: 'generation-' + '9'.repeat(32) }], householdId, ns);
  refused(R.validateRestoreInput(input({ historyBytes: dup.historyBytes, historyAnchor: dup.checkpoint })), 'history-invalid');
  const notCert = encoded([{ ...record, schema: 'terminal-certificate-1' }], householdId, ns);
  refused(R.validateRestoreInput(input({ historyBytes: notCert.historyBytes, historyAnchor: notCert.checkpoint })), 'history-invalid');
  const body = JSON.parse(snaps.history[1]);
  for (const mutate of [b => { b.revision = 2; }, b => { b.schema = 'terminal-history-0'; }, b => { b.extra = 1; }, b => { delete b.records; }]) {
    const b = JSON.parse(JSON.stringify(body)); mutate(b); const { digest, ...payload } = b;
    const rebuilt = Buffer.from(JSON.stringify({ ...payload, digest: b.records ? C.digest(payload) : digest }));
    refused(R.validateRestoreInput(input({ historyBytes: rebuilt })), 'history-invalid');
  }
  refused(R.validateRestoreInput(input({ historyBytes: Buffer.alloc(R.MAX_HISTORY_BYTES + 1, 0x20) })), 'history-invalid');
});

test('negative-certificate/financial operationId overlap refuses', async () => {
  const { ns, snaps, input } = await world();
  const record = JSON.parse(snaps.history[1]).records[0];
  assert.equal(record.operationId, op(3));
  for (const n of [1, 2]) {
    const overlap = encoded([{ ...record, operationId: op(n) }], householdId, ns);
    refused(R.validateRestoreInput(input({ historyBytes: overlap.historyBytes, historyAnchor: overlap.checkpoint })), 'negative-financial-overlap');
  }
});

test('inputs are snapshotted at call time and accessors are never invoked', async () => {
  const { snaps, input } = await world();
  const i = input(); const before = R.validateRestoreInput(i);
  i.candidate.ledgerBytes.fill(0); i.anchors.ledger.revision = 99; i.domain.householdId = otherHousehold;
  assert.equal(before.status, 'valid'); assert.equal(before.ledger.revision, 2); assert.equal(before.householdId, householdId);
  // Uint8Array view over a larger buffer: only the view is copied
  const big = new Uint8Array(snaps.ledger[2].length + 8); big.set(snaps.ledger[2], 4);
  assert.equal(R.validateRestoreInput(input({ ledgerBytes: big.subarray(4, 4 + snaps.ledger[2].length) })).status, 'valid');
  let invoked = 0;
  const j = input(); Object.defineProperty(j.candidate, 'ledgerBytes', { enumerable: true, get() { invoked++; return snaps.ledger[2]; } });
  refused(R.validateRestoreInput(j), 'input-malformed');
  const k = input(); Object.defineProperty(k.anchors.history, 'digest', { enumerable: true, get() { invoked++; return 'x'; } });
  refused(R.validateRestoreInput(k), 'anchor-malformed');
  assert.equal(invoked, 0);
  refused(R.validateRestoreInput({ ...input(), [Symbol('x')]: 1 }), 'input-malformed');
  refused(R.validateRestoreInput(Object.assign(Object.create({ inherited: 1 }), input())), 'input-malformed');
});

test('diagnostic canaries: refusals carry only a fixed reason', async () => {
  const { snaps, input } = await world();
  const canary = 'CANARY-' + 'z'.repeat(16);
  const cases = [
    input({ ledgerBytes: Buffer.from('{"' + canary + '":') }),
    input({ historyBytes: Buffer.from(canary) }),
    input({ ledgerAnchor: { revision: 2, documentDigest: canary } }),
    input({ domain: { householdId: canary } }),
    input({ ledgerBytes: snaps.ledger[1] }),
  ];
  const secrets = [canary, JSON.parse(snaps.ledger[2]).digest, JSON.parse(snaps.ledger[1]).digest, JSON.parse(snaps.history[1]).digest];
  for (const c of cases) {
    const r = R.validateRestoreInput(c);
    assert.equal(r.status, 'refused'); assert.deepEqual(Object.keys(r), ['status', 'reason']);
    assert.ok(R.RESTORE_INPUT_REFUSALS.includes(r.reason));
    const text = JSON.stringify(r); for (const s of secrets) assert.equal(text.includes(s), false);
  }
});

test('zero I/O, no ambient configuration and no rollback-floor or registry side effects', async () => {
  // Source scan (static): only the two pure primitives are required and no
  // ambient/IO surface is referenced. Labelled as a static check.
  const src = fs.readFileSync(MODULE, 'utf8');
  const requires = [...src.matchAll(/require\(([^)]*)\)/g)].map(m => m[1]);
  assert.deepEqual(requires, ["'./planned-obligation-settlement-contract'", "'./settlement-evidence-terminal-certificate'"]);
  for (const word of ['process.', 'globalThis', 'fetch(', 'setTimeout', 'Date.now', 'qualifySnapshot(', 'registerDomain(', 'eval('])
    assert.equal(src.includes(word), false, word);
  // Runtime: the validator is synchronous and never reaches the stateful
  // terminal primitives (spied) nor fs (spied).
  const { snaps, ns, input, historyAnchor } = await world();
  const spied = [], originals = {};
  for (const [obj, name] of [[TC, 'qualifySnapshot'], [TC, 'registerDomain'], [fs, 'readFileSync'], [fs, 'writeFileSync'], [fs, 'openSync']]) {
    originals[name] = obj[name]; obj[name] = (...a) => { spied.push(name); return originals[name].apply(obj, a); };
  }
  let result;
  try { result = R.validateRestoreInput(input()); } finally { for (const [obj, name] of [[TC, 'qualifySnapshot'], [TC, 'registerDomain'], [fs, 'readFileSync'], [fs, 'writeFileSync'], [fs, 'openSync']]) obj[name] = originals[name]; }
  assert.equal(typeof result.then, 'undefined'); assert.equal(result.status, 'valid'); assert.deepEqual(spied, []);
  // Rollback floor is not advanced: establish a floor at history revision 0
  // on an independent domain object, validate the revision-1 pair, then a
  // revision-0 snapshot still qualifies for that domain (floor unchanged).
  const domainRef = { householdId, ledgerNamespace: ns };
  TC.qualifySnapshot({ historyBytes: snaps.history[0], checkpoint: historyAnchor(snaps.history[0]) }, domainRef);
  assert.equal(R.validateRestoreInput(input()).status, 'valid');
  assert.doesNotThrow(() => TC.qualifySnapshot({ historyBytes: snaps.history[0], checkpoint: historyAnchor(snaps.history[0]) }, domainRef));
});

// ---- Repair for Atlas #707 review (BLOCK 1 and BLOCK 2) and differential parity ----

test('BLOCK 1: byte copying uses intrinsic typed-array views, never caller-shadowable properties', async () => {
  const { snaps, input } = await world();
  const valid = Buffer.from(snaps.ledger[2]);
  // A zero-filled Buffer (rejected by C.pin) whose own data properties point
  // at a different, valid byte range: the zero bytes are what must be read.
  const backing = Buffer.concat([Buffer.alloc(valid.length), valid]);
  const zeros = backing.subarray(0, valid.length);
  assert.throws(() => C.pin(Buffer.from(zeros), householdId));
  Object.defineProperties(zeros, {
    buffer: { value: backing.buffer, enumerable: true },
    byteOffset: { value: backing.byteOffset + valid.length, enumerable: true },
    byteLength: { value: valid.length, enumerable: true },
    length: { value: valid.length, enumerable: true },
  });
  refused(R.validateRestoreInput(input({ ledgerBytes: zeros })), 'ledger-invalid');
  // Same shape with getters on the view: they must never execute.
  let invoked = 0;
  const zeros2 = Buffer.concat([Buffer.alloc(valid.length), valid]).subarray(0, valid.length);
  for (const name of ['buffer', 'byteOffset', 'byteLength', 'length', 'slice', 'subarray'])
    Object.defineProperty(zeros2, name, { enumerable: true, get() { invoked++; return undefined; } });
  refused(R.validateRestoreInput(input({ ledgerBytes: zeros2 })), 'ledger-invalid');
  assert.equal(invoked, 0);
  // Overridable methods on the view are not consulted for the history copy either.
  const hist = Buffer.from(snaps.history[1]);
  hist.slice = hist.subarray = () => { invoked++; return Buffer.from('[]'); };
  assert.equal(R.validateRestoreInput(input({ historyBytes: hist })).status, 'valid');
  assert.equal(invoked, 0);
  // Objects that only inherit from Uint8Array.prototype are not byte views.
  refused(R.validateRestoreInput(input({ ledgerBytes: Object.create(Uint8Array.prototype) })), 'input-malformed');
  refused(R.validateRestoreInput(input({ historyBytes: Object.create(Buffer.prototype) })), 'input-malformed');
  // Other typed arrays are not accepted as bytes.
  refused(R.validateRestoreInput(input({ ledgerBytes: new Uint16Array(4) })), 'input-malformed');
});

// Wraps a value in n nested arrays.
const nest = (v, n) => { for (let i = 0; i < n; i++) v = [v]; return v; };

test('BLOCK 2: history goes through the same own() depth/data rules as qualifySnapshot', async () => {
  const { ns, snaps, input } = await world();
  const record = JSON.parse(snaps.history[1]).records[0];
  const deep = encoded([{ ...record, actorId: nest(record.actorId, 30) }], householdId, ns);
  // The shipped primitive rejects it on a fresh throwaway domain object.
  assert.throws(() => TC.qualifySnapshot({ historyBytes: deep.historyBytes, checkpoint: deep.checkpoint }, { householdId, ledgerNamespace: ns }));
  refused(R.validateRestoreInput(input({ historyBytes: deep.historyBytes, historyAnchor: deep.checkpoint })), 'history-invalid');
});

test('differential parity: the validator never accepts a history variant that qualifySnapshot rejects', async () => {
  const { ns, snaps, input } = await world();
  const base = JSON.parse(snaps.history[1]), record = base.records[0];
  const variants = [['shipped exact', snaps.history[1], null]];
  const add = (name, records, hh = householdId, n = ns) => { const e = encoded(records, hh, n); variants.push([name, e.historyBytes, e.checkpoint]); };
  for (const field of ['actorId', 'generation', 'operationId', 'householdId', 'ledgerNamespace'])
    for (const depth of [1, 2, 20, 21, 22, 23, 30]) add(field + ' nested ' + depth, [{ ...record, [field]: nest(record[field], depth) }]);
  add('genesis', []);
  add('two records', [record, { ...record, operationId: op(9) }]);
  add('duplicate operationId', [record, { ...record, generation: 'generation-' + '9'.repeat(32) }]);
  add('foreign namespace record', [{ ...record, ledgerNamespace: otherNamespace }]);
  add('extra record field', [{ ...record, extra: 1 }]);
  add('decidedAt zero', [{ ...record, decidedAt: 0 }]);
  add('unknown reason', [{ ...record, reason: 'other' }]);
  add('nested reason', [{ ...record, reason: [record.reason] }]);
  add('kind object', [{ ...record, kind: { k: 'link' } }]);
  // Raw text variants that JSON.stringify cannot produce from encoded().
  const text = snaps.history[1].toString('utf8');
  variants.push(['negative zero decidedAt', Buffer.from(text.replace(/"decidedAt":(\d+)/, '"decidedAt":-0')), null]);
  variants.push(['__proto__ key', Buffer.from(text.replace('{"schema":"terminal-history-1"', '{"__proto__":{},"schema":"terminal-history-1"')), null]);
  variants.push(['fractional expectedRevision', Buffer.from(text.replace(/"expectedRevision":(\d+)/, '"expectedRevision":$1.5')), null]);
  variants.push(['large exponent revision', Buffer.from(text.replace(/"revision":1,/, '"revision":1e0,')), null]);
  let accepted = 0, rejectedBoth = 0;
  for (const [name, bytes, checkpoint] of variants) {
    let anchor = checkpoint;
    if (!anchor) { try { const v = JSON.parse(bytes); anchor = { schema: 'terminal-history-checkpoint-1', householdId: v.householdId, ledgerNamespace: v.ledgerNamespace, revision: v.revision, digest: v.digest }; } catch { anchor = null; } }
    if (!anchor || typeof anchor.digest !== 'string' || !/^[a-f0-9]{64}$/.test(anchor.digest)) anchor = { schema: 'terminal-history-checkpoint-1', householdId, ledgerNamespace: ns, revision: 1, digest: '0'.repeat(64) };
    // Isolated domain object per variant: no shared rollback floor.
    let shipped = true;
    try { TC.qualifySnapshot({ historyBytes: Buffer.from(bytes), checkpoint: anchor }, { householdId, ledgerNamespace: ns }); } catch { shipped = false; }
    const v = R.validateRestoreInput(input({ historyBytes: Buffer.from(bytes), historyAnchor: anchor }));
    // History-only verdict: the overlap rule is validator-only, so map it to accept.
    const mine = v.status === 'valid' || v.reason === 'negative-financial-overlap';
    if (mine) { assert.equal(shipped, true, 'validator accepted a variant qualifySnapshot rejects: ' + name); accepted++; }
    else rejectedBoth += shipped ? 0 : 1;
    if (shipped) assert.equal(mine, true, 'validator refused a variant qualifySnapshot accepts: ' + name + ' (' + v.reason + ')');
  }
  assert.ok(accepted >= 3 && rejectedBoth >= 10, `accepted=${accepted} rejectedBoth=${rejectedBoth}`);
});
