'use strict';
/* Gate for Codex → Cursor repair. `node scripts/atlas-cursor-repair-gate.js`
 *
 * This is the sole authority for who may start a repair, whether the reviewed
 * SHA is still the PR head, and whether another automated round is allowed.
 * The GitHub workflow calls it from a default-branch checkout. It never talks
 * to the network and never reads secrets.
 *
 * CLI:
 *   evaluate <request.json>  → result JSON; exit 0 proceed, 2 skip, 1 error
 *   prompt   <request.json>  → repair prompt on stdout
 */

const fs = require('fs');
const path = require('path');

const MAX_ROUNDS = 3;
const STATE_MARKER = '<!-- atlas-cursor-repair-state -->';
const CODEX_LOGINS = Object.freeze([
  'chatgpt-codex-connector[bot]',
  'chatgpt-codex-connector',
]);
const DENIED_GIT_VERBS = Object.freeze([
  'push',
  'merge',
  'rebase',
  'cherry-pick',
  'reset',
  'commit',
]);

function normalizeLogin(login) {
  return String(login || '').trim().toLowerCase();
}

function isGenuineCodexReviewer(login) {
  const normalized = normalizeLogin(login);
  return CODEX_LOGINS.some((allowed) => allowed.toLowerCase() === normalized);
}

function isOpenPrTargetingMain(pr) {
  return Boolean(
    pr
    && pr.state === 'open'
    && pr.base
    && pr.base.ref === 'main'
    && pr.head
    && pr.head.sha
    && pr.head.ref,
  );
}

function isExactCurrentHead(reviewedSha, currentHeadSha) {
  const reviewed = String(reviewedSha || '').trim().toLowerCase();
  const current = String(currentHeadSha || '').trim().toLowerCase();
  return Boolean(reviewed) && reviewed === current;
}

function assertHeadsStillGated(gatedSha, localSha, remoteSha) {
  if (!isExactCurrentHead(gatedSha, localSha) || !isExactCurrentHead(gatedSha, remoteSha)) {
    return {
      ok: false,
      code: 'head-moved',
      mutate: false,
      reason: 'PR head moved after the gate. Fail closed without mutation.',
    };
  }
  return { ok: true, code: 'ok', mutate: true };
}

function parseRepairState(commentBodies) {
  const bodies = Array.isArray(commentBodies) ? commentBodies : [];
  for (let index = bodies.length - 1; index >= 0; index -= 1) {
    const body = String(bodies[index] || '');
    const markerAt = body.indexOf(STATE_MARKER);
    if (markerAt < 0) continue;
    const after = body.slice(markerAt + STATE_MARKER.length);
    const jsonMatch = after.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) continue;
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const rounds = Number(parsed.rounds);
      return {
        rounds: Number.isFinite(rounds) && rounds > 0 ? Math.floor(rounds) : 0,
        last_reviewed_sha: parsed.last_reviewed_sha ? String(parsed.last_reviewed_sha) : '',
        last_repair_sha: parsed.last_repair_sha ? String(parsed.last_repair_sha) : '',
        review_id: parsed.review_id != null ? String(parsed.review_id) : '',
      };
    } catch {
      continue;
    }
  }
  return {
    rounds: 0,
    last_reviewed_sha: '',
    last_repair_sha: '',
    review_id: '',
  };
}

function serializeRepairState(state) {
  return `${STATE_MARKER}\n${JSON.stringify({
    rounds: state.rounds,
    last_reviewed_sha: state.last_reviewed_sha,
    last_repair_sha: state.last_repair_sha,
    review_id: state.review_id || '',
  })}\n`;
}

function canStartRound(state) {
  return Number(state && state.rounds) < MAX_ROUNDS;
}

function codexFindingTexts(input) {
  const comments = Array.isArray(input.reviewComments) ? input.reviewComments : [];
  const fromComments = comments
    .filter((comment) => isGenuineCodexReviewer(comment && comment.user && comment.user.login))
    .map((comment) => String(comment.body || '').trim())
    .filter(Boolean);
  if (fromComments.length) return fromComments;
  const body = String(input.reviewBody || '').trim();
  if (body && isGenuineCodexReviewer(input.reviewerLogin)) return [body];
  return [];
}

function hasCodexFindings(input) {
  return codexFindingTexts(input).length > 0;
}

function evaluateRepairRequest(input) {
  const state = parseRepairState(input && input.stateComments);
  if (!isGenuineCodexReviewer(input && input.reviewerLogin)) {
    return { ok: false, code: 'not-codex-reviewer', reason: 'Reviewer is not the Codex connector.', state };
  }
  if (!isOpenPrTargetingMain(input && input.pr)) {
    const pr = input && input.pr;
    if (!pr || pr.state !== 'open') {
      return { ok: false, code: 'pr-not-open', reason: 'Pull request is not open.', state };
    }
    return { ok: false, code: 'pr-not-targeting-main', reason: 'Pull request does not target main.', state };
  }
  if (!isExactCurrentHead(input.reviewedSha, input.currentHeadSha || input.pr.head.sha)) {
    return { ok: false, code: 'stale-head', reason: 'Reviewed SHA is not the current PR head.', state };
  }
  if (!hasCodexFindings(input)) {
    return { ok: false, code: 'no-findings', reason: 'Codex review has no findings to repair.', state };
  }
  if (state.last_reviewed_sha
    && isExactCurrentHead(state.last_reviewed_sha, input.reviewedSha)) {
    return { ok: false, code: 'already-repaired-this-head', reason: 'This reviewed head was already repaired.', state };
  }
  if (!canStartRound(state)) {
    return {
      ok: false,
      code: 'round-cap',
      reason: `Automated Cursor repair is capped at ${MAX_ROUNDS} rounds per PR.`,
      state,
    };
  }
  return {
    ok: true,
    code: 'ok',
    reason: 'Eligible Codex finding on the current head.',
    state,
    nextRound: state.rounds + 1,
  };
}

function buildRepairPrompt(input) {
  const findings = codexFindingTexts(input);
  const head = input.currentHeadSha || (input.pr && input.pr.head && input.pr.head.sha) || '';
  const number = input.pr && input.pr.number;
  return [
    'Read AGENTS.md and CLAUDE.md first. Follow those briefs.',
    '',
    `You are repairing pull request #${number} at exact current head ${head}.`,
    '',
    'Fix only the genuine Codex review findings below.',
    'Do not expand scope. Do not start a second outcome. Do not add features, refactors, or drive-by cleanup.',
    '',
    'Edit files only.',
    'Do not run git commit, git push, git merge, or git rebase.',
    'Do not mutate the pull request, post GitHub comments, or orchestrate GitHub workflows.',
    'Do not use gh. Deterministic workflow steps own checkout, tests, commit, push, and PR state.',
    '',
    'Codex findings:',
    ...findings.map((finding, index) => `${index + 1}. ${finding}`),
  ].join('\n');
}

function deniedGitVerb(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return args.find((arg) => DENIED_GIT_VERBS.includes(String(arg)));
}

function readJsonArg(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function main(argv) {
  const command = argv[2];
  if (command === 'evaluate') {
    const request = readJsonArg(argv[3]);
    const result = evaluateRepairRequest(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.ok) return 0;
    return 2;
  }
  if (command === 'prompt') {
    const request = readJsonArg(argv[3]);
    process.stdout.write(`${buildRepairPrompt(request)}\n`);
    return 0;
  }
  if (command === 'deny-git') {
    const verb = deniedGitVerb(argv.slice(3));
    if (verb) {
      process.stderr.write(`atlas-cursor-repair: git ${verb} is disabled for Cursor\n`);
      return 126;
    }
    return 0;
  }
  if (command === 'assert-head') {
    const result = assertHeadsStillGated(argv[3], argv[4], argv[5]);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.ok) return 0;
    process.stderr.write(`${result.reason}\n`);
    return 1;
  }
  process.stderr.write('usage: atlas-cursor-repair-gate.js evaluate|prompt|deny-git|assert-head\n');
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  MAX_ROUNDS,
  STATE_MARKER,
  CODEX_LOGINS,
  DENIED_GIT_VERBS,
  isGenuineCodexReviewer,
  isOpenPrTargetingMain,
  isExactCurrentHead,
  parseRepairState,
  serializeRepairState,
  canStartRound,
  hasCodexFindings,
  evaluateRepairRequest,
  buildRepairPrompt,
  deniedGitVerb,
  assertHeadsStillGated,
};
