// The HELOC is transacted both ways from chequing. Money coming FROM it is
// borrowing (cash in, debt up), money going TO it is debt service. Neither is
// an internal transfer between own asset accounts.
const fs = require('fs');
const path = require('path');
const CFG = require('./config');
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
    .map(x => ({ acct: a, desc: (x[1] || '').trim().toUpperCase(), wd: parseFloat(x[2]) || 0, dep: parseFloat(x[3]) || 0, month: x[0].replace(/"/g, '').slice(0, 7) }));
}
const rows = [...load('chequingA_18mo.csv', 'A'), ...load('chequingB_18mo.csv', 'B'), ...load('savings_18mo.csv', 'S')];
const months = [...new Set(rows.map(r => r.month))].sort();

const isHelocDraw = r => CFG.reDraw.test(r.desc) && r.dep > 0;
const isHelocPay = r => CFG.rePay.test(r.desc) && r.wd > 0;
const isUnknownOut = r => /TFR-TO (6478420|6458934)/.test(r.desc) && r.wd > 0;

console.log('month      HELOC draws   HELOC pmts    net borrow   unknown-acct out');
let cumDraw = 0, cumPay = 0;
for (const m of months) {
  const d = rows.filter(r => r.month === m && isHelocDraw(r)).reduce((s, r) => s + r.dep, 0);
  const p = rows.filter(r => r.month === m && isHelocPay(r)).reduce((s, r) => s + r.wd, 0);
  const u = rows.filter(r => r.month === m && isUnknownOut(r)).reduce((s, r) => s + r.wd, 0);
  cumDraw += d; cumPay += p;
  console.log(`${m}  ${d.toFixed(2).padStart(12)} ${p.toFixed(2).padStart(12)} ${(d - p).toFixed(2).padStart(13)} ${(u ? u.toFixed(2) : '-').padStart(14)}`);
}
console.log('\nTOTALS over window');
console.log(`  HELOC draws (borrowed into chequing): ${cumDraw.toFixed(2)}  (${rows.filter(isHelocDraw).length} draws)`);
console.log(`  HELOC payments (debt service):        ${cumPay.toFixed(2)}  (${rows.filter(isHelocPay).length} payments)`);
console.log(`  NET NEW BORROWING:                    ${(cumDraw - cumPay).toFixed(2)}`);
const un = rows.filter(isUnknownOut);
console.log(`  Transfers to unidentified accounts:   ${un.reduce((s, r) => s + r.wd, 0).toFixed(2)} (${un.length} items) -- NEEDS OWNER CONFIRMATION`);

