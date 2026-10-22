'use strict';

// ATLAS-080 — settlement-evidence refresh acquisition proof. The merged
// crosswalk exporter (PR #672) turns ONE observer pass over already-
// supplied input into the owned acquisition { packet, join, plan, map }
// the settlement resolver consumes, but it had no production acquisition
// path: nothing in the refresh lifecycle could obtain that acquisition
// from the retained source observation. This suite pins the private,
// unserved, memory-replay-only acquisition built for that gap:
//
//   provider-observe.js  — observeWithSettlementCrosswalk(input) returns
//     { report, acquisition } from ONE observeCore execution; observe()
//     and acquireSettlementCrosswalk(input) outputs are unchanged.
//   live-plan.js         — acquireSettlementForServer(canonical, env,
//     options) composes the acquisition from retained memory evidence
//     only (schema/sourceInputs/map/identity loading + the incumbent
//     overlay qualification on the SAME paired report). No provider
//     fetch, no fallback, no ordinary applyForServer change.
//   server-live-refresh.js — acquireSettlement(canonical, env, options)
//     runs that composition through the existing refresh worker /
//     lifecycle as a distinct private job type. Missing or held memory,
//     an active write, a superseding live job, an unreadable context or
//     a day rollover return unavailable with ZERO acquisition-triggered
//     provider GETs; generation/epoch changes during execution discard
//     the result at the publication barrier. Serve callers never
//     receive acquisitions.
//
// Everything is synthetic: the repo budget fixture, a loopback provider,
// SENTINEL native ids. No household data, no credentials, no provider
// writes. The acquisition path activates nothing: no caller composes it
// into serving, and authorize (P1), latch recovery (P2), storage,
// household assignment and activation remain separately gated.
const threads = require('node:worker_threads');

// Worker-only preload. The lifecycle tests below subclass Worker with
// execArgv ['--require', __filename], so this block runs inside refresh
// workers before server-live-refresh.js loads. It delays or faults ONLY
// the new private acquisition entry, so barrier behaviour (invalidate /
// cancel / timeout / exit during execution) is exercisable against the
// real worker path; ordinary LivePlan work is never touched.
if (!threads.isMainThread) {
  const Live = require('../scripts/live-plan');
  if (typeof Live.acquireSettlementForServer === 'function') {
    if (process.env.ATLAS_SYNTHETIC_ACQUIRE_FAULT === 'exit') {
      Live.acquireSettlementForServer = () => process.exit(7);
    } else if (Number(process.env.ATLAS_SYNTHETIC_ACQUIRE_DELAY_MS) > 0) {
      const delay = Number(process.env.ATLAS_SYNTHETIC_ACQUIRE_DELAY_MS);
      const original = Live.acquireSettlementForServer;
      Live.acquireSettlementForServer = async (...args) => {
        const result = await original(...args);
        await new Promise(resolve => setTimeout(resolve, delay));
        return result;
      };
    }
  }
} else {
  const test = require('node:test');
  const assert = require('node:assert/strict');
  const fs = require('node:fs');
  const path = require('node:path');
  const { performance } = require('node:perf_hooks');
  const O = require('../scripts/provider-observe.js');
  const R = require('../scripts/settlement-evidence-resolver.js');
  const Forecast = require('../public/forecast.js');
  const Live = require('../scripts/live-plan.js');
  const Memory = require('../scripts/server-observation-memory.js');
  const Fixture = require('./fixtures/budget-surface-data.js');
  const helper = require('./test-server-observation-memory.js');

  const ROOT = path.join(__dirname, '..');
  const SAMPLE = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json'), 'utf8'));
  const SAMPLE_MAP = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json'), 'utf8'));
  const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'data.json'), 'utf8'));
  const clone = x => JSON.parse(JSON.stringify(x));

  const householdId = 'household-' + 'a'.repeat(32);
  const AUTHORITY = { householdId, actorId: 'session-' + 'b'.repeat(64) };
  const GOAL_ID = 'commitment:school-trip';
  // The budget fixture's grocery spend: packet row tx-3, a posted CAD
  // debit of 212.40 on chequing-b dated 2026-08-16 (asOf 2026-08-20).
  const TUPLE = { providerAccountId: '1002', transactionId: '92003' };
  const EXPECTED_EVIDENCE = {
    accountId: 'chequing-b', currency: 'cad', direction: 'debit',
    date: '2026-08-16', cents: 21240, posted: true,
  };
  const CLOCK = Fixture.payload().fetchedAt;

  function loadIdentity() {
    if (!fs.existsSync(O.DEFAULT_IDENTITY)) return { rules: [], billPaymentPayees: [] };
    return JSON.parse(fs.readFileSync(O.DEFAULT_IDENTITY, 'utf8'));
  }
  function liveMap(env, canonical) {
    return O.loadLiveAccountMap(env, canonical);
  }
  function budgetPayload() {
    return { ...Fixture.payload(), tags: [] };
  }
  function budgetInput(payload) {
    return {
      provider: 'lunchmoney', payload, accountMap: clone({ ...Fixture.map, scope: 'live' }),
      data: Fixture.canonical(), identity: loadIdentity(),
    };
  }
  function liveEnv() {
    return {
      ATLAS_LIVE_OVERLAY: 'live',
      ATLAS_PROVIDER_ACCOUNT_MAP_JSON: JSON.stringify({ ...Fixture.map, scope: 'live' }),
    };
  }
  function classifyRecorder() {
    const calls = [];
    const classify = (tx, plan, opts) => {
      const verdict = Forecast.classifyCurrentPeriodTransaction(tx, plan, opts);
      calls.push({ tx, plan, opts, verdict });
      return verdict;
    };
    return { classify, calls };
  }
  async function resolveWith(acquire, acqForHandles, classify) {
    const resolver = R.createSettlementEvidenceResolver({ householdId, acquire });
    return resolver.resolveSelection({
      authority: AUTHORITY,
      selection: {
        transaction: R.deriveSelectionHandle(R.computeInstanceDigest(acqForHandles.packet),
          { householdId, ...TUPLE }),
        commitment: R.deriveChoiceHandle(R.computePlanDigest(acqForHandles.plan), GOAL_ID),
      },
      classify,
    });
  }

  // ---------------------------------------------------------------------
  // RA-1..RA-4: the observer paired entry.
  // ---------------------------------------------------------------------
  test('RA-1 paired entry returns report + acquisition from one pass, resolver-usable', async () => {
    assert.equal(typeof O.observeWithSettlementCrosswalk, 'function',
      'paired entry point exists');
    const input = budgetInput(budgetPayload());
    const paired = O.observeWithSettlementCrosswalk(clone(input));
    assert.ok(paired && typeof paired === 'object');
    assert.deepEqual(Object.keys(paired).sort(), ['acquisition', 'report']);
    // The report is exactly observe()'s output for the same input.
    assert.equal(JSON.stringify(paired.report), JSON.stringify(O.observe(clone(input))),
      'paired report is the incumbent report');
    // The acquisition is exactly the exporter's acquisition for the
    // same input, and its packet is the paired report's own packet.
    const expected = O.acquireSettlementCrosswalk(clone(input));
    assert.deepEqual(paired.acquisition, expected);
    assert.deepEqual(paired.acquisition.packet, paired.report.currentPeriodActuals,
      'acquisition packet is the same pass packet');
    assert.deepEqual(paired.acquisition.join.find(e => e.localId === 'tx-3'),
      { localId: 'tx-3', ...TUPLE });
    // The real merged resolver consumes the paired acquisition.
    const { classify, calls } = classifyRecorder();
    const resolved = await resolveWith(async () => paired.acquisition, paired.acquisition, classify);
    assert.ok(resolved, 'resolver resolves the paired acquisition');
    assert.equal(resolved.matchCount, 1);
    assert.equal(resolved.txRef, R.deriveTxRef({ householdId, ...TUPLE }));
    assert.equal(resolved.goalId, GOAL_ID);
    assert.equal(resolved.asOf, '2026-08-20');
    assert.deepEqual(resolved.evidence, EXPECTED_EVIDENCE);
    assert.equal(calls.length, 1, 'exactly one classify invocation');
    assert.equal(calls[0].tx.id, 'tx-3', 'classify receives the canonical emitted row');
    assert.deepEqual(calls[0].tx, paired.acquisition.packet.transactions.find(row => row.id === 'tx-3'),
      'classify receives the joined packet row');
  });

  test('RA-2 paired entry runs ONE observation execution', () => {
    // Count incumbent executions through the input's payload reads:
    // observe() alone and the paired entry must read the supplied input
    // identically; a second hidden pass would double the count.
    function countingInput() {
      const base = budgetInput(budgetPayload());
      let payloadReads = 0;
      const proxy = new Proxy(base, {
        get(target, property, receiver) {
          if (property === 'payload') payloadReads++;
          return Reflect.get(target, property, receiver);
        },
      });
      return { proxy, reads: () => payloadReads };
    }
    const a = countingInput();
    O.observe(a.proxy);
    const b = countingInput();
    O.observeWithSettlementCrosswalk(b.proxy);
    const c = countingInput();
    O.acquireSettlementCrosswalk(c.proxy);
    assert.ok(a.reads() > 0, 'counter is live');
    assert.equal(b.reads(), a.reads(), 'paired entry = one observe() execution');
    assert.equal(c.reads(), a.reads(), 'exporter = one observe() execution');
  });

  test('RA-3 observe() byte-identity around the paired entry; no sentinel leak', () => {
    function rawTx(id, accountId, extra = {}) {
      return {
        id, account_id: accountId, date: '2026-08-15', amount: 25.5,
        payee: 'SYNTH SHOP', is_pending: false, status: 'reviewed',
        currency: 'cad', ...extra,
      };
    }
    const payload = clone(SAMPLE);
    payload.transactions = [rawTx('SENTINEL-NATIVE-1', 1001)];
    const input = {
      provider: 'lunchmoney', payload, accountMap: clone(SAMPLE_MAP),
      data: clone(DATA),
    };
    const before = JSON.stringify(O.observe(clone(input)));
    const paired = O.observeWithSettlementCrosswalk(clone(input));
    const after = JSON.stringify(O.observe(clone(input)));
    assert.equal(after, before, 'observe() byte-identical around a paired acquisition');
    assert.ok(paired.acquisition, 'acquisition returned');
    assert.deepEqual(paired.acquisition.join, [
      { localId: 'tx-1', providerAccountId: '1001', transactionId: 'SENTINEL-NATIVE-1' },
    ], 'the private join names the sentinel tuple');
    assert.equal(JSON.stringify(paired.acquisition.packet).includes('SENTINEL-NATIVE-1'), false,
      'packet carries no native identity');
    assert.equal(JSON.stringify(paired.report).includes('"join"'), false,
      'report carries no join');
  });

  test('RA-4 sanitation failure: report returned, acquisition null; bad input refused', () => {
    function rawTx(id, accountId, extra = {}) {
      return {
        id, account_id: accountId, date: '2026-08-15', amount: 25.5,
        payee: 'SYNTH SHOP', is_pending: false, status: 'reviewed',
        currency: 'cad', ...extra,
      };
    }
    const payload = clone(SAMPLE);
    payload.transactions = [rawTx('SENTINEL-CAT', 1001, { category_id: 777 })];
    payload.categories = [{
      id: 777, name: 'Bearer synthetic-secret', is_income: false,
      exclude_from_budget: false, exclude_from_totals: false,
    }];
    const input = {
      provider: 'lunchmoney', payload, accountMap: clone(SAMPLE_MAP),
      data: clone(DATA),
    };
    const paired = O.observeWithSettlementCrosswalk(clone(input));
    assert.deepEqual(paired.report.currentPeriodActuals.transactions, [],
      'incumbent behaviour: failed sanitation empties the packet');
    assert.equal(paired.acquisition, null, 'no usable acquisition from a failed pass');
    assert.deepEqual(O.observeWithSettlementCrosswalk(null), { report: null, acquisition: null });
    assert.deepEqual(O.observeWithSettlementCrosswalk('nope'), { report: null, acquisition: null });
    assert.deepEqual(O.observeWithSettlementCrosswalk([1]), { report: null, acquisition: null });
  });

  // ---------------------------------------------------------------------
  // RA-5..RA-8: the LivePlan private acquisition composition.
  // ---------------------------------------------------------------------
  function countingObserver() {
    const counts = { observe: 0, paired: 0 };
    const originalObserve = O.observe;
    const originalPaired = O.observeWithSettlementCrosswalk;
    O.observe = (...args) => { counts.observe++; return originalObserve(...args); };
    if (typeof originalPaired === 'function') {
      O.observeWithSettlementCrosswalk = (...args) => { counts.paired++; return originalPaired(...args); };
    }
    return {
      counts,
      restore() {
        O.observe = originalObserve;
        if (typeof originalPaired === 'function') O.observeWithSettlementCrosswalk = originalPaired;
      },
    };
  }

  test('RA-5 LivePlan composition: qualified memory yields the same-pass acquisition once', async () => {
    assert.equal(typeof Live.acquireSettlementForServer, 'function',
      'LivePlan acquisition entry exists');
    const canonical = Fixture.canonical();
    const env = liveEnv();
    const envelope = { schema: Memory.SCHEMA, payload: Memory.sourceInputs(budgetPayload()) };
    const counter = countingObserver();
    let check;
    let acq;
    try {
      acq = await Live.acquireSettlementForServer(canonical, env,
        { evidence: envelope, onObservation: value => { check = value; } });
    } finally { counter.restore(); }
    assert.ok(acq, 'acquisition returned from qualified memory');
    assert.deepEqual(Object.keys(acq).sort(), ['join', 'map', 'packet', 'plan']);
    assert.deepEqual(check, { qualified: true, checkedAt: CLOCK, evidence: null },
      'qualification reported once, no new source evidence published');
    assert.equal(counter.counts.paired, 1, 'one paired observer execution');
    assert.equal(counter.counts.observe, 0, 'no second observation/sanitization');
    // Same pass, same result as the paired entry over the replay inputs.
    const expected = O.observeWithSettlementCrosswalk({
      provider: 'lunchmoney',
      payload: Memory.sourceInputs(budgetPayload()),
      accountMap: liveMap(env, canonical),
      data: canonical,
      identity: loadIdentity(),
    });
    assert.deepEqual(acq, expected.acquisition);
    // Resolver-usable end to end.
    const { classify, calls } = classifyRecorder();
    const resolved = await resolveWith(async () => acq, acq, classify);
    assert.ok(resolved, 'resolver resolves the composed acquisition');
    assert.deepEqual(resolved.evidence, EXPECTED_EVIDENCE);
    assert.equal(calls.length, 1);
  });

  test('RA-6 LivePlan composition refuses missing or malformed memory without fetching', async () => {
    const canonical = Fixture.canonical();
    const env = liveEnv();
    assert.equal(await Live.acquireSettlementForServer(canonical, env, undefined), null,
      'no options: no acquisition, no throw');
    assert.equal(await Live.acquireSettlementForServer(canonical, env), null,
      'missing options argument: no acquisition, no throw');
    for (const [label, options] of [
      ['no evidence', {}],
      ['wrong schema', { evidence: { schema: 'other/v9', payload: {} } }],
      ['evidence not an object', { evidence: 'memory' }],
    ]) {
      let check;
      const acq = await Live.acquireSettlementForServer(canonical, env,
        { ...options, onObservation: value => { check = value; } });
      assert.equal(acq, null, label + ': no acquisition');
      assert.deepEqual(check, { qualified: false, checkedAt: null, evidence: null },
        label + ': unqualified, undated');
    }
    // Non-live mode has no memory-replay acquisition at all.
    let check;
    const acq = await Live.acquireSettlementForServer(canonical, {},
      { evidence: { schema: Memory.SCHEMA, payload: Memory.sourceInputs(budgetPayload()) },
        onObservation: value => { check = value; } });
    assert.equal(acq, null, 'off mode: no acquisition');
    assert.equal(check.qualified, false);
    // Malformed retained payload: sourceInputs refusal stays contained.
    const malformed = budgetPayload();
    malformed.transactionWindow = { ...malformed.transactionWindow, complete: false };
    const bad = await Live.acquireSettlementForServer(canonical, env,
      { evidence: { schema: Memory.SCHEMA, payload: malformed },
        onObservation: value => { check = value; } });
    assert.equal(bad, null, 'malformed memory: no acquisition, no throw');
  });

  test('RA-7 LivePlan composition: dated unqualified memory returns no acquisition', async () => {
    const canonical = Fixture.canonical();
    const env = liveEnv();
    const noAccounts = { ...budgetPayload(), accounts: [] };
    let check;
    const acq = await Live.acquireSettlementForServer(canonical, env,
      { evidence: { schema: Memory.SCHEMA, payload: Memory.sourceInputs(noAccounts) },
        onObservation: value => { check = value; } });
    assert.equal(acq, null, 'unqualified memory yields no acquisition');
    assert.deepEqual(check, { qualified: false, checkedAt: CLOCK, evidence: null },
      'the dated check is preserved for the lifecycle clearing rule');
  });

  test('RA-8 ordinary applyForServer behaviour is unchanged by the composition', async () => {
    const canonical = Fixture.canonical();
    const env = liveEnv();
    const envelope = { schema: Memory.SCHEMA, payload: Memory.sourceInputs(budgetPayload()) };
    let check;
    const replayed = await Live.applyForServer(canonical, env,
      { evidence: envelope, onObservation: value => { check = value; } });
    assert.equal(replayed.liveOverlay.applied, true, 'replay overlay still applies');
    assert.equal(check.qualified, true, 'replay still qualifies');
    assert.equal('join' in replayed, false, 'served data carries no join');
    assert.equal(JSON.stringify(replayed).includes('92003'), false,
      'served data carries no native provenance');
  });

  // ---------------------------------------------------------------------
  // RA-9..RA-16: the refresh worker/lifecycle acquisition.
  // ---------------------------------------------------------------------
  const workers = [];
  const RealWorker = threads.Worker;
  threads.Worker = class extends RealWorker {
    constructor(file, options) {
      super(file, { ...options, execArgv: ['--require', __filename] });
      workers.push({ worker: this, exit: new Promise(resolve => this.once('exit', resolve)) });
    }
  };
  // Load after the Worker observer; production itself never exports workers.
  delete require.cache[require.resolve('../scripts/server-live-refresh.js')];
  const Refresh = require('../scripts/server-live-refresh.js');

  const originalNow = Date.now;
  const originalLog = console.log;
  let now = CLOCK;
  Date.now = () => Date.parse(now);
  const logLines = [];
  console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('{')) { logLines.push(args[0]); return; }
    originalLog(...args);
  };
  test.after(() => {
    Date.now = originalNow;
    console.log = originalLog;
    threads.Worker = RealWorker;
  });

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function bounded(promise, label) {
    let timer;
    try {
      return await Promise.race([promise, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Synthetic test deadline: ' + label)), 20000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function drain() {
    await bounded(Promise.all(workers.map(record => record.exit)), 'worker cleanup');
  }
  function rejection(promise, code) {
    return assert.rejects(promise, error => error && error.code === code);
  }

  test('RA-9 lifecycle: seeded memory acquires through a real worker, zero provider GETs', { timeout: 90000 }, async () => {
    assert.equal(typeof Refresh.acquireSettlement, 'function',
      'refresh acquisition entry exists');
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      const seeded = await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      assert.equal(seeded.liveOverlay.applied, true, 'seed observation qualifies');
      const callsAfterSeed = mock.calls.length;
      assert.ok(callsAfterSeed > 0, 'seed used the provider');

      const workersBefore = workers.length;
      const acq = await bounded(Refresh.acquireSettlement(canonical, env), 'acquire');
      await drain();
      assert.equal(mock.calls.length, callsAfterSeed,
        'ZERO provider GETs for a memory acquisition');
      assert.ok(workers.length > workersBefore, 'a real worker ran the acquisition');
      assert.deepEqual(Object.keys(acq).sort(), ['join', 'map', 'packet', 'plan']);
      assert.deepEqual(acq.join.find(e => e.localId === 'tx-3'), { localId: 'tx-3', ...TUPLE });

      // End to end: the resolver acquires through the lifecycle itself.
      const { classify, calls } = classifyRecorder();
      const resolved = await resolveWith(
        () => bounded(Refresh.acquireSettlement(canonical, env), 'resolver acquire'), acq, classify);
      await drain();
      assert.ok(resolved, 'resolver resolves through the refresh lifecycle');
      assert.equal(resolved.txRef, R.deriveTxRef({ householdId, ...TUPLE }));
      assert.deepEqual(resolved.evidence, EXPECTED_EVIDENCE);
      assert.equal(calls.length, 1, 'exactly one classify invocation');
      assert.equal(mock.calls.length, callsAfterSeed,
        'resolver acquisition also performs ZERO provider GETs');
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('RA-10 lifecycle: reacquisition is fresh, detached and uncached', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      const callsAfterSeed = mock.calls.length;
      const first = await bounded(Refresh.acquireSettlement(canonical, env), 'first acquire');
      await drain();
      const workersAfterFirst = workers.length;
      first.packet.transactions[0].amount = -999999;
      first.join.length = 0;
      const second = await bounded(Refresh.acquireSettlement(canonical, env), 'second acquire');
      await drain();
      assert.ok(workers.length > workersAfterFirst, 'reacquisition runs a new worker (no cache)');
      assert.notEqual(second, first, 'detached per caller');
      assert.notEqual(second.packet, first.packet, 'detached packet per caller');
      assert.ok(second.join.length > 0, 'caller mutation cannot reach the next acquisition');
      assert.notEqual(second.packet.transactions[0].amount, -999999);
      assert.equal(mock.calls.length, callsAfterSeed, 'still ZERO provider GETs');
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('RA-11 lifecycle: serve callers never receive acquisitions or native provenance', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      const seeded = await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      const replayed = await bounded(
        Refresh.serve(canonical, env, { preferObservation: true }), 'replay serve');
      await drain();
      assert.deepEqual(replayed, seeded, 'ordinary replay publication unchanged');
      assert.equal('join' in replayed, false);
      assert.equal(JSON.stringify(replayed).includes('92003'), false,
        'no native transaction id in served data');
      assert.equal(JSON.stringify(replayed).includes('"join"'), false,
        'no join in served data');
      for (const line of logLines) {
        assert.equal(line.includes('92003'), false, 'no native provenance in lifecycle logs');
        assert.equal(line.includes('acquisition'), false, 'no acquisition in lifecycle logs');
      }
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('RA-12 lifecycle: held memory is unavailable until a qualified recovery', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      mock.mode('failure');
      await rejection(bounded(Refresh.serve(canonical, env, { forceRefresh: true }), 'forced failure'),
        'live-refresh-unavailable');
      await drain();
      const callsAfterFailure = mock.calls.length;
      await rejection(bounded(Refresh.acquireSettlement(canonical, env), 'held acquire'),
        'live-refresh-unavailable');
      await drain();
      assert.equal(mock.calls.length, callsAfterFailure,
        'held memory: ZERO provider GETs');
      mock.mode('ok');
      const recovered = await bounded(Refresh.serve(canonical, env), 'recovery serve');
      await drain();
      assert.equal(recovered.liveOverlay.applied, true, 'qualified recovery');
      const acq = await bounded(Refresh.acquireSettlement(canonical, env), 'post-recovery acquire');
      await drain();
      assert.ok(acq && acq.packet, 'acquisition resumes after qualified recovery');
    } finally {
      mock.release();
      mock.mode('ok');
      await mock.close();
    }
  });

  test('RA-13 lifecycle: memory miss and active write are unavailable with zero GETs', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      let calls = mock.calls.length;
      const other = structuredClone(canonical);
      other.meta = { ...other.meta, asOf: '2026-08-19' };
      await rejection(bounded(Refresh.acquireSettlement(other, env), 'miss acquire'),
        'live-refresh-unavailable');
      await drain();
      assert.equal(mock.calls.length, calls, 'memory miss: ZERO provider GETs');
      // The miss read follows the incumbent slot contract; reseed.
      await bounded(Refresh.serve(canonical, env), 'reseed serve');
      await drain();
      calls = mock.calls.length;
      await Refresh.withProviderWrite(async () => {
        await rejection(bounded(Refresh.acquireSettlement(canonical, env), 'write acquire'),
          'live-refresh-invalidated');
        assert.equal(mock.calls.length, calls, 'active write: ZERO provider GETs');
      });
      await drain();
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('RA-14 lifecycle: superseding live work and the worker cap refuse acquisition', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      // Supersede: a live job for the same context is in flight.
      mock.hold();
      const live = Refresh.serve(canonical, env);
      const liveCalls = mock.calls.length;
      await helper.until(() => mock.calls.length > liveCalls, 'live job started');
      const callsDuringLive = mock.calls.length;
      await rejection(bounded(Refresh.acquireSettlement(canonical, env), 'superseded acquire'),
        'live-refresh-unavailable');
      assert.equal(mock.calls.length, callsDuringLive,
        'superseded acquisition adds ZERO provider GETs');
      mock.release();
      await bounded(live, 'live job completion');
      await drain();
      // Cap: two held live workers fill MAX_ACTIVE_LIVE_REFRESHES.
      mock.hold();
      const tweak = note => {
        const c = structuredClone(canonical);
        c.meta = { ...c.meta, note };
        return c;
      };
      const jobB = Refresh.serve(tweak('synthetic-b'), env);
      const jobC = Refresh.serve(tweak('synthetic-c'), env);
      const capCalls = mock.calls.length;
      await helper.until(() => mock.calls.length >= capCalls + 2, 'both cap workers started');
      const callsAtCap = mock.calls.length;
      await rejection(bounded(Refresh.acquireSettlement(canonical, env), 'busy acquire'),
        'live-refresh-busy');
      assert.equal(mock.calls.length, callsAtCap, 'busy acquisition adds ZERO provider GETs');
      mock.release();
      await Promise.allSettled([jobB, jobC]);
      await drain();
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('RA-15 lifecycle: in-flight acquisition is discarded by invalidation, cancel and timeout', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const baseEnv = helper.environment(mock.base);
    const env = { ...baseEnv, ATLAS_SYNTHETIC_ACQUIRE_DELAY_MS: '900' };
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve (delay context)');
      await drain();
      // Invalidation during execution discards the late result.
      const inFlight = Refresh.acquireSettlement(canonical, env);
      const invalidated = rejection(bounded(inFlight, 'invalidated acquire'), 'live-refresh-invalidated');
      await pause(250);
      await Refresh.withProviderWrite(async () => {});
      await invalidated;
      await drain();
      // Cancellation by the waiter leaves memory intact.
      await bounded(Refresh.serve(canonical, env), 'reseed serve');
      await drain();
      const controller = new AbortController();
      const cancelling = Refresh.acquireSettlement(canonical, env, { signal: controller.signal });
      const cancelled = rejection(bounded(cancelling, 'cancelled acquire'), 'live-refresh-cancelled');
      await pause(200);
      controller.abort();
      await cancelled;
      await drain();
      const afterCancel = await bounded(Refresh.acquireSettlement(canonical, env), 'post-cancel acquire');
      await drain();
      assert.ok(afterCancel && afterCancel.packet, 'memory survives a cancelled acquisition');
      // Waiter timeout leaves memory intact too.
      await rejection(bounded(Refresh.acquireSettlement(canonical, env, { timeoutMs: 200 }),
        'timed-out acquire'), 'live-refresh-timeout');
      await drain();
      const afterTimeout = await bounded(Refresh.acquireSettlement(canonical, env), 'post-timeout acquire');
      await drain();
      assert.ok(afterTimeout && afterTimeout.packet, 'memory survives a timed-out acquisition');
      // Day rollover during execution discards at the publication barrier.
      const rolling = Refresh.acquireSettlement(canonical, env);
      const rolled = rejection(bounded(rolling, 'rollover acquire'), 'live-refresh-invalidated');
      await pause(200);
      now = '2026-08-21T18:00:00.000Z';
      await rolled;
      now = CLOCK;
      await drain();
    } finally {
      now = CLOCK;
      mock.release();
      await mock.close();
    }
  });

  test('RA-16 lifecycle: worker exit and day rollover at call time return unavailable', { timeout: 90000 }, async () => {
    const mock = await helper.provider();
    const baseEnv = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      const faultEnv = { ...baseEnv, ATLAS_SYNTHETIC_ACQUIRE_FAULT: 'exit' };
      await bounded(Refresh.serve(canonical, faultEnv), 'seed serve (fault context)');
      await drain();
      const callsAfterSeed = mock.calls.length;
      await rejection(bounded(Refresh.acquireSettlement(canonical, faultEnv), 'exit acquire'),
        'live-refresh-unavailable');
      await drain();
      assert.equal(mock.calls.length, callsAfterSeed, 'worker exit: ZERO provider GETs');
      // Rollover at call time: the retained context belongs to the prior
      // financial day, so the acquisition misses without any fetch.
      await bounded(Refresh.serve(canonical, baseEnv), 'seed serve (base context)');
      await drain();
      const callsBeforeRoll = mock.calls.length;
      now = '2026-08-21T18:00:00.000Z';
      await rejection(bounded(Refresh.acquireSettlement(canonical, baseEnv), 'rolled acquire'),
        'live-refresh-unavailable');
      now = CLOCK;
      await drain();
      assert.equal(mock.calls.length, callsBeforeRoll, 'day rollover: ZERO provider GETs');
    } finally {
      now = CLOCK;
      mock.release();
      await mock.close();
    }
  });
  // ---------------------------------------------------------------------
  // WA: acquisition-bound write admission — the finite acceptance. The
  // ACTUAL four modules composed end to end: the real Refresh lifecycle
  // issues a private synchronous freshness witness inside the acquisition
  // publication continuation, paired with the exact acquired
  // packet/join/plan/map; the real resolver returns the ordinary selection
  // plus that witness; the real confirmation controller selects the
  // fenced pair at construction and carries the witness paired with its
  // FRESH confirm-time resolution through the probe/authorization waits;
  // the real store invokes it synchronously immediately before the
  // journal write under its single lock. Context, authorize and the
  // current-context reader are labelled synthetic fixtures owned by the
  // test; NO production authority reader, production composition or
  // activation is wired by this slice. The claim is only the
  // process-local admission boundary under the trusted
  // current-context-reader contract.
  // ---------------------------------------------------------------------
  const Store = require('../scripts/settlement-evidence-store');
  const FileAdapter = require('../scripts/settlement-evidence-file-adapter');
  const Confirmation = require('../scripts/settlement-evidence-confirmation');
  const admissionOp = n => 'operation-' + n.toString(16).padStart(32, '0');
  const ADMISSION_CONTEXT = { ticket: 'synthetic-session-a' };
  const ADMISSION_T0 = Date.parse('2026-08-20T12:00:00Z');

  async function admissionWorld(t) {
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'atlas-admission-'));
    fs.chmodSync(dir, 0o700);
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    const w = { dir, mock, env, canonical, time: ADMISSION_T0, pin: null, backups: new Map(),
      calls: { commitAdmitted: 0, commitWithoutRecovery: 0, prepare: 0, outcome: 0, acquire: 0 },
      hooks: {}, readerCalls: 0 };
    const seeded = await bounded(Refresh.serve(canonical, env), 'admission seed serve');
    await drain();
    assert.equal(seeded.liveOverlay.applied, true, 'seed observation qualifies');
    w.providerCallsAfterSeed = mock.calls.length;
    // Labelled synthetic current-context reader: the test owns the current
    // canonical/environment cell and a monotonic revision counter. The
    // reader is synchronous; 'broken' modes exercise fail-closed refusal.
    w.cell = { canonical, env, revision: 1, broken: null };
    w.contextReader = () => {
      w.readerCalls++;
      if (w.cell.broken === 'throw') throw new Error('synthetic reader failure');
      if (w.cell.broken === 'async') return Promise.resolve(
        { canonical: w.cell.canonical, env: w.cell.env, contextRevision: w.cell.revision });
      if (w.cell.broken === 'malformed') return { contextRevision: 'one' };
      return { canonical: w.cell.canonical, env: w.cell.env, contextRevision: w.cell.revision };
    };
    w.pinStore = {
      async read() { return clone(w.pin); },
      async advance(expected, next) {
        const ok = expected === null ? w.pin === null
          : w.pin && expected.revision === w.pin.revision && expected.digest === w.pin.digest;
        if (!ok) return false;
        w.pin = clone(next);
        return true;
      },
    };
    const backupStore = {
      async put(revision, digest, bytes) {
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
    w.adapters = FileAdapter.createSettlementEvidenceFileAdapter(dir);
    w.store = Store.createSettlementEvidenceStore(
      { householdId, ...w.adapters, pinStore: w.pinStore, backupStore, now: () => w.time });
    assert.equal((await w.store.bootstrap()).status, 'bootstrapped');
    const controllerStore = {
      prepare: async input => {
        w.calls.prepare++;
        if (w.hooks.probe) await w.hooks.probe(input);
        return w.store.prepare(input);
      },
      commitWithoutRecovery: async input => {
        w.calls.commitWithoutRecovery++;
        return w.store.commitWithoutRecovery(input);
      },
      outcome: async input => { w.calls.outcome++; return w.store.outcome(input); },
      inspectAttempt: async input => w.store.inspectAttempt(input),
    };
    w.acquire = async () => {
      w.calls.acquire++;
      const paired = await bounded(Refresh.acquireSettlementWithWitness(
        w.cell.canonical, w.cell.env, { contextReader: w.contextReader }), 'admission acquire');
      return { ...paired.acquisition, witness: paired.witness };
    };
    w.resolver = R.createSettlementEvidenceResolver({ householdId, acquire: w.acquire });
    w.authorize = async ctx => {
      if (w.hooks.authorize) await w.hooks.authorize();
      return ctx && ctx.ticket === ADMISSION_CONTEXT.ticket
        ? { householdId, actorId: AUTHORITY.actorId } : null;
    };
    w.controller = Confirmation.createSettlementEvidenceConfirmation({
      householdId, authorize: w.authorize,
      resolveSelection: w.resolver.resolveSelection,
      resolvePairedSelection: w.resolver.resolvePairedSelection,
      commitAdmitted: async (input, witness) => {
        w.calls.commitAdmitted++;
        if (w.hooks.admission) return w.hooks.admission(input, witness);
        return w.store.commitAdmitted(input, witness);
      },
      store: controllerStore, now: () => w.time,
    });
    const handlesAcq = await bounded(Refresh.acquireSettlement(canonical, env), 'admission handles acquire');
    await drain();
    w.selection = {
      transaction: R.deriveSelectionHandle(R.computeInstanceDigest(handlesAcq.packet),
        { householdId, ...TUPLE }),
      commitment: R.deriveChoiceHandle(R.computePlanDigest(handlesAcq.plan), GOAL_ID),
    };
    w.prepare = (n = 1, cents = 1000) => w.controller.prepare(ADMISSION_CONTEXT,
      { operationId: admissionOp(n), selection: w.selection, assignedCents: cents });
    w.confirm = (n, previewToken) => w.controller.confirm(ADMISSION_CONTEXT,
      { operationId: admissionOp(n), confirmed: true, previewToken });
    w.document = () => JSON.parse(fs.readFileSync(path.join(dir, 'document.json'), 'utf8'));
    w.close = async () => { mock.release(); mock.mode('ok'); await mock.close(); };
    return w;
  }
  // Arm a one-shot lifecycle invalidation on the kth read of an adapter
  // method, counted from the moment arm() runs (tests arm inside the
  // confirm probe hook so the counts name commit-stage reads exactly).
  function armInvalidationOnRead(target, method, kth) {
    const original = target[method].bind(target);
    let count = 0, armed = false;
    target[method] = async (...args) => {
      if (armed) {
        count++;
        if (count === kth) await Refresh.withProviderWrite(async () => {});
      }
      return original(...args);
    };
    return () => { armed = true; };
  }

  test('WA-A1 composed success: admission commits, zero additional provider GETs, no fallback', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      assert.equal(prepared.status, 'prepared');
      const receipt = await w.confirm(1, prepared.previewToken);
      assert.equal(receipt.status, 'committed');
      assert.equal(receipt.operationId, admissionOp(1));
      assert.equal(w.document().operations.length, 1);
      assert.equal(w.calls.commitAdmitted, 1, 'admission went through the fenced capability');
      assert.equal(w.calls.commitWithoutRecovery, 0, 'no unguarded fallback');
      assert.equal(w.mock.calls.length, w.providerCallsAfterSeed,
        'zero additional provider GETs on the success path');
      assert.equal(w.readerCalls, 5,
        'reader sampled at acquisition entry and rechecked at publication for each of prepare and confirm (4), plus once at admission (1)');
      const outcome = await w.controller.outcome(ADMISSION_CONTEXT, { operationId: admissionOp(1) });
      assert.equal(outcome.status, 'committed');
      assert.equal(JSON.stringify([prepared, receipt, outcome]).includes('witness'), false,
        'no witness material on public results');
      assert.equal(JSON.stringify(w.document()).includes('witness'), false,
        'no witness material in persistence');
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A2 the original receipt precedes current selection despite invalidation', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      assert.equal((await w.confirm(1, prepared.previewToken)).status, 'committed');
      const acquireCalls = w.calls.acquire, admittedCalls = w.calls.commitAdmitted;
      // Break everything the fresh path depends on: the lifecycle is
      // invalidated and the context reader throws.
      await Refresh.withProviderWrite(async () => {});
      w.cell.broken = 'throw';
      const again = await w.confirm(1, prepared.previewToken);
      assert.equal(again.status, 'committed', 'the durable receipt wins over current evidence');
      assert.equal(w.calls.acquire, acquireCalls, 'no re-acquisition for a recorded operation');
      assert.equal(w.calls.commitAdmitted, admittedCalls, 'no second admission');
      await drain();
    } finally { await w.close(); }
  });

  for (const [name, breakMode] of [['throwing', 'throw'], ['asynchronous', 'async'], ['malformed', 'malformed']]) {
    test(`WA-A3 a ${name} current-context reader refuses admission with zero writes`, { timeout: 120000 }, async t => {
      const w = await admissionWorld(t);
      try {
        const prepared = await w.prepare(1);
        assert.equal(prepared.status, 'prepared');
        w.cell.broken = breakMode;
        const result = await w.confirm(1, prepared.previewToken);
        assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
        assert.equal(w.document().operations.length, 0, 'zero writes');
        assert.equal(w.mock.calls.length, w.providerCallsAfterSeed,
          'zero additional provider GETs on the refusal path');
        assert.equal(w.calls.commitWithoutRecovery, 0);
        await drain();
      } finally { await w.close(); }
    });
  }

  test('WA-A4 generation invalidation at the confirm probe refuses admission', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      w.hooks.probe = async () => { await Refresh.withProviderWrite(async () => {}); };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      assert.equal(w.calls.commitWithoutRecovery, 0);
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A5 epoch invalidation at the confirm probe (fresh publish) refuses admission', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      w.hooks.probe = async () => {
        await bounded(Refresh.serve(w.canonical, w.env, { forceRefresh: true }), 'epoch publish');
      };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A6 invalidation at the post-probe authorization wait refuses admission', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      let authCalls = 0;
      // Confirm-time authorize calls: 1 authority, 2 receipt re-check,
      // 3 post-probe re-check, 4 post-commit re-check. Fire at 3.
      w.hooks.authorize = async () => {
        authCalls++;
        if (authCalls === 3) await Refresh.withProviderWrite(async () => {});
      };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A7 financial-day rollover between resolution and admission refuses', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      w.hooks.probe = async () => { now = '2026-08-21T18:00:00.000Z'; };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      await drain();
    } finally { now = CLOCK; await w.close(); }
  });

  test('WA-A8 context replacement between resolution and admission refuses (reader revision)', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      // Identical content in a new object: the recomputed context key
      // alone cannot see this replacement — the monotonic revision can.
      w.hooks.probe = async () => { w.cell.canonical = clone(w.canonical); w.cell.revision++; };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A9 context ABA between resolution and admission refuses', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      const prepared = await w.prepare(1);
      // Away to different content and back to the original content: the
      // context key matches again, but the revision moved twice.
      w.hooks.probe = async () => {
        const away = clone(w.canonical);
        away.meta = { ...away.meta, note: 'synthetic-away' };
        w.cell.canonical = away; w.cell.revision++;
        w.cell.canonical = clone(w.canonical); w.cell.revision++;
      };
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
      assert.equal(w.document().operations.length, 0);
      await drain();
    } finally { await w.close(); }
  });

  for (const [stage, pick, method, kth] of [
    ['confirm probe pin read', w => w.pinStore, 'read', 1],
    ['lock-acquisition pin read', w => w.pinStore, 'read', 2],
    ['C1 prewrite pin re-read', w => w.pinStore, 'read', 3],
    ['confirm probe document read', w => w.adapters.documentStore, 'read', 1],
    ['lock-acquisition document read', w => w.adapters.documentStore, 'read', 2],
    ['C1 prewrite document re-read', w => w.adapters.documentStore, 'read', 3],
    ['confirm probe journal read', w => w.adapters.journalStore, 'read', 1],
    ['lock-acquisition journal read', w => w.adapters.journalStore, 'read', 2],
  ]) {
    test(`WA-A10 invalidation at the store's ${stage} refuses admission`, { timeout: 120000 }, async t => {
      const w = await admissionWorld(t);
      try {
        const arm = armInvalidationOnRead(pick(w), method, kth);
        const prepared = await w.prepare(1);
        assert.equal(prepared.status, 'prepared');
        w.hooks.probe = async () => { arm(); };
        const result = await w.confirm(1, prepared.previewToken);
        assert.deepEqual(result, { status: 'rejected', reason: 'admission-refused' });
        assert.equal(w.document().operations.length, 0, 'zero writes');
        assert.equal(w.calls.commitWithoutRecovery, 0);
        await drain();
      } finally { await w.close(); }
    });
  }

  test('WA-A11 post-admission invalidation during paused journal I/O does not cancel the write', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      let enteredWrite, releaseWrite;
      const writeEntered = new Promise(resolve => { enteredWrite = resolve; });
      const writeGate = new Promise(resolve => { releaseWrite = resolve; });
      const originalWrite = w.adapters.journalStore.write.bind(w.adapters.journalStore);
      w.adapters.journalStore.write = async record => {
        const result = await originalWrite(record);
        enteredWrite();
        await writeGate;
        return result;
      };
      const prepared = await w.prepare(1);
      const pending = w.confirm(1, prepared.previewToken);
      await writeEntered;
      // Admission already succeeded. Invalidate everything the witness
      // checks; the partly written operation must still complete as
      // committed, never convert to a definite refusal.
      await Refresh.withProviderWrite(async () => {});
      w.cell.revision++;
      releaseWrite();
      const receipt = await pending;
      assert.equal(receipt.status, 'committed');
      assert.equal(w.document().operations.length, 1);
      assert.equal(w.readerCalls, 5,
        'entry + publication reader samples for prepare and confirm (4), and the witness itself consulted exactly once, before the write (1)');
      await drain();
    } finally { await w.close(); }
  });

  test('WA-A12 an uncertain journal write remains unknown and is never retried', { timeout: 120000 }, async t => {
    const w = await admissionWorld(t);
    try {
      let journalWrites = 0;
      const originalWrite = w.adapters.journalStore.write.bind(w.adapters.journalStore);
      w.adapters.journalStore.write = async record => {
        journalWrites++;
        await originalWrite(record);
        throw new Error('synthetic lost journal acknowledgement');
      };
      const prepared = await w.prepare(1);
      const result = await w.confirm(1, prepared.previewToken);
      assert.deepEqual(result, { status: 'unknown', operationId: admissionOp(1) });
      assert.equal(journalWrites, 1, 'exactly one journal write attempt: no retry');
      assert.equal(w.calls.commitAdmitted, 1);
      assert.ok(await w.adapters.journalStore.read(), 'the journal is resident');
      assert.deepEqual(await w.controller.outcome(ADMISSION_CONTEXT, { operationId: admissionOp(1) }),
        { status: 'unknown', operationId: admissionOp(1) }, 'uncertainty is preserved, not refused');
      assert.equal((await w.prepare(2)).status, 'unavailable',
        'the latch blocks fresh work while the outcome is unresolved');
      await drain();
    } finally { await w.close(); }
  });

  test('WA-L1 witness pairing: shape, per-waiter ownership, no global slot', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      // A valid reader is required for any admitting witness (B1); this
      // labelled synthetic reader serves the lifecycle cases below.
      const cell = { canonical, env, revision: 1 };
      const reader = () => ({ canonical: cell.canonical, env: cell.env, contextRevision: cell.revision });
      const [a, b] = await Promise.all([
        bounded(Refresh.acquireSettlementWithWitness(canonical, env, { contextReader: reader }), 'witness acquire a'),
        bounded(Refresh.acquireSettlementWithWitness(canonical, env, { contextReader: reader }), 'witness acquire b'),
      ]);
      await drain();
      assert.deepEqual(Object.keys(a).sort(), ['acquisition', 'witness']);
      assert.deepEqual(Object.keys(a.acquisition).sort(), ['join', 'map', 'packet', 'plan'],
        'the acquisition itself is unchanged');
      assert.equal(typeof a.witness, 'function');
      assert.notEqual(a.witness, b.witness, 'each waiter owns its witness');
      assert.notEqual(a.acquisition, b.acquisition, 'each waiter owns its data');
      assert.equal(a.witness(), true, 'a fresh witness admits');
      assert.equal(b.witness(), true);
      // No global latest-witness slot: a later witness for the same
      // context never revives an earlier one — each witness answers only
      // for the state its own publication validated.
      const firstPair = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader }), 'witness acquire first');
      await drain();
      assert.equal(firstPair.witness(), true);
      await bounded(Refresh.serve(canonical, env, { forceRefresh: true }), 'republish');
      await drain();
      assert.equal(firstPair.witness(), false, 'the earlier witness stays refused after a republish');
      const secondPair = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader }), 'witness acquire second');
      await drain();
      assert.equal(secondPair.witness(), true, 'the fresh witness admits');
      assert.equal(firstPair.witness(), false, 'and the earlier witness is not revived by it');
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('WA-L2 witness refuses after invalidation, under a superseding live job, and under replay hold', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      // A valid reader is required for any admitting witness (B1).
      const cell = { canonical, env, revision: 1 };
      const reader = () => ({ canonical: cell.canonical, env: cell.env, contextRevision: cell.revision });
      const first = await bounded(Refresh.acquireSettlementWithWitness(canonical, env, { contextReader: reader }), 'witness acquire');
      await drain();
      assert.equal(first.witness(), true);
      await Refresh.withProviderWrite(async () => {});
      assert.equal(first.witness(), false, 'generation invalidation refuses');
      // Invalidation cleared the retained observation; reseed before
      // reacquiring (the incumbent slot contract, as in RA-13).
      await bounded(Refresh.serve(canonical, env), 'reseed serve');
      await drain();
      // Superseding live job for the same context.
      const second = await bounded(Refresh.acquireSettlementWithWitness(canonical, env, { contextReader: reader }), 'witness reacquire');
      await drain();
      assert.equal(second.witness(), true);
      mock.hold();
      const live = Refresh.serve(canonical, env);
      const liveCalls = mock.calls.length;
      await helper.until(() => mock.calls.length > liveCalls, 'live job started');
      assert.equal(second.witness(), false, 'a superseding live job refuses');
      mock.release();
      await bounded(live, 'live job completion');
      await drain();
      // Replay hold after a failed forced refresh.
      const third = await bounded(Refresh.acquireSettlementWithWitness(canonical, env, { contextReader: reader }), 'witness reacquire 2');
      await drain();
      mock.mode('failure');
      await rejection(bounded(Refresh.serve(canonical, env, { forceRefresh: true }), 'forced failure'),
        'live-refresh-unavailable');
      await drain();
      assert.equal(third.witness(), false, 'the replay hold refuses');
      mock.mode('ok');
    } finally {
      mock.release();
      mock.mode('ok');
      await mock.close();
    }
  });

  test('WA-L3 reader failure modes refuse from minting; day rollover refuses', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      for (const [name, reader] of [
        ['throwing reader', () => { throw new Error('synthetic reader failure'); }],
        ['asynchronous reader', async () => ({ canonical, env, contextRevision: 1 })],
        ['malformed result', () => ({ contextRevision: 'one' })],
        ['non-function reader', 'reader'],
        ['context mismatch', () => ({ canonical: { ...canonical, meta: { ...canonical.meta, note: 'elsewhere' } }, env, contextRevision: 1 })],
      ]) {
        const paired = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
          { contextReader: reader }), 'witness acquire (' + name + ')');
        await drain();
        assert.ok(paired.acquisition && paired.acquisition.packet,
          name + ': the acquisition itself still resolves');
        assert.equal(paired.witness(), false, name + ': the witness refuses');
      }
      // Day rollover: the witness re-derives the financial day at
      // invocation and refuses once it no longer matches the job's day.
      // (A valid reader is required for the admitting witness — B1.)
      const dayCell = { canonical, env, revision: 1 };
      const dayReader = () => ({ canonical: dayCell.canonical, env: dayCell.env, contextRevision: dayCell.revision });
      const paired = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: dayReader }), 'witness acquire (day)');
      await drain();
      assert.equal(paired.witness(), true);
      now = '2026-08-21T18:00:00.000Z';
      assert.equal(paired.witness(), false, 'day rollover refuses');
      now = CLOCK;
    } finally {
      now = CLOCK;
      mock.release();
      await mock.close();
    }
  });

  test('WA-L4 a fenced acquisition mints no admitting witness without the required reader (B1)', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      // The approved contract requires a freshly read current context and
      // a monotonic revision: hashing the job's captured inputs was never
      // a fallback. Without a valid synchronous reader the acquisition
      // itself still resolves, but no witness it yields may admit.
      for (const [name, options] of [
        ['no options', undefined],
        ['empty options', {}],
        ['reader explicitly undefined', { contextReader: undefined }],
      ]) {
        const paired = await bounded(Refresh.acquireSettlementWithWitness(canonical, env, options),
          'readerless acquire (' + name + ')');
        await drain();
        assert.ok(paired.acquisition && paired.acquisition.packet,
          name + ': the acquisition itself still resolves');
        assert.equal(typeof paired.witness, 'function', name + ': a witness is still returned');
        assert.equal(paired.witness(), false, name + ': a readerless witness never admits');
      }
      // Control: the same acquisition WITH a valid reader admits.
      const cell = { canonical, env, revision: 1 };
      const reader = () => ({ canonical: cell.canonical, env: cell.env, contextRevision: cell.revision });
      const paired = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader }), 'reader acquire (control)');
      await drain();
      assert.equal(paired.witness(), true, 'control: a valid reader admits');
    } finally {
      mock.release();
      await mock.close();
    }
  });

  test('WA-L5 context replacement or ABA during acquisition invalidates that acquisition (B2)', { timeout: 120000 }, async () => {
    const mock = await helper.provider();
    const env = helper.environment(mock.base);
    const canonical = Fixture.canonical();
    try {
      await bounded(Refresh.serve(canonical, env), 'seed serve');
      await drain();
      // The reader's context/revision is captured at acquisition ENTRY,
      // before the asynchronous worker runs, and rechecked in the
      // publication continuation. The mutations below happen in the same
      // synchronous tick as the acquire call — structurally before any
      // worker publication can arrive — so the barrier is deterministic:
      // no sleeps, no timing window.
      const cell = { canonical, env, revision: 1 };
      const reader = () => ({ canonical: cell.canonical, env: cell.env, contextRevision: cell.revision });
      // Control: nothing changes while the acquisition is in flight.
      const control = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader }), 'in-flight control acquire');
      await drain();
      assert.equal(control.witness(), true, 'control: an untouched in-flight context admits');
      // Same-content replacement in flight: identical bytes under a new
      // object and an advanced revision. Content-derived keys cannot see
      // it; the entry-captured revision must refuse the witness.
      const replacedPromise = Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader });
      cell.canonical = JSON.parse(JSON.stringify(canonical));
      cell.revision = 2;
      const replaced = await bounded(replacedPromise, 'in-flight replacement acquire');
      await drain();
      assert.ok(replaced.acquisition && replaced.acquisition.packet,
        'replacement: the acquisition itself still resolves');
      assert.equal(replaced.witness(), false,
        'a context replaced during acquisition is not adopted as the baseline');
      // ABA in flight: the content leaves and returns to the original
      // object while the revision advances twice. The returning bytes
      // must not revalidate the acquisition either.
      cell.canonical = canonical;
      cell.revision = 3;
      const abaPromise = Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader });
      cell.canonical = JSON.parse(JSON.stringify(canonical));
      cell.revision = 4;
      cell.canonical = canonical;
      cell.revision = 5;
      const aba = await bounded(abaPromise, 'in-flight ABA acquire');
      await drain();
      assert.equal(aba.witness(), false,
        'an ABA excursion during acquisition refuses, even back on identical bytes');
      // A fresh acquisition on the settled context admits again: the
      // refusal belongs to the invalidated acquisition, not the context.
      const fresh = await bounded(Refresh.acquireSettlementWithWitness(canonical, env,
        { contextReader: reader }), 'post-ABA fresh acquire');
      await drain();
      assert.equal(fresh.witness(), true, 'a fresh acquisition on the settled context admits');
    } finally {
      mock.release();
      await mock.close();
    }
  });

}
