'use strict';

// Settlement evidence MAINTENANCE INSTALL / READBACK foundation (ATLAS-080).
//
// DISCONNECTED. No production importer, route, driver, connection, env read,
// credential, provisioning, grant or DDL. It imports no adapter, runtime,
// connection, authorization or store module. A caller injects ONE separate,
// dedicated maintenance session per call (node-postgres-shaped:
// query(text, values), on('error'|'end', fn), retire()), never the app
// adapter's client or queue. Each session is claimed once and is always
// retired at the end of the call (one-shot); there is no reconnect and no
// retry.
//
// installRestoreCandidate: validates the owned candidate bytes with the #707
// exact-anchor validator, takes the SAME advisory key the PostgreSQL adapter
// derives (sha256(schema \0 scope), two int4), and in ONE transaction
// quarantines every present incumbent artifact (head, staged, journal,
// history, checkpoint; corrupt-but-bounded included, raw bytes, one row each)
// before replacing head + terminal history/checkpoint and clearing scoped
// staged/journal. An affirmed COMMIT means 'installed-unverified' ONLY: it is
// never restore or reopen success. A COMMIT whose acknowledgement is missing,
// malformed or lost is 'unknown' (no automatic retry). Any failure before
// COMMIT dispatch is 'refused' (nothing committed; the session is retired
// rather than reused when its state is unproven).
//
// verifyRestoreInstall: read-only readback over a FRESH supplied session under
// the same lock: exact pair/checkpoint bytes, no staged/journal residue, the
// #707 validator over the READBACK bytes against the same trusted anchors, and
// agreement with an independently supplied pin. 'verified' is not reopen
// authority.
//
// Non-claims: anchor provenance/latestness are trusted maintenance input;
// confirmed application quiescence and restart inhibition are EXTERNAL
// prerequisites this module cannot establish. It never calls TC.qualifySnapshot
// or TC.registerDomain (no rollback-floor mutation), sets no pin, creates no
// hold table, invalidates no session, and performs no release/reopen. SQL
// doubles in its tests qualify protocol only, not PostgreSQL behaviour, grants
// or provisioning. Technical privilege needs (descriptive, not granted here):
// SELECT on head/staged/journal/terminal_history/quarantine; INSERT/UPDATE
// head and terminal_history; DELETE staged and journal; INSERT quarantine;
// pg_try_advisory_lock(int4,int4) and pg_backend_pid(). No head/history DELETE.

const crypto = require('node:crypto');
const { validateRestoreInput } = require('./settlement-evidence-restore-input');

const LEDGER_MAX_BYTES = 2 * 1024 * 1024; // adapter DOCUMENT_MAX_BYTES
const HISTORY_MAX_BYTES = 4 * 1024 * 1024; // adapter RECORD_MAX_BYTES / #707 bound
const CHECKPOINT_MAX_BYTES = 2048; // adapter CHECKPOINT_MAX_BYTES
const QUARANTINE_MAX_BYTES = 4 * 1024 * 1024; // existing quarantine record limit
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/; // identical to the adapter
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/; // identical to the adapter
const PIN_RE = /^[a-f0-9]{64}$/;
const QUARANTINE_LABELS = Object.freeze({
  head: 'restore-incumbent-head', staged: 'restore-incumbent-staged', journal: 'restore-incumbent-journal',
  history: 'restore-incumbent-history', checkpoint: 'restore-incumbent-checkpoint',
});
const INSTALL_REASONS = Object.freeze(['input-malformed', 'session-invalid', 'session-already-claimed',
  'candidate-oversize', 'candidate-invalid', 'lock-held', 'backend-changed', 'incumbent-unbounded',
  'quarantine-collision', 'aborted-before-commit', 'commit-unknown', 'session-lost', 'protocol-malformed']);
const VERIFY_REASONS = Object.freeze(['input-malformed', 'session-invalid', 'session-already-claimed',
  'candidate-oversize', 'candidate-invalid', 'lock-held', 'backend-changed', 'head-missing', 'head-mismatch',
  'history-missing', 'history-mismatch', 'checkpoint-mismatch', 'staged-residue', 'journal-residue',
  'readback-invalid', 'pin-mismatch', 'session-lost', 'protocol-malformed']);

const CLAIMED = new WeakSet(); // maintenance sessions already handed to this module

class Stop { constructor(status, reason) { this.status = status; this.reason = reason; } }
const stop = (status, reason) => { throw new Stop(status, reason); };

// Exactly the named own enumerable DATA properties of a plain object;
// accessors are refused and never invoked.
function fieldsOf(value, names) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) stop('refused', 'input-malformed');
  const own = Reflect.ownKeys(value);
  if (own.length !== names.length || !names.every(n => own.includes(n))) stop('refused', 'input-malformed');
  const out = {};
  for (const n of names) {
    const d = Object.getOwnPropertyDescriptor(value, n);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) stop('refused', 'input-malformed');
    out[n] = d.value;
  }
  return out;
}
const TA = Object.getPrototypeOf(Uint8Array.prototype);
const TAG = Object.getOwnPropertyDescriptor(TA, Symbol.toStringTag).get;
const BUF = Object.getOwnPropertyDescriptor(TA, 'buffer').get;
const OFF = Object.getOwnPropertyDescriptor(TA, 'byteOffset').get;
const LEN = Object.getOwnPropertyDescriptor(TA, 'byteLength').get;
function ownBytes(value, max) {
  if (value === null || typeof value !== 'object' || Reflect.apply(TAG, value, []) !== 'Uint8Array') stop('refused', 'input-malformed');
  const length = Reflect.apply(LEN, value, []);
  if (length > max) stop('refused', 'candidate-oversize');
  const out = Buffer.alloc(length);
  Reflect.apply(TA.set, out, [new Uint8Array(Reflect.apply(BUF, value, []), Reflect.apply(OFF, value, []), length)]);
  return out;
}

// Owns every input synchronously, before any await.
function own(input, withPin) {
  const top = fieldsOf(input, withPin ? ['session', 'schema', 'scope', 'domain', 'anchors', 'candidate', 'pin']
    : ['session', 'schema', 'scope', 'domain', 'anchors', 'candidate']);
  const { session, schema, scope } = top;
  if (typeof schema !== 'string' || !SCHEMA_RE.test(schema) || schema.startsWith('pg_')
    || schema === 'information_schema' || typeof scope !== 'string' || !SCOPE_RE.test(scope)) stop('refused', 'input-malformed');
  if (withPin && (typeof top.pin !== 'string' || !PIN_RE.test(top.pin))) stop('refused', 'input-malformed');
  if (session === null || typeof session !== 'object') stop('refused', 'session-invalid');
  const query = session.query, on = session.on, retire = session.retire;
  if (typeof query !== 'function' || typeof on !== 'function' || typeof retire !== 'function') stop('refused', 'session-invalid');
  if (CLAIMED.has(session)) stop('refused', 'session-already-claimed');
  const domain = fieldsOf(top.domain, ['householdId', 'ledgerNamespace']);
  const anchors = fieldsOf(top.anchors, ['ledger', 'history']);
  const ledgerAnchor = fieldsOf(anchors.ledger, ['revision', 'documentDigest']);
  const historyAnchor = fieldsOf(anchors.history, ['schema', 'householdId', 'ledgerNamespace', 'revision', 'digest']);
  const candidate = fieldsOf(top.candidate, ['ledgerBytes', 'historyBytes']);
  const ledgerBytes = ownBytes(candidate.ledgerBytes, LEDGER_MAX_BYTES);
  const historyBytes = ownBytes(candidate.historyBytes, HISTORY_MAX_BYTES);
  const verdict = validateRestoreInput(validatorInput(domain, ledgerAnchor, historyAnchor, ledgerBytes, historyBytes));
  if (verdict.status !== 'valid') stop('refused', 'candidate-invalid');
  // Deterministic trusted-anchor checkpoint (anchor equality already enforced by the validator).
  const checkpointBytes = Buffer.from(JSON.stringify({ schema: historyAnchor.schema, householdId: historyAnchor.householdId,
    ledgerNamespace: historyAnchor.ledgerNamespace, revision: historyAnchor.revision, digest: historyAnchor.digest }));
  if (checkpointBytes.length > CHECKPOINT_MAX_BYTES) stop('refused', 'candidate-oversize');
  CLAIMED.add(session);
  const digest = crypto.createHash('sha256').update(schema + '\0' + scope).digest();
  return {
    session, query, on, retire, scope, pin: withPin ? top.pin : undefined,
    T: tables(schema), lockKeys: [digest.readInt32BE(0), digest.readInt32BE(4)],
    domain: { ...domain }, ledgerAnchor: { ...ledgerAnchor }, historyAnchor: { ...historyAnchor },
    ledgerBytes, historyBytes, checkpointBytes, verdict,
  };
}
function validatorInput(domain, ledgerAnchor, historyAnchor, ledgerBytes, historyBytes) {
  return { domain: { ...domain }, anchors: { ledger: { ...ledgerAnchor }, history: { ...historyAnchor } },
    candidate: { ledgerBytes: Buffer.from(ledgerBytes), historyBytes: Buffer.from(historyBytes) } };
}
function tables(schema) {
  const q = '"' + schema + '"';
  return { head: q + '.doc_head', staged: q + '.doc_staged', journal: q + '.journal',
    terminal: q + '.terminal_history', quarantine: q + '.quarantine' };
}

// One-shot session wrapper: loss events, envelope checks, single retirement.
function channel(s) {
  let lost = false, retired = false;
  const retireOnce = () => {
    if (retired) return; retired = true;
    try { Promise.resolve(Reflect.apply(s.retire, s.session, [])).catch(() => {}); } catch { /* retired anyway */ }
  };
  const onLoss = () => { lost = true; };
  try { Reflect.apply(s.on, s.session, ['error', onLoss]); Reflect.apply(s.on, s.session, ['end', onLoss]); }
  catch { lost = true; }
  async function sql(text, values, uncertain) {
    if (lost) stop(uncertain, 'session-lost');
    let res;
    try { res = await Reflect.apply(s.query, s.session, [text, values]); } catch { lost = true; stop(uncertain, 'session-lost'); }
    if (lost) stop(uncertain, 'session-lost');
    if (res === null || typeof res !== 'object' || Array.isArray(res) || !Array.isArray(res.rows)) {
      lost = true; stop(uncertain, 'protocol-malformed');
    }
    return res;
  }
  return { sql, retireOnce, isLost: () => lost, markLost: () => { lost = true; } };
}
const affirmed = (res, tag) => res.command === tag && res.rows.length === 0;
function count(res, tag, n) {
  return res.command === tag && res.rows.length === 0 && res.rowCount === n;
}

async function acquire(c, s, uncertain) {
  const got = await c.sql('SELECT pg_try_advisory_lock($1, $2) AS locked', s.lockKeys, uncertain);
  if (got.rows.length !== 1 || typeof got.rows[0].locked !== 'boolean') { c.markLost(); stop(uncertain, 'protocol-malformed'); }
  if (got.rows[0].locked === false) stop('refused', 'lock-held');
  const p = await c.sql('SELECT pg_backend_pid() AS pid', [], uncertain);
  if (p.rows.length !== 1 || !Number.isSafeInteger(p.rows[0].pid) || p.rows[0].pid <= 0) { c.markLost(); stop(uncertain, 'protocol-malformed'); }
  return p.rows[0].pid;
}
async function samePid(c, pid, uncertain) {
  const p = await c.sql('SELECT pg_backend_pid() AS pid', [], uncertain);
  if (p.rows.length !== 1 || p.rows[0].pid !== pid) { c.markLost(); stop(uncertain, 'backend-changed'); }
}
// Bounded incumbent read: null when absent; a bytes value over `max` is
// reported as oversize (never truncated); a non-bytes column is malformed.
async function readOne(c, text, scope, columns, uncertain) {
  const r = await c.sql(text, [scope], uncertain);
  if (r.command !== 'SELECT' || r.rows.length > 1) { c.markLost(); stop(uncertain, 'protocol-malformed'); }
  if (r.rows.length === 0) return null;
  const row = r.rows[0], out = {};
  for (const col of columns) {
    if (!row || !Buffer.isBuffer(row[col])) { c.markLost(); stop(uncertain, 'protocol-malformed'); }
    out[col] = Buffer.from(row[col]);
  }
  return out;
}

const deepFreeze = x => { if (x && typeof x === 'object') { for (const v of Object.values(x)) deepFreeze(v); Object.freeze(x); } return x; };
function settle(error, reasons) {
  const st = error instanceof Stop ? error : new Stop('refused', 'input-malformed');
  return Object.freeze({ status: st.status, reason: reasons.includes(st.reason) ? st.reason : 'protocol-malformed' });
}

async function installRestoreCandidate(input) {
  let s;
  try { s = own(input, false); } catch (e) { return settle(e, INSTALL_REASONS); }
  const c = channel(s);
  let commitDispatched = false;
  let began = false;
  try {
    // Before COMMIT dispatch nothing can be durable: any failure is 'refused'.
    const pre = 'refused';
    const pid = await acquire(c, s, pre);
    const b = await c.sql('BEGIN', [], pre);
    if (!affirmed(b, 'BEGIN')) { c.markLost(); stop(pre, 'protocol-malformed'); }
    began = true;
    await samePid(c, pid, pre);
    const head = await readOne(c, 'SELECT bytes FROM ' + s.T.head + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], pre);
    const staged = await readOne(c, 'SELECT bytes FROM ' + s.T.staged + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], pre);
    const journal = await readOne(c, 'SELECT bytes FROM ' + s.T.journal + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], pre);
    const terminal = await readOne(c, 'SELECT history_bytes, checkpoint_bytes FROM ' + s.T.terminal + ' WHERE scope = $1 LIMIT 2',
      s.scope, ['history_bytes', 'checkpoint_bytes'], pre);
    const evidence = [];
    if (head) evidence.push(['head', head.bytes]);
    if (staged) evidence.push(['staged', staged.bytes]);
    if (journal) evidence.push(['journal', journal.bytes]);
    if (terminal) evidence.push(['history', terminal.history_bytes], ['checkpoint', terminal.checkpoint_bytes]);
    // Existing quarantine record limit; raw bytes, never base64-expanded.
    if (evidence.some(([, bytes]) => bytes.length > QUARANTINE_MAX_BYTES)) stop(pre, 'incumbent-unbounded');
    const quarantined = [];
    for (const [kind, bytes] of evidence) {
      const label = QUARANTINE_LABELS[kind];
      const name = label + '-' + crypto.randomBytes(16).toString('hex');
      const seen = await c.sql('SELECT 1 AS present FROM ' + s.T.quarantine + ' WHERE scope = $1 AND name = $2', [s.scope, name], pre);
      if (seen.command !== 'SELECT' || seen.rows.length > 1) { c.markLost(); stop(pre, 'protocol-malformed'); }
      if (seen.rows.length === 1) stop(pre, 'quarantine-collision');
      const ins = await c.sql('INSERT INTO ' + s.T.quarantine + ' (scope, name, label, bytes) VALUES ($1, $2, $3, $4)',
        [s.scope, name, label, bytes], pre);
      if (!count(ins, 'INSERT', 1)) { c.markLost(); stop(pre, 'protocol-malformed'); }
      quarantined.push({ kind, label, name, byteLength: bytes.length });
    }
    const h = await c.sql('INSERT INTO ' + s.T.head + ' (scope, bytes) VALUES ($1, $2)'
      + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes', [s.scope, s.ledgerBytes], pre);
    if (!count(h, 'INSERT', 1)) { c.markLost(); stop(pre, 'protocol-malformed'); }
    const t = terminal
      ? await c.sql('UPDATE ' + s.T.terminal + ' SET history_bytes = $2, checkpoint_bytes = $3 WHERE scope = $1',
        [s.scope, s.historyBytes, s.checkpointBytes], pre)
      : await c.sql('INSERT INTO ' + s.T.terminal + ' (scope, history_bytes, checkpoint_bytes) VALUES ($1, $2, $3)',
        [s.scope, s.historyBytes, s.checkpointBytes], pre);
    if (!count(t, terminal ? 'UPDATE' : 'INSERT', 1)) { c.markLost(); stop(pre, 'protocol-malformed'); }
    const ds = await c.sql('DELETE FROM ' + s.T.staged + ' WHERE scope = $1', [s.scope], pre);
    if (!count(ds, 'DELETE', staged ? 1 : 0)) { c.markLost(); stop(pre, 'protocol-malformed'); }
    const dj = await c.sql('DELETE FROM ' + s.T.journal + ' WHERE scope = $1', [s.scope], pre);
    if (!count(dj, 'DELETE', journal ? 1 : 0)) { c.markLost(); stop(pre, 'protocol-malformed'); }
    await samePid(c, pid, pre);
    commitDispatched = true;
    let ack;
    try { ack = await c.sql('COMMIT', [], 'unknown'); } catch { stop('unknown', 'commit-unknown'); }
    if (!affirmed(ack, 'COMMIT')) { c.markLost(); stop('unknown', 'commit-unknown'); }
    return deepFreeze({
      status: 'installed-unverified', householdId: s.domain.householdId, ledgerNamespace: s.domain.ledgerNamespace,
      ledger: { revision: s.verdict.ledger.revision, documentDigest: s.verdict.ledger.documentDigest, pin: s.verdict.ledger.pin },
      history: { revision: s.verdict.history.revision, digest: s.verdict.history.digest },
      quarantined, clearedStaged: !!staged, clearedJournal: !!journal,
    });
  } catch (e) {
    if (commitDispatched) return Object.freeze({ status: 'unknown', reason: 'commit-unknown' });
    // Definite refusal on a healthy session: roll back (best effort); the
    // session is retired below either way, so its state is never reused.
    if (began && !c.isLost()) { try { await c.sql('ROLLBACK', [], 'refused'); } catch { /* still not committed */ } }
    const out = settle(e, INSTALL_REASONS);
    return out.reason === 'session-lost' || out.reason === 'protocol-malformed' || out.reason === 'backend-changed'
      ? Object.freeze({ status: 'refused', reason: 'aborted-before-commit', cause: out.reason }) : out;
  } finally {
    c.retireOnce();
  }
}

async function verifyRestoreInstall(input) {
  let s;
  try { s = own(input, true); } catch (e) { return settle(e, VERIFY_REASONS); }
  const c = channel(s);
  try {
    const u = 'unknown';
    const pid = await acquire(c, s, u);
    const b = await c.sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', [], u);
    if (!affirmed(b, 'BEGIN')) { c.markLost(); stop(u, 'protocol-malformed'); }
    await samePid(c, pid, u);
    const head = await readOne(c, 'SELECT bytes FROM ' + s.T.head + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], u);
    const staged = await readOne(c, 'SELECT bytes FROM ' + s.T.staged + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], u);
    const journal = await readOne(c, 'SELECT bytes FROM ' + s.T.journal + ' WHERE scope = $1 LIMIT 2', s.scope, ['bytes'], u);
    const terminal = await readOne(c, 'SELECT history_bytes, checkpoint_bytes FROM ' + s.T.terminal + ' WHERE scope = $1 LIMIT 2',
      s.scope, ['history_bytes', 'checkpoint_bytes'], u);
    await samePid(c, pid, u);
    const end = await c.sql('COMMIT', [], u);
    if (!affirmed(end, 'COMMIT')) { c.markLost(); stop(u, 'protocol-malformed'); }
    const mismatch = reason => Object.freeze({ status: 'mismatch', reason });
    if (!head) return mismatch('head-missing');
    if (!terminal) return mismatch('history-missing');
    if (staged) return mismatch('staged-residue');
    if (journal) return mismatch('journal-residue');
    if (!head.bytes.equals(s.ledgerBytes)) return mismatch('head-mismatch');
    if (!terminal.history_bytes.equals(s.historyBytes)) return mismatch('history-mismatch');
    if (!terminal.checkpoint_bytes.equals(s.checkpointBytes)) return mismatch('checkpoint-mismatch');
    if (head.bytes.length > LEDGER_MAX_BYTES || terminal.history_bytes.length > HISTORY_MAX_BYTES) return mismatch('readback-invalid');
    // Same trusted anchors, over the READBACK bytes (not the candidate copy).
    const v = validateRestoreInput(validatorInput(s.domain, s.ledgerAnchor, s.historyAnchor, head.bytes, terminal.history_bytes));
    if (v.status !== 'valid') return mismatch('readback-invalid');
    if (v.ledger.pin !== s.pin) return mismatch('pin-mismatch');
    return deepFreeze({ status: 'verified', householdId: v.householdId, ledgerNamespace: v.ledgerNamespace,
      ledger: { revision: v.ledger.revision, documentDigest: v.ledger.documentDigest, pin: v.ledger.pin },
      history: { revision: v.history.revision, digest: v.history.digest } });
  } catch (e) {
    return settle(e, VERIFY_REASONS);
  } finally {
    c.retireOnce();
  }
}

module.exports = Object.freeze({
  installRestoreCandidate, verifyRestoreInstall, INSTALL_REASONS, VERIFY_REASONS, QUARANTINE_LABELS,
  LEDGER_MAX_BYTES, HISTORY_MAX_BYTES, CHECKPOINT_MAX_BYTES, QUARANTINE_MAX_BYTES,
});
