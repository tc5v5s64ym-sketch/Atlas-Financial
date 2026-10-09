'use strict';
// The Budget river reads ol[data-bad-timeline]. Past rows stay only when
// data-bad-timeline-coverage is precise or posted-only. Current and future
// rows stay. The gate does not read terms, trust, or amounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const script = name => fs.readFileSync(path.join(root, 'public', name + '.js'), 'utf8');
const stub = () => ({
  innerHTML: '', value: '', dataset: {}, style: {},
  classList: { add() {}, remove() {}, toggle() {} },
  addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  appendChild() {}, replaceChildren() {},
});
const context = vm.createContext({
  Forecast: {}, console, setTimeout, clearTimeout, addEventListener() {},
  document: {
    getElementById: stub, querySelectorAll() { return []; }, addEventListener() {},
    documentElement: { dataset: {}, style: {} },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  location: { pathname: '/', search: '' },
});
context.window = context;
context.matchMedia = () => ({ matches: false, addEventListener() {} });
vm.runInContext(script('app'), context);
vm.runInContext('App.boot=()=>{};', context);
for (const name of ['bill-detail', 'savings-inventory', 'budget-surface', 'plan']) {
  vm.runInContext(script(name), context);
}

global.document = {
  readyState: 'complete',
  getElementById() { return null; },
  addEventListener() {},
  querySelector() { return null; },
  documentElement: { getAttribute() { return null; }, setAttribute() {}, removeAttribute() {} },
};
global.matchMedia = () => ({ matches: false });
const { keepPastTimelineNode, readBadTimeline, knownTimelineRuns, chooseBadTimeline } = require('../public/budget-blend.js');

function period(role, start, end, claim, extra) {
  const row = {
    id: start,
    timelineRole: role,
    start,
    end,
    predictedEndingBalanceTerms: {
      identity: 'balance-after-deductions',
      closes: true,
      balanceAfterDeductions: extra && extra.amount != null ? extra.amount : 10,
    },
    balanceAfterDeductionsTrust: extra && extra.trust ? extra.trust : 'estimated',
  };
  if (arguments.length >= 4 && claim !== undefined) {
    row.budgetProgress = { coverage: { remainingClaim: claim } };
  }
  return row;
}

function printed(rows) {
  context.rows = rows;
  return vm.runInContext('badTimelineHtml({payPeriodViews:rows}, false, null)', context);
}

function items(html) {
  const list = html.match(/<ol data-bad-timeline[\s\S]*?<\/ol>/);
  assert.ok(list, 'one timeline list');
  return [...list[0].matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].map(match => {
    const attrs = {};
    for (const attr of match[1].matchAll(/([^\s=]+)="([^"]*)"/g)) attrs[attr[1]] = attr[2];
    return {
      tagName: 'LI',
      attrs,
      body: match[2],
      querySelector(selector) {
        if (selector !== '[data-bad-term-amount]') return null;
        const amount = this.body.match(/<span data-bad-term-amount>([\s\S]*?)<\/span>/);
        return amount ? { textContent: amount[1] } : null;
      },
      getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
      },
    };
  });
}

const blend = fs.readFileSync(path.join(root, 'public', 'budget-blend.js'), 'utf8');
const gateSource = blend.match(/function keepPastTimelineNode\(li\) \{[\s\S]*?\n  \}/)[0];
assert.match(gateSource, /data-bad-timeline-role/);
assert.match(gateSource, /data-bad-timeline-coverage/);
assert.doesNotMatch(gateSource, /trust|amount|data-sign|data-bad-term|\b(?:6|26|33)\b/);
assert.match(blend, /keepPastTimelineNode\(node\)/);

// One past row for each coverage value the printer can emit, plus the
// claims it omits. Amounts and trust differ so they cannot be the reason.
const matrixRows = [
  period('past', '2026-01-02', '2026-01-15', 'precise', { amount: 9999.99, trust: 'unavailable' }),
  period('past', '2026-01-16', '2026-01-29', 'posted-only', { amount: -50 }),
  period('past', '2026-01-30', '2026-02-12', 'unavailable', { amount: -1020.09 }),
  period('past', '2026-02-13', '2026-02-26', undefined, { amount: 4000 }),
  period('past', '2026-02-27', '2026-03-12', '', { amount: 4000 }),
  period('past', '2026-03-13', '2026-03-26', null, { amount: 4000 }),
  period('past', '2026-03-27', '2026-04-09', 'full', { amount: 4000 }),
  period('past', '2026-04-10', '2026-04-23', 'Precise', { amount: 1 }),
  period('past', '2026-04-24', '2026-05-07', ' precise', { amount: 1 }),
  period('current', '2026-05-08', '2026-05-21', 'unavailable', { amount: -1 }),
  period('future', '2026-05-22', '2026-06-04', 'unavailable', { amount: 2 }),
  period('current', '2026-06-05', '2026-06-18'),
  period('future', '2026-06-19', '2026-07-02', 'full', { amount: -9 }),
  period('next', '2026-07-03', '2026-07-16', 'unavailable'),
];
const matrix = items(printed(matrixRows));
assert.equal(matrix.length, matrixRows.length, 'printer keeps every row');
const coverageOf = start => {
  const row = matrix.find(item => item.getAttribute('data-bad-timeline-start') === start);
  assert.ok(row, start);
  return row.getAttribute('data-bad-timeline-coverage');
};
assert.equal(coverageOf('2026-01-02'), 'precise');
assert.equal(coverageOf('2026-01-16'), 'posted-only');
assert.equal(coverageOf('2026-01-30'), 'unavailable');
assert.equal(coverageOf('2026-03-27'), 'full');
assert.equal(coverageOf('2026-04-10'), 'Precise');
for (const start of ['2026-02-13', '2026-02-27', '2026-03-13', '2026-06-05']) {
  assert.equal(coverageOf(start), null, start + ' omits coverage');
}
const keptMatrix = matrix.filter(keepPastTimelineNode).map(item => item.getAttribute('data-bad-timeline-start'));
assert.deepEqual(keptMatrix, [
  '2026-01-02', '2026-01-16', '2026-05-08', '2026-05-22', '2026-06-05', '2026-06-19', '2026-07-03',
]);
assert.equal(matrix.find(item => item.getAttribute('data-bad-timeline-start') === '2026-07-03').getAttribute('data-bad-timeline-role'), 'future');
assert.match(matrix.find(item => item.getAttribute('data-bad-timeline-start') === '2026-01-02').body, /Unavailable<span data-bad-term-amount><\/span>/);
assert.equal(matrix.find(item => item.getAttribute('data-bad-timeline-start') === '2026-01-30').getAttribute('data-sign'), 'negative');

// Oct 8 pay-period calendar. Coverage is the Engine print: Jul 3, Jul 17
// and Jul 31 are unavailable; Aug 14, Aug 28 and Sep 11 are precise.
// Current and future coverage stays unavailable.
const oct8Spec = [
  ['past', '2026-07-03', '2026-07-16', 'unavailable'],
  ['past', '2026-07-17', '2026-07-30', 'unavailable'],
  ['past', '2026-07-31', '2026-08-13', 'unavailable'],
  ['past', '2026-08-14', '2026-08-27', 'precise'],
  ['past', '2026-08-28', '2026-09-10', 'precise'],
  ['past', '2026-09-11', '2026-09-24', 'precise'],
  ['current', '2026-09-25', '2026-10-08', 'unavailable'],
  ['next', '2026-10-09', '2026-10-22', 'unavailable'],
  ['future', '2026-10-23', '2026-11-05', 'unavailable'],
  ['future', '2026-11-06', '2026-11-19', 'unavailable'],
  ['future', '2026-11-20', '2026-12-03', 'unavailable'],
  ['future', '2026-12-04', '2026-12-17', 'unavailable'],
  ['future', '2026-12-18', '2026-12-31', 'unavailable'],
  ['future', '2027-01-01', '2027-01-14', 'unavailable'],
  ['future', '2027-01-15', '2027-01-28', 'unavailable'],
  ['future', '2027-01-29', '2027-02-11', 'unavailable'],
  ['future', '2027-02-12', '2027-02-25', 'unavailable'],
  ['future', '2027-02-26', '2027-03-11', 'unavailable'],
  ['future', '2027-03-12', '2027-03-25', 'unavailable'],
  ['future', '2027-03-26', '2027-04-08', 'unavailable'],
  ['future', '2027-04-09', '2027-04-22', 'unavailable'],
  ['future', '2027-04-23', '2027-05-06', 'unavailable'],
  ['future', '2027-05-07', '2027-05-20', 'unavailable'],
  ['future', '2027-05-21', '2027-06-03', 'unavailable'],
  ['future', '2027-06-04', '2027-06-17', 'unavailable'],
  ['future', '2027-06-18', '2027-07-01', 'unavailable'],
  ['future', '2027-07-02', '2027-07-15', 'unavailable'],
  ['future', '2027-07-16', '2027-07-29', 'unavailable'],
  ['future', '2027-07-30', '2027-08-12', 'unavailable'],
  ['future', '2027-08-13', '2027-08-26', 'unavailable'],
  ['future', '2027-08-27', '2027-09-09', 'unavailable'],
  ['future', '2027-09-10', '2027-09-23', 'unavailable'],
  ['future', '2027-09-24', '2027-10-07', 'unavailable'],
];
assert.equal(oct8Spec.length, 33);
const oct8 = items(printed(oct8Spec.map(row => period(row[0], row[1], row[2], row[3]))));
assert.equal(oct8.length, 33, 'Oct 8 print keeps all 33 rows');
const keptOct8 = oct8.filter(keepPastTimelineNode);
assert.deepEqual(keptOct8.map(item => item.getAttribute('data-bad-timeline-start')), [
  '2026-08-14', '2026-08-28', '2026-09-11', '2026-09-25',
  '2026-10-09', '2026-10-23', '2026-11-06', '2026-11-20',
  '2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15', '2027-01-29',
  '2027-02-12', '2027-02-26', '2027-03-12', '2027-03-26', '2027-04-09',
  '2027-04-23', '2027-05-07', '2027-05-21', '2027-06-04', '2027-06-18',
  '2027-07-02', '2027-07-16', '2027-07-30', '2027-08-13', '2027-08-27',
  '2027-09-10', '2027-09-24',
]);
assert.deepEqual(keptOct8.map(item => item.getAttribute('data-bad-timeline-role')), [
  'past', 'past', 'past', 'current',
  ...Array(26).fill('future'),
]);
assert.deepEqual(
  oct8.filter(item => !keepPastTimelineNode(item)).map(item => item.getAttribute('data-bad-timeline-start')),
  ['2026-07-03', '2026-07-17', '2026-07-31'],
);

// Independent display contract: missing publications break a line, even
// when an omitted past row makes the two known labels visually adjacent.
const gapRows = [
  period('past', '2026-05-08', '2026-05-21', 'precise', { amount: 100 }),
  period('past', '2026-05-22', '2026-06-04', 'unavailable', { amount: 900 }),
  period('past', '2026-06-05', '2026-06-18', 'posted-only', { amount: 50 }),
  period('current', '2026-06-19', '2026-07-02', 'unavailable', { amount: 9000, trust: 'unavailable' }),
  period('future', '2026-07-03', '2026-07-16', undefined, { amount: 0, trust: 'calculated' }),
  period('future', '2026-07-17', '2026-07-30', undefined, { amount: -20 }),
  period('future', '2026-07-31', '2026-08-13', undefined, { amount: 55 }),
  period('future', '2026-08-14', '2026-08-27', undefined, { amount: 40 }),
];
const gapItems = items(printed(gapRows));
gapItems[6].body = '<span data-bad-term-amount> </span>';
const gapModel = readBadTimeline({ querySelector() { return { children: gapItems }; } });
assert.deepEqual(gapModel.nodes.map(node => node.sourceIndex), [0, 2, 3, 4, 5, 6, 7],
  'adapter retains original publication positions after filtering');
assert.deepEqual(gapModel.nodes.map(node => node.magnitude), [100, 50, null, 0, -20, null, 40],
  'unavailable and empty spans have no geometry; printed zero is known');
assert.deepEqual(knownTimelineRuns(gapModel.nodes), [[0], [1], [3, 4], [6]],
  'only the adjacent published zero and negative value can share a line');
assert.deepEqual(knownTimelineRuns([
  { sourceIndex: 0, magnitude: null }, { sourceIndex: 1, magnitude: NaN },
  { sourceIndex: 2, magnitude: Infinity },
]), [], 'an entirely unknown timeline has no line');
for (const [label, magnitude] of [
  ['$20.00', 20], ['-$20.00', -20], ['\u2212$20.00', -20], ['$1,020.09', 1020.09],
  ['', null], [' ', null], ['Unavailable', null], ['estimated $20.00', null],
  ['$1,00.00', null], ['20.00', null], ['$20', null], ['$20.00 extra', null],
]) {
  const item = { ...gapItems[4], body: '<span data-bad-term-amount>' + label + '</span>' };
  const model = readBadTimeline({ querySelector() { return { children: [item] }; } });
  assert.equal(model.nodes[0].magnitude, magnitude, 'strict displayed currency geometry for ' + JSON.stringify(label));
}

// Native movement uses every published period, including a past row hidden
// from this strip. Navigate through the real native selection function and
// require the clicked start, not the adjacent visible label, to be selected.
const savedQuery = global.document.querySelector;
let currentStart = '2026-07-03';
let stepCount = 0;
let monthMode = false;
context.gapRows = gapRows;
global.document.querySelector = selector => {
  if (selector === '[data-budget-window-progress]') return { getAttribute() { return currentStart; } };
  if (selector === '.budget-window-eyebrow') return { textContent: monthMode ? 'Calendar month' : 'Pay period' };
  const step = /^\[data-budget-window-step="(-?1)"\]$/.exec(selector);
  if (!step) return null;
  return {
    getAttribute() { return 'false'; },
    click() {
      context.requestedStart = currentStart;
      context.requestedStep = Number(step[1]);
      currentStart = vm.runInContext('payPeriodMoveSelection({payPeriodViews:gapRows}, requestedStart, requestedStep).period.start', context);
      stepCount++;
    },
  };
};
try {
  chooseBadTimeline(0, gapModel);
  assert.equal(currentStart, '2026-05-08', 'backward click reaches the exact target across a filtered past gap');
  assert.equal(stepCount, 4, 'native navigation still traverses all four source periods');
  stepCount = 0;
  chooseBadTimeline(6, gapModel);
  assert.equal(currentStart, '2026-08-14', 'forward click reaches the exact target across filtered and unavailable rows');
  assert.equal(stepCount, 7);
  monthMode = true;
  chooseBadTimeline(0, gapModel);
  assert.equal(stepCount, 7, 'river does not change native selection in month mode');
} finally {
  global.document.querySelector = savedQuery;
}

console.log('bad timeline river: existing past coverage gate preserved; missing publications and filtered source gaps break geometry; printed zero stays known; navigation reaches the exact native target across gaps');
