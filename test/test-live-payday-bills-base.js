'use strict';
/* Live-refresh Current Balance on a Dale/Seaspan payday.
 *
 * overlayLiveState stamps the fetch date onto the opening and replaces
 * the BILLS row before Forecast runs. The pre-payday base has to be
 * walked on the original plan first and kept only in memory.
 *
 * The numerical oracle adds the repo BILLS opening to the fixture's
 * posted movements, then adds planned payroll. It does not call
 * householdCurrentBalance or prePaydayBillsAccountCash.
 *
 * `node test/test-live-payday-bills-base.js`
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const Forecast = require('../public/forecast.js');
const Live = require('../scripts/live-plan.js');
const { sourceText } = require('./test-source-text');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data.json');
const PAYDAY = '2026-09-25';
const OPENING_AS_OF = '2026-08-19';
const GAP_START = '2026-08-20';
const GAP_THROUGH = '2026-09-24';
const PAYROLL = 4264;
const MOVEMENT_A = 400;
const MOVEMENT_B = 62.85;
const DOUBLED = 8694.42;

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const cents = n => Math.round(Number(n) * 100);
const fromCents = c => c / 100;
const add = (a, b) => fromCents(cents(a) + cents(b));
const clone = x => JSON.parse(JSON.stringify(x));
const read = file => sourceText(fs.readFileSync(path.join(ROOT, file), 'utf8'));

function grab(src, re, label) {
  const match = re.exec(src);
  if (!match) throw new Error('missing ' + label);
  return match[0];
}

function loadComposer() {
  const appSrc = read('public/app.js');
  const planSrc = read('public/plan.js');
  const source = [
    grab(appSrc, /^const money = .*$/m, 'money'),
    grab(appSrc, /^const money2 = .*$/m, 'money2'),
    grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
    grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
    grab(planSrc, /^function liveOperatingPlanUnavailable\([\s\S]*?\n\}$/m, 'liveOperatingPlanUnavailable'),
    grab(planSrc, /^function paydayGlanceCashNote\([\s\S]*?\n\}$/m, 'paydayGlanceCashNote'),
    grab(planSrc, /^function providerBalanceDate\([\s\S]*?\n\}$/m, 'providerBalanceDate'),
    grab(planSrc, /^function glanceUpdatedNote\([\s\S]*?\n\}$/m, 'glanceUpdatedNote'),
    grab(planSrc, /^function liveCurrentBalanceHtml\([\s\S]*?\n\}$/m, 'liveCurrentBalanceHtml'),
  ].join('\n');
  return vm.runInNewContext(
    `${source}\n({ liveCurrentBalanceHtml, money2 });`,
    { Forecast }
  );
}

function cashRow(data, id) {
  const rows = (data.plan && data.plan.startingCash && data.plan.startingCash.breakdown) || [];
  return rows.find(row => row && row.id === id) || null;
}

function round2(n) {
  return fromCents(cents(n));
}

const repo = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const repoHash = crypto.createHash('sha256').update(fs.readFileSync(DATA)).digest('hex');
const openingBills = Number(cashRow(repo, 'chequing-a').value);
const weekly = Number(cashRow(repo, 'chequing-b').value);
const savings = Number(cashRow(repo, 'savings').value);
const payrollRow = (repo.plan.income || []).find(row => row && row.id === 'payroll');
const movementDebit = add(MOVEMENT_A, MOVEMENT_B);
const walkedBase = add(openingBills, -movementDebit);
const assumed = add(walkedBase, PAYROLL);

function canonicalPlan() {
  return {
    meta: { asOf: OPENING_AS_OF },
    debts: [],
    plan: {
      defaults: { targetBuffer: 500 },
      startingCash: {
        breakdown: [
          { id: 'chequing-a', value: openingBills, label: 'BILLS ACCOUNT', class: 'spendable' },
          { id: 'chequing-b', value: weekly, label: 'WEEKLY SPENDING', class: 'spendable' },
          { id: 'savings', value: savings, label: 'EMERGENCY SAVING', class: 'spendable' },
        ],
      },
      opening: { asOf: OPENING_AS_OF, representedEvents: [] },
      income: [clone(payrollRow)],
      bills: [],
      obligations: [],
      commitments: [],
      budget: { categories: [] },
    },
  };
}

function gapTransactions(extra) {
  return [
    {
      id: 'gap-a',
      date: '2026-08-21',
      amount: MOVEMENT_A,
      pending: false,
      accountRole: 'household-cash',
      atlasAccountId: 'chequing-a',
    },
    {
      id: 'gap-b',
      date: '2026-09-10',
      amount: MOVEMENT_B,
      pending: false,
      accountRole: 'household-cash',
      atlasAccountId: 'chequing-a',
    },
  ].concat(extra || []);
}

function actualsPacket(opts) {
  opts = opts || {};
  return {
    schema: 'atlas-current-period-actuals/v1',
    coverageStart: opts.coverageStart || GAP_START,
    coverageThrough: opts.coverageThrough || PAYDAY,
    observationAsOf: opts.observationAsOf || PAYDAY,
    transactionCoverage: opts.transactionCoverage || 'complete',
    pendingCoverage: opts.pendingCoverage || 'complete',
    transactions: opts.transactions || gapTransactions(),
  };
}

function cashEvidence(id, canonicalValue, evidenceValue, evidenceDate) {
  const changed = !near(canonicalValue, evidenceValue);
  return {
    fact: 'posted-balance',
    status: changed ? 'CHANGE' : 'MATCH',
    canonicalTarget: 'cash:' + id,
    canonicalValue,
    evidenceValue,
    evidenceDate,
    dateRelation: changed ? 'canonical-older' : 'same-day',
    unknown: false,
  };
}

function reportFor(opts) {
  const observed = opts.observedBills;
  const asOf = opts.asOf;
  const fetchedAt = opts.fetchedAt;
  return {
    writesCanonicalState: false,
    fetchedAt,
    unmapped: [],
    mapped: [],
    representedEventCandidates: opts.represented || [],
    pendingCoverage: { complete: true, basis: 'is_pending-unbounded', hasMore: false },
    currentPeriodActuals: opts.actuals,
    reconciliation: {
      rows: [
        cashEvidence('chequing-a', openingBills, observed, asOf),
        cashEvidence('chequing-b', weekly, weekly, asOf),
        cashEvidence('savings', savings, savings, asOf),
      ],
    },
  };
}

function overlay(opts) {
  const data = canonicalPlan();
  const before = JSON.stringify(data);
  const result = Live.overlayLiveState({
    data,
    report: reportFor(opts),
  });
  return { data, before, result };
}

function published(overlaid) {
  const plan = overlaid.plan;
  const asOf = overlaid.meta && overlaid.meta.asOf;
  const overlayMeta = overlaid.liveOverlay || {};
  const advice = Forecast.recommend(plan, asOf, {
    debts: [],
    targetBuffer: 500,
    currentPeriodActuals: overlayMeta.currentPeriodActuals || null,
    operatingPlan: overlayMeta.operatingPlan,
  });
  const alloc = advice && advice.paydayAllocation;
  const view = advice && advice.defaultView;
  const period = ((view && view.calendarPeriods) || []).find(row => row && row.role === 'active');
  return {
    advice,
    alloc: alloc && alloc.liveCurrentBalance,
    view: view && view.liveCurrentBalance,
    period: period && period.liveCurrentBalance,
    publication: (alloc && alloc.currentBalancePublication)
      || (view && view.currentBalancePublication),
    active: period || null,
  };
}

function handWalk(transactions) {
  let balance = openingBills;
  for (const tx of transactions || []) {
    if (!tx || tx.pending === true) continue;
    if (tx.atlasAccountId !== 'chequing-a') continue;
    if (String(tx.date) < GAP_START || String(tx.date) > GAP_THROUGH) continue;
    const debit = Number(tx.amount);
    balance = add(balance, -debit);
  }
  return balance;
}

const composer = loadComposer();
const midnight = '2026-09-25T07:00:01.000Z';

console.log('=== 0. Fixture arithmetic is independent of Forecast ===');
{
  ok(repo.plan.opening.asOf === OPENING_AS_OF && repo.meta.asOf === OPENING_AS_OF,
    'repo opening as-of is 2026-08-19');
  ok(near(openingBills, 629.27), 'repo BILLS opening is 629.27', String(openingBills));
  ok(payrollRow && payrollRow.anchor === '2026-08-14' && near(payrollRow.amount, PAYROLL),
    'repo Dale payroll is the 4264 Seaspan stream');
  ok(near(movementDebit, 462.85), 'fixture gap debits total 462.85', String(movementDebit));
  ok(near(walkedBase, 166.42), 'hand walk is opening minus those debits', String(walkedBase));
  ok(near(assumed, 4430.42) && near(add(assumed, PAYROLL), DOUBLED),
    'hand assumption is 4430.42 and the double is 8694.42', String(assumed));
  ok(Forecast.financialDate(midnight) === PAYDAY,
    'payday midnight PT is the household payday');
  ok(Forecast.spendingCycle(canonicalPlan().plan, PAYDAY).start === PAYDAY,
    '2026-09-25 is the Seaspan cycle start');
  const walked = Forecast.postedAccountMovements(canonicalPlan().plan, 'chequing-a', {
    start: GAP_START,
    through: GAP_THROUGH,
  }, { currentPeriodActuals: actualsPacket() });
  const movementSum = (walked.movements || []).reduce((s, row) => add(s, row.amount), 0);
  ok(walked.complete === true && near(add(openingBills, movementSum), handWalk(gapTransactions())),
    'postedAccountMovements agrees with the hand walk', String(movementSum));
}

console.log('\n=== a. Payday midnight, deposit not yet posted ===');
{
  const txs = gapTransactions();
  const { data, before, result } = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: walkedBase,
    actuals: actualsPacket({ transactions: txs }),
  });
  const next = result.data;
  const base = next.plan.opening.prePaydayBillsBase;
  const pub = published(next);
  ok(JSON.stringify(data) === before, 'overlay does not mutate the canonical input');
  ok(repoHash === crypto.createHash('sha256').update(fs.readFileSync(DATA)).digest('hex'),
    'data.json bytes are unchanged');
  ok(base && near(base.amount, handWalk(txs)) && base.coverageComplete === true
      && base.fromAsOf === OPENING_AS_OF && base.through === GAP_THROUGH
      && base.payday === PAYDAY && base.accountId === 'chequing-a',
    'in-memory base is the walked pre-payday BILLS stock', JSON.stringify(base));
  ok(near(cashRow(next, 'chequing-a').value, walkedBase)
      && near(cashRow(data, 'chequing-a').value, openingBills),
    'the BILLS row is the same-day observation; the repo opening stays');
  ok(next.plan.opening.asOf === PAYDAY && next.plan.opening.priorAsOf === OPENING_AS_OF,
    'live cutover still stamps the fetch date');
  ok(near(pub.alloc, assumed) && near(pub.view, assumed) && near(pub.period, assumed),
    'Current Balance is walked base plus planned payroll', String(pub.alloc));
  ok(pub.publication && pub.publication.status === 'planned-dale-payday'
      && near(pub.publication.prePaydayBills, walkedBase)
      && near(pub.publication.assumedDalePayroll, PAYROLL)
      && pub.publication.providerConfirmed === false
      && pub.publication.note === 'Includes planned Dale payday +$4,264.00 awaiting bank update',
    'the publication is the planned Dale payday result');
  ok(!near(pub.alloc, DOUBLED) && near(pub.publication.prePaydayBills, walkedBase),
    'planned payroll is added once, to the walked base');
  const html = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: pub.view, currentBalancePublication: pub.publication },
    null,
    { liveCurrentBalance: pub.alloc, currentBalancePublication: pub.publication }
  );
  ok(html.includes(composer.money2(assumed)) && html.includes(pub.publication.note),
    'the Budget page reprints the Forecast figure and note');
  const active = pub.active || {};
  ok(near(active.incomeTotal, PAYROLL) && near(active.available, active.incomeTotal)
      && !near(active.available, assumed)
      && near(active.balanceAfterDeductions, active.incomeTotal),
    'Payday balance and Balance After Deductions stay the income identity',
    String(active.available) + ' / ' + String(active.balanceAfterDeductions));
  const notRelied = (next.plan.opening.notReliedUponEvents || [])
    .some(row => row && row.id === 'payroll' && row.date === PAYDAY);
  ok(notRelied, 'unrepresented Seaspan payroll stays on notReliedUponEvents');
  const stripped = clone(next);
  delete stripped.plan.opening.prePaydayBillsBase;
  const without = published(stripped);
  ok(without.alloc == null && without.publication.status === 'unavailable',
    'without the retain the same refresh still fails closed', String(without.alloc));
}

console.log('\n=== b. Deposit landed, not yet recognised as Seaspan payroll ===');
{
  const landed = assumed;
  const { result } = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: landed,
    actuals: actualsPacket(),
  });
  const next = result.data;
  const pub = published(next);
  ok(near(cashRow(next, 'chequing-a').value, landed),
    'the refreshed BILLS row already includes the deposit', String(cashRow(next, 'chequing-a').value));
  ok(near(next.plan.opening.prePaydayBillsBase.amount, walkedBase),
    'the retain is still the pre-deposit walk');
  ok(!(next.plan.opening.representedEvents || []).some(row => row && row.id === 'payroll' && row.date === PAYDAY),
    'payroll is not represented');
  ok(near(pub.alloc, assumed) && near(pub.view, assumed)
      && pub.publication.status === 'planned-dale-payday',
    'Current Balance stays walked base plus planned payroll', String(pub.alloc));
  ok(!near(pub.alloc, add(landed, PAYROLL)) && !near(pub.alloc, DOUBLED),
    'planned payroll is not added to the refreshed balance');
}

console.log('\n=== c. Incomplete gap-day coverage fails closed ===');
{
  const { result } = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: walkedBase,
    actuals: actualsPacket({ coverageStart: '2026-08-21' }),
  });
  const next = result.data;
  const pub = published(next);
  ok(!next.plan.opening.prePaydayBillsBase,
    'incomplete coverage stores no pre-payday base');
  ok(pub.alloc == null && pub.view == null && pub.period == null
      && pub.publication.status === 'unavailable',
    'Current Balance is unavailable', String(pub.alloc));
  const html = composer.liveCurrentBalanceHtml(
    { liveCurrentBalance: pub.view, currentBalancePublication: pub.publication },
    null,
    { liveCurrentBalance: pub.alloc, currentBalancePublication: pub.publication }
  );
  ok(html.includes('—') && !html.includes(composer.money2(assumed))
      && !/awaiting bank update/.test(html),
    'the page prints an em dash');
  const truncated = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: walkedBase,
    actuals: actualsPacket({ transactionCoverage: 'incomplete' }),
  });
  const truncatedPub = published(truncated.result.data);
  ok(!truncated.result.data.plan.opening.prePaydayBillsBase
      && truncatedPub.alloc == null,
    'truncated posted coverage also stores nothing');
}

console.log('\n=== d. Recognised deposit is observed BILLS cash ===');
{
  const observed = 4500.15;
  const { result } = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: observed,
    represented: [{ id: 'payroll', date: PAYDAY }],
    actuals: actualsPacket(),
  });
  const next = result.data;
  const pub = published(next);
  ok((next.plan.opening.representedEvents || []).some(row => row && row.id === 'payroll' && row.date === PAYDAY),
    'payroll is represented');
  ok(near(pub.alloc, observed) && near(pub.view, observed)
      && pub.publication.status === 'provider-confirmed'
      && pub.publication.assumedDalePayroll == null
      && !pub.publication.note,
    'observed BILLS cash replaces the assumption', String(pub.alloc));
  ok(!near(pub.alloc, add(observed, PAYROLL)) && !near(pub.alloc, assumed),
    'planned payroll is not added to the recognised balance');
}

console.log('\n=== e. Non-payday behaviour is unchanged ===');
{
  const observed = 200.5;
  const cases = [
    ['2026-09-24', '2026-09-24T07:00:01.000Z', 'the day before payday'],
    ['2026-09-15', '2026-09-15T07:00:01.000Z', 'Amanda salary day'],
    ['2026-09-20', '2026-09-20T07:00:01.000Z', 'child-benefit day'],
  ];
  for (const [asOf, fetchedAt, label] of cases) {
    const { result } = overlay({
      asOf,
      fetchedAt,
      observedBills: observed,
      actuals: actualsPacket({
        coverageThrough: asOf,
        observationAsOf: asOf,
      }),
    });
    const next = result.data;
    const pub = published(next);
    ok(Forecast.financialDate(fetchedAt) === asOf, label + ' fetch date');
    ok(Forecast.spendingCycle(next.plan, asOf).start !== asOf, label + ' is not the cycle start');
    ok(!next.plan.opening.prePaydayBillsBase, label + ' does not retain a payday base');
    ok(near(pub.alloc, observed) && pub.publication.status === 'provider-confirmed'
        && pub.publication.assumedDalePayroll == null,
      label + ' publishes the posted BILLS row', String(pub.alloc));
  }
}

console.log('\n=== f. The 8694.42 double stays impossible ===');
{
  const landed = assumed;
  const { result } = overlay({
    asOf: PAYDAY,
    fetchedAt: midnight,
    observedBills: landed,
    actuals: actualsPacket({
      transactions: gapTransactions([{
        id: 'unlisted-deposit',
        date: PAYDAY,
        amount: -PAYROLL,
        pending: false,
        accountRole: 'household-cash',
        atlasAccountId: 'chequing-a',
      }]),
    }),
  });
  const next = result.data;
  const pub = published(next);
  ok(near(pub.alloc, assumed) && !near(pub.alloc, DOUBLED) && !near(pub.alloc, add(landed, PAYROLL)),
    'a payday deposit movement is not added again on top of the walk', String(pub.alloc));
  ok(near(pub.publication.prePaydayBills, walkedBase),
    'the base excludes the payday deposit');
  const forged = clone(next);
  forged.plan.opening.prePaydayBillsBase = {
    payday: PAYDAY,
    accountId: 'chequing-a',
    amount: landed,
    fromAsOf: PAYDAY,
    through: GAP_THROUGH,
    coverageComplete: true,
  };
  const forgedPub = published(forged);
  ok(forgedPub.alloc == null || !near(forgedPub.alloc, add(landed, PAYROLL)),
    'a same-day fromAsOf is not a pre-payday base');
  const incompleteFlag = clone(next);
  incompleteFlag.plan.opening.prePaydayBillsBase.coverageComplete = false;
  const flagged = published(incompleteFlag);
  ok(flagged.alloc == null, 'coverageComplete false fails closed');
}

if (failures) {
  console.log('\nFAILED ' + failures);
  process.exit(1);
}
console.log('\nALL PASS');
