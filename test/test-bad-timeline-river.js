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
const { keepPastTimelineNode } = require('../public/budget-blend.js');

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
      attrs,
      body: match[2],
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

console.log('bad timeline river: past precise and posted-only stay; unavailable, missing, and other past coverage is off the strip; Oct 8 keeps Aug 14, Aug 28, Sep 11, current, and 26 future nodes');
