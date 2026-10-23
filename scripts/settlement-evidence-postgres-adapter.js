'use strict';

// Settlement evidence PostgreSQL local-state adapter (ATLAS-080).
//
// FOUNDATION ONLY, DEFAULT UNCONNECTED. This module has no production
// importer, no route, no driver dependency, no connection defaults, no
// credentials, no environment reads, no network and no DDL. Importing it
// performs no I/O. A caller injects ONE already-connected, dedicated
// PostgreSQL session client (node-postgres-shaped: query(text, values)
// and on('error'|'end', listener)); the adapter supplies the store's
// local surfaces over it — documentStore, journalStore, quarantine and
// the shared lock — behind the unchanged store interface of
// scripts/settlement-evidence-store.js. Pin and off-volume backup are
// NOT implemented here: their independent custody is unresolved and
// they stay separately injected by the caller.
//
// Client/session ownership (frozen design, see the PR):
//   - One adapter instance owns exactly one client for its lifetime. It
//     never connects, reconnects, ends or replaces it.
//   - Session loss — the client's 'error' or 'end' event, or ANY
//     rejected query (a driver cannot reliably tell a dropped
//     connection from a statement failure) — marks the adapter LOST,
//     permanently. Every later read and mutation throws. Recovery is a
//     new adapter over a new client, i.e. a new store instance.
//   - All client traffic is serialized through one queue; a transaction
//     occupies the queue as a unit, so an unlocked read (the store's
//     outcome path) never interleaves inside an open transaction.
//   - lock.withLock(fn) refuses (never queues) when held, acquires a
//     session advisory lock, records pg_backend_pid(), and runs fn in an
//     AsyncLocalStorage context bound to a fresh holder. On settle or
//     session loss that holder is invalidated forever. Every mutation
//     checks it is running under the adapter's CURRENT live holder and,
//     inside its transaction, that the backend pid is unchanged. A
//     resumed old callback carries its old holder and is refused; it can
//     never borrow a later holder's session. Advisory auto-release on
//     disconnect is not relied on for invalidation.
//   - Durable acknowledgement only after COMMIT resolves. Any failure
//     throws an "outcome unknown" error — never null, false or a silent
//     no-effect.
//
// Absence is the literal null. Rows are projected: only named columns
// are read; a present row with a missing, null, non-bytes or over-cap
// value throws. All values are parameterized; the schema identifier is
// validated and quoted; table names are fixed. The relation contract
// below is descriptive only — nothing here provisions it or claims an
// existing schema matches it.

const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');

const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
// Must exceed the maximum serialized journal envelope (~2.80 MB: base64
// of a 2 MiB base document plus preview and keys) so it round-trips.
const RECORD_MAX_BYTES = 4 * 1024 * 1024;
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;
const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const RELATION_CONTRACT = Object.freeze({
  note: 'descriptive only; not provisioned; no existing schema is claimed to match',
  session: 'one dedicated session per adapter; direct or session-mode pooling only (never transaction pooling)',
  relations: Object.freeze({
    doc_head: Object.freeze({ columns: 'scope text primary key, bytes bytea not null', grants: 'SELECT, INSERT, UPDATE, DELETE' }),
    doc_staged: Object.freeze({ columns: 'scope text primary key, bytes bytea not null', grants: 'SELECT, INSERT, UPDATE, DELETE' }),
    journal: Object.freeze({ columns: 'scope text primary key, bytes bytea not null', grants: 'SELECT, INSERT, UPDATE, DELETE' }),
    quarantine: Object.freeze({ columns: 'scope text, name text, label text, bytes bytea not null, primary key (scope, name)', grants: 'SELECT, INSERT' }),
  }),
  functions: Object.freeze(['pg_try_advisory_lock(int4, int4)', 'pg_advisory_unlock(int4, int4)', 'pg_backend_pid()']),
});

function fail(detail) {
  throw new Error('settlement-postgres-adapter: ' + detail);
}
function check(value, detail) { if (!value) fail(detail); }
function copyBytesArg(value, what) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError('settlement-postgres-adapter: ' + what + ' must be bytes');
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function createSettlementEvidencePostgresAdapter(options) {
  check(isRecord(options), 'options are required');
  const { client, schema, scope } = options;
  check(client && typeof client.query === 'function' && typeof client.on === 'function',
    'a dedicated session client with query() and on() is required');
  check(typeof schema === 'string' && SCHEMA_RE.test(schema)
    && !schema.startsWith('pg_') && schema !== 'information_schema', 'schema identifier is invalid');
  check(typeof scope === 'string' && SCOPE_RE.test(scope), 'scope is invalid');

  const q = '"' + schema + '"';
  const T = {
    head: q + '.doc_head', staged: q + '.doc_staged', journal: q + '.journal', quarantine: q + '.quarantine',
  };
  const digest = crypto.createHash('sha256').update(schema + '\0' + scope).digest();
  const lockKeys = [digest.readInt32BE(0), digest.readInt32BE(4)];

  const als = new AsyncLocalStorage();
  let lost = false;
  let current = null; // the current live holder, or null
  let tail = Promise.resolve();

  function markLost() {
    lost = true;
    if (current) current.alive = false;
  }
  const onLoss = () => markLost();
  client.on('error', onLoss);
  client.on('end', onLoss);

  // Serialize every unit of client work; a unit failing never wedges the queue.
  function serial(unit) {
    const run = tail.then(unit);
    tail = run.then(() => {}, () => {});
    return run;
  }
  async function raw(text, values) {
    check(!lost, 'session lost; adapter is permanently invalid');
    let res;
    try { res = await client.query(text, values); } catch {
      markLost();
      fail('session query failed; outcome unknown; adapter is permanently invalid');
    }
    check(!lost, 'session lost; outcome unknown; adapter is permanently invalid');
    check(res && Array.isArray(res.rows), 'malformed query result');
    return res;
  }

  function capability() {
    check(!lost, 'session lost; mutation refused');
    const holder = als.getStore();
    check(holder && holder.alive && holder === current, 'mutation outside the current live lock holder refused');
    return holder;
  }
  function readGuard() {
    check(!lost, 'session lost; read refused');
    const holder = als.getStore();
    if (holder) check(holder.alive && holder === current, 'read from a stale lock holder refused');
  }

  // One mutation transaction: BEGIN; pid fence; body; COMMIT. Resolves
  // only after COMMIT resolves. A definite refusal inside the txn is
  // rolled back; any query failure leaves the adapter LOST and throws.
  function mutate(body) {
    const holder = capability();
    return serial(async () => {
      capability();
      await raw('BEGIN', []);
      let refusal = null;
      let result;
      try {
        const pid = await raw('SELECT pg_backend_pid() AS pid', []);
        if (pid.rows.length !== 1 || pid.rows[0].pid !== holder.pid || holder !== current || !holder.alive) {
          refusal = 'lock session fence failed; mutation refused';
        } else {
          result = await body();
        }
      } catch (e) {
        if (lost || !e || !e.refusal) throw e;
        refusal = e.message;
      }
      if (refusal !== null) {
        await raw('ROLLBACK', []);
        fail(refusal.replace(/^settlement-postgres-adapter: /, ''));
      }
      await raw('COMMIT', []);
      return result;
    });
  }
  function refuse(detail) {
    const e = new Error('settlement-postgres-adapter: ' + detail);
    e.refusal = true;
    throw e;
  }

  function projectBytes(res, what, cap) {
    if (res.rows.length === 0) return null;
    check(res.rows.length === 1, what + ' returned more than one row');
    const value = res.rows[0].bytes;
    check(Buffer.isBuffer(value), what + ' row bytes column is missing or not bytes');
    check(value.length <= cap, what + ' exceeds the size bound');
    return Buffer.from(value);
  }
  function read(text, what, cap) {
    readGuard();
    return serial(async () => {
      readGuard();
      return projectBytes(await raw(text, [scope]), what, cap);
    });
  }

  const documentStore = {
    async read() {
      return read('SELECT bytes FROM ' + T.head + ' WHERE scope = $1', 'document', DOCUMENT_MAX_BYTES);
    },
    async readStaged() {
      // Scoped trace inspection: the store's bootstrap absence proof.
      // Any adapter-owned durable trace for THIS scope is reported;
      // any failure or malformed row throws (fails closed).
      return read('SELECT bytes FROM ('
        + 'SELECT 1 AS ord, bytes FROM ' + T.staged + ' WHERE scope = $1'
        + ' UNION ALL SELECT 2 AS ord, bytes FROM ' + T.head + ' WHERE scope = $1'
        + ' UNION ALL SELECT 3 AS ord, bytes FROM ' + T.journal + ' WHERE scope = $1'
        + ' UNION ALL SELECT 4 AS ord, bytes FROM (SELECT bytes FROM ' + T.quarantine
        + ' WHERE scope = $1 ORDER BY name LIMIT 1) AS qt'
        + ') AS traces ORDER BY ord LIMIT 1', 'trace', RECORD_MAX_BYTES);
    },
    async writeTemp(bytes) {
      const copy = copyBytesArg(bytes, 'document temp');
      check(copy.length <= DOCUMENT_MAX_BYTES, 'document temp exceeds the size bound');
      await mutate(async () => {
        const r = await raw('INSERT INTO ' + T.staged + ' (scope, bytes) VALUES ($1, $2)'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes', [scope, copy]);
        if (r.rowCount !== 1) refuse('staged write affected an unexpected row count');
      });
    },
    async commitTemp() {
      // Head promotion and stage consumption in ONE statement in ONE txn.
      await mutate(async () => {
        const r = await raw('WITH s AS (DELETE FROM ' + T.staged + ' WHERE scope = $1 RETURNING scope, bytes)'
          + ' INSERT INTO ' + T.head + ' (scope, bytes) SELECT scope, bytes FROM s'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes RETURNING scope', [scope]);
        if (r.rowCount !== 1) refuse('no staged document to commit');
      });
    },
    async discardTemp() {
      await mutate(async () => {
        await raw('DELETE FROM ' + T.staged + ' WHERE scope = $1', [scope]);
      });
    },
  };

  const journalStore = {
    async read() {
      return read('SELECT bytes FROM ' + T.journal + ' WHERE scope = $1', 'journal', RECORD_MAX_BYTES);
    },
    async write(record) {
      check(isRecord(record), 'journal write requires a record');
      // bytea, never jsonb: byte-identical to the file adapter.
      const bytes = Buffer.from(JSON.stringify(record), 'utf8');
      check(bytes.length <= RECORD_MAX_BYTES, 'journal exceeds the size bound');
      await mutate(async () => {
        const r = await raw('INSERT INTO ' + T.journal + ' (scope, bytes) VALUES ($1, $2)'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes', [scope, bytes]);
        if (r.rowCount !== 1) refuse('journal write affected an unexpected row count');
      });
    },
    async clear() {
      await mutate(async () => {
        await raw('DELETE FROM ' + T.journal + ' WHERE scope = $1', [scope]);
      });
    },
  };

  const quarantine = {
    async put(label, bytes) {
      check(typeof label === 'string' && LABEL_RE.test(label), 'quarantine label is malformed');
      const copy = copyBytesArg(bytes, 'quarantine bytes');
      check(copy.length <= RECORD_MAX_BYTES, 'quarantine bytes exceed the size bound');
      const name = label + '-' + crypto.randomBytes(16).toString('hex');
      await mutate(async () => {
        const r = await raw('INSERT INTO ' + T.quarantine + ' (scope, name, label, bytes) VALUES ($1, $2, $3, $4)',
          [scope, name, label, copy]);
        if (r.rowCount !== 1) refuse('quarantine insert affected an unexpected row count');
      });
      return name;
    },
  };

  const lock = {
    async withLock(fn) {
      check(typeof fn === 'function', 'withLock requires a function');
      check(!lost, 'session lost; lock refused');
      check(current === null && !als.getStore(), 'settlement store lock is already held by this adapter');
      const holder = { alive: false, pid: null };
      current = holder; // reserve synchronously: a concurrent call refuses
      try {
        const pid = await serial(async () => {
          const got = await raw('SELECT pg_try_advisory_lock($1, $2) AS locked', lockKeys);
          if (!(got.rows.length === 1 && got.rows[0].locked === true)) return null;
          const p = await raw('SELECT pg_backend_pid() AS pid', []);
          check(p.rows.length === 1 && Number.isSafeInteger(p.rows[0].pid), 'backend pid unavailable');
          return p.rows[0].pid;
        });
        if (pid === null) fail('settlement store lock is held elsewhere; acquisition refused');
        holder.pid = pid;
        holder.alive = !lost;
        check(holder.alive, 'session lost; lock refused');
        try {
          return await als.run(holder, fn);
        } finally {
          holder.alive = false; // invalidated forever, whatever happens next
          if (!lost) {
            try {
              await serial(async () => {
                const r = await raw('SELECT pg_advisory_unlock($1, $2) AS unlocked', lockKeys);
                if (!(r.rows.length === 1 && r.rows[0].unlocked === true)) markLost();
              });
            } catch { /* adapter already LOST */ }
          }
        }
      } finally {
        holder.alive = false;
        if (current === holder) current = null;
      }
    },
  };

  return Object.freeze({
    documentStore: Object.freeze(documentStore),
    journalStore: Object.freeze(journalStore),
    quarantine: Object.freeze(quarantine),
    lock: Object.freeze(lock),
    contract: RELATION_CONTRACT,
  });
}

module.exports = {
  createSettlementEvidencePostgresAdapter, RELATION_CONTRACT, DOCUMENT_MAX_BYTES, RECORD_MAX_BYTES,
};
