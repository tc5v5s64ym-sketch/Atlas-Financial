// Build one transaction ledger from every credit-card source.
//
//   node scripts/card-transactions.js <project-root>
//
// Reads:
//   derived/wife-td/*.txt          decrypted TD card statements
//   raw/statements-mbna/*.csv      MBNA exports (already machine-readable)
//
// Writes derived/card-transactions.csv and prints a reconciliation.
//
// TD's statement text is a font-subset extraction: the AMOUNTS are clean ASCII
// but the column headers and balance-summary labels come out as mojibake. So
// there is nothing to match a "NEW BALANCE" label against, and totals are
// instead reconciled against the statement-period closing balances read from
// TD's Activity page (see docs/ACCOUNT_FACTS.md). That check is the only thing
// standing between a plausible parse and a wrong one -- do not remove it.
//
// Transaction shape:  JUL25JUL28$782.56<MERCHANT>[FOREIGNCURRENCY...]
// Payments and credits carry a leading minus:  JUL27JUL28-$340.00PAYMENT-THANKYOU

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const derived = path.join(root, 'derived');
const rawMbna = path.join(root, 'raw', 'statements-mbna');

const MON = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
const num = s => Number(String(s).replace(/,/g, ''));
const money = n => (n < 0 ? '-' : '') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Charges the card levies on itself -- not household spending.
const IS_COST = /INTEREST|OVERLIMIT|ANNUALFEE|^FEE|CASHADVANCEFEE|FOREIGNCURRENCYCONV/i;
const IS_PAYMENT = /PAYMENT|THANKYOU/i;

const txns = [];

// ---------------------------------------------------------------- TD ------
function parseTd(file) {
  const base = path.basename(file, '.txt');
  const m = base.match(/^(.*)_(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return;
  const card = m[1], stmtYear = Number(m[2]), stmtMonth = Number(m[3]);
  const flat = fs.readFileSync(file, 'utf8').replace(/\0/g, '').replace(/\s/g, '');

  const START = /([A-Z]{3})(\d{1,2})([A-Z]{3})(\d{1,2})(-?)\$([\d,]+\.\d{2})/g;
  const hits = [];
  let h;
  while ((h = START.exec(flat)) !== null) {
    if (!MON[h[1]] || !MON[h[3]]) continue;
    hits.push({ m: h, start: h.index, end: START.lastIndex });
  }

  for (let i = 0; i < hits.length; i++) {
    const g = hits[i].m;
    const mon = MON[g[1]], day = Number(g[2]);
    // A statement spans a month boundary, so a transaction month later than the
    // statement month belongs to the previous calendar year.
    const year = mon > stmtMonth ? stmtYear - 1 : stmtYear;
    const iso = `${year}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

    let merchant = flat.slice(hits[i].end, i + 1 < hits.length ? hits[i + 1].start : hits[i].end + 60);

    // Pull the foreign-currency tail off the merchant, keeping the USD amount.
    let usd = null, rate = null;
    const fc = merchant.match(/FOREIGNCURRENCY([\d,]+\.\d{2})USD@EXCHANGERATE([\d.]+)/);
    if (fc) { usd = num(fc[1]); rate = num(fc[2]); merchant = merchant.slice(0, fc.index); }

    // Drop the mojibake runs and any trailing statement furniture.
    merchant = merchant.replace(/[^\x20-\x7E]/g, '').slice(0, 45).trim();
    if (!merchant) continue;

    const amount = num(g[6]) * (g[5] === '-' ? -1 : 1);
    txns.push({
      iso, card, merchant, amount, usd, rate,
      kind: amount < 0 ? 'payment' : IS_COST.test(merchant) ? 'cost' : 'purchase',
      stmt: `${m[2]}-${m[3]}-${m[4]}`,
    });
  }
}

// -------------------------------------------------------------- MBNA ------
function parseMbnaCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  lines.shift();
  const stmt = (path.basename(file, '.csv').match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
  for (const line of lines) {
    // Posted Date,Payee,Address,Amount -- payee may be quoted and contain commas
    const cells = [];
    let cur = '', q = false;
    for (const c of line) {
      if (c === '"') q = !q;
      else if (c === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += c;
    }
    cells.push(cur);
    if (cells.length < 4) continue;
    const [d, payee, , amt] = cells;
    const dm = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!dm) continue;
    const yr = dm[3].length === 2 ? '20' + dm[3] : dm[3];
    const iso = `${yr}-${dm[1].padStart(2,'0')}-${dm[2].padStart(2,'0')}`;
    // MBNA's sign convention is the MIRROR of TD's: money out is negative and
    // payments in are positive. Verified against known rows -- PAYMENT = +300.00,
    // INTEREST = -148.27. Negate so both issuers share one convention:
    // purchases and costs positive, money returned to the card negative.
    const amount = -num(amt);
    const merchant = payee.trim().slice(0, 45);
    const flatName = merchant.replace(/\s/g, '');
    const kind =
      // "INTEREST REFUND" is an interest adjustment, not a merchant refund --
      // it must net against interest or both figures drift by its value.
      IS_COST.test(flatName) ? 'cost'
      : IS_PAYMENT.test(flatName) ? 'payment'
      : amount > 0 ? 'purchase'
      : 'refund';
    txns.push({ iso, card: 'amazon-mbna', merchant, amount, usd: null, rate: null, kind, stmt });
  }
}

const tdDir = path.join(derived, 'wife-td');
if (fs.existsSync(tdDir)) {
  for (const f of fs.readdirSync(tdDir).filter(f => f.endsWith('.txt'))) parseTd(path.join(tdDir, f));
}
if (fs.existsSync(rawMbna)) {
  for (const f of fs.readdirSync(rawMbna).filter(f => f.endsWith('.csv'))) parseMbnaCsv(path.join(rawMbna, f));
}

// ------------------------------------------------------- reconciliation ---
// Closing balances read from TD's Activity page, independent of this parse.
const CHECK = {
  cashback: [
    ['2026-08-07', 5682.43, 4706.31],
    ['2026-07-07', 4706.31, 2685.32],
    ['2026-06-08', 2685.32, 5080.75],
    ['2026-05-07', 5080.75, 4890.67],
    ['2026-04-08', 4890.67, 4920.88],
  ],
};

console.log(`\nParsed ${txns.length} card transactions\n`);

const byCard = {};
for (const t of txns) {
  byCard[t.card] = byCard[t.card] || { purchase: 0, payment: 0, cost: 0, refund: 0, n: 0 };
  byCard[t.card][t.kind] += t.amount;
  byCard[t.card].n++;
}
console.log('Card'.padEnd(16) + 'n'.padStart(5) + 'Purchases'.padStart(13) + 'Payments'.padStart(13) +
            'Interest/fees'.padStart(15) + 'Refunds'.padStart(11));
console.log('-'.repeat(73));
for (const [k, v] of Object.entries(byCard).sort((a, b) => b[1].purchase - a[1].purchase)) {
  console.log(k.padEnd(16) + String(v.n).padStart(5) + money(v.purchase).padStart(13) +
              money(v.payment).padStart(13) + money(v.cost).padStart(15) + money(v.refund || 0).padStart(11));
}

console.log('\nRECONCILIATION — parsed movement vs the balances TD reports');
let failures = 0;
for (const [card, checks] of Object.entries(CHECK)) {
  for (const [stmt, closing, opening] of checks) {
    const net = txns.filter(t => t.card === card && t.stmt === stmt)
                    .reduce((s, t) => s + t.amount, 0);
    const expected = closing - opening;
    const ok = Math.abs(net - expected) < 0.01;
    if (!ok) failures++;
    console.log(`  ${stmt}  parsed ${money(net).padStart(10)}   expected ${money(expected).padStart(10)}   ${ok ? 'OK' : '*** MISMATCH ***'}`);
  }
}
// MBNA publishes its own 8-statement totals; check the parse against them.
const mb = byCard['amazon-mbna'];
if (mb) {
  const want = { purchases: 9930.23, payments: 2970.00, interest: 894.89 };
  const got = { purchases: mb.purchase + mb.refund, payments: -mb.payment, interest: mb.cost };
  console.log('\n  MBNA vs its own statement summary');
  for (const k of Object.keys(want)) {
    const ok = Math.abs(got[k] - want[k]) < 0.01;
    if (!ok) failures++;
    console.log(`    ${k.padEnd(10)} parsed ${money(got[k]).padStart(11)}   stated ${money(want[k]).padStart(11)}   ${ok ? 'OK' : '*** MISMATCH ***'}`);
  }
  console.log('    (parsed purchases are net of refunds, which is how MBNA states them)');
}

console.log(failures ? `\n${failures} check(s) do not reconcile — the parse is not trustworthy yet.`
                     : '\nEverything reconciles.');

const cols = ['iso', 'card', 'stmt', 'kind', 'amount', 'usd', 'rate', 'merchant'];
fs.mkdirSync(derived, { recursive: true });
const out = path.join(derived, 'card-transactions.csv');
fs.writeFileSync(out, [cols.join(',')].concat(
  txns.sort((a, b) => a.iso.localeCompare(b.iso)).map(t => cols.map(c => {
    const v = t[c] === null ? '' : t[c];
    return String(v).includes(',') ? `"${v}"` : v;
  }).join(','))).join('\n') + '\n');
console.log(`\nWrote ${out}`);
