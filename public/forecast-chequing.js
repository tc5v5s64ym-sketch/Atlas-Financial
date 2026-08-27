'use strict';
/* Forecast-owned household chequing availability.
 *
 * This is a narrow reporting authority, not a second planner. It derives the
 * owner's household-facing chequing capacity from the canonical Chequing A and
 * Chequing B opening rows plus the incumbent overdraft facility attached to
 * Chequing B. Savings is deliberately excluded from this headline.
 *
 * Overdraft capacity is BORROWED capacity. This function does not add it to
 * startingCashAmount, paydayAllocation, currentPeriodAction, LEFT OVER, or any
 * Forecast cash walk, and it grants no permission to borrow.
 */
(function init(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.Forecast) root.Forecast.chequingAvailability = api.chequingAvailability;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  const roundCent = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

  function unavailable(reason) {
    return {
      status: 'unavailable',
      reason,
      chequingBalance: null,
      overdraftLimit: null,
      overdraftUsed: null,
      overdraftRemaining: null,
      available: null,
      includesBorrowing: false,
      accountBalances: [],
      asOf: null,
    };
  }

  function chequingAvailability(plan, extraFacilities) {
    const cash = plan && plan.startingCash;
    const rows = cash && Array.isArray(cash.breakdown) ? cash.breakdown : [];
    const a = rows.find(row => row && row.id === 'chequing-a');
    const b = rows.find(row => row && row.id === 'chequing-b');
    if (!a || !b) return unavailable('chequing-opening-missing');

    const aValue = Number(a.value);
    const bValue = Number(b.value);
    if (!Number.isFinite(aValue) || !Number.isFinite(bValue)) {
      return unavailable('chequing-balance-invalid');
    }

    const facilities = Array.isArray(extraFacilities) ? extraFacilities : [];
    const overdraft = facilities.find(facility =>
      facility && facility.cash === 'chequing-b' && Number.isFinite(Number(facility.limit)));
    if (!overdraft) return unavailable('chequing-b-overdraft-missing');

    const limit = Math.max(0, Number(overdraft.limit));
    const pending = Number.isFinite(Number(overdraft.pending))
      ? Math.max(0, Number(overdraft.pending)) : 0;
    const chequingBalance = roundCent(aValue + bValue);
    const overdraftUsed = roundCent(Math.max(0, -bValue));
    const overdraftRemaining = roundCent(Math.max(0, limit - overdraftUsed - pending));
    // The owner's requested bank-capacity identity: the two chequing balances
    // plus the authorized overdraft limit, reduced by any facility pending.
    // If Chequing B is negative, that negative balance already represents the
    // overdraft already used, so adding the full limit leaves only the unused
    // portion available without double-counting it.
    const available = roundCent(Math.max(0, chequingBalance + limit - pending));

    return {
      status: 'available',
      reason: null,
      chequingBalance,
      overdraftLimit: roundCent(limit),
      overdraftUsed,
      overdraftRemaining,
      available,
      includesBorrowing: limit > 0,
      accountBalances: [
        { id: 'chequing-a', value: roundCent(aValue) },
        { id: 'chequing-b', value: roundCent(bValue) },
      ],
      overdraftId: overdraft.id || null,
      asOf: plan && plan.opening && plan.opening.asOf || null,
    };
  }

  return { chequingAvailability };
});
