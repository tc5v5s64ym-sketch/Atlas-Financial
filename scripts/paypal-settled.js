// Correct settled spend for a PayPal export.
//
// PayPal records one purchase as up to four rows:
//   General Authorization (Pending)    – a hold, not a charge
//   PreApproved Payment / Express      – THE ACTUAL CHARGE
//   General Card Deposit               – the funding leg, equal and opposite
//   General Authorization (Completed)  – the hold clearing
//
// Summing every negative row therefore roughly doubles the true figure.
// Only the payment rows are real spend.
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
function parseCsv(text) {
  const rows = []; let cur = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows.filter(r => r.length > 3);
}
const raw = parseCsv(fs.readFileSync(file, 'utf8'));
const h = raw[0].map(x => x.trim()); const ix = n => h.indexOf(n);
const rows = raw.slice(1).map(r => {
  const d = (r[ix('Date')] || '').split('/');
  return {
    date: d.length === 3 ? `${d[2]}-${d[1].padStart(2,'0')}-${d[0].padStart(2,'0')}` : '',
    name: (r[ix('Name')] || '').trim(),
    type: (r[ix('Type')] || '').trim(),
    status: (r[ix('Status')] || '').trim(),
    cur: (r[ix('Currency')] || '').trim(),
    total: parseFloat((r[ix('Total')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
  };
}).filter(r => r.date);

const CHARGE = /PreApproved Payment Bill User Payment|Express Checkout Payment|Website Payment|^Other$/;
const settled = rows.filter(r => r.total < 0 && CHARGE.test(r.type) && r.status === 'Completed');
const voided = rows.filter(r => /Void of Authorization/i.test(r.type));

const months = [...new Set(rows.map(r => r.date.slice(0,7)))].sort();
console.log(`${path.basename(file)} · ${rows.length} rows · ${months[0]} .. ${months[months.length-1]} (${months.length} months)\n`);

const naive = Math.abs(rows.filter(r => r.total < 0).reduce((s,r)=>s+r.total,0));
const gross = Math.abs(settled.reduce((s,r)=>s+r.total,0));
console.log(`naive sum of all negatives : ${naive.toFixed(2)}   <- overstated`);
console.log(`SETTLED SPEND              : ${gross.toFixed(2)}   (${settled.length} charges)`);
console.log(`voided/reversed            : ${voided.length} row(s)`);
console.log(`per month                  : ${(gross/months.length).toFixed(2)}\n`);

const byName = new Map();
for (const r of settled) {
  const e = byName.get(r.name) || { n:0, t:0, cur:new Set() };
  e.n++; e.t += Math.abs(r.total); e.cur.add(r.cur); byName.set(r.name, e);
}
console.log('settled spend by merchant:');
for (const [k,v] of [...byName.entries()].sort((a,b)=>b[1].t-a[1].t))
  console.log(`  ${v.t.toFixed(2).padStart(9)}  ${String(v.n).padStart(3)}x  ${[...v.cur].join('/')}  ${k}`);

console.log('\nnote: USD charges are shown in USD as recorded; the CAD funding leg');
console.log('for each carries the exchange rate PayPal applied.');
