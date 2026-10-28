'use strict';
// Cross-witness connection preflight. Injected Client only — not PostgreSQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const M = require(path.join(ROOT, 'scripts/settlement-evidence-cross-witness-connection'));
const openFactory = M.createSettlementEvidenceCrossWitnessConnection;

const host = 'db.example.test';
const CANARY = 'PUBLIC-DUMMY-NOT-A-CREDENTIAL-CANARY';
const SCHEMA = 'atlas_witness_synthetic';
const config = () => ({
  host, port: 5432, database: 'synthetic', user: 'synthetic_witness',
  password: CANARY, ssl: { rejectUnauthorized: true, servername: host },
});
const H = n => String(n).repeat(64).slice(0, 64);
let T = 1_760_000_000_000;
const tick = () => (T += 7);
const col = (name, type) => ({ name, type, notNull: true, generated: '' });
function witnessRelation(over = {}) {
  return {
    name: 'auth_anchor_observation', kind: 'r', persistence: 'p', rls: false, forceRls: false,
    unsafe: false, primaryKeyCount: 1,
    columns: [col('scope', 'text'), col('incarnation', 'text'), col('epoch', 'bigint'),
      col('frontier_digest', 'text'), col('record_hash', 'text'), col('event_id', 'text'),
      col('observed_at', 'bigint')],
    primaryKey: ['scope', 'incarnation', 'epoch'], ...over,
  };
}
function projectPrivileges(text, grants) {
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']) {
    assert.ok(text.includes("has_table_privilege(format('%I.%I',$1,t.name),'" + p + "')"), p);
  }
  for (const p of ['UPDATE', 'REFERENCES']) {
    assert.ok(text.includes("has_any_column_privilege(format('%I.%I',$1,t.name),'" + p + "')"), p);
  }
  assert.ok(text.includes("'auth_anchor_observation'"), 'the witness profile names its one relation');
  const g = grants.table;
  const tables = g.has('SELECT') && g.has('INSERT') && !g.has('UPDATE') && !g.has('DELETE')
    && !g.has('TRUNCATE') && !g.has('TRIGGER') && !g.has('REFERENCES');
  return {
    connect: grants.connect, schemaUsage: grants.schemaUsage,
    databaseCreate: grants.databaseCreate, schemaCreate: grants.schemaCreate, tables,
  };
}
function world(options = {}) {
  const rows = [];
  const w = {
    constructed: 0, connects: 0, ends: 0, queries: [], rows,
    identity: { database: 'synthetic', user: 'synthetic_witness', pid: 271, searchPath: 'pg_catalog' },
    role: {
      canLogin: true, superuser: false, createDb: false, createRole: false, inherit: false,
      replication: false, bypassRls: false, connectionLimit: 1, memberships: 0, ownedObjects: 0,
    },
    grants: {
      connect: true, schemaUsage: true, databaseCreate: false, schemaCreate: false,
      table: new Set(['SELECT', 'INSERT']),
    },
    relations: [witnessRelation()],
  };
  class Client extends EventEmitter {
    constructor(c) {
      super();
      w.constructed++;
      w.clients = [this];
      this.connection = {
        stream: {
          encrypted: true, authorized: true, servername: host,
          getPeerCertificate: () => ({ subjectaltname: 'DNS:' + host }),
        },
      };
      if (options.tls) Object.assign(this.connection.stream, options.tls);
    }
    async connect() { w.connects++; }
    async end() { w.ends++; this.emit('end'); }
    async query(text, values) {
      w.queries.push({ text, values });
      if (text.includes('has_table_privilege')) {
        return { command: 'SELECT', rows: [projectPrivileges(text, w.grants)] };
      }
      if (text.includes('current_database() AS database')) return { command: 'SELECT', rows: [{ ...w.identity }] };
      if (text.includes('pg_roles')) return { command: 'SELECT', rows: [{ ...w.role }] };
      if (text.includes('pg_class')) {
        assert.ok(/LIMIT 2\b/.test(text), 'SCHEMA must probe with LIMIT 2');
        return {
          command: 'SELECT',
          rows: w.relations.map(r => ({
            ...r, columns: r.columns.map(c => ({ ...c })), primaryKey: r.primaryKey.slice(),
          })),
        };
      }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { command: text, rows: [], rowCount: 0 };
      }
      if (text.startsWith('INSERT INTO')) {
        const [scope, incarnation, epoch, frontierDigest, recordHash, eventId, observedAt] = values;
        rows.push({
          scope, incarnation, epoch, frontier_digest: frontierDigest,
          record_hash: recordHash, event_id: eventId, observed_at: observedAt,
        });
        return { command: 'INSERT', rows: [], rowCount: 1 };
      }
      if (text.includes('incarnation = $2')) {
        const [scope, incarnation, epoch] = values;
        const found = rows.filter(r => r.scope === scope && r.incarnation === incarnation && r.epoch === epoch);
        return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
      }
      if (text.includes('WHERE scope = $1')) {
        const found = rows.filter(r => r.scope === values[0]);
        return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
      }
      throw new Error('unmatched SQL');
    }
  }
  w.Client = Client;
  w.open = extra => openFactory({ Client, config: config(), schema: SCHEMA, ...extra });
  return w;
}
const rejection = async promise => {
  const e = await promise.then(() => null, err => err);
  assert.ok(e, 'factory must reject');
  assert.equal(e.code, 'SETTLEMENT_CROSS_WITNESS_CONNECTION');
  assert.ok(!JSON.stringify(e).includes(CANARY));
  return e;
};
function observation(over = {}) {
  return {
    scope: 'b4-auth-scope', incarnation: H('a'), epoch: 0, frontierDigest: H('b'),
    recordHash: H('c'), eventId: H('d'), observedAt: tick(), ...over,
  };
}

test('CW-C1 the witness profile opens one session and writes a genesis observation', async () => {
  const w = world();
  const owner = await w.open();
  assert.deepEqual(Object.keys(owner).sort(), ['retire', 'status', 'witnessStore']);
  assert.equal(w.queries.length, 4);
  assert.equal(w.config ? undefined : undefined, undefined);
  assert.equal(w.queries[2].text.includes('auth_anchor_observation'), true);
  assert.equal(owner.status().state, 'ready');
  assert.deepEqual(await owner.witnessStore.appendObservation(observation()), { outcome: 'appended' });
  const head = await owner.witnessStore.readHead({ scope: 'b4-auth-scope' });
  assert.equal(head.head.epoch, 0);
  const report = await owner.retire();
  assert.equal(report.close, 'confirmed');
  assert.equal(w.ends, 1);
});

test('CW-C2 session loss resolves unknown and retires the owner', async () => {
  const w = world();
  const owner = await w.open();
  w.clients[0].emit('error', Object.assign(new Error(CANARY), { code: 'ECONNRESET' }));
  await new Promise(r => setImmediate(r));
  assert.notEqual(owner.status().state, 'ready');
  assert.equal(owner.status().primary.code, 'ECONNRESET');
  assert.ok(!JSON.stringify(owner.status()).includes(CANARY));
  assert.deepEqual(await owner.witnessStore.appendObservation(observation()), { outcome: 'unknown' });
  assert.equal(owner.witnessStore.status().accepting, false);
});

test('CW-C3 preflight refuses a schema that is not exactly the witness profile', async () => {
  const cases = [
    () => { const w = world(); w.relations.push(witnessRelation({ name: 'auth_revocation' })); return w; },
    () => { const w = world(); w.relations = []; return w; },
    () => { const w = world(); w.relations = [witnessRelation({ name: 'auth_eligibility' })]; return w; },
    () => { const w = world(); w.grants.table.add('UPDATE'); return w; },
    () => { const w = world(); w.grants.table.add('DELETE'); return w; },
    () => { const w = world(); w.grants.table.add('TRUNCATE'); return w; },
    () => {
      const w = world();
      w.relations[0].columns = w.relations[0].columns.filter(c => c.name !== 'observed_at');
      return w;
    },
    () => { const w = world(); w.relations[0].primaryKey = ['scope', 'event_id']; return w; },
    () => { const w = world(); w.relations[0].columns[2].notNull = false; return w; },
  ];
  for (const make of cases) {
    const w = make();
    const e = await rejection(w.open());
    assert.ok(e.diagnostic.stage === 'schema' || e.diagnostic.stage === 'privileges', e.diagnostic.stage);
    assert.equal(w.ends, 1);
  }
});

test('CW-C4 the module exports only the factory', () => {
  assert.deepEqual(Object.keys(M), ['createSettlementEvidenceCrossWitnessConnection']);
});
