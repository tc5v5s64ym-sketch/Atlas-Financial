'use strict';
const assert = require('assert');
const path = require('path');
const { timeoutForSuite, runSuite, isExpectedFailure, failureOutput } =
  require('./lib/refresh-isolation-runner');

let checks = 0;
function check(label, fn) {
  fn(); checks++;
  console.log(`  PASS  ${label}`);
}
const root = path.resolve(__dirname, '..');
function simulate(file, error, output = '  PASS  synthetic child\n') {
  let captured;
  let tick = 100;
  const result = runSuite(file, root, {
    now: () => { tick += 25; return tick; },
    execute(command, args, options) {
      captured = { command, args, options };
      if (error) throw error;
      return output;
    },
  });
  return { result, captured };
}

console.log('=== B92 child-process harness synthetic controls ===');
check('only the exact next-move child receives 600 seconds', () => {
  assert.strictEqual(timeoutForSuite('test-nextmove.js'), 600000);
  for (const name of ['test-forecast.js', 'test-invariants.js', 'test-nextmove-copy.js', 'other/test-nextmove.js']) {
    assert.strictEqual(timeoutForSuite(name), 180000);
  }
});
check('selected deadline, command and script reach the actual execution seam', () => {
  for (const [file, limit] of [['test-nextmove.js', 600000], ['test-invariants.js', 180000]]) {
    const { result, captured } = simulate(file);
    assert.strictEqual(captured.command, process.execPath);
    assert.deepStrictEqual(captured.args, [path.join(root, 'test', file)]);
    assert.deepStrictEqual(captured.options, { cwd: root, encoding: 'utf8', timeout: limit });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.elapsedMs, 25);
    assert.strictEqual(result.timeoutMs, limit);
  }
});
const timeout = simulate('test-invariants.js', {
  code: 'ETIMEDOUT', signal: 'SIGTERM', status: null,
  stdout: '  PASS  child reached page boot\n', stderr: 'partial boot diagnostic\n',
}).result;
check('timeout carries zero failed assertions and retains termination metadata', () => {
  assert.strictEqual(timeout.ok, false);
  assert.strictEqual(timeout.kind, 'timeout');
  assert.strictEqual(timeout.fails, 0);
  assert.strictEqual(timeout.code, 'ETIMEDOUT');
  assert.strictEqual(timeout.signal, 'SIGTERM');
  assert.strictEqual(timeout.status, null);
  assert.strictEqual(timeout.elapsedMs, 25);
});
check('timeout remains unexpected even for an allowed live-reconciliation suite', () => {
  assert.strictEqual(isExpectedFailure(timeout, ['test-invariants.js']), false);
});
check('timeout report contains reason, elapsed time and both output streams', () => {
  const report = failureOutput(timeout);
  for (const text of ['timeout', '0 assertion(s)', 'elapsed=25ms', 'limit=180000ms',
    'code=ETIMEDOUT', 'status=null', 'signal=SIGTERM', 'child reached page boot', 'partial boot diagnostic']) {
    assert(report.includes(text), text);
  }
  assert(!report.includes('1 assertion(s)'));
});
const assertion = simulate('test-invariants.js', {
  status: 1, signal: null, stdout: '  FAIL  synthetic conservation assertion\n',
  stderr: '  FAIL  synthetic second assertion\n',
}).result;
check('ordinary assertion failure retains real count and allowed reconciliation sensitivity', () => {
  assert.strictEqual(assertion.ok, false);
  assert.strictEqual(assertion.kind, 'assertion-failure');
  assert.strictEqual(assertion.fails, 2);
  assert.strictEqual(assertion.status, 1);
  assert.strictEqual(isExpectedFailure(assertion, ['test-invariants.js']), true);
  assert.strictEqual(isExpectedFailure(assertion, []), false);
  assert(failureOutput(assertion).includes('synthetic conservation assertion'));
});
check('a timed-out child with partial FAIL output cannot satisfy the allowed assertion gate', () => {
  const result = simulate('test-invariants.js', {
    code: 'ETIMEDOUT', signal: 'SIGTERM', status: null, stdout: '  FAIL  partial assertion\n',
  }).result;
  assert.strictEqual(result.kind, 'timeout');
  assert.strictEqual(result.fails, 1);
  assert.strictEqual(isExpectedFailure(result, ['test-invariants.js']), false);
});
check('signal and execution failures cannot masquerade as expected assertion failures', () => {
  for (const [error, kind] of [
    [{ signal: 'SIGKILL', status: null }, 'signal'],
    [{ status: 1, stderr: 'synthetic syntax error' }, 'execution-failure'],
    [{ code: 'ENOENT', status: null }, 'execution-failure'],
  ]) {
    const result = simulate('test-invariants.js', error).result;
    assert.strictEqual(result.kind, kind);
    assert.strictEqual(result.fails, 0);
    assert.strictEqual(isExpectedFailure(result, ['test-invariants.js']), false);
  }
});
console.log('=== B20 deliberate reconciliation rejection ===');
{
  const { snapshotFirstReading } = require('./lib/b20-snapshot-reconciliation');
  const data = { meta: { asOf: '2037-02-03' }, plan: { opening: { asOf: '2037-02-03' } }, debts: [{ id: 'mbna', balance: 600 }] };
  const positions = [{ account_label: 'Invented card', balance: '100.00', as_of: '2037-02-03' }];
  const map = { mappings: [{ accountLabel: 'Invented card', canonical: { collection: 'debts', id: 'mbna' } }] };
  const message = 'mbna: canonical 600 disagrees with positions.csv 100.00 on 2037-02-03\n';
  const rejection = { status: 1, signal: null, stdout: '', stderr: message };
  function probe(error, fixture = data, pos = positions, mappings = map) {
    let output = '', seen;
    try {
      snapshotFirstReading(() => { throw error; }, fixture, pos, mappings, (condition, label) => {
        assert.strictEqual(condition, false); output += '  FAIL  ' + label + '\n';
      });
    } catch (caught) { seen = caught; }
    assert.strictEqual(seen, error, 'the exact original error must still be thrown');
    const result = runSuite('test-b20-history.js', root, {
      now: () => 0,
      execute: () => { throw { ...error, stdout: output + (error.stdout || '') }; },
    });
    return { result, output, expected: isExpectedFailure(result, ['test-b20-history.js']) };
  }
  check('the exact known rejection emits one real FAIL then preserves the original rejection', () => {
    const result = probe(rejection);
    assert.strictEqual(result.result.kind, 'assertion-failure');
    assert.strictEqual(result.result.fails, 1);
    assert.strictEqual(result.expected, true);
  });
  check('clean command return and output are preserved without a new assertion', () => {
    let called = false;
    assert.strictEqual(snapshotFirstReading(() => 'written synthetic', data, positions, map, () => { called = true; }), 'written synthetic');
    assert.strictEqual(called, false);
  });
  for (const [label, error] of [
    ['arbitrary execution error', { ...rejection, stderr: 'synthetic syntax error\n' }],
    ['timeout', { ...rejection, code: 'ETIMEDOUT', signal: 'SIGTERM', status: null }],
    ['signal termination', { ...rejection, signal: 'SIGKILL', status: null }],
    ['buffer or other execution code', { ...rejection, code: 'ENOBUFS' }],
    ['wrong exit status', { ...rejection, status: 2 }],
    ['different account rejection', { ...rejection, stderr: message.replace('mbna:', 'other-card:') }],
    ['extra stderr output', { ...rejection, stderr: message + 'unrelated error\n' }],
    ['unexpected child stdout', { ...rejection, stdout: 'unexpected output\n' }],
  ]) check(label + ' remains an unexpected hard failure', () => {
    const result = probe(error);
    assert.strictEqual(result.output, '');
    assert.strictEqual(result.result.fails, 0);
    assert.strictEqual(result.expected, false);
  });
  check('a different mutation amount cannot use the known-control assertion', () => {
    const changed = structuredClone(data); changed.debts[0].balance = 601;
    const result = probe({ ...rejection, stderr: message.replace('canonical 600', 'canonical 601') }, changed);
    assert.strictEqual(result.expected, false); assert.strictEqual(result.output, '');
  });
  check('different date, mapping or duplicate reading cannot use the known-control assertion', () => {
    for (const [fixture, pos, mappings] of [
      [{ ...data, meta: { asOf: '2037-02-04' } }, positions, map],
      [data, positions, { mappings: [] }],
      [data, positions.concat(positions), map],
    ]) {
      const result = probe(rejection, fixture, pos, mappings);
      assert.strictEqual(result.expected, false); assert.strictEqual(result.output, '');
    }
  });
  check('limits stay 600 seconds for next-move and 180 seconds for B20 and other suites', () => {
    assert.strictEqual(timeoutForSuite('test-nextmove.js'), 600000);
    assert.strictEqual(timeoutForSuite('test-b20-history.js'), 180000);
    assert.strictEqual(timeoutForSuite('test-invariants.js'), 180000);
  });
}
console.log(`ALL ${checks} CHECKS PASSED (synthetic execution; no deadline wait)`);
