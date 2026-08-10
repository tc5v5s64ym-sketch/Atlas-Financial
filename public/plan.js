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

const addDays = (iso, n) => Forecast.addDays(iso, n);
const fmtMonth = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { month: 'long' });
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
  // Which source covers the opening gap decides whether it costs anything.
  // The top-ranked usable option wins by default — Amanda releasing money the
  // household already owns, which creates no debt. A HELOC draw would, and the
  // projection has to see that rather than silently modelling the free path.
  // Two passes, because the gap has to be known before a source can be judged
  // against it. The size of the gap does not depend on who funds it, so the
  // first pass is safe to run with no source at all.
  // The engine allocates the gap across the ranked sources and tells us what
  // that costs. Choosing a single source here and passing only its debtId
  // modelled the whole gap as debt-free even when no source could reach it.
  const rankedSources = ((plan.funding || {}).options || [])
    .slice().sort((a, b) => a.rank - b.rank).filter(o => !o.unusable);
  const advice = Forecast.recommend(plan, asOf, simOpts({ fundingSources: plan.funding && plan.funding.options }));
  const fundingPlan = advice.funding || null;
  const fundingShort = !!(fundingPlan && !fundingPlan.feasible);
  const fundingSource = fundingPlan && fundingPlan.parts.length === 1 ? fundingPlan.parts[0] : null;
  const recommended = advice.weekly;
  const weekly = state.weeklyVariable != null ? state.weeklyVariable : recommended;
  // The plan being drawn is the recovery path: gap covered, spending from the
  // first payday. Overriding the weekly figure re-simulates on those same
  // assumptions rather than inventing a second set.
  const sim = weekly === recommended ? advice.sim
    : Forecast.simulate(plan, asOf, Object.assign({}, advice.simOptions, { weeklyVariable: weekly }));
  const gap = advice.gap;                 // null when there is no opening gap
  // Whether the assumed source is borrowed money. If it is, the debt side of
  // the projection already carries the draw and there is no cheaper path left
  // to contrast it against.
  const fundingIsDraw = !!(fundingPlan && fundingPlan.borrowed > 0);
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
  if (gap && fundingShort) {
    // Nothing available reaches the gap. Saying "cover it and the window
    // finishes with $X" would describe a plan that does not exist.
    band.className = 'statusband crit';
    band.innerHTML =
      `<b>Short by ${money(fundingGap)} on ${fmtDateLong(gap.floorDate)}, and there is not enough
       anywhere to cover it.</b> Every usable source combined reaches
       ${money2(fundingPlan.parts.reduce((a, p) => a + p.amount, 0))}, leaving
       <b>${money2(fundingPlan.shortfall)}</b> unfunded at a ${money(sim.buffer)} buffer. Lower the buffer,
       move a commitment, or find money outside these accounts — the figures below model only what can
       actually be funded.`;
  } else if (gap && fundingPlan && fundingPlan.needsCombination) {
    // Reachable, but not from one place — and part of it is borrowed.
    band.className = 'statusband crit';
    band.innerHTML =
      `<b>Short by ${money(fundingGap)} on ${fmtDateLong(gap.floorDate)}, and no single source covers it.</b>
       It takes ${fundingPlan.parts.map(p => `${money2(p.amount)} from ${p.short}`).join(' plus ')}.
       ${fundingPlan.borrowed > 0
        ? `<b>${money2(fundingPlan.borrowed)} of that is borrowed</b>, and the debt figures below carry it.`
        : 'None of it is borrowed.'}
       Hold spending to ${money(weekly)}/week from ${fmtDateLong(advice.effectiveFrom)} and the window
       finishes with ${money(sim.ending)}.`;
  } else if (gap) {
    // An opening gap is a different problem from an overspending one, and the
    // fix is different too — so say which this is. The figures come from the
    // unfunded window: this is what happens if nothing is moved.
    band.className = 'statusband crit';
    band.innerHTML =
      `<b>Short by ${money(fundingGap)} on ${fmtDateLong(gap.floorDate)} — before any spending at all.</b>
       The household accounts hold ${money2(plan.startingCash.amount)} today and
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
    // Judge each source against the GAP, not against the day's payment. The
    // gap includes restoring the buffer, so at a raised buffer a source can
    // clear the $623 due and still not close the hole — which is how these
    // cards came to read "Covers it" beside a band saying nothing could.
    const needed = fundingGap;
    const group = (plan.groups || []).find(g =>
      zeroSim.events.some(e => e.date === shortDate && (plan.commitments.find(c => c.id === e.id) || {}).group === g.id));

    fund.hidden = false;
    $('funding-head').textContent = plan.funding.heading;
    $('funding-lede').innerHTML =
      `<b>${money2(dueThatDay)} has to be in the account on ${fmtDateLong(shortDate)}</b>, against the
       ${money2(plan.startingCash.amount)} the household accounts hold. Restoring the
       ${money(sim.buffer)} buffer as well makes the amount to find <b>${money2(needed)}</b>, and that is
       what each source below is measured against.` +
      (group && group.atomic ? ` ${group.note}` : '');

    $('funding-options').innerHTML = plan.funding.options
      .slice().sort((a, b) => a.rank - b.rank)
      .map(o => {
        const enough = o.available >= needed;
        const part = fundingPlan && fundingPlan.parts.find(p => p.id === o.id);
        return `<div class="fund ${o.unusable || !enough ? 'fund-no' : 'fund-yes'}">
          <div class="fund-top">
            <span class="fund-lab">${o.label}</span>
            <span class="fund-amt">${money2(o.available)}${o.rate ? ` <span class="mutedtext">at ${pct(o.rate)}</span>` : ''}</span>
          </div>
          <div class="fund-verdict">${enough && !o.unusable
            ? `<span class="ok">Covers the whole ${money(needed)}</span>`
            : part
              ? `<span class="ok">Covers ${money2(part.amount)} of the ${money(needed)}</span> <span class="mutedtext">— used in the plan, with the rest from elsewhere</span>`
              : `<span class="no">Not enough — ${money(Math.max(0, needed - o.available))} short of the ${money(needed)} needed</span>`}</div>
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

  /* ---- cash and debt, walked together ---- */
  // The same event stream that moves the cash moves the balances. A minimum
  // that leaves the chequing account has to arrive on a card.
  const debtProj = Forecast.projectDebts(plan, d.debts, asOf,
    Object.assign({}, advice.simOptions, { weeklyVariable: weekly,
      extraFacilities: d.revolvingExtra,
      extraDebtTarget: plan.nextDollar && plan.nextDollar.target }));
  const cashOn = date => {
    const p = sim.daily.find(x => x.date === date);
    return p ? p.balance : plan.startingCash.amount;
  };
  const mark = n => debtProj.marks.find(m => m.day === n) || debtProj.marks[debtProj.marks.length - 1];
  const today = mark(0), day90 = debtProj.marks[debtProj.marks.length - 1];

  const budget = Forecast.budgetBreakdown(plan, periods, {
    paypalPerMonth: d.paypal ? d.paypal.perMonth : 0,
    disabled: state.disabled,
  });
  const recMonthly = weekly * WEEKS_PER_MONTH;
  const perWeek = m => m / WEEKS_PER_MONTH;
  const required = budget ? budget.requiredMonthly : 0;
  const optional = Math.max(0, recMonthly - required);
  const short = required - recMonthly;

  /* ---- the mission, in one sentence, derived ---- */
  // Assembled from what the numbers actually say, never hardcoded: if it stops
  // being true, the sentence changes.
  const overToday = today.debts.filter(x => x.overLimit);
  const helocNow = debtProj.byId.heloc;
  // The day it ACTUALLY crosses. Reading this off the 30-day marks reported
  // 7 October for a crossing that happens on 30 September — a different month,
  // and on the wrong side of the plan's own deadline.
  const helocBreach = (debtProj.crossings || [])
    .find(c => c.id === 'heloc' && !c.alreadyOver) || null;
  const missionParts = [];
  if (gap && fundingShort) {
    missionParts.push(`find ${money(fundingPlan.shortfall)} beyond every account available, or lower the buffer`);
  } else if (gap) {
    missionParts.push(`cover the ${money(fundingGap)} timing gap by ${fmtDateLong(gap.date)}`);
  }
  if (overToday.length) missionParts.push(`get the ${overToday.map(x => x.label).join(' and ')} back under its limit`);
  missionParts.push(`hold spending to ${money(weekly)} a week`);
  if (helocBreach) missionParts.push(`and stop the HELOC growing before it passes its own limit in ${fmtMonth(helocBreach.date)}`);
  else missionParts.push('and put the surplus against the most expensive card');
  $('plan-mission').textContent =
    missionParts.join(', ').replace(/^./, c => c.toUpperCase()) + '.';

  /* ---- NEXT MOVE — the one thing to do ---- */
  const first = plan.actions[0];
  if (first) {
    const overdue = first.due && first.due < asOf && first.status !== 'done';
    // This action's amount is a fixed figure in the data, sized for the default
    // buffer. Whether completing it restores anything depends on how it
    // compares with the CURRENT gap, not on whether some plan exists.
    const actionCovers = gap && first.amount != null && first.amount + 0.005 >= fundingGap;
    const actionLeaves = gap && first.amount != null ? fundingGap - first.amount : 0;
    const after = gap && fundingShort
      // Only part of the gap can be funded, so promising a restored buffer
      // would be describing an outcome the figures do not produce.
      ? `Even with everything available moved across, ${money(fundingPlan.shortfall)} of the
         ${money(fundingGap)} stays unfunded and the balance holds below the ${money(sim.buffer)} buffer.
         This action helps; on its own it is not enough.`
      : gap && !actionCovers
        // Fundable, but not by this action alone.
        ? `This covers ${money(first.amount)} of the ${money(fundingGap)} needed, leaving
           ${money(actionLeaves)} still to find before the ${money(sim.buffer)} buffer is back.
           ${fundingPlan && fundingPlan.needsCombination
            ? `The full plan is ${fundingPlan.parts.map(p => `${money2(p.amount)} from ${p.short}`).join(' plus ')}.`
            : ''} With all of it in place the household can spend ${money(weekly)} a week from
           ${fmtDateLong(advice.effectiveFrom)}.`
      : gap && first.due && first.due <= gap.date
        ? `The ${money(gap.dueOnGapDay)} clears on ${fmtDateLong(gap.date)}, the buffer is restored, and from
           ${fmtDateLong(advice.effectiveFrom)} the household can spend ${money(weekly)} a week.`
        : `The window finishes with ${money(sim.ending)} instead of breaching the ${money(sim.buffer)} buffer.`;
    $('nextmove-card').innerHTML = `
      <div class="nm-head">
        <span class="nm-what">${first.what}</span>
        <span class="nm-amt">${first.amount != null ? money2(first.amount) : ''}</span>
      </div>
      <div class="nm-meta">
        ${first.due ? `<span class="chip ${overdue ? 'c' : 'w'}">due ${fmtDateLong(first.due)}</span>` : ''}
        ${first.owner ? `<span class="chip">${first.owner}</span>` : ''}
        <span class="chip ${first.status === 'done' ? 'v' : 'e'}">${first.status}</span>
      </div>
      <div class="nm-why"><b>Why</b><p>${first.why}</p></div>
      <div class="nm-after"><b>What happens after</b><p>${after}</p></div>`;
  }

  // The condition attached to the weekly cap, written ONCE. It appeared on
  // both the Today tile and the cap headline, and fixing the headline alone
  // left the tile describing a simulation that was not the one it showed.
  const capIfCovered = (gap && fundingShort)
    ? Forecast.recommend(plan, asOf, simOpts({
        fundingSources: [{ id: 'hypothetical', label: 'full coverage', short: 'full coverage',
          available: Infinity, debtId: null, rank: 0 }],
      })).weekly
    : null;
  const capQualifier = !gap
    ? 'under the expected scenario'
    : fundingShort
      ? `from ${fmtDateLong(advice.effectiveFrom)}, with only `
        + `${money(fundingGap - fundingPlan.shortfall)} of the ${money(fundingGap)} gap fundable. `
        + `Cover the whole gap and it becomes ${money(capIfCovered)}/week`
      : `from ${fmtDateLong(advice.effectiveFrom)}, once the ${money(fundingGap)} gap is covered`;

  /* ---- the numbers that matter today ---- */
  // The next day money leaves, and ALL of it — two registrations on one day are
  // one payment as far as the account is concerned, and showing the larger of
  // them understates what has to be there.
  const outflows = sim.events.filter(e => e.amount < 0 && e.kind !== 'noncash' && e.date >= asOf);
  const nextOutDate = outflows.length
    ? outflows.reduce((a, e) => e.date < a ? e.date : a, outflows[0].date) : null;
  const nextDue = outflows.filter(e => e.date === nextOutDate);
  const nextCritical = nextDue.length ? {
    date: nextOutDate,
    amount: nextDue.reduce((s, e) => s + e.amount, 0),
    label: nextDue.length === 1 ? nextDue[0].label
      : `${nextDue.length} payments — ${nextDue[0].label.replace(/ —.*$/, '')} and others`,
  } : null;
  const consumerNow = today.consumer;
  $('hero-tiles').innerHTML = [
    { lab: 'Spendable household cash', val: money(plan.startingCash.amount), tone: 'alert',
      note: 'Chequing A, B and Savings. Amanda’s account is a separate pot.' },
    (nextCritical ? { lab: 'Next payment out', val: money(-nextCritical.amount),
      note: `${nextCritical.label} on ${fmtDateLong(nextCritical.date)}`,
      tone: nextCritical.date <= addDays(asOf, 3) ? 'warn' : '' } : null),
    { lab: 'Weekly household cap', val: money(weekly) + '/wk', tone: gap ? 'warn' : '',
      note: state.weeklyVariable != null && state.weeklyVariable !== recommended
        ? `your setting — the forecast supports ${money(recommended)}/wk`
        : gap
          ? `${capQualifier}. Food and fuel come out of this first.`
          : `≈ ${money(weekly * WEEKS_PER_MONTH)} a month. Food and fuel come out of this first.` },
    { lab: 'Essential variable need', val: money(perWeek(required)) + '/wk', tone: '',
      note: `groceries, fuel, phones and medical — ${money(perWeek(budget ? budget.categories
        .filter(c => c.id === 'groceries' || c.id === 'fuel')
        .reduce((a, c) => a + c.planned, 0) : 0))}/wk of it food and fuel` },
    { lab: 'Consumer debt', val: money(consumerNow), tone: overToday.length ? 'alert' : 'warn',
      note: `${money(today.headroom)} of credit left everywhere${overToday.length
        ? ` — ${overToday.length} facility over its limit` : ''}` },
  ].filter(Boolean).map(t => `
    <div class="tile ${t.tone}">
      <div class="lab">${t.lab}</div>
      <div class="val">${t.val}</div>
      <div class="note">${t.note}</div>
    </div>`).join('');

  const row = (label, val, cls = '', chip = '') =>
    `<div class="ledger-row ${cls}"><span>${label}${chip}</span><span>${val}</span></div>`;
  const chipC = ' <span class="chip v">confirmed</span>';
  const chipE = ' <span class="chip w">estimated</span>';

  /* ---- the weekly household cap, broken into what it is actually for ---- */
  if (budget) {
    const food = budget.categories.find(c => c.id === 'groceries');
    const fuelCat = budget.categories.find(c => c.id === 'fuel');
    // When the gap can only be partly funded, this figure is the cap for THAT
    // situation — not for a covered gap. Saying "once the gap is covered"
    // beside it attached the condition of one simulation to the answer of
    // another, so the full-coverage figure is computed and shown separately.
    $('cap-headline').innerHTML =
      `<span class="cap-amt">${money(weekly)}</span><span class="cap-per">/ week</span>
       <span class="cap-qual">${capQualifier}</span>`;
    const part = (lab, amount, kind, note) => `
      <div class="cap-part ${kind}">
        <div class="cap-part-lab">${lab}</div>
        <div class="cap-part-amt">${est(money(perWeek(amount)))}<span>/wk</span></div>
        <div class="cap-part-note">${note}</div>
      </div>`;
    $('cap-split').innerHTML =
      part('Essential variable need', required, 'essential',
        `Groceries ${money(perWeek(food.planned))}, fuel ${money(perWeek(fuelCat.planned))}` +
        `${food.target != null ? ' <span class="chip v">owner budget</span>' : ''}, plus phones, ` +
        `household supplies, medical and the uncategorised remainder. <b>This comes out first.</b>`) +
      part('Discretionary room', Math.max(0, recMonthly - required), 'optional',
        short > 0
          ? `<b class="neg">Nothing.</b> The cap is below what normal life costs.`
          : `Everything else — dining out, personal, subscriptions, sports and online spending. The household's ` +
            `own budget for those comes to ${money(perWeek(budget.discretionaryMonthly))}/wk, so the plan is ` +
            `${money(perWeek(budget.discretionaryMonthly) - perWeek(Math.max(0, recMonthly - required)))}/wk ` +
            `short of it and something has to give.`) +
      `<div class="cap-part total">
        <div class="cap-part-lab">Total</div>
        <div class="cap-part-amt">${money(weekly)}<span>/wk</span></div>
        <div class="cap-part-note">≈ ${money(recMonthly)} a month</div>
      </div>`;
    const owned = budget.ownerTargetCount;
    $('cap-basis').innerHTML =
      `Solved from the forecast: the largest weekly spend that keeps every day at or above the ${money(sim.buffer)} ` +
      `buffer. The split below it uses the <b>household's own budget targets</b> for ${owned} categories — ` +
      `groceries, fuel, dining, personal, subscriptions, dog food, sports, household and medical — and ` +
      `${budget.months} months of actual spending for the rest, with anything already dated on the calendar ` +
      `removed from its own category. <b>Food and fuel come out of this number first</b>: the household budgets ` +
      `${money(food.target || food.historical)} and ${money(fuelCat.target || fuelCat.historical)} a month for them. ` +
      `The ${money(budget.sinkingMonthly)}/month of lacrosse fees is dated on the calendar and saved for separately, ` +
      `so it is not inside this cap and does not reduce the ordinary sports line.`;
  }

  /* ---- the next fourteen days ---- */
  const horizon = addDays(asOf, 13);
  const near = sim.events
    .filter(e => e.date >= asOf && e.date <= horizon && Math.abs(e.amount) >= 50)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
  $('agenda-14').innerHTML = near.length ? near.map(e => `
    <div class="ag14 ${e.amount > 0 ? 'in' : 'out'}${e.date === (gap && gap.date) ? ' ag14-key' : ''}">
      <span class="ag14-date">${fmtDate(e.date)}</span>
      <span class="ag14-amt ${e.amount > 0 ? 'pos' : 'neg'}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount)).slice(1)}</span>
      <span class="ag14-lab">${e.label}</span>
      <span class="ag14-conf"><span class="chip ${e.confidence === 'confirmed' ? 'v'
        : e.confidence === 'estimated' ? 'w' : ''}">${e.confidence}</span></span>
    </div>`).join('') : '<p class="lede">Nothing of $50 or more falls in the next fortnight.</p>';
  $('agenda-14-note').innerHTML =
    `Movements of $50 or more only. ${gap ? `The highlighted row is the day the gap has to be covered by. ` : ''}` +
    `The rest of the window is behind <b>View full 90-day calendar</b> below.`;

  /* ---- the 90-day scoreboard ---- */
  const scoreCols = debtProj.marks.filter(m => [0, 30, 60, 90].includes(m.day));
  const scoreRow = (label, get, fmt, tone) => `<tr>
      <td>${label}</td>${scoreCols.map(m => {
    const v = get(m);
    return `<td class="num ${tone ? tone(v, m) : ''}">${fmt(v, m)}</td>`;
  }).join('')}</tr>`;
  $('score-table').innerHTML = `<thead><tr>
      <th>Measure</th>${scoreCols.map(m =>
    `<th class="num">${m.day === 0 ? 'Today' : 'Day ' + m.day}<div class="mutedtext">${fmtDate(m.date)}</div></th>`).join('')}
    </tr></thead><tbody>
    ${scoreRow('Spendable cash', m => cashOn(m.date), v => money(v), v => v < sim.buffer ? 'neg' : '')}
    ${scoreRow('Consumer card debt', m => m.consumer, v => money(v))}
    ${scoreRow('HELOC', m => m.heloc, v => money(v))}
    ${scoreRow('Revolving credit left', m => m.headroom, v => money(v), v => v < 500 ? 'neg' : '')}
    ${scoreRow('Facilities over limit', m => m.overLimitCount, v => v === 0 ? '—' : String(v), v => v > 0 ? 'neg' : '')}
    ${scoreRow('Interest incurred', m => m.interestToDate, v => v === 0 ? '—' : money(v))}
    </tbody>`;
  // Same figures, stacked, for a screen too narrow to hold four columns.
  $('score-cards').innerHTML = scoreCols.map(m => {
    const cash = cashOn(m.date);
    const line = (lab, val, neg) =>
      `<div class="score-row ${neg ? 'neg' : ''}"><span>${lab}</span><span>${val}</span></div>`;
    return `<div class="score-card">
      <div class="score-card-head">
        <span class="score-card-when">${m.day === 0 ? 'Today' : 'Day ' + m.day}</span>
        <span class="score-card-date">${fmtDateLong(m.date)}</span>
      </div>
      ${line('Spendable cash', money(cash), cash < sim.buffer)}
      ${line('Consumer card debt', money(m.consumer))}
      ${line('HELOC', money(m.heloc))}
      ${line('Revolving credit left', money(m.headroom), m.headroom < 500)}
      ${line('Facilities over limit', m.overLimitCount === 0 ? 'none' : String(m.overLimitCount), m.overLimitCount > 0)}
      ${line('Interest incurred', m.interestToDate === 0 ? '—' : money(m.interestToDate))}
    </div>`;
  }).join('');

  $('score-note').innerHTML =
    (gap && fundingPlan ? `Assumes the opening gap is covered by ` +
      `<b>${fundingPlan.parts.map(p => `${money2(p.amount)} from ${p.short}`).join(' plus ')}</b>` +
      (fundingPlan.borrowed > 0
        ? `, of which <b>${money2(fundingPlan.borrowed)} is borrowed</b> and is carried on the debt lines below`
        : `, none of which is borrowed`) +
      (fundingPlan.shortfall > 0
        ? `. ${money2(fundingPlan.shortfall)} of it could not be funded at all, so these figures are the best
           case available rather than a plan that holds` : '') + `. ` : '') +
    `Cash is <b>projected</b> under the ${state.scenario} scenario at ${money(weekly)}/week; debt balances are ` +
    `projected from today's rates with minimums paid and <b>no new card spending</b> — the cap is a cash instruction, ` +
    `and these lines only fall if it is honoured in cash. None of these is a target: no aspirational payoff figure ` +
    `is assumed anywhere. Interest incurred is cumulative across every debt including the mortgage.`;

  /* ---- the three phases, derived from what the numbers do ---- */
  const d30 = mark(30), d60 = mark(60);
  const phase = (range, title, body) =>
    `<div class="phase"><div class="phase-range">${range}</div>
      <div class="phase-title">${title}</div><p>${body}</p></div>`;
  $('phases').innerHTML =
    phase('0–30 days', gap ? 'Cover the gap and stabilise'
      : 'Hold the buffer',
      gap && fundingShort
        ? `Every usable source combined leaves ${money(fundingPlan.shortfall)} of the ${money(fundingGap)}
           unfunded. Lower the buffer, move a commitment, or find money outside these accounts.`
      : gap ? `Get ${money(fundingGap)} across by ${fmtDateLong(gap.date)}, then hold ${money(weekly)}/week.
             Cash recovers to ${money(cashOn(d30.date))} by ${fmtDate(d30.date)}.`
          : `Hold ${money(weekly)}/week. Cash sits at ${money(cashOn(d30.date))} by ${fmtDate(d30.date)}.`) +
    phase('31–60 days', overToday.length ? 'Get back inside the limits' : 'Relieve revolving pressure',
      `Consumer debt moves ${money(Math.abs(d60.consumer - today.consumer))}
       ${d60.consumer < today.consumer ? 'down' : 'up'} to ${money(d60.consumer)}, and credit left across every
       facility is ${money(d60.headroom)}.${helocBreach && helocBreach.day <= 60
        ? ` The HELOC passes its own limit in this phase — its interest capitalises with nothing repaying it.` : ''}`) +
    phase('61–90 days', day90.consumer < today.consumer ? 'Put the surplus against principal' : 'Stop the growth',
      `Cash finishes at ${money(sim.ending)} against a ${money(sim.buffer)} buffer.
       ${plan.nextDollar ? plan.nextDollar.summary : ''}`);

  /* ---- what the ending cash is actually for ---- */
  const reserves = budget ? budget.reserveMonthly * (plan.windowDays / (365.25 / 12)) : 0;
  const unallocated = sim.ending - sim.buffer - reserves;
  $('priorities-ledger').innerHTML =
    row('Projected cash on ' + fmtDateLong(sim.end), money2(sim.ending), 'sum') +
    row('− Target buffer', '− ' + money2(sim.buffer)) +
    row('− Reserves accrued but not yet due <span class="mutedtext">property tax, CRA</span>',
      '− ' + est(money2(reserves)), '', chipE) +
    row('<b>= Unallocated</b>', `<b class="${unallocated < 0 ? 'neg' : ''}">${money2(unallocated)}</b>`, 'sum');
  $('priorities-note').innerHTML = unallocated <= 0
    ? `There is no free cash at the end of this window. What looks like a surplus is the buffer and the money
       already owed to costs that fall outside the 90 days.`
    : `<b>This is not spending money.</b> It is what is left after the buffer and the reserves, and it is the only
       money available to reduce debt. ${plan.nextDollar ? plan.nextDollar.summary : ''}`;

  /* ---- what could break the plan ---- */
  const risks = [];
  if (transferMonthly > 0) {
    risks.push({ what: `Amanda's transfers — ${money(transferMonthly)}/month is an estimate, not a commitment`,
      change: neededBy
        ? `The plan needs the first one by ${fmtDateLong(neededBy)}. Without any of them the window ends
           ${money(transferMonthly * 3)} lower and breaches the buffer.`
        : `The window holds even without them, but the ending cash falls by about ${money(transferMonthly * 3)}.` });
  }
  const estimatedCommitments = plan.commitments.filter(c => c.confidence === 'estimated'
    && !state.disabled.includes(c.id));
  if (estimatedCommitments.length) {
    const total = estimatedCommitments.reduce((s, c) => s + c.amount, 0);
    risks.push({ what: `${estimatedCommitments.length} sports commitments totalling ${money(total)} are estimates`,
      change: `${estimatedCommitments.map(c => c.label).join(', ')}. None is invoiced yet. If they land higher, or
               earlier than assumed, the weekly cap falls.` });
  }
  if (helocBreach) {
    const drawOption = ((plan.funding || {}).options || []).find(o => o.debtId === 'heloc' && !o.unusable);
    let alt = '';
    if (drawOption && gap && !fundingIsDraw) {
      // What the fallback would actually cost, run through the same engine
      // rather than asserted — if the numbers move, this sentence moves.
      const drawn = Forecast.projectDebts(plan, d.debts, asOf, Object.assign({},
        Forecast.recommend(plan, asOf, simOpts({ fundingDebtId: 'heloc' })).simOptions,
        { weeklyVariable: weekly }));
      const drawnCross = (drawn.crossings || []).find(c => c.id === 'heloc' && !c.alreadyOver);
      if (drawnCross) {
        alt = ` Covering the opening gap from it instead of ${fundingSource ? fundingSource.short : 'her account'}
                brings that crossing forward to <b>${fmtDateLong(drawnCross.date)}</b>.`;
      }
    }
    const helocDrawn = fundingPlan
      ? fundingPlan.parts.filter(p => p.debtId === 'heloc').reduce((a, p) => a + p.amount, 0) : 0;
    risks.push({ what: helocDrawn > 0
      ? `The HELOC passes its own limit on ${fmtDateLong(helocBreach.date)}, and this plan draws ${money(helocDrawn)} on it`
      : `The HELOC passes its own limit on ${fmtDateLong(helocBreach.date)} with no new borrowing`,
      change: `Its ${money(plan.obligations.find(o => o.id === 'heloc').amount)}/month interest capitalises and
               nothing repays it, so the balance grows on its own.${helocDrawn > 0
        ? ` The ${money(helocDrawn)} this plan draws to cover the opening gap brings that date forward, and the
            crossing date shown already includes it.` : alt}` });
  }
  // From the crossings list, which records the day it actually happens, rather
  // than from a 30-day snapshot — a facility can cross and be paid back under
  // between two marks and never appear in either.
  const crossLater = (debtProj.crossings || []).filter(c =>
    !c.alreadyOver && c.id !== 'heloc');   // the HELOC is named above
  for (const c of crossLater) {
    risks.push({ what: `${c.label} goes over its limit on ${fmtDateLong(c.date)}`,
      change: `Its minimum barely exceeds its interest, so the balance sits against the limit and crosses it
               in the days before each payment. Each crossing risks an over-limit fee on top of the interest,
               which raises the card's effective rate above its headline one.` });
  }
  const telecom = budget && budget.categories.find(c => c.id === 'telecom');
  if (telecom && telecom.planned > 0) {
    risks.push({ what: `The Telus bills have no known route — ${money(telecom.planned)}/month`,
      change: `Absent from every captured account since March 2026. They are carried inside the cap, but if they are
               being paid from somewhere not captured the real household cost is higher than shown.` });
  }
  risks.push({ what: 'The cap assumes spending is paid in cash, not put on the cards',
    change: `The historical averages behind the split include card purchases. Spending at the same rate on the cards
             would leave the cash line looking healthy while the balances grew — the projection above assumes no new
             card spending at all.` });
  $('risk-list').innerHTML = risks.map(r => `
    <div class="risk">
      <div class="risk-what">${r.what}</div>
      <p class="risk-change">${r.change}</p>
    </div>`).join('');

  /* ---- how this was calculated ---- */
  if ($('assumption-list')) {
    $('assumption-list').innerHTML = (plan.assumptions || []).map(a => `<li>${a}</li>`).join('');
  }

  /* ---- the ledger ---- */
  const T = sim.totals;
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
      `${budget.ownerTargetCount} of these categories use the household's own budget target and the rest are ` +
      `historical actuals; each row shows which, and the average it is being measured against.`;
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
        <span class="cat-lab">${c.label} ${chipFor(c)}${c.target != null
          ? ' <span class="chip v">owner budget</span>' : ''}${c.fullyDated
          ? ' <span class="chip v">on the calendar</span>' : ''}${c.sinking > 0
          ? ' <span class="chip w">sinking fund</span>' : ''}</span>
        <span class="cat-bar"><span style="width:${(c.historical / max) * 100}%"></span></span>
        <span class="cat-amt">${c.class === 'reserve'
          ? '<span class="mutedtext">reserve</span>'
          : c.planned > 0 ? est(money(c.planned)) : '<span class="mutedtext">$0</span>'}</span>
        <span class="cat-hist">${c.target != null
          ? `budgeted ${money(c.target)}, has been ${money(c.historical)}`
          : `has been ${money(c.historical)}`}/mo${c.dated > 0
          ? ` · ${money(c.dated)} dated` : ''}${c.sinking > 0
          ? ` · ${money(c.sinking)} saved for separately` : ''}</span>
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
  // The first action is the next move and is rendered separately, above.
  if (plan.actionsNote) $('actions-note').textContent = plan.actionsNote;
  $('actions-list').innerHTML = plan.actions.slice(1, 5).map((a, i) => {
    const overdue = a.due && a.due < asOf && a.status !== 'done';
    return `<div class="action ${a.status === 'done' ? 'done' : ''}">
      <div class="action-n">${i + 2}</div>
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
  // The same day-zero figure the tile above shows. Summing raw balances here
  // reported $29,842.83 under the identical "Consumer debt" label while the
  // tile said $30,090.01 — the $247.18 of pending charges, twice on one page.
  const consumer = today.consumer;
  const secured = d.debts.filter(x => x.secured).reduce((s, x) => s + (x.balance || 0), 0);
  const monthlyInterest = d.debts.reduce((s, x) => s + (x.annualInterest || 0), 0) / 12;
  // Pending charges have already spent the credit they are charged against,
  // so headroom is derived with them included rather than from posted
  // balances alone — the Travel Visa reads $21.69 of room the other way.
  const revolving = Forecast.utilisation(d.debts, d.revolvingExtra).totalAvailable;
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
