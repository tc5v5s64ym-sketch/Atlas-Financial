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
  // The debt records and the policy target, so the engine can size an extra
  // payment against the debt that exists. Without them it spends whatever is
  // typed in: at $80,000/month the third payment drained $7,584.05 of cash
  // against balances already at zero. Held here so every call is governed —
  // passing them at one call site and not another is how the page ends up
  // showing two answers to the same question.
  debts: null,
  extraDebtTarget: null,
};
// ONLY these are persisted or restored. `state` also carries the debt records
// so the engine can size a payment against real balances, and serialising the
// whole object would write account balances and credit limits into
// localStorage — financial data, out from behind the authenticated gate and
// onto the disk of whatever machine the page was opened on. The list is
// explicit so adding a field to `state` cannot silently start persisting it.
const KNOBS = ['scenario', 'targetBuffer', 'extraDebtMonthly', 'weeklyVariable',
  'incomeOverrides', 'disabled'];
function loadKnobs(defaults) {
  state.scenario = defaults.scenario;
  state.targetBuffer = defaults.targetBuffer;
  state.extraDebtMonthly = defaults.extraDebtMonthly;
  try {
    const saved = JSON.parse(localStorage.getItem(KNOB_KEY) || 'null');
    // Only the knobs are restored. An older payload — or a tampered one — must
    // not be able to inject its own `debts` and have the page plan against
    // balances that never came from data.json.
    if (saved && typeof saved === 'object') {
      for (const k of KNOBS) if (saved[k] !== undefined) state[k] = saved[k];
    }
  } catch { /* storage unavailable */ }
}
function saveKnobs() {
  const out = {};
  for (const k of KNOBS) out[k] = state[k];
  try { localStorage.setItem(KNOB_KEY, JSON.stringify(out)); } catch { /* ignore */ }
}

function simOpts(extra = {}) {
  return Object.assign({
    scenario: state.scenario,
    targetBuffer: state.targetBuffer,
    extraDebtMonthly: state.extraDebtMonthly,
    incomeOverrides: state.incomeOverrides,
    disabled: state.disabled,
    debts: state.debts,
    extraDebtTarget: state.extraDebtTarget,
  }, extra);
}

const addDays = (iso, n) => Forecast.addDays(iso, n);
const fmtMonth = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { month: 'long' });
const est = s => `<span class="est">≈ ${s}</span>`;
const fmtRange = (a, b) => {
  const s = new Date(a + 'T00:00:00'), e = new Date(b + 'T00:00:00');
  const sm = s.toLocaleDateString('en-CA', { month: 'short' }), em = e.toLocaleDateString('en-CA', { month: 'short' });
  return sm === em ? `${s.getDate()}–${e.getDate()} ${em}` : `${s.getDate()} ${sm} – ${e.getDate()} ${em}`;
};

/* --------------------------------------------------- the mission, in words */
// `Forecast.mission` decides WHICH instructions the household is given and in
// what order. This map is all that is left here: how each one reads. Every
// entry is handed the part the engine produced and returns one clause, and
// nothing in it may choose whether a clause applies — that is the engine's.
//
// Adding an instruction to the engine without adding its wording here is a
// rendering failure, so `test-mission.js` checks that the two sides still name
// the same set of instructions.
const MISSION_PART = {
  fundingShortfall: p => `find ${money(p.shortfall)} beyond every account available, or lower the buffer`,
  coverGap: p => `cover the ${money(p.amount)} timing gap by ${fmtDateLong(p.by)}`,
  overLimit: p => `get the ${p.debts.map(x => x.label).join(' and ')} back under its limit`,
  cutSpending: p => `cut spending to ${money(p.supported)} a week — ${money(p.unsupported)} does not hold`,
  holdSpending: p => `hold spending to ${money(p.weekly)} a week`,
  helocLimit: p => `and stop the HELOC growing before it passes its own limit in ${fmtMonth(p.date)}`,
  surplusToCard: () => 'and put the surplus against the most expensive card',
};

/* ------------------------------------------------- the status band, in words */
// `Forecast.planStatus` decides WHICH of the seven verdicts the household reads
// at the top of this page, and picks every figure and date inside it. This map
// is all that is left here: the tone class and how each one reads.
//
// Nothing in it may test a figure against a threshold, compare two balances or
// select a date — those are the decisions that moved. The one comparison left
// is between two dates the engine already chose, and it only stops the sentence
// naming the same day twice.
//
// A verdict the engine can emit without wording here is a rendering failure, so
// `test-status-band.js` checks that the two sides still name the same set.
//
// Each entry is handed the engine's verdict and the `plan` block, the second
// only so the opening-gap sentence can print `startingCash` — a published fact
// straight from data.json, exactly as the funding lede below prints it.
const STATUS_BAND = {
  unfunded: { tone: 'crit', text: s =>
    `<b>Short by ${money(s.gapAmount)} on ${fmtDateLong(s.floorDate)}, and there is not enough
       anywhere to cover it.</b> Every usable source combined reaches
       ${money2(s.allocated)}, leaving
       <b>${money2(s.shortfall)}</b> unfunded at a ${money(s.buffer)} buffer. No weekly spending
       figure fixes this — lower the buffer, move a commitment, or find money outside these accounts.` },

  overrideBreach: { tone: 'crit', text: s =>
    `<b>${money(s.weekly)}/week does not work${s.goesNegative ? ' — the account goes negative' : ''}.</b>
       Even with the ${money(s.gapAmount)} gap covered, spending at your setting takes the balance to
       ${money(s.low)} by ${fmtDateLong(s.lowDate)}${s.firstBelowBuffer && s.firstBelowBuffer !== s.lowDate
      ? `, first slipping below the buffer on ${fmtDateLong(s.firstBelowBuffer)}` : ''}.
       The forecast supports <b>${money(s.recommended)}/week</b>.` },

  // Two openings, and the engine decides which is true — the allocation taking
  // two sources does not prove that none could have covered the gap alone.
  // Claiming the stronger one put this band in contradiction with the source
  // card below it, which reads its verdict from the same funding result.
  combination: { tone: 'crit', text: s =>
    `<b>Short by ${money(s.gapAmount)} on ${fmtDateLong(s.floorDate)}, and ${s.noSingleSourceCovers
      ? 'no single source covers it' : 'the plan draws on more than one source'}.</b>
       It takes ${s.parts.map(p => `${money2(p.amount)} from ${p.short}`).join(' plus ')}.
       ${s.borrowed > 0
      ? `<b>${money2(s.borrowed)} of that is borrowed</b>, and the debt figures below carry it.`
      : 'None of it is borrowed.'}
       Hold spending to ${money(s.weekly)}/week from ${fmtDateLong(s.effectiveFrom)} and the window
       finishes with ${money(s.ending)}.` },

  gap: { tone: 'crit', text: (s, plan) =>
    `<b>Short by ${money(s.gapAmount)} on ${fmtDateLong(s.floorDate)} — before any spending at all.</b>
       The household accounts hold ${money2(plan.startingCash.amount)} today and
       ${money(s.preIncomeOut)} of committed payments fall before the next payday.
       This is a timing gap, not a shortage across the 90 days: cover it, hold spending to
       ${money(s.weekly)}/week from ${fmtDateLong(s.effectiveFrom)}, and the window
       finishes with ${money(s.ending)}.` },

  negative: { tone: 'crit', text: s =>
    `<b>Shortfall expected around ${fmtDateLong(s.firstNegative)}.</b>
         At this spending level the account goes negative${s.firstNegative !== s.lowDate
      ? ` and keeps falling, reaching ${money(s.low)} by ${fmtDateLong(s.lowDate)}`
      : ` (${money(s.low)})`}.
         Cut the weekly budget, move a commitment, or bring income forward.` },

  belowBuffer: { tone: 'warn', text: s =>
    `<b>Tight — projected to dip to ${money(s.low)} on ${fmtDateLong(s.lowDate)}</b>,
      below the ${money(s.buffer)} target buffer, then recover to ${money(s.ending)} by ${fmtDate(s.end)}.` },

  onPlan: { tone: 'good', text: s =>
    `<b>On plan — projected to finish with ${money(s.ending)}.</b>
      The balance stays above the ${money(s.buffer)} buffer all the way through, with the low of
      ${money(s.low)} on ${fmtDateLong(s.lowDate)}.` },
};

/* ------------------------- the room against the household's own budget, said */
// Three outcomes, and `Forecast.budgetBreakdown` says which. The engine used to
// hand over a signed difference and this page rendered it as "short of it"
// whatever its sign, so a cap leaving MORE room than the household budgets
// published "the plan is −$28/wk short of it and something has to give".
// A magnitude and a verdict cannot be read the wrong way round.
const ROOM_VERSUS_HOUSEHOLD = {
  short: r => `so the plan is ${money(r.weekly)}/wk short of it and something has to give.`,
  meets: () => `which is what the plan leaves.`,
  exceeds: r => `and the plan leaves ${money(r.weekly)}/wk more than that.`,
};

/* ------------------------------- what the next move achieves, in words */
// `Forecast.nextMove` decides WHICH of the five outcomes the household reads
// under **What happens after**, and picks every figure inside it. This map is
// all that is left here: how each one reads.
//
// Nothing in it may compare the action's amount with the gap, subtract the two,
// or decide that a different outcome applies. Those are the decisions that
// moved — the page's `actionCovers` and `actionLeaves`, which carried their own
// copy of the engine's half-cent and chose between these five sentences where
// no test could reach them.
//
// An outcome the engine can emit without wording here is a rendering failure,
// so `test-nextmove.js` checks that the two sides still name the same set.
const NEXT_MOVE = {
  unfunded: s =>
    `Even with everything available moved across, ${money(s.shortfall)} of the
     ${money(s.gapAmount)} stays unfunded and the balance holds below the ${money(s.buffer)} buffer.
     This action helps; on its own it is not enough.`,

  partial: s =>
    `This covers ${money(s.actionAmount)} of the ${money(s.gapAmount)} needed, leaving
     ${money(s.remainder)} still to find before the ${money(s.buffer)} buffer is back.
     ${s.parts
    ? `The full plan is ${s.parts.map(p => `${money2(p.amount)} from ${p.short}`).join(' plus ')}.`
    : ''} With all of it in place the household can spend ${money(s.recommended)} a week from
     ${fmtDateLong(s.effectiveFrom)}${s.overrideUnsupported
      ? `, not the ${money(s.weekly)} currently set — that reaches ${money(s.low)}` : ''}.`,

  overrideBreach: s =>
    `The ${money(s.dueOnGapDay)} clears on ${fmtDateLong(s.gapDate)} and the buffer is restored — but
     at your ${money(s.weekly)}/week setting the balance still reaches ${money(s.low)} by
     ${fmtDateLong(s.lowDate)}. The forecast supports ${money(s.recommended)}/week.`,

  restored: s =>
    `The ${money(s.dueOnGapDay)} clears on ${fmtDateLong(s.gapDate)}, the buffer is restored, and from
     ${fmtDateLong(s.effectiveFrom)} the household can spend ${money(s.weekly)} a week.`,

  // Three clauses, and the engine decides which apply. The first said only
  // "instead of breaching the buffer", unconditionally, which is false of any
  // run that does breach — and a covering action that arrives too late now
  // lands here, so it has to say why the gap is not restored as well.
  windowEnding: s =>
    `${s.coversButLate
      ? `The ${money(s.actionAmount)} reaches the ${money(s.gapAmount)} needed, but it is not due until
         ${fmtDateLong(s.actionDue)} — after the ${money(s.dueOnGapDay)} has to clear on
         ${fmtDateLong(s.gapDate)}, so it does not restore the buffer in time. ` : ''
}The window finishes with ${money(s.ending)} ${s.breaches
    ? `after dipping to ${money(s.low)} on ${fmtDateLong(s.lowDate)}, below the ${money(s.buffer)} buffer`
    : `instead of breaching the ${money(s.buffer)} buffer`}.${s.overrideUnsupported
    ? ` That is at your ${money(s.weekly)}/week setting; the forecast supports ${money(s.recommended)}/week.`
    : ''}`,
};

/* --------------------------------------- the funding-source cards, in words */
// Whether a source covers the gap, contributes part of it, or cannot reach it
// is `Forecast.recommend`'s — it is the same allocation the plan is built on,
// seen per source. The page had its own `o.available >= needed` beside it, and
// the two disagreed on screen: these cards once read "Covers it" under a band
// saying nothing could. What is left here is the sentence and the class.
const FUND_VERDICT = {
  covers: { cls: 'fund-yes',
    text: (s, needed) => `<span class="ok">Covers the whole ${money(needed)}</span>` },
  contributes: { cls: 'fund-no',
    text: (s, needed) => `<span class="ok">Covers ${money2(s.contributes)} of the ${money(needed)}</span> <span class="mutedtext">— used in the plan, with the rest from elsewhere</span>` },
  insufficient: { cls: 'fund-no',
    text: (s, needed) => `<span class="no">Not enough — ${money(s.shortBy)} short of the ${money(needed)} needed</span>` },
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
  const advice = Forecast.recommend(plan, asOf, simOpts({ fundingSources: plan.funding && plan.funding.options }));
  const fundingPlan = advice.funding || null;
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

  // The engine owns the counterfactual deadline. The page only renders the
  // amount and date it is given; it no longer runs a second simulation or
  // decides which short day becomes a household deadline.
  const transferDependency = Forecast.incomeDeadline(plan, asOf, 'amandaTransfer',
    Object.assign({}, advice.simOptions, {
      weeklyVariable: weekly,
      incomeOverrides: state.incomeOverrides,
      notBefore: gap ? gap.date : asOf,
    }));
  const transferMonthly = transferDependency.amount;
  const neededBy = transferDependency.neededBy;

  $('plan-window').textContent =
    `The 13 weeks from ${fmtDateLong(asOf)} to ${fmtDateLong(sim.end)} — every figure below is derived from this window.`;

  /* ---- status band ---- */
  // WHICH of the seven verdicts the household reads, and every figure and date
  // inside it, is a financial decision and belongs to Forecast.planStatus —
  // where the node suite can reach it. This page looks the wording up and
  // renders it. It no longer re-derives `fundingShort`, hand-copies the
  // engine's buffer comparison and epsilon, walks the daily balances for a
  // first-breach or first-negative date, or totals the funding parts.
  const status = Forecast.planStatus(advice,
    { weeklyOverride: state.weeklyVariable, sim });
  const band = $('status-band');
  band.className = 'statusband ' + STATUS_BAND[status.id].tone;
  band.innerHTML = STATUS_BAND[status.id].text(status, plan);

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

    // The engine ranked the sources and judged each one against the gap, as
    // part of the same allocation the plan is built on. The page joins each
    // verdict back to its own label, rate and note — copy that lives in
    // data.json — and renders. It decides nothing: no comparison against the
    // amount needed, no per-source shortfall arithmetic, no second sort.
    const copyFor = new Map(plan.funding.options.map(o => [o.id, o]));
    $('funding-options').innerHTML = fundingPlan.sources
      .map(s => {
        const o = copyFor.get(s.id);
        const verdict = FUND_VERDICT[s.verdict];
        return `<div class="fund ${verdict.cls}">
          <div class="fund-top">
            <span class="fund-lab">${o.label}</span>
            <span class="fund-amt">${money2(s.available)}${o.rate ? ` <span class="mutedtext">at ${pct(o.rate)}</span>` : ''}</span>
          </div>
          <div class="fund-verdict">${verdict.text(s, needed)}</div>
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

  // The alternative assumptions, decided and evaluated by the engine. This page
  // used to build both: a funding source holding `available: Infinity` for "if
  // the gap were covered", and `fundingDebtId: 'heloc'` plus its own second
  // `recommend` and `projectDebts` for the HELOC fallback. It now asks once and
  // renders what comes back. It does not choose a source, name a facility,
  // restate the scenario, or decide whether either answer is worth showing.
  const alternatives = Forecast.counterfactuals(plan, asOf, advice, debtProj, {
    debts: d.debts, extraFacilities: d.revolvingExtra, weekly });
  const ifCovered = alternatives.fullGapCoverage;

  const cashOn = date => {
    const p = sim.daily.find(x => x.date === date);
    return p ? p.balance : plan.startingCash.amount;
  };
  const mark = n => debtProj.marks.find(m => m.day === n) || debtProj.marks[debtProj.marks.length - 1];
  const today = mark(0), day90 = debtProj.marks[debtProj.marks.length - 1];

  // The engine owns every weekly↔monthly conversion and the cap-versus-need
  // conclusion. It is told which weekly figure is actually on screen — the
  // household's own setting when there is one, the recommendation otherwise —
  // because measuring the budget against a figure the page is not showing
  // describes a plan nobody is looking at. This page divides nothing.
  const budget = Forecast.budgetBreakdown(plan, periods, {
    paypalPerMonth: d.paypal ? d.paypal.perMonth : 0,
    disabled: state.disabled,
    weeklyCap: weekly,
    recommendedWeekly: recommended,
  });
  const cap = budget ? budget.cap : null;
  const capMonthly = Forecast.monthlyFromWeekly(weekly);

  // Facilities over their limit today, and the day the HELOC crosses its own —
  // read here for the debt tile, the phases and the HELOC card below. The
  // mission no longer selects from either: the engine decides that, from this
  // same debt walk, so the two cannot disagree.
  const overToday = today.debts.filter(x => x.overLimit);
  const helocBreach = (debtProj.crossings || [])
    .find(c => c.id === 'heloc' && !c.alreadyOver) || null;

  /* ---- the mission, in one sentence ---- */
  // WHICH instructions apply, and in what order, is a financial decision and
  // belongs to Forecast.mission — where the node suite can reach it. This page
  // renders the parts it is given, in the order it is given them.
  const missionResult = Forecast.mission(advice, debtProj,
    { weeklyOverride: state.weeklyVariable, sim });
  $('plan-mission').textContent = missionResult.parts
    .map(p => MISSION_PART[p.id](p)).join(', ')
    .replace(/^./, c => c.toUpperCase()) + '.';

  /* ---- NEXT MOVE — the one thing to do ---- */
  // WHICH of the five outcomes the household reads under "What happens after",
  // and every figure inside it, is a financial decision and belongs to
  // Forecast.nextMove — where the node suite can reach it. This page looks the
  // wording up and renders it. It no longer compares the action's fixed amount
  // against the current gap with its own copy of the engine's half-cent,
  // subtracts the two for the uncovered remainder, or selects a different
  // outcome from the status verdict, the due date or the funding plan.
  const move = Forecast.nextMove(plan, advice,
    { weeklyOverride: state.weeklyVariable, sim });
  if (move) {
    // The action the engine measured, so the head and the outcome below it
    // cannot describe different actions.
    const first = move.action;
    // Presentation: which of two chip colours the due date wears. It moves no
    // figure and selects no sentence.
    const overdue = first.due && first.due < asOf && first.status !== 'done';
    const after = NEXT_MOVE[move.id](move);
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
  const capQualifier = !gap
    ? 'under the expected scenario'
    : ifCovered.applies
      ? `from ${fmtDateLong(advice.effectiveFrom)}, with only `
        + `${money(ifCovered.fundable)} of the ${money(ifCovered.gapAmount)} gap fundable. `
        + `Cover the whole gap and it becomes ${money(ifCovered.weekly)}/week`
      : `from ${fmtDateLong(advice.effectiveFrom)}, once the ${money(fundingGap)} gap is covered`;

  /* ---- the numbers that matter today ---- */
  // WHICH day cash leaves next, and the total that has to be there, is a
  // financial decision and belongs to Forecast.nextPaymentOut — where the
  // node suite can reach it. This page prints the date, the amount and the
  // label it is given. The 3-day chip is presentation: it moves no figure
  // and selects no day.
  const nextOut = Forecast.nextPaymentOut(sim.events, asOf);
  const consumerNow = today.consumer;
  $('hero-tiles').innerHTML = [
    { lab: 'Spendable household cash', val: money(plan.startingCash.amount), tone: 'alert',
      note: 'Chequing A, B and Savings. Amanda’s account is a separate pot.' },
    (nextOut ? { lab: 'Next payment out', val: money(nextOut.amount),
      note: `${nextOut.label} on ${fmtDateLong(nextOut.date)}`,
      tone: nextOut.date <= addDays(asOf, 3) ? 'warn' : '' } : null),
    { lab: 'Weekly household cap', val: money(weekly) + '/wk', tone: gap ? 'warn' : '',
      note: state.weeklyVariable != null && state.weeklyVariable !== recommended
        ? `your setting — the forecast supports ${money(recommended)}/wk`
        : gap
          ? `${capQualifier}. Food and fuel come out of this first.`
          : `≈ ${money(capMonthly)} a month. Food and fuel come out of this first.` },
    { lab: 'Essential variable need', val: money(budget ? budget.cap.essentialWeekly : 0) + '/wk', tone: '',
      note: `groceries, fuel, phones and medical — ${money(budget
        ? budget.cap.foodFuelPlannedWeekly : 0)}/wk of it food and fuel` },
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
    // Both are read for their MONTHLY targets, printed as they arrive. The
    // per-week figures beside them come from the engine.
    const food = budget.categories.find(c => c.id === 'groceries');
    const fuelCat = budget.categories.find(c => c.id === 'fuel');
    // When the gap can only be partly funded, this figure is the cap for THAT
    // situation — not for a covered gap. Saying "once the gap is covered"
    // beside it attached the condition of one simulation to the answer of
    // another, so the full-coverage figure is computed and shown separately.
    $('cap-headline').innerHTML =
      `<span class="cap-amt">${money(weekly)}</span><span class="cap-per">/ week</span>
       <span class="cap-qual">${capQualifier}</span>`;
    // Every amount here arrives per week from the engine. The page adds the
    // dollar sign and the /wk label and divides nothing.
    const part = (lab, weeklyAmount, kind, note) => `
      <div class="cap-part ${kind}">
        <div class="cap-part-lab">${lab}</div>
        <div class="cap-part-amt">${est(money(weeklyAmount))}<span>/wk</span></div>
        <div class="cap-part-note">${note}</div>
      </div>`;
    $('cap-split').innerHTML =
      part('Essential variable need', cap.essentialWeekly, 'essential',
        `Groceries ${money(cap.groceriesPlannedWeekly)}, fuel ${money(cap.fuelPlannedWeekly)}` +
        `${food.target != null ? ' <span class="chip v">owner budget</span>' : ''}, plus phones, ` +
        `household supplies, medical and the uncategorised remainder. <b>This comes out first.</b>`) +
      part('Discretionary room', cap.discretionaryRoomWeekly, 'optional',
        !cap.hasDiscretionaryRoom
          ? `<b class="neg">Nothing.</b> The cap is below what normal life costs.`
          : `Everything else — dining out, personal, subscriptions, sports and online spending. The household's ` +
            `own budget for those comes to ${money(cap.householdDiscretionaryWeekly)}/wk, ` +
            ROOM_VERSUS_HOUSEHOLD[cap.roomVersusHousehold.verdict](cap.roomVersusHousehold)) +
      `<div class="cap-part total">
        <div class="cap-part-lab">Total</div>
        <div class="cap-part-amt">${money(weekly)}<span>/wk</span></div>
        <div class="cap-part-note">≈ ${money(cap.monthly)} a month</div>
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
      status.id === 'unfunded'
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
    // The engine decided whether funding the gap from this facility instead is
    // a real alternative and what it would cost. This page looks up the answer
    // for the facility it is already talking about — by the id the engine gave
    // it — and puts the result into words. It selects no source, runs no second
    // scenario, and judges nothing: when the alternative does not apply there
    // is simply no sentence, whatever the reason was.
    const drawAlt = alternatives.gapFundingAlternatives
      .find(a => a.debtId === helocBreach.id) || null;
    const alt = drawAlt && drawAlt.applies
      ? ` Covering the opening gap from it instead of ${drawAlt.displaces.join(' and ')}
          brings that crossing forward to <b>${fmtDateLong(drawAlt.alternateCrossing.date)}</b>.`
      : '';
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
    // Without this row the rows below do not add up to the ending balance —
    // they reconciled to $3,946.04 against an ending of $4,989.20, the
    // difference being gap funding that was in the arithmetic and not on the
    // page. It is not income: it is money moved in to cover the opening gap.
    (T.injections > 0
      ? row(`Gap funding <span class="mutedtext">${fundingPlan
          ? fundingPlan.parts.map(p => p.short).join(' + ') : 'moved in'}</span>`,
        '+ ' + money2(T.injections), 'in', ' <span class="chip">not income</span>')
      : '') +
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
  const anyInjection = sim.weeks.some(w => w.injections > 0);
  const wkRow = w => {
    const cls = w.negative ? 'wk-neg' : w.belowBuffer ? 'wk-low' : '';
    const fixed = w.obligations + w.bills;
    return `<tr class="${cls}">
      <td>W${w.n}<div class="mutedtext">${fmtRange(w.start, w.end)}</div></td>
      <td class="num">${money(w.opening)}</td>
      <td class="num">${w.confirmedIncome ? '+' + money(w.confirmedIncome).slice(1) : '—'}</td>
      <td class="num">${w.estimatedIncome ? est('+' + money(w.estimatedIncome).slice(1)) : '—'}</td>
      ${anyInjection ? `<td class="num">${w.injections
        ? '+' + money(w.injections).slice(1) : '—'}</td>` : ''}
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
  // Without this column week 1 opens at $79.84, its visible rows imply a
  // $1,695.58 close and it displays $2,738.74 — the same unreconcilable gap
  // the aggregate ledger had, one level down.
  const fundCol = anyInjection ? '<th class="num">Gap funding</th>' : '';
  $('wk-table').innerHTML = `<thead><tr>
      <th>Week</th><th class="num">Opening</th><th class="num">Confirmed in</th><th class="num">Estimated in</th>${fundCol}
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
        <span>In ${money(w.confirmedIncome)}${w.estimatedIncome ? ` <span class="est">+ ≈${money(w.estimatedIncome).slice(1)}</span>` : ''}${w.injections ? ` + ${money(w.injections)} funding` : ''}</span>
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
    $('budget-out').innerHTML =
      row('<b>Weekly household cap</b>', `<b>${money(weekly)} / week</b>`) +
      row('&nbsp;&nbsp;— as a monthly figure', `${money(cap.monthly)} / month`) +
      row('Essential variable need <span class="mutedtext">groceries, fuel, phones, medical</span>',
        est(money(cap.essentialWeekly) + ' / week'), 'out', chipE) +
      row(cap.hasDiscretionaryRoom ? 'Discretionary room' : '<b class="neg">Discretionary room</b>',
        cap.hasDiscretionaryRoom
          ? money(cap.discretionaryRoomWeekly) + ' / week'
          : '<b class="neg">nothing left</b>') +
      row('&nbsp;&nbsp;— of which groceries and fuel',
        est(money(cap.foodFuelPlannedWeekly) + ' / week'), '', chipE) +
      row('Planned extra debt payment', money(state.extraDebtMonthly) + ' / month') +
      row('Required buffer at the end', money(sim.buffer)) +
      (!cap.hasDiscretionaryRoom
        ? `<p class="warnline">The cap is ${money(cap.essentialShortfallWeekly)}/week <b>below</b> what normal life has been costing.
           Groceries and fuel alone have run ${money(cap.foodFuelHistoricalWeekly)}/week. At this income the
           window only works by cutting essentials, moving a commitment, or borrowing — that is the real message of this number.</p>`
        : `<p class="warnline">Read this as: <b>${money(cap.essentialWeekly)}/week is spoken for</b> before anything optional —
           ${money(cap.foodFuelPlannedWeekly)} of it groceries and fuel. The remaining
           ${money(cap.discretionaryRoomWeekly)}/week is the whole of dining out, shopping, entertainment and online spending, against the
           ${money(cap.householdDiscretionaryWeekly)}/week those have actually been running at.</p>`);

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

    // Derived, not named in prose — the sentence used to say "insurance and
    // children's sports", and sports stopped being $0 when sinking funds were
    // separated out.
    const fullyDatedNames = budget.categories.filter(c => c.fullyDated).map(c => c.label);
    $('budget-cats-note').textContent =
      `The right-hand figure is what each category has averaged; the amount before it is what has to come out of the ` +
      `weekly cap once anything already dated on the calendar is removed. Those add to ${money(cap.inCapMonthly)}/month against a ` +
      `cap of ${money(cap.monthly)}/month, so ${money(cap.overCapMonthly)}/month has to come off — and it ` +
      `cannot come off the essential rows, which are ${money(budget.requiredMonthly)}/month on their own. ` +
      (fullyDatedNames.length
        ? `${fullyDatedNames.join(' and ')} show${fullyDatedNames.length === 1 ? 's' : ''} $0 because ` +
          `${fullyDatedNames.length === 1 ? 'it is' : 'they are'} fully dated on the calendar, not because ` +
          `${fullyDatedNames.length === 1 ? 'it is' : 'they are'} free.`
        : '') +
      (budget.sinkingMonthly > 0
        ? ` The ${money(budget.sinkingMonthly)}/month of season fees is saved for separately and is not ` +
          `netted off the ordinary sports line, which still carries its own budget.`
        : '');
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
  // Not knobs — canonical facts the engine needs to size a payment against the
  // debt that exists. Set after loadKnobs so a stale localStorage payload
  // cannot supply its own idea of what the household owes.
  state.debts = d.debts;
  state.extraDebtTarget = plan.nextDollar && plan.nextDollar.target;

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
