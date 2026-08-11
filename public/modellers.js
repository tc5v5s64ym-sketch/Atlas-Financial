'use strict';
/* The two interactive modellers — payoff and the May 2027 renewal.

   The renewal comparison is `Forecast.renewal`'s. This file reads the sliders,
   hands them over, and formats what comes back: it compounds nothing, charges
   no interest, and decides nothing about which side of the trade is better.
   Everything below the renewal section is wording, colour and layout. */

/* --------------------------------------------------------------- wording */
/* One entry per result the engine can return. These choose none of it — a
   missing entry is a rendering failure, which is why test-renewal.js checks
   that the two sides still name the same set. */

// Which rate convention the household is looking at. Canada quotes fixed and
// variable mortgage rates on different compounding, so the same slider position
// is a different payment — saying which one this is, is part of the answer.
const RATE_BASIS_LABEL = { fixed: 'fixed', variable: 'variable' };
const RATE_BASIS_NOTE = {
  fixed: 'Fixed rates are quoted <b>compounded semi-annually</b> — the convention TD and every '
    + 'Canadian lender price a fixed mortgage on. This is the one to use for a quoted renewal offer.',
  variable: 'Variable rates are quoted <b>compounded monthly</b>. This is the convention the current '
    + 'mortgage is on (TD Mortgage Prime − 0.96%) and the one the HELOC accrues at.',
};

// The paragraph beside the sliders: what today actually costs.
const RENEWAL_CONTEXT = {
  capitalised: r =>
    `<b>Today, household cash:</b> the mortgage only — ${money(r.today.mortgageCash)}/month equivalent. `
    + `Nothing leaves any chequing account for the HELOC.<br>`
    + `<b>Today, HELOC economic cost:</b> ${money(r.today.helocEconomic)}/month of interest `
    + `<b>capitalised onto the balance</b>, so the debt grows by that much every month with nothing `
    + `repaying it. It is a real cost and it buys no equity — it is simply not a bill that gets paid.`,
  paid: r =>
    `Today: mortgage ${money(r.today.mortgageCash)}/month equivalent plus the HELOC payment `
    + `${money(r.today.helocCash)} — ${money(r.today.householdCash)} a month of household cash.`,
};

// The closing note under the figures.
const RENEWAL_NOTE = {
  consolidated: () => 'Both debts amortise. The HELOC principal actually gets repaid.',
  interestOnlyCapitalising: r =>
    `The HELOC stays interest-only AND its interest capitalises, so nothing repays it and it compounds:
           ${money(r.heloc.opening)} today becomes <b>${money(r.helocOwed)}</b> after ${r.years} years.`,
  interestOnlyFlat: r =>
    `The HELOC stays interest-only, so after ${r.years} years its ${money(r.heloc.opening)} is still owed in full.`,
};
const RENEWAL_TONE = {
  consolidated: 'goodline',
  interestOnlyCapitalising: 'warnline',
  interestOnlyFlat: 'warnline',
};
// Whether anything is left owing on the HELOC at the horizon.
const RENEWAL_OWED_TONE = {
  consolidated: 'pos',
  interestOnlyCapitalising: 'neg',
  interestOnlyFlat: 'neg',
};

// The capitalisation row, when there is one to show.
const CAPITALISATION_ROW = {
  stopped: c =>
    `<div class="row"><span>HELOC interest no longer capitalising</span><span class="pos">${money2(c.amount)} / month</span></div>`,
  continues: c =>
    `<div class="row"><span>HELOC interest still capitalising</span><span class="neg">${money2(c.amount)} / month, compounding</span></div>`,
};

// Costs more, costs less, the same — or not comparable, because the engine
// found a scheduled cash payment it could not put on a monthly footing and
// today's baseline is therefore short. The engine ran the comparison and
// decided whether it may be shown; showing an understated difference would
// make the renewal look cheaper against today than it is.
const DELTA_CLASS = { more: 'neg', less: 'pos', same: 'pos', unknown: 'neg' };
const DELTA_TEXT = {
  more: r => '+' + money2(r.delta),
  less: r => money2(r.delta),
  same: r => money2(r.delta),
  unknown: () => 'not comparable',
};
// Named, so the household can see which payment is missing rather than only
// that something is.
const BASELINE_GAP = r =>
  `<br><b>This comparison is withheld:</b> ${r.today.unmodelled.length === 1 ? 'a scheduled payment' : 'scheduled payments'} `
  + `against these debts (${r.today.unmodelled.join(', ')}) ${r.today.unmodelled.length === 1 ? 'has' : 'have'} no monthly `
  + `equivalent, so the figure for today is short by that much and the difference below would flatter the renewal.`;

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

function setupRenewal(d) {
  // The mortgage block supplies the CONTROL's starting position only — the
  // renewal's standing facts. Every balance the arithmetic runs on comes from
  // the debt records, inside the engine.
  const m = d.mortgage;
  let consolidate = false;
  // Opens on variable because that is what this household's mortgage is today
  // — TD Mortgage Prime − 0.96%. Neither convention is a safe default for a
  // quoted offer, which is why the control is on the page rather than implied.
  let basis = 'variable';

  const rate = $('rate-range'), amort = $('amort-range');
  const btnNo = $('consol-no'), btnYes = $('consol-yes');
  const btnVariable = $('basis-variable'), btnFixed = $('basis-fixed');

  function setMode(v) {
    consolidate = v;
    btnNo.setAttribute('aria-pressed', String(!v));
    btnYes.setAttribute('aria-pressed', String(v));
    update();
  }
  btnNo.addEventListener('click', () => setMode(false));
  btnYes.addEventListener('click', () => setMode(true));

  function setBasis(v) {
    basis = v;
    btnVariable.setAttribute('aria-pressed', String(v === 'variable'));
    btnFixed.setAttribute('aria-pressed', String(v === 'fixed'));
    update();
  }
  btnVariable.addEventListener('click', () => setBasis('variable'));
  btnFixed.addEventListener('click', () => setBasis('fixed'));

  function update() {
    // The slider carries hundredths of a percent so it can step in 0.05s.
    const annualPct = Number(rate.value) / 100;
    const years = Number(amort.value);
    $('amort-label').textContent = years + ' years';

    const r = Forecast.renewal(d.plan, d.debts, { rate: annualPct, years, consolidate, basis });

    // The rate never appears without the convention it is quoted under.
    $('rate-label').textContent = `${annualPct.toFixed(2)}% ${RATE_BASIS_LABEL[r.basis]}`;
    $('basis-note').innerHTML = RATE_BASIS_NOTE[r.basis];

    $('renewal-context').innerHTML = RENEWAL_CONTEXT[r.today.id](r)
      + (r.today.unmodelled.length ? BASELINE_GAP(r) : '');

    $('renewal-out').innerHTML = `
      <div class="big">${money(r.payment)} <span style="font-size:.95rem;font-weight:500;color:var(--text-secondary)">/ month</span></div>
      <div class="row"><span>Versus today's household cash</span><span class="${DELTA_CLASS[r.direction]}">${DELTA_TEXT[r.direction](r)}</span></div>
      ${r.capitalisation ? CAPITALISATION_ROW[r.capitalisation.id](r.capitalisation) : ''}
      <div class="row"><span>Principal financed</span><span>${money2(r.principal)}</span></div>
      <div class="row"><span>Total interest over ${years} years</span><span>${money(r.interest.total)}</span></div>
      <div class="row"><span>HELOC still owed after ${years} years</span><span class="${RENEWAL_OWED_TONE[r.outcome]}">${money(r.helocOwed)}</span></div>
      <p class="${RENEWAL_TONE[r.outcome]}">${RENEWAL_NOTE[r.outcome](r)}</p>
      <p class="lede" style="margin:10px 0 0;font-size:.8rem">Priced as a <b>${RATE_BASIS_LABEL[r.basis]}</b> rate.
      Illustrative only. Ignores fees, penalties, qualification
      and the loan-to-value test — which needs a home valuation. A licensed mortgage professional should run the real numbers.</p>`;
  }

  rate.addEventListener('input', update);
  amort.addEventListener('input', update);
  rate.value = String(Math.round(m.rate * 100));
  amort.value = String(Math.round(m.remainingYears));
  update();
}

// Controls wire once; nothing here draws from CSS variables, so no theme hook.
App.once(d => { setupPayoff(d); setupRenewal(d); });
App.boot();
