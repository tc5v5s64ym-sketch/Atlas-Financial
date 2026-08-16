'use strict';

/* Mechanical coverage for .github/workflows/merge-card-check.yml.
 * The suite executes the workflow's real inline script. It proves the check
 * catches missing fields, invalid closed forms, stale reviewed heads, wrong
 * reviewer identity, and a non-passing required review. It also proves the
 * check reads the live PR body, not the workflow event body, and fails closed
 * when the live PR is closed, retargeted, or no longer the event head. A
 * workflow_dispatch run with explicit PR number and expected head SHA uses
 * that same live validation and fails closed on mismatch. A default-branch
 * dispatch for a predating PR head records the required check on the
 * expected head. It deliberately does not test the meaning of prose.
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

async function validate(body, head = HEAD, files = ['docs/status.md'], options = {}) {
  let failure = '';
  const core = {
    setFailed(message) { failure = String(message); },
    info() {},
  };
  const eventNumber = options.eventNumber != null ? options.eventNumber : 1;
  const eventHead = options.eventHead || head;
  const eventBody = Object.prototype.hasOwnProperty.call(options, 'eventBody')
    ? options.eventBody
    : body;
  const livePr = {
    number: options.liveNumber != null ? options.liveNumber : eventNumber,
    state: options.state != null ? options.state : 'open',
    merged: options.merged === true,
    body,
    base: {
      ref: options.baseRef != null ? options.baseRef : 'main',
      repo: { full_name: options.liveRepo || 'owner/repo' },
    },
    head: {
      sha: options.liveHead || head,
      repo: { full_name: options.liveHeadRepo || 'owner/repo' },
    },
  };
  const eventName = options.eventName || 'pull_request';
  const context = {
    eventName,
    sha: options.runSha != null ? options.runSha : eventHead,
    ref: options.ref || '',
    repo: { owner: 'owner', repo: 'repo' },
    payload: eventName === 'workflow_dispatch'
      ? {
        inputs: {
          pr_number: Object.prototype.hasOwnProperty.call(options, 'dispatchPr')
            ? options.dispatchPr
            : eventNumber,
          expected_head_sha: Object.prototype.hasOwnProperty.call(options, 'dispatchHead')
            ? options.dispatchHead
            : eventHead,
        },
        repository: { default_branch: options.defaultBranch || '' },
      }
      : {
        pull_request: { number: eventNumber, body: eventBody, head: { sha: eventHead } },
      },
  };
  const createdChecks = options.createdChecks || [];
  const github = {
    rest: {
      pulls: {
        listFiles() {},
        async get() {
          return { data: livePr };
        },
      },
      checks: {
        async create(params) {
          createdChecks.push(params);
          if (options.checkCreateError) {
            throw new Error(options.checkCreateError);
          }
          return { data: { id: 1 } };
        },
      },
    },
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
green('Primary risk may carry an explanation after the closed value', card({
  fields: { 'Primary risk': 'auto-safe — no published figure moves' },
}));

const required = {
  Required: 'REQUIRED — review machinery changed',
  'Exact reviewed head': HEAD,
  Reviewer: 'ChatGPT',
  'Review outcome': 'PASS',
  'Findings and fix verification': 'No blockers remain on this exact head',
};
green('a passing required review on the exact head passes', card({ review: required }));
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    runSha: 'd'.repeat(40),
  });
  ok(!message, 'pull_request still validates the event head, not github.sha', message);
})());
checks.push((async () => {
  const staleEventBody = card({ review: { ...required, 'Review outcome': 'NOT PASS' } });
  const livePassBody = card({ review: required });
  const message = await validate(livePassBody, HEAD, ['docs/status.md'], {
    eventBody: staleEventBody,
  });
  ok(!message, 'stale event body NOT PASS + live body PASS on the same head succeeds', message);
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    liveHead: 'b'.repeat(40),
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /live head/i.test(message),
    'a moved live head fails closed',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    state: 'closed',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /not open/i.test(message),
    'a closed PR fails closed',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    baseRef: 'other',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /not main/i.test(message),
    'a base-changed PR fails closed',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    liveNumber: 99,
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /live PR 99/i.test(message),
    'a live PR number mismatch fails closed',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    liveRepo: 'other/repo',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /live repository/i.test(message),
    'a live repository mismatch fails closed',
    message || 'unexpected green',
  );
})());
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
} }), /Awaiting exact-head Atlas review/i);
red('Primary risk uses the closed vocabulary', card({ fields: {
  'Primary risk': 'probably-fine',
} }), /Primary risk.*must open/i);
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

checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
  });
  ok(!message, 'workflow_dispatch with matching live PR/head and PASS card succeeds', message);
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
    liveHead: 'b'.repeat(40),
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /live head/i.test(message),
    'workflow_dispatch fails closed when the live head moved',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /workflow run SHA/i.test(message),
    'workflow_dispatch fails closed when the run SHA is not the expected head',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const createdChecks = [];
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
    ref: 'refs/heads/evil',
    defaultBranch: 'main',
    createdChecks,
  });
  ok(
    Boolean(message) && /workflow run SHA/i.test(message) && createdChecks.length === 0,
    'workflow_dispatch from a non-default ref still fails closed when the run SHA is not the expected head',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const createdChecks = [];
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
    ref: 'refs/heads/main',
    defaultBranch: 'main',
    createdChecks,
  });
  ok(
    !message
      && createdChecks.length === 1
      && createdChecks[0].name === 'Merge card mechanical fields'
      && createdChecks[0].head_sha === HEAD
      && createdChecks[0].conclusion === 'success',
    'default-branch dispatch records the required check on the expected head',
    message || JSON.stringify(createdChecks[0] || {}),
  );
})());
checks.push((async () => {
  const createdChecks = [];
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
    createdChecks,
  });
  ok(
    !message && createdChecks.length === 0,
    'PR-head dispatch still uses the Actions job check, not a synthetic check run',
    message || `checks=${createdChecks.length}`,
  );
})());
checks.push((async () => {
  const createdChecks = [];
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
    ref: 'refs/heads/main',
    defaultBranch: 'main',
    liveHead: 'b'.repeat(40),
    createdChecks,
  });
  ok(
    Boolean(message) && /live head/i.test(message) && createdChecks.length === 0,
    'default-branch dispatch does not record a check when the live head moved',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const createdChecks = [];
  const message = await validate(card({ omitField: 'Tests' }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
    ref: 'refs/heads/main',
    defaultBranch: 'main',
    createdChecks,
  });
  ok(
    Boolean(message)
      && /Tests/.test(message)
      && createdChecks.length === 1
      && createdChecks[0].head_sha === HEAD
      && createdChecks[0].conclusion === 'failure'
      && createdChecks[0].name === 'Merge card mechanical fields',
    'default-branch dispatch records a failing required check on the expected head',
    message || JSON.stringify(createdChecks[0] || {}),
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: 'c'.repeat(40),
    ref: 'refs/heads/main',
    defaultBranch: 'main',
    checkCreateError: 'api down',
    createdChecks: [],
  });
  ok(
    Boolean(message) && /required check on the expected head/i.test(message),
    'default-branch dispatch fails closed when the required check cannot be recorded',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
    dispatchHead: 'not-a-sha',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /expected head SHA/i.test(message),
    'workflow_dispatch fails closed without a 40-character expected head SHA',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
    dispatchPr: 'not-a-number',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /pull request/i.test(message),
    'workflow_dispatch fails closed without a PR number',
    message || 'unexpected green',
  );
})());
checks.push((async () => {
  const staleEventBody = card({ review: { ...required, 'Review outcome': 'NOT PASS' } });
  const livePassBody = card({ review: required });
  const message = await validate(livePassBody, HEAD, ['docs/status.md'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
    eventBody: staleEventBody,
  });
  ok(!message, 'workflow_dispatch still reads the live PASS card, not a stale event body', message);
})());
checks.push((async () => {
  const message = await validate(card({ review: required }), HEAD, ['docs/status.md'], {
    eventName: 'issue_comment',
  });
  ok(
    Boolean(message) && /failed closed/i.test(message) && /unsupported event/i.test(message),
    'an unsupported event fails closed',
    message || 'unexpected green',
  );
})());

checks.push((async () => {
  const atlas = require('./scripts/atlas-review-block');
  const livePass = card({
    review: {
      Required: 'REQUIRED — review machinery changed',
      'Exact reviewed head': HEAD,
      Reviewer: 'ChatGPT',
      'Review outcome': 'PASS',
      'Findings and fix verification': atlas.PASS_FINDINGS,
    },
  });
  const message = await validate(livePass, HEAD, ['.github/workflows/merge-card-check.yml'], {
    eventName: 'workflow_dispatch',
    runSha: HEAD,
  });
  ok(
    !message,
    '#55 sequence: trusted PASS card on the current live head validates via workflow_dispatch',
    message,
  );
})());

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
