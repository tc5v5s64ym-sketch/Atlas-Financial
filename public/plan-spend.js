'use strict';
/* Plan spend — isolated list of Forecast-published commitments.
 *
 * Every row is a Forecast.majorPlans result on the master plan, reached
 * through the same Forecast.recommend call the Plan page, Forecast page
 * composer, and the assistant packet use. Verdict, remaining requirement,
 * funding order, flexibility, range or point amount, and timing text are
 * all Forecast's. Any current-payday set-aside or by-deadline projection
 * comes from the Forecast.paydayAllocation row for the same id, when
 * Forecast assigned one.
 *
 * Forecast.planSpendCards may reprint several majorPlans rows that share
 * a planSpendSummary group as one card. The card's schedule remaining is
 * that function's sum of those rows' published need values. This file
 * prints it. It does not add amounts, read plan.commitments, grade or
 * rank a cost, collapse a range to a midpoint, turn approximate timing
 * into a day, total every point estimate, or invent a saved balance.
 * Road Ahead on Forecast remains the funding story. */

const PLAN_SPEND_VERDICT = {
  'ON TRACK': { cls: 'on-track', chip: 'v', remaining: 'Covered in the plan', remainingOpen: 'Still unfunded in the plan' },
  'AT RISK': { cls: 'at-risk', chip: 'w', remaining: 'At-risk amount' },
  'FUNDING GAP': { cls: 'funding-gap', chip: 'c', remaining: 'Funding gap' },
};
const PLAN_SPEND_FLEXIBILITY = { required: 'REQUIRED', 'bounded-flex': 'FLEXIBLE', optional: 'OPTIONAL' };

function planSpendRequirement(row) {
  if (row.need != null) return { amount: money2(row.need), label: 'Cost', kind: 'point' };
  if (row.amountMin != null && row.amountMax != null) {
    return { amount: `${money2(row.amountMin)}–${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  }
  if (row.amountMin != null) return { amount: `From ${money2(row.amountMin)}`, label: 'Cost range', kind: 'range' };
  if (row.amountMax != null) return { amount: `Up to ${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  return { amount: 'Unresolved', label: 'Cost amount', kind: 'unresolved' };
}

// Forecast calendar date wins when present, unless Forecast also published
// a trip window. Approximate `when` is printed as given only when Forecast
// published no date and no trip window. Does not invent a day from month
// or holiday wording.
function planSpendTiming(row) {
  if (row.tripWindow) return { text: row.tripWindow, kind: 'trip-window' };
  if (row.date) return { text: fmtDateFull(row.date), kind: 'dated' };
  if (row.when) return { text: row.when, kind: 'approximate' };
  return { text: 'Timing unresolved', kind: 'unresolved' };
}

function planSpendRemainingLabel(row, state) {
  if (row.verdict === 'ON TRACK' && Number(row.remaining) > 0) return state.remainingOpen || state.remaining;
  return state.remaining;
}

function planSpendPaydayFacts(row, payday, unresolved) {
  const facts = [];
  if (payday && payday.projectedByDeadline != null) {
    facts.push(`<div data-plan-spend-fact="projected"><b>${money2(payday.projectedByDeadline)}</b><small>Projected available by deadline</small></div>`);
  }
  if (payday && Number(payday.allocated) > 0) {
    facts.push(`<div data-plan-spend-fact="set-aside"><b>${money2(payday.allocated)}</b><small>Set aside this payday</small></div>`);
  } else if (unresolved) {
    facts.push('<div data-plan-spend-fact="set-aside"><b>Not assigned</b><small>Exact date not set</small></div>');
  } else if (payday) {
    facts.push('<div data-plan-spend-fact="set-aside"><b>None</b><small>No set-aside this payday</small></div>');
  }
  return facts.join('');
}

function planSpendStatusChips(row, state, unresolved) {
  const chips = [];
  if (row.verdict) chips.push(`<span class="chip ${state.chip}">${row.verdict}</span>`);
  const confidence = row.confidence || '';
  if (confidence) {
    const confidenceClass = confidence === 'confirmed' ? 'v' : confidence === 'estimated' ? 'w' : 'e';
    chips.push(`<span class="chip ${confidenceClass}">${confidence.toUpperCase()}</span>`);
  }
  if (unresolved || (row.when === 'timing TBD' && !row.date && !row.tripWindow)) {
    chips.push('<span class="chip w">DATE TBD</span>');
  }
  return chips.join('');
}

function planSpendDetails(inner) {
  if (!inner) return '';
  return `<details class="plan-spend-more"><summary>Details</summary>${inner}</details>`;
}

function planSpendRowHtml(row, payday, unresolved) {
  const state = PLAN_SPEND_VERDICT[row.verdict] || { cls: '', chip: 'e', remaining: 'Forecast remaining' };
  const requirement = planSpendRequirement(row);
  const timing = planSpendTiming(row);
  const flexibility = PLAN_SPEND_FLEXIBILITY[row.flexibility] || String(row.flexibility || 'UNRESOLVED').toUpperCase();
  const cashDate = row.tripWindow && row.date
    ? `<div data-plan-spend-cash-date><b>${fmtDateFull(row.date)}</b><small>Forecast cash date</small></div>`
    : '';
  const details = planSpendDetails(
    `<div data-plan-spend-fact="remaining"><b>${money2(row.remaining)}</b><small>${planSpendRemainingLabel(row, state)}</small></div>`
    + cashDate
    + planSpendPaydayFacts(row, payday, unresolved)
    + `<p class="plan-spend-detail-line"><span class="chip e">${flexibility}</span>`
    + `${row.deferred ? '<span class="chip w">MAY MOVE</span>' : ''}`
    + `${unresolved ? '<span class="chip w">EXACT DATE UNRESOLVED</span>' : ''}</p>`
  );
  return `<article class="planning-row plan-spend-card ${state.cls}" data-plan-spend-id="${row.id}" data-plan-spend-card="row" data-plan-spend-verdict="${row.verdict || ''}" data-plan-spend-amount="${requirement.kind}" data-plan-spend-timing="${timing.kind}">
      <div class="plan-spend-glance">
        <h2>${row.label}</h2>
        <div data-plan-spend-fact="requirement"><b>${requirement.amount}</b><small>${requirement.label}</small></div>
        <span data-plan-spend-when>${timing.text}</span>
        <div class="plan-spend-status">${planSpendStatusChips(row, state, unresolved)}</div>
      </div>
      ${details}
    </article>`;
}

function planSpendMemberTiming(member) {
  if (member.date) return fmtDateFull(member.date);
  if (member.when) return member.when;
  return 'Timing unresolved';
}

function planSpendSummaryTiming(card) {
  const parts = (card.members || []).map(planSpendMemberTiming).filter(Boolean);
  if (!parts.length) return { text: 'Timing unresolved', kind: 'unresolved' };
  return { text: parts.join(' · '), kind: 'schedule' };
}

function planSpendSummaryAmount(card) {
  if (card.scheduleRemaining != null && isFinite(Number(card.scheduleRemaining))) {
    return { amount: money2(card.scheduleRemaining), label: 'remaining', kind: 'schedule' };
  }
  return { amount: 'Unresolved', label: 'remaining', kind: 'unresolved' };
}

function planSpendSummaryHtml(card, paydayCosts, paydayOptional, unresolvedRows) {
  const state = PLAN_SPEND_VERDICT[card.verdict] || { cls: '', chip: 'e', remaining: 'Forecast remaining' };
  const amount = planSpendSummaryAmount(card);
  const timing = planSpendSummaryTiming(card);
  const memberIds = (card.members || []).map(member => member.id).join(' ');
  const lines = (card.members || []).map(member => {
    const payday = paydayCosts.find(item => item.id === member.id)
      || paydayOptional.find(item => item.id === member.id) || null;
    const unresolved = unresolvedRows.find(item => item.id === member.id) || null;
    const memberState = PLAN_SPEND_VERDICT[member.verdict] || { chip: 'e' };
    const memberAmount = member.need != null ? money2(member.need) : 'Unresolved';
    return `<li data-plan-spend-member="${member.id}">
        <span>${member.label}</span>
        <b>${memberAmount}</b>
        <span>${planSpendMemberTiming(member)}</span>
        ${member.verdict ? `<span class="chip ${memberState.chip}">${member.verdict}</span>` : ''}
        ${planSpendPaydayFacts(member, payday, unresolved)}
      </li>`;
  }).join('');
  const unresolved = (card.members || []).some(member => unresolvedRows.some(item => item.id === member.id));
  return `<article class="planning-row plan-spend-card ${state.cls}" data-plan-spend-id="${card.id}" data-plan-spend-card="summary" data-plan-spend-members="${memberIds}" data-plan-spend-verdict="${card.verdict || ''}" data-plan-spend-amount="${amount.kind}" data-plan-spend-timing="${timing.kind}">
      <div class="plan-spend-glance">
        <h2>${card.label}</h2>
        <div data-plan-spend-fact="schedule-remaining"><b>${amount.amount}</b><small>${amount.label}</small></div>
        <span data-plan-spend-when>${timing.text}</span>
        <div class="plan-spend-status">${planSpendStatusChips(card, state, unresolved)}</div>
      </div>
      ${planSpendDetails(`<ul class="plan-spend-schedule">${lines}</ul>`)}
    </article>`;
}

function planSpendCardsOrNull(plans) {
  if (typeof Forecast === 'undefined' || typeof Forecast.planSpendCards !== 'function') return null;
  return Forecast.planSpendCards(plans);
}

function planSpendPageHtml(advice, liveOverlay) {
  advice = advice || {};
  const unavailable = advice.operatingPlanUnavailable === true
    || (liveOverlay && liveOverlay.operatingPlan === 'unavailable');
  if (unavailable) {
    const note = advice.operatingPlanNote || (liveOverlay && liveOverlay.operatingPlanNote)
      || 'Current plan unavailable. The dated opening is stale.';
    return {
      lede: '',
      list: `<div class="note-box crit" data-operating-plan="unavailable">${note} Forecast verdicts for planned spending are withheld until a trusted current opening exists.</div>`,
      note: '',
    };
  }
  const plans = Array.isArray(advice.majorPlans) ? advice.majorPlans : [];
  const alloc = advice.paydayAllocation || {};
  const paydayCosts = Array.isArray(alloc.futureCosts) ? alloc.futureCosts : [];
  const paydayOptional = Array.isArray(alloc.optional) ? alloc.optional : [];
  const unresolvedRows = Array.isArray(alloc.unresolved) ? alloc.unresolved : [];
  if (!plans.length) {
    return {
      lede: '',
      list: '<p class="lede" data-plan-spend="empty">No unsettled planned spending is published on this opening.</p>',
      note: '',
    };
  }
  const cards = planSpendCardsOrNull(plans);
  if (!cards) {
    return {
      lede: '',
      list: '<div class="note-box crit" data-plan-spend="cards-unavailable">Plan spend cards are unavailable.</div>',
      note: '',
    };
  }
  const list = cards.map(card => {
    if (card.kind === 'summary') {
      return planSpendSummaryHtml(card, paydayCosts, paydayOptional, unresolvedRows);
    }
    const payday = paydayCosts.find(item => item.id === card.id)
      || paydayOptional.find(item => item.id === card.id) || null;
    const unresolved = unresolvedRows.find(item => item.id === card.id) || null;
    return planSpendRowHtml(card, payday, unresolved);
  }).join('');
  const knowledge = advice.knowledge || {};
  const horizon = knowledge.end
    ? `${plans.length} cost${plans.length === 1 ? '' : 's'} on the Forecast master plan through ${fmtDateFull(knowledge.end)}, in Forecast's funding order.`
    : `${plans.length} cost${plans.length === 1 ? '' : 's'} on the Forecast master plan, in Forecast's funding order.`;
  const floor = knowledge.encumbered != null && isFinite(Number(knowledge.encumbered))
    ? ` Forecast protects a floor of ${money2(knowledge.encumbered)} across the required and flexible costs — ranges count at their low end, optional costs and dated costs already in the cash walk are not in that figure. It is a protected floor, not a total.`
    : '';
  return {
    lede: horizon + floor,
    note: 'Verdicts, remaining amounts and any set-aside are Forecast.majorPlans and Forecast.paydayAllocation. A grouped card reprints Forecast.planSpendCards. A range is printed as a range. Approximate timing is printed as the household stated it. Atlas does not track a dedicated saved balance for these costs, so none is shown. Nothing here ranks costs or moves money. Road Ahead on Forecast is the funding story.',
    list,
  };
}

function planSpendAdvice(d, periods) {
  const overlay = d.liveOverlay;
  const actuals = overlay && overlay.applied === true ? overlay.currentPeriodActuals : null;
  return Forecast.recommend(d.plan, d.meta.asOf, {
    fundingSources: d.plan.funding && d.plan.funding.options,
    debts: d.debts,
    extraFacilities: d.revolvingExtra,
    periods: periods || null,
    currentPeriodActuals: actuals,
    operatingPlan: overlay && overlay.operatingPlan,
    operatingPlanNote: overlay && overlay.operatingPlanNote,
  });
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
