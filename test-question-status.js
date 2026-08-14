'use strict';
/* B87 — one authority for question OPEN / ANSWERED status.
 * `node test-question-status.js`
 *
 * docs/01_OPEN_QUESTIONS.md owns status. Household-facing Deep Dive /
 * data.json.questions may explain evidence; they may not independently close
 * a question, including by overloading tier 0 as "answered".
 *
 * Q2 and Q5 are the live proving cases. The suite must fail if a publication
 * copy independently marks either ANSWERED while the canonical file still
 * has it OPEN — and the reverse on a proving fixture.
 */
const fs = require('fs');
const path = require('path');
const data = require('./data.json');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const read = rel => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const clone = x => JSON.parse(JSON.stringify(x));

const CANONICAL_STATUSES = ['OPEN', 'ASKED', 'ANSWERED', 'BLOCKED'];

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCanonicalQuestions(markdown) {
  const questions = [];
  const seen = new Set();
  const headingRe = /^###\s+(Q\d+[a-zA-Z]?)\.\s+(.+?)\s*$/gm;
  let match;
  while ((match = headingRe.exec(markdown))) {
    const id = match[1].toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const title = match[2].replace(/\s*[—–-]\s*ANSWERED\b.*$/i, '').trim();
    const rest = markdown.slice(match.index + match[0].length);
    const nextHeading = rest.search(/\n###\s+/);
    const body = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
    const statusLine = /\*\*Status:\*\*\s*([^\n]+)/.exec(body);
    let status = null;
    if (statusLine) {
      const raw = statusLine[1].trim();
      // PARTIALLY ANSWERED is not ANSWERED. Take the first canonical token.
      if (!/^PARTIALLY\b/i.test(raw)) {
        const tok = new RegExp(`^(${CANONICAL_STATUSES.join('|')})\\b`, 'i').exec(raw);
        status = tok ? tok[1].toUpperCase() : null;
      }
    } else if (/\bANSWERED\b/i.test(match[2])) {
      status = 'ANSWERED';
    }
    questions.push({ id, title, status });
  }
  return questions;
}

function encodesAnswered(question) {
  if (!question || typeof question !== 'object') return false;
  if (question.tier === 0 || question.tier === '0') return true;
  const title = String(question.q || question.title || '').trim();
  if (/^(ANSWERED|CLOSED|RESOLVED)\b/i.test(title)) return true;
  const owner = String(question.owner || '').trim();
  if (/^(Closed|Answered|Resolved)\b/i.test(owner)) return true;
  if (question.status && /^(ANSWERED|CLOSED|RESOLVED)\b/i.test(String(question.status).trim())) {
    return true;
  }
  return false;
}

function haystack(question) {
  return normalize([
    question.id, question.q, question.title, question.detail, question.changes, question.owner,
  ].filter(Boolean).join(' '));
}

function matchesCanonical(published, canonical) {
  const publishedId = String(published.id || '').toUpperCase();
  if (publishedId && publishedId === canonical.id) return true;
  const hay = haystack(published);
  if (hay.split(' ').includes(canonical.id.toLowerCase())) return true;
  const quotes = [...String(canonical.title).matchAll(/"([^"]+)"/g)]
    .map(m => normalize(m[1]))
    .filter(Boolean);
  if (quotes.some(phrase => hay.includes(phrase))) return true;
  const canonicalTitle = normalize(canonical.title);
  const publishedTitle = normalize(String(published.q || published.title || '')
    .replace(/^(answered|closed|resolved)\b[\s—–:-]*/i, ''));
  if (publishedTitle && (canonicalTitle === publishedTitle
    || canonicalTitle.includes(publishedTitle)
    || publishedTitle.includes(canonicalTitle))) {
    return true;
  }
  const stop = new Set(['where', 'does', 'the', 'did', 'why', 'what', 'after', 'from', 'with', 'that', 'this', 'into', 'were', 'was']);
  const words = canonicalTitle.split(' ').filter(w => w.length >= 4 && !stop.has(w));
  for (let i = 0; i < words.length - 1; i++) {
    if (hay.includes(`${words[i]} ${words[i + 1]}`)) return true;
  }
  return false;
}

function questionsRenderer(source) {
  const start = source.indexOf("$('questions')");
  if (start < 0) return '';
  const fromMap = source.indexOf('.map(', start);
  if (fromMap < 0) return source.slice(start, start + 400);
  const end = source.indexOf('.join(', fromMap);
  return source.slice(start, end > fromMap ? end : start + 400);
}

function rendererIndependentlyMarksAnswered(source) {
  const block = questionsRenderer(source);
  if (!block) return true;
  if (/\bdone\b/.test(block)) return true;
  if (/tier\s*===?\s*0/.test(block)) return true;
  if (/\.status\b/.test(block) && /ANSWERED/i.test(block)) return true;
  return false;
}

function findQuestionStatusDefects({ markdown, publishedQuestions, rendererSource }) {
  const defects = [];
  const canonical = parseCanonicalQuestions(markdown);
  const byId = new Map(canonical.map(q => [q.id, q]));

  if (rendererIndependentlyMarksAnswered(rendererSource)) {
    defects.push({
      code: 'renderer-status-bit',
      message: 'Deep Dive questions renderer independently marks a question answered',
    });
  }

  for (const published of publishedQuestions || []) {
    const matched = canonical.filter(q => matchesCanonical(published, q));
    const answeredClaim = encodesAnswered(published);

    if (answeredClaim) {
      const closedMatch = matched.find(q => q.status === 'ANSWERED');
      if (!closedMatch) {
        const ids = matched.map(q => q.id).join(', ') || 'none';
        defects.push({
          code: 'independent-answered',
          message: `household-facing record independently claims ANSWERED (matched canonical: ${ids})`,
          published,
        });
      }
    }

    for (const hit of matched) {
      if (hit.status !== 'ANSWERED' && answeredClaim) {
        defects.push({
          code: 'open-marked-answered',
          message: `canonical ${hit.id} is ${hit.status || 'unparsed'}, but publication marks it ANSWERED`,
          id: hit.id,
        });
      }
      if (hit.status === 'ANSWERED' && !answeredClaim) {
        defects.push({
          code: 'answered-marked-open',
          message: `canonical ${hit.id} is ANSWERED, but publication still presents it as an open question`,
          id: hit.id,
        });
      }
    }
  }

  return { canonical, byId, defects };
}

function assertQuestionStatusAuthority(input) {
  const result = findQuestionStatusDefects(input);
  if (result.defects.length) {
    const err = new Error(result.defects.map(d => d.message).join('\n'));
    err.defects = result.defects;
    throw err;
  }
  return result;
}

const markdown = read('docs/01_OPEN_QUESTIONS.md');
const rendererSource = read('public/deepdive.js');
const published = data.questions;
const live = findQuestionStatusDefects({
  markdown, publishedQuestions: published, rendererSource,
});

console.log('=== canonical authority parses ===');
{
  const q2 = live.byId.get('Q2');
  const q5 = live.byId.get('Q5');
  const q9 = live.byId.get('Q9');
  ok(live.canonical.length >= 10, 'canonical file yields household questions',
    String(live.canonical.length));
  ok(q2 && q2.status === 'OPEN', 'canonical Q2 is OPEN',
    q2 ? `${q2.status} — ${q2.title}` : 'missing');
  ok(q5 && q5.status === 'OPEN', 'canonical Q5 is OPEN',
    q5 ? `${q5.status} — ${q5.title}` : 'missing');
  ok(q9 && q9.status === 'ANSWERED', 'canonical Q9 is ANSWERED (reverse-direction fixture exists in live file)',
    q9 ? q9.status : 'missing');
  ok(live.canonical.every(q => !q.status || CANONICAL_STATUSES.includes(q.status)
    || q.status === null),
    'parsed statuses stay inside OPEN / ASKED / ANSWERED / BLOCKED');
}

console.log('\n=== live publication cannot contradict canonical status ===');
{
  ok(live.defects.length === 0,
    'live Deep Dive / data.json.questions does not contradict 01_OPEN_QUESTIONS.md',
    live.defects.map(d => d.message).join('; ') || 'clean');
  ok(!published.some(q => q.tier === 0 || q.tier === '0'),
    'no published question uses tier 0 as an answered bit');
  ok(!published.some(q => Object.prototype.hasOwnProperty.call(q, 'status')),
    'published questions do not carry a second status field');
  ok(!rendererIndependentlyMarksAnswered(rendererSource),
    'Deep Dive questions renderer has no independent answered/done bit');
  const q2pub = published.filter(q => matchesCanonical(q, live.byId.get('Q2')));
  const q5pub = published.filter(q => matchesCanonical(q, live.byId.get('Q5')));
  ok(q2pub.length >= 1 && q2pub.every(q => !encodesAnswered(q)),
    'household-facing Q2 is not marked ANSWERED',
    q2pub.map(q => q.q).join(' | ') || 'absent');
  ok(q5pub.length >= 1 && q5pub.every(q => !encodesAnswered(q)),
    'household-facing Q5 is not marked ANSWERED',
    q5pub.map(q => q.q).join(' | ') || 'absent');
  const q9pub = published.filter(q => matchesCanonical(q, live.byId.get('Q9')));
  ok(q9pub.length === 0 || q9pub.every(q => encodesAnswered(q)),
    'canonical-ANSWERED Q9 is not independently presented as OPEN');
}

console.log('\n=== mutation recreates the old defect ===');
{
  const oldQ2 = {
    tier: 0,
    q: 'ANSWERED — the "credit card" transfers went to the cards',
    detail: 'Across the twelve-month statement window the cards received payments against TFR-TO C/C leaving the accounts.',
    changes: 'Nothing is hiding.',
    owner: 'Closed 9 Aug 2026',
  };
  const oldQ5 = {
    tier: 0,
    q: 'ANSWERED — the monthly transfer was rent, and it stopped',
    detail: 'It was not a spousal transfer. It stopped after May 2026.',
    changes: 'Recorded for 18 months as her contribution.',
    owner: 'Answered 9 Aug 2026',
  };
  const q2Mutant = clone(published).concat(oldQ2);
  const q5Mutant = clone(published).concat(oldQ5);
  let q2Err = null;
  let q5Err = null;
  try {
    assertQuestionStatusAuthority({ markdown, publishedQuestions: q2Mutant, rendererSource });
  } catch (err) { q2Err = err; }
  try {
    assertQuestionStatusAuthority({ markdown, publishedQuestions: q5Mutant, rendererSource });
  } catch (err) { q5Err = err; }
  ok(!!q2Err && /Q2|independently claims ANSWERED/i.test(q2Err.message),
    'mutating publication to mark canonical-OPEN Q2 ANSWERED fails',
    q2Err ? q2Err.message.split('\n')[0] : 'suite stayed green');
  ok(!!q5Err && /Q5/i.test(q5Err.message),
    'mutating publication to mark canonical-OPEN Q5 ANSWERED fails',
    q5Err ? q5Err.message.split('\n')[0] : 'suite stayed green');

  const idMutant = clone(published);
  const q2card = idMutant.find(q => q.id === 'Q2');
  ok(!!q2card, 'live publication still carries a Q2 pointer for the identity mutation');
  if (q2card) {
    q2card.tier = 0;
    q2card.q = 'ANSWERED — ' + q2card.q;
  }
  let idErr = null;
  try {
    assertQuestionStatusAuthority({ markdown, publishedQuestions: idMutant, rendererSource });
  } catch (err) { idErr = err; }
  ok(!!idErr && /Q2/i.test(idErr.message),
    'setting tier 0 / ANSWERED on the live Q2 card fails while Q2 is OPEN',
    idErr ? idErr.message.split('\n')[0] : 'suite stayed green');
}

console.log('\n=== reverse: canonical ANSWERED cannot stay independently OPEN ===');
{
  const fixtureMd = [
    markdown,
    '',
    '### Q99. Proving fixture for answered publication',
    '**Status:** ANSWERED · **Owner:** test',
    '**What we know:** Fixture only.',
  ].join('\n');
  const openPresentation = clone(published).concat({
    id: 'Q99',
    tier: 1,
    q: 'Proving fixture for answered publication',
    detail: 'This card has no answered encoding.',
    changes: 'Should fail.',
    owner: 'test',
  });
  let reverseErr = null;
  try {
    assertQuestionStatusAuthority({
      markdown: fixtureMd,
      publishedQuestions: openPresentation,
      rendererSource,
    });
  } catch (err) { reverseErr = err; }
  ok(!!reverseErr && /Q99/i.test(reverseErr.message) && /ANSWERED/i.test(reverseErr.message),
    'canonical-ANSWERED fixture presented as an open Deep Dive card fails',
    reverseErr ? reverseErr.message.split('\n')[0] : 'suite stayed green');

  const closedPresentation = clone(published).concat({
    id: 'Q99',
    tier: 1,
    q: 'ANSWERED — Proving fixture for answered publication',
    detail: 'Derived from the canonical file for this fixture.',
    changes: 'None.',
    owner: 'Answered in canonical file',
  });
  let closedErr = null;
  try {
    assertQuestionStatusAuthority({
      markdown: fixtureMd,
      publishedQuestions: closedPresentation,
      rendererSource,
    });
  } catch (err) { closedErr = err; }
  ok(!closedErr,
    'the same fixture may be shown as ANSWERED when the canonical file is ANSWERED',
    closedErr ? closedErr.message : 'aligned');
}

console.log('\n=== renderer mutation ===');
{
  const oldRenderer = rendererSource.replace(
    "q.tier === 2 ? 't2' : q.tier === 3 ? 't3' : ''",
    "q.tier === 0 ? 'done' : q.tier === 2 ? 't2' : q.tier === 3 ? 't3' : ''"
  );
  ok(oldRenderer !== rendererSource, 'the renderer mutant actually changes the questions template');
  let renderErr = null;
  try {
    assertQuestionStatusAuthority({
      markdown, publishedQuestions: published, rendererSource: oldRenderer,
    });
  } catch (err) { renderErr = err; }
  ok(!!renderErr && /renderer/i.test(renderErr.message),
    'restoring tier === 0 as an answered/done bit fails',
    renderErr ? renderErr.message.split('\n')[0] : 'suite stayed green');
}

console.log('\n=== live authority holds after mutations of copies ===');
{
  let liveErr = null;
  try {
    assertQuestionStatusAuthority({ markdown, publishedQuestions: published, rendererSource });
  } catch (err) { liveErr = err; }
  ok(!liveErr, 'unmutated live inputs still pass', liveErr ? liveErr.message : '');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
