'use strict';
/* Plain-language presentation for the household operating surface.
 *
 * This file deliberately owns no financial meaning. It reads only the DOM
 * that public/plan.js already rendered from Forecast and makes that same
 * answer easier to scan on a phone: the action first, details collapsed,
 * duplicate diagnostics grouped, and system vocabulary translated into
 * ordinary household language. It never reads canonical current-state
 * files, calls Forecast, fetches evidence, totals money, settles an
 * obligation, or changes a plan.
 */

(function init(factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') api.boot(document);
})(function buildApi() {
  const APPLIED = 'data-household-view-applied';

  const clean = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();

  function aggregateTexts(values) {
    const order = [];
    const counts = new Map();
    for (const raw of values || []) {
      const value = clean(raw);
      if (!value) continue;
      if (!counts.has(value)) order.push(value);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return order.map(text => ({ text, count: counts.get(text) }));
  }

  function friendlyDiagnostic(text, count) {
    const value = clean(text);
    const n = Number(count) || 1;
    const plural = n === 1 ? '' : 's';

    if (value === 'A material observation could not be safely classified.') {
      return `${n} observation${plural} still need${n === 1 ? 's' : ''} classification.`;
    }
    if (value === 'Unmatched household cash movement was not classified into a modeled item.') {
      return `${n} cash movement${plural} still need${n === 1 ? 's' : ''} review.`;
    }
    const unmatched = /^(\d+) unmatched household cash movements were not classified into modeled items\.$/.exec(value);
    if (unmatched) return `${unmatched[1]} cash movements still need review.`;
    if (value === 'Category allocation is incomplete, so named remaining is not an exact claim.') {
      return 'Some spending is still uncategorized, so category remaining amounts are not exact.';
    }
    if (value === 'A modeled item remains unverified. That is not a claim it is unpaid.') {
      return `${n} bill${plural} still need${n === 1 ? 's' : ''} confirmation. Atlas is not treating ${n === 1 ? 'it' : 'them'} as unpaid.`;
    }
    return n === 1 ? value : `${n} items: ${value}`;
  }

  function cashValueFromNote(value) {
    const match = /Current spendable cash:\s*([^·]+)/i.exec(clean(value));
    return match ? clean(match[1]) : null;
  }

  function friendlySpendingNote(value) {
    const source = clean(value);
    let out = 'This is the household spending limit until the next payday.';
    if (/Essential costs come out of it first\./i.test(source)) {
      out += ' Essential costs come out of it first.';
    }
    if (/Current remaining spend cannot be confirmed/i.test(source)) {
      out += ' Current remaining spend is not confirmed.';
    }
    return out;
  }

  function firstDirectChild(parent, predicate) {
    return Array.from((parent && parent.children) || []).find(predicate) || null;
  }

  function makeFact(doc, label, value) {
    const item = doc.createElement('div');
    item.className = 'household-fact';
    const key = doc.createElement('span');
    key.textContent = label;
    const val = doc.createElement('b');
    val.textContent = value;
    item.append(key, val);
    return item;
  }

  function enhanceQuestionOne(doc, body) {
    const q = body.querySelector('[data-operating-question="01"]');
    const answer = q && q.querySelector('.operating-answer');
    if (!q || !answer) return false;
    const prompt = q.querySelector('.operating-prompt');
    if (prompt) prompt.textContent = 'What should I do today?';
    if (answer.querySelector('[data-today-decision]')) return true;

    const card = answer.querySelector('[data-current-period-action]');
    if (!card) return false;

    const movement = firstDirectChild(card, el => el.matches && (
      el.matches('p.operating-lead') || el.matches('p.current-period-withheld')
    ));
    const todayRows = Array.from(card.querySelectorAll('[data-current-today-action]'));
    const note = Array.from(answer.querySelectorAll('.operating-note'))
      .find(el => /Current spendable cash:/i.test(clean(el.textContent)));
    const cash = note ? cashValueFromNote(note.textContent) : null;
    const paydayNode = card.querySelector('[data-current-next-payday]');
    const payday = paydayNode
      ? clean(paydayNode.textContent).replace(/\s+payday$/i, '')
      : null;
    const unsafe = Array.from(card.querySelectorAll('p')).some(el =>
      /current-period constraint/i.test(clean(el.textContent))
      || /payday-refuse/.test(el.className)
    ) || !!card.querySelector('.payday-refuse');

    if (!movement && !todayRows.length && !cash && !payday) return false;

    const summary = doc.createElement('div');
    summary.className = 'household-now';
    summary.setAttribute('data-today-decision', unsafe ? 'hold' : (todayRows.length ? 'pay-today' : 'none'));

    const lead = doc.createElement('p');
    lead.className = unsafe ? 'household-primary household-tight' : 'household-primary';
    const movementText = movement ? clean(movement.textContent) : '';
    if (todayRows.length) {
      lead.textContent = 'Do these today.';
    } else if (unsafe) {
      lead.textContent = payday
        ? `Hold discretionary spending until ${payday}.`
        : 'Hold discretionary spending until payday.';
    } else if (movementText === 'No money movement is required today.') {
      lead.textContent = 'No action required today.';
    } else {
      lead.textContent = movementText || 'Today’s action is shown below.';
    }
    summary.appendChild(lead);

    if (unsafe && movementText === 'No money movement is required today.') {
      const warn = doc.createElement('p');
      warn.className = 'operating-limit warn';
      warn.textContent = 'No payment or transfer is required today. Protected cash needs are still unfunded.';
      summary.appendChild(warn);
    }

    if (todayRows.length) {
      const actions = doc.createElement('div');
      actions.className = 'household-today-actions';
      for (const row of todayRows) actions.appendChild(row.cloneNode(true));
      summary.appendChild(actions);
    }

    if (cash || payday) {
      const facts = doc.createElement('div');
      facts.className = 'household-facts';
      if (cash) facts.appendChild(makeFact(doc, 'Spendable cash · not credit', cash));
      if (payday) facts.appendChild(makeFact(doc, 'Next payday', payday));
      summary.appendChild(facts);
    }

    const kept = Array.from(answer.children);
    const details = doc.createElement('details');
    details.className = 'household-inline-details household-period-details';
    const detailsSummary = doc.createElement('summary');
    detailsSummary.textContent = 'See current-period details';
    details.appendChild(detailsSummary);
    for (const node of kept) details.appendChild(node);
    answer.replaceChildren(summary, details);
    return true;
  }

  function enhanceQuestionTwo(doc, body) {
    const q = body.querySelector('[data-operating-question="02"]');
    const answer = q && q.querySelector('.operating-answer');
    if (!q || !answer) return false;
    const prompt = q.querySelector('.operating-prompt');
    if (prompt) prompt.textContent = 'What can I spend until payday?';
    if (answer.querySelector('[data-spend-decision]')) return true;

    const refusal = answer.querySelector('.payday-refuse');
    if (refusal) {
      const reason = clean(refusal.textContent);
      const primary = doc.createElement('p');
      primary.className = 'household-primary household-tight';
      primary.setAttribute('data-spend-decision', 'none');
      primary.textContent = 'No safe spending amount.';
      const details = doc.createElement('details');
      details.className = 'household-inline-details';
      const summary = doc.createElement('summary');
      summary.textContent = 'Why?';
      const explanation = doc.createElement('p');
      explanation.textContent = reason;
      details.append(summary, explanation);
      answer.replaceChildren(primary, details);
      return true;
    }

    const amount = answer.querySelector('.operating-amount');
    if (amount) {
      const notes = answer.querySelectorAll('.operating-note');
      for (const note of notes) {
        note.textContent = friendlySpendingNote(note.textContent);
      }
      return true;
    }
    return false;
  }

  function enhanceQuestionThree(doc, body) {
    const q = body.querySelector('[data-operating-question="03"]');
    const answer = q && q.querySelector('.operating-answer');
    if (!q || !answer) return false;
    const prompt = q.querySelector('.operating-prompt');
    if (prompt) prompt.textContent = 'What happens on the next payday?';
    return true;
  }

  function enhanceQuestionFour(doc, body) {
    const q = body.querySelector('[data-operating-question="04"]');
    const answer = q && q.querySelector('.operating-answer');
    if (!q || !answer) return false;
    const prompt = q.querySelector('.operating-prompt');
    if (prompt) prompt.textContent = 'What future costs affect today?';

    const current = answer.querySelector('.future-gravity-current');
    const currentHeading = current && current.querySelector('h3');
    if (currentHeading) currentHeading.textContent = 'Still to cover before payday';
    if (answer.querySelector('.household-future-details')) return true;

    const detailNodes = Array.from(answer.children).filter(node => node !== current);
    if (!detailNodes.length) return true;
    const details = doc.createElement('details');
    details.className = 'household-inline-details household-future-details';
    const summary = doc.createElement('summary');
    summary.textContent = 'See all future costs';
    details.appendChild(summary);
    for (const node of detailNodes) details.appendChild(node);
    answer.appendChild(details);
    return true;
  }

  function enhanceQuestionFive(doc, body) {
    const q = body.querySelector('[data-operating-question="05"]');
    const answer = q && q.querySelector('.operating-answer');
    if (!q || !answer) return false;
    const prompt = q.querySelector('.operating-prompt');
    if (prompt) prompt.textContent = 'What are we doing with debt?';

    const headings = answer.querySelectorAll('h3');
    if (headings[0]) headings[0].textContent = 'Required payments';
    if (headings[1]) headings[1].textContent = 'Extra this payday';

    for (const lead of answer.querySelectorAll('.operating-lead')) {
      const value = clean(lead.textContent);
      if (value === 'No surplus is going to debt this period.'
        || value === 'No extra debt payment this payday.') {
        lead.textContent = 'No extra debt payment this payday.';
      } else if (/^Forecast starts this period's extra principal with /i.test(value)) {
        lead.textContent = value.replace(/^Forecast starts this period's extra principal with /i, 'Extra debt money this payday goes to ');
      } else if (/^Extra debt money this payday goes to /i.test(value)) {
        continue;
      } else if (value === 'No extra-debt allocation is available on this opening.'
        || value === 'Atlas can’t name an extra debt payment on this opening.') {
        lead.textContent = 'Atlas can’t name an extra debt payment right now.';
      }
    }

    for (const p of answer.querySelectorAll('p')) {
      const b = p.querySelector('b');
      if (!b) continue;
      if (clean(b.textContent) === 'Current extra-debt target:') b.textContent = 'Debt target:';
      if (clean(b.textContent) === 'What happens next:') b.textContent = 'After that:';
    }

    if (answer.querySelector('.household-inline-details')) return true;
    const technical = Array.from(answer.querySelectorAll('p.operating-note'));
    if (technical.length) {
      const details = doc.createElement('details');
      details.className = 'household-inline-details';
      const summary = doc.createElement('summary');
      summary.textContent = 'Debt details';
      details.appendChild(summary);
      for (const note of technical) details.appendChild(note);
      answer.appendChild(details);
    }
    return true;
  }

  function aggregateList(doc, list) {
    if (!list) return;
    const rows = aggregateTexts(Array.from(list.querySelectorAll('li')).map(li => li.textContent));
    list.replaceChildren();
    for (const row of rows) {
      const li = doc.createElement('li');
      li.textContent = friendlyDiagnostic(row.text, row.count);
      list.appendChild(li);
    }
  }

  function enhanceTrust(doc, body) {
    const trust = body.querySelector('.refresh-trust');
    if (!trust) return false;
    const state = trust.querySelector('.refresh-trust-state');
    if (state && !/^Data status:/i.test(clean(state.textContent))) {
      state.textContent = `Data status: ${clean(state.textContent)}`;
    }
    const asOf = trust.querySelector('.refresh-trust-asof');
    if (asOf) asOf.textContent = clean(asOf.textContent).replace(/^Last observed and reconciled /i, 'Updated ');

    aggregateList(doc, trust.querySelector('.refresh-trust-limits'));
    aggregateList(doc, trust.querySelector('.refresh-trust-unresolved'));

    const detailNodes = Array.from(trust.children).filter(node =>
      node !== state && node !== asOf && !node.classList.contains('household-trust-details'));
    if (detailNodes.length) {
      const details = doc.createElement('details');
      details.className = 'household-trust-details';
      const summary = doc.createElement('summary');
      summary.textContent = 'See data quality details';
      details.appendChild(summary);
      for (const node of detailNodes) details.appendChild(node);
      trust.appendChild(details);
    }

    body.appendChild(trust);
    return true;
  }

  function enhanceCertainty(doc, body) {
    const block = body.querySelector('[data-operating-certainty]');
    if (!block || block.querySelector('.household-inline-details')) return false;
    const children = Array.from(block.children);
    if (!children.length) return false;
    const details = doc.createElement('details');
    details.className = 'household-inline-details';
    const summary = doc.createElement('summary');
    summary.textContent = 'How certain is this?';
    details.appendChild(summary);
    for (const node of children) details.appendChild(node);
    block.appendChild(details);
    return true;
  }

  function enhance(doc) {
    const body = doc && doc.getElementById && doc.getElementById('operating-surface-body');
    if (!body) return false;
    const q1 = body.querySelector('[data-operating-question="01"]');
    if (!q1 || q1.hasAttribute(APPLIED)) return false;

    q1.setAttribute(APPLIED, 'true');
    enhanceQuestionOne(doc, body);
    enhanceQuestionTwo(doc, body);
    enhanceQuestionThree(doc, body);
    enhanceQuestionFour(doc, body);
    enhanceQuestionFive(doc, body);
    enhanceCertainty(doc, body);
    enhanceTrust(doc, body);
    body.classList.add('household-view-ready');
    return true;
  }

  function boot(doc) {
    const body = doc && doc.getElementById && doc.getElementById('operating-surface-body');
    if (!body) return null;
    enhance(doc);
    if (typeof MutationObserver === 'undefined') return null;
    const observer = new MutationObserver(() => enhance(doc));
    observer.observe(body, { childList: true, subtree: false });
    return observer;
  }

  return {
    aggregateTexts,
    friendlyDiagnostic,
    cashValueFromNote,
    friendlySpendingNote,
    enhance,
    boot,
  };
});
