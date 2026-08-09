// Corrected PayPal analysis.
// The first pass counted every negative row as spending. That was wrong:
// "General Currency Conversion" rows are the CAD leg of a USD purchase already
// counted, "General Authorization" rows are pre-auth holds that later settle,
// and the two "User Initiated Withdrawal" rows were fully refunded.
// The reliable measure of real cash out is what PayPal pulled from the bank.
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
for (const f of fs.readdirSync(DIR).filter(x => /^paypal_/.test(x))) {
  const rows = parseCsv(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const h = rows[0].map(x => x.trim());
  const ix = n => h.indexOf(n);
  for (const r of rows.slice(1)) {
    const dmy = (r[ix('Date')] || '').split('/');
    if (dmy.length !== 3) continue;
    all.push({
      date: `${dmy[2]}-${dmy[1].padStart(2,'0')}-${dmy[0].padStart(2,'0')}`,
      name: (r[ix('Name')] || '').trim(),
      type: (r[ix('Type')] || '').trim(),
      total: parseFloat((r[ix('Total')] || '0').replace(/[^0-9.\-]/g, '')) || 0,
    });
  }
}
const months = [...new Set(all.map(r => r.date.slice(0, 7)))].sort();
const M = months.length;

// Settled outgoing spend: exclude FX legs, authorisations, voids, withdrawals.
const SPEND = /PreApproved Payment Bill User Payment|Express Checkout Payment|General Payment|Website Payment|^Other$/;
const spend = all.filter(r => r.total < 0 && SPEND.test(r.type));
const refunds = all.filter(r => r.total > 0 && /Refund/i.test(r.type));
const bankPulls = all.filter(r => r.total > 0 && /Bank Deposit to PP Account/i.test(r.type));

const gross = Math.abs(spend.reduce((s, r) => s + r.total, 0));
const refunded = refunds.reduce((s, r) => s + r.total, 0);
const pulled = bankPulls.reduce((s, r) => s + r.total, 0);

console.log(`months: ${M} (${months[0]} .. ${months[M-1]})`);
console.log(`settled spend            ${gross.toFixed(2).padStart(10)}   ~${(gross/M).toFixed(2)}/mo`);
console.log(`refunds received        +${refunded.toFixed(2).padStart(10)}`);
console.log(`net settled spend        ${(gross-refunded).toFixed(2).padStart(10)}   ~${((gross-refunded)/M).toFixed(2)}/mo`);
console.log(`bank funding pulled      ${pulled.toFixed(2).padStart(10)}   ~${(pulled/M).toFixed(2)}/mo   <- independent cross-check`);

const byName = new Map();
for (const r of spend) {
  const k = r.name || '(no merchant name)';
  const e = byName.get(k) || { n: 0, t: 0, months: new Set() };
  e.n++; e.t += Math.abs(r.total); e.months.add(r.date.slice(0, 7));
  byName.set(k, e);
}
console.log('\n=== SETTLED SPEND BY MERCHANT ===');
for (const [k, v] of [...byName.entries()].sort((a, b) => b[1].t - a[1].t))
  console.log(`  ${v.t.toFixed(2).padStart(9)}  ${String(v.n).padStart(3)}x  ${String(v.months.size).padStart(2)}mo  ${(v.t/M).toFixed(2).padStart(7)}/mo  ${k.slice(0,40)}`);

const CAT = [
  ['Gaming', /Sony|Nintendo|Meta Platforms|Epic Games|Blizzard/i],
  ['Apple Services', /Apple/i],
  ['Food delivery', /DoorDash|Uber/i],
  ['Streaming & media', /Netflix|Spotify|Cineplex|Patreon|PayRange/i],
  ['Creative software', /Adobe|IK MULTIMEDIA|Boutique Tones|amalgam|Guitar Tabs|FastSpring|Gumroad|Fiverr/i],
  ['Shopping & other', /.*/],
];
console.log('\n=== SETTLED SPEND BY CATEGORY ===');
const seen = new Set();
for (const [label, re] of CAT) {
  let t = 0, n = 0;
  for (const r of spend) {
    if (seen.has(r)) continue;
    if (re.test(r.name || '')) { t += Math.abs(r.total); n++; seen.add(r); }
  }
  if (n) console.log(`  ${t.toFixed(2).padStart(9)}  ${String(n).padStart(3)}x  ${(t/M).toFixed(2).padStart(7)}/mo  ${(t/gross*100).toFixed(1).padStart(5)}%  ${label}`);
}
