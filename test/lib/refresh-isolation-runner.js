'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

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

module.exports = { timeoutForSuite, runSuite, isExpectedFailure, failureSummary, failureOutput };
