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

**Strong lead:** a **Payworks** pay-statement notice, 29 Jun 2026. If the
coaching business runs payroll, coaches are paid through it rather than by
e-transfer — which would explain their absence from both mailboxes entirely.

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

**B58 · The five cheques — $8,150** · *small*
$3,010 (15 Jul 2025) · $2,835 (9 Sep 2025) · $1,295 (19 Nov 2025) · $980
(18 Feb 2025) · $30 (27 Oct 2025). The export gives an amount and a cheque number
and **never a payee**. Owner does not recall them. **TD holds the cheque images** —
that is the definitive route.

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

**B61 · E-transfer counterparties** · *medium*
**23 of ~207 attributed (11%).** TD's export never names the other side; Interac
emails do, but auto-deposits generate none and most notify Amanda. Everything
found is in `raw/interac/`. More names would improve B62 and B63 directly.

**B62 · Youth lacrosse — floor established** · *medium*

| Source | Identified |
|---|---|
| Cards | $2,546.26 across 18 charges |
| E-transfers via Interac emails | $2,597.30 across 6 |
| **Floor** | **$5,143.56** — about **$286/month** |

**Half of it moves by e-transfer**, which is why it was invisible. This is a
floor, not a total — it rises with every counterparty attributed.

**B31 · Transfer tracing, now with multi-hop chains** · *medium*
TD stamps each internal transfer with a five-character reference appearing on
both legs — **635 matched pairs, zero mismatches**. But the 24 Jul HELOC →
Chequing A → Wise chain shows single-pair matching is not enough: **one
intermediate hop breaks the trail**. Re-run looking for chains. **176 transfers
have only one leg captured** and may point at the unidentified accounts.

**B34 · Extend the merchant library** · *large*
`docs/merchant-library.csv` holds **273 patterns**. Chequing is still **12.0%**
uncategorised and cards **4.5%**. Patterns must match TD's ~15-character
truncation — a library written from full card names fails silently against
chequing.

**B7 · Reconcile the $158.55 Cash Back interest charge** · *small*
26.99% on the observed balance implies about $115. Likely a cash-advance
component or interest-on-interest under TD's 2 Jul 2026 change.

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

**B30 · Fees dashboard** *(on B23, B24)* · *medium*
Show avoidable separately from structural — that is the actionable split.

**B32 · Interest dashboard** *(on B7)* · *medium*
Every rate is now known. **$36,546/year, about $3,046/month.**

**B20 · `snapshots/<date>.json` and trend charts** · *medium*
Architecture tier 2. Worth doing now capture has settled.

**B21 · Second-month intake run** · *small*
The real test: next month should be a ten-minute job.

**B29 · Payment calendar as a subscribable `.ics`** · *medium*
Served from the site behind the same password. Cycles known:

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
   settled by B63
2. **Two unidentified accounts** — $59,027, likely reachable via B64
3. **$8,150 of cheques** — payee unknowable without TD's images
