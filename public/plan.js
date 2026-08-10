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

/* ----------------------------------------------------------- calendar */
// Compact labels for calendar cells and agenda rows.
function shortLabel(label) {
  return label
    .replace(/ — .*$/, '')
    .replace(/Mastercard/i, 'MC').replace(/ minimum/i, ' min')
    .replace(/ registration/i, '').replace(/ instalment/i, '')
    .replace(/ membership/i, '').replace(/ \(two accounts\)/i, '')
    .replace(/Payroll.*/i, 'Payroll').replace(/Tennis BC.*/i, 'Tennis BC')
    .replace(/Coaching.*/i, 'Tennis transfer');
}

// Month-grid calendar (desktop) and agenda list (mobile) from the same
// simulation. Each is a real table/list, so screen readers get both.
function renderCalendar(sim, neededBy, plan) {
  // Commitments that must be paid together get a same-day marker, so the
  // calendar cannot suggest splitting them across a payday.
  const groupOf = {};
  for (const c of plan.commitments) if (c.group) groupOf[c.id] = c.group;
  const atomic = new Set((plan.groups || []).filter(g => g.atomic).map(g => g.id));
  const byDate = new Map();
  for (const e of sim.events) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const balance = new Map(sim.daily.map(p => [p.date, p.balance]));

  const evHtml = e => {
    const est = e.confidence === 'estimated' ? '<span class="est">≈</span>' : '';
    const cls = e.amount > 0 ? 'in' : e.kind === 'commitment' ? 'commit'
      : e.kind === 'noncash' ? 'noncash' : 'out';
    const tie = atomic.has(groupOf[e.id]) ? '<span class="tie" title="Must be paid together, same day">⛓</span>' : '';
    return `<span class="cal-ev ${cls}" title="${e.label} ${money2(Math.abs(e.amount))}${e.kind === 'noncash' ? ' — capitalised, not paid' : ''}">` +
      `${e.kind === 'noncash' ? '' : e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount)).slice(1)} ${est}${tie}${shortLabel(e.label)}</span>`;
  };

  // ---- month grids ----
  const months = [];
  for (let m = sim.start.slice(0, 7); m <= sim.end.slice(0, 7);) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = `${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}`;
  }
  $('cal-months').innerHTML = months.map(m => {
    const [y, mo] = m.split('-').map(Number);
    const first = new Date(Date.UTC(y, mo - 1, 1));
    const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const lead = first.getUTCDay(); // 0 = Sunday
    let cells = '<tr>' + '<td class="dim"></td>'.repeat(lead);
    let col = lead;
    for (let day = 1; day <= daysIn; day++) {
      if (col === 7) { cells += '</tr><tr>'; col = 0; }
      const iso = `${m}-${String(day).padStart(2, '0')}`;
      const inWin = iso >= sim.start && iso <= sim.end;
      const evs = inWin ? (byDate.get(iso) || []) : [];
      const bal = balance.get(iso);
      const below = inWin && bal < sim.buffer;
      const cls = [
        inWin ? '' : 'dim',
        below ? (bal < 0 ? 'neg-day' : 'low-day') : '',
        iso === sim.min.date ? 'min-day' : '',
        iso === sim.start ? 'today' : '',
        iso === neededBy ? 'need-day' : '',
      ].filter(Boolean).join(' ');
      cells += `<td class="${cls}"><div class="cal-n">${day}` +
        (iso === sim.start ? ' <span class="cal-badge">today</span>' : '') +
        (iso === sim.min.date ? ' <span class="cal-badge low">low</span>' : '') +
        (iso === neededBy ? ' <span class="cal-badge need">transfer needed</span>' : '') +
        `</div>${evs.map(evHtml).join('')}` +
        (inWin ? `<div class="cal-bal ${bal < 0 ? 'neg' : ''}">${money(bal)}</div>` : '') +
        '</td>';
      col++;
    }
    cells += '<td class="dim"></td>'.repeat(7 - col) + '</tr>';
    const monthName = first.toLocaleDateString('en-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return `<table class="cal"><caption>${monthName}</caption>
      <thead><tr>${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(dn => `<th>${dn}</th>`).join('')}</tr></thead>
      <tbody>${cells}</tbody></table>`;
  }).join('');

  // ---- agenda (mobile) ----
  let agenda = '', lastM = '';
  for (const p of sim.daily) {
    const evs = byDate.get(p.date) || [];
    const special = p.date === sim.min.date || p.date === neededBy;
    if (!evs.length && !special) continue;
    const mName = new Date(p.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });
    if (mName !== lastM) { agenda += `<h4 class="cal-ag-month">${mName}</h4>`; lastM = mName; }
    const wd = new Date(p.date + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric' });
    agenda += `<div class="cal-ag-day ${p.balance < 0 ? 'neg-day' : p.balance < sim.buffer ? 'low-day' : ''}">
      <div class="cal-ag-head"><span>${wd}</span>
        ${p.date === sim.min.date ? '<span class="cal-badge low">low point</span>' : ''}
        ${p.date === neededBy ? '<span class="cal-badge need">transfer needed by now</span>' : ''}
        <span class="cal-ag-bal ${p.balance < 0 ? 'neg' : ''}">${money(p.balance)}</span></div>
      <div class="cal-ag-evs">${evs.map(evHtml).join('')}</div>
    </div>`;
  }
  $('cal-agenda').innerHTML = agenda;
}

/* ----------------------------------------------------------- rendering */
function renderPlan(d, periods) {
  const plan = d.plan;
  const asOf = d.meta.asOf;

  // ONE call, ONE answer. The weekly household cap, the simulation behind it
  // and the opening-gap analysis all come from the same engine result, so the
  // headline figure and the budget breakdown below cannot disagree — they
  // used to, showing $1,650/wk at the top and $0/wk in the budget block.
  const advice = Forecast.recommend(plan, asOf, simOpts());
  const recommended = advice.weekly;
  const weekly = state.weeklyVariable != null ? state.weeklyVariable : recommended;
  // The plan being drawn is the recovery path: gap covered, spending from the
  // first payday. Overriding the weekly figure re-simulates on those same
  // assumptions rather than inventing a second set.
  const sim = weekly === recommended ? advice.sim
    : Forecast.simulate(plan, asOf, Object.assign({}, advice.simOptions, { weeklyVariable: weekly }));
  const gap = advice.gap;                 // null when there is no opening gap
  const zeroSim = advice.zero;            // the unfunded window — the problem
  const fundingGap = gap ? gap.amount : 0;
  const preIncomeOut = gap ? gap.preIncomeOut : 0;

  // When does the plan NEED Amanda's transfer? Re-run with her transfer at
  // zero: the first day that dips below the buffer is the deadline.
  const transferMonthly = state.incomeOverrides.amandaTransfer != null
    ? state.incomeOverrides.amandaTransfer
    : (plan.income.find(s => s.id === 'amandaTransfer') || { scenarioMonthly: {} }).scenarioMonthly[state.scenario] || 0;
  let neededBy = null;
  if (transferMonthly > 0) {
    const noTransfer = Forecast.simulate(plan, asOf, Object.assign({}, advice.simOptions, {
      weeklyVariable: weekly,
      incomeOverrides: Object.assign({}, state.incomeOverrides, { amandaTransfer: 0 }),
    }));
    const firstShort = noTransfer.daily.find(p =>
      p.balance < noTransfer.buffer && (!gap || p.date >= gap.date));
    if (firstShort) neededBy = firstShort.date;
  }

  $('plan-window').textContent =
    `The 13 weeks from ${fmtDateLong(asOf)} to ${fmtDateLong(sim.end)} — every figure below is derived from this window.`;

  /* ---- status band ---- */
  const band = $('status-band');
  if (gap) {
    // An opening gap is a different problem from an overspending one, and the
    // fix is different too — so say which this is. The figures come from the
    // unfunded window: this is what happens if nothing is moved.
    band.className = 'statusband crit';
    band.innerHTML =
      `<b>Short by ${money(fundingGap)} on ${fmtDateLong(gap.floorDate)} — before any spending at all.</b>
       The household accounts hold ${money(plan.startingCash.amount)} today and
       ${money(preIncomeOut)} of committed payments fall before the next payday.
       This is a timing gap, not a shortage across the 90 days: cover it, hold spending to
       ${money(weekly)}/week from ${fmtDateLong(advice.effectiveFrom)}, and the window
       finishes with ${money(sim.ending)}.`;
  } else if (sim.min.balance < 0) {
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

  /* ---- covering the gap ---- */
  // Only shown when there is one. The point is not "here are your options" but
  // "here is what can actually cover it" — a source that cannot reach the
  // amount needed on the day is not an option, and is shown struck out.
  const fund = $('funding');
  if (gap && plan.funding) {
    // What must be in the account on the worst day, not the gap to the buffer.
    const shortDate = gap.date;
    const dueThatDay = gap.dueOnGapDay;
    const group = (plan.groups || []).find(g =>
      zeroSim.events.some(e => e.date === shortDate && (plan.commitments.find(c => c.id === e.id) || {}).group === g.id));

    fund.hidden = false;
    $('funding-head').textContent = plan.funding.heading;
    $('funding-lede').innerHTML =
      `<b>${money2(dueThatDay)} has to be in the account on ${fmtDateLong(shortDate)}</b>, against the
       ${money2(plan.startingCash.amount)} the household accounts hold.` +
      (group && group.atomic ? ` ${group.note}` : '');

    $('funding-options').innerHTML = plan.funding.options
      .slice().sort((a, b) => a.rank - b.rank)
      .map(o => {
        const enough = o.available >= dueThatDay;
        return `<div class="fund ${o.unusable || !enough ? 'fund-no' : 'fund-yes'}">
          <div class="fund-top">
            <span class="fund-lab">${o.label}</span>
            <span class="fund-amt">${money2(o.available)}${o.rate ? ` <span class="mutedtext">at ${pct(o.rate)}</span>` : ''}</span>
          </div>
          <div class="fund-verdict">${enough && !o.unusable
            ? `<span class="ok">Covers it</span>`
            : `<span class="no">Not enough — ${money(dueThatDay - o.available)} short of the ${money(dueThatDay)} needed</span>`}</div>
          <p class="fund-note">${o.note}</p>
        </div>`;
      }).join('');
    $('funding-note').textContent = plan.funding.note;
  } else {
    fund.hidden = true;
  }

  /* ---- the tennis-transfer deadline ---- */
  const tn = $('transfer-note');
  if (transferMonthly > 0) {
    tn.hidden = false;
    tn.innerHTML = neededBy
      ? `The plan leans on Amanda moving <span class="est">≈ ${money(transferMonthly)}/month</span> across from her account.
         Without it the balance slips under the buffer on <b>${fmtDateLong(neededBy)}</b> — that is the date her transfer
         has to land by, marked on the calendar below.`
      : `At this spending level the window stays above the buffer <b>even if Amanda transfers nothing</b> —
         her ≈ ${money(transferMonthly)}/month is counted mid-month, but nothing depends on its timing.`;
  } else {
    tn.hidden = false;
    tn.innerHTML = `No transfer from Amanda is counted in this scenario — the plan stands on the confirmed income alone.`;
  }

  /* ---- the three numbers that matter, near the top ---- */
  $('hero-tiles').innerHTML = [
    { lab: 'Lowest cash point', val: money(sim.min.balance), note: `on ${fmtDateLong(sim.min.date)}`,
      tone: sim.min.balance < 0 ? 'alert' : sim.min.balance < sim.buffer ? 'warn' : '' },
    { lab: 'Weekly household cap', val: money(weekly) + '/wk', tone: gap ? 'warn' : '',
      note: state.weeklyVariable != null && state.weeklyVariable !== recommended
        ? `your setting — the forecast supports ${money(recommended)}/wk`
        : gap
          ? `from ${fmtDateLong(advice.effectiveFrom)}, once the ${money(fundingGap)} gap is covered. Food and fuel come out of this first.`
          : `≈ ${money(weekly * WEEKS_PER_MONTH)} a month. Food and fuel come out of this first.` },
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
    row('Starting available cash <span class="mutedtext">household accounts only</span>',
      money2(plan.startingCash.amount), '', chipC) +
    (plan.startingCash.heldElsewhere
      ? `<div class="ledger-sub">${plan.startingCash.heldElsewhere.map(h =>
          `<div class="ledger-row sub"><span>${h.label}</span><span>${money2(h.value)} <span class="mutedtext">not counted</span></span></div>`).join('')}</div>`
      : '') +
    row('Income — confirmed', '+ ' + money2(T.confirmedIncome), 'in', chipC) +
    row('Income — estimated', est('+ ' + money2(T.estimatedIncome)), 'in', chipE) +
    row('Debt minimums & mortgage', '− ' + money2(T.obligations), 'out') +
    row('Recurring bills — utilities, insurance, gym', '− ' + money2(T.bills), 'out') +
    row('Committed expenses', '− ' + money2(T.commitments), 'out') +
    row('Variable-spending budget', '− ' + money2(T.variable), 'out', ' <span class="chip">budget</span>') +
    (T.extra > 0 ? row('Planned extra debt payments', '− ' + money2(T.extra), 'out', ' <span class="chip">planned</span>') : '') +
    (T.noncash ? row('HELOC interest — capitalised, not paid',
      money2(T.noncash) + ' <span class="mutedtext">added to the balance</span>', '', ' <span class="chip">non-cash</span>') : '') +
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
    const fixed = w.obligations + w.bills;
    return `<tr class="${cls}">
      <td>W${w.n}<div class="mutedtext">${fmtRange(w.start, w.end)}</div></td>
      <td class="num">${money(w.opening)}</td>
      <td class="num">${w.confirmedIncome ? '+' + money(w.confirmedIncome).slice(1) : '—'}</td>
      <td class="num">${w.estimatedIncome ? est('+' + money(w.estimatedIncome).slice(1)) : '—'}</td>
      <td class="num">${fixed ? money(fixed) : '—'}</td>
      <td class="num">${w.commitments ? money(w.commitments) : '—'}</td>
      <td class="num">${money(w.variable)}</td>
      ${w.extra ? `<td class="num">${money(w.extra)}</td>` : (sim.totals.extra > 0 ? '<td class="num">—</td>' : '')}
      <td class="num ${w.closing < 0 ? 'neg' : ''}"><b>${money(w.closing)}</b>` +
      `<div class="mutedtext ${w.closing < w.requiredClosing ? 'neg' : ''}">keep ≥ ${money(w.requiredClosing)}</div>` +
      `${w.belowBuffer ? `<div class="mutedtext">low ${money(w.low)}</div>` : ''}</td>
    </tr>`;
  };
  const extraCol = sim.totals.extra > 0 ? '<th class="num">Extra debt</th>' : '';
  $('wk-table').innerHTML = `<thead><tr>
      <th>Week</th><th class="num">Opening</th><th class="num">Confirmed in</th><th class="num">Estimated in</th>
      <th class="num">Bills &amp; minimums</th><th class="num">Committed</th><th class="num">Budget</th>${extraCol}<th class="num">Closing</th>
    </tr></thead><tbody>${sim.weeks.map(wkRow).join('')}</tbody>`;

  /* ---- the calendar ---- */
  renderCalendar(sim, neededBy, plan);
  $('cal-note').textContent = plan.billsNote || '';

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
        <span>Out ${money(w.obligations + w.bills + w.commitments + w.extra)}</span>
        <span>Budget ${money(w.variable)}</span>
      </div>
      <div class="wk-track ${w.closing < w.requiredClosing ? 'neg' : ''}">Keep ≥ ${money(w.requiredClosing)} to stay on plan</div>
      ${w.belowBuffer ? `<div class="wk-flag ${w.negative ? 'neg' : ''}">${w.negative ? 'Goes negative' : 'Dips below the buffer'} — low ${money(w.low)}</div>` : ''}
      ${notable ? `<ul class="wk-events">${notable}</ul>` : ''}
    </div>`;
  }).join('');

  /* ---- what the cap has to cover ---- */
  // The cap is one number, but it is not one kind of money. Food and fuel come
  // out of it before anything optional does, and the page has to say so or the
  // household will read it as spending money.
  const budget = Forecast.budgetBreakdown(plan, periods, {
    paypalPerMonth: d.paypal ? d.paypal.perMonth : 0,
    disabled: state.disabled,
  });
  const recMonthly = weekly * WEEKS_PER_MONTH;
  const perWeek = m => m / WEEKS_PER_MONTH;
  const required = budget ? budget.requiredMonthly : 0;
  const optional = Math.max(0, recMonthly - required);
  const short = required - recMonthly;

  if (budget) {
    const food = budget.categories.find(c => c.id === 'groceries');
    const fuel = budget.categories.find(c => c.id === 'fuel');
    $('budget-out').innerHTML =
      row('<b>Weekly household cap</b>', `<b>${money(weekly)} / week</b>`) +
      row('&nbsp;&nbsp;— as a monthly figure', `${money(recMonthly)} / month`) +
      row('Essential variable need <span class="mutedtext">groceries, fuel, phones, medical</span>',
        est(money(perWeek(required)) + ' / week'), 'out', chipE) +
      row(short > 0 ? '<b class="neg">Discretionary room</b>' : 'Discretionary room',
        short > 0 ? '<b class="neg">nothing left</b>' : money(perWeek(optional)) + ' / week') +
      row('&nbsp;&nbsp;— of which groceries and fuel',
        est(money(perWeek(food.planned + fuel.planned)) + ' / week'), '', chipE) +
      row('Planned extra debt payment', money(state.extraDebtMonthly) + ' / month') +
      row('Required buffer at the end', money(sim.buffer)) +
      (short > 0
        ? `<p class="warnline">The cap is ${money(perWeek(short))}/week <b>below</b> what normal life has been costing.
           Groceries and fuel alone have run ${money(perWeek(food.historical + fuel.historical))}/week. At this income the
           window only works by cutting essentials, moving a commitment, or borrowing — that is the real message of this number.</p>`
        : `<p class="warnline">Read this as: <b>${money(perWeek(required))}/week is spoken for</b> before anything optional —
           ${money(perWeek(food.planned + fuel.planned))} of it groceries and fuel. The remaining
           ${money(perWeek(optional))}/week is the whole of dining out, shopping, entertainment and online spending, against the
           ${money(perWeek(budget.discretionaryMonthly))}/week those have actually been running at.</p>`);

    $('budget-basis').textContent =
      `Solved from the forecast, not from a category template: the largest weekly spend that keeps every day of the ` +
      `projection at or above the ${money(sim.buffer)} buffer under the ${state.scenario} income scenario. ` +
      `The split below it comes from ${budget.basisLabel.toLowerCase()} of actual spending — ` +
      `${budget.months} months — with the ${money(budget.datedMonthly)}/month of bills and commitments that already sit ` +
      `on the calendar subtracted from their own categories, so nothing is counted twice. ` +
      `No owner-built budget has been supplied, so every figure here is a historical actual rather than a target.`;
  }

  /* ---- category breakdown ---- */
  // Every category, in one table, showing the three things that matter:
  // what it has actually cost, what is already dated on the calendar, and what
  // therefore has to come out of the weekly cap. An even percentage cut across
  // everything is the wrong instruction, so the essential rows are marked and
  // the discretionary ones carry the reduction.
  if (budget) {
    const cats = budget.categories.filter(c => c.historical > 0 || c.dated > 0);
    const max = Math.max(...cats.map(c => c.historical));
    const chipFor = c =>
      c.class === 'essential' ? '<span class="chip">essential</span>'
      : c.class === 'reserve' ? '<span class="chip w">reserve</span>'
      : c.class === 'unknown' ? '<span class="chip e">unknown</span>' : '';
    $('budget-cats').innerHTML = cats.map(c => `
      <div class="cat-row">
        <span class="cat-lab">${c.label} ${chipFor(c)}${c.fullyDated
          ? ' <span class="chip v">on the calendar</span>' : ''}</span>
        <span class="cat-bar"><span style="width:${(c.historical / max) * 100}%"></span></span>
        <span class="cat-amt">${c.class === 'reserve'
          ? '<span class="mutedtext">reserve</span>'
          : c.planned > 0 ? est(money(c.planned)) : '<span class="mutedtext">$0</span>'}</span>
        <span class="cat-hist">has been ${money(c.historical)}/mo${c.dated > 0
          ? ` · ${money(c.dated)} dated` : ''}</span>
      </div>`).join('');

    const inCap = budget.requiredMonthly + budget.discretionaryMonthly;
    $('budget-cats-note').textContent =
      `The right-hand figure is what each category has averaged; the amount before it is what has to come out of the ` +
      `weekly cap once anything already dated on the calendar is removed. Those add to ${money(inCap)}/month against a ` +
      `cap of ${money(recMonthly)}/month, so ${money(Math.max(0, inCap - recMonthly))}/month has to come off — and it ` +
      `cannot come off the essential rows, which are ${money(budget.requiredMonthly)}/month on their own. ` +
      `Insurance and children's sports show $0 because they are fully dated on the calendar, not because they are free.`;
  }

  /* ---- next actions ---- */
  if (plan.actionsNote) $('actions-note').textContent = 'Five at most, in order. ' + plan.actionsNote;
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
