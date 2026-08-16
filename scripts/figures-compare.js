'use strict';
/* Diff two figures-snapshot JSON files into markdown.
 * `node scripts/figures-compare.js <base.json> <head.json> [--base-ref=main]`
 *
 * THIS SCRIPT DOES NOT DECIDE WHETHER A MOVE IS ALLOWED. A changed figure is
 * usually the point of the pull request. The job is to make every Plan-page
 * published-figure move visible on the Atlas CI check summary.
 *
 * Exit 0 when the comparison ran. Exit 1 when the inputs cannot be read.
 *
 * Scope is exactly `scripts/figures-snapshot.js`: Plan-page headline figures,
 * not Deep Dive, Records, or Modellers. Do not word an identical snapshot as
 * "the household is told the same thing everywhere".
 */

const fs = require('fs');

const isCount = k => /facilitiesOverLimit|openCount|windowDays/.test(k);

const money = v => typeof v === 'number'
  ? (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  : String(v);

const fmt = (k, v) => v === undefined ? '—'
  : typeof v !== 'number' ? '`' + v + '`'
  : isCount(k) ? String(v) : money(v);

const deltaCell = (k, a, b) => {
  if (a === undefined) return 'new';
  if (b === undefined) return 'removed';
  if (typeof a === 'number' && typeof b === 'number' && !isCount(k)) {
    const d = b - a;
    return (d >= 0 ? '+' : '−') + money(Math.abs(d)).replace(/^[−$]+/, '$');
  }
  if (typeof a === 'number' && typeof b === 'number') {
    const d = b - a;
    return (d >= 0 ? '+' : '−') + Math.abs(d);
  }
  return 'changed';
};

const numbersMoved = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 0.005;
  return a !== b;
};

function compare(base, head, baseRef) {
  const ref = baseRef || 'base';
  if (base === null) {
    const rows = Object.entries(head)
      .map(([k, v]) => `| \`${k}\` | ${fmt(k, v)} |`).join('\n');
    return [
      '### Published figures',
      '',
      'The snapshot script is not on the base revision, so there is no',
      'baseline to compare against. These are the Plan-page headline figures',
      'as of this head — every future PR will diff against them.',
      '',
      '| Figure | Value |',
      '|---|---|',
      rows,
      '',
    ].join('\n');
  }

  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const moved = keys.filter(k => numbersMoved(base[k], head[k]));
  if (!moved.length) {
    return [
      '### Published figures — unchanged',
      '',
      `Every one of the ${keys.length} Plan-page headline figures from`,
      `\`scripts/figures-snapshot.js\` is identical on this head and on \`${ref}\`.`,
      'This comparison does not cover Deep Dive, Records, or Modellers.',
      '',
    ].join('\n');
  }

  const rows = moved.map(k => (
    `| \`${k}\` | ${fmt(k, base[k])} | **${fmt(k, head[k])}** | ${deltaCell(k, base[k], head[k])} |`
  )).join('\n');
  return [
    `### ${moved.length} published figure${moved.length === 1 ? '' : 's'} moved`,
    '',
    `Computed by running \`scripts/figures-snapshot.js\` on \`${ref}\` and on`,
    'this head, not by reading the source diff. Scope is Plan-page headline',
    'figures only — not Deep Dive, Records, or Modellers.',
    '',
    '**Every row below is a Plan-page figure the household would read differently.**',
    'Confirm each was intended.',
    '',
    `| Figure | ${ref} | this PR | Δ |`,
    '|---|---|---|---|',
    rows,
    '',
    `<sub>${keys.length - moved.length} other snapshot figures unchanged.</sub>`,
    '',
  ].join('\n');
}

function load(path) {
  const text = fs.readFileSync(path, 'utf8');
  return JSON.parse(text);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let baseRef = 'main';
  const files = [];
  for (const arg of args) {
    if (arg.startsWith('--base-ref=')) baseRef = arg.slice('--base-ref='.length);
    else files.push(arg);
  }
  return { files, baseRef };
}

if (require.main === module) {
  const { files, baseRef } = parseArgs(process.argv);
  if (files.length !== 2) {
    process.stderr.write('usage: node scripts/figures-compare.js <base.json> <head.json> [--base-ref=main]\n');
    process.exit(1);
  }
  let base;
  let head;
  try {
    base = load(files[0]);
    head = load(files[1]);
  } catch (err) {
    process.stderr.write(`figures-compare: ${err.message}\n`);
    process.exit(1);
  }
  if (head === null || typeof head !== 'object' || Array.isArray(head)) {
    process.stderr.write('figures-compare: head snapshot must be a JSON object\n');
    process.exit(1);
  }
  if (base !== null && (typeof base !== 'object' || Array.isArray(base))) {
    process.stderr.write('figures-compare: base snapshot must be a JSON object or null\n');
    process.exit(1);
  }
  process.stdout.write(compare(base, head, baseRef));
}

module.exports = { compare, money, isCount, fmt, deltaCell };
