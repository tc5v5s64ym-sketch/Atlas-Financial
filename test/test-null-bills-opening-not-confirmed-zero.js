'use strict';
/* ATLAS-078 — a present Bills (chequing-a) opening row whose value is
 * null or '' carries NO numeric evidence. It must stay UNKNOWN:
 * the Current Balance publication must be unavailable, never a
 * provider-confirmed $0. An evidenced 0 is a real zero and must keep
 * publishing as provider-confirmed $0. A missing row and a non-numeric
 * string already fail closed; the null/'' row must match them.
 *
 * Atlas boundary confirmation 2026-10-15 (rulings A/B):
 *   A — a row flagged `unknown: true` is unknown BEFORE conversion,
 *       even when it carries a numeric value.
 *   B — valid numeric strings and finite numbers (zero and negatives
 *       included) stay evidenced; null/absent values, blank or
 *       whitespace-only strings, booleans, objects/arrays, nonnumeric
 *       and non-finite values are rejected. No truthiness test and no
 *       partial-string parsing ('250abc' is not 250).
 *
 * Measured through Forecast.paydayAllocation(...).currentBalancePublication,
 * the publisher of householdCurrentBalance, plus the exported
 * prePaydayBillsAccountCash caller. The two non-exported callers
 * (operatingCashExplanation, publishedCurrentBalanceAmount) return
 * postedBillsAccountCash's result directly, and the guarded caller
 * (billsAccountPeriodBalance) only ever passes finite non-unknown
 * numbers, so their surfaces are pinned by the neighbouring suites
 * (test-leftover-bills-cash-explanation.js,
 * test-hub-account-balance-after-deductions.js,
 * test-current-balance-chequing-cash.js). Synthetic fixtures only.
 *
 * `node test/test-null-bills-opening-not-confirmed-zero.js`
 */
const F = require('../public/forecast.js');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ' — ' + detail : ''}`);
};

const AS_OF = '2026-01-01';

function fixture(billsRow) {
  const rows = [{ id: 'chequing-b', value: 0 }, { id: 'savings', value: 0 }];
  if (billsRow !== undefined) rows.unshift(billsRow);
  return {
    windowDays: 30,
    defaults: { targetBuffer: 0, extraDebtMonthly: 0, scenario: 'expected' },
    startingCash: { breakdown: rows },
    opening: { asOf: AS_OF },
    budget: { basis: 'ytd', categories: [] },
    income: [{ id: 'pay', label: 'Payday', frequency: 'once', date: '2026-01-15', amount: 2000, confidence: 'confirmed' }],
    bills: [], obligations: [], commitments: [],
  };
}
const publication = row => {
  const alloc = F.paydayAllocation(fixture(row), AS_OF, {});
  return alloc && alloc.currentBalancePublication;
};
const unavailable = (pub, label) => ok(
  pub && pub.amount === null && pub.status === 'unavailable' && pub.providerConfirmed === false,
  label,
  `amount=${pub && pub.amount} status=${pub && pub.status} providerConfirmed=${pub && pub.providerConfirmed}`);
const confirmed = (pub, amount, label) => ok(
  pub && pub.amount === amount && pub.status === 'provider-confirmed' && pub.providerConfirmed === true,
  label,
  `amount=${pub && pub.amount} status=${pub && pub.status} providerConfirmed=${pub && pub.providerConfirmed}`);

/* Defect cases: present row, no numeric evidence -> must be unavailable. */
for (const [name, row] of [
  ['value null', { id: 'chequing-a', value: null }],
  ['value "" (empty string)', { id: 'chequing-a', value: '' }],
]) {
  const pub = publication(row);
  ok(pub && pub.amount === null, `${name}: amount stays unknown (null)`,
    `amount=${pub && pub.amount}`);
  ok(pub && pub.status === 'unavailable', `${name}: status is unavailable`,
    `status=${pub && pub.status}`);
  ok(pub && pub.providerConfirmed === false, `${name}: not provider-confirmed`,
    `providerConfirmed=${pub && pub.providerConfirmed}`);
}

/* A null row must not be indistinguishable from an evidenced zero. */
{
  const nullPub = publication({ id: 'chequing-a', value: null });
  const zeroPub = publication({ id: 'chequing-a', value: 0 });
  ok(JSON.stringify(nullPub) !== JSON.stringify(zeroPub),
    'null row publication differs from evidenced-zero publication');
}

/* Controls: these pass today and must keep passing after the repair. */
{
  const zero = publication({ id: 'chequing-a', value: 0 });
  ok(zero && zero.amount === 0 && zero.status === 'provider-confirmed' && zero.providerConfirmed === true,
    'evidenced zero stays provider-confirmed $0',
    JSON.stringify(zero && { amount: zero.amount, status: zero.status }));
  const v250 = publication({ id: 'chequing-a', value: 250 });
  ok(v250 && v250.amount === 250 && v250.status === 'provider-confirmed' && v250.providerConfirmed === true,
    'evidenced 250 stays provider-confirmed 250');
  const absent = publication(undefined);
  ok(absent && absent.amount === null && absent.status === 'unavailable' && absent.providerConfirmed === false,
    'absent row stays unavailable');
  const abc = publication({ id: 'chequing-a', value: 'abc' });
  ok(abc && abc.amount === null && abc.status === 'unavailable' && abc.providerConfirmed === false,
    'non-numeric string stays unavailable');
}

/* Supplementary defect shapes (rulings A/B): no numeric evidence, or
 * evidence expressly flagged unknown -> unavailable. */
unavailable(publication({ id: 'chequing-a', value: '  ' }),
  'value "  " (whitespace-only string) is unavailable');
unavailable(publication({ id: 'chequing-a', value: true }),
  'value true (boolean) is unavailable');
unavailable(publication({ id: 'chequing-a', value: false }),
  'value false (boolean) is unavailable');
unavailable(publication({ id: 'chequing-a', value: {} }),
  'value {} (object) is unavailable');
unavailable(publication({ id: 'chequing-a', value: [] }),
  'value [] (array) is unavailable');
unavailable(publication({ id: 'chequing-a', value: [250] }),
  'value [250] (array) is unavailable');
unavailable(publication({ id: 'chequing-a', value: 0, unknown: true }),
  'value 0 with unknown:true is unavailable (ruling A)');
unavailable(publication({ id: 'chequing-a', value: 250, unknown: true }),
  'value 250 with unknown:true is unavailable (ruling A)');
unavailable(publication({ id: 'chequing-a' }),
  'value key absent on the row is unavailable');
unavailable(publication({ id: 'chequing-a', value: undefined }),
  'value undefined (key present) is unavailable');

/* Supplementary boundary controls: malformed values that already fail
 * closed stay closed; no partial-string parsing is introduced. */
unavailable(publication({ id: 'chequing-a', value: '250abc' }),
  'value "250abc" (partial numeric string) is unavailable');
unavailable(publication({ id: 'chequing-a', value: 'Infinity' }),
  'value "Infinity" (string) is unavailable');
unavailable(publication({ id: 'chequing-a', value: Infinity }),
  'value Infinity is unavailable');
unavailable(publication({ id: 'chequing-a', value: -Infinity }),
  'value -Infinity is unavailable');
unavailable(publication({ id: 'chequing-a', value: NaN }),
  'value NaN is unavailable');
{
  const fx = fixture(undefined);
  fx.startingCash.breakdown.unshift(
    { id: 'chequing-a', value: 250 }, { id: 'chequing-a', value: 250 });
  const alloc = F.paydayAllocation(fx, AS_OF, {});
  unavailable(alloc && alloc.currentBalancePublication,
    'duplicate chequing-a rows stay unavailable');
}

/* Supplementary preservation controls (ruling B): valid supported
 * inputs keep publishing exactly as evidenced. */
confirmed(publication({ id: 'chequing-a', value: '0' }), 0,
  'value "0" (numeric string) stays provider-confirmed $0');
confirmed(publication({ id: 'chequing-a', value: '250' }), 250,
  'value "250" (numeric string) stays provider-confirmed 250');
confirmed(publication({ id: 'chequing-a', value: -50 }), -50,
  'value -50 (negative) stays provider-confirmed -50');
confirmed(publication({ id: 'chequing-a', value: '-50' }), -50,
  'value "-50" (negative string) stays provider-confirmed -50');
confirmed(publication({ id: 'chequing-a', value: ' 250 ' }), 250,
  'value " 250 " (padded numeric string) stays provider-confirmed 250');
confirmed(publication({ id: 'chequing-a', value: 250, unknown: false }), 250,
  'value 250 with unknown:false stays provider-confirmed 250');

/* Caller preservation: an unknown postedBillsAccountCash return must
 * propagate through its callers as unavailable, never as a walked 0.
 * The opening is dated the eve of the payday, so prePaydayBillsAccountCash
 * takes its direct branch and returns the posted figure itself. */
{
  const eveFixture = row => {
    const plan = fixture(row);
    plan.opening.asOf = '2026-01-14';
    return plan;
  };
  const preNull = F.prePaydayBillsAccountCash(
    eveFixture({ id: 'chequing-a', value: null }), '2026-01-15', {});
  ok(preNull === null, 'prePaydayBillsAccountCash: null row stays unknown (null)',
    `returned=${preNull}`);
  const pre250 = F.prePaydayBillsAccountCash(
    eveFixture({ id: 'chequing-a', value: 250 }), '2026-01-15', {});
  ok(pre250 === 250, 'prePaydayBillsAccountCash: evidenced 250 preserved',
    `returned=${pre250}`);
}

console.log('\n' + (failures ? `${failures} failure(s)` : 'All ATLAS-078 null-Bills-opening checks passed'));
process.exit(failures === 0 ? 0 : 1);
