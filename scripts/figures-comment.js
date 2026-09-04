'use strict';
/* Format the published-figures review comment from two snapshots.
 * `node scripts/figures-comment.js <base.json> <head.json> <baseRef>`
 *
 * The snapshot in `scripts/figures-snapshot.js` covers Plan, Credit, and
 * Planning household-facing figures. This helper must not describe that
 * comparison as covering Deep Dive, Records, Modellers, or "what the
 * household is told".
 *
 * THIS MODULE DOES NOT COMPARE REVISIONS ITSELF. Callers pass already-loaded
 * `base` and `head` maps (or `base === null` when the base has no snapshot).
 * The CLI reads those maps from JSON files and writes only the comment body.
 */

const fs = require('fs');

const MARKER = '<!-- atlas-figures-review -->';

function money(v) {
  return typeof v === 'number'
    ? (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-CA',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v);
}

// A key is money unless it is plainly a date, a count, a rate, or a verdict.
function isCount(k) {
  return /facilitiesOverLimit|openCount|windowDays/.test(k);
}

function isRate(k) {
  return /\.rate$/.test(k);
}

function fmt(k, v) {
  if (v === undefined) return '—';
  if (typeof v !== 'number') return '`' + v + '`';
  if (isCount(k)) return String(v);
  if (isRate(k)) return String(v) + '%';
  return money(v);
}

function formatFiguresComment(base, head, baseRef) {
  if (base === null) {
    const rows = Object.entries(head)
      .map(([k, v]) => `| \`${k}\` | ${fmt(k, v)} |`).join('\n');
    return `${MARKER}\n### 📊 Published figures\n\n` +
      `The snapshot script is introduced by this PR, so there is no baseline to ` +
      `compare against. These are the figures as of this head — every future PR ` +
      `will diff against them.\n\n| Figure | Value |\n|---|---|\n${rows}\n`;
  }

  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
  const moved = keys.filter(k => {
    const a = base[k], b = head[k];
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) > 0.005;
    return a !== b;
  });

  if (!moved.length) {
    return `${MARKER}\n### 📊 Published figures — unchanged\n\n` +
      `Every one of the ${keys.length} figures the household can read off the ` +
      `Plan, Credit, and Planning surfaces is identical on this head and on \`${baseRef}\`.\n`;
  }

  const rows = moved.map(k => {
    const a = base[k], b = head[k];
    let delta = '';
    if (typeof a === 'number' && typeof b === 'number' && !isCount(k) && !isRate(k)) {
      const d = b - a;
      delta = (d >= 0 ? '+' : '−') + money(Math.abs(d)).replace(/^[−$]+/, '$');
    } else if (typeof a === 'number' && typeof b === 'number') {
      const d = b - a;
      delta = (d >= 0 ? '+' : '−') + Math.abs(d);
    } else if (a === undefined) { delta = 'new'; }
    else if (b === undefined) { delta = 'removed'; }
    else { delta = 'changed'; }
    return `| \`${k}\` | ${fmt(k, a)} | **${fmt(k, b)}** | ${delta} |`;
  }).join('\n');

  return `${MARKER}\n### 📊 ${moved.length} published figure${moved.length === 1 ? '' : 's'} moved\n\n` +
    `Computed by running the engine on \`${baseRef}\` and on this ` +
    `head, not by reading the diff — the figure that started all of this was a derived one, ` +
    `and a source diff would not have shown it.\n\n` +
    `**Every row below is a Plan, Credit, or Planning figure the household would read differently.** ` +
    `Confirm each was intended and is stated on the merge card.\n\n` +
    `| Figure | ${baseRef} | this PR | Δ |\n|---|---|---|---|\n${rows}\n\n` +
    `<sub>${keys.length - moved.length} other Plan, Credit, and Planning figures unchanged.</sub>\n`;
}

function main(argv) {
  const [, , basePath, headPath, baseRef] = argv;
  if (!basePath || !headPath || argv.length !== 5) {
    process.stderr.write(
      'usage: node scripts/figures-comment.js <base.json> <head.json> <baseRef>\n'
    );
    return 1;
  }
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
  const head = JSON.parse(fs.readFileSync(headPath, 'utf8'));
  process.stdout.write(formatFiguresComment(base, head, baseRef));
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  MARKER,
  formatFiguresComment,
  money,
  fmt,
  isCount,
  isRate,
  main,
};
