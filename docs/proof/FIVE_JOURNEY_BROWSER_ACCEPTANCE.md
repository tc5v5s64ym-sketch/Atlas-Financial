# Five household journeys: focused browser verification

Source: the owner's approved sequence, relayed by the parent on 7 October 2026:
restore loading, verify the deployed read, then one focused verification PR.
Base: `5701e9f07cbb3ea3b2007027c924cbd4ecb5091f`, main after #536.
Each run records its actual execution HEAD and companion source identity below.

This PR changes two existing optional browser companions and this record. It
does not change production calculations, financial data, providers, credentials,
infrastructure, timeout policy, required CI or merge gates. Forecast remains the
financial authority. Existing invented fixtures supply the expected cents;
browser selectors read the actual App.boot, Forecast and page output.

## Producers, consumers and acceptance

| Journey | Exact producer / consumer | Existing selectors and proof |
| --- | --- | --- |
| Open app to usable figures | `public/app.js` App.boot -> synthetic authenticated `/data.json` -> Forecast -> `public/plan.js` | `browser-household-path.js`: `.wrap > [role="status"]`, Cancel/Retry buttons, `[data-live-current-balance-amount]`, `[data-budget-daily-funding-evidence]`, `[data-operating-question="07"]`. A 25-second held server response remains truthful beyond the former 20-second client limit. Cancelled or HTTP 503 data never publishes figures; native repeated Retry clicks start one effective load. Recovery exposes dated ledger values, bill/savings disclosure and Month/period return at 1440 and 390px. Existing 320px ledger/geometry coverage remains. |
| Amanda salary recognized once in Bills | `provider-observe.representedEventCandidates` -> `sanitizedCurrentPeriodActuals` -> applied plan -> Forecast `incomeReceivedAmount` / `budgetProgress` -> Budget income Info | `browser-budget-income-receipts.js` reuses `fixtures/budget-income-receipts.js`. Employer receipt before the paired Bills transfer is unconfirmed in Bills. The exact matched pair contributes 173318 cents once, beside 249318 payroll cents; their received-line sum is 422636 cents. `[data-period-income="amandaSalaryMonthEnd"]`, `[data-income-status="received"]`, `[data-income-line-amount]`, `[data-budget-progress-evidence="income"]`. Same/reordered reload and period -> Month -> period preserve one receipt at 1440/390/320px. Original plans remain separately labelled. |
| Bills and card minimum evidence | Existing recorded payment / observation contracts -> Forecast occurrence settlement -> Budget Bills Info | Reuse `browser-bills-recorded-payment.js`, current native household ledger disclosures and `test-bill-detail.js`. `[data-budget-bill-open]`, `[data-budget-bill-date]`, `[data-period-bill]`, `[data-bill-status]`. Recorded Money sent, confirmed settlement and household intent are distinct. Backfill or ambiguous intent does not prove household minimum settlement; absence of evidence does not prove a lender minimum unpaid. |
| Savings stock and item funding | Forecast `savingsInventory`, `savingsObservedStock`, `savingsDailyFunding` -> Budget Savings Info | Reuse `browser-provider-v2-savings-stock.js` and `browser-savings-daily-consumer.js`. `[data-operating-question="savings"]`, `[data-budget-savings-observed-date]`, `[data-budget-daily-proposal]`. Reported stock, usable backing, funded items and proposed funding are distinct; pending/missing/stale evidence remains qualified. No duplicate negative matrix is added. |
| Period / Month lenses | `public/forecast.js:calendarPeriodWaterfalls` through `recommend().payPeriodViews` and `defaultView.calendarPeriods`, plus existing Month producers -> `public/plan.js` | Reuse `browser-budget-v3-period.js` and `browser-budget-v3-funding-month.js`. `[data-budget-window-step]`, `[data-budget-wheel="period"]`, `[data-budget-granularity]`, `[data-budget-month-picker]`, `[data-budget-detail-sheet]`. Navigation changes the lens, not receipts or arithmetic. Full-period BAD comes from the calendar producer. Packet `predictedEndingBalance` is a compatibility alias; it is not From today cash. |

The new assertions use semantic selectors, not document-wide section indices.
The concurrent Worth a look relocation in `public/plan.js` has no source overlap; its placement
is preserved at the bottom and does not change these semantic selectors.

The household companion now opens current native Bills/category/Funding Info;
its former hidden legacy block is not a usable-figures criterion. Its unchanged
fixture lacks configured purpose pools, so native daily funding is qualified
Unavailable, with no money invented from the earlier planning calculation.
`node test/test-household-path.js` retains the existing independent server/Forecast
ledger, pending/refund/transfer/hold and earlier calculation reconciliations.
The reused daily/stock browser companions supply configured positive and negative
savings states, subject to the run limits below. The income companion likewise checks the current compact
Unavailable savings header, rather than an obsolete hidden ratio selector.
Month -> Pay period enters the incumbent anchored drilldown; the proof uses
`[data-budget-drilldown-exit]` to return to the full period before reconciling the
same receipt again. It does not infer a fresh receipt from navigation.
The visible Balance after bills minus BAD is reconciled to the supplied reserve;
the compact Actual/planned spending summary has its own separate expected cents.
Hidden legacy totals are not treated as a user-visible reserve disclosure.

## Commands and evidence

Use the existing Node 20 environment, existing Playwright package via `NODE_PATH`
and installed Chromium via `CHROME_PATH`; no package/CI installation is added:

```text
node test/browser-household-path.js
node test/browser-budget-income-receipts.js
node test/browser-bills-recorded-payment.js
node test/browser-provider-v2-savings-stock.js
node test/browser-savings-daily-consumer.js
node test/browser-budget-v3-period.js
node test/browser-budget-v3-funding-month.js
node test/test-household-path.js
node test/test-bill-detail.js
node test/test-income-transfer-receipts.js
```

Set each companion's existing output environment variable to a private evidence
directory. Household `loading-phases.json` records the actual execution HEAD,
companion source SHA-256, viewport and navigation -> data response -> usable
result -> first working disclosure times. These separate controlled network wait
from browser calculation/render and interaction; they are not a performance SLA.
Income `income-journey.json` records HEAD, source SHA-256 and independently supplied
received-cent / unique-row results. Existing companions retain their screenshot
and evidence formats. Companion exit zero and its PASS output, together with
those per-run artifacts, are the synthetic acceptance result; failures are
retained and do not become PASS because a screenshot exists.

Screenshots are synthetic, pinned to the recorded source and viewport, and must
be inspected before any visual verdict. Chromium mobile viewport/touch/keyboard
coverage is not physical-device or Safari acceptance. `npm test`, normal privacy
checks and independent exact-head Systems review remain required before merge;
the optional browser companions do not replace them.

## Recorded acceptance and known limit

The extended household companion passes its six desktop/mobile recovery paths,
18 ledger views and process/browser restart. The income companion passes 18
views and three external-receipt -> Bills-match -> reload/navigation journeys.
The unchanged recorded-Bills companion passes 523 assertions across 45 pages;
the savings-stock companion passes 87 cases. The period companion passes at all
three widths. The three unchanged household,
bill-detail and income-transfer unit suites pass. All are synthetic.

The unchanged `browser-savings-daily-consumer.js` stops at its desktop
`selector-exception-stale-stock` assertion after 15 checked desktop modes.
That injection changes only `savingsInventory.observedStock.asOf`; the current
compact header explicitly publishes `reportedStock` (`public/plan.js:4238`),
which remains valid and dated in this fixture. The daily proposal is Unavailable.
This is an obsolete header expectation, not evidence of stale cash being granted.
The failure is retained; this suite is not PASS and its mobile cases did not run.
Updating that third companion is outside this PR's approved two-file scope.
The unchanged `browser-budget-v3-funding-month.js` stops at its first desktop
proposal assertion: it expects $0.00, but its default fixture has no configured
purpose pools. The active `Forecast.savingsDailyFunding` producer therefore
returns Unavailable, which the renderer preserves. Its broader Month matrix
and mobile cases did not run. The extended companions independently pass their
native Month/period returns and receipt conservation; those checks do not turn
this failed suite into PASS. Both retained optional failures require separate
proof maintenance before claiming complete reused-suite acceptance.
The two modified companions are rerun on the committed candidate after #536.
The reused browser/unit results above were obtained on #535 main 71a4f5b2
before that UI order change; their test, fixture and Forecast sources are
unchanged, but those earlier DOM runs are not presented as exact-head UI runs.
Per-run records identify the actual execution heads. Full fresh CI is separate.

## Separate live evidence

Parent/task4 reports one authenticated financial read on deployed main beginning
`71a4f5b2`: success in 87.675 seconds, live overlay, matched salary slots, and the
current card-coverage hold retained. This is read-level evidence supplied by the
parent. This PR's builder has not performed authenticated live browser journeys
or confirmed their rendered figures, screenshots or interactions. Those browser
acceptance results remain NOT RUN here. Synthetic browser PASS cannot establish
deployed identity, hosting latency or the household's current provider state.

Live browser acceptance separately needs the approved deployment full SHA,
authorized session, fresh served `.running-build` label and observed five
journeys at desktop/mobile widths. `/healthz` alone is liveness. No extra live
provider read, credential access, payment action or hosting change is authorized
by this proof record.
