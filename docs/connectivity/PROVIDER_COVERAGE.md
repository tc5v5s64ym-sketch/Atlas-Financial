# Provider coverage — read-only connectivity spike

Verified against official docs on 2026-08-16. Institution-count marketing is not
used. A live household connection is **not** in this PR.

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
- A pending bill/payment older than 90 days may be **presumed settled for
  current forecasting only** (`confidence: inferred`). Historical provider
  status stays pending. That is not a universal STALE threshold.
- Real live `providerAccountId` values stay in gitignored
  `docs/connectivity/provider-account-map.local.json`. They are stable
  household account identifiers and are not committed. Copy
  `provider-account-map.local.example.json`. Leave DEBT&PAYMENTS and
  SAVINGS-DONT TOUCH unmapped.
- Dale connects institutions **inside Lunch Money**. Atlas would only hold
  `LUNCHMONEY_ACCESS_TOKEN`.
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

Recommended path: Dale authorizes institutions at the provider. Atlas stores
only a server-side provider token in `LUNCHMONEY_ACCESS_TOKEN`. Never in git,
`data.json`, client JS, docs, or fixtures.

## G. First provider

**Lunch Money.** Not because it lists the most institutions. Because it is the
only one of the three with a documented, personal, read-capable API Atlas can
implement without a sales process, while keeping bank credentials out of Atlas.

Coverage of the actual TD/MBNA/Triangle/Wise/PayPal/Sun Life products remains
UNKNOWN until Dale connects them in Lunch Money and we inspect one fixture
pull.

## H. Still requires a live connection test

- Which household accounts actually appear
- Credit limit / available credit / HELOC / mortgage fields
- Pending vs posted identity when a charge posts
- `updated_at` / sync freshness
- Whether live traffic returns `/v2/plaid_accounts` and `/v2/manual_accounts`
  (the spike uses those; `/assets` is a 404 fallback only)

## I. Owner action for that test

1. Create a Lunch Money account (or use an existing one).
2. Create a **test budget** first; generate a token there.
3. Personally connect whatever institutions Lunch Money offers. Atlas is not
   in that login.
4. When ready, generate a token on the real budget.
5. Set `LUNCHMONEY_ACCESS_TOKEN` in the local shell only.
6. Run `node scripts/provider-observe.js --provider lunchmoney --live`.
7. Do not paste the token into git, a PR, chat, or a fixture.

This PR is **READY FOR OWNER CONNECTION TEST** of Lunch Money only.
It is **NOT READY** to point Wealthica or Flinks live, and it does not
satisfy `ARCHITECTURE.md`'s full connectivity gate (security review,
idempotent live import, and owner pass of T4 remain).
