'use strict';
// Plan #6 A12 combined-path proof, File 2 of 3 — TEST ONLY.
// Acceptance matrix row A12 (#765 comment 6480259704): the complete
// ACTIVE entry — a full financial+auth configuration through the real
// `node server.js` entry against a local disposable Postgres, serving
// a prepare → confirm journey over the entry's own HTTP surface.
// Scope packet #787 comment 6508539468 as corrected by Atlas's ruling
// 6508634090; dispatch 6508755098.
//
// DETERMINATION (made at main ccb1316d58a977f47cfa6fe0b7a5d94a838d371f
// and re-verified by the probe test below at run time): the journey is
// NOT EXECUTED in this environment. Two named prerequisites are
// missing, and neither may be weakened around (ruling point 3):
//
//  P1 — a local disposable PostgreSQL target. The entry composes its
//  financial and authorization profiles from the REAL pg driver
//  (settlement-production-host.js binds require('pg').Client; the
//  entry passes no seams, server.js require.main block), so an active
//  entry cannot even qualify its sessions without a server to connect
//  to. This environment has no PostgreSQL server at all: no postgres /
//  initdb / pg_ctl / pg_isready binaries on PATH, no /usr/lib/postgresql
//  or /var/lib/postgresql, no service, no embedded-postgres package.
//  The probe re-checks this mechanically on every run (binaries, or a
//  disposable target named by the A12_LOCAL_PG_URL test-only env knob).
//
//  P2 — the acquisition basis. A prepare → confirm journey additionally
//  requires ServerLiveRefresh.acquireSettlementWithWitness
//  (server.js composition `acquire`), which refuses unless the overlay
//  mode is 'live' AND a qualified process-local observation already
//  exists (scripts/server-live-refresh.js: acquireSettlementWithWitness
//  — an acquisition never starts a provider job; a missing observation
//  is 'live-refresh-unavailable'). No existing supported synthetic
//  setup on main supplies that basis to the env-only child entry: the
//  shipped synthetic acquisition setups are IN-PROCESS doubles —
//  test/test-savings-journey-acceptance.js replaces Refresh.serve and
//  Refresh.acquireSettlementWithWitness on the module object, and
//  test/test-settlement-evidence-refresh-acquisition.js preloads
//  refresh workers — and a module double cannot cross into a child
//  process that receives only an environment. Inside the child, an
//  observation could only be qualified by a real provider refresh:
//  real Lunch Money credentials / provider access, which are out of
//  scope. No new production seam, no relaxed TLS/hostname/catalog
//  checks, and no real provider access may be introduced to change
//  this (ruling 6508634090 points 1 and 3).
//
// RECORDING, NOT SKIPPING SILENTLY: the probe test below EXECUTES on
// every run and asserts this determination against the live
// environment. The three journey tests are recorded NOT EXECUTED via
// their skip reasons, which name both prerequisites. If a local
// disposable PostgreSQL target ever appears (P1 satisfied), the probe
// FAILS LOUDLY and the journey tests stop skipping — their bodies then
// fail with an explicit demand that the journey be implemented and
// executed by a dispatched slice, so this file can never quietly pass
// over an executable journey. A skip here is NOT EXECUTED, never PASS:
// A12 stays PARTIAL on this file's evidence boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const NOT_EXECUTED_REASON =
  'NOT EXECUTED — missing prerequisites: (P1) no local disposable PostgreSQL target in this '
  + 'environment (no postgres/initdb/pg_isready binaries, no disposable target configured); '
  + '(P2) no existing supported synthetic setup on main supplies the acquisition basis '
  + '(overlay mode live + qualified process-local observation) to the env-only child entry. '
  + 'See the header determination in this file.';

// P1, mechanically: server binaries on PATH, a conventional install
// root, or an operator-provisioned disposable target named by
// A12_LOCAL_PG_URL (a postgres:// URL whose host is loopback).
function pgBinariesPresent() {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const bin of ['postgres', 'initdb', 'pg_ctl', 'pg_isready']) {
    for (const dir of dirs) {
      try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return bin; } catch { /* keep looking */ }
    }
  }
  for (const dir of ['/usr/lib/postgresql', '/usr/local/pgsql', '/var/lib/postgresql']) {
    if (fs.existsSync(dir)) return dir;
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
  const bin = pgBinariesPresent();
  if (bin) return 'PostgreSQL server binary/install found: ' + bin;
  const target = configuredTarget();
  if (target && await tcpReachable(target.host, target.port)) {
    return 'disposable local target reachable via A12_LOCAL_PG_URL (' + target.host + ':' + target.port + ')';
  }
  return null;
}
// Synchronous tripwire evaluated at load: if server binaries/install
// roots exist OR a disposable target is even configured, the journey
// tests below do NOT skip — their bodies fail loudly (and the probe
// fails too). While neither holds, they record NOT EXECUTED.
const P1_AT_LOAD = pgBinariesPresent()
  || (process.env.A12_LOCAL_PG_URL ? 'A12_LOCAL_PG_URL is configured' : null);
const JOURNEY_SKIP = P1_AT_LOAD ? false : NOT_EXECUTED_REASON;

test('A12 File 2 prerequisite probe (executes): the NOT EXECUTED determination matches this environment', async t => {
  const p1 = await p1Present();
  t.diagnostic('A12 File 2 determination: P1 (local disposable PostgreSQL) '
    + (p1 ? 'PRESENT — ' + p1 : 'absent (no server binaries/install, no configured disposable target)'));
  t.diagnostic('A12 File 2 determination: P2 (acquisition basis for the env-only entry) absent on main '
    + 'ccb1316d — synthetic acquisition setups are in-process module doubles only; see header.');
  assert.equal(p1, null,
    'LOUD FAILURE, BY DESIGN: a local disposable PostgreSQL target now exists (' + p1 + '), so the '
    + 'active-entry journey in this file is executable in principle and its NOT EXECUTED record is '
    + 'stale. Do not let this suite go green around it: a dispatched slice must implement and execute '
    + 'the journey below (and settle prerequisite P2) and replace the NOT EXECUTED recording.');
});

// The journey bodies are intentionally NOT implemented against absent
// prerequisites. When the probe above fires (P1 present), these tests
// stop skipping and fail with the demand below — loudly, never as a
// silent pass. The flow each body must implement when dispatched
// (packet 6508539468, File 2):
//   - Full financial+auth SETTLEMENT_* config, NO custody profile (the
//     memory custody binding — the only active configuration the entry
//     can compose), ATLAS_LIVE_OVERLAY=live with the acquisition basis
//     settled; launch `node server.js` env-only against the local
//     disposable target.
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
const journeyBody = label => () => {
  assert.fail('PREREQUISITES PRESENT — the A12 active-entry journey (' + label + ') must be '
    + 'implemented and executed by a dispatched slice before this test can pass. The NOT '
    + 'EXECUTED recording in this file exists only while its named prerequisites are absent; '
    + 'it must never survive their arrival.');
};

test('A12 active entry (local PG): full financial+auth config serves prepare → confirm committed',
  { skip: JOURNEY_SKIP }, journeyBody('prepare → confirm journey'));
test('A12 active entry (local PG): fresh connections are taken at startup/qualification only, none during the journey',
  { skip: JOURNEY_SKIP }, journeyBody('fresh-connection observation'));
test('A12 active entry (local PG): SIGTERM shutdown is clean, no custody-closure FATAL for memory custody',
  { skip: JOURNEY_SKIP }, journeyBody('clean shutdown'));
