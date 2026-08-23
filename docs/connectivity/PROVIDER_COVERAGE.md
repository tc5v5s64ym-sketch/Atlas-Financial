# Provider coverage — read-only connectivity spike

Verified against official docs on 2026-08-16. Institution-count marketing is not
used. The live Lunch Money observation test ran the same day; that pull
stays out of git. This file is the written B80 evaluation. Remaining
UNKNOWN cells are completeness, not a reason to schedule B80 again.

## A. Atlas household account matrix

| Atlas class | Institution | Why it matters | Lunch Money | Wealthica | Flinks |
|---|---|---|---|---|---|
| Payroll / fixed-cost chequing | TD | operating cash | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | PARTIAL — TD listed as a major Canadian FI; product-level cash vs HELOC vs mortgage unproven |
| Daily-spending chequing | TD | operating cash | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | PARTIAL — same TD listing |
| Savings | TD | operating cash | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | PARTIAL — chequing/savings are documented account types |
| TD credit card | TD | revolving debt | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | PARTIAL — credits category includes credit cards |
| Cash Back / Travel Visa | TD | revolving debt | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | PARTIAL — same |
| HELOC / FlexLine | TD | largest revolving facility | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST — credits include lines of credit; FlexLine product unproven |
| Mortgage | TD | largest debt | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST — loans listed; mortgage fields unproven |
| WebBroker / RESP | TD | investments, not emergency cash | UNKNOWN / MUST TEST | PARTIAL — wealth/investment API is the documented strength | NOT SUPPORTED for new work — Flinks investment product retired 2026-04-30 |
| MBNA / Amazon Mastercard | MBNA | revolving debt | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST |
| Triangle Mastercard | Canadian Tire Bank | revolving debt | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST |
| Sun Life | Sun Life | retirement/investment | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST |
| Wise | Wise | USD spending asset | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST |
| PayPal | PayPal | pass-through / cards | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST | UNKNOWN / MUST TEST |

`SUPPORTED` is not used anywhere above. No official page proved a specific Atlas
product (HELOC vs chequing vs WebBroker) behind a generic “TD” label.

## B. Lunch Money

Official: https://lunchmoney.dev/ and https://lunchmoney.dev/v2/docs

- Personal Bearer token from https://my.lunchmoney.app/developers. No sales call.
- Official v2 (open alpha; official SDK names GET `/me`, `/plaid_accounts`,
  `/manual_accounts`, `/transactions`). Atlas implements **GET only**.
- Transactions expose `id`. Official v2 sign: **positive = debit, negative =
  credit**. Official docs mention `is_pending`. Same `id` pending+posted is
  treated as one economic transaction (posted wins; no ghost pending). A
  real household pending→posted replacement on this budget is still
  **UNKNOWN / MUST TEST** until Bell Mobility `2461295531` posts.
- Live GET `/transactions` is windowed: `--mode current-state` is 14 days;
  `--mode reconcile` is 120 days so the 90-day pending-bill rule can see
  aged rows. Override with `--history-days N`. Do not fetch two years on
  every current-state call.
- Official v2 also has `GET /transactions?is_pending=true`. That filter
  returns only pending transactions and takes precedence over
  `include_pending`. Omitting `start_date`/`end_date` and paging until
  `has_more=false` is the current-pending universe. Only that completed
  query may emit numeric pending `0`. An empty bounded `include_pending`
  window is not proof of zero; missing `has_more`, a date bound, or
  truncation stays UNKNOWN / unproven. Do not infer zero from mere
  absence.
- A pending bill/payment older than 90 days may be **presumed settled for
  current forecasting only** (`confidence: inferred`). Historical provider
  status stays pending. That is not a universal STALE threshold.
- Real live `providerAccountId` values stay in gitignored
  `docs/connectivity/provider-account-map.local.json`, or in production in
  the owner-supplied `ATLAS_PROVIDER_ACCOUNT_MAP_JSON` Render secret. They
  are stable household account identifiers and are not committed. Copy
  `provider-account-map.local.example.json`. Leave DEBT&PAYMENTS and
  SAVINGS-DONT TOUCH unmapped.
- Dale connects institutions **inside Lunch Money**. Atlas holds only the
  Lunch Money GET-only token, where `ARCHITECTURE.md` permits.
- Credit limit, available credit, HELOC/mortgage subtypes, and Canadian
  institution product coverage are **UNKNOWN / MUST TEST**.
- Refresh frequency is **UNKNOWN / MUST TEST**.
- Live observe tries `/plaid_accounts` plus `/manual_accounts`, then `/assets`
  if manuals 404. Field names beyond `id` / `balance` / `currency` stay
  UNKNOWN until a live pull.

## C. Wealthica

Official: https://wealthica.com/docs/api/

- Stable institution and investment `_id`s, `sync_date`, transactions, assets,
  **liabilities**, daily sync.
- Adding an automated institution accepts a `credentials` object that can
  include `username` / `password`. Atlas must never use that path.
- API client id/secret: public docs plus the 2024 launch note point to
  **contacting sales** for trial keys.
- Strongest documented surface is Canadian wealth/holdings, not proven
  HELOC/card/mortgage product coverage.

## D. Flinks

Official: https://docs.flinks.com/

- Canadian bank aggregator. TD is listed among major FIs. Account types include
  operations (chequing/savings) and credits (cards, lines of credit, loans).
- Front end is Flinks Connect (OAuth/MFA at the institution). Back end is
  API or webhooks. B2B / demo customer id — not a personal self-serve token.
- Investment/wealth product **retired 30 April 2026**.
- Responses can include name and address. Extra privacy cost for Atlas.

## E. Access restrictions

| Provider | Self-serve API for this repo | Likely cost |
|---|---|---|
| Lunch Money | Yes — personal developer token | Lunch Money subscription |
| Wealthica | No — sales / partner keys | Partner / trial |
| Flinks | No — commercial onboarding | Commercial |

## F. Security / auth model

Atlas never collects a bank username, password, PIN, or 2FA.

Recommended path: Dale authorizes institutions at the provider. Atlas holds
only the Lunch Money GET-only token, where `ARCHITECTURE.md` permits: the
`LUNCHMONEY_ACCESS_TOKEN` environment variable, or on the owner's Windows
home PC the CurrentUser DPAPI file
`%LOCALAPPDATA%\Atlas-Financial\secrets\lunchmoney.dat`. Never in git,
`data.json`, `.env`, client JS, docs, fixtures, GitHub Actions, or Render.

## G. First provider

**Lunch Money.** Not because it lists the most institutions. Because it is the
only one of the three with a documented, personal, read-capable API Atlas can
implement without a sales process, while keeping bank credentials out of Atlas.

Coverage of the actual TD/MBNA/Triangle/Wise/PayPal/Sun Life products remains
UNKNOWN until Dale connects them in Lunch Money and we inspect one fixture
pull.

## H. Live observation test — already run

The owner completed a live Lunch Money GET on 2026-08-16. That pull stays
out of git. Mapped pending rows already feed B91 observations. **Do not
schedule B80 or this test as a future milestone.**

What that test did **not** close, and what is **not** a critical-path
gate unless a later refresh demonstrates a material source gap:

- Which household accounts actually appear, product by product
- Credit limit / available credit / HELOC / mortgage fields
- Pending vs posted identity when a specific charge posts
- `updated_at` / `balance_as_of` / `date_last_fetched` stay distinct.
  Posted-balance evidence uses `balance_as_of` when that field is present.
  Generic `updated_at` is not the balance date.
- Whether every live account arrives through `/v2/plaid_accounts` versus
  `/v2/manual_accounts` (the spike uses those; `/assets` is a 404 fallback
  only)

## I. Owner action if a later completeness pull is needed

1. Dale connects institutions **inside Lunch Money**. Atlas is not in that
   login.
2. One-time on the Windows home PC:
   `node scripts/local-credentials.js setup-lunchmoney`
   (uses `LUNCHMONEY_ACCESS_TOKEN` if already set; otherwise prompts once
   with hidden input). After that, live GET commands resolve the DPAPI
   file automatically. `LUNCHMONEY_ACCESS_TOKEN` remains the override.
   Replace: `setup-lunchmoney --replace`. Remove:
   `node scripts/local-credentials.js remove-lunchmoney`.
3. Run `node scripts/provider-observe.js --provider lunchmoney --live`.
4. Do not paste the token into git, a PR, chat, or a fixture. Non-Windows
   and cloud agents do not read the Windows file.

This evaluation is **complete**. It is **NOT** permission to point
Wealthica or Flinks live. T4 later passed on 2026-08-17 for the earned
preview/approve writer only. Unattended production writes and a Render
token remain reserved.
