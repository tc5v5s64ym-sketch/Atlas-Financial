'use strict';
/* Sole raw-data / identifier / secret guard.
 *
 * Local commits invoke this from `.githooks/pre-commit`. CI invokes the
 * trusted default-branch copy against an incoming write. Do not copy
 * CONTENT_PATTERNS into another file — a second list is a second policy.
 *
 * CLI:
 *   --staged                         scan the git index (local hook)
 *   --root <dir> --changed-from SHA  scan ACMR files on SHA...HEAD
 *   --patterns-file <path>           test-only synthetic patterns; CI must not
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Incumbent content policy, moved here from `.githooks/pre-commit` so the
// hook and CI share one list. Household identifiers stay in this file only.
const CONTENT_PATTERNS = "NAUDI|CUTLER PL|V2X8R1|dnaudi@|privaterelay\\.appleid|6355425|6012135|6353074|1650429|3225135|9107573|9107595|452005|5446 ?12|14J2W4V|214JL|SITE_PASSWORD *= *[\"']|SESSION_SECRET *= *[\"']|LUNCHMONEY_ACCESS_TOKEN *= *[\"']|ATLAS_PROVIDER_ACCOUNT_MAP_JSON *= *[\"']|ATLAS_ASSISTANT_TOKEN *= *[\"']";

const PATH_BLOCK_RE = /^(raw|derived)\/|\.pdf$|^statements/i;
const SKIP_CONTENT_RE = /^scripts\/privacy-guard\.js$/;
const EXCERPT_LEN = 110;

function parseArgs(argv) {
  const out = {
    staged: false,
    root: process.cwd(),
    changedFrom: '',
    patternsFile: '',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--staged') out.staged = true;
    else if (arg === '--root') out.root = argv[++i];
    else if (arg === '--changed-from') out.changedFrom = argv[++i];
    else if (arg === '--patterns-file') out.patternsFile = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!out.root) throw new Error('missing --root');
  if (out.staged && out.changedFrom) throw new Error('use --staged or --changed-from, not both');
  if (!out.staged && !out.changedFrom) throw new Error('missing --staged or --changed-from');
  return out;
}

function loadPatterns(patternsFile) {
  if (!patternsFile) return CONTENT_PATTERNS;
  const body = fs.readFileSync(patternsFile, 'utf8');
  const line = body.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!line) throw new Error(`patterns file is empty: ${patternsFile}`);
  return line;
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// Git quotes unusual pathnames unless -z is used. A quoted name handed to
// readTree / git show misses the real file and would skip its content.
function splitNulPathnames(out) {
  return String(out).split('\0').filter((s) => s.length > 0);
}

function listStaged(root) {
  const out = git(root, ['diff', '-z', '--cached', '--name-only', '--diff-filter=ACMR']);
  return splitNulPathnames(out);
}

function listChanged(root, fromSha) {
  if (!/^[0-9a-f]{40}$/i.test(String(fromSha || ''))) {
    throw new Error('changed-from must be a 40-character SHA');
  }
  const out = git(root, ['diff', '-z', '--name-only', '--diff-filter=ACMR', `${fromSha}...HEAD`]);
  return splitNulPathnames(out);
}

function readStaged(root, file) {
  try {
    return git(root, ['show', `:${file}`]);
  } catch {
    return null;
  }
}

function readTree(root, file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full, 'utf8');
}

function contentHits(body, patterns) {
  const re = new RegExp(patterns, 'i');
  const hits = [];
  const lines = String(body).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      hits.push({ line: i + 1, excerpt: lines[i].slice(0, EXCERPT_LEN) });
      if (hits.length >= 5) break;
    }
  }
  return hits;
}

function scanFiles({ files, patterns, readFile }) {
  const findings = [];
  for (const file of files) {
    if (PATH_BLOCK_RE.test(file)) {
      findings.push({ file, kind: 'path' });
      continue;
    }
    if (SKIP_CONTENT_RE.test(file)) continue;
    const body = readFile(file);
    if (body == null) continue;
    for (const hit of contentHits(body, patterns)) {
      findings.push({ file, kind: 'content', line: hit.line, excerpt: hit.excerpt });
    }
  }
  return findings;
}

function report(findings, stream = process.stderr) {
  const paths = findings.filter((f) => f.kind === 'path');
  const content = findings.filter((f) => f.kind === 'content');
  if (paths.length) {
    stream.write('\nBLOCKED: raw financial data must never be committed.\n');
    for (const f of paths) stream.write(`  ${f.file}\n`);
  }
  const byFile = new Map();
  for (const f of content) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, hits] of byFile) {
    stream.write(`\nBLOCKED: ${file} contains a personal identifier or secret.\n`);
    for (const hit of hits) stream.write(`  ${hit.line}:${hit.excerpt}\n`);
  }
  if (findings.length) {
    stream.write('\nNothing was committed. Remove the offending content, or move the file\n');
    stream.write('into raw/ or derived/ where it stays local.\n\n');
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const root = path.resolve(args.root);
  const patterns = loadPatterns(args.patternsFile);
  const files = args.staged ? listStaged(root) : listChanged(root, args.changedFrom);
  const readFile = args.staged
    ? (file) => readStaged(root, file)
    : (file) => readTree(root, file);
  const findings = scanFiles({ files, patterns, readFile });
  report(findings);
  return findings.length === 0 ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`privacy-guard failed closed: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  }
}

module.exports = {
  CONTENT_PATTERNS,
  PATH_BLOCK_RE,
  SKIP_CONTENT_RE,
  parseArgs,
  loadPatterns,
  scanFiles,
  listStaged,
  listChanged,
  main,
};
