'use strict';
/* Derive the GitHub primary-risk label from the Merge Card.
 * `node scripts/atlas-primary-risk.js`
 *
 * The Merge Card "Primary risk" row is the authority. The GitHub label is a
 * projection of that closed value, not a second judgement. Presentation
 * Markdown (bold markers, one wrapping inline-code span) is stripped before
 * the closed vocabulary is checked. This helper never infers risk from
 * paths, never talks to the network, and never reads secrets.
 * The trusted default-branch workflow applies the planned label mutation, then
 * evaluates the live labels against the card.
 *
 * CLI:
 *   evaluate <request.json>  → JSON; exit 0 on a usable plan, 1 on helper error
 */

const fs = require('fs');

const PRIMARY = Object.freeze(['auto-safe', 'figures-moved', 'owner-decision', 'blocked']);
const CARD_HEADING_RE = /^[ \t]*#{1,4}[ \t]*.*Atlas Merge Card.*$/im;
const NEXT_HEADING_RE = /\n[ \t]*#{1,6}[ \t]+/;
const PRIMARY_RE = new RegExp(
  `^(${PRIMARY.join('|')})(?:[ \\t]*[—–:.-][\\s\\S]*)?$`,
  'i',
);

function clean(value) {
  const text = String(value == null ? '' : value)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\*\*/g, '')
    .replace(/\r/g, '')
    .trim();
  // Ordinary Markdown inline code around the opening token is presentation,
  // not part of the closed value. Strip one wrapping pair, then re-trim.
  // Do not strip every backtick: `auto-`safe`` must not become auto-safe.
  return text.replace(/^`([^`\n]+)`/, '$1').trim();
}

function sectionAfter(body, heading) {
  return String(body || '')
    .slice(heading.index + heading[0].length)
    .split(NEXT_HEADING_RE)[0];
}

function rowValue(section, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const table = new RegExp(
    `^[ \\t]*\\|[ \\t]*\\*{0,2}${escaped}\\*{0,2}[ \\t]*\\|([^\\n|]*)`,
    'im',
  ).exec(section);
  if (table) return clean(table[1]);
  const bullet = new RegExp(
    `^[ \\t]*[-*][ \\t]*\\*{0,2}${escaped}\\*{0,2}[ \\t]*:(.*)$`,
    'im',
  ).exec(section);
  return bullet ? clean(bullet[1]) : null;
}

function parsePrimaryRisk(body) {
  const text = String(body == null ? '' : body);
  const heading = CARD_HEADING_RE.exec(text);
  if (!heading) {
    return {
      ok: false,
      code: 'missing-card',
      reason: 'The PR body is missing the "Atlas Merge Card" heading.',
    };
  }
  const value = rowValue(sectionAfter(text, heading), 'Primary risk');
  if (value === null) {
    return {
      ok: false,
      code: 'missing-row',
      reason: 'Merge card row "Primary risk" is missing.',
    };
  }
  if (value === '') {
    return {
      ok: false,
      code: 'blank',
      reason: 'Merge card row "Primary risk" is blank or still a template placeholder.',
    };
  }
  const match = PRIMARY_RE.exec(value);
  if (!match) {
    return {
      ok: false,
      code: 'invalid',
      reason: `"Primary risk" must open with one of: ${PRIMARY.join(', ')}.`,
    };
  }
  return { ok: true, code: 'ok', value: match[1].toLowerCase(), raw: value };
}

function currentPrimary(labels) {
  const names = Array.isArray(labels) ? labels.map((label) => String(label)) : [];
  return PRIMARY.filter((name) => names.includes(name));
}

function evaluate(input) {
  const parsed = parsePrimaryRisk(input && input.body);
  const found = currentPrimary(input && input.labels);
  if (!parsed.ok) {
    return {
      ok: false,
      code: parsed.code,
      cardValue: null,
      add: [],
      remove: [],
      state: 'failure',
      description: parsed.reason.slice(0, 140),
      found,
    };
  }

  const cardValue = parsed.value;
  const add = found.includes(cardValue) ? [] : [cardValue];
  const remove = found.filter((name) => name !== cardValue);
  const matches = found.length === 1 && found[0] === cardValue && add.length === 0 && remove.length === 0;

  return {
    ok: true,
    code: matches ? 'ok' : 'sync',
    cardValue,
    add,
    remove,
    description: (matches
      ? `Primary risk: ${cardValue}`
      : `Syncing GitHub label to Merge Card Primary risk: ${cardValue}`
    ).slice(0, 140),
    found,
  };
}

function evaluateGate(input) {
  const parsed = parsePrimaryRisk(input && input.body);
  const found = currentPrimary(input && input.labels);
  if (!parsed.ok) {
    return {
      state: 'failure',
      description: parsed.reason.slice(0, 140),
      code: parsed.code,
      cardValue: null,
      found,
    };
  }
  if (found.length === 1 && found[0] === parsed.value) {
    return {
      state: 'success',
      description: `Primary risk: ${parsed.value}`,
      code: 'ok',
      cardValue: parsed.value,
      found,
    };
  }
  if (found.length === 0) {
    return {
      state: 'failure',
      description: `GitHub label missing. Merge Card Primary risk is ${parsed.value}`,
      code: 'missing-label',
      cardValue: parsed.value,
      found,
    };
  }
  if (found.length > 1) {
    return {
      state: 'failure',
      description: `${found.length} primary labels (${found.join(', ')}) — exactly one is allowed`,
      code: 'multiple-labels',
      cardValue: parsed.value,
      found,
    };
  }
  return {
    state: 'failure',
    description: `GitHub label ${found[0]} does not match Merge Card ${parsed.value}`,
    code: 'mismatch',
    cardValue: parsed.value,
    found,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main(argv) {
  const command = argv[2];
  if (command === 'evaluate') {
    const result = evaluate(readJson(argv[3]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === 'evaluate-gate') {
    const result = evaluateGate(readJson(argv[3]));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.state === 'success' ? 0 : 2;
  }
  process.stderr.write('usage: atlas-primary-risk.js evaluate|evaluate-gate <request.json>\n');
  return 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  PRIMARY,
  parsePrimaryRisk,
  evaluate,
  evaluateGate,
};
