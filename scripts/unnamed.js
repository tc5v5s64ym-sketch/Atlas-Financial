// List the PayPal charges whose merchant name is blank in PayPal's own export.
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

const hits = [];
for (const file of fs.readdirSync(DIR).filter(x => /^paypal_/.test(x))) {
  const rows = parseCsv(fs.readFileSync(path.join(DIR, file), 'utf8'));
  const h = rows[0].map(x => x.trim());
  const ix = n => h.indexOf(n);
  for (const r of rows.slice(1)) {
    const name = (r[ix('Name')] || '').trim();
    const total = parseFloat((r[ix('Total')] || '0').replace(/[^0-9.\-]/g, '')) || 0;
    if (!name && total < 0) {
      const dmy = (r[ix('Date')] || '').split('/');
      hits.push({
        iso: `${dmy[2]}-${dmy[1]}-${dmy[0]}`,
        date: r[ix('Date')],
        total,
        type: (r[ix('Type')] || '').trim(),
        item: (r[ix('Item Title')] || '').trim(),
        txn: (r[ix('Transaction ID')] || '').trim(),
        cur: (r[ix('Currency')] || '').trim(),
      });
    }
  }
}
hits.sort((a, b) => a.iso.localeCompare(b.iso));
console.log(`unnamed outgoing charges: ${hits.length}  total ${hits.reduce((s, r) => s + r.total, 0).toFixed(2)}`);
console.log('\ndate         amount   currency  type                        item title');
for (const h of hits) {
  console.log(`${h.iso}  ${h.total.toFixed(2).padStart(9)}  ${h.cur.padEnd(8)}  ${h.type.padEnd(26)}  ${h.item}`);
}
const amts = [...new Set(hits.map(h => Math.abs(h.total).toFixed(2)))];
console.log(`\ndistinct amounts: ${amts.join(', ')}`);
