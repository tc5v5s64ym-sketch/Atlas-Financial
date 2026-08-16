'use strict';
/* Trusted-gate validator for Atlas CI.
 * `node scripts/atlas-ci-gate.js evaluate-pr <pr-root> <trusted-root>`
 *
 * Reads the PR tree as data. It does not execute PR code. The Actions
 * workflow checks this helper out from the default branch, then compares
 * the PR's atlas-ci.yml and this helper byte-for-byte with the trusted
 * copies so a self-edit cannot redefine the merge gate, land a spoof
 * pull_request workflow, or poison the next PR's validator.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FILE = 'atlas-ci.yml';
const PROTECTED_FILES = [
  path.join('.github', 'workflows', REQUIRED_FILE),
  path.join('scripts', 'atlas-ci-gate.js'),
];

function stripCommentLines(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/^\s*#.*$/gm, '');
}

function workflowEvents(text) {
  const src = stripCommentLines(text);
  const onMatch = /^on:(.*)$/m.exec(src);
  if (!onMatch) return [];
  const rest = onMatch[1].trim();
  if (rest.startsWith('[')) {
    return rest.replace(/[\[\]]/g, '').split(',').map((item) => item.trim()).filter(Boolean);
  }
  if (rest) {
    return [rest.replace(/:$/, '')];
  }
  const start = onMatch.index + onMatch[0].length;
  const after = src.slice(start);
  const end = after.search(/\n[A-Za-z]/);
  const block = end === -1 ? after : after.slice(0, end);
  return [...block.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((match) => match[1]);
}

function evaluateWorkflowText(text, filename) {
  const reasons = [];
  const src = String(text || '');
  const events = workflowEvents(src);

  if (filename && filename !== REQUIRED_FILE) {
    reasons.push(`${filename} is not the Atlas CI workflow`);
  }
  if (!events.includes('pull_request_target')) {
    reasons.push('workflow must trigger on pull_request_target so GitHub uses the default-branch definition');
  }
  if (events.includes('pull_request')) {
    reasons.push('workflow must not trigger on pull_request — that event runs PR-authored YAML');
  }
  for (const banned of ['push', 'workflow_run', 'workflow_dispatch', 'pull_request_review']) {
    if (events.includes(banned)) {
      reasons.push(`workflow must not trigger on ${banned}`);
    }
  }
  if (!/^name:\s*Atlas CI\s*$/m.test(src)) {
    reasons.push('workflow name must be Atlas CI');
  }
  if (!/^\s+name:\s*Atlas CI\s*$/m.test(src)) {
    reasons.push('job name must be Atlas CI');
  }
  if ((src.match(/runs-on:/g) || []).length !== 2) {
    reasons.push('workflow must have exactly two GitHub-hosted jobs');
  }
  if (!/npm test/.test(src)) {
    reasons.push('workflow must run npm test');
  }
  if (!/scripts\/figures-snapshot\.js/.test(src)) {
    reasons.push('workflow must snapshot published figures');
  }
  if (!/scripts\/figures-compare\.js/.test(src)) {
    reasons.push('workflow must compare published figures');
  }
  if (!/persist-credentials:\s*false/.test(src)) {
    reasons.push('PR-head checkout must set persist-credentials: false');
  }
  if (!/GITHUB_TOKEN:\s*['"]{2}/.test(src)) {
    reasons.push('PR code must not receive GITHUB_TOKEN');
  }
  if (!/statuses:\s*none/.test(src)) {
    reasons.push('suite job must set statuses: none');
  }
  if (!/needs\.test\.result/.test(src)) {
    reasons.push('status publisher must consume the suite job result');
  }
  if (!/evaluate-pr pr trusted/.test(src)) {
    reasons.push('gate helper must compare the PR tree with the trusted copies');
  }
  if (/\$\{\{\s*secrets\./.test(src) || /OPENAI_API_KEY/.test(src) || /ATLAS_AUTOMATION_TOKEN/.test(src) || /CURSOR_API_KEY/.test(src)) {
    reasons.push('workflow must not reference repository secrets or paid AI keys');
  }
  if (/pull-requests:\s*write/.test(src) || /contents:\s*write/.test(src)) {
    reasons.push('workflow must not grant write on contents or pull-requests');
  }
  if (!/statuses:\s*write/.test(src)) {
    reasons.push('workflow must publish the Atlas CI status onto the exact PR head');
  }
  if (/exit 0/.test(src) && !/npm test/.test(src)) {
    reasons.push('workflow must not replace the suite with an unconditional success');
  }

  return { ok: reasons.length === 0, reasons, events };
}

function listWorkflowFiles(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((name) => /\.ya?ml$/i.test(name)).sort();
}

function relPosix(rel) {
  return rel.split(path.sep).join('/');
}

function evaluatePr(prRoot, trustedRoot) {
  const reasons = [];
  if (!prRoot || !trustedRoot) {
    return { ok: false, reasons: ['evaluate-pr requires <pr-root> and <trusted-root>'] };
  }

  const workflowDir = path.join(prRoot, '.github', 'workflows');
  const files = listWorkflowFiles(workflowDir);
  if (!files.length) {
    reasons.push('PR head has no GitHub workflow files — the trusted gate would be deleted');
  } else if (files.length !== 1 || files[0] !== REQUIRED_FILE) {
    reasons.push(
      `PR head must contain only ${REQUIRED_FILE}, not a self-authored or extra workflow (found: ${files.join(', ') || 'none'})`
    );
  }

  for (const rel of PROTECTED_FILES) {
    const label = relPosix(rel);
    const prFile = path.join(prRoot, rel);
    const trustedFile = path.join(trustedRoot, rel);
    if (!fs.existsSync(trustedFile) || !fs.statSync(trustedFile).isFile()) {
      reasons.push(`trusted copy of ${label} is missing`);
      continue;
    }
    if (!fs.existsSync(prFile) || !fs.statSync(prFile).isFile()) {
      reasons.push(`PR head is missing ${label}`);
      continue;
    }
    const prBytes = fs.readFileSync(prFile);
    const trustedBytes = fs.readFileSync(trustedFile);
    if (Buffer.compare(prBytes, trustedBytes) !== 0) {
      reasons.push(`${label} does not match the trusted default-branch copy`);
    }
  }

  return { ok: reasons.length === 0, reasons, files };
}

function main(argv) {
  const command = argv[2];
  if (command !== 'evaluate-pr' || !argv[3] || !argv[4]) {
    process.stderr.write('usage: node scripts/atlas-ci-gate.js evaluate-pr <pr-root> <trusted-root>\n');
    process.exit(2);
  }
  const result = evaluatePr(argv[3], argv[4]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main(process.argv);

module.exports = {
  evaluatePr,
  evaluateWorkflowText,
  workflowEvents,
  PROTECTED_FILES,
};
