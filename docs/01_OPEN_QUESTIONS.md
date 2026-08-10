# Open Questions — Working Agenda

**Updated 2026-08-09.** Every unanswered question in one place, ranked by what
the answer would change. Add new questions here as accounts are reviewed; move
answered ones to the bottom with the answer recorded.

Status: `OPEN` · `ASKED` · `ANSWERED` · `BLOCKED`

---

## Tier 1 — Changes what the numbers mean

### Q0. Where is the household budget that was built with the owner?
**Status:** OPEN · **Owner:** Dale + Amanda
**What we know:** Two workbooks were named as containing household budget work
developed with the owner — `monthly_budget_tracker_template.xlsx` and
`HOME BUDGET.xlsx`. Neither has ever reached this repository. There is no trace
of them or of any figure derived from them in the working tree or anywhere in
git history, and `scripts/xlsx.js` — the only spreadsheet reader here — was
written for Amanda's *coaching* workbooks, not these. The plan's household
budget is therefore built entirely from the transaction record: 18 months of
categorised spending, classified essential / discretionary / reserve, with
everything already dated on the calendar subtracted from its own category.
**What the answer changes:** The weekly household cap is $1,250, of which
$940/week is the essential requirement and $310/week is everything optional.
Those essentials are *descriptions of past behaviour*, not targets the household
agreed to. An owner budget would replace them — and it should, because a target
beats an average. The likeliest single effect is on travel: it carries
$985/month in the historical average, concentrated in May–July 2026, with no
trip known to fall inside this window. If that is right, the discretionary
figure above is understated by roughly that much.
**How to answer:** Put the two workbooks somewhere local and readable. They must
NOT be committed — they are household financial detail and belong under `raw/`
like every other source. Each budget category in `data.json` has an empty
`plannedMonthly` slot waiting for the owner figure; filling one flips that row
from `historical-actual` to `owner-target`, and the tests already assert the
distinction is reported honestly.

### Q1. Does the business make money?
**Status:** OPEN · **Owner:** Dale + wife + accountant
**What we know:** $54,213 of inbound e-transfers over 18 months (~$3,012/month)
described as sale proceeds. $23,200 of outbound e-transfers, $13,062 of it drawn
directly from the HELOC at 4.90%. Heavy retail purchasing currently classified as
household spending. A CRA balance paid from the HELOC.
**What the answer changes:** Everything. If receipts exceed true cost of goods,
the household is running a financed but viable side business. If they do not, the
activity is consuming HELOC capacity and generating tax liability while producing
little — which would explain why the HELOC grows despite $78,177 of repayments.
It also determines whether household "spending" of $7,551/month is overstated.
**How to answer:** Set the $54,213 of receipts against inventory purchases —
e-transfers out plus whichever retail purchases were for resale. Even a rough
month of tracking would settle it.

### Q2. Where do the "TFR-TO C/C" transfers go?
**Status:** OPEN · **Owner:** Dale
**What we know:** $46,657 over 18 months — $24,818 from chequing, $22,230 from
the HELOC — labelled as credit-card payments. The TD Visa's balance fell only
$391 across that period and shows no purchases at all. The money is not arriving
at that card.
**What the answer changes:** Could reveal a credit card with a significant
balance that is entirely absent from the debt ranking. At ~$2,600/month of
servicing, a debt of real size is plausible.
**How to answer:** Dale should recognise the destination immediately — it is a
transfer he or his wife set up.

### Q3. What is the home worth?
**Status:** OPEN · **Owner:** Dale
**What we know:** $747,612.74 of debt is secured against it. Original mortgage
$648,000 in May 2022.
**What the answer changes:** Household net worth is currently unstateable — the
−$717,407 figure is only the financial-account fragment. Loan-to-value also
determines what is possible at the May 2027 renewal, including whether HELOC
consolidation is available at all.
**How to answer:** A recent comparable sale or an appraisal. Municipal assessment
is a weaker proxy but better than nothing.

---

## Tier 2 — Changes the plan

### Q4. What are the balances and rates on the remaining non-TD debts?
**Status:** PARTIALLY ANSWERED 2026-08-09 · **Owner:** Dale + wife
**Answered — Triangle Mastercard (Canadian Tire Bank):** $13,497.00 against a
$13,500 limit (99.98% used, $3.00 available). **21.99% on purchases, 22.99% on
cash.** Minimum $253.57, due 7 Aug 2026. Costs roughly **$2,880/year** in
interest. Over five statements $3,880 was paid and the balance fell $189.07.
Issuer's disclosure: **99+ years to repay at minimums.**
**Still open:** MBNA Mastercard ($750 paid, new since June 2026) and
Affirm/Flexiti (~$44.59/month) — balances and rates unknown.
**What it already changed:** the debt ranking. Triangle is now the largest
non-mortgage interest cost — six times the TD card's — and the first target for
any surplus. Total known debt rose to $762,909.71 and financial-account net worth
fell to −$730,904.02.

### Q4b. Was the Triangle payment due 7 August actually made?
**Status:** OPEN — TIME-SENSITIVE · **Owner:** Dale
**What we know:** As at 9 August the account shows "Remaining Balance Due
$13,309.70" — the full statement balance, unchanged. The current balance differs
from it only by two new purchases ($187.30). No payment appears to have posted.
**What the answer changes:** A late payment risks a fee, a default rate, and
credit reporting — on a card already at 99.98% utilisation. If a payment is in
transit this is moot; if not, it should be made today.

### Q5. Why did the wife's monthly transfer stop after May 2026?
**Status:** OPEN · **Owner:** Dale + wife
**What we know:** $1,000/month from March 2025, stepping to $1,100 in November
2025, reliable through May 2026. Absent June, July, August 2026.
**What the answer changes:** ~$1,100/month. If the payment method changed, the
money may still be arriving elsewhere and the income picture is intact. If the
income changed, the household budget needs rebuilding around it.

### Q6. What are the two unidentified accounts?
**Status:** OPEN · **Owner:** Dale + wife
**What we know:** Account #2 sent $33,598 in across 142 transactions and received
$5,914. Account #1 received $16,945 across five large transfers and sent $2,570.
Neither is a TD account on this profile.
**What the answer changes:** $59,027 of movement. Likely connected to the
business or to the wife's accounts, which would fold them into Q1.

### Q7. Where exactly does the card's 12-month count start?
**Status:** OPEN · **Owner:** Dale (call TD)
**What we know:** Penalty rate applied from the February 2026 statement after
misses in December 2025 and January 2026. Further misses in April and July 2026.
My reading is the count restarts from the August 2026 statement, giving earliest
restoration around August 2027.
**What the answer changes:** Whether the 17.20% rate returns in 2027 or later.
Worth a five-minute call; also worth asking whether TD will reprice earlier given
the balance is small and static.

### Q8. What are the five large uncategorized HELOC advances?
**Status:** OPEN · **Owner:** Dale
**What we know:** $18,301.43 across only five transactions.
**What the answer changes:** Likely folds into Q1 or Q2, but the size warrants
identifying them individually.

---

## Tier 3 — Fills gaps, does not change direction

### Q9. What does the PayPal spending buy?
**Status:** ANSWERED 2026-08-09 · see Answered section below.

### Q13. What is the unnamed PayPal merchant?
**Status:** ANSWERED 2026-08-09 — see Answered section. There was none.

### Q14. Are Fiverr and Gumroad business costs?
**Status:** LOW PRIORITY · **Owner:** wife
Both are registered as automatic payments but neither is currently billing.
**Gumroad: a single $15.00 charge on 25 May 2024, status INACTIVE** [PAYPAL].
Fiverr does not appear in nine months of settled spend. Cancelling either would
save nothing today. Worth confirming with the wife whether they belong to the
business, but there is no cost pressure behind it.

### Q10. Are the four zero-balance investment accounts open, dormant, or closed?
**Status:** OPEN · **Owner:** Dale
TFSA, US TFSA, and two mutual-fund accounts all at $0.00. Status not stated by TD.

### Q11. What is in the WebBroker RESP?
**Status:** BLOCKED · **Owner:** Dale
Access requires accepting OTC Markets and CME/S&P exchange agreements. That is a
legal acceptance and the account holder's decision. Balance ($31,555.85) is known
from the overview; holdings, book value, and contribution room are not.

### Q12. How much of the 19% uncategorized spending is business inventory?
**Status:** OPEN · **Owner:** Dale + wife
$25,630 over 18 months could not be reliably categorized. Overlaps heavily with
Q1 — separating the business would resolve much of it prospectively.

---

## Queued for the next round of accounts

- Other credit cards — balances, rates, limits, minimums, due dates, statement history
- The wife's business — accounts, revenue, cost of goods, tax status, registration
- Any additional loans, financing, or institutions not yet named

---

## Answered

### Q9. What does the PayPal spending buy? — ANSWERED 2026-08-09
351 transactions reviewed, July 2025 – March 2026. **$5,725.63 outgoing over nine
months, about $636/month.** Roughly **73% is entertainment**: gaming $1,588.80,
Apple Services $1,138.72, food delivery $956.48, streaming $521.76. At least 16
active automatic payments.

Three useful negatives, each of which closes off a hypothesis:
- **No business revenue passes through PayPal.** The 160 "incoming" entries are
  bank-funding pulls from Chequing A, not sales.
- **No person-to-person transfers at all**, so PayPal is not the channel behind
  the unexplained e-transfers (Q2, Q6).
- **No hidden asset or debt** — balance $0.00, Pay-in-4 plans complete.

**Corrected 2026-08-09.** The first pass reported ~$636/month and a $623.52
"unnamed merchant". Both were wrong — the total double-counted PayPal's
*General Currency Conversion* rows (the CAD leg of foreign-currency purchases
already counted under their merchant names) plus two fully-refunded withdrawals.
Corrected figure: **$4,168.89 settled over nine months, ~$463/month**,
cross-checked against $4,262.43 of bank funding pulls (~$474/month).

### Q13. What is the unnamed PayPal merchant? — ANSWERED 2026-08-09
**There was no unnamed merchant.** The ten blank-name rows were eight currency-
conversion legs and two refunded withdrawals. The conversion legs pair exactly
with foreign-currency music-software purchases: amalgam audio €35.00 ×2 →
−$59.05 ×2, amalgam audio €30.00 → −$50.46, Boutique Tones US$60.00 → −$86.20,
IK Multimedia €49.99 → −$84.23. Verified against the December 2025 activity page.
