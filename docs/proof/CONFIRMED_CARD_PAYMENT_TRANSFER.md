# Explicitly confirmed payment/transfer leg admission

## Current-state gate

Owner-directed bounded repair, dispatched by ChatGPT on 2026-10-04. Current main
`42988ff5217d08c57b75cd7c09164f1ca87d16e9` remains broken: a posted, account-bound,
native CAD Bills/card pair with explicit purchase allocations is rejected when
Lunch Money calls its category `Payment, Transfer`. Household category spending
already excludes that established transfer identity. The coverage ledger only
admitted `Credit Card Payment`, a specific hint or existing card identity.

The independent regression uses invented provider rows through provider-observe,
live-plan and Forecast. Against the exact base's Forecast it fails the first
confirmed pair assertion (`unavailable` instead of `ready`). Against the repair,
the pair is accepted. No provider category correction, household assumption,
production opening or financial input update is required for this code repair.

## Authority and boundary

Forecast.visaPaymentReconciliation remains the sole purchase-coverage ledger.
The observer remains evidence authority; owner-confirmed configuration remains
intent authority. This local admission defect is repaired inside Forecast.
Category/hint alone never names a pair, purchase allocation, remainder purpose or
minimum settlement. New movement admission applies only to references named by
an explicitly confirmed payment or reversal record. Ordinary unrelated cash
transfers retain their existing behavior.

All existing account, posted-state, native-currency, unique-reference,
complete-history and exact-cent conservation checks still run. The real consumer
is Forecast.recommend's card coverage and from-today funding packet, consumed by
the existing Budget/Plan UI. No renderer or persistent writer is added.

## Independent reconciliation

The invented opening has $500 Bills cash, $400 card debt, a $150 grocery plan and
a separate $25 minimum. An $80 purchase raises debt to $480, spends $80 of the
grocery plan and leaves $70 category capacity. Its uncovered principal protects
$80 in Bills: $500 - $25 - $70 - $80 = $325 capacity.

An explicitly confirmed $80 posted Bills-to-card backfill leaves $420 cash and
$400 debt. The purchase remains $80 category spending; coverage becomes $0;
the minimum remains reserved: $420 - $25 - $70 - $0 = $325 capacity.

A partial $20 backfill leaves $480 cash, $460 debt and $60 uncovered:
$480 - $25 - $70 - $60 = $325. Reversing $20 of the full backfill leaves $440
cash, $420 debt and $20 uncovered: $440 - $25 - $70 - $20 = $325. A confirmed
$20 refund after the partial backfill reduces uncovered principal from $60 to
$40 once. A $20 `required-payment` remainder never automatically settles the
separate minimum.

## Regression and negative controls

`test/test-confirmed-card-payment-transfer.js` exercises exact `Payment, Transfer`
provider category and normalized `payment`, `bill-payment`, and `transfer` hints.
It verifies stock values, category spending/allowance, minimum protection,
partial/full coverage, refunds, reversal and independent capacity arithmetic.

Controls retain unavailable status for absent/false intent, backfill notes alone,
missing references, reused legs or payment ids, mismatch/nonconserving amounts,
unknown remainder purpose, pending legs, foreign/missing currency, wrong cash
account/card, nonmovement category, incomplete posted/pending observation and
ambiguous provider replacement. Unrelated cash transfers do not become missing
card allocations. The test is included by the existing card-coverage suite;
the shared test registry is unchanged.

Commands:

```text
node test/test-confirmed-card-payment-transfer.js
node test/test-card-purchase-coverage.js
node test/test-card-backfill-intent.js
node test/test-visa-payment-backfill.js
node test/test-budget-pending-card-funding.js
node test/test-from-today-funding.js
node test/test-from-today-integration.js
node test/test-forecast.js
node test/test-authority-coverage.js
npm test
```

The PR merge card reports actual outcomes and exact-head verification. Synthetic
proof is integration proof, not production activation. Production baselines,
allocations, real transactions, amounts, accounts, debt policy, savings purpose,
income and Other spending inputs remain unchanged. Existing savings/card setup
owner confirmations are a separate follow-up; no new questionnaire or app writer
is introduced here.
