'use strict';

// Settlement evidence store (ATLAS-080) — the inactive commit/recovery
// state machine: the write side pairing the merged read loader.
//
// FOUNDATION ONLY. This module ships with no production importer, no
// route, no filesystem, environment, network, or provisioning access of
// its own. It runs only against dependency-injected adapters (document,
// journal, pin, backup, quarantine, lock, clock) and is exercised only
// by its synthetic test suite. Nothing here activates settlement
// evidence: no live caller exists, and the production genesis remains a
// separately gated owner act.
//
// What it does: a confirmed Phase 1 candidate is landed durably through
// an explicit pipeline — journal (carrying the complete frozen preview)
// -> temp -> atomic rename -> contract readback -> revision backup ->
// conditional pin advance (CAS on the exact frozen base pair) -> receipt.
// A crash or adapter failure between any two steps leaves the store in a
// shape the merged loader already classifies, and an explicit reconciler
// resolves every interrupted state under the ruled H/P/J decision table
// (R0-R8): it promotes only a provably-matching pending commit, restores
// the pinned revision and quarantines divergent bytes on any other
// divergence, and refuses to fabricate an outcome while the pin is
// unreadable. It never bootstraps over traces, never promotes on a
// self-consistent digest alone, and never issues a receipt for an
// operation absent from the pinned ledger.
//
// Explicit limits (read before wiring this to real adapters):
//   - Serialization is by the INJECTED lock, shared across factory
//     instances that share the same adapters. Cross-process exclusion is
//     a production-adapter prerequisite: pin CAS alone does NOT protect
//     head/journal writes or stale restores, and two writers in two
//     processes break the single-writer premise this design rests on.
//   - The backup adapter moves plaintext bytes inside this module; the
//     production adapter owns age encryption and the revisions/<rev>-
//     <digest>.age naming. backupStore.get in this slice is a synthetic
//     plaintext read: it is NOT a promise that the production server can
//     decrypt stored backups (the age private key is held offline by the
//     owner under the design's key split). Restore-time integrity is
//     proven by the contract (restore + replay against the pin), never
//     by transport success alone.
//   - The API is async throughout: the production adapters this shape
//     anticipates (fsync, object-store upload) are inherently async.
//
// commitWithoutRecovery is a distinct capability for confirmation callers.
// It snapshots input before ONE acquisition of the same shared lock and uses
// the same validation/commit pipeline with recovery disabled privately. A
// matching pinned receipt is returned read-only, even with a residual journal.
// An uncommitted request encountering a journal or divergent/missing head
// returns rejected('recovery-required'): a DEFINITE PRE-WRITE refusal by this
// invocation, preserving all interrupted evidence. After journal write begins,
// pin movement is UNKNOWN, never this definite refusal; no pre-pass, C8
// mismatch or CAS-false branch may reconcile, restore, quarantine or clean up.
// Successful pinning may finalize this invocation's own journal normally.
// Ordinary commit() and explicit reconcile() retain their recovery semantics.
//
// commitAdmitted is a further distinct capability for fenced confirmation
// callers: the identical single-lock, no-recovery pipeline, except that a
// synchronous freshness witness paired with the caller's acquisition is
// invoked exactly once — after every prewrite await and the synchronous
// candidate/journal construction, immediately before the journal write —
// and only its literal true admits the write. Refusal, a throw, or any
// other value (thenables are never awaited or assimilated) returns
// rejected('admission-refused'): a definite pre-write refusal with zero
// durable mutations. Paths that produce no new candidate (the original
// pinned receipt, a conflict, recovery-required, preview-expired) precede
// the fence and never invoke the witness; once admission succeeds, later
// invalidation neither cancels a partly written operation nor converts
// uncertain persistence into a definite refusal. Admission is a
// process-local freshness fence, not the durable pin transition.
//
// inspectAttempt is a trusted READ-ONLY inspection for settled-uncertainty
// recovery (P2): given the controller-retained actor, the complete frozen
// preview and the confirmation digest, it establishes only whether that
// exact attempt is committed in the validated pinned ledger, not committed
// at the preview's exact pinned base, or unresolved — and returns store
// readiness separately (a qualified pinned head plus a successfully read
// ABSENT journal; a present or unreadable journal is not ready, even when
// the disposition is known). It snapshots its input before acquiring the
// same shared lock, validates every binding under that lock, and never
// writes, commits, reconciles, promotes, restores or clears a journal.
// Explicit reconcile() remains the only cleanup path; after a successful
// R4 cleanup a caller freshly inspects the pinned base rather than trusting
// a cached or caller-supplied R4 report.

const C = require('./planned-obligation-settlement-contract');
const TC = require('./settlement-evidence-terminal-certificate');

const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const ACTOR_RE = /^session-[a-f0-9]{64}$/;
const OPERATION_RE = /^operation-[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const JOURNAL_KEYS = ['version', 'householdId', 'operationId', 'actorId',
  'baseRevision', 'baseDigest', 'baseBytes', 'preview', 'requestDigest',
  'resultingRevision', 'resultingDigest', 'recordedAt'];

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
function deepCopy(value) { return JSON.parse(JSON.stringify(value)); }
function unavailable(reason) { return { status: 'unavailable', reason }; }
function unknown(reason) { return { status: 'unknown', reason }; }
const RESTART = Symbol('restart-evaluation');

function createSettlementEvidenceStore(deps) {
  if (!isRecord(deps)) throw new TypeError('settlement-store: deps must be a record');
  const { householdId, documentStore, journalStore, pinStore, backupStore,
    quarantine, lock, now } = deps;
  if (typeof householdId !== 'string' || !HOUSEHOLD_RE.test(householdId)) {
    throw new TypeError('settlement-store: householdId is malformed');
  }
  const need = (adapter, methods, name) => {
    if (!adapter || methods.some(m => typeof adapter[m] !== 'function')) {
      throw new TypeError('settlement-store: ' + name + ' adapter is incomplete');
    }
  };
  need(documentStore, ['read', 'readStaged', 'writeTemp', 'commitTemp', 'discardTemp'], 'documentStore');
  need(journalStore, ['read', 'write', 'clear'], 'journalStore');
  need(pinStore, ['read', 'advance'], 'pinStore');
  need(backupStore, ['put', 'get', 'list'], 'backupStore');
  need(quarantine, ['put'], 'quarantine');
  if (!lock || typeof lock.withLock !== 'function') {
    throw new TypeError('settlement-store: lock.withLock is required');
  }
  if (typeof now !== 'function') throw new TypeError('settlement-store: now is required');
  const tick = () => {
    const t = now();
    if (!isTick(t)) throw new Error('settlement-store: clock returned a non-tick');
    return t;
  };

  // Optional D1(i): the SAME lock governs negative seals and financial landing.
  // No production dependency. Missing/rolled-back history is never genesis.
  const terminalHistory = deps.terminalHistory, exclusionEnabled = terminalHistory !== undefined;
  if (exclusionEnabled && (!isRecord(terminalHistory) || typeof terminalHistory.readSnapshot !== 'function'
    || typeof terminalHistory.compareAndAppend !== 'function')) throw new TypeError('terminal history incomplete');
  // B4 re-login recovery read opt-in: exactly `true` enables the capability
  // (gated stores only); absence/false leaves it unexposed, and any other
  // supplied value is malformed configuration, never a silent default.
  if (deps.recoveryRead !== undefined && deps.recoveryRead !== true && deps.recoveryRead !== false)
    throw new TypeError('settlement-store: recoveryRead opt-in is malformed');
  const recoveryEnabled = exclusionEnabled && deps.recoveryRead === true;
  const domain = TC.registerDomain(householdId, deps.exclusionDomain, exclusionEnabled,
    [documentStore, journalStore, pinStore, lock]);
  async function terminalGate(head) {
    if (!exclusionEnabled) return null;
    const state = TC.qualifySnapshot(await terminalHistory.readSnapshot(), domain);
    if (head && state.history.records.some(r => head.operations.some(o => o.operationId === r.operationId)))
      throw new Error('terminal negative/financial coexistence');
    return state;
  }
  const derive = pin => C.digest({
    householdId, revision: pin.revision, documentDigest: pin.digest,
  });

  // --- Validated adapter reads (condition 6: shapes are validated inside
  // the machine; a failed or malformed read is never absence). ----------
  function validPinRecord(raw) {
    return isRecord(raw) && Number.isSafeInteger(raw.revision) && raw.revision >= 0
      && isHash(raw.digest) && isTick(raw.timestamp);
  }
  async function readPinState() {
    let raw;
    try { raw = await pinStore.read(); } catch { return { kind: 'error' }; }
    if (raw === null) return { kind: 'absent' };
    if (!validPinRecord(raw)) return { kind: 'error' };
    return {
      kind: 'ok',
      pin: { revision: raw.revision, digest: raw.digest, timestamp: raw.timestamp },
    };
  }
  async function readDocState() {
    let raw;
    try { raw = await documentStore.read(); } catch { return { kind: 'error' }; }
    if (raw === null) return { kind: 'ok', bytes: null };
    const bytes = copyBytes(raw);
    if (!bytes) return { kind: 'error' };
    return { kind: 'ok', bytes };
  }
  async function readJournalState() {
    let raw;
    try { raw = await journalStore.read(); } catch { return { kind: 'error' }; }
    if (raw === null) return { kind: 'ok', raw: null };
    const bytes = copyBytes(raw);
    if (!bytes) return { kind: 'error' };
    return { kind: 'ok', raw: bytes };
  }
  async function readManifestState() {
    let raw;
    try { raw = await backupStore.list(); } catch { return { kind: 'error' }; }
    if (!Array.isArray(raw)) return { kind: 'error' };
    // Entries are validated at read time: a manifest carrying malformed
    // entries is not 'ok' and must never license a destructive row.
    const malformed = raw.some(entry => !validManifestEntry(entry));
    return { kind: malformed ? 'malformed' : 'ok', entries: raw };
  }

  // The contract is the only authority on document bytes: a document is
  // usable here only if C.pin verifies it under the factory household.
  function docState(bytes) {
    try {
      C.pin(bytes, householdId);
      const value = JSON.parse(bytes.toString('utf8'));
      return {
        householdId: value.householdId, revision: value.revision,
        operations: value.operations, digest: value.digest,
      };
    } catch { return null; }
  }
  function stagingRevision(bytes) {
    try {
      const value = JSON.parse(bytes.toString('utf8'));
      return isRecord(value) && Number.isSafeInteger(value.revision) ? value.revision : 'unknown';
    } catch { return 'unknown'; }
  }
  function prefixDigest(state, revision) {
    return C.digest({
      schema: C.SCHEMA, householdId, revision,
      operations: state.operations.slice(0, revision),
    });
  }
  // Correction 3: a receipt names the operation's ORIGINAL committed
  // revision and the document digest at that revision, derived from the
  // validated immutable prefix — never the current head.
  function receiptForOperation(state, operationId) {
    const recorded = state.operations.find(o => o.operationId === operationId);
    return {
      status: 'committed', operationId, actorId: recorded.actorId,
      revision: recorded.revision, digest: prefixDigest(state, recorded.revision),
    };
  }

  // --- Journal (F-A: the complete frozen preview is carried) ------------
  function parseJournal(raw) {
    let value;
    try { value = JSON.parse(raw.toString('utf8')); } catch { return { kind: 'torn' }; }
    if (!isRecord(value)) return { kind: 'torn' };
    const actual = Object.keys(value).sort();
    const wanted = [...JOURNAL_KEYS].sort();
    if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])) {
      return { kind: 'torn' };
    }
    if (value.version !== 1 || value.householdId !== householdId
      || !OPERATION_RE.test(value.operationId) || !ACTOR_RE.test(value.actorId)
      || !Number.isSafeInteger(value.baseRevision) || value.baseRevision < 0
      || !isHash(value.baseDigest)
      || typeof value.baseBytes !== 'string' || value.baseBytes.length % 4 !== 0
      || !BASE64_RE.test(value.baseBytes)
      || !isRecord(value.preview) || !isHash(value.requestDigest)
      || value.resultingRevision !== value.baseRevision + 1
      || !isHash(value.resultingDigest) || !isTick(value.recordedAt)) {
      return { kind: 'torn' };
    }
    return { kind: 'valid', journal: value };
  }
  function journalBaseDoc(journal) {
    const bytes = Buffer.from(journal.baseBytes, 'base64');
    if (!bytes.length) return null;
    const state = docState(bytes);
    if (!state || state.revision !== journal.baseRevision
      || state.digest !== journal.baseDigest) return null;
    return state;
  }

  function validAck(ack, revision, digest) {
    return isRecord(ack) && ack.revision === revision && ack.digest === digest
      && typeof ack.artifactId === 'string' && ack.artifactId.length > 0;
  }
  function validManifestEntry(entry) {
    return isRecord(entry) && Number.isSafeInteger(entry.revision) && entry.revision >= 0
      && isHash(entry.digest) && typeof entry.artifactId === 'string'
      && entry.artifactId.length > 0;
  }

  // --- Reconciler ---------------------------------------------------------
  function r3Proof(head, journal) {
    // Correction 2: receipt requires the actual recorded operation with
    // matching actor/request binding. A journal whose resultingDigest and
    // baseRevision merely line up with the head proves nothing about an
    // operation absent from the pinned ledger.
    const recorded = head.operations.find(o => o.operationId === journal.operationId);
    if (!recorded) return false;
    if (recorded.actorId !== journal.actorId
      || recorded.requestDigest !== journal.requestDigest
      || journal.resultingRevision !== recorded.revision
      || journal.baseRevision !== recorded.revision - 1
      || journal.resultingDigest !== prefixDigest(head, recorded.revision)) {
      return false;
    }
    const base = journalBaseDoc(journal);
    return !!base && journal.baseDigest === prefixDigest(head, journal.baseRevision);
  }

  async function r4Disposition(head, pin, raw, parsed) {
    // Addendum A C3: a journal naming a sealed operation is contradictory
    // evidence even when ordinary R4 could discard it. Preserve EVERY byte.
    if (exclusionEnabled) {
      try {
        const terminal = await terminalGate(head);
        let named;
        try { named = JSON.parse(raw.toString('utf8'))?.operationId; } catch {}
        if (terminal.history.records.some(r => r.operationId === named))
          return { row: 'R4', disposition: 'recovery-blocked', reason: 'sealed-journal' };
      } catch { return { row: 'R4', disposition: 'recovery-blocked', reason: 'terminal-history-unavailable' }; }
    }
    if (parsed.kind === 'valid') {
      const journal = parsed.journal;
      const opAbsent = !head.operations.some(o => o.operationId === journal.operationId);
      const base = journalBaseDoc(journal);
      const baseIsHead = !!base && journal.baseRevision === pin.revision
        && journal.baseDigest === pin.digest
        && journal.resultingRevision === pin.revision + 1;
      // Condition 9: a valid unlanded journal is discarded as not-committed
      // ONLY after its exact base is proven to be the current pinned head
      // and its operation is absent.
      if (opAbsent && baseIsHead) {
        let cleared = true;
        try { await journalStore.clear(); } catch { cleared = false; }
        try { await documentStore.discardTemp(); } catch { /* residue is never the document */ }
        const report = {
          row: 'R4', disposition: 'not-committed', operationId: journal.operationId,
        };
        if (!cleared) report.detail = 'journal-clear-failed';
        return report;
      }
    }
    // A torn or unrelated journal is quarantined as invalid — no
    // operation-level not-committed receipt is invented for it. Failed
    // cleanup leaves the journal resident and new commits blocked.
    try {
      await quarantine.put('invalid-journal', Buffer.from(raw));
    } catch {
      return { row: 'R4', disposition: 'recovery-blocked', reason: 'journal-quarantine-failed' };
    }
    try {
      await journalStore.clear();
    } catch {
      return { row: 'R4', disposition: 'recovery-blocked', reason: 'journal-clear-failed' };
    }
    try { await documentStore.discardTemp(); } catch { /* swallowed */ }
    return {
      row: 'R4', disposition: 'journal-quarantined',
      operationId: parsed.kind === 'valid' ? parsed.journal.operationId : null,
    };
  }

  function r5Proof(head, pin, journal) {
    try {
      if (journal.baseRevision !== pin.revision || journal.baseDigest !== pin.digest) {
        return false;
      }
      const base = journalBaseDoc(journal);
      if (!base) return false;
      if (head.operations.length !== pin.revision + 1) return false;
      if (C.digest(head.operations.slice(0, pin.revision)) !== C.digest(base.operations)) {
        return false; // the unchanged full operation prefix
      }
      const last = head.operations[pin.revision];
      if (!last || last.operationId !== journal.operationId
        || last.actorId !== journal.actorId
        || last.requestDigest !== journal.requestDigest
        || last.revision !== pin.revision + 1) return false;
      if (journal.resultingDigest !== head.digest
        || journal.resultingRevision !== head.revision) return false;
      // F-A: re-hash the complete frozen preview carried by the journal
      // and verify the appended operation against it — command, actor,
      // operation id, expected base, and the recorded timestamp inside
      // the preview's original validity window (recovery does NOT apply
      // a newly-expired wall-clock TTL).
      const preview = journal.preview;
      if (C.digest(preview) !== journal.requestDigest) return false;
      if (preview.operationId !== journal.operationId
        || preview.actorId !== journal.actorId
        || preview.householdId !== householdId
        || preview.expectedRevision !== journal.baseRevision
        || preview.expectedDocumentDigest !== journal.baseDigest
        || !isTick(preview.issuedAt) || preview.expiresAt !== preview.issuedAt + C.TTL_MS) {
        return false;
      }
      if (C.digest(last.command) !== C.digest(preview.command)) return false;
      if (last.recordedAt !== journal.recordedAt) return false;
      if (!(preview.issuedAt <= last.recordedAt && last.recordedAt < preview.expiresAt)) {
        return false;
      }
      return true;
    } catch { return false; }
  }

  async function promote(head, pin, journal, headBytes, manifest) {
    if (manifest.kind === 'error') {
      return { row: 'R5', disposition: 'promotion-pending', reason: 'backup-ambiguous' };
    }
    // F-B: a manifest hit must carry the same validated durable
    // revision/digest/artifact binding as a put acknowledgement.
    const hit = manifest.entries.some(entry => validManifestEntry(entry)
      && entry.revision === head.revision && entry.digest === head.digest);
    if (!hit) {
      let ack;
      try {
        ack = await backupStore.put(head.revision, head.digest, Buffer.from(headBytes));
      } catch {
        return { row: 'R5', disposition: 'promotion-pending', reason: 'backup-ambiguous' };
      }
      if (!validAck(ack, head.revision, head.digest)) {
        return { row: 'R5', disposition: 'promotion-pending', reason: 'backup-ambiguous' };
      }
    }
    if (!C.verifyReadback(headBytes, {
      householdId, operationId: journal.operationId,
      nextPin: derive({ revision: head.revision, digest: head.digest }),
    })) {
      return { row: 'R5', disposition: 'promotion-pending', reason: 'readback-failed' };
    }
    // Fresh pin recheck immediately before the CAS.
    const fresh = await readPinState();
    if (fresh.kind !== 'ok' || fresh.pin.revision !== pin.revision
      || fresh.pin.digest !== pin.digest) return RESTART;
    let ok;
    try {
      ok = await pinStore.advance(
        { revision: pin.revision, digest: pin.digest },
        { revision: head.revision, digest: head.digest, timestamp: tick() });
    } catch {
      return { row: 'R5', disposition: 'promotion-pending', reason: 'pin-advance-failed' };
    }
    if (ok === false) return RESTART;
    if (ok !== true) {
      // B1: CAS success is the literal value true only. A malformed or
      // lost ack proves nothing either way, so decide solely from the
      // pin as freshly observed: if it observably covers the head, the
      // promotion has in fact landed; if it is unchanged, the promotion
      // stays pending with the journal resident.
      const after = await readPinState();
      if (after.kind === 'ok' && after.pin.revision === head.revision
        && after.pin.digest === head.digest) {
        // Landed — fall through to the journal clear below.
      } else if (after.kind === 'ok' && after.pin.revision === pin.revision
        && after.pin.digest === pin.digest) {
        return { row: 'R5', disposition: 'promotion-pending', reason: 'pin-advance-failed' };
      } else {
        return RESTART;
      }
    }
    let cleared = true;
    try { await journalStore.clear(); } catch { cleared = false; }
    const report = {
      row: 'R5', disposition: 'promoted', operationId: journal.operationId,
      revision: head.revision, digest: head.digest,
    };
    if (!cleared) report.detail = 'journal-clear-failed';
    return report;
  }

  async function restorePinned(row, pin, headBytes, journalRaw) {
    let stored;
    try { stored = await backupStore.get(pin.revision, pin.digest); } catch { stored = null; }
    const bytes = stored === null ? null : copyBytes(stored);
    if (!bytes) return { row, disposition: 'recovery-blocked', reason: 'backup-missing' };
    // Condition 10: verify expected household and pin before anything is
    // installed; backups that cannot supply verified restore bytes block.
    const restored = docState(bytes);
    if (!restored || restored.revision !== pin.revision || restored.digest !== pin.digest) {
      return { row, disposition: 'recovery-blocked', reason: 'backup-unverifiable' };
    }
    try { C.restore(bytes, derive(pin)); } catch {
      return { row, disposition: 'recovery-blocked', reason: 'backup-unverifiable' };
    }
    try { await terminalGate(restored); }
    catch { return { row, disposition: 'recovery-blocked', reason: 'terminal-history-unavailable' }; }
    // Preserve divergent evidence BEFORE overwriting (F-D: a failed
    // quarantine blocks the overwrite it guards).
    if (headBytes) {
      try {
        await quarantine.put('divergent-head-r' + stagingRevision(headBytes),
          Buffer.from(headBytes));
      } catch {
        return { row, disposition: 'recovery-blocked', reason: 'quarantine-failed' };
      }
    }
    if (journalRaw) {
      try {
        await quarantine.put('divergent-journal', Buffer.from(journalRaw));
      } catch {
        return { row, disposition: 'recovery-blocked', reason: 'quarantine-failed' };
      }
    }
    // Fresh pin recheck immediately before installing.
    const fresh = await readPinState();
    if (fresh.kind !== 'ok' || fresh.pin.revision !== pin.revision
      || fresh.pin.digest !== pin.digest) return RESTART;
    let installFailed = false;
    try {
      await documentStore.writeTemp(Buffer.from(bytes));
      await documentStore.commitTemp();
    } catch { installFailed = true; }
    // Verify readback before reporting restored.
    const back = await readDocState();
    if (back.kind !== 'ok' || !back.bytes || !back.bytes.equals(bytes)) {
      return {
        row, disposition: 'recovery-blocked',
        reason: installFailed ? 'restore-install-failed' : 'restore-readback-failed',
      };
    }
    let cleared = true;
    if (journalRaw) {
      try { await journalStore.clear(); } catch { cleared = false; }
    }
    const report = { row, disposition: 'restored-pinned', revision: pin.revision, digest: pin.digest };
    if (!cleared) report.detail = 'journal-clear-failed';
    return report;
  }

  // B3: a destructive restore row (R6/R7/R8) may be selected only on a
  // fully validated manifest. An unavailable or malformed manifest
  // leaves every byte in place — no overwrite, no journal clear, no
  // quarantine write — and blocks recovery instead.
  async function restoreGated(row, pin, headBytes, journalRaw, M) {
    if (M.kind !== 'ok') {
      return { row: 'R1', disposition: 'recovery-blocked', reason: 'manifest-unavailable' };
    }
    return restorePinned(row, pin, headBytes, journalRaw);
  }

  async function evaluateOnce() {
    const P = await readPinState();
    const H = await readDocState();
    const J = await readJournalState();
    const M = await readManifestState();
    try { await terminalGate(H.kind === 'ok' && H.bytes ? docState(H.bytes) : null); }
    catch { return { row: 'R1', disposition: 'recovery-blocked', reason: 'terminal-history-unavailable' }; }
    if (P.kind === 'error') {
      return { row: 'R1', disposition: 'recovery-blocked', reason: 'pin-unreadable' };
    }
    if (P.kind === 'absent') {
      if (H.kind === 'error' || J.kind === 'error' || M.kind === 'error') {
        return { row: 'R1', disposition: 'recovery-blocked', reason: 'state-unreadable' };
      }
      if (!H.bytes && !J.raw && M.entries.length === 0) {
        return { row: 'R0', disposition: 'unbootstrapped' };
      }
      return { row: 'R1', disposition: 'recovery-blocked', reason: 'pin-absent-with-traces' };
    }
    const pin = P.pin;
    if (H.kind === 'error') {
      return { row: 'R1', disposition: 'recovery-blocked', reason: 'document-unreadable' };
    }
    if (J.kind === 'error') {
      return { row: 'R1', disposition: 'recovery-blocked', reason: 'journal-unreadable' };
    }
    if (!H.bytes) return restoreGated('R8', pin, null, J.raw, M);
    const head = docState(H.bytes);
    if (head && head.revision === pin.revision && head.digest === pin.digest) {
      if (!J.raw) return { row: 'R2', disposition: 'healthy' };
      const parsed = parseJournal(J.raw);
      if (parsed.kind === 'valid' && r3Proof(head, parsed.journal)) {
        const receipt = receiptForOperation(head, parsed.journal.operationId);
        let cleared = true;
        try { await journalStore.clear(); } catch { cleared = false; }
        const report = { row: 'R3', disposition: 'committed-recovered', receipt };
        if (!cleared) report.detail = 'journal-clear-failed';
        return report;
      }
      return r4Disposition(head, pin, J.raw, parsed);
    }
    if (head && head.revision > pin.revision) {
      if (head.revision === pin.revision + 1) {
        const parsed = parseJournal(J.raw || Buffer.alloc(0));
        if (J.raw && parsed.kind === 'valid'
          && r5Proof(head, pin, parsed.journal)
          && C.verifyReadback(H.bytes, {
            householdId, operationId: parsed.journal.operationId,
            nextPin: derive({ revision: head.revision, digest: head.digest }),
          })) {
          return promote(head, pin, parsed.journal, H.bytes, M);
        }
      }
      return restoreGated('R6', pin, H.bytes, J.raw, M);
    }
    // Behind the pin, a same-revision fork, or unverifiable bytes.
    return restoreGated('R7', pin, H.bytes, J.raw, M);
  }

  async function reconcileLocked() {
    for (let pass = 0; pass < 4; pass++) {
      const report = await evaluateOnce();
      if (report !== RESTART) return report;
    }
    return { row: 'R1', disposition: 'recovery-blocked', reason: 'evaluation-unstable' };
  }

  // --- Commit pipeline C0-C10 ---------------------------------------------
  async function executeCandidate(pin, headBytes, head, req, allowRecovery, witness) {
    // C1: re-verify the qualified head immediately before candidate
    // creation (guards adapter races between the pre-pass and here).
    const P2 = await readPinState();
    const H2 = await readDocState();
    if (P2.kind !== 'ok' || P2.pin.revision !== pin.revision
      || P2.pin.digest !== pin.digest || H2.kind !== 'ok' || !H2.bytes
      || !H2.bytes.equals(headBytes)) {
      return allowRecovery ? unavailable('store-divergent')
        : { status: 'rejected', reason: 'recovery-required' };
    }
    // Every terminal await is BEFORE final expiry/candidate validation and
    // the synchronous freshness witness; this lock stays held through pinning.
    try {
      const terminal = await terminalGate(head);
      if (terminal?.history.records.some(r => r.operationId === req.preview.operationId)) return { status: 'rejected', reason: 'operation-sealed' };
    } catch { return unavailable('terminal-history-unavailable'); }
    // C2: candidate through the Phase 1 contract.
    let result;
    try {
      result = C.confirmCandidate(Buffer.from(headBytes), {
        householdId, actorId: req.actorId, preview: req.preview,
        confirmationDigest: req.confirmationDigest, now: tick(),
      });
    } catch {
      const recorded = head.operations.some(o => o.operationId === req.preview.operationId);
      return recorded ? { status: 'conflict' } : unavailable('confirm-failed');
    }
    if (result.status === 'already-recorded') {
      return receiptForOperation(head, req.preview.operationId);
    }
    if (result.status === 'rejected') {
      return result.reason === 'preview-expired'
        ? { status: 'rejected', reason: 'preview-expired' }
        : { status: 'conflict' };
    }
    const candidateBytes = Buffer.from(result.document);
    const candidate = docState(candidateBytes);
    if (!candidate) return unavailable('confirm-failed');
    const appended = candidate.operations[candidate.operations.length - 1];
    // The ONE actual candidate recordedAt is bound consistently into the
    // journal and (by the contract) the appended operation; it sits
    // inside the frozen preview's validity window by construction of
    // confirmCandidate, and need not equal preview.issuedAt.
    const recordedAt = appended.recordedAt;
    // C3: journal — carries the COMPLETE frozen preview (F-A).
    const journal = {
      version: 1, householdId, operationId: req.preview.operationId,
      actorId: req.actorId, baseRevision: pin.revision, baseDigest: pin.digest,
      baseBytes: Buffer.from(headBytes).toString('base64'),
      preview: deepCopy(req.preview), requestDigest: req.previewDigest,
      resultingRevision: candidate.revision, resultingDigest: candidate.digest,
      recordedAt,
    };
    // Write admission (fenced commits only): the paired freshness witness
    // is invoked synchronously at the last pre-write moment — after every
    // prewrite await above and the synchronous candidate/journal
    // construction, immediately before the journal write, with no
    // intervening await. Only its literal `true` admits the write; a
    // refusal, a throw, or any other value (a thenable is never awaited
    // or assimilated) is a definite no-write refusal with zero durable
    // mutations. It runs at most once per new candidate, under the same
    // single lock, and a successful admission is never re-checked while
    // the write completes.
    if (witness) {
      let admitted = false;
      try { admitted = witness() === true; } catch { admitted = false; }
      if (!admitted) return { status: 'rejected', reason: 'admission-refused' };
    }
    try {
      await journalStore.write(journal);
    } catch {
      // Correction 5: a journal-write throw can mean a durable write
      // whose acknowledgement was lost. Uncertainty is preserved; the
      // actual state is resolved by the reconciler, never assumed.
      return unknown('journal-write-ambiguous');
    }
    // From here the journal is resident: the writer never deletes or
    // rewrites it on its own error paths (uniform post-journal rule).
    // C4: temp.
    try {
      await documentStore.writeTemp(Buffer.from(candidateBytes));
    } catch { return unknown('temp-write-failed'); }
    // C5: atomic rename.
    try {
      await documentStore.commitTemp();
    } catch { return unknown('rename-ambiguous'); }
    // C6: readback — never proceed to backup/pin on a failed readback.
    let backRaw;
    try { backRaw = await documentStore.read(); } catch { return unknown('readback-failed'); }
    const back = backRaw === null ? null : copyBytes(backRaw);
    if (!back || !C.verifyReadback(back, {
      householdId, operationId: req.preview.operationId, nextPin: result.nextPin,
    })) {
      return unknown('readback-failed');
    }
    // C7: backup with a field-by-field verified durable ack (F2/F3).
    let ack;
    try {
      ack = await backupStore.put(candidate.revision, candidate.digest,
        Buffer.from(candidateBytes));
    } catch { return unknown('backup-ambiguous'); }
    if (!validAck(ack, candidate.revision, candidate.digest)) {
      return unknown('backup-ambiguous');
    }
    // C8: pin CAS against the FROZEN candidate base (correction 1): the
    // fresh pin is compared to the frozen base; it is never substituted
    // as the expected value of the CAS.
    const fresh = await readPinState();
    if (fresh.kind !== 'ok') return unknown('pin-advance-failed');
    if (fresh.pin.revision !== pin.revision || fresh.pin.digest !== pin.digest) {
      if (allowRecovery) await reconcileLocked();
      return unknown('pin-moved');
    }
    let advanced;
    try {
      advanced = await pinStore.advance(
        { revision: pin.revision, digest: pin.digest },
        { revision: candidate.revision, digest: candidate.digest, timestamp: tick() });
    } catch { return unknown('pin-advance-failed'); }
    if (advanced === false) {
      if (allowRecovery) await reconcileLocked();
      return unknown('pin-moved');
    }
    if (advanced !== true) {
      // B1: CAS success is the literal value true only. A malformed or
      // lost ack never fabricates a commit: the journal stays resident
      // and the reconciler (or an identical retry) resolves the actual
      // pin state from observation.
      return unknown('pin-advance-failed');
    }
    // C9: journal clear — non-fatal; a leftover journal is shape W5 and
    // belongs to the reconciler (R3). The operation is committed exactly
    // when the pin covers its revision.
    try { await journalStore.clear(); } catch { /* W5 */ }
    // C10: receipt.
    return {
      status: 'committed', operationId: req.preview.operationId, actorId: req.actorId,
      revision: candidate.revision, digest: candidate.digest,
    };
  }

  async function commitLocked(input, allowRecovery, witness) {
    if (!isRecord(input)) return unavailable('invalid-request');
    const { actorId, preview, confirmationDigest } = input;
    if (typeof actorId !== 'string' || !ACTOR_RE.test(actorId)
      || !isRecord(preview) || typeof preview.operationId !== 'string'
      || !OPERATION_RE.test(preview.operationId) || !isHash(confirmationDigest)) {
      return unavailable('invalid-request');
    }
    let previewDigest;
    try { previewDigest = C.digest(preview); } catch { return unavailable('invalid-request'); }
    const operationId = preview.operationId;

    for (let pass = 0; pass < 2; pass++) {
      const P = await readPinState();
      if (P.kind === 'error') return unavailable('pin-unavailable');
      if (P.kind === 'absent') {
        const H = await readDocState();
        const J = await readJournalState();
        const M = await readManifestState();
        const empty = H.kind === 'ok' && !H.bytes && J.kind === 'ok' && !J.raw
          && M.kind === 'ok' && M.entries.length === 0;
        if (!allowRecovery && !empty) return { status: 'rejected', reason: 'recovery-required' };
        return unavailable(empty ? 'unbootstrapped' : 'recovery-blocked');
      }
      const pin = P.pin;
      const H = await readDocState();
      if (H.kind === 'error') return unavailable('document-unavailable');
      const head = H.bytes ? docState(H.bytes) : null;
      const qualified = !!head && head.revision === pin.revision
        && head.digest === pin.digest;
      try {
        const terminal = await terminalGate(head);
        if (terminal?.history.records.some(r => r.operationId === operationId)) return { status: 'rejected', reason: 'operation-sealed' };
      } catch { return unavailable('terminal-history-unavailable'); }
      // C0(a): the C1 fast path — pin + validated document prove
      // commitment; the journal is irrelevant. F-E: altered input on a
      // committed operation is a conflict, taking precedence.
      let recordedResult = null;
      if (qualified) {
        const recorded = head.operations.find(o => o.operationId === operationId);
        if (recorded) {
          if (recorded.actorId === actorId && recorded.requestDigest === previewDigest
            && previewDigest === confirmationDigest) {
            recordedResult = receiptForOperation(head, operationId);
          } else recordedResult = { status: 'conflict' };
        }
      }
      // The new capability needs no journal read/cleanup to prove a pinned
      // receipt. Ordinary commit preserves its incumbent journal-read order.
      if (!allowRecovery && recordedResult) return recordedResult;
      const J = await readJournalState();
      if (J.kind === 'error') return unavailable('journal-unavailable');
      const parsed = J.raw ? parseJournal(J.raw) : null;
      if (recordedResult) return recordedResult;
      // C0(b): a digest mismatch on a known operation id is a conflict
      // (altered input carrying an old digest).
      if (previewDigest !== confirmationDigest) {
        const knownInHead = !!head
          && head.operations.some(o => o.operationId === operationId);
        const knownInJournal = !!parsed && parsed.kind === 'valid'
          && parsed.journal.operationId === operationId;
        return knownInHead || knownInJournal
          ? { status: 'conflict' } : unavailable('invalid-request');
      }
      // Correction 4 + B2: before any pre-pass mutation, a reused id is
      // compared against a valid resident journal too — actor binding as
      // well as the request digest. A retry under a different actor, or
      // with a changed preview (old digest or a new self-consistent
      // one), conflicts without modifying storage: the pre-pass must
      // never clear or promote another actor's pending operation.
      if (parsed && parsed.kind === 'valid'
        && parsed.journal.operationId === operationId
        && (parsed.journal.actorId !== actorId
          || parsed.journal.requestDigest !== previewDigest)) {
        return { status: 'conflict' };
      }
      // C0(c): resolve any resident journal or divergence first.
      if (!J.raw && qualified) {
        return executeCandidate(pin, H.bytes, head, {
          actorId, preview, confirmationDigest, previewDigest,
        }, allowRecovery, witness);
      }
      if (!allowRecovery) return { status: 'rejected', reason: 'recovery-required' };
      if (pass === 1) return unavailable('store-divergent');
      const report = await reconcileLocked();
      if (report.disposition === 'recovery-blocked') return unavailable('recovery-blocked');
      if (report.disposition === 'promotion-pending') return unavailable('promotion-pending');
      if (report.disposition === 'unbootstrapped') return unavailable('unbootstrapped');
      // Loop: re-evaluate the fast paths against the resolved state.
    }
    return unavailable('store-divergent');
  }

  // --- Public surface -------------------------------------------------------
  async function bootstrap() {
    return lock.withLock(async () => {
      try {
        const terminal = await terminalGate(null);
        if (terminal?.history.records.length) return unavailable('terminal-history-has-traces');
        const P = await readPinState();
        if (P.kind === 'error') return unavailable('pin-unavailable');
        const H = await readDocState();
        if (H.kind === 'error') return unavailable('document-unavailable');
        const J = await readJournalState();
        if (J.kind === 'error') return unavailable('journal-unavailable');
        const M = await readManifestState();
        if (M.kind === 'error') return unavailable('backup-unavailable');
        // Condition 8: proven absence of ALL durable traces, staged
        // temp/bootstrap artifacts included. Any trace refuses genesis.
        // B1: the staged read is validated as bytes-or-null before it
        // can prove anything — only the explicit absence representation
        // (null) proves no staged artifact; bytes prove a trace; any
        // other value is malformed and refuses genesis with no writes.
        let stagedRaw;
        try { stagedRaw = await documentStore.readStaged(); } catch {
          return unavailable('document-unavailable');
        }
        let staged = null;
        if (stagedRaw !== null) {
          staged = copyBytes(stagedRaw);
          if (!staged) return unavailable('document-unavailable');
        }
        const traces = P.kind === 'ok' || !!H.bytes || !!J.raw
          || M.entries.length > 0 || !!staged;
        if (traces) return { status: 'rejected', reason: 'already-bootstrapped' };
        const genesis = C.adopt({ householdId });
        const genesisState = docState(genesis);
        let ack;
        try {
          ack = await backupStore.put(0, genesisState.digest, Buffer.from(genesis));
        } catch { return unavailable('backup-ambiguous'); }
        if (!validAck(ack, 0, genesisState.digest)) return unavailable('backup-ambiguous');
        try {
          await documentStore.writeTemp(Buffer.from(genesis));
          await documentStore.commitTemp();
        } catch { return unavailable('document-write-failed'); }
        const back = await readDocState();
        if (back.kind !== 'ok' || !back.bytes || !back.bytes.equals(genesis)) {
          return unavailable('readback-failed');
        }
        let advanced;
        try {
          advanced = await pinStore.advance(null, {
            revision: 0, digest: genesisState.digest, timestamp: tick(),
          });
        } catch { return unavailable('pin-advance-failed'); }
        if (advanced === false) return unavailable('pin-moved');
        if (advanced !== true) return unavailable('pin-advance-failed');
        return { status: 'bootstrapped', revision: 0, digest: genesisState.digest };
      } catch {
        return unavailable('internal-error');
      }
    });
  }

  async function prepare(input) {
    if (!isRecord(input) || typeof input.actorId !== 'string' || !ACTOR_RE.test(input.actorId)
      || typeof input.operationId !== 'string' || !OPERATION_RE.test(input.operationId)
      || !isRecord(input.command)) {
      throw new Error('settlement-store: invalid prepare request');
    }
    return lock.withLock(async () => {
      const P = await readPinState();
      if (P.kind === 'error') return unavailable('pin-unavailable');
      if (P.kind === 'absent') return unavailable('unbootstrapped');
      const H = await readDocState();
      if (H.kind !== 'ok' || !H.bytes) return unavailable('document-unavailable');
      const J = await readJournalState();
      if (J.kind !== 'ok') return unavailable('journal-unavailable');
      if (J.raw) return unavailable('journal-resident');
      const head = docState(H.bytes);
      if (!head || head.revision !== P.pin.revision || head.digest !== P.pin.digest) {
        return unavailable('store-divergent');
      }
      let terminal;
      try { terminal = await terminalGate(head); } catch { return unavailable('terminal-history-unavailable'); }
      if (terminal?.history.records.some(r => r.operationId === input.operationId)) return unavailable('operation-sealed');
      return C.prepare(Buffer.from(H.bytes), {
        householdId, actorId: input.actorId, operationId: input.operationId,
        command: input.command, now: tick(),
      });
    });
  }

  async function commitWithPolicy(input, allowRecovery, witness) {
    // B2: take a validated, owned snapshot of the complete request at
    // public entry, BEFORE waiting on the lock. The caller retains (and
    // may mutate) the original object across our awaits; the snapshot's
    // identity is the only one the pipeline, journal, and receipt use.
    let snapshot;
    try {
      snapshot = deepCopy(input);
    } catch {
      return unavailable('invalid-request');
    }
    return lock.withLock(async () => {
      try {
        return await commitLocked(snapshot, allowRecovery, witness);
      } catch {
        return unavailable('internal-error');
      }
    });
  }

  // Recovery policy is selected only by these capabilities, never by caller
  // input. Neither capability calls the other or nests the injected lock.
  async function commit(input) { return commitWithPolicy(input, true); }
  async function commitWithoutRecovery(input) { return commitWithPolicy(input, false); }

  // commitAdmitted is the trusted write-admission capability: the same
  // single-lock, no-recovery pipeline as commitWithoutRecovery, fenced by
  // a synchronous freshness witness paired with the caller's acquisition.
  // The witness is consulted only at the pre-write moment of a genuinely
  // new candidate (see executeCandidate): original pinned receipts,
  // conflicts, recovery-required and preview-expired outcomes all precede
  // it and never invoke it. A non-function witness is itself a definite
  // refusal — nothing is snapshotted, locked or written.
  async function commitAdmitted(input, witness) {
    if (typeof witness !== 'function') return { status: 'rejected', reason: 'admission-refused' };
    return commitWithPolicy(input, false, witness);
  }

  // --- Settled-uncertainty inspection (P2) --------------------------------
  async function inspectAttemptLocked(req) {
    // A structurally malformed proof proves nothing and is never ready:
    // the complete frozen preview shape (schema, household, actor,
    // operation, expected base, TTL window, command) is validated before
    // any adapter read can be interpreted through it.
    if (!isRecord(req) || typeof req.actorId !== 'string' || !ACTOR_RE.test(req.actorId)
      || !isHash(req.confirmationDigest) || !isRecord(req.preview)) {
      return { disposition: 'unresolved', ready: false };
    }
    const preview = req.preview;
    const previewKeys = Object.keys(preview).sort();
    const wantedPreviewKeys = ['schema', 'householdId', 'actorId', 'operationId',
      'expectedRevision', 'expectedDocumentDigest', 'issuedAt', 'expiresAt', 'command'].sort();
    if (previewKeys.length !== wantedPreviewKeys.length
      || previewKeys.some((k, i) => k !== wantedPreviewKeys[i])) {
      return { disposition: 'unresolved', ready: false };
    }
    if (preview.schema !== C.PREVIEW_SCHEMA || preview.householdId !== householdId
      || typeof preview.actorId !== 'string' || !ACTOR_RE.test(preview.actorId)
      || typeof preview.operationId !== 'string' || !OPERATION_RE.test(preview.operationId)
      || !Number.isSafeInteger(preview.expectedRevision) || preview.expectedRevision < 0
      || !isHash(preview.expectedDocumentDigest)
      || !isTick(preview.issuedAt) || preview.expiresAt !== preview.issuedAt + C.TTL_MS
      || !isRecord(preview.command)) {
      return { disposition: 'unresolved', ready: false };
    }
    let previewDigest;
    try { previewDigest = C.digest(preview); } catch {
      return { disposition: 'unresolved', ready: false };
    }
    const P = await readPinState();
    const H = await readDocState();
    const J = await readJournalState();
    const head = P.kind === 'ok' && H.kind === 'ok' && H.bytes ? docState(H.bytes) : null;
    const qualified = !!head && P.kind === 'ok'
      && head.revision === P.pin.revision && head.digest === P.pin.digest;
    // Readiness is a property of the store alone, reported separately from
    // the disposition: a qualified pinned head plus a successfully read
    // absent journal. A present or unreadable journal is not ready, even
    // when the disposition below is known.
    const ready = qualified && J.kind === 'ok' && !J.raw;
    if (!qualified) return { disposition: 'unresolved', ready: false };
    try { await terminalGate(head); }
    catch { return { disposition: 'unresolved', ready: false }; }
    // Binding validation: the supplied actor must be the preview's actor
    // and the supplied confirmation digest must be the preview's digest.
    if (req.actorId !== preview.actorId || req.confirmationDigest !== previewDigest) {
      return { disposition: 'unresolved', ready };
    }
    const recorded = head.operations.find(o => o.operationId === preview.operationId);
    if (recorded) {
      // Committed only on an exact ledger match: operation, actor, request
      // digest, the recorded revision the preview's base implies, and the
      // preview's expected digest over the validated immutable prefix. A
      // mismatched same-ID record is unresolved, never not-committed.
      const committed = recorded.actorId === req.actorId
        && recorded.requestDigest === previewDigest
        && recorded.revision === preview.expectedRevision + 1
        && preview.expectedDocumentDigest === prefixDigest(head, preview.expectedRevision);
      return { disposition: committed ? 'committed' : 'unresolved', ready };
    }
    // Not committed only at the preview's exact pinned base: an advanced
    // head without the matching committed attempt proves nothing.
    const notCommitted = head.revision === preview.expectedRevision
      && head.digest === preview.expectedDocumentDigest;
    return { disposition: notCommitted ? 'not-committed' : 'unresolved', ready };
  }

  async function inspectAttempt(input) {
    // Snapshot the complete request at public entry, BEFORE waiting on
    // the shared lock, exactly as the commit capabilities do: the caller
    // retains (and may mutate) the original object across our awaits.
    let snapshotInput;
    try {
      snapshotInput = deepCopy(input);
    } catch {
      return { disposition: 'unresolved', ready: false };
    }
    return lock.withLock(async () => {
      try {
        return await inspectAttemptLocked(snapshotInput);
      } catch {
        return { disposition: 'unresolved', ready: false };
      }
    });
  }

  async function outcomeLocked(input) {
    // Read-only (F4): no writes, no repair, and the journal never
    // overrides what the pin and the validated document prove.
    if (!isRecord(input) || typeof input.actorId !== 'string' || !ACTOR_RE.test(input.actorId)
      || typeof input.operationId !== 'string' || !OPERATION_RE.test(input.operationId)) {
      return { status: 'unknown' };
    }
    try {
      const P = await readPinState();
      if (P.kind !== 'ok') return { status: 'unknown' };
      const H = await readDocState();
      if (H.kind !== 'ok' || !H.bytes) return { status: 'unknown' };
      const head = docState(H.bytes);
      if (!head || head.revision !== P.pin.revision || head.digest !== P.pin.digest) {
        return { status: 'unknown' };
      }
      await terminalGate(head);
      const recorded = head.operations.find(o => o.operationId === input.operationId);
      if (!recorded || recorded.actorId !== input.actorId) return { status: 'unknown' };
      return {
        status: 'committed', operationId: input.operationId,
        revision: recorded.revision, digest: prefixDigest(head, recorded.revision),
      };
    } catch { return { status: 'unknown' }; }
  }

  async function outcome(input) {
    return exclusionEnabled ? lock.withLock(() => outcomeLocked(input)) : outcomeLocked(input);
  }

  // B4 re-login recovery read (opt-in capability; exposed only when the
  // composition supplied recoveryRead === true on a gated store). Judges ONE
  // named operation from the validated durable state under the shared lock
  // and returns exactly one of:
  //   - the private qualified bundle for a committed operation — the
  //     receiptForOperation shape {status, operationId, actorId, revision,
  //     digest} PLUS the recorded requestDigest as a private sixth field
  //     (fail-closed unknown when that digest is missing or malformed).
  //     The recorded actor is read from the validated durable record
  //     itself; it is server-internal and never a disclosure shape.
  //   - the private qualified bundle for a not-applied operation —
  //     {status, operationId, generation} PLUS the terminal certificate's
  //     recorded confirmationDigest as a private fourth field (fail-closed
  //     unknown when that digest is missing or malformed), only on an
  //     exactly matching supplied generation.
  //   - {status:'unknown', operationId} for every other state.
  // There is deliberately NO actor input: the request names selectors only
  // ({operationId} / {operationId, generation}); any other key refuses.
  // The two proof rules stay distinct, as shipped: the positive rule is
  // outcomeLocked's (pin/document agreement plus the terminal gate, whose
  // coexistence refusal no winner survives; a present journal does not
  // defeat a recorded commit), while the negative rule requires
  // terminalState readiness in full — pin/document agreement AND a
  // successfully read ABSENT journal — over the qualified terminal history.
  // Read-only: no seal, append, reconcile, retire or cleanup path is
  // reachable from here.
  async function recoveryReadLocked(input) {
    const operationId = isRecord(input) ? input.operationId : undefined;
    if (!isRecord(input) || typeof operationId !== 'string' || !OPERATION_RE.test(operationId)
      || Object.keys(input).some(k => k !== 'operationId' && k !== 'generation')
      || (input.generation !== undefined && typeof input.generation !== 'string')) {
      return { status: 'unknown', operationId };
    }
    try {
      const P = await readPinState();
      if (P.kind !== 'ok') return { status: 'unknown', operationId };
      const H = await readDocState();
      if (H.kind !== 'ok' || !H.bytes) return { status: 'unknown', operationId };
      const head = docState(H.bytes);
      if (!head || head.revision !== P.pin.revision || head.digest !== P.pin.digest) {
        return { status: 'unknown', operationId };
      }
      const recorded = head.operations.find(o => o.operationId === operationId);
      if (recorded) {
        await terminalGate(head);
        // The private bundle additionally binds the recorded requestDigest
        // — the same durable record r3Proof cross-validates against the
        // journal. Missing or malformed fails closed at this boundary.
        if (!isHash(recorded.requestDigest)) return { status: 'unknown', operationId };
        return { ...receiptForOperation(head, operationId), requestDigest: recorded.requestDigest };
      }
      const J = await readJournalState();
      if (J.kind !== 'ok' || J.raw) return { status: 'unknown', operationId };
      const terminal = await terminalGate(head);
      const cert = terminal?.history.records.find(r => r.operationId === operationId);
      if (!cert || input.generation === undefined || cert.generation !== input.generation) {
        return { status: 'unknown', operationId };
      }
      // The private bundle additionally binds the certificate's recorded
      // confirmationDigest — the durable digest sealNegative validated as
      // C.digest(preview). Missing or malformed fails closed at this
      // boundary.
      if (!isHash(cert.confirmationDigest)) return { status: 'unknown', operationId };
      return { status: 'not-applied', operationId, generation: cert.generation,
        confirmationDigest: cert.confirmationDigest };
    } catch { return { status: 'unknown', operationId }; }
  }

  async function recoveryRead(input) {
    // Snapshot the complete request at public entry, BEFORE waiting on the
    // shared lock, exactly as inspectAttempt does: the caller retains (and
    // may mutate) the original object across our awaits.
    let snapshotInput;
    try {
      snapshotInput = deepCopy(input);
    } catch {
      return { status: 'unknown', operationId: undefined };
    }
    return lock.withLock(() => recoveryReadLocked(snapshotInput));
  }
  // This store-owned seal proof is distinct from P2's unchanged exact-base proof.
  async function terminalState() {
    const P = await readPinState(), H = await readDocState(), J = await readJournalState();
    const head = P.kind === 'ok' && H.kind === 'ok' && H.bytes ? docState(H.bytes) : null;
    if (!head || head.revision !== P.pin.revision || head.digest !== P.pin.digest || J.kind !== 'ok' || J.raw)
      throw new Error('terminal ledger not ready');
    return { head, terminal: await terminalGate(head) };
  }
  function validateSealRequest(req, head) {
    if (!isRecord(req) || Object.keys(req).sort().join(',') !==
      ['actorId','preview','confirmationDigest','generation','kind','reason'].sort().join(',')) return false;
    const p = req.preview;
    if (!isRecord(p) || p.householdId !== householdId || p.actorId !== req.actorId
      || !ACTOR_RE.test(req.actorId) || !OPERATION_RE.test(p.operationId)
      || !Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0
      || p.expectedRevision > head.revision || p.expectedDocumentDigest !== prefixDigest(head, p.expectedRevision)
      || req.confirmationDigest !== C.digest(p) || req.kind !== (p.command?.kind === 'retract' ? 'withdrawal' : p.command?.kind)) return false;
    // Validate the WHOLE preview/command against its immutable prefix at its
    // ORIGINAL issued tick. Expired previews are valid negative-seal subjects;
    // never use expiry-sensitive confirmCandidate here.
    const body = { schema: C.SCHEMA, householdId, revision: p.expectedRevision,
      operations: head.operations.slice(0, p.expectedRevision) };
    const oldBytes = Buffer.from(JSON.stringify({ ...body, digest: C.digest(body) }));
    const checked = C.prepare(oldBytes, { householdId, actorId: req.actorId,
      operationId: p.operationId, command: p.command, now: p.issuedAt });
    return require('node:util').isDeepStrictEqual(checked.preview, p)
      && checked.confirmationDigest === req.confirmationDigest;
  }
  async function sealNegative(input) {
    let req; try { req = TC.own(input); } catch { return { status: 'unknown' }; }
    const operationId = req?.preview?.operationId;
    return lock.withLock(async () => {
      try {
        const { head, terminal } = await terminalState();
        if (!validateSealRequest(req, head) || head.operations.some(o => o.operationId === operationId)) return { status: 'unknown', operationId };
        const p = req.preview;
        const certificate = TC.own({ schema: TC.TERMINAL_CERTIFICATE_SCHEMA, householdId,
          ledgerNamespace: domain.ledgerNamespace, operationId, actorId: req.actorId,
          kind: req.kind, generation: req.generation, reason: req.reason,
          expectedRevision: p.expectedRevision, expectedDocumentDigest: p.expectedDocumentDigest,
          confirmationDigest: req.confirmationDigest, decidedAt: tick() });
        if (!TC.isCertificate(certificate)) return { status: 'unknown', operationId };
        const existing = terminal.history.records.find(r => r.operationId === operationId);
        if (existing) return TC.sameDecision(existing, certificate)
          ? { status: 'certified', operationId, certificate: existing } : { status: 'unknown', operationId };
        const result = await terminalHistory.compareAndAppend(TC.own({ expectedCheckpoint: terminal.checkpoint, certificate }));
        // No retry/repair. Unknown acknowledgements may have landed.
        if (result !== true) return { status: 'unknown', operationId };
        const after = await terminalGate(head);
        if (after.history.revision !== terminal.history.revision + 1
          || C.digest(after.history.records.slice(0, -1)) !== C.digest(terminal.history.records)
          || !require('node:util').isDeepStrictEqual(after.history.records.at(-1), certificate)) return { status: 'unknown', operationId };
        return { status: 'certified', operationId, certificate };
      } catch { return { status: 'unknown', operationId }; }
    });
  }
  async function lookupCertificate(input) {
    let req; try { req = TC.own(input); } catch { return { status: 'unknown' }; }
    const operationId = req?.operationId;
    if (!isRecord(req) || !OPERATION_RE.test(operationId) || !ACTOR_RE.test(req.actorId)
      || Object.keys(req).some(k => !['actorId','operationId','generation'].includes(k))) return { status: 'unknown', operationId };
    return lock.withLock(async () => {
      try {
        const { terminal } = await terminalState();
        const c = terminal.history.records.find(r => r.operationId === operationId);
        if (!c || c.actorId !== req.actorId || (req.generation !== undefined && c.generation !== req.generation)) return { status: 'unknown', operationId };
        return { status: 'not-applied', operationId, generation: c.generation };
      } catch { return { status: 'unknown', operationId }; }
    });
  }
  async function reconcile() {
    return lock.withLock(async () => {
      try {
        return await reconcileLocked();
      } catch {
        return { row: 'R1', disposition: 'recovery-blocked', reason: 'internal-error' };
      }
    });
  }

  return { bootstrap, prepare, commit, commitWithoutRecovery, commitAdmitted, outcome, reconcile, inspectAttempt,
    ...(recoveryEnabled ? { recoveryRead } : {}),
    ...(exclusionEnabled ? { terminalExclusion: Object.freeze({ householdId, ledgerNamespace: domain.ledgerNamespace, sealNegative, lookupCertificate }) } : {}) };
}

module.exports = { createSettlementEvidenceStore };
