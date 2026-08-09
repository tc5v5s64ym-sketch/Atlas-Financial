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
from the September minimum. **It was paid** *(owner-stated, 9 Aug 2026 — not yet
seen on the account)*.

**Last month's minimum remains outstanding**, so the $69.93 did not unfreeze the
card and did not restart the penalty-rate clock. The $762.36 minimum is still due
**1 Sep 2026**. Balance after the payment is roughly **$5,612.50** [calculated,
$5,682.43 − $69.93] — still about **$612 over the $5,000 limit**, so a further
**$29.00 over-limit fee** should be expected on the September statement unless
the balance is brought under $5,000 before the 7th.

**The card is frozen.** The August statement states:

> "YOUR ACCOUNT IS OVER THE CREDIT LIMIT. NO FURTHER USE IS PERMITTED UNTIL THE
> 'MINIMUM PAYMENT' IS RECEIVED. YOUR 'MINIMUM PAYMENT' REQUIRED FOR LAST MONTH
> HAS NOT YET BEEN RECEIVED."

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
| Credit limit | Not stated on the statement template used [ASK] |
| Minimum payment | $17.00, due **26 Aug 2026** |
| Statement cycle | 6th/7th to 5th/6th |
| TD Rewards points | 57,968 |
| Pattern | Small balances, paid down and reused. Went into credit in Jun 2026 |

TD's own footnote confirms this is excluded from the consolidated card balance
because it is a **business** card.

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

**This connects to her income.** DEBT&PAYMENTS receives deposits marked
`TENNIS BC EXP` — expenses, not salary. She appears to travel for Tennis BC,
pay on this card, and be reimbursed. That means **part of the $63,129 recorded
as Tennis BC income is expense reimbursement rather than earnings**, and the
matching cost sits on this card. Amounts marked `EXP` total $1,639.10 across the
window; `AP` a further $2,846.58 [ASK — confirm which descriptors are pay versus
reimbursement].

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
| **American Express** ••••07 | ❌ **still unknown — no balance, rate or statements** |
| TD Cash Back Visa ••••26 | ✅ |
| TD Emerald Visa ••••70 | ✅ the personal card |
| TD Business Travel Visa ••••70 | ✅ |
| Visa Debit ••••75 | ✅ presumed a household chequing card |

**The Amazon Mastercard is now identified** — it is the MBNA account, and it
*does* receive payments from DEBT&PAYMENTS, recorded as "MBNA" $300 at a time.
The link was missed because the payments name the issuer and the card names the
retailer.

**The Amex remains unexplained.** It appears in no TD account and receives
payments from no chequing account analysed, so it is either paid from an account
not yet captured or carries a balance nobody has mentioned. Given the Amazon card
turned out to hold $7,855.12, this gap is no longer a small one [B37].

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
| **Interest rate** | **UNKNOWN** — not shown anywhere in online banking; it is in the statement PDF [pending] |

**Utilisation is 98.2%**, or **99.2%** once the $82.05 of pending transactions is
counted. Available credit and pending reconcile exactly against the limit:
$8,000.00 − $7,855.12 − $82.05 = $62.83 [calculated], so pending is already
netted off the available figure. **A little over $60 of room remains on an
$8,000 card.**

**No Payment Plans.** The Payment Plans tab reads "No Payment Plans to display"
and "You do not have any recent purchases that are eligible" — so no MBNA
instalment balance sits behind the headline figure. The page covers plans closed
within the last 6 months; anything older would only appear on statements.

**The account is new.** Statement history offers **8 statements, January to
August 2026**; selecting 2025 returns **"No Activity"**. So the card was opened
around December 2025, and there is no earlier history to capture. This is
consistent with the five $300 payments from DEBT&PAYMENTS, all of which fall
inside 2026.

**MBNA retains 7 years of statement PDFs** — far better than TD's 12 months —
and 13 billing months in CSV, QFX and Microsoft Money. The CSV is a direct
transaction export, so this card needs no PDF parsing for its transactions.

**The rate is the one thing still missing**, and it is the thing that decides
the payoff order. Amazon.ca Rewards Mastercard purchase rates are commonly
19.99%, but that is a guess about a product, not a fact about this account — it
must be read off the statement rate table before it is used [unknown].

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
| **TD statements** | Encrypted PDFs — standard handler, **RC4-128, revision 3**, empty user password. `scripts/pdfdecrypt.js` reads them |
| **Canadian Tire / Triangle** | Encrypted PDFs — **AES-128 (AESV2), revision 4**, hex `/O` string. `scripts/pdfdecrypt_aes.js` reads them |
| **PayPal** | Reports page generates activity CSVs, 12 months maximum per report. `Bank Deposit to PP Account` rows are funding pulls, **not income** |
| **WebBroker** | **Blocked.** Requires accepting OTC Markets and CME/S&P exchange agreements — an owner decision, never an agent's |

No PDF renderer is installed on this machine, so statements are read by
decrypting and extracting text directly rather than by rendering pages.

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
