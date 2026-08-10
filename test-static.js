'use strict';
/* Static sanity. `node test-static.js`
 *
 * Cheap checks that must pass before any numeric result is worth reading: the
 * JSON parses, every script compiles, every element the page writes to exists
 * in its HTML, and no secret or personal identifier has reached a tracked file.
 *
 * The element check earns its place: adding a figure to data.json does not put
 * it on the page, and six keys once sat unrendered — including the whole income
 * section — because a script wrote to an id no HTML had. */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

console.log('=== data files parse ===');
let data = null, periods = null;
try { data = JSON.parse(read('data.json')); ok(true, 'data.json parses'); }
catch (e) { ok(false, 'data.json parses', e.message); }
try { periods = JSON.parse(read('public/periods.json')); ok(true, 'periods.json parses'); }
catch (e) { ok(false, 'periods.json parses', e.message); }

console.log('\n=== every script compiles ===');
const scripts = fs.readdirSync(path.join(__dirname, 'public')).filter(f => f.endsWith('.js'));
for (const f of scripts) {
  try { new vm.Script(read('public/' + f), { filename: f }); ok(true, `public/${f}`); }
  catch (e) { ok(false, `public/${f}`, e.message); }
}
for (const f of ['server.js', 'test-forecast.js', 'test-budget.js', 'test-debt.js', 'test-invariants.js', 'test-mergecard.js']) {
  try { new vm.Script(read(f), { filename: f }); ok(true, f); }
  catch (e) { ok(false, f, e.message); }
}

console.log('\n=== the page has somewhere to put every figure ===');
// Each page script writes to ids via $('...'). Every one must exist in its HTML.
const pages = [
  ['index.html', ['plan.js']],
  ['deepdive.html', ['deepdive.js']],
  ['records.html', ['records.js']],
  ['modellers.html', ['modellers.js']],
];
for (const [html, jsFiles] of pages) {
  const markup = read('public/' + html);
  const ids = new Set([...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  const missing = [];
  for (const js of jsFiles) {
    for (const m of read('public/' + js).matchAll(/\$\('([^']+)'\)/g)) {
      if (!ids.has(m[1]) && !missing.includes(m[1])) missing.push(m[1]);
    }
  }
  ok(missing.length === 0, `${html} has every element ${jsFiles.join(', ')} writes to`,
    missing.length ? 'missing: ' + missing.join(', ') : `${ids.size} ids`);
}

console.log('\n=== no secret or identifier has reached a tracked file ===');
// The pre-commit hook is the real gate; this repeats the content scan so a
// mistake fails in CI too, where no hook runs.
const tracked = [];
const walk = dir => {
  for (const e of fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true })) {
    const rel = dir ? dir + '/' + e.name : e.name;
    if (/^(\.git|node_modules|raw|derived)$/.test(e.name)) continue;
    if (e.isDirectory()) walk(rel);
    else if (/\.(js|json|md|csv|html|yaml|yml)$/.test(e.name)) tracked.push(rel);
  }
};
walk('');
const PATTERNS = [
  [/\bSITE_PASSWORD\s*[:=]\s*['"][^'"]+['"]/, 'a literal SITE_PASSWORD'],
  [/\bSESSION_SECRET\s*[:=]\s*['"][^'"]+['"]/, 'a literal SESSION_SECRET'],
  [/\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/, 'a 16-digit card number'],
  [/\b\d{3}[ -]\d{3}[ -]\d{3}\b/, 'a SIN-shaped number'],
];
let hits = 0;
for (const f of tracked) {
  const body = read(f);
  for (const [re, what] of PATTERNS) {
    // package-lock hashes and the test file itself are not account data.
    if (f === 'package-lock.json' || f === 'test-static.js') continue;
    const m = body.match(re);
    if (m) { hits++; console.log(`        ${f}: ${what} — ${m[0].slice(0, 24)}`); }
  }
}
ok(hits === 0, 'no credentials, card numbers or SIN-shaped identifiers in tracked files',
  `${tracked.length} files scanned`);
ok(!fs.existsSync(path.join(__dirname, 'raw')), 'no raw/ directory is present in the checkout');
ok(read('.gitignore').includes('raw/'), 'raw/ is gitignored');
const hookPath = path.join(__dirname, '.githooks/pre-commit');
ok(fs.existsSync(hookPath), 'the pre-commit hook is present');
// A hook without the executable bit is silently ignored by git — it prints a
// hint and commits anyway. That is a guard that looks present and is not.
ok(fs.existsSync(hookPath) && (fs.statSync(hookPath).mode & 0o111) !== 0,
  'and is executable, so git will actually run it',
  fs.existsSync(hookPath) ? '0' + (fs.statSync(hookPath).mode & 0o777).toString(8) : 'missing');

console.log('\n=== the review gates agree with each other ===');
// The gates are three files that have to name the same things. If the template
// renames a field, the merge-card check fails every PR until someone notices;
// if the manifest and the gate disagree about the primary labels, the gate is
// unsatisfiable. Both are silent failures, so they are checked here.
const template = read('.github/PULL_REQUEST_TEMPLATE.md');
const mergeCard = read('.github/workflows/merge-card-check.yml');
const gate = read('.github/workflows/risk-label-gate.yml');
const manifest = read('.github/labels.yml');
const labelerCfg = read('.github/labeler.yml');

// Every field the check requires must exist in the template it points people at.
const required = [...mergeCard.matchAll(/^\s*\['([^']+)',\s*'/gm)].map(m => m[1]);
ok(required.length >= 8, 'the merge-card check declares its required fields', `${required.length} fields`);
const missingFromTemplate = required.filter(f => !template.includes(`**${f}**`));
ok(missingFromTemplate.length === 0,
  'every field the check requires exists in the PR template',
  missingFromTemplate.join(', ') || 'all present');

// And every prose heading it requires.
const headings = [...mergeCard.matchAll(/^\s*for \(const heading of \[([^\]]+)\]/gms)]
  .flatMap(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
const missingHeadings = headings.filter(h => !new RegExp(`^#{2,4}\\s*${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(template));
ok(missingHeadings.length === 0,
  'every prose section the check requires exists in the template',
  missingHeadings.join(', ') || `${headings.length} sections`);

// The gate's primary list and the manifest must describe the same four labels.
const gatePrimary = (/const PRIMARY = \[([^\]]+)\]/.exec(gate) || [, ''])[1]
  .match(/'([^']+)'/g) || [];
const gateNames = gatePrimary.map(s => s.replace(/'/g, ''));
ok(gateNames.length === 4, 'the risk gate names four primary labels', gateNames.join(', '));
const notInManifest = gateNames.filter(n => !new RegExp(`^- name: ${n}$`, 'm').test(manifest));
ok(notInManifest.length === 0,
  'and every one of them exists in the label manifest', notInManifest.join(', ') || 'all present');

// Every category the labeller can apply must exist too, or PRs get labelled
// with names the repo does not have.
const labelerNames = [...labelerCfg.matchAll(/^([a-z][a-z-]*):$/gm)].map(m => m[1]);
const unknown = labelerNames.filter(n => !new RegExp(`^- name: ${n}$`, 'm').test(manifest));
ok(unknown.length === 0, 'every auto-applied category label is in the manifest',
  unknown.join(', ') || `${labelerNames.length} categories`);
ok(labelerNames.every(n => !gateNames.includes(n)),
  'and no primary label is applied automatically by path',
  'the primary label is a judgement, not a path');

// The snapshot the figures review diffs must actually run.
ok(fs.existsSync(path.join(__dirname, 'scripts/figures-snapshot.js')),
  'the published-figures snapshot script exists');
ok(/figures-snapshot\.js/.test(read('.github/workflows/figures-review.yml')),
  'and the figures review runs it');

// The freshness gate has to be able to see a CLEAN review. Codex reports
// findings as a pull-request review carrying a SHA field, but reports "nothing
// found" as a plain issue comment whose only SHA is prose. Reading the first
// and not the second made the gate report `stale` against a head Codex had
// just passed — the exact lie it exists to prevent, inverted. These assert the
// parse against the real published wording rather than the shape of the code.
const fresh = read('.github/workflows/codex-review.yml');
ok(/issues\.listComments/.test(fresh),
  'the freshness gate reads plain issue comments, where a clean verdict lands');
ok(/issue_comment:/.test(fresh) && /types: \[created\]/.test(fresh),
  'and wakes when one arrives, not only on a push');
// That wake-up runs the DEFAULT BRANCH copy of the workflow, so it is inert on
// the PR that introduces it — the same rule that keeps the risk gate dormant.
// The limitation has to stay written down, because the symptom is a banner
// reading `stale` about a review that is current.
ok(/DEFAULT BRANCH/.test(fresh) && /risk-label-gate/.test(fresh),
  'and says plainly that the wake-up is inert until it reaches the default branch',
  'otherwise the final banner on this PR reads as a contradiction');
// The tell for that state has to be usable. Inert means the banner is not
// regenerated, so it NEVER names the head as the commit it reviewed — the
// first version of the note told the reader to look for exactly that, which
// cannot happen. The comparison has to reach outside the banner.
ok(/newest Codex `Reviewed commit:`\s*\n#\s*SHA .*compare it to the SHA the banner calls the head/s.test(fresh)
  || /compare it to the SHA the banner calls the head/.test(fresh),
  'and the false-stale tell compares the newest reviewed SHA against the banner\'s head',
  'not two SHAs inside a banner that never regenerated');
ok(!/if it names the head, the review\s*\n?#?\s*it is calling stale/.test(fresh),
  'the unusable "banner names the head" tell is gone',
  'that state cannot occur while the trigger is inert');
const reviewedRe = (/const REVIEWED = (\/.*\/i);/.exec(fresh) || [])[1];
ok(!!reviewedRe, 'it declares a pattern for the reviewed-commit line', reviewedRe);
{
  // Verbatim from comment 5241719472 on PR #1 — the first clean verdict.
  const body = "Codex Review: Didn't find any major issues. Chef's kiss.\n\n"
    + '**Reviewed commit:** `1cfc1f50ab`';
  const re = new RegExp(reviewedRe.slice(1, -2), 'i');
  const m = re.exec(body);
  ok(!!m && m[1] === '1cfc1f50ab',
    'and it extracts the SHA from the real clean-verdict wording',
    m ? m[1] : 'NO MATCH — the bold markers sit between the colon and the SHA');
  // Abbreviated in prose, so equality would never match a 40-char head.
  ok(/const same = \(a, b\) =>[\s\S]*startsWith/.test(fresh),
    'the head is compared by prefix, since the prose SHA is abbreviated');
  ok(!re.test('@codex review\n\nAll three are fixed in `1cfc1f5`.'),
    'a request for a review is not mistaken for a review');
}

console.log('\n=== the security gate is intact ===');
const server = read('server.js');
ok(/SITE_PASSWORD/.test(server) && /process\.exit|throw/.test(server),
  'the server refuses to start without SITE_PASSWORD');
ok(/no-store/.test(server), 'financial responses are sent no-store');
ok(/noindex/i.test(server), 'and noindex');
ok(/Content-Security-Policy/i.test(server), 'a CSP is set');
ok(/httpOnly/i.test(server), 'the session cookie is httpOnly');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
