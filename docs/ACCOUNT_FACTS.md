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
| **21st** | HELOC minimum (interest only) | ~$814 | TD |
| **31st / month end** | **Amazon.ca Rewards Mastercard minimum** | **$158.27** | MBNA |
| **1st** | TD Cash Back Visa minimum | $762.36 | TD |
| **26th** | Travel Visa minimum | $17.00 | TD |

Statement close dates: **TD card ~23rd** · **Triangle 17th** ·
**MBNA/Amazon 6th** · **TD Cash Back 7th** · **Travel Visa 5th**.

Income: payroll **bi-weekly** (~$4,469), child benefit **monthly** (~$153.59).
Bonus or vacation pay has historically landed in **February and July**.

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

## HELOC — TD *(verified 2026-08-09)*

| | |
|---|---|
| Rate | **4.90% variable** — TD Prime **+ 0.45%** (Prime was 4.45%) |
| Credit limit | **$202,654.00** |
| Minimum payment | **Equals the monthly interest charge** — roughly $814 |
| Due | 21st, monthly |
| Structure | **Interest-only revolving. Paying the minimum reduces principal by nothing** |

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

## Triangle Mastercard — Canadian Tire Bank *(verified 2026-08-09)*

| | |
|---|---|
| Rate | **21.99% purchases / 22.99% cash** |
| Credit limit | **$13,500.00** |
| Due | 7th, monthly · statement dated 17th |
| Structure | Revolving. Issuer states 99+ years to repay at minimum payments |

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

### DEBT&PAYMENTS chequing *(…6458934)*
Balance $2,691.85, **no overdraft facility**. Charges a **$3.95 monthly account
fee**, plus withdrawal and cheque-return fees — the other chequing accounts do
not. This is where her employment income lands and where many household debt
payments originate.

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

**One figure does not reconcile and is worth asking TD about.** At 26.99% on an
average balance of roughly $5,200 over a 30-day cycle, interest should be about
$115. The charge was **$158.55** — consistent with an average balance nearer
$7,100, which the account did not carry. Plausible explanations are a
cash-advance component at 27.99% with no grace period, or interest compounding
on unpaid interest under TD's 2 July 2026 change. Not resolved [ASK].

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
| Current balance | **$7,855.12** |
| Credit limit | **$8,000.00** |
| Available credit | **$62.83** |
| Pending transactions | $82.05 |
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

**Utilisation is 98.2%**, or **99.2%** once the $82.05 of pending transactions is
counted. Available credit and pending reconcile exactly against the limit:
$8,000.00 − $7,855.12 − $82.05 = $62.83 [calculated], so pending is already
netted off the available figure. **A little over $60 of room remains on an
$8,000 card.**

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
- **Never ask for or enter a credential.** Passwords, PINs, security codes and
  2FA are the owner's alone.
- **Raw statements and exports stay in `raw/`** and never leave this machine.
- **Tag every figure** verified / calculated / estimated / unknown.
- Secrets live only in Render environment variables.

## What only the household can answer

Full detail in `01_OPEN_QUESTIONS.md`. In short: where $46,657 of "credit card"
transfers actually go; what the two unidentified accounts are; why the monthly
spousal transfer stopped after May 2026; and whether the business makes money
after cost of goods.
