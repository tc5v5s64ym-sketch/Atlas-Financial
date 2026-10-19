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

const C = require('./planned-obligation-settlement-contract');

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
    return { kind: 'ok', entries: raw };
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
    if (!ok) return RESTART;
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

  async function evaluateOnce() {
    const P = await readPinState();
    const H = await readDocState();
    const J = await readJournalState();
    const M = await readManifestState();
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
    if (!H.bytes) return restorePinned('R8', pin, null, J.raw);
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
      return restorePinned('R6', pin, H.bytes, J.raw);
    }
    // Behind the pin, a same-revision fork, or unverifiable bytes.
    return restorePinned('R7', pin, H.bytes, J.raw);
  }

  async function reconcileLocked() {
    for (let pass = 0; pass < 4; pass++) {
      const report = await evaluateOnce();
      if (report !== RESTART) return report;
    }
    return { row: 'R1', disposition: 'recovery-blocked', reason: 'evaluation-unstable' };
  }

  // --- Commit pipeline C0-C10 ---------------------------------------------
  async function executeCandidate(pin, headBytes, head, req) {
    // C1: re-verify the qualified head immediately before candidate
    // creation (guards adapter races between the pre-pass and here).
    const P2 = await readPinState();
    const H2 = await readDocState();
    if (P2.kind !== 'ok' || P2.pin.revision !== pin.revision
      || P2.pin.digest !== pin.digest || H2.kind !== 'ok' || !H2.bytes
      || !H2.bytes.equals(headBytes)) {
      return unavailable('store-divergent');
    }
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
      await reconcileLocked();
      return unknown('pin-moved');
    }
    let advanced;
    try {
      advanced = await pinStore.advance(
        { revision: pin.revision, digest: pin.digest },
        { revision: candidate.revision, digest: candidate.digest, timestamp: tick() });
    } catch { return unknown('pin-advance-failed'); }
    if (!advanced) {
      await reconcileLocked();
      return unknown('pin-moved');
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

  async function commitLocked(input) {
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
        return unavailable(empty ? 'unbootstrapped' : 'recovery-blocked');
      }
      const pin = P.pin;
      const H = await readDocState();
      if (H.kind === 'error') return unavailable('document-unavailable');
      const J = await readJournalState();
      if (J.kind === 'error') return unavailable('journal-unavailable');
      const head = H.bytes ? docState(H.bytes) : null;
      const qualified = !!head && head.revision === pin.revision
        && head.digest === pin.digest;
      const parsed = J.raw ? parseJournal(J.raw) : null;
      // C0(a): the C1 fast path — pin + validated document prove
      // commitment; the journal is irrelevant. F-E: altered input on a
      // committed operation is a conflict, taking precedence.
      if (qualified) {
        const recorded = head.operations.find(o => o.operationId === operationId);
        if (recorded) {
          if (recorded.actorId === actorId && recorded.requestDigest === previewDigest
            && previewDigest === confirmationDigest) {
            return receiptForOperation(head, operationId);
          }
          return { status: 'conflict' };
        }
      }
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
      // Correction 4: before any pre-pass mutation, a reused id is
      // compared against a valid resident journal too. A changed preview
      // — with the old digest or a new self-consistent one — conflicts
      // without modifying storage.
      if (parsed && parsed.kind === 'valid'
        && parsed.journal.operationId === operationId
        && parsed.journal.requestDigest !== previewDigest) {
        return { status: 'conflict' };
      }
      // C0(c): resolve any resident journal or divergence first.
      if (!J.raw && qualified) {
        return executeCandidate(pin, H.bytes, head, {
          actorId, preview, confirmationDigest, previewDigest,
        });
      }
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
        let staged;
        try { staged = await documentStore.readStaged(); } catch {
          return unavailable('document-unavailable');
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
        if (!advanced) return unavailable('pin-moved');
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
      return C.prepare(Buffer.from(H.bytes), {
        householdId, actorId: input.actorId, operationId: input.operationId,
        command: input.command, now: tick(),
      });
    });
  }

  async function commit(input) {
    return lock.withLock(async () => {
      try {
        return await commitLocked(input);
      } catch {
        return unavailable('internal-error');
      }
    });
  }

  async function outcome(input) {
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
      const recorded = head.operations.find(o => o.operationId === input.operationId);
      if (!recorded || recorded.actorId !== input.actorId) return { status: 'unknown' };
      return {
        status: 'committed', operationId: input.operationId,
        revision: recorded.revision, digest: prefixDigest(head, recorded.revision),
      };
    } catch { return { status: 'unknown' }; }
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

  return { bootstrap, prepare, commit, outcome, reconcile };
}

module.exports = { createSettlementEvidenceStore };
