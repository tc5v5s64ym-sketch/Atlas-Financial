// Pull the annual interest rates and headline figures out of a decrypted TD
// credit-card statement. TD renders the statement body in a custom font
// encoding; digits and punctuation map cleanly, which is all these fields need.
const { execSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('usage: node cardrate.js <statement.pdf>'); process.exit(1); }

const decryptor = path.join(__dirname, 'pdfdecrypt.js');
const raw = execSync(`node "${decryptor}" "${file}" 400000`, { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('latin1');

const DIG = { 'ð':'0','ñ':'1','ò':'2','ó':'3','ô':'4','õ':'5','ö':'6','÷':'7','ø':'8','ù':'9','k':',','K':'.','[':'$','l':'%' };
const flat = raw.replace(/\s+/g, '');
const dec = flat.replace(/[ðñòóôõö÷øùkK\[l]/g, c => DIG[c] || c);

const find = (re, label) => {
  const m = dec.match(re);
  console.log(`  ${label.padEnd(30)} ${m ? m.slice(1).join('  ') : 'not found'}`);
  return m;
};

console.log(`\n=== ${path.basename(file)} ===\n`);
console.log('decoded numeric fields:');
find(/Ù£z×¤¢¢(\d{1,2}\.\d{2})%Ã¢Á¥¢(\d{1,2}\.\d{2})%/, 'rates purchases / cash');
find(/×ÙÅåÉÖäââãÁãÅÔÅÕãÂÁÓÁÕÃÅ\$([\d,]+\.\d{2})/, 'previous balance');
find(/ÕÅæÂÁÓÁÕÃÅ\$([\d,]+\.\d{2})/, 'new balance');
find(/É£¢£\$([\d,]+\.\d{2})/, 'interest charged');
find(/Ô¤×¨££¢z(\d+)¨M¢](\d+)£M¢]/, 'est. time to pay (yrs, mths)');
find(/Ã£Ó£\$([\d,]+\.\d{2})/, 'credit limit');

console.log('\nrate disclosures in plain text:');
const plain = raw.replace(/\s+/g, '');
const hits = plain.match(/[A-Z0-9.,%$()\- ]{30,}/g) || [];
for (const h of hits) {
  if (/INTERESTRATE|ANNUALINTEREST|\d{2}\.\d{2}%/.test(h)) console.log('  ' + h.slice(0, 220));
}

console.log('\nnotices:');
for (const [re, label] of [
  [/HIGHERANNUALINTERESTRATES/, 'penalty rate applied'],
  [/HASNOTYETBEENRECEIVED/, 'minimum payment NOT received'],
  [/OVERLIMIT|OVER-LIMIT/i, 'over-limit'],
  [/MINIMUMPAYMENT/, 'minimum payment section present'],
]) console.log(`  ${label.padEnd(34)} ${re.test(plain) ? 'YES' : 'no'}`);
