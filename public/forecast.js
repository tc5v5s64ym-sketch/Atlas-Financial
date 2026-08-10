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
        // A non-cash charge (HELOC interest capitalising onto the balance) is
        // shown on the calendar but never deducted from cash.
        events.push({ date, amount: -o.amount, kind: o.nonCash ? 'noncash' : 'obligation',
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
    for (const inj of opts.injections || []) {
      if (inj.amount > 0 && inj.date >= start && inj.date <= end) {
        events.push({ date: inj.date, amount: inj.amount, kind: 'injection',
          label: inj.label || 'Gap funding', id: inj.id || 'gapFunding',
          confidence: inj.confidence || 'planned' });
      }
    }
    if (opts.extraDebtMonthly > 0) {
      // Applied mid-month, the day after the usual payday pattern.
      for (const date of monthlyDates(15, start, end)) {
        events.push({ date, amount: -opts.extraDebtMonthly, kind: 'extra', label: 'Extra debt payment', id: 'extra', confidence: 'planned' });
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

    const recovery = Object.assign({}, base, {
      injections: [{ date: gapDate, amount: gapAmount, id: 'gapFunding',
        label: 'Gap funding — transfer or draw' }],
      variableFrom: spendFrom,
      measureFrom: gapDate,
    });
    const weekly = recommendWeekly(plan, asOf, recovery);
    return finish('openingGap', recovery, weekly, spendFrom,
      { amount: gapAmount, date: gapDate, dueOnGapDay, preIncomeOut,
        floor: zero.min.balance, floorDate: zero.min.date }, zero);

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
    for (const c of plan.commitments || []) {
      if ((opts.disabled || []).indexOf(c.id) >= 0) continue;
      addDated(c.budgetCategory, c.amount / monthsInWindow, c.label, 'commitment');
    }

    const categories = (budget.categories || []).map(c => {
      const historical = (c.from || []).reduce((s, label) =>
        s + (label === '@paypal' ? (opts.paypalPerMonth || 0) : perMonth(label)), 0);
      const dated = datedByCategory[c.id] || { total: 0, items: [] };
      // An owner target, when one exists, beats the historical average.
      const target = c.plannedMonthly != null ? c.plannedMonthly : null;
      const gross = target != null ? target : historical;
      const planned = Math.max(0, gross - dated.total);
      return Object.assign({}, c, {
        historical, dated: dated.total, datedItems: dated.items, target, planned,
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
    const days = plan.windowDays || 91;
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const byId = {};
    const state = (debts || []).map(x => {
      const s = {
        id: x.id, label: x.label, secured: !!x.secured, rate: x.rate || 0,
        limit: x.limit, opening: x.balance, balance: x.balance,
        interestByEvent: !!x.interestByEvent, principalShare: x.principalShare,
        interest: 0, paid: 0, capitalised: 0,
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

    const marks = [];
    const snapshot = (day, date) => ({
      day, date,
      debts: state.map(s => ({
        id: s.id, label: s.label, secured: s.secured, balance: s.balance,
        limit: s.limit,
        available: s.limit != null ? Math.max(0, s.limit - s.balance) : null,
        overLimit: s.limit != null && s.balance > s.limit,
        interest: s.interest, paid: s.paid,
      })),
      consumer: state.filter(s => !s.secured).reduce((a, s) => a + s.balance, 0),
      secured: state.filter(s => s.secured).reduce((a, s) => a + s.balance, 0),
      heloc: byId.heloc ? byId.heloc.balance : 0,
      // Revolving headroom across every facility that has a limit.
      headroom: state.filter(s => s.limit != null)
        .reduce((a, s) => a + Math.max(0, s.limit - s.balance), 0),
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
          // principal share moves the balance.
          const principal = t.principalShare != null ? amount * t.principalShare : amount;
          t.balance = Math.max(0, t.balance - principal);
          t.paid += amount;
          if (t.principalShare != null) t.interest += amount - principal;
        } else if (e.kind === 'extra' && extraTarget) {
          extraTarget.balance = Math.max(0, extraTarget.balance - -e.amount);
          extraTarget.paid += -e.amount;
        }
      }
      const dayNo = i + 1;
      if (dayNo === 30 || dayNo === 60 || dayNo === 90 || dayNo === days) {
        if (!marks.some(m => m.date === date)) marks.push(snapshot(dayNo, date));
      }
    }

    return {
      marks, byId, end,
      // Everything an extra payment did NOT reach, so an untargeted one is
      // visible rather than silently vanishing into cash.
      untargetedExtra: opts.extraDebtMonthly > 0 && !extraTarget,
    };
  }

  const Forecast = { addDays, diffDays, occurrences, expandEvents, simulate,
    recommendWeekly, recommend, budgetBreakdown, projectDebts, EPSILON, STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = Forecast;
  else root.Forecast = Forecast;

})(typeof window !== 'undefined' ? window : globalThis);
