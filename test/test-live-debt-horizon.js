'use strict';
/* Deliberately live reconciliation of the committed canonical plan.
 * Household amounts come from data.json; they are not behaviour fixtures.
 * Expected dates are counted by inspecting each UTC calendar day, without
 * Forecast's recurrence, absorption, simulation, or test-helper arithmetic.
 * The synthetic horizon suite separately proves behaviour and cap optimality.
 */
const assert = require('assert/strict');
const F = require('../public/forecast.js');
const data = require('../data.json');
const periods = require('../public/periods.json');

const DAY = 86400000;
const time = date => Date.parse(`${date}T00:00:00Z`);
const iso = stamp => new Date(stamp).toISOString().slice(0, 10);
const total = rows => rows.reduce((sum, row) => sum + row.amount, 0);
let checks = 0;
function near(actual, expected, label) {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected)
    && Math.abs(actual - expected) < 0.005,
  `${label}: expected ${expected}, got ${actual}`);
  checks++;
}
function scope(condition, message) {
  assert.ok(condition, `Independent live reconciliation needs an explicit extension: ${message}`);
}

const plan = data.plan;
const start = data.meta.asOf;
const opening = plan.opening || {};
scope(opening.asOf === start && !opening.priorAsOf,
  'this suite proves the canonical opening, not an observation overlay');
scope(!(opening.representedEvents || []).length
  && !(opening.notReliedUponEvents || []).length,
  'new opening representation evidence must be reconciled independently');
scope((plan.defaults.extraDebtMonthly || 0) === 0,
  'extra-debt payments require an independent absorption ledger');

const unsettled = (plan.commitments || []).filter(row => !(row.settledOn && row.settledOn <= start));
const fullDays = Math.max(365, ...unsettled.filter(row => row.date)
  .map(row => (time(row.date) - time(start)) / DAY + 1));
scope(Number.isInteger(fullDays), 'the authoritative horizon contains an invalid date');

// This oracle checks calendar-day properties rather than advancing the
// production recurrence. A past once cash debt/bill is still due; income and
// noncash charges never acquire invented historical occurrences.
function datesFor(row, days, carryOnce) {
  const end = iso(time(start) + (days - 1) * DAY);
  scope(!row.until && !row.endDate && !row.end && !row.lastDue,
    `${row.id}: new ending-cadence semantics`);
  if (row.frequency === 'once') {
    scope(Number.isFinite(time(row.date)), `${row.id}: invalid once date`);
    return row.date <= end && (row.date >= start || carryOnce) ? [row.date] : [];
  }
  scope(['monthly', 'biweekly', 'quarterly', 'yearly'].includes(row.frequency),
    `${row.id}: unsupported cadence ${row.frequency}`);
  const result = [];
  for (let n = 0; n < days; n++) {
    const stamp = time(start) + n * DAY;
    const day = new Date(stamp);
    const date = iso(stamp);
    if (row.firstDue && date < row.firstDue) continue;
    if (row.frequency === 'biweekly') {
      scope(Number.isFinite(time(row.anchor)), `${row.id}: missing biweekly anchor`);
      if ((stamp - time(row.anchor)) / DAY % 14 === 0) result.push(date);
      continue;
    }
    scope(Number.isInteger(row.day) && row.day > 0 && row.day <= 31,
      `${row.id}: missing day of month`);
    const lastDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
    if (day.getUTCDate() !== Math.min(row.day, lastDay)) continue;
    if (row.frequency === 'yearly' && day.getUTCMonth() + 1 !== row.month) continue;
    if (row.frequency === 'quarterly') {
      scope(Number.isFinite(time(row.anchor)), `${row.id}: missing quarterly anchor`);
      const anchor = new Date(time(row.anchor));
      const months = (day.getUTCFullYear() - anchor.getUTCFullYear()) * 12
        + day.getUTCMonth() - anchor.getUTCMonth();
      if (months % 3 !== 0) continue;
    }
    result.push(date);
  }
  return result;
}

const cashIds = new Set(plan.startingCash.breakdown.map(row => row.id));
const heldIds = new Set((plan.startingCash.heldElsewhere || []).map(row => row.id));
const debtIds = new Set(data.debts.map(row => row.id));
const startingCash = plan.startingCash.breakdown.reduce((sum, row) => {
  scope(Number.isFinite(row.value), `${row.id}: unknown opening cash`);
  return sum + row.value;
}, 0);

function independentLedger(days) {
  const rows = [];
  const add = (row, kind, carryOnce) => {
    scope(Number.isFinite(row.amount) && row.amount >= 0, `${row.id}: nonnumeric amount`);
    for (const date of datesFor(row, days, carryOnce)) {
      rows.push({ id: row.id, date, kind, amount: row.amount, debtId: row.debtId });
    }
  };
  for (const row of plan.income) {
    scope(!row.scenarioMonthly, `${row.id}: scenario income needs independent conversion`);
    add(row, 'income', false);
  }
  for (const row of plan.obligations) {
    scope(debtIds.has(row.debtId), `${row.id}: obligation has no known debt`);
    scope(row.nonCash ? row.effect === 'capitalise' : row.effect === 'payment',
      `${row.id}: new debt effect`);
    add(row, row.nonCash ? 'noncash' : 'obligation', !row.nonCash);
  }
  for (const row of plan.bills || []) {
    if (row.householdObligation === false) continue;
    scope(!row.needsDate, `${row.id}: undated bill needs independent evidence handling`);
    // Held-elsewhere bills do not withdraw joint cash. A known card payer
    // reserves the service cost without creating another chequing payment.
    const held = heldIds.has(row.payingAccount);
    const card = !held && (debtIds.has(row.payingAccount) || row.jointCash === false);
    scope(!row.payingAccount || cashIds.has(row.payingAccount) || held || card,
      `${row.id}: unknown paying-account attribution`);
    add(row, held ? 'external' : card ? 'reserved' : 'bill', !row.nonCash);
  }
  const end = iso(time(start) + (days - 1) * DAY);
  for (const row of unsettled) {
    if (!row.date || row.date > end || row.amount == null) continue;
    scope(Number.isFinite(row.amount) && row.amount >= 0, `${row.id}: invalid point commitment`);
    rows.push({ id: row.id, date: row.date, kind: 'commitment', amount: row.amount });
  }
  return rows;
}

const expectedFull = independentLedger(fullDays);
// A simple lower bound proves every scheduled payment is absorbed: even
// ignoring all positive interest, the opening exceeds all scheduled cash.
// This avoids claiming that the production debt ledger proves itself.
for (const debt of data.debts) {
  const due = total(expectedFull.filter(row => row.kind === 'obligation' && row.debtId === debt.id));
  scope(Number.isFinite(debt.balance) && !debt.pendingUnknown
    && Number.isFinite(debt.pending) && debt.pending >= 0 && debt.rate >= 0,
  `${debt.id}: unknown balance/pending or negative interest invalidates the bound`);
  scope(debt.balance + debt.pending > due,
    `${debt.id}: payoff may cap payments; a separate independent payoff proof is needed`);
}

const undatedMonthly = (plan.budget.categories || []).reduce((sum, row) => {
  const targeted = ['plannedMonthly', 'plannedWeekly', 'plannedPayday']
    .some(key => Number.isFinite(row[key]));
  return sum + (!targeted && Number.isFinite(row.currentMonthly) ? row.currentMonthly : 0);
}, 0);
const opts = { debts: data.debts, periods, extraFacilities: data.revolvingExtra };
const recommendation = F.recommend(plan, start, opts);
scope(recommendation.mode === 'normal' && !recommendation.simOptions.variableFrom
  && !(recommendation.simOptions.injections || []).length,
  'opening-gap recovery requires a separate independently reconciled cash source');
near(recommendation.knowledge.days, fullDays, 'source-derived master horizon');
const full = F.simulate(plan, start, Object.assign({}, recommendation.simOptions, {
  weeklyVariable: recommendation.weekly, viewDays: fullDays,
}));

for (const [days, sim] of [[plan.windowDays, recommendation.sim], [fullDays, full]]) {
  const expected = days === fullDays ? expectedFull : independentLedger(days);
  for (const [kind, key] of [['income', 'income'], ['obligation', 'obligations'],
    ['bill', 'bills'], ['noncash', 'noncash'], ['commitment', 'commitments']]) {
    near(sim.totals[key], total(expected.filter(row => row.kind === kind)), `${days}-day ${key}`);
  }
  const reserved = total(expected.filter(row => row.kind === 'reserved'))
    + undatedMonthly * 12 / 365.25 * days;
  // The published weekly amount is the selected spend input to this cash
  // identity, not an independently proved optimum. Synthetic tests prove that.
  const variable = recommendation.weekly * days / 7;
  near(sim.totals.reserved, reserved, `${days}-day service reserves counted once`);
  near(sim.totals.variable, variable, `${days}-day selected weekly spending`);
  near(sim.totals.extra, 0, `${days}-day no unsolicited extra debt payment`);
  near(sim.totals.injections, 0, `${days}-day no invented funding`);
  const expectedEnding = startingCash + total(expected.filter(row => row.kind === 'income'))
    - total(expected.filter(row => ['obligation', 'bill', 'commitment'].includes(row.kind)))
    - reserved - variable;
  near(sim.ending, expectedEnding, `${days}-day complete independent ending cash`);

  // Identity comparison catches a missing final/once payment, duplicate MBNA
  // stub, invented future occurrence, and omitted mortgage/minimum dates even
  // if another erroneous event happens to compensate for the total.
  const expectedPayments = expected.filter(row => row.kind === 'obligation')
    .map(row => `${row.date}:${row.id}:${row.amount.toFixed(2)}`).sort();
  const actualPayments = sim.events.filter(row => row.kind === 'obligation')
    .map(row => `${row.date}:${row.id}:${(-row.amount).toFixed(2)}`).sort();
  assert.deepEqual(actualPayments, expectedPayments, `${days}-day exact debt occurrence identities`);
  checks++;
  for (const bill of (plan.bills || []).filter(row => row.frequency === 'once')) {
    const expectedCount = expected.filter(row => row.id === bill.id).length;
    const actual = sim.events.filter(row => row.id === bill.id);
    assert.equal(actual.length, expectedCount, `${days}-day ${bill.id} final/once count`);
    if (actual.length) assert.equal(actual[0].date, bill.date, `${bill.id} retains its source date`);
    checks++;
  }
}
near(recommendation.knowledge.ending, full.ending, 'published master ending copies the reconciled walk');
console.log(`PASS ${checks} independent live debt-horizon reconciliations`);
