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
//   --inject-scoring-fault <name>  test-only scoring self-check (review
//                        5670248433): inject one evidence-changing fault and
//                        prove it never becomes a green RQ. Names:
//     decision-authority-read   post-restore decision-path authority read fails
//                               (diagnostic read still ok)  -> RQ ERROR
//     decision-repair-write     post-restore decision path writes the revocation
//                               back (repair)               -> RQ FAIL, not PASS
//     stale-verify-transport    stale-install verifier loses its session
//                               (unknown/session-lost)      -> RQ ERROR
//     stale-refusal-journal-write  stale install refuses but mutates the
//                               journal                     -> not preserved
//     stale-install-then-restore  shipped installer installs the stale
//                               candidate, then the wrapper restores the saved
//                               latest bytes and reports a refusal
//                               (review 5670497511)         -> RQ-4 FAIL
//     stale-clean-refusal       stale install refused with no write at all
//                               (control: valid refusal)    -> RQ-4 PASS
//
// Scoring rules (review 5670248433):
//  - 'unknown'/failed authority reads or protocol faults on the ACTUAL decision
//    path are harness ERROR, never an intended refusal;
//  - the decision path is read-only: any write statement, non-read store call
//    or durable-state change during a decision is a prohibited mutation and
//    can never score PASS;
//  - verifier uncertainty (anything but 'verified' / 'mismatch') is ERROR, and
//    only a semantic stale refusal (install 'candidate-invalid' with durable
//    state unchanged) or a fresh-process qualification refusal is detection;
//  - (review 5670497511) final-state equality alone is not preservation: every
//    maintenance-session write statement and COMMIT is appended to an
//    append-only mutation log outside the state file, so write-then-restore
//    can never be scored as an untouched exact-latest refusal;
//  - exact-latest preservation compares ALL protected tables (head, staged,
//    journal, terminal, quarantine; all auth relations), not selected ones.

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
const SCORING_FAULTS = ['decision-authority-read', 'decision-repair-write', 'stale-verify-transport', 'stale-refusal-journal-write',
  'stale-install-then-restore', 'stale-clean-refusal'];
// Append-only maintenance mutation log (review 5670497511), beside the state
// file; read by the parent, never by the code under test.
const mutationLog = file => file + '.mutations.jsonl';
const appendMutation = (file, entry) => fs.appendFileSync(mutationLog(file), JSON.stringify(entry) + '\n');
const readMutations = file => (fs.existsSync(mutationLog(file))
  ? fs.readFileSync(mutationLog(file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);
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
function maintSession(file, pid, opts = {}) {
  const listeners = { error: [], end: [] };
  let writeStatements = 0; let txnWrites = 0;
  const label = opts.label || 'session-' + pid;
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
    if (/^BEGIN/.test(text)) { work = load(); txnWrites = 0; return res('BEGIN', [], null); }
    if (text === 'COMMIT') {
      must(work, 'COMMIT outside txn');
      if (txnWrites) appendMutation(file, { session: label, pid: process.pid, event: 'commit', writes: txnWrites });
      writeJson(file, work); work = null; txnWrites = 0; return res('COMMIT', [], null);
    }
    if (text === 'ROLLBACK') { work = null; txnWrites = 0; return res('ROLLBACK', [], null); }
    if ((m = new RegExp('^SELECT bytes FROM ' + q + '(doc_head|doc_staged|journal) WHERE scope = \\$1 LIMIT 2$').exec(text))) {
      const x = db()[TBL[m[1]]][v[0]]; return res('SELECT', x ? [{ bytes: buf(x) }] : []);
    }
    if (new RegExp('^SELECT history_bytes, checkpoint_bytes FROM ' + q + 'terminal_history WHERE scope = \\$1 LIMIT 2$').test(text)) {
      const t = db().terminal[v[0]]; return res('SELECT', t ? [{ history_bytes: buf(t.h), checkpoint_bytes: buf(t.c) }] : []);
    }
    if (new RegExp('^SELECT 1 AS present FROM ' + q + 'quarantine WHERE scope = \\$1 AND name = \\$2$').test(text))
      return res('SELECT', Object.hasOwn(db().quarantine, v[0] + '|' + v[1]) ? [{ present: 1 }] : []);
    must(work, 'write outside txn');
    writeStatements++; txnWrites++;
    appendMutation(file, { session: label, pid: process.pid, event: 'write', statement: text.split(/\s+/).slice(0, 3).join(' ') });
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
    get writeStatements() { return writeStatements; },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    retire() { ended = true; work = null; return Promise.resolve(); },
    async query(text, values) {
      if (ended) throw new Error('session ended');
      if (opts.transportFault) throw new Error('injected transport failure');
      return exec(text, values);
    },
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

// Decision-path observation (review 5670248433 finding 1/3): the store handed
// to the decider is a plain wrapper (the shipped store is frozen) recording
// every call, every non-'ok' read and every write statement on its session.
function observedAuthStore(file, { transportFault = false } = {}) {
  const obs = { calls: [], faults: [], writeStatements: 0 };
  const inner = authSession(file);
  const session = {
    on: (ev, fn) => inner.on(ev, fn),
    retire: () => inner.retire(),
    async query(text, values) {
      if (transportFault) { obs.faults.push('session: injected transport failure'); throw new Error('injected transport failure'); }
      if (/^(INSERT|UPDATE|DELETE)\b/.test(text)) obs.writeStatements++;
      try { return await inner.query(text, values); } catch (e) { obs.faults.push('session: query error'); throw e; }
    },
  };
  const store = require(path.join(ROOT, 'scripts/settlement-evidence-authorization-store.js'))
    .createAuthorizationStore({ session, schema: AUTH_SCHEMA, scope: AUTH_SCOPE });
  const wrapped = {};
  for (const name of Object.keys(store)) {
    const fn = store[name];
    if (typeof fn !== 'function') { wrapped[name] = fn; continue; }
    wrapped[name] = (...args) => {
      obs.calls.push(name);
      let r;
      try { r = fn.apply(store, args); } catch (e) { obs.faults.push(name + ': threw'); throw e; }
      return Promise.resolve(r).then(x => {
        if (name === 'readAuthorizationState' && !(x && x.state === 'ok')) obs.faults.push(name + ': state ' + (x && x.state));
        if (name !== 'readAuthorizationState' && !(x && typeof x.outcome === 'string' && x.outcome !== 'unknown')) obs.faults.push(name + ': outcome ' + (x && x.outcome));
        return x;
      }, e => { obs.faults.push(name + ': rejected'); throw e; });
    };
  }
  return { store: wrapped, obs };
}

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
  async 'auth-decide'({ dir, deciderModule, phase, kind, scoringFault }) {
    const file = path.join(dir, 'auth.json');
    const postRestore = phase === 'post-restore';
    // Diagnostic read on a SEPARATE store/session: a double or protocol fault
    // ('unknown') is a harness error, never mistaken for a refusal.
    const probe = await authStore(file).readAuthorizationState({ operationId: KEY.operationId, generation: KEY.generation, sidDigest: KEY.sidDigest });
    must(probe.state === 'ok', 'diagnostic read not ok');
    const { store, obs } = observedAuthStore(file, { transportFault: postRestore && scoringFault === 'decision-authority-read' });
    if (postRestore && scoringFault === 'decision-repair-write') {
      // test-only: a decision path that "repairs" the rolled-back state.
      if (kind === 'session') await store.appendSessionRevocation({ sidDigest: KEY.sidDigest, revokedAt: NOW - 500 });
      else await store.appendRevocation({ operationId: KEY.operationId, generation: KEY.generation, revokedAt: NOW - 500 });
    }
    const decide = decider(store, deciderModule);
    const authorized = await decide(retained(), committedView());
    must(typeof authorized === 'boolean', 'decision not boolean');
    const prohibitedCalls = obs.calls.filter(c => c !== 'readAuthorizationState');
    return { decision: authorized ? 'authorize' : 'refuse',
      state: { eligibility: probe.eligibility !== null, operationRevoked: probe.operationRevoked, sessionRevoked: probe.sessionRevoked },
      decisionPath: { authorityReads: obs.calls.filter(c => c === 'readAuthorizationState').length,
        faults: obs.faults, writeStatements: obs.writeStatements, prohibitedCalls } };
  },
  async 'maint-install'({ dir, which, scoringFault }) {
    const M = require(path.join(ROOT, 'scripts/settlement-evidence-restore-install.js'));
    const fx = readJson(path.join(dir, 'fixture.json'));
    const pair = fx[which]; const file = path.join(dir, 'maint.json');
    const stale = which === 'stale';
    if (stale && scoringFault === 'stale-refusal-journal-write') {
      // test-only adversarial restorer: semantic refusal that still mutates.
      const t = readJson(file); t.journal[MAINT_SCOPE] = Buffer.from('rq-synthetic-journal-residue').toString('base64'); writeJson(file, t);
      return { install: { status: 'refused', reason: 'candidate-invalid', ledgerRevision: null, historyRevision: null }, verify: null, verifyWriteStatements: 0 };
    }
    if (stale && scoringFault === 'stale-clean-refusal') {
      // test-only control: a valid semantic refusal that writes nothing.
      return { install: { status: 'refused', reason: 'candidate-invalid', ledgerRevision: null, historyRevision: null }, verify: null, verifyWriteStatements: 0 };
    }
    const base = s => ({ session: s, schema: MAINT_SCHEMA, scope: MAINT_SCOPE, domain: fx.domain, anchors: pair.anchors,
      candidate: { ledgerBytes: Buffer.from(pair.ledger, 'base64'), historyBytes: Buffer.from(pair.history, 'base64') } });
    const saved = stale && scoringFault === 'stale-install-then-restore' ? fs.readFileSync(file) : null;
    const install = await M.installRestoreCandidate(base(maintSession(file, 101, { label: 'install' })));
    if (saved) {
      // test-only adversarial wrapper (review 5670497511): the shipped installer
      // really installed the stale candidate; restore the saved latest bytes and
      // report a refusal.
      must(install.status === 'installed-unverified' && !saved.equals(fs.readFileSync(file)), 'stale install did not change durable bytes');
      fs.writeFileSync(file, saved);
      return { install: { status: 'refused', reason: 'candidate-invalid', ledgerRevision: null, historyRevision: null }, verify: null, verifyWriteStatements: 0 };
    }
    let verify = null; let verifyWriteStatements = 0;
    if (install.status === 'installed-unverified') {
      const vs = maintSession(file, 102, { label: 'verify', transportFault: stale && scoringFault === 'stale-verify-transport' });
      verify = await M.verifyRestoreInstall({ ...base(vs), pin: install.ledger.pin });
      verifyWriteStatements = vs.writeStatements;
    }
    return { install: { status: install.status, reason: install.reason || null,
      ledgerRevision: install.ledger ? install.ledger.revision : null, historyRevision: install.history ? install.history.revision : null },
      verify: verify && { status: verify.status, reason: verify.reason || null }, verifyWriteStatements };
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
  const file = path.join(d, 'auth.json');
  const baseline = decideObserved(d, 'baseline', kind, ctx);
  copy(file, path.join(d, 'checkpoint.json')); // adversary checkpoint (pre-revocation)
  runChild({ step: 'auth-revoke', dir: d, kind });
  const revoked = decideObserved(d, 'pre-attack', kind, ctx);
  copy(file, path.join(d, 'latest.json')); // exact-latest pre-attack state
  copy(path.join(d, 'checkpoint.json'), file); // ADVERSARY: direct state replacement
  must(sha(file) === sha(path.join(d, 'checkpoint.json')), 'restore did not land');
  const after = decideObserved(d, 'post-restore', kind, ctx);
  const exactLatest = sameState(readJson(file), readJson(path.join(d, 'latest.json')));
  const pids = new Set([baseline.pid, revoked.pid, after.pid]);
  must(pids.size === 3, 'decisions did not run in distinct processes');
  const mutations = [baseline, revoked, after].filter(x => x.mutation).map(x => x.phase);
  return { kind, baselineDecision: baseline.decision, preAttackDecision: revoked.decision,
    preAttackState: revoked.state, postRestoreState: after.state, postRestoreDecision: after.decision,
    postRestoreDecisionPath: after.decisionPath, decisionPathMutations: mutations,
    restartBetweenRollbackAndDecision: true, durableStateExactLatestAfterAttack: exactLatest };
}

// Canonical whole-state comparison over every protected table.
const canon = v => (v && typeof v === 'object' && !Array.isArray(v)
  ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'
  : Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : JSON.stringify(v));
const sameState = (a, b) => canon(a) === canon(b);
const changedTables = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => canon(a[k]) !== canon(b[k])).sort();

// One fresh-process decision with decision-path accounting. A fault on the
// actual decision path (unknown read, protocol/transport error) is a harness
// ERROR: 'unknown' is never evidence of an intended refusal.
function decideObserved(d, phase, kind, ctx) {
  const file = path.join(d, 'auth.json');
  const before = fs.readFileSync(file);
  const x = runChild({ step: 'auth-decide', dir: d, deciderModule: ctx.deciderModule, phase, kind, scoringFault: ctx.scoringFault });
  const changed = !before.equals(fs.readFileSync(file));
  must(x.decisionPath && Array.isArray(x.decisionPath.faults), 'decision path not observed');
  if (x.decisionPath.faults.length) throw new HarnessError(phase + ' decision-path authority/protocol failure (' + x.decisionPath.faults.join('; ') + '): unknown is not refusal evidence');
  const mutation = changed || x.decisionPath.writeStatements > 0 || x.decisionPath.prohibitedCalls.length > 0;
  return { ...x, phase, durableStateChangedByDecision: changed, mutation };
}

function judgeAuth(e, rq) {
  // The pre-attack control must refuse, else the scenario is not the RQ's.
  must(e.preAttackDecision === 'refuse', rq + ' pre-attack decision did not refuse');
  if (e.postRestoreDecision === 'authorize') return verdict('FAIL', { ...e, finding: 'revoked permission resurrected after restore + restart' });
  if (e.decisionPathMutations.length) return verdict('FAIL', { ...e, finding: 'decision path attempted prohibited writes/repair (' + e.decisionPathMutations.join(', ') + '); a repaired state is not a refusal' });
  return verdict('PASS', { ...e, finding: 'post-restore decision refused on a fault-free, read-only decision path' });
}

async function maintRollback(dir, ctx = {}) {
  const d = fs.mkdtempSync(path.join(dir, 'maint-'));
  copy(path.join(dir, 'fixture.json'), path.join(d, 'fixture.json'));
  const seed = runChild({ step: 'maint-install', dir: d, which: 'latest' });
  must(seed.install.status === 'installed-unverified' && seed.verify && seed.verify.status === 'verified', 'exact-latest seed install not verified');
  const seedQ = runChild({ step: 'tc-qualify', dir: d, sequence: ['durable'] });
  must(seedQ.qualifications[0].result === 'qualified', 'exact-latest durable snapshot did not qualify');
  copy(path.join(d, 'maint.json'), path.join(d, 'latest.json'));
  const latestHead = readJson(path.join(d, 'latest.json'));
  const logBefore = readMutations(path.join(d, 'maint.json')).length;
  // ADVERSARY: shipped restore path with a genuine but STALE anchor set.
  const attack = runChild({ step: 'maint-install', dir: d, which: 'stale', scoringFault: ctx.scoringFault });
  const semanticRefusal = attack.install.status === 'refused' && attack.install.reason === 'candidate-invalid';
  must(attack.install.status === 'installed-unverified' || semanticRefusal, 'stale install neither installed nor semantically refused');
  // Post-install qualification step (the only one shipped), fresh process.
  const post = runChild({ step: 'tc-qualify', dir: d, sequence: ['durable'] });
  const now = readJson(path.join(d, 'maint.json'));
  const changed = changedTables(now, latestHead);
  const attackLog = readMutations(path.join(d, 'maint.json')).slice(logBefore);
  const installerLog = attackLog.filter(x => x.session !== 'verify');
  return { seedInstall: seed.install.status, seedVerify: seed.verify.status, staleInstall: attack.install,
    staleVerify: attack.verify, verifyWriteStatements: attack.verifyWriteStatements, postInstallQualification: post.qualifications[0],
    protectedTablesChangedByAttack: changed,
    attackMutationLog: { installerWriteStatements: installerLog.filter(x => x.event === 'write').length,
      installerCommits: installerLog.filter(x => x.event === 'commit').length,
      verifyWriteStatements: attackLog.filter(x => x.session === 'verify' && x.event === 'write').length },
    durableStateExactLatestAfterAttack: changed.length === 0, freshProcesses: new Set([seed.pid, seedQ.pid, attack.pid, post.pid]).size === 4 };
}

// Stale-restore scoring on actual refusal/detection evidence only.
function staleOutcome(e) {
  const v = e.staleVerify;
  if (v && v.status !== 'verified' && v.status !== 'mismatch') {
    throw new HarnessError('stale verifier uncertain (' + v.status + '/' + v.reason + '): verifier uncertainty is not refusal evidence');
  }
  const installRefused = e.staleInstall.status === 'refused' && e.staleInstall.reason === 'candidate-invalid';
  const log = e.attackMutationLog;
  must(log, 'attack mutation log missing');
  // A refusal is clean only if the installer wrote nothing: write-then-restore
  // that ends byte-equal to exact-latest is a prohibited mutation, not a refusal.
  const refusalWithInstallerMutation = installRefused && (log.installerWriteStatements > 0 || log.installerCommits > 0);
  const cleanRefusal = installRefused && !refusalWithInstallerMutation && e.durableStateExactLatestAfterAttack;
  const qualificationRefused = e.postInstallQualification.result === 'refused';
  const prohibitedVerify = (e.verifyWriteStatements || 0) > 0 || log.verifyWriteStatements > 0;
  const prohibited = prohibitedVerify || refusalWithInstallerMutation;
  return { installRefused, cleanRefusal, qualificationRefused, verifierMismatch: !!(v && v.status === 'mismatch'),
    prohibitedVerifyWrites: prohibitedVerify, refusalWithInstallerMutation, prohibitedMutation: prohibited,
    detected: !prohibited && (cleanRefusal || qualificationRefused) };
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
      const e = await once('maint', () => maintRollback(dir, ctx));
      must(e.freshProcesses, 'maintenance steps not in distinct processes');
      const o = staleOutcome(e);
      if (o.detected) return verdict('PASS', { ...e, scoring: o, finding: 'stale restore semantically refused with state unchanged, or refused by fresh-process qualification' });
      return verdict('FAIL', { ...e, scoring: o, finding: o.refusalWithInstallerMutation ? 'stale restore reported refused but the installer mutated durable state (write-then-restore is not a clean refusal)'
        : o.installRefused ? 'stale restore refused but protected state changed (not fail-closed)'
        : o.prohibitedVerifyWrites ? 'verifier wrote protected state' : 'stale-anchor restore installed and qualified silently' });
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
        'RQ-5': await once('sess', () => authRollback(dir, 'session', ctx)), 'RQ-4': await once('maint', () => maintRollback(dir, ctx)) };
      const rows = Object.entries(attacks).map(([rq, e]) => {
        if (rq === 'RQ-4') {
          const o = staleOutcome(e);
          return { attack: rq, refused: o.installRefused || o.qualificationRefused, prohibitedMutation: o.prohibitedMutation,
            durableStateExactLatest: e.durableStateExactLatestAfterAttack, changedTables: e.protectedTablesChangedByAttack };
        }
        return { attack: rq, refused: e.postRestoreDecision === 'refuse', prohibitedMutation: e.decisionPathMutations.length > 0,
          durableStateExactLatest: e.durableStateExactLatestAfterAttack };
      });
      const ok = rows.every(r => r.refused && !r.prohibitedMutation && r.durableStateExactLatest);
      return verdict(ok ? 'PASS' : 'FAIL', { attacks: rows,
        finding: ok ? 'every refused rollback left exact-latest durable state (all protected tables) with no prohibited mutation'
          : 'durable state after attack is not exact-latest on all protected tables, or exact-latest was reached by prohibited mutation' });
    },
    'RQ-6': async () => {
      const d = fs.mkdtempSync(path.join(dir, 'avail-'));
      runChild({ step: 'auth-issue', dir: d });
      const decide = decideObserved(d, 'availability', 'operation', ctx);
      const m = fs.mkdtempSync(path.join(dir, 'avail-maint-'));
      copy(path.join(dir, 'fixture.json'), path.join(m, 'fixture.json'));
      const inst = runChild({ step: 'maint-install', dir: m, which: 'latest' });
      const q = runChild({ step: 'tc-qualify', dir: m, sequence: ['durable'] });
      const e = { latestDecisionAfterRestart: decide.decision, latestInstall: inst.install.status,
        latestVerify: inst.verify && inst.verify.status, latestQualificationAfterRestart: q.qualifications[0].result };
      must(!(inst.verify && inst.verify.status !== 'verified' && inst.verify.status !== 'mismatch'), 'latest verifier uncertain');
      const ok = decide.decision === 'authorize' && !decide.mutation && inst.install.status === 'installed-unverified'
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
    else if (a === '--inject-scoring-fault' && SCORING_FAULTS.includes(argv[i + 1])) ctx.scoringFault = argv[++i];
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
    if (!parsed) { process.stderr.write('usage: rollback-qualification-harness.js [--json] [--decider <module>] [--inject-fault RQ-n] [--inject-scoring-fault <name>]\n'); process.exit(64); }
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

module.exports = { run, RQS, SCORING_FAULTS, EXIT: Object.freeze({ QUALIFIED: 0, NOT_QUALIFIED: 1, HARNESS_ERROR: 2, USAGE: 64 }) };
