'use strict';
/* Merge-card check behaviour. `node test-mergecard.js`
 *
 * The gate that decides whether a pull request may merge lives inline in
 * .github/workflows/merge-card-check.yml. Until this file existed, its only
 * proof was a harness in a scratch directory that disappeared with the session
 * that wrote it — so the check was the one gate in this repository with no
 * committed evidence that it works.
 *
 * It has shipped a false green twice, and both were found by running it rather
 * than by reading it:
 *
 *   1. a pending review whose line quoted the head SHA in its own prose — the
 *      SHA won over the sentence around it;
 *   2. the same hole one field over — pre-fill the SHA, leave
 *      `Reviewer: ChatGPT, pending`, and the card went green while saying in
 *      plain words that the required review was unfinished.
 *
 * Both are cases below. Neither would have been caught by reading the diff.
 *
 * This runs the REAL workflow source: the `script:` body is extracted from the
 * YAML and executed against fixtures with a stubbed `core` and `context`. A
 * copy of the implementation would prove only that the copy still works.
 *
 * The last section mutates that source — reverting each pending-marker
 * protection in turn — and proves the cases above actually catch the
 * reversion. A guard nothing would notice the loss of is not a guard.
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const WORKFLOW = path.join(__dirname, '.github/workflows/merge-card-check.yml');
const TEMPLATE = path.join(__dirname, '.github/PULL_REQUEST_TEMPLATE.md');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// The head every fixture is written against. Any 40-hex string would do; this
// one is a real commit on this branch so the fixtures read like a real card.
const HEAD = 'b85274ce33e53c01352bd54950b37f8940451620';
const OTHER = 'ab8c8700000000000000000000000000000000ff';

/* ------------------------------------------------------------------ source */

// Pull the inline `script: |` body out of the workflow and de-indent it.
// Deliberately not a YAML parse: the point is to execute exactly the text
// GitHub executes, and a parser that "helpfully" normalised it would weaken
// that. Blank lines keep their place so reported line numbers stay useful.
function extractScript() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex(l => /^\s*script:\s*\|\s*$/.test(l));
  if (start < 0) throw new Error('merge-card-check.yml carries no inline `script: |` block');
  const indent = lines[start + 1].match(/^ */)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { body.push(''); continue; }
    if (lines[i].match(/^ */)[0].length < indent) break;
    body.push(lines[i].slice(indent));
  }
  return body.join('\n');
}

// Run a check source against a PR body. Returns { green, problems }.
async function run(source, body, headSha = HEAD) {
  const problems = [];
  let failed = null;
  const core = {
    setFailed: m => { failed = m; },
    info: () => {},
    summary: {
      addHeading() { return this; },
      addList(items) { problems.push(...items); return this; },
      addRaw() { return this; },
      async write() {},
    },
  };
  const context = {
    payload: { pull_request: { body, head: { sha: headSha } } },
    repo: { owner: 'tc5v5s64ym-sketch', repo: 'Atlas-Financial' },
  };
  await new AsyncFunction('core', 'context', 'github', source)(core, context, {});
  return { green: failed === null, problems };
}

/* ---------------------------------------------------------------- fixtures */

// Every row the check requires, with a real answer. A case overrides only what
// it is about, so a fixture never fails for a reason its name does not mention.
const ROWS = {
  'Title': 'A change to the published figures',
  'Primary risk': 'auto-safe',
  'Files / categories touched': 'public/forecast.js, data.json',
  'Current-state verdict': 'B70 · STILL BROKEN — reproduced on main at ce9c7fa',
  'Builder surface': 'Claude Code',
  'Primary builder model': 'the surface withholds its model identity',
  'Supporting / explore models': 'None',
  'Architecture / dispatch authority': 'ChatGPT',
  'Figures moved': 'none',
  'Reproduced / disproved': 'reproduced on main before the fix',
  'Authority impact': 'none',
  'Tests': '`npm test` — 6 suites, all passing',
  'Security': 'unchanged',
  'Advisory review': 'none raised',
  'Owner decision required': 'No',
  'Estimated inputs added': 'none',
};

const PROSE = {
  'What changed': 'The recovery path no longer replays the first payday.',
  'Why the numbers are right': 'Confirmed by a brute-force ledger with its own day loop.',
  'What this does NOT do': 'It does not couple variable spending to card balances.',
  'Known uncertainty': 'The breach date could move by about a week.',
};

const REVIEW = {
  'Required': 'required — touches the engine',
  'Exact reviewed head': HEAD,
  'Reviewer': 'ChatGPT',
  'Findings and dispositions': 'none',
};

// Build a body. `over` replaces row/review values; a value of null drops the
// line entirely, which is how "row missing" differs from "row blank".
function card({ rows = {}, review = {}, findings = '- None', dropReview = false,
                dropFindings = false } = {}) {
  const r = { ...ROWS, ...rows };
  const v = { ...REVIEW, ...review };
  const out = ['## 🟦 Atlas Merge Card', '', '| Field | Value |', '|---|---|'];
  for (const [k, val] of Object.entries(r)) if (val !== null) out.push(`| **${k}** | ${val} |`);
  out.push('');
  for (const [h, text] of Object.entries(PROSE)) out.push(`### ${h}`, '', text, '');
  if (!dropReview) {
    out.push('### Atlas Contract / Systems Review', '');
    for (const [k, val] of Object.entries(v)) if (val !== null) out.push(`- **${k}**: ${val}`);
    out.push('');
  }
  if (!dropFindings) out.push('### Additional findings', '', findings, '');
  return out.join('\n');
}

/* ------------------------------------------------------------------- cases */

// Named exactly as the contract states them, because these names are what a
// future reader compares against CLAUDE.md.
const CASES = [
  // --- the card exists and is filled
  ['the untouched template', fs.readFileSync(TEMPLATE, 'utf8'), 'red'],
  ['a fully completed card', card(), 'green'],
  ['a prose section left as its template comment',
    card().replace('The recovery path no longer replays the first payday.', '<!-- todo -->'), 'red'],

  // --- attribution (CLAUDE.md: None is for supporting models alone)
  ['Builder surface: None', card({ rows: { 'Builder surface': 'None' } }), 'red'],
  ['Primary builder model: None', card({ rows: { 'Primary builder model': 'None' } }), 'red'],
  ['Architecture / dispatch authority: None',
    card({ rows: { 'Architecture / dispatch authority': 'None' } }), 'red'],
  ['Supporting / explore models: None', card({ rows: { 'Supporting / explore models': 'None' } }), 'green'],
  ['a withheld model identity is a real answer',
    card({ rows: { 'Primary builder model': 'the surface withholds its model identity' } }), 'green'],
  ['an attribution row deleted', card({ rows: { 'Primary builder model': null } }), 'red'],
  ['an attribution row left blank', card({ rows: { 'Builder surface': '' } }), 'red'],

  // --- current-state verdict
  ['the current-state verdict blank', card({ rows: { 'Current-state verdict': '' } }), 'red'],

  // --- the required review lane
  ['the review block missing entirely', card({ dropReview: true }), 'red'],
  ['a review-block line missing', card({ review: { 'Reviewer': null } }), 'red'],
  ['a review-block line blank', card({ review: { 'Findings and dispositions': '' } }), 'red'],
  ['required, with no SHA', card({ review: { 'Exact reviewed head': 'n/a' } }), 'red'],
  ['required, with a stale SHA', card({ review: { 'Exact reviewed head': OTHER } }), 'red'],
  ['required, with the current SHA and every field complete', card(), 'green'],
  ['required, with no reviewer named', card({ review: { 'Reviewer': 'n/a' } }), 'red'],
  ['not required, with a reason and n/a fields', card({ review: {
    'Required': 'not required — documentation only, no trigger fired',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'green'],
  ['not required, so even a stale SHA is nobody\'s business', card({ review: {
    'Required': 'not required — no trigger fired', 'Exact reviewed head': OTHER,
  } }), 'green'],

  // --- the required/not-required classifier reads the OPENING of the field
  //     only. Matching "not required" anywhere let a line that began by
  //     declaring the review required disable the whole gate with its own
  //     explanatory prose.
  ['a required line whose prose later says "not required", with no review', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],
  ['the same required wording, with a stale SHA', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': OTHER,
  } }), 'red'],
  ['the same required wording, complete on the current head', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': HEAD, 'Reviewer': 'ChatGPT', 'Findings and dispositions': 'one P1, fixed',
  } }), 'green'],
  ['an opening that is neither, and means required', card({ review: {
    'Required': 'No trigger fired for the engine, but the review machinery changed, so it is required',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],
  ['"n/a" still opens the not-required path', card({ review: {
    'Required': 'n/a — no trigger fired', 'Exact reviewed head': 'n/a',
    'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'green'],

  // --- pending markers: the two false greens this check has actually shipped
  ['a pending review whose line quotes the head SHA', card({ review: {
    'Exact reviewed head': `not yet performed — record \`${HEAD}\` once it has been read`,
  } }), 'red'],
  ['a bare "pending" with no SHA at all',
    card({ review: { 'Exact reviewed head': 'pending' } }), 'red'],
  ['the correct SHA, but Reviewer: ChatGPT, pending',
    card({ review: { 'Reviewer': 'ChatGPT, pending' } }), 'red'],
  ['the correct SHA, but Reviewer: awaiting ChatGPT',
    card({ review: { 'Reviewer': 'awaiting ChatGPT' } }), 'red'],
  ['the correct SHA, but dispositions pending', card({ review: {
    'Findings and dispositions': 'three raised, dispositions pending',
  } }), 'red'],
  ['the correct SHA, but findings "none yet"',
    card({ review: { 'Findings and dispositions': 'none yet' } }), 'red'],

  // --- ...and the honest phrasings the markers must NOT catch. A finding can
  //     be completely dispositioned and still describe something that waits.
  ['a finding routed to the backlog, awaiting an owner answer', card({ review: {
    'Findings and dispositions': "one fixed; one routed to BACKLOG B72, awaiting the owner's answer on B70",
  } }), 'green'],
  ['an outstanding question named inside a disposition', card({ review: {
    'Findings and dispositions': 'two fixed, one non-issue — the outstanding HELOC limit question is unrelated',
  } }), 'green'],

  // --- finding disposition
  ['the findings block missing entirely', card({ dropFindings: true }), 'red'],
  ['a findings block with no allowed disposition', card({ findings: '- nothing to report' }), 'red'],
  ['FIXED NOW', card({ findings: '- FIXED NOW: the epsilon on the buffer comparison' }), 'green'],
  ['REJECTED', card({ findings: '- REJECTED: speculative, no evidence' }), 'green'],
  ['ADDED TO BACKLOG', card({ findings: '- ADDED TO BACKLOG: B72, the Triangle over-limit window' }), 'green'],
  ['OWNER DECISION REQUIRED', card({ findings: '- OWNER DECISION REQUIRED: what TD does at the limit' }), 'green'],
];

/* ------------------------------------------------------------- the mutants */

// Each reverts one pending-marker protection to the shape that shipped a false
// green. `apply` must find its target — a mutation that silently no-ops would
// "prove" the guard is load-bearing while testing nothing.
const MUTANTS = [
  {
    name: 'the multi-field guard reverted to head-only (the shape Codex found)',
    apply: src => src
      .replace(/^\s*\['Reviewer', PENDING\],\n/m, '')
      .replace(/^\s*\['Findings and dispositions', DISPOSITIONS_PENDING\],\n/m, ''),
  },
  {
    name: 'the pending markers defanged entirely (the first false green)',
    apply: src => src
      .replace(/const PENDING = \/.*\/i;/, 'const PENDING = /(?!)/;')
      .replace(/const DISPOSITIONS_PENDING = \/.*\/i;/, 'const DISPOSITIONS_PENDING = /(?!)/;'),
  },
  {
    name: 'the anchored required/not-required classifier weakened back to an anywhere match',
    apply: src => src.replace(
      /const notRequired = \/\^\(\?:not\[ \\t\]\+required\|n\\\/a\)\\b\/i\.test\(req\);/,
      'const notRequired = /\\bnot[ \\t]+required\\b/i.test(req) || /^(no|none|n\\/a)\\b/i.test(req);'),
  },
];

/* --------------------------------------------------------------------- run */

(async () => {
  console.log('=== the workflow source is readable and runnable ===');
  let SCRIPT = '';
  try {
    SCRIPT = extractScript();
    ok(SCRIPT.length > 0, 'the inline script block extracts from the workflow YAML',
      `${SCRIPT.split('\n').length} lines`);
  } catch (e) {
    ok(false, 'the inline script block extracts from the workflow YAML', e.message);
    process.exit(1);
  }
  ok(/Atlas Contract \/ Systems Review/.test(SCRIPT),
    'and it is the source that guards the required review lane');

  console.log('\n=== the real check, against every case ===');
  for (const [name, body, expect] of CASES) {
    let got = null, detail = '';
    try {
      const r = await run(SCRIPT, body);
      got = r.green ? 'green' : 'red';
      if (got !== expect) detail = r.problems.join(' | ').slice(0, 160) || '(no problem reported)';
    } catch (e) {
      got = 'threw';
      detail = e.message;
    }
    ok(got === expect, `${name} → ${expect}`, got === expect ? '' : `got ${got}. ${detail}`);
  }

  console.log('\n=== reverting a pending-marker protection breaks these cases ===');
  // The proof that the cases above are load-bearing rather than decorative: if
  // someone removes a guard, at least one committed expectation must go red.
  for (const mutant of MUTANTS) {
    const mutated = mutant.apply(SCRIPT);
    const applied = mutated !== SCRIPT;
    ok(applied, `the mutation applies — ${mutant.name}`,
      applied ? '' : 'target text not found, so this mutant proves nothing');
    if (!applied) continue;

    const escaped = [];
    for (const [name, body, expect] of CASES) {
      try {
        const r = await run(mutated, body);
        if ((r.green ? 'green' : 'red') !== expect) escaped.push(name);
      } catch { escaped.push(`${name} (threw)`); }
    }
    ok(escaped.length > 0, 'and the committed cases catch it',
      escaped.length ? `${escaped.length} case(s) flip, first: "${escaped[0]}"` : 'nothing flipped');
  }

  console.log('');
  if (failures) {
    console.log(`\x1b[31m${failures} CHECK${failures === 1 ? '' : 'S'} FAILED\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mALL CHECKS PASSED\x1b[0m');
})();
