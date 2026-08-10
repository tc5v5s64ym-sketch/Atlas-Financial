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

  /* --------------------------------------------------------------- events */
  // opts: { scenario, incomeOverrides: {id: monthlyAmount}, disabled: [ids] }
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
        events.push({ date, amount: -o.amount, kind: 'obligation', label: o.label, id: o.id, confidence: o.confidence });
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
  // opts adds: weeklyVariable (spread evenly across the 7 days of each week)
  function simulate(plan, asOf, opts) {
    opts = opts || {};
    const days = plan.windowDays || 91;
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const dailyVariable = (opts.weeklyVariable || 0) / 7;

    const byDate = new Map();
    for (const e of events) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }

    let balance = plan.startingCash.amount;
    const daily = [];
    let min = { date: start, balance };
    const weeks = [];
    let week = null;

    for (let i = 0; i < days; i++) {
      const date = addDays(start, i);
      if (i % 7 === 0) {
        week = {
          n: weeks.length + 1, start: date, end: addDays(date, 6),
          opening: balance, confirmedIncome: 0, estimatedIncome: 0,
          obligations: 0, bills: 0, commitments: 0, variable: 0, extra: 0,
          closing: balance, events: [], belowBuffer: false, negative: false,
        };
        weeks.push(week);
      }
      const todays = byDate.get(date) || [];
      for (const e of todays) {
        balance += e.amount;
        if (e.kind === 'income') {
          if (e.confidence === 'confirmed') week.confirmedIncome += e.amount;
          else week.estimatedIncome += e.amount;
        } else if (e.kind === 'obligation') week.obligations += -e.amount;
        else if (e.kind === 'bill') week.bills += -e.amount;
        else if (e.kind === 'commitment') week.commitments += -e.amount;
        else if (e.kind === 'extra') week.extra += -e.amount;
        week.events.push(e);
        // The intra-day low matters: a big payment can dip below the buffer
        // even when the day closes fine. Income sorts first, so this is the
        // cautious reading of the day.
        if (balance < min.balance) min = { date, balance };
      }
      balance -= dailyVariable;
      week.variable += dailyVariable;
      if (balance < min.balance) min = { date, balance };
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
      obligations: weeks.reduce((s, w) => s + w.obligations, 0),
      bills: weeks.reduce((s, w) => s + w.bills, 0),
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
  // day of the projection at or above the target buffer. Monotonic in W, so
  // binary search is exact.
  function recommendWeekly(plan, asOf, opts) {
    opts = Object.assign({}, opts || {});
    const fits = w => {
      opts.weeklyVariable = w;
      return simulate(plan, asOf, opts).min.balance >= (opts.targetBuffer != null ? opts.targetBuffer : plan.defaults.targetBuffer);
    };
    if (!fits(0)) return 0; // even zero spending breaches the buffer
    let lo = 0, hi = 5000;
    while (fits(hi)) { lo = hi; hi *= 2; if (hi > 80000) break; }
    while (hi - lo > 5) {
      const mid = Math.round((lo + hi) / 10) * 5;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  const Forecast = { addDays, diffDays, occurrences, expandEvents, simulate, recommendWeekly };
  if (typeof module !== 'undefined' && module.exports) module.exports = Forecast;
  else root.Forecast = Forecast;

})(typeof window !== 'undefined' ? window : globalThis);
