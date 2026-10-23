'use strict';

// ATLAS-080 — pure settlement-evidence resolver foundation. NOT completion
// and NOT production integration: this module is imported by no production
// path, supplies no authorize, no route, no configuration and no identity
// assignment, and the composed production stack remains exactly as dark as
// the shipped controller's header describes. It implements the identity and
// binding half of the resolver contract from RESOLVER-CONTRACT-v2 and its
// addendum, against an INJECTED acquisition:
//
//   acquire() -> { packet, join, plan, map }
//
// - packet: the current-period packet P (schema atlas-current-period-actuals/v1)
//   exactly as the sanitizer pass emitted it. Packet rows carry local ids
//   only; native identity is deliberately absent from the packet.
// - join: the crosswalk provenance of that same pass — one entry per emitted
//   packet row naming the EXACT native tuple that produced it:
//   { localId, providerAccountId, transactionId }. Resolution keys on this
//   explicit tuple-to-emitted-row provenance, never on the pass's id map
//   plus a side guard: a normalized row the sanitizer dropped before id
//   assignment (e.g. a null-amount sibling sharing a native id) has no join
//   entry and therefore resolves to nothing, never to a surviving sibling's
//   row. Ambiguity (a tuple with no emitted row, a tuple with several, a
//   local id with several rows, a row with several producers) fails closed.
// - plan: the canonical authoritative plan (commitments included).
// - map: the provider account map document, exactly as acquired.
//
// The production exporter that would surface (packet, join) from one real
// sanitizer pass is UNIMPLEMENTED (addendum section A.8); in tests the
// acquisition is a labelled synthetic fixture standing in for it. This
// module contains no join reconstruction of any kind: no reimplementation
// of the pass's id assignment, no card-coverage-reference join, and no
// identity inference from amount, date, payee or row position (A.7).
//
// authorize is NOT implemented here and is not an export: the session
// identity mechanism it requires is a separately priced, unapproved
// dependency (contract P1). The controller's fixture authorize in tests is
// a labelled synthetic mapping, the posture the controller already ships.
//
// Identification is current-derivation only (PR #671 Systems Review B1
// repair): handles are deterministic derivations over content digests, and
// a presented handle pair identifies ONLY by matching derivations computed
// from the CURRENT acquisition. There is deliberately NO identification
// memo and no other use of process history: a factory that resolved a pair
// a moment ago and a factory in a fresh process behave identically over
// identical current content. Content inside handle derivation (a packet
// row, the plan) changing re-mints the affected handle, so the old pair
// resolves to null and an in-flight confirm fails closed as
// selection-unavailable through the unchanged controller; drift OUTSIDE
// handle derivation (packet permutation, packet-envelope fields such as
// coverageStart or observationAsOf, the account map) leaves the pair
// resolvable, re-derives fresh bindings from current content, and the
// controller's deep compare refuses that drift as selection-changed.
// A tuple or goal absent from the current acquisition resolves to null,
// and with no current acquisition nothing resolves at all (E3).
// Foreign or fabricated handles match no current derivation and resolve
// to null (AC-31, AC-33 as corrected).
//
// Write admission pairing: resolvePairedSelection runs the identical
// resolution as resolveSelection and additionally returns the freshness
// witness the acquisition itself carries (an own data property named
// 'witness' holding a function), paired with that exact acquisition. The
// witness is a live capability, not data: it is read by descriptor only,
// never snapshotted, serialized, digested, logged or invoked here, and
// functions or revision tokens never enter selection JSON, digests,
// commands or receipts. An acquisition carrying no genuine function
// witness pairs nothing.
//
// Hash strength, stated correctly: txRef and the handles are 128-bit
// truncations of SHA-256 digests. A 128-bit truncated output has roughly
// 64-bit generic birthday collision strength, NOT 128-bit collision
// strength. txRef v1 is frozen regardless (contract section 2.4): budgets
// key solely on txRef and the pair guard on (goalId, txRef), so this
// module keeps the shipped instance-level collision detection (two
// distinct tuples deriving one txRef refuse the whole instance) and
// offers no alternate derivation or fallback ref of any kind.

const crypto = require('node:crypto');
const C = require('./planned-obligation-settlement-contract');

const HOUSEHOLD_PATTERN = /^household-[a-f0-9]{32}$/;
const SELECTION_PATTERN = /^selection-[a-f0-9]{32}$/;
const CHOICE_PATTERN = /^choice-[a-f0-9]{32}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PROVIDER = 'lunchmoney';

// ---------------------------------------------------------------------------
// BIND — the binding encoding (addendum section B). A tagged, length/count
// framed byte grammar over plain data, hashed as SHA-256 of
// "atlas-bind/v1\n" followed by the encoded bytes. BIND is used ONLY for
// resolver binding material; it never enters a command, preview, document
// or journal, and the ledger canonicalization in the contract module is
// untouched and never reused here (its integer-only domain cannot encode
// the float- and undefined-bearing values bindings must cover).
// ---------------------------------------------------------------------------

const BIND_PREFIX = Buffer.from('atlas-bind/v1\n', 'utf8');
const BIND_LIMITS = Object.freeze({
  maxDepth: 20,
  maxNodes: 250000,
  maxBytes: 33554432,
  maxStringBytes: 8388608,
  maxKeyBytes: 65536,
  maxKeysPerRecord: 20000,
  maxArrayLength: 100000,
});

function bindError(message) {
  const error = new Error('settlement-evidence-resolver bind: ' + message);
  error.code = 'bind-rejected';
  return error;
}

// WTF-8: standard UTF-8 extended so an unpaired surrogate encodes as its
// own 3-byte sequence instead of being lossily replaced by U+FFFD. The
// encoding is injective over all JS strings.
function wtf8ByteLength(value) {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit < 0x80) { bytes += 1; continue; }
    if (unit < 0x800) { bytes += 2; continue; }
    if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) { bytes += 4; i++; continue; }
    }
    bytes += 3;
  }
  return bytes;
}

function wtf8Encode(value) {
  const out = Buffer.alloc(wtf8ByteLength(value));
  let offset = 0;
  for (let i = 0; i < value.length; i++) {
    let cp = value.charCodeAt(i);
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (next - 0xDC00);
        i++;
      }
    }
    if (cp < 0x80) { out[offset++] = cp; } else if (cp < 0x800) {
      out[offset++] = 0xC0 | (cp >> 6); out[offset++] = 0x80 | (cp & 0x3F);
    } else if (cp < 0x10000) {
      out[offset++] = 0xE0 | (cp >> 12); out[offset++] = 0x80 | ((cp >> 6) & 0x3F);
      out[offset++] = 0x80 | (cp & 0x3F);
    } else {
      out[offset++] = 0xF0 | (cp >> 18); out[offset++] = 0x80 | ((cp >> 12) & 0x3F);
      out[offset++] = 0x80 | ((cp >> 6) & 0x3F); out[offset++] = 0x80 | (cp & 0x3F);
    }
  }
  return out;
}

function isArrayIndex(key, length) {
  if (!/^(0|[1-9]\d*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index < length;
}

// Shared grammar discipline for the encoder and the snapshot: reads own
// property descriptors only, so accessors are rejected WITHOUT ever being
// invoked, symbol keys and non-enumerable properties reject, non-plain
// prototypes reject, and a value's toJSON can never affect anything (it is
// never read; an own function value rejects as a function).
function ownDataDescriptors(value, isArray) {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = [];
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') throw bindError('symbol property');
    if (isArray && key === 'length') continue;
    if (isArray && !isArrayIndex(key, value.length)) throw bindError('array extra property');
    const descriptor = descriptors[key];
    if (!descriptor.enumerable) throw bindError('non-enumerable property');
    if (!Object.hasOwn(descriptor, 'value')) throw bindError('accessor property');
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function encodeChunk(state, chunk) {
  if (state.bytes + chunk.length > BIND_LIMITS.maxBytes) throw bindError('output byte bound exceeded');
  state.chunks.push(chunk);
  state.bytes += chunk.length;
}

function encodeNode(state) {
  state.nodes += 1;
  if (state.nodes > BIND_LIMITS.maxNodes) throw bindError('node bound exceeded');
}

function encodeInto(state, value, depth, ancestors) {
  encodeNode(state);
  if (value === null) return encodeChunk(state, Buffer.from('z'));
  if (value === undefined) return encodeChunk(state, Buffer.from('u'));
  if (value === false) return encodeChunk(state, Buffer.from('f'));
  if (value === true) return encodeChunk(state, Buffer.from('t'));
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw bindError('non-finite number');
    const spelling = Object.is(value, -0) ? '-0' : String(value);
    return encodeChunk(state, Buffer.from('n' + spelling.length + ':' + spelling, 'utf8'));
  }
  if (type === 'string') {
    const byteLength = wtf8ByteLength(value);
    if (byteLength > BIND_LIMITS.maxStringBytes) throw bindError('string byte bound exceeded');
    encodeChunk(state, Buffer.from('s' + byteLength + ':'));
    return encodeChunk(state, wtf8Encode(value));
  }
  if (type !== 'object') throw bindError('unsupported value type');
  if (depth > BIND_LIMITS.maxDepth) throw bindError('depth bound exceeded');
  if (ancestors.has(value)) throw bindError('cyclic structure');
  if (Array.isArray(value)) {
    // The length bound is checked before any slot is visited or expanded.
    if (value.length > BIND_LIMITS.maxArrayLength) throw bindError('array length bound exceeded');
    ownDataDescriptors(value, true);
    ancestors.add(value);
    encodeChunk(state, Buffer.from('a' + value.length + ':'));
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor) {
        encodeNode(state);
        encodeChunk(state, Buffer.from('h'));
        continue;
      }
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw bindError('array slot is not enumerable data');
      }
      encodeInto(state, descriptor.value, depth + 1, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw bindError('non-plain object');
  const entries = ownDataDescriptors(value, false);
  if (entries.length > BIND_LIMITS.maxKeysPerRecord) throw bindError('record key bound exceeded');
  // Key-byte preflight (B4): cumulative framed key bytes are totalled from
  // lengths alone and checked against the remaining output budget BEFORE
  // any encoded-key buffer is allocated — a record of hundreds of
  // max-length keys must refuse without first allocating tens of megabytes
  // of key buffers the budget was always going to reject.
  const keyByteLengths = entries.map(([key]) => {
    const byteLength = wtf8ByteLength(key);
    if (byteLength > BIND_LIMITS.maxKeyBytes) throw bindError('key byte bound exceeded');
    return byteLength;
  });
  const headerBytes = 1 + String(entries.length).length + 1;
  let framedKeyBytes = 0;
  for (const byteLength of keyByteLengths) framedKeyBytes += 1 + String(byteLength).length + 1 + byteLength;
  if (state.bytes + headerBytes + framedKeyBytes > BIND_LIMITS.maxBytes) {
    throw bindError('output byte bound exceeded');
  }
  ancestors.add(value);
  encodeChunk(state, Buffer.from('o' + entries.length + ':'));
  const encodedKeys = entries.map(([key]) => {
    encodeNode(state);
    return { key, bytes: wtf8Encode(key) };
  });
  // Keys sort by lexicographic WTF-8 byte order (no locale, no collation).
  encodedKeys.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
  const byKey = new Map(entries);
  for (const { key, bytes } of encodedKeys) {
    encodeChunk(state, Buffer.from('s' + bytes.length + ':'));
    encodeChunk(state, bytes);
    encodeInto(state, byKey.get(key), depth + 1, ancestors);
  }
  ancestors.delete(value);
}

function bindEncode(value) {
  const state = { nodes: 0, bytes: 0, chunks: [] };
  encodeInto(state, value, 1, new Set());
  return Buffer.concat(state.chunks, state.bytes);
}

function bindDigest(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw bindError('top level must be a plain record');
  }
  const proto = Object.getPrototypeOf(record);
  if (proto !== Object.prototype && proto !== null) throw bindError('top level must be a plain record');
  const domain = Object.getOwnPropertyDescriptor(record, 'domain');
  if (!domain || !Object.hasOwn(domain, 'value') || typeof domain.value !== 'string') {
    throw bindError('top level requires a string domain');
  }
  return crypto.createHash('sha256').update(BIND_PREFIX).update(bindEncode(record)).digest('hex');
}

// The owned acquisition snapshot (addendum section B.10): a deep copy that
// accepts exactly BIND's domain with exactly BIND's rejections — same
// descriptor discipline (getters never invoked), same bounds, checked
// incrementally before expansion or allocation. It preserves key presence
// (including present-undefined), array holes, -0 and exact strings; it is
// never a JSON round-trip and never the controller's integer-only snapshot.
// Construction is descriptor-safe: an own __proto__ key is copied as an
// own data property via defineProperty, without prototype mutation, and
// array holes are left as holes (never materialized through inherited
// indexed getters). Copies are Object.prototype records and true arrays.
function snapshotNode(state) {
  state.nodes += 1;
  if (state.nodes > BIND_LIMITS.maxNodes) throw bindError('node bound exceeded');
}

// The snapshot's byte budget is the ENCODER's budget, accounted
// incrementally in exactly the chunks the encoder emits — one-byte tags,
// 'n'/'s'/'a'/'o' length/count headers and content, framing included (B4).
// Raw content bytes alone are NOT the budget: length-prefixed strings and
// keys cost their headers too, so a value passes this snapshot iff its
// encoded form fits maxBytes — parity pinned at the exact limit and at
// limit-plus-one for both paths.
function snapshotCharge(state, bytes) {
  state.bytes += bytes;
  if (state.bytes > BIND_LIMITS.maxBytes) throw bindError('total byte bound exceeded');
}

function framedHeaderBytes(length) {
  return 1 + String(length).length + 1;
}

function snapshotInto(state, value, depth, ancestors) {
  snapshotNode(state);
  if (value === null || typeof value === 'boolean' || value === undefined) {
    snapshotCharge(state, 1);
    return value;
  }
  const type = typeof value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw bindError('non-finite number');
    const spelling = Object.is(value, -0) ? '-0' : String(value);
    snapshotCharge(state, framedHeaderBytes(spelling.length) + spelling.length);
    return value;
  }
  if (type === 'string') {
    const byteLength = wtf8ByteLength(value);
    if (byteLength > BIND_LIMITS.maxStringBytes) throw bindError('string byte bound exceeded');
    snapshotCharge(state, framedHeaderBytes(byteLength));
    snapshotCharge(state, byteLength);
    return value;
  }
  if (type !== 'object') throw bindError('unsupported value type');
  if (depth > BIND_LIMITS.maxDepth) throw bindError('depth bound exceeded');
  if (ancestors.has(value)) throw bindError('cyclic structure');
  if (Array.isArray(value)) {
    if (value.length > BIND_LIMITS.maxArrayLength) throw bindError('array length bound exceeded');
    ownDataDescriptors(value, true);
    ancestors.add(value);
    snapshotCharge(state, framedHeaderBytes(value.length));
    const copy = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor) {
        snapshotNode(state);
        snapshotCharge(state, 1);
        continue;
      }
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw bindError('array slot is not enumerable data');
      }
      copy[i] = snapshotInto(state, descriptor.value, depth + 1, ancestors);
    }
    ancestors.delete(value);
    return copy;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw bindError('non-plain object');
  const entries = ownDataDescriptors(value, false);
  if (entries.length > BIND_LIMITS.maxKeysPerRecord) throw bindError('record key bound exceeded');
  ancestors.add(value);
  snapshotCharge(state, framedHeaderBytes(entries.length));
  const copy = {};
  for (const [key, entryValue] of entries) {
    snapshotNode(state);
    const byteLength = wtf8ByteLength(key);
    if (byteLength > BIND_LIMITS.maxKeyBytes) throw bindError('key byte bound exceeded');
    snapshotCharge(state, framedHeaderBytes(byteLength));
    snapshotCharge(state, byteLength);
    Object.defineProperty(copy, key, {
      value: snapshotInto(state, entryValue, depth + 1, ancestors),
      enumerable: true, writable: true, configurable: true,
    });
  }
  ancestors.delete(value);
  return copy;
}

function bindSnapshot(value) {
  return snapshotInto({ nodes: 0, bytes: 0 }, value, 1, new Set());
}

function freezeDeep(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.keys(value)) freezeDeep(value[key], seen);
  return Object.freeze(value);
}

// ---------------------------------------------------------------------------
// Derivations. txRef keeps the ledger's own canonical digest (its record is
// all strings, so that digest is total over it); everything that must cover
// float- or undefined-bearing content uses BIND.
// ---------------------------------------------------------------------------

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function deriveTxRef(identity) {
  if (!identity || typeof identity !== 'object'
    || typeof identity.householdId !== 'string' || !HOUSEHOLD_PATTERN.test(identity.householdId)
    || !nonEmptyString(identity.providerAccountId) || !nonEmptyString(identity.transactionId)) {
    throw new Error('settlement-evidence-resolver: txRef requires a complete identity tuple');
  }
  return 'tx-' + C.digest({
    domain: 'atlas-settlement-txref/v1',
    householdId: identity.householdId,
    provider: PROVIDER,
    providerAccountId: identity.providerAccountId,
    transactionId: identity.transactionId,
  }).slice(0, 32);
}

function computePacketRowDigest(row) {
  return bindDigest({ domain: 'atlas-settlement-packet-row/v1', row });
}

function computePlanDigest(plan) {
  return bindDigest({ domain: 'atlas-settlement-plan/v1', plan });
}

function computePacketDigest(packet) {
  return bindDigest({ domain: 'atlas-settlement-packet/v1', packet });
}

function computeAccountMapDigest(map) {
  return bindDigest({ domain: 'atlas-settlement-account-map/v1', accountMap: map });
}

function computeInstanceDigest(packet) {
  const rowDigests = packet.transactions.map(row => computePacketRowDigest(row));
  rowDigests.sort();
  return bindDigest({
    domain: 'atlas-settlement-observation-instance/v1',
    provider: PROVIDER,
    transactionWindow: packet.transactionWindow,
    pendingCoverage: packet.pendingCoverage,
    rows: rowDigests,
  });
}

function deriveSelectionHandle(instanceDigest, tuple) {
  return 'selection-' + C.digest({
    domain: 'atlas-settlement-selection-handle/v1',
    instanceDigest,
    identity: {
      householdId: tuple.householdId,
      provider: PROVIDER,
      providerAccountId: tuple.providerAccountId,
      transactionId: tuple.transactionId,
    },
  }).slice(0, 32);
}

function deriveChoiceHandle(planDigest, goalId) {
  return 'choice-' + C.digest({
    domain: 'atlas-settlement-choice-handle/v1',
    planDigest,
    goalId,
  }).slice(0, 32);
}

// The household namespace is a pure function of the assigned id (contract
// section 5, N2). This derives the namespace for a given id; it assigns
// nothing — which id is the household's, and when it is set, stays an
// owner-gated deployment decision (N6), and a resolver cannot even be
// constructed without one (absent configuration is the shipped darkness).
function settlementNamespace(householdId) {
  if (typeof householdId !== 'string' || !HOUSEHOLD_PATTERN.test(householdId)) {
    throw new Error('settlement-evidence-resolver: namespace requires a contract-valid household id');
  }
  return 'settlement-' + householdId.slice('household-'.length);
}

// ---------------------------------------------------------------------------
// The resolver factory.
// ---------------------------------------------------------------------------

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validDateString(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

// Shared by catalogue and resolution. The catalogue is provisional; only the
// unchanged controller may admit a selection through Forecast.
function selectionEvidence(entry, map, asOf) {
  const mappings = map.mappings.filter(candidate => plainRecord(candidate)
    && candidate.providerAccountId != null
    && String(candidate.providerAccountId) === entry.providerAccountId);
  if (mappings.length !== 1) return null;
  const mapping = mappings[0];
  if (!plainRecord(mapping.canonical) || typeof mapping.canonical.id !== 'string') return null;
  const accountId = mapping.canonical.id, row = entry.row;
  if (!IDENTIFIER_PATTERN.test(accountId)
    || (row.atlasAccountId != null && String(row.atlasAccountId) !== accountId)
    || row.pending !== false || row.isIncome === true || row.currency !== 'cad'
    || typeof row.amount !== 'number' || !Number.isFinite(row.amount) || row.amount <= 0) return null;
  const centsFloat = row.amount * 100, cents = Math.round(centsFloat);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(centsFloat - cents) >= 1e-7
    || !validDateString(row.date) || row.date > asOf) return null;
  return { accountId, currency: 'cad', direction: 'debit', date: row.date, cents, posted: true };
}
function boundedLabel(value, fallback) {
  return (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim().slice(0, 80) : '') || fallback;
}

function createSettlementEvidenceResolver(deps) {
  if (!plainRecord(deps)) throw new TypeError('settlement-evidence-resolver: dependencies required');
  const { householdId, acquire } = deps;
  if (typeof householdId !== 'string' || !HOUSEHOLD_PATTERN.test(householdId)) {
    throw new TypeError('settlement-evidence-resolver: a contract-valid householdId is required');
  }
  if (typeof acquire !== 'function') {
    throw new TypeError('settlement-evidence-resolver: an injected acquisition is required — '
      + 'the production crosswalk exporter is unimplemented and no default acquisition exists');
  }
  async function resolveSelectionCore(input) {
    let classifyError = null;
    try {
      if (!plainRecord(input) || !plainRecord(input.authority)) return null;
      const { authority, selection, classify } = input;
      if (authority.householdId !== householdId) return null;
      const catalogue = input.catalogue === true;
      if (!catalogue && (!plainRecord(selection) || typeof classify !== 'function')) return null;
      const presentedSelection = selection?.transaction;
      const presentedChoice = selection?.commitment;
      if (!catalogue && (typeof presentedSelection !== 'string' || !SELECTION_PATTERN.test(presentedSelection))) return null;
      if (!catalogue && (typeof presentedChoice !== 'string' || !CHOICE_PATTERN.test(presentedChoice))) return null;

      const raw = await acquire();
      if (!plainRecord(raw)) return null;
      // Every required envelope field is obtained via its validated own
      // DATA descriptor (B3): reading raw.packet directly would invoke an
      // enumerable getter on the acquisition object before ownership, so
      // an accessor (or missing) field refuses resolution WITHOUT being
      // invoked. Unrelated envelope metadata is never read at all.
      const envelope = {};
      for (const field of ['packet', 'join', 'plan', 'map']) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, field);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
        envelope[field] = descriptor.value;
      }
      // The paired witness is captured in the SAME uninterrupted snapshot
      // continuation (B3): its validated own DATA descriptor is read here,
      // before classification, and the local reference is carried through
      // the core's return. Rereading the retained mutable envelope after
      // the core's asynchronous boundary would let a mutation queued
      // during classification substitute a different witness for this
      // owned selection. An accessor or non-function witness is captured
      // as absent — never invoked.
      let pairedWitness = null;
      const witnessDescriptor = Object.getOwnPropertyDescriptor(raw, 'witness');
      if (witnessDescriptor && Object.hasOwn(witnessDescriptor, 'value')
        && typeof witnessDescriptor.value === 'function') {
        pairedWitness = witnessDescriptor.value;
      }
      // One coherent acquisition, consumed as owned frozen snapshots: after
      // this point derivation and the single classify invocation run in one
      // synchronous continuation, and no source object is read again.
      const packet = freezeDeep(bindSnapshot(envelope.packet));
      const join = freezeDeep(bindSnapshot(envelope.join));
      const plan = freezeDeep(bindSnapshot(envelope.plan));
      const map = freezeDeep(bindSnapshot(envelope.map));
      if (!plainRecord(packet) || !Array.isArray(packet.transactions)) return null;
      if (!validDateString(packet.observationAsOf)) return null;
      if (!Array.isArray(join)) return null;
      if (!plainRecord(plan) || !Array.isArray(plan.commitments)) return null;
      if (!plainRecord(map) || !Array.isArray(map.mappings)) return null;
      const asOf = packet.observationAsOf;

      // Crosswalk: explicit tuple -> emitted-row provenance from the same
      // pass (see header). Anything ambiguous is unresolvable, never
      // guessed.
      const rowsByLocalId = new Map();
      for (const row of packet.transactions) {
        if (!plainRecord(row) || typeof row.id !== 'string') return null;
        if (!rowsByLocalId.has(row.id)) rowsByLocalId.set(row.id, []);
        rowsByLocalId.get(row.id).push(row);
      }
      // Tuple identity is structural, never a delimited string (B2): a
      // NUL-joined key collapses ('acct<NUL>one', 't') with ('acct',
      // 'one<NUL>t') into one tuple, and native ids do not exclude NUL.
      // Tuples are keyed by nested Maps — one Map per component — and
      // cross-referenced by record identity: injective by construction.
      const tuplesByAccount = new Map();
      const producersByLocalId = new Map();
      for (const entry of join) {
        if (!plainRecord(entry) || typeof entry.localId !== 'string'
          || !nonEmptyString(entry.providerAccountId) || !nonEmptyString(entry.transactionId)) return null;
        let byTransaction = tuplesByAccount.get(entry.providerAccountId);
        if (!byTransaction) {
          byTransaction = new Map();
          tuplesByAccount.set(entry.providerAccountId, byTransaction);
        }
        let tuple = byTransaction.get(entry.transactionId);
        if (!tuple) {
          tuple = {
            providerAccountId: entry.providerAccountId,
            transactionId: entry.transactionId,
            localIds: new Set(),
          };
          byTransaction.set(entry.transactionId, tuple);
        }
        tuple.localIds.add(entry.localId);
        if (!producersByLocalId.has(entry.localId)) producersByLocalId.set(entry.localId, new Set());
        producersByLocalId.get(entry.localId).add(tuple);
      }
      const resolvable = new Map();
      for (const byTransaction of tuplesByAccount.values()) {
        for (const tuple of byTransaction.values()) {
          if (tuple.localIds.size !== 1) continue;
          const localId = [...tuple.localIds][0];
          const rows = rowsByLocalId.get(localId);
          if (!rows || rows.length !== 1) continue;
          if (producersByLocalId.get(localId).size !== 1) continue;
          resolvable.set(tuple, {
            providerAccountId: tuple.providerAccountId,
            transactionId: tuple.transactionId,
            row: rows[0],
            txRef: deriveTxRef({ householdId, providerAccountId: tuple.providerAccountId, transactionId: tuple.transactionId }),
          });
        }
      }
      // Instance-level txRef uniqueness (contract section 2.2): two
      // distinct tuples deriving one ref refuse the whole instance.
      const refOwners = new Map();
      for (const [tuple, entry] of resolvable) {
        if (refOwners.has(entry.txRef) && refOwners.get(entry.txRef) !== tuple) return null;
        refOwners.set(entry.txRef, tuple);
      }

      const goals = new Map();
      const duplicateGoals = new Set();
      for (const row of plan.commitments) {
        if (!plainRecord(row) || typeof row.id !== 'string') return null;
        if (!IDENTIFIER_PATTERN.test(row.id)) continue;
        const goalId = 'commitment:' + row.id;
        if (goals.has(goalId)) duplicateGoals.add(goalId);
        goals.set(goalId, row);
      }

      const instanceDigest = computeInstanceDigest(packet);
      const planDigest = computePlanDigest(plan);
      const packetDigest = computePacketDigest(packet);
      const accountMapDigest = computeAccountMapDigest(map);

      if (catalogue) {
        const transactions = [], commitments = [];
        const seenTransactions = new Set(), seenCommitments = new Set();
        for (const entry of resolvable.values()) {
          const evidence = selectionEvidence(entry, map, asOf);
          if (!evidence) continue;
          const handle = deriveSelectionHandle(instanceDigest, { householdId,
            providerAccountId: entry.providerAccountId, transactionId: entry.transactionId });
          if (seenTransactions.has(handle)) return null;
          seenTransactions.add(handle);
          transactions.push({ handle, label: boundedLabel(entry.row.displayedPayee, 'Recorded payment'),
            date: evidence.date, currency: evidence.currency, cents: evidence.cents });
        }
        for (const [goalId, row] of goals) {
          if (duplicateGoals.has(goalId)) continue;
          const handle = deriveChoiceHandle(planDigest, goalId);
          if (seenCommitments.has(handle)) return null;
          seenCommitments.add(handle);
          commitments.push({ handle, label: boundedLabel(row.label, 'Planned cost') });
        }
        if (transactions.length > 200 || commitments.length > 200) return null;
        return { transactions, commitments };
      }

      // Identification: current-derivation match (the only identification
      // there is — see the header note). An ambiguous handle in current
      // content (two tuples or two goals deriving it) refuses outright
      // rather than picking one.
      let matchedEntry = null;
      let matchedGoal = null;
      let tupleMatches = 0;
      let goalMatches = 0;
      for (const entry of resolvable.values()) {
        const handle = deriveSelectionHandle(instanceDigest, {
          householdId, providerAccountId: entry.providerAccountId, transactionId: entry.transactionId,
        });
        if (handle === presentedSelection) { tupleMatches++; matchedEntry = entry; }
      }
      for (const [goalId, row] of goals) {
        if (duplicateGoals.has(goalId)) continue;
        if (deriveChoiceHandle(planDigest, goalId) === presentedChoice) {
          goalMatches++;
          matchedGoal = { goalId, row };
        }
      }
      if (tupleMatches > 1 || goalMatches > 1) return null;
      // Identification is the current-derivation match above and nothing
      // else (B1): no memo, no history. A pair that does not match exactly
      // one current tuple derivation and one current goal derivation is
      // unresolvable, however recently it resolved.
      let identified = null;
      if (tupleMatches === 1 && goalMatches === 1) {
        identified = { entry: matchedEntry, goal: matchedGoal };
      }
      if (!identified) return null;
      const { entry, goal } = identified;
      const row = entry.row;

      // Classification: exactly one invocation, on the joined canonical
      // packet row (never a normalized provider row), with both packet
      // aliases the identical owned packet object. The raw verdict is
      // deliberately unused here — the controller projects its own
      // closure's verdict and no verdict field is returned or digested.
      try {
        classify(row, plan, { currentPeriodActuals: packet, packet });
      } catch (error) {
        classifyError = error;
        throw error;
      }

      // Evidence: the posted CAD debit the joined row proves, under the
      // canonical account the map assigns to the tuple's provider account.
      const evidence = selectionEvidence(entry, map, asOf);
      if (!evidence) return null;

      const identity = {
        householdId, source: PROVIDER,
        providerAccountId: entry.providerAccountId, transactionId: entry.transactionId,
      };
      const selectionBinding = bindDigest({
        domain: 'atlas-settlement-selection-binding/v1',
        identity,
        txRef: entry.txRef,
        packetRowDigest: computePacketRowDigest(row),
        planDigest,
        packetDigest,
        accountMapDigest,
        asOf,
      });
      const goalBinding = bindDigest({
        domain: 'atlas-settlement-goal-binding/v1',
        goalId: goal.goalId,
        goalRowDigest: bindDigest({ domain: 'atlas-settlement-goal-row/v1', goal: goal.row }),
        planDigest,
      });
      const qualifiedSelection = {
        matchCount: 1,
        identity,
        txRef: entry.txRef,
        selectionBinding,
        goalId: goal.goalId,
        goalBinding,
        asOf,
        evidence,
      };
      return { selection: qualifiedSelection, acquisition: raw, witness: pairedWitness };
    } catch (error) {
      if (classifyError) throw classifyError;
      return null;
    }
  }

  async function resolveSelection(input) {
    const resolved = await resolveSelectionCore(input);
    return resolved ? resolved.selection : null;
  }

  // The paired capability for acquisition-bound write admission: the same
  // single resolution and single classify invocation as resolveSelection,
  // returning the ordinary selection plus the freshness witness paired
  // with that exact acquisition. The witness is the reference the core
  // captured from the raw acquisition's own DATA descriptor in the same
  // uninterrupted snapshot continuation as the four data fields (B3) —
  // it is never reread from the retained mutable envelope after the
  // core's asynchronous boundary, and it never enters the snapshot /
  // binding path: it is not read as data, serialized, digested, logged
  // or invoked here. Only the caller's trusted composition may carry it
  // to the store's admission fence. An acquisition without a genuine
  // function witness yields no pair.
  async function resolvePairedSelection(input) {
    const resolved = await resolveSelectionCore(input);
    if (!resolved) return null;
    if (typeof resolved.witness !== 'function') return null;
    return { selection: resolved.selection, witness: resolved.witness };
  }

  return Object.freeze({ resolveSelection, resolvePairedSelection,
    catalogue: authority => resolveSelectionCore({ authority, catalogue: true }) });
}

module.exports = {
  createSettlementEvidenceResolver,
  bindEncode,
  bindDigest,
  bindSnapshot,
  freezeDeep,
  deriveTxRef,
  deriveSelectionHandle,
  deriveChoiceHandle,
  computeInstanceDigest,
  computePlanDigest,
  computePacketDigest,
  computeAccountMapDigest,
  computePacketRowDigest,
  settlementNamespace,
  BIND_LIMITS,
};
