// Pull the per-statement interest charge and rate box out of the decoded text.
const fs = require('fs'); const path = require('path');
const { execSync } = require('child_process');
const dir = path.join(__dirname, '..', 'raw', 'statements');

// reuse the decrypt/extract from stmts.js by requiring its guts is awkward;
// simplest is to shell out to pdfdecrypt.js which prints the decoded text.
const DIG = { 'ð':'0','ñ':'1','ò':'2','ó':'3','ô':'4','õ':'5','ö':'6','÷':'7','ø':'8','ù':'9','k':',','K':'.','[':'$','l':'%' };
const decodeNums = s => s.replace(/[ðñòóôõö÷øùkKl\[]/g, c => DIG[c] || c);

for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pdf')).sort()) {
  let out;
  try {
    out = execSync(`node "${path.join(__dirname,'pdfdecrypt.js')}" "${path.join(dir,f)}" 200000"`.replace(/"$/,'"'), { maxBuffer: 40*1024*1024, stdio:['ignore','pipe','ignore'] }).toString('latin1');
  } catch (e) { console.log(f + ': extract failed'); continue; }
  const flat = out.replace(/\s+/g,'');
  const dec = decodeNums(flat);
  const period = (out.match(/STATEMENTPERIOD:([A-Za-z]+\d{1,2},\d{4})to([A-Za-z]+\d{1,2},\d{4})/)||[]);
  // the summary block runs: PrevBal, Payments/Credits, Purchases/OtherCharges,
  // CashAdvances, InterestCharges, Fees, Sub-total, NEW BALANCE
  const block = dec.match(/ÃÁÓÃäÓÁãÉÕÇèÖäÙÂÁÓÁÕÃÅ([\s\S]{0,320}?)ÕÅæÂÁÓÁÕÃÅ\$([\d,]+\.\d{2})/);
  const amts = block ? (block[1].match(/\$[\d,]+\.\d{2}/g)||[]) : [];
  const rates = dec.match(/(\d{1,2}\.\d{2})%[^%]{0,30}?(\d{1,2}\.\d{2})%/);
  const penalty = /HIGHERANNUALINTERESTRATES/.test(flat);
  const notRecd = /HASNOTYETBEENRECEIVED/.test(flat);
  console.log(`${(period[2]||f).padEnd(17)} amounts=[${amts.join(' ')}] new=${block?block[2]:'?'} rates=${rates?rates[1]+'/'+rates[2]:'?'} penalty=${penalty?'Y':'n'} notRecd=${notRecd?'Y':'n'}`);
}
