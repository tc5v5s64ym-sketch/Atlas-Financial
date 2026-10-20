'use strict';

// ATLAS-080 FOUNDATION — NOT COMPLETION. Strictly synthetic, unimported
// prepare/confirm/outcome caller boundary. No route, provider client, default
// identity, cookie interpretation, production resolver, identity hashing,
// key/registry, environment access, bootstrap or recovery is supplied here.
//
// Trusted injection contract:
// - householdId binds the injected, unchanged store to ONE household;
// - authorize(ownedContext) returns {householdId, actorId}, with a currently
//   authorized, contract-valid SESSION actor. An expiry-only cookie is not an
//   actor. This module never turns a cookie, subject or caller ID into one;
// - resolveSelection({authority, selection}) uniquely resolves the current
//   posted CAD debit and current plan commitment. Its immutable identity is
//   (householdId, 'lunchmoney', providerAccountId, transactionId). Its txRef
//   MUST remain stable for that tuple across content changes and restarts;
//   neither tx-N nor pc-* is a contract reference. selectionBinding privately
//   binds the selected row; goalBinding binds the current authoritative plan
//   goal, and asOf is the authoritative financial date. Changed binding,
//   evidence, goal or asOf requires a new explicitly prepared operation.
//   Only synthetic deterministic fixture mappings implement this contract yet;
// - store is the existing store bound above; now is the injected clock.
// Context and requests are plain JSON data, snapshotted before any await.
// operationId is a caller correlation token, never authority or a minted ID.
//
// Only the exact private store preview/digest may reach commit. The store
// owns ledger math, conservation, revision/CAS, expiry and durable receipts.
// Each retained operation permits at most one commit invocation, including
// concurrent callers. An unknown result is never retried or recovered here.
// A subsequent explicit outcome/confirm may READ an original durable receipt,
// even after preview expiry, later commits or restart. A restarted controller
// has no uncommitted previews. Household effects are read independently through
// the existing loader; receipt ownership does not hide those effects.
// Fresh provider qualification is an observation, not an atomic provider lock.

const { isDeepStrictEqual } = require('node:util');
const C = require('./planned-obligation-settlement-contract');

const HOUSEHOLD = /^household-[a-f0-9]{32}$/;
const ACTOR = /^session-[a-f0-9]{64}$/;
const OPERATION = /^operation-[a-f0-9]{32}$/;
const TRANSACTION = /^tx-[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,127}$/;
const MAX_PREVIEWS = 200;
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const record = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;
function shape(value, required, optional = []) {
  return record(value) && required.every(k => Object.hasOwn(value, k))
    && Object.keys(value).every(k => required.includes(k) || optional.includes(k));
}
function fail() { throw new Error('settlement-confirmation-unavailable'); }
function date(value) {
  if (!matches(/^\d{4}-\d{2}-\d{2}$/, value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
const privateToken = value => typeof value === 'string' && value.length > 0 && value.length <= 2048;
const unavailable = reason => Object.freeze({ status: 'unavailable', reason });
const rejected = reason => Object.freeze({ status: 'rejected', reason });
const unknown = operationId => Object.freeze({ status: 'unknown', operationId });

// No toJSON, accessors, exotic prototypes or shared foreign references. A
// snapshot is owned AND recursively frozen before another dependency can run.
function snapshot(value, seen = new Set(), depth = 0) {
  if (depth > 20) fail();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { if (value.length > 8192) fail(); return value; }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    return value;
  }
  if ((!record(value) && !Array.isArray(value)) || seen.has(value)) fail();
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string')) fail();
  const result = Array.isArray(value) ? [] : {};
  for (const [key, property] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!property.enumerable || !Object.hasOwn(property, 'value') || key === '__proto__') fail();
    result[key] = snapshot(property.value, seen, depth + 1);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function validSelection(value) {
  return shape(value, ['transaction', 'commitment'])
    && matches(/^selection-[a-f0-9]{32}$/, value.transaction)
    && matches(/^choice-[a-f0-9]{32}$/, value.commitment);
}
function qualified(value, authority) {
  if (!shape(value, ['matchCount', 'identity', 'txRef', 'selectionBinding',
    'goalId', 'goalBinding', 'asOf', 'evidence']) || value.matchCount !== 1) fail();
  const { identity, evidence } = value;
  if (!shape(identity, ['householdId', 'source', 'providerAccountId', 'transactionId'])
    || identity.householdId !== authority.householdId || identity.source !== 'lunchmoney'
    || !privateToken(identity.providerAccountId) || !privateToken(identity.transactionId)
    || !matches(TRANSACTION, value.txRef) || !privateToken(value.selectionBinding)
    || !privateToken(value.goalBinding) || typeof value.goalId !== 'string'
    || !value.goalId.startsWith('commitment:')
    || !matches(IDENTIFIER, value.goalId.slice('commitment:'.length)) || !date(value.asOf)) fail();
  if (!shape(evidence, ['accountId', 'currency', 'direction', 'date', 'cents', 'posted'])
    || !matches(IDENTIFIER, evidence.accountId) || evidence.currency !== 'cad'
    || evidence.direction !== 'debit' || evidence.posted !== true || !positive(evidence.cents)
    || !date(evidence.date) || evidence.date > value.asOf) fail();
  return value;
}
function link(selection, assignedCents) {
  return snapshot({ version: 1, kind: 'link', goalId: selection.goalId,
    txRef: selection.txRef, evidence: selection.evidence,
    evidenceDigest: C.digest(selection.evidence), assignedCents, asOf: selection.asOf });
}
function validPreview(result, authority, operationId, command, now) {
  const p = result?.preview;
  if (!shape(p, ['schema', 'householdId', 'actorId', 'operationId', 'expectedRevision',
    'expectedDocumentDigest', 'issuedAt', 'expiresAt', 'command'])
    || p.schema !== C.PREVIEW_SCHEMA || p.householdId !== authority.householdId
    || p.actorId !== authority.actorId || p.operationId !== operationId
    || !Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0
    || !matches(HASH, p.expectedDocumentDigest) || !positive(p.issuedAt)
    || p.issuedAt > now || p.expiresAt !== p.issuedAt + C.TTL_MS || p.expiresAt <= now
    || !isDeepStrictEqual(p.command, command)
    || result.confirmationDigest !== C.digest(p)) fail();
  return p;
}
function receipt(result, authority, operationId) {
  if (result?.status !== 'committed' || result.operationId !== operationId
    || !positive(result.revision) || !matches(HASH, result.digest)
    || (Object.hasOwn(result, 'actorId') && result.actorId !== authority.actorId)) return null;
  return Object.freeze({ status: 'committed', operationId,
    revision: result.revision, digest: result.digest });
}

function createSettlementEvidenceConfirmation(deps) {
  if (!record(deps)) throw new TypeError('settlement-confirmation: dependencies required');
  const { householdId, authorize, resolveSelection, store, now } = deps;
  if (!matches(HOUSEHOLD, householdId) || typeof authorize !== 'function'
    || typeof resolveSelection !== 'function' || typeof now !== 'function'
    || !store || ['prepare', 'commit', 'outcome'].some(k => typeof store[k] !== 'function')) {
    throw new TypeError('settlement-confirmation: incomplete trusted dependencies');
  }
  const previews = new Map(), preparing = new Set();
  let writeInFlight = false, uncertainOperation = null;
  function tick() { const value = now(); if (!positive(value)) fail(); return value; }
  async function authorityFor(context) {
    const value = snapshot(await authorize(context));
    if (!shape(value, ['householdId', 'actorId']) || value.householdId !== householdId
      || !matches(ACTOR, value.actorId)) fail();
    return value;
  }
  async function sameAuthority(context, original) {
    if (!isDeepStrictEqual(await authorityFor(context), original)) fail();
  }
  async function originalOutcome(context, authority, operationId) {
    const result = snapshot(await store.outcome({ actorId: authority.actorId, operationId }));
    await sameAuthority(context, authority);
    if (result.status === 'unknown') return null;
    const original = receipt(result, authority, operationId);
    if (!original) fail();
    if (uncertainOperation === operationId) uncertainOperation = null;
    return original;
  }

  async function prepare(context, input) {
    let request, ownedContext, reserved = false;
    try {
      ownedContext = snapshot(context); request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId', 'selection', 'assignedCents'])
        || !matches(OPERATION, request.operationId) || !validSelection(request.selection)
        || !positive(request.assignedCents)) return unavailable('invalid-request');
      if (uncertainOperation) return unavailable('outcome-unresolved');
      if (previews.has(request.operationId) || preparing.has(request.operationId)
        || previews.size + preparing.size >= MAX_PREVIEWS) return unavailable('preview-unavailable');
      preparing.add(request.operationId); reserved = true;
      const authority = await authorityFor(ownedContext);
      const selection = qualified(snapshot(await resolveSelection({ authority, selection: request.selection })), authority);
      const command = link(selection, request.assignedCents);
      const result = snapshot(await store.prepare({ actorId: authority.actorId,
        operationId: request.operationId, command }));
      const preview = validPreview(result, authority, request.operationId, command, tick());
      await sameAuthority(ownedContext, authority);
      if (tick() >= preview.expiresAt) return rejected('preview-expired');
      previews.set(request.operationId, { authority, selection, request, preview,
        confirmationDigest: result.confirmationDigest, attempted: false });
      return snapshot({ status: 'prepared', operationId: request.operationId,
        selection: request.selection, assignedCents: command.assignedCents,
        currency: command.evidence.currency, date: command.evidence.date, asOf: command.asOf,
        operation: { version: 1, kind: 'link' }, expiresAt: preview.expiresAt });
    } catch { return unavailable('prepare-unavailable'); }
    finally { if (reserved) preparing.delete(request.operationId); }
  }

  async function confirm(context, input) {
    let request, enteredCommit = false;
    try {
      const ownedContext = snapshot(context); request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId'], ['confirmed'])
        || !matches(OPERATION, request.operationId)
        || (Object.hasOwn(request, 'confirmed') && typeof request.confirmed !== 'boolean')) {
        return unavailable('invalid-request');
      }
      const authority = await authorityFor(ownedContext);
      // Original commitment takes precedence over ephemeral previews, current
      // provider evidence, expiry and explicit-confirmation requirements.
      const original = await originalOutcome(ownedContext, authority, request.operationId);
      if (original) return original;
      if (uncertainOperation || writeInFlight) return unknown(request.operationId);
      const retained = previews.get(request.operationId);
      if (!retained || !isDeepStrictEqual(retained.authority, authority)) return unknown(request.operationId);
      if (retained.attempted) return unknown(request.operationId);
      if (request.confirmed !== true) return rejected('confirmation-required');
      if (tick() >= retained.preview.expiresAt) return rejected('preview-expired');
      let fresh;
      try {
        fresh = qualified(snapshot(await resolveSelection({ authority,
          selection: retained.request.selection })), authority);
      } catch { return rejected('selection-unavailable'); }
      if (!isDeepStrictEqual(fresh, retained.selection)) return rejected('selection-changed');
      // Read-only store qualification refuses a resident journal/divergence
      // before commit can enter the store's existing recovery pre-pass. This
      // probe uses the SAME operation and command; its fresh preview is
      // discarded, never substituted for the retained preview or its expiry.
      let current;
      try {
        const result = snapshot(await store.prepare({ actorId: authority.actorId,
          operationId: request.operationId, command: retained.preview.command }));
        current = validPreview(result, authority, request.operationId, retained.preview.command, tick());
      } catch { return unavailable('store-unavailable'); }
      if (current.expectedRevision !== retained.preview.expectedRevision
        || current.expectedDocumentDigest !== retained.preview.expectedDocumentDigest) {
        return rejected('store-conflict');
      }
      await sameAuthority(ownedContext, authority);
      if (tick() >= retained.preview.expiresAt) return rejected('preview-expired');
      // No await between this check, consuming the sole attempt and invoking
      // commit. The store sees the original frozen preview, never a rebase.
      if (retained.attempted || writeInFlight || uncertainOperation) return unknown(request.operationId);
      retained.attempted = true; enteredCommit = true; writeInFlight = true;
      uncertainOperation = request.operationId;
      const result = snapshot(await store.commit({ actorId: authority.actorId,
        preview: retained.preview, confirmationDigest: retained.confirmationDigest }));
      await sameAuthority(ownedContext, authority);
      const committed = receipt(result, authority, request.operationId);
      if (committed) { uncertainOperation = null; return committed; }
      if (result.status === 'rejected' && result.reason === 'preview-expired') {
        uncertainOperation = null; return rejected('preview-expired');
      }
      if (result.status === 'conflict') { uncertainOperation = null; return rejected('store-conflict'); }
      return unknown(request.operationId);
    } catch {
      return enteredCommit ? unknown(request.operationId) : unavailable('confirmation-unavailable');
    } finally { if (enteredCommit) writeInFlight = false; }
  }

  async function outcome(context, input) {
    try {
      const ownedContext = snapshot(context), request = snapshot(input);
      if (!record(ownedContext) || !shape(request, ['operationId'])
        || !matches(OPERATION, request.operationId)) return unavailable('invalid-request');
      const authority = await authorityFor(ownedContext);
      return await originalOutcome(ownedContext, authority, request.operationId) || unknown(request.operationId);
    } catch { return unavailable('outcome-unavailable'); }
  }
  return Object.freeze({ prepare, confirm, outcome });
}

module.exports = { createSettlementEvidenceConfirmation };
