'use strict';

// Settlement custody durable stores (Plan #5, GAP-1 — the host-root
// assembly packet's ruling option (a), a P1 follow-on) — Postgres-backed
// pin and backup custody for the settlement evidence store, over ONE
// dedicated direct session built from the injected runtime-shaped
// connection profile.
//
// FOUNDATION — NOT COMPLETION. This module ships with no production
// importer: the production composition root (the host slice) binds
// these surfaces into the settlement custody record in place of P1's
// process-local custody cells (scripts/settlement-production-owners.js),
// whose pin and backups a process restart loses — the stack then fails
// closed, but the finish line requires decisions and history to survive
// restart. Nothing here activates, provisions, or qualifies anything:
// no DDL is issued or claimed, the relation contract below is
// descriptive only (the same stance as the Postgres local-state
// adapter), and durable backing on the financial profile is NOT
// independent custody — independent pin/archive custody qualification
// remains an activation prerequisite, exactly as the Postgres runtime's
// header states for its own surfaces.
//
// It supplies exactly the store's injected pinStore and backupStore
// surfaces (scripts/settlement-evidence-store.js), with the semantics
// the shipped object adapter (scripts/settlement-evidence-object-adapter.js)
// defines for them, over Postgres relations instead of an object
// transport. The stored pin record byte format is the object adapter's
// own ({ v, household, revision, digest, timestamp }, the household
// bound by the contract digest of the household id), so a pin written
// through either adapter validates through the other.
//
//   pinStore.read()  -> null ONLY for proven absence. The stored pin
//     is validated on every read (row household binding, record shape,
//     household binding, revision, digest, timestamp); malformed,
//     unreadable, ambiguous or foreign-household pin state THROWS —
//     it is never absence.
//   pinStore.advance(expected, next) -> the literal value true ONLY
//     for a definite conditional write (a create-only insert, or an
//     exact-bytes compare-and-swap update that matched one row); the
//     literal value false ONLY for a definite conflict (an absent pin
//     against a non-null expectation, an existing pin against genesis,
//     a full-pair mismatch, a definite unique violation on create, or
//     a CAS that matched no row); anything else — a failed query, a
//     malformed acknowledgement — THROWS, so the store preserves
//     uncertainty and reconciles from observation. Inputs are
//     snapshotted (deep-copied) at entry, before any await. The
//     transition itself is validated: genesis (revision 0 against an
//     absent pin) or a sequential advance only.
//   backupStore.put(revision, digest, bytes) -> the document is
//     validated through the Phase 1 contract under the expected
//     household (and against the supplied revision/digest) BEFORE
//     encryption or storage. Only the injected encryption function's
//     output ever reaches the database; malformed output, or output
//     equal to the plaintext, is refused — there is no plaintext
//     fallback. Artifacts are create-only under (scope, revision,
//     digest); a retry over an existing artifact returns an
//     acknowledgement bound to the EXISTING artifact only after its
//     stored household binding and ciphertext integrity verify — it
//     never overwrites stored bytes.
//   backupStore.list() -> the complete manifest: every owned row's
//     household binding, revision/digest binding AND stored-bytes
//     integrity are verified, and malformed or foreign rows THROW. An
//     unverifiable manifest is never returned as success: in the
//     store, a manifest can license genesis or destruction, so an
//     unverifiable one must license nothing.
//   backupStore.get() -> deliberately THROWS recovery-unavailable in
//     this slice. No owner-held private key exists on the server (the
//     design's key split keeps it offline with the owner), so this
//     module cannot decrypt backups and never returns ciphertext as
//     if it were plaintext. The store composes this as
//     recovery-blocked with all evidence preserved — the same stance
//     as the shipped object adapter.
//
// Terminal history is deliberately NOT supplied here: the native
// { mode: 'postgres' } selection already ships — the runtime and the
// local-state adapter implement it over the terminal_history relation
// (scripts/settlement-evidence-postgres-runtime.js,
// scripts/settlement-evidence-postgres-adapter.js). A second history
// surface would duplicate a durable mode that already exists.
//
// Session ownership:
//   - The factory takes the runtime's connection profile shape —
//     { Client, config, schema, scope } — and builds exactly ONE
//     dedicated session from it, lazily, on first use. Direct session
//     only: a pooler endpoint is refused at construction, no pool is
//     ever created, and the session is never reconnected or
//     substituted. ssl.rejectUnauthorized is pinned true and the TLS
//     server name is pinned to the profile host, as in the shipped
//     connection profile validation.
//   - All traffic is serialized through one queue. Any rejected query
//     (other than the definite unique violation on pin create, which
//     is an atomic statement refusal in autocommit and lands nothing),
//     any malformed result envelope, or the session's 'error'/'end'
//     event marks the stores LOST, permanently, and retires that exact
//     session; every later operation throws. Recovery is a new factory
//     instance over a new session, i.e. a new composition.
//   - retire() fences every later operation synchronously and ends
//     the session once queued work settles; it is idempotent.
//   - This module reads no environment, provisions no relations, and
//     holds no credential of its own: the profile and the encryption
//     function are injected by the composing host. Object keys,
//     artifact names and error messages carry no household,
//     transaction, actor or operation data.

const crypto = require('node:crypto');
const net = require('node:net');
const C = require('./planned-obligation-settlement-contract');

const PREFIX = 'settlement-custody-durable-stores:';
const HOUSEHOLD_RE = /^household-[a-f0-9]{32}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const NAME_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const REVISION_TEXT_RE = /^(0|[1-9][0-9]*)$/;
const MAX_BACKUPS = 10000;

const RELATION_CONTRACT = Object.freeze({
  note: 'descriptive only; not provisioned; no existing schema is claimed to match',
  session: 'one dedicated session per factory instance; direct only (never a pooler endpoint, never transaction pooling)',
  relations: Object.freeze({
    custody_pin: Object.freeze({
      columns: 'scope text primary key, household text not null, bytes bytea not null',
      grants: 'SELECT, INSERT, UPDATE',
    }),
    custody_backup: Object.freeze({
      columns: 'scope text, household text not null, revision text not null, digest text not null, bytes bytea not null, integrity text not null, primary key (scope, revision, digest)',
      grants: 'SELECT, INSERT',
    }),
  }),
  client: 'the pg-shaped Client constructor of the injected runtime connection profile; the session is constructed, connected and retired by this module only',
});

function fail(detail) { throw new Error(PREFIX + ' ' + detail); }
function invalid(detail) { throw new TypeError(PREFIX + ' ' + detail); }
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
// A resolved query envelope: any non-null, non-array object whose `rows`
// is an array (node-postgres resolves with Result instances, so the
// prototype is not required to be Object.prototype). Mirrors the
// local-state adapter's envelope rule.
function isResultEnvelope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.rows);
}
// Reads exactly the named own DATA properties of a plain record (the
// runtime's record rule): extra or missing keys, accessors, symbols
// and non-plain prototypes refuse; getters are never invoked.
function exactRecord(value, allowed, required = allowed) {
  if (!isRecord(value)) return null;
  const own = Reflect.ownKeys(value);
  if (!required.every(k => own.includes(k))
    || !own.every(k => typeof k === 'string' && allowed.includes(k))) return null;
  const out = {};
  for (const k of own) {
    const d = Object.getOwnPropertyDescriptor(value, k);
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable) return null;
    out[k] = d.value;
  }
  return out;
}

function validateProfile(connection) {
  const c = exactRecord(connection, ['Client', 'config', 'schema', 'scope']);
  if (!c) invalid('connection must be exactly { Client, config, schema, scope }');
  if (typeof c.Client !== 'function') invalid('connection Client must be a constructor');
  const config = exactRecord(c.config, ['host', 'port', 'database', 'user', 'password', 'ssl']);
  if (!config) invalid('connection config is malformed');
  const ssl = exactRecord(config.ssl, ['rejectUnauthorized', 'servername']);
  if (!ssl) invalid('connection ssl is malformed');
  if (typeof config.host !== 'string' || config.host.length === 0 || config.host.length > 253
    || !config.host.includes('.') || net.isIP(config.host)
    || config.host.split('.').some(x => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))
    || config.host.includes('-pooler')) {
    invalid('connection host is malformed or is a pooler endpoint');
  }
  if (!Number.isInteger(config.port) || config.port <= 0 || config.port > 65535) {
    invalid('connection port is malformed');
  }
  if (typeof config.database !== 'string' || !NAME_RE.test(config.database)
    || typeof config.user !== 'string' || !NAME_RE.test(config.user)) {
    invalid('connection database or user is malformed');
  }
  if (typeof config.password !== 'string' || config.password.length === 0
    || config.password.length > 1024 || config.password.includes('\0')) {
    invalid('connection password is malformed');
  }
  if (ssl.rejectUnauthorized !== true || ssl.servername !== config.host) {
    invalid('connection ssl must pin rejectUnauthorized and the host server name');
  }
  if (typeof c.schema !== 'string' || !SCHEMA_RE.test(c.schema)
    || c.schema.startsWith('pg_') || c.schema === 'information_schema') {
    invalid('connection schema is malformed');
  }
  if (typeof c.scope !== 'string' || !SCOPE_RE.test(c.scope)) {
    invalid('connection scope is malformed');
  }
  return {
    Client: c.Client, schema: c.schema, scope: c.scope,
    clientConfig: Object.freeze({
      host: config.host, port: config.port, database: config.database,
      user: config.user, password: config.password,
      ssl: Object.freeze({ rejectUnauthorized: true, servername: config.host }),
      application_name: 'atlas-settlement-custody',
    }),
  };
}

function createSettlementCustodyDurableStores(options) {
  const o = exactRecord(options, ['connection', 'householdId', 'encrypt']);
  if (!o) invalid('options must be exactly { connection, householdId, encrypt }');
  if (typeof o.householdId !== 'string' || !HOUSEHOLD_RE.test(o.householdId)) {
    invalid('householdId is malformed');
  }
  if (typeof o.encrypt !== 'function') invalid('an encryption function is required');
  const profile = validateProfile(o.connection);
  const householdId = o.householdId;
  const encrypt = o.encrypt;
  const scope = profile.scope;
  // The pin object binds the expected household by the contract digest
  // of the household id: verifiable on read, and itself content-free.
  const binding = C.digest({ householdId });

  const q = '"' + profile.schema + '"';
  const SQL = Object.freeze({
    pinRead: 'SELECT household, bytes FROM ' + q + '.custody_pin WHERE scope = $1',
    pinCreate: 'INSERT INTO ' + q + '.custody_pin (scope, household, bytes) VALUES ($1, $2, $3)',
    pinAdvance: 'UPDATE ' + q + '.custody_pin SET bytes = $2'
      + ' WHERE scope = $1 AND household = $3 AND bytes = $4',
    backupPut: 'INSERT INTO ' + q + '.custody_backup'
      + ' (scope, household, revision, digest, bytes, integrity) VALUES ($1, $2, $3, $4, $5, $6)'
      + ' ON CONFLICT (scope, revision, digest) DO NOTHING',
    backupRead: 'SELECT household, revision, digest, bytes, integrity FROM ' + q
      + '.custody_backup WHERE scope = $1 AND revision = $2 AND digest = $3',
    backupList: 'SELECT household, revision, digest, bytes, integrity FROM ' + q
      + '.custody_backup WHERE scope = $1',
  });

  // --- Session ownership -----------------------------------------------------
  let session = null;
  let connecting = null;
  let lost = false;
  let retired = false;
  let retirePromise = null;
  let tail = Promise.resolve();

  function serial(unit) {
    const run = tail.then(unit);
    tail = run.then(() => {}, () => {});
    return run;
  }
  function markLost() {
    lost = true;
    if (session) {
      const s = session;
      try { Promise.resolve(s.end()).catch(() => {}); } catch { /* still LOST */ }
    }
  }
  const onLoss = () => markLost();

  async function ensureSession() {
    if (session) return session;
    if (lost || retired) fail('session unavailable');
    if (!connecting) {
      connecting = (async () => {
        let raw;
        try { raw = new profile.Client(profile.clientConfig); } catch {
          fail('client construction failed');
        }
        if (!raw || ['connect', 'query', 'on', 'end'].some(m => typeof raw[m] !== 'function')) {
          fail('client lacks a required session capability');
        }
        raw.on('error', onLoss);
        raw.on('end', onLoss);
        try { await raw.connect(); } catch {
          try { await raw.end(); } catch { /* the failure stands */ }
          fail('session connect failed');
        }
        if (lost || retired) {
          try { await raw.end(); } catch { /* the fence stands */ }
          fail('session unavailable');
        }
        session = raw;
        return raw;
      })();
    }
    return connecting;
  }

  // One statement, inside the caller's serial unit. A rejection carrying
  // the definite unique-violation code is rethrown marked `definite`
  // WITHOUT losing the session: in autocommit the statement was refused
  // atomically and nothing landed, and only pin create can raise it.
  // Every other failure loses the session permanently and surfaces as
  // an outcome-unknown error.
  async function exec(text, values, verb) {
    if (retired) fail('stores are retired');
    if (lost) fail('session lost; stores are permanently invalid');
    let raw;
    try { raw = await ensureSession(); } catch {
      lost = true;
      fail('session unavailable; outcome unknown');
    }
    if (retired || lost) fail('session lost; stores are permanently invalid');
    let res;
    try { res = await raw.query(text, values); } catch (error) {
      if (error && error.code === '23505') {
        const e = new Error(PREFIX + ' definite unique violation');
        e.definite = true;
        throw e;
      }
      markLost();
      fail('session query failed; outcome unknown; stores are permanently invalid');
    }
    if (retired || lost) fail('session changed during query; outcome unknown');
    if (!isResultEnvelope(res) || res.command !== verb) {
      markLost();
      fail('malformed query result; outcome unknown; stores are permanently invalid');
    }
    return res;
  }
  function fence() {
    if (retired) fail('stores are retired');
    if (lost) fail('session lost; stores are permanently invalid');
  }

  // --- Pin -------------------------------------------------------------------
  function pinBytes(next) {
    return Buffer.from(JSON.stringify({
      v: 1, household: binding,
      revision: next.revision, digest: next.digest, timestamp: next.timestamp,
    }));
  }
  function parsePinRow(row) {
    if (!isRecord(row) || row.household !== binding) fail('stored pin failed validation');
    const bytes = copyBytes(row.bytes);
    if (!bytes) fail('stored pin carries no bytes');
    let value;
    try { value = JSON.parse(bytes.toString('utf8')); } catch {
      fail('stored pin is not a pin record');
    }
    if (!isRecord(value)) fail('stored pin is not a pin record');
    const actual = Object.keys(value).sort();
    const wanted = ['digest', 'household', 'revision', 'timestamp', 'v'];
    if (actual.length !== wanted.length || actual.some((k, i) => k !== wanted[i])
      || value.v !== 1 || value.household !== binding
      || !Number.isSafeInteger(value.revision) || value.revision < 0
      || !isHash(value.digest) || !isTick(value.timestamp)) {
      fail('stored pin failed validation');
    }
    return {
      pin: Object.freeze({
        revision: value.revision, digest: value.digest, timestamp: value.timestamp,
      }),
      bytes,
    };
  }
  async function readPinRow() {
    const res = await exec(SQL.pinRead, [scope], 'SELECT');
    if (res.rows.length === 0) return null;
    if (res.rows.length !== 1) {
      markLost();
      fail('pin read returned more than one row; outcome unknown');
    }
    return parsePinRow(res.rows[0]);
  }

  const pinStore = Object.freeze({
    async read() {
      return serial(async () => {
        const row = await readPinRow();
        return row ? row.pin : null;
      });
    },

    async advance(expected, next) {
      // Snapshot the complete request at entry, before any await.
      let expCopy;
      let nextCopy;
      try {
        expCopy = expected === null ? null : JSON.parse(JSON.stringify(expected));
        nextCopy = JSON.parse(JSON.stringify(next));
      } catch {
        fail('pin advance arguments are not snapshot-able records');
      }
      if (expCopy !== null && (!isRecord(expCopy)
        || !Number.isSafeInteger(expCopy.revision) || expCopy.revision < 0
        || !isHash(expCopy.digest))) {
        fail('pin advance expected pair is malformed');
      }
      if (!isRecord(nextCopy) || !Number.isSafeInteger(nextCopy.revision)
        || nextCopy.revision < 0 || !isHash(nextCopy.digest)
        || !isTick(nextCopy.timestamp)) {
        fail('pin advance next pair is malformed');
      }
      // The transition is validated against the EXPECTED pair, never
      // against whatever the pin happens to hold when the write lands.
      const baseRevision = expCopy === null ? -1 : expCopy.revision;
      if (nextCopy.revision !== baseRevision + 1) {
        fail('pin advance is not a genesis or sequential transition');
      }
      const intended = pinBytes(nextCopy);
      return serial(async () => {
        const current = await readPinRow();
        fence();
        if (current === null) {
          if (expCopy !== null) return false; // definite: no pin to match the pair
          let res;
          try {
            res = await exec(SQL.pinCreate, [scope, binding, intended], 'INSERT');
          } catch (error) {
            if (error && error.definite) return false; // a concurrent create landed first
            throw error; // lost or ambiguous acknowledgement: uncertainty
          }
          if (res.rowCount !== 1) {
            markLost();
            fail('pin create acknowledgement is malformed; outcome unknown');
          }
          return true;
        }
        if (expCopy === null) return false; // definite: a pin already exists
        if (current.pin.revision !== expCopy.revision
          || current.pin.digest !== expCopy.digest) {
          return false; // definite: the full pair does not match
        }
        const res = await exec(SQL.pinAdvance,
          [scope, intended, binding, current.bytes], 'UPDATE');
        if (res.rowCount === 1) return true;
        if (res.rowCount === 0) return false; // the exact bytes moved under us
        markLost();
        fail('pin advance acknowledgement is malformed; outcome unknown');
      });
    },
  });

  // --- Backup ------------------------------------------------------------------
  function parseRevisionText(text) {
    if (typeof text !== 'string' || !REVISION_TEXT_RE.test(text)) {
      fail('backup manifest entry binding is malformed');
    }
    const n = Number(text);
    if (!Number.isSafeInteger(n) || String(n) !== text) {
      fail('backup manifest entry binding is malformed');
    }
    return n;
  }
  function verifyBackupRow(row) {
    if (!isRecord(row) || row.household !== binding) {
      fail('backup artifact does not bind this household');
    }
    const revision = parseRevisionText(row.revision);
    if (!isHash(row.digest)) fail('backup manifest entry binding is malformed');
    const bytes = copyBytes(row.bytes);
    if (!bytes || !isHash(row.integrity) || sha256(bytes) !== row.integrity) {
      fail('backup artifact fails its stored integrity binding');
    }
    return Object.freeze({
      revision, digest: row.digest, artifactId: 'pg-rev-' + revision + '-' + row.digest,
    });
  }

  const backupStore = Object.freeze({
    async put(revision, digest, bytes) {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        fail('backup revision is malformed');
      }
      if (!isHash(digest)) fail('backup digest is malformed');
      const snapshot = copyBytes(bytes);
      if (!snapshot || snapshot.length === 0) fail('backup document bytes are malformed');
      // Contract validation BEFORE encryption or storage: the bytes
      // must be this household's document at exactly the supplied
      // revision and digest.
      let state;
      try {
        C.pin(snapshot, householdId);
        state = JSON.parse(snapshot.toString('utf8'));
      } catch {
        fail('backup document failed contract validation');
      }
      if (!isRecord(state) || state.revision !== revision || state.digest !== digest) {
        fail('backup revision and digest do not match the document');
      }
      const produced = await encrypt(Buffer.from(snapshot));
      const ciphertext = copyBytes(produced);
      if (!ciphertext || ciphertext.length === 0) {
        fail('encryption output is malformed');
      }
      if (ciphertext.equals(snapshot)) {
        fail('encryption output equals the plaintext document');
      }
      const integrity = sha256(ciphertext);
      const artifactId = 'pg-rev-' + revision + '-' + digest;
      return serial(async () => {
        const res = await exec(SQL.backupPut,
          [scope, binding, String(revision), digest, ciphertext, integrity], 'INSERT');
        if (res.rowCount === 1) return Object.freeze({ revision, digest, artifactId });
        if (res.rowCount !== 0) {
          markLost();
          fail('backup insert acknowledgement is malformed; outcome unknown');
        }
        // Create conflict: the acknowledgement binds the EXISTING
        // artifact only after its stored binding and integrity verify.
        fence();
        const existing = await exec(SQL.backupRead,
          [scope, String(revision), digest], 'SELECT');
        if (existing.rows.length !== 1) {
          fail('backup artifact vanished after an insert conflict');
        }
        const entry = verifyBackupRow(existing.rows[0]);
        if (entry.revision !== revision || entry.digest !== digest) {
          fail('existing backup artifact does not bind this revision and digest');
        }
        return Object.freeze({ revision, digest, artifactId });
      });
    },

    async get() {
      // Deliberate: no owner-held private key exists on the server, so
      // stored ciphertext can never be decrypted here and is never
      // returned as if it were plaintext. The store composes this
      // throw as recovery-blocked with all evidence preserved.
      fail('backup recovery unavailable: no owner-held decryption key exists on the server');
    },

    async list() {
      return serial(async () => {
        const res = await exec(SQL.backupList, [scope], 'SELECT');
        if (res.rows.length > MAX_BACKUPS) fail('backup listing did not terminate');
        const entries = res.rows.map(row => verifyBackupRow(row));
        entries.sort((a, b) => a.revision - b.revision
          || (a.digest < b.digest ? -1 : a.digest > b.digest ? 1 : 0));
        return entries;
      });
    },
  });

  // --- Retirement --------------------------------------------------------------
  async function retire() {
    if (retirePromise) return retirePromise;
    retired = true; // synchronous fence, including pending custody callbacks
    retirePromise = (async () => {
      await tail; // queued work settles before the session ends
      if (connecting) { try { await connecting; } catch { /* already fenced */ } }
      const raw = session;
      session = null;
      if (raw) { try { await raw.end(); } catch { /* the fence stands either way */ } }
      return Object.freeze({ state: 'retired' });
    })();
    return retirePromise;
  }

  return Object.freeze({ pinStore, backupStore, retire });
}

module.exports = { createSettlementCustodyDurableStores, RELATION_CONTRACT };
