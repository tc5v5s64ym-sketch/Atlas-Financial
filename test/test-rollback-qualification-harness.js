'use strict';
// Rollback-qualification harness (Plan #3 Lane 3, issue #718): MECHANICS ONLY.
// Synthetic fixtures; durable state is JSON files behind SQL-interpreting
// doubles (not PostgreSQL). This suite is deliberately NOT registered in
// test/test.js: on current main the harness reproduces the rollback
// vulnerability (RQ-1/RQ-4 FAIL), which is the expected, honest result.
// These tests assert the harness's own mechanics: adversary restore, restart
// between rollback and decision, verdict reporting, exit-code meanings, and
// that unexpected errors surface as ERROR / exit 2 and never as green.
// Run: node --test test/test-rollback-qualification-harness.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const H = require('../scripts/rollback-qualification-harness');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'rollback-qualification-harness.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-harness-test-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
function deciderFile(name, body) {
  const file = path.join(tmp, name + '.js');
  fs.writeFileSync(file, "'use strict';\nexports.createDecider = () => " + body + ';\n');
  return file;
}
const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 120_000 });

test('RH-1 shipped code: vulnerability reproduced as FAIL, RQ-7/8 NOT EXECUTED, harness ok, NOT QUALIFIED, exit 1', async () => {
  const r = await H.run();
  assert.equal(r.harness.status, 'ok');
  assert.deepEqual(r.harness.errors, []);
  assert.equal(r.qualification.status, 'NOT QUALIFIED');
  assert.equal(r.exitCode, H.EXIT.NOT_QUALIFIED);
  assert.equal(r.expectedBaseProfile.matches, true);
  assert.deepEqual(Object.keys(r.verdicts), H.RQS);
  for (const rq of ['RQ-1', 'RQ-5']) {
    const e = r.verdicts[rq].evidence;
    assert.equal(r.verdicts[rq].verdict, 'FAIL');
    // the scenario really happened: authorize -> revoke refuses -> restore -> fresh process authorizes
    assert.equal(e.baselineDecision, 'authorize');
    assert.equal(e.preAttackDecision, 'refuse');
    assert.equal(e.postRestoreDecision, 'authorize');
    assert.equal(e.postRestoreState.operationRevoked || e.postRestoreState.sessionRevoked, false);
    assert.equal(e.durableStateExactLatestAfterAttack, false);
  }
  assert.equal(r.verdicts['RQ-1'].evidence.preAttackState.operationRevoked, true);
  assert.equal(r.verdicts['RQ-5'].evidence.preAttackState.sessionRevoked, true);
  const rq4 = r.verdicts['RQ-4'];
  assert.equal(rq4.verdict, 'FAIL');
  assert.equal(rq4.evidence.staleInstall.status, 'installed-unverified');
  assert.equal(rq4.evidence.staleInstall.ledgerRevision, 1);
  assert.equal(rq4.evidence.staleInstall.historyRevision, 0);
  assert.equal(rq4.evidence.postInstallQualification.result, 'qualified');
  assert.equal(rq4.evidence.freshProcesses, true);
  // RQ-2: the in-memory floor works inside one process but not after restart
  assert.equal(r.verdicts['RQ-2'].verdict, 'FAIL');
  assert.equal(r.verdicts['RQ-2'].evidence.inProcessRollbackDetected, true);
  assert.equal(r.verdicts['RQ-2'].evidence.rollbackDetectedAfterRestart, false);
  assert.equal(r.verdicts['RQ-3'].verdict, 'FAIL');
  assert.equal(r.verdicts['RQ-6'].verdict, 'PASS');
  for (const rq of ['RQ-7', 'RQ-8']) {
    assert.equal(r.verdicts[rq].verdict, 'NOT EXECUTED');
    assert.equal(r.verdicts[rq].evidence.qualification, 'NOT QUALIFIED');
    assert.ok(r.verdicts[rq].evidence.gates.length >= 1);
  }
  assert.deepEqual(r.counts, { PASS: 1, FAIL: 5, 'NOT EXECUTED': 2, ERROR: 0 });
});

test('RH-2 verdicts are not hardwired: a refusing decider double flips RQ-1/RQ-5 to PASS and RQ-6 to FAIL; still NOT QUALIFIED', async () => {
  const r = await H.run({ deciderModule: deciderFile('refuse-all', 'async () => false') });
  assert.equal(r.harness.status, 'ok');
  assert.equal(r.verdicts['RQ-1'].verdict, 'PASS');
  assert.equal(r.verdicts['RQ-5'].verdict, 'PASS');
  assert.equal(r.verdicts['RQ-6'].verdict, 'FAIL', 'refusing the true latest is an availability failure');
  assert.equal(r.verdicts['RQ-7'].verdict, 'NOT EXECUTED');
  assert.equal(r.qualification.status, 'NOT QUALIFIED');
  assert.equal(r.expectedBaseProfile.matches, false);
  assert.equal(r.exitCode, H.EXIT.NOT_QUALIFIED);
});

test('RH-3 an unexpected decider error is ERROR and harness error, never a refusal or PASS', async () => {
  const r = await H.run({ deciderModule: deciderFile('throws', "async () => { throw new Error('boom'); }") });
  assert.equal(r.harness.status, 'error');
  for (const rq of ['RQ-1', 'RQ-5', 'RQ-3', 'RQ-6']) assert.equal(r.verdicts[rq].verdict, 'ERROR', rq);
  assert.ok(r.harness.errors.some(e => e.rq === 'RQ-1'));
  assert.equal(r.qualification.status, 'NOT QUALIFIED');
  assert.equal(r.exitCode, H.EXIT.HARNESS_ERROR);
});

test('RH-4 CLI exit codes: 1 on current main, 2 on injected fault, 64 on usage error', () => {
  const ok = cli('--json');
  assert.equal(ok.status, 1);
  const report = JSON.parse(ok.stdout);
  assert.equal(report.harness.status, 'ok');
  assert.equal(report.exitCode, 1);
  const fault = cli('--json', '--inject-fault', 'RQ-4');
  assert.equal(fault.status, 2);
  const f = JSON.parse(fault.stdout);
  assert.equal(f.verdicts['RQ-4'].verdict, 'ERROR');
  assert.equal(f.harness.status, 'error');
  assert.equal(cli('--bogus').status, 64);
});

// Review 5670248433 regressions: evidence-changing faults never score green.
test('RH-5 decision-path authority read failure (diagnostic ok) is ERROR / exit 2, never an RQ-1/RQ-5 PASS', async () => {
  const r = await H.run({ scoringFault: 'decision-authority-read' });
  assert.equal(r.harness.status, 'error');
  for (const rq of ['RQ-1', 'RQ-5', 'RQ-3']) assert.equal(r.verdicts[rq].verdict, 'ERROR', rq);
  assert.ok(r.harness.errors.some(e => e.rq === 'RQ-1' && /decision-path authority\/protocol failure/.test(e.error)));
  assert.equal(r.verdicts['RQ-6'].verdict, 'PASS', 'availability decision is not on the faulted post-restore path');
  assert.equal(r.exitCode, H.EXIT.HARNESS_ERROR);
  assert.equal(r.qualification.status, 'NOT QUALIFIED');
});

test('RH-6 stale verifier transport failure (unknown/session-lost) is ERROR for RQ-4/RQ-3, never PASS', async () => {
  const r = await H.run({ scoringFault: 'stale-verify-transport' });
  assert.equal(r.harness.status, 'error');
  assert.equal(r.verdicts['RQ-4'].verdict, 'ERROR');
  assert.equal(r.verdicts['RQ-3'].verdict, 'ERROR');
  assert.ok(r.harness.errors.some(e => e.rq === 'RQ-4' && /verifier uncertain \(unknown\/session-lost\)/.test(e.error)));
  assert.equal(r.verdicts['RQ-1'].verdict, 'FAIL');
  assert.equal(r.exitCode, H.EXIT.HARNESS_ERROR);
});

test('RH-7 a journal-changing stale refusal is not preservation: RQ-4 and RQ-3 FAIL with journal named', async () => {
  const r = await H.run({ scoringFault: 'stale-refusal-journal-write', deciderModule: deciderFile('refuse-all-j', 'async () => false') });
  assert.equal(r.harness.status, 'ok');
  assert.equal(r.verdicts['RQ-1'].verdict, 'PASS');
  assert.equal(r.verdicts['RQ-5'].verdict, 'PASS');
  const e4 = r.verdicts['RQ-4'].evidence;
  assert.equal(r.verdicts['RQ-4'].verdict, 'FAIL');
  assert.equal(e4.staleInstall.status, 'refused');
  assert.deepEqual(e4.protectedTablesChangedByAttack, ['journal']);
  assert.equal(e4.durableStateExactLatestAfterAttack, false);
  assert.equal(r.verdicts['RQ-3'].verdict, 'FAIL');
  assert.equal(r.exitCode, H.EXIT.NOT_QUALIFIED);
});

test('RH-8 decision-path repair writes that restore exact-latest never score RQ-1/RQ-5/RQ-3 PASS', async () => {
  const r = await H.run({ scoringFault: 'decision-repair-write', deciderModule: deciderFile('refuse-all-r', 'async () => false') });
  assert.equal(r.harness.status, 'ok');
  for (const rq of ['RQ-1', 'RQ-5']) {
    const e = r.verdicts[rq].evidence;
    assert.equal(r.verdicts[rq].verdict, 'FAIL', rq);
    assert.equal(e.postRestoreDecision, 'refuse');
    assert.equal(e.durableStateExactLatestAfterAttack, true, 'repair reached exact-latest');
    assert.deepEqual(e.decisionPathMutations, ['post-restore']);
    assert.ok(e.postRestoreDecisionPath.writeStatements > 0);
  }
  assert.equal(r.verdicts['RQ-3'].verdict, 'FAIL');
  assert.ok(r.verdicts['RQ-3'].evidence.attacks.filter(a => a.attack !== 'RQ-4').every(a => a.prohibitedMutation));
  assert.equal(r.qualification.status, 'NOT QUALIFIED');
});

test('RH-9 CLI scoring faults: exit 2 for uncertainty faults, 1 for mutation faults, 64 for unknown fault names', () => {
  assert.equal(cli('--json', '--inject-scoring-fault', 'decision-authority-read').status, 2);
  assert.equal(cli('--json', '--inject-scoring-fault', 'stale-verify-transport').status, 2);
  assert.equal(cli('--json', '--inject-scoring-fault', 'stale-refusal-journal-write').status, 1);
  assert.equal(cli('--inject-scoring-fault', 'bogus').status, 64);
});
