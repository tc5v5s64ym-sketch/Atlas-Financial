'use strict';

// ATLAS-080: standalone, strictly synthetic caller-boundary proof. The real
// contract/store/POSIX adapter write only into disposable private OS temp
// directories. Authorization, identity mappings, independent pin and backups
// are deterministic fixtures; none is a production identity implementation.
// Registered through the shared manifest; no production controller consumer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const C = require('../scripts/planned-obligation-settlement-contract');
const S = require('../scripts/settlement-evidence-store');
const A = require('../scripts/settlement-evidence-file-adapter');
const L = require('../scripts/settlement-evidence-loader');
const { createSettlementEvidenceConfirmation } = require('../scripts/settlement-evidence-confirmation');

const householdId = 'household-' + 'a'.repeat(32);
const actorId = 'session-' + 'b'.repeat(64);
const otherActor = 'session-' + 'c'.repeat(64);
const op = n => 'operation-' + n.toString(16).padStart(32, '0');
const tx = n => 'tx-' + n.toString(16).padStart(32, '0');
const selection = { transaction: 'selection-' + '1'.repeat(32), commitment: 'choice-' + '2'.repeat(32) };
const context = { ticket: 'synthetic-session-a' };
const otherContext = { ticket: 'synthetic-session-b' };
const T0 = Date.parse('2026-10-20T12:00:00Z');
const clone = x => JSON.parse(JSON.stringify(x));
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function resolved() {
  return {
    matchCount: 1,
    identity: { householdId, source: 'lunchmoney', providerAccountId: 'synthetic-provider-account', transactionId: 'synthetic-provider-transaction' },
    txRef: tx(1), selectionBinding: 'synthetic-private-selection-v1',
    goalId: 'commitment:synthetic-trip', goalBinding: 'synthetic-plan-goal-v1',
    asOf: '2026-10-20',
    evidence: { accountId: 'synthetic-cash', currency: 'cad', direction: 'debit', date: '2026-10-19', cents: 6000, posted: true },
  };
}
const request = (n = 1, cents = 2500) => ({ operationId: op(n), selection: clone(selection), assignedCents: cents });

// Rule E classification fixtures: a synthetic provider transaction, plan and
// current-period packet whose verdicts come from the REAL Forecast
// classifier, invoked by the fixture resolver through the controller-owned
// classify closure (never a copied label set). Amounts are dollars, the
// classifier's convention. The default is E2: a Groceries spend with
// merchant identity against a plan whose categories match it.
function classificationFixture(kind = 'spend-groceries') {
  const plan = { budget: { categories: [
    { id: 'groceries', label: 'Groceries' },
    { id: 'restaurants', label: 'Restaurants' },
    { id: 'insurance', label: 'Home Insurance' },
  ], excluded: [] } };
  const packet = { representedActuals: [], transactions: [] };
  const base = { id: 'synthetic-provider-transaction', date: '2026-10-19' };
  const txs = {
    'spend-groceries': { ...base, amount: 60, categoryLabel: 'Groceries', merchantKnown: true },
    'spend-restaurants': { ...base, amount: 60, categoryLabel: 'Restaurants', merchantKnown: true },
    'transfer': { ...base, amount: 500, categoryLabel: 'Credit Card Payment' },
    'card-payment-td': { ...base, amount: 500, categoryLabel: 'Groceries', merchantKnown: true, tfrReference: 'AB123', tfrDirection: 'TO', tdCardPaymentIdentity: true },
    'internal-movement': { ...base, amount: -200, atlasAccountId: 'chequing-a', accountRole: 'household-cash', tfrReference: 'AB123', tfrDirection: 'FR' },
    'unclassified': { ...base, amount: 25, categoryLabel: 'Lottery Winnings' },
    'cancelled-service': { ...base, amount: 30, payee: 'OLD GYM' },
    'refund': { ...base, amount: 40, categoryLabel: 'Refund' },
    'bill-represented': { ...base, amount: 120, categoryLabel: 'Groceries', merchantKnown: true },
    'bill-label': { ...base, amount: 120, categoryLabel: 'Insurance' },
    'bill-bills-only': { ...base, amount: 90, categoryLabel: 'Home Insurance' },
    'income': { ...base, amount: 900, isIncome: true },
  };
  const opts = { currentPeriodActuals: packet };
  if (kind === 'internal-movement') {
    packet.transactions = [txs[kind], { id: 'synthetic-provider-counterpart', amount: 200,
      atlasAccountId: 'chequing-b', accountRole: 'household-cash', tfrReference: 'AB123', tfrDirection: 'TO', date: '2026-10-19' }];
  }
  if (kind === 'bill-represented') packet.representedActuals = [{ transactionId: base.id }];
  if (kind === 'cancelled-service') {
    plan.cancelledServices = [{ id: 'synthetic-cancelled-service', label: 'Old Gym', confirmedCancelledAsOf: '2026-10-01', merchantKeys: ['old gym'] }];
  }
  return { tx: txs[kind], plan, opts };
}

async function world(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-confirmation-'));
  fs.chmodSync(dir, 0o700);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const w = {
    dir, time: T0, pin: null, backups: new Map(), writes: [], calls: [], tokens: new Map(),
    authority: { householdId, actorId }, source: resolved(),
    authHook: null, resolveHook: null, prepareHook: null, commitHook: null, outcomeHook: null,
    lostPinAck: false, unreadablePin: false, failBackup: false,
  };
  const pinStore = {
    async read() { if (w.unreadablePin) throw Error('synthetic secret failure'); return clone(w.pin); },
    async advance(expected, next) {
      w.writes.push('pin');
      const ok = expected === null ? w.pin === null
        : w.pin && expected.revision === w.pin.revision && expected.digest === w.pin.digest;
      if (!ok) return false;
      w.pin = clone(next);
      if (w.lostPinAck) { w.lostPinAck = false; throw Error('synthetic lost acknowledgement'); }
      return true;
    },
  };
  const backupStore = {
    async put(revision, digest, bytes) {
      w.writes.push('backup');
      if (w.failBackup) throw Error('synthetic backup failure');
      const entry = { revision, digest, artifactId: 'synthetic-backup-' + revision };
      w.backups.set(digest, { ...entry, bytes: Buffer.from(bytes) });
      return clone(entry);
    },
    async get(revision, digest) {
      const value = w.backups.get(digest);
      return value && value.revision === revision ? Buffer.from(value.bytes) : null;
    },
    async list() { return [...w.backups.values()].map(({ bytes, ...entry }) => clone(entry)); },
  };
  w.openStore = () => {
    const a = A.createSettlementEvidenceFileAdapter(dir);
    for (const [adapter, methods] of [[a.documentStore, ['writeTemp', 'commitTemp', 'discardTemp']],
      [a.journalStore, ['write', 'clear']], [a.quarantine, ['put']]]) {
      for (const method of methods) {
        const original = adapter[method].bind(adapter);
        adapter[method] = async (...args) => { w.writes.push(method); return original(...args); };
      }
    }
    return S.createSettlementEvidenceStore({ householdId, ...a, pinStore, backupStore, now: () => w.time });
  };
  w.store = w.openStore();
  assert.equal((await w.store.bootstrap()).status, 'bootstrapped');
  w.writes.length = 0;
  w.authorize = async ctx => {
    w.calls.push('authorize');
    if (w.authHook) return w.authHook(ctx);
    if (ctx.ticket === otherContext.ticket) return { householdId, actorId: otherActor };
    if (ctx.ticket !== context.ticket) return null;
    return w.authority;
  };
  w.classification = classificationFixture();
  w.classifyCalls = [];
  // The fixture resolver honours the extended contract: exactly one classify
  // invocation per resolve, on the fixture tx/plan/packet, through the
  // controller-owned closure. Against a controller that supplies no classify
  // closure this is a no-op, which is what makes the Rule E pins fail (not
  // crash) when the suite runs against the base controller.
  w.classifyOnce = input => {
    if (typeof input.classify !== 'function') return null;
    const { tx, plan, opts } = w.classification;
    const verdict = input.classify(clone(tx), clone(plan), clone(opts));
    w.classifyCalls.push(verdict);
    return verdict;
  };
  w.resolve = async input => {
    w.calls.push('resolve');
    assert.equal(input.authority.householdId, householdId);
    assert([actorId, otherActor].includes(input.authority.actorId));
    assert.deepEqual(input.selection, selection);
    // Exact fixture mapping only: content never participates in txRef identity.
    if (w.resolveHook) return w.resolveHook(input);
    w.classifyOnce(input);
    return w.source;
  };
  w.newController = (store = w.store) => createSettlementEvidenceConfirmation({
    householdId, authorize: w.authorize, resolveSelection: w.resolve, now: () => w.time,
    store: {
      async prepare(input) {
        w.calls.push('prepare');
        return w.prepareHook ? w.prepareHook(input, store) : store.prepare(input);
      },
      async commitWithoutRecovery(input) {
        w.calls.push('commitWithoutRecovery');
        return w.commitHook ? w.commitHook(input, store) : store.commitWithoutRecovery(input);
      },
      commit() { assert.fail('controller must never fall back to ordinary recovering commit'); },
      async outcome(input) {
        w.calls.push('outcome');
        return w.outcomeHook ? w.outcomeHook(input, store) : store.outcome(input);
      },
      bootstrap() { assert.fail('controller must never bootstrap'); },
      reconcile() { assert.fail('controller must never reconcile'); },
    },
  });
  w.controller = w.newController();
  w.prepare = async (n = 1, cents = 2500, ctx = context) => {
    const result = await w.controller.prepare(ctx, request(n, cents));
    if (result.status === 'prepared') w.tokens.set(op(n), result.previewToken);
    return result;
  };
  w.confirm = (n = 1, confirmed = true, ctx = context) => {
    const previewToken = w.tokens.get(op(n));
    return w.controller.confirm(ctx, { operationId: op(n), confirmed,
      ...(previewToken === undefined ? {} : { previewToken }) });
  };
  w.outcome = (n = 1, ctx = context) => w.controller.outcome(ctx, { operationId: op(n) });
  w.document = () => JSON.parse(fs.readFileSync(path.join(dir, 'document.json'), 'utf8'));
  w.load = async () => L.loadSettlementEvidence({ config: { householdId },
    readPin: () => clone(w.pin), readDocument: () => fs.readFileSync(path.join(dir, 'document.json')) });
  w.count = name => w.calls.filter(x => x === name).length;
  return w;
}

function privateFree(value) {
  const text = JSON.stringify(value);
  for (const raw of [householdId, actorId, otherActor, 'synthetic-provider', 'synthetic-session',
    'synthetic-private', 'synthetic-plan-goal', 'synthetic-cash', 'confirmationDigest', 'expectedDocumentDigest', 'txRef']) {
    assert.equal(text.includes(raw), false, 'private field escaped: ' + raw);
  }
}

test('B2 capacity: 200 live previews block 201, but expiry admits new work', async t => {
  const w = await world(t);
  for (let n = 1; n <= 200; n++) assert.equal((await w.prepare(n, 1)).status, 'prepared', 'live preview ' + n);
  assert.equal((await w.prepare(201, 1)).status, 'unavailable');
  w.time += C.TTL_MS;
  assert.equal((await w.prepare(201, 1)).status, 'prepared', 'expired never-attempted previews must not consume lifetime capacity');
  assert.deepEqual(w.writes, []);
});

test('B2 capacity: more than 200 real successful operations reclaim committed previews', async t => {
  const w = await world(t), tokens = new Set();
  let first;
  for (let n = 1; n <= 205; n++) {
    const prepared = await w.prepare(n, 1);
    assert.equal(prepared.status, 'prepared', 'success cycle ' + n);
    assert.match(prepared.previewToken, /^[a-f0-9]{64}$/);
    assert(!tokens.has(prepared.previewToken)); tokens.add(prepared.previewToken);
    const result = await w.confirm(n);
    assert.equal(result.status, 'committed', 'success cycle ' + n);
    first ||= result;
  }
  assert.equal(w.document().operations.length, 205);
  assert.equal(w.count('commitWithoutRecovery'), 205);
  w.time += C.TTL_MS;
  assert.deepEqual(await w.controller.confirm(context, { operationId: op(1) }), first);
  assert.deepEqual(await w.outcome(1), first);
});

test('B2 terminal refusal: over 200 no-write cycles can reuse an operation without retaining old generations', async t => {
  const w = await world(t), tokens = new Set();
  for (let n = 0; n < 205; n++) {
    const prepared = await w.prepare(1, 1);
    assert.equal(prepared.status, 'prepared', 'refusal cycle ' + n);
    assert(!tokens.has(prepared.previewToken)); tokens.add(prepared.previewToken);
    const mode = n % 4;
    if (mode === 0) w.source.goalBinding = 'synthetic-changed-goal';
    if (mode === 1) w.commitHook = async () => ({ status: 'conflict' });
    if (mode === 2) w.commitHook = async () => ({ status: 'rejected', reason: 'recovery-required' });
    if (mode === 3) w.time += C.TTL_MS;
    const result = await w.confirm();
    assert.deepEqual(result, { status: 'rejected', reason: ['selection-changed', 'store-conflict', 'recovery-required', 'preview-expired'][mode] });
    w.source = resolved(); w.commitHook = null;
  }
  assert.deepEqual(w.writes, []);
  assert.equal((await w.prepare(1, 1)).status, 'prepared');
});

test('B2 generation: expired ID reuse requires the new token and wrong tokens do not retire it', async t => {
  const w = await world(t);
  const old = await w.prepare();
  w.time += C.TTL_MS;
  const next = await w.prepare();
  assert.equal(next.status, 'prepared');
  assert.notEqual(next.previewToken, old.previewToken);
  for (const previewToken of [undefined, old.previewToken, 'f'.repeat(64), 42]) {
    const result = await w.controller.confirm(context, { operationId: op(1), confirmed: true,
      ...(previewToken === undefined ? {} : { previewToken }) });
    assert.equal(result.status, 'rejected');
    assert.equal(w.count('commitWithoutRecovery'), 0);
    assert.deepEqual(w.writes, []);
  }
  assert.equal((await w.prepare()).status, 'unavailable', 'bad tokens must not retire the current live generation');
  assert.equal((await w.confirm()).status, 'committed');
});

test('B2 generation: identical command, frozen clock and rejected ID reuse still get a fresh random token', async t => {
  const w = await world(t), privatePreviews = [];
  w.prepareHook = async (input, store) => {
    const result = await store.prepare(input); privatePreviews.push(clone(result.preview)); return result;
  };
  const old = await w.prepare();
  w.source.goalBinding = 'synthetic-changed-goal';
  assert.equal((await w.confirm()).reason, 'selection-changed');
  w.source = resolved();
  const next = await w.prepare();
  assert.equal(next.status, 'prepared');
  assert.deepEqual(privatePreviews[0], privatePreviews[1], 'store preview/digest/clock are identical across generations');
  assert.equal(w.time, T0);
  assert.match(old.previewToken, /^[a-f0-9]{64}$/); assert.match(next.previewToken, /^[a-f0-9]{64}$/);
  assert.notEqual(next.previewToken, old.previewToken);
  assert.notEqual(next.previewToken, C.digest(privatePreviews[1]));
  assert.notEqual((await w.controller.confirm(context, { operationId: op(1), previewToken: old.previewToken, confirmed: true })).status, 'committed');
  assert.equal((await w.confirm()).status, 'committed');
});

test('B2 tokens: operation and actor swaps fail without committing or retiring either live generation', async t => {
  const w = await world(t);
  const a = await w.prepare(1), b = await w.prepare(2, 1, otherContext);
  assert.equal(a.status, 'prepared'); assert.equal(b.status, 'prepared');
  for (const [ctx, operationId, previewToken] of [
    [context, op(1), b.previewToken], [otherContext, op(2), a.previewToken],
    [context, op(2), b.previewToken], [otherContext, op(1), a.previewToken],
  ]) assert.notEqual((await w.controller.confirm(ctx, { operationId, previewToken, confirmed: true })).status, 'committed');
  assert.deepEqual(w.writes, []);
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.equal((await w.confirm(1, false)).reason, 'confirmation-required');
  assert.equal((await w.confirm(2, false, otherContext)).reason, 'confirmation-required');
  assert.equal((await w.confirm(2, true, otherContext)).status, 'committed');
});

test('B2 nonterminal: confirmation-required and temporarily unavailable selection keep the same generation', async t => {
  const w = await world(t);
  await w.prepare();
  assert.equal((await w.confirm(1, false)).reason, 'confirmation-required');
  assert.equal((await w.prepare()).status, 'unavailable');
  w.resolveHook = async () => { throw Error('synthetic temporarily unavailable'); };
  assert.equal((await w.confirm()).reason, 'selection-unavailable');
  assert.equal((await w.prepare()).status, 'unavailable');
  w.resolveHook = null;
  assert.equal((await w.confirm()).status, 'committed');
});

test('B2 generation race: a paused old confirmation cannot commit after cleanup/reprepare even after clock rollback', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  const old = await w.prepare();
  let pause = true;
  w.resolveHook = async input => {
    if (pause) { pause = false; entered.resolve(); await release.promise; }
    w.classifyOnce(input);
    return resolved();
  };
  const pending = w.controller.confirm(context, { operationId: op(1), previewToken: old.previewToken, confirmed: true });
  await entered.promise;
  w.time += C.TTL_MS;
  const next = await w.prepare(); assert.equal(next.status, 'prepared');
  // Adversarial injected-clock rollback ensures expiry cannot mask a missing
  // final generation-identity check. Restore the new generation's time later.
  w.time = T0;
  release.resolve();
  assert.notEqual((await pending).status, 'committed');
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.deepEqual(w.writes, []);
  w.time = T0 + C.TTL_MS;
  assert.equal((await w.prepare()).status, 'unavailable', 'old cleanup must not delete the replacement');
  assert.equal((await w.confirm()).status, 'committed');
});

test('B2 cleanup race: a terminal result from an old generation cannot delete its replacement', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  await w.prepare();
  let pause = true;
  w.resolveHook = async input => {
    if (pause) {
      pause = false; entered.resolve(); await release.promise;
      w.classifyOnce(input);
      return { ...resolved(), goalBinding: 'synthetic-old-selection-changed' };
    }
    w.classifyOnce(input);
    return resolved();
  };
  const pending = w.confirm(); await entered.promise;
  w.time += C.TTL_MS;
  assert.equal((await w.prepare()).status, 'prepared');
  release.resolve(); assert.equal((await pending).reason, 'selection-changed');
  assert.equal((await w.prepare()).status, 'unavailable');
  assert.deepEqual(w.writes, []);
  assert.equal((await w.confirm()).status, 'committed');
});

test('B2 unknown: past TTL never retries or permits reprepare; only a verified receipt releases it', async t => {
  const w = await world(t);
  const prepared = await w.prepare();
  w.commitHook = async (input, store) => { await store.commitWithoutRecovery(input); throw Error('synthetic lost controller reply'); };
  assert.equal((await w.confirm()).status, 'unknown');
  w.unreadablePin = true; w.time += C.TTL_MS * 2;
  const writes = clone(w.writes);
  assert.equal((await w.prepare()).status, 'unavailable');
  assert.equal((await w.prepare(2, 1)).status, 'unavailable');
  assert.equal((await w.confirm()).status, 'unknown');
  assert.deepEqual(w.writes, writes);
  assert.equal(w.count('commitWithoutRecovery'), 1);
  w.unreadablePin = false;
  const receipt = await w.outcome(); assert.equal(receipt.status, 'committed');
  assert.deepEqual(await w.controller.confirm(context, { operationId: op(1) }), receipt);
  assert.deepEqual(await w.controller.confirm(context, { operationId: op(1), previewToken: 'wrong', confirmed: false }), receipt);
  w.commitHook = null;
  assert.equal((await w.prepare(2, 1)).status, 'prepared');
  assert.equal((await w.confirm(2)).status, 'committed');
  assert.deepEqual(await w.controller.confirm(context, { operationId: op(1) }), receipt);
  assert.equal(w.document().operations.length, 2);
  assert.equal(typeof prepared.previewToken, 'string');
});

test('B2 unknown race: stale selection refusal cannot retire a generation whose other confirmation attempted a write', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  await w.prepare();
  let pause = true;
  w.resolveHook = async input => {
    if (pause) {
      pause = false; entered.resolve(); await release.promise;
      w.classifyOnce(input);
      return { ...resolved(), goalBinding: 'synthetic-stale-goal' };
    }
    w.classifyOnce(input);
    return resolved();
  };
  const old = w.confirm(); await entered.promise;
  w.commitHook = async () => ({ status: 'unknown' });
  assert.equal((await w.confirm()).status, 'unknown');
  release.resolve(); assert.equal((await old).status, 'unknown');
  w.time += C.TTL_MS * 2;
  assert.equal((await w.prepare()).status, 'unavailable');
  assert.equal((await w.confirm()).status, 'unknown');
  assert.equal(w.count('commitWithoutRecovery'), 1);
  assert.deepEqual(w.writes, []);
});

test('B2 in-flight: TTL cannot evict an attempted generation while the sole commit awaits', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  const old = await w.prepare();
  w.commitHook = async (input, store) => { entered.resolve(); await release.promise; return store.commitWithoutRecovery(input); };
  const pending = w.confirm(); await entered.promise;
  w.time += C.TTL_MS;
  assert.equal((await w.prepare()).status, 'unavailable');
  assert.equal((await w.prepare(2, 1)).status, 'unavailable');
  release.resolve(); assert.equal((await pending).reason, 'preview-expired');
  assert.deepEqual(w.writes, []);
  w.commitHook = null;
  const next = await w.prepare(); assert.equal(next.status, 'prepared');
  assert.notEqual(next.previewToken, old.previewToken);
});

test('B2 reservation cap: 200 concurrent preparing reservations block a 201st before awaiting', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  // This POSIX adapter refuses overlapping lock acquisitions. Schedule the
  // fixture's read-only probes serially so the test isolates controller slots.
  let probes = Promise.resolve();
  w.prepareHook = (input, store) => {
    const result = probes.then(() => store.prepare(input));
    probes = result.catch(() => {});
    return result;
  };
  let count = 0;
  w.authHook = async () => {
    if (++count === 200) entered.resolve();
    await release.promise; return { householdId, actorId };
  };
  const pending = Array.from({ length: 200 }, (_, i) => w.prepare(i + 1, 1));
  await entered.promise;
  assert.equal((await w.prepare(201, 1)).status, 'unavailable');
  assert.equal(count, 200);
  release.resolve();
  const results = await Promise.all(pending);
  assert(results.every(result => result.status === 'prepared'));
  assert.equal(new Set(results.map(result => result.previewToken)).size, 200);
  assert.equal((await w.prepare(201, 1)).status, 'unavailable');
  assert.deepEqual(w.writes, []);
});

test('B2 reservation cap: active previews and failing reservations share the same 200 slots', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  for (let n = 1; n <= 199; n++) assert.equal((await w.prepare(n, 1)).status, 'prepared');
  w.authHook = async () => { entered.resolve(); await release.promise; return null; };
  const pending = w.prepare(200, 1); await entered.promise;
  assert.equal((await w.prepare(201, 1)).status, 'unavailable');
  release.resolve(); assert.equal((await pending).status, 'unavailable');
  w.authHook = null;
  assert.equal((await w.prepare(201, 1)).status, 'prepared', 'failed reservation releases only its own slot');
  assert.deepEqual(w.writes, []);
});

test('B2 token boundary: nonce is never accepted at prepare or forwarded to store/document/journal', async t => {
  const w = await world(t), storeInputs = [];
  assert.equal((await w.controller.prepare(context, { ...request(), previewToken: 'f'.repeat(64) })).status, 'unavailable');
  w.prepareHook = async (input, store) => { storeInputs.push(clone(input)); return store.prepare(input); };
  w.commitHook = async (input, store) => { storeInputs.push(clone(input)); return store.commitWithoutRecovery(input); };
  const prepared = await w.prepare();
  w.failBackup = true;
  assert.equal((await w.confirm()).status, 'unknown');
  const privateState = JSON.stringify(storeInputs) + fs.readFileSync(path.join(w.dir, 'document.json'), 'utf8')
    + fs.readFileSync(path.join(w.dir, 'journal.json'), 'utf8')
    + [...w.backups.values()].map(entry => entry.bytes.toString('utf8')).join('');
  assert(!privateState.includes('previewToken'));
  assert(!privateState.includes(prepared.previewToken));
  assert.equal(w.count('commitWithoutRecovery'), 1);
});

test('prepare is read-only and returns only the exact sanitized selection/amount/date/operation/expiry', async t => {
  const w = await world(t);
  const before = fs.readFileSync(path.join(w.dir, 'document.json'));
  const result = await w.prepare();
  const { previewToken, ...shown } = result;
  assert.match(previewToken, /^[a-f0-9]{64}$/);
  assert.deepEqual(shown, { status: 'prepared', operationId: op(1), selection,
    assignedCents: 2500, currency: 'cad', date: '2026-10-19', asOf: '2026-10-20',
    operation: { version: 1, kind: 'link' }, expiresAt: T0 + C.TTL_MS });
  privateFree(result);
  assert(Object.isFrozen(result) && Object.isFrozen(result.selection));
  assert.deepEqual(w.writes, []);
  assert.deepEqual(fs.readFileSync(path.join(w.dir, 'document.json')), before);
  assert.equal((await w.load()).evidence.commitments.length, 0);
  assert.deepEqual(await w.outcome(), { status: 'unknown', operationId: op(1) });
  assert.notEqual((await w.confirm(1, false)).status, 'committed');
  assert.notEqual((await w.controller.confirm(context, { operationId: op(1) })).status, 'committed');
  assert.deepEqual(w.writes, []);
  assert.equal(w.count('commitWithoutRecovery'), 0);
});

test('explicit confirmation lands one original receipt and the independent loader sees household evidence', async t => {
  const w = await world(t);
  await w.prepare();
  const receipt = await w.confirm();
  const doc = w.document();
  assert.deepEqual(receipt, { status: 'committed', operationId: op(1), revision: 1, digest: doc.digest });
  privateFree(receipt);
  assert.equal(doc.operations.length, 1);
  assert.equal(doc.operations[0].actorId, actorId);
  assert.deepEqual((await w.load()).evidence.commitments[0], { goalId: 'commitment:synthetic-trip', links: [{
    operationId: op(1), txRef: tx(1), assignedCents: 2500, effectiveDate: '2026-10-19', asOf: '2026-10-20',
    evidenceDigest: C.digest(resolved().evidence), reversals: [],
  }] });
  const frozen = clone(w.writes);
  assert.deepEqual(await w.confirm(), receipt);
  assert.deepEqual(await w.outcome(), receipt);
  assert.deepEqual(w.writes, frozen);
  assert.equal(w.count('commitWithoutRecovery'), 1);
});

for (const field of ['actorId', 'householdId', 'command', 'evidence', 'evidenceDigest', 'txRef', 'goalId', 'asOf', 'preview', 'confirmationDigest', 'classification', 'verdict']) {
  test('caller cannot submit authority/evidence field ' + field, async t => {
    const w = await world(t);
    assert.equal((await w.controller.prepare(context, { ...request(), [field]: 'forged' })).status, 'unavailable');
    await w.prepare();
    assert.equal((await w.controller.confirm(context, { operationId: op(1), confirmed: true, [field]: 'forged' })).status, 'unavailable');
    assert.equal((await w.controller.outcome(context, { operationId: op(1), [field]: 'forged' })).status, 'unavailable');
    assert.deepEqual(w.writes, []);
  });
}

test('unrecognized session and caller-supplied identities do not establish authority', async t => {
  const w = await world(t);
  const forged = { ticket: 'forged', householdId, actorId };
  for (const call of [() => w.controller.prepare(forged, request()),
    () => w.controller.confirm(forged, { operationId: op(1), confirmed: true }),
    () => w.controller.outcome(forged, { operationId: op(1) })]) {
    const result = await call();
    assert.equal(result.status, 'unavailable'); privateFree(result);
  }
  assert.deepEqual(w.writes, []);
  assert.equal(w.count('resolve'), 0);
});

for (const authority of [null, { householdId, actorId: 'session-old-cookie-expiry' },
  { householdId: 'household-' + 'd'.repeat(32), actorId }, { householdId, actorId: otherActor }]) {
  test('prepare/confirm/outcome reauthorize and reject changed or malformed authority: ' + JSON.stringify(authority), async t => {
    const w = await world(t);
    await w.prepare(); w.authority = authority;
    const result = await w.confirm();
    assert.notEqual(result.status, 'committed'); privateFree(result);
    assert.notEqual((await w.outcome()).status, 'committed');
    assert.deepEqual(w.writes, []);
  });
}

for (const [name, change] of [
  ['ambiguous', r => { r.matchCount = 2; }], ['missing', r => { r.matchCount = 0; }],
  ['pending', r => { r.evidence.posted = false; }], ['credit', r => { r.evidence.direction = 'credit'; }],
  ['USD', r => { r.evidence.currency = 'usd'; }], ['zero debit', r => { r.evidence.cents = 0; }],
  ['invalid date', r => { r.evidence.date = '2026-02-30'; }],
  ['future date', r => { r.evidence.date = '2026-10-21'; }],
  ['unqualified source', r => { r.identity.source = 'plaid'; }],
  ['foreign household', r => { r.identity.householdId = 'household-' + 'd'.repeat(32); }],
  ['tx-N alias', r => { r.txRef = 'tx-1'; }], ['pc alias', r => { r.txRef = 'pc-pending'; }],
  ['provider ID missing', r => { r.identity.transactionId = ''; }],
  ['evidence changed', r => { r.evidence.cents++; }], ['date changed', r => { r.evidence.date = '2026-10-18'; }],
  ['account changed', r => { r.identity.providerAccountId += '-other'; }],
  ['transaction changed', r => { r.identity.transactionId += '-other'; }],
  ['binding changed', r => { r.selectionBinding += '-other'; }],
  ['goal changed', r => { r.goalId = 'commitment:synthetic-other'; }],
  ['goal content changed', r => { r.goalBinding += '-other'; }],
  ['financial as-of changed', r => { r.asOf = '2026-10-21'; }],
  ['stable ref changed', r => { r.txRef = tx(2); }],
]) {
  test('fresh confirmation refuses ' + name + ' without any durable write', async t => {
    const w = await world(t);
    await w.prepare(); change(w.source);
    const result = await w.confirm();
    assert.notEqual(result.status, 'committed'); privateFree(result);
    assert.deepEqual(w.writes, []);
    assert.equal(w.count('commitWithoutRecovery'), 0);
  });
}

test('prepare refuses pending/ambiguous/aliases and never synthesizes posted lineage', async t => {
  const w = await world(t);
  for (const mutate of [r => { r.matchCount = 2; }, r => { r.evidence.posted = false; },
    r => { r.txRef = 'tx-1'; }, r => { r.txRef = 'pc-1'; }]) {
    w.source = resolved(); mutate(w.source);
    assert.equal((await w.prepare()).status, 'unavailable');
  }
  for (const kind of ['retract', 'reverse', 'lineage']) {
    assert.equal((await w.controller.prepare(context, { ...request(), command: { version: 1, kind } })).status, 'unavailable');
  }
  assert.deepEqual(w.writes, []);
});

test('uncommitted expiry and concurrent ledger revision refuse without rebasing', async t => {
  const w = await world(t);
  await w.prepare(); w.time += C.TTL_MS;
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'preview-expired' });
  assert.deepEqual(w.writes, []);
  w.time = T0; await w.prepare(2); await w.prepare(3);
  assert.equal((await w.confirm(2)).status, 'committed');
  const writes = clone(w.writes);
  assert.notEqual((await w.confirm(3)).status, 'committed');
  assert.equal(w.document().operations.length, 1);
  assert.deepEqual(w.writes, writes);
});

test('same stable tuple cannot gain fresh capacity from content changes or an allocation to another goal', async t => {
  const w = await world(t);
  await w.prepare(1, 4000); assert.equal((await w.confirm()).status, 'committed');
  w.source.goalId = 'commitment:synthetic-second';
  assert.equal((await w.prepare(2, 2001)).status, 'unavailable'); // 4000 + 2001 > 6000 independently.
  w.source.evidence.cents = 9000;
  assert.equal((await w.prepare(3, 1)).status, 'unavailable'); // changed evidence is not another transaction.
  assert.equal(w.document().operations.length, 1);
});

test('original receipt survives expiry, changed current evidence, later commit and a new controller', async t => {
  const w = await world(t);
  await w.prepare(); const first = await w.confirm();
  await w.prepare(2, 3500); assert.equal((await w.confirm(2)).revision, 2);
  w.source.matchCount = 0; w.time += C.TTL_MS + 1;
  const writes = clone(w.writes), resolves = w.count('resolve');
  w.controller = w.newController(w.openStore());
  assert.deepEqual(await w.confirm(1, false), first);
  assert.deepEqual(await w.outcome(), first);
  assert.equal(w.count('resolve'), resolves);
  assert.deepEqual(w.writes, writes);
  assert.notEqual(first.digest, w.document().digest);
});

test('new sessions cannot confirm previews or retrieve former receipts; household read evidence remains', async t => {
  const w = await world(t);
  await w.prepare();
  assert.notEqual((await w.confirm(1, true, otherContext)).status, 'committed');
  assert.deepEqual(w.writes, []);
  const receipt = await w.confirm();
  const writes = clone(w.writes);
  w.controller = w.newController(w.openStore());
  assert.deepEqual(await w.outcome(1, otherContext), { status: 'unknown', operationId: op(1) });
  assert.notEqual((await w.confirm(1, true, otherContext)).status, 'committed');
  assert.deepEqual(await w.outcome(), receipt);
  assert.equal((await w.load()).evidence.commitments[0].links.length, 1);
  assert.deepEqual(w.writes, writes);
});

test('lost pin acknowledgement remains unknown until explicit read; no retry or new operation', async t => {
  const w = await world(t);
  await w.prepare(); w.lostPinAck = true;
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  assert.equal(w.document().operations.length, 1);
  const writes = clone(w.writes);
  const receipt = await w.outcome();
  assert.equal(receipt.status, 'committed');
  assert.deepEqual(await w.confirm(), receipt);
  assert.deepEqual(w.writes, writes);
  assert.equal(w.count('commitWithoutRecovery'), 1);
});

test('a lost controller acknowledgement recovers the same receipt, including after a later commit', async t => {
  const w = await world(t);
  await w.prepare();
  w.commitHook = async (input, store) => { await store.commitWithoutRecovery(input); throw Error('synthetic lost reply'); };
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  const first = await w.outcome();
  assert.equal(first.status, 'committed');
  w.commitHook = null;
  await w.prepare(2, 3500); assert.equal((await w.confirm(2)).revision, 2);
  const writes = clone(w.writes);
  w.time += C.TTL_MS;
  assert.deepEqual(await w.confirm(), first);
  assert.deepEqual(w.writes, writes);
  assert.equal(w.document().operations.length, 2);
});

test('unresolved write uncertainty never auto-retries, recovers or replaces its retained operation', async t => {
  const w = await world(t);
  await w.prepare(); await w.prepare(2); w.failBackup = true;
  assert.equal((await w.confirm()).status, 'unknown');
  assert.equal((await w.load()).status, 'unavailable');
  const writes = clone(w.writes), calls = w.count('commitWithoutRecovery');
  w.failBackup = false;
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  assert.deepEqual(await w.confirm(2), { status: 'unknown', operationId: op(2) });
  assert.deepEqual(await w.outcome(), { status: 'unknown', operationId: op(1) });
  assert.equal((await w.prepare()).status, 'unavailable');
  assert.equal((await w.prepare(3)).status, 'unavailable');
  assert.deepEqual(w.writes, writes);
  assert.equal(w.count('commitWithoutRecovery'), calls);
  w.controller = w.newController(w.openStore());
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  assert.deepEqual(w.writes, writes);
});

test('concurrent explicit confirmations issue at most one store commit', async t => {
  const w = await world(t);
  await w.prepare();
  const entered = deferred(), release = deferred();
  w.commitHook = async (input, store) => { entered.resolve(); await release.promise; return store.commitWithoutRecovery(input); };
  const first = w.confirm(); await entered.promise;
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  release.resolve(); assert.equal((await first).status, 'committed');
  assert.equal(w.count('commitWithoutRecovery'), 1);
  assert.equal(w.document().operations.length, 1);
});

test('snapshot caller context and selection before the first authorization await', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  w.authHook = async ctx => { entered.resolve(); await release.promise; return ctx.ticket === context.ticket ? { householdId, actorId } : null; };
  const ctx = clone(context), input = request();
  const pending = w.controller.prepare(ctx, input); await entered.promise;
  ctx.ticket = 'forged'; input.assignedCents = 6000; input.selection.transaction = 'pc-1'; input.operationId = op(99);
  release.resolve();
  const prepared = await pending;
  assert.equal(prepared.operationId, op(1)); w.tokens.set(op(1), prepared.previewToken);
  assert.equal((await w.confirm()).status, 'committed');
  assert.equal(w.document().operations[0].command.assignedCents, 2500);
});

test('snapshot trusted authorization, resolution and exact store preview across subsequent awaits', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  let externalPreview;
  w.prepareHook = async (input, store) => {
    entered.resolve(); await release.promise;
    const result = await store.prepare(input); externalPreview = result.preview;
    return result;
  };
  const pending = w.prepare(); await entered.promise;
  w.authority.actorId = otherActor; w.source.evidence.cents = 9000;
  release.resolve();
  assert.notEqual((await pending).status, 'prepared'); // authority revoked during prepare.
  assert.deepEqual(w.writes, []);
  w.authority = { householdId, actorId }; w.source = resolved(); w.prepareHook = null;
  await w.prepare(2);
  assert(externalPreview); // foreign objects never become writable retained previews.
  assert.equal((await w.confirm(2)).status, 'committed');
  assert.equal(w.document().operations[0].command.evidence.cents, 6000);
});

test('owned resolution remains exact while the store awaits and foreign source changes', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  w.prepareHook = async (input, store) => { entered.resolve(); await release.promise; return store.prepare(input); };
  const pending = w.prepare(); await entered.promise;
  w.source.identity.transactionId += '-mutated'; w.source.evidence.cents = 9000;
  release.resolve(); assert.equal((await pending).status, 'prepared');
  w.source = resolved(); w.prepareHook = null;
  assert.equal((await w.confirm()).status, 'committed');
  assert.equal(w.document().operations[0].command.evidence.cents, 6000);
});

test('foreign store preview/digest mutations during authorization await cannot alter the retained request', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  let external, authCalls = 0;
  w.prepareHook = async (input, store) => { external = await store.prepare(input); return external; };
  w.authHook = async () => {
    if (++authCalls === 2) { entered.resolve(); await release.promise; }
    return { householdId, actorId };
  };
  const pending = w.prepare(); await entered.promise;
  external.preview.command.assignedCents = 6000;
  external.preview.operationId = op(99); external.preview.expiresAt = T0 + 1;
  external.confirmationDigest = 'f'.repeat(64);
  release.resolve(); assert.equal((await pending).status, 'prepared');
  w.prepareHook = null; w.authHook = null;
  assert.equal((await w.confirm()).status, 'committed');
  assert.equal(w.document().operations[0].operationId, op(1));
  assert.equal(w.document().operations[0].command.assignedCents, 2500);
});

test('authorization snapshot cannot change inside resolver; prepare reauthorizes the current session', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  let passedAuthority;
  w.resolveHook = async input => { passedAuthority = input.authority; entered.resolve(); await release.promise; w.classifyOnce(input); return resolved(); };
  const pending = w.prepare(); await entered.promise;
  w.authority.actorId = otherActor;
  assert.equal(passedAuthority.actorId, actorId);
  assert(Object.isFrozen(passedAuthority));
  release.resolve(); assert.equal((await pending).status, 'unavailable');
  assert.deepEqual(w.writes, []);
});

test('confirmation request is owned before authorization awaits, including its explicit true value', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  await w.prepare();
  w.authHook = async () => { entered.resolve(); await release.promise; return { householdId, actorId }; };
  const input = { operationId: op(1), previewToken: w.tokens.get(op(1)), confirmed: true }, ctx = clone(context);
  const pending = w.controller.confirm(ctx, input); await entered.promise;
  input.operationId = op(99); input.confirmed = false; ctx.ticket = 'forged';
  release.resolve();
  assert.equal((await pending).operationId, op(1));
  assert.equal(w.document().operations.length, 1);
});

test('outcome snapshots request/result and reauthorizes after the store read', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  await w.prepare(); const receipt = await w.confirm();
  w.outcomeHook = async (input, store) => { entered.resolve(); await release.promise; return store.outcome(input); };
  const input = { operationId: op(1) }, ctx = clone(context);
  const pending = w.controller.outcome(ctx, input); await entered.promise;
  input.operationId = op(99); ctx.ticket = 'forged'; release.resolve();
  assert.deepEqual(await pending, receipt);
  w.authority = null;
  assert.equal((await w.outcome()).status, 'unavailable');
  const writes = clone(w.writes);
  w.authority = { householdId, actorId };
  w.outcomeHook = async (request, store) => {
    const result = await store.outcome(request); w.authority = null; return result;
  };
  assert.equal((await w.outcome()).status, 'unavailable');
  assert.deepEqual(w.writes, writes);
});

test('fresh store qualification refuses resident journals or divergence without initiating recovery', async t => {
  const w = await world(t);
  await w.prepare();
  // An independent interrupted operation must not be recovered by this caller.
  fs.writeFileSync(path.join(w.dir, 'journal.json'), 'synthetic-torn-journal', { mode: 0o600 });
  const before = fs.readFileSync(path.join(w.dir, 'document.json'));
  assert.equal((await w.confirm()).status, 'unavailable');
  assert.deepEqual(w.writes, []);
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.deepEqual(fs.readFileSync(path.join(w.dir, 'document.json')), before);
  assert.equal(fs.readFileSync(path.join(w.dir, 'journal.json'), 'utf8'), 'synthetic-torn-journal');
});

test('B1 race: a journal arriving after the probe cannot be recovered by confirmation', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  let prepares = 0, pauseNextAuthorization = false;
  w.prepareHook = async (input, store) => {
    const result = await store.prepare(input);
    if (++prepares === 2) pauseNextAuthorization = true;
    return result;
  };
  w.authHook = async () => {
    if (pauseNextAuthorization) {
      pauseNextAuthorization = false; entered.resolve(); await release.promise;
    }
    return { householdId, actorId };
  };
  await w.prepare();
  const pendingA = w.confirm();
  await entered.promise; // A's probe released the real shared file lock at revision 0.
  assert.equal(w.pin.revision, 0);
  const source = resolved();
  const commandB = { version: 1, kind: 'link', goalId: 'commitment:synthetic-b', txRef: tx(2),
    evidence: source.evidence, evidenceDigest: C.digest(source.evidence), assignedCents: 3000, asOf: source.asOf };
  const previewB = await w.store.prepare({ actorId: otherActor, operationId: op(2), command: commandB });
  w.failBackup = true;
  assert.deepEqual(await w.store.commit({ actorId: otherActor, preview: previewB.preview,
    confirmationDigest: previewB.confirmationDigest }), { status: 'unknown', reason: 'backup-ambiguous' });
  // Retained staged/quarantine bytes must survive the refusal as well.
  await A.createSettlementEvidenceFileAdapter(w.dir).documentStore.writeTemp(Buffer.from('synthetic-retained-stage'));
  fs.mkdirSync(path.join(w.dir, 'quarantine'), { mode: 0o700 });
  fs.writeFileSync(path.join(w.dir, 'quarantine', 'synthetic-retained'), 'synthetic-quarantine', { mode: 0o600 });
  const files = (dir = w.dir) => fs.readdirSync(dir).sort().map(name => {
    const target = path.join(dir, name);
    return [name, fs.statSync(target).isDirectory() ? files(target) : fs.readFileSync(target).toString('hex')];
  });
  const durable = () => ({ files: files(), pin: clone(w.pin), backups: [...w.backups.values()]
    .map(({ bytes, ...entry }) => ({ ...entry, bytes: bytes.toString('hex') })) });
  const before = durable(), writes = clone(w.writes);
  assert.equal((await w.load()).reason, 'document-ahead-of-pin');
  w.failBackup = false;
  release.resolve();
  const result = await pendingA;
  assert.deepEqual(w.writes.slice(writes.length), [], 'A must add zero durable mutations after the healthy probe');
  assert.deepEqual(result, { status: 'rejected', reason: 'recovery-required' });
  assert.deepEqual(durable(), before, 'B document/journal/staged/pin/backups/quarantine preserved byte-for-byte');
  assert.equal(w.pin.revision, 0);
  assert.equal((await w.load()).reason, 'document-ahead-of-pin');
  assert.equal((await w.outcome()).status, 'unknown');
  assert.equal((await w.store.outcome({ actorId: otherActor, operationId: op(2) })).status, 'unknown');
  assert.deepEqual(await w.confirm(), { status: 'unknown', operationId: op(1) });
  assert.deepEqual(durable(), before, 'a repeated confirmation still cannot retry or recover B');
  assert.deepEqual(w.writes, writes);
  assert.equal(w.count('commitWithoutRecovery'), 1, 'no retry or rebase');
  assert.equal((await w.store.reconcile()).disposition, 'promoted', 'explicit ordinary recovery remains a separate control');
  assert.equal(w.pin.revision, 1);
  assert.equal((await w.load()).status, 'qualified');
  assert.equal((await w.store.outcome({ actorId: otherActor, operationId: op(2) })).status, 'committed');
  assert.equal((await w.outcome()).status, 'unknown', 'A was never appended');
});

test('B1 capability: ordinary commit alone is refused; the controller cannot fall back', () => {
  let ordinaryCalls = 0;
  assert.throws(() => createSettlementEvidenceConfirmation({ householdId,
    authorize: async () => ({ householdId, actorId }), resolveSelection: async () => resolved(), now: () => T0,
    store: { prepare: async () => ({}), outcome: async () => ({ status: 'unknown' }),
      commit: async () => { ordinaryCalls++; return { status: 'committed' }; } },
  }), /incomplete trusted dependencies/);
  assert.equal(ordinaryCalls, 0);
});

test('malformed/throwing authorization, resolver and store paths cannot issue a false receipt', async t => {
  const w = await world(t);
  for (const invalid of [null, {}, { matchCount: 1 }, { ...resolved(), goalId: 'forged' },
    { ...resolved(), asOf: '2026-02-30' }, { ...resolved(), pendingTxRef: tx(2) }]) {
    w.resolveHook = async () => invalid;
    assert.equal((await w.prepare()).status, 'unavailable');
  }
  w.resolveHook = null;
  w.prepareHook = async () => ({ preview: { actorId }, confirmationDigest: 'f'.repeat(64) });
  assert.equal((await w.prepare()).status, 'unavailable');
  w.prepareHook = null; await w.prepare();
  w.outcomeHook = async () => ({ status: 'committed', operationId: op(99), revision: 1, digest: 'f'.repeat(64) });
  const invalidReceipt = await w.confirm();
  assert.equal(invalidReceipt.status, 'unavailable'); privateFree(invalidReceipt);
  assert.deepEqual(w.writes, []);
  assert.equal(w.count('commitWithoutRecovery'), 0);
});

test('accessors, toJSON and non-data inputs cannot smuggle caller authority across an await', async t => {
  const w = await world(t);
  let getterCalls = 0;
  const input = request();
  Object.defineProperty(input, 'actorId', { enumerable: true, get() { getterCalls++; return actorId; } });
  assert.equal((await w.controller.prepare(context, input)).status, 'unavailable');
  assert.equal(getterCalls, 0);
  assert.equal((await w.controller.prepare(context, { ...request(), toJSON() { return request(); } })).status, 'unavailable');
  const circular = request(); circular.selection.circular = circular;
  assert.equal((await w.controller.prepare(context, circular)).status, 'unavailable');
  assert.equal(w.count('authorize'), 0);
  assert.deepEqual(w.writes, []);
});

test('confirmation snapshots explicit confirmation and rechecks authority/expiry after fresh resolution', async t => {
  const w = await world(t);
  await w.prepare();
  const entered = deferred(), release = deferred();
  w.resolveHook = async input => { entered.resolve(); await release.promise; w.classifyOnce(input); return resolved(); };
  const input = { operationId: op(1), previewToken: w.tokens.get(op(1)), confirmed: false };
  const denied = w.controller.confirm(context, input); input.confirmed = true;
  assert.notEqual((await denied).status, 'committed');
  const pending = w.confirm(); await entered.promise;
  w.authority = { householdId, actorId: otherActor }; release.resolve();
  assert.notEqual((await pending).status, 'committed');
  assert.deepEqual(w.writes, []);
  w.authority = { householdId, actorId }; w.resolveHook = async input => { w.time = T0 + C.TTL_MS; w.classifyOnce(input); return resolved(); };
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'preview-expired' });
  assert.deepEqual(w.writes, []);
});

test('returned preview cannot supply a changed command or confirmation digest', async t => {
  const w = await world(t);
  const preview = await w.prepare();
  assert.throws(() => { preview.assignedCents = 6000; }, TypeError);
  assert.throws(() => { preview.selection.transaction = 'pc-1'; }, TypeError);
  const original = await w.prepare();
  assert.equal(original.status, 'unavailable'); // cannot overwrite an operation's retained preview.
  assert.equal((await w.confirm()).status, 'committed');
  assert.equal(w.document().operations[0].command.assignedCents, 2500);
});

test('errors and malformed store results never leak identities or report success', async t => {
  const w = await world(t);
  w.resolveHook = async () => { throw Error(householdId + actorId); };
  const unavailable = await w.prepare(); privateFree(unavailable); assert.equal(unavailable.status, 'unavailable');
  w.resolveHook = null; await w.prepare();
  w.commitHook = async () => ({ status: 'committed', operationId: op(99), revision: 0, digest: 'forged', actorId });
  const result = await w.confirm(); privateFree(result); assert.equal(result.status, 'unknown');
  assert.equal(w.document().operations.length, 0);
});

test('real process restart recovers only committed outcome and cannot fabricate a preview', async t => {
  const w = await world(t);
  await w.prepare(1); const receipt = await w.confirm(1);
  await w.prepare(2);
  const root = path.resolve(__dirname, '..');
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const A = require(input.root + '/scripts/settlement-evidence-file-adapter');
    const S = require(input.root + '/scripts/settlement-evidence-store');
    const F = require(input.root + '/scripts/settlement-evidence-confirmation');
    const deny = () => { throw Error('restart must not write or recover'); };
    const store = S.createSettlementEvidenceStore({ householdId: input.householdId,
      ...A.createSettlementEvidenceFileAdapter(input.dir), now: () => input.time,
      pinStore: { read: async () => input.pin, advance: deny },
      backupStore: { put: deny, get: deny, list: deny } });
    const c = F.createSettlementEvidenceConfirmation({ householdId: input.householdId, store,
      authorize: async ctx => ({ householdId: input.householdId, actorId: ctx.actor }),
      resolveSelection: deny, now: () => input.time });
    (async () => {
      const a = { actor: input.actorId }, b = { actor: input.otherActor };
      process.stdout.write(JSON.stringify([
        await c.confirm(a, { operationId: input.committed, confirmed: false }),
        await c.confirm(a, { operationId: input.uncommitted, confirmed: true }),
        await c.outcome(b, { operationId: input.committed })
      ]));
    })().catch(() => process.exit(7));
  `], { input: JSON.stringify({ root, dir: w.dir, pin: w.pin, time: T0 + C.TTL_MS + 1,
    householdId, actorId, otherActor, committed: op(1), uncommitted: op(2) }), encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [receipt,
    { status: 'unknown', operationId: op(2) }, { status: 'unknown', operationId: op(1) }]);
  assert.equal(w.document().operations.length, 1);
});

// ---------------------------------------------------------------------------
// Rule E (ATLAS-080 foundation qualification): admission is judged by
// Forecast's classifier, called through the controller-owned classify
// closure during the resolver's own resolve call. The verdict is projected
// to {kind, categoryId, householdSpending, reason, needsConfirmation},
// retained with the prepared selection, and re-derived at confirm. It is
// never persisted, never enters the command, and is never read from data
// supplied by the caller or the resolver.

test('Rule E E1: transfer verdict is rejected selection-ineligible at prepare before any store call', async t => {
  const w = await world(t);
  w.classification = classificationFixture('transfer');
  assert.deepEqual(await w.prepare(), { status: 'rejected', reason: 'selection-ineligible' });
  assert.equal(w.classifyCalls[0].kind, 'transfer');
  assert.equal(w.count('prepare'), 0, 'store.prepare must never be called for an ineligible selection');
  assert.deepEqual(w.writes, []);
  assert.deepEqual(await w.outcome(), { status: 'unknown', operationId: op(1) });
  // No preview is retained: the same operation prepares once eligible.
  w.classification = classificationFixture('spend-groceries');
  assert.equal((await w.prepare()).status, 'prepared');
  assert.equal((await w.confirm()).status, 'committed');
});

test('Rule E E2: eligible spend is admitted byte-identical, classified exactly once per resolve', async t => {
  const w = await world(t);
  assert.equal((await w.prepare()).status, 'prepared');
  assert.equal(w.classifyCalls.length, 1, 'exactly one classify invocation during prepare resolve');
  const verdict = w.classifyCalls[0];
  assert.deepEqual({ kind: verdict.kind, categoryId: verdict.categoryId,
    householdSpending: verdict.householdSpending, reason: verdict.reason,
    needsConfirmation: verdict.needsConfirmation },
    { kind: 'spend', categoryId: 'groceries', householdSpending: true, reason: null, needsConfirmation: false });
  assert.equal((await w.confirm()).status, 'committed');
  assert.equal(w.classifyCalls.length, 2, 'confirm re-resolves and classifies exactly once more');
  assert.deepEqual(w.document().operations[0].command, { version: 1, kind: 'link',
    goalId: 'commitment:synthetic-trip', txRef: tx(1), evidence: resolved().evidence,
    evidenceDigest: C.digest(resolved().evidence), assignedCents: 2500, asOf: '2026-10-20' },
    'the verdict adds no field to the command: digest and bytes are exactly as before Rule E');
});

test('Rule E E3: TD card-payment identity under a spending label is rejected selection-ineligible', async t => {
  const w = await world(t);
  w.classification = classificationFixture('card-payment-td');
  assert.deepEqual(await w.prepare(), { status: 'rejected', reason: 'selection-ineligible' });
  assert.equal(w.classifyCalls[0].kind, 'card-payment');
  assert.equal(w.classifyCalls[0].reason, 'td-card-recipient-identity', 'identity beats the Groceries label');
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E: internal-movement verdict is rejected selection-ineligible', async t => {
  const w = await world(t);
  w.classification = classificationFixture('internal-movement');
  assert.deepEqual(await w.prepare(), { status: 'rejected', reason: 'selection-ineligible' });
  assert.equal(w.classifyCalls[0].kind, 'internal-movement');
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E E4: unclassified needs-confirmation is selection-eligibility-unresolved, never permanent', async t => {
  const w = await world(t);
  w.classification = classificationFixture('unclassified');
  assert.deepEqual(await w.prepare(), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls[0].kind, 'unclassified');
  assert.equal(w.classifyCalls[0].needsConfirmation, true);
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
  // A cancelled-service charge lands on the same unresolved surface.
  w.classification = classificationFixture('cancelled-service');
  assert.deepEqual(await w.prepare(2), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls[1].reason, 'cancelled-service-charge');
  // Unresolved is not permanent ineligibility: once Forecast judges the
  // transaction an eligible spend, the same operation prepares and commits.
  w.classification = classificationFixture('spend-groceries');
  assert.equal((await w.prepare()).status, 'prepared');
  assert.equal((await w.confirm()).status, 'committed');
});

test('Rule E E7 corrected: bills are selection-eligibility-unresolved, not ineligible and not admitted', async t => {
  const w = await world(t);
  // A represented bill is a plan commitment row's own payment; the GO
  // corrects the clarification packet here: bill has no established
  // settlement policy yet, so the surface is unresolved, not ineligible.
  w.classification = classificationFixture('bill-represented');
  assert.deepEqual(await w.prepare(1), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls[0].reason, 'represented-bill');
  // Generic bill-label planned-cost control.
  w.classification = classificationFixture('bill-label');
  assert.deepEqual(await w.prepare(2), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls[1].reason, 'bill-label');
  // Bills-only matched-category control.
  w.classification = classificationFixture('bill-bills-only');
  assert.deepEqual(await w.prepare(3), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls[2].reason, 'bills-only');
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E E6: credit evidence is refused by existing validation; a refund verdict is unresolved', async t => {
  const w = await world(t);
  // E6a: credit-direction evidence never reaches an eligibility answer —
  // the existing evidence validation refuses it as prepare-unavailable.
  const credit = resolved(); credit.evidence.direction = 'credit'; w.source = credit;
  assert.deepEqual(await w.prepare(1), { status: 'unavailable', reason: 'prepare-unavailable' });
  assert.equal(w.count('prepare'), 0);
  // E6b: a debit-shaped row whose verdict is refund is unresolved.
  w.source = resolved();
  w.classification = classificationFixture('refund');
  assert.deepEqual(await w.prepare(2), { status: 'unavailable', reason: 'selection-eligibility-unresolved' });
  assert.equal(w.classifyCalls.at(-1).kind, 'refund');
  assert.deepEqual(w.writes, []);
});

test('Rule E E5: label drift to transfer with all six evidence fields unchanged is selection-changed', async t => {
  const w = await world(t);
  await w.prepare();
  // Only the provider category label moves (Groceries -> Credit Card
  // Payment). The evidence sextuple, bindings, goal and asOf are untouched;
  // categoryLabel is not one of the six evidence fields.
  w.classification = classificationFixture('transfer');
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'selection-changed' });
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E: groceries to restaurants category drift changes the projection and is selection-changed', async t => {
  const w = await world(t);
  await w.prepare();
  // Still an eligible spend class at confirm — but the retained projection
  // (categoryId groceries) is not the fresh one (restaurants), so the owner
  // is no longer confirming the selection that was prepared. This corrects
  // the clarification packet's claim that any differing fresh verdict is
  // necessarily a class change.
  w.classification = classificationFixture('spend-restaurants');
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'selection-changed' });
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E: classification-context drift with unchanged transaction, evidence and bindings is selection-changed', async t => {
  const w = await world(t);
  await w.prepare();
  // The transaction object, the six evidence fields, selectionBinding and
  // goalBinding are all identical; only the classification context changes:
  // the current-period packet now represents this transaction as a bill.
  const drifted = classificationFixture('spend-groceries');
  drifted.opts.currentPeriodActuals.representedActuals = [{ transactionId: drifted.tx.id }];
  w.classification = drifted;
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'selection-changed' });
  assert.equal(w.classifyCalls.at(-1).kind, 'bill');
  assert.equal(w.count('commitWithoutRecovery'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: zero classify invocations fail prepare as prepare-unavailable', async t => {
  const w = await world(t);
  w.resolveHook = async () => resolved();
  assert.deepEqual(await w.prepare(), { status: 'unavailable', reason: 'prepare-unavailable' });
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: a second classify invocation is latched ambiguous even when the resolver swallows it', async t => {
  const w = await world(t);
  w.resolveHook = async input => {
    if (typeof input.classify === 'function') {
      w.classifyOnce(input);
      try { input.classify(clone(w.classification.tx), clone(w.classification.plan), clone(w.classification.opts)); }
      catch { /* resolver swallows the refusal; the latch must still fail the attempt */ }
    }
    return resolved();
  };
  assert.deepEqual(await w.prepare(), { status: 'unavailable', reason: 'prepare-unavailable' });
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: a classifier error swallowed by the resolver still fails prepare', async t => {
  const w = await world(t);
  const evilTx = {};
  Object.defineProperty(evilTx, 'accountRole', { enumerable: true,
    get() { throw Error('synthetic classifier failure'); } });
  w.resolveHook = async input => {
    if (typeof input.classify === 'function') {
      try { input.classify(evilTx, w.classification.plan, w.classification.opts); }
      catch { /* resolver swallows the classifier error; the closure recorded it */ }
    }
    return resolved();
  };
  assert.deepEqual(await w.prepare(), { status: 'unavailable', reason: 'prepare-unavailable' });
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: classifying a missing transaction is a protocol failure, not an eligibility answer', async t => {
  const w = await world(t);
  w.resolveHook = async input => {
    if (typeof input.classify === 'function') input.classify(null, w.classification.plan, w.classification.opts);
    return resolved();
  };
  assert.deepEqual(await w.prepare(), { status: 'unavailable', reason: 'prepare-unavailable' });
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: a late classify invocation after settlement refuses and cannot affect another attempt', async t => {
  const w = await world(t);
  let stashed = null;
  w.resolveHook = async input => {
    if (typeof input.classify === 'function') { stashed = input.classify; w.classifyOnce(input); }
    return resolved();
  };
  assert.equal((await w.prepare()).status, 'prepared');
  assert.equal(typeof stashed, 'function', 'the resolver received the closure during its resolve window');
  assert.throws(() => stashed(clone(w.classification.tx), clone(w.classification.plan), clone(w.classification.opts)),
    /settlement-confirmation-unavailable/);
  w.resolveHook = null;
  const calls = w.classifyCalls.length;
  assert.equal((await w.prepare(2)).status, 'prepared', 'the dead closure cannot mutate a later attempt');
  assert.equal(w.classifyCalls.length, calls + 1, 'the later attempt classified exactly once, through its own closure');
  assert.equal((await w.confirm()).status, 'committed');
});

test('Rule E protocol: concurrent prepares keep their classify closures isolated', async t => {
  const w = await world(t), entered = deferred(), release = deferred();
  let resolves = 0;
  w.resolveHook = async input => {
    resolves++;
    if (resolves === 1) {
      entered.resolve(); await release.promise;
      w.classification = classificationFixture('spend-groceries');
    } else {
      w.classification = classificationFixture('transfer');
    }
    w.classifyOnce(input);
    return resolved();
  };
  const first = w.prepare(1);
  await entered.promise;
  assert.deepEqual(await w.prepare(2), { status: 'rejected', reason: 'selection-ineligible' },
    'the second attempt is judged by its own verdict, not the paused first attempt');
  release.resolve();
  assert.equal((await first).status, 'prepared');
  w.resolveHook = null;
  w.classification = classificationFixture('spend-groceries');
  assert.equal((await w.confirm()).status, 'committed');
});

test('Rule E protocol: resolver-returned verdict fields fail qualification', async t => {
  const w = await world(t);
  w.resolveHook = async input => {
    w.classifyOnce(input);
    return { ...resolved(), classification: { kind: 'spend', categoryId: 'groceries',
      householdSpending: true, reason: null, needsConfirmation: false } };
  };
  assert.deepEqual(await w.prepare(1), { status: 'unavailable', reason: 'prepare-unavailable' });
  w.resolveHook = async input => {
    w.classifyOnce(input);
    return { ...resolved(), verdict: w.classifyCalls.at(-1) };
  };
  assert.deepEqual(await w.prepare(2), { status: 'unavailable', reason: 'prepare-unavailable' },
    'even the genuine verdict, handed back as data, is a shape violation: no code path reads a supplied verdict');
  assert.equal(w.count('prepare'), 0);
  assert.deepEqual(w.writes, []);
});

test('Rule E protocol: confirm re-resolve without classification is selection-unavailable and keeps the preview', async t => {
  const w = await world(t);
  await w.prepare();
  w.resolveHook = async () => resolved();
  assert.deepEqual(await w.confirm(), { status: 'rejected', reason: 'selection-unavailable' });
  w.resolveHook = null;
  assert.equal((await w.confirm()).status, 'committed', 'a protocol refusal does not retire the preview');
});

test('Rule E: the original committed receipt takes precedence over later ineligibility', async t => {
  const w = await world(t);
  await w.prepare();
  const receipt = await w.confirm();
  assert.equal(receipt.status, 'committed');
  // Classification later drifts to a class that would be refused at prepare.
  w.classification = classificationFixture('transfer');
  const calls = w.classifyCalls.length, resolves = w.count('resolve');
  assert.deepEqual(await w.confirm(), receipt);
  assert.deepEqual(await w.outcome(), receipt);
  assert.equal(w.classifyCalls.length, calls, 'the original receipt is read before any re-classification');
  assert.equal(w.count('resolve'), resolves, 'the original receipt is read before any re-resolution');
});

// Repair pins for Systems Review BLOCKING B1 on PR #665 head cadfb7cc
// (comment 6310824501): resolveClassified must snapshot and qualify the
// resolved selection inside its own continuation, immediately after the
// resolver await — the base acquired+snapshotted in one continuation, and
// only owned data (the frozen snapshot and the owned projection) may cross
// the helper-to-caller await. Both tests inject a SYNCHRONOUS resolver
// directly into the controller, not through the suite's async wrapper: an
// async wrapper would absorb the very suspension under test. The existing
// later-mutation tests cover the store/authorization awaits, not this gap.

test('Rule E repair (PR #665 B1): synchronous-resolver mutation across the resolve boundary cannot defeat confirm drift detection', async t => {
  const w = await world(t);
  let commits = 0;
  const countingStore = {
    prepare: input => w.store.prepare(input),
    commitWithoutRecovery: input => { commits++; return w.store.commitWithoutRecovery(input); },
    outcome: input => w.store.outcome(input),
  };
  let mutateOnConfirm = false;
  const syncResolve = input => {
    w.classifyOnce(input);
    const fresh = resolved();
    if (mutateOnConfirm) {
      fresh.goalBinding = 'synthetic-changed-goal';
      // Two chained microtasks. The first runs before the helper's await
      // continuation, which must observe the changed binding in its own
      // snapshot; the second runs only after that continuation, restoring
      // the prepared value before any outer continuation could snapshot.
      Promise.resolve().then(() => { Promise.resolve().then(() => { fresh.goalBinding = 'synthetic-plan-goal-v1'; }); });
    }
    return fresh;
  };
  const controller = createSettlementEvidenceConfirmation({ householdId,
    authorize: w.authorize, resolveSelection: syncResolve, now: () => w.time, store: countingStore });
  const prepared = await controller.prepare(context, request());
  assert.equal(prepared.status, 'prepared');
  mutateOnConfirm = true;
  const result = await controller.confirm(context, { operationId: op(1), previewToken: prepared.previewToken, confirmed: true });
  assert.deepEqual(result, { status: 'rejected', reason: 'selection-changed' },
    'the selection observed at resolver completion is the one compared, not the later-restored foreign object');
  assert.equal(commits, 0, 'no commit may be attempted against the restored foreign object');
  assert.deepEqual(w.writes, []);
});

test('Rule E repair (PR #665 B1): synchronous-resolver mutation across the resolve boundary cannot rewrite a prepared selection', async t => {
  const w = await world(t);
  let commits = 0;
  const countingStore = {
    prepare: input => w.store.prepare(input),
    commitWithoutRecovery: input => { commits++; return w.store.commitWithoutRecovery(input); },
    outcome: input => w.store.outcome(input),
  };
  let mutate = true;
  const syncResolve = input => {
    w.classifyOnce(input);
    const fresh = resolved();
    if (mutate) {
      // Same chained-microtask restoration, aimed at prepare: the values
      // land only after the helper's continuation, so a snapshot taken in
      // that continuation retains the originally acquired selection.
      Promise.resolve().then(() => { Promise.resolve().then(() => {
        fresh.evidence.cents = 9000;
        fresh.selectionBinding = 'synthetic-mutated-binding';
      }); });
    }
    return fresh;
  };
  const controller = createSettlementEvidenceConfirmation({ householdId,
    authorize: w.authorize, resolveSelection: syncResolve, now: () => w.time, store: countingStore });
  const prepared = await controller.prepare(context, request());
  assert.equal(prepared.status, 'prepared');
  mutate = false;
  const receipt = await controller.confirm(context, { operationId: op(1), previewToken: prepared.previewToken, confirmed: true });
  assert.equal(receipt.status, 'committed',
    'the retained selection is the one acquired at prepare; a post-return mutation must not rewrite it');
  assert.equal(w.document().operations[0].command.evidence.cents, 6000, 'the committed command carries the acquired evidence, not the mutation');
  assert.equal(commits, 1);
});
