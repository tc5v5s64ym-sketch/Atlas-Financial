'use strict';
/* The CI split must schedule the complete serial manifest exactly once and
 * preserve a non-success result all the way to the existing `test` check.
 * Only synthetic runner operations and job results are used here. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { suites, GROUPS, selectSuites, selectionFromArgs, runSuites } = require('./test');
const { sourceText } = require('./test-source-text');
const ROOT = path.join(__dirname, '..');
const files = rows => rows.map(([, file]) => file);
let failures = 0;
let checks = 0;
function check(label, fn) {
  checks++;
  try { fn(); console.log(`  PASS  ${label}`); }
  catch (error) { failures++; console.error(`  FAIL  ${label}: ${error.message}`); }
}

check('npm test remains the complete ordered serial reference', () => {
  assert.equal(require('../package.json').scripts.test, 'node test/test.js');
  assert.deepEqual(selectionFromArgs([]), suites);
  assert.deepEqual(selectionFromArgs(['--group', 'all']), suites);
  assert(suites.some(([, file]) => file === 'test-ci-split.js'));
  for (const [, file] of suites) assert(fs.existsSync(path.join(__dirname, file)), file);
});

check('two groups are a disjoint exact union, retaining manifest order and the non-test probe', () => {
  assert.deepEqual(GROUPS, ['standard', 'refresh-isolation']);
  const standard = files(selectSuites('standard'));
  const isolation = files(selectSuites('refresh-isolation'));
  const all = files(suites);
  assert.deepEqual(isolation, ['test-refresh-isolation.js']);
  assert.deepEqual(standard, all.filter(file => file !== isolation[0]));
  assert(standard.includes('probe-savings-daily-allocation-incumbent.js'));
  const union = [...standard, ...isolation];
  assert.equal(new Set(union).size, all.length);
  assert.equal(union.length, all.length);
  assert.deepEqual(union.sort(), [...all].sort());
});

check('a new explicit non-test-prefixed entry automatically joins the standard group', () => {
  const added = ['synthetic future suite', 'probe-future-suite.js'];
  assert.deepEqual(selectSuites('standard', [...suites, added]).at(-1), added);
});

check('unknown, empty, duplicate and malformed selections fail closed', () => {
  for (const group of ['', 'unknown', 'STANDARD', null, false, []]) {
    assert.throws(() => selectSuites(group), /Unknown suite group/);
  }
  assert.throws(() => selectSuites('all', []), /nonempty/);
  assert.throws(() => selectSuites('standard', [['only', 'test-refresh-isolation.js']]), /nonempty/);
  assert.throws(() => selectSuites('all', [['only', 'probe-example.js']]), /must include/);
  assert.throws(() => selectSuites('all', [...suites, suites[0]]), /Duplicate/);
  assert.throws(() => selectSuites('all', [...suites, ['other label', suites[0][1]]]), /Duplicate/);
  for (const row of [null, [], ['', 'test-example.js'], ['bad', '../test-example.js'],
    ['bad', 'test-*.js'], ['bad', ''], ['bad', 42], ['bad', 'test-example.js', 'extra']]) {
    assert.throws(() => selectSuites('all', [...suites, row]), /Invalid/);
  }
  assert.throws(() => runSuites([]), /nonempty/);
});

check('invalid command lines exit nonzero before executing any suite', () => {
  for (const args of [['--group'], ['--group', ''], ['--group', 'typo'], ['--unknown'],
    ['standard'], ['--group', 'standard', '--group', 'refresh-isolation']]) {
    const child = spawnSync(process.execPath, [path.join(__dirname, 'test.js'), ...args],
      { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.status, 1, JSON.stringify(args));
    assert.equal(child.stdout, '', 'a rejected selection must execute nothing');
    assert.match(child.stderr, /Unknown suite group|Usage:/);
  }
});

check('importing the manifest cannot start the full suite', () => {
  const out = execFileSync(process.execPath, ['-e', "require('./test/test.js')"],
    { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  assert.equal(out, '');
});

const synthetic = [['first', 'test-first.js'], ['second', 'test-second.js'], ['last', 'test-last.js']];
check('runner executes each selection serially with the incumbent cwd, Node and inherited output', () => {
  const calls = [];
  const code = runSuites(synthetic, {
    exists: () => true, log: () => {},
    execute(node, args, options) {
      assert.equal(node, process.execPath);
      assert.deepEqual(options, { cwd: ROOT, stdio: 'inherit' });
      assert.equal(args.length, 1);
      calls.push(path.basename(args[0]));
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, files(synthetic));
});

check('assertion, signal, timeout and launch failures stay red while remaining suites still run', () => {
  for (const details of [{ status: 1 }, { signal: 'SIGTERM' }, { code: 'ETIMEDOUT' }, { code: 'ENOENT' }]) {
    const calls = [];
    const logs = [];
    const code = runSuites(synthetic, {
      exists: () => true, log: text => logs.push(text),
      execute(node, args) {
        calls.push(path.basename(args[0]));
        if (calls.length === 2) throw Object.assign(new Error('synthetic child failure'), details);
      },
    });
    assert.equal(code, 1);
    assert.deepEqual(calls, files(synthetic));
    assert(logs.some(text => /1 of 3 suites: second/.test(text)));
  }
});

check('a missing suite is a failure, never a successful empty execution', () => {
  const calls = [];
  const logs = [];
  const code = runSuites(synthetic, {
    exists: file => !file.endsWith('test-second.js'), log: text => logs.push(text),
    execute: (node, args) => calls.push(path.basename(args[0])),
  });
  assert.equal(code, 1);
  assert.deepEqual(calls, ['test-first.js', 'test-last.js']);
  assert(logs.some(text => /test-second.js is missing/.test(text)));
});

const workflow = sourceText(fs.readFileSync(path.join(ROOT, '.github/workflows/test.yml'), 'utf8'));
// This intentionally pins this small workflow's wiring. Execute its actual
// aggregation shell below as well: a source-shape check alone cannot prove red.
function workflowContract(src) {
  assert.match(src, /^name: tests$/m);
  assert.match(src, /^on:\n  push:\n    branches: \['\*\*'\]\n  pull_request:\n/m);
  assert.match(src, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(src, /^\s*(?:concurrency|continue-on-error|strategy):/m);
  const body = src.split('\njobs:\n')[1];
  assert(body, 'jobs are present');
  const headers = [...body.matchAll(/^  ([a-z-]+):\n/gm)];
  assert.deepEqual(headers.map(match => match[1]), ['standard', 'refresh-isolation', 'test']);
  const jobs = Object.fromEntries(headers.map((match, i) =>
    [match[1], body.slice(match.index, headers[i + 1]?.index)]));
  for (const group of ['standard', 'refresh-isolation']) {
    const job = jobs[group];
    assert.match(job, /^    runs-on: ubuntu-latest$/m);
    assert.doesNotMatch(job, /^\s+(?:if|needs|ref):/m);
    assert.equal((job.match(/uses: actions\/checkout@v4/g) || []).length, 1);
    assert.match(job, /^          fetch-depth: 0$/m);
    assert.match(job, /uses: actions\/setup-node@v4\n        with:\n          node-version: '20'/);
    assert.match(job, /^        run: npm ci --omit=dev$/m);
    const commands = [...job.matchAll(/^        run: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(commands, ['npm ci --omit=dev', `node test/test.js --group ${group}`,
      'test -f .githooks/pre-commit && test -f scripts/privacy-guard.js']);
  }
  const gate = jobs.test;
  assert.match(gate, /^    name: test$/m);
  assert.match(gate, /^    needs: \[standard, refresh-isolation\]$/m);
  assert.match(gate, /^    if: \$\{\{ always\(\) \}\}$/m);
  assert.match(gate, /^    timeout-minutes: 5$/m);
  assert.match(gate, /^          STANDARD_RESULT: \$\{\{ needs.standard.result \}\}$/m);
  assert.match(gate, /^          REFRESH_ISOLATION_RESULT: \$\{\{ needs.refresh-isolation.result \}\}$/m);
  assert.doesNotMatch(gate, /^      (?:if:|  if:)|uses:/m);
  const shell = gate.match(/^        run: \|\n((?:          .*\n)+)/m);
  assert(shell, 'gate has an executable shell body');
  return shell[1].split('\n').map(line => line.slice(10)).join('\n');
}

check('workflow keeps both event identities, isolated Node 20 jobs, privacy and the always-run test gate', () => {
  workflowContract(workflow);
  const repair = sourceText(fs.readFileSync(path.join(ROOT, '.github/workflows/atlas-test-repair.yml'), 'utf8'));
  assert.match(repair, /workflows:\s*\["tests", "Merge card check"\]/);
});

check('workflow contract rejects omissions, skips, shallow history, changed refs and weakened checks', () => {
  const mutations = [
    ['needs: [standard, refresh-isolation]', 'needs: [standard]'],
    ['    if: ${{ always() }}', '    if: ${{ success() }}'],
    ['  refresh-isolation:', '  missing-isolation:'],
    ['  standard:\n', '  standard:\n    if: false\n'],
    ['fetch-depth: 0', 'fetch-depth: 1'],
    ["node-version: '20'", "node-version: '24'"],
    ['run: node test/test.js --group standard', 'run: node test/test.js --group refresh-isolation'],
    ['    branches: [\'**\']\n  pull_request:\n', '    branches: [\'**\']\n'],
    ['  standard:\n', '  standard:\n    continue-on-error: true\n'],
    ['fetch-depth: 0', 'fetch-depth: 0\n          ref: main'],
    ['jobs:\n', 'concurrency: tests\njobs:\n'],
  ];
  for (const [from, to] of mutations) {
    assert(workflow.includes(from), `negative-control anchor: ${from}`);
    assert.throws(() => workflowContract(workflow.replace(from, to)), assert.AssertionError);
  }
});

check('actual gate accepts only two successes across all 100 result combinations', () => {
  const shell = workflowContract(workflow);
  const bash = process.platform === 'win32'
    ? path.resolve(execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim(),
      '../../..', 'bin/bash.exe') : 'bash';
  const states = ['success', 'failure', 'cancelled', 'skipped', 'timed_out', 'neutral',
    'startup_failure', 'unexpected', '', undefined];
  for (const standard of states) for (const isolation of states) {
    const env = { ...process.env };
    delete env.STANDARD_RESULT;
    delete env.REFRESH_ISOLATION_RESULT;
    if (standard !== undefined) env.STANDARD_RESULT = standard;
    if (isolation !== undefined) env.REFRESH_ISOLATION_RESULT = isolation;
    const result = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', shell],
      { cwd: ROOT, env, encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, standard === 'success' && isolation === 'success' ? 0 : 1,
      `standard=${standard}, refresh-isolation=${isolation}: ${result.stderr}`);
  }
});

console.log(`\n${checks - failures}/${checks} CI split contract checks passed.`);
process.exitCode = failures ? 1 : 0;
