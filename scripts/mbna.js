// Parse decrypted MBNA (Amazon.ca Rewards Mastercard) statement text into a
// month-by-month summary.
//
// Input:  derived/mbna/*.txt, produced by
//           node scripts/pdfdecrypt.js raw/statements-mbna/<f>.pdf 400000 > derived/mbna/<f>.txt
// Output: a summary table on stdout, and derived/mbna/summary.csv
//
// Deliberately field-level. MBNA's extracted text carries no line breaks, so a
// line-oriented grep returns an entire page -- including cardholder name, home
// address and the masked card number. Every regex here captures a single
// labelled figure, so nothing identifying is ever printed.

const fs = require('fs');
const path = require('path');

const dir = process.argv[2] || path.join(__dirname, '..', 'derived', 'mbna');

// The text runs together with no spaces, so labels are matched unspaced too.
const FIELDS = {
  closing:      /StatementClosingDate([A-Za-z]+\d{1,2},\d{4})/,
  days:         /DaysinStatementPeriod(\d+)/,
  prevBalance:  /PreviousStatementBalance\$([\d,]+\.\d{2})/,
  payments:     /Payments-?\$([\d,]+\.\d{2})/,
  purchases:    /NewPurchases\$([\d,]+\.\d{2})/,
  transfers:    /BalanceTransfersandAccessCheques\$([\d,]+\.\d{2})/,
  cashAdv:      /CashAdvances\$([\d,]+\.\d{2})/,
  interest:     /Interest\$([\d,]+\.\d{2})/,
  fees:         /Fees\$([\d,]+\.\d{2})/,
  newBalance:   /YourNewBalance\$([\d,]+\.\d{2})/,
  creditLimit:  /CreditLimit\$([\d,]+\.\d{2})/,
  available:    /CreditAvailable\$([\d,]+\.\d{2})/,
  minPayment:   /YourMinimumPayment\$([\d,]+\.\d{2})/,
  dueDate:      /YourMinimumPaymentDueDate([A-Za-z]+\d{1,2},\d{4})/,
  airPurchase:  /AnnualInterestRateforPurchases([\d.]+)%/,
  airTransfer:  /AnnualInterestRateforBalanceTransfersandAccessCheques([\d.]+)%/,
  airCash:      /AnnualInterestRateforCashAdvances([\d.]+)%/,
  payoffYears:  /is(\d+)year\(s\)and(\d+)month\(s\)/,
};

const num = s => (s === undefined ? null : Number(String(s).replace(/,/g, '')));

const rows = [];
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.txt')).sort()) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\0/g, '');
  const r = { file: f };
  for (const [k, re] of Object.entries(FIELDS)) {
    const m = raw.match(re);
    if (!m) { r[k] = null; continue; }
    if (k === 'payoffYears') r[k] = `${m[1]}y ${m[2]}m`;
    else if (k === 'closing' || k === 'dueDate') r[k] = m[1];
    else r[k] = num(m[1]);
  }
  rows.push(r);
}

const money = v => (v === null ? '—' : v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','));

console.log('\nMBNA / Amazon.ca Rewards Mastercard — statement history\n');
console.log(
  'Closing'.padEnd(20) + 'Opening'.padStart(11) + 'Payments'.padStart(11) +
  'Purchases'.padStart(11) + 'Interest'.padStart(10) + 'Fees'.padStart(8) +
  'Closing bal'.padStart(13) + 'AIR'.padStart(8) + '  Est. payoff');
console.log('-'.repeat(100));

let totPay = 0, totPur = 0, totInt = 0, totFee = 0;
for (const r of rows) {
  totPay += r.payments || 0;
  totPur += r.purchases || 0;
  totInt += r.interest || 0;
  totFee += r.fees || 0;
  console.log(
    String(r.closing || r.file).padEnd(20) +
    money(r.prevBalance).padStart(11) + money(r.payments).padStart(11) +
    money(r.purchases).padStart(11) + money(r.interest).padStart(10) +
    money(r.fees).padStart(8) + money(r.newBalance).padStart(13) +
    ((r.airPurchase !== null ? r.airPurchase.toFixed(2) + '%' : '—')).padStart(8) +
    '  ' + (r.payoffYears || '—'));
}
console.log('-'.repeat(100));
console.log(
  'TOTALS'.padEnd(20) + ''.padStart(11) + money(totPay).padStart(11) +
  money(totPur).padStart(11) + money(totInt).padStart(10) + money(totFee).padStart(8));

const first = rows[0], last = rows[rows.length - 1];
if (first && last) {
  const moved = last.newBalance - first.prevBalance;
  console.log(`\nAcross ${rows.length} statements: paid ${money(totPay)}, balance moved ${moved >= 0 ? '+' : ''}${money(moved)}.`);
  const consumed = totInt + totPur;
  if (totPay > 0) {
    console.log(`Interest and new purchases consumed ${((consumed / totPay) * 100).toFixed(1)}% of everything paid.`);
  }
  const rates = [...new Set(rows.map(r => r.airPurchase).filter(Boolean))];
  console.log(`Purchase AIR across the window: ${rates.map(r => r.toFixed(2) + '%').join(', ')}`);
}

// Machine-readable copy for downstream work.
const cols = ['closing', 'days', 'prevBalance', 'payments', 'purchases', 'transfers',
  'cashAdv', 'interest', 'fees', 'newBalance', 'creditLimit', 'available',
  'minPayment', 'dueDate', 'airPurchase', 'airTransfer', 'airCash', 'payoffYears'];
const csv = [cols.join(',')]
  .concat(rows.map(r => cols.map(c => (r[c] === null ? '' : r[c])).join(',')))
  .join('\n');
fs.writeFileSync(path.join(dir, 'summary.csv'), csv + '\n');
console.log(`\nWrote ${path.join(dir, 'summary.csv')}`);
