# Production read-only Lunch Money access — owner pass 2026-08-23

Owner decision: **authorize Atlas production to use Lunch Money READ-ONLY,
on demand, to produce the live household plan.**

This records permission to configure the deployed website to invoke the
incumbent live overlay (`scripts/live-plan.js` / `scripts/provider-observe.js`)
when an authenticated household opens or refreshes Atlas. It does **not**
authorize unattended canonical writes, scheduled refresh, or writing anything
to Lunch Money. The 2026-09-04 addendum below is the later owner exception
for one confirmed single-transaction `category_id` update; it does not
reopen any other Lunch Money write.

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

Owner decision: **authorize Atlas to perform one narrowly bounded Lunch
Money write class**, so Dale or Amanda can correct an individual
transaction category from Atlas Household Budget / Other Spending.

This addendum supersedes the 2026-08-23 sentences “writing anything to
Lunch Money” and “Atlas usage remains GET-only” **for that exception
only**. Every other Lunch Money interaction remains GET-only. This is
not a general write credential, not a second transaction ledger, and not
Forecast policy.

### What this addendum authorizes

Atlas may update `category_id` on **one exact Lunch Money transaction**,
identified by its real Lunch Money transaction ID, after an authenticated
household user explicitly confirms that category change in Atlas.

The existing `LUNCHMONEY_ACCESS_TOKEN` may be used for this one
server-side category-update operation if Lunch Money does not provide a
materially narrower provider-scoped credential for it. The token remains
a configured secret under `ARCHITECTURE.md`. It stays server-side. It is
never published to the browser.

After Lunch Money confirms that write, Atlas returns to its incumbent
GET / read observation path. Forecast recomputes from observed state.
Atlas must not keep a competing local transaction ledger, and must not
mutate published financial state before Lunch Money confirms success.

Lunch Money remains the transaction source of truth. Forecast remains the
sole financial planning / calculation authority.

### Application-boundary requirements

A later implementation PR must enforce this authorization in application
code. This documentation PR does not add that code.

- incumbent Atlas authentication / authorization before the write
- server-side resolution and validation of the exact target transaction
- real Lunch Money transaction IDs stay server-side when current privacy
  architecture already keeps provider IDs off the client
- only the Lunch Money transaction-category update endpoint / method
  required for this operation
- only the `category_id` field required for this operation
- reject additional mutable fields
- require a category that currently exists in Lunch Money
- fail closed
- no optimistic local financial-state mutation before Lunch Money
  confirms success

If a later implementation cannot satisfy those requirements without
weakening them, it stops and records the concrete blocker.

### What remains unauthorized

This addendum does **not** authorize:

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

No new secret name. After a later implementation merges, the owner does
not need a second token unless Lunch Money later offers a materially
narrower credential for this operation. This addendum still does not
hold secret values.
