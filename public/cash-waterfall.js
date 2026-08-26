'use strict';
/* Household cash waterfall presentation.
 *
 * This layer owns no financial arithmetic. It reads only values that the
 * incumbent Plan renderer has already published from Forecast, then arranges
 * those values in the owner's household order: money in, bills, household,
 * debt minimums, future-cost set-asides, extra debt, and left over.
 * Historical category actuals are shown only as labelled reference norms.
 * They are never promoted into a target, permission, allocation, or policy.
 */

(function init(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') api.boot(document);
})(function buildApi() {
  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const canonical = value => clean(value).split(' · ')[0].trim();

  function historicalNormFromText(value) {
    const match = /\bhas been\s+(\$[\d,]+(?:\.\d{2})?)/i.exec(clean(value));
    return match ? match[1] : null;
  }

  function displayAmount(value) {
    const text = clean(value);
    if (/^[+−-][\d,.]+$/.test(text)) return '$' + text.slice(1);
    return text;
  }

  function copyRows(rows) {
    return (rows || []).filter(Boolean).map(row => ({
      label: clean(row.label),
      value: clean(row.value),
      date: clean(row.date),
      meta: clean(row.meta),
    }));
  }

  function buildModel(source) {
    source = source || {};
    const debtMinimums = copyRows(source.debtMinimums);
    const debtLabels = new Set(debtMinimums.map(row => canonical(row.label)));
    const scheduledOutflows = copyRows(source.scheduledOutflows)
      .filter(row => !debtLabels.has(canonical(row.label)));
    const historicalNorms = copyRows(source.historicalNorms)
      .filter(row => row.value);

    return {
      action: clean(source.action),
      actionTone: source.actionTone === 'tight' ? 'tight' : 'normal',
      spendableCash: clean(source.spendableCash),
      nextPayday: clean(source.nextPayday),
      scheduledIncome: copyRows(source.scheduledIncome),
      requiredBills: copyRows(source.requiredBills)[0] || null,
      scheduledOutflows,
      household: copyRows(source.household)[0] || null,
      historicalNorms,
      debtMinimums,
      futureAllocations: copyRows(source.futureAllocations),
      extraDebt: copyRows(source.extraDebt)[0] || null,
      debtTarget: clean(source.debtTarget),
      leftover: copyRows(source.leftover)[0] || null,
      dataStatus: clean(source.dataStatus),
      dataAsOf: clean(source.dataAsOf),
    };
  }

  function operatingQuestion(body, number) {
    return body && body.querySelector(`[data-operating-question="${number}"]`);
  }

  function operatingRows(root) {
    return Array.from((root && root.querySelectorAll('.operating-line')) || []).map(row => {
      const spans = row.querySelectorAll('span');
      return {
        label: spans[0] ? clean(spans[0].textContent) : '',
        value: spans.length ? clean(spans[spans.length - 1].textContent) : '',
      };
    }).filter(row => row.label);
  }

  function factValue(root, startsWith) {
    for (const fact of Array.from((root && root.querySelectorAll('.household-fact')) || [])) {
      const label = fact.querySelector('span');
      const value = fact.querySelector('b');
      if (label && value && clean(label.textContent).toLowerCase().startsWith(startsWith.toLowerCase())) {
        return clean(value.textContent);
      }
    }
    return '';
  }

  function agendaRows(doc, selector) {
    return Array.from(doc.querySelectorAll(selector)).map(row => ({
      label: clean((row.querySelector('.ag14-lab') || {}).textContent),
      value: displayAmount((row.querySelector('.ag14-amt') || {}).textContent),
      date: clean((row.querySelector('.ag14-date') || {}).textContent),
      meta: clean((row.querySelector('.ag14-conf') || {}).textContent),
    })).filter(row => row.label && row.value);
  }

  function directTextLabel(node) {
    if (!node) return '';
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === 3 && clean(child.textContent)) return clean(child.textContent);
    }
    return clean(node.textContent)
      .replace(/\bessential\b/ig, '')
      .replace(/\bowner budget\b/ig, '')
      .replace(/\bon the calendar\b/ig, '')
      .replace(/\bsinking fund\b/ig, '')
      .replace(/\breserve\b/ig, '')
      .replace(/\bunknown\b/ig, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function historicalRows(doc) {
    return Array.from(doc.querySelectorAll('#budget-cats .cat-row')).map(row => {
      const labelNode = row.querySelector('.cat-lab');
      const hist = row.querySelector('.cat-hist');
      const labelText = clean(labelNode && labelNode.textContent);
      const historical = historicalNormFromText(hist && hist.textContent);
      return {
        label: directTextLabel(labelNode),
        value: historical ? historical + ' / month' : '',
        date: '',
        meta: /\bessential\b/i.test(labelText) ? 'Recent actual · essential' : 'Recent actual',
      };
    }).filter(row => row.label && row.value && /essential/i.test(row.meta));
  }

  function debtTarget(q5) {
    for (const p of Array.from((q5 && q5.querySelectorAll('p')) || [])) {
      const b = p.querySelector('b');
      if (b && clean(b.textContent) === 'Debt target:') {
        return clean(p.textContent).replace(/^Debt target:\s*/i, '');
      }
    }
    return '';
  }

  function extractSource(doc) {
    const body = doc.getElementById('operating-surface-body');
    const q1 = operatingQuestion(body, '01');
    const q3 = operatingQuestion(body, '03');
    const q5 = operatingQuestion(body, '05');
    const primary = q1 && q1.querySelector('.household-primary');
    const payday = q3 && q3.querySelector('[data-payday-decision]');
    if (!body || !q1 || !q3 || !q5 || !primary || !payday) return null;

    const paydayRows = operatingRows(payday);
    const named = label => paydayRows.find(row => canonical(row.label) === label) || null;
    const reserved = new Set(['Required bills', 'Everyday essentials', 'Extra debt', 'Left after that']);
    const futureAllocations = paydayRows.filter(row => !reserved.has(canonical(row.label)));

    const debtMinimums = operatingRows(q5).map(row => ({
      label: canonical(row.label),
      value: row.value,
      date: clean(row.label).split(' · ')[1] || '',
      meta: clean(row.label).split(' · ').slice(2).join(' · '),
    }));

    const trust = body.querySelector('.refresh-trust');
    return {
      action: clean(primary.textContent),
      actionTone: primary.classList.contains('household-tight') ? 'tight' : 'normal',
      spendableCash: factValue(q1, 'Spendable cash'),
      nextPayday: factValue(q1, 'Next payday'),
      scheduledIncome: agendaRows(doc, '#agenda-14 .ag14.in'),
      scheduledOutflows: agendaRows(doc, '#agenda-14 .ag14.out'),
      requiredBills: named('Required bills') ? [named('Required bills')] : [],
      household: named('Everyday essentials') ? [named('Everyday essentials')] : [],
      historicalNorms: historicalRows(doc),
      debtMinimums,
      futureAllocations,
      extraDebt: named('Extra debt') ? [named('Extra debt')] : [],
      debtTarget: debtTarget(q5),
      leftover: named('Left after that') ? [named('Left after that')] : [],
      dataStatus: clean(trust && (trust.querySelector('.refresh-trust-state') || {}).textContent),
      dataAsOf: clean(trust && (trust.querySelector('.refresh-trust-asof') || {}).textContent),
    };
  }

  function node(doc, tag, className, text) {
    const out = doc.createElement(tag);
    if (className) out.className = className;
    if (text != null) out.textContent = text;
    return out;
  }

  function line(doc, row, className) {
    const out = node(doc, 'div', 'cash-flow-line' + (className ? ' ' + className : ''));
    const copy = node(doc, 'div', 'cash-flow-copy');
    copy.appendChild(node(doc, 'b', '', row.label));
    const detail = [row.date, row.meta].filter(Boolean).join(' · ');
    if (detail) copy.appendChild(node(doc, 'span', '', detail));
    out.append(copy, node(doc, 'strong', 'cash-flow-value', row.value || '—'));
    return out;
  }

  function limitedRows(doc, rows, limit) {
    const box = node(doc, 'div', 'cash-flow-lines');
    const visible = (rows || []).slice(0, limit);
    for (const row of visible) box.appendChild(line(doc, row));
    if ((rows || []).length > limit) {
      const details = node(doc, 'details', 'cash-flow-more');
      details.appendChild(node(doc, 'summary', '', 'See more'));
      for (const row of (rows || []).slice(limit)) details.appendChild(line(doc, row));
      box.appendChild(details);
    }
    return box;
  }

  function sectionBlock(doc, title, amountRow, rows, note) {
    const block = node(doc, 'section', 'cash-flow-block');
    const head = node(doc, 'div', 'cash-flow-heading');
    head.appendChild(node(doc, 'h2', '', title));
    if (amountRow) head.appendChild(node(doc, 'strong', 'cash-flow-total', amountRow.value || '—'));
    block.appendChild(head);
    if (amountRow && clean(amountRow.label) && canonical(amountRow.label) !== title) {
      block.appendChild(node(doc, 'p', 'cash-flow-subline', amountRow.label));
    }
    if (rows && rows.length) block.appendChild(limitedRows(doc, rows, 4));
    if (note) block.appendChild(node(doc, 'p', 'cash-flow-note', note));
    return block;
  }

  function ensureShell(doc) {
    const source = doc.getElementById('operating-surface');
    if (!source || !source.parentNode) return null;
    let waterfall = doc.getElementById('cash-waterfall');
    if (!waterfall) {
      waterfall = node(doc, 'section', 'cash-waterfall');
      waterfall.id = 'cash-waterfall';
      waterfall.setAttribute('aria-live', 'polite');
      source.parentNode.insertBefore(waterfall, source);
    }
    let detail = doc.getElementById('cash-waterfall-atlas-detail');
    if (!detail) {
      detail = node(doc, 'details', 'cash-waterfall-atlas-detail');
      detail.id = 'cash-waterfall-atlas-detail';
      detail.appendChild(node(doc, 'summary', '', 'See full Atlas detail'));
      source.parentNode.insertBefore(detail, source);
      detail.appendChild(source);
    }
    return waterfall;
  }

  function render(doc, waterfall, model) {
    waterfall.replaceChildren();
    waterfall.appendChild(node(doc, 'div', 'kicker', 'HOUSEHOLD MONEY PLAN'));
    waterfall.appendChild(node(doc, 'h1', '', 'Where the money goes'));

    const action = node(doc, 'div', 'cash-flow-action' + (model.actionTone === 'tight' ? ' tight' : ''));
    action.appendChild(node(doc, 'span', '', 'Today'));
    action.appendChild(node(doc, 'strong', '', model.action || 'Current action unavailable.'));
    waterfall.appendChild(action);

    const top = node(doc, 'div', 'cash-flow-top');
    const cash = node(doc, 'div', 'cash-flow-fact');
    cash.append(node(doc, 'span', '', 'Spendable cash · not credit'), node(doc, 'strong', '', model.spendableCash || '—'));
    const payday = node(doc, 'div', 'cash-flow-fact');
    payday.append(node(doc, 'span', '', 'Next payday'), node(doc, 'strong', '', model.nextPayday || '—'));
    top.append(cash, payday);
    waterfall.appendChild(top);

    const flow = node(doc, 'div', 'cash-flow-card');

    const incomeNote = model.scheduledIncome.length
      ? 'Scheduled income shown from the incumbent Forecast calendar.'
      : 'No upcoming income row is currently shown in the 14-day Forecast calendar.';
    flow.appendChild(sectionBlock(doc, 'Money in', null, model.scheduledIncome, incomeNote));

    flow.appendChild(sectionBlock(
      doc,
      'Bills & fixed costs',
      model.requiredBills,
      model.scheduledOutflows,
      'Upcoming non-debt cash outflows are shown from the Forecast calendar. Debt minimums are broken out below.'
    ));

    const household = sectionBlock(
      doc,
      'Household',
      model.household,
      model.historicalNorms,
      model.historicalNorms.length
        ? 'Recent historical actuals are a starting norm, not a spending target or permission.'
        : 'Historical category norms are not available on this view.'
    );
    const normHeading = household.querySelector('.cash-flow-lines');
    if (normHeading) normHeading.insertBefore(node(doc, 'p', 'cash-flow-minihead', 'Recent monthly norms'), normHeading.firstChild);
    flow.appendChild(household);

    flow.appendChild(sectionBlock(
      doc,
      'Debt minimums',
      null,
      model.debtMinimums,
      'Shown separately for clarity. Where due, these required payments are already inside the Forecast required-bills allocation.'
    ));

    flow.appendChild(sectionBlock(
      doc,
      'Savings & future costs',
      null,
      model.futureAllocations,
      model.futureAllocations.length
        ? 'Only set-asides the current Forecast allocation actually names are shown here.'
        : 'No separate future-cost set-aside is named in the current allocation.'
    ));

    const extraRows = model.debtTarget ? [{ label: 'Debt target', value: model.debtTarget, date: '', meta: '' }] : [];
    flow.appendChild(sectionBlock(
      doc,
      'Extra debt payoff',
      model.extraDebt,
      extraRows,
      'This is extra principal only; required debt payments are above.'
    ));

    const leftover = node(doc, 'div', 'cash-flow-leftover');
    leftover.appendChild(node(doc, 'span', '', 'LEFT OVER'));
    leftover.appendChild(node(doc, 'strong', '', model.leftover ? model.leftover.value : '—'));
    leftover.appendChild(node(doc, 'small', '', 'Copied from Forecast after the current protected allocations above.'));
    flow.appendChild(leftover);

    waterfall.appendChild(flow);

    const status = node(doc, 'div', 'cash-flow-status');
    status.appendChild(node(doc, 'b', '', model.dataStatus || 'Data status unavailable'));
    if (model.dataAsOf) status.appendChild(node(doc, 'span', '', model.dataAsOf));
    waterfall.appendChild(status);
  }

  function enhance(doc) {
    const source = extractSource(doc);
    if (!source) return false;
    const waterfall = ensureShell(doc);
    if (!waterfall) return false;
    render(doc, waterfall, buildModel(source));
    return true;
  }

  function boot(doc) {
    const watched = [
      doc.getElementById('operating-surface-body'),
      doc.getElementById('agenda-14'),
      doc.getElementById('budget-cats'),
    ].filter(Boolean);
    enhance(doc);
    if (typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver(() => enhance(doc));
    for (const target of watched) observer.observe(target, { childList: true, subtree: true });
    return observer;
  }

  return {
    historicalNormFromText,
    displayAmount,
    buildModel,
    extractSource,
    enhance,
    boot,
  };
});
