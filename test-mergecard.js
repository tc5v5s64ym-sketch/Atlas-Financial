'use strict';
/* Merge-card check behaviour. `node test-mergecard.js`
 *
 * The gate that decides whether a pull request may merge lives inline in
 * .github/workflows/merge-card-check.yml. Until this file existed, its only
 * proof was a harness in a scratch directory that disappeared with the session
 * that wrote it — so the check was the one gate in this repository with no
 * committed evidence that it works.
 *
 * It has shipped a false green twice, and both were found by running it rather
 * than by reading it:
 *
 *   1. a pending review whose line quoted the head SHA in its own prose — the
 *      SHA won over the sentence around it;
 *   2. the same hole one field over — pre-fill the SHA, leave
 *      `Reviewer: ChatGPT, pending`, and the card went green while saying in
 *      plain words that the required review was unfinished.
 *
 * Both are cases below. Neither would have been caught by reading the diff.
 *
 * This runs the REAL workflow source: the `script:` body is extracted from the
 * YAML and executed against fixtures with a stubbed `core` and `context`. A
 * copy of the implementation would prove only that the copy still works.
 *
 * The delivery block's cases are a different shape from the rest, because the
 * block is a different shape: seven CLOSED forms, two prose lines whose
 * presence is all that is checked, and three integers with one subtraction
 * between them. So the cases below test vocabularies, anchoring and
 * arithmetic — never whether an explanation is any good. That boundary is the
 * point of the block, and a case pretending to test the other side of it would
 * be the arms race CLAUDE.md forbids, dressed as coverage.
 *
 * The last section mutates that source — reverting each pending-marker
 * protection in turn — and proves the cases above actually catch the
 * reversion. A guard nothing would notice the loss of is not a guard.
 */

const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

const WORKFLOW = path.join(__dirname, '.github/workflows/merge-card-check.yml');
const TEMPLATE = path.join(__dirname, '.github/PULL_REQUEST_TEMPLATE.md');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// The head every fixture is written against. Any 40-hex string would do; this
// one is a real commit on this branch so the fixtures read like a real card.
const HEAD = 'b85274ce33e53c01352bd54950b37f8940451620';
const OTHER = 'ab8c8700000000000000000000000000000000ff';

/* ------------------------------------------------------------------ source */

// Pull the inline `script: |` body out of the workflow and de-indent it.
// Deliberately not a YAML parse: the point is to execute exactly the text
// GitHub executes, and a parser that "helpfully" normalised it would weaken
// that. Blank lines keep their place so reported line numbers stay useful.
function extractScript() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex(l => /^\s*script:\s*\|\s*$/.test(l));
  if (start < 0) throw new Error('merge-card-check.yml carries no inline `script: |` block');
  const indent = lines[start + 1].match(/^ */)[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') { body.push(''); continue; }
    if (lines[i].match(/^ */)[0].length < indent) break;
    body.push(lines[i].slice(indent));
  }
  return body.join('\n');
}

// Run a check source against a PR body. Returns { green, problems }.
async function run(source, body, headSha = HEAD) {
  const problems = [];
  let failed = null;
  const core = {
    setFailed: m => { failed = m; },
    info: () => {},
    summary: {
      addHeading() { return this; },
      addList(items) { problems.push(...items); return this; },
      addRaw() { return this; },
      async write() {},
    },
  };
  const context = {
    payload: { pull_request: { body, head: { sha: headSha } } },
    repo: { owner: 'tc5v5s64ym-sketch', repo: 'Atlas-Financial' },
  };
  await new AsyncFunction('core', 'context', 'github', source)(core, context, {});
  return { green: failed === null, problems };
}

/* ---------------------------------------------------------------- fixtures */

// Every row the check requires, with a real answer. A case overrides only what
// it is about, so a fixture never fails for a reason its name does not mention.
const ROWS = {
  'Title': 'A change to the published figures',
  'Primary risk': 'auto-safe',
  'Files / categories touched': 'public/forecast.js, data.json',
  'Current-state verdict': 'B70 · STILL BROKEN — reproduced on main at ce9c7fa',
  'Builder surface': 'Claude Code',
  'Primary builder model': 'the surface withholds its model identity',
  'Supporting / explore models': 'None',
  'Architecture / dispatch authority': 'ChatGPT',
  'Figures moved': 'none',
  'Reproduced / disproved': 'reproduced on main before the fix',
  'Authority impact': 'none',
  'Tests': '`npm test` — 6 suites, all passing',
  'Security': 'unchanged',
  'Advisory review': 'none raised',
  'Owner decision required': 'No',
  'Estimated inputs added': 'none',
};

const PROSE = {
  'What changed': 'The recovery path no longer replays the first payday.',
  'Why the numbers are right': 'Confirmed by a brute-force ledger with its own day loop.',
  'What this does NOT do': 'It does not couple variable spending to card balances.',
  'Known uncertainty': 'The breach date could move by about a week.',
};

const REVIEW = {
  'Required': 'required — touches the engine',
  'Exact reviewed head': HEAD,
  'Reviewer': 'ChatGPT',
  'Findings and dispositions': 'none',
};

// The delivery block. Seven closed forms, two prose lines, and three integers
// whose arithmetic has to agree: created (0) − closed (1) = −1.
const DELIVERY = {
  'One outcome': 'Pending card charges become authoritative in day-0 headroom',
  'Non-goals': 'It does not touch the weekly cap, the HELOC model, or the plan page',
  'Scope status': 'WITHIN — 3 implementation files, about 180 lines',
  'Atomicity exception': 'NO',
  'Blocking review rounds': '1',
  'Scope reassessment': 'N/A',
  'Proof level': 'MIXED — unit for the arithmetic, integration for the walk',
  'Open loops closed': '1',
  'Open loops created': '0',
  'Net open loops': '-1',
  'Loops left open': 'none',
};

// Build a body. `over` replaces row/review/delivery values; a value of null
// drops the line entirely, which is how "line missing" differs from "line
// blank".
function card({ rows = {}, review = {}, delivery = {}, findings = '- None',
                dropReview = false, dropDelivery = false,
                dropFindings = false, afterDelivery = null,
                afterReview = null } = {}) {
  const r = { ...ROWS, ...rows };
  const v = { ...REVIEW, ...review };
  const dl = { ...DELIVERY, ...delivery };
  const out = ['## 🟦 Atlas Merge Card', '', '| Field | Value |', '|---|---|'];
  for (const [k, val] of Object.entries(r)) if (val !== null) out.push(`| **${k}** | ${val} |`);
  out.push('');
  for (const [h, text] of Object.entries(PROSE)) out.push(`### ${h}`, '', text, '');
  if (!dropDelivery) {
    out.push('### Delivery', '');
    for (const [k, val] of Object.entries(dl)) if (val !== null) out.push(`- **${k}**: ${val}`);
    out.push('');
    // Anything placed BETWEEN the delivery block and the review block — used to
    // put a dropped line back under a later heading and prove the section span
    // really ends there.
    if (afterDelivery) out.push(afterDelivery, '');
  }
  if (!dropReview) {
    out.push('### Atlas Contract / Systems Review', '');
    for (const [k, val] of Object.entries(v)) if (val !== null) out.push(`- **${k}**: ${val}`);
    out.push('');
    if (afterReview) out.push(afterReview, '');
  }
  if (!dropFindings) out.push('### Additional findings', '', findings, '');
  return out.join('\n');
}

// The same card in the BULLET shape, which the check explicitly supports and
// which nothing exercised until a blank row passed there (Codex, P2, on
// 805101d): the capture kept the bullet's colon and read it as an answer. A
// shape the check claims to support and no case covers is a gap by definition.
function bulletCard({ rows = {} } = {}) {
  const r = { ...ROWS, ...rows };
  const out = ['## 🟦 Atlas Merge Card', ''];
  for (const [k, val] of Object.entries(r)) out.push(`- **${k}**:${val === '' ? '' : ' ' + val}`);
  out.push('');
  for (const [h, text] of Object.entries(PROSE)) out.push(`### ${h}`, '', text, '');
  out.push('### Delivery', '');
  for (const [k, val] of Object.entries(DELIVERY)) out.push(`- **${k}**: ${val}`);
  out.push('', '### Atlas Contract / Systems Review', '');
  for (const [k, val] of Object.entries(REVIEW)) out.push(`- **${k}**: ${val}`);
  out.push('', '### Additional findings', '', '- None', '');
  return out.join('\n');
}

/* ------------------------------------------------------------------- cases */

// Named exactly as the contract states them, because these names are what a
// future reader compares against CLAUDE.md.
const CASES = [
  // --- the card exists and is filled
  ['the untouched template', fs.readFileSync(TEMPLATE, 'utf8'), 'red'],
  ['a fully completed card', card(), 'green'],
  ['a prose section left as its template comment',
    card().replace('The recovery path no longer replays the first payday.', '<!-- todo -->'), 'red'],
  // The bullet shape, which the check supports and nothing covered until a
  // blank row passed there because the capture kept the bullet's colon.
  ['a completed card in the bullet shape', bulletCard(), 'green'],
  // Prose is not a row. The label used to be matched anywhere in the body, so a
  // sentence above the card satisfied a field whose row was blank.
  ['prose naming a label above a card whose row is blank',
    'The **Builder surface** is discussed here.\n\n'
      + card({ rows: { 'Builder surface': '' } }), 'red'],
  ['prose naming the verdict above a card whose row is blank',
    'Note the **Current-state verdict** was ALREADY FIXED in an earlier PR.\n\n'
      + card({ rows: { 'Current-state verdict': '' } }), 'red'],
  ['harmless bold prose above a complete card',
    'Some ordinary **bold** prose before the card.\n\n' + card(), 'green'],
  ['a bullet-shaped prose item before the real blank row',
    bulletCard({ rows: { 'Builder surface': '' } })
      .replace('- **Builder surface**:',
        '- **Builder surface** is discussed here.\n- **Builder surface**:'), 'red'],
  ['a blank row in the bullet shape', bulletCard({ rows: { 'Builder surface': '' } }), 'red'],
  ['a blank verdict row in the bullet shape',
    bulletCard({ rows: { 'Current-state verdict': '' } }), 'red'],

  // --- attribution (CLAUDE.md: None is for supporting models alone)
  ['Builder surface: None', card({ rows: { 'Builder surface': 'None' } }), 'red'],
  ['Primary builder model: None', card({ rows: { 'Primary builder model': 'None' } }), 'red'],
  ['Architecture / dispatch authority: None',
    card({ rows: { 'Architecture / dispatch authority': 'None' } }), 'red'],
  ['Supporting / explore models: None', card({ rows: { 'Supporting / explore models': 'None' } }), 'green'],
  ['a withheld model identity is a real answer',
    card({ rows: { 'Primary builder model': 'the surface withholds its model identity' } }), 'green'],
  ['an attribution row deleted', card({ rows: { 'Primary builder model': null } }), 'red'],
  ['an attribution row left blank', card({ rows: { 'Builder surface': '' } }), 'red'],

  ['an attribution row of n/a', card({ rows: { 'Builder surface': 'n/a' } }), 'red'],
  ['a model name that merely starts with "Na"',
    card({ rows: { 'Primary builder model': 'NA-1000' } }), 'green'],
  ['a surface whose name merely starts with "No"',
    card({ rows: { 'Builder surface': 'Nova' } }), 'green'],
  // The absence word has to BE the answer, not open one. This is the contract's
  // permitted fallback for a surface that withholds its model, and the check
  // was failing the honest card it exists to allow.
  ['a withheld-identity sentence that opens with "No"', card({ rows: {
    'Primary builder model': 'No model identity is exposed by this surface',
  } }), 'green'],
  // ...and that exception is the model's alone. A surface and an authority are
  // always knowable to whoever fills the card in; only a model can be withheld.
  ['the same sentence shape in the surface row',
    card({ rows: { 'Builder surface': 'No surface is exposed' } }), 'red'],
  ['the same sentence shape in the authority row',
    card({ rows: { 'Architecture / dispatch authority': 'No authority is known' } }), 'red'],

  // --- current-state verdict: the gate's own record, so it has to name a verdict
  ['the current-state verdict blank', card({ rows: { 'Current-state verdict': '' } }), 'red'],
  ['a current-state verdict of "not checked"',
    card({ rows: { 'Current-state verdict': 'not checked' } }), 'red'],
  ['each documented verdict', card({ rows: {
    'Current-state verdict': 'B1 · FIXED BUT UNTESTED — proved rather than refactored',
  } }), 'green'],
  ['STALE / SUPERSEDED written with a slash', card({ rows: {
    'Current-state verdict': 'B1 · STALE / SUPERSEDED — the figure it names moved in PR #1',
  } }), 'green'],
  ['a verdict row naming two verdicts', card({ rows: {
    'Current-state verdict': 'B1 · STILL BROKEN or ALREADY FIXED',
  } }), 'red'],
  // The gate is source + verdict + evidence; a bare token records the middle
  // third and calls it the answer.
  ['a verdict and nothing else',
    card({ rows: { 'Current-state verdict': 'STILL BROKEN' } }), 'red'],
  // A source alone is not the gate either: `B1 · STILL BROKEN` names what
  // authorised the work and still says nothing about how state was checked.
  ['a verdict and a bare source identifier',
    card({ rows: { 'Current-state verdict': 'B1 · STILL BROKEN' } }), 'red'],
  ['a verdict with its source and how it was checked', card({ rows: {
    'Current-state verdict': 'B1 · STILL BROKEN — reproduced on main at ce9c7fa',
  } }), 'green'],
  ['one verdict repeated is still one', card({ rows: {
    'Current-state verdict': 'B1 · STILL BROKEN — still broken on main at ce9c7fa, STILL BROKEN after the rebase',
  } }), 'green'],

  // --- the required review lane
  ['the review block missing entirely', card({ dropReview: true }), 'red'],
  ['a review-block line missing', card({ review: { 'Reviewer': null } }), 'red'],
  ['a review-block line blank', card({ review: { 'Findings and dispositions': '' } }), 'red'],
  ['required, with no SHA', card({ review: { 'Exact reviewed head': 'n/a' } }), 'red'],
  ['required, with a stale SHA', card({ review: { 'Exact reviewed head': OTHER } }), 'red'],
  ['required, with the current SHA and every field complete', card(), 'green'],
  ['required, with no reviewer named', card({ review: { 'Reviewer': 'n/a' } }), 'red'],
  ['not required, with a reason and n/a fields', card({ review: {
    'Required': 'not required — documentation only, no trigger fired',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'green'],
  ['not required, so even a stale SHA is nobody\'s business', card({ review: {
    'Required': 'not required — no trigger fired', 'Exact reviewed head': OTHER,
  } }), 'green'],

  // --- the required/not-required classifier reads the OPENING of the field
  //     only. Matching "not required" anywhere let a line that began by
  //     declaring the review required disable the whole gate with its own
  //     explanatory prose.
  ['a required line whose prose later says "not required", with no review', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],
  ['the same required wording, with a stale SHA', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': OTHER,
  } }), 'red'],
  ['the same required wording, complete on the current head', card({ review: {
    'Required': 'required — review machinery changed; documentation-only pieces are not required',
    'Exact reviewed head': HEAD, 'Reviewer': 'ChatGPT', 'Findings and dispositions': 'one P1, fixed',
  } }), 'green'],
  ['an opening that is neither, and means required', card({ review: {
    'Required': 'No trigger fired for the engine, but the review machinery changed, so it is required',
    'Exact reviewed head': 'n/a', 'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],
  ['"n/a" still opens the not-required path', card({ review: {
    'Required': 'n/a — no trigger fired', 'Exact reviewed head': 'n/a',
    'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'green'],
  // "not required" switches every downstream check off, so it is the one answer
  // that has to carry its reason.
  ['a bare "not required" with no reason', card({ review: {
    'Required': 'not required', 'Exact reviewed head': 'n/a',
    'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],
  ['a bare "n/a" with no reason', card({ review: {
    'Required': 'n/a', 'Exact reviewed head': 'n/a',
    'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],

  // --- a required review needs a NAME and a disposition, not an absence value.
  //     "Reviewer: None" is non-blank and carries no pending marker, so it
  //     satisfied a required review while naming nobody.
  ['the correct SHA, but Reviewer: None', card({ review: { 'Reviewer': 'None' } }), 'red'],
  ['the correct SHA, but Reviewer: No', card({ review: { 'Reviewer': 'No' } }), 'red'],
  ['the correct SHA, but Reviewer: nobody', card({ review: { 'Reviewer': 'nobody' } }), 'red'],
  ['the correct SHA, but Reviewer: not required',
    card({ review: { 'Reviewer': 'not required' } }), 'red'],
  ['a reviewer named beside the lane rather than being it',
    card({ review: { 'Reviewer': 'Nova, on the ChatGPT desk' } }), 'red'],
  ['an unlisted advisory agent credited in prose', card({ review: {
    'Reviewer': 'ChatGPT was bypassed in favor of Gemini',
  } }), 'red'],
  // No qualifier at all. The field was defeated four times, each time in the
  // free space left in it — a long sentence, a short one, an unlistable set of
  // other agents, and finally the bracket. `ChatGPT (bypassed)` is why.
  ['a denial hidden inside the bracketed qualifier',
    card({ review: { 'Reviewer': 'ChatGPT (bypassed)' } }), 'red'],
  ['a bracketed qualifier at all',
    card({ review: { 'Reviewer': 'ChatGPT (Atlas desk)' } }), 'red'],
  ['the lane name with a full stop', card({ review: { 'Reviewer': 'ChatGPT.' } }), 'green'],

  //     `n/a` answers a review that was NOT required; on the required path it
  //     leaves the result unstated, and "findings pending" names no disposition
  //     at all while slipping past the pending markers.
  ['required, but findings n/a', card({ review: { 'Findings and dispositions': 'n/a' } }), 'red'],
  ['required, but findings "findings pending"',
    card({ review: { 'Findings and dispositions': 'findings pending' } }), 'red'],
  ['required, with findings that name a disposition', card({ review: {
    'Findings and dispositions': 'two raised: one fixed, one routed to B72',
  } }), 'green'],

  //     ...and the reviewer has to be the lane that owns this gate. `Reviewer:
  //     Codex` records the REQUIRED review as performed by the advisory lane.
  ['the required review credited to Codex', card({ review: { 'Reviewer': 'Codex' } }), 'red'],
  ['the required review credited to the builder',
    card({ review: { 'Reviewer': 'Claude Code' } }), 'red'],
  // Naming an advisory reader here is rejected even beside ChatGPT: the card
  // has a row for that, and one field carries one meaning. It also removes the
  // need for a negation list to grow every time someone writes "not" anew.
  ['an advisory reader named beside ChatGPT', card({ review: {
    'Reviewer': 'ChatGPT, with a Codex advisory read alongside it',
  } }), 'red'],
  ['the lane negated inside the field', card({ review: {
    'Reviewer': 'Codex, not ChatGPT',
  } }), 'red'],
  ['the lane negated with no other name', card({ review: {
    'Reviewer': 'not ChatGPT',
  } }), 'red'],
  ['ChatGPT written as Chat-GPT', card({ review: { 'Reviewer': 'Chat-GPT' } }), 'green'],
  // The field takes the lane name and at most a bracketed qualifier. Counting
  // characters was a proxy and it was defeated twice — by a long sentence, then
  // by a short one — so the accepted form is closed rather than budgeted.
  ['a short denial that fits inside a length budget',
    card({ review: { 'Reviewer': 'ChatGPT was bypassed' } }), 'red'],
  ['a trailing noun phrase rather than a bracketed qualifier',
    card({ review: { 'Reviewer': 'the ChatGPT desk' } }), 'red'],

  //     ...and a finding the line itself calls unanswered is not disposed,
  //     however many of its neighbours are.
  ['findings where one is declared unanswered', card({ review: {
    'Findings and dispositions': 'P1 fixed; P2 unanswered',
  } }), 'red'],
  ['findings where one is routed and stays open — a complete answer', card({ review: {
    'Findings and dispositions': 'P1 fixed; P2 routed to B72, which stays open until the owner answers',
  } }), 'green'],
  ['findings declaring that none are unanswered', card({ review: {
    'Findings and dispositions': 'No unanswered findings; P1 fixed',
  } }), 'green'],

  // --- a negation reverses the token it governs. A card that says in plain
  //     English that the gate was not satisfied must not read as an answer
  //     because the words it denies are the words the check looks for.
  ['a disposition that negates its own vocabulary', card({ review: {
    'Findings and dispositions': 'P1 not fixed',
  } }), 'red'],
  ['a head that says it was not reviewed, beside the right SHA', card({ review: {
    'Exact reviewed head': `not reviewed: ${HEAD}`,
  } }), 'red'],
  // The head field is a SHA and nothing else. Hunting a 40-character run inside
  // prose meant every denial wording had to be enumerated, and the list kept
  // missing one — `not reviewed:`, then `unreviewed:`.
  ['a head prefixed with a word outside the denial vocabulary', card({ review: {
    'Exact reviewed head': `unreviewed: ${HEAD}`,
  } }), 'red'],
  ['a head wrapped in backticks', card({ review: {
    'Exact reviewed head': `\`${HEAD}\``,
  } }), 'green'],
  ['a reviewer denial placed after the lane name', card({ review: {
    'Reviewer': 'ChatGPT did not perform this review',
  } }), 'red'],
  ['a verdict the row rejects rather than selects',
    card({ rows: { 'Current-state verdict': 'B1 is not ALREADY FIXED' } }), 'red'],
  ['a not-required reason that is only an absence word', card({ review: {
    'Required': 'not required — none', 'Exact reviewed head': 'n/a',
    'Reviewer': 'n/a', 'Findings and dispositions': 'n/a',
  } }), 'red'],

  //     ...and the honest phrasings that must survive it. The negation here
  //     governs something other than the token, and the window is short enough
  //     to tell the difference.
  ['a verdict whose sentence negates something else', card({ rows: {
    'Current-state verdict': 'B1 · STILL BROKEN — not fixed by PR #1',
  } }), 'green'],
  // A negation governs its clause, not a two-word neighbourhood. Widening that
  // window was not an option: at three words it eats the `fixed` in
  // "No unanswered findings; P1 fixed", an honest card this check already failed
  // once.
  ['a disposition negated at arm\'s length', card({ review: {
    'Findings and dispositions': 'P1 was not in any way fixed',
  } }), 'red'],
  // "not only X but Y" asserts; it does not deny. This is an exception for one
  // fixed idiom, not a scope rule — the general problem is recorded as a known
  // limit in docs/RISK_LABELS.md rather than approximated a fourth time.
  ['the "not only … but" idiom, which asserts rather than denies', card({ review: {
    'Findings and dispositions': 'P1 was not only fixed but independently tested',
  } }), 'green'],
  ['a verdict negated at arm\'s length', card({ rows: {
    'Current-state verdict': 'B1 is not in any way ALREADY FIXED',
  } }), 'red'],
  ['a disposition that says where a finding went, not that it was fixed', card({ review: {
    'Findings and dispositions': 'P1 not fixed here — routed to B72',
  } }), 'green'],

  // --- pending markers: the two false greens this check has actually shipped
  ['a pending review whose line quotes the head SHA', card({ review: {
    'Exact reviewed head': `not yet performed — record \`${HEAD}\` once it has been read`,
  } }), 'red'],
  ['a bare "pending" with no SHA at all',
    card({ review: { 'Exact reviewed head': 'pending' } }), 'red'],
  ['the correct SHA, but Reviewer: ChatGPT, pending',
    card({ review: { 'Reviewer': 'ChatGPT, pending' } }), 'red'],
  ['the correct SHA, but Reviewer: awaiting ChatGPT',
    card({ review: { 'Reviewer': 'awaiting ChatGPT' } }), 'red'],
  ['the correct SHA, but dispositions pending', card({ review: {
    'Findings and dispositions': 'three raised, dispositions pending',
  } }), 'red'],
  ['the correct SHA, but findings "none yet"',
    card({ review: { 'Findings and dispositions': 'none yet' } }), 'red'],

  // --- ...and the honest phrasings the markers must NOT catch. A finding can
  //     be completely dispositioned and still describe something that waits.
  ['a finding routed to the backlog, awaiting an owner answer', card({ review: {
    'Findings and dispositions': "one fixed; one routed to BACKLOG B72, awaiting the owner's answer on B70",
  } }), 'green'],
  ['an outstanding question named inside a disposition', card({ review: {
    'Findings and dispositions': 'two fixed, one non-issue — the outstanding HELOC limit question is unrelated',
  } }), 'green'],

  // --- the delivery block: one PR, one independently provable outcome.
  //     Every line here is a CLOSED form or an integer, so the cases are about
  //     structure only. Whether the outcome is genuinely one outcome is the
  //     required review's read, and nothing below pretends otherwise.
  ['the delivery block missing entirely', card({ dropDelivery: true }), 'red'],
  ['a delivery line missing', card({ delivery: { 'Proof level': null } }), 'red'],

  //     The section span ends at EVERY heading level. It used to stop only at
  //     `##` through `####`, so a required line deleted from the block and
  //     re-added under a later `#`, `#####` or `######` heading still answered
  //     the block above it — a live false green, reproduced on 5cc05ce before
  //     the fix (ChatGPT, P2). `###` already ended the span, which is why every
  //     earlier case missed it.
  ...['#', '#####', '######'].map((h) => [
    `a delivery line moved under a later "${h}" heading`,
    card({ delivery: { 'Proof level': null },
           afterDelivery: `${h} Appendix\n\n- **Proof level**: UNIT` }), 'red']),
  // The helper is shared, so the review block had the same hole. This one has
  // to sit AFTER the review heading to exercise the span at all — placed
  // before it, the case goes red merely because the line is missing, and
  // proves nothing about the boundary it is named for.
  ['a review line moved under a later top-level heading',
    card({ review: { 'Reviewer': null },
           afterReview: '# Notes\n\n- **Reviewer**: ChatGPT' }), 'red'],
  // ...and an ordinary heading after the block is still perfectly fine.
  ['a harmless heading after a complete delivery block',
    card({ afterDelivery: '# Appendix\n\nNothing load-bearing here.' }), 'green'],
  ['a delivery line blank', card({ delivery: { 'One outcome': '' } }), 'red'],
  ['the non-goals line blank', card({ delivery: { 'Non-goals': '' } }), 'red'],

  //     Scope status. The tripwire is a prompt to reassess, not a limit, so
  //     EXCEEDED passes — but only when it says why.
  ['scope status WITHIN', card(), 'green'],
  ['scope status EXCEEDED with its reason', card({ delivery: {
    'Scope status': 'EXCEEDED — 14 files, because the authority move and the removal of the loser cannot land apart',
  } }), 'green'],
  ['a bare EXCEEDED with no reason',
    card({ delivery: { 'Scope status': 'EXCEEDED' } }), 'red'],
  ['an EXCEEDED whose reason is only an absence word',
    card({ delivery: { 'Scope status': 'EXCEEDED — none' } }), 'red'],
  ['a scope status outside the vocabulary',
    card({ delivery: { 'Scope status': 'LARGE' } }), 'red'],
  // The anchoring that closed the review block's Required line, applied here:
  // a sentence mentioning the word is not the field selecting it.
  ['a scope status that names WITHIN in later prose',
    card({ delivery: { 'Scope status': 'the diff is WITHIN every tripwire' } }), 'red'],

  //     Atomicity. YES is the answer that permits a larger pull request, so it
  //     is the one that has to carry what splitting would break.
  ['atomicity exception NO', card(), 'green'],
  ['atomicity exception YES with its reason', card({ delivery: {
    'Atomicity exception': 'YES — splitting would leave two live authorities for day-0 headroom between the two merges',
  } }), 'green'],
  ['a bare YES with no reason',
    card({ delivery: { 'Atomicity exception': 'YES' } }), 'red'],
  // "NOT APPLICABLE" opens with the letters of NO and means something else.
  ['an atomicity answer that merely starts with "NO"',
    card({ delivery: { 'Atomicity exception': 'NOT APPLICABLE' } }), 'red'],

  //     The review-churn circuit breaker. Two blocking rounds mean the
  //     reassessment happened, so N/A stops being an available answer.
  ['no blocking rounds, and no reassessment to record', card(), 'green'],
  ['two rounds with the reassessment still N/A', card({ delivery: {
    'Blocking review rounds': '2', 'Scope reassessment': 'N/A',
  } }), 'red'],
  // A bare N/A is caught by the reason rule as well, so this is the case that
  // makes the N/A rule itself load-bearing: an EXPLAINED N/A satisfies the
  // reason rule and is still the one answer two rounds have taken away.
  ['two rounds with an explained N/A', card({ delivery: {
    'Blocking review rounds': '2',
    'Scope reassessment': 'N/A — the two rounds were wording, so no reassessment was needed',
  } }), 'red'],
  ['two rounds continued, with the reason', card({ delivery: {
    'Blocking review rounds': '2',
    'Scope reassessment': 'CONTINUE — both findings refine the same rounding rule',
  } }), 'green'],
  ['two rounds continued, with no reason', card({ delivery: {
    'Blocking review rounds': '2', 'Scope reassessment': 'CONTINUE',
  } }), 'red'],
  // SPLIT is a pull request declaring it has to be divided, and one that says
  // so may not merge in that state — otherwise the card records an unperformed
  // split as a decision already carried out (ChatGPT, P1, on 5cc05ce). It fails
  // at every round count, because it means the same thing whenever it is
  // written.
  ['two rounds split, naming what moves out', card({ delivery: {
    'Blocking review rounds': '2',
    'Scope reassessment': 'SPLIT — the positions.csv regeneration goes to its own pull request',
  } }), 'red'],
  ['a split declared with no rounds behind it',
    card({ delivery: { 'Scope reassessment': 'SPLIT — two outcomes arrived together' } }), 'red'],
  // ...and the state a split RESOLVES to: the piece that remains is one root
  // cause, and says where the other outcome went.
  ['the pull request that remains after a split', card({ delivery: {
    'Blocking review rounds': '2',
    'Scope reassessment': 'CONTINUE — the positions.csv regeneration left for PR #9, what is here is one authority move',
  } }), 'green'],
  ['three-plus rounds continued, with the justification', card({ delivery: {
    'Blocking review rounds': '3+',
    'Scope reassessment': 'CONTINUE — finishing here is safer than splitting a half-applied authority move',
  } }), 'green'],
  ['three-plus rounds continued, with no justification', card({ delivery: {
    'Blocking review rounds': '3+', 'Scope reassessment': 'CONTINUE',
  } }), 'red'],
  // Below two rounds no reassessment was required, so a bare CONTINUE is not
  // an unanswered question — there was no question.
  ['one round continued, with no reason', card({ delivery: {
    'Blocking review rounds': '1', 'Scope reassessment': 'CONTINUE',
  } }), 'green'],
  ['a round count outside the vocabulary',
    card({ delivery: { 'Blocking review rounds': '4' } }), 'red'],
  ['a round count of ten, which opens with a one',
    card({ delivery: { 'Blocking review rounds': '10' } }), 'red'],
  ['a bare 3, where the vocabulary says 3+',
    card({ delivery: { 'Blocking review rounds': '3' } }), 'red'],
  ['a reassessment outside the vocabulary',
    card({ delivery: { 'Scope reassessment': 'MAYBE' } }), 'red'],

  //     Proof level, one closed vocabulary of six.
  ...['UNIT', 'INTEGRATION', 'BROWSER', 'LIVE', 'OWNER EVIDENCE', 'MIXED'].map(
    (level) => [`proof level ${level}`, card({ delivery: { 'Proof level': level } }), 'green']),
  ['a proof level outside the vocabulary',
    card({ delivery: { 'Proof level': 'SMOKE' } }), 'red'],

  //     Open loops: three integers and one subtraction — the only claim on
  //     this card the check can VERIFY rather than merely witness.
  ['open loops that add up', card(), 'green'],
  // A positive net is allowed and sometimes necessary — and CLAUDE.md says it
  // is EXPLAINED rather than hidden. Three integers can report one; they
  // cannot explain one, and `closed 0 / created 2 / net 2` was green while
  // naming neither loop (ChatGPT, P1, on 5cc05ce). The machine requires an
  // ANSWER; whether it really names the loops is the reviewer's read.
  ['a positive net, with the loops it leaves open named', card({ delivery: {
    'Open loops closed': '0', 'Open loops created': '2', 'Net open loops': '2',
    'Loops left open': 'the figures baseline and the positions regeneration, both closed by B72',
  } }), 'green'],
  ['a positive net, leaving the loops unnamed', card({ delivery: {
    'Open loops closed': '0', 'Open loops created': '2', 'Net open loops': '2',
  } }), 'red'],
  ['a positive net whose loops are named with an absence word', card({ delivery: {
    'Open loops closed': '0', 'Open loops created': '2', 'Net open loops': '2',
    'Loops left open': 'none',
  } }), 'red'],
  // ...and the same field is NOT interrogated when the net is zero or negative,
  // because there is nothing the preference asks to be explained.
  ['a net of zero, with nothing left open', card({ delivery: {
    'Open loops closed': '2', 'Open loops created': '2', 'Net open loops': '0',
    'Loops left open': 'none',
  } }), 'green'],
  ['the loops-left-open line blank',
    card({ delivery: { 'Loops left open': '' } }), 'red'],
  ['a net that does not follow from its own inputs', card({ delivery: {
    'Open loops closed': '2', 'Open loops created': '0', 'Net open loops': '0',
  } }), 'red'],
  ['a loop count that is a word', card({ delivery: {
    'Open loops closed': 'several', 'Open loops created': '0', 'Net open loops': '-1',
  } }), 'red'],
  ['a loop count with prose beside the number', card({ delivery: {
    'Open loops closed': '1 — both recorded in BACKLOG.md',
    'Open loops created': '0', 'Net open loops': '-1',
  } }), 'red'],
  // A negative `closed` ALWAYS forces a positive net — created minus a
  // negative is positive — so this case has to satisfy the positive-net rule
  // to isolate the one it is about. Without that it goes red for the other
  // reason, and the negative-count mutant flips nothing.
  ['a negative count of loops closed', card({ delivery: {
    'Open loops closed': '-1', 'Open loops created': '0', 'Net open loops': '1',
    'Loops left open': 'the B72 housekeeping item, closed when it lands',
  } }), 'red'],
  // `created` needs no such care: a negative one keeps the net negative.
  ['a negative count of loops created', card({ delivery: {
    'Open loops closed': '0', 'Open loops created': '-1', 'Net open loops': '-1',
  } }), 'red'],

  // --- finding disposition
  ['the findings block missing entirely', card({ dropFindings: true }), 'red'],
  ['a findings block with no allowed disposition', card({ findings: '- nothing to report' }), 'red'],
  // The template ships all six choices, so "at least one present" was
  // satisfied by the scaffold — the load-bearing block never had to be edited.
  ['the untouched six-line scaffold', card({ findings: [
    '- None', '- FIXED NOW:', '- NEXT PR:', '- REJECTED:', '- ADDED TO BACKLOG:',
    '- OWNER DECISION REQUIRED:',
  ].join('\n') }), 'red'],
  // NEXT PR is the disposition for a finding that is real and belongs to the
  // next outcome. Without it the honest choices were the backlog or letting
  // this pull request grow, and the second is what the scope rule forbids.
  ['NEXT PR', card({ findings: '- NEXT PR: the Triangle over-limit window, once headroom lands' }), 'green'],
  ['one filled disposition beside four empty ones', card({ findings: [
    '- FIXED NOW: corrected the epsilon', '- REJECTED:', '- ADDED TO BACKLOG:',
  ].join('\n') }), 'red'],
  ['None standing beside a real disposition',
    card({ findings: '- None\n- FIXED NOW: corrected the epsilon' }), 'red'],
  ['several real dispositions together', card({ findings: [
    '- FIXED NOW: corrected the epsilon',
    '- REJECTED: speculative, no evidence',
    '- OWNER DECISION REQUIRED: what TD does at the limit',
  ].join('\n') }), 'green'],
  ['FIXED NOW', card({ findings: '- FIXED NOW: the epsilon on the buffer comparison' }), 'green'],
  ['REJECTED', card({ findings: '- REJECTED: speculative, no evidence' }), 'green'],
  ['ADDED TO BACKLOG', card({ findings: '- ADDED TO BACKLOG: B72, the Triangle over-limit window' }), 'green'],
  ['OWNER DECISION REQUIRED', card({ findings: '- OWNER DECISION REQUIRED: what TD does at the limit' }), 'green'],
];

/* ------------------------------------------------------------- the mutants */

// Each reverts one pending-marker protection to the shape that shipped a false
// green. `apply` must find its target — a mutation that silently no-ops would
// "prove" the guard is load-bearing while testing nothing.
const MUTANTS = [
  {
    name: 'the multi-field guard reverted to head-only (the shape Codex found)',
    apply: src => src
      .replace(/^\s*\['Reviewer', PENDING\],\n/m, '')
      .replace(/^\s*\['Findings and dispositions', DISPOSITIONS_PENDING\],\n/m, ''),
  },
  {
    name: 'the pending markers defanged entirely (the first false green)',
    apply: src => src
      .replace(/const PENDING = \/.*\/i;/, 'const PENDING = /(?!)/;')
      .replace(/const DISPOSITIONS_PENDING = \/.*\/i;/, 'const DISPOSITIONS_PENDING = /(?!)/;'),
  },
  {
    name: 'the anchored required/not-required classifier weakened back to an anywhere match',
    apply: src => src.replace(
      /const notRequired = \/\^\(\?:not\[ \\t\]\+required\|n\\\/a\)\\b\/i\.test\(req\);/,
      'const notRequired = /\\bnot[ \\t]+required\\b/i.test(req) || /^(no|none|n\\/a)\\b/i.test(req);'),
  },
  // No mutant for the reviewer ABSENT set. It selects the wording only — the
  // reviewer-is-ChatGPT rule below rejects every absence value on its own — so
  // mutating it cannot flip a case, and a mutant that cannot flip a case must
  // not be written as if it proved something. The rule that does the work has
  // its own mutant.
  {
    name: 'the findings disposition vocabulary dropped',
    apply: src => src.replace(/const DISPOSED = \/.*\/i;/, 'const DISPOSED = /(?:)/;'),
  },
  {
    name: 'the attribution absence set narrowed back to the exact word None',
    apply: src => src.replace(
      /const ABSENT_ATTRIBUTION =\n\s*\/\^\(\?:.*?\)\\b\/i;/s,
      'const ABSENT_ATTRIBUTION = /^none\\.?$/i;'),
  },
  {
    name: 'the current-state verdict vocabulary dropped',
    apply: src => src.replace(/const VERDICT = \/.*\/i;/, 'const VERDICT = /(?:)/;'),
  },
  {
    name: 'the reviewer rule dropped entirely',
    apply: src => src.replace(
      /if \(!unfinished\.includes\('Reviewer'\) && !LANE_ONLY\.test\(reviewer\)\) \{/,
      'if (false) {'),
  },
  {
    name: 'the declared-unanswered rule dropped',
    apply: src => src.replace(/const UNANSWERED =\n\s*\/.*\/i;/, 'const UNANSWERED = /(?!)/;'),
  },
  {
    name: 'the closed lane form reopened to allow a qualifier',
    apply: src => src.replace(
      /const LANE_ONLY = \/.*\/i;/,
      "const LANE_ONLY = /^chat[ \\t-]?gpt\\b[ \\t]*(?:\\([^)\\n]{1,40}\\))?[ \\t]*[.,]?$/i;"),
  },
  {
    // A plain string swap, because a regex crafted against the escaped source
    // produced code that did not parse — every case "threw", which proves the
    // file is broken rather than the guard load-bearing.
    name: 'the bullet-row colon made optional again',
    apply: src => src.split(']*:(.*)$').join(']*:?(.*)$'),
  },
  {
    name: 'the exactly-one-verdict rule relaxed to at-least-one',
    apply: src => src.replace(/chosen\.size !== 1/, 'chosen.size === 0'),
  },
  {
    name: 'the reason required after "not required" dropped',
    apply: src => src.replace(/if \(!\/\[a-z\]\{3\}\/i\.test\(reason\)\) \{/, 'if (false) {'),
  },
  // No mutant for the bullet colon: anchoring the row reader made the separate
  // strip dead code, and it was deleted rather than left with a mutant that
  // could not fail. The blank-bullet-row case still holds it, via the reader.
  {
    name: 'the withheld-identity exception widened to every attribution field',
    apply: src => src.replace(
      /const withheldModel = label === 'Primary builder model' && rest\.length >= 3;/,
      'const withheldModel = rest.length >= 3;'),
  },
  {
    name: 'the source-and-evidence requirement dropped from the verdict row',
    apply: src => src.replace(
      /if \(verdictValue && chosen\.size === 1 && verdictRest\.length < 10\) \{/,
      'if (false) {'),
  },
  {
    name: 'the findings block back to "at least one disposition present"',
    apply: src => src.replace(/\} else if \(empty\.length\) \{/, '} else if (false) {')
      .replace(/\} else if \(listed\.some\(\(f\) => f\.kind === 'None'\) && answered\.length\) \{/,
        '} else if (false) {'),
  },
  // No mutant for the identity-field negation ban. Both closed forms — the head
  // must be a bare SHA, the reviewer must read exactly the lane name — now
  // reject every shape it used to catch, so lifting it cannot flip a case. It
  // stays because it selects the message: a placeholder card should be told the
  // review has not happened, not that it named the wrong reviewer.
  {
    // Matched to the end of the expression rather than by counting lines: a
    // line count is a distance heuristic, and reformatting the function left it
    // consuming four lines of a six-line expression, which produced code that
    // did not parse. Every case "threw", which proves a broken file.
    name: 'negated vocabulary counted as a selection again',
    apply: src => src.replace(
      /const dropNegated = \(text, tokenSource\) => text[\s\S]*?\.join\(''\);/,
      'const dropNegated = (text) => text;'),
  },
  {
    // Codex's point was that negation handling must not rest on a word-distance
    // heuristic. Reinstating the old window proves the clause scoping is what
    // catches the long form — and, on the other side, that widening the window
    // is not an option, because it fails an honest card.
    name: 'clause scoping reverted to the two-word window',
    apply: src => src.replace(
      /\.split\(\/\(\[;,\.—–\]\)\/\)/,
      ".split(/(?:)/)"),
  },
  {
    // One constant, read by every field that has to explain itself — the
    // not-required branch, an EXCEEDED scope, and an atomicity exception. It
    // was two copies for one commit, which cost this mutant its target and
    // proved the duplication rather than the guard.
    name: 'the absence words allowed back as a reason',
    apply: src => src.replace(
      /const ABSENT_REASON = \/.*\/gi;/, 'const ABSENT_REASON = /(?!)/g;'),
  },
  {
    // A false-positive guard is load-bearing in the other direction: removing
    // it turns an honest card red, which is still a flipped expectation.
    name: 'the negated-unanswered stripping dropped',
    apply: src => src.replace(
      /\s*\.replace\(\/\\bno\(\?:ne\|thing\)\?\[ \\t\]\+\(\?:unanswered\|undecided\)\\b\/gi, ''\)/,
      ''),
  },

  /* ---------------------------------------------------- the delivery block */

  {
    name: 'the delivery block made optional',
    apply: src => src.replace(
      /if \(!deliveryHeading\) \{\n\s*problems\.push\('The PR body is missing the "Delivery" section[^\n]*\n(\s*)\} else \{/,
      'if (!deliveryHeading) {\n$1} else {'),
  },
  {
    name: 'the delivery blank-line rule dropped',
    apply: src => src.replace(
      /\} else if \(!v\) \{\n(\s*)problems\.push\(`Delivery line/,
      '} else if (false) {\n$1problems.push(`Delivery line'),
  },
  {
    name: 'the closed vocabularies stopped being enforced',
    apply: src => src.replace(
      /if \(d\[label\] && !opensWith\(d\[label\], forms\)\) \{/, 'if (false) {'),
  },
  {
    // The anchoring is the whole design. Unanchored, the field is satisfied by
    // a sentence that MENTIONS one of its words — which is precisely the shape
    // that beat the card's row reader and the review block's Required line.
    name: 'the closed-form opening unanchored to an anywhere match',
    apply: src => src.replace(
      /`\^\(\?:\$\{forms\.join\('\|'\)\}\)\(\?!\[a-z0-9\]\)`/,
      "`(?:${forms.join('|')})(?![a-z0-9])`"),
  },
  {
    // Without the trailing boundary a longer word is satisfied by its prefix:
    // `NOT APPLICABLE` reads as NO, and ten rounds read as one.
    name: 'the closed-form trailing boundary dropped',
    apply: src => src.replace(/\(\?!\[a-z0-9\]\)`, 'i'\)/, "`, 'i')"),
  },
  {
    name: 'an EXCEEDED scope no longer has to say why',
    apply: src => src.replace(
      /if \(opensWith\(d\['Scope status'\], \['EXCEEDED'\]\)\n\s*&& !hasReason\(d\['Scope status'\], \['EXCEEDED'\]\)\) \{/,
      'if (false) {'),
  },
  {
    name: 'an atomicity exception no longer has to say what splitting would break',
    apply: src => src.replace(
      /if \(opensWith\(d\['Atomicity exception'\], \['YES'\]\)\n\s*&& !hasReason\(d\['Atomicity exception'\], \['YES'\]\)\) \{/,
      'if (false) {'),
  },
  {
    name: 'the review-churn circuit breaker removed entirely',
    apply: src => src.replace(
      /if \(opensWith\(d\['Blocking review rounds'\], \['2', '3\\\\\+'\]\)\) \{/,
      'if (false) {'),
  },
  {
    // Separate from the breaker above, and it needs the EXPLAINED-N/A case to
    // fail: a bare N/A is caught by the reason rule either way, so without
    // that case this mutant could not flip anything and would prove nothing.
    name: 'N/A allowed back as a reassessment after two rounds',
    apply: src => src.replace(
      /if \(opensWith\(d\['Scope reassessment'\], \['N\\\\\/A'\]\)\) \{/, 'if (false) {'),
  },
  {
    name: 'the loop counts no longer have to be integers',
    apply: src => src.replace(/if \(!INT\.test\(v\)\) \{/, 'if (false) {'),
  },
  {
    name: 'a negative count of loops allowed back',
    apply: src => src.replace(/if \(counts\[label\] < 0\) \{/, 'if (false) {'),
  },
  {
    // The one claim on this card that is verified rather than witnessed.
    name: 'the open-loop arithmetic no longer has to agree',
    apply: src => src.replace(/&& net !== cr - cl\)/, '&& false)'),
  },
  {
    name: 'NEXT PR dropped from the disposition vocabulary',
    apply: src => src.split('None|FIXED NOW|NEXT PR|REJECTED')
      .join('None|FIXED NOW|REJECTED'),
  },
  {
    // The shape that shipped: `###` ended a section and `#`, `#####` and
    // `######` did not, so a required line could step outside its block and
    // still answer it.
    name: 'the section span loosened back to ## through ####',
    apply: src => src.replace(
      /\.split\(\/\\n\[ \\t\]\*#\{1,6\}\[ \\t\]\+\/\)\[0\];/,
      '.split(/\\n[ \\t]*#{2,4}[ \\t]+/)[0];'),
  },
  {
    name: 'SPLIT allowed to merge without the split being performed',
    apply: src => src.replace(
      /if \(opensWith\(d\['Scope reassessment'\], \['SPLIT'\]\)\) \{/, 'if (false) {'),
  },
  {
    name: 'a positive net no longer has to name what it leaves open',
    apply: src => src.replace(
      /if \(Number\.isInteger\(net\) && net > 0\n\s*&& !\/\[a-z\]\{3\}\/i\.test\(d\['Loops left open'\]\.replace\(ABSENT_REASON, ''\)\)\) \{/,
      'if (false) {'),
  },
];

/* --------------------------------------------------------------------- run */

(async () => {
  console.log('=== the workflow source is readable and runnable ===');
  let SCRIPT = '';
  try {
    SCRIPT = extractScript();
    ok(SCRIPT.length > 0, 'the inline script block extracts from the workflow YAML',
      `${SCRIPT.split('\n').length} lines`);
  } catch (e) {
    ok(false, 'the inline script block extracts from the workflow YAML', e.message);
    process.exit(1);
  }
  ok(/Atlas Contract \/ Systems Review/.test(SCRIPT),
    'and it is the source that guards the required review lane');

  console.log('\n=== the real check, against every case ===');
  for (const [name, body, expect] of CASES) {
    let got = null, detail = '';
    try {
      const r = await run(SCRIPT, body);
      got = r.green ? 'green' : 'red';
      if (got !== expect) detail = r.problems.join(' | ').slice(0, 160) || '(no problem reported)';
    } catch (e) {
      got = 'threw';
      detail = e.message;
    }
    ok(got === expect, `${name} → ${expect}`, got === expect ? '' : `got ${got}. ${detail}`);
  }

  console.log('\n=== reverting a pending-marker protection breaks these cases ===');
  // The proof that the cases above are load-bearing rather than decorative: if
  // someone removes a guard, at least one committed expectation must go red.
  for (const mutant of MUTANTS) {
    const mutated = mutant.apply(SCRIPT);
    const applied = mutated !== SCRIPT;
    ok(applied, `the mutation applies — ${mutant.name}`,
      applied ? '' : 'target text not found, so this mutant proves nothing');
    if (!applied) continue;

    const escaped = [];
    for (const [name, body, expect] of CASES) {
      try {
        const r = await run(mutated, body);
        if ((r.green ? 'green' : 'red') !== expect) escaped.push(name);
      } catch { escaped.push(`${name} (threw)`); }
    }
    ok(escaped.length > 0, 'and the committed cases catch it',
      escaped.length ? `${escaped.length} case(s) flip, first: "${escaped[0]}"` : 'nothing flipped');
  }

  console.log('');
  if (failures) {
    console.log(`\x1b[31m${failures} CHECK${failures === 1 ? '' : 'S'} FAILED\x1b[0m`);
    process.exit(1);
  }
  console.log('\x1b[32mALL CHECKS PASSED\x1b[0m');
})();
