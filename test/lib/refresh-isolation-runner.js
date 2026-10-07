'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function withMutatedFixture(root, mutate, fn) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-refresh-isolation-'));
  try {
    // Independent history/index are needed by the existing static and historical
    // reconciliation suites. No shared objects, worktree links or source writes.
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--', root, fixture],
      { encoding: 'utf8' });
    // Exercise this checkout's current tracked bytes, including uncommitted test
    // edits, rather than silently testing only the last commit. Ignored private
    // files (raw/, derived/, .env, local provider mappings) never enter the copy.
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    for (const file of files) {
      const target = path.join(fixture, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, file), target);
    }
    const dataPath = path.join(fixture, 'data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    mutate(data);
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2) + '\n');
    return fn(fixture);
  } finally {
    // A forced process kill can bypass finally and leave this temporary copy.
    // The canonical file is never written, so cancellation needs no restoration.
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

// Next-move also boots five page contexts. Its longer deadline remains bounded
// and does not change the limit of any other refresh-isolation child.
function timeoutForSuite(file) {
  return file === 'test-nextmove.js' ? 600000 : 180000;
}

function runSuite(file, root, { execute = execFileSync, now = Date.now } = {}) {
  const timeoutMs = timeoutForSuite(file);
  const started = now();
  try {
    const out = execute(process.execPath, [path.join(root, 'test', file)], {
      cwd: root, encoding: 'utf8', timeout: timeoutMs,
    });
    return { file, ok: true, fails: 0, out, kind: 'success', code: null,
      status: 0, signal: null, elapsedMs: now() - started, timeoutMs };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    const fails = (out.match(/^\s*FAIL\s/gm) || []).length;
    const kind = e.code === 'ETIMEDOUT' ? 'timeout'
      : e.signal ? 'signal'
      : fails > 0 && Number.isInteger(e.status) && e.status !== 0
        ? 'assertion-failure' : 'execution-failure';
    return { file, ok: false, fails, out, kind, code: e.code || null,
      status: e.status == null ? null : e.status, signal: e.signal || null,
      elapsedMs: now() - started, timeoutMs };
  }
}

function isExpectedFailure(result, allowed) {
  // An allowed live-reconciliation assertion must actually have run and failed.
  // Timeouts, signals and execution errors remain unexpected hard failures.
  return result.kind === 'assertion-failure' && allowed.includes(result.file);
}

function failureSummary(result) {
  return `${result.file}: ${result.kind}; ${result.fails} assertion(s); ` +
    `elapsed=${result.elapsedMs}ms; limit=${result.timeoutMs}ms; ` +
    `code=${result.code}; status=${result.status}; signal=${result.signal}`;
}

function failureOutput(result) {
  // Preserve all captured output, including evidence of child termination.
  return `  FAIL  ${failureSummary(result)}\n` +
    `--- captured output: ${result.file} ---\n${result.out || '(no captured output)'}\n` +
    `--- end captured output: ${result.file} ---`;
}

module.exports = { withMutatedFixture, timeoutForSuite, runSuite, isExpectedFailure, failureSummary, failureOutput };
