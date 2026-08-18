# Standing account facts

**The durable reference. Read this before asking the owner anything.**

These are the facts that do not change month to month — rates, limits, due dates,
renewal dates, payment structures, and how each institution's data is obtained.
Balances live in `positions.csv` and `../data.json`; they change constantly and
are deliberately not repeated here.

Every entry carries a **verified** date. Variable rates move with prime — treat
anything older than a few months as needing re-checking, not as fact.

---

## Payment calendar

| Day of month | What | Amount | Account |
|---|---|---|---|
| **7th** | Triangle Mastercard minimum | ~$253 | Canadian Tire Bank |
| **14th & every 14 days** | Mortgage | $1,600.00 | TD |
| **17th** | TD credit card minimum | ~$94 | TD |
| **21st** | HELOC contractual minimum (interest only) | ~$814 | TD — **see note** |
| **31st / month end** | **Amazon.ca Rewards Mastercard minimum** | **$158.27** | MBNA |
| **1st** | TD Cash Back Visa minimum | $762.36 | TD |
| **26th** | Travel Visa minimum | $17.00 | TD |

Statement close dates: **TD card ~23rd** · **Triangle 17th** ·
**MBNA/Amazon 6th** · **TD Cash Back 7th** · **Travel Visa 5th**.

**HELOC 21st vs month-end.** TD EasyWeb and the Dec 2025–Jul 2026 statements
state a minimum payment due on the **21st** equal to that period's interest
(overdue $0 on every supplied statement), with a Pre-Authorized Debit Date
around the **1st**. Observed posting of the interest charge is a month-end
debit on the HELOC itself. Manual payments at least equal to the minimum,
made before the due date, satisfy that minimum rather than causing a second
full cash collection. The live cash plan still does **not** invent a
duplicate full $814.18 chequing outflow for the interest posting (`nonCash`
/ `capitalise` on day 31). The household calendar keeps the 21st as a
reminder-only look-point. Q19 is **ANSWERED 2026-08-18**: the 14 August
$1,100 payment already inside the 2026-08-16 opening satisfies the $814.18
August minimum, so remaining August HELOC cash requirement is **$0
additional**. That is not a claim that interest is free, and it does not
state that an Aug. 1 PAD occurred.

### The 12 August Burrard registrations are paid

*(owner-stated 2026-08-09 as an atomic same-day pair; owner-confirmed PAID
2026-08-16)* Logan's and Linden's Burrards registrations are both paid. No
registration amounts remain owed. Upcoming team fees are a separate planning
estimate of approximately **$700 total** sometime in September 2026; exact
amount and due date unknown. Not a confirmed invoice. The historical Aug. 9
opening-gap arithmetic below is left as the as-of snapshot; it is not a
current unpaid obligation.

Against **$79.84** in the household spending accounts, only two sources can
reach it on the day:

| Source | Available | Cost |
|---|---|---|
| **Amanda's tennis account** | $2,691.85 | none — already the household's money |
| **HELOC draw** | $1,067.84 | 4.90%, interest-only, and it capitalises — a draw here never clears |
| Chequing B overdraft | $82.28 | nowhere near enough |
| All cards combined | $265.83 | nowhere near enough |

Cards and overdraft together reach **$348.11** against $623.00. This is what
"every shock absorber is spent" means in practice: a $623 youth-sport bill is
now a financing decision.

### Recurring bills *(days extracted from the transaction history, 2026-08-09)*

Only bills still active in the last three months. Amounts are the recent
steady value, not the 18-month median.

| Day of month | What | Amount | Evidence |
|---|---|---|---|
| **2nd–4th** | FortisBC gas | $124.00 | 17 charges over 14 months; $124.00 in each of the last four |
| **14th–15th** | Shaw internet | $78.40 | May–July, chequing and Cash Back |
| **15th** | BCAA insurance | $82.96 | 18 consecutive months |
| **15th** | ICBC insurance | $99.91 | 5 consecutive months — newer policy |
| **15th** | RESP contribution | $100.00 | Owner-stated hard bill, children's RESP, monthly |
| **every 14 days** (payday cadence) | Fit4Less | $11.54 | 18 months; plus a ~$22 annual fee each July |
| **18th, every 3 months** | Noble Disposal Services — garbage | **$95.85** | Invoice cadence; Forecast quarterly row, firstDue 2026-09-18 |

**TELUS IS CLOSED** (owner-confirmed 2026-08-16). Do not forecast Telus as an
active household bill unless newer transaction evidence proves a new active
Telus service. Historical Telus charges remain in the captured telecom
series; that is history, not a live recurrence. The current Plan remainder
after dated Shaw contains non-Shaw current spend and is **not** proven to be closed Telus.
Committed `periods.json` rolls merchants into Telecom, so Telus dollars
cannot be split from Shaw, Bell, or other Telecom. July 2026 — after Telus
last appears in captured history (March 2026) — still shows Telecom
**$328.40**, which independently equals Shaw **$78.40** plus **$250.00** of
non-Shaw telecom. That identity disproves an entirely-Telus remainder; it
does **not** prove historical Telus contributes $0 to the YTD-derived
remainder. The amount of closed-Telus contamination in that remainder is
**UNKNOWN** from committed category rollups. Do not zero the remainder, and
do not invent a Bell amount to replace it. Q18 remains the Bell / watch path.

**Noble Disposal Services** is the household garbage bill (owner-confirmed
2026-08-16; primary invoice): $95.85 every 3 months on the 18th, Package A
2 cans, repeats indefinitely. A March 18 2026 payment of $95.85 is the
observed cadence phase. Canonical `plan.bills` row `noble-garbage` is the
Forecast quarterly recurrence (`day` 18, `anchor` 2026-03-18, `firstDue`
2026-09-18). Do not infer the paying card from a Visa 0870 mask.

Netflix does not exist anywhere in the data; the streaming spend is Amazon
Channels, several small charges on scattered days.

### Bell Mobility — main account and second watch account *(absorbed 2026-08-16)*

August 1 2026 main-account bill (primary statement): previous amount due
$373.31; payment received Jul. 17 −$250.00; unpaid balance $123.31; current
charges $233.31; **total due $356.62** by **2026-08-17**. August current
charges included $70.00 monthly, $25.80 device payment, $110.00 usage / long
distance, $21.34 tax. That $356.62 is **not** the normal monthly run rate.

June statement (normal recurring baseline, no unusual travel usage): $70.00
monthly services + $25.80 device payment + $8.40 taxes ≈ **$104.20**. The
main phone plan itself is $55; the same Bell account also contains a $15
watch line.

A Lunch Money pending Bell Mobility **$250.00** on Travel Visa dated
2026-08-14 is owner-confirmed **valid**. It remains pending until it posts.
Against the Aug. 17 total, $106.62 is an **inferred residual only** while
the $250 remains pending. Do not mark the Bell obligation fully settled.
Do not date $356.62 as joint-cash. Do not add a second Bell $250 expense.
The $15 watch line is on the same Bell account as the main phone service.
The August watch line is already inside the existing main Bell bill total.
Do not invent a second household bill for that $15 line.
A **second Bell/watch account is still active**. Owner confirmation
2026-08-16: do not merge it with the $15 watch line on the main account.
Exact current amount/cadence is not proven by this package. Absence of that
account from the supplied main-account statements is not a retraction.
Q18 stays open for whether the pending $250 posts and whether any residual
main-account Bell cash still needs a dated joint-cash row after that
posting, and for the owner-stated second Bell/watch account amount.

**CMAW Local 1995 union dues ($25/month on the 15th) remain a standing Plan
bill until cancellation is actually confirmed.** They still appear in the
chequing history. The owner intends to cancel them, and that intent is an open
action, but the $25 stays reserved as household cash until evidence closes the
action. Do not guess an effective end date. They are not inside the CRA
instalment reserve.

**BC Hydro is not one of them.** It moved to Amanda's TENNIS INCOME account
(id `amanda-debt-payments`, previously nicknamed DEBT&PAYMENTS) — it moved
here in May 2026 — and she has paid it there since — $235, $250, $250. It remains a
household obligation. The paying account is attribution, not a reason to drop
it from household-obligation reporting. It is correctly absent from the
joint-cash Forecast (Chequing A, Chequing B and Savings) because TENNIS
INCOME is held-elsewhere and is not spendable joint cash. Owner-confirmed
2026-08-16: the old questioned outstanding Hydro amount is **settled**. The
1 September $237.45 due remains. It must not be carried inside the household
variable budget either, and a utility account balance must not be scheduled
as a cash event — only dated amounts due are cash requirements. See "What
she pays directly" below, which is the single authority for that list.

Income: payroll **bi-weekly** (~$4,264 current recurring net after 2026 CPP/CPP2/EI completion), child benefit **monthly** (~$153.59).
Bonus or vacation pay has historically landed in **February and July**.
**Amanda's Tennis BC pay is semi-monthly — the 15th and month-end — not
bi-weekly**, and it does not land with the payroll. The detail and the evidence
are under "Her Tennis BC pay" below, which is the single authority for her
cadence.

---

## Mortgage — TD *(verified 2026-08-09)*

| | |
|---|---|
| Rate | **3.64% variable** — TD Mortgage Prime **− 0.96%** |
| **Renewal / maturity** | **1 May 2027** |
| Term | 60 months from 1 May 2022 |
| Payment | **$1,600.00 bi-weekly** (required is ~$1,365) |
| Payment split | $762.27 interest / $837.73 principal |
| Amortisation | 17 yr 9 mth remaining, of an original 30 |
| Original amount | $648,000.00 |
| Annual prepayment room | **$97,200** — none used in 2026 |
| Structure | Amortising. 52.4% of each payment buys equity |

The renewal is the single most consequential date in this file.

### The renewal countdown *(researched 2026-08-09)*

TD lets you renew a closed mortgage **120 days before maturity with no
prepayment charge and no fee**. Its standard rate hold is **120 days,
extendable to about 150 for existing clients**. TD normally makes contact four
to five months out and posts the offer letter about a month before maturity.

| Date | Days out | What it is |
|---|---|---|
| **2 Nov 2026** | ~180 | Start collecting competing quotes. Nothing can be locked yet, but this is when to be comparing rather than accepting |
| **2 Dec 2026** | 150 | Ask TD to hold a rate — the existing-client extension. A hold is a floor, not a commitment |
| **1 Jan 2027** | **120** | **The early-renewal window opens.** Renew with no prepayment charge; also the point at which switching lenders becomes practical, since a switch needs approval, appraisal and discharge |
| ~1 Apr 2027 | 30 | TD's offer letter should arrive. The posted renewal rate is an opening offer, not a fixed price |
| **1 May 2027** | 0 | **Maturity.** Unsigned by now and it typically rolls to a short open or posted-rate term, which costs materially more |

**The live decision at renewal is whether to fold the HELOC in.** It is
$201,586 at 4.90%, interest-only and 99.5% drawn; folding it into the mortgage
forces principal repayment and lowers the rate, at the cost of a higher monthly
payment. The site's renewal modeller runs that trade-off. Combined LTV is
roughly 53–68% depending on the home valuation — under 80% at both ends, so it
should renew conventionally on that measure, but a lender orders its own
appraisal and will not take an owner's estimate.

Sources: [TD renewal process](https://www.td.com/ca/en/personal-banking/products/mortgages/renew-refinance/how-to-renew) ·
[early renewal windows](https://mortgagerenewalhub.ca/early-mortgage-renewal/)

## HELOC — TD *(verified 2026-08-09)*

| | |
|---|---|
| Rate | **4.90% variable** — TD Prime **+ 0.45%** (Prime was 4.45%) |
| Credit limit | **$202,654.00** |
| Minimum payment | **Equals the monthly interest charge** — roughly $814 |
| Due | 21st, monthly |
| Structure | **Interest-only revolving. Paying the minimum reduces principal by nothing** |

### What the HELOC was actually spent on *(2026-08-09)*

`scripts/transfer-chains.js`. **$86,513.51 left the HELOC over 18 months and
$78,176.55 came back.** This is a facility being used as a chequing account, not
a loan being repaid.

| Left the HELOC as | n | Amount |
|---|---|---|
| Credit card payments | 32 | **$22,230.00** |
| Into chequing / savings | 54 | $17,466.00 |
| Interest charged | 18 | $15,029.18 |
| **Household bills, paid direct** | 5 | **$14,271.63** |
| E-transfers out, payee unnamed | 26 | $13,061.90 |
| Cash withdrawal | 1 | $4,429.80 |
| E-transfer fees | 26 | $25.00 |

**The fourth line is the one to pause on.** Five ordinary bills were paid by
borrowing against the house:

| Date | What | Amount |
|---|---|---|
| 2 Jul 2026 | **Maple Ridge property tax** | **$5,639.67** |
| 5 Aug 2025 | Triangle Mastercard | $3,778.00 |
| 20 May 2025 | Triangle Mastercard | $3,663.96 |
| 13 Jan 2026 | BC Hydro | $790.00 |
| 20 Jul 2026 | **CRA — tax owed** | $400.00 |

Property tax and income tax are recurring, predictable costs. Paying them from
an interest-only facility at 99.5% utilisation converts them into permanent
debt — nothing about a minimum payment removes them.

### Multi-hop chains are real but rare

The 24 July Wise funding showed that one intermediate hop breaks the trail:
$1,000 left the HELOC, landed in Chequing A, and was e-transferred onward the
same day. Re-running the tracing to look for **chains** rather than pairs:

- **635** internal transfers pair on TD's five-character reference
- **33** continue into an onward movement within three days
- **only 5** of those start at the HELOC, worth **$2,135.00**

**So the laundering-through-chequing pattern is not systematic.** The money that
cannot be traced did not take a circuitous route — it left the HELOC directly,
as 26 anonymous e-transfers worth $13,061.90.

### The single-leg transfers do NOT point at unknown accounts

B31 carried the hypothesis that "176 transfers have only one leg captured and
may point at the unidentified accounts." **Disproved.** Splitting every
single-leg transfer by its destination token:

| Destination | n | Out |
|---|---|---|
| A credit card (lives in the card ledger, not these exports) | 173 | $62,241.93 |
| A household account whose other leg is simply missing | 22 | $2,450.00 |
| **An account number not in the captured set** | **0** | **$0.00** |

**Zero unidentified account numbers appear.** TD's internal-transfer mechanism
only works between accounts on one profile, so money to an outside account
*must* go by e-transfer. The two unidentified accounts can therefore only ever
be found in the e-transfer record — which is exactly why recovering the deleted
Interac notifications matters, and why B64 will not be solved from transfer data.

## TD credit card *(verified 2026-08-09)*

| | |
|---|---|
| Current rate | **24.99% purchases / 27.99% cash — a penalty rate** |
| Normal rate | TD Prime + 12.75% = **17.20%** |
| Why | Two consecutive missed minimums, Dec 2025 and Jan 2026 |
| Restoration | **12 consecutive on-time minimum payments** |
| Count status | **Reset by the July 2026 miss** — restarts from the Aug 2026 statement |
| Credit limit | $2,000.00 |
| Due | 17th, monthly |
| Note | Since 2 July 2026 TD charges **interest on unpaid interest** |

## Triangle Mastercard — Canadian Tire Bank *(standing terms 2026-08-09; canonical opening B91 2026-08-16)*

| | |
|---|---|
| Rate | **21.99% purchases / 22.99% cash** |
| Credit limit | **$13,500.00** |
| Due | 7th, monthly · statement dated 17th |
| Structure | Revolving. Issuer states 99+ years to repay at minimum payments |

**Canonical Forecast opening is the B91 2026-08-16 `data.json` record**,
not the 9 August snapshot. The 2026-08-16 owner screenshot is the source
of that opening: posted **$13,197.00**, pending **$15.62**, available
credit **$287.38** (not household cash), last statement balance $13,309.70,
displayed minimum $0.00, displayed due date Aug. 7 2026. A **$300 payment
posted Aug. 10** is already inside the opening (independent identity:
13,497.00 − 300.00 = 13,197.00). Posted and pending stay separate.
Exposure = $13,197.00 + $15.62 = $13,212.62. On-time status for the
Aug. 7 obligation is not proven; the payment posted after the displayed
due date. The retired 9 August opening was posted **$13,497.00** / pending
unknown; it is dated evidence, not current canonical state.

## Insurance *(verified 2026-08-09)*

### Auto — TWO policies running in parallel

| | Amount | Day | Since |
|---|---|---|---|
| **ICBC** `ICBC INS` | **$99.91/month** | 15th | **21 Apr 2026** |
| **BCAA** `BCAA-AdvAutoIns INS` | **$82.96/month** | 15th | all 18 months (was $88.10 to Nov 2025) |
| **Total** | **$182.87/month** | | |

**These run alongside each other, not as a switch.** Both have been charged every
month since April 2026. Auto insurance therefore went from $82.96 to $182.87 a
month — **an extra $99.91/month, about $1,199 a year** — and nothing in the
record marks it as a decision.

If BCAA is optional coverage on top of ICBC basic Autoplan, that is a normal
arrangement. If it is a policy that should have ended when the ICBC one began,
it is a phone call worth making [ASK].

> **Correction, 2026-08-09.** ICBC was missing from this file entirely. It was
> filtered out of the recurring-bill scan because it only starts in April 2026
> and so appeared in fewer than six distinct months. A recurrence filter tuned
> for an 18-month window silently hides anything that started recently — which
> is exactly the kind of change worth catching.

> **Correction.** `BCAA-AdvAutoIns` was categorised as **Household**, not
> Insurance, because a duplicate `BCAA,Household` row sat earlier in the
> merchant library and first match wins. **$1,539.51 of auto insurance was in
> the wrong category.** Insurance over 18 months is **$2,014.19** ($111.90/month),
> not $474.68; Household falls to $6,993.18.

### Home — Square One, and it is not in any captured account

| | |
|---|---|
| Insurer | **Square One**, policy **#5157890** |
| Renews | **10 February, automatically** |
| Premium | **$3,131.76**, paid 10 Feb 2026 — **the whole year in one payment** |
| History | $2,730.36 (Jan 2024) → $2,675.88 (Jan 2025) → $3,131.76 (Feb 2026), **about +17% in a year** |

**Three things matter here.**

**1. It appears in none of the six accounts or five cards.** February 2026 is
inside every coverage window and the $3,131.76 is simply absent. Something
outside the reviewed set pays it — the same shape as the $1,806.00 Fusion
invoice [B67]. Two unexplained payments of this size are no longer a
coincidence; see B64.

**2. It has nearly lapsed before.** The January 2025 payment of $2,675.88 failed,
the resubmission failed, and on 19 Jan 2025 Square One wrote *"your policy is
about to be cancelled"*. A new policy was taken out on 10 Feb 2025 — which is
why the renewal date moved from 14 January to 10 February. **A lapse in home
insurance on a mortgaged property is a serious problem**, and a $3,131.76
single payment is exactly the kind that fails when an account is short.

**3. The garage.** Her parents' dental lab operated out of it and paid rent
until May 2026. Business use of a home can affect a residential policy's
validity. Worth raising at renewal rather than at claim time [ASK, B57].

## Day-to-day accounts *(verified 2026-08-09)*

| Account | Facts |
|---|---|
| Chequing A | Receives payroll, pays fixed costs. **No overdraft facility** |
| Chequing B | Daily spending. **$600 overdraft limit** |
| Savings | Automatic **$15/month** deposit |
| RESP | Held in WebBroker. **Education-restricted — not emergency cash** |

## Accounts on the spouse's TD profile *(verified 2026-08-09)*

The two profiles show the same household set under different nicknames. These
five appear on both and are the same accounts:

| Her nickname | Referred to elsewhere as |
|---|---|
| EMERGENCY SAVING | Savings |
| BILLS ACCOUNT | Chequing A |
| WEEKLY SPENDING | Chequing B |
| PERSONAL CREDIT CARD (…5770) | TD credit card (…6294) — same balance, second card on the account |
| MORTGAGE, LINE OF CREDIT | Mortgage, HELOC |

**Four accounts appear only on her profile:**

### TENNIS INCOME chequing *(…6458934)* — previously nicknamed DEBT&PAYMENTS
Balance $2,691.85, **no overdraft facility**. Charges a **$3.95 monthly account
fee**, plus withdrawal and cheque-return fees — the other chequing accounts do
not. This is where her employment income lands and where many household debt
payments originate.

**This balance is not household spendable cash** *(owner-stated 2026-08-09;
operating semantics restated 2026-08-16)*. The owner renamed the account
**TENNIS INCOME**; the canonical id remains `amanda-debt-payments`. Amanda's
Tennis BC salary lands here and is transferred promptly into BILLS ACCOUNT.
Coaching income also lands here. Coaches/business/pass-through amounts are
paid from this account first. Whatever remains after coaching obligations
is transferred into BILLS ACCOUNT. Money becomes household-available when
it is actually transferred into the household cash pool. The raw balance is
NOT automatically spendable household cash. Do not estimate how much of the
current balance is household-available (Q25).

**Her Tennis BC pay is semi-monthly, not bi-weekly** — the **15th and the last
day of the month**, verified across all 18 months. Recent: $2,168.85 on 15 Jul,
$2,387.99 on 31 Jul. Gross has grown from $1,250/month (Feb 2025) to about
**$4,575/month**, and July 2026 reached $6,195.94 including `TENNIS BC EXP`
reimbursements.

**What actually crosses to the household:** 127 transfers over 18 months
totalling **$25,445**, every one of them into **Chequing B** — matched 127/127
on date and amount, so the destination is certain. Mostly $100–$350 at a time,
ad hoc rather than scheduled.

| Period | Transferred to household |
|---|---|
| 12-month mean (Aug 2025 – Jul 2026) | **$2,182/month** |
| Lowest full month in that year | **$930** (November 2025) |
| Recent 5-month mean | **$2,400** |

**She also pays household costs directly from this account** — roughly
$940/month: BC Hydro (it moved here in May 2026), part of the MBNA minimum,
some card payments, CRA instalments and part of the property tax. So her total
contribution is larger than the transfers alone.

### HELOC interest is capitalised, not paid *(verified 2026-08-09; statement series absorbed 2026-08-16; August cash closeout 2026-08-18)*

The monthly interest — $810.09, $787.58, $814.18 for May, June, July — is
charged **as a debit on the HELOC itself** at month end. **No matching payment
leaves any chequing account as the interest posting.** Payments into the HELOC
are a separate fact.

Dec 2025–Jul 2026 primary statements: credit limit / current plan limit
**$202,654**. In every supplied month the displayed regular minimum equals
that period's interest charge. Overdue = $0. Payment due date is the **21st**.
A Pre-Authorized Debit Date around the **1st** is shown. Observed mechanics:
a manual payment can reduce the remaining required minimum, and the automatic
payment can collect only the residual (February minimum $751.46 collected in
full 2 March; May minimum $810.09 collected as $800.00 on 2 June plus $10.09
on 3 June). Manual payments also appear from household TD chequing
accounts, including Bills Account and TENNIS INCOME.

The Jul statement shows $814.18 due 21 August and a PAD date of 1 August.
Owner evidence 2026-08-18: current displayed HELOC balance $200,486.16;
current variable rate 4.900%; July 31 interest posting $814.18; the screen
still displays the statement minimum $814.18 due Aug. 21; no Aug. 1 HELOC
PAD/payment appears in the displayed activity after that interest posting;
the owner made a $1,100 payment on Aug. 14, already inside the 2026-08-16
opening. Q19 is **ANSWERED**: that $1,100 satisfies the August minimum under
the demonstrated mechanics. Forecast still does not treat the interest charge
as joint-cash. Remaining August HELOC cash requirement is $0 additional.
This file does not state that the Aug. 1 PAD occurred.

This matters two ways. For **cash flow**, the ~$814/month interest posting is
not an automatic chequing outflow and must not be modelled as a duplicate
full minimum after confirmed payments have already satisfied it. For
**debt**, capitalised interest is why the balance can rise with nothing
repaying it.

### SAVINGS-DONT TOUCH *(…6478420)* — **a staging account, not savings**
Balance $74.20. Despite the name, nothing is saved here. Money arrives from
Chequing A and leaves within hours or days, mostly to the HELOC and credit cards.

54 transactions over the window: **$17,745.11 in, $17,758.98 out, net −$13.87.**
Opening balance $88.07, closing $74.20 — it ends where it started.

The pattern is clearest on **2 July 2026**: $9,645.00 arrived from Chequing A and
**$10,000.00 left for the HELOC the same day**, taking the balance from $2,713.69
up to $12,713.69 and back down. That one-day peak is the highest it ever held.

Destinations over the window: transfers to other own accounts $12,120 · credit
cards $2,818.50 · outgoing e-transfers $2,800 · fees $10.

Interest earned across 18 months: **$0.11.**

### TD Cash Back Visa *(…0726)* — **the household's second-largest card**

| | |
|---|---|
| **Rate** | **26.99% purchases / 27.99% cash advances** — from the statement rate table |
| Credit limit | **$5,000.00** |
| Balance | $5,682.43 — **$682.43 OVER the limit** |
| Available credit | **$0.00** |
| Minimum payment | **$762.36**, due **1 Sep 2026** |
| Statement cycle | 8th to 7th |
| Recent charges | Interest **$158.55/month**, plus a **$29.00 over-limit fee** |
| Cash Back Dollars | $47.21 |

An amount of **$69.93 was flagged as due immediately** on 9 Aug 2026, separate
from the September minimum. **$70.00 was paid on 9 Aug 2026** (owner-confirmed).

**Position after that payment:**

| | |
|---|---|
| Balance | **~$5,612.43** [calculated, $5,682.43 − $70.00] |
| Credit limit | $5,000.00 |
| **Still over the limit by** | **~$612.43** |
| Over-limit fee | **$29.00/month, still accruing** until the balance is under $5,000 |
| Next minimum | **$762.36, due 1 Sep 2026** — unaffected by this payment |
| Interest | **$158.55/month at 26.99%**, unaffected |

### The freeze question — **resolved from the account, 9 Aug 2026**

**The $69.93 was the minimum payment for the 9 Jun – 7 Jul statement, due
4 August 2026.** It was missed. That is exactly the "MINIMUM PAYMENT REQUIRED
FOR LAST MONTH HAS NOT YET BEEN RECEIVED" the August statement referred to.

**The $70.00 paid on 9 August clears it**, and the account now shows
**Available Credit $70.00** where it previously showed $0.00 — consistent with
the freeze having lifted.

Verified on the account: balance **$5,612.43**, last payment **$70.00 on
9 Aug 2026**, minimum **$762.36 due 1 Sep 2026**, credit limit **$5,000.00**,
Cash Back Dollars **$47.21**, pending **$0.00**.

**An anomaly worth knowing.** Available credit reads $70.00 while the balance is
$612.43 *over* a $5,000 limit — the two cannot both be ordinary. It appears TD
credits the payment as usable headroom without regard to the over-limit
position. Do not read $70.00 as real room: the account is over its limit, and
the **$29.00 over-limit fee keeps accruing** until the balance is under $5,000.

**The `Needs your attention — Due today $69.93` banner was still showing** after
the payment posted. Treat that banner as lagging, not as a second amount owed.

*Superseded: an earlier note here said the payment did not clear the overdue
minimum and the card stayed frozen. That was wrong — the statement-period
history on the account shows the $69.93 was the July statement's minimum.*

### Statement-period history *(from the account, 9 Aug 2026)*

| Statement period | Statement balance | Minimum | Due |
|---|---|---|---|
| 8 Jul – 7 Aug 2026 | $5,682.43 | $762.36 | 1 Sep 2026 |
| 9 Jun – 7 Jul 2026 | $4,706.31 | **$69.93** | 4 Aug 2026 — **missed** |
| 8 May – 8 Jun 2026 | $2,685.32 | $100.27 | 3 Jul 2026 |
| 9 Apr – 7 May 2026 | $5,080.75 | $113.98 | 1 Jun 2026 |
| 10 Mar – 8 Apr 2026 | $4,890.67 | $118.91 | 4 May 2026 |
| 10 Feb – 9 Mar 2026 | $4,920.88 | $107.89 | 6 Apr 2026 |

The balance swings hard — $5,080 down to $2,685 and back to $5,682 in three
months. This is an actively used card, not a static balance.

**The minimum leapt from $69.93 to $762.36** — roughly eleven-fold — because
going over the limit makes the whole excess immediately due on top of the
ordinary minimum. That is the mechanism that turned a manageable payment into
the largest card obligation in the household.

### The $158.55 interest charge — RESOLVED *(2026-08-09)*

This sat open as the one figure that would not reconcile. It reconciles;
the check was wrong, not the charge. `scripts/cashback-interest.js` rebuilds
the daily balance from the transaction ledger and tests every cycle:

| Statement | Avg daily balance | 26.99% implies | Charged | Effective rate |
|---|---|---|---|---|
| 8 Apr 2026 | $4,985.10 | $110.59 | $108.91 | 26.58% |
| 7 May 2026 | $5,118.52 | $109.76 | $103.98 | 25.57% |
| 8 Jun 2026 | $3,179.37 | $75.23 | $61.27 | **21.98%** |
| 7 Jul 2026 | $4,263.60 | $91.43 | $59.93 | **17.69%** |
| 7 Aug 2026 | $5,119.61 | $117.36 | **$158.55** | **36.46%** |
| **Five cycles** | | **$504.37** | **$492.64** | **26.99%** |

**Two things were wrong with the expected "about $115".**

1. **It applied the rate to the closing balance.** Interest is charged on the
   **average daily balance**. On a card paid down and run back up those are
   different numbers — in May the closing balance was $2,685 while the average
   was $5,119.
2. **It looked at August alone.** June and July were charged *below* rate,
   leaving **$45.46 uncollected**; August then ran at 36.46% and collected it.

Across five cycles the model implies $504.37 against $492.64 actually charged —
a **2.3%** gap, which is the transaction-date-versus-posting-date bias in the
ledger and nothing more. Nothing is missing; the timing shifted.

**The cash-advance theory is dead on the statements' own evidence.** Every
interest line on this card, in all twelve statements, is headed
**RETAIL INTEREST**. There is no cash-advance bucket and never has been, so the
27.99% rate was never part of it.

### Travel Visa *(…0870)* — **a Business Visa**

| | |
|---|---|
| **Rate** | **19.99% purchases / 22.99% cash** — the lowest card rate in the household |
| Balance | $1,078.31 · pending $165.13 |
| Available credit | **$0.00** |
| **Credit limit** | **$1,100.00** *(verified 2026-08-09 from the Manage tab)* |
| Minimum payment | $17.00, due **26 Aug 2026** |
| Statement cycle | 6th/7th to 5th/6th |
| TD Rewards points | 57,968 |
| Pattern | Small balances, paid down and reused. Went into credit in Jun 2026 |

TD's own footnote confirms this is excluded from the consolidated card balance
because it is a **business** card.

**The limit is $1,100.00 — by far the smallest in the household**, and the card
is at **98.0%** of it with $0.00 available. **The $165.13 of pending charges will
take it over.** $1,078.31 + $165.13 = **$1,243.44 against a $1,100 limit**, or
**$143.44 over** [calculated]. On the evidence of the Cash Back Visa, going over
triggers an over-limit fee and makes the excess immediately due, turning a $17.00
minimum into something far larger.

The pending charges are **four `AMZN Mktp CA` purchases** dated 6–8 Aug 2026 —
Amazon spending on the card TD designates as a *business* card. Worth resolving
under the business question: either it is genuine inventory, or personal
purchases are landing on the business card.

Other figures verified from the account on 2026-08-09: last statement balance
**$801.10** (7 Jul – 5 Aug), last payment **$100.00 on 7 Aug 2026**.

**What it is actually used for.** The August statement is almost entirely US
travel and a business tool:

| Merchant | Amount |
|---|---|
| Springhill Suites, Milpitas CA | US$904.65 |
| Fairfield Inn & Suites, Bend OR | US$540.82 |
| Sleep Inn, Bend OR | US$273.10 |
| Calendly (scheduling software) | US$13.44 |
| Compass Hotel, Medford OR | US$12.00 |
| **Total foreign currency** | **US$1,744.01** |

Plus a Lululemon charge in Calgary. All foreign-currency charges attract an FX
conversion cost on top of the amounts shown.

> **Correction, 2026-08-09.** The US hotels above were read as work travel for
> Tennis BC, reimbursed through the `TENNIS BC EXP` deposits. **They were not** —
> all four fall inside the family road trip of 24 July to 4 August, owner-
> confirmed. They are holiday spending on a business-designated card.

**Her income may still include reimbursement, but this was not the evidence for
it.** DEBT&PAYMENTS does receive deposits marked `TENNIS BC EXP` — expenses
rather than salary — totalling $1,639.10 across the window, with `AP` a further
$2,846.58. So **part of the $63,129 may still be reimbursement rather than
earnings**, but the matching costs have not been found and are not these hotels
[ASK — confirm which descriptors are pay versus reimbursement, and test against
a period with no family travel in it].

## The $1,000–1,100 monthly transfer was RENT, not a spousal transfer

*(Owner-confirmed 2026-08-09 as standing-fact evidence, and owner-confirmed
again 2026-08-16 that the income source ended. Q5 is ANSWERED in
`docs/01_OPEN_QUESTIONS.md`. Do not forecast that old stream.)*

It was **rent paid by Amanda's parents**, because they moved **their lab into the
garage**. It ran from March 2025, stepped from $1,000 to $1,100 in November, and
**stopped after May 2026 because the business is not going well**.

**Three things follow, and none of them were visible before.**

**1. It was never household income from her.** The project recorded it as
"Wife's monthly transfer" and treated it as her contribution to the shared
accounts. It was a third party paying rent. That is a different thing for tax,
for budgeting, and for what happens if it never resumes.

**2. It is rental income on the home, and it stopped.** About **$1,050/month —
$12,600 a year — has gone**, and the household has not replaced it. Because it
was misfiled as an internal transfer, its loss never registered as an income
event.

**3. The dental thread now joins up.** "The lab", the **$10,000 Ivoclar
Vivadent** charge — a *dental-materials* manufacturer — and her father funding
that machine are all one story: **a dental lab operating out of the garage.**
The $10,000 was not a household purchase passing oddly through a card; it was
capital equipment for a business run from this property.

**Two questions this raises, both worth real money [ASK]:**

- **Business use of the home.** A lab in the garage may affect home insurance,
  and may create both a deduction and a capital-gains exposure on that portion
  of the property. Worth an accountant's view before the May 2027 renewal.
- **Is the rent coming back?** "Not going well" is the reason it stopped. If the
  arrangement is ending, the garage is a room to re-let or reclaim; if it is
  paused, $12,600/year is a recoverable income line.

## Amanda's coaching business — the large e-transfers

*(Owner-confirmed 2026-08-09.)* She runs a **coaching business** paid by
e-transfer, **usually over $4,000** a time.

Incoming e-transfers over the window, **$79,047.00 across 94 transfers**:

| Size | Count | Total |
|---|---|---|
| **≥ $3,000** | 8 | **$42,395.00** |
| $1,000–3,000 | 24 | $26,880.50 |
| $300–1,000 | 11 | $5,421.24 |
| under $300 | 51 | $4,350.26 |

Nearly all of it lands in **Chequing A** ($77,143). The eight large ones —
$3,312 to $7,245 — match the description of coaching income.

**This relabels an income line that has been wrong throughout.** The picture
carried **"Resale / business e-transfers — $54,213"**, described as "very
irregular" and assumed to be buying and reselling goods. **There is no evidence
of resale.** It is coaching revenue.

### ⚠ It is REVENUE, not income — and household income is overstated

*(Owner-confirmed 2026-08-09.)* **Amanda pays her coaches out of these
receipts.** The household keeps only the margin, not the gross.

**This is the single largest error still in the picture.** Every income figure
the project has published treats the full amount as household money.

The outgoing side, for scale — **113 e-transfers out, $29,762.42** over the
window:

| Size | Count | Total |
|---|---|---|
| ≥ $1,000 | 8 | $9,708.67 |
| $500–1,000 | 10 | $6,978.40 |
| $200–500 | 27 | $8,414.80 |
| under $200 | 68 | $4,660.55 |

**Coach wages cannot be separated from personal transfers here.** There is no
clean repeating pattern — the most common amounts are $100 (×8) and $60 (×7),
which is family-sized, not payroll-sized. The bank data alone cannot do it.

**Bounds, pending her books:** coach payments are somewhere between **$0 and
$29,762** over 18 months, so household income is overstated by up to
**~$1,650/month**. That is wide enough to matter to every conclusion that rests
on income, and it should be treated as the largest open uncertainty in the
picture — larger now than any remaining unexplained flow.

**Amanda's bookkeeping is the fix**, and the owner has offered to get it. What
is needed: coaching revenue, coach payments, and any other business costs, so
gross can be separated from net.

**So there are two businesses, not one**, and the project has been conflating
them:

| | Whose | What |
|---|---|---|
| **The dental lab** | her parents' | in the garage, paid rent until May 2026, "not going well" |
| **The coaching business** | Amanda's | paid by e-transfer, ~$42,395 of large receipts |

The Tier 1 question "does the business make money?" has been asking about both at
once. **They need separating before it can be answered.**

`Head Canada Inc.` **$1,043.37 is a business expense Amanda absorbs personally**
*(owner-confirmed)* — so the coaching business has costs carried on household
cards, which is exactly the mixing that makes its profitability unreadable.

## Her employment income — Tennis British Columbia *(verified 2026-08-09)*

**43 deposits totalling $63,129.47 over 18 months**, paid into DEBT&PAYMENTS.
Descriptors: `TENNIS - BRITIS PAY`, `TENNIS BRITISH AP`, `TENNIS BC EXP`,
`TENNIS BRITIS MSP`.

**It has grown steadily**, roughly doubling over the window:

| | |
|---|---|
| Feb–Mar 2025 | $1,250/month |
| Aug–Sep 2025 | ~$2,368/month |
| Nov 2025 – Apr 2026 | ~$4,470/month |
| Jul 2026 | **$6,195.94** |
| Average across the window | **$3,507/month** |

This income was **entirely absent** from the earlier picture, which only saw the
portion she transferred across to the shared accounts.

## Second PayPal account *(captured 2026-08-09)*

Distinct from the first. Balance **$0.00**. Report for 1 Feb – 31 Jul 2026
requested; PayPal was still generating it at time of capture [BACKLOG B35].

**Six linked cards — two of which appear nowhere else in the picture:**

| Linked card | Known? |
|---|---|
| **Amazon.ca Rewards Mastercard** ••••54 | ✅ **captured 2026-08-09 — it is the MBNA card, …6454. $7,855.12** |
| **American Express** ••••07 | ✅ **CLOSED — owner-confirmed 2026-08-09. No balance, no debt** |
| TD Cash Back Visa ••••26 | ✅ |
| TD Emerald Visa ••••70 | ✅ the personal card |
| TD Business Travel Visa ••••70 | ✅ |
| Visa Debit ••••75 | ✅ presumed a household chequing card |

**The Amazon Mastercard is now identified** — it is the MBNA account, and it
*does* receive payments from DEBT&PAYMENTS, recorded as "MBNA" $300 at a time.
The link was missed because the payments name the issuer and the card names the
retailer.

**The Amex is CLOSED** *(owner-confirmed 2026-08-09)*. No balance, no rate, no
statements to obtain. Excluded from the debt list and from net worth.

That also explains what looked suspicious: it received payments from no chequing
account analysed **because there was nothing to pay**. The card stayed on
PayPal's linked-card list after closure, which is normal — a linked card is a
stored credential, not evidence of a live account.

**With this, every consumer debt in the household is now captured.** The debt
picture is complete: mortgage, HELOC, five credit cards, and two closed accounts
(Amex, Flexiti).

**Eight automatic payments**, and the mix is telling:

| Merchant | Reads as |
|---|---|
| **MailChimp** | email marketing — business |
| **Canva** | design software — business |
| **RacquetGuys** | tennis equipment retailer |
| Parking Corporation of Vancouver | travel/work |
| DoorDash, Instacart, Starbucks, Sephora | household |

### What the transactions actually show — **152 transactions, Mar–Jul 2026**

> **Correction.** On first seeing the merchant list I suggested this was the
> business-side account, with RacquetGuys as a possible inventory supplier. **The
> transaction data does not support that.** RacquetGuys is an authorised
> automatic payment but **has not billed once** in the five months captured, and
> business-shaped spending totals **$176.96** — MailChimp and Canva only. The
> hypothesis came from merchant names; the data says otherwise.

**There is no sales revenue in this account.** All 49 incoming entries are
`General Card Deposit` with no counterparty name — PayPal pulling from a linked
card to fund payments, exactly as the first account pulls from a bank. **Nothing
is received from customers.**

**What it is actually for — settled spend, reconciled 2026-08-09:**

| Merchant | Settled | Charges | Currency |
|---|---|---|---|
| **Instacart** | **$1,864.17** | 18 | CAD |
| Uber | $328.15 | 8 | CAD |
| Sport Chek | $104.73 | 1 | CAD |
| Uber Eats | US$101.40 | 2 | USD |
| Pastini Old Mill (Oregon) | US$91.75 | 2 | USD |
| MailChimp | US$89.60 | 4 | USD |
| Canva | $87.36 | 3 | CAD |
| Starbucks | $50.00 | 2 | CAD |
| **Total settled** | **$2,717.16** | **40** | |

**About $543/month**, not the $1,685 a naive total suggests.

> **Correction.** An earlier reading put Instacart at "$5,699.85, roughly
> $1,140/month" and delivery overall at "$1,400/month". **Both were wrong** —
> they summed every negative row. PayPal records one purchase as up to four:
> a pending authorisation, the actual charge, the card-funding leg, and the
> authorisation clearing. Only the charge is real spend. Settled Instacart is
> **$1,864.17 over five months, about $373/month**.

The reconciliation is now automated — `scripts/paypal-settled.js` counts only
`PreApproved Payment`, `Express Checkout`, `Website Payment` and `Other` rows
with status Completed. **Run it on any PayPal export before quoting a figure.**

The Pastini charge is an Oregon restaurant, matching the Travel Visa's US hotels
in Bend and Medford — the same trip, split across two cards.

## Wise — two accounts, the US holiday spending *(captured 2026-08-09)*

Opened **19 July 2026** for a US road trip, 24 July – 3 August. Two profiles,
each with its own card:

| | Account 1 | Account 2 |
|---|---|---|
| Opened | 19 Jul 2026 | 22 Jul 2026 |
| Rows captured | 95 | 12 |
| Card spend | **US$2,577.63** over 78 transactions | **US$162.52** over 7, plus C$4.00 |
| Closing balance | ~US$1.92, C$0.00 | ~C$83.84, ~US$84.90 |

Balances are **[calculated]** by running the ledger forward, not read off Wise —
confirm against the app before treating them as verified. Combined they are
worth roughly **C$206**, small enough not to move net worth.

**No credit facility.** Both are prepaid: money in, then spent. No rate, no
limit, no debt. Wise is an asset here, not a liability.

### The funding is the finding: $3,500 of $4,181 came from the HELOC

Every incoming dollar was traced to its source account and date:

| Source | Amount | Route |
|---|---|---|
| **HELOC direct e-transfers** | $1,000 (27 Jul) · $1,000 (30 Jul) · $500 (2 Aug) | HELOC → Wise |
| **HELOC via Chequing A** | **$1,000** (24 Jul) | HELOC → Chequing A → Wise **the same day** |
| ATM cash deposit | $430 (24 Jul) | cash → Chequing B → Wise |
| Chequing A | $107.25 | the $55 account fee, $22.16 card, $30 seeding account 2 |
| Chequing B | $10 (24 Jul) | |
| **Third party** | **$134 (31 Jul)** | from an individual, not a household account |
| **Total in** | **$4,181.16** | |

**$3,500 of it is borrowed against the house at 4.90%** — **84%** of all funding,
or **97%** of the money that came from a household bank account.

**The 24 July $1,000 is the one to notice.** It left the HELOC, landed in
Chequing A, and was e-transferred onward the same day. On the chequing statement
it looks like an ordinary e-transfer; only the HELOC draw beside it shows what it
was. **This is the pattern that made $46,657 of "credit card" transfers
untraceable** — an intermediate hop is enough to break the trail.

**The HELOC is interest-only at 99.5% utilisation.** Nothing about a minimum
payment reduces this $3,500. Unless it is deliberately repaid it is permanent
debt, and at 4.90% it costs about **$172 a year, indefinitely**.

### The trip cost about C$6,645 *(owner-defined window: 24 Jul – 4 Aug 2026)*

The owner confirms **all USD spending in that window was the road trip**, which
makes the total computable. `scripts/trip-cost.js` pulls every foreign-currency
charge from the decrypted statements by *transaction* date.

| Method | Cost | Note |
|---|---|---|
| **Wise ×2** | **C$3,853.42** | US$2,740.15 at the 0.7112 effective rate paid |
| Wise fees | C$117.61 | C$99.32 of it one-off setup |
| **Travel Visa** | **C$2,505.43** | 4 hotels, US$1,730.57 |
| MBNA / Amazon | C$134.92 | two Pastini charges, Oregon, via PayPal |
| TD Cash Back Visa | C$33.28 | Bend Brewing, Kona Ice |
| **Total** | **≈ C$6,644.66** | |

Card charges converted at a blended **1.4477**. Wise converted at an effective
**1.4061** (0.7112 inverted) — so the cards cost about **3% more per dollar**
than Wise did.

**Excluded deliberately:** a Calendly subscription (US$13.44) that billed inside
the window but would have billed anyway; a C$4.00 charge on 6 August, after the
window; and any Canadian-dollar trip spending such as fuel before the border,
which cannot be separated from ordinary domestic spending.

**Counted once, not twice:** the MBNA `PAYPAL*PASTINI` charges (C$134.92) and
PayPal #2's Pastini entry (US$91.75) are the same two purchases — PayPal is the
rail, MBNA the funding card. The ratio, 1.4705, is simply the FX.

### The Travel Visa's hotels were the family holiday, not work travel

**This corrects an earlier inference.** The Travel Visa's US hotels were read as
evidence that she travels for Tennis BC, pays on this card, and is reimbursed —
and that part of her $63,129 income was therefore expense reimbursement matching
these costs.

**The dates say otherwise.** Fairfield Inn Bend (25 Jul), Sleep Inn Bend
(28 Jul), Springhill Suites Milpitas (1 Aug) and Compass Hotel Medford (3 Aug)
all fall inside the family road trip. **They are holiday, not business travel.**

Two consequences:

- **C$2,505.43 of family holiday sits on a TD-designated *business* card.** That
  matters if anyone ever treats that card's balance as a business expense —
  these four charges are not deductible, and a card mixing the two is exactly
  what an accountant will want separated [ASK].
- **The reimbursement theory needs re-testing on a different period.** The
  `TENNIS BC EXP` deposits are still real, but the costs they were matched
  against were the wrong ones. See B15.

### Where the trip is hiding

Wise is only one of **five** payment methods used on this trip:

| Method | Trip spend | Where recorded |
|---|---|---|
| Wise ×2 | **US$2,740.15** + C$4.00 | here |
| Travel Visa | **US$1,744.01** of hotels — Milpitas CA, Bend OR ×2, Medford OR | its August statement |
| TD Cash Back Visa | Bend Brewing, Kona Ice of Bend, Santa Cruz | its August statement |
| MBNA / Amazon | two `PAYPAL*PASTINI OLD M` charges, Oregon | its August statement |
| PayPal #2 | the Pastini rail, US$91.75 | PayPal export |

**Do not add the MBNA and PayPal Pastini figures together** — PayPal is the rail
and MBNA the funding card, so they are the same purchase seen twice.

Wise's own categories, **as corrected**: **General $1,059.69 · Travel $925.78 ·
Entertainment $592.16**. It also splits by cardholder — Dale US$1,404.29,
Amanda US$1,173.34.

**There is no business spending on these accounts.** Wise tagged one `Home
Depot` charge of US$5.96 as *Office expenses*; it was a bucket, bought to use as
a cooler *(owner-confirmed 2026-08-09)*. Recategorised to Travel, and the
Office expenses line is now zero.

**Treat issuer-assigned categories as a hint, not a fact.** This one would have
put a fake $5.96 of "business" spending into the business question — trivial in
size, but the same mechanism at a larger amount is exactly what makes the
business's true cost base hard to see. Wise also tags plainly-holiday charges
inconsistently between *General* and *Travel* depending on which card was used.

### Cost of the arrangement

| | |
|---|---|
| Converted | **C$3,918.47 → US$2,786.37** at an effective **0.7112** |
| Conversion fees | C$18.03 |
| Card FX fee | C$0.26 |
| Setup — two cards and one set of USD account details | **C$99.32** |
| **Total fees** | **C$117.61** |

The setup fees are 84% of the total cost and are one-off, so a second trip on the
same cards would cost about **C$18**. On C$3,918 converted, the ongoing cost is
roughly **0.46%** — materially cheaper than the foreign-currency conversion the
Travel Visa charges on its US$1,744.

**Both Wise exports are activity CSVs, not statements.** Wise issues statements
separately; they have not been captured [BACKLOG].

## Card transactions — parsed and reconciled *(2026-08-09)*

**635 transactions across three cards**, from the 24 TD statements and 8 MBNA
CSVs. `scripts/card-transactions.js` builds the ledger; output is
`derived/card-transactions.csv`.

**The parse is verified, not assumed.** Eight independent checks pass to the
cent: five TD statement periods reconciled against closing balances read
separately from TD's Activity page, and MBNA's purchases, payments and interest
against its own statement summary.

| Card | Txns | Purchases | Payments | Interest & fees |
|---|---|---|---|---|
| **Travel Visa** | 293 | **$33,643.75** * | −$33,696.18 * | $373.07 |
| TD Cash Back Visa | 205 | $10,385.77 | −$11,879.50 | $1,535.34 |
| Amazon / MBNA | 137 | $9,930.23 net | −$2,970.00 | $894.89 |
| **Total** | **635** | **$53,959.75** | | **$2,803.30** |

Coverage runs **24 Aug 2025 to 7 Aug 2026** — about twelve months.

\* **These are card totals, not household totals.** The Travel Visa figures
include a **$10,000 funded pass-through** on both sides — see below. Household
purchases on that card are **$23,643.75**, and **$43,959.75** overall.

### This roughly doubles visible household spending

Card purchases total **$54,344.58 gross** over the year. **Almost none of it was
in any category total**, because the chequing exports only ever showed the
*payments* to these cards, never what was bought.

**Two deductions before that figure means anything.** $10,000 is the funded
pass-through below, and **$3,371.12 is PayPal-rail** (`PAYPAL*` merchants) that
may already sit in the PayPal totals. Genuinely new household spending is
therefore about **$40,973.46**. Recorded spending was $135,921.28 over 18 months, roughly
$7,551/month; this adds on the order of **$3,400/month**. **Do not simply add
the two** — the windows differ (12 months against 18), and the pass-through and
PayPal overlap both have to come out first. That is B16.

### The Travel Visa is not a small card

Its balance never exceeds about $1,100, so it read as minor. **It moved
$33,643.75 of purchases in twelve months** — the largest card spend in the
household — by being paid off and reused, 293 times.

### The $10,000 charge was a funded pass-through — exclude it

**$10,000.00 to `IVOCLAR/VIVADENT, INC-C` Mississauga on 5 Dec 2025**, a
dental-materials manufacturer, and the largest card purchase in the dataset.

**It was not household money.** *(Owner-confirmed 2026-08-09.)* Amanda's father
put the funds on the card and a machine for the business was bought with them
immediately. The card was a conduit, not a source.

**The payments confirm it.** Three land just before the purchase:

| Date | Payment |
|---|---|
| 12 Nov 2025 | −$1,700.00 |
| 25 Nov 2025 | −$3,000.00 |
| 25 Nov 2025 | −$8,000.00 |
| | **−$12,700.00** |

The card was driven deep into credit and the purchase drew it back down.

**So both sides must come out of the household figures**, or spending *and* debt
service are each overstated by about $10,000:

- **Household card purchases fall from $53,959.75 to $43,959.75**
- **Travel Visa purchases fall from $33,643.75 to $23,643.75**

Exactly which of the three payments were the father's is not separable from the
statements [ASK] — $12,700 arrived and $10,000 went out, so roughly $2,700 may
have been ordinary household payment.

> **Correction.** This entry previously concluded that the credit limit "must
> have been cut hard" and that a reduction of that size is "usually an issuer
> risk decision". **That was wrong, and it was an inference, not a finding.**
> Prepaying the card creates spending room without any limit change, which is
> exactly what happened. Whether the limit ever differed from $1,100 is simply
> unknown — and there is no evidence of an issuer risk action.

**`Head Canada Inc.` Guelph, $1,043.37** — racquet-sports equipment, sitting
alongside RacquetGuys on PayPal and Amanda's Tennis BC employment. Still
unexplained, and still possible inventory [ASK, B53].

### Card spending by category — twelve months to August 2026

`scripts/categorise-cards.js` classifies the ledger. **$44,344.58 across 484
purchases, $3,695/month**, after excluding the $10,000 pass-through.

| Category | Total | /month | Type |
|---|---|---|---|
| **Travel** | **$10,363.01** | $863.58 | discretionary |
| **Shopping** | **$8,402.13** | $700.18 | discretionary |
| Groceries | $6,736.37 | $561.36 | essential |
| Restaurants | $4,469.86 | $372.49 | discretionary |
| Sport & fitness | $3,692.08 | $307.67 | discretionary |
| Uncategorised | $1,990.88 | $165.91 | unknown |
| Telecom | $1,893.86 | $157.82 | essential |
| Health | $1,880.08 | $156.67 | essential |
| Fuel & transport | $1,278.66 | $106.56 | essential |
| Business | $1,043.37 | $86.95 | business |
| Subscriptions | $1,003.96 | $83.66 | discretionary |
| Entertainment | $722.40 | $60.20 | discretionary |
| School & clubs | $582.48 | $48.54 | essential |
| Household | $285.44 | $23.79 | essential |

**Only 4.5% is uncategorised**, against 19% on the chequing side — because card
statements carry full merchant names where TD's chequing export truncates them
to about 15 characters. The residue is a long tail with nothing above $90.

**Discretionary spending dominates.** Travel, Shopping, Restaurants, Sport &
fitness, Subscriptions and Entertainment total **$28,653.44 — 65% of card
spending, about $2,388 a month.** Essentials come to $12,656.89.

That matters because of where the money came from: this is the spending that was
invisible while every revolving facility ran to its limit and the HELOC grew
$7,537. **It is also the most addressable part of the picture** — a household
cannot easily cut a mortgage or a telecom bill, but $2,388/month of
discretionary spending is a set of decisions rather than a fixed cost.

Two caveats on the categories:

- **Travel's $10,363 includes the road trip's hotels**, so it is not a recurring
  annual figure.
- **`Business` shows only $1,043.37** — the Head Canada purchase. If genuine
  business spending is mixed into Shopping or Groceries, as the business question
  suspects, this understates it. The category is a floor, not a measure.

**The rule table is published as `docs/merchant-library.csv`** — 201 patterns
across 13 categories, which is the B34 library seeded from real data rather than
guessed at.

### Analytical evidence — where the $46,657 of "TFR-TO C/C" went

This section records payment-matching analysis. It is not the household
question-status authority. Q2 remains OPEN in `docs/01_OPEN_QUESTIONS.md`
until that file records it as ANSWERED.

**The captured cards received more than those transfers sent.**

This was the project's largest unexplained flow and a Tier 1 question. The
puzzle: $46,657 left the accounts labelled as credit-card payments, while the TD
personal Visa's balance barely moved.

**The reason it looked unexplained is that only one of five cards was visible.**
With every card's statements now parsed, the payments each one *received* over
the twelve-month statement window are:

| Card | Payments received |
|---|---|
| **Travel Visa** | **$33,696.18** |
| TD Cash Back Visa | $11,879.50 |
| TD personal Visa | $6,632.34 |
| Amazon / MBNA | $2,970.00 |
| **Total** | **$55,178.02** |

Against **$39,875.43** of `TFR-TO C/C` leaving the accounts in the same window.
**The cards received $15,302.59 MORE than those transfers sent** — the balance
arriving by other routes, including payments made directly from the HELOC.

So the transfers are fully absorbed, and the destination is unambiguous: **mostly
the Travel Visa**, the high-throughput card that is paid off and reused. The
personal Visa took only $6,632 of it, which is exactly why the earlier analysis
could not make the numbers work.

On this matching, the captured cards absorb the labelled transfers rather than
falling short of them. That is evidence against a missing-card leak; it is not
an owner confirmation that Q2 is ANSWERED.

### Chequing spending rebuilt — and $25,490 of it was never spending

`scripts/categorise-chequing.js` applies the same library to the five chequing
and savings accounts. **The first finding is that a quarter of what was counted
as spending was not spending at all.**

| Bucket | Out, 18 months |
|---|---|
| Internal transfers | $259,169.52 |
| **Spending** | **$116,219.92** |
| Debt payments | $82,425.36 |
| **PayPal funding** | **$10,437.78** |
| **Cheques — payee unknown** | **$8,150.00** |
| Bank fees & interest | $1,225.21 |

Previously $141,709.80 was treated as spending. Removed from it:

- **PayPal funding pulls** — PayPal drawing from the bank is *funding*. What was
  bought sits in the PayPal exports, so counting both double-counts every
  purchase.
- **Flexiti and credit-card payments** — debt service, not spending.
- **`TD WATERHOUSE` transfers** — money moving into investments.

**Uncategorised falls to 12.0%, from the 19% the project has carried
throughout.** Real spending is **$116,219.92 over 18 months, about
$6,457/month**.

| Category | 18 months | /month |
|---|---|---|
| Groceries | $23,919.65 | $1,328.87 |
| Shopping | $17,670.07 | $981.67 |
| Restaurants | $14,570.56 | $809.48 |
| Fuel & transport | $14,080.65 | $782.26 |
| Uncategorised | $13,903.75 | $772.43 |
| Household | $8,441.74 | $468.99 |
| Sport & fitness | $5,345.21 | $296.96 |
| Entertainment | $4,732.58 | $262.92 |
| Property tax | $4,300.00 | $238.89 |
| Travel | $2,614.73 | $145.26 |
| Health | $2,235.80 | $124.21 |
| Telecom | $1,641.07 | $91.17 |
| Subscriptions | $1,112.45 | $61.80 |
| Tax | $800.00 | $44.44 |
| Insurance | $474.68 | $26.37 |
| Pets | $236.57 | $13.14 |
| School & clubs | $140.41 | $7.80 |

**Patterns must match TD's truncation.** A library written from full card
merchant names fails silently against chequing: `REAL CDN SUPERS` never contains
`REALCDNSUPERSTORE`. That single mismatch was hiding $4,946 of groceries. The
library now carries short prefixes for the chequing side and stands at **273
patterns**.

### Total household spending is about $10,700/month, not $7,551

| Source | Per month |
|---|---|
| Chequing and savings | $6,457 |
| Cards | $3,695 |
| PayPal, funded from the bank | $580 |
| **Total** | **≈ $10,732** |

**That is 42% higher than the published figure**, and it is the number that makes
the rest of the picture cohere: against $17,042/month of income and $9,075/month
of debt payments, spending at $7,551 left a surplus that the accounts plainly did
not have. At $10,732 the HELOC's growth stops being a mystery.

Treat it as a floor. The windows differ — 18 months of chequing against 12 of
cards — and 12% of chequing plus 4.5% of card spending is still unidentified.

### It is a personal card with a business label

**Owner-confirmed: "mostly a personal card", a mixed bag.** The transaction
record agrees — its regular merchants are Instacart, Costco, Superstore,
Save-On-Foods, Walmart, Bell Mobility, hotels and a lacrosse club.

So the TD *business* designation describes the product, not the use. Three
distinct kinds of spending share one card: ordinary household, the family
holiday ($2,505.43 of hotels), and genuine business (the machine, possibly Head
Canada). **Anything that treats this card's balance or throughput as a business
figure will be wrong**, and an accountant will need it separated line by line
rather than in total.

## E-transfer counterparties — the bank hides them, Interac's emails do not

**TD's export never names the other side.** Outgoing reads `SEND E-TFR ***GCa`,
incoming `E-TRANSFER ***hr6` — a three-character reference and nothing more.
That is why 94 incoming and 113 outgoing e-transfers could not be attributed.

**Interac's confirmation emails do name them**, in the subject line:

> "Your $488.25 transfer to PRO CALIBER LACROSSE ACADEMY LTD. has been
> successfully deposited."

**Coverage is poor, and the reason is not the one previously recorded.**

> **Correction, 2026-08-09.** This entry said "auto-deposit transfers generate
> no confirmation". **That is wrong.** Interac sends the recipient a
> "You've received $X from NAME and it has been automatically deposited"
> notification, and four of the transfers named here are exactly that. What
> auto-deposit removes is the *click-to-deposit* email, not the notification.

**The real reason is that the notifications are being deleted.** A sweep of
**both** mailboxes on 9 August 2026 found far more than had been captured, and
**almost every new one was in the bin**:

| Mailbox | Previously captured | Found | New |
|---|---|---|---|
| The owner's | 11 | 19 | **8** |
| The spouse's | 12 | 30 | **18** |
| | **23** | **49** | **26** |

Gmail purges deleted mail after 30 days, so every recoverable one falls after
roughly **10 July 2026**. Everything deleted before that is gone permanently.

**So the counterparty record is being destroyed on a rolling 30-day cycle.**
That is why coverage looked hopeless, and it means the previous conclusion was
wrong: the notifications were not missing, they were **deleted**. **A Gmail
filter on both accounts that labels and archives mail from
`payments.interac.ca` instead of deleting it costs nothing and makes every
future transfer attributable** — see B66. It cannot recover what has been
purged.

**Attribution now stands at 49 of 204 (24%) — double the 24 (12%) carried
before.** Every one of the 26 new attributions matches a bank row on amount and
date, so this is corroboration rather than guesswork.

**Two large payments to named individuals emerged**, both previously the biggest
unattributed outgoing transfers in the dataset:

| Date | Amount | Account | Note |
|---|---|---|---|
| **6 Jul 2026** | **$2,160.00** | SAVINGS-DONT TOUCH | four days after the coaching remittance — see below |
| 5 Aug 2026 | $1,064.92 | DEBT&PAYMENTS | a second named individual |

**Amanda's mailbox is where the coaching business is visible.** Her outgoing
transfers include **Fusion West Lacrosse** ($225.00, 31 Jul — new) and small
payments to several individuals; her incoming are client lesson fees of
$60–$140 from five named clients, plus **$114.53 back from the Burrards U13-A2
team manager** — the same person who sets the $400 team fee, so team money moves
both ways with her.

*(Names stay in `raw/interac/`, which is gitignored. Only aggregates and roles
belong in a committed file.)*

**The eight recovered notifications independently confirm the Wise funding
trace.** Six of them — $10.00 and $430.00 and $1,000.00 on 23–24 July, $1,000.00
on 27 July, $1,000.00 on 30 July, $500.00 on 2 August — match the reconstructed
Wise funding table date for date and cent for cent. That table was built by
matching amounts across statements; it is now corroborated from a second,
independent source.

**None of the large coaching receipts ($3,312–$7,245) are in this inbox**, which
is consistent with Amanda being the payee.

**The matcher was also wrong, and has been fixed.** It used `find()`, so a
single notification named *every* transfer of the same amount within four days —
six $1,000 Wise fundings would all have inherited one name — and an *incoming*
notification could name an *outgoing* transfer. It now matches one notification
to one transfer, nearest date first, with direction enforced. This lowers the
apparent attribution count and raises its truthfulness.

What the 11 do show is **boys' lacrosse** *(owner-confirmed 2026-08-09)*:
**PRO CALIBER LACROSSE ACADEMY $488.25**, **FUSION WEST LACROSSE $1,023.75**,
**VENOM CUSTOM STICKS $100** — the last a stick purchase, the first two clubs the
boys play for. Not coaching payroll. Incoming are small personal amounts from
named individuals.

**So the coach-payment question is not answerable from this mailbox.** It needs
either Amanda's inbox or her bookkeeping [B55]. But it does narrow the bound:
some of the $29,762 of outgoing e-transfers is kids' sport, not coach wages.

### Amanda's mailbox — 37 notifications, only 12 in the window

Captured to `raw/interac/` *(gitignored — it holds third-party names)*. Her
mailbox only carries Interac notifications from **April 2026 onward**; nothing
between Feb 2025 and Apr 2026. Combined with Dale's, **23 of ~207 transfers now
have a counterparty**.

**What it shows about the coaching business.** Client payments are visible and
they are **small**: Jenny Fei $60, DILPREET KANG $60 ×2, Darian $80, BINDU MOHAN
$70 — **$330 across five payments in two months**. That matches the Calendly
booking flow for "**Maple Ridge Private Lessons**" at roughly $60–80 a lesson.

**No coach payments appear anywhere.** Her outgoing transfers are **Fusion West
Lacrosse** only — $230.00, $227.50, $527.80 — which is the boys' club, not
payroll. Neither mailbox contains a single payment to an individual that looks
like a coach's wages. Either she pays them another way, or those notifications
are not retained. **The coach-payment split is still unresolved [B55].**

### How the coaching money actually flows *(owner-confirmed 2026-08-09)*

**Lavinio Cavalcante remits Amanda's coaching income; she then pays her coaches
out of it.** So the large e-transfers *are* coaching money — arriving aggregated
from one remitter rather than from individual clients. The $60–80 payments are
separate private-lesson clients booked through Calendly.

**That makes the large receipts pass-through money, not household income.** They
arrive gross, and a share of each is owed onward to the coaches.

**The money is not household-spendable when it lands** *(owner-stated
2026-08-09)*. It sits in Amanda's tennis account until she has paid her coaches;
only then does she move what is left over to the household spending accounts.
So the household sees the coaching income as a **transfer of the retained
margin, after coach payroll, at a time of her choosing** — not as the remittance
itself, and not on the remittance date. Any cash-flow plan should count only
that transferred remainder, and should not treat a remittance sighted in her
account as money the household can spend that week. (Which account "Amanda's
tennis account" is remains open — it is likely the un-captured account the 2026
coach payments leave from [B63], and possibly one of the two unidentified
accounts.)

### The $9,646.25 — mostly onto the HELOC, but a coach WAS paid

*(Corrected 2026-08-09, after recovering the deleted Interac notifications.)*

The 30 June remittance now traces end to end, and the fourth line is new:

| | | Staging balance |
|---|---|---|
| 2 Jul, Chequing A | receives **$3,683.75** and **$5,962.50** | $9,837.28 |
| 2 Jul, → SAVINGS-DONT TOUCH | **−$9,645.00** | $12,713.69 |
| 2 Jul, → **HELOC** | **−$10,000.00** | $2,713.69 |
| **6 Jul, → a named individual** | **−$2,160.00** | **$553.69** |

> **Correction.** This entry previously read "**The $9,646.25 did not go to the
> coaches — it went onto the HELOC**", and said no coach payment appeared in
> either mailbox afterwards. **That was wrong, and it was wrong because the
> evidence had been deleted.** The Interac notification naming the $2,160.00
> payee was in the bin. The claim rested on absence in a record that was being
> emptied on a 30-day cycle.

**$2,160.00 is 22.4% of the $9,646.25 received**, against the **27.7%** coach
share her own tracking sheets imply — the right order of magnitude for one coach
among several. A second payment of **$1,064.92** went to another named
individual on 5 August.

[INFERRED — the bank record names the payee but not the reason. "Coach" is the
best-supported reading given the size, the timing and the account it left from,
not a proven fact.]

**The unrecorded-liability worry is substantially reduced.** Pass-through money
was not simply absorbed by household debt; a distribution followed within four
days, out of the same staging account, draining it to $553.69.

**What remains open [B63].** This accounts for one payment out of one
remittance. The route for the rest of the 2026 coach pay is still unidentified,
the cheque route that paid one coach stopped in November 2025, and the evidence
for the account outside the captured set still stands — on 14 July her mailbox
records **$186.16 received under her own full legal name**, i.e. she transferred
money to herself from somewhere else [B64].

### The receipt itself

**Lavinio Cavalcante**, 30 June 2026, two transfers thirty minutes apart:
**$5,962.50** and **$3,683.75**.

The chain is complete and unambiguous:

| | |
|---|---|
| 2 Jul, Chequing A | receives **$3,683.75** and **$5,962.50** |
| 2 Jul, Chequing A → SAVINGS-DONT TOUCH | **−$9,645.00** |
| 2 Jul, SAVINGS-DONT TOUCH → HELOC | **−$10,000.00** |

**The largest single receipt in the window went straight onto the HELOC the same
day**, through the staging account. It is also the definitive example of what
SAVINGS-DONT TOUCH is for.

**Identified**: two transfers thirty minutes apart on 30 June 2026 —
**$5,962.50** and **$3,683.75** — a single coaching remittance from Lavinio
Cavalcante, and the largest single receipt in the window.

It is also the definitive example of what SAVINGS-DONT TOUCH is for: money lands,
is staged, and leaves within hours.

### Lacrosse is a real category, and the bank data cannot see most of it

*(Recomputed 2026-08-09 by `scripts/lacrosse.js`, which prints every matched
charge so the total is auditable rather than asserted.)*

| Source | Identified | n |
|---|---|---|
| Cards | **$2,767.14** | 17 |
| E-transfers, via Interac emails | **$2,822.30** | 7 |
| Chequing debit | **$140.03** | 3 |
| **Verified floor** | **$5,729.47** | **27** |

About **$348 a month**, and still a floor.

> **Correction.** This entry recorded the chequing figure as **$0.00** and
> called that "the finding". It is not zero — it was **$140.03**, hidden by
> TD's truncation. `US LACROSS 35.00_V`, `SQ *BC SIXES LA` and
> `SQ *LOADING LAC` are US Lacrosse, BC Sixes and Loading Lacrosse; none
> contains the string "LACROSSE" once TD has cut the description to fit. The
> underlying point survives — most of the category still moves by e-transfer and
> carries no payee — but the flat zero was a matching failure, not evidence.

**A further $400.00 is inferred and deliberately excluded from the total.** The
Burrards U13-A2 manager emailed "$400 per player, please send etransfer" at
10:06 on 15 April 2026, and a **$400.00 e-transfer left the HELOC the same
day**. Strong, but the bank record still names no payee, so it is reported
separately rather than folded in.

**Excluded as genuinely ambiguous:** 13 chequing charges totalling $68.25 read
`SQ *RIDGE MEADO`. The same town runs lacrosse *and* soccer through Square, and
the cards prove the soccer one exists — the truncated string cannot be assigned
either way.

### The finding is the funding, not the size

| Paid with | Amount |
|---|---|
| **HELOC** | **$2,269.80** |
| Travel Visa | $1,110.20 |
| Amazon / MBNA | $750.90 |
| TD personal Visa | $731.78 |
| Chequing A | $327.50 |
| DEBT&PAYMENTS | $225.00 |
| TD Cash Back Visa | $174.26 |
| Chequing B | $140.03 |

**40% of identified youth-sport spending, and 80% of the e-transfer half, was
paid out of the HELOC** — borrowed against the house at 4.90% on an
interest-only facility at 99.5% utilisation. Nothing about a minimum payment
reduces it.

**84 outgoing e-transfers worth $18,514.04 still carry no payee at all** (down
from 95 and $22,487.96), and an unknown share of that is more of this.

### Fusion West invoices — the mailbox record beats the bank record

*(2026-08-09.)* LeagueApps emails a receipt for every Fusion purchase. Both
mailboxes were searched; **all fourteen in-window receipts arrive at Dale's
address**, even when Amanda is the payer, because his is the account's
notification email. Amanda's mailbox holds only the two from 11 February 2026,
so **the duplication is minimal and Dale's mailbox is the complete record.**

| Date | Invoice | Amount | Paid by | Found in the captured accounts? |
|---|---|---|---|---|
| 19 Feb 2025 | 82541373 | $65.52 | Dale | no |
| 10 Apr 2025 | 83604237 | $89.25 | Dale | no |
| 12 May 2025 | 84172476 | $340.20 | Dale | no |
| 12 May 2025 | 84172495 | $340.20 | Dale | no |
| 26 Jun 2025 | 85240748 | $121.80 | Dale | no |
| 28 Jun 2025 | 85275335 | $91.88 | Dale | no |
| 30 Jun 2025 | 85309871 | $74.38 | Dale | no |
| **31 Aug 2025** | 86995864 | **$1,806.00** | Dale | **no — and this one should be** |
| 18 Nov 2025 | 88494543 | $312.00 | Amanda | TD personal Visa |
| 16 Dec 2025 | 88952017 | $81.90 | Amanda | Travel Visa |
| 20 Dec 2025 | 89008081 | $81.90 | Amanda | Travel Visa |
| 11 Feb 2026 | 90013908 | $220.73 | Amanda | Travel Visa |
| 11 Feb 2026 | 90014064 | $215.25 | Amanda | Travel Visa |
| 6 May 2026 | 91796457 | $61.44 | Amanda | Travel Visa |
| **Total** | | **$3,902.45** | | **$2,929.23 unaccounted** |

**The split is perfect and it is the finding.** Every invoice **Amanda** paid is
on a captured card. Every invoice **Dale** paid is in none of the six accounts
or five cards.

Seven of the eight predate card coverage, which begins 24 August 2025, so they
were plausibly paid on a card during the uncovered period. **The $1,806.00 of
31 August 2025 is not explainable that way** — it falls inside both the card
window and the chequing window and appears in neither [ASK]. Fusion accepts
e-transfer (its own emails offer an `ETRANSFER` discount code and quote
`payment@fusionwestlacrosse.com`), and no $1,806.00 e-transfer exists either.
LeagueApps also supports instalment plans, and a 2024 receipt in the same
mailbox shows "Payment Plan: 1 out of 3 installments paid" — so the likeliest
benign explanation is that $1,806.00 is an invoice total settled in instalments
that are individually too small to spot. **Worth one look at the LeagueApps
account's payment history to close it.**

Corroborating context in the mailbox: team-fee notices of **$400 per player**,
multiple teams (Burrards U13-A2, Fusion West Grade 2/3, RMSC Titans), and a
Pro Caliber roster travelling to **Texas in June** with its own fee schedule.

## A Coinbase account — no longer used *(owner-stated 2026-08-09)*

**The owner no longer uses it.** Treated as dormant rather than active, and not
counted as an asset.

**But dormant is not the same as empty, and the account still exists.** Coinbase
was still issuing **monthly statements as at June 2026**, which it does for open
accounts. Whatever remains — possibly nothing — is unrecorded. **One look at the
balance closes this permanently**; until then it is an unknown of unknown size,
and the only asset class outside TD and Wise.

Evidence of the account and its one visible movement:

- **Monthly statements are still being issued** — "Your May Coinbase statement is
  ready to download", 1 June 2026
- **2025 annual performance and annual charges reports** were generated
- A withdrawal of **CA$1,950.50 (plus a CA$19.70 banking fee)** on 8 June 2025,
  which lands in Chequing A the next day as `E-TRANSFER ***TeT $1,950.50` —
  **an exact match**, and the transaction that was sitting unexplained

**A withdrawal of $1,950 says nothing about what remains** — it may well be
empty, and the June 2025 withdrawal may have been the emptying of it. Recorded as
dormant, excluded from net worth, and closed as an analysis question.

**It stays open as a security question**, which is the more important one — see
below. An account nobody uses is the one where unauthorised activity goes
unnoticed longest.

## ⚠ Security — a phishing campaign against the Coinbase account

Two emails from **`info@afius.org`** are styled as Coinbase and carry
"Your Coinbase verification code":

| Date | Code |
|---|---|
| 24 May 2025 | 523469 |
| 11 June 2025 | 523469 |

**`afius.org` is not a Coinbase domain**, and **the same code appears on both**,
which a genuine one-time code never does. These are phishing.

Notably the **8 June 2025 withdrawal falls between the two**. There is no
evidence the withdrawal was unauthorised — the owner appears to have initiated
it, and Coinbase's own email confirms it.

**Being unused makes this more of a risk, not less.** The account is still open —
statements were issued as recently as June 2026 — and nobody is watching it. That
is exactly the profile phishing targets: an unmonitored account attached to a
live email address, where an unauthorised login would go unnoticed indefinitely.

**The clean fix is to close it.** Failing that: a unique password and app-based
two-factor authentication, and never enter a code from an email into a page
reached from that email.

## The coaching business — actual figures *(from her tracking sheets, 2026-08-09)*

Two workbooks, `MRTC_TRACKING.xlsx` (term) and `MRTC_TRACKING_summer.xlsx`,
supplied by Amanda. Source in `raw/mrtc/`, parsed to `derived/mrtc/` by
`scripts/xlsx.js`. **This is the bookkeeping B55 was blocked on.**

| | Term | Summer | Combined |
|---|---|---|---|
| Class revenue | $11,970.00 | $11,100.00 | **$23,070.00** |
| **Coach payroll** | **$5,067.50** | **$1,330.00** | **$6,397.50** |
| Coach hours | 156.5 | 41.0 | 197.5 |
| **Retained** | | | **$16,672.50** |

**Coaches take about 27.7% of revenue; roughly 72% is retained.** That is the
split the bank data could not produce, and it is far narrower than the
"$0–$29,762" bound carried until now.

The term sheet also prices each class properly — revenue $11,970 against costs
$5,720 for **$6,250 of profit**, a **52.2% class-level margin**. Coaches are paid
a **day rate** ($30–$95 depending on class) rather than a share, so margin rises
with class size: Orange Try at 10 players returned $980 on $420 of cost, while
Red Improve at 4 players **lost $95**.

**Amanda draws no coach pay** — 0 hours, $0 — so her return is the retained
margin, not a wage.

### The books count coaches and nothing else

*(Re-read in full 2026-08-09 at the owner's request. Same two files, verified
byte-identical to the copies already held.)*

**Every cost in these workbooks is coach pay.** Sheet 0's "Total Cost" is simply
the coach day-rate multiplied by the number of days — 60 × 7 = 420, 95 × 13 =
1,235, 65 × 7 = 455, and so on for every row. There is **no court time, no
equipment, no insurance, no admin, no software**.

The "Class Profit Tracker" tab does have a **Court Cost** column, but that tab
is a broken template rather than data: its only intact row is dated 2006 and
flagged *"Sample row"*, and every real week below it reads `#REF!`.

**And no court or facility cost appears in the bank data either.** Searching all
six accounts and five cards for tennis, court, facility and Maple Ridge venue
merchants returns only small household charges — `SQ *RG FACILITI` at $3.63 to
$23.00 and `SQ *CITY OF POR` at $5.25 to $24.38, which are parking-sized, not
$35–$65-a-session court hire.

So either the venue comes with the arrangement, or court time is netted off
before the remittance reaches her. **Worth establishing which before anyone
treats the retained margin as profit** [ASK].

### The term dates, decoded

The week-start columns are Excel serials. Converted:

| | Runs |
|---|---|
| **Term** | 26 Apr – 21 Jun 2026, 9 weeks |
| **Summer** | 5 Jul – 3 Aug 2026, 5 weeks |

**Coach payroll settles shortly after a term ends**, which the bank now
corroborates: the term finished 21 June and **$2,160.00** went to a named
individual on **6 July**; summer finished 3 August and **$1,064.92** went to
another on **5 August**. Neither equals the book total exactly — term payroll
was $5,067.50 and summer $1,330 — so this is a timing pattern, not a
reconciliation.

**Coach rates are inconsistent and it matters.** The term book has Richard at
$35/hr with two entries at $60, and Marcus at $30 with one week at $40; the
summer book has Marcus at both $30 and $35. Whichever is right, it changes what
is owed [ASK].

### Treat these as indicative, not audited

Three defects, all visible in the sheets:

- **Both Dashboards show `#REF!`** for Total Costs and Total Profit — the
  formulas are broken. Their "Total Revenue $5,580" also contradicts the class
  sheet's $11,970, and is identical in both files, so the Dashboard tab is
  stale in both.
- **The summer class sheet is incomplete** — six of ten classes carry $0 coach
  cost with a blank total, so its stated **$9,822.50 profit is overstated**. Its
  Coach Summary ($1,330) is the trustworthy figure.
- One summer row has **shifted columns**, producing a nonsense profit-per-player.

**Coverage does not match the bank window.** The two workbooks total $23,070 of
revenue; the bank shows **$42,395** in large incoming e-transfers over 18 months.
So these sheets are a subset — either fewer terms, or revenue arriving that they
do not track [ASK].

### What this means for household income

Applying the 27.7% coach share to the $42,395 of large receipts implies roughly
**$11,700 owed onward and $30,700 retained** over the window — about
**$1,700/month** of genuine household income from coaching, not the $2,355/month
the gross implied.

**Income was overstated by roughly $650/month**, not the $1,650 upper bound
feared. The correction is real but far smaller than the uncertainty was.

## The payoff ranking — settled *(2026-08-09)*

Every rate and balance is now known, so this can finally be stated.
This table is the **9 August snapshot**. Current canonical openings live
in `data.json` (B91 2026-08-16); this ranking is not a second live copy.

| Card | Balance | Rate | Interest/yr |
|---|---|---|---|
| TD Cash Back Visa | $5,612.43 | **26.99%** | $1,902.60 |
| TD personal Visa | $1,799.97 | 24.99% | $450.00 |
| **Triangle Mastercard** | **$13,497.00** | 21.99% | **$2,880.00** |
| Amazon / MBNA | $7,855.12 | 21.74% | $1,779.24 |
| Travel Visa | $1,078.31 | 19.99% | $215.55 |
| **Total** | **$29,842.83** | | **$7,227.39** |

**$602.28 a month on cards alone.**

### The dearest money is not the dearest rate

**The Cash Back Visa is $612.43 over its $5,000 limit, and that costs $29.00 a
month — $348 a year — for as long as it stays over.**

Paying **$612.43** stops it. That is a **56.8% annual return** on $612, against a
dearest *interest* rate of 26.99%. **Nothing else available to this household
returns anything close**, and it is the cheapest single action in the picture.

It is also time-bound: the fee recurs at each statement, on the **7th**.

### The penalty rate is recoverable, and the cost is punctuality

The TD personal Visa carries **24.99% as a penalty**; the normal rate is
**17.20%**. Restoration requires **12 consecutive on-time minimums of $94.03** —
payments already owed. Worth **$140.22/year** on today's balance for no extra
money at all, only for not missing one.

The count is currently at zero, restarted by the July 2026 miss.

### Rate ranking versus dollar ranking disagree, and dollars win

By **rate**, the Cash Back Visa leads at 26.99%. By **annual dollars**,
**Triangle leads at $2,880** — 51% more than the Cash Back Visa — because it
carries 2.4× the balance at a rate only 5 points lower.

But **Triangle's real problem is not its rate.** Five statements show $3,880 paid
and the balance down $189, because roughly **$498/month of new purchases** offset
the payments. **Paying it down without stopping the spending on it does almost
nothing.**

### A sensible order

1. **$612.43 to the Cash Back Visa** — stops the $29/month fee, 56.8% return
2. **Pay the personal Visa minimum on time, twelve times** — recovers 7.79 points
3. **Stop new purchases on Triangle**, then direct surplus there — it is the
   largest interest cost, and the only one where the fix is behavioural
4. Then MBNA, then the Travel Visa

**Consolidation into the HELOC is not available.** It is 99.5% drawn with
$1,067.84 left. That option requires repaying something first.

## The home *(owner estimate, 2026-08-09)*

**Worth $1.1m – $1.4m** [ESTIMATE — the owner's figure, not an appraisal].

This unblocks household net worth, which the analysis has carried as
"not calculable" throughout.

| | At $1.1m | At $1.4m |
|---|---|---|
| Home | $1,100,000 | $1,400,000 |
| Financial assets | $34,607.66 | $34,607.66 |
| All debt | −$777,455.57 | −$777,455.57 |
| **Household net worth** | **≈ $357,000** | **≈ $657,000** |
| Equity in the home | $352,387 | $652,387 |
| **Loan-to-value** | **68.0%** | **53.4%** |

Loan-to-value uses the mortgage and HELOC together — **$747,612.74** — since both
are secured against the house.

**This reframes the picture rather than changing it.** The household is not
insolvent and never was: it holds substantial equity. What it has is a
**liquidity and structure problem** — $777,455 of debt against $3,051 of cash,
every revolving facility at or beyond its limit, and $36,546 a year of interest.
Positive net worth and an inability to absorb a $500 surprise are entirely
compatible, and both are true here.

**For the May 2027 renewal, LTV is the number that matters.** Both ends of the
range sit under 80%, so the mortgage should renew conventionally on this measure.
**A lender will order its own appraisal** and will not take an owner's estimate,
so treat this as planning information rather than a fact to rely on. Narrowing
the $300,000 spread is worth doing before any renewal or refinancing conversation
— a realtor's opinion or a recent comparable sale would tighten it cheaply.

## Known non-TD debts

**Canadian Tire Bank — Triangle Mastercard.** Fully captured; see above.

### MBNA — Amazon.ca Rewards Mastercard *(…6454)* *(verified 2026-08-09)*

**The "MBNA Mastercard" and the "Amazon.ca Rewards Mastercard" are one card, not
two.** The card surfaced from PayPal as `••••54` is this account. Backlog items
B10 and B36 were the same debt counted twice.

**It is the household's largest credit-card debt by a wide margin.**

| | |
|---|---|
| Issuer | MBNA (a TD Bank Group brand) |
| Current opening (2026-08-09) | **$7,855.12** posted + **$82.05** pending |
| 2026-08-16 screenshot | **$8,003.61** posted, pending **$0.00** *(observation, not the Forecast opening — do not round that observation back to the statement)* |
| Credit limit | **$8,000.00** |
| Available credit | **$62.83** on the 9 August opening; **$0.00** on the 2026-08-16 screenshot (never cash) |
| Pending transactions | **$82.05** on the 9 August opening; **$0.00** on the 2026-08-16 screenshot |
| Last statement balance | $7,855.12 |
| Minimum payment | **$158.27**, due **31 Aug 2026** |
| Statement closing | **6th of the month** (June 2026 closed on the 8th) |
| **Rate — purchases** | **21.74%** |
| **Rate — cash advances** | **22.99%** |
| **Rate — balance transfers / access cheques** | **22.99%** |
| Fees charged to date | **$0.00** across all 8 statements |
| Primary cardholder | **the spouse** — this is her card, not a joint one |
| Grace period | 21 days on new purchases; none on cash advances or transfers |
| Interest on unpaid interest | **Yes** — "we charge interest on unpaid interest" |
| Issuer's payoff estimate at minimums | **64 years 3 months** |

Rates verified from the August 2026 statement's interest table, which also shows
the balance each rate applied to: **$7,797.95 of the balance sits in the
purchase bucket at 21.74%**, and nothing at all in cash advances or balance
transfers. So the whole debt is ordinary purchase spending — there is no
cash-advance component here, unlike the open question on the TD Cash Back Visa.

**21.74% is the second-lowest card rate in the household**, behind only the
Travel Visa's 19.99%. The problem with this card is not its rate.

**Utilisation on the 2026-08-09 opening was 98.2%**, or **99.2%** once the
$82.05 of pending transactions is counted. The 2026-08-16 screenshot is a
fresher dated observation: posted **$8,003.61**, pending **$0.00**,
available **$0.00**, **$3.61 over** the $8,000 limit. It is not written into
the 9 August Forecast opening. Available credit is never household cash.

**No Payment Plans.** The Payment Plans tab reads "No Payment Plans to display"
and "You do not have any recent purchases that are eligible" — so no MBNA
instalment balance sits behind the headline figure. The page covers plans closed
within the last 6 months; anything older would only appear on statements.

**The account is new, and the whole balance was built in eight months.** The
January 2026 statement opens at **$0.00**. Every dollar of the $7,855.12 was
accumulated since. All 8 statements, parsed by `scripts/mbna.js`:

| Statement | Opening | Payments | Purchases | Interest | Closing |
|---|---|---|---|---|---|
| 6 Jan 2026 | $0.00 | $0.00 | $3,030.42 | $0.00 | $3,030.42 |
| 6 Feb 2026 | $3,030.42 | −$550.00 | $2,905.32 | $86.04 | $5,471.78 |
| 6 Mar 2026 | $5,471.78 | $0.00 | $1,384.74 | $112.27 | $6,968.79 |
| 6 Apr 2026 | $6,968.79 | −$300.00 | $976.12 | $134.93 | $7,779.84 |
| 6 May 2026 | $7,779.84 | −$600.00 | $245.82 | $139.36 | $7,565.02 |
| 8 Jun 2026 | $7,565.02 | −$420.00 | $344.82 | $144.87 | $7,634.71 |
| 6 Jul 2026 | $7,634.71 | −$500.00 | $686.56 | $129.15 | $7,950.42 |
| 6 Aug 2026 | $7,950.42 | −$600.00 | $356.43 | $148.27 | $7,855.12 |
| **Totals** | | **−$2,970.00** | **$9,930.23** | **$894.89** | |

**$9,930.23 of purchases against $2,970.00 of payments.** Purchases ran at
**$1,241/month** and payments at **$371/month**, so the balance grew about
**$982/month** from a standing start.

**Two earlier beliefs about this card were wrong.** It was recorded as "$300 at
a time, five times" ($1,500) and as "NEW since June 2026". Actual payments are
**$2,970.00 across eight statements** in amounts from $300 to $600, and the
account was live from **January 2026**. The chequing-side view understated both
the payments and the age because it only ever saw payments labelled "MBNA".

**The growth has stopped, but only because the card ran out of room.** Purchases
fell from $3,030 in January to $356 in August as available credit collapsed. It
is now at $62.83 — the limit is doing the work that a decision would otherwise
have to.

**MBNA retains 7 years of statement PDFs** — far better than TD's 12 months —
and 13 billing months in CSV, QFX and Microsoft Money. The CSV is a direct
transaction export, so this card needs no PDF parsing for its transactions.

**Where it ranks.** At $148.27/month the annual interest run rate is about
**$1,779** [calculated] — third among the cards, behind Triangle (~$2,880) and
the TD Cash Back Visa (~$1,903), and rising as the balance does.

**The Oregon trip appears here too.** Two `PAYPAL*PASTINI OLD M` charges in the
August cycle match the Pastini restaurant already seen on PayPal #2 and the US
hotels on the Travel Visa. **One trip, split across three cards** — worth
remembering when the travel spend is totalled, and a reminder that no single
account shows a complete picture of any event.

A **ChatGPT subscription** (US$22.40) also bills here, which is not in any
subscription list captured so far.

**Flexiti — PAID OFF AND CLOSED** *(owner-confirmed 2026-08-09)*.
$2,654.28 was paid across the window: single payments of $1,354.28 and
$1,000.00, plus $300.00 instalments, all from DEBT&PAYMENTS. No balance, no
rate, no due date. **Excluded from the debt list and from net worth.**

---

## How each institution's data is obtained

Useful operational knowledge — it saves rediscovering this every time.

| Source | Method |
|---|---|
| **TD EasyWeb** | Custom date filter caps at **18 months**. CSV export per account works. The account switcher is unreliable; navigating from the accounts overview is more dependable |
| **TD statements** | Encrypted PDFs — standard handler, **RC4-128, revision 3**, empty user password. `scripts/pdfdecrypt.js` reads them. **Retention is ~7 years, not 12 months** — see below |
| **Canadian Tire / Triangle** | Encrypted PDFs — **AES-128 (AESV2), revision 4**, hex `/O` string. `scripts/pdfdecrypt_aes.js` reads them |
| **MBNA** | **7 years of PDFs, 13 months of CSV/QFX** — the best retention of any source here. PDFs use the **same RC4-128 R3** scheme as TD, so `scripts/pdfdecrypt.js` reads them unchanged. **The visible Download button fires no network request**; use the endpoints below. `scripts/mbna.js` parses the decrypted text |
| **PayPal** | Reports page generates activity CSVs, 12 months maximum per report. `Bank Deposit to PP Account` rows are funding pulls, **not income** |
| **Wise** | Activity CSV export per profile — **one export per profile**, they do not combine. `scripts/wise.js` parses it. Only `CARD_TRANSACTION` rows are spending; `BALANCE_TRANSACTION` rows are internal CAD→USD conversions and counting them roughly doubles the total. `TRANSFER OUT` may be a move to the household's *other* Wise profile rather than money leaving |
| **WebBroker** | **Blocked.** Requires accepting OTC Markets and CME/S&P exchange agreements — an owner decision, never an agent's |

### TD statement retention is ~7 years, not 12 months *(corrected 2026-08-09)*

**This project has been working from a wrong assumption.** TD's Statements &
Documents page offers a year filter reading **2020, 2021, 2022, 2023, 2024,
2025, 2026** plus "Last 12 Months". Confirmed for the Cash Back Visa: **12
statements in 2024, 12 in 2025, 8 in 2026** — 32 in total, where the project
believed 12 was the maximum.

Consequences:

- **Nothing is aging out.** The urgency recorded around card statements was
  misplaced. The 18-month *transaction* window is real; the statement window is
  not the constraint.
- **B26 is probably not lost.** The Personal Visa's August 2025 statement was
  written off as possibly aged out. It should still be there.
- Far more history is available than any analysis so far has used.

### How TD's statement download actually works

Statements & Documents → pick account, period and type → the list renders →
**click a statement row** → a modal opens with the PDF in an
`embed[src^="blob:"]` → **Download**.

Two traps:

- **The saved file is named with a GUID and a `.tmp` extension**, carrying no
  date. Rename from the statement date *inside* the file —
  `scripts/rename-statements.js` does this.
- **Download issues no network request.** It re-uses the blob already fetched
  when the modal opened, so there is nothing to replay. Read the blob URL off
  the `embed` instead.

The underlying JSON API, useful for enumerating what exists:

```
/waw/api/edelivery/estmt/documentfilter?accountKey=<key>
/waw/api/edelivery/estmt/documentlist?accountKey=<key>&period=<Last_12_Months|YYYY>&documentType=ESTMT
/waw/api/edelivery/estmt/documentdetail?documentKey=<documentId>
```

`documentlist` returns `documentId` (already the full document key) and
`documentName`, which carries the statement date — e.g.
`TD_CASH_BACK_VISA*_CARD_0726_Aug_07-2026`. Cash Back Visa `accountKey` is
`-1425413902`.

> **`documentdetail` returned 400 on every direct call**, including with a key
> byte-identical to one the page itself had just used successfully. It is
> evidently bound to something the app supplies that a bare `fetch` does not.
> **Do not keep retrying it.** Repeated attempts put the whole EasyWeb session
> into "We're sorry, due to technical issues…" and cost the session. Use the
> row-click-and-read-the-blob route instead, and pace it.

### Card transactions do not require statements

The **Activity** tab on a credit card lists posted transactions **grouped by
statement period**, with each period's statement balance, minimum payment and
due date. This is a direct route to card transaction history and contradicts the
premise of B3 and B16, which assumed statements were the only way in.

MBNA download endpoints, relative to `https://service.mbna.ca/waw/mbna/`:

```
PDF  accounts/<acct>/statement-history/open-save/selected-date/<YYYY-MM-DD>?format=PDF&contentDisposition=attachment&folder=&insertDocId=
CSV  accounts/<acct>/statement/download/selected-date/<YYYY-MM-DD>?format=CSV
```

`accounts/<acct>/statement-history/<year>` lists the available closing dates.

**Downloads only reach disk while the browser pane is visible.** With it hidden,
`fetch` still returns 200 with the full body and the save silently never
happens — a failure mode that looks exactly like success.

No PDF renderer is installed on this machine, so statements are read by
decrypting and extracting text directly rather than by rendering pages.

**Extract by field, never by line.** MBNA's decrypted text carries no line
breaks, so a line-oriented search returns an entire page — cardholder name, home
address and masked card number included. `scripts/mbna.js` captures one labelled
figure per pattern for exactly this reason.

---

## Standing rules

- **Read-only against every institution.** No transfers, payments, applications,
  setting changes, form submissions or agreement acceptances.
- **Never ask for or enter an institution login credential.** Bank passwords,
  PINs, security codes and 2FA are the owner's alone. On any doubt, stop.
- **Raw statements and exports stay in `raw/`** and never leave this machine.
- **Tag every figure** verified / calculated / estimated / unknown.
- The application's own secrets live only where `ARCHITECTURE.md` permits, and
  that file is the one home for the rule — do not restate a narrower version here.
  Today that means Render environment secrets in production and an environment
  variable in the developer's shell locally; never in git, never in a log, and
  never delivered to or persisted in the browser.

## What only the household can answer

Full detail in `01_OPEN_QUESTIONS.md`. In short: where $46,657 of "credit card"
transfers actually go; what the two unidentified accounts are; why the monthly
spousal transfer stopped after May 2026; and whether the business makes money
after cost of goods.
