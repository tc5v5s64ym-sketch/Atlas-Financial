# Card purchase coverage: local candidate and independent oracle

This is a synthetic-only candidate, not production household facts or a
deployment claim. Parent authorized replacing #491's inferred split with one
evidence-qualified ledger and immediate cash protection. No transaction,
account, canonical amount, baseline or credential was changed.

## State and coordination boundary

The takeover began at #491 head 3f805ee19467f0bbb5dae84b2314170e4e738fec.
Main ce97abdd3aa6b0000b5f06271e729fd7ff332783 was merged locally without
conflicts, preserving the #490 UI. Local merge head is
f127cffc66f021ff74280348f5ddb236fe8914b4. The repair remains uncommitted.

During work the remote was force-updated to
83eda4aa7b3ba561f56e12ab472235980c19f1d9 at 06:56 UTC. No replacement was
pushed over that changed head. Parent must coordinate the handoff before
publication resumes. No competing coverage PR was created.

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

The prior original #491 head independently labels an unconfirmed $10 as
backfill and drops the remaining $20 before labeling the next $25 as card
payment. The local red control is ../pr491-intent-red.log. It does not certify
the subsequently changed remote 83eda4a.

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
retained. With no card evidence/configuration, the incumbent publication is
unchanged; its independent immutable savings before/after proof passes.

BillDetail prints this ledger only. public/plan.js passes the active coverage
publication into the existing #491 renderer. No original-plan/actual totals
or goal-fulfillment selector is implemented here. Expected UI-follow-up
overlap is calendarPeriodWaterfalls, paydayAllocation and selected-period
funding/withheld state; parent owns sequencing.

## Verification limits

Focused proofs pass: test-card-purchase-coverage.js (actual observer/overlay/
Forecast), test-visa-payment-backfill.js (explicit cents/pairs), and incumbent
minimum-intent and pending-card funding tests after explicit synthetic unit
and opening declarations. The annual-card-fee assertion is unchanged.

The first full sweep had 31 failures in 285 suites. Subsequent fixes preserve
known bill facts and the complete incumbent no-card publication. Twelve
legacy synthetic observation suites now declare their native CAD fixture
units without assigning intent or changing financial assertions; their
focused reruns pass. The full sweep has not been rerun on these later edits.
Remaining legacy funding fixtures, exact-head full verification, browser
checks and independent Systems review are unfinished. This is not a green
or merge-ready candidate.
