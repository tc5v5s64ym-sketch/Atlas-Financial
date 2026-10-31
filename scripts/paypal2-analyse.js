// Second PayPal account. The question this account can actually answer:
// is there money coming IN from sales, and money going OUT to suppliers?
const fs = require('fs');
const path = require('path');
const P = path.join(__dirname, '..', 'raw', 'paypal2', 'paypal2_2026-02_to_2026-07.csv');

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

const raw = parseCsv(fs.readFileSync(P, 'utf8'));
const h = raw[0].map(x => x.trim());
const ix = n => h.indexOf(n);
const rows = raw.slice(1).map(r => {
  const d = (r[ix('Date')] || '').split('/');
  return {
    date: d.length === 3 ? `${d[2]}-${d[1].padStart(2,'0')}-${d[0].padStart(2,'0')}` : '',
    name: (r[ix('Name')] || '').trim(),
    type: (r[ix('Type')] || '').trim(),
    cur: (r[ix('Currency')] || '').trim(),
    total: parseFloat((r[ix('Total')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
    fees: parseFloat((r[ix('Fees')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
  };
}).filter(r => r.date);

const months = [...new Set(rows.map(r => r.date.slice(0,7)))].sort();
console.log(`${rows.length} transactions · ${months[0]} .. ${months[months.length-1]} (${months.length} months)\n`);

const inn = rows.filter(r => r.total > 0), out = rows.filter(r => r.total < 0);
console.log(`incoming ${inn.length} totalling ${inn.reduce((s,r)=>s+r.total,0).toFixed(2)}`);
console.log(`outgoing ${out.length} totalling ${out.reduce((s,r)=>s+r.total,0).toFixed(2)}`);
console.log(`fees paid ${rows.reduce((s,r)=>s+Math.abs(r.fees),0).toFixed(2)}\n`);

console.log('=== BY TYPE ===');
const byType = new Map();
for (const r of rows) { const e = byType.get(r.type) || {n:0,t:0}; e.n++; e.t += r.total; byType.set(r.type, e); }
for (const [k,v] of [...byType.entries()].sort((a,b)=>a[1].t-b[1].t))
  console.log(`  ${String(v.n).padStart(4)}x ${v.t.toFixed(2).padStart(11)}  ${k}`);

console.log('\n=== INCOMING — is any of it sales revenue? ===');
const byIn = new Map();
for (const r of inn) { const e = byIn.get(r.name || '(no name)') || {n:0,t:0}; e.n++; e.t += r.total; byIn.set(r.name || '(no name)', e); }
for (const [k,v] of [...byIn.entries()].sort((a,b)=>b[1].t-a[1].t).slice(0,15))
  console.log(`  ${v.t.toFixed(2).padStart(10)}  ${String(v.n).padStart(3)}x  ${k.slice(0,44)}`);

console.log('\n=== OUTGOING BY MERCHANT ===');
const byOut = new Map();
for (const r of out) { const e = byOut.get(r.name || '(no name)') || {n:0,t:0,months:new Set()}; e.n++; e.t += Math.abs(r.total); e.months.add(r.date.slice(0,7)); byOut.set(r.name || '(no name)', e); }
for (const [k,v] of [...byOut.entries()].sort((a,b)=>b[1].t-a[1].t).slice(0,26))
  console.log(`  ${v.t.toFixed(2).padStart(10)}  ${String(v.n).padStart(3)}x ${String(v.months.size).padStart(2)}mo  ${k.slice(0,44)}`);

const BIZ = /MailChimp|Canva|RacquetGuys|Parking Corporation|Fiverr|Gumroad|Calendly|Squarespace|Shopify|Wix/i;
const biz = out.filter(r => BIZ.test(r.name));
console.log(`\n=== BUSINESS-SHAPED SPEND ===`);
console.log(`  ${biz.length} transactions totalling ${Math.abs(biz.reduce((s,r)=>s+r.total,0)).toFixed(2)}`);
for (const [k,v] of [...biz.reduce((m,r)=>{const e=m.get(r.name)||{n:0,t:0};e.n++;e.t+=Math.abs(r.total);m.set(r.name,e);return m;},new Map()).entries()].sort((a,b)=>b[1].t-a[1].t))
  console.log(`    ${v.t.toFixed(2).padStart(9)}  ${String(v.n).padStart(3)}x  ${k}`);
