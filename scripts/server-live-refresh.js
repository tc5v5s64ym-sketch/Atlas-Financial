'use strict';
// Request lifecycle only. The existing LivePlan/Forecast modules own all values.
// Live consumers share active work. Browser reads may replay compatible private
// source evidence; Observer/LivePlan re-evaluate it and Forecast owns all values.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const LIVE_REFRESH_TIMEOUT_MS = 150000;
const MAX_ACTIVE_LIVE_REFRESHES = 2;

if (!isMainThread) {
  const Live = require('./live-plan');
  const controller = new AbortController();
  let check = { qualified: false, checkedAt: null, evidence: null };
  parentPort.on('message', () => controller.abort());
  Live.applyForServer(workerData.canonical, process.env, { signal: controller.signal,
    evidence: workerData.evidence, onObservation: value => { check = value; } })
    .then(data => parentPort.postMessage({ data, check }))
    .catch(() => parentPort.postMessage({ error: 'live-refresh-unavailable' }));
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
      waiter.resolve(structuredClone(data));
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
    job.timer = setTimeout(() => finishJob(job, unavailable('live-refresh-timeout')), LIVE_REFRESH_TIMEOUT_MS);
    try {
      const worker = job.worker = new Worker(__filename, { workerData: { canonical, evidence: job.evidence }, env });
      active.add(worker);
      worker.once('online', () => { if (!job.settled) job.online = performance.now(); });
      worker.on('message', result => {
        if (job.settled) return;
        if (job.generation !== generation || activeWrites) return finishJob(job, unavailable('live-refresh-invalidated'));
        if (job.evidence && job.observationEpoch !== observationEpoch) return finishJob(job, unavailable('live-refresh-invalidated'));
        // A rollover/config change during work cannot publish an old-context verdict.
        const metadata = { readable: true }, matches = job.context === jobKey(canonical, env, metadata);
        if (job.day !== financialDay() || job.cacheable && (!metadata.readable || !matches)) {
          return finishJob(job, unavailable('live-refresh-invalidated'));
        }
        job.check = result?.check;
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
            replayHeld = [...job.waiters].some(waiter => waiter.forceRefresh);
          } else {
            // A failed check (no dated answer) never destroys retained
            // qualified evidence. A failed forced refresh still holds
            // replay until a later live job completes, so the failure is
            // not hidden behind the earlier success.
            replayHeld = [...job.waiters].some(waiter => waiter.forceRefresh);
          }
        } else if (!job.evidence) {
          // A live job that produced no result at all follows the same
          // retention/hold rule as a failed check.
          replayHeld = [...job.waiters].some(waiter => waiter.forceRefresh);
        }
        if (job.evidence && result?.check?.qualified !== true) {
          observationEpoch++;
          observations.clear();
          return finishJob(job, unavailable('live-refresh-unavailable'));
        }
        return result?.data ? finishJob(job, null, result.data) : finishJob(job, unavailable('live-refresh-unavailable'));
      });
      worker.on('error', () => {
        if (!job.settled && !job.evidence) replayHeld = [...job.waiters].some(waiter => waiter.forceRefresh);
        finishJob(job, unavailable('live-refresh-unavailable'));
      });
      worker.on('exit', () => {
        active.delete(worker);
        if (!job.settled) {
          if (!job.evidence) replayHeld = [...job.waiters].some(waiter => waiter.forceRefresh);
          finishJob(job, unavailable('live-refresh-unavailable'));
        }
        emitTiming(job);
      });
    } catch (_) { finishJob(job, unavailable('live-refresh-unavailable')); }
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
      // Starting a live job never destroys the retained observation: it is
      // replaced only by a new qualified publish or a hard invalidator.
      job = { key, context, evidence, cacheable: metadata.readable, day: financialDay(), generation, observationEpoch,
        started: performance.now(), waiters: new Set(), waiterCount: 0,
        peakWaiters: 0, cancelledWaiters: 0, timedOutWaiters: 0, settled: false };
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
  module.exports = { serve, withProviderWrite, LIVE_REFRESH_TIMEOUT_MS, MAX_ACTIVE_LIVE_REFRESHES };
}
