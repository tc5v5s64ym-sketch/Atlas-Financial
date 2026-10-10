# Date-formatter CI repair — Draft #548

Current source binding and approval scope are recorded in [the final main integration report](BUDGET_FINAL_MAIN_INTEGRATION.md). The repair-specific record below is retained as history; the current receipt exercises 5fdadcd916c78e484c8a45504aedf2c0b7af2b04 with main fc3e6cfd97b09478559f5bec05556ecd365624a6.

Source: Dale's instruction to the existing builder to fix the four failures in [the latest bounded CI comment](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/548#issuecomment-6094496012). Current-state verdict before editing: STILL BROKEN; code required. Both Linux jobs at publication 48651fac22895b9ae77476b3f714f4d762d4981f failed four of 350 suites with periodDateFormat undefined. Current main 657339f46862f187ba2ab81c066e5cd474318b2b was verified unchanged and integrated. The existing isolated branch continues the same Draft PR. No second builder, branch or financial/provider repair is introduced.

## Bounded repair

The standalone composers extract payPeriodNavigatorHtml and payPeriodMonths without the page's new formatter globals. The navigator now owns and reuses its date formatter; the month renderer owns and reuses its month and month/year formatters. Only formatter objects are retained, never dates, financial figures, trust results or rendered strings. All date inputs and locale options remain unchanged. The companion month dependencies are repaired as well as the first date exception.

No existing assertion or suite is weakened, skipped or removed. A new test in the already-registered formatter suite loads the actual renderer functions without page globals, compares their outputs against independent built-in locale formatting across month/year boundaries, changes the input dates and verifies that exactly three formatter objects are constructed and reused. It fails on the prior unbound renderer dependencies.

## Validation

All four affected suites pass locally: future Other Spend reserve, historical pay periods, Budget pay-period swipe and estimated payroll labels. Formatter equivalence/standalone dependency and synchronized-wheel suites pass. Forecast and authority checks pass. All 582 revision-owned numerical snapshot values match independently executed current main; SHA256 60b0328bc9174270ef23c1bba6e2d61f52cc674204ad6cd07728ad6eeabc8ac6.

Exercised source: 7929a5ba2456c6f84c17a405e3f5b45b859d4ced. Source tree: 37d4fe03f0a94f06e0ea7cc495a8fa45e0945132. Clean-start complete browser PASS: 55 screenshots, 191 Git/raw-byte bindings and 30 served assets, with errors:[] and externalRequests:[]. The receipt verifies every scoped source byte before and after execution. Eight held-drag cases, two same-date native refreshes, six original/port comparisons, all 80 original spring steps, native panels, estimates/unknowns, history, all Household lines and the fitted layout remain covered. Evidence-only publication must preserve those exact source bytes.

Full exact-head hosted results and local host limitations are recorded in the PR merge card once available. The failing 48651fa result remains a recorded failure; no older PASS certifies this repair. Browser proof alone does not replace the full correctness gate. Dale's final approval hold and separate Systems/Design/Engine/Money release gates remain pending. Keep Draft; no Ready, merge or deployment. The approved design, original selector motion and native financial authority are unchanged; no Lunch Money code, configuration, credentials, provider state or canonical financial data changes.
