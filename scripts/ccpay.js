// The TD Visa's balance barely moves, yet chequing shows large "TFR-TO C/C"
// outflows. Check how those payments are distributed over time.
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'raw');
function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function load(f, a) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
    .map(x => ({ acct: a, desc: (x[1] || '').trim().toUpperCase(), wd: parseFloat(x[2]) || 0, month: x[0].replace(/"/g, '').slice(0, 7) }));
}
const rows = [...load('chequingA_18mo.csv', 'A'), ...load('chequingB_18mo.csv', 'B')];
const months = [...new Set(rows.map(r => r.month))].sort();

const groups = {
  'TD card (TFR-TO C/C)': r => /TFR-TO C\/C/.test(r.desc),
  'Canadian Tire MC': r => /CAN TIRE MC/.test(r.desc),
  'MBNA MC': r => /MBNA M\/C/.test(r.desc),
  'Affirm / Flexiti (BNPL)': r => /AFFIRM|FLEXITI/.test(r.desc),
  'Mortgage': r => /TD MORTGAGE/.test(r.desc),
};

console.log('month     ' + Object.keys(groups).map(k => k.slice(0, 13).padStart(14)).join(''));
for (const m of months) {
  const line = Object.values(groups).map(fn => {
    const t = rows.filter(r => r.month === m && fn(r)).reduce((s, r) => s + r.wd, 0);
    return (t ? t.toFixed(2) : '-').padStart(14);
  }).join('');
  console.log(m + '  ' + line);
}
console.log('\nTOTALS');
for (const [k, fn] of Object.entries(groups)) {
  const sel = rows.filter(fn);
  console.log(`  ${k.padEnd(26)} ${sel.reduce((s, r) => s + r.wd, 0).toFixed(2).padStart(11)}  over ${new Set(sel.map(r => r.month)).size} months, ${sel.length} payments`);
}
