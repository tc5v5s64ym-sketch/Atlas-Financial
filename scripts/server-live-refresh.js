'use strict';
// Request lifecycle only. The existing LivePlan/Forecast modules own all values.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const LIVE_REFRESH_TIMEOUT_MS = 15000;
const MAX_ACTIVE_LIVE_REFRESHES = 2;

if (!isMainThread) {
  const Live = require('./live-plan');
  const controller = new AbortController();
  parentPort.on('message', () => controller.abort());
  Live.applyForServer(workerData.canonical, process.env, { signal: controller.signal })
    .then(data => parentPort.postMessage({ data }))
    .catch(() => parentPort.postMessage({ error: 'live-refresh-unavailable' }));
} else {
  const active = new Set();
  function unavailable(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }
  function serve(canonical, env, options = {}) {
    const Live = require('./live-plan');
    if (Live.overlayModeFromEnv(env) !== 'live') return Live.applyForServer(canonical, env);
    const signal = options.signal;
    if (signal?.aborted) return Promise.reject(unavailable('live-refresh-cancelled'));
    if (active.size >= MAX_ACTIVE_LIVE_REFRESHES) return Promise.reject(unavailable('live-refresh-busy'));
    // Shorter budgets support bounded callers/tests; no caller can raise the cap.
    const requested = options.timeoutMs;
    const budget = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, LIVE_REFRESH_TIMEOUT_MS) : LIVE_REFRESH_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      let settled = false, worker;
      const finish = (error, data) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancelled);
        if (worker) {
          // Termination also closes the worker's sockets and interrupts synchronous
          // projection; racing a Promise would leave that work running.
          worker.postMessage({ abort: true });
          // Let cooperative transports stop their child processes first. Busy
          // synchronous work still gets forcibly interrupted after this short grace.
          if (error) setTimeout(() => worker.terminate().catch(() => {}), 50);
          else worker.terminate().catch(() => {});
        }
        if (error) reject(error); else resolve(data);
      };
      const cancelled = () => finish(unavailable('live-refresh-cancelled'));
      const timer = setTimeout(() => finish(unavailable('live-refresh-timeout')), budget);
      signal?.addEventListener('abort', cancelled, { once: true });
      try {
        worker = new Worker(__filename, { workerData: { canonical }, env });
        active.add(worker);
        worker.on('message', result => result?.data
          ? finish(null, result.data) : finish(unavailable('live-refresh-unavailable')));
        worker.on('error', () => finish(unavailable('live-refresh-unavailable')));
        worker.on('exit', () => {
          active.delete(worker);
          if (!settled) finish(unavailable('live-refresh-unavailable'));
        });
        if (signal?.aborted) cancelled();
      } catch (_) { finish(unavailable('live-refresh-unavailable')); }
    });
  }
  module.exports = { serve, LIVE_REFRESH_TIMEOUT_MS, MAX_ACTIVE_LIVE_REFRESHES };
}
