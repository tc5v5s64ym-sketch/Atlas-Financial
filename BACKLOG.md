# Backlog

**Work that can be done.** Questions only the household can answer live in
`docs/01_OPEN_QUESTIONS.md` — keep the two apart. If an item needs a human to
*know* something, it is a question. If it needs someone to *do* something, it
belongs here.

Status: `READY` — nothing blocking · `BLOCKED` — waiting on the household ·
`QUEUED` — waiting on earlier work

Last reviewed **2026-08-09**. Phase: **analysis** — capture is essentially done.

**Operational knowledge lives in `docs/ACCOUNT_FACTS.md`**, not here: how each
institution's data is obtained, the download endpoints, and the traps that cost
time (TD's dead download button, MBNA's mirrored signs, the browser pane needing
to be visible, merchant strings needing normalising before matching).

---

## 🔴 The two that undercut everything else

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

**B67 · The $1,806.00 Fusion invoice** · *small*
Invoice 86995864, 31 Aug 2025, paid by Dale — **and it appears in none of the
six accounts or five cards**, though it falls inside both coverage windows. The
other seven Dale-paid invoices predate card coverage and are explainable; this
one is not. Most likely an invoice total settled in instalments too small to
spot. One look at the LeagueApps payment history closes it.

**B28 · Rewards balances as minor assets** · *small*
Travel Visa **57,968 TD Rewards points**; Cash Back **$47.21**. Absent from net
worth.

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
Coaching is gross. Until the coach split is confirmed, income is overstated by
roughly **$650/month** on current estimates.

**B16 · Finish the spending picture** *(on B34, B40)* · *medium*
Cards and chequing are both categorised. Remaining: merge the windows (12 months
of cards against 18 of chequing) and handle the PayPal overlap without
double-counting.

**B40 · Fold Instacart and delivery in** *(on B38)* · *medium*

**B19 · Refresh the mortgage and HELOC deep dive** · *small*
Written before the spouse's accounts were known.

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

**B20 · `snapshots/<date>.json` and trend charts** · *medium*
Architecture tier 2. Worth doing now capture has settled.

**B21 · Second-month intake run** · *small*
The real test: next month should be a ten-minute job.

**B29 · Payment calendar** · **DONE 2026-08-09** — `scripts/calendar-ics.js`
builds `derived/household-payments.ics`: **24 events** covering the seven debt
payments, five statement close dates, five fixed household bills, property tax
and CRA, and a five-stage mortgage-renewal countdown. Reminders are baked in at
9am three days before and 9am on the day. Imported into a Google calendar
rather than served from the site — the owner wanted it shareable with Amanda.

**Household bill dates were derived from the data, not from the bills**: BCAA
$82.96 and the $100 RESP contribution and $25 union dues all on the 15th, 18 of
18 months; FortisBC ~$124 at month end, 17 of 18. **BC Hydro deliberately is
not given a fixed date** — it bills bi-monthly and the payment dates wander
from the 2nd to the 17th, so the event says "date varies" instead of inventing
a precision the record does not support.

Rerun it after any rate or minimum changes. Cycles, for reference:

| Account | Statement | Due |
|---|---|---|
| Mortgage | — | bi-weekly |
| HELOC | monthly | 21st |
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
- **B18** The **$46,657** resolved — it paid the cards. Nothing was hiding
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
