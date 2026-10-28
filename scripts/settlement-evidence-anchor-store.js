'use strict';

// Settlement evidence anchor store (INT-5 P-5, slice S1) — the anchor
// unit of the accepted anchor/epoch design (issue #756, design
// revision 4 at fb2ca363): one small store OUTSIDE the backup/restore
// boundary of both the financial evidence store and the authorization
// store, holding three monotone records plus an append-only
// provenance log, over ONE explicitly injected object transport.
//
// FOUNDATION ONLY. This module ships with no production importer, no
// wiring into any store, adapter or decision path, no transport
// implementation, and no filesystem, environment, network, SDK or
// provisioning access of its own. The caller injects the transport
// explicitly; there are no credentials here and nothing to configure.
// The authorization store append (S2/S3), the frontier statement
// reads (S2), the cross-witness module (S3), the decision seam (S4)
// and the named production pin store (S6) are later slices: this
// module supplies the anchor-unit record/provenance contract they
// compose, and the protocol interactions those slices own are
// exercised here through doubles only.
//
// Transport contract (the object adapter's documented contract,
// required at construction — a transport that cannot meet it is
// refused; compare-and-swap is never emulated with an unconditional
// write):
//   read(key)           -> null (proven absence) or
//                          { bytes, version, metadata }.
//   create(key, bytes, metadata)
//                       -> atomic absent-only create; resolves
//                          { version, integrity } with integrity the
//                          SHA-256 hex of the stored bytes; a definite
//                          already-exists outcome throws an error with
//                          code 'conflict'; any other throw is
//                          ambiguous (the write may have landed).
//   replace(key, bytes, version, metadata)
//                       -> atomic replacement conditional on the exact
//                          version token; same acknowledgement shape;
//                          a definite mismatch or absence throws code
//                          'conflict'. (Required as part of the
//                          documented contract; this module's own
//                          writes are create-only — see generations.)
//   list(prefix, cursor)-> { entries: [{ key, metadata }],
//                          nextCursor } with nextCursor null exactly
//                          when the listing is complete. A transport
//                          that cannot enumerate a record's retained
//                          generations through list does not meet
//                          this contract (design section 4, S1).
//
// Generations. Each record's generations are create-only objects
// under a deterministic key; the highest retained generation IS the
// record, and creating generation n+1 — possible only while n+1 is
// absent — is the generation-preconditioned conditional write of the
// design's Candidate B. No object is ever replaced or deleted by
// this module, so retained generations stay readable in generation
// order for the generation-chain replay (design section 2.3.3,
// Phase L). Generation indices are per-record and contiguous from 0
// (genesis); for the authorization record the generation index
// equals the record's epoch.
//
// Records (design sections 2.1, 2.1.1, revision-3 shapes):
//   pin           keyed by household: { incarnation, pin:
//                 { revision, digest, timestamp } } — the shipped pin
//                 payload carried in the anchor record that binds the
//                 unit incarnation the payload itself does not carry.
//   authorization keyed by scope: { scope, incarnation, epoch,
//                 revocationCount, frontierDigest, priorDigest,
//                 lastEventId, updatedAt } — section 2.1's shape plus
//                 the prior frontier digest section 2.3.2 step 5
//                 embeds so every landed generation is self-proving.
//   history       keyed by (householdId, ledgerNamespace):
//                 { incarnation, revision, digest, lastEventId,
//                 updatedAt }.
// Every advance is a compare-and-swap: advance resolves the literal
// true ONLY for an acknowledgement-verified conditional write (the
// ack's integrity must bind the exact intended bytes), the literal
// false ONLY for a definite conflict (the observed record differs
// from the expected record, or the conditional create reports a
// definite already-exists), and throws otherwise — a lost or
// malformed acknowledgement preserves uncertainty and is reconciled
// from observation, never reported as success. Inputs are
// snapshotted at entry. Transitions are validated against the
// EXPECTED record: genesis against proven absence, or a sequential
// advance only — no rollback, no same-revision different-digest
// fork, no skipped revision — and a newly observed winner is never
// adopted as an automatic retry base. A malformed or unreadable
// anchor read throws; absence is proven absence only, never zero.
//
// Provenance (design section 2.3.2). Alongside the records the unit
// keeps an append-only log of create-only entries per record
// identity: genesis entries, intent entries, and exactly one
// terminal entry per intent (ack / void / duplicate-satisfied).
//   intent (authorization): { eventId, revocationKind, key,
//     revokedAt, priorAnchor: { incarnation, epoch, count,
//     frontierDigest } (advisory only — never a CAS base), entry
//     (the canonical entry bytes, hex), status: 'intent' }.
//   intent (history): { eventId, domain: { householdId,
//     ledgerNamespace }, priorPair: { revision, digest },
//     certificate (recorded in full), status: 'intent' }.
//   ack: { eventId, generation, recordHash } — binds the event to
//     the exact landed generation and the hash of its record bytes
//     as written; this module verifies both before writing an ack.
//   duplicate-satisfied: { eventId, owningEventId } — closes a
//     no-op duplicate; a duplicate is never acked, never counted.
// Event identity is deterministic (design sections 2.3.2, 2.4.2):
// retries and duplicates converge on one identity instead of
// creating parallel records.
//
// Admission (INV-ADM, design sections 2.3.2/2.3.3). Opening an
// intent first checks the log: while any intent for the scope (or
// history domain) is non-terminal — states W1-W4; an acked intent
// whose witness observation is not durably recorded is W4 and still
// blocks, because terminal state is W5 (ack + witness observation),
// T-DUP or T-VOID — the new intent is NOT admitted: the call
// resolves the codebase's unknown envelope
// { status: 'unknown', reason: 'anchor-intent-open' } and writes
// nothing. Admission is enforced against the durable log under the
// design's single-composer-per-scope model. Witness observations
// are supplied by the caller (the witness module is S3's); when no
// observations are supplied, nothing counts as witnessed.
//
// Replay, classification, audit (design section 2.3.3). replay
// establishes what landed FIRST, from the retained generations:
// each generation's lastEventId is resolved to its provenance
// intent, the intent's entry bytes are accumulated, and every
// digest step is verified against the frontier the generation
// embeds; the replay must terminate at the current record. Acks
// are cross-checked against the replay (audit only — a replayed
// transition with no ack is landed history, never a mismatch).
// classify then assigns the durable state (W0-W5, T-DUP, T-VOID,
// duplicate-satisfiable, UNPROVEN, unverifiable) from durable
// facts, given the store's canonical entry set and the witness
// observations as caller-supplied observations (the store read is
// S2's; the witness log is S3's). Phase O completion writes the
// missing ack entries from the replayed generations and appends
// the missing witness observations through a caller-injected sink;
// it moves no anchor and certifies nothing new. The audit rule:
// every generation transition has exactly one acked intent whose
// embedded prior/new digests match the transition, every intent
// has exactly one terminal entry, generations are contiguous per
// incarnation — reported, never laundered into a pass.
//
// Canonical encoding (design section 2.1.1). frame(x) is
// u32be(len(x)) || x; integers are u64be; text fields are the
// validated store literals as UTF-8; digest fields held as
// lowercase hex are encoded as the raw 32 bytes decoded from hex.
// Revocation entries are type-tagged (oprev / sesrev) and the
// frontier digest is SHA-256 over the domain-bound preimage with
// the sorted entry set. The encoding version is
// 'atlas-auth-frontier' framing with version literal '1'; any
// change is a new encoding version, never a silent edit.
//
// Genesis and incarnation (design sections 2.1.1, 2.6). Genesis is
// a provisioning act mirrored here as module functions: the three
// records are created against proven absence together with the
// genesis provenance entries. The authorization lineage's
// incarnation is the digest of the genesis event — scope, schema,
// the genesis frontier (the empty set, count 0) and a genesis
// nonce from the provisioning procedure — computed by
// computeGenesisIncarnation; the pin and history records bind the
// unit incarnation supplied at their genesis. An absent anchor on
// a live domain is unverifiable, therefore refusal; the only path
// from absence is genesis. No path in this module repairs,
// re-baselines or silently adopts an observed value.

const crypto = require('node:crypto');
const C = require('./planned-obligation-settlement-contract');

const PREFIX = 'settlement-evidence-anchor-store:';
const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const LEDGER_RE = /^ledger-[a-f0-9]{32}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const OPERATION_RE = /^operation-[a-f0-9]{32}$/;
const GENERATION_RE = /^generation-[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const ENTRY_HEX_RE = /^[0-9a-f]+$/;
const MAX_PAGES = 10000;
const FRONTIER_ENCODING_VERSION = '1';

function fail(detail) {
  const error = new Error(PREFIX + ' ' + detail);
  error.anchorStoreValidation = true;
  return error;
}
function isValidation(error) { return !!error && error.anchorStoreValidation === true; }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function isHash(value) { return typeof value === 'string' && HASH_RE.test(value); }
function isTick(value) { return Number.isSafeInteger(value) && value > 0; }
function isCount(value) { return Number.isSafeInteger(value) && value >= 0; }
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function isConflict(error) { return !!error && error.code === 'conflict'; }
function snapshot(value, what) {
  try { return JSON.parse(JSON.stringify(value)); } catch {
    throw fail(what + ' is not a snapshot-able record');
  }
}
function exactKeys(value, wanted) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const sorted = [...wanted].sort();
  return actual.length === sorted.length && actual.every((k, i) => k === sorted[i]);
}

// --- Canonical encoding (design section 2.1.1) ------------------------------
function frame(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}
function u64be(value) {
  if (!isCount(value)) throw fail('integer is out of range for u64be encoding');
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}
function rawDigest(hex) {
  if (!isHash(hex)) throw fail('digest field is not a lowercase SHA-256 hex value');
  return Buffer.from(hex, 'hex');
}
function checkRevocationFields(input, what) {
  if (!isRecord(input)) throw fail(what + ' is malformed');
  if (input.kind !== 'oprev' && input.kind !== 'sesrev') throw fail(what + ' kind is malformed');
  if (!isTick(input.revokedAt)) throw fail(what + ' revokedAt is malformed');
  if (input.kind === 'oprev') {
    if (typeof input.operationId !== 'string' || !OPERATION_RE.test(input.operationId)) {
      throw fail(what + ' operationId is malformed');
    }
    if (typeof input.generation !== 'string' || !GENERATION_RE.test(input.generation)) {
      throw fail(what + ' generation is malformed');
    }
  } else if (!isHash(input.sidDigest)) {
    throw fail(what + ' sidDigest is malformed');
  }
}
function encodeRevocationEntry(input) {
  checkRevocationFields(input, 'revocation entry');
  if (input.kind === 'oprev') {
    return Buffer.concat([
      frame('oprev'), frame(input.operationId), frame(input.generation), u64be(input.revokedAt),
    ]);
  }
  return Buffer.concat([frame('sesrev'), frame(rawDigest(input.sidDigest)), u64be(input.revokedAt)]);
}
function readFrame(bytes, offset) {
  if (offset + 4 > bytes.length) throw fail('encoded entry is truncated');
  const length = bytes.readUInt32BE(offset);
  if (offset + 4 + length > bytes.length) throw fail('encoded entry is truncated');
  return { value: bytes.subarray(offset + 4, offset + 4 + length), next: offset + 4 + length };
}
function decodeRevocationEntry(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw fail('encoded entry is malformed');
  const tag = readFrame(bytes, 0);
  const kind = tag.value.toString('utf8');
  let offset = tag.next;
  let out;
  if (kind === 'oprev') {
    const operationId = readFrame(bytes, offset); offset = operationId.next;
    const generation = readFrame(bytes, offset); offset = generation.next;
    out = {
      kind, operationId: operationId.value.toString('utf8'),
      generation: generation.value.toString('utf8'),
    };
  } else if (kind === 'sesrev') {
    const sid = readFrame(bytes, offset); offset = sid.next;
    if (sid.value.length !== 32) throw fail('encoded entry sidDigest is malformed');
    out = { kind, sidDigest: sid.value.toString('hex') };
  } else {
    throw fail('encoded entry tag is unknown');
  }
  if (offset + 8 !== bytes.length) throw fail('encoded entry has trailing or missing bytes');
  out.revokedAt = Number(bytes.readBigUInt64BE(offset));
  checkRevocationFields(out, 'encoded entry');
  return out;
}
function entryKeyString(decoded) {
  return decoded.kind === 'oprev'
    ? 'oprev:' + decoded.operationId + '/' + decoded.generation
    : 'sesrev:' + decoded.sidDigest;
}
function computeFrontierDigest(input) {
  if (!isRecord(input)) throw fail('frontier input is malformed');
  const { schema, scope, incarnation, entries } = input;
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema)) throw fail('frontier schema is malformed');
  if (typeof scope !== 'string' || !SCOPE_RE.test(scope)) throw fail('frontier scope is malformed');
  if (!Array.isArray(entries)) throw fail('frontier entries are malformed');
  const buffers = entries.map(entry => {
    if (Buffer.isBuffer(entry)) return Buffer.from(entry);
    if (typeof entry === 'string' && entry.length > 0 && entry.length % 2 === 0
      && ENTRY_HEX_RE.test(entry)) return Buffer.from(entry, 'hex');
    throw fail('frontier entry is malformed');
  });
  buffers.sort(Buffer.compare);
  const parts = [
    frame('atlas-auth-frontier'), frame(FRONTIER_ENCODING_VERSION), frame(schema),
    frame(scope), frame(rawDigest(incarnation)), u64be(buffers.length),
  ];
  return sha256(Buffer.concat([...parts, ...buffers]));
}
function computeAuthorizationEventId(input) {
  if (!isRecord(input)) throw fail('event input is malformed');
  if (typeof input.scope !== 'string' || !SCOPE_RE.test(input.scope)) {
    throw fail('event scope is malformed');
  }
  checkRevocationFields(input, 'event');
  const keyBytes = input.kind === 'oprev'
    ? Buffer.concat([frame(input.operationId), frame(input.generation)])
    : frame(rawDigest(input.sidDigest));
  return sha256(Buffer.concat([
    frame('atlas-anchor-event'), frame(input.scope), frame(input.kind), keyBytes,
    u64be(input.revokedAt),
  ]));
}
function computeHistoryEventId(input) {
  if (!isRecord(input)) throw fail('history event input is malformed');
  const { householdId, ledgerNamespace, priorPair, certificate } = input;
  if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
    throw fail('history event householdId is malformed');
  }
  if (typeof ledgerNamespace !== 'string' || !LEDGER_RE.test(ledgerNamespace)) {
    throw fail('history event ledgerNamespace is malformed');
  }
  if (!isRecord(priorPair) || !isCount(priorPair.revision) || !isHash(priorPair.digest)) {
    throw fail('history event priorPair is malformed');
  }
  if (!isRecord(certificate)) throw fail('history event certificate is malformed');
  const certificateDigest = C.digest(certificate);
  return sha256(Buffer.concat([
    frame('atlas-history-event'), frame(householdId), frame(ledgerNamespace),
    u64be(priorPair.revision), frame(rawDigest(priorPair.digest)),
    frame(rawDigest(certificateDigest)),
  ]));
}
function computeGenesisIncarnation(input) {
  if (!isRecord(input)) throw fail('genesis input is malformed');
  const { scope, schema, nonce } = input;
  if (typeof scope !== 'string' || !SCOPE_RE.test(scope)) throw fail('genesis scope is malformed');
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema)) throw fail('genesis schema is malformed');
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > 1024) {
    throw fail('genesis nonce is malformed');
  }
  // The genesis frontier is the empty set: count 0, no entries. The
  // incarnation binds scope, schema, that empty frontier and the
  // provisioning nonce (design section 2.1.1).
  return sha256(Buffer.concat([
    frame('atlas-anchor-genesis'), frame(scope), frame(schema), u64be(0), frame(nonce),
  ]));
}
function genesisEventId(tag, parts) {
  return sha256(Buffer.concat([
    frame('atlas-anchor-genesis-event'), frame(tag), ...parts.map(p => frame(p)),
  ]));
}

// --- Record shapes ------------------------------------------------------------
const KIND_LABEL = { pin: 'pin', authorization: 'authorization', history: 'history' };
function validatePinRecord(record, what) {
  if (!exactKeys(record, ['incarnation', 'pin'])) throw fail(what + ' is malformed');
  if (!isHash(record.incarnation)) throw fail(what + ' incarnation is malformed');
  const pin = record.pin;
  if (!exactKeys(pin, ['digest', 'revision', 'timestamp'])) throw fail(what + ' is malformed');
  if (!isCount(pin.revision) || !isHash(pin.digest) || !isTick(pin.timestamp)) {
    throw fail(what + ' pin payload is malformed');
  }
}
function validateAuthorizationRecord(record, what) {
  if (!exactKeys(record, ['epoch', 'frontierDigest', 'incarnation', 'lastEventId',
    'priorDigest', 'revocationCount', 'scope', 'updatedAt'])) throw fail(what + ' is malformed');
  if (typeof record.scope !== 'string' || !SCOPE_RE.test(record.scope)) {
    throw fail(what + ' scope is malformed');
  }
  if (!isHash(record.incarnation) || !isCount(record.epoch) || !isCount(record.revocationCount)
    || !isHash(record.frontierDigest)
    || !(record.priorDigest === null || isHash(record.priorDigest))
    || !isHash(record.lastEventId) || !isTick(record.updatedAt)) {
    throw fail(what + ' fields are malformed');
  }
}
function validateHistoryRecord(record, what) {
  if (!exactKeys(record, ['digest', 'incarnation', 'lastEventId', 'revision', 'updatedAt'])) {
    throw fail(what + ' is malformed');
  }
  if (!isHash(record.incarnation) || !isCount(record.revision) || !isHash(record.digest)
    || !isHash(record.lastEventId) || !isTick(record.updatedAt)) {
    throw fail(what + ' fields are malformed');
  }
}
const RECORD_VALIDATORS = {
  pin: validatePinRecord, authorization: validateAuthorizationRecord, history: validateHistoryRecord,
};

function createSettlementEvidenceAnchorStore(deps) {
  if (!isRecord(deps)) throw new TypeError(PREFIX + ' deps must be a record');
  const { transport, prefix, schema } = deps;
  if (typeof prefix !== 'string' || prefix.length === 0 || prefix.length > 128
    || !NAMESPACE_RE.test(prefix) || prefix.includes('..')) {
    throw new TypeError(PREFIX + ' prefix is malformed');
  }
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema)) {
    throw new TypeError(PREFIX + ' schema is malformed');
  }
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)
    || ['read', 'create', 'replace', 'list'].some(m => typeof transport[m] !== 'function')) {
    throw new TypeError(PREFIX + ' transport lacks a required conditional capability');
  }

  // Content-free object identity: raw household/scope/domain literals
  // never appear in object keys (the object adapter's discipline);
  // the binding is a digest over the framed identity parts, and the
  // stored bytes bind the same identity for verification on read.
  function bindingFor(kind, parts) {
    return sha256(Buffer.concat([frame('atlas-anchor-binding'), frame(kind), ...parts.map(frame)]));
  }
  function refFor(kind, parts, labels) {
    return { kind, parts, labels, binding: bindingFor(kind, parts) };
  }
  function pinRef(householdId) {
    if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
      throw fail('householdId is invalid');
    }
    return refFor('pin', [householdId], { householdId });
  }
  function authorizationRef(scope) {
    if (typeof scope !== 'string' || !SCOPE_RE.test(scope)) throw fail('scope is invalid');
    return refFor('authorization', [scope], { scope });
  }
  function historyRef(householdId, ledgerNamespace) {
    if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
      throw fail('householdId is invalid');
    }
    if (typeof ledgerNamespace !== 'string' || !LEDGER_RE.test(ledgerNamespace)) {
      throw fail('ledgerNamespace is invalid');
    }
    return refFor('history', [householdId, ledgerNamespace], { householdId, ledgerNamespace });
  }
  const recordPrefix = ref => prefix + '/records/' + ref.binding + '/';
  const genKey = (ref, generation) =>
    recordPrefix(ref) + 'gen-' + String(generation).padStart(10, '0') + '.json';
  const provenancePrefix = ref => prefix + '/provenance/' + ref.binding + '/';
  const ENTRY_SUFFIX = { intent: 'intent', ack: 'ack', void: 'void', 'duplicate-satisfied': 'dup', genesis: 'genesis' };
  const provenanceKey = (ref, eventId, kind) =>
    provenancePrefix(ref) + eventId + '.' + ENTRY_SUFFIX[kind] + '.json';

  // --- Transport plumbing -----------------------------------------------------
  async function listAllKeys(keyPrefix) {
    const keys = [];
    const seenCursors = new Set();
    let cursor = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await transport.list(keyPrefix, cursor);
      if (!isRecord(result) || !Array.isArray(result.entries)
        || !(result.nextCursor === null || typeof result.nextCursor === 'string')) {
        throw fail('list result is malformed');
      }
      for (const entry of result.entries) {
        if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key.startsWith(keyPrefix)
          || !isRecord(entry.metadata)) throw fail('list entry is malformed');
        keys.push(entry.key);
      }
      if (result.nextCursor === null) return keys;
      if (seenCursors.has(result.nextCursor)) throw fail('list cursor repeated');
      seenCursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw fail('list did not complete within the page bound');
  }
  function readResultBytes(raw, what) {
    if (!isRecord(raw)) throw fail(what + ' read result is malformed');
    let bytes = null;
    if (Buffer.isBuffer(raw.bytes)) bytes = Buffer.from(raw.bytes);
    else if (raw.bytes instanceof Uint8Array) bytes = Buffer.from(raw.bytes);
    if (!bytes) throw fail(what + ' read result carries no bytes');
    if (typeof raw.version !== 'string' || raw.version.length === 0) {
      throw fail(what + ' read result carries no version token');
    }
    if (!isRecord(raw.metadata)) throw fail(what + ' read result carries no metadata');
    return bytes;
  }
  function validateAck(ack, intendedBytes) {
    if (!isRecord(ack) || typeof ack.version !== 'string' || ack.version.length === 0
      || ack.integrity !== sha256(intendedBytes)) {
      throw fail('write acknowledgement does not bind the stored bytes');
    }
  }

  // --- Record byte encoding ---------------------------------------------------
  function encodeRecord(ref, record) {
    if (ref.kind === 'pin') {
      return Buffer.from(JSON.stringify({
        v: 1, kind: 'pin', binding: ref.binding, incarnation: record.incarnation,
        revision: record.pin.revision, digest: record.pin.digest, timestamp: record.pin.timestamp,
      }));
    }
    if (ref.kind === 'authorization') {
      return Buffer.from(JSON.stringify({
        v: 1, kind: 'authorization', binding: ref.binding, scope: record.scope,
        schema, incarnation: record.incarnation, epoch: record.epoch,
        revocationCount: record.revocationCount, frontierDigest: record.frontierDigest,
        priorDigest: record.priorDigest, lastEventId: record.lastEventId,
        updatedAt: record.updatedAt,
      }));
    }
    return Buffer.from(JSON.stringify({
      v: 1, kind: 'history', binding: ref.binding, incarnation: record.incarnation,
      revision: record.revision, digest: record.digest, lastEventId: record.lastEventId,
      updatedAt: record.updatedAt,
    }));
  }
  function parseRecord(ref, bytes) {
    const label = KIND_LABEL[ref.kind];
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch {
      throw fail('stored ' + label + ' anchor is not a ' + label + ' anchor record');
    }
    if (!isRecord(value) || value.v !== 1 || value.kind !== ref.kind || value.binding !== ref.binding) {
      throw fail('stored ' + label + ' anchor failed validation');
    }
    let record;
    if (ref.kind === 'pin') {
      if (!exactKeys(value, ['binding', 'digest', 'incarnation', 'kind', 'revision', 'timestamp', 'v'])) {
        throw fail('stored pin anchor failed validation');
      }
      record = {
        incarnation: value.incarnation,
        pin: { revision: value.revision, digest: value.digest, timestamp: value.timestamp },
      };
    } else if (ref.kind === 'authorization') {
      if (!exactKeys(value, ['binding', 'epoch', 'frontierDigest', 'incarnation', 'kind',
        'lastEventId', 'priorDigest', 'revocationCount', 'schema', 'scope', 'updatedAt', 'v'])
        || value.scope !== ref.labels.scope || value.schema !== schema) {
        throw fail('stored authorization anchor failed validation');
      }
      record = {
        scope: value.scope, incarnation: value.incarnation, epoch: value.epoch,
        revocationCount: value.revocationCount, frontierDigest: value.frontierDigest,
        priorDigest: value.priorDigest, lastEventId: value.lastEventId, updatedAt: value.updatedAt,
      };
    } else {
      if (!exactKeys(value, ['binding', 'digest', 'incarnation', 'kind', 'lastEventId',
        'revision', 'updatedAt', 'v'])) {
        throw fail('stored history anchor failed validation');
      }
      record = {
        incarnation: value.incarnation, revision: value.revision, digest: value.digest,
        lastEventId: value.lastEventId, updatedAt: value.updatedAt,
      };
    }
    try { RECORD_VALIDATORS[ref.kind](record, 'stored ' + label + ' anchor'); } catch {
      throw fail('stored ' + label + ' anchor failed validation');
    }
    return record;
  }
  function recordsEqual(ref, a, b) {
    return encodeRecord(ref, a).equals(encodeRecord(ref, b));
  }
  async function generationIndices(ref) {
    const keys = await listAllKeys(recordPrefix(ref));
    const indices = [];
    for (const key of keys) {
      const match = /^gen-([0-9]{10})\.json$/.exec(key.slice(recordPrefix(ref).length));
      if (!match) throw fail('unknown object inside the record namespace');
      indices.push(Number(match[1]));
    }
    return indices.sort((a, b) => a - b);
  }
  async function readGeneration(ref, generation) {
    const raw = await transport.read(genKey(ref, generation));
    if (raw === null) throw fail('anchor generation vanished after listing');
    const bytes = readResultBytes(raw, 'anchor generation');
    return { generation, record: parseRecord(ref, bytes), recordHash: sha256(bytes) };
  }
  async function readCurrent(ref) {
    const indices = await generationIndices(ref);
    if (indices.length === 0) return null;
    return readGeneration(ref, indices[indices.length - 1]);
  }
  async function readGenerations(ref) {
    const indices = await generationIndices(ref);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) throw fail('anchor generation chain is not contiguous');
    }
    const out = [];
    for (const index of indices) out.push(await readGeneration(ref, index));
    return out;
  }

  // --- CAS advance --------------------------------------------------------------
  function validateTransition(ref, expected, next) {
    const label = KIND_LABEL[ref.kind];
    if (expected === null) {
      // Genesis: only the genesis shape may be created against absence.
      if (ref.kind === 'pin' && next.pin.revision !== 0) {
        throw fail('pin advance is not a genesis or sequential transition');
      }
      if (ref.kind === 'authorization') {
        const emptyFrontier = computeFrontierDigest({
          schema, scope: ref.labels.scope, incarnation: next.incarnation, entries: [],
        });
        if (next.epoch !== 0 || next.revocationCount !== 0 || next.priorDigest !== null
          || next.frontierDigest !== emptyFrontier
          || next.lastEventId !== genesisEventId('authorization', [ref.labels.scope, next.incarnation])) {
          throw fail('authorization advance is not a genesis or sequential transition');
        }
      }
      if (ref.kind === 'history' && (next.revision !== 0
        || next.lastEventId !== genesisEventId('history', ref.parts))) {
        throw fail('history advance is not a genesis or sequential transition');
      }
      return;
    }
    if (next.incarnation !== expected.incarnation) {
      throw fail(label + ' advance incarnation does not match the expected record');
    }
    if (ref.kind === 'pin') {
      if (next.pin.revision !== expected.pin.revision + 1) {
        throw fail('pin advance is not a genesis or sequential transition');
      }
    } else if (ref.kind === 'authorization') {
      if (next.scope !== expected.scope) throw fail('authorization advance scope is malformed');
      if (next.epoch !== expected.epoch + 1) {
        throw fail('authorization advance is not a genesis or sequential transition');
      }
      if (next.priorDigest !== expected.frontierDigest) {
        throw fail('authorization advance prior digest does not bind the expected frontier');
      }
      if (next.lastEventId === expected.lastEventId) {
        throw fail('authorization advance does not name a new event');
      }
      if (next.revocationCount < expected.revocationCount
        || (next.revocationCount === expected.revocationCount
          && next.frontierDigest !== expected.frontierDigest)
        || (next.revocationCount > expected.revocationCount
          && next.frontierDigest === expected.frontierDigest)) {
        throw fail('authorization advance revocation count and frontier digest are inconsistent');
      }
    } else {
      if (next.revision !== expected.revision + 1) {
        throw fail('history advance is not a genesis or sequential transition');
      }
      if (next.lastEventId === expected.lastEventId) {
        throw fail('history advance does not name a new event');
      }
    }
  }
  async function advanceInternal(ref, expected, next) {
    validateTransition(ref, expected, next);
    const current = await readCurrent(ref);
    let target;
    if (current === null) {
      if (expected !== null) return false; // definite: no record to match
      target = 0;
    } else {
      if (expected === null) return false; // definite: a record already exists
      if (!recordsEqual(ref, current.record, expected)) return false; // definite conflict
      target = current.generation + 1;
    }
    const bytes = encodeRecord(ref, next);
    let ack;
    try {
      ack = await transport.create(genKey(ref, target), bytes, { kind: ref.kind, generation: target });
    } catch (error) {
      if (isConflict(error)) return false; // the generation already exists
      throw error; // lost or ambiguous acknowledgement: uncertainty
    }
    validateAck(ack, bytes);
    return true;
  }
  function prepareAdvance(ref, expected, next, what) {
    const expCopy = expected === null ? null : snapshot(expected, what + ' expected record');
    const nextCopy = snapshot(next, what + ' next record');
    if (expCopy !== null) RECORD_VALIDATORS[ref.kind](expCopy, what + ' expected record');
    RECORD_VALIDATORS[ref.kind](nextCopy, what + ' next record');
    return [expCopy, nextCopy];
  }

  // --- Provenance entries -------------------------------------------------------
  function encodeEntry(entry) {
    return Buffer.from(JSON.stringify({ v: 1, ...entry }));
  }
  function publicEntry(entry) {
    const { v, ...rest } = entry;
    return Object.freeze(rest);
  }
  function validateEntry(ref, entry, suffixKind) {
    const bad = () => { throw fail('stored provenance entry failed validation'); };
    if (!isRecord(entry) || entry.v !== 1 || !isHash(entry.eventId)) bad();
    const kind = entry.kind;
    if (ENTRY_SUFFIX[kind] !== suffixKind) bad();
    if (kind === 'intent' && ref.kind === 'authorization') {
      if (!exactKeys(entry, ['entry', 'eventId', 'key', 'kind', 'priorAnchor',
        'revocationKind', 'revokedAt', 'status', 'v']) || entry.status !== 'intent') bad();
      try {
        checkRevocationFields({
          kind: entry.revocationKind, revokedAt: entry.revokedAt, ...entry.key,
        }, 'provenance intent');
        const recomputed = encodeRevocationEntry({
          kind: entry.revocationKind, revokedAt: entry.revokedAt, ...entry.key,
        });
        if (recomputed.toString('hex') !== entry.entry) bad();
        if (computeAuthorizationEventId({
          scope: ref.labels.scope, kind: entry.revocationKind,
          revokedAt: entry.revokedAt, ...entry.key,
        }) !== entry.eventId) bad();
      } catch { bad(); }
      const prior = entry.priorAnchor;
      if (prior !== null && (!exactKeys(prior, ['count', 'epoch', 'frontierDigest', 'incarnation'])
        || !isHash(prior.incarnation) || !isCount(prior.epoch) || !isCount(prior.count)
        || !isHash(prior.frontierDigest))) bad();
    } else if (kind === 'intent' && ref.kind === 'history') {
      if (!exactKeys(entry, ['certificate', 'domain', 'eventId', 'kind', 'priorPair', 'status', 'v'])
        || entry.status !== 'intent') bad();
      if (!exactKeys(entry.domain, ['householdId', 'ledgerNamespace'])
        || entry.domain.householdId !== ref.labels.householdId
        || entry.domain.ledgerNamespace !== ref.labels.ledgerNamespace) bad();
      if (!exactKeys(entry.priorPair, ['digest', 'revision'])
        || !isCount(entry.priorPair.revision) || !isHash(entry.priorPair.digest)
        || !isRecord(entry.certificate)) bad();
      if (computeHistoryEventId({
        householdId: ref.labels.householdId, ledgerNamespace: ref.labels.ledgerNamespace,
        priorPair: entry.priorPair, certificate: entry.certificate,
      }) !== entry.eventId) bad();
    } else if (kind === 'ack') {
      if (!exactKeys(entry, ['eventId', 'generation', 'kind', 'recordHash', 'status', 'v'])
        || entry.status !== 'ack' || !isCount(entry.generation) || !isHash(entry.recordHash)) bad();
    } else if (kind === 'void') {
      if (!exactKeys(entry, ['eventId', 'kind', 'status', 'v']) || entry.status !== 'void') bad();
    } else if (kind === 'duplicate-satisfied') {
      if (!exactKeys(entry, ['eventId', 'kind', 'owningEventId', 'status', 'v'])
        || entry.status !== 'duplicate-satisfied' || !isHash(entry.owningEventId)
        || entry.owningEventId === entry.eventId) bad();
    } else if (kind === 'genesis' && ref.kind === 'authorization') {
      if (!exactKeys(entry, ['eventId', 'incarnation', 'kind', 'nonce', 'schema', 'scope', 'status', 'v'])
        || entry.status !== 'genesis' || entry.scope !== ref.labels.scope || entry.schema !== schema
        || !isHash(entry.incarnation)
        || !(entry.nonce === null || typeof entry.nonce === 'string')) bad();
    } else if (kind === 'genesis' && (ref.kind === 'pin' || ref.kind === 'history')) {
      if (!exactKeys(entry, ['eventId', 'incarnation', 'kind', 'record', 'status', 'v'])
        || entry.status !== 'genesis' || entry.record !== ref.kind || !isHash(entry.incarnation)) bad();
    } else {
      bad();
    }
    return entry;
  }
  async function listProvenance(ref) {
    const keys = await listAllKeys(provenancePrefix(ref));
    const entries = [];
    for (const key of keys) {
      const match = /^([a-f0-9]{64})\.(intent|ack|void|dup|genesis)\.json$/
        .exec(key.slice(provenancePrefix(ref).length));
      if (!match) throw fail('unknown object inside the provenance namespace');
      const raw = await transport.read(key);
      if (raw === null) throw fail('provenance entry vanished after listing');
      const bytes = readResultBytes(raw, 'provenance entry');
      let entry;
      try { entry = JSON.parse(bytes.toString('utf8')); } catch {
        throw fail('stored provenance entry failed validation');
      }
      if (!isRecord(entry) || entry.eventId !== match[1]) {
        throw fail('stored provenance entry failed validation');
      }
      entries.push(validateEntry(ref, entry, match[2]));
    }
    const rank = { genesis: 0, intent: 1, ack: 2, void: 3, 'duplicate-satisfied': 4 };
    entries.sort((a, b) => (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1
      : rank[a.kind] - rank[b.kind]));
    return entries;
  }
  async function createEntry(ref, entry) {
    const bytes = encodeEntry(entry);
    let ack;
    try {
      ack = await transport.create(provenanceKey(ref, entry.eventId, entry.kind), bytes,
        { kind: entry.kind, event: entry.eventId });
    } catch (error) {
      if (isConflict(error)) throw fail('provenance entry already exists for this event and kind');
      throw error;
    }
    validateAck(ack, bytes);
    return true;
  }
  async function writeGenesisEntry(ref, entry) {
    try {
      await createEntry(ref, entry);
    } catch (error) {
      // A genesis entry already durable is the resume path of the
      // genesis ceremony, not a conflict to hide.
      if (isValidation(error) && /already exists/.test(error.message)) return false;
      throw error;
    }
    return true;
  }
  function terminalOf(entries, eventId) {
    return entries.find(e => e.eventId === eventId
      && (e.kind === 'ack' || e.kind === 'void' || e.kind === 'duplicate-satisfied')) || null;
  }
  function intentOf(entries, eventId) {
    return entries.find(e => e.eventId === eventId && e.kind === 'intent') || null;
  }
  async function writeTerminal(ref, entry) {
    const entries = await listProvenance(ref);
    if (!intentOf(entries, entry.eventId)) throw fail('terminal entry names no recorded intent');
    if (terminalOf(entries, entry.eventId)) {
      throw fail('a terminal entry already exists for this event');
    }
    if (entry.kind === 'ack') {
      const generations = await readGenerations(ref);
      const landed = generations[entry.generation];
      if (!landed) throw fail('ack names a generation that does not exist');
      if (landed.recordHash !== entry.recordHash) {
        throw fail('ack record hash does not bind the named generation');
      }
      if (landed.record.lastEventId !== entry.eventId) {
        throw fail('ack generation does not name this event');
      }
    }
    await createEntry(ref, entry);
    return true;
  }

  // --- Intent admission (INV-ADM) ----------------------------------------------
  function observationMatches(observations, scope, incarnation, transition) {
    return observations.some(o => isRecord(o) && o.scope === scope
      && o.incarnation === incarnation && o.epoch === transition.epoch
      && o.eventId === transition.eventId);
  }
  async function authorizationIntentClosed(ref, entries, intent, witnessObservations) {
    const terminal = terminalOf(entries, intent.eventId);
    if (!terminal) return false;
    if (terminal.kind === 'void' || terminal.kind === 'duplicate-satisfied') return true;
    // Acked: terminal state is W5, reached only with the witness
    // observation for the landed generation (precision obligation:
    // witness completion, not provenance alone, distinguishes W4/W5).
    const generations = await readGenerations(ref);
    const transition = generations
      .filter(g => g.generation > 0 && g.record.lastEventId === intent.eventId)
      .map(g => ({ epoch: g.record.epoch, eventId: intent.eventId }))[0];
    if (!transition) return false;
    const head = generations[generations.length - 1];
    return observationMatches(witnessObservations || [], ref.labels.scope,
      head.record.incarnation, transition);
  }
  async function openAuthorizationIntent(input, options = {}) {
    const intentInput = snapshot(input, 'authorization intent');
    if (!isRecord(intentInput)) throw fail('authorization intent is malformed');
    const ref = authorizationRef(intentInput.scope);
    checkRevocationFields(intentInput, 'authorization intent');
    const entryBytes = encodeRevocationEntry(intentInput);
    const eventId = computeAuthorizationEventId(intentInput);
    const entries = await listProvenance(ref);
    const existing = intentOf(entries, eventId);
    if (existing) {
      return Object.freeze({ status: 'admitted', resumed: true, eventId, entry: publicEntry(existing) });
    }
    for (const other of entries.filter(e => e.kind === 'intent')) {
      if (!(await authorizationIntentClosed(ref, entries, other, options.witnessObservations))) {
        return Object.freeze({ status: 'unknown', reason: 'anchor-intent-open', blockingEventId: other.eventId });
      }
    }
    const current = await readCurrent(ref);
    const entry = {
      kind: 'intent', eventId, revocationKind: intentInput.kind,
      key: intentInput.kind === 'oprev'
        ? { operationId: intentInput.operationId, generation: intentInput.generation }
        : { sidDigest: intentInput.sidDigest },
      revokedAt: intentInput.revokedAt, entry: entryBytes.toString('hex'),
      priorAnchor: current === null ? null : {
        incarnation: current.record.incarnation, epoch: current.record.epoch,
        count: current.record.revocationCount, frontierDigest: current.record.frontierDigest,
      },
      status: 'intent',
    };
    try {
      await createEntry(ref, entry);
    } catch (error) {
      if (isValidation(error) && /already exists/.test(error.message)) {
        const again = intentOf(await listProvenance(ref), eventId);
        if (again) {
          return Object.freeze({ status: 'admitted', resumed: true, eventId, entry: publicEntry(again) });
        }
      }
      throw error;
    }
    return Object.freeze({ status: 'admitted', resumed: false, eventId, entry: publicEntry(entry) });
  }
  async function openHistoryIntent(input) {
    const intentInput = snapshot(input, 'history intent');
    if (!isRecord(intentInput)) throw fail('history intent is malformed');
    const ref = historyRef(intentInput.householdId, intentInput.ledgerNamespace);
    if (!isRecord(intentInput.priorPair) || !isCount(intentInput.priorPair.revision)
      || !isHash(intentInput.priorPair.digest)) throw fail('history intent priorPair is malformed');
    if (!isRecord(intentInput.certificate)) throw fail('history intent certificate is malformed');
    const eventId = computeHistoryEventId(intentInput);
    const entries = await listProvenance(ref);
    const existing = intentOf(entries, eventId);
    if (existing) {
      return Object.freeze({ status: 'admitted', resumed: true, eventId, entry: publicEntry(existing) });
    }
    for (const other of entries.filter(e => e.kind === 'intent')) {
      if (!terminalOf(entries, other.eventId)) {
        return Object.freeze({ status: 'unknown', reason: 'anchor-intent-open', blockingEventId: other.eventId });
      }
    }
    const entry = {
      kind: 'intent', eventId,
      domain: { householdId: ref.labels.householdId, ledgerNamespace: ref.labels.ledgerNamespace },
      priorPair: { revision: intentInput.priorPair.revision, digest: intentInput.priorPair.digest },
      certificate: intentInput.certificate, status: 'intent',
    };
    try {
      await createEntry(ref, entry);
    } catch (error) {
      if (isValidation(error) && /already exists/.test(error.message)) {
        const again = intentOf(await listProvenance(ref), eventId);
        if (again) {
          return Object.freeze({ status: 'admitted', resumed: true, eventId, entry: publicEntry(again) });
        }
      }
      throw error;
    }
    return Object.freeze({ status: 'admitted', resumed: false, eventId, entry: publicEntry(entry) });
  }

  // --- Replay (Phase L), classification (Phase C facts), Phase O, audit --------
  async function replayInternal(scope) {
    const ref = authorizationRef(scope);
    let generations;
    let entries;
    try {
      generations = await readGenerations(ref);
      entries = await listProvenance(ref);
    } catch (error) {
      if (isValidation(error)) return { status: 'unproven', reason: error.message };
      throw error;
    }
    const unproven = reason => ({ status: 'unproven', reason });
    if (generations.length === 0) return unproven('anchor record is absent');
    const genesis = generations[0].record;
    const incarnation = genesis.incarnation;
    const expectedGenesisEvent = genesisEventId('authorization', [scope, incarnation]);
    if (genesis.epoch !== 0 || genesis.revocationCount !== 0 || genesis.priorDigest !== null
      || genesis.lastEventId !== expectedGenesisEvent
      || genesis.frontierDigest !== computeFrontierDigest({ schema, scope, incarnation, entries: [] })) {
      return unproven('genesis generation does not bind the empty frontier');
    }
    const genesisEntry = entries.find(e => e.kind === 'genesis' && e.eventId === genesis.lastEventId);
    if (!genesisEntry || genesisEntry.incarnation !== incarnation) {
      return unproven('genesis provenance entry is missing or foreign');
    }
    const accumulated = [];
    const transitions = [];
    for (let i = 1; i < generations.length; i++) {
      const { record, recordHash } = generations[i];
      if (record.scope !== scope || record.incarnation !== incarnation) {
        return unproven('generation incarnation or scope changed across the chain');
      }
      if (record.epoch !== i) return unproven('generation epoch does not equal its index');
      if (record.priorDigest !== generations[i - 1].record.frontierDigest) {
        return unproven('generation prior digest does not bind the previous generation');
      }
      const intent = intentOf(entries, record.lastEventId);
      if (!intent) return unproven('generation names an event with no recorded intent');
      accumulated.push(Buffer.from(intent.entry, 'hex'));
      if (record.revocationCount !== accumulated.length) {
        return unproven('generation revocation count disagrees with the replayed set');
      }
      if (computeFrontierDigest({ schema, scope, incarnation, entries: accumulated })
        !== record.frontierDigest) {
        return unproven('generation frontier digest step disagrees with the replayed set');
      }
      transitions.push({
        generation: i, epoch: record.epoch, eventId: record.lastEventId, recordHash, record,
      });
    }
    // Ack cross-check (audit only): every ack must be consumed by the
    // replay, bound to the generation it names.
    for (const ack of entries.filter(e => e.kind === 'ack')) {
      const transition = transitions.find(t => t.eventId === ack.eventId);
      if (!transition || ack.generation !== transition.generation
        || ack.recordHash !== transition.recordHash) {
        return unproven('an ack entry is not consumed by the replay');
      }
    }
    const head = generations[generations.length - 1];
    return {
      status: 'verified', ref, entries, generations, transitions,
      head: head.record, headRecordHash: head.recordHash,
      anchoredEntries: accumulated.map(b => b.toString('hex')).sort(),
    };
  }
  function projectReplay(replay) {
    if (replay.status !== 'verified') return { status: replay.status, reason: replay.reason };
    return {
      status: 'verified', head: replay.head, headRecordHash: replay.headRecordHash,
      generations: replay.generations.length, anchoredEntries: replay.anchoredEntries,
      transitions: replay.transitions.map(t => ({
        generation: t.generation, eventId: t.eventId, recordHash: t.recordHash,
      })),
    };
  }
  async function classifyAuthorization(scope, input = {}) {
    if (!isRecord(input)) throw fail('classification input is malformed');
    const storeEntries = input.storeEntries;
    if (!Array.isArray(storeEntries) || storeEntries.some(e => typeof e !== 'string'
      || e.length === 0 || e.length % 2 !== 0 || !ENTRY_HEX_RE.test(e))) {
      throw fail('classification store entries are malformed');
    }
    const observations = input.witnessObservations || [];
    if (!Array.isArray(observations)) throw fail('classification witness observations are malformed');
    const replay = await replayInternal(scope);
    if (replay.status !== 'verified') return { status: replay.status, reason: replay.reason };
    const { entries, transitions, head } = replay;
    // Witness gate (Phase L): a witness head in a foreign lineage, or
    // ahead of the anchor, is unverifiable — not reconciliation's to
    // repair.
    const scoped = observations.filter(o => isRecord(o) && o.scope === scope);
    if (scoped.length > 0) {
      const witnessHead = scoped.reduce((a, b) => (b.epoch > a.epoch ? b : a));
      if (witnessHead.incarnation !== head.incarnation) {
        return { status: 'unverifiable', reason: 'witness head names a foreign incarnation' };
      }
      if (witnessHead.epoch > head.epoch) {
        return { status: 'unverifiable', reason: 'anchor is behind the witness head' };
      }
      if (witnessHead.epoch === head.epoch
        && (witnessHead.frontierDigest !== head.frontierDigest
          || witnessHead.recordHash !== replay.headRecordHash)) {
        return { status: 'unverifiable', reason: 'witness head disagrees with the anchor head' };
      }
    }
    const anchored = new Set(replay.anchoredEntries);
    const storeSet = new Set(storeEntries);
    const transitionsByEvent = new Map(transitions.map(t => [t.eventId, t]));
    const decodedCache = new Map();
    const decodeHex = hex => {
      if (!decodedCache.has(hex)) {
        try { decodedCache.set(hex, decodeRevocationEntry(Buffer.from(hex, 'hex'))); } catch {
          decodedCache.set(hex, null);
        }
      }
      return decodedCache.get(hex);
    };
    let openIntent = null;
    let openCount = 0;
    for (const intent of entries.filter(e => e.kind === 'intent')) {
      const terminal = terminalOf(entries, intent.eventId);
      if (terminal && (terminal.kind === 'void' || terminal.kind === 'duplicate-satisfied')) continue;
      const transition = transitionsByEvent.get(intent.eventId);
      let state;
      if (transition) {
        if (!terminal) state = 'W3';
        else state = observationMatches(observations, scope, head.incarnation, transition)
          ? 'W5' : 'W4';
        if (state === 'W5') continue;
      } else if (storeSet.has(intent.entry) && !anchored.has(intent.entry)) {
        state = 'W2'; // genuinely new: appended, unanchored (committed-unanchored)
      } else {
        const mine = decodeHex(intent.entry);
        const ownerHex = mine === null ? undefined
          : [...storeSet, ...anchored].find(hex => hex !== intent.entry
            && decodeHex(hex) !== null && entryKeyString(decodeHex(hex)) === entryKeyString(mine));
        if (ownerHex !== undefined) {
          if (!anchored.has(ownerHex)) {
            return { status: 'unproven', reason: 'duplicate owner entry is not anchored' };
          }
          state = 'duplicate-satisfiable';
        } else if (mine !== null && !storeSet.has(intent.entry) && !anchored.has(intent.entry)
          && ![...storeSet, ...anchored].some(hex => decodeHex(hex) !== null
            && entryKeyString(decodeHex(hex)) === entryKeyString(mine))) {
          state = 'W1'; // intent open; the append never committed
        } else {
          return { status: 'unproven', reason: 'intent entry cannot be classified from durable facts' };
        }
      }
      openCount++;
      openIntent = { eventId: intent.eventId, state, entry: intent.entry };
    }
    if (openCount > 1) {
      return { status: 'unproven', reason: 'more than one intent is non-terminal' };
    }
    // Phase C accounting: every store entry is anchored, or is the
    // open intent's entry; every anchored entry is in the store.
    for (const hex of storeSet) {
      if (!anchored.has(hex) && (!openIntent || hex !== openIntent.entry)) {
        return { status: 'unproven', reason: 'store entry is owned by no intent and is not anchored' };
      }
    }
    for (const hex of anchored) {
      if (!storeSet.has(hex)) {
        return { status: 'unproven', reason: 'anchored entry is missing from the store set' };
      }
    }
    if (openIntent) {
      return {
        status: 'open', intent: { eventId: openIntent.eventId, state: openIntent.state },
        anchoredCount: anchored.size, storeCount: storeSet.size,
      };
    }
    return { status: 'complete', intent: null, anchoredCount: anchored.size, storeCount: storeSet.size };
  }
  async function completeAuthorizationProvenance(scope, input = {}) {
    if (!isRecord(input)) throw fail('completion input is malformed');
    const observations = input.witnessObservations || [];
    const replay = await replayInternal(scope);
    if (replay.status !== 'verified') return { status: replay.status, reason: replay.reason };
    const { entries, transitions, head, ref } = replay;
    const acksWritten = [];
    const observationsWritten = [];
    for (const transition of transitions) {
      if (!terminalOf(entries, transition.eventId)) {
        await writeTerminal(ref, {
          kind: 'ack', eventId: transition.eventId,
          generation: transition.generation, recordHash: transition.recordHash, status: 'ack',
        });
        acksWritten.push(transition.eventId);
      }
      if (!observationMatches(observations, scope, head.incarnation, transition)) {
        if (typeof input.appendObservation !== 'function') {
          throw fail('a witness observation sink is required to complete provenance');
        }
        await input.appendObservation(Object.freeze({
          scope, incarnation: head.incarnation, epoch: transition.epoch,
          frontierDigest: transition.record.frontierDigest,
          recordHash: transition.recordHash, eventId: transition.eventId,
        }));
        observationsWritten.push(transition.eventId);
      }
    }
    return { status: 'completed', acksWritten, observationsWritten };
  }
  async function auditAuthorization(scope, input = {}) {
    if (!isRecord(input)) throw fail('audit input is malformed');
    const observations = input.witnessObservations || [];
    const replay = await replayInternal(scope);
    if (replay.status !== 'verified') {
      return { status: 'unproven', reason: replay.reason, violations: [] };
    }
    const { entries, transitions, head } = replay;
    const violations = [];
    const transitionsByEvent = new Map(transitions.map(t => [t.eventId, t]));
    for (const transition of transitions) {
      const terminal = terminalOf(entries, transition.eventId);
      if (!terminal || terminal.kind !== 'ack') {
        violations.push('transition-unacked:' + transition.eventId);
      } else if (!observationMatches(observations, scope, head.incarnation, transition)) {
        violations.push('transition-unwitnessed:' + transition.eventId);
      }
    }
    for (const intent of entries.filter(e => e.kind === 'intent')) {
      const terminals = entries.filter(e => e.eventId === intent.eventId
        && (e.kind === 'ack' || e.kind === 'void' || e.kind === 'duplicate-satisfied'));
      if (terminals.length > 1) violations.push('intent-multiple-terminal:' + intent.eventId);
      else if (terminals.length === 0 && !transitionsByEvent.has(intent.eventId)) {
        violations.push('intent-open:' + intent.eventId);
      }
    }
    return { status: violations.length > 0 ? 'incomplete' : 'complete', violations };
  }
  async function classifyHistoryEvent(householdId, ledgerNamespace, eventId, input) {
    const ref = historyRef(householdId, ledgerNamespace);
    if (!isHash(eventId)) throw fail('history eventId is malformed');
    const classified = snapshot(input, 'history classification input');
    if (!isRecord(classified)) throw fail('history classification input is malformed');
    const { derivedPair, stagedPair } = classified;
    for (const [name, pair] of [['derivedPair', derivedPair], ['stagedPair', stagedPair]]) {
      if (!isRecord(pair) || !isCount(pair.revision) || !isHash(pair.digest)) {
        throw fail('history classification ' + name + ' is malformed');
      }
    }
    const entries = await listProvenance(ref);
    const intent = intentOf(entries, eventId);
    if (!intent) throw fail('classification names no recorded intent');
    const priorPair = intent.priorPair;
    if (derivedPair.revision !== priorPair.revision + 1) {
      throw fail('history classification derived pair is not the intent successor');
    }
    const current = await readCurrent(ref);
    if (current === null) return { status: 'unproven', reason: 'anchor record is absent' };
    const anchor = current.record;
    const pairEq = (a, b) => a.revision === b.revision && a.digest === b.digest;
    const anchorPair = { revision: anchor.revision, digest: anchor.digest };
    if (pairEq(anchorPair, derivedPair) && anchor.lastEventId === eventId) {
      return { status: 'already-landed' };
    }
    if (pairEq(anchorPair, priorPair) && pairEq(stagedPair, derivedPair)) {
      return { status: 'genuinely-new' };
    }
    if (pairEq(anchorPair, priorPair) && stagedPair.revision > derivedPair.revision
      && classified.stagedPrefixThroughDerived === true
      && classified.stagedCertificateMatches === true) {
      return { status: 'landed-and-superseded' };
    }
    if (pairEq(anchorPair, priorPair) && pairEq(stagedPair, priorPair)) {
      return { status: 'void' };
    }
    return { status: 'unproven' };
  }

  // --- Public surface -------------------------------------------------------------
  async function genesisPin(householdId, input) {
    const ref = pinRef(householdId);
    const genesis = snapshot(input, 'pin genesis input');
    if (!isRecord(genesis) || !isHash(genesis.incarnation) || !isHash(genesis.digest)
      || !isTick(genesis.timestamp)) throw fail('pin genesis input is malformed');
    const eventId = genesisEventId('pin', [householdId]);
    await writeGenesisEntry(ref, {
      kind: 'genesis', eventId, record: 'pin', incarnation: genesis.incarnation, status: 'genesis',
    });
    return advanceInternal(ref, null, {
      incarnation: genesis.incarnation,
      pin: { revision: 0, digest: genesis.digest, timestamp: genesis.timestamp },
    });
  }
  async function genesisAuthorization(scope, input) {
    const ref = authorizationRef(scope);
    const genesis = snapshot(input, 'authorization genesis input');
    if (!isRecord(genesis) || !isTick(genesis.updatedAt)) {
      throw fail('authorization genesis input is malformed');
    }
    let incarnation = genesis.incarnation;
    if (incarnation === undefined || incarnation === null) {
      incarnation = computeGenesisIncarnation({ scope, schema, nonce: genesis.nonce });
    }
    if (!isHash(incarnation)) throw fail('authorization genesis incarnation is malformed');
    const eventId = genesisEventId('authorization', [scope, incarnation]);
    await writeGenesisEntry(ref, {
      kind: 'genesis', eventId, scope, schema, incarnation,
      nonce: typeof genesis.nonce === 'string' ? genesis.nonce : null, status: 'genesis',
    });
    return advanceInternal(ref, null, {
      scope, incarnation, epoch: 0, revocationCount: 0,
      frontierDigest: computeFrontierDigest({ schema, scope, incarnation, entries: [] }),
      priorDigest: null, lastEventId: eventId, updatedAt: genesis.updatedAt,
    });
  }
  async function genesisHistory(householdId, ledgerNamespace, input) {
    const ref = historyRef(householdId, ledgerNamespace);
    const genesis = snapshot(input, 'history genesis input');
    if (!isRecord(genesis) || !isHash(genesis.incarnation) || !isHash(genesis.digest)
      || !isTick(genesis.updatedAt)) throw fail('history genesis input is malformed');
    const eventId = genesisEventId('history', ref.parts);
    await writeGenesisEntry(ref, {
      kind: 'genesis', eventId, record: 'history', incarnation: genesis.incarnation, status: 'genesis',
    });
    return advanceInternal(ref, null, {
      incarnation: genesis.incarnation, revision: 0, digest: genesis.digest,
      lastEventId: eventId, updatedAt: genesis.updatedAt,
    });
  }
  function freezeRecord(record) {
    if (record === null) return null;
    if (record.pin) Object.freeze(record.pin);
    return Object.freeze(record);
  }
  function freezeGenerations(generations) {
    return Object.freeze(generations.map(g => Object.freeze({
      generation: g.generation, record: freezeRecord(g.record), recordHash: g.recordHash,
    })));
  }

  return Object.freeze({
    async readPin(householdId) {
      const current = await readCurrent(pinRef(householdId));
      return current === null ? null : freezeRecord(current.record);
    },
    async advancePin(householdId, expected, next) {
      const ref = pinRef(householdId);
      const [expCopy, nextCopy] = prepareAdvance(ref, expected, next, 'pin advance');
      return advanceInternal(ref, expCopy, nextCopy);
    },
    genesisPin,
    async listPinGenerations(householdId) {
      return freezeGenerations(await readGenerations(pinRef(householdId)));
    },
    async readAuthorization(scope) {
      const current = await readCurrent(authorizationRef(scope));
      return current === null ? null : freezeRecord(current.record);
    },
    async advanceAuthorization(scope, expected, next) {
      const ref = authorizationRef(scope);
      const [expCopy, nextCopy] = prepareAdvance(ref, expected, next, 'authorization advance');
      if (nextCopy.scope !== scope) throw fail('authorization advance scope is malformed');
      if (expCopy !== null && expCopy.scope !== scope) {
        throw fail('authorization advance expected record is malformed');
      }
      return advanceInternal(ref, expCopy, nextCopy);
    },
    genesisAuthorization,
    async listAuthorizationGenerations(scope) {
      return freezeGenerations(await readGenerations(authorizationRef(scope)));
    },
    async readHistory(householdId, ledgerNamespace) {
      const current = await readCurrent(historyRef(householdId, ledgerNamespace));
      return current === null ? null : freezeRecord(current.record);
    },
    async advanceHistory(householdId, ledgerNamespace, expected, next) {
      const ref = historyRef(householdId, ledgerNamespace);
      const [expCopy, nextCopy] = prepareAdvance(ref, expected, next, 'history advance');
      return advanceInternal(ref, expCopy, nextCopy);
    },
    genesisHistory,
    async listHistoryGenerations(householdId, ledgerNamespace) {
      return freezeGenerations(await readGenerations(historyRef(householdId, ledgerNamespace)));
    },
    openAuthorizationIntent,
    openHistoryIntent,
    async listProvenanceAuthorization(scope) {
      return Object.freeze((await listProvenance(authorizationRef(scope))).map(publicEntry));
    },
    async listProvenanceHistory(householdId, ledgerNamespace) {
      return Object.freeze((await listProvenance(historyRef(householdId, ledgerNamespace))).map(publicEntry));
    },
    async writeAckAuthorization(scope, eventId, generation, recordHash) {
      if (!isHash(eventId) || !isCount(generation) || !isHash(recordHash)) {
        throw fail('ack input is malformed');
      }
      return writeTerminal(authorizationRef(scope),
        { kind: 'ack', eventId, generation, recordHash, status: 'ack' });
    },
    async writeVoidAuthorization(scope, eventId) {
      if (!isHash(eventId)) throw fail('void input is malformed');
      return writeTerminal(authorizationRef(scope), { kind: 'void', eventId, status: 'void' });
    },
    async writeDuplicateSatisfiedAuthorization(scope, eventId, owningEventId) {
      if (!isHash(eventId) || !isHash(owningEventId) || owningEventId === eventId) {
        throw fail('duplicate-satisfied input is malformed');
      }
      return writeTerminal(authorizationRef(scope),
        { kind: 'duplicate-satisfied', eventId, owningEventId, status: 'duplicate-satisfied' });
    },
    async writeAckHistory(householdId, ledgerNamespace, eventId, generation, recordHash) {
      if (!isHash(eventId) || !isCount(generation) || !isHash(recordHash)) {
        throw fail('ack input is malformed');
      }
      return writeTerminal(historyRef(householdId, ledgerNamespace),
        { kind: 'ack', eventId, generation, recordHash, status: 'ack' });
    },
    async writeVoidHistory(householdId, ledgerNamespace, eventId) {
      if (!isHash(eventId)) throw fail('void input is malformed');
      return writeTerminal(historyRef(householdId, ledgerNamespace),
        { kind: 'void', eventId, status: 'void' });
    },
    async replayAuthorization(scope) {
      return projectReplay(await replayInternal(scope));
    },
    classifyAuthorization,
    completeAuthorizationProvenance,
    auditAuthorization,
    classifyHistoryEvent,
  });
}

module.exports = {
  createSettlementEvidenceAnchorStore,
  computeAuthorizationEventId,
  computeHistoryEventId,
  computeFrontierDigest,
  computeGenesisIncarnation,
  encodeRevocationEntry,
  decodeRevocationEntry,
  ANCHOR_FRONTIER_ENCODING_VERSION: FRONTIER_ENCODING_VERSION,
};
