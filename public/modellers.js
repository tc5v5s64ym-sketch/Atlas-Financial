'use strict';
/* The two interactive modellers — payoff and the May 2027 renewal.
   Unchanged mathematics; only the page around them moved. */

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
    // The HELOC's $814.18 is an interest charge CAPITALISED onto the balance,
    // not a payment. Adding it to the mortgage produced a "today" figure that
    // overstated household cash outflow by $814 a month and implied a bill
    // that nobody pays. The two are kept apart: what leaves the chequing
    // account, and what the debt costs.
    const helocCash = heloc.cashPayment != null ? heloc.cashPayment : heloc.payment;
    const helocEconomic = heloc.monthlyInterest != null ? heloc.monthlyInterest : heloc.payment;
    const helocCapitalised = heloc.interestTreatment === 'capitalised';
    const baselineCash = mortgageNow + helocCash;
    const baselineMonthly = baselineCash;

    let payment, totalInterest, principal, note;
    if (consolidate) {
      principal = m.balance + heloc.balance;
      payment = amortisedPayment(principal, r, years);
      totalInterest = payment * years * 12 - principal;
      note = 'Both debts amortise. The HELOC principal actually gets repaid.';
    } else {
      principal = m.balance;
      payment = amortisedPayment(principal, r, years) + helocCash;
      const mortgageInterest = (payment - helocCash) * years * 12 - principal;
      const helocInterest = heloc.balance * (heloc.rate / 100) * years;
      totalInterest = mortgageInterest + helocInterest;
      note = `The HELOC stays interest-only, so after ${years} years its ${money(heloc.balance)} is still owed in full.`;
    }

    const delta = payment - baselineMonthly;
    $('renewal-context').innerHTML = helocCapitalised
      ? `<b>Today, household cash:</b> the mortgage only — ${money(mortgageNow)}/month equivalent. `
        + `Nothing leaves any chequing account for the HELOC.<br>`
        + `<b>Today, HELOC economic cost:</b> ${money(helocEconomic)}/month of interest `
        + `<b>capitalised onto the balance</b>, so the debt grows by that much every month with nothing `
        + `repaying it. It is a real cost and it buys no equity — it is simply not a bill that gets paid.`
      : `Today: mortgage ${money(mortgageNow)}/month equivalent plus the HELOC payment ${money(helocCash)} — `
        + `${money(baselineCash)} a month of household cash.`;

    $('renewal-out').innerHTML = `
      <div class="big">${money(payment)} <span style="font-size:.95rem;font-weight:500;color:var(--text-secondary)">/ month</span></div>
      <div class="row"><span>Versus today's household cash</span><span class="${delta > 0 ? 'neg' : 'pos'}">${delta > 0 ? '+' : ''}${money2(delta)}</span></div>
      ${helocCapitalised ? `<div class="row"><span>HELOC interest no longer capitalising</span><span class="pos">${money2(helocEconomic)} / month</span></div>` : ''}
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

// Controls wire once; nothing here draws from CSS variables, so no theme hook.
App.once(d => { setupPayoff(d); setupRenewal(d); });
App.boot();
