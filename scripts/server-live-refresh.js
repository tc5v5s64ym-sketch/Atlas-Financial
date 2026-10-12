'use strict';
// Request lifecycle only. The existing LivePlan/Forecast modules own all values.
// Share equivalent in-flight work only; every sequential/cold request still
// refreshes. No completed observation or calculated-publication cache lives here.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const LIVE_REFRESH_TIMEOUT_MS = 150000;
const MAX_ACTIVE_LIVE_REFRESHES = 2;

if (!isMainThread) {
  const Live = require('./live-plan');
  const controller = new AbortController();
  parentPort.on('message', () => controller.abort());
  Live.applyForServer(workerData.canonical, process.env, { signal: controller.signal })
    .then(data => parentPort.postMessage({ data }))
    .catch(() => parentPort.postMessage({ error: 'live-refresh-unavailable' }));
} else {
  const crypto = require('node:crypto');
  const fs = require('node:fs');
  const path = require('node:path');
  const Forecast = require('../public/forecast');
  const Observer = require('./provider-observe');
  const Credentials = require('./local-credentials');
  const root = path.resolve(__dirname, '..') + path.sep;
  // Private process-local identity only. Never log a key, environment or input.
  const keySalt = crypto.randomBytes(32);
  const active = new Set();
  const jobs = new Map();
  let generation = 0n, activeWrites = 0;
  function unavailable(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }
  function fileRevision(file) {
    if (!file) return null;
    try {
      const stat = fs.statSync(file, { bigint: true });
      return [file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs];
    } catch (error) {
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
  function jobKey(canonical, env) {
    const runtime = Object.keys(require.cache).filter(file => file.startsWith(root))
      .sort().map(fileRevision);
    const files = [Observer.DEFAULT_IDENTITY, Observer.DEFAULT_MAP, Observer.LOCAL_MAP,
      env[Observer.MAP_PATH_ENV] && path.resolve(env[Observer.MAP_PATH_ENV]),
      !Credentials.envToken(env) && process.platform === 'win32'
        ? Credentials.defaultCredentialPath(env) : null].filter(Boolean).map(fileRevision);
    const day = Forecast.financialDate(new Date(Date.now()).toISOString());
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
    if (error) waiter.reject(error);
    // Each request keeps the same independent ownership as a dedicated worker.
    else waiter.resolve(structuredClone(data));
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
      const worker = job.worker = new Worker(__filename, { workerData: { canonical }, env });
      active.add(worker);
      worker.once('online', () => { if (!job.settled) job.online = performance.now(); });
      worker.on('message', result => {
        if (job.generation !== generation || activeWrites) return finishJob(job, unavailable('live-refresh-invalidated'));
        return result?.data ? finishJob(job, null, result.data) : finishJob(job, unavailable('live-refresh-unavailable'));
      });
      worker.on('error', () => finishJob(job, unavailable('live-refresh-unavailable')));
      worker.on('exit', () => {
        active.delete(worker);
        if (!job.settled) finishJob(job, unavailable('live-refresh-unavailable'));
        emitTiming(job);
      });
    } catch (_) { finishJob(job, unavailable('live-refresh-unavailable')); }
  }
  function serve(canonical, env, options = {}) {
    const Live = require('./live-plan');
    if (Live.overlayModeFromEnv(env) !== 'live') return Live.applyForServer(canonical, env);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(unavailable('live-refresh-cancelled'));
    if (activeWrites) return Promise.reject(unavailable('live-refresh-invalidated'));
    // Shorter budgets support bounded callers/tests; no caller can raise the cap.
    const requested = options.timeoutMs;
    const budget = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, LIVE_REFRESH_TIMEOUT_MS) : LIVE_REFRESH_TIMEOUT_MS;
    let key, input, workerEnv;
    try {
      input = structuredClone(canonical);
      workerEnv = Object.fromEntries(Object.entries(env || process.env).map(([name, value]) => [name, String(value)]));
      key = jobKey(input, workerEnv);
    } catch (_) { return Promise.reject(unavailable('live-refresh-unavailable')); }
    let job = jobs.get(key);
    const fresh = !job;
    // Equivalent callers can join even when the distinct-worker cap is full.
    if (fresh && active.size >= MAX_ACTIVE_LIVE_REFRESHES) return Promise.reject(unavailable('live-refresh-busy'));
    if (fresh) {
      job = { key, generation, started: performance.now(), waiters: new Set(), waiterCount: 0,
        peakWaiters: 0, cancelledWaiters: 0, timedOutWaiters: 0, settled: false };
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
  module.exports = { serve, withProviderWrite, LIVE_REFRESH_TIMEOUT_MS, MAX_ACTIVE_LIVE_REFRESHES };
}
