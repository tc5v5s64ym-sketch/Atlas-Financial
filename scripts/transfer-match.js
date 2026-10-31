// Can transfers between household accounts be matched into pairs?
// TD prefixes each transfer with a 5-character reference (e.g. "UT564"). If the
// same reference appears on both sides, every internal movement can be traced
// end to end rather than guessed at.
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
function load(file, label) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
    .map(f => ({ acct: label, date: f[0].trim(), desc: (f[1] || '').trim().toUpperCase(),
                 wd: parseFloat(f[2]) || 0, dep: parseFloat(f[3]) || 0 }));
}

const rows = [
  ...load('chequingA_18mo.csv', 'Chequing A'),
  ...load('chequingB_18mo.csv', 'Chequing B'),
  ...load('savings_18mo.csv', 'Savings'),
  ...load('heloc_18mo.csv', 'HELOC'),
  ...load(path.join('wife-td', 'debt-and-payments_18mo.csv'), 'DEBT&PAYMENTS'),
  ...load(path.join('wife-td', 'savings-dont-touch_18mo.csv'), 'SAVINGS-DONT TOUCH'),
];
console.log(`loaded ${rows.length} transactions across ${new Set(rows.map(r => r.acct)).size} accounts\n`);

// TD reference: two letters then three digits, at the start of the description
const REF = /^([A-Z]{2}\d{3})\s+TFR-(TO|FR)\s+(\S+)/;
const refs = new Map();
let tagged = 0;
for (const r of rows) {
  const m = r.desc.match(REF);
  if (!m) continue;
  tagged++;
  const [, code, dir] = m;
  if (!refs.has(code)) refs.set(code, []);
  refs.get(code).push({ ...r, code, dir, amount: r.wd || r.dep });
}
console.log(`${tagged} transfers carry a reference code · ${refs.size} distinct codes`);

let paired = 0, unpaired = 0, mismatched = 0;
const examples = [];
for (const [code, legs] of refs) {
  if (legs.length === 2) {
    const [a, b] = legs;
    if (a.dir !== b.dir && Math.abs(a.amount - b.amount) < 0.01) {
      paired++;
      if (examples.length < 6) {
        const from = a.dir === 'TO' ? a : b, to = a.dir === 'TO' ? b : a;
        examples.push(`  ${code}  ${from.date}  $${from.amount.toFixed(2).padStart(9)}   ${from.acct}  →  ${to.acct}`);
      }
    } else mismatched++;
  } else unpaired++;
}
console.log(`\nfully matched pairs : ${paired}`);
console.log(`only one leg present: ${unpaired}   (the counterpart account is outside the captured set)`);
console.log(`same code, mismatch : ${mismatched}`);
console.log(`\nmatch rate where both legs exist: ${paired + mismatched ? (paired / (paired + mismatched) * 100).toFixed(1) : 0}%`);
console.log('\nexamples of end-to-end traced movements:');
examples.forEach(e => console.log(e));
