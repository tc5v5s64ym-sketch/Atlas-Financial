'use strict';
/* Independent proof that Square One home insurance is the dated yearly
 * card-paid plan.bills row, so February Forecast publishes ~$3,131.76 on
 * 10 February 2027 as reserved gravity — not a joint-cash Bills expander
 * line, not a Household Budget plannedMonthly, and not an undated
 * commitment.
 *
 * Next 10 February after the 2026-08-19 opening is hand-computed from the
 * calendar, not taken from Forecast.occurrences. The $3,131.76 figure is
 * the owner/evidence last-verified payment, not a live data.json read-back
 * used as the specification.
 *
 * `node test/test-square-one-annual-bill.js`
 */
const fs = require('fs');
const path = require('path');
const F = require('../public/forecast.js');
const live = require('../data.json');
const periods = require('../public/periods.json');
const { sourceText } = require('./test-source-text');

let failures = 0;
const ok = (cond, label, detail = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const near = (a, b, eps = 0.005) => Math.abs(Number(a) - Number(b)) <= eps;
const sameDates = (got, want) => JSON.stringify(got) === JSON.stringify(want);
const clone = x => JSON.parse(JSON.stringify(x));
const roundCent = n => Math.round(Number(n) * 100) / 100;

const AS_OF = '2026-08-19';
const LAST_PAID = '2026-02-10';
const NEXT_DUE = '2027-02-10';
const PREMIUM = 3131.76;
const OPENING = 20000;
const VIEW_END = '2026-11-17';
const FEB_START = '2027-02-01';
const FEB_END = '2027-02-28';

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function pad(n) {
  return String(n).padStart(2, '0');
}
// Independent of Forecast.yearlyDates / occurrences: next month/day on or
// after start, optionally filtered by firstDue.
function independentNextYearly(month, day, start, firstDue) {
  const m = Number(month);
  const requested = Number(day);
  let y = Number(String(start).slice(0, 4));
  for (let i = 0; i < 8; i++) {
    const d = Math.min(requested, daysInMonth(y, m));
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    if (iso >= start && (!firstDue || iso >= firstDue)) return iso;
    y += 1;
  }
  return null;
}

function syntheticPlan() {
  return {
    windowDays: 31,
    defaults: { targetBuffer: 0 },
    startingCash: {
      amount: OPENING,
      breakdown: [{ id: 'chequing-a', label: 'BILLS ACCOUNT', value: OPENING }],
    },
    income: [],
    obligations: [],
    bills: [{
      id: 'square-one',
      label: 'Square One home insurance',
      frequency: 'yearly',
      month: 2,
      day: 10,
      amount: PREMIUM,
      confidence: 'estimated',
      budgetCategory: null,
      jointCash: false,
      firstDue: NEXT_DUE,
    }],
    commitments: [],
  };
}

const plan = live.plan;
const asOf = live.meta.asOf;
const horizon = F.knowledgeHorizon(plan, asOf);
const facts = sourceText(fs.readFileSync(path.join(__dirname, '..', 'docs/ACCOUNT_FACTS.md'), 'utf8'));

console.log('=== live row is the owner yearly card-paid bill ===');
{
  ok(asOf === AS_OF, 'canonical opening as-of is 2026-08-19', asOf);
  const row = (plan.bills || []).find(b => b.id === 'square-one');
  ok(!!row, 'square-one exists on plan.bills');
  ok(row && row.frequency === 'yearly' && row.month === 2 && row.day === 10
      && near(row.amount, PREMIUM) && row.firstDue === NEXT_DUE
      && row.jointCash === false && row.budgetCategory == null
      && row.payingAccount == null && row.confidence === 'estimated',
    'square-one is yearly 10 February, firstDue 2027-02-10, card-paid, no invented category or card');
  ok(row && /not \$6,000\/year/i.test(row.note || '') && /B69/.test(row.note || ''),
    'note keeps the $3,000-not-$6,000 correction and open paying-card question');
  ok(!(plan.commitments || []).some(c => c.id === 'home-insurance' || /square one/i.test(c.label || '')),
    'undated home-insurance commitment is gone — one Forecast home');
  ok(!(plan.budget.categories || []).some(c => c.id === 'square-one'
      || /square one/i.test(c.label || '')),
    'no Square One Household Budget category was invented');
  const insurance = (plan.budget.categories || []).find(c => c.id === 'insurance');
  ok(insurance && insurance.plannedMonthly == null,
    'insurance plannedMonthly stays unset — Square One is not a monthly budget hold');
  ok(/Square One home insurance \$3,131\.76 yearly on 10 February/i.test(plan.billsNote || ''),
    'billsNote records the dated yearly card-paid Square One row');
}

console.log('\n=== independent next 10 February is 2027-02-10 ===');
{
  const next = independentNextYearly(2, 10, AS_OF, NEXT_DUE);
  ok(next === NEXT_DUE,
    'hand calendar: next 10 Feb on or after 2026-08-19 and firstDue is 2027-02-10',
    String(next));
  ok(LAST_PAID < AS_OF && NEXT_DUE > AS_OF,
    'last paid 2026-02-10 is before as-of; next due is after as-of');
  ok(independentNextYearly(2, 10, AS_OF) === NEXT_DUE,
    'without firstDue the next 10 Feb after 19 Aug 2026 is still 2027-02-10');
}

console.log('\n=== synthetic expander: card-paid reserved, not joint-cash bills ===');
{
  const fx = syntheticPlan();
  const events = F.expandEvents(fx, FEB_START, FEB_END);
  const sq = events.filter(e => e.id === 'square-one');
  ok(sq.length === 1 && sq[0].date === NEXT_DUE && near(-sq[0].amount, PREMIUM)
      && sq[0].kind === 'bill' && sq[0].cardPaid === true && sq[0].jointCash === false,
    'February expander emits one card-paid Square One event on 2027-02-10',
    sq[0] ? `${sq[0].date} ${sq[0].amount} cardPaid=${sq[0].cardPaid}` : 'missing');
  ok(!F.expandEvents(fx, '2026-02-01', '2026-02-28').some(e => e.id === 'square-one'),
    'firstDue withholds the settled 2026-02-10 payment as unpaid arrears');

  const sim = F.simulate(fx, FEB_START);
  ok(near(sim.totals.reserved, PREMIUM) && near(sim.totals.bills, 0),
    'simulate reserves $3,131.76 on the planning day and does not count it as joint-cash bills',
    `reserved=${sim.totals.reserved} bills=${sim.totals.bills}`);
  const day = (sim.daily || []).find(d => d.date === NEXT_DUE)
    || (sim.weeks || []).find(w => w.start <= NEXT_DUE && w.end >= NEXT_DUE);
  ok(day, 'simulate walk covers 2027-02-10');
}

console.log('\n=== live Forecast publishes February 2027 Square One ===');
{
  ok(horizon && horizon.end >= NEXT_DUE,
    'knowledge horizon reaches 2027-02-10',
    horizon && horizon.end);
  const viewEvents = F.expandEvents(plan, asOf, VIEW_END).filter(e => e.id === 'square-one');
  ok(viewEvents.length === 0,
    '91-day view from 19 Aug does not smear February Square One across autumn');

  const master = F.expandEvents(plan, asOf, horizon.end).filter(e => e.id === 'square-one');
  ok(sameDates(master.map(e => e.date), [NEXT_DUE])
      && master.every(e => near(-e.amount, PREMIUM) && e.kind === 'bill'
        && e.cardPaid === true && e.jointCash === false),
    'master horizon has the hand-computed 10 February 2027 yearly due',
    master.map(e => e.date).join(', '));
  ok(!master.some(e => e.date === LAST_PAID),
    '2026-02-10 is not invented as unpaid arrears');

  const febEvents = F.expandEvents(plan, FEB_START, FEB_END);
  const febSquare = febEvents.filter(e => e.id === 'square-one');
  ok(febSquare.length === 1 && near(-febSquare[0].amount, PREMIUM)
      && febSquare[0].cardPaid === true,
    'February 2027 expandEvents includes Square One $3,131.76 card-paid');
  const jointCashBills = febEvents.filter(e =>
    e && e.kind === 'bill' && e.jointCash !== false && !e.cardPaid);
  ok(!jointCashBills.some(e => e.id === 'square-one'),
    'joint-cash February bill filter excludes Square One (same path as Bell)');

  const traj = F.baselineTrajectory(plan, live.debts, asOf, { periods });
  const feb = (traj && traj.months || []).find(m => m.month === '2027-02');
  ok(feb && feb.stage1 && feb.stage1.bills,
    'Forecast month February 2027 publishes stage1 bills');
  const billLines = (feb.stage1.bills.lines || []).map(l => l.label || '');
  ok(!billLines.some(label => /square one/i.test(label)),
    'February Forecast month Bills expander does not list card-paid Square One',
    billLines.join(' | ') || 'aggregate-only');
  const withoutPlan = clone(plan);
  withoutPlan.bills = (withoutPlan.bills || []).filter(b => b.id !== 'square-one');
  const trajWithout = F.baselineTrajectory(withoutPlan, live.debts, asOf, { periods });
  const febWithout = (trajWithout && trajWithout.months || []).find(m => m.month === '2027-02');
  ok(febWithout && near(feb.stage1.bills.amount, febWithout.stage1.bills.amount),
    'removing Square One does not change February stage1.bills — card-paid is excluded from that expander',
    `${feb.stage1.bills.amount} vs ${febWithout && febWithout.stage1.bills.amount}`);

  const withRow = clone(plan);
  withRow.windowDays = Math.max(1, F.diffDays(asOf, NEXT_DUE) + 7);
  const without = clone(withRow);
  without.bills = (without.bills || []).filter(b => b.id !== 'square-one');
  const simWith = F.simulate(withRow, asOf);
  const simWithout = F.simulate(without, asOf);
  ok(near(simWith.totals.reserved - simWithout.totals.reserved, PREMIUM)
      && near(simWith.totals.bills, simWithout.totals.bills),
    'live simulate reserved gravity of Square One is independently $3,131.76; joint-cash bills unchanged',
    `Δreserved=${(simWith.totals.reserved - simWithout.totals.reserved).toFixed(2)} Δbills=${(simWith.totals.bills - simWithout.totals.bills).toFixed(2)}`);
}

console.log('\n=== Bills roster next date is 2027-02-10; not a subscription ===');
{
  const view = F.householdBills(plan, asOf);
  const row = (view.bills || []).find(b => b.id === 'square-one');
  ok(row && row.frequency === 'yearly' && row.nextDate === NEXT_DUE
      && near(row.amount, PREMIUM)
      && near(row.monthlyEquivalent, roundCent(PREMIUM / 12)),
    'householdBills publishes yearly Square One, next 2027-02-10, monthly equivalent amount/12',
    row ? `${row.nextDate} eq=${row.monthlyEquivalent}` : 'missing');
  const subs = F.householdSubscriptions(plan, asOf);
  ok(!(subs.subscriptions || []).some(s => s.id === 'square-one'),
    'Square One is a household bill, not a subscription');
}

console.log('\n=== ACCOUNT_FACTS records the standing terms ===');
{
  ok(/policy\s+\*\*#5157890\*\*/.test(facts) && /2027-02-10/.test(facts)
      && /card-paid/i.test(facts) && /jointCash: false/.test(facts),
    'ACCOUNT_FACTS records policy, next due, and card-paid Forecast home');
  ok(/street address is not restated/i.test(facts),
    'standing facts do not restate the insured street address');
}

if (failures) {
  console.log('\n' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nSquare One yearly card-paid proofs passed.');
