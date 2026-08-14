'use strict';
/* B90 / AF-CLASS-01 — overlapping essential/discretionary classification.

   Atlas publishes two views of household spending:

     Forward plan:  plan.budget.categories[].class
                    (essentials, discretionary room, weekly cap)

     Historical:    docs/merchant-library.csv type
                    → scripts/periods.js
                    → public/periods.json spending[].type
                    (Deep Dive mix / historical category totals)

   The join is the existing `from[]` list on each budget category. Labels are
   compared exactly — that list is the alias map; this file does not guess.

   Comparable classes: essential, discretionary.
   Named non-comparable semantics: business, reserve, unknown.

   The same overlapping comparable concept must not silently be essential in
   one view and discretionary in the other. Genuinely distinct semantics stay
   distinct. Unresolved household policy is named, not guessed.
*/

const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const read = rel => sourceText(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
const loadJson = rel => JSON.parse(read(rel));

const COMPARABLE = new Set(['essential', 'discretionary']);
const PAYPAL_CHANNEL = '@paypal';

/* Closed list. A new essential/discretionary disagreement is a failure unless
 * it is added here AND recorded as an owner question. This is not a wildcard. */
const OWNER_UNRESOLVED = new Set(['School & clubs']);

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (const c of line) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function parseLibrary(text) {
  const lines = sourceText(text).split('\n').filter(l => l.trim());
  const head = splitCsv(lines.shift()).map(h => h.trim());
  return lines.map(line => {
    const cols = splitCsv(line);
    const row = {};
    head.forEach((h, i) => { row[h] = (cols[i] || '').trim(); });
    return row;
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function libraryTypes(rows, label) {
  return new Set(rows.filter(r => r.category === label).map(r => r.type).filter(Boolean));
}

function periodTypes(periods, label) {
  const types = new Set();
  for (const period of Object.values((periods && periods.periods) || {})) {
    for (const row of period.spending || []) {
      if (row.label === label && row.type) types.add(row.type);
    }
  }
  return types;
}

function one(set) {
  return set.size === 1 ? [...set][0] : null;
}

/* Pure predicate. Returns problem strings; empty means the invariant holds. */
function classificationProblems({
  categories,
  excluded,
  library,
  periods,
  unresolved = OWNER_UNRESOLVED,
}) {
  const problems = [];
  const excludedLabels = new Set((excluded || []).map(e => e.from));

  const bizLib = libraryTypes(library, 'Business');
  const bizHist = periodTypes(periods, 'Business');
  const bizAll = new Set([...bizLib, ...bizHist]);
  if (bizAll.size && [...bizAll].some(t => t !== 'business')) {
    problems.push('business-coerced');
  }
  if (!excludedLabels.has('Business')) {
    problems.push('business-not-excluded');
  }
  for (const c of categories || []) {
    if ((c.from || []).includes('Business') && COMPARABLE.has(c.class)) {
      problems.push(`business-as-household:${c.id}`);
    }
  }

  for (const c of categories || []) {
    for (const label of c.from || []) {
      if (label === PAYPAL_CHANNEL) continue;

      const libTypes = libraryTypes(library, label);
      const histTypes = periodTypes(periods, label);

      if (libTypes.size > 1) {
        problems.push(`library-mixed:${label}:${[...libTypes].sort().join(',')}`);
      }
      if (histTypes.size > 1) {
        problems.push(`periods-mixed:${label}:${[...histTypes].sort().join(',')}`);
      }

      const libType = one(libTypes);
      const published = one(histTypes);
      if (libType && published && libType !== published) {
        problems.push(`stale-periods:${label}:library=${libType}:periods=${published}`);
      }

      const historical = published || libType;
      if (!historical) continue;

      const named = unresolved.has(label);
      const fwd = c.class;

      if (fwd === 'reserve') continue;

      if (historical === 'business') {
        problems.push(`business-as-household:${label}:forward=${fwd}`);
        continue;
      }

      const comparablePair = COMPARABLE.has(fwd) && COMPARABLE.has(historical);
      const unknownVsDiscretionary =
        (fwd === 'discretionary' && historical === 'unknown')
        || (fwd === 'unknown' && historical === 'discretionary');

      if (comparablePair || unknownVsDiscretionary) {
        const disagree = fwd !== historical;
        if (disagree && !named) {
          problems.push(`contradiction:${label}:forward=${fwd}:historical=${historical}`);
        }
        if (!disagree && named) {
          problems.push(`stale-unresolved:${label}`);
        }
      }
    }
  }

  for (const label of unresolved) {
    const cat = (categories || []).find(c => (c.from || []).includes(label));
    if (!cat) problems.push(`unresolved-missing-category:${label}`);
  }

  return problems;
}

const data = loadJson('data.json');
const periods = loadJson('public/periods.json');
const libraryText = read('docs/merchant-library.csv');
const library = parseLibrary(libraryText);
const questions = read('docs/01_OPEN_QUESTIONS.md');
const budget = data.plan.budget;
const live = {
  categories: budget.categories,
  excluded: budget.excluded,
  library,
  periods,
};

console.log('=== live overlapping comparable categories ===');
const liveProblems = classificationProblems(live);
ok(liveProblems.length === 0,
  'no silent essential/discretionary contradiction on the live join',
  liveProblems.join('; ') || 'none');

const overlapRows = [];
for (const c of budget.categories) {
  for (const label of c.from || []) {
    if (label === PAYPAL_CHANNEL) {
      overlapRows.push({
        id: c.id, label, forward: c.class, historical: '(paypal channel)',
        comparable: false, disposition: 'non-overlap: funding channel, not a merchant category',
      });
      console.log(`  ${c.id.padEnd(16)} ${c.class.padEnd(14)} ← ${label.padEnd(22)} (channel)      non-overlap: PayPal funding`);
      continue;
    }
    const published = one(periodTypes(periods, label));
    const libType = one(libraryTypes(library, label));
    const historical = published || libType || '(absent)';
    const unresolved = OWNER_UNRESOLVED.has(label);
    const comparable = COMPARABLE.has(c.class) && COMPARABLE.has(historical);
    let disposition = 'AGREE';
    if (c.class === 'reserve') disposition = 'INTENTIONAL EXCEPTION: reserve';
    else if (c.class === 'unknown' && historical === 'unknown') disposition = 'AGREE (unknown)';
    else if (unresolved) disposition = 'OWNER DECISION REQUIRED';
    else if (comparable && c.class !== historical) disposition = 'CONTRADICTION';
    overlapRows.push({
      id: c.id, label, forward: c.class, historical, comparable, disposition,
    });
    console.log(`  ${c.id.padEnd(16)} ${c.class.padEnd(14)} ← ${label.padEnd(22)} ${String(historical).padEnd(14)} ${disposition}`);
  }
}

const comparableLive = overlapRows.filter(r => r.comparable && r.disposition === 'AGREE');
ok(comparableLive.length >= 10,
  'live comparable overlaps that currently agree are enumerated',
  `${comparableLive.length} agreeing pairs`);

const school = overlapRows.find(r => r.label === 'School & clubs');
ok(school && school.forward === 'discretionary' && school.historical === 'essential',
  'School & clubs is the live comparable disagreement',
  school ? `${school.forward} vs ${school.historical}` : 'missing');
ok(school && school.disposition === 'OWNER DECISION REQUIRED',
  'that disagreement is surfaced as unresolved, not silently accepted');
ok(/Q24/.test(questions) && /School & clubs/.test(questions)
  && /essential/.test(questions) && /discretionary/.test(questions),
  'the unresolved school classification is recorded as Q24 in 01_OPEN_QUESTIONS.md');

console.log('\n=== named non-comparable semantics ===');
const business = overlapRows.find(r => r.label === 'Business');
ok(!business,
  'Business is not a forward budget category');
ok((budget.excluded || []).some(e => e.from === 'Business'),
  'Business is explicitly excluded from the household cap');
ok(one(libraryTypes(library, 'Business')) === 'business'
  && one(periodTypes(periods, 'Business')) === 'business',
  'historical Business stays type business',
  `${one(libraryTypes(library, 'Business'))} / ${one(periodTypes(periods, 'Business'))}`);

const propertyTax = overlapRows.find(r => r.label === 'Property tax');
const tax = overlapRows.find(r => r.label === 'Tax');
ok(propertyTax && propertyTax.forward === 'reserve' && propertyTax.historical === 'essential',
  'Property tax is forward reserve against historical essential');
ok(tax && tax.forward === 'reserve' && tax.historical === 'essential',
  'CRA Tax is forward reserve against historical essential');
ok(propertyTax.disposition.startsWith('INTENTIONAL EXCEPTION')
  && tax.disposition.startsWith('INTENTIONAL EXCEPTION'),
  'reserve vs historical essential is a named exception, not a comparable flip');

const unknown = overlapRows.find(r => r.label === 'Uncategorised');
ok(unknown && unknown.forward === 'unknown' && unknown.historical === 'unknown',
  'Uncategorised stays unknown on both sides');

const healthLib = libraryTypes(library, 'Health');
ok(healthLib.size === 1 && one(healthLib) === 'essential',
  'Health merchant-library types are unanimous essential',
  [...healthLib].join(','));

console.log('\n=== mutation: agreeing comparable category, essential ↔ discretionary ===');
const groceries = live.categories.find(c => c.id === 'groceries');
ok(groceries && groceries.class === 'essential' && one(periodTypes(periods, 'Groceries')) === 'essential',
  'Groceries currently agrees as essential');

const flipForward = clone(live);
flipForward.categories = clone(live.categories).map(c =>
  c.id === 'groceries' ? Object.assign({}, c, { class: 'discretionary' }) : c);
const flipForwardProblems = classificationProblems(flipForward);
ok(flipForwardProblems.some(p => p.startsWith('contradiction:Groceries:forward=discretionary:historical=essential')),
  'flipping Groceries forward to discretionary fails the reconciliation rule',
  flipForwardProblems.filter(p => p.includes('Groceries')).join('; '));

const flipPublished = clone(live);
flipPublished.periods = clone(periods);
for (const period of Object.values(flipPublished.periods.periods)) {
  for (const row of period.spending || []) {
    if (row.label === 'Groceries') row.type = 'discretionary';
  }
}
const flipPublishedProblems = classificationProblems(flipPublished);
ok(flipPublishedProblems.some(p => p.startsWith('contradiction:Groceries:forward=essential:historical=discretionary')),
  'flipping published Groceries history to discretionary fails the reconciliation rule',
  flipPublishedProblems.filter(p => p.includes('Groceries')).join('; '));

console.log('\n=== mutation: business survives ===');
ok(!classificationProblems(live).some(p => p.startsWith('business')),
  'live business classification does not fail the household comparable check');
const coerceBusiness = clone(live);
coerceBusiness.library = clone(library).map(r =>
  r.category === 'Business' ? Object.assign({}, r, { type: 'essential' }) : r);
ok(classificationProblems(coerceBusiness).includes('business-coerced'),
  'coercing Business into essential fails; business is not flattened');
const budgetBusiness = clone(live);
budgetBusiness.categories = clone(live.categories).concat([{
  id: 'biz', class: 'discretionary', from: ['Business'],
}]);
ok(classificationProblems(budgetBusiness).some(p => p.startsWith('business-as-household')),
  'putting Business into a discretionary budget category fails');

console.log('\n=== mutation: reserve survives ===');
ok(!classificationProblems(live).some(p => p.includes('Property tax') || p.includes(':Tax:')),
  'live reserve vs historical essential does not fail');
const coerceReserve = clone(live);
coerceReserve.categories = clone(live.categories).map(c =>
  c.id === 'propertytax' ? Object.assign({}, c, { class: 'discretionary' }) : c);
ok(classificationProblems(coerceReserve).some(p =>
  p === 'contradiction:Property tax:forward=discretionary:historical=essential'),
  'coercing Property tax from reserve into discretionary contradicts historical essential',
  classificationProblems(coerceReserve).filter(p => p.includes('Property tax')).join('; '));
const keepReserveEssential = clone(live);
keepReserveEssential.categories = clone(live.categories).map(c =>
  c.id === 'propertytax' ? Object.assign({}, c, { class: 'essential' }) : c);
ok(!classificationProblems(keepReserveEssential).some(p => p.includes('Property tax')),
  'reserve is not required to match historical essential — essential would agree, and is a different (cap) decision');

console.log('\n=== mutation: no blanket exception ===');
const flipRestaurants = clone(live);
flipRestaurants.categories = clone(live.categories).map(c =>
  c.id === 'restaurants' ? Object.assign({}, c, { class: 'essential' }) : c);
ok(classificationProblems(flipRestaurants).some(p =>
  p === 'contradiction:Restaurants:forward=essential:historical=discretionary'),
  'an arbitrary Restaurants essential/discretionary flip fails',
  classificationProblems(flipRestaurants).filter(p => p.includes('Restaurants')).join('; '));

const invent = clone(live);
invent.library = clone(library).concat([{ pattern: 'FAKE', category: 'GhostSpend', type: 'discretionary' }]);
invent.periods = clone(periods);
invent.periods.periods.ytd.spending.push({ label: 'GhostSpend', total: 1, type: 'discretionary' });
invent.categories = clone(live.categories).concat([{
  id: 'ghost', class: 'essential', from: ['GhostSpend'],
}]);
ok(classificationProblems(invent).some(p =>
  p === 'contradiction:GhostSpend:forward=essential:historical=discretionary'),
  'a new overlapping essential/discretionary pair fails unless explicitly named',
  classificationProblems(invent).filter(p => p.includes('GhostSpend')).join('; '));

const dropSchool = classificationProblems(Object.assign({}, live, { unresolved: new Set() }));
ok(dropSchool.some(p => p === 'contradiction:School & clubs:forward=discretionary:historical=essential'),
  'dropping School & clubs from the closed unresolved list re-exposes the contradiction');

const mixedHealth = clone(live);
mixedHealth.library = clone(library).map((r, i) =>
  r.category === 'Health' && i === library.findIndex(x => x.category === 'Health')
    ? Object.assign({}, r, { type: 'discretionary' })
    : r);
ok(classificationProblems(mixedHealth).some(p => p.startsWith('library-mixed:Health:')),
  'mixing essential and discretionary inside one mapped library category fails',
  classificationProblems(mixedHealth).filter(p => p.includes('Health')).join('; '));

console.log('\n=== generator: library type matches published periods.json ===');
const mappedLabels = new Set();
for (const c of budget.categories) {
  for (const label of c.from || []) {
    if (label !== PAYPAL_CHANNEL) mappedLabels.add(label);
  }
}
mappedLabels.add('Business');
let stale = 0;
for (const label of mappedLabels) {
  const libType = one(libraryTypes(library, label));
  const published = one(periodTypes(periods, label));
  if (libType && published && libType !== published) stale++;
}
ok(stale === 0,
  'overlapping merchant-library types match public/periods.json; generated output is current',
  `${mappedLabels.size} mapped labels`);

const staleLib = clone(live);
staleLib.library = clone(library).map(r =>
  r.category === 'Groceries' ? Object.assign({}, r, { type: 'discretionary' }) : r);
ok(classificationProblems(staleLib).some(p => p.startsWith('stale-periods:Groceries:')),
  'changing a library type without regenerating periods.json fails',
  classificationProblems(staleLib).filter(p => p.includes('Groceries')).join('; '));

console.log('\n' + (failures ? `${failures} CHECKS FAILED` : 'ALL CHECKS PASSED'));
if (failures) process.exit(1);
