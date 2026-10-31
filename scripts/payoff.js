// Rank the debts by what they actually cost, not by headline rate.
//
//   node scripts/payoff.js
//
// Reads the debt list from data.json so there is one source of truth.
//
// The headline rate is not the whole cost. Two things distort it:
//
//   * A FEE that recurs while a condition holds behaves like interest, and on a
//     small excess it dwarfs any rate. The Cash Back Visa's $29 over-limit fee
//     is charged on being $612 over, which is an effective rate far above 27%.
//   * A PENALTY rate that can be restored is a rate you are choosing to pay.
//     The personal Visa's 24.99% reverts to 17.20% after 12 on-time minimums.
//
// So the ranking below is by annual dollars, with the distortions priced in.

const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const pct = n => n.toFixed(2) + '%';

const cards = data.debts.filter(d => /Visa|Mastercard|credit card/i.test(d.label) && d.balance);
const secured = data.debts.filter(d => !cards.includes(d));

console.log('\nCONSUMER DEBT — ranked by rate (avalanche)\n');
console.log('Card'.padEnd(38) + 'Balance'.padStart(11) + 'Rate'.padStart(9) + 'Interest/yr'.padStart(13));
console.log('-'.repeat(71));
for (const d of [...cards].sort((a, b) => b.rate - a.rate)) {
  console.log(d.label.slice(0, 37).padEnd(38) + money(d.balance).padStart(11) +
              pct(d.rate).padStart(9) + money(d.annualInterest).padStart(13));
}
const cardTotal = cards.reduce((s, d) => s + d.balance, 0);
const cardInt = cards.reduce((s, d) => s + d.annualInterest, 0);
console.log('-'.repeat(71));
console.log('TOTAL'.padEnd(38) + money(cardTotal).padStart(11) + ''.padStart(9) + money(cardInt).padStart(13));
console.log(`  = ${money(cardInt / 12)}/month on cards alone`);

// --- the over-limit fee, priced as a rate --------------------------------
const cb = cards.find(d => /Cash Back/i.test(d.label));
if (cb && cb.limit && cb.balance > cb.limit) {
  const excess = cb.balance - cb.limit;
  const feeYear = 29 * 12;
  console.log('\nTHE OVER-LIMIT FEE IS THE MOST EXPENSIVE MONEY IN THE PICTURE\n');
  console.log(`  Cash Back Visa is ${money(excess)} over its ${money(cb.limit)} limit.`);
  console.log(`  While it stays over, a $29.00 fee is charged monthly = ${money(feeYear)}/year.`);
  console.log(`  Paying just ${money(excess)} stops that fee.`);
  console.log(`  Return on that ${money(excess)}: ${(feeYear / excess * 100).toFixed(1)}% a year.`);
  console.log(`  For comparison the dearest interest rate here is ${pct(Math.max(...cards.map(c => c.rate)))}.`);
}

// --- the penalty rate, priced as a choice --------------------------------
const pv = cards.find(d => /TD credit card/i.test(d.label));
if (pv) {
  const normal = 17.20;
  const saving = pv.balance * (pv.rate - normal) / 100;
  console.log('\nTHE PENALTY RATE IS RECOVERABLE\n');
  console.log(`  TD personal Visa carries ${pct(pv.rate)} as a penalty; normal is ${pct(normal)}.`);
  console.log(`  Restoring it needs 12 consecutive on-time minimums of ${money(pv.payment)}.`);
  console.log(`  Worth ${money(saving)}/year on today's balance, for ${money(pv.payment * 12)} of payments`);
  console.log(`  that are owed anyway. The cost of restoring it is punctuality, not money.`);
}

// --- what clearing each card frees, per month ----------------------------
console.log('\nWHAT CLEARING EACH CARD FREES, PER MONTH\n');
console.log('Card'.padEnd(38) + 'Balance'.padStart(11) + 'Interest'.padStart(10) + 'Minimum'.padStart(10));
console.log('-'.repeat(69));
for (const d of [...cards].sort((a, b) => a.balance - b.balance)) {
  console.log(d.label.slice(0, 37).padEnd(38) + money(d.balance).padStart(11) +
              money(d.annualInterest / 12).padStart(10) + money(d.payment).padStart(10));
}

console.log('\nSECURED DEBT — context, not targets\n');
for (const d of secured) {
  console.log('  ' + d.label.padEnd(12) + money(d.balance).padStart(12) + pct(d.rate).padStart(8) +
              money(d.annualInterest).padStart(12) + '/yr   ' + d.structure);
}
console.log('\n  The HELOC is interest-only: its minimum reduces principal by nothing.');
console.log('  Every dollar of card debt cleared is a dollar that stops compounding at 5x');
console.log('  the mortgage rate. But note the HELOC is 99.5% drawn, so it is not a');
console.log('  consolidation route unless something is repaid first.');
