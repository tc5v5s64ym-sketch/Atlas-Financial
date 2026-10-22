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
}
