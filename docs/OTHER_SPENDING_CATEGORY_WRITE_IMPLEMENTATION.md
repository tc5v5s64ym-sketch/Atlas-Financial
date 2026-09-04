# Other Spending category-write implementation — 2026-09-04

This file is implementation evidence, not a new authority. The authority is the
2026-09-04 reusable Other Spending `category_id` grant already recorded by PR
#249 in `ARCHITECTURE.md` and the production-pass addendum.

## Outcome

An authenticated household user may open **Household Budget → Other Spending**,
choose an existing Lunch Money category that Forecast maps to an incumbent
Household Budget line, explicitly confirm one transaction, and have Atlas update
only that exact Lunch Money transaction's `category_id`.

The browser never receives the real Lunch Money transaction ID. The server
builds an opaque HMAC handle from the provider ID, refetches current Lunch Money
evidence on every write, and resolves the handle only if that same exact
transaction is still a posted current-period Other Spending item. The selected
category is likewise revalidated against the current provider category set and
Forecast classification before the write.

The provider request is one `PUT /v2/transactions/:id` with a body containing
only `category_id`. Atlas waits for Lunch Money to confirm the returned
transaction ID and category ID. It does not change `data.json`, keep a local
transaction ledger, or optimistically change Household Budget totals. On
success the page reloads through the incumbent GET/live-overlay path and
Forecast recomputes from observed state.

## Deliberate non-goals

This does not authorize or implement amount/date/payee/merchant/notes edits,
balance changes, transfers/payments, account changes, category
creation/deletion/rename, bulk/rule-based/automatic recategorization, standing
merchant rules, historical mass cleanup, Forecast policy changes, or any other
provider write.
