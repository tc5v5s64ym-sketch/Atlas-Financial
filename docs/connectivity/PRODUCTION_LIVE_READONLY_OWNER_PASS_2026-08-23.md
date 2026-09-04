# Production read-only Lunch Money access — owner pass 2026-08-23

Owner decision: **authorize Atlas production to use Lunch Money READ-ONLY,
on demand, to produce the live household plan.**

This records permission to configure the deployed website to invoke the
incumbent live overlay (`scripts/live-plan.js` / `scripts/provider-observe.js`)
when an authenticated household opens or refreshes Atlas. It does **not**
authorize unattended canonical writes, scheduled refresh, or writing anything
to Lunch Money except the two 2026-09-04 addenda below. The first addendum
records one exhausted `category_id` correction on one exact owner-identified
transaction. The later addendum records the separate reusable Household
Budget → Other Spending `category_id` class. Neither addendum reopens any
other Lunch Money write.

Exact `main` at the decision: `71c068edd9bfa5711e73006b883db219193cfcc9`
(PR #163 merged). No open pull requests at that head.

## What passed

- Production may hold a Lunch Money GET-only token as a Render environment
  secret named `LUNCHMONEY_ACCESS_TOKEN`.
- Production may hold the existing `atlas-provider-account-map/v1` schema as a
  Render environment secret named `ATLAS_PROVIDER_ACCOUNT_MAP_JSON`. Real
  provider account IDs stay out of git.
- `ATLAS_LIVE_OVERLAY=live` may be set on the deployed service so
  authenticated `GET /data.json` uses the incumbent observation →
  reconcile → in-memory overlay → Forecast path.
- Fail-closed remains mandatory: untrusted live evidence serves the dated
  canonical opening and says so.

## What this does not authorize

- writing anything to Lunch Money
- unattended canonical writes
- automatically editing `data.json`
- automatically advancing the canonical opening
- polling, cron, or scheduled jobs
- storing raw transaction history
- exposing provider credentials or account IDs to the browser
- changing Forecast authority
- inventing settlement or categorization
- institution usernames, passwords, PINs, OTP, or security answers
- money movement or any institution action

Official Lunch Money tokens are not provider-scoped read-only. Atlas usage
remains GET-only.

## Owner Render step after merge

The secret values are never stored in git. After merge, the owner sets them
directly in Render → household-finances → Environment. This document names
the variables; it does not hold the values.

## Addendum — 2026-09-04 owner decision

Exact `main` at this addendum: `d10c0cb69c24afacda9677cdea744e9cdaea847f`
(PR #247 merged). No open pull requests at that head.

Owner decision: **authorize one specific Lunch Money `category_id`
correction on one exact owner-identified transaction only.**

This is not a reusable production write class. It is not “one exact
transaction at a time.” It is not Household Budget / Other Spending
editing for arbitrary transactions. It does not authorize the production
token for a standing write class.

This addendum supersedes the 2026-08-23 sentences “writing anything to
Lunch Money” and “Atlas usage remains GET-only” **only for that one
already-granted write**. Every other Lunch Money interaction remains
GET-only. A future reusable category-edit capability remains
unauthorized unless the owner separately grants that broader permission.
This is not a general write credential, not a second transaction ledger,
and not Forecast policy.

### What this addendum authorizes

Atlas may perform the one `category_id` correction the owner already
granted on the one Lunch Money transaction the owner already identified.
That grant is exhausted by that one write. It does not authorize a
second transaction, a later transaction, or a general category-update
path.

The existing `LUNCHMONEY_ACCESS_TOKEN` may be used for that one
already-granted server-side write if Lunch Money does not provide a
materially narrower credential for it. Using the token for that one
grant does not convert it into a standing write credential. The token
remains a configured secret under `ARCHITECTURE.md`. It stays
server-side. It is never published to the browser.

After Lunch Money confirms that one write, Atlas returns to its
incumbent GET / read observation path. Forecast recomputes from observed
state. Atlas must not keep a competing local transaction ledger, and
must not mutate published financial state before Lunch Money confirms
success.

Lunch Money remains the transaction source of truth. Forecast remains
the sole financial planning / calculation authority.

This remains a documentation/authority record only: no write code, no
UI, no canonical write, and no second ledger.

### What remains unauthorized

This addendum does **not** authorize:

- a reusable Lunch Money category-edit capability
- “one exact transaction at a time” or any other standing write class
- Household Budget / Other Spending editing of arbitrary transactions
- authorizing the production token as a standing write credential
- transaction amount, date, payee, or merchant edits
- balance changes
- transfers or payments
- account changes
- category creation, deletion, or renaming
- merchant-wide, bulk, rule-based, or automatic recategorization
- unattended writes or scheduled jobs
- Forecast policy changes or borrowing permission
- any write to another financial institution or provider
- unattended canonical Atlas writes, automatic `data.json` edits, or a
  newer live substitute opening

The 2026-08-23 production GET observation, mapping secret, live overlay,
and fail-closed overlay rules remain in force.

### Owner Render step

No new secret name. This one-time grant does not require a second token
and does not hold secret values.

The later 2026-09-04 addendum below is the separate owner grant this
addendum said a reusable category-edit capability would need. It does
not revive or enlarge this exhausted one-transaction write.

## Addendum — 2026-09-04 reusable Other Spending category correction

Exact `main` at this addendum: `b1a7702f57bb314adcaa92ffe256296d2a7ed73d`
(PR #248 merged). No open pull requests at that head.

Owner decision: **authorize a reusable, narrowly bounded Lunch Money
`category_id` write class for authenticated household use inside Atlas:
Household Budget → Other Spending → manual category correction.**

This is a standing authorization for repeated manual use of that same
narrow operation. It is **not** exhausted after one successful write.
It is **not** the earlier same-day one-transaction grant, which remains
a separate exhausted write.

Each invocation must still be all of:

- initiated by an authenticated household user (Dale or Amanda)
- one transaction at a time
- one explicit confirmation / save for that individual transaction
- one exact Lunch Money transaction
- one existing Lunch Money category
- `category_id` only

This addendum supersedes the 2026-08-23 sentences “writing anything to
Lunch Money” and “Atlas usage remains GET-only”, and the earlier
addendum’s “a future reusable category-edit capability remains
unauthorized”, **only for this class**. Every other Lunch Money
interaction remains GET-only. This is not a general write credential,
not a second transaction ledger, and not Forecast policy.

### What this addendum authorizes

Atlas may update `category_id` on one exact Lunch Money transaction
when an authenticated household user selects an existing Lunch Money
category from Household Budget → Other Spending and confirms that
individual change.

Example: an Amazon.ca $75 Other Spending row, user selects Groceries,
user confirms. Atlas may update only that transaction’s `category_id`
to the existing Groceries category.

The existing `LUNCHMONEY_ACCESS_TOKEN` may be used for this class if
Lunch Money does not provide a materially narrower credential for it,
consistent with the credential decision already recorded by the earlier
2026-09-04 addendum. Using the token for this class does not convert it
into a general-purpose Lunch Money write credential. The token remains
a configured secret under `ARCHITECTURE.md`. It stays server-side. It
is never published to the browser. A future implementation must
allowlist this operation and reject any other field.

The final provider write must target one exact real Lunch Money
transaction ID. Browser-visible aliases such as `tx-*` must not expose
raw provider transaction IDs. Identity is resolved and validated
server-side. Fuzzy targeting by merchant, amount, date, description, or
category is not authorized.

The selected category must already exist in Lunch Money. The server
must validate it against the provider’s current category set. The
browser may not create, delete, or rename a provider category through
this feature.

After Lunch Money confirms a successful `category_id` write, Atlas
returns to its incumbent GET / read observation path. Forecast
recomputes from observed state. The Household Budget UI refreshes from
that Forecast result. Atlas must not keep a competing local transaction
ledger, must not recategorize locally as a substitute for the provider
write, and must not mutate published financial state before Lunch Money
confirms success. If Lunch Money rejects the update, the transaction
and totals stay unchanged and the user sees a failure.

Lunch Money remains the transaction source of truth. Forecast remains
the sole financial planning / calculation authority.

This remains a documentation/authority record only: no write code, no
UI, no canonical write, and no second ledger.

### What remains unauthorized

This addendum does **not** authorize:

- transaction amount, date, payee, merchant, or notes edits
- balance changes
- transfers or payments
- account changes
- category creation, deletion, or renaming
- merchant-wide, category-wide, bulk, rule-based, automatic, AI-triggered,
  Gmail-triggered, or unattended recategorization
- standing merchant rules or historical mass cleanup
- Forecast policy changes or borrowing permission
- any write to another financial institution or provider
- unattended canonical Atlas writes, automatic `data.json` edits, or a
  newer live substitute opening
- a general Lunch Money write credential

No transaction may be changed without an explicit user confirmation for
that individual transaction.

The 2026-08-23 production GET observation, mapping secret, live overlay,
and fail-closed overlay rules remain in force. The earlier same-day
one-transaction grant remains a separate exhausted write.

### Owner Render step

No new secret name. This class does not require a second token and does
not hold secret values.
