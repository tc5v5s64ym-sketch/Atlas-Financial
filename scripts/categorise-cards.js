// Categorise the card-transaction ledger.
//
//   node scripts/categorise-cards.js <project-root>
//
// Reads derived/card-transactions.csv, writes derived/card-spending.csv and
// prints category totals plus the biggest uncategorised merchants.
//
// Merchant strings must be NORMALISED before matching. TD's statement extraction
// strips spaces and MBNA's CSV keeps them, so the same merchant arrives as both
// "BELLMOBILITYVERDUN" and "BELL MOBILITY VERDUN QC". Matching raw strings
// silently splits one merchant into two and understates every total it touches.
//
// Rules are ordered: the first match wins, so put the specific before the
// general. UBEREATS must be tested before UBER, or every meal becomes transport.

const fs = require('fs');
const path = require('path');

const root = process.argv[2] || path.join(__dirname, '..');
const src = path.join(root, 'derived', 'card-transactions.csv');

const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// [category, essential|discretionary|business, ...patterns]
const RULES = [
  ['Subscriptions',  'discretionary', 'OPENAI', 'CHATGPT', 'CALENDLY', 'CANVA', 'MAILCHIMP', 'AICHATAPP', 'AMAZONCHANNELS', 'NETFLIX', 'SPOTIFY', 'GOOGLEAMAZONM', 'APPLECOM', 'ITUNES', 'PRIMEVIDEO'],
  ['Health',         'essential',     'FELIXHEALTH', 'SHOPPERSDRUG', 'PHARMA', 'DENTAL', 'MEDICAL', 'LIFELABS', 'KOZASKIN', 'CLINIC', 'PHYSIO', 'OPTICAL', 'CHIRO'],
  ['Telecom',        'essential',     'BELLMOBILITY', 'TELUS', 'ROGERS', 'SHAWCABLE', 'FIDO'],
  ['Restaurants',    'discretionary', 'UBEREATS', 'SKIPTHEDISHES', 'DOORDASH', 'STARBUCKS', 'TIMHORTON', 'OLIVEGARDEN', 'CHEESECAKE', 'WHITESPOT', 'INNOUT', 'BREWING', 'PASTINI', 'ROSEMARYBROWN', 'BOURBONST', 'CHACHIS', 'JOEYCHINOO', 'PICNICBASKET', 'DUTCHBROS', 'KONAICE', 'CANDYWORLD', 'MCDONALD', 'SUBWAY', 'PIZZA', 'CAFE', 'RESTAURANT', 'GRILL', 'SUSHI', 'BURGER', 'TST', 'SQCHACHI', 'MRMIKES', 'STEAKHOUSE', 'IRONBUTCHER', 'BAKERY', 'DELI', 'BISTRO', 'TAVERN', 'PUB'],
  ['Groceries',      'essential',     'INSTACART', 'SAVEONFOODS', 'REALCDNSUPERSTORE', 'COSTCO', 'WALMART', 'WALMARTCA', 'FREDMEYER', 'SAFEWAY', 'WHOLEFOODS', 'SUPERSTORE', 'NOFRILLS', 'SAVEON', 'TRADERJOE', 'MARKET'],
  ['Travel',         'discretionary', 'INN', 'HOTEL', 'SUITES', 'DOUBLETREE', 'BESTWESTERN', 'SPRINGHILL', 'FAIRFIELD', 'SONESTA', 'HILLTOP', 'EXPEDIA', 'AIRCAN', 'CAMPGROUND', 'NKMIP', 'MARRIOTT', 'HILTON', 'AIRBNB', 'WESTJET', 'COMPASSHOTEL', 'SIXT', 'ENTERPRISERENT', 'HERTZ', 'AVIS', 'BUDGETRENT'],
  ['Fuel & transport','essential',    'CHEVRON', 'ARCO', 'SHELL', 'ESSO', 'PETROCAN', 'GASSTATION', 'PARKMOBILE', 'PARKING', 'WATERFRONTLOTS', 'CITYOFSANTACRUZ', 'UBERCANADA', 'UBER', 'LYFT', 'TRANSLINK', 'BCFERRIES'],
  ['Sport & fitness','discretionary', 'MINORLA', 'LACROSSE', 'STARFIRESPORTS', 'SPORTCHEK', 'DICKSSPORTING', 'RACQUETGUYS', 'SPORTSPLEX', 'THEPLEX', 'BOXLACROSSE', 'SILVERCREEKSPOR', 'FEVOINC', 'TENNIS', 'MVPATHLETIC', 'CITYSIDELAX', 'NAMASTAY', 'JDSPORTS', 'ADIDAS', 'GOLF', 'SKIHILL'],
  ['Entertainment',  'discretionary', 'BOARDWALK', 'SEASIDE', 'PHOTOEXPRESSIONS', 'CINEPLEX', 'STEAM', 'PLAYSTATION', 'NINTENDO', 'XBOX', 'RUDEBRAND', 'WATERMARKPOOL', 'TOWNSHIP7', 'WINERY', 'LIQUOR', 'BCLIQUOR', 'BEERWINESPIRIT', 'RAINMAKERWINES', 'WINES'],
  ['Shopping',       'discretionary', 'AMAZONCA', 'AMZNMKTP', 'AMZN', 'WINNERS', 'HOMESENSE', 'LULULEMON', 'SEPHORA', 'BLACKBOND', 'RONA', 'HOMEDEPOT', 'CANADIANTIRE', 'TARGET', 'BESTBUY', 'IKEA', 'HARBORHOUSE', 'SUNSHOPS', 'BOARDWALKRETAIL', 'GLOBALE', 'ALOVANCOUVER', 'LAVIEENROSE', 'HUNNISCLOTHING', 'ARDENE', 'OLDNAVY', 'GAP', 'MARSHALLS', 'SPPOPPY', 'SPBIRCHBABE', 'SHOPIFY', 'ZARA', 'FOOTLOCKER', 'CHAMPSCANADA', 'VIBRANTPHOTOS', 'JAMMERGOODS'],
  ['Business',       'business',      'HEADCANADA', 'IVOCLAR'],
  ['Household',      'essential',     'NOBLEDISPOSAL', 'DISPOSAL', 'FORTISBC', 'BCHYDRO', 'INSURANCE', 'BCAA', 'WASTE'],
  ['School & clubs', 'essential',     'RMSCTITANS', 'ELEMENTAR', 'BAMMAPLERIDGE', 'SCHOOL', 'PAC'],
];

const rows = fs.readFileSync(src, 'utf8').split(/\r?\n/).filter(Boolean);
const head = rows.shift().split(',');
const idx = n => head.indexOf(n);

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

function classify(merchant) {
  const n = norm(merchant);
  for (const [cat, kind, ...pats] of RULES) {
    for (const p of pats) if (n.includes(p)) return [cat, kind];
  }
  return ['Uncategorised', 'unknown'];
}

const txns = rows.map(splitCsv).map(c => ({
  iso: c[idx('iso')], card: c[idx('card')], kind: c[idx('kind')],
  amount: Number(c[idx('amount')]), merchant: c[idx('merchant')],
}));

// The $10,000 Ivoclar charge was a third party's money passing through the card
// -- it is a real transaction but not household spending, so it is reported
// separately rather than dropped.
const PASSTHROUGH = t => norm(t.merchant).includes('IVOCLAR');

const purchases = txns.filter(t => t.kind === 'purchase');
const household = purchases.filter(t => !PASSTHROUGH(t));

const cats = {};
for (const t of household) {
  const [cat, kind] = classify(t.merchant);
  cats[cat] = cats[cat] || { total: 0, n: 0, kind };
  cats[cat].total += t.amount;
  cats[cat].n++;
}

const money = n => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const grand = household.reduce((s, t) => s + t.amount, 0);
const months = 12;

console.log(`\nCard spending by category — ${household.length} purchases, 12 months to Aug 2026\n`);
console.log('Category'.padEnd(20) + 'Total'.padStart(12) + '/month'.padStart(11) + 'n'.padStart(6) + '  Type');
console.log('-'.repeat(66));
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1].total - a[1].total)) {
  console.log(k.padEnd(20) + money(v.total).padStart(12) + money(v.total / months).padStart(11) +
              String(v.n).padStart(6) + '  ' + v.kind);
}
console.log('-'.repeat(66));
console.log('TOTAL'.padEnd(20) + money(grand).padStart(12) + money(grand / months).padStart(11) + String(household.length).padStart(6));

const unc = cats['Uncategorised'];
if (unc) console.log(`\nUncategorised: ${money(unc.total)} — ${(unc.total / grand * 100).toFixed(1)}% of card spending`);

const pass = purchases.filter(PASSTHROUGH);
if (pass.length) {
  console.log(`\nExcluded as a funded pass-through: ${money(pass.reduce((s, t) => s + t.amount, 0))} (${pass.length} txn) — a third party's money buying a business machine.`);
}

console.log('\nLargest uncategorised merchants:');
const um = {};
for (const t of household) {
  if (classify(t.merchant)[0] !== 'Uncategorised') continue;
  const key = t.merchant.slice(0, 38);
  um[key] = (um[key] || 0) + t.amount;
}
Object.entries(um).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([m, v]) => console.log('  ' + money(v).padStart(10) + '  ' + m));

// The rule table IS the merchant library (B34) -- publish it so the knowledge
// lives in docs/ rather than only inside this script.
const lib = path.join(__dirname, '..', 'docs', 'merchant-library.csv');
fs.writeFileSync(lib, ['pattern,category,type,notes'].concat(
  RULES.flatMap(([cat, kind, ...pats]) => pats.map(p => `${p},${cat},${kind},`))
).join('\n') + '\n');
console.log(`Wrote ${lib}`);

const out = path.join(root, 'derived', 'card-spending.csv');
fs.writeFileSync(out, ['iso,card,category,type,amount,merchant'].concat(
  household.map(t => {
    const [cat, kind] = classify(t.merchant);
    const m = t.merchant.includes(',') ? `"${t.merchant}"` : t.merchant;
    return [t.iso, t.card, cat, kind, t.amount, m].join(',');
  })).join('\n') + '\n');
console.log(`\nWrote ${out}`);
