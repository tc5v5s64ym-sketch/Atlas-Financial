// Decrypt a PDF using the standard security handler V4/R4 with the AESV2
// (AES-128-CBC) crypt filter and an empty user password, then extract text.
// Handles both literal "(...)" and hex "<...>" /O strings.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const PAD = Buffer.from([0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,0x64,0x00,0x4E,0x56,
  0xFF,0xFA,0x01,0x08,0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A]);
const SALT = Buffer.from([0x73,0x41,0x6C,0x54]); // "sAlT"
const md5 = b => crypto.createHash('md5').update(b).digest();

const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin = buf.toString('latin1');

const encIdx = latin.search(/\/Filter\s*\/Standard/);
if (encIdx < 0) { console.error('no standard handler'); process.exit(1); }
const dict = latin.slice(encIdx, encIdx + 900);

const V = parseInt((dict.match(/\/V\s+(\d+)/) || [])[1], 10);
const R = parseInt((dict.match(/\/R\s+(\d+)/) || [])[1], 10);
const P = parseInt((dict.match(/\/P\s+(-?\d+)/) || [])[1], 10);
const nBytes = parseInt((dict.match(/\/Length\s+(\d+)/) || [, '128'])[1], 10) / 8;
const cfm = (dict.match(/\/CFM\s*\/(\w+)/) || [])[1] || 'V2';
const encryptMetadata = !/\/EncryptMetadata\s+false/.test(dict);

// /O may be a hex string or a literal string
let O;
const oHex = dict.match(/\/O\s*<([0-9A-Fa-f]{64})>/);
if (oHex) O = Buffer.from(oHex[1], 'hex');
else {
  const oParen = latin.indexOf('(', latin.indexOf('/O', encIdx));
  const out = []; let depth = 0;
  for (let i = oParen; i < latin.length; i++) {
    const c = buf[i];
    if (c === 0x5c) { out.push(buf[i+1]); i++; continue; }
    if (c === 0x28) { if (depth > 0) out.push(c); depth++; continue; }
    if (c === 0x29) { depth--; if (!depth) break; out.push(c); continue; }
    if (depth > 0) out.push(c);
  }
  O = Buffer.from(out);
}

const idm = latin.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/);
const ID0 = Buffer.from(idm[1], 'hex');

// Algorithm 2
const pb = Buffer.alloc(4); pb.writeInt32LE(P, 0);
const parts = [PAD, O.slice(0, 32), pb, ID0];
if (R >= 4 && !encryptMetadata) parts.push(Buffer.from([0xFF, 0xFF, 0xFF, 0xFF]));
let key = md5(Buffer.concat(parts));
if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key.slice(0, nBytes));
key = key.slice(0, nBytes);

console.error(`V=${V} R=${R} P=${P} keyLen=${nBytes} CFM=${cfm} encMeta=${encryptMetadata} O=${O.length}B ID=${ID0.length}B`);

function objKeyFor(num, gen) {
  const ext = Buffer.alloc(5);
  ext.writeUIntLE(num, 0, 3); ext.writeUIntLE(gen, 3, 2);
  const seed = [key, ext];
  if (cfm === 'AESV2') seed.push(SALT);
  return md5(Buffer.concat(seed)).slice(0, Math.min(nBytes + 5, 16));
}

function decryptStream(data, num, gen) {
  const k = objKeyFor(num, gen);
  if (cfm === 'AESV2') {
    if (data.length <= 16) return null;
    const iv = data.slice(0, 16);
    let body = data.slice(16);
    body = body.slice(0, body.length - (body.length % 16));
    if (!body.length) return null;
    try {
      const d = crypto.createDecipheriv('aes-128-cbc', k, iv);
      d.setAutoPadding(false);
      const out = Buffer.concat([d.update(body), d.final()]);
      const pad = out[out.length - 1];
      return (pad >= 1 && pad <= 16) ? out.slice(0, out.length - pad) : out;
    } catch (_) { return null; }
  }
  // RC4 fallback
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + k[i % k.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = Buffer.alloc(data.length); let i2 = 0; j = 0;
  for (let n = 0; n < data.length; n++) { i2 = (i2+1)&255; j = (j+S[i2])&255; const t=S[i2];S[i2]=S[j];S[j]=t; out[n]=data[n]^S[(S[i2]+S[j])&255]; }
  return out;
}

// Walk objects, decrypt + inflate
const chunks = [];
const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
let m;
while ((m = objRe.exec(latin)) !== null) {
  const num = parseInt(m[1], 10), gen = parseInt(m[2], 10);
  const sIdx = latin.indexOf('stream', m.index);
  if (sIdx < 0) continue;
  const objEnd = latin.indexOf('endobj', m.index);
  if (objEnd > 0 && sIdx > objEnd) continue;
  let s = sIdx + 6;
  if (buf[s] === 0x0d) s++;
  if (buf[s] === 0x0a) s++;
  const e = latin.indexOf('endstream', s);
  if (e < 0) continue;
  const dec = decryptStream(buf.slice(s, e), num, gen);
  if (!dec) continue;
  let inf = null;
  try { inf = zlib.inflateSync(dec); } catch (_) {
    try { inf = zlib.inflateRawSync(dec); } catch (_) { }
  }
  if (inf) chunks.push(inf.toString('latin1'));
}
console.error(`inflatable streams: ${chunks.length}`);

// Text extraction, incl. TJ arrays
function decodeContent(content) {
  const pieces = [];
  const re = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b/g;
  let t;
  while ((t = re.exec(content)) !== null) {
    const tok = t[0];
    if (tok.startsWith('(')) {
      pieces.push(tok.slice(1, -1)
        .replace(/\\(\d{1,3})/g, (x, o) => String.fromCharCode(parseInt(o, 8) & 255))
        .replace(/\\([nr])/g, '\n')
        .replace(/\\([\s\S])/g, '$1'));
    } else if (tok.startsWith('<')) {
      const hex = tok.slice(1, -1).replace(/\s/g, '');
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const c = parseInt(hex.substr(i, 2), 16);
        s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '';
      }
      pieces.push(s);
    } else if (tok === 'Td' || tok === 'TD' || tok === 'T*') pieces.push('\n');
  }
  return pieces.join('');
}

let all = '';
for (const c of chunks) {
  if (!/\bTj\b|\bTJ\b/.test(c)) continue;
  all += decodeContent(c) + '\n';
}
all = all.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
console.error(`extracted ${all.length} chars`);
console.log(all.slice(0, Number(process.argv[3] || 8000)));
