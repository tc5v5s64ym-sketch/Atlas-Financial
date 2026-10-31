// Local-only profiling of TD CSV exports. Produces aggregate patterns, never
// writes identifiers or per-transaction rows to any shared output.
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'raw');

function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function load(file) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .map(parseCsvLine)
    .map(f => ({
      date: (f[0] || '').trim(),
      desc: (f[1] || '').trim(),
      wd: parseFloat(f[2]) || 0,
      dep: parseFloat(f[3]) || 0,
      bal: parseFloat(f[4]),
    }));
}

const files = { 'Chequing A': 'chequingA_18mo.csv', 'Chequing B': 'chequingB_18mo.csv', 'Savings': 'savings_18mo.csv' };

// Normalise a description into a merchant-ish key: drop trailing TD channel
// suffixes, embedded store numbers, and reference codes.
function norm(d) {
  return d
    .replace(/\b[A-Z]{2}\d{3}\b/g, '#REF')          // e.g. UT564, IQ444
    .replace(/\d{5,}/g, '#NUM')                      // long account/store numbers
    .replace(/\*{2,}\w+/g, '#REF')                   // ***e7T
    .replace(/\s+_[A-Z]\b/g, '')                     // _M _F _V channel suffix
    .replace(/\s+#\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

for (const [label, f] of Object.entries(files)) {
  const rows = load(f);
  if (!rows.length) { console.log(`\n### ${label}: FILE MISSING`); continue; }
  const byKey = new Map();
  for (const r of rows) {
    const k = norm(r.desc);
    const e = byKey.get(k) || { n: 0, wd: 0, dep: 0 };
    e.n++; e.wd += r.wd; e.dep += r.dep;
    byKey.set(k, e);
  }
  const sorted = [...byKey.entries()].sort((a, b) => (b[1].wd + b[1].dep) - (a[1].wd + a[1].dep));
  console.log(`\n### ${label} — ${rows.length} rows, ${byKey.size} distinct patterns`);
  console.log(`total withdrawals ${rows.reduce((s, r) => s + r.wd, 0).toFixed(2)}  total deposits ${rows.reduce((s, r) => s + r.dep, 0).toFixed(2)}`);
  for (const [k, v] of sorted.slice(0, 45)) {
    console.log(`  ${String(v.n).padStart(4)}x  wd ${v.wd.toFixed(2).padStart(11)}  dep ${v.dep.toFixed(2).padStart(11)}  ${k}`);
  }
}
