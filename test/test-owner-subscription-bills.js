'use strict';
/* Owner-confirmed recurring subscription bills.
 *
 * Dates below are hand-computed from the owner cadence and the calendar, not
 * taken from Forecast.occurrences. The engine is then asked whether it
 * reproduces that list. Payday membership is proved against those same
 * hand dates and the incumbent payroll cadence, not against a Pay Period
 * 1 / Pay Period 2 map.
 *
 * `node test/test-owner-subscription-bills.js`
 */
const F = require('../public/forecast.js');
const data = require('../data.json');
const periods = require('../public/periods.json');
const { sourceText } = require('./test-source-text');
const fs = require('fs');
const path = require('path');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const sameDates = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const clone = x => JSON.parse(JSON.stringify(x));

const plan = data.plan;
const asOf = data.meta.asOf;
const horizon = F.knowledgeHorizon(plan, asOf);
const viewEnd = F.addDays(asOf, (plan.windowDays || 91) - 1);

const OWNER = {
  netflix: { id: 'netflix', amount: 26.87, day: 17, frequency: 'monthly' },
  spotify: { id: 'spotify', amount: 26.87, day: 17, frequency: 'monthly' },
  'google-storage-100gb': { id: 'google-storage-100gb', amount: 3.13, day: 31, frequency: 'monthly' },
  'ultimate-guitar': { id: 'ultimate-guitar', amount: 50, month: 5, day: 8, frequency: 'yearly' },
  'icloud-storage': { id: 'icloud-storage', amount: 13, day: 14, frequency: 'monthly' },
  'youtube-premium': { id: 'youtube-premium', amount: 17, day: 2, frequency: 'monthly' },
  'chatgpt-plus-dale': {
    id: 'chatgpt-plus-dale', amount: 28, day: 14, frequency: 'monthly', confidence: 'estimated',
  },
  'chatgpt-plus-amanda': {
    id: 'chatgpt-plus-amanda', amount: 24.99, day: 14, frequency: 'monthly',
  },
};
const CANCELLED = ['canva', 'mailchimp', 'guitar-tabs', 'github'];

// Independent of Forecast.occurrences: next 17ths after 2026-08-19.
const NETFLIX_91 = ['2026-09-17', '2026-10-17', '2026-11-17'];
const ICLOUD_91 = ['2026-09-14', '2026-10-14', '2026-11-14'];
const YOUTUBE_91 = ['2026-09-02', '2026-10-02', '2026-11-02'];
const CHATGPT_91 = ['2026-09-14', '2026-10-14', '2026-11-14'];
// Next May 8 after 2026-08-19 is 2027-05-08. The following year is 2028-05-08.
const GUITAR_FORWARD = ['2027-05-08'];
// Independent payday dates are income ≥ $1,000, not a bill-to-period map.
// Seaspan biweekly from 2026-08-14: 14 Aug, 28 Aug, 11 Sep, 25 Sep.
// Amanda Tennis BC: 15th monthly and month-end (day 31 clamped).
// Child benefit $153.59 is below the $1,000 payday floor.
const PAYDAY_AUG31 = '2026-08-31';
const PAYDAY_SEP11 = '2026-09-11';
const PAYDAY_SEP15 = '2026-09-15';
const PERIOD_END_AUG31 = '2026-09-10'; // next payday 11 Sep
const PERIOD_END_SEP11 = '2026-09-14'; // next payday 15 Sep
const PERIOD_END_SEP15 = '2026-09-24'; // next payday 25 Sep
const CLUSTER_14 = {
  'icloud-storage': '2026-09-14',
  'chatgpt-plus-dale': '2026-09-14',
  'chatgpt-plus-amanda': '2026-09-14',
};

function billEvents(id, start, end) {
  return F.expandEvents(plan, start, end).filter(e => e.id === id);
}
function idsOn(items, date) {
  return (items || []).filter(row => row && row.date === date).map(row => row.id).sort();
}

console.log('=== live rows carry the owner-confirmed cadence ===');
{
  for (const spec of Object.values(OWNER)) {
    const row = (plan.bills || []).find(b => b.id === spec.id);
    ok(!!row, `${spec.id} exists on plan.bills`);
    ok(row && row.frequency === spec.frequency && row.day === spec.day
      && near(row.amount, spec.amount)
      && (spec.month == null || row.month === spec.month)
      && row.budgetCategory === 'subscriptions'
      && row.payingAccount === 'chequing-a',
      `${spec.id} keeps owner cadence, subscriptions category, and BILLS ACCOUNT payer`);
  }
  const dale = (plan.bills || []).find(b => b.id === 'chatgpt-plus-dale');
  ok(dale && dale.confidence === 'estimated',
    'Dale ChatGPT Plus stays estimated, not promoted to confirmed');
  const amanda = (plan.bills || []).find(b => b.id === 'chatgpt-plus-amanda');
  ok(amanda && amanda.confidence === 'confirmed',
    'Amanda ChatGPT Plus is the confirmed iOS amount');
  ok(!(plan.bills || []).some(b => /pay period/i.test(JSON.stringify(b))),
    'no bill row names a Pay Period 1 / Pay Period 2 owner');
  ok(/future planned payingAccount for dated bills, dated subscriptions, card minimums, HELOC cash minimum, and undated Bell is BILLS ACCOUNT/i
    .test(plan.billsNote),
    'bill note records the owner BILLS ACCOUNT paying-account remap');
  ok(/Historical Lunch Money postings are not rewritten/i.test(plan.billsNote),
    'bill note does not rewrite historical Lunch Money postings');
  for (const id of CANCELLED) {
    ok(!(plan.bills || []).some(b => b.id === id),
      `${id} has no forward plan.bills recurrence`);
  }
  ok(!(plan.bills || []).some(b => /canva|mailchimp|mail chimp|guitar tabs|github/i.test(b.label || '')),
    'cancelled merchant names are not live bill labels');
  ok(/Canva, Mailchimp, Guitar Tabs monthly, and GitHub annual have no forward recurrence/i
    .test(plan.billsNote),
    'cancelled services are recorded without deleting history');
  ok(/Instacart and Uber are not recorded as moved/i.test(plan.billsNote),
    'Instacart and Uber are not claimed as moved off PayPal');
  const home = (plan.commitments || []).find(c => c.id === 'home-insurance');
  ok(home && near(home.amount, 3131.76) && !near(home.amount, 6000),
    'Square One planning stays the last verified ~$3,132, not $6,000');
  ok(/not \$6,000\/year/i.test(home.note || ''),
    'home-insurance note records the owner $3,000-not-$6,000 correction');
}

console.log('\n=== hand-computed calendar dates through expandEvents ===');
{
  ok(asOf === '2026-08-19', 'canonical opening as-of is 2026-08-19', asOf);
  ok(viewEnd === '2026-11-17',
    '91-day view end is 19 Aug + 90 days = 17 Nov', viewEnd);

  const netflix = billEvents('netflix', asOf, viewEnd).map(e => e.date);
  ok(sameDates(netflix, NETFLIX_91),
    'Netflix expands on the 17th', netflix.join(', '));
  ok(billEvents('netflix', asOf, viewEnd).every(e => near(-e.amount, 26.87) && e.kind === 'bill'),
    'each Netflix cash event is −$26.87');
  const spotify = billEvents('spotify', asOf, viewEnd).map(e => e.date);
  ok(sameDates(spotify, NETFLIX_91),
    'Spotify expands on the same 17ths as Netflix', spotify.join(', '));
  const google = billEvents('google-storage-100gb', asOf, viewEnd).map(e => e.date);
  ok(sameDates(google, ['2026-08-31', '2026-09-30', '2026-10-31']),
    'Google storage uses last calendar day', google.join(', '));

  const icloud = billEvents('icloud-storage', asOf, viewEnd).map(e => e.date);
  ok(sameDates(icloud, ICLOUD_91),
    'iCloud expands on the 14th', icloud.join(', '));

  const youtube = billEvents('youtube-premium', asOf, viewEnd).map(e => e.date);
  ok(sameDates(youtube, YOUTUBE_91),
    'YouTube Premium expands on the 2nd', youtube.join(', '));

  const dale = billEvents('chatgpt-plus-dale', asOf, viewEnd);
  const amanda = billEvents('chatgpt-plus-amanda', asOf, viewEnd);
  ok(sameDates(dale.map(e => e.date), CHATGPT_91)
      && dale.every(e => near(-e.amount, 28) && e.confidence === 'estimated'),
    'Dale ChatGPT Plus expands on the 14th at the estimated $28');
  ok(sameDates(amanda.map(e => e.date), CHATGPT_91)
      && amanda.every(e => near(-e.amount, 24.99) && e.confidence === 'confirmed'),
    'Amanda ChatGPT Plus expands on the 14th at $24.99');

  const guitarView = billEvents('ultimate-guitar', asOf, viewEnd);
  const guitarMaster = billEvents('ultimate-guitar', asOf, horizon.end);
  ok(guitarView.length === 0,
    'Ultimate Guitar is outside the 91-day view');
  ok(sameDates(guitarMaster.map(e => e.date), GUITAR_FORWARD)
      && guitarMaster.every(e => near(-e.amount, 50) && e.kind === 'bill'),
    'master horizon has the hand-computed 8 May 2027 yearly due',
    guitarMaster.map(e => e.date).join(', '));
  ok(!guitarMaster.some(e => e.date === '2026-05-08'),
    'May 8 2026 is not invented as unpaid arrears');
}

console.log('\n=== synthetic yearly primitive (not the live May 8 list) ===');
{
  const item = { frequency: 'yearly', month: 5, day: 8 };
  ok(sameDates(F.occurrences(item, '2026-08-19', '2028-12-31'),
    ['2027-05-08', '2028-05-08']),
    'May 8 from a mid-August start is next May then the year after');
  ok(sameDates(F.occurrences(item, '2027-05-08', '2027-05-08'),
    ['2027-05-08']),
    'a window that is exactly May 8 includes that date');
  ok(sameDates(F.occurrences(item, '2026-05-01', '2026-05-31'),
    ['2026-05-08']),
    'a May 2026 window includes 8 May 2026');
  ok(sameDates(F.occurrences(item, '2026-05-09', '2027-05-07'),
    []),
    'the gap after 8 May 2026 and before 8 May 2027 is empty');
  ok(sameDates(F.occurrences({ frequency: 'yearly', day: 8 }, '2026-01-01', '2027-12-31'),
    []),
    'yearly without month fails closed');
  ok(sameDates(F.occurrences({ frequency: 'yearly', month: 5 }, '2026-01-01', '2027-12-31'),
    []),
    'yearly without day fails closed');
  ok(sameDates(F.occurrences(
    { frequency: 'yearly', month: 5, day: 8, firstDue: '2028-05-08' },
    '2026-08-19', '2028-12-31'),
    ['2028-05-08']),
    'firstDue filters 2027 without shifting the May 8 cadence');
}

console.log('\n=== mid-month 14th–17th cluster follows incumbent payday windows ===');
{
  const o = {
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    periods,
    paydayFloor: 1000,
  };
  const on11 = F.paydayAllocation(plan, PAYDAY_SEP11, o);
  ok(on11.mode === 'payday' && on11.periodEnd === PERIOD_END_SEP11
      && on11.payday === PAYDAY_SEP15,
    '11 Sep payday period ends 14 Sep because Amanda salary lands the 15th',
    `${on11.mode} end ${on11.periodEnd} next ${on11.payday}`);
  for (const [id, date] of Object.entries(CLUSTER_14)) {
    const item = (on11.obligations.items || []).find(row => row.id === id && row.date === date);
    ok(item && item.kind === 'bill' && near(item.amount, OWNER[id].amount),
      `${id} on ${date} is reserved from the 11 Sep payday`,
      item ? `${item.date} ${item.amount}` : 'missing');
  }
  ok(!(on11.obligations.items || []).some(row => row.id === 'netflix' && row.date === '2026-09-17'),
    'Netflix 17 Sep is after the 15 Sep income, so it is not an 11 Sep obligation');
  ok(!(on11.obligations.items || []).some(row => row.id === 'youtube-premium' && row.date === '2026-09-02'),
    'YouTube Premium 2 Sep is not an 11 Sep obligation');
  ok(!(on11.obligations.items || []).some(row => row.id === 'ultimate-guitar'),
    'annual 8 May Ultimate Guitar is not pulled into September');

  const action11 = F.currentPeriodAction(plan, PAYDAY_SEP11, o);
  ok(action11.mode === 'payday' && action11.periodEnd === PERIOD_END_SEP11,
    'current-period action uses the same 11–14 Sep window');
  ok(sameDates(idsOn(on11.obligations.items, '2026-09-14'), idsOn(action11.bills, '2026-09-14')),
    'paydayAllocation and currentPeriodAction name the same 14 Sep bills');

  const on15 = F.paydayAllocation(plan, PAYDAY_SEP15, o);
  ok(on15.mode === 'payday' && on15.periodEnd === PERIOD_END_SEP15
      && on15.payday === '2026-09-25',
    '15 Sep payday period is independently 15–24 Sep',
    `${on15.mode} end ${on15.periodEnd} next ${on15.payday}`);
  const netflix = (on15.obligations.items || [])
    .find(row => row.id === 'netflix' && row.date === '2026-09-17');
  const spotify = (on15.obligations.items || [])
    .find(row => row.id === 'spotify' && row.date === '2026-09-17');
  ok(netflix && near(netflix.amount, 26.87),
    'Netflix 17 Sep is reserved from the 15 Sep payday');
  ok(spotify && near(spotify.amount, 26.87),
    'Spotify 17 Sep is reserved from the 15 Sep payday');
  ok(!(on15.obligations.items || []).some(row =>
    Object.prototype.hasOwnProperty.call(CLUSTER_14, row.id) && row.date === '2026-09-14'),
    'the 14 Sep bills are not re-reserved on 15 Sep');
  const action15 = F.currentPeriodAction(plan, PAYDAY_SEP15, o);
  const actionNetflix = (action15.bills || [])
    .find(row => row.id === 'netflix' && row.date === '2026-09-17');
  ok(actionNetflix && actionNetflix.settlement === 'upcoming',
    'current-period on 15 Sep still lists Netflix 17 Sep as upcoming');
}

console.log('\n=== YouTube on the 2nd is reserved from the payday that covers 31 Aug–10 Sep ===');
{
  const o = {
    debts: data.debts,
    extraFacilities: data.revolvingExtra,
    periods,
    paydayFloor: 1000,
  };
  const alloc = F.paydayAllocation(plan, PAYDAY_AUG31, o);
  ok(alloc.mode === 'payday' && alloc.periodEnd === PERIOD_END_AUG31
      && alloc.payday === PAYDAY_SEP11,
    '31 Aug payday period is independently 31 Aug–10 Sep',
    `${alloc.mode} end ${alloc.periodEnd} next ${alloc.payday}`);
  const youtube = (alloc.obligations.items || [])
    .find(row => row.id === 'youtube-premium' && row.date === '2026-09-02');
  ok(youtube && near(youtube.amount, 17),
    'YouTube Premium 2 Sep is an obligation of the 31 Aug payday');
  const google = (alloc.obligations.items || [])
    .find(row => row.id === 'google-storage-100gb' && row.date === '2026-08-31');
  ok(google && near(google.amount, 3.13),
    'Google storage month-end due is reserved from the 31 Aug payday');
  ok(!(alloc.obligations.items || []).some(row =>
    (row.id === 'netflix' && row.date === '2026-09-17')
    || (Object.prototype.hasOwnProperty.call(CLUSTER_14, row.id) && row.date === '2026-09-14')),
    'the 14th–17th cluster is not assigned to the 31 Aug payday');

  const action = F.currentPeriodAction(plan, PAYDAY_AUG31, o);
  const actionYt = (action.bills || [])
    .find(row => row.id === 'youtube-premium' && row.date === '2026-09-02');
  ok(actionYt && actionYt.settlement === 'upcoming',
    'current-period on 31 Aug also keeps YouTube Premium as upcoming on 2 Sep');
}

console.log('\n=== dated subtraction uses yearly amount/12, not $50/month ===');
{
  const budget = F.budgetBreakdown(plan, periods, {
    paypalPerMonth: data.paypal && data.paypal.perMonth,
    asOf,
  });
  const subs = budget.categories.find(c => c.id === 'subscriptions');
  const independentDated = 26.87 + 26.87 + 3.13 + 13 + 17 + 28 + 24.99 + (50 / 12);
  ok(subs && near(subs.dated, independentDated),
    'subscriptions dated total is the owner bills, yearly as amount/12',
    String(subs && subs.dated));
  ok(subs.datedItems.some(item => item.label === 'Ultimate Guitar'
      && near(item.amount, 50 / 12)),
    'Ultimate Guitar dated subtraction is $50/12, not $50');
}

console.log('\n=== no second bill engine, calendar, or payday map ===');
{
  const forecastSrc = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public', 'forecast.js'), 'utf8'));
  const recordsSrc = sourceText(fs.readFileSync(path.join(__dirname, '..', 'public', 'records.js'), 'utf8'));
  ok(/function yearlyDates/.test(forecastSrc)
      && /item\.frequency === 'yearly'/.test(forecastSrc),
    'yearly cadence lives inside Forecast.occurrences');
  ok(/frequency === 'yearly' \? b\.amount \/ 12/.test(forecastSrc),
    'budget dated conversion uses amount/12 for yearly bills');
  ok(/frequency === 'yearly' \? 'yearly'/.test(recordsSrc),
    'Records labels yearly as yearly, not monthly');
  ok(!/payPeriod\s*[:=]|paydayMap|billToPayday/i.test(forecastSrc),
    'Forecast did not grow a bill-to-pay-period map');
}

console.log('\n=== amount edit on the canonical yearly row reaches expandEvents ===');
{
  const edited = clone(plan);
  const row = edited.bills.find(b => b.id === 'ultimate-guitar');
  row.amount = 60;
  const events = F.expandEvents(edited, asOf, horizon.end)
    .filter(e => e.id === 'ultimate-guitar');
  ok(events.length === 1 && events[0].date === '2027-05-08' && near(-events[0].amount, 60),
    'the 8 May 2027 cash event follows the edited yearly amount');
}

if (failures) {
  console.error(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
