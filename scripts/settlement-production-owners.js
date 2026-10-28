'use strict';

// Settlement production owners (Plan #5 slice P1, dispatch issue #765
// comment 6476800429 as re-pinned by 6476923443, accepting Atlas's scope
// objection 6476845815).
//
// FOUNDATION — NOT COMPLETION. This module ships with no production
// importer: the production composition root (a later slice) wires these
// owners into startServer's settlement application record. Nothing here
// activates, provisions, or qualifies anything; A2 and every activation
// hold stay exactly as they are.
//
// The three application owners, under their ACTUAL existing signatures
// (server.js composition, ~1114-1207):
//
//   authorize({ actorId }) — SYNCHRONOUS ordinary household policy. It
//     receives only the server-derived session actor, so it cannot and
//     does not consult the asynchronous authorization-state API, holds
//     no state, and caches no grant: its answer is a pure function of
//     the configured household and the presented actor shape. Signed
//     session proof stays in server.js's private sessionAuthority(req)
//     and is injected at the final HTTP path — untouched by this slice.
//     Eligibility and revocation judgements live in the store-backed
//     seams (issuance, the preliminary recovery policy below, and the
//     final authority), never here.
//
//   authorizeRecovery(input) — the PRELIMINARY controller policy only:
//     a scoped read grant for one named operation, decided fresh from
//     the authorization-store state on every call. The final fresh
//     recovery decision remains server.js's createRecoveryFinalAuthority
//     and its separate invocation; the B4 final timing (digest/expiry
//     judgement against the acquired view) is NOT re-implemented here,
//     and nothing here duplicates or relocates that authority.
//
//   contextReader() — the trusted context projection: exactly
//     { canonical, env, domain, contextRevision }. Read-only and
//     non-authorizing; every call returns fresh defensive copies. The
//     owning factory's advanceContext is the trusted owner's ONLY
//     update path (host-side; never handed to the composition): it
//     advances the revision on every contents change, including ABA
//     returns to earlier contents, so an unchanged revision always
//     means unchanged contents — the composition retires otherwise.
//
// The custody factory composes the existing evidence store's custody
// adapters and the anchor store behind their existing interfaces over
// an injected object transport. It binds an in-memory synthetic
// transport by default (the suites' transport contract); a production
// object-storage transport binds later through the same `transport`
// input, interface unchanged, under Dale's storage decision.

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { createSettlementEvidenceAnchorStore } = require('./settlement-evidence-anchor-store');
const C = require('./planned-obligation-settlement-contract');

const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const ACTOR_RE = /^session-[0-9a-f]{64}$/;
const OPERATION_RE = /^operation-[a-f0-9]{32}$/;
const GENERATION_RE = /^generation-[a-f0-9]{32}$/;
const LEDGER_RE = /^ledger-[a-f0-9]{32}$/;
const AUTHORITY_RE = /^authority-[a-f0-9]{32}$/;
const PREFIX = 'settlement-production-owners: ';

function invalid(detail) { throw new TypeError(PREFIX + 'invalid composition — ' + detail); }
function refused() { throw new Error(PREFIX + 'authorization refused'); }

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

// Reads exactly the named own DATA properties of a plain record. Extra
// or missing keys, accessors, symbols and non-plain prototypes refuse;
// getters are never invoked. `optional` names may be absent.
function fieldsOf(value, required, optional = []) {
  if (!isRecord(value)) return null;
  const allowed = new Set([...required, ...optional]);
  const own = Reflect.ownKeys(value);
  if (!required.every(k => own.includes(k)) || !own.every(k => allowed.has(k))) return null;
  const out = {};
  for (const k of own) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return null;
    out[k] = d.value;
  }
  return out;
}

function validContextShape(context) {
  if (!isRecord(context)) return false;
  if (typeof context.domain !== 'string' || context.domain.length === 0
    || context.domain.length > 128) return false;
  if (!isRecord(context.canonical)) return false;
  if (!isRecord(context.env)
    || Object.values(context.env).some(v => typeof v !== 'string')) return false;
  return true;
}

function createSettlementProductionOwners(options) {
  const o = fieldsOf(options, ['householdId', 'authorizationStore', 'context']);
  if (!o) invalid('options must be exactly { householdId, authorizationStore, context }');
  if (typeof o.householdId !== 'string' || !HOUSEHOLD_RE.test(o.householdId)) {
    invalid('householdId is malformed');
  }
  const householdId = o.householdId;
  if (!o.authorizationStore || typeof o.authorizationStore !== 'object'
    || typeof o.authorizationStore.readAuthorizationState !== 'function') {
    invalid('authorizationStore must expose readAuthorizationState');
  }
  // Capture the state-read reference once; the owner calls nothing else
  // on the store and never writes through it.
  const readAuthorizationState = o.authorizationStore.readAuthorizationState;
  if (!validContextShape(o.context)) invalid('context is malformed');

  // The trusted context cell. Intake is cloned; reads are clones; the
  // only mutation is advanceContext below, which is not part of the
  // composition-facing surface.
  let current = {
    canonical: structuredClone(o.context.canonical),
    env: { ...o.context.env },
    domain: o.context.domain,
  };
  let contextRevision = 1;

  // Synchronous ordinary policy: admit the session-layer actor shape
  // for the configured household. Any other input — malformed, broadened
  // or accessor-bearing — refuses. No store, no cache, no clock.
  function authorize(input) {
    const fields = fieldsOf(input, ['actorId']);
    if (!fields || typeof fields.actorId !== 'string' || !ACTOR_RE.test(fields.actorId)) refused();
    return Object.freeze({ householdId, actorId: fields.actorId });
  }

  // Preliminary recovery admission. With a generation, one FRESH
  // authorization-state read decides: live eligibility for the exact
  // operation/generation, bound to the configured household, with
  // neither revocation tombstone present. The session digest is derived
  // from the presented actor exactly as server.js's sessionAuthority
  // derives it from the same session id — the input is not broadened
  // and no request/session seam is touched. Without a generation no
  // state read is keyable, so admission is shape-and-household only;
  // the final authority (which requires the generation) still decides
  // disclosure. A store error or an unknown state refuses.
  async function authorizeRecovery(input) {
    const fields = fieldsOf(input,
      ['householdId', 'actorId', 'operationId'], ['generation']);
    if (!fields) refused();
    if (fields.householdId !== householdId) refused();
    if (typeof fields.actorId !== 'string' || !ACTOR_RE.test(fields.actorId)) refused();
    if (typeof fields.operationId !== 'string' || !OPERATION_RE.test(fields.operationId)) refused();
    if (fields.generation !== undefined
      && (typeof fields.generation !== 'string' || !GENERATION_RE.test(fields.generation))) refused();
    if (fields.generation !== undefined) {
      const sidDigest = crypto.createHash('sha256')
        .update(fields.actorId.slice('session-'.length)).digest('hex');
      let state;
      try {
        state = await readAuthorizationState({
          operationId: fields.operationId, generation: fields.generation, sidDigest,
        });
      } catch { refused(); }
      if (!isRecord(state) || state.state !== 'ok') refused();
      if (!isRecord(state.eligibility)
        || state.eligibility.householdId !== householdId
        || state.eligibility.operationId !== fields.operationId
        || state.eligibility.generation !== fields.generation) refused();
      if (state.operationRevoked !== false || state.sessionRevoked !== false) refused();
    }
    return Object.freeze({
      householdId, actorId: fields.actorId, operationId: fields.operationId,
    });
  }

  function contextReader() {
    return Object.freeze({
      canonical: structuredClone(current.canonical),
      env: Object.freeze({ ...current.env }),
      domain: current.domain,
      contextRevision,
    });
  }

  // Trusted-owner update path (host-side only). A contents change —
  // including an ABA return to earlier contents — advances the
  // revision; an identical advance is a no-op. A malformed advance
  // refuses and leaves the context untouched.
  function advanceContext(next) {
    const fields = fieldsOf(next, ['canonical', 'env']);
    if (!fields || !validContextShape({ domain: current.domain, canonical: fields.canonical, env: fields.env })) {
      invalid('advance context is malformed');
    }
    if (isDeepStrictEqual(fields.canonical, current.canonical)
      && isDeepStrictEqual(fields.env, current.env)) return contextRevision;
    current = {
      canonical: structuredClone(fields.canonical),
      env: { ...fields.env },
      domain: current.domain,
    };
    contextRevision += 1;
    if (!Number.isSafeInteger(contextRevision)) invalid('context revision exhausted');
    return contextRevision;
  }

  return Object.freeze({ authorize, authorizeRecovery, contextReader, advanceContext });
}

// The anchor store's documented transport contract, in memory: atomic
// absent-only create, version-conditional replace, paged list. Mirrors
// the anchor suite's synthetic transport semantics (no fault hooks —
// this is the composition-facing default, not a test double).
function createSettlementAnchorMemoryTransport() {
  const objects = new Map();
  let seq = 0;
  const conflict = () => {
    const e = new Error('settlement anchor transport: conditional write conflict');
    e.code = 'conflict';
    return e;
  };
  const integrity = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  return Object.freeze({
    async read(key) {
      const o = objects.get(key);
      if (!o) return null;
      return { bytes: Buffer.from(o.bytes), version: o.version, metadata: { ...o.metadata } };
    },
    async create(key, bytes, metadata) {
      if (objects.has(key)) throw conflict();
      const version = 'v' + (++seq);
      const stored = Buffer.from(bytes);
      objects.set(key, { bytes: stored, version, metadata: { ...metadata } });
      return { version, integrity: integrity(stored) };
    },
    async replace(key, bytes, version, metadata) {
      const o = objects.get(key);
      if (!o || o.version !== version) throw conflict();
      const v = 'v' + (++seq);
      const stored = Buffer.from(bytes);
      objects.set(key, { bytes: stored, version: v, metadata: { ...metadata } });
      return { version: v, integrity: integrity(stored) };
    },
    async list(prefix, cursor) {
      const keys = [...objects.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor === null ? 0 : keys.findIndex(k => k > cursor);
      const from = start < 0 ? keys.length : start;
      const page = keys.slice(from, from + 2);
      const entries = page.map(k => ({ key: k, metadata: { ...objects.get(k).metadata } }));
      const nextCursor = from + page.length < keys.length ? page[page.length - 1] : null;
      return { entries, nextCursor };
    },
  });
}

function createSettlementProductionCustody(options) {
  const o = fieldsOf(options,
    ['householdId', 'exclusionDomain', 'now'], ['prefix', 'schema', 'transport']);
  if (!o) invalid('custody options must be { householdId, exclusionDomain, now[, prefix, schema, transport] }');
  if (typeof o.householdId !== 'string' || !HOUSEHOLD_RE.test(o.householdId)) {
    invalid('householdId is malformed');
  }
  const domainFields = fieldsOf(o.exclusionDomain,
    ['ledgerNamespace', 'serializationAuthority', 'historyAuthority']);
  if (!domainFields || typeof domainFields.ledgerNamespace !== 'string'
    || !LEDGER_RE.test(domainFields.ledgerNamespace)
    || typeof domainFields.serializationAuthority !== 'string'
    || !AUTHORITY_RE.test(domainFields.serializationAuthority)
    || typeof domainFields.historyAuthority !== 'string'
    || !AUTHORITY_RE.test(domainFields.historyAuthority)) {
    invalid('exclusionDomain is malformed');
  }
  if (typeof o.now !== 'function') invalid('now must be a function');
  const exclusionDomain = Object.freeze({ ...domainFields });
  const householdId = o.householdId;
  const transport = o.transport === undefined
    ? createSettlementAnchorMemoryTransport() : o.transport;

  // The anchor store composes over the injected transport at
  // construction (it validates the transport's conditional contract
  // itself); prefix/schema are its binding inputs, surfaced here so the
  // production binding supplies its own values unchanged.
  const anchorStore = createSettlementEvidenceAnchorStore({
    transport,
    prefix: o.prefix === undefined ? 'settlement-anchor' : o.prefix,
    schema: o.schema === undefined ? 'settlement_evidence' : o.schema,
  });

  // Pin custody: CAS advance on the exact current record, mirroring the
  // shipped adapter semantics the evidence store consumes. Starts
  // unseeded (proven absence); genesis seeding is an explicit advance
  // from null by the composing host, never an implicit default here.
  let pin = null;
  const pinStore = Object.freeze({
    async read() { return pin && structuredClone(pin); },
    async advance(expected, next) {
      const matches = expected === null
        ? pin === null
        : pin !== null && expected.revision === pin.revision && expected.digest === pin.digest;
      if (!matches) return false;
      pin = structuredClone(next);
      return true;
    },
  });

  // Backup custody: immutable artifacts keyed by digest, listed
  // without bytes — the shipped backup adapter's exact surface.
  const backups = new Map();
  const backupStore = Object.freeze({
    async put(revision, digest, bytes) {
      const entry = { revision, digest, artifactId: 'synthetic-' + revision };
      backups.set(digest, { ...entry, bytes: Buffer.from(bytes) });
      return { ...entry };
    },
    async get(revision, digest) {
      const e = backups.get(digest);
      return e && e.revision === revision ? Buffer.from(e.bytes) : null;
    },
    async list() {
      return [...backups.values()].map(({ bytes, ...e }) => ({ ...e }));
    },
  });

  // Terminal-history custody: the encoded snapshot the evidence
  // store's terminal gate qualifies — append is a CAS on the exact
  // current checkpoint, and history starts as the valid empty history
  // for this household/namespace (revision 0, no records), never as
  // fabricated certificates.
  const encodeHistory = records => {
    const body = {
      schema: 'terminal-history-1', householdId,
      ledgerNamespace: exclusionDomain.ledgerNamespace,
      revision: records.length, records: structuredClone(records),
    };
    const digest = C.digest(body);
    return {
      historyBytes: Buffer.from(JSON.stringify({ ...body, digest })),
      checkpoint: {
        schema: 'terminal-history-checkpoint-1', householdId,
        ledgerNamespace: exclusionDomain.ledgerNamespace,
        revision: records.length, digest,
      },
    };
  };
  let history = encodeHistory([]);
  const terminalHistory = Object.freeze({
    async readSnapshot() {
      return { historyBytes: Buffer.from(history.historyBytes), checkpoint: structuredClone(history.checkpoint) };
    },
    async compareAndAppend(input) {
      if (!isRecord(input) || !isDeepStrictEqual(input.expectedCheckpoint, history.checkpoint)) return false;
      const records = JSON.parse(history.historyBytes.toString('utf8')).records;
      records.push(structuredClone(input.certificate));
      history = encodeHistory(records);
      return true;
    },
  });

  return Object.freeze({
    pinStore, backupStore, terminalHistory, exclusionDomain, anchorStore, transport,
  });
}

module.exports = {
  createSettlementProductionOwners,
  createSettlementProductionCustody,
  createSettlementAnchorMemoryTransport,
};
