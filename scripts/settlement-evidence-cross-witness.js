'use strict';

// Cross-witness: an append-only anchor-observation log in the
// authorization database's restore domain (anchor/epoch design §2.3.5).
//
// FOUNDATION ONLY, DEFAULT DISCONNECTED. No production importer, no
// driver import, no environment reads, no credentials, no DDL, no
// network. A caller injects ONE already-connected dedicated session
// (query, on('error'|'end'), retire()) plus the witness schema. This
// module does not extend the authorization store's three-relation
// contract and does not share that store's session.
//
// One relation, INSERT/SELECT only. One row per observation
// { scope, incarnation, epoch, frontierDigest, recordHash, eventId,
//   observedAt }, written at genesis (epoch 0) and after every acked
//   authorization-anchor advance. The head read for a scope is the
//   lineage high-watermark: the greatest (incarnation, epoch) witnessed.
//
// Unknown-on-uncertainty: a rejected query, a malformed envelope, or
// the session's error/end event retires the store. Durable success is
// reported only after COMMIT. A byte-identical observation is
// already-present. A same-key observation with different bytes is a
// definite refusal — the row is never updated.

const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

const RELATION_CONTRACT = Object.freeze({
  note: 'descriptive only; not provisioned; no existing schema is claimed to match',
  session: 'one dedicated session per witness store; never the authorization store session and never the financial writer',
  relations: Object.freeze({
    auth_anchor_observation: Object.freeze({
      columns: 'scope text, incarnation text, epoch bigint, frontier_digest text, record_hash text, event_id text, observed_at bigint, primary key (scope, incarnation, epoch)',
      grants: 'SELECT, INSERT',
    }),
  }),
});

const UNKNOWN_WRITE = Object.freeze({ outcome: 'unknown' });
const UNKNOWN_READ = Object.freeze({ state: 'unknown' });
const CLAIMED = new WeakSet();

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function isHash(value) { return typeof value === 'string' && HASH_RE.test(value); }
function isPattern(re, value) { return typeof value === 'string' && re.test(value); }
function isTick(value) { return Number.isSafeInteger(value) && value > 0; }
function isEpoch(value) { return Number.isSafeInteger(value) && value >= 0; }
function badInput(detail) {
  throw new TypeError('settlement-cross-witness: ' + detail);
}
function exactKeys(value, keys) {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(k => Object.hasOwn(value, k));
}
function captureFields(input, keys) {
  const out = {};
  try {
    for (const k of keys) out[k] = input[k];
  } catch {
    badInput('input properties could not be read');
  }
  return out;
}
function asCount(value) {
  if (typeof value === 'bigint') return null;
  if (typeof value === 'number') return isEpoch(value) ? value : null;
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    const n = Number(value);
    if (isEpoch(n) && String(n) === value) return n;
  }
  return null;
}
function asTick(value) {
  const n = asCount(value);
  return n !== null && n > 0 ? n : null;
}
function isResultEnvelope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.rows);
}
function laterObservation(a, b) {
  if (a.incarnation !== b.incarnation) return a.incarnation > b.incarnation ? a : b;
  return a.epoch >= b.epoch ? a : b;
}

function createSettlementEvidenceCrossWitness(options) {
  if (!isRecord(options)) badInput('options are required');
  const { session, schema } = options;
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
  if (CLAIMED.has(session)) badInput('session is already owned by another cross-witness store');
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema)
    || schema.startsWith('pg_') || schema === 'information_schema') {
    badInput('schema identifier is invalid');
  }
  if (!exactKeys(options, ['schema', 'session'])) badInput('options shape is invalid');

  const table = '"' + schema + '".auth_anchor_observation';
  const SQL = Object.freeze({
    byKey: 'SELECT scope, incarnation, epoch, frontier_digest, record_hash, event_id, observed_at FROM '
      + table + ' WHERE scope = $1 AND incarnation = $2 AND epoch = $3',
    byScope: 'SELECT scope, incarnation, epoch, frontier_digest, record_hash, event_id, observed_at FROM '
      + table + ' WHERE scope = $1',
    insert: 'INSERT INTO ' + table
      + ' (scope, incarnation, epoch, frontier_digest, record_hash, event_id, observed_at)'
      + ' VALUES ($1, $2, $3, $4, $5, $6, $7)',
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
  try {
    sessionOn('error', markLost);
    sessionOn('end', markLost);
  } catch {
    retireSessionOnce();
    badInput('session listener registration failed');
  }

  function serial(unit) {
    const run = tail.then(unit);
    tail = run.then(() => {}, () => {});
    return run;
  }
  function protocolFail() {
    markLost();
    throw new Error('settlement-cross-witness: protocol failure');
  }
  async function raw(text, values) {
    if (!accepting()) throw new Error('settlement-cross-witness: store is not accepting work');
    let res;
    try { res = await sessionQuery(text, values); } catch {
      markLost();
      throw new Error('settlement-cross-witness: session query failed; outcome unknown');
    }
    if (!accepting()) throw new Error('settlement-cross-witness: outcome unknown');
    if (!isResultEnvelope(res)) protocolFail();
    return res;
  }
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
        markLost();
        return UNKNOWN_WRITE;
      }
    });
  }

  const OBSERVATION_KEYS = Object.freeze([
    'scope', 'incarnation', 'epoch', 'frontierDigest', 'recordHash', 'eventId', 'observedAt',
  ]);
  function captureObservation(input) {
    if (!isRecord(input) || !exactKeys(input, OBSERVATION_KEYS)) {
      badInput('observation shape is invalid');
    }
    const fields = captureFields(input, OBSERVATION_KEYS);
    if (!isPattern(SCOPE_RE, fields.scope)) badInput('scope is malformed');
    if (!isHash(fields.incarnation)) badInput('incarnation is malformed');
    if (!isEpoch(fields.epoch)) badInput('epoch is malformed');
    if (!isHash(fields.frontierDigest)) badInput('frontierDigest is malformed');
    if (!isHash(fields.recordHash)) badInput('recordHash is malformed');
    if (!isHash(fields.eventId)) badInput('eventId is malformed');
    if (!isTick(fields.observedAt)) badInput('observedAt is malformed');
    return Object.freeze({ ...fields });
  }
  function projectRow(row) {
    if (!isRecord(row)) protocolFail();
    let scope; let incarnation; let epochRaw; let frontier; let recordHash; let eventId; let observedRaw;
    try {
      scope = row.scope; incarnation = row.incarnation; epochRaw = row.epoch;
      frontier = row.frontier_digest; recordHash = row.record_hash;
      eventId = row.event_id; observedRaw = row.observed_at;
    } catch { protocolFail(); }
    const epoch = asCount(epochRaw);
    const observedAt = asTick(observedRaw);
    if (!isPattern(SCOPE_RE, scope) || !isHash(incarnation) || epoch === null
      || !isHash(frontier) || !isHash(recordHash) || !isHash(eventId) || observedAt === null) {
      protocolFail();
    }
    return Object.freeze({
      scope, incarnation, epoch, frontierDigest: frontier, recordHash, eventId, observedAt,
    });
  }
  function sameObservation(stored, wanted) {
    return stored.scope === wanted.scope && stored.incarnation === wanted.incarnation
      && stored.epoch === wanted.epoch && stored.frontierDigest === wanted.frontierDigest
      && stored.recordHash === wanted.recordHash && stored.eventId === wanted.eventId
      && stored.observedAt === wanted.observedAt;
  }

  function appendObservation(input) {
    const record = captureObservation(input);
    return writeUnit(async () => {
      const found = await statement(SQL.byKey, [record.scope, record.incarnation, record.epoch], 'SELECT');
      if (found.rows.length > 1) protocolFail();
      if (found.rows.length === 1) {
        const stored = projectRow(found.rows[0]);
        if (stored.scope !== record.scope) protocolFail();
        if (sameObservation(stored, record)) {
          return { rollback: Object.freeze({ outcome: 'already-present' }) };
        }
        return { rollback: Object.freeze({ outcome: 'refused', reason: 'observation-conflict' }) };
      }
      const inserted = await statement(SQL.insert, [
        record.scope, record.incarnation, record.epoch, record.frontierDigest,
        record.recordHash, record.eventId, record.observedAt,
      ], 'INSERT');
      if (inserted.rowCount !== 1) protocolFail();
      return Object.freeze({ outcome: 'appended' });
    });
  }

  function readScope(input, project) {
    if (!isRecord(input) || !exactKeys(input, ['scope'])) badInput('read input shape is invalid');
    const fields = captureFields(input, ['scope']);
    if (!isPattern(SCOPE_RE, fields.scope)) badInput('scope is malformed');
    const scope = fields.scope;
    return serial(async () => {
      if (!accepting()) return UNKNOWN_READ;
      try {
        const res = await statement(SQL.byScope, [scope], 'SELECT');
        const observations = [];
        for (const row of res.rows) {
          const projected = projectRow(row);
          if (projected.scope !== scope) protocolFail();
          observations.push(projected);
        }
        if (!accepting()) return UNKNOWN_READ;
        return project(observations);
      } catch {
        markLost();
        return UNKNOWN_READ;
      }
    });
  }

  function listObservations(input) {
    return readScope(input, observations => Object.freeze({
      state: 'ok', observations: Object.freeze(observations),
    }));
  }
  function readHead(input) {
    return readScope(input, observations => {
      let head = null;
      for (const observation of observations) head = head ? laterObservation(head, observation) : observation;
      return Object.freeze({ state: 'ok', head });
    });
  }
  function retire() {
    closed = true;
    retireSessionOnce();
    return Promise.resolve(Object.freeze({ retired: true, accepting: false }));
  }
  function status() {
    return Object.freeze({ retired: closed || sessionRetired, accepting: accepting() });
  }

  return Object.freeze({
    appendObservation, readHead, listObservations, retire, status,
  });
}

module.exports = { createSettlementEvidenceCrossWitness, RELATION_CONTRACT };
