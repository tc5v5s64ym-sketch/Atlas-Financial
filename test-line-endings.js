'use strict';
/* B88 — source-inspection tests must not depend on checkout line endings.
 * `node test-line-endings.js`
 *
 * The architecture assertions still bite: a missing function, a missing
 * closing brace, or an LF-only boundary against CRLF still fails. What must
 * not fail is the same logical source represented as LF versus CRLF.
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const MISSION_BOUNDARY = /\n  function mission\(advice, debtProj, opts\) \{[\s\S]*?\n  \}\n/;
const FENCE = /^```evidence-ids[ \t]*\n([\s\S]*?)^```/gm;

function missionIds(src) {
  const m = MISSION_BOUNDARY.exec(src);
  if (!m) return null;
  return [...new Set([...m[0].matchAll(/\bid: '([A-Za-z]+)'/g)].map(x => x[1]))].sort();
}

const FIXTURE = [
  'const before = 1;',
  '  function mission(advice, debtProj, opts) {',
  "    return { parts: [{ id: 'coverGap' }, { id: 'holdSpending' }] };",
  '  }',
  'const after = 2;',
  '',
].join('\n');
const FIXTURE_CRLF = FIXTURE.replace(/\n/g, '\r\n');
const MALFORMED = FIXTURE.replace('\n  }\n', '\n');
const EXPECTED = ['coverGap', 'holdSpending'];

console.log('=== helper ===');
ok(sourceText('a\r\nb\nc\rd') === 'a\nb\nc\nd',
  'CRLF, LF, and lone CR all become LF');
ok(sourceText(FIXTURE) === FIXTURE && sourceText(sourceText(FIXTURE_CRLF)) === FIXTURE,
  'LF is unchanged and CRLF normalizes to the same logical text');

console.log('\n=== representative function boundary, both encodings ===');
const lfIds = missionIds(sourceText(FIXTURE));
const crlfIds = missionIds(sourceText(FIXTURE_CRLF));
ok(Array.isArray(lfIds) && lfIds.join(',') === EXPECTED.join(','),
  'LF source yields the mission block', lfIds ? lfIds.join(',') : 'null');
ok(Array.isArray(crlfIds) && crlfIds.join(',') === EXPECTED.join(','),
  'the same source as CRLF yields the same block', crlfIds ? crlfIds.join(',') : 'null');
ok(JSON.stringify(lfIds) === JSON.stringify(crlfIds),
  'both encodings extract the same ids');

console.log('\n=== old LF-only boundary still fails on CRLF ===');
ok(MISSION_BOUNDARY.exec(FIXTURE) && !MISSION_BOUNDARY.exec(FIXTURE_CRLF),
  'the pre-B88 `\\n}\\n` extractor matches LF and misses CRLF');

console.log('\n=== malformed source still fails ===');
ok(missionIds(sourceText(MALFORMED)) == null,
  'a function with no closing brace is still unreadable after normalization');
ok(missionIds(sourceText('const x = 1;\n')) == null,
  'unrelated source is not a match');

console.log('\n=== trailing-newline split and evidence fence ===');
const DISC = "        .filter(s => s.type === 'discretionary')\n";
const discLf = 'prefix\n' + DISC + 'suffix\n';
const discCrlf = discLf.replace(/\n/g, '\r\n');
ok(sourceText(discLf).split(DISC).length - 1 === 1,
  'LF source still splits on a trailing LF needle');
ok(sourceText(discCrlf).split(DISC).length - 1 === 1,
  'CRLF source splits on the same needle after normalization');
ok(discCrlf.split(DISC).length - 1 === 0,
  'without normalization the trailing-LF needle misses CRLF');

const fenceLf = '```evidence-ids\nEMP-001\nEMP-002\n```\n';
const fenceCrlf = fenceLf.replace(/\n/g, '\r\n');
const idsFrom = (src) => {
  const re = new RegExp(FENCE.source, 'gm');
  const m = re.exec(src);
  return m ? m[1].trim().split('\n').filter(Boolean) : null;
};
ok(JSON.stringify(idsFrom(sourceText(fenceLf))) === JSON.stringify(['EMP-001', 'EMP-002']),
  'LF evidence-ids fence parses');
ok(JSON.stringify(idsFrom(sourceText(fenceCrlf))) === JSON.stringify(['EMP-001', 'EMP-002']),
  'CRLF evidence-ids fence parses to the same ids');
ok(idsFrom(fenceCrlf) == null,
  'the pre-B88 `\\n` fence opener misses CRLF');

console.log('\n=== live forecast.js, both encodings ===');
const live = fs.readFileSync(path.join(__dirname, 'public/forecast.js'), 'utf8');
const liveLf = sourceText(live);
const liveCrlf = liveLf.replace(/\n/g, '\r\n');
const liveIds = missionIds(liveLf);
const liveCrlfIds = missionIds(sourceText(liveCrlf));
ok(Array.isArray(liveIds) && liveIds.length === 8 && liveIds.includes('nearBoundary'),
  'normalized live forecast.js still yields eight mission ids',
  liveIds ? liveIds.join(',') : 'null');
ok(JSON.stringify(liveIds) === JSON.stringify(liveCrlfIds),
  'live LF and live CRLF extract the same mission ids');
ok(!MISSION_BOUNDARY.exec(liveCrlf),
  'un-normalized live CRLF still misses the old LF-only boundary');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
