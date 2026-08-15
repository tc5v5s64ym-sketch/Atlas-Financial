'use strict';
/* Confirm a locally pushed SHA is the live GitHub PR head before bookkeeping.
 * `node scripts/atlas-github-pr-head-sync.js`
 *
 * GitHub's pull-request API can briefly report the previous head after a
 * successful `git push`. A one-shot read of that stale SHA is retryable. An
 * unexpected third SHA, a closed PR, a base or branch change, or an identity
 * change is not. Successful `git push` is never sufficient proof.
 *
 * The classify / wait core never talks to the network. The `confirm` CLI uses
 * `gh api` as the injected fetcher. Bookkeeping callbacks run only after the
 * live head equals the pushed SHA, and they run exactly once per confirmation.
 *
 * CLI:
 *   classify <snapshot.json> <expected.json>  → JSON; exit 0 converged, 2 stale, 1 fail
 *   confirm  <request.json>                   → live PR JSON; exit 0 or 1
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gate = require('./atlas-cursor-repair-gate');

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_INTERVAL_MS = 500;
const SHA_RE = /^[0-9a-f]{40}$/i;
const BOOKKEEPING_ACTIONS = Object.freeze([
  'reviewPending',
  'repairRound',
  'readinessHandoff',
]);

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase();
}

function isSha(value) {
  return SHA_RE.test(normalizeSha(value));
}

function sleepSync(ms) {
  const duration = Number(ms);
  if (!Number.isFinite(duration) || duration <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.ceil(duration));
}

function fail(code, reason, extra) {
  return { ok: false, retryable: false, mutate: false, code, reason, ...extra };
}

function repoFullName(snapshot) {
  const baseRepo = snapshot && snapshot.base && snapshot.base.repo && snapshot.base.repo.full_name;
  const headRepo = snapshot && snapshot.head && snapshot.head.repo && snapshot.head.repo.full_name;
  return {
    baseRepo: baseRepo ? String(baseRepo) : '',
    headRepo: headRepo ? String(headRepo) : '',
  };
}

function classifyLivePrHeadRead(snapshot, expected) {
  const identity = expected && expected.identity;
  if (!expected || !isSha(expected.expectedSha)) {
    return fail('malformed-expected-sha', 'Pushed SHA is missing or not a 40-character SHA.');
  }
  if (!identity || identity.prNumber == null || identity.prNumber === ''
    || !identity.repository || !identity.headRef || !identity.baseRef) {
    return fail('malformed-identity', 'Expected PR identity is incomplete.');
  }
  if (!snapshot || typeof snapshot !== 'object') {
    return fail('malformed-snapshot', 'Live PR snapshot is missing.');
  }

  const expectedNumber = Number(identity.prNumber);
  const liveNumber = Number(snapshot.number);
  if (!Number.isInteger(expectedNumber) || expectedNumber <= 0) {
    return fail('malformed-identity', 'Expected PR number is not a positive integer.');
  }
  if (!Number.isInteger(liveNumber) || liveNumber <= 0) {
    return fail('malformed-snapshot', 'Live PR snapshot has no PR number.');
  }
  if (liveNumber !== expectedNumber) {
    return fail('identity-changed', `Live PR number ${liveNumber} is not expected PR ${expectedNumber}.`);
  }

  const repos = repoFullName(snapshot);
  if (!repos.baseRepo) {
    return fail('malformed-snapshot', 'Live PR snapshot is missing base repository identity.');
  }
  if (repos.baseRepo !== String(identity.repository)) {
    return fail('identity-changed', `Live PR repository ${repos.baseRepo} is not ${identity.repository}.`);
  }
  if (repos.headRepo && repos.headRepo !== String(identity.repository)) {
    return fail('identity-changed', `Live PR head repository ${repos.headRepo} is not ${identity.repository}.`);
  }

  if (!snapshot.head || snapshot.head.sha == null || snapshot.head.ref == null
    || !snapshot.base || snapshot.base.ref == null || snapshot.state == null) {
    return fail('malformed-snapshot', 'Live PR snapshot is missing state, base, or head fields.');
  }

  if (snapshot.state !== 'open' || snapshot.merged === true) {
    return fail('pr-closed', 'Pull request is not open.');
  }
  if (String(snapshot.base.ref) !== String(identity.baseRef)) {
    return fail('base-changed', `Pull request base is ${snapshot.base.ref}, not ${identity.baseRef}.`);
  }
  if (String(identity.baseRef) !== 'main') {
    return fail('base-changed', `Expected base ${identity.baseRef} is not main.`);
  }
  if (String(snapshot.head.ref) !== String(identity.headRef)) {
    return fail('branch-changed', `Pull request branch is ${snapshot.head.ref}, not ${identity.headRef}.`);
  }

  const liveHead = normalizeSha(snapshot.head.sha);
  const expectedSha = normalizeSha(expected.expectedSha);
  const previousSha = normalizeSha(expected.previousSha);
  if (!isSha(liveHead)) {
    return fail('malformed-head', 'Live PR head is not a 40-character SHA.');
  }
  if (gate.isExactCurrentHead(expectedSha, liveHead)) {
    return {
      ok: true,
      retryable: false,
      mutate: true,
      code: 'converged',
      reason: 'Live PR head equals the pushed SHA.',
      liveHead,
      expectedSha,
    };
  }
  if (previousSha && isSha(previousSha) && gate.isExactCurrentHead(previousSha, liveHead)) {
    return {
      ok: false,
      retryable: true,
      mutate: false,
      code: 'stale-previous',
      reason: 'Live PR head is still the previous SHA; retrying.',
      liveHead,
      expectedSha,
      previousSha,
    };
  }
  return fail('unexpected-head', `Live PR head ${liveHead} is neither the pushed SHA nor the previous SHA.`, {
    liveHead,
    expectedSha,
    previousSha,
  });
}

function runNamedBookkeeping(actions, snapshot, waitResult) {
  const results = {};
  if (!actions || typeof actions !== 'object') return results;
  for (const name of BOOKKEEPING_ACTIONS) {
    if (typeof actions[name] === 'function') {
      results[name] = actions[name](snapshot, waitResult);
    }
  }
  return results;
}

function waitForLivePrHead(input) {
  const timeoutMs = Number(input && input.timeoutMs != null ? input.timeoutMs : DEFAULT_TIMEOUT_MS);
  const intervalMs = Number(input && input.intervalMs != null ? input.intervalMs : DEFAULT_INTERVAL_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    return fail('malformed-timeout', 'timeoutMs must be a non-negative number.');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    return fail('malformed-timeout', 'intervalMs must be a non-negative number.');
  }
  if (typeof (input && input.fetchPr) !== 'function') {
    return fail('malformed-fetcher', 'fetchPr is required.');
  }
  const now = typeof input.now === 'function' ? input.now : Date.now;
  const sleep = typeof input.sleep === 'function' ? input.sleep : sleepSync;
  const started = now();
  const deadline = started + timeoutMs;
  let attempts = 0;

  while (true) {
    attempts += 1;
    let snapshot;
    try {
      snapshot = input.fetchPr(attempts);
    } catch (error) {
      return fail('fetch-failed', `Live PR fetch failed: ${error && error.message ? error.message : error}.`, {
        attempts,
        elapsedMs: now() - started,
      });
    }
    const verdict = classifyLivePrHeadRead(snapshot, input);
    if (verdict.code === 'converged') {
      return {
        ...verdict,
        snapshot,
        attempts,
        elapsedMs: now() - started,
      };
    }
    if (!verdict.retryable) {
      return { ...verdict, snapshot, attempts, elapsedMs: now() - started };
    }
    const t = now();
    if (t >= deadline) {
      return fail('timeout', `Live PR head did not converge to the pushed SHA within ${timeoutMs}ms.`, {
        attempts,
        elapsedMs: t - started,
        liveHead: verdict.liveHead,
        expectedSha: verdict.expectedSha,
        snapshot,
      });
    }
    sleep(Math.min(intervalMs, deadline - t));
  }
}

function emptyBookkeeping() {
  return { invoked: false, count: 0, results: null };
}

function confirmPushedPrHead(input) {
  const waited = waitForLivePrHead(input);
  if (!waited.ok) {
    return { ...waited, bookkeeping: emptyBookkeeping() };
  }
  let results = null;
  if (typeof input.bookkeeping === 'function') {
    results = input.bookkeeping(waited.snapshot, waited);
  } else if (input.bookkeeping) {
    results = runNamedBookkeeping(input.bookkeeping, waited.snapshot, waited);
  }
  return {
    ...waited,
    bookkeeping: { invoked: true, count: 1, results },
  };
}

function fetchPrViaGh(repository, prNumber) {
  const result = spawnSync('gh', ['api', `repos/${repository}/pulls/${prNumber}`], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim() || `exit ${result.status}`;
    throw new Error(detail);
  }
  return JSON.parse(result.stdout);
}

function readJsonArg(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main(argv) {
  const command = argv[2];
  if (command === 'classify') {
    const snapshot = readJsonArg(argv[3]);
    const expected = readJsonArg(argv[4]);
    const verdict = classifyLivePrHeadRead(snapshot, expected);
    writeJson(verdict);
    if (verdict.ok) return 0;
    return verdict.retryable ? 2 : 1;
  }
  if (command === 'confirm') {
    const request = readJsonArg(argv[3]);
    const identity = request && request.identity;
    const result = confirmPushedPrHead({
      ...request,
      fetchPr: () => fetchPrViaGh(identity.repository, identity.prNumber),
    });
    if (!result.ok) {
      process.stderr.write(`${result.reason}\n`);
      writeJson({
        ok: false,
        code: result.code,
        reason: result.reason,
        attempts: result.attempts,
        liveHead: result.liveHead || null,
        expectedSha: result.expectedSha || request.expectedSha,
      });
      return 1;
    }
    writeJson(result.snapshot);
    return 0;
  }
  process.stderr.write('usage: atlas-github-pr-head-sync.js classify|confirm\n');
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  BOOKKEEPING_ACTIONS,
  classifyLivePrHeadRead,
  waitForLivePrHead,
  confirmPushedPrHead,
  runNamedBookkeeping,
  fetchPrViaGh,
};
