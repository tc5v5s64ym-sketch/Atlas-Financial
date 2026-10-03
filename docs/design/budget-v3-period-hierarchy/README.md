# Budget v3 implementation: period hierarchy

**First slice; the approved visual target is not complete.** Owner instruction
2026-10-03 hands implementation from Opus to Atlas and authorizes edits, tests,
pushes and draft PRs. Reference remains open: [PR #480](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/480),
head `ad910ac2da1ac2f83d5de6aed983cff6bb275be5`.

Before editing, current main `29e90868c1a699a969c402a43da805ee2c829d53`
(including #483 and #484) was rendered at 1440, 390 and 320px against the
reference. Verdict: **PARTIALLY FIXED**. #483 supplies one active renderer but
still prints the old instruction shell and blue disclosure blocks. It lacks
the approved cash hero, compact waterfall, category/bill cards and funding
timeline. Code is required; there is no unanswered owner design gate.

This slice gives the pay-period result a prominent heading and published final
balance, adds restrained fixed-scale waterfall bars, removes the sticky Today
column and restores focus after view/month/drilldown rerenders. The original
disclosures still contain all financial evidence and drilldowns. Forecast stays
the sole authority; geometry is dimensionless, decorative and never a money
total. The existing period funding rules, including prior proposed funding
used for bills, still determine the final balance. Unavailable values stay
unavailable and use hatched tracks. No sample controls enter production.

Known signed balances are distinct from missing values. Positive periods keep
the approved zero-to-income scale. When Forecast publishes a deficit, every
row shares an equal negative/positive income scale with a visible zero marker;
the portion below zero is red. Values outside that scale get directional
overflow arrows. A known zero-income period says `Zero income` and omits ratio
geometry. Known values with unavailable chart geometry say `Scale unavailable`;
only unavailable financial values use the unknown hatch. Desktop tracks share
one origin and width regardless of the length of their money labels.

## Finite visual-difference checklist

| Item | Status and closure |
|---|---|
| 1. Period result and restrained waterfall | Implemented in this slice. Prominent existing result, fixed income scale, neutral rows, negative/estimate qualifiers, hatching. Native evidence disclosures remain until item 7. |
| 2. Page header, period selector, equal overview geometry | Partial. Equal desktop columns implemented. Move the incumbent live navigation above the cards; match header, spacing and progress strip to the reference. Preserve real navigation across month/year boundaries. |
| 3. Today cash card | Next slice: use the existing current period's `fromTodayFunding` fields and their own trust, compact cash allocation bar, floor, withheld evidence and next-payday link. Move duplicate bills-account balance into its evidence. Keep current-position instructions reachable. |
| 4. Worth a look | Pending. Reprint existing evidence/pressure states once; unknown spending remains in money and outside known-category over-plan counts. No new warning or total authority. |
| 5. Household categories and grouped bills | Pending. Visible real category bars/transactions and bill status groups sourced from shared Forecast selectors. Preserve actuals, pending replacement/ambiguity, unassigned spending and paid-without-linked-transaction states. |
| 6. Unified upcoming funding | Pending. Default Today; next-payday proposal one click away, one timeline, never add proposals. Use shared selectors; preserve source-specific cash-walk vs bill-list deductions, forward schedule and shortfall evidence. Configured savings assignments remain unconfirmed. |
| 7. Detail sheets | Pending. Shared accessible dialog shell over current evidence bodies: inert background, scroll lock, Tab/Shift+Tab trap, Escape/scrim close and exact trigger focus return. Retire equivalent inline presentation only after evidence parity proof. |
| 8. Month layout and links | Pending. Match monthly result, ladder, scaled money in/out and dated costs. Use incumbent month/period selection; costs link explicitly selects the next-payday proposal and focuses it. View and picker focus loss repaired in this slice. |
| 9. Trust legend, dark/mobile finish | Pending. Match reference vocabulary against each source's published state. No mockup missing-data toggle, copied household cents or illustrative transactions ship. Complete 320px keyboard/touch and desktop/mobile comparison for every final head. |

Later slices start from fresh main after the previous slice merges; no
implementation stacking is required. #480 remains the reference until every
item is visually verified and all evidence/financial contracts pass.

## Evidence

All runtime captures use `test/fixtures/budget-surface-data.js`, an independent
invented household through the real observation and overlay path. The browser
runner intercepts every request and loads the real `index.html`, `App.boot`,
Forecast and active renderer. It does not start a provider integration or use
credentials. Reference captures replace financial display values with
independent invented figures; these compare geometry, not household amounts.

The comparison images show the approved period card beside this first slice.
The extra current balance/navigation/proposal above the new period result,
longer captions and inline details remain visible differences. They are not
claimed complete. Full reference overview and full runtime captures accompany
the comparisons to make those differences reviewable.

| Viewport | Period comparison | Full active page | Approved overview |
|---|---|---|---|
| 1440px | [Side by side](comparison-1440.png) | [Runtime](current-1440.png) | [Reference](reference-overview-1440.png) |
| 390px | [Side by side](comparison-390.png) | [Runtime](current-390.png) | [Reference](reference-overview-390.png) |
| 320px | [Side by side](comparison-320.png) | [Runtime](current-320.png) | [Reference](reference-overview-320.png) |

Missing-data captures: [unknown assignments and withheld proposal](withheld-390.png),
[unavailable operating plan](unavailable-390.png). Period crops omit surrounding
page sections; the full captures retain the actual navigation and layout.

Signed financial-path regressions:

| State | Desktop | Mobile | Narrow mobile |
|---|---|---|---|
| Known deficit | [1440px](deficit-1440.png) | [390px](deficit-390.png) | [320px](deficit-320.png) |
| Known signed overflow | [1440px](overflow-1440.png) | [390px](overflow-390.png) | [320px](overflow-320.png) |
| Known zero income | [1440px](zero-income-1440.png) | [390px](zero-income-390.png) | [320px](zero-income-320.png) |

These independent invented observations reproduce the blocking
[signed-bar finding](https://github.com/tc5v5s64ym-sketch/Atlas-Financial/pull/485#discussion_r4174982251)
without reading or capturing the household's actual deficit periods. The
deficit variant has 4,050 income, 3,380 bills and 752.99 household: final
`-82.99`. The household bar crosses zero with 82.99 below and 670 above it.
The overflow variant has 11,580 bills: final `-8,282.99`, outside the signed
income scale. The zero-income variant removes the invented salary observation
and both scheduled income amounts: final `0 - 1,665 - 752.99 = -2,417.99`.
The active-path contract and actual browser proof check those figures, signs,
trust, states, segment positions, bounded geometry and shared track dimensions.

`node test/test-budget-surface.js` independently reconciles 2,600 + 1,450 =
4,050 income; 1,400 + 120 + 60 + 85 = 1,665 bills; 450 + 160 + 120 + 22.99 =
752.99 household; final 4,050 - 1,665 - 752.99 = 1,632.01 before unknown savings.
It checks the active renderer, bar segments, published trust, evidence and
withheld/unavailable paths. `node test/browser-budget-v3-period.js` covers
1440/390/320px, real boot, row containment, native keyboard disclosures,
Today focus visibility, rerender focus restoration, unknown savings assignments
and unavailable operating plan. The four older VM harnesses now load
`budget-surface.js` and assert the active surface completes.

The optional browser proof uses Playwright 1.63.0 and Chromium (Edge 154.0.4258.53 on this
Windows host). Install the browser tool in a separate directory with
`npm install --prefix ../browser-tools --ignore-scripts --package-lock=false playwright@1.63.0`.
Set `NODE_PATH` to that directory's `node_modules`, `CHROME_PATH` to the browser
executable and `ATLAS_BUDGET_SCREENSHOTS_DIR` to a temporary capture directory;
then run `node test/browser-budget-v3-period.js`. The production dependency
lockfile is unchanged. The deterministic financial and VM proofs run in
`npm test` without Playwright.

The Windows full suite has four host limitations: POSIX wrapper execution in
two workflow tests, symlink privilege in the figures reference test, and dummy
DPAPI execution in the local credential-resolver test. No test is weakened;
exact-head Ubuntu CI remains required. Deployment and independent exact-head
Systems PASS are obtained by the parent before merge; this builder does not merge.
