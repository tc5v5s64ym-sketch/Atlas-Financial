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

## Known non-TD debts, terms not yet obtained

- **MBNA Mastercard** — first appeared June 2026
- **Affirm / Flexiti** — instalments of roughly $44.59/month

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
