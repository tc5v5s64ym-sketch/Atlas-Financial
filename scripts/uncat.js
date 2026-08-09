// Drill into whatever the classifier left uncategorised, so the report can
// state honestly how much spend is unexplained and why.
const fs = require('fs');
const path = require('path');
const RAW = path.join(__dirname, '..', 'raw');

function parseCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}
function load(f, a) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim()).map(parseCsvLine)
    .map(x => ({ acct: a, desc: (x[1] || '').trim().toUpperCase(), wd: parseFloat(x[2]) || 0, dep: parseFloat(x[3]) || 0, month: (x[0] || '').slice(0, 7) }));
}
const rows = [...load('chequingA_18mo.csv', 'A'), ...load('chequingB_18mo.csv', 'B'), ...load('savings_18mo.csv', 'S')];

const { classify } = { classify: null };
// re-import the live classifier by evaluating analyze.js is overkill; replicate the
// "did anything match" test with the same regex set used there for the known cats.
const KNOWN = /TFR-(TO|FR)\s+\d{6,}|^PTS FRM:|TFR-TO C\/C|^PYT TO:|SEASPAN|CHILD TAX BEN|CCB|CANADA (FED|PRO)|GST|CARBON|SUN LIFE|EMS FR:|RTN NSF|CANCEL E-TFR|MOKA|E-TRANSFER|E-TFR|ATM DEP|TD MORTGAGE|CAN TIRE MC|MBNA M\/C|AFFIRM|MONTHLY ACCOUNT FEE|OVERDRAFT|E-TFR FEE|NSF|INTEREST|NON-TD ATM|MPL RDG TX|BC HYDRO|FORTISBC|SHAW|TELUS|ROGERS|BELL |BCAA|ICBC|\bINS\b|TD WATERHOUSE|SAVE ON FOODS|REAL CDN SUPERS|WALMART|COSTCO|LANGLEY FARM|MERIDIAN FARM|SURREY MEAT|IRON BUTCHER|FRESH ST MARKET|INSTACART|SUBWAY|PANAGO|PHO |TIM HORTON|STARBUCK|MCDONALD|A&W|PIZZA|SUSHI|CAFE|BREWE|BEER|LIQUOR|HONNIE|PLAZA HOTEL|ESSO|PETRO-CANADA|CHEVRON|SHELL|MR\.LUBE|OSOYOOS MECHANI|SHOPPERS DRUG|PHARMA|LONDON DRUGS|DENTAL|RONA|HOME DEPOT|TRIPLE TREE NUR|CANADIAN TIRE|NURSER|FIT4LESS|AMAZON CHANNELS|NETFLIX|SPOTIFY|DISNEY|APPLE\.COM|GOOGLE|MICROSOFT|PRIME|CANUCKS|CINEPLEX|SPORT|AMZN|AMAZON|WINNERS|HOMESEN|MARKS|MVP ATHLET|DOLLARAMA|CMAWLOCAL|SEND E-TFR|CASH WITHDRA|ATM W\/D|PAYPAL|7 ELEVEN/;

const agg = new Map();
for (const r of rows) {
  if (KNOWN.test(r.desc)) continue;
  const k = r.desc.replace(/\d{4,}/g, '').replace(/\s+_[A-Z]\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const e = agg.get(k) || { n: 0, wd: 0, dep: 0, months: new Set() };
  e.n++; e.wd += r.wd; e.dep += r.dep; e.months.add(r.month);
  agg.set(k, e);
}
const sorted = [...agg.entries()].sort((a, b) => (b[1].wd + b[1].dep) - (a[1].wd + a[1].dep));
const totalWd = sorted.reduce((s, [, v]) => s + v.wd, 0);
console.log(`unmatched patterns: ${sorted.length}   total withdrawals ${totalWd.toFixed(2)}`);
for (const [k, v] of sorted.slice(0, 55)) {
  console.log(`  ${String(v.n).padStart(4)}x ${String(v.months.size).padStart(2)}mo  wd ${v.wd.toFixed(2).padStart(10)}  dep ${v.dep.toFixed(2).padStart(9)}  ${k}`);
}
