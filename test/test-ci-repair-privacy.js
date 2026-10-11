'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const Privacy = require('../scripts/ci-repair-privacy');
const Gate = require('../scripts/atlas-cursor-repair-gate');
const Review = require('../scripts/atlas-review-block');
const ROOT = path.join(__dirname, '..');
const HEAD = 'a'.repeat(40), NEXT = 'b'.repeat(40);
const CANARY = 'CANARY_PRIVATE_REVIEW 947.31 2041-07-09';
const ENV = { GITHUB_REPOSITORY: 'synthetic/fixture', EVENT_NAME: 'workflow_dispatch',
  DISPATCH_PR: '42', DEFAULT_BRANCH: 'main' };
const BODY = 'Synthetic unchanged prose.\n### Atlas Contract / Systems Review\n'
  + '- **Required**: REQUIRED - review machinery\n- **Exact reviewed head**: N/A\n'
  + '- **Reviewer**: N/A\n- **Review outcome**: N/A\n- **Findings and fix verification**: N/A\n'
  + '### Unchanged section\nSynthetic byte-preservation token.\n';
function fixture(options = {}) {
  const pr = { number: 42, state: 'open', draft: options.draft || false,
    body: BODY, base: { ref: 'main' }, head: { sha: HEAD, ref: 'agent/synthetic' }, ...options.pr };
  const review = { id: 9, user: { login: options.login || Gate.TRUSTED_ATLAS_REVIEWER_LOGIN },
    commit_id: options.reviewHead || HEAD, body: options.reviewBody == null
      ? Gate.ATLAS_PASS_MARKER + '\n\n' + CANARY : options.reviewBody,
    submitted_at: '2041-07-09T00:00:00Z' };
  let gets = 0;
  const calls = [], patches = [], dispatches = [];
  const services = { api(route, request = {}) {
    calls.push({ route, request });
    if (options.apiError) throw new Error(CANARY);
    if (/\/commits\//.test(route)) return options.candidates || [{ number: 42 }];
    if (route.endsWith('/pulls/42')) {
      if (request.method === 'PATCH') {
        patches.push(request.body.body); pr.body = request.body.body;
        return { ...pr, arbitrary_response: CANARY };
      }
      gets++;
      const snapshot = JSON.parse(JSON.stringify(pr));
      if (gets === options.moveAt) snapshot.head.sha = NEXT;
      if (gets === options.bodyMoveAt) snapshot.body += 'Concurrent edit';
      return snapshot;
    }
    if (route.endsWith('/reviews')) return options.noReviews ? [] : [review];
    if (route.endsWith('/reviews/9')) return review;
    if (route.endsWith('/reviews/9/comments')) return options.comments || [];
    if (route.endsWith('/issues/42/comments')) return options.state || [];
    if (route.includes('/contents/')) return { encoding: 'base64', content: Buffer.from(
      options.workflow == null ? 'on:\n  workflow_dispatch:\n' : options.workflow).toString('base64') };
    throw new Error('unexpected synthetic API route');
  }, dispatch(...args) { dispatches.push(args); if (options.dispatchError) throw new Error(CANARY); } };
  return { services, calls, patches, dispatches, run(mode = 'codex-review', env = ENV) {
    return Privacy.run(mode, env, services);
  } };
}
function held(f) {
  assert.deepStrictEqual(f.run(), { code: 'private-artifact-blocked', exitCode: 78 });
  assert.strictEqual(f.dispatches.length, 0);
  assert.ok(!f.calls.some(c => /logs|artifacts/.test(c.route)));
}
async function mergeCardCanary(stage) {
  const source = fs.readFileSync(path.join(ROOT, '.github/workflows/merge-card-check.yml'), 'utf8');
  const script = source.split('          script: |')[1].split(/\r?\n/)
    .map(line => line.replace(/^            /, '')).join('\n');
  const annotations = [], writes = [], checkBodies = [];
  const github = { rest: { pulls: { listFiles() {}, get: async () => {
    if (stage === 'fetch') throw new Error(CANARY);
    return { data: { number: 42, state: 'open', body: CANARY,
      head: { sha: HEAD }, base: { ref: 'main', repo: { full_name: 'synthetic/fixture' } } } };
  } }, checks: { create: async body => { checkBodies.push(body);
    if (stage === 'check') throw new Error(CANARY); return { data: { id: 1 } };
  } } }, paginate: async () => { if (stage === 'paginate') throw new Error(CANARY); return []; } };
  const ctx = { require(name) {
    if (name === 'fs') return { writeFileSync: (...args) => writes.push(args) };
    if (stage === 'helper') throw new Error(CANARY);
    return require('../scripts/atlas-primary-risk');
  }, process: { env: { RUNNER_TEMP: 'private', GITHUB_WORKSPACE: ROOT }, cwd: () => ROOT },
  context: { eventName: 'workflow_dispatch', sha: NEXT, ref: 'refs/heads/main',
    repo: { owner: 'synthetic', repo: 'fixture' }, payload: { repository: { default_branch: 'main' },
      inputs: { pr_number: '42', expected_head_sha: HEAD } } },
  core: { setFailed: value => annotations.push(value), info: value => annotations.push(value) }, github };
  await vm.runInNewContext('(async () => {' + script + '\n})()', ctx);
  assert.strictEqual(annotations.length, 1);
  assert.ok(!JSON.stringify({ annotations, checkBodies }).includes(CANARY));
  assert.ok(writes.some(row => String(row[1]).includes(CANARY)), 'API failure is private and retained');
}
(async () => {
  const pass = fixture();
  assert.deepStrictEqual(pass.run(), { code: 'trusted-pass-recorded', exitCode: 0 });
  assert.deepStrictEqual(pass.dispatches, [['agent/synthetic', 42, HEAD]]);
  assert.strictEqual(pass.patches.length, 1);
  assert.ok(!pass.patches[0].includes(CANARY));
  assert.ok(pass.patches[0].includes(Review.PASS_FINDINGS));
  assert.ok(pass.patches[0].endsWith('### Unchanged section\nSynthetic byte-preservation token.\n'));
  const fallback = fixture({ workflow: 'on:\n  pull_request:\n' });
  fallback.run(); assert.deepStrictEqual(fallback.dispatches, [['main', 42, HEAD]]);
  for (const label of ['NOT PASS', 'BLOCKING']) {
    const marker = Gate.ATLAS_BLOCKING_MARKERS.find(value => value.endsWith(label));
    const f = fixture({ reviewBody: marker + '\n\n' + CANARY });
    held(f); assert.strictEqual(f.patches.length, 1);
    assert.ok(f.patches[0].includes('Review outcome**: ' + label));
    assert.ok(f.patches[0].includes('See the submitted exact-head Atlas Contract / Systems Review.'));
    assert.ok(!f.patches[0].includes(CANARY));
  }
  const codex = { login: 'chatgpt-codex-connector[bot]', reviewBody: CANARY };
  for (const draft of [false, true]) {
    const f = fixture({ ...codex, draft }); held(f); assert.strictEqual(f.patches.length, 0);
  }
  for (const options of [{ login: 'untrusted', reviewBody: CANARY }, { reviewHead: NEXT },
    { noReviews: true }, { ...codex, reviewBody: '' }]) {
    const f = fixture(options); assert.strictEqual(f.run().exitCode, 0);
    assert.strictEqual(f.patches.length + f.dispatches.length, 0);
  }
  for (const state of [{ rounds: 3 }, { rounds: 1, last_reviewed_sha: HEAD }]) {
    const f = fixture({ ...codex, state: [{ body: Gate.serializeRepairState(state) }] });
    assert.strictEqual(f.run().code, 'repair-not-eligible');
    assert.strictEqual(f.patches.length + f.dispatches.length, 0);
  }
  for (const options of [{ moveAt: 2 }, { moveAt: 3 }, { bodyMoveAt: 3 }]) {
    const f = fixture(options); assert.throws(() => f.run(), /moved/);
    assert.strictEqual(f.patches.length + f.dispatches.length, 0);
  }
  for (const moveAt of [4, 5]) {
    const after = fixture({ moveAt }); assert.throws(() => after.run(), /moved/);
    assert.strictEqual(after.dispatches.length, 0);
  }
  const failed = fixture(); assert.strictEqual(failed.run('test-failure').exitCode, 78);
  assert.strictEqual(failed.calls.length, 1, 'failed logs and review prompts are never fetched');
  assert.strictEqual(failed.patches.length + failed.dispatches.length, 0);
  assert.strictEqual(fixture({ draft: true }).run('test-failure').code, 'draft-pr-skipped');
  for (const pr of [{ state: 'closed' }, { base: { ref: 'other' } }])
    assert.strictEqual(fixture({ pr }).run().code, 'pr-not-open-main');
  const resolved = fixture({ ...codex }); held({ ...resolved, run: () => resolved.run('codex-review',
    { ...ENV, EVENT_NAME: 'workflow_run', RUN_HEAD: HEAD }) });
  assert.strictEqual(fixture({ candidates: [] }).run('test-failure',
    { ...ENV, EVENT_NAME: 'workflow_run', RUN_HEAD: HEAD }).code, 'no-associated-pr');
  assert.throws(() => fixture().run('codex-review', { ...ENV, EVENT_NAME: CANARY }), /invalid-event-source/);
  assert.throws(() => fixture().run('codex-review', { ...ENV, DISPATCH_PR: CANARY }), /invalid-public-id/);
  for (const file of fs.readdirSync(path.join(ROOT, '.github/workflows')))
    assert.ok(!/upload-artifact|download-artifact/.test(fs.readFileSync(path.join(ROOT, '.github/workflows', file), 'utf8')),
      'no cross-job plaintext artifact export exists: ' + file);
  for (const stage of ['fetch', 'helper', 'paginate', 'check']) await mergeCardCanary(stage);

  // Run the actual gate entry point and actual capture helper in a subprocess.
  // Stub only remote I/O; raw API stdout, stderr, errors and responses contain
  // invented canaries. No token, network, patch, prompt or artifact is needed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-privacy-canary-'));
  const gateFile = path.join(ROOT, 'scripts/ci-repair-privacy.js');
  const programs = [
    'process.env.EVENT_NAME="' + CANARY + '";',
    'const cp=require("child_process");cp.execFileSync=()=>{console.log(' + JSON.stringify(CANARY)
      + ');console.error(' + JSON.stringify(CANARY) + ');throw new Error(' + JSON.stringify(CANARY) + ');};',
    'const cp=require("child_process");cp.execFileSync=()=>{console.log(' + JSON.stringify(CANARY)
      + ');console.error(' + JSON.stringify(CANARY) + ');return ' + JSON.stringify(JSON.stringify(
        { number: 42, state: 'open', draft: false, base: { ref: 'main' }, head: { sha: HEAD, ref: 'synthetic' }, body: CANARY })) + ';};',
  ];
  for (let i = 0; i < programs.length; i++) {
    const code = programs[i] + 'const p=require(' + JSON.stringify(gateFile)
      + ');process.exitCode=p.main(["node","gate","test-failure"]);';
    const child = spawnSync(process.execPath, [path.join(ROOT, 'scripts/ci-output.js'), '--identity',
      'atlas-test-repair-gate', '--', process.execPath, '-e', code],
    { cwd: ROOT, env: { ...process.env, ...ENV, ATLAS_CI_DIAGNOSTICS_DIR: dir }, encoding: 'utf8' });
    assert.strictEqual(child.status, i === 2 ? 78 : 1);
    assert.ok(!child.stdout.includes(CANARY) && !child.stderr.includes(CANARY));
    const record = JSON.parse(child.stdout);
    assert.strictEqual(record.exitCode, child.status);
    assert.strictEqual(record.category, i === 2 ? 'private-artifact-blocked' : 'process-failed');
  }
  console.log('PASS trusted exact-head review, unchanged authority, private API errors/responses, no artifacts, bounded hold and exact exit canaries.');
})().catch(error => { console.error(error); process.exitCode = 1; });
