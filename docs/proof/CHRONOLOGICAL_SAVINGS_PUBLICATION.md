# One chronological savings publication

Owner instructions on 2026-10-07 authorize one savings pot across the two existing purpose reserves, funding unpaid costs in planning-date order. This atomically ships the approved policy input, its Forecast publication and every current savings consumer. It does not confirm prior manual assignments, deposit money or authorize physical withdrawal routing.

## Current state and integration

Before implementation, fresh main `c2f4ca19bba7a772be218bbc412da9920926d0ee` had no canonical combined policy and no `recommend.savingsFunding`. Budget selected the earlier per-pool policy itself. The independently prepared acceptance script produced 16 RED cases before code existed; its unchanged oracle now passes all 16.

The runtime candidate `d958d72aad66ba4504d13f35c5ecd97b5ec2d911` preserves main `48ede6901123605efd0e146ce128cc1f742a1fb6` (#544), #543 repaired head `1c972fcf0a1149ea0c029045d3c216a0e0511a87` and #546 card head `9cb5b47938df7a57150337c06e4e00ac6913b9aa`. The review-only base `b1e41d31918e0dcf7beaf116295528d21c7747a8` combines those same upstream heads without savings changes. The draft's focused diff targets that base. It cannot merge or deploy from this temporary review base: after the dependencies merge, retarget/rebase onto fresh main and repeat exact-head proof. No upstream repair was edited or weakened.

Canonical edits are exactly the approved policy key and Linden's date, label, when and note. Numeric leaves, household openings, prior assignments, Warriors' settlement, San Diego's planning input and #544's annual estimate are preserved. [Dated source and evidence IDs](../source_intake/CHRONOLOGICAL_SAVINGS_ONE_POT_2026-10-07.md) document the authorization and remaining invoice uncertainty.

The final integration also retains merged #545 main `976e726` and #546 harness repair `de57988f98e1589f077d9c69dbf6e0956ce194a6`. The refreshed review-only base is `b950c0615590b4ac5153254471ea12c63082de2a`. [Bounded repair and full-run disposition](CHRONOLOGICAL_SAVINGS_BOUNDED_REPAIR.md) records the later corrections; final head and required-check results belong in the PR.

## Independent financial closure

- Invented current stock **119 = 30 + 89** backs **60 + 24 + 35** globally, leaving zero. The 24 annual requirement sits between the two club costs. Account/pool/reference ordering cannot change priority. A further 10 in either reserve produces **60 + 24 + 45**.
- An unlinked invented trip of 37 joins once, beyond the short view. A tax requirement of 50 joins at its native date without creating a commitment. With that tax, the same stock backs **60 + 50 + 9 + 0**.
- Cash ledger: **80 + 119 = 199**. A 10 internal deposit produces **70 + 129 = 199**. One 60 cash-paid draw produces **70 + 69 = 139**. A future 77 receipt produces **147 + 69 = 216** only on arrival. No future receipt becomes current stock.
- The separate annual-card control reserves 24 once in the incumbent planning ledger: **199 - 60 - 24 = 115**. It neither posts a purchase nor creates/repays debt. Card settlement and existing repayment obligations retain their native authority. Projected available/reserved cash is not a prediction of physical account balances.
- Missing, stale, pending, foreign, duplicate, fractional or negative reserve evidence cannot authorize backing or a proposal. Independently dated posted stock remains known during pending movement; permission to use it stays withheld. Known requirements survive. Missing native annual/tax point amounts remain unknown requirements rather than disappearing. Unknown protected dates/ranges conservatively withhold the frontier.
- Policy-derived backing is never confirmed `actualSaved` or actual contribution. Current stock/backing survives operating uncertainty independently; proposals and the bounded projection do not. Paid costs stay history and cannot re-enter the unpaid queue. Pre-policy inputs preserve their entire incumbent publication and old controls.

`Forecast.recommend(...).savingsFunding` is the sole current publication. Its schedule aliases `planSpendPaydayFunding`. Savings sheet, Costs ahead, Saving for and Plan Spend select it; the pages do not call a calculator, own a policy, total money or parse generated HTML. Future selected periods publish estimated top-ups and unknown actual saving; historical periods cannot borrow today's balances. The legacy timeline primitive withholds a rival combined-policy projection.

## Finite review checklist

| Item | Status / evidence |
|---|---|
| One combined chronological frontier | Implemented; 16 unchanged independent allocation cases. |
| Location/deposit/draw/income conservation and strict unknowns | Implemented; 19 independent conservation/gate cases, including native simulation and missing annual/tax records. |
| Three Budget views and Plan Spend equality | Implemented; actual App.boot, direct packet selectors, both Today/next-payday lenses, independent fixture backing and schedule alias. Calculator fallbacks throw in the browser harness. |
| Current versus future/historical saving | Implemented; future actuals unknown and top-ups estimated, historical stock unknown, long-horizon requirements retained without extending income permission. |
| Keyboard, dialog focus, period picker, 320px | 24 browser scenarios at 1440/390/320; Escape restores exact triggers, period picker keeps selection focus, no horizontal overflow, replace-only rerender and immutable inputs. |
| Actual desktop/mobile pixels | Captured and inspected; six side-by-side comparisons use the existing independently invented #480 reference pixels. No household data or scaled real amounts. |
| Required suites / privacy / exact-head Systems | Full `npm test` started once at runtime candidate d958d72, with durable receipt; terminal result and final-head hosted checks are reported in the PR. Normal privacy hook runs. Independent Systems review belongs to the parent and remains required. |
| Complete Budget v3 visual finish | **Not claimed.** This is the chronological savings slice. Reference typography/spacing and this screen still differ; the right card intentionally adds owner-requested Saved/Needed groups. Counts, dates, warning state and cost density differ because fixtures are independent. Whole-page parity and later owner changes remain separate acceptance work. |

## Actual captures

[Desktop Today comparison](chronological-savings-comparison-today-1440.png) · [320px Today comparison](chronological-savings-comparison-today-320.png) · [Desktop next-payday comparison](chronological-savings-comparison-payday-1440.png) · [320px next-payday comparison](chronological-savings-comparison-payday-320.png).

[Current 1440px](chronological-savings-ready-1440.png) · [390px](chronological-savings-ready-390.png) · [320px](chronological-savings-ready-320.png) · [Savings sheet](chronological-savings-detail-320.png) · [Missing stock](chronological-savings-missing-320.png) · [Selected future period](chronological-savings-future-320.png) · [Plan Spend](chronological-savings-plan-spend-320.png).

The fixed bottom navigation appears at the captured viewport boundary in tall element screenshots; it is not a duplicate row. The [browser receipt](chronological-savings-browser-receipt.json) names the runtime capture head and all 24 cases. Final-head reruns and byte/source identity are recorded in the PR without changing this proof file after head freeze.

## Reproduction

```text
node test/test-chronological-savings-publication.js
node test/test-chronological-savings-conservation.js
node test/test-savings-daily-allocation-contract.js
node test/test-savings-daily-consumer.js
node test/test-reserve-aware-funding.js
node test/test-reserve-aware-funding-integration.js
node test/test-savings-earmarks-before-after.js
node test/test-bills-recorded-payment.js
node test/test-authority-coverage.js
npm test
CHROME_PATH=<browser> ATLAS_SAVINGS_PROOF=<output> node test/browser-chronological-savings.js
CHROME_PATH=<browser> node test/render-chronological-savings-comparisons.js <captures> <output>
```

No live-provider acceptance was performed. The old Windows missing-token test isolation finding is documented in the bounded-repair proof; further runs isolate credentials to an empty temporary location. Current qualified reserve balances and invoice evidence remain separate parent acceptance reads; hypothetical fixtures do not supply them. The original #480 reference is closed and unmerged following the later owner instruction recorded in the merged final-polish handoff; it is retained as a visual reference and was not altered by this slice.
