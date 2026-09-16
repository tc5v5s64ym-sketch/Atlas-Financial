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
  return `<span class="planning-trajectory-period">${month.month}</span>${partialNote}`;
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
    return `<tr data-trajectory-month="${month.month}" data-trajectory-period-start="${month.start}" data-trajectory-period-end="${month.end}"${partial ? ' data-trajectory-partial="true"' : ''} data-trajectory-income-status="${income.status || ''}" data-trajectory-cash-status="${cash.status || ''}">
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

function renderPlanning(d, periods) {
  const html = planningPageHtml(planningAdvice(d, periods), d.liveOverlay);
  const traj = planningTrajectory(d, periods);
  const trajHtml = planningTrajectoryHtml(traj);
  const pressureHtml = planningTrajectoryPressureHtml(traj);
  $('planning-lede').textContent = html.lede;
  $('planning-list').innerHTML = html.list;
  $('planning-note').textContent = html.note;
  $('planning-trajectory-lede').textContent = trajHtml.lede;
  $('planning-trajectory').innerHTML = trajHtml.table;
  $('planning-trajectory-note').textContent = trajHtml.note;
  $('planning-trajectory-pressure-lede').textContent = pressureHtml.lede;
  $('planning-trajectory-pressure').innerHTML = pressureHtml.list;
  $('planning-trajectory-pressure-note').textContent = pressureHtml.note;
  const debtDirectionHtml = planningTrajectoryDebtDirectionHtml(traj);
  $('planning-trajectory-debt-direction-lede').textContent = debtDirectionHtml.lede;
  $('planning-trajectory-debt-direction').innerHTML = debtDirectionHtml.list;
  $('planning-trajectory-debt-direction-note').textContent = debtDirectionHtml.note;
}

App.register(renderPlanning);
App.boot({ periods: true });
