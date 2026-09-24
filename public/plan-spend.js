'use strict';
/* Plan Spend leads with Forecast's serial payday funding schedule and then
 * renders Forecast.majorPlans in Forecast.planSpendCards order. This page
 * does not allocate savings or calculate household figures. */

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
  // Forecast `date` is a cash-planning date, not a payment due date
  // unless a separate authoritative due-date fact exists. Month-only
  // cash dates (15th of a clear month) stay distinct from trip windows.
  if (row.tripWindow && row.date) {
    return { text: `${row.tripWindow} trip · Cash date ${fmtDateFull(row.date)}`, kind: 'trip-window' };
  }
  if (row.date) return { text: `Cash date ${fmtDateFull(row.date)}`, kind: 'dated' };
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

// All figures below are direct Forecast.planSpendPaydayFunding fields. This
// surface formats them; it never totals contributions or walks cash.
function planSpendActionLines(rows) {
  return rows.length ? `<ul class="plan-spend-action-lines">${rows.map(row =>
    `<li><span>${row.label}</span><b>${money2(row.amount)}</b></li>`).join('')}</ul>`
    : '<p>No new protection needed from this payday.</p>';
}

function planSpendFundingHero(schedule) {
  if (!schedule || schedule.status === 'unavailable' || !Array.isArray(schedule.paydays)) {
    return `<div class="note-box crit" data-plan-spend-funding="unavailable">${schedule && schedule.reason || 'Payday funding plan unavailable.'}</div>`;
  }
  const next = schedule.paydays[0];
  if (!next) return '<div class="note-box crit">No future Seaspan payday is available for this funding plan.</div>';
  const gap = schedule.gap;
  const gapHtml = gap ? `<div class="note-box crit" data-plan-spend-funding="gap">
    <b>Funding shortfall</b><p>${fmtDateFull(gap.payday || gap.cashDate)}:
    required ${money2(gap.required)}, available ${money2(gap.available)}, short by ${money2(gap.shortBy)}.</p>
    <p>Affected: ${gap.affected.map(id => {
      const cost = (schedule.costs || []).find(row => row.id === id);
      return cost ? cost.label : id;
    }).join(' · ')}</p></div>` : '';
  return `<section class="plan-spend-funding" aria-label="Payday funding action">
    <div class="plan-spend-action" data-plan-spend-next-payday="${next.payday}">
      <span class="kicker">Next Seaspan payday</span><h2>${fmtDateFull(next.payday)}</h2>
      <strong class="plan-spend-action-amount">Set aside: ${money2(next.contribution)}</strong>
      ${planSpendActionLines(next.allocations)}
      <dl class="plan-spend-action-totals"><div><dt>Projected protected after this payday</dt><dd>${money2(next.protectedAfterPayday)}</dd></div>
        <div><dt>Still to fund</dt><dd>${money2(next.stillToFund)}</dd></div></dl>
    </div>${gapHtml}
    <details class="plan-spend-payday-plan"><summary>Show payday funding plan</summary>
      <p>These amounts earmark cash for named costs. The payment itself stays on its cash date.</p>
      <div class="plan-spend-payday-grid">${schedule.paydays.map(row =>
        `<article class="plan-spend-payday" data-plan-spend-payday="${row.payday}"><h3>${fmtDateFull(row.payday)}</h3>
          <strong>Protect ${money2(row.contribution)}</strong>${planSpendActionLines(row.allocations)}
          <p>Protected after payday: ${money2(row.protectedAfterPayday)}</p>
          ${row.payments.length ? `<p>Paid before next payday: ${row.payments.map(payment =>
            `${payment.label} ${money2(payment.protectedConsumed)}`).join(' · ')}</p>` : ''}</article>`).join('')}</div>
    </details></section>`;
}

function planSpendScheduledFacts(cost) {
  if (!cost) return '<p>Funding schedule unavailable for this cost.</p>';
  return `<dl class="plan-spend-facts">
    ${planSpendFact('protected', 'Already saved for this cost', cost.protectedNow != null ? money2(cost.protectedNow) : 'Not established')}
    ${planSpendFact('remaining', 'Still to fund in this plan', money2(cost.stillToFund))}
    ${planSpendFact('next', 'Next contribution', cost.nextContribution
      ? `${money2(cost.nextContribution.amount)} on ${fmtDateFull(cost.nextContribution.payday)}` : 'No contribution scheduled')}
    ${planSpendFact('fully-funded', 'Projected fully funded', cost.projectedFullyFunded
      ? fmtDateFull(cost.projectedFullyFunded) : 'Not established')}
  </dl>${cost.uncertaintyAdditional > 0
    ? `<p>Base floor scheduled; ${money2(cost.uncertaintyAdditional)} above it remains uncertain.</p>` : ''}`;
}

function planSpendScheduledCard(card, cost, schedule, byId) {
  if (card.kind === 'summary') {
    const ids = (card.members || []).map(member => member.id);
    const affected = schedule && schedule.gap && ids.some(id => schedule.gap.affected.includes(id));
    const status = affected ? '<span class="chip c">PAYDAY FUNDING GAP</span>' : planSpendStatus(card);
    const lines = (card.members || []).map(member => {
      const row = byId.get(member.id);
      return `<li data-plan-spend-member="${member.id}"><span>${member.label}</span><b>${member.need != null ? money2(member.need) : 'Not established'}</b>
        <time>${member.date ? `Cash date ${fmtDateFull(member.date)}` : member.when || 'Cash date not established'}</time>
        ${row && row.nextContribution ? `<small>Next protect ${money2(row.nextContribution.amount)} on ${fmtDateFull(row.nextContribution.payday)}</small>` : ''}</li>`;
    }).join('');
    return `<article class="planning-row plan-spend-card ${(PLAN_SPEND_VERDICT[card.verdict] || {}).cls || ''}" data-plan-spend-id="${card.id}" data-plan-spend-card="summary" data-plan-spend-verdict="${card.verdict || ''}" data-plan-spend-members="${ids.join(' ')}">
      <div class="plan-spend-glance"><h2>${card.label}</h2><div data-plan-spend-fact="schedule-remaining"><b>${card.scheduleRemaining != null ? money2(card.scheduleRemaining) : 'Not established'}</b><small>remaining schedule</small></div>
      <div class="plan-spend-status">${status}</div>${planSpendScheduledFacts(cost)}</div>
      <details class="plan-spend-more"><summary>Show payment schedule</summary><ul class="plan-spend-schedule">${lines}</ul></details></article>`;
  }
  const requirement = planSpendRequirement(card);
  const affected = schedule && schedule.gap && schedule.gap.affected.includes(card.id);
  const status = affected ? '<span class="chip c">PAYDAY FUNDING GAP</span>' : planSpendStatus(card);
  const facts = !card.date ? '<p>Funding schedule unavailable — cash date not established.</p>'
    : card.flexibility === 'optional' ? '<p>Optional cost; outside the current protected funding plan.</p>'
      : planSpendScheduledFacts(cost);
  const details = cost && cost.contributions.length
    ? `<details class="plan-spend-more"><summary>Show funding schedule</summary><ul class="plan-spend-schedule">${cost.contributions.map(row =>
      `<li><time>${fmtDateFull(row.payday)}</time><b>${money2(row.amount)}</b></li>`).join('')}</ul></details>` : '';
  return `<article class="planning-row plan-spend-card" data-plan-spend-id="${card.id}" data-plan-spend-card="row" data-plan-spend-verdict="${card.verdict || ''}" data-plan-spend-amount="${requirement.kind}">
    <div class="plan-spend-glance"><h2>${card.label}</h2><div data-plan-spend-fact="requirement"><b>${requirement.amount}</b><small>${requirement.label}</small></div>
      <span data-plan-spend-when>${planSpendTiming(card).text}</span><div class="plan-spend-status">${status}</div>${facts}</div>${details}</article>`;
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
  const schedule = advice.planSpendPaydayFunding;
  const costById = new Map((schedule && schedule.costs || []).map(cost => [cost.id, cost]));
  const groupById = new Map((schedule && schedule.groups || []).map(group => [group.id, group]));
  const list = cards.map(card => planSpendScheduledCard(card,
    card.kind === 'summary' ? groupById.get(card.id) : costById.get(card.id),
    schedule, costById)).join('');
  return {
    lede: planSpendFundingHero(schedule),
    note: 'Forecast projects these amounts from the served opening. Protecting cash earmarks it; paying a planned cost is the one cash outflow.',
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
  if (lede) lede.innerHTML = html.lede;
  if (list) list.innerHTML = html.list;
  if (note) note.textContent = html.note;
}

App.register(renderPlanSpend);
App.boot({ periods: true });
