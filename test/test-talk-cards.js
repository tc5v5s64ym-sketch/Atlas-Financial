'use strict';
/* Talk structured answer cards — presentation only.
 *
 * Proves the reserved #talk-cards surface reprints already-trusted Talk
 * presentation strings, fails closed to the plain answer bubble when
 * cards are missing or malformed, and that the browser does not format
 * money or invent financial meaning. Figures on cards are reconciled
 * against the same server presentation fields / independent Forecast
 * deltas, not against a second browser calculation.
 * `node test/test-talk-cards.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const TalkPresentation = require('../scripts/talk-presentation.js');
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

function loadTalkApi(options) {
  options = options || {};
  const src = stripComments(read('public/talk.js'));
  const created = [];
  const talkCards = options.talkCards || null;
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
          removeChild(child) {
            this.children = this.children.filter(row => row !== child);
            return child;
          },
          get firstChild() { return this.children[0] || null; },
          closest() { return null; },
        };
        created.push(el);
        return el;
      },
    },
    fetch() { return Promise.resolve({ ok: false, json: async () => ({}) }); },
    $(id) {
      if (id === 'talk-cards') return talkCards;
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
    src + '\nthis.__api = { talkAnswerNode, talkValidCards, talkPresentation, talkAllowedAction };',
    sandbox
  );
  return { api: sandbox.__api, created };
}

function cardBodies(node) {
  const mount = node && node.children && node.children[0];
  if (!mount || !Array.isArray(mount.children)) return [];
  return mount.children.map(card => {
    const body = card.children.find(child => child.className === 'talk-card-body');
    if (body) return body.textContent;
    const action = card.children.find(child => child.className === 'talk-answer-action');
    return action && action.children[0] ? action.children[0].textContent : null;
  });
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

console.log('=== 1. Reserved mount, no browser money math, no Forecast ===');
{
  const html = read('public/talk.html');
  const css = read('public/talk.css');
  const raw = read('public/talk.js');
  const src = stripComments(raw);
  const serverSrc = read('server.js');
  const presentationSrc = read('scripts/talk-presentation.js');
  ok(/id="talk-cards"/.test(html) && /class="talk-cards"/.test(html) && /hidden/.test(html),
    '#talk-cards remains the Talk card mount and starts hidden');
  ok(/talk-card-title/.test(css) && /talk-card-body/.test(css)
      && /max-width:\s*640px/.test(css) && /talk-card \{/.test(css),
    'talk.css styles cards and includes a mobile card tightening');
  ok(!/money2\(|\bmoney\(/.test(src)
      && !/toLocaleString/.test(src)
      && !/formatCurrency/.test(src)
      && !/Forecast\./.test(src)
      && !/parseFloat|parseInt/.test(src)
      && !/Number\(/.test(src),
    'talk.js still does not format money, parse numbers, or call Forecast');
  ok(!/split\(|match\(|RegExp/.test(src.split('talkValidCards')[1] || ''),
    'card validation does not parse answer text into claims');
  ok(!/innerHTML\s*=/.test(src), 'card render does not assign innerHTML');
  ok(/cards: presented\.cards \|\| null/.test(read('scripts/talk-stream.js'))
      && /TalkStream\.publicAskBody/.test(serverSrc),
    'POST /talk/ask forwards already-built presentation cards');
  ok(/sanitizePresentationCards/.test(presentationSrc)
      && /kind: 'option'/.test(presentationSrc)
      && /kind: 'judgment'/.test(presentationSrc),
    'presentation assembles cards from trusted option and judgment fields');
  ok(!/require\(['"][^'"]*forecast/i.test(presentationSrc),
    'card assembly still does not import Forecast');
}

console.log('\n=== 2. Browser fail-closes to the plain answer bubble ===');
{
  const ui = loadTalkApi();
  const plain = {
    answer: 'You have $1,415.95 remaining in the current pay period.',
    source: 'Forecast',
    trust: 'posted-only',
    asOf: '2026-09-14',
    freshness: 'live',
    action: { href: '/', label: 'View Budget' },
  };
  const missing = ui.api.talkAnswerNode(plain);
  ok(missing.getAttribute('data-talk-role') === 'atlas-answer'
      && missing.children[0].textContent === plain.answer
      && missing.children[1].className === 'talk-answer-meta'
      && missing.children[2].className === 'talk-answer-action'
      && !/talk-bubble-cards/.test(missing.className),
    'no cards field keeps the incumbent plain answer bubble');
  ok(ui.api.talkValidCards(null) === null
      && ui.api.talkValidCards({ version: 1, items: [] }) === null
      && ui.api.talkValidCards({ version: 2, items: [{ kind: 'answer', title: 'Answer', body: plain.answer }] }) === null
      && ui.api.talkValidCards({
        version: 1,
        items: [{ kind: 'invented', title: 'Answer', body: '$99.00' }],
      }) === null
      && ui.api.talkValidCards({
        version: 1,
        items: [{ kind: 'action', title: 'Open', body: 'View Talk', href: '/talk.html', label: 'View Talk' }],
      }) === null,
    'missing, empty, version-mismatched, invented, and unsafe action cards are unavailable');
  const malformedNode = ui.api.talkAnswerNode(Object.assign({}, plain, {
    cards: { version: 1, items: [{ kind: 'answer', title: 'Answer', body: '' }] },
  }));
  ok(malformedNode.children[0].textContent === plain.answer
      && !/talk-bubble-cards/.test(malformedNode.className),
    'empty card body fails closed to the same answer string');
}

console.log('\n=== 3. Trusted cards reprint server strings; figures match presentation ===');
{
  const packet = {
    metadata: { effectiveAsOf: '2026-09-14', freshness: { confidence: 'live' } },
    forecast: {
      currentPeriodAction: {
        essentialRemaining: 1415.95,
        remainingClaim: 'posted-only',
      },
    },
  };
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
  }, packet);
  const independent = TalkPresentation.formatCurrency(1415.95);
  ok(presented.answer === `You have ${independent} remaining in the current pay period.`
      && presented.cards.items[0].body === presented.answer
      && presented.cards.items[0].body.indexOf(independent) !== -1,
    'extractive card body is the server answer and the independently formatted remaining');
  const ui = loadTalkApi();
  const rendered = ui.api.talkAnswerNode(Object.assign({}, presented, { summary: null }));
  const bodies = cardBodies(rendered);
  ok(/talk-bubble-cards/.test(rendered.className)
      && bodies[0] === presented.answer
      && bodies.indexOf('Forecast · as of 2026-09-14 · posted-only · live') !== -1
      && bodies.indexOf('View Budget') !== -1,
    'browser reprints extractive card strings without changing the remaining figure');
  const reserved = {
    className: 'talk-cards',
    hidden: true,
    children: [],
    attrs: { hidden: '' },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      this.children = this.children.filter(row => row !== child);
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    closest() { return null; },
  };
  const reservedUi = loadTalkApi({ talkCards: reserved });
  reservedUi.api.talkAnswerNode(Object.assign({}, presented, { summary: null }));
  ok(reserved.hidden === false
      && reserved.children.length >= 1
      && reserved.children[0].children[1].textContent === presented.answer,
    'trusted cards populate the reserved #talk-cards mount');
}

console.log('\n=== 4. Unavailable stays unavailable on cards ===');
{
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: null }],
  }, {
    metadata: { effectiveAsOf: '2026-09-14' },
    forecast: { currentPeriodAction: { essentialRemaining: null, remainingClaim: 'unavailable' } },
  });
  ok(presented.answer === 'Current pay-period remaining is unavailable.'
      && presented.cards.items[0].body === presented.answer
      && !/\$0/.test(JSON.stringify(presented.cards))
      && !/0\.00/.test(JSON.stringify(presented.cards)),
    'unavailable extractive cards do not invent zero');
  const missing = TalkPresentation.presentHypotheticalExtra({
    status: 'unavailable',
    reason: 'unresolved-debt',
  }, { metadata: { effectiveAsOf: START } });
  ok(missing.cards.items[0].body === TalkPresentation.HYPOTHETICAL_UNAVAILABLE_ANSWER
      && !/\$0/.test(JSON.stringify(missing.cards)),
    'unavailable hypothetical cards stay unavailable');
}

console.log('\n=== 5. Hypo / compare / preference cards match Forecast fields ===');
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
  const cash = TalkPresentation.formatCurrency(forecastHypo.delta.cash.ending);
  const hypoContentKinds = { answer: true, result: true, option: true, judgment: true, note: true };
  ok(forecastHypo.status === 'ready'
      && presentedHypo.answer.indexOf(interest) !== -1
      && presentedHypo.cards.items.some(item => item.kind === 'result' && item.body.indexOf(interest) !== -1)
      && presentedHypo.cards.items.some(item => item.kind === 'result' && item.body.indexOf(cash) !== -1)
      && presentedHypo.cards.items
        .filter(item => hypoContentKinds[item.kind])
        .every(item => presentedHypo.answer.indexOf(item.body) !== -1)
      && presentedHypo.cards.items.some(item => (
        item.kind === 'provenance' && item.body.indexOf(START) !== -1 && item.body.indexOf('Forecast') !== -1
      )),
    'hypothetical result cards reprint independently formatted Forecast deltas already in the answer');

  const compare = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'HELOC' },
    ],
    question: 'What if I put $200 on the High-rate card versus $200 on the HELOC?',
    plan,
    debts,
  });
  const forecastCompare = Forecast.hypotheticalExtraPaymentComparison(
    plan, debts, START, {
      nature: 'hypothetical-comparison',
      scenarios: [
        { amount: 200, debtId: 'high' },
        { amount: 200, debtId: 'heloc' },
      ],
    }
  );
  const presentedCompare = TalkPresentation.presentHypotheticalComparison(compare, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  const interestA = TalkPresentation.formatCurrency(
    forecastCompare.scenarios[0].result.delta.debt.interest
  );
  const interestB = TalkPresentation.formatCurrency(
    forecastCompare.scenarios[1].result.delta.debt.interest
  );
  ok(forecastCompare.status === 'ready'
      && presentedCompare.cards.items.filter(item => item.kind === 'option').length === 2
      && presentedCompare.cards.items.some(item => item.title === 'Option A' && item.body.indexOf(interestA) !== -1)
      && presentedCompare.cards.items.some(item => item.title === 'Option B' && item.body.indexOf(interestB) !== -1)
      && !presentedCompare.cards.items.some(item => item.kind === 'judgment'),
    'comparison cards keep Option A/B Forecast figures and do not invent a preference');

  const judged = TalkHypothetical.judgeComparisonPreference(compare);
  const presentedPrefer = TalkPresentation.presentHypotheticalComparison(compare, {
    metadata: { effectiveAsOf: START },
  }, judged);
  ok(presentedPrefer.cards.items.some(item => item.kind === 'option' && item.body.indexOf(interestA) !== -1)
      && presentedPrefer.cards.items.some(item => item.kind === 'option' && item.body.indexOf(interestB) !== -1)
      && presentedPrefer.cards.items.some(item => item.kind === 'judgment'
        && (item.body.indexOf('PREFER') !== -1 || item.body.indexOf('NOT YET / INDETERMINATE') !== -1))
      && presentedPrefer.cards.items
        .filter(item => hypoContentKinds[item.kind])
        .every(item => presentedPrefer.answer.indexOf(item.body) !== -1),
    'preference cards reprint the same option figures and the server PREFER / NOT YET sentence');

  const ui = loadTalkApi();
  const renderedPrefer = ui.api.talkAnswerNode(Object.assign({}, presentedPrefer, { summary: null }));
  const preferBodies = cardBodies(renderedPrefer);
  ok(preferBodies.some(body => body && body.indexOf(interestA) !== -1)
      && preferBodies.some(body => body && body.indexOf(interestB) !== -1),
    'browser preference cards show the same Forecast interest strings the server sent');
}

console.log('\n=== 6. Sanitizer rejects invented card authority ===');
{
  ok(TalkPresentation.sanitizePresentationCards({
    version: 1,
    items: [{ kind: 'answer', title: 'Answer', body: 'Spendable household cash is unavailable.' }],
  }).items[0].body === 'Spendable household cash is unavailable.',
    'a trusted answer card is kept');
  ok(TalkPresentation.sanitizePresentationCards({
    version: 1,
    items: [{ kind: 'action', title: 'Open', body: 'View Talk', href: '/talk.html', label: 'View Talk' }],
  }) === null, 'Talk-route action cards are rejected');
  ok(TalkPresentation.sanitizePresentationCards({
    version: 1,
    items: [{ kind: 'figure', title: 'Leftover', body: '$400.00' }],
  }) === null, 'invented figure card kinds are rejected');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
