'use strict';
/* Talk citations / provenance — presentation only.
 *
 * Proves household Talk answers carry deterministic source/provenance
 * citations assembled from existing Atlas presentation fields, that
 * Gemini-invented citation fields fail closed, that estimated/unknown
 * cannot be labelled verified, and that unavailable or private
 * provenance is not published. Cited answer content stays the same
 * verified Atlas/Forecast wording. Cards and plain answers still work.
 * No new financial calculation or planner authority.
 * `node test/test-talk-citations.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkGemini = require('../scripts/talk-gemini.js');
const TalkHypothetical = require('../scripts/talk-hypothetical.js');
const Forecast = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const START = '2026-01-15';

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function loadTalkApi() {
  const src = stripComments(read('public/talk.js'));
  const sandbox = {
    App: { boot() {} },
    document: {
      querySelector() { return null; },
      createElement(tag) {
        const el = {
          tagName: tag,
          className: '',
          children: [],
          textContent: '',
          hidden: false,
          attrs: {},
          setAttribute(k, v) { this.attrs[k] = v; },
          getAttribute(k) { return this.attrs[k]; },
          removeAttribute(k) { delete this.attrs[k]; },
          appendChild(child) {
            this.children.push(child);
            return child;
          },
        };
        return el;
      },
    },
    fetch() { return Promise.resolve({ ok: false, json: async () => ({}) }); },
    $(id) {
      if (id === 'talk-send') return { disabled: true, setAttribute() {} };
      if (id === 'talk-input') return { value: '', setAttribute() {} };
      if (id === 'talk-seam') return { textContent: '' };
      if (id === 'talk-context') return { textContent: '', dataset: {} };
      if (id === 'talk-thread') return { insertAdjacentHTML() {}, appendChild() {} };
      if (id === 'talk-empty') return { hidden: false };
      if (id === 'talk-composer' || id === 'talk-prompts') return { addEventListener() {} };
      return null;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    src + '\nthis.__api = { talkAnswerNode, talkValidCards, talkValidCitations, talkPresentation };',
    sandbox
  );
  return sandbox.__api;
}

function remainingPacket() {
  return {
    metadata: {
      effectiveAsOf: '2026-09-14',
      freshness: { confidence: 'live' },
    },
    forecast: {
      currentPeriodAction: {
        essentialRemaining: 1415.95,
        remainingClaim: 'posted-only',
      },
    },
  };
}

function fixture() {
  return {
    plan: {
      windowDays: 91,
      startingCash: { amount: 2000 },
      defaults: { targetBuffer: 500, extraDebtMonthly: 0, scenario: 'expected' },
      opening: { asOf: START },
      nextDollar: { policy: 'true-surplus-highest-interest', provenance: 'owner-stated' },
      decisionPosture: { posture: 'aggressive-not-brittle', numericThreshold: 'none' },
      income: [],
      obligations: [],
      bills: [],
      commitments: [],
    },
    debts: [
      {
        id: 'high', label: 'High-rate card',
        balance: 800, pending: 0, rate: 26.99, rateConvention: 'card',
        structure: 'Revolving — synthetic high', secured: false, limit: 1200,
      },
      {
        id: 'heloc', label: 'HELOC',
        balance: 5000, pending: 0, rate: 4.9, rateConvention: 'variable',
        structure: 'Interest-only revolving — never amortises', secured: true, limit: 6000,
      },
    ],
  };
}

function citationLabels(citations) {
  return (citations || []).map(row => row.label);
}

console.log('=== 1. Contract: server owns citations; Gemini cannot invent them ===');
{
  const presentationSrc = read('scripts/talk-presentation.js');
  const geminiSrc = read('scripts/talk-gemini.js');
  const serverSrc = read('server.js');
  const talkSrc = stripComments(read('public/talk.js'));
  ok(/assembleCitations/.test(presentationSrc)
      && /sanitizeCitations/.test(presentationSrc)
      && /SURFACE_LABELS/.test(presentationSrc),
    'presentation assembles and sanitizes household citations');
  ok(!/require\(['"][^'"]*forecast/i.test(presentationSrc)
      && !/require\(['"][^'"]*forecast/i.test(geminiSrc),
    'citation assembly still does not import Forecast');
  ok(/citations: presented\.citations \|\| null/.test(serverSrc),
    'POST /talk/ask forwards server-assembled citations');
  ok(/invent citations/.test(TalkGemini.INSTRUCTION)
      && /return a citations/.test(TalkGemini.INSTRUCTION)
      && /Household citations/.test(TalkGemini.INSTRUCTION),
    'instruction forbids Gemini-invented citations, URLs, provenance, and trust labels');
  ok(!/money2\(|\bmoney\(/.test(talkSrc)
      && !/Forecast\./.test(talkSrc)
      && !/formatCurrency/.test(talkSrc),
    'talk.js still does not format money or call Forecast while rendering citations');
}

console.log('\n=== 2. Cited answer content equals existing Atlas presentation fields ===');
{
  const packet = remainingPacket();
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
  }, packet);
  const independent = TalkPresentation.formatCurrency(1415.95);
  const provenance = presented.cards.items.find(item => item.kind === 'provenance');
  const action = presented.cards.items.find(item => item.kind === 'action');
  const surface = presented.citations.find(item => item.kind === 'surface');
  const citeProvenance = presented.citations.find(item => item.kind === 'provenance');
  ok(presented.answer === `You have ${independent} remaining in the current pay period.`,
    'cited remaining answer is the same independently formatted Atlas sentence');
  ok(presented.source === 'Forecast'
      && presented.trust === 'posted-only'
      && presented.asOf === '2026-09-14'
      && presented.action && presented.action.href === '/',
    'cited remaining keeps Forecast source, posted-only trust, packet as-of, and Budget action');
  ok(surface
      && surface.source === presented.source
      && surface.href === presented.action.href
      && surface.label === 'Budget'
      && surface.label === TalkPresentation.SURFACE_LABELS[presented.action.href],
    'surface citation points at the existing Budget route already on the action');
  ok(citeProvenance
      && citeProvenance.label === provenance.body
      && citeProvenance.source === presented.source
      && citeProvenance.asOf === presented.asOf
      && citeProvenance.trust === presented.trust
      && citeProvenance.freshness === presented.freshness,
    'provenance citation reprints the same source/as-of/trust string already on the card');
  ok(action && action.href === '/' && action.label === 'View Budget',
    'existing View Budget action card is unchanged');
}

console.log('\n=== 3. Gemini-invented citation fields fail closed ===');
{
  const packet = remainingPacket();
  const claims = [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 }];
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    status: 'explained',
    claims,
    citations: [{ kind: 'surface', href: 'https://evil.example', label: 'Bank' }],
  })).ok === false,
    'top-level Gemini citations field fails closed');
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    status: 'explained',
    claims,
    sources: ['Forecast', 'https://evil.example'],
  })).ok === false,
    'top-level Gemini sources field fails closed');
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    status: 'explained',
    claims: [{
      path: 'forecast.currentPeriodAction.essentialRemaining',
      equals: 1415.95,
      source: 'https://evil.example/raw/statement.pdf',
    }],
  })).ok === false,
    'claim-level invented source URL fails closed');
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    status: 'explained',
    claims: [{
      path: 'forecast.currentPeriodAction.essentialRemaining',
      equals: 1415.95,
      citations: [{ url: 'raw/export.csv', trust: 'verified' }],
    }],
  })).ok === false,
    'claim-level citations array fails closed');
  ok(TalkGemini.parseTalkModelOutput(JSON.stringify({
    intent: 'hypothetical-extra-payment',
    amount: 200,
    debtLabel: 'High-rate card',
    citations: [{ href: '/talk.html', label: 'Talk' }],
  })).ok === false,
    'hypothetical extract with invented citations fails closed');
  ok(TalkGemini.materializeExplainerAnswer(JSON.stringify({
    status: 'explained',
    claims,
    url: 'https://evil.example',
  }), packet).ok === false,
    'materialize drops a turn that tries to publish a model URL');
  ok(TalkPresentation.sanitizeCitations([
    { kind: 'surface', source: 'Forecast', href: 'https://evil.example', label: 'Budget' },
  ]) === null
      && TalkPresentation.sanitizeCitations([
        { kind: 'surface', source: 'Forecast', href: '/talk.html', label: 'Talk' },
      ]) === null
      && TalkPresentation.sanitizeCitations([
        { kind: 'surface', source: 'Forecast', href: '/raw/export.csv', label: 'Budget' },
      ]) === null
      && TalkPresentation.sanitizeCitations([
        { kind: 'provenance', source: 'Forecast', asOf: 'raw/secret.json', trust: 'precise', label: 'Forecast' },
      ]) === null,
    'sanitizer rejects non-Atlas hrefs, Talk, raw files, and private paths');
}

console.log('\n=== 4. Estimated / unknown cannot be labelled verified ===');
{
  const bills = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'current.nextSignificantObligations.nextDue.amount', value: 17 }],
  }, {
    metadata: { effectiveAsOf: '2026-09-14' },
    current: {
      nextSignificantObligations: {
        nextDue: { amount: 17, confidence: 'estimated' },
      },
    },
  });
  const billCite = bills.citations.find(item => item.kind === 'provenance');
  ok(bills.answer === 'The next due amount is $17.00.'
      && bills.trust === 'estimated'
      && billCite && billCite.trust === 'estimated'
      && billCite.trust !== 'verified'
      && !/verified/i.test(JSON.stringify(bills.citations)),
    'estimated bills keep estimated citation trust and are not labelled verified');
  ok(bills.citations.some(item => item.kind === 'surface' && item.href === '/bills.html' && item.label === 'Bills'),
    'estimated bills still cite the existing Bills surface');

  const unknown = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'leftover', value: 400 }],
  }, remainingPacket());
  ok(unknown.answer === 'This request\'s packet shows leftover is 400.'
      && unknown.source === null
      && !(unknown.citations || []).some(item => item.source === 'Forecast' || item.kind === 'surface'),
    'unknown leftover path does not invent Forecast or a surface citation');
  ok(TalkPresentation.publicCitationTrust('verified') === null
      && TalkPresentation.publicCitationTrust('estimated') === 'estimated'
      && TalkPresentation.publicCitationTrust('unknown') === 'unknown',
    'verified is not a publishable citation trust; estimated and unknown stay themselves');
  ok(TalkPresentation.sanitizeCitations([{
    kind: 'provenance',
    source: 'Forecast',
    asOf: '2026-09-14',
    trust: 'verified',
    label: 'Forecast · as of 2026-09-14 · verified',
  }]) === null
      && TalkPresentation.sanitizeCitations([{
        kind: 'provenance',
        source: 'Forecast',
        asOf: '2026-09-14',
        trust: 'estimated',
        label: 'Forecast · as of 2026-09-14 · verified',
      }]) === null,
    'sanitizer fails closed when a citation tries to promote to verified');
}

console.log('\n=== 5. Unavailable provenance fails closed ===');
{
  const unavailable = TalkPresentation.presentVerifiedClaims({
    status: 'unavailable',
    claims: [],
  }, remainingPacket());
  ok(unavailable.answer === TalkPresentation.UNAVAILABLE_ANSWER
      && unavailable.source === null
      && unavailable.citations === null,
    'unavailable extractive provenance publishes no invented citations');

  const unavailableMoney = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: null }],
  }, {
    metadata: { effectiveAsOf: '2026-09-14' },
    forecast: { currentPeriodAction: { essentialRemaining: null, remainingClaim: 'unavailable' } },
  });
  const moneyCite = (unavailableMoney.citations || []).find(item => item.kind === 'provenance');
  ok(unavailableMoney.answer === 'Current pay-period remaining is unavailable.'
      && unavailableMoney.trust === 'unavailable'
      && moneyCite
      && moneyCite.trust === 'unavailable'
      && moneyCite.trust !== 'verified'
      && moneyCite.source === 'Forecast'
      && !/\$0/.test(unavailableMoney.answer),
    'unavailable remaining keeps Forecast provenance as unavailable and does not invent zero');

  const mixed = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [
      { path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 },
      { path: 'leftover', value: 400 },
    ],
  }, remainingPacket());
  ok(mixed.source === null
      && mixed.action === null
      && !(mixed.citations || []).some(item => item.kind === 'surface' || item.source === 'Forecast'),
    'an unmapped path strips Forecast citations so the answer cannot falsely claim Forecast');
}

console.log('\n=== 6. Cards and plain answers still work ===');
{
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
  }, remainingPacket());
  const ui = loadTalkApi();
  const cards = ui.talkAnswerNode(presented);
  const mount = cards.children[0];
  const cardBodies = mount.children.map(card => {
    const body = card.children.find(child => child.className === 'talk-card-body');
    if (body) return body.textContent;
    const action = card.children.find(child => child.className === 'talk-answer-action');
    return action && action.children[0] ? action.children[0].textContent : null;
  });
  const cardCitations = cards.children.find(child => child.className === 'talk-citations');
  ok(/talk-bubble-cards/.test(cards.className)
      && cardBodies[0] === presented.answer
      && cardBodies.indexOf('Forecast · as of 2026-09-14 · posted-only · live') !== -1
      && cardBodies.indexOf('View Budget') !== -1,
    'trusted cards still reprint the answer, provenance, and Budget action');
  ok(cardCitations
      && cardCitations.children[0].textContent === 'Sources'
      && cardCitations.children[1].children.some(row => (
        row.attrs['data-talk-citation'] === 'surface'
        && row.children[0]
        && row.children[0].getAttribute('href') === '/'
        && row.children[0].textContent === 'Budget'
      ))
      && cardCitations.children[1].children.some(row => (
        row.textContent === 'Forecast · as of 2026-09-14 · posted-only · live'
      )),
    'card answers also show server citations for Budget and Forecast provenance');

  const plain = ui.talkAnswerNode({
    answer: presented.answer,
    source: 'Forecast',
    trust: 'posted-only',
    asOf: '2026-09-14',
    freshness: 'live',
    action: { href: '/', label: 'View Budget' },
  });
  ok(plain.children[0].textContent === presented.answer
      && plain.children[1].className === 'talk-answer-meta'
      && plain.children[2].className === 'talk-answer-action'
      && !/talk-bubble-cards/.test(plain.className),
    'plain answers without a citations field keep the incumbent meta and action order');

  const plainCited = ui.talkAnswerNode({
    answer: presented.answer,
    source: 'Forecast',
    trust: 'posted-only',
    asOf: '2026-09-14',
    freshness: 'live',
    action: { href: '/', label: 'View Budget' },
    citations: presented.citations,
  });
  ok(plainCited.children[0].textContent === presented.answer
      && plainCited.children[1].className === 'talk-answer-meta'
      && plainCited.children[2].className === 'talk-answer-action'
      && plainCited.children[3].className === 'talk-citations'
      && plainCited.children[3].children[1].children.some(row => row.children[0] && row.children[0].textContent === 'Budget'),
    'plain answers render server citations after the unchanged meta and action');

  ok(ui.talkValidCitations(null) === null
      && ui.talkValidCitations([{ kind: 'surface', source: 'Forecast', href: '/talk.html', label: 'Talk' }]) === null
      && ui.talkValidCitations([{
        kind: 'provenance',
        source: 'Forecast',
        trust: 'estimated',
        label: 'Forecast · verified',
      }]) === null
      && ui.talkValidCitations([{
        kind: 'surface',
        source: 'Forecast',
        href: '/',
        label: 'Secret ledger',
      }]) === null,
    'browser drops Talk routes, verified-promoting labels, and invented surface names');
  ok(ui.talkValidCards({
    version: 1,
    items: [{ kind: 'answer', title: 'Answer', body: presented.answer }],
  })[0].body === presented.answer,
    'ordinary answer cards still validate');
}

console.log('\n=== 7. Hypo / compare / preference keep Forecast citations, no new authority ===');
{
  const { plan, debts } = fixture();
  const hypo = TalkHypothetical.evaluate({
    amount: '$200',
    debtLabel: 'High-rate card',
    question: 'What if I put $200 on the High-rate card?',
    plan,
    debts,
  });
  const forecastHypo = Forecast.hypotheticalExtraPayment(
    plan, debts, START, { amount: 200, debtId: 'high', nature: 'hypothetical' }
  );
  const presentedHypo = TalkPresentation.presentHypotheticalExtra(hypo, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  const interest = TalkPresentation.formatCurrency(forecastHypo.delta.debt.interest);
  ok(forecastHypo.status === 'ready'
      && presentedHypo.answer.indexOf(interest) !== -1
      && presentedHypo.source === 'Forecast'
      && presentedHypo.citations.some(item => item.kind === 'provenance' && item.source === 'Forecast' && item.asOf === START)
      && !presentedHypo.citations.some(item => item.kind === 'surface'),
    'hypothetical citations are Forecast provenance already on the presentation, not a nav recommendation');
  ok(presentedHypo.cards.items.some(item => item.kind === 'result' && item.body.indexOf(interest) !== -1),
    'hypothetical cards still reprint the independently formatted Forecast interest delta');

  const compare = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'HELOC' },
    ],
    question: 'What if I put $200 on the High-rate card versus $200 on the HELOC?',
    plan,
    debts,
  });
  const presentedCompare = TalkPresentation.presentHypotheticalComparison(compare, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  ok(presentedCompare.citations.some(item => item.source === 'Forecast' && item.asOf === START)
      && presentedCompare.cards.items.filter(item => item.kind === 'option').length === 2
      && !presentedCompare.cards.items.some(item => item.kind === 'judgment'),
    'comparison cards and Forecast citations stay comparison-only');

  const missing = TalkPresentation.presentHypotheticalExtra({
    status: 'unavailable',
    reason: 'unresolved-debt',
  }, { metadata: { effectiveAsOf: START } });
  ok(missing.answer === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER
      && missing.citations.some(item => item.source === 'Forecast' && item.trust === 'unavailable')
      && !/\$0/.test(JSON.stringify(missing.citations)),
    'unavailable hypothetical cites Forecast as unavailable and does not invent zero');
}

console.log('\n=== 8. Citation allowlist stays the existing Atlas surfaces ===');
{
  ok(TalkPresentation.SURFACE_LABELS['/'] === 'Budget'
      && TalkPresentation.SURFACE_LABELS['/bills.html'] === 'Bills'
      && TalkPresentation.SURFACE_LABELS['/credit.html'] === 'Credit'
      && TalkPresentation.SURFACE_LABELS['/planning.html'] === 'Planning',
    'citation surfaces are Budget, Bills, Credit, and Planning');
  ok(!TalkPresentation.SURFACE_LABELS['/talk.html']
      && !TalkPresentation.SURFACE_LABELS['/subscriptions.html']
      && !TalkPresentation.isAllowedActionHref('/talk.html'),
    'Talk and Subscriptions are not citation surfaces');
  ok(citationLabels(TalkPresentation.assembleCitations({
    source: 'Credit',
    action: { href: '/credit.html', label: 'View Credit' },
    trust: 'calculated',
    asOf: '2026-09-14',
  })).indexOf('Credit') !== -1,
    'Credit presentation assembles a Credit surface citation');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
