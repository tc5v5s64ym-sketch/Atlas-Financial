'use strict';
/* Logan Warriors Elite Academy U13 is one $895 commitment, settled once
 * by the posted Vancouver Warriors Travel Visa debit of 2026-09-21.
 * The 2026-08-11 Vancouver Warriors $40 charge is not that settlement.
 * Savings transfers and the Travel Visa payment are not income and not
 * a second copy of the $895.
 *
 * `node test/test-warriors-u13-settlement.js`
 *
 * Synthetic observe fixtures and independent arithmetic (L-002 / L-006).
 * Live cents are the household row under test, not a copied behaviour spec.
 */
const fs = require('fs');
const path = require('path');
const { sourceText } = require('./test-source-text');
const F = require('../public/forecast.js');
const O = require('../scripts/provider-observe.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const ID = 'warriors';
const AMOUNT = 895;
const GROCERY = 40;
const COFFEE = 12;
const SAVE_A = 200;
const SAVE_B = 310;
const VISA_CREDIT = 640;
const DUE = '2026-09-23';
const POSTED = '2026-09-21';
const OPENING = '2026-08-19';
const COVERAGE_START = '2026-08-28';
const PREVIOUS_END = '2026-09-10';
const CURRENT_START = '2026-09-11';
const AS_OF = '2026-09-23';
const TRAVEL_PROVIDER_ID = 4103;
const SAVINGS_A_ID = 4101;
const SAVINGS_B_ID = 4102;
const CHEQUING_ID = 1001;
const EXACT = 'exact-scheduled-amount';
const HAND_TRANSFER = SAVE_A + SAVE_B;

function liveData() {
  return load('data.json');
}

function identityDoc() {
  return load('docs/connectivity/transaction-identity.json');
}

function fixtureMap() {
  const map = load('docs/connectivity/fixtures/provider-account-map.json');
  map.mappings = (map.mappings || []).concat([
    {
      providerAccountId: String(TRAVEL_PROVIDER_ID),
      canonical: { collection: 'debts', id: 'travelvisa' },
      atlasRole: 'revolving-credit',
    },
    {
      providerAccountId: String(SAVINGS_A_ID),
      canonical: { collection: 'cash', id: 'savings' },
      atlasRole: 'household-cash',
    },
    {
      providerAccountId: String(SAVINGS_B_ID),
      canonical: { collection: 'cash', id: 'savings' },
      atlasRole: 'household-cash',
    },
  ]);
  return map;
}

function syntheticPlan(openingCash) {
  return {
    windowDays: 91,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    startingCash: { amount: openingCash },
    income: [{
      id: 'payroll',
      label: 'Payroll — Seaspan',
      frequency: 'biweekly',
      anchor: '2026-08-14',
      amount: 1000,
      confidence: 'estimated',
    }],
    obligations: [],
    bills: [],
    commitments: [{
      id: ID,
      date: DUE,
      label: 'Logan Warriors Elite Academy U13',
      amount: AMOUNT,
      frequency: 'once',
      budgetCategory: 'sport',
      confidence: 'confirmed',
      sinkingFund: true,
      settledOn: POSTED,
    }],
    budget: {
      categories: [{
        id: 'groceries',
        label: 'Groceries',
        class: 'essential',
        from: ['Groceries'],
        plannedPayday: 100,
      }],
    },
  };
}

function household(openingCash, extra) {
  const plan = Object.assign(syntheticPlan(openingCash), extra || {});
  return {
    meta: { asOf: OPENING },
    debts: [],
    plan,
  };
}

function payload(asOf, txs) {
  return {
    provider: 'lunchmoney',
    fetchedAt: asOf + 'T18:00:00.000Z',
    source: 'Synthetic Warriors U13 settlement fixture. Not a live institution pull.',
    transactionWindow: {
      startDate: COVERAGE_START,
      endDate: asOf,
      complete: true,
      hasMore: false,
      truncated: false,
    },
    pendingCoverage: {
      complete: true,
      basis: O.PENDING_COVERAGE_BASIS,
      hasMore: false,
      truncated: false,
    },
    accounts: [
      {
        id: CHEQUING_ID, name: 'Fixture Chequing A', type: 'cash', balance: 1000,
        updated_at: asOf + 'T17:55:00.000Z',
      },
      {
        id: SAVINGS_A_ID, name: 'Fixture Savings A', type: 'cash', balance: 2000,
        updated_at: asOf + 'T17:55:00.000Z',
      },
      {
        id: SAVINGS_B_ID, name: 'Fixture Savings B', type: 'cash', balance: 1500,
        updated_at: asOf + 'T17:55:00.000Z',
      },
      {
        id: TRAVEL_PROVIDER_ID, name: 'Fixture Travel Visa', type: 'credit',
        balance: 900, credit_limit: 5000,
        updated_at: asOf + 'T17:55:00.000Z',
      },
    ],
    categories: [
      { id: 11, name: 'Groceries', is_income: false, exclude_from_totals: false },
      { id: 12, name: 'Uncategorised', is_income: false, exclude_from_totals: false },
      { id: 13, name: 'Payment, Transfer', is_income: false, exclude_from_totals: true },
    ],
    transactions: txs || [],
  };
}

function tx(id, date, amount, payee, accountId, extra) {
  return Object.assign({
    id,
    account_id: accountId,
    date,
    amount,
    is_pending: false,
    payee,
    original_name: payee,
    category_id: 12,
  }, extra || {});
}

function warriorsTx(id, date, amount, accountId, extra) {
  return tx(id, date, amount, 'Vancouver Warriors', accountId || TRAVEL_PROVIDER_ID, extra);
}

function observe(asOf, txs, data) {
  return O.observe({
    provider: 'lunchmoney',
    payload: payload(asOf, txs),
    accountMap: fixtureMap(),
    data: data || household(1000),
    identity: identityDoc(),
  });
}

function hitsFor(report, id) {
  return ((report && report.representedEventCandidates) || [])
    .filter(c => c && c.id === (id || ID));
}

function settledBundle() {
  return [
    warriorsTx(9001, POSTED, AMOUNT),
    tx(9002, '2026-09-01', GROCERY, 'Walmart', TRAVEL_PROVIDER_ID, { category_id: 11 }),
    tx(9003, '2026-09-12', COFFEE, 'Corner Coffee', TRAVEL_PROVIDER_ID),
    tx(9004, '2026-09-15', SAVE_A, 'TFR-TO C/C', SAVINGS_A_ID, {
      category_id: 13, exclude_from_totals: true,
    }),
    tx(9005, '2026-09-16', SAVE_B, 'TFR-TO C/C', SAVINGS_B_ID, {
      category_id: 13, exclude_from_totals: true,
    }),
    tx(9006, '2026-09-16', -VISA_CREDIT, 'PAYMENT - THANK YOU', TRAVEL_PROVIDER_ID, {
      category_id: 13, exclude_from_totals: true,
    }),
  ];
}

function endingDelta(openingCash, start) {
  const withPlan = syntheticPlan(openingCash);
  const offPlan = syntheticPlan(openingCash);
  offPlan.commitments = [];
  const opts = { scenario: 'expected', weeklyVariable: 0 };
  const withRow = F.simulate(withPlan, start, opts);
  const offRow = F.simulate(offPlan, start, opts);
  return {
    delta: Math.round((withRow.ending - offRow.ending) * 100) / 100,
    withEnding: withRow.ending,
    offEnding: offRow.ending,
  };
}

console.log('=== one $895 Warriors commitment, not a floor ===');
{
  ok(AMOUNT === 895 && GROCERY === 40 && COFFEE === 12, 'hand amounts are $895, $40, and $12');
  ok(SAVE_A + SAVE_B === HAND_TRANSFER && HAND_TRANSFER !== AMOUNT
      && VISA_CREDIT !== AMOUNT && VISA_CREDIT !== HAND_TRANSFER,
    'transfers $200 + $310 and the $640 Visa credit are not $895 and not each other');
  const plan = syntheticPlan(1000);
  const row = plan.commitments[0];
  ok(row.amount === AMOUNT && row.amountMin == null && row.frequency === 'once'
      && row.date === DUE && row.settledOn === POSTED && row.confidence === 'confirmed',
    'the fixture commitment is exact $895 once, due 23 Sep, settled 21 Sep');
  ok(!('priorPeriodSurplus' in row) && !('currentPeriodSurplus' in row)
      && row.surplusSplit == null,
    'the commitment records no prior/current surplus split');
  const identity = identityDoc();
  const rules = (identity.rules || []).filter(r => r && r.eventId === ID);
  ok(rules.length === 1 && rules[0].payeeMatchMode === 'exact'
      && rules[0].atlasAccountId === 'travelvisa' && rules[0].direction === 'debit'
      && rules[0].postingDateRule === 'covers-early-or-due-on-or-before-posting'
      && rules[0].earlyPayLookaheadDays === 2
      && rules[0].settlesWhen === EXACT
      && (rules[0].payeePatterns || []).length === 1
      && (rules[0].payeePatterns || [])[0] === 'Vancouver Warriors',
    'identity is exact Vancouver Warriors + Travel Visa + debit + 2-day early window + exact $895');
  ok(/Named warriors is the once Logan Warriors Elite Academy U13/.test(identity.owns || '')
      && /Do not invent a prior-period versus current-period surplus split/.test(identity.owns || ''),
    'the identity contract names this one commitment and refuses a surplus split');
  const forecastSrc = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public/forecast.js'), 'utf8'));
  ok(!/warriors/i.test(forecastSrc),
    'Forecast has no Warriors-specific classifier');
}

console.log('\n=== one posted $895 debit represents the commitment once ===');
{
  const report = observe(AS_OF, settledBundle());
  const hits = hitsFor(report);
  ok(hits.length === 1 && hits[0].date === DUE && hits[0].postingDate === POSTED
      && near(Math.abs(hits[0].observedAmount), AMOUNT)
      && String(hits[0].providerTransactionId) === '9001',
    'the 21 Sep Vancouver Warriors $895 debit settles the 23 Sep due once',
    hits.map(h => `${h.date}:${h.postingDate}:${h.providerTransactionId}:${h.observedAmount}`).join(','));
  const packet = report.currentPeriodActuals;
  ok(packet && O.currentPeriodActualsLooksSanitized(packet),
    'current-period packet stays sanitized');
  const represented = (packet.representedActuals || []).filter(r => r && r.id === ID);
  ok(represented.length === 1 && represented[0].date === DUE
      && represented[0].postedOn === POSTED && near(represented[0].actual, AMOUNT),
    'representedActuals names Warriors once at $895 posted 21 Sep');
  const memberTx = (packet.transactions || []).find(row => row && near(row.amount, AMOUNT));
  ok(memberTx && represented[0].transactionId === memberTx.id,
    'that represented row points at the $895 transaction and no other',
    represented.map(r => r.transactionId).join(','));
  const otherRepresented = (packet.representedActuals || []).filter(r => r && r.id !== ID);
  ok(otherRepresented.length === 0,
    'savings transfers and the Visa credit are not a second represented expense',
    otherRepresented.map(r => r.id).join(','));
  const plan = syntheticPlan(1000);
  const cls = F.classifyCurrentPeriodTransaction(memberTx, plan, {
    currentPeriodActuals: packet,
  });
  ok(cls.kind === 'bill' && cls.householdSpending === false && cls.reason === 'represented-bill'
      && F.classifyCurrentPeriodTransaction.householdBudgetSupportingSpendEligible(cls) === false,
    'the settled charge is a represented bill, not household spending',
    JSON.stringify(cls));
}

console.log('\n=== absent from Other Spending and from normal-spending actuals ===');
{
  const report = observe(AS_OF, settledBundle());
  const packet = report.currentPeriodActuals;
  const plan = syntheticPlan(1000);
  const opts = { currentPeriodActuals: packet, preservePaydayPeriodOrigin: true };
  const action = F.currentPeriodAction(plan, AS_OF, opts);
  ok(near(action.unclassified.posted, COFFEE) && !near(action.unclassified.posted, AMOUNT)
      && !near(action.unclassified.posted, COFFEE + AMOUNT),
    'Other Spending / unclassified current-period posted is the $12 coffee, not $895',
    `posted=${action.unclassified.posted} count=${action.unclassified.count}`);
  ok(near(action.excluded.bills, AMOUNT),
    'the $895 is excluded with represented bills',
    String(action.excluded && action.excluded.bills));
  const traj = F.baselineTrajectory(plan, [], AS_OF, opts);
  const normal = traj && traj.normalSpending;
  ok(traj && traj.status === 'ready' && normal && normal.status === 'ready'
      && near(normal.completedPeriod.amount, GROCERY)
      && near(normal.currentPeriod.actualToDate, COFFEE),
    'normal spending is completed $40 and current actual-to-date $12',
    normal && `completed=${normal.completedPeriod && normal.completedPeriod.amount} `
      + `current=${normal.currentPeriod && normal.currentPeriod.actualToDate} status=${normal.status}`);
  ok(normal && near(normal.currentPeriod.fullPeriodEstimate, COFFEE + 100),
    'current full-period estimate adds the $100 grocery reserve, not the $895',
    String(normal && normal.currentPeriod && normal.currentPeriod.fullPeriodEstimate));
  const without = settledBundle().filter(row => row.id !== 9001);
  const bare = observe(AS_OF, without);
  const bareNormal = F.baselineTrajectory(syntheticPlan(1000), [], AS_OF, {
    currentPeriodActuals: bare.currentPeriodActuals,
  }).normalSpending;
  ok(bareNormal && near(bareNormal.completedPeriod.amount, normal.completedPeriod.amount)
      && near(bareNormal.currentPeriod.actualToDate, normal.currentPeriod.actualToDate),
    'including the posted $895 does not increase normal-spending actuals');
}

console.log('\n=== after settlement it is not a future $895 funding requirement ===');
{
  const plan = syntheticPlan(1000);
  const open = F.fundingSequence(plan, OPENING, {});
  const dayBefore = F.fundingSequence(plan, '2026-09-20', {});
  const onPost = F.fundingSequence(plan, POSTED, {});
  const onDue = F.fundingSequence(plan, DUE, {});
  ok(open.some(c => c.id === ID && near(c.need, AMOUNT) && c.amountMin == null)
      && dayBefore.some(c => c.id === ID && near(c.need, AMOUNT)),
    'before settledOn, funding still includes the exact $895');
  ok(!onPost.some(c => c.id === ID) && !onDue.some(c => c.id === ID),
    'on and after settledOn, fundingSequence drops Warriors');
  ok(!F.majorPlans(plan, DUE, {}).some(c => c.id === ID),
    'major plans after settlement do not keep a future $895 requirement');
  const pubOpen = F.publicationTotals(household(1000));
  const pubDue = F.publicationTotals({
    meta: { asOf: DUE },
    plan,
  });
  ok(pubOpen.commitmentItems.some(i => i.id === ID && near(i.amount, AMOUNT) && i.amountMin == null),
    'an opening before settledOn still publishes the $895 point');
  ok(!pubDue.commitmentItems.some(i => i.id === ID),
    'publication on the due date no longer encumbers Warriors');
  for (const cash of [100, 9000]) {
    const before = endingDelta(cash, OPENING);
    const eve = endingDelta(cash, '2026-09-20');
    const posted = endingDelta(cash, POSTED);
    const due = endingDelta(cash, DUE);
    ok(near(before.delta, -AMOUNT) && near(eve.delta, -AMOUNT),
      `opening cash $${cash} still reserves $895 before settlement`,
      `Aug19=${before.delta} Sep20=${eve.delta}`);
    ok(near(posted.delta, 0) && near(due.delta, 0),
      `opening cash $${cash} does not reserve Warriors on or after settledOn`,
      `Sep21=${posted.delta} Sep23=${due.delta}`);
  }
}

console.log('\n=== transfers and the Visa payment are not income or a second Warriors expense ===');
{
  const report = observe(AS_OF, settledBundle());
  const packet = report.currentPeriodActuals;
  const plan = syntheticPlan(1000);
  const byAmount = amount => (packet.transactions || []).find(row => row && near(row.amount, amount));
  const saveA = byAmount(SAVE_A);
  const saveB = byAmount(SAVE_B);
  const visa = byAmount(-VISA_CREDIT);
  const clsA = F.classifyCurrentPeriodTransaction(saveA, plan, { currentPeriodActuals: packet });
  const clsB = F.classifyCurrentPeriodTransaction(saveB, plan, { currentPeriodActuals: packet });
  const clsV = F.classifyCurrentPeriodTransaction(visa, plan, { currentPeriodActuals: packet });
  ok(clsA.kind === 'transfer' && clsA.householdSpending === false && clsA.kind !== 'income'
      && clsB.kind === 'transfer' && clsB.householdSpending === false,
    'both savings movements are transfers, not income and not spending',
    `${clsA.kind}/${clsB.kind}`);
  ok(clsV.kind === 'refund' && clsV.householdSpending === false && clsV.kind !== 'income'
      && clsV.reason === 'refund',
    'the Travel Visa credit is a card credit, not income and not a Warriors debit',
    JSON.stringify(clsV));
  const action = F.currentPeriodAction(plan, AS_OF, {
    currentPeriodActuals: packet,
    preservePaydayPeriodOrigin: true,
  });
  ok(near(action.excluded.transfers, SAVE_A + SAVE_B) && near(action.excluded.income, 0),
    'current-period accounting excludes the transfers and books no income from them',
    `transfers=${action.excluded.transfers} income=${action.excluded.income}`);
  ok(!(action.inflows || []).some(row => row && (near(row.actual, AMOUNT) || near(row.planned, AMOUNT)
      || near(Math.abs(row.actual || 0), VISA_CREDIT))),
    'represented inflows do not turn the payment or the $895 into income');
  ok(hitsFor(report).length === 1,
    'the bundle still represents Warriors only once');
}

console.log('\n=== $40, other amount, account, merchant, timing, pending, and doubles do not settle ===');
{
  const refused = observe(AS_OF, [
    warriorsTx(9101, '2026-08-11', 40),
    warriorsTx(9102, POSTED, 900),
    warriorsTx(9103, POSTED, AMOUNT, CHEQUING_ID),
    tx(9104, POSTED, AMOUNT, 'Vancouver Warriors Academy', TRAVEL_PROVIDER_ID),
    tx(9105, POSTED, AMOUNT, 'Warriors', TRAVEL_PROVIDER_ID),
    warriorsTx(9106, '2026-09-20', AMOUNT),
    warriorsTx(9107, '2026-10-01', AMOUNT),
    warriorsTx(9108, '2026-10-15', AMOUNT),
    warriorsTx(9109, POSTED, AMOUNT, TRAVEL_PROVIDER_ID, { is_pending: true }),
  ]);
  ok(hitsFor(refused).length === 0,
    'the $40, $900, other account, other merchant, 3-days-early, 1 Oct, 15 Oct, and pending do not settle',
    hitsFor(refused).map(h => h.providerTransactionId).join(','));
  const onDue = observe(DUE, [warriorsTx(9111, DUE, AMOUNT)]);
  ok(hitsFor(onDue).length === 1 && String(hitsFor(onDue)[0].providerTransactionId) === '9111',
    'a same-day exact Travel Visa debit on the due date still settles once');
  const grace = observe('2026-09-30', [warriorsTx(9112, '2026-09-30', AMOUNT)]);
  ok(hitsFor(grace).length === 1 && hitsFor(grace)[0].date === DUE,
    '30 Sep is the last day of the incumbent once grace and can still cover this due');
  const twice = observe(AS_OF, [
    warriorsTx(9121, POSTED, AMOUNT),
    warriorsTx(9122, POSTED, AMOUNT),
  ]);
  ok(hitsFor(twice).length === 0,
    'two compatible $895 charges do not settle twice or pick one');
  const ambiguous = (twice.sameDayInboundAmbiguity || [])
    .filter(g => g && g.id === ID && g.date === DUE);
  ok(ambiguous.length === 1 && ambiguous[0].candidateCount === 2,
    'two compatible charges stay ambiguous',
    JSON.stringify(twice.sameDayInboundAmbiguity || []));
}

console.log('\n=== opening cash and a surplus field do not change settlement identity ===');
{
  const txs = settledBundle();
  const low = observe(AS_OF, txs, household(100));
  const high = observe(AS_OF, txs, household(9000, { priorPeriodSurplus: 321.45 }));
  const lowHit = hitsFor(low)[0];
  const highHit = hitsFor(high)[0];
  ok(lowHit && highHit
      && String(lowHit.providerTransactionId) === '9001'
      && String(highHit.providerTransactionId) === String(lowHit.providerTransactionId)
      && lowHit.date === highHit.date && lowHit.postingDate === highHit.postingDate,
    'changing opening cash or stuffing a non-authority surplus field keeps the same matched debit',
    `${lowHit && lowHit.providerTransactionId} vs ${highHit && highHit.providerTransactionId}`);
  ok(!('priorPeriodSurplus' in syntheticPlan(100).commitments[0])
      && !('currentPeriodSurplus' in syntheticPlan(100).commitments[0]),
    'no exact prior/current-period funding split is invented on the commitment');
}

console.log('\n=== sanitized household plan reconciles the same settlement ===');
{
  const data = liveData();
  const row = (data.plan.commitments || []).find(c => c && c.id === ID);
  ok(row && row.label === 'Logan Warriors Elite Academy U13'
      && row.date === DUE && near(row.amount, AMOUNT) && row.amountMin == null
      && row.frequency === 'once' && row.settledOn === POSTED && row.confidence === 'confirmed',
    'live plan.commitments Warriors is exact $895 settled 21 Sep');
  ok(row && !('priorPeriodSurplus' in row) && !('currentPeriodSurplus' in row)
      && row.surplusSplit == null,
    'the live row does not invent a surplus dollar split');
  const pub = F.publicationTotals(data);
  ok(pub.commitmentItems.some(i => i.id === ID && near(i.amount, AMOUNT) && i.amountMin == null),
    'the dated 19 Aug publication still includes the unpaid-relative $895 point');
  const pubDue = F.publicationTotals(Object.assign({}, data, {
    meta: Object.assign({}, data.meta, { asOf: DUE }),
  }));
  ok(!pubDue.commitmentItems.some(i => i.id === ID),
    'publication as of 23 Sep drops Warriors');
  const opts = { scenario: 'expected', weeklyVariable: 0 };
  const open = F.simulate(data.plan, data.meta.asOf, opts);
  const openOff = F.simulate(data.plan, data.meta.asOf, Object.assign({}, opts, { disabled: [ID] }));
  ok(near(openOff.ending - open.ending, AMOUNT),
    'on the dated opening, disabling Warriors removes exactly one $895 cash event',
    (openOff.ending - open.ending).toFixed(2));
  const due = F.simulate(data.plan, DUE, opts);
  const dueOff = F.simulate(data.plan, DUE, Object.assign({}, opts, { disabled: [ID] }));
  ok(near(due.ending, dueOff.ending),
    'on the due date the live walk does not reserve Warriors again');
  const liveReport = observe(AS_OF, [warriorsTx(9301, POSTED, AMOUNT)], data);
  const liveHits = hitsFor(liveReport);
  ok(liveHits.length === 1 && liveHits[0].date === DUE && liveHits[0].postingDate === POSTED
      && String(liveHits[0].providerTransactionId) === '9301'
      && near(Math.abs(liveHits[0].observedAmount), AMOUNT),
    'one synthetic $895 debit against the live plan and identity file is the only Warriors candidate',
    liveHits.map(h => `${h.id}:${h.date}:${h.providerTransactionId}`).join(','));
  const cycle = F.spendingCycle(syntheticPlan(1000), AS_OF);
  ok(cycle && cycle.start === CURRENT_START && cycle.end === '2026-09-24',
    'the proof window is the 11–24 Sep Seaspan cycle',
    cycle && `${cycle.start}–${cycle.end}`);
  ok(COVERAGE_START === '2026-08-28' && PREVIOUS_END === '2026-09-10',
    'coverage includes the previous Seaspan cycle 28 Aug–10 Sep');
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll proofs passed.');
