// Build an importable calendar of every payment date.  [B29, B74]
//
//   node scripts/calendar-ics.js [asOf YYYY-MM-DD]
//
// Writes derived/household-payments.ics — import it into Google Calendar.
//
// Cash-payment VEVENTs are DERIVED from the Plan via Forecast.expandEvents —
// the same expander the Plan calendar, nextPaymentOut and nextDue already
// use. Standing reminders (statement closes, tax deadlines, mortgage renewal)
// are a thin overlay for look-points that are not household cash movements.
// A reminder must never masquerade as a chequing outflow.

const fs = require('fs');
const path = require('path');
const Forecast = require('../public/forecast.js');
const data = require('../data.json');

const DEFAULT_AS_OF = (data.meta && data.meta.asOf) || '2026-08-09';
// Through mortgage maturity: longer than the 91-day Plan display, still the
// same expander rather than a second recurrence engine.
const ICS_HORIZON_END = '2027-05-01';
const OUT = path.join(__dirname, '..', 'derived', 'household-payments.ics');

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
                          .replace(/,/g, '\\,').replace(/\n/g, '\\n');

function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const take = i === 0 ? 75 : 74;
    let end = Math.min(i + take, bytes.length);
    while (end > i && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((i === 0 ? '' : ' ') + bytes.slice(i, end).toString('utf8'));
    i = end;
  }
  return out.join('\r\n');
}

const dateOnly = d => d.replace(/-/g, '');
const nextDay = d => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, '');
};

const MONTHLY = d => `FREQ=MONTHLY;BYMONTHDAY=${d}`;

function planItem(plan, id) {
  for (const list of [plan.income, plan.obligations, plan.bills, plan.commitments]) {
    const hit = (list || []).find(x => x.id === id);
    if (hit) return hit;
  }
  return null;
}

function money(n) {
  return Number(n).toFixed(2);
}

function paymentDescription(plan, event, asOf) {
  const item = planItem(plan, event.id);
  const note = item && item.note ? item.note.trim() : '';
  const confidence = event.confidence || (item && item.confidence) || 'estimated';
  return [
    `Household cash payment of $${money(-event.amount)}.`,
    note,
    `Kind: household cash payment — not a reminder. Derived from the Plan (${event.id}) on ${asOf}. Tagged ${confidence}.`,
  ].filter(Boolean).join('\n\n');
}

function householdObligationDescription(plan, event, asOf) {
  const item = planItem(plan, event.id);
  const note = item && item.note ? item.note.trim() : '';
  const payer = event.payingAccount || (item && item.payingAccount) || 'an account outside the joint-cash pool';
  return [
    `Household obligation of $${money(Math.abs(event.amount))}. Paid from ${payer} — not a joint-cash outflow.`,
    note,
    `Kind: reminder — household obligation, not a chequing outflow from the joint-cash pool. Derived from the Plan (${event.id}) on ${asOf}.`,
  ].filter(Boolean).join('\n\n');
}

function noncashDescription(plan, event, asOf) {
  const item = planItem(plan, event.id);
  const note = item && item.note ? item.note.trim() : '';
  return [
    `Reminder only. ${event.label} of $${money(Math.abs(event.amount))} is capitalised — no cash leaves a chequing account.`,
    note,
    `Kind: reminder — not a chequing outflow. Derived from the Plan non-cash obligation (${event.id}) on ${asOf}.`,
  ].filter(Boolean).join('\n\n');
}

function vevent(stamp, { uid, summary, start, rrule, description, alarms = 'full', kind }) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dateOnly(start)}`,
    `DTEND;VALUE=DATE:${nextDay(start)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    `CATEGORIES:${kind === 'payment' ? 'PAYMENT' : 'REMINDER'}`,
    `X-ATLAS-KIND:${kind === 'payment' ? 'payment' : 'reminder'}`,
    'TRANSP:TRANSPARENT',
  ];
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (alarms === 'full') {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`,
               'TRIGGER:-P2DT15H', 'END:VALARM');
  }
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`,
             'TRIGGER:PT9H', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

function standingReminders(asOf) {
  const src = `\n\nKind: reminder — not a chequing outflow. Standing look-point from the household finance review, read from the institutions on ${asOf}.`;
  const events = [];

  for (const [day, card, note] of [
    [5,  'Travel Visa',          'Watch for pending charges pushing it over the $1,100 limit.'],
    [6,  'Amazon / MBNA',        'Sets the minimum due at month end.'],
    [7,  'TD Cash Back Visa',    'Check whether the $29.00 over-limit fee was charged again, and what the new minimum is — it swings hard on this card.'],
    [17, 'Triangle Mastercard',  'Sets the minimum due on the 7th.'],
    [23, 'TD personal Visa',     'Sets the minimum due on the 17th. Also the place to confirm the on-time-payment count towards restoring the 17.20% rate.'],
  ]) {
    const first = day <= 9 ? `2026-09-${String(day).padStart(2, '0')}`
                           : `2026-08-${String(day).padStart(2, '0')}`;
    events.push({
      uid: `atlas-reminder-stmt-${day}@household`,
      summary: `Reminder — ${card} statement closes`,
      start: first,
      rrule: MONTHLY(day),
      alarms: 'day-of',
      kind: 'reminder',
      description: `${note}\n\nNot a payment date — this is when the amount you owe next is decided.` + src,
    });
  }

  events.push(
    { uid: 'atlas-reminder-heloc-due-21@household',
      summary: 'Reminder — HELOC contractual due date (TD-stated 21st; not a chequing outflow)',
      start: '2026-08-21', rrule: MONTHLY(21),
      kind: 'reminder',
      sourceId: 'heloc-contractual-due',
      description: 'TD Home Equity FlexLine contractual due date. Observed posting is month-end capitalisation into the HELOC balance (~$814), not a cash payment from chequing. The Plan bills list may show the planned BILLS ACCOUNT cash minimum once; that print is not a second expandEvents chequing outflow. Statements show a PAD around the 1st and that a manual payment at least equal to the minimum, made before the due date, satisfies that minimum rather than causing a second full cash collection. This reminder is a look-point only. Q19 ANSWERED 2026-08-18: the 14 August $1,100 already inside the 2026-08-16 opening satisfies the $814.18 August minimum, so remaining August HELOC cash requirement is $0 additional. Do not invent another $814.18 chequing outflow. Interest is not free. This reminder does not state that an Aug. 1 PAD occurred.' + src },
    { uid: 'atlas-reminder-property-tax@household',
      summary: 'Reminder — Maple Ridge property tax due', start: '2027-07-02', rrule: 'FREQ=YEARLY',
      kind: 'reminder',
      description: 'BC municipal property tax falls due on the first business day of July. 1 July is Canada Day, so it is normally the 2nd.\n\nIn 2026 this was $5,639.67 and it was PAID FROM THE HELOC — a predictable annual bill converted into permanent debt at 4.90% on a facility that never amortises. Worth funding another way if at all possible.\n\nCheck the Home Owner Grant on the notice: in BC it has to be claimed every year, separately, and it is worth several hundred dollars if you qualify. It is not applied automatically.' + src },
    { uid: 'atlas-reminder-cra@household',
      summary: 'Reminder — CRA tax filing and any balance owing', start: '2027-04-30', rrule: 'FREQ=YEARLY',
      kind: 'reminder',
      description: 'Filing deadline and the date any balance owing is due for most individuals. If either of you is self-employed, the filing deadline is 15 June but any balance owing is still due 30 April.\n\nA $400 CRA amount was paid from the HELOC in July 2026. If instalments are ever required they fall on 15 March, 15 June, 15 September and 15 December.\n\nBoth businesses need to be separated before this is straightforward — an accountant\'s question.' + src },
    { uid: 'atlas-reminder-renewal-quotes@household',
      summary: 'Reminder — Mortgage renewal: start collecting quotes (6 months out)', start: '2026-11-02',
      kind: 'reminder',
      description: 'The mortgage matures 1 May 2027. Nothing can be locked yet, but this is the point to start gathering competing offers so you are comparing rather than accepting.\n\nThe live question is whether to fold the interest-only HELOC into the mortgage. The HELOC is $201,586 at 4.90% and 99.5% drawn; folding it in would force principal repayment and lower the rate, at the cost of a higher monthly payment. The renewal modeller on the site runs that trade-off.\n\nLoan-to-value on the mortgage and HELOC together is about 62% at the 2026-08-29 $1.20m planning home estimate — under 80%. The $1.30m figure is an optimistic high only, not the plan. A lender will order its own appraisal and will not take an owner estimate.' + src },
    { uid: 'atlas-reminder-renewal-hold@household',
      summary: 'Reminder — Mortgage renewal: 150 days out, TD can hold a rate for existing clients', start: '2026-12-02',
      kind: 'reminder',
      description: 'TD\'s standard rate hold is 120 days, extendable to about 150 for existing clients. From roughly today, ask TD to hold a rate.\n\nA held rate is a floor, not a commitment — if rates fall before maturity you normally get the lower one, and if they rise you keep the hold. There is no cost to asking.\n\nSources:\nhttps://www.td.com/ca/en/personal-banking/products/mortgages/renew-refinance/how-to-renew\nhttps://truemortgageplus.com/guides/how-early-can-i-renew-my-td-mortgage/' + src },
    { uid: 'atlas-reminder-renewal-window@household',
      summary: 'Reminder — Mortgage renewal: 120-day window OPENS (renew with no prepayment charge)', start: '2027-01-01',
      kind: 'reminder',
      description: 'Exactly 120 days before the 1 May 2027 maturity. From today TD lets you renew a closed mortgage early WITHOUT a prepayment charge or fee, and this is the standard rate-hold window across lenders — so it is also the point at which switching to another lender becomes practical.\n\nIf you are going to move lenders, start now: a switch needs time for approval, appraisal and discharge, and leaving it to April means renewing under time pressure with whatever is offered.\n\nSources:\nhttps://www.td.com/ca/en/personal-banking/products/mortgages/renew-refinance/how-to-renew\nhttps://mortgagerenewalhub.ca/early-mortgage-renewal/' + src },
    { uid: 'atlas-reminder-renewal-letter@household',
      summary: 'Reminder — Mortgage renewal: TD offer letter should have arrived', start: '2027-04-01',
      kind: 'reminder',
      description: 'TD usually posts the renewal offer about a month before maturity. If nothing has arrived, chase it.\n\nThe posted renewal rate is an opening offer, not a fixed price. It is normal to negotiate it, and having a competing quote in hand is what makes that work.' + src },
    { uid: 'atlas-reminder-maturity@household',
      summary: 'Reminder — MORTGAGE MATURES', start: '2027-05-01',
      kind: 'reminder',
      description: 'The single most consequential date in the whole picture. 60-month term taken 1 May 2022 at TD Mortgage Prime − 0.96%.\n\nIf nothing is signed by today the mortgage typically rolls onto a short open or posted-rate term, which is materially more expensive. Do not let it arrive undecided.\n\nBalance about $546,027, 17 yr 9 mth of amortisation remaining, $1,600 bi-weekly.' + src },
  );

  return events;
}

function buildHouseholdCalendar(plan, asOf, end) {
  asOf = asOf || DEFAULT_AS_OF;
  end = end || ICS_HORIZON_END;
  const stamp = asOf.replace(/-/g, '') + 'T120000Z';
  const stream = Forecast.expandEvents(plan, asOf, end, {});

  const payments = [];
  const derivedReminders = [];
  for (const event of stream) {
    if (event.kind === 'noncash' || event.jointCash === false) {
      const external = event.jointCash === false;
      derivedReminders.push({
        uid: `atlas-reminder-${event.id}-${dateOnly(event.date)}@household`,
        summary: external
          ? `Reminder — ${event.label} (household obligation; not joint cash)`
          : `Reminder — ${event.label} (no cash leaves chequing)`,
        start: event.date,
        kind: 'reminder',
        alarms: 'day-of',
        description: external
          ? householdObligationDescription(plan, event, asOf)
          : noncashDescription(plan, event, asOf),
        sourceId: event.id,
        amount: Math.abs(event.amount),
      });
      continue;
    }
    if (!(event.amount < 0)) continue;
    payments.push({
      uid: `atlas-pay-${event.id}-${dateOnly(event.date)}@household`,
      summary: `${event.label} — $${money(-event.amount)}`,
      start: event.date,
      kind: 'payment',
      description: paymentDescription(plan, event, asOf),
      sourceId: event.id,
      amount: -event.amount,
    });
  }

  const reminders = derivedReminders.concat(standingReminders(asOf));
  const events = payments.concat(reminders);
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//atlas-financial//household payments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Bills & payments',
    'X-WR-TIMEZONE:' + Forecast.HOUSEHOLD_TIMEZONE,
    `X-WR-CALDESC:${esc('Household cash payments derived from the Plan, plus reminder-only look-points (statement closes, tax, mortgage renewal). Generated ' + asOf + ' by scripts/calendar-ics.js. Payment amounts are the Plan figures as at that date.')}`,
    ...events.flatMap(e => vevent(stamp, e)),
    'END:VCALENDAR',
  ];

  return {
    ics: body.map(fold).join('\r\n') + '\r\n',
    payments,
    reminders,
    events,
    asOf,
    end,
  };
}

function writeHouseholdCalendar(asOf, end) {
  const built = buildHouseholdCalendar(data.plan, asOf, end);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, built.ics);
  return built;
}

if (require.main === module) {
  const asOf = process.argv[2] || DEFAULT_AS_OF;
  const built = writeHouseholdCalendar(asOf);
  console.log(`Wrote ${OUT}`);
  console.log(`${built.payments.length} payment occurrences, ${built.reminders.length} reminders\n`);
  for (const e of built.events) {
    const when = e.rrule ? (e.rrule.includes('YEARLY') ? 'yearly'
                          : e.rrule.includes('WEEKLY') ? 'bi-weekly'
                          : 'monthly, day ' + (e.rrule.match(/BYMONTHDAY=(-?\d+)/) || [])[1])
                         : 'once';
    console.log('  ' + e.start + '  ' + String(when).padEnd(20) + e.summary);
  }
}

module.exports = {
  buildHouseholdCalendar,
  writeHouseholdCalendar,
  ICS_HORIZON_END,
  DEFAULT_AS_OF,
};
