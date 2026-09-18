'use strict';
/* BC Hydro equal monthly payments $199 from the next bill forward.
 *
 * Owner 2026-09-09 annual-adjustment notice: equal monthly payments
 * become $199.00 on the next bill. The 1 September once due
 * (hydro-due-sep1, $237.45) stays for settlement identity.
 *
 * Independent proof (L-002 / L-006): hand-listed monthly dates at $199
 * from firstDue 2026-10-09, not a second call that merely re-runs
 * expandEvents. Live cents are reconciled separately against that
 * same hand list.
 *
 * `node test/test-hydro-equal-payment.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const R = require('../scripts/reconcile.js');
const O = require('../scripts/provider-observe.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const roundCent = n => Math.round((Number(n) || 0) * 100) / 100;
const load = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));

const EQUAL_ID = 'hydro-equal-payment';
const SEP_ID = 'hydro-due-sep1';
const EQUAL_AMT = 199;
const SEP_AMT = 237.45;
const DAY = 9;
const FIRST_DUE = '2026-10-09';
const SEP_DUE = '2026-09-01';
const JOINT = 'chequing-a';
const HORIZON_END = '2026-12-31';

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function independentMonthlyDates(day, start, end, firstDue) {
  const out = [];
  let [y, m] = start.split('-').map(Number);
  for (;;) {
    const d = Math.min(day, daysInMonth(y, m));
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (iso > end) break;
    if (iso >= start && (!firstDue || iso >= firstDue)) out.push(iso);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function hydroBills(plan) {
  return ((plan && plan.bills) || []).filter(b =>
    b && (/hydro/i.test(String(b.id || '')) || /bc hydro/i.test(String(b.label || ''))));
}

function fixturePlan() {
  return {
    windowDays: 120,
    defaults: { targetBuffer: 0 },
    startingCash: { breakdown: [{ id: JOINT, value: 5000 }] },
    income: [],
    obligations: [],
    bills: [
      {
        id: SEP_ID,
        label: 'BC Hydro due 1 September',
        frequency: 'once',
        date: SEP_DUE,
        amount: SEP_AMT,
        confidence: 'confirmed',
        householdObligation: true,
        payingAccount: JOINT,
      },
      {
        id: EQUAL_ID,
        label: 'BC Hydro equal payment',
        frequency: 'monthly',
        day: DAY,
        firstDue: FIRST_DUE,
        amount: EQUAL_AMT,
        confidence: 'confirmed',
        householdObligation: true,
        payingAccount: JOINT,
      },
    ],
    commitments: [],
  };
}

function liveData() {
  return load('data.json');
}

function identityDoc() {
  return load('docs/connectivity/transaction-identity.json');
}

function fixtureMap() {
  return load('docs/connectivity/fixtures/provider-account-map.json');
}

function observeAt(asOf, txs) {
  return O.observe({
    provider: 'lunchmoney',
    payload: {
      provider: 'lunchmoney',
      fetchedAt: asOf + 'T18:00:00.000Z',
      transactionWindow: {
        startDate: '2026-08-19',
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
          id: 1001, name: 'Fixture Chequing A', type: 'cash', balance: 1000,
          updated_at: asOf + 'T17:55:00.000Z',
        },
        {
          id: 1002, name: 'Fixture Chequing B', type: 'cash', balance: 400,
          updated_at: asOf + 'T17:55:00.000Z',
        },
      ],
      categories: [
        { id: 11, name: 'Shopping', is_income: false, exclude_from_totals: false },
      ],
      transactions: txs,
    },
    accountMap: fixtureMap(),
    data: liveData(),
    identity: identityDoc(),
  });
}

console.log('=== 1. independent October–December $199 dates ===');
{
  const expected = independentMonthlyDates(DAY, '2026-09-01', HORIZON_END, FIRST_DUE);
  ok(expected.join(',') === '2026-10-09,2026-11-09,2026-12-09',
    'hand list is 9 Oct, 9 Nov, 9 Dec — no September equal-payment date',
    expected.join(','));
  ok(expected.every(d => d >= FIRST_DUE) && !expected.includes('2026-09-09'),
    'firstDue 2026-10-09 excludes a 9 September occurrence');
  const independentTotal = roundCent(expected.length * EQUAL_AMT);
  ok(near(independentTotal, 597),
    'independent 3 × $199.00 = $597.00',
    String(independentTotal));
}

console.log('\n=== 2. synthetic expandEvents: Sep once preserved, Oct+ is $199 ===');
{
  const plan = fixturePlan();
  const sepEvents = F.expandEvents(plan, '2026-09-01', '2026-09-30', {});
  const sepOnce = sepEvents.filter(e => e.id === SEP_ID);
  const sepEqual = sepEvents.filter(e => e.id === EQUAL_ID);
  ok(sepOnce.length === 1 && sepOnce[0].date === SEP_DUE
      && near(-sepOnce[0].amount, SEP_AMT)
      && sepOnce[0].jointCash !== false,
    'September still expands the $237.45 once due on 1 September');
  ok(sepEqual.length === 0,
    'September does not expand a $199 equal-payment occurrence');

  const later = F.expandEvents(plan, '2026-10-01', HORIZON_END, {});
  const equal = later.filter(e => e.id === EQUAL_ID).sort((a, b) => a.date.localeCompare(b.date));
  const sepLater = later.filter(e => e.id === SEP_ID);
  const expected = independentMonthlyDates(DAY, '2026-10-01', HORIZON_END, FIRST_DUE);
  ok(equal.map(e => e.date).join(',') === expected.join(','),
    'October–December equal-payment dates match the independent hand list',
    equal.map(e => e.date).join(','));
  ok(equal.every(e => near(-e.amount, EQUAL_AMT) && e.kind === 'bill'
      && e.jointCash !== false && e.payingAccount === JOINT),
    'each equal-payment event is a $199 joint-cash BILLS ACCOUNT bill');
  ok(sepLater.length === 1 && sepLater[0].date === SEP_DUE
      && near(-sepLater[0].amount, SEP_AMT),
    'unpaid Sep. 1 once due remains a single carried $237.45 event, not rewritten as $199');
  const independentSum = roundCent(expected.length * EQUAL_AMT);
  const engineSum = roundCent(equal.reduce((s, e) => s + (-e.amount), 0));
  ok(near(engineSum, independentSum) && near(engineSum, 597),
    'expandEvents equal-payment total agrees with 3 × $199',
    `${engineSum} vs ${independentSum}`);
}

console.log('\n=== 3. occurrence-stub coupling does not hide the Sep. 1 once due ===');
{
  const plan = fixturePlan();
  const sep = plan.bills.find(b => b.id === SEP_ID);
  const monthly = plan.bills.find(b => b.id === EQUAL_ID);
  ok(sep && monthly && !String(sep.id).startsWith(monthly.id + '-'),
    'Sep. 1 once id is not a prefix-stub of hydro-equal-payment');
  const roster = F.householdBills(plan, '2026-08-19');
  const ids = (roster.bills || []).map(r => r.id);
  ok(ids.includes(SEP_ID) && ids.includes(EQUAL_ID),
    'Bills roster keeps both the dated due and the monthly equal-payment row');
  const equalRow = roster.bills.find(r => r.id === EQUAL_ID);
  ok(equalRow && equalRow.frequency === 'monthly' && equalRow.nextDate === FIRST_DUE
      && near(equalRow.monthlyEquivalent, EQUAL_AMT),
    'equal-payment next date is firstDue 2026-10-09 with monthly equivalent $199');
}

console.log('\n=== 4. live plan encodes the owner $199 series without rewriting Sep. 1 ===');
{
  const live = liveData();
  const bills = hydroBills(live.plan);
  const sep = bills.find(b => b.id === SEP_ID);
  const equal = bills.find(b => b.id === EQUAL_ID);
  ok(sep && sep.frequency === 'once' && sep.date === SEP_DUE
      && near(sep.amount, SEP_AMT) && sep.payingAccount === JOINT
      && sep.householdObligation === true,
    'live hydro-due-sep1 remains the $237.45 once due on BILLS ACCOUNT');
  ok(equal && equal.frequency === 'monthly' && equal.day === DAY
      && equal.firstDue === FIRST_DUE && near(equal.amount, EQUAL_AMT)
      && equal.payingAccount === JOINT && equal.householdObligation === true
      && equal.budgetCategory == null && equal.confidence === 'confirmed',
    'live hydro-equal-payment is confirmed $199 monthly from 2026-10-09 on BILLS ACCOUNT');
  ok(!bills.some(b => b.id === 'hydro-due-now'),
    'the settled 14 August Hydro due is still absent');
  ok(bills.length === 2,
    'live Hydro bills are exactly the Sep. 1 once due and the equal-payment series',
    bills.map(b => b.id).join(','));
  ok(!bills.some(b => near(b.amount, 234) || near(b.amount, 207)),
    'historical $234 / $207 equal-payment steps are not scheduled as live bills');
}

console.log('\n=== 5. live expandEvents / trajectory October includes $199 Hydro ===');
{
  const live = liveData();
  const expected = independentMonthlyDates(DAY, '2026-10-01', HORIZON_END, FIRST_DUE);
  const events = F.expandEvents(live.plan, '2026-09-01', HORIZON_END, {});
  const sep = events.filter(e => e.id === SEP_ID);
  const equal = events.filter(e => e.id === EQUAL_ID)
    .sort((a, b) => a.date.localeCompare(b.date));
  const septEqual = equal.filter(e => e.date < FIRST_DUE || e.date.startsWith('2026-09'));
  ok(sep.length === 1 && sep[0].date === SEP_DUE && near(-sep[0].amount, SEP_AMT),
    'live September still expands hydro-due-sep1 at $237.45');
  ok(septEqual.length === 0,
    'live September has no $199 equal-payment event');
  ok(equal.map(e => e.date).join(',') === expected.join(','),
    'live October–December equal-payment dates match the independent hand list');
  ok(equal.every(e => near(-e.amount, EQUAL_AMT)),
    'live equal-payment events are $199, not a metered amount');

  const periods = load('public/periods.json');
  const traj = F.baselineTrajectory(live.plan, live.debts, live.meta.asOf, {
    periods,
    extraFacilities: live.revolvingExtra,
  });
  const oct = (traj.months || []).find(m => m.month === '2026-10');
  ok(traj.status === 'ready' && oct && oct.stage1 && oct.stage1.status !== 'unavailable',
    'live October Stage 1 is published');
  const octLine = ((oct.stage1.bills && oct.stage1.bills.lines) || [])
    .find(r => r && /equal payment/i.test(String(r.label || '')));
  ok(octLine && near(octLine.amount, EQUAL_AMT) && octLine.status === 'calculated',
    'October trajectory bills include the confirmed $199 Hydro equal payment',
    octLine ? `${octLine.label} ${octLine.amount} ${octLine.status}` : 'missing');
  const sepMonth = (traj.months || []).find(m => m.month === '2026-09');
  const sepEqualLine = ((sepMonth && sepMonth.stage1 && sepMonth.stage1.bills
    && sepMonth.stage1.bills.lines) || [])
    .find(r => r && /equal payment/i.test(String(r.label || '')));
  ok(!sepEqualLine,
    'September trajectory bills do not include the $199 equal-payment line');
}

console.log('\n=== 6. settlement identity: Sep. 4 still once; Oct. 9 is the series ===');
{
  const identity = identityDoc();
  const onceRule = (identity.rules || []).find(r => r && r.eventId === SEP_ID);
  const equalRule = (identity.rules || []).find(r => r && r.eventId === EQUAL_ID);
  ok(onceRule && onceRule.atlasAccountId === JOINT
      && onceRule.postingDateRule === 'covers-due-on-or-before-posting'
      && (onceRule.payeePatterns || []).includes('BC Hydro'),
    'hydro-due-sep1 identity is unchanged: payee + BILLS + covers-due');
  ok(equalRule && equalRule.atlasAccountId === JOINT
      && equalRule.direction === 'debit'
      && equalRule.postingDateRule === 'covers-due-on-or-before-posting'
      && (equalRule.payeePatterns || []).includes('BC Hydro')
      && (equalRule.payeePatterns || []).includes('BCHYDRO')
      && !equalRule.settlesWhen,
    'hydro-equal-payment identity is payee + BILLS + covers-due; amount is not identity');

  const sep4 = observeAt('2026-09-04', [{
    id: 9401, account_id: 1001, date: '2026-09-04', amount: 232,
    is_pending: false, payee: 'BC Hydro', original_name: 'BC Hydro',
  }]);
  const sepHits = sep4.representedEventCandidates || [];
  ok(sepHits.some(c => c && c.id === SEP_ID && c.date === SEP_DUE)
      && !sepHits.some(c => c && c.id === EQUAL_ID),
    'Sep. 4 Chequing A BC Hydro still settles hydro-due-sep1 only');

  const oct9 = observeAt('2026-10-09', [{
    id: 9601, account_id: 1001, date: '2026-10-09', amount: 199,
    is_pending: false, payee: 'BCHYDRO', original_name: 'BCHYDRO',
  }]);
  const octHits = oct9.representedEventCandidates || [];
  const octHit = octHits.find(c => c && c.id === EQUAL_ID && c.date === FIRST_DUE);
  ok(octHit && near(octHit.observedAmount, EQUAL_AMT) && octHit.amountNotUsed === true
      && !octHits.some(c => c && c.id === SEP_ID),
    'Oct. 9 Chequing A BCHYDRO settles hydro-equal-payment, not the Sep. 1 once due');

  const oct1 = observeAt('2026-10-01', [{
    id: 9501, account_id: 1001, date: '2026-10-01', amount: 199,
    is_pending: false, payee: 'BC Hydro', original_name: 'BC Hydro',
  }]);
  const oct1Hits = oct1.representedEventCandidates || [];
  ok(!oct1Hits.some(c => c && (c.id === SEP_ID || c.id === EQUAL_ID)),
    'an Oct. 1 debit does not reuse the once due and is before firstDue');
}

console.log('\n=== 7. utility observation MATCHES firstDue; Fortis/Shaw untouched ===');
{
  const live = liveData();
  const utility = load('docs/reconciliation/utility-observations.json');
  const result = R.reconcile({
    data: live,
    map: { mappings: [] },
    observations: [],
    settlements: { observations: [] },
    utility,
  });
  const sepRow = result.rows.find(r => r.observationId === 'payday-hydro-due-sep1');
  const equalRow = result.rows.find(r => r.observationId === 'owner-hydro-equal-payment-199');
  ok(sepRow && sepRow.status === 'MATCH' && near(sepRow.canonicalValue, SEP_AMT)
      && sepRow.canonicalDate === SEP_DUE,
    'Sep. 1 dated-due observation still MATCHES hydro-due-sep1');
  ok(equalRow && equalRow.status === 'MATCH' && near(equalRow.canonicalValue, EQUAL_AMT)
      && equalRow.canonicalDate === FIRST_DUE,
    'equal-payment observation MATCHES hydro-equal-payment firstDue 2026-10-09');

  const fortis = (live.plan.bills || []).find(b => b.id === 'fortis');
  const shaw = (live.plan.bills || []).find(b => b.id === 'shaw');
  ok(fortis && fortis.frequency === 'monthly' && fortis.day === 3 && near(fortis.amount, 124),
    'Fortis is unchanged');
  ok(shaw && shaw.frequency === 'monthly' && shaw.day === 14 && near(shaw.amount, 78.4),
    'Shaw is unchanged');
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nAll BC Hydro equal-payment $199 checks passed.');
