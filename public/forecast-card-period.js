'use strict';
/* Forecast-owned posted card movement reporting. No DOM, cash/debt walk,
 * minimum allocation, balance write or provider fetch. Forecast supplies the
 * incumbent date/cents/classification/parent primitives below. */
(function init(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ForecastCardPeriod = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildApi() {
  const identities = [['travelvisa', 'Travel'], ['cashback', 'Cash Back'], ['tdcc', 'Emerald'],
    ['triangle', 'Triangle'], ['mbna', 'Amazon Mastercard']];
  function publish(input, primitives) {
    const { date, cents, skipParent, classify } = primitives;
    const { plan, debts, asOf, window, packet, balanceEvidence, overlay } = input;
    const start = window?.start, end = window?.end;
    const role = date(start) && date(end) && date(asOf)
      ? start > asOf ? 'future' : end < asOf ? 'past' : 'current' : 'unknown';
    const through = role === 'future' ? null : role === 'past' ? end : asOf;
    const windowKnown = input.windowQualified === true && date(start) && date(end) && start <= end && date(asOf);
    const rows = Array.isArray(packet?.transactions) ? packet.transactions : [];
    const packetCurrent = packet?.schema === 'atlas-current-period-actuals/v1' && packet.observationAsOf === asOf;
    const coverage = packetCurrent && packet.transactionCoverage === 'complete'
      && date(packet.coverageStart) && date(packet.coverageThrough)
      && packet.coverageStart <= start && packet.coverageThrough >= through;
    // Unknown identity can conceal a card movement; mapped rows remain useful.
    const unmapped = rows.some(tx => tx && (tx.accountRole === 'unmapped'
      || tx.accountRole === 'revolving-credit' && !identities.some(([id]) => id === (tx.atlasAccountId || tx.account))));
    const balancePacket = balanceEvidence?.schema === 'atlas-card-period-balance-evidence/v1'
      && balanceEvidence.currency === 'CAD' && balanceEvidence.start === start
      && balanceEvidence.through === through && balanceEvidence.asOf === asOf ? balanceEvidence : null;
    const endpoint = (point, day, claim) => point && point.confirmed === true
      && point.currency === 'CAD' && cents(point.amount, true) !== null
      && point.date === day && date(point.date) && point.temporalClaim === claim
      && typeof point.evidenceRef === 'string' && point.evidenceRef.trim().length > 0;
    const safeMoney = tx => tx?.coverageCurrencyConflict !== true && tx?.currencySettlementUnconfirmed !== true
      && typeof tx?.currency === 'string' && tx.currency.trim().toLowerCase() === 'cad' ? cents(tx.amount, true) : null;
    const pointFact = point => point ? { amount: cents(point.amount, true) === null ? null : point.amount,
      date: date(point.date) ? point.date : null, temporalClaim: point.temporalClaim || null } : null;
    const cards = identities.map(([id, label]) => {
      const issues = [];
      const card = { id, label, status: role === 'future' ? 'not-observed' : 'unavailable',
        netChange: { amount: null, magnitude: null, direction: null, trust: 'unavailable', completeness: 'unavailable' },
        opening: null, closing: null, reportedBalance: null, posted: [], pending: [],
        postedCoverage: coverage ? 'complete-provider-response' : 'incomplete',
        pendingCoverage: role !== 'current' ? 'not-observed' : packetCurrent && packet.pendingCoverage === 'complete' ? 'complete-provider-response' : 'unavailable',
        manualStatement: id === 'triangle' || id === 'mbna', reasons: issues };
      const debt = (debts || []).find(row => row?.id === id);
      // Preserve the actual observation date; never retime a manual balance.
      const observed = (overlay?.overlays || []).find(row => row?.locator === 'debts:' + id
        && row.field === 'balance' && cents(row.proposedValue, true) !== null
        && cents(row.proposedValue, true) === cents(debt?.balance, true)
        && date(row.evidenceDate) && row.evidenceDate <= asOf);
      if (role === 'current' && debt && cents(debt.balance, true) !== null) card.reportedBalance = {
        amount: debt.balance, date: date(observed?.evidenceDate) ? observed.evidenceDate
          : date(debt.evidenceDate) ? debt.evidenceDate : null,
        status: date(observed?.evidenceDate) || date(debt.evidenceDate) ? 'dated' : 'date-unavailable' };
      if (!windowKnown) { issues.push('selected-period-unavailable'); return card; }
      if (role === 'future') { issues.push('future-not-observed'); return card; }
      if (!packetCurrent) issues.push('observation-unavailable');
      if (!coverage) issues.push('posted-coverage-incomplete');
      if (unmapped) issues.push('unmapped-card-identity');
      if ((packet?.cardCoverageUnconfirmed || []).length || (packet?.currencyUnconfirmed || []).length)
        issues.push('transaction-evidence-unconfirmed');
      const seen = new Set();
      let total = 0;
      for (const tx of rows) {
        if (!tx || (tx.atlasAccountId || tx.account) !== id || tx.accountRole !== 'revolving-credit') continue;
        if (!date(tx.date)) { issues.push('transaction-date-unqualified'); continue; }
        if (tx.date < start || tx.date > through) continue;
        if (tx.pendingPostedAmbiguous === true || tx.pendingPostedDuplicate === true || tx.contradictoryEvidence === true)
          issues.push('transaction-evidence-unconfirmed');
        if (tx.isGroup === true) {
          if (skipParent(tx, packet)) continue;
          issues.push('parent-coverage-unqualified');
          continue;
        }
        const value = safeMoney(tx);
        const classification = classify(tx, plan, packet);
        // The spending classifier calls any signed credit a refund. That is
        // not proof of its transaction type: prefer explicit native identity,
        // and leave an unlabelled credit unconfirmed instead of guessing.
        const hint = typeof tx.kindHint === 'string' ? tx.kindHint.trim().toLowerCase() : '';
        const kind = ['payment', 'card-payment', 'bill-payment'].includes(hint) || tx.cardPaymentIdentity === true ? 'payment'
          : hint === 'refund' ? 'refund'
          : classification?.kind === 'interest' ? 'interest'
          : value != null && value < 0 ? 'credit-unconfirmed'
          : classification?.kind === 'spend' || classification?.kind === 'bill' ? 'charge' : 'movement-unconfirmed';
        const published = { id: tx.id == null ? null : String(tx.id), date: tx.date,
          payee: typeof tx.displayedPayee === 'string' ? tx.displayedPayee : 'Card transaction',
          amount: value == null ? null : value / 100, magnitude: value == null ? null : Math.abs(value) / 100,
          direction: value == null ? null : value > 0 ? 'up' : value < 0 ? 'down' : 'flat',
          kind, pending: tx.pending === true };
        if (published.pending) {
          if (role === 'current') card.pending.push(published);
          continue;
        }
        card.posted.push(published);
        if (!published.id) issues.push('transaction-identity-unqualified');
        else if (seen.has(published.id)) issues.push('duplicate-identity');
        else seen.add(published.id);
        if (value == null) { issues.push('transaction-amount-unqualified'); continue; }
        total += value;
        if (!Number.isSafeInteger(total)) issues.push('movement-total-overflow');
      }
      card.posted.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
      card.pending.sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
      const pointRows = Array.isArray(balancePacket?.cards) ? balancePacket.cards.filter(row => row?.id === id) : [];
      const points = pointRows.length === 1 ? pointRows[0] : null;
      if (pointRows.length > 1) issues.push('endpoint-identity-conflict');
      card.opening = endpoint(points?.opening, start, 'before-period-posted-movements') ? pointFact(points.opening) : null;
      card.closing = endpoint(points?.closing, through, 'through-published-posted-coverage') ? pointFact(points.closing) : null;
      if (!points?.opening) issues.push('opening-unavailable');
      else if (!endpoint(points.opening, start, 'before-period-posted-movements')) issues.push('opening-unqualified');
      if (!points?.closing) issues.push('closing-unavailable');
      else if (!endpoint(points.closing, through, 'through-published-posted-coverage')) issues.push('closing-unqualified');
      if (points?.opening?.evidenceRef === points?.closing?.evidenceRef && points?.opening) issues.push('endpoint-identity-conflict');
      if (!issues.length) {
        const change = cents(points.closing.amount, true) - cents(points.opening.amount, true);
        if (!Number.isSafeInteger(change) || change !== total) issues.push('balance-ledger-discrepancy');
        else {
          card.status = 'ready';
          card.netChange = { amount: change / 100, magnitude: Math.abs(change) / 100,
            direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat', trust: 'calculated', completeness: 'complete' };
        }
      }
      card.reasons = [...new Set(issues)];
      return card;
    });
    return { schema: 'atlas-card-period-movements/v1', source: 'Forecast.cardPeriodMovements', currency: 'CAD',
      asOf: date(asOf) ? asOf : null, start: date(start) ? start : null, end: date(end) ? end : null,
      through: date(through) ? through : null, role, cards,
      observationAsOf: date(packet?.observationAsOf) ? packet.observationAsOf : null,
      semantics: 'Posted liability movement, not spending-only totals, available cash, payment instructions or minimum settlement.' };
  }
  return { publish };
});
