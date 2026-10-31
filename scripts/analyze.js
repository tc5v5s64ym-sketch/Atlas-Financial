// Local-only analysis of TD CSV exports.
// Emits aggregates to ../derived/. No account identifiers are ever written.
const fs = require('fs');
const path = require('path');
const CFG = require('./config');

const RAW = path.join(__dirname, '..', 'raw');
const OUT = path.join(__dirname, '..', 'derived');
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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

function load(file, acct) {
  const p = path.join(RAW, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(l => l.trim())
    .map(parseCsvLine)
    .map(f => ({
      acct, date: (f[0] || '').trim(), desc: (f[1] || '').trim().toUpperCase(),
      wd: parseFloat(f[2]) || 0, dep: parseFloat(f[3]) || 0,
      bal: parseFloat(f[4]),
      month: (f[0] || '').trim().slice(0, 7),
    }));
}

const rows = [
  ...load('chequingA_18mo.csv', 'Chequing A'),
  ...load('chequingB_18mo.csv', 'Chequing B'),
  ...load('savings_18mo.csv', 'Savings'),
];

// ---------------------------------------------------------------- classify
// Returns { kind, cat, conf } where kind is one of:
//   internal | income | debtpay | spend | fee | uncertain
function classify(r) {
  const d = r.desc;
  const isDep = r.dep > 0;

  // --- HELOC is a debt account, not an asset account --------------------
  // Money out of it is borrowing; money into it is debt service. These must be
  // tested BEFORE the generic own-account transfer rule below.
  if (CFG.reDraw.test(d) && isDep) return { kind: 'borrow', cat: 'HELOC draw (borrowing)', conf: 'high' };
  if (CFG.rePay.test(d)) return { kind: 'debtpay', cat: 'HELOC payment', conf: 'high' };
  // Destinations that are not any account on this profile.
  if (/TFR-(TO|FR) (6478420|6458934)/.test(d)) return { kind: 'uncertain', cat: 'Transfer to/from unidentified account', conf: 'low' };

  // --- movements between the owner's own TD accounts -------------------
  if (/TFR-(TO|FR)\s+\d{6,}/.test(d)) return { kind: 'internal', cat: 'Internal transfer', conf: 'high' };
  if (/^PTS FRM:/.test(d)) return { kind: 'internal', cat: 'Internal transfer', conf: 'high' };
  if (/TFR-TO C\/C/.test(d)) return { kind: 'debtpay', cat: 'Credit-card payment (TD)', conf: 'high' };
  if (/^PYT TO:/.test(d)) return { kind: 'internal', cat: 'Internal transfer', conf: 'medium' };

  // --- income -----------------------------------------------------------
  if (/SEASPAN/.test(d) && isDep) return { kind: 'income', cat: 'Payroll (employer)', conf: 'high' };
  if (/CHILD TAX BEN|CCB/.test(d) && isDep) return { kind: 'income', cat: 'Government benefit (child)', conf: 'high' };
  if (/CANADA (FED|PRO)|GST|CARBON|CLIMATE ACTION/.test(d) && isDep) return { kind: 'income', cat: 'Government benefit (other)', conf: 'high' };
  if (/SUN LIFE/.test(d) && isDep) return { kind: 'income', cat: 'Insurance/benefit reimbursement', conf: 'medium' };
  if (/EMS FR:/.test(d) && isDep) return { kind: 'uncertain', cat: 'Incoming â€” source unclear', conf: 'low' };
  if (/RTN NSF|CANCEL E-TFR|RETURNED/.test(d) && isDep) return { kind: 'uncertain', cat: 'Reversal / returned item', conf: 'high' };
  if (/MOKA/.test(d) && isDep) return { kind: 'uncertain', cat: 'Investment app withdrawal', conf: 'medium' };
  // Owner confirmed 2026-08-09: inbound e-transfers are spouse pay (~$1,000-1,100
  // per month) plus variable proceeds from selling items. Split on the recurring
  // amount signature; both are income, neither is an internal transfer.
  if (/(E-TRANSFER|E-TFR)/.test(d) && isDep) {
    if (r.dep >= 950 && r.dep <= 1150) return { kind: 'income', cat: 'Spouse income (e-transfer)', conf: 'medium' };
    return { kind: 'income', cat: 'Resale / other income (e-transfer)', conf: 'medium' };
  }
  if (/ATM DEP|DEPOSIT/.test(d) && isDep) return { kind: 'uncertain', cat: 'Cash/ATM deposit', conf: 'medium' };
  if (isDep && r.dep > 0) return { kind: 'uncertain', cat: 'Other credit', conf: 'low' };

  // --- debt servicing ----------------------------------------------------
  if (/TD MORTGAGE|MORTGAGE/.test(d)) return { kind: 'debtpay', cat: 'Mortgage payment', conf: 'high' };
  if (/CAN TIRE MC|MBNA M\/C|CAPITAL ONE|ROGERS BANK|SCOTIA.*VISA|AMEX/.test(d)) return { kind: 'debtpay', cat: 'Credit-card payment (non-TD)', conf: 'high' };
  if (/AFFIRM|FLEXITI|KLARNA|AFTERPAY|PAYBRIGHT/.test(d)) return { kind: 'debtpay', cat: 'Buy-now-pay-later instalment', conf: 'high' };
  if (/LINE OF CREDIT|HELOC|LOC PYMT/.test(d)) return { kind: 'debtpay', cat: 'HELOC / line-of-credit payment', conf: 'high' };

  // --- fees, interest ----------------------------------------------------
  if (/MONTHLY ACCOUNT FEE|SERVICE CHARGE|OVERDRAFT|O\/D INT|E-TFR FEE|NSF|ATM FEE|INTEREST/.test(d))
    return { kind: 'fee', cat: 'Bank fees / interest / overdraft', conf: 'high' };
  if (/NON-TD ATM/.test(d)) return { kind: 'spend', cat: 'Cash withdrawals', conf: 'high' };

  // --- housing & utilities ----------------------------------------------
  if (/MPL RDG TX|PROPERTY TAX|CITY OF|DISTRICT OF/.test(d)) return { kind: 'spend', cat: 'Property taxes', conf: 'high' };
  if (/BC HYDRO|FORTISBC|FORTIS/.test(d)) return { kind: 'spend', cat: 'Utilities', conf: 'high' };
  if (/SHAW|TELUS|ROGERS|BELL |NOVUS/.test(d)) return { kind: 'spend', cat: 'Utilities', conf: 'high' };
  if (/BCAA|ICBC|INSURANCE|INS$|\bINS\b/.test(d)) return { kind: 'spend', cat: 'Insurance', conf: 'high' };

  // --- education / children ---------------------------------------------
  if (/TD WATERHOUSE|RESP/.test(d)) return { kind: 'internal', cat: 'RESP contribution (own investment)', conf: 'high' };
  if (/SCHOOL|DAYCARE|CHILDCARE|TUITION|SD\d+/.test(d)) return { kind: 'spend', cat: 'Child / education', conf: 'medium' };

  // --- groceries ---------------------------------------------------------
  if (/SAVE ON FOODS|REAL CDN SUPERS|SUPERSTORE|WALMART|COSTCO|LANGLEY FARM|MERIDIAN FARM|SURREY MEAT|IRON BUTCHER|FRESH ST MARKET|SAFEWAY|NO FRILLS|T&T|INSTACART|GROCER/.test(d))
    return { kind: 'spend', cat: 'Groceries', conf: 'high' };

  // --- restaurants -------------------------------------------------------
  if (/SUBWAY|PANAGO|PHO |TIM HORTON|STARBUCK|MCDONALD|A&W|WENDY|PIZZA|SUSHI|RESTAURANT|CAFE|BREWE|BEER|LIQUOR|PUB|BAR |DOORDASH|SKIPTHE|UBER EATS|HONNIE|PLAZA HOTEL/.test(d))
    return { kind: 'spend', cat: 'Restaurants & takeout', conf: 'medium' };

  // --- fuel & transport --------------------------------------------------
  if (/ESSO|PETRO-CANADA|PETROCAN|CHEVRON|SHELL|HUSKY|MOBIL|GAS |MR\.LUBE|MR LUBE|OSOYOOS MECHANI|CANADIAN TIRE GAS|TRANSLINK|COMPASS/.test(d))
    return { kind: 'spend', cat: 'Fuel & transportation', conf: 'high' };

  // --- medical -----------------------------------------------------------
  if (/SHOPPERS DRUG|PHARMA|LONDON DRUGS|DENTAL|MEDICAL|CLINIC|OPTOMETR|PHYSIO/.test(d))
    return { kind: 'spend', cat: 'Medical & pharmacy', conf: 'medium' };

  // --- household / hardware ---------------------------------------------
  if (/RONA|HOME DEPOT|LOWES|TRIPLE TREE NUR|IKEA|CANADIAN TIRE|HARDWARE|NURSER/.test(d))
    return { kind: 'spend', cat: 'Household', conf: 'medium' };

  // --- fitness -----------------------------------------------------------
  if (/FIT4LESS|GOODLIFE|GYM|ANYTIME FITNESS|CLUB16/.test(d)) return { kind: 'spend', cat: 'Fitness', conf: 'high' };

  // --- subscriptions / online -------------------------------------------
  if (/AMAZON CHANNELS|NETFLIX|SPOTIFY|DISNEY|CRAVE|APPLE\.COM|GOOGLE|MICROSOFT|ADOBE|PAYPAL \*GOOGLE|PRIME/.test(d))
    return { kind: 'spend', cat: 'Subscriptions', conf: 'medium' };

  // --- entertainment -----------------------------------------------------
  if (/CANUCKS|CINEPLEX|TICKET|THEATRE|GOLF|SPORT|EVENT/.test(d)) return { kind: 'spend', cat: 'Entertainment', conf: 'medium' };

  // --- shopping ----------------------------------------------------------
  if (/AMZN|AMAZON|WINNERS|HOMESEN|MARKS|SPORT CHEK|MVP ATHLET|BEST BUY|OLD NAVY|DOLLARAMA|STAPLES|SHEIN|TEMU/.test(d))
    return { kind: 'spend', cat: 'Shopping', conf: 'medium' };

  // --- union dues --------------------------------------------------------
  if (/CMAWLOCAL|UNION|LOCAL \d+/.test(d)) return { kind: 'spend', cat: 'Union dues', conf: 'high' };

  // --- outgoing transfers to people -------------------------------------
  if (/SEND E-TFR/.test(d)) return { kind: 'spend', cat: 'E-transfers out', conf: 'medium' };
  if (/CASH WITHDRA|ATM W\/D|GC \d+-CASH/.test(d)) return { kind: 'spend', cat: 'Cash withdrawals', conf: 'high' };

  // --- second pass over the long tail -----------------------------------
  // TD truncates merchant names to ~15 chars, so these are matched on prefixes.
  if (/MERIDIAN MEATS|HOPCOTT|NESTERS|COBS BREAD|WM SUPERCE|WAL-MART|BULK BARN|FARM MARKET|PRODUCE/.test(d))
    return { kind: 'spend', cat: 'Groceries', conf: 'medium' };
  if (/EARLS|BOURBON ST|BOAT HOUSE|LUPITA|MANZIL|HEYHEY|AMSTERDAM|SONORA SPIRITS|SALMON ARM LIQU|MAPLE RIDGE LIQ|CANUEL CATERERS|MR BREAKAWA|WINERY|GRILL|KITCHEN|EATERY|DONAIR|TACO|THAI|CURRY/.test(d))
    return { kind: 'spend', cat: 'Restaurants & takeout', conf: 'medium' };
  if (/CHV |CANCO|SUPER SAVE GAS|KAL-TIRE|LORDCO|MAPLE RIDGE MOT|AUTO|TIRE|MECHANIC|PARKING|TOLL/.test(d))
    return { kind: 'spend', cat: 'Fuel & transportation', conf: 'medium' };
  if (/SEPHORA|ARITZIA|AMERICAN EAGLE|LA VIE EN ROSE|BIKINI VILLAGE|CHAMPS|FOOT LOCKER|GAMESTOP|BEST BUY|MOUNTAIN EQUIPM|STAPLES|TARGET|OLD NAVY|WINNERS|H&M|GAP |HUDSON/.test(d))
    return { kind: 'spend', cat: 'Shopping', conf: 'medium' };
  if (/ANNA NAILS|ZENNKAI|SALON|SPA|BARBER|HAIR/.test(d)) return { kind: 'spend', cat: 'Personal care', conf: 'medium' };
  if (/OPTIKS|EYE OPENER|OPTICAL|VISION|VET |ANIMAL HOSP|ALOUETTE ANIMAL/.test(d))
    return { kind: 'spend', cat: 'Medical & pharmacy', conf: 'low' };
  if (/IKEA|OSOYOOS HOME HA|HOME HARDWARE|MV RECYCLING|GARDEN|FURNITURE/.test(d))
    return { kind: 'spend', cat: 'Household', conf: 'medium' };
  if (/PITT MEADOWS AR|NORTH SHORE BIK|MOUNTAIN EDGE|ARENA|RECREATION|POOL|SKI |CAMP/.test(d))
    return { kind: 'spend', cat: 'Entertainment', conf: 'low' };
  if (/365 MARKET|SH VENDING|USAT_WT|VENDING/.test(d)) return { kind: 'spend', cat: 'Restaurants & takeout', conf: 'low' };
  if (/^PTS TO:/.test(d)) return { kind: 'internal', cat: 'Internal transfer', conf: 'high' };
  if (/O\.D\.P\. FEE/.test(d)) return { kind: 'fee', cat: 'Bank fees / interest / overdraft', conf: 'high' };

  // --- generic payment rails (destination unknown) ----------------------
  if (/PAYPAL/.test(d)) return { kind: 'spend', cat: 'Uncategorized (PayPal rail)', conf: 'low' };
  if (/7 ELEVEN|7-ELEVEN|CONVENIENCE/.test(d)) return { kind: 'spend', cat: 'Restaurants & takeout', conf: 'low' };

  return { kind: 'spend', cat: 'Uncategorized', conf: 'low' };
}

for (const r of rows) Object.assign(r, classify(r));

// ---------------------------------------------------------------- aggregate
const months = [...new Set(rows.map(r => r.month))].sort();
const amt = r => (r.dep > 0 ? r.dep : r.wd);

function sum(f) { return rows.filter(f).reduce((s, r) => s + amt(r), 0); }

// category totals
const catAgg = new Map();
for (const r of rows) {
  const key = `${r.kind}||${r.cat}`;
  const e = catAgg.get(key) || { n: 0, total: 0, max: 0, months: new Set(), conf: r.conf };
  e.n++; e.total += amt(r); e.max = Math.max(e.max, amt(r)); e.months.add(r.month);
  catAgg.set(key, e);
}

// monthly model
const monthly = months.map(m => {
  const mr = rows.filter(r => r.month === m);
  const g = (k) => mr.filter(r => r.kind === k).reduce((s, r) => s + amt(r), 0);
  return {
    month: m,
    income: mr.filter(r => r.kind === 'income').reduce((s, r) => s + r.dep, 0),
    borrow: mr.filter(r => r.kind === 'borrow').reduce((s, r) => s + r.dep, 0),
    uncertainIn: mr.filter(r => r.kind === 'uncertain' && r.dep > 0).reduce((s, r) => s + r.dep, 0),
    spend: mr.filter(r => r.kind === 'spend').reduce((s, r) => s + r.wd, 0),
    debtpay: mr.filter(r => r.kind === 'debtpay').reduce((s, r) => s + r.wd, 0),
    fees: mr.filter(r => r.kind === 'fee').reduce((s, r) => s + r.wd, 0),
    internal: mr.filter(r => r.kind === 'internal').reduce((s, r) => s + r.wd, 0),
  };
});

// recurring detection: same normalised merchant in >= 6 distinct months
function normMerch(d) {
  return d.replace(/\b[A-Z]{2}\d{3}\b/g, '').replace(/\d{4,}/g, '').replace(/\s+_[A-Z]\b/g, '')
    .replace(/[#*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 22);
}
const rec = new Map();
for (const r of rows) {
  if (r.kind === 'internal') continue;
  const k = normMerch(r.desc);
  if (!k) continue;
  const e = rec.get(k) || { n: 0, total: 0, months: new Set(), amts: [], cat: r.cat, kind: r.kind };
  e.n++; e.total += amt(r); e.months.add(r.month); e.amts.push(amt(r));
  rec.set(k, e);
}
const recurring = [...rec.entries()].filter(([, v]) => v.months.size >= 6)
  .map(([k, v]) => {
    const uniq = [...new Set(v.amts.map(a => a.toFixed(2)))];
    return {
      merchant: k, cat: v.cat, kind: v.kind, months: v.months.size, n: v.n,
      total: v.total, typical: v.total / v.n, varies: uniq.length > 3,
      last: [...v.months].sort().pop(),
    };
  }).sort((a, b) => b.total - a.total);

// large transactions
const large = rows.filter(r => amt(r) >= 1000 && r.kind !== 'internal')
  .sort((a, b) => amt(b) - amt(a)).slice(0, 40);

const out = { months, catAgg: [...catAgg.entries()].map(([k, v]) => ({ key: k, n: v.n, total: v.total, max: v.max, months: v.months.size, conf: v.conf })).sort((a, b) => b.total - a.total), monthly, recurring, large: large.map(r => ({ acct: r.acct, month: r.month, cat: r.cat, amt: amt(r), dir: r.dep > 0 ? 'in' : 'out', desc: normMerch(r.desc) })) };

fs.writeFileSync(path.join(OUT, 'analysis.json'), JSON.stringify(out, null, 2));

// ---------------------------------------------------------------- print
const f = n => n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).padStart(12);
console.log(`Months: ${months[0]} .. ${months[months.length - 1]}  (${months.length})   rows: ${rows.length}`);
console.log('\n=== CATEGORY TOTALS (18mo) ===');
for (const c of out.catAgg) console.log(`  ${f(c.total)}  ${String(c.n).padStart(4)}x  ${String(c.months).padStart(2)}mo  conf:${c.conf.padEnd(6)} ${c.key.replace('||', ' / ')}`);

console.log('\n=== MONTHLY ===');
console.log('month     income     borrowed  uncert-in     spend      debtpay      fees        net');
let cum = 0;
for (const m of monthly) {
  const net = m.income + m.uncertainIn - m.spend - m.debtpay - m.fees;
  cum += net;
  console.log(`${m.month} ${f(m.income)} ${f(m.borrow)} ${f(m.uncertainIn)} ${f(m.spend)} ${f(m.debtpay)} ${f(m.fees)} ${f(net)}`);
}
console.log(`\ncumulative net (income+uncertain-outflows), excl. borrowing: ${cum.toFixed(2)}`);
const tot = k => rows.filter(r => r.kind === k).reduce((s, r) => s + (r.dep > 0 ? r.dep : r.wd), 0);
console.log(`total borrowed (HELOC draws): ${tot('borrow').toFixed(2)}`);

console.log('\n=== RECURRING (>=6 distinct months) ===');
for (const r of recurring) console.log(`  ${f(r.total)} ${String(r.months).padStart(2)}mo ${String(r.n).padStart(3)}x typ ${r.typical.toFixed(2).padStart(9)} ${r.varies ? 'VAR' : 'fix'} last ${r.last}  ${r.merchant}  [${r.cat}]`);

