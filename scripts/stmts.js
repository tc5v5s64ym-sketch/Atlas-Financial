// Decrypt every staged Visa statement and pull out the numbers that matter:
// statement period, rates, previous balance, payments, purchases, interest,
// new balance, minimum payment, and any rate-change / missed-payment notice.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PAD = Buffer.from([0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,0x64,0x00,0x4E,0x56,
  0xFF,0xFA,0x01,0x08,0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A]);
const md5 = b => crypto.createHash('md5').update(b).digest();
function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = Buffer.alloc(data.length); let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) { i = (i+1)&255; j = (j+S[i])&255; const t=S[i];S[i]=S[j];S[j]=t; out[k]=data[k]^S[(S[i]+S[j])&255]; }
  return out;
}
function readPdfString(src, start) {
  const out = []; let depth = 0, i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === 0x5c) { const n = src[i+1]; const map={0x6e:10,0x72:13,0x74:9,0x62:8,0x66:12};
      if (map[n]!==undefined){out.push(map[n]);i++;}
      else if(n>=0x30&&n<=0x37){let oct='',k=1;while(k<=3&&src[i+k]>=0x30&&src[i+k]<=0x37){oct+=String.fromCharCode(src[i+k]);k++;}out.push(parseInt(oct,8)&255);i+=oct.length;}
      else {out.push(n);i++;} continue; }
    if (c === 0x28) { if (depth>0) out.push(c); depth++; continue; }
    if (c === 0x29) { depth--; if (depth===0) return {bytes:Buffer.from(out)}; out.push(c); continue; }
    if (depth > 0) out.push(c);
  }
  return { bytes: Buffer.from(out) };
}

// The statement body uses a custom font encoding; digits and punctuation map
// cleanly, which is all the numeric fields need.
const DIG = { 'ð':'0','ñ':'1','ò':'2','ó':'3','ô':'4','õ':'5','ö':'6','÷':'7','ø':'8','ù':'9','k':',','K':'.','[':'$','l':'%' };
function decodeNums(s) { return s.replace(/[ðñòóôõö÷øùkKl\[]/g, c => DIG[c] || c); }

function extract(file) {
  const buf = fs.readFileSync(file);
  const latin = buf.toString('latin1');
  const encIdx = latin.search(/\/Filter\s*\/Standard/);
  if (encIdx < 0) return null;
  const region = latin.slice(encIdx, encIdx + 1200);
  const R = parseInt((region.match(/\/R\s+(\d+)/)||[])[1],10);
  const P = parseInt((region.match(/\/P\s+(-?\d+)/)||[])[1],10);
  const nBytes = parseInt((region.match(/\/Length\s+(\d+)/)||[,'40'])[1],10)/8;
  const oParen = latin.indexOf('(', latin.indexOf('/O', encIdx));
  const O = readPdfString(buf, oParen).bytes;
  const ID0 = Buffer.from(latin.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/)[1], 'hex');
  const pb = Buffer.alloc(4); pb.writeInt32LE(P, 0);
  let key = md5(Buffer.concat([PAD, O.slice(0,32), pb, ID0]));
  if (R >= 3) for (let i=0;i<50;i++) key = md5(key.slice(0,nBytes));
  key = key.slice(0, nBytes);

  let all = '';
  const objRe = /(\d+)\s+(\d+)\s+obj\b/g; let m;
  while ((m = objRe.exec(latin)) !== null) {
    const num=parseInt(m[1],10), gen=parseInt(m[2],10);
    const sIdx = latin.indexOf('stream', m.index);
    if (sIdx < 0) continue;
    const objEnd = latin.indexOf('endobj', m.index);
    if (objEnd > 0 && sIdx > objEnd) continue;
    let s = sIdx + 6; if (buf[s]===0x0d) s++; if (buf[s]===0x0a) s++;
    const e = latin.indexOf('endstream', s); if (e < 0) continue;
    const ext = Buffer.alloc(5); ext.writeUIntLE(num,0,3); ext.writeUIntLE(gen,3,2);
    const objKey = md5(Buffer.concat([key, ext])).slice(0, Math.min(nBytes+5,16));
    let inf = null; const dec = rc4(objKey, buf.slice(s,e));
    try { inf = zlib.inflateSync(dec); } catch(_) { try { inf = zlib.inflateRawSync(dec); } catch(_){} }
    if (!inf) continue;
    const txt = inf.toString('latin1');
    if (!/\bTj\b|\bTJ\b/.test(txt)) continue;
    const re = /\((?:\\[\s\S]|[^\\()])*\)/g; let t;
    while ((t = re.exec(txt)) !== null) {
      all += t[0].slice(1,-1)
        .replace(/\\(\d{1,3})/g,(x,o)=>String.fromCharCode(parseInt(o,8)&255))
        .replace(/\\([\s\S])/g,'$1');
    }
    all += '\n';
  }
  return all;
}

const dir = path.join(__dirname, '..', 'raw', 'statements');
const rows = [];
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pdf')).sort()) {
  const txt = extract(path.join(dir, f));
  if (!txt) { console.log(`${f}: could not decrypt`); continue; }
  const flat = txt.replace(/\s+/g, '');
  const dec = decodeNums(flat);

  const period = (txt.match(/STATEMENTPERIOD:([A-Za-z]+\d{1,2},\d{4})to([A-Za-z]+\d{1,2},\d{4})/) || []);
  // Rates appear in an uppercase-encoded box: "Rates: Purchases NN.NN% Cash Advances NN.NN%"
  const rateBox = dec.match(/Ù£z×¤¢¢(\d{1,2}\.\d{2})%Ã¢Á¥¢(\d{1,2}\.\d{2})%/)
              || dec.match(/Purchases(\d{1,2}\.\d{2})%CashAdvances(\d{1,2}\.\d{2})%/i);
  const newBal = (dec.match(/ÕÅæÂÁÓÁÕÃÅ\$([\d,]+\.\d{2})/) || [])[1];
  const prevBal = (dec.match(/×ÙÅåÉÖäââãÁãÅÔÅÕãÂÁÓÁÕÃÅ\$([\d,]+\.\d{2})/) || [])[1];
  const interest = (dec.match(/É£¢£\$([\d,]+\.\d{2})/) || [])[1];
  const minPay = (dec.match(/Ô¤×¨£\$?([\d,]+\.\d{2})/) || [])[1];
  const payCred = (dec.match(/×¨£¢PÃ£¢\$([\d,]+\.\d{2})/) || [])[1];
  const purch = (dec.match(/×¤¢¢PÖ£Ã¢\$([\d,]+\.\d{2})/) || [])[1];
  const estTime = (dec.match(/Ô¤×¨££¢z(\d+)¨M¢](\d+)£M¢]/) || []).slice(1).join('y ') ;
  const penalty = /HIGHERANNUALINTERESTRATES/.test(flat);
  const notReceived = /HASNOTYETBEENRECEIVED/.test(flat);
  const overlimit = /OVERLIMIT|OVER-LIMIT/.test(flat);
  const rateIncNotice = /INTERESTRATESWILLINCREASE|WEAREINCREASING|RATEINCREASE/.test(flat);

  rows.push({ file: f, from: period[1] || '?', to: period[2] || '?',
    prevBal, newBal, interest, minPay, payCred, purch, estTime,
    rates: rateBox ? rateBox.slice(1).join(' / ') : '?',
    penalty, notReceived, overlimit, rateIncNotice });
}

rows.sort((a,b) => new Date(a.to) - new Date(b.to));
console.log('period end        prev bal    payments  purchases  interest    new bal   min pay   rates(pur/cash)  penalty notRecd');
for (const r of rows) {
  console.log(`${String(r.to).padEnd(16)} ${String(r.prevBal||'?').padStart(9)} ${String(r.payCred||'?').padStart(10)} ${String(r.purch||'?').padStart(10)} ${String(r.interest||'?').padStart(9)} ${String(r.newBal||'?').padStart(10)} ${String(r.minPay||'?').padStart(8)}   ${String(r.rates).padEnd(15)} ${r.penalty?'YES':'no '}    ${r.notReceived?'YES':'no '}`);
}
console.log('\nestimated time to pay at minimums:');
for (const r of rows) console.log(`  ${String(r.to).padEnd(16)} ${r.estTime||'?'}`);
fs.writeFileSync(path.join(__dirname,'..','derived','statements.json'), JSON.stringify(rows,null,2));
