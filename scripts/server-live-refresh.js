'use strict';
// Request lifecycle only. The existing LivePlan/Forecast modules own all values.
// Live consumers share active work. Browser reads may replay compatible private
// source evidence; Observer/LivePlan re-evaluate it and Forecast owns all values.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const StageTiming = require('./refresh-stage-timing');
const LIVE_REFRESH_TIMEOUT_MS = 150000;
const MAX_ACTIVE_LIVE_REFRESHES = 2;

if (!isMainThread) {
  const Live = require('./live-plan');
  const controller = new AbortController();
  let check = { qualified: false, checkedAt: null, evidence: null };
  parentPort.on('message', () => controller.abort());
  if (workerData.acquire) {
    // Private acquisition job: the result is an acquisition for the
    // private waiter only. It is never a served response.
    StageTiming.run(() => Live.acquireSettlementForServer(workerData.canonical, process.env, { signal: controller.signal,
      evidence: workerData.evidence, onObservation: value => { check = value; } }),
    stages => parentPort.postMessage({ type: StageTiming.MESSAGE, stages }))
      .then(acquisition => parentPort.postMessage({ acquisition, check }))
      .catch(() => parentPort.postMessage({ error: 'live-refresh-unavailable' }));
  } else {
    StageTiming.run(() => Live.applyForServer(workerData.canonical, process.env, { signal: controller.signal,
      evidence: workerData.evidence, onObservation: value => { check = value; } }),
    stages => parentPort.postMessage({ type: StageTiming.MESSAGE, stages }))
      .then(data => parentPort.postMessage({ data, check }))
      .catch(() => parentPort.postMessage({ error: 'live-refresh-unavailable' }));
  }
} else {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const path = require('node:path');
  const Forecast = require('../public/forecast');
  const Observer = require('./provider-observe');
  const Credentials = require('./local-credentials');
  const observations = require('./server-observation-memory').create();
  const root = path.resolve(__dirname, '..') + path.sep;
  // Private process-local identity only. Never log a key, environment or input.
  const keySalt = crypto.randomBytes(32);
  const active = new Set();
  const jobs = new Map();
  let generation = 0n, observationEpoch = 0n, activeWrites = 0;
  // Set when a forced refresh fails: the retained observation stays in its
  // slot, but replay is held until a later live job completes so the failure
  // is not hidden behind the earlier success.
  let replayHeld = false;
  function unavailable(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }
  function fileRevision(file, metadata) {
    if (!file) return null;
    try {
      const stat = fs.statSync(file, { bigint: true });
      return [file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
    } catch (error) {
      if (error.code !== 'ENOENT' && metadata) metadata.readable = false;
      // A missing file is stable. Unreadable metadata must never authorize reuse.
      return [file, error.code === 'ENOENT' ? null : crypto.randomBytes(32).toString('hex')];
    }
  }
  function contextValue(value, seen = new Map()) {
    // Private identity encoding, never a financial packet or stored schema.
    // V8's wire bytes can differ for equal one-/two-byte-backed JS strings.
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return ['number', Object.is(value, -0) ? '-0' : String(value)];
    if (typeof value === 'bigint') return ['bigint', String(value)];
    if (value === undefined) return ['undefined'];
    if (typeof value !== 'object') throw unavailable('live-refresh-unavailable');
    if (seen.has(value)) return ['reference', seen.get(value)];
    const id = seen.size;
    seen.set(value, id);
    const entries = Object.entries(value).map(([name, child]) => [name, contextValue(child, seen)]);
    if (Array.isArray(value)) return ['array', id, value.length, entries];
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw unavailable('live-refresh-unavailable');
    }
    return ['object', id, entries];
  }
  function financialDay() { return Forecast.financialDate(new Date(Date.now()).toISOString()); }
  function jobKey(canonical, env, metadata = { readable: true }) {
    const runtime = Object.keys(require.cache).filter(file => file.startsWith(root))
      .sort().map(file => fileRevision(file, metadata));
    const files = [Observer.DEFAULT_IDENTITY, Observer.DEFAULT_MAP, Observer.LOCAL_MAP,
      env[Observer.MAP_PATH_ENV] && path.resolve(env[Observer.MAP_PATH_ENV]),
      !Credentials.envToken(env) && process.platform === 'win32'
        ? Credentials.defaultCredentialPath(env) : null].filter(Boolean).map(file => fileRevision(file, metadata));
    const day = financialDay();
    return crypto.createHmac('sha256', keySalt)
      .update(JSON.stringify(contextValue([canonical, Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
        day, process.execArgv, runtime, files, generation]))).digest('hex');
  }
  function emitTiming(job) {
    if (job.logged) return;
    job.logged = true;
    const elapsed = (start, end) => start == null || end == null ? null : Math.max(0, Math.round(end - start));
    // Closed fields only: no payload, error text, provider identity or key.
    // completed means the worker returned, not that provider evidence qualified.
    console.log(JSON.stringify({ type: 'live-refresh-lifecycle', outcome: job.outcome,
      totalMs: elapsed(job.started, job.finished),
      workerStartupMs: elapsed(job.started, job.online),
      workerRunMs: elapsed(job.online, job.finished),
      cleanupMs: elapsed(job.finished, performance.now()),
      waiterCount: job.waiterCount, peakWaiters: job.peakWaiters,
      cancelledWaiters: job.cancelledWaiters, timedOutWaiters: job.timedOutWaiters }));
    console.log(JSON.stringify(StageTiming.record(job.stages, job.evidence ? 'memory' : 'provider',
      job.outcome, job.check?.qualified, job.publicationMs)));
  }
  // --- Write-admission freshness witness (private) -----------------------
  // A witness is minted per waiter inside the acquisition publication
  // continuation (settleWaiter, below) and paired with exactly that
  // waiter's acquisition clone. It captures the lifecycle state the
  // publication barriers just validated — generation, observationEpoch,
  // financial day and context — and re-checks it synchronously at
  // invocation: any invalidation since publication (a provider write, a
  // superseding publish or live job, a replay hold, a day rollover, a
  // context replacement) refuses. When the trusted caller supplied a
  // synchronous current-context reader, the witness additionally requires
  // a fresh reading whose recomputed context key matches AND whose
  // monotonic revision is unchanged since publication, so replacement
  // and ABA are detected even where content — and therefore the context
  // key — returns to identical bytes; without a reader it recomputes the
  // job's own context key from its captured inputs. Reader failure,
  // malformed or asynchronous results, or any uncertainty refuse. There
  // is no global latest-witness slot: each closure captures only its own
  // job's state.
  const REFUSING_WITNESS = () => false;
  function readContextReader(reader) {
    try {
      const value = reader();
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      if (typeof value.then === 'function') return null;
      const revision = value.contextRevision;
      if (!Number.isSafeInteger(revision) || revision < 0) return null;
      const metadata = { readable: true };
      const key = jobKey(value.canonical, value.env, metadata);
      if (!metadata.readable) return null;
      return { key, revision };
    } catch { return null; }
  }
  function mintWitness(job, suppliedReader) {
    const context = job.context, day = job.day;
    const gen = generation, epoch = observationEpoch;
    if (suppliedReader !== undefined && typeof suppliedReader !== 'function') {
      return REFUSING_WITNESS;
    }
    const reader = typeof suppliedReader === 'function' ? suppliedReader : null;
    let baseline = null;
    if (reader) {
      baseline = readContextReader(reader);
      if (!baseline || baseline.key !== context) return REFUSING_WITNESS;
    }
    return function freshnessWitness() {
      try {
        if (generation !== gen || observationEpoch !== epoch) return false;
        if (activeWrites !== 0 || replayHeld) return false;
        if (jobs.has(context + ':live')) return false;
        if (financialDay() !== day) return false;
        if (reader) {
          const reading = readContextReader(reader);
          if (!reading || reading.key !== context || reading.revision !== baseline.revision) return false;
        } else {
          const metadata = { readable: true };
          if (jobKey(job.contextInput, job.contextEnv, metadata) !== context || !metadata.readable) return false;
        }
        return true;
      } catch { return false; }
    };
  }
  function settleWaiter(job, waiter, error, data) {
    if (!job.waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener('abort', waiter.cancelled);
    if (!error && waiter.forceRefresh && job.check?.qualified !== true) error = unavailable('live-refresh-unavailable');
    if (error) waiter.reject(error);
    // Each request keeps the same independent ownership as a dedicated worker.
    else {
      const checkedAt = job.check?.checkedAt;
      try { waiter.onCheck?.({ source: job.evidence ? 'memory' : 'provider',
        qualified: job.check?.qualified === true,
        checkedAt: typeof checkedAt === 'string' && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : null }); }
      catch (_) { /* Response closed; never change a financial result. */ }
      // Admission waiters receive their own acquisition clone plus their
      // own witness, minted now — inside the publication continuation,
      // after every barrier above has validated this exact job. The
      // witness pairs the job's validated state with the reader that
      // waiter itself supplied. The acquisition itself is unchanged and
      // carries no witness.
      if (job.admission) waiter.resolve({ acquisition: structuredClone(data), witness: mintWitness(job, waiter.contextReader) });
      else waiter.resolve(structuredClone(data));
    }
  }
  function finishJob(job, error, data) {
    if (job.settled) return;
    job.settled = true;
    job.finished = performance.now();
    job.outcome = error ? error.code : 'completed';
    clearTimeout(job.timer);
    if (jobs.get(job.key) === job) jobs.delete(job.key);
    for (const waiter of [...job.waiters]) settleWaiter(job, waiter, error, data);
    if (!job.worker) return emitTiming(job);
    const terminate = () => job.worker.terminate().catch(() => {});
    try { job.worker.postMessage({ abort: true }); } catch (_) { /* Already exited. */ }
    // Give cooperative transports their existing grace, then stop synchronous work.
    if (error) setTimeout(terminate, 50).unref();
    else terminate();
  }
  function invalidate() {
    generation++;
    observationEpoch++;
    observations.clear();
    // Once a write may occur, no waiting reader can publish the obsolete job.
    // Slots still belong to those workers until their actual exit.
    for (const job of [...jobs.values()]) finishJob(job, unavailable('live-refresh-invalidated'));
  }
  async function withProviderWrite(invoke) {
    activeWrites++;
    invalidate();
    try { return await invoke(); }
    finally {
      activeWrites--;
      // Includes rejected, uncertain, audit-failed and thrown write attempts.
      invalidate();
    }
  }
  function startJob(job, canonical, env) {
    if (job.settled) return;
    job.timer = setTimeout(() => {
      // A job-level timeout is a forced-refresh termination too: the hold
      // must be recorded before the job settles, like every other path.
      if (!job.evidence && (job.hadForcedWaiter || [...job.waiters].some(waiter => waiter.forceRefresh))) replayHeld = true;
      finishJob(job, unavailable('live-refresh-timeout'));
    }, LIVE_REFRESH_TIMEOUT_MS);
    try {
      const worker = job.worker = new Worker(__filename, { workerData: { canonical, evidence: job.evidence, acquire: job.acquire === true }, env });
      active.add(worker);
      worker.once('online', () => { if (!job.settled) job.online = performance.now(); });
      worker.on('message', result => {
        if (job.settled) return;
        if (result?.type === StageTiming.MESSAGE) {
          const stages = StageTiming.accept(result.stages);
          if (stages) job.stages = stages;
          return;
        }
        const publicationStarted = performance.now();
        try {
        if (job.generation !== generation || activeWrites) return finishJob(job, unavailable('live-refresh-invalidated'));
        if (job.evidence && job.observationEpoch !== observationEpoch) return finishJob(job, unavailable('live-refresh-invalidated'));
        // A rollover/config change during work cannot publish an old-context verdict.
        const metadata = { readable: true }, matches = job.context === jobKey(canonical, env, metadata);
        if (job.day !== financialDay() || job.cacheable && (!metadata.readable || !matches)) {
          return finishJob(job, unavailable('live-refresh-invalidated'));
        }
        job.check = result?.check;
        // Forced participation includes a forced waiter who already left
        // (timeout/cancel): the completion must not cleanse their hold.
        const forced = job.hadForcedWaiter || [...job.waiters].some(waiter => waiter.forceRefresh);
        if (!job.evidence && result?.data) {
          let published = false;
          if (job.cacheable && metadata.readable && matches && result.check?.qualified === true && result.check.evidence
            && Forecast.financialDate(result.check.checkedAt) === financialDay()) {
            try { observations.publish(job.context, result.check.evidence); published = true; } catch (_) { /* Live path only. */ }
          }
          if (published) {
            // The new qualified observation replaces the retained one;
            // in-flight replays of the superseded evidence cannot settle.
            observationEpoch++;
            replayHeld = false;
          } else if (typeof result.check?.checkedAt === 'string') {
            // A dated provider answer that does not qualify is the current
            // truth: it supersedes any retained qualified observation.
            observationEpoch++;
            observations.clear();
            replayHeld = forced;
          } else {
            // A failed check (no dated answer) never destroys retained
            // qualified evidence. A failed forced refresh still holds
            // replay until a later live job completes, so the failure is
            // not hidden behind the earlier success.
            replayHeld = forced;
          }
        } else if (!job.evidence) {
          // A live job that produced no result at all follows the same
          // retention/hold rule as a failed check.
          replayHeld = forced;
        }
        if (job.evidence && result?.check?.qualified !== true) {
          observationEpoch++;
          observations.clear();
          return finishJob(job, unavailable('live-refresh-unavailable'));
        }
        if (job.acquire) {
          // The private waiter receives the acquisition and nothing
          // else; serve waiters on other jobs never see this result.
          return result?.acquisition
            ? finishJob(job, null, result.acquisition)
            : finishJob(job, unavailable('live-refresh-unavailable'));
        }
        return result?.data ? finishJob(job, null, result.data) : finishJob(job, unavailable('live-refresh-unavailable'));
        } finally { job.publicationMs = Math.max(0, performance.now() - publicationStarted); }
      });
      worker.on('error', () => {
        if (!job.settled && !job.evidence) replayHeld = job.hadForcedWaiter || [...job.waiters].some(waiter => waiter.forceRefresh);
        finishJob(job, unavailable('live-refresh-unavailable'));
      });
      worker.on('exit', () => {
        active.delete(worker);
        if (!job.settled) {
          if (!job.evidence) replayHeld = job.hadForcedWaiter || [...job.waiters].some(waiter => waiter.forceRefresh);
          finishJob(job, unavailable('live-refresh-unavailable'));
        }
        emitTiming(job);
      });
    } catch (_) {
      // A constructor failure is a forced-refresh termination too: record
      // the hold for any forced waiter before settling the job.
      if (!job.evidence && [...job.waiters].some(waiter => waiter.forceRefresh)) replayHeld = true;
      finishJob(job, unavailable('live-refresh-unavailable'));
    }
  }
  function serve(canonical, env, options = {}) {
    const Live = require('./live-plan');
    if (Live.overlayModeFromEnv(env) !== 'live') return options.forceRefresh
      ? Promise.reject(unavailable('live-refresh-unavailable')) : Live.applyForServer(canonical, env);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(unavailable('live-refresh-cancelled'));
    if (activeWrites) return Promise.reject(unavailable('live-refresh-invalidated'));
    // Shorter budgets support bounded callers/tests; no caller can raise the cap.
    const requested = options.timeoutMs;
    const budget = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, LIVE_REFRESH_TIMEOUT_MS) : LIVE_REFRESH_TIMEOUT_MS;
    let key, context, evidence = null, input, workerEnv;
    const metadata = { readable: true };
    try {
      input = structuredClone(canonical);
      workerEnv = Object.fromEntries(Object.entries(env || process.env).map(([name, value]) => [name, String(value)]));
      context = jobKey(input, workerEnv, metadata);
      key = context + ':live';
      if (metadata.readable && !replayHeld && !jobs.has(key) && options.preferObservation === true && !options.forceRefresh) {
        evidence = observations.read(context);
        if (evidence) key = context + ':replay';
      }
    } catch (_) { return Promise.reject(unavailable('live-refresh-unavailable')); }
    let job = jobs.get(key);
    const fresh = !job;
    // Equivalent callers can join even when the distinct-worker cap is full.
    if (fresh && active.size >= MAX_ACTIVE_LIVE_REFRESHES) return Promise.reject(unavailable('live-refresh-busy'));
    if (fresh) {
      // Starting a live job invalidates in-flight replays of the retained
      // observation (their verdicts predate this attempt), but it never
      // destroys the observation itself: the slot is replaced only by a
      // new qualified publish, a dated unqualified answer, or a hard
      // invalidator.
      if (!evidence) observationEpoch++;
      job = { key, context, evidence, cacheable: metadata.readable, day: financialDay(), generation, observationEpoch,
        started: performance.now(), waiters: new Set(), waiterCount: 0,
        peakWaiters: 0, cancelledWaiters: 0, timedOutWaiters: 0, settled: false, hadForcedWaiter: false };
      jobs.set(key, job);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onCheck: options.onCheck, forceRefresh: options.forceRefresh === true };
      const leave = code => {
        if (!job.waiters.has(waiter)) return;
        if (code === 'live-refresh-cancelled') job.cancelledWaiters++;
        else job.timedOutWaiters++;
        const error = unavailable(code);
        settleWaiter(job, waiter, error);
        // A forced waiter who leaves unserved (timeout/cancel) means the
        // forced refresh has failed for the publication barrier, whatever
        // the job does next: hold replay now, and mark the job so its
        // completion bookkeeping cannot cleanse the hold. A later
        // qualified publish still releases it.
        if (!job.evidence && waiter.forceRefresh) { job.hadForcedWaiter = true; replayHeld = true; }
        if (!job.waiters.size) finishJob(job, error);
      };
      waiter.cancelled = () => leave('live-refresh-cancelled');
      waiter.timer = setTimeout(() => leave('live-refresh-timeout'), budget);
      job.waiters.add(waiter);
      job.waiterCount++;
      job.peakWaiters = Math.max(job.peakWaiters, job.waiters.size);
      signal?.addEventListener('abort', waiter.cancelled, { once: true });
      if (signal?.aborted) waiter.cancelled();
      if (fresh) startJob(job, input, workerEnv);
    });
  }
  // Unserved private settlement acquisition. Memory-replay only: the
  // retained source observation for this exact context is re-evaluated
  // by a distinct private job through the same worker lifecycle, caps,
  // ownership, deadlines and publication barriers as serve(). Held,
  // unreadable, superseded or missing memory is unavailable — an
  // acquisition never starts a provider (live) job, never joins one,
  // and is never returned to a serve caller. Each call reacquires; no
  // acquisition is retained after its waiters settle.
  function acquireSettlement(canonical, env, options = {}) {
    const Live = require('./live-plan');
    if (Live.overlayModeFromEnv(env) !== 'live') return Promise.reject(unavailable('live-refresh-unavailable'));
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(unavailable('live-refresh-cancelled'));
    if (activeWrites) return Promise.reject(unavailable('live-refresh-invalidated'));
    // Shorter budgets support bounded callers/tests; no caller can raise the cap.
    const requested = options.timeoutMs;
    const budget = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, LIVE_REFRESH_TIMEOUT_MS) : LIVE_REFRESH_TIMEOUT_MS;
    let context, evidence = null, input, workerEnv;
    const metadata = { readable: true };
    try {
      input = structuredClone(canonical);
      workerEnv = Object.fromEntries(Object.entries(env || process.env).map(([name, value]) => [name, String(value)]));
      context = jobKey(input, workerEnv, metadata);
      if (!metadata.readable || replayHeld || jobs.has(context + ':live')) {
        return Promise.reject(unavailable('live-refresh-unavailable'));
      }
      evidence = observations.read(context);
      if (!evidence) return Promise.reject(unavailable('live-refresh-unavailable'));
    } catch (_) { return Promise.reject(unavailable('live-refresh-unavailable')); }
    const key = context + ':acquire';
    let job = jobs.get(key);
    const fresh = !job;
    // Equivalent callers can join even when the distinct-worker cap is full.
    if (fresh && active.size >= MAX_ACTIVE_LIVE_REFRESHES) return Promise.reject(unavailable('live-refresh-busy'));
    if (fresh) {
      job = { key, context, evidence, acquire: true, cacheable: metadata.readable, day: financialDay(), generation, observationEpoch,
        started: performance.now(), waiters: new Set(), waiterCount: 0,
        peakWaiters: 0, cancelledWaiters: 0, timedOutWaiters: 0, settled: false, hadForcedWaiter: false };
      jobs.set(key, job);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal };
      const leave = code => {
        if (!job.waiters.has(waiter)) return;
        if (code === 'live-refresh-cancelled') job.cancelledWaiters++;
        else job.timedOutWaiters++;
        const error = unavailable(code);
        settleWaiter(job, waiter, error);
        if (!job.waiters.size) finishJob(job, error);
      };
      waiter.cancelled = () => leave('live-refresh-cancelled');
      waiter.timer = setTimeout(() => leave('live-refresh-timeout'), budget);
      job.waiters.add(waiter);
      job.waiterCount++;
      job.peakWaiters = Math.max(job.peakWaiters, job.waiters.size);
      signal?.addEventListener('abort', waiter.cancelled, { once: true });
      if (signal?.aborted) waiter.cancelled();
      if (fresh) startJob(job, input, workerEnv);
    });
  }
  // Unserved private write-admission acquisition: the identical
  // memory-replay lifecycle as acquireSettlement (same singleton state,
  // jobs discipline, caps, deadlines and publication barriers — never a
  // second lifecycle or cache), except each waiter additionally receives
  // its own synchronous freshness witness minted inside the publication
  // continuation and paired with exactly its acquisition clone:
  // acquireSettlementWithWitness(...) -> { acquisition, witness }.
  // options.contextReader is an optional trusted synchronous reader
  // returning the current canonical/environment inputs and a monotonic
  // contextRevision; it is supplied only by a trusted composition (in
  // tests, a labelled synthetic fixture) — no production authority reader
  // is wired anywhere. The witness is a private capability for the
  // settlement store's admission fence: it is never served, logged,
  // serialized or attached to the acquisition itself.
  function acquireSettlementWithWitness(canonical, env, options = {}) {
    const Live = require('./live-plan');
    if (Live.overlayModeFromEnv(env) !== 'live') return Promise.reject(unavailable('live-refresh-unavailable'));
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(unavailable('live-refresh-cancelled'));
    if (activeWrites) return Promise.reject(unavailable('live-refresh-invalidated'));
    // Shorter budgets support bounded callers/tests; no caller can raise the cap.
    const requested = options.timeoutMs;
    const budget = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, LIVE_REFRESH_TIMEOUT_MS) : LIVE_REFRESH_TIMEOUT_MS;
    let context, evidence = null, input, workerEnv;
    const metadata = { readable: true };
    try {
      input = structuredClone(canonical);
      workerEnv = Object.fromEntries(Object.entries(env || process.env).map(([name, value]) => [name, String(value)]));
      context = jobKey(input, workerEnv, metadata);
      if (!metadata.readable || replayHeld || jobs.has(context + ':live')) {
        return Promise.reject(unavailable('live-refresh-unavailable'));
      }
      evidence = observations.read(context);
      if (!evidence) return Promise.reject(unavailable('live-refresh-unavailable'));
    } catch (_) { return Promise.reject(unavailable('live-refresh-unavailable')); }
    const key = context + ':acquire-witness';
    let job = jobs.get(key);
    const fresh = !job;
    // Equivalent callers can join even when the distinct-worker cap is full.
    if (fresh && active.size >= MAX_ACTIVE_LIVE_REFRESHES) return Promise.reject(unavailable('live-refresh-busy'));
    if (fresh) {
      job = { key, context, evidence, acquire: true, admission: true, cacheable: metadata.readable,
        day: financialDay(), generation, observationEpoch,
        contextInput: input, contextEnv: workerEnv,
        started: performance.now(), waiters: new Set(), waiterCount: 0,
        peakWaiters: 0, cancelledWaiters: 0, timedOutWaiters: 0, settled: false, hadForcedWaiter: false };
      jobs.set(key, job);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, contextReader: options.contextReader };
      const leave = code => {
        if (!job.waiters.has(waiter)) return;
        if (code === 'live-refresh-cancelled') job.cancelledWaiters++;
        else job.timedOutWaiters++;
        const error = unavailable(code);
        settleWaiter(job, waiter, error);
        if (!job.waiters.size) finishJob(job, error);
      };
      waiter.cancelled = () => leave('live-refresh-cancelled');
      waiter.timer = setTimeout(() => leave('live-refresh-timeout'), budget);
      job.waiters.add(waiter);
      job.waiterCount++;
      job.peakWaiters = Math.max(job.peakWaiters, job.waiters.size);
      signal?.addEventListener('abort', waiter.cancelled, { once: true });
      if (signal?.aborted) waiter.cancelled();
      if (fresh) startJob(job, input, workerEnv);
    });
  }
  module.exports = { serve, acquireSettlement, acquireSettlementWithWitness, withProviderWrite, LIVE_REFRESH_TIMEOUT_MS, MAX_ACTIVE_LIVE_REFRESHES };
}
