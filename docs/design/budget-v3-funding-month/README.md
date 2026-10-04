# Budget v3: upcoming funding and Month

This slice starts from actual main
`fdf948d2ffee2dfad8b34d3b476ec23224446fb4`, including merged #488.
The reference remains open #480 at
`ad910ac2da1ac2f83d5de6aed983cff6bb275be5`. Its actual desktop, mobile,
and 320px funding/Month pixels were inspected before this implementation.
The reference captures retain the approved layout with independent invented
amounts and labels. Runtime fixtures are also invented; no live data,
scaled household amounts, credentials, or prototype demo controls ship.

## One complete cost-funding interaction

Upcoming costs has the approved two-column card hierarchy, Today/payday
tabs, a month-grouped cost timeline, proposal bars, shortfall attention,
undated contribution hatching, and savings evidence. Each amount comes
from an existing Forecast publication. The two proposals remain separate;
capacity, contribution, remaining requirements, and projected protection
are different fields. No cost total is reconstructed by the page.

Today uses the current period's matching `Budget-from-today` publication,
with the correct financial as-of, period end, status and trust. Historical
or future period selection does not re-date current cash. The exact payday
schedule uses the existing operating-cap selector; projected contribution
and status figures carry schedule funding trust, with the incumbent live
payday trust used only where it applies. Stale dates and explicitly missing
or malformed allocation amounts are unavailable, never zero. Confirmed
cost prices cannot repair an untrusted funding path.

The native Today evidence body was extracted unchanged for reuse. Current
selection moves the original node from period info; other selections have
one current-evidence source, rather than borrowing another period's body.
The native exact-payday plan, cash explanation and savings inventory use
the same shared sheet. Tabs survive rerender and resize, refreshed evidence
replaces the old node, and Back returns to the exact visible trigger above
the mobile dock.

Month now has the approved result/comparison card, three-step funding
ladder, income/outflow diagram and legend, monthly costs card, and eight
reading notes behind a keyboard-accessible info disclosure. It selects the existing `baselineTrajectory` month and
reprints stage1/result, stage2/dateOrderResult and stage3/dateOrderResult.
The heading says **Published projection window** because a current partial
month must not be advertised as a fully observed whole calendar month.
The current pay-period comparison states its separate window and step.
Native component trust labels, cash-date cost membership, funding status,
next contributions, projected funding dates and unavailable reasons remain.
The costs card opens the incumbent Month-input payday funding evidence;
that schedule is explicitly separate from Today's proposal.

The existing month picker, arrows and Month-to-pay-period drilldown remain.
Month code stays inside the incumbent Month section; the unchanged wheel
isolation contract remains green. Forecast remains the sole financial
authority and BudgetSurface the single active renderer. No engine, canonical
amount, account mapping, floor, baseline or assignment changed. Card payment
purpose and minimum-obligation settlement remain with Forecast, outside this
UI work.

## Independent financial and state proof

Invented current cash is 1,215 Bills + 160 spending = 1,375. Remaining
bills are 120 + 85 + 60 = 265. Remaining household is 141.45 + 85.80 +
81.25 = 308.50. With a 300 floor, Today capacity is independently
1,375 - 265 - 308.50 - 300 = **501.50**. The published contribution is
**0**, not the capacity. Later named costs are 400 and 900. A published
95 contribution toward a 400 cost is 23.75% geometry; it is not a new
financial total or a saved balance. An undated invented 275 cost keeps its
known price while its date and contribution remain unavailable.

The history fixture adds an independently invented 105 bill on Aug 7,
47.25 groceries and 19.50 fuel before the live observation boundary.
The paid case is earned through the normal identity/observation pipeline,
so lookback settlement and the operating funding walk agree. A post-overlay
payment injection alone is insufficient for this funding test: it would
leave the operating plan inconsistent with the actuals packet.

Missing/partial/full historical coverage can coexist with complete current
coverage. An unresolved 105 historical bill produces current remaining
bills 370 and Today capacity **396.50**; represented paid history produces
265 and **501.50**. Truncated or posted-only current observations withhold
the proposal. The active financial suite crosses all five coverage states
with paid/unverified settlement and all three period selections. Unknown
trust, null/false/string amounts, wrong date/basis/end, known zero, signed
Month deficits and unavailable Month results are also covered.

## Actual pixels and verification

| Viewport | Today | Payday | Month | In/out | Monthly costs |
|---|---|---|---|---|---|
| 1440px | [Compare](comparison-upcoming-today-1440.png) | [Compare](comparison-upcoming-payday-1440.png) | [Compare](comparison-month-1440.png) | [Compare](comparison-month-flow-1440.png) | [Compare](comparison-month-costs-1440.png) |
| 390px | [Compare](comparison-upcoming-today-390.png) | [Compare](comparison-upcoming-payday-390.png) | [Compare](comparison-month-390.png) | [Compare](comparison-month-flow-390.png) | [Compare](comparison-month-costs-390.png) |
| 320px | [Compare](comparison-upcoming-today-320.png) | [Compare](comparison-upcoming-payday-320.png) | [Compare](comparison-month-320.png) | [Compare](comparison-month-flow-320.png) | [Compare](comparison-month-costs-320.png) |

Different counts, dates and financial states are deliberate fixture
differences; these comparisons do not assert financial equality. Section
captures hide the dock for unobscured layout inspection. Browser bounds
separately verify real keyboard focus above the actual dock. Full Month
captures retain the actual navigation and active page layout, starting at the top.

States: [undated 320px](upcoming-undated-320.png),
[withheld assignments](upcoming-withheld-320.png),
[unavailable Month/zero income](month-zero-income-320.png),
[historical unverified](funding-history-full-unverified-320.png),
[historical paid](funding-history-full-paid-320.png),
[truncated current evidence](funding-history-truncated-unverified-320.png).

```text
node test/test-budget-surface.js
ATLAS_BUDGET_SCREENSHOTS_DIR=<captures> node test/browser-budget-v3-funding-month.js
node test/render-budget-v3-funding-month-comparisons.js <captures> <output>
```

Browser/comparison tools need Playwright through `NODE_PATH` and Chromium
through `CHROME_PATH`. All browser requests are intercepted with invented
fixtures; no deployed app, provider or credential is contacted. The browser
checks desktop/mobile/320px overflow, keyboard tabs, original-node movement,
refreshed evidence, focus restoration, resize, Month membership, historical/
current/future funding scope, undated costs, withheld savings and unavailable
refreshes. Final exact-head targeted, complete-suite and artifact results
are recorded in the draft PR; working runs are not promoted to that head.

## Finite remaining design differences

| Outcome | Current closure | Remaining work |
|---|---|---|
| Primary overview and period navigation | Preserved from #487/#488 | Final owner visual review and responsive polish |
| Category bars, grouped bills, native evidence | Preserved from #488 | Final shared detail typography/spacing parity |
| Upcoming Today/payday costs and Month hierarchy | Implemented with shared publications and complete evidence | Roster counts/shortfall legend, mobile Month section shortcuts, final varying-row-count visual parity |
| Bills-only selected-period required carryover | Not published; projected protection stays explicitly qualified | Forecast publication seam; no page-side reconstruction or reset policy |
| Exact payday sidebar debt/protection/unassigned finish | Existing evidence remains behind complete plan | Default mockup hierarchy once every field has the correct exact-payday publication |
| Worth a Look funding/income attention and final all-section finish | Existing attention/evidence retained | Remaining approved attention cards and final desktop/mobile/320px reference inspection |
| Confirmed savings goals/backing | Shared inventory remains available; unknown assignments stay unknown | Owner evidence for starting assignments; no invented balance or destination |

Full v3 completion is not claimed. #480 remains open as the visual reference.
