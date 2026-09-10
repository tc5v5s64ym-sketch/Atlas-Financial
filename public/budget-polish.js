'use strict';
/* Atlas Budget visual polish.
 *
 * Presentation only. public/plan.js has already rendered every financial
 * figure and settlement state from Forecast before this file runs. This layer
 * groups those existing DOM nodes into the approved phone-first visual
 * hierarchy and adds human-readable status badges. It does not call Forecast,
 * read canonical data, total money, infer settlement, or move an obligation.
 */

(function init(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') api.boot(document);
})(function buildApi() {
  const APPLIED = 'data-atlas-budget-ui';

  function billStatePresentation(status) {
    const key = String(status == null ? '' : status).trim().toLowerCase();
    if (key === 'paid') return { label: 'PAID', kind: 'paid' };
    if (key === 'still due') return { label: 'TO PAY', kind: 'to-pay' };
    if (key === 'pending') return { label: 'PENDING', kind: 'pending' };
    if (key === 'needs confirmation') return { label: 'CHECK', kind: 'check' };
    return null;
  }

  function cleanBillLabel(value, status) {
    let out = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const key = String(status == null ? '' : status).trim().toLowerCase();
    const suffix = key === 'paid' ? 'PAID'
      : key === 'still due' ? 'still due'
      : key === 'pending' ? 'pending'
      : key === 'needs confirmation' ? 'needs confirmation'
      : null;
    if (!suffix) return out;
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return out.replace(new RegExp(`\\s*·\\s*${escaped}\\s*$`, 'i'), '').trim();
  }

  function directElementChildren(node) {
    return Array.from((node && node.children) || []);
  }

  function decorateBillLine(doc, line) {
    if (!line || line.hasAttribute('data-atlas-bill-row')) return false;
    const status = line.getAttribute('data-bill-status');
    const meta = billStatePresentation(status);
    if (!meta) return false;
    const children = directElementChildren(line);
    const label = children[0] || null;
    const amount = children.length > 1 ? children[children.length - 1] : null;
    if (!label || !amount) return false;

    label.textContent = cleanBillLabel(label.textContent, status);
    const badge = doc.createElement('span');
    badge.className = `atlas-bill-state atlas-bill-state-${meta.kind}`;
    badge.setAttribute('data-atlas-bill-state', meta.kind);
    badge.textContent = meta.label;
    line.insertBefore(badge, amount);
    line.classList.add('atlas-bill-row', `atlas-bill-row-${meta.kind}`);
    line.setAttribute('data-atlas-bill-row', 'true');
    return true;
  }

  function sectionCard(doc, waterfall, className, nodes) {
    const kept = (nodes || []).filter(Boolean);
    if (!kept.length) return null;
    const card = doc.createElement('section');
    card.className = `atlas-budget-section ${className}`;
    kept.forEach(node => card.appendChild(node));
    waterfall.appendChild(card);
    return card;
  }

  function decorateWaterfall(doc, waterfall) {
    if (!waterfall || waterfall.hasAttribute(APPLIED)) return false;
    if (waterfall.getAttribute('data-operating-plan') === 'unavailable') return false;
    waterfall.setAttribute(APPLIED, 'true');

    const question = number => waterfall.querySelector(`[data-operating-question="${number}"]`);
    const opening = question('01');
    const income = question('02');
    const bills = question('04');
    const afterBills = question('05');
    const budget = question('06');
    const afterBudget = question('07');

    const paydayBalance = income && income.querySelector('[data-payday-balance]');
    if (opening || paydayBalance) {
      const summary = doc.createElement('div');
      summary.className = 'atlas-period-summary';
      summary.setAttribute('data-atlas-period-summary', 'true');
      if (opening) {
        const prompt = opening.querySelector('.operating-prompt');
        if (prompt) prompt.textContent = 'Rollover balance';
        opening.classList.add('atlas-summary-card', 'atlas-rollover-summary');
        summary.appendChild(opening);
      }
      if (paydayBalance) {
        const payday = doc.createElement('div');
        payday.className = 'atlas-summary-card atlas-payday-summary';
        payday.setAttribute('data-atlas-payday-summary', 'true');
        payday.appendChild(paydayBalance);
        summary.appendChild(payday);
      }
      waterfall.appendChild(summary);
    }

    const incomeCard = sectionCard(doc, waterfall, 'atlas-income-card', [income]);
    const billsCard = sectionCard(doc, waterfall, 'atlas-bills-card', [bills, afterBills]);
    sectionCard(doc, waterfall, 'atlas-household-budget-card', [budget, afterBudget]);

    if (incomeCard) incomeCard.setAttribute('data-atlas-section', 'income');
    if (billsCard) {
      billsCard.setAttribute('data-atlas-section', 'bills');
      billsCard.querySelectorAll('[data-bill-status]').forEach(line => decorateBillLine(doc, line));
    }
    const budgetCard = waterfall.querySelector('.atlas-household-budget-card');
    if (budgetCard) budgetCard.setAttribute('data-atlas-section', 'household-budget');
    return true;
  }

  function enhance(doc) {
    const body = doc && doc.getElementById && doc.getElementById('operating-surface-body');
    if (!body || !body.querySelector('[data-calendar-waterfalls]')) return false;
    let changed = false;
    body.querySelectorAll('[data-calendar-waterfall]').forEach(waterfall => {
      if (decorateWaterfall(doc, waterfall)) changed = true;
    });
    const current = body.querySelector('[data-live-current-balance]');
    if (current) current.classList.add('atlas-current-balance-card');
    body.classList.add('atlas-budget-ui-ready');
    return changed;
  }

  function boot(doc) {
    const body = doc && doc.getElementById && doc.getElementById('operating-surface-body');
    if (!body) return null;
    enhance(doc);
    if (typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver(() => enhance(doc));
    observer.observe(body, { childList: true, subtree: true });
    return observer;
  }

  return {
    billStatePresentation,
    cleanBillLabel,
    decorateBillLine,
    decorateWaterfall,
    enhance,
    boot,
  };
});
