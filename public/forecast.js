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
  function monthlyDates(day, start, end, firstDue) {
    const out = [];
    let [y, m] = start.split('-').map(Number);
    for (let i = 0; i < 5; i++) { // window is 13 weeks; 5 months always covers it
      const d = Math.min(day, daysInMonth(y, m));
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso >= start && iso <= end && (!firstDue || iso >= firstDue)) out.push(iso);
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

  /* --------------------------------------------------------------- events */
  // opts: { scenario, incomeOverrides: {id: monthlyAmount}, disabled: [ids],
  //         injections: [{date, amount}] — one-off cash arriving from outside
  //         the plan, used to model covering an opening gap }
  function streamAmount(stream, opts) {
    const override = opts.incomeOverrides && opts.incomeOverrides[stream.id];
    let monthly = null;
    if (override != null && isFinite(override)) monthly = Number(override);
    else if (stream.scenarioMonthly) monthly = stream.scenarioMonthly[opts.scenario || 'expected'];
    if (monthly == null) return stream.amount; // fixed, confirmed amount
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
    const funding = {
      parts, shortfall,
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
        historical, dated: dated.total, datedItems: dated.items, target, planned,
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

    return {
      basis, basisLabel: window.label, months: window.months, categories,
      essentialMonthly: sum(isClass('essential')),
      discretionaryMonthly: sum(isClass('discretionary')),
      unknownMonthly: sum(isClass('unknown')),
      reserveMonthly: sum(isClass('reserve')),
      datedMonthly: categories.reduce((s, c) => s + c.dated, 0),
      historicalMonthly: categories.reduce((s, c) => s + c.historical, 0),
      // Major dated commitments the household saves for rather than absorbing
      // into a monthly line — the lacrosse season, camps, registrations.
      sinkingMonthly: sinking.total,
      sinkingItems: sinking.items,
      ownerTargetCount: categories.filter(c => c.target != null).length,
      // What the cap must cover before anything optional happens.
      requiredMonthly: sum(c => c.class === 'essential' || c.class === 'unknown'),
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
      // Pending charges are ALREADY INCURRED. A card whose posted balance is
      // under its limit but whose pending charges take it over is over its
      // limit — the settlement is bookkeeping, not a decision. Carrying them
      // from the opening balance is what makes headroom, over-limit state and
      // interest all agree with what the institution would say today.
      const pending = x.pending || 0;
      const opening = x.balance + pending;
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
  // Which item on the published payment calendar the household owes next.
  //
  // The Deep Dive page used to answer this itself: it filtered `upcoming`,
  // sorted it and took the first. That made a household-facing selection an
  // untested page-script authority — and the ordering was not even stated,
  // because the comparator never returned 0, so two obligations falling on one
  // day were ranked by whatever the sort implementation happened to do.
  //
  // Eligibility, unchanged from what the page already meant:
  //
  //   PAID      settled already, so nothing is owed.
  //   NONCASH   capitalised interest. It is a real cost and the calendar shows
  //             it, but no cash leaves an account, so it is not a payment due.
  //   PAST DUE  before the as-of date. The tile answers "what is next", not
  //             "what is outstanding"; the calendar below still lists a missed
  //             item with its own "Nd ago" chip.
  //
  // Earliest eligible date wins. Where two share that date the calendar's own
  // order decides, stated here rather than left to a sort — the forward scan
  // keeps the first and a later equal date never displaces it.
  //
  // This names ONE obligation. What the whole day costs is a different
  // question, and the Plan page's "next payment out" answers it by summing the
  // events on that date; reconciling the two calendars is B74.
  function nextDue(upcoming, asOf) {
    let best = null;
    for (const item of upcoming || []) {
      if (item.status === 'paid' || item.kind === 'noncash') continue;
      const days = diffDays(asOf, item.due);
      if (days < 0) continue;
      if (!best || item.due < best.item.due) best = { item, days };
    }
    if (!best) return null;
    return {
      due: best.item.due,
      what: best.item.what,
      amount: best.item.amount,
      daysUntil: best.days,
    };
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
      const used = x.balance + pending;
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

  const Forecast = { addDays, diffDays, occurrences, expandEvents, simulate,
    recommendWeekly, recommend, incomeDeadline, budgetBreakdown, projectDebts,
    nextDue, utilisation, EPSILON, STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = Forecast;
  else root.Forecast = Forecast;

})(typeof window !== 'undefined' ? window : globalThis);
