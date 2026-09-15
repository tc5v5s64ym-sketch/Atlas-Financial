'use strict';
/* Talk household decision summary — presentation only.
 *
 * Proves an already-verified Talk answer carries a compact five-section
 * household decision summary assembled from trusted presentation fields,
 * card bodies, and citation labels. The browser reprints those strings.
 * Missing or malformed summary fails closed to the incumbent cards or
 * plain answer. No browser-side math, no new planner, no manufactured
 * safe / affordable / best / extra-cash / permission wording.
 * `node test/test-talk-decision-summary.js`
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const TalkPresentation = require('../scripts/talk-presentation.js');
const TalkHypothetical = require('../scripts/talk-hypothetical.js');
const TalkGemini = require('../scripts/talk-gemini.js');
const TalkWhy = require('../scripts/talk-why.js');
const TalkStream = require('../scripts/talk-stream.js');
const Forecast = require('../public/forecast.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const START = '2026-01-15';
const FORECAST_PATH = path.join(ROOT, 'public', 'forecast.js');
const forecastHash = crypto.createHash('sha256').update(fs.readFileSync(FORECAST_PATH)).digest('hex');

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
        return el;
      },
    },
    fetch() { return Promise.resolve({ ok: false, json: async () => ({}) }); },
    $(id) {
      if (id === 'talk-summary') return options.talkSummary || null;
      if (id === 'talk-cards') return options.talkCards || null;
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
    src + '\nthis.__api = { talkAnswerNode, talkValidCards, talkValidSummary, talkValidCitations, talkPresentation };',
    sandbox
  );
  return sandbox.__api;
}

function sectionMap(summary) {
  const out = Object.create(null);
  if (!summary || !Array.isArray(summary.sections)) return out;
  for (const section of summary.sections) {
    out[section.key] = section;
  }
  return out;
}

function sectionBodies(summary, key) {
  const section = sectionMap(summary)[key];
  return section ? section.items.map(item => item.body) : [];
}

function summaryItemTexts(node) {
  const mount = node && node.children && node.children[0];
  if (!mount || !Array.isArray(mount.children)) return [];
  const texts = [];
  for (const section of mount.children) {
    for (const child of section.children || []) {
      if (child.className === 'talk-summary-item') texts.push(child.textContent);
    }
  }
  return texts;
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

function manufacturedRecommendation(text) {
  return /\b(?:safe|affordable|best|extra cash|permission)\b/i.test(text);
}

console.log('=== 1. Contract: server assembles summary; browser does not calculate ===');
{
  const presentationSrc = read('scripts/talk-presentation.js');
  const streamSrc = read('scripts/talk-stream.js');
  const talkSrc = stripComments(read('public/talk.js'));
  const html = read('public/talk.html');
  const css = read('public/talk.css');
  const closedBlob = Object.keys(TalkPresentation.SUMMARY_CLOSED)
    .map(key => TalkPresentation.SUMMARY_CLOSED[key])
    .join('\n');
  ok(/assembleDecisionSummary/.test(presentationSrc)
      && /sanitizeDecisionSummary/.test(presentationSrc)
      && /What Atlas knows/.test(presentationSrc)
      && /What Atlas cannot determine yet/.test(presentationSrc),
    'presentation owns the five-section decision-summary assembly');
  ok(!/require\(['"][^'"]*forecast/i.test(presentationSrc),
    'summary assembly still does not import Forecast');
  ok(/summary: presented\.summary \|\| null/.test(streamSrc)
      && TalkStream.RESULT_KEYS.indexOf('summary') !== -1,
    'POST /talk/ask and SSE forward the server-assembled summary');
  ok(/id="talk-summary"/.test(html) && /class="talk-summary"/.test(html) && /hidden/.test(html),
    '#talk-summary remains the reserved mount and starts hidden');
  ok(/talk-summary-title/.test(css) && /talk-summary-item/.test(css)
      && /max-width:\s*640px/.test(css),
    'talk.css styles the decision summary and keeps the mobile tightening');
  ok(!/money2\(|\bmoney\(/.test(talkSrc)
      && !/toLocaleString/.test(talkSrc)
      && !/formatCurrency/.test(talkSrc)
      && !/Forecast\./.test(talkSrc)
      && !/parseFloat|parseInt/.test(talkSrc)
      && !/Number\(/.test(talkSrc),
    'talk.js still does not format money, parse numbers, or call Forecast');
  ok(!/innerHTML\s*=/.test(talkSrc), 'summary render does not assign innerHTML');
  ok(!manufacturedRecommendation(closedBlob),
    'closed summary templates do not manufacture safe, affordable, best, extra cash, or permission');
  ok(crypto.createHash('sha256').update(fs.readFileSync(FORECAST_PATH)).digest('hex') === forecastHash,
    'this suite does not edit public/forecast.js');
}

console.log('\n=== 2. Extractive remaining reprints trusted fields; citations survive ===');
{
  const packet = remainingPacket();
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
  }, packet);
  const independent = TalkPresentation.formatCurrency(1415.95);
  const knows = sectionBodies(presented.summary, 'knows');
  const changes = sectionBodies(presented.summary, 'changes');
  const unchanged = sectionBodies(presented.summary, 'unchanged');
  const risk = sectionBodies(presented.summary, 'risk');
  const unknown = sectionBodies(presented.summary, 'unknown');
  const citeProvenance = presented.citations.find(row => row.kind === 'provenance');
  ok(presented.summary
      && presented.summary.version === 1
      && presented.summary.sections.map(row => row.key).join(',')
        === TalkPresentation.SUMMARY_SECTION_ORDER.join(','),
    'verified remaining carries the closed five-section summary');
  ok(presented.answer === `You have ${independent} remaining in the current pay period.`
      && knows[0] === presented.answer
      && knows[0].indexOf(independent) !== -1,
    'What Atlas knows reprints the independently formatted remaining sentence');
  ok(changes[0] === TalkPresentation.SUMMARY_CLOSED.noForecastChange,
    'extractive remaining does not invent a Forecast change');
  ok(unchanged[0] === TalkPresentation.SUMMARY_CLOSED.reprintsOnly,
    'extractive remaining states it reprints already-published fields');
  ok(citeProvenance
      && risk.indexOf(citeProvenance.label) !== -1
      && citeProvenance.label === 'Forecast · as of 2026-09-14 · posted-only · live',
    'risk reprints the same provenance citation already on the answer');
  ok(unknown[0] === TalkPresentation.SUMMARY_CLOSED.packetOnly
      && !manufacturedRecommendation(JSON.stringify(presented.summary)),
    'unknown stays packet-bounded and does not manufacture permission');
  const beforeCitations = JSON.stringify(presented.citations);
  ok(presented.citations.some(row => row.kind === 'surface' && row.href === '/')
      && presented.cards.items[0].body === presented.answer,
    'incumbent cards and citations survive beside the summary');
  const publicBody = TalkStream.publicAskBody(presented);
  ok(publicBody.summary
      && JSON.stringify(publicBody.citations) === beforeCitations
      && publicBody.answer === presented.answer
      && Object.keys(publicBody).sort().join()
        === 'action,answer,asOf,cards,citations,freshness,source,summary,trust',
    'public ask body keeps answer, cards, citations, and summary without extra keys');
}

console.log('\n=== 3. Hypothetical changes match independent Forecast deltas ===');
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
  const presented = TalkPresentation.presentHypotheticalExtra(hypo, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  });
  const interest = TalkPresentation.formatCurrency(forecastHypo.delta.debt.interest);
  const cash = TalkPresentation.formatCurrency(forecastHypo.delta.cash.ending);
  const changes = sectionBodies(presented.summary, 'changes').join('\n');
  const knows = sectionBodies(presented.summary, 'knows').join('\n');
  const unchanged = sectionBodies(presented.summary, 'unchanged').join('\n');
  ok(forecastHypo.status === 'ready'
      && presented.summary
      && knows.indexOf('$200.00') !== -1
      && knows.indexOf('High-rate card') !== -1
      && changes.indexOf(interest) !== -1
      && changes.indexOf(cash) !== -1
      && presented.answer.indexOf(interest) !== -1
      && presented.answer.indexOf(cash) !== -1,
    'hypothetical What changes reprints independently formatted Forecast deltas already in the answer');
  ok(/not a recommendation/.test(unchanged)
      && sectionBodies(presented.summary, 'changes').every(body => presented.answer.indexOf(body) !== -1)
      && !/\baffordable\b|\bbest\b/.test(JSON.stringify(presented.summary)),
    'hypothetical summary keeps the existing not-a-recommendation note and invents no permission');
  ok(Array.isArray(presented.citations)
      && presented.citations.some(row => row.source === 'Forecast'),
    'hypothetical citations survive into the summary payload');
}

console.log('\n=== 4. Preference does not become permission; NOT YET stays unknown ===');
{
  const { plan, debts } = fixture();
  const compare = TalkHypothetical.evaluateComparison({
    scenarios: [
      { amount: 200, debtLabel: 'High-rate card' },
      { amount: 200, debtLabel: 'HELOC' },
    ],
    question: 'What if I put $200 on the High-rate card versus $200 on the HELOC?',
    plan,
    debts,
  });
  const judged = TalkHypothetical.judgeComparisonPreference(compare);
  const presented = TalkPresentation.presentHypotheticalComparison(compare, {
    metadata: { effectiveAsOf: START, freshness: { confidence: 'canonical-opening' } },
  }, judged);
  const blob = JSON.stringify(presented.summary);
  const unknown = sectionBodies(presented.summary, 'unknown').join('\n');
  const knows = sectionBodies(presented.summary, 'knows').join('\n');
  const changes = sectionBodies(presented.summary, 'changes');
  const unchanged = sectionBodies(presented.summary, 'unchanged');
  const high = Forecast.hypotheticalExtraPayment(
    plan, debts, START, { amount: 200, debtId: 'high', nature: 'hypothetical' }
  );
  const heloc = Forecast.hypotheticalExtraPayment(
    plan, debts, START, { amount: 200, debtId: 'heloc', nature: 'hypothetical' }
  );
  const highInterest = TalkPresentation.formatCurrency(high.delta.debt.interest);
  const highCash = TalkPresentation.formatCurrency(high.delta.cash.ending);
  const helocInterest = TalkPresentation.formatCurrency(heloc.delta.debt.interest);
  const helocCash = TalkPresentation.formatCurrency(heloc.delta.cash.ending);
  const changeBlob = changes.join('\n');
  ok(presented.summary && changes.length === 2,
    'comparison summary keeps both already-published option consequences');
  ok(high.status === 'ready' && heloc.status === 'ready'
      && changeBlob.indexOf(highInterest) !== -1
      && changeBlob.indexOf(highCash) !== -1
      && changeBlob.indexOf(helocInterest) !== -1
      && changeBlob.indexOf(helocCash) !== -1
      && /changes by/.test(changeBlob),
    'comparison What changes reprints independently formatted Forecast cash and debt deltas');
  ok(!presented.cards.items.some(item => item.kind === 'note')
      && judged
      && unchanged.indexOf(TalkPresentation.SUMMARY_CLOSED.reprintsOnly) === -1
      && unchanged.indexOf('It does not change household balances.') === -1
      && unchanged.indexOf(TalkPresentation.SUMMARY_CLOSED.reprintsForecastChange) !== -1,
    'preference with Forecast deltas cannot fall back to reprint-only no-balance-change');
  if (judged && judged.verdict === 'PREFER') {
    ok(/PREFER/.test(knows)
        && /not a payment authority/.test(knows)
        && !/NOT YET \/ INDETERMINATE/.test(unknown),
      'PREFER stays an already-published owner-rule sentence, not a new recommendation');
  } else {
    ok(/NOT YET \/ INDETERMINATE/.test(unknown)
        && !/PREFER/.test(knows),
      'NOT YET / INDETERMINATE is what Atlas cannot determine, not a hidden winner');
  }
  ok(!/\baffordable\b/.test(blob)
      && !/you (?:may|can|should) (?:spend|pay|afford)/i.test(blob)
      && changes.every(body => presented.answer.indexOf(body) !== -1),
    'comparison summary does not convert uncertainty into permission');
}

console.log('\n=== 5. Why reprint and unavailable stay fail-closed ===');
{
  const packet = {
    metadata: { effectiveAsOf: '2026-09-14', freshness: { confidence: 'live' } },
    current: {
      nextSignificantObligations: {
        nextDue: {
          label: 'Insurance',
          amount: 312.5,
          date: '2026-09-18',
          daysUntil: 7,
          confidence: 'confirmed',
        },
      },
    },
  };
  const bill = TalkWhy.resolve({
    question: 'Why did this bill affect the plan?',
    packet,
  });
  const presentedWhy = TalkPresentation.presentWhyExplanation(bill, packet);
  const knows = sectionBodies(presentedWhy.summary, 'knows').join('\n');
  const unchanged = sectionBodies(presentedWhy.summary, 'unchanged').join('\n');
  ok(presentedWhy.summary
      && /already-published obligation/.test(knows)
      && /Insurance/.test(knows)
      && unchanged.indexOf(TalkPresentation.WHY_NOTE) !== -1
      && presentedWhy.citations.some(row => row.href === '/bills.html'),
    'why summary reprints already-published fields and keeps Bills citations');

  const missing = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: null }],
  }, {
    metadata: { effectiveAsOf: '2026-09-14' },
    forecast: { currentPeriodAction: { essentialRemaining: null, remainingClaim: 'unavailable' } },
  });
  const unknown = sectionBodies(missing.summary, 'unknown').join('\n');
  const risk = sectionBodies(missing.summary, 'risk').join('\n');
  ok(missing.answer === 'Current pay-period remaining is unavailable.'
      && unknown.indexOf(missing.answer) !== -1
      && risk.indexOf(TalkPresentation.SUMMARY_CLOSED.unavailableNotNumber) !== -1
      && !/\$0/.test(JSON.stringify(missing.summary))
      && !/0\.00/.test(JSON.stringify(missing.summary)),
    'unavailable remaining stays unavailable in the summary and does not invent zero');

  const dated = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'current.spendableHouseholdCash.value', value: 400 }],
  }, {
    metadata: { effectiveAsOf: '2026-09-14' },
    current: {
      spendableHouseholdCash: {
        value: 400,
        status: 'dated-opening',
        current: false,
        trust: 'dated-opening',
      },
    },
  });
  const datedBlob = JSON.stringify(dated.summary);
  ok(/not current spendable household cash/.test(sectionBodies(dated.summary, 'knows').join('\n'))
      && sectionBodies(dated.summary, 'risk').indexOf(
        TalkPresentation.SUMMARY_CLOSED.datedOpeningNotCurrent
      ) !== -1
      && !/verified/i.test(datedBlob)
      && !/\bsafe\b/.test(datedBlob),
    'dated opening is never labelled verified, current, or safe');
}

console.log('\n=== 6. Browser reprints summary; malformed summary keeps incumbent ===');
{
  const presented = TalkPresentation.presentVerifiedClaims({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', value: 1415.95 }],
  }, remainingPacket());
  const ui = loadTalkApi();
  const rendered = ui.talkAnswerNode(presented);
  const texts = summaryItemTexts(rendered);
  ok(/talk-bubble-summary/.test(rendered.className)
      && texts[0] === presented.answer
      && texts.indexOf(TalkPresentation.SUMMARY_CLOSED.noForecastChange) !== -1
      && rendered.children.some(child => child.className === 'talk-citations'),
    'browser renders the five-section summary and keeps citations');
  ok(ui.talkValidSummary(null) === null
      && ui.talkValidSummary({ version: 2, sections: presented.summary.sections }) === null
      && ui.talkValidSummary({
        version: 1,
        sections: presented.summary.sections.map(row => Object.assign({}, row, { title: 'Safe to spend' })),
      }) === null
      && ui.talkValidSummary({
        version: 1,
        sections: [{ key: 'knows', title: 'What Atlas knows', items: [{ body: 'ok' }] }],
      }) === null,
    'missing, version-mismatched, retitled, and incomplete summaries are unavailable');

  const malformed = ui.talkAnswerNode(Object.assign({}, presented, {
    summary: { version: 1, sections: [{ key: 'knows', title: 'What Atlas knows', items: [] }] },
  }));
  ok(/talk-bubble-cards/.test(malformed.className)
      && !/talk-bubble-summary/.test(malformed.className)
      && malformed.children[0].children[0].children[1].textContent === presented.answer,
    'malformed summary fails closed to the incumbent cards');

  const plain = ui.talkAnswerNode({
    answer: presented.answer,
    source: 'Forecast',
    trust: 'posted-only',
    asOf: '2026-09-14',
    freshness: 'live',
    action: { href: '/', label: 'View Budget' },
    summary: { version: 1, sections: [] },
  });
  ok(plain.children[0].textContent === presented.answer
      && !/talk-bubble-summary/.test(plain.className)
      && !/talk-bubble-cards/.test(plain.className),
    'malformed summary without cards fails closed to the same answer string');

  const reserved = {
    className: 'talk-summary',
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
  const reservedUi = loadTalkApi({ talkSummary: reserved });
  reservedUi.talkAnswerNode(presented);
  ok(reserved.hidden === false
      && reserved.children.length === 5
      && reserved.children[0].children[1].textContent === presented.answer,
    'trusted summary populates the reserved #talk-summary mount');
}

console.log('\n=== 7. Sanitizer and Gemini cannot invent summary authority ===');
{
  const trusted = TalkPresentation.sanitizeDecisionSummary({
    version: 1,
    sections: TalkPresentation.SUMMARY_SECTION_ORDER.map(key => ({
      key,
      title: TalkPresentation.SUMMARY_TITLES[key],
      items: [{ body: TalkPresentation.SUMMARY_CLOSED.packetOnly }],
    })),
  });
  ok(trusted && trusted.sections[4].items[0].body === TalkPresentation.SUMMARY_CLOSED.packetOnly,
    'a closed five-section summary is kept');
  ok(TalkPresentation.sanitizeDecisionSummary({
    version: 1,
    extra: 'winner',
    sections: trusted.sections,
  }) === null, 'unexpected summary keys fail closed');
  ok(TalkPresentation.sanitizeDecisionSummary({
    version: 1,
    sections: trusted.sections.map((row, index) => (
      index === 0
        ? { key: row.key, title: row.title, items: [{ body: 'ok', href: '/' }] }
        : row
    )),
  }) === null, 'summary items cannot carry a navigation or figure field');
  ok(TalkPresentation.sanitizeDecisionSummary({
    version: 1,
    sections: trusted.sections.map((row, index) => (
      index === 3
        ? { key: 'risk', title: 'Safe to spend', items: row.items }
        : row
    )),
  }) === null, 'invented section titles are rejected');

  const invented = TalkGemini.parseTalkModelOutput(JSON.stringify({
    status: 'explained',
    claims: [{ path: 'forecast.currentPeriodAction.essentialRemaining', equals: 1415.95 }],
    summary: {
      version: 1,
      sections: [{ key: 'knows', title: 'What Atlas knows', items: [{ body: 'Safe to spend $400' }] }],
    },
  }));
  ok(invented.ok === false && invented.reason === 'unexpected fields',
    'Gemini-invented summary fields fail closed as unexpected extract fields');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
