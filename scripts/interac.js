// The complete Interac e-transfer picture: in, out, and what nets.
//
//   node scripts/interac.js <project-root>
//
// TD uses SEVEN distinct descriptors and they do not mean the same thing.
// Treating them alike inflates income:
//
//   E-TRANSFER ***        money in, ordinary
//   E-TFR *** EPAY        money in, a distinct payment type
//   SEND E-TFR ***        money out
//   SEND E-TFR FEE        the $1 charge, not a transfer
//   EMS TO: / EMS FR:     the two legs of a transfer between the household's
//                         OWN accounts -- they cancel, and counting either as
//                         income or spending is double-counting
//   CANCEL E-TFR ***      an outgoing transfer that was never claimed, returned.
//                         Money coming back, NOT income.
//
// Names never appear in the bank data. Where raw/interac/*.csv holds an Interac
// email notification, this matches it on date and amount to attach one.

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

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

function kind(desc) {
  if (/SEND E-TFR FEE/i.test(desc)) return 'fee';
  if (/CANCEL E-TFR/i.test(desc)) return 'returned';
  if (/^EMS TO:/i.test(desc)) return 'own-out';
  if (/^EMS FR:/i.test(desc)) return 'own-in';
  if (/E-TFR .*EPAY/i.test(desc)) return 'in-epay';
  if (/^E-TRANSFER/i.test(desc)) return 'in';
  if (/SEND E-TFR/i.test(desc)) return 'out';
  return null;
}

const rows = [];
for (const [f, acct] of FILES) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())) {
    const c = splitCsv(line);
    const desc = (c[1] || '').trim();
    const k = kind(desc);
    if (!k) continue;
    rows.push({
      acct, date: (c[0] || '').trim(), kind: k,
      amt: (parseFloat(c[2]) || 0) + (parseFloat(c[3]) || 0),
      month: (c[0] || '').slice(0, 7),
    });
  }
}

// Attach names where an Interac notification was captured.
const named = [];
const nameDir = path.join(RAW, 'interac');
if (fs.existsSync(nameDir)) {
  for (const f of fs.readdirSync(nameDir).filter(f => f.endsWith('.csv'))) {
    const lines = fs.readFileSync(path.join(nameDir, f), 'utf8').split(/\r?\n/).filter(Boolean);
    lines.shift();
    for (const l of lines) {
      const [date, dir, amount, counterparty] = splitCsv(l);
      named.push({ date, dir, amt: Number(amount), counterparty });
    }
  }
}
// The bank posts a day or two after the transfer; allow a window.
//
// Match ONE notification to ONE bank row. The earlier version used find(), so a
// single notification named every transfer of the same amount within four days
// -- six $1,000 Wise fundings would all inherit one name, and an INCOMING
// notification could name an OUTGOING transfer. Both inflate the attribution
// rate with attributions that are not evidenced.
const dayDiff = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
const dirOk = (n, r) => (n.dir === 'OUT' ? r.kind === 'out' : r.kind === 'in' || r.kind === 'in-epay');
const claimed = new Set();
for (const n of named.slice().sort((a, b) => a.date.localeCompare(b.date))) {
  const cands = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r, i }) => !claimed.has(i) && dirOk(n, r) &&
                          Math.abs(n.amt - r.amt) < 0.01 && dayDiff(n.date, r.date) <= 4)
    .sort((a, b) => dayDiff(n.date, a.r.date) - dayDiff(n.date, b.r.date));
  if (!cands.length) continue;
  cands[0].r.counterparty = n.counterparty;
  claimed.add(cands[0].i);
}

const sum = k => rows.filter(r => r.kind === k).reduce((s, r) => s + r.amt, 0);
const cnt = k => rows.filter(r => r.kind === k).length;

console.log('\nINTERAC E-TRANSFERS — 18 months\n');
console.log('Type'.padEnd(34) + 'n'.padStart(5) + 'Amount'.padStart(13));
console.log('-'.repeat(52));
const LABEL = {
  'in':       'IN  ordinary',
  'in-epay':  'IN  EPAY type',
  'out':      'OUT sent',
  'returned': '..  returned unclaimed (not income)',
  'own-in':   '..  between own accounts (in leg)',
  'own-out':  '..  between own accounts (out leg)',
  'fee':      '..  $1 send fees',
};
for (const k of ['in', 'in-epay', 'out', 'returned', 'own-in', 'own-out', 'fee']) {
  console.log(LABEL[k].padEnd(34) + String(cnt(k)).padStart(5) + money(sum(k)).padStart(13));
}

const totalIn = sum('in') + sum('in-epay');
const totalOut = sum('out');
console.log('-'.repeat(52));
console.log('TRUE INCOMING'.padEnd(34) + String(cnt('in') + cnt('in-epay')).padStart(5) + money(totalIn).padStart(13));
console.log('TRUE OUTGOING'.padEnd(34) + String(cnt('out')).padStart(5) + money(totalOut).padStart(13));
console.log('NET'.padEnd(39) + money(totalIn - totalOut).padStart(13));
console.log(`\nPer month over 18: in ${money(totalIn / 18)}  out ${money(totalOut / 18)}  net ${money((totalIn - totalOut) / 18)}`);

console.log('\nBY ACCOUNT');
const accts = {};
for (const r of rows) {
  if (!['in', 'in-epay', 'out'].includes(r.kind)) continue;
  accts[r.acct] = accts[r.acct] || { in: 0, out: 0 };
  if (r.kind === 'out') accts[r.acct].out += r.amt; else accts[r.acct].in += r.amt;
}
console.log('  ' + 'Account'.padEnd(22) + 'In'.padStart(12) + 'Out'.padStart(12));
for (const [k, v] of Object.entries(accts).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out))) {
  console.log('  ' + k.padEnd(22) + money(v.in).padStart(12) + money(v.out).padStart(12));
}

console.log('\nINCOMING BY SIZE');
for (const [lo, hi, label] of [[3000, 1e9, '>= 3,000'], [1000, 3000, '1,000-3,000'], [300, 1000, '300-1,000'], [0, 300, '< 300']]) {
  const s = rows.filter(r => (r.kind === 'in' || r.kind === 'in-epay') && r.amt >= lo && r.amt < hi);
  console.log('  ' + label.padEnd(14) + String(s.length).padStart(4) + money(s.reduce((a, b) => a + b.amt, 0)).padStart(13));
}
console.log('\nOUTGOING BY SIZE');
for (const [lo, hi, label] of [[1000, 1e9, '>= 1,000'], [500, 1000, '500-1,000'], [200, 500, '200-500'], [0, 200, '< 200']]) {
  const s = rows.filter(r => r.kind === 'out' && r.amt >= lo && r.amt < hi);
  console.log('  ' + label.padEnd(14) + String(s.length).padStart(4) + money(s.reduce((a, b) => a + b.amt, 0)).padStart(13));
}

console.log('\nBY MONTH   (in / out / net)');
const months = [...new Set(rows.map(r => r.month))].filter(Boolean).sort();
for (const m of months) {
  const i = rows.filter(r => r.month === m && (r.kind === 'in' || r.kind === 'in-epay')).reduce((s, r) => s + r.amt, 0);
  const o = rows.filter(r => r.month === m && r.kind === 'out').reduce((s, r) => s + r.amt, 0);
  if (!i && !o) continue;
  console.log('  ' + m + money(i).padStart(12) + money(o).padStart(12) + money(i - o).padStart(12));
}

const withNames = rows.filter(r => r.counterparty);
console.log(`\nCOUNTERPARTY ATTRIBUTED: ${withNames.length} of ${cnt('in') + cnt('in-epay') + cnt('out')} ` +
            `(${((withNames.length / (cnt('in') + cnt('in-epay') + cnt('out'))) * 100).toFixed(0)}%)`);
console.log('  Names live in raw/interac/ and are deliberately not printed here.');

const outDir = path.join(root, 'derived');
fs.mkdirSync(outDir, { recursive: true });
const cols = ['date', 'acct', 'kind', 'amt', 'counterparty'];
fs.writeFileSync(path.join(outDir, 'interac.csv'),
  [cols.join(',')].concat(rows.sort((a, b) => a.date.localeCompare(b.date))
    .map(r => cols.map(c => {
      const v = r[c] === undefined ? '' : r[c];
      return String(v).includes(',') ? `"${v}"` : v;
    }).join(','))).join('\n') + '\n');
console.log(`\nWrote ${path.join(outDir, 'interac.csv')}`);
