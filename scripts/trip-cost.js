// Total a US trip across every card that funded it.
//
//   node scripts/trip-cost.js <derived-root> <start YYYY-MM-DD> <end YYYY-MM-DD>
//   e.g. node scripts/trip-cost.js ../derived 2026-07-24 2026-08-04
//
// The household used five payment methods on one trip, so no single account
// shows the cost. This reads the decrypted statement text and pulls every
// foreign-currency charge whose TRANSACTION date falls in the window.
//
// Two statement dialects:
//   TD    ...JUL25JUL28$782.56<MERCHANT>FOREIGNCURRENCY540.82USD@EXCHANGERATE1.44698
//   MBNA  ...07/25/2607/27/26<MERCHANT>91.75USD6433$132.66
//
// Transaction date, not posting date: a charge made on the trip that posts
// afterwards still belongs to the trip.
//
// Recurring software subscriptions that merely happen to bill in USD are
// reported SEPARATELY -- they would have billed whether or not anyone travelled,
// so folding them into a holiday total overstates it.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..', 'derived');
const start = process.argv[3] || '2026-07-24';
const end = process.argv[4] || '2026-08-04';

const MON = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };

// Merchants that bill on a schedule, not because of a trip.
const SUBSCRIPTION = /CALENDLY|OPENAI|CHATGPT|AICHATAPP|AMAZONCHANNELS|MAILCHIMP|CANVA|NETFLIX|SPOTIFY|APPLE\.COM|MICROSOFT/i;

const num = s => Number(String(s).replace(/,/g, ''));
const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const inWindow = iso => iso >= start && iso <= end;

const rows = [];

function scanDir(dir, dialect) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.txt'))) {
    const stmtYear = Number((f.match(/(\d{4})-\d{2}-\d{2}/) || [])[1]) || new Date().getFullYear();
    const flat = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\0/g, '').replace(/\s/g, '');
    const card = f.replace(/_\d{4}-\d{2}-\d{2}$/, '').replace(/\.txt$/, '').replace(/_\d{4}.*/, '');

    if (dialect === 'TD') {
      // <MON><DD><MON><DD>$<CAD><MERCHANT>FOREIGNCURRENCY<USD>USD@EXCHANGERATE<rate>
      // [^$] in the merchant capture is load-bearing: without it the match can
      // start at an earlier date and skip whole records, pairing the wrong CAD
      // amount with a charge -- and silently dropping the records in between.
      const re = /([A-Z]{3})(\d{1,2})[A-Z]{3}\d{1,2}\$([\d,]+\.\d{2})([^$]*?)FOREIGNCURRENCY([\d,]+\.\d{2})USD@EXCHANGERATE([\d.]+)/g;
      let m;
      while ((m = re.exec(flat)) !== null) {
        const mon = MON[m[1]];
        if (!mon) continue;
        // A statement spanning a year boundary: Dec belongs to the prior year.
        const year = (mon === 12 && stmtYear && new Date(`${stmtYear}-01-01`).getMonth() === 0 && mon > 6 && stmtYear) ? stmtYear : stmtYear;
        const iso = `${year}-${String(mon).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`;
        rows.push({ iso, card, merchant: m[4].slice(-40), cad: num(m[3]), usd: num(m[5]), rate: num(m[6]) });
      }
    } else {
      // <MM/DD/YY><MM/DD/YY><MERCHANT><USD>USD<ref>$<CAD>
      const re = /(\d{2})\/(\d{2})\/(\d{2})\d{2}\/\d{2}\/\d{2}([^$]*?)([\d,]+\.\d{2})USD\d{2,6}\$([\d,]+\.\d{2})/g;
      let m;
      while ((m = re.exec(flat)) !== null) {
        const iso = `20${m[3]}-${m[1]}-${m[2]}`;
        rows.push({ iso, card, merchant: m[4].slice(-40), cad: num(m[6]), usd: num(m[5]), rate: num(m[6]) / num(m[5]) });
      }
    }
  }
}

scanDir(path.join(root, 'wife-td'), 'TD');
scanDir(path.join(root, 'mbna'), 'MBNA');

// De-duplicate: a charge can appear on two consecutive statements.
const seen = new Set();
const uniq = rows.filter(r => {
  const k = `${r.iso}|${r.card}|${r.usd}|${r.cad}`;
  if (seen.has(k)) return false;
  seen.add(k); return true;
});

const win = uniq.filter(r => inWindow(r.iso));
const trip = win.filter(r => !SUBSCRIPTION.test(r.merchant));
const subs = win.filter(r => SUBSCRIPTION.test(r.merchant));

console.log(`\nForeign-currency card charges, ${start} to ${end}\n`);
console.log('Date'.padEnd(12) + 'Card'.padEnd(14) + 'USD'.padStart(10) + 'CAD'.padStart(11) + '  Merchant');
console.log('-'.repeat(92));
for (const r of trip.sort((a, b) => a.iso.localeCompare(b.iso))) {
  console.log(r.iso.padEnd(12) + r.card.padEnd(14) + money(r.usd).padStart(10) + money(r.cad).padStart(11) + '  ' + r.merchant);
}
const tUsd = trip.reduce((s, r) => s + r.usd, 0);
const tCad = trip.reduce((s, r) => s + r.cad, 0);
console.log('-'.repeat(92));
console.log('TRIP'.padEnd(26) + money(tUsd).padStart(10) + money(tCad).padStart(11));
if (tUsd) console.log(`Blended rate paid: ${(tCad / tUsd).toFixed(4)}`);

if (subs.length) {
  console.log('\nExcluded — recurring subscriptions that bill in USD regardless of travel:');
  for (const r of subs.sort((a, b) => a.iso.localeCompare(b.iso))) {
    console.log('  ' + r.iso + '  ' + money(r.usd).padStart(8) + ' USD  ' + money(r.cad).padStart(8) + ' CAD  ' + r.merchant);
  }
  console.log('  subtotal'.padEnd(14) + money(subs.reduce((s, r) => s + r.usd, 0)).padStart(8) + ' USD  ' +
              money(subs.reduce((s, r) => s + r.cad, 0)).padStart(8) + ' CAD');
}

console.log('\nBy card:');
const byCard = {};
for (const r of trip) {
  byCard[r.card] = byCard[r.card] || { usd: 0, cad: 0, n: 0 };
  byCard[r.card].usd += r.usd; byCard[r.card].cad += r.cad; byCard[r.card].n++;
}
for (const [k, v] of Object.entries(byCard).sort((a, b) => b[1].cad - a[1].cad)) {
  console.log('  ' + k.padEnd(16) + money(v.usd).padStart(10) + ' USD  ' + money(v.cad).padStart(10) + ' CAD  ' + v.n + ' charges');
}
