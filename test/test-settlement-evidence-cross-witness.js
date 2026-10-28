'use strict';
// Cross-witness observation log (anchor/epoch S3, design §2.3.5).
// Injected-session doubles only. Not PostgreSQL, not a qualification.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ROOT = process.env.ATLAS_TEST_APP_ROOT || path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'scripts/settlement-evidence-cross-witness'));

const SCHEMA = 'atlas_witness_synthetic';
const scope = 'b4-auth-scope';
const other = 'b4-other-scope';
const H = n => n.repeat(64).slice(0, 64);
const inc = n => H(String(n));
let T = 1_760_000_000_000;
const tick = () => (T += 7);

function session() {
  const rows = [];
  const calls = [];
  const listeners = { error: new Set(), end: new Set() };
  let retired = 0;
  let failNext = null;
  const s = {
    rows, calls,
    failNext(mode) { failNext = mode; },
    async query(text, values) {
      calls.push(text);
      if (failNext) {
        const mode = failNext;
        failNext = null;
        if (mode === 'throw') throw Object.assign(new Error('synthetic'), { code: '57P01' });
      }
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { command: text, rows: [], rowCount: 0 };
      }
      if (text.startsWith('INSERT INTO')) {
        const [sc, incarnation, epoch, frontierDigest, recordHash, eventId, observedAt] = values;
        if (rows.some(r => r.scope === sc && r.incarnation === incarnation && r.epoch === epoch)) {
          throw Object.assign(new Error('duplicate'), { code: '23505' });
        }
        rows.push({
          scope: sc, incarnation, epoch, frontier_digest: frontierDigest,
          record_hash: recordHash, event_id: eventId, observed_at: observedAt,
        });
        return { command: 'INSERT', rows: [], rowCount: 1 };
      }
      if (text.includes('incarnation = $2')) {
        const [sc, incarnation, epoch] = values;
        const found = rows.filter(r => r.scope === sc && r.incarnation === incarnation && r.epoch === epoch);
        return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
      }
      if (text.includes('WHERE scope = $1')) {
        const found = rows.filter(r => r.scope === values[0]);
        return { command: 'SELECT', rows: found.map(r => ({ ...r })), rowCount: found.length };
      }
      throw new Error('unmatched witness SQL');
    },
    on(event, fn) { listeners[event].add(fn); },
    retire() { retired += 1; return Promise.resolve(); },
    retired: () => retired,
    emit(event) { for (const fn of listeners[event]) fn(); },
  };
  return s;
}
function observation(over = {}) {
  return {
    scope, incarnation: inc('a'), epoch: 0, frontierDigest: inc('b'),
    recordHash: inc('c'), eventId: inc('d'), observedAt: tick(), ...over,
  };
}
function open(sess = session()) {
  const store = W.createSettlementEvidenceCrossWitness({ session: sess, schema: SCHEMA });
  return { store, sess };
}

test('CW-S1 a genesis observation is durable and a second identical write is already-present', async () => {
  const { store, sess } = open();
  const genesis = observation({ epoch: 0 });
  assert.deepEqual(await store.appendObservation(genesis), { outcome: 'appended' });
  assert.equal(sess.rows.length, 1);
  assert.deepEqual(await store.appendObservation(genesis), { outcome: 'already-present' });
  assert.equal(sess.rows.length, 1);
  const head = await store.readHead({ scope });
  assert.equal(head.state, 'ok');
  assert.equal(head.head.epoch, 0);
  assert.equal(head.head.eventId, genesis.eventId);
});

test('CW-S2 a per-advance observation is appended after genesis', async () => {
  const { store } = open();
  await store.appendObservation(observation({ epoch: 0, eventId: inc('1') }));
  const advance = observation({ epoch: 1, eventId: inc('2'), frontierDigest: inc('e'), recordHash: inc('f') });
  assert.deepEqual(await store.appendObservation(advance), { outcome: 'appended' });
  const listed = await store.listObservations({ scope });
  assert.equal(listed.state, 'ok');
  assert.deepEqual(listed.observations.map(o => o.epoch).sort(), [0, 1]);
});

test('CW-S3 the head is the greatest (incarnation, epoch), not the highest epoch', async () => {
  const { store } = open();
  await store.appendObservation(observation({
    incarnation: inc('a'), epoch: 9, eventId: inc('1'),
  }));
  await store.appendObservation(observation({
    incarnation: inc('b'), epoch: 0, eventId: inc('2'), frontierDigest: inc('e'), recordHash: inc('f'),
  }));
  const head = await store.readHead({ scope });
  assert.equal(head.head.incarnation, inc('b'));
  assert.equal(head.head.epoch, 0);
  const otherHead = await store.readHead({ scope: other });
  assert.equal(otherHead.state, 'ok');
  assert.equal(otherHead.head, null);
});

test('CW-S4 a same-key observation with different bytes is refused and the original row remains', async () => {
  const { store, sess } = open();
  const genesis = observation({ epoch: 1 });
  await store.appendObservation(genesis);
  const conflict = await store.appendObservation({ ...genesis, observedAt: tick() });
  assert.deepEqual(conflict, { outcome: 'refused', reason: 'observation-conflict' });
  assert.equal(sess.rows.length, 1);
  assert.equal(sess.rows[0].observed_at, genesis.observedAt);
  assert.equal(store.status().accepting, true);
});

test('CW-S5 session loss resolves unknown and retires the store', async () => {
  const { store, sess } = open();
  sess.failNext('throw');
  const lost = await store.appendObservation(observation());
  assert.deepEqual(lost, { outcome: 'unknown' });
  assert.equal(store.status().accepting, false);
  assert.equal(sess.retired(), 1);
  const again = await store.readHead({ scope });
  assert.deepEqual(again, { state: 'unknown' });
  assert.equal(sess.retired(), 1, 'the session is retired once');
  assert.equal(sess.rows.length, 0);
});

test('CW-S6 an error event retires the store without a further successful write', async () => {
  const { store, sess } = open();
  sess.emit('error');
  assert.equal(store.status().accepting, false);
  assert.deepEqual(await store.appendObservation(observation()), { outcome: 'unknown' });
  assert.equal(sess.rows.length, 0);
});

test('CW-S7 construction refuses a bad session or schema before any query', async () => {
  const sess = session();
  assert.throws(() => W.createSettlementEvidenceCrossWitness({ session: {}, schema: SCHEMA }), TypeError);
  assert.throws(() => W.createSettlementEvidenceCrossWitness({ session: sess, schema: 'pg_bad' }), TypeError);
  assert.equal(sess.calls.length, 0);
  assert.throws(() => W.createSettlementEvidenceCrossWitness({
    session: sess, schema: SCHEMA, scope: 'extra',
  }), TypeError);
});
