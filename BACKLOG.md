# Backlog

**Work that can be done.** Questions only the household can answer live in
`docs/01_OPEN_QUESTIONS.md` — keep the two apart. If an item needs a human to
know something, it is a question. If it needs someone to *do* something, it
belongs here.

Status: `READY` — nothing blocking · `BLOCKED` — waiting on input ·
`QUEUED` — waiting on earlier capture · `DONE`

Last reviewed **2026-08-09**. Phase: **data capture**.

---

## ⚠️ Published figures are stale

**B1 · Update `data.json` and `docs/positions.csv` with everything found on the
spouse's profile** · READY · *high*

The live site and the data spine still show the pre-9-August picture. They are
missing two chequing accounts, two credit cards, and her employment income.
Anyone reading the dashboard right now gets materially wrong numbers.

Missing from publication:

| | Currently shown | Actual |
|---|---|---|
| Household cash | $449.84 | **$2,915.89** |
| Credit-card debt | $1,799.97 | **$7,482.40** |
| Known total debt | $762,910 | **$769,670** |
| Her employment income | absent | **$63,129 over 18 months** |

Do this before any further analysis, so nothing downstream is built on figures
already known to be wrong.

---

## Data capture — nothing blocking

**B2 · TD Cash Back Visa: 11 remaining statements** · READY · *medium*
One of twelve captured. The rest give a full 12-month balance and payment
history — needed to see whether this card has been climbing steadily or spiked.
Also the most likely place to confirm where the $46,657 of "TFR-TO C/C"
transfers landed.

**B3 · TD Cash Back Visa: transaction history** · READY · *medium*
$5,682 of accumulated spending is entirely absent from the household spending
categories. The dashboard's spending chart is incomplete without it.

**B4 · Travel Visa: 11 remaining statements and transaction history** · READY · *medium*
The business card. Its transactions are the single most direct evidence for the
business question. One statement shows US$1,744 of US hotels plus a Calendly
subscription.

**B5 · Verify the two "personal credit card" entries are one account** · READY · *small*
Hers shows …5770, his shows …6294, both $1,799.97. Almost certainly one account
with two cards, but if they are separate that is another $1,800 of debt.

**B6 · Travel Visa credit limit** · READY · *small*
Not present on the statement template used. Available credit reads $0.00, so it
is at its limit, but the limit itself is unknown.

**B7 · Reconcile the TD Cash Back interest charge** · READY · *small*
$158.55 charged where 26.99% on the observed balance implies about $115. Likely
a cash-advance component or interest compounding. Worth resolving because a cash
advance would also carry a transaction fee and no grace period.

**B8 · PayPal: April–August 2026 gap** · READY · *small*
Nine months captured, five missing. The date-range control did not respond; a
fresh 12-month report from the Reports page would cover it.

**B9 · PayPal: per-subscription amounts and next billing dates** · READY · *small*
Sixteen merchants are named on the automatic-payments page but without amounts.
That list is what turns "$463/month" into a reviewable set of decisions.

---

## Blocked on the household

These need someone to obtain or decide something. The corresponding *questions*
are in `docs/01_OPEN_QUESTIONS.md`.

**B10 · MBNA Mastercard — statements or a summary screenshot** · BLOCKED · *small*
Paid from DEBT&PAYMENTS at $300 a time. No balance, no rate. It is the last
unknown consumer debt.

**B11 · Flexiti — statements or a summary** · BLOCKED · *small*
$1,354.28 and $1,000 single payments plus $300 instalments. No balance, no rate.

**B12 · Home valuation** · BLOCKED · *small*
Blocks household net worth entirely, and blocks any loan-to-value work for the
May 2027 renewal.

**B13 · Business records — revenue and cost of goods** · BLOCKED · *large*
The Tier 1 question. Banking data cannot separate inventory purchases from
household shopping.

**B14 · Decide whether the business and her employment stay in scope** · BLOCKED · *small*
The Travel Visa is TD-designated business and the Tennis BC reimbursements are
her employment. Both are legitimately hers rather than joint.

---

## Analysis — queued behind capture

**B15 · Rebuild the income picture** · QUEUED *(on B14, and the descriptor question)* · *medium*
Her Tennis BC income was absent entirely. Folding it in requires care: the
portion she transferred across is already counted as "spouse transfer", and some
deposits are expense reimbursement rather than pay. Double-counting is the risk.

**B16 · Rebuild the spending picture** · QUEUED *(on B3, B4)* · *medium*
Two cards' worth of spending is missing from every category total.

**B17 · Rebuild net worth and the debt ranking** · QUEUED *(on B1, B10, B11, B12)* · *medium*
The ranking already changed once — the Cash Back Visa at 26.99% displaced
Triangle as the most expensive debt. MBNA and Flexiti could change it again.

**B18 · Re-examine the $46,657 "TFR-TO C/C"** · QUEUED *(on B2)* · *medium*
The working theory is that these paid the Cash Back Visa rather than the
personal card. Its statement history should settle it.

**B19 · Refresh the mortgage and HELOC deep dive** · QUEUED *(on B1)* · *small*
Written before the spouse's accounts were known. The HELOC paydown analysis in
particular now has a second source of funds routed through SAVINGS-DONT TOUCH.

---

## Build — after capture stabilises

**B20 · Convert `data.json` to `snapshots/<date>.json` and add trend charts** · QUEUED · *medium*
Architecture tier 2. Gives history without a database. Worth doing once the
capture phase settles, so the first snapshot is a complete one.

**B21 · Second-month intake run** · QUEUED · *small*
The real test of the architecture: next month's statements should be a
ten-minute job. If it is not, the process needs fixing rather than the data.

---

## Done

- Consolidated to a single folder with a content-scanning pre-commit hook
- Deployed the password-gated site to Render, verified from outside
- Captured TD (11 accounts), Triangle Mastercard, PayPal, and the spouse's TD profile
- Wrote two PDF decryptors — RC4-128 for TD, AES-128 for Canadian Tire
- Identified the two previously unidentified accounts as DEBT&PAYMENTS and
  SAVINGS-DONT TOUCH, and established what each does
- Captured every TD rate: mortgage 3.64%, HELOC 4.90%, Cash Back 26.99%,
  personal card 24.99% penalty, Travel Visa 19.99%, Triangle 21.99%
