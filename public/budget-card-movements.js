'use strict';
/* Copy Forecast's sealed card movement publication. No ledger arithmetic,
 * balance inference, minimum allocation, provider calls or money writes.
 * Card detail opens through the native Budget detail sheet
 * (budgetDetailSheetController in public/plan.js): the trigger carries
 * aria-haspopup="dialog" and, once wired, aria-controls naming the actual
 * dialog. There is no inline expansion state here — the sheet controller
 * records the stable card identity (data-budget-card-toggle /
 * data-budget-card-panel) at open() and restores it across remounts. */
(function init(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetCardMovements = api;
})(globalThis, function buildApi() {
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reasons = {
    'opening-unavailable': 'Opening balance unavailable', 'closing-unavailable': 'Closing balance unavailable',
    'opening-unqualified': 'Opening evidence unconfirmed', 'closing-unqualified': 'Closing evidence unconfirmed',
    'posted-coverage-incomplete': 'Posted coverage incomplete', 'observation-unavailable': 'Observation unavailable',
    'future-not-observed': 'Future period not observed', 'selected-period-unavailable': 'Selected period unavailable',
    'balance-ledger-discrepancy': 'Balances and posted activity do not reconcile',
    'endpoint-identity-conflict': 'Balance evidence conflicts', 'unmapped-card-identity': 'Account identity unconfirmed',
    'transaction-evidence-unconfirmed': 'Transaction evidence unconfirmed', 'transaction-amount-unqualified': 'Transaction amount unconfirmed',
    'transaction-date-unqualified': 'Transaction date unconfirmed', 'transaction-identity-unqualified': 'Transaction identity unconfirmed',
    'duplicate-identity': 'Duplicate transaction identity', 'parent-coverage-unqualified': 'Split transaction coverage unconfirmed',
    'movement-total-overflow': 'Movement total unavailable'
  };
  const kinds = { charge: 'Posted charge', payment: 'Posted payment · household purpose unconfirmed',
    refund: 'Posted refund', interest: 'Posted interest', 'credit-unconfirmed': 'Credit · type unconfirmed',
    'movement-unconfirmed': 'Movement · type unconfirmed' };
  // Grok Scope A (Atlas-agreed): the trigger may show the publication's own
  // qualified reported balance, labelled Balance with its as-of date. It is
  // a dated stock observation, never the period net movement. Source is
  // labelled only where the publication explicitly supports it:
  // manualStatement is the manual-statement flag; its absence is NOT proof
  // of synced provenance, so no synced label is ever printed. A malformed
  // (non-finite or non-numeric) amount is rejected, never rendered.
  // The balance span is emitted before the net-change delta so the reading
  // order matches the faces' visual order (balance primary, net demoted);
  // the printed strings are unchanged.
  // Face display name (Atlas UI task 2 follow-on): the Amazon card —
  // canonical id 'mbna' in Forecast's identity table — prints exactly
  // 'Amazon' on the trigger; every other card keeps its publication label,
  // and the panel heading and screen-reader action keep the full
  // publication label for every card.
  const balance = (card, money, day) => {
    const reported = card.reportedBalance;
    if (!reported || typeof reported.amount !== 'number' || !Number.isFinite(reported.amount)) return '';
    // Face as-of dates print only for the Triangle and Amazon cards
    // (Atlas UI task 2 follow-on), keyed on the publication's canonical
    // card id — Forecast's identity table maps 'triangle' to Triangle and
    // 'mbna' to the Amazon card — never on the display label. Every other
    // card's face line omits the date segment; the detail panel keeps the
    // dated evidence for every card. The Manual statement suffix is a
    // separate segment and prints exactly as before whenever the
    // publication flags it.
    const when = reported.date ? 'as of ' + day(reported.date) : 'date unavailable';
    const dated = card.id === 'triangle' || card.id === 'mbna';
    return `<span class="card-movement-balance">Balance ${money(reported.amount)}${dated ? ' · ' + when : ''}${card.manualStatement ? ' · Manual statement' : ''}</span>`;
  };
  function html(pub, format) {
    if (!pub || pub.schema !== 'atlas-card-period-movements/v1'
      || pub.source !== 'Forecast.cardPeriodMovements' || pub.currency !== 'CAD' || !Array.isArray(pub.cards)) return '';
    const money = value => value == null ? 'Unavailable' : escape(format.money(value));
    const day = value => value ? escape(format.date(value)) : 'Date unavailable';
    const change = card => card.netChange.amount == null ? 'Net unavailable'
      : `${card.netChange.direction === 'up' ? '↑ ' : card.netChange.direction === 'down' ? '↓ ' : ''}${money(card.netChange.magnitude)}`;
    const qualifier = card => card.netChange.amount != null ? 'Net posted balance change'
      : (reasons[card.reasons[0]] || 'Evidence unconfirmed')
        + (card.manualStatement ? card.reportedBalance?.date ? ' · Dated ' + format.date(card.reportedBalance.date) : ' · Date unavailable' : '');
    const allocationConfirmed = tx => {
      const row = tx.paymentAllocation;
      return row?.status === 'reconciled' && !tx.pending
        && ['payment', 'reversal'].includes(row.kind)
        && typeof row.backfill === 'number' && Number.isFinite(row.backfill) && row.backfill >= 0
        && typeof row.cardPayment === 'number' && Number.isFinite(row.cardPayment) && row.cardPayment >= 0;
    };
    const allocation = tx => {
      const row = tx.paymentAllocation;
      if (!row) return '';
      const confirmed = allocationConfirmed(tx);
      const why = {
        'coverage-reversal-unconfirmed': 'Reversal match or allocation unconfirmed.',
        'coverage-identity-ambiguous': 'Transaction identity ambiguous; allocation unconfirmed.',
        'coverage-replacement-ambiguous': 'Pending/posted identity unconfirmed; allocation unavailable.',
        'coverage-currency-or-amount-unconfirmed': 'Transaction units or amount unconfirmed.',
        'credit-type-or-purpose-unconfirmed': 'Credit type and household purpose unconfirmed.'
      };
      const text = confirmed
        ? (row.kind === 'reversal' ? 'Confirmed reversal: ' : 'Confirmed at posting: ')
          + 'purchase coverage ' + money(row.backfill) + ' / other allocation ' + money(row.cardPayment)
        : escape(why[row.reason] || 'Payment match or purchase purpose unconfirmed.');
      const purchases = confirmed ? (Array.isArray(row.purchases) ? row.purchases : []).map(purchase =>
        '<small>' + day(purchase.date) + ' · ' + escape(purchase.categoryLabel || 'Category unavailable')
          + ' · ' + money(purchase.amount) + '</small>').join('') : '';
      return '<small data-card-payment-allocation="' + (confirmed ? 'reconciled' : 'unreconciled') + '">'
        + text + '</small>' + purchases;
    };
    const transaction = tx => `<div class="card-movement-row" data-card-movement-transaction="${escape(tx.id)}" data-card-movement-kind="${escape(tx.kind)}">
      <time datetime="${escape(tx.date)}">${day(tx.date)}</time><span><b>${escape(tx.payee)}</b><small>${tx.pending ? 'Pending authorization' : allocationConfirmed(tx) ? tx.paymentAllocation.kind === 'reversal' ? 'Posted allocation reversal' : 'Posted payment' : escape(kinds[tx.kind] || 'Movement · type unconfirmed')}</small>${allocation(tx)}</span>
      <span class="card-movement-amount ${tx.pending ? '' : 'is-' + escape(tx.direction)}">${tx.direction === 'up' ? '+' : tx.direction === 'down' ? '−' : ''}${money(tx.magnitude)}</span></div>`;
    return `<section class="card-movement-strip" data-budget-card-movements data-card-period-start="${escape(pub.start)}" data-card-period-end="${escape(pub.end)}" aria-label="Card movement in selected pay period">
      <div class="card-movement-heading"><h2>Card movement <span class="card-movement-scope">${day(pub.start)} – ${day(pub.end)}</span></h2><p>Posted${pub.through ? ' through ' + day(pub.through) : ' activity not observed'}</p></div>
      <div class="card-movement-track">${pub.cards.map(card => `<button type="button" class="card-movement-trigger" data-budget-card-toggle="${escape(card.id)}" aria-haspopup="dialog"><span class="card-movement-title">${escape(card.id === 'mbna' ? 'Amazon' : card.label)}<span class="card-movement-chevron" aria-hidden="true">⌄</span></span>${balance(card, money, day)}<span class="card-movement-delta is-${card.netChange.amount == null ? 'unavailable' : escape(card.netChange.direction)}">${change(card)}</span><span class="card-movement-qualifier">${escape(qualifier(card))}</span><span class="card-movement-sr">Show ${escape(card.label)} activity</span></button>`).join('')}</div>
      ${pub.cards.map(card => `<section class="card-movement-panel" id="budget-card-panel-${escape(card.id)}" data-budget-card-panel="${escape(card.id)}" aria-label="${escape(card.label)} activity" hidden>
        <div class="card-movement-balances"><span><small>Opening · ${day(card.opening?.date)}</small><strong>${money(card.opening?.amount)}</strong></span><span><small>Closing · ${day(card.closing?.date)}</small><strong>${money(card.closing?.amount)}</strong></span></div>
        ${card.reasons.length ? `<p class="card-movement-evidence">${card.reasons.map(reason => escape(reasons[reason] || 'Evidence unconfirmed')).join(' · ')}. Net change remains unavailable.</p>` : ''}
        ${card.reportedBalance && typeof card.reportedBalance.amount === 'number' && Number.isFinite(card.reportedBalance.amount) ? `<p class="card-movement-evidence">Reported balance ${money(card.reportedBalance.amount)} · ${day(card.reportedBalance.date)}${card.manualStatement ? ' · Manual statement observation' : ''}. This dated observation does not establish both period endpoints.</p>` : ''}
        <h4 class="card-movement-ledger-heading">Posted activity · ${card.postedCoverage === 'complete-provider-response' ? 'complete provider response' : 'coverage incomplete'}</h4>
        ${card.posted.map(transaction).join('') || `<p class="card-movement-note">${card.postedCoverage === 'complete-provider-response' && pub.role !== 'future' ? 'No posted movements returned in this period.' : 'No qualified posted activity available.'}</p>`}
        <div class="card-movement-pending"><h4 class="card-movement-ledger-heading">Pending · separate from net change</h4>${card.pending.map(transaction).join('') || `<p class="card-movement-note">${card.pendingCoverage === 'complete-provider-response' ? 'No pending authorizations returned.' : card.pendingCoverage === 'not-observed' ? 'Pending activity not observed for this selected period.' : 'Pending coverage unavailable.'}</p>`}</div>
        <p class="card-movement-note">Payments reduce the ${card.id === 'heloc' ? 'HELOC' : 'card'} balance. ${card.id !== 'heloc' && card.posted.some(allocationConfirmed) ? 'Household allocation does not automatically settle scheduled minimums; lender confirmation remains separate.' : 'Purpose unconfirmed: payments do not automatically settle scheduled minimums; lender confirmation remains separate.'}</p>
        ${card.id !== 'heloc' ? '<p class="card-movement-note">Allocation evidence describes recorded purpose at posting; a later reversal is shown separately. This window does not establish historical coverage or available cash. Issuer minimum satisfaction remains separate.</p>' : ''}
        ${pub.observationAsOf ? `<p class="card-movement-evidence">Provider observation · ${day(pub.observationAsOf)}</p>` : ''}
      </section>`).join('')}</section>`;
  }
  function wire(mount, sheet) {
    if (!mount || typeof mount.querySelector !== 'function') return;
    const strip = mount.querySelector('[data-budget-card-movements]');
    if (!strip) return;
    const dialog = mount.querySelector('[data-budget-detail-sheet]');
    const buttons = [...strip.querySelectorAll('[data-budget-card-toggle]')];
    const panels = [...strip.querySelectorAll('[data-budget-card-panel]')];
    buttons.forEach(button => {
      button.setAttribute('aria-haspopup', 'dialog');
      if (dialog?.id) button.setAttribute('aria-controls', dialog.id);
      button.addEventListener('click', () => {
        if (!sheet || typeof sheet.open !== 'function') return;
        const id = button.getAttribute('data-budget-card-toggle');
        const panel = panels.find(node => node.getAttribute('data-budget-card-panel') === id);
        if (!panel) return;
        sheet.open(panel, button, panel.getAttribute('aria-label') || 'Card activity');
      });
    });
  }
  return { html, wire };
});
