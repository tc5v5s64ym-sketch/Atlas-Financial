// Break down incoming e-transfers. Dated first-pass labels treated the
// residual as resale proceeds. Owner-stated 2026-08-29: there is no shop /
// resale / inventory business; leftover coaching is not Forecast income.
// This script does not invent a current planning split.
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
    .map(x => ({ acct: a, date: x[0].trim(), desc: (x[1] || '').trim().toUpperCase(), wd: parseFloat(x[2]) || 0, dep: parseFloat(x[3]) || 0, month: (x[0] || '').slice(0, 7) }));
}
const rows = [...load('chequingA_18mo.csv', 'A'), ...load('chequingB_18mo.csv', 'B'), ...load('savings_18mo.csv', 'S')];

const inbound = rows.filter(r => r.dep > 0 && /(E-TRANSFER|E-TFR)/.test(r.desc) && !/CANCEL|FEE/.test(r.desc));

const months = [...new Set(rows.map(r => r.month))].sort();
console.log(`Incoming e-transfers: ${inbound.length} items, total ${inbound.reduce((s, r) => s + r.dep, 0).toFixed(2)}`);

console.log('\n=== MONTHLY INBOUND E-TRANSFERS ===');
console.log('month      count      total     largest    at-or-near-1000');
for (const m of months) {
  const mr = inbound.filter(r => r.month === m);
  if (!mr.length) { console.log(`${m}          0       0.00`); continue; }
  const tot = mr.reduce((s, r) => s + r.dep, 0);
  const max = Math.max(...mr.map(r => r.dep));
  const k = mr.filter(r => r.dep >= 950 && r.dep <= 1050).length;
  console.log(`${m}  ${String(mr.length).padStart(6)}  ${tot.toFixed(2).padStart(10)}  ${max.toFixed(2).padStart(10)}  ${k}`);
}

// size distribution
const buckets = [[0, 100], [100, 250], [250, 500], [500, 950], [950, 1050], [1050, 2000], [2000, 5000], [5000, 1e9]];
console.log('\n=== SIZE DISTRIBUTION ===');
for (const [lo, hi] of buckets) {
  const b = inbound.filter(r => r.dep >= lo && r.dep < hi);
  if (!b.length) continue;
  console.log(`  ${String(lo).padStart(5)}-${String(hi === 1e9 ? '+' : hi).padEnd(6)} ${String(b.length).padStart(4)} items  ${b.reduce((s, r) => s + r.dep, 0).toFixed(2).padStart(11)}`);
}

// how many months contain a ~1000 item (spouse pay signature)
const withK = months.filter(m => inbound.some(r => r.month === m && r.dep >= 950 && r.dep <= 1050));
console.log(`\nMonths containing a $950-1050 item: ${withK.length} of ${months.length}`);
const spouseTotal = inbound.filter(r => r.dep >= 950 && r.dep <= 1050).reduce((s, r) => s + r.dep, 0);
const spouseN = inbound.filter(r => r.dep >= 950 && r.dep <= 1050).length;
console.log(`Those items: ${spouseN} totalling ${spouseTotal.toFixed(2)}`);
console.log(`Residual (not current resale planning; historical unmatched inbound): ${(inbound.reduce((s, r) => s + r.dep, 0) - spouseTotal).toFixed(2)}`);
