'use strict';
// Shorter caller budget for synthetic HTTP cleanup proofs; never raises the cap.
if (require('node:worker_threads').isMainThread) {
  const Refresh = require('../../scripts/server-live-refresh');
  const original = Refresh.serve;
  Refresh.serve = (canonical, env, options) => original(canonical, env, { ...options, timeoutMs: 1500 });
}
