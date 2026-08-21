'use strict';
/* Tiny shared helpers for tests. Not a fixture framework.
 *
 * clone() is the usual deep copy. The rest derive an independent expectation
 * from Plan *inputs* (declared amounts, dates, funding room) so a legitimate
 * household-value refresh does not require rewriting behaviour assertions.
 */

const F = require('./public/forecast.js');

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function burrardDue(plan, asOf) {
  return (plan.commitments || [])
    .filter(c => c.group === 'burrard')
    .filter(c => {
      if (typeof c.settledOn !== 'string' || !asOf) return true;
      return c.settledOn > asOf;
    })
    .reduce((s, c) => s + Number(c.amount || 0), 0);
}

// Undated current-regime monthly cost, reconstructed from Plan inputs — not
// from Forecast.simulate. Owner targets beat it. Calendar month is 365.25/12.
function currentRegimeReservedDaily(plan) {
  const cats = (plan && plan.budget && plan.budget.categories) || [];
  let monthly = 0;
  for (const c of cats) {
    if (!c || c.plannedMonthly != null || c.currentMonthly == null) continue;
    const n = Number(c.currentMonthly);
    if (isFinite(n)) monthly += n;
  }
  return monthly * 12 / 365.25;
}

function openingFloor(plan, asOf) {
  const cash = F.startingCashAmount(plan);
  if (!asOf) return cash - burrardDue(plan);
  const openingOut = (F.expandEvents(plan, asOf, asOf, {}) || [])
    .filter(e => e.date <= asOf && e.amount < 0 && e.kind !== 'noncash' && e.jointCash !== false)
    .reduce((s, e) => s + e.amount, 0);
  return cash + openingOut - currentRegimeReservedDaily(plan);
}

function gapAtBuffer(plan, buffer, asOf) {
  return Number(buffer) - openingFloor(plan, asOf);
}

function independentlyOnceOutflowDates(item, start, end) {
  if (!item || item.frequency !== 'once' || !item.date) return [];
  if (item.date > end) return [];
  if (item.date >= start) return [item.date];
  if (item.nonCash) return [];
  return [item.date];
}

function outflowHitsDate(item, date, occurrences, start) {
  if (item && item.frequency === 'once') {
    if (!start) return item.date === date;
    return independentlyOnceOutflowDates(item, start, date).includes(date);
  }
  return !!(occurrences(item, date, date).length);
}

function cashOnDate(plan, date, occurrences, scenario, start) {
  let n = 0;
  for (const s of plan.income || []) {
    if (!occurrences(s, date, date).length) continue;
    n += s.scenarioMonthly ? Number(s.scenarioMonthly[scenario] || 0) : Number(s.amount || 0);
  }
  for (const o of plan.obligations || []) {
    if (o.nonCash) continue;
    if (!outflowHitsDate(o, date, occurrences, start)) continue;
    n -= Number(o.amount || 0);
  }
  for (const b of plan.bills || []) {
    if (b.householdObligation === false) continue;
    if (b.payingAccount) {
      const elsewhere = ((plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === b.payingAccount);
      if (elsewhere) continue;
    }
    if (!outflowHitsDate(b, date, occurrences, start)) continue;
    n -= Number(b.amount || 0);
  }
  for (const c of plan.commitments || []) {
    const settledOn = typeof c.settledOn === 'string'
      && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(c.settledOn)
      ? c.settledOn : null;
    // Opening-relative: without a forecast start, fail closed and keep the
    // cash event.
    if (settledOn && typeof start === 'string' && settledOn <= start) continue;
    if (c.date === date) n -= Number(c.amount || 0);
  }
  return n;
}

function streamTotal(items, asOf, end, occurrences, opts) {
  const skipNonCash = !opts || opts.skipNonCash !== false;
  const onceOutflowsBind = !!(opts && opts.onceOutflowsBind);
  return (items || []).reduce((s, item) => {
    if (skipNonCash && item.nonCash) return s;
    if (item.householdObligation === false) return s;
    if (opts && opts.plan && item.payingAccount) {
      const elsewhere = ((opts.plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === item.payingAccount);
      if (elsewhere) return s;
    }
    const dates = onceOutflowsBind && item.frequency === 'once'
      ? independentlyOnceOutflowDates(item, asOf, end)
      : occurrences(item, asOf, end);
    return s + dates.length * Number(item.amount || 0);
  }, 0);
}

function resolvedFunding(plan, extra, debts) {
  return F.resolveFundingSources(
    (plan && plan.funding && plan.funding.options) || [], extra, plan, debts);
}

function fundingById(plan, extra, debts) {
  const out = {};
  for (const o of resolvedFunding(plan, extra, debts)) out[o.id] = o;
  return out;
}

function usableFunding(plan, extra, debts) {
  return resolvedFunding(plan, extra, debts)
    .filter(o => !o.unusable)
    .reduce((s, o) => s + Number(o.available || 0), 0);
}

module.exports = {
  clone,
  burrardDue,
  currentRegimeReservedDaily,
  openingFloor,
  gapAtBuffer,
  cashOnDate,
  streamTotal,
  fundingById,
  usableFunding,
};
