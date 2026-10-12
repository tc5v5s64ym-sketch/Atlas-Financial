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
  // Face rule (Atlas UI task 2 second follow-on): the trigger's
  // right-hand slot prints the publication's own reported balance as the
  // bare amount — no 'Balance' prefix, no as-of date, no source suffix,
  // for every card — or, when the publication carries no usable reported
  // balance, the state word 'Unavailable' in the same slot. A malformed
  // (non-finite or non-numeric) amount is rejected the same way, never
  // rendered as a figure. Provenance — the dated observation and its
  // manual-statement source — lives in the detail panel, which keeps the
  // complete evidence for every card. The face prints no net-change
  // figure at all; the panel is unchanged by this rule — it prints no
  // net figure either, only its pre-existing evidence wording (for
  // example 'Net change remains unavailable.' when a card carries
  // reasons).
  // Face display name: the Amazon card — canonical id 'mbna' in
  // Forecast's identity table — prints exactly 'Amazon' on the trigger;
  // every other card keeps its publication label, and the panel heading
  // and screen-reader action keep the full publication label.
  // Heading rule (Systems Review 5485851551 R1): the strip's semantic
  // heading and the region's accessible name are exactly 'Credit cards'
  // in every state — no 'Card movement' name and no period dates in the
  // heading. The blend skin's painted tile title repeats the same words;
  // the contract lives here, in the semantics every skin shares.
  const balance = (card, money) => {
    const reported = card.reportedBalance;
    if (!reported || typeof reported.amount !== 'number' || !Number.isFinite(reported.amount))
      return '<span class="card-movement-balance is-unavailable">Unavailable</span>';
    return `<span class="card-movement-balance">${money(reported.amount)}</span>`;
  };
  function html(pub, format) {
    if (!pub || pub.schema !== 'atlas-card-period-movements/v1'
      || pub.source !== 'Forecast.cardPeriodMovements' || pub.currency !== 'CAD' || !Array.isArray(pub.cards)) return '';
    const money = value => value == null ? 'Unavailable' : escape(format.money(value));
    const day = value => value ? escape(format.date(value)) : 'Date unavailable';
    const transaction = tx => `<div class="card-movement-row" data-card-movement-transaction="${escape(tx.id)}" data-card-movement-kind="${escape(tx.kind)}">
      <time datetime="${escape(tx.date)}">${day(tx.date)}</time><span><b>${escape(tx.payee)}</b><small>${tx.pending ? 'Pending authorization' : escape(kinds[tx.kind] || 'Movement · type unconfirmed')}</small></span>
      <span class="card-movement-amount ${tx.pending ? '' : 'is-' + escape(tx.direction)}">${tx.direction === 'up' ? '+' : tx.direction === 'down' ? '−' : ''}${money(tx.magnitude)}</span></div>`;
    return `<section class="card-movement-strip" data-budget-card-movements data-card-period-start="${escape(pub.start)}" data-card-period-end="${escape(pub.end)}" aria-label="Credit cards">
      <div class="card-movement-heading"><h2>Credit cards</h2><p>Posted${pub.through ? ' through ' + day(pub.through) : ' activity not observed'}</p></div>
      <div class="card-movement-track">${pub.cards.map(card => `<button type="button" class="card-movement-trigger" data-budget-card-toggle="${escape(card.id)}" aria-haspopup="dialog"><span class="card-movement-title">${escape(card.id === 'mbna' ? 'Amazon' : card.label)}<span class="card-movement-chevron" aria-hidden="true">⌄</span></span>${balance(card, money)}<span class="card-movement-sr">Show ${escape(card.label)} activity</span></button>`).join('')}</div>
      ${pub.cards.map(card => `<section class="card-movement-panel" id="budget-card-panel-${escape(card.id)}" data-budget-card-panel="${escape(card.id)}" aria-label="${escape(card.label)} activity" hidden>
        <div class="card-movement-balances"><span><small>Opening · ${day(card.opening?.date)}</small><strong>${money(card.opening?.amount)}</strong></span><span><small>Closing · ${day(card.closing?.date)}</small><strong>${money(card.closing?.amount)}</strong></span></div>
        ${card.reasons.length ? `<p class="card-movement-evidence">${card.reasons.map(reason => escape(reasons[reason] || 'Evidence unconfirmed')).join(' · ')}. Net change remains unavailable.</p>` : ''}
        ${card.reportedBalance && typeof card.reportedBalance.amount === 'number' && Number.isFinite(card.reportedBalance.amount) ? `<p class="card-movement-evidence">Reported balance ${money(card.reportedBalance.amount)} · ${day(card.reportedBalance.date)}${card.manualStatement ? ' · Manual statement observation' : ''}. This dated observation does not establish both period endpoints.</p>` : ''}
        <h4 class="card-movement-ledger-heading">Posted activity · ${card.postedCoverage === 'complete-provider-response' ? 'complete provider response' : 'coverage incomplete'}</h4>
        ${card.posted.map(transaction).join('') || `<p class="card-movement-note">${card.postedCoverage === 'complete-provider-response' && pub.role !== 'future' ? 'No posted movements returned in this period.' : 'No qualified posted activity available.'}</p>`}
        <div class="card-movement-pending"><h4 class="card-movement-ledger-heading">Pending · separate from net change</h4>${card.pending.map(transaction).join('') || `<p class="card-movement-note">${card.pendingCoverage === 'complete-provider-response' ? 'No pending authorizations returned.' : card.pendingCoverage === 'not-observed' ? 'Pending activity not observed for this selected period.' : 'Pending coverage unavailable.'}</p>`}</div>
        <p class="card-movement-note">Payments reduce the ${card.id === 'heloc' ? 'HELOC' : 'card'} balance. Purpose unconfirmed: payments do not automatically settle scheduled minimums; lender confirmation remains separate.</p>
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
