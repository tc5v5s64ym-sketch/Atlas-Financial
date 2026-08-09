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

Statement close dates: **TD card ~23rd** · **Triangle 17th**.

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

### SAVINGS-DONT TOUCH *(…6478420)*
Balance $74.20. Receives occasional transfers; the name states the intent.

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
from the September minimum.

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
| Rate | **Not yet captured** |
| Balance | $1,078.31 · pending $165.13 |
| Available credit | **$0.00** |
| Minimum payment | $17.00, due **26 Aug 2026** |
| Statement cycle | 6th/7th to 5th/6th |
| Pattern | Small balances, paid down and reused. Went into credit in Jun 2026 |

TD's own footnote confirms this is excluded from the consolidated card balance
because it is a **business** card. It is the most likely home of the business's
card spending.

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

## Known non-TD debts, terms not yet obtained

- **MBNA Mastercard** — paid $300 at a time from DEBT&PAYMENTS, five times
- **Flexiti** — $1,354.28 and $1,000.00 single payments, plus $300 instalments
- **Canadian Tire Mastercard** — also paid from DEBT&PAYMENTS ($300 × 2)

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
