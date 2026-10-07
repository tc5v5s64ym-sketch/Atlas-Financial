# Scheduled fee actual cost and retained allowance

## Current-state gate and outcome

Source: owner-approved five-item queue on 2026-10-07 (18:00 and 18:20 UTC), followed by explicit approval of this bounded repair. Current-state verdict: **STILL BROKEN** on merged #540 main `bcfd5207fdd12b0e13745d89f7afaa942926a4d9`.

One outcome: a uniquely qualified scheduled monthly fee receipt must preserve its original allowance, count recorded expense once, retain a below-plan remainder in the active period, and include above-plan expense in period cost. Forecast owns this result. Native bill recognition, card purchase coverage, and #540 recorded-minimum progress remain their existing authorities.

The baseline synthetic regression passed 8 of 11 cases and failed three independent ledger expectations:

| Invented scenario | Baseline | Independent expected result |
| --- | ---: | ---: |
| Allowance 24, recorded pair 16: From today available | 434.00 | 426.00 |
| Allowance 24, recorded pair 28: Balance After Deductions | 826.00 | 822.00 |
| Pair 16, cash overdraft 4.19, unpaid card annual fee 13.37: From today available | 416.44 | 408.44 |

The household opening in these fixtures is independently invented: cash 500 + 100, period income 1000, household budget allowance 150, and card debt 400. No canonical cents, live rows, credentials or scaled real data are used.

## Implementation and authority

`Forecast.calendarBillSections` attaches `scheduledFeeAllowance` only to the existing qualified `tdfees` represented, paid receipt in the active period. Its published terms are original allowance, recorded expense, remaining allowance, and period cost. Missing/invalid actuals cannot create the term. Historical and future occurrences cannot inherit an active-period reserve.

The period bill section and waterfall consume that term. The existing `budgetAllowanceDays` penny walk includes the retained allowance so both From today funding and savings backing retain the same cash protection. The native allocator reconciliation guard stays intact. The observed cash seed is unchanged; the posted fee and any matched payment transfer are never replayed.

The live consumers are `Forecast.payPeriodViews`, `fromTodayFunding`, and the existing savings cash walk, rendered by the active Budget path in `public/plan.js`. A presence check changes the Bills reserve label and explanatory copy when a retained fee allowance exists. It does not calculate a financial number or mark another payment due. Equal/above-plan cases retain ordinary copy.

This is a local defect in the incumbent Forecast, with a permanent native term. No new planner, provider recognizer, store, taxonomy authority or temporary bridge is introduced.

## Independent reconciliation

For the pair-only fixture, available cash is `(600 - posted) - 150 - max(0, 24 - posted)`. Full-period cost is `max(24, posted)` and Balance After Deductions is `1000 - 150 - max(24, posted)`.

For pair 16 plus the two unexpected fees, observed cash is `600 - 16 - 4.19 = 579.81`. Other Spend is `4.19 + 13.37 = 17.56`. Native unpaid card coverage is 13.37. Available cash is `579.81 - 150 - 13.37 - 8 = 408.44`. A matched partial/full card backfill moves cash and debt while releasing the same amount of coverage, leaving available cash at 408.44. A typed reversal restores coverage without another expense.

The original planned Bills progress stays 24, recorded scheduled expense stays 16, and unexpected expense stays Other Spend. The fixture's observed cash, debt and immutable canonical bill assignment are checked directly.

## Verification

`node test/test-scheduled-fee-routing.js`: **27/27 PASS**. It covers below/equal/above plan; no fee; pending, single-leg and ambiguous receipts; partial/missing evidence; unknown card opening; matched partial/full backfill; typed reversal; last-day/next-period boundaries; repeat observation; and existing ordinary-bill recognition with merchant/account/occurrence guards. A category label or instruction note alone cannot settle a bill.

The 17 focused suites cover the new contract, #540 Bills header, period progress, recorded-payment detail, From today funding/integration, period funding, minimum category/repair/cycle conservation, card purchase coverage, daily savings allocation/consumer, paid-actual trust, month-end reconciliation, Forecast, and authority coverage. The renderer copy change is separately checked through the existing Bills/Budget suites and actual browser path.

Optional browser command:

```text
node test/browser-scheduled-fee-routing.js [installed-browser-path] [local-output-dir]
```

The browser uses actual `App.boot`, serves independently invented observations, and intercepts every request. It rejects external requests and writes. At 1440, 390 and 320 pixels it checks below/equal/above-plan, coverage-withheld, and one-day-early below/above-plan states, native financial terms, visible original-plan/actual evidence, overflow, Enter/Escape and exact focus restoration, period/month return, and responsive resizing. The retained-reserve copy is asserted in both Bills browse and Info. Missing coverage stays unavailable.

The local exact-head receipt records the execution commit and SHA-256 hashes of Forecast, the active renderer and browser harness. Representative committed screenshots are independent invented-data browser output; no private ledger is included. Full `npm test`, required hosted checks, and independent exact-head Systems Review must be green before merge. The builder does not merge this PR.

## Scope and uncertainty

No provider or canonical financial assignments are changed. Unexpected overdraft and current annual card fees remain Other Spend, with native card coverage. Savings assignments remain unconfirmed. Missing evidence remains unknown. The separate owner-authorized 2027 annual-fee estimate is a later PR. Broad category remapping, card-strip presentation, v3 visual completion and the frozen superseded all-fees draft are outside this outcome.

Representative reviewed pixels:

- [Desktop, retained allowance](scheduled-fee-below-1440.png)
- [320px, retained allowance](scheduled-fee-below-320.png)
- [320px Bills detail and reserve explanation](scheduled-fee-below-info-320.png)
- [320px, incomplete coverage](scheduled-fee-coverage-withheld-320.png)

Candidate browser proof: **18/18 PASS**. Existing renderer verification: Bills header, period progress, recorded payment, paid-actual trust, and Budget surface **5/5 PASS**. A guessed `test-budget-browse.js` command reported MODULE_NOT_FOUND; that file is absent and no test was skipped or weakened. The actual registered Budget surface suite and browser exercise the browse path.

## Exact-head review repair: qualified early receipt

Independent review blocked `e3ee912106475c33dbf2f1bd26eabc8de3347152`: a qualified receipt posted on September 29 for the September 30 occurrence missed the allowance term because the scheduled date was after the financial date. The new invented regression independently reproduced below-plan remaining allowance `0` instead of `8` and above-plan Balance After Deductions `826` instead of `822`.

The active-period guard now uses the incumbent `observedPostedOn` date for cash effectiveness, with the scheduled occurrence still required inside the active window. The original scheduled identity remains September 30. Missing posting dates retain the existing scheduled-date fallback. Future-posted/future-effective records, historical windows, and the next-period boundary cannot gain this term.

Five additional controls check early below/equal/above amounts, future-posted evidence and an older query before a receipt becomes effective. The deliberately future-dated packet control tests withholding of this new term and preservation of original planned progress; it does not redefine the incumbent calendar reprint policy. No existing test is weakened.

The repaired source passes 11 existing focused preservation suites: #540 Bills header, From today funding/integration, daily savings allocation, minimum-category confirmation, card coverage, represented effective-date cash conservation, month-end bills, calendar represented actuals, authority coverage and Forecast. The browser adds six early-payment cases across the three widths. All earlier normal/unknown cases remain.

Browser source SHA-256 receipts now normalize UTF-8 line endings to LF so they match committed Git blobs. The earlier renderer receipt hashed Windows working-tree line endings; the PR receipt must use the corrected Git-blob hash. Full-suite evidence from the superseded head is kept separate and does not certify this repaired head. No Systems PASS or merge is claimed.

- [Early receipt desktop](scheduled-fee-early-below-1440.png)
- [Early receipt 320px Info](scheduled-fee-early-below-info-320.png)
