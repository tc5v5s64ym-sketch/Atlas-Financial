'use strict';
/* The one active Budget renderer for #operating-surface-body.
 *
 * Layout only. Every financial section is an incumbent component passed in
 * by public/plan.js (`parts`), rendered whole: this file selects which
 * component to show for the chosen view and arranges them. It does not call
 * Forecast, read a money field, total, label a trust state, or reword a
 * component's output.
 */
(function init(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BudgetSurface = api;
})(globalThis, function buildApi() {
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function card(kind, body, opts = {}) {
    if (!body) return '';
    const label = opts.label ? ` aria-label="${escape(opts.label)}"` : '';
    return `<section class="budget-surface-card budget-surface-${kind}" data-budget-surface-section="${kind}"${label}>
      ${opts.eyebrow ? `<p class="budget-surface-eyebrow">${escape(opts.eyebrow)}</p>` : ''}
      ${body}
    </section>`;
  }

  function payPeriodView(ctx, parts) {
    const today = parts.todayHtml(ctx);
    const period = parts.periodHtml(ctx);
    return `<div class="budget-surface-grid">
      ${card('period', `${parts.headerHtml ? parts.headerHtml(ctx) : ''}
        <div class="budget-surface-today" data-budget-surface-section="today">${today}</div><!--budget-current-position-end-->${period}`,
        { label: 'Selected pay period and current Bills position' })}
    </div>${parts.browseHtml ? parts.browseHtml(ctx) : ''}${parts.fundingHtml ? parts.fundingHtml(ctx) : ''}`;
  }

  function monthView(ctx, parts) {
    const month = parts.monthHtml(ctx);
    const monthLabel = parts.selectedMonthLabel();
    const drill = monthLabel
      ? `<div class="budget-surface-actions">
          <button type="button" class="budget-surface-link" data-budget-granularity="pay-period">See the pay periods in ${escape(monthLabel)}</button>
        </div>`
      : '';
    return card('month', `${month}${drill}`, { eyebrow: 'Calendar month', label: 'Month view' });
  }

  function drilldownView(ctx, parts) {
    const exit = `<div class="budget-surface-actions">
        <button type="button" class="budget-surface-link" data-budget-drilldown-exit>Back to the current pay period</button>
      </div>`;
    return card('drilldown', `${exit}${parts.drilldownHtml(ctx)}`,
      { eyebrow: 'Pay periods in the selected month', label: 'Pay periods in the selected month' });
  }

  function html(ctx, parts) {
    if (parts.planUnavailable(ctx)) {
      return `<div class="payday-operating-sheet budget-surface" data-payday-sheet data-budget-surface="unavailable">
        ${card('unavailable', parts.unavailableHtml(ctx), { eyebrow: 'Budget', label: 'Current plan unavailable' })}
      </div>`;
    }
    const view = parts.granularity() === 'month' ? 'month'
      : parts.inDrilldown() ? 'drilldown' : 'pay-period';
    const body = view === 'month' ? monthView(ctx, parts)
      : view === 'drilldown' ? drilldownView(ctx, parts)
      : payPeriodView(ctx, parts);
    return `<div class="payday-operating-sheet budget-stepped-sheet budget-surface" data-payday-sheet data-budget-surface="${view}">
      ${view === 'pay-period' && parts.headerHtml ? '' : parts.headerHtml ? parts.headerHtml(ctx) : `<div class="budget-surface-bar">${parts.granularityToggleHtml()}</div>`}
      ${body}
      ${parts.detailSheetHtml ? parts.detailSheetHtml() : ''}
    </div>`;
  }

  return { html };
});
