'use strict';
/* Mechanical coverage for scripts/atlas-review-provenance.js.
 * `node test/test-atlas-review-provenance.js`
 *
 * Proves the Systems Review provenance hardening: a REQUIRED card claiming
 * PASS is merge-authorizing only with a mechanically valid provenance path
 * on the live exact head — Path A (trusted direct GitHub PR review) or
 * Path B (validated owner-authorized transcription). Every failure carries
 * a fail-closed message with remediation.
 */

const provenance = require('../scripts/atlas-review-provenance');
const block = require('../scripts/atlas-review-block');

let failures = 0;

function ok(cond, label, detail = '') {
  if (!cond) failures += 1;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
}

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const TRUSTED = 'tc5v5s64ym-sketch';

function pr(headSha = HEAD) {
  return { state: 'open', merged: false, baseRef: 'main', headSha };
}

function card(overrides = {}) {
  return {
    Required: 'REQUIRED — review machinery changed',
    'Exact reviewed head': HEAD,
    Reviewer: 'ChatGPT',
    'Review outcome': 'PASS',
    'Findings and fix verification': 'x',
    ...overrides,
  };
}

function review(overrides = {}) {
  return {
    id: 1,
    state: 'APPROVED',
    commit_id: HEAD,
    submitted_at: '2026-09-27T10:00:00Z',
    user: { login: TRUSTED },
    body: 'Atlas Contract / Systems Review — PASS\n\nExact reviewed head.',
    ...overrides,
  };
}

function bodyWithTranscript(transcript) {
  return [
    '## Atlas Merge Card',
    '',
    '### Atlas Contract / Systems Review',
    '',
    '- **Required**: REQUIRED',
    '- **Exact reviewed head**: ' + HEAD,
    '- **Reviewer**: ChatGPT',
    '- **Review outcome**: PASS',
    transcript ? '' : null,
    transcript || null,
  ].filter((line) => line !== null).join('\n');
}

function transcript(head = HEAD, overrides = {}) {
  const fields = {
    reviewer: 'ChatGPT',
    verdict: 'PASS',
    head,
    mode: 'owner-authorized-transcription',
    ...overrides,
  };
  return [
    'ATLAS_SYSTEMS_REVIEW_TRANSCRIPT_V1',
    `reviewer: ${fields.reviewer}`,
    `verdict: ${fields.verdict}`,
    `head: ${fields.head}`,
    `mode: ${fields.mode}`,
  ].join('\n');
}

function validate(input) {
  return provenance.validateProvenance({
    pr: pr(),
    reviews: [],
    body: bodyWithTranscript(),
    card: card(),
    ...input,
  });
}

/* ---- DIRECT PATH ---- */

{
  const r = validate({ reviews: [review()] });
  ok(r.ok && r.path === 'direct', '1. trusted PR review PASS on exact commit_id validates Path A', r.message || r.code);
}
{
  const v1 = review({ body: `ATLAS_SYSTEMS_REVIEW_V1\nverdict: PASS\nhead: ${HEAD}\n\nHuman explanation follows.` });
  const r = validate({ reviews: [v1] });
  ok(r.ok && r.path === 'direct', '1b. machine-readable V1 PASS on exact head validates Path A', r.message || r.code);
}
{
  const r = validate({ reviews: [review({ commit_id: OLD })] });
  ok(!r.ok && r.code === 'no-provenance', '2. trusted PASS on stale SHA fails', r.message);
  ok(/no trusted current-head PR review or valid transcription/.test(r.message), '2b. stale-SHA failure names the remediation', r.message);
}
{
  const r = validate({ reviews: [review({ user: { login: 'someone-else' } })] });
  ok(!r.ok && r.code === 'no-provenance', '3. untrusted reviewer PASS fails', r.message);
}
{
  // An issue comment carries no commit_id binding to the PR head.
  const comment = { id: 77, user: { login: TRUSTED }, submitted_at: '2026-09-27T10:00:00Z', body: 'Atlas Contract / Systems Review — PASS' };
  const r = validate({ reviews: [comment] });
  ok(!r.ok && r.code === 'no-provenance', '4. issue-comment PASS does not qualify as direct provenance', r.message);
}
{
  const r = validate({
    reviews: [
      review({ id: 1, submitted_at: '2026-09-27T10:00:00Z', body: 'Atlas Contract / Systems Review — PASS' }),
      review({ id: 2, submitted_at: '2026-09-27T11:00:00Z', body: 'Atlas Contract / Systems Review — BLOCKING\n\nBlocker.' }),
    ],
  });
  ok(!r.ok && r.code === 'direct-blocking', '5. PASS then later BLOCKING on same head fails', r.code);
  ok(/later trusted BLOCKING verdict/.test(r.message), '5b. failure message names the BLOCKING verdict', r.message);
}
{
  const r = validate({
    reviews: [
      review({ id: 1, submitted_at: '2026-09-27T10:00:00Z', body: 'Atlas Contract / Systems Review — BLOCKING\n\nBlocker.' }),
      review({ id: 2, submitted_at: '2026-09-27T11:00:00Z', body: 'Atlas Contract / Systems Review — PASS' }),
    ],
  });
  ok(r.ok && r.path === 'direct', '6. BLOCKING then later PASS on same head validates', r.message || r.code);
}
{
  const r = validate({
    reviews: [
      review({ id: 3, submitted_at: '2026-09-27T10:00:00Z', body: 'Atlas Contract / Systems Review — PASS' }),
      review({ id: 9, submitted_at: '2026-09-27T10:00:00Z', body: 'Atlas Contract / Systems Review — BLOCKING\n\nBlocker.' }),
    ],
  });
  ok(!r.ok && r.code === 'direct-blocking', '7. same-timestamp tie-break is deterministic by review ID', r.code);
}
{
  const bad = review({ body: `ATLAS_SYSTEMS_REVIEW_V1\nverdict: MAYBE\nhead: ${HEAD}` });
  const r = validate({ reviews: [bad] });
  ok(!r.ok && r.code === 'no-provenance', '8. malformed machine verdict (non-closed value) fails', r.message);
  const badHead = review({ body: 'ATLAS_SYSTEMS_REVIEW_V1\nverdict: PASS\nhead: abc123' });
  const r2 = validate({ reviews: [badHead] });
  ok(!r2.ok && r2.code === 'no-provenance', '8b. malformed machine verdict (bad SHA) fails', r2.message);
}

/* ---- FALLBACK ---- */

{
  const r = validate({ body: bodyWithTranscript(transcript()) });
  ok(r.ok && r.path === 'transcript', '9. one valid transcript + matching card + current head validates Path B', r.message || r.code);
}
{
  const r = validate({ body: bodyWithTranscript(transcript(OLD)) });
  ok(!r.ok && r.code === 'transcript-stale-head', '10. transcript on stale head fails', r.code);
  ok(/transcript head does not equal current PR head/.test(r.message), '10b. stale-transcript message names remediation', r.message);
}
{
  const r = validate({ body: bodyWithTranscript(transcript('abc123')) });
  ok(!r.ok && r.code === 'malformed-transcript-sha', '11. transcript with malformed SHA fails', r.code);
}
{
  const r = validate({ body: bodyWithTranscript(`${transcript()}\n\n${transcript()}`) });
  ok(!r.ok && r.code === 'duplicate-transcript', '12. duplicate transcript blocks fail', r.code);
  ok(/exactly one transcript/.test(r.message), '12b. duplicate message names remediation', r.message);
}
{
  const r = validate({ body: bodyWithTranscript(transcript(HEAD, { verdict: 'BLOCKING' })) });
  ok(!r.ok && r.code === 'transcript-not-pass', '13. card PASS with transcript verdict BLOCKING fails', r.code);
}
{
  const r = validate({
    body: bodyWithTranscript(transcript()),
    card: card({ 'Exact reviewed head': OLD }),
  });
  ok(!r.ok && r.code === 'transcript-card-head-mismatch', '14. card reviewed SHA differing from transcript fails', r.code);
}
{
  const r = validate({
    reviews: [review({ id: 5, submitted_at: '2026-09-27T12:00:00Z', body: 'Atlas Contract / Systems Review — BLOCKING\n\nBlocker.' })],
    body: bodyWithTranscript(transcript()),
  });
  ok(!r.ok && r.code === 'direct-blocking', '15. transcript PASS plus later direct BLOCKING fails closed', r.code);
}
{
  const r = validate({ body: bodyWithTranscript(transcript(HEAD, { mode: 'ci-inferred' })) });
  ok(!r.ok, '16. transcript cannot manufacture PASS from CI/check state (wrong mode fails)', r.code);
  const r2 = validate({});
  ok(!r2.ok && r2.code === 'no-provenance', '16b. green checks alone are not provenance', r2.code);
}
{
  const r = validate({});
  ok(!r.ok && r.code === 'no-provenance', '17. no direct provenance + no transcript + card PASS fails', r.code);
  ok(/no trusted current-head PR review or valid transcription/.test(r.message), '17b. failure message names what is missing', r.message);
}

/* ---- COMPATIBILITY ---- */

{
  ok(!provenance.provenanceGateApplies(card({ Required: 'NOT REQUIRED — docs only' })),
    '18. NOT REQUIRED card is not subject to the provenance gate');
  const mechanical = validate({ card: card({ Required: 'NOT REQUIRED — docs only', 'Review outcome': 'N/A' }) });
  ok(!mechanical.ok, '18b. gate applicability is decided before validation', mechanical.code);
}
{
  ok(!provenance.provenanceGateApplies(card({ 'Review outcome': 'PENDING' })),
    '19. PENDING outcome keeps documentary behavior (gate not applicable)');
  ok(!provenance.provenanceGateApplies(card({ 'Review outcome': 'BLOCKING' })),
    '19b. BLOCKING outcome keeps documentary behavior (gate not applicable)');
}
{
  const legacy = review({ body: `Atlas Contract / Systems Review — PASS\n\nExact reviewed head: \`${HEAD}\`\n\nFindings.` });
  const r = validate({ reviews: [legacy] });
  ok(r.ok && r.path === 'direct', '20. existing trusted direct PASS synchronization remains intact', r.message || r.code);
  const selected = block.selectCardReview([legacy], HEAD);
  ok(selected && selected.id === legacy.id, '20b. card-sync still selects the trusted exact-head PASS review');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
