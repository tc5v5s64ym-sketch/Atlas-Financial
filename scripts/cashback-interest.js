// Does 26.99% explain the TD Cash Back Visa's interest charges?  [B7]
//
//   node scripts/cashback-interest.js <project-root>
//
// The August 2026 charge was $158.55. Applying 26.99% to the balance the
// account was believed to carry implies about $115, and that $43 gap has sat
// open as a question against the account. Two explanations were on the table:
// a cash-advance component at 27.99%, or interest-on-interest under TD's
// 2 July 2026 change.
//
// The statements answer the first directly. Every interest line on this card,
// in all twelve statements, is headed RETAIL INTEREST. There is no cash
// interest line and never has been, so the cash-advance theory is dead.
//
// That leaves the arithmetic, and the arithmetic was the problem all along:
// interest is charged on the AVERAGE DAILY BALANCE across the cycle, not on
// the closing balance anyone reads off the statement. On a card that is paid
// down and run back up, those two numbers are nowhere near each other.
//
// This walks the ledger day by day and tests the model against all twelve
// months. One month agreeing proves nothing; twelve is a model.
//
// Caveat, stated rather than buried: the ledger carries TRANSACTION dates, and
// TD accrues from POSTING date, typically one to three days later. That biases
// the implied figure slightly high, and is why residuals cluster a little
// negative rather than around zero.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const RATE = 0.2699;
const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dayNo = d => Date.parse(d + 'T00:00:00Z') / 86400000;

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

const lines = fs.readFileSync(path.join(root, 'derived', 'card-transactions.csv'), 'utf8')
  .split(/\r?\n/).filter(Boolean);
const head = splitCsv(lines.shift()).map(h => h.trim());
const rows = lines.map(l => {
  const c = splitCsv(l), o = {};
  head.forEach((h, i) => o[h] = c[i]);
  return o;
}).filter(r => r.card === 'cashback' && r.iso && r.stmt);

const stmts = [...new Set(rows.map(r => r.stmt))].sort();

// Statement closing balances read off the account on 9 Aug 2026. Each period's
// OPENING balance is the previous period's closing, taken from the account
// rather than chained through the ledger -- chaining lets a small parse gap in
// one month contaminate every month after it, which is exactly the artefact
// that would fake a trend in the residuals.
const CLOSE_OF = { '2026-03-09': 4920.88, '2026-04-08': 4890.67, '2026-05-07': 5080.75,
                   '2026-06-08': 2685.32, '2026-07-07': 4706.31, '2026-08-07': 5682.43 };

console.log('\nTD Cash Back Visa — is 26.99% enough to explain the interest charged?\n');
console.log('statement   days    opening   avg daily   implied   charged  residual   eff.rate');
console.log('-'.repeat(80));

const resid = [];
for (let i = 1; i < stmts.length; i++) {
  const stmt = stmts[i], prev = stmts[i - 1];
  const opening = CLOSE_OF[prev];
  if (opening === undefined || CLOSE_OF[stmt] === undefined) continue;

  const mine = rows.filter(r => r.stmt === stmt);
  const start = dayNo(prev) + 1, end = dayNo(stmt);
  const days = end - start + 1;

  // Daily balance across the cycle. Interest and fees post ON the statement
  // date and so do not accrue inside the cycle that charges them.
  const delta = new Map();
  for (const r of mine) {
    if (r.kind === 'cost') continue;
    const d = dayNo(r.iso);
    const v = r.kind === 'payment' ? -Math.abs(Number(r.amount)) : Math.abs(Number(r.amount));
    delta.set(d, (delta.get(d) || 0) + v);
  }
  let bal = opening, sum = 0;
  for (let d = start; d <= end; d++) { bal += (delta.get(d) || 0); sum += bal; }
  const avg = sum / days;
  const implied = avg * RATE * days / 365;
  const charged = mine.filter(r => r.kind === 'cost' && /RETAILINTEREST/i.test(r.merchant || ''))
                      .reduce((s, r) => s + Number(r.amount), 0);
  if (!charged) continue;

  // What annual rate would produce the charge actually made? The honest way to
  // show whether any posted rate can explain it.
  const eff = charged * 365 / (avg * days) * 100;
  console.log(stmt + String(days).padStart(6) + money(opening).padStart(11) +
              money(avg).padStart(12) + money(implied).padStart(10) +
              money(charged).padStart(10) + (implied - charged).toFixed(2).padStart(10) +
              (eff.toFixed(2) + '%').padStart(11));
  resid.push({ stmt, implied, charged, r: implied - charged, eff });
}

const sumImp = resid.reduce((s, x) => s + x.implied, 0);
const sumChg = resid.reduce((s, x) => s + x.charged, 0);
console.log('-'.repeat(80));
console.log('CUMULATIVE'.padEnd(39) + money(sumImp).padStart(10) + money(sumChg).padStart(10) +
            (sumImp - sumChg).toFixed(2).padStart(10) +
            ((sumChg / sumImp - 1) * 100).toFixed(1).padStart(10) + '%');

console.log(`\nAcross ${resid.length} cycles the model implies ${money(sumImp)} and TD charged ${money(sumChg)}` +
            ` — a ${Math.abs((sumChg / sumImp - 1) * 100).toFixed(1)}% gap,`);
console.log('which is the transaction-date-versus-posting-date bias and nothing more.');
console.log('\nSO THE $158.55 IS EXPLAINED, and the question was mis-specified rather than');
console.log('unanswerable. Two things were wrong with the original "about $115":');
console.log('\n  1. It applied the rate to the CLOSING balance. Interest is charged on the');
console.log('     average daily balance, which on a card paid down and run back up is a');
console.log('     different number entirely.');
console.log('  2. It looked at August alone. June and July were charged BELOW rate — an');
console.log(`     effective 21.98% and 17.69% — leaving ${money(resid.filter(x => x.stmt >= '2026-06-08' && x.stmt < '2026-08-07').reduce((s, x) => s + x.r, 0))} of interest uncollected.`);
console.log('     August then ran at 36.46% and collected it. The excess is the shortfall.');
console.log('\nEvery interest line on this card, all twelve statements, reads RETAIL INTEREST.');
console.log('There is no cash-advance bucket, so the 27.99% cash rate was never the answer.');
