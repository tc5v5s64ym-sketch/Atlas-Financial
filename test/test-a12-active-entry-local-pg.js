'use strict';
// Plan #6 A12 combined-path proof, File 2 of 3 — TEST ONLY.
// Acceptance matrix row A12 (#765 comment 6480259704): the complete
// ACTIVE entry — a full financial+auth configuration through the real
// `node server.js` entry against a local disposable Postgres, serving
// a prepare → confirm journey over the entry's own HTTP surface.
// Scope packet #787 comment 6508539468 as corrected by Atlas's ruling
// 6508634090; dispatch 6508755098.
//
// DETERMINATION (assessed at main
// ccb1316d58a977f47cfa6fe0b7a5d94a838d371f on 2026-10-29; the probe
// test below re-checks only the P2 consumer gate's source shape and
// this run's P1 observation — it does NOT re-derive this
// determination; see RECORDING below): the journey is NOT EXECUTED.
// Exactly one prerequisite is missing:
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
//  P1 — a local disposable PostgreSQL target — is not the blocker.
//  DATED RECEIPT (2026-10-29, the builder's environment): PostgreSQL
//  18.6 from the INT-1/INT-2 disposable-cluster tooling at
//  ~/workspace/int-exec/pg (bin/postgres, bin/initdb, bin/pg_ctl),
//  with `postgres --version` executing. That receipt is historical
//  evidence about that date's environment, not a standing claim:
//  the probe below reports only what the CURRENT run observes, and
//  neither the receipt nor a run's observation establishes a
//  QUALIFIED disposable target — install presence or an
//  inconclusive version probe does not prove a target the journey
//  may use. P1's state changes nothing about the outcome either
//  way, because P2 alone keeps the journey unexecutable. (An
//  earlier draft of this file recorded P1 as absent on PATH
//  evidence alone; that was wrong. Recording it as flatly present
//  was also wrong — Systems Review finding 2 on head 942ee2a6.
//  Both are corrected here: dated receipt above, per-run
//  observation below.)
//
// RECORDING, NOT SKIPPING SILENTLY: the probe test below EXECUTES
// on every run. Its freshness guarantee is NARROW and is claimed
// as nothing more (Systems Review finding 1 on head 942ee2a6): it
// asserts the P2 CONSUMER gate's source shape — the shipped
// acquireSettlementWithWitness still requires overlay mode 'live'
// and still refuses without a pre-existing qualified observation
// (observations.read plus the reject-on-missing branch). If THAT
// source shape changes, the probe FAILS LOUDLY. The tripwire does
// NOT detect producer-side change: a new supported producer could
// one day supply a qualifying observation through those unchanged
// gates, and this probe would stay green while the journeys remain
// skipped. The P2 determination is therefore a DATED, MANUAL
// prerequisite assessment (2026-10-29, at ccb1316d), not a standing
// mechanically-verified fact: it must be re-reviewed before this
// file's NOT EXECUTED recording is relied on after any change to
// the observation producers, the synthetic acquisition setups, or
// the entry's configuration surface — and whenever the A12
// evidence boundary is next assessed. The probe also reports what
// the current run observes for P1 (install evidence and, for a
// `postgres` binary, a --version execution); that observation does
// not establish a qualified disposable target. The three journey
// tests are recorded NOT EXECUTED via skip reasons generated from
// this run's own P1 observation; they name P2 alone as the missing
// prerequisite. A skip here is NOT EXECUTED, never PASS: A12 stays
// PARTIAL on this file's evidence boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// P1 observation, synchronous so the journey skip reasons below
// are GENERATED from the same observation the probe reports — the
// skip text a runner prints is this run's own observation, never a
// presence constant baked in at authoring time (Systems Review
// finding 2 on head 942ee2a6). The observation is install evidence
// only: a located directory or an inconclusive version probe does
// NOT establish a qualified disposable PostgreSQL target. Bare TCP
// reachability is not observed at all — reachability of some port
// proves nothing about a disposable target's identity or fitness —
// so the earlier A12_LOCAL_PG_URL reachability check is removed:
// the knob confers no presence claim.
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
function p1Observed() {
  const found = pgInstallPresent();
  if (!found) return null;
  // A located binary must be executable truth, not a stray path:
  // run its --version. Anything short of a clean version execution
  // is reported as what it is — install evidence only.
  if (path.basename(found).startsWith('postgres')) {
    const r = spawnSync(found, ['--version'], { encoding: 'utf8' });
    if (r.status === 0 && /PostgreSQL/.test(String(r.stdout))) {
      return 'executing PostgreSQL observed: ' + String(r.stdout).trim() + ' (' + found + ')';
    }
    return 'install evidence only (binary located; --version probe inconclusive): ' + found;
  }
  return 'install evidence only (directory present; no binary executed): ' + found;
}
const P1_OBSERVED = p1Observed();

const NOT_EXECUTED_REASON =
  'NOT EXECUTED — missing prerequisite: (P2) no existing supported synthetic setup on main '
  + 'supplies the acquisition basis (overlay mode live + qualified process-local observation) '
  + 'to the env-only child entry; the shipped synthetic acquisition setups are in-process '
  + 'module doubles that cannot cross into the child. (P1 observation, this run: '
  + (P1_OBSERVED || 'no PostgreSQL install evidence found')
  + ' — install evidence only, not a qualified disposable target; P1 is not the blocker '
  + 'either way. P2 determination dated 2026-10-29 at ccb1316d — see the header of this file.)';

test('A12 File 2 prerequisite probe (executes): P2 consumer-gate source shape unchanged; this run\'s P1 observation reported', t => {
  t.diagnostic('A12 File 2 determination: P1 (local disposable PostgreSQL) — this run observed: '
    + (P1_OBSERVED || 'no install evidence (no binaries or install found)')
    + '. Observation only: no qualified disposable target is established by it, and P1 is not '
    + 'the blocker either way.');
  t.diagnostic('A12 File 2 determination: P2 (acquisition basis for the env-only entry) absent on main '
    + 'ccb1316d — dated manual assessment, 2026-10-29: synthetic acquisition setups are in-process '
    + 'module doubles only; see header. This probe does not re-derive it.');
  // P2 consumer-gate tripwire (narrow — see RECORDING): the shipped
  // acquisition still gates on overlay mode 'live' and still refuses
  // without a pre-existing qualified observation. If that CONSUMER
  // source shape changes, fail loudly. Producer-side change is NOT
  // detected here: the P2 determination is a dated manual assessment
  // requiring re-review, not a fact this probe re-derives.
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
// slice; until then they stay behind the NOT EXECUTED recording.
// The probe above guards only the consumer gate's source shape;
// the determination itself is a dated assessment (see RECORDING).
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
