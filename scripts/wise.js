// Parse a Wise transaction-history export into a funding, spending and cost summary.
//
//   node scripts/wise.js raw/wise/<export>.csv
//
// Wise records one trip across several row types, and adding them up naively
// double-counts badly:
//
//   TRANSFER            IN  -- money added from an outside account (real funding)
//   BALANCE_TRANSACTION     -- an internal CAD->USD conversion, NOT spending
//   CARD_TRANSACTION    OUT -- the actual purchase
//   CARD_ORDER / BANK_DETAILS_ORDER -- one-off Wise fees
//
// Only CARD_TRANSACTION rows are spending. The conversions merely move the same
// money between currency buckets; counting them as well would roughly double the
// total. Same trap as PayPal's four-rows-per-purchase -- see scripts/paypal-settled.js.
//
// The "Source name" column holds the account holder's home address. It is never
// read, printed or written by this script.

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/wise.js <export.csv>'); process.exit(1); }

// --- minimal RFC4180 CSV reader (quoted fields contain commas) ---------------
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); if (row.some(x => x !== '')) rows.push(row); row = []; field = ''; }
    else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

const raw = fs.readFileSync(file, 'utf8');
const rows = parseCsv(raw);
const head = rows.shift().map(h => h.trim());
const col = n => head.indexOf(n);

const C = {
  id: col('ID'), status: col('Status'), dir: col('Direction'),
  created: col('Created on'),
  srcFee: col('Source fee amount'), srcFeeCcy: col('Source fee currency'),
  srcAmt: col('Source amount (after fees)'), srcCcy: col('Source currency'),
  tgtName: col('Target name'), tgtAmt: col('Target amount (after fees)'), tgtCcy: col('Target currency'),
  rate: col('Exchange rate'), by: col('Created by'), cat: col('Category'),
};

const num = v => { const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };
const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const txns = rows
  .filter(r => (r[C.status] || '').trim() === 'COMPLETED')
  .map(r => ({
    kind: (r[C.id] || '').split('-')[0],
    dir: (r[C.dir] || '').trim(),
    date: (r[C.created] || '').slice(0, 10),
    srcFee: num(r[C.srcFee]), srcFeeCcy: (r[C.srcFeeCcy] || '').trim(),
    srcAmt: num(r[C.srcAmt]), srcCcy: (r[C.srcCcy] || '').trim(),
    merchant: (r[C.tgtName] || '').trim(),
    tgtAmt: num(r[C.tgtAmt]), tgtCcy: (r[C.tgtCcy] || '').trim(),
    rate: num(r[C.rate]),
    by: (r[C.by] || '').trim(),
    cat: (r[C.cat] || '').trim() || 'Uncategorised',
  }));

const dates = txns.map(t => t.date).filter(Boolean).sort();

// --- funding: money added from outside, less anything sent back --------------
const fundIn = txns.filter(t => t.kind === 'TRANSFER' && t.dir === 'IN');
const fundOut = txns.filter(t => t.kind === 'TRANSFER' && t.dir === 'OUT');

// Top-ups whose only purpose is to pay a Wise invoice are not trip funding.
const isInvoice = t => /^invoice-/.test(t.merchant) || false;
const bySource = {};
for (const t of fundIn) {
  const key = t.srcCcy === 'CAD' ? 'CAD' : t.srcCcy;
  bySource[t.by + '|' + key] = 0; // placeholder so ordering is stable
}

// --- spending: card transactions only ---------------------------------------
const cards = txns.filter(t => t.kind === 'CARD_TRANSACTION');
const spendUsd = cards.filter(t => t.tgtCcy === 'USD').reduce((s, t) => s + t.tgtAmt, 0);
const spendOther = cards.filter(t => t.tgtCcy !== 'USD').reduce((s, t) => s + t.tgtAmt, 0);

// --- conversions and every fee ----------------------------------------------
const convs = txns.filter(t => t.kind === 'BALANCE_TRANSACTION');
const convCad = convs.reduce((s, t) => s + t.srcAmt, 0);
const convUsd = convs.reduce((s, t) => s + t.tgtAmt, 0);
const convFee = convs.reduce((s, t) => s + t.srcFee, 0);
const cardFee = cards.reduce((s, t) => s + t.srcFee, 0);
const setup = txns.filter(t => t.kind === 'CARDORDER' || t.kind === 'CARD_ORDER' || t.kind === 'BANK_DETAILS_ORDER' || /ORDER$/.test(t.kind));
const setupFee = setup.filter(t => t.dir === 'OUT').reduce((s, t) => s + t.srcAmt, 0);

const group = (list, keyFn, amtFn) => {
  const m = {};
  for (const t of list) m[keyFn(t)] = (m[keyFn(t)] || 0) + amtFn(t);
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
};

console.log(`\nWise — ${dates[0]} to ${dates[dates.length - 1]}   (${txns.length} completed rows)\n`);

console.log('FUNDING IN (CAD)');
for (const [k, v] of group(fundIn.filter(t => !isInvoice(t)), t => t.srcCcy, t => t.srcAmt)) {
  console.log(`  total ${k}`.padEnd(28) + money(v).padStart(12));
}
for (const [k, v] of group(fundOut, t => 'sent back out ' + t.srcCcy, t => t.srcAmt)) {
  console.log(`  ${k}`.padEnd(28) + ('-' + money(v)).padStart(12));
}
const netFund = fundIn.reduce((s, t) => s + t.srcAmt, 0) - fundOut.reduce((s, t) => s + t.srcAmt, 0);
console.log('  NET FUNDED'.padEnd(28) + money(netFund).padStart(12));

console.log('\nSPENDING — card transactions only');
console.log('  USD'.padEnd(28) + money(spendUsd).padStart(12));
if (spendOther) console.log('  other currency'.padEnd(28) + money(spendOther).padStart(12));
console.log(`  ${cards.length} card transactions`);

console.log('\nBY CATEGORY (USD)');
for (const [k, v] of group(cards.filter(t => t.tgtCcy === 'USD'), t => t.cat, t => t.tgtAmt)) {
  console.log(`  ${k}`.padEnd(28) + money(v).padStart(12));
}

console.log('\nBY CARDHOLDER (USD)');
for (const [k, v] of group(cards.filter(t => t.tgtCcy === 'USD'), t => t.by, t => t.tgtAmt)) {
  console.log(`  ${k}`.padEnd(28) + money(v).padStart(12));
}

console.log('\nTOP MERCHANTS (USD)');
for (const [k, v] of group(cards.filter(t => t.tgtCcy === 'USD'), t => t.merchant, t => t.tgtAmt).slice(0, 12)) {
  console.log(`  ${k}`.padEnd(28) + money(v).padStart(12));
}

console.log('\nCONVERSIONS AND COST');
console.log('  converted CAD'.padEnd(28) + money(convCad).padStart(12));
console.log('  received USD'.padEnd(28) + money(convUsd).padStart(12));
if (convUsd) console.log('  effective rate'.padEnd(28) + (convUsd / convCad).toFixed(4).padStart(12));
console.log('  conversion fees CAD'.padEnd(28) + money(convFee).padStart(12));
console.log('  card FX fees CAD'.padEnd(28) + money(cardFee).padStart(12));
console.log('  setup fees CAD'.padEnd(28) + money(setupFee).padStart(12));
console.log('  TOTAL FEES CAD'.padEnd(28) + money(convFee + cardFee + setupFee).padStart(12));

// derived/ must sit beside the raw/ the input came from, not beside this script
// -- the script may be running from a git worktree that has no raw/ at all.
const inDir = path.dirname(path.resolve(file));
const outDir = inDir.includes(`${path.sep}raw${path.sep}`) || inDir.endsWith(`${path.sep}raw`)
  ? inDir.replace(`${path.sep}raw`, `${path.sep}derived`)
  : path.join(__dirname, '..', 'derived', 'wise');
fs.mkdirSync(outDir, { recursive: true });
const cols = ['date', 'kind', 'dir', 'merchant', 'cat', 'by', 'tgtAmt', 'tgtCcy', 'srcAmt', 'srcCcy', 'srcFee'];
const outFile = path.join(outDir, path.basename(file, '.csv') + '-parsed.csv');
fs.writeFileSync(outFile,
  [cols.join(',')].concat(txns.map(t => cols.map(c => {
    const v = t[c]; return typeof v === 'string' && v.includes(',') ? `"${v}"` : v;
  }).join(','))).join('\n') + '\n');
console.log(`\nWrote ${outFile}`);
