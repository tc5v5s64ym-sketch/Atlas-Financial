// Full 18-month HELOC history: true balance trajectory, interest cost, and what
// the line actually funds.
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'raw', 'heloc_18mo.csv');
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
  .map(f => ({ date: f[0].trim(), desc: (f[1] || '').trim().toUpperCase(), a: parseFloat(f[2]) || 0, b: parseFloat(f[3]) || 0, bal: parseFloat(f[4]), month: f[0].trim().slice(0, 7) }));

console.log('columns sample:', JSON.stringify(rows[0]));
// On a debt account TD writes advances in one column and payments in the other.
const adv = rows.reduce((s, r) => s + r.a, 0);
const pay = rows.reduce((s, r) => s + r.b, 0);
console.log(`rows ${rows.length}  colA total ${adv.toFixed(2)}  colB total ${pay.toFixed(2)}`);

const sorted = [...rows].sort((x, y) => x.date.localeCompare(y.date));
console.log(`first ${sorted[0].date} bal ${sorted[0].bal}   last ${sorted[sorted.length-1].date} bal ${sorted[sorted.length-1].bal}`);

// monthly: end balance, interest charged, advances, payments
const months = [...new Set(rows.map(r => r.month))].sort();
console.log('\nmonth     end-balance   interest    advances    payments   net change');
let prevEnd = null;
for (const m of months) {
  const mr = sorted.filter(r => r.month === m);
  const end = mr[mr.length - 1].bal;
  const int = mr.filter(r => /INTEREST/.test(r.desc)).reduce((s, r) => s + r.a, 0);
  const advances = mr.filter(r => !/INTEREST/.test(r.desc)).reduce((s, r) => s + r.a, 0);
  const payments = mr.reduce((s, r) => s + r.b, 0);
  const chg = prevEnd === null ? 0 : end - prevEnd;
  console.log(`${m}  ${end.toFixed(2).padStart(12)} ${int.toFixed(2).padStart(10)} ${advances.toFixed(2).padStart(11)} ${payments.toFixed(2).padStart(11)} ${(prevEnd===null?'-':(chg>=0?'+':'')+chg.toFixed(2)).padStart(11)}`);
  prevEnd = end;
}

const totalInt = rows.filter(r => /INTEREST/.test(r.desc)).reduce((s, r) => s + r.a, 0);
console.log(`\nTotal interest charged over window: ${totalInt.toFixed(2)}  (${rows.filter(r=>/INTEREST/.test(r.desc)).length} charges)`);
console.log(`Balance start ${sorted[0].bal.toFixed(2)} -> end ${sorted[sorted.length-1].bal.toFixed(2)}  change ${(sorted[sorted.length-1].bal - sorted[0].bal).toFixed(2)}`);

// what the line funds
const groups = {
  'Interest charged': r => /INTEREST/.test(r.desc),
  'To credit card': r => /TFR-TO C\/C/.test(r.desc),
  'E-transfers out': r => /SEND E-TFR(?! FEE)/.test(r.desc),
  'E-transfer fees': r => /E-TFR FEE/.test(r.desc),
  'To chequing/other own': r => /TFR-TO \d{6,}/.test(r.desc),
  'CRA tax': r => /CRA|TAX OWED/.test(r.desc),
};
console.log('\nWHAT THE LINE FUNDED (advances only)');
for (const [k, fn] of Object.entries(groups)) {
  const sel = rows.filter(fn);
  if (!sel.length) continue;
  console.log(`  ${k.padEnd(24)} ${sel.reduce((s, r) => s + r.a, 0).toFixed(2).padStart(11)}  (${sel.length} items)`);
}
const other = rows.filter(r => !Object.values(groups).some(fn => fn(r)) && r.a > 0);
console.log(`  ${'Other advances'.padEnd(24)} ${other.reduce((s,r)=>s+r.a,0).toFixed(2).padStart(11)}  (${other.length} items)`);
console.log('\nINFLOWS TO THE LINE (payments)');
const pays = rows.filter(r => r.b > 0);
const byDesc = new Map();
for (const r of pays) { const k = r.desc.replace(/\b[A-Z]{2}\d{3}\b/g,'').replace(/\d{5,}/g,'#').trim().slice(0,26); byDesc.set(k, (byDesc.get(k)||0) + r.b); }
for (const [k, v] of [...byDesc.entries()].sort((a,b)=>b[1]-a[1]).slice(0,12)) console.log(`  ${v.toFixed(2).padStart(11)}  ${k}`);
