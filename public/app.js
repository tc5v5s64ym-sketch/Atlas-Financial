'use strict';
/* Household finance dashboard — rendering and modelling.
   All figures come from /data.json so updating the picture is a data edit. */

const SVGNS = 'http://www.w3.org/2000/svg';
const el = (n, a = {}) => { const e = document.createElementNS(SVGNS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = id => document.getElementById(id);

const money = n => '$' + Math.round(n).toLocaleString('en-CA');
const money2 = n => '$' + Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => n.toFixed(2) + '%';

/* ------------------------------------------------------------------ tooltip */
const tip = $('tip');
function showTip(e, html) {
  tip.innerHTML = html; tip.style.opacity = 1;
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 10;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (x < 8) x = 8;
  if (y < 8) y = e.clientY + 18;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => { tip.style.opacity = 0; };
addEventListener('scroll', hideTip, { passive: true });

/* ------------------------------------------------------------------ charts */
function hbar(mount, data, opts = {}) {
  if (!mount) return;
  const W = 760, rowH = opts.rowH || 40, padL = opts.padL || 170, padR = 100, padT = 6;
  const H = padT + data.length * rowH + 10;
  const max = Math.max(...data.map(d => d.v), 1);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const plotW = W - padL - padR;
  data.forEach((d, i) => {
    const y = padT + i * rowH, bh = Math.min(20, rowH - 16);
    const w = Math.max(3, (d.v / max) * plotW);
    const lab = el('text', { x: padL - 12, y: y + bh / 2 + 5, 'text-anchor': 'end', fill: css('--text-secondary'), 'font-size': '13' });
    lab.textContent = d.label; svg.appendChild(lab);
    const bar = el('rect', { x: padL, y, width: w, height: bh, rx: 4, fill: d.colour || css('--s1') });
    bar.addEventListener('mousemove', e => showTip(e, `<b>${d.label}</b><span class="m">${d.tip || money2(d.v)}</span>`));
    bar.addEventListener('mouseleave', hideTip);
    svg.appendChild(bar);
    const val = el('text', { x: padL + w + 10, y: y + bh / 2 + 5, fill: css('--text-primary'), 'font-size': '13', 'font-weight': '600' });
    val.textContent = d.vlabel || money(d.v); svg.appendChild(val);
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

function lineChart(mount, pts, limit) {
  if (!mount) return;
  const W = 760, H = 300, padL = 62, padR = 14, padT = 16, padB = 40;
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
    if (i % 3 === 0 || i === pts.length - 1) {
      const t = el('text', { x: x(i), y: H - 14, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': '11' });
      t.textContent = p.m; svg.appendChild(t);
    }
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

function diverge(mount, data) {
  if (!mount) return;
  const W = 760, H = 300, padL = 58, padR = 10, padT = 14, padB = 44;
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
    if (i % 2 === 0) {
      const t = el('text', { x: cx, y: H - 14, 'text-anchor': 'middle', fill: css('--muted'), 'font-size': '10' });
      t.textContent = d.m; svg.appendChild(t);
    }
  });
  mount.innerHTML = ''; mount.appendChild(svg);
}

/* ------------------------------------------------------------------ maths */
// Card issuers quote a daily rate and bill on 30-day months, so that is the
// convention used here rather than a plain annual/12.
const monthlyRate = annualPct => (annualPct / 100) * 30 / 365;

function payoff(balance, annualPct, monthlyPayment) {
  const i = monthlyRate(annualPct);
  const interestOnly = balance * i;
  if (monthlyPayment <= interestOnly) {
    return { clears: false, interestOnly, shortfall: interestOnly - monthlyPayment };
  }
  const n = -Math.log(1 - (balance * i) / monthlyPayment) / Math.log(1 + i);
  const totalPaid = n * monthlyPayment;
  return { clears: true, months: n, totalPaid, totalInterest: totalPaid - balance, interestOnly };
}

function amortisedPayment(principal, annualPct, years) {
  const i = annualPct / 100 / 12, n = years * 12;
  if (i === 0) return principal / n;
  return principal * i / (1 - Math.pow(1 + i, -n));
}

const fmtMonths = m => {
  if (!isFinite(m)) return 'never';
  if (m > 1200) return 'over 100 years';
  const y = Math.floor(m / 12), mo = Math.round(m % 12);
  if (y === 0) return `${mo} month${mo === 1 ? '' : 's'}`;
  return `${y} year${y === 1 ? '' : 's'}${mo ? ` ${mo} month${mo === 1 ? '' : 's'}` : ''}`;
};

/* ------------------------------------------------------------------ render */
let DATA = null;

function renderStatic(d) {
  $('asof').textContent = 'As at ' + new Date(d.meta.asOf + 'T00:00:00').toLocaleDateString('en-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  $('coverage-line').textContent = `${d.meta.coverage} · ${d.meta.transactions.toLocaleString('en-CA')} transactions, ${d.meta.statements} statements`;
  $('disclaimer').textContent = d.meta.disclaimer;

  $('tiles').innerHTML = d.headline.map(t => `
    <div class="tile ${t.tone === 'plain' ? '' : t.tone}">
      <div class="lab">${t.label}</div>
      <div class="val">${money(t.value)}</div>
      <div class="note">${t.note}</div>
    </div>`).join('');

  $('upcoming').innerHTML = d.upcoming.map(u => `
    <tr>
      <td>${new Date(u.due + 'T00:00:00').toLocaleDateString('en-CA', { day: 'numeric', month: 'short' })}</td>
      <td>${u.what}</td>
      <td class="num">${money2(u.amount)}</td>
      <td class="${u.status === 'paid' ? 'pos' : ''}">${u.status === 'paid' ? '<strong>Paid</strong> — ' : ''}${u.note || 'Due'}</td>
    </tr>`).join('');
  $('upcoming-note').textContent = d.upcomingNote;

  const known = d.debts.filter(x => x.annualInterest != null);
  hbar($('c-debt'), known.map((x, i) => ({
    label: x.label, v: x.annualInterest,
    colour: [css('--s1'), css('--s2'), css('--critical'), css('--critical')][i] || css('--s1'),
    tip: `${money2(x.balance)} at ${pct(x.rate)} · ${x.structure}`,
  })), { rowH: 44, padL: 176 });

  $('debt-table').innerHTML = d.debts.map(x => `
    <tr>
      <td>${x.label}</td>
      <td class="num">${x.balance == null ? '<span class="chip c">unknown</span>' : money2(x.balance)}</td>
      <td class="num ${x.rate >= 20 ? 'neg' : x.rate && x.rate < 5 ? 'pos' : ''}">${x.rate == null ? '—' : pct(x.rate)}</td>
      <td>${x.structure}</td>
      <td class="num">${x.annualInterest == null ? '—' : '~' + money(x.annualInterest)}</td>
    </tr>`).join('');
  if (d.debtsNote) $('debt-note').textContent = d.debtsNote;

  hbar($('c-util'), d.utilisation.map(u => ({
    label: u.label, v: (u.used / u.limit) * 100,
    colour: (u.used / u.limit) > 0.95 ? css('--critical') : css('--serious'),
    // Over the limit is a different fact from merely near it, so say so rather
    // than showing "$0 left" and letting the bar imply it.
    vlabel: u.used > u.limit
      ? money(u.used - u.limit) + ' OVER'
      : money(u.available) + ' left',
    tip: `${money2(u.used)} of a ${money2(u.limit)} limit · ${((u.used / u.limit) * 100).toFixed(1)}% used`,
  })), { rowH: 40, padL: 176 });
  if (d.utilisationNote) $('util-note').textContent = d.utilisationNote;

  lineChart($('c-heloc'), d.helocHistory, d.helocLimit);
  $('heloc-note').textContent = d.helocSummary;

  diverge($('c-flow'), d.cashflow);
  $('flow-note').textContent = d.cashflowNote;

  const grey = css('--muted');

  // Income. The coaching line is gross revenue, so it is coloured as a caution
  // rather than as money the household keeps.
  if (d.income) {
    hbar($('c-income'), d.income.map(i => ({
      label: i.label, v: i.total,
      colour: /REVENUE/i.test(i.stability || '') || /REVENUE/i.test(i.label) ? css('--serious') : css('--s2'),
      tip: `${i.perMonth ? '~' + money(i.perMonth) + '/month · ' : ''}${i.stability || ''}`,
    })), { rowH: 40, padL: 190 });
    $('income-note').textContent =
      `${money2(d.incomeTotal.total)} over 18 months, about ${money(d.incomeTotal.perMonth)}/month. ${d.incomeNote || ''}`;
    if (d.incomeWarning) $('income-warning').textContent = d.incomeWarning;
  }

  // Card spending, kept separate from chequing: different window, different source.
  if (d.cardSpending) {
    hbar($('c-cardspend'), d.cardSpending.map(s => ({
      label: s.label, v: s.total,
      colour: s.type === 'essential' ? css('--s1')
            : s.type === 'business' ? css('--s2')
            : s.type === 'unknown' ? grey : css('--serious'),
      vlabel: money(s.perMonth) + '/mo',
      tip: `${s.type} · ${money2(s.total)} over 12 months`,
    })), { rowH: 34, padL: 180 });
    $('cardspend-note').textContent = d.cardSpendingNote;
  }

  hbar($('c-spend'), d.spending.map(s => ({
    label: s.label, v: s.total,
    colour: s.confidence === 'low' || s.confidence === 'unknown' ? grey : (s.confidence === 'resolved' ? css('--s2') : css('--s1')),
    tip: s.confidence === 'low' || s.confidence === 'unknown' ? 'Low confidence — merchant names truncated' : `18-month total`,
  })), { rowH: 32, padL: 180 });
  $('spend-note').textContent = d.spendingNote;

  $('paypal-table').innerHTML = d.paypal.categories.map(c => `
    <tr><td>${c.label}</td><td class="num">${money2(c.total)}</td><td class="num">~${money(c.perMonth)}</td></tr>`).join('')
    + `<tr><td><strong>Total</strong></td><td class="num"><strong>—</strong></td><td class="num"><strong>~${money(d.paypal.perMonth)}</strong></td></tr>`;
  $('paypal-note').textContent = `${d.paypal.note} Cross-checked against ${money(d.paypal.crossCheck)}/month of bank funding pulls.`;

  hbar($('c-unex'), d.unexplained.map(u => ({
    label: u.label, v: u.amount,
    colour: u.amount > 40000 ? css('--critical') : css('--serious'),
    tip: u.note,
  })), { rowH: 40, padL: 190 });

  $('questions').innerHTML = d.questions.map(q => `
    <div class="qcard ${q.tier === 2 ? 't2' : q.tier === 3 ? 't3' : ''}">
      <h3>${q.q}</h3>
      <p>${q.detail}</p>
      <p class="chg"><strong>What it changes:</strong> ${q.changes} <span class="chip">${q.owner}</span></p>
    </div>`).join('');

  $('assets').innerHTML = d.assets.map(a => `
    <tr><td>${a.label}</td><td class="num ${a.value < 0 ? 'neg' : ''}">${money2(a.value)}</td></tr>`).join('')
    + `<tr><td><strong>Total assets</strong></td><td class="num"><strong>${money2(d.netWorth.assets)}</strong></td></tr>`
    + `<tr><td><strong>Total known debt</strong></td><td class="num neg"><strong>${money2(d.netWorth.debts)}</strong></td></tr>`
    + `<tr><td><strong>Financial accounts only</strong></td><td class="num neg"><strong>${money2(d.netWorth.financialAccountsOnly)}</strong></td></tr>`;
  if (d.assetsNote) $('assets-note').textContent = d.assetsNote;
  $('nw-caveat').textContent = d.netWorth.caveat;

  $('coverage').innerHTML = d.coverage.map(c => `
    <tr><td><strong>${c.source}</strong></td><td>${c.what}</td>
    <td><span class="chip ${c.status === 'complete' ? 'v' : c.status === 'blocked' ? 'e' : 'c'}">${c.status}</span></td></tr>`).join('');
}

/* ------------------------------------------------------------------ modeller 1 */
function setupPayoff(d) {
  const debts = d.debts.filter(x => x.balance != null && x.rate != null && x.balance > 0);
  const sel = $('debt-select');
  sel.innerHTML = debts.map((x, i) => `<option value="${i}">${x.label} — ${money(x.balance)} at ${pct(x.rate)}</option>`).join('');
  const defaultIdx = debts.findIndex(x => /Triangle/i.test(x.label));
  sel.value = String(defaultIdx >= 0 ? defaultIdx : 0);

  const range = $('pay-range'), presets = $('pay-presets');

  function currentDebt() { return debts[Number(sel.value)]; }

  function bounds(x) {
    const min = Math.ceil(x.balance * monthlyRate(x.rate) * 0.5);
    const max = Math.max(Math.ceil(x.balance / 12), min * 6);
    return { min, max };
  }

  function syncRange() {
    const x = currentDebt(), b = bounds(x);
    range.min = b.min; range.max = b.max; range.step = 5;
    const start = x.payment && x.payment > b.min ? x.payment : Math.round((b.min + b.max) / 3);
    range.value = Math.min(b.max, Math.max(b.min, Math.round(start)));
    presets.innerHTML = '';
    const opts = [
      { l: 'Minimum', v: x.payment },
      { l: 'Clear in 5 yrs', v: solveFor(x, 60) },
      { l: 'Clear in 3 yrs', v: solveFor(x, 36) },
      { l: 'Clear in 1 yr', v: solveFor(x, 12) },
    ].filter(o => o.v && isFinite(o.v));
    for (const o of opts) {
      const b2 = document.createElement('button');
      b2.type = 'button'; b2.className = 'preset';
      b2.textContent = `${o.l} · ${money(o.v)}`;
      b2.addEventListener('click', () => {
        range.min = Math.min(range.min, Math.floor(o.v));
        range.max = Math.max(range.max, Math.ceil(o.v));
        range.value = Math.round(o.v); update();
      });
      presets.appendChild(b2);
    }
  }

  function solveFor(x, months) {
    const i = monthlyRate(x.rate);
    return x.balance * i / (1 - Math.pow(1 + i, -months));
  }

  function update() {
    const x = currentDebt();
    const P = Number(range.value);
    $('pay-label').textContent = money(P) + ' / month';
    const r = payoff(x.balance, x.rate, P);
    const out = $('payoff-out');

    $('model-context').textContent =
      `${x.label}: ${money2(x.balance)} at ${pct(x.rate)}. Interest alone runs about ${money(r.interestOnly)} a month, `
      + `so anything below that makes the balance grow. ${x.structure}`;

    if (!r.clears) {
      out.innerHTML = `
        <div class="big neg">Never clears</div>
        <div class="row"><span>Monthly interest</span><span>${money2(r.interestOnly)}</span></div>
        <div class="row"><span>Your payment</span><span>${money2(P)}</span></div>
        <div class="row"><span>Balance grows by</span><span class="neg">${money2(r.shortfall)}/month</span></div>
        <p class="warnline">This payment is below the interest charge, so the balance rises every month.</p>`;
      return;
    }
    const min = x.payment ? payoff(x.balance, x.rate, x.payment) : null;
    const saved = min && min.clears ? min.totalInterest - r.totalInterest : null;
    out.innerHTML = `
      <div class="big">${fmtMonths(r.months)}</div>
      <div class="row"><span>Monthly payment</span><span>${money2(P)}</span></div>
      <div class="row"><span>Of which interest, month 1</span><span>${money2(r.interestOnly)}</span></div>
      <div class="row"><span>Total interest paid</span><span>${money2(r.totalInterest)}</span></div>
      <div class="row"><span>Total paid</span><span>${money2(r.totalPaid)}</span></div>
      ${saved && saved > 0 ? `<p class="goodline">Saves ${money2(saved)} in interest versus paying the minimum${min && !min.clears ? '' : ` — and clears it ${fmtMonths(min.months - r.months)} sooner`}.</p>` : ''}`;
  }

  sel.addEventListener('change', () => { syncRange(); update(); });
  range.addEventListener('input', update);
  syncRange(); update();
}

/* ------------------------------------------------------------------ modeller 2 */
function setupRenewal(d) {
  const m = d.mortgage;
  const heloc = d.debts.find(x => /HELOC/i.test(x.label));
  let consolidate = false;

  const rate = $('rate-range'), amort = $('amort-range');
  const btnNo = $('consol-no'), btnYes = $('consol-yes');

  function setMode(v) {
    consolidate = v;
    btnNo.setAttribute('aria-pressed', String(!v));
    btnYes.setAttribute('aria-pressed', String(v));
    update();
  }
  btnNo.addEventListener('click', () => setMode(false));
  btnYes.addEventListener('click', () => setMode(true));

  function update() {
    const r = Number(rate.value) / 100;
    const years = Number(amort.value);
    $('rate-label').textContent = r.toFixed(2) + '%';
    $('amort-label').textContent = years + ' years';

    const mortgageNow = m.paymentBiweekly * 26 / 12;
    const helocNow = heloc.payment;
    const baselineMonthly = mortgageNow + helocNow;

    let payment, totalInterest, principal, note;
    if (consolidate) {
      principal = m.balance + heloc.balance;
      payment = amortisedPayment(principal, r, years);
      totalInterest = payment * years * 12 - principal;
      note = 'Both debts amortise. The HELOC principal actually gets repaid.';
    } else {
      principal = m.balance;
      payment = amortisedPayment(principal, r, years) + helocNow;
      const mortgageInterest = (payment - helocNow) * years * 12 - principal;
      const helocInterest = heloc.balance * (heloc.rate / 100) * years;
      totalInterest = mortgageInterest + helocInterest;
      note = `The HELOC stays interest-only, so after ${years} years its ${money(heloc.balance)} is still owed in full.`;
    }

    const delta = payment - baselineMonthly;
    $('renewal-context').textContent =
      `Today: mortgage ${money(mortgageNow)}/month equivalent plus the HELOC minimum ${money(helocNow)} — `
      + `${money(baselineMonthly)} a month in total, of which the HELOC portion buys no equity at all.`;

    $('renewal-out').innerHTML = `
      <div class="big">${money(payment)} <span style="font-size:.95rem;font-weight:500;color:var(--text-secondary)">/ month</span></div>
      <div class="row"><span>Versus today</span><span class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '+' : ''}${money2(delta)}</span></div>
      <div class="row"><span>Principal financed</span><span>${money2(principal)}</span></div>
      <div class="row"><span>Total interest over ${years} years</span><span>${money(totalInterest)}</span></div>
      <div class="row"><span>Still owed after ${years} years</span><span>${consolidate ? '$0' : money(heloc.balance)}</span></div>
      <p class="${consolidate ? 'goodline' : 'warnline'}">${note}</p>
      <p class="lede" style="margin:10px 0 0;font-size:.8rem">Illustrative only. Ignores fees, penalties, qualification
      and the loan-to-value test — which needs a home valuation. A licensed mortgage professional should run the real numbers.</p>`;
  }

  rate.addEventListener('input', update);
  amort.addEventListener('input', update);
  rate.value = String(Math.round(m.rate * 100));
  amort.value = String(Math.round(m.remainingYears));
  update();
}

/* ------------------------------------------------------------------ boot */
fetch('/data.json', { credentials: 'same-origin' })
  .then(r => { if (r.status === 401) { location.href = '/login'; throw new Error('auth'); } return r.json(); })
  .then(d => {
    DATA = d;
    renderStatic(d);
    setupPayoff(d);
    setupRenewal(d);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderStatic(DATA));
  })
  .catch(err => {
    if (err.message === 'auth') return;
    console.error(err);
    document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
      '<div class="note-box crit">Could not load the data file. Check the server logs.</div>');
  });
