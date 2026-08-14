'use strict';
/* Forecast engine — the 13-week cash projection behind the Plan page.
   Pure functions, no DOM: the browser page and the node test suite both load
   this file, so what is tested is exactly what is shown.

   Every event carries the confidence it arrived with ('confirmed' or
   'estimated') so the UI can keep the two visually apart. The engine never
   invents an amount: it only expands the recurrences declared in data.json's
   `plan` block and simulates the ledger day by day. */

(function (root) {

  /* --------------------------------------------------------------- dates */
  // ISO date strings throughout; arithmetic in UTC so DST can never shift a
  // payday. A date here is a calendar day, not an instant.
  function toUTC(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }
  function fromUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    return fromUTC(toUTC(iso) + n * 86400000);
  }
  function diffDays(a, b) { // b - a in days
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }
  function daysInMonth(y, m) { // m is 1-based
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  // The nth of every month, clamped to shorter months (day 31 → 30 Sep).
  // Walks until `end`, not a fixed month count: the Plan window is 13 weeks,
  // but the exported calendar reuses this same expander over a longer horizon.
  function monthlyDates(day, start, end, firstDue) {
    const out = [];
    let [y, m] = start.split('-').map(Number);
    for (;;) {
      const d = Math.min(day, daysInMonth(y, m));
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso > end) break;
      if (iso >= start && (!firstDue || iso >= firstDue)) out.push(iso);
      m++; if (m > 12) { m = 1; y++; }
    }
    return out;
  }
  function biweeklyDates(anchor, start, end) {
    const out = [];
    // Walk back so an anchor after `start` still yields any earlier occurrences.
    let t = anchor;
    while (diffDays(start, t) > 0) t = addDays(t, -14);
    while (t <= end) {
      if (t >= start) out.push(t);
      t = addDays(t, 14);
    }
    return out;
  }

  function occurrences(item, start, end) {
    if (item.frequency === 'once') {
      return (item.date >= start && item.date <= end) ? [item.date] : [];
    }
    if (item.frequency === 'biweekly') {
      const dates = biweeklyDates(item.anchor, start, end);
      return item.firstDue ? dates.filter(d => d >= item.firstDue) : dates;
    }
    if (item.frequency === 'monthly') {
      return monthlyDates(item.day, start, end, item.firstDue);
    }
    return [];
  }

  /* --------------------------------------------------------------- money */
  // Half a cent. Balances are built by adding and subtracting floats, so a
  // figure that is exactly the buffer can land at 499.9999999999999. Comparing
  // that with `<` reports a breach that does not exist, and the recommender
  // then answers $0. Every buffer comparison goes through these two.
  const EPSILON = 0.005;
  const atLeast = (value, floor) => value >= floor - EPSILON;
  const below = (value, floor) => value < floor - EPSILON;

  // What a facility owes TODAY. Pending charges are ALREADY INCURRED, so they
  // belong to the opening balance: a card whose posted balance is under its
  // limit but whose pending charges take it over is over its limit, and the
  // settlement is bookkeeping rather than a decision.
  //
  // One rule, three consumers — the debt walk opens on it, headroom is measured
  // against it, and the renewal compounds from it. It is a function rather than
  // three copies of one expression because two copies had already disagreed
  // once: the Travel Visa published $0 available beside a derived $21.69,
  // because one of them knew about $165.13 of pending charges and the other
  // did not.
  const openingBalance = debt => debt.balance + (debt.pending || 0);

  // Payments a year, by declared cadence. `streamAmount` states the same
  // convention from the other side — a monthly figure paid bi-weekly arrives as
  // 26ths of a year's worth — and this is the inverse, used to put a bi-weekly
  // obligation and a monthly one on one comparable footing.
  const PAYMENTS_PER_YEAR = { biweekly: 26, monthly: 12 };

  // What ONE debt costs the household in CASH, per month, at today's cadence.
  //
  // Its recurring cash obligations and nothing else. A capitalising charge is a
  // real economic cost and is reported separately, but no cash leaves an
  // account for it, so it is not part of what the household pays. That is what
  // makes the HELOC's $0.00 derived rather than asserted: its obligation is
  // `nonCash`, so it contributes nothing by construction rather than by a field
  // somebody has to remember.
  //
  // A cadence with no annual equivalent — a one-off, or one `PAYMENTS_PER_YEAR`
  // does not know — is REPORTED in `unmodelled` rather than dropped. Silently
  // omitting a real cash obligation understates the figure, in the same
  // direction and for the same reason as the $814 bill that nobody paid.
  //
  // One rule, two consumers — the renewal compares its new payment against it,
  // and the payoff modeller uses it as the minimum every larger payment is
  // measured against. It was the renewal's alone until the payoff modeller
  // needed the same answer, and a second copy is how the two would have come to
  // disagree about what the household already pays.
  //
  // The result carries its own CONFIDENCE, because most of these obligations are
  // `estimated` — a future statement minimum held at today's level, not a
  // confirmed amount. `expandEvents` already carries the confidence every event
  // arrived with, and dropping it here would put an estimate on a decision
  // surface untagged, which `CLAUDE.md` forbids outright.
  //
  // Weakest wins, and it fails SAFE: `confirmed` only where every contributing
  // obligation says so, so a missing or unrecognised value reads as estimated
  // rather than as a settled fact. Only obligations that actually contributed
  // count — one this table cannot annualise adds nothing to the figure, so it
  // has no business tagging it. `null` where nothing contributed, because there
  // is then no figure to tag.
  function monthlyCashFor(plan, debtId) {
    const unmodelled = [];
    const counted = [];
    const monthly = ((plan || {}).obligations || [])
      .filter(o => o.debtId === debtId && !o.nonCash)
      .reduce((sum, o) => {
        const perYear = PAYMENTS_PER_YEAR[o.frequency];
        if (!perYear) { unmodelled.push(o.id); return sum; }
        counted.push(o);
        return sum + o.amount * perYear / 12;
      }, 0);
    const confidence = counted.length
      ? (counted.every(o => o.confidence === 'confirmed') ? 'confirmed' : 'estimated')
      : null;
    return { monthly, unmodelled, confidence };
  }

  /* --------------------------------------------------------------- events */
  // opts: { scenario, incomeOverrides: {id: monthlyAmount}, disabled: [ids],
  //         injections: [{date, amount}] — one-off cash arriving from outside
  //         the plan, used to model covering an opening gap }
  function streamAmount(stream, opts) {
    const override = opts.incomeOverrides && opts.incomeOverrides[stream.id];
    let monthly = null;
    if (override != null && isFinite(override)) monthly = Number(override);
    else if (stream.scenarioMonthly) monthly = stream.scenarioMonthly[opts.scenario || 'expected'];
    if (monthly == null) return stream.amount; // fixed amount (no scenarioMonthly / override)
    // A monthly figure paid bi-weekly arrives as 26ths of a year's worth.
    return stream.frequency === 'biweekly' ? monthly * 12 / 26 : monthly;
  }

  function expandEvents(plan, start, end, opts) {
    opts = opts || {};
    const disabled = new Set(opts.disabled || []);
    const events = [];
    for (const s of plan.income) {
      const per = streamAmount(s, opts);
      if (!per) continue;
      for (const date of occurrences(s, start, end)) {
        events.push({ date, amount: per, kind: 'income', label: s.label, id: s.id, confidence: s.confidence });
      }
    }
    for (const o of plan.obligations) {
      for (const date of occurrences(o, start, end)) {
        // A minimum on a card that has been paid off is not a payment anybody
        // makes — the bank does not take it, because there is nothing to take
        // it against. Capping extras but not these left the two projections
        // still disagreeing by $693.11 at a large enough entered payment, and
        // "a scheduled minimum is contractual" was the wrong reason to leave
        // it: the obligation is to a BALANCE, and the balance is gone.
        //
        // Same authority and same application point as the extra payments, so
        // there is one rule for "a payment cannot exceed the debt it pays"
        // rather than two that can drift apart.
        const cap = opts.obligationAbsorbed;
        const amount = cap ? (cap[date + ':' + o.id] || 0) : o.amount;
        // A non-cash charge (HELOC interest capitalising onto the balance) is
        // shown on the calendar but never deducted from cash. Capping never
        // applies to it — it adds to a balance rather than reducing one.
        if (o.nonCash) {
          events.push({ date, amount: -o.amount, kind: 'noncash',
            label: o.label, id: o.id, confidence: o.confidence });
          continue;
        }
        if (amount <= 0) continue;      // nothing left for this payment to pay
        events.push({ date, amount: -amount, kind: 'obligation',
          label: o.label, id: o.id, confidence: o.confidence });
      }
    }
    for (const b of plan.bills || []) {
      for (const date of occurrences(b, start, end)) {
        events.push({ date, amount: -b.amount, kind: 'bill', label: b.label, id: b.id, confidence: b.confidence });
      }
    }
    for (const c of plan.commitments) {
      if (disabled.has(c.id)) continue;
      if (c.date >= start && c.date <= end) {
        events.push({ date: c.date, amount: -c.amount, kind: 'commitment', label: c.label, id: c.id, confidence: c.confidence });
      }
    }
    // Cash arriving from outside the plan — a transfer from Amanda's account or
    // a HELOC draw covering an opening gap. Positive, so it sorts with income
    // and lands before the payments it is there to cover.
    // Grouped by date, so a top-up drawn from two sources is ONE cash movement.
    // Emitting them separately let the daily floor be measured half-way through
    // the transfer: at a $3,000 buffer the first $2,691.85 recorded a $2,771.69
    // floor before the $851.31 arrived, and the recommender answered $0/week
    // for a day that actually closes exactly on the buffer. The parts are kept
    // on the event because the DEBT side still needs to know which facility
    // each portion came from — one movement of cash, several origins.
    const byInjectionDate = new Map();
    for (const inj of opts.injections || []) {
      if (!(inj.amount > 0 && inj.date >= start && inj.date <= end)) continue;
      const g = byInjectionDate.get(inj.date)
        || { date: inj.date, amount: 0, parts: [], id: inj.id || 'gapFunding' };
      g.amount += inj.amount;
      g.parts.push({ amount: inj.amount, debtId: inj.debtId || null,
        label: inj.label || 'Gap funding' });
      byInjectionDate.set(inj.date, g);
    }
    for (const g of byInjectionDate.values()) {
      events.push({ date: g.date, amount: g.amount, kind: 'injection', id: g.id,
        label: g.parts.length === 1 ? g.parts[0].label
          : `Gap funding — ${g.parts.length} sources`,
        parts: g.parts,
        // Only meaningful when the whole movement came from one place; the
        // debt projection reads `parts` regardless.
        debtId: g.parts.length === 1 ? g.parts[0].debtId : null,
        confidence: 'planned' });
    }
    if (opts.extraDebtMonthly > 0) {
      // Applied mid-month, the day after the usual payday pattern.
      //
      // A payment can only be as large as the debt left to receive it. Once
      // every facility in the cascade is at zero there is nothing to pay, and
      // continuing to take the money out of cash would recreate exactly the
      // mismatch the cascade removes — the money would leave the account and
      // reduce nothing. At $80,000/month the third payment had $7,584.05 with
      // nowhere to go while cash lost all of it.
      //
      // `projectDebts` is the authority on what a payment actually absorbed,
      // and it hands the answer back as `extraAbsorbed`. Applying it HERE,
      // where the event is created, is what keeps the two sides honest: cash
      // and debt read the same event, so neither can hold a different idea of
      // how much was paid. Capping in one and not the other is the whole bug.
      const absorbed = opts.extraAbsorbed || null;
      for (const date of monthlyDates(15, start, end)) {
        const amount = absorbed ? (absorbed[date] || 0) : opts.extraDebtMonthly;
        if (amount <= 0) continue;      // no debt left — the payment stops
        events.push({ date, amount: -amount, kind: 'extra', label: 'Extra debt payment', id: 'extra', confidence: 'planned' });
      }
    }
    // Deposits land before payments due the same day — payday-timed bills are
    // arranged on exactly that assumption. Sort: date, then income first.
    events.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 :
      (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
    return events;
  }

  /* ------------------------------------------------------------- simulate */
  // opts adds:
  //   weeklyVariable — spread evenly across the 7 days of each week
  //   variableFrom   — variable spending starts on this date, not at the window
  //                    opening. During an opening squeeze there is nothing to
  //                    spend, and pretending otherwise understates the recovery.
  //   measureFrom    — the floor (`min`) is measured from this date onward. The
  //                    days before it are an acknowledged squeeze being solved
  //                    separately; holding the buffer through them is not the
  //                    test the recommendation is answering.
  function simulate(plan, asOf, opts) {
    opts = opts || {};
    const days = plan.windowDays || 91;
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const dailyVariable = (opts.weeklyVariable || 0) / 7;
    const variableFrom = opts.variableFrom || start;
    const measureFrom = opts.measureFrom || start;

    const byDate = new Map();
    for (const e of events) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }

    let balance = plan.startingCash.amount;
    const daily = [];
    // Seeded from the opening balance only when the whole window is being
    // measured; otherwise the first in-range day sets it.
    let min = measureFrom <= start ? { date: start, balance } : { date: measureFrom, balance: Infinity };
    const weeks = [];
    let week = null;

    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      const measured = date >= measureFrom;
      if (i % 7 === 0) {
        week = {
          n: weeks.length + 1, start: date, end: addDays(date, 6),
          opening: balance, confirmedIncome: 0, estimatedIncome: 0,
          obligations: 0, bills: 0, commitments: 0, variable: 0, extra: 0, noncash: 0,
          injections: 0, closing: balance, events: [], belowBuffer: false, negative: false,
        };
        weeks.push(week);
      }
      const todays = byDate.get(date) || [];
      for (const e of todays) {
        if (e.kind === 'noncash') { week.noncash += -e.amount; week.events.push(e); continue; }
        balance += e.amount;
        if (e.kind === 'income') {
          if (e.confidence === 'confirmed') week.confirmedIncome += e.amount;
          else week.estimatedIncome += e.amount;
        } else if (e.kind === 'injection') week.injections += e.amount;
        else if (e.kind === 'obligation') week.obligations += -e.amount;
        else if (e.kind === 'bill') week.bills += -e.amount;
        else if (e.kind === 'commitment') week.commitments += -e.amount;
        else if (e.kind === 'extra') week.extra += -e.amount;
        week.events.push(e);
        // The intra-day low matters: a big payment can dip below the buffer
        // even when the day closes fine. Income sorts first, so this is the
        // cautious reading of the day.
        if (measured && balance < min.balance) min = { date, balance };
      }
      if (date >= variableFrom) {
        balance -= dailyVariable;
        week.variable += dailyVariable;
      }
      if (measured && balance < min.balance) min = { date, balance };
      daily.push({ date, balance });
      week.closing = balance;
    }

    const buffer = opts.targetBuffer != null ? opts.targetBuffer : (plan.defaults.targetBuffer || 0);
    for (const w of weeks) {
      const low = Math.min(w.opening, ...daily.filter(d => d.date >= w.start && d.date <= w.end).map(d => d.balance));
      w.low = low;
      w.belowBuffer = low < buffer;
      w.negative = low < 0;
    }

    // The week-by-week track: the closing balance below which the REST of the
    // window breaches the buffer even with everything going to plan. Backward
    // pass over daily net changes: requiredClosing = buffer − (the most the
    // balance ever sits below this week's closing at any later day).
    const delta = daily.map((p, i) => p.balance - (i ? daily[i - 1].balance : plan.startingCash.amount));
    const suffixMin = new Array(days).fill(Infinity);
    for (let i = days - 1; i >= 0; i--) {
      const later = i + 1 < days ? Math.min(0, suffixMin[i + 1]) : 0;
      suffixMin[i] = delta[i] + later;
    }
    weeks.forEach((w, i) => {
      const next = (i + 1) * 7;
      w.requiredClosing = next < days ? buffer - Math.min(0, suffixMin[next]) : buffer;
    });

    const totals = {
      confirmedIncome: weeks.reduce((s, w) => s + w.confirmedIncome, 0),
      estimatedIncome: weeks.reduce((s, w) => s + w.estimatedIncome, 0),
      injections: weeks.reduce((s, w) => s + w.injections, 0),
      obligations: weeks.reduce((s, w) => s + w.obligations, 0),
      bills: weeks.reduce((s, w) => s + w.bills, 0),
      noncash: weeks.reduce((s, w) => s + w.noncash, 0),
      commitments: weeks.reduce((s, w) => s + w.commitments, 0),
      variable: weeks.reduce((s, w) => s + w.variable, 0),
      extra: weeks.reduce((s, w) => s + w.extra, 0),
    };
    totals.income = totals.confirmedIncome + totals.estimatedIncome;

    return {
      start, end, daily, weeks, events, totals,
      min, ending: balance, buffer,
      shortfall: min.balance < 0 ? -min.balance : 0,
      breachesBuffer: min.balance < buffer,
      endingSurplus: balance - buffer,
      // Room for extra repayment, measured at the end of the window — cash
      // above the buffer once everything has cleared. Bounded by zero.
      extraDebtCapacity: Math.max(0, balance - buffer),
    };
  }

  /* ---------------------------------------------------- budget recommender */
  // The largest weekly variable spend, to the nearest $5, that keeps every
  // measured day of the projection at or above the target buffer. Monotonic
  // in W, so binary search is exact.
  const STEP = 5;
  function recommendWeekly(plan, asOf, opts) {
    opts = Object.assign({}, opts || {});
    const buffer = opts.targetBuffer != null ? opts.targetBuffer : plan.defaults.targetBuffer;
    const fits = w => {
      opts.weeklyVariable = w;
      return atLeast(simulate(plan, asOf, opts).min.balance, buffer);
    };
    if (!fits(0)) return 0; // even zero spending breaches the buffer
    let lo = 0, hi = 5000;
    while (fits(hi)) { lo = hi; hi *= 2; if (hi > 80000) break; }
    while (hi - lo > STEP) {
      const mid = Math.round((lo + hi) / (STEP * 2)) * STEP;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* ------------------------------------------------- the recommendation */
  // THE single authority for "how much can the household spend per week".
  // Both the headline tile and the budget breakdown read this one result, so
  // the page cannot show two different answers to the same question.
  //
  // Two cases, one code path:
  //
  //   normal      the window already holds the buffer at zero spend, so the
  //               answer is the largest weekly spend that keeps it there.
  //
  //   openingGap  even zero spend breaches, because money is due before the
  //               first payday arrives. The fix is not a smaller budget, it is
  //               a top-up. Size it, place it on the calendar as a one-off
  //               injection on the day it is needed, and re-solve.
  //
  // The opening-gap case is solved on the SAME window, by adding one event.
  // The previous implementation instead re-sliced the plan to start on the
  // first payday, seeded it with that payday's own end-of-day balance, and
  // then let the simulation replay that payday's income and bills — counting
  // the whole day twice and overstating the sustainable budget by a third.
  // Adding an event to one ledger pass cannot double-count by construction.
  function recommend(plan, asOf, opts) {
    const base = Object.assign({}, opts || {});
    const buffer = base.targetBuffer != null ? base.targetBuffer : (plan.defaults.targetBuffer || 0);
    base.targetBuffer = buffer;

    // The planning assumptions this answer was reached under — scenario, target
    // buffer, income overrides, disabled commitments, debt records, extra-debt
    // settings, declared funding sources — recorded before anything derived is
    // added to them. `simOptions` is the RECOVERY run: it carries the gap
    // injections, `variableFrom`, `measureFrom` and the absorption caps, so
    // feeding it back into `recommend` would fund the gap twice.
    //
    // A counterfactual asks "what if ONE of these were different". Copying this
    // record and replacing one key is what makes the other assumptions
    // propagate by construction rather than by a caller remembering to pass
    // them — which is exactly what a page cannot be trusted to do, and what
    // `Forecast.counterfactuals` reads.
    const planOptions = Object.assign({}, base);

    // An extra debt payment cannot be larger than the debt available to receive
    // it. Ask the debt projection what each one actually absorbs and spend that,
    // so a payment big enough to clear everything stops instead of draining
    // cash into nothing.
    //
    // The caps must be measured under the SAME assumptions the run they govern
    // uses. The debt walk does not depend on the weekly figure — weekly spending
    // is cash-only and touches no balance — so it need not go inside the search.
    // It does depend on gap funding, because a HELOC draw ADDS debt for later
    // payments to reach: measuring the caps before the injection was known left
    // the HELOC $956.81 higher than the household had in fact paid it down to.
    // So it is measured once per branch, against that branch's own options.
    // Measured with any earlier caps CLEARED. The recovery options are built by
    // copying the base ones, so they arrive carrying the base caps; walking with
    // those already applied measures how much a capped payment absorbs rather
    // than how much the debt can take, and the answer comes back $956.81 short.
    const capsFor = o => {
      if (!o.debts) return null;
      const walked = projectDebts(plan, o.debts, asOf,
        Object.assign({}, o, { extraAbsorbed: null, obligationAbsorbed: null }));
      return { extraAbsorbed: walked.extraAbsorbed, obligationAbsorbed: walked.obligationAbsorbed };
    };
    const applyCaps = (o, caps) => {
      if (!caps) return;
      o.extraAbsorbed = caps.extraAbsorbed;
      o.obligationAbsorbed = caps.obligationAbsorbed;
    };
    applyCaps(base, capsFor(base));

    const zero = simulate(plan, asOf, Object.assign({}, base, { weeklyVariable: 0 }));

    if (atLeast(zero.min.balance, buffer)) {
      const weekly = recommendWeekly(plan, asOf, base);
      return finish('normal', base, weekly, asOf, null, zero);
    }

    // --- the opening gap -------------------------------------------------
    // What the household is short by, at the worst moment, before spending
    // anything at all.
    const gapAmount = buffer - zero.min.balance;
    // The day the money has to be in the account. Not simply the first day the
    // balance sits under the buffer — on that reading the answer is "today",
    // because the household is thin today. A thin balance is not a failure; a
    // payment that cannot clear is. So: the first day the balance actually goes
    // negative, or the floor, whichever comes first. Topping up by the full gap
    // on that day lifts it and every later day to at least the buffer, so one
    // injection clears the rest of the window.
    const firstNegative = zero.daily.find(p => p.balance < 0);
    const gapDate = firstNegative && firstNegative.date < zero.min.date
      ? firstNegative.date : zero.min.date;
    // Everything that must be paid before the first money arrives.
    const firstIncome = zero.events.find(e => e.kind === 'income');
    const preIncomeOut = zero.events
      .filter(e => e.amount < 0 && e.kind !== 'noncash' && (!firstIncome || e.date < firstIncome.date))
      .reduce((s, e) => s + -e.amount, 0);
    const dueOnGapDay = zero.events
      .filter(e => e.date === gapDate && e.amount < 0 && e.kind !== 'noncash')
      .reduce((s, e) => s + -e.amount, 0);

    // Spending resumes at the first real payday — until then there is nothing
    // spare, which is the honest answer for the opening days.
    const payFloor = base.paydayFloor != null ? base.paydayFloor : 1000;
    const firstPay = zero.events.find(e => e.kind === 'income' && e.amount >= payFloor);
    const spendFrom = firstPay ? firstPay.date : gapDate;

    // WHO covers the gap decides what it costs. Money released from an account
    // the household already owns creates no debt; a draw on a credit facility
    // does. The allocation lives here rather than in the page because it is
    // arithmetic against the gap, and the gap is only known at this point.
    //
    // Sources are filled in rank order until the gap is met. One source is the
    // common case, but it is not the only one: raise the buffer and the gap can
    // outrun the largest single source while still being reachable by two.
    // Modelling it as one debt-free injection then records a transfer that
    // cannot happen and a HELOC draw that does — and the scoreboard shows the
    // crossing a month later than it would really be.
    const sources = (base.fundingSources || []).slice()
      .sort((a, b) => (a.rank || 0) - (b.rank || 0))
      .filter(x => !x.unusable && x.available > 0);
    const parts = [];
    let unmet = gapAmount;
    for (const src of sources) {
      if (atLeast(0, unmet)) break;               // unmet <= 0 within epsilon
      const take = Math.min(src.available, unmet);
      if (take <= EPSILON) continue;
      parts.push({ id: src.id, label: src.label, short: src.short || src.label,
        amount: take, debtId: src.debtId || null });
      unmet -= take;
    }
    // No sources declared at all: fall back to one unattributed injection, which
    // is what a caller that has not told us anything is implicitly asking for.
    if (!sources.length) {
      parts.push({ id: 'gapFunding', label: base.fundingLabel || 'Gap funding — transfer or draw',
        short: 'gap funding', amount: gapAmount, debtId: base.fundingDebtId || null });
      unmet = 0;
    }
    const shortfall = Math.max(0, unmet);
    // Every usable source combined, which is what the allocation actually
    // reaches. Equal to the gap when it can be funded, and to the sum of every
    // usable source when it cannot: `allocated + shortfall === gapAmount` holds
    // either way, by construction. The page used to total `parts` itself to
    // publish "every usable source combined reaches $X".
    const allocated = parts.reduce((s, p) => s + p.amount, 0);
    // Each declared source judged against the gap, in rank order — the card the
    // page renders under "covering the gap". This is the same allocation seen
    // per source rather than a second answer beside it: `contributes` is the
    // part this source was actually given above, and `covers` is measured with
    // `atLeast`, the same epsilon the allocation itself stops on. The page used
    // to ask `o.available >= needed` in its own arithmetic, so a source could
    // read "Covers it" beside a band saying nothing could — and at a source
    // half a cent short the allocator called the gap funded while the card
    // called the source insufficient by $0.00.
    //
    // An unusable source never covers the gap however large its balance: it is
    // excluded from the allocation, so claiming coverage would offer money the
    // plan cannot spend.
    const sourceVerdicts = (base.fundingSources || []).slice()
      .sort((a, b) => (a.rank || 0) - (b.rank || 0))
      .map(src => {
        const covers = !src.unusable && atLeast(src.available, gapAmount);
        const part = parts.find(p => p.id === src.id) || null;
        return {
          id: src.id, available: src.available, unusable: !!src.unusable,
          // What the household is told about this source, and nothing else
          // decides it: it covers the gap alone, it is one leg of the selected
          // combination, or it cannot reach the gap and is not used.
          verdict: covers ? 'covers' : part ? 'contributes' : 'insufficient',
          contributes: part ? part.amount : 0,
          shortBy: Math.max(0, gapAmount - src.available),
        };
      });
    const funding = {
      parts, shortfall, allocated, sources: sourceVerdicts,
      feasible: shortfall <= EPSILON,
      // A single source was enough, or it took a combination.
      needsCombination: parts.length > 1,
      borrowed: parts.filter(p => p.debtId).reduce((s, p) => s + p.amount, 0),
      free: parts.filter(p => !p.debtId).reduce((s, p) => s + p.amount, 0),
    };

    const recovery = Object.assign({}, base, {
      injections: parts.map((p, i) => ({
        date: gapDate, amount: p.amount, id: 'gapFunding' + (i ? '-' + p.id : ''),
        label: `Gap funding — ${p.short}`, debtId: p.debtId,
      })),
      variableFrom: spendFrom,
      measureFrom: gapDate,
    });
    // Re-measured now the injections are known — they change the debt a later
    // payment can reach, so caps taken before them would be the wrong caps.
    applyCaps(recovery, capsFor(recovery));
    const weekly = recommendWeekly(plan, asOf, recovery);
    const result = finish('openingGap', recovery, weekly, spendFrom,
      { amount: gapAmount, date: gapDate, dueOnGapDay, preIncomeOut,
        floor: zero.min.balance, floorDate: zero.min.date }, zero);
    result.funding = funding;
    return result;

    // Build the result, and prove the answer is actually binding: one step up
    // must breach the buffer, and where it breaches is the constraint to name.
    function finish(mode, simOptions, weeklyCap, effectiveFrom, gap, zeroSim) {
      const sim = simulate(plan, asOf, Object.assign({}, simOptions, { weeklyVariable: weeklyCap }));
      const next = simulate(plan, asOf, Object.assign({}, simOptions, { weeklyVariable: weeklyCap + STEP }));
      return {
        mode, weekly: weeklyCap, effectiveFrom, buffer, gap, sim, zero: zeroSim,
        step: STEP,
        // The options behind `sim`, so a caller overriding the weekly figure
        // re-simulates under the same assumptions instead of inventing its own.
        simOptions: simOptions,
        // The assumptions the household actually set, without the recovery the
        // engine derived from them. See where it is built, above.
        planOptions: planOptions,
        // Where the plan is tightest at the recommended level — the day that
        // stops the number being any larger.
        binding: next.min,
        bindingIsReal: below(next.min.balance, buffer),
        holds: atLeast(sim.min.balance, buffer),
      };
    }
  }

  /* ---------------------------------------------- income dependency date */
  // The latest useful date question for an expected income stream: if that
  // stream never arrives, when does the plan first fall below its cash buffer?
  //
  // The page used to answer this for Amanda by running its own second simulation
  // and selecting the first short day itself. That made a real household
  // deadline an untested page-script authority. Keep the counterfactual here,
  // next to the simulation it depends on, and let pages render the result.
  function incomeDeadline(plan, asOf, incomeId, opts) {
    const base = Object.assign({}, opts || {});
    const stream = (plan.income || []).find(s => s.id === incomeId);
    const buffer = base.targetBuffer != null
      ? base.targetBuffer : (plan.defaults.targetBuffer || 0);
    if (!stream) {
      return { incomeId, amount: 0, neededBy: null, buffer,
        breachesWithout: false, endingWithout: null };
    }

    const amount = streamAmount(stream, base) || 0;
    if (!(amount > 0)) {
      return { incomeId, amount: 0, neededBy: null, buffer,
        breachesWithout: false, endingWithout: null };
    }

    const noIncome = simulate(plan, asOf, Object.assign({}, base, {
      incomeOverrides: Object.assign({}, base.incomeOverrides || {}, { [incomeId]: 0 }),
    }));
    const notBefore = base.notBefore || asOf;
    const firstShort = noIncome.daily.find(p =>
      p.date >= notBefore && below(p.balance, noIncome.buffer));

    return {
      incomeId,
      amount,
      neededBy: firstShort ? firstShort.date : null,
      buffer: noIncome.buffer,
      breachesWithout: !!firstShort,
      endingWithout: noIncome.ending,
    };
  }

  // How much of a funding allocation is drawn on one facility. The page used
  // this to decide whether the HELOC risk names a draw; the HELOC alternative
  // uses the same sum to price the counterfactual. One helper, both callers.
  function drawnOn(funding, debtId) {
    return ((funding && funding.parts) || [])
      .filter(p => p.debtId === debtId)
      .reduce((s, p) => s + p.amount, 0);
  }

  /* --------------------------------------------- alternative gap assumptions */
  // "What if the gap were covered differently?" — asked and answered here.
  //
  // `public/plan.js` used to compose both of these itself. It invented a
  // funding source holding `available: Infinity` and re-ran `recommend` to
  // publish "cover the whole gap and it becomes $X/week"; and inside the risk
  // list it chose `fundingDebtId: 'heloc'`, re-ran `recommend` and
  // `projectDebts`, found the resulting crossing and published the date. The
  // arithmetic was always the engine's. What lived in the page was the part
  // that decides: WHICH alternative is worth running, WHAT assumption stands
  // for it, under WHICH scenario, and WHETHER the answer means anything.
  //
  // Two rules make this a coordinator rather than a second scenario engine:
  //
  //   ONE AUTHORITY   every figure comes back through `recommend` and
  //                   `projectDebts`. Nothing is re-derived here.
  //   ONE VARIABLE    each alternative copies `advice.planOptions` verbatim and
  //                   replaces exactly one key, `fundingSources`. The scenario,
  //                   target buffer, income overrides, disabled commitments,
  //                   debt records and extra-debt settings cannot drift from
  //                   the plan on screen, because they are never restated.
  //
  // The assumptions are finite and sourced. Infinite money is not a financial
  // model: it silently replaced the real allocation with an external one, so
  // the "if it were covered" answer quietly dropped the HELOC draw the actual
  // plan makes. Full coverage is instead exactly the shortfall, from outside
  // the declared sources, added to the allocation that already exists.
  function counterfactuals(plan, asOf, advice, debtProj, opts) {
    opts = opts || {};
    // Both alternatives are measured against a real answer and a real debt
    // walk. Assuming either would publish a comparison against nothing.
    if (!advice || !advice.planOptions) {
      throw new Error('counterfactuals requires a recommend() result');
    }
    if (!debtProj) {
      throw new Error('counterfactuals requires the debt projection being shown');
    }

    const base = advice.planOptions;
    const gap = advice.gap || null;
    const funding = advice.funding || null;
    const debts = opts.debts != null ? opts.debts : base.debts;
    // The weekly figure actually on screen, so the alternative debt walk is
    // comparable with the one beside it rather than with the recommendation.
    const weekly = opts.weekly != null ? opts.weekly : advice.weekly;
    const declared = (base.fundingSources || []).slice();

    // The one variable. Everything else is inherited.
    const withFunding = sources =>
      recommend(plan, asOf, Object.assign({}, base, { fundingSources: sources }));

    /* ---- if the whole opening gap were covered ---- */
    function fullGapCoverage() {
      const out = { id: 'fullGapCoverage' };
      // Nothing to cover. Publishing "if it were covered" against no gap
      // describes a problem the household does not have.
      if (!gap || !funding) return Object.assign(out, { applies: false, reason: 'noOpeningGap' });
      // The declared sources already reach it, so the alternative and the plan
      // are the same plan. This is the condition the page expressed as the
      // `unfunded` status verdict; it is the funding result either way.
      if (funding.feasible) {
        return Object.assign(out, { applies: false, reason: 'gapAlreadyFundable' });
      }

      // Exactly the part no declared source can reach, found outside them, as
      // money rather than as borrowing — the assumption is that the household
      // is given or releases the missing amount, not that it takes on more
      // debt. Ranked last, so it receives only what the real allocation leaves
      // and every real source keeps the part it was already given.
      const topUp = funding.shortfall;
      const lastRank = declared.reduce((r, o) => Math.max(r, o.rank || 0), 0);
      const alt = withFunding(declared.concat([{
        id: 'externalCoverage',
        label: 'Money found outside the declared sources',
        short: 'money found outside these accounts',
        available: topUp, debtId: null, rank: lastRank + 1,
      }]));
      const altFunding = alt.funding || { borrowed: 0, allocated: 0, feasible: true };

      return Object.assign(out, {
        applies: true,
        gapAmount: gap.amount,
        // What the declared sources do reach, which is the allocation itself
        // rather than a subtraction done somewhere else.
        fundable: funding.allocated,
        shortfall: topUp,
        // What the assumption supplies, stated so it can be checked against
        // the shortfall rather than taken on trust.
        externalTopUp: topUp,
        weekly: alt.weekly,
        effectiveFrom: alt.effectiveFrom,
        // The alternative's borrowing, and the borrowing the ASSUMPTION adds.
        // The second is zero by construction: external coverage carries no
        // debt id and cannot displace a source ranked above it.
        borrowed: altFunding.borrowed,
        addsBorrowing: altFunding.borrowed - funding.borrowed,
      });
    }

    /* ---- if a credit facility funded the gap instead ---- */
    // WHICH facilities can be asked this is derived from the canonical funding
    // options: a usable option that names a debt record is a facility the
    // household could draw the gap from. No id is chosen here, and none is
    // chosen in a page.
    function gapFundingAlternatives() {
      return declared
        .filter(o => !o.unusable && o.debtId && o.available > 0)
        .sort((a, b) => (a.rank || 0) - (b.rank || 0))
        .map(alternativeFor);
    }

    function alternativeFor(option) {
      const out = { id: 'gapFunding:' + option.id, sourceId: option.id,
        debtId: option.debtId, short: option.short || option.label };
      const no = (reason, extra) =>
        Object.assign(out, { applies: false, reason }, extra || {});

      if (!gap || !funding) return no('noOpeningGap');
      // The plan already draws on this facility to cover the gap, so the debt
      // lines on screen already carry the draw and there is no cheaper path
      // left to contrast it against. Measured per facility rather than as "any
      // borrowing at all", because another facility's draw says nothing about
      // this one.
      if (funding.parts.some(p => p.debtId === option.debtId)) return no('alreadyFunded');

      const current = (debtProj.crossings || [])
        .find(c => c.id === option.debtId && !c.alreadyOver) || null;
      // No limit crossing to move. The alternative may still be worse, but
      // "brings the crossing forward" is not a thing that can be said about it.
      if (!current) return no('noCurrentCrossing');
      const currentCrossing = { date: current.date, day: current.day };

      // The facility funds the gap through its own declared headroom, so an
      // alternative it cannot actually supply is reported as one, not priced.
      // The page used to pass `fundingDebtId` with no sources at all, which
      // took the engine's unattributed-injection fallback and drew the WHOLE
      // gap on the facility however little it held: at a $1,500 buffer the
      // funding card read "Not enough — $975.32 short of the $2,043.16 needed"
      // directly above a risk line pricing a $2,043.16 draw on that same
      // facility, and the crossing date it published was manufactured by the
      // overdraw.
      const alt = withFunding([option]);
      const altFunding = alt.funding || null;
      if (!altFunding || !altFunding.feasible) {
        return no('sourceCannotCoverGap', {
          currentCrossing, gapAmount: gap.amount, available: option.available,
          shortBy: Math.max(0, gap.amount - option.available),
        });
      }

      const draw = drawnOn(altFunding, option.debtId);
      // The same debt walk the page shows, under the same weekly figure and the
      // same facilities — only the funding assumption differs. Walked once, so
      // the draw appears in the projection exactly where the injection put it.
      const moved = projectDebts(plan, debts, asOf, Object.assign({}, alt.simOptions, {
        weeklyVariable: weekly,
        extraFacilities: opts.extraFacilities,
        extraDebtTarget: base.extraDebtTarget,
      }));
      const crossing = (moved.crossings || [])
        .find(c => c.id === option.debtId && !c.alreadyOver) || null;
      // Borrowing on a facility can only bring its own crossing nearer or leave
      // it where it is. If it does not move it, there is no alternative date to
      // publish, and naming the same day as though it were news would be one.
      if (!crossing || !(crossing.date < current.date)) {
        return no('noEarlierCrossing', { currentCrossing, draw });
      }

      return Object.assign(out, {
        applies: true,
        draw,
        currentCrossing,
        alternateCrossing: { date: crossing.date, day: crossing.day },
        daysEarlier: diffDays(crossing.date, current.date),
        // What this alternative would be used INSTEAD of — the sources the real
        // allocation uses today. The page named "her account" in a fallback
        // string; which source is displaced is a fact about the allocation.
        displaces: funding.parts.map(p => p.short),
      });
    }

    return {
      fullGapCoverage: fullGapCoverage(),
      gapFundingAlternatives: gapFundingAlternatives(),
    };
  }

  /* ------------------------------------------------- household budget */
  // What the weekly household cap actually has to cover.
  //
  // Three concepts, kept apart because conflating them is how a plan ends up
  // double-counting its own bills:
  //
  //   DATED       a known bill or commitment sitting on the calendar with a
  //               real date. Already in the forecast as an event. NOT part of
  //               the weekly cap.
  //   ESSENTIAL   normal life that has no reliable date — groceries, fuel,
  //               phones. Comes out of the weekly cap FIRST.
  //   DISCRETIONARY  dining, shopping, entertainment. What is left of the cap.
  //
  // Amounts are derived from the generated spending history in periods.json,
  // never copied into data.json — one fact, one home. data.json carries only
  // the classification and any owner override.
  //
  // Where a category also has dated items pointing at it (Shaw inside Telecom,
  // the lacrosse fees inside Sport), the dated amount is SUBTRACTED from the
  // historical average. Without that the plan pays Shaw twice: once on the
  // calendar and once inside a telecom average that already contains it.
  function budgetBreakdown(plan, periods, opts) {
    opts = opts || {};
    const budget = plan.budget;
    if (!budget || !periods) return null;
    const basis = opts.basis || budget.basis || 'ytd';
    const window = periods.periods && periods.periods[basis];
    if (!window) return null;

    const perMonth = label => {
      const row = (window.spending || []).find(s => s.label === label);
      return row ? row.total / window.months : 0;
    };
    // A month of window, for turning dated items into a monthly equivalent.
    const monthsInWindow = (plan.windowDays || 91) / (365.25 / 12);
    const billMonthly = b => b.frequency === 'biweekly' ? b.amount * 26 / 12
      : b.frequency === 'once' ? b.amount / monthsInWindow : b.amount;

    // Dated items declare which variable category they would otherwise sit in.
    const datedByCategory = {};
    const addDated = (cat, amount, label, kind) => {
      if (!cat) return;
      (datedByCategory[cat] = datedByCategory[cat] || { total: 0, items: [] });
      datedByCategory[cat].total += amount;
      datedByCategory[cat].items.push({ label, amount, kind });
    };
    for (const b of plan.bills || []) addDated(b.budgetCategory, billMonthly(b), b.label, 'bill');
    // A dated commitment is NOT automatically a draw against the recurring
    // budget for its category. The household budgets ~$250/month of ordinary
    // sports and activities AND saves separately for the Fusion and Burrard
    // fees; netting the season fees off the recurring line concluded that
    // normal sports spending was $0, which is not what the household budgeted.
    // Sinking-fund commitments are therefore tracked apart, not subtracted.
    const sinking = { total: 0, items: [] };
    for (const c of plan.commitments || []) {
      if ((opts.disabled || []).indexOf(c.id) >= 0) continue;
      const perMonth = c.amount / monthsInWindow;
      if (c.sinkingFund) {
        sinking.total += perMonth;
        sinking.items.push({ label: c.label, amount: perMonth, category: c.budgetCategory });
        continue;
      }
      addDated(c.budgetCategory, perMonth, c.label, 'commitment');
    }

    const categories = (budget.categories || []).map(c => {
      const historical = (c.from || []).reduce((s, label) =>
        s + (label === '@paypal' ? (opts.paypalPerMonth || 0) : perMonth(label)), 0);
      const dated = datedByCategory[c.id] || { total: 0, items: [] };
      // An owner target, when one exists, beats the historical average. The
      // household deciding what it intends to spend is better evidence about
      // the next 90 days than a description of the last eighteen months.
      const target = c.plannedMonthly != null ? c.plannedMonthly : null;
      const gross = target != null ? target : historical;
      const planned = Math.max(0, gross - dated.total);
      const sinkingHere = sinking.items.filter(s => s.category === c.id)
        .reduce((a, s) => a + s.amount, 0);
      return Object.assign({}, c, {
        historical, dated: dated.total, datedItems: dated.items, target,
        // gross is the pre-dated monthly amount — owner target if one exists,
        // otherwise the historical average. planned is that amount after dated
        // items are netted off, and is what the weekly cap consumes.
        gross, planned,
        // Dated commitments saved for separately. Reported, never netted off
        // the recurring line for the same category.
        sinking: sinkingHere,
        // A category whose dated items already exceed its historical average is
        // fully accounted for on the calendar — the dated figure is the better
        // current authority and nothing extra belongs in the weekly cap.
        fullyDated: dated.total > 0 && gross - dated.total <= 0,
        source: target != null ? 'owner-target' : 'historical-actual',
      });
    });

    const sum = (pred, field) => categories.filter(pred)
      .reduce((s, c) => s + c[field || 'planned'], 0);
    const isClass = k => c => c.class === k;

    const discretionaryMonthly = sum(isClass('discretionary'));
    // What the cap must cover before anything optional happens.
    const requiredMonthly = sum(c => c.class === 'essential' || c.class === 'unknown');

    return {
      basis, basisLabel: window.label, months: window.months, categories,
      essentialMonthly: sum(isClass('essential')),
      discretionaryMonthly,
      unknownMonthly: sum(isClass('unknown')),
      reserveMonthly: sum(isClass('reserve')),
      datedMonthly: categories.reduce((s, c) => s + c.dated, 0),
      historicalMonthly: categories.reduce((s, c) => s + c.historical, 0),
      // Major dated commitments the household saves for rather than absorbing
      // into a monthly line — the lacrosse season, camps, registrations.
      sinkingMonthly: sinking.total,
      sinkingItems: sinking.items,
      ownerTargetCount: categories.filter(c => c.target != null).length,
      requiredMonthly,
      // The weekly cap measured against all of that, when a caller says which
      // cap is on screen. Null when none was given — a caller that has not
      // named a cap is asking about the categories, not for a verdict on one.
      cap: againstCap(categories, requiredMonthly, discretionaryMonthly, opts),
    };
  }

  /* ------------------------------- the cap in weeks and months, and the room */
  // The household reads a WEEKLY figure; the budget is derived in MONTHS. One
  // conversion sits between them, and it decides a published verdict:
  // "Discretionary room — nothing left. The cap is below what normal life
  // costs."
  //
  // `public/plan.js` owned all of it — its own `WEEKS_PER_MONTH`, `perWeek()`,
  // `recMonthly`, `optional` and `short` — so no test could reach any of it. The
  // constant could be changed from 4.35 to 4.00, moving every budget-derived
  // /wk figure the page publishes by about 8%, and `npm test` stayed green.
  //
  // A month is a year divided by twelve and a week is seven days, so the only
  // honest conversion is the calendar's own: 365.25 / 12 / 7 ≈ 4.3482 weeks a
  // month, Gregorian leap years included.
  //
  // The constant is deliberately NOT exported. A test importing it would prove
  // the engine agrees with itself; the suites re-derive it from the calendar,
  // which is what makes them able to disagree.
  const WEEKS_PER_MONTH = 365.25 / 12 / 7;

  // A weekly cap said in months. Separate from the block below because it needs
  // no budget: `budgetBreakdown` returns null when the spending history has not
  // loaded, and both the Plan page's cap tile and the published-figures
  // snapshot state the monthly equivalent whether or not that history is there.
  // Without this they would each need the constant back.
  function monthlyFromWeekly(weekly) { return weekly * WEEKS_PER_MONTH; }

  function againstCap(categories, requiredMonthly, discretionaryMonthly, opts) {
    const weekly = opts.weeklyCap;
    if (weekly == null) return null;
    const perWeek = m => m / WEEKS_PER_MONTH;
    const monthly = monthlyFromWeekly(weekly);

    const cat = id => categories.find(c => c.id === id)
      || { planned: 0, historical: 0, gross: 0, source: 'historical-actual' };
    const groceries = cat('groceries'), fuel = cat('fuel');
    const foodFuelPlannedMonthly = groceries.planned + fuel.planned;
    const foodFuelHistoricalMonthly = groceries.historical + fuel.historical;
    // Pre-dated monthly amounts and owner-target state are already decided
    // on each category. This block publishes the grocery/fuel pair; it does
    // not choose target vs historical again. planned stays the post-dated
    // amount the weekly cap uses.
    const groceriesMonthly = groceries.gross;
    const fuelMonthly = fuel.gross;
    const groceriesHasOwnerTarget = groceries.source === 'owner-target';

    // Whether the cap leaves anything once the essentials are paid. Measured
    // with the engine's own epsilon rather than the page's bare comparison of
    // two unrounded monthly sums: a cap a hundredth of a cent under the
    // essential need published "nothing left — the cap is below what normal
    // life costs" beside a shortfall of $0/week. Half a cent is finer than any
    // of these figures is published to, so within it the cap MEETS the need.
    const hasDiscretionaryRoom = atLeast(monthly, requiredMonthly);
    const discretionaryRoomMonthly = Math.max(0, monthly - requiredMonthly);
    const essentialShortfallMonthly = Math.max(0, requiredMonthly - monthly);
    const householdDiscretionaryWeekly = perWeek(discretionaryMonthly);

    // The room the cap leaves, against what the household budgets for those
    // categories. This was a SIGNED difference, and that was the wrong shape:
    // the page rendered it unconditionally as "the plan is $Y/wk short of it
    // and something has to give", so a cap leaving MORE room than the budget
    // published "the plan is −$28/wk short of it". Not theoretical — the
    // weekly box has no upper bound, and on the published plan any setting
    // above about $1,771/week reaches it.
    //
    // So: a magnitude that is never negative, and a verdict naming which side
    // it falls on. The page cannot pick the wrong sentence because it is not
    // handed a number whose sign it has to interpret. `meets` is the
    // half-cent band, compared in the unit this sentence publishes.
    const roomWeekly = perWeek(discretionaryRoomMonthly);
    const roomVersusHousehold = {
      verdict: below(roomWeekly, householdDiscretionaryWeekly) ? 'short'
        : below(householdDiscretionaryWeekly, roomWeekly) ? 'exceeds'
          : 'meets',
      weekly: Math.abs(householdDiscretionaryWeekly - roomWeekly),
    };

    const inCapMonthly = requiredMonthly + discretionaryMonthly;

    return {
      // The figure on screen, and the one the recommender solved for. They
      // differ whenever the household has set its own weekly figure, and the
      // budget must be measured against what is being SHOWN — comparing the
      // essentials against a recommendation the page is not displaying
      // describes a plan nobody is looking at.
      weekly,
      recommendedWeekly: opts.recommendedWeekly != null ? opts.recommendedWeekly : null,
      isOverride: opts.recommendedWeekly != null && weekly !== opts.recommendedWeekly,
      monthly,

      essentialMonthly: requiredMonthly,
      essentialWeekly: perWeek(requiredMonthly),

      hasDiscretionaryRoom,
      discretionaryRoomMonthly,
      discretionaryRoomWeekly: perWeek(discretionaryRoomMonthly),
      essentialShortfallMonthly,
      essentialShortfallWeekly: perWeek(essentialShortfallMonthly),

      groceriesPlannedWeekly: perWeek(groceries.planned),
      fuelPlannedWeekly: perWeek(fuel.planned),
      foodFuelPlannedMonthly, foodFuelPlannedWeekly: perWeek(foodFuelPlannedMonthly),
      foodFuelHistoricalMonthly,
      foodFuelHistoricalWeekly: perWeek(foodFuelHistoricalMonthly),
      groceriesMonthly, fuelMonthly, groceriesHasOwnerTarget,

      // What the household's own discretionary budget asks for, and how the
      // room the cap leaves compares with it.
      householdDiscretionaryWeekly,
      roomVersusHousehold,

      inCapMonthly,
      overCapMonthly: Math.max(0, inCapMonthly - monthly),
    };
  }

  /* ------------------------------------------------------ debt projection */
  // Cash and debt are the same story told from two sides, so they are walked
  // together over one event stream. A payment that leaves the chequing account
  // must arrive somewhere: every obligation names the debt it moves and what it
  // does to it, and an "extra debt payment" that only reduced cash would be a
  // rounding error dressed up as progress.
  //
  //   payment     leaves cash, reduces the named balance
  //   capitalise  moves no cash, INCREASES the named balance (the HELOC)
  //
  // Interest: the mortgage and the HELOC already carry theirs as events — the
  // mortgage inside its payment, the HELOC as the monthly capitalising charge —
  // so accruing on top would count it twice. The cards do not, so theirs is
  // accrued daily at the card rate.
  //
  // The projection assumes NO new card spending: the weekly cap is a cash
  // instruction, and these balances only fall if it is honoured in cash.
  function projectDebts(plan, debts, asOf, opts) {
    opts = opts || {};
    // Facilities that are not debt records but do carry revolving headroom —
    // the chequing overdraft. Held CONSTANT across the window on purpose: its
    // usage tracks the Chequing B balance, which the cash simulation already
    // governs, so projecting it here would model the same money twice. It is
    // included so that "revolving credit left" means the same thing in the
    // Today tile and in the scoreboard; omitting it made those disagree by
    // $82.28 under one label.
    const extraAvailable = (opts.extraFacilities || [])
      .reduce((s, e) => s + Math.max(0, e.limit - (e.used + (e.pending || 0))), 0);
    const days = plan.windowDays || 91;
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const byId = {};
    const state = (debts || []).map(x => {
      // Carrying pending charges from the opening balance is what makes
      // headroom, over-limit state and interest all agree with what the
      // institution would say today. The rule itself is `openingBalance`.
      const pending = x.pending || 0;
      const opening = openingBalance(x);
      const s = {
        id: x.id, label: x.label, secured: !!x.secured, rate: x.rate || 0,
        limit: x.limit, opening, balance: opening,
        postedBalance: x.balance, pending,
        interestByEvent: !!x.interestByEvent, principalShare: x.principalShare,
        interest: 0, paid: 0, capitalised: 0, drawn: 0,
        // The day the balance actually crosses the limit. Tracked on the daily
        // walk, not read off the 30-day snapshots — the HELOC crosses on
        // 30 September and the next snapshot is 7 October, so reporting the
        // snapshot puts the breach in the wrong month and on the wrong side of
        // the plan's own deadline.
        firstOver: null,
      };
      byId[x.id] = s;
      return s;
    });

    const targetFor = id => {
      const o = (plan.obligations || []).find(x => x.id === id);
      return o && o.debtId ? byId[o.debtId] : null;
    };
    // An extra payment must name its target, or it is not a debt payment.
    const extraTarget = opts.extraDebtTarget ? byId[opts.extraDebtTarget] : null;

    // Where a payment goes once the debt it names is gone.
    //
    // `simulate` has ALREADY taken the full amount out of cash by the time this
    // runs, so clamping a balance at zero here does not save the money — it
    // deletes it. At $2,000/month against the Cash Back Visa, $6,340.00 left
    // the account and only $5,737.68 of card and interest existed to receive
    // it; the remaining $602.32 reduced nothing, and the forecast reported both
    // a lower cap and a lower ending balance for a household that had in fact
    // cleared the card early. Cash out and debt down are the same money seen
    // from two sides, which is the coupling this engine exists to hold.
    //
    // The order is not invented here. `plan.nextDollar` rank 7 is "direct
    // verified surplus to the highest effective-cost consumer debt", so the
    // chain is the unsecured facilities by rate, the named target first. If
    // every consumer debt is cleared the remainder falls to the HELOC — the
    // only other revolving facility, and rank 6 is "stop new HELOC and
    // revolving growth". Nothing is ever discarded, so the identity holds
    // however large the payment is.
    const chainFrom = head => {
      const rest = state
        .filter(s => !s.secured && s !== head)
        .sort((a, b) => (b.rate || 0) - (a.rate || 0));
      return [head, ...rest, byId.heloc].filter(Boolean);
    };
    // Pays `amount` down `chain`, absorbing what each balance can take and
    // passing the rest on. Returns whatever no facility could absorb, which is
    // only ever non-zero when the household has no debt left at all.
    const payDown = (chain, amount) => {
      let left = amount;
      for (const s of chain) {
        if (left <= 0) break;
        const take = Math.min(left, s.balance);
        if (take <= 0) continue;
        s.balance -= take;
        s.paid += take;
        left -= take;
      }
      return left;
    };

    const marks = [];
    // Cash that left the account for debt and found no balance to reduce —
    // only possible once every facility is at zero. Reported rather than
    // swallowed, because a non-zero value here means cash out and debt down
    // have stopped agreeing and the caller needs to know which way.
    let unabsorbed = 0;
    // How much of each extra payment found a balance, by date. Handed back so
    // the cash simulation can spend exactly this and not the amount asked for.
    const extraAbsorbed = {};
    // The same, for dated minimums, keyed by date and obligation id — one
    // obligation can fall several times in a window.
    const obligationAbsorbed = {};
    const snapshot = (day, date) => ({
      day, date,
      debts: state.map(s => ({
        id: s.id, label: s.label, secured: s.secured, balance: s.balance,
        limit: s.limit, postedBalance: s.postedBalance, pending: s.pending,
        available: s.limit != null ? Math.max(0, s.limit - s.balance) : null,
        overLimit: s.limit != null && s.balance > s.limit,
        overLimitBy: s.limit != null ? Math.max(0, s.balance - s.limit) : 0,
        interest: s.interest, paid: s.paid, drawn: s.drawn, firstOver: s.firstOver,
      })),
      consumer: state.filter(s => !s.secured).reduce((a, s) => a + s.balance, 0),
      secured: state.filter(s => s.secured).reduce((a, s) => a + s.balance, 0),
      heloc: byId.heloc ? byId.heloc.balance : 0,
      // Revolving headroom across every facility that has a limit.
      headroom: state.filter(s => s.limit != null)
        .reduce((a, s) => a + Math.max(0, s.limit - s.balance), 0) + extraAvailable,
      overLimitCount: state.filter(s => s.limit != null && s.balance > s.limit).length,
      interestToDate: state.reduce((a, s) => a + s.interest, 0),
    });
    marks.push(snapshot(0, start));

    const byDate = new Map();
    for (const e of events) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }

    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      // Card interest accrues daily; the two secured debts carry theirs as
      // events and are skipped here so nothing is charged twice.
      for (const s of state) {
        if (s.interestByEvent || !s.rate) continue;
        const daily = s.balance * (s.rate / 100) / 365;
        s.balance += daily;
        s.interest += daily;
      }
      for (const e of byDate.get(date) || []) {
        if (e.kind === 'injection') {
          // Cash arriving from outside the plan. One movement, but possibly
          // several origins — each borrowed portion has to land on the facility
          // it was drawn from.
          for (const part of e.parts || [{ amount: e.amount, debtId: e.debtId }]) {
            if (part.debtId && byId[part.debtId]) {
              byId[part.debtId].balance += part.amount;
              byId[part.debtId].drawn += part.amount;
            }
          }
          continue;
        }
        if (e.kind === 'noncash') {
          const t = targetFor(e.id);
          // A capitalising charge grows the balance it is charged on.
          if (t) { t.balance += -e.amount; t.capitalised += -e.amount; t.interest += -e.amount; }
          continue;
        }
        if (e.kind === 'obligation') {
          const t = targetFor(e.id);
          if (!t) continue;
          const amount = -e.amount;
          // An amortising payment is part interest, part principal; only the
          // principal share moves the balance. The interest share is a real
          // cost, so it is not carried on to another debt.
          const principal = t.principalShare != null ? amount * t.principalShare : amount;
          // The interest share of an amortising payment is a real cost and is
          // genuinely paid, so it counts as absorbed even though it moves no
          // balance. Only the principal has to find somewhere to land.
          const interestShare = t.principalShare != null ? amount - principal : 0;
          if (interestShare) { t.interest += interestShare; t.paid += interestShare; }
          // Its NAMED balance only — never the cascade. A minimum is a demand
          // from one lender about one account: when that account is paid off
          // the bank does not take the payment, and it certainly does not move
          // it to a different card. Redirecting it here paid $170 to the TD
          // credit card on 1 November for a Cash Back Visa that had been at
          // zero since 30 October, which is a decision no one made.
          //
          // The cascade is for EXTRA payments, where the household has chosen
          // to put surplus at debt and `plan.nextDollar` says where it should
          // go next. The two look alike in the ledger and are not alike at all.
          const left = payDown([t], principal);
          unabsorbed += left;
          obligationAbsorbed[e.date + ':' + e.id] = amount - left;
        } else if (e.kind === 'extra' && extraTarget) {
          const left = payDown(chainFrom(extraTarget), -e.amount);
          unabsorbed += left;
          // What this payment could actually land, for the cash side to match.
          extraAbsorbed[e.date] = -e.amount - left;
        }
      }
      for (const s2 of state) {
        if (s2.firstOver == null && s2.limit != null && s2.balance > s2.limit) s2.firstOver = date;
      }
      const dayNo = i + 1;
      if (dayNo === 30 || dayNo === 60 || dayNo === 90 || dayNo === days) {
        if (!marks.some(m => m.date === date)) marks.push(snapshot(dayNo, date));
      }
    }

    return {
      marks, byId, end, unabsorbed, extraAbsorbed, obligationAbsorbed,
      // Every facility that is over its limit at some point, on the day it
      // actually happens rather than at the next 30-day snapshot. A facility
      // already over the limit today is a different problem from one that
      // crosses on its own inside the window, so they are marked apart.
      crossings: state.filter(s => s.firstOver)
        .map(s => ({ id: s.id, label: s.label, date: s.firstOver, limit: s.limit,
          day: diffDays(start, s.firstOver),
          alreadyOver: s.limit != null && s.opening > s.limit }))
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
      // Everything an extra payment did NOT reach, so an untargeted one is
      // visible rather than silently vanishing into cash.
      untargetedExtra: opts.extraDebtMonthly > 0 && !extraTarget,
    };
  }

  /* ------------------------------------------------ next due obligation */
  // Which named cash obligation the household owes next, from the SAME
  // expandEvents stream the Plan calendar and nextPaymentOut already read.
  //
  // This used to select from a hand-kept `upcoming` list. That list drifted
  // from the Plan — HELOC 21st vs month-end, Fortis 1st vs 3rd — which is the
  // B74 defect. Eligibility is now the cash-outflow rule, identical to
  // nextPaymentOut:
  //
  //   INFLOW     amount >= 0. Money arriving is not a payment due.
  //   NONCASH    capitalised interest. A real cost, but no cash leaves.
  //   BEFORE     date < as-of. The tile answers what is next, not what already
  //              left.
  //
  // Earliest eligible date wins. Where two share that date, stream order
  // decides — the forward scan keeps the first and a later equal date never
  // displaces it. That is ONE named obligation. What the whole day costs is
  // nextPaymentOut, which sums every eligible event on that same date.
  function nextDue(events, asOf) {
    let best = null;
    for (const event of events || []) {
      if (!(event.amount < 0) || event.kind === 'noncash' || event.date < asOf) continue;
      if (!best || event.date < best.date) best = event;
    }
    if (!best) return null;
    return {
      due: best.date,
      what: best.label,
      amount: -best.amount,
      daysUntil: diffDays(asOf, best.date),
    };
  }

  /* ------------------------------------------ next payment out */
  // The Plan page tile: the next day cash leaves the household accounts, and
  // ALL of it. Two registrations on one day are one payment as far as the
  // account is concerned; showing the larger of them understates what has to
  // be there.
  //
  // `public/plan.js` used to decide this from `sim.events`: it filtered cash
  // outflows on or after as-of, took the earliest date, and summed every event
  // on that date. Mutating the sum to the single largest outflow left
  // `npm test` green — the mutation B73 recorded, because no test could reach
  // the page expression.
  //
  // Eligibility, unchanged from what the page already meant:
  //
  //   INFLOW     amount >= 0. Money arriving is not a payment out.
  //   NONCASH    capitalised interest. A real cost, but no cash leaves.
  //   BEFORE     date < as-of. The tile answers what is next, not what already
  //              left.
  //
  // Earliest eligible date wins. The day's cash-out is the sum of every
  // eligible event on that date, as a positive amount. One event keeps its
  // own label; several share a count-and-stem label taken from the first
  // event in stream order. Distinct from `nextDue`, which names one
  // obligation from this same stream rather than the day's cash-out total.
  function nextPaymentOut(events, asOf) {
    let date = null;
    const sameDay = [];
    for (const event of events || []) {
      if (!(event.amount < 0) || event.kind === 'noncash' || event.date < asOf) continue;
      if (date == null || event.date < date) {
        date = event.date;
        sameDay.length = 0;
        sameDay.push(event);
      } else if (event.date === date) {
        sameDay.push(event);
      }
    }
    if (!date) return null;
    const dayTotal = sameDay.reduce((cash, event) => cash + event.amount, 0);
    return {
      date,
      amount: -dayTotal,
      count: sameDay.length,
      label: sameDay.length === 1
        ? sameDay[0].label
        : `${sameDay.length} payments — ${sameDay[0].label.replace(/ —.*$/, '')} and others`,
      daysUntil: diffDays(asOf, date),
    };
  }

  /* ------------------------------------------ unallocated / free cash */
  // The Plan page ledger under "what the ending cash is actually for": convert
  // the monthly reserve into the forecast window, subtract the target buffer
  // and those reserves from ending cash, and say whether anything left is free
  // cash or is not spending money.
  //
  // `public/plan.js` used to decide this: `reserveMonthly * (windowDays /
  // (365.25 / 12))`, then `ending - buffer - reserves`, then `unallocated <= 0`
  // for the sentence. Halving that window conversion left `npm test` green —
  // the mutation B73 recorded, because no test could reach the page.
  //
  // The conversion is the calendar's own month: 365.25 / 12 days. A 91-day
  // window is 91 / (365.25 / 12) months of reserve, not a rounded 3. The
  // constant is written here rather than imported from WEEKS_PER_MONTH so a
  // test can re-derive 365.25 / 12 from the calendar and disagree.
  //
  // The leftover verdict is on the PUBLISHED cent, not on a bare float.
  // money2 formats the absolute value to two decimals; a leftover of four
  // tenths of a cent therefore prints $0.00. The old `unallocated > 0` still
  // called that "not spending money" — a sentence that claims leftover cash
  // beside a figure that says there is none. Half a cent of the engine's
  // EPSILON would miss the other side: 0.005 prints $0.01. So: round the
  // absolute value the way the page prints it, then restore the sign.
  function unallocatedCash(sim, budget, plan) {
    sim = sim || {};
    plan = plan || {};
    const ending = sim.ending;
    const buffer = sim.buffer;
    const windowDays = plan.windowDays;
    const reserveMonthly = budget && budget.reserveMonthly != null ? budget.reserveMonthly : 0;
    const monthsInWindow = windowDays / (365.25 / 12);
    const reserves = reserveMonthly * monthsInWindow;
    const amount = ending - buffer - reserves;
    const absCents = Math.round(Math.abs(Number(amount)) * 100);
    const hasFreeCash = amount > 0 && absCents > 0;
    return {
      ending, buffer, reserves, amount,
      id: hasFreeCash ? 'leftover' : 'none',
      negative: amount < 0 && absCents > 0,
    };
  }

  // A month of interest is a twelfth of the recorded annual figure. Compact
  // snapshot uses this for every facility together; Deep Dive uses it for the
  // mortgage line the period block used to hardcode. One conversion, both
  // callers — `/ 12` written twice would be a second calculation of the
  // same fact.
  function monthOfAnnual(annual) {
    return (annual || 0) / 12;
  }

  /* ------------------------------------------ compact snapshot */
  // The Plan page's small tiles: secured debt, monthly interest across every
  // facility, and whether the HELOC is still growing. `public/plan.js` used
  // to decide all three — sum secured balances, divide annual interest by
  // 12, subtract the last two HELOC history points and take `>= 0` as
  // "still growing". Changing `/ 12` to `/ 6` left `npm test` green — the
  // mutation B73 recorded, because no test could reach the page.
  //
  // Consumer debt on the same strip already reads the projected day-zero
  // figure (`today.consumer`); this function does not re-sum it. Revolving
  // headroom already belongs to `utilisation`.
  //
  // A month of interest is a twelfth of the annual figure the debt records
  // already carry. The HELOC trend is last month minus the month before.
  // The published tile rounds that delta to whole dollars (`money()`), so
  // the verdict follows that dollar: a $0.40 move prints $0, and calling
  // that "still growing" is the same contradiction the unallocated remainder
  // had at four tenths of a cent. Exact zero, and any delta that rounds to
  // zero, is unchanged — not growth.
  function compactSnapshot(debts, helocHistory) {
    let secured = 0;
    let annualInterest = 0;
    for (const debt of debts || []) {
      if (debt.secured) secured += debt.balance || 0;
      annualInterest += debt.annualInterest || 0;
    }
    const monthlyInterest = monthOfAnnual(annualInterest);
    const history = helocHistory || [];
    let heloc = null;
    if (history.length >= 2) {
      const delta = history[history.length - 1].v - history[history.length - 2].v;
      const dollars = Math.round(Math.abs(Number(delta)));
      heloc = {
        delta,
        id: dollars === 0 ? 'unchanged' : (delta > 0 ? 'growing' : 'falling'),
      };
    }
    return { secured, monthlyInterest, heloc };
  }

  /* ------------------------------------------ publication totals */
  // Deep Dive tiles, Records net-worth lines, the income footer, the
  // commitments total and the lacrosse verified total used to be stored
  // independently in `data.json` even though every input they need is
  // already a canonical row: debt balances and annual-interest figures,
  // asset values, income line totals, commitment item amounts, lacrosse
  // source amounts, and `Forecast.utilisation` for revolving headroom.
  // Those copies had already drifted. The stored "Credit left, everywhere"
  // tile was $1,415.95 against utilisation's $1,415.98 — three cents, and
  // the same disagreement the upcoming note and positions.csv had already
  // resolved by reading utilisation.
  //
  // This function is addition plus a call to utilisation. It does not
  // price a debt, project cash, or invent a second headroom rule. The
  // captured-income window is the 18 months the Deep Dive footer already
  // names; the monthly figure is that total rounded to a dollar, which is
  // what the stored `incomeTotal.perMonth` was. Pages format the returned
  // numbers. data.json keeps the rows being summed.
  const INCOME_CAPTURE_MONTHS = 18;

  function publicationTotals(data) {
    data = data || {};
    const debts = data.debts || [];
    const assets = data.assets || [];
    let totalDebt = 0;
    let annualInterest = 0;
    let annualInterestExMortgage = 0;
    let helocLimit = null;
    for (const debt of debts) {
      totalDebt += debt.balance || 0;
      const annual = debt.annualInterest || 0;
      annualInterest += annual;
      if (debt.id !== 'mortgage') annualInterestExMortgage += annual;
      if (debt.id === 'heloc' && debt.limit != null) helocLimit = debt.limit;
    }
    const assetTotal = assets.reduce((s, a) => s + (a.value || 0), 0);
    const incomeTotal = (data.income || []).reduce((s, row) => s + (row.total || 0), 0);
    const commitmentsTotal = ((data.commitments && data.commitments.items) || [])
      .reduce((s, item) => s + (item.amount || 0), 0);
    const lacrosseVerified = ((data.lacrosse && data.lacrosse.sources) || [])
      .reduce((s, row) => s + (row.amount || 0), 0);
    const revolving = utilisation(debts, data.revolvingExtra);
    return {
      totalDebt,
      annualInterest,
      annualInterestExMortgage,
      monthlyInterest: monthOfAnnual(annualInterest),
      monthlyInterestExMortgage: monthOfAnnual(annualInterestExMortgage),
      creditLeft: revolving.totalAvailable,
      revolvingFacilityCount: revolving.rows.length,
      assets: assetTotal,
      financialAccountsOnly: assetTotal - totalDebt,
      incomeTotal,
      incomePerMonth: Math.round(incomeTotal / INCOME_CAPTURE_MONTHS),
      incomeMonths: INCOME_CAPTURE_MONTHS,
      commitmentsTotal,
      lacrosseVerified,
      helocLimit,
    };
  }

  /* ------------------------------------------ Deep Dive derived totals */
  // The Deep Dive page used to decide the remaining household-facing
  // figures B73 recorded as item 8: grouping and totalling `heldElsewhere`,
  // averaging a period's spending, totalling discretionary spend and its
  // share, totalling avoidable fees, flagging Cash Back Visa cycles that
  // do not fit the card's rate, summing implied and charged interest, and
  // hardcoding "~$1,620/month" for the mortgage and `26.99` for the card.
  // Widening the ±4pp fit test to 40, swapping the footer rate, halving
  // the elsewhere total, doubling the monthly average, and replacing
  // $1,620 with $1,000 left `npm test` green — ALL 22 SUITES PASSED —
  // because no test could reach the page.
  //
  // This coordinator does not walk cash or re-price a card. Spendable cash
  // is `plan.startingCash.amount`. The card rate is the Cash Back Visa
  // debt record. A month of mortgage interest is `monthOfAnnual` on that
  // debt's `annualInterest` — the same twelfth compactSnapshot uses.
  // The ±4 percentage-point fit band is the incumbent page rule, kept
  // here rather than restated.
  //
  // `period` is the selected `periods.periods` entry. Without one the
  // period block is omitted; `renderPeriod` passes the period on screen.
  const INTEREST_FIT_PP = 4;

  function deepDive(data, period) {
    data = data || {};
    const cash = (data.plan && data.plan.startingCash) || {};
    const held = cash.heldElsewhere || [];
    const byClass = {};
    const classOrder = [];
    let elsewhere = 0;
    for (const h of held) {
      const cls = h.class || 'unknown';
      if (!byClass[cls]) {
        byClass[cls] = { class: cls, total: 0, labels: [] };
        classOrder.push(cls);
      }
      byClass[cls].total += h.value;
      byClass[cls].labels.push(h.label);
      elsewhere += h.value;
    }

    const card = (data.debts || []).find(d => d.id === 'cashback') || null;
    const ic = data.interestCheck || null;
    let interest = null;
    if (ic) {
      if (!card || card.rate == null) {
        throw new Error('deepDive interest check requires the Cash Back Visa rate');
      }
      const rate = card.rate;
      const rows = (ic.rows || []).map(r => ({
        stmt: r.stmt,
        avg: r.avg,
        implied: r.implied,
        charged: r.charged,
        eff: r.eff,
        off: Math.abs(r.eff - rate) > INTEREST_FIT_PP,
      }));
      interest = {
        rate,
        rows,
        impliedTotal: rows.reduce((s, r) => s + r.implied, 0),
        chargedTotal: rows.reduce((s, r) => s + r.charged, 0),
      };
    }

    const mortgage = (data.debts || []).find(d => d.id === 'mortgage') || null;
    const mortgageMonthly = mortgage && mortgage.annualInterest != null
      ? monthOfAnnual(mortgage.annualInterest) : null;

    let periodSnap = null;
    if (period) {
      const spendingTotal = period.spendingTotal || 0;
      const months = period.months || 0;
      const discretionary = (period.spending || [])
        .filter(s => s.type === 'discretionary')
        .reduce((a, b) => a + b.total, 0);
      const avoidable = (period.fees || [])
        .filter(s => s.type === 'avoidable')
        .reduce((a, b) => a + b.total, 0);
      periodSnap = {
        spendingTotal,
        interestTotal: period.interestTotal || 0,
        feesTotal: period.feesTotal || 0,
        months,
        spendingMonthly: months > 1 ? spendingTotal / months : null,
        discretionary,
        discretionaryShare: discretionary / (spendingTotal || 1) * 100,
        avoidable,
      };
    }

    return {
      cashAmount: cash.amount,
      elsewhere,
      classes: classOrder.map(k => byClass[k]),
      interest,
      mortgageMonthly,
      period: periodSnap,
    };
  }

  /* ------------------------------- what the plan is, read one way, once ---- */
  // The two household-facing verdicts at the top of the Plan page — the status
  // band and the mission sentence — are decided from the same four facts: the
  // opening gap, whether it can be funded, the weekly figure in force, and the
  // simulation being shown at it. They are computed HERE, once, and both
  // verdicts consume the result.
  //
  // That is the whole point of this function. `public/plan.js` used to work
  // `fundingShort` and `overrideBreaches` out for itself, hand-copying `below()`
  // and EPSILON as `sim.min.balance < sim.buffer - 0.005`, while the mission
  // computed the same two predicates in here from the same inputs. Two copies
  // of one judgement is not a style problem: the mission recommended
  // $1,500/week against a −$809 low precisely because only one of the two had
  // been conditioned on whether the gap could be funded. A copy cannot be kept
  // in step by care, so there is no longer a copy.
  function planContext(advice, opts) {
    opts = opts || {};
    advice = advice || {};
    const recommended = advice.weekly;
    const override = opts.weeklyOverride != null ? opts.weeklyOverride : null;
    const weekly = override != null ? override : recommended;
    // The simulation actually on screen: the household's own weekly setting
    // when it has one, the recommended run otherwise.
    const sim = opts.sim || advice.sim || null;
    const gap = advice.gap || null;
    const funding = advice.funding || null;
    return {
      recommended, override, weekly, sim, gap, funding,
      // Reachable at all: every usable source combined against the gap.
      fundingShort: !!(funding && !funding.feasible),
      // A weekly figure the household chose, which the projection does not
      // support. Measured on the simulation actually being shown, so the figure
      // judged is the figure displayed.
      overrideBreaches: override != null && !!sim && below(sim.min.balance, sim.buffer),
    };
  }

  /* -------------------------------------------------------- the status band */
  // The verdict at the top of the Plan page: which of seven conclusions the
  // household reads about the next 13 weeks, and the figures inside it.
  //
  // `public/plan.js` used to decide this, and it was the most prominent
  // financial judgement on the site that no test could reach — a mutation
  // moving the dip threshold to `sim.buffer / 2`, or the negative test to
  // `balance < 500`, left `npm test` green.
  //
  // The order is the decision, and each step earns its place:
  //
  //   1. A GAP NO SOURCE CAN REACH outranks everything. At that buffer the
  //      floor sits below it whatever the household spends, so naming a weekly
  //      figure would blame spending for something spending cannot fix.
  //   2. A WEEKLY FIGURE THE HOUSEHOLD SET that breaches the buffer is the
  //      headline next, whatever else is true about the gap. Reporting "cover
  //      the gap and hold this spending" described a plan running $809
  //      negative.
  //   3. A GAP NO SINGLE SOURCE COVERS, because "move money across" is a
  //      different instruction when it takes two accounts and part of it is
  //      borrowed.
  //   4. AN ORDINARY OPENING GAP — a timing problem, not a shortage across the
  //      window, and it is worth saying which.
  //   5. GOING NEGATIVE, then 6. DIPPING BELOW THE BUFFER, then 7. ON PLAN.
  //
  // Buffer comparisons use `below`, the engine's own convention, and so does
  // the first-breach date. Going negative is a bare `< 0`, which is the
  // convention `recommend` itself opens the gap on — a cent overdrawn is
  // overdrawn. The page's copy mixed the two: it compared the dip against a
  // bare `sim.min.balance < sim.buffer` while testing the override breach
  // against `sim.buffer - 0.005`, so a float landing a ten-thousandth of a cent
  // under the buffer published "Tight — projected to dip to $500 … below the
  // $500 target buffer" — a sentence contradicting itself in its own clause,
  // beside a mission saying the plan held. `test-status-band.js` proves that
  // case directly.
  //
  // The result is structured: an `id` naming the verdict, and only the figures
  // that verdict was decided from. Money, dates, wording, colour and HTML are
  // presentation and stay on the page, exactly as they do for `mission`.
  function planStatus(advice, opts) {
    const { gap, funding, fundingShort, overrideBreaches, weekly, recommended, sim }
      = planContext(advice, opts);
    // Every verdict reads the buffer, the low or the ending off the simulation
    // being shown. Without one the unfunded verdict would still render — and
    // publish "unfunded at a $0 buffer", a wrong figure rather than a failure.
    // Throw instead, the same way `renewal` refuses to assume a rate basis.
    if (!sim) throw new Error('planStatus requires the simulation being shown');
    const buffer = sim.buffer;
    const gapAmount = gap ? gap.amount : 0;
    const daily = sim.daily || [];

    if (gap && fundingShort) {
      return { id: 'unfunded', gapAmount, floorDate: gap.floorDate,
        allocated: funding.allocated, shortfall: funding.shortfall, buffer };
    }
    if (gap && overrideBreaches) {
      // From the funding date onward, matching how the floor is measured — the
      // days before it are the acknowledged squeeze, not a consequence of the
      // spending setting being tested here.
      const firstBad = daily.find(p => p.date >= gap.date && below(p.balance, buffer));
      return { id: 'overrideBreach', weekly, recommended, gapAmount,
        goesNegative: sim.min.balance < 0,
        low: sim.min.balance, lowDate: sim.min.date,
        firstBelowBuffer: firstBad ? firstBad.date : null };
    }
    if (gap && funding && funding.needsCombination) {
      // `needsCombination` says the RANKED ALLOCATION used more than one
      // source. It does not say no single source could have covered the gap,
      // and the two are not the same: rank 1 holding $500 and rank 2 holding
      // $1,500 against a $1,000 gap fills $500 + $500, so the allocation takes
      // two while the second source covers the whole thing alone.
      //
      // The band claimed the stronger fact. Beside a source card reading
      // "Covers the whole $1,000" — decided from this same funding result —
      // that is the cross-surface contradiction this whole move exists to end,
      // reappearing inside the engine that was supposed to end it. So the
      // verdict consumes the per-source coverage it already computes, and says
      // only what the allocation proves.
      const noSingleSourceCovers = !(funding.sources || [])
        .some(s => s.verdict === 'covers');
      return { id: 'combination', gapAmount, floorDate: gap.floorDate,
        parts: funding.parts, borrowed: funding.borrowed, noSingleSourceCovers,
        weekly, effectiveFrom: advice.effectiveFrom, ending: sim.ending };
    }
    if (gap) {
      return { id: 'gap', gapAmount, floorDate: gap.floorDate,
        preIncomeOut: gap.preIncomeOut,
        weekly, effectiveFrom: advice.effectiveFrom, ending: sim.ending };
    }
    if (sim.min.balance < 0) {
      const firstNeg = daily.find(p => p.balance < 0);
      return { id: 'negative', firstNegative: firstNeg ? firstNeg.date : null,
        low: sim.min.balance, lowDate: sim.min.date };
    }
    if (below(sim.min.balance, buffer)) {
      return { id: 'belowBuffer', low: sim.min.balance, lowDate: sim.min.date,
        buffer, ending: sim.ending, end: sim.end };
    }
    return { id: 'onPlan', ending: sim.ending, buffer,
      low: sim.min.balance, lowDate: sim.min.date };
  }

  /* ------------------------------------------------------------ the mission */
  // The sentence at the top of the Plan page: what the household is being told
  // to do about the next 13 weeks, and in what order.
  //
  // `public/plan.js` used to decide this. It read the recommendation, the debt
  // walk and the household's own weekly setting, chose which instructions
  // applied and composed the sentence — which made the most prominent financial
  // instruction on the site the one decision the node suite could not reach.
  // The selection lives here now, and the page formats what it is handed.
  //
  // The order is part of the decision, not a layout choice:
  //
  //   1. THE MONEY THAT IS NOT THERE. An opening timing gap comes first,
  //      because nothing later in the window matters until the payments in
  //      front of it can clear. When every usable source combined cannot reach
  //      it, the instruction is to find money beyond them or lower the buffer,
  //      rather than to cover a gap that cannot be covered.
  //   2. A FACILITY ALREADY OVER ITS LIMIT. That is charged for today, not
  //      forecast, so it is named before anything the window predicts.
  //   3. SPENDING — and only where spending is a remedy. When the gap cannot
  //      be funded the floor sits below the buffer whatever the household
  //      spends, so NO weekly figure is instructed at all: the mission once
  //      recommended $1,500/week against a −$809 low, because only the status
  //      band had been conditioned on whether the gap could be funded.
  //      Where the household has set its own weekly figure and the projection
  //      breaches the buffer at it, the instruction is to cut to the supported
  //      figure, and it names the figure that does not hold.
  //   4. WHAT THE SURPLUS IS FOR. A HELOC crossing its own limit inside the
  //      window outranks paying down a card, because that crossing happens on
  //      capitalised interest alone — no one has to borrow another dollar for
  //      it. Absent that, the surplus goes at the most expensive card.
  //
  // Inputs are results this engine has already produced: `advice` from
  // `recommend` and `debtProj` from `projectDebts`. `opts.weeklyOverride` is
  // the household's own weekly setting or null, and `opts.sim` is the
  // simulation being shown at that setting — the recommended one by default.
  //
  // The result is structured. Each part carries the figures it was decided
  // from and nothing else; money and date formatting are presentation and stay
  // on the page. A part the page has no wording for is a rendering failure,
  // which is why `test-mission.js` checks the two sides still agree.
  // Facilities over their limit TODAY — the opening mark of the debt walk,
  // not a later snapshot, and not a crossing the window predicts. The mission
  // and the phase titles both ask this; they must not each filter the mark.
  function debtsOverLimitToday(debtProj) {
    const opening = ((debtProj && debtProj.marks) || []).find(m => m.day === 0);
    return (opening ? opening.debts : []).filter(x => x.overLimit);
  }
  // The day the HELOC actually crosses. Reading this off the 30-day marks
  // reported 7 October for a crossing that happens on 30 September — a
  // different month, and on the wrong side of the plan's own deadline. A
  // facility already over its limit at the start is a different fact.
  function helocLimitCrossing(debtProj) {
    return ((debtProj && debtProj.crossings) || [])
      .find(c => c.id === 'heloc' && !c.alreadyOver) || null;
  }

  function mission(advice, debtProj, opts) {
    debtProj = debtProj || {};
    const { recommended, weekly, sim, gap, funding, fundingShort, overrideBreaches }
      = planContext(advice, opts);

    const overLimitToday = debtsOverLimitToday(debtProj);
    const helocCrossing = helocLimitCrossing(debtProj);

    const parts = [];
    if (gap && fundingShort) {
      parts.push({ id: 'fundingShortfall', shortfall: funding.shortfall });
    } else if (gap) {
      parts.push({ id: 'coverGap', amount: gap.amount, by: gap.date });
    }
    if (overLimitToday.length) {
      parts.push({ id: 'overLimit',
        debts: overLimitToday.map(x => ({ id: x.id, label: x.label })) });
    }
    if (!fundingShort) {
      parts.push(overrideBreaches
        ? { id: 'cutSpending', supported: recommended, unsupported: weekly }
        : { id: 'holdSpending', weekly });
    }
    parts.push(helocCrossing
      ? { id: 'helocLimit', date: helocCrossing.date }
      : { id: 'surplusToCard' });

    return { parts };
  }

  /* -------------------------- phase titles and the risk list */
  // The Plan page's three phase headings, the body that depends on which
  // side of a comparison the window is on, and which risks the household
  // is shown. `public/plan.js` used to decide all of that — `gap` vs none
  // for 0–30, `overToday.length` for 31–60, `day90.consumer < today.consumer`
  // for 61–90, `helocBreach.day <= 60` for the HELOC sentence, and then
  // which risks appear plus `transferMonthly * 3`, the estimated-commitment
  // total and `helocDrawn`. Flipping the 61–90 comparison and changing
  // `* 3` to `* 2` left `npm test` green — ALL 21 SUITES PASSED — because
  // no test could reach the page.
  //
  // This is a coordinator, not a second debt walk or a second deadline.
  // Over-limit-today and the HELOC crossing are the same helpers the
  // mission already uses. The Amanda figure is `incomeDeadline`'s amount
  // and `neededBy`; the three-month impact is the page's `amount * 3`,
  // which on the published 91-day window equals the already-computed
  // `ending - endingWithout`. The HELOC draw is `drawnOn(funding, 'heloc')`,
  // the same sum the HELOC alternative prices. Telecom `planned` is the
  // category `budgetBreakdown` already built. The page formats; it does
  // not compare.
  //
  // `opts.transfer` is the `incomeDeadline` result the page already ran
  // (with `notBefore` set to the gap date). `opts.alternatives` is the
  // `counterfactuals` result already on screen. Re-running either here
  // would be a second decision system.
  function planPhases(plan, advice, debtProj, opts) {
    opts = opts || {};
    plan = plan || {};
    debtProj = debtProj || {};
    const { gap, funding, fundingShort, weekly, sim } = planContext(advice, opts);
    if (!sim) throw new Error('planPhases requires the simulation being shown');

    const marks = debtProj.marks || [];
    const markOn = day => marks.find(m => m.day === day) || marks[marks.length - 1] || null;
    const today = markOn(0);
    const d30 = markOn(30);
    const d60 = markOn(60);
    const day90 = marks.length ? marks[marks.length - 1] : null;
    const overToday = debtsOverLimitToday(debtProj);
    const helocCrossing = helocLimitCrossing(debtProj);
    const cashAt = date => {
      const p = (sim.daily || []).find(x => x.date === date);
      return p ? p.balance : (plan.startingCash && plan.startingCash.amount) || 0;
    };

    const openingId = fundingShort ? 'unfunded' : (gap ? 'coverGap' : 'holdBuffer');
    const consumerNow = today ? today.consumer : 0;
    const consumer60 = d60 ? d60.consumer : 0;
    const consumerFell = day90 && today ? day90.consumer < today.consumer : false;
    const consumerDownAt60 = d60 && today ? d60.consumer < today.consumer : false;
    const helocInPhase = !!(helocCrossing && helocCrossing.day <= 60);

    const phases = [
      {
        rangeId: '0-30',
        titleId: gap ? 'coverGap' : 'holdBuffer',
        id: openingId,
        weekly,
        gapAmount: gap ? gap.amount : 0,
        gapDate: gap ? gap.date : null,
        shortfall: funding ? funding.shortfall : 0,
        cashAt30: cashAt(d30 && d30.date),
        date30: d30 ? d30.date : null,
      },
      {
        rangeId: '31-60',
        titleId: overToday.length ? 'overLimit' : 'relievePressure',
        id: overToday.length ? 'overLimit' : 'relievePressure',
        consumerMove: Math.abs(consumer60 - consumerNow),
        consumerDirection: consumerDownAt60 ? 'down' : 'up',
        consumer60,
        headroom60: d60 ? d60.headroom : 0,
        helocInPhase,
        helocDate: helocInPhase ? helocCrossing.date : null,
      },
      {
        rangeId: '61-90',
        titleId: consumerFell ? 'surplusToPrincipal' : 'stopGrowth',
        id: consumerFell ? 'surplusToPrincipal' : 'stopGrowth',
        ending: sim.ending,
        buffer: sim.buffer,
      },
    ];

    const risks = [];
    const transfer = opts.transfer || null;
    if (transfer && transfer.amount > 0) {
      const windowImpact = transfer.amount * 3;
      risks.push({
        id: transfer.neededBy ? 'amandaRequired' : 'amandaOptional',
        amount: transfer.amount,
        windowImpact,
        neededBy: transfer.neededBy || null,
      });
    }

    const disabled = new Set(opts.disabled || []);
    const estimated = (plan.commitments || []).filter(c =>
      c.confidence === 'estimated' && !disabled.has(c.id));
    if (estimated.length) {
      risks.push({
        id: 'estimatedCommitments',
        count: estimated.length,
        total: estimated.reduce((s, c) => s + c.amount, 0),
        labels: estimated.map(c => c.label),
      });
    }

    if (helocCrossing) {
      const drawn = drawnOn(funding, 'heloc');
      const helocObl = (plan.obligations || []).find(o => o.id === 'heloc');
      const drawAlt = ((opts.alternatives && opts.alternatives.gapFundingAlternatives) || [])
        .find(a => a.debtId === helocCrossing.id) || null;
      risks.push({
        id: drawn > 0 ? 'helocDrawn' : 'helocNoDraw',
        date: helocCrossing.date,
        drawn,
        monthlyInterest: helocObl ? helocObl.amount : 0,
        alternative: drawAlt && drawAlt.applies
          ? {
              displaces: drawAlt.displaces,
              alternateDate: drawAlt.alternateCrossing.date,
            }
          : null,
      });
    }

    const later = (debtProj.crossings || []).filter(c =>
      !c.alreadyOver && c.id !== 'heloc');
    for (const c of later) {
      risks.push({
        id: 'facilityCrossing',
        debtId: c.id,
        label: c.label,
        date: c.date,
      });
    }

    const telecom = ((opts.budget && opts.budget.categories) || [])
      .find(c => c.id === 'telecom');
    if (telecom && telecom.planned > 0) {
      risks.push({
        id: 'telecomUnrouted',
        planned: telecom.planned,
      });
    }

    return { phases, risks };
  }

  /* ------------------------------------------ what the next move achieves */
  // The line under **What happens after** on the Plan page: what completing the
  // first written action does to the window the household is looking at.
  //
  // `public/plan.js` used to decide this, and it is the decision B73 recorded
  // as item 5. The page compared `plan.actions[0].amount` against the current
  // gap with its own hand-copied half-cent (`first.amount + 0.005 >=
  // fundingGap`), subtracted the two to get the uncovered remainder, and then
  // chose between five household-facing outcomes from that comparison, the
  // status verdict, the due date and the funding plan. Mutating the comparison
  // to `>= fundingGap / 2` left `npm test` green — the mutation B73's table
  // records, reproduced on this branch before the move.
  //
  // WHY THE COMPARISON IS THE POINT. The action's amount is a FIXED figure
  // authored by hand in `data.json`, sized for the default buffer. The gap is
  // dynamic: raise the target buffer and the same $1,050 action that covers a
  // $1,043.16 gap does not come close to a $2,043.16 one. So the outcome is
  // judged against THE CURRENT GAP — never against the default buffer, a cached
  // gap, the existence of an action, or the amount the action was sized for.
  // Judging it any other way publishes "the buffer is restored" over figures
  // that do not restore it.
  //
  // The order is the decision:
  //
  //   1. A GAP NO SOURCE CAN REACH. The action cannot restore a buffer that
  //      nothing available restores, so it is honest about helping without
  //      being enough, and quotes the shortfall rather than a recovery.
  //   2. FUNDABLE, BUT NOT BY THIS ACTION ALONE. What it covers, what is left,
  //      and the supported weekly figure once the rest is found. This outranks
  //      the override verdict deliberately: quoting the unsafe weekly setting
  //      here made the override warning unreachable whenever the fixed action
  //      fell short of the gap, which is exactly when a raised buffer puts it
  //      there. The override is named inside this outcome instead.
  //   3. THE ACTION RESTORES THE GAP, BUT THE HOUSEHOLD'S OWN WEEKLY SETTING
  //      STILL BREACHES. The gap clearing does not make an unsupported spending
  //      level supported.
  //   4. THE ACTION RESTORES THE GAP IN TIME, and the plan on screen continues.
  //      "In time" is the action's due date against the gap's date — an action
  //      landing after the money is needed does not clear that day's payments.
  //   5. NO APPLICABLE OPENING-GAP OUTCOME — no gap, or an action that covers
  //      one but is not due in time — so the window's own ending is what there
  //      is to say.
  //
  // `planStatus` is called here rather than accepted as an argument. Both
  // verdicts are rendered in the same card stack from the same `advice`, and a
  // caller free to pass a different status could publish "the buffer is
  // restored" beside a band saying the gap cannot be funded. Computing it from
  // the same inputs makes that disagreement impossible rather than unlikely.
  //
  // The result is structured: an `id` naming the outcome, the action record it
  // was decided about, and only the figures that outcome was decided from.
  // Money, dates and sentences are presentation and stay on the page, exactly
  // as they do for `mission` and `planStatus`.
  function nextMove(plan, advice, opts) {
    const action = ((plan && plan.actions) || [])[0] || null;
    if (!action) return null;
    const { gap, funding, weekly, recommended, sim, overrideBreaches }
      = planContext(advice, opts);
    // Every outcome reads the buffer, the low or the ending off the simulation
    // being shown. Without one this would still render, and publish a recovery
    // against a $0 buffer — a wrong figure rather than a failure. Throw, the
    // same way `planStatus` does.
    if (!sim) throw new Error('nextMove requires the simulation being shown');
    const status = planStatus(advice, opts);
    const buffer = sim.buffer;
    const gapAmount = gap ? gap.amount : 0;
    const amount = action.amount != null ? action.amount : null;
    // `atLeast` is the engine's own half-cent convention — the same one the
    // per-source funding verdicts stop on — not a new boundary. The page's
    // `+ 0.005` was a copy of it, and a copy cannot be kept in step by care.
    const covers = !!gap && amount != null && atLeast(amount, gapAmount);
    // COVERAGE IS NOT RESTORATION. Money that arrives after the day it is
    // needed does not clear that day's payments, so restoring the gap takes
    // both: an amount that reaches it, and a due date on or before it.
    //
    // The two used to be tested in different places — `restored` checked the
    // date, the override outcome did not — so an action that covered the gap,
    // fell due after it, and sat under a weekly setting the forecast does not
    // support published "the $623.00 clears on 12 August and the buffer is
    // restored" over money that arrives eight days late. The required review
    // found it on this head. The legacy page had the same ordering, and it is
    // corrected here rather than carried across: this is the move that makes
    // this decision an authority, and an authority may not publish that.
    const inTime = !!(gap && action.due && action.due <= gap.date);
    const restoresGap = covers && inTime;

    if (status.id === 'unfunded') {
      // `planStatus` only reaches this verdict on a gap no source can fund, so
      // the gap and the funding result are both present here by construction.
      return { id: 'unfunded', action,
        gapAmount, shortfall: funding.shortfall, buffer };
    }
    if (gap && !covers) {
      // An action with NO amount covers nothing of the gap, so the whole gap
      // remains. The page returned 0 here — "leaving $0.00 still to find"
      // inside the same sentence as "of the $1,043.16 needed", two published
      // figures contradicting each other. An unpriced action is a shape
      // `data.json` allows and the card head already renders.
      return { id: 'partial', action, actionAmount: amount,
        gapAmount, remainder: gapAmount - (amount || 0), buffer,
        // Named only when the allocation actually takes more than one source.
        parts: funding && funding.needsCombination ? funding.parts : null,
        recommended, effectiveFrom: advice.effectiveFrom,
        // The weekly setting is unsupported, and the household is told so here
        // because outcome 3 is unreachable while the action falls short.
        overrideUnsupported: status.id === 'overrideBreach',
        weekly, low: sim.min.balance };
    }
    // Both of the next two outcomes open by saying the buffer is restored, so
    // both are gated on the action actually restoring it.
    if (restoresGap && status.id === 'overrideBreach') {
      return { id: 'overrideBreach', action,
        dueOnGapDay: gap.dueOnGapDay, gapDate: gap.date,
        weekly, low: sim.min.balance, lowDate: sim.min.date, recommended };
    }
    if (restoresGap) {
      return { id: 'restored', action,
        dueOnGapDay: gap.dueOnGapDay, gapDate: gap.date,
        effectiveFrom: advice.effectiveFrom, weekly };
    }
    // Nothing about the opening gap can be claimed, so what is left to report
    // is the projected window against the buffer — and it has to say which side
    // of it the window lands on. "Finishes with $X instead of breaching the
    // buffer" was unconditional, which is false of any run that does breach:
    // reachable before this change with no gap and an unsupported weekly
    // setting, and reachable by this change's own routing, since a covering
    // action that arrives late now lands here.
    //
    // `overrideBreaches` rather than the status verdict: `planStatus` only
    // reaches `overrideBreach` when there IS a gap, and this outcome is the one
    // that also serves plans without one. A weekly figure the household set and
    // the projection does not support is said either way.
    return { id: 'windowEnding', action, ending: sim.ending, buffer,
      breaches: below(sim.min.balance, buffer),
      low: sim.min.balance, lowDate: sim.min.date,
      // Why there is no opening-gap outcome, when the reason is the timing
      // rather than the amount. The household is looking at an action large
      // enough to close the gap; leaving that unexplained here reads as though
      // the gap were not the point.
      coversButLate: covers && !inTime,
      actionAmount: amount, gapAmount, actionDue: action.due || null,
      gapDate: gap ? gap.date : null, dueOnGapDay: gap ? gap.dueOnGapDay : 0,
      overrideUnsupported: overrideBreaches, weekly, recommended };
  }

  /* ------------------------------------------------ revolving utilisation */
  // Every facility with a limit, and what is really left on it TODAY.
  //
  // This used to be a second hand-maintained list beside `debts`, and the two
  // had already disagreed: the Travel Visa row said $0 available while the
  // same numbers elsewhere derived $21.69, because one of them knew about the
  // $165.13 of pending charges and the other did not. Derived from the debt
  // records plus the facilities that are not debts (the chequing overdraft),
  // so there is nothing left to drift.
  function utilisation(debts, extra) {
    const rows = (debts || []).filter(x => x.limit != null).map(x => {
      const pending = x.pending || 0;
      const used = openingBalance(x);
      return {
        id: x.id, label: x.label, posted: x.balance, pending, used, limit: x.limit,
        available: Math.max(0, x.limit - used),
        overLimit: used > x.limit, overLimitBy: Math.max(0, used - x.limit),
        pct: x.limit ? (used / x.limit) * 100 : null,
      };
    });
    for (const e of extra || []) {
      const pending = e.pending || 0;
      const used = e.used + pending;
      rows.push({
        id: e.id, label: e.label, posted: e.used, pending, used, limit: e.limit,
        available: Math.max(0, e.limit - used),
        overLimit: used > e.limit, overLimitBy: Math.max(0, used - e.limit),
        pct: e.limit ? (used / e.limit) * 100 : null, note: e.note,
      });
    }
    return {
      rows,
      // The headline the Plan quotes. Pending is already inside `used`, so a
      // card that is economically full contributes nothing here.
      totalAvailable: rows.reduce((s, r) => s + r.available, 0),
      totalPending: rows.reduce((s, r) => s + r.pending, 0),
      overLimitCount: rows.filter(r => r.overLimit).length,
    };
  }

  /* ------------------------------------------------- the May 2027 renewal */
  // Canada's two mortgage rate conventions, and the MONTHLY periodic rate each
  // one implies. A rate quoted under one convention may not be priced under the
  // other, and which applies is a property of the product, not a detail.
  //
  //   FIXED     Canadian fixed mortgage rates are quoted "calculated
  //             half-yearly, not in advance" — the Interest Act convention TD
  //             states in its own terms. The monthly rate is the sixth root of
  //             half a year's growth, defined by (1 + i)^12 = (1 + annual/2)^2.
  //   VARIABLE  TD expresses variable mortgage rates as compounded monthly, so
  //             the monthly rate is simply a twelfth. It is also the HELOC's
  //             convention, and the household's own mortgage is variable today
  //             — TD Mortgage Prime − 0.96%, per `docs/ACCOUNT_FACTS.md`.
  //
  // Pricing a FIXED quote on the variable convention OVERSTATES it. TD's own
  // published example, $300,000 at 3.00%, is $2,069.07 a month over 15 years
  // and $1,419.74 over 25; the monthly convention answers $2,071.74 and
  // $1,422.63. On this household's balance at 3.65% over 18 years the gap is
  // $7.61 a month and $1,644.70 over the term. Small per payment, and a real
  // number to put under a renewal decision — which is why the convention is
  // now chosen rather than assumed. The renewal modeller assumed monthly for
  // every rate the slider could reach, including the fixed quotes TD will
  // actually offer in April 2027.
  const RATE_BASIS = {
    fixed: annualPct => Math.pow(1 + annualPct / 100 / 2, 1 / 6) - 1,
    variable: annualPct => annualPct / 100 / 12,
  };

  // The level payment that repays `principal` over `years` at a given MONTHLY
  // periodic rate. The rate arrives already converted, so this function holds
  // no opinion about which convention produced it.
  //
  // This lived in `public/app.js` — the shared PAGE core — where it decided a
  // household-facing figure outside anything the node suite could reach.
  // `renewal` is its only consumer, so it is internal here rather than a second
  // exported authority; leaving a copy behind in `app.js` would have been the
  // duplicated formula this move exists to remove.
  function amortisedPayment(principal, monthlyRate, years) {
    const n = years * 12;
    if (monthlyRate === 0) return principal / n;
    return principal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -n));
  }

  // What the mortgage renewal costs at a given rate and amortisation, and what
  // folding the interest-only HELOC into it changes.
  //
  // `public/modellers.js` used to work this out itself — the HELOC's compounded
  // balance, both interest totals, and the comparison against today's household
  // cash were all page arithmetic. The May 2027 decision is weighed on those
  // figures, and they sat where no test could reach them. That is `B73`.
  //
  // The modelled trade is unchanged by the move. What changed is where the
  // inputs come from, because a renewal model carrying its own copy of the debt
  // picture is precisely the failure this engine exists to prevent:
  //
  //   BALANCES come from the debt records the walk in `projectDebts` opens on,
  //     through the same `openingBalance` rule. `data.json` `mortgage` keeps the
  //     renewal's standing facts — maturity, remaining years, prepayment room —
  //     and is no longer a second home for the balance, rate, or bi-weekly
  //     payment the arithmetic and the slider open on.
  //   TODAY'S HOUSEHOLD CASH comes from `plan.obligations`, the authority for
  //     what is due and how often. That is what makes the HELOC's $0.00 derived
  //     rather than asserted: its obligation is `nonCash`, so it contributes
  //     nothing to cash by construction rather than by a field that has to be
  //     remembered. It also means changing the mortgage payment moves the
  //     comparison the household reads.
  //   HOW THE HELOC BEHAVES comes from the debt record, which
  //     `test-invariants.js` already names the canonical home for its interest
  //     treatment and for the split between economic cost and household cash.
  //
  // The old page code fell back to `heloc.payment` whenever `cashPayment` or
  // `monthlyInterest` was missing. That fallback is not carried over: treating
  // the capitalised charge as a payment is the exact bug — a $814/month bill
  // nobody pays — that the split was introduced to end, and an invariant now
  // holds the split in place, so there is nothing left for it to protect.
  //
  // `opts.basis` is REQUIRED and names the rate convention — `fixed` or
  // `variable`, per `RATE_BASIS` above. There is deliberately no default: a
  // renewal rate with no stated convention is the defect this argument exists
  // to end, and silently picking one would only move the assumption rather than
  // remove it. An unknown basis throws, so a caller that forgets shows a broken
  // tile rather than a plausible wrong figure.
  //
  // Every figure returned is a number and every decision is an id. Money,
  // dates, colour and wording are presentation and stay on the page.
  function renewal(plan, debts, opts) {
    opts = opts || {};
    plan = plan || {};
    const rate = Number(opts.rate);
    const years = Number(opts.years);
    const consolidate = !!opts.consolidate;
    const basis = opts.basis;
    if (!Object.prototype.hasOwnProperty.call(RATE_BASIS, basis)) {
      throw new Error(`Forecast.renewal needs a rate basis (${Object.keys(RATE_BASIS).join(' or ')}), got ${JSON.stringify(basis)}`);
    }
    // The renewal rate, converted once, under the convention the household
    // chose. Everything priced at the renewal rate goes through this.
    const rateMonthly = RATE_BASIS[basis](rate);

    const record = id => (debts || []).find(x => x.id === id) || null;
    const mortgage = record('mortgage');
    const heloc = record('heloc');

    // Monthly-equivalent household cash for one debt. `monthlyCashFor` is the
    // rule; this collects what it could not annualise across both debts, in the
    // order they are asked for, so an incomplete baseline stays visible.
    const unmodelled = [];
    const monthlyCash = debtId => {
      const cash = monthlyCashFor(plan, debtId);
      for (const id of cash.unmodelled) unmodelled.push(id);
      return cash.monthly;
    };

    const mortgageCash = monthlyCash('mortgage');
    const helocCash = monthlyCash('heloc');
    const householdCash = mortgageCash + helocCash;

    const capitalised = !!heloc && heloc.interestTreatment === 'capitalised';
    const helocEconomic = heloc && heloc.monthlyInterest != null ? heloc.monthlyInterest : 0;
    const helocOpening = heloc ? openingBalance(heloc) : 0;
    const helocRate = heloc && heloc.rate ? heloc.rate / 100 : 0;
    const mortgageOpening = mortgage ? openingBalance(mortgage) : 0;

    let principal, payment, amortisingInterest, helocInterest, helocOwed;
    if (consolidate) {
      // Both debts amortise, so the HELOC principal is genuinely repaid and
      // nothing is left owing on it at the horizon. The folded-in balance is
      // priced at the renewal rate, under the renewal's convention, because it
      // has become mortgage.
      principal = mortgageOpening + helocOpening;
      payment = amortisedPayment(principal, rateMonthly, years);
      amortisingInterest = payment * years * 12 - principal;
      helocInterest = 0;
      helocOwed = 0;
    } else {
      principal = mortgageOpening;
      const mortgagePayment = amortisedPayment(principal, rateMonthly, years);
      // The HELOC is not refinanced, so whatever cash it costs today keeps
      // leaving the account alongside the new mortgage payment.
      payment = mortgagePayment + helocCash;
      amortisingInterest = mortgagePayment * years * 12 - principal;
      // Capitalised interest COMPOUNDS, and at the MONTHLY cadence the charge
      // is actually raised on. Charging simple interest and then reporting the
      // opening balance as the amount still owed understated it by $275,305 at
      // the default 18 years; compounding annually instead of monthly
      // understated it by a further $9,212.
      //
      // The HELOC keeps its OWN convention. It is prime-linked and variable
      // whatever the mortgage renews into, so choosing a fixed renewal must not
      // silently reprice the facility that stays outside it.
      helocOwed = capitalised
        ? helocOpening * Math.pow(1 + RATE_BASIS.variable(heloc ? heloc.rate : 0),
          PAYMENTS_PER_YEAR.monthly * years)
        : helocOpening;
      // Where the interest is PAID rather than capitalised the balance stands
      // still, so the cost is simple interest on it for the whole horizon.
      helocInterest = capitalised
        ? helocOwed - helocOpening
        : helocOpening * helocRate * years;
    }

    const totalInterest = amortisingInterest + helocInterest;
    const delta = payment - householdCash;

    return {
      rate, years, consolidate,
      // The convention this answer was priced under, and the monthly rate it
      // produced. Returned so the page can say which one the household is
      // looking at — a figure that does not name its convention is the defect,
      // not the arithmetic.
      basis, rateMonthly,
      today: {
        // Which picture of "today" applies: a HELOC whose interest capitalises
        // is not a bill, and saying so is the difference between a $3,466.67
        // baseline and a $4,280.85 one that nobody pays.
        id: capitalised ? 'capitalised' : 'paid',
        mortgageCash, helocCash, householdCash, helocEconomic, capitalised,
        // Cash obligations against these debts that have no monthly
        // equivalent. Non-empty means the baseline below is incomplete.
        unmodelled,
      },
      heloc: heloc
        ? { id: heloc.id, label: heloc.label, opening: helocOpening,
          rate: heloc.rate, limit: heloc.limit }
        : null,
      principal, payment, delta,
      // The comparison itself, so the page colours a decision rather than
      // making one. EPSILON keeps a float landing on 0.0000000001 from being
      // reported as a real increase.
      //
      // `unknown` withholds it. A baseline missing a real cash obligation
      // cannot be compared against, and `delta` would understate what the
      // household already pays — making the renewal look dearer than it is.
      // Reporting the gap in `today.unmodelled` and then publishing the
      // difference anyway is the same failure as the $814 bill: a figure that
      // looks settled and is not. The number is still returned, because it is
      // still the arithmetic difference; this field is the authority on
      // whether it may be shown.
      direction: unmodelled.length ? 'unknown'
        : delta > EPSILON ? 'more' : delta < -EPSILON ? 'less' : 'same',
      interest: { amortising: amortisingInterest, heloc: helocInterest, total: totalInterest },
      helocOwed,
      // Whether the capitalising charge stops. Only consolidating stops it —
      // the "no longer capitalising" row once showed in keep-separate mode,
      // contradicting the note directly beneath it.
      capitalisation: capitalised
        ? { id: consolidate ? 'stopped' : 'continues', amount: helocEconomic }
        : null,
      outcome: consolidate ? 'consolidated'
        : capitalised ? 'interestOnlyCapitalising' : 'interestOnlyFlat',
    };
  }

  /* ------------------------------------------------------ payoff modelling */
  // What a monthly payment does to one debt: whether it clears it at all, when,
  // and what it costs on the way.
  //
  // `public/modellers.js` and `public/app.js` used to answer all of that
  // themselves — `payoff()` in the shared PAGE core ran the projection,
  // `solveFor()` ran the annuity that priced the "clear in 5 / 3 / 1 years"
  // presets, and `bounds()` picked the slider floor from an interest charge it
  // computed itself. The household reads those presets and acts on them, and no
  // node suite could reach any of it. That is `B73`, and this is the last of it
  // on that page.
  //
  // THE MOVE FOUND THREE THINGS THAT WERE WRONG, and they are corrected here
  // rather than carried across for the sake of a clean migration diff.
  //
  //   1. ONE CONVENTION WAS APPLIED TO EVERY DEBT, and it was nobody's. The page
  //      priced every balance at `annual × 30 / 365`, which charges twelve
  //      30-day months — 360 days — for every 365 that pass. See
  //      `PAYOFF_RATE_BASIS` below for what each debt actually carries.
  //   2. THE BALANCE IGNORED PENDING CHARGES, so the modeller answered for a
  //      smaller debt than the household owes. `openingBalance` is the rule the
  //      debt walk opens on, headroom is measured against and the renewal
  //      compounds from; it is now this too.
  //   3. "THE MINIMUM" WAS `debt.payment`, WHICH IS NOT ALWAYS A PAYMENT. On the
  //      HELOC that field is the capitalised interest charge, so the modeller
  //      published a $814.18/month bill nobody pays and a payoff horizon for a
  //      facility that nothing repays. On the mortgage it is a BI-WEEKLY amount,
  //      read as monthly, so the modeller reported that a mortgage TD itself
  //      says has 17 years 9 months left would never clear. The minimum is now
  //      `monthlyCashFor` — the same annualised cash obligation the renewal
  //      compares against.

  // The MONTHLY periodic rate each supported kind of debt carries — and, just as
  // importantly, whether that rate is the convention EXACTLY or an average of
  // it. A rate means nothing without the convention it is charged under, and a
  // convention means nothing without saying how closely it is being modelled.
  //
  //   VARIABLE  EXACT. A prime-linked facility — the mortgage on TD Mortgage
  //             Prime − 0.96%, the HELOC on TD Prime + 0.45% — is quoted
  //             compounded monthly, so a monthly period IS the period the
  //             lender charges on. This is `RATE_BASIS.variable`, deliberately
  //             reused rather than restated: the renewal already prices a
  //             variable quote and compounds the HELOC on it, and two copies of
  //             one convention is how they would come to differ.
  //
  //   CARD      A MONTHLY-EQUIVALENT APPROXIMATION, and it is labelled as one
  //             rather than dressed up as the real thing.
  //
  //             A card does not charge monthly. It quotes a DAILY rate,
  //             `annual / 365`, charges it on the average daily balance for
  //             every day of the statement cycle, and adds the result to the
  //             balance at the cycle's end (TD's 2 July 2026 amendment says so
  //             explicitly, which is why it compounds monthly rather than
  //             daily). Cycles close on a fixed day of the month, so their
  //             LENGTH follows the calendar — the five reconciled in
  //             `docs/ACCOUNT_FACTS.md` run 30, 29, 32, 29 and 31 days, and
  //             MBNA states outright that statement periods vary.
  //
  //             This model runs LEVEL MONTHLY periods, so it cannot price a
  //             cycle it does not know the length of. It prices the AVERAGE
  //             cycle, `365 / 12` days, which has two consequences that must
  //             not be confused:
  //
  //               OVER A YEAR it is exact, because twelve consecutive cycles
  //                 TILE the calendar — each opens the day after the last
  //                 closes — so they span 365 days however the days fall, and
  //                 a year's charge is the full annual rate. That is a property
  //                 of how cycles are defined, not an average of observed ones.
  //               FOR ANY SINGLE PERIOD it is approximate, by as much as
  //                 `CARD_CYCLE_DAYS_RANGE` allows: +8.6% against a 28-day cycle
  //                 and −5.0% against a 32-day one. The first-period interest
  //                 this page publishes is exactly such a figure, so it is
  //                 published with that band beside it rather than alone.
  //
  //             The multi-period figures inherit far less of that, because the
  //             tiling means cycle-length variation redistributes interest
  //             between periods instead of accumulating: `test-payoff.js` walks
  //             a real varying-cycle schedule against this model from all twelve
  //             possible starting months and bounds the worst case at 1.9 months
  //             and 1.3% of total interest.
  //
  //             The alternative was `annual × 30 / 365`, which the page used
  //             before this: that charges twelve 30-day months — 360 days — for
  //             every 365 that pass, so it is not a different approximation but
  //             a biased one, understating every year by 1.37% and compounding
  //             that over a 17-year horizon.
  //
  // `RATE_BASIS` is NOT extended with a card entry. It is the renewal's table of
  // the two conventions a QUOTED MORTGAGE can arrive under, and `renewal`
  // accepts any key in it as a legal basis; adding one would make "price this
  // renewal as a credit card" a valid request.
  const DAYS_IN_YEAR = 365;
  const CARD_CYCLE_DAYS = DAYS_IN_YEAR / PAYMENTS_PER_YEAR.monthly;
  // The realistic envelope for one cycle: calendar months run 28 to 31 days, and
  // an observed cycle in `docs/ACCOUNT_FACTS.md` ran 32. Used only to state how
  // wide the first-period figure's uncertainty is — never to price anything.
  const CARD_CYCLE_DAYS_RANGE = { min: 28, max: 32 };
  const PAYOFF_RATE_BASIS = {
    card: annualPct => (annualPct / 100 / DAYS_IN_YEAR) * CARD_CYCLE_DAYS,
    variable: annualPct => RATE_BASIS.variable(annualPct),
  };
  // Whether the monthly rate above IS the charging convention, or an average of
  // one. A figure priced under an approximation and presented as exact is the
  // defect this field exists to prevent.
  const PAYOFF_BASIS_PRECISION = { card: 'monthly-equivalent', variable: 'exact' };

  // The level payment that clears `debt` in exactly `months`. The page ran this
  // as `solveFor` to price its presets.
  function paymentForMonths(debt, months) {
    const n = Number(months);
    if (!(n > 0)) return null;
    const i = debt.monthlyRate;
    // A zero rate is not a special case of the annuity — it is a division by
    // zero in it. Nothing accrues, so the payment is the balance spread evenly.
    if (i === 0) return debt.balance / n;
    return debt.balance * i / (1 - Math.pow(1 + i, -n));
  }

  // The financially meaningful range for the payment control.
  //
  // The floor is HALF the first period's interest, so the slider's own bottom
  // end is somewhere the household can see the balance growing — a control that
  // could only show good outcomes would be answering a different question. The
  // ceiling clears the debt inside a year, or reaches six times the floor,
  // whichever is further out.
  function payoffBounds(debt) {
    const min = Math.ceil(debt.interestOnly * 0.5);
    const max = Math.max(Math.ceil(debt.balance / 12), min * 6);
    // Open on what the household already pays where that is a real payment
    // inside the range; otherwise a third of the way up, which is far enough
    // above the floor to show a payoff rather than a warning.
    const opening = debt.minimum > min ? debt.minimum : Math.round((min + max) / 3);
    return { min, max, start: Math.min(max, Math.max(min, Math.round(opening))) };
  }

  // Every debt the payoff modeller may answer for, with the canonical inputs it
  // has to answer on. The page picks one and renders it; it reads no debt field
  // for arithmetic of its own.
  //
  // An undeclared rate convention THROWS rather than defaulting, exactly as
  // `renewal` does with its basis. Silently picking one would only move the
  // assumption instead of removing it, and a broken tile is safer than a
  // plausible wrong figure. `test-invariants.js` holds every debt record to
  // declaring one, so this is unreachable on the published data.
  function payoffDebts(plan, debts) {
    return (debts || [])
      .filter(x => x.balance != null && x.rate != null && openingBalance(x) > 0)
      .map(x => {
        const convention = x.rateConvention;
        if (!Object.prototype.hasOwnProperty.call(PAYOFF_RATE_BASIS, convention)) {
          throw new Error(`Forecast.payoffDebts: debt ${JSON.stringify(x.id)} declares no known rate `
            + `convention (${Object.keys(PAYOFF_RATE_BASIS).join(' or ')}), got ${JSON.stringify(convention)}`);
        }
        const balance = openingBalance(x);
        const monthlyRate = PAYOFF_RATE_BASIS[convention](x.rate);
        const cash = monthlyCashFor(plan, x.id);
        const debt = {
          id: x.id, label: x.label, structure: x.structure || '',
          // What is owed today, and the two parts of it. A card whose posted
          // balance is under its limit but whose pending charges take it over
          // owes the larger figure, and a payoff answered on the smaller one is
          // answered for a debt the household does not have.
          balance, posted: x.balance, pending: x.pending || 0,
          rate: x.rate, convention, monthlyRate,
          // Whether `monthlyRate` is the convention or an average of it. The
          // page has to say which; see `PAYOFF_BASIS_PRECISION`.
          precision: PAYOFF_BASIS_PRECISION[convention],
          // The first period's interest, which is also the threshold a payment
          // has to beat for anything at all to be repaid.
          interestOnly: balance * monthlyRate,
          // How wide that first-period figure really is. A card's next cycle is
          // 28 to 32 days and this model does not know which, so the single
          // charge it publishes carries a band; a facility that genuinely
          // charges monthly has no band, and says so with `null` rather than a
          // token one that would imply uncertainty it does not have.
          interestOnlyBand: PAYOFF_BASIS_PRECISION[convention] === 'exact' ? null : {
            low: balance * (x.rate / 100 / DAYS_IN_YEAR) * CARD_CYCLE_DAYS_RANGE.min,
            high: balance * (x.rate / 100 / DAYS_IN_YEAR) * CARD_CYCLE_DAYS_RANGE.max,
            minDays: CARD_CYCLE_DAYS_RANGE.min, maxDays: CARD_CYCLE_DAYS_RANGE.max,
          },
          // Monthly-equivalent CASH the household already pays against it, and
          // how well that is known. Most of these minimums are a future
          // statement amount held at today's level, and the page has to say so
          // — every payoff figure below is measured against this one.
          minimum: cash.monthly,
          minimumConfidence: cash.confidence,
          // Why there is, or is not, one — so the page states the reason rather
          // than rendering a silent blank. A facility whose only charge is
          // capitalised has no cash minimum, and saying so is the difference
          // between "$0.00" and "$814.18 that nobody pays".
          minimumId: cash.monthly > 0 ? 'cash' : 'none',
          unmodelled: cash.unmodelled,
        };
        debt.bounds = payoffBounds(debt);
        debt.presets = [
          { id: 'minimum', months: null, amount: debt.minimum },
          { id: 'clear-60', months: 60, amount: paymentForMonths(debt, 60) },
          { id: 'clear-36', months: 36, amount: paymentForMonths(debt, 36) },
          { id: 'clear-12', months: 12, amount: paymentForMonths(debt, 12) },
        ].filter(p => p.amount > 0 && isFinite(p.amount));
        return debt;
      });
  }

  // What `monthlyPayment` does to `debt`, and what it buys against the minimum.
  //
  // `debt` is one entry from `payoffDebts` — the balance, the rate convention
  // and the minimum have already been settled there, so this cannot be run on a
  // debt picture nothing agreed to.
  function payoffModel(debt, monthlyPayment) {
    const i = debt.monthlyRate, balance = debt.balance;
    const interestOnly = debt.interestOnly;
    const project = P => {
      // At or below the interest charge nothing is repaid and the balance
      // grows. `<=` and not `<`: a payment exactly equal to the interest holds
      // the balance still forever, which is not a payoff.
      if (!(P > interestOnly)) return { clears: false, interestOnly, shortfall: interestOnly - P };
      const months = i === 0 ? balance / P
        : -Math.log(1 - (balance * i) / P) / Math.log(1 + i);
      const totalPaid = months * P;
      return { clears: true, interestOnly, shortfall: 0, months, totalPaid,
        totalInterest: totalPaid - balance };
    };
    const here = project(Number(monthlyPayment));
    const atMinimum = debt.minimum > 0 ? project(debt.minimum) : null;
    return {
      payment: Number(monthlyPayment),
      ...here,
      // What paying more than the minimum actually buys. Withheld unless there
      // IS a cash minimum, it clears, this payment clears, and the saving is
      // real — "saves $0.00 and clears it 0 months sooner" is not a finding,
      // and a saving measured against a minimum that never clears is measured
      // against infinity.
      versusMinimum: atMinimum && atMinimum.clears && here.clears
        && atMinimum.totalInterest - here.totalInterest > EPSILON
        ? { interestSaved: atMinimum.totalInterest - here.totalInterest,
          monthsSooner: atMinimum.months - here.months }
        : null,
    };
  }

  const Forecast = { addDays, diffDays, occurrences, expandEvents, simulate,
    recommendWeekly, recommend, incomeDeadline, counterfactuals,
    budgetBreakdown, monthlyFromWeekly,
    projectDebts,
    nextDue, nextPaymentOut, unallocatedCash, compactSnapshot, publicationTotals, deepDive, planStatus, mission, planPhases, nextMove, utilisation, renewal,
    payoffDebts, payoffModel,
    paymentForMonths, EPSILON, STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = Forecast;
  else root.Forecast = Forecast;

})(typeof window !== 'undefined' ? window : globalThis);
