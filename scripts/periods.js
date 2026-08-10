// Build the monthly series the site's period selector needs.
//
//   node scripts/periods.js <project-root> [asOf YYYY-MM-DD]
//
// Writes derived/periods.json and prints a summary.
//
// One transaction ledger, three lenses: spending, interest, fees. Sources:
//
//   derived/card-spending.csv      categorised card purchases (12 months)
//   derived/card-transactions.csv  card interest and fees
//   raw/*.csv                      chequing spending and bank fees (18 months)
//
// The two windows differ -- cards start Aug 2025, chequing Feb 2025 -- so a
// month before Aug 2025 has chequing only. The site must say so rather than
// imply spending fell off a cliff.
//
// PayPal pulls are funding, not spending: what was bought sits in the PayPal
// exports. Counting both double-counts. Same for card payments and transfers.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const asOf = process.argv[3] || '2026-08-09';
const RAW = path.join(root, 'raw');
const DER = path.join(root, 'derived');

const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

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
  const head = splitCsv(lines.shift());
  return lines.map(l => {
    const c = splitCsv(l), o = {};
    head.forEach((h, i) => o[h.trim()] = c[i]);
    return o;
  });
}

// --- merchant library, shared with the categorisers -------------------------
const libPath = fs.existsSync(path.join(root, 'docs', 'merchant-library.csv'))
  ? path.join(root, 'docs', 'merchant-library.csv')
  : path.join(__dirname, '..', 'docs', 'merchant-library.csv');
const lib = readCsv(libPath).map(r => ({ pattern: r.pattern, category: r.category, type: r.type }));

function classify(desc) {
  const n = norm(desc);
  for (const r of lib) if (r.pattern && n.includes(r.pattern)) return [r.category, r.type];
  return ['Uncategorised', 'unknown'];
}

// --- what is not spending ---------------------------------------------------
const INTERNAL = /TFR-(TO|FR)|SEND E-TFR|E-TRANSFER|E-TFR|ATM DEP|CASH WITHDRA|ATM W\/D|PTS FRM|EMS (FR|TO)|CANCEL|TD WATERHOUSE/i;
const DEBT     = /TD MORTGAGE|CAN TIRE MC|MBNA M\/C|AFFIRM|FLEXITI|PYT TO|PAYMENT TO|TO:TD C\/C/i;
const PAYPAL   = /^PAYPAL/i;
const CHEQUE   = /^CHQ#/i;

// Interest must be tested BEFORE fees and before spending. A bare "INTEREST"
// row on the HELOC is an $814 monthly charge; left to fall through it lands in
// spending and inflates every category total.
const INTEREST_RULES = [
  [/OVERDRAFT INTEREST/i, 'Overdraft interest'],
  [/^INTEREST$|RETAIL ?INTEREST|CASH ?INTEREST|INTEREST CHARGE/i, 'Interest'],
];
function interestKind(desc, acct) {
  for (const [re, label] of INTEREST_RULES) {
    if (re.test(desc)) return label === 'Interest' ? (acct || 'Interest') : label;
  }
  return null;
}

// Fees, named so the dashboard can split avoidable from structural.
// TD abbreviates. "O.D.P. FEE" is overdraft protection and never matches a rule
// written as /OVERDRAFT/, so $90.00 of fees was landing in SPENDING instead --
// wrong in both dashboards at once. Match the abbreviation explicitly.
const FEE_RULES = [
  [/NSF/i,                          'NSF fee',                'avoidable'],
  [/OVERDRAFT|O\.?D\.?P\.? FEE/i,   'Overdraft protection',   'structural'],
  [/MONTHLY ACCOUNT FEE/i,          'Monthly account fee',    'structural'],
  [/CHQ RETURN FEE/i,               'Cheque return fee',      'avoidable'],
  [/SEND E-TFR FEE|E-TFR FEE/i,     'E-transfer fee',         'structural'],
  [/PAYMENT COVERAGE FEE/i,         'Payment coverage fee',   'avoidable'],
  [/WITHDRAWAL FEE|NON-TD ATM/i,    'Out-of-network ATM',     'avoidable'],
  [/FX ATM W\/D FEE/i,              'Foreign ATM fee',        'avoidable'],
  [/OVERLIMIT/i,                    'Over-limit fee',         'avoidable'],
  [/SERVICE CHARGE/i,               'Service charge',         'structural'],
];
function feeKind(desc) {
  for (const [re, label, kind] of FEE_RULES) if (re.test(desc)) return [label, kind];
  return null;
}

const CHEQUING = [
  ['chequingA_18mo.csv', 'Chequing A'],
  ['chequingB_18mo.csv', 'Chequing B'],
  ['savings_18mo.csv', 'Savings'],
  ['heloc_18mo.csv', 'HELOC'],
  [path.join('wife-td', 'debt-and-payments_18mo.csv'), 'DEBT&PAYMENTS'],
  [path.join('wife-td', 'savings-dont-touch_18mo.csv'), 'SAVINGS-DONT TOUCH'],
];

const events = [];   // {month, kind, category, type, amount, source}

// chequing: spending + fees
for (const [f, acct] of CHEQUING) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())) {
    const c = splitCsv(line);
    const date = (c[0] || '').trim();
    const desc = (c[1] || '').trim().replace(/\s+_[A-Z]$/, '').trim();
    const wd = parseFloat(c[2]) || 0;
    if (!date || wd <= 0) continue;
    const month = date.slice(0, 7);

    const int = interestKind(desc, acct);
    if (int) { events.push({ month, kind: 'interest', category: int, type: 'structural', amount: wd, source: acct }); continue; }

    const fee = feeKind(desc);
    if (fee) { events.push({ month, kind: 'fee', category: fee[0], type: fee[1], amount: wd, source: acct }); continue; }
    if (INTERNAL.test(desc) || DEBT.test(desc) || PAYPAL.test(desc) || CHEQUE.test(desc)) continue;

    // The HELOC is a credit facility: its withdrawals are advances and
    // transfers, never household purchases. Only its interest belongs here.
    if (acct === 'HELOC') continue;

    const [cat, type] = classify(desc);
    events.push({ month, kind: 'spend', category: cat, type, amount: wd, source: 'chequing' });
  }
}

// cards: categorised purchases
for (const r of readCsv(path.join(DER, 'card-spending.csv'))) {
  if (!r.iso) continue;
  events.push({
    month: r.iso.slice(0, 7), kind: 'spend',
    category: r.category, type: r.type, amount: Number(r.amount) || 0, source: 'card',
  });
}

// The ledger uses internal card ids; the site shows these to a human.
const CARD_NAME = {
  'cashback': 'TD Cash Back Visa',
  'travelvisa': 'Travel Visa',
  'amazon-mbna': 'Amazon Mastercard',
  'personal-visa': 'TD personal Visa',
};

// cards: interest and fees, split apart
for (const r of readCsv(path.join(DER, 'card-transactions.csv'))) {
  if (r.kind !== 'cost' || !r.iso) continue;
  const amt = Number(r.amount) || 0;
  const isFee = /FEE|OVERLIMIT/i.test(r.merchant || '');
  events.push({
    month: r.iso.slice(0, 7),
    kind: isFee ? 'fee' : 'interest',
    category: isFee ? 'Over-limit fee' : (CARD_NAME[r.card] || r.card || 'Card'),
    type: isFee ? 'avoidable' : 'structural',
    amount: amt, source: r.card,
  });
}

// --- period definitions -----------------------------------------------------
// A root without raw/ and derived/ (a fresh clone, or a worktree — they are
// local-only) yields zero events, and writing that out publishes a page of
// $0.00s. Refuse instead: this exact mistake shipped an empty dashboard once.
if (events.length === 0) {
  console.error(`FATAL: no events found under ${root}`);
  console.error(`  raw/:     ${fs.existsSync(RAW) ? 'present' : 'MISSING'}`);
  console.error(`  derived/: ${fs.existsSync(DER) ? 'present' : 'MISSING'}`);
  console.error('Point the first argument at the checkout that holds the data, e.g.');
  console.error('  node scripts/periods.js C:\\Users\\dnaud\\Documents\\atlas-financial 2026-08-09');
  process.exit(1);
}

const thisMonth = asOf.slice(0, 7);
const d = new Date(asOf + 'T00:00:00');
d.setMonth(d.getMonth() - 1);
const lastMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const year = asOf.slice(0, 4);

const PERIODS = {
  thisMonth: { label: `This month (${thisMonth})`, test: m => m === thisMonth },
  lastMonth: { label: `Last month (${lastMonth})`, test: m => m === lastMonth },
  ytd:       { label: `Year to date (${year})`,    test: m => m.startsWith(year) },
  all:       { label: 'All captured (18 months)',  test: () => true },
};

const months = [...new Set(events.map(e => e.month))].filter(Boolean).sort();

function rollup(test) {
  const sel = events.filter(e => test(e.month));
  const byCat = {}, byFee = {}, byInt = {};
  for (const e of sel) {
    if (e.kind === 'spend') {
      byCat[e.category] = byCat[e.category] || { total: 0, type: e.type };
      byCat[e.category].total += e.amount;
    } else if (e.kind === 'fee') {
      byFee[e.category] = byFee[e.category] || { total: 0, type: e.type };
      byFee[e.category].total += e.amount;
    } else {
      byInt[e.category] = byInt[e.category] || { total: 0 };
      byInt[e.category].total += e.amount;
    }
  }
  const arr = (o, extra) => Object.entries(o)
    .map(([label, v]) => ({ label, total: Math.round(v.total * 100) / 100, ...(extra ? { type: v.type } : {}) }))
    .sort((a, b) => b.total - a.total);
  const monthsIn = [...new Set(sel.map(e => e.month))].length || 1;
  return {
    months: monthsIn,
    spending: arr(byCat, true),
    spendingTotal: Math.round(sel.filter(e => e.kind === 'spend').reduce((s, e) => s + e.amount, 0) * 100) / 100,
    fees: arr(byFee, true),
    feesTotal: Math.round(sel.filter(e => e.kind === 'fee').reduce((s, e) => s + e.amount, 0) * 100) / 100,
    interest: arr(byInt, false),
    interestTotal: Math.round(sel.filter(e => e.kind === 'interest').reduce((s, e) => s + e.amount, 0) * 100) / 100,
  };
}

const out = { asOf, thisMonth, lastMonth, periods: {}, monthly: [] };
for (const [k, v] of Object.entries(PERIODS)) {
  out.periods[k] = { label: v.label, ...rollup(v.test) };
}
for (const m of months) {
  const sel = events.filter(e => e.month === m);
  out.monthly.push({
    m,
    spending: Math.round(sel.filter(e => e.kind === 'spend').reduce((s, e) => s + e.amount, 0) * 100) / 100,
    interest: Math.round(sel.filter(e => e.kind === 'interest').reduce((s, e) => s + e.amount, 0) * 100) / 100,
    fees: Math.round(sel.filter(e => e.kind === 'fee').reduce((s, e) => s + e.amount, 0) * 100) / 100,
    cardsCovered: m >= '2025-08',
  });
}

fs.mkdirSync(DER, { recursive: true });
fs.writeFileSync(path.join(DER, 'periods.json'), JSON.stringify(out, null, 2));

// Published copy. It lives in public/ rather than inside data.json because it is
// GENERATED and data.json is hand-curated -- merging them would make every
// rebuild rewrite a file people edit by hand. The auth gate in server.js covers
// everything except /login, /styles.css and /robots.txt, so this is protected.
const pub = path.join(__dirname, '..', 'public', 'periods.json');
fs.writeFileSync(pub, JSON.stringify(out));
console.log(`Wrote ${pub}`);

console.log(`\nPeriods built from ${events.length} events across ${months.length} months\n`);
console.log('Period'.padEnd(30) + 'Spending'.padStart(12) + 'Interest'.padStart(11) + 'Fees'.padStart(10) + 'Months'.padStart(8));
console.log('-'.repeat(71));
for (const [k, p] of Object.entries(out.periods)) {
  console.log(p.label.padEnd(30) + money(p.spendingTotal).padStart(12) +
              money(p.interestTotal).padStart(11) + money(p.feesTotal).padStart(10) + String(p.months).padStart(8));
}
console.log(`\nWrote ${path.join(DER, 'periods.json')}`);
