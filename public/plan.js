'use strict';
/* The Plan page — the 90-day forecast, the budget solved from it, and the
   next actions. All amounts come from data.json's `plan` block; the maths is
   forecast.js, the same file the node test suite exercises.

   Estimated figures are marked ≈ and rendered in the .est style everywhere,
   so a confirmed dollar never looks the same as a modelled one. */

/* ----------------------------------------------------------- knob state */
// The user's planning knobs — not financial data, just their adjustments.
const KNOB_KEY = 'hfd-plan-knobs-v1';
const state = {
  scenario: null,          // conservative | expected | optimistic
  targetBuffer: null,
  extraDebtMonthly: null,
  weeklyVariable: null,    // null = follow the recommendation
  incomeOverrides: {},     // id -> monthly amount
  disabled: [],            // commitment ids toggled off
};
function loadKnobs(defaults) {
  state.scenario = defaults.scenario;
  state.targetBuffer = defaults.targetBuffer;
  state.extraDebtMonthly = defaults.extraDebtMonthly;
  try {
    const saved = JSON.parse(localStorage.getItem(KNOB_KEY) || 'null');
    if (saved && typeof saved === 'object') Object.assign(state, saved);
  } catch { /* storage unavailable */ }
}
function saveKnobs() {
  try { localStorage.setItem(KNOB_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function simOpts(extra = {}) {
  return Object.assign({
    scenario: state.scenario,
    targetBuffer: state.targetBuffer,
    extraDebtMonthly: state.extraDebtMonthly,
    incomeOverrides: state.incomeOverrides,
    disabled: state.disabled,
  }, extra);
}

const WEEKS_PER_MONTH = 365.25 / 12 / 7; // ≈ 4.35

const est = s => `<span class="est">≈ ${s}</span>`;
const fmtRange = (a, b) => {
  const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  const sm = s.toLocaleDateString('en-CA', { month: 'short' }), em = e.toLocaleDateString('en-CA', { month: 'short' });
  return sm === em ? `${s.getDate()}–${e.getDate()} ${em}` : `${s.getDate()} ${sm} – ${e.getDate()} ${em}`;
};

/* ----------------------------------------------------------- the chart */
// Daily projected balance. Everything important is annotated on the chart
// itself — the lowest point, the buffer, paydays, large payments — because
// hover is not available on touch. The weekly table repeats every number.
function forecastChart(mount, sim) {
  if (!mount) return;
  const W = 760, H = 320, padL = 62, padR = 16, padT = 30, padB = 42;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const days = sim.daily;
  const vals = days.map(d => d.balance);
  const lo = Math.min(0, sim.buffer, ...vals) - 300;
  const hi = Math.max(...vals, sim.buffer) * 1.06;
  const x = i => padL + (i / (days.length - 1)) * plotW;
  const y = v => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-label': `Projected cash balance, ${fmtDate(sim.start)} to ${fmtDate(sim.end)}. Lowest ${money(sim.min.balance)} on ${fmtDate(sim.min.date)}. Ending ${money(sim.ending)}.` });

  // gridlines + axis labels
  for (let t = 0; t <= 4; t++) {
    const v = lo + (hi - lo) * t / 4, yy = y(v);
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: css('--grid'), 'stroke-width': 1 }));
    const tx = el('text', { x: padL - 10, y: yy + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': '11' });
    tx.textContent = (v < 0 ? '−$' : '$') + Math.abs(v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    svg.appendChild(tx);
  }

  // negative territory, tinted — visible only when the range dips below zero
  if (lo < 0) {
    svg.appendChild(el('rect', { x: padL, y: y(0), width: plotW, height: padT + plotH - y(0),
      fill: css('--critical'), opacity: 0.07 }));
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(0), y2: y(0), stroke: css('--critical'), 'stroke-width': 1.5 }));
  }

  // weeks that dip below the buffer, shaded
  sim.weeks.forEach((w, i) => {
    if (!w.belowBuffer) return;
    const x0 = x(i * 7), x1 = x(Math.min(days.length - 1, i * 7 + 6));
    svg.appendChild(el('rect', { x: x0, y: padT, width: x1 - x0, height: plotH,
      fill: w.negative ? css('--critical') : css('--serious'), opacity: 0.08 }));
  });

  // buffer line
  svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(sim.buffer), y2: y(sim.buffer),
    stroke: css('--serious'), 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
  const bl = el('text', { x: W - padR, y: y(sim.buffer) - 6, 'text-anchor': 'end', fill: css('--serious'), 'font-size': '11', 'font-weight': '600' });
  bl.textContent = `Buffer ${money(sim.buffer)}`; svg.appendChild(bl);

  // the balance line
  const d = days.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { d, fill: 'none', stroke: css('--s1'), 'stroke-width': 2.25, 'stroke-linejoin': 'round' }));

  // paydays (income ≥ $1,000) and large payments (≥ $500), marked on the line
  const byDate = new Map(days.map((p, i) => [p.date, i]));
  const marked = new Set();
  for (const e of sim.events) {
    const i = byDate.get(e.date);
    if (i == null) continue;
    if (e.kind === 'income' && e.amount >= 1000 && !marked.has('i' + e.date)) {
      marked.add('i' + e.date);
      const isEst = e.confidence !== 'confirmed';
      svg.appendChild(el('circle', { cx: x(i), cy: y(days[i].balance), r: 4.5,
        fill: isEst ? css('--surface-1') : css('--s1'), stroke: css('--s1'), 'stroke-width': 2 }));
    } else if (e.amount <= -500 && e.kind !== 'income' && !marked.has('o' + e.date)) {
      marked.add('o' + e.date);
      const xx = x(i), yy = y(days[i].balance);
      svg.appendChild(el('path', { d: `M${xx - 4.5},${yy + 8} L${xx + 4.5},${yy + 8} L${xx},${yy + 15} Z`, fill: css('--serious') }));
    }
  }

  // the lowest point, always labelled
  const mi = byDate.get(sim.min.date) ?? 0;
  const mx = x(mi), my = y(sim.min.balance);
  const bad = sim.min.balance < 0;
  svg.appendChild(el('circle', { cx: mx, cy: my, r: 5, fill: bad ? css('--critical') : css('--serious'), stroke: css('--surface-1'), 'stroke-width': 2 }));
  const anchor = mi < days.length * 0.2 ? 'start' : mi > days.length * 0.8 ? 'end' : 'middle';
  const lab = el('text', { x: mx, y: Math.max(14, my - 14), 'text-anchor': anchor,
    fill: bad ? css('--critical') : css('--text-primary'), 'font-size': '12.5', 'font-weight': '700' });
  lab.textContent = `Low ${money(sim.min.balance)} · ${fmtDate(sim.min.date)}`;
  svg.appendChild(lab);

  // month labels along the bottom
  let lastMonth = '';
  days.forEach((p, i) => {
    const m = p.date.slice(0, 7);
    if (m !== lastMonth && (i === 0 || p.date.slice(8) === '01')) {
      lastMonth = m;
      const t = el('text', { x: x(i), y: H - 14, 'text-anchor': i === 0 ? 'start' : 'middle', fill: css('--muted'), 'font-size': '11' });
      t.textContent = new Date(p.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: i === 0 ? 'numeric' : undefined });
      svg.appendChild(t);
    }
  });

  // touch/hover detail, additive only — nothing depends on it
  days.forEach((p, i) => {
    const hit = el('rect', { x: x(i) - plotW / days.length / 2, y: padT, width: plotW / days.length, height: plotH, fill: 'transparent' });
    const evts = sim.events.filter(e => e.date === p.date);
    hit.addEventListener('mousemove', e => showTip(e, `<b>${fmtDate(p.date)}</b><span class="m">Balance ${money2(p.balance)}` +
      (evts.length ? '<br>' + evts.map(ev => `${ev.amount > 0 ? '+' : '−'}${money(Math.abs(ev.amount)).slice(1)} ${ev.label}${ev.confidence === 'estimated' ? ' ≈' : ''}`).join('<br>') : '') + '</span>'));
    hit.addEventListener('mouseleave', hideTip);
    hit.addEventListener('click', e => showTip(e, `<b>${fmtDate(p.date)}</b><span class="m">Balance ${money2(p.balance)}</span>`));
    svg.appendChild(hit);
  });

  mount.innerHTML = '';
  mount.appendChild(svg);
}

/* ----------------------------------------------------------- rendering */
function renderPlan(d, periods) {
  const plan = d.plan;
  const asOf = d.meta.asOf;

  const recommended = Forecast.recommendWeekly(plan, asOf, simOpts());
  const weekly = state.weeklyVariable != null ? state.weeklyVariable : recommended;
  const sim = Forecast.simulate(plan, asOf, simOpts({ weeklyVariable: weekly }));

  $('plan-window').textContent =
    `The 13 weeks from ${fmtDateLong(asOf)} to ${fmtDateLong(sim.end)} — every figure below is derived from this window.`;

  /* ---- status band ---- */
  const band = $('status-band');
  if (sim.min.balance < 0) {
    const firstNeg = sim.daily.find(p => p.balance < 0);
    band.className = 'statusband crit';
    band.innerHTML = `<b>Shortfall expected around ${fmtDateLong(firstNeg.date)}.</b>
      At this spending level the account goes negative${firstNeg.date !== sim.min.date
        ? ` and keeps falling, reaching ${money(sim.min.balance)} by ${fmtDateLong(sim.min.date)}`
        : ` (${money(sim.min.balance)})`}.
      Cut the weekly budget, move a commitment, or bring income forward.`;
  } else if (sim.min.balance < sim.buffer) {
    band.className = 'statusband warn';
    band.innerHTML = `<b>Tight — projected to dip to ${money(sim.min.balance)} on ${fmtDateLong(sim.min.date)}</b>,
      below the ${money(sim.buffer)} target buffer, then recover to ${money(sim.ending)} by ${fmtDate(sim.end)}.`;
  } else {
    band.className = 'statusband good';
    band.innerHTML = `<b>On plan — projected to finish with ${money(sim.ending)}.</b>
      The balance stays above the ${money(sim.buffer)} buffer all the way through, with the low of
      ${money(sim.min.balance)} on ${fmtDateLong(sim.min.date)}.`;
  }

  /* ---- the three numbers that matter, near the top ---- */
  $('hero-tiles').innerHTML = [
    { lab: 'Lowest cash point', val: money(sim.min.balance), note: `on ${fmtDateLong(sim.min.date)}`,
      tone: sim.min.balance < 0 ? 'alert' : sim.min.balance < sim.buffer ? 'warn' : '' },
    { lab: 'Safe to spend', val: money(weekly) + '/wk', note: state.weeklyVariable != null && state.weeklyVariable !== recommended
        ? `your setting — the forecast supports ${money(recommended)}/wk` : `≈ ${money(weekly * WEEKS_PER_MONTH)} a month, solved from the forecast`, tone: '' },
    { lab: 'Projected ending cash', val: money(sim.ending), note: `on ${fmtDateLong(sim.end)}, after everything below`,
      tone: sim.ending < sim.buffer ? 'warn' : '' },
  ].map(t => `
    <div class="tile ${t.tone}">
      <div class="lab">${t.lab}</div>
      <div class="val">${t.val}</div>
      <div class="note">${t.note}</div>
    </div>`).join('');

  /* ---- the ledger ---- */
  const T = sim.totals;
  const row = (label, val, cls = '', chip = '') =>
    `<div class="ledger-row ${cls}"><span>${label}${chip}</span><span>${val}</span></div>`;
  const chipC = ' <span class="chip v">confirmed</span>';
  const chipE = ' <span class="chip w">estimated</span>';
  $('hero-ledger').innerHTML =
    row('Starting available cash', money2(plan.startingCash.amount), '', chipC) +
    row('Income — confirmed', '+ ' + money2(T.confirmedIncome), 'in', chipC) +
    row('Income — estimated', est('+ ' + money2(T.estimatedIncome)), 'in', chipE) +
    row('Bills & debt minimums', '− ' + money2(T.obligations), 'out') +
    row('Committed expenses', '− ' + money2(T.commitments), 'out') +
    row('Variable-spending budget', '− ' + money2(T.variable), 'out', ' <span class="chip">budget</span>') +
    (T.extra > 0 ? row('Planned extra debt payments', '− ' + money2(T.extra), 'out', ' <span class="chip">planned</span>') : '') +
    row('<b>Projected ending cash</b>', `<b>${money2(sim.ending)}</b>`, 'sum') +
    row('Lowest projected balance', `${money2(sim.min.balance)} <span class="mutedtext">on ${fmtDate(sim.min.date)}</span>`,
      sim.min.balance < 0 ? 'neg' : '') +
    row('Target emergency buffer', money2(sim.buffer)) +
    row('Room for extra debt repayment', money2(sim.extraDebtCapacity) + ' <span class="mutedtext">at the end of the window</span>');
  $('hero-note').textContent = plan.startingCash.note;

  /* ---- scenario buttons ---- */
  for (const b of document.querySelectorAll('#scenario-bar .preset')) {
    b.setAttribute('aria-pressed', String(b.dataset.scenario === state.scenario));
  }

  /* ---- chart ---- */
  forecastChart($('c-forecast'), sim);
  $('forecast-caption').innerHTML =
    `Filled dots are confirmed paydays, hollow dots estimated income, triangles payments of $500 or more. ` +
    `Shaded weeks dip below the buffer${sim.daily.some(p => p.balance < 0) ? '; the red zone is a negative balance' : ''}. ` +
    `Every number is repeated in the table below — nothing here needs a hover.`;

  /* ---- weekly table (desktop) and cards (mobile) ---- */
  const wkRow = w => {
    const cls = w.negative ? 'wk-neg' : w.belowBuffer ? 'wk-low' : '';
    return `<tr class="${cls}">
      <td>W${w.n}<div class="mutedtext">${fmtRange(w.start, w.end)}</div></td>
      <td class="num">${money(w.opening)}</td>
      <td class="num">${w.confirmedIncome ? '+' + money(w.confirmedIncome).slice(1) : '—'}</td>
      <td class="num">${w.estimatedIncome ? est('+' + money(w.estimatedIncome).slice(1)) : '—'}</td>
      <td class="num">${w.obligations ? money(w.obligations) : '—'}</td>
      <td class="num">${w.commitments ? money(w.commitments) : '—'}</td>
      <td class="num">${money(w.variable)}</td>
      ${w.extra ? `<td class="num">${money(w.extra)}</td>` : (sim.totals.extra > 0 ? '<td class="num">—</td>' : '')}
      <td class="num ${w.closing < 0 ? 'neg' : ''}"><b>${money(w.closing)}</b>${w.belowBuffer ? `<div class="mutedtext">low ${money(w.low)}</div>` : ''}</td>
    </tr>`;
  };
  const extraCol = sim.totals.extra > 0 ? '<th class="num">Extra debt</th>' : '';
  $('wk-table').innerHTML = `<thead><tr>
      <th>Week</th><th class="num">Opening</th><th class="num">Confirmed in</th><th class="num">Estimated in</th>
      <th class="num">Fixed &amp; minimums</th><th class="num">Committed</th><th class="num">Budget</th>${extraCol}<th class="num">Closing</th>
    </tr></thead><tbody>${sim.weeks.map(wkRow).join('')}</tbody>`;

  $('wk-cards').innerHTML = sim.weeks.map(w => {
    const notable = w.events.filter(e => Math.abs(e.amount) >= 250)
      .map(e => `<li>${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount)).slice(1)} ${e.label}${e.confidence === 'estimated' ? ' <span class="est">≈</span>' : ''}</li>`).join('');
    return `<div class="wk-card ${w.negative ? 'wk-neg' : w.belowBuffer ? 'wk-low' : ''}">
      <div class="wk-card-head">
        <span><b>Week ${w.n}</b> · ${fmtRange(w.start, w.end)}</span>
        <span class="wk-close ${w.closing < 0 ? 'neg' : ''}">${money(w.closing)}</span>
      </div>
      <div class="wk-card-grid">
        <span>Opening ${money(w.opening)}</span>
        <span>In ${money(w.confirmedIncome)}${w.estimatedIncome ? ` <span class="est">+ ≈${money(w.estimatedIncome).slice(1)}</span>` : ''}</span>
        <span>Out ${money(w.obligations + w.commitments + w.extra)}</span>
        <span>Budget ${money(w.variable)}</span>
      </div>
      ${w.belowBuffer ? `<div class="wk-flag ${w.negative ? 'neg' : ''}">${w.negative ? 'Goes negative' : 'Dips below the buffer'} — low ${money(w.low)}</div>` : ''}
      ${notable ? `<ul class="wk-events">${notable}</ul>` : ''}
    </div>`;
  }).join('');

  /* ---- the budget that gets us there ---- */
  const recMonthly = weekly * WEEKS_PER_MONTH;
  const essentials = plan.essentialsPerMonth;
  const optional = Math.max(0, recMonthly - essentials);
  $('budget-out').innerHTML =
    row('Maximum safe variable spending', `<b>${money(weekly)} / week</b>`) +
    row('&nbsp;&nbsp;— as a monthly figure', `<b>${money(recMonthly)} / month</b>`) +
    row('Essential spending allowance', est(money(essentials) + ' / month'), '', chipE) +
    row('Optional spending allowance', (recMonthly < essentials ? '<b class="neg">$0</b>' : money(optional) + ' / month')) +
    row('Planned extra debt payment', money(state.extraDebtMonthly) + ' / month') +
    row('Required buffer at the end', money(sim.buffer)) +
    (recMonthly < essentials
      ? `<p class="warnline">The safe budget is below the ${money(essentials)}/month that essentials alone have been costing.
         At this income the period only works by cutting essentials, moving a commitment, or borrowing — that is the real message of this number.</p>`
      : '');
  $('budget-basis').textContent =
    `Solved from the forecast, not from a category template: the largest weekly spend that keeps every day of the ` +
    `projection at or above the ${money(sim.buffer)} buffer under the ${state.scenario} income scenario. ${plan.essentialsNote}`;

  /* ---- category breakdown, where the data supports it ---- */
  if (periods && periods.periods && periods.periods.ytd) {
    const ytd = periods.periods.ytd;
    const per = t => t / ytd.months;
    const get = lab => { const r = ytd.spending.find(s => s.label === lab); return r ? per(r.total) : 0; };
    const groupsSpec = [
      { label: 'Groceries', v: get('Groceries'), kind: 'essential' },
      { label: 'Fuel & transport', v: get('Fuel & transport'), kind: 'essential' },
      { label: 'Other essentials', v: ['Household', 'Health', 'Telecom', 'Insurance', 'Property tax', 'Tax', 'Pets', 'School & clubs'].reduce((s, l) => s + get(l), 0), kind: 'essential' },
      { label: 'Children & sports', v: get('Sport & fitness'), kind: 'optional' },
      { label: 'Dining out', v: get('Restaurants'), kind: 'optional' },
      { label: 'Shopping & entertainment', v: get('Shopping') + get('Entertainment'), kind: 'optional' },
      { label: 'Subscriptions', v: get('Subscriptions'), kind: 'optional' },
      { label: 'Travel', v: get('Travel'), kind: 'optional' },
      { label: 'PayPal (online & app spend)', v: d.paypal ? d.paypal.perMonth : 0, kind: 'optional' },
      { label: 'Uncategorised', v: get('Uncategorised'), kind: 'unknown' },
    ].filter(g => g.v > 0);
    const histTotal = groupsSpec.reduce((s, g) => s + g.v, 0);
    const scale = recMonthly / histTotal;
    const max = Math.max(...groupsSpec.map(g => g.v));
    $('budget-cats').innerHTML = groupsSpec.map(g => `
      <div class="cat-row">
        <span class="cat-lab">${g.label} ${g.kind === 'essential' ? '<span class="chip">essential</span>' : g.kind === 'unknown' ? '<span class="chip e">unknown</span>' : ''}</span>
        <span class="cat-bar"><span style="width:${(g.v / max) * 100}%"></span></span>
        <span class="cat-amt">${est(money(g.v * scale))}</span>
        <span class="cat-hist">has been ${money(g.v)}/mo</span>
      </div>`).join('');
    $('budget-cats-note').textContent = scale < 0.999
      ? `The left figure is each category scaled to fit the ${money(recMonthly)}/month safe budget — an even ` +
        `${Math.round((1 - scale) * 100)}% below the ${money(histTotal)}/month these categories have actually averaged. ` +
        `Cutting evenly is rarely right: protect the essential rows and take more from the optional ones.`
      : `The safe budget covers the historical average of ${money(histTotal)}/month for these categories, with room to spare.`;
  }

  /* ---- next actions ---- */
  $('actions-list').innerHTML = plan.actions.slice(0, 5).map((a, i) => {
    const overdue = a.due && a.due < asOf && a.status !== 'done';
    return `<div class="action ${a.status === 'done' ? 'done' : ''}">
      <div class="action-n">${i + 1}</div>
      <div class="action-body">
        <div class="action-top">
          <span class="action-what">${a.what}</span>
          <span class="action-amt">${a.amount != null ? money2(a.amount) : ''}</span>
        </div>
        <div class="action-meta">
          ${a.due ? `<span class="chip ${overdue ? 'c' : 'w'}">due ${fmtDate(a.due)}</span>` : '<span class="chip">no deadline</span>'}
          <span class="chip ${a.status === 'done' ? 'v' : 'e'}">${a.status}</span>
          ${a.owner ? `<span class="chip">${a.owner}</span>` : ''}
        </div>
        <p class="action-why">${a.why}</p>
      </div>
    </div>`;
  }).join('');

  /* ---- compact snapshot ---- */
  const consumer = d.debts.filter(x => !x.secured).reduce((s, x) => s + (x.balance || 0), 0);
  const secured = d.debts.filter(x => x.secured).reduce((s, x) => s + (x.balance || 0), 0);
  const monthlyInterest = d.debts.reduce((s, x) => s + (x.annualInterest || 0), 0) / 12;
  const revolving = d.utilisation.reduce((s, u) => s + (u.available || 0), 0);
  const hh = d.helocHistory;
  const helocDelta = hh.length >= 2 ? hh[hh.length - 1].v - hh[hh.length - 2].v : null;
  $('snapshot-tiles').innerHTML = [
    { lab: 'Consumer debt', val: money(consumer), note: 'cards and revolving, excluding the house' },
    { lab: 'Mortgage + HELOC', val: money(secured), note: 'secured on the home' },
    { lab: 'Interest cost / month', val: money(monthlyInterest), note: 'across every debt, at current rates' },
    { lab: 'Credit left, everywhere', val: money(revolving), note: 'across all revolving facilities combined' },
    ...(helocDelta != null ? [{ lab: 'HELOC vs last month', val: (helocDelta >= 0 ? '+' : '−') + money(Math.abs(helocDelta)).slice(1),
      note: helocDelta >= 0 ? 'still growing' : 'coming down' }] : []),
  ].map(t => `
    <div class="tile small">
      <div class="lab">${t.lab}</div><div class="val">${t.val}</div><div class="note">${t.note}</div>
    </div>`).join('');
}

/* ----------------------------------------------------------- controls */
function wireControls(d) {
  const plan = d.plan;
  loadKnobs(plan.defaults);

  // Scenario buttons
  for (const b of document.querySelectorAll('#scenario-bar .preset')) {
    b.addEventListener('click', () => {
      state.scenario = b.dataset.scenario;
      state.incomeOverrides = {}; // scenario switch resets per-stream overrides
      syncInputs();
      saveKnobs(); App.rerender();
    });
  }

  const num = (id, get, set) => {
    const inp = $(id);
    if (!inp) return;
    inp.addEventListener('change', () => {
      const v = Number(inp.value);
      if (isFinite(v) && v >= 0) { set(v); saveKnobs(); App.rerender(); }
      else syncInputs();
    });
  };
  num('in-buffer', () => state.targetBuffer, v => { state.targetBuffer = v; });
  num('in-extra', () => state.extraDebtMonthly, v => { state.extraDebtMonthly = v; });
  num('in-weekly', () => state.weeklyVariable, v => { state.weeklyVariable = v; });
  $('btn-weekly-auto').addEventListener('click', () => {
    state.weeklyVariable = null; saveKnobs(); syncInputs(); App.rerender();
  });

  // Per-stream income overrides — only the estimated streams are editable.
  const streams = plan.income.filter(s => s.scenarioMonthly);
  $('income-inputs').innerHTML = streams.map(s => `
    <div class="control">
      <label for="inc-${s.id}">${s.label} <span class="chip w">estimated, monthly</span></label>
      <input type="number" id="inc-${s.id}" class="numin" min="0" step="50" inputmode="decimal">
    </div>`).join('');
  for (const s of streams) {
    $(`inc-${s.id}`).addEventListener('change', () => {
      const v = Number($(`inc-${s.id}`).value);
      if (isFinite(v) && v >= 0) { state.incomeOverrides[s.id] = v; saveKnobs(); App.rerender(); }
    });
  }

  // Optional commitments
  const adjustable = plan.commitments.filter(c => c.adjustable);
  $('commit-toggles').innerHTML = adjustable.map(c => `
    <label class="toggle">
      <input type="checkbox" id="ct-${c.id}" ${state.disabled.includes(c.id) ? '' : 'checked'}>
      <span>${c.label} — ${money2(c.amount)} <span class="mutedtext">${fmtDate(c.date)}</span></span>
    </label>`).join('');
  for (const c of adjustable) {
    $(`ct-${c.id}`).addEventListener('change', ev => {
      state.disabled = state.disabled.filter(id => id !== c.id);
      if (!ev.target.checked) state.disabled.push(c.id);
      saveKnobs(); App.rerender();
    });
  }

  function syncInputs() {
    $('in-buffer').value = state.targetBuffer;
    $('in-extra').value = state.extraDebtMonthly;
    $('in-weekly').value = state.weeklyVariable != null ? state.weeklyVariable : '';
    $('in-weekly').placeholder = 'recommended';
    for (const s of streams) {
      const ov = state.incomeOverrides[s.id];
      $(`inc-${s.id}`).value = ov != null ? ov : s.scenarioMonthly[state.scenario];
    }
    for (const c of adjustable) $(`ct-${c.id}`).checked = !state.disabled.includes(c.id);
  }
  syncInputs();

  $('btn-reset').addEventListener('click', () => {
    state.scenario = plan.defaults.scenario;
    state.targetBuffer = plan.defaults.targetBuffer;
    state.extraDebtMonthly = plan.defaults.extraDebtMonthly;
    state.weeklyVariable = null;
    state.incomeOverrides = {};
    state.disabled = [];
    saveKnobs(); syncInputs(); App.rerender();
  });
}

App.once(wireControls);
App.register(renderPlan);
App.boot({ periods: true });
