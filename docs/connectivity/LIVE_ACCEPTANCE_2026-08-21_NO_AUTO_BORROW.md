# Live acceptance — 2026-08-21 no auto-borrow

Sanitized read-only proof that PR #128 holds on the real 2026-08-21 Lunch
Money overlay, not only on the synthetic $747.81 / $104.89 fixture.

This run did **not** write canonical state, did not authorize borrowing, did
not invent a settlement, and did not change Forecast. Raw provider JSON, the
access token, real Lunch Money account IDs, and real provider transaction IDs
stay out of git.

## Current-state gate

Checked on current `main` `9a4c807ebeaf2fac444d18dd400113136ac6c624` (PR #128
merge commit) before the live command. Open pull requests: none.

**Source.** Explicit owner instruction: re-run the real 2026-08-21 read-only
live acceptance after PR #128.

**Verdict.** ALREADY FIXED on that head. The live overlay still produces the
previously observed $747.81 spendable cash and $104.89 pre-payday buffer gap.
Forecast no longer auto-injects a HELOC draw. Weekly safe-to-spend is $0, not
the prior borrowing-enabled $990.

**Evidence, before any repository edit.** `node scripts/live-plan.js --live`
then an independent `Forecast.recommend` on that in-memory clone. Canonical
`data.json` remains the 2026-08-19 opening ($939.62 spendable).

## Command

```text
node scripts/live-plan.js --live
```

Then the same in-memory overlay was fed through `Forecast.recommend` with
`fundingSources`, `debts`, `revolvingExtra`, and `extraFacilities` from that
clone. Production `/data.json` overlay was not enabled
(`ATLAS_LIVE_OVERLAY` unset). No canonical refresh, no new opening, no
owner borrowing authorization.

The gitignored local provider-account map was reconstructed for this shell
from documented Lunch Money display names already in the repository (BILLS
ACCOUNT, WEEKLY SPENDING, EMERGENCY SAVING, the mapped TD/Triangle/MBNA
debts). **DEBT&PAYMENTS / TENNIS INCOME** and **SAVINGS-DONT TOUCH** stayed
unmapped. That local file is not in git.

## Live overlay

| Fact | Value |
|---|---|
| Fetched | 2026-08-21T14:25:31.600Z (CLI) and 2026-08-21T14:28:10.435Z (independent Forecast pass) |
| Historical opening | 2026-08-19 |
| Effective live as-of | 2026-08-21 |
| Overlay applied | true |
| Overlays | 2 |
| Refused | 3 (one historical-opening-backfill posting; two unmapped accounts) |
| Canonical write | false |

Overlays (in-memory only):

| Locator | Canonical | Live | Evidence date |
|---|---|---|---|
| `cash:chequing-b` | $309.77 | $117.96 | 2026-08-21 |
| `debts:travelvisa` | $1,205.33 | $1,216.52 | 2026-08-21 |

Chequing A ($629.27) and Savings ($0.58) MATCH; they were not rewritten.

## Independent cash and gap arithmetic

Spendable household cash is the three breakdown rows only:

> $629.27 + $117.96 + $0.58 = **$747.81**

`Forecast.startingCashAmount` agrees. Amanda / TENNIS INCOME ($2,691.85
held-elsewhere, last 2026-08-09 reading) is not in that sum. Card / HELOC
available credit is not in that sum.

Zero-spend floor on 2026-08-27, independent of `recommend`'s gap field:

| Drain before payday | Amount |
|---|---|
| BCAA 15 August outstanding | $82.96 |
| ICBC 15 August outstanding | $99.91 |
| RESP 15 August outstanding | $100.00 |
| CMAW dues 15 August outstanding | $25.00 |
| Travel Visa minimum (obligation, 26th) | $17.00 |
| Pre-income joint-cash outflows | **$324.87** |
| Undated Bell reserve, 7 days (21–27 Aug) | $121 × 12 / 365.25 × 7 = **$27.83** |

> $747.81 − $324.87 − $27.83 = **$395.11** floor
> $500.00 buffer − $395.11 = **$104.89** gap

Engine `advice.gap.amount` is $104.89 on 2026-08-27. `allocated + shortfall
=== gapAmount` holds: $0 + $104.89 = $104.89.

## Forecast result on the live clone

| Field | Value |
|---|---|
| `recommend.mode` | `openingGap` |
| Opening-gap amount | $104.89 on 2026-08-27 |
| `funding.feasible` | **false** |
| `funding.borrowed` | **$0.00** |
| `funding.allocated` | $0.00 |
| `funding.shortfall` | $104.89 |
| Recovery injections | **none** |
| Injections with a `debtId` | **none** |
| `plannedDebt.permitted` | **false** |
| `plannedDebt.borrowed` | $0.00 |
| Mathematical weekly safe-to-spend | **$0** |
| CLI `forecast.weekly` | $0 (same) |
| Lowest projected cash | **$395.11 on 2026-08-27** (zero-spend, knowledge, and view walks agree) |
| Next material obligation | RESP 15 August outstanding $100.00, scheduled 2026-08-16, walked at live as-of 2026-08-21 |
| `nextMove` | `unfunded`, shortfall $104.89 |
| `planStatus` path | unfunded (gap present, funding short) |

Funding-source card (visible capacity, not automatic cash):

| Source | Available | Verdict | Contributes |
|---|---|---|---|
| Amanda / TENNIS INCOME | $0.00 (Q25 OPEN) | insufficient | $0.00 |
| HELOC | $2,167.84 | insufficient | $0.00 |
| Overdraft | $600.00 | insufficient (unusable) | $0.00 |
| Cards | $623.32 | insufficient (unusable) | $0.00 |

HELOC headroom is independently $202,654.00 − $200,486.16 = **$2,167.84**.
It remains visible capacity. Forecast did **not** inject a HELOC draw.
The gap remains unfunded. Atlas does **not** publish the prior
borrowing-enabled $990/week as safe-to-spend.

## Critical acceptance

The live evidence still produces the previously observed ~$104.89
pre-payday buffer gap. All six required holds:

1. HELOC headroom remains visible only as capacity ($2,167.84, verdict
   `insufficient`, contributes $0).
2. Forecast does **not** automatically inject a HELOC draw (zero recovery
   injections; none carry a `debtId`).
3. `funding.borrowed` is **$0**.
4. `plannedDebt.permitted` is **false** without explicit authorization.
5. The $104.89 gap remains unfunded (`funding.feasible === false`).
6. Weekly safe-to-spend is **$0**, not $990.

The synthetic $747.81 / $104.89 fixture in
`test-opening-gap-no-auto-borrow.js` was not required as a substitute: live
cash and gap still match that fixture. `npm test` still runs it.

## Other required confirms

**Amanda / TENNIS INCOME is not automatically household cash.** Spendable
cash is $747.81 from the three joint accounts. The $2,691.85 held-elsewhere
row is unchanged observational identity. Amanda funding `available` is $0
while Q25 is OPEN. Two unmapped live accounts were DEBT&PAYMENTS and
SAVINGS-DONT TOUCH.

**Credit availability is not cash.** Revolving utilisation
`totalAvailable` is $3,391.16 and is not added to spendable cash. Cards
and overdraft are `unusable` as opening-gap cash.

**Unresolved obligations are not dropped because as-of advanced.** Live
as-of is 2026-08-21. The four 15 August once rows dated 2026-08-16 remain
on the plan and in the zero-spend walk; `cashWalkDate` applies them at
2026-08-21. Overlay `priorAsOf` is 2026-08-19.

**Bell remains exactly $121/month of forward reserved telecom gravity.**
`budget.categories.telecom.currentMonthly` is 121. `budgetBreakdown`
reserves $121, dates Shaw $78.40, and puts $0 of Bell into the weekly-cap
remainder (`planned` 0, source `current-regime`).

**Travel Visa mechanics do not duplicate Bell.** There is no dated Bell
joint-cash bill. Travel Visa's household cash effect is the $17 monthly
minimum obligation. Live Travel Visa posted moved $1,205.33 → $1,216.52
($11.19), which is not the $121 Bell reserve and not a second Bell $250
charge.

## Major-plan verdicts

On this unfunded opening-gap walk (`weekly` $0), every named major plan is
`ON TRACK`. That leftover is horizon-end surplus after a zero weekly cap,
not a claim that the $104.89 opening gap is funded. The opening itself is
`unfunded`.

| Id | Verdict |
|---|---|
| fusion-season | ON TRACK |
| burrards-team-fees | ON TRACK |
| seattle-nov | ON TRACK |
| seattle-dec | ON TRACK |
| christmas-2026 | ON TRACK |
| indio-tournament | ON TRACK |
| provincials | ON TRACK |
| home-insurance | ON TRACK |
| vehicle-maintenance | ON TRACK |
| warriors | ON TRACK |
| downstairs-couch | ON TRACK |
| exterior-painting | ON TRACK |

## Current facility-limit risks

| Facility | Live / modelled risk |
|---|---|
| Travel Visa | Over limit today: used $1,216.52 against $1,100 (available $0, pending $0). `firstOver` 2026-08-21. |
| Triangle Mastercard | `projectDebts` `firstOver` 2026-08-21 on the statement-cadence canonical posted $13,495.32 (not overlaid). Two days of modelled purchase interest from the 2026-08-19 opening crosses $13,500. This is cadence plus interest, not a new posted overlay. |
| HELOC | Headroom $2,167.84. Modelled facility crossing **2026-10-31**. Not cash. |
| Utilisation | `overLimitCount` 1 (Travel Visa). `totalPending` $0.00. |

No other Forecast defect is claimed from this run. The auto-borrow
invariant is the outcome.

## No-write proof

SHA-256 before the live GET and after the independent Forecast pass.
Byte-identical.

| File | SHA-256 |
|---|---|
| `data.json` | `158d7ee369fc510b0cb3d477add26b66d1c2e3f9c99ddeadff854cffb2b87dab` |
| `docs/positions.csv` | `9ba50d47f7bae8b2b8e38f60bc49a5bc6fe6346b576ab014f3ad16fa042f4046` |
| `snapshots/2026-08-09.json` | `de138a812d36ee20155f7d0b8c389fef1b507ab401a921cbb7836c511c5cadb8` |
| `snapshots/2026-08-16.json` | `4c1dfd716e2790e83018907b5bc0865430ab800f3a1edf2824d29e657c8d4215` |
| `snapshots/2026-08-19.json` | `4525ab6b0391c9551a3c51b4fc0d68df3df434de6eae9e84d30a4bb00d8d6a2d` |

`writesCanonicalState` on the CLI summary is `false`.
