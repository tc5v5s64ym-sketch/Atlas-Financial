'use strict';

/* Mechanical coverage for .github/workflows/merge-card-check.yml.
 * The suite executes the workflow's real inline script. It proves the check
 * catches missing fields, invalid closed forms, stale reviewed heads, wrong
 * reviewer identity, and a non-passing required review. It deliberately does
 * not test the meaning of prose.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WORKFLOW = path.join(__dirname, '.github/workflows/merge-card-check.yml');
const HEAD = 'a'.repeat(40);
let passed = 0;
let failed = 0;

function ok(condition, name, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function extractScript() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s+script:\s*\|\s*$/.test(line));
  if (start < 0) throw new Error('merge-card-check.yml has no inline script block');
  const indent = lines[start].match(/^\s*/)[0].length + 2;
  const script = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\s*/)[0].length < indent) break;
    script.push(line.slice(Math.min(indent, line.length)));
  }
  return script.join('\n');
}

const SCRIPT = extractScript();

const FIELDS = {
  Title: 'Simplify review governance',
  'Primary risk': 'auto-safe',
  'Files / categories touched': 'governance only',
  'Current-state verdict': 'STILL BROKEN — owner instruction; checked on current main',
  'Builder surface': 'Codex',
  'Primary builder model': 'GPT-5',
  'Supporting / explore models': 'None',
  'Architecture / dispatch authority': 'ChatGPT',
  'Figures moved': 'none',
  'Reproduced / disproved': 'confirmed against the current workflow',
  'Authority impact': 'CLAUDE.md remains the sole review authority',
  Tests: 'node test-mergecard.js — passing',
  Security: 'unchanged',
  'Advisory review': 'not run',
  'Owner decision required': 'No',
  'Estimated inputs added': 'none',
};

function card({ fields = {}, review = {}, omitField } = {}) {
  const values = { ...FIELDS, ...fields };
  const rows = Object.entries(values)
    .filter(([label]) => label !== omitField)
    .map(([label, value]) => `| **${label}** | ${value} |`);
  const reviewValues = {
    Required: 'NOT REQUIRED — no high-risk trigger fired',
    'Exact reviewed head': 'N/A',
    Reviewer: 'N/A',
    'Review outcome': 'N/A',
    'Findings and fix verification': 'N/A',
    ...review,
  };
  const reviewRows = Object.entries(reviewValues)
    .map(([label, value]) => `- **${label}**: ${value}`);
  return [
    '## 🟦 Atlas Merge Card',
    '',
    '| Field | Value |',
    '|---|---|',
    ...rows,
    '',
    '### Atlas Contract / Systems Review',
    '',
    ...reviewRows,
  ].join('\n');
}

async function validate(body, head = HEAD, files = ['docs/status.md']) {
  let failure = '';
  const core = {
    setFailed(message) { failure = String(message); },
    info() {},
  };
  const context = {
    repo: { owner: 'owner', repo: 'repo' },
    payload: { pull_request: { number: 1, body, head: { sha: head } } },
  };
  const github = {
    rest: { pulls: { listFiles() {} } },
    paginate: async () => files.map((filename) => ({ filename })),
  };
  await vm.runInNewContext(
    `(async () => {\n${SCRIPT}\n})()`,
    { context, core, github },
    { timeout: 1000 },
  );
  return failure;
}

const checks = [];
const green = (name, body, files) => {
  checks.push((async () => {
    const message = await validate(body, HEAD, files);
    ok(!message, name, message);
  })());
};
const red = (name, body, pattern, files) => {
  checks.push((async () => {
    const message = await validate(body, HEAD, files);
    ok(Boolean(message) && (!pattern || pattern.test(message)), name, message || 'unexpected green');
  })());
};

green('a complete NOT REQUIRED card passes for ordinary documentation', card(), ['docs/status.md']);
red('the card heading is required', 'plain PR body', /Atlas Merge Card/);

for (const label of Object.keys(FIELDS)) {
  red(`missing mechanical row: ${label}`, card({ omitField: label }), new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

red('a retained HTML placeholder is blank', card({ fields: { Tests: '<!-- exact command -->' } }), /Tests.*blank/i);
red('the current-state verdict uses a closed opening', card({ fields: { 'Current-state verdict': 'NOT CHECKED' } }), /must open/i);

// Prose meaning is intentionally outside CI. The closed opening is mechanical;
// a reviewer decides whether the rest is honest.
green('later current-state prose is not semantically parsed', card({
  fields: { 'Current-state verdict': 'STILL BROKEN or ALREADY FIXED — reviewer must judge this bad prose' },
}));

const required = {
  Required: 'REQUIRED — review machinery changed',
  'Exact reviewed head': HEAD,
  Reviewer: 'ChatGPT',
  'Review outcome': 'PASS',
  'Findings and fix verification': 'No blockers remain on this exact head',
};
green('a passing required review on the exact head passes', card({ review: required }));
green(
  'a passing required review covers a mechanically high-risk path',
  card({ review: required }),
  ['data.json'],
);
red(
  'a mechanically high-risk path cannot claim NOT REQUIRED',
  card(),
  /mechanically high-risk path/i,
  ['data.json'],
);
red(
  'a hard-gate workflow cannot claim NOT REQUIRED',
  card(),
  /merge-card-check\.yml/i,
  ['.github/workflows/merge-card-check.yml'],
);
red('a required review needs a 40-character SHA', card({ review: {
  ...required, 'Exact reviewed head': 'abc1234',
} }), /40-character SHA/i);
red('a stale required review fails', card({ review: {
  ...required, 'Exact reviewed head': 'b'.repeat(40),
} }), /not the PR head/i);
red('the required lane has one reviewer identity', card({ review: {
  ...required, Reviewer: 'Codex',
} }), /Reviewer: ChatGPT/i);
red('a blocking required review cannot merge', card({ review: {
  ...required, 'Review outcome': 'BLOCKING',
} }), /outcome: PASS/i);
red('a pending required review cannot merge', card({ review: {
  ...required, 'Review outcome': 'PENDING',
} }), /outcome: PASS/i);
red('required-review notes cannot be blank', card({ review: {
  ...required, 'Findings and fix verification': '<!-- notes -->',
} }), /fix verification.*blank/i);
red('an unknown review decision fails closed', card({ review: {
  Required: 'MAYBE',
} }), /REQUIRED or NOT REQUIRED/i);
red('NOT REQUIRED uses N/A for the reviewed head', card({ review: {
  'Exact reviewed head': HEAD,
} }), /Exact reviewed head: N\/A/i);
red('NOT REQUIRED uses N/A for reviewer', card({ review: {
  Reviewer: 'ChatGPT',
} }), /Reviewer: N\/A/i);
red('NOT REQUIRED uses N/A for outcome', card({ review: {
  'Review outcome': 'PASS',
} }), /Review outcome: N\/A/i);

// The gate only requires the notes to exist. It does not inspect negation or
// decide whether every finding was dispositioned.
green('review prose and negation are not semantically parsed', card({ review: {
  ...required,
  'Findings and fix verification': 'P1 was not fixed; this is a reviewer judgement, not a regex target',
} }));

Promise.all(checks)
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
