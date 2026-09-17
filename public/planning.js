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

function planningTrajectoryIsPartialMonth(month) {
  if (!month || !month.month || !month.start || !month.end) return false;
  const [y, m] = month.month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`;
  const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return month.start !== monthStart || month.end !== monthEnd;
}

function planningTrajectoryPeriodCell(month) {
  const partial = planningTrajectoryIsPartialMonth(month);
  const periodText = `${fmtDateFull(month.start)} – ${fmtDateFull(month.end)}`;
  const partialAttr = partial ? ' data-trajectory-partial="true"' : '';
  const partialNote = partial
    ? `<small class="planning-trajectory-partial">Partial period · ${periodText}</small>`
    : `<small class="planning-trajectory-period-dates">${periodText}</small>`;
  return `<button type="button" class="planning-trajectory-month-select" data-trajectory-month-select="${month.month}"><span class="planning-trajectory-period">${month.month}</span></button>${partialNote}`;
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
  const asOf = cash.asOf
    ? `<small data-trajectory-cash-asof="${cash.asOf}">at period end · ${fmtDateFull(cash.asOf)}</small>`
    : '';
  return `${amount}${planningTrajectoryChip(cash.status)}${asOf}`;
}

const PLANNING_PRESSURE_KIND = {
  'lowest-projected-cash': 'Lowest projected cash on this walk',
  'cash-trough': 'Lowest cash within the month',
  'cash-sign-change': 'Cash turns negative after being positive',
  'month-cash-decline': 'Month-end cash falls versus the prior month',
  'outflow-exceeds-inflow': 'Outflows exceed inflows in the month',
  'dated-commitment': 'Dated commitment on the walk',
  'debt-increase': 'Total modelled debt increases',
  'debt-not-declining-after-payment': 'Debt does not fall after a payment',
  'debt-limit-crossing': 'Credit limit crossing on the walk',
};

const PLANNING_ATTRIBUTION_DRIVER = {
  'income-timing': 'Income timing',
  'bonus-timing': 'Bonus timing',
  'household-budget': 'Household budget spending',
  'recurring-bills': 'Recurring bills',
  'debt-payment': 'Debt payment',
  'debt-interest': 'Debt interest',
  'dated-commitment': 'Dated commitment',
  'mortgage-or-major-obligation': 'Mortgage or major obligation',
};

const PLANNING_ATTRIBUTION_FACT = {
  'income-timing': 'Income timing',
  'payroll-deduction-regime': 'Payroll deduction change',
};

const PLANNING_PAY_CADENCE = {
  'two-pay-month': 'Two-pay month',
  'three-pay-month': 'Three-pay month',
};

function planningTrajectoryPressureAmountField(label, amount) {
  if (amount == null || !isFinite(Number(amount))) return '';
  return `<small class="planning-trajectory-pressure-field"><span>${label}</span> <b>${money2(amount)}</b></small>`;
}

function planningTrajectoryPressureTextField(label, value) {
  if (value == null || value === '') return '';
  return `<small class="planning-trajectory-pressure-field"><span>${label}</span> ${value}</small>`;
}

function planningAttributionDriverLabel(className) {
  return PLANNING_ATTRIBUTION_DRIVER[className] || className || '';
}

function planningAttributionFactLabel(className) {
  return PLANNING_ATTRIBUTION_FACT[className] || className || '';
}

function planningTrajectoryAttributionDriverHtml(driver, index) {
  if (!driver || !driver.class) return '';
  const label = planningAttributionDriverLabel(driver.class);
  const parts = [`<span class="planning-trajectory-attribution-driver-kind">${label}</span>`];
  if (driver.amount != null && isFinite(Number(driver.amount))) {
    parts.push(`<b>${money2(driver.amount)}</b>`);
  }
  const meta = [];
  if (driver.count != null && isFinite(Number(driver.count))) {
    meta.push(planningTrajectoryPressureTextField('Count', String(driver.count)));
  }
  if (driver.id) meta.push(planningTrajectoryPressureTextField('Id', driver.id));
  if (driver.label) meta.push(planningTrajectoryPressureTextField('Label', driver.label));
  if (driver.date) meta.push(planningTrajectoryPressureTextField('Date', fmtDateFull(driver.date)));
  return `<li class="planning-trajectory-attribution-driver" data-trajectory-attribution-driver-index="${index}" data-trajectory-attribution-driver-class="${driver.class}">${parts.join(' ')}${meta.join('')}</li>`;
}

function planningTrajectoryAttributionFactHtml(fact, index) {
  if (!fact || !fact.class) return '';
  const label = planningAttributionFactLabel(fact.class);
  const parts = [`<span class="planning-trajectory-attribution-fact-kind">${label}</span>`];
  const meta = [];
  if (fact.class === 'income-timing') {
    if (fact.cadence && PLANNING_PAY_CADENCE[fact.cadence]) {
      meta.push(planningTrajectoryPressureTextField('Cadence', PLANNING_PAY_CADENCE[fact.cadence]));
    } else if (fact.cadence) {
      meta.push(planningTrajectoryPressureTextField('Cadence', fact.cadence));
    }
    if (fact.count != null && isFinite(Number(fact.count))) {
      meta.push(planningTrajectoryPressureTextField('Pay count', String(fact.count)));
    }
    if (fact.id) meta.push(planningTrajectoryPressureTextField('Id', fact.id));
    if (fact.label) meta.push(planningTrajectoryPressureTextField('Label', fact.label));
  }
  if (fact.class === 'payroll-deduction-regime') {
    if (fact.date) meta.push(planningTrajectoryPressureTextField('Date', fmtDateFull(fact.date)));
    if (fact.priorDate) meta.push(planningTrajectoryPressureTextField('Prior date', fmtDateFull(fact.priorDate)));
    meta.push(planningTrajectoryPressureAmountField('Gross', fact.gross));
    meta.push(planningTrajectoryPressureAmountField('Net', fact.net));
    meta.push(planningTrajectoryPressureAmountField('Prior net', fact.priorNet));
    meta.push(planningTrajectoryPressureAmountField('Deduction change', fact.deductionDelta));
  }
  return `<li class="planning-trajectory-attribution-fact" data-trajectory-attribution-fact-index="${index}" data-trajectory-attribution-fact-class="${fact.class}">${parts.join(' ')}${meta.join('')}</li>`;
}

function planningTrajectoryAttributionHtml(attribution) {
  if (!attribution || typeof attribution !== 'object') {
    return `<div class="planning-trajectory-pressure-attribution" data-trajectory-pressure-attribution="unavailable"><small class="planning-trajectory-reason">Forecast did not publish attribution for this signal.</small></div>`;
  }
  if (attribution.status === 'ready') {
    const change = attribution.change != null && isFinite(Number(attribution.change))
      ? `<small class="planning-trajectory-attribution-change"><span>Attributed change</span> <b>${money2(attribution.change)}</b></small>`
      : '';
    const drivers = Array.isArray(attribution.drivers) ? attribution.drivers : [];
    const driverList = drivers.length
      ? `<ul class="planning-trajectory-attribution-drivers">${drivers.map((d, i) => planningTrajectoryAttributionDriverHtml(d, i)).join('')}</ul>`
      : '';
    const facts = Array.isArray(attribution.facts) ? attribution.facts : [];
    const factList = facts.length
      ? `<ul class="planning-trajectory-attribution-facts">${facts.map((f, i) => planningTrajectoryAttributionFactHtml(f, i)).join('')}</ul>`
      : '';
    return `<div class="planning-trajectory-pressure-attribution" data-trajectory-pressure-attribution="ready">${change}${driverList}${factList}</div>`;
  }
  const reason = attribution.reason || 'Walk-derived drivers could not be established.';
  return `<div class="planning-trajectory-pressure-attribution" data-trajectory-pressure-attribution="unavailable"><small class="planning-trajectory-reason">${reason}</small></div>`;
}

function planningTrajectoryPressureSignalHtml(signal, index) {
  if (!signal || !signal.kind) return '';
  const kindLabel = PLANNING_PRESSURE_KIND[signal.kind] || signal.kind;
  const attrs = [
    `data-trajectory-pressure-index="${index}"`,
    `data-trajectory-pressure-kind="${signal.kind}"`,
  ];
  if (signal.month) attrs.push(`data-trajectory-pressure-month="${signal.month}"`);
  if (signal.date) attrs.push(`data-trajectory-pressure-date="${signal.date}"`);
  if (signal.trust) attrs.push(`data-trajectory-pressure-trust="${signal.trust}"`);
  if (signal.id) attrs.push(`data-trajectory-pressure-id="${signal.id}"`);
  if (signal.asOf) attrs.push(`data-trajectory-pressure-asof="${signal.asOf}"`);
  if (signal.debtId) attrs.push(`data-trajectory-pressure-debt-id="${signal.debtId}"`);
  const fields = [];
  if (signal.date) fields.push(planningTrajectoryPressureTextField('Date', fmtDateFull(signal.date)));
  if (signal.month) fields.push(planningTrajectoryPressureTextField('Month', signal.month));
  fields.push(planningTrajectoryPressureAmountField('Amount', signal.amount));
  fields.push(planningTrajectoryPressureAmountField('From amount', signal.fromAmount));
  fields.push(planningTrajectoryPressureAmountField('To amount', signal.toAmount));
  fields.push(planningTrajectoryPressureAmountField('Change', signal.delta));
  fields.push(planningTrajectoryPressureAmountField('Inflow', signal.inflow));
  fields.push(planningTrajectoryPressureAmountField('Outflow', signal.outflow));
  fields.push(planningTrajectoryPressureAmountField('Net', signal.net));
  fields.push(planningTrajectoryPressureAmountField('Cash after', signal.cashAfter));
  fields.push(planningTrajectoryPressureAmountField('From total', signal.fromTotal));
  fields.push(planningTrajectoryPressureAmountField('To total', signal.toTotal));
  fields.push(planningTrajectoryPressureAmountField('Paid', signal.paidDelta));
  fields.push(planningTrajectoryPressureAmountField('Consumer change', signal.consumerDelta));
  fields.push(planningTrajectoryPressureAmountField('Secured change', signal.securedDelta));
  fields.push(planningTrajectoryPressureAmountField('HELOC change', signal.helocDelta));
  fields.push(planningTrajectoryPressureAmountField('Limit', signal.limit));
  if (signal.fromMonth) fields.push(planningTrajectoryPressureTextField('From month', signal.fromMonth));
  if (signal.fromAsOf) fields.push(planningTrajectoryPressureTextField('From as-of', fmtDateFull(signal.fromAsOf)));
  if (signal.asOf) fields.push(planningTrajectoryPressureTextField('As-of', fmtDateFull(signal.asOf)));
  if (signal.start && signal.end) {
    fields.push(planningTrajectoryPressureTextField('Period', `${fmtDateFull(signal.start)} – ${fmtDateFull(signal.end)}`));
  }
  if (signal.id) fields.push(planningTrajectoryPressureTextField('Id', signal.id));
  if (signal.debtId) fields.push(planningTrajectoryPressureTextField('Debt id', signal.debtId));
  if (signal.label) fields.push(planningTrajectoryPressureTextField('Label', signal.label));
  if (signal.alreadyOver === true) fields.push('<small class="planning-trajectory-pressure-field"><span>Already over limit</span> yes</small>');
  if (signal.trust === 'calculated' || signal.trust === 'estimated') {
    fields.push(planningTrajectoryChip(signal.trust));
  }
  const attribution = planningTrajectoryAttributionHtml(signal.attribution);
  return `<li class="planning-trajectory-pressure-item"${attrs.length ? ' ' + attrs.join(' ') : ''}><span class="planning-trajectory-pressure-kind">${kindLabel}</span>${fields.join('')}${attribution}</li>`;
}

function planningTrajectoryPressureHtml(traj) {
  const note = 'Pressure signals and their cause attribution are Forecast.baselineTrajectory.pressure only — mechanical facts and walk-derived drivers from the baseline walk. This page copies them in Forecast order; it does not score, rank, or compute pressure or attribution.';
  const pressure = traj && traj.pressure;
  if (!pressure || pressure.status !== 'ready') {
    const reason = (pressure && pressure.reason) || (traj && traj.reason) || 'Baseline trajectory pressure unavailable.';
    return {
      lede: '',
      list: `<div class="note-box crit" data-trajectory-pressure="unavailable">${reason}</div>`,
      note,
    };
  }
  const signals = Array.isArray(pressure.signals) ? pressure.signals : [];
  if (!signals.length) {
    return {
      lede: 'Forecast published no pressure signals on this baseline walk.',
      list: '<p class="lede" data-trajectory-pressure="empty">No pressure signals on this walk.</p>',
      note,
    };
  }
  const items = signals.map((signal, index) => planningTrajectoryPressureSignalHtml(signal, index)).join('');
  return {
    lede: `${signals.length} pressure signal${signals.length === 1 ? '' : 's'} from the baseline walk, in Forecast order.`,
    list: `<ol class="planning-trajectory-pressure-list" data-trajectory-pressure="ready">${items}</ol>`,
    note,
  };
}

const PLANNING_DEBT_DIRECTION_LABEL = {
  declining: 'Declining',
  persistent: 'Persistent',
  increasing: 'Increasing',
};

function planningTrajectoryDebtDirectionInterestHtml(interest) {
  if (!interest || typeof interest !== 'object') {
    return '<small class="planning-trajectory-reason">Interest was not published.</small>';
  }
  if (interest.status === 'calculated' && interest.amount != null && isFinite(Number(interest.amount))) {
    return `${planningTrajectoryPressureAmountField('Interest', interest.amount)}${planningTrajectoryChip('calculated')}`;
  }
  const reason = interest.reason || 'Interest was not established on the coupled walk.';
  return `<span class="chip c">Forecast unavailable</span><small class="planning-trajectory-reason">${reason}</small>`;
}

function planningTrajectoryDebtDirectionBalanceHtml(label, balance) {
  if (!balance || balance.direction == null) return '';
  const dirLabel = PLANNING_DEBT_DIRECTION_LABEL[balance.direction] || balance.direction;
  const fields = [
    planningTrajectoryPressureTextField('Direction', dirLabel),
    planningTrajectoryPressureAmountField('Opening', balance.opening),
    planningTrajectoryPressureAmountField('Ending', balance.ending),
    planningTrajectoryPressureAmountField('Change', balance.delta),
  ].filter(Boolean).join('');
  return `<div class="planning-trajectory-debt-direction-balance" data-trajectory-debt-direction-balance="${label}">${fields}</div>`;
}

function planningTrajectoryDebtDirectionIdListHtml(kind, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) {
    return `<p class="lede planning-trajectory-debt-direction-idlist" data-trajectory-debt-direction-${kind}="none">No ${kind} debts.</p>`;
  }
  const items = list.map(id => `<li data-trajectory-debt-direction-debt-id="${id}">${id}</li>`).join('');
  return `<ul class="planning-trajectory-debt-direction-idlist" data-trajectory-debt-direction-${kind}="ready">${items}</ul>`;
}

function planningTrajectoryDebtDirectionDebtHtml(debt, index) {
  if (!debt || !debt.id) return '';
  const dirLabel = PLANNING_DEBT_DIRECTION_LABEL[debt.direction] || debt.direction || '';
  const attrs = [
    `data-trajectory-debt-direction-index="${index}"`,
    `data-trajectory-debt-direction-debt-id="${debt.id}"`,
    debt.direction ? `data-trajectory-debt-direction-direction="${debt.direction}"` : '',
  ].filter(Boolean);
  const fields = [
    planningTrajectoryPressureTextField('Label', debt.label || debt.id),
    planningTrajectoryPressureTextField('Direction', dirLabel),
    planningTrajectoryPressureAmountField('Opening', debt.opening),
    planningTrajectoryPressureAmountField('Ending', debt.ending),
    planningTrajectoryPressureAmountField('Change', debt.delta),
    planningTrajectoryPressureAmountField('Paid on walk', debt.paid),
  ].filter(Boolean).join('');
  const interest = planningTrajectoryDebtDirectionInterestHtml(debt.interest);
  let milestone = '';
  if (debt.milestone && debt.milestone.kind === 'cleared-within-published-horizon') {
    const m = debt.milestone;
    milestone = `<div class="planning-trajectory-debt-direction-milestone" data-trajectory-debt-direction-milestone="${m.kind}"${m.month ? ` data-trajectory-debt-direction-milestone-month="${m.month}"` : ''}${m.asOf ? ` data-trajectory-debt-direction-milestone-asof="${m.asOf}"` : ''}>`
      + '<small class="planning-trajectory-pressure-field"><span>Cleared within published horizon</span> '
      + `${m.month ? `month ${m.month}` : 'month unknown'}`
      + `${m.asOf ? ` (as-of ${fmtDateFull(m.asOf)})` : ''}`
      + '</small></div>';
  }
  const title = debt.label ? `${debt.label} (${debt.id})` : debt.id;
  return `<li class="planning-trajectory-debt-direction-item"${attrs.length ? ' ' + attrs.join(' ') : ''}><span class="planning-trajectory-debt-direction-debt-title">${title}</span>${fields}${interest}${milestone}</li>`;
}

function planningTrajectoryDebtDirectionHtml(traj) {
  const note = 'Debt direction is Forecast.baselineTrajectory.debtDirection only — as-of opening versus the last published month-end on the coupled walk. This page copies the household picture, per-debt facts, and id lists in Forecast order; it does not rank debts, recommend which debt to pay first, or compute direction. Persistent means unchanged at whole-cent identity only. When Forecast publishes availableCreditIsNotCash, available credit is not cash.';
  const dd = traj && traj.debtDirection;
  if (!dd || dd.status !== 'ready') {
    const reason = (dd && dd.reason) || (traj && traj.reason) || 'Baseline trajectory debt direction unavailable.';
    return {
      lede: '',
      list: `<div class="note-box crit" data-trajectory-debt-direction="unavailable">${reason}</div>`,
      note,
    };
  }
  const household = dd.household || {};
  const householdDir = PLANNING_DEBT_DIRECTION_LABEL[household.direction] || household.direction || '';
  const householdBlock = `<div class="planning-trajectory-debt-direction-household" data-trajectory-debt-direction-household-direction="${household.direction || ''}">`
    + `<p class="lede"><strong>Household total</strong> — ${householdDir || 'direction withheld'} from opening to last published month-end.</p>`
    + planningTrajectoryDebtDirectionBalanceHtml('total', household)
    + planningTrajectoryDebtDirectionBalanceHtml('consumer', household.consumer)
    + planningTrajectoryDebtDirectionBalanceHtml('secured', household.secured)
    + planningTrajectoryDebtDirectionBalanceHtml('heloc', household.heloc)
    + (household.paid != null && isFinite(Number(household.paid))
      ? planningTrajectoryPressureAmountField('Paid on walk (household)', household.paid) : '')
    + planningTrajectoryDebtDirectionInterestHtml(household.interest)
    + '</div>';
  const flags = [];
  if (dd.anySupportedIncrease === true) {
    flags.push('<small class="planning-trajectory-pressure-field"><span>Any supported increase</span> yes</small>');
  } else if (dd.anySupportedIncrease === false) {
    flags.push('<small class="planning-trajectory-pressure-field"><span>Any supported increase</span> no</small>');
  }
  if (dd.inventedBorrowing === false) {
    flags.push('<small class="planning-trajectory-pressure-field"><span>Invented borrowing</span> no (Forecast)</small>');
  }
  if (dd.availableCreditIsNotCash === true) {
    flags.push('<small class="planning-trajectory-pressure-field"><span>Available credit is not cash</span> yes (Forecast)</small>');
  }
  const span = (dd.from && dd.through)
    ? `From ${fmtDateFull(dd.from)} through ${fmtDateFull(dd.through)}.`
    : '';
  const idLists = `<div class="planning-trajectory-debt-direction-groups">`
    + '<p class="subhead">Declining</p>' + planningTrajectoryDebtDirectionIdListHtml('declining', dd.declining)
    + '<p class="subhead">Persistent</p>' + planningTrajectoryDebtDirectionIdListHtml('persistent', dd.persistent)
    + '<p class="subhead">Increasing</p>' + planningTrajectoryDebtDirectionIdListHtml('increasing', dd.increasing)
    + '</div>';
  const debts = Array.isArray(dd.debts) ? dd.debts : [];
  const debtItems = debts.map((debt, index) => planningTrajectoryDebtDirectionDebtHtml(debt, index)).join('');
  const debtList = debtItems
    ? `<ol class="planning-trajectory-debt-direction-list" data-trajectory-debt-direction-debts="ready">${debtItems}</ol>`
    : '<p class="lede" data-trajectory-debt-direction-debts="empty">Forecast published no per-debt direction rows.</p>';
  return {
    lede: span + (debts.length
      ? ` ${debts.length} modelled debt${debts.length === 1 ? '' : 's'} with direction over the published horizon.`
      : ' Household direction with no per-debt rows.'),
    list: `<div class="planning-trajectory-debt-direction" data-trajectory-debt-direction="ready">${flags.join('')}${householdBlock}${idLists}${debtList}</div>`,
    note,
  };
}

function planningTrajectoryFundingUnavailableHtml(stageOrResult) {
  const reason = (stageOrResult && stageOrResult.reason)
    ? stageOrResult.reason
    : 'Forecast unavailable.';
  return `<span class="chip c">Forecast unavailable</span><small class="planning-trajectory-reason">${reason}</small>`;
}

function planningTrajectoryFundingComponentHtml(label, component, dataKey) {
  if (!component || component.status === 'unavailable') {
    if (!component || !component.reason) return '';
    return `<div class="planning-trajectory-funding-component unavailable" data-trajectory-funding-component="${dataKey || label}">${planningTrajectoryFundingUnavailableHtml(component)}</div>`;
  }
  if (component.amount == null || !isFinite(Number(component.amount))) return '';
  const chip = component.status ? planningTrajectoryChip(component.status) : '';
  return `<div class="planning-trajectory-funding-component" data-trajectory-funding-component="${dataKey || label}"><span class="planning-trajectory-funding-component-label">${label}</span> <b>${money2(component.amount)}</b>${chip}</div>`;
}

function planningTrajectoryFundingResultHtml(result) {
  if (!result || result.status === 'unavailable') {
    return `<div class="planning-trajectory-funding-result unavailable" data-trajectory-funding-result="unavailable">${planningTrajectoryFundingUnavailableHtml(result || {})}</div>`;
  }
  if (result.amount == null || !isFinite(Number(result.amount))) {
    return `<div class="planning-trajectory-funding-result unavailable" data-trajectory-funding-result="unavailable">${planningTrajectoryFundingUnavailableHtml({ reason: 'Forecast did not publish a result for this stage.' })}</div>`;
  }
  const chip = result.status ? planningTrajectoryChip(result.status) : '';
  return `<div class="planning-trajectory-funding-result" data-trajectory-funding-result="ready"><b>${money2(result.amount)}</b>${chip}</div>`;
}

function planningTrajectoryFundingStageHtml(stage, stageNum) {
  if (!stage) return '';
  const label = stage.label || (stageNum === 1 ? 'Normal life' : stageNum === 2 ? 'After planned spending' : 'After debt strategy');
  const attrs = [
    `data-trajectory-funding-stage="${stageNum}"`,
    stage.id ? `data-trajectory-funding-stage-id="${stage.id}"` : '',
    stage.status ? `data-trajectory-funding-stage-status="${stage.status}"` : '',
  ].filter(Boolean).join(' ');
  if (stage.status === 'unavailable') {
    return `<article class="planning-trajectory-funding-stage unavailable"${attrs.length ? ' ' + attrs : ''}><h3 class="planning-trajectory-funding-stage-title">${label}</h3>${planningTrajectoryFundingUnavailableHtml(stage)}</article>`;
  }
  const componentParts = [];
  if (stageNum === 1) {
    componentParts.push(planningTrajectoryFundingComponentHtml('Income', stage.income, 'income'));
    componentParts.push(planningTrajectoryFundingComponentHtml('Bills', stage.bills, 'bills'));
    componentParts.push(planningTrajectoryFundingComponentHtml('Debt obligations', stage.obligations, 'obligations'));
    if (stage.householdBudget) {
      let hb = planningTrajectoryFundingComponentHtml('Household Budget', stage.householdBudget, 'household-budget');
      if (stage.householdBudget.weeklyVariable != null && isFinite(Number(stage.householdBudget.weeklyVariable))) {
        hb += planningTrajectoryPressureTextField('Weekly variable', money2(stage.householdBudget.weeklyVariable));
      }
      if (stage.householdBudget.walkDays != null && isFinite(Number(stage.householdBudget.walkDays))) {
        const walkDaysLabel = stage.householdBudget.identity
          && /pay-period/i.test(stage.householdBudget.identity)
          ? 'Walk days in pay period'
          : 'Walk days in month';
        hb += planningTrajectoryPressureTextField(walkDaysLabel, String(stage.householdBudget.walkDays));
      }
      if (hb) componentParts.push(hb);
    }
  } else if (stageNum === 2) {
    componentParts.push(planningTrajectoryFundingComponentHtml('Dated commitments', stage.commitments, 'commitments'));
  } else if (stageNum === 3 && stage.extras) {
    let extras = planningTrajectoryFundingComponentHtml('Extra debt payments', stage.extras, 'extras');
    if (stage.extras.source) {
      extras += planningTrajectoryPressureTextField('Source', stage.extras.source);
    }
    if (extras) componentParts.push(extras);
  }
  const components = componentParts.filter(Boolean).join('');
  const details = components
    ? `<details class="planning-trajectory-funding-components"><summary>Component totals</summary>${components}</details>`
    : '';
  return `<article class="planning-trajectory-funding-stage"${attrs.length ? ' ' + attrs : ''}>
    <h3 class="planning-trajectory-funding-stage-title">${label}</h3>
    ${planningTrajectoryFundingResultHtml(stage.result)}
    ${details}
  </article>`;
}

function planningTrajectoryFundingPeriodPanelHtml(period, granularity) {
  if (!period) return '';
  if (granularity === 'pay-period') {
    const key = period.payday || period.id;
    if (!key) return '';
    const range = period.rangeLabel
      || (period.start && period.end ? `${fmtDateFull(period.start)} – ${fmtDateFull(period.end)}` : '');
    const rangeNote = range
      ? `<small class="planning-trajectory-period-dates">${range}</small>` : '';
    return `<div class="planning-trajectory-funding-period" data-trajectory-funding-granularity="pay-period" data-trajectory-funding-pay-period="${key}">
    ${rangeNote}
    <div class="planning-trajectory-funding-stages">
      ${planningTrajectoryFundingStageHtml(period.stage1, 1)}
      ${planningTrajectoryFundingStageHtml(period.stage2, 2)}
      ${planningTrajectoryFundingStageHtml(period.stage3, 3)}
    </div>
  </div>`;
  }
  if (!period.month) return '';
  return `<div class="planning-trajectory-funding-period" data-trajectory-funding-granularity="month" data-trajectory-funding-month="${period.month}">
    <div class="planning-trajectory-funding-stages">
      ${planningTrajectoryFundingStageHtml(period.stage1, 1)}
      ${planningTrajectoryFundingStageHtml(period.stage2, 2)}
      ${planningTrajectoryFundingStageHtml(period.stage3, 3)}
    </div>
  </div>`;
}

const PLANNING_TRAJECTORY_FUNDING_GRANULARITY = {
  month: { id: 'month', label: 'Month' },
  'pay-period': { id: 'pay-period', label: 'Pay period' },
};

function planningTrajectoryFundingRegionAriaLabel(granularity) {
  return granularity === 'pay-period'
    ? 'Three-stage funding for selected Seaspan pay period'
    : 'Three-stage funding for selected trajectory month';
}

function planningTrajectoryFundingGranularityBtn(granularity, current) {
  const row = PLANNING_TRAJECTORY_FUNDING_GRANULARITY[granularity];
  if (!row) return '';
  const pressed = current === granularity ? 'true' : 'false';
  return `<button type="button" class="planning-trajectory-granularity-btn" data-trajectory-funding-granularity="${row.id}" aria-pressed="${pressed}">${row.label}</button>`;
}

function planningRoadAheadPeriodKey(period, granularity) {
  if (!period) return null;
  if (granularity === 'pay-period') return period.payday || period.id || null;
  return period.month || null;
}

function planningRoadAheadPeriodLabel(period, granularity) {
  if (!period) return '';
  if (granularity === 'pay-period') {
    const id = period.payday || period.id || '';
    const range = period.rangeLabel
      || (period.start && period.end ? `${fmtDateFull(period.start)} – ${fmtDateFull(period.end)}` : '');
    return range ? `${id} · ${range}` : id;
  }
  return period.month || '';
}

function planningRoadAheadStage3Result(period) {
  if (!period || !period.stage3 || !period.stage3.result) return null;
  const result = period.stage3.result;
  if (result.status === 'unavailable') return null;
  if (result.amount == null || !isFinite(Number(result.amount))) return null;
  return result;
}

function planningRoadAheadResultPhrase(result) {
  if (!result || result.amount == null || !isFinite(Number(result.amount))) {
    return { label: 'Projected result withheld', cls: 'neutral' };
  }
  const amount = Number(result.amount);
  if (amount < 0) return { label: 'Projected funding gap', cls: 'gap' };
  if (amount > 0) return { label: 'Projected surplus', cls: 'surplus' };
  return { label: 'Projected result', cls: 'neutral' };
}

function planningRoadAheadPeriods(traj, granularity) {
  if (!traj || traj.status !== 'ready') return [];
  if (granularity === 'pay-period') {
    return Array.isArray(traj.payPeriods) ? traj.payPeriods : [];
  }
  return Array.isArray(traj.months) ? traj.months : [];
}

// Same fail-closed series gate as planningTrajectoryFundingHtml — road-ahead lead/timeline
// must not fall through to monthly pressure or stage3 when the requested granularity has no series.
function planningRoadAheadGranularitySeriesGate(traj, granularity) {
  if (!traj || traj.status !== 'ready') {
    return {
      available: false,
      reason: (traj && traj.reason) || 'Baseline trajectory unavailable.',
    };
  }
  if (granularity === 'pay-period') {
    const payPeriods = Array.isArray(traj.payPeriods) ? traj.payPeriods : [];
    if (!payPeriods.length) {
      const prov = traj.provenance && traj.provenance.payPeriodSeries;
      const reason = prov === 'unavailable'
        ? 'Forecast could not publish pay-period spans on this opening (Seaspan payroll calendar missing or clipped empty). Monthly funding remains available in Month view.'
        : 'Forecast published no pay periods on this baseline walk.';
      return { available: false, reason };
    }
    return { available: true, reason: null };
  }
  const months = Array.isArray(traj.months) ? traj.months : [];
  if (!months.length) {
    return {
      available: false,
      reason: (traj && traj.reason) || 'Baseline trajectory unavailable.',
    };
  }
  return { available: true, reason: null };
}

function planningRoadAheadIsForwardPeriod(period, granularity, asOf) {
  if (!asOf) return true;
  const asOfMonth = asOf.length >= 7 ? asOf.slice(0, 7) : null;
  if (granularity === 'pay-period') {
    if (period.end && period.end < asOf) return false;
    if (period.start && period.start >= asOf) return true;
    return !(period.end && period.end < asOf);
  }
  if (period.month && asOfMonth) return period.month >= asOfMonth;
  return true;
}

function planningRoadAheadForwardPressureSignals(traj, asOf) {
  const pressure = traj && traj.pressure;
  if (!pressure || pressure.status !== 'ready') {
    return {
      status: 'unavailable',
      reason: (pressure && pressure.reason) || (traj && traj.reason) || 'Baseline trajectory pressure unavailable.',
      signals: [],
    };
  }
  const signals = Array.isArray(pressure.signals) ? pressure.signals : [];
  const asOfMonth = asOf && asOf.length >= 7 ? asOf.slice(0, 7) : null;
  const forward = signals.filter(signal => {
    if (signal.date && signal.date >= asOf) return true;
    if (signal.month && asOfMonth && signal.month >= asOfMonth) return true;
    return false;
  });
  return { status: 'ready', signals: forward, all: signals };
}

function planningRoadAheadFindFundingGapLead(traj, granularity, asOf) {
  const periods = planningRoadAheadPeriods(traj, granularity);
  for (const period of periods) {
    if (!planningRoadAheadIsForwardPeriod(period, granularity, asOf)) continue;
    const result = planningRoadAheadStage3Result(period);
    if (!result || Number(result.amount) >= 0) continue;
    return {
      kind: 'funding-gap',
      period,
      key: planningRoadAheadPeriodKey(period, granularity),
      result,
    };
  }
  return null;
}

function planningRoadAheadFindPressureLead(traj, asOf) {
  const forward = planningRoadAheadForwardPressureSignals(traj, asOf);
  if (forward.status !== 'ready') return forward;
  if (!forward.signals.length) {
    return { status: 'empty', signals: forward.all };
  }
  const signal = forward.signals[0];
  return { status: 'ready', signal, index: forward.all.indexOf(signal) };
}

function planningRoadAheadSignalsForPeriod(traj, period, granularity) {
  const pressure = traj && traj.pressure;
  if (!pressure || pressure.status !== 'ready') return [];
  const all = Array.isArray(pressure.signals) ? pressure.signals : [];
  const month = granularity === 'month' ? period.month : null;
  const start = period.start;
  const end = period.end;
  return all.filter(signal => {
    if (month && signal.month === month) return true;
    if (signal.date && start && end && signal.date >= start && signal.date <= end) return true;
    return false;
  });
}

function planningRoadAheadLeadHtml(traj, granularity, asOf, selectedKey) {
  if (!traj || traj.status !== 'ready') {
    const reason = (traj && traj.reason) || 'Baseline trajectory unavailable.';
    return {
      html: `<div class="planning-road-lead planning-road-lead-unavailable" data-road-lead="unavailable"><div class="note-box crit">${reason}</div></div>`,
      focusKey: null,
    };
  }
  const seriesGate = planningRoadAheadGranularitySeriesGate(traj, granularity);
  if (!seriesGate.available) {
    return {
      html: `<div class="planning-road-lead planning-road-lead-unavailable" data-road-lead="series-unavailable" data-road-lead-granularity="${granularity}"><div class="note-box crit">${seriesGate.reason}</div></div>`,
      focusKey: selectedKey,
    };
  }
  const gapLead = planningRoadAheadFindFundingGapLead(traj, granularity, asOf);
  if (gapLead) {
    const phrase = planningRoadAheadResultPhrase(gapLead.result);
    const label = planningRoadAheadPeriodLabel(gapLead.period, granularity);
    const chip = gapLead.result.status ? planningTrajectoryChip(gapLead.result.status) : '';
    const focusKey = gapLead.key;
    const signals = planningRoadAheadSignalsForPeriod(traj, gapLead.period, granularity);
    const why = signals.length
      ? `<p class="planning-road-lead-why">Forecast published ${signals.length} pressure signal${signals.length === 1 ? '' : 's'} on this ${granularity === 'pay-period' ? 'pay period' : 'month'} — see details below.</p>`
      : '';
    return {
      html: `<article class="planning-road-lead planning-road-lead-gap" data-road-lead="funding-gap" data-road-lead-period="${focusKey || ''}">
        <p class="planning-road-lead-kicker">${phrase.label} in ${label}</p>
        <p class="planning-road-lead-amount" data-road-lead-amount="${gapLead.result.amount}"><b>${money2(gapLead.result.amount)}</b>${chip}</p>
        ${why}
        <button type="button" class="planning-road-lead-jump" data-road-select-period="${focusKey || ''}">View ${granularity === 'pay-period' ? 'pay period' : 'month'} details</button>
      </article>`,
      focusKey,
    };
  }
  const pressureLead = planningRoadAheadFindPressureLead(traj, asOf);
  if (pressureLead.status === 'unavailable') {
    return {
      html: `<div class="planning-road-lead planning-road-lead-unavailable" data-road-lead="pressure-unavailable"><div class="note-box crit">${pressureLead.reason}</div></div>`,
      focusKey: selectedKey,
    };
  }
  if (pressureLead.status === 'empty') {
    return {
      html: `<article class="planning-road-lead planning-road-lead-clear" data-road-lead="no-forward-pressure">
        <p class="planning-road-lead-kicker">No forward pressure signals after the opening date</p>
        <p class="lede">Forecast published ${pressureLead.signals.length} pressure signal${pressureLead.signals.length === 1 ? '' : 's'} on this baseline walk, all on or before the opening date.</p>
      </article>`,
      focusKey: selectedKey,
    };
  }
  const signal = pressureLead.signal;
  const kindLabel = PLANNING_PRESSURE_KIND[signal.kind] || signal.kind;
  const when = signal.month
    ? signal.month
    : (signal.date ? fmtDateFull(signal.date) : 'date withheld');
  const amountField = signal.amount != null && isFinite(Number(signal.amount))
    ? `<p class="planning-road-lead-amount"><b>${money2(signal.amount)}</b></p>` : '';
  const trust = (signal.trust === 'calculated' || signal.trust === 'estimated')
    ? planningTrajectoryChip(signal.trust) : '';
  let focusKey = selectedKey;
  if (signal.month && granularity === 'month') focusKey = signal.month;
  else if (granularity === 'pay-period' && signal.date) {
    const periods = planningRoadAheadPeriods(traj, granularity);
    const match = periods.find(p => p.start && p.end && signal.date >= p.start && signal.date <= p.end);
    if (match) focusKey = planningRoadAheadPeriodKey(match, granularity);
  }
  const attr = focusKey ? ` data-road-select-period="${focusKey}"` : '';
  const jump = focusKey
    ? `<button type="button" class="planning-road-lead-jump"${attr}>View period details</button>` : '';
  return {
    html: `<article class="planning-road-lead planning-road-lead-pressure" data-road-lead="pressure" data-trajectory-pressure-kind="${signal.kind}">
      <p class="planning-road-lead-kicker">Next pressure on the baseline walk — ${when}</p>
      <p class="planning-road-lead-kind">${kindLabel}</p>
      ${amountField}${trust}
      ${jump}
    </article>`,
    focusKey,
  };
}

function planningRoadAheadTimelineHtml(traj, granularity, selectedKey) {
  const seriesGate = planningRoadAheadGranularitySeriesGate(traj, granularity);
  if (!seriesGate.available) {
    return `<div class="note-box crit" data-road-timeline="unavailable" data-road-timeline-granularity="${granularity}">${seriesGate.reason}</div>`;
  }
  const periods = planningRoadAheadPeriods(traj, granularity);
  if (!periods.length) {
    const reason = (traj && traj.reason) || 'Baseline trajectory unavailable.';
    return `<div class="note-box crit" data-road-timeline="unavailable">${reason}</div>`;
  }
  let maxAbs = 0;
  const entries = periods.map(period => {
    const key = planningRoadAheadPeriodKey(period, granularity);
    const result = planningRoadAheadStage3Result(period);
    const amount = result ? Number(result.amount) : null;
    if (amount != null && isFinite(amount)) maxAbs = Math.max(maxAbs, Math.abs(amount));
    return { period, key, result, amount };
  });
  const bars = entries.map(entry => {
    const selected = entry.key === selectedKey;
    const phrase = entry.result ? planningRoadAheadResultPhrase(entry.result) : { label: 'Withheld', cls: 'withheld' };
    const shortLabel = granularity === 'pay-period'
      ? (entry.period.payday || entry.key || '')
      : (entry.period.month || entry.key || '');
    const widthPct = entry.amount != null && isFinite(entry.amount) && maxAbs > 0
      ? Math.max(8, Math.round((Math.abs(entry.amount) / maxAbs) * 100))
      : 8;
    const amountHtml = entry.result
      ? `<span class="planning-road-timeline-value">${money2(entry.amount)}</span>${entry.result.status ? planningTrajectoryChip(entry.result.status) : ''}`
      : '<span class="chip c">Withheld</span>';
    return `<li class="planning-road-timeline-item${selected ? ' is-selected' : ''}" data-road-timeline-period="${entry.key || ''}">
      <button type="button" class="planning-road-timeline-btn" data-road-select-period="${entry.key || ''}" aria-pressed="${selected ? 'true' : 'false'}" aria-label="${shortLabel} — ${phrase.label}">
        <span class="planning-road-timeline-label">${shortLabel}</span>
        <span class="planning-road-timeline-bar planning-road-timeline-bar-${phrase.cls}" style="--road-bar:${widthPct}%"></span>
        ${amountHtml}
      </button>
    </li>`;
  }).join('');
  return `<ol class="planning-road-timeline" data-road-timeline="ready" data-road-timeline-granularity="${granularity}">${bars}</ol>`;
}

function planningRoadAheadSelectedNavHtml(traj, granularity, selectedKey) {
  const periods = planningRoadAheadPeriods(traj, granularity);
  const idx = periods.findIndex(p => planningRoadAheadPeriodKey(p, granularity) === selectedKey);
  if (idx < 0) return '';
  const prev = idx > 0 ? periods[idx - 1] : null;
  const next = idx < periods.length - 1 ? periods[idx + 1] : null;
  const prevBtn = prev
    ? `<button type="button" class="planning-road-nav-btn" data-road-select-period="${planningRoadAheadPeriodKey(prev, granularity)}">Previous</button>`
    : '';
  const nextBtn = next
    ? `<button type="button" class="planning-road-nav-btn" data-road-select-period="${planningRoadAheadPeriodKey(next, granularity)}">Next</button>`
    : '';
  return `<div class="planning-road-selected-nav" role="group" aria-label="Selected period navigation">${prevBtn}${nextBtn}</div>`;
}

function planningRoadAheadSelectedHtml(traj, granularity, selectedKey, asOf) {
  const periods = planningRoadAheadPeriods(traj, granularity);
  const period = periods.find(p => planningRoadAheadPeriodKey(p, granularity) === selectedKey)
    || periods[0];
  if (!period) {
    return '<p class="lede" data-road-selected="empty">Select a period on the timeline.</p>';
  }
  const key = planningRoadAheadPeriodKey(period, granularity);
  const label = planningRoadAheadPeriodLabel(period, granularity);
  const stage3 = planningRoadAheadStage3Result(period);
  const phrase = stage3 ? planningRoadAheadResultPhrase(stage3) : { label: 'Final projected result withheld', cls: 'withheld' };
  const badge = `<span class="chip ${phrase.cls === 'gap' ? 'c' : phrase.cls === 'surplus' ? 'v' : 'e'}">${phrase.label}</span>`;
  const fundingPanel = planningTrajectoryFundingPeriodPanelHtml(period, granularity === 'pay-period' ? 'pay-period' : 'month');
  const signals = planningRoadAheadSignalsForPeriod(traj, period, granularity);
  const allSignals = (traj.pressure && Array.isArray(traj.pressure.signals)) ? traj.pressure.signals : [];
  const pressureBlock = signals.length
    ? `<details class="planning-road-pressure-detail"><summary>Pressure signals on this ${granularity === 'pay-period' ? 'pay period' : 'month'} (${signals.length})</summary><ol class="planning-trajectory-pressure-list" data-trajectory-pressure="ready">${signals.map(signal => {
      const index = allSignals.indexOf(signal);
      return planningTrajectoryPressureSignalHtml(signal, index >= 0 ? index : 0);
    }).join('')}</ol></details>`
    : '<p class="lede planning-road-pressure-detail" data-road-period-pressure="none">Forecast published no pressure signals on this period.</p>';
  const finalResult = period.stage3 && period.stage3.result
    ? planningTrajectoryFundingResultHtml(period.stage3.result)
    : planningTrajectoryFundingUnavailableHtml(period.stage3 && period.stage3.result ? period.stage3.result : {});
  return `<article class="planning-road-selected" data-road-selected-period="${key || ''}">
    <header class="planning-road-selected-head">
      <div>
        <h2 class="planning-road-selected-title">${label}</h2>
        ${badge}
      </div>
      ${planningRoadAheadSelectedNavHtml(traj, granularity, key)}
    </header>
    <p class="subhead">Funding progression</p>
    <p class="lede">Normal life → After planned spending → After debt strategy → final projected result. Figures are Forecast stage1 / stage2 / stage3 only.</p>
    ${fundingPanel}
    <div class="planning-road-final-result">
      <span class="planning-road-final-label">Final projected result (stage 3)</span>
      ${finalResult}
    </div>
    ${pressureBlock}
  </article>`;
}

function planningRoadAheadHtml(traj, granularity, selectedKey, asOf) {
  const intro = 'Projected income, bills, planned spending, and debt strategy on the Forecast baseline walk — one period at a time. Figures are copied from Forecast; this page does not calculate them.';
  const lead = planningRoadAheadLeadHtml(traj, granularity, asOf, selectedKey);
  const picker = `<div class="planning-trajectory-granularity planning-road-granularity" role="group" aria-label="Trajectory period granularity">
    ${planningTrajectoryFundingGranularityBtn('month', granularity)}
    ${planningTrajectoryFundingGranularityBtn('pay-period', granularity)}
  </div>`;
  return {
    intro,
    lead: lead.html,
    focusKey: lead.focusKey,
    picker,
    timeline: planningRoadAheadTimelineHtml(traj, granularity, selectedKey),
    selected: planningRoadAheadSelectedHtml(traj, granularity, selectedKey, asOf),
  };
}

function planningTrajectoryFundingHtml(traj, granularity, selectedKey) {
  const note = 'Three-stage funding is Forecast.baselineTrajectory stage1 / stage2 / stage3 only — Normal life, After planned spending, After debt strategy. Month view copies months[]; Pay period view copies payPeriods[] from the same baseline walk. This page copies component totals and results when Forecast publishes them; it does not subtract stages, recompute funding, or treat unavailable as $0.';
  const view = granularity === 'pay-period' ? 'pay-period' : 'month';
  const granularitySwitch = `<div class="planning-trajectory-granularity" role="group" aria-label="Trajectory period granularity">
    ${planningTrajectoryFundingGranularityBtn('month', view)}
    ${planningTrajectoryFundingGranularityBtn('pay-period', view)}
  </div>`;
  if (!traj || traj.status !== 'ready') {
    const reason = (traj && traj.reason) || 'Baseline trajectory unavailable.';
    return {
      lede: '',
      picker: granularitySwitch,
      panel: `<div class="note-box crit" data-trajectory-funding="unavailable">${reason}</div>`,
      note,
      granularity: view,
      selectedMonth: null,
      selectedPayPeriod: null,
    };
  }
  if (view === 'pay-period') {
    const payPeriods = Array.isArray(traj.payPeriods) ? traj.payPeriods : [];
    if (!payPeriods.length) {
      const prov = traj.provenance && traj.provenance.payPeriodSeries;
      const reason = prov === 'unavailable'
        ? 'Forecast could not publish pay-period spans on this opening (Seaspan payroll calendar missing or clipped empty). Monthly funding remains available in Month view.'
        : 'Forecast published no pay periods on this baseline walk.';
      return {
        lede: '',
        picker: granularitySwitch,
        panel: `<div class="note-box crit" data-trajectory-funding="unavailable" data-trajectory-funding-granularity="pay-period">${reason}</div>`,
        note,
        granularity: view,
        selectedMonth: null,
        selectedPayPeriod: null,
      };
    }
    const selected = payPeriods.find(p => (p.payday || p.id) === selectedKey) || payPeriods[0];
    const selectedId = selected.payday || selected.id;
    const lede = 'Compare Normal life, After planned spending, and After debt strategy for one Seaspan pay period — the same three stages Forecast publishes on the baseline walk. Pick a pay period below.';
    const picker = `${granularitySwitch}<label class="planning-trajectory-funding-picker"><span class="planning-trajectory-funding-picker-label">Trajectory pay period</span> `
      + `<select class="planning-trajectory-funding-select" data-trajectory-funding-picker="select" aria-label="Trajectory pay period for three-stage funding">`
      + payPeriods.map(p => {
        const id = p.payday || p.id;
        const label = p.rangeLabel ? `${id} · ${p.rangeLabel}` : id;
        return `<option value="${id}"${id === selectedId ? ' selected' : ''}>${label}</option>`;
      }).join('')
      + '</select></label>';
    return {
      lede,
      picker,
      panel: planningTrajectoryFundingPeriodPanelHtml(selected, 'pay-period'),
      note,
      granularity: view,
      selectedMonth: null,
      selectedPayPeriod: selectedId,
    };
  }
  const months = Array.isArray(traj.months) ? traj.months : [];
  if (!months.length) {
    const reason = (traj && traj.reason) || 'Baseline trajectory unavailable.';
    return {
      lede: '',
      picker: granularitySwitch,
      panel: `<div class="note-box crit" data-trajectory-funding="unavailable">${reason}</div>`,
      note,
      granularity: view,
      selectedMonth: null,
      selectedPayPeriod: null,
    };
  }
  const selected = months.find(m => m.month === selectedKey) || months[0];
  const lede = 'Compare Normal life, After planned spending, and After debt strategy for one trajectory month — the same three stages Forecast publishes on the baseline walk. Select a month in the table above or the picker below.';
  const picker = `${granularitySwitch}<label class="planning-trajectory-funding-picker"><span class="planning-trajectory-funding-picker-label">Trajectory month</span> `
    + `<select class="planning-trajectory-funding-select" data-trajectory-funding-picker="select" aria-label="Trajectory month for three-stage funding">`
    + months.map(m => `<option value="${m.month}"${m.month === selected.month ? ' selected' : ''}>${m.month}</option>`).join('')
    + '</select></label>';
  return {
    lede,
    picker,
    panel: planningTrajectoryFundingPeriodPanelHtml(selected, 'month'),
    note,
    granularity: view,
    selectedMonth: selected.month,
    selectedPayPeriod: null,
  };
}

let planningTrajectorySelectedMonth = null;
let planningTrajectorySelectedPayPeriod = null;
let planningTrajectoryFundingGranularity = 'month';

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
  const asOf = debt.asOf ? `<small data-trajectory-debt-asof="${debt.asOf}">as-of ${fmtDateFull(debt.asOf)}</small>` : '';
  return `<div data-trajectory-debt="consumer"><b>${money2(debt.consumer)}</b><small>Consumer</small></div>
    <div data-trajectory-debt="secured"><b>${money2(debt.secured)}</b><small>Secured incl. HELOC</small></div>
    <div data-trajectory-debt="heloc"><b>${money2(debt.heloc)}</b><small>of which HELOC</small></div>
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
    const partial = planningTrajectoryIsPartialMonth(month);
    return `<tr class="planning-trajectory-month-row" data-trajectory-month="${month.month}" data-trajectory-period-start="${month.start}" data-trajectory-period-end="${month.end}"${partial ? ' data-trajectory-partial="true"' : ''} data-trajectory-income-status="${income.status || ''}" data-trajectory-cash-status="${cash.status || ''}">
      <th scope="row">${planningTrajectoryPeriodCell(month)}</th>
      <td class="planning-trajectory-income">${planningTrajectoryIncomeHtml(income)}</td>
      <td class="planning-trajectory-cash">${planningTrajectoryCashHtml(cash)}</td>
      <td class="planning-trajectory-debt">${planningTrajectoryDebtHtml(month.debt)}</td>
    </tr>`;
  }).join('');
  return {
    lede: horizon + weekly + (regimeNotes ? ` ${regimeNotes}` : ''),
    table: `<div class="scroll"><table class="stackable planning-trajectory-table" aria-label="Baseline cash and debt by month">
      <thead><tr><th scope="col">Period</th><th scope="col">Income</th><th scope="col">Cash (period end)</th><th scope="col">Debt</th></tr></thead>
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

function planningRoadAheadWireSelection(root, d, periods) {
  if (!root) return;
  const buttons = root.querySelectorAll('[data-road-select-period]');
  for (const btn of buttons) {
    btn.onclick = () => {
      const key = btn.getAttribute('data-road-select-period');
      if (!key) return;
      if (planningTrajectoryFundingGranularity === 'pay-period') {
        planningTrajectorySelectedPayPeriod = key;
      } else {
        planningTrajectorySelectedMonth = key;
      }
      renderPlanning(d, periods);
    };
  }
  const granBtns = root.querySelectorAll('[data-trajectory-funding-granularity]');
  for (const btn of granBtns) {
    btn.onclick = () => {
      const next = btn.getAttribute('data-trajectory-funding-granularity');
      if (!next || next === planningTrajectoryFundingGranularity) return;
      planningTrajectoryFundingGranularity = next;
      renderPlanning(d, periods);
    };
  }
}

function renderPlanning(d, periods) {
  const html = planningPageHtml(planningAdvice(d, periods), d.liveOverlay);
  const traj = planningTrajectory(d, periods);
  const trajHtml = planningTrajectoryHtml(traj);
  const pressureHtml = planningTrajectoryPressureHtml(traj);
  const asOf = d && d.meta && d.meta.asOf ? d.meta.asOf : null;
  if (traj && traj.status === 'ready' && Array.isArray(traj.months) && traj.months.length) {
    if (!planningTrajectorySelectedMonth
      || !traj.months.some(m => m.month === planningTrajectorySelectedMonth)) {
      planningTrajectorySelectedMonth = traj.months[0].month;
    }
  } else {
    planningTrajectorySelectedMonth = null;
  }
  if (traj && traj.status === 'ready' && Array.isArray(traj.payPeriods) && traj.payPeriods.length) {
    if (!planningTrajectorySelectedPayPeriod
      || !traj.payPeriods.some(p => (p.payday || p.id) === planningTrajectorySelectedPayPeriod)) {
      const first = traj.payPeriods[0];
      planningTrajectorySelectedPayPeriod = first.payday || first.id;
    }
  } else if (planningTrajectoryFundingGranularity === 'pay-period') {
    planningTrajectorySelectedPayPeriod = null;
  }
  if (planningTrajectoryFundingGranularity !== 'month'
    && planningTrajectoryFundingGranularity !== 'pay-period') {
    planningTrajectoryFundingGranularity = 'month';
  }
  const fundingSelectedKey = planningTrajectoryFundingGranularity === 'pay-period'
    ? planningTrajectorySelectedPayPeriod
    : planningTrajectorySelectedMonth;
  const fundingHtml = planningTrajectoryFundingHtml(
    traj, planningTrajectoryFundingGranularity, fundingSelectedKey);
  if (fundingHtml.selectedMonth) planningTrajectorySelectedMonth = fundingHtml.selectedMonth;
  if (fundingHtml.selectedPayPeriod) planningTrajectorySelectedPayPeriod = fundingHtml.selectedPayPeriod;
  if (fundingHtml.granularity) planningTrajectoryFundingGranularity = fundingHtml.granularity;
  const roadSelectedKey = planningTrajectoryFundingGranularity === 'pay-period'
    ? planningTrajectorySelectedPayPeriod
    : planningTrajectorySelectedMonth;
  const roadHtml = planningRoadAheadHtml(traj, planningTrajectoryFundingGranularity, roadSelectedKey, asOf);
  const roadRoot = $('planning-road-ahead');
  if (roadRoot) {
    roadRoot.innerHTML = `<p class="lede planning-road-intro">${roadHtml.intro}</p>
      ${roadHtml.lead}
      <div class="planning-road-timeline-wrap">
        <p class="subhead">Projected period results</p>
        ${roadHtml.picker}
        ${roadHtml.timeline}
      </div>
      ${roadHtml.selected}`;
    planningRoadAheadWireSelection(roadRoot, d, periods);
  }
  $('planning-lede').textContent = html.lede;
  $('planning-list').innerHTML = html.list;
  $('planning-note').textContent = html.note;
  $('planning-trajectory-lede').textContent = trajHtml.lede;
  $('planning-trajectory').innerHTML = trajHtml.table;
  $('planning-trajectory-note').textContent = trajHtml.note;
  $('planning-trajectory-funding-lede').textContent = fundingHtml.lede;
  $('planning-trajectory-funding-picker').innerHTML = fundingHtml.picker;
  const fundingRegion = $('planning-trajectory-funding');
  fundingRegion.innerHTML = fundingHtml.panel;
  fundingRegion.setAttribute(
    'aria-label',
    planningTrajectoryFundingRegionAriaLabel(fundingHtml.granularity || 'month'),
  );
  $('planning-trajectory-funding-note').textContent = fundingHtml.note;
  $('planning-trajectory-pressure-lede').textContent = pressureHtml.lede;
  $('planning-trajectory-pressure').innerHTML = pressureHtml.list;
  $('planning-trajectory-pressure-note').textContent = pressureHtml.note;
  const debtDirectionHtml = planningTrajectoryDebtDirectionHtml(traj);
  $('planning-trajectory-debt-direction-lede').textContent = debtDirectionHtml.lede;
  $('planning-trajectory-debt-direction').innerHTML = debtDirectionHtml.list;
  $('planning-trajectory-debt-direction-note').textContent = debtDirectionHtml.note;

  const fundingPickerRoot = $('planning-trajectory-funding-picker');
  const fundingSelect = fundingPickerRoot.querySelector('[data-trajectory-funding-picker="select"]');
  if (fundingSelect) {
    fundingSelect.onchange = () => {
      if (planningTrajectoryFundingGranularity === 'pay-period') {
        planningTrajectorySelectedPayPeriod = fundingSelect.value;
      } else {
        planningTrajectorySelectedMonth = fundingSelect.value;
      }
      renderPlanning(d, periods);
    };
  }
  const granularityBtns = fundingPickerRoot.querySelectorAll('[data-trajectory-funding-granularity]');
  for (const btn of granularityBtns) {
    btn.onclick = () => {
      const next = btn.getAttribute('data-trajectory-funding-granularity');
      if (!next || next === planningTrajectoryFundingGranularity) return;
      planningTrajectoryFundingGranularity = next;
      renderPlanning(d, periods);
    };
  }
  const monthRows = $('planning-trajectory').querySelectorAll('tr[data-trajectory-month]');
  for (const tr of monthRows) {
    const monthKey = tr.getAttribute('data-trajectory-month');
    const selected = planningTrajectoryFundingGranularity === 'month'
      && monthKey === planningTrajectorySelectedMonth;
    tr.classList.toggle('planning-trajectory-month-selected', selected);
    const selectBtn = tr.querySelector('[data-trajectory-month-select]');
    if (!selectBtn) continue;
    selectBtn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    selectBtn.onclick = () => {
      planningTrajectoryFundingGranularity = 'month';
      planningTrajectorySelectedMonth = monthKey;
      renderPlanning(d, periods);
    };
  }
}

App.register(renderPlanning);
App.boot({ periods: true });
