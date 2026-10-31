// What does youth lacrosse actually cost this household?  [B62]
//
//   node scripts/lacrosse.js <project-root>
//
// The category is systematically understated by any analysis built on bank
// exports, because clubs prefer e-transfer and TD's export never names the
// other side of one. So this pulls from every source that can see part of it
// and keeps the evidence grade attached to each:
//
//   cards        merchant names are full and unambiguous          VERIFIED
//   chequing     merchant names truncated to ~15 characters       VERIFIED
//   e-transfers  named only where an Interac email survived       VERIFIED
//   e-transfers  amount and date match a fee notice in the inbox  INFERRED
//
// The inferred tier is reported SEPARATELY and never folded into the verified
// figure. A same-day match between "$400 per player, please send etransfer"
// and a $400 e-transfer is strong, but it is still an inference, and the whole
// value of this project is that the two are never quietly mixed.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const norm = s => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function readCsv(p) {
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const head = splitCsv(lines.shift()).map(h => h.trim());
  return lines.map(l => { const c = splitCsv(l), o = {}; head.forEach((h, i) => o[h] = c[i]); return o; });
}

// Clubs, associations, tournaments and lacrosse-specific retail. Deliberately
// NOT a general sport list: Sport Chek, Dick's and adidas sell lacrosse gear but
// sell everything else too, and counting them would turn a floor into a guess.
const CLUBS = [
  'FUSIONWESTLACROSSE', 'FUSIONWES', 'RIDGEMEADOWSMINORLA', 'RIDGEMEADOWSMINOR',
  'MVPATHLETRIDGEMEAD', 'RMSCTITANS', 'CITYSIDELAX', 'PROCALIBER', 'VENOMCUSTOMSTICKS',
  'BCSIXESLA', 'LOADINGLAC', 'USLACROSS', 'USBOXLA', 'BURRARDS',
];
// The same town runs lacrosse and soccer through Square, and TD truncates both
// to "SQ *RIDGE MEADO". The cards show the full string and prove the soccer one
// exists, so the truncated chequing rows cannot be assigned either way.
const AMBIGUOUS = ['SQRIDGEMEADO'];
const EXCLUDE = ['SOCCER'];
const isLax = s => {
  const n = norm(s);
  if (EXCLUDE.some(p => n.includes(p))) return false;
  return CLUBS.some(p => n.includes(p));
};
const isAmbiguous = s => {
  const n = norm(s);
  return !isLax(s) && !EXCLUDE.some(p => n.includes(p)) && AMBIGUOUS.some(p => n.includes(p));
};

const found = { card: [], chequing: [], etfr: [] };
const ambiguous = [];

// --- cards -----------------------------------------------------------------
for (const r of readCsv(path.join(root, 'derived', 'card-transactions.csv'))) {
  if (r.kind !== 'purchase' || !isLax(r.merchant)) continue;
  found.card.push({ date: r.iso, amt: Number(r.amount), who: r.merchant, src: r.card });
}

// --- chequing --------------------------------------------------------------
const CHEQUING = [
  ['chequingA_18mo.csv', 'Chequing A'], ['chequingB_18mo.csv', 'Chequing B'],
  ['savings_18mo.csv', 'Savings'],
  [path.join('wife-td', 'debt-and-payments_18mo.csv'), 'DEBT&PAYMENTS'],
  [path.join('wife-td', 'savings-dont-touch_18mo.csv'), 'SAVINGS-DONT TOUCH'],
];
for (const [f, acct] of CHEQUING) {
  const p = path.join(root, 'raw', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())) {
    const c = splitCsv(line);
    const desc = (c[1] || '').trim().replace(/\s+_[A-Z]$/, '');
    const wd = parseFloat(c[2]) || 0;
    if (wd <= 0) continue;
    const row = { date: (c[0] || '').trim(), amt: wd, who: desc, src: acct };
    if (isLax(desc)) found.chequing.push(row);
    else if (isAmbiguous(desc)) ambiguous.push(row);
  }
}

// --- e-transfers with a name -----------------------------------------------
for (const r of readCsv(path.join(root, 'derived', 'interac.csv'))) {
  if (r.kind !== 'out' || !r.counterparty || !isLax(r.counterparty)) continue;
  found.etfr.push({ date: r.date, amt: Number(r.amt), who: r.counterparty, src: r.acct });
}

// --- inferred: fee notices in the inbox matched to an e-transfer ------------
// Each row is an amount a club stated in writing, and an e-transfer of exactly
// that amount on the day the notice arrived. Evidence of timing and size, not a
// named payee -- which is why it is kept out of the verified total.
const INFERRED = [
  { date: '2026-04-15', amt: 400.00, acct: 'HELOC',
    note: 'Burrards U13-A2 team fee, "$400 per player, please send etransfer" (TeamSnap, 15 Apr 2026 10:06am) — e-transfer of $400.00 left the HELOC the same day' },
];

const sum = a => a.reduce((s, x) => s + x.amt, 0);
const group = a => {
  const g = {};
  for (const x of a) { const k = x.who.slice(0, 34); g[k] = g[k] || { n: 0, amt: 0 }; g[k].n++; g[k].amt += x.amt; }
  return Object.entries(g).sort((a, b) => b[1].amt - a[1].amt);
};

console.log('\nYOUTH LACROSSE — what the captured data can actually see\n');
for (const [key, label] of [['card', 'CARDS'], ['chequing', 'CHEQUING (debit)'], ['etfr', 'E-TRANSFERS (named)']]) {
  const a = found[key];
  console.log(`${label} — ${a.length} charges, ${money(sum(a))}`);
  for (const [who, v] of group(a)) console.log('   ' + money(v.amt).padStart(10) + '  ' + String(v.n).padStart(2) + 'x  ' + who);
  console.log('');
}

const verified = sum(found.card) + sum(found.chequing) + sum(found.etfr);
const nVer = found.card.length + found.chequing.length + found.etfr.length;
console.log('-'.repeat(62));
console.log('VERIFIED FLOOR'.padEnd(34) + String(nVer).padStart(5) + money(verified).padStart(14));
console.log('-'.repeat(62));

console.log(`\nINFERRED, reported separately — ${INFERRED.length} item(s), ${money(sum(INFERRED))}`);
for (const x of INFERRED) console.log(`   ${x.date}  ${money(x.amt).padStart(9)}  from ${x.acct}\n      ${x.note}`);

if (ambiguous.length) {
  console.log(`\nAMBIGUOUS, excluded from the floor — ${ambiguous.length} charges, ${money(sum(ambiguous))}`);
  for (const [who, v] of group(ambiguous)) console.log('   ' + money(v.amt).padStart(10) + '  ' + String(v.n).padStart(2) + 'x  ' + who + '   (lacrosse or soccer — truncation cannot say)');
}

console.log(`\nVerified + inferred: ${money(verified + sum(INFERRED))}`);

// --- what it costs per month, and where it is funded from -------------------
const dates = [...found.card, ...found.chequing, ...found.etfr].map(x => x.date).filter(Boolean).sort();
const months = dates.length
  ? (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000 / 30.44 : 1;
console.log(`\nSpread over ${months.toFixed(1)} months of coverage: about ${money(verified / months)} a month.`);

const bySrc = {};
for (const x of [...found.card, ...found.chequing, ...found.etfr]) {
  bySrc[x.src] = bySrc[x.src] || { n: 0, amt: 0 };
  bySrc[x.src].n++; bySrc[x.src].amt += x.amt;
}
console.log('\nWhat it was paid with:');
for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1].amt - a[1].amt)) {
  console.log('   ' + k.padEnd(22) + String(v.n).padStart(4) + money(v.amt).padStart(12));
}

console.log('\nStill a FLOOR, and the gap is knowable in size if not in detail:');
const interac = readCsv(path.join(root, 'derived', 'interac.csv'));
const unnamedOut = interac.filter(r => r.kind === 'out' && !r.counterparty);
console.log(`   ${unnamedOut.length} outgoing e-transfers, ${money(unnamedOut.reduce((s, r) => s + Number(r.amt), 0))}, still carry no payee.`);
console.log('   Club fees are paid by e-transfer precisely because clubs prefer it, so');
console.log('   an unknown share of that sits in this category and cannot be seen.');
