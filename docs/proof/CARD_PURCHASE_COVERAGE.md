# Card purchase coverage: local candidate and independent oracle

This is a synthetic-only candidate, not production household facts or a
deployment claim. Parent authorized replacing #491's inferred split with one
evidence-qualified ledger and immediate cash protection. No transaction,
account, canonical amount, baseline or credential was changed.

## State and coordination boundary

The takeover began at #491 head 3f805ee19467f0bbb5dae84b2314170e4e738fec.
Both that history and the later remote head
83eda4aa7b3ba561f56e12ab472235980c19f1d9 are preserved in the local candidate.
Checkpoint 72024e5715745908937d307cff43ae0e8245f4ad implemented the explicit
ledger; merge a1a5a77 reconciled the changed remote. Local merge
c7276c5edc5cb046b1fa471bd52db48e676aee7a incorporated main
feb40019a931fe93ab18fccf6290886920c41d7a, including #492 native-unit guards.
Subsequent consumer/fixture repairs are recorded in the next commit. The
exact tested head and results belong in the evidence manifest and PR record;
this document cannot embed its own future commit SHA.

Parent has held publication while coordinating the changed remote. Nothing
has been pushed over it, no competing PR was created, and no merge is
requested. Parent owns the separate UI follow-up and independent Systems
review.

## Independent supplied-dollar oracle

The fixture supplies Bills 500, prior card debt 400, groceries allowance 150,
scheduled minimum 25 and a confirmed empty coverage opening.

| Snapshot | Bills | Card debt | Groceries spent once | Uncovered | Available after minimum, remaining groceries and coverage |
|---|---:|---:|---:|---:|---:|
| Before | 500 | 400 | 0 | 0 | 500 - 25 - 150 = 325 |
| Purchase 30 | 500 | 430 | 30 | 30 | 500 - 25 - 120 - 30 = 325 |
| Confirmed backfill 10 | 490 | 420 | 30 | 20 | 490 - 25 - 120 - 20 = 325 |
| Confirmed 25 split: 20 backfill, 5 prior debt | 465 | 395 | 30 | 0 | 465 - 25 - 120 = 320 |

The $20/$5 split is an explicitly supplied invented intent record. Amount,
date and payment payee cannot establish it. Without that intent or its unique
posted Bills debit/card credit, precise funding is unavailable and no split
is published. The scheduled minimum stays reserved. Existing exact
represented-events confirmation can separately prove issuer settlement.

Both original #491 and the changed 83eda4a remote label an unconfirmed $10
as backfill and drop the remaining $20 before labeling the next $25 as card
payment. Independent red controls are ../pr491-intent-red.log and
../pr491-83-intent-red.log. The latter exercises the exact changed remote
using invented CAD rows, with no Bills pair or intent supplied.

## Proposed input contract, exercised only in fixtures

Forecast.visaPaymentReconciliation retains its historical API name and owns
one ledger for mapped revolving cards. The observer supplies sanitized,
account-bound coverage references, native currency and provider-directed
replacement flags. References establish identity, never intent.

plan.cardPurchaseCoverage contains a confirmed CAD Bills opening with a
cutover date and explicit carried purchases (ref, accountId, date, amount,
covered). An empty opening is still an owner confirmation, not an inference
from a bounded fetch or a debt balance. A complete posted/pending observation
must cover that cutover through the financial as-of; the existing bounded
history cap is retained.

payments name unique debitRef and creditRef, confirmed purchase allocations
and an explicit otherAmount/otherPurpose. Allocations and the remainder must
conserve the whole posted pair in exact cents. Other purpose is prior-debt,
required-payment or other; none automatically settles the scheduled minimum.
refunds explicitly link a posted credit to its purchase. reversals name the
original payment and unique reversed card/Bills legs, and may reverse only
previously allocated amounts. Used identities cannot be credited twice.

No production opening or allocation has been installed. Needed owner facts
are recorded in docs/01_OPEN_QUESTIONS.md. Missing opening, currency, pairing,
identity or intent remains unknown. Foreign/missing native units and mixed
replacement evidence do not publish raw values as CAD spend or coverage;
to_base is not conversion authority.

## Financial and publication boundary

Purchases retain existing category classification and count once. Coverage
adds protection to the existing simulation cash floor; it does not subtract
cash again, inject money, add a scheduled expense or create debt. Actual Bills
cash and card balances remain observer facts. Fully covered rows leave the
active list and keep audit detail. Partial uncovered amounts carry until an
explicit coverage allocation or linked refund changes them.

Unknown coverage withholds precise capacity, funding, weekly permission and
extra-debt instructions. Known bill facts, named costs and observed cash are
retained. Forecast alone withholds usable money; OperatingAnswer and
RefreshTrust copy that publication. Known spending-category facts remain
available. Calendar extra-debt rows and their existing printer preserve
unavailable rather than displaying an invented zero. With no card
evidence/configuration, the incumbent publication is
unchanged; its independent immutable savings before/after proof passes.

BillDetail prints this ledger only. public/plan.js passes the active coverage
publication into the existing #491 renderer. No original-plan/actual totals
or goal-fulfillment selector is implemented here. Expected UI-follow-up
overlap is calendarPeriodWaterfalls, paydayAllocation and selected-period
funding/withheld state; parent owns sequencing.

## Verification and remaining gates

Independent synthetic tests cover observed cash/debt/category reconciliation,
partial and combined allocations, refund/reversal conservation, pending
purchases and legs, missing intent/pair/opening/identity/date, native units,
privacy and separate issuer minimum evidence. The annual-card-fee financial
assertion remains unchanged. Legacy synthetic observations declare CAD units
where their fixtures intend CAD; declarations do not supply payment intent.
Old funding expectations were adjusted only where they released an uncovered
purchase hold or claimed usable cash without confirmation. No real financial
fixture, amount or account has been edited.

The full run frozen at c7276c5 passed 272/287 suites. Fifteen failures were
triaged into consumer/fixture mismatches, the omitted authority printer name,
and four Windows execution constraints. Focused fixes preserve known
category/bill facts while withholding precise permission. Windows checks use
process-only Git Bash and core.autocrlf=false; CurrentUser encryption checks
need unsandboxed execution. The reference snapshot harness now uses a Windows
directory junction rather than a privileged file symlink, keeping the same
financial oracle. No suites are skipped or assertions weakened to pass the
platform. A fresh exact-head full run is required after these changes.

Authenticated headless Edge exercised the actual Budget consumer on c7276c5
with fully synthetic server data. It printed the $80 purchase hold from the
Forecast ledger. Local evidence: ../491-browser-proof.json,
../491-browser-coverage.png and ../491-browser-dom.txt. Repeat on the frozen
final candidate; earlier evidence does not certify a later head.

Production remains unconfirmed until the household supplies the opening and
explicit links recorded in docs/01_OPEN_QUESTIONS.md. Independent Systems
review and parent publication coordination remain separate gates. No claim
of deployment, production reconciliation or lender non-payment is made.
