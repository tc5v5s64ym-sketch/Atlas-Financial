// Is the recurring spouse e-transfer still landing every month, and did its
// amount step up? Uses a 950-1150 window to catch both the 1,000 and 1,100 forms.
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
function load(f) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
    .map(x => ({ date: x[0].replace(/"/g, '').trim(), desc: (x[1] || '').trim().toUpperCase(), dep: parseFloat(x[3]) || 0, month: x[0].replace(/"/g, '').slice(0, 7) }));
}
const rows = [...load('chequingA_18mo.csv'), ...load('chequingB_18mo.csv'), ...load('savings_18mo.csv')];
const months = [...new Set(rows.map(r => r.month))].sort();
const inb = rows.filter(r => r.dep > 0 && /(E-TRANSFER|E-TFR)/.test(r.desc) && !/CANCEL|FEE/.test(r.desc));

console.log('month     recurring-window items (950-1150)      all inbound e-tfr amounts that month');
for (const m of months) {
  const mr = inb.filter(r => r.month === m);
  const win = mr.filter(r => r.dep >= 950 && r.dep <= 1150).map(r => r.dep.toFixed(2));
  const all = mr.map(r => r.dep.toFixed(2)).join(' ');
  const flag = win.length ? '' : '   <-- NONE';
  console.log(`${m}  ${(win.join(' ') || '-').padEnd(24)} ${flag.padEnd(12)} [${all}]`);
}
