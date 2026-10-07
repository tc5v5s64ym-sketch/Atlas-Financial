# Household minimum confirmation through Lunch Money categories

The October 7 owner decision is recorded in `ARCHITECTURE.md` and attributed in
`docs/household_interviews/DALE_2026-10-07_MINIMUM_CATEGORIES.md`. It replaces the
October 4 assumption that no approved machine-readable minimum-intent convention
exists, for these exact categories only:

| Active, non-income leaf category | Card |
|---|---|
| Minimum payment - Triangle Mastercard | Triangle |
| Minimum payment - Amazon Mastercard | MBNA/Amazon |
| Minimum payment - TD Emerald Flex | TD personal/Emerald |
| Minimum payment - TD Cash Back Visa | Cash Back |
| Minimum payment - TD Travel Visa | Travel |

Every leaf must exclude both budget and totals. A category is resolved from its
provider ID and the current category response; a raw label, note, tag, generic
Payment, Transfer, Credit Card or Credit card payment label is insufficient.
The code does not create categories, change exclusion settings or recategorize
transactions. Inferred hygiene must not apply a confirming category without
sufficient confirmation evidence; this PR does not contact or configure Grok.

The observer requires complete posted and pending coverage, a positive posted
native-CAD payment debit on the obligation's mapped household funding account,
the incumbent payment payee identity, one eligible cycle after statement creation
(or on/after due when close timing is unavailable), and no reversal/duplicate or
split ambiguity. Several compatible payments or obligations remain unresolved.
The full transfer amount survives. No corresponding issuer transaction is
fabricated or required from a manually maintained receiving card.

The observer publishes an ephemeral sanitized `cardMinimumCategoryEvidence`
packet. `live-plan` replaces that packet on every refresh without rewriting
obligation policy or durable opening receipts. Forecast's minimum contract alone
checks the confirmed required amount and derives household-category satisfaction.
An insufficient transfer or estimated required amount keeps additional cash
unknown. Category confirmation and observed stock cannot apply another cash
debit or principal payment. Future rows keep their existing Planned semantics.
Explicit recorded owner sender/receipt evidence takes precedence; changing a
provider category cannot delete it. Stable debit identities already allocated
by owner sender records cannot supply another cycle or obligation's receipt;
both observation and Forecast enforce this before representation. Explicit
posted funding-side reversal aliases withhold derived proof even under a generic
category. The card/payment identity is required; equal amounts alone do not
identify a reversal. A funding-side return explicitly categorized for a different
card does not withdraw this card's proof through a shared bank alias. Mapped
receiving-card reversal identity still applies to that receiving card only.
Removing/changing a confirming category,
a posted reversal, or incomplete coverage removes the derived confirmation on
the next observation. There is no historical observation store or persistent
receipt accumulation.

`node test/test-card-minimum-category.js` uses an independent invented ledger:
$1,000 cash and $800 card debt, a $49.37 transfer against a $43.19 confirmed
minimum, observed closings $950.63 and $750.63. Both stocks stay at those closings
through Forecast's cash and debt walks; the excess is not replayed as principal,
income or category expense. Tests cover all five cards, the actual observer and
live-plan consumer, partial/estimated minimums, missing/category metadata,
pending replacement, wrong accounts/currency, reversals, duplicates, ambiguous
cycles, historical query dates, repeated refreshes and category removal.

This outcome leaves ordinary-bill category-family mapping and the real external
taxonomy setup for separate work. Historical paid bills may retain schedule
trust or owner-confirmation provenance without a linked provider transaction.
