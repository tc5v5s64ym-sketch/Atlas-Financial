'use strict';
// Plan #6 A12 combined-path proof, File 2 of 3 — TEST ONLY.
// Acceptance matrix row A12 (#765 comment 6480259704): the complete
// ACTIVE entry — a full financial+auth configuration through the real
// `node server.js` entry against a local disposable Postgres, serving
// a prepare → confirm journey over the entry's own HTTP surface.
// Scope packet #787 comment 6508539468 as corrected by Atlas's ruling
// 6508634090; dispatch 6508755098.
//
// DETERMINATION (at main ccb1316d58a977f47cfa6fe0b7a5d94a838d371f;
// re-verified mechanically by the probe test below at run time): the
// journey is NOT EXECUTED. Exactly one prerequisite is missing:
//
//  P2 — the acquisition basis. A prepare → confirm journey requires
//  ServerLiveRefresh.acquireSettlementWithWitness (the server.js
//  composition `acquire`), which refuses unless the overlay mode is
//  'live' AND a qualified process-local observation already exists
//  (scripts/server-live-refresh.js — an acquisition never starts a
//  provider job; a missing observation is 'live-refresh-unavailable').
//  No existing supported synthetic setup on main supplies that basis
//  to the env-only child entry: the shipped synthetic acquisition
//  setups are IN-PROCESS doubles — test/test-savings-journey-
//  acceptance.js replaces Refresh.serve and
//  Refresh.acquireSettlementWithWitness on the module object, and
//  test/test-settlement-evidence-refresh-acquisition.js preloads
//  refresh workers — and a module double cannot cross into a child
//  process that receives only an environment. The strongest precedent
//  confirms it: INT-2's local-Postgres journey (52592991) composed
//  startServer IN-PROCESS with those same module doubles; it never
//  drove the env-only entry. Inside the child, an observation could
//  only be qualified by a real provider refresh — real Lunch Money
//  credentials / provider access, which are out of scope. No new
//  production seam, no relaxed TLS/hostname/catalog checks, and no
//  real provider access may be introduced to change this (ruling
//  6508634090 points 1 and 3).
//
//  P1 — a local disposable PostgreSQL target — is PRESENT in this
//  environment and is NOT the blocker: PostgreSQL 18.6 from the
//  INT-1/INT-2 disposable-cluster tooling lives at
//  ~/workspace/int-exec/pg (bin/postgres, bin/initdb, bin/pg_ctl) and
//  `postgres --version` executes. It is not on PATH and not in a
//  standard install root, so a probe that only checks PATH misses it;
//  the probe below checks the INT tooling explicitly, plus PATH,
//  standard roots, and a disposable target named by the
//  A12_LOCAL_PG_URL test-only env knob. (An earlier draft of this
//  file recorded P1 as absent on PATH evidence alone; that was wrong
//  and is corrected here — P1's presence changes nothing about the
//  outcome, because P2 alone keeps the journey unexecutable, but the
//  record must be exact.)
//
// RECORDING, NOT SKIPPING SILENTLY: the probe test below EXECUTES on
// every run. It re-checks P1 mechanically (including a --version
// execution of any binary found) and asserts the P2 source tripwire:
// the shipped acquireSettlementWithWitness still refuses without a
// pre-existing qualified observation. If that source shape changes —
// e.g. an env-only synthetic observation path is ever added — the
// probe FAILS LOUDLY and the P2 determination must be re-reviewed
// before this file's NOT EXECUTED recording is trusted again. The
// three journey tests are recorded NOT EXECUTED via their skip
// reasons, which name the sole missing prerequisite. A skip here is
// NOT EXECUTED, never PASS: A12 stays PARTIAL on this file's
// evidence boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const NOT_EXECUTED_REASON =
  'NOT EXECUTED — missing prerequisite: (P2) no existing supported synthetic setup on main '
  + 'supplies the acquisition basis (overlay mode live + qualified process-local observation) '
  + 'to the env-only child entry; the shipped synthetic acquisition setups are in-process '
  + 'module doubles that cannot cross into the child. (P1, a local disposable PostgreSQL '
  + 'target, IS present in this environment — the INT tooling at ~/workspace/int-exec/pg — '
  + 'and is not the blocker.) See the header determination in this file.';

// P1, mechanically: server binaries on PATH, a conventional install
// root, the workspace INT-1/INT-2 tooling, or an operator-provisioned
// disposable target named by A12_LOCAL_PG_URL (loopback only).
function pgInstallPresent() {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const bin of ['postgres', 'initdb', 'pg_ctl', 'pg_isready']) {
    for (const dir of dirs) {
      const candidate = path.join(dir, bin);
      try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
    }
  }
  for (const dir of ['/usr/lib/postgresql', '/usr/local/pgsql', '/var/lib/postgresql']) {
    if (fs.existsSync(dir)) return dir;
  }
  const intBin = path.join(os.homedir(), 'workspace', 'int-exec', 'pg', 'bin');
  for (const bin of ['postgres', 'initdb', 'pg_ctl']) {
    const candidate = path.join(intBin, bin);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
  }
  return null;
}
function configuredTarget() {
  const raw = process.env.A12_LOCAL_PG_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return null;
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return null;
    return { host: url.hostname, port: Number(url.port || 5432) };
  } catch { return null; }
}
const tcpReachable = (host, port) => new Promise(resolve => {
  const sock = net.connect({ host, port });
  sock.setTimeout(1500);
  sock.once('connect', () => { sock.destroy(); resolve(true); });
  sock.once('timeout', () => { sock.destroy(); resolve(false); });
  sock.once('error', () => resolve(false));
});
async function p1Present() {
  const found = pgInstallPresent();
  if (found) {
    // Presence must be executable truth, not a stray path: if the
    // find is a binary, run its --version.
    if (path.basename(found).startsWith('postgres')) {
      const r = spawnSync(found, ['--version'], { encoding: 'utf8' });
      if (r.status === 0 && /PostgreSQL/.test(String(r.stdout))) {
        return 'PostgreSQL present and executing: ' + String(r.stdout).trim() + ' (' + found + ')';
      }
      return 'PostgreSQL install found (version probe inconclusive): ' + found;
    }
    return 'PostgreSQL install found: ' + found;
  }
  const target = configuredTarget();
  if (target && await tcpReachable(target.host, target.port)) {
    return 'disposable local target reachable via A12_LOCAL_PG_URL (' + target.host + ':' + target.port + ')';
  }
  return null;
}

test('A12 File 2 prerequisite probe (executes): the NOT EXECUTED determination matches this environment', async t => {
  const p1 = await p1Present();
  t.diagnostic('A12 File 2 determination: P1 (local disposable PostgreSQL) '
    + (p1 ? 'PRESENT — ' + p1 : 'absent (no binaries/install found, no configured disposable target)'));
  t.diagnostic('A12 File 2 determination: P2 (acquisition basis for the env-only entry) absent on main '
    + 'ccb1316d — synthetic acquisition setups are in-process module doubles only; see header.');
  // P2 source tripwire: the shipped acquisition still refuses without
  // a pre-existing qualified observation. If this shape changes, the
  // P2 determination is stale and must be re-reviewed — fail loudly.
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'server-live-refresh.js'), 'utf8');
  const acquire = source.slice(source.indexOf('function acquireSettlementWithWitness'));
  assert.ok(acquire.includes("overlayModeFromEnv(env) !== 'live'"),
    'P2 TRIPWIRE: acquireSettlementWithWitness no longer gates on overlay mode live — re-review the P2 determination in this file before trusting its NOT EXECUTED recording');
  assert.ok(acquire.includes('observations.read(context)') && acquire.includes("if (!evidence) return Promise.reject"),
    'P2 TRIPWIRE: acquireSettlementWithWitness no longer requires a pre-existing qualified observation — re-review the P2 determination in this file before trusting its NOT EXECUTED recording');
  assert.ok(acquire.length > 0, 'acquireSettlementWithWitness still exists in server-live-refresh.js');
});

// The journey bodies are intentionally NOT implemented while P2 is
// absent. Their flow, when a dispatched slice settles P2 (packet
// 6508539468, File 2):
//   - Full financial+auth SETTLEMENT_* config, NO custody profile (the
//     memory custody binding — the only active configuration the entry
//     can compose), ATLAS_LIVE_OVERLAY=live with the acquisition basis
//     settled; launch `node server.js` env-only against the local
//     disposable target (P1: the INT tooling cluster or equivalent).
//   - Journey: entry listens → login → /settlement/capability reads
//     active → prepare → confirm over the entry's own HTTP surface
//     returns committed → /data.json settlement status qualified → a
//     later outcome read returns the committed result.
//   - Fresh-connection observation: the target's session view shows
//     the composition's sessions established at startup/qualification,
//     before the first settlement operation, and no additional
//     sessions created during the journey (counted by profile).
//   - Shutdown: SIGTERM → process exits; stderr carries no
//     custody-closure FATAL (memory custody retires not-started).
// If P2 is ever settled, these bodies must be implemented by that
// slice; until then they stay behind the NOT EXECUTED recording, and
// the probe above guards the determination's freshness.
const journeyBody = label => () => {
  assert.fail('PREREQUISITE P2 SETTLED? — the A12 active-entry journey (' + label + ') must be '
    + 'implemented and executed by a dispatched slice before this test can pass. The NOT '
    + 'EXECUTED recording in this file exists only while the acquisition basis is unavailable '
    + 'to the env-only entry; it must never survive that basis arriving.');
};

test('A12 active entry (local PG): full financial+auth config serves prepare → confirm committed',
  { skip: NOT_EXECUTED_REASON }, journeyBody('prepare → confirm journey'));
test('A12 active entry (local PG): fresh connections are taken at startup/qualification only, none during the journey',
  { skip: NOT_EXECUTED_REASON }, journeyBody('fresh-connection observation'));
test('A12 active entry (local PG): SIGTERM shutdown is clean, no custody-closure FATAL for memory custody',
  { skip: NOT_EXECUTED_REASON }, journeyBody('clean shutdown'));
