'use strict';
/* Planning — "What are we preparing and saving for?"
 *
 * Every row is a Forecast.majorPlans result on the master plan, reached
 * through the same Forecast.recommend call the Plan page and the assistant
 * packet use. The verdict (ON TRACK / AT RISK / FUNDING GAP), the remaining
 * requirement, the funding order, the flexibility, the range or point
 * amount, and the timing text are all Forecast's. Any current-payday
 * set-aside or by-deadline projection comes from the Forecast.paydayAllocation
 * row for the same id, when Forecast assigned one.
 *
 * This file formats those outputs. It does not read plan.commitments, does
 * not grade or rank a cost, does not collapse a range to a midpoint, does not
 * turn "Sep 2026" or "timing TBD" into a day, does not total point estimates,
 * and does not invent a saved balance when Atlas does not know one. */

const PLANNING_VERDICT = {
  'ON TRACK': { cls: 'on-track', chip: 'v', remaining: 'Covered in the plan', remainingOpen: 'Still unfunded in the plan' },
  'AT RISK': { cls: 'at-risk', chip: 'w', remaining: 'At-risk amount' },
  'FUNDING GAP': { cls: 'funding-gap', chip: 'c', remaining: 'Funding gap' },
};
const PLANNING_FLEXIBILITY = { required: 'REQUIRED', 'bounded-flex': 'FLEXIBLE', optional: 'OPTIONAL' };

// Point stays a point; a range stays a range. No midpoint, no floor stand-in.
function planningRequirement(row) {
  if (row.need != null) return { amount: money2(row.need), label: 'Cost', kind: 'point' };
  if (row.amountMin != null && row.amountMax != null) {
    return { amount: `${money2(row.amountMin)}–${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  }
  if (row.amountMin != null) return { amount: `From ${money2(row.amountMin)}`, label: 'Cost range', kind: 'range' };
  if (row.amountMax != null) return { amount: `Up to ${money2(row.amountMax)}`, label: 'Cost range', kind: 'range' };
  return { amount: 'Unresolved', label: 'Cost amount', kind: 'unresolved' };
}

// Owner wording for approximate timing is printed as given. Only an exact
// Forecast date becomes a calendar date.
function planningTiming(row) {
  if (row.when) return { text: row.when, kind: 'approximate' };
  if (row.date) return { text: fmtDateFull(row.date), kind: 'dated' };
  return { text: 'Timing unresolved', kind: 'unresolved' };
}

function planningRemainingLabel(row, state) {
  if (row.verdict === 'ON TRACK' && Number(row.remaining) > 0) return state.remainingOpen || state.remaining;
  return state.remaining;
}

// Current-payday facts exist only where Forecast.paydayAllocation produced a
// row for this id. Absent row → nothing is printed, not $0.
function planningPaydayFacts(row, payday, unresolved) {
  const facts = [];
  if (payday && payday.projectedByDeadline != null) {
    facts.push(`<div data-planning-fact="projected"><b>${money2(payday.projectedByDeadline)}</b><small>Projected available by deadline</small></div>`);
  }
  if (payday && Number(payday.allocated) > 0) {
    facts.push(`<div data-planning-fact="set-aside"><b>${money2(payday.allocated)}</b><small>Set aside this payday</small></div>`);
  } else if (unresolved) {
    facts.push('<div data-planning-fact="set-aside"><b>Not assigned</b><small>Exact date not set</small></div>');
  } else if (payday) {
    facts.push('<div data-planning-fact="set-aside"><b>None</b><small>No set-aside this payday</small></div>');
  }
  return facts.join('');
}

function planningRowHtml(row, payday, unresolved) {
  const state = PLANNING_VERDICT[row.verdict] || { cls: '', chip: 'e', remaining: 'Forecast remaining' };
  const requirement = planningRequirement(row);
  const timing = planningTiming(row);
  const confidence = row.confidence || 'unknown';
  const confidenceClass = confidence === 'confirmed' ? 'v' : confidence === 'estimated' ? 'w' : 'e';
  const flexibility = PLANNING_FLEXIBILITY[row.flexibility] || String(row.flexibility || 'UNRESOLVED').toUpperCase();
  return `<article class="planning-row ${state.cls}" data-planning-id="${row.id}" data-planning-verdict="${row.verdict || ''}" data-planning-amount="${requirement.kind}" data-planning-timing="${timing.kind}">
      <div class="planning-head">
        <h2>${row.label}</h2>
        <span class="chip ${state.chip}">${row.verdict || 'VERDICT UNAVAILABLE'}</span>
      </div>
      <div class="planning-facts">
        <div data-planning-fact="requirement"><b>${requirement.amount}</b><small>${requirement.label}</small></div>
        <div data-planning-fact="remaining"><b>${money2(row.remaining)}</b><small>${planningRemainingLabel(row, state)}</small></div>
        ${planningPaydayFacts(row, payday, unresolved)}
      </div>
      <div class="planning-meta">
        <span data-planning-when>${timing.text}</span>
        <span class="chip ${confidenceClass}">${confidence.toUpperCase()}</span>
        <span class="chip e">${flexibility}</span>
        ${row.deferred ? '<span class="chip w">MAY MOVE</span>' : ''}
        ${unresolved ? '<span class="chip w">EXACT DATE UNRESOLVED</span>' : ''}
      </div>
    </article>`;
}

function planningTrajectoryChip(status) {
  const map = {
    calculated: { cls: 'v', label: 'CALCULATED' },
    estimated: { cls: 'w', label: 'ESTIMATED' },
    unavailable: { cls: 'c', label: 'UNAVAILABLE' },
  };
  const row = map[status] || { cls: 'e', label: String(status || 'UNKNOWN').toUpperCase() };
  return `<span class="chip ${row.cls}">${row.label}</span>`;
}

function planningTrajectoryIncomeHtml(income) {
  if (!income || income.status === 'unavailable') {
    const reason = income && income.reason
      ? income.reason
      : 'Forecast unavailable.';
    return `<span class="chip c">Forecast unavailable</span><small class="planning-trajectory-reason">${reason}</small>`;
  }
  const amount = income.amount != null && isFinite(Number(income.amount))
    ? `<b>${money2(income.amount)}</b>` : '';
  return `${amount}${planningTrajectoryChip(income.status)}`;
}

function planningTrajectoryCashHtml(cash) {
  if (!cash || cash.status === 'unavailable') {
    const reason = cash && cash.reason
      ? cash.reason
      : 'Forecast unavailable.';
    return `<span class="chip c">Forecast unavailable</span><small class="planning-trajectory-reason">${reason}</small>`;
  }
  const amount = cash.amount != null && isFinite(Number(cash.amount))
    ? `<b>${money2(cash.amount)}</b>` : '';
  const asOf = cash.asOf ? `<small>as-of ${fmtDateFull(cash.asOf)}</small>` : '';
  return `${amount}${planningTrajectoryChip(cash.status)}${asOf}`;
}

function planningTrajectoryDebtHtml(debt) {
  if (!debt || debt.status === 'unavailable') {
    const reason = debt && debt.reason
      ? debt.reason
      : 'Forecast unavailable.';
    return `<span class="chip c">Forecast unavailable</span><small class="planning-trajectory-reason">${reason}</small>`;
  }
  if (debt.status !== 'calculated') {
    return planningTrajectoryChip(debt.status);
  }
  const asOf = debt.asOf ? `<small>as-of ${fmtDateFull(debt.asOf)}</small>` : '';
  return `<div data-trajectory-debt="consumer"><b>${money2(debt.consumer)}</b><small>Consumer</small></div>
    <div data-trajectory-debt="secured"><b>${money2(debt.secured)}</b><small>Secured</small></div>
    <div data-trajectory-debt="heloc"><b>${money2(debt.heloc)}</b><small>HELOC</small></div>
    ${planningTrajectoryChip(debt.status)}${asOf}`;
}

function planningTrajectoryHtml(traj) {
  const note = 'Monthly cash and debt are Forecast.baselineTrajectory only — planned weekly variable, not historical actuals and not the payday weekly cap. This page copies status, amounts, and notes; it does not walk cash or debt itself.';
  if (!traj || traj.status !== 'ready' || !Array.isArray(traj.months) || !traj.months.length) {
    const reason = (traj && traj.reason) || 'Baseline trajectory unavailable.';
    return {
      lede: '',
      table: `<div class="note-box crit" data-trajectory="unavailable">${reason}</div>`,
      note,
    };
  }
  const horizon = traj.horizon && traj.horizon.end
    ? `Forecast baseline cash and debt by calendar month through ${fmtDateFull(traj.horizon.end)}.`
    : 'Forecast baseline cash and debt by calendar month over the knowledge horizon.';
  const weekly = traj.weeklyVariable && traj.weeklyVariable.amount != null
    ? ` Planned weekly variable: ${money2(traj.weeklyVariable.amount)} (${traj.weeklyVariable.source || 'budgetBreakdown.planned'}).`
    : '';
  const regimeNotes = Array.isArray(traj.incomeRegimes)
    ? traj.incomeRegimes.filter(r => r && (r.note || r.reason)).map(r => r.note || r.reason).join(' ')
    : '';
  const rows = traj.months.map(month => {
    const income = month.income || {};
    const cash = month.cash || {};
    return `<tr data-trajectory-month="${month.month}" data-trajectory-income-status="${income.status || ''}" data-trajectory-cash-status="${cash.status || ''}">
      <th scope="row">${month.month}</th>
      <td class="planning-trajectory-income">${planningTrajectoryIncomeHtml(income)}</td>
      <td class="planning-trajectory-cash">${planningTrajectoryCashHtml(cash)}</td>
      <td class="planning-trajectory-debt">${planningTrajectoryDebtHtml(month.debt)}</td>
    </tr>`;
  }).join('');
  return {
    lede: horizon + weekly + (regimeNotes ? ` ${regimeNotes}` : ''),
    table: `<div class="scroll"><table class="stackable planning-trajectory-table" aria-label="Baseline cash and debt by month">
      <thead><tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Cash (month-end)</th><th scope="col">Debt</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`,
    note,
  };
}

function planningTrajectory(d, periods) {
  return Forecast.baselineTrajectory(d.plan, d.debts, d.meta.asOf, {
    periods: periods || null,
    extraFacilities: d.revolvingExtra,
  });
}

function planningPageHtml(advice, liveOverlay) {
  advice = advice || {};
  const unavailable = advice.operatingPlanUnavailable === true
    || (liveOverlay && liveOverlay.operatingPlan === 'unavailable');
  if (unavailable) {
    const note = advice.operatingPlanNote || (liveOverlay && liveOverlay.operatingPlanNote)
      || 'Current plan unavailable. The dated opening is stale.';
    return {
      lede: '',
      list: `<div class="note-box crit" data-operating-plan="unavailable">${note} Forecast verdicts for future costs are withheld until a trusted current opening exists.</div>`,
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
      list: '<p class="lede">No unsettled future costs are on this opening.</p>',
      note: '',
    };
  }
  const list = plans.map(row => {
    const payday = paydayCosts.find(item => item.id === row.id)
      || paydayOptional.find(item => item.id === row.id) || null;
    const unresolved = unresolvedRows.find(item => item.id === row.id) || null;
    return planningRowHtml(row, payday, unresolved);
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
    note: 'Verdicts, remaining amounts and any set-aside are Forecast.majorPlans and Forecast.paydayAllocation. A range is printed as a range. Approximate timing is printed as the household stated it. Atlas does not track a dedicated saved balance for these costs, so none is shown. Nothing here ranks costs or moves money.',
    list,
  };
}

function planningAdvice(d, periods) {
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

function renderPlanning(d, periods) {
  const html = planningPageHtml(planningAdvice(d, periods), d.liveOverlay);
  const trajHtml = planningTrajectoryHtml(planningTrajectory(d, periods));
  $('planning-lede').textContent = html.lede;
  $('planning-list').innerHTML = html.list;
  $('planning-note').textContent = html.note;
  $('planning-trajectory-lede').textContent = trajHtml.lede;
  $('planning-trajectory').innerHTML = trajHtml.table;
  $('planning-trajectory-note').textContent = trajHtml.note;
}

App.register(renderPlanning);
App.boot({ periods: true });
