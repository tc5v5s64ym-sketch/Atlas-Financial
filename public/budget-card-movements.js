'use strict';
/* Copy Forecast's sealed card movement publication. No ledger arithmetic,
 * balance inference, minimum allocation, provider calls or money writes. */
(function init(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetCardMovements = api;
})(globalThis, function buildApi() {
  let selectedStamp = null, expanded = null;
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
  function html(pub, format) {
    if (!pub || pub.schema !== 'atlas-card-period-movements/v1'
      || pub.source !== 'Forecast.cardPeriodMovements' || pub.currency !== 'CAD' || !Array.isArray(pub.cards)) return '';
    const stamp = `${pub.start}|${pub.end}`;
    if (stamp !== selectedStamp) { selectedStamp = stamp; expanded = null; }
    const money = value => value == null ? 'Unavailable' : escape(format.money(value));
    const day = value => value ? escape(format.date(value)) : 'Date unavailable';
    const change = card => card.netChange.amount == null ? 'Net unavailable'
      : `${card.netChange.direction === 'up' ? '↑ ' : card.netChange.direction === 'down' ? '↓ ' : ''}${money(card.netChange.magnitude)}`;
    const qualifier = card => card.netChange.amount != null ? 'Net posted balance change'
      : (reasons[card.reasons[0]] || 'Evidence unconfirmed')
        + (card.manualStatement ? card.reportedBalance?.date ? ' · Dated ' + format.date(card.reportedBalance.date) : ' · Date unavailable' : '');
    const transaction = tx => `<div class="card-movement-row" data-card-movement-transaction="${escape(tx.id)}" data-card-movement-kind="${escape(tx.kind)}">
      <time datetime="${escape(tx.date)}">${day(tx.date)}</time><span><b>${escape(tx.payee)}</b><small>${tx.pending ? 'Pending authorization' : escape(kinds[tx.kind] || 'Movement · type unconfirmed')}</small></span>
      <span class="card-movement-amount ${tx.pending ? '' : 'is-' + escape(tx.direction)}">${tx.direction === 'up' ? '+' : tx.direction === 'down' ? '−' : ''}${money(tx.magnitude)}</span></div>`;
    return `<section class="card-movement-strip" data-budget-card-movements data-card-period-start="${escape(pub.start)}" data-card-period-end="${escape(pub.end)}" aria-label="Card movement in selected pay period">
      <div class="card-movement-heading"><h2>Card movement <span class="card-movement-scope">${day(pub.start)} – ${day(pub.end)}</span></h2><p>Posted${pub.through ? ' through ' + day(pub.through) : ' activity not observed'}</p></div>
      <div class="card-movement-track">${pub.cards.map(card => `<button type="button" class="card-movement-trigger" data-budget-card-toggle="${escape(card.id)}" aria-expanded="${expanded === card.id}" aria-controls="budget-card-panel-${escape(card.id)}"><span class="card-movement-title">${escape(card.label)}<span class="card-movement-chevron" aria-hidden="true">⌄</span></span><span class="card-movement-delta is-${card.netChange.amount == null ? 'unavailable' : escape(card.netChange.direction)}">${change(card)}</span><span class="card-movement-qualifier">${escape(qualifier(card))}</span><span class="card-movement-sr">Show ${escape(card.label)} activity</span></button>`).join('')}</div>
      ${pub.cards.map(card => `<section class="card-movement-panel" id="budget-card-panel-${escape(card.id)}" data-budget-card-panel="${escape(card.id)}" aria-label="${escape(card.label)} activity"${expanded === card.id ? '' : ' hidden'}>
        <div class="card-movement-panel-head"><h3>${escape(card.label)}</h3><button type="button" class="card-movement-close" data-budget-card-close="${escape(card.id)}">Close activity</button></div>
        <div class="card-movement-balances"><span><small>Opening · ${day(card.opening?.date)}</small><strong>${money(card.opening?.amount)}</strong></span><span><small>Closing · ${day(card.closing?.date)}</small><strong>${money(card.closing?.amount)}</strong></span></div>
        ${card.reasons.length ? `<p class="card-movement-evidence">${card.reasons.map(reason => escape(reasons[reason] || 'Evidence unconfirmed')).join(' · ')}. Net change remains unavailable.</p>` : ''}
        ${card.reportedBalance ? `<p class="card-movement-evidence">Reported balance ${money(card.reportedBalance.amount)} · ${day(card.reportedBalance.date)}${card.manualStatement ? ' · Manual statement observation' : ''}. This dated observation does not establish both period endpoints.</p>` : ''}
        <h4 class="card-movement-ledger-heading">Posted activity · ${card.postedCoverage === 'complete-provider-response' ? 'complete provider response' : 'coverage incomplete'}</h4>
        ${card.posted.map(transaction).join('') || `<p class="card-movement-note">${card.postedCoverage === 'complete-provider-response' && pub.role !== 'future' ? 'No posted movements returned in this period.' : 'No qualified posted activity available.'}</p>`}
        <div class="card-movement-pending"><h4 class="card-movement-ledger-heading">Pending · separate from net change</h4>${card.pending.map(transaction).join('') || `<p class="card-movement-note">${card.pendingCoverage === 'complete-provider-response' ? 'No pending authorizations returned.' : card.pendingCoverage === 'not-observed' ? 'Pending activity not observed for this selected period.' : 'Pending coverage unavailable.'}</p>`}</div>
        <p class="card-movement-note">Payments reduce the ${card.id === 'heloc' ? 'HELOC' : 'card'} balance. Their household purpose is unconfirmed here: purchase backfills do not automatically settle scheduled minimums. Lender confirmation remains separate.</p>
        <p class="card-movement-note">${pub.observationAsOf ? 'Provider observation · ' + day(pub.observationAsOf) + '. ' : ''}Posted activity is balance movement; purchases remain in their spending categories once.</p>
      </section>`).join('')}</section>`;
  }
  function wire(mount) {
    if (!mount || typeof mount.querySelector !== 'function') return;
    const strip = mount.querySelector('[data-budget-card-movements]');
    if (!strip) return;
    const buttons = [...strip.querySelectorAll('[data-budget-card-toggle]')];
    const panels = [...strip.querySelectorAll('[data-budget-card-panel]')];
    const select = (id, restoreFocus) => {
      expanded = id;
      buttons.forEach(button => button.setAttribute('aria-expanded', String(button.getAttribute('data-budget-card-toggle') === id)));
      panels.forEach(panel => { panel.hidden = panel.getAttribute('data-budget-card-panel') !== id; });
      if (restoreFocus) { restoreFocus.focus({ preventScroll: true }); restoreFocus.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    };
    buttons.forEach(button => button.addEventListener('click', () => {
      const id = button.getAttribute('data-budget-card-toggle');
      select(expanded === id ? null : id);
    }));
    strip.querySelectorAll('[data-budget-card-close]').forEach(button => button.addEventListener('click', () => {
      select(null, buttons.find(trigger => trigger.getAttribute('data-budget-card-toggle') === button.getAttribute('data-budget-card-close')));
    }));
    strip.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !expanded) return;
      event.preventDefault(); const trigger = buttons.find(button => button.getAttribute('data-budget-card-toggle') === expanded);
      select(null, trigger);
    });
  }
  return { html, wire };
});
