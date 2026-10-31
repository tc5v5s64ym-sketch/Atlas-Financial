// Decrypt a PDF that uses the standard security handler (R3, RC4-128) with an
// empty user password, then extract text. Node ships MD5 but not RC4, so RC4 is
// implemented here.
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');

const PAD = Buffer.from([
  0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56,
  0xFF, 0xFA, 0x01, 0x08, 0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
  0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);

function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = Buffer.alloc(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

const md5 = b => crypto.createHash('md5').update(b).digest();

const file = process.argv[2];
const buf = fs.readFileSync(file);
const latin = buf.toString('latin1');

// --- pull /O, /P, /ID, /R, /Length out of the encrypt dictionary -----------
function readPdfString(src, start) {
  // src[start] === '(' ; returns {bytes, end}
  const out = [];
  let depth = 0, i = start;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === 0x5c) { // backslash
      const n = src[i + 1];
      const map = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
      if (map[n] !== undefined) { out.push(map[n]); i++; }
      else if (n >= 0x30 && n <= 0x37) {
        let oct = '', k = 1;
        while (k <= 3 && src[i + k] >= 0x30 && src[i + k] <= 0x37) { oct += String.fromCharCode(src[i + k]); k++; }
        out.push(parseInt(oct, 8) & 255); i += oct.length;
      } else { out.push(n); i++; }
      continue;
    }
    if (c === 0x28) { if (depth > 0) out.push(c); depth++; continue; }
    if (c === 0x29) { depth--; if (depth === 0) return { bytes: Buffer.from(out), end: i }; out.push(c); continue; }
    if (depth > 0) out.push(c);
  }
  return { bytes: Buffer.from(out), end: i };
}

const encIdx = latin.search(/\/Filter\s*\/Standard/);
if (encIdx < 0) { console.error('no standard security handler'); process.exit(1); }
const encRegion = latin.slice(encIdx, encIdx + 1200);

const R = parseInt((encRegion.match(/\/R\s+(\d+)/) || [])[1], 10);
const P = parseInt((encRegion.match(/\/P\s+(-?\d+)/) || [])[1], 10);
const lengthBits = parseInt((encRegion.match(/\/Length\s+(\d+)/) || [, '40'])[1], 10);
const nBytes = lengthBits / 8;

const oIdx = latin.indexOf('/O', encIdx);
const oParen = latin.indexOf('(', oIdx);
const O = readPdfString(buf, oParen).bytes;

const idMatch = latin.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/);
const ID0 = Buffer.from(idMatch[1], 'hex');

// --- Algorithm 2: compute the file encryption key --------------------------
const pbuf = Buffer.alloc(4);
pbuf.writeInt32LE(P, 0);
let key = md5(Buffer.concat([PAD, O.slice(0, 32), pbuf, ID0]));
if (R >= 3) for (let i = 0; i < 50; i++) key = md5(key.slice(0, nBytes));
key = key.slice(0, nBytes);

console.error(`R=${R} P=${P} keyLen=${nBytes} O=${O.length}B ID=${ID0.length}B`);

// --- walk indirect objects, decrypt + inflate their streams ----------------
const objRe = /(\d+)\s+(\d+)\s+obj\b/g;
const results = [];
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
  const enc = buf.slice(s, e);

  const ext = Buffer.alloc(5);
  ext.writeUIntLE(num, 0, 3);
  ext.writeUIntLE(gen, 3, 2);
  const objKey = md5(Buffer.concat([key, ext])).slice(0, Math.min(nBytes + 5, 16));

  const dec = rc4(objKey, enc);
  let inf = null;
  try { inf = zlib.inflateSync(dec); } catch (_) {
    try { inf = zlib.inflateRawSync(dec); } catch (_) { }
  }
  if (inf) results.push({ num, text: inf.toString('latin1') });
}

console.error(`objects with inflatable streams: ${results.length}`);

// --- extract text-showing operators ---------------------------------------
function decodeContent(content) {
  const pieces = [];
  const re = /\((?:\\[\s\S]|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bETb?\b/g;
  let t;
  while ((t = re.exec(content)) !== null) {
    const tok = t[0];
    if (tok.startsWith('(')) {
      pieces.push(tok.slice(1, -1)
        .replace(/\\(\d{1,3})/g, (x, o) => String.fromCharCode(parseInt(o, 8) & 255))
        .replace(/\\([nrtbf])/g, (x, c) => ({ n: '\n', r: '', t: ' ', b: '', f: '' }[c]))
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
for (const r of results) {
  if (!/\bTj\b|\bTJ\b/.test(r.text)) continue;
  all += decodeContent(r.text) + '\n';
}
all = all.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
console.error(`extracted ${all.length} chars of text`);
console.log(all.slice(0, Number(process.argv[3] || 8000)));
