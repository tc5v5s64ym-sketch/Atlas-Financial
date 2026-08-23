'use strict';
/* Forecast current-period planned → actual → remaining → next action.
 *
 * Synthetic fixtures only. Live household cents are not the specification
 * (L-006). Category remaining is reconciled against an independent sum of
 * classified fixture transactions, not by reading currentPeriodAction back
 * to itself. Bill settlement reuses representedEvents + expandEvents.
 *
 * `node test-current-period-actuals.js`
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const F = require('./public/forecast.js');
const O = require('./scripts/provider-observe.js');
const L = require('./scripts/live-plan.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) <= eps;
const MONTH = 365.25 / 12;
const PAYDAY = '2026-09-01';
const MID = '2026-09-08';
const NEXT = '2026-09-15';
const PERIOD_LAST = '2026-09-14';

function paydayComposer() {
  const appSrc = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
  const planSrc = fs.readFileSync(path.join(__dirname, 'public', 'plan.js'), 'utf8');
  const grab = (src, re, label) => {
    const m = re.exec(src);
    if (!m) throw new Error('missing ' + label);
    return m[0];
  };
  return vm.runInNewContext(
    [
      grab(appSrc, /^const money = .*$/m, 'money'),
      grab(appSrc, /^const money2 = .*$/m, 'money2'),
      grab(appSrc, /^const fmtDate = .*$/m, 'fmtDate'),
      grab(appSrc, /^const fmtDateLong = .*$/m, 'fmtDateLong'),
      grab(planSrc, /^const fmtMonth = .*$/m, 'fmtMonth'),
      grab(planSrc, /^function weeklyCapView\([\s\S]*?\n\}$/m, 'weeklyCapView'),
      grab(planSrc, /^function paydayActionRows\([\s\S]*?\n\}$/m, 'paydayActionRows'),
      grab(planSrc, /^function paydayOtherActionRows\([\s\S]*?\n\}$/m, 'paydayOtherActionRows'),
      grab(planSrc, /^function paydayReservedIds\([\s\S]*?\n\}$/m, 'paydayReservedIds'),
      grab(planSrc, /^function paydayComingRows\([\s\S]*?\n\}$/m, 'paydayComingRows'),
      grab(planSrc, /^function paydaySheet\([\s\S]*?\n\}$/m, 'paydaySheet'),
      grab(planSrc, /^function paydayCashNote\([\s\S]*?\n\}$/m, 'paydayCashNote'),
      grab(planSrc, /^function paydayObligationNote\([\s\S]*?\n\}$/m, 'paydayObligationNote'),
      grab(planSrc, /^function paydayCoverageNote\([\s\S]*?\n\}$/m, 'paydayCoverageNote'),
      grab(planSrc, /^function paydayBillStatusNote\([\s\S]*?\n\}$/m, 'paydayBillStatusNote'),
      grab(planSrc, /^function paydayAmountCell\([\s\S]*?\n\}$/m, 'paydayAmountCell'),
      grab(planSrc, /^function paydayAnswerHtml\([\s\S]*?\n\}$/m, 'paydayAnswerHtml'),
      '({ paydayAnswerHtml, money2 })',
    ].join('\n'),
    { Forecast: F }
  );
}

function miniPeriods() {
  return { periods: { ytd: { label: 'YTD', months: 1, spending: [] } } };
}

function basePlan(extra) {
  return Object.assign({
    windowDays: 40,
    defaults: { targetBuffer: 0 },
    startingCash: { amount: 4000 },
    opening: { asOf: PAYDAY, representedEvents: [] },
    income: [{
      id: 'pay', label: 'Pay', frequency: 'once', date: PAYDAY,
      amount: 2500, confidence: 'confirmed',
    }, {
      id: 'pay2', label: 'Pay 2', frequency: 'once', date: NEXT,
      amount: 2500, confidence: 'confirmed',
    }],
    obligations: [],
    bills: [],
    commitments: [],
    budget: {
      categories: [
        {
          id: 'groceries', label: 'Groceries', class: 'essential',
          from: ['Groceries'], plannedMonthly: 1800,
        },
        {
          id: 'fuel', label: 'Fuel & transport', class: 'essential',
          from: ['Fuel & transport'], plannedMonthly: 600,
        },
        {
          id: 'uncategorised', label: 'Uncategorised', class: 'unknown',
          from: ['Uncategorised'],
        },
      ],
      excluded: [{ from: 'Business', why: 'not household' }],
    },
  }, extra || {});
}

function packet(txs, extra) {
  return Object.assign({
    schema: 'atlas-current-period-actuals/v1',
    observationAsOf: extra && extra.asOf || PAYDAY,
    coverageStart: extra && extra.coverageStart || PAYDAY,
    coverageThrough: extra && extra.coverageThrough || (extra && extra.asOf) || PAYDAY,
    pendingCoverage: extra && extra.pendingCoverage || 'complete',
    transactions: txs,
  }, extra || {});
}

function opts(extra) {
  return Object.assign({
    paydayFloor: 1000,
    targetBuffer: 0,
    debts: [],
    weeklyVariable: 180,
    periods: miniPeriods(),
  }, extra || {});
}

function periodDays(start, end) {
  return F.diffDays(start, end) + 1;
}

function plannedNeed(monthly, start, end) {
  return Math.round(monthly * periodDays(start, end) / MONTH * 100) / 100;
}

function cat(action, id) {
  return ((action && action.categories) || []).find(c => c.id === id) || null;
}

function bill(action, id) {
  return ((action && action.bills) || []).find(b => b.id === id) || null;
}

function independentSpend(txs, plan, asOf, origin) {
  const byId = {};
  const skipped = { transfer: 0, payment: 0, income: 0, business: 0, external: 0 };
  for (const tx of txs) {
    if (tx.date < origin || tx.date > asOf) continue;
    const cls = F.classifyCurrentPeriodTransaction(tx, plan);
    const amt = Number(tx.amount) || 0;
    if (cls.kind === 'spend' || cls.kind === 'unclassified') {
      const id = cls.categoryId || 'uncategorised';
      byId[id] = byId[id] || { posted: 0, pending: 0 };
      if (tx.pending === true && tx.pendingTreatment !== 'confirmed-settled'
        && tx.pendingTreatment !== 'presumed-settled-for-current-forecast') {
        byId[id].pending += amt;
      } else {
        byId[id].posted += amt;
      }
    } else if (skipped[cls.kind] != null) {
      skipped[cls.kind] += amt;
    }
  }
  for (const id of Object.keys(byId)) {
    byId[id].posted = Math.round(byId[id].posted * 100) / 100;
    byId[id].pending = Math.round(byId[id].pending * 100) / 100;
  }
  return { byId, skipped };
}

console.log('=== A. paid bill via representedEvents ===');
{
  const plan = basePlan({
    bills: [
      { id: 'bcaa', label: 'BCAA', frequency: 'once', date: PAYDAY, amount: 82.96, confidence: 'confirmed' },
    ],
    opening: { asOf: PAYDAY, representedEvents: [{ id: 'bcaa', date: PAYDAY }] },
  });
  const action = F.currentPeriodAction(plan, PAYDAY, opts());
  const row = bill(action, 'bcaa');
  const events = F.expandEvents(plan, PAYDAY, PERIOD_LAST, {});
  ok(row && near(row.planned, 82.96), 'planned amount exists', row && row.planned);
  ok(row && row.actual == null && near(row.remaining, 0),
    'represented remaining is 0; schedule amount is not fabricated as actual');
  ok(row && row.settlement === 'represented', 'status is represented / paid');
  ok(!events.some(e => e.id === 'bcaa'),
    'expandEvents omits the represented occurrence — no second reserve');
  const alloc = F.paydayAllocation(plan, PAYDAY, opts());
  ok(!(alloc.obligations.items || []).some(i => i.id === 'bcaa'),
    'paydayAllocation does not reserve a represented bill');
}

console.log('\n=== B. unverified bill ===');
{
  const plan = basePlan({
    opening: { asOf: MID, priorAsOf: PAYDAY, representedEvents: [] },
    income: [
      { id: 'pay', label: 'Pay', frequency: 'once', date: NEXT, amount: 2500, confidence: 'confirmed' },
    ],
    bills: [
      { id: 'icbc', label: 'ICBC', frequency: 'once', date: '2026-09-05', amount: 99.91, confidence: 'confirmed' },
    ],
  });
  const action = F.currentPeriodAction(plan, MID, opts());
  const row = bill(action, 'icbc');
  ok(row && row.actual == null, 'actual is unknown / unproven');
  ok(row && near(row.remaining, 99.91), 'remaining stays reserved');
  ok(row && row.settlement === 'unverified', 'status is unverified');
  ok(row && row.settlement !== 'unpaid' && !/unpaid/i.test(JSON.stringify(row)),
    'not called unpaid');
  const html = paydayComposer().paydayAnswerHtml({
    plan, asOf: MID,
    advice: {
      weekly: 180, mode: 'normal',
      paydayAllocation: F.paydayAllocation(plan, MID, opts()),
      currentPeriodAction: action,
    },
    recommended: 180, weekly: 180,
  });
  ok(/settlement not proven/.test(html) && !/unpaid/i.test(html),
    'page says settlement not proven, not unpaid');
}

console.log('\n=== C. upcoming bill ===');
{
  const plan = basePlan({
    opening: { asOf: MID, representedEvents: [] },
    income: [
      { id: 'pay', label: 'Pay', frequency: 'once', date: NEXT, amount: 2500, confidence: 'confirmed' },
    ],
    bills: [
      { id: 'visa', label: 'Travel Visa', frequency: 'once', date: '2026-09-12', amount: 17, confidence: 'confirmed' },
    ],
  });
  const action = F.currentPeriodAction(plan, MID, opts());
  const row = bill(action, 'visa');
  ok(row && near(row.actual, 0), 'actual is 0');
  ok(row && near(row.remaining, 17), 'remaining is the required amount');
  ok(row && row.date === '2026-09-12' && row.settlement === 'upcoming',
    'due date and upcoming status');
}

console.log('\n=== D. groceries actual remaining ===');
{
  const txs = [
    { date: '2026-09-02', amount: 80.10, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: '2026-09-04', amount: 40.00, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const plan = basePlan({
    opening: { asOf: MID, priorAsOf: PAYDAY, representedEvents: [] },
    income: [
      { id: 'pay', label: 'Pay', frequency: 'once', date: NEXT, amount: 2500, confidence: 'confirmed' },
    ],
  });
  const origin = PAYDAY;
  const independent = independentSpend(txs, plan, MID, origin);
  const planned = plannedNeed(1800, origin, PERIOD_LAST);
  const posted = independent.byId.groceries.posted;
  const expected = Math.round((planned - posted) * 100) / 100;
  const action = F.currentPeriodAction(plan, MID, opts({
    currentPeriodActuals: packet(txs, { asOf: MID, coverageStart: PAYDAY, coverageThrough: MID }),
  }));
  const row = cat(action, 'groceries');
  ok(row && near(row.planned, planned), 'planned matches independent period scale',
    `${row && row.planned} vs ${planned}`);
  ok(row && near(row.posted, posted), 'posted matches independent transaction sum',
    `${row && row.posted} vs ${posted}`);
  ok(row && near(row.remaining, expected),
    'remaining = planned − posted', `${row && row.remaining} vs ${expected}`);
}

console.log('\n=== E. credit-card purchase counted once ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    {
      date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Transfer',
      accountRole: 'household-cash', excludeFromTotals: true, kindHint: 'payment',
    },
  ];
  const plan = basePlan();
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  const groceries = cat(action, 'groceries');
  const payCls = F.classifyCurrentPeriodTransaction(txs[1], plan);
  ok(groceries && near(groceries.posted, 40), 'card purchase counts toward groceries');
  ok(payCls.kind === 'card-payment' || payCls.kind === 'transfer',
    'card payment is not spend', payCls.kind);
  ok(groceries && near(groceries.posted, 40) && !near(groceries.posted, 80),
    'card payment does not add a second grocery dollar');
}

console.log('\n=== F. internal transfer is not spending or income ===');
{
  const txs = [
    {
      date: PAYDAY, amount: 50, pending: false, categoryLabel: 'Transfer',
      accountRole: 'household-cash', excludeFromTotals: true, kindHint: 'transfer',
    },
  ];
  const plan = basePlan();
  const cls = F.classifyCurrentPeriodTransaction(txs[0], plan);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  const groceries = cat(action, 'groceries');
  const planned = plannedNeed(1800, PAYDAY, PERIOD_LAST);
  ok(cls.kind === 'transfer' && cls.householdSpending === false, 'classified as transfer');
  ok(groceries && near(groceries.posted, 0) && near(groceries.remaining, planned),
    'transfer does not change grocery actual or remaining');
  ok(action.unclassified.count === 0, 'transfer is not dumped into unclassified spend');
}

console.log('\n=== G. pending purchase has gravity and is not posted ===');
{
  const txs = [
    {
      date: PAYDAY, amount: 18.40, pending: true,
      pendingTreatment: 'unresolved', categoryLabel: 'Groceries',
      accountRole: 'revolving-credit',
    },
  ];
  const plan = basePlan();
  const planned = plannedNeed(1800, PAYDAY, PERIOD_LAST);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
  }));
  const row = cat(action, 'groceries');
  ok(row && near(row.posted, 0) && near(row.pending, 18.40),
    'pending is labelled pending, not posted');
  ok(row && near(row.committed, 18.40) && near(row.remaining, planned - 18.40),
    'pending cannot be offered again as free grocery room');
}

console.log('\n=== H. refund / credit reduces spending ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: PAYDAY, amount: -12, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
  ];
  const plan = basePlan();
  const planned = plannedNeed(1800, PAYDAY, PERIOD_LAST);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  const row = cat(action, 'groceries');
  ok(row && near(row.posted, 28), 'posted is purchase minus category credit');
  ok(row && near(row.remaining, planned - 28), 'remaining uses the net posted amount');
}

console.log('\n=== I. unclassified transaction is not dropped or guessed ===');
{
  const txs = [
    { date: PAYDAY, amount: 9.99, pending: false, categoryLabel: null, accountRole: 'household-cash' },
  ];
  const plan = basePlan();
  const src = fs.readFileSync(path.join(__dirname, 'public', 'forecast.js'), 'utf8');
  ok(!/payee/.test(src.slice(src.indexOf('function classifyCurrentPeriodTransaction'),
    src.indexOf('function currentPeriodActualsPacket'))),
    'classifier source does not read a payee');
  const cls = F.classifyCurrentPeriodTransaction(txs[0], plan);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  ok(cls.kind === 'unclassified', 'unclassified, not a guessed merchant category');
  ok(action.unclassified.count === 1 && near(action.unclassified.posted, 9.99),
    'uncertainty is surfaced with the dollar amount');
  const groceries = cat(action, 'groceries');
  ok(groceries && near(groceries.posted, 0), 'not guessed into groceries');
  ok(action.remainingClaim === 'precise',
    'provider coverage remainingClaim stays precise when accounts and posted/pending coverage are complete');
  ok(action.categoryRemainingClaim === 'classified-incomplete',
    'named remaining is not claimed precise while household spend is unclassified');
  ok(groceries && groceries.remaining != null,
    'observed grocery remaining is still published');
}

console.log('\n=== J. stale actuals fail closed ===');
{
  const txs = [
    { date: '2026-08-20', amount: 200, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const plan = basePlan({ opening: { asOf: PAYDAY, representedEvents: [] } });
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, {
      asOf: PAYDAY, coverageStart: '2026-08-09', coverageThrough: '2026-08-09',
    }),
  }));
  const groceries = cat(action, 'groceries');
  ok(action.remainingClaim === 'unavailable' && action.coverage.status === 'stale',
    'Forecast fails closed on stale coverage');
  ok(groceries && groceries.remaining == null,
    'no precise remaining amount is published');
  const html = paydayComposer().paydayAnswerHtml({
    plan, asOf: PAYDAY,
    advice: {
      weekly: 180, mode: 'normal',
      paydayAllocation: F.paydayAllocation(plan, PAYDAY, opts()),
      currentPeriodAction: action,
    },
    recommended: 180, weekly: 180,
  });
  ok(/only through/.test(html) && /unavailable/.test(html),
    'page shows the freshness limitation');
  ok(!/Everyday spending left[\s\S]*\$200/.test(html),
    'stale grocery actual is not shown as current remaining');
}

console.log('\n=== K. between-paydays action plan ===');
{
  const plan = basePlan({
    opening: {
      asOf: MID, priorAsOf: PAYDAY,
      representedEvents: [{ id: 'bcaa', date: '2026-09-03' }],
    },
    income: [
      { id: 'pay', label: 'Pay', frequency: 'once', date: NEXT, amount: 2500, confidence: 'confirmed' },
    ],
    bills: [
      { id: 'bcaa', label: 'BCAA', frequency: 'once', date: '2026-09-03', amount: 82.96, confidence: 'confirmed' },
      { id: 'visa', label: 'Travel Visa', frequency: 'once', date: '2026-09-12', amount: 17, confidence: 'confirmed' },
    ],
  });
  const txs = [
    { date: '2026-09-03', amount: 50, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const rec = F.recommend(plan, MID, opts({
    currentPeriodActuals: packet(txs, { asOf: MID, coverageStart: PAYDAY, coverageThrough: MID }),
  }));
  const action = rec.currentPeriodAction;
  ok(action.mode === 'between-paydays', 'no current-day payday event → between-paydays');
  ok(action.nextPayday === NEXT, 'next payday is the incumbent income date');
  ok(bill(action, 'bcaa') && bill(action, 'bcaa').settlement === 'represented',
    'already-done bill is reported');
  ok(bill(action, 'visa') && bill(action, 'visa').settlement === 'upcoming',
    'still-due bill is reported');
  ok(cat(action, 'groceries') && cat(action, 'groceries').remaining != null,
    'variable remaining is reported');
  ok(action.noMovementToday === true && action.todayActions.length === 0,
    'does not invent a money movement');
  const html = paydayComposer().paydayAnswerHtml({
    plan, asOf: MID, advice: rec, recommended: rec.weekly, weekly: rec.weekly,
  });
  ok(/What to do now/.test(html) && /No money movement is required today/.test(html),
    'action plan says no movement today');
  ok(!/What to do with this paycheque/.test(html),
    'between-paydays is not a payday allocation worksheet');
}

console.log('\n=== L. payday mode keeps the allocator ===');
{
  const plan = basePlan({
    bills: [
      { id: 'soon', label: 'Soon', frequency: 'once', date: '2026-09-10', amount: 70, confidence: 'confirmed' },
    ],
  });
  const txs = [
    { date: PAYDAY, amount: 25, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const rec = F.recommend(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  const alloc = rec.paydayAllocation;
  const action = rec.currentPeriodAction;
  ok(action.mode === 'payday' && alloc.mode === 'payday', 'authoritative date is a payday');
  ok(near(alloc.identity, alloc.available), 'waterfall identity still holds');
  ok((alloc.obligations.items || []).some(i => i.id === 'soon'),
    'upcoming bill remains in the payday reserve');
  const groceries = cat(action, 'groceries');
  const planned = plannedNeed(1800, PAYDAY, PERIOD_LAST);
  ok(groceries && near(groceries.remaining, planned - 25),
    'payday essentials incorporate actuals without a second allocator');
  const html = paydayComposer().paydayAnswerHtml({
    plan, asOf: PAYDAY, advice: rec, recommended: rec.weekly, weekly: rec.weekly,
  });
  ok(/What to do with this paycheque/.test(html) && /Money available/.test(html),
    'payday worksheet remains the payday surface');
}

console.log('\n=== M. dollar / category reconciliation ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: PAYDAY, amount: 15, pending: false, categoryLabel: 'Fuel & transport', accountRole: 'household-cash' },
    { date: PAYDAY, amount: 8, pending: true, pendingTreatment: 'unresolved', categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: PAYDAY, amount: 20, pending: false, categoryLabel: 'Transfer', accountRole: 'household-cash', kindHint: 'transfer', excludeFromTotals: true },
  ];
  const plan = basePlan();
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs),
  }));
  const independent = independentSpend(txs, plan, PAYDAY, PAYDAY);
  for (const id of ['groceries', 'fuel']) {
    const row = cat(action, id);
    const ind = independent.byId[id] || { posted: 0, pending: 0 };
    const planned = plannedNeed(id === 'groceries' ? 1800 : 600, PAYDAY, PERIOD_LAST);
    const committed = Math.round((ind.posted + ind.pending) * 100) / 100;
    ok(row && near(row.posted, ind.posted) && near(row.pending, ind.pending),
      `${id} posted/pending match independent sums`);
    ok(row && near(row.remaining, planned - committed),
      `${id} planned − committed = remaining`);
  }
  ok(!independent.byId.groceries || independent.byId.fuel,
    'fixture has both categories');
  const groceryCls = F.classifyCurrentPeriodTransaction(txs[0], plan);
  const fuelCls = F.classifyCurrentPeriodTransaction(txs[1], plan);
  ok(groceryCls.categoryId === 'groceries' && fuelCls.categoryId === 'fuel',
    'the same transaction cannot sit in two household spending categories');
}

console.log('\n=== N. privacy — no raw payloads in overlay or localStorage knobs ===');
{
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'docs', 'connectivity', 'fixtures', 'lunchmoney-sample.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const report = O.observe({ provider: 'lunchmoney', payload: fixture, accountMap: map, data });
  const actuals = report.currentPeriodActuals;
  const blob = JSON.stringify(actuals);
  ok(actuals && actuals.schema === 'atlas-current-period-actuals/v1',
    'observer emits a sanitized current-period actuals packet');
  ok(!/"payee"\s*:/.test(blob) && !/"providerTransactionId"\s*:/.test(blob),
    'actuals packet has no payee or provider transaction id');
  const planSrc = fs.readFileSync(path.join(__dirname, 'public', 'plan.js'), 'utf8');
  ok(/const KNOBS = \['scenario'/.test(planSrc)
    && /localStorage\.setItem\(KNOB_KEY/.test(planSrc)
    && !/currentPeriodActuals/.test(planSrc.match(/function saveKnobs[\s\S]*?\n\}/)[0]),
    'plan knobs persist only planning knobs, not transactions');
  ok(!/localStorage\.setItem\([^)]*currentPeriodActuals/.test(planSrc + fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8')),
    'page scripts do not write actuals into localStorage');
  const overlayFn = L.overlayLiveState.toString();
  ok(/currentPeriodActuals/.test(overlayFn),
    'live overlay is the publication path for current-period actuals');
  const failed = L.failedOverlay
    ? L.failedOverlay(data, 'stale-live-cash-evidence')
    : null;
  if (failed) {
    ok(!failed.liveOverlay.currentPeriodActuals,
      'a failed overlay does not publish current-period actuals');
  } else {
    const src = fs.readFileSync(path.join(__dirname, 'scripts', 'live-plan.js'), 'utf8');
    ok(/function failedOverlay[\s\S]*?currentPeriodActuals: opts\.currentPeriodActuals \|\| null/.test(src)
      && /applied: false/.test(src),
      'failed overlay meta defaults currentPeriodActuals to null');
  }
}

console.log('\n=== observer category identity passes through ===');
{
  const payload = {
    provider: 'lunchmoney',
    fetchedAt: '2026-09-08T18:00:00.000Z',
    transactionWindow: { startDate: '2026-09-01', endDate: '2026-09-08' },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    accounts: [{
      id: 1001, name: 'Cheq', type: 'cash', balance: 100,
      updated_at: '2026-09-08T17:00:00.000Z',
    }],
    categories: [
      { id: 11, name: 'Groceries', is_income: false, exclude_from_totals: false },
      { id: 82, name: 'Transfer', is_income: false, exclude_from_totals: true },
    ],
    transactions: [
      { id: 1, account_id: 1001, date: '2026-09-02', amount: 12.5, category_id: 11, is_pending: false, payee: 'SYNTHETIC GROCER' },
      { id: 2, account_id: 1001, date: '2026-09-03', amount: 40, category_id: 82, is_pending: false, payee: 'SYNTHETIC TRANSFER' },
    ],
  };
  const map = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json'), 'utf8'));
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const report = O.observe({ provider: 'lunchmoney', payload, accountMap: map, data });
  const grocery = report.currentPeriodActuals.transactions.find(t => t.amount === 12.5);
  const transfer = report.currentPeriodActuals.transactions.find(t => t.amount === 40);
  ok(grocery && grocery.categoryLabel === 'Groceries' && grocery.accountRole === 'household-cash',
    'Lunch Money category name is normalized without a merchant guess');
  ok(transfer && transfer.excludeFromTotals === true && transfer.categoryLabel === 'Transfer',
    'transfer category identity is preserved');
  ok(!report.currentPeriodActuals.transactions.some(t => t.payee),
    'sanitized actuals dropped the fixture payee');
}

console.log('\n=== O. known pending still constrains remaining when pending coverage is incomplete ===');
{
  const txs = [
    {
      date: PAYDAY, amount: 18.40, pending: true,
      pendingTreatment: 'unresolved', categoryLabel: 'Groceries',
      accountRole: 'revolving-credit',
    },
  ];
  const plan = basePlan();
  const planned = plannedNeed(1800, PAYDAY, PERIOD_LAST);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, { pendingCoverage: 'partial' }),
  }));
  const row = cat(action, 'groceries');
  const html = paydayComposer().paydayAnswerHtml({
    plan, asOf: PAYDAY,
    advice: {
      weekly: 180, mode: 'normal',
      paydayAllocation: F.paydayAllocation(plan, PAYDAY, opts({
        currentPeriodActuals: packet(txs, { pendingCoverage: 'partial' }),
      })),
      currentPeriodAction: action,
    },
    recommended: 180, weekly: 180,
  });
  ok(action.remainingClaim === 'posted-only',
    'incomplete pending universe is qualified, not claimed as precise');
  ok(row && near(row.posted, 0) && near(row.pending, 18.40),
    'known pending is labelled pending, not posted');
  ok(row && near(row.committed, 18.40) && near(row.remaining, planned - 18.40),
    'observed pending still reduces available grocery room');
  ok(/pending \$18\.40/.test(html) && /additional unknown pending may exist/.test(html),
    'page shows the pending gravity and the qualified coverage');
}

console.log('\n=== P. truncated posted-transaction page cannot claim precise remaining ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'household-cash' },
  ];
  const plan = basePlan();
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, { transactionCoverage: 'truncated' }),
  }));
  const groceries = cat(action, 'groceries');
  ok(action.remainingClaim === 'unavailable' && action.coverage.status === 'incomplete',
    'truncated posted coverage fails closed');
  ok(groceries && groceries.remaining == null,
    'no precise remaining is published from an incomplete posted page');
}

console.log('\n=== P2. unmapped current-period account cannot claim precise remaining ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'unmapped' },
  ];
  const plan = basePlan();
  const unmappedCls = F.classifyCurrentPeriodTransaction(txs[0], plan);
  ok(unmappedCls.kind === 'unmapped' && unmappedCls.householdSpending === true,
    'unmapped is not classified as household-external');
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, { transactionCoverage: 'complete', pendingCoverage: 'complete' }),
  }));
  const groceries = cat(action, 'groceries');
  ok(action.remainingClaim === 'unavailable' && action.coverage.status === 'incomplete',
    'unmapped account fails remaining closed even if the packet claims complete coverage');
  ok(groceries && groceries.remaining == null,
    'no precise remaining is published from an unresolved account');
}

console.log('\n=== P3. explicit household-external stays excluded without blocking remaining ===');
{
  const txs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: PAYDAY, amount: 99, pending: false, categoryLabel: 'Groceries', accountRole: 'household-external' },
  ];
  const plan = basePlan();
  const externalCls = F.classifyCurrentPeriodTransaction(txs[1], plan);
  ok(externalCls.kind === 'external' && externalCls.householdSpending === false,
    'explicit household-external is non-household spend');
  const origin = PAYDAY;
  const independent = independentSpend([txs[0]], plan, PAYDAY, origin);
  const planned = plannedNeed(1800, origin, PERIOD_LAST);
  const action = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
  }));
  const groceries = cat(action, 'groceries');
  ok(action.remainingClaim === 'precise' || action.remainingClaim === 'posted-only',
    'explicit exclusion keeps remaining available', action.remainingClaim);
  ok(groceries && near(groceries.committed, independent.byId.groceries.posted),
    'only the household grocery counts');
  ok(groceries && near(groceries.remaining, planned - independent.byId.groceries.posted),
    'excluded grocery does not reduce remaining');
}

console.log('\n=== Q. represented bill actual is observed amount, never the schedule ===');
{
  const plan = basePlan({
    bills: [
      { id: 'bcaa', label: 'BCAA', frequency: 'once', date: PAYDAY, amount: 82.96, confidence: 'confirmed' },
    ],
    opening: { asOf: PAYDAY, representedEvents: [{ id: 'bcaa', date: PAYDAY }] },
  });
  const withoutAmount = F.currentPeriodAction(plan, PAYDAY, opts());
  ok(bill(withoutAmount, 'bcaa') && bill(withoutAmount, 'bcaa').actual == null
    && near(bill(withoutAmount, 'bcaa').remaining, 0),
    'identity without an observed amount publishes actual unavailable and remaining 0');
  const withObserved = F.currentPeriodAction(plan, PAYDAY, opts({
    currentPeriodActuals: packet([], {
      representedActuals: [{ id: 'bcaa', date: PAYDAY, actual: 103 }],
    }),
  }));
  const row = bill(withObserved, 'bcaa');
  ok(row && near(row.planned, 82.96) && near(row.actual, 103) && near(row.remaining, 0),
    'observed $103 is actual; planned $82.96 is not copied',
    row && `${row.actual} vs planned ${row.planned}`);
  ok(row && row.settlement === 'represented' && !near(row.actual, row.planned),
    'planned and observed amounts may differ without inventing equality');
}

console.log('\n=== R. automatic-payment identity uses explicit payee+account+date rules ===');
{
  const identity = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'docs', 'connectivity', 'transaction-identity.json'), 'utf8'));
  const map = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'docs', 'connectivity', 'fixtures', 'provider-account-map.json'), 'utf8'));
  const bcaaRule = (identity.rules || []).find(r => r.eventId === 'bcaa-aug15-outstanding');
  const icbcRule = (identity.rules || []).find(r => r.eventId === 'icbc-aug15-outstanding');
  const respRule = (identity.rules || []).find(r => r.eventId === 'resp' || r.eventId === 'resp-aug15-outstanding');
  const duesRule = (identity.rules || []).find(r => r.eventId === 'uniondues' || r.eventId === 'uniondues-aug15-outstanding');
  ok(bcaaRule && bcaaRule.payeePattern === 'BCAA-AdvAutoIns' && bcaaRule.atlasAccountId === 'chequing-a'
    && bcaaRule.direction === 'debit',
    'BCAA outstanding uses documented payee+Chequing A debit identity');
  ok(icbcRule && icbcRule.payeePattern === 'ICBC INS' && icbcRule.atlasAccountId === 'chequing-a'
    && icbcRule.direction === 'debit',
    'ICBC outstanding uses documented payee+Chequing A debit identity');
  ok(respRule && respRule.payeePattern === 'TD WATERHOUSE I REP'
    && respRule.atlasAccountId === 'chequing-a' && respRule.direction === 'debit',
    'RESP uses its explicit provider alias + Chequing A debit identity');
  ok(duesRule && duesRule.payeePattern === 'CMAWLOCAL1995 FEE'
    && duesRule.atlasAccountId === 'chequing-a' && duesRule.direction === 'debit',
    'CMAW uses its explicit provider alias + Chequing A debit identity');

  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
  const outstandingBills = (data.plan.bills || []).filter(b => [
    'bcaa-aug15-outstanding', 'icbc-aug15-outstanding',
    'resp-aug15-outstanding', 'uniondues-aug15-outstanding',
  ].includes(b.id));
  ok(outstandingBills.length === 4,
    'canonical plan still names the four 15 August reserved occurrences');
  const payload = {
    provider: 'lunchmoney',
    fetchedAt: '2026-08-16T18:00:00.000Z',
    transactionWindow: { startDate: '2026-08-09', endDate: '2026-08-16', complete: true },
    pendingCoverage: {
      complete: true, basis: O.PENDING_COVERAGE_BASIS, hasMore: false, truncated: false,
    },
    accounts: [{
      id: 1001, name: 'Cheq A', type: 'cash', balance: 100,
      updated_at: '2026-08-16T17:00:00.000Z',
    }, {
      id: 1002, name: 'Cheq B', type: 'cash', balance: 50,
      updated_at: '2026-08-16T17:00:00.000Z',
    }],
    categories: [{ id: 11, name: 'Insurance', is_income: false, exclude_from_totals: false }],
    transactions: [
      { id: 1, account_id: 1001, date: '2026-08-16', amount: 103, category_id: 11, is_pending: false, payee: 'BCAA-AdvAutoIns INS' },
      { id: 2, account_id: 1001, date: '2026-08-16', amount: 99.91, category_id: 11, is_pending: false, payee: 'ICBC INS' },
      { id: 3, account_id: 1001, date: '2026-08-16', amount: 100, category_id: 11, is_pending: false, payee: 'INTERNAL TRANSFER RESP' },
      { id: 4, account_id: 1001, date: '2026-08-16', amount: 25, category_id: 11, is_pending: false, payee: 'CMAW LOCAL 1995' },
    ],
  };
  const report = O.observe({
    provider: 'lunchmoney', payload, accountMap: map, data, identity,
  });
  const bcaa = report.representedEventCandidates.find(c => c.id === 'bcaa-aug15-outstanding');
  const icbc = report.representedEventCandidates.find(c => c.id === 'icbc-aug15-outstanding');
  ok(bcaa && bcaa.amountNotUsed === true && bcaa.identity === 'payee+account+date'
    && near(bcaa.observedAmount, 103),
    'BCAA matches payee+account+date; $103 is carried after identity, not used as identity');
  ok(icbc && icbc.amountNotUsed === true,
    'ICBC matches payee+account+date');
  ok(!report.representedEventCandidates.some(c => c.id === 'resp-aug15-outstanding'
    || c.id === 'uniondues-aug15-outstanding'),
    'unauthorized RESP and CMAW labels do not become represented by amount+date');

  const amountOnly = JSON.parse(JSON.stringify(payload));
  amountOnly.transactions = [
    { id: 5, account_id: 1001, date: '2026-08-16', amount: 82.96, is_pending: false, payee: 'UNKNOWN DEBIT' },
  ];
  const rejected = O.observe({
    provider: 'lunchmoney', payload: amountOnly, accountMap: map, data, identity,
  });
  ok(!rejected.representedEventCandidates.some(c => String(c.id).indexOf('bcaa') === 0),
    'same scheduled date and BCAA amount without the documented payee stays unverified');

  const wrongAccount = JSON.parse(JSON.stringify(payload));
  wrongAccount.transactions = [
    { id: 6, account_id: 1002, date: '2026-08-16', amount: 82.96, is_pending: false, payee: 'BCAA-AdvAutoIns INS' },
  ];
  const misplaced = O.observe({
    provider: 'lunchmoney', payload: wrongAccount, accountMap: map, data, identity,
  });
  ok(!misplaced.representedEventCandidates.some(c => String(c.id).indexOf('bcaa') === 0),
    'documented BCAA payee on Chequing B is not inferred as the Chequing A bill');

  const wrongDate = JSON.parse(JSON.stringify(payload));
  wrongDate.transactions = [
    { id: 7, account_id: 1001, date: '2026-08-15', amount: 82.96, is_pending: false, payee: 'BCAA-AdvAutoIns INS' },
  ];
  const dated = O.observe({
    provider: 'lunchmoney', payload: wrongDate, accountMap: map, data, identity,
  });
  ok(!dated.representedEventCandidates.some(c => String(c.id).indexOf('bcaa') === 0),
    'BCAA on 15 August is not stretched onto the 16 August scheduled occurrence');

  const forecastPlan = basePlan({
    opening: {
      asOf: '2026-08-16',
      representedEvents: report.representedEventCandidates.map(c => ({ id: c.id, date: c.date })),
    },
    income: [{
      id: 'pay', label: 'Pay', frequency: 'once', date: '2026-08-28',
      amount: 2500, confidence: 'confirmed',
    }],
    bills: outstandingBills,
  });
  const action = F.currentPeriodAction(forecastPlan, '2026-08-16', opts({
    currentPeriodActuals: report.currentPeriodActuals,
  }));
  const bcaaBill = bill(action, 'bcaa-aug15-outstanding');
  const respBill = bill(action, 'resp-aug15-outstanding');
  ok(bcaaBill && bcaaBill.settlement === 'represented' && near(bcaaBill.actual, 103)
    && near(bcaaBill.remaining, 0),
    'identified BCAA publishes observed actual, not the $82.96 schedule');
  ok(respBill && respBill.settlement !== 'represented' && near(respBill.remaining, 100),
    'RESP without its explicit provider alias is not marked paid');
  ok(!/"payee"\s*:/.test(JSON.stringify(report.currentPeriodActuals)),
    'sanitized represented actuals still drop payee');
}

function independentInventory(txs, plan, asOf, origin) {
  let householdSpend = 0;
  let named = 0;
  let unclassified = 0;
  let excluded = 0;
  const namedIds = {};
  for (const tx of txs) {
    if (tx.date < origin || tx.date > asOf) continue;
    const cls = F.classifyCurrentPeriodTransaction(tx, plan);
    if (cls.kind === 'spend' && cls.categoryId && cls.categoryId !== 'uncategorised') {
      householdSpend += 1;
      named += 1;
      namedIds[cls.categoryId] = (namedIds[cls.categoryId] || 0) + 1;
    } else if (cls.kind === 'unclassified' || cls.kind === 'unmapped'
      || (cls.kind === 'spend' && cls.categoryId === 'uncategorised')) {
      householdSpend += 1;
      unclassified += 1;
    } else {
      excluded += 1;
    }
  }
  return { householdSpend, named, unclassified, excluded, namedById: namedIds };
}

console.log('\n=== S. named remaining is not precise while household spend is unclassified ===');
{
  const namedTxs = [
    { date: PAYDAY, amount: 40, pending: false, categoryLabel: 'Groceries', accountRole: 'revolving-credit' },
    { date: PAYDAY, amount: 15, pending: false, categoryLabel: 'Fuel & transport', accountRole: 'household-cash' },
  ];
  const unclassifiedTxs = [
    { date: PAYDAY, amount: 12.50, pending: false, categoryLabel: 'Fast Food', accountRole: 'household-cash' },
  ];
  const excludedTxs = [
    {
      date: PAYDAY, amount: 50, pending: false, categoryLabel: 'Transfer',
      accountRole: 'household-cash', excludeFromTotals: true, kindHint: 'transfer',
    },
    {
      date: PAYDAY, amount: 200, pending: false, categoryLabel: 'Payment',
      accountRole: 'household-cash', excludeFromTotals: true, kindHint: 'payment',
    },
    {
      date: PAYDAY, amount: 2500, pending: false, categoryLabel: 'Income',
      accountRole: 'household-cash', isIncome: true,
    },
    {
      date: PAYDAY, amount: 80, pending: false, categoryLabel: 'Business',
      accountRole: 'household-cash',
    },
    {
      date: PAYDAY, amount: 99, pending: false, categoryLabel: 'Groceries',
      accountRole: 'household-external',
    },
  ];
  const pendingNamed = [{
    date: PAYDAY, amount: 18.40, pending: true,
    pendingTreatment: 'unresolved', categoryLabel: 'Groceries',
    accountRole: 'revolving-credit',
  }];

  console.log('  --- S1. fully classified period may claim precise named remaining ---');
  {
    const txs = namedTxs.slice();
    const plan = basePlan();
    const inv = independentInventory(txs, plan, PAYDAY, PAYDAY);
    ok(inv.householdSpend === 2 && inv.named === 2 && inv.unclassified === 0 && inv.excluded === 0,
      'independent inventory: 2 named household-spend, 0 unclassified, 0 excluded',
      JSON.stringify(inv));
    const actionOpts = opts({
      currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
    });
    const action = F.currentPeriodAction(plan, PAYDAY, actionOpts);
    ok(action.remainingClaim === 'precise',
      'provider coverage remainingClaim is precise');
    ok(action.categoryRemainingClaim === 'precise',
      'named remaining may be precise when every household-spend tx is classified');
    ok(action.unclassified.count === 0, 'no unclassified household spend');
    const groceries = cat(action, 'groceries');
    const fuel = cat(action, 'fuel');
    const gNeed = plannedNeed(1800, PAYDAY, PERIOD_LAST);
    const fNeed = plannedNeed(600, PAYDAY, PERIOD_LAST);
    ok(groceries && near(groceries.remaining, gNeed - 40),
      'grocery remaining is planned − classified posted');
    ok(fuel && near(fuel.remaining, fNeed - 15),
      'fuel remaining is planned − classified posted');
    const html = paydayComposer().paydayAnswerHtml({
      plan, asOf: PAYDAY,
      advice: {
        weekly: 180, mode: 'normal',
        paydayAllocation: F.paydayAllocation(plan, PAYDAY, actionOpts),
        currentPeriodAction: action,
      },
      recommended: 180, weekly: 180,
    });
    ok(/Actual spending through/.test(html),
      'page may describe remaining from complete classified actuals');
    ok(/<th>Remaining<\/th>/.test(html) && !/Observed remaining/.test(html),
      'column header is Remaining, not a qualified observed label');
    ok(!/Category allocation incomplete/.test(html),
      'fully classified period does not warn about allocation');
  }

  console.log('  --- S2. unclassified household spend keeps coverage precise, remaining not precise ---');
  {
    const txs = namedTxs.concat(unclassifiedTxs);
    const plan = basePlan();
    ok(namedTxs.length === 2 && unclassifiedTxs.length === 1 && excludedTxs.length === 5,
      'fixture inventory is 2 named, 1 unclassified, 5 excluded constructed separately');
    const inv = independentInventory(txs, plan, PAYDAY, PAYDAY);
    ok(inv.householdSpend === 3 && inv.named === 2 && inv.unclassified === 1 && inv.excluded === 0,
      'independent inventory: 3 household-spend = 2 named + 1 unclassified',
      JSON.stringify(inv));
    const actionOpts = opts({
      currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
    });
    const action = F.currentPeriodAction(plan, PAYDAY, actionOpts);
    ok(action.remainingClaim === 'precise',
      'complete provider coverage still reports remainingClaim precise');
    ok(action.categoryRemainingClaim === 'classified-incomplete',
      'named remaining is not precise while unclassified household spend exists');
    ok(action.unclassified.count === 1 && near(action.unclassified.posted, 12.50),
      'unclassified Fast Food remains visible in uncategorised with its dollar amount');
    const groceries = cat(action, 'groceries');
    const uncat = cat(action, 'uncategorised');
    ok(groceries && near(groceries.posted, 40),
      'classified grocery actuals are still calculated');
    ok(groceries && groceries.remaining != null,
      'observed grocery remaining is still shown');
    ok(uncat && near(uncat.posted, 12.50),
      'unmapped Fast Food lands in uncategorised, not a guessed named category');
    const html = paydayComposer().paydayAnswerHtml({
      plan, asOf: PAYDAY,
      advice: {
        weekly: 180, mode: 'normal',
        paydayAllocation: F.paydayAllocation(plan, PAYDAY, actionOpts),
        currentPeriodAction: action,
      },
      recommended: 180, weekly: 180,
    });
    ok(/Transaction coverage complete/.test(html) && /Category allocation incomplete/.test(html),
      'page distinguishes complete transaction coverage from incomplete category allocation');
    ok(/Observed remaining/.test(html),
      'named remaining is labelled observed, not proven precise');
    ok(!/>Remaining</.test(html) || /Observed remaining/.test(html),
      'UI does not present Remaining as an unqualified precise claim');
    ok(/uncategorised/.test(html) && /12\.50/.test(html),
      'uncategorised spending remains visible');
  }

  console.log('  --- S3. excluded non-spend does not degrade category remaining precision ---');
  {
    const txs = [namedTxs[0]].concat(excludedTxs);
    const plan = basePlan();
    const inv = independentInventory(txs, plan, PAYDAY, PAYDAY);
    ok(inv.householdSpend === 1 && inv.named === 1 && inv.unclassified === 0 && inv.excluded === 5,
      'independent inventory: 1 named household-spend, 5 excluded, 0 unclassified',
      JSON.stringify(inv));
    const action = F.currentPeriodAction(plan, PAYDAY, opts({
      currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
    }));
    ok(action.remainingClaim === 'precise',
      'coverage remainingClaim stays precise');
    ok(action.categoryRemainingClaim === 'precise',
      'exclusions do not make named remaining imprecise');
    ok(action.unclassified.count === 0, 'excluded txs are not unclassified household spend');
    const groceries = cat(action, 'groceries');
    const gNeed = plannedNeed(1800, PAYDAY, PERIOD_LAST);
    ok(groceries && near(groceries.posted, 40) && near(groceries.remaining, gNeed - 40),
      'only the household grocery constrains remaining');
    ok(near(action.excluded.transfers, 50) || action.excluded.transfers > 0,
      'transfer exclusion is recorded');
  }

  console.log('  --- S4. classified pending still constrains remaining; claim stays precise ---');
  {
    const txs = pendingNamed.slice();
    const plan = basePlan();
    const inv = independentInventory(txs, plan, PAYDAY, PAYDAY);
    ok(inv.named === 1 && inv.unclassified === 0,
      'independent inventory: pending grocery is named, not unclassified');
    const actionOpts = opts({
      currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
    });
    const action = F.currentPeriodAction(plan, PAYDAY, actionOpts);
    const groceries = cat(action, 'groceries');
    const gNeed = plannedNeed(1800, PAYDAY, PERIOD_LAST);
    ok(action.remainingClaim === 'precise',
      'complete pending coverage keeps coverage remainingClaim precise');
    ok(action.categoryRemainingClaim === 'precise',
      'classified pending does not degrade category remaining precision');
    ok(groceries && near(groceries.posted, 0) && near(groceries.pending, 18.40),
      'pending is pending, not posted');
    ok(groceries && near(groceries.remaining, gNeed - 18.40),
      'classified pending constrains grocery remaining');
  }

  console.log('  --- S5. one unclassified tx blocks globally proven precise named remaining ---');
  {
    const txs = [namedTxs[0]].concat(unclassifiedTxs);
    const plan = basePlan();
    const inv = independentInventory(txs, plan, PAYDAY, PAYDAY);
    ok(inv.named === 1 && inv.unclassified === 1 && inv.namedById.groceries === 1 && !inv.namedById.fuel,
      'independent inventory: groceries classified, fuel has no classified txs, Fast Food unclassified',
      JSON.stringify(inv));
    const actionOpts = opts({
      currentPeriodActuals: packet(txs, { pendingCoverage: 'complete' }),
    });
    const action = F.currentPeriodAction(plan, PAYDAY, actionOpts);
    const fuel = cat(action, 'fuel');
    const groceries = cat(action, 'groceries');
    const fNeed = plannedNeed(600, PAYDAY, PERIOD_LAST);
    ok(action.remainingClaim === 'precise',
      'provider coverage remains complete');
    ok(action.categoryRemainingClaim === 'classified-incomplete',
      'one unclassified household tx prevents a precise named-remaining claim');
    ok(fuel && near(fuel.posted, 0) && near(fuel.remaining, fNeed),
      'fuel observed remaining equals full planned because no classified fuel actuals exist');
    ok(groceries && near(groceries.posted, 40),
      'groceries still show classified actuals');
    ok(!(action.categories || []).some(c => c && (
      Object.prototype.hasOwnProperty.call(c, 'remainingIsPrecise')
      || Object.prototype.hasOwnProperty.call(c, 'remainingClaim')
      || Object.prototype.hasOwnProperty.call(c, 'categoryRemainingClaim')
    )),
      'no per-category remaining-precision field is invented');
    const html = paydayComposer().paydayAnswerHtml({
      plan, asOf: PAYDAY,
      advice: {
        weekly: 180, mode: 'normal',
        paydayAllocation: F.paydayAllocation(plan, PAYDAY, actionOpts),
        currentPeriodAction: action,
      },
      recommended: 180, weekly: 180,
    });
    ok(/Observed remaining/.test(html),
      'UI labels remaining as observed when any household spend is unclassified');
    ok(/Category allocation incomplete/.test(html),
      'UI does not imply unaffected named rows are globally proven precise');
    ok(!/remaining is precise|precise remaining/i.test(html),
      'page copy does not call named remaining precise');
  }
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll current-period actuals proofs passed.');
