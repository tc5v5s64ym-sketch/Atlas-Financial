'use strict';
/* Knowledge-Evidence Register — external-reference record integrity only.
 *
 * This suite proves that every record in docs/knowledge_evidence/register.json:
 *   1. is identifiable as the `external-reference` trust class;
 *   2. retains source / provenance sufficient for reliance;
 *   3. retains checked / freshness dates and a re-check reason;
 *   4. declares what it may inform, and that surface exists under docs/;
 *   5. explicitly cannot be read as a household fact, Forecast evidence,
 *      owner policy, or financial permission — and carries no household
 *      figure, household date, or provider identifier of its own.
 *
 * It also proves the first record's re-homing: the TD renewal claim body no
 * longer sits inline in docs/ACCOUNT_FACTS.md, which now points at the record,
 * and scripts/calendar-ics.js derives the matching reminder text and the
 * 150/120 look-point labels and dates from the same record instead of
 * authoring a second copy.
 *
 * It does NOT prove:
 *   - that the external claim is true, or that the institution still applies it;
 *   - that any household figure is correct;
 *   - that Forecast arithmetic is correct.
 *
 * Forecast remains the sole household calculator. A record here informs
 * explanation only.
 */

const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const REGISTER_PATH = path.join(ROOT, 'docs/knowledge_evidence/register.json');
const EVIDENCE_USE_PATH = path.join(ROOT, 'docs/evidence_use/register.json');
const ACCOUNT_FACTS_PATH = path.join(ROOT, 'docs/ACCOUNT_FACTS.md');
const CALENDAR_ICS_PATH = path.join(ROOT, 'scripts/calendar-ics.js');

const ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TRUST_CLASS = 'external-reference';
const CONTENT_CLASSES = new Set(['general', 'domain', 'external']);
const SOURCE_KINDS = new Set(['institution-published', 'third-party-commentary']);
const REQUIRED_IS_NOT = [
  'household-fact',
  'forecast-input',
  'forecast-output',
  'owner-policy',
  'transaction-evidence',
  'provider-evidence',
  'financial-permission',
  'sufficient-authority',
];
// A record is knowledge about the world, not about the household. Any of these
// inside a record means a household figure or identifier has leaked in.
const HOUSEHOLD_LEAK_RE = /\$\s?\d|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d{2}\b|\b\d+(?:\.\d+)?\s?%|Chequing|HELOC|Triangle|MBNA|Lunch Money|Seaspan|Tennis BC/;
const FENCE_RE = /^```evidence-ids[ \t]*\n([\s\S]*?)^```/gm;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

function hasHeading(text, heading) {
  return sourceText(text).split('\n').some((line) => {
    const h = /^#{1,6}[ \t]+(.+?)\s*$/.exec(line);
    return h && h[1].includes(heading);
  });
}

function resolveUnderDocs(relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) return null;
  const posix = relPath.replace(/\\/g, '/');
  if (path.posix.isAbsolute(posix) || posix.includes('\0')) return null;
  const normalized = path.posix.normalize(posix);
  if (normalized !== 'docs' && !normalized.startsWith('docs/')) return null;
  if (normalized.split('/').includes('..')) return null;
  return normalized;
}

function fsCtx(root) {
  const abs = (p) => path.join(root, p);
  const docsRoot = path.resolve(root, 'docs');
  return {
    resolveDocs: (p) => {
      const normalized = resolveUnderDocs(p);
      if (!normalized) return null;
      const resolvedAbs = path.resolve(root, normalized);
      const rel = path.relative(docsRoot, resolvedAbs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return normalized;
    },
    exists: (p) => fs.existsSync(abs(p)),
    read: (p) => fs.readFileSync(abs(p), 'utf8'),
  };
}

function recordProblems(register, ctx) {
  const problems = [];
  if (register.schema !== 'atlas-knowledge-evidence-register/v1') {
    problems.push('register must declare atlas-knowledge-evidence-register/v1');
  }
  const classes = register.trust_classes || {};
  const def = classes[TRUST_CLASS];
  if (!def || typeof def !== 'object') {
    problems.push(`register must define trust_classes.${TRUST_CLASS}`);
  } else {
    for (const tag of REQUIRED_IS_NOT) {
      if (!Array.isArray(def.never) || !def.never.includes(tag)) {
        problems.push(`trust_classes.${TRUST_CLASS}.never must include ${tag}`);
      }
    }
  }
  const items = Array.isArray(register.items) ? register.items : null;
  if (!items) {
    problems.push('register.items must be an array');
    return problems;
  }
  const seen = new Set();
  for (const [index, row] of items.entries()) {
    const where = row && row.id ? row.id : `items[${index}]`;
    if (!row || typeof row !== 'object') {
      problems.push(`${where}: row must be an object`);
      continue;
    }
    if (!ID_RE.test(row.id || '')) problems.push(`${where}: id must match ${ID_RE}`);
    if (seen.has(row.id)) problems.push(`${where}: duplicate knowledge ID`);
    seen.add(row.id);

    // 1. identifiable as external-reference
    if (row.trust_class !== TRUST_CLASS) {
      problems.push(`${where}: trust_class must be ${JSON.stringify(TRUST_CLASS)}, got ${JSON.stringify(row.trust_class)}`);
    }
    if (!CONTENT_CLASSES.has(row.content_class)) {
      problems.push(`${where}: content_class must be general / domain / external`);
    }
    if (!row.subject || !String(row.subject).trim()) problems.push(`${where}: subject is required`);
    if (!Array.isArray(row.claims) || row.claims.length === 0
      || row.claims.some((c) => typeof c !== 'string' || !c.trim())) {
      problems.push(`${where}: claims must be a non-empty array of non-empty strings`);
    }

    // 2. provenance
    const prov = row.provenance;
    if (!prov || typeof prov !== 'object') {
      problems.push(`${where}: provenance is required`);
    } else {
      if (!DATE_RE.test(prov.researched_on || '')) problems.push(`${where}: provenance.researched_on must be YYYY-MM-DD`);
      if (!prov.method || !String(prov.method).trim()) problems.push(`${where}: provenance.method is required`);
      if (!Array.isArray(prov.sources) || prov.sources.length === 0) {
        problems.push(`${where}: provenance.sources must name at least one source`);
      } else {
        for (const [i, src] of prov.sources.entries()) {
          if (!src || typeof src !== 'object') { problems.push(`${where}: sources[${i}] must be an object`); continue; }
          if (!src.publisher || !String(src.publisher).trim()) problems.push(`${where}: sources[${i}].publisher is required`);
          if (!SOURCE_KINDS.has(src.kind)) problems.push(`${where}: sources[${i}].kind must be institution-published or third-party-commentary`);
          if (!/^https:\/\/\S+$/.test(src.url || '')) problems.push(`${where}: sources[${i}].url must be an https URL`);
        }
      }
    }

    // 3. freshness
    const fresh = row.freshness;
    if (!fresh || typeof fresh !== 'object') {
      problems.push(`${where}: freshness is required`);
    } else {
      if (!DATE_RE.test(fresh.checked_on || '')) problems.push(`${where}: freshness.checked_on must be YYYY-MM-DD`);
      if (!DATE_RE.test(fresh.review_by || '')) problems.push(`${where}: freshness.review_by must be YYYY-MM-DD`);
      if (DATE_RE.test(fresh.checked_on || '') && DATE_RE.test(fresh.review_by || '')
        && !(fresh.review_by > fresh.checked_on)) {
        problems.push(`${where}: freshness.review_by must be after checked_on`);
      }
      if (!fresh.review_reason || !String(fresh.review_reason).trim()) problems.push(`${where}: freshness.review_reason is required`);
    }

    // 4. what it may inform — an existing docs/ surface, never a Forecast or publication file
    if (!Array.isArray(row.may_inform) || row.may_inform.length === 0) {
      problems.push(`${where}: may_inform must name at least one surface`);
    } else {
      for (const [i, target] of row.may_inform.entries()) {
        if (!target || typeof target !== 'object' || !target.path) {
          problems.push(`${where}: may_inform[${i}].path is required`);
          continue;
        }
        const resolved = ctx.resolveDocs
          ? ctx.resolveDocs(target.path)
          : resolveUnderDocs(target.path);
        if (!resolved) {
          problems.push(`${where}: may_inform[${i}].path "${target.path}" must be under docs/ (explanation only; not Forecast, data.json, or a page)`);
          continue;
        }
        if (ctx.exists && !ctx.exists(resolved)) {
          problems.push(`${where}: may_inform[${i}].path "${resolved}" does not exist`);
        } else if (ctx.read) {
          const text = ctx.read(resolved);
          if (target.heading && !hasHeading(text, target.heading)) {
            problems.push(`${where}: may_inform[${i}].heading "${target.heading}" not found in ${resolved}`);
          }
          if (!text.includes(row.id)) {
            problems.push(`${where}: ${resolved} does not point back at ${row.id}`);
          }
        }
        if (!target.as || !String(target.as).trim()) problems.push(`${where}: may_inform[${i}].as is required`);
      }
    }

    // 5. closed exclusions, and no household figure inside the record
    for (const tag of REQUIRED_IS_NOT) {
      if (!Array.isArray(row.is_not) || !row.is_not.includes(tag)) {
        problems.push(`${where}: is_not must include ${tag}`);
      }
    }
    const leak = HOUSEHOLD_LEAK_RE.exec(JSON.stringify(row));
    if (leak) {
      problems.push(`${where}: record carries a household figure or identifier (${JSON.stringify(leak[0])})`);
    }
  }
  return problems;
}

function evidenceUseIds(root) {
  const ids = new Set();
  const reg = JSON.parse(fs.readFileSync(path.join(root, 'docs/evidence_use/register.json'), 'utf8'));
  for (const row of reg.items || []) ids.add(row.id);
  return ids;
}

function fencedEvidenceIds(root) {
  const ids = new Set();
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.md')) {
        const text = sourceText(fs.readFileSync(p, 'utf8'));
        const re = new RegExp(FENCE_RE.source, 'gm');
        let m;
        while ((m = re.exec(text))) {
          for (const line of m[1].split('\n')) {
            const id = line.trim();
            if (id && !id.startsWith('#')) ids.add(id);
          }
        }
      }
    }
  };
  walk(path.join(root, 'docs'));
  return ids;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

console.log('\n=== live knowledge-evidence register ===');
const register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
ok(register.schema === 'atlas-knowledge-evidence-register/v1',
  'register declares atlas-knowledge-evidence-register/v1');
ok(/household fact|Forecast input|owner policy|financial permission/i.test(register.does_not_own || '')
  && /sole household calculator/i.test(register.does_not_own || ''),
'register states it owns no household fact, Forecast input, owner policy, or financial permission');
ok(/explicitly identified/i.test(register.coverage || '')
  && /does not verify a claim/i.test(register.coverage || ''),
'register states coverage is explicit IDs only and does not verify the claim itself');
ok((register.items || []).length >= 1, 'at least one record exists',
  `${(register.items || []).length} record(s)`);

const liveProblems = recordProblems(register, fsCtx(ROOT));
ok(liveProblems.length === 0, 'every live record has closed external-reference integrity',
  liveProblems.slice(0, 8).join('; '));

const evidenceIds = evidenceUseIds(ROOT);
const fenced = fencedEvidenceIds(ROOT);
for (const row of register.items || []) {
  ok(!evidenceIds.has(row.id), `${row.id} does not collide with an Evidence-Use Register ID`);
  ok(!fenced.has(row.id), `${row.id} is not declared in an evidence-ids fence`);
}

console.log('\n=== EXT-TD-RENEWAL-001 — the first external-reference record ===');
const td = (register.items || []).find((row) => row.id === 'EXT-TD-RENEWAL-001');
ok(!!td, 'EXT-TD-RENEWAL-001 exists');
if (td) {
  ok(td.trust_class === 'external-reference' && td.content_class === 'external',
    '1. identifiable as external-reference / external');
  ok(td.provenance.researched_on === '2026-08-09'
    && td.provenance.sources.some((s) => s.kind === 'institution-published' && /td\.com\//.test(s.url))
    && td.provenance.sources.some((s) => s.kind === 'third-party-commentary'),
  '2. retains the 2026-08-09 research date, the TD source, and the third-party source by kind');
  ok(td.freshness.checked_on === '2026-08-09' && DATE_RE.test(td.freshness.review_by)
    && td.freshness.review_by > td.freshness.checked_on,
  '3. retains checked_on and a later review_by',
  `${td.freshness.checked_on} → ${td.freshness.review_by}`);
  ok(td.may_inform.length === 1 && td.may_inform[0].path === 'docs/ACCOUNT_FACTS.md'
    && td.may_inform[0].heading === 'The renewal countdown',
  '4. declares it may inform only the ACCOUNT_FACTS renewal countdown');
  ok(REQUIRED_IS_NOT.every((tag) => td.is_not.includes(tag)),
    '5. is_not carries every closed exclusion');
  ok(!HOUSEHOLD_LEAK_RE.test(JSON.stringify(td)),
    '5. the record carries no household amount, percentage, or account identifier');
  ok(!/2027-05-01|1 May 2027|May 2027/.test(JSON.stringify(td)),
    '5. the record does not carry the household maturity date');
  ok(td.claims.some((c) => /120 days before maturity/.test(c))
    && td.claims.some((c) => /extendable to about 150/.test(c))
    && td.claims.some((c) => /four to five months/.test(c)),
  'the re-homed claim body (120-day window, 150-day extension, contact timing) is retained');
}

console.log('\n=== ACCOUNT_FACTS points at the record and no longer holds the claim body ===');
const facts = sourceText(fs.readFileSync(ACCOUNT_FACTS_PATH, 'utf8'));
ok(hasHeading(facts, 'The renewal countdown'), 'the renewal countdown heading still exists');
ok(facts.includes('EXT-TD-RENEWAL-001') && facts.includes('knowledge_evidence/register.json'),
  'ACCOUNT_FACTS names the record ID and the register path');
ok(!/researched 2026-08-09/.test(facts),
  'the non-vocabulary "researched" trust tag is gone from ACCOUNT_FACTS');
ok(!/td\.com\/ca\/en\/personal-banking\/products\/mortgages/.test(facts)
  && !/mortgagerenewalhub\.ca/.test(facts),
'the TD and third-party source URLs live only in the register');
ok(!/extendable to about 150/.test(facts) && !/four to five months out/.test(facts),
  'the claim body sentences are not duplicated in ACCOUNT_FACTS');
ok(/1 May 2027/.test(facts), 'the household maturity date stays a household fact in ACCOUNT_FACTS');

console.log('\n=== calendar-ics.js derives the TD renewal claim; it is not a second home ===');
const icsSrc = sourceText(fs.readFileSync(CALENDAR_ICS_PATH, 'utf8'));
const icsMod = require('../scripts/calendar-ics.js');
ok(icsSrc.includes('EXT-TD-RENEWAL-001') && icsSrc.includes('knowledge_evidence/register.json'),
  'calendar-ics.js names EXT-TD-RENEWAL-001 and reads the register');
ok(!/extendable to about 150/.test(icsSrc) && !/four to five months/.test(icsSrc),
  'the claim-body sentences are not hardcoded in calendar-ics.js');
ok(!/150 days out, TD can hold a rate/.test(icsSrc)
  && !/120-day window OPENS/.test(icsSrc)
  && !/Exactly 120 days before/.test(icsSrc)
  && !/2026-12-02/.test(icsSrc)
  && !/'2027-01-01'/.test(icsSrc),
  'the 150/120 claim labels and claim-derived dates are not hardcoded in calendar-ics.js');
ok(!/td\.com\/ca\/en\/personal-banking\/products\/mortgages/.test(icsSrc)
  && !/mortgagerenewalhub\.ca/.test(icsSrc)
  && !/truemortgageplus\.com/.test(icsSrc),
  'the source URLs are not hardcoded in calendar-ics.js');
const plan = require('../data.json').plan;
const householdMaturity = require('../data.json').mortgage.maturity;
ok(householdMaturity === '2027-05-01',
  'household maturity remains 2027-05-01 (independent of the knowledge record)');
const builtIcs = icsMod.buildHouseholdCalendar(plan, '2026-08-09');
const hold = builtIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-hold@household');
const windowRem = builtIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-window@household');
const letter = builtIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-letter@household');
const maturity = builtIcs.reminders.find((r) => r.uid === 'atlas-reminder-maturity@household');
ok(!!hold && !!windowRem && !!letter && !!maturity, 'the four mortgage-renewal reminders still exist');
if (hold && windowRem && letter && maturity && td) {
  // Independent calendar arithmetic: 1 May 2027 minus 150 days is 2 Dec 2026;
  // minus 120 days is 1 Jan 2027 (Jan 1 + 31 + 28 + 31 + 30 = 120 to May 1).
  ok(hold.start === '2026-12-02' && /150 days before household maturity/.test(hold.summary)
    && hold.summary.includes('EXT-TD-RENEWAL-001')
    && !/TD can hold a rate/.test(hold.summary),
  'hold label/date derive from the record\'s 150-day extension applied to household maturity');
  ok(windowRem.start === '2027-01-01' && /120 days before household maturity/.test(windowRem.summary)
    && windowRem.summary.includes('EXT-TD-RENEWAL-001')
    && !/prepayment charge/.test(windowRem.summary),
  'window label/date derive from the record\'s 120-day window applied to household maturity');
  for (const [name, rem] of [['hold', hold], ['window', windowRem], ['letter', letter], ['maturity', maturity]]) {
    ok(rem.description.includes('EXT-TD-RENEWAL-001'),
      `${name} reminder names EXT-TD-RENEWAL-001`);
    ok(rem.description.includes('extendable to about 150')
      && rem.description.includes('120 days before maturity'),
    `${name} reminder derives the 150-day and 120-day claims from the record`);
    ok(td.provenance.sources.every((s) => rem.description.includes(s.url)),
      `${name} reminder derives its source URLs from the record`);
  }
  const shiftedReg = clone(register);
  const shiftedRow = shiftedReg.items.find((row) => row.id === 'EXT-TD-RENEWAL-001');
  shiftedRow.claims = [
    'TD lets a closed mortgage renew early up to 90 days before maturity with no prepayment charge and no fee.',
    'TD\'s standard rate hold is 90 days, extendable to about 100 days for existing clients. A held rate is a floor, not a commitment.',
  ];
  const shiftedIcs = icsMod.buildHouseholdCalendar(plan, '2026-08-09', undefined, shiftedReg);
  const shiftedHold = shiftedIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-hold@household');
  const shiftedWindow = shiftedIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-window@household');
  ok(!!shiftedHold && shiftedHold.start === '2027-01-21'
    && /100 days before household maturity/.test(shiftedHold.summary)
    && !/150 days/.test(shiftedHold.summary) && shiftedHold.start !== '2026-12-02',
  'changing the record\'s 150-day claim moves the hold look-point (1 May 2027 minus 100 days is 21 Jan 2027)');
  ok(!!shiftedWindow && shiftedWindow.start === '2027-01-31'
    && /90 days before household maturity/.test(shiftedWindow.summary)
    && !/120 days/.test(shiftedWindow.summary) && shiftedWindow.start !== '2027-01-01',
  'changing the record\'s 120-day claim moves the window look-point (1 May 2027 minus 90 days is 31 Jan 2027)');
  const mutatedReg = clone(register);
  const mutRow = mutatedReg.items.find((row) => row.id === 'EXT-TD-RENEWAL-001');
  mutRow.claims = ['MUTATED-TD-RENEWAL-CLAIM-UNIQUE'];
  mutRow.provenance.sources[0].url = 'https://example.test/mutated-td-source';
  const mutatedIcs = icsMod.buildHouseholdCalendar(plan, '2026-08-09', undefined, mutatedReg);
  const mutHold = mutatedIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-hold@household');
  const mutWindow = mutatedIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-window@household');
  const mutLetter = mutatedIcs.reminders.find((r) => r.uid === 'atlas-reminder-renewal-letter@household');
  ok(!mutHold && !mutWindow,
    'the calendar cannot retain the 150/120 look-points when the record no longer asserts those windows');
  ok(!!mutLetter && mutLetter.description.includes('MUTATED-TD-RENEWAL-CLAIM-UNIQUE')
    && mutLetter.description.includes('https://example.test/mutated-td-source'),
  'a register edit moves the remaining ICS reminder text');
  ok(!!mutLetter && !/extendable to about 150/.test(mutLetter.description)
    && !/td\.com\/ca\/en\/personal-banking\/products\/mortgages/.test(mutLetter.description),
  'the previous claim body and TD URL leave the ICS when the record changes');
  const claimBearing = mutatedIcs.reminders.filter((r) =>
    /150 days out|120-day window|TD can hold a rate|prepayment charge/.test(`${r.summary}\n${r.start}`)
    || r.start === '2026-12-02' || (r.uid.includes('renewal-window') && r.start === '2027-01-01'));
  ok(claimBearing.length === 0,
    'no reminder keeps a 150/120 renewal assertion after the record is stripped');
  let missingThrew = false;
  try {
    const empty = clone(register);
    empty.items = [];
    icsMod.buildHouseholdCalendar(plan, '2026-08-09', undefined, empty);
  } catch (err) {
    missingThrew = /EXT-TD-RENEWAL-001/.test(err && err.message);
  }
  ok(missingThrew, 'ICS generation fails closed when EXT-TD-RENEWAL-001 is missing');
}

console.log('\n=== mutation bite: the validator rejects each contract breach ===');
const ctx = fsCtx(ROOT);
const bite = (label, mutate, expect) => {
  const mutated = clone(register);
  mutate(mutated, mutated.items.find((row) => row.id === 'EXT-TD-RENEWAL-001'));
  const problems = recordProblems(mutated, ctx);
  ok(problems.some((p) => expect.test(p)), label, problems.filter((p) => expect.test(p)).join('; '));
};
bite('reclassifying the record as a household fact fails',
  (_, row) => { row.trust_class = 'household-fact'; }, /trust_class must be/);
bite('an unknown content class fails',
  (_, row) => { row.content_class = 'household'; }, /content_class must be/);
bite('dropping provenance.sources fails',
  (_, row) => { row.provenance.sources = []; }, /at least one source/);
bite('a non-https source fails',
  (_, row) => { row.provenance.sources[0].url = 'http://example.test/x'; }, /must be an https URL/);
bite('dropping researched_on fails',
  (_, row) => { delete row.provenance.researched_on; }, /researched_on/);
bite('dropping freshness.review_by fails',
  (_, row) => { delete row.freshness.review_by; }, /review_by must be/);
bite('a review_by on or before checked_on fails',
  (_, row) => { row.freshness.review_by = row.freshness.checked_on; }, /review_by must be after/);
bite('dropping the review reason fails',
  (_, row) => { row.freshness.review_reason = ''; }, /review_reason/);
bite('pointing may_inform at data.json fails',
  (_, row) => { row.may_inform[0].path = 'data.json'; }, /must be under docs\//);
bite('pointing may_inform at Forecast fails',
  (_, row) => { row.may_inform[0].path = 'public/forecast.js'; }, /must be under docs\//);
bite('pointing may_inform at docs/../public/plan.js fails',
  (_, row) => { row.may_inform[0].path = 'docs/../public/plan.js'; }, /must be under docs\//);
bite('pointing may_inform at docs/../public/forecast.js fails',
  (_, row) => { row.may_inform[0].path = 'docs/../public/forecast.js'; }, /must be under docs\//);
bite('docs/../ARCHITECTURE.md fails even though that file names the ID',
  (_, row) => { row.may_inform[0].path = 'docs/../ARCHITECTURE.md'; }, /must be under docs\//);
bite('a may_inform heading that does not exist fails',
  (_, row) => { row.may_inform[0].heading = 'No Such Heading'; }, /heading .* not found/);
bite('a may_inform surface that does not point back at the ID fails',
  (_, row) => { row.may_inform[0].path = 'docs/evidence_use/README.md'; delete row.may_inform[0].heading; }, /does not point back/);
bite('removing the household-fact exclusion fails',
  (_, row) => { row.is_not = row.is_not.filter((t) => t !== 'household-fact'); }, /is_not must include household-fact/);
bite('removing the forecast-input exclusion fails',
  (_, row) => { row.is_not = row.is_not.filter((t) => t !== 'forecast-input'); }, /is_not must include forecast-input/);
bite('removing the owner-policy exclusion fails',
  (_, row) => { row.is_not = row.is_not.filter((t) => t !== 'owner-policy'); }, /is_not must include owner-policy/);
bite('removing the financial-permission exclusion fails',
  (_, row) => { row.is_not = row.is_not.filter((t) => t !== 'financial-permission'); }, /is_not must include financial-permission/);
bite('a household dollar amount inside a claim fails',
  (_, row) => { row.claims.push('The balance is $201,586.'); }, /household figure or identifier \("\$2"\)/);
bite('a household percentage inside a claim fails',
  (_, row) => { row.claims.push('The rate is 4.90%.'); }, /household figure or identifier \("4\.90/);
bite('a household account name inside a claim fails',
  (_, row) => { row.claims.push('Fold the HELOC in.'); }, /household figure or identifier \("HELOC"\)/);
bite('a provider identifier inside a claim fails',
  (_, row) => { row.claims.push('Lunch Money shows the renewal.'); }, /household figure or identifier/);
bite('a trust class without the closed never-list fails',
  (reg) => { reg.trust_classes['external-reference'].never = []; }, /never must include/);
bite('a duplicate knowledge ID fails',
  (reg, row) => { reg.items.push(clone(row)); }, /duplicate knowledge ID/);

ok(recordProblems(register, ctx).length === 0, 'restoring the live register passes');

console.log('\n=== this suite does not prove the external claim is true ===');
ok(true, 'no institution is contacted and no household figure is compared');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll knowledge-evidence register checks passed');
