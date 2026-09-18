# BC Hydro equal monthly payment — 2026-09-09 annual adjustment

**Record status:** Sanitized owner evidence for canonical plan integration  
**As of:** 9 September 2026  
**Owner:** Dale  
**Source:** Dale Gmail, sender `notifications@bchydro.com`, annual adjustment notice

This file is source intake, not a second standing-fact or publication
authority. Standing terms live in `docs/ACCOUNT_FACTS.md`. The live cash
schedule lives in `data.json` `plan.bills`. Forecast remains the planner.

Do not store or surface utility account numbers, payment credentials, or
the home address in derived views. The notice identified the household
service address; that address is not restated here.

```evidence-ids
BILL-HYD-005
```

## What the notice establishes

- The household is on BC Hydro’s **equal monthly payments** plan.
- The current monthly amount was **$234**.
- **On the next bill the monthly amount becomes $199.00.** That amount
  is owner-confirmed. It is not a confirmed payment/due date.
- **−$53.08 credit still on the Hydro account** as of this notice.
  When the $199 equal payment posts, cash charged is **$145.92**
  ($199 − $53.08). Later months are full $199 after the credit is
  consumed. This is a utility-account credit, not chequing income on
  9 September. Owner MyHydro screenshot this turn (`BILL-HYD-006`)
  corroborates the same **$53.08 Credit** current balance and a
  9 September 2026 bill amount of **−$53.08**. The screenshot's
  **5 September – 6 October 2026** billing period is a period window
  only — not payment/due-date evidence.
- Next annual adjustment: **September 2027**.
- Cadence: monthly. Notices typically around the **9th–11th**. That
  window is not evidence that cash is due or posts on the 9th.
- Earlier 2026 equal-payment history: February had been **$207**, then
  stepped to **$234**. Those are historical steps, not this forward
  schedule.

## What this is not

- Not a usage-based or metered amount for any month.
- Not a confirmed cash-calendar payment/due date of 9 October.
  Notices ~9th–11th are a notice window, not posting proof. The
  MyHydro billing period 5 September – 6 October 2026 is likewise a
  period window, not a due.
- Not +$53.08 joint cash / chequing income on 9 September. The
  $53.08 is a utility-account credit that nets the next Hydro cash
  outflow.
- Not a rewrite of the 1 September 2026 dated due
  (`hydro-due-sep1`, $237.45), which remains the settlement identity for
  that once occurrence.
- Not permission to invent other utilities or change Fortis / Shaw.
- Not a 2027 equal-payment amount. September 2027 is the next review;
  that later figure is unknown until the notice.

## Canonical routing

`BILL-HYD-005` is consumed as `plan.bills` id `hydro-equal-payment`:
monthly $199 (owner-confirmed amount and cadence), estimated
`firstDue` 2026-10-01 (start of the next-bill month; payment day is
unknown — the ~9–11th window is notice arrival, not a due date),
`payingAccount` chequing-a / BILLS ACCOUNT, `confidence` estimated.
`utilityAccountCredit` $53.08 as-of 2026-09-09 nets the first cadence
cash occurrence to $145.92; later months remain $199. The Sep. 1 once
row stays.
