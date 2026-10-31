// Trace internal money movement as CHAINS, not pairs.
//
//   node scripts/transfer-chains.js <project-root>
//
// transfer-match.js pairs the two legs of an internal transfer using the
// five-character reference TD stamps on both sides. That works, and it matched
// 635 pairs with zero mismatches -- but it answers the wrong question.
//
// The 24 July Wise funding showed why. $1,000 left the HELOC, landed in
// Chequing A, and was e-transferred onward the SAME DAY. Pair matching sees a
// HELOC->Chequing A transfer and, separately, an anonymous e-transfer. Neither
// leg says the money was borrowed. ONE INTERMEDIATE HOP BREAKS THE TRAIL.
//
// So this walks forward instead: from every arrival, look for a departure of
// similar size within a few days, and keep walking. What it finds is where
// borrowed money actually ends up -- which is the question worth asking, since
// the HELOC is interest-only and anything funded from it is permanent debt.
//
// A chain is EVIDENCE OF TIMING, NOT PROOF OF PURPOSE. Money is fungible; a
// same-day match is strong, a three-day match much weaker. Every link carries
// its lag and its coverage ratio so the reader can judge it.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const RAW = path.join(root, 'raw');

const FILES = [
  ['chequingA_18mo.csv', 'Chequing A'],
  ['chequingB_18mo.csv', 'Chequing B'],
  ['savings_18mo.csv', 'Savings'],
  ['heloc_18mo.csv', 'HELOC'],
  [path.join('wife-td', 'debt-and-payments_18mo.csv'), 'DEBT&PAYMENTS'],
  [path.join('wife-td', 'savings-dont-touch_18mo.csv'), 'SAVINGS-DONT TOUCH'],
];

const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const day = d => new Date(d + 'T00:00:00Z').getTime() / 86400000;
const lag = (a, b) => day(b) - day(a);

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

const rows = [];
for (const [f, acct] of FILES) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())) {
    const c = splitCsv(line);
    rows.push({
      acct, date: (c[0] || '').trim(),
      desc: (c[1] || '').trim().toUpperCase().replace(/\s+/g, ' '),
      wd: parseFloat(c[2]) || 0, dep: parseFloat(c[3]) || 0,
    });
  }
}
rows.forEach((r, i) => { r.i = i; });

// ---------------------------------------------------------------- leg pairing
// TD reference: two letters then three digits, at the start of the description.
const REF = /^([A-Z]{2}\d{3}) TFR-(TO|FR) (\S+)/;
const refs = new Map();
for (const r of rows) {
  const m = r.desc.match(REF);
  if (!m) continue;
  r.code = m[1]; r.dir = m[2];
  if (!refs.has(r.code)) refs.set(r.code, []);
  refs.get(r.code).push(r);
}

const pairs = [], oneLeg = [];
for (const [code, legs] of refs) {
  if (legs.length === 2 && legs[0].dir !== legs[1].dir &&
      Math.abs((legs[0].wd || legs[0].dep) - (legs[1].wd || legs[1].dep)) < 0.01) {
    const from = legs.find(l => l.wd > 0), to = legs.find(l => l.dep > 0);
    if (from && to) { pairs.push({ code, from, to, amt: from.wd, date: from.date }); continue; }
  }
  for (const l of legs) oneLeg.push({ code, leg: l, other: l.desc.match(REF)[3] });
}

// Which account numbers belong to accounts we hold? Read them off the legs that
// DID pair: if a transfer to token T matched a deposit in account A, then T is A.
// This is derived from the data rather than configured, so it cannot go stale.
const tokenToAcct = new Map();
for (const p of pairs) {
  const t = p.from.desc.match(REF)[3], f = p.to.desc.match(REF)[3];
  if (t !== 'C/C') tokenToAcct.set(t, p.to.acct);
  if (f !== 'C/C') tokenToAcct.set(f, p.from.acct);
}

// ------------------------------------------------------------------ departures
// Everything that takes money OUT of an account and is not the outbound leg of
// an already-matched internal pair. These are the candidate next links.
const pairedOutIds = new Set(pairs.map(p => p.from.i));
const DEPART = /SEND E-TFR|TFR-TO|PYT TO|CAN TIRE MC|MBNA M\/C|AFFIRM|FLEXITI|TD MORTGAGE|CHQ#|TD WATERHOUSE|PAYPAL|WITHDRA/i;
const departures = rows.filter(r => r.wd > 0 && !pairedOutIds.has(r.i) && DEPART.test(r.desc));

function label(r) {
  if (/SEND E-TFR/i.test(r.desc)) return 'e-transfer out';
  if (/CHQ#/i.test(r.desc)) return 'cheque';
  if (/TD WATERHOUSE/i.test(r.desc)) return 'to investments';
  if (/PAYPAL/i.test(r.desc)) return 'PayPal funding';
  if (/CAN TIRE MC|MBNA M\/C|TFR-TO C\/C|PYT TO/i.test(r.desc)) return 'card / debt payment';
  if (/TD MORTGAGE/i.test(r.desc)) return 'mortgage';
  if (/WITHDRA/i.test(r.desc)) return 'cash out';
  return 'other outflow';
}

// -------------------------------------------------------------- chain walking
// From an arrival in account X, find the departure from X that best explains it:
// nearest in time, then closest in size. Require the departure to cover at least
// 90% of what arrived, so a $12 coffee is never offered as the onward leg of a
// $1,000 arrival.
const MAX_LAG = 3;
const usedDep = new Set();

function nextLink(acct, date, amt) {
  const cands = departures.filter(d =>
    d.acct === acct && !usedDep.has(d.i) &&
    lag(date, d.date) >= 0 && lag(date, d.date) <= MAX_LAG &&
    d.wd >= amt * 0.9);
  if (!cands.length) return null;
  cands.sort((a, b) =>
    (lag(date, a.date) - lag(date, b.date)) ||
    (Math.abs(a.wd - amt) - Math.abs(b.wd - amt)));
  return cands[0];
}

const chains = [];
for (const p of pairs.slice().sort((a, b) => a.date.localeCompare(b.date))) {
  const hops = [{ from: p.from.acct, to: p.to.acct, amt: p.amt, date: p.date, via: 'internal transfer', code: p.code }];
  let acct = p.to.acct, date = p.to.date, amt = p.amt;
  // Walk while the trail keeps moving through captured accounts.
  for (let depth = 0; depth < 4; depth++) {
    const d = nextLink(acct, date, amt);
    if (!d) break;
    usedDep.add(d.i);
    hops.push({ from: d.acct, to: label(d), amt: d.wd, date: d.date, via: label(d), lag: lag(date, d.date) });
    // Only an onward internal transfer continues the walk; everything else
    // leaves the captured set and the chain ends there.
    const onward = pairs.find(q => q.from.i === d.i);
    if (!onward) break;
    acct = onward.to.acct; date = onward.to.date; amt = onward.amt;
  }
  if (hops.length > 1) chains.push(hops);
}

console.log(`\n${rows.length} transactions across ${FILES.length} accounts\n`);
console.log(`matched pairs           : ${pairs.length}`);
console.log(`legs with no counterpart: ${oneLeg.length}   (the other account is outside the captured set)`);
console.log(`unpaired departures     : ${departures.length}`);
console.log(`\nCHAINS FOUND (transfer -> onward movement within ${MAX_LAG} days): ${chains.length}`);

// ------------------------------------------------------- what the HELOC funded
// The question the chains exist to answer. The HELOC is interest-only at 99.5%
// utilisation, so anything traceable out of it is permanent debt until somebody
// deliberately repays it.
const fromHeloc = chains.filter(c => c[0].from === 'HELOC');
const helocTotal = fromHeloc.reduce((s, c) => s + c[0].amt, 0);
console.log(`\n--- chains originating at the HELOC: ${fromHeloc.length}, ${money(helocTotal)} ---\n`);
const byEnd = {};
for (const c of fromHeloc) {
  const end = c[c.length - 1].via;
  byEnd[end] = byEnd[end] || { n: 0, amt: 0 };
  byEnd[end].n++; byEnd[end].amt += c[0].amt;
}
console.log('  ' + 'HELOC money ended as'.padEnd(24) + 'n'.padStart(5) + 'amount'.padStart(13));
for (const [k, v] of Object.entries(byEnd).sort((a, b) => b[1].amt - a[1].amt)) {
  console.log('  ' + k.padEnd(24) + String(v.n).padStart(5) + money(v.amt).padStart(13));
}

console.log('\n  Same-day HELOC chains (the strongest evidence — no ambiguity about lag):');
for (const c of fromHeloc.filter(c => c.every(h => !h.lag)).slice(0, 20)) {
  console.log('   ' + c[0].date + '  ' + money(c[0].amt).padStart(10) + '  ' +
              c.map(h => h.from).join(' -> ') + ' -> ' + c[c.length - 1].via);
}

// --------------------------------------------- what the HELOC funded DIRECTLY
// The chains above are the rare case. Most borrowed money never passes through a
// chequing account at all -- it leaves the HELOC in one hop, which is why the
// intermediate-hop worry turned out to be smaller than the direct spending.
console.log('\n--- money leaving the HELOC directly, no intermediate account ---\n');
const helocRows = rows.filter(r => r.acct === 'HELOC' && r.wd > 0);
const direct = {};
for (const r of helocRows) {
  const k = /^[A-Z]{2}\d{3} TFR-TO C\/C/.test(r.desc) ? 'credit card payments'
          : /^[A-Z]{2}\d{3} TFR-TO/.test(r.desc)      ? 'to own chequing/savings'
          : /SEND E-TFR FEE/.test(r.desc)             ? 'e-transfer fees'
          : /SEND E-TFR/.test(r.desc)                 ? 'e-transfers out (payee unnamed)'
          : /WITHDRA|CASH/.test(r.desc)               ? 'cash withdrawals'
          : /INTEREST/.test(r.desc)                   ? 'interest charged'
          : 'other';
  direct[k] = direct[k] || { n: 0, amt: 0 };
  direct[k].n++; direct[k].amt += r.wd;
}
console.log('  ' + 'Left the HELOC as'.padEnd(34) + 'n'.padStart(5) + 'amount'.padStart(14));
console.log('  ' + '-'.repeat(53));
for (const [k, v] of Object.entries(direct).sort((a, b) => b[1].amt - a[1].amt)) {
  console.log('  ' + k.padEnd(34) + String(v.n).padStart(5) + money(v.amt).padStart(14));
}
const helocOut = Object.values(direct).reduce((s, v) => s + v.amt, 0);
console.log('  ' + 'TOTAL'.padEnd(34) + String(helocRows.length).padStart(5) + money(helocOut).padStart(14));

// --------------------------------------------- where single legs point
// A transfer with only one leg captured means the other side was not in the
// data. That is NOT automatically an unknown account: a payment to a credit
// card reads exactly the same way, because the cards live in the statement
// ledger rather than in these exports. Splitting the two is the whole point --
// what is left after the cards come out is the B64 question, quantified.
console.log('\n--- transfers with only one leg captured, by destination ---\n');
const byToken = {};
for (const { leg, other } of oneLeg) {
  const known = tokenToAcct.get(other);
  const kind = other === 'C/C' ? 'credit card (in the card ledger, not here)'
             : known           ? `${known} (leg simply missing)`
                               : `UNIDENTIFIED account …${other}`;
  byToken[kind] = byToken[kind] || { n: 0, out: 0, in: 0 };
  byToken[kind].n++;
  if (leg.wd > 0) byToken[kind].out += leg.wd; else byToken[kind].in += leg.dep;
}
console.log('  ' + 'Destination'.padEnd(46) + 'n'.padStart(5) + 'out'.padStart(13) + 'in'.padStart(13));
console.log('  ' + '-'.repeat(76));
for (const [k, v] of Object.entries(byToken).sort((a, b) => b[1].out - a[1].out)) {
  console.log('  ' + k.padEnd(46) + String(v.n).padStart(5) + money(v.out).padStart(13) + money(v.in).padStart(13));
}
const unknown = Object.entries(byToken).filter(([k]) => k.startsWith('UNIDENTIFIED'));
const unkOut = unknown.reduce((s, [, v]) => s + v.out, 0);
const unkIn = unknown.reduce((s, [, v]) => s + v.in, 0);
console.log(`\n  ${unknown.length} account number(s) appear that are not in the captured set.`);
console.log(`  Out to them ${money(unkOut)} · back from them ${money(unkIn)} · net ${money(unkOut - unkIn)}`);
console.log('  Which household accounts they leave from:');
const fromWhere = {};
for (const { leg, other } of oneLeg) {
  if (other === 'C/C' || tokenToAcct.get(other) || leg.wd === 0) continue;
  const k = `${leg.acct} -> …${other}`;
  fromWhere[k] = fromWhere[k] || { n: 0, amt: 0 };
  fromWhere[k].n++; fromWhere[k].amt += leg.wd;
}
for (const [k, v] of Object.entries(fromWhere).sort((a, b) => b[1].amt - a[1].amt)) {
  console.log('    ' + k.padEnd(44) + String(v.n).padStart(4) + money(v.amt).padStart(13));
}

// ------------------------------------------------------------------- write out
const outDir = path.join(root, 'derived');
fs.mkdirSync(outDir, { recursive: true });
const lines = ['chain,hop,date,from,to,amount,lag_days,via'];
chains.forEach((c, ci) => c.forEach((h, hi) =>
  lines.push([ci, hi, h.date, h.from, h.to, h.amt.toFixed(2), h.lag === undefined ? '' : h.lag, h.via]
    .map(v => String(v).includes(',') ? `"${v}"` : v).join(','))));
fs.writeFileSync(path.join(outDir, 'transfer-chains.csv'), lines.join('\n') + '\n');
console.log(`\nWrote ${path.join(outDir, 'transfer-chains.csv')}`);
