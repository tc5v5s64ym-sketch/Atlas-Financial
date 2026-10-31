# Household evidence package — 2026-08-16

Status authority for open questions remains `docs/01_OPEN_QUESTIONS.md`.
This file is the source-intake record for the 2026-08-16 owner-confirmed
package. It does not become a second facts authority.

Triangle (`AUG16-005`) and MBNA (`AUG16-006`) screenshots are dated
observations. They do not rewrite the 2026-08-09 Forecast opening in
`data.json` until a coherent current-state cutover. Mixed-time openings
are refused.

Raw statement binaries are not committed. Sanitised facts below are the
ones this package may consume.

```evidence-ids
AUG16-001
AUG16-002
AUG16-003
AUG16-004
AUG16-005
AUG16-006
AUG16-007
```

## PRIMARY STATEMENT EVIDENCE

### TD Home Equity FlexLine statements — Dec 2025 through Jul 2026
`AUG16-001`

Credit limit / current plan limit: $202,654.

Statement minimums (each equals that period's interest charge; overdue $0
on every supplied statement):

| Statement | Due | Regular minimum |
|---|---|---|
| Dec 2025 | 2026-01-21 | $829.52 |
| Jan 2026 | 2026-02-21 | $839.56 |
| Feb 2026 | 2026-03-21 | $751.46 |
| Mar 2026 | 2026-04-21 | $783.16 |
| Apr 2026 | 2026-05-21 | $769.52 |
| May 2026 | 2026-06-21 | $810.09 |
| Jun 2026 | 2026-07-21 | $787.58 |
| Jul 2026 | 2026-08-21 | $814.18 |

Payment due date is the 21st. A Pre-Authorized Debit Date around the 1st
is shown on the statements.

Observed payment mechanics (same statements):

- February statement minimum $751.46; March 2 payment from a TD account
  -$751.46 (exact match).
- May statement minimum due for June $810.09; June 2 transfer -$800.00
  plus June 3 payment -$10.09 = $810.09 exactly.

A manual HELOC payment can reduce the remaining required minimum; the
automatic payment can then collect only the residual. Manual payments
also appear from household TD chequing accounts, including Bills Account
and TENNIS INCOME. Canonical account numbers are not restated here.

Interest posting and cash payment remain distinct facts. The Jul statement
shows PAD date Aug. 1 2026. This 16 August package does not prove whether
that PAD already occurred from the Lunch Money pull. Later owner activity
evidence (2026-08-18) closes remaining August cash impact in Q19; this file
stays the statement-series record.

### Bell Mobility statements — Jun / Jul / Aug 2026
`AUG16-002`

August 1 2026 bill (main account):

- Previous amount due: $373.31
- Payment received Jul. 17: -$250.00
- Unpaid balance: $123.31
- Current charges: $233.31
- Total amount due: $356.62
- Pay by: 2026-08-17

August current charges included $70.00 monthly, $25.80 device payment,
$110.00 usage / long distance, $21.34 tax.

June statement (normal recurring baseline, no unusual travel usage):

- $70.00 monthly services
- $25.80 device payment
- $8.40 taxes
- ≈ $104.20 normal monthly baseline

The main phone plan itself is $55. The same Bell account also contains a
$15 watch line. $356.62 is not the normal monthly run rate: it contains
arrears and travel/roaming.

Amanda's 2026-08-16 handoff: two separate bills; the CSV is an additional
watch; the Bell PDFs are the phone and a watch.

Second-account CSVs (June 11 and July 11), distinct from the main Bell PDF
account:

- BYOD Watch SA Ultd Shr 2GB: $15.00
- GST: $0.75
- BC PST: $1.05
- Recurring baseline: **$16.80/month**

Do not use that account's accumulated amount-due / arrears as the
recurring baseline. Do not merge this $16.80 with the $15 watch line
already inside the main Bell PDF bill.

### MBNA Amazon Mastercard statement
`AUG16-003`

- Statement balance: $7,855.12
- Minimum payment: $158.27
- Payment due: 2026-08-31
- Purchase APR: 21.74%
- Cash advance / balance transfer APR: 22.99%
- Statement interest charged: $148.27

### Noble Disposal Services invoice
`AUG16-004`

- 3 Month Subscription — Package A: 2 cans
- Total: $95.85
- Cadence: every 3 months on the 18th
- Repeats indefinitely
- A March 18 2026 payment of $95.85 is shown

Do not infer the exact payment card from a "Visa 0870" mask unless an
independent identity source already proves that card.

### Triangle (Canadian Tire Bank) current screenshot — 2026-08-16
`AUG16-005`

- Credit limit: $13,500.00
- Last statement balance: $13,309.70
- Current (posted) balance: $13,197.00
- Pending balance: $15.62
- Available credit: $287.38 (not household cash)
- Displayed minimum due: $0.00
- Displayed due date: Aug. 7 2026
- 2026-08-10 posted payment: TD BANKLINE/TELELIGNE TD -$300.00

Observed exposure = $13,197.00 posted + $15.62 pending = $13,212.62.
Dated observation, not the 2026-08-09 opening (posted $13,497.00).

The $300 payment is confirmed posted Aug. 10. That date is after the
displayed Aug. 7 due date. This package does not prove on-time status or
default-rate consequences.

### MBNA Amazon Mastercard current screenshot — 2026-08-16
`AUG16-006`

- Current balance: $8,003.61
- Available credit: $0.00
- Pending transactions: $0.00
- Credit limit: $8,000.00

The screenshot is fresher current-balance evidence than the statement.
It remains a dated observation, not the 2026-08-09 Forecast opening
(posted $7,855.12 + pending $82.05). The statement remains authority for
minimum, due date, APRs, statement balance, and interest. Do not round
the observation back to the statement amount, and do not write it into
the opening alone.

## OWNER CONFIRMATION
`AUG16-007`

- The old BC Hydro amount previously questioned as outstanding is settled.
  The known future Sep. 1 Hydro obligation is a separate bill and is not
  cancelled by that settlement.
- TELUS IS CLOSED. Do not forecast Telus as an active household bill
  unless newer transaction evidence proves a new active Telus service.
- Noble Disposal Services is the household garbage service.
- A second Bell/watch account exists and is still active. Do not merge it
  with the $15 watch line on the main Bell account. The attached June 11
  and July 11 CSVs prove the recurring cadence at **$16.80/month**
  ($15.00 + $0.75 GST + $1.05 BC PST). The same package's Bell PDFs place
  the $15 watch line on the main account; that line is already inside the
  main bill total and must not be double-counted. Absence from those
  main-account PDFs does not retract this owner confirmation.
- The TD account previously labelled DEBT&PAYMENTS is now TENNIS INCOME
  (same canonical account identity). Amanda's Tennis BC salary and
  coaching income land there; coaches/business/pass-through amounts are
  paid from that account first; remainder is transferred into BILLS
  ACCOUNT. Money becomes household-available when it is actually
  transferred. The raw TENNIS INCOME balance is not automatically
  spendable household cash. Do not estimate how much of the current
  balance is household-available.
- Amanda is no longer receiving the garage/lab income that funded the
  historical ~$1,000–$1,100 monthly transfer after May 2026. That is not
  missing household income; the income source ended. Do not forecast it.
- There are currently no pending Fusion installments. The three live-plan
  $500 rows are stale. Upcoming Fusion season planning estimate is
  approximately 4 × ~$500, probably starting late September 2026; exact
  total, dates, and installment count remain estimates — not current
  invoices.
- Current known tournament planning list: Seattle November 2026; Seattle
  December 2026; Indio, California January 2027; Provincials expected but
  location/date/cost unknown. No other specifically known tournaments.
  Tacoma is not on the current known list.
- School & clubs is ESSENTIAL for the household operating plan.
- Logan's and Linden's Burrards registrations are both PAID. No
  registration amounts remain owed. Expected upcoming team fees are
  approximately $700 total, sometime in September 2026; exact amount and
  due date unknown.
- The owner does not currently know the emergency-cash target. Do not
  invent one.
- The Lunch Money pending Bell Mobility $250.00 on Travel Visa dated
  2026-08-14 is a valid Bell payment. It remains pending until it posts.
  Against the Aug. 17 Bell total of $356.62, $106.62 is an inferred
  residual only while the $250 remains pending.

## What this package does not answer

- Q20 emergency-reserve / surplus policy.
- Q21 the specific historical $527.80 Fusion/Burrards classification.
- Remaining August HELOC cash impact after the Aug. 14 $1,100 — answered
  2026-08-18 in `docs/01_OPEN_QUESTIONS.md` Q19 from later owner activity
  evidence; this 16 August package did not close it.
- Whether the pending Aug. 14 Bell $250 posts, and whether any residual
  main-account Bell cash still needs a dated joint-cash row after that
  posting (Q18 settlement state). The second Bell/watch recurring amount
  is **$16.80/month** from the attached CSVs and is not an open cost
  question.
- Exact Fusion upcoming dates/total.
- Exact Burrards team-fee amount/date.
- Provincials date/location/cost.
- Whether the Triangle Aug. 7 obligation was paid on time.
