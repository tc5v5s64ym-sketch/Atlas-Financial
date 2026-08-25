# Live closed-loop acceptance — 2026-08-25 (AF-REFRESH-07)

Sanitized proof that the completed on-demand refresh loop holds against
**real current household Lunch Money state**, not a fixture. The owner can
read this packet and determine the seven acceptance questions without
manual reconciliation.

This run did **not** write canonical state, did not authorize borrowing,
did not invent a settlement, and did not change Forecast. Raw provider
JSON, the access token, real Lunch Money account IDs, and real provider
transaction IDs stay out of git. Unattended production writes remain
unauthorized.

## Current-state gate

Checked on current `main` `1e89f2def7b078cf1b94a884e25ec6eb2f2c2254`
(PR #183 merge commit) before the live command. Open pull requests: none.

**Source.** Explicit owner instruction: execute AF-REFRESH-07 — live
closed-loop acceptance and cleanup.

**Verdict.** STILL BROKEN on that head for this outcome: AF-REFRESH-01
through AF-REFRESH-06 were merged, but no live closed-loop proof existed
and `docs/AF_REFRESH_TRUSTED_STATE_LOOP_PLAN.md` was still the active
campaign plan.

**Evidence, before any repository edit.** A Lunch Money GET-only credential
was present. The production account-map secret was absent. The gitignored
local map was reconstructed for this shell from documented Lunch Money
display names already in the repository (BILLS ACCOUNT, WEEKLY SPENDING,
EMERGENCY SAVING, PERSONAL CREDIT CARD, TD CASH BACK VISA, TRAVEL VISA,
LINE OF CREDIT - HOME EQUITY, MORTGAGE, TRIANGLE MASTERCARD, Amazon MBNA
Credit Card). TENNIS INCOME / DEBT&PAYMENTS and SAVINGS-DONT TOUCH were
mapped `household-external`. That local file is not in git.

## Command

One live GET, then the incumbent loop twice on that same payload:

```text
observe → obligation-reconciliation receipt → canonical preview
  → in-memory live overlay → Forecast.recommend → operating-answer
```

A second live GET of unchanged provider evidence followed. Canonical
`data.json` remains the 2026-08-19 opening. No `--apply`. Production
`/data.json` overlay was not enabled for this shell
(`ATLAS_LIVE_OVERLAY` unset).

## 1. What live evidence changed

| Fact | Value |
|---|---|
| Fetched | 2026-08-25T19:02:16.745Z |
| Household date | 2026-08-25 |
| Historical opening | 2026-08-19 |
| Effective live as-of | 2026-08-25 |
| Overlay applied | true |
| Observation ready | true |
| Posted coverage complete | true |
| Pending coverage complete | true |
| Overlays | 6 |
| Refused | 1 (historical-opening-backfill posting) |
| Canonical write | false |

Overlays (in-memory only; **CALCULATED**):

| Locator | Canonical | Live | Evidence date |
|---|---|---|---|
| `cash:chequing-a` | $629.27 | $429.27 | 2026-08-25 |
| `cash:chequing-b` | $309.77 | −$522.02 | 2026-08-25 |
| `debts:cashback` | $4,799.43 | $4,855.77 | 2026-08-25 |
| `debts:cashback#pending` | $0.00 | $56.34 | 2026-08-25 |
| `debts:tdcc` | $1,705.94 | $1,769.87 | 2026-08-25 |
| `debts:travelvisa` | $1,205.33 | $1,216.52 | 2026-08-25 |

Savings ($0.58), HELOC, mortgage, Triangle, and MBNA MATCH; they were not
rewritten. Chequing B is an overdrawn household-cash account, not card
credit treated as cash.

## 2. Modeled items

Trusted obligation-reconciliation receipt on this observation:

| Settlement | Count | Items |
|---|---|---|
| Represented | 4 | BCAA 16 Aug, ICBC 16 Aug, RESP 16 Aug, CMAW 16 Aug |
| Upcoming / still due | 1 | Travel Visa minimum 26 Aug $17.00 |
| Unverified | 3 | Fit4Less 14 Aug, mortgage 14 Aug, Shaw 14 Aug |
| Ambiguous | 0 | — |
| Unmatched household cash | 60 | listed, not invented into modeled items |

Unverified is **not** unpaid. Those three 14 August rows sit before the
2026-08-19 opening; this packet does not treat absence-of-a-new-match as
proof they failed to post.

## 3. Material owner question

Smallest incumbent owner question:

> Atlas still needs a household fact before treating this modeled item as
> settled. Fit4Less membership. (`fit4less`, 2026-08-14)

The same owner-fact reason also remains on the 14 August mortgage and Shaw
rows. No new household policy was inferred.

## 4. Canonical changes proposed before any write

Preview-only. **`writesCanonicalState: false`**. Posted `previewId`
`14124068eaf75205182dc599eb25e441e282a4950609a0eb9bdb7b96a3d9bb38` would
authorize five posted updates if the owner later approved that exact
preview. This acceptance did **not** pass `--apply`.

Mechanically provable posted rows:

| Locator | Canonical | Proposed | Date |
|---|---|---|---|
| `cash:chequing-a` | $629.27 | $429.27 | 2026-08-25 |
| `cash:chequing-b` | $309.77 | −$522.02 | 2026-08-25 |
| `debts:cashback` | $4,799.43 | $4,855.77 | 2026-08-25 |
| `debts:tdcc` | $1,705.94 | $1,769.87 | 2026-08-25 |
| `debts:travelvisa` | $1,205.33 | $1,216.52 | 2026-08-25 |

Pending overlay is live-plan only; posted `previewId` cannot authorize
pending. Unmatched cash and unverified owner-fact rows cannot write.
Downstream: Forecast starting cash **would** change by −$1,031.79 if that
preview were later approved. Snapshot and `representedEvents` would not.

## 5. Forecast from the selected trusted state

The trusted state is the in-memory live overlay. Independent posted
household cash:

> $429.27 + (-$522.02) + $0.58 = **-$92.17**

`Forecast.startingCashAmount` on that clone agrees. Amanda / TENNIS INCOME
is not in that sum. Credit capacity is not household cash.
`cardCapacityIsCash: **0**`. `funding.borrowed: **$0**`.

The same clone was fed directly to `Forecast.recommend`. The operating-answer
projector copied those fields and did not recalculate them.

| Field | Value | Tag |
|---|---|---|
| asOf | 2026-08-25 | CALCULATED |
| `recommend.mode` | `openingGap` | CALCULATED |
| Spendable household cash | −$92.17 | CALCULATED |
| Raw `advice.weekly` | $0 — failure sentinel on an unfunded opening gap | CALCULATED |
| `funding.feasible` | false | CALCULATED |
| `funding.borrowed` | **$0** | CALCULATED |
| `plannedDebt.permitted` | **false** | CALCULATED |
| Next payday | 2026-08-28 | CALCULATED |
| Protected obligation still due | Travel Visa minimum $17.00 on 2026-08-26 | CALCULATED |
| Remaining claim | precise | CALCULATED |
| Category remaining claim | classified-incomplete | CALCULATED |

## 6. Whether the operating answer changed

Yes, versus the dated 2026-08-19 opening:

| Field | Dated opening | Live overlay |
|---|---|---|
| asOf | 2026-08-19 | 2026-08-25 |
| moneyAvailable | $939.62 | −$92.17 |
| protectedObligations.wanted | $324.87 | $17.00 |
| protectedObligations.allocated | $324.87 | $0.00 |
| weekly / weeklyCap | $180 | $0 |
| remainingClaim | unavailable | precise |

Zero extra-debt allocation is unchanged. HELOC/card capacity stayed visible
capacity and did not become cash.

## 7. Freshness / completeness

Refresh-trust display state: **partially-current**.

- Observation ready; overlay applied; pending coverage complete.
- Exact remaining is available, but category remaining is
  `classified-incomplete`.
- 60 unmatched household-cash movements and three unverified owner-fact
  rows keep the state from reading as fully current.
- A canonical proposal is waiting; nothing was auto-approved.

## Idempotency

Same payload observed twice in-process:

| Check | Result |
|---|---|
| Observation fingerprint digest | equal |
| Obligation-reconciliation receipt | equal |
| Canonical previewId | equal |
| Overlay JSON | equal |
| Refresh-trust packet | equal |
| Canonical file bytes | unchanged |

Second live GET (`fetchedAt` differed, as expected):

| Check | Result |
|---|---|
| Identity keys equal | **true** |
| previewId equal | true |
| Spendable cash equal | true |
| `cardCapacityIsCash` | 0 |

`identityEqual` across two GETs is false only because `fetchedAt` is part
of the full identity proof. Unchanged provider evidence kept identity
**keys** and the posted previewId identical.

## Security acceptance

| Bound | Result |
|---|---|
| Provider / FI write | none — observer uses HTTP GET only |
| Unattended canonical write | none — preview only; no `--apply` |
| Scheduled / background refresh | none |
| Secret / raw identifier publication | none in this document or the CLI packet |
| Credit as cash | `cardCapacityIsCash` 0; independent cash is the three posted household-cash rows only |
| Auto-borrow | `funding.borrowed` $0; `plannedDebt.permitted` false |

This is newer committed observation evidence, not a cutover. The published
and canonical opening remains 2026-08-19. Any newer canonical opening
remains an owner-reserved `previewId` approval.
