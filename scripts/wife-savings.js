// Where did the money in SAVINGS-DONT TOUCH go? Roughly $14,300 net went in
// from the other household accounts, yet the balance is $74.20.
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'raw', 'wife-td', 'savings-dont-touch_18mo.csv');

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
const rows = fs.readFileSync(P, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
  .map(f => ({ date: f[0].trim(), desc: (f[1] || '').trim().toUpperCase(),
               wd: parseFloat(f[2]) || 0, dep: parseFloat(f[3]) || 0, bal: parseFloat(f[4]) }));
rows.sort((a, b) => a.date.localeCompare(b.date));

const tin = rows.reduce((s, r) => s + r.dep, 0);
const tout = rows.reduce((s, r) => s + r.wd, 0);
console.log(`${rows.length} transactions · ${rows[0].date} .. ${rows[rows.length-1].date}`);
console.log(`in ${tin.toFixed(2)}   out ${tout.toFixed(2)}   net ${(tin-tout).toFixed(2)}`);
console.log(`opening balance ~${(rows[0].bal - rows[0].dep + rows[0].wd).toFixed(2)}   closing ${rows[rows.length-1].bal.toFixed(2)}\n`);

function group(sel, label) {
  const m = new Map();
  for (const r of rows.filter(sel)) {
    const k = r.desc.replace(/\b[A-Z]{2}\d{3}\b/g, '').replace(/\*{2,}\w+/g, '').replace(/\d{5,}/g, '#')
      .replace(/\s+/g, ' ').trim().slice(0, 32);
    const e = m.get(k) || { n: 0, v: 0 }; e.n++; e.v += (r.dep || r.wd); m.set(k, e);
  }
  console.log(`=== ${label} ===`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1].v - a[1].v))
    console.log(`  ${v.v.toFixed(2).padStart(10)}  ${String(v.n).padStart(3)}x  ${k}`);
  console.log('');
}
group(r => r.dep > 0, 'MONEY IN');
group(r => r.wd > 0, 'MONEY OUT');

console.log('=== the largest movements ===');
for (const r of [...rows].sort((a, b) => Math.max(b.wd, b.dep) - Math.max(a.wd, a.dep)).slice(0, 12))
  console.log(`  ${r.date}  ${(r.dep ? '+' : '-')}${(r.dep || r.wd).toFixed(2).padStart(9)}  bal ${String(r.bal).padStart(9)}  ${r.desc.slice(0, 34)}`);

const peak = rows.reduce((m, r) => (r.bal > m.bal ? r : m), rows[0]);
console.log(`\npeak balance: ${peak.bal.toFixed(2)} on ${peak.date}`);
