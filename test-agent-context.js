'use strict';
/* Mechanical coverage for Atlas Agent Context Architecture v1.
 *
 * This is not a financial-authority guard and does not claim to discover
 * every instruction an agent might follow. It covers the mechanically
 * enumerable surfaces v1 named:
 *
 *   1. AGENTS.md routes to skills, lessons, and the explainer without
 *      adding those files to the numbered always-load list.
 *   2. The skills catalog lists files that exist; each skill disclaims
 *      authority.
 *   3. Lessons are explicitly non-authoritative and carry provenance.
 *   4. Vendor adapters remain thin routers through AGENTS.md.
 *   5. Review workflows do not always-load skills, lessons, or the
 *      explainer.
 *
 * Changing this file does not move Forecast, household facts, or owner
 * policy. It is not a CLAUDE.md high-risk hard gate.
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

const agents = read('AGENTS.md');
const explainer = read('docs/AGENT_CONTEXT.md');
const catalog = read('docs/skills/README.md');
const lessonsIndex = read('docs/lessons/README.md');
const lessons = read('docs/lessons/TECHNICAL.md');
const copilot = read('.github/copilot-instructions.md');
const claude = read('CLAUDE.md');
const architecture = read('ARCHITECTURE.md');
const firstReview = read('.github/workflows/atlas-first-review.yml');
const rereview = read('.github/workflows/atlas-rereview.yml');

console.log('\n=== always-load router ===');
ok(/docs\/skills\//.test(agents) && /docs\/lessons\//.test(agents) && /docs\/AGENT_CONTEXT\.md/.test(agents),
  'AGENTS.md routes to skills, lessons, and the context explainer');

const numbered = [];
for (const line of agents.split('\n')) {
  const m = /^(\d+)\.\s+\[`([^`]+)`\]/.exec(line);
  if (m) numbered.push(m[2]);
}
ok(numbered.length >= 8, 'AGENTS.md still has the numbered always-load list',
  numbered.join(', '));
ok(!numbered.some(p => /skills|lessons|AGENT_CONTEXT/.test(p)),
  'skills, lessons, and the explainer are not in the numbered always-load list',
  numbered.filter(p => /skills|lessons|AGENT_CONTEXT/.test(p)).join(', ') || 'absent');
ok(numbered.includes('CLAUDE.md') && numbered.includes('ARCHITECTURE.md'),
  'CLAUDE.md and ARCHITECTURE.md remain in the always-load list');

console.log('\n=== explainer disclaims authority ===');
ok(/non-authoritative/.test(explainer),
  'docs/AGENT_CONTEXT.md calls learned lessons non-authoritative');
ok(/never autonomously/.test(explainer),
  'future dreaming is documented as propose-only');
ok(/What process or rule should we remove/.test(explainer),
  'dreaming must ask what to remove, not only what to add');
ok(!/calculation authority/.test(explainer) || /Forecast.*calculation authority/.test(explainer),
  'the explainer does not claim to be the calculation authority');
ok(/not Forecast/.test(explainer) && /not household truth/.test(explainer) && /not owner policy/.test(explainer),
  'the explainer disclaims Forecast, household truth, and owner policy');
ok(/no.*Forecast calculation/i.test(explainer) || /changes \*\*no\*\* Forecast/.test(explainer),
  'v1 states that runtime financial behavior did not change');

console.log('\n=== skills catalog ===');
ok(/Load on demand/.test(catalog), 'the skills catalog is load-on-demand');
const skillFiles = [...catalog.matchAll(/\[([a-z0-9-]+\.md)\]\(\1\)/g)].map(m => m[1]);
ok(skillFiles.length >= 3, 'the catalog lists at least three skill files',
  skillFiles.join(', '));
for (const file of skillFiles) {
  const rel = 'docs/skills/' + file;
  ok(fs.existsSync(path.join(__dirname, rel)), `${rel} exists`);
  const body = read(rel);
  ok(/not authority/.test(body) && (/not.*household/.test(body) || /not owner policy/.test(body) || /not Forecast/.test(body)),
    `${file} disclaims being Atlas authority`);
}

ok(fs.existsSync(path.join(__dirname, 'docs/skills/implement-pr.md')),
  'implement-pr skill exists');
ok(fs.existsSync(path.join(__dirname, 'docs/skills/forecast-runtime.md')),
  'forecast-runtime skill exists');
ok(fs.existsSync(path.join(__dirname, 'docs/skills/evidence-intake.md')),
  'evidence-intake skill exists');
ok(/Exact-head/.test(catalog) && /CLAUDE\.md/.test(catalog),
  'exact-head review stays a pointer to CLAUDE.md rather than a copied skill');

console.log('\n=== catalog bite proof ===');
const missingSkillCatalog = catalog.replace('[implement-pr.md](implement-pr.md)',
  '[no-such-skill.md](no-such-skill.md)');
const missingListed = [...missingSkillCatalog.matchAll(/\[([a-z0-9-]+\.md)\]\(\1\)/g)]
  .map(m => m[1])
  .filter(f => !fs.existsSync(path.join(__dirname, 'docs/skills', f)));
ok(missingListed.includes('no-such-skill.md'),
  'a catalog row whose file does not exist is detectable',
  missingListed.join(', '));

console.log('\n=== lessons ===');
ok(/non-authoritative/.test(lessonsIndex) && /non-authoritative/.test(lessons),
  'lessons index and list call themselves non-authoritative');
ok(/never:/.test(lessonsIndex) || /It is never/.test(lessonsIndex),
  'the lessons index states the hard boundary');
const lessonBlocks = lessons.split(/^## L-/m).slice(1);
ok(lessonBlocks.length >= 1, 'at least one numbered lesson exists',
  String(lessonBlocks.length));
for (const block of lessonBlocks) {
  const id = block.slice(0, 40).split('\n')[0];
  ok(/\*\*Evidence:\*\*/.test(block), `lesson ${id} has an Evidence line`);
  ok(/\*\*Not:\*\*/.test(block), `lesson ${id} has a Not line`);
  ok(/\*\*Status:\*\*/.test(block), `lesson ${id} has a Status line`);
}

console.log('\n=== vendor adapters stay routers ===');
ok(/Thin router/.test(copilot) && /AGENTS\.md/.test(copilot),
  '.github/copilot-instructions.md remains a thin AGENTS.md router');
ok(!/docs\/skills\/implement-pr/.test(copilot),
  'Copilot instructions do not inline a skill');
ok(/filename is retained[\s\S]{0,40}historical continuity/.test(claude)
    && /binds every approved implementation surface/.test(claude),
  'CLAUDE.md still binds every surface and is not Claude-only');
ok(/docs\/skills\//.test(claude) && /docs\/lessons\//.test(claude),
  'CLAUDE.md routes to skills and lessons without owning them');

console.log('\n=== architecture table routes, does not copy ===');
ok(/docs\/AGENT_CONTEXT\.md/.test(architecture),
  'ARCHITECTURE.md names the agent-context explainer as a concept owner');
ok(!/docs\/skills\/implement-pr/.test(architecture),
  'ARCHITECTURE.md does not inline a skill procedure');

console.log('\n=== review workflows do not always-load the new layer ===');
for (const [name, src] of [['atlas-first-review.yml', firstReview], ['atlas-rereview.yml', rereview]]) {
  ok(!/--rawfile[^\n]*docs\/skills/.test(src)
    && !/--rawfile[^\n]*docs\/lessons/.test(src)
    && !/--rawfile[^\n]*AGENT_CONTEXT/.test(src),
    `${name} does not always-load skills, lessons, or the explainer`);
}

console.log('\n=== declared coverage boundary ===');
ok(/This is not a financial-authority guard/.test(read('test-agent-context.js')),
  'this guard states it is not a financial-authority test');

console.log('\n' + '═'.repeat(60));
if (failures) {
  console.log(`FAILED — ${failures} agent-context check(s)`);
  process.exit(1);
}
console.log('AGENT CONTEXT ARCHITECTURE v1 IS MECHANICALLY WIRED');
