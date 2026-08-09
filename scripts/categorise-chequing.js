// Apply the merchant library to the chequing and savings exports.
//
//   node scripts/categorise-chequing.js <project-root>
//
// Separates real spending from everything else BEFORE categorising. The older
// uncat.js treated "matches a known pattern" as "categorised", which quietly
// counted transfers, debt payments and income as understood spending. Those are
// not spending at all and have to come out first, or every category total is
// inflated by money that merely moved.
//
// TD truncates chequing descriptions to about 15 characters and appends a
// one-letter type code, so merchant matching here is inherently weaker than on
// card statements. Expect a larger unknown residue and treat it honestly.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const RAW = path.join(root, 'raw');

const FILES = [
  ['chequingA_18mo.csv', 'Chequing A'],
  ['chequingB_18mo.csv', 'Chequing B'],
  ['savings_18mo.csv', 'Savings'],
  [path.join('wife-td', 'debt-and-payments_18mo.csv'), 'DEBT&PAYMENTS'],
  [path.join('wife-td', 'savings-dont-touch_18mo.csv'), 'SAVINGS-DONT TOUCH'],
];

// Not spending: money moving, debt being serviced, income arriving, bank charges.
const INTERNAL = /TFR-(TO|FR)|SEND E-TFR|E-TRANSFER|E-TFR|ATM DEP|CASH WITHDRA|ATM W\/D|PTS FRM|EMS (FR|TO)|CANCEL|TD WATERHOUSE/i;
const DEBT     = /TD MORTGAGE|CAN TIRE MC|MBNA M\/C|AFFIRM|FLEXITI|PYT TO|PAYMENT TO|TO:TD C\/C/i;
const BANKCOST = /MONTHLY ACCOUNT FEE|OVERDRAFT|NSF|E-TFR FEE|INTEREST|SERVICE CHARGE|WITHDRAWAL FEE/i;
// PayPal pulling from chequing is FUNDING, not spending. What was actually
// bought is in the PayPal exports; counting both double-counts every purchase.
const PAYPAL   = /^PAYPAL/i;
// A cheque tells us an amount and nothing else. It is real spending, but the
// payee is unknowable from the export -- kept visible rather than buried.
const CHEQUE   = /^CHQ#/i;

const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// Load the library produced by categorise-cards.js.
const libPath = path.join(__dirname, '..', 'docs', 'merchant-library.csv');
const RULES = [];
if (fs.existsSync(libPath)) {
  const lines = fs.readFileSync(libPath, 'utf8').split(/\r?\n/).filter(Boolean);
  lines.shift();
  for (const l of lines) {
    const [pattern, category, type] = l.split(',');
    if (pattern) RULES.push({ pattern, category, type });
  }
}

// Chequing-only patterns. These must match TD's ~15-character TRUNCATION, so
// they are deliberately short prefixes: "REAL CDN SUPERS" never contains
// "REALCDNSUPERSTORE", and a library written for full card merchant names
// silently fails against every one of them.
const EXTRA = [
  ['REALCDNSUPERS', 'Groceries', 'essential'], ['MERIDIANMEAT', 'Groceries', 'essential'],
  ['FRESHSTMARKE', 'Groceries', 'essential'], ['SAVEONFOOD', 'Groceries', 'essential'],
  ['7ELEVEN', 'Fuel & transport', 'essential'], ['OSOYOOSMECHANI', 'Fuel & transport', 'essential'],
  ['MAPLERIDGEMOT', 'Fuel & transport', 'essential'], ['MOUNTAINEDGE', 'Fuel & transport', 'essential'],
  ['RIDGEWAYBEER', 'Entertainment', 'discretionary'], ['THEPATCHBREW', 'Entertainment', 'discretionary'],
  ['CANUCKSSPORT', 'Entertainment', 'discretionary'],
  ['MVPATHLET', 'Sport & fitness', 'discretionary'],
  ['TRIPLETREENUR', 'Household', 'essential'],
  ['ANNANAILS', 'Health', 'discretionary'], ['HONNIE', 'Restaurants', 'discretionary'],
  ['WMSUPERCE', 'Groceries', 'essential'], ['HOPCOTTFARMS', 'Groceries', 'essential'],
  ['CHV', 'Fuel & transport', 'essential'], ['CANCOPETROLEUM', 'Fuel & transport', 'essential'],
  ['SUPERSAVEGAS', 'Fuel & transport', 'essential'], ['LORDCOPARTS', 'Fuel & transport', 'essential'],
  ['CANUCKSTEA', 'Entertainment', 'discretionary'], ['GAMESTOP', 'Entertainment', 'discretionary'],
  ['SONORASPIRITS', 'Entertainment', 'discretionary'], ['MAPLERIDGELIQ', 'Entertainment', 'discretionary'],
  ['STAPLES', 'Shopping', 'discretionary'], ['ARITZIA', 'Shopping', 'discretionary'],
  ['AMERICANEAGLE', 'Shopping', 'discretionary'],
  ['OSOYOOSHOMEHA', 'Household', 'essential'], ['AMSTERDAMGREEN', 'Household', 'essential'],
  ['OPTIKSINTERNAT', 'Health', 'essential'],
  ['PITTMEADOWSAR', 'Sport & fitness', 'discretionary'], ['NORTHSHOREBIK', 'Sport & fitness', 'discretionary'],
  ['EARLS', 'Restaurants', 'discretionary'], ['BOATHOUSE', 'Restaurants', 'discretionary'],
  ['GOOGLETV', 'Subscriptions', 'discretionary'],
  ['CRA', 'Tax', 'essential'],
  ['CANUELCATERERS', 'Restaurants', 'discretionary'], ['LUPITAMEXICAN', 'Restaurants', 'discretionary'],
  ['HEYHEYBAR', 'Restaurants', 'discretionary'], ['GRATIABAKE', 'Restaurants', 'discretionary'],
  ['COBSBREAD', 'Groceries', 'essential'],
  ['ALOUETTEANIMAL', 'Pets', 'essential'],
  ['KALTIRE', 'Fuel & transport', 'essential'],
  ['MVRECYCLING', 'Household', 'essential'],
  ['INDIGO', 'Shopping', 'discretionary'], ['BIKINIVILLAGE', 'Shopping', 'discretionary'],
  ['PAYTONBUCKLE', 'Shopping', 'discretionary'], ['MOUNTAINEQUIPM', 'Sport & fitness', 'discretionary'],
  ['ZENNKAISALON', 'Health', 'discretionary'], ['SALMONARMLIQU', 'Entertainment', 'discretionary'],
  ['BCHYDRO', 'Utilities', 'essential'], ['FORTISBC', 'Utilities', 'essential'],
  ['SHAW', 'Telecom', 'essential'], ['TELUS', 'Telecom', 'essential'],
  ['MPLRDGTX', 'Property tax', 'essential'], ['ICBC', 'Insurance', 'essential'],
  ['SUNLIFE', 'Insurance', 'essential'], ['BCAA', 'Insurance', 'essential'],
  ['FIT4LESS', 'Sport & fitness', 'discretionary'],
  ['DOLLARAMA', 'Shopping', 'discretionary'], ['MARKS', 'Shopping', 'discretionary'],
  ['LANGLEYFARM', 'Groceries', 'essential'], ['MERIDIANFARM', 'Groceries', 'essential'],
  ['SURREYMEAT', 'Groceries', 'essential'], ['FRESHSTMARKET', 'Groceries', 'essential'],
  ['PANAGO', 'Restaurants', 'discretionary'], ['AW', 'Restaurants', 'discretionary'],
  ['MRLUBE', 'Fuel & transport', 'essential'], ['PETROCANADA', 'Fuel & transport', 'essential'],
  ['LONDONDRUGS', 'Health', 'essential'], ['CMAWLOCAL', 'Union dues', 'essential'],
];
for (const [pattern, category, type] of EXTRA) RULES.push({ pattern, category, type });

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur); return out;
}

const rows = [];
for (const [f, acct] of FILES) {
  const p = path.join(RAW, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())) {
    const c = splitCsv(line);
    rows.push({
      acct, date: (c[0] || '').trim(),
      // Strip the trailing one-letter type code TD appends.
      desc: (c[1] || '').trim().replace(/\s+_[A-Z]$/, '').trim(),
      wd: parseFloat(c[2]) || 0, dep: parseFloat(c[3]) || 0,
    });
  }
}

function bucket(r) {
  if (INTERNAL.test(r.desc)) return 'internal transfer';
  if (DEBT.test(r.desc)) return 'debt payment';
  if (PAYPAL.test(r.desc)) return 'PayPal funding';
  if (BANKCOST.test(r.desc)) return 'bank fees & interest';
  if (CHEQUE.test(r.desc)) return 'cheques — payee unknown';
  if (r.dep > 0 && r.wd === 0) return 'incoming';
  return 'spending';
}

function classify(desc) {
  const n = norm(desc);
  for (const r of RULES) if (n.includes(r.pattern)) return [r.category, r.type];
  return ['Uncategorised', 'unknown'];
}

const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const buckets = {};
for (const r of rows) {
  const b = bucket(r);
  buckets[b] = buckets[b] || { wd: 0, dep: 0, n: 0 };
  buckets[b].wd += r.wd; buckets[b].dep += r.dep; buckets[b].n++;
}

console.log(`\n${rows.length} chequing/savings rows across ${FILES.length} accounts, 18 months\n`);
console.log('Bucket'.padEnd(24) + 'Out'.padStart(13) + 'In'.padStart(13) + 'n'.padStart(7));
console.log('-'.repeat(57));
for (const [k, v] of Object.entries(buckets).sort((a, b) => b[1].wd - a[1].wd)) {
  console.log(k.padEnd(24) + money(v.wd).padStart(13) + money(v.dep).padStart(13) + String(v.n).padStart(7));
}

const spending = rows.filter(r => bucket(r) === 'spending' && r.wd > 0);
const cats = {};
for (const r of spending) {
  const [cat, type] = classify(r.desc);
  cats[cat] = cats[cat] || { total: 0, n: 0, type };
  cats[cat].total += r.wd; cats[cat].n++;
}
const total = spending.reduce((s, r) => s + r.wd, 0);

console.log(`\nChequing spending by category — ${spending.length} transactions, ${money(total)} over 18 months\n`);
console.log('Category'.padEnd(20) + 'Total'.padStart(12) + '/month'.padStart(11) + 'n'.padStart(6));
console.log('-'.repeat(50));
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1].total - a[1].total)) {
  console.log(k.padEnd(20) + money(v.total).padStart(12) + money(v.total / 18).padStart(11) + String(v.n).padStart(6));
}

const unc = cats['Uncategorised'];
console.log(`\nUncategorised: ${money(unc ? unc.total : 0)} — ${((unc ? unc.total : 0) / total * 100).toFixed(1)}% of chequing spending`);

// Fold the chequing patterns back into the shared library so both sides of the
// picture are driven by one file rather than two divergent rule sets.
if (fs.existsSync(libPath)) {
  const existing = new Set(RULES.filter(r => !EXTRA.some(e => e[0] === r.pattern)).map(r => r.pattern));
  const added = EXTRA.filter(([p]) => !existing.has(p));
  if (added.length) {
    fs.appendFileSync(libPath, added.map(([p, c, t]) => `${p},${c},${t},chequing (truncated description)`).join('\n') + '\n');
    console.log(`\nAdded ${added.length} chequing patterns to ${libPath}`);
  }
}

console.log('\nLargest unidentified descriptions — these are the ones worth asking about:');
const um = {};
for (const r of spending) {
  if (classify(r.desc)[0] !== 'Uncategorised') continue;
  const k = r.desc.replace(/\s+/g, ' ').slice(0, 26);
  um[k] = um[k] || { total: 0, n: 0 };
  um[k].total += r.wd; um[k].n++;
}
Object.entries(um).sort((a, b) => b[1].total - a[1].total).slice(0, 25)
  .forEach(([m, v]) => console.log('  ' + money(v.total).padStart(10) + '  ' + String(v.n).padStart(4) + 'x  ' + m));
