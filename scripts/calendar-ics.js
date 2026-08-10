// Build an importable calendar of every payment date.  [B29]
//
//   node scripts/calendar-ics.js [asOf YYYY-MM-DD]
//
// Writes derived/household-payments.ics — import it into Google Calendar and
// every due date, statement close and renewal deadline appears with reminders
// already attached.
//
// Everything here is sourced from docs/ACCOUNT_FACTS.md and, for the household
// bills, from the recurrence actually observed in 18 months of chequing data
// rather than from what a bill says. Where the real dates wander (BC Hydro),
// the event says so instead of pretending to a precision it does not have.
//
// Amounts are the CURRENT minimum, not a fixed obligation. Minimums move with
// the balance — the Cash Back Visa's went from $69.93 to $762.36 in one cycle
// when the balance crossed the limit — so each event says what it is a snapshot
// of and when it was read.

const fs = require('fs');
const path = require('path');

const asOf = process.argv[2] || '2026-08-09';
const STAMP = asOf.replace(/-/g, '') + 'T120000Z';
const OUT = path.join(__dirname, '..', 'derived', 'household-payments.ics');

// --- ics plumbing -----------------------------------------------------------
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
                          .replace(/,/g, '\\,').replace(/\n/g, '\\n');

// RFC 5545 caps a line at 75 octets; longer lines continue with a leading
// space. Google tolerates over-long lines, other clients do not.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const take = i === 0 ? 75 : 74;
    let end = Math.min(i + take, bytes.length);
    // never split a multi-byte character
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

let seq = 0;
function vevent({ summary, start, rrule, description, alarms = 'full' }) {
  const uid = `atlas-${String(++seq).padStart(3, '0')}-${dateOnly(start)}@household`;
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${STAMP}`,
    `DTSTART;VALUE=DATE:${dateOnly(start)}`,
    `DTEND;VALUE=DATE:${nextDay(start)}`,
    `SUMMARY:${esc(summary)}`,
    `DESCRIPTION:${esc(description)}`,
    'TRANSP:TRANSPARENT',
  ];
  if (rrule) lines.push(`RRULE:${rrule}`);
  // All-day events start at 00:00, so a trigger of -P2DT15H fires at 09:00
  // three days earlier, and PT9H fires at 09:00 on the day itself.
  if (alarms === 'full') {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`,
               'TRIGGER:-P2DT15H', 'END:VALARM');
  }
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(summary)}`,
             'TRIGGER:PT9H', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}

const MONTHLY = d => `FREQ=MONTHLY;BYMONTHDAY=${d}`;
const src = `\n\nFrom the household finance review, read from the institutions on ${asOf}. Amount is the minimum at that date and moves with the balance.`;

// --- the seven debt payments ------------------------------------------------
const events = [
  { summary: 'TD Cash Back Visa — minimum $762.36', start: '2026-09-01', rrule: MONTHLY(1),
    description: 'The largest card minimum in the household, and eleven times the previous month\'s $69.93 — going over the limit makes the whole excess immediately due on top of the ordinary minimum.\n\nThe balance is about $612 over its $5,000 limit, which costs a $29.00 over-limit fee every statement. Getting it under $5,000 before the 7th stops that fee: a 56.8% annual return on roughly $612, and the cheapest single action available.' + src },

  { summary: 'Triangle Mastercard — minimum ~$253.57', start: '2026-09-07', rrule: MONTHLY(7),
    description: 'Canadian Tire Bank, 21.99%. $13,497 against a $13,500 limit.\n\nThis is the largest interest cost of any card — about $2,880 a year — but the real problem is not the rate. Five statements show $3,880 paid and the balance down $189, because roughly $498/month of new purchases offset the payments. Paying it down without stopping the spending on it does almost nothing.' + src },

  { summary: 'Mortgage — $1,600.00 (bi-weekly)', start: '2026-08-14',
    rrule: 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20270501',
    description: 'TD, 3.64% variable. $762.27 interest / $837.73 principal — 52.4% of each payment buys equity.\n\nThe required payment is about $1,365, so roughly $235 of every payment is voluntary overpayment. That is about $6,110 a year and has taken roughly 8 years off the amortisation.\n\nThis recurrence STOPS at the 1 May 2027 maturity, because the payment after renewal is not yet known.' + src },

  { summary: 'TD personal Visa — minimum $94.03', start: '2026-08-17', rrule: MONTHLY(17),
    description: 'The one to never miss. The card is on a 24.99% PENALTY rate; the normal rate is 17.20%.\n\nRestoration needs 12 consecutive on-time minimum payments — money already owed. It is worth about $140/year on today\'s balance for no extra outlay at all, only for not missing one. The count is currently at zero, restarted by the July 2026 miss.' + src },

  { summary: 'HELOC — minimum ~$814.18 (interest only)', start: '2026-08-21', rrule: MONTHLY(21),
    description: 'TD, 4.90% variable, $201,586 against a $202,654 limit — 99.5% drawn.\n\nThe minimum EQUALS the monthly interest charge. Paying it reduces the principal by nothing at all: the balance is unchanged the day after. Over 18 months $86,514 left this facility and $78,177 came back, which is a chequing account, not a loan being repaid.' + src },

  { summary: 'Travel Visa — minimum $17.00', start: '2026-08-26', rrule: MONTHLY(26),
    description: 'TD business Visa, 19.99% — the lowest card rate in the household. Limit $1,100, the smallest, and it sits at about 98% of it.\n\nSmall balance, but it moved $33,644 of purchases in twelve months by being paid off and reused 293 times. Watch pending charges: they have taken it over the limit before, and over the limit turns a $17 minimum into something far larger.' + src },

  { summary: 'Amazon.ca Rewards Mastercard (MBNA) — minimum $158.27', start: '2026-08-31',
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1',
    description: 'MBNA, 21.74%. $7,855 against an $8,000 limit, with about $63 of room left.\n\nEvery dollar of this was built in eight months from a $0.00 opening balance in January 2026. At minimum payments the issuer\'s own estimate is 64 years 3 months to clear it.' + src },
];

// --- statement close dates --------------------------------------------------
// The statement is when the next minimum is set, so it is the moment to look
// rather than a thing to pay. Morning-of reminder only.
for (const [day, card, note] of [
  [5,  'Travel Visa',          'Watch for pending charges pushing it over the $1,100 limit.'],
  [6,  'Amazon / MBNA',        'Sets the minimum due at month end.'],
  [7,  'TD Cash Back Visa',    'Check whether the $29.00 over-limit fee was charged again, and what the new minimum is — it swings hard on this card.'],
  [17, 'Triangle Mastercard',  'Sets the minimum due on the 7th.'],
  [23, 'TD personal Visa',     'Sets the minimum due on the 17th. Also the place to confirm the on-time-payment count towards restoring the 17.20% rate.'],
]) {
  const first = `2026-0${day <= 9 ? '9' : '8'}-${String(day).padStart(2, '0')}`;
  events.push({
    summary: `${card} — statement closes`, start: first, rrule: MONTHLY(day),
    alarms: 'day-of',
    description: `${note}\n\nNot a payment date — this is when the amount you owe next is decided.` + src,
  });
}

// --- fixed-date household bills ---------------------------------------------
events.push(
  { summary: 'BCAA auto insurance — $82.96', start: '2026-09-15', rrule: MONTHLY(15),
    alarms: 'day-of',
    description: 'Charged on the 15th, or the next business day. Ran at $88.10 until November 2025 and $82.96 since. 18 of 18 months in the record.' + src },

  { summary: 'RESP contribution — $100.00', start: '2026-09-15', rrule: MONTHLY(15),
    alarms: 'day-of',
    description: 'To TD Waterhouse, 15th monthly, 18 of 18 months. The RESP holds $31,555.85 and is education-restricted — it is not emergency cash.' + src },

  { summary: 'Union dues (CMAW Local 1995) — $25.00', start: '2026-09-15', rrule: MONTHLY(15),
    alarms: 'day-of',
    description: '15th monthly, 18 of 18 months.' + src },

  { summary: 'FortisBC gas — ~$124.00', start: '2026-09-01', rrule: MONTHLY(1),
    alarms: 'day-of',
    description: 'Lands between the 30th and the 4th. Was $105 through winter, $124 since May 2026.' + src },

  // BC Hydro deliberately has no event. It moved to Amanda's DEBT&PAYMENTS
  // account in May 2026 and she has paid it there since — $235, $250, $250.
  // A household reminder for a bill the household no longer pays would be a
  // second authority contradicting ACCOUNT_FACTS, and would invite paying it
  // twice. If it ever returns to a household account, add it back here.
);

// --- tax --------------------------------------------------------------------
events.push(
  { summary: 'Maple Ridge property tax due', start: '2027-07-02', rrule: 'FREQ=YEARLY',
    description: 'BC municipal property tax falls due on the first business day of July. 1 July is Canada Day, so it is normally the 2nd.\n\nIn 2026 this was $5,639.67 and it was PAID FROM THE HELOC — a predictable annual bill converted into permanent debt at 4.90% on a facility that never amortises. Worth funding another way if at all possible.\n\nCheck the Home Owner Grant on the notice: in BC it has to be claimed every year, separately, and it is worth several hundred dollars if you qualify. It is not applied automatically.' + src },

  { summary: 'CRA — tax filing and any balance owing', start: '2027-04-30', rrule: 'FREQ=YEARLY',
    description: 'Filing deadline and the date any balance owing is due for most individuals. If either of you is self-employed, the filing deadline is 15 June but any balance owing is still due 30 April.\n\nA $400 CRA amount was paid from the HELOC in July 2026. If instalments are ever required they fall on 15 March, 15 June, 15 September and 15 December.\n\nBoth businesses need to be separated before this is straightforward — an accountant\'s question.' + src },
);

// --- the mortgage renewal, which is the consequential one -------------------
events.push(
  { summary: 'Mortgage renewal — start collecting quotes (6 months out)', start: '2026-11-02',
    description: 'The mortgage matures 1 May 2027. Nothing can be locked yet, but this is the point to start gathering competing offers so you are comparing rather than accepting.\n\nThe live question is whether to fold the interest-only HELOC into the mortgage. The HELOC is $201,586 at 4.90% and 99.5% drawn; folding it in would force principal repayment and lower the rate, at the cost of a higher monthly payment. The renewal modeller on the site runs that trade-off.\n\nLoan-to-value on the mortgage and HELOC together is roughly 53–68% depending on where the home valuation lands — under 80% at both ends, so it should renew conventionally on that measure. A lender will order its own appraisal and will not take an owner estimate.' },

  { summary: 'Mortgage renewal — 150 days out: TD can hold a rate for existing clients', start: '2026-12-02',
    description: 'TD\'s standard rate hold is 120 days, extendable to about 150 for existing clients. From roughly today, ask TD to hold a rate.\n\nA held rate is a floor, not a commitment — if rates fall before maturity you normally get the lower one, and if they rise you keep the hold. There is no cost to asking.\n\nSources:\nhttps://www.td.com/ca/en/personal-banking/products/mortgages/renew-refinance/how-to-renew\nhttps://truemortgageplus.com/guides/how-early-can-i-renew-my-td-mortgage/' },

  { summary: 'Mortgage renewal — 120-day window OPENS (renew with no prepayment charge)', start: '2027-01-01',
    description: 'Exactly 120 days before the 1 May 2027 maturity. From today TD lets you renew a closed mortgage early WITHOUT a prepayment charge or fee, and this is the standard rate-hold window across lenders — so it is also the point at which switching to another lender becomes practical.\n\nIf you are going to move lenders, start now: a switch needs time for approval, appraisal and discharge, and leaving it to April means renewing under time pressure with whatever is offered.\n\nSources:\nhttps://www.td.com/ca/en/personal-banking/products/mortgages/renew-refinance/how-to-renew\nhttps://mortgagerenewalhub.ca/early-mortgage-renewal/' },

  { summary: 'Mortgage renewal — TD offer letter should have arrived', start: '2027-04-01',
    description: 'TD usually posts the renewal offer about a month before maturity. If nothing has arrived, chase it.\n\nThe posted renewal rate is an opening offer, not a fixed price. It is normal to negotiate it, and having a competing quote in hand is what makes that work.' },

  { summary: '⚠ MORTGAGE MATURES — $546,027 at 3.64%', start: '2027-05-01',
    description: 'The single most consequential date in the whole picture. 60-month term taken 1 May 2022 at TD Mortgage Prime − 0.96%.\n\nIf nothing is signed by today the mortgage typically rolls onto a short open or posted-rate term, which is materially more expensive. Do not let it arrive undecided.\n\nBalance about $546,027, 17 yr 9 mth of amortisation remaining, $1,600 bi-weekly.' },
);

// --- emit -------------------------------------------------------------------
const body = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//atlas-financial//household payments//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'X-WR-CALNAME:Bills & payments',
  'X-WR-TIMEZONE:America/Vancouver',
  `X-WR-CALDESC:${esc('Every payment date, statement close and renewal deadline. Generated ' + asOf + ' by scripts/calendar-ics.js. Amounts are minimums as at that date and move with the balance.')}`,
  ...events.flatMap(vevent),
  'END:VCALENDAR',
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body.map(fold).join('\r\n') + '\r\n');

console.log(`Wrote ${OUT}`);
console.log(`${events.length} events\n`);
for (const e of events) {
  const when = e.rrule ? (e.rrule.includes('YEARLY') ? 'yearly'
                        : e.rrule.includes('WEEKLY') ? 'bi-weekly'
                        : 'monthly, day ' + (e.rrule.match(/BYMONTHDAY=(-?\d+)/) || [])[1])
                       : 'once';
  console.log('  ' + e.start + '  ' + when.padEnd(20) + e.summary);
}
