// Minimal .xlsx reader — dumps every sheet to CSV on stdout.
//
//   node scripts/xlsx.js <file.xlsx> [sheetIndex]
//
// An .xlsx is a ZIP of XML. There is no unzip in Node's standard library and no
// Python on this machine, so this reads the ZIP central directory directly and
// inflates the entries it needs. Same reasoning as the PDF decryptors: a small
// purpose-built reader beats adding a dependency for one file format.
//
// Handles what Excel actually emits: shared strings, inline strings, numbers,
// and gaps in the column sequence (a missing <c> means an empty cell, and
// ignoring that silently shifts every value left).

const fs = require('fs');
const zlib = require('zlib');

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/xlsx.js <file.xlsx> [sheetIndex]'); process.exit(1); }
const buf = fs.readFileSync(file);

// --- ZIP central directory --------------------------------------------------
function readZip(b) {
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory)');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 0x02014b50) break;
    const method = b.readUInt16LE(p + 10);
    const compSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const cmtLen = b.readUInt16LE(p + 32);
    const lho = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + nameLen).toString('utf8');
    // The local header repeats the name and extra fields with its own lengths.
    const lNameLen = b.readUInt16LE(lho + 26);
    const lExtraLen = b.readUInt16LE(lho + 28);
    const start = lho + 30 + lNameLen + lExtraLen;
    const raw = b.slice(start, start + compSize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

const files = readZip(buf);

const unescape = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, '&');

// --- shared strings ---------------------------------------------------------
const shared = [];
const ssXml = files['xl/sharedStrings.xml'];
if (ssXml) {
  const xml = ssXml.toString('utf8');
  for (const si of xml.split(/<si[ >]/).slice(1)) {
    const parts = [...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => unescape(m[1]));
    shared.push(parts.join(''));
  }
}

// --- sheet names in workbook order -----------------------------------------
const wb = (files['xl/workbook.xml'] || Buffer.from('')).toString('utf8');
const sheetNames = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map(m => unescape(m[1]));

const sheetFiles = Object.keys(files)
  .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));

const colNum = ref => {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

const only = process.argv[3] !== undefined ? Number(process.argv[3]) : null;

sheetFiles.forEach((sf, idx) => {
  if (only !== null && idx !== only) return;
  const xml = files[sf].toString('utf8');
  console.log(`\n### SHEET ${idx}: ${sheetNames[idx] || sf}`);
  for (const rowXml of xml.split(/<row[ >]/).slice(1)) {
    const cells = [];
    for (const m of rowXml.matchAll(/<c ([^>]*?)\/?>(?:([\s\S]*?)<\/c>)?/g)) {
      const attrs = m[1], inner = m[2] || '';
      const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1] || '';
      const type = (attrs.match(/t="([^"]+)"/) || [])[1];
      let val = '';
      if (type === 's') {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v !== undefined ? (shared[Number(v)] ?? '') : '';
      } else if (type === 'inlineStr') {
        val = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => unescape(x[1])).join('');
      } else {
        const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        val = v !== undefined ? unescape(v) : '';
      }
      // A missing <c> is an empty cell; pad or every later value shifts left.
      const c = ref ? colNum(ref) : cells.length;
      while (cells.length < c) cells.push('');
      cells.push(val);
    }
    if (cells.some(c => c !== '')) {
      console.log(cells.map(c => (c.includes(',') || c.includes('"')) ? `"${c.replace(/"/g, '""')}"` : c).join(','));
    }
  }
});
