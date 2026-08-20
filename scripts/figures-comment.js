'use strict';
/* Format the published-figures review comment from two snapshots.
 * `node scripts/figures-comment.js`
 *
 * The snapshot in `scripts/figures-snapshot.js` is Plan-page figures only.
 * This helper must not describe that comparison as covering Deep Dive,
 * Records, Modellers, or "what the household is told".
 *
 * THIS MODULE DOES NOT COMPARE REVISIONS ITSELF. Callers pass already-loaded
 * `base` and `head` maps (or `base === null` when the base has no snapshot).
 */

const MARKER = '<!-- atlas-figures-review -->';

function money(v) {
  return typeof v === 'number'
    ? (v < 0 ? '−$' : '$') + Math.abs(v).toLocaleString('en-CA',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(v);
}

// A key is money unless it is plainly a date, a count or a verdict.
function isCount(k) {
  return /facilitiesOverLimit|openCount|windowDays/.test(k);
}

function fmt(k, v) {
  if (v === undefined) return '—';
  if (typeof v !== 'number') return '`' + v + '`';
  return isCount(k) ? String(v) : money(v);
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
      `Plan page is identical on this head and on \`${baseRef}\`.\n`;
  }

  const rows = moved.map(k => {
    const a = base[k], b = head[k];
    let delta = '';
    if (typeof a === 'number' && typeof b === 'number' && !isCount(k)) {
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
    `**Every row below is a Plan-page figure the household would read differently.** ` +
    `Confirm each was intended and is stated on the merge card.\n\n` +
    `| Figure | ${baseRef} | this PR | Δ |\n|---|---|---|---|\n${rows}\n\n` +
    `<sub>${keys.length - moved.length} other Plan-page figures unchanged.</sub>\n`;
}

module.exports = {
  MARKER,
  formatFiguresComment,
  money,
  fmt,
  isCount,
};
