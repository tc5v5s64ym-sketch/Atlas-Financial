'use strict';
/* Shared core for every page — helpers, charts, theme, navigation, data boot.
   Page-specific rendering lives in plan.js, modellers.js, deepdive.js and
   records.js. All figures come from /data.json so updating the picture is a
   data edit. */

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => { const e = document.createElementNS(SVGNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = id => document.getElementById(id);

const money = n => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-CA');
const money2 = n => (n < 0 ? '−$' : '$') + Math.abs(Number(n)).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => n.toFixed(2) + '%';
const fmtDate = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { day: 'numeric', month: 'short' });
const fmtDateLong = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { day: 'numeric', month: 'long' });

/* ------------------------------------------------------------------ tooltip */
const tip = $('tip');
function showTip(e, html) {
  if (!tip) return;
  tip.innerHTML = html; tip.style.opacity = 1;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (x < 8) x = 8;
  if (y < 8) y = e.clientY + 18;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { if (tip) tip.style.opacity = 0; };
addEventListener('scroll', hideTip, { passive: true });

/* ------------------------------------------------------------------ charts */
// Every chart is an SVG scaled to its card. On a phone the card is half the
// width the charts were drawn for, so a 760-unit drawing would shrink its
// 13px labels to 6px. Below the phone breakpoint the charts redraw on a
// 380-unit canvas — same data, same encoding, labels that stay legible — and
// App re-renders when the viewport crosses that breakpoint.
const PHONE_MQ = '(max-width:640px)';
const isPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_MQ).matches;

function hbar(mount, data, opts = {}) {
  if (!mount) return;
  const phone = isPhone();
  const W = phone ? 380 : 760, padT = 6;
  const rowH = phone ? 48 : (opts.rowH || 40);
  // The label gutter grows to fit the longest label (≈7 units per character
  // at 13px) so a long card name is never cut off at the card's left edge.
  const longest = Math.max(0, ...data.map(d => String(d.label || '').length));
  const padL = phone ? 0 : Math.max(opts.padL || 170, Math.min(300, longest * 7 + 14)), padR = phone ? 84 : 100;
  const H = padT + data.length * rowH + (phone ? 2 : 10);
  const max = Math.max(...data.map(d => d.v), 1);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const plotW = W - padL - padR;
  data.forEach((d, i) => {
    const y = padT + i * rowH;
    const bh = phone ? 12 : Math.min(20, rowH - 16);
    const barY = phone ? y + 22 : y;
    const w = Math.max(3, (d.v / max) * plotW);
    const lab = phone
      ? el('text', { x: 0, y: y + 13, fill: css('--text-secondary'), 'font-size': '13' })
      : el('text', { x: padL - 12, y: y + bh / 2 + 5, 'text-anchor': 'end', fill: css('--text-secondary'), 'font-size': '13' });
    lab.textContent = d.label; svg.appendChild(lab);
    const bar = el('rect', { x: padL, y: barY, width: w, height: bh, rx: 4, fill: d.colour || css('--s1') });
    bar.addEventListener('mousemove', e => showTip(e, `<b>${d.label}</b><span class="m">${d.tip || money2(d.v)}</span>`));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    const val = el('text', { x: padL + w + 10, y: barY + bh / 2 + 5, fill: css('--text-primary'), 'font-size': '13', 'font-weight': '600' });
    val.textContent = d.vlabel || money(d.v); svg.appendChild(val);
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

function lineChart(mount, pts, limit) {
  if (!mount) return;
  const phone = isPhone();
  const W = phone ? 380 : 760, H = phone ? 240 : 300, padL = phone ? 52 : 62, padR = 14, padT = 16, padB = 40;
  const labelEvery = phone ? 6 : 3;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const vals = pts.map(p => p.v);
  const lo = Math.min(...vals) * 0.985, hi = Math.max(limit || 0, ...vals) * 1.004;
  const x = i => padL + (i / (pts.length - 1)) * plotW;
  const y = v => padT + plotH - ((v - lo) / (hi - lo)) * plotH;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  for (let t = 0; t <= 4; t++) {
    const v = lo + (hi - lo) * t / 4, yy = y(v);
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: css('--grid'), 'stroke-width': 1 }));
    const tx = el('text', { x: padL - 10, y: yy + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': '11' });
    tx.textContent = '$' + Math.round(v / 1000) + 'k'; svg.appendChild(tx);
  }
  if (limit) {
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y(limit), y2: y(limit), stroke: css('--critical'), 'stroke-width': 2, 'stroke-dasharray': '5 4' }));
    const lt = el('text', { x: W - padR, y: y(limit) - 7, 'text-anchor': 'end', fill: css('--critical'), 'font-size': '11', 'font-weight': '600' });
    lt.textContent = 'Credit limit'; svg.appendChild(lt);
  }
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  svg.appendChild(el('path', { d, fill: 'none', stroke: css('--s1'), 'stroke-width': 2, 'stroke-linejoin': 'round' }));
  pts.forEach((p, i) => {
    svg.appendChild(el('circle', { cx: x(i), cy: y(p.v), r: 4, fill: css('--s1'), stroke: css('--surface-1'), 'stroke-width': 2 }));
    const hit = el('circle', { cx: x(i), cy: y(p.v), r: 16, fill: 'transparent' });
    hit.addEventListener('mousemove', e => showTip(e, `<b>${p.m}</b><span class="m">${money2(p.v)}${p.note ? '<br>' + p.note : ''}</span>`));
    hit.addEventListener('mouseleave', hideTip);
    svg.appendChild(hit);
    if (i % labelEvery === 0 || i === pts.length - 1) {
      const t = el('text', { x: x(i), y: H - 14, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': '11' });
      t.textContent = p.m; svg.appendChild(t);
    }
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

function diverge(mount, data) {
  if (!mount) return;
  const phone = isPhone();
  const W = phone ? 380 : 760, H = phone ? 240 : 300, padL = phone ? 50 : 58, padR = 10, padT = 14, padB = 44;
  const labelEvery = phone ? 4 : 2;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(...data.map(d => Math.abs(d.v))) * 1.06;
  const zero = padT + plotH / 2;
  const scale = v => (v / max) * (plotH / 2);
  const bw = Math.min(30, plotW / data.length - 6);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  [-max, -max / 2, 0, max / 2, max].forEach(v => {
    const yy = zero - scale(v);
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: v === 0 ? css('--axis') : css('--grid'), 'stroke-width': v === 0 ? 1.5 : 1 }));
    const t = el('text', { x: padL - 10, y: yy + 4, 'text-anchor': 'end', fill: css('--muted'), 'font-size': '11' });
    t.textContent = (v < 0 ? '−$' : '$') + Math.abs(Math.round(v / 1000)) + 'k'; svg.appendChild(t);
  });
  data.forEach((d, i) => {
    const cx = padL + (i + 0.5) * (plotW / data.length);
    const h = Math.abs(scale(d.v));
    const yTop = d.v >= 0 ? zero - h : zero;
    const bar = el('rect', { x: cx - bw / 2, y: yTop, width: bw, height: Math.max(2, h), rx: 4, fill: d.v >= 0 ? css('--div-pos') : css('--div-neg') });
    bar.addEventListener('mousemove', e => showTip(e, `<b>${d.m}</b><span class="m">${d.v >= 0 ? 'Surplus ' : 'Deficit '}${money2(Math.abs(d.v))}${d.note ? '<br>' + d.note : ''}</span>`));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    if (i % labelEvery === 0) {
      const t = el('text', { x: cx, y: H - 14, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': '10' });
      t.textContent = d.m; svg.appendChild(t);
    }
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

// Grouped bars: several series per month, on one baseline.
function grouped(mount, rows, series) {
  if (!mount) return;
  const phone = isPhone();
  const W = phone ? 380 : 760, padL = phone ? 46 : 52, padR = 12, padT = 10, padB = 34, H = phone ? 220 : 250;
  const labelEvery = phone ? 6 : 3;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const max = Math.max(1, ...rows.flatMap(r => series.map(s => r[s.key])));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const bw = plotW / rows.length;
  const gw = Math.min(9, Math.max(2, (bw - (phone ? 3 : 6)) / series.length));

  [0, 0.5, 1].forEach(f => {
    const y = padT + plotH - f * plotH;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: y, y2: y, stroke: css('--axis'), 'stroke-width': 1 }));
    const t = el('text', { x: padL - 8, y: y + 4, 'text-anchor': 'end', fill: css('--text-secondary'), 'font-size': '11' });
    t.textContent = money(max * f); svg.appendChild(t);
  });

  rows.forEach((r, i) => {
    series.forEach((s, j) => {
      const v = r[s.key] || 0;
      const h = Math.max(1, (v / max) * plotH);
      const x = padL + i * bw + (bw - gw * series.length) / 2 + j * gw;
      const rect = el('rect', { x, y: padT + plotH - h, width: Math.max(2, gw - 1), height: h, fill: s.colour, rx: 1 });
      rect.addEventListener('mousemove', e => showTip(e,
        `<b>${r.m}</b><br>${series.map(ss => `${ss.label} ${money2(r[ss.key] || 0)}`).join('<br>')}` +
        (r.cardsCovered ? '' : '<br><i>cards not yet captured this month</i>')));
      rect.addEventListener('mouseleave', hideTip);
      svg.appendChild(rect);
    });
    if (i % labelEvery === 0) {
      const t = el('text', { x: padL + i * bw + bw / 2, y: H - 12, 'text-anchor': 'middle', fill: css('--text-secondary'), 'font-size': '10' });
      t.textContent = r.m.slice(2); svg.appendChild(t);
    }
  });
  mount.replaceChildren(svg);
}

/* ------------------------------------------------------------------ maths */
// Nothing financial is decided here any more, and nothing new should be.
//
// This file is loaded by every page, which made it the most expensive place in
// the repository to hide a calculation: a figure computed here reaches the
// household from four pages at once and no node suite can reach it from any of
// them. Two lived here. `amortisedPayment` decided the May 2027 renewal and now
// lives inside `Forecast.renewal`; `payoff` and its `monthlyRate` decided the
// payoff modeller — which debt clears, when, and at what cost — and now live in
// `Forecast.payoffDebts` / `Forecast.payoffModel`, where the rate convention is
// chosen per debt instead of assumed for all of them.
//
// What is left below is formatting: it turns a number the engine decided into
// words, and decides nothing.

const fmtMonths = m => {
  if (!isFinite(m)) return 'never';
  if (m > 1200) return 'over 100 years';
  const y = Math.floor(m / 12), mo = Math.round(m % 12);
  if (y === 0) return `${mo} month${mo === 1 ? '' : 's'}`;
  return `${y} year${y === 1 ? '' : 's'}${mo ? ` ${mo} month${mo === 1 ? '' : 's'}` : ''}`;
};

/* ------------------------------------------------------------------ theme */
// Three states: auto (follow the OS), dark, light. Charts read their colours
// from CSS variables at render time, so a theme change means a re-render.
const THEME_KEY = 'hfd-theme';

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const btn = $('theme-btn');
  if (btn) btn.textContent = 'Theme: ' + (mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto');
}

/* ------------------------------------------------------------------ tables */
// A table with three or more columns cannot be read on a phone through a
// sideways scroll. Give every body cell its column heading as `data-label`
// and mark the table `stackable`; styles.css turns each row into a short
// labelled block below 640px and ignores the attribute above it. Presentation
// only: no cell text changes. Two-column tables already fit and are left alone.
function labelStackableTables(root = document) {
  for (const table of root.querySelectorAll('.scroll table')) {
    if (table.classList.contains('wk-table') || table.classList.contains('cal')) continue;
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (heads.length < 3) continue;
    table.classList.add('stackable');
    for (const tr of table.querySelectorAll('tbody tr')) {
      let col = 0;
      for (const td of tr.children) {
        if (!td.hasAttribute('data-label') && heads[col]) td.setAttribute('data-label', heads[col]);
        col += Math.max(1, Number(td.getAttribute('colspan')) || 1);
      }
    }
  }
}

function watchStackableTables() {
  if (!document.body || typeof document.querySelectorAll !== 'function') return;
  labelStackableTables();
  if (typeof MutationObserver === 'undefined') return;
  const defer = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 16);
  let queued = false;
  const run = () => { queued = false; labelStackableTables(); };
  new MutationObserver(() => {
    if (!queued) { queued = true; defer(run); }
  }).observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ boot */
// Pages register render callbacks; the core fetches the data, applies the
// theme, and re-runs the callbacks whenever the theme changes.
const App = (() => {
  let DATA = null, PERIODS = null, HISTORY = null;
  const hooks = [];   // re-run on every render (data arrival, theme change)
  const onceHooks = []; // run once when data arrives (control wiring)

  function rerender() {
    if (!DATA) return;
    for (const fn of hooks) fn(DATA, PERIODS, HISTORY);
  }

  function setupTheme() {
    let mode = null;
    try { mode = localStorage.getItem(THEME_KEY); } catch { /* storage unavailable */ }
    if (mode !== 'light' && mode !== 'dark') mode = 'auto';
    applyTheme(mode);
    const btn = $('theme-btn');
    if (btn) btn.addEventListener('click', () => {
      mode = mode === 'auto' ? 'dark' : mode === 'dark' ? 'light' : 'auto';
      try { localStorage.setItem(THEME_KEY, mode); } catch { /* storage unavailable */ }
      applyTheme(mode);
      rerender();
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', rerender);
    matchMedia(PHONE_MQ).addEventListener('change', rerender);
  }

  // Scrollspy for in-page anchors, only where a nav asks for it.
  function setupSpy() {
    const nav = document.querySelector('.subnav[data-spy]');
    if (!nav) return;
    const links = [...nav.querySelectorAll('a[href^="#"]')];
    const sections = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
    if (!sections.length) return;
    let ticking = false;
    function update() {
      ticking = false;
      const probe = scrollY + 150;
      let current = sections[0];
      for (const s of sections) if (s.offsetTop <= probe) current = s;
      if (scrollY + innerHeight >= document.body.scrollHeight - 4) current = sections[sections.length - 1];
      for (const a of links) {
        if (a.getAttribute('href') === '#' + current.id) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    }
    addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  function boot(opts = {}) {
    setupTheme();
    setupSpy();
    watchStackableTables();
    const wants = [fetch('/data.json', { credentials: 'same-origin' })
      .then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('auth'); } return r.json(); })];
    wants.push(opts.periods
      ? fetch('/periods.json', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
      : Promise.resolve(null));
    wants.push(opts.history
      ? fetch('/balance-history.json', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
      : Promise.resolve(null));
    Promise.all(wants).then(([d, p, h]) => {
      DATA = d; PERIODS = p || null; HISTORY = h || null;
      const asof = $('asof');
      if (asof) {
        let text = 'As at ' + fmtDateLong(d.meta.asOf);
        if (PERIODS && PERIODS.asOf && PERIODS.asOf !== d.meta.asOf) {
          text += ' · spending history as at ' + fmtDateLong(PERIODS.asOf);
        }
        const overlay = d.liveOverlay;
        if (overlay && overlay.applied) {
          const observed = overlay.observedAsOf && overlay.observedAsOf !== d.meta.asOf
            ? fmtDateLong(overlay.observedAsOf)
            : null;
          text += observed
            ? ' · live balances observed ' + observed
            : ' · live Lunch Money overlay';
        } else if (overlay && overlay.applied === false) {
          const opening = overlay.historicalOpeningAsOf || d.meta.asOf;
          text += opening
            ? ' · live overlay not applied · using the ' + fmtDateLong(opening) + ' opening'
            : ' · live overlay not applied';
        }
        asof.textContent = text;
      }
      for (const fn of onceHooks) fn(DATA, PERIODS, HISTORY);
      rerender();
    }).catch(err => {
      if (err.message === 'auth') return;
      console.error(err);
      const wrap = document.querySelector('.wrap');
      if (wrap) wrap.insertAdjacentHTML('afterbegin',
        '<div class="note-box crit">Could not load the data file. Check the server logs.</div>');
    });
  }

  return {
    register: fn => hooks.push(fn),
    once: fn => onceHooks.push(fn),
    rerender,
    boot,
    get data() { return DATA; },
    get periods() { return PERIODS; },
    get history() { return HISTORY; },
  };
})();
