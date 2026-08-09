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

## Still needed from TD EasyWeb — the complete list

**None of it is time-sensitive.** TD retains statements for 12 months and
transaction history for 18, so a new session loses nothing beyond a fresh
sign-in.

### Coverage as at 2026-08-09

| Account | Terms | Rate | Transactions | Statements |
|---|---|---|---|---|
| Mortgage | ✅ | ✅ 3.64% | n/a — terms sufficient | — |
| HELOC | ✅ | ✅ 4.90% | ✅ 208 | — |
| Chequing A / BILLS | ✅ | — | ✅ 1,285 | — |
| Chequing B / WEEKLY | ✅ | — | ✅ 2,705 | — |
| DEBT&PAYMENTS | ✅ | — | ✅ 379 | — |
| SAVINGS-DONT TOUCH | ✅ | ❌ | ✅ 54 | — |
| EMERGENCY SAVING | ✅ | ❌ | ✅ 24 | — |
| Personal Visa | ✅ | ✅ 24.99% | via statements | ⚠️ 11 of 12 |
| **Cash Back Visa** | ✅ | ✅ 26.99% | ❌ | ⚠️ **1 of 12** |
| **Travel Visa** | ⚠️ no limit | ✅ 19.99% | ❌ | ⚠️ **1 of 12** |
| RESP (WebBroker) | balance only | — | ❌ | blocked |

### Outstanding items

**B2 · Cash Back Visa — 11 remaining statements** · *medium*
**B3 · Cash Back Visa — transaction history** · *medium*
**B4 · Travel Visa — 11 statements and transaction history** · *medium*
**B6 · Travel Visa — credit limit** · *small* — absent from the statement
template used; available credit reads $0.00 so it is at its limit
**B7 · Reconcile the $158.55 interest charge** · *small*

**B22 · Savings interest rates** · *small*
Neither EMERGENCY SAVING nor SAVINGS-DONT TOUCH has a captured rate. The second
earned **$0.11 across 18 months**, so the rate is near zero — worth confirming
only because it bears on whether either account should hold a cash buffer at all.

**B23 · Chequing B overdraft interest rate and protection terms** · *small*
The $600 limit is known and the $5.00 monthly protection fee is visible in
transactions, but not the rate charged on the drawn balance. It has been drawn
in all 18 months, so this is a real recurring cost that is currently unquantified.

**B24 · Account plans and fee structures on all five chequing/savings accounts** · *small*
Fees observed: $17.67/month across two accounts, $3.95/month on DEBT&PAYMENTS,
plus withdrawal, cheque-return and NSF charges. **Some TD plans waive the monthly
fee at a minimum balance, and some bundle accounts.** Each account's *Manage*
tab shows its plan. This is one of the few places an immediate saving might exist.

**B25 · Mortgage prepayment penalty formula** · *small*
The annual prepayment privilege ($97,200) is known, but not the penalty for
breaking or moving the mortgage before 1 May 2027. Needed before any renewal or
refinancing conversation, and a mortgage advisor will ask for it first.

**B26 · Personal Visa — the August 2025 statement** · *small*
One of twelve downloads returned a duplicate of June 2026, so August 2025 was
never retrieved. It is the oldest in the window and may now have aged out.

**B27 · RESP holdings** · BLOCKED · *small*
Balance $31,555.85 is known; holdings, book value and contribution room are not.
Access requires accepting OTC Markets and CME/S&P exchange agreements —
**an owner decision, never an agent's**.

**B28 · Rewards balances as minor assets** · *small*
Travel Visa holds **57,968 TD Rewards points**; Cash Back Visa holds **$47.21**
in Cash Back Dollars. Small, but they are assets and currently absent from net
worth.

### Routes that work

The account switcher and in-page navigation links are unreliable. These work:

- **Credit cards** — accounts overview → click the card → *Manage* tab →
  "View your statements and documents" → click a statement row → wait for the
  `embed` element's `blob:` URL → download from it
- **Chequing and savings** — open the account → quick filter → *Custom* → set
  the date range → *Apply filters* → *Download* → CSV
- **The legacy interface** at `AccountDetailsServlet?selectedAccount=<id>` is a
  reliable fallback and served the mortgage terms when the modern UI would not

**Caution:** clicking anything that triggers navigation kills a running script
mid-execution. Drive one navigation per call and re-read the page between steps
rather than chaining them.

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

**B5 · Verify the two "personal credit card" entries are one account** · **DONE 2026-08-09**
Confirmed: **one account, two cards.** Both show balance $1,799.97, available
credit $200.00, last statement Jun 24 – Jul 23 at $1,899.97, payment due
17 Aug 2026, and the same $100.00 payment on 5 Aug. **No additional debt.**

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
