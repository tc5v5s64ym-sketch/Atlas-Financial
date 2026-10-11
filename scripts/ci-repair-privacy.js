'use strict';
/* Trusted review synchronization stays active. Arbitrary review/prompt/patch
 * artifacts have no private cross-job transport, so automatic repair stops
 * before generating or exporting them. This does not decide review outcomes. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Gate = require('./atlas-cursor-repair-gate');
const Review = require('./atlas-review-block');
const Dispatch = require('./atlas-merge-card-dispatch-ref');
const HOLD_EXIT = 78;
const HOLD_CODE = 'private-artifact-blocked';
const SHA = /^[0-9a-f]{40}$/i;
const HOLD_NOTICE = 'Automated repair withheld: private cross-job artifact transport is unavailable. A local repair and genuine exact-head review remain required.';

function id(value, optional = false) {
  if (optional && (value == null || value === '')) return null;
  if (!/^[1-9][0-9]*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('invalid-public-id');
  return Number(value);
}
function sha(value) {
  if (!SHA.test(String(value || ''))) throw new Error('invalid-public-head');
  return String(value).toLowerCase();
}
function ghApi(route, { method = 'GET', body, paginate = false } = {}) {
  const args = ['api', route, '--method', method];
  if (paginate) args.push('--paginate', '--slurp');
  if (body !== undefined) args.push('--input', '-');
  // Response bodies and CLI error streams stay in memory or captured private
  // diagnostics. Never inherit either stream, or publish a response as data.
  const output = execFileSync('gh', args, { encoding: 'utf8',
    input: body === undefined ? undefined : JSON.stringify(body),
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const result = JSON.parse(output);
  return paginate ? result.flat() : result;
}
function ghDispatch(repo, ref, prNumber, head) {
  execFileSync('gh', ['workflow', 'run', 'merge-card-check.yml', '--repo', repo, '--ref', ref,
    '--field', 'pr_number=' + prNumber, '--field', 'expected_head_sha=' + head],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function result(code, exitCode = 0) { return { code, exitCode }; }
function hold() { return result(HOLD_CODE, HOLD_EXIT); }
function run(mode, env = process.env, services = {}) {
  if (!['codex-review', 'test-failure'].includes(mode)) throw new Error('invalid-repair-mode');
  if (!['workflow_run', 'workflow_dispatch'].includes(env.EVENT_NAME)) throw new Error('invalid-event-source');
  const repo = String(env.GITHUB_REPOSITORY || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('invalid-repository');
  const api = services.api || ghApi;
  const dispatch = services.dispatch || ((ref, number, head) => ghDispatch(repo, ref, number, head));
  const prefix = 'repos/' + repo;
  let number = id(env.EVENT_NAME === 'workflow_dispatch' ? env.DISPATCH_PR : env.RUN_PR, true);
  if (number == null) {
    const candidates = api(prefix + '/commits/' + sha(env.RUN_HEAD) + '/pulls');
    if (!Array.isArray(candidates)) throw new Error('invalid-pull-list');
    if (!candidates.length) return result('no-associated-pr');
    number = id(candidates[0].number);
  }
  const prRoute = prefix + '/pulls/' + number;
  let pr = api(prRoute);
  if (!Gate.isOpenPrTargetingMain(pr)) return result('pr-not-open-main');
  if (id(pr.number) !== number) throw new Error('pr-number-mismatch');
  const head = sha(pr.head.sha);
  if (typeof pr.head.ref !== 'string' || !pr.head.ref) throw new Error('missing-head-ref');
  if (mode === 'test-failure') {
    if (pr.draft === true) return result('draft-pr-skipped');
    // Normal correctness checks remain red when they failed. No log download,
    // prompt, model invocation, artifact, or untested automatic push follows.
    return hold();
  }
  const reviews = api(prRoute + '/reviews', { paginate: true });
  if (!Array.isArray(reviews)) throw new Error('invalid-review-list');
  const requested = id(env.DISPATCH_REVIEW, true);
  const selectedCard = requested == null ? Review.selectCardReview(reviews, head) : { id: requested };
  if (selectedCard) {
    const reviewId = id(selectedCard.id);
    const live = api(prRoute);
    if (sha(live.head && live.head.sha) !== head) throw new Error('head-moved-before-review-validation');
    const review = api(prRoute + '/reviews/' + reviewId);
    const evaluation = Review.evaluateTrustedReview({ source: 'pull_request_review',
      reviewerLogin: review.user && review.user.login, reviewedSha: review.commit_id,
      currentHeadSha: live.head && live.head.sha, reviewBody: review.body || '', pr: live });
    if (evaluation.ok) {
      const patched = Review.patchReviewBlock(live.body || '', evaluation.fields);
      if (!patched.ok) throw new Error('review-block-not-patchable');
      const checked = api(prRoute);
      if (!Gate.isOpenPrTargetingMain(checked) || sha(checked.head.sha) !== head
          || checked.body !== live.body) throw new Error('review-write-state-moved');
      api(prRoute, { method: 'PATCH', body: { body: patched.body } });
      if (evaluation.outcome === 'PASS') {
        const after = api(prRoute);
        if (!Gate.isOpenPrTargetingMain(after) || sha(after.head.sha) !== head
            || after.head.ref !== pr.head.ref) throw new Error('head-moved-before-card-dispatch');
        const source = api(prefix + '/contents/.github/workflows/merge-card-check.yml?ref=' + head);
        if (!source || source.encoding !== 'base64' || typeof source.content !== 'string')
          throw new Error('missing-head-workflow');
        const selected = Dispatch.selectDispatchRef(Buffer.from(source.content, 'base64').toString('utf8'),
          after.head.ref, env.DEFAULT_BRANCH);
        if (!selected.ok) throw new Error('card-dispatch-ref-unavailable');
        const final = api(prRoute);
        if (!Gate.isOpenPrTargetingMain(final) || sha(final.head.sha) !== head
            || final.head.ref !== after.head.ref) throw new Error('head-moved-before-card-dispatch');
        dispatch(selected.ref, number, head);
        return result('trusted-pass-recorded');
      }
      pr = live;
    }
  }
  const selected = requested == null ? Gate.selectEligibleReview(reviews, head) : { id: requested };
  if (!selected) return result('no-eligible-review');
  const reviewId = id(selected.id);
  const review = api(prRoute + '/reviews/' + reviewId);
  const comments = api(prRoute + '/reviews/' + reviewId + '/comments', { paginate: true });
  const state = api(prefix + '/issues/' + number + '/comments', { paginate: true });
  if (!Array.isArray(comments) || !Array.isArray(state)) throw new Error('invalid-review-comments');
  const live = api(prRoute);
  if (sha(live.head && live.head.sha) !== head) throw new Error('head-moved-before-repair-gate');
  const evaluation = Gate.evaluateRepairRequest({ reviewerLogin: review.user && review.user.login,
    reviewedSha: review.commit_id, currentHeadSha: head, reviewBody: review.body || '', reviewComments: comments,
    stateComments: state.map(row => row.body || ''), pr: live });
  // All genuine repair predicates still run. Eligibility never authorizes
  // plaintext artifact export, a model call, a commit, or a push.
  return evaluation.ok ? hold() : result('repair-not-eligible');
}
function main(argv, env = process.env) {
  try {
    const outcome = run(argv[2], env);
    process.stdout.write(JSON.stringify({ type: 'repair-privacy-status', ...outcome }) + '\n');
    if (outcome.exitCode === HOLD_EXIT) process.stderr.write(HOLD_NOTICE + '\n');
    return outcome.exitCode;
  } catch (error) {
    try {
      const root = env.ATLAS_CI_DIAGNOSTICS_DIR || env.RUNNER_TEMP || os.tmpdir();
      fs.mkdirSync(root, { recursive: true, mode: 0o700 });
      const dir = fs.mkdtempSync(path.join(root, 'atlas-repair-private-'));
      fs.chmodSync(dir, 0o700);
      fs.writeFileSync(path.join(dir, 'error.log'), String(error.stack || error), { mode: 0o600 });
    } catch { /* Diagnostic failure must not publish its original error. */ }
    process.stderr.write('Trusted repair gate failed closed; private diagnostics withheld.\n');
    return 1;
  }
}
if (require.main === module) process.exitCode = main(process.argv);
module.exports = { run, main, HOLD_EXIT, HOLD_CODE, HOLD_NOTICE };
