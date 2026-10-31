// What does the DEBT&PAYMENTS account actually do? It is one of the two
// accounts that were previously unidentified from the husband's side.
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'raw', 'wife-td', 'debt-and-payments_18mo.csv');

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
               wd: parseFloat(f[2]) || 0, dep: parseFloat(f[3]) || 0, month: f[0].trim().slice(0, 7) }));

const months = [...new Set(rows.map(r => r.month))].sort();
const totIn = rows.reduce((s, r) => s + r.dep, 0);
const totOut = rows.reduce((s, r) => s + r.wd, 0);
console.log(`${rows.length} rows · ${months[0]} .. ${months[months.length-1]}`);
console.log(`in ${totIn.toFixed(2)}  out ${totOut.toFixed(2)}  net ${(totIn-totOut).toFixed(2)}\n`);

function group(sel, label) {
  const m = new Map();
  for (const r of rows.filter(sel)) {
    const k = r.desc.replace(/\b[A-Z]{2}\d{3}\b/g, '').replace(/\*{2,}\w+/g, '').replace(/\d{5,}/g, '#')
      .replace(/\s+/g, ' ').trim().slice(0, 30);
    const e = m.get(k) || { n: 0, v: 0, months: new Set() };
    e.n++; e.v += (r.dep || r.wd); e.months.add(r.month); m.set(k, e);
  }
  console.log(`=== ${label} ===`);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 18))
    console.log(`  ${v.v.toFixed(2).padStart(11)}  ${String(v.n).padStart(3)}x  ${String(v.months.size).padStart(2)}mo  ${k}`);
  console.log('');
}
group(r => r.dep > 0, 'MONEY IN');
group(r => r.wd > 0, 'MONEY OUT');

// Where does money go — to which accounts?
const dest = new Map();
for (const r of rows.filter(x => x.wd > 0 && /TFR-TO|PYT TO/.test(x.desc))) {
  const m = r.desc.match(/(\d{6,})/);
  const k = m ? m[1] : r.desc.slice(0, 24);
  const e = dest.get(k) || { n: 0, v: 0 }; e.n++; e.v += r.wd; dest.set(k, e);
}
console.log('=== TRANSFERS OUT, BY DESTINATION ACCOUNT ===');
for (const [k, v] of [...dest.entries()].sort((a, b) => b[1].v - a[1].v))
  console.log(`  ${v.v.toFixed(2).padStart(11)}  ${String(v.n).padStart(3)}x  ...${k}`);

// Employment income
const pay = rows.filter(r => r.dep > 0 && /TENNIS/.test(r.desc));
console.log(`\n=== TENNIS BC INCOME ===`);
console.log(`  ${pay.length} deposits totalling ${pay.reduce((s,r)=>s+r.dep,0).toFixed(2)}`);
const byMonth = new Map();
for (const r of pay) byMonth.set(r.month, (byMonth.get(r.month) || 0) + r.dep);
for (const m of months) if (byMonth.has(m)) console.log(`  ${m}  ${byMonth.get(m).toFixed(2).padStart(10)}`);
const active = [...byMonth.values()];
console.log(`  average over ${active.length} months with pay: ${(active.reduce((a,b)=>a+b,0)/active.length).toFixed(2)}`);
