'use strict';
// Only loaded by the deadline test's isolated child, never production.
const { isMainThread } = require('node:worker_threads');
if (!isMainThread) {
  require('../../scripts/live-plan').applyForServer = () => {
    const end = Date.now() + 5000;
    while (Date.now() < end) { /* deliberately block this worker, not the server */ }
    throw new Error('busy worker was not terminated');
  };
}
