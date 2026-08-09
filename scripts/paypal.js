// What does the PayPal spending actually buy? Also: is there any incoming
// money (business revenue), and any person-to-person transfers?
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'raw', 'paypal');

function parseCsv(text) {
  const rows = []; let cur = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.length > 3);
}

const all = [];
for (const f of fs.readdirSync(DIR).filter(x => /^paypal_.*\.csv$/i.test(x))) {
  const rows = parseCsv(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const head = rows[0].map(h => h.trim());
  const ix = n => head.indexOf(n);
  for (const r of rows.slice(1)) {
    const dmy = (r[ix('Date')] || '').split('/');
    if (dmy.length !== 3) continue;
    all.push({
      src: f,
      date: `${dmy[2]}-${dmy[1].padStart(2, '0')}-${dmy[0].padStart(2, '0')}`,
      name: (r[ix('Name')] || '').trim(),
      type: (r[ix('Type')] || '').trim(),
      status: (r[ix('Status')] || '').trim(),
      cur: (r[ix('Currency')] || '').trim(),
      amt: parseFloat((r[ix('Amount')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
      total: parseFloat((r[ix('Total')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
      item: (r[ix('Item Title')] || '').trim(),
    });
  }
}
all.sort((a, b) => a.date.localeCompare(b.date));
const months = [...new Set(all.map(r => r.date.slice(0, 7)))].sort();
console.log(`transactions: ${all.length}   coverage: ${months[0]} .. ${months[months.length-1]}  (${months.length} months)`);
console.log(`months present: ${months.join(', ')}`);

const out = all.filter(r => r.total < 0);
const inn = all.filter(r => r.total > 0);
console.log(`\noutgoing: ${out.length} totalling ${out.reduce((s,r)=>s+r.total,0).toFixed(2)}`);
console.log(`incoming: ${inn.length} totalling ${inn.reduce((s,r)=>s+r.total,0).toFixed(2)}`);

console.log('\n=== BY TYPE ===');
const byType = new Map();
for (const r of all) { const e = byType.get(r.type) || { n: 0, t: 0 }; e.n++; e.t += r.total; byType.set(r.type, e); }
for (const [k, v] of [...byType.entries()].sort((a,b)=>a[1].t-b[1].t))
  console.log(`  ${String(v.n).padStart(4)}x  ${v.t.toFixed(2).padStart(11)}  ${k}`);

console.log('\n=== BY MERCHANT (outgoing) ===');
const byName = new Map();
for (const r of out) {
  const e = byName.get(r.name) || { n: 0, t: 0, months: new Set(), amts: [] };
  e.n++; e.t += r.total; e.months.add(r.date.slice(0, 7)); e.amts.push(Math.abs(r.total));
  byName.set(r.name, e);
}
const list = [...byName.entries()].sort((a, b) => a[1].t - b[1].t);
let subTotal = 0;
for (const [k, v] of list) {
  const perMonth = v.t / months.length;
  const recurring = v.months.size >= Math.min(6, months.length - 1);
  if (recurring) subTotal += Math.abs(v.t);
  const typical = (Math.abs(v.t) / v.n).toFixed(2);
  console.log(`  ${Math.abs(v.t).toFixed(2).padStart(9)}  ${String(v.n).padStart(3)}x  ${String(v.months.size).padStart(2)}mo  typ ${typical.padStart(8)}  ${recurring ? 'RECURRING' : '         '}  ${k.slice(0, 38)}`);
}
console.log(`\nrecurring subtotal over ${months.length} months: ${subTotal.toFixed(2)}  (~${(subTotal/months.length).toFixed(2)}/month)`);
const allOut = Math.abs(out.reduce((s,r)=>s+r.total,0));
console.log(`total outgoing: ${allOut.toFixed(2)}  (~${(allOut/months.length).toFixed(2)}/month)`);
console.log(`recurring share: ${(subTotal/allOut*100).toFixed(1)}%`);

console.log('\n=== INCOMING DETAIL ===');
for (const r of inn.sort((a,b)=>b.total-a.total).slice(0, 25))
  console.log(`  ${r.date}  ${r.total.toFixed(2).padStart(10)}  ${r.type.padEnd(22)} ${r.name.slice(0,34)}`);

const p2p = all.filter(r => /personal|send|friends/i.test(r.type));
console.log(`\nperson-to-person style transactions: ${p2p.length}`);
for (const r of p2p.slice(0, 15)) console.log(`  ${r.date} ${r.total.toFixed(2).padStart(10)} ${r.type} — ${r.name}`);

fs.writeFileSync(path.join(__dirname, '..', 'derived', 'paypal.json'), JSON.stringify({ months, count: all.length }, null, 2));
