'use strict';

// Settlement evidence exact-restore INPUT VALIDATOR (ATLAS-080).
//
// DISCONNECTED and NON-MUTATING. This module has no production importer,
// route, filesystem, network, SQL, driver, environment, decryption,
// credential, installation or session behaviour. It validates one supplied
// candidate pair (financial ledger bytes + negative terminal-history bytes)
// against a trusted, explicitly supplied anchor pair for one household and
// ledger namespace, and returns a bounded, deep-frozen verdict.
//
// Non-claims (read before relying on a 'valid' verdict):
//   - Anchor provenance and latestness are a TRUSTED MAINTENANCE
//     PRECONDITION supplied by the caller. This validator neither discovers
//     nor authenticates that the anchors are the latest durable state.
//   - Ledger plaintext carries householdId only; it does not independently
//     prove the terminal ledger namespace. The namespace binding comes from
//     the supplied domain and the history bytes.
//   - 'valid' is NOT restore success. It grants no authority to install,
//     reopen, invalidate sessions or advance any pin or rollback floor.
//   - No backup listing is required or invoked: a listing (or a thrown one)
//     cannot be established or classified here.
//   - It never calls TC.qualifySnapshot or TC.registerDomain, so no live
//     process rollback floor or domain registry is advanced or touched.
//
// Certificate string fields are required to be primitive strings before
// TC.isCertificate and the uniqueness/overlap Sets (stricter than
// qualifySnapshot, which coerces them through its regex checks).
//
// Reused primitives: the contract's C.pin (decode + replay + household
// binding) for the ledger; TC.own, TC.isCertificate and C.digest for history, under
// the same identity/revision/digest/unique-operationId rules as
// qualifySnapshot. The 4 MiB history byte bound is NEW to this module.

const C = require('./planned-obligation-settlement-contract');
const TC = require('./settlement-evidence-terminal-certificate');

const HH = /^household-[a-f0-9]{32}$/, NS = /^ledger-[a-f0-9]{32}$/, HASH = /^[a-f0-9]{64}$/;
const HISTORY_SCHEMA = 'terminal-history-1', CHECKPOINT_SCHEMA = 'terminal-history-checkpoint-1';
const MAX_HISTORY_BYTES = 4 * 1024 * 1024;
// Certificate fields that must be PRIMITIVE strings here. TC.isCertificate's
// regex checks coerce, so an array-wrapped value would pass it and then defeat
// Set-based uniqueness/overlap by object identity. Stricter than
// qualifySnapshot by design (labelled in the tests); TC is unchanged.
const CERT_STRING_FIELDS = Object.freeze(['schema', 'householdId', 'ledgerNamespace', 'operationId', 'actorId', 'kind',
  'generation', 'reason', 'expectedDocumentDigest', 'confirmationDigest']);
const REASONS = Object.freeze(['input-malformed', 'domain-malformed', 'anchor-malformed', 'ledger-invalid',
  'ledger-household-mismatch', 'ledger-anchor-mismatch', 'history-invalid', 'history-domain-mismatch',
  'history-anchor-mismatch', 'negative-financial-overlap']);

class Refusal { constructor(reason) { this.reason = reason; } }
const refuse = reason => { throw new Refusal(reason); };
const integer = x => Number.isSafeInteger(x) && x >= 0;

// Reads exactly the named own DATA properties of a plain object. Accessors,
// extra/missing keys, symbols and non-plain prototypes are refused; getters
// are never invoked.
function fieldsOf(value, names, reason) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) refuse(reason);
  const own = Reflect.ownKeys(value);
  if (own.length !== names.length || !names.every(n => own.includes(n))) refuse(reason);
  const out = {};
  for (const n of names) {
    const d = Object.getOwnPropertyDescriptor(value, n);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) refuse(reason);
    out[n] = d.value;
  }
  return out;
}
// Intrinsic %TypedArray%.prototype accessors and methods, captured at load.
// They read the internal slots of a real typed array, so caller own
// properties, getters and overridden methods on the view are never consulted
// (and getters never execute).
const TA = Object.getPrototypeOf(Uint8Array.prototype);
const intrinsic = name => Object.getOwnPropertyDescriptor(TA, name).get;
const TAG = Object.getOwnPropertyDescriptor(TA, Symbol.toStringTag).get;
const BUFFER = intrinsic('buffer'), OFFSET = intrinsic('byteOffset'), LENGTH = intrinsic('byteLength');
const SET = TA.set, apply = Reflect.apply;
function copyBytes(value, max) {
  // Brand check through the intrinsic tag getter: true only for a real
  // Uint8Array (Buffer included); never throws, never runs caller code.
  if (value === null || typeof value !== 'object' || apply(TAG, value, []) !== 'Uint8Array') refuse('input-malformed');
  const length = apply(LENGTH, value, []);
  if (length === 0 || length > max) return null;
  const view = new Uint8Array(apply(BUFFER, value, []), apply(OFFSET, value, []), length);
  const out = Buffer.alloc(length);
  apply(SET, out, [view]);
  return out;
}
function deepFreeze(x) {
  if (x && typeof x === 'object') { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x); }
  return x;
}

function snapshot(input) {
  const top = fieldsOf(input, ['domain', 'anchors', 'candidate'], 'input-malformed');
  const domain = fieldsOf(top.domain, ['householdId', 'ledgerNamespace'], 'domain-malformed');
  if (typeof domain.householdId !== 'string' || !HH.test(domain.householdId)
    || typeof domain.ledgerNamespace !== 'string' || !NS.test(domain.ledgerNamespace)) refuse('domain-malformed');
  const anchors = fieldsOf(top.anchors, ['ledger', 'history'], 'anchor-malformed');
  const ledger = fieldsOf(anchors.ledger, ['revision', 'documentDigest'], 'anchor-malformed');
  const history = fieldsOf(anchors.history, ['schema', 'householdId', 'ledgerNamespace', 'revision', 'digest'], 'anchor-malformed');
  if (!integer(ledger.revision) || typeof ledger.documentDigest !== 'string' || !HASH.test(ledger.documentDigest)
    || history.schema !== CHECKPOINT_SCHEMA || !integer(history.revision)
    || typeof history.digest !== 'string' || !HASH.test(history.digest)
    || typeof history.householdId !== 'string' || typeof history.ledgerNamespace !== 'string') refuse('anchor-malformed');
  // The history anchor must name the supplied domain; a cross-domain anchor
  // is never substituted.
  if (history.householdId !== domain.householdId || history.ledgerNamespace !== domain.ledgerNamespace)
    refuse('history-domain-mismatch');
  const candidate = fieldsOf(top.candidate, ['ledgerBytes', 'historyBytes'], 'input-malformed');
  const ledgerBytes = copyBytes(candidate.ledgerBytes, Infinity);
  const historyBytes = copyBytes(candidate.historyBytes, MAX_HISTORY_BYTES);
  return { domain: { ...domain }, ledgerAnchor: { ...ledger }, historyAnchor: { ...history }, ledgerBytes, historyBytes };
}

function validateLedger(bytes, domain, anchor) {
  if (!bytes) refuse('ledger-invalid');
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { refuse('ledger-invalid'); }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) refuse('ledger-invalid');
  if (typeof parsed.householdId === 'string' && HH.test(parsed.householdId) && parsed.householdId !== domain.householdId)
    refuse('ledger-household-mismatch');
  let pin;
  try { pin = C.pin(bytes, domain.householdId); } catch { refuse('ledger-invalid'); }
  if (parsed.revision !== anchor.revision || parsed.digest !== anchor.documentDigest) refuse('ledger-anchor-mismatch');
  return { revision: parsed.revision, documentDigest: parsed.digest, pin,
    operationIds: parsed.operations.map(o => o.operationId) };
}

function validateHistory(bytes, domain, anchor) {
  if (!bytes) refuse('history-invalid');
  let history;
  // Same own() depth/data/descriptor rules qualifySnapshot applies.
  try { history = TC.own(JSON.parse(bytes.toString('utf8'))); } catch { refuse('history-invalid'); }
  if (history === null || typeof history !== 'object' || Array.isArray(history)
    || Object.getPrototypeOf(history) !== Object.prototype) refuse('history-invalid');
  const k = Object.keys(history);
  const want = ['schema', 'householdId', 'ledgerNamespace', 'revision', 'records', 'digest'];
  if (k.length !== want.length || !want.every(n => k.includes(n)) || history.schema !== HISTORY_SCHEMA
    || !Array.isArray(history.records) || !integer(history.revision) || history.revision !== history.records.length
    || typeof history.digest !== 'string' || !HASH.test(history.digest)) refuse('history-invalid');
  if (history.householdId !== domain.householdId || history.ledgerNamespace !== domain.ledgerNamespace)
    refuse('history-domain-mismatch');
  const { digest, ...payload } = history;
  let recomputed;
  try { recomputed = C.digest(payload); } catch { refuse('history-invalid'); }
  if (recomputed !== digest) refuse('history-invalid');
  const ids = new Set();
  for (const r of history.records) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)
      || CERT_STRING_FIELDS.some(f => !Object.hasOwn(r, f) || typeof r[f] !== 'string')) refuse('history-invalid');
    if (!TC.isCertificate(r)) refuse('history-invalid');
    if (r.householdId !== domain.householdId || r.ledgerNamespace !== domain.ledgerNamespace) refuse('history-domain-mismatch');
    if (ids.has(r.operationId)) refuse('history-invalid');
    ids.add(r.operationId);
  }
  if (history.revision !== anchor.revision || digest !== anchor.digest) refuse('history-anchor-mismatch');
  return { revision: history.revision, digest, operationIds: ids };
}

function validateRestoreInput(input) {
  try {
    const s = snapshot(input);
    const ledger = validateLedger(s.ledgerBytes, s.domain, s.ledgerAnchor);
    const history = validateHistory(s.historyBytes, s.domain, s.historyAnchor);
    if (ledger.operationIds.some(id => history.operationIds.has(id))) refuse('negative-financial-overlap');
    return deepFreeze({
      status: 'valid', householdId: s.domain.householdId, ledgerNamespace: s.domain.ledgerNamespace,
      ledger: { revision: ledger.revision, documentDigest: ledger.documentDigest, pin: ledger.pin },
      history: { revision: history.revision, digest: history.digest },
      operationCount: ledger.operationIds.length, negativeRecordCount: history.operationIds.size,
    });
  } catch (error) {
    // Bounded diagnostics: only a fixed reason, never bytes, digests or
    // underlying parse/driver text.
    const reason = error instanceof Refusal && REASONS.includes(error.reason) ? error.reason : 'input-malformed';
    return Object.freeze({ status: 'refused', reason });
  }
}

module.exports = Object.freeze({ validateRestoreInput, RESTORE_INPUT_REFUSALS: REASONS, MAX_HISTORY_BYTES });
