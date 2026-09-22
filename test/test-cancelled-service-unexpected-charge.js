'use strict';
/* Owner-confirmed cancelled services remain absent from plan.bills, while a
 * later posted debit is counted once through the incumbent Other Spending
 * reconciliation and disclosed on the existing Plan drill-down.
 *
 * `node test/test-cancelled-service-unexpected-charge.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const data = JSON.parse(read('data.json'));
const AS_OF = '2026-09-22';
const BOUNDARY = '2026-09-21';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function planFixture() {
  return {
    defaults: { targetBuffer: 500 },
    cancelledServices: clone(data.plan.cancelledServices),
    startingCash: {
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: 8000 }],
    },
    opening: { asOf: AS_OF, priorAsOf: '2026-09-10', representedEvents: [] },
    income: [{
      id: 'payroll', label: 'Payroll — Seaspan', frequency: 'biweekly',
      anchor: '2026-09-10', amount: 4264, confidence: 'confirmed',
    }],
    bills: [{
      id: 'netflix', label: 'Netflix', frequency: 'monthly', day: 17,
      amount: 26.87, confidence: 'confirmed', budgetCategory: 'subscriptions',
      payingAccount: 'chequing-a',
    }],
    obligations: [],
    commitments: [],
    budget: {
      categories: [
        { id: 'groceries', label: 'Groceries', class: 'essential', plannedWeekly: 450 },
        { id: 'fuel', label: 'Fuel', class: 'essential', from: ['Fuel'], plannedPayday: 325 },
        { id: 'household', label: 'Household', class: 'essential', plannedPayday: 0 },
        { id: 'pets', label: 'Pets', class: 'essential', plannedPayday: 100 },
        { id: 'restaurants', label: 'Dining', class: 'discretionary', from: ['Restaurants'], plannedPayday: 200 },
        { id: 'dale-guilt-free', label: 'Dale guilt-free', class: 'discretionary', plannedPayday: 150 },
        { id: 'amanda-guilt-free', label: 'Amanda guilt-free', class: 'discretionary', plannedPayday: 150 },
        { id: 'subscriptions', label: 'Subscriptions', class: 'essential', from: ['Subscriptions'] },
      ],
      excluded: [{ from: 'Business', why: 'not household' }],
    },
  };
}

function tx(id, merchant, amount, extra) {
  return Object.assign({
    id,
    date: AS_OF,
    amount,
    pending: false,
    categoryLabel: 'Subscriptions',
    accountRole: 'revolving-credit',
    atlasAccountId: 'travelvisa',
    account: 'travelvisa',
    displayedPayee: merchant,
    originalMerchant: merchant,
  }, extra || {});
}

function packet(transactions) {
  return {
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: AS_OF,
    coverageStart: '2026-09-10',
    coverageThrough: AS_OF,
    pendingCoverage: 'complete',
    transactionCoverage: 'complete',
    representedActuals: [],
    transactions,
  };
}

function period(advice) {
  return ((advice.defaultView && advice.defaultView.calendarPeriods) || [])
    .find(row => row.id === 'this-pay-period');
}

function otherRow(advice) {
  return ((period(advice) && period(advice).householdBudget) || [])
    .find(row => row && row.otherSpending) || null;
}

function advise(plan, transactions) {
  return F.recommend(plan, AS_OF, {
    targetBuffer: 500,
    debts: [],
    currentPeriodActuals: packet(transactions),
  });
}

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadMetricComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(planSrc, /^function householdBudgetMetric\([\s\S]*?\n\}$/m, 'householdBudgetMetric'),
  ].join('\n');
  return vm.runInNewContext(`${source}\n({ householdBudgetMetric });`);
}

const merchantCases = [
  ['mailchimp', 'MAILCHIMP *M123'],
  ['calendly', 'CALENDLY'],
  ['aichatapp', 'AICHATAPP+18888287054'],
  ['pixieset', 'PIXIESET'],
];

console.log('=== 1. explicit owner-confirmed merchant identities only ===');
{
  const plan = planFixture();
  const configured = new Set((plan.cancelledServices || []).map(row => row.id));
  ok(merchantCases.every(([id]) => configured.has(id)) && configured.size === 4,
    'the runtime list is exactly the four owner-confirmed services');
  for (const [id, merchant] of merchantCases) {
    const cls = F.classifyCurrentPeriodTransaction(tx('tx-' + id, merchant, 10), plan);
    ok(cls.unexpectedStatus === 'cancelled-service-charge'
        && cls.cancelledServiceId === id
        && cls.householdSpending === true
        && cls.needsConfirmation === true,
      `${merchant} is recognized as a posted cancelled-service charge`);
  }
}

console.log('\n=== 2. boundary, active subscription, and unrelated text fail closed ===');
{
  const plan = planFixture();
  const historical = F.classifyCurrentPeriodTransaction(
    tx('tx-old-mailchimp', 'MAILCHIMP', 31.73, { date: BOUNDARY }), plan);
  ok(historical.unexpectedStatus == null && historical.kind === 'bill',
    'same-day and earlier history receives no retroactive warning');
  const active = F.classifyCurrentPeriodTransaction(
    tx('tx-netflix', 'NETFLIX', 26.87), plan);
  ok(active.unexpectedStatus == null && active.kind === 'bill',
    'ordinary active subscription does not receive cancelled-service status');
  for (const merchant of ['NOTMAILCHIMP', 'MY CALENDLY CONSULTING', 'AICHATAPPLICATION', 'ACME PIXIESETUP']) {
    const cls = F.classifyCurrentPeriodTransaction(tx('tx-decoy-' + merchant, merchant, 9), plan);
    ok(cls.unexpectedStatus == null,
      `unrelated merchant text does not trigger: ${merchant}`);
  }
}

console.log('\n=== 3. posted debit is Other Spending once and carries disclosure status ===');
{
  const plan = planFixture();
  const rows = merchantCases.map(([id, merchant], index) => tx('tx-' + id, merchant, (index + 1) * 10));
  const other = otherRow(advise(plan, rows));
  const independent = roundCent(rows.reduce((sum, row) => sum + row.amount, 0));
  const reconSum = roundCent(((other && other.recon) || []).reduce(
    (sum, row) => sum + Number(row.amount || 0), 0));
  ok(other && near(other.spent, independent) && near(other.hold, independent)
      && near(reconSum, independent),
    'Other Spending spent/hold/recon independently reconcile to $100 once',
    JSON.stringify({ spent: other && other.spent, hold: other && other.hold, reconSum }));
  ok(other && other.recon.length === 4
      && other.recon.every(row => row.unexpectedStatus === 'cancelled-service-charge'),
    'each recon row preserves the cancelled-service unexpected status');
  const html = loadMetricComposer().householdBudgetMetric('Spent', other.spent, {
    recon: other.recon,
    id: other.id,
  });
  ok((html.match(/Unexpected charge from cancelled service/g) || []).length === 4
      && /Unexpected charge from cancelled service: AICHATAPP/.test(html),
    'the incumbent Spent drill-down visibly identifies the unexpected charge');
}

console.log('\n=== 4. pending to posted reconciliation remains one economic charge ===');
{
  const plan = planFixture();
  const posted = tx('tx-ai-posted', 'AICHATAPP+18888287054', 44.99, {
    pendingPostedDuplicate: true,
  });
  const pending = tx('tx-ai-pending', 'AICHATAPP+18888287054', 44.99, {
    pending: true,
    pendingTreatment: 'unresolved',
    pendingPostedDuplicate: true,
  });
  const other = otherRow(advise(plan, [posted, pending]));
  ok(other && near(other.spent, 44.99) && near(other.hold, 44.99)
      && other.recon.length === 1
      && other.recon[0].id === 'tx-ai-posted',
    'posted side is counted once; unresolved pending mate is not a second charge',
    JSON.stringify(other && { spent: other.spent, recon: other.recon.map(row => row.id) }));
}

console.log('\n=== 5. provider sanitizer preserves the incumbent path and remains read-only ===');
{
  const plan = planFixture();
  const accountMap = {
    mappings: [{
      providerAccountId: '3006',
      atlasRole: 'revolving-credit',
      canonical: { collection: 'debts', id: 'travelvisa' },
    }],
  };
  const report = {
    fetchedAt: '2026-09-22T20:00:00.000Z',
    transactionWindow: {
      startDate: '2026-09-10', endDate: AS_OF, complete: true, truncated: false,
    },
    pendingCoverage: { complete: true, status: 'complete' },
    collapsedTransactions: [{
      date: AS_OF,
      amount: 19.17,
      pending: false,
      categoryLabel: 'Subscriptions',
      payee: 'CALENDLY',
      originalName: 'CALENDLY',
      providerAccountId: '3006',
      providerTransactionId: 'provider-calendly-1',
    }],
    representedEventCandidates: [],
  };
  const before = JSON.stringify(plan);
  const sanitized = O.sanitizedCurrentPeriodActuals(report, {
    asOf: AS_OF, plan, accountMap,
  });
  const observed = sanitized.transactions && sanitized.transactions[0];
  const cls = F.classifyCurrentPeriodTransaction(observed, plan, {
    packet: sanitized, currentPeriodActuals: sanitized,
  });
  ok(observed && observed.displayedPayee === 'CALENDLY'
      && cls.unexpectedStatus === 'cancelled-service-charge',
    'read-only provider observation preserves merchant identity into Forecast');
  ok(JSON.stringify(plan) === before,
    'provider sanitization makes no plan or Lunch Money write');
}

console.log('\n=== 6. cancelled services remain absent from plan.bills ===');
{
  const forbidden = new Set(merchantCases.map(([id]) => id));
  const hits = (data.plan.bills || []).filter(row => {
    const identity = String((row && row.id) || '').toLowerCase();
    const label = String((row && row.label) || '').toLowerCase();
    return forbidden.has(identity)
      || /mailchimp|calendly|aichatapp|pixieset/.test(identity + ' ' + label);
  });
  ok(hits.length === 0,
    'Mailchimp, Calendly, AICHATAPP, and Pixieset have no plan.bills row');
  ok((data.plan.bills || []).some(row => row.id === 'amazon-prime')
      && (data.plan.bills || []).some(row => row.id === 'chatgpt-plus-dale')
      && (data.plan.bills || []).some(row => row.id === 'chatgpt-plus-amanda'),
    'incumbent active subscription policy remains present');
}

if (failures) {
  console.error(`\n${failures} cancelled-service unexpected-charge check(s) failed.`);
  process.exit(1);
}
console.log('\nAll cancelled-service unexpected-charge checks passed.');
