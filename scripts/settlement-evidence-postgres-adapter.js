'use strict';

// Settlement evidence PostgreSQL local-state adapter (ATLAS-080).
//
// FOUNDATION ONLY, DEFAULT UNCONNECTED. This module has no production
// importer, no route, no driver dependency, no connection defaults, no
// credentials, no environment reads, no network and no DDL. Importing it
// performs no I/O. A caller injects ONE already-connected, dedicated
// PostgreSQL session client (node-postgres-shaped: query(text, values),
// on('error'|'end', listener), plus a REQUIRED retire() that terminates
// that exact session, e.g. a wrapper over node-postgres client.end());
// the adapter supplies the store's
// local surfaces over it — documentStore, journalStore, quarantine and
// the shared lock — behind the unchanged store interface of
// scripts/settlement-evidence-store.js. Pin and off-volume backup are
// NOT implemented here: their independent custody is unresolved and
// they stay separately injected by the caller.
//
// Client/session ownership (frozen design, see the PR):
//   - One adapter instance takes exclusive lifetime ownership of exactly
//     one client: a client already claimed by another adapter is refused.
//     The client must be one non-reconnecting, non-multiplexed session
//     (direct, or session-mode pooling; never transaction pooling). The
//     adapter never connects, reconnects or substitutes a client; its
//     only lifecycle act is retire() of that same client when LOST.
//     pg_backend_pid() equality is a swap check only, not proof the lock
//     stayed held; exclusive non-reconnecting ownership is the guarantee.
//   - Session loss — the client's 'error' or 'end' event, or ANY
//     rejected query (a driver cannot reliably tell a dropped
//     connection from a statement failure), a backend pid mismatch, or a
//     false/malformed/lost unlock acknowledgement — marks the adapter
//     LOST, permanently, and retires that exact session (LOST alone does
//     not establish server-side release; retirement ends the session so
//     PostgreSQL drops its advisory lock). No other connection is ever
//     used for cleanup. Every later read and mutation throws. Recovery is
//     a new adapter over a new client, i.e. a new store instance.
//   - All client traffic is serialized through one queue; a WHOLE
//     transaction — validation, BEGIN..COMMIT and ROLLBACK cleanup —
//     occupies the queue as one unit, and unlocked reads use the same
//     queue, so an unlocked read (the store's
//     outcome path) never interleaves inside an open transaction.
//   - lock.withLock(fn) refuses (never queues) when held, acquires a
//     session advisory lock, records pg_backend_pid(), and runs fn in an
//     AsyncLocalStorage context bound to a fresh holder whose identity is
//     captured once and frozen. Nested or overlapping withLock on the same
//     adapter/session is refused (advisory locks are reentrant, so a second
//     successful try-lock would not be fresh ownership). On settle or
//     session loss the holder is invalidated BEFORE unlock; the unlock is
//     queued behind any started transaction (which then aborts at its next
//     check) and stale queued work refuses at dequeue. Every mutation
//     revalidates the holder at dequeue, before each statement dispatch
//     and after each await up to COMMIT dispatch; a dispatched COMMIT may
//     remain uncertain. No timers are used, so no timeout can leave a live
//     mutation continuation. A
//     resumed old callback carries its old holder and is refused; it can
//     never borrow a later holder's session. Advisory auto-release on
//     disconnect is not relied on for invalidation.
//   - Any unexpected protocol/result failure (malformed resolved
//     envelope, non-refusal error mid-transaction, missing/wrong
//     transaction command tag, malformed unlock envelope) is session loss:
//     the exact session is retired, never rolled back and reused.
//   - Validated write inputs are snapshotted at call time, before the
//     queue; holder checks still run at dequeue and during execution.
//   - Durable acknowledgement only after COMMIT resolves with an
//     affirmative COMMIT command tag. Any failure
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
const { isDeepStrictEqual } = require('node:util');
const TC = require('./settlement-evidence-terminal-certificate');
const C = require('./planned-obligation-settlement-contract');

const DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
// Must exceed the maximum serialized journal envelope (~2.80 MB: base64
// of a 2 MiB base document plus preview and keys) so it round-trips.
const RECORD_MAX_BYTES = 4 * 1024 * 1024;
const CHECKPOINT_MAX_BYTES = 2048;
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
  client: 'query(text, values), on(\'error\'|\'end\'), retire() that terminates this exact session',
  functions: Object.freeze(['pg_try_advisory_lock(int4, int4)', 'pg_advisory_unlock(int4, int4)', 'pg_backend_pid()']),
});
// Exact opt-in profile only. Co-located checkpoint gives atomic local persistence,
// not independently surviving rollback evidence across a new process/DB restore.
const NATIVE_RELATION_CONTRACT = Object.freeze({ ...RELATION_CONTRACT,
  relations:Object.freeze({...RELATION_CONTRACT.relations,terminal_history:Object.freeze({
    columns:'scope text primary key, history_bytes bytea not null, checkpoint_bytes bytea not null',grants:'SELECT, UPDATE'})}) });

const CLAIMED = new WeakSet(); // clients under exclusive adapter ownership

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

// A resolved query envelope: any non-null, non-array object (node-postgres
// resolves with instances of its Result class, so the prototype is NOT
// required to be Object.prototype) whose own or inherited `rows` is an array.
// null, arrays, scalars, functions and objects without array rows are
// malformed. Control tags are checked separately and exactly (control()).
function isResultEnvelope(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.rows);
}

function createSettlementEvidencePostgresAdapter(options) {
  check(isRecord(options), 'options are required');
  const { client, schema, scope } = options;
  check(client && typeof client.query === 'function' && typeof client.on === 'function'
    && typeof client.retire === 'function',
  'a dedicated session client with query(), on() and retire() is required');
  check(!CLAIMED.has(client), 'client is already owned by another adapter');
  check(typeof schema === 'string' && SCHEMA_RE.test(schema)
    && !schema.startsWith('pg_') && schema !== 'information_schema', 'schema identifier is invalid');
  check(typeof scope === 'string' && SCOPE_RE.test(scope), 'scope is invalid');
  let terminalDomain=null;
  if(options.terminalHistory!==undefined){
    let h;try{h=TC.own(options.terminalHistory);}catch{fail('terminal history binding invalid');}
    check(isRecord(h)&&Object.keys(h).sort().join(',')==='householdId,ledgerNamespace'
      &&/^household-[a-f0-9]{32}$/.test(h.householdId)&&/^ledger-[a-f0-9]{32}$/.test(h.ledgerNamespace),
    'terminal history binding invalid');
    terminalDomain=h;
  }

  const q = '"' + schema + '"';
  const T = {
    head: q + '.doc_head', staged: q + '.doc_staged', journal: q + '.journal', quarantine: q + '.quarantine', terminal:q+'.terminal_history',
  };
  const digest = crypto.createHash('sha256').update(schema + '\0' + scope).digest();
  const lockKeys = [digest.readInt32BE(0), digest.readInt32BE(4)];

  CLAIMED.add(client);
  const als = new AsyncLocalStorage();
  let lost = false;
  let retired = false;
  const live = new WeakSet(); // live holder identities
  let current = null; // the current live holder, or null
  let tail = Promise.resolve();

  function markLost() {
    lost = true;
    if (current) live.delete(current);
    if (!retired) {
      retired = true;
      // Retire THIS session only; never a substitute connection.
      try { Promise.resolve(client.retire()).catch(() => {}); } catch { /* still LOST */ }
    }
  }
  const isLive = h => !!h && live.has(h) && h === current && !lost;
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
    // A malformed resolved envelope is an unexpected protocol failure:
    // retire this exact session before failing.
    if (!isResultEnvelope(res)) {
      markLost();
      fail('malformed query result; outcome unknown; adapter is permanently invalid');
    }
    return res;
  }
  // Transaction-control statements must complete with their own affirmative
  // command tag (node-postgres result.command). PostgreSQL can complete an
  // unsuccessful COMMIT as ROLLBACK; that, or a missing/malformed tag, is
  // never a durable acknowledgement.
  async function control(verb) {
    const res = await raw(verb, []);
    if (res.command !== verb) {
      markLost();
      fail(verb + ' completion not affirmed; outcome unknown; adapter is permanently invalid');
    }
    return res;
  }

  function capability() {
    check(!lost, 'session lost; mutation refused');
    const holder = als.getStore();
    check(isLive(holder), 'mutation outside the current live lock holder refused');
    return holder;
  }
  function readGuard() {
    check(!lost, 'session lost; read refused');
    const holder = als.getStore();
    if (holder) check(isLive(holder), 'read from a stale lock holder refused');
  }

  // One mutation transaction, serialized as a WHOLE unit (validation,
  // BEGIN, pid swap check, body, COMMIT or ROLLBACK cleanup). The holder
  // is captured once at call time and revalidated at dequeue, before every
  // statement dispatch and after every await until COMMIT is dispatched.
  // Resolves only after COMMIT resolves. A definite refusal (including a
  // holder invalidated mid-transaction) is rolled back on the same
  // session; any query failure leaves the adapter LOST and retired.
  function mutate(validate, body) {
    const holder = capability();
    // Snapshot validated inputs at call time, BEFORE the queue boundary:
    // later caller mutation of buffers or records cannot change what persists.
    const args = validate();
    return serial(async () => {
      const fence = () => { if (!isLive(holder)) refuse('lock holder settled; mutation refused'); };
      if (!isLive(holder)) fail('lock holder settled; queued mutation refused');
      try { await control('BEGIN'); } catch (e) { if (!lost) markLost(); throw e; }
      let refusal = null;
      let result;
      try {
        fence();
        const pid = await raw('SELECT pg_backend_pid() AS pid', []);
        if (!(pid.rows.length === 1 && pid.rows[0].pid === holder.pid)) {
          markLost(); // a swapped backend is not our session: retire it
          fail('backend session changed; mutation refused; adapter is permanently invalid');
        }
        fence();
        result = await body(args, fence);
        fence();
      } catch (e) {
        // Anything but a definite refusal leaves the transaction state
        // unproven: retire the exact session (never ROLLBACK and reuse it).
        if (lost || !e || !e.refusal) { if (!lost) markLost(); throw e; }
        refusal = e.message;
      }
      if (refusal !== null) {
        try { await control('ROLLBACK'); } catch (e) { if (!lost) markLost(); throw e; }
        fail(refusal.replace(/^settlement-postgres-adapter: /, ''));
      }
      // Once dispatched, the outcome may stay uncertain; durable only on an
      // affirmative COMMIT completion tag.
      try { await control('COMMIT'); } catch (e) { if (!lost) markLost(); throw e; }
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
        + (terminalDomain?' UNION ALL SELECT 5 AS ord, history_bytes AS bytes FROM '+T.terminal+' WHERE scope = $1':'')
        + ') AS traces ORDER BY ord LIMIT 1', 'trace', RECORD_MAX_BYTES);
    },
    async writeTemp(bytes) {
      await mutate(() => {
        const copy = copyBytesArg(bytes, 'document temp');
        check(copy.length <= DOCUMENT_MAX_BYTES, 'document temp exceeds the size bound');
        return copy;
      }, async copy => {
        const r = await raw('INSERT INTO ' + T.staged + ' (scope, bytes) VALUES ($1, $2)'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes', [scope, copy]);
        if (r.rowCount !== 1) refuse('staged write affected an unexpected row count');
      });
    },
    async commitTemp() {
      // Head promotion and stage consumption in ONE statement in ONE txn.
      // "Nothing staged" is a successful SQL outcome (0 rows), refused.
      await mutate(() => null, async () => {
        const r = await raw('WITH s AS (DELETE FROM ' + T.staged + ' WHERE scope = $1 RETURNING scope, bytes)'
          + ' INSERT INTO ' + T.head + ' (scope, bytes) SELECT scope, bytes FROM s'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes RETURNING scope', [scope]);
        if (r.rowCount !== 1) refuse('no staged document to commit');
      });
    },
    async discardTemp() {
      await mutate(() => null, async () => {
        await raw('DELETE FROM ' + T.staged + ' WHERE scope = $1', [scope]);
      });
    },
  };

  const journalStore = {
    async read() {
      return read('SELECT bytes FROM ' + T.journal + ' WHERE scope = $1', 'journal', RECORD_MAX_BYTES);
    },
    async write(record) {
      await mutate(() => {
        check(isRecord(record), 'journal write requires a record');
        // bytea, never jsonb: byte-identical to the file adapter.
        const bytes = Buffer.from(JSON.stringify(record), 'utf8');
        check(bytes.length <= RECORD_MAX_BYTES, 'journal exceeds the size bound');
        return bytes;
      }, async bytes => {
        const r = await raw('INSERT INTO ' + T.journal + ' (scope, bytes) VALUES ($1, $2)'
          + ' ON CONFLICT (scope) DO UPDATE SET bytes = EXCLUDED.bytes', [scope, bytes]);
        if (r.rowCount !== 1) refuse('journal write affected an unexpected row count');
      });
    },
    async clear() {
      await mutate(() => null, async () => {
        await raw('DELETE FROM ' + T.journal + ' WHERE scope = $1', [scope]);
      });
    },
  };

  const quarantine = {
    async put(label, bytes) {
      const name = await mutate(() => {
        check(typeof label === 'string' && LABEL_RE.test(label), 'quarantine label is malformed');
        const copy = copyBytesArg(bytes, 'quarantine bytes');
        check(copy.length <= RECORD_MAX_BYTES, 'quarantine bytes exceed the size bound');
        return { copy, name: label + '-' + crypto.randomBytes(16).toString('hex') };
      }, async ({ copy, name: n }) => {
        const r = await raw('INSERT INTO ' + T.quarantine + ' (scope, name, label, bytes) VALUES ($1, $2, $3, $4)',
          [scope, n, label, copy]);
        if (r.rowCount !== 1) refuse('quarantine insert affected an unexpected row count');
        return n;
      });
      return name;
    },
  };

  const terminalSelect='SELECT history_bytes, checkpoint_bytes FROM '+T.terminal+' WHERE scope = $1 LIMIT 2';
  function terminalRow(res) {
    if(res.command!=='SELECT'||res.rows.length>1){markLost();fail('terminal history protocol failed; outcome unknown');}
    check(res.rows.length===1,'terminal history missing; explicit provisioning required');
    const row=res.rows[0];
    if(!row||!Buffer.isBuffer(row.history_bytes)||!Buffer.isBuffer(row.checkpoint_bytes)){
      markLost();fail('terminal history columns malformed; outcome unknown');
    }
    check(row.history_bytes.length<=RECORD_MAX_BYTES&&row.checkpoint_bytes.length<=CHECKPOINT_MAX_BYTES,'terminal history exceeds size bound');
    const historyBytes=Buffer.from(row.history_bytes),checkpointBytes=Buffer.from(row.checkpoint_bytes);
    let state;try{state=TC.qualifySnapshot({historyBytes,checkpoint:JSON.parse(checkpointBytes.toString('utf8'))},terminalDomain);}
    catch{fail('terminal history/checkpoint qualification failed');}
    return {historyBytes,checkpointBytes,state};
  }
  const terminalHistory=terminalDomain?{
    async readSnapshot(){
      readGuard();return serial(async()=>{readGuard();const pair=terminalRow(await raw(terminalSelect,[scope]));
        return {historyBytes:Buffer.from(pair.historyBytes),checkpoint:JSON.parse(JSON.stringify(pair.state.checkpoint))};});
    },
    async compareAndAppend(input){
      const result=await mutate(()=>{
        let request;try{request=TC.own(input);}catch{fail('terminal append input malformed');}
        check(isRecord(request)&&Object.keys(request).sort().join(',')==='certificate,expectedCheckpoint'
          &&TC.isCertificate(request.certificate)&&request.certificate.householdId===terminalDomain.householdId
          &&request.certificate.ledgerNamespace===terminalDomain.ledgerNamespace,'terminal append input malformed');
        const e=request.expectedCheckpoint;
        check(isRecord(e)&&Object.keys(e).sort().join(',')==='digest,householdId,ledgerNamespace,revision,schema'
          &&e.schema==='terminal-history-checkpoint-1'&&e.householdId===terminalDomain.householdId
          &&e.ledgerNamespace===terminalDomain.ledgerNamespace&&Number.isSafeInteger(e.revision)&&e.revision>=0
          &&typeof e.digest==='string'&&/^[a-f0-9]{64}$/.test(e.digest),'terminal append checkpoint malformed');
        return request;
      },async(request,fence)=>{
        const prior=terminalRow(await raw(terminalSelect,[scope]));fence();
        if(!isDeepStrictEqual(request.expectedCheckpoint,prior.state.checkpoint)
          ||prior.state.history.records.some(r=>r.operationId===request.certificate.operationId))return null;
        const payload={schema:prior.state.history.schema,householdId:terminalDomain.householdId,
          ledgerNamespace:terminalDomain.ledgerNamespace,revision:prior.state.history.revision+1,
          records:[...prior.state.history.records,request.certificate]};
        const digest=C.digest(payload),historyBytes=Buffer.from(JSON.stringify({...payload,digest}));
        const checkpoint={...prior.state.checkpoint,revision:payload.revision,digest};
        const checkpointBytes=Buffer.from(JSON.stringify(checkpoint));
        check(historyBytes.length<=RECORD_MAX_BYTES&&checkpointBytes.length<=CHECKPOINT_MAX_BYTES,'terminal append exceeds size bound');
        // Validate with incumbent rules without advancing the live floor before
        // COMMIT. A definite CAS miss must not create a fictitious higher floor.
        TC.qualifySnapshot({historyBytes,checkpoint},{...terminalDomain});fence();
        const ack=await raw('UPDATE '+T.terminal+' SET history_bytes = $2, checkpoint_bytes = $3'
          +' WHERE scope = $1 AND history_bytes = $4 AND checkpoint_bytes = $5',
        [scope,historyBytes,checkpointBytes,prior.historyBytes,prior.checkpointBytes]);fence();
        check(ack.command==='UPDATE'&&ack.rows.length===0&&(ack.rowCount===0||ack.rowCount===1),'terminal append acknowledgement malformed');
        return ack.rowCount===1?{historyBytes,checkpoint}:null;
      });
      // mutate resolves only after affirmative COMMIT; no automatic reread/retry.
      if(result===null)return false;
      TC.qualifySnapshot(result,terminalDomain);return true;
    },
  }:null;

  const lock = {
    async withLock(fn) {
      check(typeof fn === 'function', 'withLock requires a function');
      check(!lost, 'session lost; lock refused');
      // Advisory locks are reentrant per session: any nested or
      // overlapping call on this adapter is refused, never re-acquired.
      check(current === null && !als.getStore(), 'settlement store lock is already held by this adapter');
      const holder = Object.freeze({ id: crypto.randomBytes(8).toString('hex'), pid: null });
      current = holder; // reserve synchronously
      try {
        const pid = await serial(async () => {
          check(current === holder && !lost, 'lock acquisition superseded');
          const got = await raw('SELECT pg_try_advisory_lock($1, $2) AS locked', lockKeys);
          check(got.rows.length === 1 && typeof got.rows[0].locked === 'boolean', 'malformed lock acknowledgement');
          if (got.rows[0].locked === false) return null; // definite: held elsewhere
          const p = await raw('SELECT pg_backend_pid() AS pid', []);
          if (!(p.rows.length === 1 && Number.isSafeInteger(p.rows[0].pid))) {
            markLost();
            fail('backend pid unavailable; adapter is permanently invalid');
          }
          return p.rows[0].pid;
        }).catch(e => { if (!lost) markLost(); throw e; });
        if (pid === null) fail('settlement store lock is held elsewhere; acquisition refused');
        // Holder identity captured once, immutable for its lifetime.
        const bound = Object.freeze({ id: holder.id, pid });
        current = bound;
        if (lost) fail('session lost; lock refused');
        live.add(bound);
        try {
          return await als.run(bound, fn);
        } finally {
          // Invalidate BEFORE release; the unlock queues behind any started
          // transaction (which aborts at its next check) and stale queued
          // work refuses at dequeue.
          live.delete(bound);
          if (!lost) {
            try {
              await serial(async () => {
                const r = await raw('SELECT pg_advisory_unlock($1, $2) AS unlocked', lockKeys);
                if (!(r.rows.length === 1 && r.rows[0].unlocked === true)) markLost(); // retire: release unproven
              });
            } catch { if (!lost) markLost(); /* any unlock failure: release unproven, retire */ }
          }
        }
      } finally {
        current = null;
      }
    },
  };

  return Object.freeze({
    documentStore: Object.freeze(documentStore),
    journalStore: Object.freeze(journalStore),
    quarantine: Object.freeze(quarantine),
    lock: Object.freeze(lock),
    ...(terminalHistory?{terminalHistory:Object.freeze(terminalHistory)}:{}),
    contract: terminalHistory?NATIVE_RELATION_CONTRACT:RELATION_CONTRACT,
  });
}

module.exports = {
  createSettlementEvidencePostgresAdapter, RELATION_CONTRACT, DOCUMENT_MAX_BYTES, RECORD_MAX_BYTES,
};
