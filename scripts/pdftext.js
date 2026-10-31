// Minimal PDF text extractor: find FlateDecode streams, inflate them, and pull
// the text-showing operators. Enough to read a bank statement; not a general
// PDF parser.
const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
const buf = fs.readFileSync(file);

// Locate every stream ... endstream span by byte offset.
const spans = [];
for (let i = 0; i < buf.length - 6; i++) {
  if (buf[i] === 0x73 && buf.slice(i, i + 6).toString('latin1') === 'stream') {
    let s = i + 6;
    if (buf[s] === 0x0d) s++;
    if (buf[s] === 0x0a) s++;
    const end = buf.indexOf(Buffer.from('endstream', 'latin1'), s);
    if (end > s) { spans.push([s, end]); i = end + 8; }
  }
}

const chunks = [];
for (const [s, e] of spans) {
  const raw = buf.slice(s, e);
  let out = null;
  try { out = zlib.inflateSync(raw); } catch (_) {
    try { out = zlib.inflateRawSync(raw); } catch (_) { /* not flate; skip */ }
  }
  if (out) chunks.push(out.toString('latin1'));
}

// Pull text out of the content streams.
function decodeText(content) {
  const pieces = [];
  // TJ arrays and Tj / ' / " strings
  const re = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\bTJ\b|\bTj\b|\bTd\b|\bTD\b|\bT\*\b|\bET\b/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const tok = m[0];
    if (tok.startsWith('(')) {
      let s = tok.slice(1, -1)
        .replace(/\\([nrtbf])/g, (x, c) => ({ n: '\n', r: '', t: '\t', b: '', f: '' }[c]))
        .replace(/\\(\d{1,3})/g, (x, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1');
      pieces.push(s);
    } else if (tok.startsWith('<')) {
      const hex = tok.slice(1, -1).replace(/\s/g, '');
      let s = '';
      for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = parseInt(hex.substr(i, 2), 16);
        if (code >= 32 && code < 127) s += String.fromCharCode(code);
      }
      pieces.push(s);
    } else if (tok === 'Td' || tok === 'TD' || tok === 'T*' || tok === 'ET') {
      pieces.push('\n');
    }
  }
  return pieces.join('');
}

let all = '';
for (const c of chunks) {
  if (!/\bTj\b|\bTJ\b/.test(c)) continue;
  all += decodeText(c) + '\n';
}

all = all.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
console.log(all.slice(0, Number(process.argv[3] || 6000)));
