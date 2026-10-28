'use strict';

const crypto = require('crypto');

// Settlement evidence authorization-state store (ATLAS-080, B4 re-login
// recovery) — the durable authorization state behind the recovery policy:
// eligibility, operation revocation and session revocation records.
//
// FOUNDATION ONLY, DEFAULT DISCONNECTED. This module has no production
// importer, no route, no driver dependency, no connection defaults, no
// credentials, no environment reads, no network and no DDL. Importing it
// performs no I/O and construction performs no I/O. A caller injects ONE
// already-connected, dedicated PostgreSQL session (node-postgres-shaped:
// query(text, values), on('error'|'end', listener), plus a REQUIRED
// retire() that terminates that exact session) together with the
// validated schema and scope configuration. The store takes EXCLUSIVE
// lifetime ownership of that session: a session already owned by
// another authorization store is refused at construction, the session
// must be one non-reconnecting, non-multiplexed session (direct, or
// session-mode pooling; never transaction pooling), and no
// shared-session mechanism exists or is implied here. The financial
// writer client is never reused or exposed here, and the three
// relations below are this module's own — never the financial journal,
// document or custody tables.
//
// Records (digests only — a raw browser secret or raw session id never
// enters this module, a statement value, or a result):
//   eligibility       { householdId, operationId, generation,
//                       confirmationDigest, secretDigest, issuedAt }
//                     keyed (scope, operationId, generation)
//   revocation        { operationId, generation, revokedAt }
//                     keyed (scope, operationId, generation)
//   sessionRevocation { sidDigest, revokedAt }
//                     keyed (scope, sidDigest)
// The scope is part of every key and every statement, so two stores
// with different scopes — each on its own exclusively owned dedicated
// session against the same database — see none of each other's
// records; createAuthorizationStore({ session }) alone establishes no
// isolation, so schema and scope are required construction config.
//
// Append-only: no statement in this module updates or deletes a row.
// Reissue identity is established by comparing the stored record inside
// the transaction — household, confirmationDigest, secretDigest and the
// supplied issuedAt must ALL agree — never inferred from conflict
// suppression (no statement carries an ON CONFLICT clause). A differing
// immutable field is a definite conflict refusal after an affirmed
// ROLLBACK; the stored record is never overwritten.
//
// Session discipline (the shipped adapter discipline, restated for this
// module's outcome-envelope surface):
//   - All session traffic is serialized through one queue; a WHOLE
//     transaction (BEGIN..COMMIT/ROLLBACK) occupies the queue as one
//     unit, and the state read uses the same queue, so a read never
//     interleaves inside an open transaction. Because the store owns
//     its session exclusively, this queue is the only traffic on that
//     session; cross-store exclusion is the scope keying above, never
//     session sharing.
//   - Identifiers and digests are validated as primitive strings
//     BEFORE snapshotting (a boxed String that a bare pattern test
//     would coerce is refused), so a snapshot holds only immutable
//     primitives. Every caller-controlled property — call inputs,
//     stored-row fields, and the construction inputs — is captured
//     EXACTLY ONCE and validation applies to the captured values, so
//     the value that is validated is the value that is used: an
//     accessor that flips between reads cannot substitute an
//     unvalidated value, and an accessor throwing during capture is
//     refused (call time) or a protocol failure (row). Validated
//     write inputs are snapshotted at call time, BEFORE the queue;
//     later caller mutation of a record cannot change what a queued
//     operation persists or compares.
//   - Any rejected query, malformed resolved envelope, wrong or missing
//     transaction command tag, or the session's 'error'/'end' event is
//     session loss: the store is permanently invalid, the exact session
//     is retired exactly once (by loss or by retire(), never twice),
//     and the in-flight outcome is UNKNOWN. A later operation resolves
//     unknown without touching the session. Recovery is a new store
//     over a new session.
//   - Durable success is reported ONLY after COMMIT resolves with an
//     affirmative COMMIT command tag. Any query/commit/protocol
//     uncertainty resolves { outcome: 'unknown' } — never absence,
//     never success. Missing eligibility is a definite fact only from
//     a successful readAuthorizationState ({ state: 'ok',
//     eligibility: null }), which is distinct from { state: 'unknown' }.
//   - retire() closes admission synchronously and idempotently: queued
//     work resolves unknown without executing, an in-flight completion
//     cannot publish a success outcome after retirement, and post-retire
//     operations resolve unknown with no session traffic.
//   - Errors thrown for malformed construction/input carry bounded
//     detail only — never a supplied value, never driver text. This
//     module never logs.
//
// readAuthorizationState is deliberately STATE ONLY: exactly one
// parameterized read-only statement returns the exact-key eligibility
// record and the two revocation facts from one statement snapshot. It
// carries no authorize flag, grants no admission, and caches nothing.
// Its absence claim is strict: every selected field must be present
// and proven absence requires all six eligibility columns to be SQL
// null — a missing column or a mixed null/non-null row is malformed,
// resolves unknown, and retires the store. The same retire fence
// covers every validation or protocol exception in a write or read
// unit: after any exception the uncertain transaction/session is never
// reused.
// The three relations alone do not establish current session, household
// or expiry permission; the final joint decision is a later integration
// boundary, not this module.
//
// Frontier reads (anchor/epoch S2) are additive and read-only. Nothing
// here advances an anchor, and these methods are not on the decision or
// connection path. Each is one statement on the same serial queue:
//   readCombinedSnapshot — readState's facts plus the revocation frontier
//   readAuthorizationFrontier — frontier only, for the advance protocol
//   readCanonicalRevocationSet — the same frontier object, for
//     reconciliation's canonical set
// Eligibility is not part of the frontier. Encoding version is the
// UTF-8 literal "1" (a later change is a new version, never a silent
// edit). The digest is SHA-256 of the §2.1.1 preimage, computed here
// over the rows that one statement returned — no SQL hash extension.
// A failed or malformed read resolves { state: 'unknown' } and retires
// the store. It never invents an empty frontier or a zero digest.
// The three methods are own properties but not enumerable: the shipped
// enumerable surface is pinned outside this slice. Callers use the name.
//
// NOT established by this module: real PostgreSQL concurrency or
// durability qualification (its suite qualifies the protocol against
// injected doubles only), two-connection ordering, rollback protection
// (restoring a pre-revocation checkpoint resurrects revoked state —
// an activation prerequisite owned elsewhere), schema provisioning,
// or any live credential issuance. The relation contract below is
// descriptive only — nothing here provisions it or claims an existing
// schema matches it.

const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const OPERATION_RE = /^operation-[a-f0-9]{32}$/;
const GENERATION_RE = /^generation-[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

const RELATION_CONTRACT = Object.freeze({
  note: 'descriptive only; not provisioned; no existing schema is claimed to match',
  session: 'one dedicated session per store; direct or session-mode pooling only (never transaction pooling); never the financial writer client',
  relations: Object.freeze({
    auth_eligibility: Object.freeze({
      columns: 'scope text, household_id text, operation_id text, generation text, confirmation_digest text, secret_digest text, issued_at bigint, primary key (scope, operation_id, generation)',
      grants: 'SELECT, INSERT',
    }),
    auth_revocation: Object.freeze({
      columns: 'scope text, operation_id text, generation text, revoked_at bigint, primary key (scope, operation_id, generation)',
      grants: 'SELECT, INSERT',
    }),
    auth_session_revocation: Object.freeze({
      columns: 'scope text, sid_digest text, revoked_at bigint, primary key (scope, sid_digest)',
      grants: 'SELECT, INSERT',
    }),
  }),
  client: 'query(text, values), on(\'error\'|\'end\'), retire() that terminates this exact session',
});

const UNKNOWN_WRITE = Object.freeze({ outcome: 'unknown' });
const UNKNOWN_READ = Object.freeze({ state: 'unknown' });

const CLAIMED = new WeakSet(); // sessions under exclusive store ownership
const READ_ELIGIBILITY_COLUMNS = Object.freeze([
  'household_id', 'operation_id', 'generation',
  'confirmation_digest', 'secret_digest', 'issued_at',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function isHash(value) { return typeof value === 'string' && HASH_RE.test(value); }
// Identifiers validate as PRIMITIVE strings only: a bare RegExp test
// coerces boxed String objects, and a snapshot retaining such an object
// would let a later-added toPostgres change the parameter actually
// formatted by the driver. typeof first, pattern second — everywhere.
function isPattern(re, value) { return typeof value === 'string' && re.test(value); }
function isTick(value) { return Number.isSafeInteger(value) && value > 0; }
// node-postgres returns int8 as a decimal string; accept exactly a safe
// positive tick in either representation, nothing else.
function asTick(value) {
  if (isTick(value)) return value;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (isTick(n)) return n;
  }
  return null;
}
function exactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
// A resolved query envelope: any non-null, non-array object whose `rows`
// is an array (node-postgres resolves with Result instances, so the
// prototype is not required to be Object.prototype).
function isResultEnvelope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.rows);
}
function badInput(detail) {
  throw new TypeError('settlement-authorization-store: ' + detail);
}
// Capture caller-controlled properties EXACTLY ONCE, before
// validation: validation and snapshot must see the same values. A
// getter that flips between a validation read and a snapshot read
// (valid primitive first, boxed/hostile value second) must never get
// an unvalidated value into a statement. A getter throwing during
// capture is a malformed input — bounded refusal, no leaked text.
function captureFields(input, keys) {
  const out = {};
  try {
    for (const k of keys) out[k] = input[k];
  } catch {
    badInput('input properties could not be read');
  }
  return out;
}

// §2.1.1 canonical frontier. encodingVersion "1". Digest fields that
// the design holds as lowercase hex are framed as their raw 32 bytes;
// text fields are framed UTF-8; revokedAt and the entry count are
// bare u64be. Incarnation is a digest (the genesis-event digest), so
// it takes the raw-32-byte rule even though this store does not hold
// the incarnation row.
const FRONTIER_ENCODING_VERSION = '1';

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}
function u64beNonNeg(n) {
  if (!Number.isSafeInteger(n) || n < 0) return null;
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n), 0);
  return b;
}
function frameBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 0xffffffff) return null;
  return Buffer.concat([u32be(bytes.length), bytes]);
}
function frameText(text) {
  if (typeof text !== 'string') return null;
  return frameBytes(Buffer.from(text, 'utf8'));
}
function frameHash(hex) {
  if (!isHash(hex)) return null;
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) return null;
  return frameBytes(raw);
}
function encodeOperationEntry(operationId, generation, revokedAt) {
  if (!isPattern(OPERATION_RE, operationId) || !isPattern(GENERATION_RE, generation) || !isTick(revokedAt)) {
    return null;
  }
  const parts = [frameText('oprev'), frameText(operationId), frameText(generation), u64beNonNeg(revokedAt)];
  if (parts.some(p => p == null)) return null;
  return Buffer.concat(parts);
}
function encodeSessionEntry(sidDigest, revokedAt) {
  if (!isHash(sidDigest) || !isTick(revokedAt)) return null;
  const parts = [frameText('sesrev'), frameHash(sidDigest), u64beNonNeg(revokedAt)];
  if (parts.some(p => p == null)) return null;
  return Buffer.concat(parts);
}
function asJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;
  let parsed;
  try { parsed = JSON.parse(value); } catch { return null; }
  return Array.isArray(parsed) ? parsed : null;
}
function captureTuple(tuple, width) {
  if (!Array.isArray(tuple) || tuple.length !== width) return null;
  const out = [];
  try {
    for (let i = 0; i < width; i++) {
      if (!Object.hasOwn(tuple, i)) return null;
      out.push(tuple[i]);
    }
  } catch { return null; }
  return out;
}

function createAuthorizationStore(options) {
  if (!isRecord(options)) badInput('options are required');
  const { session, schema, scope } = options;
  // Construction inputs are captured once as well: each session method
  // is read a single time, validated as a function, and bound — the
  // store only ever invokes the captured references.
  let rawQuery; let rawOn; let rawRetire;
  try {
    rawQuery = session == null ? undefined : session.query;
    rawOn = session == null ? undefined : session.on;
    rawRetire = session == null ? undefined : session.retire;
  } catch {
    badInput('session could not be read');
  }
  if (typeof rawQuery !== 'function' || typeof rawOn !== 'function'
    || typeof rawRetire !== 'function') {
    badInput('a dedicated session with query(), on() and retire() is required');
  }
  const sessionQuery = rawQuery.bind(session);
  const sessionOn = rawOn.bind(session);
  const sessionRetire = rawRetire.bind(session);
  if (CLAIMED.has(session)) badInput('session is already owned by another authorization store');
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema)
    || schema.startsWith('pg_') || schema === 'information_schema') {
    badInput('schema identifier is invalid');
  }
  if (typeof scope !== 'string' || !SCOPE_RE.test(scope)) badInput('scope is invalid');

  const q = '"' + schema + '"';
  const T = {
    eligibility: q + '.auth_eligibility',
    revocation: q + '.auth_revocation',
    sessionRevocation: q + '.auth_session_revocation',
  };
  const SQL = Object.freeze({
    eligibilityByKey: 'SELECT scope, household_id, operation_id, generation,'
      + ' confirmation_digest, secret_digest, issued_at FROM ' + T.eligibility
      + ' WHERE scope = $1 AND operation_id = $2 AND generation = $3',
    insertEligibility: 'INSERT INTO ' + T.eligibility
      + ' (scope, household_id, operation_id, generation, confirmation_digest, secret_digest, issued_at)'
      + ' VALUES ($1, $2, $3, $4, $5, $6, $7)',
    revocationByKey: 'SELECT revoked_at FROM ' + T.revocation
      + ' WHERE scope = $1 AND operation_id = $2 AND generation = $3',
    insertRevocation: 'INSERT INTO ' + T.revocation
      + ' (scope, operation_id, generation, revoked_at) VALUES ($1, $2, $3, $4)',
    sessionRevocationByKey: 'SELECT revoked_at FROM ' + T.sessionRevocation
      + ' WHERE scope = $1 AND sid_digest = $2',
    insertSessionRevocation: 'INSERT INTO ' + T.sessionRevocation
      + ' (scope, sid_digest, revoked_at) VALUES ($1, $2, $3)',
    // ONE read-only statement: the statement's own snapshot is the read.
    readState: 'SELECT e.household_id AS household_id, e.operation_id AS operation_id,'
      + ' e.generation AS generation, e.confirmation_digest AS confirmation_digest,'
      + ' e.secret_digest AS secret_digest, e.issued_at AS issued_at,'
      + ' (r.operation_id IS NOT NULL) AS operation_revoked,'
      + ' (s.sid_digest IS NOT NULL) AS session_revoked'
      + ' FROM (VALUES (1)) AS one (x)'
      + ' LEFT JOIN ' + T.eligibility + ' e'
      + ' ON e.scope = $1 AND e.operation_id = $2 AND e.generation = $3'
      + ' LEFT JOIN ' + T.revocation + ' r'
      + ' ON r.scope = $1 AND r.operation_id = $2 AND r.generation = $3'
      + ' LEFT JOIN ' + T.sessionRevocation + ' s'
      + ' ON s.scope = $1 AND s.sid_digest = $4',
    // One statement: the shipped fact joins, plus both revocation
    // relations. Subqueries share this statement's snapshot. json_agg
    // order is undefined; canonical order is the encoded-byte sort.
    readCombined: 'SELECT e.household_id AS household_id, e.operation_id AS operation_id,'
      + ' e.generation AS generation, e.confirmation_digest AS confirmation_digest,'
      + ' e.secret_digest AS secret_digest, e.issued_at AS issued_at,'
      + ' (r.operation_id IS NOT NULL) AS operation_revoked,'
      + ' (s.sid_digest IS NOT NULL) AS session_revoked,'
      + ' COALESCE((SELECT json_agg(json_build_array(rv.operation_id, rv.generation, rv.revoked_at))'
      + ' FROM ' + T.revocation + ' rv WHERE rv.scope = $1), \'[]\'::json) AS frontier_operation_revocations,'
      + ' COALESCE((SELECT json_agg(json_build_array(sv.sid_digest, sv.revoked_at))'
      + ' FROM ' + T.sessionRevocation + ' sv WHERE sv.scope = $1), \'[]\'::json) AS frontier_session_revocations'
      + ' FROM (VALUES (1)) AS one (x)'
      + ' LEFT JOIN ' + T.eligibility + ' e'
      + ' ON e.scope = $1 AND e.operation_id = $2 AND e.generation = $3'
      + ' LEFT JOIN ' + T.revocation + ' r'
      + ' ON r.scope = $1 AND r.operation_id = $2 AND r.generation = $3'
      + ' LEFT JOIN ' + T.sessionRevocation + ' s'
      + ' ON s.scope = $1 AND s.sid_digest = $4',
    readRevocationSet: 'SELECT'
      + ' COALESCE((SELECT json_agg(json_build_array(rv.operation_id, rv.generation, rv.revoked_at))'
      + ' FROM ' + T.revocation + ' rv WHERE rv.scope = $1), \'[]\'::json) AS frontier_operation_revocations,'
      + ' COALESCE((SELECT json_agg(json_build_array(sv.sid_digest, sv.revoked_at))'
      + ' FROM ' + T.sessionRevocation + ' sv WHERE sv.scope = $1), \'[]\'::json) AS frontier_session_revocations',
  });

  CLAIMED.add(session);
  let lost = false;
  let closed = false;
  let sessionRetired = false;
  let tail = Promise.resolve();
  const accepting = () => !lost && !closed;

  function retireSessionOnce() {
    if (sessionRetired) return;
    sessionRetired = true;
    try { Promise.resolve(sessionRetire()).catch(() => {}); } catch { /* still retired */ }
  }
  function markLost() {
    lost = true;
    retireSessionOnce();
  }
  const onLoss = () => markLost();
  try {
    sessionOn('error', onLoss);
    sessionOn('end', onLoss);
  } catch {
    // Partial listener registration after the ownership claim: the
    // claim stands, the thrown error is sanitized (driver text never
    // escapes construction) and the exact session is retired exactly
    // once; retireSessionOnce preserves close uncertainty.
    retireSessionOnce();
    badInput('session listener registration failed');
  }

  // Serialize every unit of session work; a unit failing never wedges
  // the queue, and a unit that settles after retirement cannot publish.
  function serial(unit) {
    const run = tail.then(unit);
    tail = run.then(() => {}, () => {});
    return run;
  }
  function protocolFail() {
    markLost();
    throw new Error('settlement-authorization-store: protocol failure');
  }
  async function raw(text, values) {
    if (!accepting()) throw new Error('settlement-authorization-store: store is not accepting work');
    let res;
    try { res = await sessionQuery(text, values); } catch {
      markLost();
      throw new Error('settlement-authorization-store: session query failed; outcome unknown');
    }
    // Retirement or loss during the await: a late completion, however
    // affirmative, cannot publish past this point.
    if (!accepting()) throw new Error('settlement-authorization-store: outcome unknown');
    if (!isResultEnvelope(res)) protocolFail();
    return res;
  }
  // Transaction-control statements must complete with their own
  // affirmative command tag; PostgreSQL can complete an unsuccessful
  // COMMIT as ROLLBACK, which is never a durable acknowledgement.
  async function control(verb) {
    const res = await raw(verb, []);
    if (res.command !== verb) protocolFail();
    return res;
  }
  async function statement(text, values, command) {
    const res = await raw(text, values);
    if (res.command !== command) protocolFail();
    return res;
  }

  // One write transaction as ONE queue unit. body() returns a definite
  // outcome value, or { rollback: value } for a definite refusal that
  // must end in an affirmed ROLLBACK instead of a COMMIT. Any throw is
  // an unknown condition: the transaction state is unproven, the
  // session has already been retired by raw/control/protocolFail, and
  // the unit resolves unknown — the session is never reused.
  function writeUnit(body) {
    return serial(async () => {
      if (!accepting()) return UNKNOWN_WRITE;
      try {
        await control('BEGIN');
        const result = await body();
        if (result && result.rollback !== undefined) {
          await control('ROLLBACK');
          return accepting() ? result.rollback : UNKNOWN_WRITE;
        }
        await control('COMMIT');
        return accepting() ? result : UNKNOWN_WRITE;
      } catch {
        // ANY exception escaping the body — a validation throw
        // included — leaves the transaction state unproven: retire
        // the store and never reuse the session. (raw/control/
        // protocolFail already mark loss on their own paths; this is
        // the fence for exceptions raised by body code itself.)
        markLost();
        return UNKNOWN_WRITE;
      }
    });
  }

  // Validate and project one stored eligibility row. A present row with
  // a missing, mistyped or key-disagreeing field is a protocol failure,
  // never a readable record.
  function projectEligibilityRow(row, operationId, generation) {
    if (!isRecord(row)) protocolFail();
    // Row fields are captured exactly once, before validation, for
    // the same reason as caller inputs; a throwing accessor on a row
    // is a protocol failure (retire + unknown), never a raw escape.
    let rScope; let household; let opId; let genId; let confD; let secD; let issuedRaw;
    try {
      rScope = row.scope; household = row.household_id; opId = row.operation_id;
      genId = row.generation; confD = row.confirmation_digest; secD = row.secret_digest;
      issuedRaw = row.issued_at;
    } catch { protocolFail(); }
    const issuedAt = asTick(issuedRaw);
    if (rScope !== scope || !isPattern(HOUSEHOLD_RE, household)
      || opId !== operationId || genId !== generation
      || !isHash(confD) || !isHash(secD)
      || issuedAt === null) protocolFail();
    return Object.freeze({
      householdId: household, operationId, generation,
      confirmationDigest: confD, secretDigest: secD, issuedAt,
    });
  }
  function projectRevocationRow(row) {
    if (!isRecord(row) || asTick(row.revoked_at) === null) protocolFail();
  }

  function issueEligibility(input) {
    // Validate + snapshot synchronously at call time, before the queue.
    if (!isRecord(input) || !exactKeys(input,
      ['householdId', 'operationId', 'generation', 'confirmationDigest', 'secretDigest', 'issuedAt'])) {
      badInput('eligibility record shape is invalid');
    }
    const fields = captureFields(input,
      ['householdId', 'operationId', 'generation', 'confirmationDigest', 'secretDigest', 'issuedAt']);
    if (!isPattern(HOUSEHOLD_RE, fields.householdId)) badInput('householdId is malformed');
    if (!isPattern(OPERATION_RE, fields.operationId)) badInput('operationId is malformed');
    if (!isPattern(GENERATION_RE, fields.generation)) badInput('generation is malformed');
    if (!isHash(fields.confirmationDigest)) badInput('confirmationDigest is malformed');
    if (!isHash(fields.secretDigest)) badInput('secretDigest is malformed');
    if (!isTick(fields.issuedAt)) badInput('issuedAt is malformed');
    // The snapshot is built ONLY from the captured, validated values.
    const record = Object.freeze({ ...fields });
    return writeUnit(async () => {
      const found = await statement(SQL.eligibilityByKey,
        [scope, record.operationId, record.generation], 'SELECT');
      if (found.rows.length > 1) protocolFail();
      if (found.rows.length === 1) {
        const stored = projectEligibilityRow(found.rows[0], record.operationId, record.generation);
        const identical = stored.householdId === record.householdId
          && stored.confirmationDigest === record.confirmationDigest
          && stored.secretDigest === record.secretDigest
          && stored.issuedAt === record.issuedAt;
        // Identical issuance is established by this stored-record
        // comparison alone; a differing immutable field refuses.
        if (identical) return Object.freeze({ outcome: 'reissued-identical' });
        return { rollback: Object.freeze({ outcome: 'refused', reason: 'conflict' }) };
      }
      const inserted = await statement(SQL.insertEligibility,
        [scope, record.householdId, record.operationId, record.generation,
          record.confirmationDigest, record.secretDigest, record.issuedAt], 'INSERT');
      if (inserted.rowCount !== 1) protocolFail();
      return Object.freeze({ outcome: 'issued' });
    });
  }

  function appendRevocation(input) {
    if (!isRecord(input) || !exactKeys(input, ['operationId', 'generation', 'revokedAt'])) {
      badInput('revocation record shape is invalid');
    }
    const fields = captureFields(input, ['operationId', 'generation', 'revokedAt']);
    if (!isPattern(OPERATION_RE, fields.operationId)) badInput('operationId is malformed');
    if (!isPattern(GENERATION_RE, fields.generation)) badInput('generation is malformed');
    if (!isTick(fields.revokedAt)) badInput('revokedAt is malformed');
    const record = Object.freeze({ ...fields });
    return writeUnit(async () => {
      const found = await statement(SQL.revocationByKey,
        [scope, record.operationId, record.generation], 'SELECT');
      if (found.rows.length > 1) protocolFail();
      if (found.rows.length === 1) {
        projectRevocationRow(found.rows[0]);
        // The durable fact already exists; the stored record is never
        // overwritten, whatever timestamp this attempt supplied.
        return { rollback: Object.freeze({ outcome: 'already-present' }) };
      }
      const inserted = await statement(SQL.insertRevocation,
        [scope, record.operationId, record.generation, record.revokedAt], 'INSERT');
      if (inserted.rowCount !== 1) protocolFail();
      return Object.freeze({ outcome: 'appended' });
    });
  }

  function appendSessionRevocation(input) {
    if (!isRecord(input) || !exactKeys(input, ['sidDigest', 'revokedAt'])) {
      badInput('session revocation record shape is invalid');
    }
    const fields = captureFields(input, ['sidDigest', 'revokedAt']);
    if (!isHash(fields.sidDigest)) badInput('sidDigest is malformed');
    if (!isTick(fields.revokedAt)) badInput('revokedAt is malformed');
    const record = Object.freeze({ ...fields });
    return writeUnit(async () => {
      const found = await statement(SQL.sessionRevocationByKey,
        [scope, record.sidDigest], 'SELECT');
      if (found.rows.length > 1) protocolFail();
      if (found.rows.length === 1) {
        projectRevocationRow(found.rows[0]);
        return { rollback: Object.freeze({ outcome: 'already-present' }) };
      }
      const inserted = await statement(SQL.insertSessionRevocation,
        [scope, record.sidDigest, record.revokedAt], 'INSERT');
      if (inserted.rowCount !== 1) protocolFail();
      return Object.freeze({ outcome: 'appended' });
    });
  }

  function readAuthorizationState(input) {
    if (!isRecord(input) || !exactKeys(input, ['operationId', 'generation', 'sidDigest'])) {
      badInput('read input shape is invalid');
    }
    const fields = captureFields(input, ['operationId', 'generation', 'sidDigest']);
    if (!isPattern(OPERATION_RE, fields.operationId)) badInput('operationId is malformed');
    if (!isPattern(GENERATION_RE, fields.generation)) badInput('generation is malformed');
    if (!isHash(fields.sidDigest)) badInput('sidDigest is malformed');
    const key = Object.freeze({ ...fields });
    return serial(async () => {
      if (!accepting()) return UNKNOWN_READ;
      try {
        // Exactly ONE read-only statement; no transaction control, no
        // write, no second probe. Its snapshot is the read.
        const res = await statement(SQL.readState,
          [scope, key.operationId, key.generation, key.sidDigest], 'SELECT');
        if (res.rows.length !== 1) protocolFail();
        const row = res.rows[0];
        // Completeness: EVERY selected field must be present, and
        // proven absence requires ALL SIX eligibility columns to be
        // actual SQL null. A missing column, an undefined value, or a
        // mixed null/non-null row is malformed — never absence: the
        // read resolves unknown and the store retires (protocolFail).
        if (!isRecord(row)) protocolFail();
        // Every selected field is captured exactly once, after the
        // presence check and before any validation or use.
        const captured = {};
        for (const column of [...READ_ELIGIBILITY_COLUMNS, 'operation_revoked', 'session_revoked']) {
          if (!Object.hasOwn(row, column)) protocolFail();
          captured[column] = row[column];
        }
        if (typeof captured.operation_revoked !== 'boolean'
          || typeof captured.session_revoked !== 'boolean') protocolFail();
        const nullColumns = READ_ELIGIBILITY_COLUMNS.filter(c => captured[c] === null).length;
        let eligibility = null;
        if (nullColumns === 0) {
          eligibility = projectEligibilityRow({
            scope, household_id: captured.household_id, operation_id: captured.operation_id,
            generation: captured.generation, confirmation_digest: captured.confirmation_digest,
            secret_digest: captured.secret_digest, issued_at: captured.issued_at,
          }, key.operationId, key.generation);
        } else if (nullColumns !== READ_ELIGIBILITY_COLUMNS.length) {
          protocolFail(); // mixed null/non-null: not proven absence
        }
        if (!accepting()) return UNKNOWN_READ;
        return Object.freeze({
          state: 'ok', eligibility,
          operationRevoked: captured.operation_revoked, sessionRevoked: captured.session_revoked,
        });
      } catch {
        // Same fence as the write path: any exception here — a
        // validation throw included — retires the store.
        markLost();
        return UNKNOWN_READ;
      }
    });
  }

  function frontierDigest(incarnation, entries) {
    const chunks = [
      frameText('atlas-auth-frontier'), frameText(FRONTIER_ENCODING_VERSION),
      frameText(schema), frameText(scope), frameHash(incarnation), u64beNonNeg(entries.length),
    ];
    if (chunks.some(c => c == null)) protocolFail();
    return crypto.createHash('sha256').update(Buffer.concat(chunks.concat(entries))).digest('hex');
  }

  // One statement's revocation rows → the canonical frontier. A hole,
  // a duplicate key, or a malformed field is a protocol failure, never
  // a shorter set and never a digest over a guessed empty set.
  function projectRevocationSet(row, incarnation) {
    if (!isRecord(row) || !isHash(incarnation)) protocolFail();
    if (!Object.hasOwn(row, 'frontier_operation_revocations')
      || !Object.hasOwn(row, 'frontier_session_revocations')) protocolFail();
    let opRaw; let sesRaw;
    try {
      opRaw = row.frontier_operation_revocations;
      sesRaw = row.frontier_session_revocations;
    } catch { protocolFail(); }
    const ops = asJsonArray(opRaw);
    const sessions = asJsonArray(sesRaw);
    if (!ops || !sessions) protocolFail();
    const seenOp = new Set();
    const seenSes = new Set();
    const encoded = [];
    for (const tuple of ops) {
      const fields = captureTuple(tuple, 3);
      if (!fields) protocolFail();
      const revokedAt = asTick(fields[2]);
      if (!isPattern(OPERATION_RE, fields[0]) || !isPattern(GENERATION_RE, fields[1]) || revokedAt === null) {
        protocolFail();
      }
      const key = fields[0] + '\0' + fields[1];
      if (seenOp.has(key)) protocolFail();
      seenOp.add(key);
      const entry = encodeOperationEntry(fields[0], fields[1], revokedAt);
      if (!entry) protocolFail();
      encoded.push(entry);
    }
    for (const tuple of sessions) {
      const fields = captureTuple(tuple, 2);
      if (!fields) protocolFail();
      const revokedAt = asTick(fields[1]);
      if (!isHash(fields[0]) || revokedAt === null) protocolFail();
      if (seenSes.has(fields[0])) protocolFail();
      seenSes.add(fields[0]);
      const entry = encodeSessionEntry(fields[0], revokedAt);
      if (!entry) protocolFail();
      encoded.push(entry);
    }
    encoded.sort((a, b) => Buffer.compare(a, b));
    for (let i = 1; i < encoded.length; i++) {
      if (Buffer.compare(encoded[i - 1], encoded[i]) === 0) protocolFail();
    }
    const entries = Object.freeze(encoded.map(entry => Buffer.from(entry)));
    return Object.freeze({
      count: entries.length,
      encodingVersion: FRONTIER_ENCODING_VERSION,
      schema, scope, incarnation, entries,
      frontierDigest: frontierDigest(incarnation, entries),
    });
  }

  function projectCombinedFacts(row, key) {
    if (!isRecord(row)) protocolFail();
    const captured = {};
    for (const column of [...READ_ELIGIBILITY_COLUMNS, 'operation_revoked', 'session_revoked']) {
      if (!Object.hasOwn(row, column)) protocolFail();
      captured[column] = row[column];
    }
    if (typeof captured.operation_revoked !== 'boolean'
      || typeof captured.session_revoked !== 'boolean') protocolFail();
    const nullColumns = READ_ELIGIBILITY_COLUMNS.filter(c => captured[c] === null).length;
    let eligibility = null;
    if (nullColumns === 0) {
      eligibility = projectEligibilityRow({
        scope, household_id: captured.household_id, operation_id: captured.operation_id,
        generation: captured.generation, confirmation_digest: captured.confirmation_digest,
        secret_digest: captured.secret_digest, issued_at: captured.issued_at,
      }, key.operationId, key.generation);
    } else if (nullColumns !== READ_ELIGIBILITY_COLUMNS.length) {
      protocolFail();
    }
    return {
      eligibility,
      operationRevoked: captured.operation_revoked,
      sessionRevoked: captured.session_revoked,
    };
  }

  function readCombinedSnapshot(input) {
    if (!isRecord(input) || !exactKeys(input,
      ['operationId', 'generation', 'sidDigest', 'incarnation'])) {
      badInput('read input shape is invalid');
    }
    const fields = captureFields(input, ['operationId', 'generation', 'sidDigest', 'incarnation']);
    if (!isPattern(OPERATION_RE, fields.operationId)) badInput('operationId is malformed');
    if (!isPattern(GENERATION_RE, fields.generation)) badInput('generation is malformed');
    if (!isHash(fields.sidDigest)) badInput('sidDigest is malformed');
    if (!isHash(fields.incarnation)) badInput('incarnation is malformed');
    const key = Object.freeze({ ...fields });
    return serial(async () => {
      if (!accepting()) return UNKNOWN_READ;
      try {
        const res = await statement(SQL.readCombined,
          [scope, key.operationId, key.generation, key.sidDigest], 'SELECT');
        if (res.rows.length !== 1) protocolFail();
        const facts = projectCombinedFacts(res.rows[0], key);
        const frontier = projectRevocationSet(res.rows[0], key.incarnation);
        if (!accepting()) return UNKNOWN_READ;
        return Object.freeze({
          state: 'ok',
          eligibility: facts.eligibility,
          operationRevoked: facts.operationRevoked,
          sessionRevoked: facts.sessionRevoked,
          frontier,
        });
      } catch {
        markLost();
        return UNKNOWN_READ;
      }
    });
  }

  // Frontier-only and the canonical-set read are the two protocol
  // surfaces (advance, reconciliation). Both execute this one
  // revocation-set statement and return the same frontier object, so
  // the set and the digest cannot drift apart.
  function readRevocationFrontier(input) {
    if (!isRecord(input) || !exactKeys(input, ['incarnation'])) {
      badInput('read input shape is invalid');
    }
    const fields = captureFields(input, ['incarnation']);
    if (!isHash(fields.incarnation)) badInput('incarnation is malformed');
    const incarnation = fields.incarnation;
    return serial(async () => {
      if (!accepting()) return UNKNOWN_READ;
      try {
        const res = await statement(SQL.readRevocationSet, [scope], 'SELECT');
        if (res.rows.length !== 1) protocolFail();
        const frontier = projectRevocationSet(res.rows[0], incarnation);
        if (!accepting()) return UNKNOWN_READ;
        return Object.freeze({ state: 'ok', frontier });
      } catch {
        markLost();
        return UNKNOWN_READ;
      }
    });
  }

  function retire() {
    // Closes admission synchronously; idempotent; the exact session is
    // retired at most once across loss and retire().
    closed = true;
    retireSessionOnce();
    return Promise.resolve(Object.freeze({ retired: true, accepting: false }));
  }
  function status() {
    return Object.freeze({ retired: closed || sessionRetired, accepting: accepting() });
  }

  const api = {
    issueEligibility, appendRevocation, appendSessionRevocation,
    readAuthorizationState, retire, status,
  };
  // Not enumerable: the connection suite pins Object.keys of this
  // object, and that suite is outside S2's file boundary. The methods
  // are still own, frozen, and called by name.
  for (const [name, fn] of [
    ['readCombinedSnapshot', readCombinedSnapshot],
    ['readAuthorizationFrontier', readRevocationFrontier],
    ['readCanonicalRevocationSet', readRevocationFrontier],
  ]) {
    Object.defineProperty(api, name, {
      value: fn, writable: false, enumerable: false, configurable: false,
    });
  }
  return Object.freeze(api);
}

module.exports = { createAuthorizationStore, RELATION_CONTRACT };
