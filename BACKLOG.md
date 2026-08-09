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

## PRIORITY — clean statement capture across every account

**Owner instruction, 2026-08-09.** Get a complete statement archive for all
accounts. Work it in this order, because the analytical value is very uneven.

### Tier 1 — the actual blind spot: credit cards

Statements are the **only** route to credit-card transactions. TD's card
download button produces no file; it was tested and returns nothing. Without
these, the spending on these cards is invisible in every category total.

| Card | Have | Need | Spending currently unseen |
|---|---|---|---|
| **TD Cash Back Visa** | 1 | **11** | $5,682 |
| **Travel Visa** | 1 | **11** | $1,078 |
| TD Personal Visa | 11 | 1 (Aug 2025) | — card is dormant |
| Triangle Mastercard | 5 | earlier months if held | — 5 months already analysed |

### Tier 2 — debts with no statements at all

MBNA (B10) · Amazon.ca Rewards Mastercard (B36) · American Express (B37).
Nothing is known about any of them. Any could outrank the 26.99% Cash Back Visa.

### Tier 3 — chequing and savings statements

Wanted as part of a complete archive. Transaction data for these accounts is
already held as 18-month CSV exports, so this is about the archive rather than
the spending picture.

What the statements add beyond the exports:

- **Fee detail** broken out per period, feeding the fees dashboard (B30) and the
  account-plan review (B24) — fees are currently inferred from transaction
  descriptions
- **Interest and overdraft rate** summaries, including the Chequing B overdraft
  rate still unknown (B23)
- A **canonical record for an accountant**, who will generally want statements
  rather than exports

12 months per account: Chequing A, Chequing B, EMERGENCY SAVING, DEBT&PAYMENTS,
SAVINGS-DONT TOUCH, plus HELOC and mortgage statements.

### Definition of done

Statement capture is complete when both TD cards hold 12 months, MBNA is
captured, the Amazon Mastercard and Amex are captured or confirmed closed, and
each chequing and savings account holds 12 months for the fee and interest
detail.

**Naming convention:** `raw/statements-<institution>/<account>_<YYYY-MM-DD>.pdf`,
where the date is the **statement date read from inside the file**, never the
one implied by the download order. `scripts/rename-statements.js` verifies and
corrects this — the TD download loop was off by one and mislabelled all twelve
files, which was only caught by decrypting each and checking.

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

**B10 · MBNA Mastercard** · **START HERE** · *small*
The owner has this ready to hand over. Paid from DEBT&PAYMENTS at $300 a time,
five times across the window. **No balance, no rate, no limit, no due date.**

Capture: balance · interest rate (purchases and cash) · credit limit · available
credit · minimum payment · payment due date · statement date · and 12 months of
statements if available.

**Why it goes first:** it is the only remaining debt likely to be *large enough
and dear enough* to reorder the payoff plan. The current top target is the TD
Cash Back Visa at 26.99%. MBNA rates commonly run 19.99–25.99%, but promotional
and penalty rates reach higher. Until it is known, any payoff advice is
provisional.

**B11 · Flexiti** · **CLOSED 2026-08-09 — paid off and account closed**
Owner-confirmed. **$2,654.28 was paid across the window** ($1,354.28 and
$1,000.00 single payments plus $300.00 instalments, all from DEBT&PAYMENTS).
Remove from the debt list; no balance, no rate and no due date to obtain.

**B35 · Second PayPal account** · **DONE 2026-08-09**
Captured: balance $0.00, six linked cards, eight automatic payments, and 152
transactions for Mar–Jul 2026. **Not a business account** — no sales revenue;
all incoming is card funding. Dominant spend is **Instacart at ~$1,140/month**.
Raw export in `raw/paypal2/`.

**B36 · Amazon.ca Rewards Mastercard — entirely unknown** · BLOCKED · *small*
Surfaced only as a card linked to the second PayPal account (••••54). **No
balance, no rate, no limit, no statements, no due date.** It receives no payments
from any chequing account captured, so it is either serviced from an account not
yet seen or carries a balance nobody has mentioned.

**B37 · American Express — entirely unknown** · BLOCKED · *small*
Same situation (••••07). Amex rates are typically high, so this could
meaningfully change the payoff ranking.

**B38 · PayPal #2 — reconcile authorisations against settlements** · READY · *small*
Outgoing sums to $8,424.17 but `General Authorization` rows ($5,246.53) are
pre-authorisations that settle separately. Settled spend is nearer $2,717 and
card funding was $2,864.65. The same correction was applied to the first
account; apply it here so the spending figure is not overstated by a third.

**B39 · PayPal #2 — history before March 2026** · READY · *small*
Only five months captured. This account offers a maximum of a six-month preset
with no custom range, so earlier periods need successive reports.

**B40 · Fold Instacart and delivery spending into the spending picture** · QUEUED *(on B38)* · *medium*
~$1,400/month across Instacart, Uber and Uber Eats on PayPal #2 alone, none of
it currently in any category total. Large enough to move the household spending
figure materially, and it overlaps with the groceries category already counted
from chequing — **check for double-counting before adding**.

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

## Requested features

**B29 · Payment and statement calendar, subscribable in iCal** · READY · *medium*

A published `.ics` feed the household can subscribe to, carrying two kinds of
event: **payment due dates** and **statement-ready dates** (the latter being the
prompt to send new statements over).

Serve it from the site as `/calendar.ics` behind the same password, so it stays
private but subscribable. Google Calendar and Apple Calendar both accept a URL
subscription; a shared Google Calendar would mean putting due dates in a
third-party account, so the self-hosted feed is preferable.

Known cycles — enough to build most of it today:

| Account | Statement | Payment due |
|---|---|---|
| Mortgage | — | **bi-weekly**, next 14 Aug 2026 |
| HELOC | monthly | **21st** |
| TD Personal Visa | ~**23rd** | **17th** |
| TD Cash Back Visa | cycle 8th→**7th** | **1st** |
| Travel Visa | cycle 6th→**5th** | **26th** |
| Triangle Mastercard | **17th** | **7th** |
| MBNA, Flexiti | unknown | unknown — blocked on B10/B11 |

Statement-ready events should fall a day or two **after** each statement date,
so the document exists when the reminder fires.

**B30 · Fees dashboard on the site** · QUEUED *(on B23, B24)* · *medium*

Every fee, its source, its amount and its frequency — because fees are the most
avoidable cost in the picture and are currently scattered across accounts.

Already identified: monthly account fees ~$17.67 across two accounts and $3.95
on DEBT&PAYMENTS · overdraft protection $5.00/month · **42 NSF fees at $5.00** ·
overdraft interest every month · withdrawal fees · cheque-return $2.00 ·
e-transfer $1.00 · **over-limit $29.00** on the Cash Back Visa · foreign-exchange
costs on US$1,744 of Travel Visa charges.

Show avoidable separately from structural, since that is the actionable split.

**B31 · Transfer tracing between accounts** · READY · *medium* · **feasibility proven**

TD stamps each transfer with a five-character reference (e.g. `UT564`) that
appears on **both** legs. Verified across 4,655 transactions: **1,465 coded
transfers, 635 fully matched pairs, zero mismatches — a 100% match rate.**

Build a matched-transfer ledger so every internal movement is traced end to end
rather than inferred, and so no transfer is ever double-counted as income or
spending.

**176 transfers have only one leg captured** — their counterpart sits in an
account not yet in the set. Worth listing: it may reveal accounts nobody has
mentioned.

**B32 · Interest dashboard on the site** · QUEUED *(on B6, B7, B10, B11)* · *medium*

Monthly interest split by debt, with the rate and the charge date for each.
Roughly **$2,879/month** on known debts today:

| Debt | Rate | ~Monthly interest | Charged |
|---|---|---|---|
| Mortgage | 3.64% | ~$1,620 | daily, with each payment |
| HELOC | 4.90% | ~$823 | month end |
| Triangle Mastercard | 21.99% | ~$240 | statement date, 17th |
| TD Cash Back Visa | 26.99% | **$158.55** | statement date, 7th |
| TD Personal Visa | 24.99% | $37.51 | statement date, ~23rd |
| Travel Visa | 19.99% | unknown | statement date, ~5th |

Seeing it beside income makes the cost legible in a way a balance never does.

**B33 · Statement archive folder** · **DONE — and it must stay out of git**

It already exists: `raw/`, organised by source (`statements/`,
`statements-ctfs/`, `wife-td/statements/`, `paypal/`).

**To answer the question directly: yes to the folder, no to committing it.**
Statements carry full name, home address and partial card numbers. Once in git
history they are effectively permanent, and a private repo is one settings
change or one compromised account away from public. `raw/` is gitignored *and*
blocked by the pre-commit hook, which is the right arrangement.

Convention going forward:
`raw/statements-<institution>/<YYYY-MM-DD>-<account>.pdf`

**B34 · Transaction library — identify every unknown merchant** · READY · *large*

Build a growing dictionary mapping merchant strings to a real identity and
category, so the same unknown is never investigated twice and categorisation
improves month over month rather than starting fresh.

Currently unidentified: **~19% of spending (~$25,630)**, driven by TD truncating
merchant names to about 15 characters, plus PayPal appearing as a payment rail.

Proposed `docs/merchant-library.csv`: pattern · identity · category ·
essential/discretionary/business · confidence · first seen · last seen · notes.

Seed it from what is already known, then work the unknowns by size — the top 50
by dollar value will cover most of the gap. Some will need the household to
identify them; those become questions rather than backlog.

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
