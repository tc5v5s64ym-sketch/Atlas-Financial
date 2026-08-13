'use strict';
/* Evidence-Use Register — routing/disposition integrity only.
 *
 * This suite proves that every explicitly identified governed evidence ID has
 * exactly one declaration identity, exactly one closed disposition, and that
 * disposition-specific pointers can be resolved as paths/headings/questions.
 *
 * It does NOT prove:
 *   - that a CONSUMED incumbent value is financially correct;
 *   - that a figure is current, verified, or correctly trust-labelled;
 *   - that Forecast arithmetic is correct;
 *   - that every sentence in Markdown has been identified as material.
 *
 * CONSUMED means: this evidence item is routed to a named incumbent that
 * exists. Pointer existence is not a financial green.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const REGISTER_PATH = path.join(ROOT, 'docs/evidence_use/register.json');
const ID_RE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-[0-9]{3}$/;
const DISPOSITIONS = new Set(['CONSUMED', 'PROPOSED', 'UNRESOLVED', 'SUPERSEDED', 'EXCLUDED']);
const FENCE_RE = /^```evidence-ids[ \t]*\n([\s\S]*?)^```/gm;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

function walkMarkdown(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walkMarkdown(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

function parseEvidenceIdFences(relPath, text) {
  const occurrences = [];
  const fenceRe = new RegExp(FENCE_RE.source, 'gm');
  let fenceIndex = 0;
  let match;
  while ((match = fenceRe.exec(text))) {
    fenceIndex += 1;
    const lines = match[1].split(/\r?\n/);
    for (let offset = 0; offset < lines.length; offset += 1) {
      const id = lines[offset].trim();
      if (!id || id.startsWith('#')) continue;
      occurrences.push({
        id,
        file: relPath,
        fence: fenceIndex,
        line: offset + 1,
      });
    }
  }
  return occurrences;
}

function uniquenessProblems(occurrences) {
  const byId = new Map();
  for (const occ of occurrences) {
    if (!byId.has(occ.id)) byId.set(occ.id, []);
    byId.get(occ.id).push(occ);
  }
  const problems = [];
  for (const [id, locs] of byId) {
    if (locs.length < 2) continue;
    const where = locs
      .map((loc) => `${loc.file} fence ${loc.fence} line ${loc.line}`)
      .join('; ');
    problems.push(`${id}: declared ${locs.length} times — ${where}`);
  }
  return problems;
}

function uniqueDeclaredIds(occurrences) {
  return new Set(occurrences.map((occ) => occ.id));
}

function collectDeclarations(root) {
  const docs = path.join(root, 'docs');
  const occurrences = [];
  for (const file of walkMarkdown(docs)) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    occurrences.push(...parseEvidenceIdFences(rel, fs.readFileSync(file, 'utf8')));
  }
  return {
    occurrences,
    duplicateProblems: uniquenessProblems(occurrences),
    uniqueIds: uniqueDeclaredIds(occurrences),
  };
}

function hasHeading(text, heading) {
  const lines = text.split(/\r?\n/);
  return lines.some((line) => {
    const h = /^#{1,6}[ \t]+(.+?)\s*$/.exec(line);
    return h && h[1].includes(heading);
  });
}

function resolveJsonPointer(doc, pointer) {
  if (pointer === '') return { ok: true, value: doc };
  if (!pointer.startsWith('/')) return { ok: false, reason: 'json_pointer must start with /' };
  const parts = pointer.slice(1).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = doc;
  for (const part of parts) {
    if (cur == null || !Object.prototype.hasOwnProperty.call(cur, part)) {
      return { ok: false, reason: `json_pointer does not resolve at "${part}"` };
    }
    cur = cur[part];
  }
  return { ok: true, value: cur };
}

function routingProblems(register, ctx) {
  const problems = [];
  const items = Array.isArray(register.items) ? register.items : null;
  if (!items) {
    problems.push('register.items must be an array');
    return problems;
  }

  const byId = new Map();
  for (const [index, row] of items.entries()) {
    const where = row && row.id ? row.id : `items[${index}]`;
    if (!row || typeof row !== 'object') {
      problems.push(`${where}: row must be an object`);
      continue;
    }
    if (!ID_RE.test(row.id || '')) {
      problems.push(`${where}: id must match ${ID_RE}`);
    }
    if (byId.has(row.id)) problems.push(`${row.id}: duplicate evidence ID`);
    else byId.set(row.id, row);

    if (!row.source) problems.push(`${where}: source pointer is required`);
    else if (ctx.exists && !ctx.exists(row.source)) {
      problems.push(`${where}: source record "${row.source}" does not exist`);
    }

    if (!DISPOSITIONS.has(row.disposition)) {
      problems.push(`${where}: invalid disposition ${JSON.stringify(row.disposition)}`);
      continue;
    }

    if (row.disposition === 'CONSUMED') {
      const target = row.routed_to;
      if (!target || typeof target !== 'object' || !target.path) {
        problems.push(`${where}: CONSUMED requires routed_to.path (routing only; not financial correctness)`);
      } else if (ctx.exists && !ctx.exists(target.path)) {
        problems.push(`${where}: CONSUMED routed_to.path "${target.path}" does not exist (routing target missing)`);
      } else {
        if (target.heading && ctx.read) {
          const text = ctx.read(target.path);
          if (!hasHeading(text, target.heading)) {
            problems.push(`${where}: CONSUMED routed_to.heading "${target.heading}" not found in ${target.path}`);
          }
        }
        if (target.json_pointer && ctx.readJson) {
          const doc = ctx.readJson(target.path);
          const resolved = resolveJsonPointer(doc, target.json_pointer);
          if (!resolved.ok) {
            problems.push(`${where}: CONSUMED routed_to.json_pointer ${resolved.reason}`);
          }
        }
      }
    }

    if (row.disposition === 'PROPOSED') {
      if (!row.evidence_home) problems.push(`${where}: PROPOSED requires evidence_home`);
      else if (ctx.exists && !ctx.exists(row.evidence_home)) {
        problems.push(`${where}: PROPOSED evidence_home "${row.evidence_home}" does not exist`);
      }
      if (!row.owner_gate) problems.push(`${where}: PROPOSED requires owner_gate`);
    }

    if (row.disposition === 'UNRESOLVED') {
      if (!row.question_path) problems.push(`${where}: UNRESOLVED requires question_path`);
      else if (ctx.exists && !ctx.exists(row.question_path)) {
        problems.push(`${where}: UNRESOLVED question_path "${row.question_path}" does not exist`);
      } else if (row.question_marker && ctx.read) {
        const text = ctx.read(row.question_path);
        if (!text.includes(row.question_marker)) {
          problems.push(`${where}: UNRESOLVED question_marker "${row.question_marker}" not found in ${row.question_path}`);
        }
      }
      if (!row.question_marker) problems.push(`${where}: UNRESOLVED requires question_marker`);
    }

    if (row.disposition === 'SUPERSEDED') {
      if (!row.successor_id) problems.push(`${where}: SUPERSEDED requires successor_id`);
      else if (row.successor_id === row.id) {
        problems.push(`${where}: SUPERSEDED successor_id must not be self`);
      }
    }

    if (row.disposition === 'EXCLUDED') {
      if (!row.exclusion_reason) problems.push(`${where}: EXCLUDED requires exclusion_reason`);
      const hasReview = typeof row.review_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.review_date);
      const hasDurable = typeof row.no_review_reason === 'string' && row.no_review_reason.trim().length > 0;
      if (!hasReview && !hasDurable) {
        problems.push(`${where}: EXCLUDED requires review_date or no_review_reason`);
      }
    }
  }

  for (const [id, row] of byId) {
    if (row.disposition !== 'SUPERSEDED') continue;
    const seen = new Set([id]);
    let cur = row.successor_id;
    while (cur) {
      if (seen.has(cur)) {
        problems.push(`${id}: SUPERSEDED cycle involving ${cur}`);
        break;
      }
      const next = byId.get(cur);
      if (!next) {
        problems.push(`${id}: SUPERSEDED successor "${cur}" is missing from the register`);
        break;
      }
      seen.add(cur);
      cur = next.disposition === 'SUPERSEDED' ? next.successor_id : null;
    }
  }

  if (ctx.declaredIds) {
    for (const id of ctx.declaredIds) {
      if (!byId.has(id)) problems.push(`governed evidence ID ${id} is declared but missing from the register`);
    }
    for (const id of byId.keys()) {
      if (!ctx.declaredIds.has(id)) {
        problems.push(`${id}: register row has no matching evidence-ids declaration`);
      }
    }
  }

  return problems;
}

function fsCtx(root, declaredIds) {
  const abs = (p) => path.join(root, p);
  return {
    declaredIds,
    exists: (p) => fs.existsSync(abs(p)),
    read: (p) => fs.readFileSync(abs(p), 'utf8'),
    readJson: (p) => JSON.parse(fs.readFileSync(abs(p), 'utf8')),
  };
}

console.log('\n=== live register routing/disposition integrity ===');
const register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8'));
ok(register.schema === 'atlas-evidence-use-register/v1',
  'register declares atlas-evidence-use-register/v1');
ok(/routing only|not financial correctness|owns no financial/i.test(
  JSON.stringify(register.does_not_own || '') + JSON.stringify(register.owns || '')),
  'register states that it does not own financial correctness');
ok(/explicitly identified/i.test(register.coverage || ''),
  'register states coverage is explicit IDs only');

const liveDeclarations = collectDeclarations(ROOT);
ok(liveDeclarations.uniqueIds.size > 0,
  'at least one evidence-ids fence exists',
  `${liveDeclarations.uniqueIds.size} declared IDs`);
ok(liveDeclarations.duplicateProblems.length === 0,
  'each governed evidence ID is declared exactly once',
  liveDeclarations.duplicateProblems.slice(0, 4).join('; '));

const declared = liveDeclarations.uniqueIds;
const liveProblems = routingProblems(register, fsCtx(ROOT, declared));
ok(liveProblems.length === 0,
  'live register has closed routing/disposition integrity',
  liveProblems.slice(0, 8).join('; '));

const counts = {};
for (const row of register.items || []) {
  counts[row.disposition] = (counts[row.disposition] || 0) + 1;
}
ok((register.items || []).length === declared.size,
  `register row count matches declared ID count (${declared.size})`);
console.log(`  INFO  dispositions: ${JSON.stringify(counts)}`);

console.log('\n=== mutation bite: missing disposition ===');
const missingDisposition = JSON.parse(JSON.stringify(register));
const target = missingDisposition.items.find((row) => row.id === 'HELOC-004') || missingDisposition.items[0];
delete target.disposition;
const missingProblems = routingProblems(missingDisposition, fsCtx(ROOT, declared));
ok(missingProblems.some((p) => /invalid disposition/i.test(p) && p.includes(target.id)),
  'removing a governed ID disposition fails',
  missingProblems.filter((p) => p.includes(target.id)).join('; '));

const restoredProblems = routingProblems(register, fsCtx(ROOT, declared));
ok(restoredProblems.length === 0,
  'restoring the live register passes');

console.log('\n=== mutation bite: structural cases ===');
const brokenTarget = JSON.parse(JSON.stringify(register));
const consumedRow = brokenTarget.items.find((row) => row.disposition === 'CONSUMED');
consumedRow.routed_to = { path: 'docs/does-not-exist.md' };
ok(routingProblems(brokenTarget, fsCtx(ROOT, declared)).some((p) => /routed_to.path/.test(p)),
  'broken CONSUMED target fails');

const missingSuccessor = JSON.parse(JSON.stringify(register));
const supersededRow = missingSuccessor.items.find((row) => row.disposition === 'SUPERSEDED');
supersededRow.successor_id = 'ZZZ-999';
ok(routingProblems(missingSuccessor, fsCtx(ROOT, declared)).some((p) => /successor "ZZZ-999" is missing/.test(p)),
  'missing SUPERSEDED successor fails');

const cyclic = JSON.parse(JSON.stringify(register));
const a = cyclic.items.find((row) => row.disposition === 'SUPERSEDED');
const b = cyclic.items.find((row) => row.id === a.successor_id);
const originalDisp = b.disposition;
b.disposition = 'SUPERSEDED';
b.successor_id = a.id;
ok(routingProblems(cyclic, fsCtx(ROOT, declared)).some((p) => /cycle/.test(p)),
  'SUPERSEDED cycle fails');
b.disposition = originalDisp;
delete b.successor_id;

const badExcluded = JSON.parse(JSON.stringify(register));
const excludedRow = badExcluded.items.find((row) => row.disposition === 'EXCLUDED');
delete excludedRow.exclusion_reason;
delete excludedRow.review_date;
delete excludedRow.no_review_reason;
ok(routingProblems(badExcluded, fsCtx(ROOT, declared)).some((p) => /exclusion_reason|review_date or no_review_reason/.test(p)),
  'invalid EXCLUDED row fails');

const undeclaredGone = new Set(declared);
const dropId = [...declared][0];
undeclaredGone.delete(dropId);
ok(routingProblems(register, fsCtx(ROOT, undeclaredGone)).some((p) => p.includes(dropId) && /no matching evidence-ids/.test(p)),
  'register ID without a declaration fails');

const missingDeclared = new Set(declared);
missingDeclared.add('MISSING-001');
ok(routingProblems(register, fsCtx(ROOT, missingDeclared)).some((p) => /MISSING-001 is declared but missing/.test(p)),
  'declared governed ID missing from the register fails');

console.log('\n=== mutation bite: duplicate governed declaration ===');
ok(uniquenessProblems(liveDeclarations.occurrences).length === 0,
  'baseline live declarations pass uniqueness');

const duplicatedAcrossFiles = liveDeclarations.occurrences.concat([{
  id: 'HELOC-004',
  file: 'docs/fixture-duplicate-declaration.md',
  fence: 1,
  line: 1,
}]);
const acrossFileProblems = uniquenessProblems(duplicatedAcrossFiles);
ok(
  acrossFileProblems.some((p) => /HELOC-004: declared 2 times/.test(p)
    && p.includes('docs/source_intake/EVIDENCE_USE_LEDGER_2026-08-13.md')
    && p.includes('docs/fixture-duplicate-declaration.md')),
  'adding a second declaration of an already governed ID fails',
  acrossFileProblems.join('; '),
);

ok(uniquenessProblems(liveDeclarations.occurrences).length === 0,
  'removing that duplicate restores PASS');

const twiceInOneFence = parseEvidenceIdFences(
  'docs/fixture-same-fence.md',
  '```evidence-ids\nABC-001\nABC-001\n```\n',
);
ok(uniquenessProblems(twiceInOneFence).some((p) => /ABC-001: declared 2 times/.test(p)
  && /fence 1 line 1/.test(p)
  && /fence 1 line 2/.test(p)),
  'the same ID declared twice in one evidence-ids fence fails');

const twoFencesOneFile = parseEvidenceIdFences(
  'docs/fixture-two-fences.md',
  '```evidence-ids\nABC-001\n```\n\n```evidence-ids\nABC-001\n```\n',
);
ok(uniquenessProblems(twoFencesOneFile).some((p) => /ABC-001: declared 2 times/.test(p)
  && /fence 1 /.test(p)
  && /fence 2 /.test(p)),
  'the same ID declared in two fences in one file fails');

console.log('\n=== this suite does not prove financial correctness ===');
ok(true, 'no amount comparison is performed against data.json or Forecast');

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll evidence-use register checks passed');
