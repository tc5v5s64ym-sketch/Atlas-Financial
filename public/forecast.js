'use strict';
/* Forecast engine — the one master household plan.
   Pure functions, no DOM: the browser page and the node test suite both load
   this file, so what is tested is exactly what is shown.

   The Plan page still *displays* a 13-week view. That view is a slice. The
   engine's knowledge horizon is at least twelve months for every plan, and
   always long enough to include every dated unsettled commitment. Changing
   the visible range does not change what the plan knows.

   Every event carries the confidence it arrived with ('confirmed' or
   'estimated') so the UI can keep the two visually apart. The engine never
   invents an amount: it expands the recurrences declared in data.json's
   `plan` block, reserves undated current-regime monthly amounts as daily
   cash, and simulates the ledger day by day. */

(function (root) {

  /* --------------------------------------------------------------- dates */
  // ISO date strings throughout; arithmetic in UTC so DST can never shift a
  // payday. A date here is a calendar day, not an instant.
  // Instants become household calendar days via financialDate() in
  // America/Vancouver (ACCOUNT_FACTS household timezone). Do not slice a
  // UTC timestamp's YYYY-MM-DD prefix. Calendar-day arithmetic stays UTC.
  const HOUSEHOLD_TIMEZONE = 'America/Vancouver';
  const ISO_CALENDAR_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
  function financialDate(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    if (ISO_CALENDAR_DATE.test(s)) return s;
    if (!ISO_INSTANT.test(s)) return null;
    const instant = new Date(s);
    if (Number.isNaN(instant.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: HOUSEHOLD_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const year = parts.find(p => p.type === 'year');
    const month = parts.find(p => p.type === 'month');
    const day = parts.find(p => p.type === 'day');
    if (!year || !month || !day) return null;
    return `${year.value}-${month.value}-${day.value}`;
  }
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

  const MONTH_SHORT = [
    '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  // Seaspan payday cycle: Dale's biweekly payroll is the operating-period
  // boundary and the Household Budget spent/planned window. A cycle starts
  // on a Seaspan payday and ends the calendar day before the next Seaspan
  // payday. Amanda salary and child benefit do not reset this cycle.
  function seaspanPayroll(plan) {
    const rows = (plan && plan.income) || [];
    return rows.find(row => row && (row.id === 'payroll' || /seaspan/i.test(row.label || '')))
      || null;
  }
  function formatSpendingCycleRange(start, end) {
    if (!start || !end) return '';
    const [ys, ms, ds] = String(start).split('-').map(Number);
    const [ye, me, de] = String(end).split('-').map(Number);
    const a = MONTH_SHORT[ms] + ' ' + ds;
    const b = MONTH_SHORT[me] + ' ' + de;
    return a + '–' + b;
  }
  function spendingCycle(plan, asOf) {
    const stream = seaspanPayroll(plan);
    const day = financialDate(asOf);
    const anchor = stream && financialDate(stream.anchor);
    if (!stream || !anchor || !day) return null;
    const from = addDays(day, -42);
    const to = addDays(day, 42);
    const dates = biweeklyDates(anchor, from, to);
    let start = null;
    let next = null;
    for (const d of dates) {
      if (d <= day) start = d;
      if (d > day && !next) next = d;
    }
    if (!start) return null;
    if (!next) next = addDays(start, 14);
    const end = addDays(next, -1);
    const rangeLabel = formatSpendingCycleRange(start, end);
    return {
      start,
      end,
      nextPayday: next,
      days: diffDays(start, end) + 1,
      rangeLabel,
      label: 'Spending cycle: ' + rangeLabel,
    };
  }
  // Default Plan operating views: this Seaspan payday through the day
  // before the next, then the following payday through the day before
  // the one after that. Derived from spendingCycle; not calendar halves.
  function operatingPayPeriodWindows(plan, asOf) {
    const current = spendingCycle(plan, asOf);
    if (!current || !current.start || !current.end) return [];
    const windows = [{
      id: 'this-pay-period',
      label: 'This Pay Period',
      rangeLabel: formatSpendingCycleRange(current.start, current.end),
      start: current.start,
      end: current.end,
      cycle: current,
      role: 'active',
    }];
    const next = current.nextPayday ? spendingCycle(plan, current.nextPayday) : null;
    if (next && next.start && next.end && next.start !== current.start) {
      windows.push({
        id: 'next-pay-period',
        label: 'Next Pay Period',
        rangeLabel: formatSpendingCycleRange(next.start, next.end),
        start: next.start,
        end: next.end,
        cycle: next,
        role: 'future',
      });
    }
    return windows;
  }
  function windowContainingDate(windows, date) {
    if (!date) return null;
    for (let i = 0; i < (windows || []).length; i++) {
      const w = windows[i];
      if (w && w.start && w.end && date >= w.start && date <= w.end) return w;
    }
    return null;
  }
  function coveringSpan(windows) {
    let start = null;
    let end = null;
    for (let i = 0; i < (windows || []).length; i++) {
      const w = windows[i];
      if (!w || !w.start || !w.end) continue;
      if (!start || w.start < start) start = w.start;
      if (!end || w.end > end) end = w.end;
    }
    return start && end ? { start, end } : null;
  }
  // Shift `iso`'s month by `n`, keeping the requested day-of-month and
  // clamping to shorter months (31 January + 3 months → 30 April).
  function addCalendarMonths(iso, n, day) {
    let [y, m] = iso.split('-').map(Number);
    m += n;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    const d = Math.min(day, daysInMonth(y, m));
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  // Every 3 months on `day`. Phase comes from `anchor` if present, else
  // `firstDue`. Without a phase-bearing field the expander fails closed:
  // inventing an origin from the caller's `start` would make the same
  // canonical row produce a different schedule for a different view.
  // `firstDue` is also a filter, not a rewrite of the cadence: dates
  // before it are omitted rather than shifted, so an observed historical
  // payment can set the phase without manufacturing a pre-opening unpaid
  // event.
  function quarterlyDates(day, start, end, firstDue, anchor) {
    const phaseIso = anchor || firstDue;
    if (!phaseIso) return [];
    const [y, m] = phaseIso.split('-').map(Number);
    const d = Math.min(day, daysInMonth(y, m));
    const origin = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const out = [];
    let t = origin;
    while (t > start) t = addCalendarMonths(t, -3, day);
    while (t <= end) {
      if (t >= start && (!firstDue || t >= firstDue)) out.push(t);
      t = addCalendarMonths(t, 3, day);
    }
    return out;
  }
  // Once a year on `month`/`day`. Month is 1-based. The month+day pair is the
  // cadence, the same way monthly uses only `day`. Missing or non-integer
  // month/day fails closed rather than inventing 1 January or the caller's
  // start. `firstDue` is a filter, not a rewrite of the calendar day.
  function yearlyDates(month, day, start, end, firstDue) {
    const m = Number(month);
    const requestedDay = Number(day);
    if (!Number.isInteger(m) || m < 1 || m > 12) return [];
    if (!Number.isInteger(requestedDay) || requestedDay < 1 || requestedDay > 31) return [];
    const out = [];
    let y = Number(String(start).slice(0, 4)) - 1;
    const endYear = Number(String(end).slice(0, 4));
    if (!Number.isInteger(y) || !Number.isInteger(endYear)) return [];
    while (y <= endYear + 1) {
      const d = Math.min(requestedDay, daysInMonth(y, m));
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso > end) break;
      if (iso >= start && (!firstDue || iso >= firstDue)) out.push(iso);
      y++;
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
    if (item.frequency === 'quarterly') {
      return quarterlyDates(item.day, start, end, item.firstDue, item.anchor);
    }
    if (item.frequency === 'yearly') {
      return yearlyDates(item.month, item.day, start, end, item.firstDue);
    }
    return [];
  }

  // Cadence occurrences() answers whether a declared once date sits inside
  // the window. That is not settlement. A once cash outflow still on the
  // plan remains owed if Forecast start later moves past that date: the
  // event keeps its scheduled/reservation date, and the cash walk still
  // deducts it at this opening. Advancing as-of is not a new due date.
  // Received once income keeps window semantics — that cash is already
  // inside the opening observation. Non-cash once charges keep window
  // semantics so a historical capitalisation is not applied again.
  // Settled once outflows are removed, named on representedEvents for
  // this start, or encoded as firstDue on the recurring row.
  function onceOutflowDates(item, start, end) {
    if (!item || item.frequency !== 'once' || !item.date) return [];
    if (item.date > end) return [];
    if (item.date >= start) return [item.date];
    if (item.nonCash) return [];
    return [item.date];
  }
  function outflowDates(item, start, end) {
    return item && item.frequency === 'once'
      ? onceOutflowDates(item, start, end)
      : occurrences(item, start, end);
  }

  // The household CASH minimum on a capitalising obligation (the HELOC).
  // The interest itself is a non-cash `capitalise` event in expandEvents;
  // the cash minimum is a separate planned outflow keyed by `cashDay` /
  // `cashFirstDue`. One rule, read by the Plan bills list and by the Credit
  // page, so the two can never print different dates or amounts. Empty when
  // the obligation is not capitalising or declares no cash minimum.
  function capitalisingCashMinimumOccurrences(o, start, end) {
    const cashAmt = Number(o && o.cashPayment) || 0;
    if (!o || !o.nonCash || !(cashAmt > EPSILON) || o.cashDay == null) return [];
    const dates = outflowDates({
      frequency: o.frequency,
      day: o.cashDay,
      firstDue: o.cashFirstDue || o.firstDue || null,
    }, start, end);
    return dates.map(date => ({
      date,
      amount: roundCent(cashAmt),
      label: o.cashLabel || o.label,
      confidence: o.cashConfidence || o.confidence || 'estimated',
      payingAccount: o.payingAccount || null,
      debtId: o.debtId || null,
      id: o.id,
    }));
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
  const pendingUnknown = x => !!(x && (x.pendingUnknown === true || x.unknownPending === true));
  // Published headroom and over-limit. Known pending is already inside
  // `openingBalance`. Unknown pending is not $0: posted room is not published,
  // and under-limit is not claimed, until pending is observed. A posted
  // balance already over the limit is over regardless of pending.
  function publishedAvailable(limit, used, unknownPending) {
    if (limit == null) return null;
    if (unknownPending && !(used > limit)) return null;
    return Math.max(0, limit - used);
  }
  function publishedOverLimit(limit, used, unknownPending) {
    if (limit == null) return false;
    if (used > limit) return true;
    if (unknownPending) return null;
    return false;
  }
  function publishedOverLimitBy(limit, used, unknownPending) {
    if (limit == null) return 0;
    if (unknownPending && !(used > limit)) return null;
    return Math.max(0, used - limit);
  }

  // Live cash balances live on `plan.startingCash.breakdown` /
  // `heldElsewhere`. The published opening total, the matching `assets[]`
  // cash rows, and Chequing B overdraft usage are derived from those
  // rows. Synthetic fixtures may still pass `startingCash.amount` or
  // `revolvingExtra[].used` with no cash id.
  function cashAccount(plan, id) {
    const cash = (plan && plan.startingCash) || {};
    const rows = (cash.breakdown || []).concat(cash.heldElsewhere || []);
    return rows.find(r => r.id === id) || null;
  }
  function startingCashAmount(plan) {
    const cash = (plan && plan.startingCash) || {};
    const rows = cash.breakdown || [];
    if (rows.length) return rows.reduce((s, b) => s + (Number(b.value) || 0), 0);
    return Number(cash.amount) || 0;
  }
  function extraFacilityUsed(facility, plan) {
    if (facility && facility.cash) {
      const row = cashAccount(plan, facility.cash);
      return Math.max(0, -((row && Number(row.value)) || 0));
    }
    return Number(facility && facility.used) || 0;
  }
  function resolveExtraFacilities(extra, plan) {
    return (extra || []).map(e => e.cash
      ? Object.assign({}, e, { used: extraFacilityUsed(e, plan) })
      : e);
  }
  function extraFacilityAvailable(facility) {
    if (!facility || facility.limit == null) return 0;
    const used = (Number(facility.used) || 0) + (Number(facility.pending) || 0);
    return Math.max(0, facility.limit - used);
  }
  // Funding-option availability is a view of current cash / utilisation, not a
  // second current-state balance stored on the option. A `cash` locator is an
  // extra facility (overdraft: max(0, limit − used)). A held-elsewhere cash
  // row is observational identity only: Q25 is OPEN, so the raw Amanda /
  // TENNIS INCOME balance is not household `available`. Breakdown cash is
  // overdraft usage, not a funding pot. A `debtId` locator is that facility's
  // published utilisation available; stored `available` is ignored for
  // locators when current state is supplied. A display-only option with
  // neither locator (`unusable`, the cards aggregate) is the residual of
  // unclaimed utilisation. A usable option with a declared planning available
  // and no locator keeps that figure (fixtures, a counterfactual top-up).
  // Chequing B remains the overdraft usage authority.
  function resolveFundingSources(sources, extra, plan, debts) {
    extra = resolveExtraFacilities(extra, plan);
    const list = sources || [];
    const byId = new Map();
    const byCash = new Map();
    for (const e of extra || []) {
      byId.set(e.id, e);
      if (e.cash) byCash.set(e.cash, e);
    }
    const claimedDebt = new Set();
    const claimedExtra = new Set();
    for (const src of list) {
      if (src && src.debtId) claimedDebt.add(src.debtId);
      if (src && src.cash) {
        const facility = byCash.get(src.cash) || byId.get(src.id);
        if (facility && facility.id) claimedExtra.add(facility.id);
      }
    }
    const util = debts ? utilisation(debts, extra, plan) : null;
    function derivedAvailable(src) {
      if (!src) return null;
      if (src.cash) {
        const facility = byCash.get(src.cash) || byId.get(src.id);
        if (facility) return extraFacilityAvailable(facility);
        const row = cashAccount(plan, src.cash);
        const isBreakdown = ((plan && plan.startingCash && plan.startingCash.breakdown) || [])
          .some(r => r && r.id === src.cash);
        // Breakdown cash is overdraft usage, not a funding pot. Held-elsewhere
        // cash (Amanda / TENNIS INCOME) is observational: Q25 is OPEN, and
        // the raw balance is not household funding. An explicit owner-authorized
        // `available` on the option may fund; otherwise 0. Missing extra
        // facilities must not treat Chequing B as overdraft headroom.
        if (row && !isBreakdown) {
          return Number.isFinite(src.available) ? Number(src.available) : 0;
        }
        return src.available;
      }
      if (!util) return src.available;
      if (src.debtId) {
        const row = (util.rows || []).find(r => r.id === src.debtId);
        if (!row) return 0;
        return row.available;
      }
      // Usable options with a declared planning available (fixtures, a
      // counterfactual top-up) keep that figure. The live cards aggregate is
      // display-only (`unusable`) and has no locator — its headroom is the
      // residual of unclaimed utilisation, including when a stale number was
      // stored on the row.
      if (src.unusable !== true && Number.isFinite(src.available)) return src.available;
      let sum = 0;
      for (const row of util.rows || []) {
        if (!row || row.limit == null) continue;
        if (claimedDebt.has(row.id) || claimedExtra.has(row.id)) continue;
        if (row.available == null) continue;
        sum += Number(row.available) || 0;
      }
      return sum;
    }
    return list.map(src => {
      if (!src) return src;
      const available = derivedAvailable(src);
      return Object.assign({}, src, { available });
    });
  }

  // Opening-gap recovery may spend household cash the plan already owns.
  // A debtId is borrowing capacity, not cash, and is not automatic permission
  // to draw. Planned borrowing stays opt-in on Forecast.plannedDebt.
  function canAutoCoverOpeningGap(src) {
    if (!src || src.unusable === true) return false;
    if (src.debtId) return false;
    return Number(src.available) > 0;
  }

  // Owner-policy action status stays on the row. A `debtId` means current
  // over-limit / pending-unknown satisfaction is derived from utilisation:
  // unknown pending or over-limit → open; otherwise done. Stored status is
  // ignored for those rows.
  function resolveActions(plan, debts, extra) {
    const actions = ((plan && plan.actions) || []).slice();
    if (!debts) return actions;
    const util = utilisation(debts, extra, plan);
    return actions.map(action => {
      if (!action || !action.debtId) return action;
      const row = (util.rows || []).find(r => r.id === action.debtId);
      let status = action.status;
      if (!row || row.pendingUnknown === true || row.overLimit === true) status = 'open';
      else status = 'done';
      return Object.assign({}, action, { status });
    });
  }
  function assetValue(asset, plan) {
    if (asset && asset.cash) {
      const row = cashAccount(plan, asset.cash);
      return row ? Number(row.value) || 0 : 0;
    }
    return Number(asset && asset.value) || 0;
  }
  function assetRows(data) {
    return (data.assets || []).map(a => Object.assign({}, a, { value: assetValue(a, data.plan) }));
  }
  function historicalIncomePerMonth(row, months) {
    if (!row) return null;
    if (row.perMonth === null) return null;
    if (typeof row.perMonth === 'number') return row.perMonth;
    const window = Number(months);
    if (!(window > 0) || row.total == null) return null;
    return Math.round(Number(row.total) / window);
  }

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
  //         the plan, used to model covering an opening gap,
  //         representedEvents: [{id, date}] — dated occurrences already
  //         inside the opening observation; those are not replayed,
  //         notReliedUponEvents: [{id, date, reason}] — live-overlay
  //         same-day inbound that is not proven represented; omitted from
  //         the cash walk without claiming it posted }
  //
  // Represented events are SCHEDULED occurrences that settlement evidence
  // shows are already inside the opening cash/debt state. Forecast remains
  // authority for what should occur; the list is authority for what has
  // already occurred. Cutover normally uses only the opening date, or the
  // (priorAsOf, asOf] interval when plan.opening.priorAsOf names the previous
  // opening. One narrow historical case is also valid: an exact represented
  // id+date may settle a past once joint-cash outflow that Forecast is still
  // carrying at this start. It cannot settle income, a non-cash charge, a
  // commitment, or an event that is merely similar. A future represented
  // date is ignored for those classes. One prepaid case is also valid: an
  // exact represented id+date may settle a future joint-cash obligation or
  // bill occurrence when that date is a real scheduled outflow after this
  // start. Commitments still use settledOn, not this list. This is not a
  // date-wide skip: an unrepresented same-day event still fires.
  //
  // notReliedUponEvents is a separate live-overlay → Forecast input. It is
  // not representedEvents. An unproven or ambiguous same-day inbound must
  // not be added on top of observed cash, and must not be labelled received.
  // The occurrence is omitted from the cash walk and surfaced as
  // unresolved / not relied upon. A future date on this list is ignored.
  // Failure to find a transaction is not proof the inbound is still
  // future. Incomplete current cash remains a live-overlay fail-closed
  // condition, not this list.
  //
  // A future-dated commitment paid on a known date is a different fact.
  // That lives on the commitment as settledOn and is not expressed
  // through representedEvents. Settlement is opening-relative: the cash
  // requirement is already satisfied only when settledOn <= start.
  function representedKeySet(plan, opts, start) {
    const keys = new Set();
    const opening = plan && plan.opening;
    const prior = opening && opening.asOf === start && opening.priorAsOf
      && opening.priorAsOf < start ? opening.priorAsOf : null;
    const take = item => {
      if (!item || !item.id || !item.date) return;
      if (item.date === start) keys.add(item.id + '@' + item.date);
      else if (prior && item.date > prior && item.date < start) {
        keys.add(item.id + '@' + item.date);
      } else if (carriedOnceJointCashOutflow(plan, item.id, item.date, start)) {
        keys.add(item.id + '@' + item.date);
      } else if (prepaidJointCashOutflow(plan, item.id, item.date, start)) {
        keys.add(item.id + '@' + item.date);
      }
    };
    for (const item of (opts && opts.representedEvents) || []) take(item);
    if (opening && opening.asOf === start) {
      for (const item of opening.representedEvents || []) take(item);
    }
    return keys;
  }
  // Same-day inbound the live overlay will not add to available cash, and
  // will not call represented. Owned at plan.opening / opts, consumed here.
  function notReliedUponKeySet(plan, opts, start) {
    const keys = new Set();
    const opening = plan && plan.opening;
    const take = item => {
      if (!item || !item.id || !item.date) return;
      if (item.date === start) keys.add(item.id + '@' + item.date);
    };
    for (const item of (opts && opts.notReliedUponEvents) || []) take(item);
    if (opening && opening.asOf === start) {
      for (const item of opening.notReliedUponEvents || []) take(item);
    }
    return keys;
  }
  function notReliedUponReason(plan, opts, id, date) {
    const want = item => item && item.id === id && item.date === date && item.reason;
    for (const item of (opts && opts.notReliedUponEvents) || []) {
      if (want(item)) return String(item.reason);
    }
    const opening = plan && plan.opening;
    if (opening && opening.asOf) {
      for (const item of opening.notReliedUponEvents || []) {
        if (want(item)) return String(item.reason);
      }
    }
    return 'same-day-inbound-unproven';
  }
  function omitRepresented(events, plan, opts, start) {
    if (opts && opts.keepRepresented) return events;
    const represented = representedKeySet(plan, opts, start);
    const notRelied = notReliedUponKeySet(plan, opts, start);
    if (!represented.size && !notRelied.size) return events;
    return events.filter(e => !represented.has(e.id + '@' + e.date)
      && !notRelied.has(e.id + '@' + e.date));
  }

  // Machine-readable settlement fact on a dated commitment. A valid
  // YYYY-MM-DD records when the cash requirement was satisfied. The
  // commitment row stays; human-readable historical status is derived
  // from that date. Whether THIS Forecast still reserves the cash is
  // opening-relative: settledOn <= simulation start. Garbage, empty,
  // missing, or a start that is not a date are not settlement — fail
  // closed, so the commitment stays reserved.
  const SETTLED_ON = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
  function commitmentSettledOn(c) {
    const d = c && c.settledOn;
    return typeof d === 'string' && SETTLED_ON.test(d) ? d : null;
  }
  function commitmentSettledBy(c, start) {
    const d = commitmentSettledOn(c);
    return !!(d && typeof start === 'string' && SETTLED_ON.test(start) && d <= start);
  }
  function commitmentStatus(c) {
    return commitmentSettledOn(c) ? 'settled' : 'unsettled';
  }

  /* ------------------------------------------- one plan, many windows */
  // The knowledge horizon is how far the master forecast knows. Named
  // ranges are views of that same walk. A short display window cannot
  // drop a later dated commitment, and a longer display cannot invent
  // one. Undated rows still emit no cash event (B95); they participate
  // in funding sequence and major-plan verdicts without a fabricated day.
  const KNOWLEDGE_MIN_DAYS = 365;

  // Owner-stated point amount only. A range is not collapsed to its floor,
  // a midpoint, or any other stand-in. No point amount → no point need.
  // Range bounds stay on the row and are read separately.
  function commitmentNeed(c) {
    if (!c) return null;
    if (c.amount != null && isFinite(Number(c.amount))) return Number(c.amount);
    return null;
  }

  function commitmentRange(c) {
    if (!c) return { amountMin: null, amountMax: null };
    return {
      amountMin: c.amountMin != null && isFinite(Number(c.amountMin)) ? Number(c.amountMin) : null,
      amountMax: c.amountMax != null && isFinite(Number(c.amountMax)) ? Number(c.amountMax) : null,
    };
  }

  // required / bounded-flex / optional. Derived from owner-stated fields;
  // never written onto live rows. `adjustable` alone is bounded-flex, not
  // optional. An explicit flexibility value wins when present.
  function commitmentFlexibility(c) {
    if (!c) return 'required';
    if (c.flexibility === 'required' || c.flexibility === 'bounded-flex'
      || c.flexibility === 'optional') return c.flexibility;
    if (c.optional === true) return 'optional';
    if (c.adjustable) return 'bounded-flex';
    return 'required';
  }

  function commitmentHasRange(c) {
    if (!c) return false;
    const range = commitmentRange(c);
    return range.amountMin != null || range.amountMax != null;
  }

  function commitmentBounds(c) {
    const flexibility = commitmentFlexibility(c);
    const point = commitmentNeed(c);
    const range = commitmentRange(c);
    const floor = point != null ? point : (range.amountMin != null ? range.amountMin : 0);
    const ceiling = point != null ? point
      : (range.amountMax != null ? range.amountMax : floor);
    return { floor, ceiling, flexibility };
  }

  function knowledgeHorizon(plan, asOf, opts) {
    opts = opts || {};
    const disabled = new Set(opts.disabled || []);
    let lastDated = 0;
    for (const c of plan.commitments || []) {
      if (disabled.has(c.id)) continue;
      if (commitmentSettledBy(c, asOf)) continue;
      // A dated range still has a deadline. Skipping it because it has no
      // point amount would let later income fund a cost that was due earlier.
      if (!c.date || c.date < asOf) continue;
      if (commitmentNeed(c) == null && !commitmentHasRange(c)) continue;
      lastDated = Math.max(lastDated, diffDays(asOf, c.date) + 1);
    }
    // Knowledge does not follow the visible range. Every plan knows at
    // least twelve months, whether or not recurring streams exist.
    // A later dated commitment can extend that. 7/14/91-day windows
    // remain views of that same walk.
    const days = Math.max(KNOWLEDGE_MIN_DAYS, lastDated);
    return { start: asOf, end: addDays(asOf, days - 1), days };
  }

  function nextPaydayDate(plan, asOf, opts) {
    opts = opts || {};
    const floor = opts.paydayFloor != null ? opts.paydayFloor : 1000;
    const probeEnd = addDays(asOf, Math.max(60, (plan.windowDays || 91) - 1));
    const events = expandEvents(plan, asOf, probeEnd, opts);
    const hit = events.find(e => e.kind === 'income' && e.amount >= floor && e.date >= asOf);
    return hit ? hit.date : null;
  }

  function previousPaydayDate(plan, asOf, opts) {
    opts = opts || {};
    const floor = opts.paydayFloor != null ? opts.paydayFloor : 1000;
    const probeStart = addDays(asOf, -Math.max(60, (plan.windowDays || 91) - 1));
    if (!probeStart || probeStart >= asOf) return null;
    const events = expandEvents(plan, probeStart, addDays(asOf, -1), opts);
    let hit = null;
    for (const e of events || []) {
      if (e.kind !== 'income' || !(e.amount >= floor) || e.date >= asOf) continue;
      if (!hit || e.date > hit) hit = e.date;
    }
    return hit;
  }

  // Current payday-period start: this payday, else the previous payday.
  // Distinct from periodOriginDate, which stays as-of unless a live overlay
  // named priorAsOf. Observation reconciliation uses this so a recurring
  // bill due earlier in the payday period cannot fall out of the bill list.
  function paydayPeriodOrigin(plan, asOf, opts) {
    opts = opts || {};
    const cal = opts.paydayCalendar || paydayCalendar(plan, asOf, opts);
    if (cal.todayIsPayday) return asOf;
    return previousPaydayDate(plan, asOf, opts)
      || periodOriginDate(plan, asOf, cal.todayIsPayday);
  }

  function viewRange(plan, asOf, spec, opts) {
    opts = opts || {};
    const knowledge = knowledgeHorizon(plan, asOf, opts);
    let id = 'custom';
    let requestedDays = knowledge.days;
    if (spec == null || spec === '13-week') {
      id = '13-week';
      requestedDays = 91;
    } else if (spec === 'week') {
      id = 'week';
      requestedDays = 7;
    } else if (spec === 'payday') {
      id = 'payday';
      const payday = nextPaydayDate(plan, asOf, opts);
      requestedDays = payday ? Math.max(1, diffDays(asOf, payday) + 1) : 14;
    } else if (spec === 'month') {
      id = 'month';
      const [y, m] = asOf.split('-').map(Number);
      const monthEnd = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
      requestedDays = Math.max(1, diffDays(asOf, monthEnd) + 1);
    } else if (spec === '6-month') {
      id = '6-month';
      requestedDays = 183;
    } else if (spec === '1-year') {
      id = '1-year';
      requestedDays = 365;
    } else if (typeof spec === 'number' && spec > 0) {
      id = 'custom';
      requestedDays = Math.floor(spec);
    } else if (spec && spec.start && spec.end) {
      id = 'custom';
      let start = spec.start < asOf ? asOf : spec.start;
      if (start > knowledge.end) start = knowledge.end;
      let end = spec.end > knowledge.end ? knowledge.end : spec.end;
      if (end < start) end = start;
      return { id, start, end, days: Math.max(1, diffDays(start, end) + 1), knowledge };
    } else if (spec && spec.days > 0) {
      id = 'custom';
      requestedDays = Math.floor(spec.days);
    }
    const days = Math.min(requestedDays, knowledge.days);
    return { id, start: asOf, end: addDays(asOf, days - 1), days, knowledge };
  }

  function resolveViewDays(plan, asOf, opts) {
    opts = opts || {};
    if (opts.viewDays != null) return opts.viewDays;
    if (opts.view) return viewRange(plan, asOf, opts.view, opts).days;
    return plan.windowDays || 91;
  }

  function walkDays(plan, asOf, opts) {
    opts = opts || {};
    if (opts.horizonDays != null) return opts.horizonDays;
    if (opts.viewDays != null) return opts.viewDays;
    return plan.windowDays || 91;
  }

  // Undated current-regime recurring cost. Owner targets beat it and stay
  // cap remainders. This is not a due date, a second bill engine, or a
  // card-charge router: simulate reserves the monthly amount as daily cash
  // so a card-paid service still has gravity without a fabricated day.
  function currentRegimeMonthly(plan) {
    return ((plan && plan.budget && plan.budget.categories) || []).reduce((sum, c) => {
      if (!c || c.plannedMonthly != null || c.currentMonthly == null) return sum;
      const n = Number(c.currentMonthly);
      return isFinite(n) ? sum + n : sum;
    }, 0);
  }

  function sliceSimulationFrom(full, asOf, viewStart, viewDays, plan, opts) {
    const startIdx = full.daily.findIndex(d => d.date >= viewStart);
    if (startIdx < 0) return full;
    const take = viewDays == null ? full.daily.length - startIdx : Math.max(1, viewDays);
    const daily = full.daily.slice(startIdx, startIdx + take);
    if (!daily.length) return full;
    if (startIdx === 0 && daily.length === full.daily.length) return full;
    const start = daily[0].date;
    const end = daily[daily.length - 1].date;
    const walkStart = full.start;
    const events = (full.events || []).filter(e => {
      const apply = cashWalkDate(e, walkStart);
      return apply >= start && apply <= end;
    });
    const weeks = (full.weeks || []).filter(w => w.start <= end && w.end >= start).map(w => {
      const copy = Object.assign({}, w);
      if (copy.start < start) copy.start = start;
      if (copy.end > end) copy.end = end;
      const weekEvents = (full.events || []).filter(e => {
        const apply = cashWalkDate(e, walkStart);
        return apply >= copy.start && apply <= copy.end;
      });
      copy.events = weekEvents;
      copy.confirmedIncome = weekEvents.filter(e => e.kind === 'income' && e.confidence === 'confirmed')
        .reduce((s, e) => s + e.amount, 0);
      copy.estimatedIncome = weekEvents.filter(e => e.kind === 'income' && e.confidence !== 'confirmed')
        .reduce((s, e) => s + e.amount, 0);
      copy.injections = weekEvents.filter(e => e.kind === 'injection').reduce((s, e) => s + e.amount, 0);
      copy.obligations = weekEvents.filter(e => e.kind === 'obligation').reduce((s, e) => s + -e.amount, 0);
      copy.bills = weekEvents.filter(e => e.kind === 'bill' && e.jointCash !== false && !e.cardPaid)
        .reduce((s, e) => s + -e.amount, 0);
      copy.noncash = weekEvents.filter(e => e.kind === 'noncash').reduce((s, e) => s + -e.amount, 0);
      copy.commitments = weekEvents.filter(e => e.kind === 'commitment').reduce((s, e) => s + -e.amount, 0);
      copy.extra = weekEvents.filter(e => e.kind === 'extra' || e.kind === 'planned-debt')
        .reduce((s, e) => s + -e.amount, 0);
      const weekDays = daily.filter(d => d.date >= copy.start && d.date <= copy.end);
      const fullIdx = full.daily.findIndex(d => d.date === copy.start);
      copy.opening = fullIdx > 0 ? full.daily[fullIdx - 1].balance : startingCashAmount(plan);
      copy.closing = weekDays.length ? weekDays[weekDays.length - 1].balance : copy.closing;
      const residual = weekDays.reduce((s, p, i) => {
        const prev = i ? weekDays[i - 1].balance : copy.opening;
        const eventNet = weekEvents.filter(e => cashWalkDate(e, walkStart) === p.date && e.kind !== 'noncash' && e.jointCash !== false)
          .reduce((n, e) => n + e.amount, 0);
        return s + Math.max(0, prev + eventNet - p.balance);
      }, 0);
      // Residual is weekly-cap variable plus reserved current-regime cash
      // (undated daily smear and dated card-paid planning days). Keep them
      // apart so a sliced Budget column is still the cap.
      copy.reserved = currentRegimeMonthly(plan) * 12 / 365.25 * weekDays.length
        + cardPaidReservedIn(weekEvents, copy.start, copy.end, walkStart);
      copy.variable = Math.max(0, residual - copy.reserved);
      const low = Math.min(copy.opening, ...weekDays.map(d => d.balance));
      copy.low = low;
      copy.belowBuffer = low < full.buffer;
      copy.negative = low < 0;
      return copy;
    });
    const measureFrom = (opts && opts.measureFrom && opts.measureFrom > start)
      ? opts.measureFrom : start;
    let min = { date: measureFrom, balance: Infinity };
    for (const p of daily) {
      if (p.date >= measureFrom && p.balance < min.balance) min = { date: p.date, balance: p.balance };
    }
    if (min.balance === Infinity) min = { date: start, balance: daily[0].balance };
    const buffer = full.buffer;
    const totals = {
      confirmedIncome: events.filter(e => e.kind === 'income' && e.confidence === 'confirmed')
        .reduce((s, e) => s + e.amount, 0),
      estimatedIncome: events.filter(e => e.kind === 'income' && e.confidence !== 'confirmed')
        .reduce((s, e) => s + e.amount, 0),
      injections: events.filter(e => e.kind === 'injection').reduce((s, e) => s + e.amount, 0),
      obligations: events.filter(e => e.kind === 'obligation').reduce((s, e) => s + -e.amount, 0),
      bills: events.filter(e => e.kind === 'bill' && e.jointCash !== false && !e.cardPaid)
        .reduce((s, e) => s + -e.amount, 0),
      noncash: events.filter(e => e.kind === 'noncash').reduce((s, e) => s + -e.amount, 0),
      commitments: events.filter(e => e.kind === 'commitment').reduce((s, e) => s + -e.amount, 0),
      variable: 0,
      reserved: 0,
      extra: events.filter(e => e.kind === 'extra' || e.kind === 'planned-debt')
        .reduce((s, e) => s + -e.amount, 0),
    };
    const opening = startIdx > 0 ? full.daily[startIdx - 1].balance : startingCashAmount(plan);
    const residual = daily.reduce((s, p, i) => {
      const prev = i ? daily[i - 1].balance : opening;
      const eventNet = events.filter(e => cashWalkDate(e, walkStart) === p.date && e.kind !== 'noncash' && e.jointCash !== false)
        .reduce((n, e) => n + e.amount, 0);
      return s + Math.max(0, prev + eventNet - p.balance);
    }, 0);
    totals.reserved = currentRegimeMonthly(plan) * 12 / 365.25 * daily.length
      + cardPaidReservedIn(events, start, end, walkStart);
    totals.variable = Math.max(0, residual - totals.reserved);
    totals.income = totals.confirmedIncome + totals.estimatedIncome;
    const ending = daily[daily.length - 1].balance;
    return Object.assign({}, full, {
      start, end, daily, weeks, events, totals, min, ending,
      shortfall: min.balance < 0 ? -min.balance : 0,
      breachesBuffer: min.balance < buffer,
      endingSurplus: ending - buffer,
      extraDebtCapacity: Math.max(0, ending - buffer),
      knowledge: {
        start: full.start, end: full.end, days: full.daily.length,
        min: full.min, ending: full.ending, events: full.events, totals: full.totals,
      },
    });
  }

  function sliceSimulation(full, asOf, viewDays, plan, opts) {
    if (!full || !full.daily || !full.daily.length) return full;
    const viewStart = (opts && opts.viewStart && opts.viewStart > asOf) ? opts.viewStart : asOf;
    if (viewStart > asOf) return sliceSimulationFrom(full, asOf, viewStart, viewDays, plan, opts);
    if (viewDays == null || viewDays >= full.daily.length) return full;
    const end = addDays(asOf, viewDays - 1);
    const daily = full.daily.slice(0, viewDays);
    const events = (full.events || []).filter(e => e.date <= end);
    const weeks = (full.weeks || []).filter(w => w.start <= end).map(w => {
      const copy = Object.assign({}, w);
      if (copy.end > end) {
        const closingRow = daily[daily.length - 1];
        copy.end = end;
        copy.closing = closingRow ? closingRow.balance : copy.closing;
        // Same retained-day identity as sliceSimulationFrom: a midweek
        // 1-day/month/payday/custom cut must not keep a full 7-day reserve.
        const weekDays = daily.filter(d => d.date >= copy.start && d.date <= copy.end);
        copy.reserved = currentRegimeMonthly(plan) * 12 / 365.25 * weekDays.length
          + cardPaidReservedIn(copy.events, copy.start, copy.end, asOf);
      }
      return copy;
    });
    const measureFrom = (opts && opts.measureFrom) || asOf;
    let min = { date: measureFrom, balance: Infinity };
    for (const p of daily) {
      if (p.date >= measureFrom && p.balance < min.balance) min = { date: p.date, balance: p.balance };
    }
    if (min.balance === Infinity) min = { date: asOf, balance: startingCashAmount(plan) };
    const buffer = full.buffer;
    const totals = {
      confirmedIncome: weeks.reduce((s, w) => s + w.confirmedIncome, 0),
      estimatedIncome: weeks.reduce((s, w) => s + w.estimatedIncome, 0),
      injections: weeks.reduce((s, w) => s + w.injections, 0),
      obligations: weeks.reduce((s, w) => s + w.obligations, 0),
      bills: weeks.reduce((s, w) => s + w.bills, 0),
      noncash: weeks.reduce((s, w) => s + w.noncash, 0),
      commitments: weeks.reduce((s, w) => s + w.commitments, 0),
      variable: weeks.reduce((s, w) => s + w.variable, 0),
      reserved: weeks.reduce((s, w) => s + (w.reserved || 0), 0),
      extra: weeks.reduce((s, w) => s + w.extra, 0),
    };
    totals.income = totals.confirmedIncome + totals.estimatedIncome;
    const ending = daily.length ? daily[daily.length - 1].balance : startingCashAmount(plan);
    const delta = daily.map((p, i) => p.balance - (i ? daily[i - 1].balance : startingCashAmount(plan)));
    const suffixMin = new Array(viewDays).fill(Infinity);
    for (let i = viewDays - 1; i >= 0; i--) {
      const later = i + 1 < viewDays ? Math.min(0, suffixMin[i + 1]) : 0;
      suffixMin[i] = delta[i] + later;
    }
    weeks.forEach((w, i) => {
      const next = (i + 1) * 7;
      w.requiredClosing = next < viewDays ? buffer - Math.min(0, suffixMin[next]) : buffer;
    });
    return Object.assign({}, full, {
      start: asOf, end, daily, weeks, events, totals, min, ending,
      shortfall: min.balance < 0 ? -min.balance : 0,
      breachesBuffer: min.balance < buffer,
      endingSurplus: ending - buffer,
      extraDebtCapacity: Math.max(0, ending - buffer),
      knowledge: {
        start: full.start, end: full.end, days: full.daily.length,
        min: full.min, ending: full.ending, events: full.events, totals: full.totals,
      },
    });
  }

  // Household obligation and paying account are separate facts (B91 D4/D5).
  // A bill is a household obligation unless it is explicitly marked false.
  // Paying-account metadata never flips that by itself.
  function billIsHouseholdObligation(bill) {
    return !!(bill && bill.householdObligation !== false);
  }

  // Joint-cash deduction is a separate fact from household obligation.
  // Held-elsewhere payers sit outside the joint pool. A card-paid dated
  // bill — payingAccount is a known obligation debtId, or explicit
  // jointCash: false that is not held-elsewhere — also does not deduct
  // chequing. No payingAccount, a breakdown payer, or an unknown/typo id
  // fail closed and still deduct. That does not invent an account
  // registry or treat held-elsewhere cash as spendable.
  function billIsHeldElsewhere(bill, plan) {
    if (!bill || !bill.payingAccount) return false;
    const cash = (plan && plan.startingCash) || {};
    return (cash.heldElsewhere || []).some(r => r && r.id === bill.payingAccount);
  }
  function billPaysFromKnownDebt(bill, plan) {
    if (!bill || !bill.payingAccount) return false;
    return ((plan && plan.obligations) || []).some(o => o && o.debtId === bill.payingAccount);
  }
  function isCardPaidBill(bill, plan) {
    if (!bill || !billIsHouseholdObligation(bill)) return false;
    if (billIsHeldElsewhere(bill, plan)) return false;
    if (bill.jointCash === false) return true;
    return billPaysFromKnownDebt(bill, plan);
  }
  function billAffectsJointCash(bill, plan) {
    if (!billIsHouseholdObligation(bill)) return false;
    if (isCardPaidBill(bill, plan)) return false;
    if (!bill.payingAccount) return true;
    const cash = (plan && plan.startingCash) || {};
    if ((cash.breakdown || []).some(r => r.id === bill.payingAccount)) return true;
    if ((cash.heldElsewhere || []).some(r => r.id === bill.payingAccount)) return false;
    return true;
  }
  function cardPaidReservedIn(events, start, end, walkStart) {
    return (events || []).reduce((sum, e) => {
      if (!e || !e.cardPaid) return sum;
      const apply = cashWalkDate(e, walkStart || e.date);
      if (start && apply < start) return sum;
      if (end && apply > end) return sum;
      const amt = -Number(e.amount);
      return sum + (isFinite(amt) ? amt : 0);
    }, 0);
  }

  // A later trusted posting may resolve an exact once outflow that remains
  // deliberately carried after its scheduled date. Keep this predicate small
  // and shared by Forecast and the live overlay: recurring events, income,
  // non-cash obligations, held-elsewhere bills, and non-exact ids/dates all
  // fail closed.
  function carriedOnceJointCashOutflow(plan, id, date, start) {
    if (!plan || !id || !date || !start || date >= start) return false;
    const obligation = (plan.obligations || []).find(item => item && item.id === id
      && item.frequency === 'once' && item.date === date
      && item.nonCash !== true && Number(item.amount) > 0);
    if (obligation) return true;
    const bill = (plan.bills || []).find(item => item && item.id === id
      && item.frequency === 'once' && item.date === date
      && Number(item.amount) > 0);
    return !!(bill && billAffectsJointCash(bill, plan));
  }

  // Early settlement of a still-upcoming joint-cash obligation or bill.
  // The scheduled date is after this Forecast start, and identity has
  // already named that exact occurrence. Commitments stay on settledOn.
  // Recurring income is not prepaid this way.
  function prepaidJointCashOutflow(plan, id, date, start) {
    if (!plan || !id || !date || !start || date <= start) return false;
    const obligation = (plan.obligations || []).find(item => item && item.id === id
      && item.nonCash !== true && Number(item.amount) > 0);
    if (obligation) {
      return outflowDates(obligation, date, date).some(d => d === date);
    }
    const bill = (plan.bills || []).find(item => item && item.id === id
      && Number(item.amount) > 0);
    if (!bill || !billAffectsJointCash(bill, plan)) return false;
    return outflowDates(bill, date, date).some(d => d === date);
  }

  function isJointCashOutflow(event) {
    return !!(event && event.amount < 0 && event.kind !== 'noncash'
      && event.jointCash !== false);
  }
  // Past unresolved joint-cash outflows still bind the walk. The scheduled
  // date stays on the event; only application lands on this opening. simulate
  // and projectDebts share this helper so cash out and debt down stay coupled.
  // Absorption still keys the original scheduled date. That is not a second
  // calendar and not a rewritten due date.
  function cashWalkDate(event, start) {
    if (event && start && event.date < start && isJointCashOutflow(event)) return start;
    return event && event.date;
  }

  // Live overlay may advance as-of past scheduled recurring outflows.
  // onceOutflowDates already keeps unresolved once cash on the plan.
  // Recurring bills/obligations and dated commitments in
  // (plan.opening.priorAsOf, start) are not in that helper; emit them
  // here so cashWalkDate still reserves unrepresented joint-cash
  // outflows at this opening. Represented names are omitted. Income is
  // not invented. Nested expandEvents does not re-enter: inner start
  // is not opening.asOf.
  function carriedUnresolvedJointCashOutflows(plan, start, opts, already) {
    const opening = plan && plan.opening;
    if (!opening || opening.asOf !== start || !opening.priorAsOf) return [];
    const prior = opening.priorAsOf;
    if (prior >= start) return [];
    const from = addDays(prior, 1);
    const to = addDays(start, -1);
    if (!from || from > to) return [];
    const represented = representedKeySet(plan, opts, start);
    const inner = expandEvents(plan, from, to, opts);
    const extra = [];
    for (const event of inner) {
      if (!isJointCashOutflow(event)) continue;
      if (event.date < from || event.date > to) continue;
      const key = event.id + '@' + event.date;
      if (represented.has(key)) continue;
      if (already && already.has(key)) continue;
      extra.push(event);
    }
    return extra;
  }

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
      for (const date of outflowDates(o, start, end)) {
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
            label: o.label, id: o.id, confidence: o.confidence,
            debtId: o.debtId || null, effect: o.effect || null });
          continue;
        }
        if (amount <= 0) continue;      // nothing left for this payment to pay
        events.push({ date, amount: -amount, kind: 'obligation',
          label: o.label, id: o.id, confidence: o.confidence,
          debtId: o.debtId || null, effect: o.effect || null,
          payingAccount: o.payingAccount || null });
      }
    }
    for (const b of plan.bills || []) {
      // Paying account never erases household-obligation status. Only an
      // explicit householdObligation: false drops the bill from the schedule.
      // A bill that still needs a date is printed by calendarBillSections;
      // it is not given a fabricated day here.
      if (!billIsHouseholdObligation(b)) continue;
      if (b.needsDate) continue;
      for (const date of outflowDates(b, start, end)) {
        const jointCash = billAffectsJointCash(b, plan);
        const cardPaid = isCardPaidBill(b, plan);
        events.push({
          date, amount: -b.amount, kind: 'bill', label: b.label, id: b.id,
          confidence: b.confidence,
          householdObligation: true,
          payingAccount: b.payingAccount || null,
          jointCash,
          cardPaid,
        });
      }
    }
    for (const c of plan.commitments) {
      if (disabled.has(c.id)) continue;
      // A settled commitment keeps its history and its scheduled date.
      // It produces no future cash event only when settlement is on or
      // before this Forecast opening. A later settledOn is still unpaid
      // relative to this start. This is not a date-wide skip: a sibling
      // on the same date still fires.
      if (commitmentSettledBy(c, start)) continue;
      // Undated rows stay on the plan. They are not given a fabricated
      // day and they do not become cash events.
      if (!c.date || c.amount == null) continue;
      // Optional items are residual funding, not a protected cash outflow.
      if (commitmentFlexibility(c) === 'optional') continue;
      if (c.date >= start && c.date <= end) {
        events.push({ date: c.date, amount: -c.amount, kind: 'commitment', label: c.label, id: c.id, confidence: c.confidence });
      }
    }
    // Cash arriving from outside the plan — modelled gap-funding injections,
    // historically including a transfer from Amanda's account or a HELOC draw
    // covering an opening gap. This injection path is not salary income.
    // Confirmed Tennis BC salary is plan.income; a later BILLS transfer of
    // those dollars is posting proof, not a second inflow. Positive, so it
    // sorts with income and lands before the payments it is there to cover.
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
    // Purpose-specific planned-debt cash flows on the same ledger as the
    // master walk. Positive draws arrive through `injections` above.
    // Negative amounts here are required repayment leaving cash.
    for (const flow of opts.plannedFlows || []) {
      if (!flow || !flow.date || flow.date < start || flow.date > end) continue;
      const amt = Number(flow.amount);
      if (!isFinite(amt) || amt === 0) continue;
      events.push({
        date: flow.date,
        amount: amt,
        kind: amt > 0 ? 'injection' : 'planned-debt',
        label: flow.label || 'Planned debt',
        id: flow.id || 'planned-debt',
        debtId: flow.debtId || null,
        confidence: 'planned',
      });
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
    const kept = omitRepresented(events, plan, opts, start);
    const already = new Set(kept.map(e => e.id + '@' + e.date));
    const carried = carriedUnresolvedJointCashOutflows(plan, start, opts, already);
    if (!carried.length) return kept;
    const out = kept.concat(carried);
    out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 :
      (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
    return out;
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
    const days = walkDays(plan, asOf, opts);
    const viewDays = (opts.viewDays != null && opts.horizonDays != null)
      ? Math.min(opts.viewDays, days)
      : days;
    const viewStart = (opts.viewStart && opts.viewStart > asOf) ? opts.viewStart : asOf;
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const dailyVariable = (opts.weeklyVariable || 0) / 7;
    // Calendar month, the same 365.25/12 identity budgetBreakdown uses.
    const reservedDaily = currentRegimeMonthly(plan) * 12 / 365.25;
    const variableFrom = opts.variableFrom || start;
    const measureFrom = opts.measureFrom || start;

    const byDate = new Map();
    for (const e of events) {
      const applyOn = cashWalkDate(e, start);
      if (!byDate.has(applyOn)) byDate.set(applyOn, []);
      byDate.get(applyOn).push(e);
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
    }

    const openingCash = startingCashAmount(plan);
    let balance = openingCash;
    const daily = [];
    // Seeded from the opening balance only when the whole window is being
    // measured; otherwise the first in-range day sets it. A same-day gap
    // injection below lifts this seed: deposits land before the payments
    // they fund, and the pre-injection opening is not a measured floor.
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
          obligations: 0, bills: 0, commitments: 0, variable: 0, reserved: 0, extra: 0, noncash: 0,
          injections: 0, closing: balance, events: [], belowBuffer: false, negative: false,
        };
        weeks.push(week);
      }
      const todays = byDate.get(date) || [];
      for (const e of todays) {
        if (e.kind === 'noncash') { week.noncash += -e.amount; week.events.push(e); continue; }
        // Card-paid dated service: planning gravity on the reserved
        // ledger for that day, not a chequing bill and not a card
        // capitalisation. Travel Visa settlement stays a separate
        // payment obligation.
        if (e.cardPaid) {
          balance += e.amount;
          week.reserved += -e.amount;
          week.events.push(e);
          continue;
        }
        // Household obligation paid outside the joint-cash pool: still on
        // the schedule (week.events) so it does not disappear, but it is
        // not deducted from joint cash and is not a week.bills cash total.
        if (e.jointCash === false) { week.events.push(e); continue; }
        balance += e.amount;
        if (e.kind === 'income') {
          if (e.confidence === 'confirmed') week.confirmedIncome += e.amount;
          else week.estimatedIncome += e.amount;
        } else if (e.kind === 'injection') {
          week.injections += e.amount;
          // Same defect grouping two sources into one event was written to
          // stop, when the injection falls on as-of rather than a later gap
          // day: the opening seed stays at starting cash, the transfer
          // raises the close, and recommendWeekly answers $0/week for a
          // day that actually closes on the buffer.
          if (date === start && measureFrom <= start && min.date === start) {
            min = { date, balance };
            // week.opening stays at unfunded cash so the ledger still
            // reconciles opening + injections = close. The weekly low must
            // use this same post-injection boundary, or week 1 reports the
            // unfunded opening as a below-buffer dip the recommendation
            // already treated as funded.
            week.measuredOpening = balance;
          }
        }
        else if (e.kind === 'obligation') week.obligations += -e.amount;
        else if (e.kind === 'bill') week.bills += -e.amount;
        else if (e.kind === 'commitment') week.commitments += -e.amount;
        else if (e.kind === 'extra' || e.kind === 'planned-debt') week.extra += -e.amount;
        week.events.push(e);
        // The intra-day low matters: a big payment can dip below the buffer
        // even when the day closes fine. Income sorts first, so this is the
        // cautious reading of the day.
        if (measured && balance < min.balance) min = { date, balance };
      }
      // Undated current-regime is an obligation, not optional variable: it
      // still drains during an opening squeeze. It has its own reserved
      // ledger total so the Budget / weekly-cap column stays the cap.
      if (reservedDaily) {
        balance -= reservedDaily;
        week.reserved += reservedDaily;
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
      const seed = w.measuredOpening != null ? w.measuredOpening : w.opening;
      const low = Math.min(seed, ...daily.filter(d => d.date >= w.start && d.date <= w.end).map(d => d.balance));
      w.low = low;
      w.belowBuffer = low < buffer;
      w.negative = low < 0;
      delete w.measuredOpening;
    }

    // The week-by-week track: the closing balance below which the REST of the
    // window breaches the buffer even with everything going to plan. Backward
    // pass over daily net changes: requiredClosing = buffer − (the most the
    // balance ever sits below this week's closing at any later day).
    const delta = daily.map((p, i) => p.balance - (i ? daily[i - 1].balance : startingCashAmount(plan)));
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
      reserved: weeks.reduce((s, w) => s + w.reserved, 0),
      extra: weeks.reduce((s, w) => s + w.extra, 0),
    };
    totals.income = totals.confirmedIncome + totals.estimatedIncome;

    const full = {
      start, end, daily, weeks, events, totals,
      min, ending: balance, buffer,
      shortfall: min.balance < 0 ? -min.balance : 0,
      breachesBuffer: min.balance < buffer,
      endingSurplus: balance - buffer,
      // Room for extra repayment, measured at the end of the window — cash
      // above the buffer once everything has cleared. Bounded by zero.
      extraDebtCapacity: Math.max(0, balance - buffer),
    };
    return (viewStart > asOf || viewDays < days)
      ? sliceSimulation(full, asOf, viewDays, plan, opts) : full;
  }

  /* ---------------------------------------- funding sequence + verdicts */
  // Presentation order only — not the allocator. Protected items are
  // feasible simultaneously or not at all. Owner priority ranks residual
  // (optional) allocation after that: among optional items, explicit
  // owner priority wins over date. Undated rows sort after dated ones
  // inside the protected band; no day is invented. No commitment id is special.
  function fundingSequence(plan, asOf, opts) {
    opts = opts || {};
    const disabled = new Set(opts.disabled || []);
    const rows = [];
    (plan.commitments || []).forEach((c, index) => {
      if (disabled.has(c.id)) return;
      if (commitmentSettledBy(c, asOf)) return;
      const need = commitmentNeed(c);
      const range = commitmentRange(c);
      if (need == null && range.amountMin == null && range.amountMax == null) return;
      const bounds = commitmentBounds(c);
      rows.push({
        id: c.id,
        label: c.label,
        date: c.date || null,
        // Preserve approximate or unresolved timing as stated. Consumers must
        // not turn "Nov 2026", "late Sep 2026", or "timing TBD" into a day.
        when: c.when || null,
        need,
        amountMin: range.amountMin,
        amountMax: range.amountMax,
        bounds,
        flexibility: bounds.flexibility,
        confidence: c.confidence || null,
        adjustable: !!c.adjustable,
        priority: typeof c.priority === 'number' ? c.priority : null,
        index,
      });
    });
    const certaintyRank = c => c.confidence === 'confirmed' ? 0
      : c.confidence === 'estimated' ? 1 : 2;
    const flexRank = c => c.flexibility === 'required' ? 0
      : c.flexibility === 'bounded-flex' ? 1 : 2;
    rows.sort((a, b) => {
      if (flexRank(a) !== flexRank(b)) return flexRank(a) - flexRank(b);
      const aOpt = a.flexibility === 'optional';
      const bOpt = b.flexibility === 'optional';
      const pa = a.priority == null ? Infinity : a.priority;
      const pb = b.priority == null ? Infinity : b.priority;
      if (aOpt && bOpt && pa !== pb) return pa - pb;
      const ta = a.date || '\uffff';
      const tb = b.date || '\uffff';
      if (ta !== tb) return ta < tb ? -1 : 1;
      if (certaintyRank(a) !== certaintyRank(b)) return certaintyRank(a) - certaintyRank(b);
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    });
    return rows.map((c, i) => Object.assign({}, c, { rank: i + 1 }));
  }

  function leftoverAfterBuffer(sim) {
    return (sim && sim.ending != null && sim.buffer != null) ? sim.ending - sim.buffer : 0;
  }

  function isCashEventItem(item) {
    return !!(item && item.date && item.need != null && item.flexibility !== 'optional');
  }

  // A dated point amount whose scheduled date has already passed is still
  // protected until settlement or authorized release. Passing the due date
  // does not turn unpaid principal into spendable cash. The original date
  // is kept; a new due date is not invented.
  function isOverduePointItem(item, asOf) {
    return !!(isCashEventItem(item) && asOf && item.date < asOf);
  }

  // A dated range is not a cash event (no midpoint is invented) but it
  // still has a deadline. Capacity is tested at that date, not at the
  // horizon end. Once that date has passed, the range stays a range and
  // is tested against as-of surplus like an overdue point amount.
  function isDatedReserve(item) {
    return !!(item && item.date && item.need == null && item.flexibility !== 'optional'
      && item.bounds && (item.bounds.floor > 0 || item.bounds.ceiling > 0
        || item.amountMin != null || item.amountMax != null));
  }

  function isOverdueDatedReserve(item, asOf) {
    return !!(isDatedReserve(item) && asOf && item.date < asOf);
  }

  function isOverdueProtectedItem(item, asOf) {
    return isOverduePointItem(item, asOf) || isOverdueDatedReserve(item, asOf);
  }

  function surplusOn(sim, date) {
    if (!sim || !date) return null;
    const day = (sim.daily || []).find(d => d.date === date);
    if (!day) return null;
    return day.balance - sim.buffer;
  }

  function datedReserveBy(seq, date) {
    let floor = 0, ceiling = 0;
    for (const item of seq || []) {
      if (!isDatedReserve(item) || item.date > date) continue;
      floor += item.bounds ? item.bounds.floor : 0;
      ceiling += item.bounds ? item.bounds.ceiling : 0;
    }
    return { floor, ceiling };
  }

  // Overdue protected point amounts and overdue dated-range floors are one
  // as-of constraint. Original scheduled dates are kept and ranges stay
  // ranges. The same current dollar cannot fund two of them, and later
  // horizon income cannot repair a past deadline.
  function overdueProtectedBy(seq, asOf) {
    let floor = 0, ceiling = 0;
    const items = [];
    for (const item of seq || []) {
      if (!isOverdueProtectedItem(item, asOf)) continue;
      floor += item.bounds ? item.bounds.floor : 0;
      ceiling += item.bounds ? item.bounds.ceiling : 0;
      items.push(item);
    }
    return { floor, ceiling, items };
  }

  // Spoken-for principal that has not left the walk as a cash event.
  // Future dated point amounts already leave the walk; double-counting them
  // would treat paid-out cash as still reserved. An overdue unsettled point
  // amount never left the walk, so it stays spoken for until settlement.
  // A dated range has no cash event, so its floor stays encumbered from
  // the point it is funded or due until settlement or authorized release,
  // including after the stated date has passed.
  // Optional items are residual after that still-encumbered protected
  // principal.
  function protectedEncumbered(seq, asOf) {
    let floor = 0, ceiling = 0;
    for (const item of seq || []) {
      if (!item || item.flexibility === 'optional') continue;
      if (isCashEventItem(item) && !isOverduePointItem(item, asOf)) continue;
      floor += item.bounds ? item.bounds.floor : 0;
      ceiling += item.bounds ? item.bounds.ceiling : 0;
    }
    return { floor, ceiling };
  }

  // One protected-feasibility predicate for the weekly search and for
  // planned-debt validation. Buffer path, overdue protected point amounts
  // and overdue dated-range floors against as-of surplus (model buffer and
  // same-day authoritative cash, not later income), still-encumbered
  // principal, and every still-future dated-reserve deadline. A later
  // income that repairs the ending leftover does not excuse a missed or
  // already-passed deadline, and a passed due date does not drop an unpaid
  // point or range obligation. Authorized planned debt may close an overdue
  // current gap only through the same-walk financing path.
  function protectedPlanCheck(plan, asOf, opts) {
    opts = opts || {};
    const buffer = opts.targetBuffer != null ? opts.targetBuffer
      : ((plan.defaults && plan.defaults.targetBuffer) || 0);
    const sim = opts.sim || simulate(plan, asOf, opts);
    const seq = opts.seq || fundingSequence(plan, asOf, opts);
    const leftover = leftoverAfterBuffer(sim);
    const enc = protectedEncumbered(seq, asOf);
    const failures = [];

    if (!atLeast(sim.min.balance, buffer)) {
      failures.push({
        kind: 'buffer',
        date: sim.min.date,
        shortfall: buffer - sim.min.balance,
        id: null,
        label: 'cash buffer',
      });
    }

    const seenDates = new Set();
    for (const item of seq) {
      // A passed ranged deadline is an as-of constraint. surplusOn() has
      // no day before the walk starts, so testing item.date here would
      // treat every overdue range as a full-floor gap.
      if (!isDatedReserve(item) || item.date < asOf || seenDates.has(item.date)) continue;
      seenDates.add(item.date);
      const surplus = surplusOn(sim, item.date);
      const due = datedReserveBy(seq, item.date);
      if (surplus == null || !atLeast(surplus, due.floor)) {
        const have = surplus == null ? 0 : surplus;
        failures.push({
          kind: 'dated-reserve',
          date: item.date,
          shortfall: due.floor - have,
          id: item.id,
          label: item.label,
        });
      }
    }

    const overdueDue = overdueProtectedBy(seq, asOf);
    if (overdueDue.floor > 0) {
      const surplus = surplusOn(sim, asOf);
      const have = surplus == null ? 0 : surplus;
      if (!atLeast(have, overdueDue.floor)) {
        const named = overdueDue.items[0];
        failures.push({
          kind: 'overdue',
          date: named.date,
          shortfall: overdueDue.floor - have,
          id: named.id,
          label: named.label,
          ids: overdueDue.items.map(i => i.id),
        });
      }
    }

    if (!atLeast(leftover, enc.floor)) {
      const overdue = seq.find(i => isOverdueProtectedItem(i, asOf));
      const undated = seq.find(i => i.flexibility !== 'optional'
        && !isCashEventItem(i) && !isDatedReserve(i))
        || seq.find(i => i.flexibility !== 'optional' && !isCashEventItem(i));
      const named = overdue || undated;
      failures.push({
        kind: overdue ? 'overdue' : 'encumbered',
        date: overdue ? overdue.date : sim.end,
        shortfall: enc.floor - leftover,
        id: named ? named.id : null,
        label: named ? named.label : 'protected principal',
      });
    }

    failures.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const order = { buffer: 0, overdue: 1, 'dated-reserve': 2, encumbered: 3 };
      return (order[a.kind] || 9) - (order[b.kind] || 9);
    });
    return { feasible: failures.length === 0, failures, first: failures[0] || null };
  }

  function datedCommitmentFunded(sim, date, buffer) {
    if (!sim || !date) return false;
    const day = (sim.daily || []).find(d => d.date === date);
    if (!day) return false;
    return atLeast(day.balance, buffer);
  }

  function datedMargin(sim, date, buffer) {
    if (!sim || !date) return null;
    const day = (sim.daily || []).find(d => d.date === date);
    if (!day) return null;
    return day.balance - buffer;
  }

  // ON TRACK / AT RISK / FUNDING GAP for major future plans only.
  // Ordinary transactions and budget categories are not graded here.
  // Feasibility → margin → residual:
  //   ON TRACK     the authoritative/base case is jointly feasible
  //   AT RISK      base remains feasible; an explicit protected
  //                uncertainty case (a range ceiling) is not
  //   FUNDING GAP  the authoritative/base case is infeasible on this path
  // A dollar margin (surplus after protected principal) or gap travels
  // with the verdict. Weekly = 0 is not the AT RISK test.
  function majorPlans(plan, asOf, opts) {
    opts = opts || {};
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const seq = fundingSequence(plan, asOf, opts);
    const weekly = opts.weeklyVariable != null ? opts.weeklyVariable : 0;
    const masterOpts = Object.assign({}, opts, {
      horizonDays: horizon.days, viewDays: horizon.days,
    });
    const rec = simulate(plan, asOf, Object.assign({}, masterOpts, { weeklyVariable: weekly }));
    const leftover = leftoverAfterBuffer(rec);
    const enc = protectedEncumbered(seq, asOf);
    const fundingMargin = leftover - enc.floor;
    const uncertaintyMargin = leftover - enc.ceiling;
    const baseJoint = atLeast(leftover, enc.floor);
    const uncertaintyJoint = atLeast(leftover, enc.ceiling);
    let residualPool = leftover - enc.floor;

    return seq.map(item => {
      const floor = item.bounds ? item.bounds.floor : 0;
      const ceiling = item.bounds ? item.bounds.ceiling : 0;
      let funded = false;
      let uncertaintyFunded = false;
      let margin = fundingMargin;
      let remaining = 0;
      let verdict = 'FUNDING GAP';
      let encumbered = 0;

      if (item.flexibility === 'optional') {
        const take = Math.max(0, Math.min(residualPool, floor));
        residualPool -= take;
        funded = atLeast(take, floor);
        uncertaintyFunded = funded;
        margin = take - floor;
        remaining = Math.max(0, floor - take);
        verdict = funded ? 'ON TRACK' : 'FUNDING GAP';
        encumbered = 0;
      } else if (isOverdueProtectedItem(item, asOf)) {
        const surplus = surplusOn(rec, asOf);
        const due = overdueProtectedBy(seq, asOf);
        const have = surplus == null ? 0 : surplus;
        const baseMargin = have - due.floor;
        const rangeMargin = have - due.ceiling;
        funded = atLeast(have, due.floor);
        uncertaintyFunded = atLeast(have, due.ceiling);
        encumbered = floor;
        if (funded && uncertaintyFunded) {
          verdict = 'ON TRACK';
          margin = rangeMargin;
          remaining = 0;
        } else if (funded) {
          verdict = 'AT RISK';
          margin = baseMargin;
          remaining = Math.max(0, -rangeMargin);
        } else {
          verdict = 'FUNDING GAP';
          margin = baseMargin;
          remaining = Math.max(0, -baseMargin);
        }
      } else if (isCashEventItem(item) && item.date >= asOf) {
        const dayMargin = datedMargin(rec, item.date, rec.buffer);
        funded = datedCommitmentFunded(rec, item.date, rec.buffer);
        uncertaintyFunded = funded;
        margin = dayMargin == null ? (funded ? 0 : -floor) : dayMargin;
        remaining = funded ? 0 : Math.max(0, -margin);
        verdict = funded ? 'ON TRACK' : 'FUNDING GAP';
        encumbered = 0;
      } else if (isDatedReserve(item)) {
        const surplus = surplusOn(rec, item.date);
        const due = datedReserveBy(seq, item.date);
        const baseMargin = surplus == null ? -due.floor : surplus - due.floor;
        const rangeMargin = surplus == null ? -due.ceiling : surplus - due.ceiling;
        funded = surplus != null && atLeast(surplus, due.floor);
        uncertaintyFunded = surplus != null && atLeast(surplus, due.ceiling);
        encumbered = floor;
        if (funded && uncertaintyFunded) {
          verdict = 'ON TRACK';
          margin = rangeMargin;
          remaining = 0;
        } else if (funded) {
          verdict = 'AT RISK';
          margin = baseMargin;
          remaining = Math.max(0, -rangeMargin);
        } else {
          verdict = 'FUNDING GAP';
          margin = baseMargin;
          remaining = Math.max(0, -baseMargin);
        }
      } else {
        encumbered = floor;
        const othersFloor = enc.floor - floor;
        const othersCeil = enc.ceiling - ceiling;
        const availableFloor = leftover - othersFloor;
        const availableCeil = leftover - othersCeil;
        funded = baseJoint;
        uncertaintyFunded = uncertaintyJoint;
        if (funded && uncertaintyFunded) {
          verdict = 'ON TRACK';
          margin = uncertaintyMargin;
          remaining = 0;
        } else if (funded) {
          verdict = 'AT RISK';
          margin = fundingMargin;
          remaining = Math.max(0, ceiling - Math.max(0, availableCeil));
        } else {
          verdict = 'FUNDING GAP';
          margin = fundingMargin;
          remaining = Math.max(0, floor - Math.max(0, availableFloor));
        }
      }

      return {
        id: item.id,
        label: item.label,
        date: item.date,
        scheduledDate: item.date,
        when: item.when,
        need: item.need,
        amountMin: item.amountMin,
        amountMax: item.amountMax,
        flexibility: item.flexibility,
        confidence: item.confidence,
        adjustable: item.adjustable,
        rank: item.rank,
        verdict,
        funded,
        encumbered,
        margin,
        remaining,
        fundingMargin,
        // Flexible items may yield. Non-flexible dates are never rewritten.
        deferred: !!(item.adjustable && verdict !== 'ON TRACK'),
      };
    });
  }

  function facilityCapacity(facility, opts) {
    if (!facility) return 0;
    // Unknown pending is not $0. Posted room is not usable capacity.
    if (pendingUnknown(facility)) return 0;
    const used = openingBalance(facility);
    const headroom = Math.max(0, (Number(facility.limit) || 0) - used);
    if (opts && opts.plannedDebtMax != null && isFinite(Number(opts.plannedDebtMax))) {
      return Math.max(0, Math.min(headroom, Number(opts.plannedDebtMax)));
    }
    return headroom;
  }

  function plannedDebtPurposeIds(opts) {
    const ids = [];
    if (Array.isArray(opts.plannedDebtPurposes)) ids.push.apply(ids, opts.plannedDebtPurposes);
    if (opts.plannedDebtPurpose) ids.push(opts.plannedDebtPurpose);
    return new Set(ids.filter(Boolean));
  }

  function plannedDebtAuthorizedAmount(opts, id) {
    if (!opts || !id) return null;
    const map = opts.plannedDebtAmounts;
    if (map && Object.prototype.hasOwnProperty.call(map, id) && map[id] != null) {
      const n = Number(map[id]);
      if (isFinite(n) && n > 0) return n;
    }
    return null;
  }

  // Planned borrowing is opt-in. Default invents neither permission nor a
  // facility. Naming the HELOC still has to be explicit; this function will
  // not treat a draw as the default cash path. Remaining August HELOC cash
  // impact is answered in Q19 and is not a planned-debt default.
  // A permitted draw is purpose-specific, capped by facility capacity, and
  // inserted into the same Forecast projection as proceeds, interest from
  // the draw date, and required repayment cash flows. An owner-authorized
  // amount may finance a named purpose even when the cash path is already
  // feasible; a cash shortfall is one reason, not the only one. Feasible
  // means a repayment cadence is supplied, the post-financing walk still
  // holds the protected plan, and the named facility never crosses its
  // limit on that walk — not only that the ending balance is under.
  function plannedDebt(plan, asOf, opts) {
    opts = opts || {};
    const denied = {
      permitted: false, borrowed: 0, facilityId: null, interest: 0,
      repayment: null, items: [], draws: [], feasible: false, capacity: 0,
    };
    if (!opts.allowPlannedDebt) return denied;

    const facilityId = opts.plannedDebtFacility || null;
    const debts = opts.debts || [];
    const facility = facilityId ? debts.find(d => d.id === facilityId) : null;
    const capacity = facilityCapacity(facility, opts);
    const plans = opts.majorPlans || majorPlans(plan, asOf, opts);
    const purposes = plannedDebtPurposeIds(opts);
    const named = plans.filter(p => purposes.has(p.id));
    const gapItems = plans.filter(p => p.verdict === 'FUNDING GAP' && p.remaining > 0)
      .map(p => ({ id: p.id, remaining: p.remaining, date: p.date, label: p.label }));

    if (!facility) {
      return {
        permitted: true, borrowed: 0, facilityId, interest: 0, repayment: null,
        items: gapItems, draws: [], feasible: false, capacity: 0, endingBalance: null,
      };
    }

    let remainingCap = capacity;
    const seq = fundingSequence(plan, asOf, opts);
    const overdueProtected = overdueProtectedBy(seq, asOf);
    const overdueProtectedIds = new Set(overdueProtected.items.map(item => item.id));
    const overdueFloorById = new Map();
    for (const item of overdueProtected.items) {
      overdueFloorById.set(item.id, item.bounds ? item.bounds.floor : 0);
    }
    // majorPlans reports the joint protected overdue remaining on every
    // protected overdue row. Automatic draws consume that shared shortfall
    // once, but only up to the base floors of the named auto-eligible
    // protected overdue purposes. Naming A does not authorize financing B.
    // Optional residual purposes are not in this set and keep independent
    // remaining. Explicit amounts still occur exactly as authorized, and a
    // draw that belongs to the protected overdue pool reduces the shared
    // remainder before any auto-sized draw is added.
    let protectedOverdueAutoLeft = 0;
    for (const p of plans) {
      if (overdueProtectedIds.has(p.id) && p.verdict === 'FUNDING GAP' && p.remaining > 0) {
        protectedOverdueAutoLeft = p.remaining;
        break;
      }
    }
    let namedAutoProtectedFloor = 0;
    for (const g of named) {
      if (!overdueProtectedIds.has(g.id)) continue;
      if (plannedDebtAuthorizedAmount(opts, g.id) != null) continue;
      namedAutoProtectedFloor += overdueFloorById.get(g.id) || 0;
    }
    protectedOverdueAutoLeft = Math.min(protectedOverdueAutoLeft, namedAutoProtectedFloor);
    const draws = [];
    const takeDraw = (g, want) => {
      const amount = Math.min(want, remainingCap);
      if (!(amount > 0)) return 0;
      const date = g.date && g.date >= asOf ? g.date : asOf;
      draws.push({ id: g.id, amount, date, purpose: g.label || g.id });
      remainingCap -= amount;
      return amount;
    };
    for (const g of named) {
      const authorized = plannedDebtAuthorizedAmount(opts, g.id);
      if (authorized == null) continue;
      const amount = takeDraw(g, authorized);
      if (overdueProtectedIds.has(g.id)) {
        protectedOverdueAutoLeft = Math.max(0, protectedOverdueAutoLeft - amount);
      }
    }
    for (const g of named) {
      if (plannedDebtAuthorizedAmount(opts, g.id) != null) continue;
      let want = 0;
      if (overdueProtectedIds.has(g.id)) {
        const purposeFloor = overdueFloorById.get(g.id) || 0;
        want = Math.min(protectedOverdueAutoLeft, purposeFloor);
      } else if (g.verdict === 'FUNDING GAP' && g.remaining > 0) {
        want = g.remaining;
      }
      const amount = takeDraw(g, want);
      if (overdueProtectedIds.has(g.id)) {
        protectedOverdueAutoLeft = Math.max(0, protectedOverdueAutoLeft - amount);
      }
    }
    const borrowed = draws.reduce((s, d) => s + d.amount, 0);
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const rate = Number(facility.rate) || 0;

    const monthlyPayment = opts.plannedDebtPayment != null ? Number(opts.plannedDebtPayment) : null;
    let months = null;
    const plannedFlows = [];
    if (monthlyPayment > 0 && borrowed > 0) {
      const r = rate / 100 / 12;
      if (r <= 0) months = Math.ceil(borrowed / monthlyPayment);
      else {
        const factor = 1 - (r * borrowed) / monthlyPayment;
        months = factor <= 0 ? null : Math.ceil(-Math.log(factor) / Math.log(1 + r));
      }
      const firstDraw = draws.reduce((min, d) => d.date < min ? d.date : min, draws[0].date);
      const startPay = addDays(firstDraw, 1);
      const day = Number(firstDraw.split('-')[2]) || 15;
      const payDates = monthlyDates(day, startPay, horizon.end, startPay);
      const limit = months != null ? Math.min(months, payDates.length) : payDates.length;
      for (let i = 0; i < limit; i++) {
        plannedFlows.push({
          date: payDates[i],
          amount: -monthlyPayment,
          label: 'Planned debt repayment',
          id: 'planned-debt-repay-' + i,
          debtId: facility.id,
        });
      }
    }

    const injections = (opts.injections || []).concat(draws.map(d => ({
      date: d.date,
      amount: d.amount,
      debtId: facility.id,
      label: 'Planned draw — ' + d.purpose,
      id: 'planned-debt-' + d.id,
    })));
    const walkOpts = Object.assign({}, opts, {
      horizonDays: horizon.days, viewDays: horizon.days,
      debtHorizonDays: horizon.days,
      weeklyVariable: opts.weeklyVariable != null ? opts.weeklyVariable : 0,
      injections, plannedFlows,
    });
    const post = simulate(plan, asOf, walkOpts);
    const hasCadence = monthlyPayment > 0 && plannedFlows.length > 0;
    const debtWalk = projectDebts(plan, debts, asOf, walkOpts);
    const state = debtWalk.byId && debtWalk.byId[facility.id];
    const baseWalk = projectDebts(plan, debts, asOf, Object.assign({}, walkOpts, {
      injections: opts.injections || [], plannedFlows: [],
    }));
    const baseState = baseWalk.byId && baseWalk.byId[facility.id];
    const interest = (state && baseState) ? state.interest - baseState.interest : (state ? state.interest : 0);
    const endingBalance = state ? state.balance : null;
    const crossedLimit = !!(state && state.firstOver);
    const endingOver = facility.limit != null && state && state.balance > facility.limit + EPSILON;
    const withinLimit = !crossedLimit && !endingOver;
    const protectedOk = protectedPlanCheck(plan, asOf, Object.assign({}, walkOpts, {
      seq, sim: post,
    })).feasible;
    const cashOk = borrowed > 0 && protectedOk;
    const feasible = hasCadence && cashOk && withinLimit;

    return {
      permitted: true,
      borrowed,
      facilityId: facility.id,
      rate,
      capacity,
      interest,
      endingBalance,
      draws,
      feasible,
      repayment: {
        facilityId: facility.id,
        monthlyPayment,
        months,
        flows: plannedFlows.length,
        path: hasCadence
          ? 'stated monthly repayment on the named facility, from each draw date'
          : 'amount borrowed is known; no repayment cadence was supplied',
      },
      items: draws.map(d => ({ id: d.id, remaining: d.amount, date: d.date })),
    };
  }

  /* ---------------------------------------------------- budget recommender */
  // The largest weekly variable spend, to the nearest $5, that keeps the
  // protected plan feasible: cash buffer, overdue protected point amounts
  // and overdue dated-range floors against as-of surplus, still-encumbered
  // principal, and every still-future dated-reserve deadline. Same
  // predicate as planned-debt validation.
  // Monotonic in W, so binary search is exact.
  const CALENDAR_MONTH_DAYS = 365.25 / 12;
  function roundCent(n) {
    return Math.round((Number(n) || 0) * 100) / 100;
  }

  // Essential monthly need from incumbent budget classifications. Owner
  // target wins, then current-regime, matching budgetBreakdown. Dated bills
  // are not included — they sit in required obligations. No new taxonomy.
  // Categories with nothing left after dated netting are omitted: they are
  // not a second copy of a bill already reserved as an obligation.
  function essentialNeedBreakdown(plan, periods, opts) {
    const items = [];
    if (periods) {
      const bd = budgetBreakdown(plan, periods, opts || {});
      if (bd && Array.isArray(bd.categories)) {
        for (const c of bd.categories) {
          if (!c || c.class !== 'essential') continue;
          const monthly = roundCent((Number(c.planned) || 0) + (Number(c.reserved) || 0));
          if (!(monthly > EPSILON)) continue;
          items.push({
            id: c.id,
            label: c.label,
            monthly,
            source: c.source || null,
          });
        }
        return {
          monthly: Number(bd.essentialMonthly) || 0,
          items,
        };
      }
    }
    let monthly = 0;
    for (const c of (plan.budget && plan.budget.categories) || []) {
      if (!c || c.class !== 'essential') continue;
      let amount = 0;
      let source = null;
      const targetMonthly = ownerTargetMonthly(c);
      if (targetMonthly != null) {
        amount = targetMonthly;
        source = 'owner-target';
      } else if (c.currentMonthly != null) {
        amount = Number(c.currentMonthly) || 0;
        source = 'current-regime';
      }
      if (!(amount > EPSILON)) continue;
      monthly += amount;
      items.push({
        id: c.id,
        label: c.label,
        monthly: roundCent(amount),
        source,
      });
    }
    return { monthly, items };
  }
  function essentialMonthlyNeed(plan, periods, opts) {
    return essentialNeedBreakdown(plan, periods, opts).monthly;
  }
  function paydaySettlementState(date, asOf) {
    if (date && asOf && date >= asOf) return 'upcoming';
    return 'unverified';
  }

  function uniquePaydayDates(events, asOf, floor) {
    const out = [];
    const seen = new Set();
    for (const e of events || []) {
      if (e.kind !== 'income' || !(e.amount >= floor) || e.date < asOf) continue;
      if (seen.has(e.date)) continue;
      seen.add(e.date);
      out.push(e.date);
    }
    return out;
  }

  // Closed labels from provider category identity, not merchant guessing.
  // Lunch Money's transfer/payment category and equivalent names are
  // account-to-account movement, not household category spending.
  const TRANSFER_CATEGORY_LABELS = new Set([
    'transfer',
    'payment',
    'payment, transfer',
    'credit card payment',
    'cc payment',
  ]);
  const DEBT_PAYMENT_CATEGORY_LABELS = new Set([
    'personal loan payment',
  ]);

  function paydayCalendar(plan, asOf, opts) {
    opts = opts || {};
    const payFloor = opts.paydayFloor != null ? opts.paydayFloor : 1000;
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const allEvents = expandEvents(plan, asOf, horizon.end, opts);
    const paydayDates = uniquePaydayDates(allEvents, asOf, payFloor);
    const todayIsPayday = paydayDates[0] === asOf;
    const subsequent = todayIsPayday ? (paydayDates[1] || null) : (paydayDates[0] || null);
    const periodEndExclusive = subsequent || addDays(asOf, 1);
    const periodLast = addDays(periodEndExclusive, -1);
    return {
      todayIsPayday,
      mode: todayIsPayday ? 'payday' : 'between-paydays',
      subsequent,
      paydayDates,
      periodLast,
      periodEndExclusive,
    };
  }

  // Between paydays, a live overlay that advanced as-of keeps the original
  // opening as the plan-period origin so elapsed actuals are subtracted from
  // that plan rather than from a remaining-days reslice that would double-count.
  function periodOriginDate(plan, asOf, todayIsPayday) {
    if (todayIsPayday) return asOf;
    const opening = plan && plan.opening;
    if (opening && opening.asOf === asOf && opening.priorAsOf && opening.priorAsOf < asOf) {
      return opening.priorAsOf;
    }
    return asOf;
  }

  function normalizeCategoryLabel(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function transactionPendingState(tx) {
    if (!tx || tx.pending !== true) return 'posted';
    const treatment = tx.pendingTreatment;
    if (treatment === 'confirmed-settled'
      || treatment === 'presumed-settled-for-current-forecast') return 'posted';
    return 'pending';
  }

  const DOG_FOOD_MERCHANT_RE = /\bSURREY\s+MEAT\b/;
  const CONVENIENCE_STORE_RE =
    /7[\s-]*eleven|\b7-11\b|\b7eleven\b|circle\s*k|mac'?s\s*(convenience)?|on\s*the\s*run/i;
  const FUEL_EVIDENCE_RE = /\b(fuel|gas|petrol|gasoline)\b/i;
  const CANADIAN_TIRE_RE = /canadian\s*tire/i;
  const EATING_OUT_LABELS = new Set(['restaurants', 'fast food', 'food delivery']);
  const BILL_BUDGET_IDS = new Set(['subscriptions', 'insurance', 'telecom']);
  const BILL_CATEGORY_LABELS = new Set([
    'mortgage', 'bills', 'bill', 'subscription', 'subscriptions',
    'insurance', 'telecom',
    'natural gas', 'other bank fees',
  ]);
  const REFUND_LABELS = new Set(['refund', 'refunds', 'reimbursement']);

  function txTextBlob(tx) {
    if (!tx) return '';
    const parts = [
      tx.displayedPayee, tx.originalMerchant, tx.payee,
      tx.note, tx.notes, tx.tag, tx.tags, tx.kindHint, tx.mcc, tx.kind,
    ];
    return parts.map(value => {
      if (value == null) return '';
      if (Array.isArray(value)) {
        return value.map(item => {
          if (item == null) return '';
          if (typeof item === 'string' || typeof item === 'number') return String(item);
          return String(item.name || item.label || item.id || '');
        }).join(' ');
      }
      return String(value);
    }).join(' ');
  }

  function txMerchantExact(tx) {
    if (!tx) return '';
    if (tx.originalMerchant != null && String(tx.originalMerchant).trim() !== '') {
      return String(tx.originalMerchant).trim();
    }
    if (tx.displayedPayee != null && String(tx.displayedPayee).trim() !== '') {
      return String(tx.displayedPayee).trim();
    }
    if (tx.payee != null && String(tx.payee).trim() !== '') {
      return String(tx.payee).trim();
    }
    return '';
  }

  function txHasMerchantIdentity(tx) {
    if (tx && tx.merchantKnown === true) return true;
    return txMerchantExact(tx) !== '';
  }

  function isConvenienceStoreMerchant(tx) {
    if (tx && tx.convenienceStore === true) return true;
    return CONVENIENCE_STORE_RE.test(txTextBlob(tx));
  }

  function hasExplicitFuelEvidence(tx) {
    if (tx && tx.fuelEvidence === true) return true;
    const hint = normalizeCategoryLabel(tx && tx.kindHint);
    if (hint === 'gas' || hint === 'fuel' || hint === 'petrol') return true;
    const mcc = String((tx && tx.mcc) || '');
    if (mcc === '5541' || mcc === '5542') return true;
    const blob = [
      tx && tx.note, tx && tx.notes, tx.tag, tx && tx.tags,
    ].map(v => {
      if (v == null) return '';
      if (Array.isArray(v)) return v.map(item => String(item && (item.name || item.label || item) || '')).join(' ');
      return String(v);
    }).join(' ');
    return FUEL_EVIDENCE_RE.test(blob);
  }

  function isUncertainGroceryMerchant(tx) {
    // Dale 2026-09-02: Iron Butcher is owner-confirmed Groceries, not this
    // fail-closed. No other merchant is grocery-uncertain by regex.
    return !!(tx && tx.groceryUncertain === true);
  }

  function hasGroceryMixedEvidence(tx) {
    if (tx && tx.groceryMixed === true) return true;
    const noteBlob = [tx && tx.note, tx && tx.notes, tx && tx.tag, tx && tx.tags]
      .map(v => String(v || '')).join(' ');
    if (!/\b(split|mixed|household|restaurants?|eating\s*out)\b/i.test(noteBlob)) {
      return false;
    }
    return !/save-?on/i.test(txTextBlob(tx));
  }

  function normalizeMerchantKey(value) {
    return String(value == null ? '' : value)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function payeeLooksLikePets(tx) {
    if (isDogFoodMerchant(tx)) return true;
    return /\bPET(?:S|VALU|SMART)?\b/i.test(txMerchantExact(tx));
  }

  // Payee and Lunch Money category disagree. The category must not silently
  // win (Google + Pets must not become dog food or Other-as-Pets). Represented
  // bills are already handled above this check.
  function payeeDisagreesWithBudgetCategory(tx, categoryId) {
    if (!txHasMerchantIdentity(tx) || !categoryId) return false;
    if (categoryId === 'pets') return !payeeLooksLikePets(tx);
    return false;
  }

  function spendDuplicateKey(tx) {
    if (!tx || !tx.date) return null;
    const account = tx.atlasAccountId || tx.account;
    const amt = Number(tx.amount);
    const merchant = normalizeMerchantKey(txMerchantExact(tx));
    if (account == null || account === '' || !isFinite(amt) || !merchant) return null;
    return [tx.date, String(account), Number(amt).toFixed(2), merchant].join('|');
  }

  // Surface a 1:1 pending+posted twin as unresolved possible replacement.
  // Date/account/amount/merchant is not financial identity: a legitimate
  // second purchase can share those four fields. Do not drop a row. Only a
  // directed pendingTransactionId or an owner-confirmed named pair may
  // collapse to one transaction. Confirmed household spend counts the
  // posted side once; the still-visible pending stays recon/pending
  // exposure and is not a second confirmed spend.
  function pendingPostedDuplicateIdSet(packet) {
    const flagged = new Set();
    const txs = packet && Array.isArray(packet.transactions) ? packet.transactions : [];
    const pendingByKey = new Map();
    const postedByKey = new Map();
    for (const tx of txs) {
      if (!tx) continue;
      if (tx.pendingPostedDuplicate === true && tx.id != null) {
        flagged.add(String(tx.id));
      }
      const key = spendDuplicateKey(tx);
      if (!key) continue;
      const bucket = transactionPendingState(tx) === 'pending' ? pendingByKey : postedByKey;
      const list = bucket.get(key) || [];
      list.push(tx);
      bucket.set(key, list);
    }
    for (const [key, pendings] of pendingByKey) {
      const posted = postedByKey.get(key) || [];
      if (pendings.length !== 1 || posted.length !== 1) continue;
      for (const tx of pendings.concat(posted)) {
        if (tx && tx.id != null) flagged.add(String(tx.id));
      }
    }
    return flagged;
  }

  function isPossibleReplacementPending(tx, duplicateIds) {
    if (!tx || transactionPendingState(tx) !== 'pending') return false;
    if (tx.id == null || !duplicateIds) return false;
    return duplicateIds.has(String(tx.id));
  }

  function confirmedHouseholdAmount(tx, duplicateIds) {
    if (isPossibleReplacementPending(tx, duplicateIds)) return 0;
    const amt = Number(tx && tx.amount);
    return isFinite(amt) ? amt : 0;
  }

  function isDogFoodMerchant(tx) {
    if (tx && tx.dogFood === true) return true;
    return DOG_FOOD_MERCHANT_RE.test(normalizeMerchantKey(txMerchantExact(tx)));
  }

  // Owner-confirmed grocery identity. Exact merchant keys only: WALMART /
  // WALMARTCA, MERIDIAN FARM, and IRON BUTCHER (Dale 2026-09-02). Not a
  // generic "Farm" / butcher / meat rule and not a second categorizer.
  // Surrey Meat stays Dog food via isDogFoodMerchant. Incumbent
  // plan.budget.excluded / Business still wins: this helper identifies
  // the merchant only.
  function isConfirmedGroceryMerchant(tx) {
    if (tx && tx.confirmedGrocery === true) return true;
    const key = normalizeMerchantKey(txMerchantExact(tx));
    if (!key) return false;
    if (key === 'WALMART' || key === 'WALMARTCA' || key.startsWith('WALMART ')) {
      return true;
    }
    if (key === 'IRON BUTCHER' || key === 'IRONBUTCHER'
      || key.startsWith('IRON BUTCHER ')) {
      return true;
    }
    return key === 'MERIDIAN FARM' || key === 'MERIDIANFARM'
      || key.startsWith('MERIDIAN FARM ');
  }

  // Owner-confirmed Dale guilt-free identity. Exact merchant key CURSOR
  // only (Dale 2026-09-02). Not software, subscriptions, developer tools,
  // or AI services in general.
  function isDaleGuiltFreeMerchant(tx) {
    if (tx && tx.daleGuiltFreeMerchant === true) return true;
    const key = normalizeMerchantKey(txMerchantExact(tx));
    if (!key) return false;
    return key === 'CURSOR' || key.startsWith('CURSOR ');
  }

  // Established Amazon purchase identity. First merchant token AMAZON /
  // AMZN / AMAZONCA / AMAZONCOM only (Dale 2026-09-03). Not a substring
  // match, not "contains Amazon", and not Amazon.ca Rewards Mastercard /
  // payment payees. Amazon Prime is Amazon merchant identity, not a bill.
  function isAmazonMerchant(tx) {
    if (tx && tx.amazonMerchant === true) return true;
    const key = normalizeMerchantKey(txMerchantExact(tx));
    if (!key) return false;
    const first = key.split(' ')[0];
    if (first !== 'AMAZON' && first !== 'AMZN'
      && first !== 'AMAZONCA' && first !== 'AMAZONCOM') {
      return false;
    }
    if (/\b(REWARDS|MASTERCARD|PAYMENT|PMT|AUTOPAY)\b/.test(key)) return false;
    return true;
  }

  // Canonical Atlas account identity only. Display names are not a second
  // Travel Visa detector: `travelvisa` / `TRAVEL VISA` normalize to the
  // same id, and nothing else does.
  function isTravelVisaAccount(tx) {
    if (!tx) return false;
    for (const value of [tx.atlasAccountId, tx.accountId, tx.account]) {
      if (value == null || value === '') continue;
      const norm = String(value).trim().toLowerCase().replace(/[\s_-]+/g, '');
      if (norm === 'travelvisa') return true;
    }
    return false;
  }

  // Standing owner rule (Dale 2026-09-03): Amazon merchant identity AND
  // canonical travelvisa → Amanda guilt-free. Not all Amazon, not all
  // Travel Visa, not MBNA card branding, not Prime-as-bill.
  function isAmandaAmazonTravelVisa(tx) {
    if (!tx) return false;
    return isAmazonMerchant(tx) && isTravelVisaAccount(tx);
  }

  // Owner-confirmed Fuel identity. Exact merchant key PITT MEADOWS CE /
  // PITTMEADOWSCE only (Dale 2026-09-02; the same identity the historical
  // chequing library carries as Fuel & transport). Not a generic Pitt
  // Meadows rule: PITT MEADOWS AR and other Pitt Meadows merchants do not
  // inherit it. Provider bill/subscription labels do not divert it.
  // Incumbent plan.budget.excluded / Business still wins.
  function isConfirmedFuelMerchant(tx) {
    if (tx && tx.confirmedFuel === true) return true;
    const key = normalizeMerchantKey(txMerchantExact(tx));
    if (!key) return false;
    return key === 'PITT MEADOWS CE' || key === 'PITTMEADOWSCE'
      || key.startsWith('PITT MEADOWS CE ');
  }

  // Canadian Tire Mastercard payment identity. The exact TD payee
  // CAN TIRE MC is debt servicing (Dale 2026-09-02), the same identity the
  // historical chequing DEBT pattern already excludes from spending. It is
  // never household consumption. Ordinary Canadian Tire retail
  // (CANADIAN TIRE ...) is not this identity and stays on
  // isCanadianTireMerchant. Amount and date are not part of the rule.
  function isCanadianTireMastercardPayment(tx) {
    if (tx && tx.cardPaymentIdentity === true) return true;
    const key = normalizeMerchantKey(txMerchantExact(tx));
    if (!key) return false;
    return key === 'CAN TIRE MC' || key.startsWith('CAN TIRE MC ');
  }

  function isCanadianTireMerchant(tx) {
    if (tx && tx.canadianTire === true) return true;
    if (isCanadianTireMastercardPayment(tx)) return false;
    return CANADIAN_TIRE_RE.test(txTextBlob(tx));
  }

  // Unique local id only. Date-plus-amount is not identity: a grocery with
  // the same date and amount as a represented bill stays Groceries.
  // Ambiguous or missing linkage fails closed (not a bill).
  function txMatchesRepresentedBill(tx, opts) {
    if (!tx) return false;
    if (tx.representedBill === true) return true;
    const packet = opts && opts.currentPeriodActuals
      ? opts.currentPeriodActuals
      : (opts && opts.packet);
    const rows = packet && Array.isArray(packet.representedActuals)
      ? packet.representedActuals : [];
    const id = tx.id;
    if (!id || !rows.length) return false;
    return rows.some(row => row && row.transactionId && row.transactionId === id);
  }

  function confirmationResult(reason, includeReason) {
    return {
      kind: 'unclassified',
      categoryId: 'uncategorised',
      householdSpending: true,
      reason,
      needsConfirmation: true,
      includeReason: includeReason || reason,
      atlasRow: null,
    };
  }

  function spendResult(categoryId, includeReason) {
    return {
      kind: 'spend',
      categoryId,
      householdSpending: true,
      reason: null,
      needsConfirmation: false,
      includeReason: includeReason || ('category:' + categoryId),
      atlasRow: categoryId,
    };
  }

  // Current-period classification contract (the "gatekeeper" wording is
  // this admission order, not a second runtime). Forecast remains the
  // sole classifier. Other spending is only the final fail-closed residual
  // after incumbent known rules:
  //   1. account / scope (household-external, unmapped)
  //   2. non-consumption (income, refund, transfer, card/debt payment,
  //      represented bill)
  //   3. owner-confirmed merchant / financial identity (CAN TIRE MC,
  //      Cursor, Fuel, Dog food, confirmed groceries)
  //   4. owner account+merchant identity (Amazon + travelvisa → Amanda)
  //   5. trusted incumbent budget-category mapping
  //   6. contradiction / ambiguity fail-closed
  //   7. needsConfirmation / Other
  // Surrey Meat is Dog food, never Groceries. The incumbent
  // plan.budget.excluded / Business boundary stays ahead of the confirmed
  // grocery merchant override: Walmart, Meridian Farm, and Iron Butcher
  // (Dale 2026-09-02) are Groceries only when otherwise eligible household
  // spending. Cursor (Dale 2026-09-02) is Dale guilt-free, never Amanda,
  // never Other. PITT MEADOWS CE (Dale 2026-09-02) is Fuel. CAN TIRE MC
  // (Dale 2026-09-02) is the Canadian Tire Mastercard payment: card-payment,
  // never Household Budget, never Other. Amazon merchant + canonical
  // travelvisa (Dale 2026-09-03) is Amanda guilt-free, never Other, never
  // a Prime bill, and never Amanda merely because the card is MBNA.
  // Eating out is Restaurants + Fast Food + Food Delivery. Ordinary
  // Canadian Tire retail is not Household. 7-Eleven is not confirmed Fuel
  // without tx-level fuel evidence. Uncertain txs go to confirmation, not
  // a named household-budget row.
  function classifyCurrentPeriodTransaction(tx, plan, opts) {
    if (!tx) {
      return { kind: 'unclassified', categoryId: null, householdSpending: false, reason: 'missing' };
    }
    const role = tx.accountRole || null;
    if (role === 'household-external') {
      return {
        kind: 'external', categoryId: null, householdSpending: false,
        reason: 'account-not-household',
      };
    }
    if (role === 'unmapped') {
      return {
        kind: 'unmapped', categoryId: null, householdSpending: true,
        reason: 'unmapped-account',
      };
    }
    if (tx.isIncome === true) {
      return { kind: 'income', categoryId: null, householdSpending: false, reason: 'income' };
    }
    const amt = Number(tx.amount);
    if (isFinite(amt) && amt < 0) {
      return { kind: 'refund', categoryId: null, householdSpending: false, reason: 'refund' };
    }
    const hint = normalizeCategoryLabel(tx.kindHint);
    if (hint === 'payment' || hint === 'card-payment' || hint === 'bill-payment') {
      return { kind: 'card-payment', categoryId: null, householdSpending: false, reason: 'kind-hint' };
    }
    if (hint === 'transfer' || hint === 'internal-transfer') {
      return { kind: 'transfer', categoryId: null, householdSpending: false, reason: 'kind-hint' };
    }
    // Dale 2026-09-02: CAN TIRE MC is the Canadian Tire Mastercard payment.
    // The provider label (Pets, Shopping, Household, none) does not decide.
    if (isCanadianTireMastercardPayment(tx)) {
      return {
        kind: 'card-payment', categoryId: null, householdSpending: false,
        reason: 'debt-payment-identity', includeReason: 'debt-payment-identity',
      };
    }
    const label = normalizeCategoryLabel(tx.categoryLabel);
    if (REFUND_LABELS.has(label)) {
      return { kind: 'refund', categoryId: null, householdSpending: false, reason: 'refund-label' };
    }
    if (DEBT_PAYMENT_CATEGORY_LABELS.has(label)) {
      return { kind: 'card-payment', categoryId: null, householdSpending: false, reason: 'debt-payment' };
    }
    if (TRANSFER_CATEGORY_LABELS.has(label)
      || (tx.excludeFromTotals === true && TRANSFER_CATEGORY_LABELS.has(label))) {
      return { kind: 'transfer', categoryId: null, householdSpending: false, reason: 'transfer-label' };
    }
    if (txMatchesRepresentedBill(tx, opts || {})) {
      return {
        kind: 'bill', categoryId: null, householdSpending: false,
        reason: 'represented-bill', includeReason: 'represented-bill',
      };
    }
    if (isDaleGuiltFreeMerchant(tx)) {
      const excluded = ((plan && plan.budget && plan.budget.excluded) || []);
      for (const row of excluded) {
        const from = normalizeCategoryLabel(row && (row.from || row.label));
        if (from && from === label) {
          return { kind: 'business', categoryId: null, householdSpending: false, reason: 'excluded' };
        }
      }
      return spendResult('dale-guilt-free', 'dale-guilt-free-merchant');
    }
    // Dale 2026-09-03: Amazon + travelvisa is Amanda guilt-free. Incidental
    // Dale/Amanda provider labels do not override it. Incumbent
    // plan.budget.excluded / Business still wins. Not a Prime bill.
    if (isAmandaAmazonTravelVisa(tx)) {
      const excluded = ((plan && plan.budget && plan.budget.excluded) || []);
      for (const row of excluded) {
        const from = normalizeCategoryLabel(row && (row.from || row.label));
        if (from && from === label) {
          return { kind: 'business', categoryId: null, householdSpending: false, reason: 'excluded' };
        }
      }
      return spendResult('amanda-guilt-free', 'amanda-amazon-travelvisa');
    }
    // Dale 2026-09-02: PITT MEADOWS CE is Fuel. Provider bill/subscription
    // labels do not divert it. Incumbent plan.budget.excluded / Business
    // still wins.
    if (isConfirmedFuelMerchant(tx)) {
      const excluded = ((plan && plan.budget && plan.budget.excluded) || []);
      for (const row of excluded) {
        const from = normalizeCategoryLabel(row && (row.from || row.label));
        if (from && from === label) {
          return { kind: 'business', categoryId: null, householdSpending: false, reason: 'excluded' };
        }
      }
      return spendResult('fuel', 'fuel-merchant');
    }
    if (BILL_CATEGORY_LABELS.has(label)) {
      return {
        kind: 'bill', categoryId: null, householdSpending: false,
        reason: 'bill-label', includeReason: 'bill-label',
      };
    }
    if (isDogFoodMerchant(tx)) {
      return spendResult('pets', 'dog-food-merchant');
    }
    if (isConfirmedGroceryMerchant(tx)) {
      const excluded = ((plan && plan.budget && plan.budget.excluded) || []);
      for (const row of excluded) {
        const from = normalizeCategoryLabel(row && (row.from || row.label));
        if (from && from === label) {
          return { kind: 'business', categoryId: null, householdSpending: false, reason: 'excluded' };
        }
      }
      return spendResult('groceries', 'grocery-merchant');
    }
    if (isCanadianTireMerchant(tx)) {
      return confirmationResult('canadian-tire-unconfirmed', 'canadian-tire-unconfirmed');
    }
    if (EATING_OUT_LABELS.has(label)) {
      return spendResult('restaurants', 'eating-out-category');
    }
    const excluded = ((plan && plan.budget && plan.budget.excluded) || []);
    for (const row of excluded) {
      const from = normalizeCategoryLabel(row && (row.from || row.label));
      if (from && from === label) {
        return { kind: 'business', categoryId: null, householdSpending: false, reason: 'excluded' };
      }
    }
    const cats = (plan && plan.budget && plan.budget.categories) || [];
    let matched = null;
    for (const c of cats) {
      if (!c || !c.id) continue;
      const aliases = [c.id, c.label].concat(c.from || []);
      if (!aliases.some(a => normalizeCategoryLabel(a) === label)) continue;
      if (matched && matched.id !== c.id) {
        return confirmationResult('ambiguous-category', 'ambiguous-category');
      }
      matched = c;
    }
    if (matched && BILL_BUDGET_IDS.has(matched.id)) {
      return {
        kind: 'bill', categoryId: matched.id, householdSpending: false,
        reason: 'bills-only', includeReason: 'bills-only:' + matched.id,
      };
    }
    if (matched && payeeDisagreesWithBudgetCategory(tx, matched.id)) {
      return confirmationResult(
        'payee-category-contradiction',
        'payee-category-contradiction'
      );
    }
    if (matched && matched.id === 'fuel') {
      if (isConvenienceStoreMerchant(tx) && !hasExplicitFuelEvidence(tx)) {
        return confirmationResult(
          'convenience-store-unconfirmed-fuel',
          'convenience-store-unconfirmed-fuel'
        );
      }
      if (!txHasMerchantIdentity(tx) && !hasExplicitFuelEvidence(tx)) {
        return confirmationResult('fuel-merchant-missing', 'fuel-merchant-missing');
      }
      return spendResult('fuel', 'fuel-category');
    }
    if (matched && matched.id === 'groceries') {
      if (isDogFoodMerchant(tx)) {
        return spendResult('pets', 'dog-food-merchant');
      }
      if (!txHasMerchantIdentity(tx)) {
        return confirmationResult('grocery-merchant-missing', 'grocery-merchant-missing');
      }
      if (isUncertainGroceryMerchant(tx)) {
        return confirmationResult('grocery-merchant-unconfirmed', 'grocery-merchant-unconfirmed');
      }
      if (hasGroceryMixedEvidence(tx)) {
        return confirmationResult('grocery-mixed-evidence', 'grocery-mixed-evidence');
      }
      return spendResult('groceries', 'groceries-category');
    }
    if (matched && matched.id === 'pets') {
      if (!isDogFoodMerchant(tx)) {
        return confirmationResult('pets-not-dog-food', 'pets-not-dog-food');
      }
      return spendResult('pets', 'dog-food-merchant');
    }
    if (matched && matched.id === PERSONAL_SHOPPING_ID) {
      const owner = personalSpendOwner(tx);
      if (owner === 'excluded') {
        return {
          kind: 'business', categoryId: null, householdSpending: false,
          reason: 'personal-excluded', includeReason: 'personal-excluded',
        };
      }
      if (owner === 'dale') return spendResult(DALE_GUILT_FREE_ID, 'owner-evidence-dale');
      if (owner === 'amanda') return spendResult(AMANDA_GUILT_FREE_ID, 'owner-evidence-amanda');
      return confirmationResult('personal-unassigned', 'personal-unassigned');
    }
    if (matched && matched.id === DALE_GUILT_FREE_ID) {
      const owner = personalSpendOwner(tx);
      if (owner === 'dale') return spendResult(DALE_GUILT_FREE_ID, 'owner-evidence-dale');
      return confirmationResult('personal-unassigned', 'personal-unassigned');
    }
    if (matched && matched.id === AMANDA_GUILT_FREE_ID) {
      const owner = personalSpendOwner(tx);
      if (owner === 'amanda') return spendResult(AMANDA_GUILT_FREE_ID, 'owner-evidence-amanda');
      return confirmationResult('personal-unassigned', 'personal-unassigned');
    }
    if (matched) {
      return spendResult(matched.id, 'category:' + matched.id);
    }
    // Lunch Money (and equivalents) mark transfers/payments exclude-from-totals.
    // That identity is not a merchant guess. An unmatched excluded row is not
    // household category spending and is not silently dropped: it is counted
    // as a transfer so the household can still see it was observed.
    if (tx.excludeFromTotals === true) {
      return {
        kind: 'transfer', categoryId: null, householdSpending: false,
        reason: 'exclude-from-totals',
      };
    }
    return confirmationResult(
      label ? 'unmapped-label' : 'no-category',
      label ? 'unmapped-label' : 'no-category'
    );
  }

  function currentPeriodActualsPacket(opts) {
    const raw = opts && opts.currentPeriodActuals;
    return raw && typeof raw === 'object' ? raw : null;
  }

  function pendingCoverageStatus(packet) {
    const cov = packet && packet.pendingCoverage;
    if (cov === 'complete' || (cov && cov.complete === true && cov.status !== 'insufficient')) {
      return 'complete';
    }
    if (cov === 'partial' || (cov && cov.status === 'bounded-window')) return 'partial';
    if (cov === 'unknown' || cov == null) return 'unknown';
    if (cov && cov.complete === false) return 'unknown';
    return 'unknown';
  }

  function transactionCoverageStatus(packet) {
    const cov = packet && packet.transactionCoverage;
    if (cov === 'truncated' || cov === 'incomplete') return 'truncated';
    if (cov && typeof cov === 'object'
      && (cov.truncated === true || cov.complete === false)) {
      return 'truncated';
    }
    return 'complete';
  }

  function hasUnresolvedAccountActuals(packet) {
    const txs = packet && packet.transactions;
    if (!Array.isArray(txs)) return false;
    return txs.some(tx => tx && tx.accountRole === 'unmapped');
  }

  function actualsCoverageState(asOf, periodStart, opts) {
    const packet = currentPeriodActualsPacket(opts);
    if (!packet) {
      return {
        status: 'absent',
        remainingClaim: 'unavailable',
        pendingStatus: 'unknown',
        observationAsOf: null,
        coverageStart: null,
        coverageThrough: null,
        reason: 'No current-period transaction actuals were supplied.',
      };
    }
    const coverageStart = packet.coverageStart || null;
    const coverageThrough = packet.coverageThrough || null;
    const observationAsOf = packet.observationAsOf || null;
    const pendingStatus = pendingCoverageStatus(packet);
    if (!coverageThrough || coverageThrough < asOf) {
      return {
        status: 'stale',
        remainingClaim: 'unavailable',
        pendingStatus,
        observationAsOf,
        coverageStart,
        coverageThrough,
        reason: 'Transaction actuals are not current through the financial as-of.',
      };
    }
    if (coverageStart && periodStart && coverageStart > periodStart) {
      return {
        status: 'incomplete',
        remainingClaim: 'unavailable',
        pendingStatus,
        observationAsOf,
        coverageStart,
        coverageThrough,
        reason: 'Transaction coverage starts after the current period origin.',
      };
    }
    if (hasUnresolvedAccountActuals(packet)) {
      return {
        status: 'incomplete',
        remainingClaim: 'unavailable',
        pendingStatus,
        observationAsOf,
        coverageStart,
        coverageThrough,
        reason: 'Current-period transactions include an unresolved provider account. Remaining amounts unavailable.',
      };
    }
    if (transactionCoverageStatus(packet) === 'truncated') {
      return {
        status: 'incomplete',
        remainingClaim: 'unavailable',
        pendingStatus,
        observationAsOf,
        coverageStart,
        coverageThrough,
        reason: 'Posted transaction coverage is truncated. Current remaining amounts unavailable.',
      };
    }
    if (pendingStatus === 'complete') {
      return {
        status: 'current',
        // Provider/account coverage completeness, not named-category remaining
        // precision. Unclassified household spend is a separate claim.
        remainingClaim: 'precise',
        pendingStatus,
        observationAsOf,
        coverageStart,
        coverageThrough,
        reason: null,
      };
    }
    return {
      status: 'current',
      remainingClaim: 'posted-only',
      pendingStatus,
      observationAsOf,
      coverageStart,
      coverageThrough,
      reason: 'Pending coverage is not complete. Observed pending still constrains remaining; additional unknown pending may exist.',
    };
  }

  // Named-category remaining precision. Provider coverage can be complete
  // while household spending is still unclassified; that must not publish a
  // precise named-remaining claim. The incumbent `uncategorised` remainder
  // bucket is not a trusted named Atlas category, so spend assigned there
  // is also classification-incomplete. Transfers, card payments, income,
  // business-excluded, and household-external amounts never reach
  // `unclassified` and do not degrade this claim.
  function categoryRemainingClaimFrom(coverageClaim, unclassified) {
    if (coverageClaim !== 'precise' && coverageClaim !== 'posted-only') {
      return 'unavailable';
    }
    const count = unclassified && Number(unclassified.count) || 0;
    const posted = unclassified && Number(unclassified.posted) || 0;
    const pending = unclassified && Number(unclassified.pending) || 0;
    if (count > 0 || Math.abs(posted) > EPSILON || Math.abs(pending) > EPSILON) {
      return 'classified-incomplete';
    }
    return coverageClaim;
  }

  function emptyCategoryActuals() {
    return {
      byId: new Map(),
      unclassified: { posted: 0, pending: 0, count: 0 },
      excluded: {
        transfers: 0, cardPayments: 0, income: 0, business: 0, external: 0,
        bills: 0, refunds: 0,
      },
    };
  }

  // Confidence only. Category amount accounting still uses `byId`.
  // Canonical `uncategorised` is a remainder bucket, not a trusted named
  // category, so spend assigned there is classification-incomplete.
  function classificationIncompleteHouseholdSpend(cls) {
    if (!cls) return false;
    if (cls.needsConfirmation) return true;
    if (cls.kind === 'unclassified' || cls.kind === 'unmapped') return true;
    return cls.kind === 'spend' && (cls.categoryId || 'uncategorised') === 'uncategorised';
  }

  function skipSplitParent(tx, packet) {
    if (!tx || tx.isGroup !== true) return false;
    const txs = packet && Array.isArray(packet.transactions) ? packet.transactions : [];
    const id = tx.id != null ? String(tx.id) : null;
    if (!id) {
      return txs.some(child => child && child !== tx && child.parentId);
    }
    return txs.some(child => child && child.parentId != null && String(child.parentId) === id);
  }

  function sumCategoryActuals(plan, asOf, periodStart, opts) {
    const out = emptyCategoryActuals();
    const packet = currentPeriodActualsPacket(opts);
    if (!packet || !Array.isArray(packet.transactions)) return out;
    const classifyOpts = Object.assign({}, opts || {}, { packet, currentPeriodActuals: packet });
    const duplicateIds = pendingPostedDuplicateIdSet(packet);
    const add = (row, state, amt) => {
      if (state === 'pending') row.pending = roundCent(row.pending + amt);
      else row.posted = roundCent(row.posted + amt);
    };
    for (const tx of packet.transactions) {
      if (!tx || !tx.date) continue;
      if (periodStart && tx.date < periodStart) continue;
      if (asOf && tx.date > asOf) continue;
      if (skipSplitParent(tx, packet)) continue;
      if (isPossibleReplacementPending(tx, duplicateIds)) continue;
      const amt = Number(tx.amount);
      if (!isFinite(amt) || amt === 0) {
        const clsZero = classifyCurrentPeriodTransaction(tx, plan, classifyOpts);
        if (classificationIncompleteHouseholdSpend(clsZero)) out.unclassified.count += 1;
        continue;
      }
      const cls = classifyCurrentPeriodTransaction(tx, plan, classifyOpts);
      const state = transactionPendingState(tx);
      if (cls.kind === 'transfer') { out.excluded.transfers = roundCent(out.excluded.transfers + amt); continue; }
      if (cls.kind === 'card-payment') { out.excluded.cardPayments = roundCent(out.excluded.cardPayments + amt); continue; }
      if (cls.kind === 'income') { out.excluded.income = roundCent(out.excluded.income + amt); continue; }
      if (cls.kind === 'business') { out.excluded.business = roundCent(out.excluded.business + amt); continue; }
      if (cls.kind === 'external') { out.excluded.external = roundCent(out.excluded.external + amt); continue; }
      if (cls.kind === 'bill') { out.excluded.bills = roundCent((out.excluded.bills || 0) + amt); continue; }
      if (cls.kind === 'refund') { out.excluded.refunds = roundCent((out.excluded.refunds || 0) + amt); continue; }
      if (cls.kind === 'unmapped') {
        out.unclassified.count += 1;
        continue;
      }
      if (cls.needsConfirmation) {
        out.unclassified.count += 1;
        add(out.unclassified, state, amt);
        continue;
      }
      const catId = cls.categoryId || 'uncategorised';
      if (!out.byId.has(catId)) out.byId.set(catId, { posted: 0, pending: 0, count: 0 });
      const row = out.byId.get(catId);
      row.count += 1;
      add(row, state, amt);
      if (classificationIncompleteHouseholdSpend(cls)) {
        out.unclassified.count += 1;
        add(out.unclassified, state, amt);
      }
    }
    return out;
  }

  function categoryCommittedActual(row) {
    if (!row) return { posted: 0, pending: 0, committed: 0 };
    const posted = roundCent(row.posted);
    const pending = roundCent(row.pending);
    return { posted, pending, committed: roundCent(posted + pending) };
  }

  function representedActualMap(opts) {
    const packet = currentPeriodActualsPacket(opts);
    const map = new Map();
    const rows = packet && Array.isArray(packet.representedActuals)
      ? packet.representedActuals : [];
    for (const row of rows) {
      if (!row || !row.id || !row.date) continue;
      const amt = Number(row.actual);
      if (!isFinite(amt)) continue;
      const postedOn = row.postedOn && ISO_CALENDAR_DATE.test(String(row.postedOn))
        ? String(row.postedOn) : null;
      map.set(row.id + '@' + row.date, {
        actual: roundCent(amt),
        postedOn,
      });
    }
    return map;
  }

  function observedActual(observed, id, date) {
    const row = observed && id && date ? observed.get(id + '@' + date) : null;
    if (!row || row.actual == null) return null;
    return row.actual;
  }

  function observedPostedOn(observed, id, date, fallback) {
    const row = observed && id && date ? observed.get(id + '@' + date) : null;
    return (row && row.postedOn) || fallback || null;
  }

  function householdMovement(amount, direction) {
    const mag = Math.abs(Number(amount) || 0);
    if (mag < EPSILON) return 0;
    return direction === 'in' ? roundCent(mag) : roundCent(-mag);
  }

  // Kitchen-counter bill status for the default Plan view. Represented is
  // PAID. Same-day upcoming is pending. Everything else still due. The
  // page must not print settlement code words.
  function glanceBillStatus(settlement, asOf, date) {
    if (settlement === 'represented') return 'PAID';
    if (settlement === 'upcoming' && date && asOf && date === asOf) return 'pending';
    return 'still due';
  }

  // Owner-target household lines Dale asked the default view to print.
  // Print only categories that already exist as Atlas plan.budget owner
  // targets. Dale/Amanda guilt-free rows exist only as the two owner-target
  // ids on the calendar waterfall; do not invent further personal rows.
  const DEFAULT_VIEW_BUDGET_IDS = ['groceries', 'fuel', 'pets', 'restaurants'];
  // Variable owner-target lines the calendar waterfall holds. Medical,
  // children/sports, combined Personal/shopping, and subscriptions are not
  // holds: subscriptions are itemized bills; shopping actuals map to the
  // two guilt-free ids only with account/payee/note/tag evidence.
  const CALENDAR_PERIOD_BUDGET_IDS = [
    'groceries', 'fuel', 'household', 'pets', 'restaurants',
    'dale-guilt-free', 'amanda-guilt-free',
  ];

  // Incumbent Household Budget supporting-row predicate. calendarHouseholdBudget
  // and the overlay sanitizer share this so merchant identity is not a second
  // membership authority.
  function householdBudgetSupportingSpendEligible(cls) {
    if (!cls) return false;
    if (cls.kind === 'transfer' || cls.kind === 'card-payment' || cls.kind === 'income'
      || cls.kind === 'business' || cls.kind === 'external' || cls.kind === 'bill'
      || cls.kind === 'refund' || cls.kind === 'unmapped') {
      return false;
    }
    if (cls.needsConfirmation || cls.kind === 'unclassified') return true;
    const catId = cls.atlasRow || cls.categoryId;
    return !!(catId && CALENDAR_PERIOD_BUDGET_IDS.indexOf(catId) >= 0);
  }
  const DEFAULT_VIEW_BUDGET_LABELS = {
    groceries: 'Groceries',
    fuel: 'Fuel',
    pets: 'Dog food',
    restaurants: 'Eating out',
    household: 'Household',
    'dale-guilt-free': 'Dale guilt-free spending',
    'amanda-guilt-free': 'Amanda guilt-free spending',
  };
  const DALE_GUILT_FREE_ID = 'dale-guilt-free';
  const AMANDA_GUILT_FREE_ID = 'amanda-guilt-free';
  const PERSONAL_SHOPPING_ID = 'shopping';
  const OTHER_SPENDING_ID = 'other-spending';

  function currentPeriodBills(plan, asOf, origin, periodLast, opts) {
    const represented = representedKeySet(plan, opts, asOf);
    const observed = representedActualMap(opts);
    const events = expandEvents(plan, origin, periodLast,
      Object.assign({}, opts || {}, { keepRepresented: true }));
    const items = [];
    const seen = new Set();
    for (const e of events) {
      if (!isJointCashOutflow(e)) continue;
      if (e.kind !== 'obligation' && e.kind !== 'bill' && e.kind !== 'commitment') continue;
      const amt = -e.amount;
      if (!(amt > EPSILON)) continue;
      const key = (e.id || e.label) + '@' + e.date;
      if (seen.has(key)) continue;
      seen.add(key);
      const paid = !!(e.id && represented.has(e.id + '@' + e.date));
      let settlement;
      let actual;
      let remaining;
      if (paid) {
        settlement = 'represented';
        actual = observedActual(observed, e.id, e.date);
        remaining = 0;
      } else if (e.date >= asOf) {
        settlement = 'upcoming';
        actual = 0;
        remaining = roundCent(amt);
      } else {
        settlement = 'unverified';
        actual = null;
        remaining = roundCent(amt);
      }
      items.push({
        id: e.id,
        label: e.label,
        kind: e.kind,
        date: e.date,
        planned: roundCent(amt),
        actual,
        remaining,
        settlement,
        evidenceDate: paid ? observedPostedOn(observed, e.id, e.date, e.date) : null,
        confidence: e.confidence || null,
      });
    }
    return items;
  }

  // Represented income already inside this pay period. Same keepRepresented
  // walk as currentPeriodBills; this is not a second calendar. Upcoming
  // income is not already paid and is omitted. The default glance does not
  // print this whole period set: currentPeriodAction.thisPaydayPaid keeps
  // only the payday date.
  function currentPeriodInflows(plan, asOf, origin, periodLast, opts) {
    const represented = representedKeySet(plan, opts, asOf);
    const notRelied = notReliedUponKeySet(plan, opts, asOf);
    const observed = representedActualMap(opts);
    const events = expandEvents(plan, origin, periodLast,
      Object.assign({}, opts || {}, { keepRepresented: true }));
    const items = [];
    const seen = new Set();
    for (const e of events) {
      if (!e || e.kind !== 'income') continue;
      const amt = e.amount;
      if (!(amt > EPSILON)) continue;
      const key = (e.id || e.label) + '@' + e.date;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.id && notRelied.has(e.id + '@' + e.date)) {
        items.push({
          id: e.id,
          label: e.label,
          kind: 'income',
          date: e.date,
          planned: roundCent(amt),
          actual: null,
          remaining: 0,
          settlement: 'not-relied-upon',
          evidenceDate: null,
          confidence: e.confidence || null,
          notReliedUpon: true,
          notReliedUponReason: notReliedUponReason(plan, opts, e.id, e.date),
        });
        continue;
      }
      if (!(e.id && represented.has(e.id + '@' + e.date))) continue;
      items.push({
        id: e.id,
        label: e.label,
        kind: 'income',
        date: e.date,
        planned: roundCent(amt),
        actual: observedActual(observed, e.id, e.date),
        remaining: 0,
        settlement: 'represented',
        evidenceDate: observedPostedOn(observed, e.id, e.date, e.date),
        confidence: e.confidence || null,
      });
    }
    return items;
  }

  // Settlement classification only: represented / upcoming / unverified for
  // current-period joint-cash bills. Does not compute recommend, weekly cap,
  // or paydayAllocation. currentPeriodAction remains the household action
  // surface and consumes this same bill list.
  function currentPeriodObligationStates(plan, asOf, opts) {
    opts = opts || {};
    const cal = opts.paydayCalendar || paydayCalendar(plan, asOf, opts);
    const origin = opts.periodOrigin
      || (opts.preservePaydayPeriodOrigin
        ? paydayPeriodOrigin(plan, asOf, Object.assign({}, opts, { paydayCalendar: cal }))
        : periodOriginDate(plan, asOf, cal.todayIsPayday));
    return {
      asOf,
      mode: cal.mode,
      periodStart: origin,
      periodEnd: cal.periodLast,
      nextPayday: cal.subsequent,
      bills: currentPeriodBills(plan, asOf, origin, cal.periodLast, opts),
    };
  }

  // The payday whose cheque is in play: as-of when today is payday,
  // otherwise the previous payday. Distinct from periodOriginDate, which
  // may reach back through a live overlay priorAsOf so elapsed actuals
  // still subtract from that opening.
  function thisPaydayDate(plan, asOf, opts, cal) {
    cal = cal || paydayCalendar(plan, asOf, opts);
    if (cal.todayIsPayday) return asOf;
    return previousPaydayDate(plan, asOf, opts) || asOf;
  }

  function onceBillIdsBeforePayday(plan, paydayDate) {
    const ids = new Set();
    for (const bill of (plan && plan.bills) || []) {
      if (bill && bill.frequency === 'once' && bill.id && bill.date
        && bill.date < paydayDate) {
        ids.add(bill.id);
      }
    }
    return ids;
  }

  // Already paid from this payday's cheque: represented inflows and bills
  // whose scheduled date or posting date is the payday itself. A card min
  // due earlier in the period can land here when an identified extra
  // payment posted on payday. Mid-period child benefit and previous-cycle
  // once stubs are period history, not this payday.
  function glanceRowOnPayday(row, paydayDate) {
    if (!row || !paydayDate) return false;
    return row.date === paydayDate || row.evidenceDate === paydayDate;
  }

  function thisPaydayPaidFrom(inflows, bills, paydayDate) {
    const paidIn = (inflows || []).filter(row => glanceRowOnPayday(row, paydayDate)
      && row.settlement !== 'not-relied-upon'
      && row.notReliedUpon !== true)
      .map(row => {
        const displayDate = (row.evidenceDate && row.evidenceDate === paydayDate)
          ? row.evidenceDate : (row.date || row.evidenceDate);
        const raw = row.actual != null ? row.actual : row.planned;
        return Object.assign({}, row, {
          date: displayDate || row.date,
          movement: householdMovement(raw, 'in'),
        });
      });
    const paidOut = (bills || []).filter(row => row
        && row.settlement === 'represented'
        && glanceRowOnPayday(row, paydayDate))
      .map(row => {
        const displayDate = (row.evidenceDate && row.evidenceDate === paydayDate)
          ? row.evidenceDate : (row.date || row.evidenceDate);
        const raw = row.actual != null ? row.actual : row.planned;
        return Object.assign({}, row, {
          date: displayDate || row.date,
          movement: householdMovement(raw, 'out'),
        });
      });
    return {
      payday: paydayDate,
      inflows: paidIn,
      bills: paidOut,
    };
  }

  // Still due from this payday's leftover cash. Drops carried once-rows
  // dated before this payday (previous cheque / posting-unknown stubs).
  // Keeps overdue recurring obligations (Travel Visa min) and bills due
  // on or after this payday (TD fees). Amounts copy paydayAllocation /
  // current-period remaining; this does not invent a payee. Glance
  // movement is money out (−) without flipping allocation math.
  function thisPaydayDueFrom(plan, paydayDate, alloc, bills) {
    const skip = onceBillIdsBeforePayday(plan, paydayDate);
    const byKey = new Map();
    for (const row of bills || []) {
      if (row && row.id && row.date) byKey.set(row.id + '@' + row.date, row);
    }
    const items = [];
    for (const item of (alloc && alloc.obligations && alloc.obligations.items) || []) {
      if (!item) continue;
      if (item.settlement === 'represented') continue;
      if (item.id && skip.has(item.id)) continue;
      const bill = byKey.get((item.id || '') + '@' + item.date);
      if (bill && bill.settlement === 'represented') continue;
      const amount = roundCent(item.amount);
      const remaining = bill && bill.remaining != null ? bill.remaining : amount;
      items.push({
        id: item.id,
        label: item.label,
        kind: item.kind,
        date: item.date,
        planned: amount,
        amount,
        allocated: item.allocated != null ? item.allocated : null,
        remaining,
        actual: bill && bill.actual != null ? bill.actual : null,
        settlement: (bill && bill.settlement) || item.settlement,
        confidence: item.confidence || (bill && bill.confidence) || null,
        movement: householdMovement(remaining != null ? remaining : amount, 'out'),
      });
    }
    return items;
  }

  // Bills this pay period for the default glance: from this payday date
  // through this pay period's bills. Paid stay listed. Previous-cycle
  // once stubs and mid-period inflows before this payday stay off the
  // glance. Combines thisPaydayPaid + thisPaydayDue plus later-in-period
  // represented bills; it does not dump current-period history.
  function thisPeriodGlanceFrom(plan, paydayDate, periodLast, asOf, alloc, inflows, bills) {
    const paid = thisPaydayPaidFrom(inflows, bills, paydayDate);
    const due = thisPaydayDueFrom(plan, paydayDate, alloc, bills);
    const skip = onceBillIdsBeforePayday(plan, paydayDate);
    const seen = new Set();
    const items = [];
    const push = row => {
      if (!row) return;
      const key = (row.id || row.label || '') + '@' + (row.date || '');
      if (seen.has(key)) return;
      seen.add(key);
      items.push(row);
    };
    for (const row of paid.inflows || []) {
      push(Object.assign({}, row, {
        status: 'in',
        glanceKind: 'in',
      }));
    }
    for (const row of paid.bills || []) {
      push(Object.assign({}, row, {
        status: 'PAID',
        glanceKind: 'paid',
      }));
    }
    for (const row of bills || []) {
      if (!row || row.settlement !== 'represented') continue;
      if (row.id && skip.has(row.id)) continue;
      if (!(row.date && paydayDate && row.date > paydayDate && periodLast
          && row.date <= periodLast)) continue;
      const raw = row.actual != null ? row.actual : row.planned;
      push(Object.assign({}, row, {
        status: 'PAID',
        glanceKind: 'paid',
        movement: householdMovement(raw, 'out'),
      }));
    }
    for (const row of due) {
      push(Object.assign({}, row, {
        status: glanceBillStatus(row.settlement, asOf, row.date),
        glanceKind: 'still-due',
      }));
    }
    items.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.label || '').localeCompare(String(b.label || '')));
    return items;
  }

  function householdBudgetGlance(plan, alloc) {
    const byId = new Map();
    for (const row of ((alloc && alloc.essentials && alloc.essentials.items) || [])) {
      if (row && row.id) byId.set(row.id, row);
    }
    const items = [];
    for (const cat of (plan && plan.budget && plan.budget.categories) || []) {
      if (!cat || DEFAULT_VIEW_BUDGET_IDS.indexOf(cat.id) < 0) continue;
      if (cat.plannedMonthly == null && cat.plannedWeekly == null
        && cat.plannedPayday == null && !cat.ownerLine) continue;
      const hold = byId.get(cat.id);
      const monthly = ownerTargetMonthly(cat);
      const amount = hold && hold.required != null
        ? hold.required
        : (monthly != null ? monthly : null);
      // Null only. A fully spent Groceries / Fuel / Pets / Eating-out
      // line still belongs on the kitchen-counter glance at $0.
      // Household is not in DEFAULT_VIEW_BUDGET_IDS; its explicit $0
      // monthly baseline is omitted by paydayCyclePlanned, not here.
      if (amount == null) continue;
      items.push({
        id: cat.id,
        label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
        amount: roundCent(amount),
        monthly: monthly != null
          ? monthly
          : (hold && hold.monthly != null ? hold.monthly : null),
        inEssentialHold: !!hold,
      });
    }
    return items;
  }

  function revolvingCardsGlance(plan, debts, extraDebt) {
    const priority = debtPriority(plan, debts || []);
    const byId = new Map((debts || []).map(d => [d.id, d]));
    const revolving = (priority.order || []).filter(row => {
      if (!row || row.id === 'heloc' || row.id === 'mortgage') return false;
      const d = byId.get(row.id);
      return d && !d.secured;
    });
    const extra = extraDebt || {};
    const targetId = extra.target && extra.target.id;
    const first = (targetId && revolving.find(row => row.id === targetId))
      || revolving[0]
      || null;
    const firstDebt = first ? byId.get(first.id) : null;
    const extraAmount = extra.allocated != null ? Number(extra.allocated) || 0 : 0;
    const firstCard = first ? {
      id: first.id,
      label: first.label,
      balance: first.balance,
      rate: first.rate,
      minimum: firstDebt && firstDebt.payment != null
        ? roundCent(firstDebt.payment) : null,
      extraThisPayday: roundCent(extraAmount),
    } : null;
    const otherCards = revolving
      .filter(row => !first || row.id !== first.id)
      .map(row => {
        const d = byId.get(row.id);
        return {
          id: row.id,
          label: row.label,
          balance: row.balance,
          rate: row.rate,
          minimum: d && d.payment != null ? roundCent(d.payment) : null,
        };
      });
    return { firstCard, otherCards };
  }

  function bigPurchasesGlance(plans, alloc, range) {
    const byId = new Map();
    for (const row of (alloc && alloc.futureCosts) || []) {
      if (row && row.id) byId.set(row.id, row);
    }
    return (plans || [])
      .filter(row => {
        if (!row || row.flexibility === 'optional') return false;
        if (!range) return true;
        if (!row.date) return false;
        return row.date >= range.start && row.date <= range.end;
      })
      .map(row => {
        const payday = byId.get(row.id);
        return {
          id: row.id,
          label: row.label,
          date: row.date || null,
          when: row.when || null,
          cost: row.need != null ? roundCent(row.need) : null,
          savedSoFar: 0,
          setAsideThisPayday: payday && payday.allocated != null
            ? roundCent(payday.allocated) : 0,
        };
      });
  }

  // Presentation leftover after the default-view consuming blocks, from
  // already-allocated paydayAllocation amounts. Does not re-run the
  // waterfall or flip leftover math. Protected-path cash stays inside
  // leftover because that block is not on the default view.
  function runningLeftoverFromAlloc(available, allocatedObligations, allocatedEssentials,
      allocatedExtraDebt, futureTaken) {
    const currentBalance = roundCent(available);
    const afterBills = roundCent(currentBalance - (Number(allocatedObligations) || 0));
    const afterHouseholdBudget = roundCent(afterBills - (Number(allocatedEssentials) || 0));
    const afterDebtRepayment = roundCent(afterHouseholdBudget - (Number(allocatedExtraDebt) || 0));
    const afterBigPurchases = roundCent(afterDebtRepayment - (Number(futureTaken) || 0));
    return {
      currentBalance,
      afterBills,
      afterHouseholdBudget,
      afterDebtRepayment,
      afterBigPurchases,
    };
  }

  // Start-of-day cash the existing walk already produced. First simulated
  // day uses that week's opening (cash before that day's events). Later
  // days use the previous close. Null when the walk does not cover the
  // date — callers must not invent a second cash engine.
  function startOfDayCash(sim, date) {
    if (!sim || !date || !Array.isArray(sim.daily)) return null;
    const idx = sim.daily.findIndex(d => d.date === date);
    if (idx < 0) return null;
    if (idx === 0) {
      const week = (sim.weeks || []).find(w => w && w.start === date);
      if (week && week.opening != null && isFinite(Number(week.opening))) {
        return roundCent(week.opening);
      }
      return null;
    }
    const prev = sim.daily[idx - 1];
    if (!prev || prev.balance == null || !isFinite(Number(prev.balance))) return null;
    return roundCent(prev.balance);
  }

  function incomeOnDate(plan, date, opts) {
    if (!date) return 0;
    const events = expandEvents(plan, date, date, opts);
    let sum = 0;
    for (const e of events || []) {
      if (!e || e.kind !== 'income' || e.date !== date) continue;
      if (e.amount > EPSILON) sum += e.amount;
    }
    return roundCent(sum);
  }

  function unpaidJointCashInRange(plan, start, end, opts) {
    if (!start || !end) return 0;
    const events = expandEvents(plan, start, end, opts);
    const skipOnce = onceBillIdsBeforePayday(plan, start);
    let sum = 0;
    for (const e of events || []) {
      if (!e || !e.date || e.date < start || e.date > end) continue;
      if (!isJointCashOutflow(e) && !e.cardPaid) continue;
      if (e.kind !== 'obligation' && e.kind !== 'bill' && e.kind !== 'commitment') continue;
      if (e.id && skipOnce.has(e.id)) continue;
      const amt = -e.amount;
      if (amt > EPSILON) sum += amt;
    }
    return roundCent(sum);
  }

  // Planned bills and inflows for a span Forecast already owns. Settlement
  // is judged against the live as-of, so a future span is still due / in.
  // Date-clipped so a carried once stub cannot appear as that span's bill.
  function layoutGlanceFrom(plan, start, end, asOf, opts) {
    const represented = representedKeySet(plan, opts, asOf);
    const observed = representedActualMap(opts);
    const events = expandEvents(plan, start, end,
      Object.assign({}, opts || {}, { keepRepresented: true }));
    const skipOnce = onceBillIdsBeforePayday(plan, start);
    const items = [];
    const seen = new Set();
    const push = row => {
      if (!row) return;
      const key = (row.id || row.label || '') + '@' + (row.date || '');
      if (seen.has(key)) return;
      seen.add(key);
      items.push(row);
    };
    for (const e of events || []) {
      if (!e || !e.date || e.date < start || e.date > end) continue;
      if (e.kind === 'income') {
        const amt = e.amount;
        if (!(amt > EPSILON)) continue;
        const paid = !!(e.id && represented.has(e.id + '@' + e.date));
        const actual = paid ? observedActual(observed, e.id, e.date) : null;
        const raw = actual != null ? actual : amt;
        push({
          id: e.id,
          label: e.label,
          kind: 'income',
          date: e.date,
          planned: roundCent(amt),
          actual,
          remaining: paid ? 0 : roundCent(amt),
          settlement: paid ? 'represented' : paydaySettlementState(e.date, asOf),
          status: 'in',
          glanceKind: 'in',
          movement: householdMovement(raw, 'in'),
          confidence: e.confidence || null,
        });
        continue;
      }
      if (!isJointCashOutflow(e) && !e.cardPaid) continue;
      if (e.kind !== 'obligation' && e.kind !== 'bill' && e.kind !== 'commitment') continue;
      if (e.id && skipOnce.has(e.id)) continue;
      const amt = -e.amount;
      if (!(amt > EPSILON)) continue;
      const paid = !!(e.id && represented.has(e.id + '@' + e.date));
      let settlement;
      let actual;
      let remaining;
      if (paid) {
        settlement = 'represented';
        actual = observedActual(observed, e.id, e.date);
        remaining = 0;
      } else if (e.date >= asOf) {
        settlement = 'upcoming';
        actual = 0;
        remaining = roundCent(amt);
      } else {
        settlement = 'unverified';
        actual = null;
        remaining = roundCent(amt);
      }
      const raw = paid && actual != null ? actual : (remaining != null ? remaining : amt);
      const status = glanceBillStatus(settlement, asOf, e.date);
      push({
        id: e.id,
        label: e.label,
        kind: e.kind,
        date: e.date,
        planned: roundCent(amt),
        actual,
        remaining,
        settlement,
        status,
        glanceKind: status === 'PAID' ? 'paid' : 'still-due',
        movement: householdMovement(raw, 'out'),
        confidence: e.confidence || null,
      });
    }
    items.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.label || '').localeCompare(String(b.label || '')));
    return items;
  }

  function seaspanPaydaysInSpan(plan, start, end) {
    const from = financialDate(start);
    const to = financialDate(end);
    if (!from || !to) return [];
    const stream = seaspanPayroll(plan);
    const anchor = stream && financialDate(stream.anchor);
    if (!anchor) return [];
    return biweeklyDates(anchor, from, to);
  }

  // Owner payday cadence. Absent/unknown stays every Seaspan payday — the
  // incumbent plannedPayday meaning. first-seaspan-of-month assigns the
  // payday amount to the earliest Seaspan pay-period start in that
  // YYYY-MM only. Year is part of the month identity.
  const FIRST_SEASPAN_OF_MONTH = 'first-seaspan-of-month';
  function paydayCadence(cat) {
    return cat && typeof cat.paydayCadence === 'string' ? cat.paydayCadence : null;
  }
  function isFirstSeaspanOfMonthCadence(cat) {
    return paydayCadence(cat) === FIRST_SEASPAN_OF_MONTH;
  }
  function calendarMonthBounds(iso) {
    const day = financialDate(iso);
    if (!day) return null;
    const [y, m] = day.split('-').map(Number);
    if (!y || !m) return null;
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = `${y}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
    return { start, end };
  }
  function firstSeaspanPaydayInCalendarMonth(plan, iso) {
    const month = calendarMonthBounds(iso);
    if (!month) return null;
    const dates = seaspanPaydaysInSpan(plan, month.start, month.end);
    return dates.length ? dates[0] : null;
  }
  function isFirstSeaspanPaydayOfCalendarMonth(plan, iso) {
    const day = financialDate(iso);
    const first = firstSeaspanPaydayInCalendarMonth(plan, day);
    return !!(day && first && day === first);
  }

  // Discrete payday targets are whole-or-not-applicable. A 7-day week
  // never receives half of $100. Missing dates on a non-14-day span
  // omit the row rather than inventing a prorated half-target.
  // first-seaspan-of-month counts only the earliest Seaspan start in
  // each calendar month, so a later payday week does not hold another
  // $100 obligation.
  function paydayHoldForSpan(cat, plan, days, start, end) {
    if (!cat || cat.plannedPayday == null) return null;
    const payday = roundCent(Number(cat.plannedPayday) || 0);
    if (start && end) {
      const dates = seaspanPaydaysInSpan(plan, start, end);
      const n = isFirstSeaspanOfMonthCadence(cat)
        ? dates.filter(d => isFirstSeaspanPaydayOfCalendarMonth(plan, d)).length
        : dates.length;
      return n > 0 ? roundCent(payday * n) : null;
    }
    const d = Math.max(0, Number(days) || 0);
    if (isFirstSeaspanOfMonthCadence(cat)) return null;
    return d === 14 ? payday : null;
  }

  function householdBudgetScaled(plan, days, spanStart, spanEnd) {
    const scale = Math.max(0, Number(days) || 0) / CALENDAR_MONTH_DAYS;
    const items = [];
    for (const cat of (plan && plan.budget && plan.budget.categories) || []) {
      if (!cat || DEFAULT_VIEW_BUDGET_IDS.indexOf(cat.id) < 0) continue;
      const weekly = cat.plannedWeekly != null ? Number(cat.plannedWeekly) : null;
      const monthly = ownerTargetMonthly(cat);
      if (weekly != null) {
        items.push({
          id: cat.id,
          label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
          amount: roundCent(weekly * Math.max(0, Number(days) || 0) / 7),
          monthly,
          inEssentialHold: false,
        });
        continue;
      }
      if (cat.plannedPayday != null) {
        const amount = paydayHoldForSpan(cat, plan, days, spanStart, spanEnd);
        if (amount == null) continue;
        items.push({
          id: cat.id,
          label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
          amount,
          monthly,
          inEssentialHold: false,
        });
        continue;
      }
      if (monthly == null || monthly === 0) continue;
      items.push({
        id: cat.id,
        label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
        amount: roundCent(monthly * scale),
        monthly,
        inEssentialHold: false,
      });
    }
    return items;
  }

  // Owner-target hold for a named span. Weekly targets use days/7.
  // Payday targets are whole-or-not-applicable on the Seaspan dates in
  // the span. Monthly targets use days / calendar month. Not leftover
  // remaining-cap, not a second budget engine.
  function ownerTargetHoldForSpan(plan, days, spanStart, spanEnd) {
    const scale = Math.max(0, Number(days) || 0) / CALENDAR_MONTH_DAYS;
    const items = [];
    for (const cat of (plan && plan.budget && plan.budget.categories) || []) {
      if (!cat || !cat.id) continue;
      const weekly = cat.plannedWeekly != null ? Number(cat.plannedWeekly) : null;
      const monthly = ownerTargetMonthly(cat);
      if (weekly != null) {
        items.push({
          id: cat.id,
          label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
          monthly,
          planned: roundCent(weekly * Math.max(0, Number(days) || 0) / 7),
        });
        continue;
      }
      if (cat.plannedPayday != null) {
        const planned = paydayHoldForSpan(cat, plan, days, spanStart, spanEnd);
        if (planned == null) continue;
        items.push({
          id: cat.id,
          label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
          monthly,
          planned,
        });
        continue;
      }
      if (monthly == null || monthly === 0) continue;
      items.push({
        id: cat.id,
        label: DEFAULT_VIEW_BUDGET_LABELS[cat.id] || cat.ownerLine || cat.label,
        monthly,
        planned: roundCent(monthly * scale),
      });
    }
    return items;
  }

  // Planned vs spent for the selected Plan span. Spent is classified live
  // overlay actuals in that span. Planned is the owner-target hold for the
  // same days. Remaining-cap / leftover is not published here.
  function householdBudgetDigest(plan, asOf, spanStart, spanEnd, opts) {
    opts = opts || {};
    const start = spanStart || null;
    const end = spanEnd || null;
    const days = start && end ? Math.max(1, diffDays(start, end) + 1) : 0;
    const coverageOrigin = start && asOf && start <= asOf ? start : asOf;
    const coverage = actualsCoverageState(asOf, coverageOrigin, opts);
    const useActuals = coverage.remainingClaim === 'precise'
      || coverage.remainingClaim === 'posted-only';
    const through = end && asOf && end < asOf ? end : asOf;
    const actuals = useActuals
      ? sumCategoryActuals(plan, through, start, opts)
      : emptyCategoryActuals();
    const namedClaim = categoryRemainingClaimFrom(
      coverage.remainingClaim, actuals.unclassified);
    const historyAsOf = opts.periods && opts.periods.asOf ? opts.periods.asOf : null;
    const historyStale = !!(historyAsOf && asOf && historyAsOf < asOf);
    const rows = ownerTargetHoldForSpan(plan, days, start, end).map(row => {
      const act = categoryCommittedActual(actuals.byId.get(row.id));
      return {
        id: row.id,
        label: row.label,
        planned: row.planned,
        spent: useActuals ? act.committed : null,
      };
    });
    return {
      periodStart: start,
      periodEnd: end,
      spentReady: useActuals,
      actualsIncomplete: !useActuals || namedClaim !== 'precise',
      historyThrough: historyStale ? historyAsOf : null,
      rows,
    };
  }

  function budgetAmountTotal(rows) {
    return roundCent((rows || []).reduce((s, r) => s + (Number(r && r.amount) || 0), 0));
  }

  function layoutViewFrom(plan, asOf, debts, leftover, bills, householdBudget,
      extraDebt, plans, copy, purchaseRange, opts) {
    const cards = revolvingCardsGlance(plan, debts, extraDebt);
    return {
      asOf: copy.asOf || asOf,
      span: copy.span,
      title: copy.title,
      billsHeading: copy.billsHeading,
      extraLabel: copy.extraLabel,
      cashNote: copy.cashNote || null,
      periodStart: copy.periodStart || null,
      periodEnd: copy.periodEnd || null,
      currentBalance: leftover.currentBalance,
      afterBills: leftover.afterBills,
      afterHouseholdBudget: leftover.afterHouseholdBudget,
      afterDebtRepayment: leftover.afterDebtRepayment,
      afterBigPurchases: leftover.afterBigPurchases,
      bills: bills || [],
      householdBudget: householdBudget || [],
      budgetDigest: householdBudgetDigest(
        plan, asOf, copy.periodStart, copy.periodEnd, opts),
      firstCard: cards.firstCard,
      otherCards: cards.otherCards,
      bigPurchases: bigPurchasesGlance(plans, extraDebt, purchaseRange),
    };
  }

  const BILLS_ACCOUNT_ID = 'chequing-a';
  const BILLS_ACCOUNT_LABEL = 'BILLS ACCOUNT (Chequing A)';

  function plannedPayerLabel(payingAccount) {
    if (payingAccount === BILLS_ACCOUNT_ID) return BILLS_ACCOUNT_LABEL;
    return null;
  }

  // Calendar-month span for snapshot-month reconstruction of already-paid
  // card minimums. Not the household operating Pay Period definition.
  function calendarMonthSpan(iso) {
    if (!iso || !ISO_CALENDAR_DATE.test(String(iso))) return null;
    const [y, m] = String(iso).split('-').map(Number);
    const last = daysInMonth(y, m);
    const pad = n => String(n).padStart(2, '0');
    return {
      start: `${y}-${pad(m)}-01`,
      mid: `${y}-${pad(m)}-15`,
      secondStart: `${y}-${pad(m)}-16`,
      end: `${y}-${pad(m)}-${pad(last)}`,
      last,
    };
  }

  // Calendar-month half (1st–15th vs 16th–end). Not the household operating
  // Pay Period. Retained for non-operating calendar-month reporting.
  function billCalendarHalf(iso) {
    if (!iso || !ISO_CALENDAR_DATE.test(String(iso))) return null;
    const day = Number(String(iso).slice(8, 10));
    if (!(day >= 1)) return null;
    return day <= 15 ? 1 : 2;
  }

  function planCashRowById(plan, id) {
    if (!id) return null;
    const bill = ((plan && plan.bills) || []).find(b => b && b.id === id);
    if (bill) return bill;
    return ((plan && plan.obligations) || []).find(o => o && o.id === id) || null;
  }

  // Once-rows that reserve a skipped monthly occurrence keep the posting
  // window on `date`. Payday operating windows use that monthly `day` as
  // the scheduled due, not the window date and not the bank post date.
  function monthlyCadenceSibling(plan, row) {
    if (!row || row.frequency !== 'once' || !row.id) return null;
    const recs = ((plan && plan.bills) || []).concat((plan && plan.obligations) || []);
    let best = null;
    for (const rec of recs) {
      if (!rec || !rec.id || rec.frequency === 'once' || rec.day == null) continue;
      if (row.id === rec.id) continue;
      if (row.id.startsWith(rec.id + '-')
          && (!best || rec.id.length > best.id.length)) best = rec;
    }
    return best;
  }

  function calendarBillScheduleDate(plan, event) {
    if (!event || !event.date) return event && event.date || null;
    const row = planCashRowById(plan, event.id);
    if (!row || row.frequency !== 'once') return event.date;
    const sibling = monthlyCadenceSibling(plan, row);
    if (!sibling || sibling.day == null) return event.date;
    const [y, m, postedDay] = String(event.date).split('-').map(Number);
    if (!(y > 0) || !(m >= 1) || !(postedDay >= 1)) return event.date;
    const dueDay = Number(sibling.day);
    if (!(dueDay >= 1)) return event.date;
    let year = y;
    let month = m;
    if (postedDay < dueDay) {
      month -= 1;
      if (month < 1) { month = 12; year -= 1; }
    }
    const d = Math.min(dueDay, daysInMonth(year, month));
    return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function cashSnapshotDate(plan, asOf) {
    const opening = plan && plan.opening;
    if (opening && opening.asOf && ISO_CALENDAR_DATE.test(String(opening.asOf))) {
      return opening.asOf;
    }
    return asOf;
  }

  // Live overlay advanced as-of past the dated opening. That later cash is
  // today's live Current Balance, not a reconstructed payday-morning opening.
  function liveOpeningAdvanced(plan, asOf) {
    const opening = plan && plan.opening;
    return !!(opening && opening.asOf === asOf && opening.priorAsOf && opening.priorAsOf < asOf);
  }

  // Optional payday-morning snapshot on the incumbent opening. periodStart
  // and asOf must be that payday; a mid-period cash figure is not accepted.
  function finiteRecordedOpening(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string' && value.trim() !== '') {
      return Number.isFinite(Number(value));
    }
    return false;
  }

  function paydaySnapshotRecord(plan, opts, periodStart) {
    const snap = (opts && opts.paydaySnapshot)
      || (plan && plan.opening && plan.opening.paydaySnapshot)
      || null;
    if (!snap || !periodStart) return null;
    if (String(snap.periodStart) !== String(periodStart)) return null;
    if (String(snap.asOf) !== String(periodStart)) return null;
    // Number(null) and Number('') are 0. A missing opening is not $0.
    if (!finiteRecordedOpening(snap.opening)) return null;
    return {
      periodStart: String(snap.periodStart),
      asOf: String(snap.asOf),
      opening: roundCent(snap.opening),
    };
  }

  // Income already inside the payday-opening cash, not income already
  // inside today's live bank balance. Received-vs-live is settlement
  // status; it must not erase a pay-period income row from the snapshot.
  // A recorded paydaySnapshot's opening is that frozen morning figure.
  // Live overlay representedEvents prove settlement against today's
  // cash and must not treat snapshot-period income as already inside
  // that recorded opening.
  function incomeAlreadyInPaydayOpening(row, openingAsOf, plan, opts, openingSource) {
    if (!row || !openingAsOf) return false;
    if (row.notReliedUpon === true || row.settlement === 'not-relied-upon') return false;
    if (row.date && row.date < openingAsOf) return true;
    if (row.date === openingAsOf) {
      if (openingSource === 'snapshot') return false;
      const represented = representedKeySet(plan, opts, openingAsOf);
      const key = (row.id || '') + '@' + row.date;
      if (row.id && represented.has(key)) return true;
      if (recurringInsideOpening(plan, { id: row.id, date: row.date }, openingAsOf)) {
        return true;
      }
    }
    return false;
  }

  // Explicit complete household-cash evidence for (openingAsOf, morningDate).
  // complete:true without coverage of every gap day is not completeness.
  // A scheduled-only plan walk is not completeness: unscheduled groceries,
  // fuel, restaurants, or transfers in that gap would still be assumed zero.
  function paydayGapCashPacket(opts) {
    const packet = opts && opts.paydayGapCash;
    return packet && typeof packet === 'object' ? packet : null;
  }

  function paydayGapCashComplete(plan, morningDate, opts) {
    const packet = paydayGapCashPacket(opts);
    if (!packet || packet.complete !== true) return false;
    if (!Array.isArray(packet.movements)) return false;
    const openingAsOf = plan && plan.opening && plan.opening.asOf;
    if (!openingAsOf || !morningDate) return false;
    if (String(openingAsOf) === String(morningDate)) return true;
    const firstGapDay = addDays(openingAsOf, 1);
    const lastGapDay = addDays(morningDate, -1);
    if (!firstGapDay || !lastGapDay) return false;
    if (String(lastGapDay) < String(firstGapDay)) return true;
    const covStart = packet.coverageStart;
    const covThrough = packet.coverageThrough;
    if (!covStart || !covThrough) return false;
    if (String(covStart) > String(firstGapDay)) return false;
    if (String(covThrough) < String(lastGapDay)) return false;
    return true;
  }

  function gapMovementAffectsJointCash(mov) {
    if (!mov) return false;
    if (mov.jointCash === false || mov.kind === 'noncash') return false;
    if (mov.accountRole && String(mov.accountRole) !== 'household-cash') return false;
    return true;
  }

  // Trusted dated opening plus every household-cash movement in the gap,
  // only when that interval is completeness-proven. Not live cash walked
  // backward, not weekly-variable spend, not reserved-daily drain, and
  // not scheduled income/outflows with unscheduled spending assumed zero.
  function completeCashAtMorning(plan, morningDate, opts) {
    if (!plan || !morningDate) return null;
    const openingAsOf = plan.opening && plan.opening.asOf;
    if (!openingAsOf || openingAsOf > morningDate) return null;
    const openingCash = startingCashAmount(plan);
    if (!Number.isFinite(Number(openingCash))) return null;
    if (openingAsOf === morningDate) return roundCent(openingCash);
    if (!paydayGapCashComplete(plan, morningDate, opts)) return null;
    const packet = paydayGapCashPacket(opts);
    let balance = roundCent(openingCash);
    for (const mov of packet.movements) {
      if (!mov || !mov.date) continue;
      if (String(mov.date) <= String(openingAsOf)
          || String(mov.date) >= String(morningDate)) {
        continue;
      }
      if (!gapMovementAffectsJointCash(mov)) continue;
      const amt = Number(mov.amount);
      if (!Number.isFinite(amt)) return null;
      balance = roundCent(balance + amt);
    }
    return balance;
  }

  // Establish or reuse the frozen payday-morning figure. A recorded
  // matching snapshot wins. Otherwise the last trusted dated opening
  // whose starting cash still belongs to that opening (not a
  // live-advanced mid-period overlay) may walk to that payday morning
  // only when the gap is complete enough to reconcile every
  // household-cash movement that can change that balance. Live
  // mid-period cash never substitutes. Null when completeness cannot
  // be proven.
  function establishPaydaySnapshot(plan, paydayDate, opts) {
    const existing = paydaySnapshotRecord(plan, opts, paydayDate);
    if (existing) return existing;
    if (!plan || !paydayDate) return null;
    const openingAsOf = plan.opening && plan.opening.asOf;
    if (!openingAsOf) return null;
    if (liveOpeningAdvanced(plan, openingAsOf)) return null;
    if (openingAsOf > paydayDate) return null;
    const opening = completeCashAtMorning(plan, paydayDate, opts);
    if (!finiteRecordedOpening(opening)) return null;
    return {
      periodStart: String(paydayDate),
      asOf: String(paydayDate),
      opening: roundCent(opening),
    };
  }

  // Payday-snapshot opening. Distinct from live Current Balance
  // (startingCashAmount / paydayAllocation.opening). Fail closed rather
  // than invent a historical payday-morning cash Atlas never recorded.
  function resolvePaydayPeriodOpening(plan, asOf, window, opts, previousEnding, sim) {
    const role = window && window.role;
    if (role === 'future') {
      if (previousEnding != null && Number.isFinite(Number(previousEnding))) {
        return {
          opening: roundCent(previousEnding),
          openingKnown: true,
          openingAsOf: window.start,
          source: 'carry-forward',
        };
      }
      const projected = startOfDayCash(sim, window.start);
      if (projected != null && Number.isFinite(Number(projected))) {
        return {
          opening: roundCent(projected),
          openingKnown: true,
          openingAsOf: window.start,
          source: 'cutover-walk',
        };
      }
      return { opening: null, openingKnown: false, openingAsOf: null, source: null };
    }
    if (role !== 'active') {
      return { opening: null, openingKnown: false, openingAsOf: null, source: null };
    }
    const snap = paydaySnapshotRecord(plan, opts, window.start);
    if (snap) {
      return {
        opening: snap.opening,
        openingKnown: true,
        openingAsOf: snap.asOf,
        source: 'snapshot',
      };
    }
    // Same calendar date is not payday-morning cash once live overlay has
    // already advanced the opening. Prefer a recorded snapshot above; without
    // one, fail closed rather than freezing post-event live cash.
    if (asOf === window.start && !liveOpeningAdvanced(plan, asOf)) {
      return {
        opening: roundCent(startingCashAmount(plan)),
        openingKnown: true,
        openingAsOf: asOf,
        source: 'payday-morning',
      };
    }
    if (!liveOpeningAdvanced(plan, asOf) && plan && plan.opening && plan.opening.asOf === asOf) {
      return {
        opening: roundCent(startingCashAmount(plan)),
        openingKnown: true,
        openingAsOf: asOf,
        source: 'cutover-opening',
      };
    }
    // Dated opening still owns starting cash and predates this payday:
    // Forecast walks only a completeness-proven household-cash gap.
    // Scheduled-only reconstruction is not completeness. Live overlay
    // that already replaced starting cash cannot use this path.
    if (!liveOpeningAdvanced(plan, asOf)) {
      const established = establishPaydaySnapshot(plan, window.start, opts);
      if (established) {
        return {
          opening: established.opening,
          openingKnown: true,
          openingAsOf: established.asOf,
          source: 'cutover-walk',
        };
      }
    }
    return { opening: null, openingKnown: false, openingAsOf: null, source: null };
  }

  function rowIsOnceItem(plan, id) {
    if (!id) return false;
    const bill = ((plan && plan.bills) || []).find(b => b && b.id === id);
    if (bill && bill.frequency === 'once') return true;
    const obl = ((plan && plan.obligations) || []).find(o => o && o.id === id);
    return !!(obl && obl.frequency === 'once');
  }

  function recurringInsideOpening(plan, event, cashAsOf) {
    if (!event || !event.date || !cashAsOf || event.date >= cashAsOf) return false;
    if (event.kind === 'income') {
      const stream = ((plan && plan.income) || []).find(s => s && s.id === event.id);
      return !!(stream && stream.frequency !== 'once');
    }
    return !rowIsOnceItem(plan, event.id);
  }

  function calendarBillRowFromEvent(plan, event, asOf, represented, observed, cashAsOf, scheduleDate) {
    const amt = -event.amount;
    if (!(amt > EPSILON)) return null;
    const paid = !!(event.id && represented.has(event.id + '@' + event.date));
    const inside = recurringInsideOpening(plan, event, cashAsOf);
    const due = scheduleDate || event.date;
    let settlement;
    let actual;
    let remaining;
    if (paid) {
      settlement = 'represented';
      actual = observedActual(observed, event.id, event.date);
      remaining = 0;
    } else if (inside) {
      settlement = 'opening';
      actual = null;
      remaining = 0;
    } else if (due >= asOf) {
      settlement = 'upcoming';
      actual = 0;
      remaining = roundCent(amt);
    } else {
      settlement = 'unverified';
      actual = null;
      remaining = roundCent(amt);
    }
    const display = paid && actual != null ? Math.abs(Number(actual)) : amt;
    const status = (paid || inside)
      ? 'PAID'
      : glanceBillStatus(settlement, asOf, due);
    const payingAccount = event.payingAccount || null;
    return {
      id: event.id,
      label: event.label,
      kind: event.kind,
      date: due,
      planned: roundCent(amt),
      amount: roundCent(amt),
      actual,
      remaining,
      settlement,
      status,
      cardPaid: event.cardPaid === true,
      glanceKind: status === 'PAID' ? 'paid' : 'still-due',
      movement: householdMovement(display, 'out'),
      confidence: event.confidence || null,
      payingAccount,
      payerLabel: plannedPayerLabel(payingAccount),
      needsDate: false,
      cardPaid: event.cardPaid === true,
    };
  }

  function calendarBillSections(plan, asOf, opts) {
    opts = opts || {};
    const windows = opts.periodWindows || operatingPayPeriodWindows(plan, asOf);
    const span = coveringSpan(windows);
    if (!span) {
      return { billSections: [], bills: [], undatedBills: [] };
    }
    const represented = representedKeySet(plan, opts, asOf);
    const observed = representedActualMap(opts);
    const cashAsOf = cashSnapshotDate(plan, asOf);
    const events = expandEvents(plan, span.start, span.end,
      Object.assign({}, opts, { keepRepresented: true }));
    const seen = new Set();
    const buckets = {};
    for (let i = 0; i < windows.length; i++) {
      buckets[windows[i].id] = [];
    }
    const pushRow = (due, row, hostWindow) => {
      const window = hostWindow || windowContainingDate(windows, due);
      if (!window || !row) return;
      buckets[window.id].push(row);
    };
    const activeWindow = windows.find(w => w && w.role === 'active') || windows[0];
    for (const event of events || []) {
      if (!event || !event.date) continue;
      if (event.kind === 'income' || event.kind === 'noncash') continue;
      if (event.kind !== 'obligation' && event.kind !== 'bill') continue;
      if (event.kind === 'obligation' && event.effect === 'capitalise') continue;
      if (event.jointCash === false && !event.cardPaid) continue;
      // expandEvents may carry an unpaid once row into a later window.
      // Printed payday windows use the scheduled due, not the posting-window
      // date, so a 15 August bill reserved on the 16th stays on 15 August.
      const scheduleDate = calendarBillScheduleDate(plan, event);
      const due = scheduleDate || event.date;
      if (!due || due > span.end) continue;
      const overdueOnce = due < span.start
        && carriedOnceJointCashOutflow(plan, event.id, event.date, span.start);
      const paid = !!(event.id && represented.has(event.id + '@' + event.date));
      // Passing payday does not drop an unresolved once cash obligation, and
      // does not rewrite its due date onto the new payday. Represented /
      // settled once rows disappear rather than remaining reserved.
      if (due < span.start && !overdueOnce) continue;
      if (overdueOnce && paid) continue;
      const key = (event.id || event.label || '') + '@' + event.date;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = calendarBillRowFromEvent(
        plan, event, asOf, represented, observed, cashAsOf, due);
      if (overdueOnce) pushRow(due, row, activeWindow);
      else pushRow(due, row);
    }
    // Planned cash minimum for a capitalising obligation. Printed once on
    // the bills list; not a second expandEvents cash event and not a
    // second copy of the capitalise row.
    for (const o of (plan && plan.obligations) || []) {
      for (const occ of capitalisingCashMinimumOccurrences(o, span.start, span.end)) {
        const key = (o.id || o.cashLabel || '') + '@' + occ.date;
        if (seen.has(key)) continue;
        seen.add(key);
        const payingAccount = occ.payingAccount;
        pushRow(occ.date, {
          id: o.id,
          label: occ.label,
          kind: 'obligation',
          date: occ.date,
          planned: occ.amount,
          amount: occ.amount,
          actual: null,
          remaining: occ.amount,
          settlement: paydaySettlementState(occ.date, asOf),
          status: glanceBillStatus(paydaySettlementState(occ.date, asOf), asOf, occ.date),
          glanceKind: 'still-due',
          movement: householdMovement(occ.amount, 'out'),
          confidence: occ.confidence,
          payingAccount,
          payerLabel: plannedPayerLabel(payingAccount),
          needsDate: false,
          cashMinimum: true,
        });
      }
    }
    // Recurring card minimums firstDue skipped because they are already
    // inside the opening. Print once as PAID in the cash-snapshot month
    // only; leftover does not deduct them again. Gap months after that
    // snapshot and before firstDue stay empty (Cash Back firstDue
    // 2026-10-01 must not invent a September row). HELOC cash uses
    // cashFirstDue and is not reconstructed here.
    const openingAsOf = plan && plan.opening && plan.opening.asOf
      && ISO_CALENDAR_DATE.test(String(plan.opening.asOf))
      ? plan.opening.asOf : null;
    const snapMonth = openingAsOf ? calendarMonthSpan(openingAsOf) : calendarMonthSpan(cashAsOf);
    const debtDatesPrinted = new Set();
    for (let i = 0; i < windows.length; i++) {
      const rows = buckets[windows[i].id] || [];
      for (const row of rows) {
        if (!row) continue;
        if (row.id) debtDatesPrinted.add(row.id + '@' + row.date);
        const rec = ((plan.obligations || []).find(o => o && o.id === row.id))
          || ((plan.bills || []).find(b => b && b.id === row.id));
        if (rec && rec.debtId) debtDatesPrinted.add(rec.debtId + '@' + row.date);
      }
    }
    for (const o of (plan && plan.obligations) || []) {
      if (!o || o.nonCash || o.frequency !== 'monthly' || !o.debtId || o.day == null) {
        continue;
      }
      if (!o.firstDue) continue;
      if (!openingAsOf || !snapMonth) continue;
      const dates = monthlyDates(o.day, span.start, span.end, null);
      for (const date of dates) {
        if (date >= o.firstDue || date > asOf) continue;
        if (date < snapMonth.start || date > snapMonth.end) continue;
        if (date >= openingAsOf) continue;
        const key = (o.id || '') + '@' + date;
        if (seen.has(key)) continue;
        if (debtDatesPrinted.has(o.debtId + '@' + date)
          || debtDatesPrinted.has((o.id || '') + '@' + date)) continue;
        seen.add(key);
        const payingAccount = o.payingAccount || null;
        const amt = roundCent(Number(o.amount) || 0);
        if (!(amt > EPSILON)) continue;
        pushRow(date, {
          id: o.id,
          label: o.label,
          kind: 'obligation',
          date,
          planned: amt,
          amount: amt,
          actual: null,
          remaining: 0,
          settlement: 'opening',
          status: 'PAID',
          glanceKind: 'paid',
          movement: householdMovement(amt, 'out'),
          confidence: o.confidence || 'estimated',
          payingAccount,
          payerLabel: plannedPayerLabel(payingAccount),
          needsDate: false,
          settledInOpening: true,
        });
      }
    }
    const sortRows = rows => rows.sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.label || '').localeCompare(String(b.label || '')));
    const displayedBillAbs = r => {
      if (!r) return 0;
      if (r.movement != null && isFinite(Number(r.movement))) {
        return Math.abs(Number(r.movement));
      }
      if (r.status === 'PAID') {
        const raw = r.actual != null ? r.actual
          : (r.amount != null ? r.amount : r.planned);
        return Math.abs(Number(raw) || 0);
      }
      const raw = r.remaining != null ? r.remaining
        : (r.amount != null ? r.amount : r.planned);
      return Math.abs(Number(raw) || 0);
    };
    const sectionFor = window => {
      const rows = sortRows(buckets[window.id] || []);
      const total = roundCent(rows.reduce((s, r) => s + displayedBillAbs(r), 0));
      const remainingTotal = roundCent(rows.reduce((s, r) => {
        if (!r || r.status === 'PAID' || r.needsDate) return s;
        const raw = r.remaining != null ? Math.abs(Number(r.remaining))
          : Math.abs(Number(r.amount) || 0);
        return s + raw;
      }, 0));
      return {
        id: window.id,
        label: window.label,
        rangeLabel: window.rangeLabel || null,
        start: window.start,
        end: window.end,
        rows,
        total,
        remainingTotal,
      };
    };
    const billSections = windows.map(sectionFor);
    const undatedBills = [];
    for (const bill of (plan && plan.bills) || []) {
      if (!bill || !bill.needsDate) continue;
      if (!billIsHouseholdObligation(bill)) continue;
      const payingAccount = bill.payingAccount || null;
      undatedBills.push({
        id: bill.id,
        label: bill.label,
        kind: 'bill',
        date: null,
        planned: roundCent(Number(bill.amount) || 0),
        amount: roundCent(Number(bill.amount) || 0),
        actual: null,
        remaining: roundCent(Number(bill.amount) || 0),
        settlement: null,
        status: 'needs-date',
        glanceKind: 'still-due',
        movement: householdMovement(Number(bill.amount) || 0, 'out'),
        confidence: bill.confidence || 'estimated',
        payingAccount,
        payerLabel: plannedPayerLabel(payingAccount),
        needsDate: true,
        dateNote: 'needs confirmation',
      });
    }
    return {
      billSections,
      bills: billSections.reduce((all, sec) => all.concat(sec.rows || []), []),
      undatedBills,
    };
  }

  function calendarIncomeRowFromEvent(plan, event, asOf, represented, observed, cashAsOf, notRelied, opts) {
    const amt = event.amount;
    if (!(amt > EPSILON)) return null;
    const key = event.id + '@' + event.date;
    if (event.id && notRelied && notRelied.has(key)) {
      return {
        id: event.id,
        label: event.label,
        kind: 'income',
        date: event.date,
        planned: roundCent(amt),
        amount: roundCent(amt),
        actual: null,
        remaining: 0,
        settlement: 'not-relied-upon',
        status: 'unresolved',
        glanceKind: 'in',
        movement: householdMovement(amt, 'in'),
        confidence: event.confidence || null,
        alreadyInCash: false,
        notReliedUpon: true,
        notReliedUponReason: notReliedUponReason(plan, opts, event.id, event.date),
      };
    }
    const paid = !!(event.id && represented.has(key));
    const inside = recurringInsideOpening(plan, event, cashAsOf);
    const received = paid || inside || (event.date && cashAsOf && event.date < cashAsOf);
    return {
      id: event.id,
      label: event.label,
      kind: 'income',
      date: event.date,
      planned: roundCent(amt),
      amount: roundCent(amt),
      actual: paid ? observedActual(observed, event.id, event.date) : null,
      remaining: received ? 0 : roundCent(amt),
      settlement: paid ? 'represented' : (inside ? 'opening' : paydaySettlementState(event.date, asOf)),
      status: received ? 'received' : 'arriving',
      glanceKind: 'in',
      movement: householdMovement(amt, 'in'),
      confidence: event.confidence || null,
      alreadyInCash: received,
    };
  }

  function calendarIncomeSections(plan, asOf, windows, opts) {
    const span = coveringSpan(windows);
    if (!span) return {};
    const represented = representedKeySet(plan, opts, asOf);
    const notRelied = notReliedUponKeySet(plan, opts, asOf);
    const observed = representedActualMap(opts);
    const cashAsOf = cashSnapshotDate(plan, asOf);
    const events = expandEvents(plan, span.start, span.end,
      Object.assign({}, opts || {}, { keepRepresented: true }));
    const seen = new Set();
    const buckets = {};
    for (let i = 0; i < (windows || []).length; i++) {
      buckets[windows[i].id] = [];
    }
    const push = (window, row) => {
      if (!row || !window) return;
      const key = (row.id || row.label || '') + '@' + (row.date || '');
      if (seen.has(key)) return;
      seen.add(key);
      buckets[window.id].push(row);
    };
    for (const event of events || []) {
      if (!event || event.kind !== 'income' || !event.date) continue;
      if (event.date < span.start || event.date > span.end) continue;
      push(windowContainingDate(windows, event.date),
        calendarIncomeRowFromEvent(plan, event, asOf, represented, observed, cashAsOf, notRelied, opts));
    }
    for (const stream of (plan && plan.income) || []) {
      if (!stream || !stream.firstDue || stream.frequency !== 'monthly' || stream.day == null) {
        continue;
      }
      const dates = monthlyDates(stream.day, span.start, span.end, null);
      for (const date of dates) {
        if (date >= stream.firstDue || date > asOf) continue;
        const window = windowContainingDate(windows, date);
        if (!window) continue;
        const amt = roundCent(Number(streamAmount(stream, opts)) || Number(stream.amount) || 0);
        if (!(amt > EPSILON)) continue;
        push(window, {
          id: stream.id,
          label: stream.label,
          kind: 'income',
          date,
          planned: amt,
          amount: amt,
          actual: null,
          remaining: 0,
          settlement: 'opening',
          status: 'received',
          glanceKind: 'in',
          movement: householdMovement(amt, 'in'),
          confidence: stream.confidence || null,
          alreadyInCash: true,
        });
      }
    }
    const sortRows = rows => rows.sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || ''))
      || String(a.label || '').localeCompare(String(b.label || '')));
    const out = {};
    for (let i = 0; i < (windows || []).length; i++) {
      const id = windows[i].id;
      out[id] = sortRows(buckets[id] || []);
    }
    return out;
  }

  function calendarPeriodRole(asOfHalf, half) {
    if (!asOfHalf) return 'future';
    if (half < asOfHalf) return 'lookback';
    if (half === asOfHalf) return 'active';
    return 'future';
  }

  function ownerTargetMonthly(cat) {
    if (!cat) return null;
    if (cat.plannedWeekly != null) {
      return roundCent(Number(cat.plannedWeekly) * CALENDAR_MONTH_DAYS / 7);
    }
    if (cat.plannedPayday != null) {
      // Once-per-month payday assignment is $N per calendar month, not
      // $N annualized over 26 Seaspan cycles.
      if (isFirstSeaspanOfMonthCadence(cat)) {
        return roundCent(Number(cat.plannedPayday) || 0);
      }
      return roundCent(Number(cat.plannedPayday) * CALENDAR_MONTH_DAYS / 14);
    }
    if (cat.plannedMonthly != null) return roundCent(Number(cat.plannedMonthly) || 0);
    return null;
  }

  // 14-day Seaspan-cycle planned amount from the declared cadence. Monthly
  // targets use the same calendar month as ownerTargetMonthly
  // (365.25/12), not monthly/2. Halving would make $300/month × 26 =
  // $3,900/year instead of $3,600. first-seaspan-of-month uses the
  // cycle start against Forecast's Seaspan payday schedule: $N on the
  // earliest start in that YYYY-MM, else $0. Missing cycle identity
  // fails closed at $0 rather than inventing a second monthly copy.
  function paydayCyclePlanned(cat, cycleStart, plan) {
    if (!cat) return null;
    if (cat.plannedWeekly != null) return roundCent(Number(cat.plannedWeekly) * 2);
    if (cat.plannedPayday != null) {
      const payday = roundCent(Number(cat.plannedPayday) || 0);
      if (isFirstSeaspanOfMonthCadence(cat)) {
        if (!cycleStart || !plan) return 0;
        return isFirstSeaspanPaydayOfCalendarMonth(plan, cycleStart) ? payday : 0;
      }
      return payday;
    }
    if (cat.plannedMonthly != null) {
      const monthly = Number(cat.plannedMonthly) || 0;
      // An explicit $0 monthly owner target is a planning baseline of
      // zero — historical actuals do not re-enter required essentials.
      // It is not a payday-cycle hold, so the payday sheet omits the
      // row rather than printing $0.
      if (monthly === 0) return null;
      return roundCent(monthly * 14 / CALENDAR_MONTH_DAYS);
    }
    return null;
  }

  function calendarHalfThrough(asOf, end) {
    if (end && asOf) return asOf < end ? asOf : end;
    return end || asOf || null;
  }

  function evidenceBlob(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
      return value.map(item => {
        if (item == null) return '';
        if (typeof item === 'string' || typeof item === 'number') return String(item);
        return String(item.name || item.label || item.id || '');
      }).join(' ');
    }
    if (typeof value === 'object') {
      return String(value.name || value.label || value.id || '');
    }
    return String(value);
  }

  function personalAccountText(tx) {
    if (!tx) return '';
    return [
      tx.atlasAccountId, tx.accountId, tx.account,
      tx.accountLabel, tx.accountName, tx.payerLabel,
    ].map(evidenceBlob).join(' ');
  }

  function isTennisIncomeAccount(text) {
    return /amanda-debt-payments|tennis\s*income/i.test(text || '');
  }

  function isWeeklySpendingAccount(text) {
    return /chequing-b|weekly\s*spending/i.test(text || '');
  }

  // Map a personal/shopping tx to Dale or Amanda only with account, payee,
  // note, or tag evidence, the Dale 2026-09-02 Cursor merchant identity,
  // or the Dale 2026-09-03 Amazon + travelvisa standing owner rule.
  // Chequing B / WEEKLY SPENDING is not Dale. TENNIS INCOME /
  // amanda-debt-payments is not guilt-free spending. Merchant + card is
  // not owner evidence except those exact standing rules. No evidence, or
  // both names, fails closed to unassigned. Cursor is never Amanda.
  // Amazon on MBNA or another card is not Amanda.
  function personalSpendOwner(tx) {
    if (!tx) return null;
    if (isDaleGuiltFreeMerchant(tx)) return 'dale';
    if (isAmandaAmazonTravelVisa(tx)) return 'amanda';
    if (tx.personalOwner === 'dale' || tx.personalOwner === 'amanda'
      || tx.personalOwner === 'excluded') {
      return tx.personalOwner;
    }
    const accountText = personalAccountText(tx);
    if (isTennisIncomeAccount(accountText)) return 'excluded';
    const accountEvidence = isWeeklySpendingAccount(accountText) ? '' : accountText;
    const blob = [
      accountEvidence,
      evidenceBlob(tx.displayedPayee),
      evidenceBlob(tx.originalMerchant),
      evidenceBlob(tx.payee),
      evidenceBlob(tx.note),
      evidenceBlob(tx.notes),
      evidenceBlob(tx.tags),
      evidenceBlob(tx.tag),
    ].join(' ');
    const dale = /\bdale\b/i.test(blob);
    const amanda = /\bamanda\b/i.test(blob);
    if (dale && amanda) return null;
    if (dale) return 'dale';
    if (amanda) return 'amanda';
    return null;
  }

  // Classify merchant-sensitive facts before publication. The served packet
  // still carries these flags instead of raw payee, notes, or tags. Sanitized
  // displayedPayee / originalMerchant may also travel as household-facing
  // merchant identity; they do not reclassify spend.
  function derivedTransactionFlags(tx) {
    const empty = {
      dogFood: false,
      convenienceStore: false,
      canadianTire: false,
      groceryUncertain: false,
      groceryMixed: false,
      merchantKnown: false,
      fuelEvidence: false,
      confirmedGrocery: false,
      confirmedFuel: false,
      daleGuiltFreeMerchant: false,
      amazonMerchant: false,
      cardPaymentIdentity: false,
      personalOwner: null,
    };
    if (!tx) return empty;
    const daleGuiltFreeMerchant = isDaleGuiltFreeMerchant(tx);
    const amazonMerchant = isAmazonMerchant(tx);
    const confirmedGrocery = isConfirmedGroceryMerchant(tx);
    const amandaAmazonTravelVisa = amazonMerchant && isTravelVisaAccount(tx);
    return {
      dogFood: isDogFoodMerchant(tx),
      convenienceStore: isConvenienceStoreMerchant(tx),
      canadianTire: isCanadianTireMerchant(tx),
      groceryUncertain: !confirmedGrocery && isUncertainGroceryMerchant(tx),
      groceryMixed: hasGroceryMixedEvidence(tx),
      merchantKnown: txHasMerchantIdentity(tx),
      fuelEvidence: hasExplicitFuelEvidence(tx),
      confirmedGrocery,
      confirmedFuel: isConfirmedFuelMerchant(tx),
      daleGuiltFreeMerchant,
      amazonMerchant,
      cardPaymentIdentity: isCanadianTireMastercardPayment(tx),
      personalOwner: daleGuiltFreeMerchant ? 'dale'
        : (amandaAmazonTravelVisa ? 'amanda' : personalSpendOwner(tx)),
    };
  }

  classifyCurrentPeriodTransaction.derivedFlags = derivedTransactionFlags;
  classifyCurrentPeriodTransaction.householdBudgetSupportingSpendEligible =
    householdBudgetSupportingSpendEligible;

  function reconIdentityField(value) {
    if (typeof value === 'number' && isFinite(value)) value = String(value);
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text || null;
  }

  function reconTxFrom(tx, cls, extra) {
    const pending = transactionPendingState(tx) === 'pending';
    const duplicate = extra && extra.pendingPostedDuplicate === true;
    return {
      id: tx.id || null,
      date: tx.date || null,
      account: tx.account || tx.atlasAccountId || null,
      amount: roundCent(Number(tx.amount) || 0),
      categoryLabel: tx.categoryLabel || null,
      displayedPayee: reconIdentityField(tx.displayedPayee),
      originalMerchant: reconIdentityField(tx.originalMerchant),
      atlasRow: (cls && (cls.atlasRow || cls.categoryId)) || null,
      includeReason: duplicate
        ? 'pending-posted-duplicate'
        : ((cls && (cls.includeReason || cls.reason)) || null),
      pending,
      pendingPostedDuplicate: duplicate,
    };
  }

  function calendarHouseholdBudget(plan, asOf, start, end, role, opts) {
    opts = opts || {};
    if (role === 'lookback') {
      return {
        items: [], hold: 0, spentReady: false,
        spendingCycle: null, cycleUnresolved: false,
      };
    }
    // Missing/malformed Seaspan must not invent a payday window or assign
    // transactions. Keep the payday-cycle planned reserve fail-closed.
    const unresolvedCycle = opts.unresolvedCycle === true;
    const cycle = unresolvedCycle
      ? null
      : (opts.cycle || spendingCycle(plan, role === 'future' && start ? start : asOf));
    const cycleResolved = !!(cycle && cycle.start);
    const useActuals = role === 'active' && cycleResolved;
    const coverageOrigin = cycle && cycle.start && asOf && cycle.start <= asOf
      ? cycle.start : asOf;
    const coverage = useActuals
      ? actualsCoverageState(asOf, coverageOrigin, opts)
      : { remainingClaim: 'unavailable' };
    const actualsReady = useActuals && (coverage.remainingClaim === 'precise'
      || coverage.remainingClaim === 'posted-only');
    const windowStart = cycle && cycle.start;
    const through = cycle && cycle.end && asOf && asOf < cycle.end ? asOf : (cycle && cycle.end);
    const packet = currentPeriodActualsPacket(opts);
    const classifyOpts = Object.assign({}, opts, { packet, currentPeriodActuals: packet });
    const duplicateIds = pendingPostedDuplicateIdSet(packet);
    const reconById = new Map();
    const confirmationRecon = [];
    let confirmationSpent = 0;
    if (actualsReady && windowStart && packet && Array.isArray(packet.transactions)) {
      for (const tx of packet.transactions) {
        if (!tx || !tx.date) continue;
        if (tx.date < windowStart) continue;
        if (through && tx.date > through) continue;
        if (skipSplitParent(tx, packet)) continue;
        const amt = Number(tx.amount);
        if (!isFinite(amt) || amt === 0) continue;
        const cls = classifyCurrentPeriodTransaction(tx, plan, classifyOpts);
        if (!householdBudgetSupportingSpendEligible(cls)) continue;
        const isDuplicate = tx.id != null && duplicateIds.has(String(tx.id));
        const row = reconTxFrom(tx, cls, { pendingPostedDuplicate: isDuplicate });
        if (cls.needsConfirmation || cls.kind === 'unclassified') {
          confirmationRecon.push(row);
          confirmationSpent = roundCent(
            confirmationSpent + confirmedHouseholdAmount(tx, duplicateIds)
          );
          continue;
        }
        const catId = cls.atlasRow || cls.categoryId;
        if (catId && CALENDAR_PERIOD_BUDGET_IDS.indexOf(catId) >= 0) {
          if (!reconById.has(catId)) reconById.set(catId, []);
          reconById.get(catId).push(row);
        }
      }
    }
    const spentFromRecon = list => roundCent((list || []).reduce((s, r) => {
      if (r && r.pendingPostedDuplicate === true && r.pending === true) return s;
      return s + (Number(r && r.amount) || 0);
    }, 0));
    const byId = new Map();
    for (const cat of (plan && plan.budget && plan.budget.categories) || []) {
      if (cat && cat.id) byId.set(cat.id, cat);
    }
    const items = [];
    for (const id of CALENDAR_PERIOD_BUDGET_IDS) {
      const cat = byId.get(id);
      if (!cat) continue;
      const planned = paydayCyclePlanned(cat, windowStart, plan);
      if (planned == null) continue;
      const weekly = cat.plannedWeekly != null ? roundCent(Number(cat.plannedWeekly)) : null;
      const recon = reconById.get(id) || [];
      const spent = actualsReady ? spentFromRecon(recon) : null;
      const remaining = spent != null ? roundCent(planned - spent) : planned;
      const pendingRecon = recon.filter(r => r.pending === true);
      items.push({
        id,
        label: DEFAULT_VIEW_BUDGET_LABELS[id] || cat.ownerLine || cat.label,
        monthly: ownerTargetMonthly(cat),
        plannedWeekly: weekly,
        plannedPayday: cat.plannedPayday != null ? roundCent(Number(cat.plannedPayday)) : null,
        planned,
        spent,
        remaining,
        hold: roundCent(Math.max(0, remaining != null ? remaining : planned)),
        projected: role === 'future',
        recon,
        pendingRecon,
      });
    }
    // Informational residual of the incumbent needsConfirmation /
    // unclassified path. This is unassigned current-cycle household spend,
    // not a total of every dollar outside the planned category rows
    // (named non-calendar ids such as health/sport stay omitted).
    // Not an allowance, not a hold, not a second waterfall subtraction.
    // Classifier reasons stay on recon.includeReason.
    // Visibility follows unresolved confirmation recon, not confirmed-spend
    // dollars: a pending possible-replacement twin can remain unclassified
    // after its posted mate classifies into a named row. That pending stays
    // recon-visible at $0 confirmed spent rather than disappearing.
    if (actualsReady && confirmationRecon.length > 0) {
      items.push({
        id: OTHER_SPENDING_ID,
        label: 'Other spending',
        note: 'Not yet assigned to a budget category',
        monthly: null,
        planned: null,
        spent: confirmationSpent,
        remaining: null,
        hold: 0,
        needsConfirmation: true,
        otherSpending: true,
        projected: role === 'future',
        recon: confirmationRecon,
        pendingRecon: confirmationRecon.filter(r => r.pending === true),
      });
    }
    return {
      items,
      hold: roundCent(items.reduce((s, r) => s + (Number(r.hold) || 0), 0)),
      spentReady: actualsReady,
      spendingCycle: cycleResolved ? cycle : null,
      cycleUnresolved: !cycleResolved,
    };
  }

  function calendarPeriodPurchases(plans, room, role) {
    const items = (plans || [])
      .filter(row => row && row.flexibility !== 'optional')
      .map(row => ({
        id: row.id,
        label: row.label,
        date: row.date || null,
        when: row.when || null,
        cost: row.need != null ? roundCent(row.need) : null,
        savedSoFar: 0,
        setAsideThisPayday: 0,
        allocation: 0,
        projected: role === 'future',
      }));
    let leftover = roundCent(Math.max(0, Number(room) || 0));
    if (role !== 'lookback') {
      for (const row of items) {
        const want = Number(row.cost) || 0;
        if (!(want > EPSILON) || !(leftover > EPSILON)) continue;
        const got = roundCent(Math.min(leftover, want));
        row.allocation = got;
        row.setAsideThisPayday = got;
        leftover = roundCent(leftover - got);
      }
    }
    return {
      items,
      taken: roundCent(items.reduce((s, r) => s + (Number(r.allocation) || 0), 0)),
    };
  }

  // Assigned amount the payday plan put on a printed bill row. Settlement
  // actuals are disclosure; they do not rewrite this planned load.
  function billAssignedAmount(row) {
    if (!row) return 0;
    if (row.planned != null && isFinite(Number(row.planned))) {
      return Math.abs(Number(row.planned));
    }
    if (row.amount != null && isFinite(Number(row.amount))) {
      return Math.abs(Number(row.amount));
    }
    return 0;
  }

  function rowIsSettledBill(row) {
    return !!(row && (row.status === 'PAID' || row.settlement === 'represented'));
  }

  // A represented PAID bill already inside the opening cash must not be
  // deducted again. Morning snapshot / completeness walk / carry-forward
  // are cash before that day's assigned bills. Mid-period posted cutover
  // or payday-morning cash may already include a same-day settlement.
  function paidBillAlreadyInPaydayOpening(row, openingAsOf, openingSource) {
    if (!row || !openingAsOf || !row.date) return false;
    if (!rowIsSettledBill(row)) return false;
    if (row.date < openingAsOf) return true;
    if (row.date > openingAsOf) return false;
    if (openingSource === 'snapshot' || openingSource === 'cutover-walk'
        || openingSource === 'carry-forward') {
      return false;
    }
    return true;
  }

  function billBelongsOnPaydayWaterfall(row, openingAsOf, openingSource) {
    if (!row || row.needsDate) return false;
    if (row.settledInOpening === true || row.settlement === 'opening') return false;
    if (paidBillAlreadyInPaydayOpening(row, openingAsOf, openingSource)) return false;
    return true;
  }

  // Authoritative frozen-waterfall bill load: each assigned period
  // occurrence once, including subsequently PAID rows that are not
  // already inside the opening. Remaining is settlement status, not
  // the deduction.
  function periodWaterfallBillLoad(bills, openingAsOf, openingSource) {
    return roundCent((bills || []).reduce((sum, row) => {
      if (!billBelongsOnPaydayWaterfall(row, openingAsOf, openingSource)) return sum;
      return sum + billAssignedAmount(row);
    }, 0));
  }

  function periodPaidBillDisclosure(bills) {
    return roundCent((bills || []).reduce((sum, row) => {
      if (!row || row.needsDate || !rowIsSettledBill(row)) return sum;
      return sum + billAssignedAmount(row);
    }, 0));
  }

  // Two payday-cycle waterfalls: this Seaspan payday through the day
  // before the next, then the next payday through the day before the
  // following one. Leftover is this printout's chain: it does not replace
  // paydayAllocation, and it does not rewrite live Current Balance.
  // The active period opens from a recorded paydaySnapshot first, else
  // payday-morning cash only when as-of is that payday and live overlay
  // has not already advanced, else a non-live cutover opening, else a
  // completeness-proven household-cash walk from that non-live dated
  // opening to this payday morning (`Forecast.establishPaydaySnapshot`)
  // — never from today's live posted cash, and never from a
  // scheduled-only reconstruction that assumes unscheduled gap
  // spending was zero.
  // Balance after payday is that frozen opening plus period income not
  // already inside that opening. Received-vs-live is settlement status
  // and does not drop an income row from the snapshot. The Bills step
  // subtracts the authoritative period bill load assigned against that
  // frozen snapshot, including subsequently PAID rows that are not
  // already inside the opening. Paid/remaining is settlement disclosure
  // and does not put a paid bill's cash back into Balance after payday.
  // The next period opens from this period's projected ending, or from
  // the walk's start-of-day cash on that payday when this period has no
  // recorded opening. Household Budget uses the same spendingCycle window.
  function calendarPeriodWaterfalls(plan, asOf, alloc, plans, debts, opts) {
    opts = opts || {};
    const windows = opts.periodWindows || operatingPayPeriodWindows(plan, asOf);
    if (!windows.length) return { calendarPeriods: [], activeCalendarPeriodId: null };
    const calendarOpts = Object.assign({}, opts, { periodWindows: windows });
    const calendar = calendarBillSections(plan, asOf, calendarOpts);
    const incomeByWindow = calendarIncomeSections(plan, asOf, windows, opts);
    const liveCurrentBalance = alloc && alloc.liveCurrentBalance != null
      ? roundCent(alloc.liveCurrentBalance)
      : (alloc && alloc.opening != null
        ? roundCent(alloc.opening)
        : roundCent(startingCashAmount(plan)));
    const buffer = opts.targetBuffer != null ? opts.targetBuffer
      : ((plan.defaults && plan.defaults.targetBuffer) || 0);
    const priority = debtPriority(plan, debts || []);
    const absorbable = paydayExtraDebtAbsorbable(
      Object.assign({}, opts, { debts: debts || opts.debts || [] }), priority);
    const periods = [];
    let previousEnding = null;
    let unavailableOpeningLost = false;
    const heldCycleStarts = new Set();
    const sectionById = {};
    for (const section of calendar.billSections || []) {
      if (section && section.id) sectionById[section.id] = section;
    }
    for (const window of windows) {
      const section = sectionById[window.id] || {
        rows: [], remainingTotal: 0, total: 0,
        start: window.start, end: window.end, id: window.id, label: window.label,
      };
      const role = window.role || 'future';
      const projected = role === 'future';
      const lookback = role === 'lookback';
      const income = incomeByWindow[window.id] || [];
      const bills = section.rows || [];
      const remainingBills = section.remainingTotal != null
        ? section.remainingTotal
        : roundCent(bills.reduce((s, r) => {
          if (!r || r.status === 'PAID' || r.needsDate) return s;
          return s + (r.remaining != null ? Math.abs(Number(r.remaining))
            : Math.abs(Number(r.amount) || 0));
        }, 0));
      const totalBillsThisPeriod = section.total != null
        ? section.total
        : roundCent(bills.reduce((s, r) => {
          if (!r || r.needsDate) return s;
          if (r.movement != null && isFinite(Number(r.movement))) {
            return s + Math.abs(Number(r.movement));
          }
          return s + Math.abs(Number(r.amount) || 0);
        }, 0));
      const budgetOpts = Object.assign({}, opts);
      // Dated opening is not the current operating plan. Role stays
      // anchored to that dated as-of; do not invent a later opening or
      // wall-clock as-of. A later payday window whose opening was the
      // unavailable current period's ending is also not a normal
      // current-looking / future waterfall.
      const planUnavailable = opts.operatingPlan === 'unavailable'
        && (role === 'active' || (role === 'future' && unavailableOpeningLost));
      if (role !== 'lookback') {
        if (planUnavailable) {
          // Dated opening is not the current operating plan. Do not publish
          // this as-of's spending cycle, planned payday dollars, or reserve
          // hold as today's waterfall, and do not invent a later cycle.
          budgetOpts.skipHold = true;
        } else {
          const seedAsOf = role === 'future' ? window.start : asOf;
          const picked = uniqueSpendingCycle(plan, seedAsOf, heldCycleStarts);
          if (picked.alreadyHeld) {
            budgetOpts.skipHold = true;
          } else if (picked.unresolved || !picked.cycle) {
            budgetOpts.unresolvedCycle = true;
          } else {
            budgetOpts.cycle = picked.cycle;
          }
        }
      }
      const budget = budgetOpts.skipHold
        ? {
          items: [], hold: 0, spentReady: false,
          spendingCycle: null, cycleUnresolved: false,
        }
        : calendarHouseholdBudget(
          plan, asOf, window.start, window.end, role, budgetOpts);
      const spendingCycleLabel = (role === 'active' && budget.spendingCycle && !planUnavailable)
        ? budget.spendingCycle.label : null;
      // Unavailable is PR #254 lookback: the active window may still
      // publish dated posted cash as the last trusted opening. A later
      // half whose prior ending was lost must not invent an opening.
      const snapshot = planUnavailable
        ? (role === 'active'
          ? {
            opening: roundCent(startingCashAmount(plan)),
            openingKnown: true,
            openingAsOf: (plan && plan.opening && plan.opening.asOf) || asOf,
            source: 'dated-opening',
          }
          : { opening: null, openingKnown: false, openingAsOf: null, source: null })
        : resolvePaydayPeriodOpening(
          plan, asOf, window, opts, previousEnding, opts.sim);
      const opening = snapshot.opening;
      const openingKnown = snapshot.openingKnown === true;
      const openingAsOf = snapshot.openingAsOf || null;
      const openingSource = snapshot.source || null;
      let incomeAdded = 0;
      for (const row of income) {
        if (row && (row.notReliedUpon === true || row.settlement === 'not-relied-upon')) {
          row.alreadyInCash = false;
          row.remaining = 0;
        }
        if (planUnavailable) continue;
        if (row && (row.notReliedUpon === true || row.settlement === 'not-relied-upon')) continue;
        if (role === 'future') {
          row.alreadyInCash = false;
          incomeAdded += Number(row.amount) || 0;
        } else if (openingKnown && !incomeAlreadyInPaydayOpening(
          row, openingAsOf, plan, opts, openingSource
        )) {
          incomeAdded += Number(row.amount) || 0;
        }
      }
      // Dated opening cash is not today's operating plan. Do not add
      // later-dated income as arriving-to-spend, and do not publish a
      // leftover chain from that mix.
      incomeAdded = planUnavailable || !openingKnown ? null : roundCent(incomeAdded);
      const available = planUnavailable || !openingKnown
        ? null : roundCent(opening + incomeAdded);
      const periodBillLoad = planUnavailable
        ? null
        : periodWaterfallBillLoad(bills, openingAsOf, openingSource);
      const paidBills = planUnavailable ? null : periodPaidBillDisclosure(bills);
      const afterBills = available != null && periodBillLoad != null
        ? roundCent(available - periodBillLoad) : null;
      const afterRemainingBills = afterBills;
      const afterHouseholdBudget = afterBills != null
        ? roundCent(afterBills - budget.hold) : null;
      let extraAllocated = 0;
      let extraDebt;
      if (planUnavailable) {
        extraDebt = {
          allocated: null,
          target: null,
          status: 'unavailable',
          reason: opts.operatingPlanNote
            || 'Current plan unavailable. The dated opening is stale.',
        };
      } else {
        if (!lookback && afterHouseholdBudget != null) {
          const room = roundCent(Math.max(0, afterHouseholdBudget - buffer));
          extraAllocated = roundCent(Math.min(room, absorbable));
        }
        extraDebt = {
          allocated: extraAllocated,
          target: priority.target,
          status: priority.status,
          reason: priority.reason,
        };
      }
      const afterDebtRepayment = afterHouseholdBudget != null
        ? roundCent(afterHouseholdBudget - extraAllocated) : null;
      const purchaseRoom = !lookback && afterDebtRepayment != null
        ? roundCent(Math.max(0, afterDebtRepayment - buffer)) : 0;
      const purchases = calendarPeriodPurchases(plans, purchaseRoom, role);
      const afterBigPurchases = afterDebtRepayment != null
        ? roundCent(afterDebtRepayment - purchases.taken) : null;
      const cards = revolvingCardsGlance(plan, debts, extraDebt);
      const leftover = {
        currentBalance: opening,
        afterBills,
        afterHouseholdBudget,
        afterDebtRepayment,
        afterBigPurchases,
      };
      if (planUnavailable) {
        previousEnding = null;
        unavailableOpeningLost = true;
      } else if (role === 'active' || (role === 'future' && openingKnown)) {
        previousEnding = afterBigPurchases;
      } else {
        previousEnding = null;
      }
      periods.push({
        id: window.id,
        label: window.label,
        rangeLabel: window.rangeLabel || null,
        start: window.start,
        end: window.end,
        role,
        projected,
        lookback,
        openingKnown,
        opening,
        openingAsOf,
        openingSource,
        liveCurrentBalance: role === 'active' ? liveCurrentBalance : null,
        currentBalance: opening,
        income: planUnavailable ? [] : income,
        incomeAdded,
        available,
        bills: planUnavailable ? [] : bills,
        totalBillsThisPeriod: planUnavailable ? null : totalBillsThisPeriod,
        paidBills,
        remainingBills: planUnavailable ? null : remainingBills,
        periodBillLoad,
        afterRemainingBills,
        afterBills,
        householdBudget: planUnavailable ? [] : budget.items,
        budgetHold: planUnavailable ? null : budget.hold,
        spendingCycleLabel,
        spendingCycle: role === 'lookback' || planUnavailable ? null : budget.spendingCycle,
        cycleUnresolved: budget.cycleUnresolved === true,
        operatingPlanUnavailable: planUnavailable,
        operatingPlanNote: planUnavailable
          ? (opts.operatingPlanNote
            || 'Current plan unavailable. The dated opening is stale.')
          : null,
        afterHouseholdBudget,
        extraDebt,
        firstCard: cards.firstCard,
        otherCards: cards.otherCards,
        extraLabel: projected ? 'Extra (projected)' : 'Extra',
        afterDebtRepayment,
        bigPurchases: purchases.items,
        afterBigPurchases,
        projectedEnding: afterBigPurchases,
        leftover,
        cashNote: lookback
          ? 'Lookback. Not today\'s balance.'
          : (planUnavailable
            ? (opts.operatingPlanNote
              || 'Current plan unavailable. The dated opening is stale.')
            : (!openingKnown
              ? 'Payday opening is not recorded for this period. Live Current Balance is not this payday\'s opening.'
              : (projected
                ? 'Projected opening. Not today\'s balance.'
                : null))),
      });
    }
    const active = periods.find(p => p.role === 'active') || periods[0] || null;
    return {
      calendarPeriods: periods,
      activeCalendarPeriodId: active ? active.id : null,
    };
  }
  function uniqueSpendingCycle(plan, seedAsOf, heldStarts) {
    let cycle = spendingCycle(plan, seedAsOf);
    if (!cycle || !cycle.start) {
      return { cycle: null, alreadyHeld: false, unresolved: true };
    }
    let guard = 0;
    while (heldStarts.has(cycle.start) && cycle.nextPayday && guard < 24) {
      const next = spendingCycle(plan, cycle.nextPayday);
      if (!next || !next.start || next.start === cycle.start) break;
      cycle = next;
      guard += 1;
    }
    if (heldStarts.has(cycle.start)) {
      return { cycle, alreadyHeld: true, unresolved: false };
    }
    heldStarts.add(cycle.start);
    return { cycle, alreadyHeld: false, unresolved: false };
  }

  function planDefaultView(plan, asOf, alloc, action, plans, debts, opts) {
    const leftover = (alloc && alloc.runningLeftover) || runningLeftoverFromAlloc(
      alloc && alloc.available,
      alloc && alloc.obligations && alloc.obligations.allocated,
      alloc && alloc.essentials && alloc.essentials.allocated,
      alloc && alloc.extraDebt && alloc.extraDebt.allocated,
      ((alloc && alloc.futureCosts) || [])
        .reduce((s, r) => s + (Number(r && r.allocated) || 0), 0)
    );
    const paydayDate = action && action.thisPayday;
    const periodLast = (action && action.periodEnd) || (alloc && alloc.periodEnd);
    const cycle = spendingCycle(plan, asOf);
    const periodStart = (cycle && cycle.start) || paydayDate || null;
    const cycleEnd = (cycle && cycle.end) || periodLast || null;
    const windows = operatingPayPeriodWindows(plan, asOf);
    const calendarOpts = Object.assign({}, opts, { periodWindows: windows });
    const calendar = calendarBillSections(plan, asOf, calendarOpts);
    const waterfalls = calendarPeriodWaterfalls(plan, asOf, alloc, plans, debts, calendarOpts);
    const cards = revolvingCardsGlance(plan, debts, alloc && alloc.extraDebt);
    const liveCurrentBalance = alloc && alloc.liveCurrentBalance != null
      ? roundCent(alloc.liveCurrentBalance)
      : roundCent(startingCashAmount(plan));
    return {
      asOf: (alloc && alloc.cashBasis && alloc.cashBasis.asOf) || asOf,
      span: 'pay-period',
      title: 'This pay period',
      billsHeading: 'Bills',
      extraLabel: 'Extra this payday',
      cashNote: null,
      liveCurrentBalance,
      periodStart,
      periodEnd: cycleEnd,
      currentBalance: leftover.currentBalance,
      afterBills: leftover.afterBills,
      afterHouseholdBudget: leftover.afterHouseholdBudget,
      afterDebtRepayment: leftover.afterDebtRepayment,
      afterBigPurchases: leftover.afterBigPurchases,
      bills: calendar.bills,
      billSections: calendar.billSections,
      undatedBills: calendar.undatedBills,
      calendarPeriods: waterfalls.calendarPeriods,
      activeCalendarPeriodId: waterfalls.activeCalendarPeriodId,
      householdBudget: householdBudgetGlance(plan, alloc),
      budgetDigest: householdBudgetDigest(
        plan, asOf, periodStart, cycleEnd, opts),
      firstCard: cards.firstCard,
      otherCards: cards.otherCards,
      bigPurchases: bigPurchasesGlance(plans, alloc),
    };
  }

  // Same 10-block shape as defaultView, for the next Seaspan payday Forecast
  // already named. Current Balance is the walk's start-of-day cash plus that
  // payday's income — the paydayAllocation available identity, not a new
  // cash engine. Extra and big-purchase set-aside are $0: those are this
  // payday's surplus decisions, not a second future waterfall.
  function planNextPeriodView(plan, asOf, action, plans, debts, sim, opts) {
    const nextPayday = (action && action.nextPayday) || null;
    if (!nextPayday) return null;
    const nextCal = paydayCalendar(plan, nextPayday, opts);
    const periodLast = nextCal && nextCal.periodLast;
    if (!periodLast) return null;
    const opening = startOfDayCash(sim, nextPayday);
    if (opening == null) return null;
    const available = roundCent(opening + incomeOnDate(plan, nextPayday, opts));
    const unpaid = unpaidJointCashInRange(plan, nextPayday, periodLast, opts);
    const days = Math.max(1, diffDays(nextPayday, periodLast) + 1);
    const householdBudget = householdBudgetScaled(plan, days, nextPayday, periodLast);
    const leftover = runningLeftoverFromAlloc(
      available, unpaid, budgetAmountTotal(householdBudget), 0, 0);
    return layoutViewFrom(
      plan, asOf, debts, leftover,
      layoutGlanceFrom(plan, nextPayday, periodLast, asOf, opts),
      householdBudget, { allocated: 0, futureCosts: [] }, plans,
      {
        asOf: nextPayday,
        span: 'pay-period',
        title: 'Next pay period',
        billsHeading: 'Bills this pay period',
        extraLabel: 'Extra this payday',
        cashNote: 'Current Balance. Not credit. Opening this pay period.',
        periodStart: nextPayday,
        periodEnd: periodLast,
      },
      { start: nextPayday, end: periodLast },
      opts
    );
  }

  // One Forecast-owned week from the already-run walk. Opening is that
  // week's sim opening. Leftover subtracts that week's unpaid joint-cash
  // bills and a 7-day owner-target hold. Extra and set-aside stay $0 —
  // those are payday-period allocations, not a weekly leftover Forecast
  // does not compute.
  function planWeekView(plan, asOf, week, plans, debts, opts) {
    if (!week || !week.start || !week.end) return null;
    const opening = week.opening != null && isFinite(Number(week.opening))
      ? roundCent(week.opening) : null;
    if (opening == null) return null;
    const unpaid = unpaidJointCashInRange(plan, week.start, week.end, opts);
    const householdBudget = householdBudgetScaled(plan, 7, week.start, week.end);
    const leftover = runningLeftoverFromAlloc(
      opening, unpaid, budgetAmountTotal(householdBudget), 0, 0);
    return layoutViewFrom(
      plan, asOf, debts, leftover,
      layoutGlanceFrom(plan, week.start, week.end, asOf, opts),
      householdBudget, { allocated: 0, futureCosts: [] }, plans,
      {
        asOf: week.start,
        span: 'week',
        title: 'This week',
        billsHeading: 'Bills this week',
        extraLabel: 'Extra this week',
        cashNote: 'Current Balance. Not credit. Opening this week.',
        periodStart: week.start,
        periodEnd: week.end,
      },
      { start: week.start, end: week.end },
      opts
    );
  }

  function planWeekViews(plan, asOf, plans, debts, sim, opts) {
    return ((sim && sim.weeks) || []).map(week =>
      planWeekView(plan, asOf, week, plans, debts, opts)).filter(Boolean);
  }

  function currentPeriodAction(plan, asOf, opts) {
    opts = opts || {};
    const cal = opts.paydayCalendar || paydayCalendar(plan, asOf, opts);
    const obligationStates = currentPeriodObligationStates(
      plan, asOf, Object.assign({}, opts, { paydayCalendar: cal }));
    const origin = obligationStates.periodStart;
    const periodLast = obligationStates.periodEnd;
    const coverage = actualsCoverageState(asOf, origin, opts);
    const useActuals = coverage.remainingClaim === 'precise'
      || coverage.remainingClaim === 'posted-only';
    const alloc = opts.paydayAllocation || paydayAllocation(plan, asOf, opts);
    const bills = obligationStates.bills;
    const inflows = currentPeriodInflows(
      plan, asOf, origin, periodLast, opts);
    const actuals = useActuals
      ? sumCategoryActuals(plan, asOf, origin, opts)
      : emptyCategoryActuals();
    const needStart = useActuals ? origin : asOf;
    const needDays = Math.max(1, diffDays(needStart, periodLast) + 1);
    const essentialNeed = essentialNeedBreakdown(plan, opts.periods, opts);
    const categories = [];
    const seenCat = new Set();
    const pushCategory = (row, monthly, source) => {
      if (!row || !row.id || seenCat.has(row.id)) return;
      seenCat.add(row.id);
      const planned = roundCent(monthly * needDays / CALENDAR_MONTH_DAYS);
      const act = categoryCommittedActual(actuals.byId.get(row.id), coverage.remainingClaim);
      const remaining = useActuals ? roundCent(planned - act.committed) : null;
      if (!(planned > EPSILON) && !(act.posted > EPSILON) && !(act.pending > EPSILON)
        && !(act.committed > EPSILON)) return;
      categories.push({
        id: row.id,
        label: row.label,
        class: row.class || null,
        planned: useActuals || planned > EPSILON ? planned : roundCent(monthly * needDays / CALENDAR_MONTH_DAYS),
        posted: useActuals ? act.posted : null,
        pending: useActuals ? act.pending : null,
        committed: useActuals ? act.committed : null,
        remaining,
        overage: remaining != null && remaining < -EPSILON ? roundCent(-remaining) : 0,
        source: source || row.source || null,
      });
    };
    if (opts.periods) {
      const bd = budgetBreakdown(plan, opts.periods, opts);
      if (bd && Array.isArray(bd.categories)) {
        for (const c of bd.categories) {
          const monthly = roundCent((Number(c.planned) || 0) + (Number(c.reserved) || 0));
          pushCategory(c, monthly, c.source);
        }
      }
    } else {
      for (const row of essentialNeed.items) {
        pushCategory(row, row.monthly, row.source);
      }
    }
    for (const [id, row] of actuals.byId) {
      if (seenCat.has(id)) continue;
      const cat = ((plan.budget && plan.budget.categories) || []).find(c => c.id === id);
      pushCategory(cat || { id, label: id, class: id === 'uncategorised' ? 'unknown' : null }, 0, null);
    }
    const essentialRemaining = categories
      .filter(c => c.class === 'essential' && c.remaining != null)
      .reduce((s, c) => s + c.remaining, 0);
    const todayActions = [];
    for (const bill of bills) {
      if (bill.settlement === 'upcoming' && bill.date === asOf) {
        todayActions.push({
          kind: 'pay',
          id: bill.id,
          label: bill.label,
          amount: bill.remaining,
          date: bill.date,
        });
      }
    }
    const moneyMovementRequired = cal.todayIsPayday
      ? ((alloc.lines || []).some(l => Number(l.amount) > EPSILON))
      : todayActions.length > 0;
    // Unverified is reserved, not a shortfall. A current-period shortfall is
    // overspent remaining, or a payday bucket that could not be funded.
    const currentShortfall = categories.some(c => c.remaining != null && c.remaining < -EPSILON)
      || (useActuals && essentialRemaining < -EPSILON)
      || (Number(alloc.obligations && alloc.obligations.shortfall) > EPSILON)
      || (Number(alloc.essentials && alloc.essentials.shortfall) > EPSILON);
    const paydayDate = thisPaydayDate(plan, asOf, opts, cal);
    const thisPaydayPaid = thisPaydayPaidFrom(inflows, bills, paydayDate);
    const thisPaydayDue = thisPaydayDueFrom(plan, paydayDate, alloc, bills);
    const thisPeriodGlance = thisPeriodGlanceFrom(
      plan, paydayDate, periodLast, asOf, alloc, inflows, bills);
    return {
      asOf,
      mode: cal.mode,
      periodStart: origin,
      periodEnd: periodLast,
      nextPayday: cal.subsequent,
      thisPayday: paydayDate,
      thisPaydayPaid,
      thisPaydayDue,
      thisPeriodGlance,
      coverage,
      bills,
      inflows,
      categories,
      unclassified: {
        posted: actuals.unclassified.posted,
        pending: actuals.unclassified.pending,
        count: actuals.unclassified.count,
      },
      excluded: actuals.excluded,
      essentialRemaining: useActuals ? roundCent(essentialRemaining) : null,
      spendPermission: alloc.spendPermission,
      weeklyCap: alloc.weeklyCap,
      moneyMovementRequired,
      todayActions,
      noMovementToday: !cal.todayIsPayday && !moneyMovementRequired,
      currentShortfall,
      remainingClaim: coverage.remainingClaim,
      categoryRemainingClaim: categoryRemainingClaimFrom(
        coverage.remainingClaim, actuals.unclassified),
    };
  }

  const OWNER_HIGHEST_INTEREST_POLICY = 'true-surplus-highest-interest';

  // The sole authority for the current extra-debt target. `plan.nextDollar`
  // states the household policy; this function applies it to current debt
  // facts. The page receives the answer and never compares rates itself.
  // Unknown or equal rates fail closed because the household supplied no
  // tie-breaker. Raw null, missing, or non-finite balances fail closed
  // before numeric coercion — Number(null) is 0 and must not omit a debt.
  // Unknown pending with no proven posted balance also fails. Unknown
  // pending on a positive posted balance keeps the target but is not $0
  // pending: leftover after that posted exposure is not true surplus.
  function debtPriority(plan, debts) {
    const policy = plan && plan.nextDollar;
    const unavailable = reason => ({
      status: 'unavailable', reason, policy: policy && policy.policy || null,
      provenance: policy && policy.provenance || null,
      target: null, nextTarget: null, order: [], consequence: null,
    });
    if (!policy || policy.policy !== OWNER_HIGHEST_INTEREST_POLICY
      || policy.provenance !== 'owner-stated') {
      return unavailable('No incumbent owner-stated extra-debt priority policy is available.');
    }

    const eligible = (debts || []).filter(d => d &&
      (d.id === 'heloc' || (!d.secured && /^Revolving\b/i.test(d.structure || ''))));
    const owing = [];
    for (const d of eligible) {
      // Inspect the raw field first. Number(null) === 0, so a missing or
      // null balance would otherwise look like a cleared facility and drop
      // out of the owing set.
      if (d.balance == null || !isFinite(Number(d.balance))) {
        return unavailable(`${d.label || d.id} has an unknown balance.`);
      }
      const posted = Number(d.balance);
      if (pendingUnknown(d) && !(posted > EPSILON)) {
        return unavailable(`${d.label || d.id} may owe an unknown pending balance.`);
      }
      if (openingBalance(d) > EPSILON) owing.push(d);
    }
    for (const d of owing) {
      if (typeof d.rate !== 'number' || !isFinite(d.rate)) {
        return unavailable(`${d.label || d.id} has an unknown interest rate.`);
      }
    }
    for (let i = 0; i < owing.length; i++) {
      for (let j = i + 1; j < owing.length; j++) {
        if (owing[i].rate === owing[j].rate) {
          return unavailable(`${owing[i].label || owing[i].id} and ${owing[j].label || owing[j].id} have equal interest rates; no owner tie-breaker is recorded.`);
        }
      }
    }
    const order = owing.slice().sort((a, b) => b.rate - a.rate).map(d => ({
      id: d.id,
      label: d.label,
      rate: d.rate,
      confidence: d.confidence || null,
      balance: roundCent(openingBalance(d)),
      pendingUnknown: pendingUnknown(d),
    }));
    const target = order[0] || null;
    const nextTarget = order[1] || null;
    const unknownPendingHold = !!(target && order.some(row => row.pendingUnknown));
    return {
      status: target ? 'ready' : 'clear',
      reason: target
        ? (unknownPendingHold
          ? `${target.label || target.id} has unknown pending exposure; cash beyond the proven posted balance is not true surplus.`
          : 'Owner-stated policy sends true surplus to the highest-interest eligible revolving debt or HELOC.')
        : 'No eligible revolving debt or HELOC has a known balance to receive surplus.',
      policy: policy.policy,
      provenance: policy.provenance,
      target,
      nextTarget,
      order,
      consequence: target && nextTarget ? {
        kind: 'next-target',
        condition: 'after-current-target-clears',
        target,
        nextTarget,
      } : null,
    };
  }

  function paydayExtraDebtAbsorbable(opts, priority) {
    const debts = opts.debts || [];
    if (!debts.length) return 0;
    const byId = new Map(debts.map(d => [d.id, d]));
    // Production policy uses debtPriority. The fallback preserves incumbent
    // synthetic callers that predate this owner policy; it is not reachable
    // from the published plan.
    let chain = priority && priority.status === 'ready'
      ? priority.order.map(row => byId.get(row.id)).filter(Boolean)
      : [];
    const ownerPolicyApplies = priority
      && priority.policy === OWNER_HIGHEST_INTEREST_POLICY
      && priority.provenance === 'owner-stated';
    if (!chain.length && !ownerPolicyApplies) {
      const unsecured = debts.filter(d => d && !d.secured)
        .sort((a, b) => (b.rate || 0) - (a.rate || 0));
      const head = opts.extraDebtTarget ? byId.get(opts.extraDebtTarget) : unsecured[0];
      const rest = unsecured.filter(d => d !== head);
      chain = [head, ...rest, byId.get('heloc')].filter(Boolean);
    }
    let absorbable = 0;
    for (const d of chain) {
      absorbable += Math.max(0, openingBalance(d));
      // Unknown pending is not $0. Proven posted may receive extra principal;
      // anything after this debt — another target or leftover cash — is not
      // proven true surplus until exposure is known.
      if (pendingUnknown(d)) break;
    }
    return absorbable;
  }

  // Probe the incumbent protected-feasibility predicate by moving cash on
  // as-of. Positive X is a same-day surplus outflow; negative X is a
  // same-day injection. This is not a second cash-path model: simulate and
  // protectedPlanCheck remain the only authorities.
  const PAYDAY_PROBE_ID = 'payday-surplus-probe';
  function paydayMasterOpts(plan, asOf, opts, weeklyCap, horizon) {
    return Object.assign({}, opts, {
      weeklyVariable: weeklyCap,
      horizonDays: horizon.days,
      viewDays: horizon.days,
      targetBuffer: opts.targetBuffer != null ? opts.targetBuffer
        : ((plan.defaults && plan.defaults.targetBuffer) || 0),
    });
  }
  function paydayProbeOpts(masterOpts, asOf, removeAmount, extraDisabled) {
    const probe = Object.assign({}, masterOpts, {
      disabled: (masterOpts.disabled || []).concat(extraDisabled || []),
    });
    delete probe.seq;
    delete probe.sim;
    delete probe.majorPlans;
    delete probe.plannedDebt;
    const amt = roundCent(removeAmount);
    if (amt > EPSILON) {
      probe.plannedFlows = (masterOpts.plannedFlows || []).concat([{
        date: asOf, amount: -amt, id: PAYDAY_PROBE_ID, label: 'Payday surplus probe',
      }]);
    } else if (amt < -EPSILON) {
      probe.injections = (masterOpts.injections || []).concat([{
        date: asOf, amount: -amt, id: PAYDAY_PROBE_ID, label: 'Payday gap probe',
      }]);
    }
    return probe;
  }
  function paydayPlanFits(plan, asOf, masterOpts, removeAmount, extraDisabled) {
    return protectedPlanCheck(plan, asOf,
      paydayProbeOpts(masterOpts, asOf, removeAmount, extraDisabled)).feasible;
  }
  // Largest same-day removal at which protectedPlanCheck still holds.
  // Negative means that much cash must be added before the protected plan
  // holds. Monotonic in the removal, so the cent search is exact.
  function maxFeasiblePaydayRemoval(plan, asOf, masterOpts, loBound, hiBound, extraDisabled) {
    const fits = cents => paydayPlanFits(plan, asOf, masterOpts, cents / 100, extraDisabled);
    let loC = Math.round(roundCent(loBound) * 100);
    let hiC = Math.round(roundCent(hiBound) * 100);
    if (hiC < loC) hiC = loC;
    if (fits(hiC)) return roundCent(hiC / 100);
    if (!fits(loC)) {
      let add = Math.max(100, Math.abs(loC) || 100);
      while (add < 1e9 && !fits(-add)) add *= 2;
      loC = -add;
      if (!fits(loC)) return roundCent(loC / 100);
      if (fits(hiC)) return roundCent(hiC / 100);
    }
    while (loC + 1 < hiC) {
      const mid = loC + Math.floor((hiC - loC) / 2);
      if (fits(mid)) loC = mid;
      else hiC = mid;
    }
    return roundCent(loC / 100);
  }

  /* ------------------------------------------- payday allocation waterfall */
  // What current household cash must do. Forecast remains the only planner.
  // Waterfall: required obligations → essential household hold → protected
  // future-path cash from the incumbent master walk → required dated
  // future-cost attribution from that same walk → extra debt (incumbent
  // cascade) → owner-marked optional residual.
  // Protected current cash is the leftover that cannot be removed today
  // while protectedPlanCheck still holds. Extra debt and optional residual
  // receive only that proven surplus. Required or bounded-flex undated
  // items stay unresolved and hold leftover cash: they do not fabricate a
  // contribution, and they do not release residual to extra debt or
  // optional residual. Credit is not cash. Q20 is not resolved here: the
  // model buffer is the existing feasibility floor, not a newly invented
  // emergency-fund line.
  function paydayAllocation(plan, asOf, opts) {
    opts = opts || {};
    const priority = debtPriority(plan, opts.debts || []);
    const buffer = opts.targetBuffer != null ? opts.targetBuffer
      : ((plan.defaults && plan.defaults.targetBuffer) || 0);
    const payFloor = opts.paydayFloor != null ? opts.paydayFloor : 1000;
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const seq = fundingSequence(plan, asOf, opts);
    const plans = opts.majorPlans || majorPlans(plan, asOf, Object.assign({}, opts, {
      weeklyVariable: opts.weeklyVariable != null ? opts.weeklyVariable : 0,
      horizonDays: horizon.days,
    }));
    const debt = opts.plannedDebt || plannedDebt(plan, asOf, Object.assign({}, opts, {
      weeklyVariable: opts.weeklyVariable != null ? opts.weeklyVariable : 0,
      majorPlans: plans,
    }));

    const opening = startingCashAmount(plan);
    const todayEvents = expandEvents(plan, asOf, asOf, opts);
    let todayIncome = 0;
    for (const e of todayEvents) {
      if (e.kind === 'income') todayIncome += e.amount;
    }
    const available = roundCent(opening + todayIncome);

    const cal = paydayCalendar(plan, asOf, opts);
    const todayIsPayday = cal.todayIsPayday;
    const subsequent = cal.subsequent;
    const periodLast = cal.periodLast;
    const periodDays = Math.max(1, diffDays(asOf, periodLast) + 1);
    const liquidityUntil = subsequent ? addDays(subsequent, 1) : periodLast;
    const origin = periodOriginDate(plan, asOf, todayIsPayday);
    const coverage = actualsCoverageState(asOf, origin, opts);
    const useActuals = coverage.remainingClaim === 'precise'
      || coverage.remainingClaim === 'posted-only';
    const needStart = useActuals ? origin : asOf;
    const needDays = Math.max(1, diffDays(needStart, periodLast) + 1);
    const categoryActuals = useActuals
      ? sumCategoryActuals(plan, asOf, origin, opts)
      : emptyCategoryActuals();

    const essentialNeed = essentialNeedBreakdown(plan, opts.periods, opts);
    const essentialMonthly = essentialNeed.monthly;
    const essentialsWantedFull = essentialMonthly * needDays / CALENDAR_MONTH_DAYS;

    let obligationsWanted = 0;
    const obligationItems = [];
    const periodEvents = expandEvents(plan, asOf, periodLast, opts);
    const obligationKeys = new Set();
    for (const e of periodEvents) {
      if (!isJointCashOutflow(e) && !e.cardPaid) continue;
      if (e.kind === 'extra' || e.kind === 'injection' || e.kind === 'planned-debt') continue;
      if (e.kind !== 'obligation' && e.kind !== 'bill' && e.kind !== 'commitment') continue;
      const amt = -e.amount;
      if (!(amt > EPSILON)) continue;
      obligationsWanted += amt;
      obligationItems.push({
        id: e.id,
        label: e.label,
        kind: e.kind,
        debtId: e.debtId || null,
        effect: e.effect || null,
        date: e.date,
        amount: roundCent(amt),
        confidence: e.confidence || null,
        cardPaid: e.cardPaid === true,
        // Settlement is expandEvents / representedEvents: a represented
        // occurrence is omitted above, not labelled unpaid. A past scheduled
        // date without that evidence is unverified, not confirmed unpaid.
        settlement: paydaySettlementState(e.date, asOf),
      });
      if (e.id) obligationKeys.add(e.id);
    }
    for (const item of seq) {
      if (!isOverdueProtectedItem(item, asOf) || item.flexibility === 'optional') continue;
      if (obligationKeys.has(item.id)) continue;
      const floor = item.bounds ? item.bounds.floor : (item.need || 0);
      if (!(floor > EPSILON)) continue;
      obligationsWanted += floor;
      obligationItems.push({
        id: item.id,
        label: item.label,
        kind: 'overdue',
        debtId: null,
        effect: null,
        date: item.date,
        amount: roundCent(floor),
        confidence: item.confidence || null,
        settlement: paydaySettlementState(item.date, asOf),
      });
      obligationKeys.add(item.id);
    }

    let remaining = available;
    const take = want => {
      const got = Math.min(Math.max(0, want), Math.max(0, remaining));
      remaining = roundCent(remaining - got);
      return roundCent(got);
    };

    const allocatedObligations = take(obligationsWanted);

    // Per-item reserved cash is authoritative only when the whole required
    // bucket is funded or none of it is. Partial funding is an unattributed
    // pool: expandEvents order is a calendar stream, not an owner-approved
    // bill-priority rule, so no item is marked reserved by array position.
    let obligationsAttribution = 'complete';
    if (allocatedObligations + EPSILON < obligationsWanted) {
      obligationsAttribution = allocatedObligations > EPSILON ? 'unattributed' : 'none';
    }
    for (const item of obligationItems) {
      if (obligationsAttribution === 'complete') {
        item.allocated = item.amount;
      } else if (obligationsAttribution === 'none') {
        item.allocated = 0;
      } else {
        item.allocated = null;
      }
    }
    const requiredDebtItems = obligationItems
      .filter(item => item.kind === 'obligation' && item.debtId && item.effect === 'payment')
      .map(item => Object.assign({}, item));
    const requiredDebtAllocated = obligationsAttribution === 'unattributed'
      ? null
      : roundCent(requiredDebtItems.reduce((sum, item) => sum + Number(item.allocated || 0), 0));

    const essentialItems = [];
    const periodScale = needDays / CALENDAR_MONTH_DAYS;
    let requiredSum = 0;
    for (const row of essentialNeed.items) {
      const planned = roundCent(row.monthly * periodScale);
      const act = categoryCommittedActual(
        categoryActuals.byId.get(row.id), coverage.remainingClaim);
      const remainingNeed = useActuals ? roundCent(planned - act.committed) : planned;
      const required = useActuals ? roundCent(Math.max(0, remainingNeed)) : planned;
      if (!(planned > EPSILON) && !(row.monthly > EPSILON) && !(act.committed > EPSILON)) continue;
      requiredSum = roundCent(requiredSum + required);
      essentialItems.push({
        id: row.id,
        label: row.label,
        monthly: roundCent(row.monthly),
        required,
        planned,
        posted: useActuals ? act.posted : null,
        pending: useActuals ? act.pending : null,
        remaining: useActuals ? remainingNeed : planned,
        source: row.source,
        funded: null,
        unfunded: null,
      });
    }
    let wantedRounded = useActuals ? roundCent(requiredSum) : roundCent(essentialsWantedFull);
    if (!useActuals) {
      const residual = roundCent(wantedRounded - requiredSum);
      if (essentialItems.length && residual !== 0) {
        const last = essentialItems[essentialItems.length - 1];
        last.required = roundCent(last.required + residual);
        last.remaining = last.required;
        last.planned = last.required;
      }
    }
    const allocatedEssentials = take(wantedRounded);
    const leftoverAfterOE = remaining;
    const essentialsShortfall = roundCent(Math.max(0, wantedRounded - allocatedEssentials));
    let essentialsAttribution = 'complete';
    if (allocatedEssentials + EPSILON < wantedRounded) {
      essentialsAttribution = allocatedEssentials > EPSILON ? 'unattributed' : 'none';
    }
    for (const row of essentialItems) {
      if (essentialsAttribution === 'complete') {
        row.funded = row.required;
        row.unfunded = 0;
      } else if (essentialsAttribution === 'none') {
        row.funded = 0;
        row.unfunded = row.required;
      } else {
        row.funded = null;
        row.unfunded = null;
      }
    }

    const weeklyCap = opts.weeklyVariable != null ? Number(opts.weeklyVariable) || 0 : 0;
    const spendPermission = roundCent(weeklyCap * periodDays / 7);

    const protectedFuture = [];
    const optionalRows = [];
    const unresolvedRows = [];
    for (const item of seq) {
      const planRow = plans.find(p => p.id === item.id) || null;
      const floor = item.need != null ? item.need
        : (item.bounds ? item.bounds.floor : 0);
      const row = {
        id: item.id,
        label: item.label,
        date: item.date,
        when: item.when,
        need: floor,
        flexibility: item.flexibility,
        plan: planRow,
        confidence: item.confidence || null,
      };
      if (item.flexibility === 'optional') {
        optionalRows.push(row);
        continue;
      }
      if (!item.date) {
        unresolvedRows.push(row);
        continue;
      }
      if (obligationKeys.has(item.id)) continue;
      if (item.date >= asOf && item.date <= periodLast && item.need != null) continue;
      protectedFuture.push(row);
    }

    const masterOpts = paydayMasterOpts(plan, asOf, opts, weeklyCap, horizon);
    let loBound = 0;
    for (const row of protectedFuture) loBound -= Math.max(0, row.need || 0);
    loBound -= Math.max(0, buffer) + leftoverAfterOE + 1;
    const hiBound = leftoverAfterOE;
    const deltaAll = maxFeasiblePaydayRemoval(
      plan, asOf, masterOpts, loBound, hiBound, []);
    const movable = roundCent(Math.max(0, Math.min(leftoverAfterOE, deltaAll)));

    const shares = new Map();
    const latestFirst = protectedFuture.slice().sort((a, b) => {
      if (a.date === b.date) return 0;
      return a.date < b.date ? 1 : -1;
    });
    let currentDisabled = [];
    let currentDelta = deltaAll;
    for (const row of latestFirst) {
      currentDisabled = currentDisabled.concat([row.id]);
      const deltaWithout = maxFeasiblePaydayRemoval(
        plan, asOf, masterOpts, loBound, hiBound, currentDisabled);
      shares.set(row.id, {
        requiredNow: roundCent(Math.max(0, deltaWithout - currentDelta)),
      });
      currentDelta = deltaWithout;
    }
    const pathWanted = roundCent(Math.max(0, leftoverAfterOE - Math.max(0, currentDelta)));
    const allocatedPath = take(pathWanted);
    const pathShortfall = Math.max(0, roundCent(pathWanted - allocatedPath));

    const futureAllocations = [];
    if (pathWanted > EPSILON) {
      futureAllocations.push({
        id: 'household-path',
        label: 'Future cash path',
        date: null,
        need: roundCent(pathWanted),
        stillNeeded: roundCent(pathWanted),
        requiredNow: roundCent(pathWanted),
        allocated: allocatedPath,
        projectedByDeadline: allocatedPath,
        shortfall: pathShortfall,
        verdict: pathShortfall > EPSILON ? 'FUNDING GAP' : 'ON TRACK',
        reason: pathShortfall > EPSILON
          ? `Current plan implies a $${pathShortfall.toFixed(2)} funding gap.`
          : 'Required current funding from the master Forecast is met.',
      });
    }
    for (const row of protectedFuture) {
      const share = shares.get(row.id) || { requiredNow: 0 };
      const got = take(share.requiredNow);
      const planRow = row.plan;
      const planVerdict = (planRow && planRow.verdict) || 'ON TRACK';
      const planRemaining = planRow ? Math.max(0, Number(planRow.remaining) || 0) : 0;
      // By-deadline projection is the incumbent majorPlans/master-walk
      // result, not this payday's set-aside. A FUNDING GAP remaining is
      // the authoritative shortfall; ON TRACK / AT RISK keep the base
      // target as fully projected. requiredNow − allocated is current
      // payday split, not a deadline gap.
      const shortfall = planVerdict === 'FUNDING GAP' ? roundCent(planRemaining) : 0;
      const projectedByDeadline = roundCent(Math.max(0, row.need - shortfall));
      const verdict = shortfall > EPSILON ? 'FUNDING GAP' : planVerdict;
      futureAllocations.push({
        id: row.id,
        label: row.label,
        date: row.date,
        when: row.when,
        need: roundCent(row.need),
        stillNeeded: roundCent(row.need),
        requiredNow: share.requiredNow,
        allocated: got,
        projectedByDeadline,
        shortfall,
        verdict,
        confidence: row.confidence || null,
        reason: shortfall > EPSILON
          ? `Current plan implies a $${shortfall.toFixed(2)} funding gap.`
          : (verdict === 'AT RISK'
            ? 'Base case remains feasible; a protected uncertainty case is not.'
            : 'Required current funding from the master Forecast is met.'),
      });
    }

    const holdForUnresolved = unresolvedRows.some(r => r.flexibility !== 'optional');
    const extraAbsorbable = paydayExtraDebtAbsorbable(opts, priority);
    const ownerPolicyApplies = priority.policy === OWNER_HIGHEST_INTEREST_POLICY
      && priority.provenance === 'owner-stated';
    const extraWanted = holdForUnresolved || (ownerPolicyApplies && priority.status !== 'ready') ? 0
      : Math.min(remaining, movable, extraAbsorbable);
    const allocatedExtraDebt = take(extraWanted);
    const unknownPendingHold = ownerPolicyApplies
      && priority.status === 'ready'
      && (priority.order || []).some(row => row.pendingUnknown);

    const optionalAllocations = [];
    if (!holdForUnresolved && !unknownPendingHold) {
      for (const row of optionalRows) {
        if (!(remaining > EPSILON)) break;
        const want = row.need;
        if (!(want > EPSILON)) continue;
        const got = take(want);
        if (got > EPSILON) {
          optionalAllocations.push({
            id: row.id,
            label: row.label,
            date: row.date,
            need: roundCent(row.need),
            allocated: got,
            flexibility: row.flexibility,
          });
        }
      }
    }

    const unallocated = roundCent(Math.max(0, remaining));
    const futureTaken = roundCent(futureAllocations
      .filter(row => row && row.id !== 'household-path')
      .reduce((s, row) => s + (Number(row.allocated) || 0), 0));
    const runningLeftover = runningLeftoverFromAlloc(
      available, allocatedObligations, allocatedEssentials, allocatedExtraDebt, futureTaken);
    const lines = [];
    const pushLine = (key, kind, label, amount, extra) => {
      if (!(amount > EPSILON)) return;
      lines.push(Object.assign({ key, kind, label, amount: roundCent(amount) }, extra || {}));
    };
    pushLine('obligations', 'obligations', 'Keep for bills', allocatedObligations);
    pushLine('essentials', 'essentials', 'Hold for essential costs', allocatedEssentials, {
      role: 'reserve',
      weeklyCap,
      spendPermission,
    });
    pushLine('future-path', 'future-path', 'Keep for future cash path', allocatedPath);
    for (const row of futureAllocations) {
      if (row.id === 'household-path') continue;
      pushLine('future:' + row.id, 'future-cost', 'Set aside — ' + row.label,
        row.allocated, { id: row.id, date: row.date, confidence: row.confidence || null });
    }
    pushLine('extra-debt', 'extra-debt', 'Extra debt', allocatedExtraDebt);
    for (const row of optionalAllocations) {
      pushLine('optional:' + row.id, 'optional', 'Optional — ' + row.label,
        row.allocated, { id: row.id, date: row.date });
    }

    const allocatedTotal = roundCent(lines.reduce((s, l) => s + l.amount, 0));
    const risks = [];
    for (const row of futureAllocations) {
      if (!(row.shortfall > EPSILON) && row.verdict !== 'FUNDING GAP') continue;
      risks.push({
        id: row.id,
        label: row.label,
        date: row.date,
        verdict: 'FUNDING GAP',
        shortfall: row.shortfall,
        need: row.need,
        projectedByDeadline: row.projectedByDeadline,
        allocated: row.allocated,
        reason: row.reason,
      });
    }
    if (allocatedObligations + EPSILON < obligationsWanted) {
      risks.push({
        id: 'obligations',
        label: 'Required obligations',
        date: asOf,
        verdict: 'FUNDING GAP',
        shortfall: roundCent(obligationsWanted - allocatedObligations),
        need: roundCent(obligationsWanted),
        projectedByDeadline: allocatedObligations,
        allocated: allocatedObligations,
        reason: 'This payday cannot cover required obligations in cash.',
      });
    }
    if (allocatedEssentials + EPSILON < wantedRounded) {
      risks.push({
        id: 'essentials',
        label: 'Essential household spending',
        date: asOf,
        verdict: 'FUNDING GAP',
        shortfall: roundCent(wantedRounded - allocatedEssentials),
        need: roundCent(wantedRounded),
        projectedByDeadline: allocatedEssentials,
        allocated: allocatedEssentials,
        reason: 'This payday cannot protect essential household spending in cash.',
      });
    }
    if (unknownPendingHold) {
      risks.push({
        id: 'extra-debt-pending-unknown',
        label: 'Extra-debt pending exposure',
        date: asOf,
        verdict: 'UNKNOWN',
        shortfall: null,
        need: null,
        projectedByDeadline: allocatedExtraDebt,
        allocated: allocatedExtraDebt,
        reason: priority.reason,
      });
    }

    const openingRow = plan && plan.opening;
    const priorAsOf = openingRow && openingRow.asOf === asOf && openingRow.priorAsOf
      && openingRow.priorAsOf < asOf ? openingRow.priorAsOf : null;
    const represented = representedKeySet(plan, opts, asOf);

    return {
      asOf,
      mode: cal.mode,
      payday: subsequent,
      periodStart: asOf,
      planPeriodStart: origin,
      periodEnd: periodLast,
      periodDays,
      available,
      opening,
      liveCurrentBalance: opening,
      todayIncome: roundCent(todayIncome),
      buffer,
      cashBasis: {
        asOf,
        priorAsOf,
        liveAdvanced: !!priorAsOf,
        datedOpening: !priorAsOf,
        representedCount: represented.size,
      },
      obligations: {
        wanted: roundCent(obligationsWanted),
        allocated: allocatedObligations,
        shortfall: roundCent(Math.max(0, obligationsWanted - allocatedObligations)),
        fundingAttribution: obligationsAttribution,
        fundedPool: obligationsAttribution === 'unattributed' ? allocatedObligations : 0,
        items: obligationItems,
      },
      requiredDebtPayments: {
        wanted: roundCent(requiredDebtItems.reduce((sum, item) => sum + item.amount, 0)),
        allocated: requiredDebtAllocated,
        fundingAttribution: obligationsAttribution,
        items: requiredDebtItems,
      },
      essentials: {
        monthly: roundCent(essentialMonthly),
        wanted: wantedRounded,
        allocated: allocatedEssentials,
        shortfall: essentialsShortfall,
        role: 'reserve',
        weeklyCap,
        spendPermission,
        fundingAttribution: essentialsAttribution,
        fundedPool: essentialsAttribution === 'unattributed' ? allocatedEssentials : 0,
        items: essentialItems,
      },
      weeklyCap,
      spendPermission,
      unresolved: unresolvedRows.map(row => ({
        id: row.id,
        label: row.label,
        date: null,
        when: row.when,
        need: roundCent(row.need || 0),
        flexibility: row.flexibility,
        confidence: row.confidence || null,
        reason: 'Required, but no exact date — no payday contribution assigned; leftover cash is not released to extra debt.',
      })),
      liquidity: {
        wanted: roundCent(pathWanted),
        allocated: allocatedPath,
        until: liquidityUntil,
      },
      protectedPath: {
        wanted: roundCent(pathWanted),
        allocated: allocatedPath,
        movable: roundCent(movable),
      },
      movable: roundCent(movable),
      futureCosts: futureAllocations.filter(r => r.id !== 'household-path'),
      extraDebt: {
        allocated: allocatedExtraDebt,
        absorbable: roundCent(extraAbsorbable),
        status: priority.status,
        reason: priority.reason,
        policy: priority.policy,
        provenance: priority.provenance,
        target: priority.target,
        nextTarget: priority.nextTarget,
        consequence: priority.consequence,
      },
      optional: optionalAllocations,
      lines,
      risks,
      // Spend permission from the incumbent weekly cap, not the essential
      // cash hold. Those amounts may differ; the hold is a reserve.
      supportedAllowance: spendPermission,
      unallocated,
      allocatedTotal,
      remainder: unallocated,
      runningLeftover,
      plannedDebt: { permitted: !!(debt && debt.permitted), borrowed: debt && debt.borrowed || 0 },
      identity: roundCent(allocatedTotal + unallocated),
      actualsCoverage: coverage,
    };
  }

  /* ---------------------------------------------------- budget recommender */
  // The largest weekly variable spend, to the nearest $5, that keeps the
  // protected plan feasible: cash buffer, overdue protected point amounts
  // and overdue dated-range floors against as-of surplus, still-encumbered
  // principal, and every still-future dated-reserve deadline. Same
  // predicate as planned-debt validation.
  // Monotonic in W, so binary search is exact.
  const STEP = 5;
  function recommendWeekly(plan, asOf, opts) {
    opts = Object.assign({}, opts || {});
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const searchOpts = Object.assign({}, opts, {
      horizonDays: opts.horizonDays != null ? opts.horizonDays : horizon.days,
    });
    if (searchOpts.viewDays == null) searchOpts.viewDays = searchOpts.horizonDays;
    const seq = fundingSequence(plan, asOf, searchOpts);
    const fits = w => protectedPlanCheck(plan, asOf, Object.assign({}, searchOpts, {
      weeklyVariable: w, seq,
    })).feasible;
    if (!fits(0)) return 0; // even zero spending breaches the protected plan
    let lo = 0, hi = 5000;
    while (fits(hi)) { lo = hi; hi *= 2; if (hi > 80000) break; }
    while (hi - lo > STEP) {
      const mid = Math.round((lo + hi) / (STEP * 2)) * STEP;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /* ------------------------------------- near-boundary payday obligations */
  // Named joint-cash outflows already in the Forecast event stream that fall
  // on the next payday or the following calendar day. Payday output consumes
  // this list so current surplus is not treated as free before those
  // already-known bills. It does not re-expand, re-simulate, or change the
  // weekly search. Extra debt payments and gap injections are surplus use,
  // not obligations, and are omitted. The window is those two existing
  // calendar dates — not a second forecast horizon.
  function nearBoundaryObligations(events, asOf, paydayFloor) {
    const floor = paydayFloor != null ? paydayFloor : 1000;
    let payday = null;
    for (const event of events || []) {
      if (event.kind === 'income' && event.amount >= floor && event.date >= asOf) {
        payday = event.date;
        break;
      }
    }
    if (!payday) return { payday: null, until: null, items: [], total: 0 };
    const until = addDays(payday, 1);
    const items = [];
    for (const event of events || []) {
      if (!isJointCashOutflow(event)) continue;
      if (event.kind === 'extra' || event.kind === 'injection' || event.kind === 'planned-debt') continue;
      if (event.date < payday || event.date > until) continue;
      items.push({
        date: event.date,
        id: event.id,
        label: event.label,
        kind: event.kind,
        amount: -event.amount,
      });
    }
    return {
      payday,
      until,
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  /* ------------------------------------------------- the recommendation */
  // THE single authority for "how much can the household spend per week".
  // Both the headline tile and the budget breakdown read this one result, so
  // the page cannot show two different answers to the same question.
  //
  // Three cases, one code path:
  //
  //   normal      the window already holds the buffer at zero spend, and the
  //               protected master plan is jointly feasible, so the answer is
  //               the largest weekly spend that keeps it there.
  //
  //   infeasible  the ordinary cash buffer still holds at zero spend, but a
  //               protected commitment cannot: an overdue as-of constraint,
  //               a dated-reserve deadline, or jointly encumbered principal
  //               fails even at weekly = 0. The answer is not $0/week as a
  //               feasible cap. It is INFEASIBLE, with the first failing
  //               constraint, date, dollar shortfall, and affected commitment.
  //
  //   openingGap  even zero spend breaches, because money is due before the
  //               first payday arrives. The fix is not a smaller budget, it is
  //               a top-up from non-debt cash the household already owns.
  //               DebtId headroom is not that top-up. Size a cash recovery,
  //               place it on the calendar as a one-off injection on the day
  //               it is needed, and re-solve. If no cash source can reach
  //               the gap, keep the shortfall: do not publish a
  //               borrowing-enabled weekly cap as safe-to-spend.
  //
  // The opening-gap case is solved on the SAME window, by adding one event.
  // The previous implementation instead re-sliced the plan to start on the
  // first payday, seeded it with that payday's own end-of-day balance, and
  // then let the simulation replay that payday's income and bills — counting
  // the whole day twice and overstating the sustainable budget by a third.
  // Adding an event to one ledger pass cannot double-count by construction.
  //
  // When the live overlay marks the current operating plan unavailable, keep
  // the dated-opening walk (do not invent a later as-of) but withhold the
  // current/actionable claims: weekly spend permission, current-period action,
  // extra-debt instruction, the active calendar leftover chain (later income
  // as arriving, Available as dated cash plus that income, Household Budget /
  // bills / extra-debt leftover as today's waterfall), and any later calendar
  // half whose opening was lost because that current period was unavailable.
  // Dated-opening cash may remain as lookback. Do not mix live observedCash
  // into this walk.
  function withholdCurrentOperatingClaims(result, opts) {
    if (!result || !opts || opts.operatingPlan !== 'unavailable') return result;
    const note = opts.operatingPlanNote
      || 'Current plan unavailable. The dated opening is stale.';
    result.operatingPlanUnavailable = true;
    result.operatingPlanNote = note;
    result.weekly = null;
    result.currentPeriodAction = {
      unavailable: true,
      remainingClaim: 'unavailable',
      reason: note,
    };
    if (result.paydayAllocation) {
      result.paydayAllocation.extraDebt = {
        allocated: null,
        absorbable: null,
        status: 'unavailable',
        reason: note,
        target: null,
        consequence: null,
      };
      result.paydayAllocation.spendPermission = null;
      result.paydayAllocation.weeklyCap = null;
    }
    return result;
  }

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
    if (base.fundingSources) {
      base.fundingSources = resolveFundingSources(
        base.fundingSources, base.extraFacilities, plan, base.debts);
    }

    const planOptions = Object.assign({}, base);
    const payFloor = base.paydayFloor != null ? base.paydayFloor : 1000;
    const viewDays = resolveViewDays(plan, asOf, base);
    const horizon = knowledgeHorizon(plan, asOf, base);
    const viewSpec = base.view || null;

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

    // Opening-gap detection stays on the visible opening, not the 12-month
    // walk. A January 2027 commitment must not become an Amanda/HELOC
    // injection today. Future shortfalls bind the weekly search instead.
    const zero = simulate(plan, asOf, Object.assign({}, base, {
      weeklyVariable: 0, horizonDays: viewDays, viewDays,
    }));
    // The weekly search must walk the master horizon. Passing the visible
    // viewDays through would slice simulate() and let a 7-day view spend
    // cash the January commitment still needs.
    const searchBase = Object.assign({}, base, {
      horizonDays: horizon.days, viewDays: horizon.days,
    });

    if (atLeast(zero.min.balance, buffer)) {
      const zeroProtected = protectedPlanCheck(plan, asOf, Object.assign({}, searchBase, {
        weeklyVariable: 0,
      }));
      if (!zeroProtected.feasible) {
        return finish('infeasible', searchBase, 0, asOf, null, zero, zeroProtected.first);
      }
      const weekly = recommendWeekly(plan, asOf, searchBase);
      return finish('normal', searchBase, weekly, asOf, null, zero);
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
      .filter(e => isJointCashOutflow(e) && (!firstIncome || e.date < firstIncome.date))
      .reduce((s, e) => s + -e.amount, 0);
    const dueOnGapDay = zero.events
      .filter(e => e.date === gapDate && isJointCashOutflow(e))
      .reduce((s, e) => s + -e.amount, 0);

    // Spending resumes at the first real payday — until then there is nothing
    // spare, which is the honest answer for the opening days.
    const firstPay = zero.events.find(e => e.kind === 'income' && e.amount >= payFloor);
    const spendFrom = firstPay ? firstPay.date : gapDate;

    // WHO covers the gap decides what it costs. Money released from an account
    // the household already owns creates no debt; a draw on a credit facility
    // does. The allocation lives here rather than in the page because it is
    // arithmetic against the gap, and the gap is only known at this point.
    //
    // Cash sources are filled in rank order until the gap is met. A debtId
    // option is visible capacity, not automatic recovery: unapproved
    // borrowing cannot repair an otherwise-infeasible opening. Planned
    // borrowing stays on Forecast.plannedDebt. Raise the buffer and two cash
    // sources can still combine; HELOC headroom is not one of those sources.
    const declared = (base.fundingSources || []).slice();
    const sources = declared
      .sort((a, b) => (a.rank || 0) - (b.rank || 0))
      .filter(canAutoCoverOpeningGap);
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
    // No sources declared at all: fall back to one unattributed cash
    // injection, which is what a caller that has not told us anything is
    // implicitly asking for. A declared list that is only debt or unusable
    // is not that case — it is an unfunded shortfall.
    //
    // Legacy fundingDebtId is a facility hint, not authorization to borrow.
    // Attaching it here used to convert HELOC capacity into opening-gap cash
    // while plannedDebt.permitted stayed false. Unapproved borrowing cannot
    // repair an opening gap (B70). Fail that path closed: no injection.
    // Planned borrowing stays on Forecast.plannedDebt.
    if (!declared.length && !base.fundingDebtId) {
      parts.push({ id: 'gapFunding', label: base.fundingLabel || 'Gap funding — transfer or draw',
        short: 'gap funding', amount: gapAmount, debtId: null });
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
        const covers = canAutoCoverOpeningGap(src) && atLeast(src.available, gapAmount);
        const part = parts.find(p => p.id === src.id) || null;
        return {
          id: src.id, available: src.available, unusable: !!src.unusable,
          // What the household is told about this source, and nothing else
          // decides it: it covers the gap alone, it is one leg of the selected
          // combination, or it cannot reach the gap and is not used. A debtId
          // facility never covers an opening gap merely because it has room.
          verdict: covers ? 'covers' : part ? 'contributes' : 'insufficient',
          contributes: part ? part.amount : 0,
          shortBy: src.debtId && !src.unusable
            ? gapAmount
            : Math.max(0, gapAmount - src.available),
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

    const recovery = Object.assign({}, searchBase, {
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
    if (!result.operatingPlanUnavailable) result.funding = funding;
    return result;

    // Build the result, and prove the answer is actually binding: one step up
    // must breach the buffer, and where it breaches is the constraint to name.
    function finish(mode, simOptions, weeklyCap, effectiveFrom, gap, zeroSim, infeasible) {
      const view = viewRange(plan, asOf, viewSpec || { days: viewDays }, planOptions);
      const viewSim = simulate(plan, asOf, Object.assign({}, simOptions, {
        weeklyVariable: weeklyCap, horizonDays: horizon.days,
        viewDays: view.days, viewStart: view.start,
      }));
      const knowledgeSim = simulate(plan, asOf, Object.assign({}, simOptions, {
        weeklyVariable: weeklyCap, horizonDays: horizon.days, viewDays: horizon.days,
      }));
      const next = simulate(plan, asOf, Object.assign({}, simOptions, {
        weeklyVariable: weeklyCap + STEP, horizonDays: horizon.days, viewDays: horizon.days,
      }));
      const sequence = fundingSequence(plan, asOf, planOptions);
      const plans = majorPlans(plan, asOf, Object.assign({}, planOptions, {
        weeklyVariable: weeklyCap, horizonDays: horizon.days,
      }));
      const debt = plannedDebt(plan, asOf, Object.assign({}, planOptions, {
        weeklyVariable: weeklyCap, majorPlans: plans,
      }));
      const encumbered = protectedEncumbered(sequence, asOf).floor;
      const freeCash = leftoverAfterBuffer(knowledgeSim) - encumbered;
      const protectedAtCap = protectedPlanCheck(plan, asOf, Object.assign({}, simOptions, {
        weeklyVariable: weeklyCap, horizonDays: horizon.days, viewDays: horizon.days,
        seq: sequence, sim: knowledgeSim,
      }));
      const paydayOpts = Object.assign({}, planOptions, {
        weeklyVariable: weeklyCap,
        periods: planOptions.periods || base.periods,
        majorPlans: plans,
        plannedDebt: debt,
        injections: simOptions.injections,
      });
      const alloc = paydayAllocation(plan, asOf, paydayOpts);
      const action = currentPeriodAction(plan, asOf, Object.assign({}, paydayOpts, {
        paydayAllocation: alloc,
      }));
      return withholdCurrentOperatingClaims({
        mode, weekly: weeklyCap, effectiveFrom, buffer, gap, sim: viewSim, zero: zeroSim,
        step: STEP,
        knowledge: {
          start: horizon.start, end: horizon.end, days: horizon.days,
          min: knowledgeSim.min, ending: knowledgeSim.ending,
          encumbered, freeCash,
        },
        view,
        fundingSequence: sequence,
        majorPlans: plans,
        plannedDebt: debt,
        infeasible: mode === 'infeasible' ? (infeasible || protectedAtCap.first) : null,
        // Named joint-cash obligations already in `zero.events` on the next
        // payday and the following calendar day. Derived, not stored, and not
        // a second horizon: the weekly search and the balances are unchanged.
        nearBoundary: nearBoundaryObligations(zeroSim.events, asOf, payFloor),
        paydayAllocation: alloc,
        currentPeriodAction: action,
        defaultView: planDefaultView(plan, asOf, alloc, action, plans,
          paydayOpts.debts || base.debts, Object.assign({}, paydayOpts, {
            sim: knowledgeSim,
          })),
        nextPeriodView: planNextPeriodView(plan, asOf, action, plans,
          paydayOpts.debts || base.debts, viewSim, paydayOpts),
        weekViews: planWeekViews(plan, asOf, plans,
          paydayOpts.debts || base.debts, viewSim, paydayOpts),
        // The options behind `sim`, so a caller overriding the weekly figure
        // re-simulates under the same assumptions instead of inventing its own.
        // Horizon is included so a page override still walks the master plan.
        simOptions: Object.assign({}, simOptions, {
          horizonDays: horizon.days, viewDays: view.days, viewStart: view.start,
        }),
        // The assumptions the household actually set, without the recovery the
        // engine derived from them. See where it is built, above.
        planOptions: planOptions,
        // Where the plan is tightest at the recommended level — the day that
        // stops the number being any larger. Taken from the master walk, not
        // the visible slice, so a January commitment can be the bind.
        binding: next.min,
        bindingIsReal: below(next.min.balance, buffer),
        holds: protectedAtCap.feasible,
      }, planOptions);
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

  // Amanda's owner-confirmed Tennis BC salary is two monthly streams.
  // The Plan page still has one household-income deadline, so this
  // composer zeros every Amanda salary stream and reports their combined
  // monthly amount. It does not invent a cadence. Coaching is not a
  // salary stream. The retired amandaTransfer id is not household salary.
  function isAmandaSalaryStream(stream) {
    if (!stream || stream.id === 'amandaTransfer') return false;
    return /tennis\s*bc|amandaSalary|amanda-salary|amandaEmployment|amanda-employment|amanda.?pay/i
      .test(`${stream.id || ''} ${stream.label || ''}`);
  }

  function amandaHouseholdIncomeDeadline(plan, asOf, opts) {
    const base = Object.assign({}, opts || {});
    const streams = ((plan && plan.income) || []).filter(isAmandaSalaryStream);
    const amount = Math.round(streams.reduce((sum, stream) =>
      sum + (streamAmount(stream, base) || 0), 0) * 100) / 100;
    const buffer = base.targetBuffer != null
      ? base.targetBuffer : ((plan && plan.defaults && plan.defaults.targetBuffer) || 0);
    if (!streams.length || !(amount > 0)) {
      return {
        incomeId: null, amount: 0, neededBy: null, buffer,
        breachesWithout: false, endingWithout: null,
      };
    }
    const overrides = Object.assign({}, base.incomeOverrides || {});
    for (const stream of streams.slice(1)) overrides[stream.id] = 0;
    const dep = incomeDeadline(plan, asOf, streams[0].id, Object.assign({}, base, {
      incomeOverrides: overrides,
    }));
    return Object.assign({}, dep, {
      incomeId: streams.map(s => s.id).join(','),
      amount,
    });
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
      // Debt capacity is not automatic opening-gap cash. Re-entering
      // recommend() with only this facility used to auto-draw it — the same
      // unapproved-borrowing path B70 forbids. Planned borrowing stays
      // opt-in on Forecast.plannedDebt.
      if (option.debtId) {
        return no('borrowing-not-automatic', {
          currentCrossing, gapAmount: gap.amount, available: option.available,
        });
      }

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
  //               phones. Owner-target and historical essential remainders
  //               come out of the weekly cap FIRST. Undated current-regime
  //               is reserved daily; dated card-paid services (Bell on the
  //               15th) are reserved on the planning day instead.

  //   DISCRETIONARY  dining, shopping, entertainment. What is left of the cap.
  //
  // Amounts are derived from the generated spending history in periods.json,
  // never copied into data.json — one fact, one home. data.json carries only
  // the classification, any owner override, and any explicit current-regime
  // assumption. A current-regime amount is not historical spending.
  //
  // Where a category also has dated items pointing at it (Shaw inside Telecom,
  // the lacrosse fees inside Sport), the dated amount is SUBTRACTED from the
  // gross (owner target, current-regime, or historical). Without that the
  // plan pays Shaw twice: once on the calendar and once inside the category.
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
      : b.frequency === 'quarterly' ? b.amount / 3
      : b.frequency === 'yearly' ? b.amount / 12
      : b.frequency === 'once' ? b.amount / monthsInWindow : b.amount;

    // Dated items declare which variable category they would otherwise sit in.
    const datedByCategory = {};
    const addDated = (cat, amount, label, kind) => {
      if (!cat) return;
      (datedByCategory[cat] = datedByCategory[cat] || { total: 0, items: [] });
      datedByCategory[cat].total += amount;
      datedByCategory[cat].items.push({ label, amount, kind });
    };
    for (const b of plan.bills || []) {
      if (b.needsDate) continue;
      if (!billAffectsJointCash(b, plan) && !isCardPaidBill(b, plan)) continue;
      addDated(b.budgetCategory, billMonthly(b), b.label, 'bill');
    }
    // A dated commitment is NOT automatically a draw against the recurring
    // budget for its category. The household budgets ~$250/month of ordinary
    // sports and activities AND saves separately for the Fusion and Burrard
    // fees; netting the season fees off the recurring line concluded that
    // normal sports spending was $0, which is not what the household budgeted.
    // Sinking-fund commitments are therefore tracked apart, not subtracted.
    const sinking = { total: 0, items: [] };
    const asOf = opts.asOf || opts.start || null;
    for (const c of plan.commitments || []) {
      if ((opts.disabled || []).indexOf(c.id) >= 0) continue;
      if (commitmentSettledBy(c, asOf)) continue;
      // Undated or unpriced rows are on the master plan. They are not
      // smeared across the 91-day window as if they had a due day.
      if (!c.date || c.amount == null) continue;
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
      // An owner target, when one exists, beats both a current-regime
      // assumption and the historical average. Known current recurring
      // services outrank a blended historical average. The household's
      // next 90 days are better described by what it intends to spend,
      // then by what it currently pays, than by the last eighteen months.
      const target = ownerTargetMonthly(c);
      // currentMonthly is the undated current-regime amount — services
      // already on the calendar stay in dated and are not added again.
      // Dated card-paid bills are also current-regime: they occupy dated
      // so historical Telus cannot re-enter the cap, and simulate()
      // reserves them on the planning day instead of a daily smear.
      // This is not a spending-intent target and not a second bill engine.
      const undatedCurrent = c.currentMonthly != null ? Number(c.currentMonthly) : null;
      const cardPaidMonthly = ((plan && plan.bills) || []).reduce((sum, b) => {
        if (!b || b.needsDate || b.budgetCategory !== c.id) return sum;
        if (!isCardPaidBill(b, plan)) return sum;
        return sum + billMonthly(b);
      }, 0);
      const current = undatedCurrent != null ? undatedCurrent
        : cardPaidMonthly > 0 ? cardPaidMonthly
        : null;
      const regime = current != null;
      const gross = target != null ? target
        : regime ? (undatedCurrent || 0) + dated.total
        : historical;
      const reserved = target == null && undatedCurrent != null ? undatedCurrent : 0;
      const planned = Math.max(0, gross - dated.total - reserved);
      const sinkingHere = sinking.items.filter(s => s.category === c.id)
        .reduce((a, s) => a + s.amount, 0);
      return Object.assign({}, c, {
        historical, dated: dated.total, datedItems: dated.items, target,
        current,
        // gross is the pre-dated monthly amount — owner target if one exists,
        // else current-regime (undated current + dated), else the historical
        // average. planned is that amount after dated items and reserved
        // current-regime cash are netted off, and is what the weekly cap
        // consumes. reserved stays in essential/required totals and coverage
        // so a card-paid service is not published as if it cost nothing.
        // Cap comparison uses planned only; counting reserved there would
        // overstate the essential need / shortfall against the cap.
        gross, planned, reserved,
        // Dated commitments saved for separately. Reported, never netted off
        // the recurring line for the same category.
        sinking: sinkingHere,
        // A category whose dated items already exceed its historical average is
        // fully accounted for on the calendar — the dated figure is the better
        // current authority and nothing extra belongs in the weekly cap.
        fullyDated: dated.total > 0 && gross - dated.total <= 0,
        source: target != null ? 'owner-target'
          : regime ? 'current-regime'
          : 'historical-actual',
      });
    });

    const spend = c => (c.planned || 0) + (c.reserved || 0);
    const sum = (pred, field) => categories.filter(pred)
      .reduce((s, c) => s + (field ? c[field] : spend(c)), 0);
    const isClass = k => c => c.class === k;
    const isRequired = c => c.class === 'essential' || c.class === 'unknown';

    const discretionaryMonthly = sum(isClass('discretionary'));
    // Coverage: essentials + unknown, including reserved current-regime.
    const requiredMonthly = sum(isRequired);
    // What the weekly cap must cover before anything optional happens.
    // Reserved cash is already walked on its own ledger; counting it here
    // overstates the essential need / shortfall against the cap.
    const inCapRequiredMonthly = sum(isRequired, 'planned');
    const inCapDiscretionaryMonthly = sum(isClass('discretionary'), 'planned');

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
      // The weekly cap measured against the in-cap planned remainder, when a
      // caller says which cap is on screen. Null when none was given — a
      // caller that has not named a cap is asking about the categories, not
      // for a verdict on one.
      cap: againstCap(categories, inCapRequiredMonthly, inCapDiscretionaryMonthly, opts),
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
    const priority = debtPriority(plan, debts || []);
    // Facilities that are not debt records but do carry revolving headroom —
    // the chequing overdraft. Held CONSTANT across the window on purpose: its
    // usage tracks the Chequing B balance, which the cash simulation already
    // governs, so projecting it here would model the same money twice. It is
    // included so that "revolving credit left" means the same thing in the
    // Today tile and in the scoreboard; omitting it made those disagree by
    // $82.28 under one label.
    const extraFacilities = resolveExtraFacilities(opts.extraFacilities, plan);
    const extraAvailable = extraFacilities
      .reduce((s, e) => s + Math.max(0, e.limit - (e.used + (e.pending || 0))), 0);
    // Cash `horizonDays` on simOptions is not a debt-walk length. Planned
    // debt asks for the master span explicitly via debtHorizonDays so the
    // 91-day coupled identity is not silently stretched.
    const days = opts.debtHorizonDays != null ? opts.debtHorizonDays : (plan.windowDays || 91);
    const start = asOf;
    const end = addDays(asOf, days - 1);
    const events = expandEvents(plan, start, end, opts);
    const byId = {};
    const state = (debts || []).map(x => {
      // Carrying pending charges from the opening balance is what makes
      // headroom, over-limit state and interest all agree with what the
      // institution would say today. The rule itself is `openingBalance`.
      const unknownPending = pendingUnknown(x);
      const pending = unknownPending ? null : (x.pending || 0);
      const opening = openingBalance(x);
      const s = {
        id: x.id, label: x.label, secured: !!x.secured, rate: x.rate || 0,
        limit: x.limit, opening, balance: opening,
        postedBalance: x.balance, pending, pendingUnknown: unknownPending,
        interestByEvent: !!x.interestByEvent, principalShare: x.principalShare,
        interest: 0, paid: 0, capitalised: 0, drawn: 0,
        // The day the balance actually crosses the limit. Tracked on the daily
        // walk, not read off the 30-day snapshots — a month-end capitalisation
        // can fall between marks, so reporting the next snapshot puts the
        // breach in the wrong month and on the wrong side of the plan's own
        // deadline.
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
    // Owner-policy plans receive that target from debtPriority. An explicit
    // option remains only for older synthetic callers without that policy.
    const priorityTargetId = priority.status === 'ready' && priority.target
      ? priority.target.id : null;
    const ownerPolicyApplies = priority.policy === OWNER_HIGHEST_INTEREST_POLICY
      && priority.provenance === 'owner-stated';
    const extraTarget = priorityTargetId ? byId[priorityTargetId]
      : (!ownerPolicyApplies && opts.extraDebtTarget ? byId[opts.extraDebtTarget] : null);

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
    // The order is not invented here. Forecast.debtPriority applies the
    // owner-stated highest-interest policy across eligible revolving cards and
    // the HELOC. Nothing is ever discarded, so the identity holds however
    // large the payment is.
    const chainFrom = head => {
      if (priority.status === 'ready') {
        return priority.order.map(row => byId[row.id]).filter(Boolean);
      }
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
        pendingUnknown: !!s.pendingUnknown,
        available: publishedAvailable(s.limit, s.balance, s.pendingUnknown),
        overLimit: publishedOverLimit(s.limit, s.balance, s.pendingUnknown),
        overLimitBy: publishedOverLimitBy(s.limit, s.balance, s.pendingUnknown),
        interest: s.interest, paid: s.paid, drawn: s.drawn, firstOver: s.firstOver,
      })),
      consumer: state.filter(s => !s.secured).reduce((a, s) => a + s.balance, 0),
      secured: state.filter(s => s.secured).reduce((a, s) => a + s.balance, 0),
      heloc: byId.heloc ? byId.heloc.balance : 0,
      // Revolving headroom across every facility that has a limit.
      // Unknown pending contributes nothing here — posted room is not
      // published until pending is observed.
      headroom: state.filter(s => s.limit != null)
        .reduce((a, s) => a + (publishedAvailable(s.limit, s.balance, s.pendingUnknown) || 0), 0)
        + extraAvailable,
      overLimitCount: state.filter(s => publishedOverLimit(s.limit, s.balance, s.pendingUnknown) === true).length,
      interestToDate: state.reduce((a, s) => a + s.interest, 0),
    });
    marks.push(snapshot(0, start));

    // Same application date as simulate(). A carried once cash obligation
    // keeps e.date, so obligationAbsorbed still keys the original schedule.
    const byDate = new Map();
    for (const e of events) {
      const applyOn = cashWalkDate(e, start);
      if (!byDate.has(applyOn)) byDate.set(applyOn, []);
      byDate.get(applyOn).push(e);
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0));
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
        } else if (e.kind === 'planned-debt') {
          const t = e.debtId ? byId[e.debtId] : null;
          if (!t) continue;
          const left = payDown([t], -e.amount);
          unabsorbed += left;
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
      extraDebtPriority: priority,
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
  //   EXTERNAL   jointCash === false is still eligible: the household still
  //              owes it. nextPaymentOut excludes those events because they
  //              are not cash leaving the joint-cash pool.
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
  //   EXTERNAL   jointCash === false. A household obligation paid outside
  //              the joint-cash pool is still nextDue, but it is not cash
  //              leaving the household accounts this tile measures.
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
      if (!isJointCashOutflow(event) || event.date < asOf) continue;
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

  // Posted HELOC current vs the last monthly historical observation. The
  // published Plan tile rounds that delta to whole dollars (`money()`), so the
  // compact verdict follows that dollar: a $0.40 move prints $0, and calling
  // that "still growing" is the same contradiction the unallocated remainder
  // had at four tenths of a cent. Exact zero, and any delta that rounds to
  // zero dollars, is unchanged — not growth.
  function publishedDeltaId(delta) {
    const dollars = Math.round(Math.abs(Number(delta)));
    return dollars === 0 ? 'unchanged' : (delta > 0 ? 'growing' : 'falling');
  }

  // Deep Dive captions print `money2` (cents). Classify by that published
  // cent so two different displayed balances cannot read "unchanged".
  function publishedCentsId(delta, up, down) {
    const publishedCents = Math.round(Number(delta) * 100);
    return publishedCents === 0 ? 'unchanged' : (publishedCents > 0 ? up : down);
  }

  function helocDebtRecord(debts) {
    return (debts || []).find(d => d.id === 'heloc') || null;
  }

  function helocVsPrior(debts, helocHistory) {
    const heloc = helocDebtRecord(debts);
    const history = helocHistory || [];
    const prior = history.length ? history[history.length - 1] : null;
    if (!heloc || heloc.balance == null || !prior || prior.v == null) return null;
    const delta = Number(heloc.balance) - Number(prior.v);
    return { delta, id: publishedDeltaId(delta) };
  }

  function monthYearLabel(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = Number(iso.slice(5, 7));
    if (month < 1 || month > 12) return null;
    return months[month - 1] + ' ' + iso.slice(2, 4);
  }

  function copyHelocPoint(p) {
    const row = { m: p.m, v: Number(p.v) };
    if (p.note) row.note = p.note;
    return row;
  }

  // Historical monthly observations stay in `data.helocHistory`. The current
  // opening is `debts.heloc.balance`. Deep Dive composes those; it does not
  // store today's balance a second time.
  function publishedHelocHistory(data) {
    data = data || {};
    const history = (data.helocHistory || []).map(copyHelocPoint);
    const heloc = helocDebtRecord(data.debts);
    if (!heloc || heloc.balance == null) return history;
    const label = monthYearLabel(data.meta && data.meta.asOf) || 'now';
    history.push({ m: label, v: Number(heloc.balance), note: 'current opening' });
    return history;
  }

  function lastFebruaryPoint(history) {
    let found = null;
    for (const p of history || []) {
      if (/^Feb\b/.test(p.m)) found = p;
    }
    return found;
  }

  function helocRoseEveryMonthSince(history, startIndex, current) {
    const series = [];
    for (let i = startIndex; i < (history || []).length; i++) {
      series.push(Number(history[i].v));
    }
    if (current != null) series.push(Number(current));
    if (series.length < 2) return null;
    for (let i = 1; i < series.length; i++) {
      if (!(series[i] > series[i - 1])) return false;
    }
    return true;
  }

  function helocStory(data) {
    data = data || {};
    const heloc = helocDebtRecord(data.debts);
    const history = data.helocHistory || [];
    const current = heloc && heloc.balance != null ? Number(heloc.balance) : null;
    const prior = history.length ? copyHelocPoint(history[history.length - 1]) : null;
    const vsPriorDelta = current != null && prior && prior.v != null
      ? current - Number(prior.v) : null;
    const paydown = lastFebruaryPoint(history);
    const paydownIndex = paydown ? history.lastIndexOf(paydown) : -1;
    const sincePaydown = current != null && paydown
      ? current - Number(paydown.v) : null;
    return {
      history: publishedHelocHistory(data),
      current,
      asOf: data.meta && data.meta.asOf || null,
      prior,
      vsPrior: vsPriorDelta,
      vsPriorId: vsPriorDelta == null ? null
        : publishedCentsId(vsPriorDelta, 'growing', 'falling'),
      paydown: paydown ? copyHelocPoint(paydown) : null,
      sincePaydown,
      sincePaydownId: sincePaydown == null ? null
        : publishedCentsId(sincePaydown, 'higher', 'lower'),
      roseEveryMonthSincePaydown: paydownIndex >= 0
        ? helocRoseEveryMonthSince(history, paydownIndex, current) : null,
    };
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
  // already carry. Current HELOC is the posted `debts.heloc` opening;
  // `helocHistory` is the prior monthly observation only. The published
  // tile rounds that delta to whole dollars (`money()`), so the verdict
  // follows that dollar.
  function compactSnapshot(debts, helocHistory) {
    let secured = 0;
    let annualInterest = 0;
    for (const debt of debts || []) {
      if (debt.secured) secured += debt.balance || 0;
      annualInterest += debt.annualInterest || 0;
    }
    const monthlyInterest = monthOfAnnual(annualInterest);
    return { secured, monthlyInterest, heloc: helocVsPrior(debts, helocHistory) };
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
  // historical income footer monthly figure is total / capture window,
  // rounded to a dollar. That window is an evidence fact —
  // `data.incomeCaptureMonths`, beside the historical `income` rows, the
  // same shape `paypal.months` already uses. It is not derived from
  // `periods.json` `all.months` (19 calendar buckets labelled "18 months"):
  // those are spending buckets, including a partial current month, and are
  // not the income-observation denominator. Pages format the returned
  // numbers. data.json keeps the rows being summed.
  function publicationTotals(data) {
    data = data || {};
    const debts = data.debts || [];
    const assets = assetRows(data);
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
    const incomeMonths = Number(data.incomeCaptureMonths);
    const incomeWindow = incomeMonths > 0 && isFinite(incomeMonths) ? incomeMonths : null;
    const asOf = data.meta && data.meta.asOf || null;
    const commitmentRows = ((data.plan && data.plan.commitments) || [])
      .filter(c => !commitmentSettledBy(c, asOf));
    const commitmentsTotal = commitmentRows
      .reduce((s, item) => s + (item.amount || 0), 0);
    const commitmentItems = commitmentRows.map(c => ({
      id: c.id,
      what: c.label,
      when: c.date || c.when || 'TBD',
      amount: c.amount == null ? null : c.amount,
      amountMin: c.amountMin == null ? null : c.amountMin,
      amountMax: c.amountMax == null ? null : c.amountMax,
      confidence: c.confidence,
      adjustable: !!c.adjustable,
      note: c.note || '',
    }));
    const lacrosseVerified = ((data.lacrosse && data.lacrosse.sources) || [])
      .reduce((s, row) => s + (row.amount || 0), 0);
    const revolving = utilisation(debts, data.revolvingExtra, data.plan);
    const incomeLines = (data.income || []).map(row => Object.assign({}, row, {
      perMonth: historicalIncomePerMonth(row, incomeWindow),
    }));
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
      incomePerMonth: incomeWindow ? Math.round(incomeTotal / incomeWindow) : null,
      incomeMonths: incomeWindow,
      commitmentsTotal,
      commitmentItems,
      lacrosseVerified,
      helocLimit,
      assetRows: assets,
      incomeLines,
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
  // is the spendable breakdown sum. The card rate is the Cash Back Visa
  // debt record. A month of mortgage interest is `monthOfAnnual` on that
  // debt's `annualInterest` — the same twelfth compactSnapshot uses.
  // The ±4 percentage-point fit band is the incumbent page rule, kept
  // here rather than restated.
  //
  // `period` is the selected `periods.periods` entry. Without one the
  // period block is omitted; `renderPeriod` passes the period on screen.
  const INTEREST_FIT_PP = 4;

  // Mixed essential+discretionary source types cannot publish as either class.
  // `scripts/periods.js` used to keep the first event's type and then add later
  // events into that row, so Health could read as essential only because a
  // medical merchant happened to be encountered first. The existing `unknown`
  // type already means "no clean essential/discretionary story" to Deep Dive.
  function publishedSpendType(types) {
    const unique = [];
    (types || []).forEach(t => {
      if (t && unique.indexOf(t) < 0) unique.push(t);
    });
    if (unique.length === 0) return null;
    if (unique.length === 1) return unique[0];
    return 'unknown';
  }

  function rollupSpending(events) {
    const byCat = {};
    (events || []).forEach(e => {
      const label = e.category || e.label;
      if (!label) return;
      const amount = e.amount != null ? Number(e.amount) : Number(e.total);
      if (!byCat[label]) byCat[label] = { total: 0, types: [] };
      byCat[label].total += amount || 0;
      if (e.type && byCat[label].types.indexOf(e.type) < 0) {
        byCat[label].types.push(e.type);
      }
    });
    return Object.keys(byCat).map(label => {
      const v = byCat[label];
      const row = {
        label,
        total: Math.round(v.total * 100) / 100,
        type: publishedSpendType(v.types),
      };
      if (v.types.length > 1) row.types = v.types.slice().sort();
      return row;
    }).sort((a, b) => b.total - a.total);
  }

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
    const heloc = helocStory(data);

    let periodSnap = null;
    if (period) {
      const spendingTotal = period.spendingTotal || 0;
      const months = period.months || 0;
      const discretionary = (period.spending || [])
        .filter(s => publishedSpendType(s.types || [s.type]) === 'discretionary')
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
      cashAmount: startingCashAmount(data.plan),
      elsewhere,
      classes: classOrder.map(k => byClass[k]),
      interest,
      mortgageMonthly,
      heloc,
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
  // The verdict at the top of the Plan page: which of eight conclusions the
  // household reads about the next 13 weeks, and the figures inside it.
  //
  // `public/plan.js` used to decide this, and it was the most prominent
  // financial judgement on the site that no test could reach — a mutation
  // moving the dip threshold to `sim.buffer / 2`, or the negative test to
  // `balance < 500`, left `npm test` green.
  //
  // The order is the decision, and each step earns its place:
  //
  //   0. RECOMMEND ALREADY MARKED THE PROTECTED PLAN INFEASIBLE. Copied from
  //      advice.infeasible so the band cannot read "on plan" beside that.
  //   1. A GAP NO SOURCE CAN REACH outranks everything else. At that buffer the
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

    // Recommend already decided the protected master plan cannot work.
    // Surface that here so the band cannot read "on plan" beside payday
    // INFEASIBLE. Figures are copied from advice.infeasible; nothing is
    // re-derived.
    if (advice.mode === 'infeasible' && advice.infeasible) {
      const fail = advice.infeasible;
      return {
        id: 'infeasible',
        kind: fail.kind,
        date: fail.date,
        shortfall: fail.shortfall,
        label: fail.label,
        buffer,
      };
    }

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
  //   4. OBLIGATIONS ALREADY KNOWN AT THE NEXT PAYDAY BOUNDARY. Current
  //      surplus is not free to put at debt until those named joint-cash
  //      outflows — already in the recommend event stream — have been shown.
  //      The mission names them; it does not re-price the weekly cap.
  //   5. WHAT THE SURPLUS IS FOR. A HELOC crossing its own limit inside the
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
  // reports the next snapshot after a month-end capitalisation — a different
  // month, and on the wrong side of the plan's own deadline. A facility
  // already over its limit at the start is a different fact.
  function helocLimitCrossing(debtProj) {
    return ((debtProj && debtProj.crossings) || [])
      .find(c => c.id === 'heloc' && !c.alreadyOver) || null;
  }

  function mission(advice, debtProj, opts) {
    debtProj = debtProj || {};
    const { recommended, weekly, sim, gap, funding, fundingShort, overrideBreaches }
      = planContext(advice, opts);

    // Recommend already decided the protected master plan cannot work.
    // weekly = 0 is the failure sentinel, not a feasible cap, so holdSpending
    // and surplusToCard would tell the household to spend and save as if the
    // plan held. Copy the failing constraint; do not re-derive it.
    if (advice.infeasible && advice.mode === 'infeasible') {
      const fail = advice.infeasible;
      return {
        parts: [{
          id: 'infeasible',
          kind: fail.kind,
          date: fail.date,
          shortfall: fail.shortfall,
          label: fail.label,
        }],
      };
    }

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
    const nearBoundary = advice.nearBoundary;
    if (nearBoundary && nearBoundary.items && nearBoundary.items.length) {
      parts.push({
        id: 'nearBoundary',
        payday: nearBoundary.payday,
        until: nearBoundary.until,
        total: nearBoundary.total,
        count: nearBoundary.items.length,
        items: nearBoundary.items.map(x => ({ id: x.id, label: x.label })),
      });
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
  // mission already uses. The Amanda figure is `amandaHouseholdIncomeDeadline`'s
  // combined salary amount and `neededBy`; the three-month impact is the page's
  // `amount * 3`, which on the published 91-day window equals the already-computed
  // `ending - endingWithout`. The HELOC draw is `drawnOn(funding, 'heloc')`,
  // the same sum the HELOC alternative prices. Telecom `planned` is the
  // category `budgetBreakdown` already built. The page formats; it does
  // not compare.
  //
  // `opts.transfer` is the `amandaHouseholdIncomeDeadline` result the page
  // already ran (with `notBefore` set to the gap date). `opts.alternatives` is the
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
      return p ? p.balance : startingCashAmount(plan);
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
    const opening = (sim && sim.start)
      || (sim && sim.daily && sim.daily[0] && sim.daily[0].date)
      || null;
    const estimated = (plan.commitments || []).filter(c =>
      c.confidence === 'estimated' && !disabled.has(c.id)
      && !commitmentSettledBy(c, opening));
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
    const action = (resolveActions(plan, opts && opts.debts, opts && opts.extraFacilities)[0]) || null;
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
  function utilisation(debts, extra, plan) {
    extra = resolveExtraFacilities(extra, plan);
    const rows = (debts || []).filter(x => x.limit != null).map(x => {
      const unknownPending = pendingUnknown(x);
      const pending = unknownPending ? null : (x.pending || 0);
      const used = unknownPending ? x.balance : openingBalance(x);
      return {
        id: x.id, label: x.label, posted: x.balance, pending, used, limit: x.limit,
        pendingUnknown: unknownPending,
        available: publishedAvailable(x.limit, used, unknownPending),
        overLimit: publishedOverLimit(x.limit, used, unknownPending),
        overLimitBy: publishedOverLimitBy(x.limit, used, unknownPending),
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
        pendingUnknown: false,
      });
    }
    return {
      rows,
      // The headline the Plan quotes. Pending is already inside `used`, so a
      // card that is economically full contributes nothing here.
      totalAvailable: rows.reduce((s, r) => s + (r.available || 0), 0),
      totalPending: rows.reduce((s, r) => s + (r.pending || 0), 0),
      overLimitCount: rows.filter(r => r.overLimit === true).length,
    };
  }

  /* ------------------------------------------------- credit page accounts */
  // "What do we owe?" — one debt record composed with the two incumbent
  // authorities the Credit page needs beside it: headroom from `utilisation`
  // (pending exposure included, unknown pending not $0) and the next
  // required payment from the same `expandEvents` stream the Plan calendar
  // reads, taken on or after the financial as-of. A stored `nextDue` on the
  // debt record is a dated fact about the opening, not the schedule; once
  // the schedule has moved past it the page must print the schedule.
  //
  // Nothing here is decided: ordering is by record shape (secured term debt,
  // then secured revolving, then unsecured cards, data order within each),
  // amounts are copied, and an absent fact stays null rather than becoming
  // $0, 0% or "nothing due". No payoff order, strategy or permission.
  //
  // For a capitalising facility the interest charge is `nextCapitalise` —
  // a balance increase, not household cash — and the household cash minimum
  // is `nextCashMinimum`, from the same rule the Plan bills list prints.
  // They are two different facts and are never merged into one "payment".
  function creditAccounts(plan, debts, asOf, opts) {
    opts = opts || {};
    const extra = opts.extraFacilities || null;
    const util = utilisation(debts || [], extra, plan);
    const utilById = new Map((util.rows || []).map(r => [r.id, r]));
    const horizon = knowledgeHorizon(plan, asOf, opts);
    const events = expandEvents(plan, asOf, horizon.end, opts);
    const obligations = (plan && plan.obligations) || [];

    const firstEvent = (debtId, predicate) => {
      let best = null;
      for (const e of events || []) {
        if (!e || e.debtId !== debtId || e.date < asOf) continue;
        if (!predicate(e)) continue;
        if (!best || e.date < best.date) best = e;
      }
      return best;
    };
    const paymentFact = e => e ? {
      id: e.id || null,
      label: e.label,
      date: e.date,
      amount: roundCent(-e.amount),
      confidence: e.confidence || null,
      payingAccount: e.payingAccount || null,
    } : null;

    const shape = d => d.secured ? (d.limit == null ? 'secured-term' : 'secured-revolving') : 'card';
    const SHAPE_ORDER = { 'secured-term': 0, 'secured-revolving': 1, card: 2 };
    const rows = (debts || []).map((d, index) => {
      const u = utilById.get(d.id) || null;
      const unknownPending = pendingUnknown(d);
      const nextPayment = paymentFact(firstEvent(d.id, e => e.kind === 'obligation' && e.effect === 'payment'));
      const capEvent = firstEvent(d.id, e => e.kind === 'noncash' && e.effect === 'capitalise');
      let nextCashMinimum = null;
      for (const o of obligations) {
        if (!o || o.debtId !== d.id) continue;
        for (const occ of capitalisingCashMinimumOccurrences(o, asOf, horizon.end)) {
          if (!nextCashMinimum || occ.date < nextCashMinimum.date) {
            nextCashMinimum = {
              id: occ.id, label: occ.label, date: occ.date, amount: occ.amount,
              confidence: occ.confidence, payingAccount: occ.payingAccount,
            };
          }
        }
      }
      return {
        id: d.id,
        label: d.label,
        institution: d.institution || null,
        shape: shape(d),
        secured: d.secured === true,
        confidence: d.confidence || null,
        structure: d.structure || null,
        balance: d.balance != null && isFinite(Number(d.balance)) ? Number(d.balance) : null,
        pending: unknownPending ? null : (d.pending != null ? Number(d.pending) || 0 : 0),
        pendingUnknown: unknownPending,
        limit: d.limit != null && isFinite(Number(d.limit)) ? Number(d.limit) : null,
        available: u ? u.available : null,
        used: u ? u.used : null,
        overLimit: u ? u.overLimit : false,
        overLimitBy: u ? u.overLimitBy : 0,
        pct: u ? u.pct : null,
        rate: d.rate != null && isFinite(Number(d.rate)) ? Number(d.rate) : null,
        rateBasis: d.rateBasis || null,
        rateConvention: d.rateConvention || null,
        regularPayment: d.payment != null && isFinite(Number(d.payment)) ? roundCent(d.payment) : null,
        frequency: d.frequency || null,
        interestTreatment: d.interestTreatment || null,
        monthlyInterest: d.monthlyInterest != null && isFinite(Number(d.monthlyInterest))
          ? roundCent(d.monthlyInterest) : null,
        nextPayment,
        nextCapitalise: capEvent ? {
          id: capEvent.id || null, label: capEvent.label, date: capEvent.date,
          amount: roundCent(-capEvent.amount), confidence: capEvent.confidence || null,
        } : null,
        nextCashMinimum,
        index,
      };
    });
    rows.sort((a, b) => (SHAPE_ORDER[a.shape] - SHAPE_ORDER[b.shape]) || (a.index - b.index));
    for (const r of rows) delete r.index;
    return {
      asOf,
      horizonEnd: horizon.end,
      secured: rows.filter(r => r.secured),
      cards: rows.filter(r => !r.secured),
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

  const Forecast = { HOUSEHOLD_TIMEZONE, financialDate, addDays, diffDays, occurrences, commitmentSettledOn, commitmentSettledBy, commitmentStatus, billIsHouseholdObligation, billAffectsJointCash, isCardPaidBill, carriedOnceJointCashOutflow, prepaidJointCashOutflow, expandEvents, simulate, establishPaydaySnapshot,
    knowledgeHorizon, viewRange, commitmentNeed, fundingSequence, majorPlans, plannedDebt, debtPriority, paydayAllocation,
    classifyCurrentPeriodTransaction, paydayPeriodOrigin, currentPeriodObligationStates, currentPeriodAction,
    spendingCycle,
    recommendWeekly, recommend, incomeDeadline, amandaHouseholdIncomeDeadline, counterfactuals,
    budgetBreakdown, monthlyFromWeekly,
    projectDebts,
    nextDue, nextPaymentOut, unallocatedCash, compactSnapshot, publicationTotals, deepDive, publishedSpendType, rollupSpending, planStatus, mission, planPhases, nextMove, utilisation, creditAccounts, capitalisingCashMinimumOccurrences, renewal,
    payoffDebts, payoffModel,
    paymentForMonths, startingCashAmount, resolveFundingSources, resolveActions, EPSILON, STEP };
  if (typeof module !== 'undefined' && module.exports) module.exports = Forecast;
  else root.Forecast = Forecast;

})(typeof window !== 'undefined' ? window : globalThis);
