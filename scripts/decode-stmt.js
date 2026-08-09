// Decode a TD statement's custom font encoding and print the readable result.
// Digits, punctuation and letters all map by a fixed offset in TD's cmap.
const { execSync } = require('child_process');
const path = require('path');

const file = process.argv[2];
const raw = execSync(`node "${path.join(__dirname, 'pdfdecrypt.js')}" "${file}" 400000`,
  { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('latin1');

// digits and punctuation
const MAP = { 'ð':'0','ñ':'1','ò':'2','ó':'3','ô':'4','õ':'5','ö':'6','÷':'7','ø':'8','ù':'9',
              'k':',','K':'.','[':'$','l':'%','z':':' };
// uppercase letters sit at 0xC0 + position (A=0xC1 … Z=0xDA)
function decode(s) {
  let out = '';
  for (const ch of s) {
    if (MAP[ch]) { out += MAP[ch]; continue; }
    const c = ch.charCodeAt(0);
    if (c >= 0xC1 && c <= 0xDA) { out += String.fromCharCode(c - 0xC0 + 64); continue; }
    if (c >= 0xE1 && c <= 0xFA) { out += String.fromCharCode(c - 0xE0 + 96); continue; }
    out += ch;
  }
  return out;
}

const decoded = decode(raw);
const flat = decoded.replace(/[ \t]+/g, ' ');

console.log(`=== ${path.basename(file)} ===\n`);

// rate table
const rates = flat.match(/[Rr]ates?[^%]{0,40}?(\d{1,2}\.\d{2})\s*%[^%]{0,40}?(\d{1,2}\.\d{2})\s*%/);
if (rates) console.log(`RATES: purchases ${rates[1]}%   cash ${rates[2]}%\n`);

// any percentage at all, with surrounding context
const pcts = [...flat.matchAll(/(.{0,55})(\d{1,2}\.\d{2}\s*%)(.{0,55})/g)];
if (pcts.length) {
  console.log('every percentage found, in context:');
  for (const m of pcts.slice(0, 10)) console.log('  ' + (m[1] + '[' + m[2] + ']' + m[3]).replace(/\s+/g, ' '));
  console.log('');
}

for (const [label, re] of [
  ['credit limit', /[Cc]redit ?[Ll]imit\s*\$?([\d,]+\.\d{2})/],
  ['new balance', /NEW ?BALANCE\s*\$?([\d,]+\.\d{2})/i],
  ['minimum payment', /[Mm]inimum ?[Pp]ayment[^$]{0,30}\$?([\d,]+\.\d{2})/],
  ['years to repay', /more than (\d+) years?/i],
]) {
  const m = flat.match(re);
  console.log(`${label.padEnd(20)} ${m ? m[1] : 'not found'}`);
}

console.log('\nmessages:');
for (const m of (flat.match(/[A-Z][A-Z ,."'()\-0-9]{40,}/g) || []).slice(0, 6)) {
  console.log('  ' + m.replace(/\s+/g, ' ').slice(0, 200));
}
