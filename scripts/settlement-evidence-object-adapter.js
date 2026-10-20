'use strict';

// Settlement evidence object adapter (ATLAS-080) — the conditional
// object-store persistence boundary for the merged settlement evidence
// store (scripts/settlement-evidence-store.js): the pin and the
// encrypted off-volume backups, over ONE explicitly injected object
// transport, inside ONE explicitly supplied namespace, for ONE expected
// household.
//
// FOUNDATION ONLY. This module ships with no production importer, no
// route, no default destination, and no filesystem, environment,
// network, SDK, or provisioning access of its own. The caller injects
// the transport and the encryption function explicitly; there are no
// credentials here and nothing to configure. It supplies exactly the
// store's injected pinStore and backupStore surfaces:
//
//   pinStore.read()  -> null ONLY for proven absence. The stored pin
//     object is validated on every read (shape, household binding,
//     revision, digest, timestamp); malformed, unreadable, ambiguous or
//     foreign-household pin state THROWS — it is never absence.
//   pinStore.advance(expected, next) -> the literal value true ONLY for
//     a definite, acknowledgement-verified conditional write; the
//     literal value false ONLY for a definite conflict (the observed
//     pair differs from the expected pair, or the conditional write
//     reports a definite version conflict); anything else — a lost or
//     malformed acknowledgement, an unreadable pin — THROWS, so the
//     store preserves uncertainty and reconciles from observation.
//     Inputs are snapshotted (deep-copied) at entry, before any await:
//     caller mutation across awaits cannot move the operation. The
//     transition itself is validated: genesis (revision 0 against an
//     absent pin) or a sequential advance only — no rollback, no
//     same-revision different-digest fork, no skipped revision — and a
//     newly observed winner is never adopted as an automatic retry base.
//   backupStore.put(revision, digest, bytes) -> the document is
//     validated through the Phase 1 contract under the expected
//     household (and against the supplied revision/digest) BEFORE
//     encryption or upload. Only the injected encryption function's
//     output ever reaches the transport; malformed output, or output
//     equal to the plaintext, is refused — there is no plaintext
//     fallback. Artifacts are create-only under a deterministic,
//     content-free identity (the namespace + revision + document
//     digest); a retry over an existing artifact returns an
//     acknowledgement bound to the EXISTING artifact only after its
//     stored binding and ciphertext integrity verify — it never
//     overwrites stored bytes and never reports success for bytes that
//     were never stored.
//   backupStore.list() -> the complete manifest: pagination is
//     exhausted, every owned artifact's revision/digest binding AND
//     stored-bytes integrity are verified, and malformed entries,
//     unknown artifacts inside the owned namespace, partial pages and
//     repeated cursors THROW. An empty or partial manifest is never
//     returned as success: in the store, a manifest can license genesis
//     or destruction, so an unverifiable one must license nothing.
//     Each page's entries are snapshotted (key plus the binding
//     scalars) into adapter-owned objects as the page arrives, and
//     classification and verification reason only over those
//     snapshots: the transport may retain and mutate its own entry
//     objects across awaits, and a mutation can never rewrite what
//     was already observed.
//   backupStore.get() -> deliberately THROWS recovery-unavailable in
//     this slice. No owner-held private key exists on the server (the
//     design's key split keeps it offline with the owner), so this
//     adapter cannot decrypt backups and never returns ciphertext as if
//     it were plaintext. The store composes this as recovery-blocked
//     with all evidence preserved.
//
// Transport contract (defined and required here; a transport that
// cannot meet it is refused at construction — compare-and-swap is never
// emulated with an unconditional write):
//   read(key)           -> null (proven absence) or
//                          { bytes, version, metadata }, where version
//                          is an opaque non-empty token bound to the
//                          stored object and metadata is the record
//                          supplied at write time.
//   create(key, bytes, metadata)
//                       -> atomic absent-only create; resolves
//                          { version, integrity } where integrity is
//                          the SHA-256 hex of the stored bytes; a
//                          definite already-exists outcome throws an
//                          error with code 'conflict'. Any other throw
//                          is ambiguous (the write may have landed).
//   replace(key, bytes, version, metadata)
//                       -> atomic replacement conditional on the exact
//                          version token; same acknowledgement shape; a
//                          definite version mismatch or absence throws
//                          an error with code 'conflict'.
//   list(prefix, cursor)-> { entries: [{ key, metadata }], nextCursor }
//                          with nextCursor null exactly when the
//                          listing is complete; cursor is null for the
//                          first page and thereafter the opaque token
//                          the previous page returned.
// Object keys, artifact names, metadata and error messages carry no
// household, transaction, actor or operation data. This slice runs
// against synthetic transports and synthetic encryption only: it does
// NOT qualify a real object provider or real age cryptography, and it
// performs no provisioning, configuration or activation.

const crypto = require('node:crypto');
const C = require('./planned-obligation-settlement-contract');

const PREFIX = 'settlement-object-adapter:';
const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const NAMESPACE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_PAGES = 10000;

function fail(detail) { return new Error(PREFIX + ' ' + detail); }
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function isHash(value) { return typeof value === 'string' && HASH_RE.test(value); }
function isTick(value) { return Number.isSafeInteger(value) && value > 0; }
function copyBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function isConflict(error) { return !!error && error.code === 'conflict'; }
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function createSettlementEvidenceObjectAdapter(deps) {
  // Raw factory inputs are validated BEFORE anything can take an
  // absence branch: malformed supplied configuration throws here, at
  // construction, and is never normalized into "unconfigured".
  if (!isRecord(deps)) throw new TypeError(PREFIX + ' deps must be a record');
  const { householdId, namespace, transport, encrypt } = deps;
  if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
    throw new TypeError(PREFIX + ' householdId is malformed');
  }
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.length > 128
    || !NAMESPACE_RE.test(namespace) || namespace.includes('..')) {
    throw new TypeError(PREFIX + ' namespace is malformed');
  }
  if (!transport || typeof transport !== 'object' || Array.isArray(transport)
    || ['read', 'create', 'replace', 'list'].some(m => typeof transport[m] !== 'function')) {
    throw new TypeError(PREFIX + ' transport lacks a required conditional capability');
  }
  if (typeof encrypt !== 'function') {
    throw new TypeError(PREFIX + ' an encryption function is required');
  }

  // The pin object binds the expected household by the contract digest
  // of the household id: verifiable on read, and itself content-free.
  const householdBinding = C.digest({ householdId });
  const pinKey = namespace + '/pin.json';
  const artifactKeyFor = (revision, digest) =>
    namespace + '/revisions/rev-' + revision + '-' + digest + '.enc';
  const artifactRe = new RegExp('^' + escapeRegExp(namespace)
    + '/revisions/rev-(0|[1-9][0-9]*)-([a-f0-9]{64})\\.enc$');

  // --- Pin -------------------------------------------------------------------
  function pinBytes(next) {
    return Buffer.from(JSON.stringify({
      v: 1, household: householdBinding,
      revision: next.revision, digest: next.digest, timestamp: next.timestamp,
    }));
  }
  // A transport read result is validated as a shape before its bytes are
  // trusted: bytes-or-null is the only absence evidence, and a malformed
  // result is an unreadable pin, never an absent one.
  function readResultBytes(raw, what) {
    if (!isRecord(raw)) throw fail(what + ' read result is malformed');
    const bytes = copyBytes(raw.bytes);
    if (!bytes) throw fail(what + ' read result carries no bytes');
    if (typeof raw.version !== 'string' || raw.version.length === 0) {
      throw fail(what + ' read result carries no version token');
    }
    if (!isRecord(raw.metadata)) throw fail(what + ' read result carries no metadata');
    return bytes;
  }
  function parsePin(raw) {
    const bytes = readResultBytes(raw, 'pin');
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch {
      throw fail('stored pin is not a pin record');
    }
    if (!isRecord(value)) throw fail('stored pin is not a pin record');
    const actual = Object.keys(value).sort();
    const wanted = ['digest', 'household', 'revision', 'timestamp', 'v'];
    if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])
      || value.v !== 1 || value.household !== householdBinding
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !isHash(value.digest) || !isTick(value.timestamp)) {
      throw fail('stored pin failed validation');
    }
    return { revision: value.revision, digest: value.digest, timestamp: value.timestamp };
  }
  // A write acknowledgement proves definite success only when it binds
  // the exact bytes the adapter intended to store: the stored identity
  // (a fresh version token) and their integrity.
  function validateAck(ack, intendedBytes) {
    if (!isRecord(ack) || typeof ack.version !== 'string' || ack.version.length === 0
      || ack.integrity !== sha256(intendedBytes)) {
      throw fail('write acknowledgement does not bind the stored bytes');
    }
  }

  const pinStore = {
    async read() {
      const raw = await transport.read(pinKey);
      if (raw === null) return null;
      const pin = parsePin(raw);
      return Object.freeze({
        revision: pin.revision, digest: pin.digest, timestamp: pin.timestamp,
      });
    },

    async advance(expected, next) {
      // Snapshot the complete request at entry, before any await: the
      // caller retains (and may mutate) its own objects across ours.
      let expCopy;
      let nextCopy;
      try {
        expCopy = expected === null ? null : JSON.parse(JSON.stringify(expected));
        nextCopy = JSON.parse(JSON.stringify(next));
      } catch {
        throw fail('pin advance arguments are not snapshot-able records');
      }
      if (expCopy !== null && (!isRecord(expCopy)
        || !Number.isSafeInteger(expCopy.revision) || expCopy.revision < 0
        || !isHash(expCopy.digest))) {
        throw fail('pin advance expected pair is malformed');
      }
      if (!isRecord(nextCopy) || !Number.isSafeInteger(nextCopy.revision)
        || nextCopy.revision < 0 || !isHash(nextCopy.digest)
        || !isTick(nextCopy.timestamp)) {
        throw fail('pin advance next pair is malformed');
      }
      // The transition is validated against the EXPECTED pair (the
      // frozen base the caller proved it saw), never against whatever
      // the pin happens to hold by the time the write lands.
      const baseRevision = expCopy === null ? -1 : expCopy.revision;
      if (nextCopy.revision !== baseRevision + 1) {
        throw fail('pin advance is not a genesis or sequential transition');
      }
      const bytes = pinBytes(nextCopy);
      const metadata = { revision: nextCopy.revision };
      const raw = await transport.read(pinKey);
      if (raw === null) {
        if (expCopy !== null) return false; // definite: no pin to match the pair
        let ack;
        try {
          ack = await transport.create(pinKey, Buffer.from(bytes), metadata);
        } catch (error) {
          if (isConflict(error)) return false; // a concurrent create landed first
          throw error; // lost or ambiguous acknowledgement: uncertainty
        }
        validateAck(ack, bytes);
        return true;
      }
      const observed = parsePin(raw); // malformed/foreign pin state throws
      if (expCopy === null) return false; // definite: a pin already exists
      if (observed.revision !== expCopy.revision || observed.digest !== expCopy.digest) {
        return false; // definite: the full pair does not match
      }
      let ack;
      try {
        ack = await transport.replace(pinKey, Buffer.from(bytes), raw.version, metadata);
      } catch (error) {
        if (isConflict(error)) return false; // the version moved under us
        throw error; // lost or ambiguous acknowledgement: uncertainty
      }
      validateAck(ack, bytes);
      return true;
    },
  };

  // --- Backup ------------------------------------------------------------------
  async function reuseExisting(key, revision, digest) {
    const raw = await transport.read(key);
    if (raw === null) throw fail('backup artifact vanished after a create conflict');
    const bytes = readResultBytes(raw, 'backup artifact');
    const metadata = raw.metadata;
    if (metadata.revision !== revision || metadata.digest !== digest
      || !isHash(metadata.integrity)) {
      throw fail('existing backup artifact does not bind this revision and digest');
    }
    if (sha256(bytes) !== metadata.integrity) {
      throw fail('existing backup artifact fails its stored integrity binding');
    }
    return Object.freeze({ revision, digest, artifactId: key });
  }

  const backupStore = {
    async put(revision, digest, bytes) {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw fail('backup revision is malformed');
      }
      if (!isHash(digest)) throw fail('backup digest is malformed');
      const snapshot = copyBytes(bytes);
      if (!snapshot || snapshot.length === 0) throw fail('backup document bytes are malformed');
      // Contract validation BEFORE encryption or upload: the bytes must
      // be this household's document at exactly the supplied revision
      // and digest.
      let state;
      try {
        C.pin(snapshot, householdId);
        state = JSON.parse(snapshot.toString('utf8'));
      } catch {
        throw fail('backup document failed contract validation');
      }
      if (!isRecord(state) || state.revision !== revision || state.digest !== digest) {
        throw fail('backup revision and digest do not match the document');
      }
      const produced = await encrypt(Buffer.from(snapshot));
      const ciphertext = copyBytes(produced);
      if (!ciphertext || ciphertext.length === 0) {
        throw fail('encryption output is malformed');
      }
      if (ciphertext.equals(snapshot)) {
        throw fail('encryption output equals the plaintext document');
      }
      const key = artifactKeyFor(revision, digest);
      const metadata = { revision, digest, integrity: sha256(ciphertext) };
      let ack;
      try {
        ack = await transport.create(key, Buffer.from(ciphertext), { ...metadata });
      } catch (error) {
        if (isConflict(error)) return reuseExisting(key, revision, digest);
        throw error; // ambiguous upload: the store preserves uncertainty
      }
      validateAck(ack, ciphertext);
      return Object.freeze({ revision, digest, artifactId: key });
    },

    async get() {
      // Deliberate: no owner-held private key exists on the server, so
      // stored ciphertext can never be decrypted here and is never
      // returned as if it were plaintext. The store composes this throw
      // as recovery-blocked with all evidence preserved.
      throw fail('backup recovery unavailable: no owner-held decryption key exists on the server');
    },

    async list() {
      const prefix = namespace + '/';
      const seenCursors = new Set();
      const seenKeys = new Set();
      const found = [];
      let cursor = null;
      for (let page = 0; ; page++) {
        if (page >= MAX_PAGES) throw fail('backup listing did not terminate');
        const raw = await transport.list(prefix, cursor);
        if (!isRecord(raw) || !Array.isArray(raw.entries)
          || (raw.nextCursor !== null
            && (typeof raw.nextCursor !== 'string' || raw.nextCursor.length === 0))) {
          throw fail('backup listing page is malformed');
        }
        for (const entry of raw.entries) {
          if (!isRecord(entry) || typeof entry.key !== 'string'
            || !isRecord(entry.metadata)) {
            throw fail('backup listing entry is malformed');
          }
          if (seenKeys.has(entry.key)) throw fail('backup listing repeated an entry');
          seenKeys.add(entry.key);
          // Snapshot the validated key and the metadata scalars this
          // adapter relies on into an adapter-owned object NOW, as the
          // page arrives. The transport retains its entry objects and
          // may mutate them across the awaits that follow (later page
          // fetches, artifact reads); classification, pagination and
          // read verification below reason ONLY over these snapshots,
          // so an entry observed as one key/binding can never be
          // rewritten into another — e.g. into the pin key, which
          // classification skips — after the fact.
          found.push(Object.freeze({
            key: entry.key,
            revision: entry.metadata.revision,
            digest: entry.metadata.digest,
            integrity: entry.metadata.integrity,
          }));
        }
        if (raw.nextCursor === null) break;
        if (seenCursors.has(raw.nextCursor)) {
          throw fail('backup listing repeated a cursor');
        }
        seenCursors.add(raw.nextCursor);
        cursor = raw.nextCursor;
      }
      // Every owned snapshot is classified and verified. The pin object
      // is not a backup; revision artifacts must bind their own name;
      // any other key inside the owned namespace is an unknown artifact
      // and is surfaced as a failure — it never silently disappears
      // from the manifest the store reasons over.
      const entries = [];
      for (const entry of found) {
        if (entry.key === pinKey) continue;
        const match = artifactRe.exec(entry.key);
        if (!match) throw fail('unknown artifact inside the owned namespace');
        const revision = Number(match[1]);
        const digest = match[2];
        if (String(revision) !== match[1]) {
          throw fail('backup artifact name is not canonical');
        }
        if (entry.revision !== revision || entry.digest !== digest
          || !isHash(entry.integrity)) {
          throw fail('backup manifest entry binding is malformed');
        }
        const raw = await transport.read(entry.key);
        if (raw === null) throw fail('backup manifest artifact vanished');
        const bytes = readResultBytes(raw, 'backup artifact');
        if (raw.metadata.revision !== revision || raw.metadata.digest !== digest
          || raw.metadata.integrity !== entry.integrity) {
          throw fail('backup manifest entry disagrees with the stored artifact');
        }
        if (sha256(bytes) !== entry.integrity) {
          throw fail('backup artifact fails its stored integrity binding');
        }
        entries.push(Object.freeze({ revision, digest, artifactId: entry.key }));
      }
      entries.sort((a, b) => a.revision - b.revision
        || (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0));
      return entries;
    },
  };

  return { pinStore, backupStore };
}

module.exports = { createSettlementEvidenceObjectAdapter };
