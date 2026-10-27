'use strict';
// Rollback-qualification harness (Plan #3 Lane 3, issue #718; requirements
// RQ-1..RQ-8 from INT-4, issue #716). OFFLINE, SYNTHETIC, DISCONNECTED.
//
// What it does: runs each RQ as a runnable check against the SHIPPED code at
// the checked-out head (authorization store, server recovery final authority,
// restore install/verify, terminal-certificate qualifySnapshot). Rollback is
// performed by an ADVERSARY path (direct replacement of the durable state file
// with an older copy, or the shipped restore path fed a genuine-but-stale
// anchor set), never by asking the code to roll itself back. Every decision
// that matters is taken in a FRESH child Node process, so in-memory state
// (e.g. the terminal-certificate WeakMap floor) cannot carry across.
//
// DOUBLES (labelled): durable state lives in JSON files in a temp directory,
// behind in-process SQL-interpreting session doubles that handle only the
// fixed statements of the shipped modules. They are NOT PostgreSQL: nothing
// here qualifies real SQL semantics, durability, isolation, provider backup or
// restore. Ledger/history bytes come from the shared synthetic exclusion world
// (test/test-settlement-evidence-terminal-certificate.js, registers no tests).
//
// Result model (two explicit fields, never merged):
//   harness.status        'ok'    every check ran and produced a verdict
//                         'error' a check or child failed unexpectedly; the
//                                 affected RQ is ERROR, never PASS
//   qualification.status  'QUALIFIED' only if RQ-1..RQ-8 all PASS (unreachable
//                         offline: RQ-7/RQ-8 cannot execute here)
//                         'NOT QUALIFIED' otherwise
// Exit codes: 0 harness ok AND qualified (reserved; not reachable offline)
//             1 harness ok, NOT QUALIFIED (expected on current main)
//             2 harness error (never green)
//            64 usage error
// A reproduced vulnerability (FAIL) is harness-mechanics success, not a
// qualification pass. This harness designs no anchor/epoch and no fencing.
//
// Usage: node scripts/rollback-qualification-harness.js [--json]
//   --decider <module>   test-only: replace the shipped final authority with a
//                        module exporting createDecider({ store, now })
//   --inject-fault <RQ>  test-only mechanics self-check: make that RQ's check
//                        throw, to prove errors surface as ERROR / exit 2

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = __filename;
const AUTH_SCHEMA = 'atlas_rq_auth';
const AUTH_SCOPE = 'rq-synthetic';
const MAINT_SCHEMA = 'atlas_rq_settle';
const MAINT_SCOPE = 'rq-synthetic';
const NOW = 1_760_000_000_000;
const RQS = ['RQ-1', 'RQ-2', 'RQ-3', 'RQ-4', 'RQ-5', 'RQ-6', 'RQ-7', 'RQ-8'];
const D = s => crypto.createHash('sha256').update('rq-synthetic:' + s).digest('hex');
const HOUSEHOLD = 'household-' + 'a'.repeat(32);
const KEY = Object.freeze({
  householdId: HOUSEHOLD,
  operationId: 'operation-' + '1'.padStart(32, '0'),
  generation: 'generation-' + '1'.padStart(32, '0'),
  confirmationDigest: D('confirmation'), secretDigest: D('secret'), sidDigest: D('sid'),
});

class HarnessError extends Error {}
const must = (cond, what) => { if (!cond) throw new HarnessError('harness: ' + what); };

// ---------------------------------------------------------------- doubles
// Authorization-store session double over a JSON file. COMMIT persists the
// whole table set synchronously; nothing else writes the file.
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, JSON.stringify(value)); }
function authSession(file) {
  const listeners = { error: [], end: [] };
  let staged = null; let alive = true;
  const load = () => (fs.existsSync(file) ? readJson(file)
    : { auth_eligibility: {}, auth_revocation: {}, auth_session_revocation: {} });
  const view = name => ({ ...load()[name], ...(staged ? staged[name] : {}) });
  const ok = (command, rows = [], rowCount = rows.length) => ({ command, rows, rowCount });
  const k3 = (a, b, c) => [a, b, c].join('\u0000');
  const k2 = (a, b) => [a, b].join('\u0000');
  function dispatch(text, v) {
    if (text === 'BEGIN') { must(!staged, 'nested BEGIN'); staged = { auth_eligibility: {}, auth_revocation: {}, auth_session_revocation: {} }; return ok('BEGIN'); }
    if (text === 'COMMIT') {
      must(staged, 'COMMIT outside txn');
      const t = load(); for (const n of Object.keys(staged)) Object.assign(t[n], staged[n]);
      writeJson(file, t); staged = null; return ok('COMMIT');
    }
    if (text === 'ROLLBACK') { staged = null; return ok('ROLLBACK'); }
    if (text.startsWith('INSERT INTO')) {
      const rel = /auth_(eligibility|revocation|session_revocation)/.exec(text)[1];
      const name = 'auth_' + rel; let k; let row;
      if (rel === 'eligibility') {
        const [scope, hh, o, g, cd, sd, at] = v; k = k3(scope, o, g);
        row = { scope, household_id: hh, operation_id: o, generation: g, confirmation_digest: cd, secret_digest: sd, issued_at: at };
      } else if (rel === 'revocation') {
        const [scope, o, g, at] = v; k = k3(scope, o, g); row = { scope, operation_id: o, generation: g, revoked_at: at };
      } else {
        const [scope, sd, at] = v; k = k2(scope, sd); row = { scope, sid_digest: sd, revoked_at: at };
      }
      if (Object.hasOwn(view(name), k)) throw new Error('duplicate key');
      must(staged, 'INSERT outside txn'); staged[name][k] = row; return ok('INSERT', [], 1);
    }
    if (text.includes('LEFT JOIN')) {
      const [scope, o, g, sid] = v;
      const e = view('auth_eligibility')[k3(scope, o, g)];
      const r = view('auth_revocation')[k3(scope, o, g)];
      const s = view('auth_session_revocation')[k2(scope, sid)];
      return ok('SELECT', [{
        household_id: e ? e.household_id : null, operation_id: e ? e.operation_id : null,
        generation: e ? e.generation : null, confirmation_digest: e ? e.confirmation_digest : null,
        secret_digest: e ? e.secret_digest : null, issued_at: e ? e.issued_at : null,
        operation_revoked: !!r, session_revoked: !!s,
      }]);
    }
    if (text.startsWith('SELECT')) {
      const rel = /auth_(eligibility|revocation|session_revocation)/.exec(text)[1];
      const name = 'auth_' + rel;
      const row = rel === 'session_revocation' ? view(name)[k2(v[0], v[1])] : view(name)[k3(v[0], v[1], v[2])];
      return ok('SELECT', row ? [{ ...row }] : []);
    }
    throw new HarnessError('auth double: unexpected statement');
  }
  return {
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    retire() { alive = false; staged = null; },
    async query(text, values) { if (!alive) throw new Error('session ended'); return dispatch(text, values); },
  };
}

// Maintenance session double for the restore install/verify statements over a
// JSON file (bytes as base64). BEGIN snapshots; COMMIT persists; ROLLBACK or
// retire() before COMMIT discards.
function maintSession(file, pid) {
  const listeners = { error: [], end: [] };
  const empty = () => ({ head: {}, staged: {}, journal: {}, terminal: {}, quarantine: {} });
  let work = null; let ended = false; let locked = false;
  const load = () => (fs.existsSync(file) ? readJson(file) : empty());
  const db = () => work || load();
  const b64 = b => Buffer.from(b).toString('base64');
  const buf = s => Buffer.from(s, 'base64');
  const res = (command, rows = [], rowCount = rows.length) => ({ command, rows, rowCount });
  const q = '"' + MAINT_SCHEMA + '"\\.';
  const TBL = { doc_head: 'head', doc_staged: 'staged', journal: 'journal' };
  function exec(text, v) {
    let m;
    if (/pg_try_advisory_lock/.test(text)) { locked = true; return res('SELECT', [{ locked: true }]); }
    if (/pg_backend_pid/.test(text)) return res('SELECT', [{ pid }]);
    if (/^BEGIN/.test(text)) { work = load(); return res('BEGIN', [], null); }
    if (text === 'COMMIT') { must(work, 'COMMIT outside txn'); writeJson(file, work); work = null; return res('COMMIT', [], null); }
    if (text === 'ROLLBACK') { work = null; return res('ROLLBACK', [], null); }
    if ((m = new RegExp('^SELECT bytes FROM ' + q + '(doc_head|doc_staged|journal) WHERE scope = \\$1 LIMIT 2$').exec(text))) {
      const x = db()[TBL[m[1]]][v[0]]; return res('SELECT', x ? [{ bytes: buf(x) }] : []);
    }
    if (new RegExp('^SELECT history_bytes, checkpoint_bytes FROM ' + q + 'terminal_history WHERE scope = \\$1 LIMIT 2$').test(text)) {
      const t = db().terminal[v[0]]; return res('SELECT', t ? [{ history_bytes: buf(t.h), checkpoint_bytes: buf(t.c) }] : []);
    }
    if (new RegExp('^SELECT 1 AS present FROM ' + q + 'quarantine WHERE scope = \\$1 AND name = \\$2$').test(text))
      return res('SELECT', Object.hasOwn(db().quarantine, v[0] + '|' + v[1]) ? [{ present: 1 }] : []);
    must(work, 'write outside txn');
    if (new RegExp('^INSERT INTO ' + q + 'quarantine \\(scope, name, label, bytes\\) VALUES').test(text)) {
      work.quarantine[v[0] + '|' + v[1]] = { label: v[2], bytes: b64(v[3]) }; return res('INSERT', [], 1);
    }
    if (new RegExp('^INSERT INTO ' + q + 'doc_head \\(scope, bytes\\) VALUES \\(\\$1, \\$2\\) ON CONFLICT').test(text)) {
      work.head[v[0]] = b64(v[1]); return res('INSERT', [], 1);
    }
    if (new RegExp('^UPDATE ' + q + 'terminal_history SET').test(text)) {
      if (!work.terminal[v[0]]) return res('UPDATE', [], 0);
      work.terminal[v[0]] = { h: b64(v[1]), c: b64(v[2]) }; return res('UPDATE', [], 1);
    }
    if (new RegExp('^INSERT INTO ' + q + 'terminal_history ').test(text)) {
      work.terminal[v[0]] = { h: b64(v[1]), c: b64(v[2]) }; return res('INSERT', [], 1);
    }
    if ((m = new RegExp('^DELETE FROM ' + q + '(doc_staged|journal) WHERE scope = \\$1$').exec(text))) {
      const t = work[TBL[m[1]]]; const had = Object.hasOwn(t, v[0]); delete t[v[0]]; return res('DELETE', [], had ? 1 : 0);
    }
    throw new HarnessError('maintenance double: unexpected statement');
  }
  return {
    get locked() { return locked; },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    retire() { ended = true; work = null; return Promise.resolve(); },
    async query(text, values) { if (ended) throw new Error('session ended'); return exec(text, values); },
  };
}

// ---------------------------------------------------------- child steps
// Each step runs in its own fresh Node process and prints one JSON line.
function decider(store, deciderModule) {
  const now = () => NOW;
  if (deciderModule) return require(path.resolve(deciderModule)).createDecider({ store, now });
  const { createRecoveryFinalAuthority } = require(path.join(ROOT, 'server.js'));
  return createRecoveryFinalAuthority({ authorizationStore: store, now });
}
const retained = () => ({ householdId: KEY.householdId, operationId: KEY.operationId, generation: KEY.generation,
  secretDigest: KEY.secretDigest, sidDigest: KEY.sidDigest, expiresAt: NOW + 60_000, actorId: 'rq-synthetic-actor' });
const committedView = () => ({ status: 'committed', requestDigest: KEY.confirmationDigest });
const authStore = file => require(path.join(ROOT, 'scripts/settlement-evidence-authorization-store.js'))
  .createAuthorizationStore({ session: authSession(file), schema: AUTH_SCHEMA, scope: AUTH_SCOPE });

const STEPS = {
  async 'auth-issue'({ dir }) {
    const r = await authStore(path.join(dir, 'auth.json')).issueEligibility({
      householdId: KEY.householdId, operationId: KEY.operationId, generation: KEY.generation,
      confirmationDigest: KEY.confirmationDigest, secretDigest: KEY.secretDigest, issuedAt: NOW - 1000 });
    must(r.outcome === 'issued', 'eligibility not issued');
    return { issued: r.outcome };
  },
  async 'auth-revoke'({ dir, kind }) {
    const s = authStore(path.join(dir, 'auth.json'));
    const r = kind === 'session'
      ? await s.appendSessionRevocation({ sidDigest: KEY.sidDigest, revokedAt: NOW - 500 })
      : await s.appendRevocation({ operationId: KEY.operationId, generation: KEY.generation, revokedAt: NOW - 500 });
    must(r.outcome === 'appended', 'revocation not appended');
    return { appended: r.outcome, kind };
  },
  async 'auth-decide'({ dir, deciderModule }) {
    const file = path.join(dir, 'auth.json');
    // Diagnostic read on a SEPARATE store/session: a double or protocol fault
    // ('unknown') is a harness error, never mistaken for a refusal.
    const probe = await authStore(file).readAuthorizationState({ operationId: KEY.operationId, generation: KEY.generation, sidDigest: KEY.sidDigest });
    must(probe.state === 'ok', 'diagnostic read not ok');
    const decide = decider(authStore(file), deciderModule);
    const authorized = await decide(retained(), committedView());
    must(typeof authorized === 'boolean', 'decision not boolean');
    return { decision: authorized ? 'authorize' : 'refuse',
      state: { eligibility: probe.eligibility !== null, operationRevoked: probe.operationRevoked, sessionRevoked: probe.sessionRevoked } };
  },
  async 'maint-install'({ dir, which }) {
    const M = require(path.join(ROOT, 'scripts/settlement-evidence-restore-install.js'));
    const fx = readJson(path.join(dir, 'fixture.json'));
    const pair = fx[which]; const file = path.join(dir, 'maint.json');
    const base = s => ({ session: s, schema: MAINT_SCHEMA, scope: MAINT_SCOPE, domain: fx.domain, anchors: pair.anchors,
      candidate: { ledgerBytes: Buffer.from(pair.ledger, 'base64'), historyBytes: Buffer.from(pair.history, 'base64') } });
    const install = await M.installRestoreCandidate(base(maintSession(file, 101)));
    let verify = null;
    if (install.status === 'installed-unverified') {
      verify = await M.verifyRestoreInstall({ ...base(maintSession(file, 102)), pin: install.ledger.pin });
    }
    return { install: { status: install.status, reason: install.reason || null,
      ledgerRevision: install.ledger ? install.ledger.revision : null, historyRevision: install.history ? install.history.revision : null },
      verify: verify && { status: verify.status, reason: verify.reason || null } };
  },
  async 'tc-qualify'({ dir, sequence }) {
    // Qualify the durable terminal snapshot(s) with the shipped qualifySnapshot
    // in THIS process. sequence: list of 'durable' | 'latest' | 'stale'.
    const TC = require(path.join(ROOT, 'scripts/settlement-evidence-terminal-certificate.js'));
    const fx = readJson(path.join(dir, 'fixture.json'));
    const domain = { householdId: fx.domain.householdId, ledgerNamespace: fx.domain.ledgerNamespace };
    const out = [];
    for (const which of sequence) {
      let raw;
      if (which === 'durable') {
        const t = readJson(path.join(dir, 'maint.json')).terminal[MAINT_SCOPE];
        must(t, 'no durable terminal history');
        raw = { historyBytes: Buffer.from(t.h, 'base64'), checkpoint: JSON.parse(Buffer.from(t.c, 'base64')) };
      } else {
        raw = { historyBytes: Buffer.from(fx[which].history, 'base64'), checkpoint: fx[which].anchors.history };
      }
      try { const q = TC.qualifySnapshot(raw, domain); out.push({ which, result: 'qualified', revision: q.checkpoint.revision }); }
      catch (e) {
        must(/^terminal /.test(e.message), 'unexpected qualifySnapshot error');
        out.push({ which, result: 'refused', reason: e.message });
      }
    }
    return { qualifications: out };
  },
};

async function childMain(argv) {
  const opts = JSON.parse(argv[argv.indexOf('--child') + 1]);
  const result = await STEPS[opts.step](opts);
  process.stdout.write(JSON.stringify({ pid: process.pid, ...result }) + '\n');
}

// ---------------------------------------------------------------- parent
function runChild(opts) {
  const r = spawnSync(process.execPath, [SCRIPT, '--child', JSON.stringify(opts)], { encoding: 'utf8', cwd: ROOT, timeout: 60_000 });
  if (r.status !== 0) throw new HarnessError('child step ' + opts.step + ' exited ' + r.status);
  const line = r.stdout.trim().split('\n').pop();
  const out = JSON.parse(line);
  must(Number.isInteger(out.pid) && out.pid !== process.pid, 'child did not run in a fresh process');
  return out;
}
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const copy = (from, to) => fs.copyFileSync(from, to);

async function buildFixture(dir) {
  const X = require(path.join(ROOT, 'test/test-settlement-evidence-terminal-certificate.js'));
  const w = X.makeExclusionWorld(); const s = w.newStore();
  const ledger = [Buffer.from(w.doc)]; const history = [Buffer.from(w.historyBytes)];
  for (const n of [1, 2]) {
    const p = await w.prepare(s, n);
    must((await s.commit(w.input(p))).status === 'committed', 'fixture commit');
    ledger.push(Buffer.from(w.doc));
  }
  const p3 = await w.prepare(s, 3);
  must((await w.seal(s, p3, 3)).status === 'certified', 'fixture seal');
  history.push(Buffer.from(w.historyBytes));
  const la = b => { const v = JSON.parse(b); return { revision: v.revision, documentDigest: v.digest }; };
  const ha = b => { const v = JSON.parse(b); return { schema: 'terminal-history-checkpoint-1', householdId: v.householdId, ledgerNamespace: v.ledgerNamespace, revision: v.revision, digest: v.digest }; };
  const pair = (l, h) => ({ ledger: l.toString('base64'), history: h.toString('base64'), anchors: { ledger: la(l), history: ha(h) } });
  // latest = ledger rev 2 + history rev 1 (ops 1-2 committed, op 3 sealed);
  // stale  = ledger rev 1 + history rev 0, a genuine older qualified state.
  writeJson(path.join(dir, 'fixture.json'), { domain: { householdId: X.householdId, ledgerNamespace: w.domain.ledgerNamespace },
    latest: pair(ledger[2], history[1]), stale: pair(ledger[1], history[0]) });
}

const verdict = (v, evidence) => ({ verdict: v, evidence });

// RQ-1 / RQ-5: auth-store restore to the pre-revocation checkpoint + restart.
async function authRollback(dir, kind, ctx) {
  const d = fs.mkdtempSync(path.join(dir, 'auth-' + kind + '-'));
  runChild({ step: 'auth-issue', dir: d });
  const baseline = runChild({ step: 'auth-decide', dir: d, deciderModule: ctx.deciderModule });
  copy(path.join(d, 'auth.json'), path.join(d, 'checkpoint.json')); // adversary checkpoint (pre-revocation)
  runChild({ step: 'auth-revoke', dir: d, kind });
  const revoked = runChild({ step: 'auth-decide', dir: d, deciderModule: ctx.deciderModule });
  copy(path.join(d, 'auth.json'), path.join(d, 'latest.json')); // exact-latest pre-attack state
  copy(path.join(d, 'checkpoint.json'), path.join(d, 'auth.json')); // ADVERSARY: direct state replacement
  must(sha(path.join(d, 'auth.json')) === sha(path.join(d, 'checkpoint.json')), 'restore did not land');
  const after = runChild({ step: 'auth-decide', dir: d, deciderModule: ctx.deciderModule });
  const exactLatest = sha(path.join(d, 'auth.json')) === sha(path.join(d, 'latest.json'));
  const pids = new Set([baseline.pid, revoked.pid, after.pid]);
  must(pids.size === 3, 'decisions did not run in distinct processes');
  return { kind, baselineDecision: baseline.decision, preAttackDecision: revoked.decision,
    preAttackState: revoked.state, postRestoreState: after.state, postRestoreDecision: after.decision,
    restartBetweenRollbackAndDecision: true, durableStateExactLatestAfterAttack: exactLatest };
}

function judgeAuth(e, rq) {
  // The pre-attack control must refuse, else the scenario is not the RQ's.
  must(e.preAttackDecision === 'refuse', rq + ' pre-attack decision did not refuse');
  if (e.postRestoreDecision === 'authorize') return verdict('FAIL', { ...e, finding: 'revoked permission resurrected after restore + restart' });
  return verdict('PASS', { ...e, finding: 'post-restore decision refused' });
}

async function maintRollback(dir) {
  const d = fs.mkdtempSync(path.join(dir, 'maint-'));
  copy(path.join(dir, 'fixture.json'), path.join(d, 'fixture.json'));
  const seed = runChild({ step: 'maint-install', dir: d, which: 'latest' });
  must(seed.install.status === 'installed-unverified' && seed.verify && seed.verify.status === 'verified', 'exact-latest seed install not verified');
  const seedQ = runChild({ step: 'tc-qualify', dir: d, sequence: ['durable'] });
  must(seedQ.qualifications[0].result === 'qualified', 'exact-latest durable snapshot did not qualify');
  copy(path.join(d, 'maint.json'), path.join(d, 'latest.json'));
  const latestHead = readJson(path.join(d, 'latest.json'));
  // ADVERSARY: shipped restore path with a genuine but STALE anchor set.
  const attack = runChild({ step: 'maint-install', dir: d, which: 'stale' });
  const semanticRefusal = attack.install.status === 'refused' && attack.install.reason === 'candidate-invalid';
  must(attack.install.status === 'installed-unverified' || semanticRefusal, 'stale install neither installed nor semantically refused');
  // Post-install qualification step (the only one shipped), fresh process.
  const post = runChild({ step: 'tc-qualify', dir: d, sequence: ['durable'] });
  const now = readJson(path.join(d, 'maint.json'));
  const exactLatest = JSON.stringify({ head: now.head, terminal: now.terminal }) === JSON.stringify({ head: latestHead.head, terminal: latestHead.terminal });
  return { seedInstall: seed.install.status, seedVerify: seed.verify.status, staleInstall: attack.install,
    staleVerify: attack.verify, postInstallQualification: post.qualifications[0],
    durableStateExactLatestAfterAttack: exactLatest, freshProcesses: new Set([seed.pid, seedQ.pid, attack.pid, post.pid]).size === 4 };
}

async function run(ctx = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-harness-'));
  const results = {}; const errors = [];
  const head = (() => { try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return null; } })();
  const cache = {};
  const once = (k, fn) => (cache[k] ||= fn());
  const checks = {
    'RQ-1': async () => judgeAuth(await once('op', () => authRollback(dir, 'operation', ctx)), 'RQ-1'),
    'RQ-5': async () => judgeAuth(await once('sess', () => authRollback(dir, 'session', ctx)), 'RQ-5'),
    'RQ-4': async () => {
      const e = await once('maint', () => maintRollback(dir));
      must(e.freshProcesses, 'maintenance steps not in distinct processes');
      const refused = e.staleInstall.status === 'refused' || (e.staleVerify && e.staleVerify.status !== 'verified')
        || e.postInstallQualification.result === 'refused';
      return refused ? verdict('PASS', { ...e, finding: 'stale restore refused or detected before any decision' })
        : verdict('FAIL', { ...e, finding: 'stale-anchor restore installed, verified and qualified silently' });
    },
    'RQ-2': async () => {
      // The only shipped rollback control (qualifySnapshot WeakMap floor):
      // same process vs after a restart.
      const d = fs.mkdtempSync(path.join(dir, 'tc-'));
      copy(path.join(dir, 'fixture.json'), path.join(d, 'fixture.json'));
      const same = runChild({ step: 'tc-qualify', dir: d, sequence: ['latest', 'stale'] });
      const restarted = runChild({ step: 'tc-qualify', dir: d, sequence: ['stale'] });
      must(same.qualifications[0].result === 'qualified', 'latest snapshot did not qualify');
      const inProcess = same.qualifications[1].result === 'refused';
      const afterRestart = restarted.qualifications[0].result === 'refused';
      const e = { inProcessRollbackDetected: inProcess, inProcessReason: same.qualifications[1].reason || null,
        rollbackDetectedAfterRestart: afterRestart, distinctProcesses: same.pid !== restarted.pid };
      if (inProcess && !afterRestart) return verdict('FAIL', { ...e, finding: 'the only shipped rollback control is process memory; it does not survive restart' });
      return afterRestart ? verdict('PASS', e) : verdict('FAIL', { ...e, finding: 'no rollback control detected the stale snapshot' });
    },
    'RQ-3': async () => {
      const attacks = { 'RQ-1': await once('op', () => authRollback(dir, 'operation', ctx)),
        'RQ-5': await once('sess', () => authRollback(dir, 'session', ctx)), 'RQ-4': await once('maint', () => maintRollback(dir)) };
      const rows = Object.entries(attacks).map(([rq, e]) => {
        const refused = rq === 'RQ-4' ? (e.staleInstall.status === 'refused' || e.postInstallQualification.result === 'refused')
          : e.postRestoreDecision === 'refuse';
        return { attack: rq, refused, durableStateExactLatest: e.durableStateExactLatestAfterAttack };
      });
      const ok = rows.every(r => r.refused && r.durableStateExactLatest);
      return verdict(ok ? 'PASS' : 'FAIL', { attacks: rows,
        finding: ok ? 'every refused rollback left exact-latest durable state'
          : 'durable state after attack is not exact-latest (older state adopted; no fail-closed refusal)' });
    },
    'RQ-6': async () => {
      const d = fs.mkdtempSync(path.join(dir, 'avail-'));
      runChild({ step: 'auth-issue', dir: d });
      const decide = runChild({ step: 'auth-decide', dir: d, deciderModule: ctx.deciderModule });
      const m = fs.mkdtempSync(path.join(dir, 'avail-maint-'));
      copy(path.join(dir, 'fixture.json'), path.join(m, 'fixture.json'));
      const inst = runChild({ step: 'maint-install', dir: m, which: 'latest' });
      const q = runChild({ step: 'tc-qualify', dir: m, sequence: ['durable'] });
      const e = { latestDecisionAfterRestart: decide.decision, latestInstall: inst.install.status,
        latestVerify: inst.verify && inst.verify.status, latestQualificationAfterRestart: q.qualifications[0].result };
      const ok = decide.decision === 'authorize' && inst.install.status === 'installed-unverified'
        && inst.verify && inst.verify.status === 'verified' && q.qualifications[0].result === 'qualified';
      return verdict(ok ? 'PASS' : 'FAIL', { ...e, finding: ok ? 'genuine latest state qualifies and decisions proceed (availability only; no anchor exists to test against)' : 'genuine latest state falsely refused' });
    },
    'RQ-7': async () => {
      const files = fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => /^settlement-evidence-.*\.js$/.test(f));
      const hits = files.filter(f => /\bepoch\b/i.test(fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')));
      return verdict('NOT EXECUTED', { qualification: 'NOT QUALIFIED', reason: 'requirement stated, not satisfiable offline: no anchor/epoch mechanism exists on this head whose custody could be named',
        settlementModulesScanned: files.length, modulesMentioningEpoch: hits.length,
        gates: ['anchor/epoch mechanism: separately scoped build with its own review', 'independent custody media: INT-3 (owner storage provisioning)'] });
    },
    'RQ-8': async () => verdict('NOT EXECUTED', { qualification: 'NOT QUALIFIED', reason: 'requirement stated, not satisfiable offline: synthetic-topology run only',
      gates: ['real provisioned target with the provider backup/restore mechanism: INT-3/INT-5 (owner storage provisioning)'] }),
  };
  await buildFixture(dir);
  for (const rq of RQS) {
    try {
      if (ctx.injectFault === rq) throw new HarnessError('injected fault (mechanics self-check)');
      results[rq] = await checks[rq]();
    } catch (e) {
      errors.push({ rq, error: e instanceof HarnessError ? e.message : 'unexpected: ' + (e && e.message ? e.message.slice(0, 200) : String(e)) });
      results[rq] = { verdict: 'ERROR', evidence: null };
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  const counts = { PASS: 0, FAIL: 0, 'NOT EXECUTED': 0, ERROR: 0 };
  for (const rq of RQS) counts[results[rq].verdict]++;
  const harnessStatus = errors.length ? 'error' : 'ok';
  const qualified = counts.PASS === RQS.length;
  const expected = { 'RQ-1': 'FAIL', 'RQ-4': 'FAIL', 'RQ-7': 'NOT EXECUTED', 'RQ-8': 'NOT EXECUTED' };
  const report = {
    schema: 'rollback-qualification-harness-1', head, node: process.version, synthetic: true,
    harness: { status: harnessStatus, errors },
    qualification: { status: qualified ? 'QUALIFIED' : 'NOT QUALIFIED',
      note: 'a reproduced vulnerability (FAIL) is harness-mechanics success, not a qualification pass' },
    expectedBaseProfile: { expected, matches: Object.entries(expected).every(([k, v]) => results[k].verdict === v) },
    counts, verdicts: results,
    limitations: ['durable state is JSON files behind SQL-interpreting doubles; not PostgreSQL, not provider backup/restore',
      'adversary restore is direct state replacement of the double\'s file',
      'decisions use the shipped createRecoveryFinalAuthority over the shipped authorization store',
      'RQ-7/RQ-8 cannot execute offline; their gates are named, not passed'],
  };
  report.exitCode = harnessStatus === 'error' ? 2 : qualified ? 0 : 1;
  return report;
}

function parseArgs(argv) {
  const ctx = {}; let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--decider' && argv[i + 1]) ctx.deciderModule = argv[++i];
    else if (a === '--inject-fault' && RQS.includes(argv[i + 1])) ctx.injectFault = argv[++i];
    else return null;
  }
  return { ctx, json };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === '--child') {
    childMain(argv).catch(e => { process.stderr.write('child failure: ' + (e && e.message ? e.message.slice(0, 200) : 'unknown') + '\n'); process.exit(3); });
  } else {
    const parsed = parseArgs(argv);
    if (!parsed) { process.stderr.write('usage: rollback-qualification-harness.js [--json] [--decider <module>] [--inject-fault RQ-n]\n'); process.exit(64); }
    run(parsed.ctx).then(report => {
      if (parsed.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      else {
        process.stdout.write('rollback-qualification harness @ ' + report.head + '\n');
        for (const rq of RQS) process.stdout.write('  ' + rq + ': ' + report.verdicts[rq].verdict + '\n');
        process.stdout.write('harness: ' + report.harness.status + '; qualification: ' + report.qualification.status
          + '; expected base profile matches: ' + report.expectedBaseProfile.matches + '; exit ' + report.exitCode + '\n');
        for (const e of report.harness.errors) process.stdout.write('  ERROR ' + e.rq + ': ' + e.error + '\n');
      }
      process.exitCode = report.exitCode;
    }).catch(e => { process.stderr.write('harness error: ' + (e && e.message ? e.message.slice(0, 200) : 'unknown') + '\n'); process.exitCode = 2; });
  }
}

module.exports = { run, RQS, EXIT: Object.freeze({ QUALIFIED: 0, NOT_QUALIFIED: 1, HARNESS_ERROR: 2, USAGE: 64 }) };
