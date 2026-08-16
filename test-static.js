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
const { execFileSync } = require('child_process');

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
for (const f of ['server.js', 'test-forecast.js', 'test-budget.js', 'test-debt.js', 'test-invariants.js', 'scripts/figures-snapshot.js', 'scripts/figures-compare.js', 'scripts/atlas-ci-gate.js']) {
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
// hint and commits anyway. Windows does not expose POSIX execute bits in
// fs.statSync, so use the executable mode recorded in Git's index there.
const hookIndexMode = (execFileSync('git', ['ls-files', '-s', '--', '.githooks/pre-commit'], {
  cwd: __dirname, encoding: 'utf8',
}).match(/^(\d{6})/) || [])[1];
const hookExecutable = process.platform === 'win32'
  ? hookIndexMode === '100755'
  : fs.existsSync(hookPath) && (fs.statSync(hookPath).mode & 0o111) !== 0;
ok(hookExecutable,
  'and is executable, so git will actually run it',
  process.platform === 'win32'
    ? `index mode ${hookIndexMode || 'missing'}`
    : (fs.existsSync(hookPath) ? '0' + (fs.statSync(hookPath).mode & 0o777).toString(8) : 'missing'));

console.log('\n=== published-figure comparison is still in CI ===');
ok(fs.existsSync(path.join(__dirname, 'scripts/figures-snapshot.js')),
  'the published-figures snapshot script exists');
ok(fs.existsSync(path.join(__dirname, 'scripts/figures-compare.js')),
  'the published-figures compare script exists');
ok(/figures-snapshot\.js/.test(read('.github/workflows/atlas-ci.yml')),
  'and Atlas CI runs the snapshot');
ok(/figures-compare\.js/.test(read('.github/workflows/atlas-ci.yml')),
  'and Atlas CI compares base against head in the same job');

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
