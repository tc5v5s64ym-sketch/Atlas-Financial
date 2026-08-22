# Backlog

**Work that can be done.** Questions only the household can answer live in
`docs/01_OPEN_QUESTIONS.md` — keep the two apart. If an item needs a human to
*know* something, it is a question. If it needs someone to *do* something, it
belongs here.

Status: `READY` — nothing blocking · `BLOCKED` — waiting on the household ·
`QUEUED` — waiting on earlier work · `IN PROGRESS` — first slice landed, item
not closed

Last reviewed **2026-08-17**. Phase: **analysis** — capture is essentially done.
Lunch Money is the normal operational update feed; file capture is fallback.

**Follow-ups from the 2026-08-16 evidence pack** (not mixed into that
facts PR; each needs its own independently provable outcome):

- **Noble quarterly expander** — **DONE.** Forecast `occurrences()` expands
  `frequency: quarterly`. Canonical `noble-garbage` is the one quarterly
  row (`day` 18, `anchor` 2026-03-18, `firstDue` 2026-09-18). The temporary
  `once` workaround is gone.
- **HELOC residual PAD** — **DONE 2026-08-18.** Q19 ANSWERED: the Aug. 14
  $1,100 payment satisfies the $814.18 August minimum. Interest remains
  non-cash capitalisation. Do not invent a duplicate August cash minimum.
- **Historical Telus in the telecom remainder** — **CLOSED 2026-08-18.**
  Owner decision: the household considers the telecom evidence complete for
  Telus. TELUS IS CLOSED. Future Telus cost is $0. There is no remaining
  Telus planning question and no need to quantify how much historical Telus
  spending appears inside old category averages. Historical Telus
  transactions remain legitimate historical spending ($1,750.61 YTD /
  8 months = $218.83 historical average; $3,534.93 over 19 months) and were
  not deleted or recategorized. Forward telecom is the evidenced active
  services (Shaw $78.40 dated + main Bell $104.20 card-paid June baseline +
  second Bell/watch CSV $16.80). The stale closed-Telus remainder-split
  planning blocker is removed. Q18 is only Bell settlement-state.
- **Bell baseline vs card-paid current bill** — **DONE.** Forward Bell
  is the undated current-regime $121.00/month (`$104.20 + $16.80`) on
  `plan.budget.categories` telecom `currentMonthly`. Forecast reserves
  that amount as daily cash on the master walk and does not also carry
  it as a weekly-cap remainder. Essential/required monthly totals and
  coverage still include it; the walk tracks it on a reserved ledger
  total, not in the weekly-cap Budget column. It is not a dated
  joint-chequing bill,
  not the Aug. 1 $356.62 arrears/travel bill, not a second $15 watch
  line, and not the Travel Visa $250 payment or $17 minimum. Q18 stays
  OPEN for settlement state.
- **Unresolved once cash obligations across a later Forecast start** —
  owner instruction 2026-08-18. A known unresolved cash obligation still
  on the plan must remain binding when Forecast start advances past the
  placeholder date used to reserve it. Advancing as-of is not settlement.
  Not a new backlog number; not the first production cutover.

**Critical path** is owned by
[`docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md`](docs/ATLAS_FINANCIAL_BUILD_STRATEGY.md),
not by this file. Current order (2026-08-17, after the Lunch Money feed
decision): Forecast-critical work through `B96` is **done**. `B80`, the live
Lunch Money **read** observation test, `B95`, `B91` / `AF-RECON-01`, `B94` /
`AF-PLAN-01`, `B96` / `AF-PLAN-02`, and `B20` / `AF-HIST-01` are **done**.
Owner decision **2026-08-17**: Lunch Money is the household's **normal
operational financial update feed**. Forecast remains the planner.
T4 passed the same date: owner-approved preview/apply writes are earned;
unattended production writes are **not** approved. `B21` / `AF-INTAKE-01` is
**DONE 2026-08-17** — later live observe → reconcile proof is
[`docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md`](docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md).
`B78` / `AF-INGEST-01` / T3 is **DONE**. `B79` / `AF-STORE-01` is
**DONE** — file foundation has not demonstrably failed; store gate stays
closed. `B81` / `AF-LIVE-02` is **DONE** as the earned preview/approve
writer, the published 2026-08-19 canonical opening, and the read-only
live overlay. Unattended production writes, a Render token, and a
newer live substitute opening remain reserved. Do **not** wait for a second month of
routine statement files. Provider-completeness, broad historical forensics,
old categorisation cleanup, and file-statement backfill are not
critical-path gates unless they expose a demonstrated material source or
financial-correctness gap.

**Operational knowledge lives in `docs/ACCOUNT_FACTS.md`**, not here: how each
institution's data is obtained, the download endpoints, and the traps that cost
time (TD's dead download button, MBNA's mirrored signs, the browser pane needing
to be visible, merchant strings needing normalising before matching).

---

## 🔴 The two that undercut everything else

**B70 · The HELOC limit is a planning boundary: $0 headroom means $0 additional borrowing** · **DONE / RESOLVED 2026-08-18** · *owner planning invariant; engine already held it*

**Revalidate on the `B91` opening.** The "draw $623 and it becomes
31 August" urgency was the **2026-08-09 Forecast opening**. The 12 August
Burrard registrations are owner-confirmed paid (2026-08-16) and were not
drawn on the HELOC for that purpose. Do not carry the Aug. 9 three-week
loan story forward as today's household plan.

The 2026-08-16 opening has the HELOC at $200,486.16 against a $202,654
limit — $2,167.84 of headroom after the posted $1,100 payment — still
capitalising about **$814 a month with nothing repaying it**. The
published crossing on this opening is **31 October 2026**. That crossing
remains a material Forecast condition: available headroom falls toward
**$0** as the balance approaches the approved limit. It is not household
cash, and it is not a TD-policy question Atlas must answer before it can
plan.

**Planning conclusion (owner 2026-08-18).** HELOC available credit is
borrowing capacity, not cash. Remaining headroom must never increase
safe-to-spend. Unapproved borrowing cannot repair an otherwise-infeasible
plan. At the approved limit, usable borrowing headroom is **$0** and Atlas
cannot create another draw. A planned-debt path may never draw beyond
available capacity. If the projected debt crosses the facility limit at
any point, the financing path is infeasible even if later repayment brings
the ending balance back under. Lender-specific over-limit treatment —
refusal, a fee, a forced chequing withdrawal, or a limit review — is not
a planning blocker unless later direct institutional evidence shows a
separate cash obligation or fee. Forecast already implements this:
`facilityCapacity()` returns bounded non-negative headroom,
`pendingUnknown()` is zero usable capacity, planned borrowing is opt-in
and purpose-capped, and `projectDebts` / `plannedDebt` reject an interim
limit crossing. Opening-gap recovery does not auto-inject a `debtId`
source merely because it has headroom: unapproved borrowing cannot
repair an otherwise-infeasible opening or raise safe-to-spend.
A legacy `fundingDebtId` hint without declared sources is the same
facility hint, not permission; that path fails closed.
Direct regression proofs live in `test-master-forecast.js` and
`test-opening-gap-no-auto-borrow.js`. The 2026-08-21 read-only live
acceptance after PR #128 confirmed the same invariant on the real overlay:
spendable $747.81, gap $104.89, HELOC room $2,167.84 visible as capacity,
`funding.borrowed` $0, `plannedDebt.permitted` false, household answer
unfunded (raw `advice.weekly` $0 is the failure sentinel, not a feasible
cap). Proof:
[`docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md`](docs/connectivity/LIVE_ACCEPTANCE_2026-08-21_NO_AUTO_BORROW.md).

**B71 · Triangle Mastercard limit risk on the published 2026-08-19 opening** · **REOPENED 2026-08-21** · *Forecast.projectDebts crosses $13,500 on day 0; 2026-08-16 under-limit result retired*

**Reopened, not an engine defect.** The 2026-08-18 resolution was that
Triangle **remains under** the $13,500 limit on the then-canonical B91
2026-08-16 opening (`firstOver` null). The published opening is now
2026-08-19. `Forecast.projectDebts` on that opening returns a Triangle
crossing on **2026-08-19 at day 0**. Forecast and the Plan page already
publish that crossing; this entry was the stale copy. B71 is a live
recorded risk until a later opening or payment changes the deterministic
result. No Forecast, `data.json`, or Plan-page change is required.

**KNOWN.** Canonical 2026-08-19 opening in `data.json`: posted
**$13,495.32** + pending **$0.00** = exposure **$13,495.32** against a
**$13,500.00** limit. Headroom **$4.68**. `Forecast.utilisation` reports
available **$4.68**, **99.97%** used, `overLimit` false at the opening
mark (the walk is under at the snapshot; interest takes it over the
same calendar day). Purchase APR **21.99%** / cash **22.99%**. Next
modelled minimum **$253.57**, `firstDue` **2026-09-07**, confidence
**estimated**. That headroom is **credit, not household cash**. B70
remains the planning boundary: it never increases safe-to-spend; $0
headroom would mean $0 additional borrowing capacity.

The 2026-08-16 opening — posted $13,197.00 + pending $15.62 = exposure
$13,212.62, headroom $287.38; `projectDebts` `firstOver` null; peak
$13,388.86 on 2026-09-06 ($111.14 of headroom); 91-day ending $13,178.74;
Aug. 10 $300 already inside that posted (independent identity:
13,497.00 − 300.00 = 13,197.00) — is retired dated evidence, not current
truth.

The 2026-08-09 opening — posted $13,497.00, $3.00 of headroom, day-90
$227.71 over-limit projection — is also retired evidence, not current
truth.

**Deterministic Forecast result (current 2026-08-19 plan; no invented purchases).**
On both the 91-day view and the 365-day knowledge horizon,
`projectDebts` reports Triangle `firstOver` **2026-08-19**, `day` **0**,
`alreadyOver` **false**. Opening used is under the limit; same-day
interest takes it over. 91-day ending balance **$13,475.95**. An
independent daily ledger — opening posted+pending, 21.99%/365 interest,
modelled 7th-of-month payments from `firstDue` — agrees with Forecast to
the cent: day-0 interest **$8.13** lifts the balance to **$13,503.45**;
peak modelled exposure is **$13,650.64 on 2026-09-06**, the day before
the first modelled $253.57 payment ($150.64 over). `Forecast.planPhases`
already emits `facilityCrossing` for Triangle on 2026-08-19;
`public/plan.js` renders that risk. The 2026-08-18 claim that the card
**remains under** the limit is **not** current and is retired with the
16 August opening.

**RISK.** Interest consumes the remaining headroom (~$8/day at this
balance; roughly $243/month against the estimated $253.57 minimum). Thin
room before the September payment is real: on this opening it is already
the day-0 crossing. Additional real-world purchases are not on the
deterministic path and Atlas does not invent them; they could produce a
worse result.

**UNKNOWN.** Issuer-specific over-limit treatment or fee. No Triangle
over-limit fee is observed in available committed evidence. That is not
a finding that Canadian Tire Bank charges none, and it is not modelled
as $0. The evidenced $29 over-limit fee belongs to the TD Cash Back Visa,
not Triangle.

**B63 · Where do the coach payments leave from?** · BLOCKED · *small*

Coaching money is **pass-through**: a remitter sends it, coaches are paid out of
it, the household keeps the margin. Her sheets put the coach share at **27.7%**.

But the 30 June remittance of **$9,646.25 went onto the HELOC the same day**, in
full, and **no coach payments appear in either mailbox**. Three readings:

1. She pays from an account not yet captured — most likely, see B64
2. Coaches were paid earlier or on a lag
3. They have not been paid from this money — an **unrecorded liability**, spent
   on a facility that does not amortise

**Partly answered:** **one coach is paid by cheque** from DEBT&PAYMENTS
(owner-stated) — $8,150 across five cheques, Feb–Nov 2025. So coach payments were
never going to appear as e-transfers, and the mailbox search was looking for the
wrong instrument.

**But the cheques stop in November 2025**, while her sheets show $6,397.50 of
coach pay between April and August 2026. **The 2026 route is still unidentified**
— most likely the account in B64.

**Partly answered again, 9 Aug 2026.** Recovering the deleted Interac
notifications produced a payment that had been invisible: **$2,160.00 on 6 July
to a named individual**, out of SAVINGS-DONT TOUCH, **four days after the
$9,646.25 remittance landed there** — 22.4% of it, against the 27.7% coach share
her sheets imply. A second, **$1,064.92**, went to another named individual on
5 August. **So the "unrecorded liability" worry is substantially reduced**: the
pass-through money was not simply absorbed by the HELOC.

What is still open is the rest of the route. This is one payment out of one
remittance, and the earlier conclusion that no coach payment existed was wrong
only because the evidence was in the bin — which is a reason to fix **B66**
before the next remittance rather than after it.

**Second lead:** a **Payworks** pay-statement notice, 29 Jun 2026. If the coaching
business runs payroll, the rest of the coaches are paid through it.

**The liability worry is softened but not closed.** Coaches are demonstrably paid;
what is unproven is whether the 30 June remittance was passed on before the
$9,646.25 went onto the HELOC.

**B64 · Amanda's other account** · BLOCKED · *small*

**Confirmed to exist by elimination**: $186.16 arrived in Chequing A on 14 Jul
2026 and **no $186.16 left any of the six captured accounts** that week. Interac
names only the receiving bank, never the sender, so the notification cannot
identify it. Her mailbox shows no other bank since **CIBC in 2019**.

Routes, cheapest first: **ask her** · check whether the old CIBC account is still
open · **pull a credit report**, which lists every open account and is definitive.

Prime candidate for where coach payments leave from, and for one of the **two
unidentified accounts** ($59,027) — the larger sent $33,598 across **142**
transfers, a frequency that fits paying a roster far better than anything else
considered.

---

## Blocked on the household

**B70 · Agree a standing transfer from Amanda's account** · *small, high value*
**The 9 August shortfall is historical, not current truth.** Spendable
household cash of **$79.84** against the 12 August Burrard registrations
of $623 was the 2026-08-09 opening. Those registrations are owner-confirmed
**PAID** (2026-08-16). Do not keep this item urgent because that specific
gap is still open — it is not.

The standing-transfer policy question remains. Transfers across are ad hoc
— 127 of them over 18 months, mostly $100–$350, ranging from $930 to
$3,750 in a month — and **$2,691.85** sat in TENNIS INCOME / DEBT&PAYMENTS
on that opening, which is still not spendable household cash (Q25). A
fixed amount on a fixed day, timed after her 15th and month-end pay, would
remove the class of problem. Needs a household decision on the amount —
the 12-month mean is $2,182/month. Re-size it from the next coherent
opening, not from the Aug. 9 $79.84.

**B13 · Business records — revenue and cost of goods** · *large*
The Tier 1 question. Now **two** businesses, which must be separated first (B56).

**B56 · Separate the two businesses** · *medium*

| | Whose | What |
|---|---|---|
| **Dental lab** | her parents' | in the garage; paid rent to May 2026; "not going well" |
| **Coaching** | Amanda's | remitted in bulk; coaches paid out of it |

Business costs sit on household cards — `Head Canada Inc.` $1,043.37 is a
coaching expense Amanda absorbs personally (owner-confirmed), and the Travel Visa
mixes household, holiday and business on one card.

**B57 · The garage rent — is it coming back?** · *small*
$1,000–1,100/month from Mar 2025, stopped May 2026. **$12,600/year gone**, and
because it was misfiled as an internal transfer its loss never registered as an
income event. **Business use of the home** may affect insurance and creates both
a possible deduction and a capital-gains exposure — an accountant's question, and
they have one.

**B58 · The five cheques — $8,150** · **LARGELY ANSWERED 2026-08-09**
**Amanda pays a coach by cheque** (owner-stated). That fits: **all five were
written from DEBT&PAYMENTS**, her account, not the joint one.

| Date | Amount |
|---|---|
| 18 Feb 2025 | $980.00 |
| 15 Jul 2025 | **$3,010.00** |
| 9 Sep 2025 | **$2,835.00** |
| 27 Oct 2025 | $30.00 |
| 19 Nov 2025 | $1,295.00 |

The three large ones are term-sized at a $35/hour coach rate — $3,010 is 86
hours, $2,835 is 81. The $30 is something else.

**But they stop in November 2025.** There is not a single cheque in 2026, while
her tracking sheets show coaches being paid **$6,397.50 between April and August
2026**. So the cheque route was replaced — which points hard at **B64**, the
account outside the captured set.

**Still worth TD's cheque images** to confirm the payee, but the mechanism is no
longer a mystery.

**Also found: a `CHQ RETURN FEE` of $2.00 every month on DEBT&PAYMENTS**, 18 of
18 months, including months with no cheque written. **$24/year for a service that
went unused after November 2025.** Add to the fees dashboard (B30) and to the
account-plan review (B24).

**B59 · Coinbase** · *small*
Owner no longer uses it; recorded as dormant and excluded from net worth.
**Dormant is not empty** and the account is still open — statements were issued
as at June 2026. One look at the balance closes it permanently.

**B60 · Phishing against the Coinbase account** · **owner action** · *small*
Two emails from `info@afius.org` styled as Coinbase, 24 May and 11 Jun 2025,
**both carrying the identical code 523469** — a real one-time code never repeats.
Being unused makes the risk worse, not better: nobody is watching it. Closing the
account is the clean fix; otherwise a unique password and app-based 2FA.

**B27 · RESP holdings** · *small*
Balance $31,555.85 known; holdings, book value and contribution room are not.
Access needs OTC Markets and CME/S&P exchange agreements — **an owner decision,
never an agent's**.

**B51 · Narrow the home valuation** · *small*
$1.1m–$1.4m is a $300k spread and net worth swings 84% across it. A realtor's
opinion or a recent comparable would tighten it cheaply. A lender orders its own
appraisal regardless.

**B43 · PayPal #2 — confirm account type** · *small*
Inferred personal from its transactions, not verified.

**B14 · Decide whether the business and her employment stay in scope** · *small*

---

## Ready — analysis, nothing blocking

**B66 · Stop deleting the Interac notifications** · **owner action** · *small*
**The single cheapest fix in this file.** Interac's confirmation emails are the
only record of who is on the other end of an e-transfer, and both mailboxes are
deleting them. Gmail purges the bin after 30 days, so the evidence is being
destroyed on a rolling cycle — 26 of the 49 attributions recovered on 9 Aug were
sitting in the bin and would have been gone within weeks.

A filter on **both** accounts — `from:payments.interac.ca` → apply a label, skip
the inbox, **never delete** — costs nothing and makes every future transfer
attributable. It cannot recover what has already gone.

**B68 · Two auto-insurance policies at once** · **owner action** · *small*
**ICBC $99.91/month started 21 April 2026 and BCAA $82.96/month never stopped.**
Both are charged on the 15th, every month since. Auto insurance went from $82.96
to **$182.87/month — an extra $1,199 a year** — and nothing marks it as a
decision. If BCAA is optional coverage on top of ICBC basic Autoplan, fine. If it
should have ended when the ICBC policy began, one phone call recovers it.

**B69 · Home insurance — $3,131.76 a year, from an unknown account** · *small*
Square One, policy #5157890, **auto-renews 10 February**, whole year in one
payment. **It appears in none of the six accounts or five cards**, though
February 2026 is inside every coverage window.

Two further things: the premium is up **~17% in a year** ($2,730.36 → $3,131.76),
and the **January 2025 payment failed twice and the policy came within days of
cancellation**. A lapse on a mortgaged property is serious, and a single $3,131.76
debit is exactly the kind that fails when an account is short. Also worth asking
the insurer about the garage — see B57.

**B67 · The $1,806.00 Fusion invoice** · *small*
Invoice 86995864, 31 Aug 2025, paid by Dale — **and it appears in none of the
six accounts or five cards**, though it falls inside both coverage windows. The
other seven Dale-paid invoices predate card coverage and are explainable; this
one is not. Most likely an invoice total settled in instalments too small to
spot. One look at the LeagueApps payment history closes it.

**B28 · Rewards balances as minor assets** · **PARTIAL 2026-08-21** · *small*
Travel Visa **57,968 TD Rewards points**; Cash Back **$47.21**.
The dollar-denominated Cash Back Dollars **$47.21** now sit on `data.json`
`assets` and enter household asset / net-worth presentation through
`Forecast.publicationTotals`. That figure is the **2026-08-09** account
reading, not the 2026-08-19 opening; `docs/positions.csv` holds the dated
Household evidence. They are not spendable cash and not a funding source.
**Still open:** the 57,968 TD Rewards points have no single valuation basis
in current repository authority and are **not** assigned a dollar value. Do
not invent cents-per-point, a redemption method, or a rewards engine.

**B72 · `test-mergecard.js` names a commit that no branch holds** · *housekeeping*
The `HEAD` fixture is `b85274ce…`, with a comment calling it "a real commit on
this branch". PR #2's rebase removed that commit from every branch, so the
comment is false. Harmless to behaviour — the fixture only needs 40 hex
characters — but a comment asserting something untrue is the class of defect
this repository treats as real. Fix it in passing, whenever a pull request has
honest reason to touch that file; it does not justify one of its own.

**B73 · Financial decisions made inside page scripts** · **DONE 2026-08-14**
`CONTEXT.md` states the rule: the engine owns the answers, the pages render them
— because anything computed in a page script cannot be reached by the node suite
that guards every other figure. Page scripts broke it in the places recorded
below, each producing something the household acts on. **The list is what has
been found, not a count of what exists** — it grew twice under review already.

**Every instance recorded below has moved into the engine, including the eight
the closing scan found.** Item 8 — the last of those eight — moved on
2026-08-14. The item is **closed** on that recorded set rather than left
artificially open: a new page-side decision, if one appears, is a new finding.
See **the closing scan** at the end of this entry for what was inspected, what
each candidate was classified as, and that the ordered outcomes are done. The
two presentational leftovers the scan flagged for a second look at item 8
(`>= 20%` / `< 5%` rate colouring, and Deep Dive `daysUntil` beside
`Forecast.nextDue`) remain classified as presentation, not authorities.

- **RESOLVED 2026-08-11 — the payoff modeller.** `Forecast.payoffDebts` and
  `Forecast.payoffModel` now own which debts may be modelled, what each owes
  today, the convention its rate is charged under, the minimum a larger payment
  is measured against, the projection, and the financially meaningful slider
  floor. `Forecast.paymentForMonths` owns the "clear it in 5 / 3 / 1 years"
  solve that was `solveFor`. `public/modellers.js` reads the controls and holds
  the wording; `payoff()` and `monthlyRate()` moved out of `public/app.js` — the
  shared *page* core — rather than being copied, so no payoff formula exists in
  both places, and nothing financial is left in that file at all. The modeller
  is coupled rather than parallel: balances come from the debt records through
  the same `openingBalance` rule the debt walk opens on, and the minimum is
  `monthlyCashFor`, the rule `Forecast.renewal` already compared against, now
  extracted so both read one answer. `test-payoff.js` proves every figure by a
  method the engine does not use — a month-by-month balance walk that has to
  land on zero, and the annuity's present-value identity — breaks twelve
  formulas and branches to show each is load-bearing, reconciles the move
  against the old page expressions at all 12,661 slider positions the page can
  reach, and boots the real page against a stub DOM to read what the household
  is actually shown.

  **The move found three real financial defects sharing that authority, and
  fixes them here rather than preserving them for a clean migration diff.**

  1. **One interest convention was applied to every debt, and it was nobody's.**
     The page priced every balance at `annual × 30 / 365` — twelve 30-day months,
     so 360 charged days for every 365 that pass, understating every year by
     1.37% and compounding that over a 17-year horizon. A prime-linked facility
     is quoted compounded monthly, which is `RATE_BASIS.variable`, reused rather
     than restated. A card is not: it charges a daily rate over the days in each
     statement cycle, and cycles vary with the calendar. Because twelve
     consecutive cycles **tile** the year — each opens the day after the last
     closes — a year's charge is the full annual rate however the days fall, so
     the model prices the average cycle at `annual / 12`. Each debt record now
     declares its `rateConvention`; an undeclared one throws rather than being
     guessed, and an invariant keeps that throw unreachable.

     **That average is labelled as one rather than presented as the convention**
     — the first draft claimed it *was* the per-cycle convention, and the
     required review blocked it for exactly that. `PAYOFF_BASIS_PRECISION` marks
     a card `monthly-equivalent` and a prime-linked facility `exact`; the page
     publishes the first-period charge with the band a 28-to-32-day cycle
     actually allows ($227.68–$260.21 on the Triangle, against $247.33) and says
     the month-1 row prices an average cycle. Against the published TD/MBNA
     30-day form the monthly figure runs +1.39%, and from +8.63% to −4.95%
     across the band. The multi-period figures inherit far less of that, because
     tiling redistributes interest between periods rather than accumulating it:
     walking a real varying-cycle schedule from all twelve possible starting
     months bounds the worst case at 1.81 months and 1.20% of total interest.
  2. **The balance ignored pending charges.** MBNA and the Travel Visa were
     modelled $82.05 and $165.13 lighter than the household owes.
  3. **"The minimum" was `debt.payment`, which is not always a payment.** On the
     HELOC that field is the capitalised interest charge, so the modeller
     published a payoff horizon for a facility nothing repays, at an $814.18
     monthly bill nobody pays — the exact defect the renewal work ended, still
     standing one modeller above it. On the mortgage it is a **bi-weekly**
     amount read as monthly, so the modeller reported that a mortgage TD itself
     says has 17 years 9 months left would **never clear**. On the canonical
     obligation it now clears in 17 years 10 months, within two months of TD's
     own figure.

  **Published figures that changed**, all in the same direction — the debts are
  worse than the page said: the mortgage from "never clears" to 17 y 10 m and
  $197,559.96 of interest; the HELOC from "over 100 years" at a $814.18 minimum
  to no cash minimum and a balance growing $823.14 a month; the Triangle
  Mastercard at its minimum from 15 y 3 m and $32,810.22 of interest to 17 y 0 m
  and $38,239.71; MBNA from 10 y 3 m and $11,616.35 to 11 y 1 m and $13,147.41;
  the Travel Visa's monthly growth at its $17.00 minimum from $0.72 to $3.71; and
  the Cash Back Visa's minimum from the $762.36 September statement spike to its
  $170.00 recurring level, with the spike named on the page rather than dropped.
- **RESOLVED 2026-08-11 — the May 2027 renewal.** `Forecast.renewal` now owns
  what the renewal costs and what folding the HELOC into it changes: the
  compounded HELOC balance, both interest totals, today's household cash and the
  comparison against it. `public/modellers.js` reads the sliders, renders the
  result and holds the wording; `amortisedPayment()` moved out of
  `public/app.js` — the shared *page* core — rather than being copied, so no
  formula exists in both places. The renewal is coupled rather than parallel:
  balances come from the debt records through the same `openingBalance` rule the
  debt walk opens on and headroom is measured against, and today's household
  cash is annualised from `plan.obligations`, so the HELOC's $0.00 of cash is
  derived from its charge being non-cash rather than asserted. `test-renewal.js`
  proves every figure twice — once against a literal, once by a method the
  engine does not use, walking the amortisation to zero and growing the HELOC by
  216 successive monthly charges — breaks ten formulas and branches in the
  engine source to show each is load-bearing, and reconciles the move against the
  real published inputs at all 3,822 slider positions the page can reach and
  through the page's own template, character for character. It also added the
  invariant that `data.json` `mortgage`, the mortgage debt record and the plan
  obligation state one balance, one rate and one payment; nothing had checked
  that, and the renewal now depends on two of them.

  **The move also found a real financial-correctness defect, and it is fixed
  here rather than carried forward.** The modeller priced every rate its slider
  could reach as if it compounded monthly. That is right for a variable rate and
  wrong for a fixed one, which Canada quotes "calculated half-yearly, not in
  advance" — and a fixed quote is exactly what TD's April 2027 offer letter will
  carry. On TD's own published example, $300,000 at 3.00%, the true payment is
  $2,069.07 a month over 15 years and $1,419.74 over 25; the modeller answered
  $2,071.74 and $1,422.63. On this household's balance at the opening 3.64% it
  overstated a fixed renewal by $7.57 a month and $1,634.99 over 18 years.
  `RATE_BASIS` now holds both conventions, `Forecast.renewal` requires the caller
  to name one and has no default, the page makes it a household choice and never
  prints a rate without its convention, and the HELOC keeps its own prime-linked
  monthly compounding whatever the mortgage renews into. Proved against
  published benchmarks outside this repository — TD's example and the standard
  Canadian $100,000-at-6.00% figure, $639.81 against $644.30 — and against the
  defining identity that twelve months of fixed growth equal two half-years of
  it. Found by the blocking Atlas Contract / Systems Review on PR #15, which
  overruled this builder's own decision to record it as out of scope; the
  convention shares the renewal's exact calculation authority, so migration
  equivalence to the old page was not a sufficient answer.
- **RESOLVED 2026-08-11 — "Next due".** `Forecast.nextDue` now owns which
  published calendar obligation the household owes soonest: paid, non-cash and
  past-due items are excluded there, the earliest eligible date wins, and the
  calendar's own order settles a tie. `public/deepdive.js` renders the returned
  item and no longer filters, sorts or selects. The focused test hand-computes
  the winner, proves each exclusion by removing it and watching that item win,
  and reconciles the move against the published calendar. The old page
  comparator never returned `0`, so same-day ordering had rested on the sort
  implementation; the rule is now stated and tested. Two obligations do share
  12 August today, and the tile still names one of them rather than the day's
  total — see the note under `B74`.
- **RESOLVED 2026-08-11 — Amanda transfer deadline.** `Forecast.incomeDeadline`
  now owns the counterfactual that removes `amandaTransfer` and identifies the
  first below-buffer day. `public/plan.js` renders the returned amount/date and no
  longer runs its own no-transfer simulation or selects `neededBy`. The focused
  test includes a hand-computed case and migration equivalence on the real plan.
- **RESOLVED 2026-08-11 — the homepage mission.** `Forecast.mission` now owns
  which instructions the household is given at the top of the Plan page and in
  what order: the opening timing gap or the shortfall no source can reach, a
  facility over its limit today, a weekly spending figure *only where spending
  is a remedy*, and then the HELOC crossing or the surplus. It returns the
  instructions and the figures behind each one; `public/plan.js` keeps the
  wording and formatting and chooses nothing. The focused test hand-computes
  every mission state from literal fixture facts, breaks each decision branch
  in the inputs *and* in the engine source to prove it is load-bearing, and
  reconciles the move against the real published plan at three settings — the
  live default, an unsupported `$1,500/week` override and a buffer no
  combination of sources can reach — through the page's own wording map, so the
  sentence the household reads is unchanged character for character. The
  `$1,500/week` against a −$809 low is now a test rather than a comment.

  One presentation defect is left recorded rather than fixed, because this was
  an authority move and the wording was deliberately preserved: with two
  facilities over their limits the sentence still reads "back under **its**
  limit". It is grammar in `MISSION_PART`, not a decision, and no figure is
  wrong.

Two things this item said until the renewal moved, both corrected by having done
the work. It said `payoff()` and `amortisedPayment()` in `public/app.js` "are
already shared helpers and are not the problem". `amortisedPayment()` was the
problem: it decided the renewal's monthly figure from the shared *page* core, and
being shared is what made that easy to overlook. `payoff()` was in the same
position until it moved with the payoff modeller, and being a helper was never
what excused it. And the wording "the inline arithmetic and the inline selections
are" reads as though a formula becomes acceptable once it is given a name; what
matters is whether a test can reach the figure the household acts on.

### The closing scan · 2026-08-12 · recorded instances now moved; B73 closed 2026-08-14

**Every browser file was read, not only the ones this item had named.** Five page
scripts — `public/app.js`, `public/plan.js`, `public/deepdive.js`,
`public/modellers.js`, `public/records.js`, 2,214 lines — plus the four page
templates, which carry no inline script. `public/forecast.js` is the engine and
is what the scan measures against. `docs/dashboard.html` is excluded and the
reason is recorded rather than left silent: `server.js` serves `public/` only, so
it reaches no browser, and its one script block holds chart geometry over figures
baked in as literals.

**The answer to the question this scan asked was no, on the day it ran.**
*Engine decides, pages render* was not true across the browser layer then. The
scan found eight concrete financial authorities living in page scripts.
**Items 1–8 have since all moved** — 1 and 2 together, as one authority
boundary, because both interpreted the same opening gap and the same funding
result; 3 through 8 each on their own. Item 8, the last of them, closed on
2026-08-14. The list below is the record of what those eight were.

**The first pass of this scan found seven and missed one**, and the record says
so rather than presenting eight as though they arrived together. The blocking
Atlas Contract / Systems Review found the funding-source cards — item 2 below —
in the same file and the same block as item 1, and it also caught this record
overstating which `/wk` figures pass through the page's own conversion. An audit
that claims to have read every browser file and then misses a verdict in the
most-read one has demonstrated the exact thing the item is about: page-side
decisions read as formatting until someone reads what the expression concludes.
Both corrections are folded in below. The count is what searching has found, and
that is still not the same as what exists.

**The evidence is mutation, not reading.** Ten mutations were applied one at a
time to the page-side decisions below, and `npm test` passed on every one — the
suite cannot see any of them. The same harness run against one engine line
(`budgetBreakdown`'s `requiredMonthly`) fails immediately, so the suite is
capable of biting and these figures are simply outside what it can reach.

**All ten `plan.js` mutations no longer apply**, struck through below: the page
expressions they mutated do not exist any more, and the decisions they stood
for now fail the suite when broken in the engine. That is the shape a resolved
row takes here — not a mutation that stopped mattering, but one whose target
moved somewhere a test can reach it. The `actionCovers` row was reproduced on
the branch that moved it before anything was edited — the page mutated,
`npm test` run, **ALL 15 SUITES PASSED** — and the equivalent mutation in
`Forecast.nextMove` now fails. The two `deepdive.js` rows have since moved
with item 8 — widening the fit band or dropping the discretionary filter now
fails in `Forecast.deepDive`.

| Mutation | Suite |
|---|---|
| ~~`plan.js` `WEEKS_PER_MONTH` 4.35 → 4.00~~ | **moved — now fails** |
| ~~`plan.js` status band: dip threshold `sim.buffer` → `sim.buffer / 2`~~ | **moved — now fails** |
| ~~`plan.js` status band: `firstNeg` `balance < 0` → `< 500`~~ | **moved — now fails** |
| ~~`plan.js` `overrideBreaches` epsilon `0.005` → `500`~~ | **moved — now fails** |
| ~~`plan.js` funding card: `enough = available >= needed` → `>= needed / 2`~~ | **moved — now fails** |
| ~~`plan.js` funding card: per-source shortfall `needed - available` reversed~~ | **moved — now fails** |
| ~~`plan.js` `actionCovers`: `>= fundingGap` → `>= fundingGap / 2`~~ | **moved — now fails** |
| ~~`plan.js` "next payment out": sum of the day → single largest~~ | **moved — now fails** |
| ~~`plan.js` snapshot interest `/ 12` → `/ 6`~~ | **moved — now fails** |
| ~~`plan.js` reserves window conversion halved~~ | **moved — now fails** |
| ~~`deepdive.js` interest-check tolerance `4` → `40`~~ | **moved — now fails** |
| ~~`deepdive.js` discretionary total: classification filter dropped~~ | **moved — now fails** |
| **control** — `forecast.js` `requiredMonthly` drops the `unknown` class | **fails** |

#### What remains, in the order it should be moved

1. **RESOLVED 2026-08-12 — the status band.** `Forecast.planStatus` now owns
   which of the seven verdicts the household reads at the top of the Plan page
   and every figure and date inside it. The page re-derived `fundingShort`,
   hand-copied the engine's `below()` and its `EPSILON` as `sim.min.balance <
   sim.buffer - 0.005`, selected the verdict, walked `sim.daily` for `firstBad`
   and `firstNeg`, and totalled `fundingPlan.parts` into "every usable source
   combined reaches $X". All of it moved. `public/plan.js` holds `STATUS_BAND`,
   a map from the engine's verdict id to a tone class and one sentence, and
   chooses nothing; the one comparison left in it is between two dates the
   engine already selected, and it only stops the sentence naming the same day
   twice.
2. **RESOLVED 2026-08-12 — the funding-source cards.** They moved **with** item
   1, in one pull request, because they read the same `gap` and the same
   `fundingPlan`: two verdicts about one result, which is one authority
   boundary. `Forecast.recommend`'s funding result now returns
   `funding.sources` — per source, in rank order, whether it covers the gap
   alone, contributes through the selected allocation, or cannot reach it, what
   it contributes, and how far short it falls. The page's `enough = o.available
   >= needed` and `Math.max(0, needed - o.available)` are gone, and so is its
   own rank sort. The engine's coverage test is `atLeast`, the epsilon its own
   allocation stops on, so a source half a cent short can no longer fund the gap
   and be reported as failing to in the same breath.

   **What guarded the band is retired with it.** `test-invariants.js` asserted
   that `if (gap && fundingShort)` appeared before `} else if (gap &&
   overrideBreaches)` in the page source. That regex passed under both band
   mutations recorded above, because it protected the ordering of two strings
   and nothing about what either branch concluded. `test-status-band.js`
   replaces it by reordering the engine's own branches and requiring an
   unfundable gap under a breaching override to stop reading `unfunded`. One
   mechanism, not two.

   **One real defect was found in the move and is fixed rather than carried
   across.** The band used two boundary conventions in one block: the override
   breach against `sim.buffer - 0.005`, and the dip against a bare
   `sim.min.balance < sim.buffer`. The bare one is wrong at the boundary — a
   float landing a ten-thousandth of a cent under the buffer published "Tight —
   projected to dip to $500 … below the $500 target buffer", a sentence
   contradicting itself inside its own clause, while `recommend` reported the
   same run as holding and the mission instructed the household to hold
   spending. Both comparisons are now `below()`, and going negative stays a bare
   `< 0` because that is the convention `recommend` opens the gap on. Proved
   both ways in `test-status-band.js`: a ten-thousandth of a cent under is on
   plan, a genuine cent under is still a dip.

   **A second defect was found by the blocking review, inside the move
   itself.** `funding.needsCombination` says the ranked allocation used more
   than one source; the band read it as proof that no single source could cover
   the gap. They are not the same. Rank 1 holding $500 and rank 2 holding
   $1,500 against a $1,000 gap fills $500 + $500 — a two-part allocation, while
   rank 2 covers the whole gap alone — so the band read "no single source
   covers it" directly above a card reading "Covers the whole $1,000". That is
   the cross-surface contradiction this move exists to end, reappearing inside
   the engine that was supposed to end it, and it was live on `main` too: the
   page's own `o.available >= needed` reached the same verdict. The status
   verdict now consumes the per-source coverage it already computes and states
   only what the allocation proves. Proved on a fixture built through the real
   engine, asserting the two rendered sentences cannot assert opposite things,
   and the wording is unchanged wherever no single source does cover the gap —
   which is the published case.

   Nothing else the household reads changed. The band and the cards were
   rendered at ten settings of the published plan — every branch the real data
   can reach — through the page's own wording maps, and compared against the
   expressions `public/plan.js` ran at `fb9ced8`: identical, class and sentence.
   The three verdicts the published data cannot reach are proved on
   hand-computed fixtures instead.

   One piece of odd copy is **preserved deliberately** and now locked by a test:
   an unusable source holding more than the gap reads "Not enough — $0 short of
   the $X needed", because `unusable` excludes it from coverage while its
   shortfall computes to zero. It is unreachable on the published data, it is
   wording rather than a decision, and this was an authority move — but it is
   now a figure a test can reach, so correcting it later is a deliberate change
   rather than an unnoticed one.
3. **RESOLVED 2026-08-12 — the weekly cap in monthly terms, and whether there
   is discretionary room.** `Forecast.budgetBreakdown` now returns a `cap` block
   holding every weekly↔monthly conversion and the cap-versus-need verdict, and
   `Forecast.monthlyFromWeekly` says a weekly cap in months for the two callers
   that need it without a budget. `WEEKS_PER_MONTH` lives in the engine and is
   **deliberately not exported**: a test importing it would prove the engine
   agrees with itself, so the suites re-derive `365.25 / 12 / 7` from the
   calendar instead.

   **There were three copies of that constant, not two.** The page's,
   `test-budget.js`'s at line 23 — and `scripts/figures-snapshot.js`'s at line
   75, in the one file whose whole job is to prove published figures did not
   move. The snapshot script converted `budgetBreakdown`'s monthly outputs
   itself, so it could not have seen the page's conversion drift. It reads the
   engine now. `test-budget.js` keeps its own, which is what a test should
   do — and it is now a real cross-check, asserted against the engine's answer
   rather than only against itself.

   `public/plan.js` lost `WEEKS_PER_MONTH`, `perWeek()`, `recMonthly`,
   `optional`, `short`, the `inCap` total and every page-side division; it
   holds money formatting, the `/wk` and `/month` labels, and sentence
   templates keyed off `cap.hasDiscretionaryRoom`. The weekly cap itself is
   still `Forecast.recommend`'s and is still printed as it arrives.

   **The cap measured is the cap being shown.** The engine is told which weekly
   figure is on screen — the household's own setting when there is one — and
   the recommendation travels beside it rather than in place of it. Measuring
   the recommendation while the page displays an override would publish
   discretionary room the displayed plan does not leave; a mutation proves that
   branch is load-bearing.

   **One boundary defect corrected.** The page compared two unrounded monthly
   sums with a bare `>`, so a cap a fraction of a cent under the essential need
   published "Discretionary room — **nothing left**. The cap is below what
   normal life costs" beside a shortfall that rounds to $0/week. The verdict is
   `atLeast` now — the engine's own half-cent epsilon, finer than any of these
   figures is published to — and both sides are proved: exactly at the need
   leaves room of $0.00, two cents under is a real shortfall of two cents. No
   published figure moves; the real plan sits $1,442.54/month clear of that
   boundary.

   **A second defect was found by the blocking review, and it was live on
   `main` too.** The room the cap leaves was compared with the household's own
   discretionary budget as a **signed** difference, and the page rendered it
   unconditionally as "so the plan is $Y/wk short of it and something has to
   give". When the cap leaves *more* room than the household budgets, that
   number goes negative and the sentence reads "the plan is −$28/wk short of it
   and something has to give". Reachable by typing into the weekly box, which
   has no upper bound: on the published plan any setting above $1,771.72/week
   gets there. The comparison is now a verdict — `short` / `meets` / `exceeds` —
   with a magnitude that is never negative, and the page words each one. The
   first version of this move's own test asserted the negative value as though
   it were correct and never rendered it, which is what let it through; the
   proof now renders all three through the page's clause map and boots the real
   page at a stored $1,800/wk override.

   Every affected figure and sentence was rendered at ten settings — including
   a $600/wk override that trips the "nothing left" branch — and is identical
   to `0ed3bae`. All 75 snapshot figures are identical. The page is booted
   against a stub DOM and the household-facing strings read back.
4. **RESOLVED 2026-08-12 — counterfactuals composed on the page.**
   `Forecast.counterfactuals` now owns both alternative-reality answers the Plan
   page publishes: what the household could spend if the whole opening gap were
   covered, and what funding that gap from a credit facility instead would do to
   the facility's limit-crossing date. It decides which alternative applies,
   constructs the assumption, runs it through `Forecast.recommend` and
   `Forecast.projectDebts`, and returns structured facts. `public/plan.js` keeps
   the wording and formatting: it lost `capIfCovered`, the `available: Infinity`
   funding source, the `fundingDebtId: 'heloc'` selection, its second
   `recommend` and second `projectDebts`, the `fundingIsDraw` and
   `fundingSource` consts that only existed to gate them, its
   `fundingGap - fundingPlan.shortfall` subtraction, and the `'her account'`
   fallback label. It now calls `recommend` once and `projectDebts` once, both
   for the plan on screen, and a test asserts that.

   **Propagation is by construction rather than by discipline.** `recommend`
   records the assumptions it was called under as `planOptions` — scenario,
   target buffer, income overrides, disabled commitments, debt records,
   extra-debt settings — and each counterfactual copies that record and replaces
   exactly one key, `fundingSources`. The page passes no scenario to the
   alternative because it passes none at all, so the two sides cannot drift.
   `simOptions` is deliberately not what is copied: it is the recovery run and
   carries the gap injections, so feeding it back would fund the gap twice.

   **Neither assumption is infinite money.** Full coverage is exactly the
   shortfall the declared sources leave, supplied as found money rather than
   borrowing and ranked *behind* every real source — so the real allocation, and
   the borrowing inside it, are untouched, and `addsBorrowing` is zero by
   construction. The old `available: Infinity` source was ranked *first*, which
   silently replaced the real plan with a fully external one and dropped the
   HELOC draw the actual plan makes. Which facilities can be offered as
   alternative funders is derived from the canonical funding options — a usable
   option naming a debt record — so no page and no engine line hard-codes
   `'heloc'`.

   `test-counterfactuals.js` proves every figure on a fixture whose arithmetic
   is hand-checkable ($100 in the account, $700 out before any income, so the
   gap is the buffer plus $600), reconciles each returned answer against
   `recommend` and `projectDebts` run directly, proves the alternative's draw
   reaches the debt walk exactly once on the gap day, names a reason for each of
   the five states that have no honest answer, breaks nine engine decisions to
   show each is load-bearing, and boots the real page against a stub DOM at
   three buffer settings to read back the two sentences the household is shown.
   All 75 snapshot figures are identical to `a7fe97b`.

   **One real financial contradiction was found in the move and is fixed here
   rather than carried across.** The page passed `fundingDebtId` with no
   `fundingSources`, which took the engine's unattributed-injection fallback and
   drew the **whole gap** on the HELOC however little it declared. At a $1,500
   target buffer — reachable by typing into a box with `min="0"` and no
   maximum — the funding card read "Not enough — $975 short of the $2,043
   needed" while the risk block a few lines below priced a $2,043.16 draw on
   that same facility and published a crossing date of **12 August**, the as-of
   date itself, manufactured entirely by the overdraw. A facility now funds the
   gap through its own declared headroom, and an alternative it cannot supply
   returns `sourceCannotCoverGap` with no date. On the published data nothing
   moves: the gap is $1,043.16 against $1,067.84 of HELOC headroom, so the
   sentence still reads "brings that crossing forward to **August 31**".

   **Two source-regex invariants were re-pointed rather than deleted.**
   `test-invariants.js` asserted the page held `fundingPlan.borrowed > 0` and
   `capIfCovered`; both expressions moved. The demonstrated failures they
   guarded — borrowing status read from the single-source case, and a cap
   qualifier attaching one simulation's condition to another's answer — are now
   guarded at their new home, the second by a per-facility test that is stricter
   than the boolean it replaces. A third assertion, that the page no longer
   builds `available: Infinity`, needed the page source with comments stripped:
   this repository records what moved in a comment naming the thing it removed,
   and a bare regex cannot tell that record apart from the code it replaced.
5. **RESOLVED 2026-08-12 — what the next move achieves.** `Forecast.nextMove`
   now owns which of the five outcomes the household reads under **What happens
   after**, and every figure inside it. The page's `actionCovers` — which
   carried its own copy of the engine's half-cent as `first.amount + 0.005 >=
   fundingGap` — and its `actionLeaves` subtraction are gone, and so is the
   five-branch ternary that chose between the sentences from the status verdict,
   the funding plan and the action's due date. `public/plan.js` holds
   `NEXT_MOVE`, a map from the engine's outcome id to one sentence, and decides
   nothing: a test asserts the map contains no comparison operator at all and
   does no arithmetic on the figures it is handed. The page reads the action
   record off the engine result too, so the card head and the outcome below it
   cannot describe different actions.

   **The comparison is the authority, and the gap is what it is measured
   against.** The action's amount is a fixed $1,050 authored in `data.json` and
   sized for the default $500 buffer; the gap moves with the buffer. The opening
   floor is hand-checkable from the data — $79.84 of household cash against the
   $320.00 and $303.00 registrations both falling on 12 August, so −$543.16 —
   which makes the gap the floor plus the buffer. `test-nextmove.js` proves the
   crossing on the published plan: $1,043.16 at a $500 buffer is covered,
   $1,543.16 at $1,000 leaves $493.16, $2,043.16 at $1,500 leaves $993.16. Three
   mutations show the comparison is load-bearing — halving it, pinning the gap
   to the default buffer's $1,043.16, and reading coverage off the existence of
   a feasible funding plan each make a short action publish "the buffer is
   restored", and each fails.

   Both sides of the money boundary are proved on literal figures rather than
   from the engine's constant: exactly equal covers, $0.004 short covers,
   a full cent short does not, and an action a cent under the gap does not.
   Fifteen mutations in all, including the outcome ordering — reporting the
   override before the shortfall hides what is still to find — the due-date
   test, whose removal restores the buffer with money that arrives eight days
   after the payments have to clear, and calling coverage alone a restoration,
   which is the blocking review's own defect as a mutation. Every one of the five outcomes is rendered
   through the page's own wording map at twelve settings of the published plan
   and compared against the expressions `public/plan.js` ran at `098f90b`:
   identical, sentence for sentence. The real page is then booted against a stub
   DOM at five stored knob settings — the default, a $1,500/week override, a
   $1,500 buffer, a $5,000 buffer, and the registrations unticked at a $0 buffer
   — which is every outcome, read back out of the card the household sees. All
   75 snapshot figures are identical to `098f90b`.

   **A real defect was found by the blocking review, inside the move itself,
   and it was live on `main` too.** Coverage and timing were tested in two
   different places: the `restored` outcome checked the due date, the override
   outcome did not. So an action that *covered* the gap, fell due *after* it,
   and sat under a weekly setting the forecast does not support published "The
   $623.00 clears on 12 August and the buffer is restored" over money arriving
   eight days late. Two outcomes were each proved on their own and the state
   where both applied was the one neither checked — the same shape as item 2's
   `needsCombination` finding, and the argument for combining the facts a
   fixture varies rather than testing them one at a time. Restoring the gap now
   takes both, one predicate, and it gates both restoring outcomes.

   **Correcting it moved the household into a sentence that was also wrong**,
   so that is corrected here as well rather than left as the fix's own
   contribution. The window outcome closed with "instead of breaching the
   $500 buffer" unconditionally, which is false of any run that does breach —
   reachable on `main` today with no gap and an unsupported weekly setting, and
   reachable by this correction's own routing. It now reports which side of the
   buffer the window lands on, says why the gap is not restored when the reason
   is the date rather than the amount, and carries the unsupported weekly
   figure so the reroute cannot drop it. Proved across every combination of the
   three facts — amount reaching the gap or not, due in time or not, override
   set or not — asserting that the words "the buffer is restored" appear if and
   only if the action both reaches the gap and arrives in time. **No published
   figure moves and no published sentence changes**: `data.json` dates the
   first action 11 August against a gap that always falls on 12 August, so
   every one of the twelve migration-equivalence settings still matches
   `098f90b` exactly, and a test asserts that is *why* rather than assuming it.

   **One further real defect was found in the move and is fixed rather than
   carried across.** `data.json` allows an action with no `amount` — the card head
   already renders that case, printing no figure — and the page's remainder was
   `gap && first.amount != null ? fundingGap - first.amount : 0`. So an unpriced
   action published "This covers $0 of the $1,600 needed, leaving $0.00 still to
   find", two published figures contradicting each other inside one sentence,
   one saying the gap is closed while the other says it is not. An action with
   no amount covers nothing of the gap, so the whole gap remains. Unreachable on
   the published data, which prices every action, and it moves no published
   figure; a mutation restoring the old expression now fails.

   **Three source-regex invariants were re-pointed rather than deleted.**
   `test-invariants.js` asserted that `public/plan.js` still held `actionCovers`,
   that it re-read `status.id === 'overrideBreach'` to pick its own outcome, and
   that it had states named `fundingShort` and `needsCombination`. All four
   expressions moved. The demonstrated failures they guarded — an outcome judged
   on feasibility rather than on the current gap, a breaching weekly setting
   going unsaid, and success copy over a gap nothing can fund — are guarded at
   their new home, the second one now across six buffer settings rather than by
   the presence of a string. `fundingShort` had in fact still matched, inside
   the comment recording that it moved: the regex this repository already knows
   cannot tell a record apart from the code it replaced.
6. **Derived household totals on the Plan page.**
   **RESOLVED 2026-08-14 — "next payment out".** `Forecast.nextPaymentOut` now
   owns the next day cash leaves the projection and the total that has to be
   there: inflows, non-cash charges and dates before as-of are excluded, the
   earliest remaining date wins, and every eligible event on that date is
   summed. `public/plan.js` prints the returned date, amount and label; the
   3-day tile tone is presentation. `test-next-payment-out.js` hand-computes
   $320 + $303 = $623 on a fixture, proves each exclusion by removing it,
   reconciles the published tile against those two Burrard commitment literals
   in `data.json`, and breaks the day-sum into the single largest outflow so
   the B73 mutation now fails. No published figure or wording moved. **B74 now
   feeds both this tile and `Forecast.nextDue` from the same `expandEvents`
   stream; the two aggregations remain distinct.**

   **RESOLVED 2026-08-14 — unallocated / free cash.** `Forecast.unallocatedCash`
   now owns the windowed reserve, the remainder after buffer and reserves, and
   whether that remainder is free cash: monthly reserve × `windowDays /
   (365.25 / 12)`, then `ending − buffer − reserves`, with the leftover
   verdict taken on the published cent so a sub-cent remainder cannot read
   "not spending money" beside `$0.00`. `public/plan.js` prints the ledger
   and looks the sentence up; it no longer converts, subtracts, or selects.
   `test-unallocated-cash.js` hand-computes `$5,000 − $500 − $200 × 91 /
   (365.25 / 12)`, proves the zero-cent boundary on both sides, reconciles
   the live remainder against that same identity on the published `$200`
   reserve, and halves the window conversion so the B73 mutation now fails.
   No published figure or wording moved on the live plan.

   **RESOLVED 2026-08-14 — compact snapshot.** `Forecast.compactSnapshot` now
   owns the secured-debt total, monthly interest across every facility, and
   the HELOC month-on-month direction: posted `balance` on `secured` debts,
   `annualInterest / 12`, last history point minus the one before it, with
   the trend taken on the published whole dollar so a move that prints `$0`
   cannot read "still growing". `public/plan.js` prints the returned figures
   and looks the HELOC sentence up; it no longer sums, converts, or selects.
   `test-compact-snapshot.js` hand-computes `$100,000 + $50,000` and
   `$7,200 / 12`, proves both HELOC directions and the `$0` boundary,
   reconciles the live tiles against the posted mortgage/HELOC balances and
   the seven annual-interest literals, and changes `/ 12` to `/ 6` so the
   B73 mutation now fails. Live published figures are unchanged
   (`$747,612.74`, `$3,046`, HELOC `+$501` still growing). The `$0`
   wording is a real defect found in the move, unreachable on the live
   history.

   **RESOLVED 2026-08-14 — food and fuel.** The weekly food-and-fuel pair the
   scan recorded — `filter` groceries+fuel then `reduce` planned, convert
   `/wk`; `food.planned + fuel.planned`; `food.historical + fuel.historical` —
   already moved with the weekly-cap work into `Forecast.budgetBreakdown`'s
   `cap` block (`foodFuelPlannedWeekly`, `foodFuelHistoricalWeekly`,
   `groceriesPlannedWeekly`, `fuelPlannedWeekly`). Those line numbers (634–636,
   671, 994, 999) were already stale against that move; they are not
   re-implemented here.

   What still decided on the page was the monthly sentence and the owner-budget
   chip: `categories.find` for groceries and fuel, then
   `target || historical` for each. Each category already decided that
   fallback as `gross` (pre-dated) and `source`; `planned` remains the
   post-dated amount the weekly cap uses. The `cap` block now publishes
   `groceriesMonthly` / `fuelMonthly` from `gross` and
   `groceriesHasOwnerTarget` from `source` — it does not choose target vs
   historical again. `public/plan.js` prints those returned fields.
   `test-food-fuel.js` hand-computes `$1,200` vs `$1,100` historical on a
   fixture, proves a missing target, a $0 target, and a dated grocery that
   leaves `gross` at the target while `planned` falls, reconciles the live
   `$1,800` / `$1,300` against the `data.json` `plannedMonthly` literals
   (not the ytd averages `$1,839.66` / `$989.13`), and mutates the
   incumbent `gross = target != null ? target : historical` line so the
   choice now fails. Before the move, replacing
   `food.target || food.historical` with `food.historical` left `npm test`
   green (ALL 20 SUITES PASSED). Live published figures are unchanged.

   **Item 6 is closed.**
7. **Phase titles and the risk list** — `public/plan.js`.
   **RESOLVED 2026-08-14.** `Forecast.planPhases` now owns which heading each
   30-day block gets, which opening body applies, which way consumer debt
   moved, whether the HELOC sentence belongs in 31–60, which risks appear,
   and the figures inside them. Over-limit-today and the HELOC crossing are
   the same helpers `Forecast.mission` already uses; the Amanda amount and
   `neededBy` come from `incomeDeadline`; the window impact is the incumbent
   `amount × 3`; the HELOC draw is `drawnOn(funding, 'heloc')`, the same
   sum the HELOC alternative prices; telecom `planned` is the category
   `budgetBreakdown` already built. `public/plan.js` looks the wording up.
   `test-plan-phases.js` hand-computes `$2,182 × 3 = $6,546` and
   `$786+$800+$500+$500+$500 = $3,086`, proves both sides of the gap /
   over-limit / consumer-fell / HELOC-day-60 / draw / telecom boundaries
   and equality on `<`, reconciles live titles
   (`Cover the gap` / `Get back inside the limits` / `Put the surplus
   against principal`) against those same comparisons on the published
   marks, and flips `<` to `>` plus `× 3` to `× 2` so the B73 mutation
   now fails. Before the move, those two mutations left `npm test` green
   (ALL 21 SUITES PASSED). Live published conclusions are unchanged.

   **Item 7 is closed.**
8. **The Deep Dive's derived totals and its interest reconciliation** —
   `public/deepdive.js`.
   **RESOLVED 2026-08-14.** `Forecast.deepDive` now owns held-elsewhere
   grouping and totalling, a period's spending monthly average, discretionary
   total and share, avoidable-fee total, which Cash Back Visa cycles sit
   outside the incumbent ±4 percentage-point band, the implied and charged
   five-cycle totals, the published card rate, and the mortgage's monthly
   interest. The card rate is the Cash Back Visa `debts` record, not a page
   `26.99` literal. Mortgage monthly interest is `monthOfAnnual` on that
   debt's `annualInterest` — the same twelfth `compactSnapshot` uses — not a
   hardcoded `~$1,620/month`. The ±4pp `>` band is kept. `public/deepdive.js`
   prints the returned figures and looks class labels up.
   `test-deepdive.js` hand-computes `$100+$50+$20 = $170`, `$250+$200 = $450`
   at 45% of $1,000, $20 avoidable, both sides of ±4pp with equality on 4,
   `$12,000 / 12 = $1,000`, and live cents `$2,691.85+$74.20+$205.92 =
   $2,971.97`, implied `$504.37` / charged `$492.64`, last-month
   discretionary `$6,518.25` = 59% of `$10,961.14`, ytd average
   `$74,595.09 / 8`. Mutation of the ±4pp band to 40, the elsewhere add
   halved, the monthly average halved, the discretionary filter dropped, and
   the shared twelfth `/ 12` → `/ 6` now fails. Before the move, widening
   the band to 40, swapping the footer rate, halving elsewhere, doubling the
   monthly average, and replacing `$1,620` with `$1,000` left `npm test`
   green (ALL 22 SUITES PASSED). Live published figures are unchanged.

   **Item 8 is closed.** The recorded B73 set is complete.

#### What the scan cleared, so the next pass does not re-litigate it

`public/app.js` is clean: nothing financial is decided in the shared page core,
and `payoff()`, `monthlyRate()` and `amortisedPayment()` are confirmed gone.
`public/records.js` is clean — every figure is read from `data.json` and every
chip class comes from a status already decided there. `public/modellers.js` is
clean: both modellers consume `Forecast.payoffDebts` / `payoffModel` / `renewal`,
and the wording maps are keyed by engine ids. `renderCalendar()` is what
`ARCHITECTURE.md` says it is — presentation of `sim.events`, with cell classes
compared against the engine's own buffer. The knob wiring, the `KNOBS`
persistence allow-list, `MISSION_PART`, the weekly table and cards, the aggregate
ledger and `forecastChart` all render values the engine decided. Inside the
funding block, the lede at 453–458 is presentation — it prints `gap.dueOnGapDay`,
the gap and the buffer as they arrive; what item 2 names is the per-source
verdict below it, and that is where the boundary sits.

**This list is a reading, and one reading already missed something.** It is
recorded so the next pass starts somewhere rather than from nothing, not as a
guarantee. Item 2 came out of a block a few lines below one this scan did catch,
which is the argument for treating "cleared" as *inspected and argued*, never as
*proved*.

**Presentational thresholds were not counted as authorities, and that is a
judgement worth stating.** The page chooses numbers for colour and inclusion — a
7-day "soon" chip, a 3-day tile tone, `>= $50` in the fortnight agenda, `>= $250`
on a week card, `>= $1,000` for a payday dot, `<= −$500` for a payment triangle,
`> 95%` utilisation, `>= 20%` / `< 5%` on a rate, `< $500` of revolving credit
left, `> $40,000` unexplained. None changes a published figure; each only decides
how an already-decided one looks. They are listed here so a later reader can see
they were inspected and ruled on rather than missed. Two were worth a second look
when item 8 closed: the `>= 20%` / `< 5%` rate colouring is the closest any
of them comes to interpreting money into a verdict, and `deepdive.js` computes
its own days-until for the upcoming table while `Forecast.nextDue` computes
`daysUntil` for the tile beside it — one question, two implementations, agreeing
today. **Second look on 2026-08-14:** both still colour or label an
already-decided figure; neither was moved. A later finding that either one
changes a published number would be a new item, not a reason to reopen this
one.

**No new hard gate came out of this scan, deliberately.** The failure it found is
not mechanically signable: a page script that decides looks exactly like a page
script that formats until a human reads what the expression concludes. A regex
denylist over `public/*.js` would pass on every one of the ten mutations above
while claiming the class was covered. `B75` already records that the authority
guard does not claim this class, and `docs/RISK_LABELS.md` says the same. The
protection each item above needs is the engine function it names, with a test
that reaches the figure — not a guard standing over the defect.

**B74 · Two calendars, and nothing notices when they disagree** · **DONE 2026-08-14**
Merged as PR #37. Owner chose Option A: one authoritative household cash schedule. Canonical flow
is `data.json` `plan` → `Forecast.expandEvents`. That stream now feeds the Plan
calendar, Next cash-out total, Deep Dive Next named payment due, and ICS payment
VEVENTs. Standing ICS reminders (statement closes, tax deadlines, mortgage
renewal) remain a thin non-cash overlay. `data.json` `upcoming` is deleted as a
schedule; paid forensic notes remain in `settled`. The children's RESP $100 on
the 15th is a canonical `plan.bills` row. CMAW Local 1995 dues remain a Plan
bill until cancellation is actually confirmed; the cancel action stays open and
the bill is retired when evidence closes it. HELOC cash treatment is unchanged
(month-end `nonCash`); the 21st is a reminder-only look-point, not a chequing
outflow. Whether cash must be reserved on the 21st stays in Q19.

The two look-aheads are kept and labelled apart: Next named payment due is one
obligation; Next cash-out total is the day's sum. Both read the same event
stream, so two Burrard payments on 12 August correctly produce $320 and $623
without two calendars.

Do not reopen the closed schedule-authority list. Remaining critical path
is finish `B91`, then `B94`, then `B96` (end-to-end payday proof), per the
build strategy. `B20` / `B21` are not that path.

**B87 · One authority for question OPEN / ANSWERED status** · **DONE 2026-08-14**
`docs/01_OPEN_QUESTIONS.md` is the sole OPEN / ASKED / ANSWERED / BLOCKED
authority. Deep Dive `data.json` `questions` no longer uses `tier === 0` or
`ANSWERED —` records as a second status bit. Q2 stayed OPEN in that PR; Q5
was later ANSWERED (2026-08-16 — garage/lab income ended). Payment-
matching and rent analysis stay evidence, not household answers. Proved by
`test-question-status.js`. Build-strategy item `AF-QSTAT-01`.

**B88 · Tests must not depend on checkout line endings** · **DONE 2026-08-14** · *housekeeping*
Source-inspection tests no longer fail because a checkout used CRLF. Newline
identity is normalized at the test input boundary (`test-source-text.js`); the
invariants those tests protect still fail on a real defect. Proved by
`test-line-endings.js`. No `.gitattributes`. Build-strategy item `AF-LINE-01`.

**B89 · Stop storing derived publication totals** · **DONE 2026-08-14** · *small*
`Forecast.publicationTotals` derives the Deep Dive headline totals, Records
net-worth lines, the income footer, the commitments total, the lacrosse
verified total, and the HELOC chart limit from canonical `debts` / `assets`
/ `income` / `commitments.items` / `lacrosse.sources` rows and
`Forecast.utilisation`. Deleted stored copies: `headline`, `netWorth.assets`
/ `debts` / `financialAccountsOnly`, `incomeTotal`, `helocLimit`,
`commitments.total`, `lacrosse.verified`, and `mortgage.balance` / `rate` /
`paymentBiweekly`. The Deep Dive "Credit left" scalar moves from the stale
stored $1,415.95 to utilisation's $1,415.98 (the Plan tile, upcoming note
and positions.csv already used $1,415.98; the whole-dollar tile still prints
$1,416). The historical income footer's capture window is
`data.incomeCaptureMonths` beside the `income` rows — the same shape
`paypal.months` already uses — not a `forecast.js` constant. Proved by
`test-publication-totals.js`, including an 18 → 19 source-window mutation
that does not edit the engine. Build-strategy item
`AF-PUB-01`.

**B90 · Guard overlapping essential / discretionary classification** · **DONE 2026-08-14** · *small*
After `B89`. Forward Plan cap uses `plan.budget.categories[].class`; Deep Dive
historical mix uses `periods.json` `type` from `docs/merchant-library.csv`.
`test-classification.js` joins them on the existing `from[]` list. Comparable
overlaps must agree, be a named non-comparable semantic (`business`,
`reserve`, `unknown`), be surfaced as owner-unresolved, or be named
source-semantic ambiguity. School & clubs is the live comparable disagreement
(forward discretionary, historical essential) and is Q24 — not guessed. Health
merchant-library types remain mixed (`essential` medical rows and
`discretionary` personal-care rows). Mixed comparable source types publish as
`unknown` with the source `types` retained — the existing unresolved semantic —
so Deep Dive cannot consume Health as a clean essential or discretionary class
because one event happened first. Totals stay conserved. Personal-care
merchants were not reclassified as essential. Build-strategy item
`AF-CLASS-01`.

**Outcome:** the same household spending category cannot disagree on
essential/discretionary without a failing test. Preserve genuinely distinct
semantics (`business`, `reserve`). Prefer a small explicit guard over a new
classification system.

**B91 · Evidence refresh / reconciliation loop** · **DONE 2026-08-16** · *architecture, current-state cutover*
After `B92` and `B93`. **Current implementation outcome** and next major
product milestone. The live published opening is now **2026-08-19**; the
2026-08-16 cutover remains dated evidence in `snapshots/` and the pinned
`28d08a12` proof. Owner-approved 19 August household cash/debt values were
landed without restoring stored funding `available` or `debtId` action
status as current-state. Capture, extraction, and the non-writing reconciliation
report exist. Owner-approved Aug. 14 evidence that was strong enough has
now been written into canonical `data.json`; Forecast consumes that state.
The Evidence-Use Register (`B85`) proves routing of declared IDs, not that
a routed number is current or fresh.
Build-strategy item `AF-RECON-01`. Payday acceptance corpus:
[`docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md`](docs/source_intake/PAYDAY_ACCEPTANCE_2026-08-14.md).

**First slice (not completion):** `scripts/reconcile.js` compares the closed
Household cash/debt map in `docs/reconciliation/balance-map.json` to
canonical `plan.startingCash` / `debts` and does not write `data.json`.
Statuses assigned: MATCH / CHANGE / CONFLICT / MISSING. STALE is not
assigned — no owner-defined age threshold. `Forecast.expandEvents` accepts
`plan.opening.representedEvents` / `opts.representedEvents` so a same-day
payroll already inside the opening observation is not replayed while an
unposted same-day mortgage still is. Live canonical balances are unchanged.

**D3 slice (not completion):** a dated commitment may carry `settledOn`
(`YYYY-MM-DD`). `Forecast.commitmentSettledBy` treats the cash requirement
as satisfied only when that date is on or before the Forecast opening.
The record stays; `Forecast.expandEvents` then emits no future cash event.
Settlement observations live in
`docs/reconciliation/commitment-settlements.json` and compare against
`plan.commitments[].settledOn`. The reconciler remains non-writing.
Live Fusion camp and tryouts now carry `settledOn: "2026-08-14"` from the
owner-approved current-state cutover. Q23 is ANSWERED: the three $500
Fusion season instalments were stale and have been removed; the upcoming
season is the `B95` `fusion-season` estimate. Do not mark this item DONE.

**D4+D5 slice (not completion):** a dated `plan.bills` row may carry
`payingAccount`. Household-obligation status is a separate fact
(`householdObligation`, default true). Joint-cash deduction is suppressed only when the paying
account is on `plan.startingCash.heldElsewhere`. No payingAccount, a
breakdown payer, or an unknown/typo id fail closed and still deduct. Hydro observations live in
`docs/reconciliation/utility-observations.json` and compare the Aug. 14
account balance (informational / not scheduled), the $213.79 current due,
the $237.45 1 September due, and Amanda / DEBT&PAYMENTS as
external-to-joint-pool. The reconciler remains non-writing. Live Hydro
now includes the 1 September $237.45 dated due (`hydro-due-sep1`), paid
from Amanda, still a household obligation, not joint cash. Q17 is
ANSWERED: the old Hydro arrears are settled and are not a future
obligation. Do not mark this item DONE.

**D2 slice (not completion):** Amanda employment deposits, coaching/business
inflows, business obligations, household transfers, and household-available
remainder are distinct observation facts in
`docs/reconciliation/amanda-income-observations.json`. Observed Tennis BC
nets ($2,168.85 around the 15th, $2,387.99 around month-end) are income
into Amanda / DEBT&PAYMENTS. They are observed operating-income deposits
with no canonical salary fact and are intentionally not promoted into
Forecast — they do not MATCH `amandaTransfer`. `plan.income.amandaTransfer`
remains the household-cash Forecast authority and is reported as canonical
context; the Aug. 14 corpus does not independently observe its
scenarioMonthly values. Coaching receipts are not automatically household income.
Unknown business obligations fail closed — the reconciler does not
invent a household-available remainder from salary minus guessed costs,
and the Aug. 14 $798.37 DEBT&PAYMENTS balance is not spendable.
The reconciler remains non-writing. Live `amandaTransfer` and
DEBT&PAYMENTS are unchanged. Do not mark this item DONE.

**D8 slice (not completion):** credit-card current state is observed as
distinct facts in
`docs/reconciliation/card-state-observations.json`: posted balance,
pending, limit, available credit, and confirmed payment. Exposure is
derived fail-closed from those facts. Unknown pending is not $0. Limit
and available credit are never household cash. A scheduled minimum is
not a confirmed posted payment. The same confirmed payment cannot reduce
exposure twice. Same-time contradictory posted / available / limit
figures are CONFLICT, not a guessed identity. Pending is not
manufactured as limit − posted − available unless that identity is
proven for that card and timestamp (MBNA 2026-08-09 is the committed
proven case). The reconciler remains non-writing. Live card
balances/limits/pending/payments are unchanged. The later pending-
transaction slice derives mapped revolving-credit pending from Lunch
Money transactions (Bell Mobility $250 on Travel Visa is the acceptance
fixture) and still does not write live card state. Do not mark this item
DONE.

**D7 slice (not completion):** posting observations live in
`docs/reconciliation/posting-observations.json` and compare whether a
scheduled occurrence has posted against `plan.opening.representedEvents`.
Forecast remains authority for what should happen. Posting evidence is
authority for what has happened. A posted same-day event missing from
`representedEvents` is CHANGE (double-count risk). An unposted event
named there is CONFLICT (skipped-obligation risk). Unknown posting is
MISSING, not guessed posted or unposted, and inventing a represented
entry for it is CONFLICT. The Aug. 14 corpus proving pair is payroll
(posted, inside the opening) and mortgage (expected, not on the bank
screenshot). Fit4Less, BCAA, ICBC, and RESP stay unknown. The reconciler
remains non-writing. Live `plan.opening` is unchanged — there is still
no Aug. 14 cutover on canonical state. Do not mark this item DONE.

**D11 slice (not completion):** `Forecast.recommend` derives
`nearBoundary` from existing `zero.events` — named joint-cash outflows
on the next payday and the following calendar day. `Forecast.mission`
emits that list before surplus-use guidance. Forecast arithmetic is
unchanged: no second horizon, no new payday engine, no `$600/week`
policy. Live household financial facts are unchanged. Do not mark this
item DONE.

**Current-state cutover — complete 2026-08-16 (historical / retired dated evidence).**
This block is the 2026-08-16 cutover record. It is not current Atlas
truth. The live published opening is now **2026-08-19**; this 2026-08-16
opening remains dated evidence in `snapshots/2026-08-16.json` and the
pinned `28d08a12` proof. The $2,252.76 cash, 2026-08-16 opening, and
then-OPEN Q19 statements below describe that dated cutover only.

On that 2026-08-16 cutover, the published Forecast opening was
2026-08-16 from the Lunch Money observation fetched 2026-08-16T20:57Z
plus the same-day Triangle/MBNA screenshots. Spendable cash on that
opening was independently $2,252.76. Friday 14 August payroll, mortgage,
Shaw, Fit4Less, the $220 Hydro debit, the $94.03 TD-card minimum, and
the $763 Cash Back payment are inside those snapshots and are not
replayed. `representedEvents` is empty because nothing scheduled on 16
August is inside the observation. Unposted 15 August BCAA / ICBC / RESP
/ union dues are reserved as once rows on that opening. Triangle
posted/pending come from the owner screenshot, not Lunch Money's
last-statement figure. Amanda / TENNIS INCOME stayed held-elsewhere.
**At that cutover, Q19 was still OPEN.** $600/week is not encoded.
Observation files remain evidence; the reconciler remains non-writing.
The Aug. 14 corpus stays the distinction checklist. Q19 was later
**ANSWERED 2026-08-18** by the HELOC closeout (remaining August cash
requirement $0 additional). Do not read this dated OPEN state as
current question status.

**Outcome (whole item, closed 2026-08-16):** a small **non-writing**
reconciliation report over existing observation records: evidence
value/date, current Atlas value, MATCH / CHANGE / CONFLICT / MISSING,
unresolved item. One canonical pointer into `data.json`. Owner-approved
edits land there and Forecast consumes them. B91 closed on the
2026-08-16 cutover; that dated opening remains preserved evidence, not
the live published opening (now **2026-08-19**). Same-day income already
inside that 2026-08-16 observation is not replayed. Existing Forecast
produced the household payday plan from that dated opening (mode
`normal`, weekly $920, not $600 policy). Those $920/week and
2026-08-16-opening statements describe that dated cutover only. The
Aug. 14 corpus remains the distinction checklist. **At close, Q19 was
still OPEN and fail-closed**; it is now **ANSWERED 2026-08-18** and is
not reopened by this completed record. B20 history and a universal
STALE threshold were not B91 closers.

**B91 must also consume these payday distinctions:** schedule ≠ posted;
paid commitments stop reserving cash; account balance ≠ amount currently
due; household obligation ≠ paying account; posted vs pending vs limit vs
available credit; account balance ≠ spendable cash; Amanda salary, coaching,
and transfers as separate authorities; near-boundary obligations visible
from existing Forecast. **At B91 close, Q19 HELOC cash impact was still
unresolved** — the 2026-08-16 record correctly refused a confident zero
household cash impact. That question is now **ANSWERED 2026-08-18**: the
14 August $1,100 already inside the 2026-08-16 opening satisfies the
August minimum, so remaining August HELOC cash requirement is $0
additional. Do not read the dated unresolved warning as current Q19
status.

**Do not build:** a database; a second canonical store; a generic fact
schema; a workflow engine; event sourcing; a classification registry; a
provenance graph; a staging platform; generated `data.json`;
`plan.proposals[]`; leaf-level source objects; another extraction
architecture; another forecast, payday, or budgeting engine; a universal
`positions.csv` fact database; Google Sheet or ChatGPT as authority.

**B92 · Make ordinary evidence refresh cheap** · **DONE 2026-08-14** · *tests, one outcome*
After `B90`. Behaviour tests were pinned to live household numbers, so a
legitimate refresh was a suite rewrite. Measured on `main` before the unpin:
Chequing A 8 suites / 61 assertions; MBNA 5 / 19; Fusion camp removed 6 / 18;
payroll + Shaw 5 / 27. Build-strategy item `AF-TEST-01`. Behaviour suites now
use synthetic fixtures, derived input arithmetic, or parent mutation; live
cents remain only in deliberately live reconciliation (`test-live-household.js`,
`positions.csv --check`). `node test-refresh-isolation.js` proves the four
refresh classes. Do not start `B91` first.

**B93 · Derive or delete proven duplicate live facts** · **DONE 2026-08-14** · *architecture, one outcome*
After `B92`, before `B91`. Cash balances live on `plan.startingCash` account
rows; matching `assets[]` rows keep label/order and a `cash` id. Overdraft
`used` and funding-option availability are `max(0, −chequing-b)` and
`max(0, limit − used)` from `revolvingExtra.limit`. `debts[].balance` is the
posted opening; `postedBalance` is gone. Recurring historical `perMonth` is
`round(total / incomeCaptureMonths)`; the insurance one-off keeps
`perMonth: null`. Proved by `test-dedup-facts.js`. Published Plan figures
unchanged 75/75. Do not add a sync layer. Do not treat `docs/positions.csv`
as a universal fact database. Build-strategy item `AF-DEDUP-01`.

The leftover class was stored current-balance conclusions on
`plan.funding.options[].available` (HELOC, cards aggregate, Amanda cash)
and stored limit-satisfaction on `plan.actions[].status`. Those are now
Forecast views (`resolveFundingSources` / `resolveActions`) from extra
facilities and utilisation. A held-elsewhere `cash` locator (Amanda /
TENNIS INCOME) is observational identity only: Q25 stays OPEN, so the
raw balance is not household funding. Snapshots remain dated evidence.
Do not restore a second live headroom number on the option row, and do
not infer fundability from a held-elsewhere balance.

**B94 · One master forecast; ranges are views** · **DONE 2026-08-16** · *engine earned; one outcome*
Owner instruction 2026-08-16. The product contract lives in
`ARCHITECTURE.md` under **One plan, many windows**: one Forecast
projection at least 12 months forward; week / payday / month / 13 weeks /
6 months / 1 year / custom range are views; changing the visible range
does not change what the plan knows; known major costs outside the
visible span still constrain today's safe-to-spend; Forecast sequences
funding by timing, certainty, owner-stated priority and flexibility, and
reallocates capacity a commitment releases rather than turning it
automatically into safe-to-spend; planned debt may be part of the path
when it is the better household plan, including to preserve cash for
higher-priority needs, and must carry consequences and a repayment path
in advance; debt is owner-constrained and never automatic; major future
plans show ON TRACK / AT RISK / FUNDING GAP from Forecast.
Forecast remains the planner. Do not create a second planner, a generic
schema, or a parallel authority.

Engine earned 2026-08-16; contract repaired 2026-08-17 after Atlas
Contract / Systems Review, including the follow-up repair for future-start
custom views, dated-range deadlines, optional residual targets, and
planned-debt pending / repayment / purpose terms. `Forecast.recommend` searches
`Forecast.knowledgeHorizon` (≥12 months for every plan; always
long enough for dated unsettled commitments) and reserves protected
principal jointly, including overdue unsettled point amounts until
settlement, tested against as-of surplus rather than later income. Named ranges are views.
`Forecast.fundingSequence` / `Forecast.majorPlans` / `Forecast.plannedDebt`
are the presentation order, the three verdicts with a dollar margin/gap,
and opt-in purpose-specific planned debt on the same projection. Live
`windowDays` stays 91. No dates, amounts, priority weights, or debt
permission were invented on live rows. `B95` remains the one home for
known major costs. ON TRACK / AT RISK / FUNDING GAP applies to those
major future plans, not to individual transactions or budget categories.
The end-to-end payday proof is `B96` / `AF-PLAN-02`. Proved by
`test-master-forecast.js`. Build-strategy item `AF-PLAN-01`.

**B95 · Absorb known major future costs onto the master plan** · **DONE 2026-08-16** · *canonical plan / evidence absorption*
**This is the one backlog home for major-future-spend absorption.** Do
not open a ticket per purchase, and do not create a goals engine, a
savings engine, a generic schema, or a second planner.

Owner instruction 2026-08-16. Known major future spending and the named
annual irregulars now have one home: unsettled `plan.commitments` for the
one-off / owner-estimated costs, and the existing property-tax **reserve**
for the annual municipal lump. Amounts, timing, flexibility, and ranges
live on those rows — do not copy them here. Deep Dive reads those rows
through `Forecast.publicationTotals`;
`data.commitments.items` is deleted as a second list. Undated rows emit
no cash event and are not smeared across the 91-day sinking line. Open
ranges stay ranges. No dates, priorities, funding amounts, or debt
policy were invented. B94 sequencing and out-of-window safe-to-spend are
not started. Proved by `test-major-future-costs.js`. A later estimate
change is an edit to the existing row, not a new backlog item.

**B96 · Prove the payday question end-to-end** · **DONE 2026-08-16** · *after B94; one outcome*
Distinct from `B94`. This item does not implement the master-forecast
engine. After that engine exists, prove the closed loop a household
actually reads: fresh evidence → canonical state → Forecast → household
answer. Entry is `B91` far enough along that the opening is the current
canonical state, and `B94` far enough along that Forecast is the master
projection. Acceptance is an independently proved payday answer from
that chain, not a test of the function under change. Do not invent a
second payday engine. Do not encode $600/week as policy. Build-strategy
item `AF-PLAN-02`.

Proved on the 2026-08-16 opening. The Plan page composes the household
payday answer from incumbent Forecast results (`recommend`,
`fundingSequence`, `majorPlans`, `plannedDebt`, `nearBoundary`,
`nextPaymentOut`, `nextDue`, `unallocatedCash`, `mission`, `nextMove`,
`planStatus`). No `Forecast.paydayPlan` was added. Spendable cash is the
independent $2,252.76 identity. Weekly $920 is the master-plan cap, not
cash-minus-bills and not $600 policy. A dated January commitment on this
same plan reduces that cap; changing only the visible window does not.
Settled rows stay settled; released capacity redirects along
`fundingSequence` without becoming automatic safe-to-spend. Overdue
protected items cannot be rescued by later income. Credit is not cash.
Q19 is ANSWERED. Q20 / Q25 stay OPEN and fail-closed. Q26 evidence is
ANSWERED by the #106 pending census (Cash Back pending proven 0);
canonical Cash Back pending remains UNKNOWN until a separate write.
`planStatus` copies
recommend's INFEASIBLE result so the band cannot read "on plan" beside
it. Proved by `test-b96-payday.js`.

**B75 · Nothing checks that the authority table is complete** · **DONE 2026-08-11**
PR #10 added `test-authority-coverage.js` to the blocking `npm test` suite. It
mechanically enumerates the named, closed surfaces earned by this finding:
Forecast exports; `data.json` policy keys `actions`, `nextDollar` and `budget`;
the page-core calculators — `payoff()`, and `amortisedPayment()` until it moved
into `Forecast.renewal`; and the named artifact writers
`periods.js` / `calendar-ics.js`. It proves the guard bites when a known Forecast
authority row is removed or an unclassified export is added, and it explicitly
does **not** claim a clean mechanical signature for the B73 page-script class.
The guard itself is on the closed high-risk path list, so it cannot later claim
`NOT REQUIRED` while weakening its own protection.

**B76 · The scope tripwire counts implementation only** · *needs a decision, not a fix*
`CLAUDE.md`'s scope budget counts **implementation** files and **implementation**
lines — source, workflows, templates — and counts documentation separately. For a
documentation-only pull request the tripwire therefore contributes nothing: there
is no numeric prompt at all, whether the change is eight lines or nine hundred.
The superseded PR #4 ran to over nine hundred documentation lines and PR A to
458; both were honest, and neither tripped anything.

**This finding is smaller than when it was first recorded, and the framing is
updated rather than carried across.** Scope is now explicitly a reviewer
judgement — the tripwires are "guidance, not merge-card fields and not CI
thresholds", and a reviewer asks whether the pull request is still one
independently provable outcome whether it is under or over them. So the gap is no
longer a gate that passes silently; it is a prompt that never fires for prose.

What remains worth deciding: a long document can carry an unreviewable amount of
authority-changing prose exactly as a long diff can carry code, and nothing draws
a reviewer's eye to that. Any answer should go through the governance-control
lifecycle rather than straight to a number — a new hard control needs a
demonstrated failure it would have caught, a deterministic predicate, a test that
proves the predicate fails on the defect, and a retirement condition. A
documentation line limit chosen without those is the gaming `CLAUDE.md` warns
about, with extra steps. Carried forward from PR #4, which recorded it under an
identifier since reused.

**B77 · The GitHub connector bypasses the pre-commit hook** · **DONE 2026-08-20** · *governance, small*
`.githooks/pre-commit` is described in `CONTEXT.md` as the safety net that catches
content-level mistakes a `.gitignore` never could, and as something never
bypassed. Commits authored through the ChatGPT GitHub connector are made through
the GitHub API, so no local hook runs on them — the net simply does not see that
path. Found when PR #5's two interview files, 466 lines of household detail
committed through the connector, were run through the hook after the fact. **They
passed**, so nothing was wrong in the repository at the finding; the gap was
structural and recurred on every connector-authored branch. Closed by keeping
one identifier/secret engine (`scripts/privacy-guard.js`) as the hook's
delegate and applying the trusted default-branch copy of that engine to every
PR head (`privacy-guard.yml`). A connector-authored write the incumbent policy
would reject now fails CI; a PR cannot weaken the copy that judges it. Generic
card/SIN checks in `test-static.js` are not a second household-identifier list.
Proved by `test-privacy-guard.js`. Permanent while GitHub write paths exist
that skip local hooks. Adding the `privacy-guard` status to required checks on
`main` remains an owner repository-setting action.

**B82 · The figures comment claims a wider scope than it checks** · **DONE 2026-08-20** · *governance, small*
`figures-review.yml` compares `scripts/figures-snapshot.js` output between base
and head, and on a clean run posted: *"Every one of the N figures the household
can read off the Plan page is identical on this head and on `main`. Whatever this
PR changes, it does not change what the household is told."* The first sentence
is exactly right and names its scope. The second generalised past it — the
snapshot's own rule is what the household reads off the **Plan page**, and the
household is also told things on Deep Dive, Records and Modellers. A pull request
that moves only a Deep Dive figure would draw that sentence unchanged.
Found on PR #13, which moved the Deep Dive "Next due" selection: the comment
reported 75/75 identical and was correct, but nothing it compared covered the
tile the PR was about. Nothing is wrong in the repository today and no figure is
misreported; the defect was that a true, narrow result was worded as a broad one,
which is the false-green shape this repository already has scar tissue for —
`scripts/figures-snapshot.js`'s own header records an earlier conflation of
"unchanged against the previous commit" with "unchanged against base". Closed by
keeping the Plan-page sentence and stopping there. The moved-figure comment now
names Plan-page rows rather than "something the household would read
differently." Extending the snapshot to Deep Dive, Records, or Modellers remains
an owner scope decision and is not this outcome. Proved by `test-figures-comment.js`.

**Issue #57 remainder · Autonomous delivery loop** · *governance, not a new B-id*

The repair → handoff → GPT-5.6 follow-up → card-sync middle is live as of
PR #63. Duplicate GitHub/Merge-Card primary-risk state closed in PR #64.
Owner granted first REQUIRED GPT-5.6 reviews on 2026-08-16; the first-review
wake-up is this outcome. Standing auto-merge of qualifying `auto-safe` PRs
is granted but must not become operational until GitHub itself enforces
`tests`, `Merge card mechanical fields`, and `risk-label/primary` on `main`.
Next-node wakeup remains later. They do not reorder `B91` and they are not
a slice taxonomy.

**B85 · Evidence-Use Register** · **DONE 2026-08-13** · *architecture, one outcome*

Explicitly identified August 13 evidence IDs now have a live CI-checked
disposition in `docs/evidence_use/register.json` (PR #28). The register owns
routing and parking only. It does not prove financial correctness. After PR #28
it still parked payroll, HELOC 21st-vs-31st cash treatment, Fusion camp status,
Amanda’s $600 restaurant target, sports/travel priority, pension-in-net-worth,
and the optional contribution ramp. The current recurring payroll *net* was
later consumed by **B86**; those other parked items remain.

**B86 · Stale biweekly payroll net in the 91-day forecast** · **DONE 2026-08-13** · *figures, one outcome*

Live `plan.income` `payroll` was **$4,468.69**, labelled as fifteen consecutive
deposits. August 2026 payroll-statement synthesis (`EMP-004`) shows the current
recurring net after CPP/CPP2/EI completion and the current 1% optional pension
is **$4,247.92–$4,274.98**, observed average **$4,264**. This interruption
replaces the incumbent 91-day cash input with that average, tagged
**estimated** because future cheques are not individually confirmed at exactly
$4,264, routes `EMP-004` to `data.json` `/plan/income/0`, and leaves salary
history, bonus, statutory engines, and pension forecasting unbuilt.

**B84 · `ARCHITECTURE.md` keeps its own running count of B73's progress** · **DONE 2026-08-20** · *documentation truth, small*
Three counts of one fact lived outside the file that owns it. The section
below the incumbent table said the scan's page-side instances are the ones
`B73` records "and each is its own outcome to move. **Those first two have now
moved** … **six remain**"; the next paragraph opened "Seven instances have been
moved into the engine rather than argued away" and enumerated them; and the one
after said `public/plan.js` "holds five now". `BACKLOG.md` owns work and
findings — `CLAUDE.md` says so — and each of those three numbers was already
wrong before this finding was written: items 3 and 4 had moved without any of
them changing, so the true figures were four remaining, nine moved and three in
`plan.js`. Item 5 moving makes them three, ten and two.

This is the same shape as `B83`, and it wanted the same fix: **remove the second
home, do not synchronise it.** The prose is worth keeping — the enumeration
explains what each move actually was, which no count does — so what should go is
the arithmetic, replaced by a pointer to `B73`. Found while adding the
`Forecast.nextMove` row to the incumbent table on the item 5 move, and
deliberately **not** fixed there: that pull request's authority boundary is the
engine against `public/plan.js`, and rewriting three paragraphs of migration
narrative is its own outcome with its own acceptance condition — no count of
`B73`'s progress survives outside `BACKLOG.md`, provable by grep. It changes no
figure and gates nothing.

The second home is **removed** rather than reconciled. Closing `B73` had
already rewritten those three phrases into "have now all moved", "the recorded
instances have been moved", and a historical "held seven of the eight" — still
a running count, just a later one. `ARCHITECTURE.md` now keeps the enumeration
of what each move was, states that a copy of the progress arithmetic lived
there and drifted, and points at `B73` in this file as the sole work record.
Closed by the pull request that removed the counts, because leaving this entry
open would have left `BACKLOG.md` describing arithmetic that no longer exists.

**B83 · `CONTEXT.md`'s suite table names five of twelve suites** · **DONE 2026-08-12**
Both inventories are **removed** rather than reconciled, which is the fix this
entry asked for done one step further. It recorded twelve suites; `CONTEXT.md`
said "Five suites, in dependency order"; `docs/RISK_LABELS.md` said "`npm test`
runs seven suites"; `test.js` registered fifteen by the time it closed. Four
numbers for one fact, and every one of them wrong at some point — which is the
argument against keeping any of them rather than for synchronising them again.

Both documents now name `test.js` as the suite registry and state no count.
`CONTEXT.md` keeps what the suites protect **in kind rather than by name**, so
the reader still learns the guards exist without a list that drifts the next
time one is added — the failure mode this entry was really about.
`docs/RISK_LABELS.md` keeps why each suite blocks, against the demonstrated
failure that earned it, which is what that file is for. Closed by the same pull
request that removed the tables, because leaving this entry open would have left
`BACKLOG.md` describing two tables that no longer exist.


**B78 · Idempotent Lunch Money import with stable identity** · **DONE 2026-08-17** · *T3*
Build-strategy item `AF-INGEST-01`. Incumbent `scripts/provider-observe.js`
and `scripts/reconcile.js` remain the path. Mapping is still existing
Lunch Money provider account IDs. Historical posting candidates whose
date is not the current opening as-of are classified and are not fed to
the current-opening posting compare, so they cannot backfill
`representedEvents`. Same-day CHANGE records `winnerChosen: false`.
`--identity-proof` prints a sanitized fingerprint. No store, no second
identity system, no automatic writer. Proof:
[`docs/connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md`](docs/connectivity/LUNCH_MONEY_IDENTITY_PROOF_B78.md).
Real-data replay of the leftover 2026-08-16 owner-run observation:
identical second fingerprint; MATCH 12 / CHANGE 0; spendable $2,252.76;
`data.json` unchanged. Display-name rename kept the same keys. A Chequing
B −$10 correction stayed on `cash:chequing-b` and did not write. Two
accounts stayed unmapped. `cardCapacityIsCash` 0. No real pending→posted
case (fixture collapse remains supporting coverage). Endpoint origin was
not fabricated. Triangle same-day winner still not chosen. Fresh Chequing
B from B21 remains unused. A new live GET was not available in the
builder shell (token unset) and is not required to reopen this outcome
unless a later pull shows a new identity defect. T4 / `B81` stay closed.

**B79 · The store question, answered by evidence** · **DONE 2026-08-18** · *owner-reserved gate stays closed*
Build-strategy item `AF-STORE-01`. Written answer:
[`docs/STORE_QUESTION_B79.md`](docs/STORE_QUESTION_B79.md). The file
foundation has **not** demonstrably failed on real household data. B78 /
T3 identity and idempotency held. Remaining surfaces (Triangle same-day
freshness, unused Chequing B $10, no real pending→posted, endpoint
origin) are not store semantics. Stay with `data.json`,
`public/periods.json`, observation/reconciliation files, `snapshots/`,
and git. No store implemented. Gate remains closed. Owner action is not
required to keep files. T4 / `B81` stays closed.

**B80 · Evaluate connectivity providers, point nothing live** · **DONE 2026-08-16** · *owner brought this forward*
Build-strategy item `AF-LIVE-01`. Owner instruction 2026-08-16: manual
current-state capture is the binding product limit, so observation
connectivity is evaluated now rather than after B20/B21/B78.
Written evaluation: [`docs/connectivity/PROVIDER_COVERAGE.md`](docs/connectivity/PROVIDER_COVERAGE.md).
First provider for a personal read-only test: **Lunch Money**. The owner
completed a live GET on 2026-08-16; that pull stays out of git. The
pending-transaction slice now converts mapped revolving-credit pending
rows into B91 pending observations and does not write `data.json`.
No credential is in this repository. **Do not schedule this item or the
live Lunch Money observation test as a future milestone.** Remaining
provider-completeness (which product fields actually appear) is not a
critical-path gate. The 2026-08-17 owner decision names Lunch Money as the
normal operational feed; that does not reopen B80 and does not close `B81`.

**B81 · Trusted canonical refresh from the live feed** · **DONE 2026-08-20** · *earned capability; production activation reserved*
Build-strategy item `AF-LIVE-02`. Owner T4 pass:
[`docs/connectivity/T4_OWNER_PASS_2026-08-17.md`](docs/connectivity/T4_OWNER_PASS_2026-08-17.md).
The earned mechanism is `scripts/canonical-refresh.js`: incumbent observe
→ reconcile → sanitized preview → exact owner approval → bounded
canonical write. Four distinct approval contracts exist: posted
`previewId`, pending `cutoverApprovalId`, opening `openingApprovalId`
(`atlas-opening-cutover-approval/v1`), and same-date artifact
`recoveryApprovalId` (`atlas-opening-artifact-recovery-approval/v1`).
A clean `--cutover-as-of` preflight can propose one atomic canonical
opening; only `--apply --approve-opening <openingApprovalId>`
establishes it. Posted `previewId` and pending `cutoverApprovalId`
cannot authorize an opening. Default remains non-writing.

If an already-approved canonical opening survived in `data.json` but
same-date Household `positions.csv` rows and `snapshots/<date>.json`
did not, `--recover-opening-artifacts` can reconstruct **only** those
two missing surfaces from a complete trustworthy same-date MATCH
packet. Recovery never writes `data.json`, never infers artifacts from
`data.json` alone, preserves Triangle/MBNA cadence freshness, and
refuses mismatch, conflict, missing evidence, unknown pending,
incomplete pending census, unmapped required accounts, secret leakage,
or an existing conflicting snapshot. Preview first; exact
`--approve-recovery` before write. Atomic and fail-closed. No live
Lunch Money write. Forecast remains authority.

An approved opening is one coherent state transition. Before
`data.json` is permanently mutated, the writer must prove that
same-date Household rows in `docs/positions.csv` are constructible
from the approved observation/opening evidence (not invented from
`data.json`), that computed SUMMARY/CREDIT/LIQUIDITY rows can be
regenerated, and that `snapshots/<date>.json` can be written with
incumbent snapshot semantics. A failed construction leaves the prior
canonical files intact. `positions-summary.js` still owns computed
rows only. Household detail remains captured evidence.
`snapshot-balances.js` remains the snapshot authority; it is no longer
a required operator follow-up after a successful opening.

The first owner-approved live `--cutover-as-of 2026-08-19` opening
wrote `data.json` on the operator machine and then could not produce
same-date Household rows or `snapshots/2026-08-19.json`, because the
writer stopped at the canonical file. That integration defect is the
reason the coherent opening transition exists. The bounded recovery
path reconstructs those two missing surfaces when the surviving
opening still MATCHES a complete same-date observation packet. This
item did not itself apply that recovery to live `main`.

That integration gap is historical. PR #116 landed the owner-approved
2026-08-19 opening on `main` (`6d44590`). Current `data.json`
`meta.asOf` and `plan.opening.asOf` are **2026-08-19**; same-date
Household rows exist in `docs/positions.csv`; `snapshots/2026-08-19.json`
exists. The 2026-08-16 opening remains dated evidence in
`snapshots/2026-08-16.json`. Preservation refs from the recovery
episode (`refs/atlas/b81-original-detached-6d1f3bb`,
`refs/atlas/b81-remote-main-28d08a12`) are bookmarks, not current
`main`. A newer live substitute opening remains reserved.

A later owner instruction added a read-only in-memory overlay so a new
Lunch Money observation can change today's Forecast without rewriting
the 2026-08-19 opening or snapshots (`scripts/live-plan.js`). Server
`/data.json` may consume that overlay when `ATLAS_LIVE_OVERLAY` is
explicitly `fixture` or `live`; the UI discloses whether it applied.
That overlay is not a canonical write, not a second planner, and not a
Render token. Unknown/stale/conflicting evidence still fails closed.
Triangle/MBNA statement cadence still applies. Transfers are not
income. Credit availability is not cash.

This item is closed as the earned capability. Unattended production
writes, scheduled refresh, a Render Lunch Money token, and a newer
live substitute opening remain owner-reserved. They are not a missing
B81 implementation slice and do not keep this item `IN PROGRESS`. Do
not apply the unused Chequing B $10, choose a Triangle same-day
winner, invent a pending→posted case, or infer endpoint origin.

The first successful live `--cutover-as-of 2026-08-18` preflight fetched at
`2026-08-19T01:06:40.929Z` — still 18 August in America/Vancouver — and
falsely dated current evidence as 19 August by slicing the UTC timestamp.
Household financial dates from instants are `Forecast.financialDate` in the
ACCOUNT_FACTS timezone. MATCH is still not freshness. Genuinely older
provider evidence is still stale.

That same preflight then emitted `pending-freshness-unproven` for MBNA and
TD Personal solely because canonical pending was numeric `0` and the
bounded `include_pending` packet contained no pending components. Absence
in that window is not proof of zero. Proven zero requires
`GET /v2/transactions?is_pending=true` with no date bound, paginated until
`has_more=false`. UNKNOWN pending is still not `0`. This does not write
pending or resolve Travel Visa / Triangle.
---

## Ready — needs a session at an institution

**TD EasyWeb.** Route and traps are in `ACCOUNT_FACTS.md`. Retention is ~7 years,
so none of this is time-sensitive.

- **B26 · Personal Visa, August 2025 statement** — 11 of 12; **not aged out**
- **B22 · Savings interest rates** — neither savings account has a captured rate
- **B23 · Chequing B overdraft rate** — drawn every month, cost unquantified
- **B24 · Account plans and fee structures** — $17.67/month across two accounts
  plus $3.95 on DEBT&PAYMENTS. **Some TD plans waive the fee at a minimum
  balance.** One of the few places an immediate saving may exist
- **B25 · Mortgage prepayment penalty formula** — a mortgage advisor will ask
  first
- **Tier 3 · chequing and savings statements**, 12 months each, for fee and
  interest detail. All five accounts are reachable from the same statements
  dropdown

**PayPal.** No monthly statements exist; the equivalent is a PDF activity report.

- **B8 · April–August 2026 gap** on account #1
- **B39 · history before March 2026** on account #2
- **B9 / B42 · per-subscription amounts and billing dates** — 16 and 10 merchants
  known by name only. **Always exhaust "See more"**: two only appeared after
  expanding twice
- **B38 · reconcile authorisations against settlements** on #2, as was done on #1
- **B44 · generate PDF activity reports** for the archive

**B49 · Wise statements** · *small* — activity CSVs held; statements not captured.

---

## Queued behind the above

**B15 · Rebuild the income picture** *(on B63)* · *medium*
Coaching is gross. The current derived estimate is roughly **$650/month** of
household-income overstatement (`data.json` `incomeWarning`), not the
**$1,650/month** earlier upper-bound fear. The tracking sheets cover only a
subset of the window; the share is indicative. Until the coach split is
confirmed in the books, every conclusion resting on income stays provisional.

**B16 · Finish the spending picture** *(on B34, B40)* · *medium*
Cards and chequing are both categorised. Remaining: merge the windows (12 months
of cards against 18 of chequing) and handle the PayPal overlap without
double-counting.

**B40 · Fold Instacart and delivery in** *(on B38)* · *medium*

**B19 · Compose the Deep Dive page `helocHistory` current endpoint from live `debts.heloc`** · **DONE 2026-08-17** · *small*
This item closed the Deep Dive **page** endpoint, not the historical
`docs/MORTGAGE_HELOC_DEEP_DIVE.md` statement analysis (that file remains
the 2026-08-09 capture). The page's `helocHistory` August point was still
$201,586.16 (the 2026-08-09 / pre-payment reading) while live `debts.heloc`
was the 2026-08-16 $200,486.16 opening. Closed by composing the published
current endpoint from `debts.heloc` and keeping `helocHistory` as monthly
historical observations only. Mortgage current figures already came from
`debts.mortgage` and needed no repair. **At B19 close, Q19 was still OPEN**;
it is now **ANSWERED 2026-08-18**. Not B21 and not B78. The historical
mortgage/HELOC deep-dive document was not refreshed by this item.

**B20 · `snapshots/<date>.json` and trend charts** · **DONE 2026-08-17** · *history as a refresh by-product*
Build-strategy item `AF-HIST-01`. After `B91`. Two independently
reconciled openings: `snapshots/2026-08-09.json` from the last coherent
81210ac publication (balances match contemporaneous `data.json` and
`positions.csv` as_of 2026-08-09) and `snapshots/2026-08-16.json` from
the live B91 opening. Mixed-date rows are omitted — TENNIS INCOME and
SAVINGS-DONT TOUCH stay on the August 9 file only. A successful
`node scripts/snapshot-balances.js` writes the current as-of file;
re-running is a no-op; a conflicting same-date file fails closed.
The Plan page prints display deltas. Forecast, `data.json` current
state, and `public/periods.json` spending history are unchanged.
T2 holds for the stored HELOC pair: $201,586.16 on 9 Aug → $200,486.16
on 16 Aug, independently $1,100.00 down. Not B21 and not B78.

**B30 · Fees dashboard** · **DONE 2026-08-09** — site section 11, avoidable in
red against structural in blue. YTD **$1,160.45**, of which **$831.00 avoidable**.
B23 and B24 would add the missing plan/rate detail but were not blocking.

*Corrected 2026-08-09:* two fees were missing and were being counted as
**spending** instead. `O.D.P. FEE` is overdraft protection and never matched a
rule written as `/OVERDRAFT/`; `FX ATM W/D FEE` matched nothing at all. Together
**$93.00 over 18 months**. Both dashboards were wrong at once — the lesson is
that TD abbreviates, and a fee rule written from the full phrase fails silently.

**B32 · Interest dashboard** · **DONE 2026-08-09** — site section 10, interest
actually charged by facility. The mortgage is excluded and the caption says why.

**B65 · Period selector** · **DONE 2026-08-09** — this month / last month / YTD /
all, driving spending, interest and fees. Built by `scripts/periods.js`.
**Rebuild it after every capture** or the selector goes stale while the rest of
the page moves.

**B21 · Prove the normal Lunch Money refresh path** · **DONE 2026-08-17** · *small*
Build-strategy item `AF-INTAKE-01`. Owner-run later live observation
`2026-08-17T23:38:15.373Z` through incumbent
`scripts/provider-observe.js --provider lunchmoney --live --mode reconcile`
and `scripts/reconcile.js`. 10 mapped, 2 deliberately unmapped
(DEBT&PAYMENTS, SAVINGS-DONT TOUCH). MATCH 11 / CHANGE 8 / CONFLICT 0 /
MISSING 0 / STALE 0. Observed spendable cash $2,242.76. No canonical
write. Proof:
[`docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md`](docs/connectivity/LUNCH_MONEY_REFRESH_PROOF_2026-08-17.md).
Material surfaces: fresh $10 Chequing B CHANGE (unused); Triangle
same-day +$112.70 discrepancy (no winner chosen); six historical payroll
posting-candidate CHANGE rows treated as reconciliation noise. Manual
versus automatic endpoint origin was not preserved and was not invented.
No real pending→posted case. Next identity/idempotency outcome is `B78`.

**B29 · Payment calendar** · **DONE 2026-08-09**, **authority closed by B74 / PR #37 on 2026-08-14**
`scripts/calendar-ics.js` writes `derived/household-payments.ics` for Google
Calendar (shareable with Amanda; not served from the site). **Cash-payment
VEVENTs are derived from the Plan** via `Forecast.expandEvents` — the same
expander as the Plan calendar, `nextDue`, and `nextPaymentOut`. Standing
reminders (statement closes, tax, mortgage renewal, HELOC 21st look-point)
are a thin non-cash overlay and must not masquerade as chequing outflows.
Recurrence expansion walks until the requested end (ICS horizon through
mortgage maturity), not a fixed five-month cap.

Rerun after Plan rate or minimum changes. Statement-close / due look-points,
for reference — these are institutional facts, not a second cash schedule:

| Account | Statement | Due |
|---|---|---|
| Mortgage | — | bi-weekly |
| HELOC | monthly | 21st contractual look-point; cash model is month-end capitalisation (Q19 open) |
| TD Personal Visa | ~23rd | 17th |
| TD Cash Back Visa | 7th | 1st |
| Travel Visa | 5th | 26th |
| Triangle | 17th | 7th |
| Amazon/MBNA | 6th | 31st |

---

## Done

**The 9 August analysis run — five items, all published to the site.**

- **B61 · E-transfer counterparties** — **24 → 49 of 204 (24%)**, doubled. The
  new names were in the **Gmail bin** of both mailboxes, not missing. Every one
  matches a bank row on amount and date. Two large payments to named individuals
  emerged: **$2,160.00** (6 Jul) and **$1,064.92** (5 Aug). The matcher was also
  fixed — it had been letting one notification name every same-amount transfer
  within four days, and letting incoming notifications name outgoing transfers.
  Follow-up is **B66**.
- **B31 · Multi-hop chains** — real but **rare**: 33 chains of 635 pairs, only 5
  from the HELOC ($2,135.00). **The premise was disproved** — splitting
  single-leg transfers by destination shows **zero** unidentified account
  numbers; 173 of them are credit-card payments. B64 cannot be solved from
  transfer data. What the run did find is where borrowed money goes: **$14,271.63
  of ordinary bills paid straight from the HELOC**, including **$5,639.67 of
  property tax** and **$400.00 of CRA tax owed**.
- **B34 · Merchant library** — chequing uncategorised **12.0% → 4.5%**, matching
  the card side. 88 patterns added, mostly Square terminals and foreign-currency
  charges. Also fixed a bug that re-appended all 72 chequing patterns on every
  run: the library had reached 345 rows for 269 distinct patterns.
- **B7 · The $158.55 interest charge** — **explained.** The question was
  mis-specified: it applied 26.99% to the *closing* balance, but interest is
  charged on the *average daily* balance. June and July were charged below rate,
  leaving $45.46 uncollected; August collected it. Across five cycles the model
  implies $504.37 against $492.64 charged — 2.3%, which is posting-date bias.
  Every interest line on the card reads **RETAIL INTEREST**, so the cash-advance
  theory is dead.
- **B62 · Youth lacrosse** — floor **$5,143.56 → $5,729.47**, about $348/month,
  plus $400 inferred. The chequing figure was **not** $0.00 as recorded; it was
  $140.03 hidden by truncation. **40% of it was paid out of the HELOC.**

**Also, and not on the list:** the 30 June coaching remittance was re-traced and
**a coach was paid out of it** — $2,160.00 on 6 July, four days after it landed.
The earlier "it all went onto the HELOC, no coach payment appears" conclusion was
wrong, and wrong because the evidence had been deleted. See B63.

**Capture — complete.** Every consumer debt in the household is captured.

- **B45** `raw/` backed up to OneDrive, verified, with a SHA-256 manifest
- **B1** `data.json` and `positions.csv` brought current
- **B10 / B36 / B46** MBNA = the Amazon Mastercard, one card not two. 21.74%,
  all 8 statements as PDF and CSV
- **B2 / B3 / B4 / B4b / B6** Both TD cards at 12 of 12 statements; Travel Visa
  limit $1,100
- **B48 / B50** Wise ×2 captured; the road trip totalled at ≈C$6,645
- **B55 / B55b** Coaching workbooks parsed — coaches take **27.7%**. The books
  cover late Apr–Aug 2026, so the share is extrapolated from ~4 months
- **B54** Card spending categorised — **$44,344.58**, 65% discretionary
- **B34** Merchant library seeded — 273 patterns
- **B17** Payoff ranking settled; net worth **$357k–$657k**
- **B18** The **$46,657** payment-matching investigation completed — captured cards received more than the labelled TFR-TO C/C transfers in the 12-month window. Destination evidence only; Q2 remains OPEN
- **B52** The $10,000 Ivoclar charge — a funded pass-through, not household money
- **B53** `Head Canada` — a coaching business expense Amanda absorbs
- **B12** Home valued at $1.1m–$1.4m [ESTIMATE]
- **B37 / B11** Amex closed; Flexiti paid off and closed
- **B5 / B35 / B41 / B33** Earlier verifications

---

## The three biggest numbers still uncertain

1. **Coach payments** — income overstated by ~$650/month on current estimates,
   settled by B63. One payment is now traced ($2,160.00, 6 Jul); the rest of the
   route is not
2. **Two unidentified accounts** — $59,027, reachable via B64 and **only** via
   the e-transfer record: the internal-transfer data contains zero unidentified
   account numbers, so B31 cannot reach them
3. **$8,150 of cheques** — payee unknowable without TD's images

**And one that is no longer uncertain:** the $158.55 interest charge. It was
never a cash advance and never unexplained — the check was against the wrong
balance. See B7.
