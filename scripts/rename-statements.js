// Rename statement PDFs to match the statement date they actually contain.
// The original download loop was off by one, so every filename referred to the
// previous period. Analysis read dates from inside the files and was unaffected,
// but the names would mislead anyone reading the folder.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
const prefix = process.argv[3] || 'tdvisa_';
const outPrefix = process.argv[4] || 'personal-visa';
const decryptor = path.join(__dirname, 'pdfdecrypt.js');
const apply = process.argv.includes('--apply');

const MONTH = { January:'01', February:'02', March:'03', April:'04', May:'05', June:'06',
                July:'07', August:'08', September:'09', October:'10', November:'11', December:'12' };

const seen = new Map();
const plan = [];

for (const f of fs.readdirSync(dir).filter(x => x.startsWith(prefix) && x.endsWith('.pdf')).sort()) {
  let iso = null;
  try {
    const txt = execSync(`node "${decryptor}" "${path.join(dir, f)}" 60000`,
      { maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = txt.replace(/\s+/g, '').match(/STATEMENTDATE:([A-Za-z]+)(\d{1,2}),(\d{4})/);
    if (m) iso = `${m[3]}-${MONTH[m[1]]}-${m[2].padStart(2, '0')}`;
  } catch (_) { }
  if (!iso) { plan.push({ from: f, to: null, note: 'could not read statement date' }); continue; }

  const n = (seen.get(iso) || 0) + 1;
  seen.set(iso, n);
  const to = n === 1 ? `${outPrefix}_${iso}.pdf` : `${outPrefix}_${iso}_dup${n}.pdf`;
  plan.push({ from: f, to, note: n > 1 ? 'DUPLICATE content' : '' });
}

for (const p of plan) {
  console.log(`  ${p.from.padEnd(28)} -> ${(p.to || 'SKIP').padEnd(34)} ${p.note}`);
}

if (apply) {
  for (const p of plan) {
    if (!p.to) continue;
    fs.renameSync(path.join(dir, p.from), path.join(dir, p.to));
  }
  console.log(`\nrenamed ${plan.filter(p => p.to).length} files`);
  const dates = [...seen.keys()].sort();
  console.log(`unique statements: ${dates.length}  (${dates[0]} .. ${dates[dates.length-1]})`);
} else {
  console.log('\ndry run — pass --apply to rename');
}
