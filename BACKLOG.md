# Backlog

**Work that can be done.** Questions only the household can answer live in
`docs/01_OPEN_QUESTIONS.md` — keep the two apart. If an item needs a human to
know something, it is a question. If it needs someone to *do* something, it
belongs here.

Status: `READY` — nothing blocking · `BLOCKED` — waiting on input ·
`QUEUED` — waiting on earlier capture · `DONE`

Last reviewed **2026-08-09**. Phase: **data capture**.

---

## The raw archive is backed up

**B45 · Back up `raw/` somewhere off this disk** · **DONE 2026-08-09**

`scripts/backup-raw.ps1` mirrors `raw/` into
`C:\Users\dnaud\OneDrive\atlas-financial-backup\raw`, under the owner's own
OneDrive account. First run verified: **30 files, 9.18 MB**, source and
destination matching on file count and byte count, with a SHA-256 `MANIFEST.txt`
written into the backup so a later run can prove the copy is intact rather than
merely present.

It also copies `scripts/local-config.json`, which is gitignored for the same
reason and was equally unbacked-up.

Run it after every capture session:

```
powershell -ExecutionPolicy Bypass -File scripts\backup-raw.ps1
```

Design notes worth keeping:

- **It is a mirror.** A file deleted from `raw/` is deleted from the backup next
  run. Two guards sit in front of that: it refuses to run against an empty
  source, and refuses to mirror deletions if the source has lost more than 20%
  of its files unless `-Force` is passed.
- **Read-only against `raw/`.** Nothing in the source is touched.
- The source path is resolved through `git rev-parse --git-common-dir`, so it
  backs up the main working tree's `raw/` even when run from a worktree.
- It exits 0 on success — robocopy's own exit code 1 ("files copied") would
  otherwise read as a failure to any scheduler.

**Still open:** the run is manual. Registering a Windows scheduled task would
make it automatic — that is a persistent machine change and is the owner's call.

**Never solve this by committing `raw/` to git.** It carries full name, home
address and partial card numbers, and git history is effectively permanent.

---

## Published figures are current

**B1 · Update `data.json` and `docs/positions.csv`** · **DONE 2026-08-09**

Both now carry the spouse's accounts, the MBNA card and her employment income.
Every total was checked to reconcile against its own components before
publishing.

| | Was shown | Now |
|---|---|---|
| Household cash | $449.84 | **$2,915.89** |
| Credit-card debt | $1,799.97 | **$29,912.83** across five cards |
| Known total debt | $762,910 | **$777,525.57** |
| Interest per year | $32,649 | **$36,546.11** — about $3,046/month |
| Her employment income | absent | **$63,129.47 over 18 months** |
| Weeks of essentials covered | 2.5 | **6.1** |

Three judgement calls worth recording:

- **The $21,700 spousal transfer was removed as an income line.** It is an
  internal movement out of her Tennis BC pay; counting both double-counts it.
  Total income is $306,760.03, not $328,460.
- **The Cash Back Visa is published at $5,682.43**, its statement balance, with
  the owner-stated $69.93 payment noted but not netted off — every published
  figure stays traceable to a statement.
- **Flexiti is removed** rather than shown at zero, per its closure.

**`docs/00_MASTER_PICTURE.md` is now the stale document.** Its section 0 has been
brought up to date because it is the actionable part; sections 1 onward still
describe the pre-9-August picture and are rebuilt under B17.

---

---

## PRIORITY — clean statement capture across every account

**Owner instruction, 2026-08-09.** Get a complete statement archive for all
accounts. Work it in this order, because the analytical value is very uneven.

### Tier 1 — the actual blind spot: credit cards

> **Two corrections, 2026-08-09.** Statements are **not** the only route to
> credit-card transactions — the card's **Activity** tab lists posted
> transactions grouped by statement period, with each period's balance, minimum
> and due date. And TD's download does work; the file simply saves with a GUID
> `.tmp` name carrying no date, which is what `rename-statements.js` is for.
>
> **COMPLETED 2026-08-09.** Both cards now hold **12 of 12**, Sep 2025 – Aug
> 2026, in `raw/wife-td/statements/`. All 24 filenames were verified against the
> statement date read from inside each file — every one correct, no duplicates.
> Backed up: `raw/` is now 68 files, 22.06 MB.

| Card | Have | Need | Status |
|---|---|---|---|
| **TD Cash Back Visa** | **12** | — | ✅ complete |
| **Travel Visa** | **12** | — | ✅ complete |
| TD Personal Visa | 11 | 1 (Aug 2025) | **retrievable** — not aged out (B26) |
| Triangle Mastercard | 5 | earlier months if held | 5 months already analysed |

**What worked, after two false starts.** Do not call `documentdetail` directly —
it 400s even with a byte-identical key, and repeated attempts put the whole
EasyWeb session into an error state that took a cooldown to clear. The reliable
route is: Statements & Documents → click the row → read the PDF off the
`embed[src^="blob:"]` → save it under a real name → close the modal → pause.
Batches of three with ~1s between were comfortable. The account dropdown on that
page also lists **every** chequing, savings, mortgage and HELOC account, so
Tier 3 can be worked from the same screen.

**B48 · Wise — two US spending accounts** · **CAPTURED 2026-08-09**
Opened 19 and 22 July 2026 for the US road trip. Both **prepaid — no credit
facility, no rate, no debt.** 107 transactions captured, US$2,740.15 of card
spend, roughly C$206 left. `scripts/wise.js` parses the export.

**The funding is the finding: $3,500 of the $4,181 that went in came from the
HELOC** at 4.90% — 84% of all funding, 97% of the bank-sourced part. Traced
transfer by transfer. **$3,500 of the previously unexplained e-transfers is now
explained**, cutting that item from $23,200 to $19,700.

**One transfer shows why the rest is hard.** On 24 July $1,000 left the HELOC,
landed in Chequing A, and was e-transferred onward the same day. On the chequing
statement it is an ordinary e-transfer; only the HELOC draw beside it reveals
the source. **This is almost certainly the pattern behind the $46,657 of
"credit card" transfers** — one intermediate hop breaks the trail. Worth
re-running the transfer-matching (B31) with multi-hop chains in mind.

**B50 · The road trip cost ≈ C$6,645** · **DONE 2026-08-09**
Owner-confirmed window 24 Jul – 4 Aug 2026, all USD spending in it being the
trip. `scripts/trip-cost.js` totals it across every card:
Wise **C$3,853.42** + fees C$117.61 · Travel Visa **C$2,505.43** ·
MBNA C$134.92 · Cash Back C$33.28.

**Cards cost about 3% more per dollar than Wise** — blended 1.4477 against
Wise's 1.4061.

**Two corrections came out of it.** The Travel Visa's US hotels were previously
read as Tennis BC work travel that gets reimbursed; the dates put all four inside
the family holiday, so **C$2,505.43 of holiday is sitting on a business-
designated card** and the reimbursement theory needs re-testing against a period
with no family travel (feeds B15). And the trip was **84% funded by the HELOC**
(B48) — so roughly C$3,500 of a C$6,645 holiday is now permanent interest-only
debt at 4.90%.

**B49 · Wise statements** · READY · *small*
Only activity CSVs were provided. Wise issues statements separately; capture
them for the archive.

**No business spending on Wise.** Wise tagged a US$5.96 `Home Depot` charge as
*Office expenses*; it was a bucket used as a cooler (owner-confirmed). Seed it
into the merchant library (B34) as a worked example: **issuer categories are a
hint, not a fact**, and an unchecked one would have put phantom business spending
into the Tier 1 business question.

### Tier 2 — debts with no statements at all

**MBNA / Amazon.ca Rewards Mastercard (B10, B36) — COMPLETE 2026-08-09.** One
card, not two. $7,855.12 against an $8,000 limit at 21.74%. All 8 statements
captured as PDF and CSV; this account's archive is finished.

**American Express (B37) — CLOSED 2026-08-09**, owner-confirmed. No balance, no
debt, nothing to capture.

**Every consumer debt in the household is now captured.** Mortgage, HELOC, five
credit cards, and two closed accounts (Amex, Flexiti). **Tier 2 is finished.**

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

**None of it is time-sensitive, and less so than previously thought.**
**TD retains statements for about seven years, not twelve months** — the year
filter offers 2020 through 2026, and the Cash Back Visa alone has 12 statements
in 2024, 12 in 2025 and 8 in 2026. Only the **18-month transaction window** is a
real constraint. Corrected 2026-08-09; see `docs/ACCOUNT_FACTS.md`.

> **Pace the statement work.** Calling `documentdetail` directly returns 400
> even with a valid key, and repeated attempts put the whole EasyWeb session
> into "We're sorry, due to technical issues…", ending it. Use the UI route —
> click the statement row, read the `blob:` URL off the `embed`, save it — and
> do not hammer the API.

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
| Personal Visa | ✅ | ✅ 24.99% | via statements | ⚠️ 11 of 12 — **retrievable, see below** |
| **Cash Back Visa** | ✅ | ✅ 26.99% | via statements | ✅ **12 of 12** |
| **Travel Visa** | ✅ $1,100 limit | ✅ 19.99% | via statements | ✅ **12 of 12** |
| RESP (WebBroker) | balance only | — | ❌ | blocked |

**TD retains ~7 years of statements, not 12 months.** The year filter offers
2020–2026. Nothing is aging out, and **B26's "may have aged out" concern was
unfounded** — the Personal Visa's missing August 2025 statement should still be
there. Method and endpoints are in `docs/ACCOUNT_FACTS.md`.

### Outstanding items

**B2 · Cash Back Visa — 11 remaining statements** · **DONE 2026-08-09** — 12 of 12
**B4 · Travel Visa — 11 remaining statements** · **DONE 2026-08-09** — 12 of 12

**B3 · Cash Back Visa transaction history** · **DONE 2026-08-09**
**B4b · Travel Visa transaction history** · **DONE 2026-08-09**
**B47 · Fold MBNA transactions in** · **PARSED 2026-08-09**

`scripts/card-transactions.js` parses all 24 TD statements and 8 MBNA CSVs into
`derived/card-transactions.csv` — **635 transactions**, reconciled by eight
independent checks that all pass to the cent.

**$54,344.58 of card purchases over twelve months, essentially none of it in any
category total.** The estimate of "$6,760 of unseen card spending" was low by
roughly eight times; it was based on card *balances*, and balances say nothing
about throughput on a card that is paid off and reused.

Two traps found and guarded in the script:

- **MBNA's sign convention is the mirror of TD's** — payments positive, purchases
  negative. Unnoticed it inverts the card entirely.
- **`INTEREST REFUND` is an interest adjustment, not a merchant refund.** Netting
  it in the wrong bucket threw two totals out by exactly $0.18 — small, but it is
  what stopped the reconciliation passing, and a reconciliation that is "nearly
  right" is worth nothing.

**B52 · The $10,000 Ivoclar Vivadent charge** · **ANSWERED 2026-08-09**
Amanda's father put the money on the card and a machine for the business was
bought with it immediately. **Not household money.** The payments confirm it —
$1,700 on 12 Nov and $3,000 plus $8,000 on 25 Nov, driving the card deep into
credit before the 5 Dec purchase drew it back.

**Both sides come out of the household figures.** Card purchases fall
$53,959.75 → **$43,959.75**; Travel Visa $33,643.75 → **$23,643.75**. Which of
the three payments were his is not separable from the statements — $12,700 in
against $10,000 out, so roughly $2,700 may be ordinary household payment [ASK].

**A wrong inference is recorded and withdrawn.** This item previously concluded
the credit limit "must have been cut hard", probably by TD as a risk action.
Prepaying a card creates room without any limit change, which is what happened.
There is no evidence of an issuer action, and whether the limit ever differed
from $1,100 is unknown. **The lesson is general: an implausible transaction is a
prompt to ask, not a licence to infer a cause.**

**B53 · `Head Canada Inc.` $1,043.37** · BLOCKED — needs the household · *small*
Racquet-sports equipment, Guelph. Sits alongside RacquetGuys on PayPal and
Amanda's Tennis BC employment. Possible inventory purchase, which would make it
the first concrete evidence for the business question.

**B6 · Travel Visa — credit limit** · **DONE 2026-08-09 — $1,100.00**
Confirmed absent from all 12 statements: the Travel Visa template carries no
credit limit and no rate table, unlike the Cash Back template. Read instead from
the card's **Manage** tab.

**It is the smallest limit in the household and the card is about to go over.**
$1,078.31 of $1,100.00 is 98.0%, with **$165.13 pending** that takes it to
$1,243.44 — **$143.44 over** [calculated]. On the Cash Back Visa's evidence,
going over means an over-limit fee and the excess becoming immediately due,
which turned a $69.93 minimum into $762.36. The Travel Visa minimum is currently
$17.00.

The pending charges are four `AMZN Mktp CA` purchases dated 6–8 Aug — Amazon
spending on the card TD designates as *business*. Feeds the business question.

**B7 · Reconcile the $158.55 interest charge** · READY · *small*

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

**B26 · Personal Visa — the August 2025 statement** · READY · *small*
One of twelve downloads returned a duplicate of June 2026, so August 2025 was
never retrieved. **It has not aged out** — TD holds roughly seven years, so it
is still there. Select period 2025 rather than "Last 12 Months".

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

## 🔴 An unlisted asset and a phishing campaign

**B59 · Capture the Coinbase account** · BLOCKED — needs the owner · *small*
Found via email, 2026-08-09. **Absent from the picture entirely.** Monthly
statements were still being issued in June 2026, and 2025 annual performance and
charges reports exist. A **CA$1,950.50** withdrawal on 8 Jun 2025 (plus a
CA$19.70 fee) matches `E-TRANSFER ***TeT` into Chequing A the next day exactly —
a transaction that had been sitting unexplained.

**Holdings unknown.** A withdrawal says nothing about the remaining balance.
This is the first asset outside TD and Wise, so **net worth is understated by an
unknown amount**. Statements are downloadable from the Coinbase account.

**B60 · Phishing against the Coinbase account** · **owner action** · *small*
Two emails from **`info@afius.org`** styled as Coinbase, "Your Coinbase
verification code", on 24 May and 11 Jun 2025 — **both carrying the identical
code 523469**, which a genuine one-time code never does. `afius.org` is not a
Coinbase domain.

The 8 Jun 2025 withdrawal sits between the two. No evidence it was unauthorised,
but worth confirming with Coinbase directly, and the account wants a unique
password plus app-based 2FA. **This is the owner's action, not an agent's.**

**B62 · Youth lacrosse is understated** · READY · *medium*
Owner-confirmed: Pro Caliber Lacrosse Academy and Fusion West are the boys'
clubs; Venom Custom Sticks was a stick. Identified so far: **$2,546.26 on cards**
plus **$1,612.00 of e-transfers found via Interac emails**.

**Chequing merchant-matching finds $0.00** — every lacrosse pattern returns
nothing, because e-transfers carry no payee name. Clubs prefer e-transfer, so
**youth sport is systematically understated in any analysis built on bank
exports**. Mailbox context: $400/player team fees, several teams, and a
Pro Caliber roster travelling to Texas with its own fee schedule.

Worth totalling properly — it is a committed annual cost that budgeting has never
seen in full.

**B61 · E-transfer counterparties** · PARTIAL · *medium*
TD's export never names the other side — `SEND E-TFR ***GCa` and nothing more.
**Interac's confirmation emails do**, in the subject line, but only **~11 of the
~207** transfers in the window have one in this mailbox: auto-deposits generate
none, and the rest appear to notify **Amanda's address**. **None of the large
coaching receipts are here**, consistent with her being the payee. Attribution
needs her inbox or her bookkeeping.

## 🔴 Pass-through money went onto the HELOC

**B63 · Where do the coach payments leave from?** · BLOCKED — needs the household · *small*

**Answered:** Lavinio Cavalcante remits Amanda's coaching income and she pays her
coaches out of it (owner-confirmed). So the large e-transfers are coaching money,
arriving aggregated from one remitter. **They are pass-through, not household
income** — a share of each is owed onward.

**The open part:** the 30 June remittance of **$9,646.25** went **onto the HELOC
the same day**, in full, via SAVINGS-DONT TOUCH. **No coach payments appear in
either mailbox afterwards.**

Three explanations, with very different consequences:

1. **She pays from an account not yet captured.** Most likely — and there is
   direct evidence one exists: on 14 July her mailbox shows **$186.16 received
   under her own full legal name**, i.e. from herself, elsewhere. **This may be
   one of the two unidentified accounts** [B64].
2. **Coaches were paid earlier or on a lag**, and this tranche covered a settled
   period.
3. **They have not been paid from this money** — in which case there is an
   **unrecorded liability**, spent on a facility that does not amortise and
   cannot be drawn back without re-borrowing.

**Nothing in the data says which.** Worth answering before the next remittance
lands: using pass-through money for household debt is only safe if the onward
obligation is already covered.

**B64 · Amanda's other account** · BLOCKED · *small*
The $186.16 self-transfer on 14 Jul 2026 proves she holds an account outside the
captured set. Prime candidate for where coach payments leave from, and a prime
candidate for one of the **two unidentified accounts** ($59,027 combined) — the
larger of which sent $33,598 across **142** transfers, a frequency that fits
paying a roster of coaches far better than it fits anything else considered so
far.

## 🔴 Income is overstated — the biggest open item

**B55 · Amanda's coaching bookkeeping** · **RECEIVED AND PARSED 2026-08-09**

Two workbooks supplied. `scripts/xlsx.js` reads them (a minimal ZIP+XML reader —
no Python on this machine and Node has no unzip, so the same
build-a-small-reader approach as the PDF decryptors).

| | Term | Summer | Combined |
|---|---|---|---|
| Revenue | $11,970.00 | $11,100.00 | **$23,070.00** |
| **Coach payroll** | **$5,067.50** | **$1,330.00** | **$6,397.50** |
| Retained | | | **$16,672.50** |

**Coaches take ~27.7%; ~72% is retained.** Applying that to the $42,395 of large
receipts implies about **$11,700 owed onward, $30,700 retained** — roughly
**$1,700/month** of real coaching income against the $2,355 the gross implied.

**Income was overstated by about $650/month, not the $1,650 upper bound.** The
correction is real but much smaller than the uncertainty was.

Coaches are paid a **day rate** ($30–$95), not a share, so margin scales with
class size — Orange Try at 10 players made $980; Red Improve at 4 players **lost
$95**. **Amanda draws no coach pay**, so her return is the retained margin.

*Caveats recorded in `ACCOUNT_FACTS.md`: both Dashboards show `#REF!` and a stale
$5,580 revenue figure; the summer class sheet has six of ten classes with no
coach cost entered, overstating its $9,822.50 "profit"; one row has shifted
columns. And the workbooks total $23,070 against $42,395 of large bank receipts,
so they are a subset of the window.*

**B55b · Reconcile the sheets against the bank** · READY · *small*
$23,070 tracked versus $42,395 received. Either earlier terms are missing or
revenue arrives that the sheets do not track. Worth resolving before the 27.7%
share is treated as settled.

**B55-old · Get Amanda's coaching bookkeeping** · was BLOCKED

**The coaching receipts are revenue, not income.** She pays her coaches out of
them, so the household keeps only the margin. Every published income figure
treats the gross as household money.

Coach payments **cannot be separated from personal transfers** in the bank data:
113 outgoing e-transfers totalling **$29,762.42** over 18 months, with no
payroll-shaped pattern — the commonest amounts are $100 (×8) and $60 (×7), which
is family-sized rather than payroll-sized.

**Bounds:** coach payments are between **$0 and $29,762**, so household income is
overstated by up to **~$1,650/month**. That is now the largest uncertainty in the
picture — bigger than any remaining unexplained flow, and it undercuts every
conclusion that rests on income.

Needed: coaching revenue, coach payments, and any other business costs.

**B56 · Separate the two businesses** · BLOCKED · *medium*
The Tier 1 question has been asking about both at once:

| | Whose | What |
|---|---|---|
| **Dental lab** | her parents' | in the garage; paid rent to May 2026; "not going well" |
| **Coaching** | Amanda's | paid by e-transfer, ~$42,395 of large receipts |

`Head Canada Inc.` $1,043.37 is a **coaching business expense Amanda absorbs
personally** (owner-confirmed) — so business costs sit on household cards, which
is exactly what makes profitability unreadable.

**B57 · The garage rent — returning, and what it implies** · BLOCKED · *small*
$1,000–1,100/month from Mar 2025, stopped May 2026. **$12,600/year gone**, and
because it was misfiled as an internal transfer its loss never registered as an
income event. Business use of the home may also affect insurance and creates both
a possible deduction and a capital-gains exposure — worth an accountant's view
before the May 2027 renewal.

**B58 · The five cheques — $8,150** · BLOCKED · *small*
$3,010 (15 Jul 2025) · $2,835 (9 Sep 2025) · $1,295 (19 Nov 2025) · $980
(18 Feb 2025) · $30 (27 Oct 2025). The owner does not recall them and asked for
an email search. **There is no email connector available**, and a Drive full-text
search on the bare amounts returns only noise — numbers that short match
anything. Options: connect an email tool, search the inbox by amount manually, or
ask TD for cheque images, which is the definitive route.

## Blocked on the household

These need someone to obtain or decide something. The corresponding *questions*
are in `docs/01_OPEN_QUESTIONS.md`.

**B10 · MBNA Mastercard** · **MOSTLY DONE 2026-08-09 — rate outstanding**
**B36 · Amazon.ca Rewards Mastercard** · **CLOSED 2026-08-09 — same card as B10**

**They were one debt counted twice.** The MBNA account *is* the Amazon.ca
Rewards Mastercard, …6454, the card that surfaced from PayPal as `••••54`. The
link was missed because the chequing payments name the issuer ("MBNA") and the
card names the retailer.

Captured: balance **$7,855.12** · limit **$8,000.00** · available **$62.83** ·
pending $82.05 · minimum **$158.27** due **31 Aug 2026** · statement closing
**6th**. No Payment Plans, so no instalment balance behind it. Full detail in
`docs/ACCOUNT_FACTS.md`.

**This is the largest card debt in the household** — on its own it slightly
exceeds the $7,482.40 previously believed to be the *total* across all cards.

**Rate captured: 21.74% purchases, 22.99% cash advances and balance transfers.**
The entire balance sits in the purchase bucket — no cash-advance component.
21.74% is the *second-lowest* card rate in the household. The problem with this
card is not its rate; it is that the balance went from **$0.00 to $7,855.12 in
eight months** on $9,930 of purchases against $2,970 of payments.

Two further findings:

- **The account is new.** 8 statements exist, Jan–Aug 2026; 2025 returns
  "No Activity". There is no earlier history to capture, so this account is
  complete at 8 rather than 12.
- **MBNA retains 7 years of PDFs** and 13 billing months of CSV/QFX. The CSV is
  a direct transaction export, so this card needs no PDF parsing for
  transactions — unlike TD, whose card download button returns nothing.

**B46 · MBNA statement archive** · **DONE 2026-08-09**
All 8 statements captured as **PDF and CSV** into `raw/statements-mbna/`, backed
up, and parsed. Filenames verified against the closing date inside each file by
`rename-statements.js` — no correction needed this time, because the dates came
from MBNA's own statement list rather than a download order.

The RC4-128 decryptor written for TD read MBNA's PDFs unchanged, which is
unsurprising — MBNA is a TD Bank Group brand. `scripts/mbna.js` turns the
decrypted text into `derived/mbna/summary.csv`.

Operational notes are in `docs/ACCOUNT_FACTS.md`: the download endpoints, the
fact that the visible Download button fires no request at all, and that
**downloads silently never reach disk while the browser pane is hidden** while
`fetch` still returns 200 with the full body.

**B47 · Fold the MBNA transactions into the spending picture** · READY · *medium*
8 CSVs of transactions are now held and nothing has been done with them. This is
$9,930 of purchases entirely absent from every category total — larger than the
$6,760 of unseen TD card spending that Tier 1 is chasing.

Already visible from the August cycle alone: a **ChatGPT subscription**
(US$22.40) in no subscription list captured so far, and two `PAYPAL*PASTINI` charges
matching the Oregon trip already seen on the Travel Visa and PayPal #2 — **one
trip across three cards**. Check for double-counting against PayPal before
adding, exactly as B40 requires.

**B11 · Flexiti** · **CLOSED 2026-08-09 — paid off and account closed**
Owner-confirmed. **$2,654.28 was paid across the window** ($1,354.28 and
$1,000.00 single payments plus $300.00 instalments, all from DEBT&PAYMENTS).
Remove from the debt list; no balance, no rate and no due date to obtain.

**B35 · Second PayPal account** · **DONE 2026-08-09**
Captured: balance $0.00, six linked cards, eight automatic payments, and 152
transactions for Mar–Jul 2026. **Not a business account** — no sales revenue;
all incoming is card funding. Dominant spend is **Instacart at ~$1,140/month**.
Raw export in `raw/paypal2/`.

**B36 · Amazon.ca Rewards Mastercard** · **CLOSED 2026-08-09 — it is the MBNA
card.** See B10 above.

**B37 · American Express** · **CLOSED 2026-08-09 — owner-confirmed**
No balance, no rate, no due date, nothing to obtain. Excluded from the debt list
and from net worth.

The two things that made it look suspicious both have innocent explanations: it
received payments from no chequing account **because there was nothing to pay**,
and it stayed on PayPal's linked-card list because a linked card is a stored
credential rather than evidence of a live account. Worth remembering the next
time a card surfaces from a payment processor's list — **presence there is not
evidence the account is open**.

**This gap now looks materially riskier.** The other unknown card linked to
PayPal — the Amazon Mastercard — turned out to hold **$7,855.12**. The same
reasoning that made that one look minor applies here, and it was wrong once.

**B41 · PayPal #2 — Pay in 4 status** · **RESOLVED 2026-08-09 — no facility found**
Checked. **No Pay-in-4 panel and no related link exists on this account**, where
the first account displays one explicitly. Strong evidence the facility is not
active here, so no hidden instalment debt. Recorded as a negative inference
rather than a confirmed zero — if a Pay Later hub becomes reachable, confirm.

**B42 · PayPal #2 — per-subscription amounts and next billing dates** · READY · *small*
**Ten** automatic payments, known by name only — no amounts, no billing dates:

Canva · DoorDash · Instacart · MailChimp · Parking Corporation of Vancouver ·
RacquetGuys · Sephora USA · Starbucks · **Truly Free Inc** · **Uber Technologies**

The last two only appeared after expanding the list twice, so **always exhaust
"See more" before treating an autopay list as complete** — the same caution
applies to the first account, where 16 were recorded and the list may also have
been truncated.

Clicking a merchant row did not open its detail pane via script; the amounts
likely need real clicks or a different selector. Same gap as B9.

Note RacquetGuys has not billed once in the five months captured — worth seeing
when it last did.

**B43 · PayPal #2 — confirm account type** · BLOCKED · *small*
Inferred as personal from its transactions, but not verified. If it is a
**business** account, that bears on the business question and on how its
spending should be classified.

**B38 · PayPal #2 — reconcile authorisations against settlements** · READY · *small*
Outgoing sums to $8,424.17 but `General Authorization` rows ($5,246.53) are
pre-authorisations that settle separately. Settled spend is nearer $2,717 and
card funding was $2,864.65. The same correction was applied to the first
account; apply it here so the spending figure is not overstated by a third.

**B39 · PayPal #2 — history before March 2026** · READY · *small*
Only five months captured. This account offers a maximum of a six-month preset
with no custom range, so earlier periods need successive reports.

**B44 · PayPal statement archive — use PDF activity reports** · READY · *small*
**PayPal issues no monthly statements.** The Reports page offers only *Activity
download* and *Tax documents*. There is no statement section on either account.

For the statement archive, the equivalent is an **activity report generated in
PDF format** — the Create Report form offers CSV, TAB, **PDF**, Quickbooks and
Quicken. Generate one PDF per period alongside the CSV already held, so the
archive has a human-readable record to sit beside the machine-readable one.

Reports are generated server-side and take a minute or two before the Download
button appears. Both accounts have been captured as CSV only.

**Tax documents: none.** Checked on account #2 — the Form 1099-K section reads
"Nothing to show here yet!". No tax slips have been issued, which is consistent
with the finding that no sales revenue passes through the account. Worth
checking the same section on account #1.

**B40 · Fold Instacart and delivery spending into the spending picture** · QUEUED *(on B38)* · *medium*
~$1,400/month across Instacart, Uber and Uber Eats on PayPal #2 alone, none of
it currently in any category total. Large enough to move the household spending
figure materially, and it overlaps with the groceries category already counted
from chequing — **check for double-counting before adding**.

**B12 · Home valuation** · **ANSWERED 2026-08-09 — $1.1m to $1.4m** [ESTIMATE]
Owner's estimate, not an appraisal. **Household net worth is now estimable at
roughly $357,000 to $657,000**, and loan-to-value on the $747,612.74 secured
against the house is **68.0% at the low end, 53.4% at the high** — both under the
80% that matters at renewal.

**The household is not insolvent and never was.** It holds substantial equity.
The problem is liquidity and structure: $777,455 of debt against $3,051 of cash,
every revolving facility at or beyond its limit, $36,546/yr of interest.

**B51 · Narrow the valuation range** · READY · *small*
A $300,000 spread is wide enough to matter for renewal planning. A realtor's
opinion or a recent comparable sale would tighten it cheaply. A lender will order
its own appraisal regardless, so this is for planning rather than for reliance.

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

**B17 · Rebuild net worth and the debt ranking** · **DONE 2026-08-09**
`scripts/payoff.js` computes it from `data.json`. Cards total **$29,842.83** at
**$7,227.39/yr — $602.28/month**. Net worth stated at **$357k–$657k**.

**The headline finding is a fee, not a rate.** The Cash Back Visa is $612.43 over
its limit, costing **$29/month = $348/yr**. Paying $612.43 stops it — a **56.8%
annual return**, against a dearest interest rate of 26.99%. Nothing else
available returns close, and the fee recurs each statement on the 7th.

Second: the personal Visa's **24.99% is a penalty**; 12 consecutive on-time
minimums of $94.03 restore **17.20%**, worth $140.22/yr for payments already
owed. The count is at zero after the July miss.

Third: **rate ranking and dollar ranking disagree.** Cash Back leads on rate;
**Triangle leads on dollars at $2,880/yr**. But Triangle's problem is behavioural
— $3,880 paid over five statements moved the balance $189 because ~$498/month of
new purchases offset it. Paying it down without stopping the spending achieves
almost nothing.

**Consolidation into the HELOC is unavailable** — 99.5% drawn, $1,067.84 left.

*(Superseded item below kept for its dependency history.)*
**B17-old · Rebuild net worth and the debt ranking** · was QUEUED *(on B1, B10, B11, B12)*
The ranking already changed once — the Cash Back Visa at 26.99% displaced
Triangle as the most expensive debt. MBNA and Flexiti could change it again.

**B18 · The $46,657 "TFR-TO C/C"** · **RESOLVED 2026-08-09 — they paid the cards**

The working theory was the Cash Back Visa. **It was mostly the Travel Visa.**

Over the twelve-month statement window the cards received **$55,178.02** —
Travel Visa $33,696.18, Cash Back $11,879.50, personal Visa $6,632.34, MBNA
$2,970.00 — against **$39,875.43** of `TFR-TO C/C` leaving the accounts. The
cards received **$15,302.59 more** than those transfers sent, the rest arriving
by other routes including direct HELOC payments.

**Nothing was hiding.** The flow looked unexplained only because one of five
cards was visible, and it took just $6,632 of it. No undisclosed card, no
leakage, and the hypothesis that this would expose a debt missing from the
ranking is disproved.

**The general lesson:** the anomaly was never in the data, it was in the
coverage. A flow that "goes nowhere" usually means an account nobody has looked
at yet — worth remembering for the two unidentified accounts, which are now the
largest unexplained item at $59,027.

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

**B54 · Card spending categorised** · **DONE 2026-08-09**
`scripts/categorise-cards.js` → `derived/card-spending.csv`. **$44,344.58 across
484 purchases, $3,695/month**, with **only 4.5% uncategorised** against 19% on
the chequing side — card statements carry full merchant names where TD's
chequing export truncates them to ~15 characters.

**Discretionary is $28,653.44, about $2,388/month — 65% of card spending.**
Travel $10,363 · Shopping $8,402 · Restaurants $4,470 · Sport & fitness $3,692 ·
Subscriptions $1,004 · Entertainment $722. This is the spending that was
invisible while every facility ran to its limit, and it is the most addressable
part of the picture.

A parsing note worth keeping: **merchant strings must be normalised before
matching.** TD strips spaces and MBNA keeps them, so one merchant arrives as both
`BELLMOBILITYVERDUN` and `BELL MOBILITY VERDUN QC`. Matching raw strings splits a
merchant in two and understates every total it touches. Rules are ordered, so
`UBEREATS` must be tested before `UBER` or every meal becomes transport.

**B34 · Transaction library** · **SEEDED 2026-08-09** — `docs/merchant-library.csv`,
**201 patterns across 13 categories**, generated from the rule table rather than
guessed. Extend it as new merchants appear; the chequing side (19% unknown) is
where it will pay off next.

**B34 (original scope) · identify every unknown merchant** · READY · *large*

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
