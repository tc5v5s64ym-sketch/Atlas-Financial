// Summarise the Triangle Mastercard statements.
const { execSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '..', 'raw', 'statements-ctfs');
const dec = path.join(__dirname, 'pdfdecrypt_aes.js');

const rows = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pdf')).sort()) {
  let t;
  try { t = execSync(`node "${dec}" "${path.join(dir, f)}" 200000`, { maxBuffer: 40*1024*1024, stdio:['ignore','pipe','ignore'] }).toString(); }
  catch (e) { console.log(f + ' FAILED'); continue; }
  const g = (re, i = 1) => { const m = t.match(re); return m ? m[i].replace(/,/g, '') : null; };
  rows.push({
    file: f.slice(0, 10),
    stmtDate: g(/Statement date:\s*([A-Za-z]+ \d{1,2}, \d{4})/),
    period: g(/For the period:\s*([^\n]+)/),
    opening: g(/Balance from your last statement\s*\n?\$?([\d,]+\.\d{2})/),
    payments: g(/Payments received[^\n]*\n\s*-?([\d,]+\.\d{2})/),
    purchases: g(/Purchases\s*\n([\d,]+\.\d{2})/),
    cash: g(/Cash transactions\s*\n([\d,]+\.\d{2})/),
    fees: g(/Fees\s*\n([\d,]+\.\d{2})/),
    interest: g(/Interest charges\s*\n([\d,]+\.\d{2})/),
    newBal: g(/Your New Balance\s*\n\$?([\d,]+\.\d{2})/),
    limit: g(/Credit limit\s*\n\$?([\d,]+\.\d{2})/),
    avail: g(/Available credit\s*\n\$?(-?[\d,]+\.\d{2})/),
    minPay: g(/Minimum payment due\s*\n\$?([\d,]+\.\d{2})/),
    due: g(/Payment due date\s*\n([A-Za-z]+ \d{1,2}, \d{4})/),
    ratePurch: g(/Purchases\s*\n(\d{1,2}\.\d{2})%/),
    rateCash: g(/Cash Transactions and Fees\s*\n(\d{1,2}\.\d{2})%/),
    yearsToRepay: g(/it will take you\s*\n?more than (\d+) years/) || g(/more than (\d+) years/),
    hasEPP: /Equal Payments Plan/.test(t) && /Installment/i.test(t),
    overLimitFee: /over.?limit fee/i.test(t),
  });
}

const n = v => v === null ? '?' : Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2 });
console.log('stmt date        opening      payments   purchases   interest      new bal     avail    min pay   due');
for (const r of rows) {
  console.log(`${String(r.stmtDate).padEnd(16)} ${n(r.opening).padStart(10)} ${n(r.payments).padStart(11)} ${n(r.purchases).padStart(11)} ${n(r.interest).padStart(10)} ${n(r.newBal).padStart(12)} ${n(r.avail).padStart(9)} ${n(r.minPay).padStart(9)}  ${r.due||'?'}`);
}
console.log('\nrates & flags:');
for (const r of rows) console.log(`  ${String(r.stmtDate).padEnd(16)} purchases ${r.ratePurch||'?'}%  cash ${r.rateCash||'?'}%  limit ${n(r.limit)}  repay>${r.yearsToRepay||'?'}yrs  EPP=${r.hasEPP}`);

const tot = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
console.log(`\n5-statement totals: interest ${tot('interest').toFixed(2)} · payments ${tot('payments').toFixed(2)} · purchases ${tot('purchases').toFixed(2)}`);
fs.writeFileSync(path.join(__dirname, '..', 'derived', 'ctfs_statements.json'), JSON.stringify(rows, null, 2));
