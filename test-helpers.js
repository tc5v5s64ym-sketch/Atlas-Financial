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

function openingFloor(plan, asOf) {
  const cash = F.startingCashAmount(plan);
  if (!asOf) return cash - burrardDue(plan);
  const sameDay = (F.expandEvents(plan, asOf, asOf, {}) || [])
    .filter(e => e.date === asOf && e.amount < 0 && e.kind !== 'noncash' && e.jointCash !== false)
    .reduce((s, e) => s + e.amount, 0);
  return cash + sameDay;
}

function gapAtBuffer(plan, buffer, asOf) {
  return Number(buffer) - openingFloor(plan, asOf);
}

function cashOnDate(plan, date, occurrences, scenario, start) {
  let n = 0;
  for (const s of plan.income || []) {
    if (!occurrences(s, date, date).length) continue;
    n += s.scenarioMonthly ? Number(s.scenarioMonthly[scenario] || 0) : Number(s.amount || 0);
  }
  for (const o of plan.obligations || []) {
    if (o.nonCash) continue;
    if (!occurrences(o, date, date).length) continue;
    n -= Number(o.amount || 0);
  }
  for (const b of plan.bills || []) {
    if (b.householdObligation === false) continue;
    if (b.payingAccount) {
      const elsewhere = ((plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === b.payingAccount);
      if (elsewhere) continue;
    }
    if (!occurrences(b, date, date).length) continue;
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
  return (items || []).reduce((s, item) => {
    if (skipNonCash && item.nonCash) return s;
    if (item.householdObligation === false) return s;
    if (opts && opts.plan && item.payingAccount) {
      const elsewhere = ((opts.plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === item.payingAccount);
      if (elsewhere) return s;
    }
    const n = occurrences(item, asOf, end).length;
    return s + n * Number(item.amount || 0);
  }, 0);
}

function fundingById(plan) {
  const out = {};
  for (const o of plan.funding && plan.funding.options || []) out[o.id] = o;
  return out;
}

function usableFunding(plan) {
  return (plan.funding && plan.funding.options || [])
    .filter(o => !o.unusable)
    .reduce((s, o) => s + Number(o.available || 0), 0);
}

module.exports = {
  clone,
  burrardDue,
  openingFloor,
  gapAtBuffer,
  cashOnDate,
  streamTotal,
  fundingById,
  usableFunding,
};
