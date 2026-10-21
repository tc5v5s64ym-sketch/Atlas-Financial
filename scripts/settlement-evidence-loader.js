'use strict';

// Settlement evidence loader (ATLAS-080) — the qualified read path between
// a persisted Phase 1 settlement document and Forecast's Phase 2 seam.
//
// The loader is pure and dependency-injected: callers supply the expected
// household, an independently supplied pin, and read callbacks. It performs
// no filesystem, environment, network, or provisioning access of its own,
// and it never bootstraps, adopts, repairs, promotes, or falls back to
// empty evidence.
//
// Readers are timing-agnostic: a read callback may return its value
// directly or return a Promise of the value (the production storage
// adapters' read methods are async). The loader awaits each of its three
// acquisitions — the pin read, then two document reads — inside the same
// guards that classified a synchronous throw, so a rejected read lands
// in exactly the classification a throwing read receives and no Promise
// on this path is ever dropped. Everything else about the contract is
// unchanged: same input shape, same validation order, same pin and
// stability protocols, same reason vocabulary, same projection. What
// async adds is suspension points, and the loader defends them the way
// it already defends its byte snapshot: every value it will later rely
// on is snapshotted into loader-owned form AT ACQUISITION — the
// config and callbacks bound to locals in the synchronous prologue,
// the selected pin source's load-bearing scalar pair at pin
// selection, each observed pin/document value in the turn its read
// resolves — before any suspension can let a caller move it.
//
// Persisted envelope (defined by the Phase 1 contract, not invented here):
// the document is the contract's own encoded bytes — the canonical record
// {schema, householdId, revision, operations, digest} produced by
// adopt/confirmCandidate — and the pin is the pair {revision, digest}
// naming the last qualified committed revision, where digest is the
// document's embedded digest. A self-consistent document digest alone is
// not authority: the bytes are verified through the contract under the
// expected household and compared against that independent pin, and only
// then projected through effectiveEvidence. A qualified outcome carries
// the effectiveEvidence projection and nothing else — never the raw
// document or its operation history.
//
// Outcomes are explicit and frozen:
//   { status: 'unconfigured' }            — the caller supplied no
//     configuration at all (no config content, no pin, no readers). This
//     is a caller input state, never a store state: a configured store
//     that is absent, partial, or divergent is unavailable, below.
//   { status: 'qualified', evidence }     — the pinned bytes verified.
//   { status: 'unavailable', reason }     — anything else, with one of
//     the stable REASONS codes and no evidence.

const C = require('./planned-obligation-settlement-contract');

const REASONS = Object.freeze([
  'invalid-configuration', // some configuration supplied, but incomplete or malformed
  'pin-unavailable', // the pin read itself failed (threw)
  'pin-invalid', // the pin record is malformed (revision or digest shape)
  'document-unavailable', // the document read itself failed (threw)
  'document-missing', // configured, but the store returned no bytes
  'document-malformed', // bytes are not a parseable document record
  'household-mismatch', // the document belongs to another household
  'revision-mismatch', // the document is behind the pinned revision
  'document-ahead-of-pin', // the document is past the pin (incl. unpinned candidates); never promoted
  'digest-mismatch', // same revision as the pin, different document digest
  'document-invalid', // contract verification refused the bytes (digest/replay)
  'document-changed', // the bytes moved between verification and projection
]);

const householdIdValid = value =>
  typeof value === 'string' && /^household-[a-f0-9]{32}$/.test(value);
const hashValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function unavailable(reason) {
  return Object.freeze({ status: 'unavailable', reason });
}
function normalizeBytes(value) {
  // Always a loader-owned copy: a caller may retain and mutate a Buffer
  // it handed over, and the snapshot the loader verifies and projects
  // from must never move underneath it.
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  return null;
}
const isPromiseLike = value => value !== null
  && (typeof value === 'object' || typeof value === 'function')
  && typeof value.then === 'function';
// A plain value is a value, never a Promise to await: byte carriers and
// plain records keep exactly the classification the synchronous loader
// gave them, even if a record happens to carry a `then` key.
const isPlainValue = value => Buffer.isBuffer(value) || value instanceof Uint8Array
  || typeof value === 'string' || isRecord(value);
// Snapshot a pin value into loader-owned form at acquisition. Byte
// carriers are copied (normalizeBytes); their parsed contents are
// loader-owned by construction. A record is reduced to its
// load-bearing scalar pair — revision and digest, the only fields
// parsePin consumes — read by DIRECT property access: direct reads
// honour non-enumerable fields and never touch unrelated properties,
// so unrelated getters cannot fire. The loader-owned pair that
// results carries no foreign properties at all — in particular no
// `then`: a foreign record can never escape into Promise resolution
// and be assimilated (its `then` invoked to run foreign code,
// substitute a different pin, or hang the load) at one of this
// module's async boundaries. Every other object — null-prototype,
// custom-prototype, array, function, class instance — reduces to
// the owned invalid sentinel below; immutable primitives pass
// through for parsePin to judge.
//
// The loader-owned invalid sentinel: the snapshot of any pin value
// that is neither a byte carrier nor a plain record. Such a value is
// unsupported, and unsupported must stay exactly as invalid as it was
// at acquisition. Returning the foreign object itself would carry a
// live reference across the acquire suspension, and parsePin judges
// shape only after the resume — a caller re-prototyping a null- or
// custom-prototype object to Object.prototype in that window could
// turn a pin that was invalid at acquisition into a qualifying one.
// The sentinel is frozen and carries no load-bearing values, so
// parsePin can never accept it: unsupported classifies pin-invalid
// permanently, and is never normalized into a valid record.
// Immutable primitives (null, undefined, numbers, booleans, bigints,
// symbols) are values, not references — nothing can mutate them
// across a suspension — and pass through unchanged.
const INVALID_PIN_SNAPSHOT = Object.freeze({ revision: undefined, digest: undefined });
function snapshotPinValue(value) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === 'string') {
    return normalizeBytes(value);
  }
  if (isRecord(value)) return { revision: value.revision, digest: value.digest };
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return value;
  }
  return INVALID_PIN_SNAPSHOT;
}
// Snapshot one document acquisition: the raw value — the missing-value
// checks judge it exactly as the synchronous loader judged the reader's
// return — alongside its loader-owned byte copy (normalizeBytes).
function snapshotDocumentValue(value) {
  return { raw: value, bytes: normalizeBytes(value) };
}
// Acquire one reader value with ownership bound to the acquisition.
// The reader is invoked synchronously; a plain result is snapshotted in
// the same turn, so no suspension intervenes between a synchronous
// return and its owned copy — and a plain value's `then` is never
// probed at all. A non-plain result is snapshotted FIRST, fixing its
// acquisition-time classification in loader-owned form, and only then
// probed for a `then`: reading a foreign `then` can run accessor code
// with side effects (a getter that re-prototypes the very object being
// classified), and a noncallable `then` — absent, a plain value, or a
// getter returning one — must never reclassify the original value, so
// the pre-probe snapshot is used exactly as taken, whatever the probe
// did to the foreign object. Only a callable `then` makes the value a
// genuine thenable: the pre-probe snapshot is discarded, the value is
// awaited, and the RESOLVED value is snapshotted from scratch in the
// first continuation. A rejection (or a synchronous throw, which an
// async function surfaces the same way) rethrows into the caller's
// existing guard.
async function acquire(read, snapshot) {
  const raw = read();
  if (isPlainValue(raw)) return snapshot(raw);
  const acquired = snapshot(raw);
  if (!isPromiseLike(raw)) return acquired;
  const value = await raw;
  return snapshot(value);
}

// The pin record may arrive as an object or as stored pin bytes (the
// design's pin record also carries a timestamp; extra keys are not the
// loader's concern). Only revision and digest are load-bearing.
function parsePin(record) {
  let value = record;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === 'string') {
    try { value = JSON.parse(normalizeBytes(value).toString('utf8')); } catch { return null; }
  }
  if (!isRecord(value)) return null;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) return null;
  if (!hashValid(value.digest)) return null;
  return { revision: value.revision, digest: value.digest };
}

async function loadSettlementEvidence(input) {
  if (input === undefined || input === null) return Object.freeze({ status: 'unconfigured' });
  if (!isRecord(input)) return unavailable('invalid-configuration');
  // Validate supplied fields BEFORE any absent path or pin source is
  // selected: a field that is present but malformed is a configuration
  // defect, never deliberate absence, and a malformed readPin must not
  // silently fall back to the static config pin. Absence is expressed
  // only by an undefined or null field (the documented absent forms).
  if (input.config !== undefined && input.config !== null && !isRecord(input.config)) {
    return unavailable('invalid-configuration');
  }
  if (input.readDocument !== undefined && input.readDocument !== null
    && typeof input.readDocument !== 'function') {
    return unavailable('invalid-configuration');
  }
  if (input.readPin !== undefined && input.readPin !== null
    && typeof input.readPin !== 'function') {
    return unavailable('invalid-configuration');
  }
  const config = isRecord(input.config) ? input.config : null;
  const readDocument = typeof input.readDocument === 'function' ? input.readDocument : null;
  const readPin = typeof input.readPin === 'function' ? input.readPin : null;
  const householdId = config && typeof config.householdId === 'string'
    ? config.householdId : null;
  // The callbacks and household are bound to locals here, in the
  // synchronous prologue. The static pin is deliberately NOT read
  // here: it is snapshotted at pin selection below, only if it is
  // the selected source — when a live pin reader is supplied, the
  // static value is never observed at all.
  const hasConfig = !!config && (householdId !== null || config.pin !== undefined
    || Object.keys(config).length > 0);

  // Deliberate wholly-unconfigured input is the only unconfigured outcome.
  if (!hasConfig && !readDocument && !readPin) {
    return Object.freeze({ status: 'unconfigured' });
  }
  // Anything partially supplied is a configuration defect, not absence.
  if (!householdIdValid(householdId)) return unavailable('invalid-configuration');
  if (!readDocument) return unavailable('invalid-configuration');

  // Resolve the independently supplied pin, by the base precedence:
  // a live pin reader when one is injected, otherwise the static pin
  // carried in config. When a live reader is supplied the static pin
  // is never observed (a hostile unused fallback can neither break
  // nor reject the load). The static snapshot is taken at selection —
  // on this path still before the load's first suspension, so nothing
  // a caller does after invoking the load can move the pin it
  // verifies against. A rejected pin read lands in the same
  // classification a throwing pin read receives; a selected source
  // whose load-bearing getters throw lands there too, never in an
  // escaping rejection.
  let pinRecord;
  if (readPin) {
    try { pinRecord = await acquire(readPin, snapshotPinValue); }
    catch { return unavailable('pin-unavailable'); }
  } else if (config && config.pin !== undefined) {
    try { pinRecord = snapshotPinValue(config.pin); }
    catch { return unavailable('pin-unavailable'); }
  } else {
    return unavailable('invalid-configuration');
  }
  const pin = parsePin(pinRecord);
  if (!pin) return unavailable('pin-invalid');

  // First read: acquired into the one loader-owned byte snapshot
  // everything derives from; the stability re-read below is a separate
  // owned copy compared against this preserved snapshot.
  let firstSnap;
  try { firstSnap = await acquire(readDocument, snapshotDocumentValue); }
  catch { return unavailable('document-unavailable'); }
  if (firstSnap.raw === null || firstSnap.raw === undefined) {
    return unavailable('document-missing');
  }
  const bytes = firstSnap.bytes;
  if (bytes && bytes.length === 0) return unavailable('document-missing');
  if (!bytes) return unavailable('document-malformed');

  // Staging: parse the snapshot to attribute divergence precisely. These
  // checks name the reason; the contract verification below is the
  // authority — staging never qualifies anything by itself.
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { return unavailable('document-malformed'); }
  if (!isRecord(doc) || typeof doc.householdId !== 'string'
    || !Number.isSafeInteger(doc.revision) || typeof doc.digest !== 'string') {
    return unavailable('document-malformed');
  }
  if (doc.householdId !== householdId) return unavailable('household-mismatch');
  if (doc.revision > pin.revision) return unavailable('document-ahead-of-pin');
  if (doc.revision < pin.revision) return unavailable('revision-mismatch');
  if (doc.digest !== pin.digest) return unavailable('digest-mismatch');

  // Authoritative verification of the same bytes through the Phase 1
  // contract, under the expected household, against the independent pin:
  // the contract pin over these bytes must equal the pin hash derived
  // from the supplied {revision, digest}. This refuses corrupt bytes,
  // stale embedded digests, and replayed-invalid histories alike.
  let verifiedPin;
  try { verifiedPin = C.pin(bytes, householdId); } catch { return unavailable('document-invalid'); }
  const expectedPin = C.digest({
    householdId, revision: pin.revision, documentDigest: pin.digest,
  });
  if (verifiedPin !== expectedPin) return unavailable('document-invalid');

  // Read consistency: the store must still hold the verified bytes before
  // anything is projected from them. A rejected re-read lands in the
  // same classification a throwing re-read receives. Projection uses
  // the first snapshot; the comparison is owned copy against owned copy.
  let secondSnap;
  try { secondSnap = await acquire(readDocument, snapshotDocumentValue); }
  catch { return unavailable('document-changed'); }
  const secondBytes = secondSnap.bytes;
  if (!secondBytes || !secondBytes.equals(bytes)) return unavailable('document-changed');

  // Projection: the contract replays the verified snapshot's state and
  // publishes active evidence only. No raw document leaves the loader.
  let evidence;
  try {
    evidence = C.effectiveEvidence({
      householdId: doc.householdId, revision: doc.revision, operations: doc.operations,
    });
  } catch { return unavailable('document-invalid'); }
  return Object.freeze({ status: 'qualified', evidence });
}

module.exports = { loadSettlementEvidence, REASONS };
