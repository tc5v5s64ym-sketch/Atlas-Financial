'use strict';
/* Tiny shared helpers for tests. Not a fixture framework.
 *
 * clone() is the usual deep copy. The rest derive an independent expectation
 * from Plan *inputs* (declared amounts, dates, funding room) so a legitimate
 * household-value refresh does not require rewriting behaviour assertions.
 */

const F = require('../public/forecast.js');

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
// Dated card-paid bills are not here: they reserve on the planning day.
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

function cardPaidReservedTotal(plan, asOf, end, occurrences) {
  return ((plan && plan.bills) || []).reduce((s, b) => {
    if (!F.isCardPaidBill(b, plan) || b.needsDate) return s;
    return s + occurrences(b, asOf, end)
      .reduce((n, d) => n + independentlyBillOccurrenceAmount(b, d), 0);
  }, 0);
}

function cardPaidReservedOnDate(plan, date, occurrences) {
  return ((plan && plan.bills) || []).reduce((s, b) => {
    if (!F.isCardPaidBill(b, plan) || b.needsDate) return s;
    if (!occurrences(b, date, date).length) return s;
    return s + independentlyBillOccurrenceAmount(b, date);
  }, 0);
}

function openingFloor(plan, asOf) {
  const cash = independentSpendableOpening(plan);
  if (!asOf) return cash - burrardDue(plan);
  const openingOut = (F.expandEvents(plan, asOf, asOf, {}) || [])
    .filter(e => e.date <= asOf && e.amount < 0 && e.kind !== 'noncash' && e.jointCash !== false)
    .reduce((s, e) => s + e.amount, 0);
  return cash + openingOut - currentRegimeReservedDaily(plan)
    - cardPaidReservedOnDate(plan, asOf, F.occurrences);
}

// Owner 2026-09-18: Forecast spendable opening is household chequing only.
// Designated `savings` / EMERGENCY SAVING stays on the breakdown as reserve
// evidence and is not ordinary spendable. Independent of
// Forecast.startingCashAmount.
function independentSpendableOpening(plan) {
  const cash = (plan && plan.startingCash) || {};
  const rows = cash.breakdown || [];
  if (!rows.length) return Number(cash.amount) || 0;
  let chequing = 0;
  let hasChequing = false;
  let rest = 0;
  for (const row of rows) {
    if (!row) continue;
    const n = Number(row.value) || 0;
    if (row.id === 'chequing-a' || row.id === 'chequing-b') {
      hasChequing = true;
      chequing += n;
    } else if (row.id !== 'savings') {
      rest += n;
    }
  }
  return hasChequing ? chequing : rest;
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

function independentlyRoundCent(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Reconstruct one bill occurrence's cash from Plan inputs. A
// utility-account credit is not chequing income; it only reduces the
// firstDue occurrence. Independent of Forecast.billOccurrenceCashAmount
// (L-002): the arithmetic is scheduled amount minus the encoded credit
// on that date, not a second call into expandEvents.
function independentlyBillOccurrenceAmount(bill, date) {
  const scheduled = Number(bill && bill.amount || 0);
  if (!isFinite(scheduled)) return 0;
  const raw = bill && bill.utilityAccountCredit;
  if (raw == null) return scheduled;
  const credit = typeof raw === 'number' ? Number(raw)
    : (raw && typeof raw === 'object' ? Number(raw.amount) : NaN);
  if (!isFinite(credit) || credit <= 0) return scheduled;
  const first = bill.firstDue || null;
  if (!first || String(date) !== String(first)) return scheduled;
  return independentlyRoundCent(Math.max(0, scheduled - credit));
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
    if (F.isCardPaidBill(b, plan)) continue;
    if (b.payingAccount) {
      const elsewhere = ((plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === b.payingAccount);
      if (elsewhere) continue;
    }
    if (!outflowHitsDate(b, date, occurrences, start)) continue;
    n -= independentlyBillOccurrenceAmount(b, date);
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

function representedEventKeys(plan) {
  return new Set(((plan && plan.opening && plan.opening.representedEvents) || [])
    .filter(row => row && row.id && row.date)
    .map(row => String(row.id) + '@' + String(row.date)));
}

function streamTotal(items, asOf, end, occurrences, opts) {
  const skipNonCash = !opts || opts.skipNonCash !== false;
  const onceOutflowsBind = !!(opts && opts.onceOutflowsBind);
  const represented = (opts && opts.omitRepresented)
    ? representedEventKeys(opts.plan) : new Set();
  return (items || []).reduce((s, item) => {
    if (skipNonCash && item.nonCash) return s;
    if (item.needsDate) return s;
    if (item.householdObligation === false) return s;
    if (opts && opts.plan && F.isCardPaidBill(item, opts.plan)) return s;
    if (opts && opts.plan && item.payingAccount) {
      const elsewhere = ((opts.plan.startingCash || {}).heldElsewhere || [])
        .some(r => r.id === item.payingAccount);
      if (elsewhere) return s;
    }
    const dates = onceOutflowsBind && item.frequency === 'once'
      ? independentlyOnceOutflowDates(item, asOf, end)
      : occurrences(item, asOf, end);
    return s + dates.reduce((n, d) => {
      const date = typeof d === 'string' ? d : (d && d.date);
      if (date && represented.has(item.id + '@' + date)) return n;
      return n + independentlyBillOccurrenceAmount(item, d);
    }, 0);
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
    .filter(o => !o.unusable && !o.debtId)
    .reduce((s, o) => s + Number(o.available || 0), 0);
}

module.exports = {
  clone,
  burrardDue,
  currentRegimeReservedDaily,
  cardPaidReservedTotal,
  cardPaidReservedOnDate,
  openingFloor,
  gapAtBuffer,
  cashOnDate,
  streamTotal,
  independentlyBillOccurrenceAmount,
  fundingById,
  usableFunding,
  representedEventKeys,
  independentSpendableOpening,
};
