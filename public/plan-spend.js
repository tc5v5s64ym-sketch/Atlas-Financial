'use strict';
/* Plan Spend renders Forecast.majorPlans in Forecast.planSpendCards order.
 * The funding explanation and due-period link are Forecast publications.
 * This page does not allocate savings or calculate household figures. */

const PLAN_SPEND_VERDICT = {
  'ON TRACK': { cls: 'on-track', chip: 'v', label: 'FEASIBLE IN CURRENT PLAN' },
  'AT RISK': { cls: 'at-risk', chip: 'w', label: 'AT RISK' },
  'FUNDING GAP': { cls: 'funding-gap', chip: 'c', label: 'FUNDING SHORTFALL' },
};

function planSpendRequirement(row) {
  if (row.need != null) return { amount: money2(row.need), label: 'Cost', kind: 'point' };
  if (row.amountMin != null && row.amountMax != null) {
    return { amount: `${money2(row.amountMin)}–${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  }
  if (row.amountMin != null) return { amount: `From ${money2(row.amountMin)}`, label: 'Cost range', kind: 'range' };
  if (row.amountMax != null) return { amount: `Up to ${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  return { amount: 'Not established', label: 'Cost', kind: 'unresolved' };
}

function planSpendTiming(row) {
  if (row.tripWindow && row.date) {
    return { text: `${row.tripWindow} trip · Due ${fmtDateFull(row.date)}`, kind: 'trip-window' };
  }
  if (row.date) return { text: `Due ${fmtDateFull(row.date)}`, kind: 'dated' };
  if (row.tripWindow) return { text: row.tripWindow, kind: 'trip-window' };
  if (row.when) return { text: row.when, kind: 'approximate' };
  return { text: 'Date not established', kind: 'unresolved' };
}

function planSpendFact(name, label, value) {
  return `<div data-plan-spend-fact="${name}"><dt>${label}</dt><dd>${value}</dd></div>`;
}

function planSpendConfidence(row) {
  const confidence = row.confidence || '';
  if (!confidence) return '';
  const cls = confidence === 'confirmed' ? 'v' : confidence === 'estimated' ? 'w' : 'e';
  return `<span class="chip ${cls}">${confidence.toUpperCase()}</span>`;
}

function planSpendStatus(row) {
  const state = PLAN_SPEND_VERDICT[row.verdict] || { cls: '', chip: 'e', label: 'STATUS UNAVAILABLE' };
  return `<div class="plan-spend-status"><span class="chip ${state.chip}">${state.label}</span>${planSpendConfidence(row)}</div>`;
}

function planSpendSummarySentence(row, grouped) {
  if (row.verdict === 'FUNDING GAP') {
    if (grouped) return 'At least one payment has a Forecast funding shortfall. See the payment schedule below.';
    const amount = row.remaining != null ? money2(row.remaining) : 'an amount not established';
    return row.date
      ? `Atlas currently projects this cost is short by ${amount} by the deadline.`
      : `Atlas currently projects this cost is short by ${amount} in the modeled plan.`;
  }
  if (row.verdict === 'AT RISK') {
    return grouped
      ? 'The base payments fit, but a protected uncertainty case may not. See the payment schedule for the amount at risk.'
      : `The base cost fits, but a protected uncertainty case is short by ${row.remaining != null ? money2(row.remaining) : 'an amount not established'}.`;
  }
  if (row.verdict === 'ON TRACK') {
    if (grouped) {
      const count = (row.members || []).length;
      const dated = (row.members || []).every(member => !!member.date);
      return dated
        ? `Current Forecast can cover all ${count} remaining payments by their deadlines.`
        : 'Current Forecast can cover these payments in the modeled plan; some dates are not established.';
    }
    return row.date
      ? 'Current Forecast can cover this by the deadline.'
      : 'Current Forecast can cover this in the modeled plan; the exact date is not established.';
  }
  return 'Forecast has not published a feasibility verdict for this cost.';
}

function planSpendDuePeriod(path) {
  const period = path && path.duePeriod;
  if (!period) return '';
  const sign = period.kind === 'surplus' ? '+' : '';
  return planSpendFact('due-period', 'Due-period result',
    `<span data-plan-spend-period="${period.start}:${period.end}" data-plan-spend-period-status="${period.status}">${sign}${money2(period.amount)} ${period.kind}</span> <span class="chip ${period.status === 'estimated' ? 'w' : 'e'}">${period.status.toUpperCase()}</span>`);
}

function planSpendFundingFacts(path) {
  const setAside = path && path.setAsideNow != null ? money2(path.setAsideNow) : 'Not established';
  const future = path && path.futureCashFlowNeeded != null
    ? money2(path.futureCashFlowNeeded) : 'Not established';
  return `<dl class="plan-spend-facts">
    ${planSpendFact('set-aside', 'Set-aside amount now', setAside)}
    ${planSpendFact('future-flow', 'Still needed from future cash flow', future)}
    ${planSpendDuePeriod(path)}
  </dl>`;
}

function planSpendFundingPath(path, row) {
  const projected = row && row.verdict === 'FUNDING GAP' && row.remaining != null
    ? `<p class="plan-spend-path-gap">Forecast funding shortfall: ${money2(row.remaining)}.</p>` : '';
  return `<details class="plan-spend-more plan-spend-path"><summary>Show funding path</summary>
    <p>Forecast can assess whether this obligation fits the modeled cash path, but has not assigned a per-period savings schedule to it. The path is unallocated.</p>
    <p>Cash already saved for this specific cost and the amount that must come from future cash flow have not been established. A current-payday allocation is not a saved balance.</p>
    ${projected}
    ${path && path.duePeriod ? `<p>The due-period result is the published Road Ahead pay-period result for ${fmtDateFull(path.duePeriod.start)}–${fmtDateFull(path.duePeriod.end)}. It excludes earlier-period surplus.</p>` : ''}
  </details>`;
}

function planSpendRowHtml(row, path) {
  const state = PLAN_SPEND_VERDICT[row.verdict] || { cls: '' };
  const requirement = planSpendRequirement(row);
  const timing = planSpendTiming(row);
  return `<article class="planning-row plan-spend-card ${state.cls}" data-plan-spend-id="${row.id}" data-plan-spend-card="row" data-plan-spend-verdict="${row.verdict || ''}" data-plan-spend-amount="${requirement.kind}" data-plan-spend-timing="${timing.kind}">
    <div class="plan-spend-glance">
      <h2>${row.label}</h2>
      <div data-plan-spend-fact="requirement"><b>${requirement.amount}</b><small>${requirement.label}</small></div>
      <span data-plan-spend-when>${timing.text}</span>
      ${planSpendStatus(row)}
      <p class="plan-spend-explanation">${planSpendSummarySentence(row, false)}</p>
      ${planSpendFundingFacts(path)}
    </div>
    ${planSpendFundingPath(path, row)}
  </article>`;
}

function planSpendMemberTiming(member) {
  if (member.date) return fmtDateFull(member.date);
  if (member.when) return member.when;
  return 'Date not established';
}

function planSpendSummaryTiming(card) {
  const parts = (card.members || []).map(planSpendMemberTiming);
  return { text: parts.join(' · '), kind: 'schedule' };
}

function planSpendSummaryAmount(card) {
  if (card.scheduleRemaining != null && Number.isFinite(Number(card.scheduleRemaining))) {
    return { amount: money2(card.scheduleRemaining), label: 'remaining', kind: 'schedule' };
  }
  return { amount: 'Not established', label: 'remaining', kind: 'unresolved' };
}

function planSpendSummaryHtml(card, pathById) {
  const state = PLAN_SPEND_VERDICT[card.verdict] || { cls: '' };
  const amount = planSpendSummaryAmount(card);
  const timing = planSpendSummaryTiming(card);
  const memberIds = (card.members || []).map(member => member.id).join(' ');
  const lines = (card.members || []).map(member => {
    const exception = member.verdict && member.verdict !== card.verdict
      ? `<span class="chip ${(PLAN_SPEND_VERDICT[member.verdict] || { chip: 'e' }).chip}">${(PLAN_SPEND_VERDICT[member.verdict] || { label: member.verdict }).label}</span>` : '';
    const confidence = member.confidence && member.confidence !== card.confidence
      ? planSpendConfidence(member) : '';
    const memberAmount = member.need != null ? money2(member.need) : 'Not established';
    const due = planSpendDuePeriod(pathById.get(member.id));
    const pressure = (member.verdict === 'FUNDING GAP' || member.verdict === 'AT RISK')
      && member.remaining != null
      ? planSpendFact('member-pressure', member.verdict === 'FUNDING GAP'
        ? 'Funding shortfall' : 'Protected amount at risk', money2(member.remaining)) : '';
    return `<li data-plan-spend-member="${member.id}">
      <span>${member.label}</span><b>${memberAmount}</b><time>${planSpendMemberTiming(member)}</time>${exception}${confidence}
      ${pressure ? `<dl class="plan-spend-member-period">${pressure}</dl>` : ''}
      ${due ? `<dl class="plan-spend-member-period">${due}</dl>` : ''}
    </li>`;
  }).join('');
  return `<article class="planning-row plan-spend-card ${state.cls}" data-plan-spend-id="${card.id}" data-plan-spend-card="summary" data-plan-spend-members="${memberIds}" data-plan-spend-verdict="${card.verdict || ''}" data-plan-spend-amount="${amount.kind}" data-plan-spend-timing="${timing.kind}">
    <div class="plan-spend-glance">
      <h2>${card.label}</h2>
      <div data-plan-spend-fact="schedule-remaining"><b>${amount.amount}</b><small>${amount.label}</small></div>
      <span data-plan-spend-when>${timing.text}</span>
      ${planSpendStatus(card)}
      <p class="plan-spend-explanation">${planSpendSummarySentence(card, true)}</p>
      ${planSpendFundingFacts(null)}
    </div>
    <details class="plan-spend-more"><summary>Show payment schedule</summary><ul class="plan-spend-schedule">${lines}</ul></details>
    ${planSpendFundingPath(null, card)}
  </article>`;
}

function planSpendPageHtml(advice, liveOverlay) {
  advice = advice || {};
  const unavailable = advice.operatingPlanUnavailable === true
    || (liveOverlay && liveOverlay.operatingPlan === 'unavailable');
  if (unavailable) {
    const note = advice.operatingPlanNote || (liveOverlay && liveOverlay.operatingPlanNote)
      || 'Current plan unavailable. The dated opening is stale.';
    return { lede: '', list: `<div class="note-box crit" data-operating-plan="unavailable">${note} Forecast verdicts for planned spending are withheld until a trusted current opening exists.</div>`, note: '' };
  }
  const plans = Array.isArray(advice.majorPlans) ? advice.majorPlans : [];
  if (!plans.length) {
    return { lede: '', list: '<p class="lede" data-plan-spend="empty">No unsettled planned spending is published on this opening.</p>', note: '' };
  }
  if (typeof Forecast === 'undefined' || typeof Forecast.planSpendCards !== 'function') {
    return { lede: '', list: '<div class="note-box crit" data-plan-spend="cards-unavailable">Plan spend cards are unavailable.</div>', note: '' };
  }
  const cards = Forecast.planSpendCards(plans);
  const pathById = new Map((Array.isArray(advice.planSpendFundingPaths)
    ? advice.planSpendFundingPaths : []).map(path => [path.id, path]));
  const list = cards.map(card => card.kind === 'summary'
    ? planSpendSummaryHtml(card, pathById)
    : planSpendRowHtml(card, pathById.get(card.id))).join('');
  return {
    lede: `${cards.length} planned cost${cards.length === 1 ? '' : 's'} in Forecast's current funding order. Feasible means Forecast can cover a cost in the modeled plan; it does not mean the cash is already saved.`,
    note: 'Amounts, dates, verdicts, and due-period results come from Forecast. A set-aside amount is shown only when Forecast can establish one for that cost.',
    list,
  };
}

function planSpendAdvice(d, periods) {
  const overlay = d.liveOverlay;
  const actuals = overlay && overlay.applied === true ? overlay.currentPeriodActuals : null;
  const advice = Forecast.recommend(d.plan, d.meta.asOf, {
    fundingSources: d.plan.funding && d.plan.funding.options,
    debts: d.debts,
    extraFacilities: d.revolvingExtra,
    periods: periods || null,
    currentPeriodActuals: actuals,
    operatingPlan: overlay && overlay.operatingPlan,
    operatingPlanNote: overlay && overlay.operatingPlanNote,
  });
  if (!advice.operatingPlanUnavailable) {
    const trajectory = Forecast.baselineTrajectory(d.plan, d.debts, d.meta.asOf, {
      periods: periods || null,
      currentPeriodActuals: actuals,
    });
    advice.planSpendFundingPaths = Forecast.planSpendFundingPaths(advice.majorPlans, trajectory);
  }
  return advice;
}

function renderPlanSpend(d, periods) {
  const html = planSpendPageHtml(planSpendAdvice(d, periods), d.liveOverlay);
  const lede = $('plan-spend-lede');
  const list = $('plan-spend-list');
  const note = $('plan-spend-note');
  if (lede) lede.textContent = html.lede;
  if (list) list.innerHTML = html.list;
  if (note) note.textContent = html.note;
}

App.register(renderPlanSpend);
App.boot({ periods: true });
