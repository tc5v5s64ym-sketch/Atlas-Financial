'use strict';
/* Trusted-gate validator for Atlas CI. `node scripts/atlas-ci-gate.js evaluate-pr <workflows-dir>`
 *
 * Reads workflow YAML as data. It does not execute PR code. The Actions
 * workflow checks this helper out from the default branch, then points it at
 * the PR head's `.github/workflows` directory so a self-edit cannot redefine
 * the merge gate or land a spoof `pull_request` workflow.
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_FILE = 'atlas-ci.yml';

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
  if ((src.match(/runs-on:/g) || []).length !== 1) {
    reasons.push('workflow must have exactly one GitHub-hosted job');
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

function evaluatePrWorkflows(dir) {
  const reasons = [];
  const files = listWorkflowFiles(dir);
  if (!files.length) {
    return { ok: false, reasons: ['PR head has no GitHub workflow files — the trusted gate would be deleted'] };
  }
  if (files.length !== 1 || files[0] !== REQUIRED_FILE) {
    reasons.push(
      `PR head must contain only ${REQUIRED_FILE}, not a self-authored or extra workflow (found: ${files.join(', ') || 'none'})`
    );
  }
  const target = path.join(dir, REQUIRED_FILE);
  if (!fs.existsSync(target)) {
    reasons.push(`PR head is missing ${REQUIRED_FILE}`);
    return { ok: false, reasons };
  }
  const evaluated = evaluateWorkflowText(fs.readFileSync(target, 'utf8'), REQUIRED_FILE);
  reasons.push(...evaluated.reasons);
  return { ok: reasons.length === 0, reasons, files };
}

function main(argv) {
  const command = argv[2];
  if (command !== 'evaluate-pr' || !argv[3]) {
    process.stderr.write('usage: node scripts/atlas-ci-gate.js evaluate-pr <workflows-dir>\n');
    process.exit(2);
  }
  const result = evaluatePrWorkflows(argv[3]);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main(process.argv);

module.exports = {
  evaluatePrWorkflows,
  evaluateWorkflowText,
  workflowEvents,
};
